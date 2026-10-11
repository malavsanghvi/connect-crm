# One unified command box (plan)

Status: plan, 2026-10-11. Owner directive (2026-10-11): one common text box at the top of every page; the backend works out the best course of action; nobody hunts for the right box. Built for every organization Weaver onboards (any kind, any faith or none, any language): behaviour comes from data (kind and its wording terms, the community's modules, languages and switches), never from one community. The Bhandar tab is parked separately and out of scope.

## 1. Principle and what the person sees

- **One box** in the top bar of every page (New look first) and an **Ask** item in the phone's bottom bar that opens the same box as a sheet. **One shortcut**: Ctrl+K / ⌘K (the palette's key today); Ctrl+J / ⌘J keeps opening Niva's panel.
- The person types in their own words: a name, any ID, a page, a task, a filter, a question.
- The box answers with **one line "I understood: …"**, **one best action** (a large row), then alternatives grouped below.
- **Nothing that changes data runs from the box.** Draft and confirm commands open the existing confirmation (Niva's ProposalCard, or the screen's own form prefilled). Enter acts at once only for a look-only result the router is sure of.
- Same behaviour on every page; the page adds context (it raises matching results, never hides others).

| Decision | Why |
|---|---|
| The box is for every signed-in person, not only where Niva is on; stages a-d run with the person's own permissions (`via: "palette"`) | Today `/api/assistant/commands` answers an empty list when Niva is off (`src/app/api/assistant/commands/route.ts`), so the palette vanishes, and the top-bar search shows only with `households.search` (`src/components/shell/shell-v2.tsx`). One box cannot depend on either. |
| AI is stage e only, plus low-confidence cases | Works with no key; cost; D2 is easier to keep at one door. |
| One server route streams candidates; the client also ranks pages and commands it already holds | Instant first results; records need the database. |
| Writes always go through the existing card | One confirmation path (`runCommand` proposals, `src/lib/commands/run.ts`); no new money or permission rule. |

## 2. The intent router (backend)

An ordered pipeline. Every stage is a pure function over injected sources, so it is golden-tested without a database. All stages run (cheap), then one ranking step orders the union; the order below breaks ties.

| Stage | Reads | Source to reuse | Candidate | Highest confidence |
|---|---|---|---|---|
| a. Identifiers | number, alphanumeric ID with a digit, e-mail, phone, ALL-CAPS or quoted payer name, then name words | `searchHouseholds` + `app.resolve_identifier` (`src/lib/data/search.ts`, any identifier, pads "417" to "0417"); people part of `globalSearchAction` (`src/app/(app)/search/actions.ts`); row shape from `mapGlobalSearch` (`src/lib/global-search.ts`); `foldName` (`src/lib/commands/name-fold.ts`) for many scripts | `record` (household with its `household_card` line, or person) | exact single ID 0.95; same ID on several 0.7; name only 0.6 one / 0.5 several, never "sure" |
| b. Navigation | "payments", "go to events", a kind term ("Sunday school") | `navEntries` + `scoreText` (`src/lib/assistant/palette.ts`) over the person's visible nav (permissions + modules) | `page` | exact label or "go to X" 0.92 |
| c. Commands | catalog titles and descriptions worded with `describe(text, kind)` (`src/lib/commands/text.ts`) + slot extractors | `listCommands(session, "palette")` (`src/lib/commands/registry.ts`), `commandAvailability` (`enabled.ts`), `buildRunInput` for the tiny form | `command` with prefilled input and missing slots | extractor trigger + 2 slots 0.88; title only 0.5-0.8 |
| d. Filters | a sentence the current (or named) list understands | filter extractors: People `readAsk` (`src/lib/people-v2/ask.ts`); Payments (`method`, `from`, `to`, `household` params) in slice 2 | `filter` (page address + chips) | 1+ structured filters 0.85, +0.05 on that page |
| e. Question or unsure | a question, or nothing above 0.5 | Niva's chat (`src/lib/assistant/chat.ts`, `/api/assistant/chat`) when on and `aiReady`; else the fallback | `answer` | model answer shown first when a-d are below 0.5 |

**Slot extractors.** Each workspace registers one; the router never knows a workspace's grammar.

