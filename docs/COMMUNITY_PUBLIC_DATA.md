# What a community shows before you are part of it

Migration **0813** (drafted as 0615 in PR #115; the comments of 0614 still call it 0615) closes the table. It was approved by
the owner on 2026-10-14, after the phones moved to the member-app versions that read through 0614's functions (1.14.1 or
later; the app is at 1.19.0). The undo is in [Rollback](#rollback) below, the live checks in
[After the deploy](#after-the-deploy-what-to-check).

The community row (`app.centers`) holds the name and web name, the settings bag `rules`, the brand kit `branding`
and the module switches `feature_flags`. Until migration 0813, anyone (not signed in) can read the whole row of every
active or onboarding community, and any signed-in person can read every such row. This page lists what each flow
really needs, which keys are public, and how the data is read once the table is closed.

**Default deny:** a key that is not marked public below is never shown to someone who is not linked to the community.
"Linked" means: a member login of that community (`center_users`), an active staff role there (any scope; not one still
waiting for approval), its owner (`center_owners`), or a platform admin.

## How it is read (migration 0614)

| Function (callable without signing in) | Returns |
|---|---|
| `app.community_public(slug)` / `app.community_public_by_id(id)` | One community: id, slug, name, short_name, state_region, time_zone, currency, tradition, environment, status, category_key, and `branding`, `feature_flags`, `rules`. A linked caller gets the full settings; anyone else gets only the public keys below and no feature flags. `linked` says which. |
| `app.communities_public_list()` | The "choose your organization" list: active communities only, id, slug, name, short_name, state_region, environment. No settings. |
| `app.member_experience(id)` | Unchanged, except that a caller who is not linked gets the public branding keys only. |
| `app.category_profile`, `app.feature_access_for_me`, `app.list_experiences`, `app.find_community`, `app.community_by_join_code`, `app.center_slug_for_domain` | Unchanged. They return the experience catalog, the access ladder, or a name and web name; no community settings. |

Who sees which communities: until 0813, the same communities as the table (active and onboarding; a platform admin
sees all). After 0813: active ones, an onboarding one only when linked, everything for a platform admin.

## Flows

| Flow | Who | Needs |
|---|---|---|
| Community finder (app "Find your community", app.weaverams.org list) | guest or signed in | slug, name, short_name, state_region, environment (`communities_public_list`, `find_community`) |
| Address or deep link (`jsh.weaverams.org`, `/c/<slug>`, a flyer's event QR) | guest | the same five, by slug or id (`community_public`, `community_public_by_id`) |
| Welcome screen and guest browsing | guest | id, slug, name, short_name, time_zone, tradition, environment, category_key; public branding; public rules (gift-pack price on the store, points shown on Gyan / Anumodana, identifier labels); no feature flags (the app does not read them) |
| Sandbox join code | guest, then signed in | `community_by_join_code` (name, web name), then the row as above. After 0813 a sandbox still onboarding opens only once the tester is linked or it goes live (the code still names it; opening it says it was not found) |
| Signing up, finding the family, joining (not yet linked) | signed in, not linked | name, short_name, time_zone, state_region, environment: the public row |
| Staff invitation acceptance (portal `/invite/<token>`) | signed in | `accept_invitation` links the person first; the web name is read afterwards, as a linked person |
| Portal sign-in page branding by host | guest | name, short_name, slug, environment and the public branding (logo, mark, colours) |
| Public dashboard `/c/<slug>` | guest | id, slug, name, short_name, time_zone, status, environment, public branding |
| Portal after sign-in, connect-admin (event day) | linked staff | the full row of their own community (`rules` included), read from the table as today |
| Try the demo (`/demo`, the home page's demo button) | guest, then a demo person | the list comes from `demo_choices` (security definer; no community row is read as the guest). The demo person is linked to their demo community by `app.demo_link_personas`, so the portal reads that one row as a linked person. A demo community is a sandbox still "onboarding" by design, so guests and strangers do not see it |
| Which community is this address? (portal host, a community's own domain, the HTTPS check) | guest | `center_slug_for_domain` and `tls_host_allowed` (security definer: they answer for communities still being set up too, as before) |
| Event QR code, flyer page, public events | guest | the event's own rows (their policies ask security definer functions, not the community table); `community_public_by_id` for the community's name |

## Every key and its class

`rules` (writers: `src/lib/settings-rules.ts`, Settings › Rules, Setup, Store, Content, Numbering, Member app,
Storage, Messaging security, Platform, and the database functions named in parentheses):

| Key | Holds | Class |
|---|---|---|
| `identifiers.org_member_label`, `identifiers.org_household_label` | names of the organization's own ID numbers | **public** |
| `identifiers` (the rest: system names, digits, `legacy_systems`) | numbering setup, names of old systems | staff-only |
| `home.shortcuts` | which Home tiles the app shows | **public** |
| `points.anumodana_points`, `points.support_points`, `points.day_complete_bonus`, `points.gyan_practice_daily_cap` | point values the app shows | **public** |
| `points` (any other key) | | members-only |
| `store.gift_pack_cents` | gift-pack price shown on the store | **public** |
| `store` (cutoff, visible_to) | store settings | members-only |
| `membership`, `voting`, `lunch`, `boli`, `fees`, `rsvp`, `child_login_age`, `notifications`, `timings` | how the community runs | members-only |
| `security` (staff 2FA, session lengths, printed sign-in codes, phone sign-in) | | **staff-only** |
| `payments` (`offline_only`, `zelle.report_window_days`, `zelle.bank_account_id`) (0211, 0582, 0597) | where Zelle money lands | **staff-only** |
| `bank` (institution, statement format) | | staff-only |
| `accounting` (cash or accrual), `storage` (retention days), `niva` (answer sources, 0573), `version` | | staff-only |
| `onboarding` (wizard step, fields, source, request id, production slug, promotion ids; e-mails and people removed by 0613) | | **staff-only** |

`branding` (Settings, Setup, `app.set_center_branding` 0183, the seed): public keys are `colors.primary`,
`colors.accent`, `primary`, `accent`, `background`, `display_font`, `body_font`, `logo`, `logo_url`, `logo_path`,
`logo_dark_url`, `logo_dark_path`, `mark_url`, `mark_path`, `wordmark`, `website`, `map_url`, `address`,
`address_note`, `place_name`, `phone` (the organization's public phone), `links`, `dashboard_url`. Anything else
(for example `email_header_*`, or a key typed into the Settings JSON) is members-only.

`feature_flags` (store, bolis, pathshala, gyan_path, my_jain_way, saathi, niva, recurring_giving, surveys): not
public. Nothing private, but no app needs them before sign-in.

## What is left after 0813

A **member** of a community can still read their own community's staff-only keys from the table (the portal and the
member app read `rules` as signed-in members, and row security cannot hide columns). Closing that needs the portal
to read staff settings through a staff-only function first; it is a follow-up, not part of 0813.

## Inventory

Redone on 2026-10-14 against main (migrations up to 0800), by reading every final policy, function, trigger and view, and
every client. "As the calling role" means NOT inside a security definer function: those run as the table's owner, to which
row security does not apply (no table uses `force row level security`), so they read the table whatever the caller may.

### In the database

| Reader | Who calls it | After 0813 |
|---|---|---|
| Policies of `app.centers`: `centers_admin_update`, `centers_platform_all` (0010) | settings managers, platform admins | unchanged. An update with a `where` needs the row to be visible: settings managers are linked, platform admins read all |
| `centers_public_read` (0010) | everyone | replaced by `centers_guest_read` (guests, active only) and `centers_linked_read` (signed in, linked only) |
| `org_leaders_public_read` (0180), the only other policy that selects from `app.centers` | guests, signed in | moved to `app.community_open` (security definer): an active community's public leaders stay visible to everyone |
| Policies that call `access_center_open` / `can_use_feature` (events, content, streams, the public areas) | guests, signed in | both definer; follow the new open rule (an onboarding community is closed to guests and strangers) |
| `app.sync_during_action_due`, `app.sync_event_during_dates` (0004; triggers on actions / events read `time_zone`) | people who change an event or its checklist | security invoker, but fired by staff of that community (a scoped event lead included, who is linked by that role) or by definer functions. Test 813 section H proves it for an event-scoped lead: the date is the community's, never UTC or empty |
| `app.event_summary` (0653); `app.giving_pledges_behind`, `giving_household_summary`, `giving_unmatched_bank_lines`, `giving_zelle_waiting` (0656, 0742); `app.store_sales_summary` (0670); `app.reports_tz` and the six `reports_*` that call it (0672) | staff and members of the community | invoker; read only `time_zone`. Their callers are linked (a role of any scope, a member login, the owner) or platform admins |
| `app.platform_waiting`, `app.platform_community_summary` (0673) | platform admins | invoker; refuse everyone else first; a platform admin passes `centers_platform_all` |
| `app.niva_answer_from`, `niva_search_tsquery`, `niva_live_ref_current`, `niva_center_day_start` (0573-0575) | only definer functions | execute revoked from guests and signed-in people |
| View `app.automation_backlog` (0623) | platform admins | a view runs with its owner's rights; unchanged |
| The other security definer functions that read the table (about 275 of them:`community_public*`, `communities_public_list`, `find_community`, `community_by_join_code`, `center_slug_for_domain`, `tls_host_allowed`, `my_centers`, `category_profile`, `member_experience`, `demo_choices`, `demo_session_state`, `worker_demo_begin`, `worker_sign_in_context`, `entitlement`, `module_enabled`, `public_kpis`, the sandbox, marketplace, WeCare / CatchTheMatch, QuickBooks, payments and Niva functions) | everyone | security definer: unchanged. `access_center_open` and `community_open` are the two that changed |
| Foreign keys to `app.centers` | every insert | checked as the table's owner: unchanged |
| The background service (`connect_worker`): no privilege on the table; it works through definer functions | worker | unchanged |
| Words only: `merge_people`, `merge_households` and their previews ("different centers"), `demo_keep_tables` (a list of table names) | | not readers |

No view, policy or default calls an invoker function that reads the table, and no helper builds a policy that does.

### In the clients

| Client and file | Who | After 0813 |
|---|---|---|
| Portal `src/lib/session.ts` (the whole portal) | signed in | linked people read the full row as before. A signed-in person who is not linked gets the public part from `community_public` (so "no access", not "not found"); a community still being set up is "not found" to a stranger |
| Portal `src/app/login/page.tsx` | guest | `community_public`: an active community shows its branding; one still being set up shows the plain message and the sign-in still works |
| Portal `src/app/c/[slug]/page.tsx` (public dashboard) | guest | `community_public` (+ `entitlement`, `module_enabled`, `category_profile`, `public_kpis`, all definer) |
| Portal `src/app/invite/[token]/actions.ts` | signed in | after `accept_invitation`, which links the person first |
| Portal settings writers (`content/actions.ts`, `settings/rules/actions.ts`, `setup/actions.ts`, `store/actions.ts`, `lib/data/center-rules-write.ts`, `calendar/page.tsx`) | staff with the role | their own community, as linked people |
| Portal platform pages and actions, Niva's platform commands (`lib/commands/catalog/platform/shared.ts`) | platform admins | every page refuses anyone else first; a platform admin reads every row, and inserts and reads back a new community |
| Portal `/demo`, `src/lib/demo-signin/*`, `src/lib/supabase/proxy.ts` | guest, demo person | `demo_choices`, `worker_demo_begin`, `demo_session_state` are definer; the persona is linked to the demo community (test 813 section J) |
| Portal host and domain resolution (`src/lib/center-resolve.ts`, `/api/tenancy/*`) | guest | `center_slug_for_domain`, `tls_host_allowed`: definer |
| Portal public website (`src/app/site/*`) | guest | reads no community |
| Portal flyer route, QuickBooks / Intuit callback, payments routes, sign-in e-mail hook | staff, members, the background service | RPCs and definer functions only; the flyer route takes the branding from the linked session |
| Member app (connect-mobile 1.19.0) `src/lib/api/community.ts`, `member.ts` | guest, signed in | the finder, the list, the join code and the community itself go through `find_community`, `communities_public_list`, `community_by_join_code`, `community_public`, `community_public_by_id`. The table is read only when a function is missing from the database (never the case here) |
| Event-day app (connect-admin) `src/lib/session.ts` | signed in staff and volunteers | reads its community as a linked person (a role of any scope links). A signed-in person with no link gets "No community ... was found" (still denied) |
| End-to-end scripts (`e2e/flows/*`) | | run SQL as the database owner |

### A person who is linked

Linked means (`app.linked_to_center`): a member login (`center_users`), an active role of any scope that has started and has
not ended (a role waiting for its second approver starts at "infinity", so it does not count, exactly as it grants no
permission either), the owner, or a platform admin. Everything a person can do in a community needs one of those, so nobody
who can work in a community loses its row.

### What stays open after 0813

- **Joining is open.** Anyone who can sign in can make themselves a member of a live community: the app's "create my
  household" step has no approval (`app.create_my_household` takes a community id and checks no status), and a member reads
  their own community's settings (`rules`, `branding`, `feature_flags`) from the table, because row security cannot hide
  columns. So 0813 closes the table completely to guests, and to signed-in people who have not joined; it does not close it to
  someone who joins first (that leaves a new person, household and review-queue entry in that community, which its staff
  can see). A demo sign-in cannot join anything outside its demo (`app.demo_user_guard`). Closing the rest needs the portal
  and the apps to read staff-only settings through a staff-only function, and those columns taken away from signed-in
  people: a follow-up, not part of 0813.
- `center_slug_for_domain`, `tls_host_allowed` and `community_by_join_code` still name a community that is being set up
  to someone who knows its address or code (a name and a web name, nothing else).
- The event-day app does not fall back to `community_public` for a person with no link (it only shows a plainer message).

## What an installed app does

- **Member app 1.14.1 or later** (all current builds): reads through the functions; nothing changes.
- **An older build:** a guest can still see the community list and look an address up, but opening the community fails
  ("Something went wrong while trying to open your center"); a signed-in person who is not yet a member cannot find the
  community, so a new person cannot finish joining; a signed-in member opens their community as before.
- **A sandbox still being set up** cannot be opened by a guest with its join code, on any build, until it goes live or the
  tester is linked.

## Rollback

Run this in the Supabase SQL editor (as the `postgres` role). It is the exact inverse of 0813: the old read-everything
policy and the table-level grant for guests, and the three older definitions of what 0813 replaced (`app.community_open`
from 0614, `app.access_center_open` from 0586, the leaders policy from 0180). It changes nothing else and is safe to run twice.
The migration stays recorded as applied in `public.connect_schema_migrations`, so the next deploy does not apply it again;
to apply it again later, delete the row `0813_community_lockdown` from that table (or run the migration file by hand).

```sql
begin;

-- 1 · the table: the old policy back, the new two gone, guests hold the whole table again
drop policy if exists centers_guest_read on app.centers;
drop policy if exists centers_linked_read on app.centers;
drop policy if exists centers_public_read on app.centers;
create policy centers_public_read on app.centers for select to anon, authenticated
  using (status in ('active', 'onboarding'));
revoke select (id, slug, name, short_name, tradition, time_zone, country, state_region, currency, status, environment, category_key)
  on app.centers from anon;
grant select on app.centers to anon;

-- 2 · who may see a community (0614) and which communities the access areas open (0586)
create or replace function app.community_open(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select exists (select 1 from app.centers c
                  where c.id = p_center
                    and (c.status in ('active', 'onboarding') or app.is_platform_admin()))
$$;
create or replace function app.access_center_open(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select exists (select 1 from app.centers c
                  where c.id = p_center and (c.status in ('active', 'onboarding') or app.is_member_of(p_center)))
$$;

-- 3 · the public leaders (0180)
drop policy if exists org_leaders_public_read on app.org_leaders;
create policy org_leaders_public_read on app.org_leaders for select to anon, authenticated
  using (show_publicly and exists (select 1 from app.centers c where c.id = center_id and c.status in ('active', 'onboarding')));

commit;

-- Check: one policy named centers_public_read (anon, authenticated), and anon holds the whole table again.
select policyname, roles, cmd from pg_policies where schemaname = 'app' and tablename = 'centers' order by policyname;
select has_column_privilege('anon', 'app.centers', 'rules', 'select') as guests_read_rules_again;
```

## After the deploy: what to check

What the lead checks live, in this order. Anything marked **stop** means run the rollback and report.

1. **Guest, anon key (the closing itself).** `GET <project>/rest/v1/centers?select=rules` with the anon key and the
   `Accept-Profile: app` header is refused (`permission denied for table centers`, code 42501), and so are `select=*`,
   `select=branding` and `select=feature_flags`. **Stop** if any of them returns a row.
2. **Guest, the finder still works.** `select=slug,name,short_name,state_region,environment&status=eq.active` returns JSH and the
   other live communities; an onboarding community (for example a sandbox) is not in it. `POST /rest/v1/rpc/community_public`
   with `{"p_slug": "jsh"}` returns one row whose `rules` hold only the public keys.
3. **A signed-in outsider.** With the session of a person who belongs to another community (a demo person is the easy one):
   `GET /rest/v1/centers?select=slug` returns only their own community, not JSH.
4. **Try the demo.** Open `/demo` (and the home page's demo button): the list of people loads; start as the administrator:
   the portal opens the demo community, the switcher lists only it, and JSH is not reachable. Leave the demo.
5. **JSH portal.** Sign in as JSH staff: Home, Settings › Rules and a save, Giving and an event page load; the switcher lists
   JSH; no red "could not load" banner. As a platform admin: Platform › Centers lists every community, an onboarding one opens,
   and the switcher lists all that are not exited.
6. **Public pages.** The sign-in page of JSH shows its branding; `/c/jsh` renders; the public website pages load; an onboarding
   community's address shows the plain "no active community" message and the sign-in form still works.
7. **Member app (1.19.0).** "Find your community" lists JSH; open it as a guest and browse Home; sign in as a member and see the
   family; start signing up as a new person and reach the household step.
8. **Logs.** In the Supabase logs and the portal's server logs, search for `permission denied for table centers` and
   `[session] could not load` for ten minutes after the deploy. There should be none from the portal or the current app. Older
   app builds may show some (see "What an installed app does").
9. **Quick spot checks.** QuickBooks readiness for JSH loads; Niva answers a staff question; a push or e-mail test from
   Settings › Messaging goes out.
