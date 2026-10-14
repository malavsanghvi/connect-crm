# 02 — Money: Giving, Accounting, Bolis, Store, Reports

Read-only audit of `src/app/(app)/{giving,accounting,bolis,store,reports}`. Nothing in the repo was changed; the app was not run.
Evidence is cited as file paths in `/home/user/connect-crm`. Where I say "looks like" I read the code but did not execute it.

**Coverage:** 21 `page.tsx` files = 19 live screens + 2 redirects (`giving/bank`, `giving/campaigns`).
Sub-surfaces audited inside those screens: Zelle-reports view (bank), household quick-view drawer, DAF match drawer, boli drawer, opportunity "Preview in app" drawer, QuickBooks map-customer drawer, donor-matching tabs (5).
No `page.tsx` exists at `/giving` or `/accounting`, so typing those URLs is a dead end; the nav sends people to the first visible tab (`src/lib/permissions.ts` `visibleNav`).

**Legend for assistant rows**
- **R** read, no confirmation.
- **W1** write that is reversible and not money/permission/delete. One-line confirm only if members see it.
- **W2** touches money, accounting configuration, permissions/roles, public exposure, or deletes. Needs an explicit confirmation card: exact amounts (integer cents formatted at the edge), the `household_card`, consequences ("queues a QuickBooks sales receipt"), the reason the database wants, and the step-up modal when the action returns `stepUp: true`.
- **W3** two-person rule (refund, write-off, payee change, voting override). The assistant may *request* (W2) or may *approve as second* only for a different signed-in human. It never does both, and it never completes on behalf of the requester. The database trigger refuses it anyway (`approve_as_second`, 0016; message "the second approver must be a different person").

> Note on the repo's parity docs: `docs/parity/p2` and `p3` are stale for this area. They list Month-end close, Opportunity builder, Labh, Community dashboard settings, Bolis and Store as missing; all of them now exist. Use the code, not those lists.

---

## A. Cross-cutting findings (what the fresh design must fix)

1. **The module/tab model hides the real jobs.** A treasurer's job is "do X for household Y" or "clear today's queue", but the work crosses 3-5 pages: record payment (Payments) -> apply to pledge (same page, a different card) -> check the pledge (Pledges) -> confirm the QuickBooks post (Accounting) -> receipt (Statements). The household quick-view drawer (`giving/_components/household-drawer.tsx`) is read-only: its footer has only "Pledges" and "Open household", although `giving/payments/page.tsx` already accepts `?household=` to prefill the record form.
2. **Free-text "Reason" boxes everywhere.** QuickBooks donor matching asks for a typed reason on *every* approve/reject row (`accounting/qbo/matching/page.tsx`, `REASON_FIELD`), QBO setup on ~10 steps, write-off/refund request, bank "Ignore", boli close-early. Meanwhile the *second approver* of a refund or write-off gets a bare "Approve as second person" button with no reason and no evidence beside it (`components/two-person-controls.tsx`; `approve_as_second` has no reason argument).
3. **Money actions live in table-row expanders.** Write-off, refund request, record refund, counting deposit and labh edit are `<details>` popovers 14-16rem wide inside rows (`two-person-controls.tsx`, `payments/page.tsx`, `labh/page.tsx`). They are cramped, hard to use on a phone, and give no room for the evidence a second person needs.
4. **Dead ends and disabled features.** Recurring "Retry now" is permanently disabled (`giving/recurring/page.tsx`); "Generate and send statements" and "Preview PDF" are disabled (`giving/statements/page.tsx`, `template-editor.tsx`); "Expiring cards" tile is a "—" stub; accrual basis can be chosen but "isn't available yet" (`qbo/page.tsx`, `qbo/setup/page.tsx`); "Money out" bank tab can only be ignored; publishing an opportunity fails with "publish the campaign first (Opportunities › Campaigns)" and sends you to another tab; the statements button says "Generate and send 2026 statements" beside KPIs for 2025.
5. **Lists without search, sort, saved views, export, or drill-in.** Pledges/Payments/Recurring/Statements filter only by GET-form selects with an Apply button. There is no search by household, receipt, pledge number or amount. KPI and aging tiles are not clickable into a filtered list. No CSV/export anywhere in these areas. Aging (`giving/pledges/page.tsx`) sits *below* the 50-row table.
6. **Heavy aggregation in page code.** `reports/page.tsx` runs 9 `fetchAll` full scans (max 50,000 rows each, summed in Node; shows "first 50,000 only" when truncated) under a subtitle that says "Built on the warehouse". Same pattern: pledge aging (`pledges/page.tsx`, `lib/aging.ts`), year-end KPIs (`statements/page.tsx`, 2 scans plus chunked household lookups), recurring KPIs, opportunity pledged totals, boli top/entries (`bolis/list-data.ts` downloads all `boli_entries` instead of calling `boli_summary`), bank page (one `suggest_bank_matches` RPC per line, 20 per render, plus 6 count queries).
7. **Rules duplicated in app code instead of one RPC.** Allocation (`lib/allocation.ts`; `allocate_payment` is revoked from clients), the month-close gate (`lib/giving.ts closeChecklist` + `lockMonthAction`), QuickBooks exception classification (regex over `last_error`, `lib/giving.ts classifyQboException`), boli ranking/winner preview (`lib/bolis.ts`), stock movement (two writes). See section C.
8. **Confirmation is inconsistent.** One click records money in "Save payment", "Confirm match" (unambiguous suggestions), "Match deposit", "Record refund" and second-approval; a modal guards "Lock month", "Complete write-off", "Retry all failed", "Cancel order". There is no "review what will happen" step before money moves (the allocation preview exists but is not a confirmation).
9. **The household rule is only partly kept.** Pickers and bank suggestions show `household_card`. But the two refund tables show only the household *display name* (`payments/page.tsx` ~L446 flagged refunds, ~L502 refund requests) at the moment someone approves money, and the in-person boli CSV import accepts a household matched *by exact name* with the note "OK · matched by name, check the family" (`lib/bolis.ts` L248, `bolis/actions.ts` `uploadLookups`).
10. **Jargon.** "Unapplied", "general gift", "learned payer names", "Realm id", "basis", "posting", "mapping purpose", "QB-EX-xxxx", "floor/step/soft close", "bhandar", "originator". The assistant should translate; the visual surface should too.

