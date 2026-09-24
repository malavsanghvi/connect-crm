# Parity audit: Giving, Accounting, Reports and the Community Dashboard (prototype vs connect-crm / connect-admin)

This was read-only: nothing was edited, committed or pushed. I compared the source code side by side and did not render screenshots.

- **Prototype:** `docs/handoff/prototypes/source/AdminPortal.dc.html` (AP). The screens are built in `view()`: Giving is at L579–609, Accounting at L655–661 and Reports at L662–666. Drawers are in `drawerVals()` (L740–760), the mock API is at L425–456 and the seed data is at L288–350.
- **App:** `/home/user/connect-crm/src/app/(app)/…` (CRM below). `/home/user/connect-admin` has **nothing** in this scope. Its only money-adjacent code is Bolis, and its "campaigns" are email campaigns (`comms/campaigns`).
- Two areas were outside the read I was allowed. A permission check blocked a read of part of AP L543 (People › Voting eligibility) and the role/entitlement block around L355–420, so I did not read them in full. The voter-list findings below come from the part of L543 I did see.

## 0. How the two apps are organised (this affects every screen)

| Aspect | Prototype | App | Verdict |
|---|---|---|---|
| Module model | One sidebar item per module (**Giving**, **Accounting**, **Reports**); each module has **tabs** under a single title such as "Giving" (AP L580, L656, L663) | Separate sidebar links per page: Giving › Pledges / Payments / Bank reconciliation / Campaigns / Recurring gifts / Statements; Accounting › QuickBooks; Oversight › Reports (`src/lib/permissions.ts:156-175`) | DIFFERS |
| Giving tabs | `Pledges · Payments & deposits · Opportunities · Recurring · Labh fulfillment · Receipts & statements` (L580) | 6 separate pages. There is no Opportunities or Labh page; Bank and Campaigns are extra pages | DIFFERS |
| Accounting tabs | `QuickBooks sync · Month-end close` (L656) | Only `/accounting/qbo`; **no close page** | MISSING |
| Reports tabs | `Center health · Community dashboard` (L663) | One `/reports` page, no tabs | MISSING |
| Hiding amounts | `giving.amounts` entitlement; without it every amount shows `•••` and a hint reads *Amounts are hidden for your role (requires "See donor amounts")* (L517, L583) | No such permission; amounts are always shown to anyone with `giving.view` (`permissions.ts:59-96`) | MISSING |
| Step-up code modal | Sensitive actions open a modal with a kicker, title and body, a 6-digit code field and a coloured confirm button (L164 markup; used for refund approve L494, lock month L659, voter export L543) | Nothing like it. `ActionForm confirmMessage` is a plain browser `confirm()` | MISSING |
| Toast | Centred dark toast, 2.8 s (`flash`, L457; markup L171) | Inline success/error text inside the form (`ActionForm`) | DIFFERS |
| Drawer | A right-hand drawer opens for households and deposit matches (L740+, `dep` L750–758) | Full-page navigation (`/households/[id]`) or inline expanders | DIFFERS |
| Global search | Top-bar pill: "Search households, people, pledges, events…" (L61) | None in the shell (`components/shell/app-shell.tsx`) | MISSING |

---

