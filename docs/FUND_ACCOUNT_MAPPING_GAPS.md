# Funds to QuickBooks accounts: gaps and how they are closed

Owner priority 3a (2026-10-08): "Mapping of funds to accounts, with treasurer approval and 2FA: what are the gaps? Close them."
Rebuilt on current `main` on 2026-10-13 (the parked crm #109 / #110 of 2026-10-08 are superseded). Owner rule of
2026-10-13: 2FA is asked at sign-in and for admin-level actions only, so asking for and confirming a mapping change need
**no fresh 2FA code**; the **two-person rule** (one asks, a different person confirms, both give a reason) stays.

**What "the mapping" is.** It decides which QuickBooks account each kind of money posts to. It is three things:

| Part | Where it lives | What it decides |
|---|---|---|
| Account roles ("purposes") | `app.qbo_account_mappings` (one row per organization and role), catalog `app.account_roles` | The income account of each **fund** (general donations, sponsorships, construction, events, membership dues, other, and the funds of a module the organization has: its pledge auctions, its school, its store) and the other accounts: payment clearing, merchant fees, bank, undeposited funds, store sales, gift packing, sales tax, pledges receivable, stock clearing, pledge write-offs, refunds, store cost of goods |
| A giving fund's class | `app.funds.qbo_class_id` | The QuickBooks class that keeps a restricted fund's money apart |
| A bank account's QuickBooks account | `app.bank_accounts.qbo_account_id` | Which QuickBooks bank register a deposit or a Zelle/ACH line lands in |

"Fund" here means the stream of money. Which fund a payment belongs to is the kind of its campaign; a pledge with no
campaign is placed by its source (a membership fee is dues, a school fee is the school's fund, an event commitment is
events). Fund names on the screens come from the organization's own data (`app.funds`) and its kind's words (a module's
role is named with the module's name in that kind, `app._module_label`); a role of a module the organization does not
have is not listed, so a community without a tradition never sees a tradition's words.

**What is built and what was never proven.** Connecting, pulling the chart of accounts, the mapping and its approval, the
test post and cash-basis posting are built, but the QuickBooks integration has only ever run against local mock
services. Nothing below has been proven against a real Intuit sandbox company (that needs the owner's Intuit app and
keys, backlog B59).

## The gaps and how each is closed

Migration `0779_fund_account_mapping.sql`, database test 179. Portal: Giving › Books › **Account mapping** in the New look
(Accounting › Account mapping in the classic look), QuickBooks setup step 5, and the second person's task on Home and
Giving › Today.

| # | Gap | Why it matters | How it is closed |
|---|---|---|---|
| 1 | **Who can change a mapping:** anyone with `accounting.manage` (and a platform admin, who holds every permission), through `set_qbo_mapping` / `set_qbo_fund_class` or straight over the API; `funds.qbo_class_id` by `giving.manage`, `bank_accounts.qbo_account_id` by `accounting.manage`. | One person, or a support login, can redirect where an organization's money is booked. | Once the mapping has been approved once ("in use"), every change of an account, a fund's class or a bank account's QuickBooks account is a **request**. Guards on the three tables refuse every other signed-in route, a platform admin's included (0597's rule), and 0232's one-person `set_qbo_mapping` / `set_qbo_fund_class` are no longer callable by a signed-in person. The service role, the background service, migrations and a sandbox reset are not asked. |
| 2 | **Audit:** the reason stored is often not a reason, a direct API write carries none, and nothing records who asked versus who agreed. | An auditor cannot tell why the books changed or who agreed. | `app.account_mapping_changes` keeps every change: who asked, when, the old and the new account (ids **and** names), the company it was asked in, the reason, and the second person's decision and reason. The audit log keeps both reasons. |
| 3 | **No second approver.** | A single person can change where money posts. | A change takes effect only when a **different** person with `giving.approve` confirms it. The asker must still hold `accounting.manage` then. A request lapses after 14 days; a newer one replaces a waiting one; it can be withdrawn or turned down. |
| 4 | **2FA.** | — | **Owner decision 2026-10-13:** no fresh 2FA code for asking or confirming (2FA is for signing in and admin-level actions; 0778 removes it from approving the mapping, the test post and the basis too). The second person is the control. |
| 5 | **The requester can approve their own change.** | Two-person control does not exist. | Refused by the function and by a table constraint (`account_mapping_changes_two_people`). |
| 6 | **Entries already posted:** nothing records which accounts a posted entry used; anyone with `accounting.manage` can set a posted `ledger_postings` row back to queued (it would post twice) or rewrite its QuickBooks reference; a re-send after a lost answer is rebuilt from the current mapping. | Money posted twice, or the record of what was posted lost. | **A change affects only postings sent after it; entries already posted keep their accounts and are never re-posted.** Each posting keeps the document it was sent with (`qbo_doc`, `qbo_realm`); a re-send sends exactly that document. Over the API a signed-in person can only put a **failed** posting back in the queue (Retry). Entries still waiting in the queue that were never sent post with the new account (the confirmation records how many were waiting); an entry already sent whose answer was lost, or that QuickBooks asked to retry, is re-sent with the document it was first sent with, so it keeps the **old** account (a daily summary goes again with the same receipts and request id, never with one that arrived since). |
| 7 | **Silent defaults.** A gift whose campaign kind has no account, and every pledge without a campaign (dues, school fees, event commitments), posted to General donations income; gift packing fell back to store sales; a deposit whose register was unusable fell back to the main bank account; a **pledge write-off** read the mapping and the fund's class directly (an inactive, retyped or other-company account was not caught). | Money lands in the wrong income account and nobody is told. | One place resolves accounts: `app.account_for_role`, `app.account_for_fund`, `app.account_for_bank_account`, `app.class_for_fund`. A missing or unusable one raises SQLSTATE `CCMAP` with a plain-English reason naming the fund. The posting waits in the exception queue (`needs_mapping` says for what) and **goes back in the queue by itself** when that mapping becomes usable: a second person confirms it, the whole mapping is approved, or a pull brings the account back (made active again in QuickBooks). Write-offs use the same resolvers. Money not tied to any pledge is a general donation by rule (the General fund's own account). With more than one bank account, each needs its own register. |
| 8 | **Validation:** no check that a QuickBooks item posts to an income account; a campaign's own income account (`campaigns.qbo_income_account_id`) was never validated or approved and **won over the approved mapping**; a bank account's register was not validated. | An account nobody approved can receive money. | Requests check the chart, the active flag, the type and, for funds and store sales, that an item posts to the account; the confirmation checks it again. The campaign override is **no longer used**. A register must be an active Bank account. |
| 9 | **A switched QuickBooks company:** the rows keep the old company's ids, and the old pulled lists stay "active". QuickBooks numbers accounts per company. | One company's books receive entries meant for another's accounts. | Every choice records its company (realm); at migration only approved choices are stamped with today's company (an unapproved one may be from an earlier company and is chosen again). A choice of another company counts as unmapped, and **approving the whole mapping never approves it**. When the company changes, its old lists are marked inactive until the new ones are pulled, and waiting requests are withdrawn. "In use" stays per organization: the new company's accounts are asked by one person and confirmed by a second. |
| 10 | **Tenant isolation.** | | The new tables follow the rules (RLS, restrictive Accounting switch, audited); the functions check the organization. Test 179: another organization can neither see nor decide; the resolvers are not callable over the API. |
| 11 | **No change history screen.** | "Who changed the dues account and when?" has no answer. | Books › Account mapping: what each fund and account posts to now, what waits for a second person (confirm, turn down, withdraw) and the full history. The second person's task shows on Home and on Giving › Today (Books). |
| 12 | **Sandbox versus real company.** | | No gap. Choices against a read-only real company belong to its realm, so after switching to an Intuit sandbox company they count as unmapped (gap 9). |
| 13 | **No roles for the next money streams** (payout clearing, refunds, store cost). | Each stream would invent its own mapping. | `app.account_roles`: one catalog with the account types each accepts and the aliases other streams use (`processor_clearing`, `processor_fees`, `store_sales_income`, `store_cost`, `refunds`). A later migration adds a role with one row. |
| 14 | A restricted fund with no class posts without a class. | Restricted money is not kept apart. | A **warning**, not a block (owner question 2). |
| 15 | A Zelle/ACH line recorded from the bank posted to the main bank role. | Reconciliation mismatch with several bank accounts. | A bank receipt posts to the register of its deposit line (`payments.deposit_bank_transaction_id`), else of the bank line matched to it; with no line and more than one bank account it waits with a plain reason (match it in Giving › Bank, then Retry) instead of using the main bank account. |
| 16 | **The QuickBooks connection row can be written over the API** by `integrations.manage` ("mapping approved", "test post approved", basis, go-live date, company id); a mapping row could change role, lose its approval, or have its stored name rewritten. | Approvals forged or withdrawn without the setup screen's checks; the second person shown a false name. | Signed-in API writes on QuickBooks connection rows are refused (the connect flow, the setup functions and the background service still write them). A role change counts as an account change; approvals change only through the functions; the name comes from the chart. |
| 17 | **One bad account stopped all posting** (review of 2026-10-08): any mapping problem was an error, and an error stops the poster; a bank register that went inactive stopped every posting of the organization. | One optional account blocks the whole organization's books. | Only a problem with a **required** account (general income, bank, undeposited funds, payment clearing, merchant fees, and the store's when it has one) stops all posting. A problem with any other account, a fund's class or a register is a warning: only the postings that need it wait, each with its reason, and the treasurer is still alerted after the pull. |
| 18 | **Tradition words in a shared catalog.** The purposes were a hard-coded list with one tradition's words. | A community of another kind (or none) sees words that are not its own. | Labels and hints carry no tradition word; a module's roles use the module's name in the kind and are listed only where the module is on; a role nothing posts to any more (`income.jeevdaya`) is listed only where an account was already chosen. Test 179 includes a non-faith community. |

## What is deliberately not changed

- **Setup is unchanged.** Before the mapping has ever been approved, the treasurer chooses accounts and classes alone and approves the whole mapping (`app.approve_qbo_mapping`, untouched). Those choices are recorded in the history too.
- Approving the whole mapping again (after a basis change or a company switch) is one person: it changes no account.
- A confirmed change keeps the go-live approvals (the mapping and the test post): posting goes on with the new account (owner question 1).
- Nothing already posted is re-posted or adjusted. No member-app function changes.

## Owner decisions (2026-10-13, all seven recommendations approved)

1. A confirmed change keeps the test post's approval: posting goes on with the new account.
2. A restricted fund without a QuickBooks class is a warning, not a block.
3. A giving fund or a campaign with its own income account, ahead of its campaign kind: backlog (B105).
4. The first approval of the whole mapping stays one person.
5. Connecting a different QuickBooks company stays one person (its accounts then need a second person each).
6. An organization with one holder of `giving.approve` cannot change its mapping once it is in use: it needs a second holder.
7. Only required accounts stop all posting; everything else holds only its own postings.

## Only provable against a real Intuit sandbox (needs the owner's Intuit app and keys)

- That QuickBooks accepts the documents built with the new resolution (an item per income account, classes, the register of a deposit).
- That a re-send under the same request id returns the first answer (Intuit's idempotency window).
- That account and class ids of two companies collide in practice (the guards assume they can).
