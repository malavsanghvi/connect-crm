#!/usr/bin/env bash
# Install ClamAV on the droplet for virus scanning of uploads (migration 0589, worker/src/handlers/storage.scan.ts):
# clamd (the scanning daemon) and freshclam (its signature updates). Run ONCE, by hand, as root, AFTER the droplet has
# been resized to 4 GB (docs/DEPLOY.md › Malware scanning). The deploy never runs it, and nothing scans until a platform
# admin sets Platform › Setup › Background service › Virus scanning of uploads to monitor (then enforce).
#
#   ssh root@<droplet> 'bash -s' < deploy/clamav-setup.sh
#
# Safe to run again (after a ClamAV package upgrade, for example): it re-applies the settings below and checks clamd.
#
# PREFLIGHT: it refuses to install, and changes nothing, when the droplet has less than 3.5 GB of memory. clamd keeps
# its whole signature database in memory (about 1.2 GB today, and it grows), and the apps and the background service
# share the same machine; ClamAV's own guidance is 2 GB at the very least and 3 to 4 GB for a server that does more.
#
# What it sets (in /etc/clamav/clamd.conf and two systemd drop-ins):
#   StreamMaxLength 60M, MaxFileSize 60M   the largest file it takes (the buckets stop at 50 MB)
#   AlertExceedsMax yes                    a file over a limit is reported (the worker records "could not be checked"),
#                                          never passed as clean
#   MaxRecursion 10, MaxFiles 5000         archives inside archives, files inside an archive
#   MaxScanTime 60000                      a minute per file at most
#   MaxThreads 2                           the droplet's CPUs are shared with the apps
#   ConcurrentDatabaseReload no            a signature update pauses scanning instead of holding two databases in memory
#   AlertOLE2Macros yes                    an old Office file with macros counts as infected
#   127.0.0.1:3310 only                    a systemd socket for the worker (CLAMD_HOST=127.0.0.1); nothing outside the droplet
#   OOMScoreAdjust=800                     when memory runs out the kernel stops clamd, never the apps or the worker
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

MIN_MEM_KB=3500000          # 3.5 GB
MIN_FREE_KB=1500000         # 1.5 GB free under /var/lib for the packages and the signature database
CONF=/etc/clamav/clamd.conf

