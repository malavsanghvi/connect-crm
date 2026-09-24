// Learning flows (Pathshala, Gyan Path, My Jain Way, Content, Niva, Governance) against a real
// local stack: portal (BASE) + member web app (MEMBER) + Mailpit (MAIL) + Postgres (DB).
//
//   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright BASE=http://localhost:3500 MEMBER=http://localhost:8600 \
//   MAIL=http://localhost:55724 API=http://localhost:55721 DB=postgres://postgres:postgres@localhost:55832/postgres \
//   ENVFILE=e2e/.env.w-learning node e2e/flows/w-learning.cjs            # ONLY=1,3 runs some journeys
//
// Every journey clicks through the real screens, then asserts the result in the database and the
// audit trail (module, client_app, client_screen). Test data it needs (a teen's own login, a local
// storage bucket) is created here, never in app code. Journeys are re-runnable on the same stack.
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3100';
const MEMBER = process.env.MEMBER || 'http://localhost:8200';
const MAIL = process.env.MAIL || 'http://localhost:55324';
const API = process.env.API || 'http://localhost:55321';
const DB = process.env.DB || 'postgres://postgres:postgres@localhost:55432/postgres';
const OUT = process.env.OUT || '/tmp/claude-0/streams/w-learning/flows';
const ONLY = (process.env.ONLY || '1,2,3,4,5,6,7').split(',').map(Number);
fs.mkdirSync(OUT, { recursive: true });
const env = Object.fromEntries(
  fs
    .readFileSync(process.env.ENVFILE || path.join(__dirname, '..', '.env.w-learning'), 'utf8')
    .split('\n')
    .filter((l) => /^\w+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]),
);
const CENTER = '00000000-0000-4000-8000-000000000001';
const P = { priya: 'd0000000-0000-4000-8000-000000000201', rahul: 'd0000000-0000-4000-8000-000000000202', dev: 'd0000000-0000-4000-8000-000000000203', anya: 'd0000000-0000-4000-8000-000000000204', tejal: 'd0000000-0000-4000-8000-000000000210' };
const RUN = Date.now().toString(36).slice(-5);

const sql = (q) => execSync(`psql "${DB}" -v ON_ERROR_STOP=1 -Atc "${q.replace(/"/g, '\\"')}"`).toString().trim();
/** SQL through stdin (for statements with $$ quoting). */
const sqlIn = (q) => execSync(`psql "${DB}" -v ON_ERROR_STOP=1 -At`, { input: q }).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (c, m) => {
  console.log(`${c ? 'PASS' : 'FAIL'} ${m}`);
  if (!c) failures += 1;
};
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }).catch(() => {});
/** The newest audit row for a table (optionally one record) as "client_app|client_screen|module|reason". */
const audit = (table, recordId, extra = '') =>
  sql(`select coalesce(client_app,'')||'|'||coalesce(client_screen,'')||'|'||coalesce(module,'')||'|'||coalesce(reason,'') from app.audit_log
       where record_table='${table}' ${recordId ? `and record_id='${recordId}'` : ''} ${extra} order by id desc limit 1`);

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
  throw new Error('no sign-in code for ' + email);
}

/** A login for a demo person (test data: supabase/demo/grant-login.sql, as e2e/up.sh does). */
function ensureLogin(email, member, roles = '') {
  execSync(
    `curl -s -o /dev/null -X POST "${API}/auth/v1/admin/users" -H "apikey: ${env.SERVICE_KEY}" -H "Authorization: Bearer ${env.SERVICE_KEY}" -H "Content-Type: application/json" -d '{"email":"${email}","email_confirm":true}'`,
  );
  execSync(`psql "${DB}" -q -v email="${email}" -v member="${member}" -v roles="${roles}" -f "${path.join(__dirname, '..', '..', 'supabase', 'demo', 'grant-login.sql')}"`, { stdio: 'pipe' });
}

/** An access token for API-level checks (forbidden actions must fail cleanly in the database). */
async function token(email) {
  const t0 = Date.now() - 2000;
  const r = await fetch(`${API}/auth/v1/otp`, { method: 'POST', headers: { apikey: env.ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, create_user: false }) });
  if (!r.ok) throw new Error('otp request failed ' + r.status + ' ' + (await r.text()));
  const c = await code(email, t0);
  const v = await fetch(`${API}/auth/v1/verify`, { method: 'POST', headers: { apikey: env.ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, token: c, type: 'email' }) }).then((x) => x.json());
  if (!v.access_token) throw new Error('verify failed ' + JSON.stringify(v));
  return v.access_token;
}
/** PostgREST call in the app schema as a signed-in user. */
async function rest(tok, method, pathAndQuery, body) {
  const r = await fetch(`${API}/rest/v1/${pathAndQuery}`, {
    method,
    headers: { apikey: env.ANON_KEY, Authorization: `Bearer ${tok}`, 'content-type': 'application/json', 'Accept-Profile': 'app', 'Content-Profile': 'app', Prefer: 'return=representation', 'x-client-app': 'job' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: r.status, json };
}

async function portalLogin(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(`  [portal ${email}] pageerror: ${String(e).slice(0, 200)}`));
  await p.goto(BASE + '/login');
  const t0 = Date.now() - 2000;
  await p.fill('input[name=email]', email);
  await p.click('button[type=submit]');
  await p.waitForSelector('input[name=code]', { timeout: 30000 });
  await p.fill('input[name=code]', await code(email, t0));
  await p.click('button[type=submit]');
  await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 });
  return p;
}

