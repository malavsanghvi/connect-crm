# Pricing: DRAFT, not adopted

**Status: draft (owner, 2026-10-16: "dont change, keep in draft").** Nothing on the public site, in the Chip In wording or in the product
follows this yet. The pricing page (`src/app/site/pricing/page.tsx`) still says "Totally free. Forever." and must not be edited until the
owner adopts this. Nothing in it is promised to any organization (see DECISIONS.md, "Public website, pricing and brands").

## What the owner has decided

| | |
|---|---|
| **Under $25K a year** | Totally free. No fees charged. |
| **$25K to under $100K** | $49 a month |
| **$100K to under $500K** | $99 a month |
| **$500K to $2M** | $199 a month |
| **Above $2M** | Enterprise edition. Contact us. |
| **What decides the band** | The organization's yearly contributions, as recorded in Weaver. |
| **Chip In** | Members' Chip In supports the platform. The organization's fees are given back to it by Weaver, in whole, **at the calendar-year close**, up to the Chip Ins its members gave. |
| **Everything else** | Any excess (Chip Ins above the fees) goes to Weaver. Any other revenue stream, for example the CatchTheMatch success fee, goes to Weaver. |

The band edges ($100K, $500K) are the owner's earlier figures with the new $25K band added above the free one; whether each edge is
"up to" or "from" is open (below).

## How the money works

Per calendar year, for one organization: `fees = monthly fee × months in the band`, `chip_ins = what its members gave`.

* Weaver gives back `min(fees, chip_ins)` at the year close. The organization pays `fees − min(fees, chip_ins)` in the end.
* Weaver keeps the rest: `chip_ins − min(fees, chip_ins)`, plus the fees it was not asked to give back.
* So Weaver receives the greater of the fees and the Chip Ins. The fee is a floor; generous communities give more.

| Example | Fees for the year | Chip Ins | Given back | The organization pays | Weaver keeps |
|---|---|---|---|---|---|
| $60K a year, quiet community | $49 × 12 = $588 | $400 | $400 | $188 | $588 |
| $60K a year, generous community | $588 | $900 | $588 | $0 | $900 |
| $300K a year | $99 × 12 = $1,188 | $1,500 | $1,188 | $0 | $1,500 |
| $1M a year | $199 × 12 = $2,388 | $1,000 | $1,000 | $1,388 | $2,388 |
| Under $25K a year | $0 | $200 | nothing to give back | $0 | $200 |

## Open, to settle with the owner before anything is built or said in public

1. **Band edges.** Are $25K, $100K, $500K and $2M "from" (inclusive) and the band above them "up to" (exclusive)? What is on the edge itself?
2. **What counts as "yearly contributions".** Giving payments only (donations, pledge payments, dues), or also event tickets and the store? Refunds taken off? Money the organization recorded by hand and money that came through Stripe both count?
3. **Which year decides the band.** The last full calendar year, or the year so far (and then a band can change mid-year)? A new organization: an estimate, or the history it imports?
4. **Billing in the year.** Monthly invoice or card charge, and when. A mid-year start (pro-rated) and a mid-year change of band. What happens when a fee is not paid: the organization's members and their data stay available.
5. **The settlement.** The date of the calendar-year close; a credit on the next invoice or money back; a statement the organization receives showing fees, Chip Ins and what was given back; what happens to an organization that leaves during the year.
6. **Tax and wording.** A Chip In is a tip to Weaver, not a donation to the organization, and the give-back is a fee rebate. Both need to be said plainly to members and to organizations, and checked with an accountant.
7. **Enterprise.** What is included above $2M, and whether the Chip In arrangement applies.
8. **Chip In rules that already exist.** There is no fixed dollar cap; the yearly limit per member is a per-organization setting (owner decision 2026-10-15). Whether the limit stays as it is under this plan.

## What must be true before the public page changes

* "Free" is only true under $25K, and "$0" above that only when members chip in enough. The page must say so. A $49 invoice after "Totally free.
  Forever." would be a broken promise.
* Billing and the year-close settlement do not exist yet (no subscription, invoice or ledger code). A first version can be manual: a Platform
  admin screen per organization (band, fees, Chip Ins, settlement) and invoices sent by hand, with automation once about ten organizations
  are live.
* The site only claims what is built (owner rule, 2026-10-13).
