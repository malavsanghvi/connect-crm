// Onboarding · more than one organization (stream o-tenancy), against a real stack.
//
//   set -a; . e2e/.env.o-tenancy; set +a
//   PORT=3300 PORTAL_BASE_DOMAIN=cc.test pnpm start            # the portal, built against the stack
//   node e2e/serve-spa.cjs /tmp/claude-0/o-tenancy-web 8400     # the member web app, exported against it
//   BASE=http://localhost:3300 APP=http://localhost:8400 MAIL=http://localhost:55524 API=http://localhost:55521 \
//     DB=postgres://postgres:postgres@localhost:55632/postgres node e2e/flows/o-tenancy.cjs
//
// Chromium resolves *.cc.test and *.jcnj.test to 127.0.0.1 (--host-resolver-rules), so the portal
// is reached by real host names: jsh.cc.test:3300, jcnj.cc.test:3300, jcnj-sandbox.cc.test:3300 and
// the own domain portal.jcnj.test:3300. No /etc/hosts change.
//
// Setup (SQL): a second production community (JCNJ) with one household, its sandbox, admin@jsh.test
// made an admin of both, and a platform admin login. Everything is idempotent.
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const { execSync } = require('child_process');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:3300';
const PORT = new URL(BASE).port || '80';
const APP = process.env.APP || 'http://localhost:8400';
const MAIL = process.env.MAIL || 'http://localhost:55524';
const API = process.env.API || 'http://localhost:55521';
const DB = process.env.DB || 'postgres://postgres:postgres@localhost:55632/postgres';
const ANON = process.env.ANON_KEY;
const SERVICE = process.env.SERVICE_KEY;
const OUT = process.env.OUT || '/tmp/claude-0/streams/o-tenancy';
fs.mkdirSync(OUT, { recursive: true });
const host = (name) => `http://${name}:${PORT}`;
const sql = (q) => execSync(`psql "${DB}" -v ON_ERROR_STOP=1 -Atc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });

async function mailCode(email, after) {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + email)}`).then((x) => x.json());
    const m = (r.messages || []).find((x) => new Date(x.Created).getTime() >= after);
    if (m) { const f = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((x) => x.json()); const c = (f.Text || '').match(/\b(\d{6,10})\b/); if (c) return c[1]; }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('no code for ' + email);
}
async function portalSignIn(p, base, email) {
  // Other flows' test authenticators (friendly name "e2e …") would add a 2FA step this flow does not test.
  sql(`delete from auth.mfa_factors where friendly_name like 'e2e %' and user_id = (select id from auth.users where email = '${email}')`);
  await p.goto(base + '/login', { waitUntil: 'networkidle' });
  const t0 = Date.now() - 2000;
  await p.fill('input[name=email]', email); await p.click('button[type=submit]');
  await p.waitForSelector('input[name=code]'); await p.fill('input[name=code]', await mailCode(email, t0));
  await p.click('button[type=submit]'); await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
}
/** A real access token for `email` (GoTrue email OTP), to call the API as that user. */
async function apiToken(email) {
  const t0 = Date.now() - 2000;
  const r = await fetch(`${API}/auth/v1/otp`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, create_user: false }) });
  if (!r.ok) throw new Error('otp: ' + (await r.text()));
  const code = await mailCode(email, t0);
  const v = await fetch(`${API}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, token: code, type: 'email' }) }).then((x) => x.json());
  if (!v.access_token) throw new Error('verify: ' + JSON.stringify(v));
  return v.access_token;
}
const rest = (path, init, token) => fetch(`${API}/rest/v1/${path}`, {
  ...init,
  headers: { apikey: ANON, Authorization: `Bearer ${token || ANON}`, 'Content-Type': 'application/json', 'Accept-Profile': 'app', 'Content-Profile': 'app', Prefer: 'return=representation', ...(init && init.headers) },
});

(async () => {
  if (!ANON || !SERVICE) throw new Error('Load the stack keys first: set -a; . e2e/.env.<stream>; set +a');
  // ── Setup ─────────────────────────────────────────────────────────────────
  await fetch(`${API}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'platform@cc.test', email_confirm: true }) });
  sql(`insert into app.centers (slug, name, short_name, state_region, status, branding) values ('jcnj','Jain Center of New Jersey','JCNJ','NJ','active','{"colors":{"primary":"#2F5D50","accent":"#C9731C"}}') on conflict (slug) do nothing`);
  sql(`insert into app.centers (slug, name, short_name, state_region, status, environment) values ('jcnj-sandbox','Jain Center of New Jersey (sandbox)','JCNJ','NJ','active','sandbox') on conflict (slug) do nothing`);
  sql(`insert into app.households (center_id, display_name, city) select id, 'Patel family', 'Edison' from app.centers where slug='jcnj' and not exists (select 1 from app.households h where h.center_id = app.centers.id and h.display_name = 'Patel family')`);
  sql(`insert into app.role_grants (center_id, user_id, role_key, scope_kind) select c.id, u.id, 'center_admin', 'center' from app.centers c, auth.users u where c.slug in ('jcnj','jcnj-sandbox') and u.email='admin@jsh.test' and not exists (select 1 from app.role_grants g where g.center_id=c.id and g.user_id=u.id and g.role_key='center_admin' and g.ends_at is null)`);
  // Test centers: staff 2FA is on by default for new communities (o-security) and is tested there; off here.
  sql(`update app.centers set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{security}', coalesce(rules->'security', '{}'::jsonb) || '{"require_2fa_for_staff": false}') where slug in ('jcnj','jcnj-sandbox')`);
  sql(`insert into app.accounts (user_id, is_platform_admin) select id, true from auth.users where email='platform@cc.test' on conflict (user_id) do update set is_platform_admin = true`);
  sql(`delete from app.center_entitlements where center_id = (select id from app.centers where slug='jcnj-sandbox')`);
  sql(`delete from app.center_domains where domain = 'portal.jcnj.test'`);
  const sbxId = sql("select id from app.centers where slug='jcnj-sandbox'");
  const sbxCode = () => sql(`select code from app.member_join_codes where center_id='${sbxId}' and active order by created_at desc limit 1`);

  const b = await chromium.launch({ args: ['--host-resolver-rules=MAP *.cc.test 127.0.0.1, MAP *.jcnj.test 127.0.0.1'] });

  // ── Portal: the organization comes from the web address ───────────────────
  {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
    await p.goto(host('jsh.cc.test') + '/login', { waitUntil: 'networkidle' });
    ok((await p.innerText('body')).includes('Jain Society of Houston'), 'jsh.cc.test opens Jain Society of Houston');
    await p.goto(host('jcnj.cc.test') + '/login', { waitUntil: 'networkidle' });
    ok((await p.innerText('body')).includes('Jain Center of New Jersey'), 'jcnj.cc.test opens Jain Center of New Jersey');
    await p.goto(host('jcnj-sandbox.cc.test') + '/login', { waitUntil: 'networkidle' });
    ok(await p.getByTestId('sandbox-watermark').isVisible(), 'the sandbox sign-in page carries the watermark');
    await shot(p, 'portal-sandbox-login');
    await p.goto(host('nope.cc.test') + '/login', { waitUntil: 'networkidle' });
    ok(/No active community is set up with the short name "nope"/.test(await p.innerText('body')), 'an unknown <slug>.cc.test says so in plain English');
    await p.goto(BASE + '/login', { waitUntil: 'networkidle' });
    ok((await p.innerText('body')).includes('Jain Society of Houston'), 'the bare localhost address keeps the default community (NEXT_PUBLIC_CENTER_SLUG)');
    await ctx.close();
  }

  // ── Portal: switcher across subdomains, one sign-in, data isolation ──────
  {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
    await portalSignIn(p, host('jsh.cc.test'), 'admin@jsh.test');
    await p.goto(host('jsh.cc.test') + '/households', { waitUntil: 'networkidle' });
    let body = await p.innerText('main');
    ok(body.includes('Shah') && !body.includes('Patel family'), 'at jsh: JSH households only');
    await p.getByTestId('center-switcher').click();
    const menu = p.getByRole('menu', { name: 'Switch community' });
    const items = await menu.innerText();
    ok(items.includes('Jain Center of New Jersey') && items.includes('Sandbox'), 'the switcher lists both communities and marks the sandbox');
    await shot(p, 'portal-switcher');
    await menu.getByRole('menuitemradio', { name: /Jain Center of New Jersey\s+jcnj(?!-)/ }).click();
    await p.waitForURL((u) => u.hostname === 'jcnj.cc.test', { timeout: 20000 });
    await p.waitForLoadState('networkidle');
    ok(!p.url().includes('/login'), 'switching to jcnj.cc.test keeps the sign-in (cookie shared across <slug>.cc.test)');
    ok((await p.getByTestId('center-switcher').innerText()).includes('Jain Center of New Jersey'), 'the pill now shows JCNJ');
    await p.goto(host('jcnj.cc.test') + '/households', { waitUntil: 'networkidle' });
    body = await p.innerText('main'); await shot(p, 'portal-jcnj-households');
    ok(body.includes('Patel family') && !body.includes('Shah'), 'at jcnj: only JCNJ households (isolation holds)');
    await shot(p, 'portal-jcnj-households');
    // Sandbox: watermark and its join code.
    await p.getByTestId('center-switcher').click();
    await p.getByRole('menuitemradio', { name: /sandbox/i }).click();
    await p.waitForURL((u) => u.hostname === 'jcnj-sandbox.cc.test', { timeout: 20000 });
    await p.waitForLoadState('networkidle');
    ok(await p.getByTestId('sandbox-watermark').isVisible(), 'the sandbox portal shows the watermark');
    await shot(p, 'portal-sandbox-home');
    await p.goto(host('jcnj-sandbox.cc.test') + '/settings/member-app', { waitUntil: 'networkidle' });
    const shown = (await p.getByTestId('join-code').innerText()).replace('-', '');
    ok(shown === sbxCode(), `Settings › Member app shows the sandbox's join code (${shown})`);
    // Rotate it with a reason: audited from the portal.
    await p.fill('input[name=reason]', 'Pilot poster reprinted');
    await p.getByRole('button', { name: 'Make a new code' }).click();
    await p.getByRole('dialog').getByRole('button', { name: 'Make a new code' }).click();
    await p.waitForTimeout(2500);
    const rotated = sbxCode();
    ok(rotated !== shown, 'a new join code replaced the old one');
    const a = sql(`select coalesce(reason,'')||'|'||coalesce(client_app,'')||'|'||coalesce(client_screen,'') from app.audit_log where record_table='member_join_codes' and action='member_join_codes.insert' and center_id='${sbxId}' order by id desc limit 1`);
    ok(a === 'Pilot poster reprinted|portal|/settings/member-app', 'the rotation is audited with reason, app and screen: ' + a);
    await p.goto(host('jcnj-sandbox.cc.test') + '/settings/limits', { waitUntil: 'networkidle' });
    body = await p.innerText('main');
    ok(body.includes('Verified test recipients only') && body.includes('2,000') && body.includes('800'), 'Settings › Limits shows the sandbox limits');
    await shot(p, 'portal-sandbox-limits');
    await ctx.close();
  }

  // ── Portal: the switcher on a single address (cookie) ────────────────────
  {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
    await portalSignIn(p, BASE, 'admin@jsh.test');
    await p.getByTestId('center-switcher').click();
    await p.getByRole('menuitemradio', { name: /Jain Center of New Jersey\s+jcnj(?!-)/ }).click();
    await p.waitForTimeout(3000); await p.waitForLoadState('networkidle');
    ok(new URL(p.url()).host === new URL(BASE).host && (await p.getByTestId('center-switcher').innerText()).includes('New Jersey'),
      'on localhost the switcher keeps the address and remembers the choice');
    const ck = (await ctx.cookies()).find((c) => c.name === 'cc_center');
    ok(ck && ck.value === 'jcnj' && ck.httpOnly, 'the choice is an httpOnly cc_center cookie');
    await p.goto(BASE + '/api/tenancy/reset', { waitUntil: 'networkidle' });
    ok((await p.getByTestId('center-switcher').innerText()).includes('Houston'), '/api/tenancy/reset returns to the default community');
    await ctx.close();
  }

  // ── Platform admin: environment, limit override (reason), own domain ─────
  {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
    await portalSignIn(p, BASE, 'platform@cc.test');
    await p.goto(BASE + '/platform', { waitUntil: 'networkidle' });
    const row = p.locator('main table tr').filter({ hasText: 'jcnj-sandbox' });
    ok((await row.innerText()).includes('Sandbox'), 'Platform › Centers shows the sandbox environment');
    await shot(p, 'portal-platform-centers');
    await row.getByRole('link', { name: /Limits/ }).click();
    await p.waitForURL(/\/platform\/centers\//); await p.waitForLoadState('networkidle');
    const households = Number(sql(`select count(*) from app.households where center_id='${sbxId}'`));
    const limitRow = p.locator('tr[data-key="max_households"]');
    await limitRow.locator('input[name=value]').fill(String(households + 1));
    await limitRow.locator('input[name=reason]').fill('Pilot: keep the sandbox small');
    await limitRow.getByRole('button', { name: 'Save' }).click();
    await p.waitForTimeout(2500);
    ok(sql(`select value::text||'|'||reason from app.center_entitlements where center_id='${sbxId}' and key='max_households'`) === `${households + 1}|Pilot: keep the sandbox small`,
      'the override is saved with its reason');
    const au = sql(`select coalesce(reason,'')||'|'||coalesce(client_app,'') from app.audit_log where record_table='center_entitlements' order by id desc limit 1`);
    ok(au === 'Pilot: keep the sandbox small|portal', 'the override is audited from the portal: ' + au);
    // Own domain for JCNJ.
    const jcnjId = sql("select id from app.centers where slug='jcnj'");
    await p.goto(`${BASE}/platform/centers/${jcnjId}`, { waitUntil: 'networkidle' });
    await p.fill('input[name=domain]', 'portal.jcnj.test');
    await p.getByRole('button', { name: 'Add address' }).click();
    await p.waitForTimeout(2000);
    ok(sql("select c.slug from app.center_domains d join app.centers c on c.id=d.center_id where d.domain='portal.jcnj.test'") === 'jcnj', 'the own domain is registered');
    await shot(p, 'portal-platform-center');
    await p.goto(host('portal.jcnj.test') + '/login', { waitUntil: 'networkidle' });
    ok((await p.innerText('body')).includes('Jain Center of New Jersey'), 'portal.jcnj.test opens JCNJ (own domain)');
    const ask = await fetch(`${BASE}/api/tenancy/tls-ask?domain=portal.jcnj.test`);
    const ask2 = await fetch(`${BASE}/api/tenancy/tls-ask?domain=evil.example.org`);
    ok(ask.status === 200 && ask2.status === 404, 'tls-ask allows the registered domain and refuses others');
    await ctx.close();
  }

  // ── Entitlement caps over the API (CCENT) ────────────────────────────────
  {
    const token = await apiToken('admin@jsh.test');
    const ins = await rest('households', { method: 'POST', body: JSON.stringify({ center_id: sbxId, display_name: 'Test family (flow)' }) }, token);
    ok(ins.status === 201, 'one more household fits under the raised limit');
    const over = await rest('households', { method: 'POST', body: JSON.stringify({ center_id: sbxId, display_name: 'One too many' }) }, token);
    const err = await over.json();
    ok(over.status >= 400 && err.code === 'CCENT' && /can hold up to \d+ households?\./.test(err.message), 'the next household is refused with CCENT: ' + err.message);
    const kpi = await rest('rpc/public_kpis', { method: 'POST', body: JSON.stringify({ p_slug: 'jcnj-sandbox' }) });
    const kerr = await kpi.json();
    ok(kerr.code === 'CCENT' && /no public community dashboard/.test(kerr.message), 'public_kpis refuses the sandbox with CCENT');
    const env = await rest(`centers?id=eq.${sbxId}`, { method: 'PATCH', body: JSON.stringify({ environment: 'production' }) }, token);
    ok(env.status >= 400 && sql(`select environment from app.centers where id='${sbxId}'`) === 'sandbox', "the sandbox's own admin cannot make it production");
    sql(`delete from app.households where center_id='${sbxId}' and display_name='Test family (flow)'`);
  }

  // ── Member app: find by search, by join code, by link; watermark; switch ─
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(APP + '/', { waitUntil: 'networkidle' });
    await p.getByText('Find your community').first().waitFor({ timeout: 20000 });
    ok(true, 'a new install starts at "Find your community"');
    await shot(p, 'member-find');
    await p.getByTestId('community-search').fill('Jersey');
    await p.waitForTimeout(1500);
    let body = await p.innerText('body');
    ok(body.includes('Jain Center of New Jersey') && !body.includes('(sandbox)'), 'search finds JCNJ and never its sandbox');
    await p.getByTestId('community-search').fill('sandbox');
    await p.waitForTimeout(1500);
    ok(/No community matches "sandbox"/.test(await p.innerText('body')), 'a sandbox is not searchable');
    // Join code (the sandbox's current one, typed with a dash in lower case).
    const code = sbxCode();
    await p.getByTestId('community-code').fill(`${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase());
    await p.getByRole('button', { name: 'Check code' }).click();
    await p.getByText('Open Jain Center of New Jersey (sandbox)').waitFor({ timeout: 15000 });
    body = await p.innerText('body');
    ok(body.includes('This community is a sandbox'), 'the join code finds the sandbox and says it is one');
    await shot(p, 'member-code-found');
    await p.getByText('Open Jain Center of New Jersey (sandbox)').click();
    await p.getByText(/Jain Center of New Jersey \(sandbox\)/).first().waitFor({ timeout: 20000 });
    await p.waitForTimeout(1500);
    ok(await p.getByTestId('sandbox-watermark').isVisible(), 'the member app shows the sandbox watermark');
    await shot(p, 'member-sandbox-welcome');
    // Persisted: a reload opens the same community without asking.
    await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(2000);
    body = await p.innerText('body');
    ok(!body.includes('Find your community') && body.includes('(sandbox)'), 'the choice is remembered on this device');
    // Choose another community from the welcome screen, by search.
    await p.getByText('Not your community? Choose another').click();
    await p.getByTestId('community-search').fill('Houston');
    await p.waitForTimeout(1500);
    await p.getByRole('button', { name: /^Jain Society of Houston/ }).first().click();
    await p.getByText(/Jain Society of Houston/).first().waitFor({ timeout: 20000 });
    await p.waitForTimeout(1500);
    body = await p.innerText('body');
    ok(body.includes('Jain Society of Houston') && !(await p.getByTestId('sandbox-watermark').isVisible().catch(() => false)), 'switching to JSH by search: themed for JSH, no watermark');
    await shot(p, 'member-jsh-welcome');
    ok(errs.length === 0, 'no page errors in the member app' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await ctx.close();
  }
  {
    // A link into a screen of the app (an event link, the sign-in page) on a new install opens the
    // build's own community, as before: existing links and scripts keep working.
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
    await p.goto(`${APP}/sign-in`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(2000);
    ok(!(await p.innerText('body')).includes('Find your community') && await p.locator('input[placeholder="name@example.com"]').isVisible(),
      'a deep link on a new install opens the default community (no chooser)');
    await ctx.close();
  }
  {
    // A poster's https link on a new install: /join/<code> opens the chooser with the code checked.
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
    const jcnjCode = sql("select code from app.member_join_codes j join app.centers c on c.id=j.center_id where c.slug='jcnj' and j.active order by j.created_at desc limit 1");
    await p.goto(`${APP}/join/${jcnjCode}`, { waitUntil: 'networkidle' });
    await p.getByText('Open Jain Center of New Jersey', { exact: true }).waitFor({ timeout: 20000 });
    ok(true, 'a join link on a new install finds the community from the link');
    await p.getByText('Open Jain Center of New Jersey', { exact: true }).click();
    await p.waitForTimeout(3000);
    ok((await p.innerText('body')).includes('Jain Center of New Jersey'), 'the app opens JCNJ');
    await shot(p, 'member-jcnj-welcome');
    await ctx.close();
  }
  await b.close();
})().catch((e) => { console.error('FLOW FAILED:', e.message); process.exit(1); });
