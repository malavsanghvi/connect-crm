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
#   connect-admin next to the portal (e-https-admin): admin · admin-first · admin-domain ·
#     admin-legacy · admin-no-ip · admin-refused · portal-legacy-after-admin · all (every scenario but old-caddy)
#   ADMIN_REPO=/path/to/connect-admin runs the admin deploys with THAT repo's release.sh and
#   caddy-sites.mjs (the copies must behave the same); default: this repo's.
#
# Needs root, `unshare` and overlayfs (a Linux dev box or CI runner). o-https, e-https-admin.
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
scenario=${1:-ip}
: "${CADDY_BIN:?set CADDY_BIN to a caddy binary}"
[ "$scenario" != old-caddy ] || : "${OLD_CADDY_BIN:?set OLD_CADDY_BIN to a Caddy older than 2.10}"
if [ "$scenario" = all ]; then
  for s in ip domain legacy no-ip admin admin-first admin-domain admin-legacy admin-no-ip admin-refused portal-legacy-after-admin; do
    bash "$0" "$s" || exit 1
  done
  exit 0
fi
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
# ufw: an active firewall, so the deploy's "allow <port>" calls are recorded.
printf '#!/bin/sh\necho "ufw $*" >> %s\n[ "$1" = status ] && echo "Status: active"\nexit 0\n' "$log" > "$bin/ufw"
metadata_ip=134.122.25.56; case $scenario in no-ip|admin-no-ip) metadata_ip="" ;; esac
cat > "$bin/curl" <<SH
#!/bin/sh
case "\$*" in
  *169.254.169.254*) [ -n "$metadata_ip" ] && { printf '%s' "$metadata_ip"; exit 0; }; exit 22 ;;
  *127.0.0.1:3999/login*|*127.0.0.1:3998/login*) printf 200; exit 0 ;;
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

mkdir -p "$work/pkg" && echo "console.log(1)" > "$work/pkg/server.js"
mkdir -p "$work/deploy" && cp "$repo/deploy/release.sh" "$repo/deploy/caddy-sites.mjs" "$repo/deploy/https-confirm.mjs" "$work/deploy/"
admin_repo=${ADMIN_REPO:-$repo}
mkdir -p "$work/deploy-admin" && cp "$admin_repo/deploy/release.sh" "$admin_repo/deploy/caddy-sites.mjs" "$work/deploy-admin/"

