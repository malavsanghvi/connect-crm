# Smart, consolidated event creation (plan)

Status: plan, 2026-10-11. Owner ask (2026-10-11): "Get the whole event creation consolidated and made smart"; the unified command box (B94, [`UNIFIED_BOX.md`](UNIFIED_BOX.md)) runs simple commands straight away, and when a command needs questions ("create an event") it opens the chat that asks them and finishes with a FULL event page. Owner addition (same day): the flyer draft must appear at once, with the option to publish it now or schedule it on all channels (website, Facebook, Instagram); see section 3. Built for every organization Weaver onboards (any kind, any faith or none, any language): questions, words and defaults come from data (kind and its terms, modules, the community's languages, its past events), never from one community. The owner sees an interactive prototype separately; this is the written plan behind it.

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
| Readiness | `eventReadiness(…, "publish")` plus the creation checks in section 4 | live beside the questions |
| Reminders | `comms_campaigns` (`kind 'event'`, `status 'draft'`, planned `scheduled_at`, audience with `event_id`); `confirmation_hours_before` | drafts; nothing queued |
| Volunteer shifts | `volunteer_shifts`; the community names its own roles | empty shifts; nobody asked yet |
| Meals | `lunch_enabled`, slot length, seats; `lunch_slots` from `planLunchSlots` (`src/lib/events/report.ts`) | slots exist; nobody seated |
| Tickets and money | `is_paid`, member/guest price (integer cents), `commitment_options`; sponsorships through `opportunities.event_id` | settings only; no money moves |
| Checklist | template items → `actions`, else readiness items as tasks | open tasks |
| Flyer and posts | `flyer_design` (0578), brand kit (`src/lib/events/flyer-brand.ts`); drawn the moment the sentence is understood (section 3) | draft; nothing posted until approved |

- **One review, existing approvals.** The last screen lists what will happen: "Publish the event", "Post the flyer on the app, website, Facebook and Instagram on 25 Oct, 10:00", "Send 2 reminders for approval". Each line is ticked and runs its own command (`events.set_status`, the publish panel in section 3, and `messages.schedule_campaign` with its approvers). A failed line says so in plain English, and the others stand.
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
| 6 | Words and look | description in each `communityLanguages()` language; changes to the flyer (the draft already exists); photo | always (a draft is offered) | AI draft, or a draft built by rule from the fields |
| 7 | Communication | reminder times; channels (opt-in counts, quiet hours); guest link when guests may come | comms module on | timing from past events; `planSend` (`src/lib/events/quiet-hours.ts`) |
| 8 | Review | preview, readiness, approvals | always | none |

**Live preview.** Beside the questions (two columns on desktop, a "Preview" tab on a phone) the flyer draft sits on top with its publish panel; below it the event appears as the member app shows it, in the interface language with a language switch. Under it is the readiness list: **Blocks publishing**, **Worth a look**, **Done**. The pure renderer is `eventPreview(draft, locale, kind)`.

## 3. Flyer first, then publish everywhere (owner, 2026-10-11)

- **The draft appears immediately.** As soon as the box understands the sentence, and before the first question, a flyer draft is drawn from: the sentence (name, day, time); the brand kit (logo, colours, fonts); the community's past flyers (the similar event's `flyer_design`: layout, art and tagline); and the art library the flyer maker already has (`flyer-art-library.ts`, `flyer-art-packs.ts`, picked from the name by `flyer-art.ts`). It is rule-based, so nobody waits for AI; Gemini art (already built) is an optional swap, see "Flyer art for any kind of event" below. Unknown parts show as placeholders ("Place to be confirmed"), and readiness counts them.
- **Answers refine it live.** Each answer redraws the poster (venue, time, price, the RSVP QR to `/e/<id>`). Before the draft is saved, the existing renderer draws a preview without saving anything (`flyerPreviewUrlAction`). What a person changes by hand on the poster is never overwritten by later answers.

