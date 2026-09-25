#!/usr/bin/env node
// Caddy sites for the portal (o-https). Pure generator + a tiny CLI used by
// deploy/release.sh on the droplet (Node.js 22 is installed there by
// droplet-setup.sh). Unit tests: tests/caddy-sites.test.ts.
//
// What it produces, and why:
//   00-on-demand-<app>.caddy  global options: on-demand certificates are only
//                             issued when the portal's /api/tenancy/tls-ask says
//                             yes (the platform portal domain saved in the setup
//                             wizard, the wildcard base, organizations' addresses).
//   <app>.caddy               port 80 keeps serving the portal (never broken).
//                             A request is redirected to https:// only when the
//                             HTTPS confirmer (deploy/https-confirm.mjs) has
//                             proven that host's certificate works: it leaves a
//                             marker file named after the host in CONFIRMED_DIR.
//                             Every host named here ALSO gets its own http:// block, so
//                             Caddy adds no automatic redirect of its own.
//                             Plus: the SITE_DOMAIN site (managed certificate) and
//                             the bare droplet address with a Let's Encrypt
//                             short-lived IP certificate (ACME profile
//                             "shortlived"; needs Caddy 2.10+ — release.sh drops it
//                             when `caddy validate` rejects it).
//   <app>-wildcard.caddy      any other HTTPS name (on demand, approved by
//                             tls-ask), and the member web app over HTTPS on
//                             MEMBER_HTTPS_PORT for the same names.
// HSTS is sent only for hosts that have a confirmation marker.
//
// These file names are the ones older release.sh versions already manage (they
// delete 00-on-demand-<app>.caddy and <app>-wildcard.caddy, and overwrite
// <app>.caddy), so rolling back to an older deploy leaves no stray site behind.

export const DEFAULTS = Object.freeze({
  confirmedDir: "/var/lib/connect-https/confirmed",
  memberRoot: "/srv/connect/mobile/current",
  memberHttpsPort: 8443,
  hstsMaxAge: 2592000, // 30 days
  acmeDirectory: "https://acme-v02.api.letsencrypt.org/directory",
});

const DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const PATH_RE = /^\/[A-Za-z0-9._/-]+$/;

/** "https://Crm.Example.org/" → "crm.example.org"; null when it is not a plain domain name. */
export function normalizeDomain(raw) {
  const v = String(raw ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
  return DOMAIN_RE.test(v) && !IPV4_RE.test(v) ? v : null;
}

export function isIPv4(raw) {
  return IPV4_RE.test(String(raw ?? "").trim());
}

/** A public (routable) IPv4 address: Let's Encrypt refuses private, loopback and reserved ones. */
export function isPublicIPv4(raw) {
  const v = String(raw ?? "").trim();
  if (!IPV4_RE.test(v)) return false;
  const [a, b] = v.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false; // 192.0.0.0/24 and 192.0.2.0/24 documentation
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51) return false; // 198.51.100.0/24 documentation
  if (a === 203 && b === 0) return false; // 203.0.113.0/24 documentation
  return true;
}

/**
 * The SITE argument of release.sh: ":80" (or another ":port") keeps the portal on
 * plain HTTP at that port; a domain name gets its own HTTPS site.
 */
export function parseSite(site) {
  const s = String(site ?? "").trim();
  if (!s || s === "-") return { httpPort: 80, domain: null };
  const port = s.match(/^:(\d{1,5})$/);
  if (port) return { httpPort: Number(port[1]), domain: null };
  const domain = normalizeDomain(s);
  if (!domain) throw new Error(`site "${s}" is neither ":<port>" nor a domain name`);
  return { httpPort: 80, domain };
}

function confirmedMatcher(name, dir) {
  // The file matcher joins {host} under `root` safely (no "..", no absolute paths).
  return [`\t@${name} file {`, `\t\troot ${dir}`, `\t\ttry_files /{host}`, `\t}`];
}

function ipTls(o) {
  return [
    "\ttls {",
    "\t\tissuer acme {",
    `\t\t\tdir ${o.acmeDirectory}`,
    // Let's Encrypt issues IP-address certificates only on the short-lived (~6 day)
    // profile; Caddy renews them on its own well before they expire.
    "\t\t\tprofile shortlived",
    "\t\t}",
    "\t}",
  ];
}

