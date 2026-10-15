# Payment add-ons: the optional Chip In and "cover the card fee" at payment

**Status (2026-10-15): a design for the owner's review. Nothing in this document is built, and the pull request that adds it builds nothing.**
It changes money rules (how a payment is recorded, allocated, refunded and posted), adds tables with their own access rules (RLS) and one
platform-admin screen. Under CLAUDE.md, **money rules, permissions and RLS need the owner's approval before anything is built**: every
build slice in section 13 is asked of the owner separately, after an independent review. Repository facts were read from `main` at `37882603`
(file and migration names are inline). Stripe facts were read from Stripe's own pages on 2026-10-15 (Appendix); re-check them before building.

Related: [`PAYMENTS_PLAN.md`](PAYMENTS_PLAN.md) (G15, Q9, section 2), [`BACKLOG.md`](BACKLOG.md) rows B7 and B51, the pricing and processing-fee rows of
[`DECISIONS.md`](DECISIONS.md), [`PAYMENT_ALLOCATION_PLAN.md`](PAYMENT_ALLOCATION_PLAN.md) (B58, which also edits `allocate_payment`).

## 1. The short version

1. **Two optional extras, only at the payment, never on the pledge.** A pledge is the organization's receivable and never includes a fee or a Chip In. A payment lowers the pledge by the **gift** only.
2. **Cover the card fee**: an unchecked box, one tap. Offered only if the organization has switched it on (default off for every organization) and the money moves through Stripe (card, Apple Pay, Google Pay, Stripe bank debit). A **new** migration lifts the lock of `0410`.
3. **Chip In**: an optional amount to Weaver, added on top of the organization's charge as a Stripe **application fee** on a direct charge. It is asked only after a platform admin has set that organization's **yearly limit per account** and the **suggested amounts**. Until then nothing is asked. There is no fixed $25 anywhere.
4. **Offline methods** (Zelle, check, cash, wire, stock, anything the treasurer records) ask nothing and say "No processing fee for this method." **PayPal** gets neither extra for now (section 12 says what it would take).
5. **One server-side calculation.** The phone never works out a fee or a limit. A database function returns the lines and the total, and the checkout refuses if the total the member saw is not what it would charge.
6. **Records.** `payments.amount_cents` stays "what the organization is paid by the donor" and becomes **gift + covered fee**. The existing, never-used column `donor_covered_fee_cents` holds the covered part. The Chip In sits beside the payment, never inside it, and in a per-account, per-calendar-year ledger.
7. **Receipts and statements** include the covered fee in the donor's gift total. The Chip In is a separate line: "a contribution to Weaver, not a gift to your organization".
8. **QuickBooks** sees only what the organization receives: gift plus covered fee, minus Stripe's real fee. The Chip In never reaches the organization's books, and deposits still match.
9. **Refunds** reuse the two-person refund. A full refund returns everything, Chip In included; a partial refund returns the same share of everything. Stripe does not return the application fee by itself, so the refund call must ask for it.
10. **Read this first (section 5.4).** If a member adds a Chip In but does not cover the card fee, Stripe takes the card fee on the whole charge from the organization, so the organization would pay a few cents on someone else's Chip In. That breaks the website's "your organization never pays". The design lets Weaver absorb those cents (recommended); decision 2 asks the owner to confirm.

## 2. What the owner decided on 2026-10-15

Six decisions, all built into section 1: (1) both extras live at the payment only and a payment lowers the pledge by the gift only; (2) only Stripe money, offline methods show a plain "no fee" line, PayPal neither for now; (3) cover-the-fee is opt-in, default off, and each organization decides whether to ask, so the 2026-09-25 lock is lifted; (4) the Chip In is an application fee on a direct-charge Checkout Session and refunds pass `refund_application_fee`; (5) no fixed $25, a per-organization yearly limit per account per calendar year set only by a platform admin, enforced in the database; (6) the covered fee is part of the donor's gift total and the Chip In is a separate line, never in the organization's totals, receipts or pledge allocation.

Q9 of the payments plan ("no platform fee", accepted 2026-10-02) stays true in spirit: Weaver takes no percentage of what an organization charges. The only money that reaches Weaver is an amount a member chose to add.

## 3. What the code does today

