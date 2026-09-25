# Decisions

Durable record of what has been decided, by whom, and what is still open.
Source: the *Decision log* tab of the JSH Platform design doc (Sep 2026), plus
decisions made while building v1. Where a decision is enforced in code, the
enforcing object is named so it can be found.

## Build decisions (Sep 2026)

| Area | Decision | Enforced in |
|---|---|---|
| Repos | Three repos — connect-crm, connect-admin, connect-mobile — under `malavsanghvi` | — |
| Backend | One Supabase project; schema `app`; connect-crm owns migrations and publishes generated types to the other two | `supabase/`, `scripts/gen-types.mjs` |
| Stack | Next.js (App Router) for CRM and Admin; Expo (React Native) for Mobile; TypeScript throughout | — |
| Tenancy | Multi-tenant from the first commit: every row has `center_id`; isolation by RLS | `0010_rls.sql` |
| Identifiers | Each member has a permanent Connect number plus any number of external identifiers: the org's register number, legacy CRM ids, accounting (QuickBooks) customer id, bank payer names as they appear on the bank statement (Zelle / ACH), payment-provider ids. Bank payer names are matching hints, not keys; they are learned on each confirmed match. | `0012_identifiers_and_bank.sql` |
| Numbering | Human-readable per-center numbers: member `JSH-10001`, household `JSH-H-2001`, pledge `JSH-PL-20001`, order `JSH-S-1001`, receipt `JSH-R-100001`. Member numbers never change; a center may adopt its existing register numbers at migration. | `app.assign_numbers`, `app.freeze_numbers` |
| Bank reconciliation | Statement lines are imported and matched to households by known payer name, number in memo, or member name; confirming records the payment, allocates it and queues QuickBooks once | `app.suggest_bank_matches`, `app.confirm_bank_match` |
| Lunch slots | Slot calculation lives in the database, not in any app | `app.assign_lunch_for_rsvp` |
| Business rules | Money, bolis, check-in and points go through `security definer` RPCs that re-check rights | `0011_functions.sql` |
| JSH IDs | JSH assigns a person ID and a separate household ID. Person IDs are 4-digit numbers with leading zeros (`0417`). The two are different identifier kinds (`org_member`, `org_household`) because their numbers can overlap. Kept exactly as issued; leading zeros never distinguish two IDs (`417` = `0417`) | `app.canonical_org_id`, `external_ids_org_target` |
| Similar names | Names and household names are often near-identical, so nothing is matched on a name alone: imports use IDs, suggestions carry the household card and an `ambiguous` flag, and ambiguous matches are never auto-applied | `app.household_card`, `app.suggest_bank_matches` |
| Bank | JSH banks with Chase; Chase CSV is the primary statement format; check/cash deposits match a set of recorded payments; DAF / matching-gift / processor payouts recognized | `0013_chase_and_org_ids.sql` |
| Recurring gifts before online payment | Gifts set up in the app before a card or bank account exists get status `pending_payment_method` and are never charged; owner decision 2026-09-24 | `0026_owner_decisions.sql` |
| Email recipients | Only people with an explicit email opt-in record count as email recipients; no record means not opted in; owner decision 2026-09-24 | `app.segment_recipient_count` (0026) |
| Modules and traceability | Each subsystem is a module (18, catalog in `app.modules`) an org admin with `settings.manage` switches on or off, with a reason; People is core and never off; dependencies are enforced both ways. No `center_modules` row means on, so nothing changed for existing centers. The switch is enforced in the database, not just hidden: one restrictive `module_switch` RLS policy per module table (AND-ed with the existing policies, so it only ever restricts; platform admins pass) and `app.assert_module_enabled` at the top of every module RPC. Every app table has an `audit_<table>` trigger; entries record actor and JWT role, before/after (masked), module, and the request's id, reason, app, screen, user agent and IP (`x-request-id`, `x-audit-reason`, `x-client-app`, `x-client-screen`), or what an RPC/job set with `app.set_audit_context`. Headers are parsed once per transaction; the hash chain and append-only rule are unchanged. Owner decision 2026-09-24; see [MODULES.md](MODULES.md) | `0100`–`0104`, `app.set_module_enabled`, `app.audit_row`, `app.record_history` |
| Demo data pack (o-demo) | A sandbox can load a deterministic demo community, and be reset (cleared + reloaded) or cleared by its owner or a settings.manage admin, with a reason, the short name typed and a fresh 2FA check. The owner authorized deleting data for this, in sandboxes only; production, promoted, live, suspended and exited centers are refused in the database. Clearing keeps the organization, staff logins with a role, grants, agreements, connections, configuration of stages 0–2 and the audit log. Demo payments are historical (never posted to QuickBooks) and allocated by `allocate_payment`. | `app.demo_center_problem`, `app.demo_clear_center`, `app.demo_keep_tables` (0310–0312; owner, 2026-09-24) |
| Sandbox owner's first admin role (Wave B) | Accepted as a workaround for now: redeeming a sandbox code grants the owner's first `center_admin` role directly, recorded as given by the platform admin who issued the code; promotion treats the two go-live approvals as the second person | `redeem_sandbox_code`, `platform.promote` (owner, 2026-09-24) |
| QuickBooks donor matching (Wave B) | Past refunds and credit memos from QuickBooks are not brought in; they wait in Needs review until a refund-import rule exists. Undoing a mapping whose history is already on a household stays blocked; Remap is the path. Approving a match stores the QuickBooks ID as a household/person identifier (treasurer, `accounting.manage`); Remap re-points brought-in historical payments and pledges to the new household, allocations unchanged, audited with the reason | `qbo_customer_matches` RPCs, 0240–0243 (owner, 2026-09-24) |
| Owner decisions batch (2026-09-25) | (1) An organization's first second-admin grant is approved by Community Connect, approver named in the audit (until B5). (2) Center admins keep no giving/accounting/privacy permissions, but the **organization owner can do every task** in their organization. (4) Messaging setup/config changes stay admin-only; the communications officer views and tests. (5) No donor-covers-fee charge for now. (6) Refunds made in the Stripe/PayPal dashboard are recorded as flagged refunds needing approval after the fact. (7) Refunds for email-only PayPal accounts can be recorded by hand with two-person approval. (8) One refund request per payment for now. (9) Postings dated in a closed month wait for the treasurer. (10) A live QuickBooks test post (four $1.00 entries, voided by hand) is allowed after explicit confirmation and is explained during onboarding. (11) QuickBooks refunds/credit memos come in as historical refunds reducing the matching payment. (13) Sandbox sign-in codes reach anyone signing in. (14) Push-token claim risk accepted for now. (15) A non-member unsubscribe blocks newsletters only. (16) Texting/WhatsApp approvals entered by a platform admin. (17) The admin app gets its own HTTPS port. (18) Storage retention defaults as planned. (19, 20) Member legal texts and organization agreements are editable and re-publishable later (counsel); member-facing notices/disclaimers are part of the member's first sign-up steps. (21) Sandboxes hidden from community search. (22) Members see only their own custom fields marked for members. (23) Stricter 2FA re-check for staff with an authenticator at JSH. (24) Pledge history import: opening balance as one historical line; written-off pledges imported closed and unpaid. New concepts: a **deceased flag** on a person; **pledge write-off synced to QuickBooks**. | Owner, 2026-09-25 |
| Money rules of the 2026-09-25 batch, as built (e-money) | #5 `center_payment_processors.donor_covers_fee_allowed` is always false (check constraint; `set_payment_processor` refuses true). #6 a refund reported by the Stripe/PayPal webhook that Community Connect did not record becomes ONE flagged `payment_refunds` row per provider reference; it changes nothing until a person with giving.manage approves first and a DIFFERENT person with giving.approve approves second (reason + fresh 2FA each); the second approval records it like any refund (refunded_cents/status; allocations untouched, as for every refund). #7 email-only PayPal: after the existing request → second approver, the treasurer records the PayPal refund (amount, date, PayPal transaction id, reason; fresh 2FA). #11 a QuickBooks CreditMemo/RefundReceipt of an approved donor match reduces the one matching historical payment of that customer (its own link, else the latest same-amount payment dated on or before it, else the only payment with enough left); never posted back; the two-person trigger lets exactly this through (historical payment, background service, flag set by the bring-in). #24 opening balances: one historical `is_opening_balance` payment per pledge for what the file says was paid beyond the imported payment history (run after the payments import); written-off pledges import written off, closed, with `written_off_by_name` and `write_off_reason`; an import never writes off a pledge that exists open. Write-off → QuickBooks: completing a two-person write-off queues one `pledge_writeoff` posting: CreditMemo applied to the source QuickBooks invoice, or (accrual) a JournalEntry Pledge write-offs → Pledges receivable, else `skipped` with the reason; new mapping purpose `pledge_writeoffs`. #10 the live test post is explained before and after (app.qbo_test_post_explained). #12 (delete used OAuth codes) NOT built — not authorized. | `app.payment_refunds`, `worker_flag_provider_refund`, `approve_flagged_refund`, `record_manual_paypal_refund`, `qbo_bring_in_refund`, `enqueue_pledge_writeoff_posting`, `import_pledge_opening_balances` (0410–0414; owner, 2026-09-25) |