## 1. Giving › Pledges (AP L581–583)
**How to reach it:** Giving (tab 0). **App file:** `giving/pledges/page.tsx`

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Title / subtitle | "Giving" / "Cash basis · every commitment is a pledge; payments close the earliest open pledge unless tied to a specific one" | "Pledges" / "Every commitment a household has made — RSVP commitments, bolis… Aging runs from the due date…" (L34-37) | DIFFERS |
| Filters | Three chip filters in the card header: **All · Open · Closed** (L583) | GET form with 3 selects (Status with 7 options, Campaign, Pledged in) plus Apply/Clear buttons (L111-159) | DIFFERS |
| Aging summary | — | A 5-bucket aging card row (L161-186) | EXTRA-IN-APP |
| Columns | `PLEDGE · HOUSEHOLD · CAMPAIGN · DATE · AMOUNT · PAID · STATUS` | `Pledge · Household · Campaign · Status · Amount · Paid · Open · Pledged · Due · Age · Write-off` (L204-214) | DIFFERS (order is different; Open/Due/Age/Write-off are extra) |
| Date format | "Apr 2026" (month + year) | Full date via `formatDate` | DIFFERS |
| Status values | Closed (green) / Partial / Open (amber) | Badge labels from `PLEDGE_STATUS_LABEL`, including Written off and Cancelled | DIFFERS |
| Sort | Newest first (`b.date - a.date`) | `pledged_at` ascending (L81) | DIFFERS |
| Row click | Clicking a row opens the **household drawer** (L583) | Only the household name is a link, to `/households/:id?tab=pledges` | DIFFERS |
| Footer | "Showing 14 of N" | Pagination component, 50 per page | DIFFERS |
| Write-off controls | Not on this tab | Inline two-person write-off (`WriteOffControls`) | EXTRA-IN-APP |

## 2. Giving › Payments & deposits (AP L584–600)
**App files:** `giving/payments/page.tsx`, `payments/record-payment-form.tsx`, `giving/bank/*`, `approvals-queue.tsx`

Title / subtitle: the prototype has "Giving" / "Offline payments, deposits, bhandar and refunds". The app has "Payments" / "Money received — online, offline (checks, cash, stock) and matched from the bank…" (page.tsx L28-31). **DIFFERS**

### 2a. Record an offline payment (7-column form) and Allocation preview (5 columns)