async function memberLogin(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(`  [member ${email}] pageerror: ${String(e).slice(0, 200)}`));
  if (process.env.VERBOSE) p.on('console', (m) => m.type() === 'error' && console.log(`  [member ${email}] console: ${m.text().slice(0, 300)}`));
  await p.goto(MEMBER + '/sign-in', { waitUntil: 'networkidle' });
  const t0 = Date.now() - 2000;
  await p.fill('input[placeholder="name@example.com"]', email);
  await p.getByRole('button', { name: /send|code|continue/i }).first().click();
  const box = p.locator('input[inputmode=numeric], input[autocomplete=one-time-code]').first();
  await box.waitFor({ timeout: 30000 });
  await box.fill(await code(email, t0));
  const verify = p.getByRole('button', { name: /verify|sign in|continue/i }).first();
  if (await verify.isVisible().catch(() => false)) await verify.click();
  await p.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 60000 });
  await p.waitForTimeout(2500);
  return p;
}
/** Open a member route and wait for the screen to settle. */
async function mgo(p, route) {
  await p.goto(MEMBER + route, { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(1500);
}
/** Open a portal route. */
async function pgo(p, route) {
  await p.goto(BASE + route, { waitUntil: 'networkidle', timeout: 120000 });
}
/** Submit the portal form that holds `scope` and wait for its status line. */
async function submitIn(p, scope, name) {
  await scope.getByRole('button', { name }).first().click();
  await p.waitForTimeout(2500);
}
async function pickPerson(p, scope, query, label) {
  await scope.getByPlaceholder(/type a name/i).first().fill(query);
  await p.waitForTimeout(1500);
  await p.getByRole('option', { name: new RegExp(label, 'i') }).first().click().catch(async () => {
    await scope.getByRole('button', { name: new RegExp(label, 'i') }).first().click();
  });
}

// ---------------------------------------------------------------------------
// 1. Pathshala: term → class → teacher → enroll the Shah children → attendance (sheet + QR) → Learn
// ---------------------------------------------------------------------------
async function journeyPathshala(browser) {
  console.log('\n# 1. Pathshala term, class, enrollment and attendance');
  const TERM = `Spring 2027 ${RUN}`;
  const CLASS = `Jainism 2 – Room D ${RUN}`;
  const admin = await portalLogin(browser, 'admin@jsh.test');

  // Term
  await pgo(admin, '/pathshala/terms');
  await admin.getByRole('button', { name: 'New term' }).click();
  const drawer = admin.getByRole('dialog');
  await drawer.getByLabel('Term name').fill(TERM);
  await drawer.getByLabel('Status').selectOption('registration');
  await drawer.getByLabel('First day').fill('2027-01-10');
  await drawer.getByLabel('Last day').fill('2027-05-30');
  await drawer.getByLabel('Fee per child ($)').fill('0');
  await submitIn(admin, drawer, 'Create term');
  const termId = sql(`select id from app.pathshala_terms where name='${TERM}'`);
  ok(!!termId, `term "${TERM}" created`);
  ok(audit('pathshala_terms', termId).startsWith('portal|/pathshala/terms|pathshala|'), 'term audit row: portal · /pathshala/terms · pathshala');

  // Class in that term
  await pgo(admin, `/pathshala?term=${termId}`);
  await admin.getByRole('button', { name: 'New class' }).click();
  const cd = admin.getByRole('dialog');
  await cd.locator('select[name=level_id]').selectOption({ label: 'Jainism 2' });
  await cd.locator('input[name=name]').fill(CLASS);
  await cd.locator('input[name=capacity]').fill('12');
  await cd.locator('input[name=starts_time]').fill('10:00');
  await cd.locator('input[name=ends_time]').fill('11:30');
  await submitIn(admin, cd, 'Create class');
  const classId = sql(`select id from app.pathshala_classes where name='${CLASS}'`);
  ok(!!classId, `class "${CLASS}" created`);
  await shot(admin, '1-classes');

  // Teacher Tejal on the class (also grants her class-scoped teacher role)
  await pgo(admin, `/pathshala/classes/${classId}`);
  const tform = admin.locator('form').filter({ has: admin.getByRole('button', { name: 'Add teacher' }) });
  await pickPerson(admin, tform, 'Tejal', 'Tejal');
  await submitIn(admin, tform, 'Add teacher');
  ok(sql(`select count(*) from app.pathshala_teachers where class_id='${classId}' and person_id='${P.tejal}'`) === '1', 'Tejal assigned to the class');
  ok(sql(`select count(*) from app.role_grants g join app.center_users cu on cu.user_id=g.user_id where cu.person_id='${P.tejal}' and g.scope_id='${classId}' and g.ends_at is null`) === '1', 'teacher role granted for the class');

  // Staff enroll Dev directly into the class
  await pgo(admin, `/pathshala/enrollments?term=${termId}`);
  await admin.getByRole('button', { name: 'Enroll a student' }).click();
  const ed = admin.getByRole('dialog');
  await pickPerson(admin, ed, 'Dev', 'Dev Shah');
  await ed.locator('select[name=class_id]').selectOption({ index: 1 });
  await submitIn(admin, ed, 'Enroll');
  const devEnr = sql(`select id||'|'||status from app.pathshala_enrollments where term_id='${termId}' and student_person_id='${P.dev}'`);
  ok(devEnr.endsWith('|placed'), 'Dev enrolled and placed by staff: ' + devEnr);

  // Parent asks for Anya from the member app; the office places her
  const priya = await memberLogin(browser, 'priya@jsh.test');
  await mgo(priya, '/pathshala-enroll');
  await shot(priya, '1-enroll-request');
  if ((await priya.getByRole('checkbox', { name: TERM }).count()) > 0) await priya.getByRole('checkbox', { name: TERM }).first().click();
  await priya.getByRole('checkbox', { name: 'Anya' }).first().click();
  await priya.getByRole('checkbox', { name: 'Jainism 2' }).first().click();
  await priya.getByRole('button', { name: 'Send request' }).click();
  await priya.waitForTimeout(2500);
  const anya = sql(`select id||'|'||status from app.pathshala_enrollments where term_id='${termId}' and student_person_id='${P.anya}'`);
  ok(anya.endsWith('|requested'), 'Anya requested from the member app: ' + anya);
  const anyaId = anya.split('|')[0];
  ok(audit('pathshala_enrollments', anyaId).startsWith('member|/pathshala-enroll|pathshala|'), 'enrollment request audit row: member · /pathshala-enroll');
  await shot(priya, '1-enroll-sent');

  await pgo(admin, `/pathshala/enrollments?term=${termId}&status=requested`);
  const row = admin.locator('tr').filter({ hasText: 'Anya' });
  await row.locator('select[name=class_id]').selectOption({ label: new RegExp(CLASS.replace(/[()]/g, '.')) }).catch(async () => {
    const opt = await row.locator('select[name=class_id] option').filter({ hasText: CLASS }).first().getAttribute('value');
    await row.locator('select[name=class_id]').selectOption(opt);
  });
  await row.getByRole('button', { name: 'Place' }).click();
  await admin.waitForTimeout(2500);
  ok(sql(`select status from app.pathshala_enrollments where id='${anyaId}'`) === 'placed', 'office placed Anya in the class');

  // Teacher takes attendance: Dev on the sheet, then shows the QR; Priya redeems it for Anya
  const teacher = await portalLogin(browser, 'teacher@jsh.test');
  await pgo(teacher, '/pathshala/my-classes');
  ok((await teacher.getByText(CLASS).count()) > 0, 'teacher sees the new class under My classes');
  await pgo(teacher, `/pathshala/classes/${classId}/attendance`);
  const devCard = teacher.locator('li').filter({ hasText: 'Dev' });
  await devCard.getByRole('button', { name: 'Present' }).click();
  await teacher.waitForTimeout(2500);
  const devMark = sql(`select a.status||'|'||a.marked_via from app.pathshala_attendance a join app.pathshala_enrollments e on e.id=a.enrollment_id where e.student_person_id='${P.dev}' and e.class_id='${classId}'`);
  ok(devMark === 'present|teacher', 'teacher marked Dev present on the sheet: ' + devMark);
  await teacher.getByRole('button', { name: /Show QR/ }).click();
  await teacher.waitForTimeout(3000);
  await shot(teacher, '1-attendance-qr');
  const sess = sql(`select id||'|'||attendance_token from app.pathshala_sessions where class_id='${classId}' and attendance_token is not null order by held_on desc limit 1`);
  const [sessionId, tok] = sess.split('|');
  ok(!!tok, 'QR session opened with a token');

  await mgo(priya, `/pathshala-scan?person=${P.anya}`);
  await priya.getByLabel('Class code').fill(`connect:pathshala-attendance?session=${sessionId}&token=${tok}`);
  await priya.getByRole('button', { name: 'Mark attendance' }).click();
  await priya.waitForTimeout(3000);
  await shot(priya, '1-scan-done');
  const anyaMark = sql(`select a.status||'|'||a.marked_via from app.pathshala_attendance a where a.enrollment_id='${anyaId}'`);
  ok(/^(present|late)\|qr$/.test(anyaMark), 'Anya marked through redeem_attendance_qr: ' + anyaMark);
  ok(audit('pathshala_attendance', null, `and after->>'enrollment_id'='${anyaId}'`).startsWith('member|/pathshala-scan|pathshala|'), 'QR attendance audit row: member · /pathshala-scan');

  // The teacher publishes a progress report for Anya
  await pgo(teacher, `/pathshala/classes/${classId}/reports?period=${encodeURIComponent('Mid-term ' + RUN)}`);
  const anyaCard = teacher.locator('section').filter({ hasText: 'Anya Shah' });
  await anyaCard.locator('textarea[name=teacher_comments]').fill('Learns the Navkar with care');
  await anyaCard.getByRole('button', { name: 'Publish to family' }).click();
  await teacher.waitForTimeout(2500);
  const rep = sql(`select period||'|'||attendance_present||'|'||attendance_total||'|'||(published_at is not null)::text from app.pathshala_progress_reports where enrollment_id='${anyaId}'`);
  ok(rep === `Mid-term ${RUN}|${anyaMark.startsWith('present') ? 1 : 0}|1|true`, 'progress report published with attendance from the register: ' + rep);
  ok(audit('pathshala_progress_reports').startsWith(`portal|/pathshala/classes/${classId}/reports|pathshala|`), 'progress report audit row: portal · class reports');
  await shot(teacher, '1-progress-report');

  // The parent sees it in Learn
  await mgo(priya, '/jain-way?tab=learn');
  const learn = await priya.innerText('body');
  ok(/Anya · Jainism 2\s+Placed in a class[\s\S]*?Last class [^\n]*: (present|late)/.test(learn), "Learn shows Anya's class and her last class attendance");
  ok(learn.includes(`Progress report · Mid-term ${RUN}`) && learn.includes('Learns the Navkar with care'), 'Learn shows the published progress report');
  await shot(priya, '1-learn');

  // Roles: a parent cannot place a child or mark attendance over the API
  const ptok = await token('priya@jsh.test');
  const place = await rest(ptok, 'PATCH', `pathshala_enrollments?id=eq.${anyaId}`, { status: 'active' });
  ok(Array.isArray(place.json) && place.json.length === 0, 'parent cannot change an enrollment status (RLS: 0 rows)');
  const mark = await rest(ptok, 'POST', 'pathshala_attendance', { center_id: CENTER, session_id: sessionId, enrollment_id: anyaId, status: 'present' });
  ok(mark.status >= 400, `parent cannot write attendance directly (HTTP ${mark.status})`);
  // A teacher cannot mark a class they don't teach
  const ttok = await token('teacher@jsh.test');
  const other = sql(`select id from app.pathshala_sessions where class_id='d0000000-0000-4000-8000-000000000303' limit 1`);
  if (other) {
    const tm = await rest(ttok, 'POST', 'pathshala_attendance', { center_id: CENTER, session_id: other, enrollment_id: anyaId, status: 'present' });
    ok(tm.status >= 400, `teacher cannot mark another class (HTTP ${tm.status})`);
  }
  await Promise.all([admin.context().close(), priya.context().close(), teacher.context().close()]);
  return { termId, classId };
}


// ---------------------------------------------------------------------------
// 2. Gyan Path: staff author a level → Dev (a teen with his own login) completes it → sign-off
// ---------------------------------------------------------------------------
async function journeyGyan(browser) {
  console.log('\n# 2. Gyan Path level, teacher sign-off, points');
  ensureLogin('dev@jsh.test', 'JSH-90003');
  const GOAL = `Learn Chattari Mangalam ${RUN}`;
  const admin = await portalLogin(browser, 'admin@jsh.test');
  await pgo(admin, '/content/gyan-path');
  await admin.getByRole('button', { name: 'New goal' }).click();
  let d = admin.getByRole('dialog');
  await d.getByLabel('Goal').fill(GOAL);
  await d.getByLabel('Description').fill('Four lines of refuge · one level');
  await submitIn(admin, d, 'Create goal');
  const goalId = sql(`select id from app.gyan_goals where name='${GOAL}'`);
  ok(!!goalId, 'goal created in Content › Gyan Path');
  await pgo(admin, `/content/gyan-path?goal=${goalId}`);
  await admin.getByRole('button', { name: 'Add level' }).click();
  d = admin.getByRole('dialog');
  await d.getByLabel('Level', { exact: true }).fill('Chattari Mangalam');
  await d.getByLabel('Points').fill('20');
  await d.getByLabel('Treasure reward').fill('Mangal badge');
  await d.getByRole('switch').first().click();
  await submitIn(admin, d, 'Add level');
  const levelId = sql(`select id from app.gyan_levels where goal_id='${goalId}'`);
  ok(sql(`select requires_teacher_signoff::text||'|'||points from app.gyan_levels where id='${levelId}'`) === 'true|20', 'level needs a teacher sign-off and is worth 20 points');
  const steps = [
    { kind: 'read', title: 'Meaning of the four mangals', points: '5' },
    { kind: 'quiz', title: 'Quick quiz', points: '5', q: 'How many mangals are named?', o: 'Two\nFour\nNine', a: '2' },
    { kind: 'recite', title: 'Recite Chattari Mangalam', points: '5' },
  ];
  for (const [i, st] of steps.entries()) {
    await pgo(admin, `/content/gyan-path?goal=${goalId}`);
    await admin.getByRole('button', { name: 'Steps' }).first().click();
    d = admin.getByRole('dialog');
    await d.getByLabel('Kind').selectOption(st.kind);
    await d.getByLabel('Title').fill(st.title);
    await d.getByLabel('Order').fill(String(i + 1));
    await d.getByLabel('Points').fill(st.points);
    if (st.q) {
      await d.getByLabel('Question').fill(st.q);
      await d.getByLabel('Answers, one per line').fill(st.o);
      await d.getByLabel('Right answer (line number)').fill(st.a);
    }
    await submitIn(admin, d, 'Add step');
  }
  ok(sql(`select count(*) from app.gyan_steps where level_id='${levelId}'`) === '3', 'three steps authored (learn, quiz with its question, recite)');
  ok(sql(`select quiz->'questions'->0->>'answer' from app.gyan_steps where level_id='${levelId}' and kind='quiz'`) === '1', 'quiz stored in the member app shape');
  ok(audit('gyan_steps').startsWith('portal|/content/gyan-path|gyan_path|'), 'step audit row: portal · /content/gyan-path · gyan_path');
  await shot(admin, '2-gyan-authoring');

  const pts = () => Number(sql(`select coalesce(sum(points),0) from app.points_ledger where person_id='${P.dev}'`));
  const before = pts();
  const dev = await memberLogin(browser, 'dev@jsh.test');
  await mgo(dev, '/gyan');
  await shot(dev, '2-goals');
  await dev.getByText(GOAL).first().click();
  await dev.waitForTimeout(2000);
  await shot(dev, '2-map');
  await dev.getByRole('button', { name: /Play level 1/ }).first().click();
  await dev.waitForTimeout(2000);
  await dev.getByRole('button', { name: 'Continue' }).click(); // learn
  await dev.waitForTimeout(2000);
  await dev.getByRole('radio', { name: /^Four/ }).first().click();
  await dev.getByRole('button', { name: 'Check' }).click();
  await dev.waitForTimeout(500);
  ok((await dev.getByText('Correct! Well done.').count()) > 0, 'quiz says Correct');
  await dev.getByRole('button', { name: 'Continue' }).click();
  await dev.waitForTimeout(2000);
  await shot(dev, '2-recite');
  await dev.getByRole('button', { name: 'Skip recitation for now' }).click();
  await dev.waitForTimeout(3000);
  await shot(dev, '2-level-complete');
  const done = await dev.innerText('body');
  ok(/LEVEL 1 COMPLETE/i.test(done) && done.includes('+15'), 'level-complete screen shows +15 points');
  ok(sql(`select count(*) from app.gyan_progress where person_id='${P.dev}' and completed_at is not null and step_id in (select id from app.gyan_steps where level_id='${levelId}')`) === '3', 'three steps recorded in gyan_progress');
  ok(pts() - before === 15, `step points credited (${pts() - before})`);
  ok(audit('gyan_progress').startsWith('member|/gyan/'), 'progress audit row from the member app');
  await dev.getByRole('button', { name: 'Request teacher sign-off' }).click();
  await dev.waitForTimeout(2500);
  ok(sql(`select status from app.gyan_signoffs where person_id='${P.dev}' and level_id='${levelId}'`) === 'requested', 'sign-off requested');

  const teacher = await portalLogin(browser, 'teacher@jsh.test');
  await pgo(teacher, '/pathshala/signoffs');
  await shot(teacher, '2-signoffs');
  const row = teacher.locator('tr, li').filter({ hasText: 'Dev' }).filter({ hasText: 'Chattari Mangalam' }).first();
  await row.getByRole('button', { name: 'Sign off' }).click();
  await teacher.waitForTimeout(2500);
  ok(sql(`select status from app.gyan_signoffs where person_id='${P.dev}' and level_id='${levelId}'`) === 'approved', 'teacher signed off');
  ok(pts() - before === 35, `sign-off points credited (total ${pts() - before} = 15 steps + 20 level)`);
  ok(audit('gyan_signoffs').startsWith('portal|/pathshala/signoffs|gyan_path|'), 'sign-off audit row: portal · /pathshala/signoffs');

  await mgo(dev, `/gyan/${goalId}`);
  const map = await dev.innerText('body');
  ok(/Signed off by your teacher/.test(map), 'the member sees the sign-off on the goal map');
  await shot(dev, '2-signed-off');

  // Roles: Dev cannot sign himself off; Priya (parent) cannot record progress in Dev's name
  const dtok = await token('dev@jsh.test');
  const self = await rest(dtok, 'PATCH', `gyan_signoffs?person_id=eq.${P.dev}&level_id=eq.${levelId}`, { status: 'approved' });
  ok(Array.isArray(self.json) && self.json.length === 0, 'a learner cannot approve their own sign-off (0 rows)');
  const ptok = await token('priya@jsh.test');
  const step = sql(`select id from app.gyan_steps where level_id='${levelId}' limit 1`);
  const forChild = await rest(ptok, 'POST', 'gyan_progress', { center_id: CENTER, person_id: P.anya, step_id: step, stars: 3, completed_at: new Date().toISOString() });
  ok(forChild.status >= 400, `progress can only be recorded by the learner (HTTP ${forChild.status})`);
  await Promise.all([admin.context().close(), dev.context().close(), teacher.context().close()]);
}

// ---------------------------------------------------------------------------
// 3. My Jain Way: log practices → bonus, streak, standing → un-log reverses → Saathi anumodana
// ---------------------------------------------------------------------------
async function journeyJainWay(browser) {
  console.log('\n# 3. My Jain Way practices, streak, bonus, standing, Saathi');
  ensureLogin('dev@jsh.test', 'JSH-90003');
  const today = sql(`select (now() at time zone time_zone)::date from app.centers where id='${CENTER}'`);
  const pts = (who) => Number(sql(`select coalesce(sum(points),0) from app.points_ledger where person_id='${who}'`));
  const streak = (who) => sql(`select coalesce((select current_days||'|'||coalesce(last_logged_on::text,'') from app.streaks where person_id='${who}'),'0|')`);
  const bonus = Number(sql(`select coalesce((rules->'points'->>'day_complete_bonus')::int, 20) from app.centers where id='${CENTER}'`));
  const mine = sql(`select pr.name||'~'||pr.points from app.practice_selections ps join app.practices pr on pr.id=ps.practice_id where ps.person_id='${P.priya}' order by pr.name`).split('\n').map((l) => { const [name, p] = l.split('~'); return { name, points: Number(p) }; });
  const priya = await memberLogin(browser, 'priya@jsh.test');
  await mgo(priya, '/jain-way');
  // Start from a clean day: un-tick anything already done today (exercises unlog_practice)
  for (const pr of mine) {
    const doneBox = priya.getByRole('checkbox', { name: `${pr.name} is done. Tap to unmark` });
    if (await doneBox.count()) { await doneBox.first().click(); await priya.waitForTimeout(1500); }
  }
  ok(sql(`select count(*) from app.practice_logs where person_id='${P.priya}' and logged_on='${today}'`) === '0', 'no practices logged today before the journey');
  const p0 = pts(P.priya);
  const s0 = streak(P.priya);
  for (const pr of mine) {
    await priya.getByRole('checkbox', { name: `Mark ${pr.name} done` }).first().click();
    await priya.waitForTimeout(1500);
  }
  const sum = mine.reduce((a, b) => a + b.points, 0);
  const p1 = pts(P.priya);
  ok(p1 - p0 === sum + bonus, `all ${mine.length} practices: +${sum} practice points and +${bonus} completion bonus (got +${p1 - p0})`);
  const s1 = streak(P.priya);
  ok(s1.endsWith('|' + today) && Number(s1.split('|')[0]) >= 1, `streak extended to today (${s0} → ${s1})`);
  const body = await priya.innerText('body');
  ok(body.includes(`${mine.length} of ${mine.length} done`) && body.includes('Day complete · anumodana!') && body.includes(`+${bonus} completion bonus`), 'Today shows the day complete with the bonus');
  // Standing: counts match the RPC; percentiles stay private until a category has 10 people
  const standing = sql(`select category||'~'||coalesce(top_percent::text,'-')||'~'||practices_count||'~'||done_today from app.my_practice_standing('${P.priya}') s`);
  ok(standing === '' || !/~-~\d+~0$/m.test(standing), 'standing RPC counts today\'s logs per category');
  const standingText = body.slice(body.indexOf('Your standing this month'));
  const cats = standing.split('\n').filter(Boolean).map((l) => l.split('~'));
  ok(cats.every(([, top, n, k]) => standingText.includes(`${n} practice${n === '1' ? '' : 's'} in your Jain Way · ${k} done today`) && (top === '-' ? standingText.includes('Too few people yet') : standingText.includes(`Top ${top}%`))), 'standing card matches my_practice_standing (counts, and "Too few people yet" when suppressed)');
  await shot(priya, '3-today-complete');
  ok(audit('practice_logs').startsWith('member|/jain-way|jain_way|'), 'practice log audit row: member · /jain-way · jain_way');

  // Un-log one: its points and the day bonus are reversed, the streak steps back
  const first = mine[0];
  await priya.getByRole('checkbox', { name: `${first.name} is done. Tap to unmark` }).first().click();
  await priya.waitForTimeout(2000);
  ok(p1 - pts(P.priya) === first.points + bonus, `un-logging ${first.name} reverses ${first.points} + ${bonus} bonus`);
  ok(streak(P.priya) === s0 || Number(streak(P.priya).split('|')[0]) === Number(s1.split('|')[0]) - 1, `streak steps back (${streak(P.priya)})`);
  await priya.getByRole('checkbox', { name: `Mark ${first.name} done` }).first().click();
  await priya.waitForTimeout(2000);
  ok(pts(P.priya) === p1 && streak(P.priya) === s1, 're-logging restores the points and the streak');

  // Dev picks a practice and completes his day; the family circle sees it
  const dev = await memberLogin(browser, 'dev@jsh.test');
  await mgo(dev, '/jain-way');
  const devPractice = sql(`select name from app.practices where (center_id='${CENTER}' or center_id is null) and active order by sort_order limit 1`);
  if (!(await dev.getByRole('checkbox', { name: new RegExp(`^(Mark )?${devPractice}`) }).count())) {
    await dev.getByRole('button', { name: /Add or remove practices|Choose practices/ }).first().click();
    await dev.waitForTimeout(800);
    await dev.getByRole('button', { name: `Add: ${devPractice}` }).first().click();
    await dev.waitForTimeout(1500);
    await dev.getByRole('button', { name: /Done adding/ }).first().click().catch(() => {});
    await dev.waitForTimeout(800);
  }
  const devDone = dev.getByRole('checkbox', { name: `Mark ${devPractice} done` });
  if (await devDone.count()) { await devDone.first().click(); await dev.waitForTimeout(2000); }
  ok(sql(`select count(*) from app.practice_logs where person_id='${P.dev}' and logged_on='${today}'`) !== '0', 'Dev logged a practice today');

  await mgo(priya, '/jain-way?tab=saathi');
  await shot(priya, '3-saathi');
  const ptok = await token('priya@jsh.test');
  const feedRes = await rest(ptok, 'POST', 'rpc/saathi_feed', { p_household: 'd0000000-0000-4000-8000-000000000101' });
  const feed = (Array.isArray(feedRes.json) ? feedRes.json : []).map((f) => `${f.kind}:${f.person_name}`).join(',');
  ok(/daily_goal_met:Dev/.test(feed), `saathi_feed (as Priya) has Dev's daily goal: ${feed}`);
  ok((await priya.getByText(/Dev/).count()) > 0 && (await priya.innerText('body')).includes('Dev met the daily goal'), "Saathi shows Dev's milestone card");
  const sendBtn = priya.getByRole('button', { name: /Send anumodana · \+5 points/ });
  const cards = await sendBtn.count();
  ok(cards > 0 || (await priya.getByText('Anumodana sent ✓').count()) > 0, 'Saathi shows celebration cards with Send anumodana');
  if (cards > 0) {
    const before = pts(P.priya);
    const sentBefore = Number(sql(`select count(*) from app.anumodana where from_person_id='${P.priya}'`));
    await sendBtn.first().click();
    await priya.waitForTimeout(2500);
    ok(Number(sql(`select count(*) from app.anumodana where from_person_id='${P.priya}'`)) === sentBefore + 1, 'anumodana recorded');
    const capHit = Number(sql(`select count(*) from app.points_ledger where person_id='${P.priya}' and reason='anumodana_sent' and occurred_at::date=current_date`)) > 5;
    ok(pts(P.priya) - before === 5 || capHit, `+5 points credited to the sender (${pts(P.priya) - before})`);
    ok((await priya.getByText('Anumodana sent ✓').count()) > 0, 'the card turns into "Anumodana sent ✓"');
    ok(audit('anumodana').startsWith('member|/jain-way|jain_way|'), 'anumodana audit row: member · /jain-way');
  }
  await shot(priya, '3-saathi-sent');

  // Roles: nobody logs for someone else through the API, or credits themselves points
  const direct = await rest(ptok, 'POST', 'points_ledger', { center_id: CENTER, person_id: P.priya, points: 1000, reason: 'practice' });
  ok(direct.status >= 400, `a member cannot write points directly (HTTP ${direct.status})`);
  const other = await rest(ptok, 'POST', 'rpc/send_anumodana', { p_center: CENTER, p_to: 'd0000000-0000-4000-8000-000000000205', p_kind: 'celebrate', p_message: null });
  ok(other.status >= 400 && /family circle/i.test(JSON.stringify(other.json)), 'anumodana outside the family circle is refused in plain English');
  await Promise.all([priya.context().close(), dev.context().close()]);
}

// ---------------------------------------------------------------------------
// 4. Content: draft → approval queue → approved → member Library; return with a reason;
//    a member photo upload is moderated before anyone else sees it
// ---------------------------------------------------------------------------
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
async function storageBucket(id) {
  const r = await fetch(`${API}/storage/v1/bucket/${id}`, { headers: { apikey: env.SERVICE_KEY, Authorization: `Bearer ${env.SERVICE_KEY}` } });
  return r.ok;
}
async function journeyContent(browser) {
  console.log('\n# 4. Content approval, Library, photo moderation');
  const TITLE = `Tivihar ${RUN}`;
  const admin = await portalLogin(browser, 'admin@jsh.test');
  await pgo(admin, '/content/library');
  await admin.getByRole('button', { name: 'Add pachchakhan' }).click();
  let d = admin.getByRole('dialog');
  await d.getByLabel('Title').fill(TITLE);
  await d.getByLabel('Timing rule').fill('From sunset until sunrise');
  await d.getByLabel('Sutra text').fill('Divasa charimam pachchakkhai…');
  await d.getByRole('button', { name: 'Send for approval' }).click();
  await admin.waitForTimeout(2500);
  const itemId = sql(`select id from app.content_items where title='${TITLE}'`);
  ok(sql(`select status from app.content_items where id='${itemId}'`) === 'in_review', 'draft sent for approval (in_review)');
  await pgo(admin, '/content/queue');
  const qrow = admin.locator('tr').filter({ hasText: TITLE });
  ok((await qrow.count()) === 1, 'the item is in the approval queue');
  await shot(admin, '4-queue');
  // Priya cannot see it yet
  const priya = await memberLogin(browser, 'priya@jsh.test');
  await mgo(priya, '/jain-way?tab=library');
  ok(!(await priya.innerText('body')).includes(TITLE), 'members do not see an unapproved item');
  await qrow.getByRole('button', { name: 'Approve' }).click();
  await admin.waitForTimeout(2500);
  ok(sql(`select status||'|'||(approved_by is not null)::text||'|'||(published_at is not null)::text from app.content_items where id='${itemId}'`) === 'published|true|true', 'approved: published, with approver and time');
  ok(audit('content_items', itemId).startsWith('portal|/content/queue|content|'), 'approval audit row: portal · /content/queue · content');
  await mgo(priya, '/jain-way?tab=library');
  ok((await priya.innerText('body')).includes(TITLE), 'the member Library shows the approved pachchakhan');
  await shot(priya, '4-library');

  // Return with a reason
  const RET = `Chauvihar note ${RUN}`;
  await pgo(admin, '/content/library');
  await admin.getByRole('button', { name: 'Add pachchakhan' }).click();
  d = admin.getByRole('dialog');
  await d.getByLabel('Title').fill(RET);
  await d.getByRole('button', { name: 'Send for approval' }).click();
  await admin.waitForTimeout(2500);
  const retId = sql(`select id from app.content_items where title='${RET}'`);
  await pgo(admin, '/content/queue');
  await admin.locator('tr').filter({ hasText: RET }).getByRole('button', { name: 'Return' }).click();
  d = admin.getByRole('dialog');
  await d.getByLabel('What should the author change?').fill('Add the sutra text and its timing rule');
  await d.getByRole('button', { name: 'Return to author' }).click();
  await admin.waitForTimeout(2500);
  ok(sql(`select status from app.content_items where id='${retId}'`) === 'draft', 'returned item is back to draft');
  ok(audit('content_items', retId) === 'portal|/content/queue|content|Add the sutra text and its timing rule', 'return audit row carries the reason');

  // Photos: album → member upload (honest while storage is missing) → moderation → visible
  const ALBUM = `Paryushan ${RUN}`;
  await pgo(admin, '/content/photos');
  await admin.getByRole('button', { name: 'New album' }).click();
  d = admin.getByRole('dialog');
  await d.getByLabel('Album', { exact: true }).fill(ALBUM);
  await submitIn(admin, d, 'Create album');
  const albumId = sql(`select id from app.photo_albums where title='${ALBUM}'`);
  ok(!!albumId, 'album created');
  const file = `${OUT}/e2e-photo.png`;
  fs.writeFileSync(file, PNG);
  const upload = async () => {
    await mgo(priya, `/album/${albumId}`);
    const [chooser] = await Promise.all([priya.waitForEvent('filechooser', { timeout: 15000 }), priya.getByRole('button', { name: 'Add yours' }).click()]);
    await chooser.setFiles(file);
    await priya.getByRole('button', { name: 'Yes, children are in them' }).click();
    await priya.waitForTimeout(3500);
  };
  if (!(await storageBucket('photos'))) {
    await upload();
    const t = await priya.innerText('body');
    ok(/aren't set up for your community yet/.test(t), 'without the photos bucket the member is told plainly that uploads are not set up');
    ok(sql(`select count(*) from app.photos where album_id='${albumId}'`) === '0', 'nothing half-saved when the upload failed');
    await shot(priya, '4-upload-no-bucket');
    // LOCAL TEST STACK ONLY: the real bucket and its policies are an owner decision (docs/MODULES.md).
    await fetch(`${API}/storage/v1/bucket`, { method: 'POST', headers: { apikey: env.SERVICE_KEY, Authorization: `Bearer ${env.SERVICE_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'photos', name: 'photos', public: false }) });
    sqlIn(`do $$ begin
      if not exists (select 1 from pg_policies where schemaname='storage' and policyname='e2e_photos_rw') then
        create policy e2e_photos_rw on storage.objects for all to authenticated using (bucket_id = 'photos') with check (bucket_id = 'photos');
      end if; end $$`);
  }
  await upload();
  await shot(priya, '4-upload-sent');
  const ph = sql(`select id||'|'||status||'|'||contains_children::text from app.photos where album_id='${albumId}' order by created_at desc limit 1`);
  ok(/\|pending\|true$/.test(ph), 'member photo saved as pending, marked as showing children: ' + ph);
  const photoId = ph.split('|')[0];
  ok(audit('photos', photoId).startsWith('member|/album/'), 'upload audit row from the member app');
  const rahulSees = sql(`select count(*) from app.photos where id='${photoId}' and status='approved'`);
  ok(rahulSees === '0', 'nobody else sees it before moderation (status pending)');
  await pgo(admin, `/content/photos/${albumId}?status=pending`);
  await shot(admin, '4-moderation');
  await admin.getByRole('button', { name: 'Approve' }).first().click();
  await admin.waitForTimeout(2500);
  ok(sql(`select status||'|'||(moderated_by is not null)::text from app.photos where id='${photoId}'`) === 'approved|true', 'staff approved the photo');
  ok(audit('photos', photoId).startsWith('portal|/content/photos/'), 'moderation audit row: portal · /content/photos');
  await mgo(priya, `/album/${albumId}`);
  ok(!(await priya.innerText('body')).includes('In review'), 'the album no longer marks the photo as in review');
  await shot(priya, '4-album');

  // Roles: a member cannot publish content or approve their own photo
  const ptok = await token('priya@jsh.test');
  const pub = await rest(ptok, 'PATCH', `content_items?id=eq.${retId}`, { status: 'published' });
  ok(Array.isArray(pub.json) && pub.json.length === 0, 'a member cannot publish content (0 rows)');
  const selfApprove = await rest(ptok, 'PATCH', `photos?id=eq.${photoId}`, { status: 'approved' });
  ok(Array.isArray(selfApprove.json) && selfApprove.json.length === 0, 'a member cannot moderate photos (0 rows)');
  await Promise.all([admin.context().close(), priya.context().close()]);
}

// ---------------------------------------------------------------------------
// 5. Niva: a member's question is saved honestly and reaches the portal as unanswered
// ---------------------------------------------------------------------------
async function journeyNiva(browser) {
  console.log('\n# 5. Niva question → portal unanswered');
  const Q = `When is Samvatsari pratikraman this year? ${RUN}`;
  const priya = await memberLogin(browser, 'priya@jsh.test');
  await mgo(priya, '/niva');
  await priya.getByLabel('Message Niva').fill(Q);
  await priya.getByRole('button', { name: 'Send' }).click();
  await priya.waitForTimeout(3000);
  const t = await priya.innerText('body');
  ok(t.includes("I can't answer yet") && t.includes('saved your question'), 'Niva says honestly it cannot answer yet and saved the question');
  await shot(priya, '5-niva');
  const row = sql(`select unanswered::text||'|'||coalesce(answer,'') from app.niva_conversations where question='${Q}'`);
  ok(row === 'true|', 'question saved as unanswered with no answer');
  ok(audit('niva_conversations').startsWith('member|/niva|niva|'), 'Niva audit row: member · /niva · niva');
  const admin = await portalLogin(browser, 'admin@jsh.test');
  await pgo(admin, '/content/niva');
  ok((await admin.locator('tr').filter({ hasText: Q }).count()) === 1, 'the portal lists it under Unanswered questions this week');
  await shot(admin, '5-niva-portal');
  // A member cannot read someone else's questions
  const ktok = await token('kiran@jsh.test');
  const peek = await rest(ktok, 'GET', `niva_conversations?question=eq.${encodeURIComponent(Q)}`);
  ok(Array.isArray(peek.json) && peek.json.length === 0, "another member cannot read Priya's question");
  await Promise.all([admin.context().close(), priya.context().close()]);
}

// ---------------------------------------------------------------------------
// 6. Governance: propose → comments → voting → a committee member votes with a reason
// ---------------------------------------------------------------------------
async function journeyGovernance(browser) {
  console.log('\n# 6. Committee resolution vote');
  const TITLE = `Hold Pathshala on Diwali Sunday ${RUN}`;
  const admin = await portalLogin(browser, 'admin@jsh.test');
  await pgo(admin, '/pathshala/committee/resolutions');
  const form = admin.locator('form').filter({ has: admin.getByRole('button', { name: 'Create' }) });
  await form.getByLabel('Title').fill(TITLE);
  await form.getByLabel('Resolution text').fill('Classes meet as usual on the Sunday before Diwali.');
  await form.getByLabel('Why').fill('Families asked to keep the routine.');
  await form.getByLabel('Quorum (ballots needed)').fill('1');
  await submitIn(admin, form, 'Create');
  await admin.waitForTimeout(2000);
  const rid = sql(`select id from app.resolutions where title='${TITLE}'`);
  ok(!!rid, 'resolution proposed');
  const today = sql(`select (now() at time zone time_zone)::date from app.centers where id='${CENTER}'`);
  const week = sql(`select ((now() at time zone time_zone)::date + 7) from app.centers where id='${CENTER}'`);
  await pgo(admin, `/pathshala/committee/resolutions/${rid}`);
  let f = admin.locator('form').filter({ has: admin.getByRole('button', { name: 'Open comments' }) });
  await f.locator('input[name=start]').fill(today);
  await f.locator('input[name=end]').fill(week);
  await submitIn(admin, f, 'Open comments');
  const cf = admin.locator('form').filter({ has: admin.locator('textarea[name=body]') }).first();
  if (await cf.count()) {
    await cf.locator('textarea[name=body]').fill('Support — the kids look forward to it.');
    await cf.getByRole('button').first().click();
    await admin.waitForTimeout(2000);
  }
  admin.once('dialog', (dl) => dl.accept());
  await admin.getByRole('button', { name: 'Close now' }).first().click();
  await admin.waitForTimeout(1000);
  const confirm = admin.getByRole('dialog').getByRole('button', { name: /close now|confirm|yes/i });
  if (await confirm.count()) await confirm.first().click();
  await admin.waitForTimeout(2500);
  ok(sql(`select comment_status from app.resolutions where id='${rid}'`) === 'completed', 'comment period closed');
  await pgo(admin, `/pathshala/committee/resolutions/${rid}`);
  f = admin.locator('form').filter({ has: admin.getByRole('button', { name: 'Open voting' }) });
  await f.locator('input[name=start]').fill(today);
  await f.locator('input[name=end]').fill(week);
  await submitIn(admin, f, 'Open voting');
  ok(sql(`select voting_status from app.resolutions where id='${rid}'`) === 'started', 'voting opened');
  await pgo(admin, `/pathshala/committee/resolutions/${rid}`);
  const vf = admin.locator('form').filter({ has: admin.getByRole('button', { name: /Cast my vote/ }) });
  await vf.locator('input[name=vote][value=yes]').check();
  await vf.locator('input[name=reason]').fill('Routine matters for the children');
  await submitIn(admin, vf, /Cast my vote/);
  ok(sql(`select vote||'|'||coalesce(reason,'') from app.resolution_votes where resolution_id='${rid}'`) === 'yes|Routine matters for the children', 'ballot recorded: yes, with the reason');
  ok(audit('resolution_votes') === `portal|/pathshala/committee/resolutions/${rid}|governance|Routine matters for the children`, 'ballot audit row carries module governance and the reason');
  await shot(admin, '6-resolution');
  // Roles: a plain member cannot vote or read resolutions over the API
  const ptok = await token('priya@jsh.test');
  const read = await rest(ptok, 'GET', `resolutions?id=eq.${rid}`);
  ok(Array.isArray(read.json) && read.json.length === 0, 'a member cannot read committee resolutions');
  const uid = sql(`select user_id from app.center_users where person_id='${P.priya}'`);
  const vote = await rest(ptok, 'POST', 'resolution_votes', { center_id: CENTER, resolution_id: rid, voter_user: uid, vote: 'no' });
  ok(vote.status >= 400, `a member cannot vote (HTTP ${vote.status})`);
  await admin.context().close();
}

// ---------------------------------------------------------------------------
// 7. Module switches: each learning module off → portal hides it, member app hides it, the API
//    refuses it → back on. Switched with a reason through app.set_module_enabled (audited).
// ---------------------------------------------------------------------------
async function journeyModules(browser) {
  console.log('\n# 7. Module switches (pathshala, gyan_path, jain_way, content, niva, governance)');
  const atok = await token('admin@jsh.test');
  const ptok = await token('priya@jsh.test');
  const set = async (key, on, why) => {
    const r = await rest(atok, 'POST', 'rpc/set_module_enabled', { p_center: CENTER, p_module: key, p_enabled: on, p_reason: why });
    if (r.status >= 300) throw new Error(`switching ${key} ${on ? 'on' : 'off'} failed: ${JSON.stringify(r.json)}`);
  };
  const admin = await portalLogin(browser, 'admin@jsh.test');
  const priya = await memberLogin(browser, 'priya@jsh.test');
  const off = /switched off/i;
  const cases = [
    {
      key: 'pathshala', portal: '/pathshala/enrollments', member: '/pathshala-enroll', memberText: /Pathshala isn't offered/,
      api: async () => { const r = await rest(ptok, 'POST', 'rpc/redeem_attendance_qr', { p_session: sql(`select id from app.pathshala_sessions limit 1`), p_token: 'x' }); return r.status >= 400 && /switched off/i.test(JSON.stringify(r.json)); },
    },
    {
      key: 'gyan_path', portal: '/content/gyan-path', member: '/gyan', memberText: /isn't offered/,
      api: async () => { const r = await rest(ptok, 'GET', `gyan_goals?center_id=eq.${CENTER}`); return Array.isArray(r.json) && r.json.length === 0; },
    },
    {
      key: 'jain_way', portal: '/content/practices', member: '/jain-way', memberText: null,
      api: async () => { const r = await rest(ptok, 'POST', 'rpc/log_practice', { p_center: CENTER, p_practice: sql(`select practice_id from app.practice_selections where person_id='${P.priya}' limit 1`) }); return r.status >= 400 && /switched off/i.test(JSON.stringify(r.json)); },
    },
    {
      key: 'niva', portal: '/content/niva', member: '/niva', memberText: /isn't offered/,
      api: async () => { const uid = sql(`select user_id from app.center_users where person_id='${P.priya}'`); const r = await rest(ptok, 'POST', 'niva_conversations', { center_id: CENTER, user_id: uid, question: 'while off?', unanswered: true }); return r.status >= 400; },
    },
    {
      key: 'content', before: ['niva'], portal: '/content/library', member: `/album/${sql(`select id from app.photo_albums where center_id='${CENTER}' order by created_at desc limit 1`) || 'x'}`, memberText: /isn't offered/,
      api: async () => { const r = await rest(ptok, 'GET', `content_items?center_id=eq.${CENTER}`); return Array.isArray(r.json) && r.json.length === 0; },
    },
    {
      key: 'governance', portal: '/pathshala/committee/resolutions', member: null,
      api: async () => { const r = await rest(atok, 'GET', `resolutions?center_id=eq.${CENTER}`); return Array.isArray(r.json) && r.json.length === 0; },
    },
  ];
  for (const c of cases) {
    // content cannot go off while Niva (which depends on it) is on — the database says so
    if (c.before) {
      const refused = await rest(atok, 'POST', 'rpc/set_module_enabled', { p_center: CENTER, p_module: c.key, p_enabled: false, p_reason: 'e2e dependency check' });
      ok(refused.status >= 400 && /Niva/i.test(JSON.stringify(refused.json)), `${c.key} cannot be switched off while ${c.before.join(', ')} is on`);
      for (const b of c.before) await set(b, false, `e2e: ${c.key} off`);
    }
    await set(c.key, false, `e2e: ${c.key} check`);
    ok(audit('center_modules', `${CENTER}:${c.key}`).endsWith(`|e2e: ${c.key} check`) || sql(`select reason from app.center_modules where module_key='${c.key}'`) === `e2e: ${c.key} check`, `${c.key} off, with its reason recorded`);
    await pgo(admin, c.portal);
    ok(off.test(await admin.innerText('main')), `portal ${c.portal} shows the switched-off page`);
    if (c.member) {
      await mgo(priya, c.member);
      const t = await priya.innerText('body');
      if (c.memberText) ok(c.memberText.test(t), `member ${c.member} says it isn't offered`);
      else ok(!/Today|Saathi/.test(t) || /isn't offered/.test(t), `member ${c.member} hides My Jain Way practices`);
    }
    ok(await c.api(), `the API refuses ${c.key} while it is off`);
    await set(c.key, true, `e2e: ${c.key} back on`);
    if (c.before) for (const b of c.before) await set(b, true, `e2e: ${c.key} back on`);
    ok(sql(`select coalesce((select enabled::text from app.center_modules where center_id='${CENTER}' and module_key='${c.key}'),'true')`) === 'true', `${c.key} back on`);
  }
  await shot(admin, '7-modules');
  await Promise.all([admin.context().close(), priya.context().close()]);
}

// ---------------------------------------------------------------------------
(async () => {
  const browser = await chromium.launch();
  try {
    if (ONLY.includes(1)) await journeyPathshala(browser);
    if (ONLY.includes(2)) await journeyGyan(browser);
    if (ONLY.includes(3)) await journeyJainWay(browser);
    if (ONLY.includes(4)) await journeyContent(browser);
    if (ONLY.includes(5)) await journeyNiva(browser);
    if (ONLY.includes(6)) await journeyGovernance(browser);
    if (ONLY.includes(7)) await journeyModules(browser);
  } finally {
    await browser.close();
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('FLOW FAILED:', e);
  process.exit(1);
});
