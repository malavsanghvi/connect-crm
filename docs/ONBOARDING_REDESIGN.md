# Onboarding redesign: bring your data in, with Niva

**Status: draft plan for the owner (2026-10-09). Nothing is built.** Owner direction, 2026-10-09: redesign how an
organization brings its data into Weaver, for every kind of organization and dataset, with AI embedded throughout to
cut the customer's effort. Three ways in were named: (1) standard templates, downloaded step by step; (2) connecting
the systems the organization already uses (QuickBooks, Neon CRM, Zeffy), with details the customer provides;
(3) the customer's own spreadsheets, which Weaver analyses, organizes and loads. The owner also asked what else would
reduce burden and friction.

Per `CLAUDE.md`, the owner approves before merge anything that changes money rules, permissions or RLS, or deletes
data. This plan builds nothing; the phases say where they would. Companions: [ADMIN_REDESIGN.md](ADMIN_REDESIGN.md)
(Niva for admins, the shell and palette, decision D2 on children), [ONBOARDING_PLAN.md](ONBOARDING_PLAN.md) (Steps 3 to
5, gaps G16 to G18 and G38), [ONBOARDING_EXPERIENCE.md](ONBOARDING_EXPERIENCE.md) (the guided wizard),
[MARKETPLACE_PLAN.md](MARKETPLACE_PLAN.md), and backlog B76 (the 60-minute promise). Backlog: B84, B85.

## The short version

1. **Do not build three importers. One engine already exists** (templates, mapping, checks, matching, preview,
   reconcile, undo). A template, a connector, a custom spreadsheet and a photo should all end as staged rows in it. A
   connector is a file that fetches itself.
2. **Add one front door**, not three menus. The customer drops files or connects a system; Weaver recognises what each
   is and routes it. The three ways become results of recognition, not a choice the customer has to get right.
3. **Niva reads, drafts and asks; code does the work; a person confirms.** The model writes a recipe from column
   headings and masked samples. Plain code runs the recipe on every row. Nothing is saved until Confirm.
4. **Nothing about children reaches an AI provider** (owner decision D2, 2026-10-09). This shapes the design: photos
   are read on Weaver's own servers, and columns about children are never shown to Niva.
