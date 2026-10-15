# Modules

Each major subsystem is a **module**. Since 0740, **Weaver (a platform admin) decides which modules a community has**
(Platform › Communities › [community] › Modules), and the community's admin (`settings.manage`) can pause any of them and
switch it back on (Settings › Modules). This page lists, per module, the tables, RPCs, portal routes, member-app screens and
permissions that belong to it, and what switching it off does.

Schema: `supabase/migrations/0100`–`0104`, `0594` (organization categories, below) and `0740` (platform grants). Tests:
`supabase/tests/13_modules_audit_test.sql`, `79_organization_categories_test.sql` and `150_module_grants_test.sql`.
Owner decisions recorded in [DECISIONS.md](DECISIONS.md); the categories plan is
[ORGANIZATION_CATEGORIES_PLAN.md](ORGANIZATION_CATEGORIES_PLAN.md).

## How the switch works

A module is **on** for a community when all four hold (0740):

1. the community's kind offers it (`app.category_modules`: not `not_available`);
2. Weaver has **granted** it: a row in `app.center_module_grants`, or, without a row, the kind's `default_on` (so a new
   community gets its kind's `default_on` set without anyone acting, and a `default_off` module waits for Weaver);
3. the community has **not paused** it (`app.center_modules`, its own switch);
4. every module it **depends on** is on, worked out the same way. Dependencies are evaluated, not checked at the switch:
   pausing Giving pauses Bolis and Accounting with it, and switching Giving back on brings them back as they were.

Core modules (People) are always on. Communities that existed before 0740 were grandfathered: every module that was on, or
that the community had switched itself, got a granted row, so nothing anyone saw changed.

