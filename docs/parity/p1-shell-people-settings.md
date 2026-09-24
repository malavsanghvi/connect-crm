# Community Connect admin parity audit: prototype vs connect-crm and connect-admin
Scope: shell, Home, People, Settings, Platform, and brand strings. This was a read-only audit.

**Prototype source:** `connect-crm/docs/handoff/prototypes/source/AdminPortal.dc.html`. Line numbers below written as "P:NNN" point into this file.
- Markup: lines 21–232.
- Seed data: 242–362.
- Entitlements: 364–379.
- Roles: 380–396.
- `tasks()`: 491–509.
- `view()`: 510–698.
- `drawerVals()`: 700–767.
- `renderVals()` and `NAV`: 769–808.

**Screenshots:** in `/tmp/claude-0/audit/`. I rendered them as Center admin, and as Platform super-admin for the Platform screens.
- `00-login` and `01-home`.
- `10`–`14`: the five People tabs.
- `15-hh-drawer`, `16-hh-edit`, `17-person-drawer`, `18-app-drawer`.
- `20`–`27`: the eight Settings tabs.
- `29-export-modal`.
- `30-platform-centers` and `31-platform-wizard`.

The capture scripts are in the scratchpad (`shots.js`, `plat.js`).

## Headline findings

1. **Different navigation model.**
   - The prototype has one flat sidebar of 14 modules. Each module has in-page tabs, and records open in a right-hand drawer.
   - connect-crm has a grouped navy sidebar (Overview, People, Giving, Accounting, Oversight, Settings), one page per item, and full-page detail views.
   - connect-crm has no drawers, modals or toasts anywhere. connect-admin has none either.
2. **Most People and Settings screens in the prototype are missing from the app.**
   - People: the People tab, Directory & expertise, Voting eligibility, household edit, person edit, add person, merge, move household, make primary, printed sign-in code, and Export.
   - Settings: Rules as a form, custom roles and entitlement editing, Integrations, Onboarding fields, Notifications, Security.
   - All of Platform.
3. **Home is a different screen.**
   - The prototype shows "My tasks", a work queue from about 13 sources across all modules, next to an "At a glance" KPI column.
   - The app shows 5 stat tiles plus a "Waiting for second approval" table.
   - About 8 of the 13 task sources live in connect-admin (comms, content, store, bolis, pathshala, events/volunteers, surveys).
4. **The permission model is coarser than the prototype's entitlements.** The prototype gates UI on `giving.amounts`, `people.children`, `people.merge`, `data.export` and `platform.super`. None of these exist in `lib/permissions.ts` or `docs/ROLES.md`.
   - As a result, the app cannot hide amounts from someone who can see giving, or mask children's details.
   - `app.roles` has no `center_id` (migration 0001, ~line 173). So "Clone as custom" and per-center custom roles need a schema change.
5. **Brand.** Every user-visible brand string says "Connect CRM" or "Connect Admin". The prototype says "JSH Admin Portal" / "JSH Admin". The target is "Community Connect", with "Jain Society of Houston" shown as the tenant.

---

## Brand strings (all must change)

| Where | Current string | Change to |
|---|---|---|
| connect-crm `src/app/layout.tsx:20` | `title: { default: "Connect CRM", template: "%s · Connect CRM" }` | "Community Connect", "%s · Community Connect" |
| connect-crm `src/app/layout.tsx:21` | description "System of record for households, memberships, giving and accounting." | Portal description |
| connect-crm `src/components/shell/app-shell.tsx:39-40` | Sidebar "Connect CRM" / "System of record" | Community Connect wordmark plus tenant logo (see shell) |
| connect-crm `src/app/login/page.tsx:25-27` | eyebrow "Connect", h1 "Connect CRM", "Households, memberships, giving and accounting" | See Login below |
| connect-crm `src/app/login/page.tsx:33` | "Staff sign in with the email on their Connect account…" | "…their Community Connect account…" |
| connect-crm `src/app/login/login-form.tsx:16` | "No Connect account uses this email… your Connect account…" | Community Connect |
| connect-crm `src/components/setup-screen.tsx:8,10,43` | "Connect CRM needs to be configured", "Connect Supabase project", eyebrow "Connect CRM" | Community Connect |
| connect-crm `src/app/(app)/layout.tsx:28` | "Connect CRM could not start" | "Community Connect could not start" |
| connect-crm `src/lib/session.ts:143` | Error text "Connect CRM is not configured yet…" | Community Connect |
| connect-crm `settings/roles/actions.ts:91`, `grant-form.tsx:123` | "signed in to Connect" | "…Community Connect…" |
| connect-crm identifier labels (`lib/identifiers.ts:13,15`, `households/page.tsx:42,284`, `[id]/page.tsx:119`, `members-tab.tsx:57`, `people/[id]/page.tsx:97,217`, `identifiers-panel.tsx:73`, `household-card.tsx:63`) | "Connect number", "Connect member no.", "Connect household no." | Product decision. These are ID names, so they can stay "Connect no." or become "Community Connect no.", but pick one |
| connect-admin `src/app/layout.tsx:9-10` | "Connect Admin", "%s · Connect Admin", "Operations console for Pathshala, events…" | Retire, or rename to Community Connect until merged |
| connect-admin `(console)/layout.tsx:18,36` | "Connect Admin" (error header and sidebar) | Same |
| connect-admin `login/page.tsx:19`, `setup/page.tsx:19` | eyebrow "Connect Admin" | Same |
| connect-admin `components/ui.tsx:133`, `no-access/page.tsx:11`, `pathshala/actions.ts:140,180` | "…Connect Admin…" | Same |
| connect-admin `login/actions.ts:24`, `events/actions.ts:275`, `pathshala/actions.ts:153`, `attendance-sheet.tsx:319`, `announcements/page.tsx:53` | "Connect login", "Connect app" | "Community Connect" (the member app name) |
| Prototype `P:4` `<title>`, `P:28`, `P:59` | "JSH Admin Portal", "JSH Admin" | Reference only; the real product must read "Community Connect" with the JSH logo and name as tenant |
| Favicons | Both apps use the default `favicon.ico`. connect-admin `/public` holds only Next.js starter SVGs. Neither app has the `jsh-mark.png` logo. | Add the tenant logo from `center.branding.logo_url` or an asset, and a Community Connect favicon |

---

## A. Portal shell

### A1. Login (prototype `isLogin`, P:24–54). App: `connect-crm/src/app/login/page.tsx`, `login-form.tsx`

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Layout | Two columns. Left panel is 560px, navy `#1B2C5C`. Right panel is the form. | Single centered card, `max-w-md` (page.tsx:22-35) | DIFFERS |
| Logo | White 72px rounded tile with `assets/jsh-mark.png` (P:27) | None | MISSING |
| Title | "JSH Admin Portal" in Fraunces 38px (P:28) | "Connect CRM" in text-3xl navy | DIFFERS (should be "Community Connect" plus tenant) |
| Pitch copy | "Run memberships, events, giving, bolis, the store, Pathshala, communications and accounting in one place. You see only what your role allows." (P:29) | "Households, memberships, giving and accounting" | DIFFERS |
| Footer copy | "Every sign-in, approval and export is recorded in the audit log. / Sensitive actions ask for a fresh code." (P:31) | none | MISSING |
| Heading | "Sign in", Fraunces 28 | "Sign in", text-xl (login-form.tsx:107) | MATCH (size differs) |
| Field | "Work email or mobile", 50px high, radius 12 (P:36) | "Email", type=email only (login-form.tsx:108-121) | DIFFERS: no phone/SMS sign-in |
| Code field | "6-digit code sent to your email", 20px, letter-spaced (P:38) | "Enter your code" heading plus "Code from the email", accepts 6–12 digits | DIFFERS (copy) |
| Button | Pill, 52px: "Send code", then "Verify and sign in" (P:40, 785) | Rounded-lg: "Email me a code", then "Sign in" | DIFFERS |
| Note | "Admins sign in with a one-time code, then Face ID or a passkey on trusted devices." (P:41) | "Staff sign in with the email on their Connect account. We email a sign-in code — no password." | DIFFERS; passkey not implemented |
| Persona picker | "PROTOTYPE · SIGN IN AS A PERSONA" (P:44-50) | n/a | Prototype-only. Do not port, or make it a dev/demo-only feature |
| "PROTOTYPE · SAMPLE DATA · NOT LIVE" ribbon | P:22 | n/a | Do not port |

