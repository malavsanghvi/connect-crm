// The event-day app (connect-admin) on its own HTTPS port next to the portal (stream
// e-https-admin, owner decision #17), end to end: the deploy's own generators for BOTH apps,
// a real Caddy, the real HTTPS confirmer, the real portal (tls-ask) and the real connect-admin.
// Only ports and the certificate authority differ from the droplet:
//   droplet:  80 · 443 · 8443 (member) · 8081 (admin http) · 8444 (admin https)
//   here:  18580 · 18543 · 18544      · 18581              · 18545
//
//   bash e2e/up.sh e-https-admin 400
//   set -a; . e2e/.env.e-https-admin; set +a
//   (connect-crm)   NEXT_PUBLIC_SUPABASE_URL=http://localhost:55721 NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY pnpm build
//                   PORT=3500 PORTAL_BASE_DOMAIN=orgs-https.test HTTPS_STATUS_FILE=/tmp/claude-0/eha/e2e/status.json … pnpm start
//   (connect-admin) same build env; next start -p 3501
//   CADDY_BIN=/path/to/caddy [ADMIN_REPO=/path/to/connect-admin] node e2e/flows/e-https-admin.cjs
//
// ADMIN_REPO: generate the admin site with connect-admin's own copy of caddy-sites.mjs (as its deploy does).
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '../..');
const adminRepo = process.env.ADMIN_REPO || repo;
const PORTAL = Number(process.env.PORTAL_PORT || 3500);
const ADMIN_APP = Number(process.env.ADMIN_APP_PORT || 3501);
const MAIL = process.env.MAIL || 'http://localhost:55724';
const DB = process.env.DB || 'postgres://postgres:postgres@localhost:55832/postgres';
const CADDY = process.env.CADDY_BIN;
const WORK = process.env.WORK || '/tmp/claude-0/eha/e2e';
const OUT = process.env.OUT || '/tmp/claude-0/streams/e-https-admin';
const STATUS = process.env.HTTPS_STATUS_FILE || path.join(WORK, 'status.json');
const HTTP = 18580, HTTPS = 18543, MEMBER = 18544, ADMIN_HTTP = 18581, ADMIN_HTTPS = 18545;
const CADDY_ADMIN = process.env.CADDY_ADMIN || 'localhost:12519';
const DOMAIN = 'portal.cc-https.test';
if (!CADDY) throw new Error('set CADDY_BIN to a caddy binary');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(WORK, 'member'), { recursive: true });
fs.rmSync(path.join(WORK, 'sites'), { recursive: true, force: true });
fs.mkdirSync(path.join(WORK, 'sites'), { recursive: true });
const confirmedDir = path.join(WORK, 'confirmed');
fs.mkdirSync(confirmedDir, { recursive: true });
for (const f of fs.readdirSync(confirmedDir)) fs.rmSync(path.join(confirmedDir, f));
fs.rmSync(STATUS, { force: true });
fs.writeFileSync(path.join(WORK, 'member', 'index.html'), '<h1>Member web app</h1>');
const rootCrt = path.join(WORK, 'storage/pki/authorities/local/root.crt');

const sql = (q) => execSync(`psql "${DB}" -v ON_ERROR_STOP=1 -Atc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function curl(args) {
  try { return execSync(`curl -sS -m 30 --noproxy '*' ${args}`, { stdio: ['ignore', 'pipe', 'pipe'] }).toString(); } catch (e) { return `CURL-ERROR ${e.stderr}`; }
}
const head = (url, host) => curl(`-o /dev/null -D - -H 'Host: ${host}' '${url}'`);
const resolve = (name, port) => `--resolve ${name}:${port}:127.0.0.1`;
const isAdmin = (html) => html.includes('Connect Admin');

async function mailCode(email, after) {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + email)}`).then((x) => x.json());
    const m = (r.messages || []).find((x) => new Date(x.Created).getTime() >= after);
    if (m) { const f = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((x) => x.json()); const c = (f.Text || '').match(/\b(\d{6,10})\b/); if (c) return c[1]; }
    await sleep(500);
  }
  throw new Error('no code for ' + email);
}
async function signIn(p, base, email) {
  sql(`delete from auth.mfa_factors where friendly_name like 'e2e %' and user_id = (select id from auth.users where email = '${email}')`);
  await p.goto(base + '/login', { waitUntil: 'networkidle' });
  const t0 = Date.now() - 2000;
  await p.fill('input[name=email]', email); await p.click('button[type=submit]');
  await p.waitForSelector('input[name=code]'); await p.fill('input[name=code]', await mailCode(email, t0));
  await p.click('button[type=submit]'); await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
}

