// Wave E · e-money — the owner's money decisions of 2026-09-25, end to end, against a real local
// stack (bash e2e/up.sh e-money 200), the background service as connect_worker, and LOCAL MOCKS only
// (Stripe/PayPal: e2e/mocks/payments-mock.cjs; Intuit: e2e/mocks/intuit.cjs). Plain Node + Playwright;
// every step asserts the database and the audit rows.
//
//   (once) psql <DB> -c "alter role connect_worker with password '<pw>'"
//   PORT=3300 STRIPE_WEBHOOK_SECRET=whsec_e2e_fake PORTAL_DATABASE_URL=postgres://connect_worker:<pw>@localhost:55632/postgres \
//     INTUIT_CLIENT_ID=intuit-test-client INTUIT_OAUTH_BASE=http://127.0.0.1:8792 OAUTH_STATE_SECRET=<32+ chars> pnpm start &
//   pnpm --dir worker build
//   WORKER_DB_PASSWORD=<pw> BASE=http://localhost:3300 MAIL=http://localhost:55524 API=http://localhost:55521 \
//   DB=postgres://postgres:postgres@localhost:55632/postgres ENVF=e2e/.env.e-money \
//   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright node e2e/flows/e-money.cjs
//
//  1. #5  Settings › Payments: donor-covers-fee says "Not offered yet"; the database refuses switching it on.
//  2. #6  A refund made in the Stripe dashboard (signed charge.refunded webhook → route → worker) is FLAGGED:
//         nothing changes on the payment or its allocations; Giving › Payments lists it; the treasurer
//         approves first in the portal, a second treasurer approves second → recorded; a replay adds nothing.
//  3. #7  Email-only PayPal: request refund (portal) → second approver → "Record the PayPal refund"
//         (amount, date, PayPal transaction id, reason) → recorded with both approvers.
//  4. #10 QuickBooks: connect (Intuit mock), map, and the live test post is explained before it runs,
//         confirmed in the modal, and the message after it says how to void the four $1.00 entries.
//  5. #11 Donor matching brings a RefundReceipt in as a historical refund reducing the matching payment
//         (never posted back); an unmatched credit memo waits in Needs review with the reason.
//  6. Write-off → QuickBooks: a pledge from a QuickBooks invoice, written off by two people, posts ONE
//         CreditMemo applied to the invoice ($0 Payment); retried, nothing is created twice. A cash-basis
//         pledge never in QuickBooks is skipped with the reason, shown on the pledge.
//  7. #24 Import: pledges with "paid so far" and a written-off pledge (who/when/why), then a payment
//         history; "Bring in opening balances" adds one historical line per pledge.
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const { execSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createPaymentsMock } = require('../mocks/payments-mock.cjs');
const { startIntuitMock } = require('../mocks/intuit.cjs');

