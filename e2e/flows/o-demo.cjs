// o-demo flow (the Demo data pack), against a real local stack:
//   1. a sandbox's owner opens Setup › Demo data (card on the Setup home, tab in the module),
//      sees what the pack contains and loads it; the background service (worker, as
//      connect_worker) runs the eleven steps and the page shows the progress;
//   2. every module shows demo data in the portal;
//   3. a demo member (priya.shah@demo.communityconnect.test) signs in to the member app with a
//      real emailed code (Mailpit) through the sandbox's join code and sees her family, events,
//      giving, Jain Way and Gyan Path;
//   4. the owner resets the sandbox (short name typed, fresh 2FA): a record typed in meanwhile
//      is gone, and every count returns to the pack's; the demo member is linked again;
//   5. the owner clears the sandbox: only the staff's own records are left;
//   6. a production organization refuses — over the API (activate, reset, clear) and in the UI
//      (no Demo data tab; the page says "Demo data is only for sandboxes.") — and nothing changes.
// Every step is asserted in the database, with its audit rows.
//
//   (cd worker && pnpm build)   # the flow starts the worker as connect_worker
//   node e2e/serve-spa.cjs /tmp/claude-0/o-demo-web 8500 &   # the member web app, exported against the stack
//   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright BASE=http://localhost:3400 APP=http://localhost:8500 \
//   MAIL=http://localhost:55624 API=http://localhost:55621 DB=postgres://postgres:postgres@localhost:55732/postgres \
//   ENVF=e2e/.env.o-demo OUT=/tmp/claude-0/streams/o-demo node e2e/flows/o-demo.cjs
//
// Test data only: a fresh sandbox per run (its name carries a run id), so it can be re-run.
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const { execSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3400';
const APP = process.env.APP || 'http://localhost:8500';
const MAIL = process.env.MAIL || 'http://localhost:55624';
const API = process.env.API || 'http://localhost:55621';
const DB = process.env.DB || 'postgres://postgres:postgres@localhost:55732/postgres';
const OUT = process.env.OUT || '/tmp/claude-0/streams/o-demo';
const ENVF = process.env.ENVF || path.join(__dirname, '..', '.env.o-demo');
const WORKER_JS = process.env.WORKER_JS || path.join(__dirname, '..', '..', 'worker', 'dist', 'server.js');
fs.mkdirSync(OUT, { recursive: true });
const env = Object.fromEntries(fs.readFileSync(ENVF, 'utf8').trim().split('\n').map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
const RUN = Date.now().toString(36);
const OWNER = `olivia.${RUN}@riverbend.test`;
const SLUG = `rbt-${RUN}-sandbox`;
const ORG = `Riverbend Jain Temple ${RUN.toUpperCase()}`;
const SHORT = 'RBT';
const DEMO_MEMBER = 'priya.shah@demo.communityconnect.test';
const JSH = '00000000-0000-4000-8000-000000000001';

const sql = (q) => execSync(`psql "${DB}" -Atc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── TOTP (RFC 6238, SHA-1, 30 s, 6 digits), never reusing a time step ─────────
function base32(s) {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '';
  for (const c of s.replace(/[\s=]+/g, '').toUpperCase()) bits += a.indexOf(c).toString(2).padStart(5, '0');
  const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
const usedStep = new Map();
async function totp(secret) {
  let step = Math.floor(Date.now() / 30000);
  while (usedStep.get(secret) === step) { await sleep(1000); step = Math.floor(Date.now() / 30000); }
  usedStep.set(secret, step);
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32(secret)).update(c).digest(); const o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

async function mailCode(email, after) {
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + email)}`).then((x) => x.json());
    const m = (r.messages || []).find((x) => new Date(x.Created).getTime() >= after);
    if (m) { const f = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((x) => x.json()); const c = (f.Text || '').match(/\b(\d{6,10})\b/); if (c) return c[1]; }
    await sleep(500);
  }
  throw new Error('no code email arrived for ' + email);
}
async function http(pathname, { method = 'GET', token, body, service = false } = {}) {
  const key = service ? env.SERVICE_KEY : env.ANON_KEY;
  const r = await fetch(API + pathname, {
    method,
    headers: { apikey: key, authorization: `Bearer ${token || key}`, 'content-type': 'application/json', 'content-profile': 'app', 'accept-profile': 'app', 'x-client-app': 'portal' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; }
  return { status: r.status, body: b };
}
async function apiSignIn(email) {
  const gl = await http('/auth/v1/admin/generate_link', { method: 'POST', service: true, body: { type: 'magiclink', email } });
  const v = await http('/auth/v1/verify', { method: 'POST', body: { type: 'email', email, token: gl.body.email_otp ?? gl.body.properties?.email_otp } });
  if (!v.body.access_token) throw new Error('API sign-in failed for ' + email + ': ' + JSON.stringify(v.body));
  return v.body.access_token;
}

/** Email-code sign-in; an account with an authenticator app answers its code (or "Not now"). */
async function portalSignIn(browser, email, { totpSecret, centerSlug } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (centerSlug) await ctx.addCookies([{ name: 'cc_center', value: centerSlug, url: BASE, httpOnly: true }]);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(BASE + '/login'); const t0 = Date.now() - 2000;
  await p.fill('input[name=email]', email); await p.click('button[type=submit]');
  await p.waitForSelector('input[name=code]'); await p.fill('input[name=code]', await mailCode(email, t0));
  await p.click('button[type=submit]');
  await Promise.race([
    p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }),
    p.waitForSelector('input[name=totp]', { timeout: 30000 }),
  ]);
  if (new URL(p.url()).pathname.startsWith('/login')) {
    if (totpSecret) {
      await p.fill('input[name=totp]', await totp(totpSecret));
      await p.getByRole('button', { name: 'Verify' }).click();
    } else {
      await p.getByRole('button', { name: 'Not now' }).click();
    }
    await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  }
  return { ctx, p, errs };
}

