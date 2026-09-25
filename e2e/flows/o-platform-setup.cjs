// Onboarding Wave D · o-platform-setup — the Community Connect super admin's first sign-in wizard,
// end to end, against a real local stack (bash e2e/up.sh o-platform-setup 100) with the background
// service running and a LOCAL MOCK for the providers (e2e/mocks/platform-mock.cjs; fake keys, no network).
// Plain Node + Playwright; every step asserts the database and the audit rows.
//
//   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright BASE=http://localhost:3200 MAIL=http://localhost:55424 \
//   API=http://localhost:55421 DB=postgres://postgres:postgres@localhost:55532/postgres ENVF=e2e/.env.o-platform-setup \
//   WORKER_PW=<connect_worker password the portal was started with> node e2e/flows/o-platform-setup.cjs
//
// The portal runs with PORTAL_DATABASE_URL = the connect_worker URL and the mock's bases only
// (STRIPE_API_BASE / RESEND_API_BASE = http://127.0.0.1:4191) — NO provider keys in its environment.
// The worker is started here, also with no provider keys: everything it uses comes from the wizard.
//
// Journey:
//   1. A new platform admin signs in for the first time and lands on /platform/setup.
//   2. Required steps cannot be parked (no button; the API refuses).
//   3. Background service: live status from the worker's heartbeat → Mark done.
//   4. Payments: Stripe test key, Connect client id, webhook secret saved in the wizard (reason → fresh 2FA),
//      connect-link secret generated → Test → the WORKER called Stripe with the saved key (no env var) → Mark done.
//   5. The PORTAL uses the saved webhook secret too: a signed Stripe event is accepted (no env var).
//   6. Email: Resend key + sender saved, Test adds the platform's sending domain and shows its DNS records.
//   7. Park an optional step (AI) with a reason → who/when on the step and the reminder on the Platform home.
//   8. No value ever appears in a page, the audit log, a job, or a log line; reads are in secret_access_log.
//   9. An organization admin cannot open the wizard or save a platform key; once complete, no redirect.
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const { execSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createPlatformMock } = require('../mocks/platform-mock.cjs');

const BASE = process.env.BASE || 'http://localhost:3200';
const MAIL = process.env.MAIL || 'http://localhost:55424';
const API = process.env.API || 'http://localhost:55421';
const DB = process.env.DB || 'postgres://postgres:postgres@localhost:55532/postgres';
const OUT = process.env.OUT || '/tmp/claude-0/streams/o-platform-setup';
const ENVF = process.env.ENVF || path.join(__dirname, '..', '.env.o-platform-setup');
const MOCK_PORT = Number(process.env.MOCK_PORT || 4191);
const WORKER_JS = process.env.WORKER_JS || path.join(__dirname, '..', '..', 'worker', 'dist', 'server.js');
const WORKER_PW = process.env.WORKER_PW || process.env.WORKER_DB_PASSWORD;
const HEALTH_PORT = process.env.WORKER_HEALTH_PORT || '3310';
const KEYS = Object.fromEntries(fs.readFileSync(ENVF, 'utf8').trim().split('\n').map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
fs.mkdirSync(OUT, { recursive: true });
if (!WORKER_PW) { console.error('WORKER_PW (the connect_worker password the portal uses) is required'); process.exit(2); }

const sql = (q) => execSync(`psql "${DB}" -qAtX -v ON_ERROR_STOP=1`, { input: q }).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) { failures++; process.exitCode = 1; } };
async function until(fn, ms = 30000, every = 500) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(every); }
}
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }).catch(() => {});