async function confirm(overrides) {
  const cfg = {
    publicIp: '127.0.0.1', ipCert: true, siteDomain: null, portalPort: PORTAL, httpsPort: HTTPS, confirmedDir, statusFile: STATUS,
    caddyStorage: path.join(WORK, 'storage'), caddyVersion: execSync(`${CADDY} version`).toString().split(' ')[0], timeoutMs: 20000,
    resolveOverrides: overrides,
  };
  fs.writeFileSync(path.join(WORK, 'https.json'), JSON.stringify(cfg));
  const out = execSync(`node ${repo}/deploy/https-confirm.mjs --config ${path.join(WORK, 'https.json')}`, {
    env: { ...process.env, NODE_EXTRA_CA_CERTS: rootCrt },
  }).toString();
  process.stdout.write(out.trimEnd().replace(/^/gm, '    ') + '\n');
  return JSON.parse(fs.readFileSync(STATUS, 'utf8'));
}

(async () => {
  // ── Caddy with both deploys' generators (test ports, local CA) ──────────────
  const { buildCaddySites } = await import(path.join(repo, 'deploy/caddy-sites.mjs'));
  const { buildAppSites } = await import(path.join(adminRepo, 'deploy/caddy-sites.mjs'));
  const testing = { httpPort: HTTP, httpsPort: HTTPS, admin: CADDY_ADMIN, localCerts: true, storage: path.join(WORK, 'storage') };
  const portal = buildCaddySites({ app: 'crm', port: PORTAL, site: ':80', publicIp: '127.0.0.1', ipCert: true, memberRoot: path.join(WORK, 'member'), memberHttpsPort: MEMBER, confirmedDir, testing });
  const admin = buildAppSites({ app: 'admin', port: ADMIN_APP, site: `:${ADMIN_HTTP}`, httpsPort: ADMIN_HTTPS, publicIp: '127.0.0.1', ipCert: true, confirmedDir, testing });
  ok(Object.keys(admin.files).join() === 'admin.caddy' && !Object.keys(portal.files).includes('admin.caddy'), 'each deploy writes only its own site files (admin.caddy vs the portal\'s three)');
  for (const [n, t] of Object.entries({ ...portal.files, ...admin.files })) fs.writeFileSync(path.join(WORK, 'sites', n), t);
  fs.writeFileSync(path.join(WORK, 'Caddyfile'), `import ${path.join(WORK, 'sites')}/*.caddy\n`);
  ok(execSync(`${CADDY} validate --config ${path.join(WORK, 'Caddyfile')} --adapter caddyfile 2>&1`).toString().includes('Valid configuration'), 'the real Caddy accepts the portal\'s and the admin\'s files together');
  const caddy = spawn(CADDY, ['run', '--config', path.join(WORK, 'Caddyfile'), '--adapter', 'caddyfile'], { stdio: ['ignore', fs.openSync(path.join(WORK, 'caddy.log'), 'w'), 'pipe'] });
  caddy.stderr.on('data', () => {});
  let browser;
  try {
    for (let i = 0; i < 40 && !curl(`-o /dev/null -w '%{http_code}' http://127.0.0.1:${ADMIN_HTTP}/login`).startsWith('200'); i++) await sleep(250);
    sql(`delete from app.platform_settings where key = 'portal_domain'`);

    // ── Before any confirmation: today's addresses keep working ─────────────────
    const r0 = head(`http://127.0.0.1:${ADMIN_HTTP}/login`, '127.0.0.1');
    ok(/^HTTP\/1.1 200/.test(r0) && isAdmin(curl(`http://127.0.0.1:${ADMIN_HTTP}/login`)), 'http://<droplet IP>:8081 serves the event-day app (no redirect before a certificate is confirmed)');
    ok(/^HTTP\/1.1 200/.test(head(`http://127.0.0.1:${HTTP}/login`, '127.0.0.1')) && !isAdmin(curl(`http://127.0.0.1:${HTTP}/login`)), 'port 80 still serves the portal');
    const ipsHtml = curl(`--cacert ${rootCrt} https://127.0.0.1:${ADMIN_HTTPS}/login`);
    ok(isAdmin(ipsHtml), 'https://<droplet IP>:8444 serves the event-day app with the droplet address\'s certificate');
    ok(!/strict-transport-security/i.test(curl(`--cacert ${rootCrt} -o /dev/null -D - https://127.0.0.1:${ADMIN_HTTPS}/login`)), 'no HSTS before the address is confirmed');

    sql(`insert into app.platform_settings (key, value) values ('portal_domain', '"${DOMAIN}"') on conflict (key) do update set value = excluded.value`);
    ok(isAdmin(curl(`--cacert ${rootCrt} ${resolve(DOMAIN, ADMIN_HTTPS)} https://${DOMAIN}:${ADMIN_HTTPS}/login`)), 'the portal domain saved in Platform setup is served on 8444 at once (on-demand certificate, approved by the portal\'s tls-ask)');
    ok(curl(`-k ${resolve('stranger.test', ADMIN_HTTPS)} https://stranger.test:${ADMIN_HTTPS}/`).startsWith('CURL-ERROR'), 'no certificate on 8444 for a name the portal did not approve');
    ok(/^HTTP\/1.1 200/.test(head(`http://127.0.0.1:${ADMIN_HTTP}/login`, DOMAIN)), 'http://<domain>:8081 still serves (the domain is not confirmed yet)');

    // ── The portal's confirmer runs (the admin adds nothing to it) ──────────────
    const st = await confirm({ [DOMAIN]: ['127.0.0.1'] });
    const byName = (n) => st.names.find((x) => x.name === n);
    ok(byName(DOMAIN)?.confirmed === true && byName('127.0.0.1')?.confirmed === true, 'the confirmer verified the domain and the droplet address');
    const r1 = head(`http://127.0.0.1:${ADMIN_HTTP}/events?x=1`, DOMAIN);
    ok(/^HTTP\/1.1 308/.test(r1) && r1.includes(`Location: https://${DOMAIN}:${ADMIN_HTTPS}/events?x=1`), 'http://<domain>:8081 now redirects to https://<domain>:8444 (never to the portal\'s 443)');
    const r2 = head(`http://127.0.0.1:${ADMIN_HTTP}/login`, '127.0.0.1');
    ok(/^HTTP\/1.1 308/.test(r2) && r2.includes(`Location: https://127.0.0.1:${ADMIN_HTTPS}/login`), 'http://<droplet IP>:8081 redirects to https://<droplet IP>:8444 once the address is confirmed');
    const r3 = head(`http://127.0.0.1:${HTTP}/login`, DOMAIN);
    ok(/^HTTP\/1.1 308/.test(r3) && r3.includes(`Location: https://${DOMAIN}:${HTTPS}/login`), 'the portal\'s own redirect on port 80 is unchanged');
    ok(/strict-transport-security: max-age=2592000/i.test(curl(`--cacert ${rootCrt} -o /dev/null -D - ${resolve(DOMAIN, ADMIN_HTTPS)} https://${DOMAIN}:${ADMIN_HTTPS}/login`)), 'HSTS on the event-day app for the confirmed domain');

    // ── What HSTS does to the old address, and why 8444 exists (curl's HSTS cache = a browser's) ──
    const hsts = path.join(WORK, 'hsts.txt');
    fs.rmSync(hsts, { force: true });
    curl(`--hsts ${hsts} --cacert ${rootCrt} -o /dev/null ${resolve(DOMAIN, HTTPS)} https://${DOMAIN}:${HTTPS}/login`);
    ok(fs.existsSync(hsts) && fs.readFileSync(hsts, 'utf8').includes(DOMAIN), 'a visit to the portal pins the domain to HTTPS (HSTS is per host, every port)');
    const old = curl(`--hsts ${hsts} --cacert ${rootCrt} -o /dev/null -w '%{url_effective}' ${resolve(DOMAIN, ADMIN_HTTP)} http://${DOMAIN}:${ADMIN_HTTP}/login`);
    ok(old.startsWith('CURL-ERROR'), `after that, http://<domain>:8081 is upgraded to https://<domain>:8081 and fails (${old.trim().slice(0, 90)}) — the reason for a separate HTTPS port`);
    const neu = curl(`--hsts ${hsts} --cacert ${rootCrt} ${resolve(DOMAIN, ADMIN_HTTPS)} https://${DOMAIN}:${ADMIN_HTTPS}/login`);
    ok(isAdmin(neu), 'while https://<domain>:8444 keeps working with the domain pinned');
    ok(isAdmin(curl(`--hsts ${hsts} http://127.0.0.1:${ADMIN_HTTP}/login -L --cacert ${rootCrt}`)), 'and http://<droplet IP>:8081 keeps working (browsers never pin an IP address; it is redirected to 8444)');

    // ── In a browser: follow the redirect, sign in to the event-day app over HTTPS ──
    browser = await chromium.launch({ args: ['--proxy-server=direct://', '--proxy-bypass-list=*', `--host-resolver-rules=MAP ${DOMAIN} 127.0.0.1`] });
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(`http://${DOMAIN}:${ADMIN_HTTP}/login`, { waitUntil: 'networkidle' });
    ok(p.url().startsWith(`https://${DOMAIN}:${ADMIN_HTTPS}/login`), `the browser follows http://…:8081 to https://…:8444 (${p.url()})`);
    ok(await p.evaluate(() => window.isSecureContext && typeof crypto.randomUUID === 'function' && !!navigator.mediaDevices), 'secure context on 8444: the camera (check-in scanning) and crypto.randomUUID are available');
    await p.screenshot({ path: `${OUT}/admin-https-login.png`, fullPage: true });
    await signIn(p, `https://${DOMAIN}:${ADMIN_HTTPS}`, 'admin@jsh.test');
    await p.waitForLoadState('networkidle');
    await p.waitForSelector('main h1, main h2', { timeout: 30000 });
    const sb = (await ctx.cookies()).filter((c) => c.name.startsWith('sb-'));
    ok(sb.length > 0 && sb.every((c) => c.secure), `the event-day app's session cookies are Secure over HTTPS (${sb.map((c) => `${c.name}=${c.secure ? 'Secure' : 'NOT secure'}`).join(', ')})`);
    ok(new URL(p.url()).port === String(ADMIN_HTTPS) && isAdmin(await p.content()), `signed in to the event-day app on 8444 (${p.url()})`);
    await p.screenshot({ path: `${OUT}/admin-https-signed-in.png`, fullPage: true });

    const plain = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const q = await plain.newPage();
    await signIn(q, `http://localhost:${ADMIN_APP}`, 'admin@jsh.test');
    const sb2 = (await plain.cookies()).filter((c) => c.name.startsWith('sb-'));
    ok(sb2.length > 0 && sb2.every((c) => !c.secure), 'over plain http the event-day app\'s session cookie is not Secure (sign-in on http://…:8081 keeps working)');
    await plain.close();

    // ── DNS moves away: the redirect stops within a run, http://…:8081 serves again ──
    const st2 = await confirm({ [DOMAIN]: ['198.51.100.9'] });
    ok(st2.names.find((x) => x.name === DOMAIN)?.state === 'dns_elsewhere' && !fs.existsSync(path.join(confirmedDir, DOMAIN)), 'the domain\'s marker is removed');
    ok(/^HTTP\/1.1 200/.test(head(`http://127.0.0.1:${ADMIN_HTTP}/login`, DOMAIN)), 'http://<domain>:8081 serves the event-day app again instead of redirecting');
  } finally {
    if (browser) await browser.close();
    sql(`delete from app.platform_settings where key = 'portal_domain'`);
    try { execSync(`${CADDY} stop --address ${CADDY_ADMIN}`, { stdio: 'ignore' }); } catch (e) { console.error('caddy stop failed:', e.message); caddy.kill(); }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
