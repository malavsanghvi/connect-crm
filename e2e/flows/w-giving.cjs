// Giving, Bolis, Accounting and Reports: the key journeys, end to end, against a real stack.
// A member acts in the member web app, staff act in the portal, and every step is asserted
// in the database (row + app.audit_log with module, client_app, client_screen, reason).
//
//   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright BASE=http://localhost:3200 MEMBER=http://localhost:8300 \
//   MAIL=http://localhost:55424 API=http://localhost:55421 DB=postgres://postgres:postgres@localhost:55532/postgres \
//   ENVFILE=e2e/.env.w-giving OUT=/tmp/claude-0/streams/w-giving node e2e/flows/w-giving.cjs
//
// Journeys: 1 sponsorship → pledge → offline payment allocates → member sees it paid
//           2 digital boli: staff create + publish → member pledges → staff close early with a reason
//           3 recurring gift → pending_payment_method in the portal
//           4 birthday labh → fulfillment row → staff mark scheduled, then done
//           5 opportunity builder publish → visible in the member Give tab
//           6 month-end checklist and lock
//           7 publish a KPI → shown on the public /c/<slug> dashboard
//           8 module switch: Giving/Bolis/Accounting/Reports off → portal, member app and API refuse → back on
//          10 in-person boli: create → upload the hall results CSV → closed, audited with the file name
//           9 roles: a member's token cannot record payments, close bolis, publish, lock or publish KPIs
// ONLY=2,5 runs a subset. Re-runnable: each run uses its own names and amounts; it only needs the demo data from e2e/up.sh.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:3100';
const MEMBER = process.env.MEMBER || 'http://localhost:8200';
const MAIL = process.env.MAIL || 'http://localhost:55324';
const API = process.env.API || 'http://localhost:55321';
const DB = process.env.DB || 'postgres://postgres:postgres@localhost:55432/postgres';
const OUT = process.env.OUT || '/tmp/claude-0/streams/w-giving';
const ANON = process.env.ANON_KEY || fs.readFileSync(process.env.ENVFILE || `${__dirname}/../.env.e2e`, 'utf8').match(/ANON_KEY=(\S+)/)[1];
fs.mkdirSync(OUT, { recursive: true });
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (n) => !ONLY.length || ONLY.includes(String(n));
const RUN = Date.now().toString(36).slice(-5);
const sql = (q) => execSync(`psql "${DB}" -Atc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };
const shot = (p, name) => p.screenshot({ path: `${OUT}/flow-${name}.png`, fullPage: true }).catch(() => {});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) { const end = Date.now() + ms; let v; while (Date.now() < end) { v = fn(); if (v) return v; await wait(500); } return v; }
/** Latest audit row for a table since `since`: "module|client_app|client_screen|reason". */
const audit = (table, since, action) =>
  sql(`select coalesce(module,'')||'|'||coalesce(client_app,'')||'|'||coalesce(client_screen,'')||'|'||coalesce(reason,'') from app.audit_log
       where record_table=${lit(table)} and id>${since}${action ? ` and action=${lit(action)}` : ''} order by id desc limit 1`);
const auditMark = () => Number(sql('select coalesce(max(id),0) from app.audit_log'));

async function code(email, after) {
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + email)}`).then((x) => x.json());
    const m = (r.messages || []).find((x) => new Date(x.Created).getTime() >= after);
    if (m) { const f = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((x) => x.json()); const c = (f.Text || '').match(/\b(\d{6,10})\b/); if (c) return c[1]; }
    await wait(500);
  }
  throw new Error('no sign-in code for ' + email);
}
async function portalLogin(b, email) {
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p.goto(BASE + '/login'); const t0 = Date.now() - 2000;
  await p.fill('input[name=email]', email); await p.click('button[type=submit]');
  await p.waitForSelector('input[name=code]'); await p.fill('input[name=code]', await code(email, t0));
  await p.click('button[type=submit]'); await p.waitForURL((u) => !u.pathname.startsWith('/login'));
  return p;
}
async function memberLogin(b, email) {
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await p.goto(MEMBER + '/sign-in', { waitUntil: 'networkidle' }); const t0 = Date.now() - 2000;
  await p.fill('input[placeholder="name@example.com"]', email);
  await p.getByRole('button', { name: /send|code|continue/i }).first().click();
  const box = p.locator('input[inputmode=numeric], input[autocomplete=one-time-code]').first(); await box.waitFor({ timeout: 20000 });
  await box.fill(await code(email, t0));
  const v = p.getByRole('button', { name: /verify|sign in|continue/i }).first(); if (await v.isVisible().catch(() => false)) await v.click();
  await p.waitForTimeout(4000);
  return p;
}
async function mgo(p, path) { await p.goto(MEMBER + path, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500); }
async function pgo(p, path) { await p.goto(BASE + path, { waitUntil: 'networkidle' }); }
async function token(email) {
  const t0 = Date.now() - 2000;
  const r = await fetch(API + '/auth/v1/otp', { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, create_user: false }) });
  if (!r.ok) throw new Error('otp ' + r.status);
  const v = await fetch(API + '/auth/v1/verify', { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, token: await code(email, t0), type: 'email' }) });
  const j = await v.json(); if (!j.access_token) throw new Error('verify failed for ' + email); return j.access_token;
}
async function rest(tok, path, o = {}) {
  const r = await fetch(API + '/rest/v1/' + path, {
    method: o.method || 'GET',
    headers: { apikey: ANON, Authorization: 'Bearer ' + tok, 'content-type': 'application/json', 'Accept-Profile': 'app', 'Content-Profile': 'app', 'x-client-app': 'job', 'x-client-screen': 'e2e/w-giving', ...(o.headers || {}) },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
}

(async () => {
  const b = await chromium.launch();
  const center = sql("select id from app.centers where slug='jsh'");
  const shah = sql("select id from app.households where household_number='JSH-H-9001'");
  const staff = await portalLogin(b, 'admin@jsh.test');
  const member = await memberLogin(b, 'priya@jsh.test');

  // ── 1. Sponsorship → pledge → offline payment allocates → member sees it paid ──────────────
  if (want(1)) {
    const opp = sql("select id from app.opportunities where name='Platinum sponsor' limit 1");
    const before = sql(`select coalesce(max(pledge_number),'') from app.pledges where opportunity_id='${opp}'`);
    let mark = auditMark();
    await mgo(member, '/give'); await member.getByText('Platinum sponsor').first().click(); await member.waitForTimeout(2500);
    await member.getByRole('button', { name: /^Commit \$5,000 as a pledge$/ }).click();
    const num = await until(() => { const n = sql(`select coalesce(max(pledge_number),'') from app.pledges where opportunity_id='${opp}'`); return n && n !== before ? n : ''; });
    await member.waitForTimeout(1000); await shot(member, '1-member-committed');
    ok(Boolean(num), `1 member committed the Platinum sponsorship as pledge ${num}`);
    ok(sql(`select amount_cents||'|'||status from app.pledges where pledge_number='${num}'`) === '500000|open', '1 pledge is $5,000 and open');
    ok(audit('pledges', mark, 'pledges.insert').startsWith(`giving|member|/opportunity/${opp}|`), '1 audit: giving | member | /opportunity/<id>');
    await pgo(staff, '/giving/pledges');
    ok((await staff.innerText('main')).includes(num), `1 portal Pledges lists ${num}`);
    mark = auditMark();
    await pgo(staff, '/giving/payments?household=' + shah); await staff.waitForTimeout(1500);
    await staff.getByRole('radiogroup', { name: 'Method' }).getByRole('radio', { name: 'Check' }).click();
    await staff.fill('#pay-amount', '5000'); await staff.fill('#pay-ref', '#' + RUN);
    await staff.locator(`button[title^="${num}"]`).click();
    await staff.getByRole('button', { name: 'Save payment' }).click();
    await staff.getByText('Payment recorded').first().waitFor({ timeout: 20000 });
    await shot(staff, '1-portal-payment');
    ok(sql(`select paid_cents||'|'||status from app.pledges where pledge_number='${num}'`) === '500000|paid', '1 payment allocated: pledge paid in full');
    ok(sql(`select count(*) from app.payment_allocations a join app.pledges p on p.id=a.pledge_id where p.pledge_number='${num}'`) === '1', '1 one allocation row');
    ok(audit('payments', mark, 'payments.insert').startsWith('giving|portal|/giving/payments|'), '1 audit: payment giving | portal | /giving/payments');
    ok(audit('payment_allocations', mark).startsWith('giving|portal|/giving/payments|'), '1 audit: allocation from the portal');
    await mgo(member, '/pledges');
    const t = await member.innerText('body'); const at = t.indexOf(num);
    ok(at >= 0 && /Paid /.test(t.slice(at, at + 80)), `1 member Family pledges shows ${num} paid`);
    await shot(member, '1-member-paid');
  }

  // ── 2. Digital boli: create + publish → member pledges → close early with a reason ─────────
  if (want(2)) {
    const name = `Aarti labh ${RUN}`;
    let mark = auditMark();
    await pgo(staff, '/bolis');
    await staff.locator('input[name=name]').first().fill(name);
    await staff.locator('input[name=floor]').first().fill('151');
    await staff.locator('input[name=step]').first().fill('11');
    const closes = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) + 'T19:00';
    await staff.locator('input[name=closes_at]').first().fill(closes);
    await staff.getByRole('button', { name: 'Create boli' }).click();
    const boli = await until(() => sql(`select id from app.bolis where name=${lit(name)}`));
    ok(Boolean(boli), '2 staff created the digital boli (draft)');
    await pgo(staff, '/bolis');
    await staff.locator('main table tr').filter({ hasText: name }).first().click(); await staff.waitForTimeout(1500);
    await staff.getByRole('dialog').getByRole('button', { name: /^Publish/ }).first().click();
    await staff.waitForTimeout(800);
    await staff.getByRole('dialog').last().getByRole('button', { name: /^Publish/ }).last().click(); // the confirm modal
    ok(Boolean(await until(() => sql(`select status from app.bolis where id='${boli}'`) === 'open')), '2 boli published (open)');
    await mgo(member, '/bolis'); await member.getByText(name).first().click(); await member.waitForTimeout(2500);
    await member.getByRole('button', { name: /^Pledge \$151$/ }).click(); await member.waitForTimeout(800);
    await member.getByRole('button', { name: /^Pledge \$151$/ }).last().click();
    ok(Boolean(await until(() => sql(`select amount_cents from app.boli_entries where boli_id='${boli}'`) === '15100')), '2 member pledged $151 on the boli');
    ok(audit('boli_entries', mark).startsWith(`bolis|member|/boli/${boli}|`), '2 audit: bolis | member | /boli/<id>');
    await shot(member, '2-member-pledged');
    await pgo(staff, '/bolis');
    await staff.locator('main table tr').filter({ hasText: name }).first().click(); await staff.waitForTimeout(1500);
    ok((await staff.getByRole('dialog').first().innerText()).includes('$151.00'), '2 staff see the entry in the boli drawer');
    mark = auditMark();
    const reason = `Called early in the hall · run ${RUN}`;
    await staff.getByRole('button', { name: 'Close early' }).click();
    await staff.fill('#bd-reason', reason);
    await staff.getByRole('dialog').last().getByRole('button', { name: 'Close early' }).click();
    ok(Boolean(await until(() => sql(`select status from app.bolis where id='${boli}'`) === 'closed')), '2 boli closed');
    ok(sql(`select closed_reason from app.bolis where id='${boli}'`) === reason, '2 closed_reason stored');
    ok(sql(`select (winner_pledge_id is not null)::text from app.bolis where id='${boli}'`) === 'true', '2 winner became a pledge');
    ok(audit('bolis', mark, 'bolis.update') === `bolis|portal|/bolis|${reason}`, '2 audit: close carries portal, /bolis and the reason');
    ok(audit('pledges', mark, 'pledges.insert').endsWith(`|${reason}`), '2 audit: the winning pledge carries the reason too');
    await shot(staff, '2-portal-closed');
  }

  // ── 3. Recurring gift → pending_payment_method in the portal ────────────────────────────────
  if (want(3)) {
    const mark = auditMark();
    await mgo(member, '/recurring-setup');
    await member.getByText('Jeevdaya', { exact: true }).first().click();
    await member.getByText('Other', { exact: true }).first().click();
    const amt = String(20 + (parseInt(RUN, 36) % 70));
    await member.locator('input').last().fill(amt);
    await member.getByText('Quarterly', { exact: true }).first().click();
    await member.getByRole('button', { name: 'Start recurring gift' }).click();
    const row = await until(() => sql(`select id||'|'||status||'|'||frequency from app.recurring_gifts where household_id='${shah}' and amount_cents=${amt}00 and created_at > now() - interval '2 minutes' order by created_at desc limit 1`));
    ok(/\|pending_payment_method\|quarterly$/.test(row), `3 member's $${amt} quarterly gift saved as pending_payment_method`);
    ok(audit('recurring_gifts', mark).startsWith('giving|member|/recurring-setup|'), '3 audit: giving | member | /recurring-setup');
    await member.waitForTimeout(1000); await shot(member, '3-member-recurring');
    await pgo(staff, '/giving/recurring?status=pending_payment_method');
    const tr = staff.locator('main table tr').filter({ hasText: `$${amt}.00` }).first();
    const txt = await tr.innerText().catch(() => '');
    ok(/Jeevdaya/.test(txt) && /Waiting for a payment method/.test(txt) && /Quarterly/.test(txt), '3 portal Recurring shows Jeevdaya · Quarterly · Waiting for a payment method');
    await shot(staff, '3-portal-recurring');
  }

  // ── 4. Labh → fulfillment → scheduled → done ────────────────────────────────────────────────
  if (want(4)) {
    const day = sql("select id from app.special_days where label='Anya''s birthday' limit 1");
    const mark = auditMark();
    const dedication = `In honor of Anya · ${RUN}`;
    await mgo(member, '/labh/' + day);
    await member.getByText('Jeevdaya donation').click();
    await member.locator('textarea, input[type=text], input:not([type])').last().fill(dedication);
    await member.getByRole('button', { name: /^Commit \$51 as a pledge$/ }).click();
    const pl = await until(() => sql(`select id from app.pledges where dedication=${lit(dedication)}`));
    ok(Boolean(pl), '4 member committed the Jeevdaya labh');
    ok(sql(`select status from app.labh_fulfillments where pledge_id='${pl}'`) === 'to_schedule', '4 fulfillment row to_schedule');
    ok(audit('labh_fulfillments', mark).startsWith(`giving|member|/labh/${day}|`), '4 audit: giving | member | /labh/<day>');
    await pgo(staff, '/giving/labh');
    const row = () => staff.locator('main table tr').filter({ hasText: dedication }).first();
    await row().getByRole('button', { name: 'Mark scheduled' }).click();
    ok(Boolean(await until(() => sql(`select status from app.labh_fulfillments where pledge_id='${pl}'`) === 'scheduled')), '4 staff marked it scheduled');
    await staff.waitForTimeout(1500);
    await row().getByRole('button', { name: 'Mark done' }).click();
    ok(Boolean(await until(() => sql(`select status from app.labh_fulfillments where pledge_id='${pl}'`) === 'done')), '4 staff marked it done');
    ok(audit('labh_fulfillments', mark, 'labh_fulfillments.update').startsWith('giving|portal|/giving/labh|'), '4 audit: giving | portal | /giving/labh');
    await shot(staff, '4-portal-labh');
  }

  // ── 5. Opportunity builder: publish → visible in the member app ─────────────────────────────
  if (want(5)) {
    const name = `Parna sponsorship ${RUN}`;
    const mark = auditMark();
    await pgo(staff, '/giving/opportunities');
    await staff.fill('#op-name', name);
    await staff.getByRole('radiogroup', { name: 'Type' }).getByRole('radio', { name: 'Sponsorship tiers' }).click();
    await staff.selectOption('#op-campaign', { label: 'Swamivatsalya sponsorship' });
    await staff.fill('[aria-label="Tier 1 name"]', 'Gold'); await staff.fill('[aria-label="Amount 1"]', '1100');
    await staff.getByRole('button', { name: 'Publish opportunity' }).click();
    const id = await until(() => sql(`select id from app.opportunities where name=${lit(name)} and status='open'`));
    ok(Boolean(id), '5 opportunity published (open, tier)');
    ok(audit('opportunities', mark, 'opportunities.insert').startsWith('giving|portal|/giving/opportunities|'), '5 audit: giving | portal | /giving/opportunities');
    await mgo(member, '/give');
    ok((await member.innerText('body')).includes(name), '5 member Give tab lists it');
    await member.getByText(name).first().click(); await member.waitForTimeout(2000);
    ok(/Commit \$1,100 as a pledge/.test(await member.innerText('body')), '5 member sees the Gold tier ($1,100)');
    await shot(member, '5-member-opportunity');
  }

  // ── 6. Month-end checklist and lock ─────────────────────────────────────────────────────────
  if (want(6)) {
    await pgo(staff, '/accounting/close');
    const months = await staff.getByRole('navigation', { name: 'Month' }).getByRole('link').allInnerTexts().catch(() => []);
    const labels = months.length ? months : await staff.locator('main a').filter({ hasText: /20\d\d$/ }).allInnerTexts();
    let target = null;
    // Prefer a past month: locking the current month on a shared stack stops every later flow's
    // payment from posting to QuickBooks (o-quickbooks), so it is the last choice.
    const nowLabel = new Date().toLocaleString('en-US', { month: 'short', year: 'numeric' }).replace(',', '');
    const nowLong = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' }).replace(',', '');
    labels.sort((a, b) => ([nowLabel, nowLong].includes(a.trim()) ? 1 : 0) - ([nowLabel, nowLong].includes(b.trim()) ? 1 : 0));
    for (const label of labels) {
      const [mon, yr] = label.trim().split(' ');
      const m = String(new Date(`${mon} 1, ${yr}`).getMonth() + 1).padStart(2, '0');
      if (sql(`select coalesce((select status from app.accounting_periods where center_id='${center}' and period_month='${yr}-${m}-01'),'')`) !== 'closed') { target = { label: label.trim(), month: `${yr}-${m}-01`, short: mon, q: `${yr}-${m}` }; break; }
    }
    if (!target) ok(true, '6 SKIP: all three offered months are already locked on this stack');
    else {
      const mark = auditMark();
      await pgo(staff, `/accounting/close?month=${target.q}`);
      for (let i = 0; i < 3 && (await staff.getByRole('button', { name: 'Mark done' }).count()); i++) {
        await staff.getByRole('button', { name: 'Mark done' }).first().click(); await staff.waitForTimeout(2500);
      }
      ok(sql(`select checklist::text from app.accounting_periods where center_id='${center}' and period_month='${target.month}'`).split('true').length === 4, `6 ${target.label} checklist done`);
      await staff.getByRole('button', { name: `Lock ${target.short}` }).click();
      await staff.getByRole('dialog').getByRole('button', { name: 'Lock month' }).click();
      ok(Boolean(await until(() => sql(`select status from app.accounting_periods where center_id='${center}' and period_month='${target.month}'`) === 'closed')), `6 ${target.label} locked`);
      ok(audit('accounting_periods', mark, 'accounting_periods.update').startsWith('accounting|portal|/accounting/close|'), '6 audit: accounting | portal | /accounting/close');
      await staff.waitForTimeout(1500); await shot(staff, '6-portal-locked');
    }
  }

  // ── 7. Publish a KPI → shown on /c/<slug> ───────────────────────────────────────────────────
  if (want(7)) {
    const mark = auditMark();
    await pgo(staff, '/reports/community');
    const row = staff.locator('main table tr').filter({ has: staff.getByRole('button', { name: 'Publish', exact: true }) }).first();
    const kpi = (await row.locator('td').first().innerText()).trim();
    await row.getByRole('button', { name: 'Publish', exact: true }).click();
    ok(Boolean(await until(() => audit('public_kpi_settings', mark))), `7 published "${kpi}"`);
    ok(audit('public_kpi_settings', mark).startsWith('reports|portal|/reports/community|'), '7 audit: reports | portal | /reports/community');
    const slug = sql(`select slug from app.centers where id='${center}'`);
    const pub = await (await b.newContext()).newPage();
    await pub.goto(`${BASE}/c/${slug}`, { waitUntil: 'networkidle' }); await pub.waitForTimeout(2000);
    ok((await pub.innerText('body')).includes(kpi), `7 public /c/${slug} shows "${kpi}" (no sign-in)`);
    await shot(pub, '7-public-dashboard');
  }

  // ── 8. Module switch: off → portal, member app, API refuse → on ─────────────────────────────
  if (want(8)) {
    const admin = await token('admin@jsh.test'); const priya = await token('priya@jsh.test');
    const mods = ['bolis', 'accounting', 'reports', 'giving'];
    for (const m of mods) {
      const r = await rest(admin, 'rpc/set_module_enabled', { method: 'POST', body: { p_center: center, p_module: m, p_enabled: false, p_reason: `e2e w-giving ${RUN}: switch-off check` } });
      ok(r.status < 300, `8 switched ${m} off`);
    }
    try {
      await pgo(staff, '/');
      const nav = await staff.locator('aside, nav').first().innerText();
      ok(!/\bGiving\b|\bBolis\b|\bAccounting\b|\bReports\b/.test(nav), '8 portal nav hides Giving, Bolis, Accounting, Reports');
      for (const u of ['/giving/pledges', '/bolis', '/accounting/close', '/reports/community']) { await pgo(staff, u); ok(/switched off/i.test(await staff.innerText('main')), `8 portal ${u} shows the switched-off page`); }
      await pgo(staff, '/households/' + shah);
      ok(!/Record payment/.test(await staff.innerText('main')), '8 household page hides Record payment and money tabs');
      const pub = await (await b.newContext()).newPage(); await pub.goto(`${BASE}/c/jsh`, { waitUntil: 'networkidle' });
      ok(/isn't publishing its community dashboard/.test(await pub.innerText('body')), '8 public dashboard says it is not published');
      await mgo(member, '/');
      ok(!(await member.getByRole('link', { name: /^Give/ }).count()) && !(await member.getByRole('tab', { name: /^Give/ }).count()), '8 member app hides the Give tab');
      for (const u of ['/give', '/bolis', '/recurring-setup']) { await mgo(member, u); ok(/isn't offered by/.test(await member.innerText('body')), `8 member ${u} deep link shows "isn't offered"`); }
      await shot(member, '8-member-off');
      const r1 = await rest(priya, 'pledges?select=id'); ok(r1.status === 200 && r1.json.length === 0, '8 API: pledges read returns nothing');
      const r2 = await rest(priya, 'rpc/place_boli_entry', { method: 'POST', body: { p_boli: sql("select id from app.bolis limit 1"), p_household: shah, p_amount_cents: 999999, p_anonymous: false } });
      ok(r2.status >= 400 && /switched off/.test(r2.text), '8 API: place_boli_entry refuses — ' + (r2.json?.message || r2.status));
      const r3 = await rest(priya, 'pledges', { method: 'POST', body: { center_id: center, household_id: shah, amount_cents: 1000, source: 'general' } });
      ok(r3.status === 403, '8 API: inserting a pledge is refused by RLS');
      const hc = await rest(admin, 'rpc/household_card', { method: 'POST', body: { p_household: shah } });
      ok(hc.json?.[0] && hc.json[0].open_pledge_cents === null, '8 API: household_card hides open pledges while giving is off');
    } finally {
      for (const m of ['giving', 'bolis', 'accounting', 'reports']) {
        const r = await rest(admin, 'rpc/set_module_enabled', { method: 'POST', body: { p_center: center, p_module: m, p_enabled: true, p_reason: `e2e w-giving ${RUN}: switch back on` } });
        ok(r.status < 300, `8 switched ${m} back on`);
      }
    }
    ok(audit('center_modules', 0).endsWith(`switch back on`), '8 audit: the module switch carries its reason');
  }

  // ── 9. Roles: a member cannot do staff money actions over the API ───────────────────────────
  if (want(9)) {
    const priya = await token('priya@jsh.test');
    const mehta = sql("select id from app.households where household_number='JSH-H-9002'");
    const refused = [
      ['record_offline_payment', await rest(priya, 'rpc/record_offline_payment', { method: 'POST', body: { p_household: shah, p_amount_cents: 1000, p_method: 'cash', p_received_on: '2026-01-02' } })],
      ['insert a payment', await rest(priya, 'payments', { method: 'POST', body: { center_id: center, household_id: shah, amount_cents: 1000, method: 'cash', provider: 'offline' } })],
      ['close_boli', await rest(priya, 'rpc/close_boli', { method: 'POST', body: { p_boli: sql('select id from app.bolis limit 1'), p_reason: 'x' } })],
      ['publish an opportunity', await rest(priya, 'opportunities', { method: 'POST', body: { center_id: center, campaign_id: sql('select id from app.campaigns limit 1'), name: 'x', status: 'open' } })],
      ['lock a month', await rest(priya, 'accounting_periods', { method: 'POST', body: { center_id: center, period_month: '2020-01-01', status: 'closed' } })],
      ['publish a KPI', await rest(priya, 'public_kpi_settings', { method: 'POST', body: { center_id: center, kpi_key: 'events_held', visibility: 'public' } })],
      ['pledge for another household', await rest(priya, 'rpc/place_boli_entry', { method: 'POST', body: { p_boli: sql("select id from app.bolis where kind='digital' order by (status='open') desc, created_at desc limit 1"), p_household: mehta, p_amount_cents: 999999, p_anonymous: false } })],
    ];
    for (const [what, r] of refused) ok(r.status >= 400, `9 member cannot ${what} (${r.status} ${(r.json?.message || '').slice(0, 70)})`);
    const other = await rest(priya, `pledges?household_id=eq.${mehta}&select=id`);
    ok(other.status === 200 && other.json.length === 0, "9 member cannot read another household's pledges");
    const upd = await rest(priya, `labh_fulfillments?pledge_id=not.is.null&select=pledge_id`, { method: 'PATCH', body: { status: 'done' }, headers: { Prefer: 'return=representation' } });
    ok(upd.status === 200 && upd.json.length === 0, '9 member cannot change labh fulfillment (no rows changed)');
  }

  // ── 10. In-person boli: create → upload the hall results CSV → closed with an audited reason ─
  if (want(10)) {
    const name = `Kalash labh ${RUN}`;
    await pgo(staff, '/bolis');
    await staff.getByRole('radiogroup', { name: 'Type' }).getByRole('radio', { name: /^In-person/ }).first().click();
    await staff.locator('input[name=name]').first().fill(name);
    await staff.locator('input[name=floor]').first().fill('101');
    await staff.getByRole('button', { name: 'Create boli' }).click();
    const boli = await until(() => sql(`select id from app.bolis where name=${lit(name)} and kind='in_person'`));
    ok(Boolean(boli), '10 staff created the in-person boli');
    const csv = `${OUT}/in-person-bolis-${RUN}.csv`;
    fs.writeFileSync(csv, `Boli name,Event,Household ID or name,Amount,Called at\r\n${name},,JSH-H-9002,301,7:45 PM\r\n`);
    const mark = auditMark();
    await pgo(staff, '/bolis/upload');
    await staff.setInputFiles('input[type=file]', csv);
    await staff.getByRole('button', { name: /^Import 1 valid row$/ }).click({ timeout: 20000 });
    ok(Boolean(await until(() => sql(`select status from app.bolis where id='${boli}'`) === 'closed')), '10 upload recorded the result and closed the boli');
    ok(sql(`select amount_cents||'|'||is_in_person from app.boli_entries where boli_id='${boli}'`) === '30100|true', '10 in-person entry of $301 for the Mehta family');
    ok(sql(`select (winner_pledge_id is not null)::text from app.bolis where id='${boli}'`) === 'true', '10 winner became a pledge');
    ok(/^bolis\|portal\|\/bolis\/upload\|In-person result imported from in-person-bolis-/.test(audit('bolis', mark, 'bolis.update')), '10 audit: close carries portal, /bolis/upload and the file-name reason');
    await shot(staff, '10-portal-upload');
  }

  await b.close();
  console.log(process.exitCode ? 'w-giving flows: FAILURES above' : 'w-giving flows: all passed');
})().catch((e) => { console.error('FLOW FAILED:', e.message); process.exit(1); });