/** Submit an ActionForm whose button asks for confirmation in the modal. */
async function submitConfirmed(p, scope, label) {
  await scope.getByRole('button', { name: label, exact: true }).first().click();
  const dialog = p.getByRole('dialog').filter({ has: p.getByRole('button', { name: label, exact: true }) }).last();
  await dialog.getByRole('button', { name: label, exact: true }).click();
}
async function answerStepUp(p, secret) {
  const dialog = p.getByRole('dialog').filter({ hasText: 'Confirm it' });
  try { await dialog.waitFor({ timeout: 6000 }); } catch { return false; }
  await shot(p, 'step-up-modal');
  await dialog.getByLabel('Code from your authenticator app').fill(await totp(secret));
  await dialog.getByRole('button', { name: 'Verify and continue' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 20000 });
  return true;
}
async function waitStatus(center, want, seconds = 180) {
  let s = '';
  for (let i = 0; i < seconds; i++) {
    s = sql(`select status from app.center_demo_state where center_id = '${center}'`);
    if (s === want) return s;
    if (s === 'failed') return s;
    await sleep(1000);
  }
  return s;
}
// The pack's contents flattened, and what the last load added, as sorted JSON (to compare).
const packRows = () => sql(`select jsonb_object_agg(r.key, r.value)::text from app.demo_packs p, jsonb_array_elements(p.contents) m, jsonb_each(m->'rows') r where p.key = 'community'`);
const loadedRows = (c) => sql(`select (detail->'loaded')::text from app.center_demo_state where center_id = '${c}'`);
const nowCounts = (c) => JSON.parse(sql(`select app.demo_data_counts('${c}')::text`));

