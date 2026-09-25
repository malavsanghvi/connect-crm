// Wave E · e-people-legal — end-to-end against a real local stack (bash e2e/up.sh e-people-legal 300).
// Plain Node + Playwright; every step asserts the database (and the audit rows where a person acted).
//
//   Portal on :3400 started with MESSAGING_LINK_SECRET and PORTAL_DATABASE_URL (connect_worker),
//   the member app exported to /tmp/claude-0/e-people-legal-web and served on :8500:
//   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright PORTAL=http://localhost:3400 MEMBER=http://localhost:8500 \
//   MAIL=http://localhost:55624 API=http://localhost:55621 DB=postgres://postgres:postgres@localhost:55732/postgres \
//   ENVF=e2e/.env.e-people-legal LINK_SECRET=… node e2e/flows/e-people-legal.cjs [journey ...]
//
// Journeys (in order; all by default):
//   agreements  a platform admin edits a Community Connect agreement draft and publishes it; the owner accepts;
//               a new version is published; the owner is asked again and accepts; both acceptances are kept.
//   memberdocs  the organization publishes its privacy policy through Content › Legal & waivers (draft →
//               edit draft → publish) plus notices and photo consent.
//   newmember   a brand-new email signs up in the member app: after "Start my family" the legal step shows the
//               documents; nothing continues until they are accepted; answers are recorded with the version.
//   deceased    staff mark a person deceased (date, reason) in the portal: no messages of any channel, gone from
//               the directory, people list, pickers and active memberships, the household asks for a new primary,
//               giving history intact; the spouse's member app shows only an "In memory" line; a new primary
//               is chosen; a new privacy version is asked again in the member app; "deceased" is undone.
//   unsubscribe an address with no member on file unsubscribes from a newsletter link: newsletters stop,
//               a receipt still goes; a member's unsubscribe stays a per-person opt-out.
//
// Test data is created here (a family, a login, a newsletter); nothing in the apps is faked.
'use strict';
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORTAL = process.env.PORTAL || 'http://localhost:3400';
const MEMBER = process.env.MEMBER || 'http://localhost:8500';
const MAIL = process.env.MAIL || 'http://localhost:55624';
const API = process.env.API || 'http://localhost:55621';
const DB = process.env.DB || 'postgres://postgres:postgres@localhost:55732/postgres';
const OUT = process.env.OUT || '/tmp/claude-0/streams/e-people-legal';
const ENVF = process.env.ENVF || path.join(__dirname, '..', '.env.e-people-legal');
const LINK_SECRET = process.env.LINK_SECRET || 'e2e-link-secret';
fs.mkdirSync(OUT, { recursive: true });
const env = Object.fromEntries(fs.readFileSync(ENVF, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const CENTER = '00000000-0000-4000-8000-000000000001';
const RUN = Date.now().toString(36);

const sql = (q) => execSync(`psql "${DB}" -qAtX -v ON_ERROR_STOP=1`, { input: q }).toString().trim();
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) { failures++; process.exitCode = 1; } };
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }).catch(() => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 20000, every = 500) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(every); }
}

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
  throw new Error('no sign-in code arrived for ' + email);
}

async function portalLogin(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(PORTAL + '/login');
  const t0 = Date.now() - 2000;
  await p.fill('input[name=email]', email);
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

/** Submit inside `scope`, then the confirm modal (labelled like the submit button) when it opens. */
async function submitAndConfirm(p, scope, name) {
  await scope.getByRole('button', { name }).last().click();
  const dialog = p.getByRole('dialog').last();
  await p.waitForTimeout(400);
  const again = dialog.getByRole('button', { name }).last();
  if (await again.isVisible({ timeout: 2000 }).catch(() => false)) await again.click();
  await p.waitForTimeout(2500);
}

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
async function createLogin(email) {
  await fetch(`${API}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: env.SERVICE_KEY, Authorization: `Bearer ${env.SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, email_confirm: true }),
  });
  return sql(`select id from auth.users where email = '${email}'`);
}
const lastAudit = (table, where = '') =>
  sql(`select coalesce(client_app,'')||'|'||coalesce(client_screen,'')||'|'||coalesce(reason,'') from app.audit_log where record_table = '${table}' ${where} order by id desc limit 1`);

