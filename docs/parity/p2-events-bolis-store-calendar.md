# Prototype vs app parity audit: Events, Bolis, Satvik Store, Calendar

This was read-only. I edited nothing. Prototype screenshots are in `/tmp/claude-0/audit/`: `Events-*.png`, `Bolis-*.png`, `Bolis-drawer.png`, `Satvik_Store-*.png` and `Calendar-Layers.png`. They were rendered as the "Center admin" persona.

Prototype source is `connect-crm/docs/handoff/prototypes/source/AdminPortal.dc.html`. The relevant parts are:
- Events: L546–577
- Bolis: L610–615
- Store: L617–621
- Calendar: L638
- Boli drawer: L759–765
- Seed data: L307–337
- Mock API effects: L443–449
- Nav: L786

## Headline findings

1. **connect-crm has none of these four modules.**
   - Its nav (`connect-crm/src/lib/permissions.ts:146-186`) has no Events, Bolis, Store or Calendar.
   - Only fragments exist:
     - Rule keys `lunch.*`, `boli.step_cents`, `boli.soft_close_minutes`, `store.gift_pack_cents` and `store.cancel_hours_before_pickup` in `src/lib/center-rules.ts:81-99`. They are edited as raw JSON in Settings → Center.
     - A "boli" campaign kind (`giving/campaigns/actions.ts:10`).
     - Event scope for role grants (`settings/roles`).
   - Everything below lives in **connect-admin** and must **MOVE**.
   - The DB schema already lives in connect-crm (`supabase/migrations/0004_events.sql`, `0005_store.sql`, `0007_learning_content_calendar.sql`), so only UI, actions and lib need to move.
2. **The prototype and the app are organised differently.**
   - The prototype puts each module on one page with tabs: Events has 4 tabs, Bolis 2, Store 3, Calendar 1.
   - The app uses list → detail pages. The event detail has 6 tabs, and check-in and kitchen are separate full-screen routes.
   - Several prototype screens are admin *dashboards*, while the app has only *operator tools*. Live check-in and Orders-by-pickup are the clearest cases.
3. **Several items in your scope list are not in the prototype at all.** Templates/actions, RSVPs, walk-ins, the waitlist queue, volunteers, tithi tables and special days fall in this group.
   - They exist only in the app, and I mark them EXTRA-IN-APP below.
   - They should be kept, but the prototype gives no design for them.
   - Special days appear in the prototype under Giving › Labh fulfillment (L607), which is outside this scope.

## Module 1: Events

Prototype: nav "Events" (permission `events.view`), tabs `['All events','Event builder','Live check-in','Feedback']` (L547). The simulated API paths are `/events`, `/events/EV-906`, `/events/EV-901/checkin` and `/feedback` (L460).

App: `connect-admin/src/app/(console)/events/*` and `ops/[eventId]/*`. Its nav (`src/lib/nav.ts:23-32`) groups Events, Check-in, Kitchen display and Bolis under an "Events" section.

