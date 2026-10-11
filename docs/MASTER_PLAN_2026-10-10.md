# Master plan: the six priorities (owner, 2026-10-10)

Owner order: **1** data onboarding intelligence, **2** demo organizations, **3** member app by kind of organization and
faith, **4** admin redesign with Niva doing every action in chat, **5** record every action, then automate it,
**6** a personalised website drafted for each organization. Built first: **3, 4, 5**. Backlog rows: B87 to B92.

Most of this already has a plan. This document adds only what is missing, sets the build order and says how the work is
split across agents so that tokens are spent on building, not on re-reading.

| # | Priority | Existing plan (read it, do not redo it) | What this plan adds | Backlog | State |
|---|---|---|---|---|---|
| 1 | Data onboarding intelligence | [ONBOARDING_REDESIGN.md](ONBOARDING_REDESIGN.md) (B84) | The resolution engine and the exceptions inbox | B87 | Planned |
| 2 | Demo organizations (faith and non-faith) | B86 | Two demo communities, one demo person per role, role switcher | B88 | Planned |
| 3 | Member app by kind and faith, template driven | categories 0594, experiences 0600 | A template as data: home rows, tabs, theme, wording | B89 | **Building** |
| 4 | Admin redesign and Niva for admins | [ADMIN_REDESIGN.md](ADMIN_REDESIGN.md) (B78 to B83) | The command layer first, then chat that runs every action | B90 | **Building** |
| 5 | Record every action; automation pipeline | B77 (usage), audit log | One activity table, a miner, an "Automation ideas" screen | B91 | **Building** |
| 6 | Personalised website drafted automatically | B55, B61, B75 | Crawl, site model, draft from Weaver data, reference style | B92 | Planned |

## The idea that saves the most work: one command layer

Today there is no command abstraction: 85 files carry `"use server"`, 51 read `FormData` inline, the confirm step is
only in the browser, the portal never calls the model (only the background service does, without permission checks).
Build **one typed command per action** (`key`, `level` read / draft / confirm / only-you, `permission`, input schema,
`preview`, `execute`, confirm text). Then the same commands serve:

- **#4** the screens, the ⌘K palette and the chat (the model only chooses a command and fills its input);
- **#5** the recorder, because every command call is an activity event with its role, outcome and duration;
- **#1** the exceptions inbox, whose answers (merge, keep apart, set household) are commands;
- **#6** the website editor, whose edits are commands Niva can also run.

The ⌘K palette and every command work **without any AI key**; the model is only a natural-language front end. So the
feature is useful and testable (with a fake model client) before the owner supplies a key.

## How tokens are spent (rules for every agent)

1. **Read the existing plan, then write only the delta.** No agent re-researches what a doc already decides.
2. **Scout, then build.** A scout (Explore, sonnet) answers numbered questions in at most 450 words with file paths. A
   builder gets that answer, not the files.
3. **Briefs are one page**: goal, the files to touch, what is out of scope, the migration and test numbers it owns,
   the checks to run, the rules in CLAUDE.md. Reports are at most 250 words plus the PR address. Nothing is pasted back.
4. **One concern per pull request**, small enough to review in one pass. A stacked PR names its base.
5. **CI is the test runner** for the database (no local Postgres). Locally: typecheck, lint and the vitest files touched.
   No local `next build`.
6. **Independent review only where it pays**: money, permissions/RLS, deletes, child data. The reviewer gets the diff,
   not our conclusion.
7. **Decide, do not ask.** An agent uses the recommended default and records the choice. Anything that changes money,
   RLS or deletes is marked NEEDS OWNER OK in the PR and is not merged (CLAUDE.md).
8. **Disk guard.** The C: drive is nearly full. Worktrees under `C:/Work/wt` use a `node_modules` junction, no installs,
   delete caches and `dist` when done, and stop if free space is under 150 MB.
9. **Migration and test numbers are reserved per stream** (0601 to 0611 and 0615 belong to parked work):
   #4 0616 to 0619 (tests 97, 98) · #5 0620 to 0623 (tests 99, 100) · #3 0624 to 0626 (test 101) ·
   #2 packs 0627 to 0629 · #1 0630 to 0639 · #6 0640 to 0649.

