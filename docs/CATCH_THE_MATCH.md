# CatchTheMatch: employer and grant matching (plan)

Status: plan, 2026-10-13, nothing built. Replaces B63 ("MatchMyGenerosity", the community-driven employer matching
flow) as backlog **B103**. A Marketplace product for every organization Weaver onboards; behaviour comes from data,
never from code written for one community. Related: [`WECARE.md`](WECARE.md) (a WeCare playbook step can prompt a
donor whose gift may be matched), [`MARKETPLACE_PLAN.md`](MARKETPLACE_PLAN.md), [`ZELLE_REPORTS.md`](ZELLE_REPORTS.md)
and the Bank tab (where a match payment is reconciled).

## 1. In short

- **The problem.** Many employers match their employees' gifts (and pay grants for volunteer hours), but most
  eligible matches are never claimed: the donor does not know, forgets the deadline, or the organization never
  verifies the gift in the employer's portal.
- **The product.** CatchTheMatch finds gifts that may be matched, asks the donor to request the match with
  everything pre-filled, and **Weaver's team manages the filing**: registering the organization in the matching
  portals, verifying gifts there, chasing status and deadlines. When the match arrives, it is reconciled, the donor
  is thanked and gets soft credit.
- **Paid only on success.** Weaver earns a percentage of each match the organization actually receives, never more
  than a fixed cap per match.

## 2. Owner decisions (2026-10-13)

| # | Decision |
|---|---|
| C1 | Product name **CatchTheMatch** (employer and grant matching for donations the organization receives); replaces "MatchMyGenerosity" (B63). |
| C2 | A **subscription product in the Marketplace** an organization chooses to take. |
| C3 | **Weaver manages the filing** for the matching funds. |
| C4 | **Weaver is paid only if the match is received**: a percentage of the match, **never more than a cap per match**. |
| C5 | **Fee: 10% of each match received, capped at $500 per match** (`rate_bp = 1000`, `cap_cents = 50000`, US dollars). **Success fee only**: no base subscription fee. |
| C6 | Only claims opened in CatchTheMatch before the employer paid count; a match with no claim behind it is free. |
| C7 | v1 covers employer matching gifts and employer volunteer grants; a foundation's challenge grant comes later, as a Giving campaign with a match target. |
| C8 | The organization grants a **Weaver filing** role: CatchTheMatch data only, audited (section 6). |
| C9 | **A lawyer's view before any fee is live** (section 5); slices 1 to 4 are built meanwhile. |

## 3. How matching really works (and what "we file" can mean)

| Step | Who does it in practice | What CatchTheMatch does |
|---|---|---|
| The organization is registered in each matching portal (Benevity, YourCause, CyberGrants, Bright Funds, an employer's own form) | The organization | Weaver's team registers it and keeps the profile current. The organization adds Weaver's team as users in each portal; Weaver never stores the organization's portal passwords. |
| The match is requested | **Usually the employee**, in the employer's portal (the employer requires it) | Finds the eligible gift, sends the donor a pre-filled request (link, gift date, amount, the organization's registered name and tax ID), reminds before the deadline. Where an employer's program or a database partner accepts submissions from a third party, Weaver submits for the donor. |
| The gift is verified | The organization, in the portal | Weaver's team verifies it against Weaver's own payment record. |
| The employer pays | The portal or employer, directly to the organization (ACH or check, often batched, often quarterly) | Matches the payment to its claims in the Bank tab; records it as method `matching_gift`. |
| Thanks and credit | The organization | Thanks the donor (and the employer where suitable); soft credit to the donor; never a tax receipt to the donor for the employer's money. |

**Honest limit:** for most employers the employee's own request is a required step that Weaver cannot take for them.
"We manage the filing" therefore means: we do everything except the one step the employer requires of its
employee, and we make that step a single tap.

## 4. The fee (a money rule; values set by the owner 2026-10-13, C5)

