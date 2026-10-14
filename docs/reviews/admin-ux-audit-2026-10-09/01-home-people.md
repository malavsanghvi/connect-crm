# UX audit 01: Home, shell, People, Households, Identifiers, Memberships, Search, Account, Privacy, Audit, Approvals

Read-only audit of `/home/user/connect-crm` (Next.js App Router + Supabase), 2026-10-09. Nothing was run; every statement comes from reading code, migrations and docs.

Note on the docs: `docs/parity/p1-shell-people-settings.md` is stale. It says the portal has no drawers, modals, toasts, People list, household edit, merge wizard or Settings tabs. The code now has all of them (`src/components/drawer.tsx`, `modal.tsx`, `toast.tsx`, `src/app/(app)/people/**`). This audit describes the code, not that doc.

## 0. Coverage

| Kind | Count | What |
|---|---|---|
| `page.tsx` files in my areas | 15 | `/`, `/households`, `/households/[id]`, `/people`, `/people/[id]`, `/people/directory`, `/people/merge`, `/people/requests`, `/people/voting`, `/memberships/applications`, `/account/security`, `/settings/privacy`, `/settings/audit`, plus two redirects (`/privacy/requests` and `/audit` go to the two Settings pages) |
| Real screens | 13 | the 15 minus the 2 redirects |
| Shell | 1 | `(app)/layout.tsx`, `src/components/shell/*`, `loading.tsx`, `error.tsx` |
| URL drawers (state lives in `?hh=`, `?person=`, `?app=`, `mode=`) | 7 | household, household edit, add person, person, move person, application, record History |
| Page-less surfaces | 3 | global search (`search/actions.ts`), Identifiers panel (`identifiers/actions.ts` + `components/identifiers-panel.tsx`; no `/identifiers` page exists even though NAV lists the path), Approvals (`approvals/actions.ts`, surfaced on Home, Voting, household money) |

Sections below: S1 Shell, S2 Home, S3 Global search, S4 Households list, S5 Household record, S6 Identifiers, S7 People list, S8 Person record, S9 Directory and expertise, S10 Merge duplicates, S11 Family change requests, S12 Voting eligibility, S13 Membership applications, S14 Approvals, S15 Account security, S16 Privacy requests, S17 Audit log.

## 1. Cross-cutting findings

### 1.1 Friction patterns

1. **Records are scattered across three surfaces with different powers.** A household is a table row, then a 460px drawer (summary, edit, add person), then a full page with 6 tabs (`households/[id]`). Capabilities are split: Identifiers, Memberships, Pledges, Payments, Audit tabs and Mark-as-deceased exist only on the full page; Edit/Add/Move exist only through drawers. The top-bar search jumps to the full page, list rows open the drawer. People get the same split (`people/_components/drawers.tsx` vs `people/[id]/page.tsx`, which re-renders the same data a second way).
2. **Every action that leaves People is a context switch.** Record payment goes to `/giving/payments?household=`. Merge duplicate goes to `/people/merge` (own two-step wizard). Application "Household record" and Home task links all navigate away. The Home page is mostly signposts: "37 bank lines to match" is a link to another module.
3. **Navigation by module and table, not by task.** 15 sidebar modules, about 97 tab destinations in `NAV` (`src/lib/permissions.ts`). Settings alone has 24 tabs (Audit and Privacy are two of them). All six People pages are titled just "People"; Audit and Privacy are titled "Settings". The title never says where you are; the grey description does the work.
4. **Dead-end controls.** `Export` buttons are disabled with a tooltip on Households, Voting and Audit (`ExportButton` in `people/_components/client.tsx`; `settings/audit/page.tsx`), although `app.record_export` (migration 0154) already exists. "Printed sign-in code" is a disabled button in the person drawer. Two of four family-request kinds ("Remove a family member", "Move to a new household") show "Not supported here yet" with no way even to decline. The Directory page has a KPI that says "not recorded yet" and a card that says there is no review step.
5. **Jargon and raw system names in user-facing copy.** "Decisions need the people.approve permission", "A different person with giving.approve must approve it", `NoAccess` lists permission keys, audit filters use raw table names and action codes ("Action contains payments.insert"), record id filter wants the full UUID, "EC approval", "org person ID" labels.
6. **Search is inconsistent.** Top bar: `staff_household_search` + a people query; hidden entirely below the `md` breakpoint (`app-shell.tsx`: `hidden ... md:flex`), so there is no search on a phone. `/households` search additionally resolves CRM, QuickBooks and bank-payer identifiers via `resolve_identifier` (`lib/data/search.ts`). People list uses debounced `LiveSearch`; Households uses a Search button plus GET form (full reload); Merge uses another GET form. Same words, different results.
7. **Two-person and step-up flows are scattered.** A refund approval is a Home row; the request that created it is on the household Payments tab; the rule is in `approvals/actions.ts`; the 2FA modal is in a provider. The staff member has to know the sequence (request, approve by a different person, record).
8. **Multi-step changes are not atomic and report "partial success" in prose.** `updateHouseholdAction` saves fields, then calls `change_household_tier`; if the tier step fails it says "the other changes were saved". `updatePersonAction` does the same with the relationship change.
9. **Performance friction.** `(app)/layout.tsx` calls `countHomeTasks`, which runs all 19 task loaders (`lib/data/home-tasks.ts`) just for the Home badge. Home KPIs sum up to 50,000 payment rows in TypeScript (`lib/data/home-kpis.ts`). Household list issues several chunked queries per page; `householdCards` is one RPC per household.

### 1.2 Rules the redesign must keep (and where today's code already bends them)

