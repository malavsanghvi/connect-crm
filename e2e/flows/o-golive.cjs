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
  await p.getByRole('menuitemradio').filter({ hasText: slug }).click();
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
  if (process.env.EXPLORE) await phaseExplore(S);
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
    const on = (await ip.getByTestId('center-switcher').innerText().catch(() => '')).includes(ORG);
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
    ok(await toast(p, /uploaded/i), `3 · ${kind} uploaded to the private document store`);
  }
  await p.goto(BASE + '/setup/organization', { waitUntil: 'networkidle' });
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
           RESEND_API_KEY: 're_mock_golive', RESEND_API_BASE: MOCK, EMAIL_FROM_DEFAULT: 'Community Connect <hello@communityconnect.test>',
           PORTAL_PUBLIC_URL: RT.PORTAL_PUBLIC_URL || BASE, MESSAGING_LINK_SECRET: RT.MESSAGING_LINK_SECRET || 'x' },
  });
  worker.stdout.on('data', (d) => logs.push(...d.toString().trim().split('\n')));
  worker.stderr.on('data', (d) => logs.push(...d.toString().trim().split('\n')));

  const browser = await chromium.launch();
  const S = {};   // what later phases need
  try {
    await run({ browser, S, cc1Id, cc2Id, auditStart });
  } catch (e) {
    if (e.message !== '__stop__') { console.error(e); process.exitCode = 1; }
  } finally {
    await browser.close();
    worker.kill('SIGTERM');
    fs.writeFileSync(`${OUT}/worker.log`, logs.join('\n') + '\n');
    console.log(`${failures === 0 && !process.exitCode ? 'ALL PASS' : 'FAILURES: ' + failures}`);
  }
})();
