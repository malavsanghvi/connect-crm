// Organization onboarding · o-qbo-match — intelligent QuickBooks donor matching end to end, against a
// real local stack (bash e2e/up.sh o-qbo-match 600), the real worker (connect_worker role) and local
// mock QuickBooks + Anthropic servers (e2e/mocks/qbo-mock.cjs, company e2e/fixtures/o-qbo-match).
// Build the worker first (pnpm --dir worker build) and start the portal against the same stack.
//
//   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright PORTAL=http://localhost:3700 MAIL=http://localhost:55924 \
//   API=http://localhost:55921 DB=postgres://postgres:postgres@localhost:56032/postgres \
//   ENVF=e2e/.env.o-qbo-match node e2e/flows/o-qbo-match.cjs
//
// The journey (Accounting › QuickBooks › Donor matching, as admin@jsh.test — treasurer):
//   0. no connection → the screen says "Connect QuickBooks first" and links to it
//   1. QuickBooks connects → the worker pulls customers + 7 years of history from the mock
//   2. suggestions: QuickBooks ID on file, exact email, phone, name + ZIP, household name,
//      ambiguous → AI (mock; only names, city/ZIP and email domains leave), no match → Not mapped yet
//   3. bulk approve ≥ 90% (reason), approve one, reject one, map one by its household card
//   4. history comes in: family-level → PRIMARY member; open invoice → open pledge with its balance;
//      paid invoice → pledge + allocated payments; a credit memo waits (owner decision); nothing is
//      queued for posting; household giving summary, pledges and payments show it in the portal
//   5. re-pull and re-run the bring-in: nothing is duplicated
//   6. remap moves the records; undoing a mapping with history is blocked (owner decision)
//   7. audit rows (module, client_app, screen, reason); the module switch hides it and the API refuses
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const { execSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { startQbo, startAnthropic } = require('../mocks/qbo-mock.cjs');

const PORTAL = process.env.PORTAL || 'http://localhost:3700';
const MAIL = process.env.MAIL || 'http://localhost:55924';
const API = process.env.API || 'http://localhost:55921';
const DB = process.env.DB || 'postgres://postgres:postgres@localhost:56032/postgres';
const OUT = process.env.OUT || '/tmp/claude-0/streams/o-qbo-match';
const ENVF = process.env.ENVF || path.join(__dirname, '..', '.env.o-qbo-match');
const WORKER_JS = process.env.WORKER_JS || path.join(__dirname, '..', '..', 'worker', 'dist', 'server.js');
const KEYS = Object.fromEntries(fs.readFileSync(ENVF, 'utf8').trim().split('\n').map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
const COMPANY = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'o-qbo-match', 'company.json'), 'utf8'));
fs.mkdirSync(OUT, { recursive: true });

const C = '00000000-0000-4000-8000-000000000001';
const H_SHAH = 'd0000000-0000-4000-8000-000000000101', H_MEHTA = 'd0000000-0000-4000-8000-000000000102', H_RM = 'd0000000-0000-4000-8000-000000000103';
const PRIYA = 'd0000000-0000-4000-8000-000000000201', KIRAN = 'd0000000-0000-4000-8000-000000000205', NEHA = 'd0000000-0000-4000-8000-000000000206', RAHUL2 = 'd0000000-0000-4000-8000-000000000207';

const sql = (q) => execSync(`psql "${DB}" -qAtX -v ON_ERROR_STOP=1`, { input: q }).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) { failures++; process.exitCode = 1; } };
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }).catch(() => {});
async function until(fn, ms = 60000, every = 750) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(every); }
}

