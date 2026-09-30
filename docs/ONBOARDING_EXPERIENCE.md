# Guided onboarding experience (draft, 2026-09-30)

Owner's request: a clean, on-screen, **one step at a time** flow that takes an organization from an empty
sandbox to households, donations and members loaded, and members enriching their own profiles at first sign-in.
This document is the plan; backlog B25 (office side) and B26 (member side) track the build.

## What exists today (reuse, do not rebuild)
- **Import tool** (`/settings/import/new`, `src/lib/import/*`): templates, column mapping with AI suggestions,
  checks, matching, preview, reconcile, undo. Matching never uses a name alone (ARCHITECTURE: "names are never
  enough"); a name-only look-alike is added and sent to merge review.
- **Merge review** (`/people/merge`).
- **Payment/pledge imports** keyed to a household by legacy ID or household number.
- **Member app**: join link/QR (`Settings › Member app`), "Find your community", "find my family" matching.

## The flow (owner's screens, one step each)
1. **Welcome.** What we will do, how long, that nothing is final until they confirm; Skip/Back on every step.
2. **Past donations and invoices (optional).** Upload a CSV or Excel (QuickBooks, Neon, bank export). Map
   columns (payer name, amount, date, fund/pledge, receipt, payer email/phone when present).
3. **Look-alike payer names.** Group names that look alike (case, punctuation, "Mr./Mrs.", initials, spouse
   order "Malav & Palak Sanghvi" vs "Sanghvi, Malav"). Show each group with its payments; the owner chooses
   **Merge** or **Keep separate**. Names are only a *suggestion*: the owner confirms every merge; email or phone
   in the file raises confidence but still needs the owner's click for merges across different names.
4. **Households established.** One household per confirmed group, payer names kept as aliases (they are
   the bank/payer names `ARCHITECTURE` already lists as identifiers). Payments load as history linked to it.
5. **Member list.** Upload members/families (names, email, mobile, relationships, birthdays, membership).
   Each row is matched to the households from step 4 by email, phone, then name *as a suggestion*; unmatched
   rows create new households; look-alikes go to the same merge screen.
6. **Rest of the family.** Spouse, children, parents, addresses: attached to the matched household.
7. **Review and confirm.** Counts, what will be created/updated/skipped, anything unmatched; one **Confirm**;
   the run is undoable as every import run is.
8. **Invite members.** The join link/QR (already built) and, next, sending it by email/text.
9. **Member first sign-in (connect-mobile).** After "find my family", one question per screen: birthday,
   anniversary, preferences, dietary, interests, volunteering, emergency contact, consents. Skippable and
   resumable; fields come from the organization's settings.

## Build phases
- **P1** Step shell (progress, Back/Skip/Resume, state saved per organization) + steps 2–4 (donation upload,
  look-alike grouping and merge, household creation) over the existing import staging.
- **P2** Steps 5–7: member upload matched to donation households; rest-of-family data; review/confirm.
- **P3** Step 8 sending the join link; step 9 first-sign-in enrichment in the member app (B26).

## Decisions needed before P1
1. Look-alike rule strictness (suggest: normalize case/punctuation/titles; group on surname + first-name
   initial or spouse pair; never auto-merge).
2. Bank/payer names as household aliases: store them on the household (new table) or as custom identifiers.
3. Which donation files first: QuickBooks export, Neon export, or a plain spreadsheet template.
