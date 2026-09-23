#!/usr/bin/env bash
# Apply the stub, all migrations, the seed and the behaviour tests to a
# throwaway Postgres database. Exits non-zero on the first error.
#   PGURL=postgres://postgres@localhost:5432 supabase/tests/run_local.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PGURL="${PGURL:-postgres://postgres@localhost:5432}"
DB="${DB:-connect_test}"

psql "$PGURL/postgres" -qv ON_ERROR_STOP=1 -c "drop database if exists $DB" -c "create database $DB" >/dev/null
run() { psql "$PGURL/$DB" -qX -v ON_ERROR_STOP=1 -f "$1" >/dev/null; echo "ok    $1"; }

run tests/stub_supabase.sql
for f in migrations/*.sql; do run "$f"; done
run seed.sql

status=0
for f in tests/*_test.sql; do
  if out=$(psql "$PGURL/$DB" -qX -v ON_ERROR_STOP=1 -f "$f" 2>&1); then
    echo "$out" | grep -oE 'PASS: .*' | sed 's/^/  /'
    echo "ok    $f"
  else
    echo "$out" | grep -oE '(PASS|FAIL|ERROR): .*' | sed 's/^/  /'
    echo "FAIL  $f"
    status=1
  fi
done
exit $status