| Publish panel (beside the flyer) | Behaviour |
|---|---|
| Channels | Member app + calendar (both come from publishing the event); Website (the community's Weaver site once B55 is live, until then the guest page `/e/<id>`); Facebook Page; Instagram. A channel with no connection says "Connect Facebook: your administrator does this once" |
| When | Publish now, or Schedule. The suggested time is N days before the event (N from the community's past events, else 14) at 10:00 in the community's time zone, moved out of quiet hours. Each channel can have its own time |
| Caption | One draft per channel in each of the community's languages: built by rule from the fields, with an AI draft in slice 4. It includes the short RSVP link (B57); for Instagram, where a caption link cannot be clicked, it says where to RSVP |
| Image | Website, app and Facebook use Post 1080×1350; Instagram uses Post (4:5) or a new Square 1080×1080; exported as JPEG for Instagram |
| Approval | A person with `events.manage` approves the flyer, the captions and the channels together (social channels: see question 7). Nothing goes out without it; changing the flyer or a caption afterwards needs a new approval |
| Status per channel | Scheduled (time) · Posted (link) · Failed (plain reason + Try again) · Waiting for a connection. Shown on the event page and as a box answer ("Diwali flyer status") |
| Change or cancel | App and website follow the event at once. For a social post, Weaver suggests a follow-up post; it never edits a post silently, and deleting one is a person's action |

| Part | Today | Missing |
|---|---|---|
| Flyer | maker with 5 templates (Poster, Classic, Festival, Minimal, Photo) and Post, Tall, Story and Print sizes (`src/lib/events/flyer.ts`); the Poster (`flyer-poster.tsx`) sets every word in code over art layers (frame + bottom scene) that are drawn in code (free) or made by Google Gemini (worker `events.generate_flyer`, `flyer-art-actions.ts`, `flyer-art-picker.tsx`; about 4¢ a picture, 30 a day per community, cached per community; key in Platform › Setup, `docs/DEPLOY.md`); brand kit; photos only from albums without children (`flyer-actions.ts:223`) | a flyer before the draft is saved; Square size; JPEG export (the renderer, Satori, draws PNG); occasions for every kind (below) |
| App, calendar | publishing makes the event visible (member app, calendar) | publishing at a scheduled time |
| Website | Weaver's own marketing site (`src/app/site`); the community-site draft built from data (B55/W3, `src/lib/site-draft/`) is not live; the guest page `/e/<id>` | an events page on the community's site |
| Facebook, Instagram | profile links only (`SOCIAL_KEYS`, `src/lib/setup.ts:518`); B54/B75 are backlog; no posting code; `integration_connections.provider` has no Meta value | connections, a posting job, status per channel |
| Secrets | vault `app.integration_secrets` (0170): the portal sees fingerprints only; step-up 2FA (`src/lib/vault.ts`) | Meta tokens kept there |

| Meta rule (read on developers.facebook.com, 2026-10-11) | Facebook Page | Instagram professional account |
|---|---|---|
| Permissions | `pages_manage_posts`, `pages_read_engagement`, and others; the person needs the CREATE_CONTENT task on the Page | Instagram Login: `instagram_business_basic`, `instagram_business_content_publish`. Facebook Login: `instagram_basic`, `instagram_content_publish`, `pages_read_engagement` |
| Scheduling | native: `published=false` + `scheduled_publish_time`, 10 minutes to 30 days ahead | none: Weaver's worker publishes at the chosen time |
| Image | photo by URL | JPEG only, from a public URL; an unpublished container expires after 24 h; 4:5 to 1.91:1 and 8 MB max (media reference, read only in an excerpt) |
| Rate limit | not stated on the page | 100 API posts per rolling 24 h (another section of the same page says 50); check `content_publishing_limit` |
| Review | **Unverified, check before building:** posting to accounts Weaver does not own needs Advanced Access through App Review and Business Verification (Meta's overview, seen only in an excerpt); a Tech Provider check may also apply | same |

- **Connections.** Each community signs in through a per-community OAuth step in Settings › Integrations (Facebook Page, Instagram account). It is an "only you" step for the community's administrator. The token goes to the vault and is never shown; when it expires, a "Reconnect" notice appears.
- **Posting job.** A worker job `events.publish_post` (the job table already holds future jobs, 0598 item 5) posts at the scheduled time. Before posting it checks again that the post is approved and the event is still on; then it uploads the image in the channel's format, posts and records the result. One path for both: Facebook's native scheduling is not used, so there is one status model, no 30-day ceiling, and edits stay in Weaver until the time. Temporary errors and rate limits get 3 retries with growing waits; a lost permission or an expired token becomes Failed with a plain reason. It respects the Instagram limit.
- **New data.** Slice 2's migration adds `event_posts` (event, channel, scheduled_at, status, captions per language, image per format, external id and link, attempts, error, approved_by) for the app and the website. Slice 6 adds the Facebook and Instagram channels and a `meta` value for `integration_connections.provider`.
- **Audit.** `withActivity` keys `events.post_schedule`, `events.post_approve` and `events.post_retry`; the worker records each channel's outcome.
- **D2.** Flyer photos come only from albums marked `contains_children = false` (as today). Captions and flyers never name a person under 18 (`filterChildren` on the caption). Only event fields go to a model, never a photo of a person.

**Flyer art for any kind of event.** Will connecting Gemini give better flyers? Only partly. Gemini already draws the art layers, but two things in code cap the quality. (1) The occasions belong to one tradition: `FLYER_OCCASIONS` (`src/lib/events/flyer-art.ts`) is garba, paryushan, diwali, mahavir, convention, pathshala, bhakti and general, and a kind without a tradition is offered only convention and general (`flyerOccasionsFor`). A church's Easter, a mosque's Eid dinner, a chamber's ribbon cutting or a club's picnic therefore all get generic art, which breaks the owner rule. (2) The prompts are fixed per occasion (`FLYER_LAYER_PROMPTS`), so the event itself, the season and the brand barely shape the picture. *Recommend*: connect Gemini AND make the changes below.

| Decision | How |
|---|---|
| Occasions are data, not code | A catalog of occasions: key, a label in each language, the kinds and traditions it suits, keywords in many languages, palette hints, and frame and scene briefs. It is seeded for many kinds (faith calendars such as Christmas, Easter, Eid, Vaisakhi, Hanukkah, Lunar New Year, Diwali and Paryushan; civic events such as a gala, mixer, ribbon cutting, fundraising walk, annual meeting, sports day, concert or kids' day), and a community can add its own. `occasionFor()` reads the keywords from data; today's code list becomes part of the seed |
| The prompt is built, not fixed | From the event name's words (after the child filter), the kind, the tradition, the season (month and hemisphere, from the country), the brand colours, the occasion's briefs, and one of the community's past flyers as a style reference. Never a person's name, a photo of a person, or anything about a child (D2). `FLYER_LAYER_GUARDRAIL` and the blocked-word test stay |
| Art in separate layers; words set by code | Frame, scene and a new background/hero layer, none with text in it. Every word, date, price and the QR are set by `flyer-poster.tsx`, so the words are always right, in every language and script |
| Several compositions | 3-4 new Poster compositions (centred hero, split image and text, photo-led, bold type) beside today's five templates; the instant draft offers 3 thumbnails to choose from |
| Community photos | Approved album photos (`contains_children = false`) as the background or hero, with a colour wash so the text stays readable |
| QR and sponsors | The QR to `/e/<id>` is always on the flyer; a sponsor strip comes from the event's sponsorships (`opportunities.event_id`), with logos (`uploadPartnerLogoAction`) |
| Cost and limits | Today's rules stay: the price shown on the button, 30 pictures a day per community, each picture cached for the whole community (`content/<center>/flyer-art/…`). The instant draft uses code art or a cached picture (no wait, no cost); a new Gemini picture is made only on "Make new art" |
| Review | A person approves the flyer before any post (the panel above) |

Golden flyer tests pick a fitting occasion for: a church's "Christmas Eve candlelight service", a mosque's "Eid dinner", a chamber's "ribbon cutting at Lopez Bakery", a club's "summer picnic" and a temple's "Diwali dinner".

**Built (B96, 2026-10-11).** The catalog is `src/lib/events/flyer-occasions.ts` (TypeScript data: who each occasion is for by kind and tradition, its label in the kind's or tradition's words, season, drawn pack, keywords in several languages, prompt words, and which faith should review it); `suggestOccasion` ranks occasions from the title, the description, the community's festival calendar and the season, and only the event's own words preselect one. `src/lib/events/flyer-art-prompt.ts` builds the AI prompts from that data plus a fixed rubric; the portal sends the database checked FACTS, not prose, and the background service builds the same prompt from them. `src/lib/events/flyer-art-palette.ts` turns the brand kit into the colours drawn art uses (`paletteFromBrand`, contrast-checked). AI frames and scenes work for every occasion: 0703 makes `events_request_flyer_art` and `flyer_art_name_ok` check only an occasion key's shape (the catalog stays the list, checked by the portal and the background service), so a new catalog entry needs no migration.

## 4. Smart features

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
| Flyer | brand kit, past flyers (`flyer_design`), art library | the instant draft (section 3), redrawn from each answer | Gemini art from the built prompt (section 3) | 4 |
| Duplicate warning | same folded name within ±14 days, or an open draft from the same source | "You already have Diwali Dinner 2026 as a draft: continue it?" | none | 3 |
| Lessons learned | source `events.lessons_learned`, `event_templates.lessons_learned` | shown at the matching group by keyword (food → Help, parking → Where); all of them at Review | picks the relevant one for each question | 3 / 4 |

History is used as counts only (who came, how many, prices, offsets). Suggestions stay hidden until the community has at least 2 similar past events.

## 5. Hand-off from the unified box

- **Recognition.** The box registers an `events.create` slot extractor (UNIFIED_BOX section 2). It triggers on create/plan/organise/set up/schedule/clone/copy plus an event word or a kind term, and reads the name, the day ("Nov 8", "next Thursday" in the community's time zone), times, prices and a source event from the events vocab. Trigger + 1 slot = Sure (0.88). Examples: "create an event", "plan a Diwali dinner for Nov 8", "clone last year's picnic".
- **Contract change to B94.** `Candidate.action` gains `{ type: "wizard"; key: "events.plan"; input: { text: string; source_id?: string; day?: string } }`. Enter opens it at once: this is safe because nothing is written until the first answer, and nothing goes out until Review.
- **Niva on (and `aiReady`).** The Niva panel (`src/components/niva/niva-dock.tsx`) opens with "I understood: Diwali dinner, Sunday 8 November", the flyer draft (section 3), and the first unanswered question already asked, drawn as the same card inside the chat. AI turns typed replies into answers; chips accept suggestions.
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

## 6. Data and permissions

**Already exists:** draft status and `status-machine.ts`; `event_templates` + items + RPC; `prepareClone`; shifts and assignments; `lunch_slots` + `planLunchSlots`; `actions` (checklist); lessons on events and templates; `flyer_design` and art; `comms_campaigns` drafts; `opportunities.event_id`; calendar layers and entries; `eventReadiness`; `EVENT_FIELD_INFO` (`field-patch.ts`); the 12 event commands.

| Missing | Proposal (not written here) | Slice |
|---|---|---|
| Answers with no column (skipped groups, starting point, reminder plan, version) | `events.setup jsonb not null default '{}'` | 2: one migration, number from the coordinator |
| Name and description per language | `events.translations jsonb` in the `content_items.translations` shape (`{"es": {"name", "description"}}`); connect-mobile reads it later | 2 (same migration) |
| Posts per channel, now or scheduled | `event_posts` (section 3) | 2 (same migration) |
| Flyer occasions for every kind | an occasion catalog table, seeded, which a community can extend (section 3) | 2 (same migration) |
| Activity for the new commands | allowlist rows for `events.plan`, `events.plan_save`, `events.post_*` | 2 (same migration) |
| Roles named by the community | drop the fixed `STATIONS` check in `createShift` (the column is already free text) | 2, code only |
| A wizard sessions table | not needed: the state is the draft event plus `setup` | none |

Slice 1 needs no migration.

- **Permissions.** Starting and answering need `events.manage` (`eventAreas.manage`). An event's own lead may continue that draft (`eventAreas.edit`). Publishing keeps today's rule (`events.set_status`: event managers or the event's lead). Shifts need the volunteers area. Reminders go through the comms approval path unchanged (a second approver for all members). Prices and commitments are editable only with `events.manage`. UI checks are convenience: RLS enforces, and a role without Events gets "You don't have access to this area".
- **Audit.** Every save runs through `withActivity` (`events.save` plus the new keys); the commands are already recorded by the `runCommand` hooks. The typed text is never logged.
- **D2.** The model receives event fields and counts only. Attendee questions about children are counts. RSVP and volunteer names are never sent; volunteer suggestions stay on screen (adults only). Typed text passes through `filterChildren` before stage e.
- **Words.** Every prompt goes through `describe(text, kind)` / `KindProfile.terms`. "Meals", not "lunch". Audience choices come from modules, roles are named by the community, and languages come from `communityLanguages()`, with no fixed list. Bolis say "pledge". Golden tests include a chamber of commerce.
- **Locale.** Time zone, date format and currency come from the community (`center.time_zone`, `communityLocale`, `center.currency`); money is integer cents.
- **Phone.** One question per screen, a sticky Next, preview as a tab, 44 px targets, works at 200% zoom.
- **Failures.** In plain English next to the step: "Could not save the draft. Your answers are kept; try again." / "Could not load past events, so there are no suggestions; you can still answer." / "Niva could not draft the description; write it or try again." / "Published, but the 2 reminders could not be sent for approval; open Messages to retry." / "Instagram did not take the post: the connection has expired. Ask your administrator to reconnect, then Try again." Detail goes through `failure()`.

## 7. Build slices (look first, screenshots on fixtures)

| Slice | What | Size | Main risk → answer |
|---|---|---|---|
| 1 | Pure core `src/lib/events/plan/` (`catalog.ts`, `infer.ts`, `next.ts`, `preview.ts`, `review.ts`) plus **the instant flyer draft** (`flyerFromSentence`: sentence + brand kit + past flyer + art library, through the existing poster renderer) and the occasion catalog as a data-shaped seed; golden tests `tests/events/plan-golden.test.ts` and the flyer occasion rows; cards, flyer and preview `src/components/events-plan/`; dev page `/dev/event-plan` on fixtures; screenshots per kind, light and dark, phone width. No AI, no migration | M (about 1,300 lines with tests) | catalog grows → golden rows pin which questions are asked |
| 2 | Real data: `savePlan` reuses `eventValues` (moved into a pure helper), `create_event_from_template`, `prepareClone`, shifts, `planLunchSlots`, checklist and campaign drafts; live readiness; Review; `/events/new`; **publish panel for the app, calendar and website/guest page, now or scheduled** (worker job, Square + JPEG export); the migration in section 6 | L | half-saved parts → each part idempotent; Review shows each part's state |
| 3 | Smart suggestions from history (section 4): a `PlanHistory` loader (counts only), start, dates, clashes, capacity, food, price, volunteers, timing, duplicates, lessons | M | thin history → hidden under 2 similar events |
| 4 | AI: description and captions in every language; Gemini art from the built prompt (with a past flyer as the style reference), new compositions, album photos and the sponsor strip; typed answers turned into answers; D2 filter, prompt caching, the community's monthly Niva limit | M | translation quality → "check by a reader" badge; never published unseen |
| 5 | Box hand-off: the `events.create` extractor, `wizard` action type, Niva panel draws question cards, command `events.plan` | S-M | depends on B94 slice 1 |
| 6 | **Facebook and Instagram**: per-community connections (the "only you" OAuth step, token in the vault), the `facebook`/`instagram` channels, `events.publish_post` posting to Meta, the rate limit, status and retry; ships once Weaver's Meta app has passed review | L | Meta review time and rules → re-check section 3's unverified row first; until then the panel shows "Waiting for a connection" |
| 7 | Tidy-up: template editing moves to Events › Templates (out of the school area); connect-admin's form links to the portal | S | connect-admin users → one release note |

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

**Order.** The flyer comes first: slices 1-2 ship the instant flyer and publishing to the app and website before anything else. Facebook and Instagram (slice 6) follow once the connections exist; it needs only slice 2, not slices 3-5.

**Dependencies.** Drafted reminders go out only once campaigns really send (B60); until then the automatic notices sent after publishing (0598) are the only messages that leave. The final page is the parked workspace (`feat/admin-events-page`) once it merges. The box hand-off (slice 5) needs B94 slice 1.

**The old builder.** It stays as it is until slice 2 covers every field (a test lists the `eventValues` fields against the catalog). Then it becomes "Advanced" (a link from Review and from the event page) and nothing is deleted. New events stop defaulting to meals on: meals are on only when asked for or copied.

## 8. Open questions for the owner

1. **Save the draft at the first answer** (name and day), not only at the end? *Recommend yes*: resuming works and nothing is lost, and drafts are never visible to members.
2. **One Review screen with ticked lines** (publish, reminders for approval, flyer), each through its existing approval? *Recommend yes*; message approval rules stay unchanged.
3. **One migration in slice 2** (`events.setup`, `events.translations`, `event_posts`, the occasion catalog, activity rows)? *Recommend yes*; slice 1 needs none.
4. **Retire event creation in connect-admin** and link to the portal, keeping its day-of editing? *Recommend yes*: one way to create, no drift.
5. **AI drafts in languages without built-in wording** (description, reminders): show the AI draft marked "check by a reader", instead of English marked "needs translation"? *Recommend yes*; nothing goes out without a person's OK.
6. **One Weaver Meta app** that passes App Review once, and every community connects its own Page and Instagram account to it (rather than each community registering its own Meta app)? *Recommend yes*: a small organization cannot run App Review itself.
7. **Who approves a social post?** *Recommend*: whoever may publish the event approves the app and the website; Facebook and Instagram also need `comms.approve` (one person, no second approver), because a public post speaks for the organization.
8. **Children in flyers and captions.** Keep "no child's name or photo, ever" with no community override in this plan? *Recommend yes*: photos already exclude albums with children. Add a community rule later only if one asks.

## 9. Decisions (owner, 2026-10-11)

- **Approved ("keep going for #1"): questions 4, 6 and 7.** (4) Event creation in connect-admin is retired: its creation form is replaced by a link to the portal's guided creator, and its day-of features stay. (6) One Weaver-owned Meta app passes App Review once; every community connects its own Facebook Page and Instagram professional account to it. (7) Whoever may publish an event approves the app and website posts; Facebook and Instagram posts also need `comms.approve` (one person).
- **Applied in the builds so far, by their recommendations, and open to change:** 1 (the draft is saved after the first card), 3 (one migration, `0700`, for the schedule), 8 (no child's name or photo on flyers or in prompts, with no community override). Questions 2 and 5 stay as recommended for the slices that reach them.
- **Also decided:** build B96, flyer art for every kind of organization, as its own slice (occasions as data by kind and tradition, drawn art packs for more occasions, art colours that follow the brand kit, AI prompts built from the event).
