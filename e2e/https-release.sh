#!/usr/bin/env bash
# Runs deploy/release.sh for the portal exactly as the deploy does, but sealed
# off from this machine: /etc, /srv, /var/lib and /usr/local are overlays in a
# private mount namespace (nothing is written to the real ones), systemctl /
# journalctl / apt-get / chown are recorded instead of run, and the DigitalOcean
# metadata answer is faked. The Caddy binary is real, so every generated
# configuration is checked by `caddy validate`.
#
#   sudo CADDY_BIN=/path/to/caddy bash e2e/https-release.sh [scenario]
#   scenarios: ip (default) · domain · legacy · no-ip · old-caddy (needs OLD_CADDY_BIN, e.g. 2.9.1)
#
# Needs root, `unshare` and overlayfs (a Linux dev box or CI runner). o-https.
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
scenario=${1:-ip}
: "${CADDY_BIN:?set CADDY_BIN to a caddy binary}"
[ "$scenario" != old-caddy ] || : "${OLD_CADDY_BIN:?set OLD_CADDY_BIN to a Caddy older than 2.10}"
if [ "${_IN_NS:-}" != 1 ]; then
  exec unshare -m --propagation private env _IN_NS=1 bash "$0" "$@"
fi
work=$(mktemp -d)
trap 'cd / && umount /etc /srv /var/lib /usr/local 2>/dev/null; rm -rf "$work"' EXIT
for d in /etc /srv /var/lib /usr/local; do
  n=$(echo "$d" | tr / _); mkdir -p "$work/u$n" "$work/w$n"
  mount -t overlay overlay -o "lowerdir=$d,upperdir=$work/u$n,workdir=$work/w$n" "$d"
done

bin=$work/bin; mkdir -p "$bin"; log=$work/calls.log; : > "$log"
real_curl=$(command -v curl)
caddy_real=$CADDY_BIN; [ "$scenario" != old-caddy ] || caddy_real=$OLD_CADDY_BIN
printf '#!/bin/sh\nexec %s "$@"\n' "$caddy_real" > "$bin/caddy"
for c in systemctl journalctl apt-get chown ufw; do printf '#!/bin/sh\necho "%s $*" >> %s\n' "$c" "$log" > "$bin/$c"; done
# apt-get "upgrade" fails in the old-caddy scenario, like a held apt lock would.
printf '#!/bin/sh\necho "apt-get $*" >> %s\nexit 100\n' "$log" > "$bin/apt-get"
metadata_ip=134.122.25.56; [ "$scenario" != no-ip ] || metadata_ip=""
cat > "$bin/curl" <<SH
#!/bin/sh
case "\$*" in
  *169.254.169.254*) [ -n "$metadata_ip" ] && { printf '%s' "$metadata_ip"; exit 0; }; exit 22 ;;
  *127.0.0.1:3999/login*) printf 200; exit 0 ;;
esac
exec $real_curl "\$@"
SH
chmod +x "$bin"/*
export PATH="$bin:$PATH"

# What droplet-setup.sh leaves behind.
mkdir -p /etc/caddy/sites /srv/connect
printf 'import /etc/caddy/sites/*.caddy\n' > /etc/caddy/Caddyfile
printf ':8082 {\n\troot * /srv/connect/mobile/current\n\tfile_server\n}\n' > /etc/caddy/sites/mobile.caddy
printf ':8081 {\n\treverse_proxy 127.0.0.1:3001\n}\n' > /etc/caddy/sites/admin.caddy
# A previous deploy with SITE_WILDCARD_DOMAIN (the files this change takes over).
printf '{\n\ton_demand_tls {\n\t\task http://127.0.0.1:3999/api/tenancy/tls-ask\n\t}\n}\n' > /etc/caddy/sites/00-on-demand-crm.caddy
printf 'https:// {\n\ttls {\n\t\ton_demand\n\t}\n\treverse_proxy 127.0.0.1:3999\n}\n' > /etc/caddy/sites/crm-wildcard.caddy

sha=test$RANDOM
mkdir -p "$work/pkg" && echo "console.log(1)" > "$work/pkg/server.js" && tar -czf "/tmp/connect-crm-$sha.tgz" -C "$work/pkg" .
mkdir -p "$work/deploy" && cp "$repo/deploy/release.sh" "$repo/deploy/caddy-sites.mjs" "$repo/deploy/https-confirm.mjs" "$work/deploy/"
site=":80"; https=1
case $scenario in domain) site="crm.example.org" ;; legacy) https=0 ;; esac

fail() { echo "FAIL [$scenario]: $*"; echo "--- calls"; cat "$log"; echo "--- sites"; head -50 /etc/caddy/sites/*.caddy; exit 1; }
out=$(PORTAL_HTTPS=$([ $https = 1 ] && echo 1 || echo 0) SITE_WILDCARD_DOMAIN=communityconnect.test PUBLIC_IP= \
      bash "$work/deploy/release.sh" crm "$sha" node 3999 "$site" 2>&1) || fail "release.sh exited non-zero: $out"
echo "$out" | sed 's/^/    /'
"$caddy_real" validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || fail "final configuration is invalid"
main=/etc/caddy/sites/crm.caddy
case $scenario in
  ip)
    grep -q 'https://134.122.25.56 {' $main || fail "no IP site"
    grep -q 'profile shortlived' $main || fail "no shortlived profile"
    grep -q 'http://134.122.25.56 {' $main || fail "no explicit http:// block for the IP"
    grep -q '"ipCert": true' /etc/connect/https.json || fail "https.json ipCert"
    grep -q 'systemctl enable --now connect-https-confirm.timer' "$log" || fail "timer not enabled"
    grep -q 'systemctl start connect-https-confirm.service' "$log" || fail "first check not run"
    [ -f /usr/local/lib/connect/https-confirm.mjs ] || fail "confirmer not installed"
    grep -q '^PORTAL_BASE_DOMAIN=communityconnect.test' /srv/connect/crm.env || fail "PORTAL_BASE_DOMAIN"
    grep -q '^PORTAL_PUBLIC_URL=' /srv/connect/crm.env && fail "PORTAL_PUBLIC_URL must not be invented without a domain"
    ;;
  domain)
    grep -q 'https://crm.example.org {' $main || fail "no domain site"
    grep -q 'http://crm.example.org, http://134.122.25.56 {' $main || fail "no explicit http:// block"
    grep -q '^PORTAL_PUBLIC_URL=https://crm.example.org' /srv/connect/crm.env || fail "PORTAL_PUBLIC_URL not derived"
    ;;
  no-ip)
    grep -q 'profile' $main && fail "IP site without an address"
    grep -q 'address is unknown' /etc/connect/https.json || fail "no note explaining the missing IP certificate"
    ;;
  old-caddy)
    grep -q 'apt-get install -y -qq --only-upgrade caddy' "$log" || fail "no upgrade attempt"
    grep -q 'profile' $main && fail "old Caddy kept the IP site"
    grep -q 'refused the IP-certificate site' /etc/connect/https.json || fail "no note for the refused IP site"
    grep -q ':80 {' $main || fail "port 80 lost"
    ;;
  legacy)
    grep -qx ':80 {' $main || fail "legacy site changed"
    grep -q 'confirm' "$log" && fail "legacy run installed the confirmer"
    [ -f /etc/caddy/sites/crm-wildcard.caddy ] || fail "legacy wildcard site removed"
    ;;
esac
echo "PASS [$scenario]"
