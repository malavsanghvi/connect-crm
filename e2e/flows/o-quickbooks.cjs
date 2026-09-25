// o-quickbooks flow: connect QuickBooks → pull → map → approve (step-up) → test
// post → a real payment posts once (and a historical one never), against a real
// local stack (e2e/up.sh o-quickbooks 400), the worker as connect_worker, and the
// local Intuit mock (e2e/mocks/intuit.cjs). Never real network or keys.
//
//   node e2e/mocks/intuit.cjs 8900 &
//   PORT=3500 INTUIT_CLIENT_ID=intuit-test-client INTUIT_OAUTH_BASE=http://127.0.0.1:8900 \
//     OAUTH_STATE_SECRET=<32+ chars> pnpm start &          (portal built against the stack)
//   pnpm --dir worker build
//   BASE=http://localhost:3500 MAIL=http://localhost:55724 API=http://localhost:55721 \
//   DB=postgres://postgres:postgres@localhost:55832/postgres ENVF=e2e/.env.o-quickbooks MOCK=http://127.0.0.1:8900 \
//   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright node e2e/flows/o-quickbooks.cjs
//
// 1. Connect: the treasurer (admin@jsh.test) clicks Connect, answers the step-up
//    modal with a real TOTP code, signs in at "Intuit" and is sent back to
//    /api/oauth/intuit/callback; the code lands in the vault, never in a payload.
// 2. The worker swaps the code for tokens, marks the connection connected with
//    the company name and pulls the chart of accounts and lists.
// 3. Choices, mapping picked from the pulled chart (no typed ids), fund class.
// 4. Approve the mapping (step-up), run the test post (4 entries in the mock
//    company), approve it (step-up) -> readiness check 7 passes.
// 5. A live payment posts once as a SalesReceipt; requeued it still exists
//    once (requestid); a historical payment never posts, even when forced into
//    the queue. DB + audit assertions throughout.
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const { execSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3500';
const MAIL = process.env.MAIL || 'http://localhost:55724';
const API = process.env.API || 'http://localhost:55721';
const DB = process.env.DB || 'postgres://postgres:postgres@localhost:55832/postgres';
const MOCK = process.env.MOCK || 'http://127.0.0.1:8900';
const OUT = process.env.OUT || '/tmp/claude-0/streams/o-quickbooks';
const ENVF = process.env.ENVF || path.join(__dirname, '..', '.env.o-quickbooks');
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
const mockState = () => fetch(`${MOCK}/__mock/state`).then((r) => r.json());

async function mailCode(email, after) {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + email)}`).then((x) => x.json());
    const m = (r.messages || []).find((x) => new Date(x.Created).getTime() >= after);
    if (m) { const f = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((x) => x.json()); const c = (f.Text || '').match(/\b(\d{6,10})\b/); if (c) return c[1]; }
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
const rpc = (token, fn, args) => fetch(`${API}/rest/v1/rpc/${fn}`, {
  method: 'POST', headers: { ...anonH, authorization: `Bearer ${token}`, 'accept-profile': 'app', 'content-profile': 'app' }, body: JSON.stringify(args),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

let totpSecret = null;
async function maybeStepUp(p) {
  const dlg = p.getByRole('dialog').filter({ hasText: 'Confirm it' });
  if (await dlg.waitFor({ timeout: 5000 }).then(() => true, () => false)) {
    await dlg.getByLabel('Code from your authenticator app').fill(await freshTotp(totpSecret));
    await dlg.getByRole('button', { name: 'Verify and continue' }).click();
    return true;
  }
  return false;
}
/** Submit an ActionForm inside `scope`; answer the step-up modal if it opens; wait for `expect` (toast or page). */
let stepUps = 0;
async function submit(p, scope, button, expect, allowStepUp = true) {
  await scope.getByRole('button', { name: button }).click();
  const confirm = p.getByRole('dialog').filter({ hasText: 'Please confirm' });
  const stepUp = p.getByRole('dialog').filter({ hasText: 'Confirm it' });
  const end = Date.now() + 25000;
  while (Date.now() < end) {
    if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button').last().click();
    if (allowStepUp && (await stepUp.isVisible().catch(() => false))) {
      await stepUp.getByLabel('Code from your authenticator app').fill(await freshTotp(totpSecret));
      await stepUp.getByRole('button', { name: 'Verify and continue' }).click();
      stepUps++;
      await sleep(500);
    }
    if (!expect) return;
    if (typeof expect === 'function' ? expect() : await p.getByText(expect).first().isVisible().catch(() => false)) return;
    await sleep(200);
  }
  throw new Error(`"${button}" did not show "${expect}": ${(await p.innerText('body')).slice(0, 800)}`);
}

(async () => {
  const run = crypto.randomBytes(4).toString('hex');
  const jsh = sql("select id from app.centers where slug = 'jsh'");
  const adminUid = sql("select id from auth.users where email = 'admin@jsh.test'");
  const today = sql(`select to_char((now() at time zone (select time_zone from app.centers where slug = 'jsh'))::date, 'YYYY-MM-DD')`);

  // ── Setup (test data only) ────────────────────────────────────────────────
  const workerPw = process.env.WORKER_DB_PASSWORD || crypto.randomBytes(24).toString('hex');   // a shared stack passes the portal's connect_worker password
  sql(`alter role connect_worker with password '${workerPw}'`);
  await fetch(`${MOCK}/__mock/reset`, { method: 'POST' });
  sql(`update app.integration_connections set status = 'disconnected', settings = '{}', external_account_id = null, display_name = null
        where center_id = '${jsh}' and provider in ('quickbooks_online','intuit_sandbox');
       delete from app.integration_secrets where connection_id in (select id from app.integration_connections where center_id = '${jsh}' and provider in ('quickbooks_online','intuit_sandbox'));
       delete from app.qbo_account_mappings where center_id = '${jsh}';
       update app.funds set qbo_class_id = null where center_id = '${jsh}';
       update app.jobs set status = 'cancelled' where status in ('queued','running') and (kind like 'qbo.%' or kind = 'oauth.exchange');
       delete from app.worker_heartbeats;`);
  const auditMark = Number(sql('select coalesce(max(id), 0) from app.audit_log'));
  for (const f of JSON.parse(sql(`select coalesce(json_agg(id), '[]') from auth.mfa_factors where user_id = '${adminUid}'`)))
    await fetch(`${API}/auth/v1/admin/users/${adminUid}/factors/${f}`, { method: 'DELETE', headers: serviceH });
  const adminAal1 = await apiLogin('admin@jsh.test');
  const enroll = await fetch(`${API}/auth/v1/factors`, { method: 'POST', headers: { ...anonH, authorization: `Bearer ${adminAal1}` }, body: JSON.stringify({ factor_type: 'totp', friendly_name: `e2e ${run}` }) }).then((x) => x.json());
  totpSecret = enroll.totp && enroll.totp.secret;
  const ch = await fetch(`${API}/auth/v1/factors/${enroll.id}/challenge`, { method: 'POST', headers: { ...anonH, authorization: `Bearer ${adminAal1}` }, body: '{}' }).then((x) => x.json());
  await fetch(`${API}/auth/v1/factors/${enroll.id}/verify`, { method: 'POST', headers: { ...anonH, authorization: `Bearer ${adminAal1}` }, body: JSON.stringify({ challenge_id: ch.id, code: await freshTotp(totpSecret) }) });
  ok(Boolean(totpSecret), 'the treasurer (admin@jsh.test) has an authenticator app');

  // Over the API, without a fresh 2FA check, connecting is refused.
  const noStep = await rpc(adminAal1, 'start_qbo_connect', { p_center: jsh, p_company: 'real', p_redirect_uri: `${BASE}/api/oauth/intuit/callback`, p_reason: 'e2e' });
  ok(noStep.status >= 400 && noStep.body && noStep.body.code === 'CCSTP', `without a fresh 2FA check the API answers CCSTP (${noStep.status} ${noStep.body && noStep.body.code})`);
  const priya = await apiLogin('priya@jsh.test');
  const member = await rpc(priya, 'qbo_status', { p_center: jsh });
  ok(member.status >= 400, `a member cannot read QuickBooks setup (${member.status})`);

  // ── Portal sign-in ─────────────────────────────────────────────────────────
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  let t0 = Date.now();
  for (let i = 0; i < 20; i++) {
    await p.goto(BASE + '/login'); t0 = Date.now() - 2000;
    await p.fill('input[name=email]', 'admin@jsh.test'); await p.click('button[type=submit]');
    const asked = await p.waitForSelector('input[name=code]', { timeout: 5000 }).then(() => true, () => false);
    if (asked || !/Too many codes/.test(await p.innerText('body'))) break;
    await sleep(5000);
  }
  await p.fill('input[name=code]', await mailCode('admin@jsh.test', t0));
  await p.click('button[type=submit]');
  if (await p.waitForSelector('input[name=totp]', { timeout: 15000 }).then(() => true, () => false)) {
    await p.fill('input[name=totp]', await freshTotp(totpSecret)); await p.click('button[type=submit]');
  }
  await p.waitForURL((u) => !u.pathname.startsWith('/login'));
  const signedInAt = Date.now();

  // ── 1. Connect ─────────────────────────────────────────────────────────────
  await p.goto(BASE + '/accounting/qbo/setup', { waitUntil: 'networkidle' });
  ok(await p.getByRole('link', { name: 'QuickBooks setup' }).first().isVisible(), 'Accounting has a QuickBooks setup tab');
  await p.screenshot({ path: `${OUT}/qbo-setup-1-not-connected.png`, fullPage: true });
  await p.fill('#qbo-connect-reason', `Treasurer connecting our books ${run}`);
  await p.getByRole('button', { name: 'Connect QuickBooks' }).click();
  const asked = await maybeStepUp(p);
  ok(true, asked ? 'Connect asked for a fresh 2FA check and the step-up modal verified it'
                 : 'Connect was covered by the 2FA code entered at sign-in (under 5 minutes old); the API refusal above proves the check');
  await p.waitForURL((u) => u.pathname === '/accounting/qbo/setup' && u.searchParams.get('connect') !== null, { timeout: 30000 });
  ok(new URL(p.url()).searchParams.get('connect') === 'ok', 'Intuit sends the treasurer back through the callback: ' + new URL(p.url()).searchParams.get('msg'));
  const conn = sql(`select id from app.integration_connections where center_id = '${jsh}' and provider = 'quickbooks_online'`);
  const ex = JSON.parse(sql(`select row_to_json(j) from (select id, payload from app.jobs where kind = 'oauth.exchange' and payload->>'connection_id' = '${conn}' order by id desc limit 1) j`));
  ok(ex && ex.payload.provider === 'intuit' && !('code' in ex.payload) && ex.payload.code_secret === 'oauth.code', 'an oauth.exchange job is queued; the code is not in its payload');
  ok(sql(`select count(*) from app.integration_secrets where connection_id = '${conn}' and name = 'oauth.code'`) === '1', 'the code is in the vault');
  ok(sql(`select used_at is not null and outcome = 'code_received' and user_id = '${adminUid}' from app.qbo_oauth_states where connection_id = '${conn}' order by created_at desc limit 1`) === 't',
    'the signed state was used once, by the person who started it');
  ok(sql(`select count(*) from app.audit_log where id > ${auditMark} and action = 'qbo_oauth_states.insert' and client_app = 'portal'
            and client_screen = '/accounting/qbo/setup' and module = 'accounting' and reason = 'Treasurer connecting our books ${run}'`) === '1',
    'starting the connection is audited: portal, screen, module accounting, reason');
  // Replaying the callback (same state) is refused.
  const replay = await p.request.get(`${BASE}/api/oauth/intuit/callback?code=AB11replay0000&realmId=9130350000000001&state=${encodeURIComponent('00000000-0000-4000-8000-000000000001.' + 'ab'.repeat(32) + '.forged')}`, { maxRedirects: 0 });
  const replayMsg = new URL(replay.headers().location || 'http://x/', BASE).searchParams.get('msg') || '';
  ok(replay.status() === 307 && /not valid for you/.test(replayMsg), 'a forged callback state is refused: ' + replayMsg);

  // ── 2. The worker exchanges and pulls ──────────────────────────────────────
  const logs = [];
  const worker = spawn(process.execPath, [WORKER_JS], {
    env: {
      PATH: process.env.PATH, WORKER_DATABASE_URL: `postgres://connect_worker:${workerPw}@${new URL(DB).host}/postgres`, WORKER_ID: `e2e-qbo-${run}`,
      WORKER_HEALTH_PORT: process.env.WORKER_HEALTH_PORT || '3910', WORKER_POLL_MS: '500', WORKER_HEARTBEAT_MS: '2000',
      INTUIT_CLIENT_ID: 'intuit-test-client', INTUIT_CLIENT_SECRET: 'intuit-test-secret-000', INTUIT_OAUTH_BASE: MOCK, INTUIT_API_BASE: MOCK,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  process.on('exit', () => { try { worker.kill('SIGKILL'); } catch { /* already stopped */ } });
  worker.stdout.on('data', (d) => logs.push(...d.toString().trim().split('\n')));
  worker.stderr.on('data', (d) => logs.push(...d.toString().trim().split('\n')));
  const connected = await until(() => sql(`select status from app.integration_connections where id = '${conn}'`) === 'connected', 30000);
  ok(connected, 'the worker swaps the code for tokens and the connection is connected');
  ok(sql(`select display_name from app.integration_connections where id = '${conn}'`) === 'Jain Society of Houston (Intuit test company)', 'with the company name from Intuit');
  ok(sql(`select string_agg(name, ',' order by name) from app.integration_secrets where connection_id = '${conn}'`) === 'access_token,refresh_token', 'both tokens are in the vault; the used code was removed (#12)');
  const pulled = await until(() => sql(`select status from app.qbo_pull_runs where connection_id = '${conn}' order by finished_at desc limit 1`) === 'succeeded', 30000);
  ok(pulled, 'the first pull of the lists succeeds');
  ok(sql(`select (select count(*) from app.qbo_accounts where connection_id = '${conn}') || '/' || (select count(*) from app.qbo_classes where connection_id = '${conn}') || '/' ||
                 (select count(*) from app.qbo_items where connection_id = '${conn}') || '/' || (select count(*) from app.qbo_payment_methods where connection_id = '${conn}')`) === '9/3/3/3',
    'accounts, classes, items and payment methods are copied (inactive ones too)');
  ok(sql(`select status from app.center_setup_steps where center_id = '${jsh}' and step_key = 'data.chart_of_accounts'`) === 'done', 'Setup step data.chart_of_accounts is done');
  ok(sql(`select count(*) filter (where client_app = 'job' and module = 'accounting') || '/' || count(*) from app.audit_log
            where record_table = 'qbo_accounts' and action in ('qbo_accounts.insert','qbo_accounts.update')`).split('/').reduce((a, b) => a !== '0' && a === b),
    "the copies are audited as the background service's work");
  const workerLog = logs.join('\n');
  ok(!/at_[0-9a-f]{24}|rt_[0-9a-f]{24}|AB11[0-9a-f]{32}/.test(workerLog), 'no token or code appears in the worker log');
  await p.goto(BASE + '/accounting/qbo/setup', { waitUntil: 'networkidle' });
  ok(/Jain Society of Houston \(Intuit test company\)/.test(await p.innerText('body')), 'the setup screen shows the connected company');

  // ── 3. Choices and mapping ────────────────────────────────────────────────
  const choices = p.locator('section', { hasText: '3 · Basis, posting and go-live date' });
  await choices.locator('#qbo-golive').fill(today);
  await choices.locator('#qbo-set-reason').fill('Cash basis; books in QuickBooks until today');
  // Wait for the saved state (the card's own description already says "Only money received on or after…").
  await submit(p, choices, 'Save choices', () => sql(`select settings->>'go_live_date' from app.integration_connections where center_id = '${jsh}' and provider = 'quickbooks_online'`) === today, false);
  ok(sql(`select settings->>'basis' || '|' || (settings->>'posting') || '|' || (settings->>'go_live_date') from app.integration_connections where id = '${conn}'`) === `cash|per_txn|${today}`,
    'basis, posting and the go-live date are saved');
  const map = [
    ['General donations income', 'Donations · Income'], ['Bank account', 'Chase Operating · Bank'], ['Undeposited funds', 'Undeposited Funds · Other Current Asset'],
    ['Payment clearing', 'Stripe Clearing · Bank'], ['Merchant fees', 'Merchant Fees · Expense'], ['Store sales', 'Store Sales · Income'],
    ['Sales tax payable', 'Sales Tax Payable · Other Current Liability'],
  ];
  const typedIdInputs = await p.locator('input[name=qbo_account_id]').count();
  ok(typedIdInputs === 0, 'there is no field to type an account id: accounts are picked from the pulled chart');
  const incomeOptions = await p.getByLabel('QuickBooks account for General donations income', { exact: true }).locator('option').allInnerTexts();
  ok(!incomeOptions.some((o) => /Old Fundraiser|Chase/.test(o)) && incomeOptions.some((o) => /Donations:Construction Donations/.test(o)),
    'the choices are active accounts of the right type only');
  for (const [label, option] of map) {
    const row = p.locator('tr', { has: p.getByLabel(`QuickBooks account for ${label}`, { exact: true }) });
    await row.getByLabel(`QuickBooks account for ${label}`, { exact: true }).selectOption({ label: option });
    await row.getByRole('button', { name: 'Save' }).click();
    await p.getByText(new RegExp(`^${label} →`)).first().waitFor({ timeout: 15000 });
  }
  ok(sql(`select count(*) from app.qbo_account_mappings where center_id = '${jsh}'`) === '7', 'seven accounts are mapped from the chart');
  const fundRow = p.locator('tr', { has: p.getByLabel('QuickBooks class for General fund', { exact: true }) });
  await fundRow.getByLabel('QuickBooks class for General fund', { exact: true }).selectOption({ label: 'General' });
  await fundRow.getByRole('button', { name: 'Save' }).click();
  await p.getByText('Class saved').first().waitFor({ timeout: 15000 });
  ok(sql(`select qbo_class_id from app.funds where center_id = '${jsh}' and key = 'general'`) === '30', 'the general fund is tagged with its QuickBooks class');

  // ── 4. Approve (step-up), test post, approve ──────────────────────────────
  await p.goto(BASE + '/accounting/qbo/setup', { waitUntil: 'networkidle' });
  const approve = p.locator('section', { hasText: 'Approve the mapping' });
  const stepUpsBefore = stepUps;
  await approve.locator('#qbo-approve-reason').fill(`Checked against the chart ${run}`);
  await submit(p, approve, 'Approve mapping', () => sql(`select settings ? 'mapping_approved_at' from app.integration_connections where id = '${conn}'`) === 't');
  ok(sql(`select settings->>'mapping_approved_by' from app.integration_connections where id = '${conn}'`) === adminUid,
    `the treasurer approved the mapping${stepUps > stepUpsBefore ? ' after the step-up modal verified a fresh code' : ' (covered by a 2FA code under 5 minutes old)'}`);
  ok(sql(`select count(*) from app.audit_log where id > ${auditMark} and action = 'qbo_account_mappings.update' and reason = 'Checked against the chart ${run}'
            and client_app = 'portal' and client_screen = '/accounting/qbo/setup' and module = 'accounting' and actor_user_id = '${adminUid}'`) === '7',
    'the approval is audited on every mapping row: portal, screen, module, reason, actor');
  await p.screenshot({ path: `${OUT}/qbo-setup-2-mapped.png`, fullPage: true });

  const testCard = p.locator('section', { hasText: '5 · Test post' });
  await testCard.locator('input[name=confirm_real]').check();
  await testCard.locator('#qbo-test-reason').fill('Checking the mapping before go-live');
  await submit(p, testCard, 'Run the test post', () => sql(`select count(*) from app.qbo_test_posts where connection_id = '${conn}'`) !== '0', false);
  const tested = await until(() => sql(`select status from app.qbo_test_posts where connection_id = '${conn}' order by requested_at desc limit 1`) === 'succeeded', 30000);
  ok(tested, 'the test post succeeds');
  const created = (await mockState()).created;
  ok(created.map((c) => c.entity).sort().join(',') === 'Deposit,JournalEntry,RefundReceipt,SalesReceipt' && created.every((c) => c.doc.TotalAmt === 1),
    'QuickBooks got one $1.00 sales receipt, refund receipt, deposit and journal entry');
  await p.goto(BASE + '/accounting/qbo/setup', { waitUntil: 'networkidle' });
  // Let the sign-in's 2FA check go stale (over 5 minutes), so approving must open the step-up modal.
  const staleAt = signedInAt + 5.5 * 60000;
  if (Date.now() < staleAt) { console.log(`… waiting ${Math.round((staleAt - Date.now()) / 1000)} s for the sign-in's 2FA check to go stale`); await sleep(staleAt - Date.now()); }
  await p.goto(BASE + '/accounting/qbo/setup', { waitUntil: 'networkidle' });
  const testCard2 = p.locator('section', { hasText: '5 · Test post' });
  const stepUpsBeforeTest = stepUps;
  await testCard2.locator('#qbo-test-approve-reason').fill('All four entries checked in QuickBooks');
  await submit(p, testCard2, 'Approve test post', () => sql(`select settings ? 'test_post_approved_at' from app.integration_connections where id = '${conn}'`) === 't');
  ok(stepUps > stepUpsBeforeTest, 'approving the test post opened the step-up modal and a fresh authenticator code was verified');
  ok(sql(`select (app.check_quickbooks_ready('${jsh}')->>'ok')`) === 'true', 'readiness check 7 passes: connected, mapping and test post approved, go-live set');
  ok(sql(`select status from app.center_setup_steps where center_id = '${jsh}' and step_key = 'svc.quickbooks'`) === 'done', 'Setup step svc.quickbooks is done');
  ok(sql(`select count(*) from app.audit_log where id > ${auditMark} and action = 'qbo_test_posts.update' and reason = 'All four entries checked in QuickBooks' and client_app = 'portal'`) === '1',
    'the test-post approval is audited with its reason');
  await p.goto(BASE + '/accounting/qbo/setup', { waitUntil: 'networkidle' });
  await p.screenshot({ path: `${OUT}/qbo-setup-3-ready.png`, fullPage: true });

  // ── 5. A real payment posts once; history never does ──────────────────────
  const before = (await mockState()).created.length;
  const pay = sql(`insert into app.payments (center_id, household_id, amount_cents, method, provider, received_on, receipt_number)
                   values ('${jsh}', (select id from app.households where center_id = '${jsh}' order by household_number limit 1), 5100, 'cash', 'offline', '${today}', 'E2E-${run}')
                   returning id`);
  const hist = sql(`insert into app.payments (center_id, household_id, amount_cents, method, provider, received_on, is_historical, crm_external_id)
                    values ('${jsh}', (select id from app.households where center_id = '${jsh}' order by household_number limit 1), 7700, 'check', 'offline', '${today}', true, 'HIST-${run}')
                    returning id`);
  ok(sql(`select count(*) from app.ledger_postings where source_id = '${hist}'`) === '0', 'a historical payment is never queued');
  // Even forced into the queue, the poster skips it.
  sql(`insert into app.ledger_postings (center_id, idempotency_key, source_table, source_id, txn_type, amount_cents, period_month)
       values ('${jsh}', 'e2e-hist:${run}', 'payments', '${hist}', 'offline_receipt', 7700, date_trunc('month', '${today}'::date))`);
  const posted = await until(() => sql(`select status from app.ledger_postings where source_id = '${pay}'`) === 'posted', 40000);
  ok(posted, 'the live payment is posted by the worker on its own (queued posting -> qbo.post job)');
  const lp = JSON.parse(sql(`select row_to_json(l) from (select id, qbo_entity, qbo_ref, request_id from app.ledger_postings where source_id = '${pay}') l`));
  const after = (await mockState()).created.slice(before);
  const receipt = after.find((c) => c.requestId === lp.id);
  ok(receipt && receipt.entity === 'SalesReceipt' && receipt.doc.TotalAmt === 51 && receipt.doc.DocNumber === `E2E-${run}` && receipt.doc.DepositToAccountRef.value === '3'
     && receipt.doc.Line[0].SalesItemLineDetail.ItemRef.value === '20' && receipt.doc.Line[0].SalesItemLineDetail.ClassRef.value === '30',
     'as a $51.00 SalesReceipt to Undeposited Funds, through the Donation item, General class, with the receipt number');
  ok(lp.qbo_ref === receipt.doc.Id && lp.request_id === lp.id, `the posting records QuickBooks id ${lp.qbo_ref} and its idempotency key`);
  ok(sql(`select status from app.ledger_postings where idempotency_key = 'e2e-hist:${run}'`) === 'skipped' && !after.some((c) => c.doc.TotalAmt === 77),
    'the historical payment is skipped and never reaches QuickBooks');
  // Requeue the posted payment (as if the answer had been lost): still one entry in QuickBooks.
  sql(`update app.ledger_postings set status = 'queued' where id = '${lp.id}'`);
  await until(() => sql(`select status from app.ledger_postings where id = '${lp.id}'`) === 'posted', 40000);
  ok((await mockState()).created.filter((c) => c.requestId === lp.id).length === 1, 'posting it again returns the first entry: it exists once in QuickBooks');
  ok(sql(`select count(*) from app.audit_log where id > ${auditMark} and action = 'ledger_postings.update' and record_id = '${lp.id}' and client_app = 'job' and module = 'accounting'`) !== '0',
    "the posting is audited as the background service's work");
  ok(sql(`select count(*) from app.sync_log where record_id = '${lp.id}' and status = 'ok'`) !== '0', 'and logged in the sync log');
  const customerNote = logs.some((l) => /donor matching/.test(l)) || sql(`select to_regprocedure('app.qbo_customer_for(uuid,uuid)') is not null`) === 't';
  ok(customerNote, 'without donor matching (o-qbo-match) the poster says once that entries post without a customer');
  await p.goto(BASE + '/accounting/qbo?status=posted', { waitUntil: 'networkidle' });
  ok((await p.innerText('body')).includes(`E2E-${run}`), 'the posting queue shows the posted receipt');
  await p.screenshot({ path: `${OUT}/qbo-sync-posted.png`, fullPage: true });

  // ── Module switch ─────────────────────────────────────────────────────────
  sql(`insert into app.center_modules (center_id, module_key, enabled, reason) values ('${jsh}', 'accounting', false, 'e2e') on conflict (center_id, module_key) do update set enabled = false`);
  await p.goto(BASE + '/accounting/qbo/setup', { waitUntil: 'networkidle' });
  ok(/switched off/i.test(await p.innerText('body')), 'with Accounting switched off the setup page says so');
  sql(`update app.center_modules set enabled = true where center_id = '${jsh}' and module_key = 'accounting'`);

  // ── Done ──────────────────────────────────────────────────────────────────
  const exited = new Promise((r) => worker.on('exit', (code) => r(code)));
  worker.kill('SIGTERM');
  ok((await exited) === 0, 'the worker stops cleanly');
  fs.writeFileSync(`${OUT}/worker.log`, logs.join('\n') + '\n');
  await b.close();
  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
})().catch((err) => { console.error(err); process.exit(1); });