// ---------------------------------------------------------------------------
const state = { newEmail: `new.${RUN}@example.test`, leela: `leela.${RUN}@example.test`, last: `Doshi${RUN.slice(-4)}` };

/** A family for the deceased journey: Ramesh (primary, life member, a past gift), Leela (spouse, app login), Kavi (child). */
async function seedFamily() {
  const hh = sql(`insert into app.households (center_id, display_name, directory_opt_in) values ('${CENTER}', '${state.last} family', true) returning id`);
  const [ramesh, leela, kavi] = ['Ramesh', 'Leela', 'Kavi'].map((first, i) =>
    sql(`insert into app.people (center_id, first_name, last_name, email, date_of_birth, is_verified, verified_at)
         values ('${CENTER}', '${first}', '${state.last}', ${i === 2 ? 'null' : `'${first.toLowerCase()}.${RUN}@example.test'`},
                 '${['1952-03-01', '1956-06-01', '2016-02-01'][i]}', true, now()) returning id`));
  sql(`insert into app.household_members (household_id, person_id, center_id, role, is_primary, joined_at) values
       ('${hh}', '${ramesh}', '${CENTER}', 'primary', true, current_date - 900), ('${hh}', '${leela}', '${CENTER}', 'spouse', false, current_date - 900),
       ('${hh}', '${kavi}', '${CENTER}', 'child', false, current_date - 900)`);
  sql(`insert into app.memberships (center_id, household_id, person_id, membership_type_id, tier, status, starts_on)
       select '${CENTER}', '${hh}', '${ramesh}', id, 'life', 'active', '2004-04-01' from app.membership_types where center_id = '${CENTER}' and tier = 'life' order by key limit 1`);
  sql(`insert into app.payments (center_id, household_id, payer_person_id, amount_cents, method, status, received_on, is_historical, memo)
       values ('${CENTER}', '${hh}', '${ramesh}', 25100, 'check', 'settled', current_date - 200, true, 'e2e past gift')`);
  const uid = await createLogin(state.leela);
  sql(`insert into app.accounts (user_id) values ('${uid}') on conflict do nothing; insert into app.center_users (center_id, user_id, person_id) values ('${CENTER}', '${uid}', '${leela}')`);
  Object.assign(state, { hh, ramesh, leela_id: leela, kavi });
}

