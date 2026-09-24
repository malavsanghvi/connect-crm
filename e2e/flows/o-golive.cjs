// o-golive flow (onboarding Wave D): a brand-new organization's owner walks the whole
// Setup checklist through the portal in a fresh sandbox — providers mocked — until every
// go-live readiness check passes and the go-live request succeeds.
//
//   1. Request access → a Community Connect admin approves → the contact redeems the code at
//      /start (email code from Mailpit, phone test OTP, authenticator app, sandbox terms).
//   2. Stage 0 in the UI: legal identity + documents (verified by a second CC admin in
//      Platform › Verification), profile and brand kit (logo upload, colors), leaders,
//      modules, the team (a second admin and a treasurer invited, accepted, approved),
//      rules, onboarding fields, notifications, security, agreements.
//   3. Stage 1: email domain (Resend mock) + sender + test email to a verified sandbox test
//      recipient, texting (phone sign-in off), payments (offline only + accepted methods),
//      storage retention, numbering, bank account.
//   4. Stages 2–5: legal documents published, the treasurer approves the receipt templates
//      (readiness 8), setup data, a household/people import reconciled and signed off.
//   5. Stage 7–8: the owner confirms training / health check / pilot, readiness is all green
//      in the UI, and the go-live request succeeds.
// Every step is asserted in the database (rows, and audit rows with module/app/screen/reason).
//
//   (cd worker && pnpm build)
//   MAILPIT=http://localhost:55524 PORT=4590 node e2e/mock-providers.cjs &
//   portal on :3300 built against the o-golive stack, with /tmp/claude-0/o-golive/runtime.env
//   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright node e2e/flows/o-golive.cjs
//
// Test data only: platform admins cc1/cc2@golive.test, a fresh organization per run.
'use strict';
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const { execSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3300';
const MAIL = process.env.MAIL || 'http://localhost:55524';
const API = process.env.API || 'http://localhost:55521';
const DB = process.env.DB || 'postgres://postgres:postgres@localhost:55632/postgres';
const MOCK = process.env.MOCK || 'http://localhost:4590';
const OUT = process.env.OUT || '/tmp/claude-0/streams/o-golive';
const ENVF = process.env.ENVF || path.join(__dirname, '..', '.env.o-golive');
const WORKER_JS = process.env.WORKER_JS || path.join(__dirname, '..', '..', 'worker', 'dist', 'server.js');
const STOP_AFTER = process.env.STOP_AFTER || '';
fs.mkdirSync(OUT, { recursive: true });
const readEnv = (f) => Object.fromEntries(fs.readFileSync(f, 'utf8').trim().split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
const env = readEnv(ENVF);
const RUN = Date.now().toString(36);
const CC1 = 'cc1@golive.test';
const CC2 = 'cc2@golive.test';
const CONTACT = `asha.${RUN}@golivetemple.test`;
const SECOND = `vikram.${RUN}@golivetemple.test`;
const TREASURER = `tara.${RUN}@golivetemple.test`;
const ORG = `Golive Temple ${RUN.toUpperCase()}`;
const SLUG = `gl-${RUN}`;
const PHONE_DIGITS = '15555550102'; // GoTrue test OTP 123456 on this stack
const FIXTURES = path.join(__dirname, '..', 'fixtures');

const sql = (q) => execSync(`psql "${DB}" -qAtX -v ON_ERROR_STOP=1`, { input: q }).toString().trim();
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) { failures++; process.exitCode = 1; } };
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }).catch((e) => console.error('screenshot failed', name, e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 30000, every = 500) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(every); }
}
const stopAfter = (phase) => { if (STOP_AFTER === phase) { console.log(`(stopping after ${phase})`); throw new Error('__stop__'); } };

// ── TOTP (RFC 6238), never reusing a time step ───────────────────────────────
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

