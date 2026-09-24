# Deploy Connect (DigitalOcean droplet + Supabase)

Where things run:

| Piece | Runs on | Address before a domain is set up |
|---|---|---|
| Connect CRM | droplet, port 3000 behind Caddy | `http://<droplet IP>` |
| Connect Admin | droplet, port 3001 behind Caddy | `http://<droplet IP>:8081` |
| Member app (web version) | droplet, static files | `http://<droplet IP>:8082` |
| Database, sign-in, sign-in emails | Supabase cloud | — |

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
in GitHub, or in a chat. Nothing in Connect needs it; it bypasses every access rule. If it
may have been exposed, create a new one and delete the old one under Project Settings ›
API Keys.

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

## Domains (do this before real member data goes in)

Until then the apps are plain `http`: sign-in codes and sessions cross the network
unencrypted. Fine for trying it, not for real use.

1. At your DNS provider, add **A records** pointing at the droplet IP, for example
   `crm.jsh.org`, `admin.jsh.org`, `app.jsh.org`.
2. Set the `SITE_DOMAIN` variable in each repo (`crm.jsh.org` in connect-crm, and so on).
3. Re-run Deploy in each repo. Caddy fetches HTTPS certificates automatically.
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
- `deploy/release.sh`: unpacks the build to `/srv/connect/<app>/releases/<commit>`,
  points `current` at it, writes the Caddy site, restarts the service, waits for it to
  answer, keeps the last three releases.
- `supabase/scripts/migrate.sh`: applies migrations not yet recorded in
  `public.connect_schema_migrations`, and loads `seed.sql` only into an empty database.
