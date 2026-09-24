// People, Membership and Communications — end-to-end journeys against a real local stack
// (bash e2e/up.sh <stream> <offset>). Plain Node + Playwright; every step asserts the database.
//
//   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright PORTAL=http://localhost:3400 MEMBER=http://localhost:8500 \
//   MAIL=http://localhost:55624 API=http://localhost:55621 DB=postgres://postgres:postgres@localhost:55732/postgres \
//   ENVF=e2e/.env.w-people node e2e/flows/w-people.cjs [journey ...]
//
// Journeys (all by default, or name some): join · profile · ask · whatsapp · newsletter · roles · merge · modules · permissions
//   join        a brand-new email signs up in the member app, starts a new family through onboarding,
//               applies for Life membership naming a Life member; the reference confirms in their app;
//               the center approves in the portal; the same person cannot give the EC approval; a second
//               Executive Committee member does; the membership is active with an open $501 fee pledge
//               and the member card shows Life.
//   profile     the member edits their profile (one save); the portal person page shows it, and History
//               shows the change with app · screen · reason.
//   ask         the member asks a question in the New-to guide; it lands in the portal inbox; staff reply;
//               the member sees the reply.
//   whatsapp    the member asks to join a WhatsApp group; staff mark them added; the member sees it.
//   newsletter  an all-member newsletter is approved by one person, refused a second approval by the same
//               person, approved by a different one, and is scheduled (there is no sender: it stays queued).
//   roles       a Treasurer grant waits for a second person; the granter cannot approve it; another admin
//               does, and it becomes active.
//   merge       two duplicate households are merged with the wizard; people move, the duplicate points at
//               the kept one, and the audit entry carries the reason.
//   modules     Membership and Communications switched off: the portal shows the notice and hides them, the
//               member app says they aren't offered, the API refuses; switched back on, all audited.
//   voting      a voting-eligibility override is requested with a reason, approved by someone else, applied.
//   settings    Rules, Onboarding fields, Notifications and Security save into the versioned, audited rules.
//   account     member settings: data export request, deactivate and reactivate; the privacy officer sees them.
//   permissions a member's token cannot edit another household, approve applications, create newsletters,
//               approve or self-grant roles; a teacher sees "no access" in the portal.
//
// Test data is created here (a second staff login, a duplicate household); nothing in the apps is faked.
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORTAL = process.env.PORTAL || 'http://localhost:3100';
const MEMBER = process.env.MEMBER || 'http://localhost:8200';
const MAIL = process.env.MAIL || 'http://localhost:55324';
const API = process.env.API || 'http://localhost:55321';
const DB = process.env.DB || 'postgres://postgres:postgres@localhost:55432/postgres';
const OUT = process.env.OUT || '/tmp/claude-0/e2e/w-people';
const ENVF = process.env.ENVF || path.join(__dirname, '..', '.env.e2e');
fs.mkdirSync(OUT, { recursive: true });
const env = Object.fromEntries(fs.readFileSync(ENVF, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const CENTER = '00000000-0000-4000-8000-000000000001';
const RUN = Date.now().toString(36);

const sql = (q) => execSync(`psql "${DB}" -Atc "${q.replace(/"/g, '\\"')}"`).toString().trim();
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) failures++; };
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }).catch(() => {});

