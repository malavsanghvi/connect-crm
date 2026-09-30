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

## Rule for every upload step (owner, 2026-09-30)
Every step that accepts a bulk upload uses the SAME uploader, so each has:
1. **A downloadable template** for that step's data (CSV/XLSX, example row, column dictionary), from
   `src/lib/import/templates.ts`; the file is filled in and uploaded back.
2. **Field mapping on upload**: the owner maps each file column to a field (auto-matched by header and
   synonyms, with AI suggestions), so files from QuickBooks, Neon or a spreadsheet work without re-typing.
3. **Validation by the field's type and intent**: email, phone (E.164), date, money (cents), integer, enum,
   identifier (leading zeros kept), required-ness; per-row problems are listed in plain English and downloadable
   as a problems file, and the run is checked before anything is saved.
4. **Extra columns become custom data**: any column the owner does not map to a built-in field is kept as a
   custom field on the record with a type guessed from its values (`CUSTOM_TYPES`), visible on the profile.
   Nothing uploaded is thrown away.
These four already exist in the import tool (`/settings/import/new`, `src/lib/import/mapping.ts`,
`transforms.ts`, `registry.ts`); the onboarding work embeds that tool step by step rather than building another.

## The flow (owner's screens, one step each)
1. **Welcome.** What we will do, how long, that nothing is final until they confirm; Skip/Back on every step.
2. **Past donations and invoices (optional).** Upload a CSV or Excel (QuickBooks, Neon, bank export). Map
   columns (payer name, amount, date, fund/pledge, receipt, payer email/phone when present).
3. **Smart matching of payers (minimal intervention).** Matching is a scored search over every signal in the
   file, not a name comparison. Names alone still never merge (ARCHITECTURE), but a name that is *compatible*
   plus an agreeing identifier is not "name alone".
   - **Signals and weights:** normalized **mobile/phone** (digits only, country code, last 10), **email**
     (lower-cased, Gmail dots/plus removed), **street address** (USPS-style normalization: St/Street, Apt,
     unit, ZIP+4; same ZIP and house number + street), and **name** (case, punctuation, titles, initials,
     nicknames, spouse order and "&": "Sanghvi, Malav" = "Malav & Palak Sanghvi").
   - **Auto-link (no question):** a phone or email match AND a compatible name; or the same normalized
     address AND the same surname AND a compatible first name or spouse pair. Shown afterwards in a summary
     the owner can open and undo.
   - **Ask (one question per group):** a strong identifier matches but the names disagree (a parent paying for a
     child, a shared family phone), or name + address agree but nothing else, or only a close name with a
     partial address. The card shows both records side by side with the evidence ("same mobile, different
     surname") and **Merge / Keep separate**.
   - **Stay separate silently:** name-only likeness with no other signal, or conflicting strong identifiers.
   - Each decision is learned for the rest of the file ("same rule for the other 14 like this") and every
     auto-link and merge is audited and reversible.
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
1. Confirm the auto-link / ask / separate rules above (thresholds are tunable per organization).
2. Bank/payer names as household aliases: store them on the household (new table) or as custom identifiers.
3. Which donation files first: QuickBooks export, Neon export, or a plain spreadsheet template.