| Fact | Where |
|---|---|
| Covering the fee is **locked off**: column `center_payment_processors.donor_covers_fee_allowed`, check constraint `center_payment_processors_no_donor_fee` (must be false), and `app.set_payment_processor` raising "Donors covering the processing fee is not offered yet, so no fee is ever added to a gift." Settings › Payments prints "Not offered yet" | `0410_emoney_refunds.sql` (owner decision 2026-09-25 #5); `src/app/(app)/settings/payments/payments-panel.tsx` (`donor-fee-` line), `actions.ts` (always passes `false`) |
| `payments.donor_covered_fee_cents` exists (default 0) but **nothing writes or reads it** | `0003_giving.sql`; a search of migrations, portal, worker and the member app finds no other use |
| `rules.fees.ask_donor_to_cover` is a toggle that **does nothing**: Rules › Giving shows "Ask donors to cover processing fees · Ask at checkout", it defaults to **on** (`askDonorToCoverFees: true`; seed `"fees":{"ask_donor_to_cover":true}`), and no checkout reads it | `src/lib/settings-rules.ts`, `settings/rules/rules-forms.tsx`, `supabase/seed.sql` |
| The Checkout Session is a **direct charge**: platform key, `Stripe-Account` header, one line item, no application fee | `src/lib/payments/server.ts` `stripeCheckout` |
| The payment is recorded from the webhook with `amount = amount_received` and `fee = balance_transaction.fee`; the amount must equal the checkout's | `worker/src/payments/core.ts` `recordStripeSession`; `app.worker_record_online_payment` (`0212`) |
| Stripe documents that a charge with an application fee has a balance transaction with a fee breakdown of **both** the Stripe fee and the application fee. If `fee` totals both, today's code would book the Chip In as a processing fee. The test-mode proof (slice 2) confirms which; either way only the `stripe_fee` entries are the processing fee | Appendix; `core.ts` |
| Allocation places `amount_cents − allocations`; whatever is left is "credit" (`app.household_credit`) and "Not applied to a pledge" in reports; QuickBooks posts the leftover as a General donation | `app.allocate_payment` (`0104`), `0543`, `0672`, `app._qbo_payment_lines` (`0779`) |
| Refunds: two different approvers, then `payments.refund` calls Stripe with `payment_intent` and `amount` only. A refund made in Stripe's dashboard becomes one flagged row needing two approvals, found by comparing Stripe's running total with `payments.refunded_cents` | `worker/src/handlers/payments.refund.ts`, `core.ts` `stripeRefund`, `0410` |
| Disputes are ignored | `payments.webhook.stripe.ts` (default branch); PAYMENTS_PLAN G8 |
| "Recurring gifts" create a **pledge** each cycle. Nothing charges a saved card and nothing runs the cycle on a schedule | `app.run_recurring_gift_cycle` (`0525`, `0743`); BACKLOG B16; PAYMENTS_PLAN PR 9 |
| There is **no guest checkout**: `app.create_checkout` needs a signed-in adult of the family, and RSVP without signing in takes no payment | `0211`, `0590`; `RSVP_WITHOUT_LOGIN.md` |
| The member app's Pay sheet shows To, For, how to pay (Card, PayPal, other ways), Total and Pay; it posts to `/api/payments/intent` and waits for the webhook | `connect-mobile/src/features/pay/host.tsx`, `online.ts`, `src/lib/api/payments.ts` |
| The store cart's Pay opens the same sheet with context `store`. I found nothing that links that payment to the store order (the order is placed separately, "pay at pickup"), so the store is left out below until that is understood | `connect-mobile/src/app/(app)/cart.tsx` |

## 4. What the member sees

### 4.1 Where

One component, so one change covers every payment kind: the member app's **Pay sheet** (iOS, Android and the web build). Every Pay button (Give, pledges, tickets, labh, opportunities, Pathshala fees) opens it. The portal has no member payment page. A future public give page (B55) or guest checkout must call the same functions (section 10.6).

### 4.2 The lines

Shown only when the member pays through Stripe and an extra is on offer for this payment. Nothing is pre-checked or pre-selected. (The amounts below are examples; the suggestions come from the platform admin.)

```
Pay with   (o) Card     ( ) Bank account (ACH)

Your gift                                              $100.00
[ ] Add $3.45 to cover the card fee
    So {Organization} receives your full $100.00. About what Stripe charges.

Chip In to Weaver (optional)
    ( $2 )  ( $5 )  ( $10 )  ( Other )   (o) No Chip In
    Weaver is the software {Organization} runs on. It is free for
    {Organization} because members like you can chip in. This is a
    contribution to Weaver, not a gift to {Organization}.

Total charged today                                    $100.00
```

Ticking the box or choosing a Chip In updates the lines and the total at once, by a short question to the database (section 6.6). With both: gift $100.00, card fee $3.45, Chip In $5.00, total $108.45.

- **"No Chip In" is the default and one tap from any state.** Paying never requires a Chip In. A suggestion above what the member may still add this year is hidden; "Other" takes any amount from $1.00 up to what is left.
- **At the yearly limit the Chip In block disappears.** We stop asking and the sheet says nothing about it. Giving history still lists past Chip Ins.
- **The fee box shows the exact amount.** "About" is honest: it estimates Stripe's standard fee (section 5.3).
- **Method first.** Card and bank debit have different fees. When the organization offers both, the sheet lists them as two choices and the Checkout Session is limited to the chosen one whenever a covered fee is added. Apple Pay and Google Pay are cards.
- **Other ways to give** (Zelle, check, cash, wire, stock...) gain the line **"No processing fee for this method."** and ask nothing.
- **PayPal:** nothing extra. If an extra is on and the organization offers both, a quiet line under PayPal says "Card fee cover and Chip In are available with Card."
- Children see "Ask a parent", as now. Staff paying for another household are not asked for a Chip In. Accessibility rules apply (44-pixel targets, large text, no meaning by colour alone).

### 4.3 Which payments get which extra (recommendation, decision 4)

The pledges' `source` and the checkout `context` decide, and **the database decides, not the app**.

| Kind | Cover the card fee | Chip In |
|---|---|---|
| Gifts: general, recurring, labh, construction, boli, sponsorship, pujan, manual or other gift pledges; opportunities | **Yes** | **Yes** |
| Dues (`membership_fee`) | Not in the first release | **Yes** |
| Event tickets (`rsvp_commitment`) | Not in the first release | **Yes** |
| Pathshala fee | No (a fee is never a gift, P13) | **Yes** |
| Store | No | Not until its payment is linked to the order |
| Several pledges at once | Only if **every** pledge is a gift | Yes |
| The $1 test, staff-made checkouts | No | No |

Why fee-cover is narrower: the owner's rule is that the covered fee is part of the gift because the donor is donating it. Dues, tickets and fees are prices, not gifts, and have no gift receipt to put it on. The website's "pays dues, buys a ticket or gives" matches the Chip In column.

### 4.4 Errors (plain English, next to what the member did; detail logged by `failure()`)

- "Could not start the payment. The card fee changed from $3.45 to $3.48. Please review the total and try again." Nothing is charged.
- "Could not add a Chip In. You have reached this year's Chip In limit. Nothing was charged." The sheet then redraws without the block.
- "Could not start the payment. {Organization} does not take a covered card fee on this kind of payment. Nothing was charged."

## 5. The maths (integer cents only)

### 5.1 The lines

`G` gift, `F` covered card fee, `C` Chip In, `T` total charged to the card, `S` Stripe's fee, `A` the application fee Weaver takes.

- `T = G + F + C`. The organization's **charge** is `G + F` (stored as `payments.amount_cents`). Weaver's part is `C`.
- Stripe computes its fee on the **whole** charge `T` and takes it from the organization's balance. The application fee goes to Weaver and carries no extra Stripe fee. (Stripe's own example: $10.00 charge, $1.23 application fee, $0.59 Stripe fee, $8.18 to the connected account.)