async function mailMessage(email, after, match = /\b(\d{6,10})\b/) {
  for (let i = 0; i < 80; i++) {
    const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + email)}`).then((x) => x.json());
    for (const m of (r.messages || []).filter((x) => new Date(x.Created).getTime() >= after)) {
      const f = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((x) => x.json());
      const hit = ((f.Text || '') + '\n' + (f.HTML || '')).match(match);
      if (hit) return { msg: f, hit };
    }
    await sleep(500);
  }
  throw new Error('no matching email arrived for ' + email);
}
const mailCode = async (email, after) => (await mailMessage(email, after)).hit[1];

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

async function portalSignIn(browser, email, name, secret) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.error(`[${name} page error]`, String(e)));
  await p.goto(BASE + '/login'); const t0 = Date.now() - 2000;
  await p.fill('input[name=email]', email); await p.click('button[type=submit]');
  await p.waitForSelector('input[name=code]'); await p.fill('input[name=code]', await mailCode(email, t0));
  await p.click('button[type=submit]');
  await Promise.race([
    p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }),
    p.waitForSelector('input[name=totp]', { timeout: 30000 }),
  ]);
  if (new URL(p.url()).pathname.startsWith('/login')) {
    if (!secret) throw new Error(`${email} was asked for a 2FA code but has none in this run`);
    await p.fill('input[name=totp]', await totp(secret));
    await p.getByRole('button', { name: 'Verify' }).click();
    await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  }
  await p.waitForLoadState('networkidle');
  await shot(p, `${name}-signed-in`);
  return { ctx, p };
}

/** Account › Security: add an authenticator app, reading the setup key off the page. Returns the secret. */
async function enrollInPortal(p) {
  await p.goto(BASE + '/account/security', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /Set up an authenticator app/ }).click();
  const secretEl = p.getByTestId('totp-secret'); await secretEl.waitFor();
  const secret = (await secretEl.innerText()).replace(/\s+/g, '');
  await p.getByLabel('Code from the app').fill(await totp(secret));
  await p.getByRole('button', { name: 'Turn on 2FA' }).click();
  await p.getByText('2FA is on', { exact: false }).first().waitFor({ timeout: 20000 });
  await p.waitForLoadState('networkidle');
  return secret;
}

/** Switch the portal to another community with the switcher in the top bar. */
async function switchTo(p, slug, name) {
  await p.getByTestId('center-switcher').click();
  const item = p.getByRole('menuitemradio').filter({ hasText: slug });
  await item.scrollIntoViewIfNeeded();
  await item.dispatchEvent('click'); // a long list (a platform admin sees every organization) can run past the window
  await p.waitForFunction((n) => (document.querySelector('[data-testid=center-switcher]')?.textContent || '').includes(n), name, { timeout: 30000 });
  await p.waitForLoadState('networkidle');
}

/** Wait for a toast (or any text) matching re. */
async function toast(p, re, ms = 30000) {
  try { await p.getByText(re).first().waitFor({ timeout: ms }); return true; } catch { return false; }
}

/** The confirm modal an ActionForm opens. */
async function confirmModal(p, label) {
  const dlg = p.locator('[role=dialog][aria-modal=true]').last();
  await dlg.waitFor();
  await dlg.getByRole('button', { name: label }).click();
}

// A real (tiny) PNG: a solid w×h bar.
function makePng(w, h, [r, g, b]) {
  const zlib = require('zlib');
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = []; for (let y = 0; y < h; y++) { rows.push(Buffer.from([0])); for (let x = 0; x < w; x++) rows.push(Buffer.from([r, g, b])); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

/** Audit rows since the run started for a table in the sandbox: "app|screen|reason" lines. */
const audits = (S, table, extra = '') => sql(`select coalesce(client_app,'')||'|'||coalesce(client_screen,'')||'|'||coalesce(reason,'') from app.audit_log
  where id > ${S.auditStart} and center_id = '${S.sbx}' and record_table = '${table}' ${extra} order by id`).split('\n').filter(Boolean);

/** Staff with 2FA land on Account › Security for their code; enter it. */
async function pass2fa(p, secret) {
  await p.waitForLoadState('networkidle');
  const code = p.locator('input[name=code], input[name=totp]').first();
  if (!/\/account\/security|\/security/.test(new URL(p.url()).pathname) && !(await code.isVisible().catch(() => false))) return;
  if (await code.isVisible().catch(() => false)) {
    await code.fill(await totp(secret));
    await p.getByRole('button', { name: /Verify|Continue|Confirm/ }).first().click();
    await p.waitForLoadState('networkidle');
  }
}

async function answerStepUp(p, secret) {
  const dialog = p.getByRole('dialog').filter({ hasText: 'Confirm it' });
  try { await dialog.waitFor({ timeout: 6000 }); } catch { return false; }
  await dialog.getByLabel('Code from your authenticator app').fill(await totp(secret));
  await dialog.getByRole('button', { name: 'Verify and continue' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 20000 });
  return true;
}

/** Submit an ActionForm whose button asks for confirmation in the modal. */
async function submitConfirmed(p, scope, label) {
  await scope.getByRole('button', { name: label, exact: true }).first().click();
  const dialog = p.getByRole('dialog').filter({ has: p.getByRole('button', { name: label, exact: true }) }).last();
  await dialog.getByRole('button', { name: label, exact: true }).click();
}

/** The toast/alert after an action: returns its text (fails the step on an error toast). */
async function outcome(p, what) {
  const t = p.locator('[role=status], [role=alert]').filter({ hasText: /\S/ }).last();
  await t.waitFor({ timeout: 20000 }).catch(() => {});
  const text = (await t.innerText().catch(() => '')).trim();
  if (/^Could not|couldn.t|failed/i.test(text)) console.error(`[${what}] ${text}`);
  return text;
}

// ═════════════════════════════════════════════════════════════════════════════
async function run({ browser, S, cc1Id, cc2Id, auditStart }) {
  // ── 1. Request access → approval → redemption at /start ────────────────────
  const anon = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ap = await anon.newPage();
  await ap.goto(BASE + '/request-access', { waitUntil: 'networkidle' });
  await ap.fill('input[name=org_legal_name]', ORG);
  await ap.check('input[name=org_type][value=temple]');
  await ap.fill('input[name=city]', 'Austin'); await ap.fill('input[name=state]', 'TX'); await ap.fill('input[name=approx_households]', '180');
  await ap.fill('input[name=contact_name]', 'Asha Mehta'); await ap.fill('input[name=contact_email]', CONTACT); await ap.fill('input[name=contact_phone]', '(512) 555-0142');
  await ap.check('input[name=modules_interested][value=giving]');
  await ap.fill('input[name=heard_from]', 'Another temple');
  await ap.getByRole('button', { name: 'Send request' }).click();
  await ap.getByTestId('request-sent').waitFor({ timeout: 20000 });
  const reqId = sql(`select id from app.access_requests where contact_email = '${CONTACT}'`);
  ok(Boolean(reqId), '1 · the access request is stored');
  await anon.close();

  const c1 = await portalSignIn(browser, CC1, 'cc1');
  S.c1 = c1;
  await c1.p.goto(BASE + '/platform/requests', { waitUntil: 'networkidle' });
  const row = c1.p.locator(`tr[data-request="${CONTACT}"]`);
  await row.getByRole('button', { name: 'Review' }).click();
  const drawer = c1.p.getByRole('dialog').filter({ hasText: ORG });
  await drawer.getByRole('button', { name: 'Approve and issue a code' }).click();
  const issued = drawer.getByTestId('issued-code');
  await issued.waitFor({ timeout: 20000 });
  const code = await issued.locator('[data-code]').getAttribute('data-code');
  ok(/^CC-SBX-/.test(code || ''), `1 · Community Connect approves and issues a sandbox code (${code})`);

  const rc = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const rp = await rc.newPage();
  rp.on('pageerror', (e) => console.error('[owner page error]', String(e)));
  await rp.goto(BASE + '/start', { waitUntil: 'networkidle' });
  await rp.fill('input[name=code]', code);
  await rp.getByRole('button', { name: 'Continue' }).click();
  await rp.fill('input[name=email]', CONTACT, { timeout: 20000 });
  const t0 = Date.now() - 2000;
  await rp.getByRole('button', { name: 'Send sign-in code' }).click();
  await rp.fill('input[name=email_code]', await mailCode(CONTACT, t0));
  await rp.getByRole('button', { name: 'Sign in' }).click();
  await rp.fill('input[name=phone]', '+1 555-555-0102', { timeout: 20000 });
  await rp.getByRole('button', { name: 'Text me a code' }).click();
  await rp.fill('input[name=phone_code]', '123456', { timeout: 20000 });
  await rp.getByRole('button', { name: 'Verify' }).click();
  await rp.getByRole('button', { name: 'Set up an authenticator app' }).click({ timeout: 20000 });
  const secretEl = rp.getByTestId('totp-secret'); await secretEl.waitFor();
  S.ownerSecret = (await secretEl.innerText()).replace(/\s+/g, '');
  await rp.fill('input[name=totp]', await totp(S.ownerSecret));
  await rp.getByRole('button', { name: 'Turn on 2FA' }).click();
  await rp.getByTestId('sandbox-terms').waitFor({ timeout: 20000 });
  await rp.getByRole('checkbox').check();
  await rp.getByRole('button', { name: 'Accept and continue' }).click();
  await rp.fill('input[name=slug]', SLUG, { timeout: 20000 });
  await rp.getByRole('button', { name: 'Create my sandbox' }).click();
  await rp.waitForURL((u) => u.pathname === '/setup', { timeout: 30000 });
  await rp.waitForLoadState('networkidle');
  await shot(rp, '1-sandbox-setup-fresh');
  S.owner = { ctx: rc, p: rp };
  S.ownerId = sql(`select id from auth.users where email = '${CONTACT}'`);
  S.sbx = sql(`select id from app.centers where slug = '${SLUG}-sandbox'`);
  ok(sql(`select environment||'|'||status from app.centers where id = '${S.sbx}'`) === 'sandbox|onboarding', '1 · the fresh sandbox exists and its Setup checklist opens');
  ok((await rp.locator('text=Coming soon').count()) === 0, '1 · no step in the checklist says "Coming soon"');
  S.auditStart = auditStart; S.cc1Id = cc1Id; S.cc2Id = cc2Id;
  stopAfter('sandbox');

  await phaseTeam(browser, S);
  stopAfter('team');
  await phaseFoundation(browser, S);
  stopAfter('foundation');
  await phaseServices(browser, S);
  stopAfter('services');
  await phaseData(browser, S);
  stopAfter('data');
  await phaseHistory(browser, S);
  stopAfter('history');
  await phaseGoLive(browser, S);
  if (process.env.EXPLORE) await phaseExplore(S);
}

/** Toggle a module off in Settings › Modules (reason + fresh 2FA). */
async function moduleOff(p, secret, label) {
  const sw = p.getByRole('switch', { name: `${label} module` });
  if ((await sw.getAttribute('aria-checked')) === 'false') return;
  await sw.click();
  const dlg = p.getByRole('dialog').filter({ hasText: 'Switch off' });
  await dlg.locator('textarea').fill('Not used by this organization yet');
  await dlg.getByRole('button', { name: 'Switch off' }).click();
  await answerStepUp(p, secret);
  await p.getByRole('switch', { name: `${label} module` }).and(p.locator('[aria-checked=false]')).waitFor({ timeout: 30000 });
}

/** The payments screen asks for a reason in a modal before saving. */
async function paymentsReason(p, reason) {
  const dlg = p.getByRole('dialog').filter({ hasText: 'Reason' }).last();
  await dlg.locator('textarea, input').last().fill(reason);
  await dlg.getByRole('button', { name: 'Save' }).click();
}

/** Upload → Map → Check → Preview → Import → Reconcile → sign off (Settings › Data import). */
async function importFile(p, entity, file, source) {
  await p.goto(`${BASE}/settings/import/new?entity=${entity}`);
  await p.fill('#imp-source', source);
  await p.setInputFiles('#imp-file', path.join(FIXTURES, 'o-golive', file));
  await p.getByText(/rows, \d+ columns/).waitFor({ timeout: 20000 });
  await p.getByRole('button', { name: 'Next: map the columns' }).click();
  await p.getByRole('heading', { name: 'Map the columns' }).waitFor({ timeout: 30000 });
  await p.getByRole('button', { name: 'Next: check every row' }).click();
  await p.getByRole('heading', { name: 'Check every row' }).waitFor();
  await p.getByRole('button', { name: /^Next: preview/ }).click();
  await p.waitForURL(/\/settings\/import\/[0-9a-f-]{36}/, { timeout: 120000 });
  const id = p.url().match(/import\/([0-9a-f-]{36})/)[1];
  await p.getByText('Will be added').first().waitFor({ timeout: 90000 });
  await p.getByRole('button', { name: /^Import [\d,]+ rows$/ }).click();
  await p.getByRole('button', { name: 'Compare with the file' }).waitFor({ timeout: 180000 });
  for (let attempt = 1; ; attempt++) {
    await p.getByRole('button', { name: 'Compare with the file' }).click();
    const done = await p.getByText(/Everything matches the file|Some numbers differ from the file/).waitFor({ timeout: 20000 }).then(() => true, () => false);
    if (done) break;
    if (attempt >= 3) throw new Error(`${entity}: the reconciliation did not appear`);
  }
  if (!(await p.getByText('Everything matches the file').isVisible())) await p.fill('#signoff-note', 'Checked by hand against the file.');
  await p.getByRole('button', { name: /^Sign off/ }).click();
  await p.getByText(/^Signed off /).waitFor({ timeout: 30000 });
  return id;
}

// ── 3. Stage 1: services, and the rest of Stage 0 ─────────────────────────────
async function phaseServices(browser, S) {
  const p = S.owner.p;
  const tp = S.treasurer.p;

  // Modules: this organization does not use the store, Pathshala, bolis, volunteers, surveys,
  // QuickBooks (Accounting) or Niva yet — their setup steps then show as skipped.
  await p.goto(BASE + '/settings/modules', { waitUntil: 'networkidle' });
  for (const label of ['Satvik Store', 'Pathshala', 'Bolis', 'Volunteers', 'Surveys & data', 'Accounting & QuickBooks', 'Niva assistant']) await moduleOff(p, S.ownerSecret, label);
  ok(sql(`select count(*) from app.center_modules where center_id = '${S.sbx}' and not enabled`) === '7', '4 · seven modules switched off in Settings › Modules (reason + fresh 2FA)');
  ok(audits(S, 'center_modules').filter((a) => a === 'portal|/settings/modules|Not used by this organization yet').length === 7, '4 · audit: each switch from Settings › Modules with its reason');

  // Agreements (the owner).
  for (const kind of ['terms', 'dpa', 'children_addendum']) {
    await p.goto(BASE + '/settings/agreements', { waitUntil: 'networkidle' });
    const form = p.getByTestId(`agreement-${kind}`).locator('form').first();
    if (!(await form.count())) continue;
    await form.locator('input[name=confirm]').check();
    await form.getByRole('button', { name: /^Accept / }).click();
    await until(() => sql(`select count(*) from app.org_agreements where center_id = '${S.sbx}' and kind = '${kind}'`) === '1', 20000);
  }
  ok(sql(`select (app.check_agreements_accepted('${S.sbx}')->>'ok')`) === 'true', '4 · the owner accepts the terms, the DPA and the children\'s addendum (readiness 2)');

  // Sandbox test recipient: the owner's own address, verified by a code.
  await p.goto(BASE + '/settings/limits', { waitUntil: 'networkidle' });
  const addForm = p.locator('form').filter({ has: p.locator('input[name=address]') });
  await addForm.locator('select[name=channel]').selectOption('email');
  await addForm.locator('input[name=address]').fill(CONTACT);
  await addForm.getByRole('button', { name: 'Add' }).click();
  await until(() => sql(`select count(*) from app.sandbox_test_recipients where center_id = '${S.sbx}' and address = '${CONTACT}'`) === '1', 20000);
  await p.goto(BASE + '/settings/limits', { waitUntil: 'networkidle' });
  const rid = sql(`select id from app.sandbox_test_recipients where center_id = '${S.sbx}' and address = '${CONTACT}'`);
  const t0 = Date.now() - 2000;
  await p.locator('form').filter({ has: p.locator(`input[name=id][value="${rid}"]`) }).getByRole('button', { name: 'Send code' }).click();
  const vcode = (await mailMessage(CONTACT, t0, /\b(\d{6})\b/)).hit[1];
  await p.goto(BASE + '/settings/limits', { waitUntil: 'networkidle' });
  const vf = p.locator('form').filter({ has: p.locator(`input[name=id][value="${rid}"]`) }).filter({ has: p.locator('input[name=code]') });
  await vf.locator('input[name=code]').fill(vcode);
  await vf.getByRole('button', { name: 'Verify' }).click();
  ok(await until(() => sql(`select (verified_at is not null)::text from app.sandbox_test_recipients where id = '${rid}'`) === 'true', 20000),
    '4 · the owner\'s address is a verified sandbox test recipient (Settings › Limits, code by email)');

  // Email: domain (Resend mock), DNS verified, sign-in sender, footer, a test email.
  const domain = `mail-${RUN}.golivetemple.test`;
  await p.goto(BASE + '/settings/email', { waitUntil: 'networkidle' });
  const domainForm = p.locator('form', { has: p.locator('input[name=domain]') });
  await domainForm.locator('input[name=domain]').fill(domain);
  await domainForm.locator('input[name=reason]').fill('Our sending domain');
  await domainForm.getByRole('button', { name: 'Add domain' }).click();
  const domId = await until(() => sql(`select id from app.email_domains where domain = '${domain}'`));
  await until(() => Number(sql(`select coalesce(jsonb_array_length(dns_records), 0) from app.email_domains where id = '${domId}'`)) >= 3, 30000);
  await fetch(`${MOCK}/_mock/domains/${domain}/verify`, { method: 'POST' });
  await p.goto(BASE + '/settings/email', { waitUntil: 'networkidle' });
  await p.locator('form', { has: p.locator(`input[name=id][value="${domId}"]`) }).getByRole('button', { name: 'Check again' }).click();
  ok(await until(() => sql(`select status from app.email_domains where id = '${domId}'`) === 'verified', 30000), '5 · the sending domain is added and verifies (Settings › Email, worker → Resend mock)');
  await p.goto(BASE + '/settings/email', { waitUntil: 'networkidle' });
  const authForm = p.locator('form', { has: p.locator('input[name=purpose][value=auth]') });
  await authForm.locator('input[name=from_address]').fill(`codes@${domain}`);
  await authForm.getByRole('button', { name: 'Save' }).click();
  await until(() => sql(`select verified::text from app.email_senders where center_id = '${S.sbx}' and purpose = 'auth'`) === 'true', 20000);
  const footer = p.locator('form', { has: p.locator('input[name=postal_address]') });
  await footer.locator('input[name=postal_address]').fill('100 Temple Way, Austin TX 78701');
  await footer.locator('input[name=reason]').fill('CAN-SPAM footer');
  await footer.getByRole('button', { name: 'Save footer' }).click();
  await toast(p, /footer/i, 15000);
  await p.goto(BASE + '/settings/email', { waitUntil: 'networkidle' });
  await p.locator('form', { has: p.locator('input[name=channel][value=email]') }).getByRole('button', { name: 'Send a test' }).click();
  ok(await until(() => sql(`select count(*) from app.messages where center_id = '${S.sbx}' and purpose = 'test' and channel = 'email' and status in ('sent','delivered')`) !== '0', 40000),
    '5 · a test email from the organization\'s own sender reached the verified test recipient');
  ok(sql(`select (app.check_email_domain_verified('${S.sbx}')->>'ok')`) === 'true', '5 · readiness 4 passes (domain verified, codes reach any address)');

  // Texting: this organization signs members in by email only.
  await p.goto(BASE + '/settings/texting', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Switch phone sign-in off' }).click();
  await confirmIfAsked(p, 'Switch phone sign-in off');
  ok(await until(() => sql(`select (app.check_texting_registered('${S.sbx}')->>'ok')`) === 'true', 20000), '5 · phone sign-in switched off (Settings › Texting) — readiness 5');

  // Payments (the treasurer): offline only for now, cash accepted with instructions.
  await tp.goto(BASE + '/settings/payments', { waitUntil: 'networkidle' });
  await tp.getByRole('switch', { name: 'Offline payments only' }).click();
  await paymentsReason(tp, 'Launch with offline gifts; cards later');
  await until(() => sql(`select coalesce(rules #>> '{payments,offline_only}', '') from app.centers where id = '${S.sbx}'`) === 'true', 20000);
  await tp.goto(BASE + '/settings/payments', { waitUntil: 'networkidle' });
  const cash = tp.locator('section[aria-label="Cash (bhandar)"]');
  await cash.getByRole('switch', { name: 'Accept Cash (bhandar)' }).click();
  await cash.getByLabel(/Where to give cash/).fill('Bhandar at the temple office');
  await cash.getByRole('button', { name: 'Save Cash (bhandar)' }).click();
  await paymentsReason(tp, 'How members give cash');
  ok(await until(() => sql(`select accepted::text from app.center_payment_methods where center_id = '${S.sbx}' and method = 'cash'`) === 'true', 20000),
    '5 · the treasurer chooses offline only and accepts cash with instructions (Settings › Payments) — readiness 6');

  // Bank account (the treasurer, accounting.manage).
  await tp.goto(BASE + '/giving/payments/bank', { waitUntil: 'networkidle' });
  await tp.fill('#ba-name', 'Operating account');
  await tp.fill('#ba-inst', 'Test Bank');
  await tp.fill('#ba-last4', '4321');
  await tp.getByRole('button', { name: 'Add bank account' }).click();
  ok(await until(() => sql(`select count(*) from app.bank_accounts where center_id = '${S.sbx}'`) === '1', 20000), '5 · the treasurer adds the bank account');

  // Storage retention and numbering (the owner).
  await p.goto(BASE + '/settings/storage', { waitUntil: 'networkidle' });
  const imp = p.locator('tr[data-bucket=imports]');
  await imp.locator('input[name=days]').fill('60');
  await imp.getByRole('button', { name: 'Save' }).click();
  ok(await until(() => sql(`select rules #>> '{storage,retention_days,imports}' from app.centers where id = '${S.sbx}'`) === '60', 20000), '5 · import files are kept 60 days (Settings › Storage)');
  await p.goto(BASE + '/settings/numbering', { waitUntil: 'networkidle' });
  await p.locator('tr[data-kind=member] input[name=prefix_member]').fill('GT-');
  await p.locator('tr[data-kind=member] input[name=next_member]').fill('5001');
  await p.fill('#numbering-reason', 'Adopt our register numbers');
  await p.getByRole('button', { name: 'Save numbering' }).click();
  ok(await toast(p, /cannot go back/, 20000), '5 · numbering: going back below numbers already issued is refused, in plain English');
  await p.goto(BASE + '/settings/numbering', { waitUntil: 'networkidle' });
  await p.locator('tr[data-kind=member] input[name=prefix_member]').fill('GT-');
  await p.locator('tr[data-kind=member] input[name=next_member]').fill('20001');
  await p.fill('#numbering-reason', 'Adopt our register numbers');
  await p.getByRole('button', { name: 'Save numbering' }).click();
  ok(await until(() => sql(`select prefix||next_value from app.number_sequences where center_id = '${S.sbx}' and kind = 'member'`) === 'GT-20001', 20000), '5 · member numbers continue at GT-20001 (Settings › Numbering)');
  ok(audits(S, 'number_sequences').some((a) => a === 'portal|/settings/numbering|Adopt our register numbers'), '5 · audit: the numbering change with its reason');
}

