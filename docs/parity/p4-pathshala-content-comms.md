# Parity audit: Pathshala, Content and Communications (AdminPortal prototype vs connect-admin and connect-crm)

This was read-only. I edited, committed and pushed nothing.

**Paths used below**
- PROTO = `/home/user/connect-crm/docs/handoff/prototypes/source/AdminPortal.dc.html`. Line numbers are from this file.
- ADM = `/home/user/connect-admin/src/app/(console)`
- CRM = `/home/user/connect-crm/src`

**Screenshots:** I rendered all 14 in-scope prototype tabs, signed in as Center admin, to `/tmp/claude-0/audit/`. The files are `Pathshala-*.png`, `Content-*.png` and `Communications-*.png`. The script is `/tmp/claude-0/audit/shot.js`.

## 0. Headline findings

1. **connect-crm has none of these three modules.**
   - `CRM/lib/permissions.ts` NAV has no Pathshala, Content, Calendar or Communications entry.
   - The CRM only touches these areas in three places:
     - a class-scope picker in `settings/roles` (`pathshala_classes`);
     - the table names `content_items` and `comms_campaigns` in the audit filter (`CRM/app/(app)/audit/page.tsx:38-39`);
     - a "Pathshala income" account label.
   - All UI for these modules lives in connect-admin. It all has to MOVE.
2. **The prototype is narrower than the brief assumes.**
   - Pathshala has only **2 tabs**: Classes, and Gyan Path sign-offs (PROTO 623-624).
   - Content has **9 tabs** (PROTO 626).
   - Communications has **3 tabs**: Newsletters, Inbox, WhatsApp queue (PROTO 640).
   - The prototype has **no** screens for these: terms, enrollment, teacher assignment, attendance-taking, progress reports, class announcements, teacher positions/applications, concerns, committee, message templates, saved segments, surveys, alerts.
   - Surveys appear in the prototype only under **Events › Feedback** (PROTO 563-573).
   - Automatic notifications appear only under **Settings › Notifications** (PROTO 678).
   - Calendar is its **own module**: "Calendar › Layers" (PROTO 638).
3. **connect-admin is a different product shape.**
   - It uses a navy sidebar grouped into "Pathshala / Events / Community" sections.
   - Pages are separate routes, not a tab strip. Most lists are cards, not tables.
   - Screens are forms-first CRUD over the real schema; the prototype shows computed dashboards.
   - Most prototype Content tabs are absent. Several connect-admin features have no prototype screen at all (see §4).
4. **The schema already has most of the missing tables:**
   - `content_items` (kinds: sutra, pachchakhan, audio_lesson, video, guide_page, darshan_stream, niva_source)
   - `photo_albums`, `gyan_goals`, `gyan_levels`, `role_roster`
   - `message_templates`, `saved_segments`
   - `pathshala_progress_reports`, `teacher_positions`, `teacher_applications`
   - `niva_conversations`, `legal_documents`

   Neither app builds UI for them. Only a few schema gaps exist; they are in P2.

---

## 1. PATHSHALA (prototype nav "Pathshala", gated on `pathshala.manage`, PROTO 786)

### 1a. Pathshala › Classes (sub 0, PROTO 624; API `GET /pathshala/classes`, PROTO 460)

**App route:** `ADM/pathshala/page.tsx` (Overview) and `ADM/pathshala/classes/page.tsx` (Classes list + New class form). CRM: MISSING.

| Element | Prototype | App (file:line) | Verdict |
|---|---|---|---|
| Title | "Pathshala" | Overview title is `Term ${term.name}` with kicker "Pathshala" (page.tsx:95-97). Classes page title is "Classes" (classes/page.tsx:43) | DIFFERS |
| Subtitle | "Term: Fall 2026 · registration requires membership · fees billed per child as pledges" | `"{start} – {end} · {status}"` (page.tsx:98) | DIFFERS: copy; membership/fee rule not stated |
| Tabs | "Classes", "Gyan Path sign-offs" | Separate sidebar items: Overview, My classes, Classes, Enrollments, Terms, Gyan Path sign-offs, Announcements, Committee (`ADM/../lib/nav.ts:11-20`) | DIFFERS: sidebar links instead of a 2-tab strip |
| Page actions | none | "Enrollment requests (n)" and "Classes" buttons (page.tsx:101-106) | EXTRA-IN-APP |
| Term switcher | none (single term implied) | TermSwitcher pills (page.tsx:110) | EXTRA-IN-APP |
| KPI 1 | Students **420**, sub "12 on waitlists" | "Students placed" (placed count), sub "N classes"; waitlist is a separate KPI (page.tsx:112-113) | DIFFERS: label, sub and split |
| KPI 2 | Teachers **48**, sub "3 background checks expiring" | none (the 2nd KPI is "Waitlist") | MISSING: teacher count and background-check expiry (data is in `background_checks`, surfaced only in ADM/volunteers) |
| KPI 3 | Attendance **88%**, sub "QR check-in at class" | none as a KPI; attendance appears per class | MISSING: term-wide attendance % |
| KPI 4 | Gyan Path sign-offs **17**, sub "awaiting teachers" | "Gyan Path sign-offs", sub link "awaiting teachers" (page.tsx:114-119) | MATCH (the app links through) |
| KPI 5 | none | "Open concerns" (page.tsx:120-125) | EXTRA-IN-APP |
| Table title | "Classes" | Card "Classes" with description "Attendance column: Today/Last class day…" (page.tsx:128) | MATCH, plus extra hint |
| Columns | CLASS · TEACHER · STUDENTS · ATTENDANCE · TIME | Overview: Class · Teachers · Enrolled · Attendance (no TIME) (page.tsx:138-141). Classes page: Class · Teachers · Roster · Waitlist · When (classes/page.tsx:59-63) | DIFFERS: neither page has the prototype's 5 columns. Overview lacks TIME; Classes lacks ATTENDANCE; headers read TEACHERS/ENROLLED/ROSTER |
| Row: class | Bold name, e.g. "Level 1 · Balvarg" | Linked name, plus a muted level · room line | DIFFERS: extra sub-line; the prototype row is not clickable (no drawer) |
| Row: attendance | "91%" plain | Badge "Done · 91% present" / "Partial · n unmarked" / "Not taken" / "No class", plus a breakdown line (page.tsx:172-190) | DIFFERS: richer badge; the prototype shows a term %, the app shows the last class day |
| Row: time | "Sun 10 AM" | "sunday 10:00–11:30" rendered via CSS `capitalize` (classes/page.tsx:88-90) | DIFFERS: format (use short day and 12-hour "Sun 10 AM") |
| Grouping | one flat table | Classes page groups into one card per track (classes/page.tsx:34-39) | DIFFERS |
| New class form | none | Term, Level, Class name, Room, Capacity, Meets on, Starts, Ends, Class email, "Waitlist when full" (class-form.tsx) | EXTRA-IN-APP (keep: the prototype has no way to create classes) |
| Home task | "17 Gyan Path sign-offs waiting on teachers · 3 background checks expire this month", meta "12 students on class waitlists", button **Open** → Pathshala (PROTO 505) | CRM home `CRM/app/(app)/page.tsx` has no Pathshala task | MISSING |
| Home KPI | "Pathshala students 420 · 88% attendance" (PROTO 525) | none in CRM | MISSING |