### 5.2 The covered fee: so the organization nets exactly the gift

When the member covers the fee, `A = C` and the organization nets `G + F − S`. We want `G`, so `F` must equal `S`, and `S` depends on `F` and `C`. With a rate of `bps` basis points plus `fixed` cents (Stripe card: 290 and 30; Stripe bank debit: 80, no fixed amount, fee capped at 500) and `base = G + C`:

```
F = ceil( (bps * base + 10000 * fixed) / (10000 - bps) )       // the fee on the whole charge, solved for itself
if cap and F > cap: F = cap
while round_half_up(bps * (base + F) / 10000) + fixed > F (capped the same way): F = F + 1    // a step or two
```

The rounding check uses the real formula, so the organization is never short. A brute-force run over every gift from $0.50 to $300.00 with Chip Ins of $0, $1, $2, $5 and $10, for both rates, found the organization never short and never more than 1 cent over.

| Case | G | C | F | T | Stripe fee S | A | Organization nets |
|---|---|---|---|---|---|---|---|
| Card, cover | $100.00 | $0 | $3.30 | $103.30 | $3.30 | $0 | **$100.00** |
| Card, cover, Chip In | $100.00 | $5.00 | $3.45 | $108.45 | $3.45 | $5.00 | **$100.00** |
| Card, no cover, Chip In (Weaver absorbs, 5.4) | $100.00 | $5.00 | $0 | $105.00 | $3.35 | $4.85 | $96.80 (same as with no Chip In) |
| Card, nothing (today) | $100.00 | $0 | $0 | $100.00 | $3.20 | $0 | $96.80 |
| Bank debit, cover | $100.00 | $0 | $0.81 | $100.81 | $0.81 | $0 | **$100.00** |
| Bank debit, cover, Chip In, large gift | $1,000.00 | $5.00 | $5.00 (cap) | $1,010.00 | $5.00 | $5.00 | **$1,000.00** |

### 5.3 Rates are estimates; the real fee is recorded