/** Some buttons ask to confirm in a modal; answer it when it appears. */
async function confirmIfAsked(p, label) {
  const dlg = p.locator('[role=dialog][aria-modal=true]').filter({ has: p.getByRole('button', { name: label }) }).last();
  if (await dlg.waitFor({ timeout: 3000 }).then(() => true, () => false)) await dlg.getByRole('button', { name: label }).click();
}

// ── 4. Stages 2–5: documents, templates, setup data, records ─────────────────
async function phaseData(browser, S) {
  const p = S.owner.p;
  const tp = S.treasurer.p;
  const addList = async (page, anchor, button, fill) => {
    await page.goto(BASE + '/setup/lists', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: button, exact: true }).first().click();
    const d = page.locator('aside[role=dialog]').last();
    await fill(d);
    await d.getByRole('button', { name: button, exact: true }).click();
    return toast(page, /added · audit logged/, 20000);
  };

  ok(await addList(p, 'membership', 'Add membership type', async (d) => {
    await d.locator('input[name=name]').fill('Yearly family');
    await d.locator('select[name=tier]').selectOption('yearly');
    await d.locator('input[name=fee]').fill('150');
    await d.locator('input[name=period_months]').fill('12');
  }), '6 · the owner adds a membership type (Setup › Lists)');
  ok(sql(`select fee_cents||'|'||period_months from app.membership_types where center_id = '${S.sbx}' and key = 'yearly_family'`) === '15000|12', '6 · membership type saved: $150 for 12 months');
  ok(await addList(p, 'inboxes', 'Add inbox', async (d) => { await d.locator('input[name=name]').fill('Office'); }), '6 · the owner adds the Office inbox');
  ok(await addList(p, 'zones', 'Add zone', async (d) => { await d.locator('input[name=name]').fill('Central Austin'); await d.locator('textarea[name=zip_codes]').fill('78701 78702'); }), '6 · the owner adds a zone');
  ok(await addList(tp, 'funds', 'Add fund', async (d) => { await d.locator('input[name=name]').fill('General fund'); }), '6 · the treasurer adds the general fund');
  ok(audits(S, 'membership_types').concat(audits(S, 'funds'), audits(S, 'inboxes'), audits(S, 'zones')).every((a) => a.startsWith('portal|/setup/lists|')),
    '6 · audit: every list row from Setup › Lists');

  // A campaign (the treasurer).
  await tp.goto(BASE + '/giving/opportunities/campaigns', { waitUntil: 'networkidle' });
  await tp.fill('#c-name', 'Annual appeal');
  const fundId = sql(`select id from app.funds where center_id = '${S.sbx}' and key = 'general_fund'`);
  await tp.selectOption('#c-fund', fundId);
  await tp.getByRole('button', { name: 'Create draft' }).click();
  ok(await until(() => sql(`select count(*) from app.campaigns where center_id = '${S.sbx}'`) === '1', 20000), '6 · the treasurer creates a campaign (Giving › Campaigns)');

  // A guide section (the owner).
  await p.goto(BASE + '/content/guide', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'New section' }).click();
  let d = p.locator('aside[role=dialog]').last();
  await d.locator('input[name=title]').fill('New to the temple');
  await d.locator('input[name=slug]').fill('new-here');
  await d.locator('textarea[name=body_md]').fill('Welcome! Darshan hours, parking and who to ask.');
  await d.getByRole('button', { name: 'Add section' }).click();
  ok(await until(() => sql(`select count(*) from app.guide_sections where center_id = '${S.sbx}'`) === '1', 20000), '6 · the owner adds a guide section (Content › Guide)');

  // Member legal documents: written, then published.
  for (const [kind, title] of [['terms', 'Terms of use'], ['privacy', 'Privacy policy'], ['photo_release', 'Photo policy']]) {
    await p.goto(BASE + '/content/legal', { waitUntil: 'networkidle' });
    await p.getByRole('button', { name: 'New document' }).click();
    d = p.locator('aside[role=dialog]').last();
    await d.locator('select[name=kind]').selectOption(kind);
    await d.locator('input[name=title]').fill(title);
    await d.locator('input[name=version]').fill('1.0');
    await d.locator('textarea[name=body_md]').fill(`${title} of ${ORG} (test text).`);
    await d.getByRole('button', { name: 'Save draft' }).click();
    await until(() => sql(`select count(*) from app.legal_documents where center_id = '${S.sbx}' and kind = '${kind}'`) === '1', 20000);
    await p.goto(BASE + '/content/legal', { waitUntil: 'networkidle' });
    await p.getByRole('button', { name: 'Publish 1.0' }).first().click();
    await confirmModal(p, 'Publish 1.0');
    await until(() => sql(`select count(*) from app.legal_documents where center_id = '${S.sbx}' and kind = '${kind}' and published_at is not null`) === '1', 20000);
  }
  ok(sql(`select (app.check_member_legal_documents_published('${S.sbx}')->>'ok')`) === 'true', '6 · terms, privacy and photo policy written and published (Content › Legal) — readiness 11');

  // The treasurer reviews the receipt wording and approves it (readiness 8).
  await tp.goto(BASE + '/giving/statements', { waitUntil: 'networkidle' });
  await tp.fill('#rt-signed', 'Tara Desai, Treasurer');
  await tp.getByRole('button', { name: 'Save template' }).click();
  await toast(tp, /template saved/i, 20000);
  await tp.goto(BASE + '/giving/statements', { waitUntil: 'networkidle' });
  const card = tp.getByTestId('approval-statement-templates');
  ok((await card.getAttribute('data-approval')) === 'none', '7 · the approval card says the templates are not approved yet');
  await card.locator('input[name=note]').fill('Reviewed the receipt and year-end wording');
  await card.getByRole('button', { name: 'Approve' }).click();
  ok(await until(() => sql(`select (app.check_statement_templates_approved('${S.sbx}')->>'ok')`) === 'true', 20000), '7 · the treasurer approves the receipt and statement templates — readiness 8');
  ok(audits(S, 'golive_approvals').some((a) => a === 'portal|/giving/statements|Reviewed the receipt and year-end wording'), '7 · audit: the approval from Receipts & statements with the treasurer\'s note');
  await tp.goto(BASE + '/giving/statements', { waitUntil: 'networkidle' });
  ok((await tp.getByTestId('approval-statement-templates').getAttribute('data-approval')) === 'current', '7 · the card shows "Approved" with who and when');
  await shot(tp, '7-statements-approved');
  // The owner (not the treasurer) is told who approves.
  await p.goto(BASE + '/giving/statements', { waitUntil: 'networkidle' });
  ok((await p.getByTestId('approval-statement-templates').innerText()).includes('Approved by Tara'), '7 · the owner sees the treasurer\'s approval');

  // Records: households and people imported, reconciled and signed off.
  await importFile(p, 'households', 'households.csv', 'Old register');
  await importFile(p, 'people', 'people.csv', 'Old register');
  ok(sql(`select count(*) from app.import_runs where center_id = '${S.sbx}' and status = 'reconciled'`) === '2', '8 · households and people imported, reconciled and signed off (Settings › Data import)');
}