### 1b. Pathshala › Gyan Path sign-offs (sub 1, PROTO 623; API `GET /pathshala/signoffs`)

**App route:** `ADM/pathshala/signoffs/page.tsx`; action `decideSignoff` in `ADM/pathshala/actions.ts`. CRM: MISSING.

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Title / sub | "Pathshala" / "Final Gyan Path levels need a teacher sign-off before completion counts toward class level" | "Gyan Path sign-offs" / "Final Gyan Path levels need a teacher's sign-off before they count. You see students in the classes you teach." (signoffs/page.tsx:48-53) | DIFFERS: title and copy |
| Tabs | the module tabs | Sub-tabs "Waiting" / "Decided" (:54-60) | EXTRA-IN-APP (Decided history is useful) |
| Layout | Table "Awaiting sign-off" | One card per student (:66-124) | DIFFERS: needs to be a table |
| Columns | STUDENT · CLASS · GOAL AND LEVEL · TEACHER · STATUS · (actions) | Card shows student; goal · "Level {key}: {name}"; class names · "asked {date}" · reward | DIFFERS. **MISSING the TEACHER column** (the prototype shows the assigned teacher, e.g. "Bhavna Zaveri"). CLASS is shown as "Level 1" (level), the app shows the class name |
| Row data | e.g. "Anya Shah · Level 1 · Learn Navkar Mantra · final recitation · Bhavna Zaveri · Waiting" | goal name and level name; no "final recitation" step text | DIFFERS |
| Status chip | "Waiting" (amber) → after click "Practice more" or "Signed off" (green) | Waiting: none shown. Decided: badge "Signed off" / "Needs work" plus decider and time | DIFFERS: wording "Practice more" vs "Needs work" |
| Button 1 | **Needs practice** (red outline). Click: row → "Practice more", no note required | **Needs work** (btn-danger). Needs a "Note to the student" textarea ("Required for 'Needs work'") (:107-114) | DIFFERS: label; the app requires a note |
| Button 2 | **Sign off** (green). Click: row → "Signed off", audited `POST /config` "Gyan Path sign-off for X" (`pathshala.manage`) | **✓ Sign off** (btn-success), success "Done." (:102-105) | DIFFERS: "✓" prefix; the app writes `gyan_signoffs` (better) |
| Access | `pathshala.manage` (principal) | `pathshala.teach`/`pathshala.manage` or teacher role (access.ts `areas.signoffs`) | EXTRA-IN-APP: teachers also get the screen |

### 1c. Pathshala areas the prototype does NOT show (connect-admin only)

- **Terms** (`ADM/pathshala/terms/page.tsx`, `[id]`, `term-form.tsx`).
  - Table columns: Term · Dates · Registration · Fees · No class · Status.
  - Form fields: name, status (draft/registration/active/closed), first/last day, registration opens/closes, fee per child, family cap, sibling discount %, no-class dates, "Membership required to register".
  - The prototype only implies this in the subtitle ("Term: Fall 2026 · registration requires membership · fees billed per child as pledges") and in Calendar › Layers ("Pathshala terms and no-class days"). **Keep; needed.**
- **Enrollments** (`ADM/pathshala/enrollments/page.tsx`).
  - Tabs: Requested/Waitlisted/Placed/Active/Withdrawn/Completed with counts.
  - Actions per card: Place (class select with "Requested level" optgroup, "Place even if full"), Waitlist, Withdraw (confirm), Reopen request, and a Note.
  - The prototype only says "12 on waitlists". **Keep.**
- **Class detail** (`ADM/pathshala/classes/[id]/page.tsx`).
  - Cards: Roster (Student/Age/Status/Change), Waitlist, Recent class days, Teachers (add via PersonPicker, role teacher/assistant/substitute, Remove), Class details form.
  - This is the only teacher-assignment UI. **Keep.**
- **Attendance** (`ADM/pathshala/classes/[id]/attendance/page.tsx` + `attendance-sheet.tsx`).
  - Date picker, recent-day pills, a 4-state marker per student, a class QR modal ("Scan to mark attendance… changes every 10 minutes"), and "Topic taught".
  - The prototype only has the KPI sub "QR check-in at class". **Keep.**
- **My classes** (teacher landing) (`ADM/pathshala/my-classes/page.tsx`). Buttons: Take attendance / Roster / Sign-offs / Announce to parents. **Keep**; it is the teacher persona, which the prototype lacks.
- **Announcements** (`ADM/pathshala/announcements/page.tsx`).
  - Fields: Send to (class or whole Pathshala), Title, Message ("Parents only — never one-to-one messages to students").
  - Buttons: Save draft / Publish now; Publish/Unpublish/Delete per item.
  - Overlaps the prototype's Communications "Pathshala parents" segment. **Decision:** keep as class-level, or fold into Communications.
