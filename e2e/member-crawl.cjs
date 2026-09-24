// Signs in to the member web app with a real emailed code and opens every screen.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8200';
const EMAIL = process.env.EMAIL || 'priya@jsh.test';
const OUT = process.env.OUT || '/tmp/claude-0/e2e/member';
const MAIL = process.env.MAIL || 'http://localhost:55324';
require('fs').mkdirSync(OUT, { recursive: true });
const ROUTES = (process.env.ONLY || '/,/events,/give,/jain-way,/jain-way?tab=learn,/jain-way?tab=saathi,/jain-way?tab=library,/family,/bolis,/store,/cart,/pledges,/recurring,/recurring-setup,/special-days,/member-card,/settings,/legal,/preferences,/niva,/gyan,/guide,/guide/timings,/guide/links,/guide/volunteer,/guide/admin,/guide/membership,/guide/registrations,/guide/zones,/guide/whatsapp,/guide/ask,/family-review,/volunteer').split(',');
async function latestCode(email, after) {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + email)}`).then((x) => x.json());
    const m = (r.messages || []).find((x) => new Date(x.Created).getTime() >= after);
    if (m) { const full = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((x) => x.json()); const c = ((full.Text || '') + ' ' + (full.HTML || '')).match(/\b(\d{6,10})\b/); if (c) return c[1]; }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('no code email for ' + email);
}
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 300)));
  await p.goto(BASE + '/sign-in', { waitUntil: 'networkidle' });
  const t0 = Date.now() - 2000;
  await p.fill('input[placeholder="name@example.com"]', EMAIL);
  await p.getByRole('button', { name: /send|code|continue/i }).first().click();
  const codeBox = p.locator('input[inputmode=numeric], input[autocomplete=one-time-code]').first();
  await codeBox.waitFor({ timeout: 20000 });
  await codeBox.fill(await latestCode(EMAIL, t0));
  const verify = p.getByRole('button', { name: /verify|sign in|continue/i }).first();
  if (await verify.isVisible().catch(() => false)) await verify.click();
  await p.waitForTimeout(4000);
  console.log('after sign-in:', p.url());
  const report = [];
  for (const r of ROUTES) {
    errs.length = 0;
    await p.goto(BASE + r, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => errs.push('goto: ' + e));
    await p.waitForTimeout(1500);
    const text = await p.evaluate(() => document.body.innerText);
    const problems = [];
    for (const n of ["Could not", "couldn't", "Something went wrong", "Unmatched Route", "not found", "permission denied", "Try again"]) if (text.includes(n)) {
      const line = text.split('\n').find((l) => l.includes(n)); problems.push(line.slice(0, 220));
    }
    await p.screenshot({ path: `${OUT}/${r === '/' ? 'home' : r.slice(1).replace(/[/?=&]/g, '_')}.png`, fullPage: false });
    report.push({ route: r, url: p.url(), problems: [...new Set(problems)], console: [...new Set(errs)] });
  }
  require('fs').writeFileSync(OUT + '/report.json', JSON.stringify(report, null, 2));
  for (const x of report) {
    const bad = x.problems.length || x.console.length;
    console.log(`${bad ? 'XX' : 'ok'} ${x.route}${x.url.endsWith(x.route) ? '' : '  (→ ' + x.url.replace(BASE, '') + ')'}${bad ? '\n     ' + [...x.problems, ...x.console.map((c) => 'console: ' + c)].join('\n     ') : ''}`);
  }
  await b.close();
})().catch((e) => { console.error('CRAWL FAILED:', e); process.exit(1); });
