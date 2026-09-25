// Organization onboarding · o-payments — Stripe and PayPal per organization, end to end, against a
// real local stack (bash e2e/up.sh o-payments 200) with the background service running and LOCAL MOCK
// providers (e2e/mocks/payments-mock.cjs on :4390; fake keys, no network). Plain Node + Playwright;
// every step asserts the database and the audit rows.
//
//   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright BASE=http://localhost:3300 MEMBER=http://localhost:8400 \
//   MAIL=http://localhost:55524 API=http://localhost:55521 DB=postgres://postgres:postgres@localhost:55632/postgres \
//   ENVF=e2e/.env.o-payments node e2e/flows/o-payments.cjs
//
// The portal must run with the mock's bases and fake keys (STRIPE_TEST_SECRET_KEY, STRIPE_CLIENT_ID,
// STRIPE_WEBHOOK_SECRET=whsec_e2e_fake, STRIPE_API_BASE/STRIPE_CONNECT_BASE=http://localhost:4390,
// PAYPAL_SANDBOX_* with PAYPAL_SANDBOX_WEBHOOK_ID=WH-E2E-FAKE, PAYPAL_PARTNER_ID, PORTAL_DATABASE_URL = the connect_worker URL for the webhook routes)
// and the member app exported with EXPO_PUBLIC_PORTAL_URL=<BASE>. The worker is started here.
//
// Journey (JSH is switched to a SANDBOX for the run, then back):
//   1. Settings › Payments: Connect Stripe (reason → fresh 2FA → Stripe Connect → callback → vault →
//      oauth.exchange by the worker) → test mode, account recorded; methods, descriptor, default.
//   2. A sandbox refuses live mode (CCENT) and has no "Switch to live".
//   3. Offline methods: accept Check with its instructions.
//   4. PayPal Business email: without the messaging service the screen says so; no code is made.
//   5. The $1 test: provider page → signed webhook → worker refunds it → payment_processor_tests; no gift.
//   6. Member app: Give › How to give shows Check; Pay open pledges → Stripe (test mode) → paid via the
//      signed webhook → payments / allocations / postings / audit; a replayed webhook changes nothing.
//   7. Refund through Stripe after two approvers (portal button, fresh 2FA) → refunded_cents.
//   8. Connect with PayPal (partner) → the worker checks the merchant; a member PayPal checkout through the
//      route is captured by the worker from the approval webhook.
//   9. A payout webhook → app.payouts and the payments carry it; Setup steps; readiness 6; Giving switch.
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const { acceptLegalStep } = require('../legal-step.cjs');
const { execSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createPaymentsMock } = require('../mocks/payments-mock.cjs');

const BASE = process.env.BASE || 'http://localhost:3300';
const MEMBER = process.env.MEMBER || 'http://localhost:8400';
const MAIL = process.env.MAIL || 'http://localhost:55524';
const API = process.env.API || 'http://localhost:55521';
const DB = process.env.DB || 'postgres://postgres:postgres@localhost:55632/postgres';
const OUT = process.env.OUT || '/tmp/claude-0/streams/o-payments';
const ENVF = process.env.ENVF || path.join(__dirname, '..', '.env.o-payments');
const MOCK_PORT = Number(process.env.MOCK_PORT || 4390);
const HEALTH_PORT = process.env.WORKER_HEALTH_PORT || '3510';
const WORKER_JS = process.env.WORKER_JS || path.join(__dirname, '..', '..', 'worker', 'dist', 'server.js');
const KEYS = Object.fromEntries(fs.readFileSync(ENVF, 'utf8').trim().split('\n').map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
fs.mkdirSync(OUT, { recursive: true });

const sql = (q) => execSync(`psql "${DB}" -qAtX -v ON_ERROR_STOP=1`, { input: q }).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) { failures++; process.exitCode = 1; } };
async function until(fn, ms = 30000, every = 500) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(every); }
}
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }).catch(() => {});