```ts
type ExtractCtx = { kind: CommandKind; languages: string[]; today: string; page: RouteContext; vocab: Record<string, unknown> };
type Extraction = {
  target: { kind: "command"; key: string; input: Record<string, unknown> } | { kind: "filter"; href: string; chips: string[] };
  understood: string;      // "a $250 check from household 1042, received Sunday"
  slots: number;           // how many slots were read (drives confidence)
  missing: string[];       // field names still to ask for, shown in the tiny form
};
type SlotExtractor = {
  id: string;              // "people.filters", "giving.payment"
  area: string;            // boosts on that workspace's pages
  vocab?: (s: CrmSession) => Promise<Record<string, unknown>>; // zones, events, funds: loaded once per request
  read(text: string, ctx: ExtractCtx): Extraction | null;      // pure; null when its trigger words are absent
};
```

**Response contract** (`src/lib/box/types.ts`):

```ts
type BoxRequest = { text: string; path: string; selection?: { kind: string; id: string }; recent?: string[] };
type Candidate = {
  id: string; kind: "record" | "page" | "command" | "filter" | "answer";
  title: string; detail?: string;          // records: the household_card line, never a name alone
  why: string;                             // "Household number 1042", "Matches the page Giving › Payments"
  confidence: number;                      // 0..1
  action: { type: "open"; href: string } | { type: "run"; key: string; input: object }
        | { type: "form"; key: string; input: object; missing: string[] } | { type: "ask_niva"; text: string };
  permission: AccessKey | null; level?: CommandLevel; needsConfirmation: boolean;   // true for draft and confirm
  stage: "a" | "b" | "c" | "d" | "e" | "fallback";
};
type BoxResponse = { ok: true; understood: string; band: "sure" | "likely" | "unsure"; candidates: Candidate[];
  ai: "off" | "no_key" | "pending" | "answered" | "capped" | "failed"; decisionId: string } | { ok: false; error: string };
```

**Ranking and Enter.** Score = stage confidence + context boosts, capped at 1. Ties: stage order a-e.

| Band | When | Enter does |
|---|---|---|
| Sure | top >= 0.85 and >= 0.15 ahead of the next | look-only (page, filter, record by ID, read command): acts at once. Draft/confirm: opens its card or form. |
| Likely | top 0.5-0.85 | if the list was not yet on screen, shows it with the top highlighted; a second Enter acts. No AI call. |
| Unsure | top < 0.5, or a question with no Sure candidate | Niva first when on (Enter asks Niva); else the honest fallback: "I could not match that…" + 3 things this page can do. |

A household matched by name alone is capped at 0.8 and is chosen only from rows that show its card.

| Context signal | Effect |
|---|---|
| Current page area (`areaForPath`, `src/lib/assistant/context.ts`) | +0.1 to candidates of that area |
| Selected record (`routeContext` entityKind/entityId) | fills a household or person slot ("record a payment" on a household page) |
| This person's last 5 choices | +0.05 to the same command or page |
| Role, permissions, modules | gate only: a candidate the person cannot use is never offered |

- **Gating**: commands through `commandAvailability(…, "palette")`: `screenOnly` stays screen-only, `requiresOwnerSwitch` money commands stay hidden while off, `platformOnly` only for the Weaver team. Pages from the visible nav only. If the only match is in an area the person cannot open, the box says "That is in an area you don't have access to." and offers nothing.
- **Wording**: every title and example through kind terms (`describe`, `KindProfile.terms`, `src/lib/kind.ts`); "pledge", never "bid"; placeholder and fallback text kind-neutral.
- **Languages**: stage a is language-free (IDs, numbers, folded names in any script). Stages b-d match the interface language; input in another of the community's languages (`communityLanguages`, `src/lib/languages.ts`) falls to stage e, which is told those languages. No fixed language list.
- **D2**: before any text reaches stage e, the typed text and every candidate sent as context pass `filterChildren` with `databaseMinorNames` (`src/lib/commands/child-filter.ts`); household cards for the model are adults only (`src/lib/commands/catalog/household.ts`). A record candidate for a child is shown to permitted staff on screen, never sent.

## 3. Where it runs

