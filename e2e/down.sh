#!/usr/bin/env bash
# Remove a local e2e backend started by e2e/up.sh (containers and their data).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); name=${1:-e2e}
set -a; . "$here/.env.$name"; set +a
API_PORT=0 MAIL_PORT=0 DB_PORT=0 PORTAL_PORT=0 docker compose -p "cc-$name" -f "$here/docker-compose.yml" down -v
rm -f "$here/.env.$name"
