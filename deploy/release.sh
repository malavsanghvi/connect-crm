#!/usr/bin/env bash
# Install an uploaded build on the droplet and switch to it. Run as root by the
# deploy workflow after droplet-setup.sh. Same file in all three repos.
#   release.sh <app> <sha> <kind: node|static|worker> <port> <site>
#     app   crm | admin | mobile | worker
#     port  local port of the Node server (ignored for static); for a worker,
#           its health endpoint on 127.0.0.1
#     site  Caddy site address: a domain (crm.example.org -> HTTPS) or :80 / :8081 / :8082
#           (ignored for a worker: it serves nothing to the outside)
#   kind worker (connect-crm's background service only): no Caddy site; its env
#   file /srv/connect/<app>.env holds secrets, so the deploy installs it (root,
#   mode 600) before calling this, and this script never writes it.
set -euo pipefail
app=$1 sha=$2 kind=$3 port=$4 site=$5
base=/srv/connect/$app
rel=$base/releases/$sha

mkdir -p "$rel"
tar -xzf "/tmp/connect-$app-$sha.tgz" -C "$rel"
rm -f "/tmp/connect-$app-$sha.tgz"
chown -R connect:connect "$base"
ln -sfn "$rel" "$base/current.new" && mv -Tf "$base/current.new" "$base/current"

if [ "$kind" = worker ]; then
  if [ ! -s "/srv/connect/$app.env" ]; then
    echo "::error::/srv/connect/$app.env is missing: the deploy installs it before release.sh"
    exit 1
  fi
  systemctl enable "connect@$app" >/dev/null 2>&1
  systemctl restart "connect@$app"
  body=""
  for i in $(seq 1 45); do
    code=$(curl -s -o /tmp/connect-$app-health.json -w '%{http_code}' "http://127.0.0.1:$port/health" || true)
    [ "$code" = 200 ] && break
    sleep 1
  done
  body=$(cat /tmp/connect-$app-health.json 2>/dev/null || true); rm -f /tmp/connect-$app-health.json
  if [ "$code" != 200 ]; then
    echo "::error::$app is not healthy on 127.0.0.1:$port (last HTTP code: ${code:-none}) ${body}"
    journalctl -u "connect@$app" -n 40 --no-pager
    exit 1
  fi
  ls -1dt "$base"/releases/* | tail -n +4 | xargs -r rm -rf
  echo "release: $app $sha running (${body})"
  exit 0
fi

if [ "$kind" = node ]; then
  printf 'PORT=%s\n' "$port" > "/srv/connect/$app.env"
  cat > "/etc/caddy/sites/$app.caddy" <<SITE
$site {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$port
}
SITE
  systemctl enable "connect@$app" >/dev/null 2>&1
  systemctl restart "connect@$app"
  for i in $(seq 1 30); do
    code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/login" || true)
    case $code in 200|307|308) break ;; esac
    sleep 1
  done
  if ! [[ $code =~ ^(200|307|308)$ ]]; then
    echo "::error::$app did not answer on port $port (last HTTP code: ${code:-none})"
    journalctl -u "connect@$app" -n 40 --no-pager
    exit 1
  fi
else
  cat > "/etc/caddy/sites/$app.caddy" <<SITE
$site {
	encode zstd gzip
	root * $base/current
	try_files {path} {path}.html /index.html
	file_server
}
SITE
fi

rm -f /etc/caddy/sites/_placeholder.caddy
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl reload caddy

# Keep the three newest releases
ls -1dt "$base"/releases/* | tail -n +4 | xargs -r rm -rf
echo "release: $app $sha live at $site"