## Decisions made by JSH (design-doc decision log)

| Area | Decision |
|---|---|
| CRM | Platform replaces Neon with its own CRM; migration tooling must handle any prior system and many years of history |
| Accounting | Cash basis; QuickBooks is the accounting record; platform posts everything |
| Pay-now gifts | Create a pledge, record the donation against it, close the pledge |
| Receipts | Tax, pledge and donation receipts in a standard format with light per-center personalization |
| Payment methods | Card, ACH, Apple Pay, Google Pay, check, stock, offline cash and check (Zelle via bank reconciliation) |
| Processing fees | Donor may choose to cover fees; each center decides whether to ask |
| Sales tax | Follows the law of the center's state |
| Pledge visibility | All adult household members |
| Donor recognition | Anonymous recognition allowed |
| Bolis | First recorded wins ties; every pledge entry kept |
| Entitlements | Granular entitlements in every domain, with default roles out of the box |
| Membership rules | Prior-membership and reference-count rules configurable per center |
| Child login age | Configurable per center and at platform level (JSH: 13) |
| Households | Adult children can stay in the parents' household and also be primary of their own |
| Lunch slots | A family with a child under 12 or a senior eats together at lunch start |
| Events | Waitlists can be enabled; eligibility controls (e.g. life members only, Pathshala families) |
| Privacy defaults | Directory, photo and physical-mail preferences asked as opt-in or opt-out during onboarding |
| Deletion | App data deleted; financial records kept 7 years then anonymized; household stays; audit log kept |
| Store | Admin backend includes full inventory management |
| Launch target | Within 2 months, using all available compute and AI agents |
| Shared contact with a child | If a login email or phone is shared with a child, every financial transaction needs a 2FA one-time code |
| In-person bolis | Admins add results one by one or bulk-upload them |
| Volunteer legal sign-off | Any volunteer signs the center's uploaded legal form in the member app before serving |
| Payment allocation | Earliest open pledge first unless for a specific invoice; overpayment to the next earliest; partial keeps the pledge open |
| DAF and matching gifts | Matched manually by the treasury team to a household account |
| Balances | Shown at household level |
| Identity across centers | Deferred |
| Allocation transparency | Payment screen shows which pledges a payment will close, with "choose instead"; receipts list the allocation; recurring gifts never auto-close pledges unless linked |
| Receipt name | Payer's name by default, option for a joint receipt |
| In-person payments | Tap-to-pay in the ops app; cash/checks in numbered envelopes counted and signed off by two volunteers |
| Bhandar | Counting sessions with ≥2 counters from different households, totals by denomination, sealed numbered bags; posted as anonymous general donations; valuables register with photos and custody log |
| Pathshala | Term calendar and registration windows (membership required); fees per child billed as pledges; placement by level; teacher assignments; class waitlists; QR attendance; term progress reports; Gyan Path sign-offs feed levels; parent communication only via class announcements and parent inbox |
| Child and organization safety | Versioned waivers re-signed yearly; background checks with expiry block assignment; no one-to-one adult-to-minor messaging; photos follow onboarding opt-in with moderation |
| SMS and WhatsApp | Start 10DLC and WhatsApp Business registration; store opt-in with time and source; honor STOP; WhatsApp for community messages, SMS only for codes and time-critical reminders |
| Event-day resilience | Load test 2,000 check-ins in 30 minutes; ops app fully offline; on-call engineer for major events; printed QR list fallback; no releases 48 hours before a major event |
| Sign-in without email | Mobile-only sign-in allowed; family member can manage a senior's profile; staff can issue a one-time printed sign-in code; recovery via a second verified contact or in person |