- **One place for the rates:** `app.payment_fee_rates` (section 6.5), the card and bank-debit rows, each with a date and a source note. Today: card 2.9% + 30 cents; bank debit 0.8% capped at $5.00 (Stripe's US pricing page, read 2026-10-15; Apple Pay and Google Pay are card payments). A rate change is a platform-admin action that adds a row; each checkout stores the row it used.
- **The recorded fee is Stripe's.** After the charge the worker reads the fee from the balance transaction's `fee_details`, **adding only entries of type `stripe_fee`**, into `payments.fee_cents`. That is what posts to QuickBooks.
- **A difference stays with the organization and is shown, not clawed back.** `donor_covered_fee_cents − fee_cents` appears on the payment and in a monthly "card fees covered vs card fees paid" figure. If Stripe charged less (a nonprofit rate), the organization keeps the small surplus; if more, it absorbs the shortfall.
- **International cards (+1.5%) and currency conversion (+1%)** are unknown when the session is made (the card is typed afterwards), so they are not estimated. The organization absorbs that difference, and the Settings text says so.
- **A negotiated or nonprofit rate** will be common. Left alone, donors would over-cover and the organization would profit quietly. So `payment_fee_rates` also takes a **per-organization row set by a platform admin only**, on the organization's request, so the estimate follows its real rate. An organization cannot raise its own estimate.
- **US dollars only.** If the organization's currency is not USD, neither extra is offered.

### 5.4 Who pays the card fee on the Chip In itself (decision 2)

Stripe takes its fee on the whole charge from the organization, so a $5 Chip In adds about $0.15 of card fee to the organization's side. If the member also covers the card fee, that $0.15 is inside the covered fee, the organization is whole and Weaver keeps the full $5.00. If the member does **not** cover the fee, the organization quietly pays $0.15 on a contribution to Weaver, and "your organization never pays" and "never taken out of what the organization charges" (website, pricing page) would be untrue.

**Recommendation:** Weaver absorbs it. The application fee becomes `A = C − (S(G + C) − S(G))`, so the organization nets exactly what it would with no Chip In (row 3) and Weaver receives $4.85 of the $5.00. The member still sees and records "Chip In $5.00". The alternative is `A = C` and a plain statement on the website that a Chip In costs the organization a few cents.

## 6. Data model

All amounts are bigint cents. Everything is added by **new** migrations; `0410` and every applied migration stay untouched.

### 6.1 `app.payments` (existing)

| Column | Meaning |
|---|---|
| `amount_cents` (existing) | What the organization is paid by the donor: **gift + covered fee**. Same meaning as now, so every total that sums it (statements, home figures, the member app's giving total) includes the covered fee with no change |
| `donor_covered_fee_cents` (existing, unused until now) | `F`. Check `0 <= F < amount_cents`; zero unless `provider = 'stripe'` |
| gift (derived) | `amount_cents − donor_covered_fee_cents`: the amount allocated to pledges |
| `fee_cents` (existing) | Stripe's **actual** processing fee (`stripe_fee` entries only) |
| `chip_in_cents` (new) | `C`. Not part of `amount_cents`; zero unless Stripe |
| `application_fee_cents` (new) | `A`, as Stripe reports it on the PaymentIntent |
| `charged_cents` (new) | `T`, the PaymentIntent's `amount_received`. Check: `amount_cents + chip_in_cents` for Stripe payments |
| `provider_refunded_cents`, `application_fee_refunded_cents` (new) | Cumulative refunds at Stripe, and what Weaver sent back (section 10.1) |

Offline, bank, PayPal and imported payments keep every new column at zero, by a check constraint (staff can insert offline payments directly under the existing insert policy). Existing rows need no backfill.

### 6.2 `app.payment_checkouts` (existing)

New: `gift_cents`, `covered_fee_cents`, `chip_in_cents`, `application_fee_cents`, `total_cents`, `pay_method` (`card` or `ach`), `fee_rate_id`. The existing `amount_cents` becomes the **organization's charge** (`gift + covered fee`), so its `between 50 and 100000000` check and the rule "never record an amount the checkout did not ask for" keep working. Checks: `amount = gift + covered fee`, `total = amount + chip_in`. Existing rows backfill to `gift = amount`.

### 6.3 `app.chip_in_settings` (new; one row per organization; no row means nothing is asked)

`center_id`, `asking` (default false), `yearly_limit_cents` (null until set; the function allows $1.00 to $1,000.00 so a typo cannot ask for $10,000), `suggested_cents` (one to four values, ascending, each at least $1.00 and at most the limit), `reason`, `updated_by`, `updated_at`. **Asking needs the limit, at least one suggestion and `asking = true`.** Written only by `app.platform_set_chip_in`.

### 6.4 `app.chip_in_ledger` (new; one row per Chip In)

`center_id`, `account_person_id` (the paying person, decision 5), `calendar_year` (the year the checkout started, in the organization's time zone), `checkout_id` (unique), `payment_id` (empty until collected), `mode` (`test` or `live`), `chip_in_cents`, `application_fee_cents`, `refunded_cents`, `status` (`reserved`, `collected`, `released`, `refunded`), timestamps.

- **What counts toward the limit:** live rows of that account and year that are `reserved` or `collected`, at `chip_in_cents − refunded_cents` (a refunded Chip In gives its allowance back). **Test-mode rows never count** and never appear in revenue figures.
- **Race-safe, in the database.** `create_checkout` takes a per-account-and-year advisory lock, adds up the rows, refuses a Chip In larger than what is left, and inserts the `reserved` row in the same transaction. Two checkouts started at once cannot both fit.
- **Released** when the checkout fails, is cancelled or expires (the same worker call that closes the checkout) and by a daily sweep for rows older than 26 hours whose checkout is no longer open. A checkout with a Chip In expires after 60 minutes (Stripe allows 30 minutes to 24 hours) so an abandoned one does not block a member near the limit. A bank-debit payment stays reserved until it succeeds or fails, which can take days.
- **Collected** inside `worker_record_online_payment`, in the same transaction as the payment.

### 6.5 `app.payment_fee_rates` (new, insert-only)

`center_id` (null = platform default), `method_class` (`card` or `ach`), `bps`, `fixed_cents`, `cap_cents`, `effective_from`, `source_note`, `set_by`. The effective row for an organization is its own latest row, else the platform default. `app.fee_estimate(center, method, base)` implements section 5.2 and is the **only** place the formula exists; the portal server and the member app call it and never re-implement it.

### 6.6 The functions

| Function | Who | What |
|---|---|---|
| `app.payment_addons_quote(center, household, gift, pledges, context, method, cover_fee, chip_in)` | the paying adult | Read-only: eligibility, the lines, the total, the reason for anything refused |
| `app.create_checkout(...)` | the paying adult | The existing function plus `cover_fee`, `chip_in_cents`, `expected_total_cents` (all with defaults). **The old seven-argument form is dropped in the same migration** (PostgREST cannot choose between two overloads); installed apps that send none of the new fields behave exactly as now. Refuses when the quote's total is not `expected_total_cents` |
| `app.worker_record_online_payment(...)` | background service | Extended: checks `total` and `application_fee` against Stripe; writes the columns; allocates the **gift** only; marks the ledger row collected |
| `app.worker_checkout_closed(...)` | background service | Also releases the ledger row |
| `app.my_chip_in_offer(center)` | the paying adult | Whether to ask, the suggestions that still fit, the amount left, used and the limit. Never anyone else's rows |
| `app.platform_set_chip_in(center, limit, suggested, asking, reason)`, `app.platform_set_fee_rate(...)`, `app.chip_in_overview(center)` | platform admins | Section 11.2 |
| `app.set_payment_processor(...)` | owner, `integrations.manage`, `giving.manage` | Same signature; the refusal is removed, a reason is still required, Stripe only |

### 6.7 Who can read what (RLS)

| Object | Reads | Writes |
|---|---|---|
| `payments` (new columns) | As today: adults of the household, staff with `giving.view` or `giving.manage`. Staff see the Chip In as an information line ("not yours, not in your totals") so they can reconcile with Stripe's dashboard | The database functions and the background service, as today |
| `chip_in_settings` | Platform admins; the organization's `payments_can_view` people see a read-only summary through a function | `platform_set_chip_in` only |
| `chip_in_ledger` | The paying person and the adults of that household, for their own rows; platform admins. **No organization staff** | Functions only |
| `payment_fee_rates` | Platform admins; staff see their organization's effective rate through a function | `platform_set_fee_rate` only |

Every new table gets the standard pieces: an `app.module_tables` entry (the ledger under `giving`), `audit_row` triggers with `set_audit_context(reason)` so the hash-chained audit log names who changed what and why, the restrictive module switch where a module applies, revoked default grants, and `connect_worker` execute rights on exactly the functions it needs. `app.demo_keep_tables` keeps `chip_in_settings` and `payment_fee_rates` and lets a demo reset clear the ledger. Tests (`supabase/tests`): a member cannot read another's ledger rows, an organization's staff cannot read the ledger, a non-platform-admin cannot call the platform functions, a child is refused, a sandbox's rows are test-mode.

## 7. Rules that change in existing code

These are the money-rule changes the owner is approving. Each is a no-op while no payment carries a covered fee.

1. **Allocation:** `app.allocate_payment` (`0104`) places `amount_cents − donor_covered_fee_cents − allocations`. The B58 allocation plan also edits this function: whichever builds second rebases.
2. **Credit:** `app.household_credit` (`0543`) subtracts `donor_covered_fee_cents`; otherwise a covered fee would appear as credit the treasurer must "handle".
3. **Reports:** the "Not applied to a pledge" row (`0672`) subtracts it, for the same reason.
4. **QuickBooks lines:** the leftover (`payment − allocations`) already posts as General donation income; it is relabelled (section 9.2).
5. **Recording the fee:** `fee_cents` becomes the `stripe_fee` entries only, never `balance_transaction.fee`.
6. **Payouts:** `syncStripePayout` also splits `fee_details` into processing fee and application fee, so `gross − fee − application fee = net`.
7. **The dashboard-refund check:** `worker_flag_provider_refund` compares Stripe's running total with `provider_refunded_cents`, not `refunded_cents`. A refund Weaver sends for a payment with a Chip In is larger on Stripe's side than on the payment, so without this every Weaver refund would be flagged as if made in the dashboard.
8. **Settings:** `donor_covers_fee_allowed` becomes real and the dead Rules toggle is retired (section 11.1).
9. **The old promise:** the "donor-covers-fee is not offered" row of the PAYMENTS_PLAN constraints table, G15, and the 2026-09-25 #5 row in DECISIONS are superseded; the docs slice updates them.

## 8. Stripe: the checkout and the recording

**The Checkout Session** (`src/lib/payments/server.ts`) keeps the platform key, the `Stripe-Account` header and the idempotency key. What changes:

```
line_items[0]  the gift                        unit_amount = G   name "<for_label> · <Organization>"
line_items[1]  "Card fee you chose to cover"   unit_amount = F   (only when F > 0)
line_items[2]  "Chip In to Weaver (optional)"  unit_amount = C   (only when C > 0)
payment_intent_data[application_fee_amount] = A                 (only when C > 0; positive and below the charge, as Stripe requires)
payment_method_types = [the method the member chose]            (when F > 0; otherwise as today)
expires_at = now + 60 minutes                                   (when C > 0)
```

Stripe's page therefore shows the same lines the member saw. `/api/payments/intent` accepts `cover_fee`, `chip_in_cents`, `pay_method` and `expected_total_cents`, passes them to `create_checkout`, and builds the session only from the numbers the database returned. The route never calculates.

**Recording** (`recordStripeSession`): retrieve the PaymentIntent with `latest_charge.balance_transaction` as now, then check `amount_received = total_cents` and `application_fee_amount = application_fee_cents`; if either differs, record nothing and raise so a person looks. Then record `amount_cents = G + F`, `donor_covered_fee_cents = F`, `fee_cents = Σ stripe_fee`, `chip_in_cents = C`, `application_fee_cents = A`, `charged_cents = T`. No new webhook event is needed; the application fee is read from the PaymentIntent.

**Test mode:** application fees work in Stripe's test mode on a connected test account, so the whole flow is provable on the sandbox before real money. Live use waits for the live-authorization guard (PAYMENTS_PLAN G9, PR 1).

## 9. Receipts, statements and QuickBooks

### 9.1 Receipts and statements

- **The gift total includes the covered fee.** Everything that sums `amount_cents − refunded_cents` already does: `app.year_end_statement` (`0522`), `app.year_end_review` and `app.receipt_copy` (`0746`), the receipt email, and the member app's giving total (`connect-mobile/src/lib/api/giving.ts`). Each line also carries `covered_fee_cents` so the receipt can say "includes $3.45 card fee you covered".
- **The Chip In is a separate block, never in the total.** On the receipt email and the thank-you screen: "Chip In to Weaver: $5.00. This is a contribution to Weaver, not a gift to {Organization}. It is not part of the receipt above." On the year-end statement: a short section below the total, "Chip Ins to Weaver in {year}", read from the ledger. The staff receipt copy shows one information line, not a total.
- **Tax, in one sentence:** whether the covered fee counts as part of a deductible gift, and how a Chip In is treated, is for the organization's accountant to confirm; Weaver gives no tax advice, and the receipt wording needs counsel's review.

### 9.2 QuickBooks (cash basis, as today)

Stripe pays the organization `T − S − A = (G + F) − S`. The application fee never reaches it, so the books must see exactly that, and they do once `fee_cents` is Stripe's fee only.

| Posting | Amount | Account (role) |
|---|---|---|
| Sales receipt for the payment (`donation_card`) | `G + F` | Deposited to **payment clearing** as now. Income lines: the gift's allocations by fund account as now, plus **F as one line "Processing fee covered by donor"** |
| Processor fee journal entry (`processor_fee`) | `S` | Debit **merchant fees** (the mapping that exists), credit payment clearing |
| The Chip In | none | Not in the books: not income and not an expense of the organization |

- **Where F lands.** Today's leftover rule posts it to General donation income (`account_for_fund('general')`), which is what "they are donating it" implies. No new *required* account role, because a required role would stop all card posting for existing organizations until mapped (`CCMAP`, `0779`). An optional role `covered_fees` lets a treasurer map it elsewhere (for example against merchant fees) through the existing two-person mapping change. Decision 11.
- **Do deposits still match?** Payment clearing nets `(G + F) − S`, which is what Stripe pays out. If `fee_cents` held `S + A`, clearing would be short by exactly the Chip In: the trap section 7.5 closes. The payout screen shows gross charged, processing fees, Chip Ins (not the organization's) and net.
- **Stripe's dashboard** shows $108.45 charged and a $5.00 application fee while the receipt says $103.45. The payment detail and the treasurer's help text explain this in one line.
- **Refund postings** follow the payment's `G + F` side as the builder already does; the Chip In never appears.

## 10. Refunds, disputes, failures, recurring, installments, guests

### 10.1 Refunds (the two-person refund, one per payment, as now)

Stripe does not refund the application fee by itself; the refund call must pass `refund_application_fee=true`. A full refund returns the whole fee, a partial refund a proportional share. Stripe keeps its own processing fee on any refund.

- **Request and approvals are unchanged** (`request_provider_refund`, a second approver, a reason). The screen shows the donor's side: "Refunding $41.93 to the donor's card (includes $1.93 of their Chip In)".
- **Full refund:** the worker refunds the **whole charge `T`** with `refund_application_fee=true`. The donor gets everything back, covered fee and Chip In included; Weaver's application fee goes back to the organization. The organization is out only Stripe's fee. The payment becomes `refunded`, the ledger row `refunded`, and the allowance returns.
- **Partial refund (recommended: scaled, decision 8).** The approvers approve `R` against the organization's side (`G + F`). The worker refunds `R′ = round(R × T ÷ (G + F))` with `refund_application_fee=true`, so the donor gets the same share of everything they paid and Stripe returns the same share of the application fee. Example: the $103.45 payment above with a $5.00 Chip In (`T = $108.45`) and approved `R = $40.00` gives `R′ = $41.93`, Stripe returns $1.93 of the application fee, and the organization's net loss is exactly $40.00.
- **Recording:** `refunded_cents += R` (the two-person trigger and every statement behave as now); `provider_refunded_cents += R′`; `application_fee_refunded_cents` from Stripe's answer; the ledger row's `refunded_cents` follows the Chip In share.
- **A refund made in Stripe's dashboard** (flagged for two approvals, as now) leaves the application fee with Weaver, because the organization's own dashboard cannot return it. When the second approval records it, a worker job returns the matching share to the organization with Stripe's application-fee refund call (a platform action that only gives money back; decision 9).
- Members still cannot refund from the app (decisions #7/#8 of 2026-09-25); credit stays credit.

### 10.2 Disputes and chargebacks (G8, PR 8)

Disputes are ignored today, so nothing changes by default. For a direct charge Stripe takes the disputed amount from the **organization's** balance, and the dispute fee ($15.00 on standard pricing) from whoever the account's fee configuration names (for a Standard connected account, the organization). The pages read do not say the application fee returns with a lost dispute, so the organization would lose the Chip In part while Weaver keeps it.

- **Until PR 8:** the Chip In stays `collected`; the limitation is stated in the treasurer's help text and on the platform admin overview.
- **With PR 8:** a dispute marks the ledger row `disputed`; a **lost** dispute returns the application fee to the organization (decision 9); a won one changes nothing.

### 10.3 Failed, cancelled and abandoned checkouts

Nothing is charged and no payment exists. The reserved ledger row is released at once on `checkout.session.expired`, `checkout.session.async_payment_failed`, `payment_intent.payment_failed` or a cancel, and by the daily sweep otherwise. The member sees what they see today ("Nothing was charged").

### 10.4 Recurring gifts (design for later; needs saved methods, B16 and PR 9)

- **Ask once at setup.** The member chooses "cover the card fee" (or not) and a standing Chip In (or "No Chip In"); both are stored on the recurring gift. The covered fee is stored as a **rule**, not a number, and recomputed at each charge because the fee depends on the amount and method. Setup says "about 3.2% plus 30 cents each time".
- **Chip In per charge, within the limit.** Each charge asks the ledger like any checkout and charges `min(standing amount, amount left this year)`, or zero. The first reduced or skipped charge sends one plain message ("Your Chip In for this year is complete. Thank you."). The limit resets on 1 January in the organization's time zone. The member can change both choices at any time.

### 10.5 Pledge payments in installments

Each installment is its own charge and its own quote. The gift part lowers the pledge by that installment only. The fixed 30 cents is charged each time, so three installments cost more in covered fees than one payment; the box shows the exact amount each time. Chip In allowance is used first-come across installments, then asking stops.

### 10.6 Guests and a public give page

None exists. When one does (B55's donate page, or a paid RSVP) it must call `payment_addons_quote` and `create_checkout`. A guest has no account to count a limit against, so **no Chip In and no fee-cover for guests until a guest is identified by a verified email within the organization** (decision 15).

## 11. Settings screens

### 11.1 The organization: Settings › Payments (and Rules › Giving)

- **Stripe's card, replacing "Not offered yet":**

  > **Donors covering the card fee:** Off. Turn on to ask donors, at checkout, whether they want to add Stripe's card fee to their gift. They tick a box; nothing is added unless they do, and {Organization} then receives the full gift. The covered fee counts as part of the donor's gift on receipts and statements. The amount is an estimate at Stripe's standard US rate (about 2.9% plus 30 cents for cards, 0.8% up to $5 for bank debit); your actual fee is recorded from Stripe. Cards from outside the US cost Stripe more, and your organization pays any difference. Offered for gifts only. Needs a reason; saved in the audit log.

  Who may change it: the owner, `integrations.manage` or `giving.manage` (`payments_can_configure`), as for every payment setting. The panel also shows the effective rate row and, read-only, the platform's Chip In summary when a platform admin has set one ("On: members may add a Chip In to Weaver, up to {limit} a year each"). **PayPal's card says: "Not available with PayPal."**
- **Rules › Giving:** the "Ask donors to cover processing fees" toggle (`fees.ask_donor_to_cover`, `GivingForm`) is **removed** and replaced by one line pointing to Settings › Payments. It defaults to on and does nothing today, so wiring it up would silently start asking every organization's donors the day the feature ships: the opposite of the owner's default-off rule. The key stays in old rule bags and is ignored.
- **The one switch** is the existing column `donor_covers_fee_allowed`, now allowed to be true for Stripe, with a check that it is never true for PayPal.

### 11.2 The platform admin: Platform › Communities › the organization

The page is `src/app/(app)/platform/centers/[id]` (labelled "Centers" in the portal today). It gains one card, **"Chip In and card fees"**:

- **Ask members for a Chip In** (a switch, off by default), **Yearly limit per account** ($1 to $1,000), **Suggested amounts** (one to four).
- **Card fee estimate:** "Standard rate" or a custom rate row with the date and a note (for example "approved nonprofit pricing").
- **Reason** (required) and "Last changed by {name} on {date}: {reason}".
- **This year:** accounts that chipped in, collected, refunded, and how many reached the limit. Test-mode amounts are excluded and labelled. No names.
- **Default, unset:** "Not set. No Chip In is asked of this organization's members." The switch cannot be turned on until a limit and at least one suggestion are saved.
- **Authority and 2FA:** platform admins only (`app.is_platform_admin()`, enforced in the function). **No fresh 2FA check**: the owner's rule of 2026-10-14 (`app.step_up_required`, `0787`) asks only for creating a sandbox, approving go-live, promoting and granting a module. A reason is required and every save is audited (who, when, old and new values, reason). The organization's owner gets a Home notice when a platform admin changes it (decision 12).
- A failed save says so next to the card ("Could not save the Chip In settings. {plain reason}") with the detail logged.

Platform-wide Stripe fee rates are edited under Platform › Payments beside the existing pauses. Pausing the Card plugin there still stops every Stripe checkout, and with it every Chip In.

## 12. Not covered, risks and open questions

- **PayPal.** Cover-the-fee would take a PayPal rate row (standard or charity; the actual fee is already read from `seller_receivable_breakdown.paypal_fee`), the extra as a separate `handling` line in the order's amount breakdown, and the same server-side quote. A **Chip In on PayPal** needs PayPal's platform fee on the order, which needs the partner-connected route (PAYMENTS_PLAN S5, Q7), not the email-only route.
- **Apple (verify; not legal advice).** A Chip In is a payment to Weaver, not a charitable gift, taken on a Stripe page opened from inside the iOS app. The payments plan already carries the App Store question for nonprofit fundraising (R2, S11). Ask Apple in the same conversation whether an optional contribution to the app's operator on a web checkout is allowed under the in-app purchase and tipping rules; if not, the iOS app hides the Chip In and Android and the web keep it.
- **Tax and receipts.** The covered fee inside a deductible gift, the Chip In, and the receipt wording are for each organization's accountant and for counsel.
- **Which legal entity receives Chip Ins** and how that revenue is booked is open in DECISIONS (the platform entity is undecided). The design needs one Stripe platform account.
- **The store** (section 3, last row), other wallets such as Link (card rate assumed), non-USD organizations: not covered.
- **Rounding.** Stripe's rounding can differ from ours by a cent; the real fee is recorded and shown.
- **Old app versions** send none of the new fields and are charged exactly as before. A new app against an old portal falls back, as `member_payment_methods` does today.
- **Sandbox first.** All of it is provable on the JSH sandbox in Stripe's test mode. The first real-money proof is a small live payment run by the owner after the go-live gate in section 13.

## 13. Build slices, in order

**Migration numbers:** use the next free number above `main`'s highest and above every open pull request and branch. Run `git fetch`, `gh pr list --repo malavsanghvi/connect-crm --state open` and `git branch -r`, and **re-check right before opening a pull request**: the numbers `0860` and below may be taken. (On 2026-10-15 `main`'s highest was `0860`, and open work held `0579` and `0788`; the first free number was `0861` or higher.) After each migration run `supabase/tests/run_local.sh` (the "Database tests" CI job does), regenerate `src/lib/database.types.ts` with `supabase/scripts/gen-types.mjs`, and copy it to connect-admin and connect-mobile. Never edit an applied migration.

Each slice is shippable and **inert** until a switch is turned: no organization has fee-cover on and no platform admin has set a Chip In.

| # | Slice | Owner's OK first | Size |
|---|---|---|---|
| 1 | **Database.** Migration A: drop `center_payment_processors_no_donor_fee`, replace `set_payment_processor`, the new columns, `payment_fee_rates`, `fee_estimate`, the allocation, credit and report changes, `payment_addons_quote`, `create_checkout` v2 (old form dropped), the extended worker functions. Migration B: `chip_in_settings`, `chip_in_ledger`, RLS, `platform_set_chip_in`, `my_chip_in_offer`, the release sweep. Tests: the table in section 5.2 and the brute-force invariant, the limit across concurrent checkouts, the year boundary, test-mode rows, release on failure, the gift-only allocation, credit and reports unchanged, offline rows forced to zero, the RLS matrix of 6.7, audit rows, demo clear | **Yes: money rules and RLS** | L |
| 2 | **Stripe checkout and recording:** `server.ts`, the intent route, `worker/src/payments/core.ts`, `payments.webhook.stripe.ts`, the mock `e2e/mocks/payments-mock.cjs` (`application_fee_amount`, `fee_details`). Tests in `worker/test/payments.test.ts`, `tests/payments.test.ts`, `e2e/flows/o-payments.cjs`; a Stripe **test-mode** proof on the sandbox, which also settles whether `fee` includes the application fee | Yes | M |
| 3 | **Refunds:** full, scaled partial, `refund_application_fee`, `provider_refunded_cents`, the dashboard-refund check, the application-fee return for flagged refunds | **Yes: refunds** | M |
| 4 | **Portal screens:** Settings › Payments toggle and wording, the Rules › Giving line, payment detail and Giving › Payments information lines, the reconciliation help text | Yes (wording) | S-M |
| 5 | **Member app Pay sheet** (connect-mobile, JavaScript only, so over the air): the lines, "No processing fee for this method", fallbacks against an older portal, unit tests of the sheet's logic | No new rule | M |
| 6 | **Receipts and statements:** `receipt_copy`, `year_end_statement`, `year_end_review`, the receipt email, the thank-you screen, the member giving history | Yes (receipt wording) | M |
| 7 | **QuickBooks:** the relabelled leftover line, the optional `covered_fees` role, the payout fee split and screen | Yes (accounting) | S-M |
| 8 | **Platform admin card,** the fee-rate editor under Platform › Payments, the Home notice, the overview | Yes (permissions) | S-M |
| 9 | **Docs:** `ARCHITECTURE.md`, `PAYMENTS_PLAN.md` (constraints, G15), `DECISIONS.md`, `DEPLOY.md`, the treasurer help text, the website pricing wording (another task removes the $25) | No | S |

**Go-live gate:** slices 1 to 3 and 6 to 8 are live and proven in Stripe test mode before any organization turns fee-cover on or any platform admin sets a Chip In for a live organization.

## 14. Decisions for the owner

| # | Decision | Recommendation | Alternative |
|---|---|---|---|
| 1 | How a payment records the covered fee | `amount_cents = gift + covered fee`; covered part in `donor_covered_fee_cents`; allocation, credit and reports subtract it; existing totals include it | `amount_cents = gift only` with the fee beside it: no allocation change, but every statement, KPI and the app's giving total must add the fee, and a missed one under-reports a donor |
| 2 | Who pays the card fee on the Chip In when the member does not cover fees | Weaver absorbs it (`A = C − the extra card fee`), so "your organization never pays" stays true | The organization pays a few cents; change the website sentence |
| 3 | Default state of the Chip In | Nothing pre-selected; "No Chip In" is the default | A pre-selected suggestion, as the website sketch implies (more revenue, more complaint risk) |
| 4 | Which payments get which extra | Fee-cover on gifts only. Chip In on gifts, dues, tickets and Pathshala fees; store once its payment is linked | Add dues and tickets to fee-cover later, with their own receipt wording |
| 5 | What an "account" is for the yearly limit | The paying person's login within the organization | The household (two parents share one limit) |
| 6 | Year and refunds | Calendar year of the checkout start in the organization's time zone; a refunded Chip In gives its allowance back; test mode never counts | Count refunded amounts as used; use the payment date |
| 7 | Chip In amounts | Suggestions plus "Other" from $1.00 to what is left; limit bounds $1 to $1,000 | Suggestions only |
| 8 | Partial refunds | Scaled: the donor gets back the same share of everything and the organization's loss equals the approved amount; a full refund returns all, covered fee and Chip In included | Unscaled: the donor gets exactly the approved amount and no share of the Chip In |
| 9 | Chip In after a dashboard refund or a lost dispute | Weaver returns the matching application fee to the organization | Weaver keeps it |
| 10 | The estimate and its differences | One platform rate table (US card 2.9% + 30 cents, bank 0.8% up to $5); per-organization rows set by a platform admin only; the real Stripe fee is recorded; differences stay with the organization and are shown; international cards are the organization's risk | A fixed surcharge, or refunding differences to donors (not recommended) |
| 11 | Where the covered fee posts in QuickBooks | General donation income as "Processing fee covered by donor"; optional `covered_fees` role to move it; no new required account | Reduce merchant fees expense (the accountant's call per organization) |
| 12 | Who sees or turns off the Chip In | The organization sees a read-only summary and a notice when it changes; only a platform admin changes it, with a reason and an audit entry, no 2FA | Let the organization switch it off for its own members |
| 13 | The dead Rules › Giving toggle | Remove it; Settings › Payments is the one switch | Keep it as the switch (it defaults to on, so it would need a one-time reset to off) |
| 14 | Card versus bank debit | The member chooses the method first; the session is limited to it whenever a fee is covered | One session with both and a card-rate estimate (bank-debit donors over-cover) |
| 15 | Guests and recurring | No extras for guests until a verified email identifies them; recurring remembers the one-time choices, charges `min(standing Chip In, what is left)`, and arrives with saved methods (B16) | Ask a guest anyway and count by an unverified email |
| 16 | Apple | Ask Apple (with S11) whether the Chip In is allowed inside the iOS app; hide it there if not | Ship it everywhere and handle a review rejection later |

**Approval needed.** Money rules, permissions and RLS need the owner's approval before anything is built. This pull request adds this document and updates two backlog rows; it builds nothing.

## Appendix: sources (read 2026-10-15; re-check before building)

- Stripe, direct charges and application fees (`application_fee_amount` on a Checkout Session's `payment_intent_data`; positive and less than the charge; "no additional Stripe fees on the application fee"; the balance transaction shows a fee breakdown of both fees; the $10.00 / $1.23 / $0.59 / $8.18 example; refunds do not return the application fee unless `refund_application_fee` is true; a full refund returns it all and a partial one a proportional share): https://docs.stripe.com/connect/direct-charges
- Stripe, the balance transaction object (`fee`, `fee_details`): https://docs.stripe.com/api/balance_transactions/object
- Stripe, disputes on Connect platforms (a direct charge's disputed amount is debited from the connected account; dispute fees follow the account's fee configuration): https://docs.stripe.com/connect/disputes
- Stripe, US pricing (cards 2.9% + 30 cents, international +1.5%, currency conversion +1%, ACH debit 0.8% capped at $5.00, disputes $15.00): https://stripe.com/pricing
- This repository: `supabase/migrations/0003`, `0104`, `0191`, `0211`, `0212`, `0410`, `0522`, `0543`, `0590`, `0672`, `0746`, `0779`, `0787`; `src/lib/payments/*`; `worker/src/payments/*`; `worker/src/handlers/payments.*`; `connect-mobile/src/features/pay/*`.