function portalBody(o) {
  return [
    ...confirmedMatcher("hsts", o.confirmedDir),
    `\theader @hsts Strict-Transport-Security "max-age=${o.hstsMaxAge}"`,
    "\tencode zstd gzip",
    `\treverse_proxy 127.0.0.1:${o.port}`,
  ];
}

function memberBody(o) {
  return [
    ...confirmedMatcher("hsts", o.confirmedDir),
    `\theader @hsts Strict-Transport-Security "max-age=${o.hstsMaxAge}"`,
    "\tencode zstd gzip",
    `\troot * ${o.memberRoot}`,
    "\ttry_files {path} {path}.html /index.html",
    "\tfile_server",
  ];
}

const block = (addresses, lines) => [`${addresses.join(", ")} {`, ...lines, "}", ""].join("\n");

/**
 * Build the Caddy site files for the portal.
 * @param {object} input
 * @param {string} input.app                 "crm"
 * @param {number} input.port                the portal's local port (3000)
 * @param {string} input.site                release.sh's SITE: ":80" or a domain
 * @param {string|null} [input.publicIp]     the droplet's public IPv4 (null: unknown)
 * @param {boolean} [input.ipCert]           serve https://<publicIp> with a short-lived IP certificate
 * @param {string|null} [input.memberRoot]   the member web app's files (null: no member site)
 * @param {number} [input.memberHttpsPort]
 * @param {string} [input.confirmedDir]
 * @param {number} [input.hstsMaxAge]
 * @param {string} [input.acmeDirectory]
 * @param {{httpPort:number, httpsPort:number, admin?:string, localCerts?:boolean, storage?:string}} [input.testing]
 *        local test runs only: other ports, Caddy's internal CA instead of Let's Encrypt
 * @returns {{ files: Record<string,string>, summary: string[] }}
 */