// ── Sign-in codes and TOTP (as the other onboarding flows) ────────────────────
async function mailCode(email, after) {
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + email)}`).then((x) => x.json());
    const m = (r.messages || []).find((x) => new Date(x.Created).getTime() >= after);
    if (m) { const f = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((x) => x.json()); const c = ((f.Text || '') + ' ' + (f.HTML || '')).match(/\b(\d{6,10})\b/); if (c) return c[1]; }
    await sleep(500);
  }
  throw new Error('no sign-in code for ' + email);
}
const b32 = (s) => { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of s.replace(/=+$/, '').toUpperCase()) bits += a.indexOf(c).toString(2).padStart(5, '0'); const o = []; for (let i = 0; i + 8 <= bits.length; i += 8) o.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(o); };
let lastStep = -1;
async function freshTotp(secret) {
  while (Math.floor(Date.now() / 30000) === lastStep) await sleep(1000);
  lastStep = Math.floor(Date.now() / 30000);
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(lastStep));
  const h = crypto.createHmac('sha1', b32(secret)).update(buf).digest(); const o = h[h.length - 1] & 0xf;
  return ((h.readUInt32BE(o) & 0x7fffffff) % 1e6).toString().padStart(6, '0');
}
const anonH = { apikey: KEYS.ANON_KEY, 'content-type': 'application/json' };
const serviceH = { apikey: KEYS.SERVICE_KEY, authorization: `Bearer ${KEYS.SERVICE_KEY}`, 'content-type': 'application/json' };
async function apiLogin(email) {
  let t0 = Date.now() - 2000, r;
  for (let i = 0; i < 20; i++) {
    t0 = Date.now() - 2000;
    r = await fetch(`${API}/auth/v1/otp`, { method: 'POST', headers: anonH, body: JSON.stringify({ email, create_user: false }) });
    if (r.status !== 429) break;
    await sleep(5000);
  }
  if (r.status !== 200) throw new Error(`otp for ${email}: ${r.status}`);
  const s = await fetch(`${API}/auth/v1/verify`, { method: 'POST', headers: anonH, body: JSON.stringify({ type: 'email', email, token: await mailCode(email, t0) }) }).then((x) => x.json());
  if (!s.access_token) throw new Error(`verify for ${email}: ${JSON.stringify(s)}`);
  return s.access_token;
}
const userH = (token) => ({ ...anonH, authorization: `Bearer ${token}`, 'accept-profile': 'app', 'content-profile': 'app', 'x-client-app': 'portal', 'x-client-screen': 'e2e/o-platform-setup' });
const rpc = (token, fn, args) => fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: userH(token), body: JSON.stringify(args) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

async function portalLogin(b, email, totp) {
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  p.on('pageerror', (e) => console.log('   portal pageerror:', String(e).slice(0, 200)));
  let t0 = Date.now();
  for (let i = 0; i < 20; i++) {
    await p.goto(BASE + '/login'); t0 = Date.now() - 2000;
    await p.fill('input[name=email]', email); await p.click('button[type=submit]');
    if (await p.waitForSelector('input[name=code]', { timeout: 5000 }).then(() => true, () => false)) break;
    await sleep(5000);
  }
  await p.fill('input[name=code]', await mailCode(email, t0));
  await p.click('button[type=submit]');
  if (totp && await p.waitForSelector('input[name=totp]', { timeout: 10000 }).then(() => true, () => false)) { await p.fill('input[name=totp]', await freshTotp(totp)); await p.click('button[type=submit]'); }
  await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 });
  await p.waitForLoadState('networkidle').catch(() => {});
  return p;
}

async function maybeStepUp(p, secret) {
  const dlg = p.getByRole('dialog').filter({ hasText: 'Confirm it' });
  if (await dlg.waitFor({ timeout: 6000 }).then(() => true, () => false)) {
    await dlg.getByLabel('Code from your authenticator app').fill(await freshTotp(secret));
    await dlg.getByRole('button', { name: 'Verify and continue' }).click();
    await dlg.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    return true;
  }
  return false;
}

/** Save one field through the wizard's modal (value + reason), answering the fresh 2FA check. */
async function saveField(p, name, value, reason, totp) {
  const row = p.locator(`tr[data-field-row="${name}"]`);
  await row.locator(`button[data-field="${name}"]`).click();
  const dlg = p.getByRole('dialog').filter({ hasText: 'Reason (kept in the audit log)' });
  await dlg.waitFor({ timeout: 10000 });
  if (value !== null) {
    const input = dlg.locator('input[name=secret-value], input[name=setting-value], select').first();
    if ((await input.evaluate((el) => el.tagName)) === 'SELECT') await input.selectOption(value); else await input.fill(value);
  }
  await dlg.getByLabel('Reason (kept in the audit log)').fill(reason);
  await dlg.getByRole('button', { name: value === null ? 'Generate' : 'Save', exact: true }).click();
  await maybeStepUp(p, totp);
  await dlg.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
}

(async () => {
  const run = crypto.randomBytes(3).toString('hex');
  const ADMIN = `setup-${run}@platform.test`;
  const STRIPE_KEY = 'sk_test_mock_platform_key';
  const WHSEC = `whsec_e2e_setup_${run}_signing`;
  const RESEND_KEY = 're_mock_key_0001';

  // ── Test data: a fresh platform (no saved keys, no step done) and a new platform admin ─────────
  sql(`delete from app.platform_secrets; delete from app.platform_settings;
       update app.platform_setup_steps set status = 'not_started', parked_by = null, parked_at = null, completed_by = null, completed_at = null, note = null;
       update app.jobs set status = 'cancelled' where status in ('queued','running');
       delete from app.worker_heartbeats;`);
  await fetch(`${API}/auth/v1/admin/users`, { method: 'POST', headers: serviceH, body: JSON.stringify({ email: ADMIN, email_confirm: true }) });
  sql(`insert into app.accounts (user_id, is_platform_admin) select id, true from auth.users where email = '${ADMIN}' on conflict (user_id) do update set is_platform_admin = true`);
  const adminUid = sql(`select id from auth.users where email = '${ADMIN}'`);
  const mark = Number(sql('select coalesce(max(id), 0) from app.audit_log'));
  const logMark = Number(sql('select coalesce(max(id), 0) from app.secret_access_log'));
  const jobMark = Number(sql('select coalesce(max(id), 0) from app.jobs'));

  // ── The mock providers, and the worker with NO provider keys in its environment ──────────────
  const mock = createPlatformMock({ stripeKeys: [STRIPE_KEY], resendKeys: [RESEND_KEY] });
  const mockBase = await mock.listen(MOCK_PORT);
  const logs = [];
  const WORKER_ID = `e2e-platform-setup-${run}`;
  const worker = spawn(process.execPath, [WORKER_JS], {
    env: {
      PATH: process.env.PATH, WORKER_DATABASE_URL: `postgres://connect_worker:${WORKER_PW}@${new URL(DB).host}/postgres`, WORKER_ID,
      WORKER_HEALTH_PORT: HEALTH_PORT, WORKER_POLL_MS: '400', WORKER_HEARTBEAT_MS: '2000',
      STRIPE_API_BASE: mockBase, RESEND_API_BASE: mockBase, ANTHROPIC_BASE_URL: mockBase, TWILIO_API_BASE: mockBase,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', (d) => logs.push(...d.toString().trim().split('\n')));
  worker.stderr.on('data', (d) => logs.push(...d.toString().trim().split('\n')));
  const stop = async () => { worker.kill('SIGTERM'); await mock.close().catch(() => {}); };
  ok(await until(() => fetch(`http://127.0.0.1:${HEALTH_PORT}/health`).then((r) => r.status === 200).catch(() => false), 20000), 'the worker starts with no provider keys in its environment');

  const b = await chromium.launch();
  const pages = [];
  try {
    // The platform admin gets an authenticator app (GoTrue MFA) for the fresh 2FA checks.
    const aal1 = await apiLogin(ADMIN);
    const enroll = await fetch(`${API}/auth/v1/factors`, { method: 'POST', headers: { ...anonH, authorization: `Bearer ${aal1}` }, body: JSON.stringify({ factor_type: 'totp', friendly_name: `e2e setup ${run}` }) }).then((x) => x.json());
    const totp = enroll.totp && enroll.totp.secret;
    const ch = await fetch(`${API}/auth/v1/factors/${enroll.id}/challenge`, { method: 'POST', headers: { ...anonH, authorization: `Bearer ${aal1}` }, body: '{}' }).then((x) => x.json());
    const aal2 = (await fetch(`${API}/auth/v1/factors/${enroll.id}/verify`, { method: 'POST', headers: { ...anonH, authorization: `Bearer ${aal1}` }, body: JSON.stringify({ challenge_id: ch.id, code: await freshTotp(totp) }) }).then((x) => x.json())).access_token;
    ok(Boolean(totp && aal2), 'the platform admin has an authenticator app');

    // ── 1. First sign-in lands on the wizard ──────────────────────────────────────────────────
    const p = await portalLogin(b, ADMIN, totp);
    pages.push(p);
    await p.goto(BASE + '/', { waitUntil: 'networkidle' });
    ok(new URL(p.url()).pathname === '/platform/setup', `1 the first sign-in lands on the platform setup wizard (${new URL(p.url()).pathname})`);
    const main = await p.innerText('main');
    ok(/Platform setup/.test(main) && /4 required steps to go/.test(main), '1 the wizard says four required steps are left');
    await shot(p, '1-wizard-first-sign-in');

    // ── 2. Required steps cannot be parked ───────────────────────────────────────────────────
    await p.goto(BASE + '/platform/setup?step=email', { waitUntil: 'networkidle' });
    ok(await p.getByRole('button', { name: 'Park for later' }).count() === 0 && /Required — it cannot be parked/.test(await p.innerText('main')),
      '2 a required step has no "Park for later" and says why');
    const parkReq = await rpc(aal2, 'park_platform_setup_step', { p_key: 'email', p_reason: 'later' });
    ok(parkReq.status >= 400 && /cannot be parked/.test(JSON.stringify(parkReq.body)), '2 the database refuses to park a required step');

    // ── 3. Background service ────────────────────────────────────────────────────────────────
    await until(() => sql(`select count(*) from app.worker_heartbeats where worker = '${WORKER_ID}' and info ? 'platform_config'`) === '1', 20000);
    await p.goto(BASE + '/platform/setup?step=background', { waitUntil: 'networkidle' });
    ok(/Running · last reported in/.test(await p.innerText('main')) && /WORKER_DATABASE_URL/.test(await p.innerText('main')),
      '3 the background service step shows the live heartbeat and the WORKER_DATABASE_URL instructions');
    await p.getByRole('button', { name: 'Mark done' }).click();
    ok(await until(() => sql("select status from app.platform_setup_steps where key = 'background'") === 'done', 15000), '3 marked done after its live check passed');
    await shot(p, '3-background-done');

    // ── 4. Payments: keys saved in the wizard, tested by the WORKER with no env var ──────────
    await p.goto(BASE + '/platform/setup?step=payments', { waitUntil: 'networkidle' });
    await saveField(p, 'STRIPE_TEST_SECRET_KEY', STRIPE_KEY, `Stripe test key for the platform ${run}`, totp);
    ok(await until(() => sql("select fingerprint from app.platform_secrets where name = 'STRIPE_TEST_SECRET_KEY'") === STRIPE_KEY.slice(-4), 15000),
      '4 the Stripe test key is in the vault; the app keeps its last 4 characters');
    await p.reload({ waitUntil: 'networkidle' });
    await saveField(p, 'STRIPE_CLIENT_ID', 'ca_e2e_platform_client', 'Stripe Connect client id', totp);
    await p.reload({ waitUntil: 'networkidle' });
    await saveField(p, 'STRIPE_WEBHOOK_SECRET', WHSEC, 'Stripe webhook secret', totp);
    await p.reload({ waitUntil: 'networkidle' });
    await saveField(p, 'OAUTH_STATE_SECRET', null, 'Generated by the setup wizard', totp);
    ok(await until(() => sql("select count(*) from app.platform_secrets where name in ('STRIPE_TEST_SECRET_KEY','STRIPE_WEBHOOK_SECRET','OAUTH_STATE_SECRET')") === '3'
      && sql("select value #>> '{}' from app.platform_settings where key = 'STRIPE_CLIENT_ID'") === 'ca_e2e_platform_client', 15000),
      '4 client id, webhook secret and a generated connect-link secret are saved');
    const auditSave = sql(`select coalesce(module,'') || '|' || coalesce(client_app,'') || '|' || coalesce(client_screen,'') || '|' || coalesce(reason,'') || '|' || actor_user_id
                             from app.audit_log where id > ${mark} and action = 'platform_secrets.insert' and record_id = 'STRIPE_TEST_SECRET_KEY' order by id desc limit 1`);
    ok(auditSave === `|portal|/platform/setup|Stripe test key for the platform ${run}|${adminUid}`, `4 audit: portal, /platform/setup, the reason and the admin (${auditSave})`);
    // The worker picks the saved values up (<= 60 s; its heartbeat reports the names, never values).
    ok(await until(() => sql(`select info->'platform_config'->'saved' ? 'STRIPE_TEST_SECRET_KEY' from app.worker_heartbeats where worker = '${WORKER_ID}'`) === 't', 75000, 1000),
      '4 the worker now uses the key saved in the wizard (heartbeat: names only)');
    await p.reload({ waitUntil: 'networkidle' });
    ok(/uses the saved value/.test(await p.locator('tr[data-field-row="STRIPE_TEST_SECRET_KEY"]').innerText()), '4 the wizard shows both servers use the saved value');
    const before = mock.state.requests.length;
    await p.getByRole('button', { name: 'Test', exact: true }).click();
    const tested = await until(() => sql(`select status || '|' || coalesce(result->>'ok','') from app.jobs where id > ${jobMark} and kind = 'platform.test_provider' and payload->>'step' = 'payments' order by id desc limit 1`).match(/^done\|true$/), 30000);
    ok(Boolean(tested), '4 the worker ran the payments test and it passed');
    ok(mock.state.requests.slice(before).some((r) => r.path === '/v1/balance' && r.auth === `Bearer ${STRIPE_KEY}`),
      '4 the worker called Stripe with the key saved in the wizard — it has no STRIPE_* in its environment');
    await p.reload({ waitUntil: 'networkidle' });
    await shot(p, '4-payments-tested');
    await p.getByRole('button', { name: 'Mark done' }).click();
    ok(await until(() => sql("select status from app.platform_setup_steps where key = 'payments'") === 'done', 15000), '4 payments marked done');

    // ── 5. The PORTAL reads the saved webhook secret (no env var) ─────────────────────────────
    const event = JSON.stringify({ id: `evt_setup_${run}`, type: 'account.updated', data: { object: { id: 'acct_unknown_setup' } } });
    const ts = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', WHSEC).update(`${ts}.${event}`).digest('hex');
    const hook = await fetch(`${BASE}/api/webhooks/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${ts},v1=${sig}` }, body: event });
    ok(hook.status === 200, `5 the portal accepts a Stripe event signed with the webhook secret saved in the wizard (${hook.status})`);
    const badSig = crypto.createHmac('sha256', 'whsec_wrong').update(`${ts}.${event}`).digest('hex');
    const bad = await fetch(`${BASE}/api/webhooks/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${ts},v1=${badSig}` }, body: event });
    ok(bad.status === 400, '5 and refuses one signed with another secret');
    ok(sql(`select count(*) from app.secret_access_log where id > ${logMark} and name = 'platform:STRIPE_WEBHOOK_SECRET' and purpose like 'portal server%'`) !== '0'
      && sql(`select count(*) from app.secret_access_log where id > ${logMark} and name = 'platform:STRIPE_TEST_SECRET_KEY' and reader = '${WORKER_ID}'`) !== '0',
      '5 both reads (portal server and worker) are in secret_access_log');

    // ── 6. Email: the platform's sending domain and its DNS records ───────────────────────────
    await p.goto(BASE + '/platform/setup?step=email', { waitUntil: 'networkidle' });
    await saveField(p, 'RESEND_API_KEY', RESEND_KEY, 'Resend key', totp);
    await p.reload({ waitUntil: 'networkidle' });
    await saveField(p, 'MESSAGING_FROM_ADDRESS', `no-reply@mail-${run}.communityconnect.test`, 'Platform sender', totp);
    await p.reload({ waitUntil: 'networkidle' });
    await saveField(p, 'MESSAGING_LINK_SECRET', null, 'Generated by the setup wizard', totp);
    await until(() => sql(`select info->'platform_config'->'saved' ? 'RESEND_API_KEY' from app.worker_heartbeats where worker = '${WORKER_ID}'`) === 't', 75000, 1000);
    await p.reload({ waitUntil: 'networkidle' });
    await p.getByRole('button', { name: 'Test', exact: true }).click();
    await until(() => sql(`select status from app.jobs where id > ${jobMark} and kind = 'platform.test_provider' and payload->>'step' = 'email' order by id desc limit 1`) === 'done', 30000);
    await p.reload({ waitUntil: 'networkidle' });
    const emailText = await p.innerText('main');
    ok(/Resend accepts the API key/.test(emailText) && new RegExp(`resend\\._domainkey\\.mail-${run}\\.communityconnect\\.test`).test(emailText),
      '6 the test adds the platform sending domain to Resend and shows its DNS records');
    ok(/waiting for DNS|put the records below/.test(emailText) && await p.getByRole('button', { name: 'Mark done' }).isDisabled(),
      '6 email cannot be marked done until the domain is verified');
    await shot(p, '6-email-dns-records');

    // ── 7. Park an optional step ───────────────────────────────────────────────────────────────
    await p.goto(BASE + '/platform/setup?step=ai', { waitUntil: 'networkidle' });
    await p.getByRole('button', { name: 'Park for later' }).click();
    const dlg = p.getByRole('dialog').filter({ hasText: 'Park' });
    await dlg.getByLabel('Reason (kept in the audit log)').fill(`No Anthropic account yet ${run}`);
    await dlg.getByRole('button', { name: 'Park it' }).click();
    ok(await until(() => sql(`select status || '|' || parked_by from app.platform_setup_steps where key = 'ai'`) === `parked|${adminUid}`, 15000), '7 AI is parked, with who');
    ok(sql(`select reason from app.audit_log where id > ${mark} and action = 'platform_setup_steps.update' and record_id = 'ai' order by id desc limit 1`) === `No Anthropic account yet ${run}`,
      '7 parking is audited with the reason');
    await p.reload({ waitUntil: 'networkidle' });
    ok(/Parked by you on/.test(await p.innerText('main')), '7 the step shows who parked it and when');
    await p.goto(BASE + '/platform', { waitUntil: 'networkidle' });
    const home = await p.locator('[data-setup-reminder]').innerText().catch(() => '');
    ok(/Platform setup is not finished/.test(home) && /AI \(Niva and suggestions\)/.test(home) && home.includes(`No Anthropic account yet ${run}`),
      '7 the Platform home reminds of the parked step and the required ones left');
    await shot(p, '7-platform-home-reminder');

    // ── 8. No value anywhere ──────────────────────────────────────────────────────────────────
    let html = '';
    for (const s of ['background', 'portal', 'email', 'hooks', 'payments', 'texting', 'quickbooks', 'ai', 'push', 'wildcard']) {
      await p.goto(`${BASE}/platform/setup?step=${s}`, { waitUntil: 'networkidle' });
      html += await p.content();
    }
    const secrets = [STRIPE_KEY, WHSEC, RESEND_KEY];
    const generated = sql("select string_agg(decrypted_secret, '|') from vault.decrypted_secrets where name in ('connect/platform/OAUTH_STATE_SECRET','connect/platform/MESSAGING_LINK_SECRET')").split('|');
    ok(generated.length === 2 && generated.every((g) => g.length >= 32), '8 the generated secrets are long random values in the vault');
    const all = [...secrets, ...generated];
    ok(!all.some((v) => html.includes(v)), '8 no key appears in any wizard page');
    ok(sql(`select count(*) from app.audit_log where id > ${mark} and (${all.map((v) => `coalesce(before::text,'') || coalesce(after::text,'') like '%${v}%'`).join(' or ')})`) === '0',
      '8 no key appears in the audit log');
    ok(sql(`select count(*) from app.jobs where kind = 'platform.test_provider' and (${all.map((v) => `coalesce(payload::text,'') || coalesce(result::text,'') || coalesce(last_error,'') like '%${v}%'`).join(' or ')})`) === '0',
      '8 no key appears in a job payload or result');
    ok(!all.some((v) => logs.join('\n').includes(v)), '8 no key appears in the worker log');

    // ── 9. Organization admins cannot; complete means no more redirect ────────────────────────
    const orgAdmin = await apiLogin('admin@jsh.test');
    const refused = await rpc(orgAdmin, 'set_platform_secret', { p_name: 'ANTHROPIC_API_KEY', p_value: 'sk-ant-should-not-save', p_reason: 'x' });
    ok(refused.status >= 400 && /platform admins/.test(JSON.stringify(refused.body)), '9 an organization admin cannot save a platform key');
    const peek = await fetch(`${API}/rest/v1/platform_secrets?select=name`, { headers: userH(orgAdmin) }).then((r) => r.json());
    ok(Array.isArray(peek) && peek.length === 0, '9 nor see which platform keys exist');
    const op = await portalLogin(b, 'admin@jsh.test', null);
    pages.push(op);
    await op.goto(BASE + '/platform/setup', { waitUntil: 'networkidle' });
    ok(!/Keys and settings/.test(await op.innerText('main')), '9 the wizard is not shown to an organization admin');
    await op.goto(BASE + '/', { waitUntil: 'networkidle' });
    ok(new URL(op.url()).pathname === '/', '9 an organization admin is never redirected to the wizard');

    // The rest needs the owner's DNS records and the Supabase hook switch, which a local stack cannot give:
    // mark them done in the database (test data only) and park the other optional steps.
    sql(`update app.platform_setup_steps set status = 'done', completed_by = '${adminUid}', completed_at = now() where key in ('portal','email','hooks');
         update app.platform_setup_steps set status = 'parked', parked_by = '${adminUid}', parked_at = now(), note = 'e2e' where status = 'not_started';`);
    await p.goto(BASE + '/', { waitUntil: 'networkidle' });
    ok(new URL(p.url()).pathname === '/', '9 once required steps are done and optional ones done or parked, sign-in goes to Home');
    await p.goto(BASE + '/platform/setup', { waitUntil: 'networkidle' });
    ok(/Setup complete/.test(await p.innerText('main')), '9 the wizard says setup is complete');
    await shot(p, '9-setup-complete');
  } catch (err) {
    console.error('FLOW ERROR', err);
    failures++;
    process.exitCode = 1;
    for (const pg of pages) await shot(pg, `error-${pages.indexOf(pg)}`);
  } finally {
    await b.close();
    await stop();
    if (process.env.KEEP_PLATFORM_SETUP !== '1') {
      // Test data only: the provider values this run saved go away again (the steps stay done / parked), so the
      // servers are back on their own environment for whatever runs next on this stack. The portal and the worker
      // cache saved values for up to 60 s: wait that out.
      sql(`delete from app.platform_secrets; delete from app.platform_settings;`);
      console.log('… removed the values this run saved; waiting 65 s for the servers\' 60 s cache');
      await sleep(65000);
    }
    fs.writeFileSync(`${OUT}/worker.log`, logs.join('\n'));
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
})();
