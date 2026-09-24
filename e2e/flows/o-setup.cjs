// Onboarding Setup flow (stream o-setup), against a real local stack:
//   the owner (admin@jsh.test) fills in the legal identity and uploads a W-9 and a
//   determination letter → the IRS lookup matches the fixture → submits → a
//   Community Connect platform admin verifies in Platform › Verification → the
//   owner saves the profile and brand kit with a logo, and the portal top bar and
//   the public /c/jsh page show it → leaders are added (and mirrored to the roster)
//   → checklist statuses update (and a step is assigned) → the readiness page shows
//   the right pass/fail → every step left an audit row from the portal.
//
//   BASE=http://localhost:3500 MAIL=http://localhost:55724 DB=postgres://postgres:postgres@localhost:55832/postgres \
//   API=http://localhost:55721 SERVICE_KEY=… PLAYWRIGHT=/opt/node22/lib/node_modules/playwright node e2e/flows/o-setup.cjs
//
// Test data only: it resets JSH's onboarding rows first, so it can be re-run.
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:3500', MAIL = process.env.MAIL || 'http://localhost:55724';
const DB = process.env.DB || 'postgres://postgres:postgres@localhost:55832/postgres';
const API = process.env.API || 'http://localhost:55721', SERVICE_KEY = process.env.SERVICE_KEY;
const OUT = process.env.OUT || '/tmp/claude-0/streams/o-setup';
const REPO = path.resolve(__dirname, '..', '..');
fs.mkdirSync(OUT, { recursive: true });
const sql = (q) => execSync(`psql "${DB}" -Atc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };
const JSH = '00000000-0000-4000-8000-000000000001';
const VERIFIER = 'verifier@cc.test';

// A real (tiny) PNG: a solid 96×32 maroon bar.
function makePng(w, h, [r, g, b]) {
  const zlib = require('zlib');
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const rows = []; for (let y = 0; y < h; y++) { rows.push(Buffer.from([0])); for (let x = 0; x < w; x++) rows.push(Buffer.from([r, g, b])); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
async function code(email, after) {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + email)}`).then((x) => x.json());
    const m = (r.messages || []).find((x) => new Date(x.Created).getTime() >= after);
    if (m) { const f = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((x) => x.json()); const c = (f.Text || '').match(/\b(\d{6,10})\b/); if (c) return c[1]; }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('no sign-in code for ' + email);
}
async function signIn(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(BASE + '/login'); const t0 = Date.now() - 2000;
  await p.fill('input[name=email]', email); await p.click('button[type=submit]');
  await p.waitForSelector('input[name=code]'); await p.fill('input[name=code]', await code(email, t0));
  await p.click('button[type=submit]'); await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 });
  return { ctx, p };
}
async function confirmModal(p, label) {
  const dlg = p.locator('[role=dialog][aria-modal=true]');
  await dlg.waitFor();
  await dlg.getByRole('button', { name: label }).click();
}
async function toast(p, re) {
  try { await p.getByText(re).first().waitFor({ timeout: 30000 }); return true; } catch { return false; }
}
const lastAudit = (where) => sql(`select coalesce(client_app,'')||'|'||coalesce(client_screen,'')||'|'||(actor_user_id is not null)::text from app.audit_log where ${where} order by id desc limit 1`);

