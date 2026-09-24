// o-vault flow: the credential vault, the background service and file storage,
// against a real local stack (e2e/up.sh). It needs the worker built first
// (pnpm --dir worker build) and the portal running against the same stack.
//
//   BASE=http://localhost:3400 MAIL=http://localhost:55624 API=http://localhost:55621 \
//   DB=postgres://postgres:postgres@localhost:55732/postgres ENVF=e2e/.env.o-vault \
//   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright node e2e/flows/o-vault.cjs
//
// 1. Vault: an admin's API call without a fresh 2FA check gets CCSTP; in the
//    portal the admin adds a secret, the step-up modal verifies a real TOTP
//    code (GoTrue MFA) and the save is retried. The value is readable by no
//    API role (authenticated, anon, service_role) and appears in no response,
//    page or audit entry.
// 2. Worker: started here as a process with the connect_worker role. A
//    demo.ping job that reads the secret fails once, is retried after its
//    backoff and succeeds; the read is in secret_access_log. The portal's test
//    button round-trips too, and the status tile shows the heartbeat.
// 3. Storage: uploads and downloads over the Storage API with real user
//    tokens, allowed and refused per bucket and role, plus a module switch.
// 4. Retention: an expired export is removed through the Storage API by the
//    storage.retention job, file and row, with an audit entry.
// 5. Rotate and Disconnect in the portal; the worker stops cleanly.
// Test data only (a test connection, test files); never real keys.
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const { execSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3400';
const MAIL = process.env.MAIL || 'http://localhost:55624';
const API = process.env.API || 'http://localhost:55621';
const DB = process.env.DB || 'postgres://postgres:postgres@localhost:55732/postgres';
const OUT = process.env.OUT || '/tmp/claude-0/streams/o-vault';
const ENVF = process.env.ENVF || path.join(__dirname, '..', '.env.o-vault');
const WORKER_JS = process.env.WORKER_JS || path.join(__dirname, '..', '..', 'worker', 'dist', 'server.js');
const KEYS = Object.fromEntries(fs.readFileSync(ENVF, 'utf8').trim().split('\n').map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
fs.mkdirSync(OUT, { recursive: true });

const sql = (q) => execSync(`psql "${DB}" -qAtX -v ON_ERROR_STOP=1`, { input: q }).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) { failures++; process.exitCode = 1; } };
async function until(fn, ms = 20000, every = 500) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(every); }
}