| Concern | Decision |
|---|---|
| Endpoint | `POST /api/box` (`src/app/api/box/route.ts`), NDJSON stream (reuse `src/lib/assistant/ndjson.ts`): line 1 stages a-d, line 2 the AI answer if asked. A route, not a Server Action: it streams and is cancelled per keystroke (AbortController), like the assistant routes. |
| Latency | Client ranks pages and commands it already holds in under 16 ms per key. Server a-d: p95 300 ms after a 200 ms pause, 2+ characters (`GLOBAL_SEARCH_MIN_CHARS`). AI first words within 2.5 s, with Stop. |
| Caching | Catalog and nav cached in the client per session; extractor vocab loaded once per request; records never cached; AI system prompt and tool list with `cache_control` (`src/lib/assistant/anthropic-http.ts`), read `cache_read_input_tokens`. |
| Rate and cost | 60 box calls a minute per person; AI only for stage e or Unsure, at most 10 a minute per person, counted against the community's monthly Niva limit (`UsageStatus`, `src/lib/assistant/store.ts`); "capped" shown plainly. |
| Observability | One activity event per choice: key `box.choose`, via `palette` (no new `ACTIVITY_VIAS` value), with the chosen stage, kind, rank, band, AI used, command key or page area, duration, `decisionId`. Never the typed text. A choice below rank 1, or retyping within 30 s, is a correction: the signal for later ranking. The command run itself is already recorded by `runCommand` hooks. |
| Errors | Every stage fails alone: records "Could not look up records just now. Pages and actions below still work." + Try again; server unreachable "The box could not reach the server. Check your connection and try again."; AI "Niva could not answer just now." with local results kept. Technical detail through `failure()` (`src/lib/errors.ts`). |

## 4. UX spec (look first)

- **Placement**: centre of the top bar where `GlobalSearch` sits (`shell-v2.tsx`), max 560 px, shown to everyone signed in; placeholder "Search or ask: a name, any ID, a page, or what you want to do" and the shortcut hint.
- **Overlay**: line 1 "I understood: …"; then the **best action** card (title, why, level badge from `LEVEL_LABEL`: Look, Prepare, Needs your OK; its button "Open", "Show 12 households", "Prepare the payment"); then groups Records, Do, Go to, Filter this page, Ask Niva; at most 8 rows. Household rows always show the card line (numbers, adults, city).
- **Keys**: Ctrl/⌘+K focuses from anywhere; Up/Down move; Enter acts by band (section 2); Shift+Enter asks Niva with the text; Esc clears, a second Esc closes and returns focus; Tab reaches the best card's button.
- **Phone** (under 768 px): Niva's sun button in `phone-bar.tsx` becomes **Ask**; it opens a full-height sheet with the box focused, results below, and Niva's conversation in the same sheet.
- **Empty** (focused, nothing typed): 3 suggestions for this page (`suggestionsFor`) and the person's last 3 choices (localStorage, a per-viewer convenience). **Loading**: local rows at once, a "Looking up records…" row, "Niva is reading…" with Stop. **AI off**: the Ask Niva row reads "Answers to questions in your own words: coming next" (slice 1).
- **A write command**: Enter opens Niva's ProposalCard (confirm level) or the palette's tiny form prefilled with the read slots, the first missing field focused; a payment opens the Giving ask flow with the sentence.
- **A filter**: navigates to the page address; the page shows its chips (People's chips exist; Payments' come in slice 2); the box keeps the text and says "Showing 12 households: open balance over $100".
- **Accessibility**: WAI-ARIA combobox, grouped listbox, `aria-activedescendant`, a polite live region ("6 results. Best: open household 1042"), 44 px rows, no colour-only meaning, 200% zoom, reduced motion.

## 5. What happens to every existing box

