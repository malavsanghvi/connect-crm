# Payment recording and allocation: asking, auditing, locking after QuickBooks, and Zelle screenshots

**Status (2026-10-08): a plan for the owner's review. Nothing here is built.** It turns the owner's requests of 2026-10-08
into pull requests. Every pull request below changes a money rule or who may change a payment, so each one needs the
owner's explicit OK before it is merged (CLAUDE.md), after an independent review.

Facts below were read from `main` at 8f162bb (migration and file names, then line numbers).

## 1. What the owner asked

1. **Bulk, cash, check or any online way (Stripe, PayPal, Zelle, DAF...).** When a payment arrives that is not meant for a
   named pledge and the household has open pledges, **ask the person paying or recording** whether to close the earliest
   pledges first and move on to the recent ones. If the money does not cover a pledge, record a **partial payment** against
   it. Pledges close one by one in that order.
2. **Overpaying** a pledge: ask the same question and treat it the same way.
3. **No open pledge**: create a pledge and record the donation against it.
4. **Accuracy for cash-based accounting.** (Answered in chat 2026-10-08: yes, with three guardrails, section 4.)
5. **Full audit** whenever a payment's **date or amount** changes.
6. **After a payment has been sent to QuickBooks, changes to it only by the treasurer or a finance admin role.**
7. **Zelle:** the member can **upload a screenshot or photo** that the treasury team can see; the treasurer then **gives the
   credit manually**, with payment type Zelle.

## 2. What exists today

| Topic | Today | Where |
|---|---|---|
| The rule | `app.allocate_payment(payment, pledge_ids?, apply)`: named pledges first, otherwise earliest open pledge (`pledged_at`); partial leaves a pledge `partially_paid`; the rest rolls to the next open pledge of the household. Not a trigger; clients cannot call it. | 0104:41 |
| Leftover | Money beyond all open pledges **stays on the payment, unallocated**, as a "general gift"; QuickBooks books it to `income.general`; the year-end statement counts the whole payment. No marker, no pledge. | giving.ts:603; 0233:143; 0543 `household_credit` |
| Prompts | A preview (auto / choose / none) exists only in the portal's manual form and the gift matcher. **No prompt** for online payments, the bulk "confirm exact Zelle matches", or the DAF drawer (it always passes no pledge ids). Mobile pay-now for an opportunity or a labh passes no pledge ids, so the payment can land on an **unrelated** open pledge. | record-payment-form.tsx:97; 0583:427; opportunity/[id].tsx:193 |
| "Pay-now gifts create a pledge" | A decision (DECISIONS.md:86), **not implemented**: no code creates a pledge for a gift, and no marker says a pledge was auto-created. Nothing filters pledged totals by origin. | |
| Who records | `giving.record_offline` or `giving.manage` insert `payments` directly under RLS; only `giving.manage` may allocate. | 0010:222; permissions.ts:150 |
| Editing a payment | **No screen and no RPC**, but `giving.manage` has full-row UPDATE/DELETE under RLS, so the API can change amount, date, household or method with **no UI, no required reason**. The only column guard is `is_historical`. | 0010:221; 0191:33 |
| Audit | `app.audit_row` is on payments, allocations, pledges, postings: full before/after JSON, actor, role, ip, screen; the log is append-only and hash-chained. The **reason is empty unless the request sends one.** `audit.view` reads it (treasurer yes; finance volunteer no). | 0102:31; 0001:233 |
| QuickBooks | `enqueue_payment_posting` writes `ledger_postings`; the document is built **at claim time from live rows**, `txn_date` = `payments.received_on` (cash basis). **Edits after posting do nothing**: no adjustment, no re-post, `superseded` is never set, and the posted amount is frozen. Refund, store, boli and membership postings are never enqueued. | 0191:58; 0233:154; 0235 |
| Locks | Only a **closed accounting period** (accounting.close + step-up) and it only makes the QuickBooks post fail; recording or editing a payment dated in a closed month is not blocked. | 0154:80; 0235:113 |
| Roles | `treasurer` has giving.view/manage/approve/record_offline, accounting.manage/close, audit.view. `finance_volunteer` has only giving.record_offline. **No finance admin role exists.** The second-approver lists and the treasurer key are hard-coded. | ROLES.md; 0017:410; 0152:131; 0300:110 |
| Zelle reports | A member says "I sent it" (`report_payment`, adults, last 60 days); the treasurer matches the bank line, bulk-confirms exact matches, or links. **No attachment of any kind**; a hand-recorded Zelle payment is attached to the bank line later with a double-count guard. | 0582:252; 0583:283 |
| Uploads | Private buckets with a signed-URL pattern (`homework`, `recordings`, `content`); the virus scan is built but off. No bucket fits payment evidence; `statements` has the right read rule but is PDF-only and staff-write. No payment attachment exists. | 0172:38; 0587:1568; 0589 |

