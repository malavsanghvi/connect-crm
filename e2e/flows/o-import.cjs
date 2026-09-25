// Organization onboarding · o-import — loading an organization's data end to end, against a
// real local stack (bash e2e/up.sh o-import 500). Plain Node + Playwright; every step asserts
// the database.
//
//   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright PORTAL=http://localhost:3600 MEMBER=http://localhost:8700 \
//   MAIL=http://localhost:55824 API=http://localhost:55821 DB=postgres://postgres:postgres@localhost:55932/postgres \
//   ENVF=e2e/.env.o-import node e2e/flows/o-import.cjs
//
// The journey (Settings › Data import, as admin@jsh.test), with the files in e2e/fixtures/o-import:
//   1. setup data: membership types ("Life Member" → life), a fund, campaigns
//   2. records: households with legacy IDs (0212 matches the existing household ignoring nothing but
//      the leading zero), then a Neon-like people export with an extra "Senior status" column,
//      a duplicate by email (Priya) and a name-only look-alike (Rahul Shah)
//   3. current and past memberships
//   4. history: pledges with paid-so-far, then historical payments with the pledge each paid
//   and after each: Check → Preview → Import → Reconcile → sign off.
// Then it asserts:
//   - reconciled totals (payments per year, allocations, pledged and paid to the cent);
//   - "Senior status" became a custom field; it shows under More details on the person in the
//     portal, and — marked "member_self" in Settings › Custom fields — on Priya's own profile in
//     the member app;
//   - no historical payment was queued to QuickBooks (a go-live date is set, too);
//   - the name-only look-alike went to merge review, not merged;
//   - the audit rows carry "Import #n · file", client_app import and the run's request id;
//   - the data-quality view and the readiness check;
//   - undo (payments, then people) restores the prior state, audited with its reason.
// The AI mapping button is pressed once: without the background service it says so honestly.
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORTAL = process.env.PORTAL || 'http://localhost:3600';
const MEMBER = process.env.MEMBER || 'http://localhost:8700';
const MAIL = process.env.MAIL || 'http://localhost:55824';
const DB = process.env.DB || 'postgres://postgres:postgres@localhost:55932/postgres';
const OUT = process.env.OUT || '/tmp/claude-0/streams/o-import';
const FIX = path.join(__dirname, '..', 'fixtures', 'o-import');
const CENTER = '00000000-0000-4000-8000-000000000001';
fs.mkdirSync(OUT, { recursive: true });

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
  await p.waitForURL((u) => !/sign-in|verify/.test(u.pathname), { timeout: 60000 });
  return p;
}

/**
 * One file through the whole tool: Upload → Map → Check → Preview → Import → Reconcile → sign off.
 * Returns { id, number }.
 */
async function importFile(p, entity, file, source, opts = {}) {
  await p.goto(`${PORTAL}/settings/import/new?entity=${entity}`);
  await p.fill('#imp-source', source);
  await p.setInputFiles('#imp-file', path.join(FIX, file));
  await p.getByText(/rows, \d+ columns/).waitFor({ timeout: 20000 });
  await p.getByRole('button', { name: 'Next: map the columns' }).click();
  await p.getByRole('heading', { name: 'Map the columns' }).waitFor({ timeout: 30000 });
  if (opts.onMap) await opts.onMap(p);
  await shot(p, `${entity}-1-map`);
  await p.getByRole('button', { name: 'Next: check every row' }).click();
  await p.getByRole('heading', { name: 'Check every row' }).waitFor();
  if (opts.onCheck) await opts.onCheck(p);
  await shot(p, `${entity}-2-check`);
  await p.getByRole('button', { name: /^Next: preview/ }).click();
  await p.waitForURL(/\/settings\/import\/[0-9a-f-]{36}/, { timeout: 120000 });
  const id = p.url().match(/import\/([0-9a-f-]{36})/)[1];
  const number = Number(sql(`select run_number from app.import_runs where id = '${id}'`));
  await p.getByText('Will be added').first().waitFor({ timeout: 90000 });
  if (opts.onPreview) await opts.onPreview(p, id);
  await shot(p, `${entity}-3-preview`);
  await p.getByRole('button', { name: /^Import [\d,]+ rows$/ }).click();
  await p.getByRole('button', { name: 'Compare with the file' }).waitFor({ timeout: 180000 });
  // A click that lands while the refreshed page is still hydrating does nothing: press again.
  for (let attempt = 1; ; attempt++) {
    await p.getByRole('button', { name: 'Compare with the file' }).click();
    const done = await p.getByText(/Everything matches the file|Some numbers differ from the file/).waitFor({ timeout: 20000 }).then(() => true, () => false);
    if (done) break;
    if (attempt >= 3) throw new Error(`${entity}: the reconciliation did not appear`);
  }
  const matches = await p.getByText('Everything matches the file').isVisible();
  if (!matches) await p.fill('#signoff-note', 'Rows with problems were left out on purpose; listed in the problem rows.');
  await shot(p, `${entity}-4-reconcile`);
  await p.getByRole('button', { name: /^Sign off/ }).click();
  await p.getByText(/^Signed off /).waitFor({ timeout: 30000 });
  ok(sql(`select status from app.import_runs where id = '${id}'`) === 'reconciled', `${entity}: import #${number} imported, reconciled and signed off`);
  return { id, number, matches };
}