// ── Sign-in codes and TOTP ──────────────────────────────────────────────────
async function mailCode(email, after) {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + email)}`).then((x) => x.json());
    const m = (r.messages || []).find((x) => new Date(x.Created).getTime() >= after);
    if (m) { const f = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((x) => x.json()); const c = (f.Text || '').match(/\b(\d{6,10})\b/); if (c) return c[1]; }
    await sleep(500);
  }
  throw new Error('no sign-in code for ' + email);
}
const b32 = (s) => { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of s.replace(/=+$/, '').toUpperCase()) bits += a.indexOf(c).toString(2).padStart(5, '0'); const o = []; for (let i = 0; i + 8 <= bits.length; i += 8) o.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(o); };
let lastStep = -1;
/** A TOTP code from a time step not used before in this run (a used code may be refused). */
async function freshTotp(secret) {
  while (Math.floor(Date.now() / 30000) === lastStep) await sleep(1000);
  lastStep = Math.floor(Date.now() / 30000);
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(lastStep));
  const h = crypto.createHmac('sha1', b32(secret)).update(buf).digest(); const o = h[h.length - 1] & 0xf;
  return ((h.readUInt32BE(o) & 0x7fffffff) % 1e6).toString().padStart(6, '0');
}
const anonH = { apikey: KEYS.ANON_KEY, 'content-type': 'application/json' };
const serviceH = { apikey: KEYS.SERVICE_KEY, authorization: `Bearer ${KEYS.SERVICE_KEY}`, 'content-type': 'application/json' };
async function apiLogin(email) {
  let t0 = Date.now() - 2000, r;
  // GoTrue allows one code per email per short window; wait it out.
  for (let i = 0; i < 20; i++) {
    t0 = Date.now() - 2000;
    r = await fetch(`${API}/auth/v1/otp`, { method: 'POST', headers: anonH, body: JSON.stringify({ email, create_user: false }) });
    if (r.status !== 429) break;
    await sleep(5000);
  }
  if (r.status !== 200) throw new Error(`otp for ${email}: ${r.status}`);
  const s = await fetch(`${API}/auth/v1/verify`, { method: 'POST', headers: anonH, body: JSON.stringify({ type: 'email', email, token: await mailCode(email, t0) }) }).then((x) => x.json());
  if (!s.access_token) throw new Error(`verify for ${email}: ${JSON.stringify(s)}`);
  return s.access_token;
}
const userH = (token, profile = 'app') => ({ ...anonH, authorization: `Bearer ${token}`, 'accept-profile': profile, 'content-profile': profile });
const rpc = (token, fn, args, profile = 'app', headers = null) =>
  fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: headers ?? userH(token, profile), body: JSON.stringify(args) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

// ── Storage API with a user's token ─────────────────────────────────────────
async function upload(token, bucket, name, body, type) {
  const r = await fetch(`${API}/storage/v1/object/${bucket}/${name}`, {
    method: 'POST', headers: { apikey: KEYS.ANON_KEY, authorization: `Bearer ${token}`, 'content-type': type, 'x-upsert': 'true' }, body,
  });
  return { status: r.status, body: await r.text() };
}
async function download(token, bucket, name) {
  const r = await fetch(`${API}/storage/v1/object/authenticated/${bucket}/${name}`, { headers: { apikey: KEYS.ANON_KEY, authorization: `Bearer ${token}` } });
  return { status: r.status, body: await r.text() };
}

/** If the portal asks for a fresh 2FA check (the last one is older than 5 minutes), answer it. */
async function maybeStepUp(p, secret) {
  const dlg = p.getByRole('dialog').filter({ hasText: 'Confirm it' });
  if (await dlg.waitFor({ timeout: 4000 }).then(() => true, () => false)) {
    await dlg.getByLabel('Code from your authenticator app').fill(await freshTotp(secret));
    await dlg.getByRole('button', { name: 'Verify and continue' }).click();
  }
}

(async () => {
  const run = crypto.randomBytes(4).toString('hex');
  const jsh = sql("select id from app.centers where slug = 'jsh'");
  const adminUid = sql("select id from auth.users where email = 'admin@jsh.test'");
  const shahHH = 'd0000000-0000-4000-8000-000000000101', dev = 'd0000000-0000-4000-8000-000000000203', anya = 'd0000000-0000-4000-8000-000000000204';

  // ── Setup (test data) ─────────────────────────────────────────────────────
  const workerPw = crypto.randomBytes(24).toString('hex');
  sql(`alter role connect_worker with password '${workerPw}'`);
  const conn = sql(`insert into app.integration_connections (center_id, provider, status, display_name)
                    values ('${jsh}', 'stripe', 'connected', 'E2E test account')
                    on conflict (center_id, provider) do update set display_name = excluded.display_name, status = 'connected'
                    returning id`);
  sql(`delete from app.integration_secrets where connection_id = '${conn}'; delete from app.worker_heartbeats;
       update app.jobs set status = 'cancelled' where status in ('queued','running') and kind in ('demo.ping','storage.retention');`);
  const auditMark = Number(sql('select coalesce(max(id), 0) from app.audit_log'));
  // A clean TOTP factor for the admin (enrolled and verified through GoTrue's real MFA API).
  for (const f of JSON.parse(sql(`select coalesce(json_agg(id), '[]') from auth.mfa_factors where user_id = '${adminUid}'`)))
    await fetch(`${API}/auth/v1/admin/users/${adminUid}/factors/${f}`, { method: 'DELETE', headers: serviceH });
  const secretValue = `sk_test_e2e_${run}_VALUEZ9Q`;

  const adminAal1 = await apiLogin('admin@jsh.test');
  const enroll = await fetch(`${API}/auth/v1/factors`, { method: 'POST', headers: { ...anonH, authorization: `Bearer ${adminAal1}` }, body: JSON.stringify({ factor_type: 'totp', friendly_name: `e2e ${run}` }) }).then((x) => x.json());
  const totpSecret = enroll.totp && enroll.totp.secret;
  ok(Boolean(totpSecret), 'the admin enrolls an authenticator app (GoTrue MFA)');
  const ch = await fetch(`${API}/auth/v1/factors/${enroll.id}/challenge`, { method: 'POST', headers: { ...anonH, authorization: `Bearer ${adminAal1}` }, body: '{}' }).then((x) => x.json());
  const aal2 = await fetch(`${API}/auth/v1/factors/${enroll.id}/verify`, { method: 'POST', headers: { ...anonH, authorization: `Bearer ${adminAal1}` }, body: JSON.stringify({ challenge_id: ch.id, code: await freshTotp(totpSecret) }) }).then((x) => x.json());
  const adminAal2 = aal2.access_token;

  // ── 1. Vault: step-up required ────────────────────────────────────────────
  const noStep = await rpc(adminAal1, 'set_integration_secret', { p_connection: conn, p_name: 'api_key', p_value: secretValue, p_reason: 'e2e' });
  ok(noStep.status === 400 && noStep.body && noStep.body.code === 'CCSTP', `without a fresh 2FA check the API answers CCSTP (${noStep.status} ${noStep.body && noStep.body.code})`);

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  let t0 = Date.now();
  for (let i = 0; i < 20; i++) {
    await p.goto(BASE + '/login'); t0 = Date.now() - 2000;
    await p.fill('input[name=email]', 'admin@jsh.test'); await p.click('button[type=submit]');
    const asked = await p.waitForSelector('input[name=code]', { timeout: 5000 }).then(() => true, () => false);
    if (asked || !/Too many codes/.test(await p.innerText('body'))) break;
    await sleep(5000);
  }
  await p.waitForSelector('input[name=code]', { timeout: 15000 }).catch(async (e) => {
    await p.screenshot({ path: `${OUT}/login-failed.png` });
    throw new Error(`the portal sign-in did not ask for a code: ${(await p.innerText('body')).slice(0, 600)} (${e.message})`);
  });
  await p.fill('input[name=code]', await mailCode('admin@jsh.test', t0));
  await p.click('button[type=submit]'); await p.waitForURL((u) => !u.pathname.startsWith('/login'));
  await p.goto(BASE + '/settings/integrations', { waitUntil: 'networkidle' });
  const tile0 = await p.locator('section', { hasText: 'Background service' }).first().innerText();
  ok(/Background service not configured/.test(tile0), 'before the worker ever runs, the tile says "Background service not configured"');
  await p.screenshot({ path: `${OUT}/integrations-1-not-configured.png`, fullPage: true });

  const vaultCard = p.locator('section', { hasText: 'Connections and secrets' });
  await vaultCard.locator('tr', { hasText: 'E2E test account' }).first().waitFor();
  await vaultCard.getByRole('button', { name: '+ Add a secret' }).first().click();
  const dlg = p.getByRole('dialog');
  await dlg.getByLabel('Name').fill('api_key');
  await dlg.getByLabel('Value').fill(secretValue);
  await dlg.getByLabel('Reason (kept in the audit log)').fill(`Connecting the test account ${run}`);
  await dlg.getByRole('button', { name: 'Save secret' }).click();
  await p.getByRole('dialog').filter({ hasText: 'Confirm it' }).waitFor({ timeout: 15000 });
  await p.screenshot({ path: `${OUT}/integrations-2-step-up.png`, fullPage: true });
  await p.getByRole('dialog').getByLabel('Code from your authenticator app').fill(await freshTotp(totpSecret));
  await p.getByRole('dialog').getByRole('button', { name: 'Verify and continue' }).click();
  const saved = await until(() => sql(`select fingerprint from app.integration_secrets where connection_id = '${conn}' and name = 'api_key'`), 20000);
  ok(saved === secretValue.slice(-4), `the portal saved the secret after the step-up; fingerprint ${saved}`);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/integrations-3-saved.png`, fullPage: true });
  const pageHtml = await p.content();
  ok(pageHtml.includes('••••' + secretValue.slice(-4)) && !pageHtml.includes(secretValue.slice(0, -4)), 'the page shows only ••••' + secretValue.slice(-4));
  const aSet = sql(`select client_app || '|' || coalesce(client_screen, '') || '|' || coalesce(reason, '') || '|' || (actor_user_id = '${adminUid}')::text
                    from app.audit_log where action = 'integration_secrets.insert' and id > ${auditMark} order by id desc limit 1`);
  ok(aSet === `portal|/settings/integrations|Connecting the test account ${run}|true`, 'audit: set from the portal, screen, reason, actor: ' + aSet);

  // Never visible over the API, to any role.
  const needle = secretValue.slice(4, -4);
  const probes = [
    ['authenticated reads vault.secrets', await fetch(`${API}/rest/v1/secrets?select=*`, { headers: userH(adminAal2, 'vault') })],
    ['authenticated reads vault.decrypted_secrets', await fetch(`${API}/rest/v1/decrypted_secrets?select=*`, { headers: userH(adminAal2, 'vault') })],
    ['service_role reads vault.decrypted_secrets', await fetch(`${API}/rest/v1/decrypted_secrets?select=*`, { headers: { ...serviceH, 'accept-profile': 'vault' } })],
    ['anon reads vault.decrypted_secrets', await fetch(`${API}/rest/v1/decrypted_secrets?select=*`, { headers: { ...anonH, 'accept-profile': 'vault' } })],
    ['authenticated selects integration_secrets.*', await fetch(`${API}/rest/v1/integration_secrets?select=*`, { headers: userH(adminAal2) })],
    ['authenticated selects vault_secret_id', await fetch(`${API}/rest/v1/integration_secrets?select=vault_secret_id`, { headers: userH(adminAal2) })],
  ];
  for (const [label, r] of probes) { const t = await r.text(); ok(r.status >= 400 && !t.includes(needle), `${label}: refused (${r.status})`); }
  const fpRows = await fetch(`${API}/rest/v1/integration_secrets?select=name,fingerprint&connection_id=eq.${conn}`, { headers: userH(adminAal2) }).then((r) => r.text());
  ok(fpRows.includes(secretValue.slice(-4)) && !fpRows.includes(needle), 'the fingerprint columns are readable, the value is not in them');
  for (const [who, h] of [['the admin', userH(adminAal2)], ['service_role', { ...serviceH, 'content-profile': 'app' }]]) {
    const r = await rpc(null, 'worker_read_secret', { p_connection: conn, p_name: 'api_key' }, 'app', h);
    ok(r.status >= 400 && !JSON.stringify(r.body).includes(needle), `${who} cannot call worker_read_secret (${r.status})`);
  }
  const sqlProbe = execSync(`psql "${DB}" -qAtX`, { input: "set role authenticated; select decrypted_secret from vault.decrypted_secrets limit 1;" , stdio: ['pipe', 'pipe', 'pipe'] }).toString();
  ok(!sqlProbe.includes(needle), 'SQL as authenticated cannot read vault.decrypted_secrets');
  ok(sql(`select count(*) from app.audit_log where id > ${auditMark} and (coalesce(before::text,'') || coalesce(after::text,'') || coalesce(reason,'')) like '%${needle}%'`) === '0',
    'the value is in no audit entry');

  // ── 2. The worker, as connect_worker ─────────────────────────────────────
  const logs = [];
  const worker = spawn(process.execPath, [WORKER_JS], {
    env: {
      PATH: process.env.PATH, WORKER_DATABASE_URL: `postgres://connect_worker:${workerPw}@${new URL(DB).host}/postgres`, WORKER_ID: `e2e-worker-${run}`,
      WORKER_HEALTH_PORT: '3610', WORKER_POLL_MS: '500', WORKER_HEARTBEAT_MS: '2000', SUPABASE_URL: API, SUPABASE_SECRET_KEY: KEYS.SERVICE_KEY,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', (d) => logs.push(...d.toString().trim().split('\n')));
  worker.stderr.on('data', (d) => logs.push(...d.toString().trim().split('\n')));
  const health = await until(() => fetch('http://127.0.0.1:3610/health').then((r) => r.status === 200).catch(() => false), 20000);
  ok(health, 'the worker (connect_worker role) starts and its health endpoint answers 200');
  ok(sql(`select count(*) from app.audit_log where id > ${auditMark} and action = 'worker_heartbeats.insert' and record_id = 'e2e-worker-${run}'`) === '1',
    'the worker starting is audited');

  const pingId = sql(`select app.enqueue_job('${jsh}', 'demo.ping', '{"fail_times":1,"secret":{"connection_id":"${conn}","name":"api_key"}}'::jsonb, now(), 3)`);
  const jobLine = () => sql(`select status || '|' || attempts || '|' || coalesce(last_error,'') || '|' || (run_after > now() + interval '15 seconds')::text from app.jobs where id = ${pingId}`);
  const firstTry = await until(() => { const l = jobLine(); return l.startsWith('queued|1|') ? l : null; }, 15000);
  ok(Boolean(firstTry) && firstTry.endsWith('|true'), 'the first attempt fails and is scheduled for a retry after its backoff: ' + firstTry);
  sql(`update app.jobs set run_after = now() where id = ${pingId}`);   // skip the 30 s wait
  const done = await until(() => sql(`select status from app.jobs where id = ${pingId}`) === 'done', 15000);
  const result = JSON.parse(sql(`select result from app.jobs where id = ${pingId}`) || '{}');
  ok(done && result.pong === true && result.attempt === 2 && result.secret && result.secret.found === true, 'the retry succeeds and the job read the secret: ' + JSON.stringify(result));
  ok(!JSON.stringify(result).includes(needle) && !logs.join('\n').includes(needle), 'the value is in neither the job result nor the worker log');
  const read = sql(`select reader || '|' || purpose || '|' || job_id || '|' || outcome from app.secret_access_log where connection_id = '${conn}' order by id desc limit 1`);
  ok(read === `e2e-worker-${run}|job ${pingId} demo.ping|${pingId}|read`, 'the read is in secret_access_log: ' + read);
  const jobAudit = sql(`select count(*) filter (where client_app = 'job') || '/' || count(*) from app.audit_log where id > ${auditMark} and record_table = 'jobs' and record_id = '${pingId}' and action = 'jobs.update'`);
  // client_app = job for every change the worker made; the one other entry is this flow's own run_after shortcut (psql).
  const [asJob, all] = jobAudit.split('/').map(Number);
  ok(asJob >= 3 && all - asJob === 1, 'every status change the worker made is audited as a job (claim, retry, claim, done): ' + jobAudit);
  ok(sql(`select count(*) from app.audit_log where id > ${auditMark} and action = 'secret_access_log.insert' and client_app = 'job'`) !== '0', 'the read is audited too');

  let tile1 = '';
  for (let i = 0; i < 3 && !/Running/.test(tile1); i++) {
    await p.goto(BASE + '/settings/integrations', { waitUntil: 'networkidle' });
    tile1 = await p.locator('section', { hasText: 'Background service' }).first().innerText();
    if (!/Running/.test(tile1)) { console.log('NOTE tile not showing Running yet: ' + tile1.slice(0, 200).replace(/\n/g, ' | ')); await sleep(2000); }
  }
  ok(/Running/.test(tile1) && /Last heartbeat/.test(tile1), 'the tile shows the service running with its heartbeat' + (/Running/.test(tile1) ? '' : ': ' + tile1.slice(0, 300)));
  await p.getByRole('button', { name: 'Send a test job' }).click();
  const uiPing = await until(() => sql(`select id from app.jobs where kind = 'demo.ping' and created_by = '${adminUid}' and status = 'done' and id > ${pingId} order by id desc limit 1`), 20000);
  ok(Boolean(uiPing), `the portal's "Send a test job" is picked up and done (job ${uiPing})`);
  await p.waitForTimeout(3500);
  await p.goto(BASE + '/settings/integrations', { waitUntil: 'networkidle' });
  const logText = await p.locator('section', { hasText: 'Secret access log' }).last().innerText();
  ok(logText.includes(`job ${pingId} demo.ping`), 'the access log on the page lists the read');
  await p.screenshot({ path: `${OUT}/integrations-4-running.png`, fullPage: true });

  // ── 3. Storage policies over the Storage API ─────────────────────────────
  const priya = await apiLogin('priya@jsh.test'), teacher = await apiLogin('teacher@jsh.test'), kiran = await apiLogin('kiran@jsh.test');
  const pdf = Buffer.from('%PDF-1.4\n% e2e test statement\n');
  const csv = Buffer.from('first_name,last_name\nTest,Person\n');
  const audio = Buffer.from('e2e test audio');
  const st = `${jsh}/${shahHH}/e2e-${run}.pdf`, rec = `${jsh}/${dev}/e2e-${run}.m4a`, recAnya = `${jsh}/${anya}/e2e-${run}.m4a`, imp = `${jsh}/e2e-${run}/people.csv`;
  const checks = [
    ['statements: the treasurer uploads a statement', await upload(adminAal2, 'statements', st, pdf, 'application/pdf'), true],
    ['statements: a member cannot upload one', await upload(priya, 'statements', `${jsh}/${shahHH}/fake-${run}.pdf`, pdf, 'application/pdf'), false],
    ['statements: a file that is not a PDF is refused', await upload(adminAal2, 'statements', `${jsh}/${shahHH}/x-${run}.txt`, Buffer.from('x'), 'text/plain'), false],
    ['recordings: a parent uploads the child\'s recitation', await upload(priya, 'recordings', rec, audio, 'audio/mp4'), true],
    ['recordings: a parent uploads for the other child too', await upload(priya, 'recordings', recAnya, audio, 'audio/mp4'), true],
    ['recordings: someone from another household cannot', await upload(kiran, 'recordings', `${jsh}/${dev}/k-${run}.m4a`, audio, 'audio/mp4'), false],
    ['imports: an admin uploads a source file', await upload(adminAal2, 'imports', imp, csv, 'text/csv'), true],
    ['imports: a member cannot', await upload(priya, 'imports', `${jsh}/e2e-${run}/p.csv`, csv, 'text/csv'), false],
    ['org-documents: an admin who is not the owner cannot upload', await upload(adminAal2, 'org-documents', `${jsh}/w9-${run}.pdf`, pdf, 'application/pdf'), false],
    ['a path outside the center folder is refused', await upload(adminAal2, 'imports', `e2e-${run}.csv`, csv, 'text/csv'), false],
  ];
  for (const [label, r, allowed] of checks) ok(allowed ? r.status === 200 : r.status >= 400, `${label} (${r.status})`);
  const reads = [
    ['statements: the household adult downloads it', await download(priya, 'statements', st), true],
    ['statements: another household cannot', await download(kiran, 'statements', st), false],
    ['statements: a teacher cannot', await download(teacher, 'statements', st), false],
    ['recordings: the child\'s teacher listens', await download(teacher, 'recordings', rec), true],
    ['recordings: a teacher of another class cannot', await download(teacher, 'recordings', recAnya), false],
    ['recordings: another household cannot', await download(kiran, 'recordings', rec), false],
    ['imports: a member cannot read an import', await download(priya, 'imports', imp), false],
  ];
  for (const [label, r, allowed] of reads) ok(allowed ? r.status === 200 : r.status >= 400, `${label} (${r.status})`);
  ok(sql(`select count(*) from app.jobs where kind = 'storage.scan' and status = 'queued' and payload->>'name' = '${imp}'`) === '1',
    'the import upload queued a malware scan that stays pending (no scanner chosen)');
  const off = await rpc(adminAal2, 'set_module_enabled', { p_center: jsh, p_module: 'gyan_path', p_enabled: false, p_reason: `e2e ${run}: recordings closed with the module` });
  ok(off.status < 300, 'Gyan Path switched off');
  const closed = await download(priya, 'recordings', rec);
  ok(closed.status >= 400, `with Gyan Path off, recordings are refused (${closed.status})`);
  await rpc(adminAal2, 'set_module_enabled', { p_center: jsh, p_module: 'gyan_path', p_enabled: true, p_reason: `e2e ${run}: back on` });
  ok((await download(priya, 'recordings', rec)).status === 200, 'switched back on, the parent hears the recording again');

  // ── 4. Retention removes an expired export ───────────────────────────────
  const exp = `${jsh}/${adminUid}/e2e-${run}.csv`;
  ok((await upload(adminAal2, 'exports', exp, csv, 'text/csv')).status === 200, 'exports: the person who asked stores an export');
  ok((await download(priya, 'exports', exp)).status >= 400, 'exports: nobody else reads it');
  // The local file backend keeps <bucket>/<name>/<version>; count the stored bytes directly.
  const STORAGE_CONTAINER = process.env.STORAGE_CONTAINER || 'cc-o-vault-storage-1';
  const filesOnDisk = () => { try { return Number(execSync(`docker exec ${STORAGE_CONTAINER} sh -c 'find "/var/lib/storage/stub/stub/exports/${exp}" -type f 2>/dev/null | wc -l'`).toString().trim()); } catch { return null; } };
  const before = filesOnDisk();
  sql(`update storage.objects set created_at = now() - interval '10 days' where bucket_id = 'exports' and name = '${exp}'`);   // make it expired
  const retId = sql(`select app.enqueue_job(null, 'storage.retention', '{}'::jsonb, now(), 3)`);
  const retDone = await until(() => ['done', 'failed'].includes(sql(`select status from app.jobs where id = ${retId}`)), 30000);
  const retRes = sql(`select status || ' ' || coalesce(result::text, last_error) from app.jobs where id = ${retId}`);
  ok(retDone && retRes.startsWith('done') && JSON.parse(retRes.slice(5)).deleted >= 1, 'the retention job removed the expired export: ' + retRes);
  ok(sql(`select count(*) from storage.objects where bucket_id = 'exports' and name = '${exp}'`) === '0', 'its storage row is gone');
  ok((await download(adminAal2, 'exports', exp)).status >= 400, 'and the file no longer downloads');
  const after = filesOnDisk();
  if (before === null || after === null) console.log(`NOTE could not look inside ${STORAGE_CONTAINER}; skipped the on-disk check`);
  else ok(before === 1 && after === 0, `the stored bytes are gone from the storage backend (${before} file before, ${after} after)`);
  ok(sql(`select count(*) from app.audit_log where action = 'storage.retention_delete' and record_id = 'exports/${exp}' and client_app = 'job' and reason like 'Retention: exports files are kept 7 days (job ${retId})%'`) === '1',
    'the removal has an audit entry naming the rule and the job');
  ok(sql(`select count(*) from storage.objects where bucket_id = 'statements' and name = '${st}'`) === '1', 'files that are not expired stay');

  // ── 5. Rotate and Disconnect in the portal ───────────────────────────────
  await p.goto(BASE + '/settings/integrations', { waitUntil: 'networkidle' });
  const rotated = `sk_test_e2e_${run}_ROTATEDW7`;
  await p.getByRole('button', { name: 'Rotate api_key' }).click();
  await p.getByRole('dialog').getByLabel('New value').fill(rotated);
  await p.getByRole('dialog').getByRole('button', { name: 'Rotate' }).click();
  await maybeStepUp(p, totpSecret);
  const rot = await until(() => sql(`select fingerprint || '|' || (rotated_at is not null)::text from app.integration_secrets where connection_id = '${conn}' and name = 'api_key'`) === `${rotated.slice(-4)}|true`, 20000);
  ok(rot, 'Rotate stores the new value (fingerprint ' + rotated.slice(-4) + ') and stamps rotated_at');
  await p.waitForTimeout(1500);
  const vaultId = sql(`select vault_secret_id from app.integration_secrets where connection_id = '${conn}' and name = 'api_key'`);
  await p.getByRole('button', { name: 'Disconnect api_key' }).click();
  await p.getByRole('dialog').getByLabel('Reason (kept in the audit log)').fill(`E2E finished ${run}`);
  await p.getByRole('dialog').getByRole('button', { name: 'Remove secret' }).click();
  await maybeStepUp(p, totpSecret);
  const gone = await until(() => sql(`select count(*) from app.integration_secrets where connection_id = '${conn}'`) === '0', 20000);
  ok(gone && sql(`select count(*) from vault.secrets where id = '${vaultId}'`) === '0', 'Disconnect removes the fingerprint row and the vault entry');
  ok(sql(`select reason from app.audit_log where action = 'integration_secrets.delete' order by id desc limit 1`) === `E2E finished ${run}`, 'the removal is audited with its reason');
  await p.waitForTimeout(1000);
  await p.screenshot({ path: `${OUT}/integrations-5-after-disconnect.png`, fullPage: true });

  // ── The worker stops cleanly ─────────────────────────────────────────────
  const exited = new Promise((r) => worker.on('exit', (code) => r(code)));
  worker.kill('SIGTERM');
  const code = await Promise.race([exited, sleep(15000).then(() => 'timeout')]);
  ok(code === 0, `the worker stops on SIGTERM (exit ${code})`);
  ok(sql(`select (stopped_at is not null)::text from app.worker_heartbeats where worker = 'e2e-worker-${run}'`) === 'true', 'and records that it stopped cleanly');
  await p.goto(BASE + '/settings/integrations', { waitUntil: 'networkidle' });
  const tile2 = await p.locator('section', { hasText: 'Background service' }).first().innerText();
  ok(/Not running/.test(tile2) && /was stopped/.test(tile2), 'after the stop, the tile says it is not running (and was stopped)');
  fs.writeFileSync(`${OUT}/worker.log`, logs.join('\n') + '\n');
  ok(logs.every((l) => { try { JSON.parse(l); return true; } catch { return false; } }), 'every worker log line is structured JSON');

  // Clean up the test factor and test files (test data only).
  await fetch(`${API}/auth/v1/admin/users/${adminUid}/factors/${enroll.id}`, { method: 'DELETE', headers: serviceH });
  for (const [bkt, n] of [['statements', st], ['recordings', rec], ['recordings', recAnya], ['imports', imp]])
    await fetch(`${API}/storage/v1/object/${bkt}`, { method: 'DELETE', headers: serviceH, body: JSON.stringify({ prefixes: [n] }) });
  await b.close();
  console.log(failures === 0 ? 'o-vault flow: all checks passed' : `o-vault flow: ${failures} check(s) failed`);
})().catch((e) => { console.error('FLOW FAILED:', e); process.exit(1); });