const journeys = {
  async agreements(b) {
    sql(`update app.accounts set is_platform_admin = true where user_id = (select id from auth.users where email = 'admin@jsh.test')`);
    const p = await portalLogin(b, 'admin@jsh.test');
    await p.goto(PORTAL + '/platform/agreements', { waitUntil: 'networkidle' });
    const card = p.getByTestId('platform-agreement-dpa');
    const hasDraft = /Draft/.test(await card.innerText());
    ok(hasDraft || sql(`select count(*) from app.legal_documents where center_id is null and kind = 'dpa' and published_at is not null`) !== '0',
      'Platform › Agreements shows the DPA (the draft counsel will replace, on a fresh stack)');
    // Edit the draft (or start one), then publish it.
    await card.getByRole('button', { name: hasDraft ? 'Edit draft' : 'New version' }).click();
    const drawer = p.getByRole('dialog').last();
    await drawer.getByLabel('Text (Markdown)').fill(`Counsel's data processing agreement, first edition ${RUN}.`);
    await drawer.getByLabel('Version').fill(`2026-09-${RUN}`);
    await drawer.getByLabel('Reason (goes in the audit log)').fill('Counsel supplied the first text');
    await drawer.getByRole('button', { name: 'Save draft' }).click();
    await p.waitForTimeout(2500);
    const v1 = sql(`select id from app.legal_documents where center_id is null and kind = 'dpa' and version = '2026-09-${RUN}'`);
    ok(!!v1 && sql(`select published_at is null and body_md like '%first edition%' and updated_by is not null from app.legal_documents where id = '${v1}'`) === 't',
      'the draft is edited (still unpublished)');
    ok(lastAudit('legal_documents', `and record_id = '${v1}'`).endsWith('|Counsel supplied the first text'), 'the draft edit is audited with the reason');
    await p.keyboard.press('Escape');
    await p.goto(PORTAL + '/platform/agreements', { waitUntil: 'networkidle' });
    await submitAndConfirm(p, p.getByTestId('platform-agreement-dpa'), /Publish version/);
    ok(sql(`select published_at is not null and published_by is not null from app.legal_documents where id = '${v1}'`) === 't', 'publishing records when and who');
    await shot(p, 'agreements-1-platform');
    // The owner accepts it in Settings › Agreements.
    await p.goto(PORTAL + '/settings/agreements', { waitUntil: 'networkidle' });
    let dpa = p.getByTestId('agreement-dpa');
    await dpa.getByRole('checkbox').check();
    await dpa.getByRole('button', { name: /Accept/ }).click();
    await p.waitForTimeout(2500);
    ok(sql(`select count(*) from app.org_agreements where center_id = '${CENTER}' and kind = 'dpa' and version = '2026-09-${RUN}'`) === '1', 'the owner accepted this version');
    // A new version: the owner is asked again.
    await p.goto(PORTAL + '/platform/agreements', { waitUntil: 'networkidle' });
    await p.getByTestId('platform-agreement-dpa').getByRole('button', { name: 'New version' }).click();
    const d2 = p.getByRole('dialog').last();
    await d2.getByLabel('Version').fill(`2026-10-${RUN}`);
    await d2.getByLabel('Text (Markdown)').fill(`Counsel's revised agreement ${RUN}: sub-processors updated.`);
    await d2.getByLabel('Reason (goes in the audit log)').fill('Counsel revision: sub-processors');
    await d2.getByRole('button', { name: 'Save draft' }).click();
    await p.waitForTimeout(2500);
    await p.keyboard.press('Escape');
    await p.goto(PORTAL + '/platform/agreements', { waitUntil: 'networkidle' });
    await submitAndConfirm(p, p.getByTestId('platform-agreement-dpa'), /Publish version/);
    ok(sql(`select count(*) from app.legal_documents where center_id is null and kind = 'dpa' and version = '2026-10-${RUN}' and published_at is not null`) === '1', 'the new version is published');
    ok(sql(`select count(*) from app.legal_documents where id = '${v1}' and body_md like '%first edition%'`) === '1', 'the earlier version is unchanged');
    await p.goto(PORTAL + '/settings/agreements', { waitUntil: 'networkidle' });
    dpa = p.getByTestId('agreement-dpa');
    ok(/Needs your acceptance/.test(await p.innerText('main')) && /Version 2026-09-/.test(await dpa.innerText()),
      'Settings › Agreements asks the owner to accept the new version (showing the version accepted before)');
    await shot(p, 'agreements-2-asked-again');
    await dpa.getByRole('checkbox').check();
    await dpa.getByRole('button', { name: /Accept/ }).click();
    await p.waitForTimeout(2500);
    ok(sql(`select string_agg(version, ',' order by accepted_at) from app.org_agreements where center_id = '${CENTER}' and kind = 'dpa'`) === `2026-09-${RUN},2026-10-${RUN}`,
      'both acceptances are kept, each with its version');
    await p.context().close();
  },

  async memberdocs(b) {
    const p = await portalLogin(b, 'admin@jsh.test');
    await p.goto(PORTAL + '/content/legal', { waitUntil: 'networkidle' });
    await p.getByRole('button', { name: 'New document' }).click();
    let d = p.getByRole('dialog').last();
    await d.getByLabel('Document').selectOption('privacy');
    await d.getByLabel('Title').fill('Privacy policy');
    await d.getByLabel('Version').fill('v1');
    await d.getByLabel('Text (Markdown)').fill('We keep your family\'s details private. (draft)');
    await d.getByRole('button', { name: 'Save draft' }).click();
    await p.waitForTimeout(2500);
    await p.keyboard.press('Escape');
    const draft = sql(`select id from app.legal_documents where center_id = '${CENTER}' and kind = 'privacy' and version = 'v1'`);
    ok(!!draft && sql(`select member_step from app.legal_documents where id = '${draft}'`) === 'accept', 'a privacy policy draft is saved; members must accept it');
    await p.goto(PORTAL + '/content/legal', { waitUntil: 'networkidle' });
    await p.getByRole('button', { name: 'Edit draft v1' }).click();
    d = p.getByRole('dialog').last();
    await d.getByLabel('Text (Markdown)').fill('We keep your family\'s details private and never sell them.');
    await d.getByRole('button', { name: 'Save draft' }).click();
    await p.waitForTimeout(2500);
    await p.keyboard.press('Escape');
    ok(sql(`select body_md from app.legal_documents where id = '${draft}'`).includes('never sell'), 'the draft is edited before publishing');
    await p.goto(PORTAL + '/content/legal', { waitUntil: 'networkidle' });
    await submitAndConfirm(p, p.locator('main'), 'Publish v1');
    ok(sql(`select published_at is not null from app.legal_documents where id = '${draft}'`) === 't', 'the privacy policy is published');
    ok(lastAudit('legal_documents', `and record_id = '${draft}'`).startsWith('portal|/content/legal'), 'publishing is audited from the portal screen');
    // Notices and photo consent (the same form; inserted directly to keep the flow short).
    sql(`insert into app.legal_documents (center_id, kind, version, title, body_md, published_at) values
         ('${CENTER}', 'disclaimer', 'v1', 'Notices', 'Events are photographed and livestreamed.', now()),
         ('${CENTER}', 'photo_release', 'v1', 'Photo consent', 'May the community use photos of you in its newsletters?', now())`);
    await p.goto(PORTAL + '/content/legal', { waitUntil: 'networkidle' });
    ok(/Must accept to use the app/.test(await p.innerText('main')) && /Asked yes or no/.test(await p.innerText('main')), 'the list says how the member app asks for each document');
    await shot(p, 'memberdocs-1-list');
    await p.context().close();
  },

  async newmember(b) {
    const m = await memberLogin(b, state.newEmail);
    ok(/family-match/.test(m.url()), `a new email lands on "Is this your family?" (${m.url().replace(MEMBER, '')})`);
    await m.getByLabel('First name').fill('Anand');
    await m.getByLabel('Last name').fill(`Legal${RUN.slice(-3)}`);
    await m.getByRole('button', { name: /start my family/i }).click();
    const step = m.getByTestId('legal-step');
    await step.waitFor({ timeout: 20000 });
    const body = await step.innerText();
    ok(/Before you continue/.test(body) && /Privacy policy/.test(body) && /Notices/.test(body) && /Photo consent/.test(body),
      'the first sign-in shows the legal step with privacy, notices and photo consent');
    await shot(m, 'newmember-1-legal-step');
    const person = sql(`select p.id from app.people p join app.center_users cu on cu.person_id = p.id join auth.users u on u.id = cu.user_id where u.email = '${state.newEmail}'`);
    await m.getByRole('button', { name: /agree and continue/i }).click();
    await m.waitForTimeout(1500);
    ok(/To use the app, accept/.test(await step.innerText()) && sql(`select count(*) from app.consents where person_id = '${person}' and legal_document_id is not null`) === '0',
      'nothing continues (and nothing is recorded) until the documents are accepted');
    for (const cb of await m.getByRole('checkbox', { name: /I have read and accept/ }).all()) await cb.click();
    await m.getByRole('checkbox', { name: 'No', exact: true }).click();
    await m.getByRole('button', { name: /agree and continue/i }).click();
    await until(async () => !(await step.isVisible().catch(() => false)), 20000);
    ok(!(await step.isVisible().catch(() => false)), 'after answering, the legal step closes and onboarding continues');
    ok(/\/about/.test(m.url()), `onboarding continues on "About you" (${m.url().replace(MEMBER, '')})`);
    ok(sql(`select string_agg(d.kind || ':' || d.version || ':' || c.granted, ',' order by d.kind) from app.consents c join app.legal_documents d on d.id = c.legal_document_id where c.person_id = '${person}'`)
      === 'disclaimer:v1:true,photo_release:v1:false,privacy:v1:true', 'each answer is recorded with its document version');
    ok(sql(`select count(*) from app.consents where person_id = '${person}' and source = 'app' and given_by_user is not null and ip is not null`) === '3', 'with who, the app and the IP address');
    ok(lastAudit('consents', `and after->>'person_id' = '${person}'`).startsWith('member|'), 'the answers are audited as the member app');
    await m.context().close();
  },

  async deceased(b) {
    await seedFamily();
    const leelaToken = await tokenFor(state.leela);
    const dirBefore = await rest(leelaToken, 'GET', `directory?person_id=eq.${state.ramesh}&select=person_id`);
    ok(dirBefore.status === 200 && dirBefore.json.length === 1, 'before: Ramesh is in the member directory');
    const activeBefore = Number(sql(`select count(*) from app.memberships where center_id = '${CENTER}' and status = 'active'`));
    const queued = sql(`select app.enqueue_message('${CENTER}', 'email', 'ramesh.${RUN}@example.test', 'test_message', '{"person_id":"${state.ramesh}"}', 'notification')`);

    const p = await portalLogin(b, 'admin@jsh.test');
    await p.goto(`${PORTAL}/people/${state.ramesh}`, { waitUntil: 'networkidle' });
    await p.getByRole('button', { name: 'Mark as deceased' }).first().click();
    const d = p.getByRole('dialog').last();
    const day = sql(`select to_char(current_date - 4, 'YYYY-MM-DD')`);
    await d.getByLabel('Date of death').fill(day);
    await d.getByLabel('Note (optional)').fill('Passed peacefully at home.');
    await d.getByLabel('Reason (goes in the audit log)').fill('His son called the office');
    await d.getByRole('checkbox').check();
    await submitAndConfirm(p, d, 'Mark as deceased');
    ok(sql(`select is_deceased::text || '|' || deceased_on || '|' || (deceased_recorded_by is not null)::text from app.people where id = '${state.ramesh}'`) === `true|${day}|true`,
      'the person is marked deceased with the date and who recorded it');
    ok(lastAudit('people', `and record_id = '${state.ramesh}'`) === `portal|/people/${state.ramesh}|His son called the office`, 'audited from the person page with the reason');
    await p.goto(`${PORTAL}/people/${state.ramesh}`, { waitUntil: 'networkidle' });
    ok(await p.getByTestId('deceased-banner').isVisible() && /In memory/.test(await p.getByTestId('deceased-banner').innerText()), 'the person page shows a clear "In memory" banner');
    await shot(p, 'deceased-1-person');
    // No messages, of any channel.
    ok(sql(`select status from app.messages where id = '${queued}'`) === 'suppressed', 'a message already queued to him is stopped');
    const m2 = sql(`select app.enqueue_message('${CENTER}', 'email', 'ramesh.${RUN}@example.test', 'test_message', '{}', 'notification')`);
    const m3 = sql(`select app.enqueue_message('${CENTER}', 'push', (select id::text from auth.users where email = '${state.leela}'), 'test_message', '{"person_id":"${state.ramesh}"}', 'notification')`);
    ok(sql(`select string_agg(status, ',') from app.messages where id in ('${m2}', '${m3}')`) === 'suppressed,suppressed', 'new email and push messages naming him are suppressed');
    // Gone from the directory, the people list, pickers and active counts; history intact.
    const dirAfter = await rest(leelaToken, 'GET', `directory?person_id=eq.${state.ramesh}&select=person_id`);
    ok(dirAfter.status === 200 && dirAfter.json.length === 0, 'he is no longer in the member directory');
    await p.goto(`${PORTAL}/people?q=${encodeURIComponent('Ramesh ' + state.last)}`, { waitUntil: 'networkidle' });
    ok(!(await p.innerText('main')).includes(`Ramesh ${state.last}`), 'the people list (active people) leaves him out');
    ok(Number(sql(`select count(*) from app.memberships where center_id = '${CENTER}' and status = 'active'`)) === activeBefore - 1
      && sql(`select status from app.memberships where person_id = '${state.ramesh}'`) === 'ended', 'the life membership he held ended; active memberships dropped by one');
    ok(sql(`select count(*) from app.payments where payer_person_id = '${state.ramesh}' and memo = 'e2e past gift'`) === '1', 'his giving history is intact (still the payer)');
    const ev = sql(`select id from app.events where center_id = '${CENTER}' and starts_at > now() order by starts_at limit 1`);
    const rsvp = await rest(leelaToken, 'POST', 'attendees', { center_id: CENTER, event_id: ev, person_id: state.ramesh, display_name: 'Ramesh' });
    ok(rsvp.status >= 400 && /deceased/.test(JSON.stringify(rsvp.json)), 'the API refuses to add him to an event (RSVP / ticket / check-in pickers)');
    // The household asks for a new primary member.
    await p.goto(`${PORTAL}/households/${state.hh}`, { waitUntil: 'networkidle' });
    const prompt = p.getByTestId('new-primary-prompt');
    ok(await prompt.isVisible() && /Choose a new primary member/.test(await prompt.innerText()), 'the household asks for a new primary member');
    ok(!(await prompt.locator('select option').allInnerTexts()).some((t) => /Kavi/.test(t)), 'a child is not offered as the primary');
    await shot(p, 'deceased-2-household');

    // The spouse's member app: the legal step first (documents published), then the In memory line.
    const m = await memberLogin(b, state.leela);
    const step = m.getByTestId('legal-step');
    if (await step.isVisible({ timeout: 8000 }).catch(() => false)) {
      for (const cb of await m.getByRole('checkbox', { name: /I have read and accept/ }).all()) await cb.click();
      await m.getByRole('checkbox', { name: 'Yes', exact: true }).click();
      await m.getByRole('button', { name: /agree and continue/i }).click();
      await until(async () => !(await step.isVisible().catch(() => false)), 20000);
    }
    await m.goto(MEMBER + '/family', { waitUntil: 'networkidle' });
    await m.waitForTimeout(2500);
    const fam = await m.innerText('body');
    ok(new RegExp(`In memory · Ramesh ${state.last}`).test(fam), 'the member app shows a respectful "In memory" line');
    ok((fam.match(new RegExp(`Ramesh ${state.last}`, 'g')) || []).length === 1 && /Kavi/.test(fam), 'and lists him nowhere else in the family (the living are listed)');
    await shot(m, 'deceased-3-member-family');

    // Choose the new primary.
    await prompt.locator('select').selectOption({ label: `Leela ${state.last}` });
    await submitAndConfirm(p, prompt, 'Make primary member');
    ok(sql(`select string_agg(p.first_name, ',') from app.household_members hm join app.people p on p.id = hm.person_id where hm.household_id = '${state.hh}' and hm.is_primary`) === 'Leela',
      'Leela is now the primary member (Ramesh stays in the household)');
    ok(lastAudit('household_members').endsWith(`|Ramesh ${state.last} passed away`), 'the change of primary is audited with the reason');

    // A new version of the privacy policy is asked again in the member app.
    await p.goto(PORTAL + '/content/legal', { waitUntil: 'networkidle' });
    const priv = p.locator('tr', { hasText: 'Privacy policy' }).first();
    await priv.getByRole('button', { name: 'New version' }).click();
    const nv = p.getByRole('dialog').last();
    ok((await nv.getByLabel('Version').inputValue()) === 'v2', 'the new version is suggested as v2');
    await nv.getByLabel('Text (Markdown)').fill('We keep your family\'s details private, never sell them, and delete them on request.');
    await nv.getByRole('button', { name: 'Save draft' }).click();
    await p.waitForTimeout(2500);
    await p.keyboard.press('Escape');
    await p.goto(PORTAL + '/content/legal', { waitUntil: 'networkidle' });
    await submitAndConfirm(p, p.locator('main'), 'Publish v2');
    ok(sql(`select count(*) from app.legal_documents where center_id = '${CENTER}' and kind = 'privacy' and version = 'v2' and published_at is not null`) === '1', 'privacy policy v2 is published');
    await m.goto(MEMBER + '/', { waitUntil: 'networkidle' });
    await m.reload({ waitUntil: 'networkidle' });
    await step.waitFor({ timeout: 20000 });
    const again = await step.innerText();
    ok(/updated some documents/.test(again) && /New version v2 \(you agreed to v1\)/.test(again) && !/Notices/.test(again), 'the member is asked again for the new version only');
    await shot(m, 'deceased-4-asked-again');
    await m.getByRole('checkbox', { name: /I have read and accept/ }).click();
    await m.getByRole('button', { name: /agree and continue/i }).click();
    await until(async () => !(await step.isVisible().catch(() => false)), 20000);
    ok(sql(`select string_agg(d.version, ',' order by c.recorded_at) from app.consents c join app.legal_documents d on d.id = c.legal_document_id where c.person_id = '${state.leela_id}' and d.kind = 'privacy'`) === 'v1,v2',
      'both acceptances are kept, each with its version');
    await m.context().close();

    // Undo.
    await p.goto(`${PORTAL}/people/${state.ramesh}`, { waitUntil: 'networkidle' });
    await p.getByRole('button', { name: 'Undo deceased' }).first().click();
    const u = p.getByRole('dialog').last();
    await u.getByLabel('Reason (goes in the audit log)').fill('Wrong Ramesh — it was a namesake');
    await submitAndConfirm(p, u, 'Undo');
    ok(sql(`select is_deceased from app.people where id = '${state.ramesh}'`) === 'f', 'undo: he is no longer recorded as deceased');
    ok(sql(`select status from app.memberships where person_id = '${state.ramesh}'`) === 'active', 'undo restores the membership the mark ended');
    const m4 = sql(`select app.enqueue_message('${CENTER}', 'email', 'ramesh.${RUN}@example.test', 'test_message', '{}', 'notification')`);
    ok(sql(`select status from app.messages where id = '${m4}'`) === 'queued', 'undo: messages reach him again');
    await p.goto(`${PORTAL}/people?q=${encodeURIComponent('Ramesh ' + state.last)}`, { waitUntil: 'networkidle' });
    ok((await p.innerText('main')).includes(`Ramesh ${state.last}`), 'undo: he is back in the people list');
    ok(sql(`select string_agg(action || ':' || reason, ',' order by recorded_at) from app.person_deceased_events where person_id = '${state.ramesh}'`)
      === 'marked:His son called the office,undone:Wrong Ramesh — it was a namesake', 'the mark and the undo are both kept with their reasons');
    await p.context().close();
  },

  async unsubscribe() {
    const addr = `friend.${RUN}@example.org`;
    const nl = sql(`select app.enqueue_message('${CENTER}', 'email', '${addr}', 'test_message', '{}', 'campaign')`);
    const sig = crypto.createHmac('sha256', LINK_SECRET).update(`unsubscribe:${nl}`).digest('base64url').slice(0, 32);
    const res = await fetch(`${PORTAL}/api/messaging/unsubscribe?m=${nl}&s=${sig}`);
    const page = await res.text();
    ok(res.status === 200 && /You are unsubscribed/.test(page) && /Receipts and sign-in codes still arrive/.test(page), 'the unsubscribe link works and says receipts still arrive');
    ok(sql(`select scope || '|' || reason from app.message_suppressions where address = '${addr}' and lifted_at is null`) === 'newsletters|unsubscribe',
      'an address with no member on file gets a newsletters-only suppression');
    const n2 = sql(`select app.enqueue_message('${CENTER}', 'email', '${addr}', 'test_message', '{}', 'campaign')`);
    const r1 = sql(`select app.enqueue_message('${CENTER}', 'email', '${addr}', 'test_message', '{}', 'receipt')`);
    ok(sql(`select status from app.messages where id = '${n2}'`) === 'suppressed', 'the next newsletter is not sent');
    ok(sql(`select status || '|' || (job_id is not null)::text from app.messages where id = '${r1}'`) === 'queued|true', 'a receipt to the same address still goes');
    // A member's unsubscribe is unchanged: a per-person opt-out.
    const priya = sql(`select id from app.people where email = 'priya@jsh.test' limit 1`);
    const mm = sql(`select app.enqueue_message('${CENTER}', 'email', 'priya@jsh.test', 'test_message', '{"person_id":"${priya}"}', 'campaign')`);
    const sig2 = crypto.createHmac('sha256', LINK_SECRET).update(`unsubscribe:${mm}`).digest('base64url').slice(0, 32);
    await fetch(`${PORTAL}/api/messaging/unsubscribe?m=${mm}&s=${sig2}`);
    ok(sql(`select count(*) from app.channel_optins where person_id = '${priya}' and not opted_in and source = 'unsubscribe_link'`) !== '0'
      && sql(`select count(*) from app.message_suppressions where address = 'priya@jsh.test' and lifted_at is null`) === '0', 'a member\'s unsubscribe stays a per-person opt-out');
    sql(`delete from app.channel_optins where person_id = '${priya}' and source = 'unsubscribe_link'`);
  },
};

(async () => {
  const want = process.argv.slice(2);
  const order = ['agreements', 'memberdocs', 'newmember', 'deceased', 'unsubscribe'];
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  try {
    for (const name of order) {
      if (want.length && !want.includes(name)) continue;
      console.log(`── ${name}`);
      try {
        await journeys[name](browser);
      } catch (e) {
        failures++;
        process.exitCode = 1;
        console.log(`FAIL ${name} threw: ${String(e && e.stack || e).slice(0, 800)}`);
      }
    }
  } finally {
    await browser.close();
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
})();
