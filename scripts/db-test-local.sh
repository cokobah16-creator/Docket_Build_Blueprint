#!/usr/bin/env bash
# Runs the migrations, seed and every test suite in supabase/tests (10_… RLS, 20_… platform, …) against a local Postgres (16+).
# Usage: DATABASE_URL=postgres://postgres@localhost:5432/postgres bash scripts/db-test-local.sh
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL to a local Postgres superuser connection}"
DB=docket_test
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "drop database if exists $DB" -c "create database $DB"
TEST_URL="${DATABASE_URL%/*}/$DB"
cd "$(dirname "$0")/../supabase"
psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f tests/00_local_auth_stub.sql
for f in migrations/*.sql; do
  psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f seed.sql
for t in tests/[1-9]*.sql; do
  echo "== $t"
  psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f "$t" 2>&1 | sed -E 's/^psql:[^:]+:[0-9]+: //' | grep -E 'PASS|FAIL|ERROR|ALL CHECKS'
  test "${PIPESTATUS[0]}" -eq 0
done
