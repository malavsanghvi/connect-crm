#!/usr/bin/env bash
# Apply pending migrations (and the base seed on a brand-new database) to a
# Supabase project. Used by .github/workflows/deploy.yml; safe to re-run.
#   SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
#     bash supabase/scripts/migrate.sh
# Use the SESSION pooler string (port 5432). The direct db.<ref>.supabase.co host is
# IPv6-only and GitHub runners cannot reach it; the transaction pooler (6543) breaks
# multi-statement migrations.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${SUPABASE_DB_URL:?set SUPABASE_DB_URL to the session pooler connection string}"

q() { psql "$SUPABASE_DB_URL" -qX -v ON_ERROR_STOP=1 "$@"; }

q -c "set client_min_messages = warning" -c "create table if not exists public.connect_schema_migrations (
        version text primary key, applied_at timestamptz not null default now())" >/dev/null

applied=$(q -tA -c "select version from public.connect_schema_migrations")
pending=0
for f in migrations/*.sql; do
  v=$(basename "$f" .sql)
  if grep -qx "$v" <<<"$applied"; then continue; fi
  echo "apply $v"
  # One transaction per file: a failed migration leaves nothing half-applied.
  q --single-transaction -f "$f" \
    -c "insert into public.connect_schema_migrations (version) values ('$v')" >/dev/null
  pending=$((pending + 1))
done
echo "migrations: $pending applied, $(wc -w <<<"$applied") already present"

if [ "$(q -tA -c "select count(*) from app.centers")" = "0" ]; then
  echo "empty database: loading seed.sql (roles, topics, the JSH community)"
  q --single-transaction -f seed.sql >/dev/null
else
  echo "seed: skipped (communities already exist)"
fi
