// e-access flow (Wave E, owner decisions 2026-09-25 items 1, 2, 21, 22, 23), against a real local stack:
//   A. (2)  an owner WITHOUT any role grant does giving / accounting / privacy actions over the API
//           and in the portal (NAV, Setup › Lists fund, month-end checklist, a data request), while a
//           center admin still cannot; the two-person rule still needs a different second person.
//   B. (1)  Community Connect approves a sandbox's first second administrator in Settings › Roles;
//           the audit row names the platform admin with the reason
//           "Community Connect approval (two-person rule, first second admin)".
//   C. (21) community search never returns a sandbox; its join code still opens it.
//   D. (22) a member never receives staff-only custom-field values over the API; staff still see them.
//   E. (23) at JSH (staff 2FA rule off) a staff member with an authenticator app is asked for the fresh
//           2FA check (API: CCSTP; portal: the step-up modal), while one without is not.
//
//   bash e2e/up.sh e-access 100
//   portal built against that stack and started on :3200 (NEXT_PUBLIC_SUPABASE_URL=http://localhost:55421)
//   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright node e2e/flows/e-access.cjs
//
// Test data only (logins *.e-access@jsh.test, one sandbox per run); it restores JSH's owner at the end.
'use strict';
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3200';
const MAIL = process.env.MAIL || 'http://localhost:55424';
const API = process.env.API || 'http://localhost:55421';
const DB = process.env.DB || 'postgres://postgres:postgres@localhost:55532/postgres';
const OUT = process.env.OUT || '/tmp/claude-0/streams/e-access';
const ENVF = process.env.ENVF || path.join(__dirname, '..', '.env.e-access');
fs.mkdirSync(OUT, { recursive: true });
const env = Object.fromEntries(fs.readFileSync(ENVF, 'utf8').trim().split('\n').map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
const JSH = '00000000-0000-4000-8000-000000000001';
const RUN = Date.now().toString(36);
const OWNER = 'owner.e-access@jsh.test';
const CA = 'admin.e-access@jsh.test';          // center admin only, with an authenticator app
const CA2 = 'admin2.e-access@jsh.test';        // center admin only, no authenticator app
const TREAS = 'treasurer.e-access@jsh.test';
const CC = 'cc.e-access@jsh.test';             // a Community Connect platform admin
const SOWNER = 'sowner.e-access@jsh.test';     // the sandbox's owner
const SECOND = `second.${RUN}.e-access@jsh.test`;
const MEMBER = 'priya@jsh.test';
const CC_REASON = 'Community Connect approval (two-person rule, first second admin)';

const sql = (q) => execSync(`psql "${DB}" -Atc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };

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
async function http(pathname, { method = 'GET', token, body, service = false, anon = false, headers = {} } = {}) {
  const key = service ? env.SERVICE_KEY : env.ANON_KEY;
  const r = await fetch(API + pathname, {
    method,
    headers: { apikey: key, authorization: `Bearer ${anon ? key : token || key}`, 'content-type': 'application/json', 'content-profile': 'app', 'accept-profile': 'app', 'x-client-app': 'portal', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; }
  return { status: r.status, body: b };
}
async function ensureUser(email) {
  await http('/auth/v1/admin/users', { method: 'POST', service: true, body: { email, email_confirm: true } });
  const id = sql(`select id from auth.users where email = '${email}'`);
  sql(`insert into app.accounts (user_id) values ('${id}') on conflict do nothing`);
  return id;
}
async function apiSignIn(email) {
  const gl = await http('/auth/v1/admin/generate_link', { method: 'POST', service: true, body: { type: 'magiclink', email } });
  const v = await http('/auth/v1/verify', { method: 'POST', body: { type: 'email', email, token: gl.body.email_otp ?? gl.body.properties?.email_otp } });
  if (!v.body.access_token) throw new Error('API sign-in failed for ' + email + ': ' + JSON.stringify(v.body));
  return v.body.access_token;
}
/** Adds a verified authenticator app over the Auth API; returns { factorId, secret }. */
async function enrollTotp(email) {
  const tok = await apiSignIn(email);
  const en = await http('/auth/v1/factors', { method: 'POST', token: tok, body: { factor_type: 'totp', friendly_name: `e-access ${RUN}` } });
  if (!en.body.id) throw new Error('enroll failed: ' + JSON.stringify(en.body));
  const secret = en.body.totp.secret;
  const ch = await http(`/auth/v1/factors/${en.body.id}/challenge`, { method: 'POST', token: tok, body: {} });
  const vf = await http(`/auth/v1/factors/${en.body.id}/verify`, { method: 'POST', token: tok, body: { challenge_id: ch.body.id, code: await totp(secret) } });
  if (!vf.body.access_token) throw new Error('enroll verify failed: ' + JSON.stringify(vf.body));
  return { factorId: en.body.id, secret };
}
async function apiStepUp(token, factorId, secret) {
  const ch = await http(`/auth/v1/factors/${factorId}/challenge`, { method: 'POST', token, body: {} });
  const vf = await http(`/auth/v1/factors/${factorId}/verify`, { method: 'POST', token, body: { challenge_id: ch.body.id, code: await totp(secret) } });
  if (!vf.body.access_token) throw new Error('step-up failed: ' + JSON.stringify(vf.body));
  return vf.body.access_token;
}

/** Email-code sign-in; with an authenticator app, `totpSecret` answers the 2FA step, else "Not now" (JSH does not require it). */
async function portalSignIn(browser, email, name, { totpSecret, slug } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: 'cc_platform_setup_later', value: '1', url: BASE, httpOnly: true }]);
  if (slug) await ctx.addCookies([{ name: 'cc_center', value: slug, url: BASE }]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.error(`[${name} page error]`, String(e)));
  await p.goto(BASE + '/login'); let t0 = Date.now() - 2000;
  await p.fill('input[name=email]', email); await p.click('button[type=submit]');
  // The sign-in service allows one code per address a minute; an API sign-in just before counts.
  for (let i = 0; i < 3; i++) {
    const got = await Promise.race([
      p.waitForSelector('input[name=code]', { timeout: 30000 }).then(() => 'code'),
      p.getByRole('alert').filter({ hasText: /wait|seconds|too many|rate/i }).first().waitFor({ timeout: 30000 }).then(() => 'wait'),
    ]);
    if (got === 'code') break;
    await new Promise((r) => setTimeout(r, 61000));
    t0 = Date.now() - 2000;
    await p.click('button[type=submit]');
  }
  await p.fill('input[name=code]', await mailCode(email, t0));
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
  await p.waitForLoadState('networkidle');
  return { ctx, p };
}
async function confirmModal(p, label) {
  const dlg = p.locator('[role=dialog][aria-modal=true]').last();
  await dlg.waitFor();
  await dlg.getByRole('button', { name: label }).click();
}
const noAccess = async (p) => (await p.getByText("You don't have access to this area").count()) > 0;
const navText = async (p) => (await p.locator('nav').first().innerText().catch(() => ''));

(async () => {
  // ── Fixtures (test stack only) ─────────────────────────────────────────────
  const ownerId = await ensureUser(OWNER);
  const caId = await ensureUser(CA);
  const ca2Id = await ensureUser(CA2);
  const treasId = await ensureUser(TREAS);
  const ccId = await ensureUser(CC);
  const sownerId = await ensureUser(SOWNER);
  const secondId = await ensureUser(SECOND);
  sql(`update app.accounts set is_platform_admin = true where user_id = '${ccId}'`);
  const prevOwner = sql(`select user_id from app.center_owners where center_id = '${JSH}'`);
  // JSH's owner for this run holds NO role grant at all.
  sql(`delete from app.role_grants where user_id in ('${ownerId}','${caId}','${ca2Id}','${treasId}')`);
  sql(`insert into app.center_owners (center_id, user_id) values ('${JSH}', '${ownerId}') on conflict (center_id) do update set user_id = excluded.user_id, since = now()`);
  sql(`insert into app.role_grants (center_id, user_id, role_key, reason) values ('${JSH}', '${caId}', 'center_admin', 'e-access e2e'), ('${JSH}', '${ca2Id}', 'center_admin', 'e-access e2e'), ('${JSH}', '${treasId}', 'treasurer', 'e-access e2e')`);
  sql(`delete from auth.mfa_factors where user_id in ('${ownerId}','${caId}','${ca2Id}')`);
  ok(sql(`select app.require_2fa_for_staff('${JSH}')`) === 'f', 'JSH has not switched on staff 2FA (the rule is off)');
  const priyaPerson = sql(`select id from app.people where member_number = 'JSH-90001'`);
  const reqId = sql(`insert into app.data_requests (center_id, person_id, kind) values ('${JSH}', '${priyaPerson}', 'export') returning id`).split('\n')[0];
  const auditStart = Number(sql('select coalesce(max(id), 0) from app.audit_log'));
  const browser = await chromium.launch();

  // ══ A. (2) The owner can do every task; a center admin still cannot ═══════
  const ownerTok = await apiSignIn(OWNER);
  const caTok = await apiSignIn(CA);
  const fundKey = `owner_${RUN}`;
  let r = await http('/rest/v1/funds', { method: 'POST', token: ownerTok, body: { center_id: JSH, key: fundKey, name: `Owner fund ${RUN}` }, headers: { prefer: 'return=minimal' } });
  ok(r.status === 201, `A · API: the owner (no role grant) adds a fund — giving.manage (${r.status})`);
  r = await http('/rest/v1/funds', { method: 'POST', token: caTok, body: { center_id: JSH, key: `admin_${RUN}`, name: 'Admin fund' }, headers: { prefer: 'return=minimal' } });
  ok(r.status === 403, `A · API: the center admin cannot (${r.status} ${r.body?.code ?? ''})`);
  r = await http('/rest/v1/bank_accounts', { method: 'POST', token: ownerTok, body: { center_id: JSH, name: `Owner operating ··${RUN.slice(-4)}` }, headers: { prefer: 'return=minimal' } });
  ok(r.status === 201, `A · API: the owner adds a bank account — accounting.manage (${r.status})`);
  r = await http('/rest/v1/bank_accounts', { method: 'POST', token: caTok, body: { center_id: JSH, name: 'Admin ··0000' }, headers: { prefer: 'return=minimal' } });
  ok(r.status === 403, `A · API: the center admin cannot (${r.status})`);
  r = await http(`/rest/v1/data_requests?id=eq.${reqId}`, { method: 'PATCH', token: caTok, body: { status: 'rejected' }, headers: { prefer: 'return=representation' } });
  ok(r.status === 200 && Array.isArray(r.body) && r.body.length === 0, 'A · API: the center admin cannot touch a data request (privacy.manage) — nothing changed');
  r = await http('/rest/v1/rpc/has_permission', { method: 'POST', token: ownerTok, body: { p_center: JSH, p_perm: 'privacy.manage' } });
  ok(r.body === true, 'A · API: app.has_permission says the owner holds privacy.manage');
  // Two-person rule: the owner asked for this write-off, so the owner cannot also approve it.
  const hh = sql(`select household_id from app.household_members where person_id = '${priyaPerson}' and left_at is null limit 1`);
  const pledgeId = sql(`insert into app.pledges (center_id, household_id, amount_cents) values ('${JSH}', '${hh}', 1234) returning id`).split('\n')[0];
  sql(`update app.pledges set written_off_by = '${ownerId}', write_off_reason = 'e-access e2e' where id = '${pledgeId}'`);
  r = await http('/rest/v1/rpc/approve_as_second', { method: 'POST', token: ownerTok, body: { p_table: 'pledges', p_id: pledgeId } });
  ok(r.status >= 400 && /different person/.test(r.body?.message || ''), `A · two-person rule: the owner cannot second-approve their own write-off (${r.body?.message})`);
  r = await http('/rest/v1/rpc/approve_as_second', { method: 'POST', token: await apiSignIn(TREAS), body: { p_table: 'pledges', p_id: pledgeId } });
  ok(r.status < 300 && sql(`select written_off_second_approver from app.pledges where id = '${pledgeId}'`) === treasId, 'A · …a different person (the treasurer) can');

  // Portal: the owner's NAV and actions.
  const own = await portalSignIn(browser, OWNER, 'owner');
  const op = own.p;
  const ownerNav = await navText(op);
  ok(/Giving/.test(ownerNav) && /Accounting/.test(ownerNav) && /Settings/.test(ownerNav), 'A · portal: the owner sees Giving, Accounting and Settings in the NAV');
  ok(/all permissions \(owner\)/.test(await op.locator('body').innerText()), 'A · portal: the sidebar says "all permissions (owner)"');
  await shot(op, 'A-owner-home');
  await op.goto(BASE + '/setup/lists', { waitUntil: 'networkidle' });
  const fundName = `Seva fund ${RUN}`;
  await op.getByRole('button', { name: 'Add fund' }).click();
  await op.getByLabel('Name', { exact: true }).last().fill(fundName);
  await op.locator('form').filter({ hasText: 'Restricted' }).last().getByRole('button', { name: 'Add fund' }).click();
  ok(await until(() => sql(`select count(*) from app.funds where center_id = '${JSH}' and name = '${fundName}'`) === '1'), 'A · portal: the owner adds a fund in Setup › Lists (giving)');
  await shot(op, 'A-owner-fund');
  await op.goto(BASE + '/accounting/close', { waitUntil: 'networkidle' });
  const month = sql(`select to_char(date_trunc('month', now() at time zone 'America/Chicago'), 'YYYY-MM-DD')`);
  const doneBefore = sql(`select coalesce((select count(*) from jsonb_each(checklist) c where c.value::text = 'true') , 0) from app.accounting_periods where center_id = '${JSH}' and period_month = '${month}'`) || '0';
  await op.getByRole('button', { name: 'Mark done' }).first().click();
  ok(await until(() => Number(sql(`select coalesce((select count(*) from jsonb_each(checklist) c where c.value::text = 'true'), 0) from app.accounting_periods where center_id = '${JSH}' and period_month = '${month}'`) || '0') > Number(doneBefore)),
    'A · portal: the owner ticks a month-end close item (accounting.close)');
  await shot(op, 'A-owner-close');
  await op.goto(BASE + '/settings/privacy', { waitUntil: 'networkidle' });
  ok(!(await noAccess(op)), 'A · portal: the owner opens Settings › Privacy');
  const reqRow = op.locator('tr').filter({ has: op.locator(`td[title="${reqId}"]`) });
  await reqRow.getByRole('button', { name: 'Start' }).click();
  ok(await until(() => sql(`select status from app.data_requests where id = '${reqId}'`) === 'in_progress'), 'A · portal: the owner starts work on a data request (privacy)');
  await shot(op, 'A-owner-privacy');
  await own.ctx.close();
  ok(Number(sql(`select count(*) from app.audit_log where id > ${auditStart} and actor_user_id = '${ownerId}' and record_table in ('funds','accounting_periods','data_requests','bank_accounts')`)) >= 4,
    'A · audit: the owner\'s changes are recorded as the owner');

  // Portal: the center admin (no giving / accounting / privacy).
  const caSecret = await enrollTotp(CA);   // also used in E
  const adm = await portalSignIn(browser, CA2, 'admin');
  const ap = adm.p;
  await ap.goto(BASE + '/settings/privacy', { waitUntil: 'networkidle' });
  ok(await noAccess(ap), 'A · portal: the center admin gets "You don\'t have access to this area" on Settings › Privacy');
  await ap.goto(BASE + '/setup/lists', { waitUntil: 'networkidle' });
  ok((await ap.getByRole('button', { name: 'Add fund' }).count()) === 0 && (await ap.getByText('Funds are added by the treasurer (giving.manage).').count()) === 1,
    'A · portal: the center admin has no "Add fund" (giving.manage)');
  await ap.goto(BASE + '/accounting/close', { waitUntil: 'networkidle' });
  ok((await ap.getByRole('button', { name: 'Mark done' }).count()) === 0, 'A · portal: the center admin cannot tick month-end items (accounting.close)');
  await shot(ap, 'A-admin-close');
  await adm.ctx.close();

  // ══ B. (1) Community Connect approves the first second administrator ═══════
  const sbx = sql(`insert into app.centers (slug, name, short_name, state_region, status, environment) values ('eacc-${RUN}', 'Access Test Sangh ${RUN}', 'ATS', 'TX', 'onboarding', 'sandbox') returning id`).split('\n')[0];
  sql(`insert into app.center_owners (center_id, user_id) values ('${sbx}', '${sownerId}') on conflict (center_id) do update set user_id = excluded.user_id`);
  sql(`insert into app.role_grants (center_id, user_id, role_key, reason) values ('${sbx}', '${sownerId}', 'center_admin', 'sandbox owner')`);
  // The owner invited a second administrator; the grant waits for a second approver (two-person rule).
  const g2 = sql(`insert into app.role_grants (center_id, user_id, role_key, reason, granted_by, status, starts_at) values ('${sbx}', '${secondId}', 'center_admin', 'second administrator', '${sownerId}', 'pending', 'infinity') returning id`).split('\n')[0];
  const cc = await portalSignIn(browser, CC, 'cc', { slug: `eacc-${RUN}` });
  const cp = cc.p;
  await cp.goto(BASE + '/settings/roles?show=pending', { waitUntil: 'networkidle' });
  const row = cp.locator('tr').filter({ hasText: 'Center admin' }).filter({ has: cp.getByTestId('cc-first-admin-note') });
  ok((await row.count()) === 1, 'B · portal: Community Connect sees the first second administrator waiting, marked for its approval');
  await shot(cp, 'B-cc-pending');
  const bStart = Number(sql('select coalesce(max(id), 0) from app.audit_log'));
  await row.getByRole('button', { name: 'Approve as Community Connect' }).click();
  await confirmModal(cp, 'Approve as Community Connect');
  ok(await until(() => sql(`select status || '|' || second_approver from app.role_grants where id = '${g2}'`) === `active|${ccId}`),
    'B · the grant is active with the platform admin as the second approver');
  ok(sql(`select count(*) from app.audit_log where id > ${bStart} and record_table = 'role_grants' and record_id = '${g2}' and actor_user_id = '${ccId}' and reason = '${CC_REASON}' and client_app = 'portal'`) === '1',
    `B · audit: the approval names the platform admin with "${CC_REASON}"`);
  await shot(cp, 'B-cc-approved');
  await cc.ctx.close();

  // ══ C. (21) Sandboxes never appear in community search ═════════════════════
  const code = sql(`select code from app.member_join_codes where center_id = '${sbx}' and active limit 1`);
  r = await http('/rest/v1/rpc/find_community', { method: 'POST', anon: true, body: { p_query: 'Access Test Sangh' } });
  ok(r.status === 200 && Array.isArray(r.body) && r.body.length === 0, 'C · searching the sandbox\'s name finds nothing (anonymous, as the member app)');
  r = await http('/rest/v1/rpc/find_community', { method: 'POST', anon: true, body: { p_query: `eacc-${RUN}` } });
  ok(Array.isArray(r.body) && r.body.length === 0, 'C · …nor its slug');
  r = await http('/rest/v1/rpc/find_community', { method: 'POST', anon: true, body: { p_query: 'Jain Society' } });
  ok(Array.isArray(r.body) && r.body.some((c) => c.slug === 'jsh') && r.body.every((c) => c.environment === 'production'), 'C · live communities are still found, all production');
  sql(`update app.centers set status = 'active' where id = '${sbx}'`);
  r = await http('/rest/v1/rpc/find_community', { method: 'POST', anon: true, body: { p_query: 'Access Test Sangh' } });
  ok(Array.isArray(r.body) && r.body.length === 0, 'C · an active sandbox is still never listed');
  r = await http('/rest/v1/rpc/community_by_join_code', { method: 'POST', anon: true, body: { p_code: code } });
  ok(Array.isArray(r.body) && r.body[0]?.slug === `eacc-${RUN}` && r.body[0]?.environment === 'sandbox', `C · the join code ${code} still opens the sandbox`);

  // ══ D. (22) Members never receive staff-only custom-field values ═══════════
  sql(`insert into app.custom_field_definitions (center_id, entity, key, label, type, sensitivity) values
         ('${JSH}', 'people', 'e_pastoral', 'Pastoral note (e-access)', 'text', 'staff'),
         ('${JSH}', 'people', 'e_tshirt', 'T-shirt (e-access)', 'text', 'member_self'),
         ('${JSH}', 'households', 'e_legacy', 'Legacy account (e-access)', 'text', 'staff')
       on conflict (center_id, entity, key) do nothing`);
  const staffNote = `Visit after surgery ${RUN}`;
  // Staff write the values the normal way (a center admin, through RLS).
  r = await http(`/rest/v1/people?id=eq.${priyaPerson}`, { method: 'PATCH', token: await apiSignIn(CA2), body: { custom: { e_pastoral: staffNote, e_tshirt: 'M' } }, headers: { prefer: 'return=minimal' } });
  ok(r.status === 204, `D · a center admin saves a staff-only and a member value on Priya (${r.status})`);
  sql(`update app.households set custom = custom || '{"e_legacy":"NEON-${RUN}"}' where id = '${hh}'`);
  const priyaTok = await apiSignIn(MEMBER);
  r = await http(`/rest/v1/people?id=eq.${priyaPerson}&select=*`, { token: priyaTok });
  ok(r.status === 200 && r.body[0]?.custom?.e_tshirt === 'M' && !JSON.stringify(r.body).includes(staffNote) && !('e_pastoral' in (r.body[0]?.custom || {})),
    'D · API: Priya reading her own person (select=*) gets her member value, never the staff-only one');
  r = await http(`/rest/v1/households?id=eq.${hh}&select=*`, { token: priyaTok });
  ok(r.status === 200 && r.body.length === 1 && !JSON.stringify(r.body).includes(`NEON-${RUN}`), 'D · API: …nor her household\'s staff-only value');
  r = await http('/rest/v1/custom_staff_values?select=*', { token: priyaTok });
  ok(r.status === 200 && Array.isArray(r.body) && r.body.length === 0, 'D · API: the staff-only store returns nothing to a member');
  r = await http('/rest/v1/rpc/custom_values', { method: 'POST', token: priyaTok, body: { p_entity: 'people', p_ids: [priyaPerson] } });
  ok(r.status === 200 && !JSON.stringify(r.body).includes(staffNote), 'D · API: app.custom_values gives Priya no staff-only value');
  r = await http('/rest/v1/rpc/person_custom_fields', { method: 'POST', token: priyaTok, body: { p_center: JSH, p_person: priyaPerson } });
  ok(r.status === 200 && r.body.some((f) => f.key === 'e_tshirt') && !r.body.some((f) => f.key === 'e_pastoral'), 'D · API: the member app\'s list (person_custom_fields) has her member field only');
  r = await http(`/rest/v1/people?select=custom&custom->>e_pastoral=not.is.null`, { token: priyaTok });
  ok(r.status === 200 && r.body.length === 0, 'D · API: filtering people by the staff-only key finds nothing for a member');
  r = await http('/rest/v1/rpc/custom_values', { method: 'POST', token: caTok, body: { p_entity: 'people', p_ids: [priyaPerson] } });
  ok(r.status === 200 && r.body[0]?.custom?.e_pastoral === staffNote, 'D · API: staff (people.view) still read the staff-only value');
  ok(sql(`select count(*) from app.audit_log where id > ${auditStart} and record_table = 'custom_staff_values' and actor_user_id = '${ca2Id}'`) === '1', 'D · audit: the staff-only value\'s write is recorded, by the admin');
  const adm2 = await portalSignIn(browser, CA2, 'admin-d');
  await adm2.p.goto(BASE + `/people/${priyaPerson}`, { waitUntil: 'networkidle' });
  ok((await adm2.p.getByText(staffNote).count()) >= 1, 'D · portal: staff see the staff-only value in the person\'s "More details"');
  await shot(adm2.p, 'D-staff-more-details');
  await adm2.ctx.close();

  // ══ E. (23) At JSH, staff with an authenticator app pass the fresh 2FA check ═
  let tok = await apiSignIn(CA);
  r = await http('/rest/v1/rpc/set_module_enabled', { method: 'POST', token: tok, body: { p_center: JSH, p_module: 'bolis', p_enabled: false, p_reason: 'e-access e2e: step-up' } });
  ok(r.status >= 400 && r.body.code === 'CCSTP', `E · API: a JSH admin WITH an authenticator app is asked for the fresh 2FA check (${r.body.code})`);
  tok = await apiStepUp(tok, sql(`select id from auth.mfa_factors where user_id = '${caId}' and status = 'verified' limit 1`), caSecret.secret);
  r = await http('/rest/v1/rpc/set_module_enabled', { method: 'POST', token: tok, body: { p_center: JSH, p_module: 'bolis', p_enabled: true, p_reason: 'e-access e2e: step-up passed' } });
  ok(r.status < 300, `E · API: …and passes after entering a code (${r.status})`);
  r = await http('/rest/v1/rpc/set_module_enabled', { method: 'POST', token: await apiSignIn(CA2), body: { p_center: JSH, p_module: 'bolis', p_enabled: true, p_reason: 'e-access e2e: no app' } });
  ok(r.status < 300, `E · API: a JSH admin WITHOUT one is not asked (${r.status}${r.body?.code ? ' ' + r.body.code : ''})`);
  // Portal: the admin with an app gets the step-up modal on a module switch; the one without does not.
  const e1 = await portalSignIn(browser, CA, 'admin-totp');   // "Not now" at sign-in: JSH does not require 2FA
  await e1.p.goto(BASE + '/account/security', { waitUntil: 'networkidle' });
  ok((await e1.p.getByTestId('step-up-with-app-note').count()) === 1,
    'E · portal: Account › Security explains the check for staff with an app');
  await e1.p.goto(BASE + '/settings/modules', { waitUntil: 'networkidle' });
  await e1.p.getByRole('switch', { name: /Bolis module/ }).click();
  await e1.p.getByRole('dialog').getByRole('textbox').fill('e-access e2e: portal step-up');
  await confirmModal(e1.p, 'Switch off');
  const dialog = e1.p.getByRole('dialog').filter({ hasText: "Confirm it's you" });
  let asked = true;
  try { await dialog.waitFor({ timeout: 10000 }); } catch { asked = false; }
  ok(asked, 'E · portal: the admin with an authenticator app gets "Confirm it\'s you"');
  await shot(e1.p, 'E-step-up-modal');
  if (asked) {
    await dialog.getByLabel('Code from your authenticator app').fill(await totp(caSecret.secret));
    await dialog.getByRole('button', { name: 'Verify and continue' }).click();
  }
  ok(await until(() => sql(`select coalesce((select enabled::text from app.center_modules where center_id = '${JSH}' and module_key = 'bolis'), 'true')`) === 'false'),
    'E · portal: after the code the switch goes through');
  await e1.ctx.close();
  const e2 = await portalSignIn(browser, CA2, 'admin-plain');
  await e2.p.goto(BASE + '/settings/modules', { waitUntil: 'networkidle' });
  await e2.p.getByRole('switch', { name: /Bolis module/ }).click();
  await e2.p.getByRole('dialog').getByRole('textbox').fill('e-access e2e: back on, no app');
  await confirmModal(e2.p, 'Switch on');
  ok(await until(() => sql(`select enabled::text from app.center_modules where center_id = '${JSH}' and module_key = 'bolis'`) === 'true'),
    'E · portal: the admin without an app switches it back with no 2FA question');
  ok((await e2.p.getByRole('dialog').filter({ hasText: "Confirm it's you" }).count()) === 0, 'E · portal: …and was never shown the step-up modal');
  await shot(e2.p, 'E-no-app-no-modal');
  await e2.ctx.close();

  await browser.close();
  // Leave JSH as it was: its owner and the test fund / field definitions stay test data on this stack only.
  if (prevOwner) sql(`update app.center_owners set user_id = '${prevOwner}' where center_id = '${JSH}'`);
  console.log(process.exitCode ? 'e-access: FAILED' : 'e-access: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