- **Committee (EAMS replacement)** (`ADM/pathshala/committee/*`; tabs Dashboard, Actions, Templates, Create year, Concerns, Resolutions — `committee-tabs.tsx:6-13`).
  - Dashboard: Overdue, Due ≤ 3 days, Unassigned, Events ≤ 2 weeks.
  - Actions: owner/backups/due/priority/type/state/confidential/idea.
  - Templates: with a lessons-learned list.
  - Create a Pathshala year from templates.
  - Concerns: log / status / owner / resolution / convert to action.
  - Resolutions: comment period, vote, quorum 4, outcome.
  - **None of this is in the prototype.** The owner must decide whether it stays and under which nav item. It is labelled Pathshala, but it covers events and governance too.
- **Not built anywhere (schema only):**
  - progress reports (`pathshala_progress_reports`)
  - teacher positions (`teacher_positions`)
  - teacher applications (`teacher_applications`)

  The prototype has no screen for them either, so this is a product gap, not a parity gap.

---

## 2. CONTENT (prototype nav "Content", gated on `content.edit` or `content.approve`)

**App route:** a single `ADM/content/page.tsx` with `?tab=` values Guide / Practices / Daily timings / Calendar / Photo queue (page.tsx:12-18). Actions are in `ADM/content/actions.ts`. CRM: MISSING.

Tab-strip comparison:

| # | Prototype tab | App tab | Verdict |
|---|---|---|---|
| 0 | Approval queue | — | MISSING |
| 1 | Today & darshan | "Daily timings" | DIFFERS (different model) |
| 2 | Practices & points | "Practices" | DIFFERS |
| 3 | Gyan Path | — | MISSING |
| 4 | Library | — | MISSING |
| 5 | Photo albums | "Photo queue" (moderation only) | DIFFERS/MISSING |
| 6 | Niva | — | MISSING |
| 7 | Guide & directory | "Guide" (markdown sections) | DIFFERS |
| 8 | Legal & waivers | — | MISSING (volunteers page only stores a waiver *kind*) |
| — | (Calendar is a separate module, PROTO 638) | "Calendar" tab inside Content | DIFFERS: move to a top-level Calendar module |

Other page-level differences:
- **Page subtitle:** the prototype changes it per tab (see below). The app uses one fixed line: "New to JSH guide, practices catalog, daily timings, calendar and member photo moderation." (page.tsx:129). DIFFERS.
- **Permission notice:** the app shows "Your role can draft content items but not edit these areas…" (page.tsx:131). The prototype has none. EXTRA.
- **Permissions:** the prototype uses `content.edit` and `content.approve`. The app uses `content.manage` and `content.draft`, and never uses `content.approve` in the UI. DIFFERS.

### 2.0 Approval queue (PROTO 628)
- **Sub:** "Religious text needs an approver; photos with children are moderated before showing".
- **Columns:** ID · ITEM · TYPE · BY · STATUS · actions.
- **Rows:** CT-51..54 (PROTO 326-331), e.g. "Iriyavahiyam sutra · Gyan Path level 5 text and audio · Religious content · Pathshala team · Awaiting approval".
- **Buttons:** **Return** (red) → `POST /content/approve {reject}` → status "Returned to author". **Approve** (green) → status "Published", flash "CT-51 published", audited (PROTO 437).
- **Home task:** "N items awaiting approval · Includes religious text and photos with children", button **Open** (PROTO 499).
- **App:** MISSING entirely. No UI reads or writes `content_items.status` (draft/in_review/approved/published/retired) or `approved_by`. The photo queue covers only the photo half.

### 2.1 Today & darshan (PROTO 629)
- **Sub:** "Drives Today at JSH on the member Home screen and the Library's live darshan".
- **Form "Daily timings" (span 7)** — rule-based, not per-date:
  - Editable text fields:
    - Derasar hours "7:30 AM – 6:00 PM daily"
    - Aarti "12:30 PM and 4:30 PM"
    - Snatra puja "Sundays 9:30 AM"
  - Read-only info rows:
    - Location for sunrise and sunset: "Center address · members may use their own location"
    - Navkarsi: "Sunrise + 48 minutes"
    - Porsi and Purimaddh: "One and two prahar after sunrise"
    - Chauvihar: "Before sunset"
    - Tithi source: "Panchang in Calendar settings"
  - Button **Save timings**: audited `POST /config`, flash "daily timings · saved and audited".
- **Preview "Member Home preview · today":** "Tue, Sep 22 · Bhadarva sud 11" / "Sunrise 7:14 AM · Navkarsi 8:02 AM · Chauvihar by 7:21 PM" / "Watch live darshan · Aarti at 4:30 PM".
- **Table "Live darshan":** STREAM · SOURCE · SCHEDULE · STATUS. Rows: Derasar camera / Streaming provider · embedded player / 24 hours / Live; Pravachan hall / … recorded to Library / Scheduled events / Idle.
- **App "Daily timings"** (page.tsx:198-261):
  - Card "Next 30 days" with columns Date · Sunrise · Navkarsi · Sunset · Chauvihar · Aarti · Temple.
  - Card "Enter timings for a day": Date plus 7 time pickers, where one saved day replaces that day's times.
- **Verdict: DIFFERS in model.** The prototype computes Navkarsi and Chauvihar from sunrise/sunset rules, with free-text recurring hours. The app makes an admin type every time for every date.
- **MISSING:** Snatra puja, the recurring-hours text, the Location / Tithi-source rows, the Member Home preview, and the entire Live darshan table (data would be `content_items` kind `darshan_stream`).
- **Schema gap:** there is no place for rule-based timings (Derasar hours text, Snatra puja, location source). They would go in the center rules JSON or new columns.

### 2.2 Practices & points (PROTO 630)
- **Sub:** "My Jain Way practice catalog, points, streaks and Saathi rules".
- **Table "Practice catalog" (span 7):** PRACTICE · CATEGORY · DEFAULT TIME · POINTS · ACTIVE. 10 rows, e.g. "Navkar Mantra on waking · Mantra and jaap · 6:45 AM · 5 · Yes"; categories use human labels.
- **Form "Points, streaks and Saathi" (span 5):**
  - Editable:
    - Day-complete bonus "20 points"
    - Streak rest days "1 per month (travel or illness)"
    - Anumodana "5 points · up to 5 a day"
    - Saathi support "3 points · once per person per day"
    - "Behind" after "3 days without practice"
  - Info rows:
    - Standings: "Private to the member · totals only in reports"
    - Saathi alerts go to: "Anumodana senders first, then family · members can opt out"
  - Button **Save rules**: audited.
