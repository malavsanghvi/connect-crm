# Kind of organization in the portal

How the portal (connect-crm) chooses, shows and follows an organization's **kind** (the database and the plan call it a category, the owner calls it an experience; the screens say "Kind of organization"). The database side is in [MODULES.md](MODULES.md) (0594) and the experiences migrations (0600 onward); the plan is [ORGANIZATION_CATEGORIES_PLAN.md](ORGANIZATION_CATEGORIES_PLAN.md).

## Choosing and changing the kind (Portal 1)

Owner direction 2026-10-08: the platform is for every kind of community (a Jain temple, a church, a chamber of commerce,
a club, a non-profit, a neutral organization), and a kind is **data**: a catalog row with its module defaults and wording
terms. The UI says **"Kind of organization"** (the database and the plan say category / experience).

| Where | What the portal does |
|---|---|
| Platform › New sandbox | One two-step picker built from `app.list_experiences()` (Faith-based › tradition › the kind, or Chamber of commerce / Club / Non-profit / Neutral …). It is the only choice that shapes the sandbox; it is sent as `p_category_key`. A sandbox may preview a kind that is not switched on for live organizations yet. |
| Platform › Requests | The applicant's "Kind of organization" stays a hint and pre-selects the picker; Weaver must choose the kind to approve (`app.set_access_request_category`, then `decide_access_request`). |
| Platform › Centers, a center's page | The Kind column; the page's **Kind of organization** card: the current kind, **Change…** with a preview from `app.category_change_preview`, a reason, and a fresh 2FA check (`app.set_center_category`). Nothing is deleted; changing back restores everything. |
| Platform › New center (legacy wizard) | The kind is chosen at step 1, when the center is created (the database refuses a plain update of it afterwards); step 2 asks for a tradition only when the kind keeps one. Only kinds switched on for live organizations are offered. |
| Settings › Modules | Rows come from `app.module_states`: a module the kind never offers is listed last, greyed, "{Module} is not part of a {Kind} organization", with no switch; a module the kind starts off says so and keeps its switch. A kind with every module on (a Jain Center) reads exactly as before. |
| The module gate | A direct link to a module the kind never offers says "{Module} is not part of a {Kind} organization" (no link to a switch that does not exist); a module the organization switched off reads as before. |
| The session | `session.kind` (from `app.category_profile`): the kind's name, wording terms and module availability, loaded once per request. If the database cannot answer, `LEGACY_KIND` (a Jain Center, today's words) is used so the live organization never changes because of a hiccup; a test pins it to the 0594 seed. |

## Screens that follow the kind (Portal 2)

A screen every kind can reach must not speak Jain unless the organization's kind does. The rule is the same everywhere
and lives in two small files, not in the screens:

- `src/lib/kind.ts`: `kindHas(kind, "tradition")` (the kind keeps a tradition pack: `uses_tradition`, today's Jain
  Center), `kindHas(kind, "labh")` (the `labh` module when the database has one, else Bolis), `moduleNotOffered(kind,
  module)` (the kind never offers it), `kindName(kind, module, fallback)` (the kind's own name for a module, else its
  term for the store / school / learning path), `kindSchool(kind)`.
- `src/lib/wording.ts`: `word(kind, key)`. **Order: the kind's own term (a key of `organization_categories.terms` with the
  same name) beats the tradition pack's wording, which beats the neutral wording.** A Jain Center therefore reads exactly
  as before (tests compare old and new), any other kind reads the neutral words, and a new kind can name any of them in
  its catalog row with no code change. The keys are in `WORDS`: `today_tab`, `live_stream`, `live_stream_item`,
  `festival_dates`, `cash_box*`, `pledge_item*`, `pledge_list_type`, `opportunity_example`, `pledge_item_example`,
  `address_example`, `payee_example`, `house_of_worship`, `pin_drives`.

| Screen | For a kind without the part |
|---|---|
| Nav | No Labh tab (`kindFeature`); Giving, the store and the school in the kind's own words; the Content tab "Today & darshan" is "Live stream" |
| Content › Today | Only the live stream (no daily timings, panchang, Navkarsi or Chauvihar) |
| Content › Library, Media library | No pachchakhan; songs instead of stavans; no "fully Jain" recipe mark |
| Calendar | No tithi table or tithi layer; no Pathshala layer without Pathshala |
| Giving | No Labh page (a direct link says so); campaign kinds, fixed-list wording and the cash box in the kind's words; receipt and statement sample per decision C17 (below) |
| Store | Named by the kind's `store` term |
| Settings › Rules | No boli, store or points card for a kind without them (stored values go back unchanged) |
| Settings › Access levels, Home shortcuts, Roles, Notifications, Data import, Custom fields, Audit filters | Only what the kind has |
| Setup | Leader groups, entity types, lists, profile text and the brand-kit greeting in the kind's words |
| Reports and the public dashboard | KPIs and sections of modules the kind lacks are not offered; section titles in the kind's words |
| Comms, surveys, events | No "Pathshala parents" / "Pathshala families" without a school |
| Content › Niva | The "doctrinal" note refers to the kind's school, a leader, or the office |
| Worker, Niva's prompts | `systemPrompt` / `rewriteSystem` take the kind's words (`conversation.kind`); a Jain Center's text is byte for byte what it was |

**Receipt and statement sample (C17, money wording, owner to confirm).** A house of worship's sample keeps the line "No
goods or services were provided other than intangible religious benefits." A kind that is not faith-based (a chamber, a
club, a neutral organization) has neither that line nor the "Temple construction" fund in its sample.

**Database follow-ups this relies on or would be better served by** (none is required for a Jain Center): the
`terms` check of 0594 allows exactly nine keys, so the optional terms above need `app.category_terms_ok` relaxed;
`app.niva_worker_get_conversation` should return `kind: {assistant_context, school, faith_based, uses_tradition}` for
the worker (the worker role cannot read the catalog tables); the Setup step titles, message templates, roles and the
payment-method names ("Cash (bhandar)") are rows in the database and need the experiences' own rows.
