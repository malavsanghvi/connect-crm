# Deploy Connect (DigitalOcean droplet + Supabase)

Where things run:

| Piece | Runs on | Address before a domain is set up |
|---|---|---|
| Connect CRM | droplet, port 3000 behind Caddy | `http://<droplet IP>`, and `https://<droplet IP>` once its certificate is confirmed (see "HTTPS for the portal") |
| Connect Admin (the event-day app) | droplet, port 3001 behind Caddy | `http://<droplet IP>:8081`, and `https://<droplet IP>:8444` (also `https://<portal domain>:8444`) once the portal's HTTPS is up (see "HTTPS for the event-day app") |
| Member app (web version) | droplet, static files | `http://<droplet IP>:8082`, and `https://<droplet IP>:8443` once the portal's HTTPS is up |
| Database, sign-in, sign-in emails | Supabase cloud | — |
| Background service (connect-crm `worker/`) | droplet, systemd unit `connect@worker`, health on `127.0.0.1:3010` only | — (nothing public) |

Every push to `main` in a repo deploys that app: a GitHub Action builds it, copies
it to the droplet over SSH, switches to it and checks it answers. The first deploy also
sets the droplet up (Node.js, Caddy, firewall, swap, service user); later deploys skip
that in seconds. connect-crm's deploy applies database migrations to Supabase first.

Nothing runs on your computer. You never log into the droplet.

## One-time setup

### 1. Supabase project

JSH's project is `qenubcnvjcmsxhmehvat` (`https://qenubcnvjcmsxhmehvat.supabase.co`). Its
URL and publishable key are committed as defaults in each repo's
`.github/workflows/deploy.yml`, so they need no GitHub setting. The publishable key is
public by design: it ships inside every browser and phone build, and row-level security
protects the data.

One value is still needed, and it is sensitive. It contains the database password you set
when you created the project; if you don't have it, reset it under Project Settings ›
Database.

| Value | Where in Supabase | Sensitive? |
|---|---|---|
| Session pooler connection string | **Connect** button (top of the dashboard) › **Session pooler**; replace `[YOUR-PASSWORD]` with the database password | **Yes**: full database access |

Use the **Session pooler** string (host `…pooler.supabase.com`, port **5432**). The
"Direct connection" host is IPv6-only and GitHub cannot reach it; the "Transaction
pooler" (port 6543) breaks migrations.

