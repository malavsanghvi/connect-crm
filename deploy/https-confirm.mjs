#!/usr/bin/env node
// HTTPS confirmer (o-https). Runs on the droplet every minute as the systemd
// unit connect-https-confirm (installed by deploy/release.sh). For every name the
// portal should answer on — the droplet's own address when it has an IP
// certificate, SITE_DOMAIN, the portal domain and wildcard base saved in the
// platform setup wizard (asked from the portal at /api/tenancy/https-names), and
// every name Caddy already holds a certificate for — it:
//   1. checks DNS points at this droplet (names only; skipped for the IP), so a
//      name whose DNS is elsewhere never makes Caddy ask Let's Encrypt in vain;
//   2. opens a real TLS connection to this droplet for that name and verifies the
//      certificate exactly as a browser would (trusted chain, name, dates). The
//      first such handshake for an approved name is what makes Caddy fetch its
//      on-demand certificate, so a newly saved domain goes HTTPS by itself;
//   3. writes a marker file named after the host into the confirmed directory
//      when the certificate verified, and removes it when it did not. Caddy
//      redirects http:// → https:// and sends HSTS ONLY for hosts with a marker
//      (deploy/caddy-sites.mjs), so an unconfirmed name keeps working on HTTP;
//   4. writes a status file the portal shows in Platform setup (what works, and
//      exactly why a name is not on HTTPS yet);
//   5. reloads Caddy when the droplet's own address fails its check (the safety
//      net the owner approved on 2026-10-06): after each renewal of the short-lived
//      IP certificate, Caddy answered every TLS handshake on 443, 8443 and 8444
//      with alert 80 "internal error" until it was reloaded (2026-10-03,
//      2026-10-06; root cause open as B47). At most once every
//      RELOAD_MIN_INTERVAL_MS; only the droplet address can trigger it, never a
//      domain (whose failure may be DNS); the attempt is recorded next to the
//      confirmed directory (last-reload.json) and in the status file
//      (caddy_reload). Config knobs: caddyReload: false switches it off,
//      reloadCommand replaces ["systemctl", "reload", "caddy"] (local tests).
// Pure decision logic is exported and unit-tested (tests/https-confirm.test.ts).

export const STATUS_VERSION = 1;
const DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
export const MAX_NAMES = 300;
/** Caddy is never reloaded more often than this, whether or not the last reload worked. */
export const RELOAD_MIN_INTERVAL_MS = 10 * 60_000;

export const isIPv4 = (v) => IPV4_RE.test(String(v ?? ""));

