# Organization categories (Jain Center first) and personal paths: plan

**Status: ACCEPTED by the owner on 2026-10-06 (all ten questions answered with the recommended answer; access-rule pull requests are approved by the owner one by one before merge). Nothing is built yet. Nothing changes for JSH until a pull request of §5 is merged, and the first ones are built to change nothing for JSH at all.** Owner request (2026-10-06): *"As a platform principal — associate all the Jain-related features to a 'Jain Center' category when we set up the organization. Later on it can be chamber of commerce / non-faith-based non-profits / other faith-based non-profits. So when we select that category type, the whole experience in that sandbox AS WELL AS in the mobile app should be personalized at organization level. Then when a person signs up, that person can choose to have a particular path (Swetambar, Sthanakvasi, Terapanthi, Beespanthi, etc.) and at personal level the experience should be further refined. For example — Labh / Boli / Pathshala etc. may not be applicable to chambers of commerce at all."*

**Update 2026-10-08 (owner direction): categories are now called *experiences* and are data.** The platform is faith- and context-agnostic; Community Connect chooses one thing when it creates a sandbox, the kind of organization, and everything follows. A two-step picker (Faith-based > tradition family > specific, or Chamber of commerce / Community organization) is fed by `app.list_experiences()`. The neutral experience is `nonprofit_secular`, relabelled **Community organization**; `faith_other` is the generic **Faith community**; Swaminarayan Temple, Church and Mosque are seeded inactive. Migration **0600** builds the mechanism (families, `inherits_from`, wording pack and overlay, `app.add_experience`, tags on roles, topics, access areas and Setup steps, Setup wording, dietary extras, `app.member_experience`), 0601 the Labh module and the library pack tags, 0602 the demo packs per experience, 0603 switches the three non-Jain experiences on. See `docs/MODULES.md` "Experiences". Table names are not renamed; everything below still reads "category".

Every claim about today's code names the file it came from, read on main: connect-crm `0c7e185` (migrations through 0587), connect-mobile `f0da311`, connect-admin `260b7f9`. Paths starting `mob/` are in connect-mobile, `adm/` in connect-admin, all others in connect-crm. **Migration 0594 and DB test 79 are reserved for this work.** The numbers around them are reserved by other plans, so any further database pull request here takes the next free number at build time.

**Rules already decided (this plan does not reopen them)**

| Rule | Source |
|---|---|
| The database enforces; permission checks in the apps are a convenience. When the database returns nothing because of permissions, the portal says "You don't have access to this area", not an empty table | `CLAUDE.md`; `ARCHITECTURE.md` "Tenancy and security" |
| Modules: 18 switches, People is core and never off, **no `center_modules` row means on**, dependencies enforced both ways, the switch enforced in the database (restrictive RLS and RPC guards), switching off never deletes data | DECISIONS "Modules and traceability"; `0101`–`0104`; `MODULES.md` |
| JSH's experience must not change, and the shipped member app must keep working: old builds call the same functions with the same arguments and get the same answers | Owner, 2026-10-06 (this request) |
| A household is never picked or confirmed by name alone: show `app.household_card` | `CLAUDE.md`; `ARCHITECTURE.md` "Identifiers" |
| Bolis say "pledge", never "bid". Money is integer cents everywhere | `CLAUDE.md` founder rules; `ARCHITECTURE.md` |
| Errors are shown in plain English next to what the user did, with a retry where one exists; Server Actions return `{ ok, error }` and log the detail with `failure()` | `CLAUDE.md` |
| One shared database, every row tagged with its organization and isolated by RLS. JSH's organization is a sandbox, promoted in place | DECISIONS second batch 2026-09-25; `0503_jsh_sandbox.sql` |
| Community Connect (platform admins) creates sandboxes and approves go-live; the organization owner can do every task inside their organization | DECISIONS batches of 2026-09-25 |
| A person in two communities is two person rows (identity across centers is deferred); the member app holds one community at a time | DECISIONS "Identity across centers"; `0001` (`center_users`); `mob/src/providers/app.tsx` |
| Member profile details (`app.person_profile_details`): read by the person, their household's adults and staff with `people.view`; written by the person or a household adult, never by a child's own login; values masked in the audit log | DECISIONS "Member profile details (0546)" |
| Access levels: each community's own ladder decides who may use an area; an area is closed while its module is off | `ACCESS_LEVELS.md`; `0586` |
| The shared religious library is organized by tradition; communities adopt it | design doc 01 |
| connect-crm is the portal for everything, connect-mobile the member app, connect-admin event day only | DECISIONS "The three apps" (2026-09-24) |
| Ask the owner before merging anything that changes money rules, permissions or RLS, or deletes data. Never edit an applied migration. Every function pins `set search_path = app, public, extensions`. After a migration, regenerate `src/lib/database.types.ts` and copy it to connect-admin and connect-mobile | `CLAUDE.md` |

---

## 1. Summary (for a non-engineer)

1. **A category is the kind of organization a community is.** Community Connect chooses it when it creates the organization's sandbox: **Jain Center**, **Chamber of commerce**, **Non-profit (not faith-based)** or **Faith-based non-profit (other faiths)**. The category decides which modules exist at all, which words the apps use ("Jai Jinendra" or "Welcome"), what the member app's tabs and Home look like, which shared libraries and calendars apply, and what sample data a sandbox gets. Inside its category an organization keeps switching modules on and off exactly as it does today.
2. **A path is a person's own tradition inside their community.** For a Jain Center it is the person's Jain tradition: Shwetambar (Murtipujak, Sthanakvasi or Terapanth), Digambar (Bispanthi, Terapanth or Taranpanth), another path, or "Not sure". It is asked once at sign-up, it is optional, and it can be changed in the profile. It refines that person's own lessons, practices and library (a Sthanakvasi member is not offered the Navang puja, which is a Murtipujak practice). It never changes what the community shares with everyone: the community calendar, its events, its live darshan.
3. **Nothing changes for JSH.** JSH and every existing community become "Jain Center" automatically, and Jain Center keeps every module and every word exactly as today. Tests compare the old and the new answer for every module and every screen layout (§3.10). The one new thing JSH members will see is the optional path question, in the last phase, because the owner asked for it; a member who does not answer sees exactly what they see today.
4. **What a chamber of commerce would see.** In the portal: people, membership, events, dues and payments, communications, surveys, volunteers, governance, accounting and reports; Store and the Niva assistant start off and can be switched on. Bolis, Labh, Pathshala, Gyan Path and My Jain Way do not exist for it, not even as a switch. In the member app: four tabs (Home, Events, Pay, My business), "Welcome" instead of "Jai Jinendra", a Today card with the date (no tithi, no timings, no darshan or puja doors), no Jain library or Jain calendar, no path question, and a sandbox filled with member businesses, mixers, a gala and membership dues instead of a Jain community.
5. **How it is enforced.** The database already has one place that decides whether a module is on for a community: three functions that every module table and every module function call. Teaching those three functions the category makes the database refuse a chamber's bolis everywhere at once, with no change to any table, and leaves Jain Center's answers identical. Words, tabs and Home layout are app choices, not a security matter.
6. **Ten pull requests in three phases** (§5): the foundation (category stored, enforced and chosen at creation; JSH unchanged), the first non-Jain category (wording, layout, demo data, then switched on), then personal paths. Three of them change access rules and need the owner's OK before merge (PRs 1, 4 and 10); the receipt wording in PR 6 is money wording and needs it too; switching a new category on (PR 8) is the owner's call. The others can be built in parallel against the written contract of §3.8. Nineteen decisions (§4) each have a recommended default; ten one-line questions close the document (§7).

---

## 2. Today's map

### 2.1 What exists

