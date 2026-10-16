# Offline payment proofs, soft credit, and smart bank reconciliation

**Wording (2026-10-16):** Called "payment confirmation" on screen; "proof" is the internal name.

**Status (2026-10-15): the owner accepted the plan and every recommended answer (Q1-Q20), and added one rule: the outstanding open
balance never includes soft credit or reconciled money (section 3.1). Nothing is built. The prototype screens are drawn
(docs/handoff/prototypes/payment-proofs-2026-10/, live canvas https://claude.ai/artifact/FU2zQgj6rsvnAGM4obYm69); each build slice
still waits for its own OK before merge.** It answers the
owner's two requests of 2026-10-15. Every slice below changes a money rule, a permission or RLS, so each needs the owner's explicit
OK before merge (CLAUDE.md), after an independent review. Prototype screens (mobile + CRM) follow only after this plan is approved.

Facts were read from `main` (crm `49397201`, migrations through 0786) and from connect-mobile 1.25.0. Where the plan says "today", it
names the file or migration. Words follow the founder rules: **pledge** (never "bid"), integer cents, households shown with their
`household_card`, no organization-specific wording (every rule below is per organization and neutral).

## 0. In one page

| | |
|---|---|
| **Request 1** | A member who pays by cash, check, ACH, stock or any other offline way attaches a receipt photo/file where they pay (event RSVP, store checkout, Open pledges against the total open balance). The pledges it covers, oldest first, become **Soft credit**. The treasury team gets a **verify task**. Approval makes the pledges **Paid**, with the proof kept as evidence for the number of years the admin sets. |
| **Request 2** | The treasury team uploads a bank statement. Every incoming line is tried against what the system already believes about that money (recorded payments awaiting the bank, soft-credit proofs, Zelle reports) **before** it may touch any open pledge. A line that is already explained must never close another pledge. |
| **Final states** | Every pledge ends **Bank reconciled**, **Written off** or **Cancelled**. Path: Open → Soft credit / Paid → Bank reconciled. |
| **Biggest risk** | Double counting: the same money closing pledges twice (once by the proof route, once by the bank line). Today `confirm_bank_match` (0742:30) always creates a *new* payment and guards only a hand-recorded Zelle (CCDUP). The plan's central safeguard (section 5) makes "already explained" the first question for every bank line and enforces it in the database, not only in the screen. |
| **Slices** | 8 slices (section 9). The duplicate guard ships *with or before* soft credit, never after. |
| **Owner decisions** | 20 questions with recommended answers (section 10). Q1 asks you to confirm how I read the unfinished last sentence of request 2. |
| **Size of the change** | A new pledge status is read in about 40 SQL functions and TS files, 28 test files and 7 mobile files (section 3.4). Money-moving readers stay *excluded* by default, so the new state fails closed: a soft-credited pledge cannot be closed a second time by new money. |

## 1. What was asked, and how I read it

1. Offline payment (cash, check, ACH, stocks, anything else): the member can upload or photograph a receipt at the payment screen
   (event RSVP, store checkout), and on the **Open pledges** screen against the **total open balance**.
2. The payment marks the pledges it covers, **oldest first**, as **Soft credit** (status Open → Soft credit).
3. The proof appears in the treasury team's screen as a **task** to verify. On approval the pledge is **Paid**, with the proof as evidence.
4. Evidence is kept a number of **years the admin sets**.
5. Every pledge's final state: **bank reconciled**, **written off** or **cancelled**. Open → Soft credit / Paid → Bank reconciled.
6. The treasury team uploads a **bank statement**; Zelle, checks, ACH and the rest are reconciled against members' open or soft-credited
   pledges, "extremely smartly". If a soft credit was given, the treasurer already closed the pledge, and the same payment now shows on
   the statement, the system **must not close any additional open balance**.
7. The last sentence reads: *"However system wont know so if system sees any pledges closed thru soft credit route WITHOUT bank
   reconciliation."* It stops there. **My reading (Q1):** a pledge that was closed by the soft-credit route and has no bank line yet is
   "paid, awaiting the bank". When any bank line arrives, the system first asks whether that line is the money behind such a pledge, and
   attaches it there. It only treats the line as new money when no such pledge or proof can explain it. Please confirm or correct.

## 2. What exists today (the plan builds on all of this)

| Topic | Today | Where |
|---|---|---|
| Pledge status | `open`, `partially_paid`, `paid`, `written_off`, `cancelled`. `paid_cents` is the sum of `payment_allocations`. | 0003:10; `recompute_pledge_status` 0104:357 |
| Allocation | `allocate_payment(payment, pledge_ids?, apply)`: named pledges first, else earliest `pledged_at`; only `open`/`partially_paid`; leftover stays on the payment. | 0104:41 |
| Offline payment | `record_offline_payment` inserts `provider 'offline'`, status `captured`, then allocates. Staff only (`giving.record_offline` or `giving.manage`). | 0104:378 |
| Methods an org accepts | `center_payment_methods`: check, cash, zelle, ach, stock, daf, matching_gift, other, each with an `accepted` flag and member instructions. | 0211:66 |
| "On the bank" for a payment | `payments.deposit_bank_transaction_id` set and status `settled`. Cash/checks by `match_deposit` (exact total of the chosen payments, 0742:154); Zelle/ACH hand-recorded by `attach_bank_line_to_payment` (0742:317); card by payouts. | 0742, 0744 |
| Bank lines | `bank_transactions`: channel (zelle, check, ach, card_payout, cash_deposit, wire, other), parsed payer, reference, fingerprint de-dupe, status unmatched/suggested/matched/ignored/payout. Statement formats today: `generic_csv`, `chase_csv`. | 0012:207; bank/actions.ts:390 |
| Suggestions | `suggest_bank_matches` ranks **households** (known payer name 0.95, member name 0.70, IDs in the memo 0.90, a member's Zelle report 0.80-0.99); +0.04 when an *open* pledge equals the amount. It never looks at soft credit or at payments waiting for the bank. | 0742:189 |
| Confirming a line | `confirm_bank_match` always **creates a new payment** (`provider 'bank'`, `settled`), allocates oldest first (or the report's pledges), queues QuickBooks. Duplicate guard only for Zelle recorded by hand (SQLSTATE CCDUP, reason to override). | 0742:30 |
| Deposit suggestion | `suggest_deposit_payments`: unbanked check/cash/stock/other payments in the 21 days before the line; "exact" only if **all** candidates total the line. | 0742 (body 0104) |
| Counts | An offering count can be linked to a bank line (one per line). | 0744 |
| Member Zelle report | "I sent a Zelle": a separate table, credits nobody, never counted in totals; the treasurer matches the bank line. No attachment of any kind. Owner decision 2026-10-02. | 0582, 0583 |
| Planned, unbuilt | `PAYMENT_ALLOCATION_PLAN.md` D8: a private `payment-evidence` bucket (7 years) for Zelle screenshots. **This plan replaces D8** (one evidence system for every method). | docs/PAYMENT_ALLOCATION_PLAN.md §5 |
| Notifications to members | `enqueue_message` / `enqueue_notice` with templates; push to the login, email to the address. **No email provider is configured today** (2026-10-15), so push and in-app are what reach people. | 0582:177, 0598:106 |
| Notifications to the treasury team | **None by push or email.** Giving tasks reach treasurers only as the Home list and the sidebar badge. The single staff-push precedent is homework reviewers. | tasks.ts, home-tasks.ts, 0587:620 |
| Treasury tasks | `TASK_SOURCES` gives each task a permission list and a module; the loaders are an exhaustive record, so a new task type is a compile-time-checked addition. Today's queue (approvals, bank, pledges, counts, books) and Home read the same list. Home counts Zelle reports only when `unmatched`, not `reported`. | src/lib/tasks.ts:53, data/home-tasks.ts:69, giving-today/queue.ts:1082 |
| Roles | `treasurer`: giving.view / manage / approve / record_offline, accounting.manage / close. `finance_volunteer`: giving.record_offline only. `center_admin`: giving.view only. The owner passes every permission check. Second approver = a different person with `giving.approve` (`approve_as_second`, `enforce_two_person`). Step-up (TOTP) is not on record payment, bank match or pledge edits. | seed.sql:16, 0104:497, 0411, ROLES.md |
| Storage buckets | Ten buckets, nine private. A new bucket means redefining the four literal `storage.objects` policies, `can_read_object` / `can_write_object`, the scan-bucket and retention lists, `connect_storage_buckets`, `center_storage_overview` and the TS lists in `setup.ts`. Server Actions cap at 11 MB, so portal uploads use a signed upload URL; the mobile app uploads directly (homework pattern). | 0587:1689-1710, 0589:280-398, setup.ts:270, next.config.ts:22 |
| Retention today | Days, not years: `centers.rules.storage.retention_days.<bucket>` (1-3650, only imports, recordings and homework editable), a daily worker job deleting through the Storage API on the **upload** date, audited as `storage.retention_delete`; Settings › Storage (`settings.manage`). **No legal hold, no anonymization job** exists; the privacy page's "kept 7 years, then anonymized" is copy only. Statements show "7 years" as a label with no job behind it. | 0587:1592, worker/handlers/storage.retention.ts, settings/privacy/page.tsx:172 |
| Virus scan | Queue built (`storage.scan`), default mode **off**, no worker claims jobs, ClamAV not installed. | 0589:98, DEPLOY.md:275 |
| "Not yet on the bank" | Implicit only: an offline payment with no deposit link and status `captured`/`pending_clearing`. No flag, no screen. The month-close checklist (4 items) checks nothing about unmatched lines or undeposited money. | 0104:396, giving.ts:550 |
| QuickBooks | An offline receipt posts at record time into Undeposited Funds; a Deposit (`deposit:<line>` key) is queued when the bank line is matched. Pledges never post. | 0191:90, 0783 |
| Statement import | Browser-parsed CSV; only the file name is stored (`file_path`). | bank/actions.ts:52 |
| Naming clash | "Credit" already means unallocated payment money (`household_credit`, 0543). CatchTheMatch's plan uses "soft credit" for a company match. This plan uses the owner's words "Soft credit" for pledges (Q20). | 0543, docs/CATCH_THE_MATCH.md |
| Mobile: offline methods | The member **cannot choose** an offline method. Offline methods appear as read-only "how to give" text. Only Zelle can be reported. | mobile features/pay/offline.ts, host.tsx |
| Mobile: where a payment screen exists | RSVP "Pay now / Add as pledge" (event/[id]/index.tsx), tickets, cart ("Place order · pay at pickup" inserts `store_orders` only: **no pledge, no payment**), opportunity, labh, Pathshala fee ("Pay at the office", records nothing), pledges and give tabs. | mobile survey |
| Mobile: camera and files | `expo-image-picker` (gallery) is installed; `cameraPermission` is **off**; no `expo-document-picker`, no `expo-image-manipulator`. Adding them needs `runtimeVersion` 5 and a new APK (README gap #31, homework "attach a file" is waiting for the same build). The homework upload (`lib/api/homework.ts`) is the pattern to copy. | mobile survey |
| Store orders | `store_orders.payment_id` exists; there is **no pledge link**. | 0005_store.sql |
| Accounting basis | Cash basis; QuickBooks posts from payments. A pledge posts nothing. | DECISIONS.md:90 |

## 3. The model

### 3.1 Pledge states

| Shown to people | Stored as | Meaning | Counts as given? | QuickBooks | Reminders |
|---|---|---|---|---|---|
| **Open** | `open` / `partially_paid` (unchanged) | Nothing, or only part, is covered | No | Nothing | Yes |
| **Soft credit** | `soft_credit` (**new**) | Fully covered by claims that the treasury team has not verified yet | No ("pending" in the member app) | **Nothing** | Paused |
| **Paid** | `paid` (unchanged) | Verified payment(s) cover it; the proof is evidence | Yes, on the payment date | Payment posting as today (undeposited funds) | Stop |
| **Bank reconciled** | `paid` **plus** `reconciled_at` (**new column**) | Every payment on it is matched to a bank line, deposit, count or payout | Yes | Deposit posting as today | Stop |
| **Written off** / **Cancelled** | unchanged | Final | No | As today | Stop |

* Final states are: Bank reconciled, Written off, Cancelled. Not final: Open, Soft credit, Paid-but-not-on-the-bank.
* **What each audience sees.** Members see Open, Soft credit, Paid (and Written off / Cancelled). "Bank reconciled" is the treasury
  team's state, shown to staff on the pledge, household and reports; the member app may show a quiet "confirmed by the bank" tick
  (Q3). Both audiences see the same history on the pledge's timeline.
* **Why `reconciled_at` and not a sixth status (Q3).** Code reads `status = 'paid'` in many places (for example mobile tickets,
  `tickets.tsx:128`). Turning reconciled pledges into a different status would make a fully paid pledge look unpaid there. A column
  adds a state without breaking any reader. The screens still show the four words the owner used.
* **Partial cover (Q2).** Soft credit is a *status* only when `paid_cents + soft_credit_cents >= amount_cents` and `soft_credit_cents > 0`.
  The last pledge a claim only partly covers stays Open / Partly paid and shows a chip "Soft credit $X waiting", exactly like the
  Zelle "Reported" chip today, so its remainder is still payable.
* **Two numbers per pledge.** `paid_cents` keeps its meaning (verified allocations only), so giving totals, statements and
  QuickBooks do not change. New `soft_credit_cents` is the sum of active soft credits.
  **Owner rule (2026-10-15): the outstanding open balance excludes soft credit and reconciled money.** On every screen, for members
  and for the treasury team alike, Open balance = amount − paid − soft credit, summed over pledges that are Open or Partly paid. A
  pledge in Soft credit, Paid or Bank reconciled adds nothing to it. Soft credit is reported as its own figure ("Soft credit,
  waiting to be verified"), never inside Open. Giving totals still count only verified payments.
* One function, `app.recompute_pledge_status` (replaced), is the only writer of `status`, `paid_cents`, `soft_credit_cents`,
  `closed_at` and `reconciled_at`. Written-off and cancelled stay sticky as today (0104:357).

### 3.2 Proof (claim) states

`submitted` → `approved` | `rejected` | `withdrawn` | `needs_info` (back to `submitted` when the member answers) |
`merged` (the proof became evidence on a payment that already existed) | `auto_reconciled` (a bank line settled it; see 5.5).
Each change writes an event row (plain-language timeline for the member) and an audit row.

### 3.3 Where the data lives

| New | What |
|---|---|
| `app.payment_proofs` | One row per claim: household, submitting adult, entry point (`open_pledges`, `rsvp`, `store`, `opportunity`, `labh`, `pathshala_fee`, `membership`, …) and its reference id, method (the org's accepted offline methods), claimed amount, paid-on date, reference (check no., ACH trace, share count), note, state, decision, reason, `payment_id` once approved, `bank_transaction_id` if a line settled it, `is_test`. |
| `app.payment_proof_files` | Up to 5 files per claim: storage path, type, bytes, **SHA-256**, uploaded by, `deleted_at` + reason (a tombstone stays after retention purge). |
| `app.soft_credits` | `(proof, pledge, amount, position, state: active / converted / released)`. This is what reserves part of a pledge. It is **not** `payment_allocations`, so no total, statement or posting sees it. |
| `app.payment_proof_events` | The member-readable timeline. |
| `app.payment_evidence` | Links a proof's files to the **payment** after approval (and lets staff attach a photo of a check to a payment they recorded), so evidence outlives the claim row. **Evidence is linked, never copied (owner, 2026-10-15):** a pledge finds its evidence through the payment(s) allocated to it, and through its soft credits while a proof waits, so every pledge a payment credited keeps the proof connected, and a later re-allocation moves the link with the money. `member_visible` is true for files the family sent and false for files staff attached (unless staff choose to share). |
| `app.pledge_evidence(pledge)` | For a pledge in **any** status, every proof and file connected to it: the share of the proof that covered *this* pledge, the state (waiting, approved, merged, not accepted), the payment and receipt, the kept-until date, and, once removed, the tombstone (who, when, "retention"). Read by the household's adults and by staff who verify. |
| `app.bank_reconcile_runs`, `app.bank_line_proposals` | A stored preview of a statement import: per line, the proposal kind, candidates, tier, reasons and the plain-language consequence. |
| Columns | `pledges.soft_credit_cents`, `pledges.reconciled_at`, `payments.reconciled_at` (derived, kept by one function), enum value `soft_credit` (own migration file first: a new enum value cannot be used in the transaction that adds it). |
| Org settings | `centers.rules.payments.proofs`: which methods need a proof, `retention_years`, `legal_hold`, `second_approver_over_cents`, whether soft credit counts for entry/pickup, per-method bank windows. Written only by a `set_…` function with a reason. |
| Storage | Private bucket `payment-evidence` (JPEG, PNG, WebP, HEIC, PDF; 10 MB each), path `<center>/<household>/<proof>/<uuid>.<ext>`, signed URLs of 10 minutes. |

Functions (all `security definer`, `set search_path = app, public, extensions` per 0019): `submit_payment_proof`,
`withdraw_payment_proof`, `answer_proof_question`, `my_payment_proofs`, `payment_proof_queue`, `payment_proof_counts` (the Home task),
`proof_lookalikes`, `approve_payment_proof`, `reject_payment_proof`, `ask_proof_question`, `set_proof_policy`, then for section 5
`reconcile_candidates`, `reconcile_run_create`, `reconcile_apply_row`, `unreconcile`, `unreconciled_payments_report`.

**RLS (the enforcement; the UI checks in `permissions.ts` are convenience).** No role writes these tables directly: every change goes
through the RPCs above. `payment_proofs`, `payment_proof_files`, `soft_credits` and the events are readable by the adults of that
household, and by staff holding `giving.record_offline`, `giving.view` or `giving.manage` (view only for `giving.view`), always inside
the add-on switch and the organization. A child, a volunteer without the permission and another organization read nothing. When RLS
would return nothing because of missing permission, the screen says "You don't have access to this area", not an empty table
(CLAUDE.md). Storage: read by the household's adults and the same staff; write by the household's adults to their own proof path only.

### 3.4 What a new pledge status touches (read from the code, not run)

Status is written in exactly one place today (`recompute_pledge_status`, fired by the `payment_allocations` trigger, 0003:280). But
`in ('open','partially_paid')` is used all over to mean "still outstanding", so a new `soft_credit` value silently drops out of every one
of those reads. That is the *right* default for money-moving code and the *wrong* one for balance reports. Each reader gets a decision:

| Group | Readers (migration or file) | Decision for `soft_credit` |
|---|---|---|
| **Money-moving, stay excluded (fail closed)** | `allocate_payment` / `preview_allocation` (0104:58, 341), `record_offline_payment_once` (0658), `suggest_bank_matches` and `confirm_bank_match` (0742), `report_payment` (0742:699), `edit_pledge` / `_pledge_locks` (0782, which copies the recompute logic), `set_pledge_due_on` (0775), `cancel_my_rsvp` (0543), the Pathshala fee triggers (0591) | Excluded: new money can never close a soft-credited pledge. Edit, delete, write-off and cancel are refused while soft credit stands (A23). `cancel_my_rsvp` creates the orphan task (A24) |
| **Outstanding-balance reads, must be rewritten** | `household_card` (0110:29, the "open pledge $" on every card), `giving_pledges_behind` and `giving_household_summary` (0656), `giving_draft_context` and `giving_second_approver_queue` (0657), `reports_pledges_summary` (0672), `giving_insights` (0749); TS: `giving-lists/pledges.ts`, `giving-glance/summary.ts`, `family-giving.ts`, `home-kpis.ts`, `today.ts`, `giving-workspace.ts`, pledges pages, `pledges-tab.tsx` | **Owner rule: Open balance excludes soft credit and reconciled money**, for members and treasurers alike (amount − paid − soft credit). Every one of these reads is rewritten to that, and soft credit gets its own figure beside it (the card's "open pledge $" is the first one tested) |
| **E-mail and reminder audiences** | scheduled and automatic emails (0771:220, 0780:24, 0770:253) | Excluded (reminders paused), as intended |
| **Labels, filters, exports, imports** | `labels.ts`, `giving-export/csv.ts`, `import/registry.ts`, `approvals/actions.ts`, `payments/actions.ts`, `giving/actions.ts` | New label, filter chip, CSV columns (status, reconciled) |
| **Counted automatically, check intent** | `not in ('cancelled','written_off')` reads (0743:71, 0672:266, 0749:144) | Will count soft credit as live. Review each; probably wanted |
| **Probably unaffected** | year-end statements (payment based, 0522:24), QuickBooks posting (triggered by payments and `written_off`, 0191:90, 0412:108), `household_credit` | Unchanged |
| **Mobile** | `lib/rules.ts:244` (`isOpenPledge`), `pledges.tsx:33/37`, `lib/api/giving.ts:79, 389`, `event/[id]/index.tsx:268`, `confirm.tsx:106`, `tickets.tsx:128/131` (`=== 'paid'`), `lib/pathshala-registration.ts:1160`; `status` is typed `string` there, so only tests guard it | Each updated and covered by a test; Give tab "pay open balance" uses still-to-pay |
| **Tests** | 14 files in `supabase/tests`, 14 in `tests/` and `e2e/` mention `partially_paid`; mobile `rules.test.ts`, Pathshala tests | Updated in slice 1 and 3 |

The design keeps the radius small on purpose: `paid` is not touched, `paid_cents` keeps its meaning, so statements, totals and QuickBooks
need no change. If you would rather not add a status at all, the alternative is a derived "Soft credit" label on top of `open`;
it is cheaper to read but fails open (a reminder could go to someone who has paid, and new money could be allocated to a pledge a
proof already covers), which is the opposite of what you asked for. Recommendation: the new status.

## 4. Request 1: proofs and soft credit

### 4.1 Member app (screens listed in section 8)

* One shared **"I paid another way"** sheet, opened from every place that has a Pay button (`startPayment`), plus the Open pledges
  screen. Steps: method (only the org's accepted offline methods) → amount → date → reference → proof (take photo, choose photo,
  attach file) → review "Where it will go" (the pledges, oldest first, with what each would become) → send.
* **Entry points and what is locked:**
  * **Open pledges:** default amount = total open balance (still-to-pay), editable down or up; pledges selected = those; none selected
    = all open, oldest first.
  * **Event RSVP / tickets:** the RSVP already creates its pledge (`saveRsvp` → `createPledge`, source `rsvp_commitment`); the claim is
    **bound to that pledge** and the amount is locked to it. Extra money is done from Open pledges.
  * **Store checkout "pay at pickup":** today no pledge exists. Placing a pay-later order will create a pledge (source `store`,
    `source_ref_id` = order) so there is something to credit (Q8). Amount locked to the order total.
  * **Opportunity, labh, Pathshala fee, membership:** same sheet where their Pay sheet appears.
* **After sending:** the pledge pill reads "Soft credit · waiting for the treasury team"; a "My payment proofs" list shows the
  timeline and files. The member can withdraw until a decision; "needs a clearer photo" lets them add files.
* **Pledge details (new screen; today a pledge row opens nothing).** Tapping any pledge, in **any** status and from any year, opens
  its details: amount, status timeline, the payment(s) and receipt, and **"Your proof"** with the photos or files the family sent,
  the share each proof covered *of this pledge*, and "You can open this until Dec 31, 2033". A payment that credited three pledges
  shows the same proof on all three. A pledge paid by two proofs shows both. A proof that was not accepted stays visible with its
  reason for 13 months. After the years run out the files are gone, but the pledge says so plainly ("The photo was removed on
  <date> after 7 years, as your community's rule says. Your receipt R-2026-0412 stays."). Closed pledges are reached from the
  **Closed** filter on Open pledges and from the giving history.
* **Adults only**, as the Zelle report (a child sees "ask a parent"). Either adult of the household can see and withdraw.
* **Errors are always surfaced** (CLAUDE.md): a failed upload says what failed and offers retry; "Sent" is shown only after the
  claim row exists. The claim is created in one RPC *after* the files are uploaded; orphan uploads are removed after 48 hours.
* **Camera and files need the next APK** (runtime 5). Until then the sheet offers "Choose a photo" (gallery) only, which works by OTA
  (Q17).

### 4.2 Allocation rule (the "oldest first")

* Order by `pledged_at`, then `created_at`, then `id`, among pledges of the household with `amount − paid − soft credit > 0`, status
  `open`/`partially_paid`; selected pledges restrict the set. This is the rule `allocate_payment` already uses (0104:41).
* Locks are taken in that same order (`for update`), so two adults submitting at once cannot over-reserve a pledge or deadlock.
* Non-gift pledges (Pathshala fee, boli, labh, store) are **included** when the member picks them or leaves "total open balance",
  because the owner asked for the *total open balance*. This conflicts with D3 of the unbuilt allocation plan; see Q11.
* Constraint (database, not only code): for every pledge `paid_cents + soft_credit_cents <= amount_cents`.

### 4.3 Treasury verification task

* A **"Proofs to verify"** list in Giving › Today (the same queue/Home-task pattern as Zelle reports: `payment_report_counts` /
  `payment_report_queue`), with a count on the treasurer's Home. Oldest first, aged chips (3 / 7 / 14 days).
  It is a new `TASK_SOURCES` entry (permission list + module), so Home, the sidebar badge and Today read it automatically.
  **Treasurers receive no push for any giving task today**; the Home list and badge are how they find work. An opt-in daily staff
  push digest is proposed (Q19), copying the homework-reviewer precedent (0587:620).
* Each card shows the `household_card` (never a name alone), amount, method, date, reference, **thumbnails with a full-screen viewer**,
  the pledges it would cover, and **automatic flags**: possible duplicate (section 4.4), same file used before (SHA-256), amount or
  date outside the method's usual window, a bank line already waiting that fits (5.5), the pledge changed since the claim.
* Actions: **Approve**, **Approve with changes** (amount, date, method, which pledges), **Ask for more** (message to the member),
  **Reject** (reason required, shown to the member).
* **Approve** (one transaction, exactly once: the payment carries `idempotency_key = 'proof:<id>'`, the `record_offline_payment_once` pattern, 0658): lock proof → lock pledges → insert a payment (`provider 'offline'`, status `captured`, the method,
  `received_on` = the verified date, `check_number`/reference, `recorded_by` = treasurer) → `allocate_payment(payment, soft-credit
  pledge ids in position order, apply)` → soft credits become `converted` → statuses recomputed (Paid) → receipt number and receipt
  (same as a recorded payment) → QuickBooks posting enqueued as `record_offline_payment` flows do → evidence linked to the payment →
  member told. If a bank line already waits for it, the same click attaches it (section 5.5), and the pledge goes straight to Bank
  reconciled.
* **Reject / withdraw:** soft credits `released`, pledges recomputed (Open), reminders resume, reason to the member.
* **Who can verify (Q5):** holders of `giving.record_offline` or `giving.manage` (the treasurer and the finance volunteer today),
  with two rules: nobody verifies a claim from **their own household**; a claim above an org-set amount needs a **second person**
  with `giving.approve` (the write-off and refund pattern). 2FA is not asked here (owner rule 2026-10-13: step-up only for
  admin-level actions).

### 4.4 Duplicate and lookalike detection (used by submit, approve, and statement matching)

`proof_lookalikes(household, amount, method, date, reference)` returns, for any method, within ±7 days (method-specific windows):
payments recorded by hand, payments created from a bank line, other open proofs, and Zelle reports. It generalises
`zelle_recorded_payments` (0583), which covers only Zelle today. Same check number, ACH trace or Zelle confirmation is *certain*;
same household + amount + method + window is *likely*.

* At **submit**: the member sees "A proof for $200 was already sent on Oct 3 by <adult>". It can still be sent with a note (two real
  gifts of the same size happen), flagged for the treasurer.
* At **approve**: a likely/certain lookalike blocks creating a new payment; the treasurer chooses **Merge** (the proof's files become
  evidence on the existing payment; no new payment, no allocation change) or **Different gift** with a typed reason.

### 4.5 Evidence retention

* **Setting:** a "Payment proofs" row in Settings › Storage (`settings.manage`, where the other retention days already live), in
  **years**: `centers.rules.payments.proofs.retention_years`. Default 7, minimum 3, maximum 25 (Q7). Plus a **legal hold** switch
  that stops all purging. Today's mechanism is days on the upload date for three buckets only, with no hold; proofs need years, a
  different clock and conditions, so they get their own eligibility rule, run by the same daily worker job and audited with the same
  `storage.retention_delete` event. Lowering the years asks for a reason and the step-up code (admin-level, like module switches).
* **Clock:** from the end of the organization's accounting year in which the payment date falls. So 7 years means at least 7 full years.
  (The privacy page already promises "kept 7 years, then anonymized" and holds "not tracked"; this is the first real implementation,
  for proofs only. Anonymising the rest of the records is not part of this plan.)
* **A file is purged only when all hold:** clock expired; every pledge it supports is in a final state; accounting period closed;
  no legal hold; no open refund or dispute on the payment. Rejected or withdrawn proofs follow a shorter clock, 13 months (Q7).
* **Purge** removes the bytes, keeps a tombstone (hash, size, type, who, when, "retention") so the audit shows the evidence existed.
  Treasurers get a 30-day notice with an export link before the first purge of a batch.
* **Lowering** the years shows "N files would be purged on <date>" and needs the reason; raising never loses anything. Families
  lose access at the same moment staff do, and the preview says so.
* **The family's access is the same window (owner, 2026-10-15).** A proof the family sent stays openable from every pledge it
  credited for as long as the file is kept, that is at least the years the admin set, counted as above. Access follows who is in the
  household *now*, not who uploaded; a child, a former member and another household never see it. Files staff attached themselves are
  staff-only unless staff share them. A legal hold keeps family access too. Opening a file by a family member is not logged;
  every staff view is.
* **Privacy:** private bucket; reads only by the household's adults and staff with the verify permission; every staff view is logged;
  never in exports, search, e-mail, push or AI prompts; masked in the audit log; photos are re-encoded on the phone (APK) to drop
  location data. Check photos show account and routing numbers, so the sheet says "You may cover your account number; we only need
  the amount, date and check number". The virus-scan queue is wired for the bucket, but it is **off and has no scanner installed
  today** (DEPLOY.md:275), so until it is switched on, uploads are accepted unscanned and restricted to images and PDF by content type.
* **Bucket plumbing (slice 1):** the `payment-evidence` bucket must be added to the four literal storage policies, `can_read_object` /
  `can_write_object`, the scan and retention lists, `connect_storage_buckets`, `center_storage_overview` and `setup.ts`. Portal
  uploads use a signed upload URL (Server Actions cap at 11 MB); the mobile app uploads directly, as homework does.

## 5. Request 2: the bank statement and the reconciliation engine

### 5.1 Invariants (each becomes a database test)

| # | Invariant |
|---|---|
| I1 | A bank line belongs to at most one of: payment(s) of one deposit, an offering count, a payout, "ignored". A payment belongs to at most one deposit line. |
| I2 | For every payment, allocations ≤ amount. For every pledge, `paid + soft credit ≤ amount`. |
| I3 | **A bank line never creates a payment, and never touches an open pledge, while an unbanked payment or a waiting proof of the same household could be that money** (same amount or a subset-sum, compatible method, inside the window), unless the treasurer types why it is a separate gift. Enforced inside `confirm_bank_match` (generalised CCDUP), not only in the screen. |
| I4 | Soft credit writes no payment, allocation, receipt, QuickBooks posting or total. |
| I5 | Attaching a line to an existing payment changes **no** pledge allocation. |
| I6 | `reconciled_at` on a pledge is set only when it is fully paid and every payment allocated to it is reconciled; it clears if any is un-reconciled. |
| I7 | Nothing writes money on a timer. Every attach, confirm or approve needs a treasury click. Only "Tier A" rows may be confirmed in one batch click, each re-checked at apply time. |
| I8 | Every reconcile can be undone with a reason (not in a locked month, as 0744); the undo restores the previous states. |
| I9 | Everything is audited (actor, role, before/after) in the existing hash-chained log. |

### 5.2 What a line is tried against, in this order

1. **Unbanked recorded payments** (the soft-credit route after approval, and hand-recorded): `provider 'offline'`, no deposit line,
   status `captured`/`pending_clearing`. A single payment, or, for deposits, a **subset** of them.
2. **Waiting proofs** (not yet approved).
3. **Member Zelle reports** (today's `payment_reports`).
4. **Offering counts** (0744) for cash deposits.
5. **New money:** only when 1-4 find nothing for the household. Then, as today, allocate oldest first, but **only to pledges not already
   covered** (`amount − paid − soft credit > 0`). A pledge sitting in Soft credit is never a target for new money.

### 5.3 Signals, windows, tiers

* **Signals:** exact amount (hard gate for one-to-one), check number = line reference, Zelle confirmation = reference (today),
  ACH trace/company id, learned bank payer name (`external_ids.bank_payer`), member names (with initials/reversal), Connect or JSH IDs in
  the memo (today), channel/method compatibility, the bank account expected for that method (the Zelle account setting exists, 0583),
  date inside the window, uniqueness.
* **Method compatibility:** check ↔ check or deposit; cash ↔ cash deposit (batch only); Zelle ↔ Zelle (or unlabelled `other`);
  ACH ↔ ACH/other; stock, DAF, matching gift, other ↔ ACH/wire/other.
* **Windows** (line date relative to the claimed or recorded date; defaults an org can change): Zelle −1…+5 days, ACH 0…+7, check
  0…+30, cash 0…+30, stock 0…+30, DAF/matching 0…+60, other 0…+45.
* **Tiers (labels, not invented percentages; sorted by the existing numeric score):**
  * **Tier A, certain:** exact amount, a reference match *or* (known payer name for that household + inside window), exactly one
    candidate, compatible channel and account. May be batch-confirmed.
  * **Tier B, likely:** exact amount + window + one candidate, but the household or reference is inferred.
  * **Tier C, possible:** exact amount + window, several candidates or weak identity. Never a default.
  * **Tier D, conflict:** same household, amount differs. Shows the difference and the options (5.4).

### 5.4 Outcomes the treasurer sees for each line (with the exact consequence in words)

| Outcome | Text on the row | What clicking does |
|---|---|---|
| **Settles a waiting proof** | "This is the $200 check Rahul's family sent a proof for on Oct 3" | Approve + attach in one transaction; pledges go Paid → Bank reconciled |
| **Banks a payment already recorded** | "This is receipt R-123, Paid Oct 6, not yet on the bank. No pledge changes." | Attach (I5). **This is the default for any line that looks like money already counted.** |
| **Banks several payments** (deposit) | "These 4 payments add up to $1,260" | `match_deposit`-style, exact to the cent |
| **Lookalike (blocked)** | "A $200 payment is already recorded for this family. Creating another needs a reason." | Create-new is disabled until "Different gift" + typed reason (I3) |
| **New money** | "No payment or proof explains this. Oldest uncovered pledges first: P-102 $150, P-118 $50" | As `confirm_bank_match` today, minus soft-credited pledges |
| **Short / over** | "Proof says $200, the bank shows $180" | Choose: bank is truth (payment amount adjusted, pledge re-opens $20, reason required, member told), or leave unmatched |
| **Unknown payer** | "No family found. 1 waiting proof has this amount and method." | Suggestion only, with "ask the member" |

### 5.5 Both orders of arrival

* **Proof first, bank later:** approval makes a payment "awaiting the bank" (Paid). The line later attaches (Bank reconciled).
* **Bank first, proof later:** at submit and at approve the system searches unmatched lines; a fitting line turns "Approve" into
  "Approve and reconcile" (the bank is stronger evidence than the photo, but the click is still the treasurer's).
* **Bank line already confirmed by oldest-first, then a proof for a different pledge:** the payment exists and is reconciled; the
  proof is a lookalike. Options: merge the proof as evidence, and, if the member meant other pledges, re-allocate with a reason
  (needs the controlled correction in the allocation plan D6; until then the treasurer is told to adjust by hand). Scenario B6.

### 5.6 Batches and cash

* Deposits are solved as a **bounded subset-sum** over unbanked cash/check/stock/other payments in the window (cap ~60 candidates and
  a time limit), preferring: all candidates, then older first (FIFO), then sets whose check numbers appear in the line text, then
  fewest left over. If more than one set adds up, the row says "2 combinations add up" and picks nothing. (Today only "all candidates"
  is tried, 0742.)
* Cash proofs from members have no individual bank line; they bank inside a cash deposit or an offering count. If a count already
  links the line (0744), those payments are not offered.

### 5.7 Preview first, then apply

Importing a statement stores a **reconciliation run**: a table of proposals grouped by outcome (Certain, Likely, Possible, Conflict,
Already accounted for, New money, Needs review, Money out, Ignored). Nothing is written. The treasurer reviews, un-ticks rows and
applies; each row is its own transaction and is re-validated at apply time (another treasurer may have acted; a claim may have been
withdrawn). Re-running after a late proof or a new payment refreshes proposals; applied rows stay.

### 5.8 Learning and reports

* Payer names and, new, **check-number runs and typical amounts per household** feed the signals; confirming or rejecting a proposal
  adjusts weights only for that organization.
* **"Paid but not on the bank"** report and Home chip: payments from the proof route (and hand-recorded) older than the method's
  window, by age. This is the safety net behind "closed by the soft-credit route with no bank reconciliation".
* **Month-end close checklist** (`accounting_periods`, 4 items today, none about unmatched lines or undeposited money) gets two
  lines: proofs still waiting; paid pledges not reconciled (warning, not a block).

### 5.9 Later, not in the first build

Returned/NSF items (a negative line matched to a reconciled payment, which reverses the payment and re-opens the pledges), a
payment split across several lines, fee-tolerant matching for wires and DAF grants, PDF statements read with Niva and then checked by
a person, and AI reading of a receipt's amount/date as a hint only.

### 5.10 Where it runs

* Candidate search and scoring are set-based SQL, like today's `suggest_bank_matches` (same permission and module checks, 0742:189).
* The preview for a whole statement is computed by a **worker job** and stored (section 5.7), so the page opens at once and a
  few hundred lines never time out a request; the subset-sum is bounded (≈60 candidates, a time cap) and says so when it stops.
* Windows and "today" use the organization's time zone, never the server's.
* Applying a row calls the same small RPCs a person would (attach, approve, confirm), each in its own transaction with its own
  re-check, so there is one code path for money, not a second "bulk" path.

## 6. Scenario catalogue (every row becomes a database or screen test)

### A. Member submits

| # | Scenario | System does |
|---|---|---|
| A1 | Open pledges, total open balance, exact amount | Soft credit oldest first; last one maybe partly covered |
| A2 | Only some pledges ticked | Credit only those, oldest first among them |
| A3 | Amount smaller than the oldest pledge | That pledge stays Open/Partly with a "Soft credit $X" chip |
| A4 | Amount larger than the open balance | Excess is not credited; the sheet says so; treasurer decides it on approval (Q10) |
| A5 | Member has no open pledge | "I paid another way" is hidden on Open pledges; no direct-gift path in this plan |
| A6 | RSVP checkout | Claim bound to the RSVP pledge; amount locked |
| A7 | RSVP saved as "Add as pledge", paid later | Done from Open pledges |
| A8 | Store pay-at-pickup | Order creates a store pledge; claim bound to it; fulfilment per org setting (Q8) |
| A9 | Opportunity, labh, Pathshala fee, membership | Same sheet |
| A10 | Org accepts no offline method | The option is hidden, not disabled |
| A11 | Method check | Check number requested; photo of the check (front, back optional) |
| A12 | Method stock | Shares/symbol/transfer date, claimed value; treasurer sets the credited value; soft credit uses the claim until then |
| A13 | Method DAF or matching gift | Claim kept; reconciles to the fund's bank line, not the member's |
| A14 | Cash | Reference = receipt/envelope number; photo optional unless the org requires it (Q6) |
| A15 | Upload fails or app is closed midway | Nothing credited; plain error; retry; orphan files removed after 48 h |
| A16 | Same file sent again | Flagged to the treasurer (SHA-256), not blocked |
| A17 | Child account | Blocked: "ask a parent" |
| A18 | Second adult sends the same payment | Lookalike notice at submit; can still send with a note |
| A19 | Date in the future, or over a year old | Refused with the reason |
| A20 | Member withdraws | Soft credit released; pledges Open; files kept 13 months |
| A21 | Member wants to change amount or date | Withdraw and resubmit (edit allowed only in "needs more") |
| A22 | Member pays the same pledge by card while soft-credited | Card pays only the uncovered remainder; to pay all by card, withdraw the claim first |
| A23 | Staff edit, write off or delete a pledge that has soft credit | Refused with "a payment proof is waiting on this pledge" until decided (0782 and 0412 paths) |
| A24 | RSVP cancelled after a claim | Claim becomes an **orphan** task for the treasurer: credit to the household, refund, or apply elsewhere (0543 credit exists) |
| A25 | Pledge with installments | Soft credit applies to the pledge amount in this plan; per-installment cover is a follow-up |
| A26 | Sandbox or demo community | `is_test`, rehearsal banner, test bucket path; never counted |
| A27 | No connection | Retry offered; never "Sent" unless the row exists |
| A28 | Languages | en/gu/hi keys, neutral tradition words, no "bid", no exclamation marks (mobile tests enforce these) |
| A29 | Spam | Max 5 waiting proofs per household, 5 files each |
| A30 | Soft-credited pledge and its due date | Not overdue while soft credit stands; if rejected, it resumes where it was |
| A31 | "I paid my parents' pledge" (another household) | Not supported: a proof belongs to the submitter's household. The treasurer can record it by hand for the right family |
| A32 | Two adults, one phone, quick double-tap on Send | One claim: the submit RPC takes an idempotency key made by the sheet |
| A33 | Member opens an old Paid pledge that had a proof | Pledge details show the proof, the receipt and "You can open this until <date>" |
| A34 | One payment credited three pledges | The same proof appears on all three, each showing the share it covered of that pledge |
| A35 | A pledge was paid by two proofs, or by a proof plus a payment the staff recorded | Both appear; staff-attached files are hidden from the family unless shared |
| A36 | The years run out and the files are removed | The pledge says the photo was removed, when and why; the receipt, payment and timeline stay |
| A37 | The admin shortens the years | The preview names how many files families would lose; nothing is removed until its date |
| A38 | Legal hold is on | Family access continues past the date |
| A39 | A proof was merged onto a payment that already existed | The family still sees it on the pledges that payment credited |
| A40 | The payment is re-allocated to other pledges (correction, B6) | The proof follows the money: it disappears from the old pledge and appears on the new ones |
| A41 | The proof was not accepted | It stays under the pledge with the reason for 13 months, then is removed |
| A42 | A child, a former adult of the household, or another household tries to open it | Nothing is returned; the screen says "You don't have access to this area" |
| A43 | A cancelled or written-off pledge had a proof | Same rules; the proof stays for the same years |
| A44 | The pledge is Bank reconciled | Same proof, plus the quiet “confirmed by the bank” tick |

### B. Treasury verifies

| # | Scenario | System does |
|---|---|---|
| B1 | Approve as claimed | Payment + allocations + receipt + QuickBooks as in 4.3; pledges Paid; member told |
| B2 | Proof shows a different amount | Approve with changes; allocations redone oldest first; a pledge may fall back to Partly; member told why |
| B3 | Different date or method | Same; QuickBooks follows the verified date (cash basis) |
| B4 | A recorded payment of the same family and size exists | Approve blocked; Merge as evidence, or "different gift" with reason |
| B5 | A bank line already waits for it | "Approve and reconcile" in one click |
| B6 | A bank line was confirmed oldest-first and closed other pledges than the member named | Proof merged onto that payment; treasurer told the member meant other pledges; re-allocation with reason |
| B7 | Needs more | Member asked; stays Soft credit; 14 days of silence returns it to the queue marked stale; never auto-rejected |
| B8 | Reject | Reason required; soft credit released; reminders resume; counted toward a flag after repeated rejections |
| B9 | Treasurer's own household | Cannot verify; another holder must; if none, an owner with `giving.approve` |
| B10 | Amount over the org's limit | Second person needed |
| B11 | Two people open the same claim | First decision wins; the other sees who decided |
| B12 | Household merged or split since | Follows the merge pointer; shows `household_card` |
| B13 | Photo unreadable | Needs more |
| B14 | Suspected fake | Reject + flag; the bank line is the final check, and the "paid but not on the bank" report would show it anyway |
| B15 | Cash the staff already counted for this family (envelope number) | Lookalike of the staff-recorded payment: merge |
| B16 | Many claims whose bank lines are already known | Bulk "Approve and reconcile" for the Tier A ones |
| B17 | Payment date in a closed month | Payment keeps the verified date; QuickBooks follows today's rule for a closed month (adjustment, 0742 note); refused if Weaver has the period locked |
| B18 | Claim dated Dec 30, decided Jan 5 | Counts in the year of the verified payment date; statement for a closed year not reissued without a reopen |
| B19 | Pledge already paid by another route when approved | Claim marked orphan: merge, credit, or refund |
| B20 | Staff record a payment (`record_offline_payment`) naming a pledge that has soft credit | Refused with "a payment proof is waiting on this pledge": verify or merge that proof instead (today `allocate_payment` would silently skip it) |

### C. Bank statement

| # | Scenario | System does |
|---|---|---|
| C1 | Upload a CSV twice, or overlapping periods | Fingerprint de-dupe (0012) keeps one line |
| C2 | Line equals an approved, unbanked payment with the same check number | Tier A: attach, no pledge changes |
| C3 | Same household and method, amount differs | Tier D: difference shown, options in 5.4 |
| C4 | Line equals a waiting proof | Approve and reconcile |
| C5 | Known payer, no payment or proof explains it | New money, only to uncovered pledges |
| C6 | Household has only soft-credited pledges, bank shows the same amount by a different method (claimed check, bank shows Zelle) | Tier C match to the proof with a method warning; **not** new money (I3) |
| C7 | Two households' proofs fit one line | Tier C, ambiguous, no default |
| C8 | Two proofs from one family, one line for both | Subset match, both settled |
| C9 | One proof, two lines | Phase 2; first line attaches as a part and the payment stays "partly on the bank" |
| C10 | Cash deposit | Subset-sum over unbanked cash payments, or an offering count (0744) |
| C11 | Chase gives one deposit total for many checks | Subset-sum with check numbers when the memo carries them |
| C12 | A member's Zelle report and a proof describe the same Zelle | One payment; both link to it |
| C13 | DAF grant from a fund | Matches the DAF claim by amount, window, donor name in the memo; else manual |
| C14 | Card payout lines | Unchanged (payouts) |
| C15 | Negative line (returned item, fee, refund) | Listed under money out; matching to a payment is phase 3 |
| C16 | Line already linked to an offering count | Not offered again |
| C17 | Line dated in a locked month | Same rule as 0744 (undo refused) |
| C18 | Line older than any claim | Ignored by the engine, still available to match by hand |
| C19 | Same bank line, different statement format | Canonical fingerprint (date, amount, normalised text, sequence); verified at build time |
| C20 | Two treasurers confirm one line | Row lock plus status check, as today |
| C21 | Wrong match | Undo with a reason; states restored (I8) |
| C22 | Pledge has three payments and one is not on the bank | Pledge stays Paid with "2 of 3 on the bank" |
| C23 | Pledge paid by card | Bank reconciled when its payout is matched; the pledge rolls up |
| C24 | Late proof makes an old unmatched line fit | Refresh proposes it; nothing applies by itself |
| C25 | Line and claim in different bank accounts than the method expects | Tier lowered with the reason shown |
| C26 | Nothing on the bank after the window | "Paid but not on the bank" report and Home chip |
| C27 | The line's payer maps to family X, but the unbanked payment or waiting proof of that amount belongs to family Y (a relative paid) | Same-family lookalike **blocks** (I3); a lookalike in *another* family only **warns** on the row ("Family Y has an unbanked $200 check") and lists it as the alternative, so the treasurer can attach to Y instead |

### D. Reports, history, accounting

| # | Scenario | System does |
|---|---|---|
| D1 | Historical pledges (imported, before go-live) | Backfilled `reconciled_at` with kind "historical" so they are final, not "unreconciled" (Q12) |
| D2 | Receipts and year-end statement | Only from verified payments, by payment date; soft credit shows as "pending" in the app only |
| D3 | Campaign thermometer | Pledged / soft credit / collected as three figures |
| D4 | Giving totals and exports | Totals unchanged by soft credit; CSV gains status and reconciled columns |
| D5 | Reminders and overdue jobs | Skip Soft credit; resume if released |
| D6 | QuickBooks | Nothing at soft credit; payment posting at approval; deposit posting at reconcile (today's paths) |
| D7 | Pledge detail timeline | Pledged → Soft credit → Paid → Bank reconciled, with who and when |
| D8 | Event entry and store pickup under Soft credit | Org setting, default: entry honoured, pickup waits for approval (Q9) |
| D9 | A refund after a pledge is Bank reconciled | Refunds stay two-person as today; the pledge falls back from Paid per its allocations, and `reconciled_at` clears if a payment on it is no longer reconciled (I6) |
| D10 | Organization without the Bank reconciliation add-on | Proofs still work; Paid is then the final state and "Bank reconciled" is not offered anywhere |
| D11 | Staff reverse a recorded (not yet banked) payment | The pledges re-open, any proof that created it is marked "payment removed" and returns to the queue |

### E. Security and abuse

| # | Scenario | System does |
|---|---|---|
| E1 | Who can read a proof | The household's adults; staff with verify permission; signed URLs; staff views logged |
| E2 | Bad file | Type by content (JPEG, PNG, WebP, HEIC, PDF), 10 MB, 5 files; the virus-scan hook is wired but off today |
| E3 | Account numbers in a check photo | Warned at upload; restricted and audited; never sent in e-mail, push or exports |
| E4 | Forged receipt | Cannot move money: Paid needs a person; Bank reconciled needs the bank; the unbanked report finds it |
| E5 | Self-approval, collusion | Own-household block, second person over the limit, full audit |
| E6 | Retention setting abuse | Admin only, step-up, reason, preview of what would be purged |
| E7 | Member leaves, or asks for deletion | Proofs are financial records: they stay until retention ends, then are purged. No anonymization job exists today (only copy on the privacy page), so this plan promises nothing beyond the proofs themselves |
| E8 | RLS | Tests for every table and the bucket: another household, a child, a volunteer without the permission, another organization |

### F. Platform and rollout

| # | Scenario | System does |
|---|---|---|
| F1 | Any organization, any tradition or none | No organization-specific words, methods or windows in code; everything per organization (multi-tenant rule, 2026-10-11) |
| F2 | The add-on is switched off while proofs are waiting | Refused until they are decided, or they are released with a notice to each member (the owner picks at switch-off) |
| F3 | The add-on is switched on in an organization with old open pledges | Nothing changes until someone submits a proof; no backfill except `reconciled_at` "historical" (D1) |
| F4 | A migration fails halfway | One transaction per file (`migrate.sh`); the enum value is its own file; all new columns are nullable or defaulted, the feature is off by default, so a rollback leaves no state to repair |
| F5 | An old app version (before the OTA) meets a pledge with status `soft_credit` | It falls to the "Open" label (`statusPill` default) but has no pay checkbox (`isOpenPledge` is false). Slice 1 also makes the server-side pay path refuse a covered pledge, and slice 3 ships before the add-on can be switched on anywhere |
| F6 | The phone has no camera permission yet (runtime 4) | The sheet offers "Choose a photo" only; no crash, no dead button |
| F7 | A community in a sandbox | Rehearsal, `is_test` rows, never in real totals |

## 7. Conflicts with earlier decisions and plans (need a ruling)

1. **Zelle credits nobody (owner, 2026-10-02, 0582).** That decision was about a Zelle *report*. Soft credit credits the pledge status
   but no money. Recommendation (Q4): offer the same sheet for Zelle and keep both truths: the report/proof credits **no money** and
   no total; only the pledge's status shows Soft credit. If you want Zelle left exactly as is, hide Zelle from the sheet.
2. **Allocation plan D1-D8 (docs/PAYMENT_ALLOCATION_PLAN.md).** D8 (screenshot evidence for Zelle) is superseded by section 4.5. D1's shared
   allocation sheet, D3 (gift vs non-gift ordering) and D5/D6 (unapplied marker, controlled payment corrections) are still unbuilt and
   this plan touches the same ground. Recommendation: build the proof flow first on today's `allocate_payment`, and take D6 (the
   corrections) next because merge and re-allocate (B6) need it.
3. **Pathshala "pay at the office"** holds a seat until the treasurer records a payment. A soft credit would not release a seat; the seat
   rule is untouched.

## 8. Screens (the prototype will draw exactly these, after the plan is approved)

**Member app:** (1) Open pledges with the Soft credit pill, chip and "I paid another way" button; (2) the sheet: method, amount,
date, reference; (3) the sheet: add proof (photo, gallery, file; thumbnails, remove); (4) review "where it will go"; (5) sent +
status timeline ("My payment proofs"); (6) needs-more reply; (7) RSVP checkout with the same sheet; (8) store checkout pay-at-pickup
with the same sheet; (9) the decision notice (approved / rejected with reason); (10) the Closed filter with a proof mark on pledges
that have one; (11) **Pledge details** of an old Paid pledge with its proofs and the kept-until date; (12) the same screen after the
years ran out (photo removed, receipt stays).

**CRM (portal):** (1) Giving › Today with the "Proofs to verify" task and Home chip; (2) the review sheet (household card, proof viewer,
pledges it covers, flags, actions); (3) pledge and household pages with the four states and the evidence panel; (4) Settings ›
Payments › Evidence (years, hold, second-approver limit, required methods, windows); (5) Bank › Import statement → **Reconciliation
preview** (grouped outcomes, consequence text, batch confirm for Tier A); (6) "Paid but not on the bank" report; (7) un-reconcile with a
reason.

## 9. Delivery plan

Each slice is its own pull request, in this order, each waiting for **App checks** (and **Database tests** when `supabase/**` changes),
an independent review, and the owner's OK (money rules, permissions, RLS). Migration and test numbers are taken from the reserved
block when a slice is approved. After each migration: run `supabase/tests/run_local.sh` (here: the CI artifact, no local Postgres),
regenerate `src/lib/database.types.ts`, copy it to connect-admin and connect-mobile.

| Slice | What | Where | Notes |
|---|---|---|---|
| 1 | Database: enum value, proofs, files, soft credits, events, evidence, bucket and policies, `recompute_pledge_status` v2, submit/withdraw/approve/reject RPCs, **generalised duplicate guard in `confirm_bank_match` and `attach_bank_line_to_payment`**, audit, the bucket plumbing (4.5), `pledge_evidence` and the family's read rule, the reader changes of 3.4, tests for A, B, E, F, I1-I9 and the order-permutation test (9.1) | crm | Largest and riskiest. The guard is part of it, never after it |
| 2 | Portal: Proofs to verify task + review sheet, pledge/household states, Settings › Evidence, notices | crm | |
| 3 | Mobile (OTA): the sheet at Open pledges, RSVP, tickets, store (and the pay-later pledge), pledge states, My payment proofs, **Pledge details with its proofs for any status and year**; gallery only | mobile | Version bump + CHANGELOG + OTA to preview |
| 4 | Database: `reconcile_candidates`, tiers, subset-sum, runs and proposals, attach for all methods, short/over, refresh, aging report, `reconciled_at` roll-up and historical backfill | crm | Tests C1-C26 |
| 5 | Portal: Reconciliation preview, batch confirm, undo, "Paid but not on the bank", month-end lines | crm | |
| 6 | Evidence retention job (its own eligibility rule, same worker and audit event as `storage.retention_delete`), 30-day notice, orphan cleanup, optional staff push digest, CSV columns | crm | Worker job |
| 7 | Mobile APK (runtime 5): camera, file picker, photo re-encode; also unblocks homework "attach a file" | mobile | One build for both |
| 8 | Later: returned items, split payments, fee tolerance, PDF statements with Niva, OCR hint | crm | After use shows the need |

Rollout: a sandbox community first (rehearsal, `is_test`), then one community with the add-on switched on. Size: slice 1 large, 2 medium,
3 medium, 4 large, 5 medium, 6-7 small, in about that order of effort.

### 9.1 How it is proven

* **Every row of section 6 is one test**, named by its number (`A4`, `B6`, `C27`), plus tests for I1-I9. Database tests run in CI
  (no local Postgres here); the generated types come from the CI artifact.
* **Order-permutation test, the one that matters most:** one family, three pledges (P1 $200, P2 $150, P3 $100), one real $200 check.
  Run every order of {submit proof, approve, import statement, confirm/attach, withdraw, repeat the import} and assert: the $200
  closes exactly $200 of pledges once; no pledge is over-covered; every bank line is used once; the same end state whichever came first.
  Repeat for Zelle (with a member report), a cash deposit of four payments, and a short/over line.
* **RLS tests** for every new table and the bucket (another household, a child, a volunteer, another organization, the owner).
* **Mobile:** pure-rule tests (still-to-pay, oldest-first preview), screen tests for the sheet and the pledge states, the existing
  checks that ban "bid", colour literals and missing en/gu/hi keys.
* **Sandbox rehearsal** with real photos and a real exported statement before any community turns the add-on on.
* **Docs updated in the same pull requests:** ARCHITECTURE (new tables and statuses), DECISIONS (the owner's answers), ROLES (who
  verifies), HANDOVER_RECEIPT, DEPLOY (the bucket, the worker job), BACKLOG (new B-number), the Zelle report doc, and the privacy page text
  that promises "kept 7 years".

## 10. Questions for the owner (recommended answers first)

| # | Question | Recommendation |
|---|---|---|
| Q1 | Is my reading of the unfinished sentence right (a pledge closed by the soft-credit route with no bank line is "paid, awaiting the bank", and every bank line first tries to settle *that*)? | Yes |
| Q2 | Is Soft credit a status only when a pledge is *fully* covered, with a chip on the one partly covered? | Yes |
| Q3 | Keep `paid` and add `reconciled_at`, shown as "Bank reconciled", rather than a new status? | Yes |
| Q4 | Include Zelle in the sheet (status only, no money), or leave Zelle as the report it is? | Include |
| Q5 | Who verifies: `giving.record_offline` / `giving.manage` holders, never their own household, a second person above an amount? | Yes; amount default off |
| Q6 | Is a proof required? | Required for check, ACH, stock, DAF, other; optional for cash (receipt number) |
| Q7 | Retention: default 7 years, minimum 3, maximum 25, from the end of the accounting year of the payment; rejected/withdrawn 13 months; legal hold | Yes |
| Q8 | Store pay-at-pickup creates a pledge when the order is placed, so there is something to credit; pickup waits for approval unless the org says otherwise | Yes |
| Q9 | Does Soft credit admit someone to an event or release store goods? | Event yes; store goods wait. Per-organization setting |
| Q10 | Money above the open balance | Held for the treasurer to decide on approval (household credit, new gift, or ask) |
| Q11 | Should "total open balance" include non-gift pledges (Pathshala fees, bolis, store)? | Yes, because you said total open balance; the sheet marks them |
| Q12 | Historical paid pledges count as final ("historical") instead of waiting for a bank line that will never come? | Yes |
| Q13 | Statement formats in the first build | CSV (generic, Chase) plus OFX/QFX; PDF later with Niva |
| Q14 | Automation limit | Only Tier A may be confirmed in one batch click; nothing applies without a click |
| Q15 | Returned items and reversals | Phase 8, after the first months |
| Q16 | A new add-on switch ("Payment proofs") under Giving, off by default | Yes |
| Q17 | Ship the gallery-only sheet by OTA first, and add camera and files with the next APK? | Yes |
| Q18 | Members hear by push and in the app (no e-mail provider exists yet); e-mail added when one is configured | Yes |
| Q19 | Treasurers get no push for any giving task today. Add an opt-in daily push digest for "proofs to verify"? The Home task and badge exist either way | Yes, opt-in |
| Q20 | Naming: keep the owner's words "Soft credit" for pledges in the UI. "Credit" already means unallocated money (`household_credit`) and the CatchTheMatch plan uses "soft credit" for a company match | Keep "Soft credit"; call the CatchTheMatch idea "match credit" when it is built |