| Element | Prototype | App (record-payment-form.tsx) | Verdict |
|---|---|---|---|
| Card title / hint | "Record an offline payment" / "Check, cash, ACH or stock received at the office or an event" | Same title; description "Check, cash, ACH, Zelle or stock received outside the app. Find the household by any ID…" (page.tsx L92-93) | DIFFERS (copy) |
| Layout | Form (span 7) sits beside a **green Allocation preview panel** (span 5, bg `#E4F2EA`) | One full-width card; the preview is a table inside the "Apply to pledges" fieldset | DIFFERS |
| Household | Chip picker of recent households | `HouseholdPicker` search, then a selected `HouseholdCard` with a "Change household" button (L211-219) | DIFFERS (the app's version is richer) |
| Method | **Chips**: Check · Cash · ACH · Stock | `<select>`: Check, Cash, ACH, Zelle, Stock (L245-251; `OFFLINE_METHODS` in labels.ts:54) | DIFFERS (select instead of chips; Zelle is extra) |
| Amount | "Amount ($)", default 400 | "Amount received ($)", placeholder 251.00, with validation hint (L225-239) | MATCH-ish |
| Reference field | Label changes with method: "Check number or reference", or for Stock "Shares and value on date received" | "Check number" only when method = check (L262-269); **no stock shares/value field** | MISSING (stock details) |
| Received on / Envelope / Memo | — | Present (L256-281) | EXTRA-IN-APP |
| Specific pledge | Chips: "Earliest first" + up to 4 open pledges by campaign (a separate 5-column block) | Radios: "Earliest open pledge first / Choose specific pledges / Don't apply (general gift)", plus a checkbox table (L291-363) | DIFFERS (the app is more capable) |
| Preview lines | "Temple construction · Apr 2026 → $400 · closes / stays open (partial)"; "Remaining $X is recorded as a donation"; with no pledges: "the full amount is recorded as an unrestricted donation" | Table: Pledge/Pledged/Open now/This payment/After, then summary "Closes P-…; $X stays unapplied." (L364-374) | DIFFERS. The prototype records leftover money as a **donation**; the app leaves it **unapplied** |
| Save | "Save payment" → toast "Payment recorded · N pledge(s) updated · QuickBooks sales receipt queued" | "Record $X" → inline success panel with receipt number, QBO queued status, applied table, "Record another payment" and "Open the household" (L147-206) | DIFFERS (behaviour is fine; copy differs) |

### 2b. DAF grants and matching gifts to match

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Location | A table on the Payments tab titled "DAF grants and matching gifts to match", hint "Arrive without full donor details; treasury applies them to a household" | The **Bank reconciliation** page, "Gifts to match" tab, shown as one card per line. DAF and matching lines carry a purple originator badge and the copy "Sent by a donor-advised fund on a donor's behalf — match it by hand…" (bank/page.tsx L270-298) | DIFFERS (different screen; card layout instead of a table) |
| Columns | `DEPOSIT · SOURCE · AMOUNT · DATE · MEMO · STATUS · [Match]` | Card contents: amount, date, description, channel/type/batch badges, payer, reference, check/slip | DIFFERS |
| Match click | Opens drawer "MATCH DEPOSIT · DEP-2231" with sections **APPLY TO HOUSEHOLD** (suggested from memo, plus choices), **ALLOCATION PREVIEW · EARLIEST OPEN PLEDGE FIRST**, **RECEIPT** ("Tax receipt: Not issued · the DAF sponsor receipts the donor", "Recognition: Credited to household as a DAF grant"), then "Apply to household" → toast "DEP-… applied to … · QuickBooks deposit queued" (L750-758) | `GiftLineMatcher`: suggestions → "Confirm match" or "Options…" (a specific-pledge checkbox, "Remember payer name", and an ambiguity check), then "Confirm $X for this household" (gift-line-matcher.tsx L130-275) | DIFFERS. The **RECEIPT section (DAF not tax-receipted, recognition) is MISSING** |

### 2c. Bank / Chase reconciliation

The prototype has **no dedicated screen** for this. The only traces are the "Deposited · matched" status on bhandar rows and the checklist item "Payment payouts matched to bank deposits". The app's `giving/bank/page.tsx` covers statement import (Chase CSV hint L220), 6 tabs (Gifts to match / Check & cash deposits / Card payouts / Money out / Matched / Ignored, L25-33), `DepositMatcher`, ignore/restore, "Recently learned payer names" and "Add a bank account". **EXTRA-IN-APP.** Keep it, but move it under Giving › Payments & deposits, or a "Deposits" sub-view, so it matches the tab model.

### 2d. Bhandar counting sessions

| Prototype | App | Verdict |
|---|---|---|
| Table (span 7), hint "Two counters from different households · sealed, numbered bags"; columns `SESSION · DATE · COUNTERS · TOTAL · STATUS`; rows BH-44 "Deposited · matched", BH-45 "Scheduled" (L597) | No UI anywhere. The table `app.counting_sessions` exists (`supabase/migrations/0003_giving.sql:234`) | **MISSING** |

### 2e. Refund requests

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Table | "Refund requests", hint "Two-person rule: the requester cannot approve"; columns `ID · HOUSEHOLD · AMOUNT · STATUS` ("Approved" / "Awaiting 2nd approver") (L598) | No refund list on Payments. Refunds show as a per-row `RefundControls` column (payments/page.tsx L231-244) and in the home "Waiting for second approval" card (approvals-queue.tsx L68-72) | DIFFERS |
| Request data | ID RF-104, amount, **reason** ("Duplicate card payment…") | `requestRefundAction` records only the requester: **no reason and no amount** at request time; the amount is entered only when recording (approvals/actions.ts L109-128; two-person-controls.tsx L115-125, L143-149) | MISSING (reason, requested amount) |
| Approve | Home task "Approve refund RF-104 · $251 · …"; clicking opens the **TWO-PERSON APPROVAL · STEP-UP** modal with a code → "Approve refund" → toast "Refund RF-104 approved · refund receipt queued for QuickBooks". A self-approve attempt gets a 409 "The requester cannot also approve…" (L431, L494) | "Approve as second person" button with no step-up; self-approve is hidden and shows "Waiting for a second approver…" | DIFFERS (**step-up MISSING**) |

## 3. Giving › Opportunities: builder and campaign progress (AP L601)
**App file:** `giving/campaigns/page.tsx` covers campaigns only. The opportunity builder is **MISSING**. The table `app.opportunities` exists (0003_giving.sql:49).

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Subtitle | "Build the opportunities members see in the Give tab, and who gets alerted" | "Giving campaigns and their progress. Drafts are visible to staff only…" (L20) | DIFFERS |
| Campaign progress | Bar chart (span 5): Temple construction, Swamivatsalya, Diwali pujans, Jeevdaya, General fund, each with a coloured bar, percentage and amount | A table: Campaign/Fund/Dates/Goal/Pledged/Paid/Status, with "N% of goal" as text (L81-128) | DIFFERS (no bars) |
| Opportunity builder form | Name (text), **Type** chips (Sponsorship tiers / Fixed pujan list (multi-select) / Preset amounts + open / Open amount), Campaign and fund (info), **Recognition** chips (Name shown / Anonymous allowed), **Alert these members** multi-chips (All members / Past donors to this campaign / Life members / Interested in temple programs), Pay or pledge (info), Explainer (info: "Video and text from Content (approved)"); buttons **Preview in app**, **Publish opportunity** → toast "… · saved and audited" | Not present. The app only has a "New campaign" form: Name, Kind, Fund, Goal, Starts, Ends, Description → "Create draft" (L139-200) | **MISSING** |
| Type-specific table | Sponsorship tiers (TIER/AMOUNT/RECOGNITION/TAKEN), or Pujans and fixed bolis (PUJAN/AMOUNT/AVAILABILITY, Taken/Available), or Preset amounts | — | **MISSING** |
| Campaign status actions | — | Publish / Close / Reopen / Archive (L119-126) | EXTRA-IN-APP |

## 4. Giving › Recurring (AP L602)
**App file:** `giving/recurring/page.tsx`

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Subtitle | "Recurring gifts set up in the member app · never auto-close pledges unless the donor links them" | "Scheduled gifts families set up in the app… never closes pledges unless the family linked it." (L24-25) | DIFFERS (close) |
| KPI row | Active recurring gifts (214, "6 paused") · Monthly run rate · Failed this month · Expiring cards | Only a Card description "About $X a year from the active gifts on this page" (L67) | **MISSING** |
| Filters | None; one table | Tabs Active/Paused/Failed/Cancelled/All (L58-61) | EXTRA-IN-APP |
| Columns | `HOUSEHOLD · CAUSE · AMOUNT · FREQUENCY · METHOD · NEXT · STATUS` | `Household · Amount · Frequency · Method · For · Next charge · Status` (L77-83) | DIFFERS (order; "Cause" vs "For") |
| Status copy | "Payment failed · retry Sep 25", "Paused by donor", "Yearly · on special day" | Raw enum badge (active/failed…) | DIFFERS |
| Row action | **"Retry now"** on failed rows → toast "Retry scheduled · donor notified" | None | **MISSING** |

## 5. Giving › Labh fulfillment (AP L603)
**App:** **MISSING**. Only `app.labh_options` exists (`0007_learning_content_calendar.sql:280`).

The prototype has two tables. **Upcoming labh** has columns DATE · HOUSEHOLD · OCCASION · LABH · DEDICATION · STATUS, with a **Mark scheduled** button that turns the status to "Scheduled" and audits it. **Labh menu** has columns LABH · AMOUNT · FULFILLED BY · ACTIVE, with the hint "Shown to members 2 weeks before a family special day".

## 6. Giving › Receipts & statements (AP L604)
**App file:** `giving/statements/page.tsx`

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Subtitle | "Tax, pledge and donation receipts use the standard format with light personalization" | "Year-end tax statements, pledge statements and donation receipts issued to households." | DIFFERS |
| Year-end KPIs | "Year-end statements · 2025": Households with gifts 1,102 · Emailed and in app 1,019 · Mailed on paper 83 · Reissued on request 17 | None | **MISSING** |
| Generate button | **"Generate and send 2026 statements"** → toast "Scheduled for January 15 · email, in-app and physical mail for opted-in families" | Alert: "Generating a new batch is not available from the console yet." (L54-57) | **MISSING** |
| Receipt template form | Template chips (Donation receipt / Pledge confirmation / Year-end statement), Signed by (text), Personal note (text), Receipt name (info), Required wording (info); buttons **Preview PDF** and **Save template** ("Template saved · audit logged") | None (no template table in the schema) | **MISSING** |
| Live preview | Cream panel showing a sample receipt: org address, receipt number, payer/amount/method, applied-to line, IRS "No goods or services…" line, note and signature | None | **MISSING** |
| Issued statements list | — | Filters (Tax year, Kind) and a table Household/Kind/Tax year/Generated/File (L59-133) | EXTRA-IN-APP (keep it as a section) |

## 7. Accounting › QuickBooks sync (AP L657)
**App file:** `accounting/qbo/page.tsx`

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Title / subtitle | "Accounting" / "QuickBooks Online is the book of record · cash basis · the platform posts every money event once" | "QuickBooks" / "QuickBooks Online is the accounting record. Every money event is queued once…" (L40-41) | DIFFERS (copy) |
| KPIs | Posted today (with "sales receipts, deposits, refunds") · Pending ("retrying automatically") · Exceptions ("need a person" / "all clear") · Last sync ("connection healthy") | A "Connection" card (status badge, Company, Realm id, Connected, Token expires, Basis, Posting) plus "Posting queue at a glance" status-count links (L121-175) | DIFFERS (no Posted-today or Last-sync tiles) |
| Exceptions table | Title "Exceptions"; columns `ID · TRANSACTION · REASON · SUGGESTED FIX · [Apply fix]`; e.g. "No income account mapped for 'Gift packing'" → "Map to Store income: gift packing"; **Apply fix** → toast "QB-EX-88 fixed and reposted" | Posting queue with status tabs (the Failed tab counts as exceptions): Queued/Type/Amount/Period/Source/Status (with last_error)/QuickBooks; per-row **Retry** and **Retry all N failed** with a confirm (L269-360) | DIFFERS (**no suggested fix or one-click Apply fix**; the raw error is shown instead) |
| Account mapping | Columns `MONEY EVENT · QUICKBOOKS ACCOUNT · CLASS`; 5 rows; read-only | Columns Purpose/QuickBooks account/Approval/Change; 15 purposes (`QBO_PURPOSES`, labels.ts:87-103) with Save and Approve two-step (L180-260) | DIFFERS. **The CLASS column (Fund / event / Store) is MISSING**; approval workflow is EXTRA |
| Payouts | Only mentioned as a mapping row ("Payouts → Bank (via payment clearing)") | No payouts screen. `app.payouts` exists (0009_integrations.sql:74); the bank "Card payouts" tab lists bank lines only | MISSING (payout ↔ deposit matching view) |
| Exports | None in the prototype for accounting | None | — |

## 8. Accounting › Month-end close (AP L658–660)
**App:** **MISSING**. The table `app.accounting_periods` exists with a checklist JSON (0009_integrations.sql:63).

- **Subtitle:** "September 2026 close · locking prevents changes; later corrections post as adjustments".
- **Close checklist**, 4 items with checkboxes:
  - All QuickBooks exceptions cleared (automatic; shows "N left · fix on the sync tab")
  - Payment payouts matched to bank deposits
  - Refunds reviewed and approved
  - Pledge statements generated

  Each item toggles with "Mark done".
- **Lock September button:** disabled ("off") until the checklist is complete. Clicking it early gives the toast "Finish the checklist first".
- **Lock flow:** STEP-UP modal "Lock September 2026?" / "No one can change September transactions after locking. Enter the code sent to your phone." → "Lock month" → toast. The button then reads "September locked ✓".

## 9. Reports › Center health (AP L664)
**App file:** `reports/page.tsx`

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Subtitle | "Built on the warehouse and filtered by your permissions" | "Simple aggregates from the live records. Totals include only what your roles let you read." (L20) | DIFFERS |
| KPI row (6) | Households 1,184 (+62) · On the app 71% (goal 80%) · Given YTD (+11%) · Open pledges ("aging report") · Event visits (+9%) · Renewals due ("next 60 days") | None | **MISSING** |
| Giving by campaign | Horizontal **bars** (saffron), "Giving by campaign, 2026" | A table: Campaign/Pledges/Pledged/Paid/Outstanding (L198-236) | DIFFERS (table instead of bars) |
| Households by zone | Navy bars across 7 zones | None | **MISSING** |
| Other | — | Year selector, Membership by tier/status, Membership applications, Money received by method (L94-278) | EXTRA-IN-APP |
| Exports | None on Reports | None anywhere in either app (no CSV or download code outside the bank importer) | — |

## 10. Reports › Community dashboard: public KPI publishing (AP L665)
**App:** **MISSING.** The only related code is the RPC `app.public_kpis(slug, from, to)`, granted to anon (0011_functions.sql:416-440). There is no visibility table.

- **Subtitle:** "Choose which KPIs appear on the public community dashboard (no sign-in)".
- **Page action:** "Open public dashboard" (public URL `/c/jsh`).
- **Public KPIs table:** hint "Aggregates only · groups under 10 hidden · changes are audited"; columns KPI · VISIBILITY (Public / Members only).
  - Each row has a **Publish / Unpublish** button, which writes an audit entry "Published public KPI '…'".
  - There are 12 KPIs (seed L350). Jeevdaya contributions, Families supported and Where contributions go default to members-only.
- A home task links here: "N community dashboard KPIs kept members-only" (L506).

## 11. Voter list (AP People › Voting eligibility, L543; you listed it under Reports)
**App:** **MISSING as a screen.** `eligibility_snapshots` is only used for override approvals (approvals-queue.tsx L49, L161-180) and in the audit log.

The prototype shows:
- KPIs: Eligible voters 842 ("both spouses in life-member households"), Not eligible 106, and more.
- A table with an eligibility verdict per household: Paid up / Prior-year pledge open, Over/Under 180 days, Eligible / Not eligible.
- **Export voter list**, which opens a STEP-UP modal ("Contains names and addresses of eligible life members. Watermarked, expires in 24 hours, audited.") and then toasts "Voter list exported".

Export does not exist anywhere in either app, whether households, voter list or audit log.

## 12. Public Community Dashboard (`CommunityDashboard.dc.html`; spec in `docs/PROTOTYPE_COMMUNITY_DASHBOARD.md`)
**App:** **MISSING. There is no public or unauthenticated route in connect-crm** (`src/app` has only `(app)` and `login`), in connect-admin, or in connect-mobile.

| Spec item | Backend today (`app.public_kpis`) | Verdict |
|---|---|---|
| Header, period segmented control (This year / Last 12 months / 2025 / All time), "Updated {asOf} · refreshed nightly" | The RPC takes a from/to range and returns `as_of` | UI MISSING |
| Summary 6 tiles with deltas | Returns member_families, community_people, events_held, attendance. **No deltas, no volunteer_hours, no app_adoption** | PARTIAL |
| Practicing together (6) | samayik, gyan_steps, anumodana only. **No pratikraman, tapasvis or navkar_malas** | PARTIAL |
| Temple construction progress, donor families, participation, next milestone | — | MISSING |
| Attendance by month (12 bars, partial months, Sep highlight) | No timeseries | MISSING |
| Families by zone | — | MISSING |
| Pathshala and learning (4), Seva and community care (4) | Only store_orders | MISSING |
| Where contributions go (QuickBooks allocation, stacked bar) | — | MISSING |
| k-anonymity: under 10 suppressed | Implemented (`suppressed_below: 10`, values < 10 become null) | MATCH |
| Per-KPI publish toggle (§10) respected | The RPC has no visibility filter | MISSING |
| Footer "Be part of these numbers" and the "New to JSH? Start here" CTA | — | MISSING |
| Loading shimmers; error states | Prototype never exits the shimmer on error (spec §4.6). The app should show a visible error | Build with an error state |

## 13. Look and feel (applies to every screen in scope)

| Aspect | Prototype | App |
|---|---|---|
| Sidebar | **White**, 220px, right border `#E3D9C8`; active item `#EEF1F8` bg with navy weight-800 text; 10px radius; orange task-count badge on Home (L67-70) | **Navy** 256px with grouped section headings (Overview/People/Giving/Accounting/Oversight/Settings) and "Connect CRM · System of record" branding (app-shell.tsx L37-43) |
| Top bar | Center switch pill, centred search pill, avatar with name and role, "Sign out" | Center name and slug/time zone plus a UserMenu; no search |
| Page bg | `#F6F2EA` | `--color-ground #FBF7F0` |
| Cards | 16px radius, border `#E3D9C8`, 12-column grid with spans (e.g. 7/5 side by side) | `rounded-xl` (12px), `--color-line #E8E0D2`, mostly stacked full width |
| Tabs | Underline tabs, 3px bottom border, 14px bold | Separate pages; `Tabs` component used only inside Bank and Recurring |
| Buttons | **Pill** (radius 18–20px), 36–40px tall, variants primary / ghost-outline / ok-green / warn / bad-red-outline / off | `rounded-lg` (8px), 44px/36px; primary/secondary/danger/ghost/success |
| Error red | `#B3261E` | danger/maroon `#7A2E1F` |
| KPI tile | Cream `#FBF7F0` tile, 24px weight-800 coloured value, 11px sub-line | Stat/aging tiles in white with a border and Fraunces value |
| Table header | Uppercase caps labels such as `PLEDGE`, `HOUSEHOLD` | `crm-table` thead: `--color-subtle` bg, 0.75rem muted (casing comes from CSS) |
| Status text | Bold coloured text (green `#1F7A4D` / amber `#8A4608`) | Rounded Badge chips |
| Bar charts | Used in Opportunities and Reports | No charts anywhere |

---

## Prioritised fix list

### P1: flows that are missing or broken
1. **One Giving module with the 6 prototype tabs** (Pledges · Payments & deposits · Opportunities · Recurring · Labh fulfillment · Receipts & statements) under a single "Giving" title. Move Bank into Payments & deposits and Campaigns into Opportunities.
   Files: `src/lib/permissions.ts` (NAV L146-185), new `giving/layout.tsx` with tabs, existing `giving/*/page.tsx`, `components/shell/app-shell.tsx`.
2. **Opportunity builder**: the form plus the tiers / pujan / preset tables, publishing, member alert targets, and "Preview in app". Uses `app.opportunities`.
   Files: new `giving/opportunities/page.tsx` and `actions.ts`; the audience logic can reuse connect-admin `lib/logic/audience.ts` ideas.
3. **Month-end close**: checklist and a lock with step-up. Uses `app.accounting_periods`.
   Files: new `accounting/close/page.tsx` and `accounting/actions.ts`; an Accounting tab layout.
4. **Public Community Dashboard route** (`/c/[slug]`, no auth) plus the Reports › Community dashboard publish-toggle tab. Extend `app.public_kpis` with the missing metrics, deltas, timeseries, zones, campaign, learning, seva and allocation, and add a KPI-visibility table with audit.
   Files: new `src/app/c/[slug]/page.tsx`, `reports/community/page.tsx`, a new migration after `0011_functions.sql`, and `src/lib/session.ts` / middleware so the route stays public.
5. **Step-up (code) confirmation modal** as a shared component, used for refund approval, month lock, voter-list export and any export.
   Files: new `components/step-up-dialog.tsx`, `components/two-person-controls.tsx`, `approvals/actions.ts`.
6. **Refund request with reason and amount**, plus a Refund requests table on Payments & deposits.
   Files: `approvals/actions.ts` (`requestRefundAction`), `two-person-controls.tsx`, `giving/payments/page.tsx`, and a migration for refund_reason / refund_requested_cents.
7. **Bhandar counting sessions**: list, create with two counters from different households, bag numbers, and a link to the deposit. Uses `app.counting_sessions`.
   Files: a new section or tab under Payments & deposits and its actions.
8. **Year-end statements**: KPIs, the "Generate and send {year} statements" action, and the **Receipt template** editor with a live preview and "Preview PDF".
   Files: `giving/statements/page.tsx`, a new template table/migration, and the statements edge function trigger.
9. **Voter list screen and "Export voter list"** (watermarked, 24 h expiry, audited). Add export generally, e.g. households, as in the prototype.
   Files: new `people/eligibility/page.tsx` (or Reports), an export action, `lib/csv.ts`.
10. **Labh fulfillment tab**: upcoming labh from special days with "Mark scheduled", and the labh menu from `labh_options`.
    Files: new `giving/labh/page.tsx`.

### P2: fields, copy and behaviour
1. **"See donor amounts" (`giving.amounts`) masking** (`•••` plus the hint) on all Giving, Reports and household views. Files: `permissions.ts` ACCESS, every giving page.
2. **Pledges**: All/Open/Closed chips; columns in prototype order (PLEDGE, HOUSEHOLD, CAMPAIGN, DATE as "Mon YYYY", AMOUNT, PAID, STATUS Closed/Partial/Open); newest first; row click opens the household. Keep aging and write-off as secondary. File: `giving/pledges/page.tsx`.
3. **Record payment**: method chips (Check/Cash/ACH/Stock); a stock "Shares and value on date received" field; a side-by-side green Allocation preview with the prototype's line copy; treat any remainder as a **donation**, not "unapplied" (a policy decision to confirm); success toast "Payment recorded · N pledge(s) updated · QuickBooks sales receipt queued". Also add a **"Record payment" action on the household page** that pre-fills the household. Files: `record-payment-form.tsx`, `payments/actions.ts`, `households/[id]/page.tsx`.
4. **DAF / matching deposits**: add the RECEIPT section ("Tax receipt: Not issued · the DAF sponsor receipts the donor"; "Recognition: Credited to household as a DAF grant") and "suggested from memo". Files: `giving/bank/gift-line-matcher.tsx`, `bank/actions.ts`.
5. **Recurring**: KPI row (active/paused, monthly run rate, failed this month, expiring cards), the "Cause" column, human-readable status text, and a **Retry now** action on failed gifts. File: `giving/recurring/page.tsx`.
6. **QuickBooks**: tiles for Posted today / Pending / Exceptions / Last sync; an exceptions table with **Reason + Suggested fix + Apply fix**; a **Class** column in the mapping; a payouts ↔ bank-deposit view (`app.payouts`). File: `accounting/qbo/page.tsx`.
7. **Reports › Center health**: a 6-KPI row (Households, On the app, Given YTD, Open pledges, Event visits, Renewals due) and Households by zone. File: `reports/page.tsx`.
8. **Copy alignment** for page subtitles, quoted in the sections above: Giving tabs, Accounting "book of record · cash basis…", Reports "Built on the warehouse…".
9. **Home tasks** in scope: refund approve with step-up, "N DAF or matching-gift checks to match", "N QuickBooks exceptions · Month-end close is blocked", "N community dashboard KPIs kept members-only". File: `src/app/(app)/page.tsx`, `approvals-queue.tsx`.

### P3: visual
1. White sidebar with a light active state and a task badge; a top bar with a centred global search pill. Files: `components/shell/app-shell.tsx`, `nav-link.tsx`.
2. Underline module tabs, a shared `ModuleTabs` component. File: `components/ui.tsx`.
3. Pill buttons (radius ~20px), a green "ok" variant, and error red `#B3261E` instead of maroon for destructive and error states. Files: `components/ui.tsx` (`buttonClass`), `globals.css`.
4. Page bg `#F6F2EA`, 16px card radius, `#E3D9C8` borders, and a 12-column block grid so blocks can sit side by side (7/5 and 5/7 splits). File: `globals.css`, `components/ui.tsx` (Card).
5. Cream KPI tiles (weight-800 coloured value, 11px sub-line) and bar-chart blocks for campaign progress, giving by campaign and zones. File: new `components/kpis.tsx`, `components/bars.tsx`.
6. Centred toast pattern for action results, in place of inline form messages. File: new `components/toast.tsx`, `components/action-form.tsx`.
7. Right-hand drawer pattern for household quick-view and deposit matching from table rows.
