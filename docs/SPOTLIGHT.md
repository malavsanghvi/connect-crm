# Spotlight: guided tours of the real screens (prototype)

The owner's request (2026-10-14): *"Build Spotlight function for CRM to highlight each of the areas of the CRM and give a quick walk through of
the platform. Do it for 1 persona, one feature first to just prototype how that spotlight would work before doing it for all."* This page says what
the prototype is, how it works, how to add a tour, and, as a proposal for the owner to approve, what the full build would be.

**This change is the sample only**: the engine, and one tour for one person (the Treasurer matching a bank line). Nothing else is built; see
"The full build (proposal)" below for the rest, with a rough size for each piece.

## What it is

A **spotlight** is a guided walk through a *real* screen. The page darkens, one real element at a time is lit with a ring, and a small card next
to it says what it is in a sentence or two ("Step 2 of 8", Back, Next, **Skip tour**). A step can move the person to another page (Next goes there),
so one tour can follow a piece of work from Home, through the navigation, to the screen where it is done and on to where it lands.

It teaches by showing the screen the person will use. It never does anything for them: it does not click, submit, type or write. It is data (a list
of steps) plus a small engine, and a tour is only offered to the people it is for.

## The prototype: one person, one feature

| | |
|---|---|
| **Person** | The Treasurer (role key `treasurer`; in the demo, Meera Doshiwal, who signs in at `/demo` and has real work waiting: bank lines to match, a write-off to second-approve, a month to close). |
| **Feature** | "Match a bank line to the right household" (Giving › Payments › Bank). |
| **Why this one** | It is the treasurer's most frequent job and the one with the most to get wrong: a name alone never identifies a household, a confirm records a real payment, allocates it, queues QuickBooks once and teaches the system a payer name. A tour that shows the household card and says exactly what the confirm button does is worth the most here. The demo already has bank lines waiting, so a visitor can follow along with real data. |

### The tour, step by step

| # | Lit element (`data-spotlight`) | Where | What the card says |
|---|---|---|---|
| 1 | `home-bank-task`, the "N bank lines to match" row | Home › My tasks | The bank lines nobody has matched yet wait here; open it to start. |
| 2 | `nav-giving`, the Giving area of the navigation | any page | Pledges, payments, deposits and the bank statement are in this area; bank matching is one tab. *Left out on a phone, where the navigation is a menu.* |
| 3 | `bank-views`, the views of the Bank tab (To match, Deposits, ...) | Giving › Bank | Import the statement, then match each line; gift lines go to a household, deposits, card payouts and money out have their own views. |
| 4 | `bank-line`, one gift line | Giving › Bank | What the bank reported: amount, date, its own description, how it arrived (Zelle, ACH, wire), the payer's name. |
| 5 | `bank-household`, the suggested household's card | Giving › Bank | IDs, members, address, last gift. Check the card, not only the name; a name alone is never enough. |
| 6 | `bank-confirm`, the Confirm match button | Giving › Bank | It records the payment, applies it to the earliest open pledge, queues the QuickBooks entry once and remembers the payer's name. **The tour will not press it.** |
| 7 | `qbo-sync-status`, the four sync tiles | Accounting › QuickBooks sync | A confirmed match shows as one pending posting, then as posted; anything that fails waits there for a person. *Left out when the person has no access to it.* |
| 8 | `bank-confirm` again, **the real button lit for the person to press** | Giving › Bank | "Try it yourself": the button is real, so press it only when you are sure of the household. |

Steps 4 to 6 and 8 light the *same* line: the first gift line that has a clear suggestion (else the first gift line), so the line, its household and
its button always belong together. If there is nothing to light (no line to match, no clear suggestion) the card says so in plain words and the
person goes on; it is never a dead overlay.

## How it works

