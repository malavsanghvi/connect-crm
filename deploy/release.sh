#!/usr/bin/env bash
# Install an uploaded build on the droplet and switch to it. Run as root by the
# deploy workflow after droplet-setup.sh. Same file in all three repos.
#   release.sh <app> <sha> <kind: node|static> <port> <site>
#     app   crm | admin | mobile
#     port  local port of the Node server (ignored for static)
#     site  Caddy site address: a domain (crm.example.org -> HTTPS) or :80 / :8081 / :8082
# Optional env SITE_WILDCARD_DOMAIN (node apps; the portal): also serve
# <slug>.<that domain> and organizations' own domains over HTTPS (on-demand
# certificates, allowed only for real communities by /api/tenancy/tls-ask),
# and pass it to the app as PORTAL_BASE_DOMAIN. Unset: nothing changes.
set -euo pipefail
app=$1 sha=$2 kind=$3 port=$4 site=$5
base=/srv/connect/$app
rel=$base/releases/$sha

mkdir -p "$rel"
tar -xzf "/tmp/connect-$app-$sha.tgz" -C "$rel"
rm -f "/tmp/connect-$app-$sha.tgz"
chown -R connect:connect "$base"
ln -sfn "$rel" "$base/current.new" && mv -Tf "$base/current.new" "$base/current"

if [ "$kind" = node ]; then
  printf 'PORT=%s\n' "$port" > "/srv/connect/$app.env"
  cat > "/etc/caddy/sites/$app.caddy" <<SITE
$site {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$port
}
SITE
  wild=${SITE_WILDCARD_DOMAIN:-}
  if [ -n "$wild" ]; then
    printf 'PORTAL_BASE_DOMAIN=%s\n' "$wild" >> "/srv/connect/$app.env"
    # Global options must come first: "00-" sorts before every site file.
    cat > "/etc/caddy/sites/00-on-demand-$app.caddy" <<SITE
{
	on_demand_tls {
		ask http://127.0.0.1:$port/api/tenancy/tls-ask
	}
}
SITE
    # Any HTTPS name, but a certificate is issued only when tls-ask says yes
    # (<slug>.$wild or a registered own domain). No "*.$wild" address: that
    # would ask for a wildcard certificate, which needs DNS-provider credentials.
    cat > "/etc/caddy/sites/$app-wildcard.caddy" <<SITE
https:// {
	tls {
		on_demand
	}
	encode zstd gzip
	reverse_proxy 127.0.0.1:$port
}
SITE
  else
    rm -f "/etc/caddy/sites/00-on-demand-$app.caddy" "/etc/caddy/sites/$app-wildcard.caddy"
  fi
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
