# UX audit 03 — Events, Calendar, Communications, Content

Scope: `src/app/(app)/events`, `calendar`, `comms`, `content`, plus `src/app/(app)/comms-content-tasks.tsx` (Home widget).
Read-only audit. Nothing in the repo was changed. Paths are relative to `/home/user/connect-crm`.

**Coverage.** 29 `page.tsx` files = 27 real screens + 2 redirect stubs (`comms/page.tsx`, `content/page.tsx`).
Also covered: the Home widget (`comms-content-tasks.tsx`), the CSV route `events/feedback/export/route.ts`, and the 7 tabs inside `/events/[id]` (treated as one screen, section 3).
Not covered (other agents / connect-admin): `/ops/[eventId]` check-in and kitchen, `/bolis`, `/store`, `/pathshala`.

Reading key. **R** = read. **W** = write. **W+C** = write that needs an explicit confirmation (member-facing send, money, permissions/roles, delete, or hard to undo).
"RPC" = a Postgres function exists. "Direct" = the Server Action writes a table under RLS, no RPC, so the rule lives in TypeScript. "Proposed" = does not exist, would have to be built.

---

## A. Cross-cutting findings (read these first)

### A1. Friction patterns

1. **One record, one long form, every field.** The event builder has ~35 inputs over 5 cards (`events/builder/event-builder.tsx`), with RSVP window, tickets, owner, description and confidentiality hidden under "More settings". The newsletter composer has name, audience chips, custom-segment picker, channels, languages, subject, body, 2 translations, send-at (`comms/newsletter-form.tsx`). `saveEvent` needs the *whole* form: a field missing from FormData is saved as null (see the flyer_path comment in `events/actions.ts:59-63`), and `saveCampaignAction` refuses incomplete input. There is no "change one thing" path.
2. **One job is spread over four modules and 10+ screens.** Running an event touches `/events` list, builder, 7 detail tabs, `/events/live`, `/events/feedback`, `/events/volunteers`, then Comms (to tell anyone), Content › Photo albums (album), Calendar (layer). "Invite the Ahmedabad zone" has no path from the event: event audience is only `Who can RSVP` (members/guests/public); inviting a zone is a separate newsletter whose audience is `zone_ids` (`lib/comms.ts buildAudience`). Surveys exist in three places: event Survey tab, `/events/feedback`, `/comms/surveys`.
3. **Silent or delayed consequences.** "Mark completed" has no confirmation (`events/[id]/page.tsx:51`) yet it opens the feedback survey and queues member pushes (`events/actions.ts:179 completedMessage`, learned only after the fact). "Cancel event" says "RSVPs stay on record" and notifies nobody; I found no cancelled/changed/waitlist-offer message template (templates present: `rsvp_confirmation`, `lunch_reminder`, `event_survey(+_reminder)`, `boli_*`). Publishing says "reminders are scheduled" but sends no invitation. "Offer a seat" (waitlist to RSVP'd) is a silent status flip.
4. **Dead ends and read-only mirrors.** Guide & directory shows zones, administration roster, WhatsApp groups and volunteer groups as read-only tables with "set up in Settings › Center" text; the real editors are elsewhere (`content/guide/page.tsx:110`). Disabled controls with excuses: "Send test to me" (`newsletter-form.tsx:138`), "Not on the app" chip, "Remind unsigned" (`content/legal/page.tsx:243`), shared layers "set by the platform".
5. **Permissions discovered after the click, in code names.** Copy says "needs comms.send", "needs content.manage", "Needs an approver". Publishing a content item needs *both* `content.approve` and `content.manage` (`content/actions.ts:53`). The event Survey tab needs events plus comms. Content › Today mixes three levels on one page: `settings.manage` (hours rules), `content.manage` (per-day times), `content.draft` (streams).
6. **A scoped event lead has no door.** Nav tabs for Events need `events.view/manage` (`lib/permissions.ts:387`), but an `event_lead` is scoped to one event. They see no Events menu and `/events` says no access; they arrive only by a Home task link or a pasted URL (`lib/data/home-tasks.ts:531`).
7. **Names and codes instead of people.** Reference codes (`NL-…`, `Q-…`, `CT-…`, `WA-…`), enum words (`rsvp_closed`, "RSVP'd", "Seats per slot"), tradition terms (navkarsi, chauvihar, pachchakhan, tithi, paksha) with no explanation. RSVPs, inbox and WhatsApp rows identify people/households by name only (see A3).
8. **Numbers are computed by paging whole tables in the browser's server component.** `eventReport`, `lunchSlotCounts`, `slotBoard`, `medianCheckinSeconds`, `aggregateFeedback` run in TypeScript over every rsvp/attendee row, although `app.event_live_stats`, `event_recent_checkins`, `ensure_lunch_slots`, `assign_lunch_for_rsvp` exist in SQL (`lib/data/events.ts:146-215`; `lib/events/report.ts:138` "mirroring app.ensure_lunch_slots"). The events list loads every RSVP and attendee for every event on screen (`events/page.tsx:77-105`; past view = 60 events).
9. **Calendar is not a calendar.** `/calendar` is a layers table, a 200-row entries list, a tithi table. No month or agenda grid. The Events list is a table too. No place shows "my week".
10. **Everything is a table or card list; actions are per-row buttons.** Fine for audit, poor for "do the same thing to 12 rows" (mark 5 WhatsApp requests added, approve 8 photos, assign 6 volunteers). Bulk exists only for album photos and Niva pages.

### A2. Rules the redesign must keep (all verified in code)

| Rule | Where it lives today | Implication for an assistant |
|---|---|---|
| Errors always shown in plain English beside the action, with retry; technical detail logged server-side | `failure()` in `lib/errors.ts`; `ActionForm` + `ActionMessage`; every list has `LoadProblem`/`QueryError` with a retry link | The assistant message must carry the same sentence ("Could not publish the event — …") and a Retry chip; never "Done" before `ok: true`. |
| RLS enforces; UI checks are convenience | `lib/permissions.ts`, `lib/events/access.ts`; all actions use `session.db` (the user's JWT) | The assistant executes with the signed-in user's `session.db` per request. Never a service key, never a worker job doing writes as service role. Existing worker AI handlers (niva.answer, flyer art) are service-role and must not be the pattern for writes. |
| Households are never identified by name alone; show `household_card` | `components/household-card.tsx`, `lib/data/lookups.ts householdCards`, global search `lib/global-search.ts` | Any "RSVP the Shah family / email the Patels" must resolve through `staff_household_search`/`resolve_identifier` and show the card (org household ID, Connect no., primary member, members, zone, city, last gift) before acting. |
| Two-person rule for all-member sends | DB trigger `app.enforce_two_person` (0016) + `approve_as_second`; **only** for `all_members` | The assistant can never be the second approver and cannot approve its own all-member draft. |
| Quiet hours and opt-outs | `app.enqueue_message` (0221/0421): opt-outs (`channel_optins`), suppressions, quiet hours default 21:00-07:00 for non-urgent text/push/WhatsApp, deceased skipped | Recipient previews must be per channel and say what quiet hours do. Today they cannot (B-list item 8). |
| Optimistic version on approvals | `content/actions.ts decideContentAction` requires the `seen` updated_at of the text the approver read | Generalise: every assistant write on a record carries the version it read; the assistant shows the text it is approving. |
| Reasons on audit entries | `dbWithReason` → `x-audit-reason`; audit has `client_app` (portal/member/kiosk/job) | Add `client_app = assistant` (+ the conversation id as `correlation_id`) so audit can tell. |
| Step-up 2FA | `CCSTP` error → `stepUp: true` → `StepUpProvider` modal; required for role grants, exports, merges | Chat must open the same modal and retry once. Event-role grants (`grantEventRole`) and zone-lead assignment hit this. |
| Money is integer cents; bolis say "pledge" | `*_cents` columns; `lib/money.ts` | Event commitments (`per_person: [300,500,700]`) and ticket prices are cents; the assistant converts at the edge only. |
| Anonymous survey answers never show name/household/device, "even to admins" | `events/feedback/page.tsx:309`, `aggregateFeedback` | The assistant may summarise comments but must not try to re-identify, and must not export outside the stepped-up CSV route. |

### A3. Household-identity gaps found in these screens
- RSVPs tab labels rows by `households.display_name` only and confirms with `Cancel the RSVP for ${name}?` (`events/[id]/rsvps-tab.tsx:52-58,152`). `householdsById` fetches `household_number` but the label ignores it.
- `events/people-search.ts` / `lib/data/events.ts searchPeople` returns name + member number + email, and for directory hits only name + zone (`:140`). Used for event lead, checklist owner, volunteers.
- Inbox/WhatsApp "From/Person" is the person's name (`comms/inbox/page.tsx:103`, `whatsapp/page.tsx:76`); no household card or identifier.
- Live "Recent check-ins" shows `Family · count` (`events/live/page.tsx:211`).
- `addGuestRsvp` creates an RSVP by typed party name and phone; it is not linked to any household and does no duplicate check.

### A4. What an assistant layer should look like here (summary; details per screen below)
1. Tool layer = typed wrappers over **RPCs** (and, where none exist, over new RPCs), executed by `session.db`. Server Actions are FormData-shaped (`bind(null, id)`, `_prev`), so they are not directly callable as tools.
2. Flow: **propose → preview (card with real numbers, `household_card`s, text to be sent) → confirm → execute → report with a link** (or Retry). Drafts and reversible changes skip the confirm step but still show the card.
3. Confirmation tiers: no confirm for private drafts and reads; **summary-confirm** for publishing, status changes, hard deletes; **typed or double confirm** for member-facing sends, all-member audiences, urgent alerts, legal publishes, roles, AI spend.
4. Present-tense honesty about what is wired (see blockers B1).

---

## B. Things in the code that would block or mislead an assistant

1. **Newsletter sending is not wired.** Migration `0598_notification_gaps.sql:51` says "newsletters are not built (BACKLOG B60)" and "alerts show in the app, they are not pushed". `comms/actions.ts:77` appends "It stays queued: email, SMS, WhatsApp and push sending are not connected to this app yet" to every approval. Nothing in `src/` or `worker/src/` turns a `scheduled` `comms_campaigns` row into `app.enqueue_message` calls (callers of `enqueue_message` are platform, payments, pathshala, homework, survey notices only). "Send test to me" is a disabled button. The assistant must not say "sent"; it can say "approved and scheduled" until fan-out exists.
2. **The one-approver rule is TypeScript only.** `composeAction` and `approveCampaignAction` (`comms/actions.ts:86-193`, `lib/comms.ts:98,184`) decide who may schedule. The database only blocks a status change to scheduled/sending/sent when the audience is all-members and two different approvers are missing (0016). RLS for `comms_campaigns` is `_staff_policies('comms.view','comms.send')`, so any `comms.send` holder can set `status='scheduled'` with `approved_by` = themselves through PostgREST. An assistant using the same client inherits that hole. Needs RPCs: `submit_campaign`, `approve_campaign`, `schedule_campaign` carrying the rule.
3. **Event status has no state machine in the server.** `setEventStatus` accepts any of six statuses (`events/actions.ts:171`); the allowed next steps (`NEXT_STATUS`) exist only in the page component. An assistant could "complete" a draft or "go live" a cancelled event. Needs `set_event_status(p_event, p_to, p_reason)` with transitions and notices.
4. **Staff RSVP changes skip the RSVP RPCs.** `setRsvpStatus` / `addGuestRsvp` update/insert `rsvps` and `attendees` in two separate statements (not atomic; a failed second insert leaves an empty RSVP) and ignore capacity, waitlist order, household link, commitment. `submit_rsvp`, `cancel_rsvp`, `assign_lunch_for_rsvp` exist but are unused here. "Offer a seat" can exceed capacity.
5. **No partial update for events or campaigns.** See A1.1. Needs `update_event(p_event, p_patch jsonb)` and `update_campaign(...)`.
6. **No "clone event" and no honest "from last year".** `create_event_from_template` copies description, owner, confidentiality and checklist only; the portal then runs a second `UPDATE` to re-apply defaults (`events/actions.ts:136-160`), not atomic. Templates are committee templates, not past events. Needs `clone_event(p_source, p_name, p_starts_at, p_shift_dates boolean)` that also copies lunch/commitment/shifts/survey settings.
7. **Aggregates live in TypeScript** (A1.8). The assistant would re-implement or call a page. Needs `event_summary(p_event)` (RSVP/confirmed/waitlist/checked-in/walk-in/flags/lunch/volunteer gaps) and `feedback_summary(p_survey)`.
8. **Recipient preview is email-only and count-only.** `segment_recipient_count` (0025) counts households with an adult who opted in to **email** and has marketing consent, whatever channels are ticked (`SMS`, `WhatsApp`, `Push` change nothing). "Not on the app" is disabled for that reason. There is no function returning the recipient list (for review with `household_card`s) or per-channel counts or "N delayed by quiet hours". Needs `campaign_recipients(p_audience, p_channels)`.
9. **Quiet hours exist only inside `enqueue_message`.** Compose, alerts and survey screens never mention them; alerts (`createAlertAction`) are one insert, no approval, shown "at the top of the app" immediately, audience can be everyone.
10. **Hard deletes with no undo**: shifts (cascades to assignments), assignments, calendar entries, guide sections cannot be restored; there is `app.record_history` (read-only) but no restore.
11. **Server Actions return `{ok,error,message}` with untyped `data`**, and some redirect (`saveEvent` creating an event calls `redirect()` inside the action). A tool layer needs RPC-style typed results, not redirects.
12. **Event-scope rights are double-implemented** (`eventAreas.*` in TS and `has_scoped_role` in SQL). Fine for UI, but the assistant needs a single "what may I do on this event" read (proposed `my_event_rights(p_event)`), otherwise it will offer actions RLS then refuses.
13. **Step-up is modal-driven in React** (`ActionForm`). A chat tool has no modal; needs the same `stepUp: true` contract surfaced to the chat UI.
14. **AI infrastructure is worker-side, service-role.** `worker/src/handlers/niva.answer.ts`, `events.generate_flyer.ts` run as service role with a stored Anthropic/Gemini key (`lib/ai-service.ts`). Good for generating *content* (jobs queued through user-scoped RPCs like `events_request_flyer`); wrong for *acting*. The assistant's model call can be server-side; its **tool calls** must go through the user's JWT.

---

## C. Screen-by-screen

### EVENTS

#### 1. All events — `/events` (`events/page.tsx`)
- **Who**: `events.view` or `events.manage` (`ACCESS.events`). New-event button needs `events.manage`. Event leads (scoped) are locked out of the list.
- **Jobs**: see what is coming, what is short (RSVP vs cap, waitlist), jump to an event; create one.
- **Pattern / friction**: table with ID, Event, Date, Audience, RSVP, Confirmed, Cap, Waitlist, Status. Two filter rows (Upcoming/Past/No date + 7 status chips). Whole row clickable. No search, no calendar view, no paging for Upcoming. Every row's numbers need all RSVPs/attendees loaded. Empty state is only "Create an event in the builder". No "needs attention" (no volunteers, no survey, draft with date in 3 days).
- **Assistant**:
  - R "What is happening in the next 30 days and which need volunteers or have a waitlist?" → proposed `event_summary` per event (today TS aggregation).
  - R "Which events am I lead of?" → `events` filtered by `has_scoped_role` (fixes the missing door).
  - W+C "Cancel the Sunday bhakti evening" → proposed `set_event_status`; confirm must show N RSVPs/people affected and say plainly that nobody is notified today (or offer to draft the notice).
- **Visual / fresh design**: a month/agenda calendar of events is the natural home; table stays as an alternate view. Fresh design: "Events" opens on a timeline with a *needs attention* rail (draft undated, no lead, unfilled shifts, survey not attached, waitlist waiting) instead of five filter chips. Scoped leads see "My events" first.

#### 2. Event builder — `/events/builder[?event=id]` (`events/builder/page.tsx`, `event-builder.tsx`, `flyer-*`)
- **Who**: create = `events.manage`; edit = manage or that event's `event_lead` (`eventAreas.edit`). Flyer art needs a Gemini key (Platform › Setup) and costs ~4 cents a picture.
- **Jobs**: create/duplicate an event, set audience, capacity/waitlist, RSVP window, commitments, lunch slots, tickets, publish; make a flyer.
- **Pattern / friction**: 12-col block form (Details+audience 7, Lunch 5, slot preview 7, publish note 5, More settings 12) + "Start from a template" card (name + date only) + a separate Flyer maker (design + QR + AI art + poster editor) available only after the draft is saved. Defaults are filled for a new event (waitlist on, lunch on, commitments 3/5/7 and 10/25/50). Friction: ~35 fields, "More settings" hides things admins ask about first (RSVP window, owner, description, confidential); template copies the checklist but not settings; date/venue repeated in the flyer is frozen text (stale warning exists); publish is one of two submit buttons in a long form; dollar amounts typed as comma lists; "Commitment per person ($) / lump sum" jargon.
- **Assistant**:
  - W (draft, no confirm) "Create the Diwali dinner from last year's, move it to Nov 8 at 6pm, Stafford, cap 600, waitlist on" → proposed `clone_event`; today `create_event_from_template` + second UPDATE. Show the filled summary card.
  - W+C "Publish it" → publish makes RSVPs live in the member app and guest pages; confirm card shows audience (public? confidential?), capacity, dates, lunch, commitment amounts.
  - W+C (AI spend) "Make a festival flyer with diya art" → `events_request_flyer` RPC (async job, polled with `events_flyer_result`); confirm the ~4c cost and the English-only/abstract-art guardrail (`flyer.ts findBlockedArtTerm`).
  - R "What did we set for lunch last year?" → read prior event.
- **Visual / fresh design**: flyer maker, poster editor, background picker and art library stay visual; the live slot-engine preview ("Shah family · 4 → 12:00 PM together") stays as a visual proof. Fresh design: start the event as a *conversation + live card* (the card is the form, filled by the assistant, editable inline), progressive sections (Basics → Who → Lunch → Money → Flyer), one "Publish" gate with a readiness checklist (date, venue, lead, audience, capacity). Dollar fields as chips with an "other" input.

#### 3. Event detail — `/events/[id]` (`events/[id]/page.tsx` + 7 tabs)
Header: status text, lead, buttons Check-in screen, Kitchen display, Live check-in, History, Edit in builder; status buttons Publish / Close RSVPs / Go live / Mark completed / Cancel (UI-only transition map).
- **Who**: `eventAreas.event` = events.view/manage or this event's lead. Per-tab: edit = manage/lead; RSVPs = manage/lead/checkin_volunteer; lunch = manage/lead/kitchen_lead; volunteers = events.manage/volunteers.manage/lead; survey = manage/comms/lead.
- **Jobs**: tune the event, run its checklist, manage RSVPs/waitlist, staff the shifts, run lunch, collect feedback, review the report.
- **Pattern / friction**: 7 sibling tabs, no summary above them. A stats strip (RSVPs, confirmed, checked in, shifts unfilled, checklist overdue) is only on individual tabs. Per-record action buttons inline.

  **3a. Details tab** — definition list + flyer thumbnail + custom fields. R "When is lunch, how many seats, who is the lead?" W partial update (proposed `update_event`): "Move the start to 5pm and cap it at 450" (summary-confirm when published, since families already RSVP'd; no notification exists).

  **3b. Checklist tab** — three phase cards (before/during/after), "Add an action" form, Lessons learned, "Push lessons to the template". Friction: owner picked by name; due dates typed; "During" actions take the event date by trigger. Assistant: R "What is overdue or unassigned for Diwali?"; W (no confirm) "Mark 'book caterer' done", "Assign 'print flyers' to Meera, due Oct 30" (owner via person card), "Add the lesson: start parking earlier". Direct writes to `actions`/`events.lessons_learned` (read-modify-write of a JSON array, last write wins; proposed `add_event_lesson`).

  **3c. RSVPs tab** — KPI strip, status chips, a card per RSVP (people, flags, commitment, source, per-person lunch), buttons Confirm / Offer a seat / Cancel / No-show / Reopen, "Add a guest RSVP" form (party name, phone, email, people textarea, confirmed). Friction: households shown by name only (A3); no search/sort; waitlist order not shown; textarea micro-syntax ("Anya Shah, child"); no bulk. Assistant: R "Who is on the waitlist and how many seats are free?" ; W+C "Offer a seat to H-2041 Shah" → must show `household_card` and say no notice is sent today; "Cancel the RSVP of …" (W+C, card + people count); W "Add a walk-in party of 4 by phone 713 555 0198, two seniors" (phone parsed with `toE164`; no duplicate check). Backing today: direct writes (B4); should become `submit_rsvp`/`cancel_rsvp`/`promote_waitlist` RPCs.

  **3d. Volunteers tab** — cards per station with shifts, assignees with waiver status, "Assign volunteers" disclosure with a multi-person picker, "Give check-in/kitchen access" buttons, Add a shift form. Friction: picker is name search (A3); access grant is a separate click and is a role grant needing `roles.manage` (and step-up) which most event leads lack (the tab explains it); station codes; "Needs N". Assistant: R "Which shifts are short and who did Parking last year?"; W "Assign Raj and Meera to entry 9-11" (low risk); **W+C (permissions, step-up)** "Give Raj check-in access for this event" → `grantEventRole` (direct insert into `role_grants`, trigger demands fresh 2FA). Remove shift = hard delete cascade → confirm.

  **3e. Lunch tab** — alert with rules, table of slots (seats editable inline, assigned, served, status, Serve now/Done/Reset), "Create slots now". Slot planning is TS (`planLunchSlots`), mirroring an existing RPC. Assistant: W (low risk, live) "Start serving the 12:30 slot" (marks the previous one done); "Set 1pm to 40 seats"; R "Anyone checked in without a slot?" Event-day voice fits.

  **3f. Survey tab** — attach (template/starter questions), edit until sent, "Launch now", pushes card (who gets a push, who is Home-only, refusals, quiet hours). Uses real RPCs: `attach_event_survey`, `update_event_survey`, `launch_event_survey_now`, `remove_event_survey`. Assistant: W "Attach the standard feedback survey, send it the morning after" (RPC); **W+C** "Launch now" → confirm with the pushes card numbers (this is a member send).

  **3g. Report tab** — KPIs, funnel, scans by station, lunch by slot, not-checked-in names. Assistant R: "Give me the no-show list and the lunch numbers", "compare to last year's".
- **Visual / fresh design**: lunch board, volunteer roster grid and report charts stay visual. Fresh design: replace seven tabs with one event page: top *state spine* (Draft → RSVPs open → Live → Done → Feedback) with the next best action, a *status strip* (RSVPs / seats left / shifts unfilled / checklist due), and sections that expand in place. An *assistant dock* on the right is scoped to this event ("this event" context is implicit).

#### 4. Live check-in — `/events/live[?event=id]` (`events/live/page.tsx`)
- **Who**: `events` area. Links to `/ops/<id>/checkin|kitchen` for scanners (needs `eventAreas.checkIn/kitchen`).
- **Jobs**: watch event day: checked in vs confirmed, walk-ins, waitlist, median check-in time, lunch slot progress, recent check-ins.
- **Pattern / friction**: KPI row + two tables, 10-second `AutoRefresh`. Picks the "current" event by a heuristic with a chip row of up to 6 others; "Run lunch" is a link away to another page (event detail › Lunch). No alerts ("slot 12:30 is full", "40 checked in without a slot"). Recent check-ins show family name + count only. Numbers come from the TS aggregation (B7).
- **Assistant**: R "How are we doing? Anyone without a lunch slot?" ; R "Who was the last family in?" (household card); W (low) "Serve the next slot". Proactive: "Slot 12:30 hit capacity" is a push/notification, not a chat.
- **Visual / fresh design**: the glanceable board stays visual and large-type (TV/wall). Fresh design: full-screen "event day" mode with the big numbers, a slot ladder, and an *exceptions* list (no slot, assistance needed, not-on-list) that a lead can act on without leaving.

#### 5. Event feedback — `/events/feedback` (`events/feedback/page.tsx`, `request-feedback.tsx`, `template-form.tsx`, `actions.ts`)
- **Who**: `events` AND `comms.view|send` (`eventFeedbackRead`); send/template = `comms.send` plus events view; manage = events.manage.
- **Jobs**: see which events were surveyed, response rate/rating/NPS, read comments by area, request feedback for an event, tune the standard template.
- **Pattern / friction**: surveys table, selected survey KPIs (responses, anonymous %, rating vs previous, NPS, flagged), two bar lists, comments table with area chips, "Request feedback" modal, template editor (questions JSON builder, anonymity, send timing). Jargon: NPS, "promoters/detractors". Permission cliff: events access alone shows "no access" (`:66`). Two ways to schedule a survey (here vs event tab).
- **Assistant**: R "How did Paryushan do compared with 2025? What are people unhappy about? Show food comments"; R "Summarise the flagged comments for the event lead" (anonymity respected, A2); **W+C** "Request feedback for Navratri, next morning" → reuse `attach_event_survey`/`launch_event_survey_now` (member push; confirm shows counts and quiet-hours behaviour); W "Add a question about parking to the template" (template JSON; changes future surveys).
- **Visual / fresh design**: charts/bars stay visual; the *comment themes* are where language models earn their keep. Fresh design: a result page with auto themes ("food queues", "parking"), trend vs previous, and a "send these to the event lead" action.

#### 6. Feedback survey detail — `/events/feedback/[surveyId]` (`events/feedback/[surveyId]/page.tsx`, `question-results.tsx`, `export/route.ts`)
- **Who**: comms.view/send, or manager/lead of the survey's event (`app.manages_event_surveys`). Export = `record_export` RPC with a step-up download.
- **Jobs**: per-question results, responses over time, edit questions before launch, open/close, export CSV.
- **Pattern / friction**: KPIs, question result cards, 30-day histogram, response table, edit form (questions builder), open/close buttons. The event Survey tab locks questions after send and says "reword from the results page"; this page is where that happens, but nothing here says why some fields are editable and others are not.
- **Assistant**: R per-question summaries; W+C "Close the survey" (low impact; members lose the card) / "Reopen"; export must remain the stepped-up download, not an assistant-produced file.
- **Visual / fresh design**: charts stay; merge with screen 5 as a drawer or second pane so there is no page-to-page ping-pong.

#### 7. Volunteers — `/events/volunteers[?tab=groups|interests|checks]` (`events/volunteers/page.tsx`, `actions.ts`)
- **Who**: `volunteers.view/manage` (groups, people) and `safety.view/manage` (background checks). Reached only from the event Volunteers tab link; **not in the nav** (nav has 4 Events tabs).
- **Jobs**: maintain seva groups and coordinators; add/activate volunteers; record background checks and watch expiry.
- **Pattern / friction**: chips for views; groups as cards with edit disclosure; table of volunteers; check table with 30-day warnings. "Waiver required" is a free-text document kind ("e.g. volunteer_waiver"). Person picker by name (A3). Orphan page.
- **Assistant**: R "Whose background check expires in the next 30 days?" (needs safety.view; sensitive, show only to those with it); W "Add Priya to the Kitchen group as active"; W "Record a clear check for Anil, expires Oct 2028" (`safety.manage`, validated: clear needs an expiry). Direct writes under RLS (fine; small, one row each).
- **Visual / fresh design**: roster and expiry table stay. Fresh design: a "People who help" directory with filters (group, availability, waiver, check status) and a link from each event's shift to it; waiver status always visible next to the name.

### CALENDAR

#### 8. Calendar layers — `/calendar` (`calendar/page.tsx`, `actions.ts`, `layer-feed.tsx`, `layer-row.tsx`)
- **Who**: `content.manage`, `content.draft` or `settings.manage` to view (`ACCESS.calendar`); `content.manage` to change.
- **Jobs**: decide which layers members can overlay (tithi, Pathshala, events, school districts, custom), add dates, subscribe a layer to an ICS link, check tithi days.
- **Pattern / friction**: layers table (source, link status, owner, default, edit drawers) + upcoming entries table (from last week, 200 rows) + "Add an entry" form + tithi table with prev/next month. No grid; no way to see an event next to a holiday. "Also create an event for each date from the link" is a hidden-power checkbox that creates *events* from a feed. Shared layers are read-only with a footnote. Owner is a free label, not a person. Tithi source "configured in Settings › Integrations" but no import control here.
- **Assistant**: R "What is on the calendar in December? Any parva on Nov 8? Does anything clash with the Diwali dinner?" (join of entries, tithi, events: no single RPC; proposed `calendar_window(p_from,p_to,p_layers)`); W "Add 'No class' Nov 22-30 to the Pathshala layer" (`calendar_entries` insert; low risk); **W+C** "Subscribe Katy ISD to this link and create events" → `subscribe_calendar_layer` RPC; confirm because it fetches an external URL daily and may create events; `unsubscribe_calendar_layer`/`refresh_calendar_layer` RPCs exist.
- **Visual / fresh design**: this should *be* a calendar: month + agenda, layers as coloured toggles exactly as members see them, click a day to add or see clashes, drag to span. Tables become a "Manage layers" drawer. Tithi/parva shown inline on the day cells.

### COMMUNICATIONS

#### 9. Newsletters — `/comms/newsletters` (`comms/newsletters/page.tsx`, `newsletter-form.tsx`, `custom-segment-picker.tsx`, `audience-chips.tsx`)
- **Who**: read `comms.view|send`; compose `comms.send`; approve `comms.approve`; all-member needs two different `comms.approve`.
- **Jobs**: write and send a newsletter to a segment, approve others' drafts, see what went out.
- **Pattern / friction**: composer card (name, combinable audience chips, optional custom-field segments, channel chips, language chips, subject, body, per-language subject/body, send-at) + live "Recipients" card (household count and approval line) + Recent table with inline Approve. Friction: count is email-only (B8); "Push teaser"/"In-app archive" terms; draft language is typed three times; the button says "Send for approval" or "Schedule send" depending on role, and result copy says it stays queued (B1); no preview of how it looks per channel; no list of who will get it; quiet hours not mentioned; "Not on the app" disabled.
- **Assistant**:
  - W (draft) "Draft the fall-term newsletter to West zone Pathshala parents in English and Gujarati; mention registration closes Nov 15" → `comms_campaigns` insert as draft (direct, today). Assistant writes copy; human edits. Show the filled composer card.
  - R "How many households is that, and how many are email-opted-out or in quiet hours?" → proposed `campaign_recipients`; today only `segment_recipient_count`.
  - **W+C** "Schedule it for tomorrow 7am" → confirm card: audience in words, N households, channels, which delay for quiet hours, approver status; blocked for all-member unless a second approver exists. Backing proposed `schedule_campaign`/`approve_campaign` RPCs (B2); must not claim sending until B1 is fixed.
  - R "What is waiting for my approval?" (the same data as the Home widget).
- **Visual / fresh design**: the rendered message preview (email, push, WhatsApp) and the audience builder stay visual. Fresh design: a single compose canvas with the audience as readable sentence chips ("West zone + Pathshala parents, minus unsubscribed"), live per-channel counts with exclusions broken out, a preview tab per channel/language, and an approval timeline ("You drafted → needs Meera → scheduled").

#### 10. Newsletter detail — `/comms/campaigns/[id]` (`comms/campaigns/[id]/page.tsx`)
- **Who**: `comms` read; edit/cancel `comms.send`; approve `comms.approve` (not you if you gave first approval).
- **Jobs**: review, edit, approve, send back, cancel; see approvals and results.
- **Pattern / friction**: Approval card (written by, approvals needed, first/second, send-at), composer in edit mode (any edit resets approvals; the page warns), buttons "Back to approval" (actually returns status to draft), "Cancel send". Status words differ from the list's ("awaiting approval" vs draft/pending). `HistoryButton` for audit.
- **Assistant**: R "Who approved this, what is the audience, when does it go?" ; **W+C** "Approve" (shows full text + audience first) ; **W+C** "Cancel this send" ; R "Compare open rates of the last 5 newsletters" (open rate fields exist: `recipients_count`, `opened_count`).
- **Visual / fresh design**: the approval timeline and the read-only rendered message. Fresh design: approvers get the message rendered as members see it, with a one-tap approve/return-with-reason (as the content queue does for reasons).

#### 11. Inbox — `/comms/inbox` (`comms/inbox/page.tsx`)
- **Who**: `comms.inbox` (all inboxes) or `zone_lead` (their zone via RLS).
- **Jobs**: triage member questions, take ownership, reply within the inbox's response target.
- **Pattern / friction**: chips per inbox with counts, open/closed switch, table (ID, From, Topic, Message preview, Age, Assignee, Take it). Needs-a-reply marker. Sender is name only; no household card; no topic grouping or duplicates; no SLA colour (response target hours shown only on the thread).
- **Assistant**: R "Summarise unassigned questions, oldest first, group by topic, flag anything urgent" ; W (low) "Take the Pathshala registration question" ; draft a reply (see 12) ; R "Has this family written before?" (needs `household_card`).
- **Visual / fresh design**: two-pane mail layout (list left, conversation right) with sender card, SLA timer, suggested reply from approved sources. Table is secondary.

#### 12. Conversation — `/comms/threads/[id]` (`comms/threads/[id]/page.tsx`)
- **Who**: same as inbox.
- **Jobs**: read the thread, reply, close/reopen, assign.
- **Pattern / friction**: bubbles, reply box with "close after replying" toggle; note "Replies go out from the inbox, never your personal number". The reply is a `thread_messages` insert (this code queues no push or email, so whether the member is told about the reply is not visible from the portal; check the member app before the assistant promises "they have been notified").
- **Assistant**: W draft reply from approved Niva sources/guide (draft only); **W+C** "Send reply" because it is a member-facing message (show text + recipient card); W "Close". Never answers doctrinal questions on its own: Niva guardrail applies to the member answerer, and the admin assistant should follow the same "answers only from approved sources" rule.
- **Visual / fresh design**: remains a conversation view; add sender household card and "related" (their last RSVP/pledge/class, read-only, permission-gated).

#### 13. WhatsApp queue — `/comms/whatsapp` (`comms/whatsapp/page.tsx`)
- **Who**: read `comms.view|send`; act `comms.send`.
- **Jobs**: people ask to join WhatsApp groups; an admin adds them in WhatsApp by hand and marks them added.
- **Pattern / friction**: table (ID, person, group, phone, status, Decline / Mark added). WhatsApp cannot add people by API, so this is a manual hand-off. No bulk. Phone formatted for reading; no copy button; no household card.
- **Assistant**: R "Who is waiting for the West zone group?" ; W (low, no external effect) "Mark these five added" (bulk) ; W+C "Decline" (confirm). It cannot add people in WhatsApp; say so.
- **Visual / fresh design**: a checklist: group header, people with copy-phone, tick-to-mark, "mark all".

#### 14. Surveys — `/comms/surveys` (`comms/surveys/page.tsx`, `survey-fields.tsx`, `layout.tsx`)
- **Who**: read `comms`; write `comms.send`. Module "surveys".
- **Jobs**: general (non-event) surveys.
- **Pattern / friction**: table + "New survey" drawer (title, intro, questions builder, opens/closes, anonymous, audience chips). Event feedback is hidden from this list on purpose (`event_id is null`), so admins hunt across two places.
- **Assistant**: W (draft) "Create a 5-question survey on parking for people who RSVP'd to Diwali" ; **W+C** "Open it" (appears in member app; `setSurveyStatusAction` just flips status, no push) ; R "How many have answered?".
- **Visual / fresh design**: questions builder stays visual. Fresh design: surveys of all kinds in one list with a "type" filter (event feedback / general / pulse), and the assistant proposes questions.

#### 15. Survey detail — `/comms/surveys/[id]` (`comms/surveys/[id]/page.tsx`)
- **Who**: `comms` read; `comms.send` write.
- **Jobs**: open/close, edit (live edits show immediately), read responses (names hidden if anonymous), 500 latest.
- **Pattern / friction**: raw responses table, no aggregation or charts (events feedback has them; this does not). Responses are capped at 500 (`.limit(500)`) and the page never says so, so a survey with more answers silently under-reports.
- **Assistant**: R "Summarise the answers; what are the top three requests?" (respect anonymity); W+C open/close.
- **Visual / fresh design**: reuse the feedback result components (bars, themes). One survey result page for both kinds.

#### 16. Alerts — `/comms/alerts` (`comms/alerts/page.tsx`)
- **Who**: read `comms`; post/end `comms.send`.
- **Jobs**: time-critical notices (closures, weather) at the top of the member app.
- **Pattern / friction**: table + "Post an alert" drawer (severity, title, message, start/end, audience chips). **No approval step and no preview of reach**; `createAlertAction` is a single insert. Audience can be everyone. No quiet-hours consideration because alerts are in-app banners, not pushes (0598), which also means an urgent closure reaches only people who open the app.
- **Assistant**: W+C (highest care) "Post an urgent alert: the center is closed today, snow" → typed-style confirm showing severity, audience and reach ("all members"), start/end; consider a rule that urgent+everyone needs a second person like newsletters (owner decision). W "End the weather alert now" (confirm, reversible by re-posting).
- **Visual / fresh design**: a member-app preview of the banner; "Ends automatically at…" defaults; templates for frequent alerts (closure, weather, emergency).

#### 17. Home widget — `comms-content-tasks.tsx` (rendered on Home)
- **Who**: whichever of `comms.approve`, `comms.inbox`, `comms.view|send`, `content.approve` the user holds.
- **Jobs**: "tasks waiting on you": newsletters to approve (inline Approve), unassigned questions, WhatsApp requests, content awaiting approval.
- **Pattern / friction**: a card of rows with Approve/Open. Only shows when there is something. Fixed "reply target 3-5 business days" copy.
- **Assistant**: this is the seed of the assistant's *"what needs me today?"* read: R "What needs me?" returns these rows plus event tasks from `lib/data/home-tasks.ts` (waivers, feedback, bolis, inventory), each with the same Approve/Open actions.
- **Visual / fresh design**: becomes the assistant's opening state (a short prioritised list with one-tap actions) instead of a separate card.

### CONTENT

#### 18. Approval queue — `/content/queue` (`content/queue/page.tsx`, `page-review.tsx`)
- **Who**: view `content.*`; approve = `content.approve` AND `content.manage`; photos need `content.manage`.
- **Jobs**: approve or return religious text, audio lessons, Niva sources (single or imported pages), member photo batches.
- **Pattern / friction**: one table (ID, item, type, by, status, Return/Approve/View text). Reads the full text of the shown page so nothing is approved unread; the decision sends the `seen` version, and a changed text is refused. Strengths. Friction: two permissions to approve; Return needs a typed reason (good); photos approve-all in one click with warning text; 200-per-page pagination; imported pages group sections.
- **Assistant**: R "What is waiting, oldest first, and who submitted it?" ; R "Show me the text of CT-51" ; **W+C** "Approve it" → assistant must display the text and bind the decision to the `seen` version; religious text: never batch-approve, never approve text the assistant itself drafted (conflict); W "Return with reason: sutra line 3 missing".
- **Visual / fresh design**: a reading view (text + source + diff vs previous version) beside the queue; photo review as a grid. Keep the `seen` guard.

#### 19. Today & darshan — `/content/today` (`content/today/page.tsx`)
- **Who**: view `content.*`; hours rules `settings.manage`; per-day times `content.manage`; streams `content.draft`.
- **Jobs**: tell members the day's timings, sunrise/sunset-based observance times, aarti, whether the live stream is on; manage streams.
- **Pattern / friction**: three permission levels on one page (A1.5); rules like "Navkarsi = sunrise + 48 min" are info boxes, yet each day's times are typed by hand for the next 30 days; preview card; streams table with an embedded preview iframe; non-tradition kinds see only "Live stream".
- **Assistant**: R "What do members see today?" ; W "Set aarti to 12:30 and 4:30 PM" (rules, `settings.manage`) ; W+C "Enter tomorrow's sunrise 7:14, sunset 7:21" (religious observance times: show the computed navkarsi/chauvihar and require a human to confirm; no sunrise computation exists in the DB, so the assistant must not invent times: needs a verified source or a proposed `suggest_daily_timings(p_date)` that computes and cites its method) ; W "Mark the derasar stream live" (stream metadata).
- **Visual / fresh design**: the member-home preview and stream preview stay. Fresh design: one "Today" board with a date strip; timings generated from the stated rules and shown for review, hand overrides marked.

#### 20. Practices & points — `/content/practices` (`content/practices/page.tsx`, `practice-form.tsx`)
- **Who**: view `content.*`; practices `content.manage`; points rules `settings.manage`.
- **Jobs**: My Jain Way practice catalog and the points/streak/Saathi rules.
- **Pattern / friction**: catalog table + 6 numeric rules (`savePointsRulesAction` writes `centers.rules`). Footnote: "Streak rest days are stored here; the streak counter does not apply them yet" (a setting that does nothing).- **Assistant**: R "How many points does a full day earn?" ; W+C "Make anumodana worth 3 points" (changes standings for every member; show before/after) ; W "Add the practice 'Samayik' 48 minutes, 10 points" (draft-like; low). The assistant should flag settings that are stored but not applied.
- **Visual / fresh design**: table remains; rules as a small preview ("a family with 3 practices earns …").

#### 21. Gyan Path — `/content/gyan-path[?goal=id]` (`content/gyan-path/page.tsx`, `homework-*.tsx`, `homework-actions.ts`)
- **Who**: view `content.*`; curriculum `content.manage`; homework: `content.manage`, `pathshala.manage`, or a class `teacher` for their own class (`homeworkAreas`).
- **Jobs**: goals, levels, steps (learn/quiz/recite), treasure levels, teacher sign-off, homework per level with reminders.
- **Pattern / friction**: goals table (learners, completion), selected goal's levels table, drawers for goal/level/steps/homework (many fields: kinds, files, points, due rule, reminder hours, parent check, reviewer). Heavy, drawer-in-drawer; homework publish notifies learners and parents.
- **Assistant**: W (draft) "Add homework to Level 3 for Class 2B: record yourself reciting, 20 points, due next Sunday, parent checks" → `save_gyan_assignment` RPC (draft); **W+C** "Publish it" → `set_gyan_assignment_status` RPC; job `homework.publish_notify` tells learners and children's parents: confirm with counts; R "Who has not handed in?" (`gyan_homework_queue` etc.).
- **Visual / fresh design**: the level-step ladder is visual (path with treasure markers). Fresh design: curriculum map instead of nested tables; homework as a card on the level.

#### 22. Library — `/content/library` (`content/library/page.tsx`, `item-form.tsx`)
- **Who**: view `content.*`; draft `content.draft`/`manage`. Items edited are re-sent through approval.
- **Jobs**: pachchakhan (name, timing rule, sutra text, audio) and audio lessons.
- **Pattern / friction**: two tables, drawer form. Status words "Approved/To record". Separate from Media library (stavans, videos, podcasts, recipes) although both are "things members play". Editing a published item pulls it back into review (the drawer says so).
- **Assistant**: W (draft) "Add an audio lesson 'Navkar Mantra explained', series Jainism 1, 6 min, with this transcript" ; W "Send for approval" (low: goes to a human queue) ; R "Which pachchakhan have no audio?"
- **Visual / fresh design**: merge Library and Media library into one "Library" with kind filters; audio recording/upload stays a visual file step.

#### 23. Media library — `/content/media` (`content/media/page.tsx`, `media-item-form.tsx`, `actions.ts`, `upload.ts`)
- **Who**: view `content.*`; draft `content.draft`/`manage`; upload (signed URL) `content.manage`. Likes counts via `media_like_counts` RPC.
- **Jobs**: stavans, videos, podcasts, recipes with files up to 50 MB or links.
- **Pattern / friction**: four card-tables by kind; large drawer with file upload progress (XHR), language, artist, duration, links. File size rule: put larger videos on YouTube. Different people may add and publish.
- **Assistant**: W "Add this YouTube link as a stavan by Hemant Chauhan, Gujarati" (metadata + link) ; R "What are members liking most?" (counts only) ; file uploads stay human (browser-direct to Storage).
- **Visual / fresh design**: grid with artwork/thumbnails, drag-and-drop upload, playlist preview.

#### 24. Photo albums — `/content/photos` (`content/photos/page.tsx`)
- **Who**: view `content.*`; create/moderate `content.manage`.
- **Jobs**: albums (linked to events), pending member uploads, Google Photos import.
- **Pattern / friction**: albums table with pending counts + "New album" drawer + a Rules note ("Photos with children appear only after approval and only for families who opted in…"). The drawer subtitle says "photos upload from the ops app or web", but no admin upload is on the page (only import via a Google Photos link on the album page).
- **Assistant**: W "Create an album for Diwali Dinner linked to the event" ; R "How many photos are waiting and in which albums?" ; W "Import the Google Photos link on this album" (`import_external_album` RPC; photos arrive pending).
- **Visual / fresh design**: cover thumbnails per album; event page shows its album; upload dropzone.

#### 25. Album — `/content/photos/[id]` (`content/photos/[id]/page.tsx`)
- **Who**: `content` view; moderate `content.manage`.
- **Jobs**: review photos (waiting/approved/rejected), see "contains children", approve/reject one or all, import status.
- **Pattern / friction**: thumbnail grid with signed URLs, status chips, per-photo buttons, "Approve all waiting" with a warning when children appear. Uploader shown as staff name, "Member" or "Imported from Google Photos". The consent rule (children's photos only for opted-in families) is stated in copy; nothing on this page shows which families are opted in, so the approver cannot see the effect of approving.
- **Assistant**: R counts and who uploaded; W+C "Approve all waiting in this album" only when none `contains_children` and a human has *seen* the grid (consent-sensitive: faces of children); W "Reject this one" (reversible via moderate status). The assistant should never approve photos on its own judgement.
- **Visual / fresh design**: inherently visual: a large review grid with keyboard approve/reject, filter "children present", undo.

#### 26. Niva — `/content/niva` (`content/niva/page.tsx` + ~10 components, `actions.ts`, `discover-actions.ts`)
- **Who**: view `content.*`; draft `content.draft`; manage/approve `content.manage`/`content.approve`; module `niva`.
- **Jobs**: maintain the sources Niva (the member-facing assistant) answers from; import web pages; test; handle unanswered questions; see usage/health.
- **Pattern / friction**: densest page in the area (587 lines): health alert, knowledge sources (grouped by imported page, paginated), Test Niva box (polls a job), "answers from" settings, import from web page/sitemap discovery, guardrails (fixed text), approval card, unanswered questions with retry, recent Q&A, staff tests. Async everywhere ("reload in a minute").
- **Assistant**: R "What could Niva not answer this week?" ; W (draft → in_review) "Draft a source that answers the top 3 unanswered questions from our guide and website" (religious/organisational content: drafts only, to the approval queue, with the source text visible); W "Try the unanswered questions again" (`niva_retry_unanswered`, spends AI calls/monthly limit: summary-confirm) ; W "Import these 5 pages" (`niva_import_pages` RPC; imported as drafts) ; test question (`niva_test_ask`).
- **Visual / fresh design**: this is the one place where an assistant already exists (member-facing). Fresh design: one *admin* assistant that sees Niva's gaps as its own to-do list ("3 questions members asked that we can't answer — draft sources?").

#### 27. Guide & directory — `/content/guide` (`content/guide/page.tsx`, `zone-lead-button.tsx`)
- **Who**: view `content.*`; guide sections `content.manage`; zone leads need `roles.manage` (and step-up); family counts need `people.view`.
- **Jobs**: edit the New-to-center guide; see zones and their leads; see roster and groups.
- **Pattern / friction**: five cards on one page; four are read-only mirrors of data edited in Settings/Setup/Volunteers (A1.4); only guide sections and zone-lead assignment write. Zone lead assign opens the Settings role-grant form in a drawer.
- **Assistant**: W "Update the 'Parking' guide section: use the north lot after 10am" (`guide_sections` upsert; members/guests see it at once: summary-confirm for `public` sections) ; **W+C (roles, step-up)** "Make Raj the West zone lead" → role grant (existing form logic, trigger-enforced step-up) ; R "Which zones have no lead?"
- **Visual / fresh design**: guide as pages with preview and a public/members toggle; the zone/roster/groups panels become one *Directory* with links to the right editor (or inline edit).

#### 28. Legal & waivers — `/content/legal` (`content/legal/page.tsx`)
- **Who**: view `content.*`; edit/publish `settings.manage`; signature counts need `privacy.manage` or `settings.manage`.
- **Jobs**: policies, terms, notices, consents, waivers (adult/minor), versions, yearly re-sign, acceptance counts.
- **Pattern / friction**: documents table (version, published, where in app, answers, re-sign), draft/new version drawers, publish. "Remind unsigned" buttons are disabled because no in-app reminder sender exists. Publishing forces every member to re-accept at next sign-in (stated only in a footer card).
- **Assistant**: R "How many have signed the volunteer waiver v4?" (counts via `member_legal_acceptance_counts` RPC) ; W (draft) "Draft v5 of the photo consent adding school-age children" (draft only, flagged "needs review by someone qualified"); **W+C (everyone must re-accept)** "Publish v5" typed confirm showing who must re-sign.
- **Visual / fresh design**: side-by-side diff between versions; acceptance progress bars; reminders appear when the sender exists.

---

## D. Where an assistant helps most in these areas (ranked)

1. **Event lifecycle concierge** (create/clone → tune → publish → announce → day-of → feedback). Biggest win: collapses builder + 7 tabs + comms + survey.
2. **"What needs me?"** — one read across approvals, unassigned questions, WhatsApp requests, waivers, unfilled shifts, overdue checklist, survey due (extends `comms-content-tasks.tsx` and `home-tasks.ts`).
3. **Compose-and-route messages** — drafting (en/gu/hi), audience in plain words, recipient + quiet-hour preview, approval routing (needs B1, B2, B8 first).
4. **Inbox triage and drafted replies** from approved sources, with household card.
5. **Feedback analysis** — themes, trend vs last event, forwarding flagged comments.
6. **Content ops** — draft guide sections, library metadata, Niva sources from unanswered questions; always into the approval queue.
7. **Calendar clash/lookup** — answer "is that day free, is it a parva".

## E. What must stay a visual surface

Flyer designer and poster editor; photo review grid; media upload with progress; question builders; slot ladder and live board; calendar grid; approval reading view with diffs; message previews per channel; charts for feedback. The assistant fills and explains them; it does not replace them.

## F. Proposed new RPCs (names are suggestions)

`event_summary`, `clone_event`, `update_event` (patch), `set_event_status` (state machine + notices), `promote_waitlist`/staff wrappers around `submit_rsvp`/`cancel_rsvp`, `event_lesson_add`, `my_event_rights`, `campaign_recipients` (list + per-channel counts + quiet-hours delay), `submit_campaign` / `approve_campaign` / `schedule_campaign` (carry the approval rules), a campaign fan-out into `enqueue_message`, `calendar_window`, `feedback_summary`, `suggest_daily_timings`, `restore_*`/soft delete for shifts, assignments and calendar entries, and an `assistant` value for `client_app` in the audit context.