- **App "Practices"** (page.tsx:160-196): a list (not a table): "Name · category · N pts · N min", with badges Shared/Inactive. Edit/New form fields: Name, Key, Category (free text; hint "e.g. tapasya_pachchakhan"), Minutes, Points, Order, Description, Active.
- **DIFFERS:**
  - The table layout is not used.
  - DEFAULT TIME (time of day) became Minutes (duration). The schema has only `default_minutes`, so this is a schema gap.
  - Category is a raw key, not a pick-list of the six prototype categories.
  - The ACTIVE column is missing.
- **MISSING:** the whole points/Saathi form. Four keys already exist in the center rules JSON: `points.day_complete_bonus`, `anumodana_points`, `anumodana_daily_cap`, `support_points` (`CRM/lib/center-rules.ts:94-97`). Today they can only be edited as raw JSON in CRM Settings › Center. "Streak rest days" and "Behind after" have **no key** (schema/rules gap).

### 2.3 Gyan Path (PROTO 631)
- **Sub:** "Goals, chapters and levels by tradition · each level is learn, quiz, quiz, recite".
- **Action:** **New goal** (primary) → flash "Goal wizard: tradition, chapters, levels, treasure rewards, teacher sign-off".
- **Table "Goals":** GOAL · TRADITION · LEVELS · LEARNERS · COMPLETION, e.g. "Learn Samayik · Shvetambar Murtipujak · 12 · 318 · 41%".
- **Table "Learn Samayik · levels":** # · LEVEL · TEXT · AUDIO · QUIZZES · SIGN-OFF. Statuses Approved / In review / Recorded / To record, "2 questions", "Teacher" on level 12. Hint: "Treasure levels: 4 (Foundations badge), 8 (Logassa badge + 50 points)".
- **App:** MISSING. `gyan_goals`, `gyan_levels` (points, treasure, `requires_teacher_signoff`) and `gyan_steps` exist in the schema. The app reads them only for sign-off labels.

### 2.4 Library (PROTO 632)
- **Sub:** "Pachchakhan library and audio lessons shown under Jain Way › Library and Learn".
- **Table "Pachchakhan":** NAME · TIMING RULE · SUTRA TEXT · AUDIO. 9 rows (Navkarsi…Chauvihar) with Approved / From Pathshala / Recorded / To record.
- **Table "Audio lessons":** LESSON · SERIES · LENGTH · STATUS. 3 rows, e.g. "Navkar Mantra, explained · Jainism 1 · 6 min · Published".
- **App:** MISSING. The data is `content_items` kinds `pachchakhan` and `audio_lesson`, with `metadata` holding timing rules.

### 2.5 Photo albums (PROTO 633)
- **Sub:** "Albums shown under Events › Photos · member uploads wait for moderation".
- **Action:** **New album** → flash "Album linked to an event; photos upload from the ops app or web".
- **Table "Albums":** ALBUM · DATE · ITEMS · MODERATION · VISIBLE TO. 6 rows, e.g. "Mahavir Janma Vanchan 2026 · Sep 12, 2026 · 86 · 12 member uploads waiting · Members".
- **Note "Rules":** "Photos with children appear only after approval and only for families who opted in to photos at onboarding. Members can ask for a photo of their family to be removed."
- **App "Photo queue"** (page.tsx:311-338): card "Awaiting review" with a grid of pending photos (storage path, caption, upload time, "Contains children" badge) and buttons **Approve** / **Reject**.
- **MISSING:**
  - the albums table and the New album flow (`photo_albums`);
  - per-album moderation counts;
  - the Rules note;
  - image thumbnails — the app shows the raw `storage_path` string, not an image.
- The per-photo moderation is EXTRA/useful. It belongs as a drill-down from an album's "N member uploads waiting".

### 2.6 Niva (PROTO 634)
- **Sub:** "JSH Niva answers only from approved sources for this center and always shows the source".
- **Table "Knowledge sources":** SOURCE · ITEMS · UPDATED · STATUS. 5 rows, one "Not included yet".
- **Form "Guardrails"** (4 info rows):
  - Doctrinal questions
  - Personal member data
  - When unsure
  - Conversation logs: "Kept 30 days · never used to train models"
- **Table "Unanswered questions this week":** QUESTION · ASKED. Hint: "Add content to answer these".
- **App:** MISSING. The data is `content_items` kind `niva_source` and `niva_conversations`; the feature flag is off.

### 2.7 Guide & directory (PROTO 635)
- **Sub:** "New to JSH guide, zones and zone leads, administration roster, WhatsApp and volunteer groups".
- **Table "Zones":** ZONE · AREAS · ZIPS · ZONE LEAD · FAMILIES. 7 zones; zone lead shows amber "[Assign lead]".
- **Table "Administration roster":** ROLE · PERSON · TERM ENDS. Hint: "Messages go to the role, so contact follows the person holding it".
- **Table "WhatsApp groups":** GROUP · ADMINS · MEMBERS.
- **Table "Volunteer groups":** GROUP · COORDINATOR. Hint: "Interest forms flow to the volunteer platform".
- **App "Guide"** (page.tsx:133-158): one card per `guide_sections` row showing title, "/slug · public|members only · checklist" and a 3-line body. Edit/New fields: Title, Web address (slug), Order, Text (Markdown), "Visible to guests", "Show as a checklist".
- **Verdict:** the markdown guide editor is EXTRA; the prototype only names the guide in its subtitle.
- **MISSING:**
  - Zones table with zone-lead assignment (`zones` exists; zone_lead is a scoped role in CRM Settings › Roles).
  - Administration roster (`role_roster`).
  - WhatsApp groups list (`whatsapp_groups`).
  - Volunteer groups — they exist in `ADM/volunteers`, but are not shown here.