| Piece | What it does |
|---|---|
| `app.modules` | The catalog: `key`, `label`, `description`, `core`, `depends_on`, `sort`. Readable by any signed-in user. |
| `app.center_modules` | The community's own switch (a pause): `enabled`, `changed_by`, `changed_at`, `reason`. No row means not paused. Readable by members of the center; written only by `set_module_enabled`. Audited; a fresh 2FA check (0154). |
| `app.center_module_grants` | Weaver's decision per community and module: `granted`, `reason`, `granted_by`, `granted_at` (0740). No row means the kind's availability decides. Readable by platform admins and the community's settings managers; written only by `set_module_grant`. Audited. A sandbox reset keeps it; promotion copies it. |
| `app.set_module_grant(center, key, granted, reason)` | Platform admins only, a reason, a fresh 2FA check (`platform.module_grant`). Refuses a core module (*"… is part of the core platform and is always on."*), a module the kind does not offer, and a change that changes nothing. Enabling switches the module on at once unless the community paused it; disabling hides it and its data (nothing is deleted). Returns `{module, label, granted, paused, enabled}`. |
| `app.module_tables` | Which module each app table belongs to. `NULL` = core platform (never switched off). A DB test fails if any app table is missing. |
| `app.module_enabled(center, key)` | The four rules above, for the module and every non-core module it needs. A NULL center (a global row) is never off. |
| `app.module_off_centers(key)` | The centers where the module is off, as one array: one SQL set query (the module's dependency chain, three rows at most, times the centers, joined on primary keys). The policies call it as an InitPlan, so a query evaluates it once. |
| `app.assert_module_enabled(center, key)` | Raises, in this order: *"{Module} is not part of a {Category} organization."* (the kind does not offer it); *"Weaver has not enabled {Module} for this community."* (hint: *Ask Weaver to enable it.*); *"{Module} is off because {Dependency} is off for this community."* (hint: *Settings › Modules shows why.*); *"The {label} module is switched off for this community."* (hint: *An administrator can switch it on in Settings › Modules.*). Platform admins pass. |
| `app.set_module_enabled(center, key, enabled, reason)` | The community's pause and resume. Needs `settings.manage` in that center (or platform admin) and a reason. Refuses a core module, a module the kind does not offer, and a module Weaver has not enabled (*"Weaver has not enabled {Module} for this community."*, also for a platform admin: grant it first). Dependencies do not block it. The reason goes on the audit entry. |
| `app.my_modules(center)` | `(key, label, enabled, core)` for the apps; empty for someone who is not a member. `enabled` is the result of the four rules, so a module that is not granted, paused, or waiting for another comes back `false`. Unchanged columns for the installed member apps. |
| `app.module_states(center)` | For Settings › Modules and Platform › Communities › Modules (`settings.manage`, platform admins): every module with its kind availability and name, whether it is on and switchable, who last switched it and why, and (0740) `granted`, `granted_by`, `granted_at`, `grant_reason`, `paused`, `waiting_for` (the keys of the modules it needs that are off). |
| Niva for admins | `rules.assistant.enabled` is the community's own switch; Niva for admins is on only while the `niva` module is also on (read where it is used: `nivaForAdminsOn`, `src/lib/assistant/settings.ts`), so a revoke or a pause turns it off at once. |
| RLS `module_switch` | One **restrictive** policy per table of a switchable module (generated from `module_tables`): rows of a switched-off center are neither readable nor writable, except for platform admins. It is AND-ed with the existing policies, so it can only take access away. |
| RPC guards | Every security-definer RPC of a module calls `assert_module_enabled` once the center is known (listed per module below). |

## Organization categories (0594)

An organization has a **category** (`app.centers.category_key`, default `jain_center`): Jain Center, Chamber of
commerce, Non-profit (not faith-based) or Faith-based non-profit (other faiths). The category decides which of the
modules the organization can have at all; the organization's own switches (`center_modules`) work inside that set.
Plan: [ORGANIZATION_CATEGORIES_PLAN.md](ORGANIZATION_CATEGORIES_PLAN.md).

| Piece | What it does |
|---|---|
| `app.organization_categories` | The four categories: `key`, `label`, `faith_based`, `uses_tradition` (true only for Jain Center), `path_label` (the sign-up question; null = none), `terms` (nine named words, keys checked by the database), `active`, `sort`. Platform data: written only by migrations, read by everyone (guests included). Only Jain Center is `active`; an inactive category can be chosen only by Community Connect, for a sandbox, to preview it. |
| `app.category_modules` | One row per category and module: `availability` is `default_on` (on unless the organization switches it off: today's rule), `default_off` (off until Weaver enables it, 0740; before 0740 the organization switched it on itself) or `not_available` (never on, not even offered as a switch), with an optional name of the category's own (`label`, `description`). Every category has a row for every module; core modules are always `default_on`; an available module never depends on one that is not (test 79). |
| `app.category_paths` | A person's possible paths inside the category (Jain Center: Shwetambar and Digambar, each with their paths, plus "Another path" and "Not sure"). |
| `app.module_availability(center, key)` | The category's row for a module; no row means `default_on`. Internal. |
| `app.category_profile(center)` | What the apps ask once per community, with or without a session: the category, its terms, the modules' availability, its paths and the community's default path (from `centers.tradition`). "That community was not found." for an unknown or closed one. |
| `app.set_center_category(center, category, reason)` | The only way to change a category: a platform admin, a reason, a fresh 2FA check; audited (the row change and one `category.changed` entry); the owner is emailed. Modules the new category does not have are hidden at once (data kept); changing back restores everything, including the tradition. |
| `app.category_change_preview(center, category)` | What a change will hide and make available, in plain English, with record counts. Changes nothing. |
| `app.set_access_request_category(request, category)` | Community Connect chooses the category on an access request before approving it; the sandbox made from the request takes it. |

**JSH is unchanged by construction.** JSH and every existing community are Jain Centers, and Jain Center has all 18
modules `default_on`: the module functions give it the same results as today's rule (the code differs; the results are the same). Test 79 runs the same reads of a JSH
administrator and a JSH member (every module table's row count, `my_modules`, the access areas) under the new functions
and under 0101's, and compares them. The enforcement is the same three functions as before (`module_enabled`,
`module_off_centers`, `assert_module_enabled`, plus `set_module_enabled`), so every module table's `module_switch` policy,
every module RPC guard, the storage buckets, Setup's "skipped", Niva's live facts and the access areas follow the
category with no per-table change. A direct update of `centers.category_key` is refused (by a trigger) for everyone who
is signed in, platform admins included; jobs and migrations pass. A production organization always has an active
category: a new row, a category change or a flip of `environment` is refused otherwise (jobs and migrations included), and
the promotion job checks it again before it copies. A module or a category added later gets a row in every category at
once (off for every category but Jain Center, except core modules), so nothing is silently on for a chamber of commerce. `centers.tradition` is `other` for a category that does
not use one. Setup: a step of a module the category does not have is skipped with "Not part of a {Category}
organization." The dietary list of a new organization has the "Jain (no root vegetables)" option only for a Jain Center.

A person's own path is `app.person_profile_details.path_key` (the 0546 rules: the person, the adults of their household
and staff with `people.view` read it; the person or a household adult writes it; a child's own login does not; the audit
log records that it changed, not the answer).

Switching off never deletes or changes data. Switching back on restores access exactly as it was.
Access levels (0586, [ACCESS_LEVELS.md](ACCESS_LEVELS.md)) build on this: an area of the member app (live darshan,
virtual puja, listen, look, learn, Ask Niva) is closed to everyone while its module is off, whatever level the community chose.
Background work that runs as `service_role` (webhooks, workers) bypasses RLS as before; the
Giving triggers keep posting a card payment that settles after Giving was switched off.

**Not guarded, on purpose:** RLS helper functions (`has_permission`, `is_member_of`,
`adult_of_household`, `can_see_event_ops`, `in_survey_audience`, …) — a raise inside a policy
would break unrelated reads; trigger functions — their tables are already gated; and the core
platform and People RPCs (`bootstrap_first_admin`, `approve_role_grant`, `next_number`,
`log_audit`, `link_account`, `create_my_household`, `find_my_family`, `directory_listing`,
`people_list`, `person_from_scan`, `resolve_identifier`, `household_card`,
`staff_household_search`, `staff_person_names`, `canonical_org_id`, `canonical_org_member`,
`next_special_day_on`, `address_suggestions`).

## Experiences: the kind of organization is data (0600)

The owner's word for a category is an **experience**: the one choice Community Connect makes when it creates an
organization, after which the modules, the words, the Setup checklist, the demo data and the member app follow. The
tables keep their names (`organization_categories`, `category_modules`, `category_paths`); screens say "kind of
organization". An experience is rows, so adding one later needs no code fork in any app.

| Piece | What it does |
|---|---|
| `app.experience_families` | Tradition families for the two-step picker (Jain, Hindu, Christian, Muslim, Sikh, Buddhist, Jewish, Other faith). A family with no experience is never shown. |
| `organization_categories` (+ columns) | `family_key` (required for a faith-based experience), `inherits_from`, `lineage` (this experience first, then its parents; kept by a trigger), `wording_pack` (which built-in wording pack the apps start from: jain, chamber, neutral or faith), `wording` (extra overlay strings, dictionary key to text), `library_pack` (which shared library the experience gets; Jain Center: `jain`). |
| `app.add_experience(...)` | Migrations only. Adds an experience that starts from one it inherits from: its words, wording pack, overlay and module defaults are the parent's with the overrides given; what it shows (tags), its Setup wording and its dietary extras are read along its lineage. Inactive until a migration switches it on. |
| `app.list_experiences()` | The picker, callable before login: `(key, label, description, family_key, family_label, faith_based, active, sort)`, active experiences only unless the caller is a platform admin. Faith-based experiences come first, by family. |
| `app.member_experience(community, known_stamp)` | The one read for the member app, with or without a session: the experience and its words, every module's availability and whether it is on, the questions the app asks most (`flags`: school, learning, store, labh, bolis, niva, practice), what the administrator set up (home shortcuts, branding, timings, time zone, identifiers), the access areas for the caller, the notification topics and the paths, and a `stamp`. Send the stamp back: when nothing changed the answer is only `{stamp, unchanged: true, updated_at}`. |
| Tags `category_keys` | On `roles`, `notification_topics`, `access_features` and `setup_steps`: empty = every experience, otherwise the experiences named and everything that inherits from them (`app.catalog_shows(keys, category)`). `feature_access_for_me`, `access_settings`, `can_use_feature` and `setup_checklist` leave out what an experience does not show. |
| `app.setup_step_wording` | An experience's own words for a Setup step (the catalog mentions navkarsi, bolis and the religious coordinator). |
| `app.category_dietary_options` | Dietary choices an experience adds to a new organization's list (Jain Center: "Jain (no root vegetables)"; Mosque: halal; Swaminarayan Temple: satvik). |

The experiences: **Jain Center** (active; JSH), **Chamber of commerce**, **Community organization** (`nonprofit_secular`,
the neutral one: any group that is not a house of worship) and **Faith community** (`faith_other`, the generic faith),
all inactive until the member app speaks their words and an owner has checked a preview sandbox by hand; and three inactive
ones that only prove the mechanism, inheriting from Faith community: **Swaminarayan Temple**, **Church** and **Mosque**.
Their words need review by someone from that faith before they are switched on.

**The stamp** is a fingerprint of the `member_experience` answer: an administrator's module switch, a change of the
experience (`set_center_category`), the home shortcuts, branding, access levels and the catalog's words all change it, and
putting everything back gives the first stamp again. JSH reads as a Jain Center with the same answers as before.

## Traceability (every module)

Every app table except `audit_log` has an `audit_<table>` trigger on `app.audit_row()`. Each entry
records who (`actor_user_id`, `actor_role` from the JWT), when, what (`before`/`after`, masked by
`app.audit_mask`), the `module`, and — from the request headers — `correlation_id`
(`x-request-id`), `reason` (`x-audit-reason`, URL-decoded), `client_app` (`x-client-app`:
portal | member | kiosk | job), `client_screen` (`x-client-screen`), `user_agent` and `ip`
(first `x-forwarded-for`). RPCs and jobs set the same context with
`app.set_audit_context(reason, correlation)` or `set_config('app.audit_reason' | 'app.correlation_id' | 'app.client_app', …, true)`.
Rows that carry their own reason (write-off, refund, voting override, boli close, reference
decision, role grant, module switch) supply it when the request did not.

`record_id` is the row's `id`; for tables without one it is the primary key joined by `:`
(e.g. `household_members` → `<household_id>:<person_id>`, `accounts` → `<user_id>`).
`app.record_history(table, record_id)` returns one record's entries newest first with the actor's
name, to `audit.view` holders of that center and platform admins only (the same rows the
`audit_read` policy allows).

---

## People — Members & families (core: always on)

- **Tables:** households, people, household_members, zones, household_change_requests,
  merge_candidates, person_emails, external_ids, special_days
- **RPCs:** people_list, directory_listing, find_my_family, link_account, create_my_household,
  staff_add_person, move_person_household, make_primary_of_own_household, merge_people,
  merge_households, household_card, resolve_identifier, person_from_scan, staff_household_search,
  staff_person_names, address_suggestions (0561: ZIP / city / state shared by at least two
  households, plus the zones' ZIP codes; members only) (not guarded: core)
- **Portal:** /households, /households/[id], /people, /people/[id], /people/directory, /people/merge
- **Member app:** Family tab, person/[id], family-review, special-days, member-card, onboarding
- **Permissions:** people.view, people.manage, people.approve
- **Switching off:** not possible. `merge_people` refuses while **Membership** is off, because the
  duplicate's memberships move with it and would be hidden from the merge. Merges record a default
  reason ("Merged duplicate … into …") unless the request sends one.

## Membership (depends on People)

- **Tables:** membership_types, memberships, membership_applications, eligibility_snapshots
- **RPCs guarded:** decide_reference, change_household_tier, my_reference_requests (filters
  instead of raising, it lists across centers), approve_as_second (for `eligibility_snapshots`)
- **Portal:** /memberships/applications, /people/voting
- **Member app:** guide/membership, reference requests, onboarding membership step
- **Permissions:** people.view, people.manage, people.approve, settings.manage (types)
- **Switching off:** membership rows, applications and voting eligibility are hidden and read-only
  to everyone but platform admins; tier changes, reference decisions and person merges refuse.
  Creating a household (`create_my_household`, `make_primary_of_own_household`) still works;
  the latter adds no community membership while the module is off.

## Events & RSVP (depends on People)

- **Tables:** event_templates, event_template_items, events, actions, rsvps, attendees,
  lunch_slots, scan_log
- **RPCs guarded:** submit_rsvp (also needs **Giving** when the RSVP carries a money commitment),
  cancel_rsvp, check_in, checkin_lookup_phone, create_event_from_template, ensure_lunch_slots,
  assign_lunch_for_rsvp, move_lunch_slot, event_live_stats, event_recent_checkins
- **Portal:** /events, /events/[id], /events/builder, /events/live, /events/feedback
- **Member app:** Events tab, event/[id], event/[id]/confirm, event/[id]/tickets
- **Permissions:** events.view, events.manage, events.confidential; scoped roles event_lead,
  checkin_volunteer, kitchen_lead
- **Switching off:** events, RSVPs, tickets and check-in are hidden and refuse; the kiosk cannot
  check anyone in.

## Pledges & donations — Giving (depends on People)

Giving is **a core plus seven add-ons** (0741-0743, docs/GIVING_REDESIGN.md section 11). The core keeps the key
`giving` (installed member apps know only `giving` and `bolis`). Each add-on needs Giving only, no add-on needs another,
and each is off while Giving is off (0740 evaluates dependencies), so pausing Giving pauses them all and resuming brings
them back as they were. A kind has each add-on as it has Giving (so a new community starts with them on), and Labh as it
has Bolis. Every add-on's function keeps its Giving check and adds its own right after it, so the sentence names the
module that is off. Consumers outside Giving that create pledges or payments (RSVP commitments, membership and Pathshala
fees, store orders, QuickBooks bring-in) write the core only.

- **Tables (core):** funds, campaigns, pledges, payments, payment_allocations, payment_refunds,
  rsvp_credit_releases, receipt_templates, center_payment_plugins (the payment plugins catalog, `payment_plugins`, is
  platform data: readable by every signed-in user, in no module) and the other payment plugin tables
- **RPCs guarded:** record_offline_payment, allocate_payment, preview_allocation,
  every function of the add-ons below (first), approve_as_second (payments,
  pledges), enqueue_payment_posting and recompute_pledge_status (when called directly; not from
  the Giving triggers), payment_plugin_settings, set_payment_plugin and member_payment_methods
  (the payment plugins, 0580-0581; the status and member-answer helpers are not callable over the
  API)
- **Payment plugins (0580-0581):** each way to pay (Card, Apple Pay, Google Pay, ACH bank debit,
  PayPal, Zelle, Check, Cash, ACH and wire, Stock, Donor-advised fund, Matching gift) is a plugin an
  organization turns on or off in Settings › Payments with a reason. A plugin's on/off is derived
  from the existing processor and method rows (nothing moved) and `set_payment_plugin` writes through
  `set_payment_processor` / `set_payment_method`; `center_payment_plugins` stores the derived
  enabled/mode/status (kept in step by triggers, including for a new organization and for the
  `payments.mode` entitlement) plus the organization's own name and order. Card or PayPal cannot be
  switched off while its account is connected; Card off takes Apple Pay, Google Pay and ACH with it.
  Both tables are read-only over the API (staff with payments view access read their own
  organization's rows). `member_payment_methods(center)` is what the member app may offer (adults of
  the community only, one entry per connected processor, a sandbox's Zelle is a rehearsal that never
  carries the real address), served as `GET /api/payments/methods` with the member's own token.
  `member_payment_options` is unchanged for installed apps.
- **Portal:** /giving/pledges, /giving/payments, /giving/opportunities/campaigns (and /giving/campaigns),
  /giving/statements (receipts, their templates and the treasurer's approval; the statements part follows Statements)
- **Member app:** Give tab summary and pledges; online pay (per payment method)
- **Permissions:** giving.view, giving.manage, giving.approve, giving.record_offline
- **Switching off:** Bolis, Accounting and the seven add-ons go off with it and come back as they were (0740). Money data is hidden and frozen for
  everyone but platform admins; recording, matching, labh and recurring set-up refuse. The People
  household card (`household_card`) keeps identifying the household but returns no open-pledge total
  or last-gift date (0110), and the household page drops Record payment and its Pledges/Payments tabs.
  The member app hides "Plan labh". Money rules (allocation, write-off, refunds) are unchanged.
  The payment plugin rows are hidden too, and their functions refuse.

### Bank reconciliation — `giving_bank` (add-on of Giving)

- **Tables:** bank_accounts, bank_statement_imports, bank_transactions, known_originators (a platform-wide row is never
  hidden), payment_reports (members' Zelle reports; 0582)
- **RPCs guarded (0742):** confirm_bank_match, match_deposit, suggest_bank_matches, suggest_deposit_payments,
  attach_bank_line_to_payment, zelle_exact_matches, confirm_exact_zelle_matches, payment_report_queue,
  payment_report_counts, link_payment_report, reject_payment_report, report_payment, withdraw_payment_report,
  set_zelle_reporting, giving_unmatched_bank_lines, giving_zelle_waiting, giving_deposit_context
- **Answers instead of refusing:** my_payment_reports (an empty list), worker_payment_reports_sweep (skips the
  community), possible_duplicate_zelle (still warns about a Zelle payment recorded twice, without member reports, so
  recording a payment works), member_payment_methods (Zelle stays a way to give; "report a Zelle payment" is not offered)
- **Portal:** /giving/payments/bank, /giving/bank; the bank, DAF and deposit parts of Payments; Today's bank lines; the
  Deposits task; the Niva commands giving.bank_lines_unmatched, giving.match_deposit, giving.confirm_exact_zelle_matches,
  giving.zelle_waiting; Setup's bank accounts step; the bank accounts import
- **Member app:** zelle-report (1.18.0)
- **Switching off:** bank lines, deposits and Zelle reports are hidden and frozen; payments stay captured with no deposit
  link. Zelle as a way to pay still needs a bank account chosen here (owner, 2026-10-12: Zelle reporting needs Bank).

### Offering counts — `giving_counts` (add-on of Giving)

The kind names it (category_modules.label): Bhandar counts (Jain Center), Collection counts (Church), Offering counts
(other faiths), Cash counts (a kind that is not faith-based).

- **Tables:** counting_sessions, valuables_register
- **Portal:** the counting part of Payments (and the Offering counts tab of the new Giving, slice 5)
- **Switching off:** counts are hidden and frozen (no new count can be written).

### Opportunities — `giving_opportunities` (add-on of Giving)

- **Tables:** opportunities
- **RPCs guarded (0743):** opportunity_availability; trigger pledges_opportunity_available refuses a person's pledge on
  an opportunity (a webhook or the worker is never refused); create_recurring_gift refuses a link to an opportunity;
  site_draft_data leaves opportunities out of the website draft
- **Portal:** /giving/opportunities (while it is off, its tab opens the Campaigns list, which stays core); the
  opportunities import
- **Member app:** Give tab opportunities, opportunity/[id] (1.18.0)
- **Switching off:** members cannot pledge to an opportunity; existing pledges keep their numbers and amounts.

### Recurring gifts — `giving_recurring` (add-on of Giving)

- **Tables:** recurring_gifts
- **RPCs guarded (0743):** create_recurring_gift, run_recurring_gift_cycle, the repeat-every-year path of commit_labh
  ("Repeating this every year needs Recurring gifts ..."), trigger opportunities_recurring_template (an opportunity
  cannot turn recurring on)
- **Portal:** /giving/recurring; Setup's past recurring gifts step; the recurring gifts import
- **Member app:** recurring, recurring-setup, the "repeat" choices (1.18.0)
- **Switching off:** no new recurring gift and no cycle; the list is hidden.

### Special-day offerings — `labh` (add-on of Giving; "Labh" for a Jain Center)

- **Tables:** labh_options, labh_fulfillments
- **RPCs guarded (0743):** commit_labh; _special_day_labh_sweep (the special-day notice is not sent)
- **Portal:** /giving/labh; the Labh options import
- **Member app:** labh/[dayId], "Plan labh" on special days and Home (1.18.0)
- **Kinds:** as Bolis: a Jain Center has it, every other kind never (`not_available`; "... is not part of a ...
  organization."). The member_experience `labh` flag and the portal's kindHas("labh") read this module.

### Statements — `giving_statements` (add-on of Giving)

- **Tables:** statements, and the `statements` storage bucket (storage_bucket_module)
- **RPCs guarded (0743):** year_end_statement (which also gains the Giving check it never had)
- **Portal:** the year-end and issued statements parts of /giving/statements; the Family page's year-end totals; Setup's
  past statements step. Receipt numbers, receipt templates and their go-live approval stay core.
- **Member app:** tax statements in Pledges, the Settings receipts row (1.18.0)

### Insights — `giving_insights` (add-on of Giving)

- **Tables:** none yet (B98's people-and-relationship slices moved to WeCare, [`WECARE.md`](WECARE.md), 2026-10-13)
- **Portal:** the Insights tab and the household panel under Giving at a glance (when they are built)

## Bolis (depends on Giving)

- **Tables:** bolis, boli_entries
- **RPCs guarded:** place_boli_entry, close_boli (its reason goes on every row it changes),
  boli_summary, boli_minimum
- **Portal:** /bolis, /bolis/upload
- **Member app:** bolis, boli/[id]
- **Permissions:** bolis.view, bolis.record, bolis.manage
- **Switching off:** bolis are hidden; pledging and closing refuse.

## My Store (depends on People)

- **Tables:** store_categories, store_items, pickup_windows, store_orders, store_order_lines,
  inventory_movements
- **RPCs guarded:** none (the store writes through RLS; `apply_inventory_movement` is a trigger)
- **Portal:** /store, /store/menu, /store/orders
- **Member app:** store, cart
- **Permissions:** store.view, store.manage, store.pickup
- **Sections (0821, [`STORE_SECTIONS.md`](STORE_SECTIONS.md)):** the store is organised in sections above its categories. `store_categories`
  and `store_items` carry `section` (`food` or `market`, default `food`); every row that existed is in **Food**, the portal's Menu &
  pickup and Inventory pages show Food as the section, and the Community Market (module `market`, 0830, a Marketplace product off until
  Weaver grants it; below) appears as a second tab only while it is on and holds something. Store › Community Market (`/store/market`)
  is its page. Its rows are these same tables with `section = 'market'`; the plan for what comes next is
  [`STORE_MARKETPLACE.md`](STORE_MARKETPLACE.md).
- **Permissions (0830):** market.view, market.manage, market.moderate (the role `market_lead`); `store.manage` also runs the market's listings.
- **Switching off:** items, orders and inventory are hidden and read-only.

## Pathshala (depends on People)

- **Tables:** pathshala_terms, pathshala_tracks, pathshala_levels, pathshala_classes,
  pathshala_teachers, pathshala_enrollments, pathshala_sessions, pathshala_attendance,
  pathshala_progress_reports, class_announcements, teacher_positions, teacher_applications,
  pathshala_level_fees, pathshala_enrollment_fees (0590), pathshala_registrations,
  pathshala_pending_registrations (0591)
- **RPCs guarded:** pathshala_term_stats, redeem_attendance_qr; registration (0590): save_pathshala_level,
  set_pathshala_level_fees, set_pathshala_term_rules, open_pathshala_registration, pathshala_quote,
  pathshala_fee_example, pathshala_registration_options, preview_pathshala_registration, pathshala_seats,
  pathshala_pay_now_ready; (0591): register_pathshala_children, choose_pathshala_office_payment,
  place_pathshala_enrollment, place_next_from_waitlist, release_pathshala_hold, extend_pathshala_hold,
  pathshala_registration_queue, pathshala_task_counts; pathshala_registration_options is replaced in 0591 (the
  learners' enrollments carry the hold reason, the withdrawal reason and the fee to the family's adults, never to a child).
  Triggers (0591): pathshala_fee_paid (a paid fee pledge places a held seat; never waits, never blocks a payment),
  pathshala_late_payment (money for a released fee pledge becomes a credit row), pathshala_fee_pledge_closed (a cancelled
  fee pledge ends its fee line), pathshala_levels_track_guard, pathshala_enrollments_guard (also refuses moving a learner with a set fee line to another level's class),
  pathshala_classes_level_guard (a class's level cannot change under such learners). The import engine finds an
  enrollment by class or track (0591). Hold and withdrawal reasons live on pathshala_enrollment_fees (P30).
- **Worker:** pathshala.holds_sweep (every 15 minutes: reminders and releases of the seats held for payment, the
  waitlist; `app.worker_pathshala_holds_sweep`)
- **Portal:** /pathshala, /pathshala/classes, /pathshala/classes/[id]/attendance,
  /pathshala/classes/[id]/reports (progress reports), /pathshala/terms, /pathshala/enrollments
  (incl. "Enroll a student"), /pathshala/teachers (positions and applications),
  /pathshala/announcements, /pathshala/my-classes, /pathshala/committee (dashboard)
- **Member app:** pathshala-scan, pathshala-enroll (enrollment request), pathshala-teach (apply to
  teach); Jain Way › Learn shows the class, last class attendance and published progress reports
- **Permissions:** pathshala.view, pathshala.manage, pathshala.teach
- **Switching off:** classes, enrollments and attendance are hidden; QR attendance refuses.

## Gyan Path — learning (no dependency)

- **Tables:** gyan_goals, gyan_levels, gyan_steps (no center_id: gated through their goal),
  gyan_progress, gyan_signoffs, gyan_attempts (practice tries, 0570), gyan_assignments,
  gyan_submissions, gyan_submission_files (homework with parent validation, 0587),
  gyan_homework_reminders (who was reminded before homework was due, once per learner and due date, 0588)
- **RPCs guarded:** record_gyan_attempt (0570); the homework functions (0587, the only way to
  write homework and answers): save_gyan_assignment, set_gyan_assignment_status, my_gyan_homework,
  save_gyan_submission_draft, hand_in_gyan_submission, parent_decide_gyan_submission,
  review_gyan_submission, gyan_homework_queue. Progress and sign-offs are still written through RLS;
  step, level and treasure points are awarded by triggers, homework points by review_gyan_submission
- **Storage:** bucket `recordings` (recite steps, kept 90 days) and bucket `homework` (0587: private,
  25 MB a file, `<center>/<person>/<submission>/<uuid>.<ext>`, written by the learner or a household adult
  while the answer is a draft or sent back, read by the family (the whole folder) and, once the answer is
  with them (submitted, accepted or sent back: never a draft or an answer waiting for a parent), by the
  reviewers, only the files the answer lists; no old Office files (.doc, .xls, .ppt); kept 180 days by default; a community may change either
  number in Settings › Storage). Both follow this module. Virus scanning (0589, switched off until a platform admin
  sets Platform › Setup › Virus scanning of uploads): in enforce mode a homework file or a recording uploaded after
  the switch is opened by the family at once and by the teachers and reviewers only once its check is clean; an
  infected one is refused to everyone, then removed (the part marked removed by the virus check, the recording
  cleared from gyan_progress) and the learner and a child's household adults are told (upload.removed, no file name);
  the parts in app.gyan_submission_json carry scan and scan_held
- **Background jobs:** pathshala.announcement_notify (0781: queued by a trigger the moment a class announcement
  becomes published; the worker pushes the adults of the households with a learner placed or active in the class,
  or in the term for a whole-Pathshala one, in batches through app.worker_pathshala_announcement_notify, each
  person once per announcement; the member app lists them at /pathshala-announcements);
  homework.publish_notify (queued on every publish; the worker tells the learners and
  the parents of children in batches through app.worker_homework_publish_notify, each person once);
  homework.reminders_sweep (every 15 minutes, in batches of 100, 0588: app.worker_homework_reminders_sweep
  reminds the learners who have not handed in, and the parents of children, the hours before the end of the
  due day that the homework sets; nothing for a community with Gyan Path off,
  `rules.notifications.triggers.homework_reminder` false or an unknown time zone; a reminder still waiting is
  cancelled by a hand-in, by archiving, unpublishing or changing the homework, and by switching reminders off)
- **Portal:** /content/gyan-path (goals, levels, steps, and each level's Homework editor, with the
  reminder's hours) and /pathshala/signoffs and /pathshala/homework (the review queue)
- **Member app:** gyan, gyan/[goalId], gyan/[goalId]/level/[levelId], and the homework screens
  (gyan/homework, gyan/homework/[assignmentId], v1.8.0); a reminder's push opens the homework
- **Permissions:** content.manage (curriculum; homework for everyone; reviews content-reviewed
  homework), pathshala.manage (homework for everyone; every review), pathshala.teach (sign-offs;
  teacher-reviewed homework); a class Teacher (class-scoped role) sets homework for their own class
  (up to 100 points) and reviews the homework of the students placed or active in it while the class's
  term is open; nobody reviews the homework of their own household; homework meant for one class is read only by that
  class (its students placed or active while the term is open, and their household adults) and by those who set or
  review it, homework for everyone by every member
- **Switching off:** the center's goals, levels, steps, progress, sign-offs, tries, homework, answers and
  reminders are hidden (tables and the homework bucket), the homework functions refuse and no reminder is sent. Goals shared by every
  center (no center) stay readable.

## My Jain Way (no dependency)

- **Tables:** practices, practice_selections, practice_logs, points_ledger, streaks,
  saathi_settings, anumodana, daily_timings
- **RPCs guarded:** log_practice, unlog_practice, my_practice_standing, saathi_feed, send_anumodana
- **Portal:** /content/practices, /content/today
- **Member app:** Jain Way tab, pachchakhan/[id], guide/timings
- **Permissions:** content.manage (practices, timings); members act for themselves and their children
- **Switching off:** the center's practices, logs, streaks and points are hidden; logging refuses.
  Practices shared by every center (no center) stay readable.

## Content & library (no dependency)

- **Tables:** content_items, photo_albums, photos, guide_sections, role_roster, media_likes and
  media_playlist_items (0560: a member's likes and their one playlist, read by that person only)
- **RPCs guarded:** the media library (0560): media_library, media_item, random_media,
  toggle_media_like, my_playlist, add_to_playlist, remove_from_playlist, reorder_playlist,
  media_like_counts (staff, counts only). Content itself is written through RLS.
- **Portal:** /content/queue, /content/library, /content/media (stavans, videos, podcasts, recipes), /content/photos, /content/guide, /content/today
- **Member app:** guide, guide/[slug], album/[id], My Jain Way › 3L (stavans, videos, podcasts,
  recipes, My playlist)
- **Permissions:** content.view, content.draft, content.manage, content.approve, settings.manage
  (roster); content.view or content.manage for the like and playlist counts
- **Switching off:** refused while Niva is on. Library, guide, roster and photos are hidden; likes
  and playlists are hidden and the media library RPCs refuse.
  `legal_documents` stays readable: it backs the consent flow, which is core platform.

## Calendar (no dependency)

- **Tables:** calendar_layers, calendar_entries, tithi_days
- **RPCs guarded:** none
- **Portal:** /calendar
- **Member app:** the calendar on Home and Jain Way (tithi); tithi dates on special days
- **Permissions:** content.manage
- **Switching off:** calendar layers, entries and tithi days are hidden.

## Communications (depends on People)

- **Tables:** notification_topics (global catalog, nothing to switch), notification_preferences,
  channel_optins, push_devices, message_templates, messages, comms_campaigns, comms_templates (saved templates, 0800), inboxes, threads,
  thread_messages, whatsapp_groups, whatsapp_join_requests, alerts (the WhatsApp Business tables moved to
  CommunityConnect, `channels`, in 0751; WhatsApp group links stay here)
- **RPCs guarded:** segment_recipient_count, approve_as_second (comms_campaigns), copy_campaign_as_draft,
  save_campaign_as_template, create_campaign_from_template, rename_comms_template, delete_comms_template
  (docs/COMMS_HUB_TEMPLATES.md)
- **Portal:** /comms/newsletters, /comms/templates, /comms/campaigns/[id], /comms/inbox, /comms/threads/[id],
  /comms/whatsapp, /comms/alerts
- **Member app:** preferences, guide/whatsapp
- **Permissions:** comms.view, comms.send, comms.approve, comms.inbox
- **Switching off:** campaigns, inbox, WhatsApp and messages are hidden; a member cannot register a
  push device or change notification preferences. Notification workers (service role) are not
  blocked by RLS; they should read `module_enabled` before sending.

## Surveys & data (no dependency)

- **Tables:** surveys, survey_responses, saved_segments
- **RPCs guarded:** none (`in_survey_audience` is an RLS helper)
- **Portal:** /comms/surveys, /comms/surveys/[id], /events/feedback/[surveyId]
- **Member app:** survey/[id]
- **Permissions:** comms.view, comms.send
- **Switching off:** surveys, responses and saved segments are hidden.

## Volunteers (depends on People)

- **Tables:** volunteer_groups, volunteer_shifts, volunteer_assignments, volunteer_interests,
  background_checks
- **RPCs guarded:** none
- **Portal:** /events/volunteers
- **Member app:** volunteer, guide/volunteer
- **Permissions:** volunteers.view, volunteers.manage, safety.view, safety.manage
- **Switching off:** groups, shifts, sign-ups and background checks are hidden.

## Accounting & QuickBooks (depends on Giving)

- **Tables:** qbo_account_mappings, ledger_postings, accounting_periods, payouts, sync_log,
  qbo_customers, qbo_transactions, qbo_customer_matches (donor matching, 0240)
- **RPCs guarded:** the donor-matching RPCs (qbo_suggest_matches, approve_qbo_matches, reject_qbo_match,
  map_qbo_customer, unmap_qbo_customer, create_household_from_qbo, set_qbo_match_settings, qbo_request_pull,
  qbo_request_ai, qbo_retry_bring_in, qbo_match_overview). Otherwise none of its own. Ledger postings are still queued by the Giving flows
  (`confirm_bank_match`, `match_deposit`, the payments trigger), so switching Accounting back on
  loses nothing.
- **Portal:** /accounting/qbo, /accounting/qbo/matching (Donor matching), /accounting/close
- **Member app:** none
- **Permissions:** accounting.manage, accounting.close, giving.view
- **Switching off:** mappings, postings, periods, payouts and the sync log are hidden and
  read-only; month-end close is unavailable.

## Reports & dashboard (no dependency)

- **Tables:** public_kpi_settings
- **RPCs guarded:** public_kpis (also for anonymous visitors), kpi_flows, public_kpi_catalog
- **Portal:** /reports, /reports/community
- **Member app:** Home dashboard cards
- **Permissions:** reports.view, settings.manage (publishing KPIs)
- **Switching off:** center health and the publish list show the switched-off page; the public
  `/c/<slug>` page says the community isn't publishing its dashboard; `public_kpis` refuses.

## Niva assistant (depends on Content and iWeaver)

- **Since 0750:** also depends on `ai` (iWeaver, [`MARKETPLACE_PACKS.md`](MARKETPLACE_PACKS.md)): where iWeaver is off,
  Niva reads off everywhere and installed member apps hide it with no release.

- **Tables:** niva_conversations
- **RPCs guarded:** none
- **Portal:** /content/niva
- **Member app:** niva, guide/ask
- **Permissions:** content.manage
- **Switching off:** conversations are hidden.

## Governance (depends on People)

- **Tables:** resolutions, resolution_votes, resolution_comments, concerns
- **RPCs guarded:** none
- **Portal:** /pathshala/committee/resolutions, /pathshala/committee/concerns (each gated by this
  module; the committee's actions/templates/year sections follow Events)
- **Member app:** none
- **Permissions:** governance.view, governance.manage, governance.vote, pathshala.view/manage (concerns)
- **Switching off:** resolutions, votes, comments and concerns are hidden.

## The Marketplace products (0750 to 0753; off for every kind until Weaver grants them)

Neutral keys, brand labels ([`MARKETPLACE_PACKS.md`](MARKETPLACE_PACKS.md) P6). Every kind starts each `default_off`;
a platform admin grants one with a reason and a fresh 2FA check (0740); the community pauses and resumes it. Communities
that actually used one before 0750 hold it ("Grandfathered (0750)": for iWeaver, a Niva question, Niva for admins on, Niva
switched on by the community, or AI flyer art in the last 90 days; the kind's default is not use, so Niva went off where no
AI was used, each with a `marketplace.niva_off` audit entry). An open sandbox holds iWeaver as a trial (`is_trial`) that
never reaches production. The card copy is `app.marketplace_products` (0752); requests and "tell me when it is ready" are
`app.marketplace_requests` and `app.marketplace_interest`; `app.marketplace_states(center)` is the one read (0753).

| Key | Label | Depends on | Tables | Guards |
|---|---|---|---|---|
| `ai` | iWeaver | nothing | none (Niva's follow through its chain) | Niva's, by dependency; the AI gate (0755) |
| `website` | WeaverSite | People | sites, site_pages, site_blocks | site_draft_save, site_draft_get, site_page_set_status, site_draft_data |
| `channels` | CommunityConnect | Communications | whatsapp_accounts, whatsapp_template_submissions | save_whatsapp_account, submit_whatsapp_template, send_test_message (WhatsApp), worker_message_to_send (a queued WhatsApp message is not sent) |
| `care` | WeCare ("Member care" for a faith kind, "Donor care" otherwise) | People | none yet | none yet (not built) |
| `market` | Community Market (0830; [`STORE_SECTIONS.md`](STORE_SECTIONS.md), [`STORE_MARKETPLACE.md`](STORE_MARKETPLACE.md)) | Store | none of its own: its rows are `store_categories` and `store_items` with `section = 'market'` (0821), tied to the module by the restrictive policy `market_section_switch` | none (no functions yet) |
| `matching` | CatchTheMatch | Giving | person_match_employers (0759), match_program_submissions (0766), person_match_programs (0767); the shared directory match_programs and match_program_names (0765) is core platform (it belongs to no community; its readers need CatchTheMatch on somewhere) | matching_can (0757/0758, no platform-admin branch) in every policy and function: record_match_employer, withdraw_match_employer, submit_match_program, decide_match_submission, match_program_candidates, link_match_program, unlink_match_program, match_employers_queue |

## Core platform (not a module)

centers, roles, role_grants, center_users, accounts, consents, audit_log, legal_documents,
data_requests, import_runs, integration_connections, webhook_events, number_sequences, modules,
center_modules, module_tables, center_owners, staff_invitations, org_agreements, readiness_checks
(o-security, 0150–0156; see ROLES.md for 2FA and step-up). Always on, audited, `module` is NULL on their audit entries.

center_modules, module_tables, and the category catalogs `organization_categories`, `category_modules` and
`category_paths` (0594).

**Setup (onboarding, ONBOARDING_PLAN §4; migrations 0180–0184)** is core too: org_profiles,
org_documents, org_leaders, irs_exempt_orgs, setup_steps, center_setup_steps, readiness_checks.
Portal: /setup (checklist), /setup/organization, /setup/profile, /setup/leaders, /setup/readiness
(settings.manage; the owner also passes in the database) and /platform/verification (platform
admins). RPCs: setup_checklist, setup_staff_options, readiness, submit_org_verification,
decide_org_verification, org_verification_queue, set_center_branding, irs_lookup,
public_org_profile. Steps of a switched-off module show as skipped. Leaders shown publicly are
mirrored into role_roster (content) by a trigger; role_roster.display_name carries their name.
IRS data: `node tools/load-irs-eo.mjs --bmf … --pub78 … [--revocations …]`. Always on, audited, `module` is NULL on their audit entries.

**Demo data (onboarding stream o-demo; migrations 0310–0312)** is core too: demo_packs (the catalog),
center_demo_state (one row per center: pack, status empty/loading/loaded/clearing/failed, progress, last run).
RPCs: activate_demo_pack(center, pack, reason), reset_sandbox(center, pack, confirm, reason),
clear_sandbox(center, confirm, reason) — owner or settings.manage, a reason, the short name typed for
reset/clear and a fresh 2FA check for them; demo_data_counts, demo_center_problem, demo_pack_steps.
Worker jobs demo.load (app.worker_demo_load_next, one step per transaction) and demo.clear
(app.worker_demo_clear, one transaction). **Sandboxes only, enforced in the database:**
app.demo_center_problem refuses production, promoted, live, suspended and exited centers (SQLSTATE
CCDMO, "Demo data is only for sandboxes."), and app.demo_clear_center re-checks it with the center row
locked. Clearing keeps app.demo_keep_tables() (the organization, its owner and staff logins with a role,
grants, agreements, connections and secrets, profile/brand/leaders, module switches, numbering,
templates, legal documents, saved import mappings, the Setup checklist, jobs and the audit log) and
removes every other row of the center, children first in foreign-key order; a new center table is
cleared unless it is added to that list. points_ledger stays append-only except inside that clear.
Portal: /setup/demo (tab shown in sandboxes only) and a card on /setup. The community pack's contents
per module are in demo_packs.contents; DB test 29 checks a load produces exactly those rows.
