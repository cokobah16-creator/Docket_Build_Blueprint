#!/usr/bin/env bash
# Run the Docket migrations, seed and RLS isolation suite against a LOCAL
# PostgreSQL 16+. Requires a superuser connection. Never point this at
# Supabase: it installs a local stand-in for the auth schema.
#
#   DATABASE_URL=postgres://postgres@localhost:5432/postgres bash scripts/db-test-local.sh
set -euo pipefail

DATABASE_URL="${DATABASE_URL:-postgres://postgres@localhost:5432/postgres}"

case "$DATABASE_URL" in
  *supabase.co*|*supabase.com*|*pooler.supabase*)
    echo "refusing to run local test stub against a Supabase URL" >&2
    exit 1
    ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q)

echo "==> local auth stub"
"${PSQL[@]}" -f "$ROOT/supabase/tests/00_local_auth_stub.sql"

echo "==> migrations"
applied=$("${PSQL[@]}" -tAc "select count(*) from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = 'firm_role'")
if [ "$applied" = "0" ]; then
  for f in "$ROOT"/supabase/migrations/*.sql; do
    echo "    $(basename "$f")"
    "${PSQL[@]}" -f "$f"
  done
else
  echo "    already applied — skipping (drop and recreate the database for a clean run)"
fi

echo "==> seed"
"${PSQL[@]}" -f "$ROOT/supabase/seed.sql"

echo "==> RLS isolation suite"
"${PSQL[@]}" -f "$ROOT/supabase/tests/10_rls_isolation.sql"