| Need | Today | Where |
|---|---|---|
| An organization category | **None.** Three unrelated "type" notions exist and must not be mixed up: `centers.tradition` (a Jain sect pack, not null, default Shvetambar Murtipujak); the applicant's "Kind of organization" on the request form (`org_type`: temple, community center, other non-profit), stored only in `rules.onboarding.org_type` and read by nothing; `org_profiles.entity_type` (the IRS class, for non-profit verification only) | `0001_foundation.sql:16-18,46`; `0200_access_requests.sql:21`; `0502_platform_create_sandbox.sql:236`; `0180_setup_org_profile.sql` |
| Who may change a `centers` column | Platform admins, and **anyone with `settings.manage` in that community, any column**. Only `environment` and `sandbox_for` are protected by a trigger | `0010_rls.sql:93-97`; `0160_environment_entitlements.sql:42-54` |
| Module switches | `app.modules` (18 rows), `app.center_modules` (one row per switch flipped; no row = on), `app.module_tables` (every table mapped to a module; test 13 fails if one is missing) | `0101_modules.sql:12-125` |
| The enforcement spine | `module_enabled`, `module_off_centers`, `assert_module_enabled`. They feed the restrictive `module_switch` policy on every module table, the guard at the top of every module RPC, the Setup checklist's "skipped", the storage buckets, Niva's live facts, the access areas (`can_use_feature`, `feature_access_for_me`) and `my_modules`, which both apps read | `0101:130-162`; `0103_module_rls.sql:22-66`; `0104` and later RPCs; `0302_golive_setup_checklist.sql:289,298`; `0574_niva_live_facts.sql:101,213`; `0586_access_levels.sql:297,332` |
| Readers of `center_modules` outside the spine | Setup's "Choose modules" step (done as soon as any row exists), Settings › Modules, the promotion copy list, the demo keep-list, the 2FA step-up trigger | `0181_setup_checklist.sql:438-441`; `src/app/(app)/settings/modules/page.tsx`; `0203_promotion_expiry.sql:119-126`; `0310`; `0154_step_up_wiring.sql:40-50` |
| Portal module awareness | Nav entries carry a module; `visibleNav` and `canOpenTab` hide off modules; a direct link shows "{module} is switched off"; the session's `modulesOff` comes from `my_modules` | `src/lib/permissions.ts`, `src/components/module-gate.tsx`, `src/lib/session.ts:68,185` |
| Member-app module awareness | Pure maps from modules to tabs, Home cards, drawer entries, Give sections and routes; unknown module keys are ignored. **Until `my_modules` answers, for guests and on any error, every module is on** (`ALL_ON`). A guest gets no rows (the function answers members only), which also reads as "everything on" | `mob/src/lib/modules.ts:63,73,118-157`; `mob/src/lib/api/modules.ts`; `mob/src/providers/modules.tsx` |
| Jain wording in the member app | One English dictionary of 2,633 lines; about 490 mention a Jain term. About 730 keys sit in feature groups that exist only for Jain modules (Gyan Path, homework, Saathi, Bolis, Labh, puja, Pathshala, special days) and disappear with them. **About 110 keys on shared screens** (Home greeting and Today card, the library, the guide, the store, Give, Niva's greeting, the "Jain Way" tab, product copy) need neutral words for other categories. Gujarati and Hindi translate only the five tab labels | `mob/src/i18n/en.ts`, `gu.ts`, `hi.ts` |
| How a string is looked up | `t(key)` is built from the language only. The settings provider that makes `t` sits **above** the provider that knows the community. `useT()` is used in about 130 files and `useSettings().t` directly in about 17 places (the tab bar among them) | `mob/src/i18n/index.ts`; `mob/src/providers/settings.tsx:52,67-70`; `mob/src/app/_layout.tsx:61-77` |
| Jain things that are not modules | Home's **Today card** (greeting "Jai Jinendra", tithi, sunrise, navkarsi, chauvihar, the darshan and puja doors), always shown (`HOME_CARD_MODULE.today = null`). **Labh** lives inside Giving (`labh_options`, `labh_fulfillments`, `commit_labh`). Special-day kinds (punyatithi, diksha, tithi birthdays) and the "Plan special days" sign-up step. The **"Jain (no root vegetables)" dietary option is seeded for every community**. Roles (`religious_coordinator`, `boli_recorder`, `pathshala_*`), notification topics (`pathshala`, `timings`, `jain_way`), access areas (`darshan` "from the derasar", `puja` "the Navang puja lesson", `timings` "navkarsi, chauvihar"). Flyer occasions (Garba, Paryushan, Diwali, Mahavir, Pathshala, Bhakti, Convention, General). Niva's prompt ("the assistant for a Jain community's member app"). Public KPIs (samayik, pratikraman). The Home shortcut "Jain recipe". The receipt sample's "No goods or services were provided other than intangible religious benefits" | `mob/src/features/home.tsx:209-260`; `mob/src/features/today-doors.tsx`; `0101:83`; `0546_member_profile_details.sql:80-104`; `supabase/seed.sql:8-52`; `0586:63-71`; `src/lib/events/flyer-art.ts`; `worker/src/handlers/niva.answer.ts:134,312`; `src/lib/home-shortcuts.ts:13`; `src/lib/giving.ts:459` |
| Shared libraries (`center_id` null) | 10 practices; the Gyan Path goals Samayik, Navkar, Logassa, Pratikraman and Navang puja; 9 pachchakhan items; the calendar layers "Jain tithi" and four Houston school districts. **Every shared practice, goal and pachchakhan item is tagged `shvetambar_murtipujak`, Navkar Mantra included.** The apps load "mine plus shared" and keep a shared row when its tradition is empty or equals the **community's** tradition; Niva's search does the same in the database | `supabase/seed.sql:58-75,108-113,228-237`; `0571_gyan_content_pack.sql`; `mob/src/lib/api/gyan.ts:34,63`, `jainway.ts:36`, `calendar.ts:46`, `home.ts:31`; `0573_niva_search_v2.sql:288-312` |
| A person's tradition or path | **Not stored anywhere.** The closest pattern is `person_profile_details` (one row per person, family-private) with a per-community choice list (`dietary_options`) | `0546_member_profile_details.sql` |
| The Do puja door | Shown when the Navang puja lesson passes the tradition filter (so today it follows the community's tradition) and the community's access level allows | `mob/src/features/puja/puja-logic.ts:15`; `mob/src/features/puja/puja-entry.tsx` |
| Member sign-up steps | `signIn, match, about, address, details, family, planDays, whatsapp, contact`; address, "A little more about you", special days and WhatsApp are for adults only | `mob/src/features/onboarding/steps.ts:7,11` |
| Ways a community is created | (1) public request, Platform › Requests, sandbox code, `/start` (`redeem_sandbox_code`); (2) Platform › New sandbox (`platform_create_sandbox`, 10 arguments); (3) the legacy six-step wizard (Platform › New center; tradition at step 2; creates a production community); (4) promotion: in place for JSH, otherwise a copy whose `insert into app.centers` lists its columns one by one; (5) seed and tests. Both sandbox routes share `_create_sandbox_center` | `0502:25-123,206-257`; `src/app/(app)/platform/new/*`, `src/app/(app)/platform/actions.ts:56-59`; `0203:209-216` (renamed `_worker_promote_sandbox_copy` by `0500_sandbox_real_data.sql:111-115`); `supabase/seed.sql:118-120` |
| Demo data | One pack, "Demo community" ("A small Jain community"). **Only its Giving step stops when a module is off**; the Pathshala, learning and community steps load their rows whatever the switches say (the rows are then hidden) | `0312_demo_pack_community.sql:22-44,482`; `0311_demo_rpcs.sql:145-175` |
| connect-admin (event day) | No module awareness, one community; Pathshala, Bolis and "Satvik Store" shown by permission | `adm/src/lib/nav.ts` |

### 2.2 Findings worth fixing on the way

| # | Finding | Evidence | Handled in |
|---|---|---|---|
| F1 | **Using a person's path in place of the community's tradition in today's filter would empty the library** for most members: everything shared is tagged Murtipujak, even Navkar Mantra | `supabase/seed.sql:58-75,228-237`; `0571` | The design keeps the community filter and adds a separate person-level tag that only narrows what is clearly path-specific (§3.4.6) |
| F2 | **Today's demo pack would load hidden Jain rows into a chamber's sandbox**: most steps ignore the module switches | `0312` (only `:482` checks a module before loading) | One pack per category; loading another category's pack is refused (PR 5) |
| F3 | **A community admin can change any `centers` column through the API**, `tradition` today and a category tomorrow | `0010_rls.sql:94-95`; only the environment is guarded (`0160:42-54`) | A guard trigger: the category changes only through `app.set_center_category` (PR 1) |
| F4 | **Receipt wording is written for a house of worship** ("intangible religious benefits"); a chamber's dues are not a charitable gift | `src/lib/giving.ts:459`; `receipt_templates` | Decision C17 (owner and accountant) before any non-faith organization goes live |
| F5 | Four Houston school-district calendar layers are shared with every community, whatever its city | `supabase/seed.sql:110-113` | Left shared by category in DB 2; a region rule is a backlog item |
| F6 | The legacy wizard creates **production** communities with no sandbox step and pre-selects Sthanakvasi | `src/app/(app)/platform/actions.ts:56-59`; `src/app/(app)/platform/new/wizard-form.tsx:163` | PR 2 adds the category to it; retiring the wizard is suggested |
| F7 | Before a community is chosen, the member app says it "serves many Jain communities" and suggests searching "Jain Society" | `mob/src/i18n/en.ts:2308,2313` | Neutral product copy (PR 7) |
| F8 | The enum value `terapanthi` does not say which Terapanth (Shwetambar or Digambar); the portal lists it with the Shwetambar sects | `0001:16-18`; `src/lib/center-wizard.ts:16-21` | Read as Shwetambar Terapanth when a community default is turned into a path (§3.4.1) |

---

## 3. Design

### 3.1 The category catalog (platform level)

Three platform tables, written only by migrations, readable by everyone (guests included: the member app needs them before sign-in), audited like every table and mapped to the core platform in `app.module_tables`.

- **`app.organization_categories`**: `key`, `label`, `description`, `faith_based`, `uses_tradition` (true only for Jain Center: whether `centers.tradition` and the Jain library apply), `path_label` (the sign-up question; null means the category asks no path), `terms` (the named words of §3.1.3; keys checked by the database), `active` (whether it can be chosen for a new organization), `sort`.
- **`app.category_modules`**: one row per category and module. `availability` is `default_on` (on unless the organization switches it off: today's rule), `default_off` (off until the organization switches it on) or `not_available` (never on, hidden everywhere, not even offered as a switch). Optional `label` and `description`: the category's own name for the module (for example "Religious school" for Pathshala). Every category has a row for every module and core modules are always `default_on` (both checked by test 79); a module that is available never depends on one that is not (checked too).
- **`app.category_paths`**: the person-level paths of a category (§3.4).

#### 3.1.1 The first four categories

| | Jain Center | Chamber of commerce | Non-profit (not faith-based) | Faith-based non-profit (other faiths) |
|---|---|---|---|---|
| Key | `jain_center` | `chamber_of_commerce` | `nonprofit_secular` | `faith_other` |
| For | Jain temples, sanghs and societies (JSH) | Chambers and business associations (usually 501(c)(6)) | Community, cultural and service non-profits | Churches, Hindu temples, gurdwaras, mosques and other faiths |
| At launch | **Active**; JSH and every existing community | Inactive until its member-app wording ships (PR 8) | Inactive until its wording ships | Inactive until its wording ships |
| Modules | §3.1.2: all 18, exactly as today | Never: Bolis, Labh, Pathshala, Gyan Path, My Jain Way | As the chamber | Never: Bolis, Labh, My Jain Way; Pathshala and Gyan Path may be switched on |
| Words | Today's words | §3.1.3 | §3.1.3 | §3.1.3 |
| Member app | Today's layout | Home, Events, Pay, My business | Home, Events, Give, Family | Home, Events, Give, Learn (when learning is on), Family |
| Today card | Greeting, date and tithi, sunrise, navkarsi, chauvihar, darshan and puja doors | Greeting and date | Greeting and date | Greeting and date |
| Personal path | Jain tradition (§3.4) | None (a business's industry belongs on the member business, later: C18) | None | None in v1 (each faith needs its own list) |
| Shared libraries | The Jain pack: lessons, practices, pachchakhan | None | None | None (its own lessons and content) |
| Calendar | "Jain tithi" layer, tithi shown first | Community layers only | Community layers only | Community layers only |
| Niva | As today (module switch) | Off until switched on; prompt for a chamber | Off; prompt for a non-profit | Off; prompt for a faith community |
| Flyer occasions | All eight | General, Convention | General, Convention | General, Convention |
| Roles shown | All | Without religious coordinator, boli recorder and the Pathshala roles | As the chamber | Without boli recorder; Pathshala roles when Religious school is on |
| Notification topics | All | Without Pathshala, temple timings, My Jain Way | As the chamber | Without temple timings, My Jain Way |
| Access areas (0586) | All eight | Guide, listen, look, Niva | As the chamber | Guide, listen, look, learn, Niva |
| Dietary options seeded | Today's list, Jain included | Without "Jain (no root vegetables)" | Without it | Without it |
| Demo data | "Demo community" (today's pack) | "Demo chamber" (PR 5) | A general non-profit pack (later) | The general non-profit pack until a faith pack exists |
| Setup checklist | Today's, with the tradition pack | Without the steps of modules it does not have | Same | Same |

#### 3.1.2 Modules per category: the allowed set and the default set

"On" = `default_on` (switchable off, today's rule). "Off" = `default_off` (switchable on). "Never" = `not_available`.

| Module | Jain Center | Chamber of commerce | Non-profit | Faith-based (other) |
|---|---|---|---|---|
| People (core) | On | On | On | On |
| Membership | On | On | On | On |
| Events & RSVP | On | On | On | On |
| Pledges & donations | On | On, named "Dues & payments" | On | On |
| Labh (new in DB 2, split out of Giving) | On | Never | Never | Never |
| Bolis | On | Never | Never | Never |
| Satvik Store | On | Off, named "Store" | Off, "Store" | Off, "Store" |
| Pathshala | On | Never | Never | Off, named "Religious school" |
| Gyan Path | On | Never | Never | Off, named "Learning path" |
| My Jain Way | On | Never | Never | Never |
| Content & library | On | On | On | On |
| Calendar | On | On | On | On |
| Communications | On | On | On | On |
| Surveys & data | On | On | On | On |
| Volunteers | On | On | On | On |
| Accounting & QuickBooks | On | On | On | On |
| Reports & dashboard | On | On | On | On |
| Niva assistant | On | Off | Off | Off |
| Governance | On | On | On | On |

Jain Center "On" everywhere is, by construction, today's "no row means on". An organization's own switches (`center_modules`) keep working inside the allowed set.

#### 3.1.3 Words

**Named terms** live in `organization_categories.terms`, for the portal, the worker (Niva, message templates) and, later, per-organization overrides (C16):

| Term | Jain Center (today) | Chamber of commerce | Non-profit | Faith-based (other) |
|---|---|---|---|---|
| `greeting` | Jai Jinendra | Welcome | Welcome | Welcome |
| `practice_tab` | Jain Way | (no tab) | (no tab) | Learn |
| `give_tab` | Give | Pay | Give | Give |
| `family_tab` | Family | My business | Family | Family |
| `store` | Satvik Store | Store | Store | Store |
| `school` | Pathshala | (none) | (none) | Religious school |
| `learning` | Gyan Path | (none) | (none) | Learning path |
| `place` | derasar | office | office | place of worship |
| `assistant_context` | a Jain community | a chamber of commerce | a non-profit organization | a faith community |

**Member app.** The English dictionary stays the Jain Center wording, so JSH reads exactly what it reads today. Every other category gets one overlay file in the app (`mob/src/i18n/categories/<key>.ts`, typed `Partial<Record<StringKey, string>>`) holding only the shared-screen keys, about 110. Jain-only features need no overlay: their modules are "Never", so their screens never open. The overlay is applied by a provider placed under the provider that knows the community, which re-provides the settings context with a `t` that looks in the overlay first; every `useT()` and `useSettings().t` caller gets it without any call-site change, and Jain Center's overlay is empty. A category the installed app does not know (a newer database) gets the neutral "generic" overlay and layout, never the Jain one. Gujarati and Hindi fall back to English as today; the tab labels get reviewed translations per category. The member app's visible text is already in the dictionary; the Jain words left in its code are comments and error-context phrases on Jain-only screens ("load this boli", "save your labh"), which other categories never open.

**Portal.** Modules that are "Never" disappear with their nav; module names come from `category_modules.label` (falling back to `app.modules.label`); the few Jain words on screens every category keeps (the Labh tab, tithi, Today & darshan, some Settings › Rules sections) are hidden by category in PR 6.

**Worker.** Niva's prompt sentence uses `assistant_context`; message templates seeded for a new organization use its category's words.

#### 3.1.4 Member-app layout per category

The layout is code in the member app (`mob/src/lib/categories.ts`, pure and unit-tested like `modules.ts`), keyed by category and shipped over the air. The database supplies the category, its terms, module availability and paths.

| | Jain Center | Chamber of commerce | Non-profit | Faith-based (other) |
|---|---|---|---|---|
| Tabs | Home, Events, Give, Jain Way, Family (today) | Home, Events, Pay, My business | Home, Events, Give, Family | Home, Events, Give, Learn, Family; Learn only when Learning path, Religious school or the library is on |
| Today card | Today's | Greeting and date | Greeting and date | Greeting and date |
| Home rows | Today's six | Today, Events, Give, Life | Today, Events, Give, Life | Today, special days (birthdays and anniversaries, no labh), Events, Give, Life, Learn & listen |
| Home shortcuts by default | Today's six | Event photos, the guide | Event photos, the guide | Learn, event photos, podcast, the guide |
| Sign-up steps | Today's (plus the path question in phase 3) | Without "Plan special days" | Without "Plan special days" | Today's, special days without labh |
| Interests | Today's (events, Pathshala, volunteering, youth, seniors, giving) | Events, networking, volunteering, committees | Events, volunteering, youth, seniors, giving | Events, religious school, volunteering, youth, seniors, giving |
| Calendar | Tithi first | No tithi | No tithi | No tithi |

The fourth tab keeps its route name `jain-way`, so links, notifications and bookmarks keep working; only its label and whether it shows depend on the category.

### 3.2 The organization's category: storing, choosing, changing

- **Stored** in a new column, `app.centers.category_key text not null default 'jain_center' references app.organization_categories(key)`. The default fills JSH and every existing community in the migration itself; no other row changes. Not in `centers.rules`, which a community admin can replace wholesale (`src/app/(app)/settings/rules/actions.ts`).
- **Chosen at creation:**
  - **Platform › New sandbox**: a required Category select (nothing pre-selected). `platform_create_sandbox` gains a last argument `p_category_key text default 'jain_center'`; the old 10-argument function is dropped in the same migration, so the API sees one function, and the default keeps today's portal button working until PR 2 ships.
  - **Platform › Requests**: Community Connect chooses the category on the request before approving it (new `access_requests.category_key`, set by `app.set_access_request_category`). The applicant's "Kind of organization" stays a hint (C6). `_create_sandbox_center` (same signature) reads the category from the request when the code is redeemed, so `redeem_sandbox_code` does not change. A request approved before this change creates a Jain Center, as today.
  - **Legacy wizard**: step 2 becomes "Category", with the tradition asked only for a Jain Center (F6).
  - **Promotion**: in place keeps the row (JSH). The copy route gets the sandbox's category: the dispatcher `worker_promote_sandbox` (0500) sets it on the new production row right after the copy (tested), so a promoted chamber never comes back as a Jain Center.
  - **Inactive categories** can be chosen only by Community Connect and only for a sandbox: a preview to check the wording before the category is switched on. `promote_sandbox` refuses to promote a sandbox whose category is not active yet.
- **Changed** only through `app.set_center_category(center, category, reason)`: a platform admin, a fresh 2FA check (`assert_step_up('platform.category')`), a reason, audited (the row change plus one `category.changed` entry with before, after and what was hidden), and the owner is emailed. `app.category_change_preview(center, category)` first says in plain English what will be hidden and what becomes available ("Bolis: 3 bolis and 120 pledges will be hidden, not deleted"). A guard trigger refuses every other change of `category_key`, a platform admin's direct table update included, so the reason and the 2FA check cannot be skipped; background jobs and migrations pass, as with the environment guard.
- **What a change does:** modules the new category does not have are off at once (data kept, hidden by the same rules as a switched-off module, back as it was if the category changes back); modules it adds follow its defaults unless the organization had its own switch; shared libraries, words and layout follow on the next app refresh; people's paths from the old category stay stored but are ignored. Nothing is deleted.
- **`centers.tradition`** stays the Jain Center's default tradition (§3.4.5). For a category that does not use it, a trigger sets it to `other` (the enum value that exists and is never offered), so even an old app build's tradition filter hides the shared Jain library.

### 3.3 The module functions become category-aware (database enforcement)

A module's availability for a community is its category's row for that module; a missing row means `default_on`, which keeps the 0101 contract ("no row means on").

```sql
-- app.module_enabled(p_center, p_module) after 0594 (sketch)
select case app.module_availability(p_center, p_module)        -- the category's row; none = 'default_on'
         when 'not_available' then false
         when 'default_off'   then exists (select 1 from app.center_modules
                                            where center_id = p_center and module_key = p_module and enabled)
         else not exists (select 1 from app.center_modules      -- today's rule, word for word
                           where center_id = p_center and module_key = p_module and not enabled)
       end
-- A null center (a shared row) is never off, as today.
```

| Function | Today (0101) | After (0594) |
|---|---|---|
| `module_enabled(center, module)` | No "off" row | The sketch above. For Jain Center it reduces to today's rule |
| `module_off_centers(module)` | Communities with an "off" row | The same, plus communities whose category marks the module `not_available`, plus `default_off` communities with no "on" row. One set query, still evaluated once per query (the policies call it as an InitPlan) |
| `assert_module_enabled` | "The X module is switched off for this community." Hint: "An administrator can switch it on in Settings › Modules." | Unchanged for a switch. For `not_available`: "X is not part of a Chamber of commerce organization." Hint: "Community Connect can change an organization's category." Platform admins pass, as today |
| `set_module_enabled` | Refuses switching off a core module and breaking a dependency | Also refuses switching on a `not_available` module, in plain English; switching a `default_off` module on writes an "on" row (today's upsert) |
| `my_modules(center)` | `(key, label, enabled, core)` | Same signature, same rows; a `not_available` module comes back `enabled = false`, so installed apps already hide it |

Everything that already calls these follows with no per-table change: every module table's `module_switch` policy, every module RPC guard, the storage buckets, Setup's "skipped", Niva's live facts, the access areas and the Gyan Path helper policies. Three readers change in the same migration: Setup's "Choose modules" detail (through the thin `setup_auto_status` wrapper of 0302: "The Chamber of commerce set of modules" instead of "Every module is on (the default)"), `setup_checklist`'s skipped text ("Not part of a Chamber of commerce" instead of "switched off"), and a new `app.module_states(center)` for Settings › Modules, because that page reads `center_modules` directly today.

### 3.4 Personal path

#### 3.4.1 The Jain Center path list

`app.category_paths` rows for `jain_center`, two levels: a branch, then a path. A person may stop at the branch.

| Key | Label (spelling: C7) | Branch | Also found by search as | Today's `tradition` |
|---|---|---|---|---|
| `shwetambar` | Shwetambar (not sure which) | | Swetambar, Shvetambar, Svetambara | |
| `shwetambar_murtipujak` | Murtipujak (Derawasi) | Shwetambar | Deravasi, Mandirmargi | `shvetambar_murtipujak` |
| `shwetambar_sthanakvasi` | Sthanakvasi | Shwetambar | Sthanakwasi | `sthanakvasi` |
| `shwetambar_terapanth` | Terapanth | Shwetambar | Terapanthi | `terapanthi` (F8) |
| `digambar` | Digambar (not sure which) | | Digamber | `digambar` |
| `digambar_bispanthi` | Bispanthi | Digambar | Beespanthi, Bisapanthi | `digambar` |
| `digambar_terapanth` | Terapanth | Digambar | Terapanthi | `digambar` |
| `digambar_taranpanth` | Taranpanth | Digambar | Taran Panth | `digambar` |
| `other` | Another path | | | |
| `not_sure` | Not sure, or more than one | | | |

Skipping the question stores nothing. The list and its wording are confirmed by the Pathshala and the religious coordinator before PR 9 ships; adding a path later is one migration row. The `tradition` column maps a community's default tradition to a path (a branch row first: `digambar` becomes the Digambar branch, `terapanthi` becomes Shwetambar Terapanth).

**Other categories:** none in v1. For a chamber, the sensible equivalent (the business's industry) describes the member business, not the person, and comes with business profiles (C18). For other faiths, each faith needs its own list (denomination, sampradaya); it arrives with a category for that faith.

#### 3.4.2 Where it is stored and who sees it

`app.person_profile_details.path_key text null`: per person, per community (a person row belongs to one community, so someone in two communities has two answers). It inherits the 0546 rules: read by the person, the adults of their household and staff with `people.view` or `people.manage`; written by the person or a household adult; a child's own login reads it but cannot change it (a parent sets it); no staff write. The existing check trigger validates it (an active path of the community's category, in plain English); a key from an earlier category stays stored and is ignored. `app.audit_mask` masks it (a religious affiliation is sensitive, like dietary needs), so the audit log records that it changed, not the answer. Never in the directory, never shown to teachers or other members.

Not on `people`: the member app loads the whole `people` row of its member, and people rows are read by household members, class rosters and Pathshala staff through several policies (`0010_rls.sql:111-124`), so the answer would reach them.

#### 3.4.3 When it is asked

- At sign-up, in **"About you"**, for adults only: one optional question, "Which Jain tradition do you follow?", with branch chips (Shwetambar, Digambar, Another path, Not sure), then the paths of the chosen branch with "Not sure which", and **Skip**. When the household has children with no answer, "Use the same for my children" is shown ticked; it writes each child's row (only a household adult may).
- Children do not see the question; a parent's choice applies when the parent ticks it, and a parent can change a child's answer from the Family tab.
- Changeable any time in Profile › More about you. Never required; never asked again once answered or skipped.
- Only when the community's category has a path list (`path_label` not null).

#### 3.4.4 How it refines the experience

The rule: **a person's path changes only that person's own content; it never changes what the community shares with everyone.** The effective path is the person's own answer, else the community's default (from `centers.tradition`). "Not sure", "Another path" and a branch answer show more, never less.

| Area | What the path changes | What it never changes |
|---|---|---|
| Gyan Path lessons | Shared lessons tagged for some paths are offered only to those paths (Learn Navang puja: Murtipujak) | A lesson the person has started stays, with its progress and points; the community's own lessons |
| My Jain Way practices | The practice catalog by path (Ashtaprakari puja for Murtipujak; Darshan at derasar for paths that worship in a temple) | Practices already chosen, their logs, streaks and points |
| Pachchakhan and fasting rules | Items tagged by path (once the Pathshala tags them) | The community's daily timings |
| Stavans, podcasts, videos, recipes | Items tagged for the person's path come first; nothing is hidden | The community's library |
| **Do puja door** (Home) | Shown for Murtipujak, for a "Shwetambar (not sure which)", "Not sure" or "Another path" answer, and for no answer while the community default is Murtipujak; hidden for Sthanakvasi, Shwetambar Terapanth and Taranpanth (no idol puja) and for the Digambar paths until a Digambar puja lesson exists (Navang puja is a Shwetambar Murtipujak practice). This needs no special code: the door looks for the Navang puja lesson, which is tagged Murtipujak | The **Watch live darshan** door: the community's own stream, shown to everyone the access level allows |
| Calendar | Later: a path-tagged layer (for example Das Lakshan Parva for Digambar members, Paryushan for Shwetambar) starts switched on for that path, and stays switchable | The community calendar and its events, for everyone |
| Tithi | Nothing in v1 (the Today card shows the community's panchang) | The community's tithi |
| Niva | Later: the path is passed as context ("this member follows the Sthanakvasi tradition; say so when practice differs") | The community's own sources |
| Notifications | Later: a path-specific reminder may target a path (staff only, C9) | Community announcements |
| Access levels (0586), money, points rules | Nothing | Unchanged |

#### 3.4.5 The community default and `centers.tradition`

`centers.tradition` stays what it is: a Jain Center's default tradition. It answers for members who have not chosen and for everything community-wide; a person's path refines only their personal content. Old app builds keep filtering by it, unchanged. JSH stays Shvetambar Murtipujak (C14).

#### 3.4.6 The filter, and the first tags on the shared library (for the Pathshala's review)

DB 2 adds `path_keys text[]` (empty = every path of the category) to the shared and community content tables. The apps then offer a shared row in two steps:

```
(1) community level, as today:  the row's category is empty or the community's,
                                and its tradition is empty or the community's tradition
(2) person level, new:          the row's path_keys is empty,
                                or contains the person's effective path,
                                or contains the branch of that path (a row tagged "Shwetambar" is for every Shwetambar path),
                                or contains a path of the branch the person answered (an answer of "Digambar" alone),
                                or the person answered "Not sure" or "Another path"
A community's own rows skip (1) and are narrowed by (2) only when the community tagged them.
```

Step (1) is today's rule, so nobody loses anything a path does not explicitly exclude (F1). The first tags are deliberately small: they only take idol puja away from paths that do not practise it. Everything else stays for every path until the Pathshala and the religious coordinator decide (C13):

| Shared item (all tagged Murtipujak today) | First tag (`path_keys`) | For the Pathshala to decide |
|---|---|---|
| Goal "Learn Puja: Navang puja of Mahavir Swami" | Murtipujak | A Digambar puja lesson of its own |
| Practice "Ashtaprakari puja" | Murtipujak | |
| Practice "Darshan at derasar" | Murtipujak, Bispanthi, Digambar Terapanth | The word "derasar" for Digambar members |
| Goals Samayik, Navkar, Logassa, Pratikraman | Every path (as today) | Whether any of them is offered only to Shwetambar paths, and the Navkar lesson's Chulika |
| Practices Navkar on waking, Navkarsi, Samayik, Swadhyay, Chauvihar, Pratikraman, Navkarvali, Gyan Path lesson | Every path | Which are Shwetambar-only terms |
| Pachchakhan items (Navkarsi, Porsi, Sadh-porsi, Purimaddh, Ekasana, Biyasana, Ayambil, Upvas, Chauvihar) | Every path | Which are Shwetambar terms with a different Digambar practice |

A test proves that, with no answer, every JSH member sees exactly the shared items they see today.

### 3.5 Portal (connect-crm)

- **Platform:** Category on New sandbox (required), on Requests (before Approve), as a column in the Centers list ("Tradition pack" only for Jain Centers), and a Category card on `/platform/centers/[id]` (the current category; **Change…** with the preview, a reason and a fresh 2FA check). The legacy wizard's step 2.
- **Nav and direct links:** modules a category does not have disappear from the nav through `my_modules`, with no new code path. A direct link says "{Module} is not part of a {category} organization" (the gate reads the availability from the session).
- **Settings › Modules:** available modules as today. The others are listed at the bottom, greyed, "Not part of a Chamber of commerce. Community Connect can change the category", with no switch.
- **Setup:** steps of modules the category does not have show as skipped with that sentence; the tradition step only for Jain Centers.
- **Category-specific screens (PR 6):** Giving's Labh tab (by the new Labh module), Calendar's tithi, Content kinds (pachchakhan, stavan, live darshan) and Content › Today & darshan, Settings › Rules sections (temple timings, boli, Gyan Path points), Settings › Roles and Notifications (catalog tags), Settings › Access levels (the areas of the category), Settings › Member app › Home shortcuts, Reports KPIs (samayik, pratikraman), flyer occasions, the receipt sample (C17), Niva's prompt (worker). Every new action returns `{ ok, error }` with plain-English errors.

### 3.6 Member app (connect-mobile)

- `loadCenter` also selects `category_key`. If the database does not know the column yet (error 42703) it reads the old column list and treats the community as a Jain Center, so the app update never depends on the order of deploys.
- One call, `app.category_profile(center)` (callable without a session), returns the category, its terms, module availability, its paths and the community's default path. It is cached on the device per community (keyed by the community, unlike today's other device preferences), so the next cold start shows the right tabs before the network answers.
- **The module map before `my_modules` answers, for guests and on errors** is the category's defaults ("Never" and "Off" modules off) instead of "everything on". For Jain Center that is everything on, exactly as today; for a chamber it removes the flash of Jain tabs.
- Words, tabs, Home, the Today card, sign-up steps, interests and shortcuts follow §3.1.3 and §3.1.4.
- **Old builds** keep working: they see a "Never" module as switched off (through `my_modules`), and the tradition `other` hides the shared Jain library; they show Jain words on shared screens until they update over the air on their next launch. That is why a non-Jain category is switched on only after the app version that speaks its words is live (PR 8).

### 3.7 Sandbox personalization

- A new sandbox starts with its category's modules, words and layout; no Jain dietary option unless it is a Jain Center; no shared Jain library or Jain calendar; the Setup checklist without the steps of modules it does not have.
- **Demo data per category** (F2): `demo_packs.category_key`; Setup › Demo lists the packs of the community's category; `activate_demo_pack` and `reset_sandbox` refuse another category's pack.
- **"Demo chamber"** (PR 5): about 30 member businesses (each a household with one to four contacts, shown with its household card); membership types Individual, Small business, Corporate and Non-profit, with a year of dues as pledges and payments in integer cents; events (a monthly mixer, ribbon cuttings, an annual gala with tickets and check-ins); sponsorship opportunities; committees as volunteer groups; board resolutions; a newsletter and a member survey; a short guide. No bolis, labh, Pathshala, lessons, practices, tithi or Jain content. Deterministic and checked row by row by the demo test, like today's pack.
- A general non-profit pack (events, donations and campaigns, volunteers, a newsletter) follows; other faiths use it until a faith pack exists.

### 3.8 The contract (what the portal and the app are built against)

```
-- PR 1, migration 0594
app.organization_categories (key pk, label, description, faith_based bool, uses_tradition bool,
                             path_label text null, terms jsonb, active bool, sort int)        -- read: anon, authenticated
app.category_modules        (category_key, module_key, availability text in ('default_on','default_off','not_available'),
                             label text null, description text null)                          -- read: anon, authenticated
app.category_paths          (category_key, key, label, parent_key null, tradition app.tradition null,
                             aliases text[], sort int, active bool)                            -- read: anon, authenticated
app.centers.category_key            text not null default 'jain_center'  -- read like every centers column
app.access_requests.category_key    text null                            -- platform admins
app.person_profile_details.path_key text null                            -- the 0546 policies

app.category_profile(p_center uuid) returns jsonb                       -- anon and authenticated
  { "category": { "key", "label", "faith_based", "uses_tradition", "path_label", "terms": {…} },
    "modules":  { "<module_key>": { "availability": "default_on" | "default_off" | "not_available", "label": null | "…" } },
    "paths":    [ { "key", "label", "parent", "sort" } ],               -- [] when the category asks no path
    "default_path": "shwetambar_murtipujak" | null }
  -- raises "That community was not found." for an unknown community or one not open to the caller (the 0586 rule)
app.module_states(p_center uuid) returns table (key, label, description, core, depends_on, sort, availability,
                                               enabled, switchable, changed_by, changed_at, reason)  -- settings.manage, platform
app.set_center_category(p_center uuid, p_category text, p_reason text) returns jsonb  -- platform admin, 2FA, reason
app.category_change_preview(p_center uuid, p_category text) returns jsonb              -- platform admin
app.set_access_request_category(p_request uuid, p_category text) returns void          -- platform admin
app.platform_create_sandbox(<today's 10 arguments>, p_category_key text default 'jain_center') returns jsonb
my_modules, module_enabled, module_off_centers, assert_module_enabled, set_module_enabled: same signatures

-- PR 4, DB 2 (next free number at build time)
module 'labh' (depends on giving): labh_options, labh_fulfillments, commit_labh
category_key text null    on shared rows of content_items, gyan_goals, practices, calendar_layers, tithi_days
path_keys text[] '{}'     on content_items, gyan_goals, practices, calendar_layers, calendar_entries
category_keys text[] null on roles, notification_topics, access_features, setup_steps; demo_packs.category_key
```

### 3.9 Data changes

| Object | Change | Why | PR |
|---|---|---|---|
| `app.organization_categories` (new) | The four rows of §3.1.1; only `jain_center` active; `terms` keys checked by the database | The catalog | 1 (0594) |
| `app.category_modules` (new) | 4 × 18 rows of §3.1.2; core always `default_on`; dependencies consistent | The allowed and default sets | 1 |
| `app.category_paths` (new) | The Jain Center rows of §3.4.1 | Personal paths | 1 |
| `app.centers.category_key` | `not null default 'jain_center'`, foreign key; guard trigger (only through `set_center_category`; jobs and migrations pass); insert rule (an active category, or a platform admin's sandbox); `tradition` set to `other` for a category that does not use it | The organization's category | 1 |
| `app.access_requests.category_key` | Nullable, foreign key, set by a platform admin | Chosen at approval | 1 |
| `app.person_profile_details.path_key` | Nullable; validated by `person_profile_details_check`; masked by `app.audit_mask` (the latest version, 0587, plus this field) | Personal path | 1 |
| Module functions | `module_enabled`, `module_off_centers`, `assert_module_enabled`, `set_module_enabled` replaced with the same signatures; `my_modules` follows | Database enforcement | 1 |
| New functions | `center_category`, `module_availability` (internal), `category_profile`, `module_states`, `set_center_category`, `category_change_preview`, `set_access_request_category` | Apps, portal, platform | 1 |
| Creation and promotion | `platform_create_sandbox` with `p_category_key` (old signature dropped); `_create_sandbox_center` reads the category (same signature); `worker_promote_sandbox` carries it on the copy route; `promote_sandbox` refuses an inactive category | The category from birth to production | 1 |
| Setup | `setup_checklist` skipped text; the `setup_auto_status` wrapper's "Choose modules" detail | An honest checklist | 1 |
| Dietary seed | `seed_default_dietary_options` adds "Jain (no root vegetables)" only for a Jain Center | | 1 |
| `app.module_tables` | The three catalogs as core | Test 13 | 1 |
| Labh module | New module "Labh" (depends on Pledges & donations); `labh_options` and `labh_fulfillments` move to it (their `module_switch` policy re-created); `commit_labh` checks both modules; category rows (Jain Center on, the others never). JSH: on, no row written. Switching Giving off now asks to switch Labh off first (the existing dependency rule) | Labh off for a chamber; JSH can switch Labh alone | 4 (DB 2) |
| Shared rows by category | `category_key` (empty = every category) on `content_items`, `gyan_goals`, `practices`, `calendar_layers`, `tithi_days`; shared Jain rows set to `jain_center`; the school-district layers stay shared (F5) | Shared libraries per category | 4 |
| Path tags | `path_keys text[] not null default '{}'` on `content_items`, `gyan_goals`, `practices`, `calendar_layers`, `calendar_entries`; the first tags of §3.4.6 | Personal refinement | 4 |
| Catalog tags | `category_keys text[]` (empty = every category) on `roles`, `notification_topics`, `access_features`, `setup_steps`; `demo_packs.category_key` | What each category is offered | 4 |
| Niva search | The two search functions (0573, 0575) add the category next to the tradition condition | Niva never offers Jain shared sources to a chamber | 4 |
| Demo packs | `demo_chamber` and its steps; another category's pack refused | Sandbox personalization | 5 (DB 3) |
| Activation | `organization_categories.active = true` for `chamber_of_commerce`, later the others | Only once the app speaks its words | 8 |

Every new table gets an `audit_<table>` trigger, a row in `app.module_tables`, explicit grants (guests need `select` on the three catalogs) and RLS; every function pins `set search_path = app, public, extensions`.

### 3.10 JSH: migrated with zero visible change

1. **Backfill by default.** The column default makes JSH and every existing community `jain_center` in the same statement that adds the column. No `center_modules` row is written, no data row changes.
2. **Jain Center is today, by construction.** All 18 modules `default_on`, whose branch of the function is today's rule word for word; terms equal today's words; the app overlay is empty; the app layout for Jain Center is today's constants (tabs, Home rows, Home cards, sign-up steps).
3. **Same calls, same answers.** `my_modules`, `module_enabled` and `assert_module_enabled` keep their signatures. Old app builds do not ask for `category_key` and never see it.
4. **Proven by tests** (§6): for every existing community and every module, the new `module_enabled` equals the 0101 rule; `my_modules(jsh)` returns the same 18 rows (19 after PR 4, Labh on); a JSH member reads the same number of rows from every module table; the member app's Jain Center layout and words equal today's; with no path answer the shared items a JSH member sees are unchanged after the tags.
5. **Production checks before PR 1 is deployed** (read-only queries Community Connect runs): JSH's `center_modules` rows are as expected; every existing community and sandbox is listed with its tradition, and each is a Jain community (any that is not gets its category through `set_center_category` before a non-Jain category is switched on).
6. **Unchanged on purpose:** the dietary list of existing communities, JSH's tradition, its access levels, its demo state, connect-admin.

### 3.11 What the database enforces and what only the apps do

| The database enforces | Only the apps do (convenience, not security) |
|---|---|
| Who may set or change a category (guard trigger, platform admin, reason, fresh 2FA), audited | Words: overlays, named terms, module names on screen |
| Which modules a category can have: every module table's RLS, every module RPC, storage buckets, Setup, Niva's live facts, the access areas, all through the three functions | Tabs, their names and order, Home rows and the Today card, shortcuts by default, interests |
| A switch can never turn on a module the category does not have | Sign-up steps per category, and asking the path |
| The path's privacy (0546 policies), its validity (check trigger), masking in the audit log | Filtering shared lessons, practices and pachchakhan by category and by path (shared rows are public today; this is a preference) |
| Labh as a module (after PR 4): its tables and `commit_labh` | Roles, topics, access areas and flyer occasions shown per category |
| Demo packs per category (sandboxes only, as decided) | The Do puja door by path |
| Niva's shared sources by category (after PR 4) | The fourth tab's label, or hiding it |
| Tradition `other` for categories without the Jain library | |

### 3.12 Risks

| Risk | Effect | Mitigation |
|---|---|---|
| The spine change touches the policy of every module table | A mistake would change what JSH can read | Jain Center is all `default_on`; the equivalence test over every module and community; the owner's sign-off on PR 1 |
| Performance of `module_off_centers` | The list now includes every community whose category lacks the module | Still one query per statement; tens or hundreds of communities are trivial. If the platform ever has thousands, switch the policy to a cached table |
| An old app build on a non-Jain community | Jain words and tabs until it updates | Non-Jain categories switched on only after the app version is live (PR 8); "Never" modules come back off from `my_modules`; tradition `other` hides the shared library; over-the-air updates arrive on the next launch |
| Guests and the moment before `my_modules` answers | Jain tabs flash for a chamber | The category's defaults instead of "everything on"; the category cached per community |
| A path hides content wrongly | A member loses a lesson they need | Today's community filter stays (F1); first tags only remove idol puja from non-idol paths; started lessons stay; "Not sure" shows everything; the Pathshala reviews |
| A path is sensitive religious data | Exposure beyond the family | Optional, skippable; the person, the household's adults and the office only; masked in the audit log; never in the directory or a message |
| Changing the category of a live community | Hides data members used | Community Connect only, reason, 2FA, a preview, the owner emailed; nothing deleted; reversible |
| The promotion copy route | A promoted chamber would come back as a Jain Center | The dispatcher carries the category; tested |
| Pinned counts | Tests that pin 18 modules fail when Labh is added | Planned in PR 4: test 13, `tests/modules.test.ts`, `mob/src/lib/__tests__/modules.test.ts` |
| `tradition` means several things | Repurposing it would break Niva, the panchang and the shared pack | Kept as the Jain Center's default tradition only; paths are a separate field |
| Receipts and tax wording | A chamber's receipt would mention religious benefits | C17 before any non-faith organization goes live (money wording, owner and accountant) |
| A family-centred core for chambers | Households and the Family tab do not fit businesses well | v1: a household is a member business (C18); business profiles later |
| connect-admin is not category-aware | A chamber's event-day app shows nothing Jain only because its staff hold no such permissions | Acceptable in v1 (C19) |

---

## 4. Decisions

| # | Decision | Recommended default |
|---|---|---|
| **C1** | Which categories, and their names | **Jain Center, Chamber of commerce, Non-profit (not faith-based), Faith-based non-profit (other faiths).** One category per organization. Only Jain Center can be chosen until the member app speaks a category's words |
| **C2** | Which modules each category gets (on, off until switched on, never) | **§3.1.2.** Chambers and secular non-profits never get Bolis, Labh, Pathshala, Gyan Path or My Jain Way; Store and Niva start off. Other faiths may switch on Pathshala ("Religious school") and Gyan Path ("Learning path") with their own content, never Bolis, Labh or My Jain Way |
| **C3** | Is Labh its own switch? | **Yes: a Labh module under Pledges & donations.** JSH keeps it on and could switch it off without switching off giving |
| **C4** | Who chooses the category, and can it change after go-live? | **Community Connect chooses it when creating the sandbox or approving the request. Later changes only by Community Connect, with a reason, a fresh 2FA check and a preview of what will be hidden; nothing is deleted, the owner is emailed, it can be changed back** |
| **C5** | What a non-Jain sandbox gets | **Its category's modules, words and layout; no Jain library, Jain calendar or Jain dietary option; its own demo pack** (chamber first; a general non-profit pack later, used by other faiths until a faith pack exists) |
| **C6** | The public request form | **Unchanged for now:** the applicant's "Kind of organization" is a hint; Community Connect picks the category at approval. Later the form may list the categories |
| **C7** | The Jain path list and its spelling | **Two steps: Shwetambar (Murtipujak or Derawasi, Sthanakvasi, Terapanth) or Digambar (Bispanthi or Beespanthi, Terapanth, Taranpanth), plus "Another path" and "Not sure, or more than one"; a person may stop at Shwetambar or Digambar.** Spelled "Shwetambar"; "Swetambar" and "Shvetambar" are found by search. The Pathshala and the religious coordinator confirm the wording before it ships |
| **C8** | Asked at sign-up, or optional later | **Asked once at sign-up in "About you", optional with Skip, adults only**, with "Use the same for my children" ticked; changeable any time in Profile › More about you |
| **C9** | Who can see a person's path | **The person, the adults of their household and the office (`people.view`).** Never other members, the directory or teachers; the audit log records that it changed, not the answer. A communications audience by path, later, is staff-only and shows counts, never names |
| **C10** | Does a path change things for the family, or only for the person? | **Only for the person: their own lessons, practices and library.** A parent's answer is copied to the children only when the parent ticks it. Community-wide items (calendar, events, darshan, announcements) never change |
| **C11** | A child's path | **Set by a parent;** a child's own login reads it, like the other "More about you" details |
| **C12** | The Do puja door for paths that do not do idol puja | **Hidden for Sthanakvasi, Shwetambar Terapanth, Taranpanth and the Digambar paths** (Navang puja is a Shwetambar Murtipujak practice) until a lesson for their own practice exists; **shown** for Murtipujak, a Shwetambar or "Not sure" answer, "Another path" and no answer. The live darshan door stays for everyone |
| **C13** | Who decides which shared lessons and practices belong to which path | **The Pathshala and the religious coordinator**, starting from §3.4.6, which only takes idol puja away from non-idol paths; everything else stays for every path until they decide |
| **C14** | JSH's community default | **Stays Shvetambar Murtipujak:** it applies to members who have not answered and to community-wide items |
| **C15** | The name of the "Jain Way" tab per category | **"Jain Way" for Jain Centers (unchanged); "Learn" for other faiths (shown when Learning path, Religious school or the library is on); no fourth tab for chambers and secular non-profits in v1** |
| **C16** | Can an organization edit its category's words? | **Not now: the category's words only.** Later, a short list of named words (greeting, store name, Give tab, …) per organization, by an admin with a reason; never free editing of app text |
| **C17** | Receipts and statements for organizations that are not houses of worship (money wording) | **Owner and accountant decide before any chamber or secular non-profit goes live** (not before a sandbox). Until then their receipt sample leaves out "intangible religious benefits", and a chamber's dues do not say they are a charitable gift. **Needs owner sign-off** |
| **C18** | Chamber members are businesses | **v1: one household is one member business** (its people are its contacts; the household card shows it). A business profile (industry, website, logo) and an industry list come later; no personal path for chambers |
| **C19** | connect-admin (event day) | **Unchanged in v1:** it shows Pathshala, Bolis and the store by permission, which a chamber's staff do not hold |

---

## 5. Phased PR plan

Sizes: S under 300 changed lines, M 300–800, L over 800. Every database PR runs the database tests (`supabase/tests/run_local.sh`, the CI job "Database tests"), regenerates `src/lib/database.types.ts` and copies it to connect-admin and connect-mobile. Member-app PRs are JavaScript only and ship over the air (no new native module, no APK). "Contract" means the PR is built against §3.8 while the database PR is still in review, and merged after it.

**Phase 1: the foundation (nothing changes for JSH)**

| # | Repo | PR | Size | Needs | Built in parallel? | Owner sign-off |
|---|---|---|---|---|---|---|
| 1 | connect-crm | **DB 1, migration 0594, test 79.** The three catalogs (Jain Center active; the other three inactive), `centers.category_key` with its guard, `set_center_category` and the preview, the creation and promotion routes, the category-aware module functions, `category_profile`, `module_states`, `person_profile_details.path_key`, the dietary seed, the Setup texts; tests 13, 23, 36 and 48 extended; MODULES.md, DECISIONS.md and ONBOARDING_PLAN.md (G28) updated | L | C1, C2, C4, C7, C9 | First | **Yes**: the module functions change what is readable for any non-Jain community (RLS); who may change a category; the path's privacy |
| 2 | connect-crm | **Portal 1: Platform and Settings.** Category on New sandbox and Requests, the Centers list and the center page (change with preview, reason, 2FA), the legacy wizard, Settings › Modules locked rows, the gate and Setup wording | M | PR 1 (contract) | Yes, with PR 1 and PR 3 | No |
| 3 | connect-mobile | **App 1: category plumbing, no visible change.** `category_key` in `loadCenter` (with the old-database fallback), `category_profile` cached per community, the module map from the category before `my_modules` answers, the overlay mechanism (empty for Jain Center), `categories.ts` (Jain Center = today's constants), the generic layout for unknown categories; tests that Jain Center is identical | M | PR 1 (contract); released after PR 1 is deployed | Yes, with PR 1 and PR 2 | No |

**Phase 2: the first non-Jain category**

| # | Repo | PR | Size | Needs | Built in parallel? | Owner sign-off |
|---|---|---|---|---|---|---|
| 4 | connect-crm | **DB 2 (next free number at build time).** The Labh module; category tags on shared rows and platform catalogs; `path_keys` and the first tags (§3.4.6); Niva's search by category; test 13 (18 → 19), tests 55 and 71 | L | PR 1; C3, C13; the Pathshala's look at §3.4.6 | After PR 1 | **Yes**: Labh's tables move to a new module (RLS); Niva's shared sources narrowed |
| 5 | connect-crm | **DB 3 (next free number): demo packs per category.** "Demo chamber"; another category's pack refused; Setup › Demo lists the category's packs; test 29 | L | PR 4 | Yes, with PR 6 and PR 7 | No (sandbox demo data, already decided) |
| 6 | connect-crm | **Portal 2: category-aware screens** (§3.5), Niva's prompt per category (worker), message-template wording, the Labh tab by its module, the receipt sample (C17) | L | PR 4 (contract) | Yes, with PR 5 and PR 7 | Only the receipt and statement wording (C17, money) |
| 7 | connect-mobile | **App 2: the non-Jain experience.** Overlays for Chamber, Non-profit and Faith-based (about 110 keys each), tabs, Home and the Today card per category, sign-up steps and interests per category, neutral product copy (F7), Labh by its module | L | PR 4 (contract); released after PR 4 is deployed | Yes, with PR 5 and PR 6 | No |
| 8 | connect-crm | **Switch on Chamber of commerce** (a one-line migration) once PR 7 is live on phones and a chamber preview sandbox has been checked by hand; Non-profit and Faith-based follow the same way when their words are reviewed | S | PRs 5–7 | No | The owner says go (C1) |

**Phase 3: personal paths**

| # | Repo | PR | Size | Needs | Built in parallel? | Owner sign-off |
|---|---|---|---|---|---|---|
| 9 | connect-mobile | **App 3: personal path.** The question in About you (adults, optional, "Use the same for my children"), Profile › More about you, a child's answer from the Family tab; the person-level filter for lessons, practices, pachchakhan and the library order; the Do puja door by path | M | PR 1 and PR 4 deployed; C7, C8, C10, C12 | Yes, with PRs 5–8 | No (the access rules were approved with PR 1) |
| 10 | connect-crm | **Portal 3 and worker: the path for the office and Niva.** The answer read-only on the staff person page; Niva's path context; later a path audience in communications (staff only, counts never names) and path-tagged calendar layers | M | PR 4 | After PR 9 | **Yes**, for a communications audience by path (privacy) |

---

## 6. Test plan

| Layer | Where | What |
|---|---|---|
| Database: catalog | `supabase/tests/79_organization_categories_test.sql` (PR 1) | Four categories, only Jain Center active; a row for every category and module; core modules `default_on`; no available module depends on an unavailable one; the Jain Center paths; guests read the three catalogs |
| Database: **JSH unchanged** | test 79 | For every existing community and every module, the new `module_enabled` equals the 0101 rule; `my_modules(jsh)` returns the same 18 rows, all on; a JSH member reads the same number of rows from every module table; JSH's tradition, dietary list and access levels unchanged |
| Database: a non-Jain community | test 79 (a preview sandbox) | Bolis, Pathshala, Gyan Path and My Jain Way off: no rows readable, their RPCs refuse with the category message, their storage buckets closed, their Setup steps skipped with the category text, their access areas `module_off`; `set_module_enabled` refuses to switch them on; Store off, then switched on and off again; `my_modules` shows them `enabled = false`; platform admins pass; tradition is `other`; no Jain dietary option |
| Database: category changes | test 79 | Only through `set_center_category`; a `settings.manage` user's direct update and a platform admin's direct update both refused; reason and fresh 2FA required; the preview's counts; data hidden then visible again after changing back; paths kept |
| Database: creation and promotion | tests 79, 23, 36 | `platform_create_sandbox` with a category; an inactive category only for a platform admin's sandbox; redeeming a code takes the request's category; the copy route keeps the category; in place unaffected; `promote_sandbox` refuses an inactive category |
| Database: path | tests 79, 48 | A valid key saved; an unknown key refused in plain English; a child's own login cannot write it, a household adult can; staff read; another household cannot; the audit log masks it |
| Database: DB 2 and DB 3 | tests 13, 29, 55, 71 and the DB 2 test (next free number) | Labh: `my_modules(jsh)` 19 rows with Labh on and the other 18 unchanged; Giving cannot be switched off while Labh is on; shared Jain rows tagged `jain_center`; with no path, the shared items a JSH member is offered are the same before and after the tags; Niva offers no Jain shared source to a chamber; the chamber pack loads exactly its listed rows and a Jain pack is refused in a chamber |
| Portal | vitest: `tests/modules.test.ts`, `tests/platform-sandbox.test.ts`, a new `tests/categories.test.ts` | Settings › Modules rows by availability; the category select and its errors; nav without "Never" modules; the gate sentence; access areas and shortcuts per category; a Jain Center admin's nav unchanged |
| Portal end to end | the e2e flows | Create a chamber preview sandbox; the nav has no Bolis, Pathshala, Gyan Path or My Jain Way; Settings › Modules shows them locked; change the category with the preview and back |
| Member app | jest: `mob/src/lib/__tests__/modules.test.ts`, `i18n.test.ts`, a new `categories.test.ts` | **Jain Center layout equals today's constants** (tabs, Home rows and cards, sign-up steps, labels); Jain Center's overlay is empty, so `t(key)` equals the English dictionary for every key; every overlay key exists in `en.ts`; an unknown category gets the generic layout; a chamber's module map before `my_modules` answers hides the "Never" modules; sign-up steps per category; the path filter (branch, "Not sure", no answer = the community default); the Do puja door per path |
| By hand | the JSH sandbox and a chamber preview sandbox | Before and after screenshots of JSH (Home, Jain Way, Give, Family, sign-up) are identical; a chamber on a test phone, signed in and as a guest (no flash of Jain tabs); an old app build on the chamber shows module-off screens, never an error |

---

## 7. Questions for the owner

1. **Categories:** start with Jain Center, Chamber of commerce, Non-profit (not faith-based) and Faith-based non-profit (other faiths)? *Recommended: yes; only Jain Center can be chosen until the app speaks each one's words.*
2. **Choosing and changing:** may only Community Connect set a category, and change it later? *Recommended: yes, at sandbox creation or approval; later only with a reason, a fresh 2FA check and a preview; nothing is deleted.*
3. **A chamber's modules:** no Bolis, Labh, Pathshala, Gyan Path or My Jain Way, ever; Store and Niva off until switched on? *Recommended: yes, and other faiths may switch on Pathshala and Gyan Path under neutral names.*
4. **Labh:** make it its own switch under Pledges & donations? *Recommended: yes.*
5. **The Jain path list:** Shwetambar (Murtipujak, Sthanakvasi, Terapanth), Digambar (Bispanthi, Terapanth, Taranpanth), Another path, Not sure, spelled "Shwetambar"? *Recommended: yes, worded by the Pathshala before it ships.*
6. **When to ask:** once at sign-up, optional, adults only, with "same for my children"? *Recommended: yes, editable later in Profile.*
7. **Who sees a path:** the person, their household's adults and the office only? *Recommended: yes; hidden in the audit log, never in the directory.*
8. **What a path changes:** only that person's lessons, practices and library, never the community calendar, events or darshan? *Recommended: yes.*
9. **Do puja door:** hide it for Sthanakvasi, Terapanth, Taranpanth and Digambar paths until they have a lesson of their own? *Recommended: yes; the live darshan door stays for everyone.*
10. **Tab name and words:** "Jain Way" for Jain Centers, "Learn" for other faiths, no fourth tab for chambers; organizations rename words later, not now? *Recommended: yes; receipts for chambers wait for the accountant (C17).*
