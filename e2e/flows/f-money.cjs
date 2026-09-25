// Wave F · f-money — the owner's second batch of 2026-09-25 (money items), end to end, against a real
// local stack (bash e2e/up.sh f-money 300), the background service as connect_worker, and LOCAL MOCKS
// only (Stripe/PayPal: e2e/mocks/payments-mock.cjs; Intuit: e2e/mocks/intuit.cjs). Plain Node +
// Playwright; every step asserts the database and the audit rows.
//
//   (once) psql <DB> -c "alter role connect_worker with password '<pw>'"
//   PORT=3400 PORTAL_DATABASE_URL=postgres://connect_worker:<pw>@localhost:55732/postgres \
//     INTUIT_CLIENT_ID=intuit-test-client INTUIT_OAUTH_BASE=http://127.0.0.1:8930 OAUTH_STATE_SECRET=<32+ chars> pnpm start &
//   pnpm --dir worker build
//   WORKER_DB_PASSWORD=<pw> BASE=http://localhost:3400 MAIL=http://localhost:55624 API=http://localhost:55621 \
//   DB=postgres://postgres:postgres@localhost:55732/postgres ENVF=e2e/.env.f-money \
//   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright node e2e/flows/f-money.cjs
//
//  1. #12 Stripe and PayPal: the worker swaps the authorization code for the connection and removes the
//         used code from the vault ("used authorization code removed after exchange", audited as the
//         background service); a code the provider refuses is removed too (a retry could not use it).
//  2. #12 QuickBooks: connect in the portal (Intuit mock); after the exchange only the tokens are left.
//  3. Basis: the setup screen asks for the accounting basis first; nothing is mapped before it. The
//         treasurer chooses ACCRUAL: the screen, readiness check 7 and the posting queue say plainly that
//         accrual posting isn't available yet, and a new payment's posting waits in the queue (nothing
//         reaches QuickBooks). Changing back to cash needs a reason and a fresh 2FA check (the API refuses
//         without it); the change is recorded and the mapping must be approved again.
//  4. Year-end statements leave out opening-balance lines: app.year_end_statement (as the household's
//         adult), the household's Payments tab (statement totals, the line labelled "Opening balance"),
//         the statements page; an opening-balance line can never be sent a receipt.
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const { execSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createPaymentsMock } = require('../mocks/payments-mock.cjs');
const { startIntuitMock } = require('../mocks/intuit.cjs');

const BASE = process.env.BASE || 'http://localhost:3400';
const MAIL = process.env.MAIL || 'http://localhost:55624';
const API = process.env.API || 'http://localhost:55621';
const DB = process.env.DB || 'postgres://postgres:postgres@localhost:55732/postgres';
const OUT = process.env.OUT || '/tmp/claude-0/streams/f-money';
const ENVF = process.env.ENVF || path.join(__dirname, '..', '.env.f-money');
const PAY_PORT = Number(process.env.PAY_MOCK_PORT || 4930);
const INTUIT_PORT = Number(process.env.INTUIT_MOCK_PORT || 8930);
const HEALTH_PORT = process.env.WORKER_HEALTH_PORT || '3930';
const WORKER_JS = process.env.WORKER_JS || path.join(__dirname, '..', '..', 'worker', 'dist', 'server.js');
const KEYS = Object.fromEntries(fs.readFileSync(ENVF, 'utf8').trim().split('\n').map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
fs.mkdirSync(OUT, { recursive: true });

const sql = (q, url = DB) => execSync(`psql "${url}" -qAtX -v ON_ERROR_STOP=1`, { input: q }).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) { failures++; process.exitCode = 1; } };
async function until(fn, ms = 30000, every = 500) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(every); }
}
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }).catch(() => {});

