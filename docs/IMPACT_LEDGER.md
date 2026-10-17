# Weaver impact ledger: showing what Weaver does for an organization's revenue (plan)

Status: **proposal, 2026-10-17. Nothing is built, nothing is approved.** Asked by the owner on 2026-10-17: "how would we track Weaver's impact on an org's ability to
generate additional revenue? How do we make it transparent?" Backlog **B118**. For every organization Weaver onboards; no rule here is written for one community.

## 1. In short

- **The problem.** An organization (and its board) cannot tell what the software did for its giving. Claims such as "we raised your retention" are easy to make and
  hard to check, and a fee tied to impact (CatchTheMatch today) needs a record both sides can read.
- **The proposal.** One **impact ledger per organization**: a dated list of the money and the work Weaver can show, each line with its source records and a plain-words
  reason. Three tiers, so a trend is never sold as a proof. The organization sees everything Weaver sees, and more.
- **Rule of honesty.** Only a traceable record link is "proven". An action followed by money is labelled "followed by", never "caused". A trend against the
  organization's own past is "context". No tier is allowed to read as more than it is.

## 2. The three tiers

| Tier | Meaning | Examples (all from records Weaver already keeps) | May it touch an invoice? |
|---|---|---|---|
| **Proven** | A record links Weaver's work to the money. | A match received on a CatchTheMatch claim opened before the employer paid ([`CATCH_THE_MATCH.md`](CATCH_THE_MATCH.md) C6); a pledge instalment paid through a payment link Weaver sent, shown by the link's own record. | Only Proven lines, and today only CatchTheMatch has a fee (10%, capped at $500 per match). Any other fee is a later owner decision. |
| **Followed by** | Weaver did something, then money arrived inside a stated window, same household. | A reminder or a thank-you call, then a gift within 30 or 90 days; a household shown At risk or Lapsed ([`DONORDELIGHT.md`](DONORDELIGHT.md) section 6) that gave again within 90 days of a logged touch. | Never. Informational. |
| **Context** | The organization's own numbers now, against its own prior 12 months. | Retention, first-year retention, last year but not this year, thank-you speed, share of gifts thanked in the window, collection rate on pledges. | Never. |

Kept apart, and never added to impact: **volume through Weaver** (gifts that arrived by Weaver checkout, Chip In or a recurring plan). A gift on a Weaver form is not
necessarily a gift that would not otherwise have been made, so it is shown as a count and an amount of money handled, not as "additional".

## 3. What the organization sees

- **A page, Giving > Weaver impact**, for roles that see giving (amounts follow `giving.view`; without it the lines show counts and dates only, as DonorDelight does).
- Every line: the date, the tier, the sentence ("A match of 3 gifts from one employer was received on 4 claims"), and a link to the underlying records the person may see.
- **A method page**, written in plain words, with the windows (30 and 90 days) and the baseline rule (the 12 months before the organization's first full month on Weaver).
- **Export** to CSV for the board, by year; and **the same list is attached to any invoice**, so a fee and its evidence are one document.
- **Dispute a line.** The organization marks a line "not ours" with a reason; the dispute is kept, shown to both sides, and a disputed Proven line is not invoiced until settled.
- **Not enough history yet.** A comparison that needs two years of records says so (as the DonorDelight dashboard does) instead of showing a number that misleads.

## 4. What Weaver sees (W2 holds)

Weaver's team sees **counts and totals per organization**, never a household, a name, a note or a touch. The ledger is computed inside the organization's own scope with
the organization's own access check (no platform-admin branch, as in `app.care_can`), and the platform summary carries only the headline figures. Weaver cannot read the
DonorDelight records that produce the "followed by" lines.

## 5. Baseline and an optional measure of real lift

- **Baseline.** The organization's own 12 months before it started on Weaver, from records it already holds (imported history counts, with the "not enough history" rule).
- **Optional holdout (needs the owner's OK and the organization's tick).** For reminders only, hold back a small random share of households for a season and compare. This
  is the only way to separate lift from coincidence. It is **never** used for thank-yous or any care action: withholding those would harm the relationship.

## 6. Build order (each slice ships alone; numbers reserved when approved)

| Slice | What | Size | Owner OK |
|---|---|---|---|
| 1 | Ledger tables and the Proven tier for CatchTheMatch matches (needs CatchTheMatch slices 3 and 4) | M | **Yes: money, permissions/RLS** |
| 2 | Context tier from DonorDelight's dashboard figures; the Weaver impact page and method page | M | No new rule |
| 3 | Followed-by lines (reminders, touches); disputes | M | **Yes: attribution wording** |
| 4 | Invoice attachment and CSV export | S | **Yes: money** |
| 5 | Optional holdout for reminders | S to M | **Yes** |

## 7. Questions for the owner

1. **What may count as Proven** beyond CatchTheMatch matches (for example pledge instalments paid through a link Weaver sent)?
2. **Does anything other than CatchTheMatch ever carry a fee tied to impact?** The pricing draft ([`PRICING_DRAFT.md`](PRICING_DRAFT.md)) commits to nothing of the kind.
3. **Windows** for "followed by": 30 and 90 days proposed.
4. **Show "volume through Weaver"** at all, or leave it out so it cannot be mistaken for impact?
5. **Holdout** for reminders: yes, no, or only when an organization asks.