### 2.8 Legal & waivers (PROTO 636)
- **Sub:** "Policies members accept and waivers volunteers must sign in the app before serving".
- **Table "Documents":** DOCUMENT · VERSION · PUBLISHED · SIGNATURES · RE-SIGN · action. Rows and buttons:
  - Privacy policy v3 → **New version** (flash "Upload, review, publish · members accept at next sign-in")
  - Terms of use v2 → **New version**
  - Volunteer waiver (adults) v4 "312 of 420 active volunteers", Yearly → **Remind unsigned** (flash "108 reminders sent in the app")
  - Volunteer waiver (minors) v2 "61 of 74" → **Remind parents** (flash "13 parent reminders sent")
  - Photo consent v1 (no button)
- **Note "How waivers work":** "…Check-in and teacher assignment are blocked until the current version is signed."
- **App:** MISSING. `legal_documents` and `consents` exist. `ADM/volunteers/page.tsx:27` only records a "Waiver required" kind string on a group. The handover receipt also notes that the waiver/background-check block is not enforced in the DB.

### 2.9 Calendar (separate module, PROTO 638)
- The prototype nav "Calendar" is gated on `settings.rules`; sub "Layers members can overlay in the app".
- **Table:** LAYER · SOURCE · OWNER · DEFAULT. Rows: Jain tithi / Pathshala / JSH events / Katy / Fort Bend / Cy-Fair / Houston ISD.
- **App:** the Content "Calendar" tab (page.tsx:263-309) is a list of upcoming entries with a "Remove" button, plus an "Add an entry" form (Layer, Title, Date, Until). Layers appear only as a comma-separated footnote.
- **DIFFERS:**
  - The layers table (source/owner/default) is missing.
  - It is placed under Content, not in its own module.
  - Manual entry is EXTRA.

---

## 3. COMMUNICATIONS (prototype nav gated on `comms.compose`)

**App route:** `ADM/comms/page.tsx` with tabs Announcements / Inboxes / WhatsApp queue / Surveys / Alerts (page.tsx:26-30). Also `ADM/comms/campaigns/[id]`, `threads/[id]`, `surveys/[id]`, plus `shared.tsx` (CampaignForm), `audience-fields.tsx` and `actions.ts`. CRM: MISSING.

Page-level differences:
- **Page sub:** the prototype changes it per tab. The app uses one fixed line: "Announcements and newsletters, role inboxes, WhatsApp join requests, surveys and alerts." (page.tsx:82). DIFFERS.
- **Tabs:** prototype "Newsletters · Inbox · WhatsApp queue". App "**Announcements** · **Inboxes** · WhatsApp queue · Surveys · Alerts". DIFFERS in labels; Surveys and Alerts are EXTRA.

### 3.0 Newsletters (PROTO 641-650; API `POST /newsletters`, `/newsletters/approve` at PROTO 435-436)
- **Sub:** "Newsletters by email with a push teaser and in-app archive · every email has topic unsubscribe".

| Element | Prototype | App | Verdict |
|---|---|---|---|
| Layout | Form "New newsletter" (span 7) + "Recipients" preview (span 5) on top; "Recent" table below | Campaign cards on the left (col-span 3); "New message" form on the right (col-span 2) (page.tsx:85-123) | DIFFERS |
| Name | text, default "Pathshala fall update · West zone" | none (only "Title / subject") | MISSING: internal name separate from subject |
| Type | none (always a newsletter) | Select Announcement/Newsletter/Event/Pathshala update/Appeal (shared.tsx:38-49) | EXTRA-IN-APP |
| Audience | "Audience (combine segments)": **multi-select chips** All members / Life members / Pathshala parents / West zone / Event attendees / Not on the app. Default Pathshala parents + West zone; each toggle calls `GET /segments/preview` | **Single-choice radio cards** All members / Zones / Pathshala parents / Event RSVPs / Custom (JSON), with sub-pickers for zones, classes, event + RSVP statuses (audience-fields.tsx:96-180) | DIFFERS: segments cannot be combined (intersection), and "Life members" and "Not on the app" are missing as presets. **Custom JSON** is EXTRA and not admin-friendly |
| Channels | chips Email / Push teaser / In-app archive (all on, fixed) | Checkboxes App notification / Email / In-app archive / SMS / WhatsApp (shared.tsx:24-30) | DIFFERS: labels ("Push teaser" vs "App notification"); SMS and WhatsApp are EXTRA |
| Language | chips English / ગુજરાતી / हिन्दी | none (the schema has `translations` jsonb) | MISSING |
| Subject | text, span 2, "Fall term: classes, teachers and dates for West zone families" | "Title / subject" (shared.tsx:55) | DIFFERS: label |
| Message body | **none in the prototype** | "Message" textarea, 8 rows (shared.tsx:58) | EXTRA-IN-APP (needed; the prototype omits a body) |
| Send at | none ("Scheduled for tomorrow 7 AM") | datetime "Send at", hint "Leave blank to send as soon as it's approved" | EXTRA-IN-APP |
| Recipients preview | "Live count": "**N households**" / "Adults only · children never receive email · 23 unsubscribed excluded" / "Needs a second approver (all members or over 500 households)" (amber) or "No approval needed for this audience" (green) | none | **MISSING**: live recipient count and approval-needed indicator |
| Approval threshold | all members **or >500 households** | only `all_members === true` (`ADM/../lib/logic/audience.ts:48-50`) | DIFFERS: the >500 rule is missing |
| Button 1 | **Send test to me** → flash "Test sent to your email" | none | MISSING |
| Button 2 | **Send for approval** (when approval is needed) or **Schedule send** (when not) → `POST /newsletters`; flash "Sent for approval · appears in approvers' tasks" or "Scheduled for tomorrow 7 AM" | only **Save draft** (shared.tsx:35). Then on the detail page: "Approve and schedule" / "Approve (first of two)" → "Approve as second approver" → "Schedule send" → "Back to draft" / "Cancel" (`ADM/comms/campaigns/[id]/page.tsx:82-97`) | DIFFERS: the prototype is one click to submit, then one approver. The app is Save draft → open detail → approve → second approve → schedule. For a small audience the app still needs a `comms.approve` holder, so a compose-only role (e.g. the Pathshala principal, who has `comms.compose` in PROTO 390) **cannot send at all** |
| Two-person rule | the approver must not be the drafter (409 "You drafted this newsletter. Another approver is needed for all-member sends.", PROTO 435) | the second approver must differ from the **first approver** (`approve_as_second`, `CRM/../supabase/migrations/0016_handoff_alignment.sql:57-76`); the drafter may be the first approver | DIFFERS |
| Recent table | "Recent": ID · NAME · AUDIENCE · STATUS · BY · SENT · action. Rows NL-18/17/16, e.g. "Sent · Sep 1 · 62% opened" | Cards: status badge + kind badge + title link + "audience · channels · sends {date}" (page.tsx:92-109) | DIFFERS: not a table. **MISSING:** ID, BY (author), recipient count ("1,184 households"), open-rate ("62% opened") |
| Row action | **Approve** (green) inline when awaiting approval → "Scheduled for tomorrow 7 AM" | not inline; only on the detail page | DIFFERS |
| Status copy | "Awaiting approval" / "Scheduled" / "Sent" | "Waiting for a second approver" / Draft / Scheduled / Sending / Sent / Cancelled | DIFFERS |
| Home task | "Approve "September newsletter"" · audience · drafted by; buttons **Approve**, **Open** (PROTO 497) | CRM home has no comms tasks (`CRM/app/(app)/approvals-queue.tsx` covers giving/people only) | MISSING |
| Templates | not in the prototype | not in the app (`message_templates` unused) | both absent |
| Saved segments | not in the prototype (chips only) | not in the app (`saved_segments` unused) | both absent |

