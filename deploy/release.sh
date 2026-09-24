#!/usr/bin/env bash
# Install an uploaded build on the droplet and switch to it. Run as root by the
# deploy workflow after droplet-setup.sh. Same file in all three repos.
#   release.sh <app> <sha> <kind: node|static|worker> <port> <site>
#     app   crm | admin | mobile | worker
#     port  local port of the Node server (ignored for static); for a worker,
#           its health endpoint on 127.0.0.1
#     site  Caddy site address: a domain (crm.example.org -> HTTPS) or :80 / :8081 / :8082
# Optional env PORTAL_HTTPS=1 (connect-crm's portal only; needs caddy-sites.mjs and
# https-confirm.mjs next to this file): HTTPS for the portal without a redeploy per
# name — see "HTTPS for the portal" in docs/DEPLOY.md. Port 80 keeps serving; the
# droplet address gets a Let's Encrypt IP certificate when Caddy supports it; any
# name approved by /api/tenancy/tls-ask (the portal domain saved in Platform setup,
# organizations' addresses) gets an on-demand certificate; http:// redirects and
# HSTS start only once a name's certificate is confirmed. Optional PUBLIC_IP: the
# droplet's public IPv4 when the DigitalOcean metadata service does not answer.
# Without PORTAL_HTTPS (connect-admin, connect-mobile, older workflows) nothing
# below changes.
# Optional env SITE_WILDCARD_DOMAIN (node apps; the portal): also serve
# <slug>.<that domain> and organizations' own domains over HTTPS (on-demand
# certificates, allowed only for real communities by /api/tenancy/tls-ask),
# and pass it to the app as PORTAL_BASE_DOMAIN. Unset: nothing changes.
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