fail() { echo "FAIL [$scenario]: $*"; echo "--- calls"; cat "$log"; echo "--- sites"; head -60 /etc/caddy/sites/*.caddy; exit 1; }
# rel <app> <site> <PORTAL_HTTPS 0|1> [wildcard]: one deploy, as the workflows run it.
rel() {
  local app=$1 site=$2 https=$3 wild=${4-communityconnect.test} sha=test$RANDOM dir=$work/deploy port=3999 out
  [ "$app" = crm ] || { dir=$work/deploy-admin; port=3998; }
  tar -czf "/tmp/connect-$app-$sha.tgz" -C "$work/pkg" .
  out=$(PORTAL_HTTPS=$https SITE_WILDCARD_DOMAIN=$([ "$app" = crm ] && echo "$wild") PUBLIC_IP= \
        bash "$dir/release.sh" "$app" "$sha" node "$port" "$site" 2>&1) || fail "release.sh $app exited non-zero: $out"
  echo "$out" | sed "s/^/    [$app] /"
  last_out=$out; [ "$app" = crm ] || admin_out=$out
  "$caddy_real" validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || fail "configuration after the $app deploy is invalid"
}

main=/etc/caddy/sites/crm.caddy
adm=/etc/caddy/sites/admin.caddy
legacy_admin=$(printf ':8081 {\n\tencode zstd gzip\n\treverse_proxy 127.0.0.1:3998\n}')
case $scenario in
  ip|no-ip|old-caddy) rel crm ":80" 1 ;;
  domain) rel crm "crm.example.org" 1 ;;
  legacy) rel crm ":80" 0 ;;
  admin)
    rel crm ":80" 1
    before=$(cat /etc/caddy/sites/00-on-demand-crm.caddy $main /etc/caddy/sites/crm-wildcard.caddy /etc/connect/https.json | sha256sum)
    rel admin ":8081" 1
    after=$(cat /etc/caddy/sites/00-on-demand-crm.caddy $main /etc/caddy/sites/crm-wildcard.caddy /etc/connect/https.json | sha256sum)
    [ "$before" = "$after" ] || fail "the admin deploy changed the portal's files"
    admin_file=$(cat $adm)
    rel crm ":80" 1
    [ "$admin_file" = "$(cat $adm)" ] || fail "the portal deploy changed admin.caddy"
    ;;
  admin-first) rel admin ":8081" 1 ;;
  admin-domain) rel crm ":80" 1; rel admin "admin.example.org" 1 ;;
  admin-legacy) rel crm ":80" 1; rel admin ":8081" 1; rel admin ":8081" 0 ;;
  admin-no-ip) rel crm ":80" 1; rel admin ":8081" 1 ;;
  portal-legacy-after-admin) rel crm ":80" 1; rel admin ":8081" 1; rel crm ":80" 0 "" ;;
  admin-refused)
    # Something else already serves plain HTTP on 8444: Caddy refuses the admin's HTTPS there.
    printf ':8444 {\n\trespond "other"\n}\n' > /etc/caddy/sites/other.caddy
    rel crm ":80" 1; rel admin ":8081" 1 ;;
  *) fail "unknown scenario" ;;
esac
out=$last_out
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
  admin)
    grep -qx ':8081 {' $adm || fail "http://…:8081 is no longer served"
    grep -q 'redir @https_ready https://{host}:8444{uri} 308' $adm || fail "no conditional redirect to 8444"
    [ "$(grep -c 'redir ' $adm)" = 1 ] || fail "more than one redirect"
    grep -q 'https://:8444 {' $adm || fail "no on-demand site on 8444"
    grep -q 'https://134.122.25.56:8444 {' $adm || fail "no IP site on 8444"
    grep -q 'profile shortlived' $adm || fail "no short-lived profile for the IP site"
    grep -q 'reverse_proxy 127.0.0.1:3998' $adm || fail "admin site does not proxy to the admin app"
    grep -q 'on_demand_tls' $adm && fail "admin.caddy carries global options"
    [ "$(ls /etc/caddy/sites | grep -c admin)" = 1 ] || fail "the admin deploy wrote more than admin.caddy: $(ls /etc/caddy/sites)"
    grep -q 'ufw allow 8444/tcp' "$log" || fail "8444 was not opened in the firewall"
    echo "$admin_out" | grep -q 'on HTTPS port 8444' || fail "the deploy log does not say where HTTPS is"
    [ -e /var/lib/connect/caddy-sites.lock ] || fail "no deploy lock"
    ;;
  admin-first)
    [ "$(cat $adm)" = "$legacy_admin" ] || fail "admin.caddy is not today's plain site before the portal has HTTPS: $(cat $adm)"
    echo "$admin_out" | grep -q "starts after the portal's HTTPS is set up" || fail "no notice that HTTPS waits for the portal"
    ;;
  admin-domain)
    grep -q 'http://admin.example.org {' $adm || fail "no explicit http:// site for the admin domain"
    grep -q 'redir @https_ready https://{host}{uri} 308' $adm || fail "no conditional redirect for the admin domain"
    grep -q 'https://admin.example.org {' $adm || fail "no https:// site for the admin domain"
    grep -q 'https://:8444 {' $adm || fail "no 8444 site"
    grep -q ':8081' $adm && fail "a domain site should not also claim 8081"
    grep -qx ':80 {' $main || fail "the portal's port 80 changed"
    ;;
  admin-legacy)
    [ "$(cat $adm)" = "$legacy_admin" ] || fail "an admin deploy without PORTAL_HTTPS did not put the plain site back"
    ;;
  admin-no-ip)
    grep -q '134.122.25.56' $adm && fail "an IP site or exception without a known address"
    grep -q 'https://:8444 {' $adm || fail "no 8444 site"
    grep -q 'redir @https_ready https://{host}:8444{uri} 308' $adm || fail "no conditional redirect"
    ;;
  admin-refused)
    [ "$(cat $adm)" = "$legacy_admin" ] || fail "a refused HTTPS site did not fall back to the plain one: $(cat $adm)"
    echo "$admin_out" | grep -q "HTTPS for admin was not set up (" || fail "no warning saying why"
    grep -q 'ufw allow 8444/tcp' "$log" && fail "8444 opened although nothing serves HTTPS there"
    ;;
  portal-legacy-after-admin)
    grep -q 'on-demand certificates are still used by /etc/caddy/sites/admin.caddy' <<<"$out" || fail "no warning naming admin.caddy"
    [ -f /etc/caddy/sites/00-on-demand-crm.caddy ] || fail "the portal's global on-demand options were removed while admin still uses them"
    grep -q 'https://:8444 {' $adm || fail "admin's HTTPS site was lost"
    ;;
esac
echo "PASS [$scenario]"