### 3.1 Inbox (PROTO 652; API `POST /inbox/assign`)
- **Sub:** "Questions and zone messages land here, never on personal phones".
- **One table:** ID · FROM · TOPIC · MESSAGE · AGE · ASSIGNEE · action.
  - Example row: "Q-3021 · Shah family · Pathshala · How do we register our 9-year-old this year? · 2 h · Unassigned".
  - Unassigned shows in red. Button **Take it** (primary) assigns to me.
- **App "Inboxes"** (page.tsx:321-386):
  - Left card "Inboxes" lists "All inboxes" and each inbox with counts.
  - Right card lists threads: subject link, "from · date · inbox", badges "Needs reply" and "Yours"/"Assigned"/status.
  - The detail page (`threads/[id]`) has Assign to me / Unassign / Close / Reopen, plus a reply box "Send reply" ("Replies go out from the inbox, never your personal number") with "Close the conversation after replying".
- **DIFFERS:**
  - The layout is not a table.
  - **MISSING columns:** ID, TOPIC, MESSAGE preview, AGE (relative), and ASSIGNEE name. The app shows only "Yours"/"Assigned", not who.
  - There is no inline **Take it**; you must open the thread and press "Assign to me".
- **EXTRA:** the multiple-inbox split, reply, close, and zone-lead scoping. Keep them.
- **Home task:** "N unassigned member questions · Oldest 2 days · reply target 3–5 business days" (PROTO 498). The app shows "Reply within {n} hours" per inbox. The home task is MISSING.

### 3.2 WhatsApp queue (PROTO 653; API `POST /whatsapp/approve`)
- **Sub:** "WhatsApp does not let apps add people automatically, so admins add from this queue".
- **Columns:** ID · PERSON · GROUP · PHONE · STATUS · action. Phone reads "(832) 555-2291"; status Pending/Added; single button **Mark added** (green).
- **App** (page.tsx:137-178): card "Join requests", sub "Approve, add the member in WhatsApp, then mark them added."
  - Columns: Member · Group · Phone · Status · Action.
  - Buttons: **Approve** (when pending), **Mark added**, **Decline** (confirm).
- **DIFFERS:**
  - The ID column is missing.
  - The phone shows raw E.164 (`r.phone_e164`); it should be formatted like "(832) 555-2291".
  - The extra "Approve" step and "Decline" are EXTRA.
  - Added rows are hidden; the prototype keeps them visible as "Added".
- **Home task:** "N WhatsApp join requests" (PROTO 498). MISSING.

### 3.3 Communications features in connect-admin that the prototype lacks
- **Surveys** (page.tsx:180-233, `surveys/[id]`).
  - Fields: Title, Intro, QuestionsBuilder, Opens, Closes, "Anonymous answers (no names stored)", Audience. Buttons: Open / Close / Reopen, plus a Responses card.
  - The prototype's surveys are event feedback under **Events › Feedback**. That screen has the Surveys table (EVENT · SENT · RESPONSES · RATE · AVG · NPS · STATUS), results KPIs, bars, comments with category filters, a survey-template form and a "Request feedback" modal.
  - **Decision:** move surveys under Events › Feedback (out of my scope) or keep a general survey tool.
- **Alerts** (page.tsx:235-306).
  - Fields: Severity Info/Important/Urgent, Title, Message, Starts/Ends, Audience. "Post alert" (confirm), "End now".
  - There is no prototype screen. The closest are the automatic-notification rules in **Settings › Notifications** (PROTO 678). Keep, but decide on placement.

---

## 4. Features only in connect-admin (the owner should decide keep/move)

| Feature | Files | Recommendation |
|---|---|---|
| Terms, Enrollments, Class detail + teacher assignment, Attendance taking + QR, My classes (teacher view) | `ADM/pathshala/terms`, `enrollments`, `classes/[id]`, `classes/[id]/attendance`, `my-classes` | Keep. The prototype's Classes KPIs cannot be produced without them. Put them behind Pathshala tabs or drawers |
| Pathshala announcements | `ADM/pathshala/announcements` | Keep, or fold into Communications with a "Pathshala parents" segment |
| Committee / EAMS replacement (dashboard, actions, templates, create year, concerns, resolutions/voting) | `ADM/pathshala/committee/**`, `ADM/../lib/logic/eams.ts`, `resolutions.ts` | Not in the prototype. Owner decision; if kept, make it a Pathshala tab (e.g. "Committee") or its own nav item |
| Surveys, Alerts | `ADM/comms/page.tsx`, `surveys/[id]` | Not in prototype Communications; see 3.3 |
| Inbox reply/close, multi-inbox | `ADM/comms/threads/[id]` | Keep (the prototype has no reply UI at all) |
| Content › Calendar manual entries | `ADM/content/page.tsx:263-309` | Move to a top-level Calendar module |
| Guide markdown sections | `ADM/content/page.tsx:133-158` | Keep inside "Guide & directory" |
| Per-photo moderation | `ADM/content/page.tsx:311-338` | Keep as an album drill-down |

