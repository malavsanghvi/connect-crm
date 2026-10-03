# Zelle reports: a guide for the treasurer

Payments plan PR 3 (`docs/PAYMENTS_PLAN.md` §2.9, finding G6), owner decisions of 2026-10-02 (Q2 to Q5).
Migrations `0582_payment_reports.sql` and `0583_zelle_bank_matching.sql`; screen **Giving › Payments ›
Bank reconciliation › Zelle reports** (`/giving/payments/bank?view=zelle`).

Zelle has no merchant API: money goes from the member's bank to the organization's bank, and the
bank statement is the only proof. So a member can now say **"I sent a Zelle"** (amount, the date it
was sent, the confirmation number if they have it, the name their bank shows, and the pledges it is
for), and the treasurer matches that report to the bank line when the statement is imported.

**A report credits nobody.** Until the treasurer matches a bank line there is no payment, no
allocation to a pledge, no receipt and no QuickBooks posting, and the report is not counted in any
total, statement or balance. In the member app (payments plan PR 4) it shows only as a "Reported" chip
on the pledge and in the family's giving, never in a total.

## 1. What a member can report

- Only an adult of the family, only a Zelle, and only when Zelle is one of the organization's
  accepted methods (Settings › Payments).
- Sent today or in the last 60 days ("For an older one, contact the treasurer").
- The confirmation number is asked for but not required (Q4). When given it must look like one (6
  to 40 letters and digits). The same confirmation number can be reported only once per
  organization while its report is live, and never when it is already on a matched bank line.
- The same family, amount and date cannot be reported twice while the first is waiting; a family
  can have at most 10 reports waiting at once.
- The member can withdraw a report that is still waiting. A withdrawn report, and a report the
  treasurer closed as not accepted, free their confirmation number (so a member whose report was
  closed for a wrong amount can report it again).

## 2. Statuses

| Status | Shown as | Meaning |
|---|---|---|
| `reported` | Waiting for the bank | Reported, no bank line matched yet |
| `unmatched` | Not seen at the bank | Past the report window with no bank line; the member was told once |
| `matched` | Matched | A bank line was matched (or the report was linked to a payment already recorded) |
| `rejected` | Not accepted | The treasurer closed it with a reason; the member was told why |
| `withdrawn` | Withdrawn | The member withdrew it |

**The report window** is 10 days by default (Q3), 3 to 30 days per organization (Zelle report
settings at the bottom of the panel, with a reason). Every hour the background service
(`payments.reports_sweep`) turns a report still waiting after `sent on + window` (in the
organization's time zone) into "Not seen at the bank" and tells the member once, by push and email:
*"... is not on the bank statement after N days. Check the confirmation number in your bank app, or
contact the treasurer. Nothing has been credited yet."* The Home page shows the treasurer a task
"N Zelle reports not seen at the bank". The sweep never creates a payment.

When the treasurer can already settle the report, the sweep does not tell the member that the bank
has not seen it, and the report stays "Waiting for the bank": either the family already has a Zelle of
that amount recorded around that date (by hand, or from a bank line matched without the report;
it appears under **Recorded by hand** for the treasurer to link), or its bank line is on the imported
statement waiting for the treasurer's click (same confirmation number and amount).

An "unmatched" report can still be matched later: a late bank line is matched exactly as before.

## 3. The Zelle reports panel

| Section | What it holds | What you can do |
|---|---|---|
| **Exact matches** | A report and a bank line with the same confirmation number, the same amount, the line posted between the day before it was sent and 5 days after its window, in the Zelle bank account when one is set, strictly one report to one line, and nothing recorded by hand that it could duplicate | Tick and **Confirm N exact matches** (below) |
| **Waiting for the bank** | Reports with no bank line yet | Import the latest statement; match to a line shown under the report; close as not accepted |
| **Not seen at the bank** | Reports past their window | Match a late line; close as not accepted (reason; the member is told); link to a payment |
| **Recorded by hand** | Reports whose family already has a Zelle of this amount recorded around that date | **Link to this payment** (bookkeeping only, with a reason) |

Every report shows the family's household card (never the name alone), who reported it and when,
the pledges it names, and up to five bank lines of the same amount around that date, each labeled
"Exact", "Same confirmation number", "Same amount, date and sender name" or "Same amount and date".

### "Confirm every exact match" (Q2)

A treasurer click is always required. The bulk button is the only shortcut: it confirms **only the
pairs shown and ticked**, at most 200 at a time, and the database checks each pair again at the
moment you press it. A pair that stopped being exact (matched meanwhile, a second line or report
with the same number arrived, a Zelle was recorded by hand) is skipped and listed with the reason;
it is never confirmed. Each confirmed pair is one ordinary `confirm_bank_match`: one payment,
allocated to the pledges the member named, one receipt, one QuickBooks posting.

## 4. Gifts to match: suggestions with a report

Under **Gifts to match**, a bank line now also suggests the family that reported it, marked
**Member reported**:

| Signal | Score |
|---|---|
| The report's confirmation number equals the line's reference (Chase: `Zelle Payment From Rahul Shah Jpm99bxk2q1v`) | 0.99 |
| Same amount, the line posted within the report's window, and the sender name equals the line's payer name | 0.93 |
| Same amount and within the window | 0.80, **ambiguous** when more than one report fits |

The existing signals (learned payer name, member or household number in the memo, member name) and
the +0.04 when an open pledge equals the amount are unchanged. An ambiguous suggestion is never
applied without the "I checked" step.

Confirming a suggestion with a report records the payment, applies it **to the pledges the member
named** (still open ones, marked as chosen by the donor; otherwise the earliest open pledge first),
uses the reporter as the payer, learns the payer name, and marks the report matched. When you
confirm a line without choosing the report and exactly one waiting report of that family has the
line's confirmation number and amount, it is linked automatically (bookkeeping only; your click is
still what records the money). A report of another amount cannot be confirmed with the line:
confirm without the report, then close or let the member withdraw it. A Zelle report goes only with a
Zelle line or one the bank did not label (never a check, a wire or a fund grant); a line a report
names is recorded as a Zelle and is held to the double-count guard below even when the bank did not
call it one.

