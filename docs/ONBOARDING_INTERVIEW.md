# Onboarding interview: learning the organization first (plan, 2026-10-11)

Plan only, no screens or migrations. **Step 0** of the owner's sequence (2026-10-11): **0** this interview; **1** one
de-duplicated list of everyone (adults, children, old identifiers, household names, salutations; households only if the
organization has them); **2** one list of money (payments, pledges, dues, invoices) linked to a person or household as
the administrator set them up, QuickBooks offered here; **3** leaders, staff, volunteers. North star: one agent per
organization that knows its letter, spirit, data and people; this is its first lesson. Built for every organization:
options come from data (experiences catalog, community languages, country). Reads with ONBOARDING_REDESIGN.md,
ONBOARDING_PLAN.md (Step 0), ORGANIZATION_CATEGORIES_PLAN.md (kinds, C18) and MASTER_PLAN_2026-10-10.md.

## 1. Purpose and principles

**Purpose.** Before anyone uploads a file, Weaver learns who the organization is: what it is for, how it is governed,
who its members are, where its records live and what it wants in 90 days. The answers choose the onboarding plan (which
steps, in which order, with which tools) and become the first entries of the organization memory (§5).

**Principles.** Conversational: one question per card, in the kind's words and Niva's voice, over a plain form that
works with AI off. Adaptive: answers add, skip or reword later cards (a club of 40 sees about 15, a temple with a school
about 35). Shortest path: ask only what changes the plan or a setting now. Never ask what we can find: website, access
request and documents answer first; the person confirms. Every answer shows what it changes ("So we will skip
households"). Pause and resume after every answer (`onboarding_progress`, 0545, version-checked). Plain English, "Skip
for now" on every card, the community's languages. Any kind, faith or none, country, currency, calendar or language.

## 2. The interview script

Types: **open**, **single**, **multi** (closed), **link**, **upload**. "Fills": an existing field or setting, **memory**
(§5) or **plan** (`onboarding_plan`, redesign build sketch). Parts B and C run while the crawl reads, never a spinner.

### Part A: Start with your website (always first)

| Id | Wording | Type | Options | Asked | Fills | Pre-filled from |
|---|---|---|---|---|---|---|
| S1 | "What is your website's address?" | link | "We don't have one" | Always, first | `org_profiles.website`; starts the crawl | `access_requests.website` |
| S2 | "Where else can people find you online?" | link, multi | Setup's social list (Facebook, Instagram, YouTube, WhatsApp channel, X) plus LinkedIn, other | Always | `org_profiles.social` | crawl social links, JSON-LD `sameAs` |
| S3 | "Any other page we should read? A donation page, a calendar, a school site, a folder of public papers" | link, multi | | Always, optional | memory (sources) | donate links, calendar embeds |
| S4 | "What we found": one card per fact, Right / Fix / Not us, with the page it came from | single per fact | Right, Fix, Not us | When the crawl finishes | name and short name (`centers`), about, public email and phone, address and map pin, languages (`org_profiles`), logo and colors (Brand kit: logos copied into `branding`, never linked), events (drafts), leadership and membership pages (memory, for step 3 and Q7) | the crawl report: pages by kind (home, about, events, calendar, donate, contact, school, leadership, membership, news), contact, palette, fonts, logo candidates |

No website: S2, then the Profile's name, address and contact fields as questions. Nothing in S4 is saved until confirmed.

### Part B: The documents that describe you

Each row is a **link or upload** with "Skip for now". Files the site links to are offered first ("We found Bylaws.pdf on
your site: use it?"), a small crawler addition (the crawl counts skipped files but keeps no names).

| Id | Document | Asked | Why we ask | What we learn, and where it goes |
|---|---|---|---|---|
| F1 | Charter or articles of incorporation | Always | Who you legally are | legal name, date, purpose clause (`org_profiles.legal_name`, `entity_type`, `incorporation_state`; memory: letter) |
| F2 | Constitution | Always | Founding rules and spirit | purpose, values, who may be a member, governing bodies (memory: letter and spirit) |
| F3 | Bylaws | Always | How you run | membership classes and rights, officer titles and terms, election month, quorum, voting wait (drafts for `membership_types`, `org_leaders` at step 3) |
| F4 | Policies (conduct, safeguarding, privacy, refunds, photos) | Always | What must never be broken | guardrails for Niva and the website, consent defaults, child login age (memory: rules; Settings drafts) |
| F5 | Annual report | Always | Size, programs, money at a glance | programs, member and donor counts, funds, fiscal year (`fiscal_year_start_month` suggestion) |
| F6 | Two or three recent newsletters | Always | How you sound | tone, salutations, languages, recurring events (memory: spirit) |
| F7 | Strategic plan | Always | Where you are going | priorities that order the plan; the 90-day goal (memory: beyond) |
| F8 | Membership rules or application form | Only if membership is formal (Q7) | Who counts as a member | types, references, approvals, family rules (`membership_types` drafts: `includes_spouse`, `reference_required`, `period_months`) |
| F9 | Fee schedule (dues, tuition, tickets, rentals, sponsorships) | Only if dues, fees or a school | What people pay | amounts in cents and periods: drafts only, money rules need the owner's OK before any is saved |
| F10 | Org chart or committee list | Always | Who decides what | committees, roles, reporting lines (step 3 drafts; adults only) |
| F11 | Event or festival calendar | Only if events are on | Your year | recurring events, seasons (draft events, calendar layers) |
| F12 | Tax-exempt letter or charity registration | Only if registered (Q3) | Proof for go-live | `org_documents.kind` `determination_letter` or `group_exemption` (Step 0.2; IRS check in the US only) |

Last card: F13 "Anything else that explains you" (memory). **Stored and seen.** Uploads go to the private
`org-documents` bucket (0184: path under the community's id, 10 MB, PDF/PNG/JPEG today, scanned by 0589), one
`org_documents` row each; its `kind` list needs the new kinds (charter, constitution, bylaws, policy, annual_report,
newsletter, strategic_plan, membership_rules, fee_schedule, org_chart, calendar) and a link form (address plus the text
read that day, kept so each file is read once). Readers today: the owner and Weaver platform admins (owner question 1).

### Part C: Quick questions (closed; never a child's name or detail, only counts and how records are kept)

| Id | Wording | Type | Options | Asked | Fills | Pre-filled from |
|---|---|---|---|---|---|---|
| Q1 | "What kind of organization are you?" | single, two steps | active experiences (`app.list_experiences`: faith-based, tradition family, experience; chamber; community organization) | Always (confirm) | `centers.category_key` (Weaver confirms a change) | access request `requested_category`, `experience_key`, `org_detail` |
| Q2 | The kind's `path_label` question | single | the kind's `category_paths` | Only if the kind has paths | `centers.tradition` (community default) | site words |
| Q3 | "How are you set up legally?" | single | house of worship, public charity, private foundation, part of a group exemption, other exempt, not registered, other | Always | `org_profiles.entity_type` | F1, F5 |
| Q4 | "Country, currency, time zone" | single each | standard lists | Always (confirm) | `centers.country`, `currency`, `time_zone` | address from the crawl |
| Q5 | "When does your financial year start? Which languages do members use, most used first?" | single; multi | months; any language | Always | `org_profiles.fiscal_year_start_month`, `languages` | F5; crawl languages |
| Q6 | "Who are your members?" | multi | individuals, families or households, businesses or organizations | Always | plan; `member_structure` setting (owner question 8) | site, access request |
| Q7 | "What makes someone a member?" | single + open | pays dues, a family pays dues, registers or attends, a business joins, gives, no formal membership | Always | memory; `membership_types` drafts | F3, F8, membership page |
| Q8 | "Your membership types and dues" | small table | name, amount, period, paid by person, household or business | Only if dues (Q7) | `membership_types` drafts (owner OK before save) | F8, F9 |
| Q9 | "How many?" | single each | people: under 100, 100–500, 500–2,000, 2,000–10,000, more; households or businesses: same; years of records: none, 1–2, 3–5, 6–10, more | Always | plan (time estimate, sandbox limits) | `approx_households` |
| Q10 | The data grid: "For each kind of record, where does it live, and do you want it in Weaver?" | grid, multi per row, plus now / later / no | rows: members, children or learners, donations, pledges, dues, invoices, events, volunteers, leaders, staff, store, other; columns: Zeffy, Wild Apricot, Neon, Bloomerang, DonorPerfect, QuickBooks, Sage, Xero, Excel or Sheets, paper, custom, nothing | Always; rows only for modules the kind offers | plan (a route per row) | `current_systems`, `modules_interested` |
| Q11 | "Which accounting system do you use?" | single | QuickBooks Online, QuickBooks Desktop, Xero, Sage, Wave, a spreadsheet, our accountant's, none | Always | plan (step 2 connection) | Q10, F5 |
| Q12 | "How do people pay you?" | multi | card online (Stripe, Square, PayPal, Zeffy), bank transfer or Zelle, cheque, cash, other | Only if Q10 has money rows | plan; payment setup | donate links |
| Q13 | "How do you reach members?" | multi | email (Mailchimp, Constant Contact, Gmail), WhatsApp groups, text, printed letters, social media, an app, other | Always | memory; Messages setup | crawl |
| Q14 | "Who is doing this, and who holds each kind of record?" | single + per Q10 row: me or someone else (name, email) | I lead alone, with staff, a volunteer leads, an outside helper | Always | plan helpers (helper links: Coming next) | the signed-in person |
| Q15 | "How do you keep children's records?" | single | inside each family, a separate class or school list, both | Only if Q10 children is not "nothing" | plan (learners step shape) | Q10 |
| Q16 | "We suggest these modules" | multi, pre-ticked | the kind's offered modules | Always (confirm) | Settings › Modules (Step 0.4) | kind defaults, Q10 |

### Part D: In your own words (open, always asked, each skippable)

| Id | Wording | Fills | AI drafts it from |
|---|---|---|---|
| O1 | "Why do you exist? One or two sentences." | `org_profiles.mission`; memory: spirit | about page, F2, F5 |
| O2 | "Who do you serve?" | `org_profiles.about`; memory | site, F5 |
| O3 | "How do people join, and how do they leave?" | memory; join and membership drafts | F3, F8, membership page |
| O4 | "Walk us through a normal year." | memory; draft events, calendar layers | F11, crawl events, F6 |
| O5 | "Which traditions or rules must we always respect? Food, dress, days, words, photos, privacy." | memory: guardrails (Niva, website, flyers) | F2, F4 |
| O6 | "How do you talk to members? Tone, languages, titles and salutations." | memory: tone; salutation list for list 1 | F6 |
| O7 | "What is hardest today?" | memory; plan order | |
| O8 | "In 90 days, what would make this a success?" | memory; plan goal, go-live target | F7 |

**Adaptive follow-ups** (code picks the rule from keywords and answers, at most five; Niva words them): a school or
classes → terms, levels, fees per level, how many learners and teachers · a board or elections → titles, term length,
election month (step 3) · festivals or holy days → which calendar (fixed, lunar, the tradition's own) and which events
repeat · sponsors → sponsorship levels and whether sponsors are members (C18).

## 3. Adaptivity: from answers to the plan

A pure function (`planFromInterview`) turns answers into the ordered plan. The AI never routes.

| Answer | What changes |
|---|---|
| Q6 individuals only | No household step; each person gets one invisible household behind the scenes (giving and matching still work); screens say "person", never "family" |
| Q6 families | List 1 carries household names, salutations, relationships; matching on household cards |
| Q6 businesses, or a mix | A household is the member business, its people are contacts, the card shows the business (C18), no personal path; a mix adds a member-type column to list 1 |
| Q7 no formal membership | No membership types, no dues step; the kind's words say "people" |
| Q11 QuickBooks Online | Step 2 opens with the QuickBooks connection (front-door tile, `qbo.bring_in_history`); Desktop, Xero, Sage: their exports via the recipe reader until connectors exist |
| Q10 a known system | That row uses its source preset (Neon, QuickBooks reports, Zeffy, PayPal, bank); Wild Apricot, Bloomerang, DonorPerfect: recipe reader, presets Coming next |
| Q10 Excel, Sheets, paper or nothing | Spreadsheets: the recipe reader, with the matching template beside it. Paper or nothing: a starter workbook from templates, a done-with-you session, the paper reader for printed lists |
| Q10 children, Q15; a school | A learners step inside list 1 (children with guardians; tier D hold in matching); the D2 onboarding card (§4). A school also suggests the school module on, with terms, levels and fees after list 1 |
| Q10 pledges, dues, invoices | List 2 includes them, each linked to a person or a household as Q6 says, in the kind's words |
| F3 read | Step 3 starts with officer titles and terms filled in; otherwise the kind's default roles |
| Q14 helpers | A helper link per record kind (Coming next); the plan shows who owes what |
| Q4 outside the US; Q5 languages | No EIN or IRS check, "other" legal form allowed, currency and dates from the country; drafts, messages and the website in the community's languages (`app.community_languages`) |
| Q9 under 100 people | Shortest route: one combined list, no bulk review screen |

**Three worked examples** (the resulting ordered plans):

| Step | A temple with a weekend school | A chamber of commerce | A small walking club, Excel only |
|---|---|---|---|
| 0 | Site, bylaws, fee schedule; families; children yes | Site, bylaws, dues schedule; businesses | Site; individuals; no documents |
| 1 | Families from Neon plus the school list from Sheets; learners step | Member businesses (household = business) with contacts from a Wild Apricot export | People from Excel; no households |
| 2 | Donations and pledges from QuickBooks (connection) and Neon, matched once | Dues invoices from QuickBooks; membership types from the dues schedule (owner OK) | Skipped: no money kept; offered later |
| 3 | Trustees and committees from the bylaws; teachers as staff; volunteers by interest | Board from the website; staff; committee volunteers | Two organisers as leaders; volunteers |
| Later | School terms and levels; festival calendar | Sponsorship levels; events | Events and a sign-up form |

## 4. How AI is used, and what code decides

| AI does | Code decides |
|---|---|
| Reads the crawl report and each document for the **letter** (purpose clause, membership classes, officer roles and terms, quorum, fees) and the **spirit** (values, traditions, tone, salutations, things never to do) | The output is a structured proposal checked against a schema; what fails is dropped, never guessed |
| Drafts follow-up questions and the wording of each card | Which questions fire, and how many (§2 Part D) |
| Writes "What we understood": one page, every fact with its source (page address, document and page, or answer) | Nothing is saved until the person confirms the fact or the page; their edits win |
| Suggests values (mission, languages, fiscal year, titles) | Every save goes through the existing setup functions; money and permission drafts wait for the owner's OK |

**Children: D2 and the owner's onboarding exception.** During onboarding only, the AI may see children's data in list 1
(matching learners to families, reading a school list), when all of this holds:
- a per-community setting `onboarding_children_ai`, **off by default**, is switched on by the administrator after accepting an acknowledgement (text version, who, when: audited), and only once the children's-data addendum (Step 0.7) exists and is accepted;
- it covers onboarding jobs only (recipe reader, matching, paper reader); the Niva chat, Niva for admins, the member guide and the organization memory keep D2: no child's data ever enters memory;
- each AI call carrying children's rows writes an audit entry (job, purpose, row count, model; never the values); the setting switches itself off when onboarding is marked done or after 30 days (owner question 4); the tests that fail when a child's name reaches an AI input stay, with one allowed path that checks the setting.

**Document text is data.** Site and document text is passed as quoted material, never instructions; the reader has no
tools and no write access; text addressed to an AI is ignored and shown to the person ("This page contains instructions
for an AI; we ignored them"). The crawler stays on the organization's site, obeys robots.txt; uploads are scanned first.

**Cost.** One crawl (again on request); each document read once per file hash, text and summary cached; prompt caching
on the stable reader prompt; a small model sorts, a larger one summarises; every call counted in `assistant_usage`
(0617) against a per-community onboarding allowance (an entitlement row, "reading left"); past it, no AI, still works.

## 5. The organization memory

One store per organization, never shared across organizations, never used to train a model. Every fact carries source,
confidence, state (suggested, confirmed, edited, rejected, stale), who confirmed it and when, and audience (staff, members).

| Layer | What is captured | Form | Source | Approval | Who may read | Used by |
|---|---|---|---|---|---|---|
| Letter | legal identity; membership classes and rights; officer roles, terms, elections; quorum; fees; policies | structured facts with citations, plus the document text | F1–F5, F8, F9, F12 | per fact; money facts need the owner | owner and settings managers; Niva for admins | profile, membership types, step 3, Niva for admins |
| Spirit | mission, values, traditions and rules to respect, tone, salutations, languages | short narrative plus a guardrail list | O1, O5, O6, F2, F6, site | the "What we understood" page | the same; members only what is marked for members | Niva member guide (draft sources through the existing approval queue), website draft, flyers, messages |
| Data | member structure, sizes, systems per record kind, money tools, modules, fiscal year, currency | fields (`centers`, `org_profiles`, plan) | Part C, crawl | per answer | setup access | steps 1–3, front-door plan card, readiness checklist |
| People | published leaders and committees, teachers, who holds which records | `org_leaders` drafts; helper list | leadership page, F3, F10, Q14 | at step 3 | setup access | step 3, statement signer, guide roster |
| Beyond | a normal year, what is hard, the 90-day goal, open questions | narrative plus draft events | O4, O7, O8, F7, F11 | the summary page | setup access | plan order, Niva for admins' "what next", website draft |

Never in memory: members' personal records (they stay in the records, under RLS), keys, children's data. **Retention**:
while the organization is a customer; a sandbox's memory goes with the sandbox unless promoted (owner question 5).
**Forget**: one fact, one document (file, text and every fact citing only it) or the whole memory (owner, step-up 2FA,
audited; records untouched). A new document version marks the old one's facts stale. Forgetting deletes data: owner OK.

## 6. Screens (look first, on fixtures)

All five use the merged front-door look (`src/components/onboarding-front/`: board container with `data-v2-tokens`,
steps rail, Niva's card, "Coming next" pills, never a fake success), before "Bring your data in" in Setup › Guided onboarding.

| # | Screen | Purpose | Reuses | Real in v1 | Coming next |
|---|---|---|---|---|---|
| 1 | Start with your website | S1–S3, and the no-website path | Setup › Website form and crawl status (`website-form.tsx`) | crawl, save to profile | |
| 2 | What we found | S4 cards with source chips; logo and colors preview | `found-report.tsx`, `src/lib/site-found.ts` | facts the crawler extracts | AI-read mission, leaders, membership rules |
| 3 | Your documents | Part B cards (why, what we learn), link or upload, found-on-site suggestions | `drop-zone.tsx`, the org-documents upload | upload and link storage | reading them |
| 4 | Questions | Parts C and D, one card at a time, the "what this changes" line, the data grid | `ask.tsx`, `parts.tsx` | answers saved, routing | Niva-drafted follow-ups |
| 5 | What we understood, and your plan | The summary to correct, then the ordered plan (steps 1–3) handed to the front door's plan card | `buildFrontDoor` plan card | the plan from code rules | the narrative summary |

## 7. Reuse, build order, open questions

| Exists | Where | Reused for |
|---|---|---|
| Site crawler and report; "What we found" | `worker/src/web/site/`, `worker/src/handlers/site.crawl.ts`; `src/app/(app)/setup/website/` | Part A, screens 1–2 |
| Niva page import and approval queue | `niva.discover_site`, `niva.import_page` (0576) | public spirit facts become draft member-guide sources |
| Profile, leaders, documents, storage; membership types | `org_profiles`, `org_leaders`, `org_documents` (0180); `org-documents` bucket (0184); scan (0589); `membership_types` (0002) | Parts B and C; Q8, F8, F9 drafts |
| Access request answers | `access_requests`, `app.submit_access_request` (0612) | S1, Q1, Q9, Q10 pre-fill |
| Kinds, words, paths; languages | experiences catalog (0600), `src/lib/kind.ts`; `app.community_languages` (0685) | Q1, Q2, every word; interview language |
| Save and resume; matching engine and exceptions inbox | `onboarding_progress` (0545); `import_*` tables (0630–0632) | pause and resume; steps 1–2 follow the plan (member structure, tiers) |
| Front door; AI usage; checklist | `src/lib/onboarding-front/`; `assistant_usage` (0617); `src/lib/setup.ts` | look and plan card; allowance; steps marked not applicable |

| # | Build piece | Size | Note |
|---|---|---|---|
| 1 | Pure core: question catalog, `planFromInterview`, golden tests (temple, chamber, non-faith club) | S | no I/O |
| 2 | The five screens on fixtures, "Coming next" where not wired | M | owner reviews the look |
| 3 | Migration: interview answers and plan, new `org_documents` kinds and links, `member_structure` | S | onboarding block 0633–0639 |
| 4 | Wire screens 1–2 to the crawl, 3 to storage, 4–5 to saves; LinkedIn in Setup's social list | M | |
| 5 | Worker reader job: crawl and documents to proposed facts with citations (cached, counted, child-free) | L | load `claude-api` first |
| 6 | Organization memory store, confirm and forget | M | NEEDS OWNER OK: deletes data, new read path |
| 7 | `onboarding_children_ai` setting and audit | S | NEEDS OWNER OK; after the children's addendum |
| 8 | Feeds: front-door plan card, Niva for admins, member-guide draft sources | M | |

**Open questions for the owner** (each with a recommendation):
1. **Who reads the documents?** Today the owner and Weaver only. *Recommend* owner and settings managers, plus a per-document "members may see this" flag for public papers.
2. **Where does the interview sit?** *Recommend* inside the sandbox as the first Setup step; the public request form stays short and only pre-fills it.
3. **Which file types?** *Recommend* PDF, images, Word and plain text (Word turned into text by the worker), 10 MB each.
4. **How long may the children's exception stay on?** *Recommend* until onboarding is marked done or 30 days, whichever is first; re-acknowledge to extend.
5. **Memory at promotion to production?** *Recommend* carry confirmed facts and documents; drop suggested and rejected.
6. **Onboarding AI allowance?** *Recommend* 40 document reads (up to 60 pages each) and 200 drafted questions per community; Weaver raises it on request.
7. **May Weaver staff read the memory to help?** *Recommend* only while the owner grants support access for a period, audited.
8. **Member structure as a lasting setting?** *Recommend* yes: `member_structure` (individuals, households, businesses, mix) read by People and Giving, so individuals-only never shows "family".

## 8. Decisions (owner, 2026-10-11: "approve all")

All eight recommendations above are accepted as written: (1) owner and settings managers read documents, plus a per-document "members may see this" flag; (2) the interview runs inside the sandbox as the first Setup step, the public request form stays short; (3) PDF, images, Word and plain text, 10 MB each; (4) the children's exception ends when onboarding is marked done or after 30 days; (5) at promotion only confirmed facts and documents carry over; (6) onboarding AI allowance of 40 document reads and 200 drafted questions per community; (7) Weaver staff read the memory only while the owner grants support access, audited; (8) `member_structure` is a lasting setting. The children's exception also stays off until the children's-data addendum exists. First build: the five screens of section 6, on fixtures, look first.
