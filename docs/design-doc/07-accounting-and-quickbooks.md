> Exported from the JSH Platform · Recommendations and Roadmap doc (claude.ai artifact 338356dc…) on 2026-09-23. Source of truth for decisions made before the build; later decisions live in ../DECISIONS.md.

# Accounting and QuickBooks

QuickBooks Online is the book of record for money at every center; the platform posts every financial event from the app to QuickBooks automatically, once, and proves it through reconciliation.

## Principles

- **QuickBooks is the accounting record; the CRM is the donor record.** Donors, pledges and receipts live in the CRM; ledgers, bank and tax live in QuickBooks.
- **One poster per transaction type.** Each kind of money event is posted to QuickBooks by exactly one system, so nothing is ever posted twice.
- **Every center connects its own QuickBooks company.** Posting follows that center's chart of accounts through a mapping, never hard-coded accounts.
- **Post what the bank will see.** Payment-provider payouts, net of fees, must match bank deposits line for line.
- **Nothing silent.** Every post is logged with the QuickBooks reference; failures land in an exception queue for the treasurer.
- **Closed months stay closed.** Changes after close post as adjustments in the current period.

## Who posts what

JSH's Neon already syncs to QuickBooks today, so the biggest risk is double posting. Recommended split: the platform posts everything that originates in the app; the CRM's own QuickBooks sync is limited to gifts entered directly in the CRM.

| Transaction | Originates in | Posted to QuickBooks by |
| --- | --- | --- |
| App donations and pledge payments (card, Apple or Google Pay) | Platform | Platform |
| Recurring gifts charged by the platform's payment provider | Platform | Platform |
| Bolis, sponsorships, pujans, labh paid in the app | Platform | Platform |
| Satvik Store sales, gift packing, sales tax | Platform | Platform |
| Refunds and chargebacks of any of the above | Platform | Platform |
| Payment-provider fees and payouts | Platform | Platform |
| Checks, cash, ACH and stock recorded in the app by finance volunteers | Platform | Platform |
| Gifts and fees entered directly in the CRM (not through the app) | CRM | CRM's QuickBooks sync, filtered to these only |
| Membership fees paid through the CRM portal (during transition) | CRM | CRM's QuickBooks sync |

At a center with no CRM, the platform posts everything.

## Transaction mapping

Each money event maps to a QuickBooks entity and to accounts chosen in the center's mapping; fund restrictions (e.g. temple construction) travel as a Class so restricted money stays separate.

| Money event | QuickBooks entity | Debit | Credit | Class or tag |
| --- | --- | --- | --- | --- |
| Pledge made (only if the center uses accrual) | Journal entry | Pledges receivable | Contribution income by campaign | Fund (restricted or unrestricted) |
| Donation or pledge paid by card | Sales receipt (donor as customer) | Payment clearing | Contribution income, or pledges receivable if accrual | Fund, event |
| Recurring gift charge | Sales receipt | Payment clearing | Contribution income | Fund |
| Boli, sponsorship, pujan, labh paid | Sales receipt | Payment clearing | Boli or sponsorship income by type | Fund, event |
| Store order | Sales receipt with items | Payment clearing | Store sales by item; gift-packing income; sales tax payable | Store |
| Refund or chargeback | Refund receipt | Income or sales accounts reversed | Payment clearing | Same as original |
| Processor fee | Expense on the deposit | Merchant fees expense | Payment clearing | Unrestricted |
| Payout to bank | Bank deposit grouping the day's receipts | Bank account | Payment clearing (net of fees) | — |
| Check, cash, ACH recorded by finance | Sales receipt, then deposit | Undeposited funds, then bank | Contribution income | Fund |
| Stock gift | Journal entry | Investment or stock clearing (value on date received) | Contribution income | Fund |

Donors post as customers with the CRM ID, but only a donor number and name, never personal details beyond what accounting needs.

## Per-center setup

A wizard in the admin portal gets a center posting in an afternoon; the treasurer approves the mapping before anything is sent.

1. **Connect:** the treasurer signs in to QuickBooks Online and authorizes the platform for that company only; the connection is renewed automatically and alerts before it expires.
2. **Choose the basis:** cash (post at payment) or accrual (also post pledges as receivables).
3. **Map accounts:** income account per campaign type (general, boli, sponsorship, construction, Pathshala, jeevdaya), store sales and gift packing, sales tax payable, merchant fees, payment clearing, bank, pledges receivable.
4. **Map funds:** QuickBooks Classes (or Locations) for restricted funds, events and store.
5. **Posting detail:** per transaction (full donor detail) or a daily summary per account and class (lighter QuickBooks file).
6. **Test post:** one sample of each type into a sandbox or a test period; the treasurer checks and approves.
7. **Go live date:** only transactions from this date post; earlier history stays where it is.

## Sync, reconciliation and month-end close

Posting is automatic and near real time; reconciliation is daily; close is a monthly checklist in the admin portal.

- **Posting:** each money event is queued and posted within minutes; each post carries a unique key so a retry can never create a duplicate.
- **Failures:** rejected posts (closed period, missing account, expired connection) go to an exception queue with the reason and a one-click retry after the fix; the treasurer gets a daily digest.
- **Daily payout match:** each bank deposit from the payment provider is matched to its receipts and fees; any difference is flagged the same day.
- **Three-way check:** platform totals, CRM totals and QuickBooks totals by campaign must agree; the giving dashboard shows mismatches.
- **Month-end close:** checklist of exceptions cleared, payouts matched, refunds reviewed and statements generated; the treasurer locks the month, and later changes post as current-period adjustments.
- **Audit:** every post keeps the platform record, the QuickBooks reference, who triggered it and when.

## Decisions for the treasurer and accountant

- [ ] Cash or accrual basis for pledges
- [ ] Turn off Neon's QuickBooks sync for app-originated gifts, or retire it, from the platform go-live date
- [ ] Chart of accounts: income accounts per campaign type, and whether bolis and sponsorships are contributions or separate income
- [ ] Restricted funds as Classes or Locations, and the list of restricted funds
- [ ] Per-transaction or daily summary posting
- [ ] Sales tax treatment for Satvik Store items
- [ ] Stock gift valuation and clearing account
- [ ] Who approves refunds and write-offs, and who can close a month
