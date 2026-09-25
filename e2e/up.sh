#!/usr/bin/env bash
# Start a throwaway, fully local Community Connect backend for end-to-end tests:
# Postgres (Supabase image) + GoTrue (sign-in) + PostgREST + Storage + Mailpit,
# behind one gateway, with every migration, the seed and the demo data applied
# exactly as production applies them (supabase/scripts/migrate.sh).
#
#   bash e2e/up.sh [name] [port-offset]     e.g. bash e2e/up.sh events 100
#
# API      http://localhost:$((55321+offset))     (NEXT_PUBLIC_/EXPO_PUBLIC_SUPABASE_URL)
# Mail     http://localhost:$((55324+offset))     (sign-in codes land here)
# Database postgres://postgres:postgres@localhost:$((55432+offset))/postgres
# Keys     e2e/.env.<name>  (ANON_KEY for the apps; never a real project's keys)
#
# Logins created: admin@jsh.test (staff), priya@jsh.test (member, parent),
# teacher@jsh.test (teacher, one class), kiran@jsh.test (check-in volunteer, one event).
# Everything here is local test data. `bash e2e/down.sh [name]` removes it.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); repo=$(dirname "$here")
name=${1:-e2e}; off=${2:-0}
export API_PORT=$((55321 + off)) MAIL_PORT=$((55324 + off)) DB_PORT=$((55432 + off)) PORTAL_PORT=$((3100 + off))
envf="$here/.env.$name"
[ -f "$envf" ] || node "$here/gen-keys.mjs" > "$envf"
set -a; . "$envf"; set +a
dc() { docker compose -p "cc-$name" -f "$here/docker-compose.yml" "$@"; }
dc up -d db mail >/dev/null
until dc exec -T db pg_isready -U postgres -h localhost >/dev/null 2>&1; do sleep 1; done
# The Supabase image creates the service roles without passwords.
dc exec -T -e PGPASSWORD=postgres db psql -h localhost -U supabase_admin -d postgres -qc \
  "alter role authenticator with password 'postgres'; alter role supabase_auth_admin with password 'postgres';
   alter role supabase_storage_admin with password 'postgres'; alter role postgres with password 'postgres';" >/dev/null
dc up -d >/dev/null
until curl -sf "http://localhost:$API_PORT/auth/v1/health" >/dev/null; do sleep 1; done
db="postgres://postgres:postgres@localhost:$DB_PORT/postgres"
# The storage service creates its own schema on start; 0172_storage writes to storage.buckets, so wait
# for it (a cold start, e.g. after a reboot, can finish after the API is already healthy).
for i in $(seq 1 120); do
  [ "$(psql "$db" -Atc "select count(*) from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'public'" 2>/dev/null)" = 1 ] && break
  sleep 1
done
SUPABASE_DB_URL="$db" bash "$repo/supabase/scripts/migrate.sh" | tail -2
if [ "$(psql "$db" -Atc "select count(*) from app.people where member_number = 'JSH-90009'")" = 0 ]; then
  psql "$db" -q -v ON_ERROR_STOP=1 -f "$repo/supabase/demo/demo.sql"
fi
dc restart rest >/dev/null   # reload the API schema cache after migrations
login() {
  curl -s -o /dev/null -X POST "http://localhost:$API_PORT/auth/v1/admin/users" -H "apikey: $SERVICE_KEY" \
    -H "Authorization: Bearer $SERVICE_KEY" -H "Content-Type: application/json" -d "{\"email\":\"$1\",\"email_confirm\":true}"
  psql "$db" -q -v email="$1" -v member="$2" -v roles="$3" -f "$repo/supabase/demo/grant-login.sql" 2>&1 | grep -o "Linked.*" || true
}
login admin@jsh.test JSH-90009 "center_admin,treasurer,executive_committee,pathshala_principal,communications_officer,religious_coordinator,store_lead"
login priya@jsh.test JSH-90001 ""
login teacher@jsh.test JSH-90010 teacher
login kiran@jsh.test JSH-90005 checkin_volunteer
until curl -sf "http://localhost:$API_PORT/rest/v1/" -H "apikey: $ANON_KEY" >/dev/null; do sleep 1; done
echo "ready: API http://localhost:$API_PORT · mail http://localhost:$MAIL_PORT · db $db · keys $envf"