say() { echo "clamav-setup: $*"; }
fail() { echo "clamav-setup: $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail "run it as root (sudo bash deploy/clamav-setup.sh)."
command -v apt-get >/dev/null || fail "this script is for the Ubuntu droplet (apt-get not found)."

# ── Preflight ────────────────────────────────────────────────────────────────
mem_kb=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
mem_gb=$(awk -v k="$mem_kb" 'BEGIN { printf "%.1f", k / 1000000 }')
if [ "${mem_kb:-0}" -lt "$MIN_MEM_KB" ]; then
  fail "this droplet has ${mem_gb} GB of memory; ClamAV needs at least 3.5 GB here (clamd holds its signature database, about 1.2 GB, in memory next to the apps). Resize the droplet to 4 GB first (DigitalOcean › the droplet › Resize › CPU and RAM only), then run this again. Nothing was installed or changed."
fi
free_kb=$(df --output=avail -k /var/lib | tail -1 | tr -d ' ')
if [ "${free_kb:-0}" -lt "$MIN_FREE_KB" ]; then
  fail "only $((free_kb / 1000)) MB is free under /var/lib; ClamAV needs about 1.5 GB (packages and signatures). Free some space, then run this again. Nothing was installed or changed."
fi
say "memory ${mem_gb} GB, free disk $((free_kb / 1000)) MB: going ahead"

# ── Packages ─────────────────────────────────────────────────────────────────
if ! dpkg -s clamav-daemon clamav-freshclam >/dev/null 2>&1; then
  say "installing clamav-daemon and clamav-freshclam"
  apt-get update -qq
  apt-get install -y -qq clamav-daemon clamav-freshclam >/dev/null
fi

# ── Signatures first (clamd does not start without them) ─────────────────────
if ! ls /var/lib/clamav/main.c[vl]d /var/lib/clamav/main.inc >/dev/null 2>&1 || ! ls /var/lib/clamav/daily.c[vl]d /var/lib/clamav/daily.inc >/dev/null 2>&1; then
  say "downloading the signature database (a few minutes)"
  systemctl stop clamav-freshclam 2>/dev/null || true
  freshclam --quiet || fail "freshclam could not download the signatures (see the lines above); run this again later."
fi
systemctl enable --now clamav-freshclam >/dev/null 2>&1

# ── clamd.conf: one line per setting, ours ───────────────────────────────────
set_conf() {
  local key=$1 value=$2
  sed -i -E "/^[#[:space:]]*${key}([[:space:]]|$)/d" "$CONF"
  printf '%s %s\n' "$key" "$value" >> "$CONF"
}
[ -f "$CONF" ] || fail "$CONF is missing after the install."
cp -n "$CONF" "$CONF.before-connect" 2>/dev/null || true
set_conf StreamMaxLength 60M
set_conf MaxFileSize 60M
set_conf AlertExceedsMax yes
set_conf MaxRecursion 10
set_conf MaxFiles 5000
set_conf MaxScanTime 60000
set_conf MaxThreads 2
set_conf ConcurrentDatabaseReload no
set_conf AlertOLE2Macros yes
# TCP comes from the systemd socket below (127.0.0.1 only); a TCPSocket line here would make clamd bind the port twice.
sed -i -E '/^[#[:space:]]*TCP(Socket|Addr)([[:space:]]|$)/d' "$CONF"

# ── systemd: the TCP socket (127.0.0.1:3310 only) and the OOM score ─────────
mkdir -p /etc/systemd/system/clamav-daemon.socket.d /etc/systemd/system/clamav-daemon.service.d
cat > /etc/systemd/system/clamav-daemon.socket.d/connect.conf <<'UNIT'
# Community Connect (deploy/clamav-setup.sh): the background service talks to clamd on this address only.
[Socket]
ListenStream=127.0.0.1:3310
UNIT
cat > /etc/systemd/system/clamav-daemon.service.d/connect.conf <<'UNIT'
# Community Connect (deploy/clamav-setup.sh): if memory runs out, the kernel stops clamd first, never the apps.
[Service]
OOMScoreAdjust=800
Nice=10
UNIT
systemctl daemon-reload
systemctl enable clamav-daemon.socket clamav-daemon.service >/dev/null 2>&1
# Stop both so the socket can be bound again with the new address, then start them (the service gets both sockets).
systemctl stop clamav-daemon.service clamav-daemon.socket 2>/dev/null || true
systemctl start clamav-daemon.socket
systemctl start clamav-daemon.service

# ── Check: PONG, the version, and the EICAR test file found ──────────────────
# One z-command to clamd on 127.0.0.1:3310; prints its answer (clamd ends every z answer with a NUL).
clamd_cmd() {
  exec 3<>/dev/tcp/127.0.0.1/3310 || return 1
  printf 'z%s\0' "$1" >&3
  local answer=''
  IFS= read -r -t 10 -d '' answer <&3 || true
  exec 3<&- 3>&-
  printf '%s' "$answer"
}
say "waiting for clamd on 127.0.0.1:3310 (loading the signatures takes up to a minute)"
ok=0
for _ in $(seq 1 60); do
  reply=$(clamd_cmd PING 2>/dev/null || true)
  if [ "$reply" = "PONG" ]; then ok=1; break; fi
  sleep 3
done
[ $ok = 1 ] || fail "clamd did not answer on 127.0.0.1:3310 (journalctl -u clamav-daemon -n 50 says why)."
version=$(clamd_cmd VERSION 2>/dev/null || true)
say "clamd answers: ${version:-PONG}"
if command -v python3 >/dev/null; then
  # The EICAR test file (harmless, and found by every scanner), put together here from two halves.
  found=$(python3 - <<'PY'
import socket, struct
e = b'X5O!P%@AP[4\\PZX54(P^)7CC)7}$' + b'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
s = socket.create_connection(('127.0.0.1', 3310), 10)
s.sendall(b'zINSTREAM\0' + struct.pack('>I', len(e)) + e + struct.pack('>I', 0))
print(s.recv(4096).decode('latin1').strip('\0').strip())
PY
)
  case "$found" in
    *FOUND*) say "the EICAR test file is found: $found" ;;
    *) fail "clamd did not find the EICAR test file (it answered: $found)." ;;
  esac
fi
if ss -ltn 2>/dev/null | grep -q '0\.0\.0\.0:3310\|\[::\]:3310\|\*:3310'; then
  fail "clamd listens on every address, not 127.0.0.1 only; check $CONF and the clamav-daemon units."
fi

cat <<'NEXT'
clamav-setup: done. ClamAV runs on 127.0.0.1:3310 and freshclam keeps its signatures up to date.
Next (docs/DEPLOY.md › Malware scanning):
  1. GitHub › Settings › Secrets and variables › Actions › Variables: CLAMD_HOST = 127.0.0.1, then run Deploy.
  2. The worker's own Supabase key (WORKER_SUPABASE_SECRET_KEY), if it is not there yet. It also starts storage
     retention, which DELETES expired files: read docs/DEPLOY.md first.
  3. Platform › Setup › Background service › Virus scanning of uploads: monitor; a week later, enforce.
NEXT
