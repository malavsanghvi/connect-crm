// f-sandbox flow (Wave F, owner decisions 2026-09-25, second batch), against a real local stack:
//   A. JSH is a sandbox (migration 0503, applied by migrate.sh as in production): nothing deleted,
//      re-running changes nothing; the watermark in the portal; messages only to verified test
//      recipients; no inactivity expiry (another quiet sandbox is warned, JSH never); the member
//      app's default community and the join code still open it; Setup says so plainly, and
//      Demo data says Reset/Clear remove JSH's own records too.
//   B. A Community Connect platform admin creates a sandbox in Platform › Centers › New sandbox
//      (fresh 2FA, reason); the pipeline lists it; audited.
//   C. The invited owner opens the link, signs in, accepts, sets up 2FA and lands in its Setup.
//   D. The owner passes an Executive Committee check (records the EC approval of a life
//      membership) but cannot reset another administrator's 2FA (portal and API).
//
//   bash e2e/up.sh f-sandbox 100
//   (connect-crm) NEXT_PUBLIC_SUPABASE_URL=http://localhost:55421 NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY pnpm build && … pnpm start -p 3200
//   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright node e2e/flows/f-sandbox.cjs
//
// Test data only (logins *.f-sandbox@jsh.test and a fresh sandbox per run), so it can be re-run.
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
const OUT = process.env.OUT || '/tmp/claude-0/streams/f-sandbox';
const ENVF = process.env.ENVF || path.join(__dirname, '..', '.env.f-sandbox');
const MIGRATION = path.join(__dirname, '..', '..', 'supabase', 'migrations', '0503_jsh_sandbox.sql');
fs.mkdirSync(OUT, { recursive: true });
const env = Object.fromEntries(fs.readFileSync(ENVF, 'utf8').trim().split('\n').map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
const JSH = '00000000-0000-4000-8000-000000000001';
const RUN = Date.now().toString(36);
const CC = 'cc.f-sandbox@jsh.test';
const JADMIN = 'admin@jsh.test';
const OWNER = `owner.${RUN}.f-sandbox@jsh.test`;
const ADMIN2 = `admin2.${RUN}.f-sandbox@jsh.test`;
const SLUG = `fsb${RUN}`;
const ORG = `Jain Center of Testville ${RUN}`;
const REASON = `Signed up at the convention (${RUN})`;

const sql = (q) => execSync(`psql "${DB}" -Atc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const sqlErr = (q) => {
  try { execSync(`psql "${DB}" -Atc "${q.replace(/"/g, '\\"')}"`, { stdio: 'pipe' }); return ''; } catch (e) { return String(e.stderr || e.message); }
};
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };
// Section A deliberately re-applies the real production→sandbox switch (0503) to JSH itself — the
// one durable, shared side effect any of this flow's checks needs. Every other flow on a shared
// stack assumes JSH is a normal production organization (the baseline fixture, per the flows'
// "tolerate each other's leftovers" convention), so restore it on the way out — pass, fail or crash.
process.on('exit', () => { try { sql(`update app.centers set environment = 'production' where id = '${JSH}' and environment = 'sandbox' and sandbox_for is null`); } catch {} });
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
async function enrollTotp(email) {
  const tok = await apiSignIn(email);
  const en = await http('/auth/v1/factors', { method: 'POST', token: tok, body: { factor_type: 'totp', friendly_name: `f-sandbox ${RUN}` } });
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
/** If the step-up modal opens, answer it with a fresh code. */
async function answerStepUp(p, secret, ms = 8000) {
  const dialog = p.getByRole('dialog').filter({ hasText: 'Confirm it' });
  try { await dialog.waitFor({ timeout: ms }); } catch { return false; }
  await dialog.getByLabel('Code from your authenticator app').fill(await totp(secret));
  await dialog.getByRole('button', { name: 'Verify and continue' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 20000 });
  return true;
}

(async () => {
  const ccId = await ensureUser(CC);
  sql(`update app.accounts set is_platform_admin = true where user_id = '${ccId}'`);
  sql(`delete from auth.mfa_factors where user_id = '${ccId}'`);
  const cc = await enrollTotp(CC);
  const auditStart = Number(sql('select coalesce(max(id), 0) from app.audit_log'));
  const browser = await chromium.launch();

  // ══ A. JSH is a sandbox ═══════════════════════════════════════════════════
  ok(sql(`select environment || '|' || status || '|' || slug from app.centers where id = '${JSH}'`) === 'sandbox|active|jsh',
    'A · JSH is a sandbox (migration 0503), still active, same web name');
  ok(sql(`select string_agg(key || '=' || value::text, ',' order by key) from app.center_entitlements where center_id = '${JSH}'`)
       === 'expiry_days_inactive=null,max_households=null,max_people=null,promotion.in_place=true,storage.bytes=null',
    'A · overrides: no expiry, JSH\'s own records keep fitting, going live keeps JSH');
  const counts = () => sql(`select (select count(*) from app.people where center_id = '${JSH}') || '|' || (select count(*) from app.households where center_id = '${JSH}')
                              || '|' || (select count(*) from app.payments where center_id = '${JSH}') || '|' || (select count(*) from app.member_join_codes where center_id = '${JSH}')
                              || '|' || (select count(*) from app.center_entitlements where center_id = '${JSH}')`);
  const before = counts();
  execSync(`psql "${DB}" -q -v ON_ERROR_STOP=1 -f "${MIGRATION}"`);
  ok(counts() === before && Number(before.split('|')[0]) > 0, `A · re-running the switch changes nothing and deletes nothing (people|households|payments|codes|overrides = ${before})`);
  ok(sql(`select count(*) from app.audit_log where record_table = 'centers' and record_id = '${JSH}' and reason like 'Owner decision 2026-09-25%'`) === '1',
    'A · the switch is in the audit log with its reason');

  // Member app: the default community (EXPO_PUBLIC_CENTER_SLUG=jsh) and the join code still open it.
  let r = await http('/rest/v1/centers?slug=eq.jsh&select=slug,name,environment', { anon: true });
  ok(r.status === 200 && r.body[0]?.environment === 'sandbox', 'A · the member app (signed out) still opens JSH by its web name');
  const code = sql(`select code from app.member_join_codes where center_id = '${JSH}' and active and (expires_at is null or expires_at > now()) limit 1`);
  r = await http('/rest/v1/rpc/community_by_join_code', { method: 'POST', anon: true, body: { p_code: code } });
  ok(Array.isArray(r.body) && r.body[0]?.slug === 'jsh', `A · JSH's join code ${code} opens it`);
  r = await http('/rest/v1/rpc/find_community', { method: 'POST', anon: true, body: { p_query: 'Jain Society' } });
  ok(Array.isArray(r.body) && !r.body.some((c) => c.slug === 'jsh'), 'A · JSH is out of community search (sandboxes are, decision #21)');

  // Messaging: verified test recipients only.
  const refusal = sqlErr(`select app.enqueue_message('${JSH}', 'email', 'priya@jsh.test', 'test_message', '{}'::jsonb, 'notification')`);
  ok(/verified test recipients/.test(refusal), 'A · a message to a member is refused: "Sandboxes can send only to verified test recipients."');

  // Expiry: another quiet sandbox is warned; JSH never, however long it is quiet.
  sql(`update app.centers set created_at = now() - interval '400 days' where id = '${JSH}'`);
  sql(`insert into app.centers (slug, name, status, environment, created_at) values ('quiet-${RUN}-sandbox', 'Quiet ${RUN}', 'onboarding', 'sandbox', now() - interval '85 days')`);
  sql('grant connect_worker to postgres');
  const expiry = execSync(`psql "${DB}" -Atc "set role connect_worker; select app.worker_sandbox_expiry()"`).toString().trim().split('\n').pop();
  const ex = JSON.parse(expiry);
  ok(ex.details.some((d) => d.center === `quiet-${RUN}-sandbox`) && !ex.details.some((d) => d.center === 'jsh')
     && sql(`select count(*) from app.sandbox_expiry_notices where center_id = '${JSH}'`) === '0',
    'A · the expiry job warns a quiet sandbox but never JSH');

  // Portal: the watermark, the limits, Setup.
  const ja = await portalSignIn(browser, JADMIN, 'jsh-admin');
  let p = ja.p;
  ok((await p.getByTestId('sandbox-watermark').count()) >= 1, 'A · portal: JSH shows the "Sandbox · test data" watermark');
  await shot(p, 'A-jsh-watermark');
  await p.goto(BASE + '/settings/limits', { waitUntil: 'networkidle' });
  const limits = await p.locator('body').innerText();
  ok(/Verified test recipients only/.test(limits) && /Never expires/.test(limits) && /Provider test mode only/.test(limits),
    'A · portal: Settings › Limits says test recipients only, provider test mode, never expires');
  await shot(p, 'A-jsh-limits');
  await p.goto(BASE + '/setup/go-live', { waitUntil: 'networkidle' });
  ok((await p.getByTestId('sandbox-never-expires').count()) === 1 && (await p.getByText('This sandbox has been inactive').count()) === 0,
    'A · portal: Setup › Go-live says JSH is exempt from expiry, with no inactivity warning');
  ok(/Go live in place/.test(await p.locator('body').innerText()), 'A · portal: going live later keeps JSH itself ("Go live in place")');
  await shot(p, 'A-jsh-golive');
  await p.goto(BASE + '/setup/demo', { waitUntil: 'networkidle' });
  const scope = p.getByTestId('demo-clear-scope');
  ok((await scope.count()) === 1 && /own records are not demo data/.test(await scope.innerText()) && /not only the demo data/.test(await scope.innerText()),
    'A · portal: Demo data says plainly that Reset and Clear remove JSH\'s own records too');
  ok((await p.getByTestId('demo-reset').count()) === 1 && /Type/.test(await p.getByTestId('demo-reset').innerText()), 'A · portal: Reset still asks for the typed name');
  await shot(p, 'A-jsh-demo');
  await ja.ctx.close();

  // ══ B. Community Connect creates a sandbox ═════════════════════════════════
  const ccs = await portalSignIn(browser, CC, 'cc', { totpSecret: cc.secret });
  p = ccs.p;
  await p.goto(BASE + '/platform', { waitUntil: 'networkidle' });
  await p.getByRole('link', { name: 'New sandbox' }).click();
  await p.waitForURL((u) => u.pathname === '/platform/new-sandbox');
  await p.getByLabel('Organization name').fill(ORG);
  await p.getByLabel('Web name').fill(SLUG);
  ok(/Created as .*-sandbox/.test(await p.getByTestId('sandbox-slug-preview').innerText()), 'B · the form shows the <slug>-sandbox web name');
  await p.getByLabel('Kind of organization').selectOption('community_center');
  await p.getByLabel('City').fill('Testville');
  await p.getByLabel('State').fill('TX');
  await p.getByLabel("Owner's first name").fill('Asha');
  await p.getByLabel("Owner's last name").fill('Mehta');
  await p.getByLabel("Owner's email").fill(OWNER);
  await p.getByLabel('Reason').fill(REASON);
  await shot(p, 'B-new-sandbox-form');
  await p.getByRole('button', { name: 'Create sandbox' }).click();
  const askedStepUp = await answerStepUp(p, cc.secret, 6000);
  await p.getByTestId('sandbox-created').waitFor({ timeout: 30000 });
  const link = await p.getByTestId('owner-invitation-link').inputValue();
  ok(/\/invite\/[A-Za-z0-9_-]{30,}$/.test(link), `B · created; the owner's invitation link is shown (${askedStepUp ? 'after the step-up modal' : 'fresh 2FA from sign-in'})`);
  ok(/Email|email/.test(await p.getByTestId('invitation-email-status').innerText()), 'B · the console says what happened to the invitation email');
  await shot(p, 'B-new-sandbox-created');
  const sbx = sql(`select id from app.centers where slug = '${SLUG}-sandbox'`);
  ok(sql(`select environment || '|' || status || '|' || (rules #>> '{onboarding,source}') || '|' || (rules #>> '{onboarding,org_type}') || '|' || state_region from app.centers where id = '${sbx}'`)
       === 'sandbox|onboarding|platform_admin|community_center|TX', 'B · DB: the sandbox, onboarding, created by the platform admin, its type and state');
  ok(sql(`select count(*) from app.member_join_codes where center_id = '${sbx}' and active`) === '1', 'B · DB: it has a member-app join code');
  ok(sql(`select makes_owner::text || '|' || email from app.staff_invitations where center_id = '${sbx}'`) === `true|${OWNER}`, 'B · DB: the owner invitation');
  ok(Number(sql(`select count(*) from app.audit_log where id > ${auditStart} and actor_user_id = '${ccId}' and reason = '${REASON}' and client_app = 'portal'
                   and record_table in ('centers','staff_invitations','org_profiles')`)) >= 3, 'B · audit: created by the platform admin, with the reason, from the portal');
  await p.goto(BASE + '/platform/pipeline', { waitUntil: 'networkidle' });
  ok((await p.locator(`tr[data-center="${SLUG}-sandbox"]`).count()) === 1, 'B · the onboarding pipeline lists it');
  await shot(p, 'B-pipeline');
  await ccs.ctx.close();

  // ══ C. The owner accepts and lands in Setup ═════════════════════════════════
  const octx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const op = await octx.newPage();
  op.on('pageerror', (e) => console.error('[owner page error]', String(e)));
  await op.goto(link, { waitUntil: 'networkidle' });
  ok((await op.innerText('body')).includes(ORG), 'C · the invitation names the sandbox');
  await shot(op, 'C-invite');
  const t1 = Date.now() - 2000;
  await op.getByLabel(/Your email/).fill(OWNER);
  await op.getByRole('button', { name: 'Send code' }).click();
  await op.getByLabel('Code').fill(await mailCode(OWNER, t1));
  await op.getByRole('button', { name: 'Verify and accept' }).click();
  await op.waitForURL((u) => u.pathname === '/account/security', { timeout: 30000 });
  await op.waitForLoadState('networkidle');
  const ownerId = sql(`select id from auth.users where email = '${OWNER}'`);
  ok(sql(`select user_id from app.center_owners where center_id = '${sbx}'`) === ownerId, 'C · accepting made her the owner');
  ok(sql(`select status from app.role_grants where center_id = '${sbx}' and user_id = '${ownerId}' and role_key = 'center_admin'`) === 'pending',
    'C · her administrator grant waits for a second person (two-person rule unchanged)');
  // The sandbox requires 2FA for staff: set it up, then the portal continues to Setup.
  await op.getByRole('button', { name: /Set up an authenticator app/ }).click();
  const secretEl = op.getByTestId('totp-secret'); await secretEl.waitFor();
  const ownerSecret = (await secretEl.innerText()).replace(/\s+/g, '');
  await op.getByLabel('Code from the app').fill(await totp(ownerSecret));
  await op.getByRole('button', { name: 'Turn on 2FA' }).click();
  await op.waitForURL((u) => u.pathname === '/setup', { timeout: 30000 });
  await op.waitForLoadState('networkidle');
  const setupText = await op.locator('body').innerText();
  ok(/Setup/.test(setupText) && setupText.includes(ORG) && !/You don't have access/.test(setupText), 'C · after 2FA the owner lands in the sandbox\'s Setup');
  ok((await op.getByTestId('sandbox-watermark').count()) >= 1, 'C · …with the sandbox watermark');
  await shot(op, 'C-owner-setup');

  // ══ D. Role-based checks ════════════════════════════════════════════════════
  // A second administrator (with an authenticator app) and a life membership awaiting the EC.
  const admin2Id = await ensureUser(ADMIN2);
  sql(`insert into app.role_grants (center_id, user_id, role_key, reason) values ('${sbx}', '${admin2Id}', 'center_admin', 'f-sandbox e2e: a second administrator')`);
  sql(`insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret, created_at, updated_at) values (gen_random_uuid(), '${admin2Id}', 'Phone', 'totp', 'verified', 'JBSWY3DPEHPK3PXP', now(), now())`);
  const person2 = sql(`insert into app.people (center_id, first_name, last_name, email) values ('${sbx}', 'Rina', 'Admin', '${ADMIN2}') returning id`).split('\n')[0];
  sql(`insert into app.center_users (center_id, user_id, person_id) values ('${sbx}', '${admin2Id}', '${person2}')`);
  const hh = sql(`insert into app.households (center_id, display_name) values ('${sbx}', 'Doshi household') returning id`).split('\n')[0];
  const applicant = sql(`insert into app.people (center_id, first_name, last_name) values ('${sbx}', 'Kiran', 'Doshi') returning id`).split('\n')[0];
  sql(`insert into app.household_members (household_id, person_id, center_id, is_primary) values ('${hh}', '${applicant}', '${sbx}', true)`);
  const life = sql(`insert into app.membership_types (center_id, key, tier, name, fee_cents, reference_required, ec_approval_required) values ('${sbx}', 'life', 'life', 'Life membership', 0, false, true) returning id`).split('\n')[0];
  const appId = sql(`insert into app.membership_applications (center_id, applicant_person_id, household_id, membership_type_id, tier, status, reference_decision, center_decided_by, center_decided_at)
                     values ('${sbx}', '${applicant}', '${hh}', '${life}', 'life', 'awaiting_ec', 'approved', '${admin2Id}', now()) returning id`).split('\n')[0];
  ok(sql(`select count(*) from app.role_grants where center_id = '${sbx}' and user_id = '${ownerId}' and role_key = 'executive_committee'`) === '0', 'D · the owner holds no Executive Committee role');
  await op.goto(`${BASE}/memberships/applications?app=${appId}`, { waitUntil: 'networkidle' });
  await op.getByRole('button', { name: 'Record EC approval' }).click();
  await confirmModal(op, 'Record EC approval');
  await answerStepUp(op, ownerSecret, 4000);
  ok(await until(() => sql(`select status || '|' || coalesce(ec_decided_by::text, '') from app.membership_applications where id = '${appId}'`) === `approved|${ownerId}`),
    'D · the owner records the Executive Committee approval of a life membership (role-based check passed)');
  ok(Number(sql(`select count(*) from app.audit_log where id > ${auditStart} and record_table = 'membership_applications' and record_id = '${appId}' and actor_user_id = '${ownerId}'`)) >= 1,
    'D · audit: the EC approval is recorded as the owner');
  await shot(op, 'D-owner-ec-approval');
  // Resetting another administrator's 2FA still needs a separate administrator.
  await op.goto(BASE + '/settings/team', { waitUntil: 'networkidle' });
  const row = op.locator('tr').filter({ hasText: 'Rina Admin' });
  ok((await row.count()) === 1 && (await row.getByRole('button', { name: 'Reset 2FA' }).count()) === 0, 'D · portal: the owner is offered no "Reset 2FA" for the other administrator');
  ok((await op.getByTestId('owner-no-2fa-reset').count()) === 1, 'D · portal: Settings › Team says it needs a separate administrator');
  await shot(op, 'D-owner-team');
  await octx.close();
  let otok = await apiSignIn(OWNER);
  otok = await apiStepUp(otok, sql(`select id from auth.mfa_factors where user_id = '${ownerId}' and status = 'verified' limit 1`), ownerSecret);
  r = await http('/rest/v1/rpc/reset_staff_2fa', { method: 'POST', token: otok, body: { p_center: sbx, p_user: admin2Id, p_reason: 'f-sandbox e2e: lost phone' } });
  ok(r.status >= 400 && /Only another administrator/.test(r.body?.message || ''), `D · API: the owner cannot reset another admin's 2FA (${r.body?.message})`);
  ok(sql(`select count(*) from auth.mfa_factors where user_id = '${admin2Id}'`) === '1', 'D · the other administrator\'s authenticator app is untouched');

  await browser.close();
  console.log(process.exitCode ? 'f-sandbox: FAILED' : 'f-sandbox: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
