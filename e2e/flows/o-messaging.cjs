// o-messaging flow: email, texting, WhatsApp, push and the Auth hooks against a
// real local stack, with the background service running and every provider a
// local mock (e2e/mock-providers.cjs). Never a real network call or key.
//
// Start (see the o-messaging final report for the full recipe):
//   SEND_EMAIL_HOOK_ENABLED=true SEND_EMAIL_HOOK_URI=http://host.docker.internal:3400/api/auth-hooks/send-email \
//   SEND_SMS_HOOK_ENABLED=true  SEND_SMS_HOOK_URI=http://host.docker.internal:3400/api/auth-hooks/send-sms \
//   SEND_EMAIL_HOOK_SECRET=v1,whsec_… SEND_SMS_HOOK_SECRET=v1,whsec_… bash e2e/up.sh o-messaging 300
//   MAILPIT=http://localhost:55624 PORT=4690 node e2e/mock-providers.cjs
//   portal on :3400 and worker/dist/server.js with RUNTIME (the env file below)
//   RUNTIME=/path/runtime.env PLAYWRIGHT=… node e2e/flows/o-messaging.cjs
//
// Journeys (each asserts DB rows and, for portal writes, audit rows with module,
// client_app, screen and reason):
//  1. Sign-in codes go through the Auth send-email hook → Resend mock → Mailpit, branded.
//  2. Settings › Email: add a domain (DNS records with copy buttons), verify, senders,
//     footer, test email; readiness check 4 passes; sign-in now comes from the center's sender.
//  3. A signed Resend bounce webhook suppresses the address; an unsigned one is refused;
//     a later message to it is 'suppressed'.
//  4. Settings › Texting: registration submitted, readiness 5 waits; approval recorded by a
//     platform admin; a test text; a signed Twilio status callback; STOP / START.
//  5. The send-SMS hook texts a phone sign-in code.
//  6. Sandbox: sending to a non-test recipient is refused (CCENT); a recipient verified by
//     code receives the message with the Sandbox banner.
//  7. Push: a registered phone gets a test push; a dead token is marked, not deleted.
//  8. WhatsApp: account and template recorded "pending Meta approval"; module switch.
//  9. Unsubscribe link → opt-out → the next newsletter is suppressed.
// 10. Roles: a member cannot change messaging settings or read them.
'use strict';
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3400';
const MAIL = process.env.MAIL || 'http://localhost:55624';
const API = process.env.API || 'http://localhost:55621';
const MOCK = process.env.MOCK || 'http://localhost:4690';
const DB = process.env.DB || 'postgres://postgres:postgres@localhost:55732/postgres';
const OUT = process.env.OUT || '/tmp/claude-0/streams/o-messaging';
const ENVF = process.env.ENVF || path.join(__dirname, '..', '.env.o-messaging');
const readEnv = (f) => Object.fromEntries(fs.readFileSync(f, 'utf8').trim().split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
const KEYS = readEnv(ENVF);
const RT = readEnv(process.env.RUNTIME || '/tmp/claude-0/o-messaging/runtime.env');
fs.mkdirSync(OUT, { recursive: true });

const sql = (q) => execSync(`psql "${DB}" -qAtX -v ON_ERROR_STOP=1`, { input: q }).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) { failures++; process.exitCode = 1; } };
async function until(fn, ms = 30000, every = 500) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(every); }
}
const inbox = async (q = '') => fetch(`${MOCK}/_inbox${q}`).then((r) => r.json());