---

## 5. Look-and-feel differences (all three modules)

| Area | Prototype | connect-admin | connect-crm |
|---|---|---|---|
| Shell | White 60px top bar: JSH logo + "JSH Admin" (Fraunces), center pill, centred search "Search households, people, pledges, events…", avatar + name/role, "Sign out" | Navy "Connect Admin" header/sidebar (`ADM/layout.tsx:17-56`) | Navy sidebar "Connect CRM · System of record" (`CRM/components/shell/app-shell.tsx:36-42`) |
| Sidebar | **White**, 220px, flat list of 14 modules; active item `#EEF1F8` bg and navy 800 weight; orange count badge on Home; footer "{Role} · N entitlements…" | Navy, grouped sections with colour dots (Pathshala purple / Events maroon / Community navy) (`ADM/../components/nav.tsx`) | Navy, grouped "Overview/People/Giving/…" |
| Page bg | `#F6F2EA` | `ground #fbf7f0` | `ground #fbf7f0` |
| Page header | Fraunces 28px title + 13px sub; pill action buttons at the right | PageHeader with coloured uppercase kicker and "back" links | PageHeader |
| Tabs | Underline tabs under the header, 3px navy bottom border, 14px/700 | Pathshala: separate sidebar routes. Content/Comms: `Tabs` (`ADM/../components/ui.tsx:191`) | n/a |
| Cards | radius 16, border `#E3D9C8`, 12-col grid with spans 5/7/8/4 | `rounded-xl`, border `#e8e0d2`, ad-hoc grids | — |
| Tables | Grid table; header row on a `#F6F2EA` rounded pill, 11px/700 uppercase; 13px rows; bold first col; coloured text status (green `#1F7A4D` / amber `#8A4608` / red `#B3261E`); **pill action buttons right-aligned in the row** | `<table>` with bordered th/td; status as **Badge pills**; actions as full `btn` in a column or card footer. Most lists are **cards, not tables** (sign-offs, enrollments, campaigns, surveys, alerts, practices, guide) | crm-table |
| Buttons | Fully rounded pills (radius 14-20), outline "ghost" by default, filled navy primary, green "ok", red-outline "bad" | `btn btn-purple/secondary/success/danger` rectangles (rounded-lg), purple as the Pathshala primary | — |
| Chips | Navy outline pill chips for choices (audience, channels, language) | Radio cards and checkboxes | — |
| Feedback | Green/red toast bottom-right after every action; skeleton shimmer while loading | Inline success/error beside the button via ActionForm (error-surfacing rule) | Same inline rule |
| Right drawer | 460px detail drawer (not used in these three modules) | Separate detail pages | Separate pages |
| KPIs | `#FBF7F0` tiles, 24px/800 coloured number | `Stat` tiles with a tone | `Stat` |

The fonts (Fraunces + DM Sans) and the palette hexes (navy `#1B2C5C`, purple `#5B4B8A`, green `#1F7A4D`, brown `#8A4608`, danger `#B3261E`) match in all three.

---

## 6. Prioritized fix list

### P1 — missing or broken flows (and the move)

1. **Move the three modules into connect-crm as top-level nav items matching PROTO 786.** The items are Pathshala, Content, Calendar and Communications, gated like the prototype: `pathshala.manage`; `content.edit`/`content.approve`; `settings.rules`; `comms.compose`, plus inbox access.
   - Add `ACCESS` keys and NAV entries in `CRM/lib/permissions.ts`.
   - Create `CRM/app/(app)/pathshala/**`, `content/**`, `calendar/**`, `comms/**`.
   - **Move from connect-admin:**
     - `ADM/pathshala/**`: page, classes, `classes/[id]`, attendance + attendance-sheet, enrollments, terms, signoffs, announcements, my-classes, term-switcher, actions.ts; committee only if the owner keeps it.
     - `ADM/content/**`.
     - `ADM/comms/**`: page, `campaigns/[id]`, `threads/[id]`, `surveys/[id]`, shared.tsx, audience-fields.tsx, questions-builder.tsx, actions.ts.
     - Supporting libs: `connect-admin/src/lib/data/pathshala.ts`, `lib/data/people.ts`, `lib/logic/{attendance,audience,eams,resolutions,tokens,offline-queue}.ts`, `lib/access.ts` (the scoped-role helpers `hasScopedRole`, `zoneLeadZoneIds` and the teacher landing), `components/person-picker.tsx`, `ActionForm`/`ActionButton`, `lib/forms.ts`, `lib/result.ts`.
   - Reconcile these with CRM's own `components/action-form.tsx`, `lib/errors.ts` and `ui.tsx`.
   - The teacher-scoped routes (`my-classes`, attendance QR) and the `/ops` check-in are phone-first. Decide whether they stay in connect-admin or come along.
2. **Pathshala tab strip.** Rebuild as two tabs "Classes" and "Gyan Path sign-offs" at `/pathshala`.
   - The Classes tab needs the 4 prototype KPIs: Students + waitlist sub; Teachers + background checks expiring (query `background_checks`); term Attendance %; Gyan Path sign-offs.
   - It needs a single table: CLASS · TEACHER · STUDENTS · ATTENDANCE · TIME.
   - Terms, enrollments and committee go in as extra tabs or header actions.
