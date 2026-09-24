// Events, volunteers, calendar, surveys and the Satvik Store, end to end against a real stack.
//
//   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright BASE=http://localhost:3300 APP=http://localhost:8400 \
//   MAIL=http://localhost:55524 DB=postgres://postgres:postgres@localhost:55632/postgres \
//   API=http://localhost:55521 ANON=<anon key> OUT=/tmp/claude-0/streams/w-events node e2e/flows/w-events.cjs
//
// Journeys (each asserts its result in the database, including the audit trail):
//  1. Staff create an event from a template in the Event builder and publish it (portal).
//  2. A member RSVPs her family with a donation commitment; tickets are issued; she
//     confirms attendance (member app).
//  3. Staff put a volunteer on the Entry shift, give her check-in access and set the event live.
//  4. The volunteer (kiran) checks the family in at Entry (ticket code) and serves food
//     (walk-in by phone) in the member app's volunteer mode; lunch times are assigned.
//  5. The portal's live check-in dashboard counts the family.
//  6. Staff request feedback and open it; the member answers; the results show in the portal.
//  7. Staff track stock on a store item and receive stock; the member orders it with a
//     gift pack (pay at pickup); stock goes down; the low-stock task shows on Home; staff
//     move the order to ready and picked up; the member sees the status.
//  8. Staff add an entry to a calendar layer; the member sees it in the Events calendar.
//  9. Module switch: with Events off the portal shows the switched-off page, the member
//     app hides Events and the API refuses; roles: a member cannot check anyone in.
//
// STEPS=1,2,3 runs a subset (later steps look up what earlier ones created by name).
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const { execSync } = require('child_process');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:3100';
const APP = process.env.APP || 'http://localhost:8200';
const MAIL = process.env.MAIL || 'http://localhost:55324';
const DB = process.env.DB || 'postgres://postgres:postgres@localhost:55432/postgres';
const API = process.env.API || 'http://localhost:55321';
const ANON = process.env.ANON || '';
const OUT = process.env.OUT || '/tmp/claude-0/e2e/w-events';
const STEPS = (process.env.STEPS || '1,2,3,4,5,6,7,8,9').split(',').map(Number);
fs.mkdirSync(OUT, { recursive: true });

const sql = (q) => execSync(`psql "${DB}" -Atc "${q.replace(/"/g, '\\"')}"`).toString().trim();
let failures = 0;
const ok = (c, m) => {
  console.log(`${c ? 'PASS' : 'FAIL'} ${m}`);
  if (!c) failures++;
};
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }).catch(() => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, ms = 15000) {
  const until = Date.now() + ms;
  for (;;) {
    let v;
    try {
      v = fn();
    } catch {
      v = null;
    }
    if (v) return v;
    if (Date.now() > until) return null;
    await sleep(500);
  }
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

async function portalLogin(ctx, email) {
  const p = await ctx.newPage();
  await p.goto(BASE + '/login');
  const t0 = Date.now() - 2000;
  await p.fill('input[name=email]', email);
  await p.click('button[type=submit]');
  await p.waitForSelector('input[name=code]', { timeout: 20000 });
  await p.fill('input[name=code]', await code(email, t0));
  await p.click('button[type=submit]');
  await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  return p;
}

async function memberLogin(ctx, email) {
  const p = await ctx.newPage();
  await p.goto(APP + '/sign-in', { waitUntil: 'networkidle' });
  const t0 = Date.now() - 2000;
  await p.fill('input[placeholder="name@example.com"]', email);
  await p.getByRole('button', { name: /send code/i }).first().click();
  const box = p.locator('input[autocomplete=one-time-code]').first();
  await box.waitFor({ timeout: 20000 });
  await box.fill(await code(email, t0));
  await p.getByRole('button', { name: /verify/i }).first().click();
  await p.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 30000 });
  await p.waitForTimeout(2500);
  return p;
}

/** Sign in through GoTrue directly (for API-level permission checks). */
async function apiToken(email) {
  const t0 = Date.now() - 2000;
  await fetch(`${API}/auth/v1/otp`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, create_user: false }) });
  const c = await code(email, t0);
  const r = await fetch(`${API}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, token: c, type: 'email' }) }).then((x) => x.json());
  return r.access_token;
}
async function rest(token, path, init = {}) {
  const r = await fetch(`${API}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept-Profile': 'app', 'Content-Profile': 'app', ...(init.headers || {}) },
  });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: r.status, body };
}

/** Local date/time in the center's zone, `days` from today at hh:mm, as a datetime-local value. */
function localAt(days, hhmm) {
  const d = new Date(Date.now() + days * 86400000);
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return `${ymd}T${hhmm}`;
}