// ── 4b. Stages 4–5 completed: memberships, giving history, and a step marked by hand ──
async function phaseHistory(browser, S) {
  const p = S.owner.p;
  const tp = S.treasurer.p;
  await importFile(p, 'memberships', 'memberships.csv', 'Old register');
  ok(sql(`select count(*) from app.memberships where center_id = '${S.sbx}'`) === '2', '8 · current memberships imported and signed off (the membership coordinator\'s part, here the owner)');
  await importFile(tp, 'pledges', 'pledges.csv', 'Old register');
  await importFile(tp, 'payments', 'payments.csv', 'Old register');
  ok(sql(`select count(*) from app.payments where center_id = '${S.sbx}' and is_historical`) === '1' && sql(`select count(*) from app.pledges where center_id = '${S.sbx}'`) === '1',
    '8 · the treasurer imports the giving history (a pledge and its historical payment), reconciled and signed off');
  ok(sql(`select count(*) from app.ledger_postings where center_id = '${S.sbx}'`) === '0', '8 · the historical payment is never queued for QuickBooks');

  // No recurring gifts in the old system: the owner marks the step done by hand, with a note.
  await p.goto(BASE + '/setup', { waitUntil: 'networkidle' });
  const row = p.locator('tr[data-step="hist.recurring"]');
  await row.getByRole('button', { name: 'Edit' }).click();
  const d = p.locator('aside[role=dialog]').last();
  await d.locator('select[name=status]').selectOption('done');
  await d.locator('textarea[name=notes]').fill('The old system has no recurring gifts.');
  await d.getByRole('button', { name: 'Save step' }).click();
  ok(await until(() => sql(`select status from app.center_setup_steps where center_id = '${S.sbx}' and step_key = 'hist.recurring'`) === 'done', 20000),
    '8 · a step with nothing to load is marked done by hand in the checklist, with a note');
}