## 1. Data onboarding intelligence (B84 plus B87)

[ONBOARDING_REDESIGN.md](ONBOARDING_REDESIGN.md) already covers the front door, three ways in (templates, connected
systems, the customer's own files), source presets, the recipe reader, connectors, the paper reader, helper links, the
60-minute promise and four phases. What it does not spell out is **what happens between "data arrived" and "data
committed"**: matching and exceptions. That is the part that decides how little work the customer does.

**Every source becomes staged records with provenance** (source, row, how sure), whatever its shape:

| Source | Examples | Reader |
|---|---|---|
| Structured | CSV and XLSX exports (Neon, Zeffy, Mailchimp, bank), Google Sheets and Contacts | Presets and the recipe reader |
| Connected | QuickBooks (built), Neon, Zeffy | Connector pulls, nightly or once |
| Unstructured | A photo or PDF of a printed directory, pasted text, e-mail threads, the old website's member pages, minutes | The on-platform reader (D2 safe), then the same pipeline |

**Eight stages, each with one owner (code or a person):**
1. *Recognize* what each file or connection is. 2. *Normalize* names (transliteration variants), phones, addresses.
3. *Link* to households and people already there and to each other (blocking keys, then scoring on identifiers
that are not names: phone, e-mail, address, family or Neon ID). 4. *Resolve by tier.* 5. *Ask* only the exceptions.
6. *Prove*: totals to the cent, the same gift found in two sources loaded once. 7. *Commit* with 30-day undo.
8. *Learn*: remember the decision as a rule.

**Tiers (a name alone never joins):**
- **A, automatic**: two or more independent identifiers agree and nothing conflicts. Applied, listed in the report.
- **B, review in bulk**: strong but not certain. One screen, sorted by evidence, "approve all" and per row.
- **C, ask**: weak or conflicting. Two household cards side by side, at most three answers, one plain sentence.
- **D, hold**: anyone under 18, and any money conflict. Never decided by code or the model.

**The exceptions inbox** is the new screen. Questions are **grouped by pattern** ("14 rows list a spouse under a
maiden name: same answer for all?") and ranked by value (money, then members, then contacts). Targets: under 10
questions per 1,000 rows, under 10 minutes in total. A question can be skipped, postponed or sent to the right person
with a helper link (the treasurer gets the money ones). Every answer is stored as a rule, so a nightly pull never asks
twice. Niva drafts each question in plain words; code decides, the person confirms.

**Measured**: share resolved automatically, questions per 1,000 rows, minutes to first value, how often a suggestion
is accepted. **Build**: pure scorer in TypeScript with golden test files first (no database), then `staged_records` and
`import_exceptions` tables, then the inbox, then Niva. Reuses `import_runs`, the matching pass (0545, 0548) and
`qbo.match_*`. Cross-links: B85 (children out of AI matching), D2, B76. Size: L, three pull requests per phase.

## 2. Demo organizations (B86 plus B88)

Two demo communities, never JSH data, reset nightly, built from the organization-kind packs:

- **Faith-based**: "Sunrise Jain Temple (Demo)", the deepest experience (Jain Way, Gyan Path, Pathshala, bolis, tithi).
- **Not faith-based**: "Lakeside Neighbors Club (Demo)", neutral wording, events, giving, directory, notices.
  (A chamber of commerce demo follows once its money wording is approved.)

Each has **one demo person for every role in the kind's role catalog** (administrator, treasurer, membership
coordinator, event lead, Pathshala principal and teacher for the faith one, content editor, member, guest), plus about
12 households and 30 people (adults and a few children), pledges and payments, events with RSVPs, a store, notices.
"Try the demo" on the website and in the app opens a **role switcher**: the server issues a session for that demo
user; no code, no real e-mail. Guardrails as in B86: demo users see only the demo community, texts and e-mails to them
are blocked, payments in test mode, rate limited, one switch to turn it off. Build in three pull requests: (1) the pack
content as data, (2) the session endpoint, role switcher and guardrails (authentication and RLS: **needs owner OK**),
(3) the buttons. Depends on #3 (so the demo shows each look) and #4 (so the demo shows Niva).

## 3. Member app by kind and faith, template driven (B89) building

Facts (scout, 2026-10-10): the app already reads `app.category_profile` (0594) and caches it per community; wording
overlays exist (English only); Home is the fixed list `HOME_ROWS`; the five tabs are fixed (`nav-bar.ts`); the theme is
the brand kit palette only. `member_experience` (0600) exists in the database but the app does not call it.

**Design: a template is data, resolved on the server, applied without an app update.**
`template = { home: { rows: [ids], today: variant }, tabs: [keys, labels, icons], theme: { accent, surface, radius,
motif }, widgets: { id: options } }`, stored on `organization_categories` and refined per tradition on
`category_paths`, then overridden per community by what the administrator sets up (`rules.home`). The server merges
the three layers and returns the result inside `category_profile` (and `member_experience`). The database validates the
shape only; **the app ignores ids it does not know** (forward compatible, so a new template never breaks an old app).
The app holds a **widget registry** (row id to component) and renders what the template lists; with no template it
renders the built-in order, so **JSH stays identical** (a golden test compares the two). Tabs can be reordered,
hidden, renamed and re-iconed among existing routes; a brand-new route still needs an app release. Refresh on
foreground and a cached copy mean no flash of the wrong layout.

Starter templates: Jain temple (today's layout), neutral community club, chamber of commerce, and faith overlays that
swap the faith widgets (Jain Way and tithi; scripture and service times; prayer times; panchang and aarti) while the
shared widgets stay. Content for a new faith comes from library packs, not code. Open PR connect-mobile #81 (wording
and swaps for three kinds) is stale and waits for the owner on chamber money wording; this work does not depend on it.
Pull requests: DB (0624, test 101) then mobile (renderer, registry, theme, golden test, 1.16.0, OTA to preview).
Later: an administrator screen to reorder rows (Settings › Member app).

## 4. Admin redesign with Niva doing every action in chat (B90) building

[ADMIN_REDESIGN.md](ADMIN_REDESIGN.md) decides the 11 workspaces, the four levels, the rules and the phases. The
prototype shows the workspaces; the part to make real now is the **conversation**. Scout facts: the shell is `AppShell`
(60 px bar, 220 px sidebar, `NAV` of 15 entries in `permissions.ts`); no palette; the portal never calls the model;
the worker's key comes from Platform › Setup; `audit_clean_app` allows portal, member, kiosk, job, import.

Pull requests, in order (each one useful alone, all behind a flag so staff see nothing until switched on):
- **A1 database (0616 to 0618, test 97, 98)**: `assistant` accepted as `client_app`; `assistant_proposals`
  (propose, confirm, execute; one-time, bound to the person, expiring, input hash); a monthly usage limit per
  community (D7); 30-day conversation retention. **Needs owner OK** (audit, RLS).
- **A2 command layer**: the registry, `runCommand`, the child filter (D2) with a test that fails if a child's name
  reaches a result, secret stripping, and a coverage script that lists Server Actions not yet commands. First
  commands: read (people search with household cards, my tasks, upcoming events, who is behind on pledges, month-close
  blockers), draft (reminder in three languages, event change), confirm-level writes registered but **off until the
  owner approves each**.
- **A3 the assistant route**: portal server, the person's own session, a tool allowlist, a step limit, the rules from
  ADMIN_REDESIGN, usage limit, plain-English errors, a fake client in tests. Without a key it says so and the palette
  still works.
- **A4 the interface**: Niva side panel beside the work, ⌘K palette, "Ask Niva" on a row, confirmation cards (what
  will happen, household cards, dollars), the security code in its own window.
- **A5 shell v2** (after A4): 88 px rail, 64 px bar, the logo palette (B81), phone bottom bar, a per-person "New look"
  switch. **A6 Today and Routines** (B80) and **phase 4**, one workspace per pull request using one recipe
  (move the screens' actions onto commands, add the workspace's Niva tools, retire the old screens), Giving, People,
  Events first (D8). Phase 4 is a long programme; this session delivers A1 to A4.

## 5. Record every action, then automate it (B91, absorbs B77) building

Today only table writes are audited (`audit_log`, hash chained); reads, screens, denied attempts and the member app
leave nothing. Build **one activity stream** for both surfaces.

- **Allowlist by construction**: `activity_catalog` lists every action and screen key (`giving.record_payment`,
  `screen:/events/[id]`). Unknown keys are dropped. No free text and no values are ever stored: an event is who
  (pseudonymous), role(s) at the time, key, entity kind and id, outcome, error code, duration, how (screen, palette,
  assistant), sequence in the session, app version and platform. Under-18 and learner accounts record nothing.
- **Capture**: portal, in the command layer (so every command is recorded for free), in the shared `runAction`
  helpers and `authorizeAction` for older actions, and a screen beacon in `AppShell`. Member app: a small batched
  logger, a Profile › Privacy switch, flush when the app goes to the background.
- **Store**: `activity_events` (insert only through `record_activity`, which takes the person and community from the
  sign-in, never from the client), 400-day retention. Raw rows are readable by Weaver staff only; administrators see
  summaries.
- **Pipeline**: a daily job `activity.mine` splits events into sessions (30 minutes idle), finds repeated sequences of
  2 to 5 actions by role, and scores them (how often × minutes saved × how regular − error rate), proposing what to
  build: a routine step (B80), a Niva command or macro, a playbook (B73), a scheduled job, or a default value.
- **Surface**: Settings › Automation ideas (accept, dismiss, "build it") and Platform › Automation backlog (counts
  across communities that agreed, keys only). Later, Niva offers it in context ("You do these two together every
  Monday. Shall I?").
- **Owner decisions**: member-app tracking as a notice with an opt-out (recommended) or consent; retention; whether
  Weaver staff may see cross-community counts. Needs owner OK for the table, RLS and the member-app notice.

## 6. Personalised website drafted automatically (B92, builds on B55, B61, B75)

Input at onboarding: the current website address, up to three reference sites the organization likes, the brand kit,
social links. Steps: (1) **crawl** with the existing page reader (robots.txt honoured, sitemap discovery from B20) and
produce a "what we found" report; (2) **extract** pages, menu, text sections, logo, colours and fonts, and classify
pages (about, events, give, contact, school); (3) **site model**: pages made of blocks in the B55 shape; (4) **draft**
from Weaver's own data (events, giving, store, calendar, leaders) plus the old site's text, rewritten by Niva and
shown with its source; (5) **reference style**: borrow layout patterns and palette only, never text or images (copyright),
mapped to a template for the organization's kind and faith (shares tokens with #3); (6) preview on a private draft
address, the administrator approves page by page; (7) publish, custom domain, forms, search-engine basics. Photos need
a licence check. Shares the crawler and "autofill the profile" with #1. Size: L, five phases W1 to W5 (crawler and
report first, no database writes beyond drafts).

## Agent roster and waves

| Role | Type | Model | Gets | Returns |
|---|---|---|---|---|
| Scout | Explore, read only | sonnet | numbered questions | at most 450 words, paths |
| Builder | general-purpose, own worktree and branch | sonnet | one-page brief and the scout's answer | at most 250 words plus the PR |
| Reviewer | fresh agent, read only | sonnet | the diff and the rule it checks | findings, no praise |
| Coordinator | this session | | merges, syncs types, OTA | the state in the backlog |

**Wave 1 (now, in parallel):** template database and mobile (#3), assistant database and command layer (#4 A1, A2),
recorder database and capture (#5). **Wave 2:** assistant route and interface (A3, A4); miner and Automation ideas
screen; member-app logger. **Wave 3:** shell v2, Today and Routines, then #2 and #1 (both use the command layer and
the templates). #6 follows #1's crawler.
After each merge: wait for the Deploy, check the app answers, copy regenerated types to connect-admin and
connect-mobile, publish the OTA (CLAUDE.md, release routine).
