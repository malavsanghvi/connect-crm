# Stripe test-mode proof: the covered card fee and the optional Chip In

What the owner runs, in JSH's sandbox with Stripe in **test mode**, before any organization turns the covered card fee on or any platform
admin asks a live organization's members for a Chip In (the go-live gate of [`PAYMENT_ADDONS.md`](PAYMENT_ADDONS.md) section 13). Nothing here
moves real money: every charge is a Stripe test charge on a test connected account. No step asks for, or needs you to paste anywhere, a
secret key; the only credential you type is the sign-in code Weaver e-mails to the member you test as.

**What this proves** (slice 2): that the Checkout Session carries the lines and the application fee we think it does; that the organization
nets exactly the gift when the card fee is covered; that the application fee lands on Weaver's platform account; that Weaver records Stripe's
real card fee **without** the application fee; and, above all, **whether `balance_transaction.fee` includes the application fee**. It does not
test refunds (slice 3: the scaled refund and `refund_application_fee`), the receipt wording (slice 6), QuickBooks (slice 7) or the Pay sheet in
the member app (slice 5; until it ships, `scripts/chip-in-proof.mjs` starts the checkout exactly as the sheet will).

## 1. Before you start (10 minutes, once)

1. **Which community.** JSH must be a **sandbox** (Settings › Payments shows "Test mode only", and no "Switch to live" button). In the Supabase SQL
   editor: `select id as center_id, environment from app.centers where slug = 'jsh';` must say `sandbox`. Write down `center_id`. If it says
   anything else, stop: do not run this on a live organization.
2. **Stripe is connected in test mode.** Settings › Payments › Stripe shows a connected account (`acct_...`) in **Test mode**. If it says Not connected,
   press Connect Stripe and sign in with a Stripe **test** account (the one whose dashboard you will open in section 5).