// ── 5. Stages 7–8: confirmations, readiness green, request go-live ───────────
async function phaseGoLive(browser, S) {
  const p = S.owner.p;
  await p.goto(BASE + '/setup/go-live', { waitUntil: 'networkidle' });
  for (const key of ['staff_trained', 'health_check_green', 'pilot_done']) {
    const li = p.locator(`li[data-attestation=${key}]`);
    await li.locator('input[name=note]').fill(`${key.replace(/_/g, ' ')} — done in the sandbox`);
    await li.getByRole('button', { name: 'Confirm' }).click();
    await li.getByText('Confirmed', { exact: false }).waitFor({ timeout: 20000 });
  }
  ok(sql(`select count(*) from app.center_attestations where center_id = '${S.sbx}'`) === '3', '9 · the owner confirms training, the health check and the pilot (readiness 13)');

  // The background service reported in (readiness 14).
  await until(() => sql(`select count(*) from app.worker_heartbeats where worker = 'e2e-golive-${RUN}' and stopped_at is null`) === '1', 30000);

  await p.goto(BASE + '/setup/readiness', { waitUntil: 'networkidle' });
  await shot(p, '9-readiness');
  const states = await p.locator('tr[data-check]').evaluateAll((rs) => rs.map((r) => [r.getAttribute('data-check'), r.getAttribute('data-state'), r.innerText.replace(/\s+/g, ' ').slice(0, 200)]));
  const failing = states.filter(([, st]) => st !== 'pass');
  ok(states.length === 14 && failing.length === 0, `9 · Setup › Go-live readiness: all ${states.length} checks pass in the UI` + (failing.length ? ` — not passing: ${failing.map((f) => f[2]).join(' | ')}` : ''));
  ok((await p.getByTestId('interim-statement_templates_approved').count()) === 1 && (await p.getByTestId('interim-niva_evaluated').count()) === 1,
    '9 · checks 8 and 12 say on screen that their full versions come later');

  await p.goto(BASE + '/setup/go-live', { waitUntil: 'networkidle' });
  await submitConfirmed(p, p.locator('main'), 'Request go-live');
  await p.getByTestId('golive-status').waitFor({ timeout: 20000 });
  await shot(p, '9-go-live-requested');
  ok(sql(`select status||'|'||requested_by from app.golive_requests where center_id = '${S.sbx}'`) === `requested|${S.ownerId}`, '9 · the go-live request succeeds (requested by the owner)');
  ok(sql(`select jsonb_array_length(readiness) from app.golive_requests where center_id = '${S.sbx}'`) === '14', '9 · the request carries the readiness evidence (14 checks)');

  // The checklist, walked: every required step of a module that is on is done, or waits only on Community Connect.
  await p.goto(BASE + '/setup', { waitUntil: 'networkidle' });
  await shot(p, '9-checklist-final');
  const steps = await p.locator('tr[data-step]').evaluateAll((rs) => rs.map((r) => [r.getAttribute('data-step'), r.getAttribute('data-status')]));
  const open = steps.filter(([, st]) => !['done', 'skipped', 'needs_review'].includes(st)).map(([k, st]) => `${k}:${st}`);
  console.log('   steps not done (optional or manual):', open.join(', ') || 'none');
  const required = sql(`select string_agg(key, ',') from app.setup_steps where required`).split(',');
  const requiredOpen = open.filter((x) => required.includes(x.split(':')[0]));
  ok(requiredOpen.length === 0, `9 · every required step of the modules that are on is done (or waits only on Community Connect)${requiredOpen.length ? ': still open ' + requiredOpen.join(', ') : ''}`);
  ok((await p.locator('text=Coming soon').count()) === 0 && (await p.locator('tr[data-step]', { hasText: 'Off-screen' }).count()) === 0,
    '9 · every step links to a working screen (no "Coming soon", no "Off-screen")');
}