## Open questions

| Question | Owner | Status |
|---|---|---|
| Money approval thresholds (refunds, write-offs, month close) | Treasurer | Parked |
| Platform ownership entity (likely a new nonprofit) | EC | Parked |
| Soft close for digital bolis, and extension length (schema supports `soft_close_minutes`; JSH = 0 until decided) | Religious coordinator | Open |
| Membership history on account deletion | Membership coordinator | Open |
| Member uploads and messages on deletion | Privacy officer | Open |
| Membership and maintenance fee billing cycle, auto-renew, grace period | Treasurer | Open |
| Pledge due dates, reminders, installments, write-off timing | Treasurer | Open |
| Restricted funds list for QuickBooks classes (seeded: construction, jeevdaya, sadharmik) | Treasurer | Open |
| Receipt wording for gifts with benefits and religious honors | Treasurer + accountant | Open |
| Neon cutover: history depth, parallel run, cutover date | Technology officer | Open |
| Paid events, guest vs member pricing, cancellations; default lunch slot length and seats | Event leads | Open |
| WhatsApp Business number, email sending domain | Communications officer | Open |
| Store: kitchen capacity per slot; delivery | Store lead | Open |
| Who can take card payments at events | Treasurer | Open |
| Bhandar counting frequency and who can be a counter | Treasurer | Open |
| Pathshala fee per child or per family; sibling discounts (schema supports both) | Pathshala principal | Open |
| Who pays for background checks; which roles require them | EC | Open |
| Weekend and festival-day on-call staffing | Technology officer | Open |
| Neon account vs contact ids in use; QuickBooks customer naming; JSH household ID format (digits?) | Treasurer + membership coordinator | Open — needed before the Neon/QuickBooks import |
| Yearly membership fee amount (seeded as 0, `[sample]`) | Treasurer | Open |
| Organization onboarding: sandbox model, what promotion copies, sandbox limits, non-profit proof, 2FA methods, providers, email editor plugin, custom fields, history depth, portal addresses, Niva, offline-only launch, billing, go-live approvers (O1–O15 in [ONBOARDING_PLAN.md](ONBOARDING_PLAN.md#10-decisions-needed)) | Owner | Open |
| The three apps: connect-crm is the admin portal for everything an organization manages; connect-mobile is the app for all members; connect-admin is only the event-day app and grows only after the first two mature | Owner | Decided 2026-09-24 |
