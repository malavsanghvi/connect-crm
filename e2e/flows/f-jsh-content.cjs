// Wave F · f-jsh-content — end-to-end against a real local stack (bash e2e/up.sh f-jsh-content 200).
// Plain Node + Playwright; every step is asserted in the database as well as on screen.
//
//   (cd worker && pnpm build)          # the flow starts the worker as connect_worker
//   portal built against the stack and started on :3300 (next start -p 3300),
//   the member app exported against the stack and served: node e2e/serve-spa.cjs /tmp/claude-0/f-jsh-content-web 8300
//   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright PORTAL=http://localhost:3300 MEMBER=http://localhost:8300 \
//   MAIL=http://localhost:55524 API=http://localhost:55521 DB=postgres://postgres:postgres@localhost:55632/postgres \
//   ENVF=e2e/.env.f-jsh-content node e2e/flows/f-jsh-content.cjs [journey ...]
//
// Journeys (in order; all by default):
//   stream     JSH's live stream: Content › Today & darshan lists it as Live with a preview player; in the member
//              app Home offers "Watch live darshan", Learn › Library shows it LIVE and Play opens the full-screen
//              player with the stream embedded.
//   calendar   the calendars from JSH's website: Calendar › Layers lists the six layers following their links;
//              the imported events are in Events; the member app's calendar shows the layers, today's panchang
//              entry and a Saturday Bhaktamber session with its Zoom link.
//   giving     the Jain donation opportunities: in Giving › Opportunities and in the member app's Give tab.
//   subscribe  a staff member adds a layer subscribed to an ICS link served by a local mock; the background
//              service imports its entries (and events); "Refresh now" changes nothing; after the calendar
//              changes, a refresh moves one date and removes another.
//
// Test data only: the mock calendar and its layer are created here (the layer's name carries a run id).
'use strict';
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const { acceptLegalStep } = require('../legal-step.cjs');
const { execSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const PORTAL = process.env.PORTAL || 'http://localhost:3300';
const MEMBER = process.env.MEMBER || 'http://localhost:8300';
const MAIL = process.env.MAIL || 'http://localhost:55524';
const DB = process.env.DB || 'postgres://postgres:postgres@localhost:55632/postgres';
const OUT = process.env.OUT || '/tmp/claude-0/streams/f-jsh-content';
const MOCK_PORT = Number(process.env.MOCK_PORT || 8310);
const WORKER_JS = process.env.WORKER_JS || path.join(__dirname, '..', '..', 'worker', 'dist', 'server.js');
const JSH = '00000000-0000-4000-8000-000000000001';
const STREAM = 'https://rtsp.me/embed/FR8NYFzs/';
const RUN = Date.now().toString(36);
fs.mkdirSync(OUT, { recursive: true });

const sql = (q) => execSync(`psql "${DB}" -qAtX -v ON_ERROR_STOP=1`, { input: q }).toString().trim();
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) { failures++; process.exitCode = 1; } };
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }).catch(() => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 30000, every = 500) {
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
  await acceptLegalStep(p, sql);
  return p;
}

const text = async (p, sel = 'body') => (await p.innerText(sel).catch(() => '')) || '';

// ── The mock calendar (a public ICS link, served on localhost) ─────────────────────────────
function ics(events) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//e2e//mock//EN', 'X-WR-CALNAME:Mock community calendar', 'X-WR-TIMEZONE:America/Chicago'];
  for (const e of events) lines.push('BEGIN:VEVENT', ...e, 'END:VEVENT');
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
const FEED_V1 = ics([
  ['UID:mock-1@e2e', 'SUMMARY:Mock Snatra Puja', 'DTSTART;TZID=America/Chicago:20261011T093000', 'DTEND;TZID=America/Chicago:20261011T103000', 'LOCATION:Derasar'],
  ['UID:mock-2@e2e', 'SUMMARY:Mock Swadhyay (online)', 'DTSTART;TZID=America/Chicago:20261007T193000', 'DTEND;TZID=America/Chicago:20261007T203000',
   'RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=4', 'LOCATION:https://example.org/zoom', 'DESCRIPTION:Zoom Link: https://example.org/zoom\\nPasscode: 108'],
  ['UID:mock-3@e2e', 'SUMMARY:Mock Picnic', 'DTSTART;VALUE=DATE:20261101', 'DTEND;VALUE=DATE:20261102'],
]);
const FEED_V2 = ics([
  ['UID:mock-1@e2e', 'SUMMARY:Mock Snatra Puja', 'DTSTART;TZID=America/Chicago:20261018T093000', 'DTEND;TZID=America/Chicago:20261018T103000', 'LOCATION:Derasar'],
  ['UID:mock-2@e2e', 'SUMMARY:Mock Swadhyay (online)', 'DTSTART;TZID=America/Chicago:20261007T193000', 'DTEND;TZID=America/Chicago:20261007T203000',
   'RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=4', 'LOCATION:https://example.org/zoom', 'DESCRIPTION:Zoom Link: https://example.org/zoom\\nPasscode: 108'],
]);

