// Signs in to the portal with a real emailed code (mailpit), then opens every page
// linked from the sidebar and module tabs, and reports errors per page.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:3100';
const EMAIL = process.env.EMAIL || 'admin@jsh.test';
const MAIL = process.env.MAIL || 'http://localhost:55324';
const OUT = process.env.OUT || '/tmp/claude-0/e2e/portal';
require('fs').mkdirSync(OUT, { recursive: true });

async function latestCode(email, after) {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + email)}`).then((x) => x.json());
    const m = (r.messages || []).find((x) => new Date(x.Created).getTime() >= after);
    if (m) {
      const full = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((x) => x.json());
      const code = ((full.Text || '') + ' ' + (full.HTML || '')).match(/\b(\d{6,10})\b/);
      if (code) return code[1];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('no code email arrived for ' + email);
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const consoleErrs = [];
  p.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 300)); });
  p.on('pageerror', (e) => consoleErrs.push('pageerror: ' + String(e).slice(0, 300)));
  await p.goto(BASE + '/login');
  const t0 = Date.now() - 2000;
  await p.fill('input[name=email]', EMAIL);
  await p.click('button[type=submit]');
  await p.waitForSelector('input[name=code]', { timeout: 20000 });
  await p.fill('input[name=code]', await latestCode(EMAIL, t0));
  await p.click('button[type=submit]');
  await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  console.log('signed in as', EMAIL, '→', p.url());

  const seen = new Set(), queue = process.env.ONLY ? process.env.ONLY.split(',') : ['/'];
  const follow = !process.env.ONLY;
  const report = [];
  while (queue.length) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    consoleErrs.length = 0;
    let status = 0;
    try {
      const resp = await p.goto(BASE + path, { waitUntil: 'networkidle', timeout: 60000 });
      status = resp ? resp.status() : 0;
    } catch (e) { report.push({ path, status: 'timeout', problems: [String(e).slice(0, 200)] }); continue; }
    await p.waitForTimeout(300);
    const problems = await p.evaluate(() => {
      const out = [];
      document.querySelectorAll('[role=alert], .text-danger').forEach((el) => {
        const t = el.textContent.trim().replace(/\s+/g, ' ');
        if (t && t.length > 3) out.push(t.slice(0, 240));
      });
      const body = document.body.innerText;
      for (const needle of ['Could not load', 'Something went wrong', 'Application error', 'does not exist', 'permission denied', 'not found']) {
        if (body.includes(needle)) out.push('page text contains: ' + needle);
      }
      return [...new Set(out)];
    });
    const links = await p.evaluate(() => [...document.querySelectorAll('nav a[href^="/"], a[href^="/"][role=tab], [role=tablist] a[href^="/"], aside a[href^="/"]')].map((a) => a.getAttribute('href')));
    if (follow) for (const l of links) { const clean = l.split('#')[0]; if (clean && !seen.has(clean) && !clean.startsWith('/logout') && !clean.startsWith('/api')) queue.push(clean); }
    const shot = OUT + '/' + (path === '/' ? 'home' : path.slice(1).replace(/[/?=&]/g, '_')) + '.png';
    await p.screenshot({ path: shot, fullPage: true });
    const errs = [...new Set(consoleErrs)];
    report.push({ path, status, problems, console: errs });
  }
  require('fs').writeFileSync(OUT + '/report.json', JSON.stringify(report, null, 2));
  for (const r of report) {
    const bad = r.status !== 200 || (r.problems && r.problems.length) || (r.console && r.console.length);
    console.log(`${bad ? 'XX' : 'ok'} ${r.status} ${r.path}${bad ? '\n     ' + [...(r.problems || []), ...(r.console || []).map((c) => 'console: ' + c)].join('\n     ') : ''}`);
  }
  await b.close();
})().catch((e) => { console.error('CRAWL FAILED:', e); process.exit(1); });
