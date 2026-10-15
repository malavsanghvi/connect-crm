# Try the demo: how it signs people in (B88 part 2)

Anyone can open a demo community as one of its demo people (an administrator, a treasurer, a member ...) with no code and no real
email: the **Try the demo** button on the website and on the portal sign-in page opens `/demo`, where the visitor chooses a kind of
community, then a person (six are offered, in two areas: see "Who is offered"), and presses Start. Nothing in a demo is real; the communities start over every night (job `demo.reset`).

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

With QuickBooks connected to the faith demo, [DEMO_QUICKBOOKS.md](DEMO_QUICKBOOKS.md) has the whole order (Intuit sandbox company, the community, your own role in it, the connection, the sign-ins, the checks).

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

One thing a visitor can still do from their own browser is sign the shared demo person out everywhere (Auth's global logout). That
ends the other visitors' sessions of the same demo person; each is sent back to the demo page on its next click and starts again.
They cannot change the sign-in itself (password, address, phone) or keep a session of their own that is not on record.

## Who is offered (0815)

The public list of demo people (`app.demo_choices()`, the portal's `/demo` page and `GET /api/demo/choices`) offers only the **featured** people
(owner decision 2026-10-14), arranged in two areas: **Non-profit operational roles** (the community's administrator, treasurer, membership coordinator,
event lead and teacher, in that order) and **Community roles** (the family's main adult, shown as "Community member · Adult"). Each person in the list
carries their `area` (`operations` or `community`) and each community its public `id` and `slug`. A community with none of a role lacks it.
The list is `app.demo_featured_roles()`, the only place to change it (for example to offer the family's other adults instead of the main adult).
This changes only what the public list offers: the pack still has one demo person per role (`app.demo_missing_roles` requires it), every person keeps
their sign-in, `app.worker_demo_begin` is unchanged, and the portal banner's "Switch role" opens the same page.

### The community roles open the member app, not the portal (owner decision 2026-10-15)

On `/demo` the two areas behave differently. The people of the **Non-profit operational roles** area have **Start**, which POSTs to the portal
(`startDemoAction`), signs the visitor out of any real portal account in this browser first, and lands on the portal's Home. The people of the
**Community roles** area (`MEMBER_APP_AREA` in `src/lib/demo-signin/rules.ts`, the family roles whose work lives in the member app) have an **Open the member app**
link instead, to `<member app>/demo?persona=<persona id>` (`memberAppDemoPersonUrl`), which opens in the same tab and starts the demo in the member app as
exactly that person, on their signed-in Home. That link starts **no portal session** and signs the visitor out of **nothing**, so the "Starting the demo signs you out in this browser first" note on the page is
worded for the operational roles only. The member app's start is the `POST /api/demo/session` below, with the same guardrails. The contract with the app,
the second link (`?as=family`, used by the website) and the fallback are in [MEMBER_APP_DEMO.md](MEMBER_APP_DEMO.md) "The one-step path".

## The member app (docs/MEMBER_APP_DEMO.md)

The member app's "Try the demo" (a separate pull request in connect-mobile) calls two HTTP endpoints of the portal, in `src/app/api/demo/`:

- `GET /api/demo/choices` is the list above as JSON (with the community `id` and `slug`, so the app can open the community as a guest first).
- `POST /api/demo/session` with `{ "persona": "<id from the list>" }` runs the **same `startDemoSession` core** as the `/demo` page (the switch, the
  person check, the two-hour session, the limits per visitor address and for the platform, the audit entries, the Auth session tied to the demo session
  with `worker_demo_attach` and `auth.sessions.not_after`), but returns the Auth session (`access_token`, `refresh_token`, `expires_in`, `expires_at`,
  `token_type`) in the answer instead of setting a cookie, with `{ ends_at, role, name, community }`. Failures answer `{ ok: false, error, code }`, `code`
  being `off`, `limit`, `unknown_person` or `failed`, with the same sentences the web flow shows. The caller's own cookies are never read, set or cleared,
  and an earlier demo session is not ended by a start (the app ends its own with `demo_leave`).
- Both answer `Cache-Control: no-store` and CORS only for the member app's own address (`https://app.weaverams.org`; local Expo addresses only outside
  production); a request from a web page on another site is refused. The proxy leaves `/api/demo/*` alone (no session, no redirect, no demo check of a
  cookie). The app then keeps the session like a normal sign-in, ends a demo with `rpc demo_leave` and watches `rpc demo_session_state` through the
  Supabase client (both are granted to signed-in people and work with the token from outside the portal).
- **What a person with the token can do** is what a visitor of the web demo can do (above), and no more: the session is theirs openly instead of in a
  cookie. They act as that demo person, in that one demo community, until the two hours end (`not_after`, the state check the app makes, the sweep every
  demo start and the hourly job make) plus at most the rest of the access token's life; nothing they do survives the nightly reset. They can still sign the
  shared demo person out everywhere. The guardrails live in the database, not in the app, so a changed app or a hand-made request gets no more.

### A guest-style look around first (0816)

The app first lets a visitor look around the chosen demo community **as a guest, with no sign-in** (Home with the public events, the guide, the store),
and then offers "Be someone in the demo". For that, a demo community is open to guests while the demo switch is on, **and only then**:
`app.demo_public_open(center)` (a flagged demo sandbox, onboarding or active, while the switch is on) is the one question, and `app.demo_closed_to_guests(center)`
is its negation for demo communities only (false for every other community, so no other community's rule changes). It is used in the gates a guest passes:
`app.community_open` (the community by web name and id), `app.access_center_open` (the areas and the experience), `app.public_org_profile`, the policies
`centers_public_read` and `org_leaders_public_read`, and a restrictive `demo_guest_gate` policy for the role `anon` on the public tables the look-around
reads (events, guide, store, content, photo albums, timings, roster, campaigns, opportunities, membership types). Switched off, a demo community is gone
for a guest in all of them; a platform admin still opens it. **Guests never write**: no insert, update or delete policy or grant is touched. What is not
covered is listed in [MEMBER_APP_DEMO.md](MEMBER_APP_DEMO.md). Test: `supabase/tests/816_demo_guest_look_around_test.sql`.

## The faith demo is not any one faith (0820)

Owner decision, 2026-10-15: *"make everything in the Demo app neutral."* "Sunrise Worship Center (Demo)" was built as a Jain Center (the greeting "Jai Jinendra",
a "Jain Way" tab, a derasar, bolis, tapasvis, Pathshala classes). It is now a **Faith community**, the platform's own neutral faith experience (category
`faith_other`: the greeting is *Welcome*, the fourth tab and the school are both the *Learning Center*, the place is a *place of worship*), and nothing a
visitor reads names one tradition.

- **The pack** (`demo_faith_jain_v1`, version 4, migration 0820; the key keeps its old name because it is an internal identifier no screen shows and the demo
  community, the state row and the tests point at it): the events are a weekly gathering, an annual appreciation dinner and a community festival night; the
  fund, campaign, classes, notices, newsletter, inboxes and guide are in generic words; the store sells baked goods, snacks and a vegetarian lunch. Amounts,
  households (13) and the 34 people are the same; two children are new (below). The builder (`supabase/scripts/build-demo-packs.mjs`) refuses a pack marked neutral that contains a word of
  a tradition, and `supabase/tests/820_demo_faith_neutral_test.sql` checks what the database really holds.
- **No bolis, so no boli recorder.** A Faith community does not have the Bolis module (nor My Jain Way or Labh), and the boli recorder role is not part of that
  kind (`app.roles.category_keys`, 0600). Sarla Kataria, who held it, is still a person of the pack (the Kataria household, the dinner's food shift) but has no
  demo sign-in any more: **25 demo people**, one for each role the kind has. The public list (the six featured people) is unchanged.
- **The Learning Center.** In a Faith community the school (the Pathshala module) and the fourth tab ("Jain Way" in a Jain Center, "Learn" in the generic
  faith community) are both called "Learning Center": the category's `school` and `practice_tab` terms and the module label are set to it (0820), and the
  member app and the portal read them from the category profile. That is a **platform-wide word for the Faith community category**: there is no per-community override of a kind's words. The
  category is inactive, so only sandboxes can use it (the faith demo is the one that does), Jain Center keeps "Pathshala", and Church, Mosque and
  Swaminarayan Temple, which started from it, keep the words they were given.
- **Two children for the family of the community member.** The Patni household (Tarun, the main adult, and Nisha) has two plain-named children, Dev (9) and
  Maya (8), enrolled in the class Anita Bhandari teaches, so they are in her roster and attendance list and in the family's member app (Family, Learning). Their
  two fee pledges ($150.00 and, with the sibling discount, $135.00) are open. That class is the **one deliberate exception to the neutral wording** (owner,
  2026-10-15): it is named "Introduction to Jainism", because a course may be about Jainism; the greeting, tabs and chrome stay neutral, and the builder and the
  test allow that one name and nothing else.
- **The same community, in place.** `app.demo_align_center` brings a demo community in line with its pack's `center` spec without clearing anything: the
  category, the modules the pack needs and the kind leaves for Weaver to switch on (`pathshala`, `store`, `gyan_path`, `niva`: Weaver's grant, written by the
  pack), the choices only the old kind offers (the "Jain (no root vegetables)" dietary choice) and the demo people's stories. The migration ran it once on the
  community that exists (same id, same QuickBooks connection and account mapping, same demo sign-ins), and `app.demo_populate` runs it first on every creation and
  every reset, so the pack always loads into the community it describes.
- **When the words change.** The migration changes the kind at once (the greeting, the tabs and the module names in the apps follow the category). The words in
  the rows (notices, events, the store, classes, messages) are the pack's, so they change when the community is next loaded: **Platform › Setup › Demo
  sign-in › Start over** loads it now, or the hourly check does it on its own (see the header of 0820).