## 3. Gaps this plan closes

G1 prompts are missing in several entry points; G2 the leftover has no pledge and no marker; G3 the pay-now pledge decision
is unbuilt; G4 a treasurer (or anyone with `giving.manage`) can rewrite a payment through the API without a reason; G5
after a payment is in QuickBooks, a change makes Weaver and QuickBooks silently disagree; G6 a closed month is not enforced
when recording or editing; G7 no finance admin role; G8 no Zelle evidence; G9 an auto-created pledge would inflate
"pledged" totals; G10 online `received_on` is the day the worker processed the event (PAYMENTS_PLAN G13).

## 4. Accuracy for cash-based accounting (the owner's question) and the three guardrails

Income is recognized when the cash arrives, by amount and date received. A pledge is a promise and posts nothing, so which
pledge a payment closes never changes how much income is recorded or when; it changes the donor's account and the fund or
campaign the money is designated to. The approach is accurate **provided**:

1. **Donor intent beats "earliest first".** The allocation decides the fund and campaign. Earliest first is the default only
   when the donor names nothing; the preview lets the person choose a specific pledge or a new gift.
2. **Gifts and non-gifts are not mixed silently.** Pathshala fees, bolis, labh and meals give the donor something back, so
   closing them with a gift changes the tax receipt. Earliest-first applies to gift pledges; the preview marks the others
   and asks.
3. **An auto-created pledge is a direct gift, not a promise.** It must post nothing on creation, carry the payment's date and
   the chosen fund, and stay out of "pledged" and campaign-progress totals (the money still counts as collected).

Also: the donor receipt year follows the payment date, never the pledge date (already true of `year_end_statement`).

## 5. Proposal

**D1. Ask wherever a person is present.** One shared allocation sheet (portal) shows the split before saving: "Oldest first"
(default), "A specific pledge", "New gift"; partial and overpayment are shown line by line; the choice is stored as
`chosen_by_donor`. It is used by: the single cash/check form (exists), the bank-line confirm, the **bulk exact Zelle
confirm** (preview for the whole batch, one tick per row), the DAF/matching drawer, and the Zelle credit (D8). Stripe and
PayPal webhooks have nobody present: they use the pledges named at checkout (stored with the checkout), else earliest first
among gift pledges; the mobile opportunity and labh pay-now flows must pass their own pledge ids.

**D2. Direct-gift pledges.** When no open pledge remains, or after the person agrees for the leftover, create a pledge with
`source = 'gift'` (new value) and `counts_as_promise = false`, amount = the amount to cover, `pledged_at` = the payment's
date, fund and campaign chosen in the sheet (default: the general fund), then allocate and close it in the same transaction.
Reports: "pledged" and campaign progress exclude `counts_as_promise = false`; "collected" counts everything; a separate
"direct gifts" line is shown.

**D3. Non-gift pledges.** Pledges of source `pathshala_fee`, boli, labh, Swamivatsalya and store orders are never picked by
the default order for a gift; they appear in the sheet greyed as "not a gift" and can be chosen on purpose.

**D4. Dates.** `received_on` is the day the money was received (cash/check: the form's date; Zelle/ACH: the bank line's
`posted_on`; online: the **provider's charge time**, not the worker's processing day, closing G10).

**D5. A durable "unapplied" marker.** `payments.unapplied_cents` (kept by the allocator) and a treasurer list "Unapplied
payments", with an option to apply it to the next pledge the household makes (owner question Q6).

**D6. Controlled edits with a full audit (before QuickBooks).**
- Remove direct UPDATE/DELETE on `payments` and `payment_allocations` for `authenticated`; changes go through
  `correct_payment(payment, changes, reason)` (reason required, at least 10 characters): date, amount, method, household,
  notes; allocations are redone through the D1 sheet. Refunds stay as they are (two people).
- The audit already stores before/after; the plan adds a **"Payment history" panel** on every payment (who, when, what
  changed, why), a monthly **"Payment corrections" report** for the treasurer to review, and an e-mail to the treasurer and
  finance admin on any change of date or amount.
- Who: before posting, `giving.manage` holders (with reason); `giving.record_offline` may only record.