---

## B. Screen-by-screen

### S1. Pledges — `/giving/pledges`
- **Route / roles:** ACCESS `pledges` (giving.view | giving.manage | giving.record_offline). Request write-off: giving.manage. Second approver: giving.approve (different person).
- **Jobs:** find what a household owes; see aging and chase overdue; retire a dead pledge (rare, two-person).
- **Pattern / friction:** Chips (All/Open/…) + GET form (Campaign, Pledged-in year, Apply/Clear) + 50-row table (`pledge, household, campaign, date "Mon YYYY", amount, paid, status`, write-off column). Row click opens the household drawer. Aging tiles are below the table, not clickable. No search, no sort, no "overdue" filter, no due date column (aging label appears under status). Write-off is an inline `<details>` textarea. Empty state "No pledges match these filters" offers no next step. Household shown as name + household number (card only in the drawer). Errors: `QueryError` with Try again (good).
- **Assistant:**
  | Say | R/W | Backed by | Confirm |
  |---|---|---|---|
  | "Which pledges are 90+ days overdue, by campaign?" | R | `pledges` select under RLS today; needs an aging RPC (aging is computed in the page from <=50k rows) | none |
  | "What does the Mehta family owe?" | R | `resolve_identifier` / `household_card` + `pledges`; assistant must show cards when >1 household | none |
  | "Request a write-off of P-1042, reason: moved abroad, no contact for 3 years" | W3 (request) | `requestWriteOffAction` (`approvals/actions.ts`, UPDATE `pledges.written_off_by`; DB trigger enforces two people; step-up) | W2 card + then "waiting for a different person with giving.approve" |
  | "Approve the write-offs waiting for me" | W3 (second) | `approveAsSecondAction` -> RPC `approve_as_second('pledges')`; completing is `completeWriteOffAction` by giving.manage | one W2 card per item with requester, reason, amount, household_card |
- **Stays visual / fresh design:** a dense ledger with saved views ("Overdue 90+", "Open this campaign"), aging as a clickable segmented bar on top, row expansion to a pledge timeline (payments applied, write-off state, QuickBooks credit memo status, which `writeOffPostingText` already computes). Write-off becomes a drawer action with reason + consequence text, not an inline popover. Bulk "draft a reminder to these households" hands off to Communications as a draft (pattern already used by `bolis/actions.ts accommodateOthersAction`).