# ── HTTPS for the portal (PORTAL_HTTPS=1) ────────────────────────────────────
# Writes the portal's Caddy sites with deploy/caddy-sites.mjs, validates them, and
# installs the HTTPS confirmer. Every failure leaves the site on plain HTTP as it
# was: the IP certificate is dropped when this Caddy cannot request one, and the
# previous site files are put back when even the plain configuration is refused.
https_conf=/etc/connect/https.json
confirmed_dir=/var/lib/connect-https/confirmed
portal_https_sites() {
  local sites=/etc/caddy/sites ip="" cv note="" ip_cert=0 domain="" bk
  wild=${SITE_WILDCARD_DOMAIN:-}
  if [ -n "$wild" ]; then printf 'PORTAL_BASE_DOMAIN=%s\n' "$wild" >> "/srv/connect/$app.env"; fi
  case "$site" in :*|-|"") ;; *) domain=$site ;; esac
  # PORTAL_PUBLIC_URL (links in messages, provider callbacks) follows SITE_DOMAIN when not set.
  if [ -n "$domain" ] && ! grep -q '^PORTAL_PUBLIC_URL=' "/srv/connect/$app.env"; then
    printf 'PORTAL_PUBLIC_URL=https://%s\n' "$domain" >> "/srv/connect/$app.env"
  fi
  printf 'HTTPS_STATUS_FILE=/srv/connect/https-status.json\n' >> "/srv/connect/$app.env"

  # Let's Encrypt issues IP certificates only on the "shortlived" ACME profile, which
  # Caddy supports from 2.10.0. Older Caddy: try the packaged upgrade once.
  cv=$(caddy version 2>/dev/null | awk '{print $1}')
  if ! printf '%s\n' "${cv#v}" | awk -F. '{ exit !($1 > 2 || ($1 == 2 && $2 >= 10)) }'; then
    echo "release: Caddy $cv cannot request IP certificates (needs 2.10+); upgrading the caddy package"
    if timeout 180 apt-get install -y -qq --only-upgrade caddy >/dev/null 2>&1; then cv=$(caddy version 2>/dev/null | awk '{print $1}'); else echo "::warning::could not upgrade Caddy ($cv); the droplet address stays on http://"; fi
  fi

  ip=$(curl -fsS -m 3 http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address 2>/dev/null || true)
  [ -n "$ip" ] || ip=${PUBLIC_IP:-}
  if [ -z "$ip" ]; then
    note="The droplet's public address is unknown (no DigitalOcean metadata and no PUBLIC_IP), so no IP certificate was requested."
  elif ! node "$here/caddy-sites.mjs" --check-public-ip "$ip"; then
    note="$ip is not a public IPv4 address, so Let's Encrypt cannot issue a certificate for it."; ip=""
  else
    ip_cert=1
  fi

  bk=$(mktemp -d)
  for f in "00-on-demand-$app.caddy" "$app.caddy" "$app-wildcard.caddy"; do [ -f "$sites/$f" ] && cp -p "$sites/$f" "$bk/"; done
  gen() { node "$here/caddy-sites.mjs" --out "$sites" --app "$app" --port "$port" --site "$site" --public-ip "$ip" --ip-cert "$1"; }
  # Prints Caddy's error and fails when the whole Caddyfile (every app's sites) is refused.
  validate() {
    local out
    out=$(caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1) && return 0
    printf '%s' "$out" | grep -E 'Error' | tail -1 | cut -c1-300
    return 1
  }
  local err="" err2=""
  rm -f "$sites/_placeholder.caddy"
  if gen "$ip_cert" && err=$(validate); then
    :
  elif [ "$ip_cert" = 1 ] && gen 0 && err2=$(validate); then
    note="Caddy $cv refused the IP-certificate site (${err:-no detail}); the droplet address stays on http://."
    echo "::warning::$note"; ip_cert=0
  else
    echo "::warning::the HTTPS configuration was refused by Caddy (${err2:-${err:-no detail}}); keeping the previous sites"
    rm -f "$sites/00-on-demand-$app.caddy" "$sites/$app.caddy" "$sites/$app-wildcard.caddy"
    cp -p "$bk"/* "$sites/" 2>/dev/null || true
    [ -f "$sites/$app.caddy" ] || printf '%s {\n\tencode zstd gzip\n\treverse_proxy 127.0.0.1:%s\n}\n' "$site" "$port" > "$sites/$app.caddy"
    rm -rf "$bk"; portal_https=0; return 0
  fi
  rm -rf "$bk"

  # The confirmer: DNS + certificate check per name, markers for redirects/HSTS, status for Platform setup.
  install -d -m 755 /usr/local/lib/connect /etc/connect "$confirmed_dir"
  install -m 644 "$here/https-confirm.mjs" /usr/local/lib/connect/https-confirm.mjs
  node -e 'const [f, ...a] = process.argv.slice(1); require("fs").writeFileSync(f, JSON.stringify({
      publicIp: a[0] || null, ipCert: a[1] === "1", ipCertNote: a[2] || null, siteDomain: a[3] || null,
      portalPort: Number(a[4]), caddyVersion: a[5] || null, confirmedDir: a[6], statusFile: "/srv/connect/https-status.json",
      caddyStorage: "/var/lib/caddy/.local/share/caddy" }, null, 2) + "\n")' \
    "$https_conf" "$ip" "$ip_cert" "$note" "$domain" "$port" "$cv" "$confirmed_dir"
  cat > /etc/systemd/system/connect-https-confirm.service <<'UNIT'
[Unit]
Description=Connect: confirm HTTPS certificates (redirects and HSTS only for confirmed names)
After=caddy.service network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/node /usr/local/lib/connect/https-confirm.mjs --config /etc/connect/https.json
TimeoutStartSec=300
UNIT
  cat > /etc/systemd/system/connect-https-confirm.timer <<'UNIT'
[Unit]
Description=Connect: confirm HTTPS certificates every minute

[Timer]
OnBootSec=30s
OnUnitActiveSec=60s
AccuracySec=10s

[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now connect-https-confirm.timer >/dev/null 2>&1
  # The member web app over HTTPS (port 8443), next to its http://…:8082 address.
  if command -v ufw >/dev/null && ufw status | grep -q 'Status: active' && ! ufw status | grep -qE '^8443/tcp'; then ufw allow 8443/tcp >/dev/null; fi
}

if [ "$kind" = node ]; then
  printf 'PORT=%s\n' "$port" > "/srv/connect/$app.env"
  # o-messaging: the portal's server-only secrets (Auth hooks, webhooks), installed root-only by the deploy.
  if [ -s "/srv/connect/$app.secrets.env" ]; then cat "/srv/connect/$app.secrets.env" >> "/srv/connect/$app.env"; fi
  here=$(cd "$(dirname "$0")" && pwd)
  if [ "${PORTAL_HTTPS:-}" = 1 ] && [ -f "$here/caddy-sites.mjs" ] && [ -f "$here/https-confirm.mjs" ]; then
    portal_https=1
    portal_https_sites
  else
    portal_https=0
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
if [ "${portal_https:-0}" = 1 ]; then
  # One check now so the deploy log says where HTTPS stands; the timer repeats it every minute.
  sleep 5
  timeout 150 systemctl start connect-https-confirm.service || echo "::warning::the first HTTPS check did not finish; it runs again every minute (journalctl -u connect-https-confirm)"
  journalctl -u connect-https-confirm.service -n 30 --no-pager -o cat --since "-3min" | grep '^https-confirm:' || true
fi

# Keep the three newest releases
ls -1dt "$base"/releases/* | tail -n +4 | xargs -r rm -rf
echo "release: $app $sha live at $site"
