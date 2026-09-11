#!/usr/bin/env bash
# Every relation and function the front end at a given commit names must exist in a given schema.
#
# supabase/tests/70_deployed_frontend_compat.sql pins that contract by hand, column by column, and a
# hand-kept list drifts: the day a screen starts reading a new table, nothing adds it there. This is
# the half that cannot drift. It reads the names straight out of the code at <ref> — every
# .from("…"), every .rpc("…"), and the two raw rest/v1/… fetches — and asks the database at <url>
# whether each one exists. A rename or a drop that would break a deployed screen fails here whatever
# the suite says.
#
# What it cannot see: a name built at runtime rather than written as a literal. There are none
# today; if one appears, it needs a literal somewhere this can find, or an entry in suite 70.
#
# Usage:  bash scripts/check-deployed-reads.sh <git-ref> <postgres-url>
#   e.g.  bash scripts/check-deployed-reads.sh origin/main postgres://postgres:postgres@localhost:5432/docket_test
set -euo pipefail
REF="${1:?the git ref of the front end to check, e.g. origin/main}"
URL="${2:?the Postgres url of the schema to check it against}"
cd "$(dirname "$0")/.."

# storage.from("bucket") is a bucket, not a table; it is left out on purpose.
rels=$( { git grep -hE '\.from\("[a-z_]+"\)' "$REF" -- app src middleware.ts | grep -v 'storage' | grep -oE '\.from\("[a-z_]+"\)' | sed -E 's/.*"([a-z_]+)".*/\1/'
          git grep -ohE 'rest/v1/[a-z_]+' "$REF" -- app src | sed -E 's|rest/v1/||'; } | sort -u)
rpcs=$(git grep -ohE '\.rpc\("[a-z_]+"' "$REF" -- app src | sed -E 's/.*"([a-z_]+)"/\1/' | sort -u)

missing=0
for r in $rels; do
  n=$(psql "$URL" -Atq -c "select count(*) from information_schema.tables where table_schema = 'public' and table_name = '$r'")
  if [ "$n" != "1" ]; then echo "MISSING relation: $r"; missing=1; fi
done
for f in $rpcs; do
  n=$(psql "$URL" -Atq -c "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '$f'")
  if [ "$n" = "0" ]; then echo "MISSING function: $f"; missing=1; fi
done

if [ "$missing" -ne 0 ]; then
  echo "the front end at $REF names something this schema does not have — see above"
  exit 1
fi
echo "$(echo "$rels" | wc -w | tr -d ' ') relations and $(echo "$rpcs" | wc -w | tr -d ' ') functions named by the front end at $REF: all present in the schema"