### S2. Payments & deposits — `/giving/payments`
- **Route / roles:** `payments` (view | manage | record_offline). Record: `recordPayment` (record_offline | manage). Apply to pledges: giving.manage only. DAF + counting need `bank` / `counting` keys. Refund cards need `paymentsAll` (giving.view | manage). A finance volunteer sees only payments they recorded (RLS; page shows an info Alert).
- **Jobs:** record a check/cash/stock gift at the office or event; settle DAF/matching-gift deposits; log Bhandar counting sessions; handle refunds; look up a payment.
- **Pattern / friction:** A kitchen-sink page: up to 7 cards in one BlockGrid (Record form + green allocation preview, DAF to match, Counting sessions + form, flagged Stripe/PayPal refunds, Refund requests, then "All payments" with a GET filter). Recording = pick household via search -> card -> method chips -> amount, reference, date, envelope, memo -> "Save payment" with no confirm step (`record-payment-form.tsx`). Failure copy tells the user to check the list "so it is not recorded twice" because there is no idempotency key. A non-manager's payment is saved *unapplied* with a note that a treasurer applies it later, but there is no "Unapplied payments" list (PAYMENT_ALLOCATION_PLAN D5 is unbuilt). Overpayment/no open pledge silently becomes a "general gift". Refund request/approval are per-row details forms; the approval tables show household name only. Refund list shows the last 10 only. No search by household/receipt/amount; "Recorded by" and status badges are mixed. Duplicate warning exists for Zelle only.
- **Assistant:**
  | Say | R/W | Backed by | Confirm |
  |---|---|---|---|
  | "Record a $251 check #4417 from the Shah family, envelope 18, received today" | W2 | `findHouseholdsAction` -> `openPledgesAction` -> `recordOfflinePaymentAction` (insert `payments`, then insert `payment_allocations`; not atomic, no idempotency key) | card with household_card (user picks the ID, never the name), allocation preview from `previewAllocation`, "queues a QuickBooks sales receipt" |
  | "Which checks and cash haven't been deposited yet?" | R | `payments` where provider offline, method check/cash, `deposit_bank_transaction_id` null | none |
  | "Apply receipt R-2101 to the building-fund pledge" | W2 | `applyPaymentAction` | card with before/after pledge balances |
  | "Request a $51 refund on R-2093: duplicate card charge" | W3 request | `requestRefundAction`; after the second approver, `recordRefundAction` (offline/bank), `refundThroughProviderAction` (Stripe/PayPal, step-up), `recordPaypalRefundAction` (email-only PayPal) | W2 card; one refund request per payment (DECISIONS #8) |
- **Stays visual / fresh design:** the payments ledger and the side-by-side allocation preview. Replace the page with three things: (a) a **Record** sheet reachable from anywhere and from the household page, (b) a **Needs attention** queue (DAF to match, flagged refunds, unapplied payments, undeposited checks) and (c) the ledger with real search. Add a confirm step that shows the allocation outcome. Show the household card on every refund row.

### S3. Bank reconciliation — `/giving/payments/bank` (incl. Zelle reports)
- **Route / roles:** `bank` (giving.view | record_offline). Import: giving.manage | record_offline. Confirm: record_offline | manage. Ignore: giving.manage. Add account: accounting.manage. Zelle report settings: giving.manage | integrations.manage; changing the Zelle payee needs a second person with giving.approve (0597).
- **Jobs:** import the Chase CSV; match each credit to a household; match batch check/cash deposits to recorded payments; ignore transfers; work members' "I sent a Zelle" reports.
- **Pattern / friction:** Account switcher (GET form + Switch button), Import card, 7 tabs with counts (Gifts to match, Check & cash deposits, Card payouts, Money out, Matched, Ignored, Zelle reports), then one Card per line (20/page): statement fields on the left, matcher on the right (suggestions as household_cards with score; "Confirm match" one click, "Options…", or find household). Ambiguous names force an "I checked the IDs" tick (good). Friction: one line at a time, no keyboard/auto-advance, no "confirm all unambiguous"; import needs the CSV parsed in the browser (`bank-import.tsx` -> `parseBankStatementCsv` -> `importBankLinesAction(lines)`); "Ignore" and "Restore" hide in expanders; "Learned payer names" and "Add a bank account" are stranded at the bottom; the page makes 20 `suggest_bank_matches` calls plus 6 count queries per render. "Money out" is a dead end.
- **Assistant:**
  | Say | R/W | Backed by | Confirm |
  |---|---|---|---|
  | "Match every exact Zelle report" | W2 batch | RPC `confirm_exact_zelle_matches` (<= MAX_BULK_PAIRS; re-checks each) via `confirmExactMatchesAction` | one card listing pairs with household_cards, total |
  | "What's unmatched from the last import and who is it probably?" | R | `bank_transactions` + `suggest_bank_matches` (needs a batch RPC) | none |
  | "Match the $500 Zelle from RAHUL SHAH to household JSH-H-2041" | W2 | `confirmBankMatchAction` -> RPC `confirm_bank_match` (atomic: payment, allocation, QuickBooks queue, learns payer name) | household_card shown; two "Rahul Shah" households must be chosen by ID; DAF/matching names are never learned |
  | "These three checks and $140 cash make the $1,840 deposit" | W2 | RPC `suggest_deposit_payments`, `match_deposit` (exact total enforced) | total shown vs deposit |
  | "Import this Chase statement" (attachment) | W2 | `importBankLinesAction` (needs server-side parse; `parseBankStatementCsv` is pure so it can move) | summary: N new, M already imported (fingerprint dedupe) |
  | "Ignore the transfer between our own accounts" | W1 | `ignoreBankLineAction` (with note) | one line |
- **Stays visual / fresh design:** reconciliation must stay a **two-pane workspace**: statement line left, candidate households right as full cards, deposit matcher with a live running total. Fresh: queue-style auto-advance and keyboard shortcuts, a "confirm all unambiguous >= 95%" bulk with preview, one shared "match queue" component that also serves QuickBooks donor matching (S11). The assistant handles the long tail ("why didn't this match?").

### S4. Opportunities (builder + list) — `/giving/opportunities`
- **Route / roles:** `campaigns` (giving.view | manage); create/edit/publish: giving.manage; publishing also drafts a member alert (needs comms.send).
- **Jobs:** build what members see in the Give tab (sponsorship tiers, fixed pujan lists, preset amounts, open amount), choose recurring options, schedule visibility, alert members, close when taken.
- **Pattern / friction:** Campaign-progress bars + big builder form + table of opportunities (Edit via `?edit=` full reload, Close/Reopen/Hide). Type changes the whole row grid. Recurring needs frequencies + an email template or it errors. Publish also writes a Communications draft (reported only in a toast). The campaign must already be *published* or publish is refused, and the fix is on another page. No duplicate-last-year. "Preview in app" drawer is good.
- **Assistant:**
  | Say | R/W | Backed by | Confirm |
  |---|---|---|---|
  | "Create a Diwali pujan list under Temple construction: Mangal Divo $501, Aarti $251… save as draft" | W1 | `saveOpportunityAction({publish:false})` | preview card (same as builder) |
  | "Publish it and alert all members" | W2 (member-visible, creates a comms draft) | `saveOpportunityAction({publish:true})`, `previewAudienceAction` for the recipient count | confirm with recipient count |
  | "How many sponsorship tiers are taken?" | R | RPC `opportunity_availability` | none |
  | "Close Swamivatsalya, it's full" | W1 | `setOpportunityStatusAction` | one line |
  | "Copy last year's Paryushan opportunity, +10%" | W1 | no duplicate command exists | needs a new command |
- **Stays visual / fresh design:** keep "Preview in app" and the progress bars. Fresh: describe-then-review. The assistant fills the builder on screen, the human reviews and presses Publish. Merge Campaigns and Opportunities into one Fundraising tree (campaign -> its opportunities) so the "publish the campaign first" bounce disappears.

### S5. Campaigns — `/giving/opportunities/campaigns` (legacy `/giving/campaigns` redirects here)
- **Route / roles:** `campaigns`; manage: giving.manage.
- **Jobs:** create a campaign (name, kind, fund, goal, dates, visibility window), publish/close/archive, hide from members.
- **Pattern / friction:** Table (Campaign, Fund, Dates, Goal, Pledged, Paid, Status, Visible) + "New campaign" form below. Three overlapping visibility controls: status (draft/published/closed/archived), the `active` kill switch ("Hide") and the visible-from/until window. Funds can't be created inline.
- **Assistant:**
  | Say | R/W | Backed by | Confirm |
  |---|---|---|---|
  | "Start a Temple Hall campaign, $250,000 goal, restricted fund, from Nov 1" | W1 | `createCampaignAction` (draft) | one line |
  | "Publish it" | W2 (members see it) | `setCampaignStatusAction('published')` | confirm |
  | "How is the construction campaign doing?" | R | pledges/payments totals (computed in the page today) | none |
- **Fresh design:** fold into Fundraising (S4); one status model with a plain-English "Who can see this and when" line.

### S6. Recurring gifts — `/giving/recurring`
- **Route / roles:** `recurring` (giving.view | manage). "Retry now" is gated by `recordPayment` but disabled for everyone.
- **Jobs:** watch active/failed recurring gifts; chase failures.
- **Pattern / friction:** 4 KPI tiles (one is a "—" stub), status chips, table. Read-only: staff cannot retry, pause, change amount or notify a donor who phones in. An Alert admits "Retry now is not available yet".
- **Assistant:**
  | Say | R/W | Backed by | Confirm |
  |---|---|---|---|
  | "Which recurring gifts failed this month and how much is at risk?" | R | `recurring_gifts` (+ `recurringKpis`) | none |
  | "Draft a note to the households whose monthly gift failed" | W1 | `comms_campaigns` draft insert (pattern in `accommodateOthersAction`); needs comms.send | draft only |
  | "Pause the Desai monthly gift" | W2 | **no staff action or RPC exists** (`create_recurring_gift` is member-side) | needs a new RPC |
- **Fresh design:** a failure inbox ("6 need a person") with the provider's reason and one next action; run-rate trend; keep the table for browsing.

### S7. Labh fulfillment — `/giving/labh` (Jain Center only; `KindGate` + `kindFeature: "labh"`)
- **Route / roles:** `labh` (giving.view | manage); manage: giving.manage.
- **Jobs:** schedule the puja for each special-day labh a family took, tell the pujari/teacher, keep the labh menu and its prices.
- **Pattern / friction:** Two tables: upcoming labh pledges (from 14 days ago, 60 rows) with per-row "Mark scheduled" then "Mark done"; labh menu with a per-row edit expander (amount, fulfilled by, offered) and an "Add a labh" expander. The success toast says "Tell the pujari…", a manual hop. Occasion is often blank. A menu price edit is inline with no confirmation.
- **Assistant:**
  | Say | R/W | Backed by | Confirm |
  |---|---|---|---|
  | "What labh is coming up this week and which aren't scheduled?" | R | `pledges` source=labh + `labh_fulfillments` | none |
  | "Mark Sunday's labh as scheduled" | W1 | `markLabhScheduledAction` (per pledge; batch it) | list + one confirm |
  | "Change Abhishek labh to $151" | W2 (price) | `saveLabhOptionAction` | confirm |
  | "Draft the pujari's list for next week" | W1 | Communications draft | draft only |
- **Fresh design:** agenda grouped by date with a printable run sheet; assistant answers "who, what, when" and drafts the pujari message.

### S8. Receipts & statements — `/giving/statements`
- **Route / roles:** `statements` (giving.view | manage); templates: giving.manage; treasurer approval card for go-live readiness.
- **Jobs:** year-end tax statements, reissue on request, edit receipt wording/signer, treasurer approval.
- **Pattern / friction:** Year-end KPI tiles (computed by scanning last year's payments and chunking household lookups), a **disabled** "Generate and send 2026 statements", template editor with live preview and a **disabled** "Preview PDF", treasurer-approval card, then an issued-statements table whose "File" column is a raw storage path with no download. The main job (generate/send) cannot be started from the console.
- **Assistant:**
  | Say | R/W | Backed by | Confirm |
  |---|---|---|---|
  | "Which households gave over $250 in 2025 and have no statement?" | R | `payments` + `statements` (page-side today) | none |
  | "Change the receipt signer to Treasurer Mr. Shah" | W2 (legal wording; resets treasurer approval) | `saveReceiptTemplateAction` | show new preview text |
  | "Generate the 2025 statements" | W2 | **blocked: no RPC or job enqueue; the console cannot start the statements service** | n/a until built |
  | "Reissue the Mehta 2025 statement" | W2 | no action exists | n/a |
- **Fresh design:** a year-end wizard (readiness checks -> three sample statements -> send) with per-household reissue; fix the 2026/2025 label; make the File column a signed download.

### S9. QuickBooks sync — `/accounting/qbo`
- **Route / roles:** `qbo` (integrations.view | manage, giving.view, accounting.manage). Ledger reads: giving.view | accounting.manage. Retry: accounting.manage. Connection card: integrations.view | manage.
- **Jobs:** watch the posting queue; clear exceptions; verify mapping; see payouts vs bank.
- **Pattern / friction:** 4 KPI tiles, Exceptions table (reason, "Suggested fix", "Apply fix"), Connection card, six status tiles, read-only Account mapping, Payouts, then the Posting queue with status tabs and Retry/Retry all. The same failures appear three ways (exceptions card, Failed tile, Failed tab). "Apply fix" only re-queues when the mapping is *already* fixed (`classifyQboException`); otherwise it says "Needs a person", so the label overpromises. Mapping is edited on another page. Fix text is a regex over the error string.
- **Assistant:**
  | Say | R/W | Backed by | Confirm |
  |---|---|---|---|
  | "Why did last week's postings fail?" | R | `ledger_postings.last_error` grouped by cause | none |
  | "Retry the failed postings" | W1 | `retryAllFailedAction` (has a confirm today) | one line; warn "fix the cause first" |
  | "Map Gift packing to Store income" | W2 (accounting config; re-approval needed) | RPC `set_qbo_mapping` (QBO setup actions) | diff card; approval stays with the treasurer |
  | "Reconnect QuickBooks" | link-out | OAuth redirect (`startQboConnectAction`) | user finishes at Intuit |
- **Stays visual / fresh design:** keep the posting table, mapping table and payouts-vs-bank view (reconciliation-style). Fresh: an **exceptions inbox grouped by root cause** ("12 postings failing because Gift packing has no account") where one fix re-queues all 12; filters by type/date/household on the queue.

### S10. QuickBooks setup — `/accounting/qbo/setup`
- **Route / roles:** `qbo`; manage: accounting.manage; connect/disconnect need `can_connect` (integrations.manage) and a fresh 2FA check; approve mapping and approve test post: treasurer, fresh 2FA.
- **Jobs:** one-time onboarding: connect (sandbox or real read-only), choose basis, pull the chart, set posting + go-live date, map ~15 purposes, approve, test-post.
- **Pattern / friction:** One long page of numbered cards that reveal as earlier steps finish, each action behind a typed "Reason (kept in the audit log)". 15 mapping rows each have their own select + Save, and approval is a separate card. The accrual option is selectable but unsupported. Most actions are RPCs (`start_qbo_connect`, `set_qbo_basis`, `set_qbo_mapping`, `approve_qbo_mapping`, `request_qbo_test_post`, `qbo_status`), so this is the most assistant-ready backend in the area.
- **Assistant:**
  | Say | R/W | Backed by | Confirm |
  |---|---|---|---|
  | "Where am I in QuickBooks setup?" | R | RPC `qbo_status` | none |
  | "Map our income accounts to the closest names in the chart" | W2 | `set_qbo_mapping` per purpose, batched | single diff table; auto-reason generated, user can edit once |
  | "Approve the mapping" | W2, human-only | `approve_qbo_mapping` + step-up | assistant opens the step-up modal, cannot bypass it |
  | "Run the test post" | W2 | `request_qbo_test_post`; real company needs the explicit "four real $1.00 entries" tick | the existing warning text + checkbox |
- **Stays visual / fresh design:** stepper with state and the mapping table as a reviewable diff. The OAuth hop stays a visual redirect. The assistant proposes the whole mapping at once; the treasurer reviews and approves once.

### S11. QuickBooks donor matching — `/accounting/qbo/matching`
- **Route / roles:** `qboMatch` (accounting.manage | giving.manage); decide: accounting.manage.
- **Jobs:** link each QuickBooks customer to a household and bring history in; approve/reject suggestions; map the rest; undo; review failed transactions.
- **Pattern / friction:** 5 KPI tiles, "Pull and match" card (3 actions), settings card, 5 tabs (Suggested, Not mapped, Approved, Rejected, Needs review). Suggested rows show the QuickBooks customer beside a full `HouseholdCard`, highlighted evidence signals and a confidence %. Every row needs a typed reason; there is a bulk "approve at or above N%" with one reason. Loads up to 3,000 suggestion rows and pages in memory. AI suggestions already exist as a background job (`qbo.match_suggest_ai`) with human approval, the best precedent for the confirm pattern.
- **Assistant:**
  | Say | R/W | Backed by | Confirm |
  |---|---|---|---|
  | "Approve every suggestion >= 92% where the email matches exactly; reason: email verified" | W2 batch | RPC `approve_qbo_matches` (batches of 500) | count + sample household_cards |
  | "Why was this customer matched to that household?" | R | `qbo_customer_matches.evidence` | none |
  | "Create households for unmatched customers that look like families" | W2 | RPC `create_household_from_qbo` | list; warns about duplicates |
  | "Undo the mapping for Patel" | W2 | RPC `unmap_qbo_customer` | only while no history is in |
- **Stays visual / fresh design:** the QuickBooks-customer <-> household-card comparison with highlighted signals must stay. Fresh: share the bank "match queue" layout, capture the reason **once per batch/session**, and let the assistant work the long tail.

### S12. Month-end close — `/accounting/close`
- **Route / roles:** `close` (giving.view | accounting.close); tick items and lock: accounting.close; lock needs step-up (0154 trigger).
- **Jobs:** confirm the month is clean and lock it; later fixes post as adjustments.
- **Pattern / friction:** Three month chips, a 4-item checklist, a Lock button disabled until ready, modal confirm. Only "exceptions cleared" is data-driven (failed postings for that month and earlier); "payouts matched", "refunds reviewed" and "statements generated" are honor-system "Mark done" ticks, although the data to check them exists (`payouts.matched`, `flagged_refund_count`, `statements`). No month totals, no unlock path, only the last 3 months selectable. The "ready" gate is enforced only in `lockMonthAction`; the database trigger asks for step-up and nothing else.
- **Assistant:**
  | Say | R/W | Backed by | Confirm |
  |---|---|---|---|
  | "Can I close September? What's blocking?" | R | needs a `close_readiness(month)` RPC; today only the failed-postings count and `flagged_refund_count` are queryable | none |
  | "Lock September" | W2 | `lockMonthAction` (+ step-up) | confirm with the readiness evidence |
  | "Mark payouts matched" | W2 (an attestation) | `setCloseItemAction` | assistant must cite the evidence it checked |
- **Stays visual / fresh design:** a readiness panel whose items are computed with a "see the 3 offending rows" link each; lock only when all are green; show a post-lock "adjustments since lock" list. The Lock modal stays.

### S13. Digital bolis — `/bolis`
- **Route / roles:** `bolis` (bolis.view | manage). Manage: bolis.manage. Record in-person: manage | record. "Accommodate others" also needs comms.send.
- **Jobs:** set up bolis for an event, watch pledges live, close (the top pledge becomes a pledge on the household), offer similar labh to the others, put live amounts on the hall TV.
- **Pattern / friction:** Table (ID, Boli, Event, Floor, Top, Entries, Cutoff, Status) -> right-hand drawer via `?boli=` with ranked entries, after-close explainer, hall-display toggle, in-person record form, edit disclosure; auto-refresh every 15 s while open. "New digital boli" form is a second card far below the table. Top/entries are computed by downloading every entry (`list-data.ts`), not via `boli_summary`. The drawer lists families by name + household number (no card). "Accommodate others" creates one draft campaign per family. Founder wording ("pledge", never "bid") is kept in the code I read.
- **Assistant:**
  | Say | R/W | Backed by | Confirm |
  |---|---|---|---|
  | "Create three Diwali bolis: Mangal Divo floor $101 step $21 closes Saturday 9pm…" | W1 | `saveBoliAction` (draft) | preview |
  | "Publish them" | W1 (members see it; existing confirm) | `setBoliStatusAction('open')` | one line |
  | "Who's leading Mangal Divo?" | R | `boli_entries` under RLS (a role without entry access sees top only; the assistant must say so) | none |
  | "Close the Aarti boli now, reason: hall ran out of time" | W2 (creates a pledge) | RPC `close_boli(p_boli, p_reason)`; reason required if early | confirm with winner, amount, household_card |
  | "Draft offers to the other families" | W1 | `accommodateOthersAction` (comms draft) | count + draft-only |
- **Stays visual / fresh design:** the live leaderboard and the hall-TV display stay visual. Fresh: an **event-day board** (big numbers, countdown, winner reveal) and a setup flow driven by the assistant. Show household_card, not name, in the entries list.

### S14. In-person bolis / upload — `/bolis/upload`
- **Route / roles:** `bolis`; bulk upload: bolis.manage; single in-person pledge: bolis.manage | bolis.record.
- **Jobs:** after an event, record results of bolis called in the hall; record single pledges.
- **Pattern / friction:** 3-step bar (Upload -> Validate -> Import), template download, per-row verdicts, then import = for each valid row *insert one entry and close the boli* (`importBoliUploadAction`). One row per boli by design. Not transactional: a row can end "pledge recorded but the boli could not be closed". Rows matched by *exact household name* are valid with a soft note. CSV is parsed in the browser (`parseBoliUploadCsv`). Max 500 rows. The in-person list repeats the digital table and drawer.
- **Assistant:**
  | Say | R/W | Backed by | Confirm |
  |---|---|---|---|
  | (attach a photo/sheet of the hall tally) "Import these results" | W2 (each row becomes a pledge) | `validateBoliUploadAction` (R) then `importBoliUploadAction` | every row's household shown as a household_card; name-only matches must be resolved by ID before import |
  | "Record $501 from household 0212 for Mangal Divo" | W2 | `recordInPersonPledgeAction` | card with the household |
- **Stays visual / fresh design:** the validation grid stays. Fresh: tally sheet in -> proposed rows out -> human resolves each household card -> import; make name-only matches blocking.

### S15. Inventory — `/store` (nav label "Satvik Store", the kind's own word elsewhere)
- **Route / roles:** `store` (store.view | manage); adjust: store.manage.
- **Jobs:** receive deliveries, record waste/returns, see what's low.
- **Pattern / friction:** Stock table (SKU, item, price, stock, reorder at, status) with fixed "−5" / "+10" buttons per row, a separate "Record a stock change" form, recent-changes list. Quick buttons exist for two increments only. Stock change is two writes: insert `inventory_movements`, then update `store_items.stock_on_hand` (`store/actions.ts applyMovement`). **Looks like a bug (read, not run):** migration 0017 already has trigger `inventory_apply` that adds the delta on insert, so the guarded second write (`.eq("stock_on_hand", old)`) no longer matches and the action returns "The change was logged, but … stock count could not be updated". The e2e only checks the final DB value (`e2e/flows/w-events.cjs` step 7). An assistant that reads that error and retries would double-adjust.
- **Assistant:**
  | Say | R/W | Backed by | Confirm |
  |---|---|---|---|
  | "We received 40 kaju katli and wasted 3 ghughra" | W1 | `recordMovementAction` x2 (audited) | one summary line |
  | "What's low on stock?" | R | `store_items` + `isLowStock` | none |
  | "Set Khakhra reorder level to 12" | W1 | `saveItemAction` requires the whole item form; needs a partial-update command | one line |
- **Stays visual / fresh design:** keep the inventory table; add a count-sheet mode (enter counts for all items, show deltas, submit once).

### S16. Menu & pickup — `/store/menu`
- **Route / roles:** `store`; manage: store.manage. "Order and pickup settings" (gift pack price, weekly cutoff, cancellation window, kitchen summary, visibility) writes `centers.rules` and needs **settings.manage**, so a store lead sees it read-only with a plain message.
- **Jobs:** keep the menu and prices, set pickup slots and cutoffs, weekly store settings.
- **Pattern / friction:** Menu table with a drawer editor, settings form, pickup-slot list with per-slot edit expanders, then Add slot, Add item and Add category forms stacked at the bottom. The weekly cycle (3 slots with cutoffs) is retyped every week; no "repeat/copy last week". Price edits (money) have no confirmation. `saveStoreSettingsAction` read-modify-writes the whole `centers.rules` JSON (last write wins).
- **Assistant:**
  | Say | R/W | Backed by | Confirm |
  |---|---|---|---|
  | "Open pickup for next Sunday 11-1 and 5-7, cutoff Thursday 9pm, capacity 60" | W1 (members can order) | `saveWindowAction` x2 | summary |
  | "Add Mohanthal at $8.99, taxable, Mithai" | W2 (price) | `saveItemAction` | price shown |
  | "Pause everything that sold out" | W1 | `saveItemAction` status=paused (needs partial update) | list |
- **Fresh design:** a week planner (slots as a calendar strip with copy-last-week); menu as an inline-editable table; the settings form stays but moves to the top as "this week".

### S17. Orders by pickup — `/store/orders`
- **Route / roles:** `storeOrders` (store.view | manage | pickup); move orders: store.manage | store.pickup.
- **Jobs:** prep list by slot, hand off at pickup, cancel.
- **Pattern / friction:** "This cycle" slot table (click for a Placed/Preparing/Ready board), "Top items to prepare" bars, per-order step buttons, Cancel with confirm. No auto-refresh (only the boli drawer refreshes), no search by order number or name across slots, picked-up and cancelled orders collapse into one footnote line, no payment/collected indicator, cancel has no reason and no member notification shown.
- **Assistant:**
  | Say | R/W | Backed by | Confirm |
  |---|---|---|---|
  | "How many gift packs for Sunday 11am?" | R | orders + lines (`prepList`, `windowCounts` in `lib/store.ts`) | none |
  | "Order 1043 is ready" | W1 | `moveOrderAction` | none (low risk, reversible by status rules) |
  | "Cancel order 1043, customer called" | W1 (member-visible) | `moveOrderAction('cancelled')` | one-line confirm, ask for a reason |
- **Stays visual / fresh design:** the board and prep list must stay visual (kitchen display with big type and auto-refresh; a pickup-counter mode with order-number search/scan). The assistant adds hands-free updates for volunteers.

### S18. Center health — `/reports`
- **Route / roles:** ACCESS `reports` (reports.view | people.view | giving.view); each card is further gated (membership cards need people.view | manage; giving cards need giving.view | manage).
- **Jobs:** board/exec snapshot: households, app adoption, given YTD vs last year, open pledges, event visits, renewals due, campaign and zone breakdown, membership matrix, money by method.
- **Pattern / friction:** Year selector (GET), 6 KPI tiles, 2 bar blocks, 4 tables. ~14 queries per load (9 full scans <=50k rows summed in Node). No drill-down except one "aging report" link, no export/print/schedule, no custom range. "Giving by campaign" shows *pledged* while the "Given YTD" tile is *cash received*, so "giving" means two things. The subtitle "Built on the warehouse" is not true of the implementation.
- **Assistant:**
  | Say | R/W | Backed by | Confirm |
  |---|---|---|---|
  | "How much did we raise for the temple fund this year vs last, by month?" | R | **needs new aggregate RPC/view** (e.g. `giving_summary(period, dimension)`) under RLS; today only page code | none (donor amounts respect giving.view) |
  | "Which zones have the lowest app adoption?" | R | households/zones/`center_users` (page code today) | none |
  | "Give me the open-pledges list as CSV" | W2 (donor data export; step-up per `app.record_export`) | no export in any money screen; a step-up download pattern already exists (`components/step-up-download.tsx`, `events/feedback/export/route.ts`) and can be reused | confirm + step-up |
- **Stays visual / fresh design:** KPI tiles and bar charts stay visual. Fresh: tiles are *saved questions* the assistant can edit; every number has "explain this" (definition + rows); drill-down to the ledger. Resolve "giving" vs "pledged" explicitly.

### S19. Community dashboard — `/reports/community`
- **Route / roles:** `publicKpis` (reports.view | settings.manage); publish/unpublish: settings.manage.
- **Jobs:** choose which KPIs appear on the public `/c/<slug>` page (aggregates only, groups < 10 hidden).
- **Pattern / friction:** One table, one Publish/Unpublish button per KPI; each click saves immediately (public exposure) with no confirm and no preview of the value that would be shown.
- **Assistant:**
  | Say | R/W | Backed by | Confirm |
  |---|---|---|---|
  | "What's public right now?" | R | RPC `public_kpi_catalog` | none |
  | "Publish attendance and families supported; keep Jeevdaya members-only" | W2 (public exposure) | `setKpiVisibilityAction` x N | show each KPI's current value and the under-10 suppression note |
- **Stays visual / fresh design:** toggles on the left, live public-page preview on the right.

### Redirect pages (no UX)
`/giving/bank` -> `/giving/payments/bank`; `/giving/campaigns` -> `/giving/opportunities/campaigns` (`hrefWith` keeps query params).

---

## C. What would block or complicate an assistant (cite-able)

1. **Allocation is client-mirrored and money recording is not atomic.** `lib/allocation.ts` mirrors `allocate_payment` because "0011 revokes it" from clients. `giving/payments/actions.ts recordOfflinePaymentAction` inserts `payments`, then `applyToPledges` inserts `payment_allocations`; there is a retry path ("Try applying it again") but **no idempotency key** (the UI tells the user to check the list before retrying). PAYMENT_ALLOCATION_PLAN D1 (shared allocation sheet), D2 (direct-gift pledges), D5 (unapplied list) are unbuilt. An assistant needs one RPC (`record_offline_payment_with_allocation(client_token, …)`).
2. **Aggregates exist only as page code.** Reports (9 scans), aging, year-end KPIs, recurring KPIs, opportunity totals, boli totals. The assistant cannot reuse them; it needs read RPCs/views under RLS with a defined meaning of "given" vs "pledged". Also decide donor-amount masking: the `giving.amounts` entitlement in `docs/parity/p3` is not implemented.
3. **No shared command layer.** Action files mix auth (`authorizeAction`), validation, DB writes and message text, and have two signatures: FormData `(prev, formData)` for `useActionState`, and typed objects for client-called actions. Recommend `src/lib/commands/*` (pure validate + RPC) used by both forms and assistant tools, each declaring `risk` (read/W1/W2/W3), `stepUp`, `twoPerson` and a `preview()`.
4. **Two-person requests are direct table UPDATEs.** `requestWriteOffAction` and `requestRefundAction` update `pledges.written_off_by` / `payments.refund_approved_by`; the DB triggers enforce two different people (good), but there is no `request_*` RPC and `approve_as_second` has no reason parameter. Fine to wrap, but a first-class RPC with reason would make audit and assistant previews cleaner.
5. **The month-lock gate is application-only.** `accounting/close/actions.ts lockMonthAction` checks the checklist; the database trigger (`step_up_accounting_periods`, 0154) checks step-up only. Move the gate into the database before any non-UI caller can lock a month; make the three manual items data-derived.
6. **Features the assistant cannot offer yet:** generate/send year-end statements and PDF preview (disabled; "statements service not connected"), recurring retry/pause (disabled / missing), reissue statement, partial-update commands for store items, duplicate opportunity.
7. **File inputs are parsed in the browser.** Bank CSV (`bank-import.tsx` -> `parseBankStatementCsv` in `lib/csv.ts`) and boli CSV (`parseBoliUploadCsv` in `lib/bolis.ts`) are pure TS and can move server-side, but both imports are non-transactional (bank: bulk insert, then per-line fallback on 23505; boli: entry insert then `close_boli`, per row).
8. **Probable stock-adjust bug** (S15). Fix before the assistant retries on error text.
9. **Names-only spots** (A.9): refund tables and boli upload. The assistant must always resolve households through `findHouseholdsAction` / `resolve_identifier` and present `household_card`.
10. **Step-up (2FA) is a UI round-trip.** Actions return `{ stepUp: true }` and `ActionForm`/`StepUpProvider` (`components/step-up.tsx`) verify then retry once. The assistant surface must reuse `useStepUp().run`. It is asked only of people with an authenticator app or when `security.require_2fa_for_staff` is on (JSH currently off), so behaviour differs by person.
11. **Where the assistant must run.** The portal never uses a service key (grep: none in `src`); every action builds the signed-in user's cookie client (`lib/supabase/server.ts`, `lib/session.ts loadSession`), so RLS is the enforcement. The only AI today is in the background worker (`niva.answer`, `qbo.match_suggest_ai`, DB role `connect_worker`, no user session). The staff assistant must run in the Next server with the user's session and call the same commands; it must not queue writes through the worker.
12. **Concurrency.** Status moves use optimistic guards (`.eq("status", …)`), good. `saveStoreSettingsAction` rewrites the whole `centers.rules`; two editors can overwrite each other.

---

## D. Rules the redesign must keep (all verified in code)

- **Errors in plain English, next to the action, with retry.** `failure()` in `src/lib/errors.ts` ("Could not <do thing> — <reason>."), `QueryError` with "Try again", `ActionMessage` + toast. Assistant replies must reuse the same sentence and offer the retry as a button, never "Done" on failure. For money writes without idempotency, say "check before retrying".
- **Households are never picked or confirmed by name alone.** `HouseholdPicker`/`HouseholdCard`, `app.household_card`, ambiguity tick-box in `gift-line-matcher.tsx`. Include the card in every assistant confirmation, including approvals.
- **Money is integer cents** (`*_cents`, `parseAmountToCents`, `formatCents`). Format at the edge only; the assistant tool layer should pass cents, not floats.
- **Bolis say "pledge", never "bid".** Applies to assistant copy too.
- **Two-person rule stays** for refunds, write-offs, payee changes (`app.approve_as_second`, `request_payee_change`/`decide_payee_change`, `approve_flagged_refund`). One refund request per payment (DECISIONS #8). A platform admin's blanket rights don't count for payee changes (ROLES.md).
- **RLS is the enforcement; UI checks (`lib/permissions.ts`) are convenience.** When RLS would show nothing because of permissions, say "You don't have access to this area" (`NoAccess`), never an empty table. The assistant should say what it could not see and why (e.g. "your role sees the top pledge but not individual entries").
- **Never a service key**; act with the signed-in user's rights (see C.11).
- **Audit:** reasons travel as `x-audit-reason` (`dbWithReason`); keep that for every W2/W3 command.
- **Money-rule/permission/delete changes need the owner** (CLAUDE.md PR rule), including any change to allocation, refunds, write-offs or RLS that the assistant work requires.

---

## E. Suggested shape of the fresh money experience (summary)

1. **A treasurer desk, not module tabs.** One "needs me" queue built from sources that already exist in `lib/data/home-tasks.ts` (refund, writeoff, payee, credit, deposits, quickbooks, inventory, bolis) plus unapplied payments, with an ask bar on top. Every row opens the same visual card the old screen used (reconciliation pair, household_card, allocation preview).
2. **Propose -> preview -> confirm cards** for every W2/W3 action, executed through the existing commands under the user's session, with the step-up modal and a one-time reason (captured once per batch).
3. **Household-centric record and lookup** reachable from anywhere: "Record payment for…", "what do they owe", "their statement", "their QuickBooks status".
4. **Keep visual:** bank/QuickBooks two-pane matching, deposit matcher with running total, ledgers with real search/export, aging bars, close readiness panel with evidence, QBO mapping diff, kitchen board/prep list, inventory table, KPI/chart dashboard with drill-down, public-dashboard preview.
5. **Fix first (in this order):** idempotent atomic record-payment RPC; stock-adjust double write; aggregate read RPCs; month-lock gate in the database; derive the manual close items; name-only refund rows and boli upload matches; then build the command layer.