const BASE = process.env.BASE || 'http://localhost:3300';
const MAIL = process.env.MAIL || 'http://localhost:55524';
const API = process.env.API || 'http://localhost:55521';
const DB = process.env.DB || 'postgres://postgres:postgres@localhost:55632/postgres';
const OUT = process.env.OUT || '/tmp/claude-0/streams/e-money';
const ENVF = process.env.ENVF || path.join(__dirname, '..', '.env.e-money');
const PAY_PORT = Number(process.env.PAY_MOCK_PORT || 4792);
const INTUIT_PORT = Number(process.env.INTUIT_MOCK_PORT || 8792);
const HEALTH_PORT = process.env.WORKER_HEALTH_PORT || '3792';
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
/** A login with an authenticator: {aal1, factor, secret}; fresh() returns an aal2 token with a TOTP check just now. */
async function withAuthenticator(email, uid, run) {
  for (const f of JSON.parse(sql(`select coalesce(json_agg(id), '[]') from auth.mfa_factors where user_id = '${uid}'`)))
    await fetch(`${API}/auth/v1/admin/users/${uid}/factors/${f}`, { method: 'DELETE', headers: serviceH });
  const aal1 = await apiLogin(email);
  const auth = { ...anonH, authorization: `Bearer ${aal1}` };
  const enroll = await fetch(`${API}/auth/v1/factors`, { method: 'POST', headers: auth, body: JSON.stringify({ factor_type: 'totp', friendly_name: `e2e money ${run}` }) }).then((x) => x.json());
  const secret = enroll.totp && enroll.totp.secret;
  const fresh = async () => {
    const ch = await fetch(`${API}/auth/v1/factors/${enroll.id}/challenge`, { method: 'POST', headers: auth, body: '{}' }).then((x) => x.json());
    const v = await fetch(`${API}/auth/v1/factors/${enroll.id}/verify`, { method: 'POST', headers: auth, body: JSON.stringify({ challenge_id: ch.id, code: await freshTotp(secret) }) }).then((x) => x.json());
    return v.access_token;
  };
  await fresh();
  return { aal1, secret, fresh };
}
const rpc = (token, fn, args) => fetch(`${API}/rest/v1/rpc/${fn}`, {
  method: 'POST',
  headers: { ...anonH, authorization: `Bearer ${token}`, 'accept-profile': 'app', 'content-profile': 'app', 'x-client-app': 'portal', 'x-client-screen': 'e2e/e-money' },
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
const audit = (mark, action, extra = '') => sql(`select coalesce(module,'') || '|' || coalesce(client_app,'') || '|' || coalesce(client_screen,'') || '|' || coalesce(reason,'')
                                                  from app.audit_log where id > ${mark} and action = '${action}' ${extra} order by id desc limit 1`);
const card = (p, title) => p.locator('section.cc-card').filter({ has: p.getByRole('heading', { name: title, exact: true }) });

(async () => {
  const run = crypto.randomBytes(3).toString('hex');
  const jsh = sql("select id from app.centers where slug = 'jsh'");
  const tz = sql(`select time_zone from app.centers where id = '${jsh}'`);
  const today = sql(`select to_char((now() at time zone '${tz}')::date, 'YYYY-MM-DD')`);
  const adminUid = sql("select id from auth.users where email = 'admin@jsh.test'");
  const kiranUid = sql("select id from auth.users where email = 'kiran@jsh.test'");
  const shahHH = sql("select hm.household_id from app.household_members hm join app.people pe on pe.id = hm.person_id where pe.email = 'priya@jsh.test' and hm.left_at is null limit 1");
  const priyaPerson = sql("select id from app.people where email = 'priya@jsh.test' limit 1");

  // ── Test data (script only) ───────────────────────────────────────────────
  // A second treasurer (the second approver of every two-person step), JSH on cash basis.
  sql(`insert into app.role_grants (center_id, user_id, role_key, reason) values ('${jsh}', '${kiranUid}', 'treasurer', 'e2e e-money second approver')
       on conflict do nothing;
       update app.jobs set status = 'cancelled' where status in ('queued','running');
       delete from app.worker_heartbeats;`);
  const mark = Number(sql('select coalesce(max(id), 0) from app.audit_log'));

  // ── Mocks and the worker ─────────────────────────────────────────────────
  const pay = createPaymentsMock({ portal: BASE, stripeWebhookSecret: 'whsec_e2e_fake', paypalWebhookId: 'WH-E2E-FAKE' });
  const payBase = await pay.listen(PAY_PORT);
  const intuit = await startIntuitMock({ port: INTUIT_PORT });
  const workerPw = process.env.WORKER_DB_PASSWORD;
  if (!workerPw) throw new Error('WORKER_DB_PASSWORD (the connect_worker password the portal uses) is required');
  const workerUrl = `postgres://connect_worker:${workerPw}@${new URL(DB).host}/postgres`;
  const logs = [];
  const worker = spawn(process.execPath, [WORKER_JS], {
    env: {
      PATH: process.env.PATH, WORKER_DATABASE_URL: workerUrl, WORKER_ID: `e2e-money-${run}`,
      WORKER_HEALTH_PORT: HEALTH_PORT, WORKER_POLL_MS: '400', WORKER_HEARTBEAT_MS: '2000',
      STRIPE_TEST_SECRET_KEY: 'sk_test_e2e_platform_fake', STRIPE_CLIENT_ID: 'ca_e2e_fake', STRIPE_API_BASE: payBase, STRIPE_CONNECT_BASE: payBase,
      PAYPAL_SANDBOX_CLIENT_ID: 'sb_e2e_client', PAYPAL_SANDBOX_CLIENT_SECRET: 'sb_e2e_secret', PAYPAL_SANDBOX_API_BASE: payBase,
      INTUIT_CLIENT_ID: 'intuit-test-client', INTUIT_CLIENT_SECRET: 'intuit-test-secret-000', INTUIT_OAUTH_BASE: intuit.base, INTUIT_API_BASE: intuit.base,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', (d) => logs.push(...d.toString().trim().split('\n')));
  worker.stderr.on('data', (d) => logs.push(...d.toString().trim().split('\n')));
  process.on('exit', () => { try { worker.kill('SIGKILL'); } catch { /* already stopped */ } });
  ok(await until(() => fetch(`http://127.0.0.1:${HEALTH_PORT}/health`).then((r) => r.status === 200).catch(() => false), 20000), 'the worker starts against the mock providers');

  const admin = await withAuthenticator('admin@jsh.test', adminUid, run);
  adminSecret = admin.secret;
  const kiran = await withAuthenticator('kiran@jsh.test', kiranUid, run);
  ok(Boolean(admin.secret && kiran.secret), 'both treasurers have an authenticator app (fresh 2FA checks)');

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  p.on('pageerror', (e) => console.log('   portal pageerror:', String(e).slice(0, 200)));
  try {
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

    // ── 1. #5 Donor covers the fee: not offered ──────────────────────────
    await p.goto(BASE + '/settings/payments', { waitUntil: 'networkidle' });
    const payText = await p.innerText('main');
    ok(/Not offered yet/.test(payText) && /No fee is ever added to a gift/.test(payText), '1 #5 Settings › Payments says donor-covers-fee is not offered yet');
    ok((await p.getByRole('switch', { name: /cover the processing fee/i }).count()) === 0, '1 #5 there is no switch to turn it on');
    const feeTry = await rpc(await admin.fresh(), 'set_payment_processor', { p_center: jsh, p_processor: 'stripe', p_methods: ['card'], p_statement_descriptor: null, p_donor_covers_fee_allowed: true, p_reason: 'try' });
    ok(feeTry.status >= 400 && /not offered yet/.test(JSON.stringify(feeTry.body)), `1 #5 the database refuses it: ${feeTry.body && feeTry.body.message}`);
    ok(sql('select count(*) from app.center_payment_processors where donor_covers_fee_allowed') === '0', '1 #5 no organization has it on');
    await shot(p, '1-no-donor-fee');

    // ── 2. #6 A refund made in the Stripe dashboard ──────────────────────
    const pledge6 = sql(`insert into app.pledges (center_id, household_id, pledged_by_person_id, source, amount_cents, pledged_at)
                         values ('${jsh}', '${shahHH}', '${priyaPerson}', 'general', 10000, now()) returning id`);
    const pi = `pi_emoney_${run}`;
    const pay6 = sql(`insert into app.payments (center_id, household_id, payer_person_id, amount_cents, method, status, provider, provider_ref, received_on, memo)
                      values ('${jsh}', '${shahHH}', '${priyaPerson}', 10000, 'card', 'captured', 'stripe', '${pi}', '${today}', 'Paid online · e2e ${run}') returning id`);
    sql(`select app.allocate_payment('${pay6}', array['${pledge6}']::uuid[], true)`);
    const receipt6 = sql(`select receipt_number from app.payments where id = '${pay6}'`);
    const alloc6 = sql(`select string_agg(pledge_id || ':' || amount_cents, ',') from app.payment_allocations where payment_id = '${pay6}'`);
    const refundObj = (total, ids) => ({ id: `ch_${run}`, object: 'charge', payment_intent: pi, amount: 10000, amount_refunded: total, refunded: total === 10000,
      refunds: { data: ids.map((x, i) => ({ id: x, amount: 2500, created: Math.floor(Date.now() / 1000) - 60 + i })) } });
    const hook = await pay.stripeWebhook('charge.refunded', refundObj(2500, [`re_dash_${run}`]));
    ok(hook.status === 200, `2 #6 the signed charge.refunded webhook is accepted by the portal (${hook.status} ${hook.text || ''})`);
    const flaggedId = await until(() => sql(`select id from app.payment_refunds where payment_id = '${pay6}' and status = 'flagged'`), 30000);
    ok(Boolean(flaggedId), '2 #6 the worker records it as a FLAGGED refund');
    ok(sql(`select amount_cents || '|' || provider_ref || '|' || source from app.payment_refunds where id = '${flaggedId}'`) === `2500|re_dash_${run}|provider_dashboard`,
      '2 #6 for $25, with Stripe\'s refund reference');
    ok(sql(`select refunded_cents || '|' || status || '|' || (refund_approved_by is null) from app.payments where id = '${pay6}'`) === '0|captured|true',
      '2 #6 the payment is unchanged');
    ok(sql(`select string_agg(pledge_id || ':' || amount_cents, ',') from app.payment_allocations where payment_id = '${pay6}'`) === alloc6
       && sql(`select status from app.pledges where id = '${pledge6}'`) === 'paid', '2 #6 its allocations are unchanged (the pledge stays paid)');
    ok(audit(mark, 'payment_refunds.insert').startsWith('giving|job||Refund made in the Stripe dashboard'), `2 #6 audited as the background service: ${audit(mark, 'payment_refunds.insert')}`);
    ok(/refund made in Stripe flagged for approval/.test(sql(`select result::text from app.jobs where kind = 'payments.webhook.stripe' order by id desc limit 1`)),
      '2 #6 the webhook job says the refund was flagged');
    ok(/1 refund made in the Stripe\/PayPal dashboard waits for two approvals/.test(sql(`select app.check_payments_live('${jsh}')->>'detail'`)), '2 #6 readiness check 6 mentions it');

    await p.goto(BASE + '/giving/payments', { waitUntil: 'networkidle' });
    const flaggedCard = card(p, 'Refunds made in Stripe or PayPal — need approval');
    ok(await flaggedCard.isVisible() && (await flaggedCard.innerText()).includes(receipt6), '2 #6 Giving › Payments lists the flagged refund');
    await shot(p, '2-flagged-refund');
    await p.goto(BASE + '/', { waitUntil: 'networkidle' });
    ok(/Approve refund made in Stripe · \$25\.00/.test(await p.innerText('main')), '2 #6 Home › My tasks asks for the approval');
    await p.goto(BASE + '/giving/payments', { waitUntil: 'networkidle' });
    const frow = card(p, 'Refunds made in Stripe or PayPal — need approval').locator(`tr[data-refund="${flaggedId}"]`);
    await frow.getByLabel('Reason (kept in the audit log)').fill(`Donor asked for it by phone ${run}`);
    await submit(p, frow, 'Approve (first)', () => sql(`select first_approver from app.payment_refunds where id = '${flaggedId}'`) === adminUid);
    ok(sql(`select refunded_cents from app.payments where id = '${pay6}'`) === '0', '2 #6 after the first approval the payment is still unchanged');
    ok(audit(mark, 'payment_refunds.update') === `giving|portal|/giving/payments|Donor asked for it by phone ${run}`, '2 #6 the first approval is audited: portal, screen, reason');
    const sameAgain = await rpc(await admin.fresh(), 'approve_flagged_refund', { p_refund: flaggedId, p_reason: 'me again' });
    ok(sameAgain.status >= 400 && /different person/.test(JSON.stringify(sameAgain.body)), '2 #6 the same person cannot approve second');
    const second = await rpc(await kiran.fresh(), 'approve_flagged_refund', { p_refund: flaggedId, p_reason: `Checked in the Stripe dashboard ${run}` });
    ok(second.status === 200 && second.body && second.body.stage === 'applied', `2 #6 a different treasurer approves second (${second.status})`);
    ok(sql(`select refunded_cents || '|' || status || '|' || refund_approved_by || '|' || refund_second_approver from app.payments where id = '${pay6}'`)
       === `2500|partially_refunded|${adminUid}|${kiranUid}`, '2 #6 now the refund is recorded on the payment, naming both approvers');
    ok(audit(mark, 'payments.update', `and record_id = '${pay6}'`).endsWith(`Checked in the Stripe dashboard ${run}`), '2 #6 the recording is audited with the second reason');
    const again = await pay.stripeWebhook('charge.refunded', refundObj(2500, [`re_dash_${run}`]));
    await until(() => sql(`select count(*) from app.webhook_events where event_id = '${again.event.id}' and processed_at is not null`) === '1', 20000);
    ok(sql(`select count(*) from app.payment_refunds where payment_id = '${pay6}'`) === '1' && sql(`select refunded_cents from app.payments where id = '${pay6}'`) === '2500',
      '2 #6 the same refund reported again adds nothing');
    await p.reload({ waitUntil: 'networkidle' });
    ok((await p.getByRole('heading', { name: 'Refunds made in Stripe or PayPal — need approval' }).count()) === 0, '2 #6 nothing is left to approve');
    const row6 = p.locator('tr', { hasText: receipt6 }).last();
    ok(/Refund of \$25\.00 recorded/.test(await row6.innerText()) && (await row6.getByRole('button', { name: 'Refund through Stripe' }).count()) === 0,
      '2 #6 the payment offers no second refund through Stripe');
    const again6 = await rpc(await admin.fresh(), 'request_provider_refund', { p_payment: pay6, p_reason: 'again' });
    ok(again6.status >= 400 && /already recorded/.test(JSON.stringify(again6.body)), '2 #6 and the database refuses sending one (one refund request per payment)');

    // ── 3. #7 Email-only PayPal: record the refund by hand ────────────────
    sql(`insert into app.integration_connections (center_id, provider, status, settings)
         values ('${jsh}', 'paypal', 'connected', '{"mode":"test","connect_method":"email","paypal_email":"give@jsh.test"}')
         on conflict (center_id, provider) do update set status = 'connected', settings = excluded.settings;
         insert into app.center_payment_processors (center_id, processor, connection_id, status, methods)
         select '${jsh}', 'paypal', id, 'test', array['paypal'] from app.integration_connections where center_id = '${jsh}' and provider = 'paypal'
         on conflict (center_id, processor) do update set connection_id = excluded.connection_id, status = 'test';`);
    const pay7 = sql(`insert into app.payments (center_id, household_id, payer_person_id, amount_cents, method, status, provider, provider_ref, received_on, memo)
                      values ('${jsh}', '${shahHH}', '${priyaPerson}', 5100, 'paypal', 'captured', 'paypal', 'CAP-EMONEY-${run}', '${today}', 'Paid online · PayPal e2e') returning id`);
    const receipt7 = sql(`select receipt_number from app.payments where id = '${pay7}'`);
    await p.goto(BASE + '/giving/payments?provider=paypal', { waitUntil: 'networkidle' });
    let row7 = p.locator('tr', { hasText: receipt7 }).last();
    await row7.locator('summary', { hasText: 'Request refund…' }).click();
    await row7.getByLabel('Reason (the second approver reads this)').fill(`Duplicate gift ${run}`);
    await submit(p, row7, 'Request refund', () => sql(`select refund_approved_by from app.payments where id = '${pay7}'`) === adminUid);
    const second7 = await rpc(await kiran.fresh(), 'approve_as_second', { p_table: 'payments', p_id: pay7 });
    ok(second7.status < 300, `3 #7 the second treasurer approves the request (${second7.status})`);
    await p.goto(BASE + '/giving/payments?provider=paypal', { waitUntil: 'networkidle' });
    row7 = card(p, 'Refund requests').locator('tr', { hasText: receipt7 });
    ok(/connected by email only/.test(await row7.innerText()), '3 #7 the row explains PayPal is connected by email only and offers to record the refund');
    await shot(p, '3-paypal-record-form');
    await row7.getByLabel('Amount refunded in PayPal ($)').fill('51.00');
    await row7.getByLabel('Date PayPal made the refund').fill(today);
    await row7.getByLabel('PayPal transaction id of the refund').fill(`9EM${run.toUpperCase()}000000001`);
    await submit(p, row7, 'Record the PayPal refund', () => sql(`select refunded_cents from app.payments where id = '${pay7}'`) === '5100');
    ok(sql(`select p.status || '|' || r.source || '|' || r.provider_ref || '|' || r.first_approver || '|' || r.second_approver
              from app.payments p join app.payment_refunds r on r.payment_id = p.id where p.id = '${pay7}'`)
       === `refunded|manual_paypal|9EM${run.toUpperCase()}000000001|${adminUid}|${kiranUid}`, '3 #7 recorded with the PayPal id and both approvers');
    ok(audit(mark, 'payment_refunds.insert', `and after->>'source' = 'manual_paypal'`) === `giving|portal|/giving/payments|Duplicate gift ${run}`,
      '3 #7 audited: giving, portal, screen, reason');
    ok(sql(`select count(*) from app.jobs where kind = 'payments.refund' and payload->>'payment_id' = '${pay7}'`) === '0', '3 #7 nothing was sent to PayPal');

    // ── 4. QuickBooks: connect, map, and the explained test post (#10) ─────
    await fetch(`${intuit.base}/__mock/set`, { method: 'POST', body: JSON.stringify({
      addAccount: { Id: '10', Name: 'Pledge write-offs', FullyQualifiedName: 'Pledge write-offs', AccountType: 'Expense', AccountSubType: 'BadDebts', Classification: 'Expense' },
      addItem: { Id: '23', Name: 'Pledge write-off', IncomeAccountRef: { value: '10', name: 'Pledge write-offs' } },
      lists: {
        Customer: [{ Id: `E701${run}`, DisplayName: 'Shah Family (books)', PrimaryEmailAddr: { Address: 'priya@jsh.test' }, Active: true, Balance: 400 }],
        Invoice: [{ Id: `E7401${run}`, DocNumber: `INV-E7401${run}`, TxnDate: today, CustomerRef: { value: `E701${run}` }, TotalAmt: 400, Balance: 400, Line: [] }],
        SalesReceipt: [
          { Id: `E7101${run}`, DocNumber: `SR-E7101${run}`, TxnDate: '2025-01-10', CustomerRef: { value: `E701${run}` }, TotalAmt: 200, PaymentMethodRef: { name: 'Check' }, Line: [] },
          { Id: `E7102${run}`, DocNumber: `SR-E7102${run}`, TxnDate: '2025-02-10', CustomerRef: { value: `E701${run}` }, TotalAmt: 75, PaymentMethodRef: { name: 'Cash' }, Line: [] },
        ],
        RefundReceipt: [{ Id: `E7201${run}`, DocNumber: `RR-E7201${run}`, TxnDate: '2025-03-01', CustomerRef: { value: `E701${run}` }, TotalAmt: 75, PrivateNote: 'Returned the duplicate', Line: [] }],
        CreditMemo: [{ Id: `E7301${run}`, DocNumber: `CM-E7301${run}`, TxnDate: '2025-01-05', CustomerRef: { value: `E701${run}` }, TotalAmt: 25, RemainingCredit: 25, Line: [] }],
        Payment: [],
      },
    }) });
    sql(`update app.integration_connections set status = 'disconnected', settings = '{}', external_account_id = null where center_id = '${jsh}' and provider in ('quickbooks_online','intuit_sandbox');
         delete from app.integration_secrets where connection_id in (select id from app.integration_connections where center_id = '${jsh}' and provider in ('quickbooks_online','intuit_sandbox'));
         delete from app.qbo_account_mappings where center_id = '${jsh}';
         update app.funds set qbo_class_id = null where center_id = '${jsh}';`);   // classes of another test company
    const qboStart = sql('select now()');
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
    ok(await until(() => sql(`select status from app.integration_connections where id = '${conn}'`) === 'connected', 30000), '4 QuickBooks is connected (Intuit mock, worker token exchange)');
    ok(await until(() => sql(`select count(*) from app.qbo_accounts where connection_id = '${conn}' and qbo_id = '10'`) === '1', 30000), '4 the chart is pulled, with the Pledge write-offs account');
    let tok = await admin.fresh();
    const settings = await rpc(tok, 'set_qbo_settings', { p_center: jsh, p_basis: 'cash', p_posting: 'per_txn', p_go_live_date: sql(`select to_char('${today}'::date - 30, 'YYYY-MM-DD')`), p_reason: 'Cash basis, live from last month' });
    ok(settings.status < 300, `4 basis, posting and go-live date set (${settings.status} ${JSON.stringify(settings.body).slice(0, 120)})`);
    for (const [purpose, acct] of [['income.general', '1'], ['bank', '2'], ['undeposited_funds', '3'], ['payment_clearing', '4'], ['merchant_fees', '5'],
      ['store.sales', '7'], ['sales_tax_payable', '8'], ['pledge_writeoffs', '10']]) {
      const r = await rpc(tok, 'set_qbo_mapping', { p_center: jsh, p_purpose: purpose, p_qbo_account_id: acct, p_reason: 'Mapping for e2e' });
      if (r.status >= 300) ok(false, `4 map ${purpose}: ${JSON.stringify(r.body)}`);
    }
    tok = await admin.fresh();
    const approved = await rpc(tok, 'approve_qbo_mapping', { p_center: jsh, p_reason: `Checked against the chart ${run}` });
    ok(approved.status < 300 && sql(`select settings ? 'mapping_approved_at' from app.integration_connections where id = '${conn}'`) === 't',
      `4 the mapping, with "Pledge write-offs", is approved (${approved.status} ${approved.status >= 300 ? JSON.stringify(approved.body) : ''})`);

    await p.goto(BASE + '/accounting/qbo/setup', { waitUntil: 'networkidle' });
    const testCard = p.locator('section', { hasText: '6 · Test post' });
    const explained = await testCard.getByTestId('qbo-test-post-explained').innerText().catch(() => '');
    ok(/four real \$1\.00 entries/.test(explained) && /sales receipt, a refund receipt, a deposit and a journal entry/.test(explained) && /More › Void/.test(explained),
      '4 #10 before the test post, the screen explains the four real $1.00 entries and how to void them');
    await shot(p, '4-test-post-explained');
    const setupStep = sql(`select help from app.setup_steps where key = 'svc.quickbooks'`);
    ok(/four real \$1\.00 entries/.test(setupStep) && /More › Void/.test(setupStep), '4 #10 the Setup checklist step says it too');
    await testCard.locator('input[name=confirm_real]').check();
    await testCard.locator('#qbo-test-reason').fill('Checking the mapping before go-live');
    await testCard.getByRole('button', { name: 'Run the test post' }).click();
    const confirmDlg = p.getByRole('dialog').filter({ hasText: 'Please confirm' });
    const confirmShown = await confirmDlg.waitFor({ timeout: 8000 }).then(() => true, () => false);
    const confirmText = confirmShown ? await confirmDlg.innerText() : '';
    ok(confirmShown && /Post four real \$1\.00 entries/.test(confirmText) && /More › Void/.test(confirmText), '4 #10 the confirmation says it again before anything is posted');
    await shot(p, '4-test-post-confirm');
    await confirmDlg.getByRole('button').last().click();
    const queuedMsg = await until(async () => {
      if (await stepUp.isVisible().catch(() => false)) {
        await stepUp.getByLabel('Code from your authenticator app').fill(await freshTotp(admin.secret));
        await stepUp.getByRole('button', { name: 'Verify and continue' }).click();
      }
      return p.getByText(/Test post queued: it creates four real \$1\.00 entries/).first().isVisible().catch(() => false);
    }, 25000, 200);
    ok(queuedMsg, '4 #10 and the message after it repeats how to void them');
    const testId = await until(() => sql(`select id from app.qbo_test_posts where connection_id = '${conn}' and status = 'succeeded' and requested_at > '${qboStart}' order by requested_at desc limit 1`), 30000);
    ok(Boolean(testId), '4 the test post succeeds (four $1.00 entries in the mock company)');
    const tApprove = await rpc(await admin.fresh(), 'approve_qbo_test_post', { p_test: testId, p_reason: 'All four entries checked and voided in QuickBooks' });
    ok(tApprove.status < 300 && sql(`select (app.qbo_post_ready('${jsh}')->>'ok')`) === 'true',
      `4 test post approved: QuickBooks is ready to post (${tApprove.status} ${tApprove.status >= 300 ? JSON.stringify(tApprove.body) : ''})`);

    // ── 5. #11 History with a refund receipt and a credit memo ────────────
    const pulled = await rpc(await admin.fresh(), 'qbo_request_pull', { p_center: jsh });
    ok(pulled.status < 300 || /already/.test(JSON.stringify(pulled.body)), `5 donor history pull requested (${pulled.status})`);
    ok(await until(() => sql(`select count(*) from app.qbo_transactions where center_id = '${jsh}' and customer_qbo_id = 'E701${run}'`) === '5', 40000),
      '5 the customer\'s receipts, refund receipt, credit memo and invoice are copied');
    const mapped = await rpc(await admin.fresh(), 'map_qbo_customer', { p_center: jsh, p_qbo_customer: `E701${run}`, p_household: shahHH, p_person: null, p_reason: `Same family ${run}` });
    ok(mapped.status < 300, `5 the treasurer maps the QuickBooks customer to the Shah family (${mapped.status} ${JSON.stringify(mapped.body).slice(0, 160)})`);
    ok(await until(() => sql(`select cc_status from app.qbo_transactions where center_id = '${jsh}' and qbo_id = 'E7201${run}'`) === 'brought_in', 40000),
      '5 #11 the refund receipt is brought in');
    ok(sql(`select refunded_cents || '|' || status || '|' || is_historical from app.payments where center_id = '${jsh}' and crm_external_id = 'qbo:SalesReceipt:E7102${run}'`) === '7500|refunded|true',
      '5 #11 ...as a historical refund reducing the $75 receipt it matches');
    ok(sql(`select refunded_cents from app.payments where center_id = '${jsh}' and crm_external_id = 'qbo:SalesReceipt:E7101${run}'`) === '0', '5 #11 the other receipt is untouched');
    ok(sql(`select source || '|' || status from app.payment_refunds where provider = 'quickbooks' and provider_ref = 'qbo:RefundReceipt:E7201${run}'`) === 'qbo_history|applied',
      '5 #11 recorded with its QuickBooks reference');
    ok(sql(`select count(*) from app.ledger_postings l join app.payments pa on pa.id = l.source_id where pa.center_id = '${jsh}' and pa.provider = 'quickbooks'`) === '0',
      '5 #11 nothing is posted back to QuickBooks');
    ok(/^needs_review\|No payment brought in/.test(sql(`select cc_status || '|' || cc_detail from app.qbo_transactions where center_id = '${jsh}' and qbo_id = 'E7301${run}'`)),
      '5 #11 the credit memo with no payment before it waits in Needs review');
    await p.goto(BASE + '/accounting/qbo/matching?tab=review', { waitUntil: 'networkidle' });
    ok(/No payment brought in from this QuickBooks customer/.test(await p.innerText('main')), '5 #11 Needs review shows the reason');
    await shot(p, '5-needs-review');

    // ── 6. Write-off → QuickBooks ─────────────────────────────────────────
    const invPledge = await until(() => sql(`select id from app.pledges where center_id = '${jsh}' and crm_external_id = 'qbo:Invoice:E7401${run}'`), 20000);
    ok(Boolean(invPledge), '6 the open QuickBooks invoice is a pledge on the household');
    const cashPledge = sql(`insert into app.pledges (center_id, household_id, pledged_by_person_id, source, amount_cents, pledged_at)
                            values ('${jsh}', '${shahHH}', '${priyaPerson}', 'general', 30000, now()) returning id`);
    const woNumbers = JSON.parse(sql(`select json_object_agg(id, pledge_number) from app.pledges where id in ('${invPledge}', '${cashPledge}')`));
    for (const id of [invPledge, cashPledge]) {
      await p.goto(BASE + '/giving/pledges?status=open', { waitUntil: 'networkidle' });
      const r = p.locator('tr', { hasText: woNumbers[id] }).last();
      await r.locator('summary', { hasText: 'Write off…' }).click();
      await r.getByLabel('Reason (the second approver reads this)').fill(`Family moved away ${run}`);
      await submit(p, r, 'Request write-off', () => sql(`select written_off_by from app.pledges where id = '${id}'`) === adminUid);
      const s2 = await rpc(await kiran.fresh(), 'approve_as_second', { p_table: 'pledges', p_id: id });
      ok(s2.status < 300, `6 the second treasurer approves the write-off of ${woNumbers[id]} (${s2.status})`);
      await p.goto(BASE + '/giving/pledges?status=open', { waitUntil: 'networkidle' });
      const r2 = p.locator('tr', { hasText: woNumbers[id] }).last();
      await submit(p, r2, 'Complete write-off', () => sql(`select status from app.pledges where id = '${id}'`) === 'written_off');
    }
    const woPost = sql(`select id from app.ledger_postings where source_id = '${invPledge}' and txn_type = 'pledge_writeoff'`);
    ok(Boolean(woPost), '6 completing the write-off queued one pledge_writeoff posting');
    ok(await until(() => sql(`select status from app.ledger_postings where id = '${woPost}'`) === 'posted', 40000), '6 the worker posted it');
    const made = intuit.state.created.filter((c) => c.requestId === woPost || c.requestId === `${woPost}-apply`);
    const cm = made.find((c) => c.entity === 'CreditMemo');
    const ap = made.find((c) => c.entity === 'Payment');
    ok(cm && cm.doc.CustomerRef.value === `E701${run}` && cm.doc.TotalAmt === 400 && cm.doc.Line[0].SalesItemLineDetail.ItemRef.value === '23',
      '6 QuickBooks got a $400 CreditMemo to the invoice\'s customer, through the Pledge write-off item');
    ok(ap && ap.doc.TotalAmt === 0 && ap.doc.Line.some((l) => l.LinkedTxn[0].TxnType === 'Invoice' && l.LinkedTxn[0].TxnId === `E7401${run}`)
       && ap.doc.Line.some((l) => l.LinkedTxn[0].TxnType === 'CreditMemo' && l.LinkedTxn[0].TxnId === cm.doc.Id),
      '6 ...applied to invoice E7401${run} with a $0 Payment');
    ok(sql(`select qbo_entity || '|' || qbo_ref from app.ledger_postings where id = '${woPost}'`) === `CreditMemo|${cm && cm.doc.Id}`, '6 the posting records the credit memo id');
    const beforeRetry = intuit.state.created.length;
    sql(`update app.ledger_postings set status = 'queued' where id = '${woPost}'`);   // as if QuickBooks' answer had been lost
    await until(() => sql(`select status from app.ledger_postings where id = '${woPost}'`) === 'posted', 40000);
    ok(intuit.state.created.filter((c) => c.requestId === woPost || c.requestId === `${woPost}-apply`).length === 2 && intuit.state.created.length === beforeRetry,
      '6 posted again, QuickBooks returns the first ones: one credit memo, never two');
    ok(/^skipped\|Nothing to post: the books are on cash basis/.test(sql(`select status || '|' || last_error from app.ledger_postings where source_id = '${cashPledge}' and txn_type = 'pledge_writeoff'`)),
      '6 the cash-basis pledge that never was in QuickBooks is skipped, with the reason');
    ok(sql(`select count(*) from app.audit_log where id > ${mark} and action = 'ledger_postings.update' and record_id = '${woPost}' and client_app = 'job' and module = 'accounting'`) !== '0',
      '6 the posting is audited as the background service');
    await p.goto(BASE + '/giving/pledges?status=closed', { waitUntil: 'networkidle' });
    const wo1 = await p.locator('tr', { hasText: woNumbers[invPledge] }).last().innerText();
    const wo2 = await p.locator('tr', { hasText: woNumbers[cashPledge] }).last().innerText();
    ok(/QuickBooks: credit memo #\S+ posted/.test(wo1), `6 the pledge shows the credit memo: ${wo1.replace(/\s+/g, ' ').slice(0, 160)}`);
    ok(/QuickBooks: nothing posted — Nothing to post: the books are on cash basis/.test(wo2), '6 the cash-basis pledge shows why nothing was posted');
    await shot(p, '6-writeoffs');
    await p.goto(BASE + '/accounting/qbo?status=posted', { waitUntil: 'networkidle' });
    ok(/Pledge write-off/.test(await p.innerText('main')), '6 QuickBooks sync lists the pledge write-off');

    // ── 7. #24 Pledge history import ──────────────────────────────────────
    tok = await admin.fresh();
    const prun = (await rpc(tok, 'import_create_run', { p_center: jsh, p_entity: 'pledges', p_source: 'csv', p_file_name: `neon-pledges-${run}.csv` })).body.id;
    const stage = await rpc(tok, 'import_stage_rows', { p_run: prun, p_rows: [
      { row_no: 1, source_key: `E24-${run}-1`, data: { crm_external_id: `E24-${run}-1`, household_id: shahHH, amount_cents: 100000, source: 'general', pledged_at: '2019-08-30' }, extra: { paid_so_far: 60000 } },
      { row_no: 2, source_key: `E24-${run}-2`, data: { crm_external_id: `E24-${run}-2`, household_id: shahHH, amount_cents: 50000, source: 'general', pledged_at: '2018-01-15',
        status: 'written_off', closed_at: '2021-06-30', written_off_by_name: 'R. Mehta (old treasurer)', write_off_reason: 'Family moved to India' }, extra: { paid_so_far: 20000 } },
    ] });
    ok(stage.status < 300, `7 #24 two pledges staged, one written off (${stage.status} ${JSON.stringify(stage.body).slice(0, 120)})`);
    await rpc(tok, 'import_preview', { p_run: prun });
    await rpc(tok, 'import_commit_batch', { p_run: prun, p_limit: 100 });
    const pl1 = sql(`select id from app.pledges where center_id = '${jsh}' and crm_external_id = 'E24-${run}-1'`);
    ok(sql(`select status || '|' || closed_at::date || '|' || paid_cents || '|' || written_off_by_name || '|' || write_off_reason from app.pledges where center_id = '${jsh}' and crm_external_id = 'E24-${run}-2'`)
       === 'written_off|2021-06-30|20000|R. Mehta (old treasurer)|Family moved to India', '7 #24 the written-off pledge imports written off, closed, unpaid, with who/when/why');
    const yrun = (await rpc(tok, 'import_create_run', { p_center: jsh, p_entity: 'payments', p_source: 'csv', p_file_name: `neon-payments-${run}.csv` })).body.id;
    await rpc(tok, 'import_stage_rows', { p_run: yrun, p_rows: [
      { row_no: 1, source_key: `R24-${run}-1`, data: { crm_external_id: `R24-${run}-1`, household_id: shahHH, amount_cents: 10000, method: 'check', received_on: '2023-03-01' }, extra: { allocate_to: pl1 } },
    ] });
    await rpc(tok, 'import_preview', { p_run: yrun });
    await rpc(tok, 'import_commit_batch', { p_run: yrun, p_limit: 100 });
    ok(sql(`select paid_cents from app.pledges where id = '${pl1}'`) === '10000', '7 #24 after the payment history the pledge shows only the $100 it paid');
    await p.goto(`${BASE}/settings/import/${prun}`, { waitUntil: 'networkidle' });
    const reconcileBtn = p.getByRole('button', { name: 'Compare with the file' });
    if (await reconcileBtn.isVisible().catch(() => false)) { await reconcileBtn.click(); await p.getByRole('button', { name: 'Compare again' }).waitFor({ timeout: 20000 }); }
    const ob = p.getByTestId('opening-balances');
    ok(/2 pledges were paid partly before the imported payment history \(\$700\.00 in all\)/.test(await ob.innerText().catch(() => '')),
      '7 #24 the pledges import offers the opening balances: $500 + $200');
    await shot(p, '7-opening-balances');
    await ob.getByLabel('Why (kept in the audit log)').fill(`Paid before our 2023 history ${run}`);
    await ob.getByRole('button', { name: 'Bring in opening balances' }).click();
    ok(await until(() => sql(`select count(*) from app.payments p join app.payment_allocations a on a.payment_id = p.id
                               join app.pledges pl on pl.id = a.pledge_id where pl.crm_external_id like 'E24-${run}-%' and p.is_opening_balance`) === '2', 20000),
      '7 #24 one opening-balance line per pledge');
    ok(sql(`select p.amount_cents || '|' || p.is_historical || '|' || p.received_on from app.payments p join app.payment_allocations a on a.payment_id = p.id
             where a.pledge_id = '${pl1}' and p.is_opening_balance`) === '50000|true|2023-02-28', '7 #24 the pledge\'s line: $500, historical, dated before its first imported payment');
    ok(sql(`select paid_cents || '|' || status from app.pledges where id = '${pl1}'`) === '60000|partially_paid', '7 #24 the pledge now shows the $600 paid so far');
    ok(sql(`select count(*) from app.ledger_postings l join app.payments p on p.id = l.source_id where p.is_opening_balance`) === '0', '7 #24 opening lines are never posted to QuickBooks');
    ok(audit(mark, 'payments.insert', `and after->>'is_opening_balance' = 'true'`).includes(`|import|`) && audit(mark, 'payments.insert', `and after->>'is_opening_balance' = 'true'`).includes(`Paid before our 2023 history ${run}`),
      '7 #24 audited as an import, with the reason');
    await p.goto(`${BASE}/settings/import/${prun}`, { waitUntil: 'domcontentloaded' });
    ok(await p.getByText(/Opening balances are in: 2 pledges/).first().waitFor({ timeout: 30000 }).then(() => true, () => false),
      '7 #24 the import says the opening balances are in');
  } finally {
    const exited = new Promise((r) => worker.on('exit', (code) => r(code)));
    worker.kill('SIGTERM');
    ok((await exited) === 0, 'the worker stops cleanly');
    fs.writeFileSync(`${OUT}/worker.log`, logs.join('\n') + '\n');
    await b.close();
    await pay.close().catch(() => {});
    await intuit.close().catch(() => {});
    sql(`delete from app.role_grants where center_id = '${jsh}' and user_id = '${kiranUid}' and role_key = 'treasurer'`);
  }
  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
})().catch((err) => { console.error(err); process.exit(1); });
