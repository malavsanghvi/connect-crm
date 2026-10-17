# CatchTheMatch: employer and grant matching (plan)

Status: plan, 2026-10-13; slice 1 built (0757 to 0759), slice 2 built (0765 to 0767, waiting for the owner's OK on its RLS). Replaces B63 ("MatchMyGenerosity", the community-driven employer matching
flow) as backlog **B103**. A Marketplace product for every organization Weaver onboards; behaviour comes from data,
never from code written for one community.

**Phase 1 built (owner direction 2026-10-17, section 12): guide the member first, Weaver files as the organization's agent later.** Nothing in Phase 1 needs the lawyer's view or Marketplace billing.

**Paused after slice 2 (owner, 2026-10-13).** Slice 2 (the shared employer-program directory) is built; slices 3 to 7 wait for (a) a lawyer's view on the fee (section 5), (b) a secular nonprofit willing to pilot it (many matching programs exclude religious organizations, and today's customers are mostly faith communities), and (c) Marketplace billing, since the fee cannot be charged without it. Weaver's filing is also an ongoing staffed service, not only software.

Related: [`DONORDELIGHT.md`](DONORDELIGHT.md) (a DonorDelight playbook step can prompt a
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
  roles it gives `matching.view` or `matching.manage` (the same own-access-check approach as DonorDelight W2: no
  `is_platform_admin()` branch).
- **Weaver's filing team** needs access to do the work (C3). When an organization takes the product it grants a
  **Weaver filing** role: CatchTheMatch data only (claims, the gift, the donor's name and employer), never DonorDelight,
  notes or other giving; time-limited to the subscription; every read and action audited and shown to the
  organization.
- **The employer-program directory is shared** across organizations: public facts only (company, ratio, minimum and
  maximum, portal, deadlines, volunteer-grant rules), never who works there or who gave.

**Built (2026-10-13, migrations 0757 to 0759, test 163):** `app.matching_can`; `matching.view` and `matching.manage` and the
role `matching_lead`; the Weaver filing grant (`app.matching_filing_grants`, `app.grant_weaver_filing` /
`app.end_weaver_filing`: the owner or a `matching.manage` holder gives a named Weaver team member CatchTheMatch view and
filing for at most 366 days, the owner is emailed, it ends when Weaver turns CatchTheMatch off, every read is logged with
`app.log_private_read`); the employer for gift matching (`app.person_match_employers`, with the consent kept in the record:
source, recorded_by, consented_at, withdrawn_at; adults only, also at read time; set and withdrawn by the person, or
recorded from a signed paper form by `matching.manage`; `people.employer` is untouched and only prefills it) with a Gift
matching section in the person slide-over. The record is bound to the sign-in that consented; a paper form for someone with no sign-in binds to their first sign-in if its verified email is the email on file when it was recorded (any later change of that email, or a first link by another account, leaves it to the office). Weaver's team never holds `matching_lead`; a filing grant counts only while
Weaver's grant of CatchTheMatch is older than it. The filing queue is slice 3.

**Built (slice 2, migrations 0765 to 0767, test 166; owner answers of 2026-10-13: start empty, a community's approval
publishes at once, Weaver sees the community's name never the person, eligible kinds of organization with the rule for
religious organizations, a `partner` source only):**
- **The shared directory** (`app.match_programs`, `app.match_program_names`, 0765): public facts only, never who works
  there or who gave; nothing in it names a person or a community or counts them. Company and the other names it goes by
  (any script; `app.employer_name_key`: compatibility forms, case, accents, every script's spaces and punctuation, no
  word of any language treated specially), country (one entry per name and country), ratio in basis points, currency,
  minimum and maximum per gift and per year in cents, gifts matched, kinds of organization, religious organizations
  (eligible, only their programs that are not worship, not eligible, not known; said plainly on the entry), portal and
  link, deadline (end of the gift's year, months after the gift, a date the next year, none) and note, volunteer grants
  (per hour, fewest hours, most per year), source (`partner` is a licensed database, later) and link, last checked and by
  whom (Weaver's team, or "a community": other communities never see which). Read by Weaver's team and by CatchTheMatch
  readers of any community where it is on; written only by Weaver's team (`app.save_match_program`,
  `app.set_match_program_retired`, `app.merge_match_programs`, a reason each) and by approving a submission. Its history
  (`app.audit_shared_row`) has no community and names only Weaver's team; a community's approval is named by the
  community, in the reason. It starts empty.
- **Submissions** (`app.match_program_submissions`, 0766) are the community's own record (0757's contract: module
  `matching`, `matching_can` readers, private audit). Sent with `matching.view` or `matching.manage`; decided by the
  community's `matching.manage` (its own only) or by Weaver's team: approve (the facts as sent or edited), reject with a
  reason, or mark a duplicate of an entry or another submission. A community's approval publishes at once, "verified by a
  community" today, except a change to an entry Weaver's team checked (or a retired one), which is forwarded to Weaver's
  team with the manager's edits. Weaver's team reads submissions only through `app.platform_match_submissions`: the facts,
  the note and the community's name, never who sent or decided.
- **Limits on what a community publishes (review of #248):** a community publishes at once only a new company, or a change
  to an entry it verified itself; it goes to Weaver's team (with the reason) when Weaver's team or another community
  verified the entry, the entry has ended, a link is new or changed, the name is close to an entry Weaver's team checked
  (the shorter at least 3 characters), the name is one another entry goes or went by (retired aliases and merged entries
  included), or Weaver's team has paused the community's publishing (`app.set_match_publishing`, with a reason). At most
  20 approvals publish per community per day (Weaver's team sets another cap). Only Weaver's team names a licensed database
  (`partner`). The entry is locked and checked again before an approval changes it. Names are never deleted (retired
  aliases); every write is a version (`app.match_program_versions`, Weaver's team only) and Weaver's team reverts one in a
  step (`app.revert_match_program`) and lists recent community publishes. A link records the entry's version, so staff see
  "changed since you confirmed it". Weaver's filing grant (C8) is for claims: it opens no submission and no link. The name
  key folds case from Unicode data (no database locale), and drops symbols, currency signs, emoji and invisible characters.
- **Employers on file linked to entries** (`app.person_match_programs`, 0767, the organization's own): candidates by name
  only, no AI (`app.match_program_candidates`, `app.match_employers_queue`, both logged reads); a `matching.manage` holder
  confirms (`app.link_match_program`) or removes (`app.unlink_match_program`) the link; it goes when the employer on file
  changes or is withdrawn; an entry merged into another is followed when read.
- **Portal:** Giving › Gift matching (`/giving/matching`: Directory, an entry's page with "Tell the directory what a member
  told you", Submissions with the three decisions, Employers on file), the entry under the employer in the person
  slide-over, and Platform › Gift matching directory (`/platform/matching`) for Weaver's team.

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
| 2 | Shared employer-program directory, member submissions, verification (**built**, 0765 to 0767, test 166) | M | No (it adds RLS policies: the owner OKs the PR) |
| 3 | Claims: the eligible-gift finder, the pre-filled donor request (message and member-app card), states and deadlines, the Weaver filing queue | L | **Yes: messaging** |
| 4 | Received: match payment against the claim in the Bank tab, soft credit, the donor's thank-you (a DonorDelight touch when DonorDelight is on), statements show the match as the employer's gift | M | **Yes: money (allocation, statements)** |
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

## 12. Phase 1: guide the member, then (Phase 2) file as the organization's agent (owner direction, 2026-10-17)

**The direction.** The owner asked: "first restrict to engage the member by sending them the process internal to their employer on how to seek matching funds; becoming agent of the organization would be the next step", and then: "catch members who donated but did not get the match where another person with the same employer was able to do the paperwork to get the match", with "a library that collects and maintains processes per employer that successfully got the match for the non-profit", uploaded by Weaver's team.

| | Phase 1 (built, this section) | Phase 2 (paused, sections 4, 5 and 9) |
|---|---|---|
| Who acts | The organization's staff and the member. Weaver is software, and its team writes the library. | Weaver's team files as the organization's agent. |
| What Weaver sends | Nothing to members. Staff copy a message and send it their own way. | The donor's pre-filled request and reminders. |
| Fee | None. Pricing is the owner's, once Marketplace billing exists (B120). | 10% of each match, capped at $500 (C5), after the lawyer's view (C9). |
| Legal view | Not needed to start: the organization tells its own members how to claim. A short check of the library's disclaimers and the consent wording is still wise. | Required (section 5). |
| Billing | Not needed. | Needed (slice 5). |

**Decisions recorded (2026-10-17).** C10: Phase 1 is member guidance only, with no fee and no Weaver filing. C11: a program is PROVEN HERE when a claim of this community for it is received; nothing is guessed from a company name. C12: the library is text and links only; a file (a form, a screenshot) needs a storage bucket and is a later change.

**Built (Phase 1, migrations 0886 to 0888, test 886):**
- **Claims** (`app.match_claims`, 0886): one row per gift and employer program, the organization's own data under 0757's contract (module `matching`, its own readers, adults only, no platform-admin read, private audit). States: asked, requested, verified, received; or closed as declined, expired, withdrawn. **No match amount is stored and no payment is touched**: putting the match into Giving and thanking the donor is slice 4. `app.record_match_claim` (a claim the office already knows about, such as the first match a program ever paid), `app.ask_match_claims` (asked, for every gift of a member that can still be claimed), `app.set_match_claim_state` (move on, close, or open again a claim that ended by mistake); all `matching.manage`.
- **The match a member missed** (`app._match_catch`, `app.match_catch_list`, 0886 and 0888): a program that has paid this community at least once (a received claim) makes its other members visible: adults whose employer on file (0759) is linked to that program (0767, confirmed by staff) and who gave in the last two years (completed gifts, less refunds and fees, never an opening balance or a history import, at or above the program's minimum) with no claim. Gifts past the program's deadline are kept apart as **missed**. Filters: To catch, Missed; counts of open and ended claims; the organization's name, legal name and tax ID for the message. The household shows as its card (never a name alone); amounts only for a role that also sees giving (`app.match_amounts_can`); every read is logged without names.
- **The library** (`app.match_processes`, 0887): at most one entry per directory program, written by Weaver's team only (`app.save_match_process`, `app.remove_match_process`, a reason each, the shared audit): who submits (member, organization, either), the steps in order, what to have ready, links, about how many days, tips, and the day and a note when Weaver's team saw it work. Readers: Weaver's team and every community that has CatchTheMatch on, like the directory. **Public facts only**: no person, no community, no amount; a reader gets how many communities have been paid through the program (a count) and how many matches their own community received.
- **Portal:** Giving › Gift matching now has To catch (`/giving/matching/catch`: the members, the proof line, the gifts and the time left, a copyable message built from the library and the organization's registered name, "Mark as asked"), Claims (`/giving/matching/claims`: where each claim stands and a control to move it), Record a match (`/giving/matching/claims/record?person=`, from Employers on file), How to claim (`/giving/matching/library`), and a "How to claim" card on each directory entry; Platform › Gift matching directory has the editor for the steps.

**Not in Phase 1:** sending the message (it needs the owner's approval for messaging and an email provider, B116), the member app card (a mobile release), files in the library, the match payment in Giving and the donor's thank-you (slice 4, money), Weaver's filing queue and the fee (Phase 2).

## 13. Finishing Phase 1 (owner direction, 2026-10-17: "finish what is pending of CatchTheMatch")

Phase 2 (Weaver files as the organization's agent, the fee ledger, the lawyer's view, a secular pilot, Marketplace billing) stays paused. Everything pending of Phase 1 is built in pieces, one pull request each, migrations 0920 to 0939 (DonorDelight uses 0890 to 0919). Each piece that sends a message, touches personal data, permissions, money or storage waits for the owner's OK before it is merged.

| Piece | What | Migration | Owner OK |
|---|---|---|---|
| 0 | Ask the adults of donor families for their employer | 0920 | Yes: messaging, personal data |
| 1 | "Send to the member" for a claim, through the messaging queue | 0921 | Yes: messaging |
| 2 | The member app card "Does your employer match?" and the member's own claims | 0922 to 0924 | Yes: RLS, personal data |
| 3 | Slice 4: the match arrives in Giving (soft credit, thank-you, statements) | 0925 to 0927 | Yes: money |
| 4 | An optional file or screenshot per library entry | 0928, 0929 | Yes: storage, RLS |
| 5 | The Marketplace card | 0930 | Yes: it emails communities that asked to be told |

### 13.1 Ask for employers (piece 0, migration 0920)

**The wording** is the owner's, kept as he wrote it and hedged as it is: "You may be eligible to double the donation from your employer if you provide your employer information." It carries no amount and no gift, only a link to the member app screen where the person adds their employer with their consent (section 6). The message only asks; nothing is put on file by it.

**Built (migration 0920, test 920):**
- **The audience** (`app._match_ask_base`, `app.match_employer_ask_list`): the adults (never under 18, never deceased or merged) of every household with a gift that went through in the last 24 months (`app._match_gifts`: completed, less refunds, no opening balance, no history import, no fee) who have **no employer record at all**. A person with an employer on file is not asked; a person who **withdrew** theirs is never asked again (the withdrawn row stays); a person asked in the last 90 days is not asked again. Each person is told apart by how they can be reached today: an email on file that is not suppressed, not unsubscribed, not opted out at that address and whose `marketing_email` consent was not withdrawn; or a login with the member app on a phone and the topic switched on. Counts and the list are for `matching.manage` only (the organization's own, never Weaver's team, never the filing grant); the household shows as its card; no address, no amount, no gift is returned; the read is logged (`app.log_private_read`).
- **The ask** (`app.ask_match_employers`): through the **existing** messaging queue (`app.enqueue_notice`), so the sandbox's verified-recipient rule (`messaging.recipients`), suppressions and bounces, opt-outs, newsletter unsubscribes, the member's own topic switch, quiet hours for the push, the deceased rule and the delivery webhook all apply unchanged. A new notification topic `matching` ("Employer gift matching", on by default, a marketing topic) lets a member switch it off in the app; templates `match_employer_ask` (email and push, a community may override them). At most 300 people per call; a per-community lock makes two clicks at once ask each person once.
- **What was asked** (`app.match_employer_asks`): one row per person and channel: who asked, when, the message, queued or not, and why not in plain words without the address. The organization's own data under 0757's contract (module `matching`, adults only, no platform-admin read, restrictive `module_switch`, private audit).
- **Portal:** Giving › Gift matching › **Ask for employers** (`/giving/matching/ask`): the counts (to ask, by email, in the member app, no way to reach; left out because an employer is on file, withdrawn, or asked recently), the people with their household card, "Ask" for one person or for everyone reachable. **It refuses before queueing anything when this server cannot send email** (no provider key, or no member app address) and says what is missing (backlog B116); a sandbox says it messages only verified test recipients. The result says "queued" (handed to the sending service), never "sent", names what could not be queued, and points to Settings › Email › Recent emails for what actually arrived.
- **Member side:** the link opens the member app's **Does your employer match?** screen (piece 2). Until that app version is out, the push opens the app and the email link opens the member web app; do not use the ask before piece 2 ships.

### 13.2 Send to the member (piece 1, migration 0921)

**Built (migration 0921, test 921):** a CatchTheMatch manager sends the claim message from Giving › Gift matching › To catch (or a reminder from Claims) after seeing it exactly: **Send to the member** opens `/giving/matching/send?person=&program=` with the subject and text, how the person can be reached (email, the member app, both, or neither: booleans, never an address), and the gifts. The send goes through the **existing** messaging queue (`app.enqueue_notice`): the sandbox's verified-recipient rule, suppressions and bounces, opt-outs, the member's own topic switch (`matching`), quiet hours for the push, the deceased rule and the delivery webhook. The text is **built in the database from the library** (`app._match_claim_message_text`, the same words as `buildMessage` in `src/lib/matching/catch.ts`, which still serves "Copy the message"); the screen cannot change it, so `matching.manage` cannot be used to send anything else. **No amount**: the gift's day, the last day to ask, the steps, the organization's registered name and tax ID. The push says "your employer", never its name (a locked screen).
- **Recorded on the claim:** `app.match_claims.asked_by_message_at` and `asked_message_id`. A gift with no claim gets one ("asked"); every claim records that it was asked by message. **Nothing is recorded unless something was queued.** The same member is not messaged again for 14 days, then it is a reminder.
- **Never silent:** the portal refuses before queueing anything when this server cannot send email (no provider key; backlog B116) and says what is missing. A sandbox reports "not queued" for anyone but a verified test recipient. The result says "queued", never "sent", and points to Settings › Email › Recent emails for what actually arrived. If a person cannot be reached from Weaver the page says so and the copy flow stays.
- **Claims** shows "Asked by message on …", and "Send a reminder" for an asked claim. `app.match_claims_list` is 0888's body plus that column.

### 13.3 The member's side: "Does your employer match?" (piece 2, migration 0922, member app 1.30.0)

**Built (migration 0922, test 922):** the member adds or removes their employer with their consent (0759, unchanged), sees the steps for it from the library, and can tap **I have asked my employer**; they see only their OWN claims and where each stands.
- `app.my_match_card(center)`: the employer they put on file (only if THIS sign-in consented to it: 0759's rule, so a paper form or another sign-in's record is not shown), the steps for it (the directory entry staff confirmed, else the one active entry whose name or alias is exactly the employer's; two entries with the same name show nothing rather than guess), the organization's registered name and tax ID the steps ask for, the member's own gifts that can still be claimed (the day and the last day to ask, **never an amount**) and their own claims (state, program, gift day, last day to ask). Nothing about anyone else; adults only (a child's sign-in gets nothing); nothing when CatchTheMatch is off; **no platform-admin branch** (a platform admin who is a member sees their own card, like anyone). The member's own reads are not staff reads and are not in the organization's read log; every change is audited (the private audit of `app.match_claims`).
- `app.report_my_match_request(center)`: the member's claimable gifts become claims **requested**, marked `requested_by_member_at` so staff see it came from the member (a gift staff had marked "asked" becomes requested, the same claim). A second tap finds nothing left. `app.undo_my_match_request(center, claim)` takes it back while staff have not moved it on (a claim the member's report created disappears; one staff had asked goes back to asked).
- **Staff** see "The member says they asked their employer (date)" on Giving › Gift matching › Claims.
- `app._match_gifts_of` is `app._match_gifts` (0886) for one person, so a member's visit does not read the whole community; test 922 keeps the two equal.
- **Member app (connect-mobile 1.30.0):** a "Does your employer match?" card and screen (Settings area), a push of type `match_ask` or `match_claim` opens it, and a topic switch "Employer gift matching".

### 13.4 The match arrives in Giving (piece 3, slice 4, migration 0925)

**Built (migration 0925, test 925). Needs the owner's OK before merge: it is money.** When the employer's match reaches the organization, a manager records it against the claim: Giving › Gift matching › Claims › **Record the match** (`/giving/matching/claims/pay?claim=`).
- **`app.record_match_payment(center, claim, amount_cents, received_on, note)`**: needs `matching.manage` **and** `giving.record_offline` (or `giving.manage`); a CatchTheMatch manager alone cannot move money and a clerk alone cannot touch a claim; never a platform admin, nobody under 18. It records **one** payment in Giving, method `matching_gift`, offline, captured, for the **donor's household** (the donor's **soft credit**: it shows in the household's giving history beside their own gifts, flagged "Employer match" for CatchTheMatch readers), exactly once (idempotency key `match:<claim>`), in whole cents, not in the future, never more than ten times the gift (a typing slip), and marks the claim **received** on that day (a claim the office had already marked received keeps its day and gets its payment). It is **not applied to any pledge and not credit**: the employer's money never pays down the donor's own pledge and nothing applies it later by itself (a treasurer still can by hand, as for any payment). The payment is numbered like any (a reference for the ledger and the bank) but **no receipt goes for it**.
- **`app.match_payments`** links the payment to the claim, the donor, the household and the employer's name then (organization-private: module `matching`, readers only, adults only, restrictive `module_switch`, private audit). The employer's name lives only here; the payment's memo says "Employer matching gift".
- **Not the donor's own money, everywhere the donor's money is counted** (each function is its latest body plus one change): `app.year_end_statement` lists the match apart as `employer_matches` with a sentence ("your employer's gift to us, not yours ... not a gift you can deduct") and leaves it out of the lines, the count and the **tax-deductible total** (the employer's name shows to the household's adults and CatchTheMatch readers; other giving staff read "Employer matching gift"); `app.year_end_review` (a household with only a match gets no statement); `app.receipt_copy` refuses; `app.payments_receipt_email` sends nothing (a transaction setting covers the moment before the link exists); `app.household_credit` leaves it out; `app._match_gifts` and `app._match_gifts_of` never offer it as a gift to match again.
- **What stays, on purpose:** it is real money received. It counts in the organization's giving totals and reports (as money not applied to a pledge), it posts to QuickBooks like any offline payment (the way a `matching_gift` payment has always posted), and **the Bank tab reconciles it with the existing engine**: `app.reconcile_candidates` proposes it for an incoming line of the same amount and attaching the line reconciles it; a batch from a matching platform is matched through the deposit sets. **The donor's thank-you:** DonorDelight's thank-you steps open one for every gift that went through (`app._care_gifts`), so when DonorDelight is on the match opens a step for the donor; when it is off nothing is added (care files are not touched). Claims shows "Thank the donor" (the household) only where DonorDelight is on.
- `app.set_match_claim_state`: a claim with a payment cannot be moved off received ("Refund or correct that payment in Giving first"). `app.match_claims_list` says whether the match was recorded, and the amount only for a role that also sees giving; `app.match_claim_get` feeds the form.
- **Portal:** Claims › Record the match (the effects in three plain sentences, the amount in dollars and cents, the day, a note), "Match recorded in Giving: $X" on the claim, the household's Payments tab flags the payment ("Employer match ... no receipt ... left out of year-end statements") and its year-end line says "$X employer matching gift, listed apart".
- **Not built / follow-ups:** a match that the employer reverses (use the existing refund on the payment; the claim stays received); one lump payment covering several claims (record each claim's share); starting from a bank line in the Bank tab (record on the claim first, then the line is proposed); the member app does not show statements from `year_end_statement`.

### 13.5 Files for the library (piece 4, migration 0928)

**Built (migration 0928, test 928). Needs the owner's OK before merge: storage and RLS (a new bucket; the four `storage.objects` policies and `app.can_read_object` / `app.can_write_object` are redefined).** Decision C12 said the library was text and links only until a file needed a bucket. Weaver's team can now attach up to six files to an employer's entry: the employer's form, a screenshot of the portal's screen. They are public facts like the rest of the library: a form or a screen, never a person, a community, a gift or an amount.
- **Bucket `match-library`:** private, 10 MB, JPEG, PNG, WebP or PDF (a phone photo of a form is a JPEG; HEIC is not accepted here). The path is `<entry id>/<file id>.<ext>`: **no community** (the library is shared), so the usual rule "the first part is the community" does not apply and the bucket has its own branch in both functions. **Read:** Weaver's team (every object, so it can also delete a removed file's stored copy: storage can delete only what the caller can also see) and a community's CatchTheMatch readers **only while a live row names the object** (an upload never registered, or a removed file, reads as nothing to a community). **Write:** Weaver's team only, only under an existing entry's own folder, one file deep, a lowercase uuid and a short lowercase extension.
- **`app.match_process_files`** (shared, core, audited by `app.audit_shared_row`: Weaver's team named, no community): the entry, a kind (form, screenshot, other), a caption, the stored name, type, size and fingerprint, who added it. `app.add_match_process_file` (Weaver's team, a reason, the file must be in storage and in the entry's folder, type must match its name, six live files at most) and `app.remove_match_process_file` (a reason; the row stays as a record, the caller deletes the stored copy). `app.match_process_get` lists the live files.
- **The lists, as decided:** the four literal `storage.objects` policies carry the twelfth bucket (0865's list plus `match-library`). It is **not** in `app.connect_storage_buckets` (the object-level audit writes a community's id and this bucket has none; the table's shared audit says who added and removed what), **not** in `app.storage_scan_buckets` (Weaver's team's own uploads; like `payment-evidence` it joins the virus scan the day a scanner is installed), and has **no retention** (nothing is purged by age; a removed file is deleted when it is removed). Not in Setup › Storage's per-community areas (it holds nothing of a community).
- **Portal:** Platform › Gift matching directory › an entry › **Forms and screens** (add: the browser uploads straight to a signed address made by `prepareLibraryUploadAction`, then `addLibraryFileAction` registers it and deletes the bytes if the database refuses; remove with a reason). Every community's entry page and How to claim show the files as links that open in a new tab (links last an hour, made as the reader).
- **Not built:** the member app does not show the files (a member is not a CatchTheMatch reader, so the bucket's policy would refuse); a daily sweep of uploads that were never registered (the action deletes them when registration fails).