### A2. Top header (P:57–64). App: `components/shell/app-shell.tsx:46-64`, `user-menu.tsx`

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Bar | 60px, white, bottom border `#E3D9C8` | min-h-16 (64px), translucent `bg-ground/95` with backdrop blur, sticky | DIFFERS |
| Logo | jsh-mark 36px | none | MISSING |
| Wordmark | "JSH Admin", Fraunces 18 navy | Brand is in the sidebar only. The header shows `center.name` plus "{short_name} · {time_zone}" (app-shell.tsx:57-60) | DIFFERS. Prototype has no timezone line (EXTRA-IN-APP) |
| Center pill | "Jain Society of Houston". For `platform.super` it reads "Center: Jain Society of Houston ▾" and clicking it opens Platform/Centers (P:60, 792-793) | none | MISSING |
| Global search | 460px pill, placeholder "Search households, people, pledges, events…" (P:61) | none. Search exists only on the Households page. | MISSING |
| User block | Initial avatar 34px, name (13px bold), **role name** under it (P:62) | `<details>` dropdown: initials avatar, name, ▾. The panel lists email, a "ROLES" list, and a Sign out button (user-menu.tsx) | DIFFERS: role not visible in bar; sign-out hidden in dropdown |
| Sign out | Plain text button in bar. Click logs to audit and returns to login (P:63, 795) | Button inside dropdown; "Signing out…" | DIFFERS |

### A3. Sidebar and role-based menu (P:67–73, NAV P:788). App: `app-shell.tsx:17-43`, `lib/permissions.ts:146-192`, `nav-link.tsx`

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Style | White, 220px, right border `#E3D9C8`, padding 12/10 | Navy `bg-navy`, 256px, white/80 text; section headings in uppercase white/50 | DIFFERS (major visual) |
| Structure | Flat list of 14: Home, People, Events, Giving, Bolis, Satvik Store, Pathshala, Content, Calendar, Communications, Accounting, Reports, Settings, Platform | Grouped. Overview›Dashboard; People›Households, Membership applications; Giving›Pledges, Payments, Bank reconciliation, Campaigns, Recurring gifts, Statements; Accounting›QuickBooks; Oversight›Reports, Audit log, Privacy requests; Settings›Roles and access, Center settings | DIFFERS. Missing modules: Events, Bolis, Satvik Store, Pathshala, Content, Communications (all in connect-admin `lib/nav.ts`), Calendar (nowhere), Platform (nowhere) |
| Item style | 40px tall, radius 10, 14px. Active: bg `#EEF1F8`, fg navy, weight 800. Inactive: `#3D3A33`, 600. | min-h-11, radius 8, 15px. Active `bg-white/15`. | DIFFERS |
| Home badge | Saffron `#C9731C` pill with task count (P:69, 797) | none | MISSING |
| Footer | "{Role} · {N} entitlements. Menus, data and buttons follow your role, and the server enforces the same rules." (P:72, 798) | none | MISSING |
| Gating | People: `people.view`. Events: `events.view`. Giving: `giving.view`. Bolis: `bolis.manage`. Store: `store.manage`. Pathshala: `pathshala.manage`. Content: `content.edit` or `content.approve`. Calendar: `settings.rules`. Comms: `comms.compose`. Accounting: `acct.sync`. Reports: `reports.view`. Settings: `settings.audit`, `.rules`, `.roles` or `.privacy`. Platform: `platform.super` (P:788, 797). | `ACCESS` map (permissions.ts:59-96) against app permission strings | DIFFERS: needs a mapping. There is no `platform.super` (the app uses `is_platform_admin`). There are no `giving.amounts`, `people.children`, `people.merge` or `data.export`. |
| Mobile | none (fixed 1440 canvas) | `<details>` "Menu" drawer below `lg` | EXTRA-IN-APP (keep) |
| Page-level no-access | Server returns 403 and a red toast "403 · Missing entitlement X" (P:408) | `NoAccess` panel "You don't have access to this area" listing permissions (ui.tsx:139-151) | DIFFERS (app is fine; keep) |
| "No staff roles" banner | n/a | app-shell.tsx:67-72 | EXTRA-IN-APP |

### A4. Page header, tabs, content grid

| Element | Prototype | App (`components/ui.tsx`) | Verdict |
|---|---|---|---|
| Title | Fraunces 28px / 600, **ink `#1E1C18`** (P:77) | h1 text-3xl (30px), **text-navy**, tracking-tight (ui.tsx:22) | DIFFERS (colour and size) |
| Subtitle | 13px `#5E5A52` | 15px muted, max-w-3xl | DIFFERS |
| Eyebrow / back link | none (drawers instead) | `eyebrow` "← Households" | EXTRA-IN-APP |
| Page actions | Pill buttons, radius 20, min-h 40, 13px/700 (P:78) | `buttonClass` radius 8, min-h-11 | DIFFERS |
| Tabs | Module tabs driven by `sub`. Each is a button, 3px bottom border navy when active, 14px/700, min-h 42; row has a bottom border `#E3D9C8` (P:80-84). Shown only when there are more than one. | `Tabs` component: links with a 2px border, 14px/600, min-h-11 (ui.tsx:198-218). Used for sub-views (application status, grants, privacy status, household sections), not module sections. | DIFFERS: the tab row is the same pattern with a different weight and border, but the tab *sets* differ (see screens) |
| Loading | Shimmer skeleton blocks of 90px and 260px on every route change (P:85-87) | No `loading.tsx` in either app | MISSING |
| Content grid | 12-column grid, 16px gap. Blocks span N columns (P:89-91). | Ad-hoc Tailwind grids per page | DIFFERS |
| Block / card | White, **radius 16**, border `#E3D9C8`, padding 16/18. Head title is **DM Sans 16px/700** plus a 12px hint; actions are pill buttons; no divider (P:91-96). | `Card`: rounded-xl (12px), border `#E8E0D2`, header with **border-b**, **Fraunces 18px** title, 20px padding (ui.tsx:30-59) | DIFFERS |
| KPI tile | Background `#FBF7F0`, radius 12, label 12/600, value **24px/800 DM Sans** in accent colour, sub 11px (P:100) | `Stat`: card with a 4px coloured **top border**, value **Fraunces text-3xl ink**, clickable link (ui.tsx:162-196) | DIFFERS |
| Note block | 13px `#3D3A33` text in a card with a title ("Rules in effect" etc.) (P:176) | Alert/info boxes | DIFFERS |

### A5. Tables (P:117–134, builder `T()`/`blk()` P:475-484)

| Aspect | Prototype | App (`globals.css` `.crm-table`, lines ~40-80) | Verdict |
|---|---|---|---|
| Header | Separate rounded row (radius 10) with background `#F6F2EA`, 11px/700, uppercase copy, letter-spacing .04em | `<thead>` background `#F4EFE6`, 12px/600, uppercase, not rounded | DIFFERS (minor) |
| Rows | 13px, padding 9/10, border `#F1E8D8`. **The whole row is clickable and opens the drawer.** Highlight row background is `#FFF8EC`. | 14px, padding .6/.75rem, hover `#fdfbf7`. Only the name link is clickable and navigates to a page. | DIFFERS |
| Row actions | Right-aligned pill buttons ("Open", "Review", "View", "Approve", "Return"), radius 14, min-h 30, 12px/700 | Mostly none; inline ActionForms in some queues | DIFFERS |
| Filters | Chip row above the table (pill, 32px, navy border; the selected chip is filled navy) (P:120) | GET `<form>` with `<select>`s and an "Apply"/"Search"/"Filter" button (ui.tsx `FilterBar`, households/page.tsx:154-200) | DIFFERS |
| Footer | "Showing 14 of 1,184" text (P:132) | `Pagination` "1–50 of N" plus Previous/Next | DIFFERS (app pagination is better; keep it and restyle) |
| Empty state | 13px `#8A8478` text, e.g. "Nothing here right now" or "No one matches that search" | `EmptyState` centered title | DIFFERS (copy) |

### A6. Forms (P:136–151, drawer forms P:187-202)

| Aspect | Prototype | App | Verdict |
|---|---|---|---|
| Label | 12px/700 `#5E5A52`, above | `.crm-label` 13px/600 ink | DIFFERS |
| Text input | min-h 42, radius 10, border `#D9CFBE` | `.crm-input` min-h 44, radius 8, border `#D6CAB5` | DIFFERS (minor) |
| Enum input | **Chip group** (pill buttons; the selected one is filled navy) | `<select>` | DIFFERS |
| Boolean | **Toggle switch** 44×26, green `#1F7A4D` when on, with a state note ("Ask at checkout" / "Do not ask") | `<input type=checkbox>` | DIFFERS |
| Read-only value | "Info" box: background `#F6F2EA`, radius 10 | `DefinitionList` | DIFFERS |
| Buttons | Right-aligned pills: primary navy, ghost, ok green `#1F7A4D`, warn `#8A4608`, bad white with **`#B3261E`** red, off `#EDE6DA` (P:474) | `buttonClass` radius 8: primary, secondary, danger (**maroon `#7A2E1F`**), ghost, success (ui.tsx:255-269). Buttons are left-aligned inside ActionForm. | DIFFERS (shape, red hue). connect-crm has no `#B3261E` token; connect-admin has `--color-danger: #b3261e`. |
| Dirty-state save | "Save N changes" / disabled "No changes" (off style) (P:731, 740) | Always "Save settings" etc. | MISSING |