(async () => {
  // ── Arrange (test stack only): a sandbox with its owner (2FA on) ───────────
  const auditStart = Number(sql('select coalesce(max(id), 0) from app.audit_log'));
  await http('/auth/v1/admin/users', { method: 'POST', service: true, body: { email: OWNER, email_confirm: true } });
  await http('/auth/v1/admin/users', { method: 'POST', service: true, body: { email: DEMO_MEMBER, email_confirm: true } });
  const ownerId = sql(`select id from auth.users where email = '${OWNER}'`);
  const sbx = sql(`insert into app.centers (slug, name, short_name, state_region, status, environment, rules)
                   values ('${SLUG}', '${ORG}', '${SHORT}', 'TX', 'onboarding', 'sandbox', '{"security":{"require_2fa_for_staff":false}}') returning id`).split('\n')[0];
  sql(`with h as (insert into app.households (center_id, display_name) values ('${sbx}', 'Olivia household') returning id),
            p as (insert into app.people (center_id, first_name, last_name, email) values ('${sbx}', 'Olivia', 'Owner', '${OWNER}') returning id),
            m as (insert into app.household_members (household_id, person_id, center_id, role, is_primary) select h.id, p.id, '${sbx}', 'primary', true from h, p returning person_id)
       insert into app.center_users (center_id, user_id, person_id) select '${sbx}', '${ownerId}', person_id from m`);
  sql(`insert into app.accounts (user_id) values ('${ownerId}') on conflict do nothing`);
  sql(`insert into app.role_grants (center_id, user_id, role_key, reason) values ('${sbx}', '${ownerId}', 'center_admin', 'o-demo e2e owner')`);
  sql(`insert into app.center_owners (center_id, user_id) values ('${sbx}', '${ownerId}') on conflict (center_id) do update set user_id = excluded.user_id`);
  const jshPeople = sql(`select count(*) from app.people where center_id = '${JSH}'`);

  // The background service, as connect_worker.
  const workerPw = process.env.WORKER_DB_PASSWORD || crypto.randomBytes(24).toString('hex');   // a shared stack passes the portal's connect_worker password
  sql(`alter role connect_worker with password '${workerPw}'`);
  const logs = [];
  const worker = spawn(process.execPath, [WORKER_JS], {
    env: { PATH: process.env.PATH, WORKER_DATABASE_URL: `postgres://connect_worker:${workerPw}@${new URL(DB).host}/postgres`, WORKER_ID: `e2e-demo-${RUN}`,
           WORKER_HEALTH_PORT: process.env.WORKER_HEALTH_PORT || '3739', WORKER_POLL_MS: '500', WORKER_HEARTBEAT_MS: '5000' },
  });
  worker.stdout.on('data', (d) => logs.push(...d.toString().trim().split('\n')));
  worker.stderr.on('data', (d) => logs.push(...d.toString().trim().split('\n')));

  const browser = await chromium.launch();
  try {
    // ── 1. Setup › Demo data: load the pack ──────────────────────────────────
    // The owner signs in with an email code, then adds an authenticator app (so deleting asks for a fresh 2FA check).
    const o = await portalSignIn(browser, OWNER, { centerSlug: SLUG });
    await o.p.goto(BASE + '/account/security', { waitUntil: 'networkidle' });
    await o.p.getByRole('button', { name: /Set up an authenticator app/ }).click();
    const secretEl = o.p.getByTestId('totp-secret'); await secretEl.waitFor();
    const secret = (await secretEl.innerText()).replace(/\s+/g, '');
    await o.p.getByLabel('Code from the app').fill(await totp(secret));
    await o.p.getByRole('button', { name: 'Turn on 2FA' }).click();
    await o.p.getByText('2FA is on', { exact: false }).first().waitFor({ timeout: 20000 });
    ok(sql(`select count(*) from auth.mfa_factors where user_id = '${ownerId}' and status = 'verified'`) === '1', 'arranged: the sandbox owner has an authenticator app');
    await o.p.goto(BASE + '/setup', { waitUntil: 'networkidle' });
    ok((await o.p.innerText('body')).includes(ORG), 'the owner works in the sandbox (the switcher cookie picked it)');
    ok(await o.p.getByTestId('setup-demo-card').isVisible(), 'the Setup home shows the Demo data card in a sandbox');
    ok(await o.p.getByRole('link', { name: 'Demo data', exact: true }).count() >= 1, 'Setup has a Demo data tab in a sandbox');
    await shot(o.p, '1-setup-home');
    await o.p.goto(BASE + '/setup/demo', { waitUntil: 'networkidle' });
    let body = await o.p.innerText('main');
    ok(body.includes('What the demo community pack contains') && body.includes('Members & families') && body.includes('77 people') && body.includes('No demo data'),
      'the page shows what the pack contains per module, and that nothing is loaded yet');
    await shot(o.p, '1-demo-before');
    const t0 = Date.now();
    await o.p.getByTestId('demo-activate').getByRole('textbox', { name: 'Reason' }).fill('Show the committee every module');
    await o.p.getByRole('button', { name: 'Load demo data' }).click();
    await o.p.getByTestId('demo-progress').waitFor({ timeout: 20000 }).catch(() => null);
    await shot(o.p, '1-demo-progress');
    ok(await waitStatus(sbx, 'loaded') === 'loaded', `the worker loaded the pack (${Math.round((Date.now() - t0) / 1000)} s)`);
    ok(loadedRows(sbx) === packRows(), 'the rows loaded are exactly the pack\'s contents, table by table');
    await o.p.reload({ waitUntil: 'networkidle' });
    body = await o.p.innerText('main');
    ok(body.includes('Demo pack loaded') && /People in this sandbox\s*78\b/.test(body), 'the page shows it loaded; 78 people now (the pack\'s 77 and the owner)');
    await shot(o.p, '1-demo-loaded');
    ok(sql(`select count(*) from app.audit_log where id > ${auditStart} and record_table = 'center_demo_state' and actor_user_id = '${ownerId}'
            and client_app = 'portal' and client_screen = '/setup/demo' and reason like 'Demo data · load Demo community: Show the committee every module'`) !== '0',
      'audit: the request from Setup › Demo data, with the reason');
    ok(Number(sql(`select count(*) from app.audit_log where id > ${auditStart} and center_id = '${sbx}' and client_app = 'job'
                   and reason like 'Demo data · Demo community · %: Show the committee every module'`)) > 2000,
      'audit: every loaded row is a job change carrying the step and the reason');
    ok(sql(`select count(*) from app.jobs where center_id = '${sbx}' and kind = 'demo.load' and status = 'done'`) === '1', 'the demo.load job is done');
    ok(sql(`select count(*) from app.ledger_postings where center_id = '${sbx}'`) === '0' && sql(`select bool_and(is_historical)::text from app.payments where center_id = '${sbx}'`) === 'true',
      'demo payments are history: nothing is queued for QuickBooks');

    // ── 2. Every module shows demo data in the portal ────────────────────────
    const pages = [
      ['/households', 'Kothari family', 'People · households'], ['/people', 'Hemant', 'People · people'],
      ['/memberships/applications', 'Bothra', 'Membership · applications'],
      ['/events', 'Tapasvi Bahuman', 'Events'], ['/giving/pledges', 'Kothari', 'Giving · pledges'], ['/giving/payments', 'Sanghvi', 'Giving · payments'],
      ['/giving/recurring', 'Parikh', 'Giving · recurring'], ['/giving/campaigns', 'New temple construction', 'Giving · campaigns'],
      ['/bolis', 'Swamivatsalya labh', 'Bolis'], ['/store/menu', 'Mohanthal', 'Store · menu'], ['/store/orders', 'Khichdi kadhi', 'Store · orders by pickup'],
      ['/pathshala/classes', 'Jainism 2', 'Pathshala · classes'], ['/pathshala/enrollments', 'Mahi', 'Pathshala · enrollments (requested)'],
      ['/content/gyan-path', 'Uvasaggaharam', 'Gyan Path'], ['/content/practices', 'Navkarsi', 'My Jain Way · practices'],
      ['/content/library', 'Navkar Mantra, slowly', 'Content · library'], ['/calendar', 'Diwali', 'Calendar'],
      ['/comms/newsletters', 'newsletter', 'Communications · newsletters'], ['/comms/inbox', 'Receipt for last year', 'Communications · inbox'],
      ['/comms/surveys', 'Pathshala start time', 'Surveys'], ['/events/volunteers', 'Bhojanshala and kitchen', 'Volunteers'],
      ['/pathshala/committee/resolutions', 'code of conduct', 'Governance · resolutions'], ['/content/niva', 'Zelle', 'Niva'],
      [`/accounting/close?month=${sql("select to_char(date_trunc('month', now() at time zone 'America/Chicago') - interval '2 months', 'YYYY-MM')")}`, 'Locked', 'Accounting · a closed month'],
    ];
    const missing = [];
    for (const [href, text, label] of pages) {
      await o.p.goto(BASE + href, { waitUntil: 'networkidle' });
      const t = await o.p.innerText('main').catch(() => '');
      if (!t.toLowerCase().includes(text.toLowerCase())) missing.push(`${label} (${href}: "${text}")`);
      await shot(o.p, `2-portal${href.replace(/[^a-z0-9]+/gi, '-')}`);
    }
    ok(missing.length === 0, `every module shows demo data in the portal (${pages.length} screens)` + (missing.length ? ` — missing: ${missing.join('; ')}` : ''));
    ok(o.errs.length === 0, 'no page errors in the portal' + (o.errs.length ? ': ' + o.errs.join(' | ') : ''));

    // ── 3. A demo member in the member app ───────────────────────────────────
    const demoUser = sql(`select id from auth.users where email = '${DEMO_MEMBER}'`);
    ok(sql(`select count(*) from app.center_users cu join app.people p on p.id = cu.person_id where cu.center_id = '${sbx}' and cu.user_id = '${demoUser}' and p.email = '${DEMO_MEMBER}'`) === '1',
      'the demo member\'s existing sign-in is linked to Priya Shah by the pack');
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
      const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
      const code = sql(`select code from app.member_join_codes where center_id = '${sbx}' and active order by created_at desc limit 1`);
      await p.goto(APP + '/', { waitUntil: 'networkidle' });
      await p.getByText('Find your community').first().waitFor({ timeout: 30000 });
      await p.getByTestId('community-code').fill(code);
      await p.getByRole('button', { name: 'Check code' }).click();
      await p.getByText(`Open ${ORG}`).waitFor({ timeout: 15000 });
      await p.getByText(`Open ${ORG}`).click();
      await p.getByText(ORG).first().waitFor({ timeout: 20000 });
      await sleep(1500);
      await p.goto(APP + '/sign-in', { waitUntil: 'networkidle' });
      const tm = Date.now() - 2000;
      await p.locator('input[type=email], input[inputmode=email], input[autocomplete=email]').first().fill(DEMO_MEMBER);
      await p.getByRole('button', { name: /send|code|continue/i }).first().click();
      const codeBox = p.locator('input[inputmode=numeric], input[autocomplete=one-time-code]').first();
      await codeBox.waitFor({ timeout: 20000 });
      await codeBox.fill(await mailCode(DEMO_MEMBER, tm));
      await p.getByRole('button', { name: /verify|sign in|continue/i }).first().click();
      await p.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 30000 });
      await sleep(2500);
      await shot(p, '3-member-home');
      const screens = [['/family', 'Anya', 'Family'], ['/events', 'Tapasvi Bahuman', 'Events'], ['/give', 'Construction', 'Give'],
                       ['/pledges', 'Annual appeal', 'Pledges'], ['/jain-way', 'Navkarsi', 'Jain Way'], ['/gyan', 'Uvasaggaharam', 'Gyan Path'],
                       ['/bolis', 'Swamivatsalya', 'Bolis'], ['/store', 'Mohanthal', 'Store'], ['/special-days', 'Anya', 'Special days']];
      const miss = [];
      for (const [r, text, label] of screens) {
        await p.goto(APP + r, { waitUntil: 'networkidle' }); await sleep(1500);
        const t = await p.innerText('body').catch(() => '');
        if (!t.toLowerCase().includes(text.toLowerCase())) miss.push(`${label} (${r}: "${text}")`);
        await shot(p, `3-member${r.replace(/\//g, '-')}`);
      }
      ok(miss.length === 0, `the demo member sees the demo community in the member app (${screens.length} screens)` + (miss.length ? ` — missing: ${miss.join('; ')}` : ''));
      ok(await p.getByTestId('sandbox-watermark').isVisible().catch(() => false), 'the member app shows the sandbox watermark');
      ok(errs.length === 0, 'no page errors in the member app' + (errs.length ? ': ' + errs.join(' | ') : ''));
      await ctx.close();
    }

    // ── 4. Reset: a typed-in record is gone and the counts return to the pack's ─
    sql(`insert into app.households (center_id, display_name) values ('${sbx}', 'Typed-in family ${RUN}')`);
    sql(`insert into app.funds (center_id, key, name) values ('${sbx}', 'typed_${RUN}', 'Typed-in fund')`);
    const before = nowCounts(sbx);
    ok(before.households === 27, 'a household typed in meanwhile is in the sandbox (27 households)');
    await o.p.goto(BASE + '/setup/demo', { waitUntil: 'networkidle' });
    const reset = o.p.getByTestId('demo-reset');
    await reset.getByLabel(/to confirm/).fill('wrong');
    await reset.getByRole('textbox', { name: 'Reason' }).fill('Start the training again');
    await submitConfirmed(o.p, reset, 'Reset sandbox');
    await o.p.getByRole('alert').filter({ hasText: 'type RBT to confirm' }).first().waitFor({ timeout: 20000 });
    ok(sql(`select status from app.center_demo_state where center_id = '${sbx}'`) === 'loaded', 'a wrong confirmation changes nothing, with a plain message');
    await reset.getByLabel(/to confirm/).fill('rbt');
    const t1 = Date.now();
    await submitConfirmed(o.p, reset, 'Reset sandbox');
    const stepped = await answerStepUp(o.p, secret);
    ok(await waitStatus(sbx, 'clearing', 30) !== 'failed', `the reset started${stepped ? ' after the step-up window asked for a fresh 2FA code' : ' (her 2FA check was still fresh)'}`);
    await shot(o.p, '4-reset-running');
    for (let i = 0; i < 180 && sql(`select count(*) from app.jobs where center_id = '${sbx}' and kind = 'demo.load' and status = 'done'`) !== '2'; i++) await sleep(1000);
    ok(await waitStatus(sbx, 'loaded') === 'loaded', `the reset cleared and loaded the pack again (${Math.round((Date.now() - t1) / 1000)} s)`);
    ok(loadedRows(sbx) === packRows(), 'after the reset the counts are the pack\'s again, table by table');
    const after = nowCounts(sbx);
    ok(after.households === 26 && after.people === 78 && sql(`select count(*) from app.households where center_id = '${sbx}' and display_name like 'Typed-in family%'`) === '0'
       && sql(`select count(*) from app.funds where center_id = '${sbx}' and key like 'typed_%'`) === '0',
      'the typed-in household and fund are gone; 26 households and 78 people again');
    ok(sql(`select count(*) from app.center_owners where center_id = '${sbx}' and user_id = '${ownerId}'`) === '1'
       && sql(`select count(*) from app.role_grants where center_id = '${sbx}' and user_id = '${ownerId}' and status = 'active'`) === '1'
       && sql(`select count(*) from app.people where center_id = '${sbx}' and email = '${OWNER}'`) === '1',
      'the owner, her role and her own record are kept');
    ok(sql(`select count(*) from app.center_users cu join app.people p on p.id = cu.person_id where cu.center_id = '${sbx}' and cu.user_id = '${demoUser}' and p.email = '${DEMO_MEMBER}'`) === '1',
      'the demo member is linked to the new Priya Shah, so the member app keeps working');
    ok(sql(`select count(*) from app.audit_log where id > ${auditStart} and center_id = '${sbx}' and action = 'households.delete'
            and reason = 'Demo data · reset the sandbox: Start the training again' and client_app = 'job'`) === '26',
      'audit: every removed household (25 demo + the typed one) with the reason');
    ok(sql(`select count(*) from app.audit_log where id > ${auditStart} and record_table = 'center_demo_state' and actor_user_id = '${ownerId}'
            and client_screen = '/setup/demo' and reason = 'Demo data · reset the sandbox: Start the training again'`) !== '0',
      'audit: the reset request from Setup › Demo data with the reason');
    await o.p.reload({ waitUntil: 'networkidle' });
    await shot(o.p, '4-reset-done');

    // ── 5. Clear ─────────────────────────────────────────────────────────────
    const clear = o.p.getByTestId('demo-clear');
    await clear.getByLabel(/to confirm/).fill('RBT');
    await clear.getByRole('textbox', { name: 'Reason' }).fill('Make room for our own data');
    await submitConfirmed(o.p, clear, 'Clear sandbox');
    await answerStepUp(o.p, secret);
    ok(await waitStatus(sbx, 'empty', 60) === 'empty', 'clear leaves the sandbox empty');
    ok(JSON.stringify(nowCounts(sbx)) === JSON.stringify({ people: 1, households: 1, center_users: 1, household_members: 1 }),
      'only the owner\'s own records are left: ' + JSON.stringify(nowCounts(sbx)));
    await o.p.reload({ waitUntil: 'networkidle' });
    ok((await o.p.innerText('main')).includes('No demo data'), 'the page says no demo data');
    await shot(o.p, '5-cleared');
    await o.ctx.close();

    // ── 6. Production refuses: API and UI, and nothing changes ───────────────
    const a = await portalSignIn(browser, 'admin@jsh.test');
    const adminTok = await apiSignIn('admin@jsh.test');
    const refusals = [
      await http('/rest/v1/rpc/activate_demo_pack', { method: 'POST', token: adminTok, body: { p_center: JSH, p_pack: 'community', p_reason: 'try' } }),
      await http('/rest/v1/rpc/reset_sandbox', { method: 'POST', token: adminTok, body: { p_center: JSH, p_pack: 'community', p_confirm: 'JSH', p_reason: 'try' } }),
      await http('/rest/v1/rpc/clear_sandbox', { method: 'POST', token: adminTok, body: { p_center: JSH, p_confirm: 'JSH', p_reason: 'try' } }),
    ];
    ok(refusals.every((r) => r.status >= 400 && /Demo data is only for sandboxes/.test(JSON.stringify(r.body)) && r.body.code === 'CCDMO'),
      'the API refuses activate, reset and clear for a production organization (CCDMO, "Demo data is only for sandboxes.")');
    await a.p.goto(BASE + '/setup', { waitUntil: 'networkidle' });
    ok(await a.p.getByRole('link', { name: 'Demo data', exact: true }).count() === 0 && await a.p.getByTestId('setup-demo-card').count() === 0,
      'production: no Demo data tab and no card on the Setup home');
    await a.p.goto(BASE + '/setup/demo', { waitUntil: 'networkidle' });
    await a.p.getByTestId('demo-refused').waitFor({ timeout: 20000 });
    body = await a.p.innerText('main');
    ok(body.includes('Demo data is only for sandboxes.') && !body.includes('Reset sandbox') && !body.includes('Load demo data'),
      'production: /setup/demo says "Demo data is only for sandboxes." and offers nothing');
    await shot(a.p, '6-production-refused');
    ok(sql(`select count(*) from app.people where center_id = '${JSH}'`) === jshPeople && sql(`select count(*) from app.center_demo_state where center_id = '${JSH}'`) === '0',
      'nothing changed in the production organization');
    await a.ctx.close();
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
    worker.kill('SIGTERM');
    fs.writeFileSync(`${OUT}/worker.log`, logs.join('\n') + '\n');
  }
})();