async function code(email, after) {
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + email)}`).then((x) => x.json());
    const m = (r.messages || []).find((x) => new Date(x.Created).getTime() >= after);
    if (m) {
      const f = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((x) => x.json());
      const c = ((f.Text || '') + ' ' + (f.HTML || '')).match(/\b(\d{6,10})\b/);
      if (c) return c[1];
    }
    await sleep(500);
  }
  throw new Error('no sign-in code arrived for ' + email);
}
async function portalLogin(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('   pageerror:', String(e).slice(0, 200)));
  await p.goto(PORTAL + '/login');
  const t0 = Date.now() - 2000;
  await p.fill('input[name=email]', email);
  for (let attempt = 1; ; attempt++) {
    await p.click('button[type=submit]');
    try { await p.waitForSelector('input[name=code]', { timeout: 10000 }); break; } catch (e) { if (attempt >= 3) throw e; await p.waitForTimeout(2000); }
  }
  await p.fill('input[name=code]', await code(email, t0));
  await p.click('button[type=submit]');
  await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 });
  return p;
}
const anonH = { apikey: KEYS.ANON_KEY, 'content-type': 'application/json' };
async function apiLogin(email) {
  let t0, r;
  for (let i = 0; i < 20; i++) {
    t0 = Date.now() - 2000;
    r = await fetch(`${API}/auth/v1/otp`, { method: 'POST', headers: anonH, body: JSON.stringify({ email, create_user: false }) });
    if (r.status !== 429) break;
    await sleep(5000);
  }
  const s = await fetch(`${API}/auth/v1/verify`, { method: 'POST', headers: anonH, body: JSON.stringify({ type: 'email', email, token: await code(email, t0) }) }).then((x) => x.json());
  if (!s.access_token) throw new Error(`verify for ${email}: ${JSON.stringify(s)}`);
  return s.access_token;
}
const rpc = (token, fn, args) => fetch(`${API}/rest/v1/rpc/${fn}`, {
  method: 'POST', headers: { ...anonH, authorization: `Bearer ${token}`, 'accept-profile': 'app', 'content-profile': 'app' }, body: JSON.stringify(args),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
/** The module switch as the admin with a fresh 2FA claim (module switches need step-up), in the database. */
function setModule(on, reason) {
  const uid = sql("select id from auth.users where email = 'admin@jsh.test'");
  sql(`begin; set local role authenticated;
       select set_config('request.jwt.claims', json_build_object('sub','${uid}','role','authenticated','aal','aal2','amr',json_build_array(json_build_object('method','totp','timestamp',extract(epoch from now())::bigint)))::text, true);
       select app.set_module_enabled('${C}', 'accounting', ${on}, '${reason}'); commit;`);
}
/** Waits for the jobs of a kind queued after afterId (only those a person queued, with byUser — the worker's daily pull can add its own). */
async function jobDone(kind, afterId, { byUser = false, ms = 90000 } = {}) {
  const t = Date.now();
  const who = byUser ? ' and created_by is not null' : '';
  // One statement: two separate counts race with a job queued between them.
  const done = await until(() => sql(`select count(*) filter (where status in ('queued','running')) = 0 and count(*) > 0 from app.jobs
                                        where center_id = '${C}' and kind = '${kind}' and id > ${afterId}${who}`) === 't', ms);
  if (!done) console.log(`NOTE ${kind} after job ${afterId} did not finish in ${Math.round((Date.now() - t) / 1000)} s`);
  return done;
}
const lastJobId = () => Number(sql('select coalesce(max(id), 0) from app.jobs'));

/** Navigate and wait until the page is past its "Loading…" state. */
async function go(p, url) {
  await p.goto(url);
  await p.waitForFunction(() => { const m = document.querySelector('main'); return m && !/^\s*Loading…\s*$/.test(m.innerText); }, null, { timeout: 30000 }).catch(() => {});
}
async function withReason(row, reason) { await row.locator('input[name=reason]').first().fill(reason); }
async function confirmModal(p) {
  const dlg = p.getByRole('dialog').last();
  if (await dlg.waitFor({ timeout: 4000 }).then(() => true, () => false)) await dlg.getByRole('button').last().click();
}
async function mapByCard(p, row, search, householdNumber, reason, personLabel = null) {
  await row.getByRole('button', { name: /Map to a household|Remap|Pick another household/ }).first().click();
  const drawer = p.getByRole('dialog').last();
  await drawer.locator('input[type=search]').fill(search);
  await drawer.getByRole('button', { name: 'Search' }).click();
  const card = drawer.locator('div, article, section').filter({ hasText: householdNumber }).filter({ has: p.getByRole('button', { name: 'Choose this household' }) }).last();
  await card.getByRole('button', { name: 'Choose this household' }).click();
  if (personLabel) await drawer.locator('select').selectOption({ label: personLabel });
  await drawer.locator('textarea').fill(reason);
  await drawer.getByRole('button', { name: /Map to this household|^Remap$/ }).click();
  await p.waitForTimeout(2500);
}

(async () => {
  // ── Setup (test data only) ──────────────────────────────────────────────
  sql(`update app.jobs set status = 'cancelled' where center_id = '${C}' and kind like 'qbo.%' and status in ('queued','running');
       delete from app.payment_allocations where payment_id in (select id from app.payments where center_id = '${C}' and provider = 'quickbooks');
       delete from app.payments where center_id = '${C}' and provider = 'quickbooks';
       delete from app.payment_allocations where pledge_id in (select id from app.pledges where center_id = '${C}' and crm_external_id like 'qbo:%');   -- another flow may have paid them
       delete from app.pledges where center_id = '${C}' and crm_external_id like 'qbo:%';
       delete from app.qbo_customer_matches where center_id = '${C}';
       delete from app.qbo_transactions where center_id = '${C}';
       delete from app.qbo_customers where center_id = '${C}';
       delete from app.external_ids where center_id = '${C}' and kind = 'accounting' and system = 'quickbooks' and value <> '1187';
       update app.external_ids set valid_to = null where center_id = '${C}' and kind = 'accounting' and value = '1187';
       delete from app.integration_connections where center_id = '${C}' and provider = 'quickbooks_online';
       delete from app.center_modules where center_id = '${C}' and module_key = 'accounting';
       update app.funds set qbo_class_id = 'CL-CON' where center_id = '${C}' and key = 'construction';`);
  const workerPw = process.env.WORKER_DB_PASSWORD || crypto.randomBytes(24).toString('hex');   // a shared stack passes the portal's connect_worker password
  sql(`grant connect_worker to postgres; alter role connect_worker with password '${workerPw}'`);
  // Another flow on a shared stack may have given the admin an authenticator app; this flow signs in
  // with the email code only, so remove it (test logins only).
  const adminUid = sql("select id from auth.users where email = 'admin@jsh.test'");
  for (const f of JSON.parse(sql(`select coalesce(json_agg(id), '[]') from auth.mfa_factors where user_id = '${adminUid}'`))) {
    const r = await fetch(`${API}/auth/v1/admin/users/${adminUid}/factors/${f}`, { method: 'DELETE', headers: { apikey: KEYS.SERVICE_KEY, authorization: `Bearer ${KEYS.SERVICE_KEY}` } });
    if (!r.ok) console.log(`NOTE could not remove the admin's authenticator ${f}: ${r.status}`);
  }
  const qbo = await startQbo({ company: COMPANY, token: 'mock-access-token', realm: '9130355' });
  const ai = await startAnthropic();
  const auditMark = Number(sql('select coalesce(max(id), 0) from app.audit_log'));
  const openBefore = Number(sql(`select coalesce(sum(amount_cents - paid_cents), 0) from app.pledges where household_id = '${H_SHAH}' and status in ('open','partially_paid')`));

  const worker = spawn(process.execPath, [WORKER_JS], {
    env: {
      PATH: process.env.PATH, WORKER_DATABASE_URL: `postgres://connect_worker:${workerPw}@${new URL(DB).host}/postgres`, WORKER_ID: 'e2e-qbo-match',
      WORKER_POLL_MS: '500', WORKER_HEARTBEAT_MS: '5000', WORKER_HEALTH_PORT: process.env.WORKER_HEALTH_PORT || '3711',
      INTUIT_API_BASE: qbo.url, ANTHROPIC_API_KEY: 'test-key-not-real', ANTHROPIC_BASE_URL: ai.url,
    },
  });
  const logs = [];
  worker.stdout.on('data', (d) => logs.push(...d.toString().trim().split('\n')));
  worker.stderr.on('data', (d) => logs.push(...d.toString().trim().split('\n')));

  const browser = await chromium.launch();
  try {
    const p = await portalLogin(browser, 'admin@jsh.test');

    // ── 0. Not connected ──────────────────────────────────────────────────
    await go(p, `${PORTAL}/accounting/qbo/matching`);
    const t0 = await p.locator('main').innerText();
    ok(/Connect QuickBooks first/.test(t0) && (await p.getByRole('link', { name: 'Connect QuickBooks' }).getAttribute('href')) === '/accounting/qbo',
      'without a connection the screen says "Connect QuickBooks first" and links to it');
    await shot(p, '00-not-connected');

    // ── 1. Connect (o-quickbooks stores the token; here: the worker's own store) → pull ─
    let mark = lastJobId();
    const conn = sql(`insert into app.integration_connections (center_id, provider, status, external_account_id, display_name, settings)
                      values ('${C}', 'quickbooks_online', 'disconnected', '9130355', 'Mock QuickBooks company', '{"mode":"test"}') returning id`);
    sql(`begin; set local role connect_worker; select app.worker_store_secret('${conn}', 'access_token', 'mock-access-token', 'e2e: the OAuth exchange (o-quickbooks)'); commit;`);
    sql(`update app.integration_connections set status = 'connected' where id = '${conn}'`);
    ok(sql(`select count(*) from app.jobs where center_id = '${C}' and kind = 'qbo.pull_customers_history' and id > ${mark}`) === '1', 'connecting QuickBooks queues the pull');
    await jobDone('qbo.pull_customers_history', mark);
    const pullRes = JSON.parse(sql(`select result from app.jobs where center_id = '${C}' and kind = 'qbo.pull_customers_history' and id > ${mark} order by id desc limit 1`) || '{}');
    ok(pullRes.mode === 'full' && pullRes.customers_read === 9, `the worker pulled 9 customers from the mock QuickBooks (${JSON.stringify(pullRes).slice(0, 160)})`);
    ok(sql(`select count(*) from app.qbo_transactions where center_id = '${C}'`) === '9' && sql(`select count(*) from app.qbo_transactions where qbo_id = '5004'`) === '0',
      'history within the 7-year window is copied (9 transactions; the 2012 receipt is outside it)');
    await jobDone('qbo.match_suggest_ai', mark);

    // ── 2. Suggestions ────────────────────────────────────────────────────
    const best = (q) => (sql(`select household_id || '|' || coalesce(person_id::text, '') || '|' || method || '|' || confidence from app.qbo_customer_matches
                                where center_id = '${C}' and qbo_customer_id = '${q}' and status = 'suggested' order by confidence desc limit 1`) || '').split('|');
    let b = best('1187'); ok(b[0] === H_SHAH && b[1] === '' && b[2] === 'crm_id', 'QuickBooks ID on file → Shah family, family-level');
    b = best('2001'); ok(b[0] === H_MEHTA && b[1] === KIRAN && b[2] === 'email', 'exact email → Kiran Mehta (person-level)');
    b = best('2002'); ok(b[0] === H_MEHTA && b[1] === NEHA && b[2] === 'phone', 'phone → Neha Mehta');
    b = best('2003'); ok(b[0] === H_RM && b[1] === '' && b[2] === 'name_address', '"Mr & Mrs Rahul Shah" + ZIP → Rahul & Mira Shah Household, family-level');
    b = best('2004'); ok(b[0] === H_MEHTA && b[2] === 'household_name', '"Mehta Family" → Mehta family by household name');
    b = best('2005'); ok(b[0] === H_SHAH && b[2] === 'ai' && Number(b[3]) <= 0.85, '"Shah Household" was ambiguous → AI proposal, capped at 0.85');
    ok(sql(`select count(*) from app.qbo_customer_matches where qbo_customer_id in ('2006','2099')`) === '0', 'no match for a company or a closed account');
    ok(ai.requests.length > 0 && ai.requests.every((r) => !r.includes('@') && !r.includes('555') && !r.includes('1000')),
      'the AI saw no full email, phone or amount (email domains only)');

    await go(p, `${PORTAL}/accounting/qbo/matching`);
    const t1 = await p.locator('main').innerText();
    ok(/QuickBooks customers\s*8/i.test(t1) && /Not mapped yet\s*8/i.test(t1), 'tiles: 8 active customers, 8 not mapped yet');
    ok(/AI suggestions are on/.test(t1) && /QuickBooks customer ID already on file/.test(t1) && /AI suggestion/.test(t1), 'Suggested shows the evidence side by side and the AI proposal');
    await shot(p, '01-suggested');
    await go(p, `${PORTAL}/accounting/qbo/matching?tab=not_mapped`);
    const acme = p.locator('tr[data-qbo="2006"]');
    ok((await acme.count()) === 1 && /\$150\.00/.test(await acme.innerText()) && /No likely household found/.test(await acme.innerText()),
      'Not mapped yet always lists the unmatched company with its open balance');
    await shot(p, '02-not-mapped');

    // ── 3. Decide ─────────────────────────────────────────────────────────
    mark = lastJobId();
    await go(p, `${PORTAL}/accounting/qbo/matching`);
    await p.fill('#qbo-threshold', '90');
    await p.fill('#qbo-bulk-reason', 'Checked against the QuickBooks ledger');
    await p.getByRole('button', { name: 'Approve all at or above' }).click();
    await confirmModal(p);
    await until(() => sql(`select count(*) from app.qbo_customer_matches where center_id = '${C}' and status = 'approved'`) === '3', 20000);
    ok(sql(`select string_agg(qbo_customer_id, ',' order by qbo_customer_id) from app.qbo_customer_matches where center_id = '${C}' and status = 'approved'`) === '1187,2001,2002',
      'bulk approve ≥ 90% took exactly the three clear matches');

    await go(p, p.url());
    let row = p.locator('tr[data-qbo="2003"]').first();
    await withReason(row, 'Same couple, Sugar Land address');
    await row.getByRole('button', { name: 'Approve' }).click();
    await until(() => sql(`select status from app.qbo_customer_matches where qbo_customer_id = '2003' and household_id = '${H_RM}'`) === 'approved', 15000);
    ok(sql(`select status from app.qbo_customer_matches where qbo_customer_id = '2003' and household_id = '${H_RM}'`) === 'approved', 'one match approved on its own');

    await go(p, p.url());
    row = p.locator('tr[data-qbo="2004"]').first();
    await withReason(row, 'Not sure which Mehta family this is');
    await row.getByRole('button', { name: 'Reject' }).click();
    await until(() => sql(`select count(*) from app.qbo_customer_matches where qbo_customer_id = '2004' and status = 'rejected'`) === '1', 15000);
    ok(sql(`select reason from app.qbo_customer_matches where qbo_customer_id = '2004' and status = 'rejected'`) === 'Not sure which Mehta family this is', 'a suggestion rejected with its reason');

    await go(p, `${PORTAL}/accounting/qbo/matching?tab=not_mapped`);
    await mapByCard(p, p.locator('tr[data-qbo="2004"]'), 'Mehta', 'JSH-H-9002', 'Treasurer confirmed with Kiran');
    await until(() => sql(`select count(*) from app.qbo_customer_matches where qbo_customer_id = '2004' and status = 'approved'`) === '1', 15000);
    ok(sql(`select household_id || '|' || method || '|' || coalesce(person_id::text, 'family') from app.qbo_customer_matches where qbo_customer_id = '2004' and status = 'approved'`) === `${H_MEHTA}|manual|family`,
      'mapped by hand from its household card (family-level)');
    await shot(p, '03-mapped');

    // ── 4. History comes in ───────────────────────────────────────────────
    await jobDone('qbo.bring_in_history', mark);
    ok(sql(`select count(*) from app.qbo_transactions where center_id = '${C}' and customer_qbo_id in ('1187','2001','2002','2003') and cc_status = 'pending'`) === '0', 'the bring-in jobs ran');
    ok(sql(`select amount_cents || '|' || paid_cents || '|' || status || '|' || household_id || '|' || pledged_by_person_id || '|' || (fund_id = (select id from app.funds where center_id = '${C}' and key = 'construction'))
              from app.pledges where crm_external_id = 'qbo:Invoice:6001'`) === `100000|60000|partially_paid|${H_SHAH}|${PRIYA}|true`,
      'open invoice → open pledge ($400 left) on the Shah family\'s PRIMARY member, fund from the class');
    ok(sql(`select status || '|' || paid_cents from app.pledges where crm_external_id = 'qbo:Invoice:6002'`) === 'paid|50000', 'paid invoice → paid pledge with its payment allocated');
    ok(sql(`select count(*) from app.payments where crm_external_id in ('qbo:Payment:7001','qbo:Payment:7002','qbo:SalesReceipt:5001') and is_historical and provider = 'quickbooks' and payer_person_id = '${PRIYA}' and household_id = '${H_SHAH}'`) === '3',
      'family-level payments and receipts → historical payments from the primary member');
    ok(sql(`select a.amount_cents from app.payment_allocations a join app.payments p on p.id = a.payment_id join app.pledges pl on pl.id = a.pledge_id where p.crm_external_id = 'qbo:Payment:7001' and pl.crm_external_id = 'qbo:Invoice:6001'`) === '60000',
      'the payment is allocated exactly as QuickBooks applied it');
    ok(/Jeevdaya/.test(sql(`select cc_detail from app.qbo_transactions where qbo_id = '5001'`)), 'an unmapped class went to the general fund with a note');
    ok(/owner decision/.test(sql(`select cc_status || ' ' || cc_detail from app.qbo_transactions where qbo_id = '8001'`)), 'the credit memo waits: refunds need an owner decision');
    ok(sql(`select payer_person_id || '|' || household_id from app.payments where crm_external_id = 'qbo:SalesReceipt:5002'`) === `${KIRAN}|${H_MEHTA}`, 'person-level: Kiran\'s receipt is Kiran\'s');
    ok(sql(`select amount_cents - paid_cents || '|' || pledged_by_person_id from app.pledges where crm_external_id = 'qbo:Invoice:6003'`) === `30000|${RAHUL2}`, 'Rahul & Mira\'s open invoice → open $300 pledge on their primary member');
    ok(sql(`select count(*) from app.ledger_postings l join app.payments p on p.id = l.source_id where p.provider = 'quickbooks'`) === '0', 'none of it is queued for posting to QuickBooks');
    const openAfter = Number(sql(`select coalesce(sum(amount_cents - paid_cents), 0) from app.pledges where household_id = '${H_SHAH}' and status in ('open','partially_paid')`));
    ok(openAfter - openBefore === 40000, 'the Shah family\'s open pledges grew by exactly the QuickBooks balance ($400)');

    await go(p, `${PORTAL}/households/${H_SHAH}`);
    const hh = await p.locator('main').innerText();
    ok(/QuickBooks\s+Shah Family \(#1187, family-level, on the primary member\)/i.test(hh), 'the household shows its QuickBooks customer');
    const openCell = await p.locator('section[aria-label=Identity]').innerText();
    ok(openCell.includes('$' + (openAfter / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })), `the household's giving summary shows the open balance (${openAfter / 100})`);
    await shot(p, '04-household');
    await go(p, `${PORTAL}/households/${H_SHAH}?tab=pledges`);
    ok(/History · QuickBooks Invoice #6001/.test(await p.locator('main').innerText()), 'the pledge carries its QuickBooks history badge');
    await go(p, `${PORTAL}/households/${H_SHAH}?tab=payments`);
    const pay = await p.locator('main').innerText();
    ok(/History · qbo:Payment:7001 · not posted to QuickBooks/.test(pay) && /via quickbooks/.test(pay), 'the payments show as history, not posted to QuickBooks');
    await shot(p, '05-payments');
    await go(p, `${PORTAL}/people/${KIRAN}`);
    ok(/Kiran Mehta \(#2001, person-level\)/.test(await p.locator('main').innerText()), 'the person shows their own QuickBooks customer');

    // ── 5. Idempotent ─────────────────────────────────────────────────────
    const countPay = () => sql(`select count(*) || '|' || sum(amount_cents) from app.payments where center_id = '${C}' and provider = 'quickbooks'`);
    const before = countPay();
    mark = lastJobId();
    await go(p, `${PORTAL}/accounting/qbo/matching`);
    await p.getByRole('button', { name: 'Pull from QuickBooks now' }).click();
    await jobDone('qbo.pull_customers_history', mark, { byUser: true });
    const pull2 = sql(`select result from app.jobs where kind = 'qbo.pull_customers_history' and id > ${mark} and created_by is not null order by id desc limit 1`) || '{}';
    ok(JSON.parse(pull2).mode === 'changes', `a second pull reads only the changes (CDC): ${pull2.slice(0, 80)}`);
    mark = lastJobId();
    sql(`select app.enqueue_job('${C}', 'qbo.bring_in_history', '{"qbo_customer_id":"1187"}'::jsonb)`);
    await jobDone('qbo.bring_in_history', mark);
    ok(countPay() === before && JSON.parse(sql(`select result from app.jobs where kind = 'qbo.bring_in_history' and id > ${mark}`)).brought_in === 0,
      'pulling and bringing in again duplicates nothing');

    // ── 6. Remap, and the blocked undo ────────────────────────────────────
    await go(p, `${PORTAL}/accounting/qbo/matching?tab=approved`);
    await mapByCard(p, p.locator('tr[data-qbo="2002"]'), 'Rahul', 'JSH-H-9003', 'Neha gives for her sister\'s family');
    await until(() => sql(`select household_id from app.payments where crm_external_id = 'qbo:SalesReceipt:5003'`) === H_RM, 20000);
    ok(sql(`select household_id || '|' || payer_person_id from app.payments where crm_external_id = 'qbo:SalesReceipt:5003'`) === `${H_RM}|${RAHUL2}`,
      'remapping moved the receipt to the new household and its primary member');
    ok(/^Remapped: /.test(sql(`select reason from app.qbo_customer_matches where qbo_customer_id = '2002' and status = 'rejected'`)), 'the old match is kept, rejected, with the reason');

    await go(p, `${PORTAL}/accounting/qbo/matching?tab=approved`);
    row = p.locator('tr[data-qbo="1187"]');
    await withReason(row, 'Trying to undo');
    await row.getByRole('button', { name: 'Undo mapping' }).click();
    await confirmModal(p);
    await p.waitForTimeout(2000);
    ok(/needs an owner decision/.test(await p.locator('main').innerText()) && sql(`select status from app.qbo_customer_matches where qbo_customer_id = '1187' and household_id = '${H_SHAH}' and method = 'crm_id'`) === 'approved',
      'undoing a mapping whose history is in is blocked with a plain message (deleting data is an owner decision)');
    await go(p, `${PORTAL}/accounting/qbo/matching?tab=review`);
    ok(/Refunds from QuickBooks need an owner decision/.test(await p.locator('main').innerText()), 'Needs review lists the credit memo with the reason');
    await shot(p, '06-review');

    // ── 7. Audit + module switch ──────────────────────────────────────────
    ok(sql(`select count(*) from app.audit_log where id > ${auditMark} and action = 'qbo_customer_matches.update' and after->>'status' = 'approved'
              and module = 'accounting' and client_app = 'portal' and client_screen like '/accounting/qbo/matching%' and reason = 'Checked against the QuickBooks ledger'`) === '3',
      'each approval is audited: module accounting, portal, screen, reason');
    ok(sql(`select count(*) from app.audit_log where id > ${auditMark} and action = 'payments.insert' and module = 'giving' and client_app = 'job' and reason like 'QuickBooks history · Shah Family → Shah family%'`) === '3',
      'each record brought in is audited with the match it came from');
    ok(sql(`select count(*) from app.audit_log where id > ${auditMark} and action = 'payments.update' and reason = 'Neha gives for her sister''s family'`) === '1', 'the remap move is audited with its reason');

    setModule(false, 'o-qbo-match e2e');
    await go(p, `${PORTAL}/accounting/qbo/matching`);
    ok(/is switched off/.test(await p.locator('main').innerText()), 'Accounting off: the screen shows "switched off"');
    const token = await apiLogin('admin@jsh.test');
    const r = await rpc(token, 'qbo_suggest_matches', { p_center: C });
    ok(r.status >= 400 && /switched off/i.test(JSON.stringify(r.body)), 'Accounting off: the API refuses');
    setModule(true, 'o-qbo-match e2e done');
    await go(p, `${PORTAL}/accounting/qbo/matching?tab=approved`);
    ok(/Approved matches/.test(await p.locator('main').innerText()), 'switched back on');
    await shot(p, '07-approved');
  } catch (e) {
    console.log('FAIL exception:', e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e);
    failures++;
    process.exitCode = 1;
  } finally {
    await browser.close();
    worker.kill('SIGTERM');
    await sleep(1500);
    await qbo.close();
    await ai.close();
    fs.writeFileSync(`${OUT}/worker.log`, logs.join('\n'));
    ok(!logs.join('\n').includes('mock-access-token'), 'the access token is in no worker log line');
    console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  }
})();