export function buildCaddySites(input) {
  const o = { ...DEFAULTS, ...input };
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(String(o.app ?? ""))) throw new Error(`invalid app name "${o.app}"`);
  if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) throw new Error(`invalid port "${o.port}"`);
  if (!Number.isInteger(o.memberHttpsPort) || o.memberHttpsPort < 1 || o.memberHttpsPort > 65535) throw new Error(`invalid member HTTPS port "${o.memberHttpsPort}"`);
  if (!Number.isInteger(o.hstsMaxAge) || o.hstsMaxAge < 0) throw new Error(`invalid HSTS max-age "${o.hstsMaxAge}"`);
  if (!PATH_RE.test(o.confirmedDir)) throw new Error(`invalid confirmed directory "${o.confirmedDir}"`);
  if (o.memberRoot != null && !PATH_RE.test(o.memberRoot)) throw new Error(`invalid member app directory "${o.memberRoot}"`);
  if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9._/-]*$/.test(o.acmeDirectory)) throw new Error(`invalid ACME directory "${o.acmeDirectory}"`);

  const { httpPort, domain } = parseSite(o.site);
  const ip = o.publicIp && isIPv4(o.publicIp) ? o.publicIp.trim() : null;
  const withIpCert = Boolean(o.ipCert && ip);
  const t = o.testing ?? null;
  const httpsPort = t ? t.httpsPort : 443;
  const plainPort = t ? t.httpPort : httpPort;
  const summary = [];

  // ── Global options ──────────────────────────────────────────────────────────
  const globals = ["{"];
  if (t) {
    globals.push(`\thttp_port ${t.httpPort}`, `\thttps_port ${t.httpsPort}`);
    if (t.admin) globals.push(`\tadmin ${t.admin}`);
    if (t.localCerts) globals.push("\tlocal_certs", "\tskip_install_trust");
    if (t.storage) globals.push(`\tstorage file_system ${t.storage}`);
  }
  globals.push("\ton_demand_tls {", `\t\task http://127.0.0.1:${o.port}/api/tenancy/tls-ask`, "\t}", "}", "");

  // ── Port 80: always serves; redirects only confirmed hosts ──────────────────
  // The hosts that also have an HTTPS site here get their own http:// block with
  // host matchers. Measured with Caddy 2.11: when they share the ":80" block, the
  // adapter drops the host matchers and Caddy's automatic redirect (to a
  // certificate that may not exist yet) wins over this file's conditional one.
  const suffix = t ? `:${t.httpPort}` : "";
  const redirectTarget = t ? `https://{host}:${t.httpsPort}{uri}` : "https://{host}{uri}";
  const httpBody = [
    ...confirmedMatcher("https_ready", o.confirmedDir),
    `\tredir @https_ready ${redirectTarget} 308`,
    "\tencode zstd gzip",
    `\treverse_proxy 127.0.0.1:${o.port}`,
  ];
  const namedHttp = [];
  if (domain) namedHttp.push(`http://${domain}${suffix}`);
  if (withIpCert) namedHttp.push(`http://${ip}${suffix}`);
  const main = ["# Managed by connect-crm deploy/caddy-sites.mjs (o-https). Do not edit on the droplet."];
  if (namedHttp.length) main.push(block(namedHttp, httpBody));
  main.push(block([`:${plainPort}`], httpBody));
  summary.push(`http: port ${plainPort} serves the portal; redirects to https only for hosts confirmed in ${o.confirmedDir}`);
  if (domain) {
    main.push(block([`https://${domain}${t ? `:${httpsPort}` : ""}`], portalBody(o)));
    summary.push(`https: ${domain} (certificate requested at start)`);
  }
  if (withIpCert) {
    main.push(block([`https://${ip}${t ? `:${httpsPort}` : ""}`], [...(t?.localCerts ? [] : ipTls(o)), ...portalBody(o)]));
    summary.push(`https: ${ip} (Let's Encrypt short-lived IP certificate)`);
  }

  // ── Any other HTTPS name, on demand; the member web app on its own port ─────
  const wild = [
    "# Managed by connect-crm deploy/caddy-sites.mjs (o-https). Do not edit on the droplet.",
    "# Any HTTPS name: a certificate is issued only when /api/tenancy/tls-ask says yes. No",
    "# \"*.<domain>\" address: that would need a wildcard certificate (DNS-provider credentials).",
    block([t ? `https://:${httpsPort}` : "https://"], ["\ttls {", "\t\ton_demand", "\t}", ...portalBody(o)]),
  ];
  summary.push("https: any name approved by /api/tenancy/tls-ask (on-demand certificates)");
  if (o.memberRoot) {
    wild.push(block([`https://:${o.memberHttpsPort}`], ["\ttls {", "\t\ton_demand", "\t}", ...memberBody(o)]));
    if (withIpCert) wild.push(block([`https://${ip}:${o.memberHttpsPort}`], [...(t?.localCerts ? [] : ipTls(o)), ...memberBody(o)]));
    summary.push(`https: member web app on port ${o.memberHttpsPort} for the same names${withIpCert ? ` and ${ip}` : ""}`);
  }

  return {
    files: {
      [`00-on-demand-${o.app}.caddy`]: globals.join("\n"),
      [`${o.app}.caddy`]: main.join("\n"),
      [`${o.app}-wildcard.caddy`]: wild.join("\n"),
    },
    summary,
  };
}

// ── Another Node app next to the portal (e-https-admin) ──────────────────────
// connect-admin (the event-day app) keeps its http://<address>:8081 and gains its
// own HTTPS port (8444) on the same names as the portal. Each app's deploy writes
// ONLY its own file, <app>.caddy (the name every release.sh already overwrites, so
// an older deploy puts the plain site back). The shared pieces stay the portal's:
// the global on-demand options (00-on-demand-crm.caddy, whose tls-ask approves the
// names), the IP-certificate decision and the confirmed directory (both read from
// the portal's /etc/connect/https.json) and the HTTPS confirmer. The certificate for
// a name is the same on every port, so a name the confirmer verified on 443 works
// on 8444 too.
// HSTS is per host, not per port: once a confirmed domain sends it, a browser turns
// http://<domain>:8081 into https://<domain>:8081, which is plain HTTP and fails.
// That is why the app gets an HTTPS port of its own: https://<name>:8444 is the
// address HSTS never breaks, and http://…:8081 redirects there once confirmed.
// Until then (and for the bare IP, which browsers never pin) 8081 serves as today.

export const APP_HTTPS_PORTS = Object.freeze({ admin: 8444 });

