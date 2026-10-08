# What a community shows before you are part of it

The community row (`app.centers`) holds the name and web name, the settings bag `rules`, the brand kit `branding`
and the module switches `feature_flags`. Until migration 0615, anyone (not signed in) can read the whole row of every
active or onboarding community, and any signed-in person can read every such row. This page lists what each flow
really needs, which keys are public, and how the data is read once the table is closed.

**Default deny:** a key that is not marked public below is never shown to someone who is not linked to the community.
"Linked" means: a member login of that community (`center_users`), an active staff role there (any scope; not one still
waiting for approval), its owner (`center_owners`), or a platform admin.

## How it is read (migration 0614)

| Function (callable without signing in) | Returns |
|---|---|
| `app.community_public(slug)` / `app.community_public_by_id(id)` | One community: id, slug, name, short_name, state_region, time_zone, tradition, environment, status, category_key, and `branding`, `feature_flags`, `rules`. A linked caller gets the full settings; anyone else gets only the public keys below and no feature flags. `linked` says which. |
| `app.communities_public_list()` | The "choose your organization" list: active communities only, id, slug, name, short_name, state_region, environment. No settings. |
| `app.member_experience(id)` | Unchanged, except that a caller who is not linked gets the public branding keys only. |
| `app.category_profile`, `app.feature_access_for_me`, `app.list_experiences`, `app.find_community`, `app.community_by_join_code`, `app.center_slug_for_domain` | Unchanged. They return the experience catalog, the access ladder, or a name and web name; no community settings. |

Who sees which communities: until 0615, the same communities as the table (active and onboarding; a platform admin
sees all). After 0615: active ones, an onboarding one only when linked, everything for a platform admin.

## Flows

| Flow | Who | Needs |
|---|---|---|
| Community finder (app "Find your community", app.weaverams.org list) | guest or signed in | slug, name, short_name, state_region, environment (`communities_public_list`, `find_community`) |
| Address or deep link (`jsh.weaverams.org`, `/c/<slug>`, a flyer's event QR) | guest | the same five, by slug or id (`community_public`, `community_public_by_id`) |
| Welcome screen and guest browsing | guest | id, slug, name, short_name, time_zone, tradition, environment, category_key; public branding; public rules (gift-pack price on the store, points shown on Gyan / Anumodana, identifier labels); no feature flags (the app does not read them) |
| Sandbox join code | guest, then signed in | `community_by_join_code` (name, web name), then the row as above. After 0615 a sandbox still onboarding opens only once the tester is linked (see the owner list in PR B) |
| Signing up, finding the family, joining (not yet linked) | signed in, not linked | name, short_name, time_zone, state_region, environment: the public row |
| Staff invitation acceptance (portal `/invite/<token>`) | signed in | `accept_invitation` links the person first; the web name is read afterwards, as a linked person |
| Portal sign-in page branding by host | guest | name, short_name, slug, environment and the public branding (logo, mark, colours) |
| Public dashboard `/c/<slug>` | guest | id, slug, name, short_name, time_zone, status, environment, public branding |
| Portal after sign-in, connect-admin (event day) | linked staff | the full row of their own community (`rules` included), read from the table as today |

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

## What is left after 0615

A **member** of a community can still read their own community's staff-only keys from the table (the portal and the
member app read `rules` as signed-in members, and row security cannot hide columns). Closing that needs the portal
to read staff settings through a staff-only function first; it is a follow-up, not part of 0615.