Never use the secret key (`sb_secret_…`, formerly `service_role`) anywhere in these apps,
in GitHub, or in a chat. The apps never need it; it bypasses every access rule. The one
exception is the background service's own dedicated key, `WORKER_SUPABASE_SECRET_KEY`
(owner decision 2026-10-06; see [Background service](#optional-worker-settings) and
[Malware scanning](#malware-scanning-virus-checks-of-uploads)), which the owner creates and
nothing else uses. If a key may have been exposed, create a new one and delete the old one
under Project Settings › API Keys.

### 2. Supabase settings (dashboard, once)

1. **Expose the app schema**: the dropdown only lists schemas that exist, and `app` is
   created by the first deploy. Create it empty now in **SQL Editor**:
   `create schema if not exists app;` (the first migration uses `if not exists`, so this
   is safe). Then Project Settings › Data API › **Exposed schemas** › reload › add `app` ›
   Save. Without it every screen shows "could not load".
2. **Sign-in emails must show the code**: Authentication › Emails (Email Templates).
   For both **Magic Link** and **Confirm signup**, set the subject to
   `Your Connect sign-in code` and paste the body of `supabase/templates/otp_code.html`.
   The default templates only contain a link; the apps ask for the 6-digit code.
3. **Site URL**: Authentication › URL Configuration › Site URL = the CRM address
   (`http://<droplet IP>` for now).
4. **Email sending**: Supabase's built-in email only delivers to members of your
   Supabase team, a few per hour. That is enough for you to test. Before anyone else
   signs in, set up custom SMTP (Authentication › Emails › SMTP Settings) with a
   provider such as Resend or SendGrid (both have free tiers).

5. **Two-step verification (staff 2FA)**: Authentication › Multi-Factor (Sign In / Providers
   › Multi-Factor): **TOTP (App Authenticator)** must be *Enabled* for both enrolment and
   verification (it is by default). The portal's Account › Security, the step-up modal and the
   database's `app.assert_step_up` all rely on it. Keep the max enrolled factors at 10 or more.
6. **Phone verification**: Authentication › Sign In / Providers › **Phone**: enable it and
   connect an SMS provider (Twilio, MessageBird, Vonage or Textlocal; decision O7 says Twilio).
   Until it is on, Account › Security says texting is not set up and invitations sent to a
   mobile number cannot be accepted (email invitations work). Do **not** set test OTPs in
   production. Staff can already sign in with email codes; the phone is a verified contact
   and later a backup factor.
7. **Recovery codes are not offered**: Supabase Auth has no recovery codes. A staff member who
   loses their phone is reset by another administrator (Settings › Team › Reset 2FA) or by the
   Community Connect team (`app.reset_staff_2fa`, as a platform admin), after checking who they
   are. The reset is audited as `security.reset_2fa`.

### 3. GitHub secrets and variables

In **each of the three repos**: Settings › Secrets and variables › Actions.

**Secrets** tab › New repository secret:

| Name | Value | Repos |
|---|---|---|
| `DROPLET_HOST` | droplet IP address | all three |
| `DROPLET_SSH_KEY` | the **private** key file `connect_deploy` (not `.pub`), whole file including the `-----BEGIN` / `-----END` lines | all three |
| `SUPABASE_DB_URL` | the Session pooler connection string | connect-crm only |
| `WORKER_DATABASE_URL` | the background service's connection string (see "Background service" below). Optional: without it the deploy skips the worker | connect-crm only |

Copy the private key to the clipboard:
- Windows: `Get-Content "$HOME\.ssh\connect_deploy" -Raw | Set-Clipboard`
- Mac: `pbcopy < ~/.ssh/connect_deploy`

**Variables** tab › New repository variable (all optional):

| Name | Value | Repos |
|---|---|---|
| `SITE_DOMAIN` | see "Domains" below | per repo |
| `CENTER_SLUG` | defaults to `jsh` | all three |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | only to point at a different Supabase project (e.g. staging): set both together, and in connect-crm change the `SUPABASE_DB_URL` secret to that project too. Normally all three repos use the committed defaults | per repo |

### 4. First deploy

Merge each repo's pull request into `main`, **connect-crm first** (it creates the
database). Each merge starts **Actions › Deploy**; the run summary shows the address.
To redeploy without a code change: Actions › Deploy › Run workflow.

### 5. First administrator

1. Open the member web app (`http://<droplet IP>:8082`) and sign in with your email.
   This creates your login.
2. Supabase › SQL Editor, run once:
   ```sql
   select app.bootstrap_first_admin('you@example.org', 'First', 'Last',
     'jsh', array['center_admin','treasurer','executive_committee']);
   ```
   It refuses once the community has an administrator; after that, roles are granted
   in the CRM (Roles) under the two-person rule.
3. Sign in to the CRM and Admin with the same email.

## Background service (connect-crm)

The background service (`worker/`) runs jobs from `app.jobs`: reading an
organization's credentials from the vault for the job that needs them, OAuth
exchanges (once the payment and QuickBooks connections are built), storage
retention, and the "Test" button in Settings › Integrations. It runs on the
droplet as `connect@worker` (the same `connect@.service` template as the apps)
and connects to the database as its own role, **`connect_worker`**, which can
only call the job and vault-reader functions: it has no table access at all.

Until `WORKER_DATABASE_URL` exists the deploy **skips** the worker (the Actions
run shows a "Background service skipped" notice) and Settings › Integrations
shows "Background service not configured".

### One-time setup (the owner does this; the deploy never sets the password)

The first deploy's migration (0170) creates `connect_worker` **without a
password**, so nothing can sign in as it yet. You set the password once, in
Supabase, and put the resulting connection string in GitHub. The password never
passes through the repository, the deploy log or a chat.

1. Make a password with **letters and digits only** (systemd reads the env file,
   and a connection string needs no escaping this way). For example, in a terminal:
   `openssl rand -hex 32`. Do not reuse the database password.
2. Supabase › SQL Editor, run once (paste your password between the quotes):
   ```sql
   alter role connect_worker with password '<the password>';
   ```
   Running it again later rotates the password; update the secret below right after.
3. Build the connection string from the **Session pooler** string you already use
   for `SUPABASE_DB_URL`: change the user from `postgres.<project-ref>` to
   **`connect_worker.<project-ref>`** and use the new password:
   `postgresql://connect_worker.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`
4. GitHub (connect-crm) › Settings › Secrets and variables › Actions › Secrets ›
   New repository secret: **`WORKER_DATABASE_URL`** = that string.
5. Re-run Deploy. The "Build and release the background service" job checks the
   worker answers on its health endpoint; Settings › Integrations then shows the
   background service "Running" with its last heartbeat, and the readiness check
   "Background service running" passes.

**What it reports.** Each heartbeat lists, per job kind, whether it is configured. The kinds that
call Anthropic (`niva.answer`, `import.suggest_mapping`, `qbo.match_suggest_ai`) also carry what
the last Anthropic calls got (`info.handlers.<kind>.ai`: working, paused by the spending limit and
until when, key refused, model or beta not available, unreachable) and whether
`ANTHROPIC_API_KEY` comes from Platform › Setup or the environment. Settings › Integrations shows
it as "AI service (Anthropic)", for example "Niva paused: AI spending limit until …", or "No AI
key" when neither has one. A busy moment the Anthropic client's own retry gets past is not
reported (only what each call finally got), so the heartbeat stays the same while calls work. It
is kept in memory, so it starts as "Not used yet" after every restart.

**Slots.** It runs up to `WORKER_CONCURRENCY` jobs at once (default 4). One slot is kept for
`niva.answer`, which is claimed first, so a long photo-album or QuickBooks import cannot keep a
member waiting for an answer; the other kinds share the rest. While there is no Anthropic key
(Niva cannot run) no slot is kept, and saving one in Platform › Setup brings it back.

The connection is encrypted (TLS). To also verify the server certificate, download
the certificate from Supabase › Project Settings › Database › SSL Configuration
and paste its full text into the repository **variable** `WORKER_DATABASE_CA`
(it is public, not a secret).

### Optional worker settings

All optional. A handler whose settings are missing reports "not configured"
(on the status tile and in the job's error) instead of pretending to work.

| GitHub secret | Used for |
|---|---|
| `STRIPE_SECRET_KEY`, `STRIPE_CLIENT_ID` | Community Connect's Stripe platform app (Stripe Connect) |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Community Connect's PayPal partner app |
| `INTUIT_CLIENT_ID`, `INTUIT_CLIENT_SECRET` | Community Connect's QuickBooks (Intuit) app |
| `RESEND_API_KEY` or `POSTMARK_SERVER_TOKEN` | the email sending service |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | texting |
| `ANTHROPIC_API_KEY` | Niva and import mapping suggestions |
| `WORKER_SUPABASE_SECRET_KEY` | storage retention **and** virus scanning (see the note below: adding it starts retention, which deletes files) |

| GitHub variable | Used for |
|---|---|
| `CLAMD_HOST` (`127.0.0.1`), `CLAMD_PORT` (3310 when unset), or `CLAMD_SOCKET` | where clamd listens, for virus scanning ([Malware scanning](#malware-scanning-virus-checks-of-uploads)); unset: the scanner is not configured |

`CLAUDE_MODEL` (a repository **variable**, not a secret) changes the Claude model Niva answers
with, and the one the import-mapping and donor-matching suggestions and the setup wizard's AI Test
use. Leave it unset to use the default in `worker/src/anthropic.ts` (`claude-opus-5-5`). Set it
only if the Anthropic account cannot use that model: Niva then marks questions failed with "The
AI model Niva uses (…) is not available to this Anthropic account". The value reaches the
background service on the next deploy (any push to `main`, or run **Deploy** by hand). Editing
`/srv/connect/worker.env` on the droplet does not last, because every deploy rewrites that file.

AI flyer art (`events.generate_flyer`, Flyers v2) calls **Google Gemini** and needs a **Gemini API key**:
**Platform › Setup › AI flyer art** (saved in the vault like every other platform key, never in this repository
or a log). Create it in Google AI Studio (aistudio.google.com › Get API key) on a Google Cloud project **with
billing turned on**: Gemini's image models have no free tier. Press **Test** in the wizard: it looks the model up
with the key (a free call, no picture is made, so it cannot see billing: a key whose project has none passes the Test
and fails on the first picture with "no quota", which the flyer maker says in plain words). The same page can choose the image model; without a choice it
uses **Gemini 3.1 Flash Lite Image** (about 4¢ a picture; Flash Image about 7¢, Pro Image about 14¢; prices from
ai.google.dev/gemini-api/docs/pricing, 2026-10-02). `gemini-2.5-flash-image` is not offered: Google shuts it down
on 2026-10-02. Organizers see the price on the button before every picture; each picture is made once and kept for
the whole community (`content/<center>/flyer-art/…`), a community can ask for at most 30 a day, and every flyer
has code-drawn art that costs nothing and always works. **Without a key** the flyer maker says "AI art needs a
Gemini key — ask your Community Connect admin (Platform › Setup)" and uses the drawn art; a background service
deployed before this change shows "needs updating" until the next deploy. A worker environment variable
`GEMINI_API_KEY` (and `GEMINI_IMAGE_MODEL`) also works, for a machine with no vault. Pollinations.ai, which this
job called before, is retired: it now answers HTTP 402 Payment Required most of the time, caps images at about
0.6 megapixels and ignores `nologo` (a watermark). `GEMINI_API_BASE` exists only to point tests at a local mock
server — do not set it in a real deploy.

These are Community Connect's own keys. An organization's keys never go here:
they are entered in Settings › Integrations and kept in the vault.

**Storage retention needs an owner decision.** Deleting a file for real (not just
its database row) has to go through the Storage API with a key allowed to delete,
which today means a Supabase secret key (`sb_secret_…`). This guide says never to
use that key, so the retention job ships **not configured**: expired imports,
exports and recordings are not removed until you either allow a dedicated secret
key used only by the worker (Project Settings › API Keys › create one named
`connect-worker`, store it as `WORKER_SUPABASE_SECRET_KEY`), or choose another
route. Nothing else in Connect uses it. Virus scanning (below) uses the same key: the
owner decided on 2026-10-06 to create it.

**Adding `WORKER_SUPABASE_SECRET_KEY` ALSO STARTS THE EXISTING STORAGE RETENTION JOB, WHICH
DELETES FILES: imports older than 90 days, exports older than 7 days, recordings older than
90 days, homework files older than 180 days (each community may have changed the imports,
recordings and homework numbers in Settings › Storage), and event flyer files nothing uses
any more after 7 days.** The first daily run removes everything that is already past its
period, in batches, and every removal is written to the audit log; the files cannot be brought
back. Check Settings › Storage of each community before you add the key. The key is sent in
the `apikey` header only, as Supabase says for `sb_secret_…` keys (`worker/src/storage-api.ts`).

### What the worker deploy does

- Builds `worker/` (its own package and lockfile) into one file, `server.js`.
- Writes `/srv/connect/worker.env` (root only, mode 600) over SSH stdin: the
  connection string and any optional settings above. It is never printed.
- `release.sh … worker 3010`: unpacks to `/srv/connect/worker/releases/<commit>`,
  restarts `connect@worker`, and waits for `http://127.0.0.1:3010/health` to
  answer 200. A wrong password shows up here as "not healthy", with the log.
- No Caddy site and no firewall change: the worker serves nothing outside the droplet.

Logs: they are JSON lines in the journal (`journalctl -u connect@worker`), with
any field that looks like a secret replaced by `[redacted]`.

## Malware scanning (virus checks of uploads)

Built in connect-crm migration 0589 and **switched off**. Owner decisions 2026-10-06: hosting the scanner "not now", so
it is built switched off and turned on later; an infected file is deleted and the family and the office are told (never
with the file's name); files uploaded before scanning starts are checked once, in the background; the owner creates the
worker's Supabase key.

**While it is off (today)** nothing changes: every upload to a scanned bucket (branding, content, photos, store,
recordings, homework, imports, org-documents) still queues a `storage.scan` job, as it has since 0172; the background
service does not claim them (Settings › Integrations lists "Virus check of an uploaded file" as not configured,
"Virus scanning is switched off"), so they wait; nothing is held back or removed; Settings › Storage says "Virus
scanning is switched off" and how many files are waiting to be checked.

**The modes** are a platform setting: Platform › Setup › Background service › **Virus scanning of uploads**
(`UPLOAD_SCAN_MODE`; a platform admin with a fresh 2FA check; audited). The database's read rules and the background
service both follow it, within a minute. The worker never takes it from its environment.

| Mode | What happens |
|---|---|
| off (default) | Nothing is checked; the checks wait in the queue. |
| monitor | Every upload is checked with ClamAV and the result recorded (`app.upload_scans`). **Nothing is denied and nothing is removed**: an infected file is kept and written to the audit log (`storage.scan_infected`, "kept"), so you can see what the scanner finds before anything is enforced. |
| enforce | Homework files and recordings uploaded after the switch are opened by the family at once and by the teachers and reviewers only once they are clean (Pathshala › Homework says "Being checked for viruses"; a check that could not finish keeps the file with the family). An infected file, in any scanned bucket, is refused to everyone at once, then deleted through the Storage API; the homework part is marked removed by the virus check, a recording is cleared from the learner's progress, a photo is marked removed; the learner (and a child's household adults) or the uploader is told (`upload.removed`, push and email, no file name); the office gets an audit entry (`storage.scan_infected`) and, when the answer was already with the reviewers, they get a push. Photos, organization documents, content and the store are not held back yet (`app.upload_scan_gated_buckets` names them for later). |

Switching to monitor or enforce queues a sweep at once (`storage.scan_sweep`, then every 6 hours): it queues a check for
every file that has none (the backlog: everything uploaded before scanning started), the infected files still stored
(enforce), and checks that failed for a passing reason a day ago. Checks run **one file at a time, after every other kind
of job**, so a backlog never holds up messages or imports. A scanner that is down is retried for about 18 hours (25
attempts); then the file is recorded as "could not be checked" and tried again a day later.

**Turning it on**, in this order:

1. **Resize the droplet to 4 GB** (DigitalOcean › the droplet › Resize › CPU and RAM only; the disk can stay; the apps
   are down for a few minutes). ClamAV holds its signature database in memory (about 1.2 GB, more while it reloads),
   which a 1 GB droplet cannot.
2. **Install ClamAV**, once, from a checkout of connect-crm: `ssh root@<droplet> 'bash -s' < deploy/clamav-setup.sh`.
   It refuses to install below 3.5 GB of memory (and below 1.5 GB of free disk) and says so; otherwise it installs
   clamav-daemon and freshclam, sets the limits (60 MB a file, archives 10 deep and 5000 files, a minute a file, two
   threads, no second database in memory while signatures reload, Office macros count as infected), listens on
   **127.0.0.1:3310 only**, makes the kernel stop clamd before the apps when memory runs out, and checks that clamd
   answers and finds the EICAR test file. The deploy never runs it. Run it again after a ClamAV package upgrade.
3. GitHub › connect-crm › Settings › Secrets and variables › Actions › **Variables** › New repository variable:
   **`CLAMD_HOST`** = `127.0.0.1` (`CLAMD_PORT` only if you changed 3310; `CLAMD_SOCKET` instead, for clamd's unix
   socket). Every deploy writes `/srv/connect/worker.env` from these variables (empty ones are left out), so editing
   that file on the droplet does not last.
4. **The worker's key**, if it is not there yet: Supabase › Project Settings › API Keys › Secret keys › create one named
   `connect-worker`; GitHub › Secrets › **`WORKER_SUPABASE_SECRET_KEY`**. **This also starts storage retention, which
   deletes files (see [the note above](#optional-worker-settings)): read it before you add the key.**
5. Run **Deploy**. Settings › Integrations still lists the virus check as not configured: "Virus scanning is switched
   off". That is expected until step 6.
6. Platform › Setup › Background service › Virus scanning of uploads: **monitor**. Watch Settings › Storage of a
   community: files waiting to be checked go down, clean goes up; "could not be checked" and "found infected (kept)"
   are the ones to look at (the audit log has each `storage.scan_infected`).
7. About a week later, when nothing unexpected showed up: **enforce**. Infected files found in monitor mode are removed
   by the next sweep (within 6 hours); new uploads at once.

**Turning it off again**: set the mode to off. Nothing is denied any more; the checks wait in the queue again; recorded
results stay.

Not done by the scanner (follow-ups in docs/BACKLOG.md): telling a file's real type from its first bytes (today the
buckets check the type the uploader declares, and the size); holding back photos, organization documents, content and
store files until they are checked; the member app's "Checking the file…".

## HTTPS for the portal (o-https)

Every connect-crm deploy sets this up; there is nothing to switch on. What it does:

- **Port 80 keeps serving the portal, always.** A request is sent on to `https://` only for a
  name whose certificate the server has *confirmed* (below). Nothing that works on `http://`
  today stops working because a certificate is missing or late.
- **The droplet address (no domain needed).** Caddy asks Let's Encrypt for a certificate for
  the IP address itself. Let's Encrypt issues IP certificates only on its short-lived profile
  (about 6 days; Caddy renews them on its own), which needs **Caddy 2.10 or later**: the deploy
  upgrades an older Caddy package once, and if Caddy still refuses the setting the address
  simply stays on `http://` and Platform › HTTPS says why.
- **Any domain, with no redeploy.** Caddy serves every HTTPS name "on demand" and asks the
  portal (`/api/tenancy/tls-ask` → `app.tls_host_allowed`, migration 0330) before requesting a
  certificate. The portal says yes for the portal domain saved in Platform setup, the
  organizations' base domain and `<slug>.<base>` of a real community, and organizations'
  registered own domains; never for anything else.
- **The HTTPS check** (`connect-https-confirm.timer`, every minute, installed by the deploy):
  for each of those names it checks that DNS points at the droplet, then connects over HTTPS
  and verifies the certificate the way a browser does. That first connection is also what
  makes Caddy fetch a newly saved domain's certificate. Confirmed names get the `http://` →
  `https://` redirect and HSTS (30 days); a name that stops verifying loses them again within a
  minute. The result is shown in **Platform › HTTPS** (and the Platform setup wizard).
- **The renewal safety net (owner, 2026-10-06).** The IP certificate is short-lived, so Caddy
  renews it every few days. On 2026-10-03 and 2026-10-06, after each renewal, Caddy answered
  every TLS handshake on 443, 8443 and 8444 with alert 80 ("internal error") until it was
  reloaded (`systemctl reload caddy`, which every deploy runs); plain `http://` kept working.
  The HTTPS check now reloads Caddy itself when the droplet address fails its check, at most
  once every 10 minutes (the attempt is recorded in `/var/lib/connect-https/last-reload.json`),
  waits a few seconds and checks the failed names again. **Platform › HTTPS** and the status
  file (`caddy_reload`) say when it last did so and whether it helped. A domain's failure never
  reloads Caddy (its DNS may be the cause). Finding the root cause is B47 in the backlog.
- **Session cookies** are marked Secure on HTTPS requests. **The member web app** is also
  served over HTTPS on port **8443** of the same names (`https://<droplet IP>:8443`).
- `PORTAL_PUBLIC_URL` (links in messages) follows `SITE_DOMAIN` when it is not set; the
  background service otherwise uses the portal domain saved in Platform setup (https once
  confirmed).

**The owner's one manual step:** at your DNS provider, add an **A record** for the portal's name
(for example `crm.jsh.org`) pointing at the droplet IP, and save the same name in Platform setup
(Portal address and HTTPS). HTTPS for it starts by itself a few minutes after DNS updates.
Then update Supabase › Authentication › URL Configuration: Site URL `https://crm.jsh.org`, and add
it to the redirect URLs. If a DigitalOcean *cloud* firewall is attached to the droplet, it must
allow 80, 443, 8443 and 8444 (the droplet's own firewall is opened by the deploy).

Local checks: `tests/caddy-sites.test.ts`, `tests/https-confirm.test.ts`,
`supabase/tests/31_https_test.sql`, `e2e/https-release.sh` (release.sh in a sealed namespace with
a real Caddy) and `e2e/flows/o-https.cjs` (real Caddy + confirmer + portal + browser).

## HTTPS for the event-day app (connect-admin, owner decision #17)

HSTS is per *host*, not per port: once a confirmed domain has sent it, a browser turns
`http://<domain>:8081` into `https://<domain>:8081` — and 8081 speaks plain HTTP, so that address
stops loading. The event-day app therefore gets **its own HTTPS port, 8444**, on the same names as
the portal. Addresses:

| When | Event-day app |
|---|---|
| Always (never broken by HTTPS or HSTS: browsers never pin an IP address) | `http://<droplet IP>:8081` |
| Once the portal's HTTPS is set up | `https://<droplet IP>:8444`, `https://<portal domain>:8444`, `https://<org>.<base domain>:8444` |
| After a name is confirmed by the HTTPS check | `http://<that name>:8081` redirects to `https://<that name>:8444` |
| With `SITE_DOMAIN` set in connect-admin (e.g. `admin.jsh.org`) | `https://admin.jsh.org` (and 8444 as above) |

How it fits on the one droplet (nothing to switch on; connect-admin's deploy passes `PORTAL_HTTPS=1`):

- **Each app's deploy writes only its own site file.** connect-admin writes `admin.caddy` (with the
  same `deploy/caddy-sites.mjs`, `--role app`; connect-admin carries an identical copy, as it does
  of `release.sh`). The **portal owns the shared pieces**: the global on-demand options
  (`00-on-demand-crm.caddy`, whose `/api/tenancy/tls-ask` approves the names), the IP-certificate
  decision and confirmed directory (`/etc/connect/https.json`) and the HTTPS check. connect-admin
  only reads them; the portal's deploy never touches `admin.caddy`.
- **Until the portal's HTTPS is set up** (no `/etc/connect/https.json` or no on-demand options),
  connect-admin's deploy writes exactly today's `:8081` site and says so in the log. If Caddy
  refuses the HTTPS site for any reason, the deploy puts the plain site back and warns with
  Caddy's reason; it never fails because of HTTPS.
- **Port 8081 keeps serving.** It redirects to `https://<name>:8444` only for names the HTTPS check
  has confirmed (the same marker files as the portal), and never to the portal's 443. HSTS on 8444
  is sent only for confirmed names, like the portal.
- A certificate belongs to a name, not a port, so a name the check confirmed on 443 works on 8444
  too; the check itself needs no change.
- Deploys of the two repos take a lock (`/var/lib/connect/caddy-sites.lock`) around their Caddy
  changes, and connect-admin uploads to its own directory (`/tmp/connect-deploy-admin`), so the two
  never validate each other's half-written files. A portal deploy without `PORTAL_HTTPS` (an old
  workflow) keeps the on-demand options while `admin.caddy` still uses them.
- Session cookies of the event-day app are marked Secure on HTTPS requests; on 8444 the browser
  treats the app as a secure context (camera for check-in scanning, `crypto.randomUUID`).

**Owner step:** if a DigitalOcean *cloud* firewall is attached to the droplet, also allow **8444**
(the droplet's own firewall is opened by the deploy). Then give event-day volunteers
`https://<portal domain>:8444` (or `https://<droplet IP>:8444`).

Local checks: `tests/caddy-sites.test.ts` (here) and `tests/https.test.ts` (connect-admin),
`sudo CADDY_BIN=… [ADMIN_REPO=…/connect-admin] bash e2e/https-release.sh all` (both deploys in a
sealed namespace with a real Caddy: `admin`, `admin-first`, `admin-domain`, `admin-legacy`,
`admin-no-ip`, `admin-refused`, `portal-legacy-after-admin`) and `e2e/flows/e-https-admin.cjs`
(real Caddy + confirmer + portal + connect-admin + browser).

## Domains (do this before real member data goes in)

The portal no longer needs this to get HTTPS (see "HTTPS for the portal": save the domain in
Platform setup and point DNS at the droplet). `SITE_DOMAIN` still works and is the way to give
connect-admin and the member web app their own names:

1. At your DNS provider, add **A records** pointing at the droplet IP, for example
   `crm.jsh.org`, `admin.jsh.org`, `app.jsh.org`.
2. Set the `SITE_DOMAIN` variable in each repo (`crm.jsh.org` in connect-crm, and so on).
3. Re-run Deploy in each repo. Caddy fetches HTTPS certificates automatically (for connect-crm,
   `http://` redirects only once the certificate is confirmed).
4. Update the Supabase Site URL to `https://crm.jsh.org`.

## Organization addresses (more than one organization)

The portal picks the organization from the web address (docs/ONBOARDING_PLAN.md §7,
decision O11). Without any of this it keeps working as today: the bare IP and the
`SITE_DOMAIN` address open `NEXT_PUBLIC_CENTER_SLUG` (JSH), and people who work with
several organizations switch with the **Center ▾** pill (remembered in a cookie).

To give every organization its own address (`jsh.communityconnect.app`,
`jsh-sandbox.communityconnect.app`, …):

1. **DNS** (at the provider of `communityconnect.app`):
   - `A  *.communityconnect.app  → <droplet IP>` (a wildcard record; one record covers
     every organization and every sandbox);
   - optionally `A  communityconnect.app → <droplet IP>` for the bare domain.
   - An organization's **own domain** (for example `portal.jsh.org`): the organization
     adds `CNAME portal.jsh.org → jsh.communityconnect.app` (or an A record to the
     droplet IP) at its DNS provider, and a platform admin registers it in
     Platform › Centers › *center* › Limits & addresses.
2. **Repository variable** in connect-crm: `SITE_WILDCARD_DOMAIN = communityconnect.app`.
   Optionally `MEMBER_APP_URL = https://app.communityconnect.app` (the member web app's
   address) so Settings › Member app prints an https join link and QR code.
3. Re-run Deploy. `release.sh` then serves any HTTPS name with **on-demand
   certificates**: Caddy asks the portal (`/api/tenancy/tls-ask`) before issuing one,
   and the portal says yes only for `<slug>.communityconnect.app` of a real community
   or a registered own domain. No DNS-provider credentials are needed (a wildcard
   certificate would need them). The first visit to a new address takes a few seconds
   while its certificate is issued.
4. Supabase › Authentication › URL configuration: add `https://*.communityconnect.app`
   to the redirect URLs.

One sign-in covers every `<slug>.communityconnect.app` address (the session cookie is
set for the base domain); an organization's own domain asks for its own sign-in.

## When a deploy fails

The failed step in Actions says what is missing or what broke:

- "Not set in Settings › Secrets and variables › Actions › Secrets" — add the named secret
  on the Secrets tab.
- `Permission denied (publickey)` — `DROPLET_SSH_KEY` is not the private half of the key
  added to the droplet, or it was pasted without the BEGIN/END lines.
- "did not answer on port …" — the app failed to start; the step prints its log.
- A migration error — nothing from that migration was applied (each runs in one
  transaction); fix it and push again.

## What the deploy does on the droplet

- `deploy/droplet-setup.sh` (same file in all three repos): swap, Node.js 22, Caddy,
  firewall (22, 80, 443, 8081, 8082), user `connect`, systemd unit `connect@.service`.
- connect-crm (`PORTAL_HTTPS=1`): `deploy/caddy-sites.mjs` writes the portal's Caddy sites,
  `deploy/https-confirm.mjs` is installed as `connect-https-confirm.timer`, and 8443 is opened
  (see "HTTPS for the portal").
- connect-admin (`PORTAL_HTTPS=1`, once the portal's HTTPS exists): `deploy/caddy-sites.mjs --role app`
  writes `admin.caddy` (8081 + 8444) and 8444 is opened (see "HTTPS for the event-day app").
- `deploy/release.sh`: unpacks the build to `/srv/connect/<app>/releases/<commit>`,
  points `current` at it, writes the Caddy site, restarts the service, waits for it to
  answer, keeps the last three releases.
- `release.sh` kind `worker` (connect-crm only): the background service, above.
  The other two repos never pass it, so for them the file behaves as before.
- `supabase/scripts/migrate.sh`: applies migrations not yet recorded in
  `public.connect_schema_migrations`, and loads `seed.sql` only into an empty database.

## QuickBooks Online (o-quickbooks)

Owner steps (nothing here is in git):
1. In the Intuit Developer portal create an app with the **Accounting** scope (`com.intuit.quickbooks.accounting`).
   Add the redirect URI `https://<portal host>/api/oauth/intuit/callback` for every portal address that connects QuickBooks
   (production keys for real companies; the development keys only reach Intuit sandbox companies).
2. Portal server env: `INTUIT_CLIENT_ID`, optional `INTUIT_SANDBOX_CLIENT_ID` (development keys), optional
   `INTUIT_REDIRECT_URI` (else derived from the request host), and `OAUTH_STATE_SECRET` (32+ random characters; signs the
   OAuth state). Missing ones make Connect say "QuickBooks isn't configured on the Community Connect server yet".
3. Worker env: `INTUIT_CLIENT_ID`, `INTUIT_CLIENT_SECRET`, optional `INTUIT_SANDBOX_CLIENT_ID` / `INTUIT_SANDBOX_CLIENT_SECRET`.
   `INTUIT_OAUTH_BASE`, `INTUIT_API_BASE`, `INTUIT_SANDBOX_API_BASE` are for tests only (the local mock `e2e/mocks/intuit.cjs`).
4. The worker renews every QuickBooks sign-in hourly (`qbo.refresh_token`), pulls the lists daily, and posts as postings queue.

## Messaging: email, texting, WhatsApp, push and branded sign-in (connect-crm, o-messaging)

Community Connect sends for every organization through **its own** provider accounts (O7):
Resend (default) or Postmark for email, Twilio for texts and WhatsApp, Expo for push. Each
organization adds its own sending domain in **Settings › Email**, registers texting in
**Settings › Texting**, and records its WhatsApp number in **Settings › WhatsApp**. A missing
variable never fakes success: the job or route says "<Provider> isn't configured on the
Community Connect server yet".

**Owner steps (once, for the platform):**

1. **Resend** (or Postmark): create the account; create an API key with full access (it adds
   organizations' domains). Add a webhook to `https://<portal>/api/webhooks/resend` for
   `email.delivered, email.bounced, email.complained, email.opened` and keep its signing
   secret. Postmark: a server token, an **account** token (domains), and a webhook to
   `https://<portal>/api/webhooks/postmark` with HTTP Basic credentials whose password is
   `POSTMARK_WEBHOOK_TOKEN`. Verify Community Connect's own sending domain there and choose
   its address (`MESSAGING_FROM_ADDRESS`, e.g. `no-reply@mail.communityconnect.app`).
2. **Twilio**: the account SID and auth token; a number (or messaging service) for Community
   Connect's own texts (`TWILIO_FROM_NUMBER` / `TWILIO_MESSAGING_SERVICE_SID`); set each
   number's "A message comes in" webhook to `https://<portal>/api/webhooks/twilio` (POST).
   Organizations' 10DLC / toll-free registrations are filed in Twilio's console by the
   Community Connect team, who then records the decision with
   `app.set_messaging_review_status('texting', <id>, 'approved', <note>, '{"from_number":…,"brand_id":…,"campaign_id":…}')`
   (platform admin). WhatsApp numbers and templates are submitted to Meta the same way and
   recorded with `'whatsapp_account'` / `'whatsapp_template'`.
3. **Expo push**: nothing is required; optionally an access token (`EXPO_ACCESS_TOKEN`) if
   "enhanced push security" is turned on for the Expo project.
4. **Supabase Auth hooks** (the sign-in blocker): Supabase › Authentication › Hooks →
   *Send Email hook* → HTTPS → `https://<portal>/api/auth-hooks/send-email`; *Send SMS hook* →
   `https://<portal>/api/auth-hooks/send-sms`. Supabase generates each secret
   (`v1,whsec_…`): copy them into `SEND_EMAIL_HOOK_SECRET` / `SEND_SMS_HOOK_SECRET`.
   **Deploy the portal with the secrets first, then turn the hooks on** — while a hook is on and
   the route cannot answer, nobody can sign in. The phone provider set under Auth › Phone is no
   longer used once the SMS hook is on.
5. **Links**: `MESSAGING_LINK_SECRET` (any long random string: signs unsubscribe links) and
   `PORTAL_PUBLIC_URL` (e.g. `https://app.communityconnect.app`, used in links and to check
   Twilio signatures).

**Where each variable goes** (GitHub › Settings › Secrets and variables › Actions):

| Name | Kind | Used by |
|---|---|---|
| `WORKER_DATABASE_URL` | secret | worker; the portal's hook and webhook routes reuse it as `PORTAL_DATABASE_URL` (connect_worker role) |
| `RESEND_API_KEY` or `POSTMARK_SERVER_TOKEN` (+ `POSTMARK_ACCOUNT_TOKEN`) | secret | worker and portal |
| `RESEND_WEBHOOK_SECRET` / `POSTMARK_WEBHOOK_TOKEN` | secret | portal |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | secret | worker and portal |
| `SEND_EMAIL_HOOK_SECRET`, `SEND_SMS_HOOK_SECRET` | secret | portal |
| `MESSAGING_LINK_SECRET` | secret | worker and portal |
| `EXPO_ACCESS_TOKEN` | secret (optional) | worker |
| `MESSAGING_FROM_ADDRESS`, `MESSAGING_FROM_NAME`, `MESSAGING_EMAIL_PROVIDER`, `TWILIO_FROM_NUMBER`, `TWILIO_MESSAGING_SERVICE_SID`, `PORTAL_PUBLIC_URL` | variables | worker and portal |

The portal's values are written to `/srv/connect/crm.secrets.env` (root-only) and appended to
its env by `deploy/release.sh`. Tests never use these: every provider has a local mock
(`e2e/mock-providers.cjs`, `*_API_BASE`).

## Platform setup wizard (Platform › Platform setup, onboarding Wave D)

A Community Connect platform admin lands on `/platform/setup` at sign-in until it is complete
(the four required steps done; optional ones done or parked — parked steps stay on the Platform
home as reminders). Every provider key and setting listed above under Messaging, Payments and
QuickBooks — plus `ANTHROPIC_API_KEY`, `EXPO_ACCESS_TOKEN`, the Auth hook secrets, the portal
domain and the organizations' wildcard domain — can be entered there instead of as a GitHub secret:

- Keys go to Supabase Vault (`app.platform_secrets`, `app.set_platform_secret`: platform admin,
  fresh authenticator check, reason, audited with the last 4 characters only). Settings go to
  `app.platform_settings` (`portal_domain`, `wildcard_domain` and the env-named settings).
- The background service and the portal server read them **from the database first, their
  environment second**, through the `connect_worker` role (`app.worker_platform_config`,
  `app.worker_read_platform_secret`, every read logged in `app.secret_access_log`), refreshed
  at most every 60 seconds. No redeploy; existing GitHub secrets keep working as the fallback.
- **Not in the wizard, by design:** `WORKER_DATABASE_URL` (the app needs it to reach the database
  at all; the wizard's first step shows the exact steps above), the DNS records, and switching the
  Supabase Auth hooks on (Supabase › Authentication › Hooks, after the secret is saved).
- The wizard's Test button queues `platform.test_provider`: the background service calls the
  provider with the keys it will really use, and for email adds Community Connect's sending
  domain to Resend/Postmark and lists the DNS records to create. For AI it sends one real
  one-token message with the model and beta Niva uses, so a key that is valid but blocked by the
  account's spending limit (or an account without the model) fails the Test; a passing Test also
  clears "Niva paused" in Settings › Integrations on the next heartbeat.