```
src/lib/spotlight/            pure logic, no DOM, all unit-tested
  types.ts                    TourDef, TourStep, TourStatus
  copy.ts                     every word the engine itself says (buttons, notes, announcements): one place
  machine.ts                  the step machine: next / back / skip / finish / found / missing / retry
  target.ts                   [data-spotlight~="key"] selector, and waiting for a target (injected clock + page)
  placement.ts                card position, the click shield, scroll arithmetic, phone sheet side
  keys.ts                     what each key does while a tour runs
  progress.ts, store.ts       what this browser remembers (prototype), read/write failures handled
  registry.ts                 which tours a person has (role + screens + modules)
  tours/                      the tours, as data (treasurer-bank-match.ts)
src/components/spotlight/     client components
  spotlight-provider.tsx      mounted once in the portal layout; useSpotlight() { start, stop, active, ... }
  spotlight-runner.tsx        the overlay; loaded only when a tour starts (next/dynamic, ssr: false)
  spotlight-card.tsx          the card (presentational; render-tested)
  tour-invite.tsx             the Home card ("Take the tour", "Not now", "Don't show tours again")
  tour-menu.tsx               the "Tour" item of the account menu, in all three menus
  tour-banner-link.tsx        "Take the tour" in the demo banner
src/app/dev/spotlight/        dev-only preview (sample pages, the real tour pointed at them)
```

* **A tour is data.** `{ id, title, summary, minutes, persona, requires, steps }`. A step is `{ id, target, href?, title, body, placement?, optional?,
  missing?, interactive? }`. There is no code in a tour, and nothing in a step can act on the page.
* **Targets** are found with `[data-spotlight="<key>"]` (a key may sit on several elements; the first one *on the screen* wins, so the sidebar link and
  the phone menu's link can share a key). The attributes were added with the smallest edits to real elements (the Home task row, the navigation
  links, the Bank rows, the household card, the confirm button, the QuickBooks tiles); they change nothing about how those elements look or work.
* **Pages.** A step with an `href` goes there (`router.push`) when the person presses Next (or Back) and they are not already on that page (query
  strings are ignored when comparing). It then waits for its target with a `MutationObserver`, for up to 6 seconds.
