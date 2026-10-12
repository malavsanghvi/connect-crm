# Smart, consolidated event creation (plan)

Status: plan, 2026-10-11. Owner ask (2026-10-11): "Get the whole event creation consolidated and made smart"; the unified command box (B94, [`UNIFIED_BOX.md`](UNIFIED_BOX.md)) runs simple commands straight away, and when a command needs questions ("create an event") it opens the chat that asks them and finishes with a FULL event page. Built for every organization Weaver onboards (any kind, any faith or none, any language): questions, words and defaults come from data (kind and its terms, modules, the community's languages, its past events), never from one community. The owner sees an interactive prototype separately; this is the written plan behind it.

## 1. Today (read from the code on 2026-10-11)

| # | Step | Where it lives | What goes wrong |
|---|---|---|---|
| 1 | Fill the form | `/events/builder`: `src/app/(app)/events/builder/page.tsx` (291 lines) + `event-builder.tsx` (509): details, audience, waitlist, donation commitment, confirmation reminder, lunch slots, "More settings" (RSVP window, attendee questions, prices, lead, confidential) | Every field at once for every kind. A new event starts with lunch slots ON (`page.tsx:138`); a template start forces it on (`createEventFromTemplate`, `events/actions.ts:160`) |
| 2 | Start from a template | Builder card → RPC `create_event_from_template` | Copies description, lead and checklist only. Templates are edited at `/pathshala/committee/templates`, in the school area, so a kind with no school has nowhere to make one |
| 3 | Start from a past event | Palette/Niva only: `events.clone_draft` → `events.create_from_clone` (`src/lib/events/clone.ts`) | You have to name the old event. Copies the settings but never shifts, checklist, flyer, survey or lessons. No screen offers it |
| 4 | Flyer | Builder flyer panel (`flyer-panel.tsx`, `flyer-actions.ts`, `flyer-art-actions.ts`, worker `events.generate_flyer`) | Locked until the draft is saved ("Save this event as a draft first…", `event-builder.tsx:523`): a second visit |
| 5 | Volunteers | Event page › Volunteers (`createShift`, `assignVolunteer`, `grantEventRole`); roster at `/events/volunteers` | Done separately after creation. Stations are a fixed list that includes `app_seva` (`actions.ts:24`), although `volunteer_shifts.station` is free text |
| 6 | Lunch | Event page › Lunch (`generateLunchSlots`) | You go back to the builder for the lunch time first. "Lunch" is one kind's word (the parked page already says "Meals") |
| 7 | Checklist and lessons | Checklist tab (`setChecklistState`, `addChecklistAction`, `addLesson`, `pushLessonsToTemplate`) | Filled only from a template. Last time's lessons show up after the event, not while you plan |
| 8 | Readiness | `events.readiness` (`src/lib/events/readiness.ts`), palette/Niva only | The builder never shows it, so blockers surface at Publish or not at all |
| 9 | Reminders | Sent automatically once published: RSVP confirmation and "please confirm" N hours before (`confirmation_hours_before`, 0598). Everything else is done by hand in Messages (`messages.draft_reminder`, `messages.schedule_campaign`) | Often forgotten. Built-in wording exists only for en/gu/hi (other languages are marked "needs translation"). Campaigns do not send yet (B60) |
| 10 | Survey | Survey tab (`attachEventSurvey`, `launchEventSurvey`), `/events/feedback` | A separate step, usually remembered too late |
| 11 | Publish | Builder "Publish event" (`saveEvent`, intent) or the event page's status button (`events.set_status`) | Two paths; nothing checks for clashes or duplicates |
| 12 | A second form | connect-admin `src/app/(console)/events/new/page.tsx` + `event-form.tsx` | Writes `events` directly and drifts from the portal |
| 13 | Audit | `runAction(..., { key })` (`src/lib/events/forms.ts`) | Only `events.save` is recorded; `createEventFromTemplate`, `createShift` and `generateLunchSlots` leave no activity |

Result: finishing one event takes 5-7 visits across 3 screens plus Messages. Readiness is unknown until the end, and the words belong to one kind (lunch, seva, `audienceChips(…, school = "Pathshala")`, the `pathshala_families` audience).

**Corrections to the brief's inventory.** (a) Main has 12 event commands, not 11: `events.upcoming` as well. (b) Templates live in the school area, and connect-admin has its own creation form (rows 2, 12). (c) The description is a single text column with no per-language text, while `content_items` and `comms_campaigns` already keep `translations jsonb`. (d) The member app (connect-mobile `src/app/(app)/event/[id]/index.tsx`, `(tabs)/events.tsx`, guest `src/app/e/[id].tsx`) shows name, start and end, venue, description, `flyer_path`, capacity and waitlist, the RSVP window, lunch, commitment options, prices and `event_number`. It lists only visible statuses, and its calendar (`src/lib/api/calendar.ts`) reads published events directly, so there is no separate calendar step. (e) The parked Event Weaver branch (`feat/admin-events-page`, `src/lib/events/workspace.ts`; `docs/handoff/prototypes/admin-v2/Events.dc.html`) is the workspace for a published event (Overview, RSVPs, Meals, Volunteers, Check-in, Feedback), not a creation screen. The guided flow ends on it.

## 2. The target: one guided creation that always ends in a complete event

"Complete" means every part below exists. Nothing is published or sent until the person approves it on the last screen.

| Part | Built from (existing) | State until approved |
|---|---|---|
| Event | `events` row, `status = 'draft'` | members cannot see it (the app lists published statuses only) |
| Event page | the fields the member app and guest page render; preview drawn from the same fields | preview only |
| Readiness | `eventReadiness(…, "publish")` plus the creation checks in section 3 | live beside the questions |
| Reminders | `comms_campaigns` (`kind 'event'`, `status 'draft'`, planned `scheduled_at`, audience with `event_id`); `confirmation_hours_before` | drafts; nothing queued |
| Volunteer shifts | `volunteer_shifts`; the community names its own roles | empty shifts; nobody asked yet |
| Meals | `lunch_enabled`, slot length, seats; `lunch_slots` from `planLunchSlots` (`src/lib/events/report.ts`) | slots exist; nobody seated |
| Tickets and money | `is_paid`, member/guest price (integer cents), `commitment_options`; sponsorships through `opportunities.event_id` | settings only; no money moves |
| Checklist | template items → `actions`, else readiness items as tasks | open tasks |
| Flyer | `flyer_design` (0578), brand kit (`src/lib/events/flyer-brand.ts`) | draft; not on the page until approved |

- **One review, existing approvals.** The last screen lists what will happen: "Publish the event", "Send 2 reminders for approval", "Show the flyer". Each line is ticked and runs its own existing command (`events.set_status`, `messages.schedule_campaign` with its approvers). A failed line says so in plain English, and the others stand.
- **The same questions two ways.** With AI on, Niva asks in the chat. With AI off or not ready, the same question catalog appears as cards (one per screen on a phone). AI only adds suggestions and drafts; rules supply everything else.
- **Only ask what cannot be worked out.** Each question has an `infer()` that reads the typed text, the chosen starting point, the kind and the community's history. Worked-out answers appear as editable chips ("We used Main hall, like last year").

| Decision | Why |
|---|---|
| One question catalog shared by the chat and the cards | It works with AI off, needs one set of golden tests, and follows the same pattern as the onboarding interview (`docs/ONBOARDING_INTERVIEW.md`) |
| The draft is saved at the first answer | The person can leave and come back; `draft` already hides it from members |
| Writes reuse `eventValues`, `create_event_from_template` and `prepareClone` | One set of rules: no second validator that could drift from the builder |
| Reminders are `comms_campaigns` drafts | They use the existing approval and second-approver rules; no new sending path |
| Suggestions never set money silently | Money rules: a price is shown with its source and the person accepts it |
| The old builder stays as "Advanced" | No field is lost while the guided flow catches up |

| # | Group | Asks (unless already known) | Asked when | Adapted by |
|---|---|---|---|---|
| 0 | Start | "Like a past event, from a template, or new?" | a match scores >= 0.6 | skipped when the text names a source ("clone last year's picnic") |
| 1 | What and when | name; day; start and end time | always (prefilled from the text) | a clone keeps its times of day |
| 2 | Where | venue | the starting point has no venue | last venue of the similar event |
| 3 | Who | audience; RSVP or not; capacity; waitlist; RSVP window; attendee counts asked (children, seniors, needs help: counts only) | audience always; the rest when RSVP is on | audience choices from modules (school families only with a school module); capacity hint from history |
| 4 | Money | free or paid (member/guest price); donation commitment at RSVP; sponsorships; pledges | the Giving module is on | pledges only where the community records them; prices from history; nothing is charged here |
| 5 | Help | volunteer roles and shifts; meals (seats, slot length) | volunteers on, or the source had shifts; food mentioned, or the source had meals | shift times move with the new date |
| 6 | Words and look | description in each `communityLanguages()` language; flyer; photo | always (a draft is offered) | AI draft, or a draft built by rule from the fields |
| 7 | Communication | reminder times; channels (opt-in counts, quiet hours); guest link when guests may come | comms module on | timing from past events; `planSend` (`src/lib/events/quiet-hours.ts`) |
| 8 | Review | preview, readiness, approvals | always | none |

**Live preview.** Beside the questions (two columns on desktop, a "Preview" tab on a phone) the event appears as the member app shows it, in the interface language with a language switch. Under it is the readiness list: **Blocks publishing**, **Worth a look**, **Done**. The pure renderer is `eventPreview(draft, locale, kind)`.

## 3. Smart features

| Feature | Data it reads | Code (rule) | AI adds | Slice |
|---|---|---|---|---|
| Best start | `events` (folded name words, month, `template_id`), `event_templates` | score by name (`foldName`), same season last year, template use; offer the top 3 | understands "the dinner we do after Diwali" | 3 / 5 |
| Date suggestions | `calendar_entries` of the community's layers (festival, tradition, school district, subscribed feeds; 0510), `special_days`, own `events`, attendance by weekday | the 3 best free days in the window asked for, with a reason ("Saturdays drew 30% more") | none needed | 3 |
| Clash check | overlapping events on the same day or venue (folded text), holiday or school entries | a warning with a link; never blocks | none | 3 |
| Capacity and food | `attendees`/`rsvps` counts of similar events, `lunch_slots.served` | median attended × trend, plus no-show rate; seats per slot from what was served | none | 3 |
| Price | similar events' `member_price_cents`/`guest_price_cents` | "Last time $25 / $35"; suggested, never set silently | none | 3 |
| Volunteers | source `volunteer_shifts`, `volunteer_assignments`, `volunteer_interests` | copy roles, times and numbers; "who did it last time and is free" (adults; not on an overlapping shift) | none | 3 |
| Reminder timing | past `comms_campaigns` of kind `event` relative to the start; `confirmation_hours_before`; `channel_optins` | the same offsets as last time, moved out of quiet hours | none | 3 |
| Description | the answers | text built by rule from the fields, using saved templates per language | a draft in every community language, marked "check by a reader" | 4 |
| Flyer | brand kit, `flyer_design`, art library | poster defaults filled from the answers | art (worker `events.generate_flyer`) | 4 |
| Duplicate warning | same folded name within ±14 days, or an open draft from the same source | "You already have Diwali Dinner 2026 as a draft: continue it?" | none | 3 |
| Lessons learned | source `events.lessons_learned`, `event_templates.lessons_learned` | shown at the matching group by keyword (food → Help, parking → Where); all of them at Review | picks the relevant one for each question | 3 / 4 |

History is used as counts only (who came, how many, prices, offsets). Suggestions stay hidden until the community has at least 2 similar past events.

## 4. Hand-off from the unified box

- **Recognition.** The box registers an `events.create` slot extractor (UNIFIED_BOX section 2). It triggers on create/plan/organise/set up/schedule/clone/copy plus an event word or a kind term, and reads the name, the day ("Nov 8", "next Thursday" in the community's time zone), times, prices and a source event from the events vocab. Trigger + 1 slot = Sure (0.88). Examples: "create an event", "plan a Diwali dinner for Nov 8", "clone last year's picnic".
- **Contract change to B94.** `Candidate.action` gains `{ type: "wizard"; key: "events.plan"; input: { text: string; source_id?: string; day?: string } }`. Enter opens it at once: this is safe because nothing is written until the first answer, and nothing goes out until Review.
- **Niva on (and `aiReady`).** The Niva panel (`src/components/niva/niva-dock.tsx`) opens with "I understood: Diwali dinner, Sunday 8 November" and the first unanswered question already asked, drawn as the same card inside the chat. AI turns typed replies into answers; chips accept suggestions.
- **Niva off or no key.** `/events/new?plan=<event id>` opens a full page with the same cards and the same preview. Suggestions come only from rules and history; typed answers are read by rule extractors (dates, numbers, money).
- **Leave and resume.** State is saved on every answer. "Continue setting up Diwali Dinner" appears in the events list and on Today, and as a box result for "continue Diwali dinner".

| Typed | Command | Opens | Writes |
|---|---|---|---|
| "Update phone number of Ana Lopez to 415 555 0134" | `people.update_person` (confirm) | ProposalCard: household card, old → new | on OK |
| "record a 300 check from 1042" | `giving.draft_payment` → `giving.record_payment` | Giving ask flow card | on OK, only where the community has ticked money commands (`requiresOwnerSwitch`) |
| "record a write-off" / "add a pledge" | none yet | the page that does it | write-offs and refunds need a second person (`giving-second-approver.ts`); their commands are Giving's backlog, not this plan |
| "create an event" and variants | `events.plan` (wizard) | Niva chat or guided cards | the draft on the first answer; publish and send only at Review |

**The wizard command contract** (pure core in slice 1, registered as a command in slice 5):

```ts
type QuestionId = "start" | "name" | "when" | "venue" | "audience" | "rsvp" | "capacity" | "money"
  | "volunteers" | "meals" | "words" | "flyer" | "reminders" | "review";
type Suggestion = { value: unknown; why: string; source: "rule" | "history" | "ai" };
type Question = { id: QuestionId; group: number; prompt: string;            // worded through describe(text, kind)
  input: "choice" | "date" | "time" | "text" | "number" | "money" | "list" | "yesno";
  options?: { value: string; label: string }[]; suggestion?: Suggestion; required: boolean };
type PlanState = { version: number; eventId: string | null;
  source: { kind: "clone" | "template" | "new"; id?: string };
  answers: Partial<Record<QuestionId, unknown>>; skipped: QuestionId[]; inferred: QuestionId[] };
type PlanCtx = { kind: KindProfile; modules: string[]; languages: string[]; tz: string; currency: string;
  today: string; history: PlanHistory /* counts only */ };
startPlan(text: string, ctx: PlanCtx): { state: PlanState; understood: string };
nextQuestion(state: PlanState, ctx: PlanCtx): Question | { done: true };
applyAnswer(state: PlanState, id: QuestionId, value: unknown, ctx: PlanCtx): PlanState | { error: string };
planReview(state: PlanState, ctx: PlanCtx): { readiness: Readiness; approvals: Approval[] };
savePlan(state, session): Promise<{ ok: true; eventId: string } | { ok: false; error: string }>; // idempotent per part
```

The final result is the draft event id plus the Review: nothing is published. The person lands on `/events/<id>` (the new-look workspace once the parked page ships, the classic page until then) with a "Draft: members cannot see this yet" banner and the readiness list.

## 5. Data and permissions

**Already exists:** draft status and `status-machine.ts`; `event_templates` + items + RPC; `prepareClone`; shifts and assignments; `lunch_slots` + `planLunchSlots`; `actions` (checklist); lessons on events and templates; `flyer_design` and art; `comms_campaigns` drafts; `opportunities.event_id`; calendar layers and entries; `eventReadiness`; `EVENT_FIELD_INFO` (`field-patch.ts`); the 12 event commands.

| Missing | Proposal (not written here) | Slice |
|---|---|---|
| Answers with no column (skipped groups, starting point, reminder plan, version) | `events.setup jsonb not null default '{}'` | 2: one migration, number from the coordinator |
| Name and description per language | `events.translations jsonb` in the `content_items.translations` shape (`{"es": {"name", "description"}}`); connect-mobile reads it later | 2 (same migration) |
| Activity for the new commands | allowlist rows for `events.plan`, `events.plan_save` | 2 (same migration) |
| Roles named by the community | drop the fixed `STATIONS` check in `createShift` (the column is already free text) | 2, code only |
| A wizard sessions table | not needed: the state is the draft event plus `setup` | none |

Slice 1 needs no migration.

- **Permissions.** Starting and answering need `events.manage` (`eventAreas.manage`). An event's own lead may continue that draft (`eventAreas.edit`). Publishing keeps today's rule (`events.set_status`: event managers or the event's lead). Shifts need the volunteers area. Reminders go through the comms approval path unchanged (a second approver for all members). Prices and commitments are editable only with `events.manage`. UI checks are convenience: RLS enforces, and a role without Events gets "You don't have access to this area".
- **Audit.** Every save runs through `withActivity` (`events.save` plus the new keys); the commands are already recorded by the `runCommand` hooks. The typed text is never logged.
- **D2.** The model receives event fields and counts only. Attendee questions about children are counts. RSVP and volunteer names are never sent; volunteer suggestions stay on screen (adults only). Typed text passes through `filterChildren` before stage e.
- **Words.** Every prompt goes through `describe(text, kind)` / `KindProfile.terms`. "Meals", not "lunch". Audience choices come from modules, roles are named by the community, and languages come from `communityLanguages()`, with no fixed list. Bolis say "pledge". Golden tests include a chamber of commerce.
- **Locale.** Time zone, date format and currency come from the community (`center.time_zone`, `communityLocale`, `center.currency`); money is integer cents.
- **Phone.** One question per screen, a sticky Next, preview as a tab, 44 px targets, works at 200% zoom.
- **Failures.** In plain English next to the step: "Could not save the draft. Your answers are kept; try again." / "Could not load past events, so there are no suggestions; you can still answer." / "Niva could not draft the description; write it or try again." / "Published, but the 2 reminders could not be sent for approval; open Messages to retry." Detail goes through `failure()`.

## 6. Build slices (look first, screenshots on fixtures)

| Slice | What | Size | Main risk → answer |
|---|---|---|---|
| 1 | Pure core `src/lib/events/plan/` (`catalog.ts`, `infer.ts`, `next.ts`, `preview.ts`, `review.ts`); golden tests `tests/events/plan-golden.test.ts`; cards and preview `src/components/events-plan/`; dev page `/dev/event-plan` on fixtures; screenshots per kind, light and dark, phone width. No AI, no migration | M (about 1,100 lines with tests) | catalog grows → golden rows pin which questions are asked |
| 2 | Real data: `savePlan` reuses `eventValues` (moved into a pure helper), `create_event_from_template`, `prepareClone`, shifts, `planLunchSlots`, checklist and campaign drafts; live readiness; Review approvals; `/events/new`; the migration in section 5 | M-L | half-saved parts → each part idempotent; Review shows each part's state |
| 3 | Smart suggestions from history (section 3): a `PlanHistory` loader (counts only), start, dates, clashes, capacity, food, price, volunteers, timing, duplicates, lessons | M | thin history → hidden under 2 similar events |
| 4 | AI: description in every language, flyer art from the brand kit, typed answers turned into answers; D2 filter, prompt caching, the community's monthly Niva limit | M | translation quality → "check by a reader" badge; never published unseen |
| 5 | Box hand-off: the `events.create` extractor, `wizard` action type, Niva panel draws question cards, command `events.plan` | S-M | depends on B94 slice 1 |
| 6 | Tidy-up: template editing moves to Events › Templates (out of the school area); connect-admin's form links to the portal | S | connect-admin users → one release note |

| # | Kind (fixture) | Typed | First question | Not asked |
|---|---|---|---|---|
| 1 | temple | "plan Diwali dinner Nov 8" | Start: "Like Diwali Dinner 2025?" | name, day |
| 2 | temple | "clone last year's picnic" | When: start time (kept, confirm) | start, venue, money |
| 3 | temple, school on | "annual day for the school" | Who: school families offered | none |
| 4 | church | "Easter brunch April 5 after the service" | Where | name, day |
| 5 | church, no Giving | "youth retreat" | When | Money group |
| 6 | chamber | "networking mixer next Thursday 6pm" | Where | Meals (no food word, no history) |
| 7 | chamber | "annual gala, $150 members $200 guests" | When | prices (read from the text) |
| 8 | chamber, comms off | "board meeting" | When | Communication, Help |

**Dependencies.** Drafted reminders go out only once campaigns really send (B60); until then the automatic notices sent after publishing (0598) are the only messages that leave. The final page is the parked workspace (`feat/admin-events-page`) once it merges. The box hand-off (slice 5) needs B94 slice 1.

**The old builder.** It stays as it is until slice 2 covers every field (a test lists the `eventValues` fields against the catalog). Then it becomes "Advanced" (a link from Review and from the event page) and nothing is deleted. New events stop defaulting to meals on: meals are on only when asked for or copied.

## 7. Open questions for the owner

1. **Save the draft at the first answer** (name and day), not only at the end? *Recommend yes*: resuming works and nothing is lost, and drafts are never visible to members.
2. **One Review screen with ticked lines** (publish, reminders for approval, flyer), each through its existing approval? *Recommend yes*; message approval rules stay unchanged.
3. **One migration in slice 2** (`events.setup`, `events.translations`, activity rows)? *Recommend yes*; slice 1 needs none.
4. **Retire event creation in connect-admin** and link to the portal, keeping its day-of editing? *Recommend yes*: one way to create, no drift.
5. **AI drafts in languages without built-in wording** (description, reminders): show the AI draft marked "check by a reader", instead of English marked "needs translation"? *Recommend yes*; nothing goes out without a person's OK.
6. **Starter checklist for communities with no templates**: a short list per kind from the experiences catalog, editable? *Recommend yes, in slice 3*; until then readiness items act as the checklist.
