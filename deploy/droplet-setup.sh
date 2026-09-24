#!/usr/bin/env bash
# Prepare an Ubuntu droplet to host the Connect apps. Idempotent: every deploy runs
# it first (as root, over SSH from GitHub Actions) and it returns in seconds once
# everything is in place. The same file lives in connect-crm, connect-admin and
# connect-mobile so any one of them can deploy first; keep the copies identical.
#
# Layout it creates:
#   /srv/connect/<app>/releases/<sha>   one directory per deploy (last 3 kept)
#   /srv/connect/<app>/current          symlink to the live release
#   /srv/connect/<app>.env              runtime env for a Node app (PORT, ...)
#   connect@<app>.service               systemd unit per Node app (crm, admin)
#   /etc/caddy/sites/<app>.caddy        Caddy site per app (HTTPS when a domain is set)
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

need_apt_update=1
apt_install() {
  if [ $need_apt_update = 1 ]; then apt-get update -qq; need_apt_update=0; fi
  apt-get install -y -qq "$@" >/dev/null
}

# Swap: a 1 GB droplet runs two Node servers comfortably, but not without headroom.
if ! swapon --show | grep -q .; then
  echo "setup: adding 1 GB swap"
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

command -v curl >/dev/null && command -v gpg >/dev/null || apt_install curl gnupg ca-certificates

# Node.js 22 (runs the Next.js servers)
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" != "22" ]; then
  echo "setup: installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  need_apt_update=0
  apt-get install -y -qq nodejs >/dev/null
fi

# Caddy (reverse proxy + automatic HTTPS certificates)
if ! command -v caddy >/dev/null; then
  echo "setup: installing Caddy"
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  need_apt_update=1
  apt_install caddy
fi
mkdir -p /etc/caddy/sites
if ! grep -q 'import /etc/caddy/sites/\*.caddy' /etc/caddy/Caddyfile 2>/dev/null; then
  printf '# Managed by Connect deploy: one file per app in /etc/caddy/sites/\nimport /etc/caddy/sites/*.caddy\n' > /etc/caddy/Caddyfile
  touch /etc/caddy/sites/_placeholder.caddy
  systemctl reload caddy || systemctl restart caddy
fi

# Service user and directories
id connect >/dev/null 2>&1 || useradd --system --home /srv/connect --shell /usr/sbin/nologin connect
mkdir -p /srv/connect
chown connect:connect /srv/connect

# One systemd unit template for every Node app
cat > /etc/systemd/system/connect@.service.new <<'UNIT'
[Unit]
Description=Connect %i
After=network.target

[Service]
User=connect
WorkingDirectory=/srv/connect/%i/current
EnvironmentFile=/srv/connect/%i.env
Environment=NODE_ENV=production HOSTNAME=127.0.0.1
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/srv/connect/%i

[Install]
WantedBy=multi-user.target
UNIT
if ! cmp -s /etc/systemd/system/connect@.service.new /etc/systemd/system/connect@.service; then
  mv /etc/systemd/system/connect@.service.new /etc/systemd/system/connect@.service
  systemctl daemon-reload
else
  rm /etc/systemd/system/connect@.service.new
fi

# Firewall: SSH, web, and the per-app ports used until domains are set up
if command -v ufw >/dev/null && ! ufw status | grep -q 'Status: active'; then
  echo "setup: enabling firewall"
  ufw allow OpenSSH >/dev/null
  ufw allow 80,443/tcp >/dev/null
  ufw allow 8081,8082/tcp >/dev/null
  ufw --force enable >/dev/null
fi
echo "setup: droplet ready"