* **A target that is not there.** The card says so in plain English (the step's own `missing` words, or a generic note: "It may still be loading, or
  it may not be available to you here") with **Try again**, **Next** and **Skip tour**. A page that arrives late lights the step by itself. A step marked
  `optional` is left out without a word.
* **The ring** follows the element on scroll (of the page or of any scroller), resize and layout change. The element is scrolled into the free part of
  the screen first, smoothly unless the person prefers reduced motion.
* **The shield.** Everything except the lit element is dimmed, and a transparent shield stops a click on anything else reaching the page behind. The
  lit element is covered too (so a click cannot press a real button during a step that only explains it), **except on a step marked `interactive`**
  ("Try it yourself"). The element is never made `inert`: it stays in the accessibility tree and reachable by keyboard.
* **The card is a dialog that is not modal** (`role="dialog" aria-modal="false"`, labelled by its title and described by its words). Focus moves to it
  when a step opens; nothing traps focus. On a narrow screen (under 640px) it is a sheet at the bottom of the screen, or at the top when the lit
  element is in the phone's bottom bar.
* **Idle costs nothing.** The provider holds the person's tours (plain data) and a small status region. The overlay code is loaded the first time a
  tour starts.

### Who has the tour

`toursFor(session)` runs in the portal layout on the server and hands the provider only the tours this person has. The treasurer's tour needs, all
three: the `treasurer` role held **for the whole community** (a grant for one event, class or zone is not enough; the owner and a platform admin are
not treasurers just because they hold every permission); the Bank screen opens for them (`canAccess "bank"`); the modules Giving and Bank
reconciliation are on. A person who has no tour is sent nothing and sees no entry point anywhere. UI checks are a convenience: the database (RLS)
still decides what each screen shows, and the tour only lights what the person can already open.

### The entry points

1. **Home**: an invitation card ("New here? Take the 1-minute tour: Match a bank line to the right household") for a person who has a tour they
   never started, in both looks. It is an offer, never an overlay.
2. **The demo banner**: "Take the tour", for a demo person who has a tour.
3. **The Tour menu item**, to replay a tour any time: in the classic top bar (beside Account), in the classic phone menu, and in the New look's account
   menu. It is there only when the person has a tour.

### Skip, everywhere (owner, 2026-10-14)

* **The invitation** has "Not now" (remembered as dismissed; that tour is never offered on its own again) and "Don't show tours again" (see below), so a
  person can decline without ever starting.
* **Every step** shows a **Skip tour** text button (44px high, in the same place, before Back and Next, on the phone's sheet too) and a × button. The
  last step also offers **Finish** and a plain **Close**.
* **Skipping is one action**: Skip tour, ×, Close and Esc are the same single event. It never asks "are you sure", remembers the tour as dismissed (it
  never starts again by itself), says "Tour skipped" in the live region, and returns focus to where the person was (or the page's main area when that is
  gone). It works while a step is still waiting for its page.
* **Tours off.** "Don't show tours again" (on the invitation, and in the Tour menu) turns every invitation off for this person on this browser: no Home
  card, no demo banner link. The Tour menu stays, and says "Tours are turned off for you here" with **Turn tours back on**.

### Keyboard and screen readers

Right arrow or Enter = Next, Left arrow = Back, Esc = close. A key never takes over from the page: a field being typed in keeps its arrows, and a focused
button keeps its own Enter (so Skip tour skips instead of going on). A polite live region announces "Step 3 of 8: ...", "Tour skipped" and "Tour
finished". Every control is a real button, at least 44px high, with words (the × has an accessible name). The ring has a border and a white outline, so it
does not rely on colour alone. Motion respects `prefers-reduced-motion` (no animated scroll, no ring transition); in forced-colors mode the ring uses the
system highlight colour. The portal has no large-text mode of its own (that is in the member app); the card is sized in px like the rest of the portal and
reflows to the bottom sheet at narrow widths, which is also what browser zoom does.

## What is remembered (prototype), and what the next version stores

**Now**: this browser, per signed-in person, per tour, in `localStorage` under `weaver.spotlight.v1:<user id>`:
`{ "off": false, "tours": { "treasurer-bank-match": { "status": "seen" | "completed" | "dismissed", "at": "<ISO time>" } } }`. A tour never started has no entry
(`not_started`). Starting marks it `seen`; finishing marks it `completed`; Skip, ×, Close, Esc and "Not now" mark it `dismissed`. Storage can throw or be
empty (a private window, blocked site data), so every read and write is wrapped: a failed read is "nothing remembered"; a failed write still holds for
this page and the person is told ("This browser would not let us remember your choice, so the invitation may come back"), never a silent fallback. A demo
person is one shared sign-in, but each visitor's browser has its own memory.

**Next version (not built)**: progress per person in the database, so it follows them across browsers and devices:

* one table, for example `app.tour_progress (user_id, center_id, tour_id, status, updated_at)`, primary key `(user_id, center_id, tour_id)`, plus the
  "tours off" choice as one row (`tour_id = '*'`) or a column of the person's settings;
* row level security so a person reads and writes only their own rows (`user_id = auth.uid()`); no staff permission can read another person's
  progress, and it is never in the audit log or an export;
* two small functions (`my_tour_progress(center)`, `set_tour_progress(center, tour, status)`) so the portal calls the database through the same
  function pattern as everything else;
* the portal reads the person's rows in the layout (next to `toursFor`) and the provider writes through a server action, falling back to this
  browser's memory when it cannot reach the database, with the same plain error if it cannot remember;
* a one-time import of what the browser already remembers.

This needs a migration (a database change), so it was not part of the sample.

## How to add a tour

1. **Write the tour** in `src/lib/spotlight/tours/<id>.ts` as a `TourDef`: `persona` (the role keys it is for), `requires` (the `AccessKey`s of
   `src/lib/permissions.ts` its screens need, the modules that must be on) and `steps`. Keep each body to one or two plain sentences, written for every
   community (no tradition's words, no community's name: the tests refuse them). Say what is true of the code.
2. **Mark the elements.** Put `data-spotlight="<key>"` on the real element of each step, with the smallest edit (an attribute, or an optional
   `spotlight` prop where a shared component draws the element). Name the key by what the element *is* (`bank-confirm`), not by the tour.
   Mark only what the tour explains; a key may be on several elements (the first one on the screen wins).
3. **List the tour** in `src/lib/spotlight/tours/index.ts`.
4. **Set the step options.** `href` where the step is on another page; `optional` where the target can legitimately be missing (a phone, a module
   that is off) and the tour reads on without it; `missing` for the plain words to say when it is missing and the step matters; `interactive` only for a
   final "try it yourself" step.
5. **Run the tests.** `tests/spotlight-tours.test.ts` checks every tour on its own: every step has a title and a short body; every target is a
   `data-spotlight` in `src/`; every `href` is a real page; every access key and module exists; the role exists in the catalog; only the persona has
   it. Add a render check in `tests/spotlight-markers-render.test.ts` if the key sits on an element that depends on data.

Entry points need no change: the invitation, the banner link and the Tour menu item appear for whoever `toursFor` gives a tour.

## How to try it

* **In the demo (after the deploy):** sign in at https://admin.weaverams.org/demo as **Meera Doshiwal** (Treasurer). Press **Take the tour** in the
  blue banner, or the invitation card on Home, or **Tour** at the top right (Tour menu). A visitor who signs in as any other person sees nothing new.
* **Locally, with no database:** `next dev`, then open `/dev/spotlight` (sample Home, Bank and QuickBooks pages; the real tour pointed at them).
  Dev-only: it is a 404 in production.

Tour progress lives in the browser, so clear `weaver.spotlight.v1:*` (or use a private window) to see the first-time invitation again.

## Not built here

* Tours for any other person, the **overview** tour of the platform, the Tours panel for every user (below).
* Progress per person in the database (above), analytics, translations.
* An end-to-end browser test. The repo's end-to-end harness (`e2e/`, Playwright against a Docker stack with Postgres, Supabase Auth and the
  worker) is run by hand, not in CI, and needs a treasurer with bank lines and a QuickBooks sandbox seeded; the Docker stack could not run where this was
  built. The engine was instead driven by hand in a real browser against `/dev/spotlight` (desktop and phone widths), and the logic and the screens'
  markers are covered by `tests/spotlight-*.test.ts`.

## The full build (proposal)

For the owner to approve after seeing the sample. The engine is general: tours are data, targets are `data-spotlight` keys, the step machine and the
memory are pure and tested, so the full build is mostly **tours and entry points**. Sizes are rough working days for one developer, including tests and
the checks in a browser; they assume the sample is merged.

| Piece | What it is | Size |
|---|---|---|
| **1. Overview tour ("Tour of the platform")** | One tour for everyone, built **from the navigation the person actually has**: one step per visible top-level area (Home, People, Giving, Events, Messages, Learning, Store, Content, Reports, Settings, ...), never one for an area they cannot see. Each area is lit by a stable `data-spotlight="nav:<module>"` marker added once in the shared navigation (the classic sidebar and the New look's rail and phone bar). One warm sentence per area comes from **one catalog**, `src/lib/spotlight/area-copy.ts`, keyed by module, using the community's own module names through the existing label helpers (`kindName`, `kindTerm`), with a neutral sentence for a community that has no tradition, so no community sees another's word. A person with only Home gets a short tour that says where their work lives; the last step points at the Tour menu so they know how to replay it. On a phone the navigation is a menu: a step either opens it or becomes a card with no ring ("optional" rule, or a centred explanation); never a step on a hidden element. | 3 to 4 |
| **2. Standard "Take a tour" in the help/account menu, for every user in every community** | Today the Tour item exists only for a person who has a tour. In the full build it is permanent for everyone signed in and opens a small **Tours** panel with two groups: "Tour of the platform" (piece 1) and "Tours for your role" (role tours the person qualifies for; the group is not shown when there are none). Also the "New here? Take a 1-minute tour of the platform" card on Home for first visits. | 1 to 2 |
| **3. Progress per person in the database** | The table, RLS, two functions and the load/save described above, plus the one-time import from the browser. One migration (needs the owner's OK: it adds a table with RLS). | 2 to 3 |
| **4. Role tours for the other personas** | One feature each, in the table below. Each is a `TourDef`, a few `data-spotlight` attributes and a render check. | 0.5 to 1 each (about 10 for the list) |
| **5. Translations** | The words are already in two places: `copy.ts` (the engine) and the tour files. Move them to the message catalogs the portal uses for its languages (English, Gujarati, Hindi and each community's own languages), keyed by tour id and step id; the engine picks the person's language. Needs a translator's review of every sentence, which is the real cost. | 2 to 3 for the plumbing, plus review per language |
| **6. Analytics** | How many people start, finish and skip each tour, and at which step they stop, so a confusing step can be found. Aggregate only: no person, no household. Reuse the activity recorder (B91) and its consent rules, so a community that has not agreed to recording records nothing. | 1 to 2 |
| **7. An end-to-end test** | A Playwright flow in `e2e/flows/` that signs in as a treasurer, starts the tour and walks every step, asserting the live-region words and that Skip leaves the page unchanged. Needs the Docker stack and a seeded treasurer. | 1 |
| **8. Auto-start for first-time users** | Today a first-time person is *invited*, never interrupted. Auto-starting would be a small change (start the tour once, on first sign-in, when the memory says `not_started`), but it is a policy choice for the owner. | 0.2 |
| **9. The member app** | The same idea in `connect-mobile` is a separate engine (React Native has no DOM and no `data-spotlight`); the tours' words and steps can be shared, the rendering cannot. Not proposed yet. | large; separate decision |

**Total for pieces 1 to 4 with the database: about 12 to 15 days.** Pieces 5 to 7 are optional follow-ups.

### Proposed role tours (one candidate feature each)

A proposal only; the owner picks which, and in what order. Each tour is for the role named, and the screens it passes through must open for that person.

| Persona (role key) | Candidate feature | The path it would follow |
|---|---|---|
| Center admin (`center_admin`) | Give a new staff member the right role | Home ▸ Settings ▸ Team ▸ invite ▸ choose the role ▸ the second approver (for roles that need one) |
| Membership coordinator (`membership_coordinator`) | Decide a membership application | Home task ▸ People ▸ Membership applications ▸ the application and its reference ▸ the decision |
| Event lead (`event_lead`) | Check people in on the day | The event ▸ Live check-in ▸ the list ▸ a walk-in |
| Teacher (`teacher`) | Take attendance for a class | My classes ▸ the class ▸ attendance ▸ save |
| Store lead (`store_lead`) | Prepare and hand out an order | Home task ▸ Store ▸ Orders by pickup ▸ mark picked up; low stock on the inventory |
| Communications officer (`communications_officer`) | Write a message and send it for approval | Communications ▸ Newsletters ▸ write ▸ audience ▸ send for approval |
| Privacy officer (`privacy_officer`) | Answer a data request | Home task ▸ Settings ▸ Privacy ▸ the request ▸ export or deletion |
| Finance volunteer (`finance_volunteer`) | The treasurer's bank-line tour, without the parts a volunteer cannot do (no write-offs); the same tour data with a different `persona` | as the treasurer's |
| Volunteer coordinator (`volunteer_coordinator`) | Fill a shift | Events ▸ Volunteers ▸ the shift ▸ assign ▸ the background check |
| Religious coordinator (`religious_coordinator`) | Approve a piece of content | Content ▸ Approval queue ▸ read ▸ approve or return |
| Content editor (`content_editor`) | Write a draft and send it for approval | Content ▸ Library ▸ new ▸ send for approval |
| Pathshala principal (`pathshala_principal`) | Place a late registration | Home task ▸ Enrollments ▸ choose the class |
| Executive viewer (`executive_viewer`) | Read the community's health | Reports ▸ Center health ▸ the community dashboard |
| Zone lead (`zone_lead`) | Answer the zone's inbox | Communications ▸ Inbox ▸ a thread |

The roles with no portal screen at all (family roles, check-in volunteer, kitchen lead, boli recorder; see `docs/DEMO_ROLE_WORK.md`) have nothing for
a portal tour to light; their tours would live in the app they use.

## Decisions for the owner

1. **Approve the full build?** Which pieces, and in what order (the sizes above).
2. **Should the tour start by itself for a first-time person?** The sample only invites (a card on Home, a link in the demo banner, the Tour menu).
3. **Where should progress live?** Per person in the database (recommended; it follows the person and lets a later change re-offer a tour whose
   steps changed) or stay per browser.
4. **Should the overview tour come first?** If everyone gets "Tour of the platform", role tours become the second group of the Tours panel.
5. **Which languages first** for the tours' words.