/**
 * Build the Caddy site file for an app that joins the portal's HTTPS.
 * @param {object} input
 * @param {string} input.app                 "admin" (never "crm": that is buildCaddySites)
 * @param {number} input.port                the app's local port (3001)
 * @param {string} input.site                release.sh's SITE: ":8081" or a domain
 * @param {number} [input.httpsPort]         the app's own HTTPS port (APP_HTTPS_PORTS[app])
 * @param {string|null} [input.publicIp]     from the portal's https.json
 * @param {boolean} [input.ipCert]           from the portal's https.json (it proved Caddy accepts it)
 * @param {string} [input.confirmedDir]      from the portal's https.json
 * @param {number} [input.hstsMaxAge]
 * @param {string} [input.acmeDirectory]
 * @param {{httpPort:number, httpsPort:number, localCerts?:boolean}} [input.testing]
 *        local test runs only: the ports standing in for 80 and 443, Caddy's local CA
 * @returns {{ files: Record<string,string>, summary: string[], httpsPort: number }}
 */
export function buildAppSites(input) {
  const o = { ...DEFAULTS, ...input };
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(String(o.app ?? ""))) throw new Error(`invalid app name "${o.app}"`);
  if (o.app === "crm") throw new Error("the portal's sites come from buildCaddySites");
  const httpsPort = o.httpsPort ?? APP_HTTPS_PORTS[o.app];
  for (const [what, v] of [["port", o.port], ["HTTPS port", httpsPort]]) {
    if (!Number.isInteger(v) || v < 1 || v > 65535) throw new Error(`invalid ${what} "${v}"`);
  }
  if (!Number.isInteger(o.hstsMaxAge) || o.hstsMaxAge < 0) throw new Error(`invalid HSTS max-age "${o.hstsMaxAge}"`);
  if (!PATH_RE.test(o.confirmedDir)) throw new Error(`invalid confirmed directory "${o.confirmedDir}"`);
  if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9._/-]*$/.test(o.acmeDirectory)) throw new Error(`invalid ACME directory "${o.acmeDirectory}"`);
  const { httpPort, domain } = parseSite(o.site);
  const t = o.testing ?? null;
  // The portal owns ports 80 and 443 (and 8443 for the member app); a plain site there
  // would collide with the portal's catch-all blocks.
  const reserved = new Set([t ? t.httpPort : 80, t ? t.httpsPort : 443, DEFAULTS.memberHttpsPort]);
  if (!domain && reserved.has(httpPort)) throw new Error(`port ${httpPort} belongs to the portal; give ${o.app} its own port (":8081")`);
  if (reserved.has(httpsPort) || (!domain && httpsPort === httpPort)) throw new Error(`HTTPS port ${httpsPort} is already used; pick another`);
  const ip = o.publicIp && isIPv4(o.publicIp) ? o.publicIp.trim() : null;
  const withIpCert = Boolean(o.ipCert && ip);
  const summary = [];
  const out = [`# Managed by deploy/caddy-sites.mjs (e-https-admin; the same file ships in connect-crm and connect-${o.app}). Do not edit on the droplet.`];
  const body = portalBody(o);
  // Without an IP site of its own (address unknown, or release.sh retried without it)
  // an IP address is never redirected, even when the portal has confirmed it since:
  // https://<ip>:<port> would have no certificate here.
  const matcher = withIpCert
    ? confirmedMatcher("https_ready", o.confirmedDir)
    : ["\t@https_ready {", "\t\tfile {", `\t\t\troot ${o.confirmedDir}`, "\t\t\ttry_files /{host}", "\t\t}", "\t\tnot header_regexp Host ^[0-9.]+(:[0-9]+)?$", "\t}"];
  const plain = (redirectTo) => [...matcher, `\tredir @https_ready ${redirectTo} 308`, "\tencode zstd gzip", `\treverse_proxy 127.0.0.1:${o.port}`];

  if (domain) {
    // Its own name, like SITE_DOMAIN for the portal: http:// keeps serving until confirmed.
    out.push(block([`http://${domain}${t ? `:${t.httpPort}` : ""}`], plain(t ? `https://{host}:${t.httpsPort}{uri}` : "https://{host}{uri}")));
    out.push(block([`https://${domain}${t ? `:${t.httpsPort}` : ""}`], body));
    summary.push(`http: ${domain} serves ${o.app}; redirects to https://${domain} once confirmed`, `https: ${domain} (certificate requested at start)`);
  } else {
    out.push(block([`:${httpPort}`], plain(`https://{host}:${httpsPort}{uri}`)));
    summary.push(`http: port ${httpPort} serves ${o.app}; redirects to https://<name>:${httpsPort} only for hosts confirmed in ${o.confirmedDir}`);
  }
  // Every name the portal approves (tls-ask), on the app's own port. Needs the portal's
  // global on_demand_tls options; release.sh checks they exist before writing this.
  out.push(block([`https://:${httpsPort}`], ["\ttls {", "\t\ton_demand", "\t}", ...body]));
  if (withIpCert) out.push(block([`https://${ip}:${httpsPort}`], [...(t?.localCerts ? [] : ipTls(o)), ...body]));
  summary.push(`https: ${o.app} on port ${httpsPort} for every name the portal serves${withIpCert ? ` and ${ip}` : ""}`);
  return { files: { [`${o.app}.caddy`]: out.join("\n") }, summary, httpsPort };
}