const journeys = {
  async stream(browser) {
    ok(sql(`select count(*) from app.content_items where center_id = '${JSH}' and kind = 'darshan_stream' and media_url = '${STREAM}' and status = 'published'`) === '1',
      'stream: JSH has its live stream (published darshan stream)');
    const p = await portalLogin(browser, 'admin@jsh.test');
    await p.goto(PORTAL + '/content/today', { waitUntil: 'networkidle' });
    const body = await text(p, 'main');
    ok(body.includes('JSH live stream') && body.includes('rtsp.me · embedded player') && body.includes('Watch live darshan'),
      'stream: Content › Today & darshan lists "JSH live stream" (rtsp.me) and the Home preview says "Watch live darshan"');
    ok((await p.locator(`iframe[src="${STREAM}"]`).count()) === 1, 'stream: the portal shows a preview player of the stream');
    await shot(p, 'stream-1-portal-today');
    await p.context().close();

    const m = await memberLogin(browser, 'priya@jsh.test');
    await m.goto(MEMBER + '/', { waitUntil: 'networkidle' });
    const watch = m.getByText(/Watch live darshan/).first();
    ok(await watch.isVisible({ timeout: 20000 }).catch(() => false), 'stream: the member app\'s Home offers "Watch live darshan"');
    await shot(m, 'stream-2-member-home');
    await watch.click();
    await m.waitForTimeout(2500);
    const lib = await text(m);
    ok(lib.includes('LIVE') && lib.includes('JSH live stream'), 'stream: it opens Learn › Library, which shows the stream LIVE');
    await shot(m, 'stream-3-member-library');
    await m.getByRole('button', { name: 'Play live darshan' }).first().click();
    await m.waitForURL(/\/darshan/, { timeout: 15000 }).catch(() => {});
    const frame = m.locator(`iframe[src="${STREAM}"]`);
    ok(await frame.waitFor({ timeout: 15000 }).then(() => true, () => false), 'stream: Play opens the full-screen player with the stream embedded (web export: iframe)');
    ok((await text(m)).includes('Live darshan'), 'stream: the player screen is titled "Live darshan"');
    await shot(m, 'stream-4-member-player');
    await m.context().close();
  },

  async calendar(browser) {
    const layers = sql(`select string_agg(name || '|' || feed_status, ',' order by name) from app.calendar_layers where center_id = '${JSH}' and feed_subscribed`);
    ok(['Bhaktamber sessions (online)|ok', 'Jain Panchang|ok', 'JSH events|ok', 'Pathshala|ok', 'SHINE online sessions|ok', 'School calendar (FBISD)|ok'].every((l) => layers.includes(l)),
      `calendar: six JSH layers follow their calendar links (${layers})`);
    ok(sql(`select count(*) from app.events e join app.calendar_entries ce on ce.event_id = e.id join app.calendar_layers l on l.id = ce.layer_id where e.center_id = '${JSH}' and l.kind = 'events'`) === '16',
      'calendar: the 16 JSH events were created from the events calendar');
    ok(sql(`select status || '|' || venue from app.events where center_id = '${JSH}' and name = 'Navpad Puja'`) === 'published|Derasar'
      && sql(`select status from app.events where center_id = '${JSH}' and name = 'Bhaktamar Diya Vidhan'`) === 'completed',
      'calendar: upcoming events are published with their venue, past ones completed');

    const p = await portalLogin(browser, 'admin@jsh.test');
    await p.goto(PORTAL + '/calendar', { waitUntil: 'networkidle' });
    const body = await text(p, 'main');
    ok(['Jain Panchang', 'Bhaktamber sessions (online)', 'SHINE online sessions', 'School calendar (FBISD)'].every((n) => body.includes(n)),
      'calendar: Calendar › Layers lists the new layers');
    ok((body.match(/Calendar link · calendar\.google\.com/g) || []).length === 6 && body.includes('Refreshed'),
      'calendar: each follows its calendar.google.com link and shows its last refresh');
    ok(body.includes('From the calendar link') || body.includes('From Events'), 'calendar: imported entries are marked as coming from the link');
    await shot(p, 'calendar-1-portal-layers');
    await p.goto(PORTAL + '/events', { waitUntil: 'networkidle' });
    const ev = await text(p, 'main');
    ok(ev.includes('Navpad Puja') || ev.includes('Tapasvi Bahuman - Stafford Civic Center'), 'calendar: the imported events are in Events');
    await shot(p, 'calendar-2-portal-events');
    await p.context().close();

    const m = await memberLogin(browser, 'priya@jsh.test');
    await m.goto(MEMBER + '/events?view=calendar', { waitUntil: 'networkidle' });
    await m.getByText('Show calendars').first().waitFor({ timeout: 20000 }).catch(() => {});
    for (const n of ['Jain Panchang', 'Bhaktamber sessions (online)', 'SHINE online sessions', 'School calendar (FBISD)']) {
      ok(await m.getByRole('checkbox', { name: n }).first().isVisible().catch(() => false), `calendar: the member app offers the "${n}" layer`);
    }
    ok((await text(m)).includes('CHAUDAS'), "calendar: today's panchang entry (Chaudas) shows on the selected day");
    await shot(m, 'calendar-3-member-today');
    const bhakt = m.getByRole('checkbox', { name: 'Bhaktamber sessions (online)' }).first();
    if ((await bhakt.getAttribute('aria-checked')) !== 'true') await bhakt.click();
    await m.getByRole('button', { name: /^Sat, Sep 26/ }).first().click();
    await m.waitForTimeout(800);
    const sat = await text(m);
    ok(sat.includes('JSH Bhaktamber Sessions (Saturday-Online)') && sat.includes('9:20 AM – 10:00 AM') && sat.includes('Meeting ID: 343 341 0593'),
      'calendar: Saturday shows the online Bhaktamber session with its time and meeting details');
    ok(await m.getByRole('link', { name: /Join or open the link: https:\/\/bit\.ly\/jshzoom/ }).first().isVisible().catch(() => false),
      'calendar: the session offers its Zoom link');
    await shot(m, 'calendar-4-member-saturday');
    await m.goto(MEMBER + '/events', { waitUntil: 'networkidle' });
    await m.waitForTimeout(2000);
    ok((await text(m)).includes('Tapasvi Bahuman - Stafford Civic Center'), 'calendar: the member app lists the next imported event in Upcoming');
    await shot(m, 'calendar-5-member-upcoming');
    await m.context().close();
  },

  async giving(browser) {
    const want = ['Jiv Daya gift', 'Sadharan gift', 'Dev Dravya gift', 'Gyan Dravya gift', 'Sadhu-Sadhvi Vaiyavach gift', 'Sponsor Ayambil Oli',
      'Sponsor the Paryushan Swamivatsalya', 'Sponsor Pathshala', 'Sponsor an aangi or pooja', 'Anukampa gift'];
    ok(sql(`select count(*) from app.opportunities where center_id = '${JSH}' and status = 'open' and name in (${want.map((w) => `'${w}'`).join(',')})`) === '10',
      'giving: ten open Jain donation opportunities');
    ok(sql(`select string_agg(c.name, ',' order by c.name) from app.campaigns c join app.funds f on f.id = c.fund_id where c.center_id = '${JSH}' and f.restricted and c.name in ('Dev Dravya','Aangi and pooja sponsorship','Jiv Daya','Gyan Dravya')`)
      === 'Aangi and pooja sponsorship,Dev Dravya,Gyan Dravya,Jiv Daya', 'giving: Dev Dravya, the aangi/pooja sponsorship, Jiv Daya and Gyan Dravya go to restricted funds');
    const p = await portalLogin(browser, 'admin@jsh.test');
    await p.goto(PORTAL + '/giving/opportunities', { waitUntil: 'networkidle' });
    const body = await text(p, 'main');
    const seen = want.filter((w) => body.includes(w));
    ok(seen.length === want.length, `giving: Giving › Opportunities lists them (${seen.length}/${want.length})`);
    await shot(p, 'giving-1-portal');
    await p.context().close();

    const m = await memberLogin(browser, 'priya@jsh.test');
    await m.goto(MEMBER + '/give', { waitUntil: 'networkidle' });
    await m.waitForTimeout(2500);
    const give = await text(m);
    const inApp = want.filter((w) => give.includes(w));
    ok(inApp.length === want.length, `giving: the member app's Give tab shows them (${inApp.length}/${want.length})`);
    await shot(m, 'giving-2-member-give');
    await m.getByText('Sponsor Ayambil Oli').first().click();
    await m.waitForTimeout(2500);
    const opp = await text(m);
    ok(opp.includes('Ayambil') && opp.includes('All nine days') && opp.includes('$2,251'), 'giving: the Ayambil Oli sponsorship shows its tiers');
    await shot(m, 'giving-3-member-ayambil');
    await m.context().close();
  },

  async subscribe(browser) {
    let feed = FEED_V1;
    let hits = 0;
    const server = http.createServer((req, res) => {
      hits++;
      res.writeHead(200, { 'content-type': 'text/calendar; charset=utf-8' });
      res.end(feed);
    });
    await new Promise((r) => server.listen(MOCK_PORT, r));
    const workerPw = process.env.WORKER_DB_PASSWORD || crypto.randomBytes(24).toString('hex');
    sql(`alter role connect_worker with password '${workerPw}'`);
    // JSH's own subscribed layers were refreshed by the seed; nothing else on the stack is due, so the hourly pass stays offline.
    sql(`update app.calendar_layers set feed_checked_at = now() where feed_subscribed and center_id = '${JSH}'`);
    const logs = [];
    const worker = spawn(process.execPath, [WORKER_JS], {
      env: { PATH: process.env.PATH, WORKER_DATABASE_URL: `postgres://connect_worker:${workerPw}@${new URL(DB).host}/postgres`, WORKER_ID: `e2e-jsh-${RUN}`,
             WORKER_HEALTH_PORT: process.env.WORKER_HEALTH_PORT || '3639', WORKER_POLL_MS: '500', WORKER_HEARTBEAT_MS: '5000', CALENDAR_FEEDS_ALLOW_PRIVATE: '1' },
    });
    worker.stdout.on('data', (d) => logs.push(...d.toString().trim().split('\n')));
    worker.stderr.on('data', (d) => logs.push(...d.toString().trim().split('\n')));
    const NAME = `Mock community calendar ${RUN}`;
    const layerSql = (col) => sql(`select ${col} from app.calendar_layers where center_id = '${JSH}' and name = '${NAME}'`);
    const entries = () => sql(`select count(*) from app.calendar_entries ce join app.calendar_layers l on l.id = ce.layer_id where l.name = '${NAME}'`);
    const events = () => sql(`select count(*) from app.calendar_entries ce join app.calendar_layers l on l.id = ce.layer_id where l.name = '${NAME}' and ce.event_id is not null`);
    const jobsDone = () => Number(sql(`select count(*) from app.jobs where kind = 'calendar.import_feed' and payload->>'layer_id' = (select id::text from app.calendar_layers where name = '${NAME}') and status = 'done'`));
    try {
      const p = await portalLogin(browser, 'admin@jsh.test');
      await p.goto(PORTAL + '/calendar', { waitUntil: 'networkidle' });
      await p.getByRole('button', { name: 'New layer' }).click();
      const d = p.getByRole('dialog').last();
      await d.getByLabel('Name').fill(NAME);
      await d.getByLabel('Calendar link (ICS, optional)').fill(`http://localhost:${MOCK_PORT}/calendar.ics`);
      await d.getByText('Also create an event for each date from the link').click();
      await d.getByText('On by default in the member app').click();
      await d.getByRole('button', { name: 'Add layer' }).click();
      await until(() => layerSql('feed_status') === 'ok' || layerSql('feed_status') === 'error', 45000);
      ok(layerSql('feed_status') === 'ok', `subscribe: the background service imported the calendar (${layerSql("feed_status || ' ' || coalesce(feed_error, '')")})`);
      ok(entries() === '6' && events() === '6', `subscribe: 6 dates (a one-off, a weekly session ×4, an all-day picnic), each with its event (${entries()}/${events()})`);
      ok(sql(`select ce.metadata->>'link' || '|' || (ce.metadata->>'notes') from app.calendar_entries ce join app.calendar_layers l on l.id = ce.layer_id where l.name = '${NAME}' and ce.title = 'Mock Swadhyay (online)' order by ce.starts_on limit 1`)
        === 'https://example.org/zoom|Zoom Link: https://example.org/zoom\nPasscode: 108', 'subscribe: the online session keeps its Zoom link and notes');
      ok(sql(`select count(*) from app.audit_log where record_table = 'calendar_entries' and action like '%insert%' and after->>'layer_id' = (select id::text from app.calendar_layers where name = '${NAME}')`) === '6',
        'subscribe: every imported entry is audited');
      await p.reload({ waitUntil: 'networkidle' });
      const layerRow = () => p.locator('tr', { hasText: NAME }).filter({ hasText: 'Calendar link ·' }).first();
      const row = layerRow();
      ok((await row.innerText()).includes('Refreshed') && (await row.innerText()).includes('6 added'), 'subscribe: Calendar › Layers shows the refresh and what it added');
      await shot(p, 'subscribe-1-imported');

      // Refresh now: nothing changes.
      const before = { entries: entries(), events: events(), updated: sql(`select max(updated_at) from app.events e join app.calendar_entries ce on ce.event_id = e.id join app.calendar_layers l on l.id = ce.layer_id where l.name = '${NAME}'`) };
      const done0 = jobsDone();
      const hits0 = hits;
      await row.getByRole('button', { name: `Calendar link for ${NAME}` }).click();
      const drawer = p.getByRole('dialog').last();
      await drawer.getByRole('button', { name: 'Refresh now' }).click();
      await until(() => jobsDone() > done0, 45000);
      ok(hits > hits0, 'subscribe: Refresh now fetched the calendar again');
      const r1 = JSON.parse(layerSql(`feed_result - 'feed'`) || '{}');
      ok(r1.inserted === 0 && r1.updated === 0 && r1.removed === 0 && r1.events_created === 0 && r1.events_updated === 0 && r1.unchanged === 6,
        `subscribe: the refresh changes nothing (${JSON.stringify(r1)})`);
      ok(entries() === before.entries && events() === before.events
        && sql(`select max(updated_at) from app.events e join app.calendar_entries ce on ce.event_id = e.id join app.calendar_layers l on l.id = ce.layer_id where l.name = '${NAME}'`) === before.updated,
        'subscribe: entries and events are untouched');
      await p.keyboard.press('Escape');

      // The calendar changes: one date moves, the picnic is dropped.
      feed = FEED_V2;
      const done1 = jobsDone();
      await p.reload({ waitUntil: 'networkidle' });
      await layerRow().getByRole('button', { name: `Calendar link for ${NAME}` }).click();
      await p.getByRole('dialog').last().getByRole('button', { name: 'Refresh now' }).click();
      await until(() => jobsDone() > done1, 45000);
      const r2 = JSON.parse(layerSql(`feed_result - 'feed'`) || '{}');
      ok(r2.updated === 1 && r2.removed === 1 && r2.events_updated === 1, `subscribe: after the calendar changed, one date moved and one was removed (${JSON.stringify(r2)})`);
      ok(sql(`select ce.starts_on || '|' || e.starts_at::text from app.calendar_entries ce join app.events e on e.id = ce.event_id join app.calendar_layers l on l.id = ce.layer_id where l.name = '${NAME}' and ce.title = 'Mock Snatra Puja'`)
        === '2026-10-18|2026-10-18 14:30:00+00', 'subscribe: the moved puja and its event follow the calendar');
      await p.keyboard.press('Escape');
      await p.reload({ waitUntil: 'networkidle' });
      await shot(p, 'subscribe-2-after-change');
      await p.context().close();
    } finally {
      worker.kill('SIGTERM');
      server.close();
      fs.writeFileSync(`${OUT}/worker.log`, logs.join('\n') + '\n');
    }
  },
};

(async () => {
  const wanted = process.argv.slice(2);
  const browser = await chromium.launch();
  try {
    for (const [name, fn] of Object.entries(journeys)) {
      if (wanted.length && !wanted.includes(name)) continue;
      console.log(`\n── ${name}`);
      try {
        await fn(browser);
      } catch (err) {
        ok(false, `${name}: ${String(err && err.stack || err).slice(0, 600)}`);
      }
    }
  } finally {
    await browser.close();
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
})();