3. **Weaver's Stripe test setup is complete** (Platform › Setup): the test secret key, the Connect client id and the **test-mode webhook signing secret**. In
   Stripe (test mode) › Developers › Webhooks, the endpoint `https://<portal>/api/webhooks/stripe` is a **Connect** endpoint ("Listen to events on
   Connected accounts") that includes at least: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.payment_failed`, `charge.refunded`, `payout.created`,
   `payout.updated`, `payout.paid` (the list in `PAYMENTS_PLAN.md` S3).
4. **The background service is running** (Settings › Integrations shows a recent heartbeat for `connect@worker`). It is the worker that records the payment.
   This PR must be merged and deployed (portal and worker) before the proof: the proof tests what is deployed.
5. **A member to test as** (an adult of a household in JSH's sandbox whose sign-in e-mail you can read) and **an open pledge** of $100.00 for that household
   per payment you will make. Find the ids, then make a pledge (one per payment: a paid pledge cannot be paid twice):

   ```sql
   -- the household of the member you test as
   select hm.household_id, pe.id as person_id from app.household_members hm join app.people pe on pe.id = hm.person_id
    where pe.email = '<the member''s e-mail>' and hm.left_at is null limit 1;
   -- an open pledge of $100.00 (general gift); repeat for each payment below and note the id
   with i as (insert into app.pledges (center_id, household_id, source, amount_cents)
              values ('<center_id>', '<household_id>', 'general', 10000) returning id) select id as pledge_id from i;
   ```
6. **Your Stripe dashboards, both in Test mode** (the toggle at the top): (a) **JSH's own Stripe test account** (the connected account) and (b) **Weaver's
   platform account**. Open both in separate windows.
7. **The two public values the script needs**: `SUPABASE_URL` and `SUPABASE_ANON_KEY` (the `NEXT_PUBLIC_*` pair every app ships: Supabase › Project Settings › API,
   "Project URL" and the `anon` `public` key; never the `service_role` key) and `PORTAL_URL` (the portal's address). In PowerShell:
   `$env:SUPABASE_URL = "..."; $env:SUPABASE_ANON_KEY = "..."; $env:PORTAL_URL = "..."` in the repository folder.

## 2. Switch the two options on (test only)

Both are off everywhere. Until the settings screens ship (Settings › Payments in slice 4, Platform › Communities › JSH › "Chip In and card fees" in slice 8) you
turn them on with the functions the screens will call. In the Supabase SQL editor (it runs as `postgres`; the first two lines make the functions see you, as the
database would see you in the portal). Get your user id with `select id from auth.users where email = '<your sign-in e-mail>';`.

```sql
-- (a) The organization lets donors cover the card fee: you must be the owner (or hold integrations.manage or giving.manage) of JSH.
begin;
select set_config('request.jwt.claims', json_build_object('sub', '<your user id>', 'role', 'authenticated')::text, true);
set local role authenticated;
select app.set_payment_processor('<center_id>', 'stripe',
  (select methods from app.center_payment_processors where center_id = '<center_id>' and processor = 'stripe'),
  (select statement_descriptor from app.center_payment_processors where center_id = '<center_id>' and processor = 'stripe'),
  true, 'Stripe test-mode proof of the covered card fee');
commit;

-- (b) A Weaver platform admin asks JSH's members for a Chip In: $50.00 a year per account, suggestions $2, $5, $10 (JSH's saved setting, 0863).
--     You must be a platform admin (select is_platform_admin from app.accounts where user_id = '<your user id>' must be true).
begin;
select set_config('request.jwt.claims', json_build_object('sub', '<your user id>', 'role', 'authenticated')::text, true);
set local role authenticated;
select app.platform_set_chip_in('<center_id>', 5000, array[200, 500, 1000]::bigint[], true, 'Stripe test-mode proof of the Chip In');
commit;
```

Check: `select donor_covers_fee_allowed from app.center_payment_processors where center_id = '<center_id>' and processor = 'stripe';` is `true`, and
`select asking, yearly_limit_cents, suggested_cents from app.chip_in_settings where center_id = '<center_id>';` is `true | 5000 | {200,500,1000}`. When the platform
admin card (slice 8) has merged, use it for (b) instead; the result is the same row.

## 3. The payments to make

For each row, make a **new** $100.00 pledge (section 1, step 5) and run the script with its pledge id. It signs in as the member (it asks for the code Weaver e-mails
them), prints the database's quote, starts the checkout through the portal and prints the Stripe page. **Compare the quote with the "Card charged" column before you pay**;
a different number is already a finding.

```powershell
node scripts/chip-in-proof.mjs --email <the member's e-mail> --center <center_id> --household <household_id> --pledge <pledge_id> --gift 10000 [flags]
```

| # | Flags | What the payer sees | Card charged | Stripe's fee (estimate) | Application fee (Weaver) | The organization nets |
|---|---|---|---|---|---|---|
| A | (none) | gift $100.00 | **$100.00** | $3.20 | $0 | $96.80 |
| B | `--cover-fee --method card` | gift $100.00, card fee $3.30 | **$103.30** | $3.30 | $0 | **$100.00** |
| C | `--chip-in 500 --method card` | gift $100.00, Chip In $5.00 | **$105.00** | $3.35 | **$4.85** | $96.80 (as with no Chip In) |
| D | `--cover-fee --chip-in 500 --method card` | gift $100.00, card fee $3.45, Chip In $5.00 | **$108.45** | $3.45 | **$5.00** | **$100.00** |
| E | `--cover-fee --method ach` | gift $100.00, bank debit fee $0.81 | **$100.81** | $0.81 | $0 | **$100.00** |

Row D is the one that matters most: **$100.00 gift, $3.45 card fee, $5.00 Chip In, $108.45 charged** (spec 5.2). Stripe's own fee is worked out on the whole $108.45 and the
organization still nets exactly $100.00. A difference of a cent or two from Stripe's real fee is expected (the rates are estimates; the real fee is what Weaver
records). A difference of more than a few cents means the rate table (`app.payment_fee_rates`) needs an organization-specific row: tell the developer.

## 4. Paying on Stripe's page (test cards only)

- **Card (A to D):** card number `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP. The page must show **the same lines and total as the quote** (for D: "Pledge ... · Jain Society of Houston $100.00", "Card fee you chose to cover $3.45", "Chip In to Weaver (optional) $5.00", total $108.45) and only the **Card** method.
- **Declined card (once, on C):** `4000 0000 0000 0002`. Stripe shows the decline and lets you retry in the same session; then pay with `4242...`. Weaver may mark the checkout failed on the decline and still records the payment when the retry succeeds, and the Chip In still counts once.
- **Bank debit (E):** the page offers **only** Bank account. Stripe's own test bank: choose "Test Institution" and the "Success" account (see Stripe's testing page, https://docs.stripe.com/payments/ach-direct-debit, for the current test accounts). A bank debit settles later: Weaver records the payment when Stripe sends `checkout.session.async_payment_succeeded` (in test mode usually within minutes), not when you press Pay.
- **Never** use a real card or a real bank, even though the community is a sandbox.

## 5. What to look at afterwards

### 5.1 In Stripe

1. **The settling question: does `balance_transaction.fee` include the application fee?** In Weaver's platform dashboard (test mode) › Developers › Logs, open the request
   `GET /v1/payment_intents/pi_...` that Weaver's worker made for payment D (it carries `expand[]=latest_charge.balance_transaction`). In the response, find `latest_charge.balance_transaction`
   and read **`fee`** and **`fee_details`**. Write both down in section 7. The documented shape is `fee: 845` with `fee_details` = one `stripe_fee` of 345 and one `application_fee` of 500, so `fee`
   includes the application fee. If `fee` is 345 instead, the breakdown still lists both and Weaver is still right (it uses the breakdown by type, not `fee`); record the finding.
   The same numbers are in Weaver: the worker's log line `stripe: fees of a charge` and the job result (section 5.2).
2. **The organization nets exactly the gift (B, D, E).** In JSH's own Stripe test dashboard › Payments, open the payment: for D the amount is $108.45, the Stripe fee $3.45, the application fee $5.00, **net $100.00**.
   For B the net is $100.00 too; for C it is $96.80 (not $96.65, which would mean the organization paid a few cents on the Chip In); for A it is $96.80.
3. **The application fee reaches Weaver (C, D).** In Weaver's platform dashboard › Connect › Collected fees (Stripe also calls these *application fees*; or search Balance › Transactions for a row of type *Application fee*), there is a
   $4.85 fee for C and a $5.00 fee for D, each tied to JSH's account and the payment.
4. **The payment's page.** For D the Stripe payment shows the metadata `checkout_id`, `gift_cents=10000`, `covered_fee_cents=345`, `chip_in_cents=500`.
5. **Refunds: not part of this proof.** Do **not** refund payments C or D in Stripe's dashboard to test them; a refund made there is flagged in Weaver for two approvals and does not return the application fee. Refund behaviour is slice 3. (Test charges can simply stay.)

### 5.2 In Weaver (Supabase SQL editor; `<checkout_id>` is printed by the script)

```sql
-- the payment: amount = gift + covered fee; covered fee; gift; Stripe's fee ONLY; Chip In; application fee; charged in total; method
select p.amount_cents, p.donor_covered_fee_cents, p.gift_cents, p.fee_cents, p.chip_in_cents, p.application_fee_cents, p.charged_cents, p.method, p.provider_ref, p.id as payment_id
  from app.payments p join app.payment_checkouts k on k.payment_id = p.id where k.id = '<checkout_id>';
-- the checkout and the Chip In allowance
select status, covered_fee_cents, chip_in_cents, application_fee_cents, total_cents, pay_method from app.payment_checkouts where id = '<checkout_id>';
select status, chip_in_cents, application_fee_cents, mode, payment_id is not null as paid from app.chip_in_ledger where checkout_id = '<checkout_id>';
-- only the gift is applied to the pledge, which is now paid
select coalesce(sum(a.amount_cents), 0) as applied_to_pledges from app.payment_allocations a join app.payments p on p.id = a.payment_id join app.payment_checkouts k on k.payment_id = p.id where k.id = '<checkout_id>';
select status from app.pledges where id = '<pledge_id>';
-- how Weaver read Stripe's fees (the answer to the settling question, as the worker saw it)
select result->'fees' as fees, last_error from app.jobs where kind = 'payments.webhook.stripe' and payload->>'event_id' = (select event_id from app.webhook_events
  where provider = 'stripe' and event_type like 'checkout.session.%' and payload->'data'->'object'->'metadata'->>'checkout_id' = '<checkout_id>' order by received_at desc limit 1);
```

Expected for **D**: payment `10345 | 345 | 10000 | 345 | 500 | 500 | 10845 | card`; checkout `paid`, `345`, `500`, `500`, `10845`, `card`; ledger `collected | 500 | 500 | test | true`; applied to pledges `10000`; pledge `paid`;
`fees` = `{"fee_cents": 845, "itemised": true, "processing_fee_cents": 345, "application_fee_cents": 500}`. The line that matters: **`fee_cents` is 345, not 845**, so
`amount_cents - fee_cents` = 10000 = what the organization receives, and a QuickBooks deposit would match.

Expected for **A**: `10000 | 0 | 10000 | 320 | 0 | 0 | 10000 | card` and no ledger row. **B**: `10330 | 330 | 10000 | 330 | 0 | 0 | 10330 | card`. **C**: `10000 | 0 | 10000 | 335 | 500 | 485 | 10500 | card`, ledger `collected | 500 | 485`.
**E**: `10081 | 81 | 10000 | 81 | 0 | 0 | 10081 | ach`.

Also look at: the worker log (`stripe: fees of a charge` with `balance_transaction_fee_cents`, `fee_details_cents`, `processing_fee_cents`, `application_fee_cents`; there must be no line saying the payment was NOT recorded or that the breakdown and the PaymentIntent disagree); the member's thank-you in the app (nothing new until slice 5/6); Giving › Payments (shows the payment; the "includes $3.45 card fee" and Chip In lines arrive with slices 4 and 6).

### 5.3 The limit, the expiry and the mismatch (optional but worth doing once)

- **Limit.** JSH's limit is $50.00 a year per account. After C and D the member has used $10.00 (test mode counts among test mode). Start checkouts with `--chip-in 4001` (refused, 409 `CCLIM`: "A Chip In can be at most $40.00 more this year.") and `--chip-in 4000` (allowed; do not pay it); then `--chip-in 100` is refused ("You have reached this year's Chip In limit."), because the unpaid reservation counts.
- **Expiry gives the allowance back.** Leave that unpaid $40.00 checkout alone. The Stripe session expires an hour after it was made; then `select status from app.payment_checkouts where id = '<its checkout_id>';` is `expired` and `select status from app.chip_in_ledger where checkout_id = '<its checkout_id>';` is `released`, and a new `--chip-in 4000` is allowed again. (If the event is ever lost, `payments.release_chip_ins` runs daily and releases it within 26 hours; check `select status, finished_at, result from app.jobs where kind = 'payments.release_chip_ins' order by id desc limit 3;`.)
- **The total changed.** Run the script with `--cover-fee --expect 10000` (the payer "saw" $100.00, the database now works out $103.30): the route answers 409 `CCTOT` with "Could not start the payment. The total changed from $100.00 to $103.30. Review it and try again. Nothing was charged.", no Stripe page is made and no checkout row is created.
- **A charge that is not the checkout's total** cannot be made on purpose in Stripe's test mode; it is covered by the worker tests (`worker/test/payments.test.ts`) and the end-to-end flow (`e2e/flows/o-payments.cjs`, section 10).

## 6. Switch everything off again

```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub', '<your user id>', 'role', 'authenticated')::text, true);
set local role authenticated;
select app.platform_set_chip_in('<center_id>', 5000, array[200, 500, 1000]::bigint[], false, 'Stripe test-mode proof finished');
select app.set_payment_processor('<center_id>', 'stripe',
  (select methods from app.center_payment_processors where center_id = '<center_id>' and processor = 'stripe'),
  (select statement_descriptor from app.center_payment_processors where center_id = '<center_id>' and processor = 'stripe'),
  false, 'Stripe test-mode proof finished');
commit;
```

Test-mode rows never count toward a live allowance and never appear in revenue figures, so there is nothing else to clean up.

## 7. The result (fill in, and tell the developer)

| Question | Answer |
|---|---|
| Quote equals the Stripe page and the "Card charged" column for A to E | |
| `balance_transaction.fee` for D (expected 845) and `fee_details` | `fee` = ___; `stripe_fee` = ___; `application_fee` = ___ |
| Does `fee` include the application fee? | yes / no |
| `payments.fee_cents` for D (expected 345) | |
| JSH nets (B, D, E expected $100.00; C expected $96.80) | B ___ D ___ E ___ C ___ |
| Application fee reached the platform (C $4.85, D $5.00) | |
| Stripe's real fee differed from the estimate by (cents) | |
| Anything in the worker log about a payment NOT recorded | |

If any row is off, do not go on to slices 3 and 6 to 8 or turn anything on for a live organization until it is understood.