// ── CLI ───────────────────────────────────────────────────────────────────────
//   node caddy-sites.mjs --out /etc/caddy/sites --app crm --port 3000 --site :80
//        [--public-ip 1.2.3.4] [--ip-cert 1|0] [--member-root DIR|""] [--hsts-max-age N]
//   node caddy-sites.mjs --role app --out /etc/caddy/sites --app admin --port 3001 --site :8081
//        [--https-port 8444] [--public-ip 1.2.3.4] [--ip-cert 1|0] [--confirmed-dir DIR]
//   node caddy-sites.mjs --https-config /etc/connect/https.json --field publicIp|ipCert|confirmedDir
//        prints one value of the portal's HTTPS settings ("" when absent; ipCert: 1 or 0)
//   node caddy-sites.mjs --check-public-ip 1.2.3.4      exit 0 when Let's Encrypt can certify it
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (!k.startsWith("--")) throw new Error(`unexpected argument "${k}"`);
    const v = argv[i + 1];
    if (v === undefined) throw new Error(`missing value for ${k}`);
    args[k.slice(2)] = v;
    i += 1;
  }
  return args;
}

async function main() {
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const a = parseArgs(process.argv.slice(2));
  // release.sh: may Let's Encrypt issue a certificate for this address? (exit 0 = yes)
  if (a["check-public-ip"] !== undefined) process.exit(isPublicIPv4(a["check-public-ip"]) ? 0 : 1);
  if (a["https-config"] !== undefined) {
    const cfg = JSON.parse((await import("node:fs")).readFileSync(a["https-config"], "utf8"));
    const f = a.field;
    if (f === "ipCert") console.log(cfg.ipCert === true ? "1" : "0");
    else if (f === "publicIp") console.log(isIPv4(cfg.publicIp) ? cfg.publicIp : "");
    else if (f === "confirmedDir") console.log(typeof cfg.confirmedDir === "string" && PATH_RE.test(cfg.confirmedDir) ? cfg.confirmedDir : DEFAULTS.confirmedDir);
    else throw new Error(`unknown --field "${f}"`);
    return;
  }
  if (!a.out) throw new Error("--out <directory> is required");
  if (a.role === "app") {
    const r = buildAppSites({
      app: a.app,
      port: Number(a.port),
      site: a.site ?? "",
      httpsPort: a["https-port"] ? Number(a["https-port"]) : undefined,
      publicIp: a["public-ip"] || null,
      ipCert: a["ip-cert"] === "1",
      confirmedDir: a["confirmed-dir"] || DEFAULTS.confirmedDir,
      hstsMaxAge: a["hsts-max-age"] ? Number(a["hsts-max-age"]) : DEFAULTS.hstsMaxAge,
    });
    mkdirSync(a.out, { recursive: true });
    for (const [name, text] of Object.entries(r.files)) writeFileSync(join(a.out, name), text);
    for (const line of r.summary) console.log(`caddy-sites: ${line}`);
    return;
  }
  if (a.role !== undefined && a.role !== "portal") throw new Error(`unknown --role "${a.role}"`);
  const r = buildCaddySites({
    app: a.app ?? "crm",
    port: Number(a.port ?? 3000),
    site: a.site ?? ":80",
    publicIp: a["public-ip"] || null,
    ipCert: a["ip-cert"] === "1",
    memberRoot: a["member-root"] === undefined ? DEFAULTS.memberRoot : a["member-root"] || null,
    hstsMaxAge: a["hsts-max-age"] ? Number(a["hsts-max-age"]) : DEFAULTS.hstsMaxAge,
  });
  mkdirSync(a.out, { recursive: true });
  for (const [name, text] of Object.entries(r.files)) writeFileSync(join(a.out, name), text);
  for (const line of r.summary) console.log(`caddy-sites: ${line}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`caddy-sites: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