/** A host name we may check and name a marker file after; null otherwise. */
export function cleanName(raw) {
  const v = String(raw ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (isIPv4(v)) return v;
  return DOMAIN_RE.test(v) ? v : null;
}

/**
 * The names to check, in a stable order: the droplet address (only when it has an
 * IP certificate site), SITE_DOMAIN, the wizard's names, then names Caddy holds a
 * certificate for. Wildcard certificate folders ("wildcard_.x") and junk are dropped.
 * @param {{ publicIp: string|null, ipCert: boolean, siteDomain: string|null, portalNames?: string[], storedNames?: string[] }} input
 * @returns {{ name: string, source: string }[]}
 */
export function candidateNames({ publicIp, ipCert, siteDomain, portalNames = [], storedNames = [] }) {
  const out = [];
  const add = (n, source) => {
    const c = cleanName(n);
    if (!c) return;
    if (isIPv4(c) && !(ipCert && c === publicIp)) return; // IPs other than our own certificate's are never ours to check
    if (!out.some((x) => x.name === c)) out.push({ name: c, source });
  };
  if (ipCert && publicIp) add(publicIp, "droplet_ip");
  if (siteDomain) add(siteDomain, "site_domain");
  for (const n of portalNames) add(n, "platform_setting");
  for (const n of storedNames) add(n, "certificate");
  return out.slice(0, MAX_NAMES);
}

/**
 * The verdict for one name.
 * dns: null for an IP; else { addresses: string[], error?: string }.
 * probe: null when not attempted; else { ok: boolean, error?: string, validTo?: string }.
 */
export function decide({ name, publicIp, dns, probe }) {
  if (!isIPv4(name)) {
    if (!dns || dns.error) {
      return { state: "dns_missing", confirmed: false, reason: `No DNS record for ${name} was found${dns?.error ? ` (${dns.error})` : ""}. Add an A record pointing ${name} at ${publicIp ?? "this server"}.` };
    }
    if (!publicIp) {
      // We cannot compare; let the TLS check decide.
    } else if (!dns.addresses.includes(publicIp)) {
      return {
        state: "dns_elsewhere",
        confirmed: false,
        reason: `${name} points at ${dns.addresses.join(", ") || "nothing"}, not at this server (${publicIp}). Change its A record to ${publicIp}.`,
      };
    }
  }
  if (!probe) return { state: "not_checked", confirmed: false, reason: `HTTPS for ${name} has not been checked yet.` };
  if (probe.ok) {
    const until = probe.validTo && !Number.isNaN(Date.parse(probe.validTo)) ? new Date(probe.validTo).toUTCString().slice(5, 16) : null;
    return { state: "https_ok", confirmed: true, reason: `https://${name} has a valid certificate${until ? ` (renewed automatically; current one valid until ${until})` : ""}.`, validTo: probe.validTo ?? null };
  }
  return {
    state: "https_failed",
    confirmed: false,
    reason: `DNS is right, but https://${name} has no valid certificate yet: ${probe.error ?? "unknown error"}. The server keeps using http:// for it and retries every minute.`,
  };
}

/**
 * Marker files to write and to remove, given the current markers and the verdicts.
 * A marker for a name that was not checked this run is kept when the list of names
 * may be incomplete (the portal did not answer), so a portal restart never flips a
 * working HTTPS name back to HTTP; otherwise it is removed.
 */
export function markerPlan(existing, results, { complete = true } = {}) {
  const want = new Set(results.filter((r) => r.confirmed).map((r) => r.name));
  const checked = new Set(results.map((r) => r.name));
  return {
    write: [...want].filter((n) => !existing.includes(n)).sort(),
    remove: existing.filter((n) => !want.has(n) && (complete || checked.has(n))).sort(),
  };
}

/**
 * Whether to reload Caddy now, and why. Only the droplet's own address counts: it
 * has no DNS to be wrong, and every failure of its check seen so far was Caddy stuck
 * after renewing the IP certificate (alert 80; a renewal could also show as a reset
 * or a timeout, so any probe failure of that address qualifies). A domain's failure
 * never triggers a reload. `reason` says why a reload is wanted (null when the
 * address is fine or has no IP certificate); `reload` stays false while the last
 * reload, whether or not it worked, is less than minIntervalMs old.
 * @param {{ ipCert: boolean, results: { name: string, source: string, state: string, error?: string|null, reason?: string }[], lastReloadAt: string|number|null|undefined, now?: number, minIntervalMs?: number }} input
 * @returns {{ reload: boolean, reason: string|null }}
 */
export function shouldReloadCaddy({ ipCert, results, lastReloadAt, now = Date.now(), minIntervalMs = RELOAD_MIN_INTERVAL_MS }) {
  if (!ipCert) return { reload: false, reason: null };
  const ip = results.find((r) => r.source === "droplet_ip" && r.state === "https_failed");
  if (!ip) return { reload: false, reason: null };
  const reason = `https://${ip.name} failed: ${ip.error ?? ip.reason ?? "unknown error"}`;
  const last = lastReloadAt == null ? NaN : typeof lastReloadAt === "number" ? lastReloadAt : Date.parse(lastReloadAt);
  const since = now - last;
  if (since >= 0 && since < minIntervalMs) {
    const minutes = (ms) => `${Math.round(ms / 60_000)} min`;
    return { reload: false, reason: `${reason}; Caddy was already reloaded ${minutes(since)} ago, so not again for ${minutes(minIntervalMs - since)}` };
  }
  return { reload: true, reason };
}

/**
 * The status file the portal reads (parsed by src/lib/https.ts). STATUS_VERSION stays 1:
 * every field added since (caddy_reload) is optional there, so older files still read.
 * @param {{ now: string, publicIp: string|null, ipCert?: boolean, ipCertNote?: string|null, caddyVersion?: string|null, portalNamesError?: string|null, results: { name: string, source: string, state: string, confirmed: boolean, reason: string, validTo?: string|null }[], caddyReload?: { at: string, reason?: string|null, ok?: boolean, error?: string|null } | null }} input
 */
export function buildStatus({ now, publicIp, ipCert, ipCertNote, caddyVersion, portalNamesError, results, caddyReload = null }) {
  return {
    version: STATUS_VERSION,
    checked_at: now,
    public_ip: publicIp ?? null,
    ip_certificate: { enabled: Boolean(ipCert), note: ipCertNote ?? null },
    caddy_version: caddyVersion ?? null,
    portal_names_error: portalNamesError ?? null,
    // The last time the check reloaded Caddy (header, 5); null when it never has.
    caddy_reload: caddyReload ? { at: caddyReload.at, reason: caddyReload.reason ?? null, ok: caddyReload.ok === true, error: caddyReload.error ?? null } : null,
    names: results.map((r) => ({ name: r.name, source: r.source, state: r.state, confirmed: r.confirmed, reason: r.reason, valid_to: r.validTo ?? null })),
  };
}

// ── IO (droplet only) ─────────────────────────────────────────────────────────

async function readConfig(path) {
  const { readFileSync } = await import("node:fs");
  return JSON.parse(readFileSync(path, "utf8"));
}

async function resolveName(name) {
  const dns = await import("node:dns/promises");
  try {
    const addresses = await dns.resolve4(name);
    return { addresses };
  } catch (e) {
    return { addresses: [], error: e?.code ?? String(e) };
  }
}

async function probeTls(name, publicIp, port, timeoutMs) {
  const tls = await import("node:tls");
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      try {
        socket.destroy();
      } catch (e) {
        console.error(`https-confirm: closing the connection for ${name} failed: ${e?.message ?? e}`);
      }
      resolve(r);
    };
    // Connect to this droplet's own public address, naming the host as a browser would.
    const socket = tls.connect({ host: publicIp, port, servername: isIPv4(name) ? undefined : name, rejectUnauthorized: false, ALPNProtocols: ["http/1.1"] });
    socket.setTimeout(timeoutMs, () => finish({ ok: false, error: `no answer within ${Math.round(timeoutMs / 1000)} s` }));
    socket.once("error", (e) => finish({ ok: false, error: e?.code ? `${e.code}: ${e.message}` : String(e) }));
    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      if (!socket.authorized) return finish({ ok: false, error: String(socket.authorizationError ?? "certificate not trusted") });
      const idError = tls.checkServerIdentity(name, cert);
      if (idError) return finish({ ok: false, error: idError.message });
      finish({ ok: true, validTo: cert?.valid_to ? new Date(cert.valid_to).toISOString() : undefined });
    });
  });
}

