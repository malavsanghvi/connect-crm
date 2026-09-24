// Portal flow: Settings › Modules → switch Satvik Store off with a reason → nav hides it,
// /store shows the notice, audit row carries portal/screen/reason → switch it back on.
// Then open History on a household.
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const { execSync } = require('child_process');
const BASE = process.env.BASE || 'http://localhost:3100', MAIL = process.env.MAIL || 'http://localhost:55324';
const DB = process.env.DB || 'postgres://postgres:postgres@localhost:55432/postgres';
const sql = (q) => execSync(`psql "${DB}" -Atc "${q.replace(/"/g, '\\"')}"`).toString().trim();
async function code(email, after) {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + email)}`).then((x) => x.json());
    const m = (r.messages || []).find((x) => new Date(x.Created).getTime() >= after);
    if (m) { const f = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((x) => x.json()); const c = (f.Text || '').match(/\b(\d{6,10})\b/); if (c) return c[1]; }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('no code');
}
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(BASE + '/login'); const t0 = Date.now() - 2000;
  await p.fill('input[name=email]', 'admin@jsh.test'); await p.click('button[type=submit]');
  await p.waitForSelector('input[name=code]'); await p.fill('input[name=code]', await code('admin@jsh.test', t0));
  await p.click('button[type=submit]'); await p.waitForURL((u) => !u.pathname.startsWith('/login'));
  await p.goto(BASE + '/settings/modules', { waitUntil: 'networkidle' });
  await p.screenshot({ path: (process.env.OUT || '/tmp') + '/modules-1.png', fullPage: true });
  const row = p.locator('main table tr').filter({ hasText: 'Satvik Store' }).first();
  await row.getByRole('switch').click();
  await p.getByRole('dialog').waitFor();
  await p.getByRole('dialog').locator('textarea, input[type=text]').first().fill('Kitchen closed for renovation');
  await p.getByRole('dialog').getByRole('button', { name: /switch off|confirm|save/i }).first().click();
  await p.waitForTimeout(2500);
  await p.screenshot({ path: (process.env.OUT || '/tmp') + '/modules-2.png', fullPage: true });
  ok(sql("select enabled::text from app.center_modules where module_key='store'") === 'false', 'store switched off in the database');
  const a = sql("select client_app||'|'||coalesce(client_screen,'')||'|'||coalesce(reason,'')||'|'||(actor_user_id is not null)::text from app.audit_log where record_table='center_modules' order by id desc limit 1");
  ok(a.startsWith('portal|/settings/modules|Kitchen closed for renovation|true'), 'audit row: ' + a);
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  ok(!(await p.locator('aside, nav').first().innerText()).includes('Satvik Store'), 'sidebar hides Satvik Store');
  await p.goto(BASE + '/store', { waitUntil: 'networkidle' });
  const t = await p.innerText('body'); ok(/switched off/i.test(t), '/store shows the switched-off notice');
  await p.screenshot({ path: (process.env.OUT || '/tmp') + '/modules-3.png', fullPage: true });
  await p.goto(BASE + '/settings/modules', { waitUntil: 'networkidle' });
  const row2 = p.locator('main table tr').filter({ hasText: 'Satvik Store' }).first();
  await row2.getByRole('switch').click();
  await p.getByRole('dialog').waitFor(); await p.getByRole('dialog').locator('textarea, input[type=text]').first().fill('Kitchen reopened');
  await p.getByRole('dialog').getByRole('button', { name: /switch on|confirm|save/i }).first().click();
  await p.waitForTimeout(2500);
  ok(sql("select enabled::text from app.center_modules where module_key='store'") === 'true', 'store back on');
  const hid = sql("select id from app.households where display_name ilike 'Shah family%' limit 1");
  await p.goto(BASE + '/households/' + hid, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /history/i }).first().click(); await p.waitForTimeout(2500);
  const h = await p.innerText('body'); ok(/12 Lotus Lane/.test(h) && /address/i.test(h), 'household History shows the earlier address change');
  await p.screenshot({ path: (process.env.OUT || '/tmp') + '/history-1.png', fullPage: true });
  await b.close();
})().catch((e) => { console.error('FLOW FAILED:', e.message); process.exit(1); });