- **Errors always plain English, beside the action, with retry** (`failure()` in `lib/errors.ts`, `ActionMessage`, `QueryError`). Preserve for every assistant tool result: the assistant must show the same sentence and a Retry, never "something went wrong".
- **Households never by name alone.** Today violated or weak in: global search person hits (`lib/global-search.ts` `personResult` prints "Household: <name>" with no number); merge suggestions queue (`people/merge/page.tsx` `CandidateQueue` shows two bare names); person-merge step 1 (name, member no., email, no household); Family change requests (household name only; approving adds a person to it); Voting "Voters" table (household name only); Home refund/write-off/credit rows and their confirm text (names only, although `household_number` is loaded); Directory (name only). Global search household hits also lack zone, last gift, open balance and the primary member's org person ID, so they are not the `household_card`. The assistant's pickers and confirmations must render the full card (`components/household-card.tsx`, RPC `app.household_card`).
- **Money is integer cents** (`parseAmountToCents`, `formatCents`). The assistant must never do arithmetic in the model; amounts come from tool results and are echoed back formatted.
- **RLS is the enforcement.** The portal already runs every read and Server Action as the signed-in user (`lib/supabase/server.ts`: anon key plus the user's cookies; the RPCs I read for People are `security invoker` or check `has_permission` inside). `ACCESS`/`canAccess` in `lib/permissions.ts` is a convenience mirror. The assistant must call the same actions and RPCs with the same client, filter its tool list with `canAccess` for usability only, and never use a service key. Note the existing AI code (`worker/src/handlers/niva.answer.ts` and two others) runs in the worker as a queue job with the service role and the Anthropic key; no Next.js code calls Anthropic today (`@anthropic-ai/sdk` is only in `worker/package.json`). The interactive assistant must not copy that pattern.
- **When RLS would return nothing, say "You don't have access to this area"** (`NoAccess`), not an empty list. The assistant needs the same distinction (empty result vs no access).
- **Step-up (SQLSTATE CCSTP)**: the DB raises it; the UI opens `StepUpProvider` (client) and retries once. The TOTP code must be typed into that native modal, never into chat and never into model context.
- **Two-person rule** is enforced by DB triggers (`enforce_two_person`, migration 0016; EC rule in 0501). The assistant may help request and may help a different eligible person approve; it must never try to route around the requester.
- **Audit reason**: `dbWithReason(session, reason)` sends `x-audit-reason`. Assistant-initiated writes should carry the staff member's stated reason, and should be marked in the audit trail as assistant-assisted (`x-client-app`/`x-client-screen` headers already exist in `lib/supabase/trace.ts`).

### 1.3 Blockers and gaps for an assistant (code facts)

| # | Fact | Where |
|---|---|---|
| B1 | **Confirmation is a client convention.** `ActionForm` shows a modal from `confirmMessage`/`data-confirm`, then submits. The Server Actions themselves run immediately when called. An assistant needs a server-side propose, confirm, execute step (an intent record or signed token) for every money, permission, delete or merge action. | `components/action-form.tsx`, all `actions.ts` |
| B2 | **Server Actions take `(prevState, FormData)`**, are meant for `useActionState`, and carry validation in TS helpers (`lib/people.ts` `parsePersonForm`, `parseHouseholdForm`, `normalizePhone`, `parseDateInput`). Good: pure and reusable for tool input schemas. Bad: no typed input contract, no dry run. | `people/actions.ts`, `households/actions.ts` |
| B3 | **Several rules are direct table UPDATEs from the action, not RPCs**: `updateHouseholdAction`, `updatePersonAction`, `decideApplicationAction` (state machine `lib/applications.ts planDecision`; DB trigger in 0501 re-checks EC ordering), `requestOverrideAction`/`applyOverrideAction`, `requestWriteOffAction`/`completeWriteOffAction`/`requestRefundAction`/`recordRefundAction` (read-modify-write of `refunded_cents` with an optimistic check), `updateDataRequestAction` (the `MOVES` transition map is in TS; I found no DB-side transition guard), `addIdentifierAction`/`retireIdentifierAction`. DB triggers protect the two-person money rules, but nothing else protects the TS-only transitions from any other caller. Wrapping these in RPCs (with preview variants) would give the assistant, the portal and the mobile app one rule. |
| B4 | **RPC-backed and ready to be tools**: `change_household_tier`, `staff_add_person`, `make_primary_of_own_household`, `move_person_household`, `merge_people`, `merge_households`, `decide_household_change_request`, `mark_person_deceased`, `undo_person_deceased`, `set_household_primary`, `approve_as_second`, `approve_flagged_refund`, `request_provider_refund`, `record_manual_paypal_refund`, `resolve_rsvp_credit`, `resolve_identifier`, `household_card`, `staff_household_search`, `staff_person_names`, `record_history`, `my_security_status`. |
| B5 | **Reads live inline in `page.tsx` and tab components** and cannot be called by a tool: households list with balances/members/on-app (`households/page.tsx`), household tabs (`households/[id]/*-tab.tsx`), applications list and the reference checks (`memberships/applications/page.tsx`: tier rule, "outside household", duplicate count are computed in the page), privacy list, audit query, merge compare, `people/[id]/page.tsx`. Reusable loaders already exist for: `loadHouseholdRecord`, `loadPersonRecord` (`lib/data/people-records.ts`), `listPeople`, `loadDirectory`, `loadVoting`, `searchHouseholds`, `loadHomeTasks`, `loadHomeKpis`. `listPeople` and `loadDirectory` still use direct queries although `app.people_list` and `app.directory_listing` exist (comments say "only listPeople() changes"). |
| B6 | **No preview/dry-run for most writes.** Merges (compare table is page code), tier change, application approval, privacy completion, identifier changes have no "what will happen" function. Payments has `preview_allocation`; People does not. |
| B7 | **N+1 and caps**: `householdCards` fires one `household_card` RPC per household. Home tasks `.limit(25)` per source silently. Voting loads all life memberships and voters with no paging. Global search caps at 8. A batch `household_cards(uuid[])` RPC and a `my_tasks` RPC would make the assistant fast and truthful about "and 12 more". |
| B8 | **Privacy requests have no processing backend in this repo.** Staff paste an export file path and click "Mark complete"; no worker handler or edge function produces the export or performs deletion (the page text says "produced by the privacy service (edge function)"; none is in `worker/src/handlers` or `supabase/`). The assistant cannot honestly say "export done". |
| B9 | **Exports do not exist**: `data.export`, `people.children`, `giving.amounts` are `planned: true` in `lib/entitlements.ts`; Export buttons are disabled. `app.record_export` (step-up plus audit entry) exists as the future gate. |
| B10 | **Money aggregates are computed in TS** (Home "Given this year", "Open pledges"). Questions like "how much did we receive from life members this year" need aggregate RPCs (`kpi_flows`/`public_kpis` exist for the public dashboard only). |
| B11 | **Duplicate-safe add**: `staff_add_person` does not check for an existing person with the same name or contact; the portal never asks. The assistant should call a duplicate probe first (search plus `merge_candidates`). |
| B12 | Audit trail masks DOB, card refs and secrets in `before/after` (`app.audit_mask`). Assistant answers about "who changed X" must read through `record_history`/`audit_log` with the user's `audit.view`, and never pass raw rows into the model beyond what the user can see. |

### 1.4 Proposed confirmation tiers for this area

- **T0 read**: no confirmation.
- **T1 reversible, low-risk write** (profile edit, address, zone, directory/mail opt-ins, retire an org ID, start a privacy case, add a child): show a preview diff, one click "Apply".
- **T2 explicit confirmation** (anything touching money, permissions or roles, eligibility, identity or household access, deletion or irreversible change): preview with the full household card, the exact values and the reason; a separate Confirm click in the native modal; step-up through the native modal when the DB asks; assistant cannot "pre-confirm".
- Items that are T2 in this area: all of S14 Approvals; tier change; merges; mark deceased; set primary and make-primary-of-own-household; move person; add an adult with email or mobile (the new person can then sign in and act for the household, including money); approve family change requests that add an adult; voting overrides (request and apply); application approve and decline; privacy complete/reject (deletion); finance-kind identifiers (`bank_payer`, `accounting`, `payment_provider`, which change how gifts are matched); sign out everywhere.
- **Never by the assistant**: 2FA enrollment or removal, entering a step-up code, second approval of something the same user requested (DB blocks it anyway).

---

## S1. Shell: top bar, sidebar, tabs, providers

1. **Route / who**: `(app)/layout.tsx`, `components/shell/*`. Every signed-in person. Modules and tabs are filtered by `visibleNav(session)` (permission keys, module switches, organization kind, sandbox, platform-only). Platform admins also get Platform. Staff 2FA gate redirects to Account › Security (`enforceStaff2fa`).
2. **Jobs**: orient; reach the right module and tab; find a household or person fast; see how many tasks wait; switch organization; open Account; sign out.
3. **Pattern and friction**: 60px top bar (tenant mark, product name, centre pill or switcher, search pill, avatar + role, "Account", "Sign out"), flat sidebar of up to 15 modules, a second-level tab strip under the title, role footer ("{role} · N permissions. Menus, data and buttons follow your role…"), phone "Menu" popover. Friction: Settings has 24 tabs in one strip; the tab strip is the only way between siblings; page title repeats the module name; the search pill disappears on phones; "Account" only means 2FA and phone (no profile); the footer talks about "permissions" counts; Home badge is computed on every layout render; `loading.tsx` is one generic skeleton; `error.tsx` is fine (shows a digest and "Try again"). Providers (Toast, StepUp, History, Kind, Modules) already wrap `children`, which is what an assistant panel needs.
4. **Assistant**:
   - "Take me to the Mehta family's payments" - READ + navigate. `searchHouseholds`/`staff_household_search` then `household_card` for disambiguation; deep link `/households/{id}?tab=payments` (URL scheme already supports `?hh=`, `?person=`, `mode=`). No confirm.
   - "Why can't I see Giving?" - READ. `canAccess`/`ACCESS` plus grants; answer in plain words (which role grants it, who can grant it), never raw keys. No confirm.
   - "What changed since I was last here?" - READ. `loadHomeTasks`, `record_history`. No confirm.
5. **Visual vs fresh design**: keep a compact module list for browsing and spatial memory. Replace the 24-tab Settings strip with task-grouped hub pages; make the assistant/search a command bar available on every width (also phones) and on every screen, with the current page and open drawer passed as context; title should name the screen ("Membership applications", not "People"). Keep Toast/StepUp/Modal providers above the assistant panel so a refused action can open the same step-up modal.
6. **Rules**: `NoAccess` wording; sandbox watermark; step-up modal reachable.

## S2. Home `/` (`(app)/page.tsx`)

1. **Route / who**: all staff roles. Task sources are the 19 in `lib/tasks.ts` `TASK_SOURCES`, each shown only when the user holds an acting permission and can read the data (e.g. refund, payee change, write-off, credit, deposits, membership, voting override, newsletter, inbox, WhatsApp, content, QuickBooks, inventory, event waivers, feedback, bolis, pathshala, roles, privacy). Platform admins are redirected to `/platform/setup` until setup is complete or parked.
2. **Jobs**: see what is waiting for me; give a second approval; open the queue that needs work; glance at health numbers.
3. **Pattern and friction**: "My tasks" card (tag, title, meta, buttons) next to "At a glance" tiles (Households, On the app, Given this year, Open pledges, Next event RSVPs, Store orders, Pathshala students). Only two-person approvals and "mark credit handled" resolve inline; every other row is a link to another module. Refund, write-off and credit rows name the household by display name only. Each source is capped at 25 with no "and N more". Failed sources show a row with "Try again" (good). KPI sums are done in TypeScript over up to 50,000 rows. Generic subtitle "My tasks across every module you can act on".
4. **Assistant**:
   - "What's on my plate today, most urgent first?" - READ. `loadHomeTasks` (extract as a tool; add due dates/SLA, e.g. privacy requests due in 30 days). No confirm.
   - "Approve the Patel refund" - WRITE, money. `approveAsSecondAction` → `app.approve_as_second('payments', id)`. T2: show payment receipt, amount, requester, reason and the `household_card`; DB refuses if you asked for it; step-up if required.
   - "Mark the Desai RSVP credit as handled" - WRITE, money. `resolve_rsvp_credit`. T2.
   - "How are we doing on pledges versus last year?" - READ. needs aggregate RPC (B10); currently TS sums.
5. **Visual vs fresh design**: keep KPI tiles and the ranked list (scan-and-act). Fresh design: a morning briefing at the top (assistant summary of 3 to 5 things with evidence), tasks grouped by deadline and owner, each with the household card and a "resolve here" side panel for the common cases (bank line match, application decision, credit handled) so Home stops being a signpost. Replace the layout-time `countHomeTasks` with one cheap counts RPC.
6. **Rules**: failures stay visible per source; money formatted from cents; household never by name alone in approve confirmations.

## S3. Global search (top bar; `search/actions.ts`, `components/shell/global-search.tsx`, `lib/global-search.ts`)

1. **Route / who**: any user with `people.view` or `people.manage` (`ACCESS.households`). People hits additionally require those; the household RPC checks its own permissions.
2. **Jobs**: find a family or person by name, number, email, org ID.
3. **Pattern and friction**: debounced (250ms) dropdown, max 8 results, keyboard navigation, errors shown in the dropdown (good). Friction: shown from `md` up only; no payments/pledges/events/applications; identifier kinds beyond org IDs (CRM, QuickBooks, bank payer) are not searched here but are on `/households`; person hits show "Household: <name>" without number; household hits omit zone, last gift, open balance; results always open the full page, not the drawer; two same-name families are told apart only by the detail line.
4. **Assistant**:
   - "Find Rahul Shah" - READ. `staff_household_search` + `staff_person_names` + `household_card` for each; returns cards to pick from. No confirm.
   - "Who is 417?" - READ. `resolve_identifier`; reply must separate person 0417 from household 0417 (docs/ARCHITECTURE: a bare number can be both).
   - "Whose Zelle name is K M MEHTA?" - READ. `resolve_identifier` on `bank_payer`; remind it is a matching hint, not unique.
5. **Visual vs fresh design**: the result card (household_card layout) stays visual and is the assistant's disambiguation unit. Fresh design: one search that answers across all record types and identifier kinds, always returning cards, available as a command bar and on phones. Needs batch `household_cards(uuid[])` (B7).
6. **Rules**: never by name alone; failures in plain English with retry.

## S4. Households list `/households` (title "People"; `households/page.tsx`, `people/_components/drawers.tsx`)

1. **Route / who**: `people.view` or `people.manage`; edit with `people.manage`; tier with `people.approve`; open balance with a giving permission. Typical roles: membership coordinator, treasurer (read), center admin.
2. **Jobs**: find a family; see tier, zone, balance; open to edit address/zone/consents; add a person; start a merge; record a payment.
3. **Pattern and friction**: card with tier chips (All, Life, Yearly, Community), search box + zone select + Search/Clear (full-page GET), custom-column picker, 50-row table (ID, household, members with org person IDs, zone, tier badge, people count, on app, open balance) with whole-row click to a drawer. Drawer shows members (tap to open person), giving summary, consents, possible duplicates, activity; buttons Record payment, Merge duplicate, Edit household, Full record. Friction: search needs a button press; filters reload the page; "Children's details visible to your role" is static text (there is no `people.children` permission yet, so minors' DOBs show to everyone with `people.view`); Export disabled; "No household matches that search" with no "did you mean"; the drawer does not carry Identifiers, Memberships, Payments, Audit (needs the full page); Record payment leaves for Giving.
4. **Assistant**:
   - "Show life-member families in the West zone with an open balance over $500" - READ. needs a filtered list tool (today inline in `page.tsx`, and balance filtering is not supported by the page at all). No confirm.
   - "Change the Shah household's zone to North" - WRITE T1. `updateHouseholdAction` (direct update, audited). Preview diff.
   - "Make the Kapadia family Life members, they paid at the office, receipt 2026-0412" - WRITE T2. `change_household_tier(p_household, p_tier, p_reason)` through `updateHouseholdAction`; confirm shows household card and "current membership ends today, new tier starts today, no fee pledge is created".
   - "Add Anita, 14, daughter to the Mehta family" - WRITE (child T1; adult with email/mobile T2). `addPersonAction` → `staff_add_person`; probe for duplicates first (B11).
5. **Visual vs fresh design**: keep the dense sortable table, chips and the drawer for scanning many families and comparing rows. Fresh design: filter via natural language into chips ("West zone, Life, owes > $500" shown as removable chips), saved views, the drawer as the single record surface with all tabs, bulk actions on selected rows (e.g. zone change) with a preview.
6. **Rules**: balances in cents; household card shown for any pick; "You don't have access" for no-permission users; export gated by `record_export` + step-up when built.

## S5. Household record `/households/[id]` (page + 6 tabs)

1. **Route / who**: same as S4; money tabs need `giving.view`-class access and the Giving module on; Audit tab needs `audit.view`.
2. **Jobs**: understand one family completely (who, IDs, tier, pledges, payments, history); fix identity and IDs; record payment; merge; mark primary after a death.
3. **Pattern and friction**: header actions (History, Record payment, Merge duplicate, Edit household), identity strip (household no., org household ID, primary member + org person ID, zone, membership, open pledges + last gift), Preferences and Recent activity cards, QuickBooks customer line, "More details" custom fields, then a tab strip: Members, Identifiers, Memberships, Pledges, Payments, Audit. Each tab is a separate server component with its own queries (up to 500 rows, no paging, no filter). Payments tab computes year-end statements via `year_end_statement` RPC (up to 3 years). Friction: pledges and payments are read-only here (to request a refund or write-off you must find the pledge/payment elsewhere; the Home task links back to `?tab=payments`); Members tab links to the full person page; a household that lost its primary shows a "Choose a new primary member" alert with a select and a free-text reason (default text prefilled); four different "history" views (Recent activity card, History button, Audit tab, per-person activity).
4. **Assistant**:
   - "Summarize the Mehta household: members, tier, what they owe, last gift" - READ. `loadHouseholdRecord` + `household_card` + pledges/payments reads (extract tab queries). No confirm.
   - "Who changed the Mehtas' address and why?" - READ. `record_history('households', id)` (needs `audit.view`).
   - "The primary member passed away, make Priya the primary" - WRITE T2. `setHouseholdPrimaryAction` → `set_household_primary(p_household, p_person, p_reason)`; reason required and goes in audit; confirm names both people with DOB/age and the household card.
   - "Request a $251 refund on receipt R-0431" - WRITE money T2. `requestRefundAction` (first person; a different `giving.approve` holder approves). Confirm shows receipt, payer household card, amount from tool, reason.
5. **Visual vs fresh design**: keep the identity strip and the money tables (dense, sortable, exportable). Fresh design: one timeline that merges activity, payments, pledges, applications and messages with filters; the tabs become sections of one scroll or a side panel; inline row actions on pledges/payments (request refund, write-off) instead of bouncing to Giving; assistant panel pinned beside the record with the household context.
6. **Rules**: household card on top of any action confirmation; money in cents; staff see only what RLS gives (finance volunteers see only payments they recorded, the page already says so).

## S6. Identifiers (panel inside S5 Identifiers tab and S8; `identifiers/actions.ts`, `components/identifier-forms.tsx`)

1. **Route / who**: view per kind (`canViewIdentifierKind`), change per kind (`canManageIdentifierKind`): `people.manage` for org person/household IDs, CRM, other; `giving.manage` for accounting, bank payer, payment provider. Membership coordinator and treasurer.
2. **Jobs**: record an ID another system uses (Neon, QuickBooks, a bank payer name, JSH person/household IDs); retire a wrong or moved one; find out who holds an ID.
3. **Pattern and friction**: grouped tables per kind, an add form (kind, system, value, label, notes, "Belongs to" target), a retire button per row. Friction: the add form needs the staff member to know kind vs system vocabulary; the "belongs to" choice can be rejected after submit (person-only vs household-only kinds); a duplicate value gives a clear error naming the holder (good) but the next step (retire it there) is manual; no bulk add; no preview of what the ID will match; no explanation that bank payer names are hints.
4. **Assistant**:
   - "JSH person ID 0417 belongs to Rahul Shah" - WRITE T1. `addIdentifierAction` (kind org_member, padded by rules). On duplicate, show the holder's card and offer retire-then-add as a two-step plan.
   - "Add Zelle name K M MEHTA to the Mehta household" - WRITE T2 (finance kind: changes how gifts are matched, `giving.manage`). Confirm states it is a hint and shows the household card.
   - "Retire the old Neon ID on the Shah record" - WRITE T1 (soft retire, kept in history). `retireIdentifierAction`.
5. **Visual vs fresh design**: keep the grouped tables (audit-friendly). Fresh design: "paste anything" box that classifies the identifier and proposes the target; "who is this ID?" lookup inline.
6. **Rules**: finance kinds hidden from people-only roles (this is a read permission, enforced by RLS); never auto-learn payer names from DAF originators (backend rule, keep).

## S7. People list `/people` (`people/page.tsx`)

1. **Route / who**: `people.view` or `people.manage`. Membership coordinator, event and Pathshala staff for lookups.
2. **Jobs**: find a person by name, phone, email or member ID; filter by age band or team; open to edit.
3. **Pattern and friction**: search (LiveSearch, debounced), chips (All, Adults, Under 18, Seniors 65+, On a team or role), 50-row table (ID + org IDs, name, relationship, household with number, age, on app, contact "Via parents" for minors), row opens person drawer (edit profile in place, make primary, move, full record, disabled "Printed sign-in code"). Friction: "Mark as deceased" and "Undo" exist only on the full page; the drawer's edit form needs MM/DD/YYYY and phone formats typed by hand; `listPeople` uses direct queries and `teamPersonIds` reads roles, volunteers and teachers separately; "On a team or role" can be partial and the page says so in a note (good).
4. **Assistant**:
   - "Which adults in the Katy zone aren't on the app?" - READ. needs list tool with filters (today inline; `app.people_list` exists but unused).
   - "Update Priya's mobile to 713-555-0142" - WRITE T1. `updatePersonAction`; `normalizePhone`/`parsePersonForm` give validation; preview diff; sign-in contact change is worth a one-line warning.
   - "Make Neel (24) the primary of his own household" - WRITE T2. `makePrimaryAction` → `make_primary_of_own_household` (creates a household and a community membership; refuses under 18).
5. **Visual vs fresh design**: keep the table + drawer. Fresh design: natural language filters as chips; a person drawer that includes everything on the full page (deceased flag, identifiers) so the page can go.
6. **Rules**: minors' contact "through parents"; DOBs for minors are currently visible to all `people.view` (planned `people.children` masking); the assistant must not surface minors' details more widely than the screen does.

## S8. Person record `/people/[id]`

1. **Route / who**: `people.view`/`people.manage`; edit `people.manage`; History needs `audit.view`.
2. **Jobs**: see everything about one person; edit; move household; merge; record a death or undo it; manage identifiers.
3. **Pattern and friction**: identity strip (member no., org ID, status badges, app login), Profile definition list (read-only; editing opens the drawer), Households card, Roles/Teams/Waivers, Account, QuickBooks line, profile details (interests), More details, Memberships held, Identifiers. Mark as deceased is a drawer form with date, note, reason and a checkbox; Undo needs a reason. Friction: view and edit are on different surfaces (page vs drawer opened on the page); the account card repeats what the drawer shows; two "activity" presentations.
4. **Assistant**:
   - "Record that Mr. Jayesh Mehta passed away on Oct 3, his son called" - WRITE T2. `markDeceasedAction` → `mark_person_deceased` (date, note, reason, confirm). Confirm lists what happens (no messages, leaves directory and counts, memberships end, undoable) and names the household and primary-member consequence (it triggers the new-primary prompt).
   - "Undo that, wrong person" - WRITE T2. `undoDeceasedAction` → `undo_person_deceased` (reason required).
   - "Move Neel from the Mehta family to Priya Shah's household" - WRITE T2. `movePersonAction` → `move_person_household`; picker shows two household cards; "pledges and payments stay with the original household".
5. **Visual vs fresh design**: keep key facts and the memberships table. Fresh design: single person card with inline-editable fields and a compact timeline; roles/waivers/account as chips.
6. **Rules**: household picks use cards (`HouseholdPicker`); reason is audited.

## S9. Directory and expertise `/people/directory`

1. **Route / who**: `people.view`/`people.manage`. Membership coordinator, community leads.
2. **Jobs**: see who is in the member directory and who offers expertise; open a member.
3. **Pattern and friction**: four KPI tiles (one reads "not recorded yet"), a table of up to 200 listings (member, areas, headline, visible-to), a Rules note. No actions at all besides opening a person; page text admits there is no review step. Household shown by name only.
4. **Assistant**:
   - "Who can advise students on tech careers?" - READ. directory listing data (`app.directory_listing`; only verified members, opted in). No confirm.
   - "Take Mr. Patel's expertise listing off the directory" - WRITE T1. `updatePersonAction` with `expertise_opt_in=off` (staff can turn a listing off from the profile).
5. **Visual vs fresh design**: mostly a lookup, so answering questions beats browsing. Keep a simple browse for completeness.
6. **Rules**: contact details stay hidden until the member replies; do not show anything the member app would not show to other verified members.

## S10. Merge duplicates `/people/merge`

1. **Route / who**: `people.manage` (`householdsEdit`). Membership coordinator.
2. **Jobs**: review suggested duplicates; compare two records; merge and keep the right one; say "not a duplicate".
3. **Pattern and friction**: three modes selected by query string: candidate queue; person merge (step 1 pick, step 2 compare with checkboxes "Use this" per field and a reason); household merge (household cards side by side, reason). Merge is irreversible "here" and step-up protected (migration 0154). Friction: candidate queue and person step 1 show names only (no household, no cards) for people; household queue shows two bare display names; the person compare shows no household memberships, pledges or payments of either record; "swap kept record" is a link that reloads; if the duplicate signs in, the page tells you to swap; both signing in needs "the platform team".
4. **Assistant**:
   - "Are there likely duplicates of Rahul Shah?" - READ. `merge_candidates` + search; return with household cards for both.
   - "Merge the second Rahul Shah into the first, keep the first's email" - WRITE T2 (irreversible, step-up). `mergePeopleAction` → `merge_people(p_keep, p_drop, p_take)`. Needs a preview function (B6): fields differing, memberships and household links that move, the sign-in warning.
   - "These two Shah families are different" - WRITE T1. `dismissDuplicateAction`.
5. **Visual vs fresh design**: this is the one screen that must stay a visual side-by-side (field-by-field compare with checkboxes, household cards beside each). The assistant should pre-fill the choices and explain "why I think these are the same" (shared email, same DOB, same address), the human confirms.
6. **Rules**: households never by name alone (fix the queue); reason optional today but encouraged; step-up modal.

## S11. Family change requests `/people/requests`

1. **Route / who**: view `people.view`/`people.manage`; decide `people.manage`. Membership coordinator.
2. **Jobs**: approve or decline requests members send from onboarding or the Family tab (add a member, change a relationship, remove a member, move to a new household).
3. **Pattern and friction**: "Needs a decision" table (household name link, requester, kind, summary, sent, Approve with a relationship select + Decline) and "Recently decided". Friction: household by name only; relationship must be picked even to approve a "change relationship" request that already names it; Decline always sends reason "Declined by staff" (hidden field), so the member gets no real reason; **kinds `remove_member` and `new_household` can neither be approved nor declined here** ("Not supported here yet"); requests that add an adult give that person sign-in access to the household.
4. **Assistant**:
   - "Show me pending family requests" - READ. no confirm.
   - "Approve the request to add Meena as the Shah family's daughter-in-law" - WRITE T2 if adult. `decideHouseholdRequestAction` → `decide_household_change_request(p_request, 'approve', p_role)`; confirm shows household card, the requester and what they submitted.
   - "Decline it, we need her birth certificate first" - WRITE T1. same RPC with a real reason (this fixes the "Declined by staff" gap).
5. **Visual vs fresh design**: keep the queue as a list with the request detail beside the household card; add the missing kinds or route them to a guided flow.
6. **Rules**: household card on every row; reason on decline.

## S12. Voting eligibility `/people/voting`

1. **Route / who**: view `people.view`/`people.approve`; decide `people.approve`. Gated by the Membership module. Executive committee and membership coordinator.
2. **Jobs**: see who may vote, why not, and who can become eligible; request or approve an override; export the voter list (disabled).
3. **Pattern and friction**: 4 KPI tiles, "Life-member households" table (row opens household drawer), "Voters and overrides" table with an override control per row: request (inside `<details>`, chips + required reason), approve (a different person), apply (anyone with `people.approve`) = three separate clicks by at least two people. Friction: Voters table shows household by name only; a long table with no paging; the status is from a nightly check so a fix (pay a pledge) does not show until tomorrow; Export disabled; ballot cutoff comes from rules JSON (`voting.ballot_cutoff`) with no editor link besides "Center rules".
4. **Assistant**:
   - "Why isn't Ramesh Vora eligible?" - READ. `eligibility_snapshots` reasons + pledge status; give the household card. No confirm.
   - "Who becomes eligible if they pay open pledges before cutoff?" - READ. `loadVoting` (`canBecome`); needs giving permission, else say so.
   - "Request an override to mark Ramesh eligible, he paid by check yesterday" - WRITE T2 (eligibility is a permission-like right). `requestOverrideAction`; reason required (min 5 chars); a different `people.approve` holder approves via `approveAsSecondAction`; then `applyOverrideAction`.
5. **Visual vs fresh design**: keep the two tables (audit and review). Fresh design: a single "exceptions" worklist (not eligible but requested, awaiting second approver, ready to apply) with the evidence inline.
6. **Rules**: two-person (DB trigger `two_person_eligibility`), reason mandatory.

## S13. Membership applications `/memberships/applications` (+ application drawer)

1. **Route / who**: view `people.view`/`people.approve`; decide `people.approve`; EC step needs the executive-committee role or owner (`passesRoleChecks`). Membership coordinator, executive committee.
2. **Jobs**: review yearly and life applications; check the reference; approve (center review, then EC for life); decline with a reason.
3. **Pattern and friction**: status chips (Needs a decision, Awaiting reference, Reference declined, Approved, Declined/expired, All), table (ID, applicant + household + number + org ID, tier, reference, reference status, fee, status, age in days), drawer with Reference, Checks (reference tier rule, reference outside household, duplicate check, fee), Final approval, Decline. Friction: the checks are computed inside the page (not an RPC), so the list cannot show "fails the tier rule" in the row; two-step approvals (center, then a different EC member) are driven by `planDecision` in TS (the DB trigger in 0501 enforces the same order); ID shown is the first 8 characters of a UUID; fee wording mixes "authorized", "captured on approval" and "pledged on approval", while approval actually records an open pledge ("card payment is not connected yet"); the "Rules in effect" card repeats this in prose; age turns red after 14 days (good); the list is paged at 40 and ordered oldest first.
4. **Assistant**:
   - "Which applications are waiting more than two weeks?" - READ. no confirm.
   - "Does Hiral Shah's life application pass?" - READ. needs the checks as a function (reference tier, outside household, duplicate candidates) rather than page code.
   - "Approve Hiral's yearly application" - WRITE T2 (grants membership and creates a fee pledge). `decideApplicationAction` (`decision=approve`); confirm shows applicant, household card, tier, fee in cents, and what the next step is (EC). Cannot be used for the EC step by the same person who did the center step.
   - "Decline it, reference doesn't know the applicant" - WRITE T2. reason required (kept on the application).
5. **Visual vs fresh design**: keep the queue table and the drawer with the checks (review needs the evidence next to the decision). Fresh design: checks and duplicates as badges in the row; assistant drafts the decision note.
6. **Rules**: reason required for decline; two-person EC rule stays; household card in the confirm; fee in cents.

## S14. Approvals (`approvals/actions.ts`; no page)

1. **Route / who**: used from Home rows, household money tabs, Voting. `giving.manage` requests, `giving.approve` second approver, `people.approve` for eligibility, `giving.manage` for credits. Treasurer, finance volunteer (requests), second approver (owner or another approver).
2. **Jobs**: request a refund or write-off (first person); approve as a different person; record the refund or complete the write-off; refund through Stripe/PayPal; approve a refund made outside Weaver.
3. **Pattern and friction**: nine actions across one file; the state machine is a set of nullable columns (`refund_approved_by`, `refund_second_approver`, `written_off_by`...). The user sees it as a sequence across different screens with no single "this refund is at step 2 of 3" view. Home rows say "(you, so another approver is needed)". PayPal-by-email refunds need manual entry of date, transaction ID and reason.
4. **Assistant**: highest-value and highest-risk area, all T2: "Request a refund of $51 on R-0431 because the family overpaid" (`requestRefundAction`); "Approve what Meera requested" (`approveAsSecondAction`); "Write off the Desai pledge, they moved away" (`requestWriteOffAction`, then a different approver, then `completeWriteOffAction`). Provide a status view ("step 1 of 3, waiting for a second approver") as a READ. Every confirm: payment/pledge numbers, amounts from the tool, household card, reason, and the audit note.
5. **Visual vs fresh design**: keep approval queues visual with evidence; add a per-item progress tracker.
6. **Rules**: DB triggers refuse the same person twice; step-up via modal; integer cents.

## S15. Account › Security `/account/security`

1. **Route / who**: everyone signed in; staff of a community requiring 2FA are routed here until they pass it.
2. **Jobs**: set up or remove an authenticator app; enter a code; add and verify a mobile number; sign out everywhere.
3. **Pattern and friction**: Cards for 2FA, Mobile phone, Sessions, Lost your phone? Page copy is plain but long; "sessions" is a single button; says the sign-in service does not enforce the stated session length yet; no list of devices.
4. **Assistant**:
   - "Am I set up for two-step verification?" - READ. `my_security_status`. No confirm.
   - "How do I get back in, I lost my phone" - READ. explain the recovery path (another admin resets 2FA in Settings › Team; no recovery codes).
   - "Sign me out everywhere" - WRITE T2-lite. `signOutEverywhereAction`.
   - Never: enroll or remove an authenticator, take a TOTP code, or a phone verification code in chat.
5. **Visual vs fresh design**: keep as a small settings screen; the assistant only explains and deep links.
6. **Rules**: step-up codes only in the native modal.

## S16. Privacy requests `/settings/privacy` (`/privacy/requests` redirects here)

1. **Route / who**: `privacy.manage` (privacy officer). Requests are created by members (RLS policy `data_requests_insert`).
2. **Jobs**: triage export and deletion requests; meet the 30-day due date; mark started, completed (with export path) or rejected.
3. **Pattern and friction**: Tabs Open, Completed, Rejected, All; table (short ID, type, requester + member no., received, due with days left, status, handled by, action Start / Finish… / Back to open). Friction: no backend actually produces the export or performs the deletion in this repo (B8), so "Mark complete" only records a flag; staff paste an export file path by hand; **Reject** asks "The member should be told why" but there is no reason field and nothing tells the member; legal holds are "not tracked" (page says to keep a note outside the app); state transitions are a TS map; page title is "Settings".
4. **Assistant**:
   - "What data requests are due this week?" - READ. no confirm.
   - "Start the request from the Vora family" - WRITE T1. `updateDataRequestAction` (status in_progress).
   - "Reject this deletion, there is a legal hold" - WRITE T2 (deletion decision); must capture a reason and tell the member (needs a new action; today none).
   - "Export Priya's data" - cannot be done honestly until a processing service exists (B8).
5. **Visual vs fresh design**: keep the case list with SLA clocks. Fresh design: a case file per request (what exists for the person: households, payments retention, audit holds) and a checklist the assistant fills in, human signs off.
6. **Rules**: financial records kept 7 years, audit kept (copy on page); actions are audited.

## S17. Audit log `/settings/audit` (`/audit` redirects here)

1. **Route / who**: `audit.view`. Center admin, treasurer, privacy officer, owner.
2. **Jobs**: answer "who changed this and when"; review sensitive actions; investigate a complaint.
3. **Pattern and friction**: module chips, "More filters" (Action contains, Table, Record id (full UUID), Module (recorded), App, Reason, From, To), table (time, who, role, plain-sentence action with changed fields, module, app/screen), expandable details with before/after JSON and hash. Friction: two "module" concepts (chips derived from table names, plus a "Module (recorded)" select with param `mod`); raw table names and action codes in filters; record id must be pasted; roles of actors only show with `roles.manage`; Export log is disabled; page title "Settings".
4. **Assistant**:
   - "Who changed the Kapadia tier last month?" - READ. `audit_log` filtered by record/table and dates, or `record_history`. No confirm.
   - "Show every refund approval in September" - READ. filter `refund.*`/`payments` with module = giving.
   - "Export this as a file for the auditor" - needs the future export (B9); `record_export` + step-up + watermark.
5. **Visual vs fresh design**: keep the table (append-only evidence) and the hash/before-after drill-down. Fresh design: a natural-language filter over the same query (assistant translates "refunds by Meera in September" into chips), with the generated filter always shown so the result is checkable.
6. **Rules**: DOB, card references and secrets stay masked; the assistant sees only what `audit.view` gives.

---

## 2. Best assistant opportunities in these areas

1. **Front door search and disambiguation** (S3): "find / who is / whose is" across names and every identifier, always as household cards.
2. **Morning briefing and "resolve here"** (S2, S14): ranked tasks, evidence inline, second approvals with full context.
3. **Household and person upkeep** (S4, S5, S7, S8): add a person, change zone/address, update contact, set primary, record a death, move a person, each as preview then confirm.
4. **Application and request review** (S11, S13): checks as answers ("passes reference tier, 1 possible duplicate"), draft decision notes, decline with a real reason.
5. **Duplicates** (S10): the assistant proposes and explains; the human compares and confirms visually.
6. **Audit and "why"** (S17, S12, S16): natural-language questions over audit and eligibility.

## 3. Tool catalogue to build first (names illustrative)

READ: `find_households` (search + cards), `get_household`, `get_person`, `list_my_tasks`, `list_applications`, `check_application`, `list_family_requests`, `voting_status`, `list_privacy_requests`, `query_audit`, `record_history`.
WRITE T1: `update_household`, `update_person`, `add_child`, `dismiss_duplicate`, `start_privacy_request`, `add_org_identifier`, `retire_identifier`.
WRITE T2 (with propose then confirm): `change_tier`, `merge_people`, `merge_households`, `mark_deceased`, `set_primary`, `move_person`, `make_primary_own_household`, `add_adult_with_contact`, `decide_application`, `decide_family_request`, `request_override`, `apply_override`, `approve_second`, `request_refund`, `request_write_off`, `complete_privacy_request`, `add_finance_identifier`.
Each tool wraps the existing Server Action or RPC (same user client), returns `{ ok, error }` in plain English, and for T2 returns a preview first.