async function portalNames(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/tenancy/https-names`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return { names: [], error: `the portal answered HTTP ${r.status}` };
    const body = await r.json();
    return { names: Array.isArray(body?.names) ? body.names : [], error: typeof body?.error === "string" ? body.error : null };
  } catch (e) {
    return { names: [], error: `could not ask the portal: ${e?.message ?? e}` };
  }
}

async function storedNames(storageDir) {
  const { readdirSync, existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = join(storageDir, "certificates");
  if (!existsSync(root)) return [];
  const names = [];
  for (const issuer of readdirSync(root)) {
    try {
      names.push(...readdirSync(join(root, issuer)));
    } catch (e) {
      console.error(`https-confirm: could not list certificates in ${issuer}: ${e?.message ?? e}`);
    }
  }
  return names;
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

/** The last reload attempt ({ at, reason, ok, error }); null when there was none or the record is unreadable. */
async function readReloadState(file) {
  const { readFileSync } = await import("node:fs");
  try {
    const s = JSON.parse(readFileSync(file, "utf8"));
    if (!s || typeof s !== "object" || typeof s.at !== "string") return null;
    return { at: s.at, reason: typeof s.reason === "string" ? s.reason : null, ok: s.ok === true, error: typeof s.error === "string" ? s.error : null };
  } catch (e) {
    if (e?.code !== "ENOENT") console.error(`https-confirm: could not read ${file}: ${e?.message ?? e}`);
    return null;
  }
}

async function writeReloadState(file, state) {
  const fs = await import("node:fs");
  try {
    fs.writeFileSync(`${file}.new`, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o644 });
    fs.renameSync(`${file}.new`, file);
    return true;
  } catch (e) {
    console.error(`https-confirm: could not write ${file}: ${e?.message ?? e}`);
    return false;
  }
}

/** Runs the reload command as given (never through a shell) and says whether it worked. */
async function reloadCaddy(command, timeoutMs = 60_000) {
  const { execFile } = await import("node:child_process");
  const [cmd, ...args] = command;
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (!err) return resolve({ ok: true, error: null });
      const detail = String(stderr || stdout || "").trim().split("\n")[0];
      const why = err.killed ? `did not finish within ${Math.round(timeoutMs / 1000)} s` : typeof err.code === "number" ? `exit status ${err.code}` : String(err.code ?? err.message);
      resolve({ ok: false, error: `${cmd} ${args.join(" ")}: ${why}${detail ? ` (${detail})` : ""}` });
    });
  });
}

async function main() {
  const fs = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const cfgPath = process.argv[2] === "--config" ? process.argv[3] : "/etc/connect/https.json";
  const cfg = await readConfig(cfgPath);
  const publicIp = cleanName(cfg.publicIp) && isIPv4(cfg.publicIp) ? cfg.publicIp : null;
  const confirmedDir = cfg.confirmedDir ?? "/var/lib/connect-https/confirmed";
  const statusFile = cfg.statusFile ?? "/srv/connect/https-status.json";
  const reloadStateFile = cfg.reloadStateFile ?? join(dirname(confirmedDir), "last-reload.json");
  fs.mkdirSync(confirmedDir, { recursive: true, mode: 0o755 });

  const asked = await portalNames(cfg.portalPort ?? 3000);
  if (asked.error) console.error(`https-confirm: ${asked.error}`);
  const names = candidateNames({
    publicIp,
    ipCert: Boolean(cfg.ipCert),
    siteDomain: cfg.siteDomain ?? null,
    portalNames: asked.names,
    storedNames: await storedNames(cfg.caddyStorage ?? "/var/lib/caddy/.local/share/caddy"),
  });

  // resolveOverrides: local tests only (names like *.localhost have no public DNS).
  const lookUp = async (name) => (isIPv4(name) ? null : cfg.resolveOverrides?.[name] ? { addresses: cfg.resolveOverrides[name] } : await resolveName(name));
  const check = async ({ name, source, dns }) => {
    const pre = decide({ name, publicIp, dns, probe: null });
    const probe = publicIp && pre.state === "not_checked" ? await probeTls(name, publicIp, cfg.httpsPort ?? 443, cfg.timeoutMs ?? 25_000) : null;
    return { name, source, dns, error: probe && !probe.ok ? (probe.error ?? "unknown error") : null, ...decide({ name, publicIp, dns, probe }) };
  };
  let results = await pool(names, 6, async (n) => check({ ...n, dns: await lookUp(n.name) }));

  // The safety net (header, 5): reload Caddy when the droplet address fails its check,
  // at most once per RELOAD_MIN_INTERVAL_MS, then look again at the names that failed.
  let lastReload = await readReloadState(reloadStateFile);
  const verdict = shouldReloadCaddy({ ipCert: Boolean(cfg.ipCert) && cfg.caddyReload !== false, results, lastReloadAt: lastReload?.at ?? null });
  if (verdict.reload) {
    lastReload = { at: new Date().toISOString(), reason: verdict.reason, ok: false, error: "the reload did not finish" };
    // The attempt is recorded BEFORE reloading: without that record the rate limit could
    // not hold (Caddy would be reloaded every minute), so then nothing is reloaded at all.
    if (await writeReloadState(reloadStateFile, lastReload)) {
      const r = await reloadCaddy(cfg.reloadCommand ?? ["systemctl", "reload", "caddy"]);
      lastReload = { ...lastReload, ok: r.ok, error: r.error };
      await writeReloadState(reloadStateFile, lastReload);
      if (r.ok) {
        console.log(`https-confirm: reloaded Caddy because ${verdict.reason}`);
        await new Promise((resolve) => setTimeout(resolve, cfg.reloadSettleMs ?? 3000));
        const again = await pool(results.filter((x) => x.state === "https_failed"), 6, check);
        results = results.map((x) => again.find((a) => a.name === x.name) ?? x);
      } else {
        console.error(`https-confirm: could not reload Caddy (${r.error}) although ${verdict.reason}`);
      }
    } else {
      lastReload = { ...lastReload, error: `not reloaded: the attempt could not be recorded in ${reloadStateFile}` };
      console.error(`https-confirm: not reloading Caddy although ${verdict.reason}: the attempt could not be recorded in ${reloadStateFile}`);
    }
  } else if (verdict.reason) {
    console.log(`https-confirm: not reloading Caddy: ${verdict.reason}`);
  }

  const existing = fs.readdirSync(confirmedDir).filter((n) => cleanName(n) === n);
  const plan = markerPlan(existing, results, { complete: !asked.error });
  for (const n of plan.write) fs.writeFileSync(join(confirmedDir, n), `${new Date().toISOString()}\n`, { mode: 0o644 });
  for (const n of plan.remove) fs.rmSync(join(confirmedDir, n), { force: true });

  const status = buildStatus({
    now: new Date().toISOString(),
    publicIp,
    ipCert: cfg.ipCert,
    ipCertNote: cfg.ipCertNote,
    caddyVersion: cfg.caddyVersion,
    portalNamesError: asked.error,
    results,
    caddyReload: lastReload,
  });
  fs.mkdirSync(dirname(statusFile), { recursive: true });
  fs.writeFileSync(`${statusFile}.new`, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o644 });
  fs.renameSync(`${statusFile}.new`, statusFile);
  for (const r of results) console.log(`https-confirm: ${r.confirmed ? "HTTPS " : "http  "} ${r.name} — ${r.reason}`);
  if (plan.write.length || plan.remove.length) console.log(`https-confirm: redirect on for [${plan.write.join(", ")}], off for [${plan.remove.join(", ")}]`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`https-confirm: failed: ${e instanceof Error ? e.stack : e}`);
    process.exit(1);
  });
}