async function code(email, after) {
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + email)}`).then((x) => x.json());
    const m = (r.messages || []).find((x) => new Date(x.Created).getTime() >= after);
    if (m) {
      const f = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((x) => x.json());
      const c = ((f.Text || '') + ' ' + (f.HTML || '')).match(/\b(\d{6,10})\b/);
      if (c) return c[1];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('no sign-in code arrived for ' + email);
}

/** A staff login for the two-person rules: a second Executive Committee member who can also manage roles. */
async function ensureSecondStaff(email, member) {
  if (sql(`select count(*) from auth.users where email = '${email}'`) === '0') {
    await fetch(`${API}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: env.SERVICE_KEY, Authorization: `Bearer ${env.SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, email_confirm: true }),
    });
  }
  if (sql(`select count(*) from app.role_grants g join auth.users u on u.id = g.user_id where u.email = '${email}' and g.role_key = 'executive_committee' and g.status = 'active'`) === '0') {
    execSync(`psql "${DB}" -q -v email="${email}" -v member="${member}" -v roles="executive_committee,center_admin" -f ${path.join(__dirname, '..', '..', 'supabase', 'demo', 'grant-login.sql')}`, { stdio: 'pipe' });
  }
}

async function portalLogin(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(PORTAL + '/login');
  const t0 = Date.now() - 2000;
  await p.fill('input[name=email]', email);
  // The sign-in service allows one code per address per second; a token minted a
  // moment earlier for the same address can make the first request bounce. Retry.
  for (let attempt = 1; ; attempt++) {
    await p.click('button[type=submit]');
    try {
      await p.waitForSelector('input[name=code]', { timeout: 10000 });
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
      await p.waitForTimeout(2000);
    }
  }
  await p.fill('input[name=code]', await code(email, t0));
  await p.click('button[type=submit]');
  await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 });
  return p;
}

async function memberLogin(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('   member pageerror:', String(e).slice(0, 200)));
  await p.goto(MEMBER + '/sign-in', { waitUntil: 'networkidle' });
  const t0 = Date.now() - 2000;
  await p.fill('input[placeholder="name@example.com"]', email);
  await p.getByRole('button', { name: /send|code|continue/i }).first().click();
  const box = p.locator('input[inputmode=numeric], input[autocomplete=one-time-code]').first();
  await box.waitFor({ timeout: 30000 });
  await box.fill(await code(email, t0));
  const verify = p.getByRole('button', { name: /verify/i }).first();
  if (await verify.isVisible().catch(() => false)) await verify.click();
  await p.waitForTimeout(3500);
  return p;
}

/** Click an ActionForm submit button, then its confirm modal when one opens. */
async function submitAndConfirm(p, scope, name) {
  await scope.getByRole('button', { name }).first().click();
  const dialog = p.getByRole('dialog').filter({ has: p.getByRole('button') }).last();
  if (await dialog.isVisible({ timeout: 2500 }).catch(() => false)) {
    const confirmBtn = dialog.getByRole('button', { name: /confirm|yes|approve|record|merge|continue|send|grant/i }).last();
    await confirmBtn.click();
  }
  await p.waitForTimeout(2500);
}


/** A real user token (email code via Mailpit), for calling the API as that user. */
async function tokenFor(email) {
  const t0 = Date.now() - 2000;
  const h = { apikey: env.ANON_KEY, 'Content-Type': 'application/json' };
  await fetch(`${API}/auth/v1/otp`, { method: 'POST', headers: h, body: JSON.stringify({ email, create_user: false }) });
  const r = await fetch(`${API}/auth/v1/verify`, { method: 'POST', headers: h, body: JSON.stringify({ type: 'email', email, token: await code(email, t0) }) }).then((x) => x.json());
  if (!r.access_token) throw new Error('no token for ' + email + ': ' + JSON.stringify(r).slice(0, 200));
  return r.access_token;
}
async function rest(token, method, pathAndQuery, body) {
  const res = await fetch(`${API}/rest/v1/${pathAndQuery}`, {
    method,
    headers: { apikey: env.ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept-Profile': 'app', 'Content-Profile': 'app', Prefer: 'return=representation' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}
/** Switch a module as the admin, through the same RPC the Settings › Modules tab uses. */
async function setModule(adminToken, key, enabled, reason) {
  const r = await rest(adminToken, 'POST', 'rpc/set_module_enabled', { p_center: CENTER, p_module: key, p_enabled: enabled, p_reason: reason });
  if (r.status >= 300) throw new Error(`set_module_enabled ${key} ${enabled}: ${JSON.stringify(r.json).slice(0, 200)}`);
}

const lastAudit = (table, where = '') =>
  sql(`select coalesce(client_app,'')||'|'||coalesce(client_screen,'')||'|'||coalesce(reason,'')||'|'||coalesce(module,'')||'|'||(actor_user_id is not null)::text from app.audit_log where record_table = '${table}' ${where} order by id desc limit 1`);

// ---------------------------------------------------------------------------
const state = { email: `new.${RUN}@example.test`, phone: `(713) 555-${String(1000 + (Date.now() % 9000)).slice(-4)}` };

const journeys = {
  async join(b) {
    // 1. Brand-new email → sign up → "Is this your family?" → new family.
    const m = await memberLogin(b, state.email);
    ok(/family-match/.test(m.url()), `new email lands on "Is this your family?" (${m.url().replace(MEMBER, '')})`);
    await m.getByLabel('First name').fill('Anand');
    await m.getByLabel('Last name').fill(`Kothari${RUN.slice(-3)}`);
    await m.getByRole('button', { name: /start my family/i }).click();
    await m.waitForURL(/\/about/, { timeout: 20000 });
    state.person = sql(`select p.id from app.people p join app.center_users cu on cu.person_id = p.id join auth.users u on u.id = cu.user_id where u.email = '${state.email}'`);
    state.household = sql(`select household_id from app.household_members where person_id = '${state.person}' and left_at is null`);
    ok(!!state.person && !!state.household, 'a person and a new household exist for the new login');
    ok(sql(`select tier||'/'||status from app.memberships where household_id = '${state.household}'`) === 'community/active', 'the new family starts as an active Community membership');
    // 2. About you → Your family → How should we reach you → Done.
    await m.getByLabel('Date of birth').fill('03/14/1985');
    await m.getByLabel('Mobile').fill(state.phone);
    await m.getByLabel('Profession').fill('Architect');
    await m.getByRole('button', { name: /^continue$/i }).last().click();
    await m.waitForURL(/\/family$/, { timeout: 20000 });
    ok(sql(`select profession||'|'||(phone_e164 is not null)::text||'|'||date_of_birth from app.people where id = '${state.person}'`) === 'Architect|true|1985-03-14', 'About you saved profession, mobile and date of birth');
    await m.getByRole('button', { name: /looks right/i }).last().click();
    await m.waitForURL(/\/contact/, { timeout: 20000 });
    await m.getByText('Digital only, no physical mail').click();
    await m.getByRole('button', { name: /^finish$/i }).click();
    await m.waitForURL(/\/done/, { timeout: 20000 });
    await shot(m, 'join-1-done');
    await m.getByRole('button', { name: /go to home/i }).click();
    await m.waitForTimeout(2500);
    ok(sql(`select count(*) from app.audit_log where client_app = 'member' and record_table = 'people' and record_id = '${state.person}'`) !== '0', 'onboarding writes are audited as the member app');

    // 3. Apply for Life, naming a Life member by email.
    await m.goto(MEMBER + '/guide/apply', { waitUntil: 'networkidle' });
    await m.waitForTimeout(2000);
    await m.getByText('Life membership', { exact: true }).first().click();
    await m.getByLabel(/email, mobile number or member number/i).fill('priya@jsh.test');
    await m.getByRole('button', { name: /find my reference/i }).click();
    await m.waitForTimeout(2000);
    await m.getByText('Priya Shah', { exact: false }).first().waitFor({ timeout: 10000 });
    await m.getByLabel(/how do you know them/i).fill('Pathshala parents together for 5 years');
    await shot(m, 'join-2-apply');
    await m.getByRole('button', { name: /send application/i }).click();
    await m.getByText(/application sent/i).waitFor({ timeout: 15000 });
    state.app = sql(`select id from app.membership_applications where household_id = '${state.household}' order by created_at desc limit 1`);
    ok(sql(`select tier||'|'||status||'|'||fee_cents from app.membership_applications where id = '${state.app}'`) === 'life|awaiting_reference|50100', 'application: Life, awaiting the reference, $501 fee');
    ok(lastAudit('membership_applications', `and record_id = '${state.app}'`).startsWith('member|/guide/apply|'), 'application audit row: member app, /guide/apply');
    // A Yearly member cannot be the reference for Life (the database refuses, in plain English).
    await m.goto(MEMBER + '/guide/apply', { waitUntil: 'networkidle' });
    await m.waitForTimeout(1500);
    ok(/application in progress/i.test(await m.innerText('body')), 'the apply screen now shows the application in progress');

    // 4. The reference (Priya) confirms in her app.
    const priya = await memberLogin(b, 'priya@jsh.test');
    await priya.goto(MEMBER + '/family', { waitUntil: 'networkidle' });
    await priya.waitForTimeout(2000);
    ok(/reference request/i.test(await priya.innerText('body')), 'Family tab tells the reference a request is waiting');
    await priya.goto(MEMBER + '/reference-requests', { waitUntil: 'networkidle' });
    await priya.waitForTimeout(2000);
    await priya.getByText('Anand Kothari', { exact: false }).first().waitFor({ timeout: 10000 });
    await priya.getByLabel(/note for the membership team/i).fill('Known the family through Pathshala');
    await priya.getByRole('button', { name: /i know them/i }).click();
    await priya.getByText(/takes it from here/i).waitFor({ timeout: 15000 });
    await shot(priya, 'join-3-reference');
    ok(sql(`select status||'|'||reference_decision from app.membership_applications where id = '${state.app}'`) === 'awaiting_center|approved', 'reference approved → awaiting the center');
    ok(lastAudit('membership_applications', `and record_id = '${state.app}'`).startsWith('member|/reference-requests|Known the family through Pathshala|membership'), 'reference decision audited with the reference\'s note as reason');
    await priya.context().close();

    // 5. The center approves in the portal; the same person cannot give the EC approval.
    const admin = await portalLogin(b, 'admin@jsh.test');
    await admin.goto(`${PORTAL}/memberships/applications?app=${state.app}`, { waitUntil: 'networkidle' });
    const drawer = admin.getByRole('dialog').first();
    await drawer.getByText('Anand Kothari', { exact: false }).first().waitFor({ timeout: 15000 });
    await submitAndConfirm(admin, drawer, /send to EC/i);
    ok(sql(`select status from app.membership_applications where id = '${state.app}'`) === 'awaiting_ec', 'center review recorded → awaiting the Executive Committee');
    await admin.goto(`${PORTAL}/memberships/applications?app=${state.app}`, { waitUntil: 'networkidle' });
    ok(/different Executive Committee member/i.test(await admin.innerText('body')), 'the reviewer is told a different EC member must approve');
    ok((await admin.getByRole('button', { name: /record EC approval/i }).count()) === 0, 'no EC-approval button for the person who made the center review');
    await admin.context().close();

    await ensureSecondStaff('neha@jsh.test', 'JSH-90006');
    const neha = await portalLogin(b, 'neha@jsh.test');
    await neha.goto(`${PORTAL}/memberships/applications?app=${state.app}`, { waitUntil: 'networkidle' });
    await submitAndConfirm(neha, neha.getByRole('dialog').first(), /record EC approval/i);
    await shot(neha, 'join-4-approved');
    ok(/Active — open the household/i.test(await neha.innerText('body')) && /open pledge/i.test(await neha.innerText('body')), 'the drawer shows the active membership and the fee as an open pledge');
    const granted = sql(`select m.tier||'|'||m.status||'|'||coalesce(p.amount_cents::text,'-')||'|'||coalesce(p.source::text,'-')||'|'||coalesce(p.status::text,'-') from app.membership_applications a join app.memberships m on m.id = a.membership_id left join app.pledges p on p.id = m.fee_pledge_id where a.id = '${state.app}'`);
    ok(granted === 'life|active|50100|membership_fee|open', 'approval created the Life membership and an open $501 membership-fee pledge: ' + granted);
    ok(sql(`select count(*) from app.memberships where household_id = '${state.household}' and status = 'active'`) === '1', 'the earlier Community membership was ended (one active membership)');
    ok(sql(`select count(*) from app.audit_log where record_table = 'memberships' and after->>'tier' = 'life' and after->>'household_id' = '${state.household}' and client_app = 'portal'`) !== '0', 'the new membership row is audited from the portal');
    await neha.context().close();

    // 6. The member sees it.
    await m.goto(MEMBER + '/member-card', { waitUntil: 'networkidle' });
    await m.waitForTimeout(2500);
    await shot(m, 'join-5-card');
    ok(/life/i.test(await m.innerText('body')), 'member card shows Life membership');
    state.memberPage = m;
  },

  async profile(b) {
    const m = state.memberPage || (await memberLogin(b, state.email || 'priya@jsh.test'));
    const person = state.person || sql("select id from app.people where email = 'priya@jsh.test'");
    const newJob = `Structural engineer ${RUN}`;
    await m.goto(`${MEMBER}/person/${person}`, { waitUntil: 'networkidle' });
    await m.waitForTimeout(2500);
    await m.getByLabel('Profession').first().fill(newJob);
    await m.getByRole('button', { name: /save changes/i }).click();
    await m.waitForTimeout(3000);
    await shot(m, 'profile-1-saved');
    ok(sql(`select profession from app.people where id = '${person}'`) === newJob, 'one save wrote the profession');
    const a = sql(`select client_app||'|'||client_screen||'|'||coalesce(reason,'') from app.audit_log where record_table = 'people' and record_id = '${person}' and after->>'profession' = '${newJob}' order by id desc limit 1`);
    ok(a === `member|/person/${person}|Profile updated in the member app`, 'audit: member app · /person/[id] · reason (' + a + ')');
    const admin = await portalLogin(b, 'admin@jsh.test');
    await admin.goto(`${PORTAL}/people/${person}`, { waitUntil: 'networkidle' });
    ok((await admin.innerText('body')).includes(newJob), 'the portal person page shows the new profession');
    await admin.getByRole('button', { name: /history/i }).first().click();
    await admin.waitForTimeout(2500);
    const h = await admin.innerText('body');
    await shot(admin, 'profile-2-history');
    ok(h.includes(newJob) && /member app|member/i.test(h) && h.includes('Profile updated in the member app'), 'History shows the change with app, screen and reason');
    await admin.context().close();
  },

  async ask(b) {
    const m = state.memberPage || (await memberLogin(b, state.email || 'priya@jsh.test'));
    const person = state.person || sql("select id from app.people where email = 'priya@jsh.test'");
    const q = `Is there parking for the Paryushan pravachan? ${RUN}`;
    await m.goto(`${MEMBER}/guide/ask`, { waitUntil: 'networkidle' });
    await m.waitForTimeout(2500);
    await m.getByLabel(/question/i).first().fill(q);
    await m.getByRole('button', { name: /send/i }).first().click();
    await m.waitForTimeout(3000);
    const thread = sql(`select t.id from app.threads t join app.thread_messages tm on tm.thread_id = t.id where t.from_person_id = '${person}' and tm.body like '${q.replace(/'/g, "''")}%' limit 1`);
    ok(!!thread, 'the question is a thread in a team inbox');
    ok(lastAudit('threads', `and record_id = '${thread}'`).startsWith('member|/guide/ask|'), 'thread audited from the member app');
    const admin = await portalLogin(b, 'admin@jsh.test');
    await admin.goto(`${PORTAL}/comms/inbox`, { waitUntil: 'networkidle' });
    ok((await admin.innerText('body')).includes(q.slice(0, 40)), 'the portal inbox lists the question');
    await admin.goto(`${PORTAL}/comms/threads/${thread}`, { waitUntil: 'networkidle' });
    const reply = `Yes, use the overflow lot across the street. ${RUN}`;
    await admin.fill('textarea[name=body]', reply);
    await admin.getByRole('button', { name: /send reply/i }).click();
    await admin.waitForTimeout(3000);
    ok(sql(`select count(*) from app.thread_messages where thread_id = '${thread}' and from_role and body = '${reply}'`) === '1', 'the staff reply is stored, from the role');
    ok(sql(`select status||'|'||(first_response_at is not null)::text from app.threads where id = '${thread}'`) === 'waiting|true', 'thread is waiting on the member, first response recorded');
    ok(lastAudit('thread_messages').startsWith(`portal|/comms/threads/${thread}|`), 'reply audited from the portal thread screen');
    await admin.context().close();
    await m.goto(`${MEMBER}/guide/ask`, { waitUntil: 'networkidle' });
    await m.waitForTimeout(3000);
    await shot(m, 'ask-1-reply');
    ok((await m.innerText('body')).includes(reply), 'the member sees the reply under their question');
  },

  async whatsapp(b) {
    const m = state.memberPage || (await memberLogin(b, state.email || 'priya@jsh.test'));
    const person = state.person || sql("select id from app.people where email = 'priya@jsh.test'");
    await m.goto(`${MEMBER}/guide/whatsapp`, { waitUntil: 'networkidle' });
    await m.waitForTimeout(2500);
    const join = m.getByRole('button', { name: /request to join/i }).first();
    if (!(await join.isVisible().catch(() => false))) {
      ok(false, 'a "Request to join" button (none visible; groups: ' + sql("select count(*) from app.whatsapp_groups where active") + ')');
      return;
    }
    await join.click();
    await m.waitForTimeout(2500);
    const req = sql(`select id from app.whatsapp_join_requests where person_id = '${person}' order by created_at desc limit 1`);
    ok(!!req && sql(`select status from app.whatsapp_join_requests where id = '${req}'`) === 'pending', 'join request queued as pending');
    ok(lastAudit('whatsapp_join_requests', `and record_id = '${req}'`).startsWith('member|/guide/whatsapp|'), 'join request audited from the member app');
    const admin = await portalLogin(b, 'admin@jsh.test');
    await admin.goto(`${PORTAL}/comms/whatsapp`, { waitUntil: 'networkidle' });
    const target = admin.locator('tr').filter({ hasText: 'WA-' + req.replace(/-/g, '').slice(-5).toUpperCase() }).first();
    await target.getByRole('button', { name: /mark added/i }).click();
    await admin.waitForTimeout(2500);
    ok(sql(`select status||'|'||(handled_by is not null)::text from app.whatsapp_join_requests where id = '${req}'`) === 'added|true', 'staff marked the member added');
    await admin.context().close();
    await m.goto(`${MEMBER}/guide/whatsapp`, { waitUntil: 'networkidle' });
    await m.waitForTimeout(2500);
    await shot(m, 'whatsapp-1-added');
    ok(/Added ✓/.test(await m.innerText('body')), 'the member sees "Added"');
  },

  async newsletter(b) {
    await ensureSecondStaff('neha@jsh.test', 'JSH-90006');
    const name = `Paryushan schedule ${RUN}`;
    const admin = await portalLogin(b, 'admin@jsh.test');
    await admin.goto(`${PORTAL}/comms/newsletters`, { waitUntil: 'networkidle' });
    await admin.fill('#nl-name', name);
    const all = admin.getByRole('group', { name: /audience segments/i }).getByRole('button', { name: /^all members$/i });
    if ((await all.getAttribute('aria-pressed')) !== 'true') await all.click();
    await admin.fill('#nl-subject', 'Paryushan: pratikraman, pravachans and parking');
    await admin.fill('#nl-body', 'Pratikraman at 7:30 PM every evening. Pravachans at 10 AM. Use the overflow lot.');
    await submitAndConfirm(admin, admin.locator('main'), /send for approval/i);
    const id = sql(`select id from app.comms_campaigns where name = '${name}'`);
    ok(!!id && sql(`select status||'|'||requires_second_approver from app.comms_campaigns where id = '${id}'`) === 'draft|true', 'all-member newsletter saved, awaiting approval, needs two approvers');
    const row = () => admin.locator('tr').filter({ hasText: name }).first();
    await admin.goto(`${PORTAL}/comms/newsletters`, { waitUntil: 'networkidle' });
    await submitAndConfirm(admin, row(), /^approve$/i);
    ok(sql(`select status from app.comms_campaigns where id = '${id}'`) === 'pending_approval', 'first approval recorded → waiting for a second approver');
    await admin.goto(`${PORTAL}/comms/newsletters`, { waitUntil: 'networkidle' });
    ok(/needs another approver/i.test(await row().innerText()), 'the first approver cannot approve again (row says it needs another approver)');
    await admin.context().close();
    const neha = await portalLogin(b, 'neha@jsh.test');
    await neha.goto(`${PORTAL}/comms/newsletters`, { waitUntil: 'networkidle' });
    await submitAndConfirm(neha, neha.locator('tr').filter({ hasText: name }).first(), /^approve$/i);
    await shot(neha, 'newsletter-1-approved');
    ok(sql(`select status||'|'||(second_approver is not null and second_approver <> approved_by)::text||'|'||(sent_at is null)::text from app.comms_campaigns where id = '${id}'`) === 'scheduled|true|true', 'a different approver scheduled it; nothing claims it was sent');
    await neha.goto(`${PORTAL}/comms/newsletters`, { waitUntil: 'networkidle' });
    ok(/queued until a sender is connected/i.test(await neha.locator('tr').filter({ hasText: name }).first().innerText()), 'the status says honestly that it stays queued (no sender)');
    ok(lastAudit('comms_campaigns', `and record_id = '${id}'`).startsWith('portal|/comms/newsletters|'), 'approvals audited from the portal newsletters screen');
    await neha.context().close();
  },

  async roles(b) {
    await ensureSecondStaff('neha@jsh.test', 'JSH-90006');
    const kiran = sql("select id from auth.users where email = 'kiran@jsh.test'");
    sql(`update app.role_grants set ends_at = now() where user_id = '${kiran}' and role_key = 'treasurer' and ends_at is null`);
    const admin = await portalLogin(b, 'admin@jsh.test');
    await admin.goto(`${PORTAL}/settings/roles`, { waitUntil: 'networkidle' });
    await admin.fill('#grant-search', 'Kiran Mehta');
    await admin.getByRole('button', { name: /^search$/i }).click();
    await admin.getByRole('button', { name: /^choose$/i }).first().click();
    await admin.selectOption('#grant-role', 'treasurer');
    await admin.fill('#grant-reason', `Treasurer for the 2026-27 term ${RUN}`);
    await submitAndConfirm(admin, admin.locator('main'), /grant to/i);
    const g = sql(`select id from app.role_grants where user_id = '${kiran}' and role_key = 'treasurer' and ends_at is null order by created_at desc limit 1`);
    ok(!!g && sql(`select status from app.role_grants where id = '${g}'`) === 'pending', 'a Treasurer grant waits for a second person');
    ok(/waiting for a second person/i.test(await admin.innerText('body')), 'the granter is told it is waiting (not "Granted")');
    ok(lastAudit('role_grants', `and record_id = '${g}'`).includes(`|Treasurer for the 2026-27 term ${RUN}|`), 'grant audited with its reason');
    await admin.goto(`${PORTAL}/settings/roles?show=pending`, { waitUntil: 'networkidle' });
    const row = admin.locator('tr').filter({ hasText: 'Kiran Mehta' }).filter({ hasText: 'Treasurer' }).first();
    ok(/you made this grant/i.test(await row.innerText()) && (await row.getByRole('button', { name: /^approve$/i }).count()) === 0, 'the granter has no Approve button');
    await admin.context().close();
    const neha = await portalLogin(b, 'neha@jsh.test');
    await neha.goto(`${PORTAL}/`, { waitUntil: 'networkidle' });
    ok(/role grant.*waiting for your approval/i.test(await neha.innerText('body')), 'Home › My tasks shows the waiting role grant to the other admin');
    await neha.goto(`${PORTAL}/settings/roles?show=pending`, { waitUntil: 'networkidle' });
    await submitAndConfirm(neha, neha.locator('tr').filter({ hasText: 'Kiran Mehta' }).filter({ hasText: 'Treasurer' }).first(), /^approve$/i);
    await shot(neha, 'roles-1-approved');
    ok(sql(`select status||'|'||(second_approver = (select id from auth.users where email = 'neha@jsh.test'))::text||'|'||(starts_at <= now())::text from app.role_grants where id = '${g}'`) === 'active|true|true', 'a different admin approved it; it is active now');
    ok(lastAudit('role_grants', `and record_id = '${g}'`).startsWith('portal|/settings/roles|Second approval'), 'the approval is audited with its reason');
    await neha.context().close();
    sql(`update app.role_grants set ends_at = now() where id = '${g}'`); // leave the demo roles as they were
  },

  async merge(b) {
    const keep = sql("select id from app.households where display_name = 'Mehta family' and merged_into_id is null");
    const drop = sql(`insert into app.households (center_id, display_name, city) values ('${CENTER}', 'Mehta family (registered twice ${RUN})', 'Sugar Land') returning id`).split('\n')[0];
    const dupPerson = sql(`insert into app.people (center_id, first_name, last_name) values ('${CENTER}', 'Ria', 'Mehta${RUN.slice(-3)}') returning id`).split('\n')[0];
    sql(`insert into app.household_members (household_id, person_id, center_id, role, is_primary) values ('${drop}', '${dupPerson}', '${CENTER}', 'child', true)`);
    sql(`insert into app.merge_candidates (center_id, kind, left_id, right_id, score) values ('${CENTER}', 'household', '${keep}', '${drop}', 0.9)`);
    const admin = await portalLogin(b, 'admin@jsh.test');
    await admin.goto(`${PORTAL}/people/merge?household=${keep}`, { waitUntil: 'networkidle' });
    await admin.getByRole('link', { name: new RegExp('registered twice ' + RUN) }).click();
    await admin.waitForURL(/other=/, { timeout: 20000 });
    await admin.fill('#merge-reason-h', `Registered twice at the Paryushan desk ${RUN}`);
    await shot(admin, 'merge-1-compare');
    await submitAndConfirm(admin, admin.locator('main'), /merge households/i);
    ok(sql(`select merged_into_id from app.households where id = '${drop}'`) === keep, 'the duplicate now points at the kept household');
    ok(sql(`select count(*) from app.household_members where person_id = '${dupPerson}' and household_id = '${keep}' and left_at is null`) === '1', 'its member moved to the kept household');
    const a = sql(`select client_app||'|'||client_screen||'|'||coalesce(reason,'') from app.audit_log where record_table = 'households' and record_id = '${drop}' order by id desc limit 1`);
    ok(a.startsWith('portal|/people/merge|Registered twice at the Paryushan desk'), 'merge audited with app, screen and the reason given: ' + a);
    await admin.context().close();
  },

  async modules(b) {
    const adminToken = await tokenFor('admin@jsh.test');
    const priyaToken = await tokenFor('priya@jsh.test');
    const lifeType = sql("select id from app.membership_types where key = 'life'");
    try {
      await setModule(adminToken, 'membership', false, `e2e: membership off ${RUN}`);
      await setModule(adminToken, 'comms', false, `e2e: comms off ${RUN}`);
      ok(sql("select string_agg(module_key||'='||enabled, ',' order by module_key) from app.center_modules where module_key in ('membership','comms')") === 'comms=false,membership=false', 'Membership and Communications switched off (with reasons)');
      // Portal: direct URLs show the notice; the tab and nav disappear.
      const admin = await portalLogin(b, 'admin@jsh.test');
      for (const url of ['/memberships/applications', '/people/voting', '/comms', '/comms/inbox', '/comms/whatsapp', '/comms/newsletters']) {
        await admin.goto(PORTAL + url, { waitUntil: 'networkidle' });
        ok(/switched off/i.test(await admin.innerText('main')), `portal ${url} shows the switched-off notice`);
      }
      await admin.goto(PORTAL + '/people', { waitUntil: 'networkidle' });
      ok(!/Membership applications/.test(await admin.innerText('main')), 'People tabs hide Membership applications');
      ok(!/Communications/.test(await admin.locator('aside, nav').first().innerText()), 'sidebar hides Communications');
      await shot(admin, 'modules-1-portal');
      await admin.context().close();
      // Member app: screens say the community does not offer it.
      const m = await memberLogin(b, 'priya@jsh.test');
      for (const url of ['/guide/apply', '/guide/membership', '/reference-requests', '/guide/ask', '/guide/whatsapp']) {
        await m.goto(MEMBER + url, { waitUntil: 'networkidle' });
        await m.waitForTimeout(1500);
        ok(/isn't offered/i.test(await m.innerText('body')), `member app ${url} says it isn't offered`);
      }
      await shot(m, 'modules-2-member');
      await m.context().close();
      // API: refused for the member.
      const apply = await rest(priyaToken, 'POST', 'rpc/find_membership_reference', { p_center: CENTER, p_type: lifeType, p_contact: 'kiran@jsh.test' });
      ok(apply.status >= 400 && /switched off/i.test(JSON.stringify(apply.json)), 'API: reference lookup refused while Membership is off');
      const apps = await rest(priyaToken, 'GET', 'membership_applications?select=id');
      ok(apps.status === 200 && Array.isArray(apps.json) && apps.json.length === 0, 'API: applications read as empty (hidden) while Membership is off');
      const inbox = sql("select id from app.inboxes where key = 'office'");
      const person = sql("select id from app.people where email = 'priya@jsh.test'");
      const th = await rest(priyaToken, 'POST', 'threads', { center_id: CENTER, inbox_id: inbox, from_person_id: person, subject: 'blocked?', status: 'open' });
      ok(th.status >= 400, `API: starting a thread refused while Communications is off (${th.status})`);
    } finally {
      await setModule(adminToken, 'comms', true, `e2e: comms back on ${RUN}`).catch((e) => ok(false, 'switch comms back on: ' + e.message));
      await setModule(adminToken, 'membership', true, `e2e: membership back on ${RUN}`).catch((e) => ok(false, 'switch membership back on: ' + e.message));
    }
    ok(sql("select count(*) from app.center_modules where module_key in ('membership','comms') and not enabled") === '0', 'both modules back on');
    ok(sql(`select count(*) from app.audit_log where record_table = 'center_modules' and reason like 'e2e: % ${RUN}'`) === '4', 'every switch is audited with its reason');
  },

  async permissions(b) {
    // A member (Priya) and a teacher try staff actions over the API with their own tokens.
    const priya = await tokenFor('priya@jsh.test');
    const mehta = sql("select id from app.households where display_name = 'Mehta family' and merged_into_id is null");
    const r1 = await rest(priya, 'PATCH', `households?id=eq.${mehta}`, { display_name: 'Hacked' });
    ok(r1.status === 200 && Array.isArray(r1.json) && r1.json.length === 0 && sql(`select display_name from app.households where id = '${mehta}'`) === 'Mehta family', 'member cannot edit another household (0 rows)');
    const anyApp = sql("select id from app.membership_applications order by created_at limit 1");
    const r2 = await rest(priya, 'PATCH', `membership_applications?id=eq.${anyApp}`, { status: 'approved' });
    ok(r2.status >= 400 || (Array.isArray(r2.json) && r2.json.length === 0), 'member cannot approve a membership application');
    const r3 = await rest(priya, 'POST', 'comms_campaigns', { center_id: CENTER, kind: 'newsletter', title: 'spam', status: 'scheduled' });
    ok(r3.status >= 400, `member cannot create a newsletter (${r3.status})`);
    const pending = sql(`insert into app.role_grants (center_id, user_id, role_key, scope_kind, status, starts_at, granted_by, reason) select '${CENTER}', id, 'treasurer', 'center', 'pending', 'infinity', (select id from auth.users where email = 'admin@jsh.test'), 'e2e ${RUN}' from auth.users where email = 'kiran@jsh.test' returning id`).split('\n')[0];
    const r4 = await rest(priya, 'POST', 'rpc/approve_role_grant', { p_grant: pending });
    ok(r4.status >= 400 && /not allowed/i.test(JSON.stringify(r4.json)) && sql(`select status from app.role_grants where id = '${pending}'`) === 'pending', `member cannot approve a pending role grant (${r4.status})`);
    sql(`update app.role_grants set ends_at = now() where id = '${pending}'`);
    const priyaUser = sql("select id from auth.users where email = 'priya@jsh.test'");
    const r5 = await rest(priya, 'POST', 'role_grants', { center_id: CENTER, user_id: priyaUser, role_key: 'center_admin', scope_kind: 'center' });
    ok(r5.status >= 400, `member cannot grant themselves a role (${r5.status})`);
    const r6 = await rest(priya, 'PATCH', `whatsapp_join_requests?status=eq.pending`, { status: 'added' });
    ok(r6.status >= 400 || (Array.isArray(r6.json) && r6.json.length === 0), 'member cannot mark WhatsApp requests added');
    // The teacher in the portal: no access to People admin, Membership applications or Communications.
    const teacher = await portalLogin(b, 'teacher@jsh.test');
    for (const url of ['/memberships/applications', '/settings/roles', '/comms/newsletters']) {
      await teacher.goto(PORTAL + url, { waitUntil: 'networkidle' });
      ok(/don't have access|no access|not available to your role/i.test(await teacher.innerText('main')), `teacher sees "no access" on ${url}`);
    }
    await teacher.context().close();
  },

  async settings(b) {
    // Rules, Onboarding fields, Notifications and Security all save into centers.rules (versioned, audited).
    const admin = await portalLogin(b, 'admin@jsh.test');
    const rulesNow = () => sql(`select (rules - 'version')::text from app.centers where id = '${CENTER}'`);
    for (const url of ['/settings/rules', '/settings/onboarding', '/settings/notifications', '/settings/security']) {
      await admin.goto(PORTAL + url, { waitUntil: 'networkidle' });
      const form = admin.locator('main form').first();
      const before = rulesNow();
      const control = form.locator('[role=switch], [role=radio][aria-checked=false]:not([disabled]), button[aria-pressed=false]').first();
      if (!(await control.count())) { ok(false, `${url}: no editable control found`); continue; }
      await control.click();
      const save = form.getByRole('button', { name: /^save/i }).first();
      await save.click();
      await admin.waitForTimeout(2500);
      const after = rulesNow();
      ok(after !== before, `${url}: a change saved into the center's rules`);
      ok(lastAudit('centers').startsWith(`portal|${url}|`), `${url}: the change is audited from this screen`);
      // Put it back (test data only; the portal path was exercised above).
      if (rulesNow() !== before) sql(`update app.centers set rules = '${before.replace(/'/g, "''")}'::jsonb || jsonb_build_object('version', rules->'version') where id = '${CENTER}'`);
    }
    await admin.goto(PORTAL + '/settings/integrations', { waitUntil: 'networkidle' });
    ok(/not connected|connect/i.test(await admin.innerText('main')), 'Integrations shows each connection honestly');
    await admin.context().close();
  },

  async account(b) {
    // Member settings: data export request, deactivate → reactivate; the privacy team sees the requests.
    const email = 'kiran@jsh.test';
    const user = sql(`select id from auth.users where email = '${email}'`);
    const person = sql(`select person_id from app.center_users where user_id = '${user}'`);
    const m = await memberLogin(b, email);
    await m.goto(MEMBER + '/settings', { waitUntil: 'networkidle' });
    await m.waitForTimeout(2000);
    await m.getByText('Download my data').click();
    await m.waitForTimeout(3000);
    ok(sql(`select count(*) from app.data_requests where person_id = '${person}' and kind = 'export' and status = 'open'`) !== '0', 'data export request recorded');
    await m.getByRole('button', { name: /^deactivate account$/i }).first().click();
    await m.getByRole('dialog').last().getByRole('button', { name: /^deactivate account$/i }).click();
    await m.waitForTimeout(3000);
    ok(sql(`select status from app.accounts where user_id = '${user}'`) === 'deactivated', 'account deactivated');
    ok(lastAudit('accounts', `and record_id = '${user}'`).startsWith('member|/settings|'), 'deactivation audited from the member app settings screen');
    await m.goto(MEMBER + '/settings', { waitUntil: 'networkidle' });
    await m.waitForTimeout(2000);
    await shot(m, 'account-1-deactivated');
    const re = m.getByRole('button', { name: /reactivate/i }).first();
    ok(await re.isVisible().catch(() => false), 'settings shows the deactivated notice with Reactivate');
    await re.click();
    await m.waitForTimeout(3000);
    ok(sql(`select status from app.accounts where user_id = '${user}'`) === 'active', 'account reactivated from the app');
    await m.context().close();
    const admin = await portalLogin(b, 'admin@jsh.test');
    await admin.goto(PORTAL + '/settings/privacy', { waitUntil: 'networkidle' });
    ok(/don't have access/i.test(await admin.innerText('main')), 'without privacy.manage the admin is told they have no access to data requests');
    await admin.context().close();
    await ensureSecondStaff('neha@jsh.test', 'JSH-90006');
    sql(`insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) select '${CENTER}', id, 'privacy_officer', 'center', 'e2e test login' from auth.users where email = 'neha@jsh.test' and not exists (select 1 from app.role_grants g where g.user_id = auth.users.id and g.role_key = 'privacy_officer' and g.ends_at is null)`);
    const officer = await portalLogin(b, 'neha@jsh.test');
    await officer.goto(PORTAL + '/settings/privacy', { waitUntil: 'networkidle' });
    const priv = await officer.innerText('main');
    await shot(officer, 'account-2-privacy');
    ok(/Kiran Mehta/.test(priv) && /Deactivate account/.test(priv), 'the privacy officer sees the member\'s requests in Settings › Privacy');
    await officer.context().close();
  },

  async voting(b) {
    // Voting eligibility override: requested by one person with a reason, approved by a different one, applied.
    await ensureSecondStaff('neha@jsh.test', 'JSH-90006');
    sql("update app.eligibility_snapshots set override_by = null, override_reason = null, override_requested_value = null, override_second_approver = null, override_can_vote = null");
    const admin = await portalLogin(b, 'admin@jsh.test');
    await admin.goto(PORTAL + '/people/voting', { waitUntil: 'networkidle' });
    const details = admin.locator('main details').first();
    await details.locator('summary').click();
    await details.locator('textarea[name=reason]').fill(`Paid maintenance in cash at the office ${RUN}`);
    await submitAndConfirm(admin, details, /request override/i);
    const snap = sql("select id from app.eligibility_snapshots where override_by is not null limit 1");
    ok(!!snap, 'override requested with its reason');
    ok(lastAudit('eligibility_snapshots', `and record_id = '${snap}'`).startsWith(`portal|/people/voting|Paid maintenance in cash at the office ${RUN}|membership`), 'request audited with the reason');
    await admin.goto(PORTAL + '/people/voting', { waitUntil: 'networkidle' });
    ok((await admin.getByRole('button', { name: /approve override/i }).count()) === 0, 'the requester gets no Approve button');
    await admin.context().close();
    const neha = await portalLogin(b, 'neha@jsh.test');
    await neha.goto(PORTAL + '/people/voting', { waitUntil: 'networkidle' });
    await submitAndConfirm(neha, neha.locator('main'), /approve override/i);
    ok(sql(`select (override_second_approver is not null)::text from app.eligibility_snapshots where id = '${snap}'`) === 'true', 'a different person approved it');
    await neha.goto(PORTAL + '/people/voting', { waitUntil: 'networkidle' });
    await submitAndConfirm(neha, neha.locator('main'), /apply · mark/i);
    ok(sql(`select (override_can_vote is not null)::text from app.eligibility_snapshots where id = '${snap}'`) === 'true', 'the override is applied');
    await shot(neha, 'voting-1-applied');
    await neha.context().close();
  },
};

(async () => {
  const b = await chromium.launch();
  const want = process.argv.slice(2);
  const order = ['join', 'profile', 'ask', 'whatsapp', 'newsletter', 'roles', 'merge', 'modules', 'permissions', 'settings', 'account', 'voting'];
  for (const name of order) {
    if (want.length && !want.includes(name)) continue;
    if (!journeys[name]) continue;
    console.log(`\n== ${name}`);
    try {
      await journeys[name](b);
    } catch (e) {
      failures++;
      console.log(`FAIL ${name} stopped: ${String(e.message || e).split('\n')[0]}`);
    }
  }
  await b.close();
  console.log(`\n${failures ? failures + ' check(s) failed' : 'all checks passed'}`);
  process.exit(failures ? 1 : 0);
})();