### 1.1 All events (sub 0)
Reached via nav → Events. App: `events/page.tsx`.

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Title | "Events" | "Events" with kicker "Events" (L47-51) | MATCH (the kicker is EXTRA) |
| Subtitle | "RSVPs, eligibility, waitlists, lunch slots and volunteers" | "RSVPs, checklists, volunteers, lunch slots and the day-of report." (L51) | DIFFERS |
| Page action | "New event" (navy pill, primary) → goes to the Event builder tab; needs `events.manage` | "New event" link to `/events/new`, class `btn-maroon` (L53-57) | Behaviour MATCH, colour DIFFERS (maroon vs navy) |
| Tabs | the 4 module tabs | "Upcoming / Past / No date yet" (L60-67) | DIFFERS (the app tabs filter the list, not the module) |
| Status filter chips | none | "Any status, Draft, Published, Rsvp closed, Live, Completed, Cancelled" (L68-78) | EXTRA-IN-APP |
| Table title | "Upcoming" | none (just a Card) | MISSING |
| Columns | ID · EVENT · DATE · AUDIENCE · RSVP · CONFIRMED · CAP · WAITLIST · STATUS | Event (with venue/Pathshala-year subline) · When · Audience · RSVPs ("N households · cap X", with "N confirmed" underneath) · Status (L87-91, 113-116) | DIFFERS: no ID column; CONFIRMED and CAP are folded into RSVPs; **WAITLIST missing** |
| RSVP count unit | people (340) | households (L114) | DIFFERS |
| Status display | coloured bold text ("Draft" brown #8A4608, otherwise green) | `Badge` pill (L118) | DIFFERS (visual) |
| Row click | whole row is clickable and opens the builder, or Live check-in for a live event | only the name is a link, to `/events/{id}` (L102) | DIFFERS |

### 1.2 Event builder (sub 1)
Reached via tab, "New event", or clicking a draft row. App: `events/new/page.tsx` plus `events/event-form.tsx`. Editing happens in `events/[id]` → Details tab (`details-tab.tsx:10-23`).

**Layout.** The prototype is a 12-column grid:
- "Details and audience" form (span 7) next to "Lunch slots" (span 5).
- "Preview with these settings" (span 7) next to a "Publish" note (span 5).
- A button row.

The app is one single-column form of `fieldset`s in one Card: Event → Audience and RSVP → Donation commitment at RSVP → Lunch slots → Tickets.

| Element | Prototype | App (event-form.tsx) | Verdict |
|---|---|---|---|
| Title / subtitle | "Event builder" / "Diwali puja & new year · Sun, Nov 8 · draft" | "New event" / "Saved as a draft. Publish it from the event page when it's ready." (new/page.tsx:14) | DIFFERS |
| Card title | "Details and audience" | two legends, "Event" and "Audience and RSVP" (L32, L61) | DIFFERS |
| Event name | text input, span 2 | "Name", required (L34-36) | Label DIFFERS ("Event name" vs "Name") |
| Starts / Ends / Venue / Pathshala year / Flyer / Owner / Description / Confidential | not in prototype (the prototype has **no date field**) | L37-57 | EXTRA-IN-APP (keep them; the prototype omits them) |
| Who can RSVP | chips: Everyone · Members · Life members only · Pathshala families | `<Select>`: Members and guests (default) · Members only · Life members only · Pathshala families · Everyone (public) (L63-75) | DIFFERS (chips vs select; 5 options vs 4; labels and default differ) |
| Capacity | text, default "600" | number, "Leave blank for no limit" (L76-78) | MATCH (plus a hint) |
| Waitlist | toggle: "On · auto-offer freed seats" / "Off" | checkbox "Waitlist when full (auto-offer freed seats)", default **off** (L89) | DIFFERS (toggle vs checkbox; the prototype defaults to on) |
| RSVP opens / closes | not present | L79-84 | EXTRA-IN-APP |
| Donation commitment at RSVP | one toggle: "Per person $3/$5/$7 or lump sum $10/$25/$50/open" | a fieldset with a checkbox, two comma-separated $ inputs and an "Allow an open amount" checkbox (L98-110). Defaults are 300/500/700 and 1000/2500/5000 cents plus open, so the values match. | DIFFERS (control shape) |
| Confirmation reminder | toggle: "24 hours before · push, SMS or WhatsApp for guests" | number "Confirmation reminder (hours before)", default 24 (L85-87) | DIFFERS (control; the channel copy is missing) |
| Attendee questions | info: "Child under 12 · Senior · Assistance required · Add guest · Guest RSVP by phone without the app" | "Ask about each attendee": three checkboxes, Child under 12 / Senior / Needs assistance (L90-95) | DIFFERS. The "Add guest" and "Guest RSVP by phone" features exist elsewhere, in the RSVPs tab form and the walk-in panel, but are not listed here. |
| Card "Lunch slots" | Lunch starts (info "12:00 PM") · Slot length chips 15/20/30 min · Seats per slot text "120" · "Priority (from Settings › Rules)" info | Checkbox "Assign lunch slots at check-in" (EXTRA) · Lunch starts datetime · Slot length select 10/15/20/30/45/60 · Seats per slot ("Blank = unlimited") · two priority checkboxes (L112-134) | DIFFERS: chips vs select, extra durations, priority is editable per event instead of read-only from Settings |
| Tickets (Paid event, Member/Guest price) | not present | L136-147 | EXTRA-IN-APP |
| **"Preview with these settings" / "Computed by the slot engine"** | live green preview lines, e.g. "Shah family · 4 (child under 12) → 12:00 PM together"; the Kothari slot is recomputed from seats and slot length | none | **MISSING** |
| "Publish" note | "Publishing opens RSVPs in the member app and guest web pages, schedules reminders, and creates the ops-app check-in list." For view-only roles: "Your role can view but not publish events." | none | MISSING |
| Button: Save draft | flash "Draft saved" | "Create event" or "Save event" (L29) | DIFFERS in label. "Create" inserts status=draft and redirects to `/events/{id}` (actions.ts:82-95). |
| Button: Publish event | primary. POSTs /events with audience and waitlist, sets status "RSVP open", toast "Published · RSVPs open in the member app" | not in the builder. The event page has status buttons (`[id]/page.tsx:29-42, 105-125`): "Publish (open RSVPs)" with a confirm; the toast from actions.ts:118 is "Published — RSVPs open in the member app." Also Close RSVPs, Go live, Mark completed, Reopen, Cancel event. | DIFFERS (a separate page); the lifecycle is EXTRA-IN-APP |
| Validation | none | end after start; RSVP close after open; lunch start required when lunch is on; slot length 5–120; money parse errors (actions.ts:33-80) | EXTRA-IN-APP (good) |

**Event detail page (`events/[id]/page.tsx`).** It has no prototype screen. Tabs: Details · Checklist · RSVPs · Volunteers · Lunch · Report (L20-27). The header has "Check-in screen" and "Kitchen display" buttons (L90-100).
- **Checklist tab** (`checklist-tab.tsx`) is EXTRA-IN-APP. It shows pre/during/after action phases, "✓ Done", "Add an action to this event" and "Lessons learned". It links to Pathshala committee templates (L37-44) and pushes lessons back to the template (L118-120). The prototype has no templates or actions for events.
- **RSVPs tab** (`rsvps-tab.tsx`) is EXTRA-IN-APP.
  - KPIs: RSVP'd people / Confirmed / Checked in / Flags (L48-58).
  - Status filter chips, including waitlisted (L59-75).
  - Per-RSVP card with actions Confirm · Offer a seat (waitlist → rsvpd) · Cancel · No-show · Reopen (L132-153).
  - "Add a guest RSVP" form: Party name, Mobile, Email, People textarea, "Already confirmed" (L164-184).
  - This is the only waitlist-management UI. The prototype only shows a waitlist count.
- **Volunteers tab** (`volunteers-tab.tsx`) is EXTRA-IN-APP.
  - Shifts per station (Entry/Food/Gifts/Kitchen/Parking/App help desk), a "Needs N" badge, and assign/confirm/no-show/remove.
  - "Give check-in access" / "Give kitchen access" buttons.
  - The prototype's only volunteer touchpoint is the Home task "3 volunteers missing signed waivers" (L522). Its button "Open event" goes to **events tab 2 (Live check-in)**, which looks like a prototype bug. The seed field `waivers` (L308-313) is never shown.
  - The app shows no waiver status per volunteer here. Waivers are handled on `volunteers/page.tsx`, per group ("Waiver required").
- **Lunch tab** (`lunch-tab.tsx`) is the nearest match to the prototype check-in "Lunch slots" table. See 1.3.
- **Report tab** (`report-tab.tsx`) is EXTRA-IN-APP: Funnel, Scans by station, Lunch by slot, and a "Not checked in" list.

### 1.3 Live check-in (sub 2)
Reached via tab (the prototype pins it to EV-901). App: there is **no admin dashboard**. The pieces are:
- `ops/[eventId]/checkin/*`: a phone-first volunteer scanner, not a dashboard.
- The Lunch and Report tabs of the event page.
- `ops/[eventId]/kitchen/page.tsx`.

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Title / subtitle | "Live check-in" / "Tapasvi Bahuman & Swamivatsalya · Stafford Center · updates every few seconds" | ops layout: "VOLUNTEER MODE" + event name on a dark navy bar with an "Exit" button (ops/layout.tsx:23-31) | DIFFERS. The ops screen has its own chrome, outside the admin shell. |
| Auto-refresh | "updates every few seconds" | check-in counter updates only after its own scans; `AutoRefresh` is used on the boli page only | MISSING for a monitoring view |
| Page action | "Simulate 25 check-ins" (demo only, `events.checkin`) | n/a | Ignore (prototype-only) |
| KPI "Checked in" 211 "of 298 confirmed" | | status strip "**N** of M checked in", where M = all non-cancelled attendees, not confirmed ones (checkin/page.tsx:20-25; checkin-screen.tsx:399-406) | DIFFERS (denominator; strip vs KPI tile) |
| KPI "Walk-ins" 9 "registered at the door" | | only in the Report tab ("N walk-ins (P parties)", report-tab.tsx:36) | MISSING here |
| KPI "Waitlist" 0 "all seats offered" | | none | MISSING |
| KPI "Median check-in" "6 s" "per family" | | none (scan_log has no timing KPI) | MISSING |
| Table "Lunch slots": SLOT · SEATS · ASSIGNED · STATUS (Serving/Next/Queued/Open; serving row highlighted) | | Lunch tab: Slot · Seats (inline editable) · Assigned ("· N left") · **Served** · Status (Now serving/Done/Scheduled) · Control (Now serving / Done / Reset) (lunch-tab.tsx:60-123). The kitchen screen also has "Headcount by slot" with "Start serving"/"Done" (kitchen/page.tsx:119-139). | DIFFERS: status vocabulary ("Next", "Queued", "Open" vs "Scheduled"); Served and Control columns are EXTRA |
| Table "Recent check-ins": TIME · FAMILY · LUNCH | | none. The scanner shows only the last notice ("✓ Checked in 4 · Shah family · Lunch 12:00 PM", checkin-screen.tsx:327). | MISSING |
| Walk-ins (your scope) | only the KPI | "Walk-in by phone" button → `walk-in-panel.tsx`. It does phone lookup; detects "{label} already has an RSVP"; ticks who is here for member families without an RSVP; registers a guest party (name plus people textarea); needs a connection. | EXTRA-IN-APP (no prototype design) |
| Station switcher Entry/Food/Gifts, Kiosk mode, camera scanner, offline queue "N waiting to sync" | not in the admin prototype (belongs to the Volunteer/ops prototype) | checkin-screen.tsx:20-24, 399-530 | EXTRA-IN-APP |

### 1.4 Feedback (sub 3)
Reached via tab or the Home "Paryushan feedback" task. App: nothing event-specific. The closest things are the **Comms → Surveys** tab (`comms/page.tsx:180-231`) and `comms/surveys/[id]/page.tsx`, which is a generic survey builder whose audience can target event attendees.

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Title / subtitle | "Event feedback" / "Surveys after each event · members can answer anonymously · results aggregated here" | "Communications" page; Surveys tab | MISSING (wrong module) |
| "Request feedback" button | confirm modal: kicker "SEND FEEDBACK REQUEST", "Ask Tapasvi Bahuman attendees for feedback?", body about push/SMS to checked-in attendees plus a reminder after 3 days, button "Schedule request". Then POST /feedback/request marks the survey "Scheduled"; toast "Feedback request scheduled for Mon 9 AM · reminder Thu". | none. The closest is Comms "Open survey" (surveys/[id]:56). | MISSING |
| Table "Surveys": EVENT · SENT · RESPONSES · RATE · AVG · NPS · STATUS (Closed green / Not sent amber / Scheduled purple) | | card list: status badge, title link, "N responses · anonymous" (comms/page.tsx:186-197) | DIFFERS: no event link, rate, avg or NPS |
| KPIs "Paryushan Mahaparva 2026 · results" (5): Responses 212 "38% of 558 attendees" · Anonymous 64% · Overall rating 4.4/5 "+0.2 vs 2025" · NPS +46 · Comments 87 "14 flagged" | | survey detail shows a raw responses table only (surveys/[id]:61-95) | MISSING |
| Bars "Average by area (out of 5)" (red when < 3.8) and "What people attended" | | none | MISSING |
| Table "Comments": FROM · RATING · AREA · COMMENT; filter chips All/Program/Food/Organization/Venue; hint "Anonymous answers never show a name, household or device, even to admins" | | responses table; the From column is hidden when anonymous (surveys/[id]:69,83) | DIFFERS (no area filter or star rating; no flagging) |
| Form "Survey template" | Questions info "Overall stars · 4 area ratings · likelihood to recommend (0–10) · what did you attend · open comment" · Anonymous toggle "Allowed · member chooses" · When to send chips (Right after / **Next morning** / 2 days later) · Reminder chips (None / **Once after 3 days**) · Who receives it info · "Save template" (toast "event feedback survey template · saved and audited") | generic "New survey": Title, Intro, QuestionsBuilder, Opens/Closes, "Anonymous answers (no names stored)" checkbox, audience fields | DIFFERS / MISSING (no standard event template, no send timing or reminder) |
| Note "Exports" | "Results export as combined totals and anonymized comments. A comment that names someone or reports a safety concern is flagged to the event lead…" | none | MISSING |

## Module 2: Bolis

Prototype: nav "Bolis" (`bolis.manage`), tabs `['Digital bolis','In-person upload']` (L611).

App: `(console)/bolis/page.tsx`, `bolis/[id]/page.tsx`, `boli-form.tsx`, `actions.ts`. It sits in the "Events" nav section and the page kicker is "Events" (page.tsx:31).

### 2.1 Digital bolis (sub 0)

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Subtitle | "First recorded pledge wins; every entry is kept so the center can accommodate interested families" | "Digital bolis run in the member app until the cutoff; in-person bolis are recorded in the hall. Both end as pledges." (page.tsx:31) | DIFFERS |
| Tabs | Digital bolis · In-person upload | none (one list covers both kinds) | MISSING |
| Table title | "Digital bolis" | none | MISSING |
| Columns | ID · BOLI · EVENT · FLOOR · TOP · ENTRIES · CUTOFF · STATUS · [Entries] | Boli (event name underneath) · **Kind** · Closes · Top pledge · Pledges · Status (L40-45) | DIFFERS: no ID; no FLOOR (MISSING); EVENT is folded into the name cell; Kind is EXTRA |
| Row action "Entries" / row click | opens a right-hand **drawer** (see 2.2) | name link → full page `/bolis/{id}` | DIFFERS (drawer vs page) |
| Status | green bold text | Badge (open, paused, closed/settled, other) | DIFFERS (visual) |
| Form title | "New digital boli", span 12, 4 columns, on the same page | "New boli" Card below the list (L77-81) | Label DIFFERS |
| Type | chips: "Digital (pledge in app until cutoff)" / "In-person (listed with time it is called)" | "Kind" select: "Digital (members pledge in the app)" / "In person (recorded in the hall)" (boli-form.tsx:14-23) | DIFFERS (chips, copy) |
| Event | info "Diwali puja & new year" | Event select, "No event" allowed (L24-26) | DIFFERS (app is better) |
| **Hall display** | toggle "Show live amounts on the TV" | none; there is no column on `bolis` | **MISSING** (needs schema and UI) |
| Name | "Name", default "Mangal divo, Diwali" | "Item", hint "e.g. First aarti on Samvatsari" (L11-13) | Label DIFFERS |
| Floor ($) | text, 101 | "Starting pledge ($)", default 0 (L27-29) | Label and default DIFFER |
| Step ($) | text, 21 | "Each new pledge must beat the top by ($)", default $21 (L30-32) | Label DIFFERS |
| Ties | info "First recorded wins" | not shown. The confirm copy "earliest wins a tie" appears on close ([id]:97). | MISSING (display) |
| Soft close | toggle: "Extend 5 min on late entries" / "Off (hard close)" | number "Extend when a pledge comes in the last … minutes", "0 = no extension" (L39-41) | DIFFERS (control) |
| Explainer video | info "Attach from Content" | text "Explainer video link" plus EXTRA "Explainer (what this labh means)" textarea and Description (L42-50) | DIFFERS (a free URL, not a picker from Content) |
| Opens / Closes | none (cutoff only in the list) | datetime pair (L33-38) | EXTRA-IN-APP |
| Keep every pledge | implicit | checkbox "Keep every pledge (the center can accommodate all interested families)" (L52) | EXTRA-IN-APP |
| Create boli | POST /bolis → status "Scheduled", toast "Boli scheduled · visible to members at publish time" | "Create boli" → saveBoli inserts a draft; then "Publish" on the detail page | DIFFERS (two steps) |

### 2.2 Boli drawer (row click / "Entries")
The prototype drawer is at L759-765. App: `bolis/[id]/page.tsx`.

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Header | kicker "BOLI · BL-71", title, "Tapasvi Bahuman · floor $501 · closes Sat, Sep 26 · 9 PM" | PageHeader kicker "Boli · Digital", status badge plus event name (L59-70) | DIFFERS (floor and cutoff are in the KPIs instead) |
| KPIs | none | Top pledge · Pledges · Next pledge at least ("step $X") · Closes ("extended by a late pledge") (L72-77); auto-refresh every 15 s while open | EXTRA-IN-APP |
| Section "ALL ENTRIES KEPT · FIRST RECORDED WINS" | "★ Kothari family · Sep 21 8:14 PM" with $751; empty state "No entries yet —" | "Pledges" table: Family · Pledge · When · How (App / In person); winner row green (L103-131); "Your role can see the top pledge but not individual pledges." | DIFFERS (table vs list; no ★; heading copy) |
| Section "AFTER CLOSE" | Winner → "Pledge created on the household"; Other interested families → "Offered similar labh by the coordinator"; Hall display → "Live amounts shown on the TV" | a notice after closing: "Closed. Top pledge $X by … — recorded as a pledge for the family." (L78-84) | DIFFERS / MISSING (no pre-close explainer) |
| "Close early" (bad) | flash "Close early needs a reason · audited" | "Close and record the top pledge" with a confirm (L92-99). **No reason is captured.** | DIFFERS (reason and audit missing) |
| "Accommodate others" (primary) | "Offer similar labh to 5 families · creates draft messages" | none | **MISSING** |
| Publish / Pause / Resume | none | L87-91 | EXTRA-IN-APP |
| "Record in-person pledge" | not in the drawer (the prototype uses bulk upload) | Family picker, amount "At least $X", display name, anonymous (L134-156) | EXTRA-IN-APP (one-by-one entry covers the "one by one" in the prototype subtitle) |
| "Edit boli" | none | Details disclosure containing BoliForm | EXTRA-IN-APP |

### 2.3 In-person upload (sub 1)
**Everything on this tab is MISSING in the app.** grep finds no CSV, upload or bulk code for bolis in connect-admin. connect-crm does have a reusable CSV pattern (`src/lib/csv.ts`, `giving/bank/bank-import.tsx`).

The prototype tab contains:
- Subtitle: "Record results of bolis called in the hall, one by one or in bulk".
- A 3-step bar: "1 · Upload file", "2 · Validate", "3 · Import".
- Note "Template columns": "Boli name, event, household ID or name, amount, called at (time). Download the template, fill it after the event, and upload. Each valid row becomes a pledge on the household."
- Table title "No file uploaded yet" (becomes "Validation results · 20 rows"). Columns: BOLI · EVENT · HOUSEHOLD · AMOUNT · CHECK. Row checks are OK (green) or errors such as "Household not found" and "Below floor ($101)" (red). Empty text: "Upload in-person-bolis.csv to validate".
- Button "Upload in-person-bolis.csv" (requires `bolis.upload`) → validate → "Import 18 valid rows", toast "18 pledges created · 2 rows skipped".

## Module 3: Satvik Store

Prototype: nav "Satvik Store" (`store.manage`), tabs `['Inventory','Menu & pickup','Orders by pickup']`, default Inventory.

App: `(console)/store/page.tsx`, tabs `["orders","menu","windows","inventory"]` (L12), default **orders**, labels humanized to "Orders", "Menu", "Windows", "Inventory" (L105).

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Subtitle (inventory) | "Made to order · sales post to QuickBooks as store income with sales tax, never as donations" | one subtitle for all tabs: "Sales, not giving: menu, pickup windows, orders and stock." (L104) | DIFFERS (the prototype changes the subtitle per tab) |
| Tabs | 3, in the order above | 4, in a different order; "Windows" is a separate tab | DIFFERS |

### 3.1 Inventory

| Element | Prototype | App (store/page.tsx L262-330) | Verdict |
|---|---|---|---|
| Table title / hint | "Inventory" / "Stock of ingredients packs and packaging per item" | "Stock" | DIFFERS |
| Columns | SKU · ITEM · PRICE · STOCK · REORDER AT · STATUS · [buttons] | Item · On hand (with a "Low" badge) · Recent changes | DIFFERS: SKU, PRICE, REORDER AT and STATUS columns MISSING; Recent changes is EXTRA |
| Low stock | status "Low stock" red / "OK" green; whole row highlighted; rule `stock < reorder` | warning "Low" badge; rule `stock_on_hand <= low_stock_threshold` | DIFFERS (≤ vs <; no OK state; no row highlight) |
| Row buttons "−5" / "+10" (primary) | POST /store/adjust with an audit line "Adjusted stock X by +10 (now N)"; needs `store.inventory` | none. Instead a side form "Record a stock change": Item · Reason (Received/Waste/Returned/Adjustment) · Quantity → "Record" (L301-326) | DIFFERS (no quick buttons; the reason-coded form is EXTRA) |
| Items without stock tracking | all items shown | only `track_inventory` items, plus the hint "Turn on 'Track stock'…" | DIFFERS |

### 3.2 Menu & pickup

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Subtitle | "What members see in the store, how orders are cut off and picked up" | shared subtitle | DIFFERS |
| Table "Menu items": SKU · ITEM · CATEGORY · DESCRIPTION · PRICE · GIFT PACK · ACTIVE | | one Card per category; each row shows name · pack size · price · status badge, plus an "Edit" disclosure (L183-196, `ItemList` L333-358) | DIFFERS: not a table; SKU, description and **GIFT PACK** not shown; there is **no gift-pack flag per item in the schema** |
| Item fields | none (read-only table) | Name, Category, Price, Pack size, SKU, Status (Active/Paused/Retired), Low-stock alert at, Description, Taxable, Track stock (L20-58); "Add an item", "Add a category" | EXTRA-IN-APP |
| Form "Order and pickup settings" | Gift packing price 2.99 · Order cutoff "Thursday 9:00 PM" · Cancellation window "Up to 24 hours before pickup" · Pickup slots info "Sat 11 AM–1 PM (60) · Sat 5–7 PM (60) · Sun after the program (80)" · Sales tax info · **Kitchen summary toggle "Send prep list at cutoff"** · **Store visible to chips Everyone / Members only** · Checkout by children "Blocked · ask a parent" · "Save store settings" (toast "store settings · saved and audited") | none on this page. The gift pack price and cancel hours exist only as raw rule JSON in CRM Settings → Center (`center-rules.ts:97-99`). Pickup slots are the "Windows" tab: per-window Pickup starts/ends · Order cutoff · Capacity · Location · Event · Status (L215-259, 360-395). | MISSING as a form; kitchen summary, visibility and child checkout are MISSING entirely; per-window cutoff DIFFERS from the prototype's single weekly cutoff |

### 3.3 Orders by pickup

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Subtitle | "Kitchen prep lists by pickup slot" | shared | DIFFERS |
| Table "This cycle": PICKUP SLOT · ORDERS · GIFT PACKS · STATUS (Preparing/Open) | | the Orders tab is a *pickup-window picker plus "Show"*, then a kanban (Placed / Preparing / Ready). Each card shows #, total, guest or "Member order", lines ("(gift pack)"), gift message, and buttons "Start preparing → Ready for pickup → Picked up" and "Cancel" (L107-176). The kitchen screen has a per-window summary "N orders · N placed · N preparing · N ready" (kitchen/page.tsx:162-177). | DIFFERS: no cross-window summary table or gift-pack count in the console; the kanban is EXTRA-IN-APP |
| Bars "Top items to prepare" (units, green #2F5D50) | | kitchen/page.tsx:150-160 "To prepare" grid "qty× Item", ops route and event-scoped only | DIFFERS (not in the console; list, not bars) |
| Pickup handoff (your scope "pickup") | not a screen | "Picked up" button on the kanban | EXTRA-IN-APP |

## Module 4: Calendar

Prototype: nav "Calendar" (`settings.rules`) at L638. Title "Calendar", subtitle "Layers members can overlay in the app", one tab "Layers". A table (cols 1.6fr 2fr 1.4fr 1fr) with columns LAYER · SOURCE · OWNER · DEFAULT and 7 rows:
- Jain tithi / "Panchang: Shvetambar Murtipujak (configurable)" / Religious coordinator / On
- Pathshala / "Pathshala terms and no-class days" / Pathshala principal / On
- JSH events / "Events module (automatic)" / Event leads / On
- Katy, Fort Bend, Cy-Fair and Houston ISD / "Published district feed" / Platform / "By family"

There are no buttons.

App: there is **no Calendar module**. It is a **Content → "Calendar" tab** (`(console)/content/page.tsx:16, 102-110, 263-311`), gated by `content.manage`/`content.draft` rather than settings.rules.

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Nav item / page title | "Calendar" | inside "Content" ("Content" page, description "…daily timings, calendar and member photo moderation.") | MISSING as a module |
| Layers table (Layer · Source · Owner · Default) | 7 rows | none. Layers are one muted line, "Layers: A, B (shared)" (L283). The schema already has `calendar_layers.kind/source_url/default_on/color`. **Owner has no column in the schema.** | MISSING |
| Default On / "By family" | shown | `default_on` exists but is not displayed or editable | MISSING |
| Upcoming entries list, "Remove", and "Add an entry" (Layer · Title · Date · Until) | none | L264-307 | EXTRA-IN-APP |
| Tithi | layer row only; Panchang source configured in Settings › Integrations (L675), outside scope | `tithi_days` table exists (migration 0007:234), **no admin UI or import** | MISSING (backend only) |
| Special days | not in Calendar (Giving › Labh fulfillment, L607) | `special_days` table, referenced by CRM recurring gifts | Out of scope here |
| Calendar rules | Settings › Rules note "Lunch-slot rules" (L669): "Families with a child under 12 or a senior eat together at lunch start… Slot length and seats are set per event." | CRM `settings/center` raw rules JSON (`lunch.*`, `rsvp.*`, `boli.*`) | DIFFERS (JSON editor vs prose/toggles) |

## Look-and-feel differences (all four modules)

| Aspect | Prototype | connect-admin | connect-crm (target) |
|---|---|---|---|
| Shell | white top bar (60px) with JSH logo, "JSH Admin", centre-switch pill, global search "Search households, people, pledges, events…", avatar, "Sign out" | own shell, `nav.tsx` | **dark navy sidebar**, w-64, "Connect CRM / System of record", grouped sections (`components/shell/app-shell.tsx:36-43`); no global search |
| Sidebar | **white**, 220px, flat list of 14 modules; active item #EEF1F8 bg, #1B2C5C, weight 800; Home badge (#C9731C); footer with role and entitlement count | sectioned lists (Pathshala / Events / More) | navy with uppercase section titles; must become a flat 14-item white list |
| Page header | Fraunces 28px title plus 13px muted subtitle; actions as navy pills (radius 20, min-h 40) | kicker (uppercase, accent colour) plus Fraunces 2xl/3xl; `btn` radius 0.5rem; events uses **maroon** `btn-maroon` | kicker-less PageHeader |
| Tabs | 3px underline, 14px bold, #1B2C5C | 2px underline, `border-navy`, 14px semibold (ui.tsx:196-210) | Tabs component exists |
| Cards | radius 16px, border #E3D9C8, padding 16/18; titles **DM Sans 16px bold** with 12px hint | rounded-xl (12px), `border-line` #E8E0D2; titles **Fraunces 18px** (ui.tsx:66) | similar to admin |
| Tables | CSS-grid rows; header strip on #F6F2EA with 10px radius, 11px uppercase; rows 13px, dividers #F1E8D8; highlighted rows (serving, low stock) | `<table>`; th bottom border only; no header fill (ui.tsx:223-224) | similar |
| Status | coloured bold text (green #1F7A4D, brown #8A4608, red #B3261E) | Badge pills | Badge pills |
| Choices | **chips** (pill, navy border, filled when selected) and **toggle switches** (44×26, green track) | `<select>` and checkboxes everywhere | — |
| Read-only config | `isInfo` sand boxes (#F6F2EA) inside forms | not used | — |
| Feedback | top-centre toast (green or red), confirm modal (radius 22, kicker, Fraunces title) | inline ActionForm messages and `confirm=` dialogs | — |
| Detail | right-hand drawer (460px) | full pages | — |
| Grid | 12-column block grid with spans 7/5, 6/6, 12 | `lg:grid-cols-3` 2+1 | — |
| Background | #F6F2EA page | ground #FBF7F0 | ground #FBF7F0 |

## Prioritised fix list

Unless noted, the target is connect-crm `src/app/(app)/…`. "MOVE" means port the code from connect-admin. That port also brings its dependencies: `lib/access.ts` areas mapped into CRM `lib/permissions.ts` (nav plus `canAccess`), `components/action-form.tsx`, `person-picker.tsx`, `auto-refresh.tsx`, `lib/logic/event-report.ts`, `lib/format.ts`/`forms.ts`/`action-context.ts`, and the `ui.tsx` pieces CRM lacks (`StatGrid`, `Checkbox`, `FormGrid`, `Notice`, `Details`, `Select`, `th`/`td`).

### P1: missing or broken flows
1. **Add the four modules to the portal nav, flat and in prototype order**, with prototype gating (events.view, bolis.manage, store.manage, and settings.rules for Calendar). Files: `connect-crm/src/lib/permissions.ts` (NAV/AccessKey), `components/shell/app-shell.tsx`.
2. **MOVE Events.** Create `events/page.tsx`, `events/new`, `events/[id]/*` and `events/actions.ts` in connect-crm. Then restructure the module tabs to "All events · Event builder · Live check-in · Feedback". Keep RSVPs, Volunteers, Checklist and Report as sub-views of an event, since the prototype has no home for them.
3. **Build an admin "Live check-in" dashboard.** It needs:
   - KPIs: Checked in "of N confirmed", Walk-ins, Waitlist, Median check-in.
   - The Lunch slots table (Serving/Next/Queued/Open).
   - "Recent check-ins" (TIME · FAMILY · LUNCH).
   - Auto-refresh.
   - Sources: `attendees`, `lunch_slots`, `scan_log`. Reuse `lunch-tab.tsx`, `report-tab.tsx` and `event-report.ts`.
   - Also MOVE the ops routes (`ops/[eventId]/checkin/*`, `walk-in-panel.tsx`, `camera-scanner.tsx`, `kitchen/page.tsx`, `ops/[eventId]/actions.ts`, `layout.tsx`). Keep them as a chrome-less volunteer mode, linked from the dashboard. The offline queue lives in `checkin-screen.tsx`.
4. **Build event Feedback.**
   - Event-linked surveys table (Sent/Responses/Rate/Avg/NPS/Status).
   - "Request feedback" confirm modal with scheduling (next morning, reminder after 3 days).
   - Results KPIs, area bars, "What people attended" bars, and a comments table with an area filter.
   - A standard survey template form and the Exports note.
   - Survey plumbing to MOVE from `comms/actions.ts` (saveSurvey), `comms/questions-builder.tsx` and `comms/surveys/[id]`. New: event_id linkage, NPS/area aggregation and send scheduling.
5. **Build Bolis "In-person upload"** (3-step Upload → Validate → Import, template download, per-row checks for household lookup and floor, "Import N valid rows" creating pledges). Reuse CRM `lib/csv.ts` and the bank-import pattern. This needs a server action or RPC for bulk pledge creation.
6. **MOVE Bolis** (`bolis/page.tsx`, `[id]/page.tsx`, `boli-form.tsx`, `actions.ts`). Restructure as tabs "Digital bolis · In-person upload" with the entries **drawer**. Add the missing controls:
   - "Accommodate others" (draft offers to non-winning families).
   - "Close early" with a required, audited reason (`closeBoli` currently takes no reason).
   - **Hall display** (new `bolis` column plus toggle, and ideally a TV view).
7. **MOVE the Store** (`store/page.tsx`, `store/actions.ts`) and rebuild its tabs as "Inventory · Menu & pickup · Orders by pickup":
   - An **"Order and pickup settings" form**: gift pack price, cutoff, cancellation window, pickup slots, sales tax info, kitchen summary toggle, visible-to, children checkout. Back it with the `store.*` rule keys and add new keys to `center-rules.ts`.
   - A console "Orders by pickup" summary with gift-pack counts and "Top items to prepare" bars. Lift these from `kitchen/page.tsx:150-177`.
8. **Build the Calendar module** (`calendar/page.tsx`): a Layers table (Layer · Source · Owner · Default) over `calendar_layers`, with an editable `default_on`. Owner needs a schema column. MOVE the entry list and add-entry form from `content/page.tsx:263-307`. Add a tithi table viewer/import for `tithi_days`, which currently has no UI.

### P2: fields, copy and behaviour
1. **Events list.**
   - Columns: ID, EVENT, DATE, AUDIENCE, RSVP (people), CONFIRMED, CAP, **WAITLIST**, STATUS.
   - "Upcoming" table title; whole-row click; subtitle "RSVPs, eligibility, waitlists, lunch slots and volunteers".
   - Decide whether to keep the Upcoming/Past/No-date and status chips (EXTRA) as filters.
2. **Event builder.**
   - Two-column layout; label "Event name"; audience as chips with the prototype's 4 options (map to the app's 5 enums or reduce them).
   - Waitlist default on, as a toggle.
   - Commitment as a toggle summarising "Per person $3/$5/$7 or lump sum $10/$25/$50/open", with amounts editable behind it.
   - Reminder copy "24 hours before · push, SMS or WhatsApp for guests".
   - Attendee questions to include "Add guest · Guest RSVP by phone without the app".
   - Slot length chips 15/20/30.
   - Priority shown read-only as "(from Settings › Rules)". It is currently editable per event (`event-form.tsx:130-133`); decide which is intended.
   - **Slot-engine preview** panel.
   - "Publish" note (including the view-only role copy).
   - Buttons "Save draft" and "Publish event" in the builder, keeping the existing lifecycle buttons on the event page.
   - Keep the app's extra fields (dates, venue, RSVP window, tickets, owner, flyer).
3. **Live check-in denominator**: "of 298 confirmed" should count confirmed, not all non-cancelled attendees (`checkin/page.tsx:20-25`). Align slot status vocabulary (Serving/Next/Queued/Open vs Now serving/Scheduled/Done).
4. **Bolis.**
   - Subtitle "First recorded pledge wins; every entry is kept…".
   - List columns ID, EVENT, **FLOOR**, TOP, ENTRIES, CUTOFF, STATUS.
   - Form labels Name / Floor ($) / Step ($) / Ties (info) / Soft close toggle ("Extend 5 min on late entries" / "Off (hard close)"); Type chips with the prototype copy; the Explainer video picked from Content.
   - Title "New digital boli"; create toast "Boli scheduled · visible to members at publish time".
   - Drawer copy: "ALL ENTRIES KEPT · FIRST RECORDED WINS" with ★ on the winner and an "AFTER CLOSE" explainer.
5. **Store Inventory.**
   - Columns SKU, PRICE, REORDER AT and STATUS (Low stock / OK).
   - "−5" / "+10" quick-adjust buttons (audited), keeping the reason-coded form.
   - Low rule `<` vs `<=`; show all items.
   - Default tab Inventory; per-tab subtitles.
6. **Store Menu**: render as a table (SKU · ITEM · CATEGORY · DESCRIPTION · PRICE · GIFT PACK · ACTIVE). Add a per-item gift-pack flag (schema: `store_items` has none).
7. **Volunteers**: surface waiver status per assigned volunteer on the event, since the prototype's Home task depends on it (the `waivers` count). Fix the prototype Home "Open event" link, which points to Live check-in; flag this to design. Decide where `volunteers/page.tsx` (EXTRA, no prototype screen) lives. The prototype puts volunteer groups under Content › Guide & directory and waivers under Content › Legal & waivers.
8. **Calendar**: gate on settings.rules as in the prototype (currently content.manage). Title "Calendar", subtitle "Layers members can overlay in the app".
9. **Settings rules**: render the lunch/boli/store rules as the prototype's toggle/info rows instead of raw JSON (`settings/center/center-settings-form.tsx`). This overlaps with the Settings audit.

### P3: visual (apply globally when porting into connect-crm)
1. Shell:
   - White top bar with logo, "JSH Admin", centre switch and global search.
   - White 220px flat sidebar with the #EEF1F8 active state, the Home badge, and the role/entitlement footer.
   - This replaces the navy sectioned sidebar in `app-shell.tsx`.
2. Buttons: pill radius (20px), navy primary, white-with-navy-border secondary. Drop `btn-maroon` on event actions (`events/page.tsx:54`, `event-form.tsx:29`, `boli-form.tsx:9`, the RSVP and volunteer forms).
3. Cards: 16px radius, #E3D9C8 border, **DM Sans 16px bold titles** (not Fraunces 18px) with a 12px hint line; a 12-column span layout (7/5, 6/6).
4. Tables: filled header strip (#F6F2EA, 10px radius, 11px uppercase letter-spaced); 13px rows; #F1E8D8 dividers; row highlight for serving slots and low stock; status as coloured bold text rather than Badge pills (or change the prototype).
5. Form controls: chip groups and 44×26 toggle switches in place of selects and checkboxes; `isInfo` sand read-only boxes.
6. Interaction: top-centre toast; the modal style (22px radius, kicker plus Fraunces title) for confirmations; a right-hand 460px drawer for boli entries instead of a page.
7. Tabs: 3px active underline, bold 14px.
8. KPI tiles: #FBF7F0 fill, 24px/800 value, no border (the app `Stat` has a border and uses Fraunces 3xl).