// ── Sign-in codes and TOTP ───────────────────────────────────────────────────
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
const lastStep = {};
async function freshTotp(secret) {
  while (Math.floor(Date.now() / 30000) === lastStep[secret]) await sleep(1000);
  lastStep[secret] = Math.floor(Date.now() / 30000);
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(lastStep[secret]));
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
async function withAuthenticator(email, uid, run) {
  for (const f of JSON.parse(sql(`select coalesce(json_agg(id), '[]') from auth.mfa_factors where user_id = '${uid}'`)))
    await fetch(`${API}/auth/v1/admin/users/${uid}/factors/${f}`, { method: 'DELETE', headers: serviceH });
  const aal1 = await apiLogin(email);
  const auth = { ...anonH, authorization: `Bearer ${aal1}` };
  const enroll = await fetch(`${API}/auth/v1/factors`, { method: 'POST', headers: auth, body: JSON.stringify({ factor_type: 'totp', friendly_name: `e2e f-money ${run}` }) }).then((x) => x.json());
  const secret = enroll.totp && enroll.totp.secret;
  const fresh = async () => {
    const ch = await fetch(`${API}/auth/v1/factors/${enroll.id}/challenge`, { method: 'POST', headers: auth, body: '{}' }).then((x) => x.json());
    const v = await fetch(`${API}/auth/v1/factors/${enroll.id}/verify`, { method: 'POST', headers: auth, body: JSON.stringify({ challenge_id: ch.id, code: await freshTotp(secret) }) }).then((x) => x.json());
    return v.access_token;
  };
  const verified = await fresh();
  return { aal1, secret, fresh, verified };
}
const rpc = (token, fn, args) => fetch(`${API}/rest/v1/rpc/${fn}`, {
  method: 'POST',
  headers: { ...anonH, authorization: `Bearer ${token}`, 'accept-profile': 'app', 'content-profile': 'app', 'x-client-app': 'portal', 'x-client-screen': 'e2e/f-money' },
  body: JSON.stringify(args),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

let adminSecret = null;
let stepUps = 0;
/** Submit an ActionForm inside `scope`; answer the confirm and step-up modals if they open; wait for `expect`. */
async function submit(p, scope, button, expect) {
  await scope.getByRole('button', { name: button }).first().click();
  const confirm = p.getByRole('dialog').filter({ hasText: 'Please confirm' });
  const stepUp = p.getByRole('dialog').filter({ hasText: 'Confirm it' });
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button').last().click();
    if (await stepUp.isVisible().catch(() => false)) {
      await stepUp.getByLabel('Code from your authenticator app').fill(await freshTotp(adminSecret));
      await stepUp.getByRole('button', { name: 'Verify and continue' }).click();
      stepUps++;
      await sleep(700);
    }
    if (!expect) return;
    if (typeof expect === 'function' ? expect() : await p.getByText(expect).first().isVisible().catch(() => false)) return;
    await sleep(250);
  }
  throw new Error(`"${button}" did not reach its expected state: ${(await p.innerText('main').catch(() => '')).slice(0, 1200)}`);
}
const audit = (mark, action, extra = '') => sql(`select coalesce(module,'') || '|' || coalesce(client_app,'') || '|' || coalesce(reason,'')
                                                  from app.audit_log where id > ${mark} and action = '${action}' ${extra} order by id desc limit 1`);
const card = (p, text) => p.locator('section', { hasText: text });

(async () => {
  const run = crypto.randomBytes(3).toString('hex');
  const jsh = sql("select id from app.centers where slug = 'jsh'");
  const tz = sql(`select time_zone from app.centers where id = '${jsh}'`);
  const today = sql(`select to_char((now() at time zone '${tz}')::date, 'YYYY-MM-DD')`);
  const lastYear = Number(today.slice(0, 4)) - 1;
  const adminUid = sql("select id from auth.users where email = 'admin@jsh.test'");
  const shahHH = sql("select hm.household_id from app.household_members hm join app.people pe on pe.id = hm.person_id where pe.email = 'priya@jsh.test' and hm.left_at is null limit 1");

  // ── Mocks and the worker ─────────────────────────────────────────────────
  sql(`update app.jobs set status = 'cancelled' where status in ('queued','running'); delete from app.worker_heartbeats;`);
  const mark = Number(sql('select coalesce(max(id), 0) from app.audit_log'));
  const pay = createPaymentsMock({ portal: BASE, stripeWebhookSecret: 'whsec_e2e_fake', paypalWebhookId: 'WH-E2E-FAKE' });
  const payBase = await pay.listen(PAY_PORT);
  const intuit = await startIntuitMock({ port: INTUIT_PORT });
  const workerPw = process.env.WORKER_DB_PASSWORD;
  if (!workerPw) throw new Error('WORKER_DB_PASSWORD (the connect_worker password the portal uses) is required');
  const workerUrl = `postgres://connect_worker:${workerPw}@${new URL(DB).host}/postgres`;
  const logs = [];
  const worker = spawn(process.execPath, [WORKER_JS], {
    env: {
      PATH: process.env.PATH, WORKER_DATABASE_URL: workerUrl, WORKER_ID: `e2e-f-money-${run}`,
      WORKER_HEALTH_PORT: HEALTH_PORT, WORKER_POLL_MS: '400', WORKER_HEARTBEAT_MS: '2000',
      STRIPE_TEST_SECRET_KEY: 'sk_test_e2e_platform_fake', STRIPE_CLIENT_ID: 'ca_e2e_fake', STRIPE_API_BASE: payBase, STRIPE_CONNECT_BASE: payBase,
      PAYPAL_SANDBOX_CLIENT_ID: 'sb_e2e_client', PAYPAL_SANDBOX_CLIENT_SECRET: 'sb_e2e_secret', PAYPAL_SANDBOX_API_BASE: payBase, PAYPAL_PARTNER_ID: 'PARTNERE2E',
      INTUIT_CLIENT_ID: 'intuit-test-client', INTUIT_CLIENT_SECRET: 'intuit-test-secret-000', INTUIT_OAUTH_BASE: intuit.base, INTUIT_API_BASE: intuit.base,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', (d) => logs.push(...d.toString().trim().split('\n')));
  worker.stderr.on('data', (d) => logs.push(...d.toString().trim().split('\n')));
  process.on('exit', () => { try { worker.kill('SIGKILL'); } catch { /* already stopped */ } });
  ok(await until(() => fetch(`http://127.0.0.1:${HEALTH_PORT}/health`).then((r) => r.status === 200).catch(() => false), 20000), 'the worker starts against the mock providers');

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  p.on('pageerror', (e) => console.log('   portal pageerror:', String(e).slice(0, 200)));
  try {
    // ── 1. #12 Stripe and PayPal: the used code leaves the vault ─────────
    // A test community of its own (test data only), so JSH's payment settings are untouched.
    const fm = sql(`insert into app.centers (slug, name, short_name, time_zone) values ('fmoney-${run}', 'F-Money Test Temple ${run}', 'FMT', 'America/Chicago') returning id`);
    const stripeConn = sql(`insert into app.integration_connections (center_id, provider, status, settings) values ('${fm}', 'stripe', 'disconnected', '{"mode":"test"}') returning id`);
    const paypalConn = sql(`insert into app.integration_connections (center_id, provider, status, settings) values ('${fm}', 'paypal', 'disconnected', '{"mode":"test"}') returning id`);
    // The callback's part (0211): the code goes to the vault, the job carries only its name.
    const putCode = (conn, value) => sql(`select app.worker_store_secret('${conn}', 'oauth.code', '${value}', 'e2e: the provider sent the person back with a code')`, workerUrl);
    const exchange = (conn, provider) => sql(`select app.enqueue_job('${fm}', 'oauth.exchange', '{"provider":"${provider}","connection_id":"${conn}","code_secret":"oauth.code","mode":"test"}', now(), 3)`);
    const jobDone = (id) => until(() => { const s = sql(`select status from app.jobs where id = ${id}`); return s === 'done' || s === 'failed' ? s : null; }, 30000);
    const names = (conn) => sql(`select coalesce(string_agg(name, ',' order by name), '') from app.integration_secrets where connection_id = '${conn}'`);

    putCode(stripeConn, `ac_e2e_${run}_0001`);
    ok(names(stripeConn) === 'oauth.code', '1 #12 Stripe: the authorization code is in the vault before the exchange');
    const j1 = exchange(stripeConn, 'stripe');
    ok((await jobDone(j1)) === 'done', '1 #12 Stripe: the worker exchanges the code (payments mock)');
    ok(names(stripeConn) === 'access_token,refresh_token', `1 #12 Stripe: only the tokens are left; the used code is removed (${names(stripeConn)})`);
    ok(sql(`select (result->>'code_removed') from app.jobs where id = ${j1}`) === 'true', '1 #12 Stripe: the job result says the code was removed');
    ok(audit(mark, 'integration_secrets.delete', `and before->>'connection_id' = '${stripeConn}'`) === '|job|Background service: used authorization code removed after exchange'
       || audit(mark, 'integration_secrets.delete', `and before->>'connection_id' = '${stripeConn}'`).endsWith('|job|Background service: used authorization code removed after exchange'),
      `1 #12 Stripe: audited as the background service's work: ${audit(mark, 'integration_secrets.delete', `and before->>'connection_id' = '${stripeConn}'`)}`);
    ok(sql(`select count(*) from app.audit_log where id > ${mark} and position('ac_e2e_${run}' in coalesce(before::text,'') || coalesce(after::text,'')) > 0`) === '0'
       && !logs.join('\n').includes(`ac_e2e_${run}`), '1 #12 the code value is in no audit row and no worker log line');

    putCode(paypalConn, 'MOCKMERCHANT01');
    const j2 = exchange(paypalConn, 'paypal');
    ok((await jobDone(j2)) === 'done', '1 #12 PayPal: the worker confirms the merchant with PayPal (payments mock)');
    ok(names(paypalConn) === '', '1 #12 PayPal: the used code is removed (PayPal hands back no tokens)');
    ok(audit(mark, 'integration_secrets.delete', `and before->>'connection_id' = '${paypalConn}'`).endsWith('|job|Background service: used authorization code removed after exchange'),
      '1 #12 PayPal: audited');

    // A code the provider refuses cannot be used by a retry: removed as well, with its own reason.
    sql(`update app.integration_connections set status = 'disconnected' where id = '${stripeConn}'`);
    putCode(stripeConn, `bad_code_${run}_0002`);
    const j3 = exchange(stripeConn, 'stripe');
    ok((await jobDone(j3)) === 'failed', `1 #12 Stripe refuses an unknown code: the job fails honestly (${sql(`select last_error from app.jobs where id = ${j3}`)})`);
    ok(!names(stripeConn).includes('oauth.code'), '1 #12 the refused code is removed (a retry could not use it)');
    ok(audit(mark, 'integration_secrets.delete', `and before->>'connection_id' = '${stripeConn}'`).endsWith('failed exchange (a retry could not use it)'),
      `1 #12 audited with why: ${audit(mark, 'integration_secrets.delete', `and before->>'connection_id' = '${stripeConn}'`)}`);

    // ── Portal sign-in (treasurer with an authenticator) ─────────────────
    const admin = await withAuthenticator('admin@jsh.test', adminUid, run);
    adminSecret = admin.secret;
    ok(Boolean(admin.secret), 'the treasurer (admin@jsh.test) has an authenticator app');
    let t0 = Date.now();
    for (let i = 0; i < 20; i++) {
      await p.goto(BASE + '/login'); t0 = Date.now() - 2000;
      await p.fill('input[name=email]', 'admin@jsh.test'); await p.click('button[type=submit]');
      if (await p.waitForSelector('input[name=code]', { timeout: 5000 }).then(() => true, () => false)) break;
      await sleep(5000);
    }
    await p.fill('input[name=code]', await mailCode('admin@jsh.test', t0));
    await p.click('button[type=submit]');
    if (await p.waitForSelector('input[name=totp]', { timeout: 15000 }).then(() => true, () => false)) { await p.fill('input[name=totp]', await freshTotp(admin.secret)); await p.click('button[type=submit]'); }
    await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 });

    // ── 2. #12 QuickBooks through the portal ────────────────────────────
    sql(`update app.integration_connections set status = 'disconnected', settings = '{}', external_account_id = null where center_id = '${jsh}' and provider in ('quickbooks_online','intuit_sandbox');
         delete from app.integration_secrets where connection_id in (select id from app.integration_connections where center_id = '${jsh}' and provider in ('quickbooks_online','intuit_sandbox'));
         delete from app.qbo_account_mappings where center_id = '${jsh}';
         update app.funds set qbo_class_id = null where center_id = '${jsh}';`);
    await p.goto(BASE + '/accounting/qbo/setup', { waitUntil: 'networkidle' });
    await p.fill('#qbo-connect-reason', `Connecting our books ${run}`);
    await p.getByRole('button', { name: 'Connect QuickBooks' }).click();
    const stepUp = p.getByRole('dialog').filter({ hasText: 'Confirm it' });
    if (await stepUp.waitFor({ timeout: 5000 }).then(() => true, () => false)) {
      await stepUp.getByLabel('Code from your authenticator app').fill(await freshTotp(admin.secret));
      await stepUp.getByRole('button', { name: 'Verify and continue' }).click();
    }
    await p.waitForURL((u) => u.pathname === '/accounting/qbo/setup' && u.searchParams.get('connect') !== null, { timeout: 30000 });
    const conn = sql(`select id from app.integration_connections where center_id = '${jsh}' and provider = 'quickbooks_online'`);
    ok(await until(() => sql(`select status from app.integration_connections where id = '${conn}'`) === 'connected', 30000), '2 QuickBooks is connected (Intuit mock, worker token exchange)');
    ok(names(conn) === 'access_token,refresh_token', `2 #12 QuickBooks: after the exchange only the tokens are in the vault (${names(conn)})`);
    ok(audit(mark, 'integration_secrets.delete', `and before->>'connection_id' = '${conn}' and before->>'name' = 'oauth.code'`)
      .endsWith('|job|Background service: used authorization code removed after exchange'), '2 #12 QuickBooks: the removal is audited');
    ok(await until(() => sql(`select count(*) from app.qbo_accounts where connection_id = '${conn}'`) !== '0', 30000), '2 the chart of accounts is pulled');

    // ── 3. The accounting basis is the first choice ─────────────────────
    await p.goto(BASE + '/accounting/qbo/setup', { waitUntil: 'networkidle' });
    const steps = await p.getByRole('list', { name: 'QuickBooks setup steps' }).innerText();
    ok(/2\. Accounting basis/.test(steps), `3 the setup steps put the accounting basis right after connecting: ${steps.replace(/\s+/g, ' ')}`);
    const basisCard = card(p, '2 · Accounting basis');
    ok(await basisCard.isVisible() && /Cash basis/.test(await basisCard.innerText()) && /Accrual basis/.test(await basisCard.innerText()), '3 the basis card offers cash and accrual');
    ok(/Choose the accounting basis first/.test(await card(p, '5 · Account mapping').innerText()), '3 the mapping waits for the basis');
    ok(/Choose the accounting basis first/.test(await card(p, '4 · Posting and go-live date').innerText()), '3 posting and go-live wait for it too');
    const early = await rpc(await admin.fresh(), 'set_qbo_mapping', { p_center: jsh, p_purpose: 'income.general', p_qbo_account_id: '1', p_reason: 'too early' });
    ok(early.status >= 400 && /accounting basis/.test(JSON.stringify(early.body)), `3 the database refuses a mapping before the basis (${early.body && early.body.message})`);
    await shot(p, '3-basis-first');
    await basisCard.locator('input[name=basis][value=accrual]').check();
    await basisCard.locator('#qbo-basis-reason').fill(`Our auditor keeps pledges receivable ${run}`);
    await submit(p, basisCard, 'Save basis', () => sql(`select settings->>'basis' from app.integration_connections where id = '${conn}'`) === 'accrual');
    ok(sql(`select settings->>'basis_chosen_by' from app.integration_connections where id = '${conn}'`) === adminUid, '3 the treasurer chose ACCRUAL; stored in settings.basis with who');
    ok(audit(mark, 'integration_connections.update', `and record_id = '${conn}' and reason like 'Our auditor keeps pledges receivable%'`).endsWith(`|portal|Our auditor keeps pledges receivable ${run}`),
      '3 the choice is audited: from the portal, with its reason');
    await p.goto(BASE + '/accounting/qbo/setup', { waitUntil: 'networkidle' });
    const waitingText = await p.getByTestId('qbo-accrual-waiting').innerText().catch(() => '');
    ok(/Accrual-basis posting isn't available yet/.test(waitingText) && /Postings wait in the queue/.test(waitingText), `3 the readiness card says accrual posting isn't available yet: ${waitingText.replace(/\s+/g, ' ').slice(0, 160)}`);
    ok(/on accrual basis\. Accrual-basis posting isn't available yet/.test(sql(`select app.check_quickbooks_ready('${jsh}')->>'detail'`)), '3 readiness check 7 says so plainly');
    ok(/pledges receivable/i.test(await card(p, '5 · Account mapping').innerText()), '3 on accrual the mapping asks for the pledges receivable account');
    await shot(p, '3-accrual-waiting');
    // A new payment: its posting waits in the queue, nothing reaches QuickBooks.
    sql(`update app.integration_connections set settings = settings || '{"posting":"per_txn"}'::jsonb || jsonb_build_object('go_live_date', '${today}') where id = '${conn}'`);
    const created0 = (await fetch(`${intuit.base}/__mock/state`).then((r) => r.json())).created.length;
    const payA = sql(`insert into app.payments (center_id, household_id, amount_cents, method, provider, received_on, receipt_number)
                      values ('${jsh}', '${shahHH}', 4400, 'cash', 'offline', '${today}', 'FM-${run}') returning id`);
    ok(sql(`select status from app.ledger_postings where source_id = '${payA}'`) === 'queued', '3 the payment is queued for QuickBooks');
    await sleep(6000);
    ok(sql(`select status from app.ledger_postings where source_id = '${payA}'`) === 'queued', '3 on accrual it still waits in the queue (not posted, skipped or failed)');
    ok(sql(`select count(*) from app.jobs where center_id = '${jsh}' and kind = 'qbo.post' and status in ('queued','running','done') and created_at > now() - interval '1 minute'`) === '0'
       && (await fetch(`${intuit.base}/__mock/state`).then((r) => r.json())).created.length === created0, '3 nothing is sent to QuickBooks');
    await p.goto(BASE + '/accounting/qbo', { waitUntil: 'networkidle' });
    ok(/Accrual posting isn't available yet/.test(await p.innerText('main')), '3 the posting queue says it too');
    await shot(p, '3-queue-accrual');

    // Changing the basis later: a reason and a fresh 2FA check.
    const noStep = await rpc(admin.aal1, 'set_qbo_basis', { p_center: jsh, p_basis: 'cash', p_reason: 'without a fresh check' });
    ok(noStep.status >= 400 && noStep.body && noStep.body.code === 'CCSTP', `3 without a fresh 2FA check the change is refused (${noStep.status} ${noStep.body && noStep.body.code})`);
    await p.goto(BASE + '/accounting/qbo/setup', { waitUntil: 'networkidle' });
    const basisCard2 = card(p, '2 · Accounting basis');
    await basisCard2.locator('summary', { hasText: 'Change the basis' }).click();
    await basisCard2.locator('#qbo-basis-change').selectOption('cash');
    await basisCard2.locator('#qbo-basis-change-reason').fill(`We stay on cash until an accrual customer needs it ${run}`);
    await submit(p, basisCard2, 'Change basis', () => sql(`select settings->>'basis' from app.integration_connections where id = '${conn}'`) === 'cash');
    ok(sql(`select settings->>'basis_changed_from' || '|' || (settings->>'basis_changed_by') from app.integration_connections where id = '${conn}'`) === `accrual|${adminUid}`,
      `3 the treasurer changed it back to cash${stepUps > 0 ? ' after the step-up modal verified a fresh code' : ' (covered by the 2FA code of the sign-in)'}`);
    ok(audit(mark, 'integration_connections.update', `and record_id = '${conn}' and reason like 'We stay on cash%'`).endsWith(`|portal|We stay on cash until an accrual customer needs it ${run}`),
      '3 the change is audited with its reason');
    const ready = JSON.parse(sql(`select app.qbo_post_ready('${jsh}')`));
    ok(!ready.ok && !/Accrual/.test(ready.reason) && /mapping is not approved/.test(ready.reason), `3 on cash nothing waits for accrual any more; the next step is the mapping (${ready.reason})`);
    await p.goto(BASE + '/accounting/qbo/setup', { waitUntil: 'networkidle' });
    ok(/Cash basis/.test(await card(p, '2 · Accounting basis').innerText()) && (await p.getByTestId('qbo-accrual-waiting').count()) === 0, '3 the screen shows cash basis');
    await shot(p, '3-cash-again');

    // ── 4. Year-end statements leave out opening-balance lines ──────────
    const gift = sql(`insert into app.payments (center_id, household_id, amount_cents, method, status, provider, received_on, is_historical, crm_external_id)
                      values ('${jsh}', '${shahHH}', 12500, 'check', 'settled', 'offline', '${lastYear}-05-10', true, 'FMG-${run}') returning id`);
    const opening = sql(`insert into app.payments (center_id, household_id, amount_cents, method, status, provider, received_on, is_historical, is_opening_balance, crm_external_id, memo)
                         values ('${jsh}', '${shahHH}', 30000, 'other', 'settled', 'import', '${lastYear}-01-02', true, true, 'FMO-${run}', 'Opening balance e2e ${run}') returning id`);
    const priya = await apiLogin('priya@jsh.test');
    const st = await rpc(priya, 'year_end_statement', { p_household: shahHH, p_year: lastYear });
    const expected = Number(sql(`select coalesce(sum(amount_cents - refunded_cents), 0) from app.payments where household_id = '${shahHH}' and not is_opening_balance
                                   and status in ('captured','pending_clearing','settled','partially_refunded') and received_on between '${lastYear}-01-01' and '${lastYear}-12-31'`));
    ok(st.status === 200 && Number(st.body.total_cents) === expected, `4 the household's adult reads the ${lastYear} statement: total ${st.body && st.body.total_cents} (gifts only)`);
    ok(st.body && st.body.lines.some((l) => l.payment_id === gift) && !st.body.lines.some((l) => l.payment_id === opening), '4 the gift is on it; the opening-balance line is not');
    ok(st.body && Number(st.body.left_out.opening_balance_cents) >= 30000 && /Opening-balance lines are left out/.test(st.body.left_out.reason || ''),
      `4 it says what it left out and why: ${st.body && st.body.left_out.reason}`);
    const hist = await fetch(`${API}/rest/v1/payments?select=id,is_opening_balance&id=eq.${opening}`, { headers: { ...anonH, authorization: `Bearer ${priya}`, 'accept-profile': 'app' } }).then((r) => r.json());
    ok(Array.isArray(hist) && hist.length === 1 && hist[0].is_opening_balance === true, '4 the household\'s giving history still has the opening-balance line');
    let refused = '';
    try { execSync(`psql "${DB}" -qAtX -v ON_ERROR_STOP=1`, { input: `update app.payments set receipt_sent_at = now() where id = '${opening}'`, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { refused = String(e.stderr || e.message); }
    ok(/payments_opening_balance_no_receipt/.test(refused), '4 an opening-balance line can never be sent a receipt');

    await p.goto(`${BASE}/households/${shahHH}?tab=payments`, { waitUntil: 'networkidle' });
    const tab = await p.innerText('main');
    ok(/Opening balance/.test(tab) && /Not a gift receipt · left out of year-end statements/.test(tab), '4 the household Payments tab labels the opening-balance line');
    const ye = await p.getByTestId('year-end-statements').innerText().catch(() => '');
    const money = (c) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
    ok(ye.includes(`${lastYear}: ${money(expected)}`) && /opening balance left out/.test(ye), `4 and shows the ${lastYear} statement total without it: ${ye.replace(/\s+/g, ' ').slice(0, 200)}`);
    await shot(p, '4-household-payments');
    await p.goto(`${BASE}/giving/statements`, { waitUntil: 'networkidle' });
    const stText = await p.innerText('main');
    ok(/leave out opening-balance lines/.test(stText) && /opening balances left out/.test(stText), '4 the statements page states the rule and counts households without opening balances');
    await shot(p, '4-statements');
  } finally {
    const exited = new Promise((r) => worker.on('exit', (code) => r(code)));
    worker.kill('SIGTERM');
    ok((await exited) === 0, 'the worker stops cleanly');
    fs.writeFileSync(`${OUT}/worker.log`, logs.join('\n') + '\n');
    await b.close();


  }
  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => { console.error(err); process.exit(1); });