### A7. Detail drawer (P:183–212)
The prototype uses a **460px right-side panel**, pushing the content area, not overlaying it. It has:
- a kicker (11px/700 `#8A4608`, letter-spaced, e.g. "HOUSEHOLD · H-10421");
- a title (Fraunces 22) and sub-line;
- a round "×" close button (`aria-label="Close panel"`);
- an optional two-column form block with a heading such as "PROFILE · EDIT AND SAVE";
- sections of key/value rows (background `#FBF7F0`, radius 10). Clickable rows have a white background, a border and a pointer cursor;
- a footer bar of pill action buttons.

The drawer is used for households, household edit, people, applications, deposits and bolis.

**App:** no drawer component in connect-crm or connect-admin. Every record is a full page (`/households/[id]`, `/people/[id]`). **MISSING.**

### A8. Confirmation / step-up modal (P:217–227, `ask()` P:489)
The prototype modal:
- Centered, 480px, radius 22, dark scrim.
- Kicker, e.g. "STEP-UP VERIFICATION" or "TWO-PERSON APPROVAL · STEP-UP".
- Fraunces title and a body paragraph.
- An optional **verification-code input**.
- Buttons "Cancel" plus a coloured confirm ("Export", "Approve refund", "Issue code").

**App:** `ActionForm` uses a native `window.confirm(message)` (`components/action-form.tsx:72`), and there is no step-up code anywhere (no match for step-up, reauth or watermark in either app). **MISSING.** Step-up also needs a backend (fresh OTP check).

### A9. Toast (P:229–231, `flash()` P:458)
The prototype toast sits top-center at 72px. It is green `#1F7A4D`, or red `#B3261E` for errors, and auto-hides after 2.8s. Every action ends with one, e.g. "Rules saved · version 14" or "Household saved · CRM updated · audit logged".

**App:** inline `ActionMessage` success or error box under the form (`action-form.tsx:12-27`). No toast system in either app. **DIFFERS.**

### A10. Colours and typography summary

| Token | Prototype | connect-crm `globals.css` | connect-admin `globals.css` |
|---|---|---|---|
| Page background | `#F6F2EA` (app body), `#EDE6DA` (outer) | `--color-ground #fbf7f0` | `#fbf7f0` |
| Card / sidebar border | `#E3D9C8`; row divider `#F1E8D8`; input border `#D9CFBE` | line `#e8e0d2`, line-strong `#d6cab5` | line `#e8e0d2` |
| Soft panel | `#FBF7F0` (KPI and drawer rows) | subtle `#f4efe6` | sand `#f4efe6` |
| Danger | `#B3261E` | only maroon `#7a2e1f` | `#b3261e` ✓ |
| Muted-2 | `#8A8478`, `#3D3A33` body text | not defined | not defined |
| Fonts | Fraunces, DM Sans, **JetBrains Mono** (loaded, P:11) | Fraunces and DM Sans; mono is the system `ui-monospace` | Same as crm |
| Page title colour | ink | navy | ink ✓ |

---

## B. HOME (`route: 'home'`, P:519–528, tasks P:491–509)
App route: `connect-crm/src/app/(app)/page.tsx` and `approvals-queue.tsx`. connect-admin `app/page.tsx` only redirects to a landing page (no home).

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Title | "Good morning, {first name}" | "Welcome, {first}" or "Dashboard" (page.tsx:137) | DIFFERS |
| Subtitle | "My tasks across every module you can act on" | "What needs attention at {center.name} today." (page.tsx:138) | DIFFERS |
| Layout | "My tasks" block spans 8 columns; "At a glance" spans 4 (single-column KPIs) | 5 stat tiles in a row, then an approvals table below | DIFFERS |
| My tasks header | "My tasks" with hint "{N} waiting · filtered by your entitlements" | none | MISSING |
| Task row | Coloured tag pill (e.g. Refund red, Deposits brown, Membership navy, Newsletter purple, Inbox/WhatsApp green `#2F5D50`, QuickBooks red, Event maroon), bold title, meta line, action pill(s) (P:107-111) | n/a | MISSING |
| Empty state | "All clear. Nothing needs you right now." | "Nothing is waiting for a second approver" (queue only) | DIFFERS |

Task sources, in prototype order (P:494–507):

| # | Task (gate) | Click behaviour | Where the data or flow lives today | Verdict |
|---|---|---|---|---|
| 1 | "Approve refund RF-… · $… · household" plus reason and requester; "(you, so another approver is needed)" (`giving.refund_approve`) | **Approve** opens modal "TWO-PERSON APPROVAL · STEP-UP" with a code, then POST, then toast "Refund … approved · refund receipt queued for QuickBooks". A 409 when the requester is the approver gives "The requester cannot also approve…" | crm `approvals-queue.tsx:126-157` table row with `RefundControls` → "Approve as second person" (`two-person-controls.tsx:134`) | DIFFERS: table not task list; no modal, no step-up code; two-person rule enforced by the DB ✓ |
| 2 | "{n} DAF or matching-gift checks to match / Arrived without full donor details" (`giving.match`) | Open → Giving tab 1 | crm stat tile "Unmatched bank lines" → `/giving/bank` (page.tsx:127) | DIFFERS (tile, not task) |
| 3 | "{Tier} membership · {who}" / "Reference … · … · $… authorized" (`people.approve`) | Review → People › Applications with the drawer open | crm tile "Pending membership applications" → `/memberships/applications` | DIFFERS |
| 4 | Newsletter: Approve "{name}" (`comms.approve`) | **Approve** (inline) → toast "Newsletter scheduled for tomorrow 7 AM"; **Open** → Comms | connect-admin `(console)/comms` | MISSING in crm home (must MOVE or query) |
| 5 | Inbox "{n} unassigned member questions" (`comms.inbox`) | Open → Comms tab 1 | connect-admin comms threads | MISSING |
| 6 | WhatsApp "{n} WhatsApp join requests" | Open → Comms tab 2 | connect-admin `comms/page.tsx:63` (`whatsapp_join_requests`) | MISSING |
| 7 | Content "{n} items awaiting approval" (`content.approve`) | Open → Content | connect-admin `(console)/content` | MISSING |
| 8 | QuickBooks "{n} QuickBooks exceptions / Month-end close is blocked until cleared" (`acct.sync`) | **Fix** → Accounting | crm tile "QuickBooks exceptions" → `/accounting/qbo?status=failed` | DIFFERS (tile) |
| 9 | Inventory "{n} items below reorder level" (`store.inventory`) | Open → Store | connect-admin `(console)/store` | MISSING |
| 10 | Event "Tapasvi Bahuman in 5 days · 3 volunteers missing signed waivers" (`events.manage`) | Open event → Events live check-in | connect-admin events/volunteers | MISSING |
| 11 | Feedback "Paryushan feedback: 212 responses…" (`events.manage`) | Review → Events › Feedback | connect-admin `comms/surveys` | MISSING |
| 12 | Bolis "2 digital bolis close Sat 9 PM" (`bolis.manage`) | Open → Bolis | connect-admin `(console)/bolis` | MISSING |
| 13 | Pathshala "17 Gyan Path sign-offs waiting… · 3 background checks expire…" (`pathshala.manage`) | Open → Pathshala | connect-admin `pathshala/signoffs` | MISSING |
| 14 | Dashboard "{n} community dashboard KPIs kept members-only" (`reports.public`) | Review → Reports › Public KPIs | nowhere | MISSING |
| 15 | Privacy "2 data requests in progress / Earliest due Oct 2" (`settings.privacy`) | Open → Settings › Privacy | crm `/privacy/requests` exists, but there is no task | MISSING |
| — | Write-off and voting-override second approvals | n/a in prototype | crm `approvals-queue.tsx:95-125, 158-181` | EXTRA-IN-APP (keep as task types) |

"At a glance" KPIs (P:521–525), each shown only if the user has the right gate:

