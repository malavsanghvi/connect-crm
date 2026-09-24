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
//      exactly why a name is not on HTTPS yet).
// Pure decision logic is exported and unit-tested (tests/https-confirm.test.ts).

export const STATUS_VERSION = 1;
const DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
export const MAX_NAMES = 300;

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
  if (probe.ok) return { state: "https_ok", confirmed: true, reason: `https://${name} has a valid certificate${probe.validTo ? ` (valid until ${probe.validTo})` : ""}.`, validTo: probe.validTo ?? null };
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

export function buildStatus({ now, publicIp, ipCert, ipCertNote, caddyVersion, portalNamesError, results }) {
  return {
    version: STATUS_VERSION,
    checked_at: now,
    public_ip: publicIp ?? null,
    ip_certificate: { enabled: Boolean(ipCert), note: ipCertNote ?? null },
    caddy_version: caddyVersion ?? null,
    portal_names_error: portalNamesError ?? null,
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

async function main() {
  const fs = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const cfgPath = process.argv[2] === "--config" ? process.argv[3] : "/etc/connect/https.json";
  const cfg = await readConfig(cfgPath);
  const publicIp = cleanName(cfg.publicIp) && isIPv4(cfg.publicIp) ? cfg.publicIp : null;
  const confirmedDir = cfg.confirmedDir ?? "/var/lib/connect-https/confirmed";
  const statusFile = cfg.statusFile ?? "/srv/connect/https-status.json";
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

  const results = await pool(names, 6, async ({ name, source }) => {
    // resolveOverrides: local tests only (names like *.localhost have no public DNS).
    const dns = isIPv4(name) ? null : cfg.resolveOverrides?.[name] ? { addresses: cfg.resolveOverrides[name] } : await resolveName(name);
    const pre = decide({ name, publicIp, dns, probe: null });
    const probe = publicIp && (pre.state === "not_checked") ? await probeTls(name, publicIp, cfg.httpsPort ?? 443, cfg.timeoutMs ?? 25_000) : null;
    return { name, source, ...decide({ name, publicIp, dns, probe }) };
  });

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