5. The biggest burden reducers beyond the three ways are in [the list below](#other-ways-to-reduce-the-burden): source
   presets, helper links, autofilling the profile, right-sizing the move, a parallel run, and letting families check
   their own records.

## What exists today (reuse it)

| Piece | Where | What it gives this plan |
|---|---|---|
| Import tool | `/settings/import/new`, `src/lib/import/*` (`registry`, `mapping`, `transforms`, `templates`, `runs`, `mask`) | Templates with dictionaries, mapping by header and synonym, checks, matching (IDs, never names alone), preview, reconcile, undo for 30 days |
| AI column suggestions | worker job `import.suggest_mapping`, `src/lib/import/mask.ts` | Only headings and masked samples leave; field, confidence and reason come back; a person confirms each |
| Guided onboarding wizard | `src/app/(app)/setup/onboarding/*`, `src/lib/onboarding/*`, `app.onboarding_progress` | Donations, smart matching, households, members, review; save and resume; matching against existing households |
| QuickBooks | `src/lib/qbo/*`; jobs `qbo.pull_lists`, `qbo.pull_customers_history`, `qbo.match_suggest_ai`, `qbo.bring_in_history` | Sign-in, daily lists, 7 years of customer history, rule and AI matching (at most 85% sure), treasurer approval, history as historical payments and pledges that never post back |
| Credential vault | `src/lib/vault.ts` (`neon_crm` takes an `api_key`), `integration_connections` | Keys stored encrypted; a Neon connection type already exists; no pull code |
| Niva web import | jobs `niva.discover_site`, `niva.import_page` (B20) | Reads a community's public pages; the base for profile autofill |
| Data checklist | `/get-ready/checklist.csv`, `src/lib/onboarding-checklist.ts` (B76) | What to gather before starting |
| Readiness and quality | `src/app/(app)/setup/*`, `settings/data-quality`, `settings/custom-fields`, `people/merge` | The "is it good?" half |
| Zeffy | nothing (only named as a pricing model in B51) | Gap |

## The front door

One screen. A drop zone, connector tiles, "start from templates", "hand a part to someone", and Niva's plan from the
customer's sign-up answers. Dropping files shows what Weaver thinks each one is, before anything is read in full.

| The customer gives | Weaver recognises | Goes to |
|---|---|---|
| A file that matches a Weaver template | An exact match on headings | Straight to checks |
| An export from a known system | A **source preset** (Neon, QuickBooks reports, Zeffy, PayPal, bank, Google Contacts, Mailchimp, Eventbrite) | Mapping already done; the person checks it |
| Any other spreadsheet | An unknown layout | The recipe reader (way 3) |
| A photo or PDF of a printed list | An image or scanned page | The paper reader (way 3, D2-safe) |
| A connection | A system name and a key or sign-in | A connector (way 2) |
| Nothing digital | The customer says so | Templates, or a done-with-you session |

The plan card comes from the access request and a few questions (about how many households, how many years of
giving, which systems, which modules). It lists only the steps that apply, in order, with a rough time.

## Way 1: templates, step by step

Today there is one CSV or Excel template per data type. The change is a **starter workbook**:

- One Excel file (or Google Sheet, or separate CSVs) with one tab per thing to load, in load order: lists, then
  households, people, memberships, store items, then pledges, payments, allocations. Tabs for modules the community
  does not use are left out.
- Every tab has an example row, a Dictionary tab, **dropdowns filled from the community's own lists** (membership
  types, funds, zones), and checks that catch the common mistakes while the person types.
- **Part-filled** with what Weaver already knows: membership types from the sign-up answers, funds from the
  QuickBooks chart of accounts, zones and store categories from the website.
