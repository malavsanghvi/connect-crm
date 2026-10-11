# Try the demo: how it signs people in (B88 part 2)

Anyone can open a demo community as one of its demo people (an administrator, a treasurer, a member ...) with no code and no real
email: the **Try the demo** button on the website and on the portal sign-in page opens `/demo`, where the visitor chooses a kind of
community, then a person, and presses Start. Nothing in a demo is real; the communities start over every night (job `demo.reset`).

## How it works without a service-role key

The portal holds no service-role key. The way in uses what the portal already has (the `connect_worker` database connection it
uses for the sign-in hooks and the platform keys):

1. **One real sign-in per demo person**, created once by a platform admin (Platform › Setup › Demo sign-in › Set up the sign-ins,
   `app.demo_signin_setup`): an Auth user on `…@demo.weaverams.org` (an address nobody receives mail on), with a 64-character random
   password kept in the Vault (`connect/demo/<address>`) and as a hash in Supabase Auth. No browser ever sees the password.
2. **Start** (`/demo` → Start): the portal server calls `app.worker_demo_begin(person, hash of the visitor's address)` as
   `connect_worker`. The database checks the switch, that the person is a demo person of a flagged demo sandbox, and the limits;
   records the session and the audit entry; and returns the sign-in. The portal signs in with it (the password grant), sets the
   session cookie, and calls `app.worker_demo_attach` to tie the new Auth session to the demo session.
3. **Every request** of a demo session is checked by the proxy (`src/lib/supabase/proxy.ts`): one call, as the demo person, to
   `app.demo_session_state()`. Anything but `ok` (two hours over, switch off, session not on record, check failed) clears the
   cookies and sends the person to `/demo?ended=…`. The database also **deletes the Auth session**, so it cannot be refreshed.
4. **The banner** on every portal page while in a demo: "You are exploring a demo community as <role> · Switch role · Leave the demo".

## Guardrails (all in the database, all tested: `supabase/tests/130_demo_signin_test.sql`)

| Guardrail | How |
| --- | --- |
| Only the demo community | Triggers refuse any membership, role, ownership or platform-admin flag outside a demo community for a demo sign-in; a real person's sign-in can never be registered as a demo one. |
| The flag cannot be dropped | A demo community is flagged by its own rules (`rules.demo`); every guardrail reads that flag. A trigger on `app.centers` refuses any change of the flag, kind, pack, name, short name, slug, status, environment, category or the `security` rule of a demo community unless the caller is a platform admin or the system itself, so the demo administrator (who holds settings.manage) cannot take the community out of the demo or rename what the public list shows. |
| Kill switch | Platform › Setup › Demo sign-in (platform admins, a reason, a fresh 2FA check). Off by default. Off: no new session, every running one ends, **and the demo sign-ins lose their membership, role and ownership at once** (a token kept outside the portal sees nothing). Turning it on gives them back. |
| 2 hours | `demo_sessions.expires_at`; checked on every request; the hourly `demo.reset` job and every start also sweep what ran out. |
| Rate limits | 24 starts per hour per visitor address (hashed; an IPv6 visitor is counted by their /64), 300 per hour and 20 per 5 minutes for the platform (Supabase Auth allows 30 sign-ins per 5 minutes from one address, and they all come from the portal). A visitor's own limit is checked before the global lock, and demo starts use their own one-connection database pool, so a burst of starts can never starve the sign-in hooks and webhooks. |
| Only demo addresses | The address must be on `demo.weaverams.org` (table check, trigger, the portal checks again). Sign-in codes for those addresses are never sent. |
| Audit | `demo.sign_in` / `demo.sign_out` entries: who = the demo person, role, hash of the address, why it ended. The switch and its reason are audited as a platform setting. |
| Nothing sent, test payments | Already in 0627: the messaging sender refuses a demo community; payment mode is always test. |
| Writes wiped | The reset takes the sign-ins apart, clears and reloads the community, and puts them back on the freshly loaded people. |
| Shared sign-in | A demo person's own sign-in settings cannot be changed from the portal. A trigger on `auth.users` also refuses a change of the password, address or phone, a pending change to be confirmed at another address or phone, and removing the demo mark, for a demo sign-in, unless `app.demo_assert_auth_user` raised the transaction-local setting `app.demo_auth_ok`. Auth's own writes (last sign-in time, tokens, a re-hash of the very same password) pass. A check that fails for any other reason lets the update through, so it can never get in the way of a real sign-in. Whatever changed from outside anyway is put back at the next start. The proxy also treats a token marked `app_metadata.demo` as a demo session (a person cannot edit that), not only an address on the demo domain. |
| Refresh stops at 2 hours | `app.worker_demo_attach` sets `auth.sessions.not_after` to the end of the demo session. Supabase Auth refuses to refresh a session after its `not_after`; I could not confirm that against the hosted version from here, so the portal's check on every request and the hourly sweep still end the session whether or not Auth honours it. |

## To turn it on (owner, once)

1. Check Supabase Auth (the Weaver owner; none of this can be read from the repository):
   - **"Single session per user" off** (a shared demo sign-in needs several sessions at once);
   - **"Secure email change" ON** and **manual identity linking OFF**; **phone sign-in auto-confirm OFF**;
   - **captcha protection off** for password sign-ins (the portal signs in on the server);
   - the **JWT expiry** (it is the tail described below; 3600 seconds is the default and the longest I would allow);
   - the migration role (`postgres`) can write `auth.users` and `auth.identities`, delete from `auth.sessions` and
     `auth.mfa_factors`, create a trigger on `auth.users`, and read the Vault (`vault.decrypted_secrets`, `vault.create_secret`).
     Migration 0150 already deletes from `auth.sessions`; the rest is new.
2. Platform › Setup › Demo sign-in: **Create the faith-based demo** and **Create the not faith-based demo**, then
   **Set up the sign-ins**, then **Turn the demo on** (each asks for a reason and the fresh 2FA check).
3. Open `/demo` in a private window and start as each kind of person. If a sign-in says "Database error querying schema", the
   Auth user rows made by `app.demo_signin_setup` are not readable by Auth: tell the Weaver team (see the PR for how they are
   written) and turn the demo off meanwhile.

## What a visitor with a copy of their own token can do (said plainly)

The two-hour limit and the kill switch are enforced by the portal on every request and by the database (it deletes the Auth
session; it takes the demo person's membership away when the switch goes off). A visitor who copies their token out of the browser
and calls Supabase directly keeps, at most, the rest of that token's life (Supabase's access-token lifetime, 1 hour by default)
after their session ends. Whatever they do in that time is limited to the demo community and is wiped by the next reset.

## Not built here

The member app's "Try the demo" (a separate pull request in connect-mobile): it calls an HTTP endpoint that returns the session
tokens instead of setting a cookie (`POST /api/demo/session`, same `startDemoSession` core and the same limits), then stores them
like a normal sign-in; the app's banner reads `app.demo_session_state()`.