**D7. Lock after QuickBooks.**
- New permission **`giving.correct`**, default for `treasurer` and a new default role **`finance_admin`** (key, label and
  default grants in section 7, Q2). The hard-coded second-approver and treasurer lists are rewritten to read roles from data.
- A trigger on `payments` and `payment_allocations` **refuses** changes to amount, date, method, household, fund-affecting
  allocation or deletion once a `ledger_postings` row for the payment is `posting` or `posted`, unless the transaction was
  started by `correct_payment` (the flag pattern 0597 uses for payee changes) **and** the caller holds `giving.correct`.
- A correction after posting writes an **adjustment** to QuickBooks (Q4): the recommended method is to void the original
  SalesReceipt and post a corrected one in the same open QuickBooks month; if the month is closed in Weaver
  (`accounting_periods`), the correction is refused until the treasurer reopens it (accounting.close + step-up). The second
  half closes G5/G6: recording or editing a payment dated in a closed month is refused in the database too.
- Every correction shows a banner on the payment: "Corrected on <date> by <person>: <reason>; QuickBooks adjusted <date>".

**D8. Zelle screenshot as evidence, credit given by the treasurer.**
- New private bucket `payment-evidence` (images only: JPEG, PNG, WebP, HEIC; 10 MB each; up to 3 per report), path
  `<center>/<household>/<report>/<uuid>.<ext>`. The reporting adult uploads while the report is open (the `homework` write
  pattern); reads: the household's adults and the holders of `giving.record_offline` / `giving.manage` / `giving.correct`
  (the `statements` read rule plus record_offline); signed URLs of 10 minutes; never in exports or search.
- `payment_reports.evidence_paths text[]`; the member's "I sent it" form gets "Add a screenshot or photo of the Zelle
  confirmation" (optional by default, a setting can make it required; Q5).
- The treasurer's queue shows thumbnails and a **"Give credit"** action: `credit_payment_report(report, received_on, amount,
  allocation choice, note)` creates a payment with method zelle (offline, captured), runs the D1 sheet, and copies the
  evidence to `payments.evidence_paths` so it stays with the payment when the report is housekept. A later bank line is
  attached with the existing double-count guard (CCDUP).
- Retention: evidence follows the financial record (seven years, then removed with the anonymization), not the 180-day pattern.
  The virus scan queue is used once the scanner is switched on. Screenshots contain phone numbers and partial account
  details: they are masked in the audit log and never sent in e-mail or push.

## 6. Pull requests (each needs the owner's OK before merge, and an independent review)

| # | PR | Migration / test | Money or access change |
|---|---|---|---|
| A | Allocation sheet everywhere, direct-gift pledges, unapplied marker, non-gift guard, provider charge date, reports exclude gift pledges from "pledged" | 0598 / 83 | Yes: allocation and what counts as pledged |
| B | `correct_payment`, the lock after QuickBooks, `giving.correct`, `finance_admin`, QuickBooks adjustment, closed-month enforcement, Payment history and corrections report | 0599 / 84 | Yes: who may change money records; a QuickBooks write |
| C | Zelle evidence: bucket, report columns, member upload, treasurer thumbnails and "Give credit" | 0600 / 85 | Yes: a new place where members' images are stored and who may read them |
| D | Member app: the upload in "I sent it", pass pledge ids from opportunity and labh pay-now | none | No (after A and C) |

Numbers start after the ones reserved for Pathshala (0592, 0593, 0595) and after 0597.

## 7. Questions for the owner (recommended answers first)

- **Q1.** Before QuickBooks, who may correct a payment's date or amount? **Recommended:** `giving.manage` holders (the
  treasurer and finance admin), always with a reason; recorders (`giving.record_offline`) never.
- **Q2.** The `finance_admin` role: **recommended** the treasurer's giving and accounting permissions plus `giving.correct`,
  but **not** `accounting.close`; it may be a second approver for refunds like the treasurer. Say if it should differ.
- **Q3.** A correction in a month already closed in Weaver: **recommended** refuse until the treasurer reopens the month.
- **Q4.** How a correction reaches QuickBooks: **recommended** void and re-post the single SalesReceipt (cash basis, one
  transaction); the alternative is an adjusting journal entry for the difference.
- **Q5.** Zelle screenshot: optional (recommended, with a nudge) or required?
- **Q6.** An unapplied leftover: wait for the treasurer (recommended), or apply to the household's next pledge by itself?
- **Q7.** Keep Zelle screenshots seven years with the financial record (recommended) or shorter?
- **Q8.** E-mail on every date or amount change, or only a monthly report?