## 5. The double-count guard: attach or record separately (G6)

A Zelle can be recorded twice: once by hand (Record a payment, method Zelle) and again when its
bank line is matched. Now, when you confirm a **Zelle bank line** for a family that already has a
Zelle **of the same amount recorded by hand** between 7 days before and 3 days after the line's
date (and not yet attached to a bank line), the database refuses (SQLSTATE `CCDUP`):

> This family already has a Zelle of $250.00 recorded by hand on September 27, 2026 (receipt
> R-1042). Attach this bank line to that payment so the gift is not counted twice, or say why this
> is a separate gift.

The matcher then offers two choices:

- **Attach to receipt R-1042** (the usual answer): the bank line settles the payment recorded by
  hand. No second payment is created; the payment becomes settled and attached to the line, the
  line is matched, the payer name is learned, and **one QuickBooks Deposit** is queued (undeposited
  funds to the bank, idempotency key `deposit:<bank line>`), the same posting a check deposit makes.
  A payment that never posted to QuickBooks (history, or before the QuickBooks go-live date) has
  nothing to deposit, so no deposit is queued for it. A linked report is marked matched (a report
  linked to that payment earlier learns its bank line). A payment is linked to one report only.
- **Record as a separate gift**, with a required reason (two genuine gifts of the same amount in
  the same week): the line is recorded as its own payment as before, and your reason is kept in the
  audit log.

The record-payment form also warns, without blocking, when you are about to record a Zelle by hand
that may already be recorded or reported: *"This may already be recorded: ..."*.

## 6. Rehearsal in a sandbox

Zelle has no test mode, so in a sandbox (`centers.environment = 'sandbox'`) members **never see the
real Zelle address**: the member app shows "Sandbox: no real money moves" (plus the memo hint), and
the Zelle row of the organization's payment methods cannot be read by members there. Staff still
see the real address in Settings › Payments. Reports made in a sandbox are marked **Test**, and
notices to members only reach the sandbox's verified test recipients (a refused notice is stored on
the report, never an error). Match them against the sandbox's own imported test statement lines.

## 7. Who may do what

| Action | Who (the database enforces it) |
|---|---|
| Report, withdraw, see the family's reports | An adult of the family |
| See the panel, counts and suggestions | `giving.view`, `giving.record_offline` or `giving.manage` |
| Match, attach, bulk confirm, close as not accepted, link | `giving.record_offline` or `giving.manage` |
| Change the report window or the Zelle bank account | The owner, `integrations.manage` or `giving.manage`, with a reason |
| Run the sweep | The background service only (`connect_worker`) |

Nobody writes `payment_reports` directly; every write goes through a function and is audited.
Refunds of Zelle gifts still happen outside the system and are recorded through the existing
two-person refund record. A demo clear removes every report.

## 8. Reference

| Object | Purpose |
|---|---|
| `app.payment_reports` | One row per report (RLS: the family's adults and giving staff read; nobody writes directly; Giving module switch; audited) |
| `app.report_payment`, `app.withdraw_payment_report`, `app.my_payment_reports` | The member app |
| `app.payment_report_queue`, `app.payment_report_counts`, `app.zelle_exact_matches`, `app.possible_duplicate_zelle` | The treasurer's panel, the Home task, the record-payment warning |
| `app.confirm_bank_match(..., p_report, p_separate_reason)` | Replaced: report, automatic link, payer default, G6 guard |
| `app.suggest_bank_matches` | Replaced: reports as a candidate source, `report_id` column |
| `app.attach_bank_line_to_payment`, `app.confirm_exact_zelle_matches`, `app.reject_payment_report`, `app.link_payment_report` | Treasurer actions |
| `app.zelle_report_window_days`, `app.set_zelle_reporting` | `centers.rules.payments.zelle = {"report_window_days": 3..30, "bank_account_id": uuid or null}` |
| `app.worker_payment_reports_sweep` | Worker job `payments.reports_sweep`, hourly (`app._zelle_report_held` is its internal "leave it to the treasurer" check) |
| Templates `zelle_report_unmatched`, `zelle_report_rejected` (push and email) | Platform defaults; an organization can override them |
| `app.member_payment_options` | Redefined: unchanged in production; the rehearsal entry in a sandbox |

Not built here: the second approver for a change of the Zelle address (payments plan PR 5, Q6), the
member app's "I sent it" screen (PR 4), and an automatic bank feed (statements are still imported
by hand).