3. **Content › Approval queue** (new). A table over `content_items` + `photos` with Return/Approve; set `status` and `approved_by`; gate on `content.approve`.
4. **Communications › Newsletters one-screen flow.**
   - Multi-segment chips with a live **Recipients** preview (count, exclusions, approval-needed line).
   - **Send test to me**.
   - **Send for approval / Schedule send** in one click from the compose form.
   - Inline **Approve** in the Recent table.
   - Let `comms.compose` schedule sends under 500 households without an approver.
   - Files: `CRM/app/(app)/comms/page.tsx` (moved), `shared.tsx`, `audience-fields.tsx`, `actions.ts` (`saveCampaign` → submit), `lib/logic/audience.ts` (`requiresSecondApprover`: add the >500 rule, which needs a recipient-count RPC).
   - A DB change (a recipient-count function and `requires_second_approver` logic) is a permissions/money-adjacent rule, so ask the owner.
5. **Home "My tasks" in CRM.** Add the prototype tasks: Pathshala sign-offs/background checks, Newsletter approve, Inbox unassigned, WhatsApp requests, Content awaiting approval (PROTO 497-505). Files: `CRM/app/(app)/page.tsx`, `approvals-queue.tsx`.
6. **Content tabs that do not exist anywhere:**
   - Gyan Path (goals and levels over `gyan_goals`/`gyan_levels`/`gyan_steps`, plus the New goal wizard)
   - Library (pachchakhan + audio lessons over `content_items`)
   - Photo albums (`photo_albums` + New album; nest the existing per-photo moderation under it)
   - Niva (sources, guardrails, unanswered questions)
   - Legal & waivers (`legal_documents`/`consents` with New version / Remind unsigned / Remind parents)
7. **Today & darshan:** a rule-based daily-timings form and preview, plus the Live darshan table (`content_items` kind `darshan_stream`). Keep per-day overrides as the secondary view.

### P2 — fields, copy and behaviour

1. **Sign-offs:**
   - Make it a table with a TEACHER column.
   - Labels **Needs practice** / **Sign off** (drop "✓").
   - Status copy "Waiting / Practice more / Signed off".
   - Make the note optional or match the prototype (the prototype needs no note).
   - Files: `pathshala/signoffs/page.tsx`, `actions.ts decideSignoff`.
2. **Classes:** time format "Sun 10 AM" (today it is lowercase day and 24-hour); show the term attendance %; subtitle "Term: {name} · registration requires membership · fees billed per child as pledges".
3. **Practices:**
   - Show a table PRACTICE · CATEGORY · DEFAULT TIME · POINTS · ACTIVE.
   - Use a category pick-list with human labels.
   - Add a form "Points, streaks and Saathi" that edits the center rules keys `points.*` (`CRM/lib/center-rules.ts:94-97`), instead of raw JSON in Settings › Center.
   - **Schema/rules gaps:** a default time-of-day on `practices` (only `default_minutes` exists), `streak_rest_days_per_month`, and `behind_after_days`.
4. **Guide & directory:** add the Zones table with "Assign lead" (zone_lead grant), the Administration roster (`role_roster`), WhatsApp groups and Volunteer groups next to the existing markdown guide.
5. **Calendar:** a top-level module with the Layers table (LAYER · SOURCE · OWNER · DEFAULT). Move manual entries there from Content.
6. **Newsletter form:**
   - Add **Name** (separate from Subject); rename "Title / subject" to "Subject".
   - Add the **Language** chips (English/ગુજરાતી/हिन्दी) and write `translations`.
   - Rename "App notification" to "Push teaser".
   - Add "Life members" and "Not on the app" presets and allow combining segments.
   - Hide "Custom (JSON)" from normal admins.
   - Relabel the tab "Announcements" to "Newsletters".
7. **Recent table:** show ID, NAME, AUDIENCE with the household count, STATUS ("Awaiting approval"), BY, SENT with the open rate. The open rate needs `recipients_count` and per-message opens, which is partly a schema gap.
8. **Two-person rule:** block the **drafter** from approving (the prototype returns 409). Today only first ≠ second approver is enforced. This is a permissions change, so ask the owner. Files: `ADM/comms/actions.ts approveCampaign`, `supabase/migrations` (new migration).
9. **Inbox:** show a table ID · FROM · TOPIC · MESSAGE · AGE · ASSIGNEE (the person's name) with an inline **Take it**. Keep reply/close on the thread page.
10. **WhatsApp:** add the ID column; format phones "(832) 555-2291"; keep Added rows visible; decide whether the extra "Approve" step stays.
11. **Per-tab subtitles:** use the exact prototype copy on every Content and Comms tab (quoted in §2 and §3), replacing the single fixed descriptions (`ADM/content/page.tsx:129`, `ADM/comms/page.tsx:82`).
12. **Permission names:** align `content.edit`/`content.approve` and `comms.compose` with the schema's `content.draft`/`manage`/`approve` and `comms.view`/`send`/`approve`/`inbox`. Document the mapping in `CRM/docs/ROLES.md`, or rename the prototype-facing checks.

### P3 — visual

1. The shell is the biggest visible gap, but it is shared, not specific to these modules:
   - a white 60px top bar (JSH mark, "JSH Admin", center pill, global search, avatar, Sign out);
   - a **white** 220px sidebar with a flat list of 14 modules and a task-count badge on Home;
   - a role/entitlement footer.

   Files: `CRM/components/shell/app-shell.tsx`, `nav-link.tsx`, `CRM/lib/permissions.ts` NAV (flatten the sections).
2. Page header: Fraunces 28px title plus a 13px sub; pill page actions on the right. Replace the coloured kicker and "back" pattern for module landing pages.
3. Underline tab strip (3px navy active border) for Pathshala, Content and Comms.
4. Lists become the prototype grid table:
   - header pill `#F6F2EA`, uppercase 11px;
   - bold first column;
   - coloured-text statuses instead of Badge pills where the prototype uses text;
   - right-aligned pill row actions (Needs practice/Sign off, Return/Approve, Take it, Mark added).
5. Buttons: pill shape (radius 14-20) with ghost/primary/ok/bad variants. Choice chips as navy outline pills.
6. 12-column block grid with the prototype spans: Newsletters 7/5, Today & darshan 7/5, Practices 7/5, Niva 7/5, Guide 7/5/6/6.
7. Success toast bottom-right in addition to the inline messages; the inline error-with-retry rule still applies. Add loading shimmer skeletons.
8. Photo queue: show real thumbnails instead of `storage_path` text.