- Tabs can be uploaded as they are ready. If a tab refers to something not loaded yet, the message says which tab to
  load first. Mistakes are explained in plain words once ("03/04/21 could be March 4 or April 3. Which does your
  community use?") and the answer applies to the whole file.
- **Share a tab**: a link that opens one tab for the treasurer or membership coordinator (see helper links).

Build: a workbook generator over `src/lib/import/registry.ts` and `templates.ts`, with data validation and module
awareness. Effort M.

## Way 2: connect a system

### The framework

A connector does five things: **authorize** (OAuth or key), **list** what is there with counts, **fetch** in pages
with a cursor so it can resume, **map** each record to the same entity definitions the import registry uses, and
**refresh** incrementally (updated since, or the vendor's change feed). Its output is staged rows in an import run
whose `source` names the system (`import_runs.source` already lists `neon_crm`). From there it is the same engine as a
file. Errors are plain English with the exact fix, and nothing is saved.

Two modes, chosen by the customer: **pull once, then forget the key** (the default) or **keep in step until I switch**
(a nightly refresh). The second is what makes a parallel run possible (below).

### The systems

| System | How it connects | What it brings | State and notes |
|---|---|---|---|
| QuickBooks Online | Sign in with Intuit, read-only | Chart of accounts, classes, items; customers; 7 years of history | **Built** (see above). New: show it as one step in the front door and the review screen, so the customer sees one flow. A QuickBooks customer is often the payer, not the family, so the treasurer approves each match |
| Neon CRM | Organization ID and API key (third-party descriptions say HTTP Basic, ID as user and key as password, on the v2 REST API) | Accounts (people, organizations), donations, pledges, recurring gifts, memberships, event registrations, custom fields | **Not built.** Highest value first: JSH is on Neon and the cutover is an open decision. Households are inferred, because Neon is account-centric. Keep the Neon IDs as identifiers so later pulls update, not duplicate |
| Zeffy | An API key created by an organization admin (Settings, Integrations, per Zeffy's pages) | Contacts, payments, campaigns | **Not built.** Zeffy describes its API as a **free, read-only beta**. Keep the CSV export working through the front door as the fallback |
| Google Sheets | Sign in with Google, read-only on the sheets the person picks | Any spreadsheet, refreshed on demand | **Not built.** It is "a file that fetches itself" and feeds way 3 |

**To verify before building any connector** (the facts above come from public pages and third-party summaries, not
from a contract or a test account): Neon's official API documentation and its v1 retirement date; the authentication
scheme, rate limits and field names; Zeffy's endpoint list, limits and who may create a key; and that each vendor's
terms allow a customer to move their own data this way. See decision OB9.

### Credentials

Keys go in the existing vault, shown as the last four characters, and changing or removing one needs a fresh 2FA
check. "Pull once" deletes the key when the pull finishes. A person who does not hold the login can send a **link that
opens only this step** to whoever does, so the key never passes through the person onboarding. Keys are never sent
by email or chat, and Niva never sees one.

### Parallel run and cutover

ONBOARDING_PLAN gap G38 ("live connections to old CRMs for a long parallel run") was P2 and should move to P1. A
nightly refresh lets the customer keep using Neon while trying Weaver, and a cutover checklist (last pull clean,
totals match, families have checked their details, payments tested, second administrator signed in) says when it is
safe to switch. Nothing is written back to the old system.

## Way 3: the customer's own files

### Spreadsheets

1. **Profile.** Weaver reads every sheet: header row (even on row 4 or over two rows), types, distinct values, blanks,
   and shape (one row per gift, years across columns, a family in one row).
2. **Classify.** What each sheet is: gifts, people, a lookup table, notes, junk.
3. **Write a recipe.** Niva sees the headings and a few masked samples and writes a short list of steps in a fixed
   vocabulary: stack these sheets, unpivot these columns, split this column, read dates month first, turn this into
   cents, map these codes to funds, ignore rows that match this, join on this column, keep this as a custom field.
4. **Show the recipe in plain words**, each step with a reason and evidence ("1,204 dates have a number above 12 in the
   second place"), and a Skip or Change on each.
5. **Run it with code.** A deterministic engine applies the recipe to every row. The model does not touch the rows, so
   a 50,000-row file costs the same as a 50-row one, runs the same way twice, and can be audited.
6. **Ask only what cannot be known.** Typically two or three questions with a suggested answer ("which fund does
   Gen mean?", "38 gifts have no family number").
7. **Preview, check, reconcile, confirm** in the existing engine.
8. **Save the recipe** so next month's top-up needs no questions, and so the next customer with the same export starts
   from a preset.

Hard cells (a note that says "paid by check 4512 for Diwali", an address typed into one box) can get a per-cell model
opinion, shown for approval and capped by a per-community budget. They are the exception.

Layouts to handle (build a set of test files from real exports before trusting the engine): multi-row headings, a tab
per year, years across columns, subtotal and TOTAL rows, husband/wife/kids in one row, mixed date, amount and phone
styles, ambiguous dates, leading zeros, names in Gujarati or Hindi script, transliteration variants of the same
surname.

### Paper, PDFs and photos

Printed directories, sign-up sheets and ledgers are common in communities that have kept records on paper. **Under D2
a vision model cannot be used**, because a page of a directory often lists children. The plan:

- Read on **Weaver's own servers** with open-source OCR, then parse the text with the same recipe engine. No AI service
  sees the image.
- Lines that look like a child's name or age are kept out of anything Niva is shown; a person types them or loads them
  from a spreadsheet.
- Every part read with less than 90% confidence is marked and shown beside the photo; a person picks the right value.
- Printed lists first. Handwriting is best effort and the screen says so. Decision OB2.

### What Niva is shown, and what it never is (D2)

| Shown to Niva | Never shown to Niva |
|---|---|
| Column headings; a few values with names, digits and dates masked (existing `mask.ts`) | Any value in a column that looks like children's data (names, ages, dates of birth, school, "Kids", "Child", "Son", "Daughter") |
| Short lists of repeated category values (Yes/No, fund codes) | Any row for a person under 18 |
| Counts and shapes ("4,812 rows, 7 sheets") | Photos, PDFs, and the text read from them |
| Adults' first names when matching households, and nothing about their children | Keys, tokens, one-time links |

A test must fail if any AI input builder lets a child's name through. See "Found while checking".

## Niva through the whole flow

| Moment | Niva does | The person keeps | Guardrail |
|---|---|---|---|
| Sign-up | Drafts the plan from the answers; autofills the profile from the website and public records | Confirming each fact | Shows the source of each fact |
| Front door | Recognises each file or connection | Choosing where it goes | Says what it thinks and how sure |
| Templates | Part-fills tabs; explains each mistake once | Filling in and uploading | Never edits the person's file |
| Connect | Explains where to find a key; reads the error and says the fix; counts what is there | Pasting the key | Never sees a key |
| Files | Writes the recipe; asks two or three questions | Answering; skipping steps | Code runs it; every step has a reason |
| Matching | Finds look-alikes; shows evidence on household cards; offers "same answer for the other 14" | Merge or keep separate | Never joins on a name alone; adults only |
| Review | Adds up totals to the cent, explains differences (two checks deposited in January), finds gifts in two sources | Confirming | Nothing saved until Confirm; undo for 30 days |
| After | Drafts the family message in English, Gujarati and Hindi; lists what is thin; chases the slow steps | Sending | Texts only to people who agreed |

Niva here is the same Niva as in [ADMIN_REDESIGN.md](ADMIN_REDESIGN.md) (decision D1). Today's AI import jobs run in
the background service on masked input and cannot write, which is safe for the recipe reader. The **conversation
layer** (Niva in a side panel, answering questions about the person's own state) needs the portal-side request path
and command layer of B79 and B83 first. So: the first release shows "suggested by Niva" cards inside ordinary screens;
the conversation follows with Niva for admins.

## Other ways to reduce the burden

The owner asked what else would help. Effort: **S** a screen or one job; **M** a feature across screens, database and
the worker; **L** a new subsystem or an outside dependency.

| # | Idea | Why it reduces friction | Effort |
|---|---|---|---|
| 1 | **One front door that recognises** | No decision paralysis; the customer never picks the wrong path | M |
| 2 | **Source presets**: a mapping already built for each known export (Neon, QuickBooks reports, Zeffy, PayPal, bank, Mailchimp, Eventbrite, Google Contacts, Wild Apricot, Bloomerang, DonorPerfect) | The 50th customer with a Neon export is done in minutes. Improve presets from approved mappings by storing column headings only, never values, and only if the customer agrees (OB7) | M |
| 3 | **Autofill the organization profile** from the website and public records (the IRS lookup is already gap G8), and the map pin | Removes the typing in Setup Step 0 | M |
| 4 | **Helper links**: a time-limited link that opens one step or tab for the treasurer, the membership coordinator, the IT person, or whoever holds a login | The person onboarding is rarely the person who has the data or the password. Scoped, expiring, code-verified, audited | M |
| 5 | **Right-size the move**: 7 years of giving as rows, older years as one total per household; archive dormant records; start with people and giving, add modules later | Fewer rows, fewer questions, faster to value (existing O10) | S |
| 6 | **Parallel run** with a nightly refresh and a cutover checklist | Removes the fear of switching; the customer tries Weaver on real data without stopping the old system | L |
| 7 | **Families check their own records** and give permission | The fastest data cleaning there is, and the only legal source of email and text consent. It is the member side of B26 | M |
| 8 | **Reconcile with proof**: totals to the cent, the same gift found in two sources loaded once, QuickBooks deposits as a cross-check | Trust. The customer sees why, not just a number | M |
| 9 | **Paper reader** (D2-safe, printed first) | Opens the door for communities with no digital records | L |
| 10 | **Starter packs by kind of organization**, and **copy the setup of a consenting peer** (settings only, never data) | Nobody starts from a blank page. Ties to the Marketplace starter pack | M |
| 11 | **Start the slow things on day one** (Stripe verification, text registration, email DNS) and help with the DNS records | The calendar, not the customer, is the long pole. A "send the records to my IT person" button | S |
| 12 | **A done-with-you lane**: the customer sends files, the Weaver team prepares them with the same tools, the customer approves | For customers who want to hand it over. Uses support access that exists | S (process) |
| 13 | **Trust features**: dry run, undo for 30 days, read-only connectors, pull once and forget the key, a plain "what we ask and why" page | Lowers the fear that slows people down | S |
| 14 | **Gujarati and Hindi** for Niva and the invitations, and name matching that knows transliteration variants | The customer's own language, and fewer false "different people" | M |
| 15 | **Measure the funnel** (time per step, where people stop, how often Niva's suggestion is accepted) | Finds the next friction without asking | S |

## The 60-minute promise (B76)

B76 leaves the terms of "onboarded in 60 minutes" open. This design makes a defensible version possible if the clock
counts the customer's **active** time and excludes waiting on outside parties. A proposal for the owner:

| Minutes | What happens |
|---|---|
| 0 to 5 | Sign in, confirm the autofilled profile |
| 5 to 15 | Drop files or connect a system; Niva recognises them |
| 15 to 35 | Niva reads them; the person answers a handful of questions |
| 35 to 45 | Review totals and doubtful households; confirm |
| 45 to 60 | Invite a pilot group; second administrator signs in; first event published |

Stripe verification, text-message registration, email DNS and family replies take days. They run in the background and
must not count, or the promise cannot be kept. Decision OB5.

## Build sketch (for later; no migrations here)

- **Database**: `import_recipes` (versioned steps, source fingerprint, owner), `connector_pulls` (cursor, counts, state)
  beside `import_runs`, `onboarding_plan` (the intake answers and the routed steps), `helper_invites` (scope, expiry,
  verified identity, audit). Presets are recipes with no owner.
- **Worker**: a recipe reader job built on `import.suggest_mapping`; connector pull jobs patterned on `qbo.pull_*`; an
  OCR job. All on the background service, on masked or child-free input, none with write access to people or money.
- **Portal**: the front door, the starter workbook generator, the recipe screen, the review screen.
- **Not touched**: money rules, RLS, deletion. Helper links and the family check add new access paths, so they need
  the owner's approval before merge (CLAUDE.md).
- **Tests**: golden files for every preset and the messy-layout set; a test that fails if a child's name appears in any
  AI input; totals-to-the-cent checks.

## Phases

| Phase | What | Depends on |
|---|---|---|
| **1 Front door and files** | Front door and plan; starter workbook; the recipe reader on top of `import.suggest_mapping` with child-aware masking; presets for Neon, QuickBooks reports, Zeffy, PayPal and Google Contacts exports; totals check with cross-source gift dedupe; trust features; helper links v1 | Nothing outside the repo |
| **2 Connect** | Connector framework; Neon first, then Zeffy and Google Sheets; QuickBooks shown in the same flow; "pull once" and nightly refresh; cutover checklist | Vendor terms (OB9); a Neon test account |
| **3 Reach** | Paper reader; families check their own records and give permission (with B26); profile autofill; starter packs and peer copy; DNS help | D2-safe OCR choice (OB2) |
| **4 Conversation** | Niva beside the whole flow, answering questions about the customer's own state | B79, B83 |

Phase 1 comes first because it has no vendor risk and covers most customers: a Neon CSV export through a preset gets
most of the value of the Neon connector. Phase 2 follows quickly for JSH, whose Neon cutover is open (DECISIONS).

## Decisions for the owner

| # | Question | Recommendation |
|---|---|---|
| OB1 | Order: files and presets first, or the Neon connector first? | Files and presets first (no vendor risk), Neon connector next |
| OB2 | Photos and PDFs under D2 | On-platform OCR, printed lists first, handwriting best effort; no vision model while D2 stands |
| OB3 | Default for connector keys | Pull once and forget; nightly refresh only when the customer chooses it |
| OB4 | Helper links for people without an account | Yes: scoped to one step or tab, 7 days, code by email or text, audited, can never see a key. Needs your approval before merge |
| OB5 | What counts toward "60 minutes" (B76) | The customer's active time; outside waits are excluded |
| OB6 | An AI allowance for onboarding per community | Reuse the idea in ADMIN_REDESIGN D7; set a number before phase 1 ships |
| OB7 | Improve presets from approved mappings | Opt-in, column headings only, never values |
| OB8 | Copy the setup of a consenting peer | Opt-in by the source community; settings only, never data |
| OB9 | Who checks the Neon and Zeffy terms and API facts | Technology officer, before phase 2 |
| OB10 | Do family corrections apply automatically? | Approve as a list at first; routine fields (address, birthday) apply automatically after the pilot; household membership and money never do |

## Found while checking

- **B85. The QuickBooks AI matching sends every household member's first name, including children.**
  `app.qbo_worker_ai_input` (migration 0243) builds `member_first_names` for each candidate household with no age
  filter, and `qbo.match_suggest_ai` sends it to the model. That contradicts D2. It needs its own change and a test.
- `import.suggest_mapping` masks values but sends short repeated lists unmasked (`isCategorical`) and every heading.
  A column of children's names that repeats is unlikely but possible. The recipe reader should exclude columns by
  heading and by value before any sample is built.
- ONBOARDING_PLAN G38 should be P1, as above.

## Risks

| Risk | Mitigation |
|---|---|
| The recipe is wrong and nobody notices | Plain-words recipe with evidence, preview of before and after, totals to the cent, undo for 30 days |
| A wrong household merge | Never on a name alone; adults only; ask when evidence disagrees; every merge reversible |
| A vendor changes or retires its API (Neon retired v1) | Versioned connectors; the file route always works as the fallback |
| Large histories are slow or hit rate limits | Resumable background pulls; sample first |
| AI cost grows with files | The model reads shapes, not rows; cache by file fingerprint; a per-community allowance |
| A key leaks | Vault, last four characters, step-up 2FA, pull once and forget, never in chat or email |
| OCR is poor on handwriting | Mark under 90%; printed first; say so on screen |

## The prototype

Source: [handoff/prototypes/onboarding-data/](handoff/prototypes/onboarding-data/) (reference only, like the other
prototypes; the files open in a claude.ai Design canvas, not on their own). It uses the admin redesign's top bar, rail,
logo palette and conversation layout, with Niva as the assistant. All people, households, amounts and counts are made up.

| Board | What it shows | Pretend |
|---|---|---|
| 1 One front door | Plan from sign-up answers; drop zone with recognition of four sample files; connector tiles; templates; helper cards; what Niva sees and never sees; three questions Niva answers | Recognition, the plan, and every answer |
| 2a Templates | Starter workbook (one file or separate CSVs, part-fill on or off), tabs in load order with upload and ordering warnings, column guide, a plain-words date check | Downloads and uploads |
| 2b Connect | QuickBooks, Neon, Zeffy, Google Sheets: what comes in, how to connect, pull once or keep in step, test, a failed attempt in plain words | All connections and counts |
| 2c Your own files | A spreadsheet read by Niva (what was found, the recipe with Skip, column matching with "what I was shown", two questions, before and after) and a photo read on Weaver's servers (low-confidence marks to resolve) | The reading and the recipe |
| 3 Review | Totals to the cent, gifts found in two sources, household cards with evidence and "same answer for the others", auto-linked list with undo, confirm | Matching and totals |
| 4 Ready | How complete the data is; asking families (audience, channel, language, message); keep Neon running; cutover checklist; slow steps; helpers | Sending, sync, statuses |
| Rail, TopBar | Copied from the admin prototype, with the community name changed | |