// ── 2a. The team: a second administrator and a treasurer ─────────────────────
async function phaseTeam(browser, S) {
  const p = S.owner.p;
  const invite = async (first, last, email, roleRe) => {
    await p.goto(BASE + '/settings/team', { waitUntil: 'networkidle' });
    const form = p.locator('form').filter({ hasText: 'Create invitation' });
    await form.getByLabel('First name').fill(first);
    await form.getByLabel('Last name').fill(last);
    await form.getByLabel('Email').fill(email);
    await form.getByLabel(roleRe).check();
    await form.getByRole('button', { name: 'Create invitation' }).click();
    await answerStepUp(p, S.ownerSecret);
    const linkEl = p.getByTestId('invitation-link'); await linkEl.waitFor({ timeout: 20000 });
    return linkEl.inputValue();
  };
  const accept = async (link, email, name) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const ip = await ctx.newPage();
    ip.on('pageerror', (e) => console.error(`[${name} page error]`, String(e)));
    await ip.goto(link, { waitUntil: 'networkidle' });
    const t1 = Date.now() - 2000;
    await ip.getByLabel(/Your email/).fill(email);
    await ip.getByRole('button', { name: 'Send code' }).click();
    await ip.getByLabel('Code').fill(await mailCode(email, t1));
    await ip.getByRole('button', { name: 'Verify and accept' }).click();
    await ip.waitForURL((u) => u.pathname === '/account/security', { timeout: 30000 });
    const secret = await enrollInPortal(ip);
    await ip.goto(BASE + '/', { waitUntil: 'networkidle' });
    await shot(ip, `2-${name}-after-accept`);
    const on = (await ip.locator('header').first().innerText().catch(() => '')).includes(ORG);
    ok(on, `2 · ${name}: after accepting, the portal opens on the inviting sandbox`);
    if (!on) await switchTo(ip, `${SLUG}-sandbox`, ORG);
    return { ctx, p: ip, secret, id: sql(`select id from auth.users where email = '${email}'`) };
  };

  const secondLink = await invite('Vikram', 'Shah', SECOND, /Center admin/);
  const treasurerLink = await invite('Tara', 'Desai', TREASURER, /^Treasurer/);
  ok(sql(`select count(*) from app.staff_invitations where center_id = '${S.sbx}' and accepted_at is null`) === '2', '2 · the owner invites a second administrator and a treasurer (Settings › Team, fresh 2FA)');
  ok(audits(S, 'staff_invitations').filter((a) => a.startsWith('portal|/settings/team|')).length === 2, '2 · audit: both invitations from Settings › Team');
  S.second = await accept(secondLink, SECOND, 'second');
  S.treasurer = await accept(treasurerLink, TREASURER, 'treasurer');
  ok(sql(`select string_agg(role_key||':'||status, ',' order by role_key) from app.role_grants where center_id = '${S.sbx}' and user_id in ('${S.second.id}','${S.treasurer.id}')`) === 'center_admin:pending,treasurer:pending',
    '2 · both accepted and set up 2FA; their roles wait for a second approver (two-person rule)');

  // The owner made both grants, so neither the owner nor the grantee may approve them. With no
  // other administrator yet, Community Connect approves the second administrator (Needs owner decision B5).
  const c2 = await portalSignIn(browser, CC2, 'cc2');
  S.cc2Secret = await enrollInPortal(c2.p);
  await c2.p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await switchTo(c2.p, `${SLUG}-sandbox`, ORG);
  await c2.p.goto(BASE + '/settings/roles?show=pending', { waitUntil: 'networkidle' });
  let row = c2.p.locator('tr').filter({ hasText: 'Vikram' }).filter({ hasText: 'Center admin' });
  await row.getByRole('button', { name: 'Approve' }).click();
  await confirmModal(c2.p, 'Approve');
  await answerStepUp(c2.p, S.cc2Secret);
  ok(await until(() => sql(`select status from app.role_grants where center_id = '${S.sbx}' and user_id = '${S.second.id}' and role_key = 'center_admin'`) === 'active'),
    '2 · a Community Connect admin approves the second administrator in the organization\'s Settings › Roles');
  await c2.ctx.close();

  // Now the organization runs the two-person rule itself: the second administrator approves the treasurer.
  const vp = S.second.p;
  await vp.goto(BASE + '/settings/roles?show=pending', { waitUntil: 'networkidle' });
  await shot(vp, '2-second-admin-roles');
  row = vp.locator('tr').filter({ hasText: 'Tara' }).filter({ hasText: 'Treasurer' });
  await row.getByRole('button', { name: 'Approve' }).click();
  await confirmModal(vp, 'Approve');
  await answerStepUp(vp, S.second.secret);
  ok(await until(() => sql(`select status||'|'||second_approver from app.role_grants where center_id = '${S.sbx}' and user_id = '${S.treasurer.id}' and role_key = 'treasurer'`) === `active|${S.second.id}`),
    '2 · the second administrator approves the treasurer (Settings › Roles) — the organization\'s own two-person rule');
  ok(audits(S, 'role_grants').some((a) => a.startsWith('portal|/settings/roles')), '2 · audit: the approvals from Settings › Roles');
  ok(sql(`select (app.check_owner_and_second_admin_2fa('${S.sbx}')->>'ok')`) === 'true', '2 · readiness 3: an owner and a second administrator, both with 2FA');
}