| Surface | File | Fate |
|---|---|---|
| Top-bar search | `src/components/shell/global-search.tsx`, `src/lib/global-search.ts` | **Replaced** by the box; its query becomes stage a's people source. |
| ⌘K palette | `src/components/niva/command-palette.tsx`, `src/lib/assistant/palette.ts` | **UI removed** (slice 4); `scoreText`, `navEntries`, `buildRunInput`, `LEVEL_LABEL` reused by stages b-c and the tiny form. |
| Niva panel | `src/components/niva/niva-dock.tsx` | **Stays** as where answers, results and ProposalCards appear; its input is the reply in an open conversation (question 2). |
| Ask Niva buttons | `src/components/niva/ask-niva.tsx` | **Thin shortcut**: prefills the box and routes it. |
| Today's box | `src/components/today/ask-box.tsx` | **Removed**; Today shows suggestion chips that prefill the box. |
| People ask box | `src/components/people-v2/ask-box.tsx` | **Input removed**; chips, "+ Add a filter" and "Ask Niva instead" stay (they show and edit filters). |
| Giving ask flow | `src/components/giving-workspace/ask-flow.tsx` | **Opening input removed**; the in-flow reply ("make it 300") stays: it edits the open draft. |
| Giving side prompts | `src/components/giving-workspace/side-prompts.tsx` | **Thin shortcuts** that prefill the box. |
| Front door ask | `src/components/onboarding-front/ask.tsx` | **Thin shortcut**; the written answers stay. |
| Niva buttons | `niva-top-button.tsx`, `niva-sun-button.tsx` | Top button stays (opens the panel); phone sun button becomes Ask. |
| Pickers | `person-picker.tsx`, `events/person-picker.tsx`, `household-picker.tsx`, `settings/roles/grant-form.tsx` | **Stay**: form fields that choose a value inside a task. |
| Classic list searches | `households/page.tsx`, `people/merge/page.tsx`, `accounting/qbo/matching/page.tsx` | **Stay** until the classic look retires; matching keeps its field (a task, not a command box). |

