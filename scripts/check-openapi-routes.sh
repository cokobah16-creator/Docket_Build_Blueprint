#!/usr/bin/env bash
# Asserts that docs/partner-api.v1.yaml describes exactly the routes supabase/functions/partner-api
# serves — no more and no fewer.
#
# WHY THIS EXISTS. The function's header used to say its contract was "said in the OpenAPI document
# too" when no such document existed. Writing one fixes that sentence once; this script is what
# stops it becoming false again. A hand-kept spec drifts, and a spec that advertises a route the
# function does not serve is worse than no spec at all: a partner writes code against it, ships,
# and gets a 404 from production.
#
# Both directions are checked on purpose. A route in the code and not the spec is an undocumented
# surface; a route in the spec and not the code is a promise nobody keeps.
#
# Dependency-free by design: grep and sort, the same as scripts/check-deployed-reads.sh. It runs in
# any CI job that has a checkout.
#
# Usage: bash scripts/check-openapi-routes.sh
set -euo pipefail
cd "$(dirname "$0")/.."

FN=supabase/functions/partner-api/index.ts
SPEC=docs/partner-api.v1.yaml

for f in "$FN" "$SPEC"; do
  [ -f "$f" ] || { echo "missing: $f"; exit 1; }
done

# The function's own ROUTES table: `{ path: 'matters',  rpc: 'api_v1_matters', … }`.
served=$(grep -oE "^\s*\{\s*path:\s*'[a-z_]+'" "$FN" | grep -oE "'[a-z_]+'" | tr -d "'" | sort -u)
# The spec's own paths, minus the unauthenticated discovery route at /.
described=$(grep -oE '^  /v1/[a-z_]+:' "$SPEC" | sed -E 's|^  /v1/([a-z_]+):|\1|' | sort -u)

[ -n "$served" ]    || { echo "could not read any route from $FN — has ROUTES been reshaped?"; exit 1; }
[ -n "$described" ] || { echo "could not read any /v1/… path from $SPEC"; exit 1; }

undocumented=$(comm -23 <(printf '%s\n' "$served") <(printf '%s\n' "$described"))
unkept=$(comm -13 <(printf '%s\n' "$served") <(printf '%s\n' "$described"))

status=0
if [ -n "$undocumented" ]; then
  echo "::error::the partner API serves routes the OpenAPI document does not describe:"
  printf '  /v1/%s\n' $undocumented
  status=1
fi
if [ -n "$unkept" ]; then
  echo "::error::the OpenAPI document describes routes the partner API does not serve:"
  printf '  /v1/%s\n' $unkept
  status=1
fi

# The discovery route takes no key and is the one a partner reads first. It is easy to drop.
grep -qE '^  /:' "$SPEC" || { echo "::error::$SPEC does not describe the discovery route /"; status=1; }

# Every scope the database will accept must be findable in the document, or a partner cannot know
# what to ask for. The list lives in the migration's own check constraint.
MIG=supabase/migrations/20260910000046_partner_api.sql
for scope in $(grep -oE "'[a-z]+:read'" "$MIG" | tr -d "'" | sort -u); do
  grep -q "$scope" "$SPEC" || { echo "::error::scope $scope is accepted by the database and unmentioned in $SPEC"; status=1; }
done

if [ "$status" -eq 0 ]; then
  echo "partner API: $(printf '%s\n' "$served" | wc -l | tr -d ' ') routes served, all described, none invented"
fi
exit "$status"