// ── Sign-in codes and TOTP (as e2e/flows/o-vault.cjs) ───────────────────────
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
const userH = (token) => ({ ...anonH, authorization: `Bearer ${token}`, 'accept-profile': 'app', 'content-profile': 'app', 'x-client-app': 'portal', 'x-client-screen': 'e2e/o-payments' });
const rpc = (token, fn, args) => fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: userH(token), body: JSON.stringify(args) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

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
/** The Settings › Payments reason prompt. */
async function giveReason(p, reason, confirm) {
  const dlg = p.getByRole('dialog').filter({ hasText: 'Reason (kept in the audit log)' });
  await dlg.waitFor({ timeout: 10000 });
  await dlg.getByLabel('Reason (kept in the audit log)').fill(reason);
  await dlg.getByRole('button', { name: confirm }).click();
}
const audit = (mark, action) => sql(`select coalesce(module,'') || '|' || coalesce(client_app,'') || '|' || coalesce(client_screen,'') || '|' || coalesce(reason,'')
                                      from app.audit_log where id > ${mark} and action = '${action}' order by id desc limit 1`);
const card = (p, title) => p.locator('section.cc-card').filter({ has: p.getByRole('heading', { name: title, exact: true }) });

(async () => {
  const run = crypto.randomBytes(3).toString('hex');
  const jsh = sql("select id from app.centers where slug = 'jsh'");
  const adminUid = sql("select id from auth.users where email = 'admin@jsh.test'");
  const kiranUid = sql("select id from auth.users where email = 'kiran@jsh.test'");
  const priyaHH = sql("select hm.household_id from app.household_members hm join app.people pe on pe.id = hm.person_id where pe.email = 'priya@jsh.test' and hm.left_at is null limit 1");

  // ── Test data: a sandbox JSH with nothing connected ─────────────────────
  const envBefore = sql(`select environment from app.centers where id = '${jsh}'`);
  sql(`update app.centers set environment = 'sandbox' where id = '${jsh}'`);
  sql(`update app.integration_connections set status = 'disconnected', external_account_id = null, settings = '{}' where center_id = '${jsh}' and provider in ('stripe','paypal');
       update app.center_payment_processors set status = 'not_connected', is_default = false where center_id = '${jsh}';
       update app.center_payment_methods set accepted = false where center_id = '${jsh}';
       update app.centers set rules = jsonb_set(coalesce(rules,'{}'), '{payments}', '{"offline_only": false}') where id = '${jsh}';
       update app.jobs set status = 'cancelled' where status in ('queued','running');
       insert into app.pledges (center_id, household_id, source, amount_cents) values ('${jsh}', '${priyaHH}', 'general', 7500);`);   // an open pledge to pay
  const mark = Number(sql('select coalesce(max(id), 0) from app.audit_log'));
  const startTs = sql('select now()');

  // ── Mock providers, and the worker (connect_worker) pointed at them ──────
  const mock = createPaymentsMock({ portal: BASE, stripeWebhookSecret: 'whsec_e2e_fake', paypalWebhookId: 'WH-E2E-FAKE' });
  const mockBase = await mock.listen(MOCK_PORT);
  const workerPw = process.env.WORKER_DB_PASSWORD || crypto.randomBytes(24).toString('hex');   // a shared stack passes the portal's connect_worker password
  sql(`alter role connect_worker with password '${workerPw}'`);
  const logs = [];
  const worker = spawn(process.execPath, [WORKER_JS], {
    env: {
      PATH: process.env.PATH, WORKER_DATABASE_URL: `postgres://connect_worker:${workerPw}@${new URL(DB).host}/postgres`, WORKER_ID: `e2e-payments-${run}`,
      WORKER_HEALTH_PORT: HEALTH_PORT, WORKER_POLL_MS: '400', WORKER_HEARTBEAT_MS: '2000',
      STRIPE_TEST_SECRET_KEY: 'sk_test_e2e_platform_fake', STRIPE_CLIENT_ID: 'ca_e2e_fake', STRIPE_API_BASE: mockBase, STRIPE_CONNECT_BASE: mockBase,
      PAYPAL_SANDBOX_CLIENT_ID: 'sb_e2e_client', PAYPAL_SANDBOX_CLIENT_SECRET: 'sb_e2e_secret', PAYPAL_SANDBOX_API_BASE: mockBase, PAYPAL_PARTNER_ID: 'PARTNERE2E',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', (d) => logs.push(...d.toString().trim().split('\n')));
  worker.stderr.on('data', (d) => logs.push(...d.toString().trim().split('\n')));
  const stop = async () => { worker.kill('SIGTERM'); await mock.close().catch(() => {}); };
  ok(await until(() => fetch(`http://127.0.0.1:${HEALTH_PORT}/health`).then((r) => r.status === 200).catch(() => false), 20000), 'the worker starts against the mock providers');

  const b = await chromium.launch();
  try {
    // Admin with an authenticator (GoTrue MFA), for the fresh 2FA checks.
    for (const f of JSON.parse(sql(`select coalesce(json_agg(id), '[]') from auth.mfa_factors where user_id = '${adminUid}'`)))
      await fetch(`${API}/auth/v1/admin/users/${adminUid}/factors/${f}`, { method: 'DELETE', headers: serviceH });
    const adminAal1 = await apiLogin('admin@jsh.test');
    const enroll = await fetch(`${API}/auth/v1/factors`, { method: 'POST', headers: { ...anonH, authorization: `Bearer ${adminAal1}` }, body: JSON.stringify({ factor_type: 'totp', friendly_name: `e2e pay ${run}` }) }).then((x) => x.json());
    const totp = enroll.totp && enroll.totp.secret;
    const ch = await fetch(`${API}/auth/v1/factors/${enroll.id}/challenge`, { method: 'POST', headers: { ...anonH, authorization: `Bearer ${adminAal1}` }, body: '{}' }).then((x) => x.json());
    const adminAal2 = (await fetch(`${API}/auth/v1/factors/${enroll.id}/verify`, { method: 'POST', headers: { ...anonH, authorization: `Bearer ${adminAal1}` }, body: JSON.stringify({ challenge_id: ch.id, code: await freshTotp(totp) }) }).then((x) => x.json())).access_token;
    ok(Boolean(adminAal2), 'the admin has an authenticator app (fresh 2FA checks work)');

    const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
    p.on('pageerror', (e) => console.log('   portal pageerror:', String(e).slice(0, 200)));
    let t0 = Date.now();
    for (let i = 0; i < 20; i++) {
      await p.goto(BASE + '/login'); t0 = Date.now() - 2000;
      await p.fill('input[name=email]', 'admin@jsh.test'); await p.click('button[type=submit]');
      if (await p.waitForSelector('input[name=code]', { timeout: 5000 }).then(() => true, () => false)) break;
      await sleep(5000);
    }
    await p.fill('input[name=code]', await mailCode('admin@jsh.test', t0));
    await p.click('button[type=submit]');
    if (await p.waitForSelector('input[name=totp]', { timeout: 15000 }).then(() => true, () => false)) { await p.fill('input[name=totp]', await freshTotp(totp)); await p.click('button[type=submit]'); }
    await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 });

    // ── 1. Connect Stripe ─────────────────────────────────────────────────
    const noStep = await rpc(adminAal1, 'begin_payment_connect', { p_center: jsh, p_processor: 'stripe', p_redirect_uri: null, p_reason: 'x' });
    ok(noStep.status >= 400 && noStep.body && noStep.body.code === 'CCSTP', `1 connecting without a fresh 2FA check is refused with CCSTP (${noStep.body && noStep.body.code})`);
    await p.goto(BASE + '/settings/payments', { waitUntil: 'networkidle' });
    ok(/Test mode only/.test(await p.innerText('main')), '1 the sandbox banner says every charge runs in test mode');
    await shot(p, '1-payments-empty');
    await card(p, 'Stripe').getByRole('button', { name: 'Connect Stripe' }).click();
    await giveReason(p, `Connect our Stripe account ${run}`, 'Continue to Stripe');
    // Signing in just answered the authenticator, so the portal may not need to ask again; the API proves the rule.
    await maybeStepUp(p, totp);
    await p.waitForURL((u) => u.pathname === '/settings/payments' && u.searchParams.get('connected') === 'stripe', { timeout: 30000 });
    ok(true, '1 Stripe Connect sent the admin back with the authorization');
    const stripeOk = await until(() => sql(`select cp.status || '|' || coalesce(ic.external_account_id,'') from app.center_payment_processors cp join app.integration_connections ic on ic.id = cp.connection_id where cp.center_id = '${jsh}' and cp.processor = 'stripe'`).match(/^test\|acct_mock/));
    ok(Boolean(stripeOk), '1 the worker exchanged the code: Stripe connected in test mode with the connected account id');
    const stripeConn = sql(`select id from app.integration_connections where center_id = '${jsh}' and provider = 'stripe'`);
    const acct = sql(`select external_account_id from app.integration_connections where id = '${stripeConn}'`);
    ok(sql(`select string_agg(name, ',' order by name) from app.integration_secrets where connection_id = '${stripeConn}'`) === 'access_token,oauth.code,refresh_token',
      '1 the code and the tokens are in the vault (fingerprints only)');
    ok(sql(`select count(*) from app.jobs where kind = 'oauth.exchange' and payload::text like '%ac_mock%'`) === '0', '1 the code was never in a job payload');
    ok(audit(mark, 'oauth_states.insert').includes(`|portal|/settings/payments|Connect our Stripe account ${run}`), '1 audit: the connect started from the portal with its reason');
    await p.reload({ waitUntil: 'networkidle' });
    const stripeCardText = await card(p, 'Stripe').innerText();
    ok(stripeCardText.includes(acct) && /Test mode/.test(stripeCardText), '1 the Stripe card shows the account in test mode');
    await shot(p, '1-stripe-connected');

    await card(p, 'Stripe').getByLabel('ACH bank debit').check();
    await card(p, 'Stripe').getByLabel('Statement descriptor').fill('JSH TEMPLE');
    await card(p, 'Stripe').getByRole('button', { name: 'Save Stripe settings' }).click();
    await giveReason(p, `Card and ACH ${run}`, 'Save');
    ok(await until(() => sql(`select methods::text || '|' || coalesce(statement_descriptor,'') from app.center_payment_processors where center_id = '${jsh}' and processor = 'stripe'`) === '{ach,card}|JSH TEMPLE'),
      '1 methods and statement descriptor saved');
    ok(audit(mark, 'center_payment_processors.update') === `giving|portal|/settings/payments|Card and ACH ${run}`, '1 audit: giving | portal | /settings/payments | reason');
    await card(p, 'Stripe').getByRole('button', { name: 'Make default at checkout' }).click();
    await giveReason(p, 'Stripe at checkout', 'Make default');
    ok(await until(() => sql(`select is_default from app.center_payment_processors where center_id = '${jsh}' and processor = 'stripe'`) === 't'), '1 Stripe is the default at checkout');

    // ── 2. A sandbox is test mode only ────────────────────────────────────
    await p.reload({ waitUntil: 'networkidle' });
    ok(!(await card(p, 'Stripe').getByRole('button', { name: 'Switch to live' }).count()), '2 the sandbox offers no "Switch to live"');
    const live = await rpc(adminAal2, 'set_payment_mode', { p_center: jsh, p_processor: 'stripe', p_mode: 'live', p_reason: 'try' });
    ok(live.status >= 400 && live.body && live.body.code === 'CCENT', `2 the API refuses live mode in a sandbox with CCENT (${live.status} ${live.body && live.body.code})`);

    // ── 3. Offline methods ────────────────────────────────────────────────
    const checkRow = card(p, 'Offline methods').locator('section', { hasText: 'Check' }).first();
    await checkRow.getByRole('switch', { name: 'Accept Check' }).click();
    await checkRow.getByLabel('Make checks payable to *').fill('Jain Society of Houston');
    await checkRow.getByLabel('Mailing address *').fill('3905 Arbor St, Houston TX 77004');
    await checkRow.getByLabel('What to write in the memo').fill('Your member number');
    await checkRow.getByRole('button', { name: 'Save Check' }).click();
    await giveReason(p, `Checks by mail ${run}`, 'Save');
    ok(await until(() => sql(`select accepted::text || '|' || (instructions->>'payee') from app.center_payment_methods where center_id = '${jsh}' and method = 'check'`) === 'true|Jain Society of Houston'),
      '3 checks accepted with the payee and address');
    ok(audit(mark, 'center_payment_methods.insert') === `giving|portal|/settings/payments|Checks by mail ${run}` || audit(mark, 'center_payment_methods.update') === `giving|portal|/settings/payments|Checks by mail ${run}`,
      '3 audit: the offline method change with its reason');

    // ── 4. PayPal Business email without the messaging service ────────────
    await card(p, 'PayPal').getByLabel('PayPal Business email').fill('give@jsh.test');
    await card(p, 'PayPal').getByRole('button', { name: 'Send code' }).click();
    await maybeStepUp(p, totp);
    const toast = await p.getByText(/email sending isn't set up/i).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
    const messaging = sql("select to_regprocedure('app.enqueue_message(uuid,text,text,text,jsonb,text)') is not null") === 't';
    ok(messaging || toast, '4 without the messaging service the screen says the code cannot be sent');
    ok(messaging || sql(`select count(*) from app.paypal_email_verifications where center_id = '${jsh}'`) === '0', '4 and no code was made');
    await shot(p, '4-paypal-email');

    // ── 5. The $1 test ─────────────────────────────────────────────────────
    await p.reload({ waitUntil: 'networkidle' });
    const [popup] = await Promise.all([p.waitForEvent('popup', { timeout: 20000 }), card(p, 'Stripe').getByRole('button', { name: 'Run the $1 test' }).click()]);
    await popup.waitForLoadState();
    ok(/Mock Stripe Checkout/.test(await popup.innerText('body')) && /\$1\.00/.test(await popup.innerText('body')), '5 the $1 test opens the provider page for $1.00');
    await popup.click('#pay');
    await popup.waitForLoadState().catch(() => {});
    const t5 = await until(() => sql(`select ok::text || '|' || mode || '|' || coalesce(refund_ref,'') from app.payment_processor_tests where center_id = '${jsh}' and processor = 'stripe' and ran_at > '${startTs}' order by ran_at desc limit 1`).match(/^true\|test\|re_/), 45000);
    ok(Boolean(t5), '5 the signed webhook reached the worker, which refunded the $1 and recorded a passing test-mode test');
    await popup.close();
    ok(sql(`select count(*) from app.payments where provider = 'stripe' and amount_cents = 100 and center_id = '${jsh}'`) === '0', '5 the $1 test is never recorded as a gift');
    ok(mock.state.requests.some((r) => r.path === '/v1/refunds' && r.account === acct), '5 the refund went to the organization\'s own account');
    await p.reload({ waitUntil: 'networkidle' });
    ok(/Passed/.test(await card(p, 'Stripe').innerText()), '5 the Stripe card shows the passing test');
    await shot(p, '5-dollar-test');

    // ── 6. Member checkout ────────────────────────────────────────────────
    const m = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    m.on('pageerror', (e) => console.log('   member pageerror:', String(e).slice(0, 200)));
    await m.goto(MEMBER + '/sign-in', { waitUntil: 'networkidle' });
    let m0 = Date.now() - 2000;
    await m.fill('input[placeholder="name@example.com"]', 'priya@jsh.test');
    await m.getByRole('button', { name: /send|code|continue/i }).first().click();
    const box = m.locator('input[inputmode=numeric], input[autocomplete=one-time-code]').first();
    await box.waitFor({ timeout: 30000 });
    await box.fill(await mailCode('priya@jsh.test', m0));
    const v = m.getByRole('button', { name: /verify/i }).first(); if (await v.isVisible().catch(() => false)) await v.click();
    await m.waitForURL((u) => !/sign-in|verify/.test(u.pathname), { timeout: 60000 });
    await m.waitForTimeout(3000);
    await acceptLegalStep(m, sql);   // the first-sign-in legal step, when the community has published member documents
    await m.goto(MEMBER + '/give', { waitUntil: 'networkidle' });
    await m.getByText('How to give').first().waitFor({ timeout: 20000 });
    const giveText = await m.innerText('body');
    ok(/Payable to: Jain Society of Houston/.test(giveText) && /3905 Arbor St/.test(giveText), '6 Give › How to give shows the check instructions from Settings › Payments');
    await shot(m, '6-member-how-to-give');
    const openBefore = Number(sql(`select coalesce(sum(amount_cents - paid_cents),0) from app.pledges where household_id = '${priyaHH}' and status in ('open','partially_paid')`));
    const payBtn = m.getByRole('button', { name: /^Pay open balance/ }).first();
    await payBtn.scrollIntoViewIfNeeded();
    await payBtn.click();
    await m.getByText('Test mode — no real money moves').waitFor({ timeout: 15000 });
    ok(/Stripe/.test(await m.innerText('body')), '6 the Pay sheet says it pays with Stripe, in test mode (sandbox)');
    await shot(m, '6-member-pay-sheet');
    const payMark = Number(sql('select coalesce(max(id), 0) from app.audit_log'));
    const [mp] = await Promise.all([m.waitForEvent('popup', { timeout: 30000 }), m.getByRole('button', { name: 'Confirm and pay' }).click()]);
    await mp.waitForLoadState();
    const payAmount = await mp.locator('#amount').innerText();
    ok(payAmount === `$${(openBefore / 100).toFixed(2)}`, `6 the provider page asks for the open balance ${payAmount}`);
    await mp.click('#pay');
    await m.getByText('Anumodana!').waitFor({ timeout: 60000 });
    ok(true, '6 the member app shows the thank-you only after the provider confirmed');
    await shot(m, '6-member-thank-you');
    await mp.close().catch(() => {});
    const pay = sql(`select id || '|' || amount_cents || '|' || fee_cents || '|' || method || '|' || provider || '|' || provider_ref from app.payments where household_id = '${priyaHH}' and provider = 'stripe' order by created_at desc limit 1`).split('|');
    ok(pay[1] === String(openBefore) && Number(pay[2]) === Math.round(openBefore * 0.029) + 30 && pay[3] === 'card' && /^pi_/.test(pay[5]),
      `6 payment recorded: ${pay.slice(1).join(' | ')} (amount, provider fee, method, PaymentIntent)`);
    ok(sql(`select coalesce(sum(amount_cents),0) from app.payment_allocations where payment_id = '${pay[0]}'`) === String(openBefore)
       && sql(`select count(*) from app.pledges where household_id = '${priyaHH}' and status in ('open','partially_paid')`) === '0',
      '6 allocated to the pledges the member chose: none left open');
    ok(sql(`select count(*) from app.ledger_postings where source_id = '${pay[0]}'`) !== '0' || sql(`select app.payment_posts_to_qbo('${pay[0]}')`) === 'f',
      '6 queued for QuickBooks through the existing posting rule');
    ok(audit(payMark, 'payments.insert') === `giving|job||Paid online · Stripe ${pay[5]} (test mode)`, '6 audit: giving | job | Paid online · Stripe <ref> (test mode)');
    ok(sql(`select count(*) from app.audit_log where id > ${payMark} and action = 'payment_checkouts.insert' and client_app = 'member'`) === '1', '6 audit: the checkout was made from the member app');
    const evt = sql(`select event_id from app.webhook_events where provider = 'stripe' and event_type = 'checkout.session.completed' order by received_at desc limit 1`);
    ok(sql(`select (processed_at is not null)::text || '|' || (error is null)::text from app.webhook_events where event_id = '${evt}'`) === 'true|true', '6 the webhook event is marked processed');
    // Replay the very same event (Stripe retries): same row, no new job, no new payment.
    const payload = sql(`select payload::text from app.webhook_events where event_id = '${evt}'`);
    const ts = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', 'whsec_e2e_fake').update(`${ts}.${payload}`).digest('hex');
    const replay = await fetch(BASE + '/api/webhooks/stripe', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${ts},v1=${sig}` }, body: payload });
    ok(replay.status === 200, `6 a replayed webhook is accepted (${replay.status})`);
    ok(sql(`select count(*) from app.jobs where kind = 'payments.webhook.stripe' and payload->>'event_id' = '${evt}'`) === '1'
       && sql(`select count(*) from app.payments where provider_ref = '${pay[5]}'`) === '1', '6 idempotent: one job, one payment');
    const forged = await fetch(BASE + '/api/webhooks/stripe', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${ts},v1=${'0'.repeat(64)}` }, body: payload.replace('"paid"', '"x"') });
    ok(forged.status === 400, `6 a webhook with a wrong signature is refused (${forged.status})`);

    // ── 7. Refund through Stripe (two approvers, fresh 2FA) ───────────────
    sql(`update app.role_grants set ends_at = null where center_id = '${jsh}' and user_id = '${kiranUid}' and role_key = 'treasurer' and reason = 'e2e o-payments second approver';
         insert into app.role_grants (center_id, user_id, role_key, reason) select '${jsh}', '${kiranUid}', 'treasurer', 'e2e o-payments second approver'
         where not exists (select 1 from app.role_grants where center_id = '${jsh}' and user_id = '${kiranUid}' and role_key = 'treasurer'
                             and starts_at <= now() and (ends_at is null or ends_at > now()));`);   // other flows leave ended / future treasurer terms
    const req = await fetch(`${API}/rest/v1/payments?id=eq.${pay[0]}`, { method: 'PATCH', headers: { ...userH(adminAal2), prefer: 'return=representation', 'x-audit-reason': 'Duplicate%20gift' },
      body: JSON.stringify({ refund_approved_by: adminUid, refund_reason: 'Duplicate gift', refund_requested_cents: 1000 }) });
    ok(req.status === 200, `7 the admin requests a $10.00 refund (${req.status})`);
    const kiran = await apiLogin('kiran@jsh.test');
    const second = await rpc(kiran, 'approve_as_second', { p_table: 'payments', p_id: pay[0] });
    ok(second.status < 300, `7 a second, different treasurer approves (${second.status} ${JSON.stringify(second.body)})`);
    await p.goto(BASE + '/giving/payments', { waitUntil: 'networkidle' });
    const refundBtn = p.getByRole('button', { name: 'Refund through Stripe' }).first();
    await refundBtn.waitFor({ timeout: 15000 });
    await shot(p, '7-refund-button');
    await refundBtn.click();
    await maybeStepUp(p, totp);
    const refunded = await until(() => sql(`select refunded_cents || '|' || status from app.payments where id = '${pay[0]}'`) === '1000|partially_refunded', 45000);
    ok(Boolean(refunded), '7 Stripe refunded $10.00 and it is recorded like a hand-recorded refund (partially refunded)');
    ok(audit(mark, 'payments.update').startsWith('giving|job||Refunded through Stripe · re_'), '7 audit: the refund names the provider reference');
    ok(mock.state.requests.some((r) => r.path === '/v1/refunds' && r.idempotency === `refund-${pay[0]}-0`), '7 the refund was sent once, with an idempotency key');

    // ── 8. Connect with PayPal; a PayPal checkout through the route ───────
    await p.goto(BASE + '/settings/payments', { waitUntil: 'networkidle' });
    await card(p, 'PayPal').getByRole('button', { name: 'Connect with PayPal' }).click();
    await giveReason(p, `Connect PayPal ${run}`, 'Continue to PayPal');
    await maybeStepUp(p, totp);
    await p.waitForURL((u) => u.searchParams.get('connected') === 'paypal', { timeout: 30000 });
    ok(Boolean(await until(() => sql(`select cp.status || '|' || coalesce(ic.external_account_id,'') from app.center_payment_processors cp join app.integration_connections ic on ic.id = cp.connection_id where cp.center_id = '${jsh}' and cp.processor = 'paypal'`) === 'test|MOCKMERCHANT01')),
      '8 PayPal connected: the worker confirmed merchant MOCKMERCHANT01 with PayPal');
    ok(mock.state.requests.some((r) => r.path === '/v1/customer/partners/PARTNERE2E/merchant-integrations/MOCKMERCHANT01'), '8 the merchant was checked with the partner id');
    await shot(p, '8-paypal-connected');
    // A member PayPal checkout through the portal's route (Bearer = the member's own token).
    sql(`insert into app.pledges (center_id, household_id, source, amount_cents) values ('${jsh}', '${priyaHH}', 'general', 4000)`);
    const priya = await apiLogin('priya@jsh.test');
    const intent = await fetch(BASE + '/api/payments/intent', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${priya}` },
      body: JSON.stringify({ center_id: jsh, household_id: priyaHH, amount_cents: 4000, pledge_ids: [], processor: 'paypal', context: 'other', for_label: 'Gift' }) }).then((r) => r.json());
    ok(typeof intent.url === 'string' && intent.processor === 'paypal' && intent.mode === 'test', `8 the route created a PayPal order in test mode (${JSON.stringify(intent).slice(0, 120)})`);
    const teacher = await apiLogin('teacher@jsh.test');
    const nope = await fetch(BASE + '/api/payments/intent', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${teacher}` },
      body: JSON.stringify({ center_id: jsh, household_id: priyaHH, amount_cents: 4000, context: 'other', for_label: 'Gift' }) });
    ok(nope.status === 403 || nope.status === 400, `8 someone outside Priya's family (the teacher) cannot pay for it (${nope.status})`);
    await fetch(intent.url, { method: 'POST', redirect: 'manual' });   // the payer approves on PayPal's page
    const ppPay = await until(() => sql(`select p.amount_cents || '|' || p.method || '|' || p.provider_ref from app.payment_checkouts k join app.payments p on p.id = k.payment_id where k.id = '${intent.checkout_id}'`));
    ok(/^4000\|paypal\|CAP/.test(ppPay || ''), `8 the worker captured the approved order and recorded it: ${ppPay}`);
    ok(sql(`select status from app.payment_checkouts where id = '${intent.checkout_id}'`) === 'paid', '8 the checkout is paid');

    // ── 9. Payouts, Setup, readiness, the Giving switch ───────────────────
    const payout = await fetch(`${mockBase}/__mock/payout`, { method: 'POST', body: JSON.stringify({ account: acct, intents: [pay[5]] }) }).then((r) => r.json());
    const po = await until(() => sql(`select gross_cents || '|' || fee_cents || '|' || net_cents from app.payouts where center_id = '${jsh}' and provider = 'stripe' and provider_ref = '${payout.payout.id}'`));
    ok(po === `${openBefore}|${Math.round(openBefore * 0.029) + 30}|${openBefore - Math.round(openBefore * 0.029) - 30}`, `9 the payout landed in app.payouts: ${po}`);
    ok(sql(`select coalesce(provider_payout_ref,'') from app.payments where id = '${pay[0]}'`) === payout.payout.id, '9 the payment carries its payout');
    const steps = await rpc(adminAal2, 'setup_checklist', { p_center: jsh });
    const st = Object.fromEntries((steps.body || []).map((r) => [r.step_key, r.status]));
    ok(st['svc.payments'] === 'done' && st['data.payment_methods'] === 'done', `9 Setup: svc.payments ${st['svc.payments']}, data.payment_methods ${st['data.payment_methods']}`);
    const ready = await rpc(adminAal2, 'readiness', { p_center: jsh });
    const r6 = (ready.body || []).find((r) => r.key === 'payments_live');
    // o-golive (0301): in a sandbox check 6 passes on the default processor's passing TEST-mode $1 test and says live mode comes in production.
    ok(r6 && r6.ok === true && /TEST-mode/.test(r6.detail) && /in production after promotion/.test(r6.detail), `9 readiness 6 in a sandbox passes on the test-mode $1 test and says live comes later: ${r6 && r6.detail}`);
    await p.goto(BASE + '/setup/readiness', { waitUntil: 'networkidle' });
    await shot(p, '9-readiness');
    sql(`insert into app.center_modules (center_id, module_key, enabled, reason) values ('${jsh}', 'giving', false, 'e2e o-payments')
         on conflict (center_id, module_key) do update set enabled = false`);
    const off = await rpc(adminAal2, 'payment_settings', { p_center: jsh });
    ok(off.status >= 400, `9 with Giving off the payment settings are refused (${off.status})`);
    sql(`update app.center_modules set enabled = true where center_id = '${jsh}' and module_key = 'giving'`);
    ok(!logs.join('\n').includes('sk_test_e2e_platform_fake') && !logs.join('\n').includes('sb_e2e_secret'), 'no platform key appears in the worker log');
  } catch (err) {
    failures++; process.exitCode = 1;
    console.log('FAIL flow stopped:', err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : err);
    console.log('   worker log tail:', logs.slice(-8).join('\n   '));
  } finally {
    await b.close();
    sql(`update app.centers set environment = '${envBefore}' where id = '${jsh}';
         update app.role_grants set ends_at = now() where user_id = '${kiranUid}' and role_key = 'treasurer' and reason = 'e2e o-payments second approver' and ends_at is null;`);
    await stop();
  }
  console.log(failures === 0 ? 'o-payments flow: all checks passed' : `o-payments flow: ${failures} check(s) failed`);
})();
