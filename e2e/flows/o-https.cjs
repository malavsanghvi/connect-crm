// HTTPS for the portal (stream o-https), end to end against a real stack, a real
// Caddy and the real HTTPS confirmer. Only ports and the certificate authority
// differ from the droplet: Caddy listens on 18480 (http) / 18443 (https) / 18444
// (member app) and issues from its own local CA instead of Let's Encrypt.
//
//   bash e2e/up.sh o-https 400
//   set -a; . e2e/.env.o-https; set +a
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:55721 NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY pnpm build
//   PORT=3500 PORTAL_BASE_DOMAIN=orgs-https.test HTTPS_STATUS_FILE=/tmp/claude-0/o-https/e2e/status.json \
//     NEXT_PUBLIC_SUPABASE_URL=http://localhost:55721 NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY pnpm start
//   CADDY_BIN=/path/to/caddy node e2e/flows/o-https.cjs
//
// Chromium resolves the test names to 127.0.0.1 (--host-resolver-rules); the confirmer gets the
// same answers through its resolveOverrides (test-only). No /etc/hosts change, no real DNS or ACME.
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '../..');
const PORTAL = Number(process.env.PORTAL_PORT || 3500);
const MAIL = process.env.MAIL || 'http://localhost:55724';
const DB = process.env.DB || 'postgres://postgres:postgres@localhost:55832/postgres';
const CADDY = process.env.CADDY_BIN;
const WORK = process.env.WORK || '/tmp/claude-0/o-https/e2e';
const OUT = process.env.OUT || '/tmp/claude-0/streams/o-https';
const STATUS = process.env.HTTPS_STATUS_FILE || path.join(WORK, 'status.json');
const HTTP = Number(process.env.CADDY_HTTP_PORT || 18480), HTTPS = Number(process.env.CADDY_HTTPS_PORT || 18443);
const MEMBER = Number(process.env.CADDY_MEMBER_PORT || 18444), ADMIN = process.env.CADDY_ADMIN || 'localhost:12419';
// The portal's PORTAL_BASE_DOMAIN (a shared stack's portal may already have one).
const ORGS = process.env.ORGS_DOMAIN || 'orgs-https.test';
const DOMAIN = 'portal.cc-https.test';
if (!CADDY) throw new Error('set CADDY_BIN to a caddy binary');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(WORK, 'sites'), { recursive: true });
fs.mkdirSync(path.join(WORK, 'member'), { recursive: true });
const confirmedDir = path.join(WORK, 'confirmed');
fs.mkdirSync(confirmedDir, { recursive: true });
for (const f of fs.readdirSync(confirmedDir)) fs.rmSync(path.join(confirmedDir, f));
fs.rmSync(STATUS, { force: true });
fs.writeFileSync(path.join(WORK, 'member', 'index.html'), '<h1>Member web app</h1>');