(async () => {
  // ── Test data ────────────────────────────────────────────────────────────
  sql(`delete from app.org_documents where center_id='${JSH}'; delete from app.org_leaders where center_id='${JSH}';
       delete from app.center_setup_steps where center_id='${JSH}'; delete from app.org_profiles where center_id='${JSH}';
       update app.centers set branding = branding - 'logo_path' - 'logo_url' - 'mark_path' - 'mark_url' - 'colors' where id='${JSH}';`);
  ok(sql('select app.ensure_setup_storage()').startsWith('buckets'), 'branding and org-documents storage areas exist');
  execSync(`node ${REPO}/tools/load-irs-eo.mjs --bmf ${REPO}/tests/fixtures/irs/eo-bmf-fixture.csv --pub78 ${REPO}/tests/fixtures/irs/pub78-fixture.txt --revocations ${REPO}/tests/fixtures/irs/revocations-fixture.txt --db "${DB}"`, { stdio: 'inherit' });
  ok(sql("select status from app.irs_exempt_orgs where ein='760000001'") === 'active', 'IRS fixture loaded by tools/load-irs-eo.mjs');
  // A Community Connect platform admin (not a JSH member) to verify.
  if (SERVICE_KEY) {
    await fetch(`${API}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: VERIFIER, email_confirm: true }) });
  }
  const verifierId = sql(`select id from auth.users where email='${VERIFIER}'`);
  if (!verifierId) throw new Error('set SERVICE_KEY so the flow can create the platform admin login');
  sql(`insert into app.accounts (user_id, is_platform_admin) values ('${verifierId}', true) on conflict (user_id) do update set is_platform_admin = true`);
  const pdf = path.join(OUT, 'fixture.pdf');
  fs.writeFileSync(pdf, '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  const png = path.join(OUT, 'logo.png');
  fs.writeFileSync(png, makePng(96, 32, [122, 46, 31]));

  const browser = await chromium.launch();
  const owner = await signIn(browser, 'admin@jsh.test');
  const p = owner.p;
  const adminId = sql("select id from auth.users where email='admin@jsh.test'");

  // ── Step 0.2 · legal identity ────────────────────────────────────────────
  await p.goto(BASE + '/setup/organization', { waitUntil: 'networkidle' });
  await p.fill('input[name=legal_name]', 'Jain Society of Houston Inc');
  await p.fill('input[name=ein]', '760000001');
  await p.selectOption('select[name=entity_type]', 'public_charity');
  await p.fill('input[name=incorporation_state]', 'TX');
  await p.fill('input[name=address_line1]', '3905 Artesian Lane');
  await p.fill('input[name=address_city]', 'Houston');
  await p.fill('input[name=address_state]', 'TX');
  await p.fill('input[name=address_postal_code]', '77000');
  await p.fill('input[name=authorized_signer_name]', 'Demo Admin');
  await p.fill('input[name=authorized_signer_title]', 'President');
  await p.getByRole('button', { name: 'Save legal identity' }).click();
  ok(await toast(p, /Legal identity saved/), 'legal identity saved (toast)');
  ok(sql(`select ein||'|'||entity_type||'|'||(registered_address->>'city') from app.org_profiles where center_id='${JSH}'`) === '76-0000001|public_charity|Houston', 'org_profiles has the legal identity');
  ok(lastAudit(`record_table='org_profiles' and center_id='${JSH}'`) === 'portal|/setup/organization|true', 'legal identity audited from the portal screen');

  await p.goto(BASE + '/setup/organization', { waitUntil: 'networkidle' });
  ok((await p.locator('[data-irs-ok]').getAttribute('data-irs-ok')) === 'true', 'IRS lookup matches the fixture on the screen');
  for (const [kind, name] of [['w9', 'W-9'], ['determination_letter', 'determination letter']]) {
    await p.selectOption('select[name=kind]', kind);
    await p.setInputFiles('input#doc-file', pdf);
    await p.getByRole('button', { name: 'Upload document' }).click();
    ok(await toast(p, new RegExp(`uploaded`, 'i')), `${name} uploaded (toast)`);
    await p.waitForTimeout(800);
  }
  const docs = sql(`select string_agg(kind, ',' order by kind) from app.org_documents where center_id='${JSH}'`);
  ok(docs === 'determination_letter,w9', 'two org_documents rows: ' + docs);
  ok(sql(`select count(*) from storage.objects where bucket_id='org-documents' and name like '${JSH}/%'`) >= '2', 'files stored in the private org-documents bucket');
  ok(lastAudit(`record_table='org_documents' and action='org_documents.insert' and center_id='${JSH}'`) === 'portal|/setup/organization|true', 'document upload audited');

  await p.goto(BASE + '/setup/organization', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Submit for verification' }).click();
  await confirmModal(p, 'Submit for verification');
  ok(await toast(p, /Submitted/), 'submitted for verification (toast)');
  ok(sql(`select verification_status from app.org_profiles where center_id='${JSH}'`) === 'submitted', 'status submitted');
  ok(sql(`select (after->'irs_lookup'->>'name_match')||'|'||client_app from app.audit_log where action='org_profiles.submit_verification' and center_id='${JSH}' order by id desc limit 1`) === 'exact|portal', 'submission audited with the IRS match');
  await p.goto(BASE + '/setup', { waitUntil: 'networkidle' });
  ok((await p.locator('tr[data-step="org.legal_identity"]').getAttribute('data-status')) === 'needs_review', 'checklist: legal identity needs Community Connect review');
  await p.screenshot({ path: `${OUT}/checklist-submitted.png`, fullPage: true });

  // ── Platform › Verification ──────────────────────────────────────────────
  const cc = await signIn(browser, VERIFIER);
  await cc.p.goto(BASE + '/platform/verification', { waitUntil: 'networkidle' });
  const row = cc.p.locator('tr[data-center="jsh"]');
  ok((await row.getAttribute('data-status')) === 'submitted', 'the submission is in the verification queue');
  await row.getByRole('button', { name: 'Review' }).click();
  const drawer = cc.p.locator('aside[role=dialog]');
  await drawer.waitFor();
  ok(/Matches the IRS record/.test(await drawer.innerText()) && /Signed W-9/.test(await drawer.innerText()), 'the review shows the documents next to the IRS result');
  await cc.p.screenshot({ path: `${OUT}/platform-verification.png`, fullPage: true });
  await drawer.getByRole('button', { name: 'Verify non-profit' }).click();
  await confirmModal(cc.p, 'Verify non-profit');
  ok(await toast(cc.p, /Verified non-profit · audit logged/), 'platform admin verified (toast)');
  ok(sql(`select verification_status||'|'||verified_by from app.org_profiles where center_id='${JSH}'`) === `verified|${verifierId}`, 'org_profiles verified by the platform admin');
  ok(sql(`select client_app||'|'||client_screen from app.audit_log where action='org_profiles.verify' and center_id='${JSH}' order by id desc limit 1`) === 'portal|/platform/verification', 'verification audited from Platform › Verification');
  await cc.ctx.close();

  // ── Step 0.3 · profile and brand kit ─────────────────────────────────────
  await p.goto(BASE + '/setup/profile', { waitUntil: 'networkidle' });
  await p.fill('textarea[name=mission]', 'To practise and share the Jain way of life in Houston.');
  await p.fill('input[name=public_email]', 'office@jsh.test');
  await p.fill('input[name=public_phone]', '(713) 555-0100');
  await p.fill('input[name=office_hours]', 'Sat–Sun 9 am – 1 pm');
  await p.fill('input[name=latitude]', '29.7604');
  await p.fill('input[name=longitude]', '-95.3698');
  await p.check('input[name=languages][value=gu]');
  await p.getByRole('button', { name: 'Save profile' }).click();
  ok(await toast(p, /Profile saved/), 'profile saved (toast)');
  ok(sql(`select public_phone||'|'||latitude||'|'||array_to_string(languages, ',') from app.org_profiles where center_id='${JSH}'`) === '+17135550100|29.760400|en,gu', 'org_profiles has the profile and map pin');
  ok(sql(`select branding->>'phone' from app.centers where id='${JSH}'`) === '+17135550100', 'contact mirrored to centers.branding for the member app');

  await p.goto(BASE + '/setup/profile', { waitUntil: 'networkidle' });
  ok((await p.locator('iframe[title^="Map pin"]').count()) === 1, 'the map pin shows on OpenStreetMap');
  const logoCard = p.locator('[data-brand-file="logo_path"]');
  await logoCard.locator('input[type=file]').setInputFiles(png);
  await logoCard.getByRole('button', { name: 'Upload' }).click();
  ok(await toast(p, /Horizontal logo uploaded/), 'logo uploaded (toast)');
  const logoPath = sql(`select branding->>'logo_path' from app.centers where id='${JSH}'`);
  ok(logoPath.startsWith(`${JSH}/brand/logo-`), 'centers.branding.logo_path set: ' + logoPath);
  ok(lastAudit(`record_table='centers' and record_id='${JSH}'`) === 'portal|/setup/profile|true', 'brand kit change audited');
  await p.goto(BASE + '/setup/profile', { waitUntil: 'networkidle' });
  await p.fill('input[name=primary]', '#7A2E1F');
  await p.fill('input[name=accent]', '#F2B632');
  ok(/too low to read/.test(await p.locator('ul[aria-live]').innerText()), 'the contrast check flags white on the gold accent');
  await p.getByRole('button', { name: 'Save colors' }).click();
  ok(await toast(p, /Brand colors saved/), 'colors saved (toast)');
  ok(sql(`select branding#>>'{colors,primary}' from app.centers where id='${JSH}'`) === '#7A2E1F', 'colors saved in centers.branding.colors');
  await p.screenshot({ path: `${OUT}/profile-brand.png`, fullPage: true });

  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  const src = await p.locator('header img').first().getAttribute('src');
  ok(src && src.includes('/storage/v1/object/public/branding/') && src.includes('/brand/logo-'), 'the portal top bar shows the uploaded logo');
  const img = await fetch(src); ok(img.ok && (img.headers.get('content-type') || '').includes('image/png'), 'the logo is publicly served from the branding bucket');
  await p.screenshot({ path: `${OUT}/portal-logo.png` });
  await p.goto(BASE + '/c/jsh', { waitUntil: 'networkidle' });
  ok(((await p.locator('img').first().getAttribute('src')) || '').includes('/brand/logo-'), 'the public /c/jsh page shows the uploaded logo');

  // ── Leaders ──────────────────────────────────────────────────────────────
  for (const [name, title] of [['Demo Admin', 'President'], ['Rupa Trustee', 'Treasurer']]) {
    await p.goto(BASE + '/setup/leaders', { waitUntil: 'networkidle' });
    await p.getByRole('button', { name: 'Add leader' }).click();
    const d = p.locator('aside[role=dialog]');
    await d.locator('input[name=full_name]').fill(name);
    await d.locator('input[name=title]').fill(title);
    await d.getByRole('button', { name: 'Add leader' }).click();
    ok(await toast(p, new RegExp(`${name} saved`)), `leader ${name} added (toast)`);
  }
  ok(sql(`select count(*) from app.org_leaders where center_id='${JSH}'`) === '2', 'two org_leaders rows');
  ok(sql(`select string_agg(display_name, ',' order by sort_order, display_name) from app.role_roster where center_id='${JSH}' and org_leader_id is not null`) === 'Demo Admin,Rupa Trustee', 'leaders mirrored into the Administration roster');
  ok(lastAudit(`record_table='org_leaders' and center_id='${JSH}'`) === 'portal|/setup/leaders|true', 'leaders audited');

  // ── Checklist ────────────────────────────────────────────────────────────
  await p.goto(BASE + '/setup', { waitUntil: 'networkidle' });
  for (const k of ['org.legal_identity', 'org.profile', 'org.brand_kit', 'org.leaders']) {
    ok((await p.locator(`tr[data-step="${k}"]`).getAttribute('data-status')) === 'done', `checklist: ${k} is done`);
  }
  // Agreements shipped with o-security; screens of later waves (e.g. payments) still say Coming soon.
  ok((await p.locator('tr[data-step="org.agreements"]').getByRole('link', { name: 'Open' }).count()) === 1, 'a step whose screen is built (Agreements) links to it');
  const soon = await p.locator('tr[data-step]', { hasText: 'Coming soon' }).count();
  const offScreen = await p.locator('tr[data-step]', { hasText: 'Off-screen' }).count();
  ok(soon + offScreen + (await p.locator('tr[data-step] a', { hasText: 'Open' }).count()) === (await p.locator('tr[data-step]').count()), `every step either opens, says Coming soon (${soon}) or Off-screen (${offScreen})`);
  const email = p.locator('tr[data-step="svc.email"]');
  await email.getByRole('button', { name: 'Edit' }).click();
  const sd = p.locator('aside[role=dialog]');
  await sd.locator('select[name=status]').selectOption('waiting_on_provider');
  await sd.locator('select[name=owner_person_id]').selectOption({ index: 1 });
  await sd.locator('input[name=due_on]').fill('2026-10-15');
  await sd.locator('textarea[name=notes]').fill('DNS records sent to the web host');
  await sd.getByRole('button', { name: 'Save step' }).click();
  ok(await toast(p, /Step saved/), 'step saved (toast)');
  ok(sql(`select status||'|'||due_on||'|'||(owner_person_id is not null)::text from app.center_setup_steps where center_id='${JSH}' and step_key='svc.email'`) === 'waiting_on_provider|2026-10-15|true', 'center_setup_steps has status, owner and due date');
  ok(lastAudit(`record_table='center_setup_steps' and center_id='${JSH}'`) === 'portal|/setup|true', 'checklist change audited');
  await p.goto(BASE + '/setup', { waitUntil: 'networkidle' });
  ok((await p.locator('tr[data-step="svc.email"]').getAttribute('data-status')) === 'waiting_on_provider', 'checklist shows the new status');
  await p.screenshot({ path: `${OUT}/checklist.png`, fullPage: true });

  // ── Readiness ────────────────────────────────────────────────────────────
  await p.goto(BASE + '/setup/readiness', { waitUntil: 'networkidle' });
  const state = async (k) => p.locator(`tr[data-check="${k}"]`).getAttribute('data-state');
  ok((await state('nonprofit_verified')) === 'pass', 'readiness: non-profit verified passes');
  const dataOk = sql(`select (app.check_setup_data_complete('${JSH}')->>'ok')`) === 'true';
  ok((await state('setup_data_complete')) === (dataOk ? 'pass' : 'fail'), `readiness: setup data matches the database (${dataOk ? 'pass' : 'fail'})`);
  const legalOk = sql(`select (app.check_member_legal_documents_published('${JSH}')->>'ok')`) === 'true';
  ok((await state('member_legal_documents_published')) === (legalOk ? 'pass' : 'fail'), `readiness: legal documents match the database (${legalOk ? 'pass' : 'fail'})`);
  const registered = new Set(sql(`select string_agg(key, ',') from app.readiness_checks`).split(','));
  const shown = await p.locator('tr[data-check]').evaluateAll((rs) => rs.map((r) => [r.getAttribute('data-check'), r.getAttribute('data-state')]));
  const wrong = shown.filter(([k, st]) => (st === 'not_built') === registered.has(k));
  ok((await state('agreements_accepted')) !== 'not_built' && wrong.length === 0, `readiness: exactly the unregistered checks show as not built yet (${shown.filter(([, st]) => st === 'not_built').length} of ${shown.length}; mismatched: ${wrong.map((w) => w[0]).join(',') || 'none'})`);
  await p.screenshot({ path: `${OUT}/readiness.png`, fullPage: true });

  // Member cannot open Setup.
  const member = await signIn(browser, 'priya@jsh.test');
  await member.p.goto(BASE + '/setup', { waitUntil: 'networkidle' });
  ok(/don.t have access/i.test(await member.p.innerText('main')), 'a member without settings.manage sees "no access" on Setup');
  await member.ctx.close();

  await owner.ctx.close();
  await browser.close();
  // Every Setup write in this run came from the portal.
  ok(sql(`select count(*) from app.audit_log where center_id='${JSH}' and record_table in ('org_profiles','org_documents','org_leaders','center_setup_steps') and client_app is distinct from 'portal' and occurred_at > now() - interval '15 minutes' and actor_user_id is not null`) === '0', 'every user write in this run is audited as the portal');
  console.log(process.exitCode ? 'o-setup flow: FAILURES above' : 'o-setup flow: all passed');
})().catch((e) => { console.error('FLOW FAILED:', e.message); process.exit(1); });