**People, re-pointed without losing the parser.** (1) Register `people.filters`: an adapter over `readAsk(text, { zones, year })` (zones from `loadZones`, year in the community's time zone). Structured filters (zone, tier, open balance, no RSVP, ending) become a `filter` candidate with `href = /people?` + `paramsFromFilters` + `said`; a leftover name or ID alone makes no filter candidate (stage a owns it). (2) Remove the input in `PeopleAskBox`; keep the chip row. (3) The `?ask=` redirect in `src/app/(app)/people/people-v2.tsx` stays (no-JavaScript path, old links); the dev fixtures keep calling `readAsk`.

**Giving, re-pointed without losing the parser.** (1) Register `giving.payment`: an adapter over `parsePaymentAsk(text, today)` (`src/lib/giving-workspace/ask.ts`) that triggers only on a payment word (record, received, got, paid, gave, gift, donation, payment) or a method word, plus an amount. Its candidate is `giving.draft_payment` (draft: saves nothing); the action opens `/giving?ask=<sentence>`, which the page turns into `AskFlow`'s initial state (new, small: `GivingPage` already takes `initial`). (2) Household choice by card, the confirmation card and the money rule are unchanged: the box never records a payment; `giving.record_payment` stays behind `requiresOwnerSwitch`.

## 6. Build slices

**Slice 1 (look first, no migration, no AI call; size M, about 1,200 lines with tests).**
- Pure core `src/lib/box/`: `types.ts`, `router.ts`, `rank.ts`, stages `identifiers.ts`, `nav.ts`, `commands.ts`, `filters.ts`, `fallback.ts`, extractors `people.ts`, `giving.ts`. Golden tests `tests/box/golden.test.ts` (table below; fixtures for a chamber of commerce, a church and a temple, plus a role without Giving) and `tests/box/router.test.ts` (bands, gating, D2).
- `POST /api/box` wired to `searchHouseholds`, the people search, `listCommands(session, "palette")` and the visible nav.
- `src/components/shell/one-box.tsx` in `shell-v2.tsx` (New look) replacing `GlobalSearch`; Ctrl/⌘+K bound to it; an "All actions" row opens the old palette until slice 4. Where Niva is on with a key, the Ask Niva row hands the text to the existing panel (`niva.ask`); elsewhere it shows "coming next".
- Dev preview `/dev/one-box` on fixtures; screenshots per kind, light and dark, phone width.

| # | Kind | Typed | Top candidate | Note |
|---|---|---|---|---|
| 1 | chamber | `1042` | record: household 1042 | Sure, opens |
| 2 | chamber | `ana@lopezbakery.example` | record: person by e-mail | Sure |
| 3 | chamber | `+1 415 555 0134` | record: person by phone | Sure |
| 4 | chamber | `events` | page: Events | Sure |
| 5 | chamber | `go to payments` | page: Giving › Payments | Sure |
| 6 | chamber | `memberships ending in 30 days` | filter: /people ending=30 | People extractor |
| 7 | chamber | `open balance over 500` | filter: /people over=50000 | integer cents |
| 8 | chamber | `record a 300 check from member 2210 for dues` | command: giving.draft_payment | card, never auto |
| 9 | chamber | `draft a reminder to members who have not paid` | command: messages.draft_reminder | Prepare |
| 10 | chamber | `what events are coming up` | command: events.upcoming | read |
| 11 | chamber | `how did the gala do compared with last year?` | answer (Niva) / fallback | Unsure |
| 12 | chamber | `LOPEZ BAKERY LLC` | record: bank payer name | identifier |
| 13 | church | `Sunday school` | page: learning area by kind term | `describe` |
| 14 | church | `received 50 cash from the Okafor family yesterday` | command: giving.draft_payment | household by card |
| 15 | church | `Okafor` | record choices with cards | name only: Likely |
| 16 | church | `who is behind on pledges` | command: giving.pledges_behind | read |
| 17 | church | `zelle waiting` | command: giving.zelle_waiting | read |
| 18 | church | `families in North with no RSVP this year` | filter: /people zone, norsvp | zone from data |
| 19 | church | `add a person` | command: people.add_person | form |
| 20 | church | `merge the two Okafor households` | command: people.merge_households | confirm card |
| 21 | church | `bank` | page: Giving › Bank, then giving.bank_lines_unmatched | two kinds |
| 22 | church | `write a thank-you for Easter donors` | answer (Niva) / messages.draft_reminder | Unsure |
| 23 | church | `QB-88412` | record: accounting ID | identifier |
| 24 | temple | `T-0417` | record: old-system ID | resolve_identifier |
| 25 | temple | `Diwali dinner RSVPs` | command: events.rsvps (event slot) | events vocab |
| 26 | temple | `classes needing teachers` | command: learning.classes_needing_teachers | kind wording |
| 27 | temple | `life members in Riverside` | filter: /people tier=life, zone | |
| 28 | temple | `month close` (role without accounting) | fallback: no access line | gating |
| 29 | temple | a sentence in Tamil | answer (Niva) told the community's languages / fallback | languages |
| 30 | temple | `delete household 1042` | record: household 1042; no delete offered | no such command |

**Later slices.** Reuse: the Source column in section 2 and the File column in section 5.

| Slice | What | Size |
|---|---|---|
| 2 | `box.choose` activity (allowlist row in its own migration), corrections; Payments filter extractor and chips | S |
| 3 | AI stage in the router: model picks among candidates or answers, D2 filter, prompt caching, usage cap, streamed line 2 | M |
| 4 | Retire old boxes per section 5 (palette UI, Today box, People input, Giving opening input); classic look gets the box | S |
| 5 | Phone sheet polish; connect-mobile member app Ask bar on the same route with a member catalog (question 4) | M |
| 6 | Ranking from logged choices and corrections, per community | S-M |

| Risk | Answer |
|---|---|
| A name opens the wrong household | name-only capped below Sure; card on every row; writes pick by card |
| Box offers what the role cannot do | `commandAvailability` and the visible nav only; RLS still enforces |
| Two parsers both claim a sentence | trigger words per extractor; golden rows 8, 14, 18 pin it |
| Keystroke load on the droplet | 200 ms pause, abort stale calls, 60 a minute cap |
| A child's name reaches the model | `filterChildren` on all stage-e text; router test asserts it |

## 7. Open questions for the owner

1. **Box without Niva?** Stages a-d (records, pages, actions, filters) for every signed-in person even where Niva for admins is off. *Recommend yes*: it is the person's own hands; only stage e needs Niva on.
2. **Niva panel's own input.** *Recommend* keep it only as the reply inside an open conversation; every new request starts in the box.
3. **Keep typed text to improve ranking?** *Recommend no*: log the choice and its shape only (it can hold names, children's too); 90 days.
4. **Member app.** *Recommend* the connect-mobile Ask bar uses the same route with a member catalog (own records only) in slice 5, after the admin box is proven.
5. **Enter acts at once when Sure** (look-only results). *Recommend yes*; writes never.
6. **Community words for stages b-d** (synonyms in its own languages, "dues" for "membership"). *Recommend* AI covers other languages first; add an editable "our words" list per community in slice 6 if corrections show the need.
