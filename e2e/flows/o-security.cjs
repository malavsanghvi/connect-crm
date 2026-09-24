// o-security flow (organization onboarding, Step 0.1 / 0.5 / 0.7), against a real local stack:
//   1. the admin sets up 2FA in Account › Security (TOTP computed here from the setup key);
//   2. a sensitive action is refused without a fresh 2FA check (SQLSTATE CCSTP) and succeeds after one —
//      over the API, and in the portal through the step-up modal (invite staff);
//   3. the invited person (no login yet) opens the link, signs in with an emailed code, accepts,
//      and sets up 2FA; the two-person rule holds their center_admin grant until a second admin approves;
//   4. the owner accepts the organization agreements;
//   5. the owner transfers ownership to the new administrator;
//   6. every step leaves its audit row; both o-security readiness checks pass.
//
//   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright BASE=http://localhost:3200 MAIL=http://localhost:55424 \
//   API=http://localhost:55421 DB=postgres://postgres:postgres@localhost:55532/postgres ENVF=e2e/.env.o-security \
//   OUT=/tmp/claude-0/streams/o-security node e2e/flows/o-security.cjs
//
// Test data only: it resets the admin's authenticator apps, JSH's accepted agreements, the platform
// agreement drafts' publication and the owner at the start, so it can be re-run on the same stack.
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3200';
const MAIL = process.env.MAIL || 'http://localhost:55424';
const API = process.env.API || 'http://localhost:55421';
const DB = process.env.DB || 'postgres://postgres:postgres@localhost:55532/postgres';
const OUT = process.env.OUT || '/tmp/claude-0/streams/o-security';
const ENVF = process.env.ENVF || path.join(__dirname, '..', '.env.o-security');
fs.mkdirSync(OUT, { recursive: true });
const env = Object.fromEntries(fs.readFileSync(ENVF, 'utf8').trim().split('\n').map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
const JSH = '00000000-0000-4000-8000-000000000001';
const ADMIN = 'admin@jsh.test';
const RUN = Date.now().toString(36);
const INVITEE = `nisha.${RUN}@jsh.test`;
const SECOND = 'second.admin@jsh.test';

const sql = (q) => execSync(`psql "${DB}" -Atc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

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
  while (usedStep.get(secret) === step) { await new Promise((r) => setTimeout(r, 1000)); step = Math.floor(Date.now() / 30000); }
  usedStep.set(secret, step);
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32(secret)).update(c).digest(); const o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

// ── Mail and API helpers ─────────────────────────────────────────────────────
async function mailCode(email, after) {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + email)}`).then((x) => x.json());
    const m = (r.messages || []).find((x) => new Date(x.Created).getTime() >= after);
    if (m) { const f = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((x) => x.json()); const c = (f.Text || '').match(/\b(\d{6,10})\b/); if (c) return c[1]; }
    await new Promise((r) => setTimeout(r, 500));
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
async function apiStepUp(token, factorId, secret) {
  const ch = await http(`/auth/v1/factors/${factorId}/challenge`, { method: 'POST', token, body: {} });
  const vf = await http(`/auth/v1/factors/${factorId}/verify`, { method: 'POST', token, body: { challenge_id: ch.body.id, code: await totp(secret) } });
  if (!vf.body.access_token) throw new Error('step-up failed: ' + JSON.stringify(vf.body));
  return vf.body.access_token;
}
const claims = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url'));

/**
 * Email-code sign-in. An account with an authenticator app is then asked for its code:
 * `totpSecret` answers it; without one the flow clicks "Not now" (allowed while JSH does not require 2FA).
 */
async function portalSignIn(browser, email, { totpSecret } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(BASE + '/login'); const t0 = Date.now() - 2000;
  await p.fill('input[name=email]', email); await p.click('button[type=submit]');
  await p.waitForSelector('input[name=code]'); await p.fill('input[name=code]', await mailCode(email, t0));
  await p.click('button[type=submit]');
  await Promise.race([
    p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }),
    p.waitForSelector('input[name=totp]', { timeout: 30000 }),
  ]);
  let askedTotp = false;
  if (new URL(p.url()).pathname.startsWith('/login')) {
    askedTotp = true;
    await shot(p, 'login-2fa-step');
    if (totpSecret) {
      await p.fill('input[name=totp]', await totp(totpSecret));
      await p.getByRole('button', { name: 'Verify' }).click();
    } else {
      await p.getByRole('button', { name: 'Not now' }).click();
    }
    await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  }
  return { ctx, p, errs, askedTotp };
}