(async () => {
  // A QuickBooks go-live date: nothing received before it may ever post.
  sql(`insert into app.integration_connections (center_id, provider, status, settings) values ('${CENTER}', 'quickbooks_online', 'connected', '{"go_live_date":"2026-01-01"}')
       on conflict (center_id, provider) do update set settings = app.integration_connections.settings || '{"go_live_date":"2026-01-01"}'`);
  const before = {
    priya: sql(`select row_to_json(x)::text from (select email, phone_e164, custom from app.people where member_number = 'JSH-90001') x`),
    people: sql(`select count(*) from app.people`),
    postings: sql(`select count(*) from app.ledger_postings`),
  };

  const browser = await chromium.launch();
  const p = await portalLogin(browser, 'admin@jsh.test');
  p.on('pageerror', (e) => console.log('   portal pageerror:', String(e).slice(0, 200)));

  // ── 1. Setup data ─────────────────────────────────────────────────────────
  await p.goto(`${PORTAL}/settings/import`);
  await p.getByRole('heading', { name: 'Load order' }).waitFor();
  await shot(p, '0-data-import');
  const tpl = await p.request.get(`${PORTAL}/settings/import/template/people?format=xlsx`);
  ok(tpl.ok() && (tpl.headers()['content-type'] || '').includes('spreadsheetml'), 'the people template downloads as Excel');
  const dict = await (await p.request.get(`${PORTAL}/settings/import/template/pledges?format=dictionary`)).text();
  ok(dict.includes('Pledge number (old system)') && dict.includes('Kept as a custom field'), 'the column dictionary explains every column and custom fields');

  await importFile(p, 'membership_types', '1-membership-types.csv', 'Old membership list');
  ok(sql(`select tier || '|' || fee_cents from app.membership_types where key = 'senior_life'`) === 'life|150000', '"Life Member" was translated to the life tier; $1,500.00 became 150000 cents');
  await importFile(p, 'funds', '2-funds.csv', 'QuickBooks classes');
  await importFile(p, 'campaigns', '3-campaigns.csv', 'Neon campaigns');
  ok(sql(`select count(*) from app.campaigns where name in ('Paryushan 2019','Temple Renovation 2020') and status = 'closed'`) === '2', 'campaigns imported with their fund and status');

  // ── 2. Records ────────────────────────────────────────────────────────────
  const hh = await importFile(p, 'households', '4-households.csv', 'Neon export', {
    onPreview: async (pp) => ok(await pp.getByText('Matches an existing record by household id').first().isVisible(), 'household 0212 matches the existing household by its ID'),
  });
  ok(sql(`select city from app.households where household_number = 'JSH-H-9001'`) === 'Bellaire', 'the existing Shah household was updated, not duplicated');
  ok(sql(`select count(*) from app.external_ids where kind = 'org_household' and value = '0902'`) === '1'
     && sql(`select postal_code from app.households h join app.external_ids x on x.household_id = h.id where x.value = '0902'`) === '07494',
     'legacy household IDs and ZIP codes keep their leading zeros');

  let aiNote = '';
  const people = await importFile(p, 'people', '5-people-neon-export.csv', 'Neon export', {
    onMap: async (pp) => {
      const senior = pp.locator('select[aria-label=\'Where "Senior status" goes\']');
      ok((await senior.inputValue()) === 'custom', 'the unmatched "Senior status" column defaults to "Keep as a custom field"');
      ok((await pp.locator('select[aria-label=\'Custom field type for "Senior status"\']').inputValue()) === 'boolean', 'its type is guessed from the values (yes/no)');
      ok((await pp.locator('select[aria-label=\'Where "Account ID" goes\']').inputValue()) === 'field:legacy_id', 'Neon headers map by synonyms ("Account ID" → person ID)');
      await pp.getByRole('button', { name: 'Suggest matches with AI' }).click();
      await pp.getByText(/AI suggestions are not available|No AI suggestions|Suggested matches/).waitFor({ timeout: 90000 });
      aiNote = await pp.getByText(/AI suggestions are not available|No AI suggestions|Suggested matches/).first().innerText();
      ok(/not available|only name-based/i.test(aiNote) || /Suggested matches/.test(aiNote), `the AI mapping step is honest: "${aiNote.slice(0, 120)}"`);
    },
    onCheck: async (pp) => {
      ok(await pp.getByText(/Under 13: this child cannot sign in/).first().isVisible(), 'a child under 13 is flagged from the birth date');
      ok(await pp.getByText(/A child without a birth date/).first().isVisible(), 'a child without a birth date is flagged');
      ok(await pp.getByText(/opt-in counts only with its date and its source/).first().isVisible(), 'an opt-in without its source is left out, with a warning');
      const dl = pp.waitForEvent('download');
      await pp.getByRole('button', { name: 'Download the problem rows' }).click();
      const file = await (await dl).path();
      const csv = fs.readFileSync(file, 'utf8');
      ok(csv.startsWith('Row,Account ID') && /\n7,7006,.*Under 13/.test(csv), 'the problem rows download with their row numbers and what is wrong');
    },
    onPreview: async (pp) => {
      ok(await pp.getByText(/Only the name matches \d+ existing record/).first().isVisible(), 'the name-only look-alike (Rahul Shah) needs a decision');
      ok(await pp.getByText(/Matches an existing record by email/).first().isVisible(), 'the duplicate by email (Priya) matches the existing person');
    },
  });
  const rahulNew = sql(`select target_id from app.import_rows where run_id = '${people.id}' and source_key = '7005'`);
  ok(Number(sql(`select count(*) from app.merge_candidates where status = 'open' and kind = 'person' and left_id = '${rahulNew}'`)) >= 1, 'the name-only look-alike went to merge review (not merged)');
  ok(sql(`select count(*) from app.people where email = 'priya@jsh.test'`) === '1', 'the duplicate by email did not create a second Priya');
  // A staff-only value is kept apart from the member-readable row (0401): read the record's full set.
  ok(sql(`select app.import_current('people', id::text) -> 'custom' ->> 'senior_status' from app.people where member_number = 'JSH-90001'`) === 'true', '"Senior status" is kept on Priya as a custom value');
  ok(sql(`select (custom ? 'senior_status')::text from app.people where member_number = 'JSH-90001'`) === 'false', 'staff-only until reviewed, so it is not on the row members can read');
  ok(sql(`select type || '|' || sensitivity || '|' || source from app.custom_field_definitions where entity = 'people' and key = 'senior_status'`) === 'boolean|staff|import', 'the custom field is boolean, staff-only until reviewed, from the import');
  ok(sql(`select count(*) from app.channel_optins o join app.people p on p.id = o.person_id where p.email = 'neel.kapadia@example.com' and o.opted_in and o.source = 'Website form'`) === '1', 'an explicit opt-in with date and source is recorded');
  ok(sql(`select count(*) from app.channel_optins o join app.people p on p.id = o.person_id where p.email = 'asha.kapadia@example.com'`) === '0', 'an opt-in without its source is not counted');
  ok(sql(`select count(*) from app.channel_optins o join app.people p on p.id = o.person_id where p.member_number = 'JSH-90001' and not o.opted_in`) === '1', 'the opt-out is always imported');
  const audit = sql(`select count(*) || '|' || count(*) filter (where reason = 'Import #${people.number} · 5-people-neon-export.csv' and client_app = 'import'
                        and correlation_id = (select request_id from app.import_runs where id = '${people.id}')) || '|' || count(*) filter (where client_screen like '/settings/import/%')
                       from app.audit_log where correlation_id = (select request_id from app.import_runs where id = '${people.id}') and record_table in ('people','household_members','external_ids','channel_optins','merge_candidates')`);
  const [n1, n2, n3] = audit.split('|').map(Number);
  ok(n1 > 0 && n1 === n2 && n3 === n1, `every write of the people import is audited as "Import #${people.number} · file", app import, the run's request id and screen (${n1} rows)`);

  // "Senior status" on the person, in the portal (More details).
  const priyaId = sql(`select id from app.people where member_number = 'JSH-90001'`);
  await p.goto(`${PORTAL}/people/${priyaId}`);
  await p.getByRole('heading', { name: 'More details' }).waitFor();
  const md = p.locator('section', { has: p.getByRole('heading', { name: 'More details' }) });
  ok((await md.innerText()).includes('Senior status') && (await md.innerText()).includes('Yes'), '"Senior status: Yes" shows under More details on the person page');
  await shot(p, 'person-more-details');
  // Edited in place (audited), then put back.
  await md.getByRole('button', { name: 'Edit Senior status' }).click();
  await md.locator('select').selectOption('No');
  await md.getByRole('button', { name: 'Save' }).click();
  await p.getByText('Senior status saved.').waitFor();
  ok(sql(`select app.import_current('people', '${priyaId}') -> 'custom' ->> 'senior_status'`) === 'false', 'the custom value is editable in place');
  await p.reload();
  await md.getByRole('button', { name: 'Edit Senior status' }).click();
  await md.locator('select').selectOption('Yes');
  await md.getByRole('button', { name: 'Save' }).click();
  await p.getByText('Senior status saved.').waitFor();
  // People list column.
  await p.goto(`${PORTAL}/people?cf=senior_status&q=Kapadia`);
  const col = await p.locator('th', { hasText: 'Senior status' }).waitFor({ timeout: 60000 }).then(() => true, () => false);
  ok(col && (await p.locator('tbody').innerText()).includes('Yes'), 'Senior status can be shown as a column on the People list');
  await shot(p, 'people-list-column');

  // Settings › Custom fields: show it to the member themselves, and make it a segment filter.
  await p.goto(`${PORTAL}/settings/custom-fields`);
  await p.getByRole('button', { name: 'Edit Senior status' }).click();
  await p.locator('select[name=sensitivity]').last().selectOption('member_self');
  await p.locator('input[name=searchable]').last().check();
  await p.getByRole('button', { name: 'Save', exact: true }).click();
  await p.getByText('Senior status saved.').waitFor();
  ok(sql(`select sensitivity || '|' || searchable from app.custom_field_definitions where entity = 'people' and key = 'senior_status'`) === 'member_self|true', 'Settings › Custom fields marks it member_self and searchable');
  await shot(p, 'custom-fields');

  await importFile(p, 'memberships', '6-memberships.csv', 'Neon export');
  ok(sql(`select string_agg(crm_external_id || ':' || tier || ':' || status, ',' order by crm_external_id) from app.memberships where crm_external_id like 'M-90%'`) === 'M-901:life:active,M-902:yearly:active,M-903:yearly:ended',
     'current and past memberships imported, each with the tier of its type');

  // ── 3. History ────────────────────────────────────────────────────────────
  const pl = await importFile(p, 'pledges', '7-pledges.csv', 'Neon export');
  const pay = await importFile(p, 'payments', '8-payments-history.csv', 'Neon export');
  const rec = JSON.parse(sql(`select reconciliation::text from app.import_runs where id = '${pay.id}'`));
  ok(rec.ok && rec.money.some((m) => m.column === 'amount_cents' && m.file_cents === 325200 && m.db_cents === 325200), 'payments reconcile: $3,252.00 in the file and imported');
  ok(rec.money.some((m) => m.column === 'allocations' && m.file_cents === 300100 && m.db_cents === 300100), 'allocations reconcile to the cent ($3,001.00 applied as given)');
  ok(JSON.stringify(rec.by_year.map((y) => [y.year, y.file_cents, y.ok])) === JSON.stringify([['2019', 150000, true], ['2020', 150100, true], ['2025', 25100, true]]), 'totals per year match the file');
  const prec = JSON.parse(sql(`select reconciliation::text from app.import_runs where id = '${pl.id}'`));
  ok(prec.money.some((m) => m.column === 'paid_so_far' && m.file_cents === 300100), 'pledges carried their paid-so-far');
  await p.goto(`${PORTAL}/settings/import/${pl.id}`);
  await p.getByRole('button', { name: 'Compare again' }).waitFor({ timeout: 60000 });
  await p.getByRole('button', { name: 'Compare again' }).click();
  await p.getByText('Totals compared with the file.').waitFor({ timeout: 60000 });
  const prec2 = JSON.parse(sql(`select reconciliation::text from app.import_runs where id = '${pl.id}'`));
  ok(prec2.ok && prec2.paid_mismatches.length === 0 && prec2.money.some((m) => m.column === 'paid_so_far' && m.db_cents === 300100), 'after the payments, every pledge balance matches the old system to the cent');
  ok(sql(`select string_agg(crm_external_id || ':' || status || ':' || paid_cents, ',' order by crm_external_id) from app.pledges where crm_external_id like 'PL-20%'`) === 'PL-2019-0042:partially_paid:200000,PL-2020-0007:paid:100100', 'pledge statuses follow the imported allocations');
  ok(sql(`select bool_and(is_historical) and count(*) = 4 from app.payments where crm_external_id like 'R-20%'`) === 't', 'imported payments are marked as history');
  ok(sql(`select count(*) from app.ledger_postings l join app.payments y on y.id = l.source_id where y.crm_external_id like 'R-20%'`) === '0' && sql(`select count(*) from app.ledger_postings`) === before.postings, 'no historical payment was queued to QuickBooks');
  ok(sql(`select check_number || '|' || receipt_number from app.payments where crm_external_id = 'R-2019-0331'`) === '0044|00331', 'legacy receipt and check numbers are kept exactly');

  // ── Data quality and readiness ────────────────────────────────────────────
  await p.goto(`${PORTAL}/settings/data-quality`);
  await p.getByRole('heading', { name: 'Children without a birth date' }).waitFor();
  const dq = await p.locator('main').innerText();
  ok(/Riya Kapadia/.test(dq), 'the data-quality view lists the child without a birth date');
  ok(/Contact coverage/.test(dq) && /Likely duplicates/.test(dq) && /No consent record/.test(dq), 'the data-quality view shows coverage, duplicates and missing consents');
  await shot(p, 'data-quality');
  ok(sql(`select exists (select 1 from app.readiness_checks where key = 'records_imported_reconciled')`) === 't', 'the readiness check "records imported and reconciled; contact coverage above target" is registered');

  // ── Member app: the member sees their own member_self field ───────────────
  try {
    const m = await memberLogin(browser, 'priya@jsh.test');
    await m.goto(`${MEMBER}/person/${priyaId}`, { waitUntil: 'networkidle' });
    await m.getByText('More details').waitFor({ timeout: 30000 });
    const body = await m.locator('body').innerText();
    ok(/Senior status/.test(body) && /Yes/.test(body), 'Priya sees "Senior status: Yes" on her own profile in the member app (member_self, read-only)');
    await shot(m, 'member-profile-more-details');
    await m.context().close();
  } catch (e) {
    ok(false, `member app check failed: ${String(e).slice(0, 200)}`);
  }

  // ── Undo ──────────────────────────────────────────────────────────────────
  async function undo(run, reason) {
    await p.goto(`${PORTAL}/settings/import/${run.id}`);
    await p.getByRole('button', { name: `Undo import #${run.number}` }).click();
    await p.fill('#undo-reason', reason);
    await p.getByRole('button', { name: 'Undo the import' }).click();
    await p.getByText(/^Undone /).first().waitFor({ timeout: 60000 });
  }
  await undo(pay, 'Test load of the payment history');
  ok(sql(`select count(*) from app.payments where crm_external_id like 'R-20%'`) === '0', 'undo removed the payments it created');
  ok(sql(`select string_agg(paid_cents::text, ',' order by crm_external_id) from app.pledges where crm_external_id like 'PL-20%'`) === '200000,100100', 'and the pledges are back to the paid-so-far they were imported with');
  await undo(people, 'Test load of the Neon people export');
  ok(sql(`select row_to_json(x)::text from (select email, phone_e164, custom from app.people where member_number = 'JSH-90001') x`) === before.priya, 'undo puts Priya back exactly as she was (from the audit log before-values)');
  ok(sql(`select count(*) from app.people`) === before.people, 'undo removed the people it created');
  ok(sql(`select count(*) from app.audit_log where reason = 'Undo import #${people.number} · 5-people-neon-export.csv — Test load of the Neon people export' and action = 'people.delete' and client_app = 'import'`) !== '0', 'the undo is audited with its reason');
  await shot(p, 'undone');

  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
