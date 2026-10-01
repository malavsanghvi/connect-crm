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

## Save and resume (built 2026-09-30, migration 0545)
The wizard no longer lives only in the browser. Leaving the page, a crash or a closed laptop is safe.
- **One draft per organization** (`app.onboarding_progress`, a partial unique index on `status = 'draft'`). It holds
  where the wizard stands, per-file facts without personal values (file name, column choices, row counts, the current
  question), the owner's merge / keep-separate answers, and the numbered import runs Create has made. Two people on the
  same draft cannot overwrite each other: every save carries the version it last saw, and a stale one is refused in
  plain words ("This guided onboarding was changed since you opened it, by someone else or in another tab of yours…").
- **The checked rows are stored on the server** (`app.onboarding_rows`), in chunks of at most 300 rows (the wizard
  sends 250, like the import tool), so a 20,000-row file is about 80 rows of this table. Once Create starts, the
  final household plan is saved the same way, so a resume builds the very same files.
- **On load** the wizard offers "Continue where you left off" (step, what is saved, who saved it and when) with
  "Start over" (asks first). It saves after every step: an upload, the column choices, each answer, the current
  question, every import run Create makes. A line under the steps says when it was last saved; a failed save is shown
  beside the work with "Save again" and is sent again, never dropped.
- **Answers are keyed by what the question is about** (the first uploaded row of each side, or the existing household),
  not by a number that changes when the file or the records change, so a saved answer still applies after a reload.
  Uploading a list again removes the answers and the plan, because they were about the old rows.
- **Create can be stopped and pressed again.** A finished import is skipped, one that was partly done carries on,
  one that stopped for a decision waits for it. Every ID in the generated files is stable and belongs to this draft
  (`ONB-<6 hex of the draft id>-H-00001`), so nothing is added twice and a second onboarding in the same organization
  cannot be mistaken for the first.
- **Personal data** in the saved rows is handled like import staging data: never written to a server log (only an error
  code and message are logged); hidden from the audit log (`app.audit_mask` shows `staged_rows` and `merge_answers` as
  `***`, so a change is visible and the values are not; 0548 holds the final definition, which also keeps 0546's keys,
  and test 47 fails if a later migration drops them); deleted the moment the draft is finished or started over; and
  a draft nobody touched for 90 days is abandoned and its rows deleted the next time anyone opens the wizard (the same
  lazy 90-day retention the import tool applies to a run's original cells; there is no scheduled job in this project).
- **Access** follows the import engine: the data type's own write permission (past donations need `giving.manage`,
  members and families `people.manage`), platform admins always. Past-donation rows also stop with the giving module.

## Matching against households already in the records (built 2026-09-30)
Before anything is created, the households already in the organization's records take part in the same matching as
the uploaded rows, as extra rows tagged with the household they describe: its name, each current member's name, email
and mobile, and the names it has paid under (bank payer names and the "Also paid as" custom field). Same rules as
above: a name alone never links, and two different existing households are never put in one group (joining duplicates
is Merge review's job). An uploaded row that belongs to one is shown as "Already in your records: <household>" and asks
the same one-question-at-a-time questions. On Create:
- **no household is created** for a group that is an existing household; its people and donations are attached to it;
- the people and donation files name an existing household by its **Connect household number**, in the same
  "Household ID (old system)" column the new households use. The import engine already resolves that
  (`app.import_ref` accepts the organization's own household ID, a legacy CRM ID, an earlier import's key, or the Connect
  number; every household has a number, issued by a trigger), so no schema change and no identifier is added to the
  household. `supabase/tests/47_onboarding_progress_test.sql` pins it;
- people already on file (same email or mobile) are updated, not duplicated; nobody in an existing household is marked
  primary, and a relationship is sent only when the file says spouse, child, parent or sibling, so what the office
  recorded is not overwritten;
- the records are read under the signed-in person's row-level security, a page at a time, only the columns matching
  needs. More than 50,000 rows is reported, never silently cut.

When the import tool stops a run ("needs your decision": a name-only look-alike of someone already there), the owner
decides in the wizard, one row at a time, with the household card of the records it looks like, and Create carries on.

## Build phases
- **P1** Step shell (progress, Back/Skip/Resume, state saved per organization) + steps 2–4 (donation upload,
  look-alike grouping and merge, household creation) over the existing import staging.
- **P2** Steps 5–7: member upload matched to donation households; rest-of-family data; review/confirm.
- **P3** Step 8 sending the join link; step 9 first-sign-in enrichment in the member app (B26).

## Decisions needed before P1
1. Confirm the auto-link / ask / separate rules above (thresholds are tunable per organization).
2. Bank/payer names as household aliases: store them on the household (new table) or as custom identifiers.
3. Which donation files first: QuickBooks export, Neon export, or a plain spreadsheet template.