/** Account › Security: add an authenticator app, reading the setup key off the page. Returns the secret. */
async function enrollInPortal(p, name) {
  await p.goto(BASE + '/account/security', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /Set up an authenticator app/ }).click();
  const secretEl = p.getByTestId('totp-secret'); await secretEl.waitFor();
  const secret = (await secretEl.innerText()).replace(/\s+/g, '');
  await shot(p, `${name}-enroll-qr`);
  await p.getByLabel('Code from the app').fill(await totp(secret));
  await p.getByRole('button', { name: 'Turn on 2FA' }).click();
  await p.getByText('2FA is on', { exact: false }).first().waitFor({ timeout: 20000 });
  await p.waitForLoadState('networkidle');
  return secret;
}

/** If the step-up modal is open, answer it with a fresh TOTP. Returns true when it was asked. */
async function answerStepUp(p, secret) {
  const dialog = p.getByRole('dialog').filter({ hasText: 'Confirm it' });
  try { await dialog.waitFor({ timeout: 8000 }); } catch { return false; }
  await shot(p, `step-up-modal-${Date.now()}`);
  await dialog.getByLabel('Code from your authenticator app').fill(await totp(secret));
  await dialog.getByRole('button', { name: 'Verify and continue' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 20000 });
  return true;
}

(async () => {
  // ── Reset (test stack only) ────────────────────────────────────────────────
  const adminId = sql(`select id from auth.users where email = '${ADMIN}'`);
  sql(`delete from auth.mfa_factors where user_id = '${adminId}'`);
  sql(`delete from app.org_agreements where center_id = '${JSH}'`);
  sql(`update app.legal_documents set published_at = null where center_id is null and kind in ('org_terms','dpa','children_addendum','sandbox_terms','order_form')`);
  sql(`insert into app.center_owners (center_id, user_id) values ('${JSH}', '${adminId}') on conflict (center_id) do update set user_id = excluded.user_id, transferred_from = null, since = now()`);
  // A second administrator (from an earlier grant, as JSH has) who approves under the two-person rule.
  await http('/auth/v1/admin/users', { method: 'POST', service: true, body: { email: SECOND, email_confirm: true } });
  const secondId = sql(`select id from auth.users where email = '${SECOND}'`);
  sql(`insert into app.accounts (user_id) values ('${secondId}') on conflict do nothing`);
  sql(`insert into app.role_grants (center_id, user_id, role_key, reason) select '${JSH}', '${secondId}', 'center_admin', 'o-security e2e second admin' where not exists (select 1 from app.role_grants where user_id = '${secondId}' and role_key = 'center_admin' and status = 'active')`);
  sql(`delete from auth.mfa_factors where user_id = '${secondId}'`);
  sql(`update auth.users set phone = null, phone_confirmed_at = null, phone_change = '', phone_change_token = '' where phone = '15555550102'`);
  const auditStart = Number(sql('select coalesce(max(id), 0) from app.audit_log'));

  const browser = await chromium.launch();

  // ── 1. The admin sets up 2FA ───────────────────────────────────────────────
  const admin = await portalSignIn(browser, ADMIN);
  const adminSecret = await enrollInPortal(admin.p, 'admin');
  await shot(admin.p, 'admin-2fa-on');
  ok(sql(`select count(*) from auth.mfa_factors where user_id = '${adminId}' and status = 'verified' and factor_type = 'totp'`) === '1', 'admin has one verified authenticator app');
  ok(sql(`select count(*) from app.audit_log where id > ${auditStart} and action = 'security.mfa.enrolled' and actor_user_id = '${adminId}' and client_app = 'portal'`) === '1',
    'audit: security.mfa.enrolled for the admin, from the portal');
  const adminFactor = sql(`select id from auth.mfa_factors where user_id = '${adminId}' and status = 'verified'`);

  // ── 2a. API: refused without step-up (CCSTP), accepted after ──────────────
  let tok = await apiSignIn(ADMIN);
  ok(claims(tok).aal === 'aal1', 'a fresh email-code session is aal1');
  const off1 = await http('/rest/v1/rpc/set_module_enabled', { method: 'POST', token: tok, body: { p_center: JSH, p_module: 'store', p_enabled: false, p_reason: 'o-security e2e: step-up check' } });
  ok(off1.status >= 400 && off1.body.code === 'CCSTP' && off1.body.message === 'This needs a fresh 2FA check.', `module switch without step-up is refused with CCSTP (${off1.status} ${off1.body.code})`);
  ok(sql(`select coalesce((select enabled::text from app.center_modules where center_id = '${JSH}' and module_key = 'store'), 'true')`) === 'true', 'the store module is still on');
  tok = await apiStepUp(tok, adminFactor, adminSecret);
  ok(claims(tok).aal === 'aal2' && (claims(tok).amr || []).some((a) => a.method === 'totp'), 'after the TOTP challenge the session is aal2 with a totp amr entry');
  const off2 = await http('/rest/v1/rpc/set_module_enabled', { method: 'POST', token: tok, body: { p_center: JSH, p_module: 'store', p_enabled: false, p_reason: 'o-security e2e: step-up check' } });
  ok(off2.status < 300, `the same switch succeeds after step-up (${off2.status})`);
  const on = await http('/rest/v1/rpc/set_module_enabled', { method: 'POST', token: tok, body: { p_center: JSH, p_module: 'store', p_enabled: true, p_reason: 'o-security e2e: back on' } });
  ok(on.status < 300 && sql(`select enabled::text from app.center_modules where center_id = '${JSH}' and module_key = 'store'`) === 'true', 'switched back on');
  ok(sql(`select count(*) from app.audit_log where id > ${auditStart} and record_table = 'center_modules' and reason like 'o-security e2e%' and actor_user_id = '${adminId}'`) === '2',
    'audit: both module switches (off, on) with their reasons — the refused one left nothing');

  // ── 2b. Portal: invite staff → step-up modal → invitation ─────────────────
  // A new portal session (email code only, aal1) so the step-up modal must appear.
  await admin.ctx.close();
  const admin2 = await portalSignIn(browser, ADMIN);
  ok(admin2.askedTotp, 'signing in with an authenticator app set up asks for its code (skipped here: JSH does not require 2FA yet)');
  const ap = admin2.p;
  await ap.goto(BASE + '/settings/team', { waitUntil: 'networkidle' });
  await shot(ap, 'team-before');
  const form = ap.locator('form').filter({ hasText: 'Create invitation' });
  await form.getByLabel('First name').fill('Nisha');
  await form.getByLabel('Last name').fill('Patel');
  await form.getByLabel('Email').fill(INVITEE);
  await form.getByLabel(/Content editor/).check();
  await form.getByLabel(/Center admin/).check();
  await form.getByRole('button', { name: 'Create invitation' }).click();
  ok(await answerStepUp(ap, adminSecret), 'inviting staff opened the step-up modal (real TOTP challenge)');
  const linkEl = ap.getByTestId('invitation-link'); await linkEl.waitFor({ timeout: 20000 });
  const link = await linkEl.inputValue();
  await shot(ap, 'team-invited');
  ok(/\/invite\/[A-Za-z0-9_-]{30,}$/.test(link), 'the invitation link is shown once: ' + link.replace(/[^/]+$/, '…'));
  const inv = sql(`select id||'|'||array_to_string(role_keys, ',')||'|'||(accepted_at is null)::text from app.staff_invitations where email = '${INVITEE}'`);
  ok(/\|content_editor,center_admin\|true$/.test(inv), 'staff_invitations row: ' + inv);
  ok(sql(`select count(*) from app.audit_log where id > ${auditStart} and action = 'staff_invitations.insert' and actor_user_id = '${adminId}' and client_app = 'portal' and client_screen = '/settings/team' and reason like 'Staff invitation:%'`) === '1',
    'audit: staff_invitations.insert from Settings › Team with its reason');

  // ── 3. The invitee accepts, signs in and sets up 2FA ──────────────────────
  const ictx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ip = await ictx.newPage();
  await ip.goto(link, { waitUntil: 'networkidle' });
  await shot(ip, 'invite-landing');
  ok((await ip.innerText('body')).includes('Join Jain Society of Houston'), 'the invite page names the community');
  const t1 = Date.now() - 2000;
  await ip.getByLabel(/Your email/).fill(INVITEE);
  await ip.getByRole('button', { name: 'Send code' }).click();
  await ip.getByLabel('Code').fill(await mailCode(INVITEE, t1));
  await ip.getByRole('button', { name: 'Verify and accept' }).click();
  await ip.waitForURL((u) => u.pathname === '/account/security', { timeout: 30000 });
  await ip.waitForLoadState('networkidle');
  await shot(ip, 'invitee-welcome');
  ok((await ip.innerText('body')).includes("team"), 'the invitee lands on Account › Security with a welcome');
  const inviteeId = sql(`select id from auth.users where email = '${INVITEE}'`);
  ok(sql(`select (accepted_by = '${inviteeId}')::text from app.staff_invitations where email = '${INVITEE}'`) === 'true', 'invitation accepted by the new login');
  const grants = sql(`select string_agg(role_key||':'||status||':'||(granted_by = '${adminId}')::text, ',' order by role_key) from app.role_grants where center_id = '${JSH}' and user_id = '${inviteeId}'`);
  ok(grants === 'center_admin:pending:true,content_editor:active:true', 'grants: content_editor active, center_admin pending (two-person rule), both granted by the inviter — ' + grants);
  ok(sql(`select p.first_name||' '||p.last_name from app.center_users cu join app.people p on p.id = cu.person_id where cu.center_id = '${JSH}' and cu.user_id = '${inviteeId}'`) === 'Nisha Patel',
    'the new login is linked to a person record named on the invitation');
  const inviteeSecret = await enrollInPortal(ip, 'invitee');
  // Phone verification (GoTrue test OTP for +1 555-555-0102 on this stack; no SMS is sent).
  await ip.getByLabel(/Your mobile number|Change or re-verify/).fill('(555) 555-0102');
  await ip.getByRole('button', { name: 'Text me a code' }).click();
  await ip.getByLabel('Code from the text message').fill('123456');
  await ip.getByRole('button', { name: 'Verify number' }).click();
  await ip.getByText('Phone verified', { exact: false }).first().waitFor({ timeout: 20000 });
  await ip.waitForLoadState('networkidle');
  await shot(ip, 'invitee-phone-verified');
  ok(sql(`select phone||'|'||(phone_confirmed_at is not null)::text from auth.users where id = '${inviteeId}'`) === '15555550102|true', 'the invitee\'s phone is verified');
  ok(sql(`select count(*) from app.audit_log where id > ${auditStart} and action = 'security.phone.verified' and actor_user_id = '${inviteeId}'`) === '1', 'audit: security.phone.verified');
  ok(!(await ip.innerText('main')).includes('This session has not passed 2FA'), 'verifying the phone did not drop the session back to aal1');
  ok(sql(`select count(*) from app.audit_log where id > ${auditStart} and action = 'security.mfa.enrolled' and actor_user_id = '${inviteeId}'`) === '1', 'audit: the invitee enrolled 2FA');
  ok(sql(`select count(*) from app.audit_log where id > ${auditStart} and action = 'staff_invitations.update' and actor_user_id = '${inviteeId}' and reason = 'Staff invitation accepted'`) === '1', 'audit: the acceptance');

  // Two-person rule: the inviter cannot approve; a second administrator (with 2FA) does.
  let t2 = await apiSignIn(SECOND);
  const en = await http('/auth/v1/factors', { method: 'POST', token: t2, body: { factor_type: 'totp', friendly_name: 'second-' + RUN } });
  const secondSecret = en.body.totp.secret;
  t2 = await apiStepUp(t2, en.body.id, secondSecret);
  const pendingId = sql(`select id from app.role_grants where user_id = '${inviteeId}' and role_key = 'center_admin' and status = 'pending'`);
  const selfTry = await http('/rest/v1/rpc/approve_role_grant', { method: 'POST', token: tok, body: { p_grant: pendingId } });
  ok(selfTry.status >= 400 && /second, different person/.test(selfTry.body.message || ''), 'the inviter cannot be the second approver: ' + (selfTry.body.message || selfTry.status));
  const appr = await http('/rest/v1/rpc/approve_role_grant', { method: 'POST', token: t2, body: { p_grant: pendingId } });
  ok(appr.status < 300 && sql(`select status from app.role_grants where id = '${pendingId}'`) === 'active', 'a second administrator (with a fresh 2FA check) approves the center_admin grant');

  // ── 4. The owner accepts the organization agreements ──────────────────────
  // Community Connect publishes the texts (a platform admin's step; done in SQL on this test stack).
  sql(`update app.legal_documents set published_at = now() where center_id is null and kind in ('org_terms','dpa','children_addendum','order_form')`);
  await ap.goto(BASE + '/settings/agreements', { waitUntil: 'networkidle' });
  await shot(ap, 'agreements-before');
  for (const kind of ['terms', 'dpa', 'children_addendum', 'order_form']) {
    const card = ap.getByTestId(`agreement-${kind}`);
    await card.locator('input[name=confirm]').check();
    await card.getByRole('button', { name: /^Accept / }).click();
    await card.locator('input[name=confirm]').waitFor({ state: 'detached', timeout: 20000 }); // the form goes once it is accepted
  }
  await shot(ap, 'agreements-after');
  const agreed = sql(`select string_agg(kind||':'||(ip is not null)::text||':'||(user_agent like 'Mozilla%')::text, ',' order by kind) from app.org_agreements where center_id = '${JSH}' and accepted_by = '${adminId}'`);
  ok(agreed === 'children_addendum:true:true,dpa:true:true,order_form:true:true,terms:true:true', 'org_agreements: four acceptances with IP and browser — ' + agreed);
  ok(sql(`select count(*) from app.audit_log where id > ${auditStart} and action = 'org_agreements.insert' and actor_user_id = '${adminId}' and client_app = 'portal' and reason like 'Accepted %'`) === '4',
    'audit: four org_agreements.insert rows from the portal');

  // ── 5. Ownership transfer (Settings › Team) ───────────────────────────────
  await ap.goto(BASE + '/settings/team', { waitUntil: 'networkidle' });
  const tf = ap.locator('form').filter({ hasText: 'Transfer ownership' });
  await tf.locator('select[name=to_user]').selectOption(inviteeId);
  await tf.locator('input[name=reason]').fill('Nisha is the new president');
  await tf.getByRole('button', { name: 'Transfer ownership' }).click();
  await ap.getByRole('dialog').filter({ hasText: 'Transfer ownership?' }).getByRole('button', { name: 'Transfer ownership' }).click();
  const asked = await answerStepUp(ap, adminSecret); // asked when the last check is more than 5 minutes old
  await ap.waitForTimeout(2500);
  await ap.waitForLoadState('networkidle');
  await shot(ap, 'team-after-transfer');
  ok(sql(`select user_id||'|'||transferred_from from app.center_owners where center_id = '${JSH}'`) === `${inviteeId}|${adminId}`,
    `ownership transferred to the new administrator${asked ? ' (after a step-up)' : ''}`);
  ok(sql(`select count(*) from app.audit_log where id > ${auditStart} and action = 'center_owners.update' and actor_user_id = '${adminId}' and reason = 'Nisha is the new president' and client_screen = '/settings/team'`) === '1',
    'audit: center_owners.update with the reason');

  // ── 6. Readiness checks ───────────────────────────────────────────────────
  const r1 = JSON.parse(sql(`select app.check_owner_admins_2fa('${JSH}')`));
  ok(r1.ok === true, 'readiness owner_admins_2fa passes: ' + r1.detail);
  const r2 = JSON.parse(sql(`select app.check_agreements_accepted('${JSH}')`));
  ok(r2.ok === true, 'readiness agreements_accepted passes: ' + r2.detail);

  // The team table shows 2FA for the new owner.
  await ap.goto(BASE + '/settings/team', { waitUntil: 'networkidle' });
  const row = ap.getByTestId('team-row').filter({ hasText: INVITEE });
  const rowText = await row.innerText();
  ok(/Owner/.test(rowText) && /On/.test(rowText), 'Settings › Team shows the new owner with 2FA on');
  await shot(ap, 'team-final');

  // ── 7. With the staff 2FA rule on, a staff session without 2FA only reaches Account › Security ──
  sql(`update app.centers set rules = jsonb_set(rules, '{security,require_2fa_for_staff}', 'true') where id = '${JSH}'`);
  const teacher = await portalSignIn(browser, 'teacher@jsh.test');
  await teacher.p.waitForLoadState('networkidle');
  ok(/\/account\/security\?required=1/.test(teacher.p.url()), 'a teacher without 2FA is sent to Account › Security: ' + teacher.p.url().replace(BASE, ''));
  await teacher.p.goto(BASE + '/pathshala/my-classes', { waitUntil: 'networkidle' });
  ok(/\/account\/security\?required=1&next=%2Fpathshala%2Fmy-classes/.test(teacher.p.url()), 'other pages redirect there too, remembering the page');
  await shot(teacher.p, 'required-2fa');
  await teacher.ctx.close();
  sql(`update app.centers set rules = jsonb_set(rules, '{security,require_2fa_for_staff}', 'false') where id = '${JSH}'`);

  // Sign-in with the authenticator code gives a 2FA session straight away.
  const admin3 = await portalSignIn(browser, ADMIN, { totpSecret: adminSecret });
  await admin3.p.goto(BASE + '/account/security', { waitUntil: 'networkidle' });
  const acct = await admin3.p.innerText('main');
  ok(admin3.askedTotp && !acct.includes('This session has not passed 2FA') && /passed/.test(acct), 'a sign-in with the authenticator code is a 2FA (aal2) session');
  await admin3.ctx.close();

  // Give ownership back so the stack stays as the other flows expect (SQL; test stack only).
  sql(`update app.center_owners set user_id = '${adminId}', transferred_from = '${inviteeId}', since = now() where center_id = '${JSH}'`);
  const pageErrors = [...admin.errs, ...admin2.errs];
  ok(pageErrors.length === 0, 'no uncaught page errors' + (pageErrors.length ? ': ' + pageErrors.join(' | ') : ''));
  await browser.close();
})().catch((e) => { console.error('FLOW FAILED:', e); process.exit(1); });