const sql = (q) => execSync(`psql "${DB}" -v ON_ERROR_STOP=1 -Atc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function curl(args) {
  try { return execSync(`curl -sS -m 30 --noproxy '*' ${args}`, { stdio: ['ignore', 'pipe', 'pipe'] }).toString(); } catch (e) { return `CURL-ERROR ${e.stderr}`; }
}
const head = (url, host) => curl(`-o /dev/null -D - -H 'Host: ${host}' '${url}'`);
const resolve = (name, port) => `--resolve ${name}:${port}:127.0.0.1`;

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
    env: { ...process.env, NODE_EXTRA_CA_CERTS: path.join(WORK, 'storage/pki/authorities/local/root.crt') },
  }).toString();
  process.stdout.write(out.replace(/^/gm, '    '));
  return JSON.parse(fs.readFileSync(STATUS, 'utf8'));
}

(async () => {
  // ── Caddy with the deploy's own generator (test ports, local CA) ─────────────
  const { buildCaddySites } = await import(path.join(repo, 'deploy/caddy-sites.mjs'));
  const gen = buildCaddySites({
    app: 'crm', port: PORTAL, site: ':80', publicIp: '127.0.0.1', ipCert: true, memberRoot: path.join(WORK, 'member'), memberHttpsPort: MEMBER,
    confirmedDir, testing: { httpPort: HTTP, httpsPort: HTTPS, admin: ADMIN, localCerts: true, storage: path.join(WORK, 'storage') },
  });
  for (const [n, t] of Object.entries(gen.files)) fs.writeFileSync(path.join(WORK, 'sites', n), t);
  fs.writeFileSync(path.join(WORK, 'Caddyfile'), `import ${path.join(WORK, 'sites')}/*.caddy\n`);
  const caddy = spawn(CADDY, ['run', '--config', path.join(WORK, 'Caddyfile'), '--adapter', 'caddyfile'], { stdio: ['ignore', fs.openSync(path.join(WORK, 'caddy.log'), 'w'), 'pipe'] });
  caddy.stderr.on('data', () => {});
  let browser;
  let wasPlatformAdmin = null;
  try {
    for (let i = 0; i < 40 && !curl(`-o /dev/null -w '%{http_code}' http://127.0.0.1:${HTTP}/login`).startsWith('200'); i++) await sleep(250);

    // ── Before any domain: the bare address keeps serving over http ─────────────
    sql(`create table if not exists app.platform_settings (key text primary key, value jsonb, set_by uuid, set_at timestamptz default now())`);
    sql(`delete from app.platform_settings where key = 'portal_domain'`);
    ok(/^HTTP\/1.1 200/.test(head(`http://127.0.0.1:${HTTP}/login`, '127.0.0.1')), 'http:// on the bare address serves the portal (no redirect before a certificate is confirmed)');
    const ask = (d) => curl(`-o /dev/null -w '%{http_code}' 'http://127.0.0.1:${PORTAL}/api/tenancy/tls-ask?domain=${d}'`);
    ok(ask(DOMAIN) === '404', 'tls-ask refuses the portal domain before it is saved');
    ok(ask(`jsh.${ORGS}`) === '200', 'tls-ask approves <slug>.<PORTAL_BASE_DOMAIN> of a real community');
    ok(ask(`nobody.${ORGS}`) === '404' && ask('127.0.0.1') === '404' && ask('evil.example.com') === '404', 'tls-ask refuses unknown slugs, IPs and strangers');

    // ── Platform setup saves the portal domain: no redeploy from here on ────────
    sql(`insert into app.platform_settings (key, value) values ('portal_domain', '"${DOMAIN}"') on conflict (key) do update set value = excluded.value`);
    ok(ask(DOMAIN) === '200', 'tls-ask approves the saved portal domain immediately');
    ok(JSON.parse(curl(`http://127.0.0.1:${PORTAL}/api/tenancy/https-names`)).names.includes(DOMAIN), 'the confirmer is told about the saved domain');
    ok(/^HTTP\/1.1 200/.test(head(`http://127.0.0.1:${HTTP}/login`, DOMAIN)), 'http:// on the new domain still serves (not confirmed yet)');

    let st = await confirm({ [DOMAIN]: ['127.0.0.1'] });
    const byName = (n) => st.names.find((x) => x.name === n);
    ok(byName(DOMAIN)?.confirmed === true, 'the confirmer made Caddy issue the new domain\'s certificate on demand and verified it');
    ok(byName('127.0.0.1')?.confirmed === true, 'the bare address has a verified certificate');
    ok(byName(ORGS)?.state === 'dns_missing', `a name without DNS says so: ${byName(ORGS)?.reason}`);
    ok(fs.existsSync(path.join(confirmedDir, DOMAIN)), 'a confirmation marker exists for the domain');

    const r1 = head(`http://127.0.0.1:${HTTP}/people?x=1`, DOMAIN);
    ok(/^HTTP\/1.1 308/.test(r1) && r1.includes(`Location: https://${DOMAIN}:${HTTPS}/people?x=1`), 'http:// now redirects to https:// for the confirmed domain');
    ok(/^HTTP\/1.1 200/.test(head(`http://127.0.0.1:${HTTP}/login`, `jsh.${ORGS}`)), 'an unconfirmed organization address is not redirected');
    const h1 = curl(`-k -o /dev/null -D - ${resolve(DOMAIN, HTTPS)} https://${DOMAIN}:${HTTPS}/login`);
    ok(/strict-transport-security: max-age=2592000/i.test(h1), 'HSTS on the confirmed domain');
    const h2 = curl(`-k -o /dev/null -D - ${resolve(`jsh.${ORGS}`, HTTPS)} https://jsh.${ORGS}:${HTTPS}/login`);
    ok(/^HTTP\/[12](\.1)? 200/.test(h2) && !/strict-transport-security/i.test(h2), 'an organization subdomain gets an on-demand certificate, without HSTS until confirmed');
    ok(curl(`-k ${resolve('stranger.test', HTTPS)} https://stranger.test:${HTTPS}/`).startsWith('CURL-ERROR'), 'no certificate for a name the portal did not approve');
    ok(curl(`-k https://127.0.0.1:${MEMBER}/join/ABC`).includes('Member web app'), 'the member web app is served over HTTPS on its own port');

    // ── In a browser: secure context, Secure cookie, Platform › HTTPS ───────────
    // admin@jsh.test is a platform admin for this part only (test login); put back afterwards so the
    // other flows on a shared stack keep an organization admin.
    wasPlatformAdmin = sql(`select coalesce((select is_platform_admin::text from app.accounts a join auth.users u on u.id = a.user_id where u.email = 'admin@jsh.test'), 'none')`);
    sql(`insert into app.accounts (user_id, is_platform_admin) select id, true from auth.users where email = 'admin@jsh.test' on conflict (user_id) do update set is_platform_admin = true`);
    browser = await chromium.launch({ args: ["--proxy-server=direct://", "--proxy-bypass-list=*", `--host-resolver-rules=MAP ${DOMAIN} 127.0.0.1, MAP *.${ORGS} 127.0.0.1`] });
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(`http://${DOMAIN}:${HTTP}/login`, { waitUntil: 'networkidle' });
    ok(p.url().startsWith(`https://${DOMAIN}:${HTTPS}/login`), `the browser follows http:// to https:// (${p.url()})`);
    ok(await p.evaluate(() => window.isSecureContext && typeof crypto.randomUUID === 'function'), 'secure context: crypto.randomUUID is available for sign-in');
    await signIn(p, `https://${DOMAIN}:${HTTPS}`, 'admin@jsh.test');
    const sb = (await ctx.cookies()).filter((c) => c.name.startsWith('sb-'));
    ok(sb.length > 0 && sb.every((c) => c.secure), `session cookies are Secure over HTTPS (${sb.map((c) => `${c.name}=${c.secure ? 'Secure' : 'NOT secure'}`).join(', ')})`);
    await p.goto(`https://${DOMAIN}:${HTTPS}/platform/https`, { waitUntil: 'networkidle' });
    const text = await p.textContent('main');
    ok(text.includes(`HTTPS works on ${DOMAIN}`), 'Platform › HTTPS says HTTPS works on the saved domain');
    await p.screenshot({ path: `${OUT}/platform-https-ok.png`, fullPage: true });

    const plain = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const q = await plain.newPage();
    await signIn(q, `http://localhost:${PORTAL}`, 'admin@jsh.test');
    const sb2 = (await plain.cookies()).filter((c) => c.name.startsWith('sb-'));
    ok(sb2.length > 0 && sb2.every((c) => !c.secure), 'over plain http the session cookie is not Secure (sign-in keeps working)');
    await plain.close();

    // ── DNS moves away: the redirect stops within a run, http keeps working ─────
    st = await confirm({ [DOMAIN]: ['198.51.100.9'] });
    ok(byName(DOMAIN)?.state === 'dns_elsewhere' && byName(DOMAIN).reason.includes('198.51.100.9'), `the reason names the wrong address: ${byName(DOMAIN)?.reason}`);
    ok(!fs.existsSync(path.join(confirmedDir, DOMAIN)), 'the marker is removed');
    ok(/^HTTP\/1.1 200/.test(head(`http://127.0.0.1:${HTTP}/login`, DOMAIN)), 'http:// serves again instead of redirecting to a broken https://');
    await p.goto(`https://${DOMAIN}:${HTTPS}/platform/https`, { waitUntil: 'networkidle' });
    const text2 = await p.textContent('main');
    ok(text2.includes(`${DOMAIN} is not on HTTPS yet`) && text2.includes('198.51.100.9'), 'Platform › HTTPS says exactly why');
    await p.screenshot({ path: `${OUT}/platform-https-dns-elsewhere.png`, fullPage: true });
  } finally {
    if (browser) await browser.close();
    sql(`delete from app.platform_settings where key = 'portal_domain'`);
    if (wasPlatformAdmin === 'false' || wasPlatformAdmin === 'none') sql(`update app.accounts set is_platform_admin = false where user_id = (select id from auth.users where email = 'admin@jsh.test')`);
    try { execSync(`${CADDY} stop --address ${ADMIN}`, { stdio: 'ignore' }); } catch (e) { console.error('caddy stop failed:', e.message); caddy.kill(); }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