/** Click a submit button that asks first in the confirmation modal, then confirm. */
async function clickAndConfirm(p, button) {
  await button.click();
  const dlg = p.getByRole('dialog');
  if (await dlg.isVisible({ timeout: 3000 }).catch(() => false)) {
    await dlg.getByRole('button').last().click();
  }
}

const RUN = Date.now().toString(36).slice(-5);
const EVENT = process.env.EVENT_NAME || `Samvatsari pratikraman ${RUN}`;
const lastAudit = (table, where = '') =>
  sql(`select coalesce(client_app,'')||'|'||coalesce(client_screen,'')||'|'||coalesce(module,'')||'|'||coalesce(reason,'') from app.audit_log where record_table='${table}' ${where} order by id desc limit 1`);

(async () => {
  const browser = await chromium.launch();
  const staff = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const memberCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const kiranCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let admin, priya, kiran;
  const eventId = () => sql(`select id from app.events where name like 'Samvatsari pratikraman%' order by created_at desc limit 1`);
  const eventName = () => sql(`select name from app.events where id='${eventId()}'`);

  // ── 1. Event from a template, published ───────────────────────────────────────
  if (STEPS.includes(1)) {
    admin = await portalLogin(staff, 'admin@jsh.test');
    await admin.goto(BASE + '/events/builder', { waitUntil: 'networkidle' });
    const tpl = admin.locator('section').filter({ hasText: 'Start from a template' });
    await tpl.locator('select[name=template_id]').selectOption({ label: 'Tapasvi Bahuman' });
    await tpl.locator('input[name=name]').fill(EVENT);
    await tpl.locator('input[name=starts_at]').fill(localAt(1, '10:00'));
    await tpl.getByRole('button', { name: /create draft from template/i }).click();
    await admin.waitForURL(/saved=template/, { timeout: 30000 });
    const id = eventId();
    ok(sql(`select status||'|'||(template_id is not null)::text from app.events where id='${id}'`) === 'draft|true', 'event created from the template as a draft');
    ok(Number(sql(`select count(*) from app.actions where event_id='${id}'`)) > 0, "the template's checklist was copied to the event");
    ok(lastAudit('events', `and record_id='${id}'`).startsWith('portal|/events/builder|events'), 'audit: event insert from portal /events/builder, module events');
    ok(sql(`select waitlist_enabled::text||'|'||lunch_enabled::text||'|'||event_number from app.events where id='${id}'`).match(/^true\|true\|\w+-EV-\d+$/), 'template draft starts with the builder defaults and an event number');
    await admin.fill('#ev-ends', localAt(1, '14:00'));
    await admin.fill('#ev-venue', 'Stafford Center');
    await admin.fill('#ev-lunch', localAt(1, '12:00'));
    await admin.fill('#ev-seats', '40');
    const lunch = admin.getByRole('switch', { name: 'Assign lunch slots at check-in' });
    if ((await lunch.getAttribute('aria-checked')) !== 'true') await lunch.click();
    await clickAndConfirm(admin, admin.getByRole('button', { name: 'Publish event' }));
    await waitFor(() => sql(`select status from app.events where id='${id}'`) === 'published', 'published');
    ok(sql(`select status||'|'||venue||'|'||lunch_enabled::text from app.events where id='${id}'`) === 'published|Stafford Center|true', 'event published with venue and lunch slots on');
    await shot(admin, '1-builder-published');
  }

  // ── 2. Member RSVP with a commitment → tickets → confirm ─────────────────────
  if (STEPS.includes(2)) {
    const id = eventId();
    priya = await memberLogin(memberCtx, 'priya@jsh.test');
    await priya.goto(APP + '/events', { waitUntil: 'networkidle' });
    await priya.waitForTimeout(1500);
    const evName = eventName();
    ok((await priya.innerText('body')).includes(evName), 'the published event is listed in the member app');
    await priya.getByText(evName).first().click();
    await priya.waitForURL(/\/event\//, { timeout: 15000 });
    await priya.waitForTimeout(2000);
    await priya.getByRole('tab', { name: 'Per person' }).click();
    await priya.getByRole('radio', { name: '$5', exact: true }).click();
    await priya.getByRole('radio', { name: 'Add as pledge' }).click();
    const going = await priya.getByRole('checkbox', { checked: true }).count();
    await shot(priya, '2-rsvp-form');
    await priya.getByRole('button', { name: /^RSVP / }).click();
    await priya.getByText('See your tickets').waitFor({ timeout: 30000 });
    const r = sql(`select r.status||'|'||count(a.*)||'|'||count(a.ticket_token)||'|'||(r.commitment_pledge_id is not null)::text from app.rsvps r join app.attendees a on a.rsvp_id=r.id where r.event_id='${id}' and r.household_id is not null group by r.id`);
    ok(r === `rsvpd|${going}|${going}|true`, `RSVP saved for ${going} people with a ticket each and a pledge (${r})`);
    ok(lastAudit('rsvps').startsWith('member|/event/'), 'audit: RSVP written from the member app event screen');
    const pl = sql(`select amount_cents||'|'||source from app.pledges where source_ref_id=(select id from app.rsvps where event_id='${id}' and household_id is not null)`);
    ok(pl === `${500 * going}|rsvp_commitment`, `commitment pledge of $5 × ${going} recorded (${pl})`);
    await priya.getByText('See your tickets').click();
    await priya.waitForTimeout(2000);
    await shot(priya, '2-tickets');
    ok(/Your tickets/.test(await priya.innerText('body')), 'tickets screen opens');
    await priya.goto(`${APP}/event/${id}/confirm`, { waitUntil: 'networkidle' });
    await priya.waitForTimeout(2000);
    await priya.getByRole('button', { name: /^Confirm / }).click();
    await waitFor(() => sql(`select status from app.rsvps where event_id='${id}' and household_id is not null`) === 'confirmed', 'confirmed');
    ok(sql(`select status from app.rsvps where event_id='${id}' and household_id is not null`) === 'confirmed', 'member confirmed attendance');
    await shot(priya, '2-confirmed');
  }

  // ── 3. Volunteer on the Entry shift, check-in access, event live ──────────────
  if (STEPS.includes(3)) {
    const id = eventId();
    admin = admin || (await portalLogin(staff, 'admin@jsh.test'));
    await admin.goto(`${BASE}/events/${id}?tab=volunteers`, { waitUntil: 'networkidle' });
    const add = admin.locator('section').filter({ hasText: 'Add a shift' });
    await add.locator('select[name=station]').selectOption('entry');
    await add.locator('input[name=starts_at]').fill(localAt(1, '09:30'));
    await add.locator('input[name=ends_at]').fill(localAt(1, '12:00'));
    await add.locator('input[name=capacity]').fill('2');
    await add.getByRole('button', { name: 'Add shift' }).click();
    await waitFor(() => sql(`select count(*) from app.volunteer_shifts where event_id='${id}'`) === '1', 'shift');
    ok(sql(`select station||'|'||capacity from app.volunteer_shifts where event_id='${id}'`) === 'entry|2', 'Entry shift added (2 volunteers needed)');
    await admin.reload({ waitUntil: 'networkidle' });
    await admin.getByText('Assign volunteers').first().click();
    await admin.fill('#pp-person_id', 'Kiran');
    await admin.getByRole('button', { name: /Kiran Mehta/ }).first().click();
    await admin.getByRole('button', { name: 'Assign', exact: true }).click();
    await waitFor(() => sql(`select count(*) from app.volunteer_assignments a join app.volunteer_shifts s on s.id=a.shift_id where s.event_id='${id}'`) === '1', 'assigned');
    ok(sql(`select count(*) from app.volunteer_assignments a join app.volunteer_shifts s on s.id=a.shift_id where s.event_id='${id}'`) === '1', 'kiran assigned to the Entry shift');
    ok(lastAudit('volunteer_assignments').startsWith(`portal|/events/${id}|volunteers`), 'audit: assignment from the portal event page, module volunteers');
    await admin.reload({ waitUntil: 'networkidle' });
    await admin.getByRole('button', { name: 'Give check-in access' }).first().click();
    const kiranUser = sql(`select user_id from app.center_users cu join app.people p on p.id=cu.person_id where p.member_number='JSH-90005'`);
    await waitFor(() => sql(`select count(*) from app.role_grants where user_id='${kiranUser}' and scope_id='${id}' and role_key='checkin_volunteer'`) === '1', 'grant');
    ok(sql(`select count(*) from app.role_grants where user_id='${kiranUser}' and scope_id='${id}' and role_key='checkin_volunteer'`) === '1', 'kiran has check-in access for this event only');
    await admin.goto(`${BASE}/events/${id}`, { waitUntil: 'networkidle' });
    await clickAndConfirm(admin, admin.getByRole('button', { name: 'Go live (event day)' }));
    await waitFor(() => sql(`select status from app.events where id='${id}'`) === 'live', 'live');
    ok(sql(`select status from app.events where id='${id}'`) === 'live', 'event is live');
    await shot(admin, '3-event-live');
  }

  // ── 4. Volunteer mode: Entry by ticket code, Food by phone ───────────────────
  if (STEPS.includes(4)) {
    const id = eventId();
    const rsvp = sql(`select id from app.rsvps where event_id='${id}' and household_id is not null`);
    const token = sql(`select ticket_token from app.attendees where rsvp_id='${rsvp}' order by display_name limit 1`);
    const n = Number(sql(`select count(*) from app.attendees where rsvp_id='${rsvp}' and status <> 'cancelled'`));
    kiran = await memberLogin(kiranCtx, 'kiran@jsh.test');
    await kiran.goto(APP + '/volunteer', { waitUntil: 'networkidle' });
    await kiran.waitForTimeout(2500);
    ok((await kiran.innerText('body')).includes(eventName()), 'volunteer mode opens on the live event');
    // Several live events: pick this one in the event switcher.
    const chip = kiran.getByRole('button', { name: eventName(), exact: true });
    if (await chip.count()) await chip.click();
    await kiran.getByRole('tab', { name: 'Entry' }).click();
    await kiran.getByLabel('Ticket or member code').fill(token);
    await kiran.getByRole('button', { name: 'Look up' }).click();
    await kiran.getByText(/Confirm who is here/).first().waitFor({ timeout: 15000 });
    await shot(kiran, '4-entry-confirm');
    await kiran.getByRole('button', { name: /^Check in / }).click();
    await waitFor(() => Number(sql(`select count(*) from app.attendees where rsvp_id='${rsvp}' and checked_in_at is not null`)) === n, 'checked in');
    ok(Number(sql(`select count(*) from app.attendees where rsvp_id='${rsvp}' and checked_in_at is not null`)) === n, `all ${n} family members checked in at Entry`);
    ok(Number(sql(`select count(*) from app.attendees where rsvp_id='${rsvp}' and lunch_slot_id is not null`)) === n, 'everyone has a lunch time');
    ok(sql(`select string_agg(distinct station||':'||result, ',') from app.scan_log where event_id='${id}'`) === 'entry:ok', 'scan log records the Entry check-in');
    ok(lastAudit('attendees').startsWith('member|/volunteer|events'), 'audit: check-in from the member app volunteer screen');
    // Food: find the family by phone (walk-in desk), confirm who is here, serve.
    await kiran.getByRole('tab', { name: 'Food' }).click();
    await kiran.getByRole('button', { name: 'Walk-in by phone' }).click();
    await kiran.getByLabel('Mobile number').fill('(713) 555-0142');
    await kiran.getByRole('button', { name: 'Find family' }).click();
    await kiran.getByRole('button', { name: 'Confirm who is here' }).first().click();
    await kiran.getByRole('button', { name: /^Serve food to / }).click();
    await waitFor(() => Number(sql(`select count(*) from app.attendees where rsvp_id='${rsvp}' and served_food_at is not null`)) === n, 'served');
    ok(Number(sql(`select count(*) from app.attendees where rsvp_id='${rsvp}' and served_food_at is not null`)) === n, `food served to all ${n}, found by phone`);
    await shot(kiran, '4-food-done');
    // The member sees the check-in and lunch times on the tickets screen.
    if (priya) {
      await priya.goto(`${APP}/event/${id}/tickets`, { waitUntil: 'networkidle' });
      await priya.waitForTimeout(2000);
      ok(/Checked in/.test(await priya.innerText('body')), 'member tickets show "Checked in"');
      await shot(priya, '4-tickets-checked-in');
    }
  }

  // ── 5. Live check-in dashboard ────────────────────────────────────────────────
  if (STEPS.includes(5)) {
    const id = eventId();
    admin = admin || (await portalLogin(staff, 'admin@jsh.test'));
    await admin.goto(`${BASE}/events/live?event=${id}`, { waitUntil: 'networkidle' });
    const n = sql(`select count(*) from app.attendees where event_id='${id}' and checked_in_at is not null`);
    const kpi = await admin.locator('main').innerText();
    ok(new RegExp(`Checked in\\s*${n}\\b`).test(kpi), `live dashboard shows ${n} checked in`);
    ok(/Recent check-ins/i.test(kpi) && /Shah/.test(kpi), 'recent check-ins list the Shah family');
    await shot(admin, '5-live-dashboard');
  }

  // ── 6. Feedback: request → open → member answers → results ───────────────────
  if (STEPS.includes(6)) {
    const id = eventId();
    admin = admin || (await portalLogin(staff, 'admin@jsh.test'));
    await admin.goto(`${BASE}/events/feedback`, { waitUntil: 'networkidle' });
    await admin.getByRole('button', { name: 'Request feedback' }).click();
    const dlg = admin.getByRole('dialog');
    await dlg.waitFor();
    if (await dlg.locator('#fb-event').count()) await dlg.locator('#fb-event').selectOption(id);
    await dlg.getByRole('button', { name: 'Schedule request' }).click();
    const survey = await waitFor(() => sql(`select id from app.surveys where event_id='${id}' and kind='event_feedback'`), 'survey');
    ok(!!survey, 'feedback survey created for the event');
    ok(sql(`select (audience->>'event_id')||'|'||(send_at is not null)::text from app.surveys where id='${survey}'`) === `${id}|true`, 'survey targets the event attendees and has a send time');
    ok(lastAudit('surveys').startsWith('portal|/events/feedback|surveys'), 'audit: survey from portal /events/feedback, module surveys');
    await admin.goto(`${BASE}/events/feedback/${survey}`, { waitUntil: 'networkidle' });
    await clickAndConfirm(admin, admin.getByRole('button', { name: 'Open now' }));
    await waitFor(() => sql(`select (opens_at <= now())::text from app.surveys where id='${survey}'`) === 'true', 'open');
    ok(sql(`select status||'|'||(opens_at <= now())::text from app.surveys where id='${survey}'`) === 'open|true', 'survey opened now');

    priya = priya || (await memberLogin(memberCtx, 'priya@jsh.test'));
    await priya.goto(APP + '/', { waitUntil: 'networkidle' });
    await priya.waitForTimeout(2500);
    const title = sql(`select title from app.surveys where id='${survey}'`);
    ok((await priya.innerText('body')).includes(`How was ${eventName()}?`), 'the feedback request shows on the member Home');
    await priya.goto(`${APP}/survey/${survey}`, { waitUntil: 'networkidle' });
    await priya.waitForTimeout(2000);
    await priya.getByRole('radio', { name: '5 of 5 stars' }).first().click();
    const text = priya.locator('textarea').first();
    if (await text.count()) await text.fill('Lovely pratikraman, lunch line was quick.');
    await shot(priya, '6-survey');
    await priya.getByRole('button', { name: /^Submit feedback/ }).click();
    await waitFor(() => sql(`select count(*) from app.survey_responses where survey_id='${survey}'`) === '1', 'response');
    ok(sql(`select count(*) from app.survey_responses where survey_id='${survey}'`) === '1', 'member answer stored');
    ok(lastAudit('survey_responses').startsWith(`member|/survey/${survey}|surveys`), 'audit: answer from the member survey screen');
    await admin.goto(`${BASE}/events/feedback?survey=${survey}`, { waitUntil: 'networkidle' });
    const res = await admin.locator('main').innerText();
    ok(res.includes(title.replace(' · feedback', '')) && /Responses\s*1\b/.test(res), 'portal feedback results count the response');
    await shot(admin, '6-feedback-results');
  }

  // ── 7. Store: stock → member order with gift packs → stock down → pickup ──────
  if (STEPS.includes(7)) {
    const item = 'Kaju katli';
    const itemId = sql(`select id from app.store_items where name='${item}'`);
    admin = admin || (await portalLogin(staff, 'admin@jsh.test'));
    // Track stock with a reorder level just above what will be left (Menu & pickup › Edit).
    const before = Number(sql(`select stock_on_hand from app.store_items where id='${itemId}'`));
    const reorder = before + 8;
    await admin.goto(`${BASE}/store/menu`, { waitUntil: 'networkidle' });
    await admin.locator('tr').filter({ hasText: item }).getByRole('button', { name: 'Edit' }).click();
    const drawer = admin.getByRole('dialog');
    await drawer.locator('input[name=low_stock_threshold]').fill(String(reorder));
    const track = drawer.getByRole('switch', { name: 'Track stock' });
    if ((await track.getAttribute('aria-checked')) !== 'true') await track.click();
    await drawer.getByRole('button', { name: 'Save item' }).click();
    await waitFor(() => sql(`select track_inventory::text||'|'||low_stock_threshold from app.store_items where id='${itemId}'`) === `true|${reorder}`, 'tracked');
    ok(sql(`select track_inventory::text||'|'||low_stock_threshold from app.store_items where id='${itemId}'`) === `true|${reorder}`, `${item}: stock tracked, reorder at ${reorder}`);
    // Receive stock with the +10 quick button on Inventory.
    await admin.goto(`${BASE}/store`, { waitUntil: 'networkidle' });
    await admin.getByRole('button', { name: `Add 10 ${item}` }).click();
    await waitFor(() => Number(sql(`select stock_on_hand from app.store_items where id='${itemId}'`)) === before + 10, 'received');
    ok(Number(sql(`select stock_on_hand from app.store_items where id='${itemId}'`)) === before + 10, `+10 received (now ${before + 10})`);
    ok(lastAudit('inventory_movements').startsWith('portal|/store|store'), 'audit: stock change from portal /store, module store');

    // Member orders 3, gift packed, pay at pickup.
    priya = priya || (await memberLogin(memberCtx, 'priya@jsh.test'));
    await priya.goto(APP + '/store', { waitUntil: 'networkidle' });
    await priya.waitForTimeout(2000);
    await priya.getByRole('button', { name: `Add ${item} to order` }).click();
    await priya.getByRole('button', { name: `One more ${item}` }).click();
    await priya.getByRole('button', { name: `One more ${item}` }).click();
    await priya.getByRole('button', { name: /^View order/ }).click();
    await priya.waitForURL(/\/cart/, { timeout: 15000 });
    await priya.waitForTimeout(1500);
    const cartText = await priya.innerText('body');
    ok(cartText.includes(`${item} × 3`), `cart holds ${item} × 3`);
    await priya.getByRole('switch', { name: /^Gift pack \+/ }).first().click();
    await priya.getByLabel('Gift card message (optional)').fill('Happy Diwali from the Shah family');
    await shot(priya, '7-cart');
    await priya.getByRole('button', { name: /^Pay / }).click();
    await priya.getByRole('button', { name: 'Place order · pay at pickup' }).click();
    const order = await waitFor(() => sql(`select id from app.store_orders where household_id=(select household_id from app.household_members hm join app.people p on p.id=hm.person_id where p.member_number='JSH-90001' and hm.left_at is null limit 1) and status='placed' order by created_at desc limit 1`), 'order', 30000);
    ok(!!order, 'order placed (pay at pickup)');
    const o = sql(`select subtotal_cents||'|'||gift_packing_cents||'|'||total_cents||'|'||coalesce(gift_message,'') from app.store_orders where id='${order}'`);
    ok(o === '2997|897|3894|Happy Diwali from the Shah family', `order priced by the database with 3 gift packs (${o})`);
    ok(Number(sql(`select stock_on_hand from app.store_items where id='${itemId}'`)) === before + 7, `stock went down by 3 (now ${before + 7})`);
    ok(sql(`select reason||'|'||delta from app.inventory_movements where order_id='${order}'`) === 'sold|-3', "a 'sold' inventory movement is linked to the order");
    ok(lastAudit('store_orders', `and record_id='${order}'`).startsWith('member|/cart|store'), 'audit: order placed from the member cart');
    await priya.getByText(/Order .* is confirmed/).first().waitFor({ timeout: 20000 }).catch(() => {});
    await shot(priya, '7-order-placed');

    // Low stock task on the portal Home.
    await admin.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const home = await admin.locator('main').innerText();
    ok(/below reorder level/.test(home) && home.includes(item), 'Home shows the low-stock task naming the item');
    await shot(admin, '7-home-low-stock');

    // Staff move the order through the kitchen.
    const num = sql(`select order_number from app.store_orders where id='${order}'`);
    await admin.goto(`${BASE}/store/orders?window=${sql(`select pickup_window_id from app.store_orders where id='${order}'`)}`, { waitUntil: 'networkidle' });
    for (const [label, status] of [['Start preparing', 'preparing'], ['Ready for pickup', 'ready'], ['Picked up', 'picked_up']]) {
      const cardEl = admin.locator('li, article, div.cc-card, section').filter({ hasText: num }).filter({ has: admin.getByRole('button', { name: label }) }).last();
      await cardEl.getByRole('button', { name: label }).click();
      const dlg = admin.getByRole('dialog');
      if (await dlg.isVisible({ timeout: 1500 }).catch(() => false)) await dlg.getByRole('button').last().click();
      await waitFor(() => sql(`select status from app.store_orders where id='${order}'`) === status, status);
      ok(sql(`select status from app.store_orders where id='${order}'`) === status, `order ${num} → ${status}`);
      if (status === 'ready') {
        await priya.goto(APP + '/store', { waitUntil: 'networkidle' });
        await priya.waitForTimeout(2000);
        ok(new RegExp(`${num}[\\s\\S]*Ready for pickup`).test(await priya.innerText('body')), 'member sees the order is ready for pickup');
        await shot(priya, '7-member-order-ready');
      }
      await admin.reload({ waitUntil: 'networkidle' });
    }
    ok(lastAudit('store_orders', `and record_id='${order}'`).startsWith('portal|/store/orders|store'), 'audit: pickup from portal /store/orders');
  }

  // ── 8. Calendar layer entry → member calendar ─────────────────────────────────
  if (STEPS.includes(8)) {
    const title = `Ayambil oli ${RUN}`;
    const today = localAt(0, '00:00').slice(0, 10);
    admin = admin || (await portalLogin(staff, 'admin@jsh.test'));
    await admin.goto(`${BASE}/calendar`, { waitUntil: 'networkidle' });
    await admin.selectOption('#ce-layer', { label: 'Pathshala' });
    await admin.fill('#ce-title', title);
    await admin.fill('#ce-start', today);
    await admin.getByRole('button', { name: 'Add', exact: true }).click();
    await waitFor(() => sql(`select count(*) from app.calendar_entries where title='${title}'`) === '1', 'entry');
    ok(sql(`select starts_on::text from app.calendar_entries where title='${title}'`) === today, 'calendar entry saved on the Pathshala layer');
    ok(lastAudit('calendar_entries').startsWith('portal|/calendar|calendar'), 'audit: calendar entry from portal /calendar, module calendar');
    priya = priya || (await memberLogin(memberCtx, 'priya@jsh.test'));
    await priya.goto(`${APP}/events?view=calendar`, { waitUntil: 'networkidle' });
    await priya.waitForTimeout(2500);
    ok((await priya.innerText('body')).includes(title), 'the entry shows in the member Events › Calendar');
    await shot(priya, '8-member-calendar');
  }

  // ── 9. Module switch and roles ────────────────────────────────────────────────
  if (STEPS.includes(9)) {
    const center = sql(`select id from app.centers where slug='jsh'`);
    const adminTok = await apiToken('admin@jsh.test');
    const priyaTok = await apiToken('priya@jsh.test');
    const kiranTok = await apiToken('kiran@jsh.test');
    const setModule = (key, on, reason) =>
      rest(adminTok, 'rpc/set_module_enabled', { method: 'POST', headers: { 'x-client-app': 'portal', 'x-client-screen': '/settings/modules', 'x-audit-reason': encodeURIComponent(reason) }, body: JSON.stringify({ p_center: center, p_module: key, p_enabled: on, p_reason: reason }) });
    const MODS = [
      { key: 'events', url: '/events', member: '/event/EVENT', table: 'events' },
      { key: 'volunteers', url: '/events/volunteers', member: null, table: 'volunteer_shifts' },
      { key: 'store', url: '/store', member: '/store', table: 'store_items' },
      { key: 'surveys', url: '/comms/surveys', member: null, table: 'surveys' },
      { key: 'calendar', url: '/calendar', member: null, table: 'calendar_layers' },
    ];
    admin = admin || (await portalLogin(staff, 'admin@jsh.test'));
    priya = priya || (await memberLogin(memberCtx, 'priya@jsh.test'));
    for (const m of MODS) {
      const off = await setModule(m.key, false, `E2E: checking ${m.key} switched off`);
      ok(off.status < 300 && sql(`select enabled::text from app.center_modules where center_id='${center}' and module_key='${m.key}'`) === 'false', `${m.key} switched off (${off.status})`);
      await admin.goto(BASE + m.url, { waitUntil: 'networkidle' });
      ok(/switched off/i.test(await admin.locator('main').innerText()), `portal ${m.url} shows the switched-off page`);
      const read = await rest(priyaTok, `${m.table}?select=id&center_id=eq.${center}&limit=1`);
      ok(read.status === 200 && Array.isArray(read.body) && read.body.length === 0, `API returns no ${m.table} rows while ${m.key} is off`);
      if (m.member) {
        await priya.goto(APP + m.member.replace('EVENT', eventId()), { waitUntil: 'networkidle' });
        await priya.waitForTimeout(2000);
        ok(/isn.t offered by/i.test(await priya.innerText('body')), `member ${m.member} says it isn't offered`);
        await shot(priya, `9-member-${m.key}-off`);
      }
      if (m.key === 'events') {
        const r = await rest(kiranTok, 'rpc/check_in', { method: 'POST', body: JSON.stringify({ p_event: eventId(), p_token: 'x', p_station: 'lookup' }) });
        ok(r.status >= 400 && /switched off/i.test(JSON.stringify(r.body)), 'check_in refuses while Events is off');
        await priya.goto(APP + '/', { waitUntil: 'networkidle' });
        await priya.waitForTimeout(2000);
        await priya.goto(APP + '/events', { waitUntil: 'networkidle' });
        await priya.waitForTimeout(2000);
        // The Events tab stays for Calendar and Photos (their own modules); the event list goes.
        ok(!(await priya.getByRole('tab', { name: 'Upcoming' }).count()), 'member Events tab hides the Upcoming events list');
      }
      if (m.key === 'store') {
        const r = await rest(priyaTok, 'rpc/cancel_my_store_order', { method: 'POST', body: JSON.stringify({ p_order: sql(`select id from app.store_orders order by created_at desc limit 1`) }) });
        ok(r.status >= 400 && /switched off/i.test(JSON.stringify(r.body)), 'cancel_my_store_order refuses while the Store is off');
      }
      const on = await setModule(m.key, true, `E2E: ${m.key} back on`);
      ok(on.status < 300 && sql(`select enabled::text from app.center_modules where center_id='${center}' and module_key='${m.key}'`) === 'true', `${m.key} switched back on`);
    }
    const audited = Number(sql(`select count(*) from app.audit_log where record_table='center_modules' and reason like 'E2E: %' and client_app='portal' and occurred_at > now() - interval '15 minutes'`));
    ok(audited >= MODS.length * 2, `module switches are audited with their reason (${audited} rows)`);

    // Roles: a member cannot check in, move stock or publish; a volunteer only checks in for her event.
    const id = eventId();
    const tok = sql(`select ticket_token from app.attendees where event_id='${id}' limit 1`);
    let r = await rest(priyaTok, 'rpc/check_in', { method: 'POST', body: JSON.stringify({ p_event: id, p_token: tok, p_station: 'food' }) });
    ok(r.status >= 400 && /not allowed/i.test(JSON.stringify(r.body)), 'a member cannot check anyone in');
    r = await rest(priyaTok, 'inventory_movements', { method: 'POST', body: JSON.stringify({ center_id: center, item_id: sql(`select id from app.store_items limit 1`), delta: 100, reason: 'received' }) });
    ok(r.status >= 400, `a member cannot record stock (${r.status})`);
    r = await rest(priyaTok, `events?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'cancelled' }) });
    ok(Array.isArray(r.body) ? r.body.length === 0 : r.status >= 400, 'a member cannot change an event');
    const other = sql(`select id from app.events where name='Diwali puja & new year'`);
    r = await rest(kiranTok, 'rpc/check_in', { method: 'POST', body: JSON.stringify({ p_event: other, p_token: 'x', p_station: 'lookup' }) });
    ok(r.status >= 400 && /not allowed/i.test(JSON.stringify(r.body)), 'the volunteer cannot check in for an event she is not on');
    r = await rest(kiranTok, 'store_orders?select=id&limit=5');
    ok(r.status === 200 && Array.isArray(r.body) && r.body.length === 0, "the volunteer sees no one else's store orders");
    r = await rest(priyaTok, 'store_orders', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ center_id: center, household_id: sql(`select household_id from app.household_members hm join app.people p on p.id=hm.person_id where p.member_number='JSH-90001' limit 1`), status: 'cart', total_cents: 1 }) });
    if (r.status < 300) {
      const cartId = r.body[0].id;
      const item = sql(`select id from app.store_items where name='Chakri'`);
      await rest(priyaTok, 'store_order_lines', { method: 'POST', body: JSON.stringify({ center_id: center, order_id: cartId, item_id: item, quantity: 2, unit_price_cents: 1, line_total_cents: 2 }) });
      r = await rest(priyaTok, `store_orders?id=eq.${cartId}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'placed', pickup_window_id: sql(`select id from app.pickup_windows where status='open' order by starts_at limit 1`) }) });
      ok(sql(`select total_cents from app.store_orders where id='${cartId}'`) === String(2 * Number(sql(`select price_cents from app.store_items where id='${item}'`))), 'a tampered price is replaced by the store price when the order is placed');
      r = await rest(priyaTok, 'rpc/cancel_my_store_order', { method: 'POST', body: JSON.stringify({ p_order: cartId }) });
      ok(r.status < 300 && sql(`select status from app.store_orders where id='${cartId}'`) === 'cancelled', 'the member can cancel her own order before the cutoff');
      ok(lastAudit('store_orders', `and record_id='${cartId}'`).includes('Member cancelled the order'), 'the cancellation carries its reason in the audit log');
    } else ok(false, `member could not start a cart over the API (${r.status} ${JSON.stringify(r.body)})`);
  }

  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exitCode = failures ? 1 : 0;
})().catch((e) => {
  console.error('FLOW FAILED:', e);
  process.exit(1);
});