| Rule | Proposal |
|---|---|
| When a fee is owed | A match payment is **received and reconciled** to a claim that was **opened in CatchTheMatch** before the employer paid. A match that arrives with no claim behind it is free. |
| How much | `fee_cents = min(floor(match_cents * rate_bp / 10000), cap_cents)`: integer cents, the rate in basis points, rounding down (in the organization's favour). With C5 (`rate_bp = 1000`, `cap_cents = 50000`): a $25.05 match costs $2.50; a $1,000 match costs $100; a $5,000 match costs $500; a $12,000 match costs $500 (the cap). |
| Per match | One claim (one donor gift and one employer program) is one match. When an employer pays a batch, each claim's share is its own match, so the cap applies per claim. |
| Never taken from the gift | The match reaches the organization in full. Weaver invoices its fee separately, monthly, with every claim listed. Many matching programs require the funds go to the charity in full, and it keeps receipts, statements and the books clean. |
| On which amount | What the organization actually received (after any portal fee), not the amount the employer announced. |
| Reversal | A match the employer reverses becomes a credit on the next invoice. |
| Terms are locked | The rate and cap in force when a claim is opened apply to that claim; a later price change never reaches back. |
| Shown before taking it | The rate, the cap, a worked example and what counts as "received", on the Marketplace card and the agreement. |
| Stored as data | Rate and cap on the product's price row (Marketplace phase 2 `product_prices`, plus `fee_rate_bp` and `fee_cap_cents`), with an optional per-organization override for a negotiated deal. |

## 5. Before any fee is charged (honest risks)

1. **Percentage fees on contributions are frowned upon in fundraising.** The AFP Code of Ethics bars its members from
   pay based on a percentage of contributions, and some boards will ask about it. The cap, the success-only rule,
   the separate invoice and full disclosure answer most of it; expect the question.
2. **State charitable solicitation laws.** In many US states a company paid to seek contributions for a charity must
   register (as a professional fundraiser, solicitor or fundraising counsel), file contracts and sometimes post a
   bond. Asking employers for matching funds for a percentage may fall in. **A lawyer's view is needed before the
   fee goes live**, and the agreement may need per-state terms.
3. **Matching program terms.** Some programs restrict third parties acting for the charity or fees taken from
   matched funds. The separate invoice reduces the risk; each major portal's terms need a read before Weaver's team
   acts in it.

Slices 1 to 4 can be built and used while this is settled; the fee ledger (slice 5) waits for it.

## 6. Data, privacy and who can see

- **Employer on file only with the person's consent** (a new People field and a consent kind), adults only, editable
  and removable by the person in the member app.
- **Organization's data.** Claims, employers on file and match history are the organization's own data, seen only by
  roles it gives `matching.view` or `matching.manage` (the same own-access-check approach as WeCare W2: no
  `is_platform_admin()` branch).
- **Weaver's filing team** needs access to do the work (C3). When an organization takes the product it grants a
  **Weaver filing** role: CatchTheMatch data only (claims, the gift, the donor's name and employer), never WeCare,
  notes or other giving; time-limited to the subscription; every read and action audited and shown to the
  organization.
- **The employer-program directory is shared** across organizations: public facts only (company, ratio, minimum and
  maximum, portal, deadlines, volunteer-grant rules), never who works there or who gave.

**Built (2026-10-13, migrations 0757 to 0759, test 163):** `app.matching_can`; `matching.view` and `matching.manage` and the
role `matching_lead`; the Weaver filing grant (`app.matching_filing_grants`, `app.grant_weaver_filing` /
`app.end_weaver_filing`: the owner or a `matching.manage` holder gives a named Weaver team member CatchTheMatch view and
filing for at most 366 days, the owner is emailed, it ends when Weaver turns CatchTheMatch off, every read is logged with
`app.log_private_read`); the employer for gift matching (`app.person_match_employers`, consent kind `employer_matching`,
adults only, set and removed by the person, or recorded from a signed paper form by `matching.manage`; `people.employer`
is untouched and only prefills it) with a Gift matching section in the person slide-over. The filing queue is slice 3.

## 7. Where the employer-program facts come from

1. Weaver's team seeds and maintains the shared directory.
2. Members submit what they know (B63 steps 1 and 2: a member submits, the treasurer or Weaver's team verifies).
3. Licensing a matching-gift database (for example Double the Donation) is a later choice, worth it only if claim
   volume pays for it.

## 8. Claim states

eligible → donor asked → requested (the donor submitted) → verified (in the portal) → approved by the employer →
paid → **received** (reconciled in the Bank tab) → thanked. Or: declined, expired (deadline passed) or withdrawn,
each with a reason. Deadlines (often the calendar year of the gift, or a date early the next year) drive reminders.

## 9. Build order

Each slice ships on its own; migration and test numbers are reserved when a slice is approved. Rollout: a sandbox
community first, then any community that takes CatchTheMatch.

| Slice | What | Size | Owner OK |
|---|---|---|---|
| 1 | Module `matching` (a neutral key; the label is CatchTheMatch, [`MARKETPLACE_PACKS.md`](MARKETPLACE_PACKS.md) P6) (default off, grant-only, Marketplace "Request" card), `matching.view` and `matching.manage`, the Weaver filing role, the employer field and consent in People | M | **Yes: permissions/RLS, personal data** |
| 2 | Shared employer-program directory, member submissions, verification | M | No |
| 3 | Claims: the eligible-gift finder, the pre-filled donor request (message and member-app card), states and deadlines, the Weaver filing queue | L | **Yes: messaging** |
| 4 | Received: match payment against the claim in the Bank tab, soft credit, the donor's thank-you (a WeCare touch when WeCare is on), statements show the match as the employer's gift | M | **Yes: money (allocation, statements)** |
| 5 | Fee ledger: fee per claim at receipt, monthly invoice to the organization, credits on reversal | M | **Yes: money and pricing; lawyer first; charging needs Marketplace phase 3** |
| 6 | Member app: "Does your employer match?", add an employer with consent, see one's own match status; mobile release + OTA | S | No |
| 7 | Portal integrations where a portal offers an interface for charities | M to L | Per portal |

## 10. How we will know it works

Per organization: matched money received against eligible money (the capture rate), days from gift to match
received, claims lost to deadlines. For Weaver: fee revenue per organization against the cost of the filing team.

## 11. Owner answers (2026-10-13: every recommendation approved, recorded as C5 to C9)

1. **Rate and cap:** **10%, capped at $500 per match**, US dollars first (C5).
2. **Success fee only, or also a base subscription?** **Approved:** success fee only (C5).
3. **What counts as ours:** only claims opened in CatchTheMatch before the employer paid. **Approved** (C6); matches
   with no claim are free.
4. **"Grant matching" in v1.** **Approved** (C7): employer matching gifts and employer volunteer grants (same portals,
   same flow) first; a foundation's challenge grant (a match on what the organization raises) later, as a Giving
   campaign with a match target.
5. **The Weaver filing role** (section 6): the organization grants Weaver's team access to CatchTheMatch data only.
   **Approved** (C8); the filing in C3 cannot happen without it.
6. **Legal review before any fee is live** (section 5). **Approved** (C9), building slices 1 to 4 meanwhile.