| KPI | Prototype | App | Verdict |
|---|---|---|---|
| Households | "1,184", "+62 this year" (`reports.view`) | "Active member households" (yearly and life only) | DIFFERS: label; no "+N this year" |
| On the app | "71%", "Goal 80%" | none | MISSING |
| Given this year | "$1.84M", "Cash basis, QuickBooks"; masked "•••" and "Amounts hidden for your role" without `giving.amounts` | none | MISSING, and masking is impossible without a `giving.amounts` permission |
| Open pledges | "$612K", "1,019 pledges" | "Open pledges" with value and "{n} open pledges" | MATCH (style differs) |
| Next event RSVPs | "340 · Tapasvi Bahuman · Sep 27" | none (events data in connect-admin) | MISSING |
| Store orders this cycle | "115 · Pickup Sat and Sun" | none | MISSING |
| Pathshala students | "420 · 88% attendance" | none | MISSING |
| Unmatched bank lines / QuickBooks exceptions / Pending applications | appear as tasks in the prototype | stat tiles | EXTRA-IN-APP as tiles; convert to tasks |
| No-access tile | Single "Reports — Not in your role" | Every tile shows "No access / Needs …" | DIFFERS (prototype hides tiles you can't use) |

---

## C. PEOPLE (`route: 'people'`, P:529–545)
Prototype tabs (P:530): **Households · People · Membership applications · Directory & expertise · Voting eligibility**. All five share the page title "People".

App: no People module page and no tabs. Separate nav items: `/households`, `/memberships/applications`. There are also detail pages `/households/[id]` and `/people/[id]`. **Tabs MISSING. Title differs** ("Households" or "Membership applications", not "People").

### C1. People › Households (sub 0, P:531-535). App: `(app)/households/page.tsx`

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Title / sub | "People" / "1,184 households · 3,920 people · search, filter and open a household" | "Households" / "Every family record. Search by name, member name or email — or by any identifier: Connect number, …" (l.41-42) | DIFFERS |
| Page action | **Export** (needs `data.export`). Opens modal "STEP-UP VERIFICATION · Export households? · Exports are watermarked, expire in 24 hours and are recorded in the audit log." with code, then toast "Export ready · watermarked · expires in 24 h" | none | MISSING, and no `data.export` permission |
| Block title / hint | "Households" / "Children's details visible to your role" or "…hidden for your role" | none | MISSING |
| Filters | Chips: All, Life, Yearly, Community | Search box, Zone select, Membership select, "Search" and "Clear" buttons (l.154-200) | DIFFERS (app search and zone are EXTRA and useful; prototype puts search in the global header) |
| Columns | ID · HOUSEHOLD · ZONE · MEMBERSHIP · PEOPLE · ON APP · OPEN BALANCE · [Open] | Household (+city) · Connect no. · {orgHouseholdLabel} · Members ({orgMemberLabel}) · Zone · Membership · Open balance (l.283-289) | DIFFERS. MISSING: PEOPLE count, ON APP. EXTRA: Connect no., org id, member-name list, city. |
| Membership cell | Coloured bold text: Life green, Yearly navy, Community grey | `Badge`: life purple, yearly navy, other neutral; lowercase tier value (l.321-323) | DIFFERS (colour for Life; lowercase "life") |
| Open balance | Masked "•••" without `giving.amounts` | "—" with title "Needs a giving permission" | DIFFERS (gate) |
| Row click | Whole row plus "Open" button opens the **household drawer** | Name link goes to `/households/[id]` page | DIFFERS |
| Footer | "Showing 14 of 1,184" | Pagination 50/page | DIFFERS |
| Identifier-match alert | n/a | Info alert with matched identifiers (l.208-258) | EXTRA-IN-APP (keep) |

### C2. Household drawer (P:704–711). App: `/households/[id]` page (`[id]/page.tsx` plus 6 tab files)

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Kicker / title / sub | "HOUSEHOLD · H-10421" / "Shah, Priya & Rahul" / "Life members since 2012 · West zone · (713) 555-0142" | Eyebrow "← Households", title display_name, description = address or "No address on file" (l.98-106) | DIFFERS: no since-year, phone or tier in sub |
| Identity cells | n/a | Connect household no., org household id, Primary member, Zone, Membership, Open pledges + last gift (l.118-147) | EXTRA-IN-APP |
| Sections vs tabs | Stacked sections | Tabs: Members · Identifiers · Memberships · Pledges · Payments · Audit (l.23-30) | DIFFERS |
| "MEMBERS · TAP TO OPEN" | One row per person: "Priya Shah · Primary (· also primary of H-…)". Value: "Adult · on app/not on app", or for minors "Age 14 · DOB …", or "Under 18 · details hidden" without `people.children`. Click opens the **person drawer**. | Members tab table: Name (link to page), Connect member no., org id, Relationship + "Primary" badge, Age ("(minor)"), Contact, Status (Verified / Not verified / Left / Deceased) (members-tab.tsx:53-117) | DIFFERS. On-app status MISSING; child masking MISSING (app shows every age); Verified status is EXTRA |
| "+ Add a person to this household" | Row button (`people.edit`) → toast "Add person: name, relationship, date of birth; adults get an invite to sign in" | none | MISSING |
| "GIVING · HOUSEHOLD LEVEL" | "Open balance" (masked "••• requires 'See donor amounts'") plus the last 6 pledges "{campaign} · {Mon YYYY}" with "$paid / $amount" (green if closed, brown if open) | Pledges tab (Pledge no., Campaign, Source, Status, Amount, Paid, Open, Pledged, Due) and Payments tab | DIFFERS (app richer; no summary section) |
| "PREFERENCES AND CONSENT" | Directory Opted in/out; Photos; Physical mail; Signed-in on app Yes/No | Not shown. `directory_opt_in` is selected (l.61) but never rendered; `physical_mail_opt_in` exists in the DB. | MISSING |
| "RECENT ACTIVITY (AUDIT)" | 3 human rows ("Sep 20 · RSVP Tapasvi Bahuman — 4 people") | Audit tab: raw audit rows with before/after JSON (audit-tab.tsx) | DIFFERS (app technical; RSVP/boli activity not included) |
| Action: Record payment | `giving.record` → Giving with the household prefilled | none; `/giving/payments` has no household prefill param | MISSING |
| Action: Merge duplicate | `people.merge` → toast "Merge wizard: pick the duplicate, compare fields, confirm" | none (table `app.merge_candidates` exists) | MISSING |
| Action: Edit household | `people.edit` → household edit drawer | none | MISSING |
| Memberships / Identifiers tabs | n/a in drawer | memberships-tab.tsx, identifiers-tab.tsx | EXTRA-IN-APP (keep as sections) |

### C3. Household edit drawer (P:737–741). App: **MISSING entirely** (no household update action exists in connect-crm)

| Field | Type | Value / options | Rule |
|---|---|---|---|
| Household name | text, span 2 | current name | — |
| Street address | text, span 2 | e.g. "3810 Sample Ln, Katy TX 77494" | — |
| Main phone | text | h.phone | — |
| Member since | info | year | read-only |
| Zone | chips, span 2 | Southwest, West, Northwest, North, South, Central, Northeast | — |
| Membership tier | chips (Community, Yearly, Life) **only with `people.approve`** | else info "{tier} · changes need membership approval" | gated |

- Sections: "NOTES": "Tier changes — Normally through an application with a reference"; "Address changes — Update zone and zone lead automatically".
- Actions: **Back** returns to the household drawer. **Save N change(s)** or disabled "No changes" sends `PATCH /households/:id`, then toast "Household saved · CRM updated · audit logged", then returns to the drawer.
- Kicker: "EDIT HOUSEHOLD · H-…". Sub: "Changes sync to the CRM and are audited".

### C4. People › People (sub 1, P:536-541). App: **MISSING** (no `/people` index; only `/people/[id]`). connect-admin has `GET /api/people` → `lib/data/people.searchPeople` (picker search) that could back it.

| Element | Prototype | Verdict |
|---|---|---|
| Sub | "{N} people across {M} households · open anyone to view or edit" | MISSING |
| Search form (1 column) | Label "Search by name, phone, email or member ID"; placeholder "e.g. Shah, 555-0142, JSH-10423"; filters live as you type | MISSING |
| Filter chips | All · Adults · Under 18 · Seniors 65+ · On a team or role | MISSING |
| Columns | ID · NAME · RELATIONSHIP · HOUSEHOLD · AGE (minor age "•••" without `people.children`) · ON APP ("—" for minors) · CONTACT ("Via parents" for minors, else email or mobile) · [Open] | MISSING |
| Row click / Open | Person drawer | MISSING |
| Empty / foot | "No one matches that search" / "Showing up to 15" | MISSING |

### C5. Person drawer (P:712–736). App: `(app)/people/[id]/page.tsx`, a **read-only** page

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Kicker / title / sub | "PERSON · JSH-10421" / "Priya Shah" / "Primary · Shah, Priya & Rahul · age 41" (age hidden for masked minors) | Eyebrow "← {household}"; title name; description "Legal name: …" only when a preferred name exists | DIFFERS |
| Form title | "PROFILE · EDIT AND SAVE" (`people.edit`) or "PROFILE · VIEW ONLY FOR YOUR ROLE" | Card "Profile", DefinitionList, always read-only (l.123-137) | MISSING edit |
| First name / Last name | text | not shown separately (title only) | MISSING |
| Date of birth | text. Masked "••• requires 'View children's details'" for minors without `people.children` | not shown; Age shown instead ("{age} (minor)") | DIFFERS / MISSING mask |
| Gender | chips: Female / Male / Prefer not to say (masked "•••" for minors) | "Gender" text | DIFFERS |
| Relationship | chips, span 2: Primary, Spouse, Son, Daughter, Parent, Other | only on the Households card ("role · primary") | DIFFERS |
| Profession, Employer (matching gifts), Mobile, Email | text (adults only) | Profession, Employer, Email, Phone as text | DIFFERS (read-only; label "Phone" vs "Mobile"; "Employer" vs "Employer (matching gifts)") |
| Language | chips: English / Gujarati / Hindi | "English" / "ગુજરાતી (Gujarati)" / "हिन्दी (Hindi)" text | DIFFERS |
| Member directory | toggle "Listed" / "Not listed" | not shown | MISSING |
| Photos | toggle "Opted in" / "Opted out" | not shown | MISSING |
| Physical mail | toggle "Opted in" / "Opted out" | not shown | MISSING |
| Open to new members | toggle "Yes" / "No" | not shown (`new_member_contact_opt_in` in DB) | MISSING |
| Expertise | text, span 2 | not shown (`expertise_*` columns in DB) | MISSING |
| Minors only | "Contact — Through parents · no direct messages to minors"; "App access — Own login allowed (age rule) · no RSVP, bolis or payments" or "No own login yet" | none | MISSING |
| Section HOUSEHOLDS | "{hh} · member — Open" opens the household drawer, plus "Own household H-… · primary — Linked" | Card "Households" list with links, role, joined/left dates | MATCH-ish (EXTRA dates) |
| Section ROLES, TEAMS AND WAIVERS | Roles; Volunteer waiver "Signed v4 · Jan 2026" / "Not signed" / "Parent signs"; Background check | none (volunteer and waiver data in connect-admin/DB) | MISSING |
| Section ACCOUNT | App account "Active · last seen today" / "Not signed in yet" / "Managed by parents"; Member card "Rotating QR · {id}"; Sign-in methods | Identity cell "App login: Linked {date} / Not linked" (l.114-119) | DIFFERS (partial) |
| Section RECENT ACTIVITY (AUDIT) | Up to 3 audit rows plus RSVP | none on the person page | MISSING |
| Identity cells, Memberships held, Identifiers panel | n/a | l.95-120, 169-220 | EXTRA-IN-APP (keep) |
| Action: Save N change(s) / No changes | `PATCH /people/:id` → toast "Saved {first}'s profile · CRM updated · audit logged" | none | MISSING |
| Action: Make primary of own household | Adult, not already primary → creates a Community household, links the person as primary, keeps family membership; toast "{first} is now primary of H-… and stays in the family household" | none | MISSING |
| Action: Move household | toast "Choose the destination household; pledges stay with the original household" | none | MISSING |
| Action: Printed sign-in code | Modal "STEP-UP VERIFICATION · Issue a printed sign-in code? · Hand the code to {first} in person after checking ID. It works once within 24 hours." with code; button "Issue code"; toast "Code 7741-2290 issued · expires in 24 hours" | none | MISSING |

### C6. People › Membership applications (sub 2, P:544; drawer P:742-749). App: `(app)/memberships/applications/page.tsx`

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Title / sub | "People" / "Yearly and life memberships need a verified reference at the same tier or higher, then center approval" | "Membership applications" / "Yearly memberships need the named reference, then a center decision. Life memberships add an Executive Committee approval by a second person." (l.37-38) | DIFFERS |
| Status sub-tabs | none | Needs a decision · Awaiting reference · Reference declined · Approved · Rejected / expired · All (l.23-30) | EXTRA-IN-APP (keep, as chips) |
| Block title | "Applications" | none (bare card) | MISSING |
| Columns | ID · APPLICANT · TIER · REFERENCE · REFERENCE STATUS (green "Approved…", red "Not eligible…", brown pending) · FEE ("$501 authorized" / "captured") · STATUS · [Review/View] | Applicant (+ids) · Household · Tier (+type, "Needs EC approval") · Reference (+decision badge, expiry, note) · Fee · Status (+deciders, reason) · Age ("{n}d", red after 14) · Decision | DIFFERS: no ID; reference status merged into Reference; fee not shown as authorized/captured; EXTRA Household and Age |
| Row action | **Review** (primary, when "Final approval" and `people.approve`) or **View** → application drawer | Inline `DecisionControls` in the row: Approve / "Approve — send to EC" / "Record EC approval" (window.confirm for EC), plus "Reject…" details with a required reason (l.231-284) | DIFFERS |
| Drawer: REFERENCE | Reference; Decision; "Their note" | reference_note in cell | DIFFERS |
| Drawer: CHECKS | Reference tier rule Passes/Fails; Reference outside household Yes; Duplicate check "No match found"; Fee | none | MISSING |
| Drawer: FINAL APPROVAL | Approver: "Membership coordinator records EC approval" (Life) | App requires a **second, different** EC member | DIFFERS (app is stricter by design; confirm with owner and keep) |
| Decline | "Decline" (bad) → toast "Declined · fee authorization released · applicant notified" (no reason) | "Reject" with a required reason | DIFFERS (app better; relabel "Decline") |
| Approve | "Approve and grant" (ok) → toast "{Tier} membership granted · fee captured · household updated", closes drawer | "Approve" → inline success message | DIFFERS |
| Rules note | "Rules in effect: Yearly: reference must be a verified Yearly or Life member outside the household. Life: reference must be a Life member; EC approval recorded by the membership coordinator. Fees are authorized at application and captured only on approval. Configure in Settings › Rules." | none | MISSING |
| View-only notice | n/a | "You can view applications. Decisions need the people.approve permission." | EXTRA-IN-APP |

### C7. People › Directory & expertise (sub 3, P:542). App: **MISSING** (DB: `people.expertise_opt_in/_tags/_headline`, `households.directory_opt_in`, directory function in migration 0011 ~line 129)
- Sub: "Opt-in directory and expertise listings from member profiles · visible only to verified members".
- KPIs (4 columns):
  - "Families in directory 486": "opted in at onboarding or profile".
  - "Open to new members 212": "can be contacted by members who joined in the last 12 months".
  - "Expertise listings 64": "4 awaiting review".
  - "New-member contacts this month 37": "in-app messages".
- Table "Expertise listings awaiting review": MEMBER · AREAS · HEADLINE · VISIBLE TO · [Return (bad) / Approve (ok)] (needs `people.edit`). After a click the row shows a disabled "Returned" or "Approved". Approve POSTs `/config` and writes to the audit log.
- Note "Rules": "Contact details stay hidden until the member replies. Guidance is shared in a personal capacity and is not endorsed by the center. Members pause or remove their listing from their profile."
- **Schema gap:** there is no review status for expertise listings.

### C8. People › Voting eligibility (sub 4, P:543). App: **MISSING list**. DB has `eligibility_snapshots`; the app only shows override second-approvals in the Home queue (`approvals-queue.tsx:47-55, 158-181`).
- Sub: "Election eligibility computed nightly from membership and pledge data · rules set per center".
- Page action: **Export voter list** (`data.export`). Opens modal "Export eligible voter list? · Contains names and addresses of eligible life members. Watermarked, expires in 24 hours, audited." with code, then toast "Voter list exported".
- KPIs:
  - "Eligible voters 842": "both spouses in life-member households".
  - "Not eligible 106": "open prior-year pledges or under 180 days".
  - "Can become eligible 71": "by paying open pledges before cutoff".
  - "Ballot cutoff Oct 31": "set by the election committee".
- Table "Life-member households": ID · HOUSEHOLD · SINCE · PLEDGES ("Paid up" green / "Prior-year pledge open" brown) · TENURE ("Over 180 days" / "Under 180 days") · STATUS ("Eligible" green / "Not eligible" red).
- Note "Rules in effect": "Only adult spouses with life membership can vote. Life membership must be held at least 180 days before the election starts. All pledges, bolis and maintenance fees from prior calendar years must be paid. Members see their status and a checklist in the app."
- The app has an override request/approve flow. The prototype has no override UI, so the app flow is EXTRA; keep it on this tab.

---

## D. SETTINGS (`route: 'settings'`, P:667–682)
Prototype tabs (P:668): **Rules · Roles & entitlements · Integrations · Privacy · Onboarding fields · Notifications · Security · Audit log**. The title is always "Settings".

App: nav section "Settings" holds "Roles and access" (`/settings/roles`) and "Center settings" (`/settings/center`). "Audit log" and "Privacy requests" sit under **"Oversight"** (`/audit`, `/privacy/requests`). No tabs. **Four of the eight tabs are MISSING.**

### D1. Settings › Rules (sub 0, P:669). App: `/settings/center` (`page.tsx`, `center-settings-form.tsx`) edits a **raw JSON "rule bag" textarea** plus branding and feature flags

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Title / sub | "Settings" / "Center rules · each change is versioned and audited" | "Center settings" / "Tenant configuration: branding, which features are switched on, and the center's rules. A center adopts Connect through configuration, not code." | DIFFERS |
| Block "Membership and references" (span 6) | Yearly: reference tier → info "Yearly or Life". Life: reference tier → info "Life only". References required for Life → chips 1 / 2. Prior yearly membership for Life → chips None / 12 months / 24 months. Child's own login from age → chips 13 / 16 / 18. Reference request expires → info "14 days". **Save** → toast "Rules saved · version 14". | Only as JSON keys in `<textarea id="rules">` with a validation list (center-settings-form.tsx:100-128) | DIFFERS: no structured form |
| Block "Giving, bolis and privacy" (span 6) | Ask donors to cover processing fees → toggle "Ask at checkout" / "Do not ask". Payment allocation → info "Earliest open pledge first · preview shown". Boli ties → info "First recorded wins · all entries kept". Boli soft close → toggle "5 minutes" / "Off". Privacy defaults (span 2) → info "Directory, photos and physical mail asked as opt-in during onboarding". **Save** → "Rules saved · version 15". | JSON only | DIFFERS |
| Note "Lunch-slot rules" | "Families with a child under 12 or a senior eat together at lunch start. Other adults are slotted by arrival time, then RSVP order. Anyone who misses a slot may join any later slot. Slot length and seats are set per event." | none | MISSING |
| Rule versioning | "version N" | none (audit only) | MISSING |
| Center identity card | n/a | Slug, Short name, Time zone, Currency, Status (page.tsx:29-39) | EXTRA-IN-APP |
| Branding fields (primary/accent/background colour, display/body font, logo URL) | Only in Platform wizard (Logo, Primary color chips) | page form | EXTRA-IN-APP (move to a Branding sub-section) |
| Feature flags checkboxes | n/a | center-settings-form.tsx:82-98 | EXTRA-IN-APP |

### D2. Settings › Roles & entitlements (sub 1, P:670-673). App: `/settings/roles` (`page.tsx`, `grant-form.tsx`, `actions.ts`)

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Title / sub | "Settings" / "Granular entitlements for every module · default roles out of the box · custom roles for limited access" | "Roles and access" / "Access is role + scope. Center-wide grants carry the role's permissions; …" | DIFFERS |
| Roles table (span 4) | Columns ROLE · RIGHTS (count). Custom roles are suffixed " · custom". Clicking a row selects it (highlight). Foot "Default roles are read-only; clone one to customize". | "Role catalog" card at the bottom: Role (+key, description) · Tier · Default scope · Permissions (badge list) (l.179-221) | DIFFERS |
| Entitlement grid (span 8) | Title = role name. Hint "Default role · clone to change" or "Custom role · click to grant or remove" · N entitlements. Twelve groups in 3 columns (PEOPLE, EVENTS, GIVING, BOLIS, STORE, PATHSHALA, CONTENT, COMMUNICATIONS, ACCOUNTING, REPORTS, SETTINGS, PLATFORM), each a set of checkboxes with plain-English labels (P:366-377). Checkboxes can only be clicked on custom roles. | Badges of raw permission strings (`people.view` …) | MISSING |
| "Clone as custom" | Default role → creates "{name} (copy)", selects it | none; `app.roles` is global (no `center_id`) | MISSING (needs a migration) |
| "Save role" | Custom role → toast "Role saved · takes effect at next sign-in" | none | MISSING |
| Grant a role to a person | none in prototype (audit sample only: "Granted Event lead to Sanjay Sheth for EV-901 (expires Sep 28)") | "Grant a role" card with person search, role, scope, dates (grant-form.tsx). Grants table (Person, Role, Scope, From, Until, Granted by, Revoke) with sub-tabs Active grants / Ended / All. | EXTRA-IN-APP (required; keep, and fit it into the tab) |

### D3. Settings › Integrations (sub 2, P:675). App: **MISSING** (only a QuickBooks "Connection" card at `/accounting/qbo` page.tsx:121; table `app.integration_connections` exists)
- Sub: "Connected services for this center".
- Table: SERVICE · STATUS (green if Connected / Verified / Configured / Selected, else brown) · DETAIL · OWNER. Rows:

| Service | Status | Detail | Owner |
|---|---|---|---|
| QuickBooks Online | Connected | "Jain Society of Houston company · cash basis · renews automatically" | Treasurer |
| Payments | Connected | "Cards, ACH, Apple Pay, Google Pay, tap-to-pay · daily payouts" | Treasurer |
| Email sending domain | Verified | "jain-houston.org · sender records set" | Communications |
| US business texting (10DLC) | Registration submitted | "Carrier review in progress" | Tech officer |
| WhatsApp Business | Pending verification | "Number verification and message templates" | Communications |
| Push notifications | Configured | "Apple and Google" | Platform |
| Panchang source | Selected | "Shvetambar Murtipujak tables for 2026–2027" | Religious coordinator |
| Background checks | Not connected | "Choose a screening provider" | EC |

- No row actions.

### D4. Settings › Privacy (sub 3, P:676). App: `/privacy/requests` (under "Oversight")

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Title / sub | "Settings" / "Member data rights, retention and legal holds" | "Privacy requests" / "Data export, deletion and account requests from members. Each must be handled by its due date (30 days). Deletion removes app data; financial records are kept 7 years, then a…" | DIFFERS |
| Nav location | Settings tab | Oversight › Privacy requests | DIFFERS |
| Info alert | none | "Marking a request complete records the decision. The export bundle…" (l.67-72) | EXTRA-IN-APP |
| Status sub-tabs | none | Open · Completed · Rejected · All | EXTRA-IN-APP |
| Table "Data requests" | ID · TYPE ("Export" / "Delete account") · REQUESTER ("Vora family", "Former member · Golechha") · RECEIVED · DUE ("Due Oct 10") · STATUS ("In progress", "Waiting on household split") | Person (+member no., "asked by") · Request ("Export my data", "Delete my account", …) · Received · Due (+ "n days left/overdue") · Status badge · Handled by · Action (Start, "Finish…" → Mark complete with export path / Reject with confirm, Back to open) | DIFFERS: no ID; EXTRA workflow (keep) |
| Note "Deletion policy in effect" | "App login, preferences, practice history, special days and recordings are deleted. Donations, pledges and receipts are kept 7 years, then anonymized. The household stays for other members. Audit entries are kept. Children's data is deleted by a parent." | Partially in the page description | DIFFERS |
| Retention / legal holds | In the sub-line | none | MISSING |

### D5. Settings › Onboarding fields (sub 4, P:677). App: **MISSING**
- Sub: "What onboarding and profiles ask · privacy choices are always asked as opt-in or opt-out".
- Table (span 8), "Onboarding and profile fields": FIELD · APPLIES TO · SETTING · [Required | Optional | Hidden segmented pill buttons]. The current value is primary-filled. The setting cell is coloured: Required green, Optional navy, Hidden brown. Rows:

| Field | Applies to | Default | Controls |
|---|---|---|---|
| Name, relationship | Everyone | Required | Required / Optional / Hidden |
| Date of birth | Everyone | Required | Required / Optional / Hidden |
| Gender | Everyone | Optional | Required / Optional / Hidden |
| Profession | Adults | Optional | Required / Optional / Hidden |
| Employer (matching gifts) | Adults | Optional | Required / Optional / Hidden |
| Mobile and emails | Adults | Required | Required / Optional / Hidden |
| Contact channels and best time | Adults | Optional | Required / Optional / Hidden |
| Language | Everyone | Optional | Required / Optional / Hidden |
| Interests | Adults | Optional | Required / Optional / Hidden |
| Directory listing | Household | Required | disabled "Always asked" |
| Photo consent | Household | Required | disabled "Always asked" |
| Physical mail | Household | Required | disabled "Always asked" |

- Form "Family matching" (span 4, 1 column), all info fields:
  - "Match new sign-ins to households by": "Email or mobile on file".
  - "'Not my family' requests": "Go to the membership coordinator's queue".
  - "New households": "Community members until they apply for membership".
- Button **Save onboarding** → toast "onboarding fields · saved and audited". Gated by `settings.rules`.
- Could be stored in `centers.rules` JSON.

### D6. Settings › Notifications (sub 5, P:678). App: **MISSING** (`app.notification_topics`, `message_templates` exist)
- Sub: "Every automatic message, when it goes, and on which channel · members control topics and quiet hours".
- Table (span 8), "Automatic notifications": TRIGGER · WHEN · CHANNEL · ACTIVE (green "On"). Rows:

| Trigger | When | Channel |
|---|---|---|
| RSVP confirmation | 24 hours before | Push · SMS or WhatsApp for guests |
| Lunch slot reminder | 5 minutes before each slot | Push · SMS for guests |
| Special-day labh prompt | 2 weeks before | Push |
| Family celebration | When goal or level completed | Push |
| Saathi support request | After 3 days behind | Push to anumodana senders |
| Boli outbid / closing | On entry · 24 hours before cutoff | Push |
| Giving opportunity alert | On publish | Push · email |
| Pledge reminder | Monthly for open pledges | Email |
| Store order ready | At pickup time | Push |
| Event feedback request | Morning after the event · one reminder after 3 days | Push · SMS or WhatsApp for guests |
| Pachchakhan reminder | Member-set times | Push |

- Form "Global rules" (span 4):
  - "Quiet hours default": text "9 PM – 7 AM".
  - "Event-day reminders during quiet hours": toggle "Allowed".
  - "Languages": info "English, Gujarati, Hindi templates".
  - "SMS": info "Codes and time-critical reminders only · STOP honored".
- Button **Save** → toast "notification rules · saved and audited".

### D7. Settings › Security (sub 6, P:679). App: **MISSING**
- Form "Members" (span 6), no save button:
  - "Sign-in": info "One-time code by email or mobile · Face ID or passkey on trusted devices".
  - "Shared email or phone with a child": info "Every financial transaction needs a fresh one-time code".
  - "Child's own login": info "From the age set in Rules".
  - "Account recovery": info "Second verified contact, or in person at the office with ID".
  - "Printed sign-in codes": toggle "Staff can issue one-time codes in person".
- Form "Admins and volunteers" (span 6):
  - "Admin session length": text "8 hours · 30 minutes idle".
  - "Step-up code before": info "Exports, refunds, role changes, month lock, bulk views of children's details".
  - "Ops devices": info "Event PIN sign-in · kiosk lock · remote wipe · offline cache encrypted".
  - "Platform support access": info "Center consent, time-limited, visible banner, audited".
  - Button **Save security** (gated by `settings.roles`) → toast "security settings · saved and audited".

### D8. Settings › Audit log (sub 7, P:680-681). App: `/audit` (under "Oversight"), `components/audit-table.tsx`

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Title / sub | "Settings" / "Append-only, tamper-evident log · every action you take in this prototype appears here" | "Audit log" / "Every change to sensitive records, append-only and hash-chained. Dates of birth, card references and secrets are masked." | DIFFERS (app copy fine; adjust title and placement) |
| Page action | **Export log** (`data.export`) → step-up modal "Export audit log? · The export is watermarked and itself audited." → toast "Audit log exported" | none | MISSING |
| Filters | Module chips: All · Giving · People · Events · Comms · Accounting · Settings · Content · Store · Bolis · Reports | Form: Action contains, Table (24 raw table names), Record id, From, To, Filter/Clear (audit/page.tsx:86-132) | DIFFERS (app EXTRA date/record filters; add module chips mapped from `record_table`) |
| Columns | TIME ("Sep 22 10:05") · WHO · **ROLE** ("Treasurer") · ACTION (plain sentence, e.g. "Requested refund RF-104 ($251)") · MODULE | When · Who · Action (**raw code** like `payments.insert`, mono) · Record (table + short id link) · What changed (field list, reason, "Show before / after" JSON, hash) | DIFFERS: ROLE MISSING, MODULE MISSING, action not human-readable; EXTRA diff/hash (keep behind the expander) |
| Row count | First 18 | 50 per page with pagination | DIFFERS (fine) |
| Sign-in / sign-out entries | "Signed in (one-time code)", "Signed out" | Not audited (DB triggers only) | MISSING |

---

## E. PLATFORM (`route: 'platform'`, P:683–696). App: **MISSING entirely** in both apps. `centers` exists; there is no platform UI. The platform flag is `session.isPlatformAdmin`. The prototype shows Platform only with `platform.super`.

### E1. Platform › Centers (sub 0)
- Sub: "Super-admin console · support access is time-limited, needs center consent and is audited".
- Page action: **New center** (primary) → wizard tab.
- Table: CENTER · SLUG · STATUS (green "Live", else brown) · SIZE · TRADITION PACK. Rows:
  - Jain Society of Houston / jsh / Live / 1,184 households / Shvetambar Murtipujak.
  - Training sandbox / sandbox / Sandbox / Sample data / Configurable.
  - Design partner center A / partner-a / Onboarding · step 3 of 6 / Import pending / Sthanakvasi.
- No row actions.
- The header centre pill ("Center: Jain Society of Houston ▾") also navigates here.

### E2. Platform › New center wizard (sub 1)
- Sub: "Onboard a new center without developers".
- Step bar: 6 clickable steps with a 4px top line (navy when done or current): "1 · Branding", "2 · Tradition pack", "3 · Payments & QuickBooks", "4 · Import data", "5 · Roles & admins", "6 · Go-live checks".
- Form title = step name. Fields per step:
  1. Branding: Center name (text "Design partner center A"); Public URL (info "/c/partner-a"); Logo (info "Upload PNG or SVG"); Primary color (chips Navy / Maroon / Green / Saffron).
  2. Tradition pack: Tradition (chips, span 2: Shvetambar Murtipujak / Sthanakvasi / Terapanthi / Digambar); Includes (info "Sutras and audio, pachchakhan, Gyan Path goals, panchang tables · center can override").
  3. Payments & QuickBooks: Payments (info "Connect account · business verification"); QuickBooks (info "Sign in and authorize · map accounts"); Accounting basis (chips Cash / Accrual); Sales tax (info "From the center's state").
  4. Import data: Source system (chips Neon / Salesforce / Bloomerang / Spreadsheet); Mapping (info "Households 842 · people 2,610 · gifts 14 years · 31 duplicates flagged · dry run first").
  5. Roles & admins: Center admin (text "admin@partner-a.org"); Treasurer (text); Default roles (info "11 default roles created; custom roles later").
  6. Go-live checks: Checks (info "Login success above 95% · check-in rehearsal · test QuickBooks posts approved · pilot with 30–50 families").
- Buttons: **Back** (from step 2 on) and **Continue**, or **Go live** on step 6. Each POSTs `/centers {step}`. On the last step the toast reads "Design partner center A scheduled to go live".

---

## F. Permission mapping needed (prototype entitlement → app permission)

| Prototype | App today | Gap |
|---|---|---|
| people.view / people.edit / people.approve | people.view / **people.manage** / people.approve | rename only |
| **people.children**, **people.merge** | — | ADD (masking of minors' DOB/age/gender; merge wizard) |
| giving.view / giving.record / giving.match | giving.view / giving.record_offline / giving.record_offline | OK |
| **giving.amounts** | — | ADD (mask amounts for giving viewers) |
| giving.refund_request / giving.refund_approve | giving.manage / giving.approve | OK |
| settings.rules / settings.roles / settings.integrations / settings.privacy / settings.audit | settings.manage / roles.manage / integrations.* / privacy.manage / audit.view | rename only |
| **data.export** | — | ADD (all Export buttons) |
| platform.super | `is_platform_admin()` | OK (use the flag) |
| Custom roles | `app.roles` global, no center_id | Migration needed for per-center clones |

---

## G. Prioritised fix list

### P1: missing or broken flows

1. **Unify the shell into connect-crm and add the prototype's module structure.**
   - Files: `src/components/shell/app-shell.tsx`, `nav-link.tsx`, `user-menu.tsx`, `src/lib/permissions.ts` (`NAV` → flat 14 items with the prototype gates), `src/app/(app)/layout.tsx`.
   - MOVE from connect-admin: `(console)/{events,bolis,store,content,comms,volunteers,pathshala}`, `app/ops/[eventId]/*`, `components/{nav,person-picker,auto-refresh,retry-button}.tsx`, `lib/{access,nav,logic,data,forms,result}.ts`, and `api/{people,households}`.
   - Add a "Calendar" route (nowhere today).
2. **Build the drawer, modal and toast primitives, then switch rows from navigate-to-page to open-drawer.**
   - New: `src/components/drawer.tsx`, `modal.tsx`, `toast.tsx`.
   - Extend `action-form.tsx`: replace `window.confirm` (line 72) with the modal, and route success through the toast. Keep the full pages as deep links.
   - Update tables in `households/page.tsx`, `memberships/applications/page.tsx`, `privacy/requests/page.tsx`.
3. **Home "My tasks".** Rewrite `src/app/(app)/page.tsx`:
   - Add a task aggregator in `src/lib/tasks.ts`, gated per permission.
   - Convert `approvals-queue.tsx` rows into Refund / Write-off / Voting-override tasks.
   - Add the Deposits, Membership, QuickBooks and Privacy tasks from existing crm queries.
   - Add the Newsletter, Inbox, WhatsApp, Content, Inventory, Event waivers, Feedback, Bolis and Pathshala tasks. These need connect-admin data loaders to MOVE in (`lib/data/*`).
   - Add the "At a glance" KPI column and the Home badge count in the nav.
4. **People module with 5 tabs.** New `src/app/(app)/people/page.tsx` or a tabbed `/people?tab=`:
   - (a) Households tab: reuse `households/page.tsx`.
   - (b) **People list**: new; reuse the connect-admin `lib/data/people.searchPeople` and `/api/people`.
   - (c) Applications: reuse `memberships/applications/page.tsx`.
   - (d) **Directory & expertise**: new; needs a listing review status column (migration).
   - (e) **Voting eligibility**: new; reads `eligibility_snapshots` and hosts the existing override flow.
5. **Household edit, and person edit and actions.**
   - New server actions in `src/app/(app)/households/actions.ts` and `src/app/(app)/people/actions.ts` (PATCH household name/address/phone/zone/tier-with-approve; person profile fields, consents and opt-ins; make-primary; move-household; add person).
   - Edit UI in `households/[id]/page.tsx` or the drawer, and in `people/[id]/page.tsx` (currently read-only).
   - Merge-duplicate wizard backed by `app.merge_candidates`.
6. **Settings module with 8 tabs.** New `src/app/(app)/settings/layout.tsx` with the tabs:
   - Rules: replace the JSON textarea in `settings/center/center-settings-form.tsx` with a structured form writing `centers.rules` keys. Keep the JSON editor as "Advanced".
   - Roles: `settings/roles`.
   - **Integrations**: new; reads `integration_connections`.
   - Privacy: move `privacy/requests` under Settings.
   - **Onboarding fields**, **Notifications**, **Security**: new.
   - Audit log: move `audit` under Settings.
7. **Roles & entitlements editor.**
   - Plain-English entitlement catalogue (`src/lib/entitlements.ts`), a checkbox grid, "Clone as custom" and "Save role".
   - Needs a migration adding `center_id` and `is_system` to `app.roles` (or a `center_roles` table), plus RLS.
   - Keep the existing grant form.
8. **Platform module.** New `src/app/(app)/platform/{page.tsx,new/page.tsx}` gated by `isPlatformAdmin`: a centers list and the 6-step onboarding wizard. Add the header centre switcher.
9. **New permissions** `giving.amounts`, `people.children`, `people.merge` and `data.export`. Needs a migration, seed updates, `permissions.ts` `ACCESS`, and masking in `households/page.tsx`, `members-tab.tsx`, `people/[id]/page.tsx` and the Home KPIs.
10. **Export and step-up.** Add Export actions (households, voter list, audit log) with a fresh-OTP modal, watermarking and 24h expiry, plus an audit entry. Also the step-up code on refund approval and the printed sign-in code. Backend: an edge function or RPC plus `src/components/modal.tsx`.

### P2: fields, copy and behaviour

1. Brand strings: rename everything in the brand table above to "Community Connect", with JSH as tenant.
2. Login copy and fields (`login/page.tsx`, `login-form.tsx`):
   - Title, pitch and audit notes.
   - "Work email or mobile" (SMS OTP).
   - "Send code" / "Verify and sign in".
   - Passkey note.
   - Two-panel layout with the tenant logo.
3. Page titles and subtitles: switch to the prototype copy on every in-scope screen ("People", "Settings", "Platform", "Good morning, {first}", and each tab's sub-line quoted above).
4. Households table (`households/page.tsx:281-336`):
   - Add PEOPLE and ON APP columns.
   - Life in green text; capitalise tiers.
   - Chip filters All / Life / Yearly / Community.
   - "Children's details visible/hidden for your role" hint.
   - Row-click to open.
5. Household detail:
   - Sub-line "{Tier} members since {year} · {zone} zone · {phone}".
   - PREFERENCES AND CONSENT section (directory, photos, physical mail, on app).
   - "Record payment" linking to `/giving/payments?household=` (add the prefill in `giving/payments/record-payment-form.tsx`).
   - A human-readable recent-activity section.
6. Person page:
   - Show DOB (masked for minors), relationship, language as a chip.
   - Minors' "Through parents" and app-access rows.
   - Roles/teams/waivers section (volunteer data from connect-admin).
   - Account section (member card, sign-in methods).
7. Applications:
   - Add an ID column and a REFERENCE STATUS column.
   - Fee "authorized" / "captured".
   - Rename Reject to "Decline" and "Approve" to "Approve and grant".
   - Add the "Rules in effect" note and a CHECKS section (reference tier rule, outside household, duplicate check).
   - Confirm with the owner whether the EC second-person rule stays (app is stricter).
8. Audit log (`components/audit-table.tsx`, `audit/page.tsx`):
   - Add ROLE and MODULE columns.
   - Human-readable action sentences (map `action` and `record_table`).
   - Module chip filters.
   - Audit sign-in and sign-out.
9. Privacy: ID column, "Deletion policy in effect" note, and a retention / legal-hold line.
10. Dirty-state save buttons: "Save N changes" / "No changes". Right-aligned form buttons.

### P3: visual

1. Sidebar: white, 220px, flat list, 40px items, radius 10. Active item `#EEF1F8` with navy text at weight 800; inactive `#3D3A33` at 600. Add the footer role line (`app-shell.tsx`, `nav-link.tsx`).
2. Header: white, 60px, tenant logo, wordmark, centre pill, 460px global search pill, and avatar with name plus **role** inline and a plain "Sign out" (`app-shell.tsx`, `user-menu.tsx`). Global search needs a new `src/app/(app)/search` endpoint reusing `lib/data/search.ts`.
3. Tokens (`globals.css`):
   - Page background `#F6F2EA`, borders `#E3D9C8`, row dividers `#F1E8D8`, input border `#D9CFBE`.
   - Add danger `#B3261E` and muted2 `#8A8478` / `#3D3A33`.
   - Load JetBrains Mono for IDs.
4. Page header: title ink (not navy), Fraunces 28px, subtitle 13px (`ui.tsx:22-23`).
5. Cards: radius 16; no header divider; DM Sans 16/700 title with a 12px hint (`ui.tsx` Card). KPI tiles: `#FBF7F0` background, 24px/800 coloured value (`ui.tsx` Stat).
6. Buttons: pill radius. Kinds primary / ghost (navy border) / ok / warn / bad (`#B3261E`) / off (`ui.tsx buttonClass`).
7. Tables: rounded header row at 11px/700; 13px rows; row hover and highlight `#FFF8EC`; pill row actions; chip filter row (`globals.css .crm-table`).
8. Forms: chip groups for enums; toggle switches for booleans; 12px/700 muted labels; 42px inputs with radius 10.
9. Tabs: 3px navy underline, 700 weight, `#E3D9C8` baseline (`ui.tsx Tabs`).
10. Add `loading.tsx` shimmer skeletons (90px and 260px blocks) per route group.
11. Retire the connect-admin-only styles (`connect-admin/src/app/globals.css` `@utility btn/field-input`) once modules move. Reconcile token names (`navy-soft` vs `navy-50`, `sand` vs `subtle`, `danger` vs `maroon`) so moved code renders the same.

**Code that must MOVE from connect-admin** (for Home tasks and nav completeness, not in the P1–P3 scope screens themselves):
- Content approvals, comms (newsletter approvals, inbox threads, WhatsApp requests, surveys), store inventory, bolis, Pathshala sign-offs, volunteers/waivers, and the events and ops pages.
- The `lib/data/*` loaders.
- `/api/people` and `/api/households` (pickers).
- Its `access.ts`/`nav.ts` permission helpers, which must be merged with crm `permissions.ts`.