// ── 2b. Stage 0: legal identity, profile, brand, leaders, modules, rules, agreements ──
async function phaseFoundation(browser, S) {
  const p = S.owner.p;
  const pdf = path.join(OUT, 'fixture.pdf');
  fs.writeFileSync(pdf, '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  const png = path.join(OUT, 'logo.png');
  fs.writeFileSync(png, makePng(96, 32, [27, 44, 92]));

  // Legal identity + documents, submitted and verified by Community Connect.
  await p.goto(BASE + '/setup/organization', { waitUntil: 'networkidle' });
  await p.fill('input[name=legal_name]', `${ORG} Inc`);
  await p.fill('input[name=ein]', '741234567');
  await p.selectOption('select[name=entity_type]', 'house_of_worship');
  await p.fill('input[name=incorporation_state]', 'TX');
  await p.fill('input[name=address_line1]', '100 Temple Way');
  await p.fill('input[name=address_city]', 'Austin');
  await p.fill('input[name=address_state]', 'TX');
  await p.fill('input[name=address_postal_code]', '78701');
  await p.fill('input[name=authorized_signer_name]', 'Asha Mehta');
  await p.fill('input[name=authorized_signer_title]', 'President');
  await p.getByRole('button', { name: 'Save legal identity' }).click();
  ok(await toast(p, /Legal identity saved/), '3 · legal identity saved (Setup › Legal identity)');
  for (const kind of ['w9', 'board_letter']) {
    await p.goto(BASE + '/setup/organization', { waitUntil: 'networkidle' });
    await p.selectOption('select[name=kind]', kind);
    await p.setInputFiles('input#doc-file', pdf);
    await p.getByRole('button', { name: 'Upload document' }).click();
    ok(await until(() => sql(`select count(*) from app.org_documents where center_id = '${S.sbx}' and kind = '${kind}'`) === '1', 30000),
      `3 · ${kind} uploaded to the private document store`);
  }
  await p.goto(BASE + '/setup/organization', { waitUntil: 'networkidle' });
  await shot(p, '3-organization-before-submit');
  await p.getByRole('button', { name: 'Submit for verification' }).click();
  await confirmModal(p, 'Submit for verification');
  ok(await toast(p, /Submitted/), '3 · submitted for verification');
  const cc = S.c1;
  await cc.p.goto(BASE + '/platform/verification', { waitUntil: 'networkidle' });
  await cc.p.locator(`tr[data-center="${SLUG}-sandbox"]`).getByRole('button', { name: 'Review' }).click();
  const drawer = cc.p.locator('aside[role=dialog]');
  await drawer.getByRole('button', { name: 'Verify non-profit' }).click();
  await confirmModal(cc.p, 'Verify non-profit');
  ok(await until(() => sql(`select verification_status from app.org_profiles where center_id = '${S.sbx}'`) === 'verified'), '3 · Community Connect verifies the non-profit (Platform › Verification) — readiness 1');

  // Profile and brand kit.
  await p.goto(BASE + '/setup/profile', { waitUntil: 'networkidle' });
  await p.fill('input[name=short_name]', 'GT');
  await p.fill('textarea[name=mission]', 'To practise and share the Jain way of life in Austin.');
  await p.fill('input[name=public_email]', `office.${RUN}@golivetemple.test`);
  await p.fill('input[name=public_phone]', '(512) 555-0100');
  await p.fill('input[name=latitude]', '30.2672');
  await p.fill('input[name=longitude]', '-97.7431');
  await p.getByRole('button', { name: 'Save profile' }).click();
  ok(await toast(p, /Profile saved/), '3 · profile saved (mission, public contact, map pin)');
  await p.goto(BASE + '/setup/profile', { waitUntil: 'networkidle' });
  const logoCard = p.locator('[data-brand-file="logo_path"]');
  await logoCard.locator('input[type=file]').setInputFiles(png);
  await logoCard.getByRole('button', { name: 'Upload' }).click();
  ok(await toast(p, /Horizontal logo uploaded/), '3 · logo uploaded to the branding store');
  await p.goto(BASE + '/setup/profile', { waitUntil: 'networkidle' });
  await p.fill('input[name=primary]', '#1B2C5C');
  await p.fill('input[name=accent]', '#C9731C');
  await p.getByRole('button', { name: 'Save colors' }).click();
  ok(await toast(p, /Brand colors saved/), '3 · brand colors saved');

  // Leaders.
  await p.goto(BASE + '/setup/leaders', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Add leader' }).click();
  const d = p.locator('aside[role=dialog]');
  await d.locator('input[name=full_name]').fill('Asha Mehta');
  await d.locator('input[name=title]').fill('President');
  await d.getByRole('button', { name: 'Add leader' }).click();
  ok(await toast(p, /Asha Mehta saved/), '3 · a leader is added');

  S.done0 = true;
}



/** Dump every checklist screen for the owner (text + screenshot) — the audit's evidence. */
async function phaseExplore(S) {
  const p = S.owner.p;
  const routes = sql(`select distinct split_part(route, '#', 1) from app.setup_steps where route is not null order by 1`).split('\n');
  const extra = ['/settings/roles', '/settings/team', '/settings/member-app', '/settings/limits', '/settings/integrations', '/settings/privacy',
                 '/settings/support-access', '/settings/data-quality', '/settings/audit', '/settings/custom-fields', '/setup/readiness'];
  for (const r of [...new Set([...routes, ...extra])]) {
    const res = await p.goto(BASE + r, { waitUntil: 'networkidle' }).catch((e) => ({ status: () => 0, e }));
    const text = await p.innerText('main').catch(() => '(no main)');
    const name = r.replace(/\//g, '_');
    fs.writeFileSync(`${OUT}/explore${name}.txt`, `${res.status()}\n${text}`);
    await shot(p, `explore${name}`);
    const bad = /Something went wrong|Application error|could not load|This page could not be found/i.test(text);
    ok(res.status() === 200 && !bad, `screen ${r} opens for the owner (${res.status()})`);
  }
}

if (require.main === module) (async () => {
  // ── Arrange (test stack only) ──────────────────────────────────────────────
  for (const e of [CC1, CC2]) {
    await http('/auth/v1/admin/users', { method: 'POST', service: true, body: { email: e, email_confirm: true } });
    sql(`insert into app.accounts (user_id, is_platform_admin) select id, true from auth.users where email = '${e}' on conflict (user_id) do update set is_platform_admin = true`);
  }
  // The platform admins set up 2FA in this run (an earlier run's authenticator is removed; test logins only).
  sql(`delete from auth.mfa_factors where user_id in (select id from auth.users where email in ('${CC1}','${CC2}'))`);
  const cc1Id = sql(`select id from auth.users where email = '${CC1}'`);
  const cc2Id = sql(`select id from auth.users where email = '${CC2}'`);
  // Community Connect's own agreement texts must be published for any organization to accept them.
  sql(`update app.legal_documents set published_at = now() - interval '1 minute' where center_id is null and published_at is null and kind in ('org_terms','dpa','children_addendum','sandbox_terms')`);
  sql(`update auth.users set phone = null, phone_confirmed_at = null, phone_change = '', phone_change_token = '' where phone = '${PHONE_DIGITS}' or phone_change = '${PHONE_DIGITS}'`);
  sql(`delete from app.public_rate_events where kind like 'access_request.%' or kind like 'sandbox_code.%'`);
  const auditStart = Number(sql('select coalesce(max(id), 0) from app.audit_log'));

  // The background service as connect_worker, pointed at the mock providers.
  const workerPw = crypto.randomBytes(24).toString('hex');
  sql(`alter role connect_worker with password '${workerPw}'`);
  const logs = [];
  const RT = readEnv(process.env.RUNTIME || '/tmp/claude-0/o-golive/runtime.env');
  const worker = spawn(process.execPath, [WORKER_JS], {
    env: { PATH: process.env.PATH, WORKER_DATABASE_URL: `postgres://connect_worker:${workerPw}@${new URL(DB).host}/postgres`, WORKER_ID: `e2e-golive-${RUN}`,
           WORKER_HEALTH_PORT: '3920', WORKER_POLL_MS: '500', WORKER_HEARTBEAT_MS: '5000',
           RESEND_API_KEY: 're_mock_golive', RESEND_API_BASE: MOCK, MESSAGING_FROM_ADDRESS: 'hello@communityconnect.test', MESSAGING_FROM_NAME: 'Community Connect',
           PORTAL_PUBLIC_URL: RT.PORTAL_PUBLIC_URL || BASE, MESSAGING_LINK_SECRET: RT.MESSAGING_LINK_SECRET || 'x' },
  });
  worker.stdout.on('data', (d) => logs.push(...d.toString().trim().split('\n')));
  worker.stderr.on('data', (d) => logs.push(...d.toString().trim().split('\n')));

  const browser = await chromium.launch();
  const S = {};   // what later phases need
  try {
    await run({ browser, S, cc1Id, cc2Id, auditStart });
  } catch (e) {
    if (e.message !== '__stop__') {
      console.error(e); process.exitCode = 1;
      for (const [k, v] of Object.entries(S)) if (v && v.p && typeof v.p.screenshot === 'function') await shot(v.p, `error-${k}`);
    }
  } finally {
    await browser.close();
    worker.kill('SIGTERM');
    fs.writeFileSync(`${OUT}/worker.log`, logs.join('\n') + '\n');
    console.log(`${failures === 0 && !process.exitCode ? 'ALL PASS' : 'FAILURES: ' + failures}`);
  }
})();