async function mailCode(email, after) {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + email)}`).then((x) => x.json());
    const m = (r.messages || []).find((x) => new Date(x.Created).getTime() >= after);
    if (m) { const f = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((x) => x.json()); const c = (f.Text || '').match(/\b(\d{6,10})\b/); if (c) return { code: c[1], msg: f }; }
    await sleep(500);
  }
  throw new Error('no sign-in code for ' + email);
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
  if (r.status !== 200) throw new Error(`otp for ${email}: ${r.status} ${await r.text()}`);
  const { code, msg } = await mailCode(email, t0);
  const s = await fetch(`${API}/auth/v1/verify`, { method: 'POST', headers: anonH, body: JSON.stringify({ type: 'email', email, token: code }) }).then((x) => x.json());
  if (!s.access_token) throw new Error(`verify for ${email}: ${JSON.stringify(s)}`);
  return { token: s.access_token, mail: msg };
}
const userH = (token) => ({ ...anonH, authorization: `Bearer ${token}`, 'accept-profile': 'app', 'content-profile': 'app' });
const rpc = (token, fn, args) =>
  fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: userH(token), body: JSON.stringify(args) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const rest = (token, q) => fetch(`${API}/rest/v1/${q}`, { headers: userH(token) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

// Signed provider calls (the secrets the portal was started with).
function svixHeaders(secret, body) {
  const id = 'msg_' + crypto.randomBytes(8).toString('hex'); const ts = Math.floor(Date.now() / 1000);
  const key = Buffer.from(secret.replace(/^v1,/, '').replace(/^whsec_/, ''), 'base64');
  const sig = crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
  return { 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': `v1,${sig}`, 'content-type': 'application/json' };
}
function twilioPost(params) {
  const url = `${RT.PORTAL_PUBLIC_URL}/api/webhooks/twilio`;
  const data = Object.keys(params).sort().reduce((a, k) => a + k + params[k], url);
  const sig = crypto.createHmac('sha1', RT.TWILIO_AUTH_TOKEN).update(data).digest('base64');
  return fetch(`${BASE}/api/webhooks/twilio`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': sig }, body: new URLSearchParams(params).toString() });
}
function audit(table, afterId, extra = '') {
  return sql(`select coalesce(json_agg(json_build_object('module', module, 'app', client_app, 'screen', client_screen, 'reason', reason, 'action', action)), '[]')
                from app.audit_log where id > ${afterId} and record_table = '${table}' ${extra}`);
}

(async () => {
  const run = crypto.randomBytes(3).toString('hex');
  const jsh = sql("select id from app.centers where slug = 'jsh'");
  const domain = `mail-${run}.jsh-e2e.test`;
  const mark = Number(sql('select coalesce(max(id), 0) from app.audit_log'));
  // On a shared stack other flows may have linked admin@jsh.test to more communities (o-tenancy: JCNJ)
  // and given it an authenticator app. Branded sign-in needs a login of exactly one community, and this
  // flow signs in with the email code only: for this run the admin belongs to JSH only; its other
  // links are put back when the flow ends (test logins only).
  const adminId = sql("select id from auth.users where email = 'admin@jsh.test'");
  for (const f of JSON.parse(sql(`select coalesce(json_agg(id), '[]') from auth.mfa_factors where user_id = '${adminId}'`))) {
    const fr = await fetch(`${API}/auth/v1/admin/users/${adminId}/factors/${f}`, { method: 'DELETE', headers: { apikey: KEYS.SERVICE_KEY, authorization: `Bearer ${KEYS.SERVICE_KEY}` } });
    if (!fr.ok) console.log(`NOTE could not remove the admin's authenticator ${f}: ${fr.status}`);
  }
  const otherLinks = JSON.parse(sql(`select coalesce(json_agg(row_to_json(cu)), '[]') from app.center_users cu where user_id = '${adminId}' and center_id <> '${jsh}'`));
  const otherGrants = sql(`select coalesce(string_agg(id::text, ','), '') from app.role_grants where user_id = '${adminId}' and center_id <> '${jsh}'
                             and center_id not in (select id from app.centers where slug like 'jsh-e2e-%-sandbox') and (ends_at is null or ends_at > now())`);
  sql(`delete from app.center_users where user_id = '${adminId}' and center_id <> '${jsh}';
       ${otherGrants ? `update app.role_grants set ends_at = now() where id in ('${otherGrants.split(',').join("','")}');` : ''}`);
  process.on('exit', () => {
    try {
      if (otherGrants) sql(`update app.role_grants set ends_at = null where id in ('${otherGrants.split(',').join("','")}')`);
      for (const l of otherLinks) sql(`insert into app.center_users (center_id, user_id, person_id, is_default) values ('${l.center_id}', '${l.user_id}', '${l.person_id}', ${l.is_default}) on conflict do nothing`);
    } catch (e) { console.log('NOTE could not restore the admin\'s other communities:', e.message); }
  });
  await fetch(`${MOCK}/_mock/reset`, { method: 'POST' });
  // Test data only: start JSH from a clean messaging setup.
  sql(`update app.message_suppressions set lifted_at = now(), lift_reason = 'e2e reset' where lifted_at is null and center_id = '${jsh}';
       update app.email_senders set verified = false where center_id = '${jsh}';
       update app.email_domains set status = 'failed' where center_id = '${jsh}' and status = 'verified';
       update app.texting_registrations set status = 'draft', submitted_at = null, approved_at = null where center_id = '${jsh}';
       update app.integration_connections set status = 'disconnected' where center_id = '${jsh}' and provider = 'twilio';
       update app.role_grants set ends_at = now() where user_id = (select id from auth.users where email = 'admin@jsh.test')
          and center_id in (select id from app.centers where slug like 'jsh-e2e-%-sandbox') and (ends_at is null or ends_at > now());
       update app.centers set rules = jsonb_set(rules, '{notifications}', coalesce(rules->'notifications', '{}') || '{"quiet_start_hour": 3, "quiet_end_hour": 3}') where id = '${jsh}';`);

  // ── 1. Sign-in through the Auth send-email hook ─────────────────────────────
  const admin = await apiLogin('admin@jsh.test');
  let sent = (await inbox('?to=admin@jsh.test')).filter((m) => /sign-in code/.test(m.subject));
  ok(sent.length > 0 && sent[sent.length - 1].provider === 'resend', 'the sign-in code went through the send-email hook to the email provider (Resend mock)');
  ok(/Jain Society of Houston/.test(sent[sent.length - 1].from) && /JSH sign-in code/.test(sent[sent.length - 1].subject), 'branded for the member\'s community (JSH)');
  ok(/sign-in code is \d{6}/.test(admin.mail.Text || ''), 'the code arrived (relayed into Mailpit) and signed the admin in');
  ok(sql(`select count(*) from app.messages where purpose = 'auth_code' and to_address = 'admin@jsh.test' and status = 'sent' and body not similar to '%[0-9]{6}%'`) !== '0',
    'the hook recorded the message without the code');
  const priya = await apiLogin('priya@jsh.test');

  // ── 10. Roles ────────────────────────────────────────────────────────────────
  let r = await rpc(priya.token, 'add_email_domain', { p_center: jsh, p_domain: 'evil.example', p_reason: 'x' });
  ok(r.status >= 400 && /settings.manage or integrations.manage/.test(JSON.stringify(r.body)), 'a member cannot add a sending domain (the database refuses)');
  r = await rest(priya.token, `email_domains?center_id=eq.${jsh}&select=id`);
  ok(r.status === 200 && r.body.length === 0, 'a member reads no email domains');
  r = await rpc(priya.token, 'enqueue_message', { p_center: jsh, p_channel: 'email', p_to: 'x@example.com', p_template_key: 'test_message', p_vars: {}, p_purpose: 'test' });
  ok(r.status >= 400, 'enqueue_message is not callable over the API');

  // ── 2. Settings › Email in the portal ───────────────────────────────────────
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
  await p.fill('input[name=code]', (await mailCode('admin@jsh.test', t0)).code);
  await p.click('button[type=submit]');
  await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });

  await p.goto(BASE + '/settings/email', { waitUntil: 'networkidle' });
  ok(await p.getByRole('link', { name: 'Email', exact: true }).isVisible(), 'Settings shows the Email tab');
  const domainForm = p.locator('form', { has: p.locator('input[name=domain]') });
  await domainForm.locator('input[name=domain]').fill(domain);
  await domainForm.locator('input[name=reason]').fill(`E2E sending domain ${run}`);
  await domainForm.getByRole('button', { name: 'Add domain' }).click();
  const domId = await until(() => sql(`select id from app.email_domains where domain = '${domain}'`));
  ok(!!domId, 'the domain row exists');
  const recs = await until(() => Number(sql(`select jsonb_array_length(dns_records) from app.email_domains where id = '${domId}'`)) >= 4, 30000);
  ok(recs, 'the worker added it at the provider and stored its DNS records (SPF, DKIM, return path, DMARC)');
  const a1 = JSON.parse(audit('email_domains', mark, `and record_id = '${domId}'`));
  ok(a1.some((x) => x.app === 'portal' && x.screen === '/settings/email' && x.reason === `E2E sending domain ${run}`), 'the domain is audited: portal, /settings/email, with the reason');
  await p.goto(BASE + '/settings/email', { waitUntil: 'networkidle' });
  const body = await p.innerText('main');
  ok(body.includes(`resend._domainkey.${domain}`) && body.includes('Waiting for DNS'), 'the page lists the DNS records, waiting for DNS');
  ok((await p.getByRole('button', { name: /^Copy: / }).count()) >= 8, 'every record name and value has a copy button');
  await shot(p, 'settings-email-pending');

  await fetch(`${MOCK}/_mock/domains/${domain}/verify`, { method: 'POST' });
  await p.locator('form', { has: p.locator(`input[name=id][value="${domId}"]`) }).getByRole('button', { name: 'Check again' }).click();
  ok(await until(() => sql(`select status from app.email_domains where id = '${domId}'`) === 'verified', 30000), 'the re-check verifies the domain once the DNS is in place');

  await p.goto(BASE + '/settings/email', { waitUntil: 'networkidle' });
  const authForm = p.locator('form', { has: p.locator('input[name=purpose][value=auth]') });
  await authForm.locator('input[name=from_address]').fill(`codes@${domain}`);
  await authForm.locator('input[name=reply_to]').fill('office@jsh-e2e.test');
  await authForm.getByRole('button', { name: 'Save' }).click();
  ok(await until(() => sql(`select verified from app.email_senders where center_id = '${jsh}' and purpose = 'auth'`) === 't'), 'the sign-in sender is saved and verified by its domain');
  const footer = p.locator('form', { has: p.locator('input[name=postal_address]') });
  await footer.locator('input[name=postal_address]').fill('11820 Beechnut St, Houston TX 77072');
  await footer.locator('input[name=reason]').fill('CAN-SPAM footer');
  await footer.getByRole('button', { name: 'Save footer' }).click();
  ok(await until(() => sql(`select footer_postal_address from app.messaging_settings where center_id = '${jsh}'`) === '11820 Beechnut St, Houston TX 77072'), 'the footer is saved');

  await p.goto(BASE + '/settings/email', { waitUntil: 'networkidle' });
  await p.locator('form', { has: p.locator('input[name=channel][value=email]') }).getByRole('button', { name: 'Send a test' }).click();
  const testMail = await until(async () => (await inbox('?to=admin@jsh.test')).find((m) => /Test email from/.test(m.subject)));
  ok(!!testMail && testMail.from.endsWith(`<codes@${domain}>`) && !testMail.from.includes('via Community Connect'),
    'the test email went from the center\'s own verified sender');
  ok(!!testMail && testMail.html.includes('11820 Beechnut St'), 'with the postal-address footer');
  ok(await until(() => sql(`select status from app.messages where purpose = 'test' and channel = 'email' order by created_at desc limit 1`) === 'sent'), 'the test message row is sent');
  r = await rpc(admin.token, 'readiness', { p_center: jsh });
  const c4 = (r.body || []).find((x) => x.key === 'email_domain_verified');
  ok(c4 && c4.ok === true, `readiness 4 passes (${c4 && c4.detail})`);
  await p.goto(BASE + '/settings/email', { waitUntil: 'networkidle' });
  await shot(p, 'settings-email-verified');

  const again = await apiLogin('admin@jsh.test');
  sent = (await inbox('?to=admin@jsh.test')).filter((m) => /sign-in code/.test(m.subject));
  ok(sent[sent.length - 1].from.includes(`codes@${domain}`) && !!again.token, 'sign-in codes now come from the community\'s own address');

  // ── 3. Bounce webhook → suppression ─────────────────────────────────────────
  sql(`select app.enqueue_message('${jsh}', 'email', 'gone-${run}@example.com', 'test_message', '{}', 'notification')`);
  const bounced = await until(async () => (await inbox(`?to=gone-${run}@example.com`))[0]);
  ok(!!bounced, 'a notification email was sent');
  const evt = JSON.stringify({ type: 'email.bounced', created_at: new Date().toISOString(), data: { email_id: bounced.id, to: [`gone-${run}@example.com`], bounce: { message: 'Mailbox does not exist' } } });
  let wr = await fetch(`${BASE}/api/webhooks/resend`, { method: 'POST', headers: { 'content-type': 'application/json', 'svix-id': 'x', 'svix-timestamp': String(Math.floor(Date.now() / 1000)), 'svix-signature': 'v1,forged' }, body: evt });
  ok(wr.status === 401, 'an unsigned (forged) Resend webhook is refused');
  wr = await fetch(`${BASE}/api/webhooks/resend`, { method: 'POST', headers: svixHeaders(RT.RESEND_WEBHOOK_SECRET, evt), body: evt });
  ok(wr.status === 200, 'a signed Resend bounce is accepted');
  ok(await until(() => sql(`select count(*) from app.message_suppressions where address = 'gone-${run}@example.com' and reason = 'bounce' and lifted_at is null`) === '1'),
    'the bounce suppressed the address (worker: messaging.webhook.email)');
  ok(sql(`select status from app.messages where provider_ref = '${bounced.id}'`) === 'bounced', 'the message is marked bounced');
  const supId = sql(`select app.enqueue_message('${jsh}', 'email', 'gone-${run}@example.com', 'test_message', '{}', 'notification')`);
  ok(sql(`select status || '|' || coalesce(job_id::text, 'nojob') from app.messages where id = '${supId}'`) === 'suppressed|nojob', 'a later message to it is suppressed, not sent');

  // ── 4. Texting ──────────────────────────────────────────────────────────────
  await p.goto(BASE + '/settings/texting', { waitUntil: 'networkidle' });
  const tf = p.locator('form', { has: p.locator('select[name=kind]') });
  await tf.locator('input[name=legal_name]').fill('Jain Society of Houston');
  await tf.locator('input[name=ein]').fill('76-0123456');
  await tf.locator('input[name=use_case]').fill('Sign-in codes and event reminders');
  await tf.locator('textarea[name=sample_2]').fill('JSH: Paryushan pratikraman starts at 7 PM tonight. Reply STOP to opt out.');
  await tf.locator('input[name=opt_in]').fill('Members tick Texts in the app');
  await tf.locator('input[name=reason]').fill(`Register texting ${run}`);
  ok(/1 segment/.test(await tf.innerText()), 'the sample messages show their segment count');
  await tf.locator('textarea[name=sample_3]').fill('જય જિનેન્દ્ર');
  ok(/Unicode/.test(await tf.innerText()), 'a Gujarati sample is counted as Unicode');
  await tf.getByRole('button', { name: 'Submit for registration' }).click();
  await p.getByRole('dialog').getByRole('button', { name: 'Submit for registration' }).click();
  const regId = await until(() => sql(`select id from app.texting_registrations where center_id = '${jsh}' and status = 'submitted'`));
  ok(!!regId, 'the 10DLC registration is submitted (a record, not a claimed approval)');
  r = await rpc(admin.token, 'readiness', { p_center: jsh });
  ok(/waiting for the carriers/.test(((r.body || []).find((x) => x.key === 'texting_registered') || {}).detail || ''), 'readiness 5 says it is waiting for the carriers');
  ok(JSON.parse(audit('texting_registrations', mark)).some((x) => x.app === 'portal' && x.screen === '/settings/texting' && x.reason === `Register texting ${run}`), 'the submission is audited with its reason');
  await shot(p, 'settings-texting-submitted');
  // Community Connect records the carriers' decision.
  const pa = sql(`select user_id from app.accounts where is_platform_admin limit 1`) || sql(`insert into auth.users (id, email) values (gen_random_uuid(), 'cc-e2e-${run}@example.com') returning id`);
  sql(`insert into app.accounts (user_id, is_platform_admin) values ('${pa}', true) on conflict (user_id) do update set is_platform_admin = true;
       select set_config('request.jwt.claims', '{"sub":"${pa}","role":"authenticated"}', false);
       select app.set_messaging_review_status('texting', '${regId}', 'approved', 'Carriers approved (e2e)', '{"from_number":"+18325550100","brand_id":"BNE2E","campaign_id":"CME2E"}');`);
  r = await rpc(admin.token, 'readiness', { p_center: jsh });
  ok(((r.body || []).find((x) => x.key === 'texting_registered') || {}).ok === true, 'readiness 5 passes once approved');
  r = await rpc(admin.token, 'send_test_message', { p_center: jsh, p_channel: 'sms', p_to: '+1 713 555 0142' });
  ok(r.status === 200, 'a test text is queued');
  const txt = await until(async () => (await inbox('?channel=sms')).find((m) => m.to === '+17135550142'));
  ok(!!txt && txt.from === '+18325550100' && txt.status_callback === `${RT.PORTAL_PUBLIC_URL}/api/webhooks/twilio`, 'it went through Twilio from the approved number, with the status callback');
  wr = await twilioPost({ MessageSid: txt.id, MessageStatus: 'delivered', To: '+17135550142', From: '+18325550100' });
  ok(wr.status === 200, 'a signed Twilio status callback is accepted');
  ok(await until(() => sql(`select status from app.messages where provider_ref = '${txt.id}'`) === 'delivered'), 'the text is marked delivered');
  wr = await fetch(`${BASE}/api/webhooks/twilio`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': 'forged' }, body: 'MessageSid=SMx&MessageStatus=delivered' });
  ok(wr.status === 401, 'an unsigned Twilio callback is refused');
  wr = await twilioPost({ MessageSid: `SMin${run}`, From: '+17135550142', To: '+18325550100', Body: 'STOP' });
  ok(wr.status === 200 && (await wr.text()).includes('<Response>'), 'an inbound STOP is accepted (TwiML)');
  ok(await until(() => sql(`select count(*) from app.message_suppressions where center_id = '${jsh}' and address = '+17135550142' and reason = 'stop' and lifted_at is null`) === '1'), 'STOP suppresses the number');
  ok(!!(await until(async () => (await inbox('?channel=sms')).find((m) => m.to === '+17135550142' && /unsubscribed/.test(m.body)))), 'and the STOP confirmation was texted back');
  await twilioPost({ MessageSid: `SMin2${run}`, From: '+17135550142', To: '+18325550100', Body: 'START' });
  ok(await until(() => sql(`select count(*) from app.message_suppressions where center_id = '${jsh}' and address = '+17135550142' and lifted_at is null`) === '0'), 'START lifts it (kept, lifted)');

  // ── 5. Phone sign-in through the send-SMS hook ──────────────────────────────
  const phone = `+1713555${String(Math.floor(1000 + Math.random() * 8999))}`;
  const pr = await fetch(`${API}/auth/v1/otp`, { method: 'POST', headers: anonH, body: JSON.stringify({ phone, create_user: true }) });
  ok(pr.status === 200, `a phone sign-in code is requested (${pr.status})`);
  const smsCode = await until(async () => (await inbox('?channel=sms')).find((m) => m.to === phone));
  ok(!!smsCode && /Community Connect: your sign-in code is \d{6}/.test(smsCode.body), 'the send-SMS hook texted the code through Twilio (a new number: Community Connect branding)');
  ok(sql(`select count(*) from app.messages where purpose = 'auth_code' and channel = 'sms' and to_address = '${phone}' and status = 'sent'`) === '1', 'and recorded it without the code');

  // ── 6. Sandbox: test recipients only, with the banner ───────────────────────
  const sbx = sql(`insert into app.centers (slug, name, short_name, environment, status) values ('jsh-e2e-${run}-sandbox', 'JSH E2E Sandbox ${run}', 'JSHS', 'sandbox', 'active') returning id`);
  const adminUid = sql("select id from auth.users where email = 'admin@jsh.test'");
  sql(`insert into app.role_grants (center_id, user_id, role_key, scope_kind) values ('${sbx}', '${adminUid}', 'center_admin', 'center')`);
  r = await rpc(admin.token, 'send_test_message', { p_center: sbx, p_channel: 'email', p_to: `stranger-${run}@example.com` });
  ok(r.status >= 400 && r.body && r.body.code === 'CCENT' && /verified test recipients/.test(r.body.message), 'a sandbox cannot email a non-test address (CCENT, plain English)');
  r = await fetch(`${API}/rest/v1/sandbox_test_recipients?select=id`, { method: 'POST', headers: { ...userH(admin.token), prefer: 'return=representation' }, body: JSON.stringify({ center_id: sbx, channel: 'email', address: `tester-${run}@example.com` }) }).then(async (x) => ({ status: x.status, body: await x.json() }));
  const recId = r.body && r.body[0] && r.body[0].id;
  ok(!!recId, 'a test recipient is added (unverified)');
  r = await rpc(admin.token, 'send_recipient_verification', { p_recipient: recId });
  ok(r.status === 200, 'a verification code is sent to it');
  const vmail = await until(async () => (await inbox(`?to=tester-${run}@example.com`)).find((m) => /test recipient/.test(m.subject)));
  ok(!!vmail && vmail.subject.startsWith('[Sandbox · test data]') && vmail.html.includes('Sandbox · test data'), 'the code email carries the Sandbox banner and prefix');
  const vcode = vmail && (vmail.text.match(/code is (\d{6})/) || [])[1];
  r = await rpc(admin.token, 'confirm_recipient_verification', { p_recipient: recId, p_code: vcode });
  ok(r.status === 200 && r.body === true, 'the code verifies the recipient');
  r = await rpc(admin.token, 'send_test_message', { p_center: sbx, p_channel: 'email', p_to: `tester-${run}@example.com` });
  ok(r.status === 200 && !!(await until(async () => (await inbox(`?to=tester-${run}@example.com`)).find((m) => /Test email/.test(m.subject)))), 'now the sandbox can message it');
  ok(sql(`select bool_and(sandbox) from app.messages where center_id = '${sbx}'`) === 't', 'every sandbox message row is marked sandbox');
  await p.goto(BASE + '/settings/limits', { waitUntil: 'networkidle' });

  // ── 7. Push ─────────────────────────────────────────────────────────────────
  r = await rpc(admin.token, 'register_push_device', { p_center: jsh, p_token: `ExponentPushToken[e2eGood${run}]`, p_platform: 'ios' });
  ok(r.status === 200, 'the member app registers a phone (register_push_device)');
  await rpc(admin.token, 'register_push_device', { p_center: jsh, p_token: `ExponentPushToken[e2eDead${run}]`, p_platform: 'android' });
  await p.goto(BASE + '/settings/notifications', { waitUntil: 'networkidle' });
  await p.locator('form', { has: p.locator('input[name=channel][value=push]') }).getByRole('button', { name: 'Send a test' }).click();
  ok(!!(await until(async () => (await inbox('?channel=push')).find((m) => m.to === `ExponentPushToken[e2eGood${run}]`))), 'the test push reached the phone through Expo');
  ok(await until(() => sql(`select invalid_at is not null from app.push_devices where token = 'ExponentPushToken[e2eDead${run}]'`) === 't'), 'the dead token is marked (kept, not deleted)');
  ok(await until(() => sql(`select status from app.center_setup_steps where center_id = '${jsh}' and step_key = 'svc.push'`) === 'done'), 'Setup › Push notifications is done');
  await shot(p, 'settings-notifications-push');

  // ── 8. WhatsApp and the module switch ──────────────────────────────────────
  await p.goto(BASE + '/settings/whatsapp', { waitUntil: 'networkidle' });
  const wf = p.locator('form', { has: p.locator('input[name=display_name]') });
  await wf.locator('input[name=phone]').fill('+1 832 555 0101');
  await wf.locator('input[name=reason]').fill(`WhatsApp ${run}`);
  await wf.getByRole('button', { name: /Submit for Meta approval|Save/ }).click();
  ok(await until(() => sql(`select status from app.whatsapp_accounts where center_id = '${jsh}'`) === 'pending_meta'), 'the WhatsApp account is recorded pending Meta approval');
  await p.goto(BASE + '/settings/whatsapp', { waitUntil: 'networkidle' });
  const tplf = p.locator('form', { has: p.locator('textarea[name=body]') });
  await tplf.locator('input[name=name]').fill(`event_reminder_${run}`);
  await tplf.locator('textarea[name=body]').fill('Reminder: {{1}} starts at {{2}}.');
  await tplf.getByRole('button', { name: 'Submit template' }).click();
  ok(await until(() => sql(`select status from app.whatsapp_template_submissions where name = 'event_reminder_${run}'`) === 'pending_meta'), 'the template is recorded pending Meta approval');
  await p.goto(BASE + '/settings/whatsapp', { waitUntil: 'networkidle' });
  ok((await p.innerText('main')).includes('Pending Meta approval'), 'the page says so honestly');
  await shot(p, 'settings-whatsapp');
  r = await rpc(admin.token, 'send_test_message', { p_center: jsh, p_channel: 'whatsapp', p_to: '+17135550142' });
  ok(await until(() => /not approved by Meta/.test(sql(`select coalesce(failure_reason, '') from app.messages where channel = 'whatsapp' order by created_at desc limit 1`))), 'a WhatsApp test before approval fails with the reason, nothing is sent');
  sql(`insert into app.center_modules (center_id, module_key, enabled) values ('${jsh}', 'comms', false) on conflict (center_id, module_key) do update set enabled = false`);
  r = await rpc(admin.token, 'submit_whatsapp_template', { p_center: jsh, p_name: 'x', p_language: 'en', p_category: 'utility', p_body: 'x', p_reason: 'x' });
  ok(r.status >= 400 && /switched off/.test(JSON.stringify(r.body)), 'with Communications off the API refuses WhatsApp');
  await p.goto(BASE + '/settings/whatsapp', { waitUntil: 'networkidle' });
  ok(/switched off/i.test(await p.innerText('main')), 'and the WhatsApp page says the module is switched off');
  sql(`update app.center_modules set enabled = true where center_id = '${jsh}' and module_key = 'comms'`);

  // ── 9. Unsubscribe ──────────────────────────────────────────────────────────
  const priyaPerson = sql("select id from app.people where email = 'priya@jsh.test' limit 1");
  sql(`delete from app.channel_optins where person_id = '${priyaPerson}' and channel = 'email'`);
  const nl = sql(`select app.enqueue_message('${jsh}', 'email', 'priya@jsh.test', 'test_message', '{"person_id":"${priyaPerson}"}', 'campaign')`);
  const nlMail = await until(async () => (await inbox('?to=priya@jsh.test')).find((m) => /Test email/.test(m.subject)));
  const link = nlMail && (nlMail.text.match(/Unsubscribe: (\S+)/) || [])[1];
  ok(!!link && link.includes(`m=${nl}`), 'the newsletter carries a signed unsubscribe link');
  const ur = await fetch(link.replace(RT.PORTAL_PUBLIC_URL, BASE));
  ok(ur.status === 200 && /You are unsubscribed/.test(await ur.text()), 'the link unsubscribes (plain page)');
  ok((await fetch(`${BASE}/api/messaging/unsubscribe?m=${nl}&s=forged`)).status === 400, 'a tampered link is refused');
  const nl2 = sql(`select app.enqueue_message('${jsh}', 'email', 'priya@jsh.test', 'test_message', '{"person_id":"${priyaPerson}"}', 'campaign')`);
  ok(sql(`select status from app.messages where id = '${nl2}'`) === 'suppressed', 'the next newsletter is not sent');

  // Audit trail summary for the portal's writes.
  const trail = JSON.parse(sql(`select coalesce(json_agg(distinct record_table), '[]') from app.audit_log where id > ${mark} and client_app = 'portal'
                                  and record_table in ('email_domains','email_senders','messaging_settings','texting_registrations','whatsapp_accounts','whatsapp_template_submissions')`));
  ok(trail.length === 6, `portal writes are audited on every messaging table (${trail.join(', ')})`);

  await b.close();
  // The admin is back to one community, so the next run's sign-in is JSH-branded again.
  sql(`update app.role_grants set ends_at = now() where center_id = '${sbx}' and user_id = '${adminUid}'`);
  sql(`update app.centers set rules = rules #- '{notifications,quiet_start_hour}' #- '{notifications,quiet_end_hour}' where id = '${jsh}'`);
  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
})().catch((e) => { console.error(e); process.exit(1); });
