// o-platform flow (organization onboarding, Stage 1 → Stage 3), against a real local stack:
//   1. an anonymous visitor requests access at /request-access (a filled honeypot is refused);
//   2. a Community Connect admin approves it in Platform › Requests; the sandbox code is shown once
//      (email sending is the messaging stream's; until it lands the console says so honestly);
//   3. the contact redeems the code at /start: email sign-in with the real Mailpit code, phone
//      verification (GoTrue test OTP), authenticator app (TOTP computed here), sandbox terms → the
//      <slug>-sandbox organization exists, environment sandbox, the contact is its owner, the
//      watermark shows and the Setup checklist opens;
//   4. go-live is refused while readiness fails; the owner confirms training / health check / pilot
//      (readiness 13) in Setup › Go-live; the rest of readiness is arranged as test data;
//   5. go-live is approved by two different platform admins (the same admin cannot approve twice);
//   6. the owner promotes the sandbox (fresh 2FA); the worker's platform.promote job copies the
//      configuration only — no test people, no connections — and re-invites the staff.
// Every step is asserted in the database, with its audit rows (module, client_app, screen, reason).
//
//   (cd worker && pnpm build)   # the flow starts the worker as connect_worker
//   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright BASE=http://localhost:3200 MAIL=http://localhost:55424 \
//   API=http://localhost:55421 DB=postgres://postgres:postgres@localhost:55532/postgres ENVF=e2e/.env.o-platform \
//   OUT=/tmp/claude-0/streams/o-platform node e2e/flows/o-platform.cjs
//
// Test data only: platform admins cc1/cc2@platform.test, published platform agreement drafts, and
// a fresh organization per run (the names carry a run id), so it can be re-run on the same stack.
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const { execSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3200';
const MAIL = process.env.MAIL || 'http://localhost:55424';
const API = process.env.API || 'http://localhost:55421';
const DB = process.env.DB || 'postgres://postgres:postgres@localhost:55532/postgres';
const OUT = process.env.OUT || '/tmp/claude-0/streams/o-platform';
const ENVF = process.env.ENVF || path.join(__dirname, '..', '.env.o-platform');
const WORKER_JS = process.env.WORKER_JS || path.join(__dirname, '..', '..', 'worker', 'dist', 'server.js');
fs.mkdirSync(OUT, { recursive: true });
const env = Object.fromEntries(fs.readFileSync(ENVF, 'utf8').trim().split('\n').map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
const RUN = Date.now().toString(36);
const CC1 = 'cc1@platform.test';
const CC2 = 'cc2@platform.test';
const CONTACT = `asha.${RUN}@templeexample.test`;
const SECOND = `vikram.${RUN}@templeexample.test`;
const ORG = `Jain Temple ${RUN.toUpperCase()}`;
const SLUG = `jt-${RUN}`;
const PHONE_DIGITS = '15555550103'; // GoTrue test OTP 123456 on this stack (e2e/docker-compose.yml)

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

async function portalSignIn(browser, email, name) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(BASE + '/login'); const t0 = Date.now() - 2000;
  await p.fill('input[name=email]', email); await p.click('button[type=submit]');
  await p.waitForSelector('input[name=code]'); await p.fill('input[name=code]', await mailCode(email, t0));
  await p.click('button[type=submit]');
  await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  await shot(p, `${name}-signed-in`);
  return { ctx, p };
}

/** Submit an ActionForm whose button asks for confirmation in the modal. */
async function submitConfirmed(p, scope, label) {
  await scope.getByRole('button', { name: label, exact: true }).first().click();
  const dialog = p.getByRole('dialog').filter({ has: p.getByRole('button', { name: label, exact: true }) }).last();
  await dialog.getByRole('button', { name: label, exact: true }).click();
}

async function answerStepUp(p, secret) {
  const dialog = p.getByRole('dialog').filter({ hasText: 'Confirm it' });
  try { await dialog.waitFor({ timeout: 8000 }); } catch { return false; }
  await shot(p, 'step-up-modal');
  await dialog.getByLabel('Code from your authenticator app').fill(await totp(secret));
  await dialog.getByRole('button', { name: 'Verify and continue' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 20000 });
  return true;
}

(async () => {
  // ── Arrange (test stack only) ──────────────────────────────────────────────
  for (const e of [CC1, CC2]) {
    await http('/auth/v1/admin/users', { method: 'POST', service: true, body: { email: e, email_confirm: true } });
    sql(`insert into app.accounts (user_id, is_platform_admin) select id, true from auth.users where email = '${e}' on conflict (user_id) do update set is_platform_admin = true`);
  }
  const cc1Id = sql(`select id from auth.users where email = '${CC1}'`);
  const cc2Id = sql(`select id from auth.users where email = '${CC2}'`);
  sql(`update app.legal_documents set published_at = now() - interval '1 minute' where center_id is null and published_at is null and kind in ('org_terms','dpa','children_addendum','sandbox_terms')`);
  // The test phone number may be on an earlier run's login.
  sql(`update auth.users set phone = null, phone_confirmed_at = null, phone_change = '', phone_change_token = '' where phone = '${PHONE_DIGITS}' or phone_change = '${PHONE_DIGITS}'`);
  // Earlier runs from this machine count toward the per-address limits (5 requests an hour).
  sql(`delete from app.public_rate_events where kind like 'access_request.%' or kind like 'sandbox_code.%'`);
  const auditStart = Number(sql('select coalesce(max(id), 0) from app.audit_log'));

  // The background service, as connect_worker (needed for readiness and the promotion).
  const workerPw = process.env.WORKER_DB_PASSWORD || crypto.randomBytes(24).toString('hex');   // a shared stack passes the portal's connect_worker password
  sql(`alter role connect_worker with password '${workerPw}'`);
  const logs = [];
  const worker = spawn(process.execPath, [WORKER_JS], {
    env: { PATH: process.env.PATH, WORKER_DATABASE_URL: `postgres://connect_worker:${workerPw}@${new URL(DB).host}/postgres`, WORKER_ID: `e2e-platform-${RUN}`,
           WORKER_HEALTH_PORT: process.env.WORKER_HEALTH_PORT || '3719', WORKER_POLL_MS: '500', WORKER_HEARTBEAT_MS: '5000' },
  });
  worker.stdout.on('data', (d) => logs.push(...d.toString().trim().split('\n')));
  worker.stderr.on('data', (d) => logs.push(...d.toString().trim().split('\n')));

  const browser = await chromium.launch();
  try {
    // ── 1. Request access (anonymous) ────────────────────────────────────────
    const anon = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const ap = await anon.newPage();
    await ap.goto(BASE + '/request-access', { waitUntil: 'networkidle' });
    ok(new URL(ap.url()).pathname === '/request-access', '/request-access opens without signing in');
    await shot(ap, '1-request-access');
    const fill = async (pg) => {
      await pg.fill('input[name=org_legal_name]', ORG);
      await pg.check('input[name=org_type][value=temple]');
      await pg.fill('input[name=city]', 'Dallas'); await pg.fill('input[name=state]', 'TX'); await pg.fill('input[name=approx_households]', '240');
      await pg.fill('input[name=contact_name]', 'Asha Mehta'); await pg.fill('input[name=contact_email]', CONTACT); await pg.fill('input[name=contact_phone]', '(713) 555-0142');
      await pg.check('input[name=modules_interested][value=giving]'); await pg.check('input[name=current_systems][value=Neon]');
      await pg.fill('input[name=heard_from]', 'A friend at JSH');
    };
    // A bot fills the hidden field: refused, nothing stored.
    const bot = await anon.newPage();
    await bot.goto(BASE + '/request-access', { waitUntil: 'networkidle' });
    await fill(bot);
    await bot.evaluate(() => { document.querySelector('input[name=company_fax]').value = '555-1234'; });
    await bot.getByRole('button', { name: 'Send request' }).click();
    await bot.getByRole('alert').filter({ hasText: 'could not be sent' }).waitFor({ timeout: 20000 });
    ok(sql(`select count(*) from app.access_requests where contact_email = '${CONTACT}'`) === '0', 'a filled honeypot is refused and nothing is stored');
    await fill(ap);
    await ap.getByRole('button', { name: 'Send request' }).click();
    await ap.getByTestId('request-sent').waitFor({ timeout: 20000 });
    await shot(ap, '1-request-sent');
    const reqId = sql(`select id from app.access_requests where contact_email = '${CONTACT}'`);
    ok(sql(`select status||'|'||org_type||'|'||contact_phone||'|'||array_to_string(modules_interested, ',')||'|'||array_to_string(current_systems, ',')||'|'||(user_agent is not null)::text from app.access_requests where id = '${reqId}'`)
       === 'new|temple|+17135550142|giving,people|Neon|true', 'the request is stored (status new, phone in E.164, modules, systems, browser)');
    ok(sql(`select client_app||'|'||client_screen from app.audit_log where id > ${auditStart} and action = 'access_requests.insert' and record_id = '${reqId}'`) === 'portal|/request-access',
      'audit: access_requests.insert from the portal, screen /request-access');
    const anonRead = await http('/rest/v1/access_requests?select=id');
    ok(anonRead.status >= 400 || (Array.isArray(anonRead.body) && anonRead.body.length === 0), `anon cannot read access requests (${anonRead.status})`);
    await anon.close();

    // ── 2. CC approves in Platform › Requests ────────────────────────────────
    const c1 = await portalSignIn(browser, CC1, 'cc1');
    await c1.p.goto(BASE + '/platform/requests', { waitUntil: 'networkidle' });
    const row = c1.p.locator(`tr[data-request="${CONTACT}"]`);
    await row.waitFor();
    await shot(c1.p, '2-requests');
    await row.getByRole('button', { name: 'Review' }).click();
    const drawer = c1.p.getByRole('dialog').filter({ hasText: ORG });
    await drawer.getByRole('button', { name: 'Approve and issue a code' }).click();
    const issued = drawer.getByTestId('issued-code');
    await issued.waitFor({ timeout: 20000 });
    const code = await issued.locator('[data-code]').getAttribute('data-code');
    ok(/^CC-SBX-[23456789A-HJKMNP-Z]{4}-[23456789A-HJKMNP-Z]{4}$/.test(code || ''), `the code is shown once in the console (${code})`);
    const emailText = await drawer.getByTestId('email-status').innerText();
    ok(/Email sending isn't set up yet/.test(emailText) || /Email queued/.test(emailText), `the console says what happened to the email: "${emailText}"`);
    await shot(c1.p, '2-code-issued');
    ok(sql(`select status||'|'||decided_by from app.access_requests where id = '${reqId}'`) === `approved|${cc1Id}`, 'the request is approved by the CC admin');
    ok(sql(`select count(*) from app.sandbox_codes where request_id = '${reqId}' and code_hash = encode(extensions.digest('${code}', 'sha256'), 'hex') and code_last4 = right('${code}', 4) and email = '${CONTACT}' and redeemed_at is null`) === '1',
      'the code is stored only as its hash + last 4, bound to the contact email');
    ok(sql(`select count(*) from app.audit_log where id > ${auditStart} and action = 'sandbox_codes.insert' and client_app = 'portal' and client_screen = '/platform/requests' and actor_user_id = '${cc1Id}' and after::text not like '%${code}%'`) === '1',
      'audit: sandbox_codes.insert by the CC admin from Platform › Requests, without the plain code');
    await c1.p.goto(BASE + '/platform/codes', { waitUntil: 'networkidle' });
    ok(await c1.p.locator(`tr[data-code-last4="${code.slice(-4)}"][data-state=valid]`).count() === 1, 'Platform › Sandbox codes lists it (last 4 only), not used yet');
    await shot(c1.p, '2-codes');

    // ── 3. Redeem at /start ──────────────────────────────────────────────────
    const rc = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const rp = await rc.newPage();
    const errs = []; rp.on('pageerror', (e) => errs.push(String(e)));
    await rp.goto(BASE + '/start', { waitUntil: 'networkidle' });
    await shot(rp, '3-start-code');
    await rp.fill('input[name=code]', code.toLowerCase().replace(/-/g, ' '));
    await rp.getByRole('button', { name: 'Continue' }).click();
    await rp.fill('input[name=email]', CONTACT, { timeout: 20000 });
    const t0 = Date.now() - 2000;
    await rp.getByRole('button', { name: 'Send sign-in code' }).click();
    await rp.fill('input[name=email_code]', await mailCode(CONTACT, t0));
    await rp.getByRole('button', { name: 'Sign in' }).click();
    await rp.fill('input[name=phone]', '+1 555-555-0103', { timeout: 20000 });
    await shot(rp, '3-start-phone');
    await rp.getByRole('button', { name: 'Text me a code' }).click();
    await rp.fill('input[name=phone_code]', '123456', { timeout: 20000 });
    await rp.getByRole('button', { name: 'Verify' }).click();
    await rp.getByRole('button', { name: 'Set up an authenticator app' }).click({ timeout: 20000 });
    const secretEl = rp.getByTestId('totp-secret'); await secretEl.waitFor();
    const secret = (await secretEl.innerText()).replace(/\s+/g, '');
    await shot(rp, '3-start-authenticator');
    await rp.fill('input[name=totp]', await totp(secret));
    await rp.getByRole('button', { name: 'Turn on 2FA' }).click();
    await rp.getByTestId('sandbox-terms').waitFor({ timeout: 20000 });
    await shot(rp, '3-start-terms');
    await rp.getByRole('checkbox').check();
    await rp.getByRole('button', { name: 'Accept and continue' }).click();
    await rp.fill('input[name=slug]', SLUG, { timeout: 20000 });
    await shot(rp, '3-start-create');
    await rp.getByRole('button', { name: 'Create my sandbox' }).click();
    await rp.waitForURL((u) => u.pathname === '/setup', { timeout: 30000 });
    await rp.waitForLoadState('networkidle');
    const setupText = await rp.innerText('body');
    await shot(rp, '3-sandbox-setup');
    ok(/Sandbox · test data/i.test(setupText), 'the new sandbox shows the "Sandbox · test data" watermark');
    ok(/Setup/.test(setupText) && setupText.includes(ORG), 'the Setup checklist opens for the new organization');
    ok(errs.length === 0, 'no page errors during /start: ' + errs.join(' | '));
    const ownerId = sql(`select id from auth.users where email = '${CONTACT}'`);
    const sbx = sql(`select id from app.centers where slug = '${SLUG}-sandbox'`);
    ok(sql(`select environment||'|'||status||'|'||name from app.centers where id = '${sbx}'`) === `sandbox|onboarding|${ORG}`, 'the sandbox center exists (environment sandbox, onboarding)');
    ok(sql(`select user_id from app.center_owners where center_id = '${sbx}'`) === ownerId, 'the redeemer is its owner');
    ok(sql(`select status||'|'||granted_by from app.role_grants where center_id = '${sbx}' and user_id = '${ownerId}' and role_key = 'center_admin'`) === `active|${cc1Id}`,
      'and its active administrator, granted on behalf of the CC admin who issued the code');
    ok(sql(`select (phone = '${PHONE_DIGITS}' and phone_confirmed_at is not null)::text from auth.users where id = '${ownerId}'`) === 'true', 'the phone was verified');
    ok(sql(`select count(*) from auth.mfa_factors where user_id = '${ownerId}' and status = 'verified' and factor_type = 'totp'`) === '1', 'the authenticator app is enrolled');
    ok(sql(`select count(*) from app.org_agreements where center_id = '${sbx}' and kind = 'sandbox_terms' and accepted_by = '${ownerId}'`) === '1', 'the sandbox-terms acceptance is recorded for the organization');
    ok(sql(`select (redeemed_by = '${ownerId}' and center_id = '${sbx}')::text from app.sandbox_codes where request_id = '${reqId}' and revoked_at is null`) === 'true', 'the code is marked used');
    ok(Number(sql(`select count(*) from app.audit_log where id > ${auditStart} and action = 'sandbox_codes.update' and actor_user_id = '${ownerId}' and client_app = 'portal' and client_screen = '/start' and reason like 'Sandbox code …% redeemed'`)) >= 1,
      'audit: the redemption from /start with the reason');
    ok(sql(`select count(*) from app.audit_log where id > ${auditStart} and center_id = '${sbx}' and action = 'centers.insert' and reason like 'Sandbox code …% redeemed'`) === '1', 'audit: the sandbox center was created by the redemption');
    const reuse = await http('/rest/v1/rpc/check_sandbox_code', { method: 'POST', body: { p_code: code } });
    ok(reuse.body === 'used', 'the code now reads as used');

    // ── 4. Go-live refused until readiness passes ────────────────────────────
    await rp.goto(BASE + '/setup/go-live', { waitUntil: 'networkidle' });
    await shot(rp, '4-go-live-before');
    await submitConfirmed(rp, rp.locator('main'), 'Request go-live');
    await rp.getByRole('alert').filter({ hasText: 'readiness check must pass' }).first().waitFor({ timeout: 20000 });
    ok(sql(`select count(*) from app.golive_requests where center_id = '${sbx}'`) === '0', 'go-live is refused while readiness checks fail');
    // The owner confirms check 13 in the UI.
    for (const key of ['staff_trained', 'health_check_green', 'pilot_done']) {
      const li = rp.locator(`li[data-attestation=${key}]`);
      await li.locator('input[name=note]').fill(`${key} done in the e2e run`);
      await li.getByRole('button', { name: 'Confirm' }).click();
      await li.getByText('Confirmed', { exact: false }).waitFor({ timeout: 20000 });
    }
    ok(sql(`select count(*) from app.center_attestations where center_id = '${sbx}' and attested_by = '${ownerId}'`) === '3', 'the owner confirmed training, the health check and the pilot');
    ok(sql(`select count(*) from app.center_setup_steps where center_id = '${sbx}' and step_key like 'test.%' and status = 'done'`) === '3', 'the three test.* Setup steps are done');
    ok(sql(`select count(*) from app.audit_log where id > ${auditStart} and action = 'center_attestations.insert' and center_id = '${sbx}' and client_screen = '/setup/go-live' and reason = 'pilot_done done in the e2e run'`) === '1',
      'audit: the attestation from Setup › Go-live with the owner\'s note');

    // The rest of readiness, as test data: verification, agreements, a second admin with 2FA, setup data, legal documents.
    sql(`update app.org_profiles set ein = '741234567', verification_status = 'verified', verified_by = '${cc2Id}', verified_at = now() where center_id = '${sbx}'`);
    const ownerTok = await apiSignIn(CONTACT);
    for (const kind of ['org_terms', 'dpa', 'children_addendum']) {
      const doc = sql(`select id from app.legal_documents where center_id is null and kind = '${kind}' and published_at is not null order by published_at desc limit 1`);
      const r = await http('/rest/v1/rpc/accept_org_agreement', { method: 'POST', token: ownerTok, body: { p_center: sbx, p_document: doc } });
      ok(r.status < 300, `the owner accepts ${kind} (${r.status})`);
    }
    await http('/auth/v1/admin/users', { method: 'POST', service: true, body: { email: SECOND, email_confirm: true } });
    const secondId = sql(`select id from auth.users where email = '${SECOND}'`);
    sql(`insert into app.people (id, center_id, first_name, last_name, email) values (gen_random_uuid(), '${sbx}', 'Vikram', 'Shah', '${SECOND}')`);
    sql(`insert into app.center_users (center_id, user_id, person_id) select '${sbx}', '${secondId}', id from app.people where center_id = '${sbx}' and email = '${SECOND}'`);
    sql(`insert into app.role_grants (center_id, user_id, role_key, reason) values ('${sbx}', '${secondId}', 'center_admin', 'e2e second administrator')`);
    const t2 = await apiSignIn(SECOND);
    const en = await http('/auth/v1/factors', { method: 'POST', token: t2, body: { factor_type: 'totp', friendly_name: 'second-' + RUN } });
    const ch = await http(`/auth/v1/factors/${en.body.id}/challenge`, { method: 'POST', token: t2, body: {} });
    await http(`/auth/v1/factors/${en.body.id}/verify`, { method: 'POST', token: t2, body: { challenge_id: ch.body.id, code: await totp(en.body.totp.secret) } });
    for (const m of ['membership', 'giving', 'bolis', 'accounting', 'store', 'pathshala', 'gyan_path', 'jain_way', 'comms', 'content', 'niva', 'volunteers']) {
      sql(`insert into app.center_modules (center_id, module_key, enabled, reason) values ('${sbx}', '${m}', false, 'e2e: not used by this organization') on conflict (center_id, module_key) do update set enabled = false`);
    }
    sql(`insert into app.zones (center_id, name) values ('${sbx}', 'North zone')`);
    for (const k of ['terms', 'privacy', 'photo_release']) {
      sql(`insert into app.legal_documents (center_id, kind, version, title, body_md, published_at) values ('${sbx}', '${k}', '1', '${k} (test)', 'Test text.', now() - interval '1 minute')`);
    }
    // Readiness 4 and 5 (o-messaging): a verified sending domain with a sign-in sender and a delivered
    // test email; phone sign-in switched off, so no texting registration is needed.
    sql(`insert into app.email_domains (center_id, domain, provider, status, verified_at) values ('${sbx}', '${SLUG}.example.test', 'resend', 'verified', now() - interval '1 minute')`);
    sql(`insert into app.email_senders (center_id, purpose, from_name, from_address, verified) values ('${sbx}', 'auth', 'Jain Temple', 'codes@${SLUG}.example.test', true)`);
    sql(`insert into app.messages (center_id, channel, to_address, purpose, subject, body, status, sent_at, sandbox) values ('${sbx}', 'email', '${CONTACT}', 'test', 'Test email', 'e2e test email', 'sent', now(), true)`);
    sql(`update app.centers set rules = jsonb_set(coalesce(rules, '{}'), '{security}', coalesce(rules->'security', '{}') || '{"phone_sign_in": false}') where id = '${sbx}'`);
    // Readiness 10 (o-golive): a household/people import reconciled and signed off, as test data.
    sql(`insert into app.import_runs (center_id, source, entity, status, rows_total, rows_ok, rows_failed, started_by, started_at, finished_at, committed_at, signed_off_by, signed_off_at, sign_off_note)
         values ('${sbx}', 'csv', 'households', 'reconciled', 1, 1, 0, '${ownerId}', now(), now(), now(), '${ownerId}', now(), 'e2e: reconciled')`);
    // Test data that must NOT reach production.
    sql(`with h as (insert into app.households (center_id, display_name) values ('${sbx}', 'Test Family household') returning id),
              p as (insert into app.people (center_id, first_name, last_name, email) values ('${sbx}', 'Test', 'Member', 'test.member.${RUN}@example.test') returning id)
         insert into app.household_members (household_id, person_id, center_id, role, is_primary) select h.id, p.id, '${sbx}', 'primary', true from h, p`);
    sql(`insert into app.integration_connections (center_id, provider, status, display_name) values ('${sbx}', 'stripe', 'connected', 'Stripe (test mode)')`);
    for (let i = 0; i < 30 && sql(`select count(*) from app.worker_heartbeats where worker = 'e2e-platform-${RUN}'`) !== '1'; i++) await sleep(1000);
    const rd = await http('/rest/v1/rpc/readiness', { method: 'POST', token: ownerTok, body: { p_center: sbx } });
    const failing = Array.isArray(rd.body) ? rd.body.filter((r) => !r.ok).map((r) => `${r.key}: ${r.detail}`).join(' | ') : `readiness failed: ${JSON.stringify(rd.body)}`;
    ok(failing === '', 'with the test data in place every registered readiness check passes' + (failing ? ` — still failing: ${failing}` : ''));

    await rp.goto(BASE + '/setup/go-live', { waitUntil: 'networkidle' });
    await submitConfirmed(rp, rp.locator('main'), 'Request go-live');
    await rp.getByTestId('golive-status').waitFor({ timeout: 20000 });
    await shot(rp, '4-go-live-requested');
    const gl = sql(`select id from app.golive_requests where center_id = '${sbx}' and status = 'requested'`);
    ok(Boolean(gl), 'the go-live request is recorded (requested)');
    ok(sql(`select status from app.center_setup_steps where center_id = '${sbx}' and step_key = 'golive.request'`) === 'needs_review', 'Setup step golive.request waits for Community Connect');

    // ── 5. Two different platform admins approve ─────────────────────────────
    await c1.p.goto(BASE + '/platform/go-live', { waitUntil: 'networkidle' });
    const glRow = c1.p.locator(`tr[data-golive="${SLUG}-sandbox"]`);
    await glRow.getByRole('button', { name: 'Review' }).click();
    let dlg = c1.p.getByRole('dialog').filter({ hasText: ORG });
    await shot(c1.p, '5-go-live-review');
    await dlg.getByRole('button', { name: 'Approve (first)' }).click();
    await c1.p.getByText('First approval recorded', { exact: false }).first().waitFor({ timeout: 20000 });
    ok(sql(`select first_approver||'|'||status from app.golive_requests where id = '${gl}'`) === `${cc1Id}|requested`, 'the first platform admin approves');
    const again = await http('/rest/v1/rpc/approve_golive', { method: 'POST', token: await apiSignIn(CC1), body: { p_request: gl } });
    ok(again.status >= 400 && /second, different/.test(JSON.stringify(again.body)), 'the same admin cannot approve a second time');
    const c2 = await portalSignIn(browser, CC2, 'cc2');
    await c2.p.goto(BASE + '/platform/go-live', { waitUntil: 'networkidle' });
    await c2.p.locator(`tr[data-golive="${SLUG}-sandbox"]`).getByRole('button', { name: 'Review' }).click();
    dlg = c2.p.getByRole('dialog').filter({ hasText: ORG });
    await dlg.getByRole('button', { name: 'Approve (second)' }).click();
    for (let i = 0; i < 40 && sql(`select status from app.golive_requests where id = '${gl}'`) !== 'approved'; i++) await sleep(500);
    await shot(c2.p, '5-second-approval');
    ok(sql(`select status||'|'||first_approver||'|'||second_approver from app.golive_requests where id = '${gl}'`) === `approved|${cc1Id}|${cc2Id}`, 'a second, different admin approves: approved');
    ok(sql(`select count(*) from app.audit_log where id > ${auditStart} and action = 'golive_requests.update' and record_id = '${gl}' and client_screen = '/platform/go-live' and actor_user_id in ('${cc1Id}','${cc2Id}')`) === '2',
      'audit: both approvals from Platform › Go-live approvals');
    await c2.p.goto(BASE + '/platform/pipeline', { waitUntil: 'networkidle' });
    ok(await c2.p.locator(`tr[data-center="${SLUG}-sandbox"][data-stage=approved]`).count() === 1, 'the pipeline shows the organization as approved');
    await shot(c2.p, '5-pipeline');

    // ── 6. The owner promotes; the worker copies configuration only ──────────
    await rp.goto(BASE + '/setup/go-live', { waitUntil: 'networkidle' });
    await rp.fill('#promote-slug', SLUG);
    await submitConfirmed(rp, rp.locator('main'), 'Promote to production');
    await answerStepUp(rp, secret);
    for (let i = 0; i < 60 && sql(`select coalesce(max(status), '') from app.sandbox_promotions where sandbox_id = '${sbx}'`) !== 'done'; i++) await sleep(1000);
    const promo = sql(`select status||'|'||coalesce(last_error, '') from app.sandbox_promotions where sandbox_id = '${sbx}'`);
    ok(promo === 'done|', 'the platform.promote job finished: ' + promo);
    await rp.reload({ waitUntil: 'networkidle' });
    await shot(rp, '6-promoted');
    const prod = sql(`select id from app.centers where slug = '${SLUG}'`);
    ok(sql(`select environment||'|'||status from app.centers where id = '${prod}'`) === 'production|onboarding', 'the production organization exists (production, onboarding)');
    ok(sql(`select sandbox_for from app.centers where id = '${sbx}'`) === prod, 'the sandbox points to it');
    ok(sql(`select count(*) from app.zones where center_id = '${prod}' and name = 'North zone'`) === '1'
       && sql(`select count(*) from app.center_modules where center_id = '${prod}' and not enabled`) === '12'
       && sql(`select count(*) from app.legal_documents where center_id = '${prod}'`) === '3'
       && sql(`select verification_status from app.org_profiles where center_id = '${prod}'`) === 'verified',
      'configuration is copied: zones, module switches, legal documents, the verified profile');
    ok(sql(`select count(*) from app.households where center_id = '${prod}'`) === '1' && sql(`select count(*) from app.people where center_id = '${prod}'`) === '1'
       && sql(`select count(*) from app.integration_connections where center_id = '${prod}'`) === '0',
      'no test households or people (only the owner\'s own record) and no connections or credentials');
    ok(sql(`select user_id from app.center_owners where center_id = '${prod}'`) === ownerId, 'the owner owns production');
    ok(sql(`select count(*) from app.staff_invitations where center_id = '${prod}' and email = '${SECOND}' and role_keys = '{center_admin}' and accepted_at is null`) === '1',
      'the second administrator is re-invited to production (not copied as a login)');
    ok(Number(sql(`select count(*) from app.audit_log where id > ${auditStart} and center_id = '${prod}' and client_app = 'job' and reason like 'Promotion from sandbox%'`)) > 5,
      'audit: the copy is recorded as job changes with the promotion reason');
    ok(sql(`select count(*) from app.audit_log where id > ${auditStart} and action = 'sandbox_promotions.insert' and actor_user_id = '${ownerId}' and client_screen = '/setup/go-live'`) === '1',
      'audit: the owner\'s promotion request from Setup › Go-live');
    ok(sql(`select count(*) from app.jobs where kind = 'platform.sandbox_expiry' and status = 'done'`) !== '0', 'the daily sandbox-expiry pass runs on the worker');
    await c1.ctx.close(); await c2.ctx.close(); await rc.close();
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
    worker.kill('SIGTERM');
    fs.writeFileSync(`${OUT}/worker.log`, logs.join('\n') + '\n');
  }
})();
