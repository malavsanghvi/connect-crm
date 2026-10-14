# UX audit 04: Pathshala (admin portal, connect-crm)

Read-only audit. Nothing in the repo was changed. 24 `page.tsx` screens covered (list at the end of section A).

Path shorthand: `P` = `src/app/(app)/pathshala`, `L` = `src/lib`.
Sources read: CLAUDE.md, docs/ARCHITECTURE.md, ROLES.md, MODULES.md (Pathshala), parity/p4-pathshala-content-comms.md, PATHSHALA_REGISTRATION_PLAN.md, LEARNING_ASSIGNMENTS_PLAN.md (skimmed), every page.tsx under `P`, the components and Server Actions they use, `L/pathshala/*`, `L/pathshala-registration/*`, `L/data/pathshala.ts`, `L/logic/{attendance,tokens}.ts`, and the 0590/0591 migrations (RPC signatures and guards).

---

## A. The area in one page

### A1. What exists
- Nav (`L/permissions.ts` ~L430-450): 9 tabs (Classes, Gyan Path sign-offs, Homework, Terms, Levels, Enrollments, Teacher positions, Committee, My classes) plus Committee's own 6 chips (Dashboard, Actions, Templates, Create year, Concerns, Resolutions). Announcements has no tab; it hides behind a ghost button on Classes and a button on My classes. A term's Fees and rules page has no tab; it hides behind a link on Terms.
- Actors: principal (`pathshala.manage`, or `.view` read-only), teacher (class-scoped `teacher` grant, or center-wide), treasurer (`giving.manage`: only Terms and Fees after registration opens), committee (`events.*`, `governance.*`), content team (homework queue).
- Server Actions use the signed-in user's own Supabase client (`actionContext()` in `L/pathshala/server.ts` returns `viewer.db`). No service key anywhere in this area. Every action re-checks the permission and returns `{ ok, error }` via `runAction` (`L/forms.ts`), shown inline plus a toast by `ActionForm` (`src/components/action-form.tsx`), with the step-up modal for CCSTP. This is the contract the assistant must reuse.

### A2. Biggest cross-cutting friction patterns
1. **The landing page reports, it does not tell you what to do.** `/pathshala` is a KPI strip plus a class table. Things that need a person (requests to place, seats held for payment, classes with no teacher, attendance not taken on Sunday, homework and sign-offs waiting, open concerns, overdue committee actions) live on six different tabs or nowhere. The Home task for Pathshala is dead code (`P/home.tsx` is not imported anywhere; plan finding F20).
2. **Term setup is a six-stop trip across three nav areas with no order shown.** Setup › Lists (tracks) → Pathshala › Levels → Classes (a drawer on the Classes page) → Terms → term → Fees and rules (fees, rules, Try a family) → Open registration. Hints are sprinkled in field help text. Opening registration shows a TS checklist (`openChecklist`, `L/pathshala-registration/fees.ts`) and the DB then refuses with its own sentences: readiness logic exists twice.
3. **The Enrollments screen is the pre-0591 screen and is now fighting the database.** It still does direct table writes (`placeEnrollment`, `waitlistEnrollment`, `setEnrollmentStatus`, `enrollStudent` in `P/actions.ts`) with a capacity check in the action (read count, then update: a race). 0591 added `pathshala_enrollments_guard`, which refuses withdrawing a billed or paid learner, moving across levels, touching held seats, and inserting held registrations, each time telling the principal to "ask the Pathshala office" or use "the Registrations screen" or "the move-level step, which arrives in the next release". None of those exist (no 0592, 0593 or 0595 migration; plan PR 5, 6, 7, 9 not built). The principal IS the office, so these are dead ends. The 0591 RPCs that do the job (`place_pathshala_enrollment`, `place_next_from_waitlist`, `release_pathshala_hold`, `extend_pathshala_hold`, `pathshala_registration_queue`, `register_pathshala_children`, `pathshala_task_counts`) are called by no portal code (grep over `src/` finds only fee/level RPCs).
4. **Learners are identified by name only, in breach of the household rule.** Only Homework (`P/homework/page.tsx`) shows `household_card`. Enrollments shows `households.display_name`; class roster, attendance, reports, sign-offs show a name. The people picker (`src/components/person-picker.tsx`, `searchPeople` in `L/pathshala/server.ts`) shows name plus member number or email, searches with `ilike` on names (not `resolve_identifier`, so JSH person ID `0417` or household ID `0212` cannot be typed), and "Enroll a student" silently picks the household (primary, else child, else first membership) without showing it.
5. **There is no learner page.** To understand one child the office hops: Enrollments (status, class) → class roster → attendance → reports → sign-offs → homework → People (household) → Giving (fee pledge). `my_pathshala_overview` (plan 0593) would be the data source; it is not built.
6. **Partial success and silent fallbacks.** (a) `addTeacher` inserts the class row, then tries a role grant; if the grant fails (no `roles.manage`, no login yet, step-up needed) the user sees "Teacher added." followed by a hint sentence (`syncTeacherGrant`, `P/actions.ts` L125-191); the CCSTP step-up is swallowed there instead of opening the step-up modal. (b) Enrollments: household-name read failure is `console.error` then "—" (L51); My classes: sign-off count failure is `console.error` then nothing (L54). (c) KPI source falls back from the RPC to TS counting with only a log (`loadClassesOverview`). (d) `createYear` loops an RPC and can half-finish.
7. **Pathshala office decisions that touch families have no preview and no audience count.** Publishing an announcement or a progress report says "Published to families" (plan P31: no push exists yet), and "Publish now" on a new announcement has no confirmation while the per-item Publish does. Placing a learner (pledge mode) creates a pledge and notifies the household in the RPC, but the current button shows none of that. Applicants "Selected / Not selected" are never told (`decideApplication` writes two columns only).
8. **Logic that lives only in TS or the browser.** Attendance QR token is generated in the browser (`randomToken`, `L/logic/tokens.ts`; the server only checks hex format). Attendance rate is computed in TS (`summarizeAttendance` excludes excused) while the term KPI RPC counts excused against the child (plan F9), so one page can show two numbers. Committee lifecycle, quorum and "passed/failed" are derived in `L/logic/resolutions.ts` and `L/logic/eams.ts`, never stored or enforced. No-class day and outside-term checks for attendance are page-level notices only (`markAttendance` checks the date format and the teacher's class, nothing else). I found no DB guard that the marked enrollment belongs to the session's class: RLS `attendance_teacher` (0010 L408) checks only the session's class.
9. **Jargon and mixed vocabulary.** Placed vs Active (both count as "on the roster", staff flip it by hand with "Mark active"), "Requested level", "Place even if full", "Needs practice" (button) vs "Practice more" (status, green) vs `needs_work` (DB) vs "practise more" (toast), "Waitlist when full" checkbox, "Gyan Path" without gloss, "Fees and rules lock". The sign-off table's Class column shows the Pathshala level name, not the class.
10. **Registration-season default is wrong.** `pickTerm` prefers the active term over the registering term (`L/data/pathshala.ts`), so in registration season every Pathshala screen opens on last term until the principal clicks the other chip.

### A3. Rules the redesign must keep
- Errors always in plain English next to the action, with retry; technical detail logged server-side via `failure()`/`runAction`. Never console-only, never a silent fallback, never "Saved" when a write failed. Existing good patterns to keep: `load()` → `LoadProblem` with Try again; per-row Try again in the attendance sheet; `refusal()` in `L/pathshala-registration/refusal.ts` (shows the DB's own sentence).
- "You don't have access to this area" (`PNoAccess`) instead of an empty table when RLS returns nothing. Several pages already do this; keep it for assistant answers too ("Your role can't see applications" not "no applications").
- Households are never picked or confirmed by name alone: show `household_card` (org household ID, Connect number, primary member + org person ID, members, zone, city, last gift, open balance). For staff pickers of people (teachers, committee owners) show member number and what disambiguates them.
- Money is integer cents everywhere (`parseFeeInput`/`parseMoneyInput` in `L/pathshala-registration/money.ts`); the assistant must echo dollars AND the cents it will send.
- Children's data is sensitive: names, DOB, attendance notes, progress comments, homework photos and voice notes. Children are never messaged directly: announcements are "parents only"; homework review notes go to the learner and the household adults, never only the child (`P/homework/page.tsx` L324). No one-to-one adult-to-minor messages.
- RLS is the enforcement. The assistant must run server-side in the Next.js app on the signed-in user's session client (`session.db`), through the same Server Actions or RPCs. It must not reuse the worker/`ANTHROPIC_API_KEY` job pattern (Niva, import mapping: `L/ai-service.ts`, `worker/src/handlers/*`), which runs with service privileges in a queue.
- Role grants, payee changes and module switches need a fresh 2FA step-up (ROLES.md); an assistant that triggers one must open the same step-up modal and retry once, not fail.
- Owner standing rules (CLAUDE.md): ask the owner before changing money rules, permissions/RLS or deleting data. That applies to building the assistant's write tools for fees, holds, role grants and deletes.

### A4. RPC inventory (what the assistant can stand on)
| State | Functions |
|---|---|
| Exist and used by the portal | `save_pathshala_level`, `set_pathshala_level_fees`, `set_pathshala_term_rules`, `open_pathshala_registration`, `pathshala_fee_example`, `pathshala_seats`, `pathshala_pay_now_ready` (fees/levels pages); `pathshala_term_stats` (Classes KPIs, with TS fallback); `create_event_from_template` (Create year); `gyan_homework_queue`, `review_gyan_submission` (Homework) |
| Exist (0591), NOT used by the portal | `place_pathshala_enrollment`, `place_next_from_waitlist`, `release_pathshala_hold`, `extend_pathshala_hold`, `pathshala_registration_queue` (returns `household_card`), `register_pathshala_children` (office channel), `choose_pathshala_office_payment`, `pathshala_task_counts`, `pathshala_quote`, `preview_pathshala_registration`, `pathshala_registration_options` |
| Planned, not built | `withdraw_pathshala_enrollment`, `move_pathshala_enrollment`, `propose/approve_pathshala_assistance`, `pathshala_fee_report` (0592); `my_pathshala_overview`, `save_pathshala_office_note`, `pathshala_attendance_summary` (0593); receipts (0595) |
| No RPC at all: direct table writes from Server Actions under RLS | terms (`saveTerm`), classes (`saveClass`), teacher rows + `role_grants`, attendance (single, bulk, QR, topic), progress reports, legacy enrollment actions, teacher positions and applications, sign-off decisions (`gyan_signoffs`; points by trigger), announcements, all of Committee (actions, templates, lessons, concerns, resolutions, comments, votes) |

### A5. Things in the code that would block or complicate an assistant
1. Server Actions take `FormData` and parse it inline (`str`, `int`, `oneOf`, ...), and validation (class end after start, term dates, level key, fee parsing) lives in those actions and in `L/pathshala-registration/*.ts`. An assistant needs typed command functions that both the form and the tool call. Extract before adding tools, or the assistant will fork the rules.
2. Where there is no RPC the business rule is "RLS + TS". Attendance, classes, terms, teachers, announcements and all committee writes have no atomic server-side function, no plain-English refusal from the DB, and no idempotency key. The assistant would be the third caller of rules that two forms already half-enforce.
3. Multi-step non-atomic writes: `addTeacher`/`removeTeacher` (row + role grant), `pushActionToTemplate` (template item + action link + sibling events), `addStatusUpdate`/`updateConcern` (read JSON array, append, write: lost-update race), `castVote` (read old vote, write history), `createYear` (loop of RPCs, no idempotency).
4. Readiness/derived values computed in TS and duplicated in the DB: open-registration checklist, attendance rate (two definitions), committee dashboard buckets, resolution lifecycle and quorum, `parseTermStats` (guesses RPC column names).
5. The 0591 guard makes the old Enrollments actions fail in common cases. Do not wrap the legacy actions as tools; wrap the RPCs.
6. No server-side "preview" for most writes. Only `pathshala_fee_example`, `preview_pathshala_registration`, and (planned) `withdraw/move ... p_apply=false` give outcome-first previews; the assistant's confirm card needs this for every money-touching call.
7. Roster/date integrity for attendance (see A2 item 8): an assistant that can say "mark Sunday" must not be able to mark a no-class day or a future date by accident.
8. The page-level loaders pull whole tables into the server (`loadClassesOverview` fetches every enrollment, class day and mark for the term). Fine for a page, wasteful per question. Add summary RPCs (term overview, attendance summary, learner overview).
9. Privacy decision for the owner: sending children's names, DOB, notes, report comments, homework photos or voice notes to a model provider. The org agreements include a children's addendum (ROLES.md); confirm it covers an LLM sub-processor before the assistant reads these tables. Minimise: send first name + age band + the fields asked for; never send homework media.

### A6. Fresh-design principles (for the whole area)
- Role home: Principal gets "This week" (a worklist of decisions with counts from `pathshala_task_counts` plus attendance not taken, no-teacher classes, homework/sign-offs, concerns, overdue actions). Teacher gets "My Sunday" (class cards; the one primary action is Take attendance; follow-ups below).
- One Term workspace as a guided lifecycle (Set up → Price → Open → Run → Close), absorbing Levels, Classes, Fees, Rules and the open checklist in one place.
- One Learner page (household card first; seat and fee state; attendance; reports; sign-offs; homework). It is the unit of the office's work and the thing the assistant resolves names to.
- One Class workspace (roster, attendance, reports, announce, homework, teachers) as tabs.
- Registrations queue (plan PR 5) with outcome-first previews for every money-touching action.
- Assistant dock on every screen, context-aware (term, class, learner in view). Answers are embedded cards (household card, roster, quote), not prose. Writes are proposal cards with a diff, a confirm button, the same inline error and retry, and an undo where the data allows.
- Committee is not Pathshala. 4 of its 6 chips are Events/Governance features (checklists, templates, year plan, resolutions); only Concerns is Pathshala-specific. Decide: its own module/workspace, or fold into Events + Governance (the p4 parity doc left this open).

### A7. Screens covered (24)
1 `/pathshala` · 2 `/pathshala/classes` (redirect) · 3 `/pathshala/classes/[id]` · 4 `.../attendance` · 5 `.../reports` · 6 `/pathshala/my-classes` · 7 `/pathshala/enrollments` · 8 `/pathshala/terms` · 9 `/pathshala/terms/[id]` · 10 `/pathshala/terms/[id]/fees` · 11 `/pathshala/levels` · 12 `/pathshala/teachers` · 13 `/pathshala/signoffs` · 14 `/pathshala/homework` · 15 `/pathshala/announcements` · 16 `/pathshala/committee` · 17 `.../committee/actions` · 18 `.../committee/actions/[id]` · 19 `.../committee/templates` · 20 `.../committee/templates/[id]` · 21 `.../committee/year` · 22 `.../committee/concerns` · 23 `.../committee/resolutions` · 24 `.../committee/resolutions/[id]`

---

## B. Screen by screen

Legend for assistant examples: **R** = read, **W** = write. "Confirm" = what the assistant must do before the write.

### 1. `/pathshala` Classes overview (`P/page.tsx`, `P/classes/class-form.tsx`, `P/drawer-button.tsx`)
1. **Who:** principal (view/manage). Teachers without `pathshala.view` are redirected to My classes. Treasurer has no access.
2. **Jobs:** see the term's health; spot a class with no teacher; open a class; add a class; reach Announcements.
3. **Pattern and friction:** KPI strip (students, teachers + background checks, attendance, sign-offs waiting) over a 5-column class table (Class, Teacher, Students, Attendance, Time). New class is a drawer with 10 fields. Friction: it is a report, not a worklist (A2.1); KPI attendance (RPC, excused counted against) can disagree with the per-class % (TS, excused excluded); KPI falls back to TS counting silently; the loader reads every enrollment, class day and mark of the term per view; wrong default term in registration season (A2.10); no seats, held seats or waitlist per class; the "QR check-in at class" hint is static text; "Announcements" is a tiny ghost button; the class form's "Class email (role mailbox)" and "Waitlist when full" are jargon (the checkbox is saved but, per the plan, was never read until 0591).
4. **Assistant:**
   - "Which classes still need a teacher this term?" R, from the loader (add a `pathshala_term_overview(term)` RPC). No confirm.
   - "Attendance by class so far, and who is under 70%?" R, needs one attendance definition (`pathshala_attendance_summary`, plan 0593). No confirm.
   - "Add a Jainism 3 class, Sundays 10 to 11, room 4, capacity 20" W, `saveClass` (direct insert; level dropdown from `pickableLevels`). Confirm: one-line summary; warn if the term's fees are locked and this level has no fee ("Jainism 3 has no 2026-27 fee, families cannot choose it").
5. **Visual:** keep the class table and KPI strip as a scannable surface. Fresh: lead with "needs you" cards (counts that link to filtered queues), make seats / held / waitlist columns, default to the registering term when one exists, one definition of attendance, class creation inside the Term workspace.

### 2. `/pathshala/classes` (redirect; `P/classes/page.tsx`)
1. **Who:** anyone who types or has an old link. Redirects to `/pathshala?term=...`.
2. **Jobs:** none; it exists so the old URL works.
3. **Friction:** harmless. It confirms that "Classes" is the home page and that there is no separate class list.
4. **Assistant:** none (not a destination). The assistant should deep-link to `/pathshala/classes/[id]`.
5. **Visual:** delete in the redesign or keep as an alias.

### 3. `/pathshala/classes/[id]` Class detail (`P/classes/[id]/page.tsx`)
1. **Who:** principal (full), teacher of that class (read; Take attendance and Progress reports).
2. **Jobs:** see the roster and waitlist; move or withdraw a student; add or remove a teacher; reach attendance and reports; edit class details.
3. **Pattern and friction:** two columns. Left: Roster (name, age, Placed/Active badge, per-row buttons Mark active / Move to waitlist / Withdraw, and a "Move to another class" disclosure), Waitlist (class waitlist plus requested-this-level students, with Place in this class), Recent class days, a closed "Withdrawn or completed" disclosure. Right: Teachers (list, Remove, PersonPicker + role + Add), custom fields, Class details form. Friction: students by name only (no household, no fee or hold state, no "paid?"); the buttons are the legacy direct writes that 0591's guard now refuses for billed/paid learners and for cross-level moves, with a "ask the office" dead end; Placed vs Active is manual jargon; `placeEnrollment` capacity check is read-then-write; adding a teacher is 5 steps and can finish as "Teacher added." plus a warning about access; teacher "background check" status is not shown anywhere on the class; teachers cannot see parent contact (correct) but the principal cannot either from here.
4. **Assistant:**
   - "Who is in Jainism 3 and who is waiting?" R. No confirm. Rows must carry age band and, for the principal, the household card (use `pathshala_registration_queue`).
   - "Move Aarav from 3A to 3B" W, should become `place_pathshala_enrollment(p_class)` (same-level move returns `moved`, no money change, no notice). Confirm: cheap but state the new teacher and time.
   - "Make Priya Shah the assistant teacher here" W, `addTeacher` + role grant. Confirm: yes, it is a permission change; needs `roles.manage` and a step-up; show the picked person with member number and ask which if two match; report both halves of the result honestly (row added, access granted or not).
5. **Visual:** the roster list stays a visual surface (scan, sort). Fresh: tabs for Roster / Waitlist / Days / Teachers / Settings; roster rows open the Learner page; "Mark active" disappears (derive from first attendance); teacher assignment becomes one atomic RPC returning what was granted.

### 4. `/pathshala/classes/[id]/attendance` Attendance (`.../attendance/page.tsx`, `attendance-sheet.tsx`)
1. **Who:** teacher of the class, principal. A view-only banner for `pathshala.view` without manage.
2. **Jobs:** every class day: record who is here; optionally show a QR so students/parents check in from the app; record the topic taught; fix last week.
3. **Pattern and friction:** date form + last 6 class days as chips, a sticky summary bar ("12 of 14 here..."), one card per student with four big buttons (Present, Late, Absent, Excused), per-row saved/error state with Try again, optional note, "Mark the rest present", "Show QR for this class" modal (rotates every 10 minutes, page polls every 20 seconds while it is open), "Topic taught" form at the bottom. Strengths: thumb-sized targets, per-row error with retry, honest "Not saved" message. Friction: four buttons per child means about 180px per student on a phone (20 students ≈ 3,600px scroll); the default should be present with exceptions, not 14 taps; one server round trip per tap (session load + ensure session + upsert) with no offline queue on flaky classroom wifi; the topic form is below the whole list; no-class and outside-term are warnings only and not enforced; future dates are allowed; QR token is made in the browser (A2.8); absent children generate no parent notice and no follow-up task; a late QR scan only appears after the 20-second refresh.
4. **Assistant:**
   - "Aarav and Diya were absent, Meera was late, everyone else is here" W. This is the best teacher use case: parse names against the roster, render a preview of the whole sheet, one Confirm applies it. Backing: batch of `markAttendance`/`markAllPresent` today; add `mark_pathshala_attendance(session, rows[])` that enforces roster membership and a valid class day. Confirm: show the filled sheet, call out unmatched or ambiguous names ("two Aarav: Aarav K (9) and Aarav P (7)").
   - "Who has missed three Sundays in a row?" R, needs the summary RPC. No confirm. Result is sensitive child data; show to teacher/principal only.
   - "Set today's topic to Navkar Mantra meaning" W, `saveSessionTopic`. No confirm needed (undo toast).
   - "Show the QR" W (creates an open check-in window): wire to a server-made token, then open the existing modal. Confirm: none, but say it expires in 10 minutes.
5. **Visual:** this must stay a visual, one-handed surface: the student list with state buttons, the QR modal full screen, the sticky counter. Fresh: compact rows defaulting to Present with a tap to cycle/choose exception; "Take attendance" lands here pre-filled for today; the topic and QR sit above the list; server-made QR token; offline-tolerant queue with a visible "3 not yet saved" banner; assistant composer docked at the bottom for the spoken exception list.
6. **Keep:** per-row "Not saved ... Try again"; "Families can read this note" hint (planned) on notes; roster-only students; attendance notes are child data.

### 5. `/pathshala/classes/[id]/reports` Progress reports (`.../reports/page.tsx`)
1. **Who:** teacher of the class, principal.
2. **Jobs:** per term (or mid-term): write a comment and a recommended next level for each student; publish to the family.
3. **Pattern and friction:** free-text "Report period" box + one card per student with comment, next-level select, Save draft / Publish to family. Attendance counts are computed at save time in the action (from marks; excused left out). Friction: period is free text, so "Fall 2026" and "Fall 26" create two reports; a class of 20 is 20 forms with no way to see which are done at a glance beyond a badge; publishing has no confirm and no preview of what the family will read; no push (plan P31) so "published" may never be seen; "recommended next level" is read by nothing (plan §1.1) and looks like a promotion decision; comments are about children, free text, no tone help.
4. **Assistant:**
   - "Draft progress reports for Jainism 3 from attendance and these notes: ..." W (drafts only, `publish=no`) via `saveProgressReport` per student. Confirm: after generating, show each draft with attendance line; teacher edits; nothing is published by this step.
   - "Publish the reports for everyone who has one" W, `saveProgressReport(publish=yes)`. Confirm: yes, it messages families: show count, each comment, and "families will see these in the app". Never publish a draft the teacher has not opened.
   - "Which students have no report yet?" R. No confirm.
5. **Visual:** a per-class grid (student × state: not written / draft / published) with a drawer editor stays visual. Fresh: report periods become a dropdown tied to the term (Mid-term, End of term); comment editor with the attendance sentence pre-filled; "Publish all drafts" with a review step.
6. **Keep:** children's data sensitivity; drafts staff-only; household adults read published reports only.

### 6. `/pathshala/my-classes` My classes (`P/my-classes/page.tsx`)
1. **Who:** teachers (class-scoped or center-wide). It is the teacher landing (`permissions.ts` `landing`).
2. **Jobs:** open today's class and take attendance; see sign-offs waiting; announce to parents; reach reports and roster.
3. **Pattern and friction:** one card per class (level, name, time, room, roster count), a status badge for the most recent class day (done %, N not marked, not taken, no class), sign-off count, and five buttons (Take attendance, Roster, Sign-offs, Announce to parents, Progress reports). Good: the primary action is first and full width. Friction: current term only (pickTerm) so a teacher cannot look back at last term; the Sign-offs button is not class-scoped; homework waiting is not shown (separate tab); sign-off count failure is `console.error` and shows nothing; "Announce to parents" opens a blank form with the class preselected; five equal-weight buttons hide the order of a Sunday (attendance, topic, homework, then follow-ups).
4. **Assistant:**
   - "What do I need to do for today's class?" R: composes attendance state, homework waiting, sign-offs waiting for this teacher's classes. No confirm.
   - "Remind me who was absent last Sunday" R. Child data, teacher's own class only.
   - "Tell my parents class starts 15 minutes late this Sunday" W, a drafted announcement (see screen 15). Confirm: yes (messages families).
5. **Visual:** class cards stay. Fresh: collapse to "Sunday" mode (today's class big, primary action, then a checklist: attendance, topic, homework to review, sign-offs, anything to tell parents); other classes behind a chip.

### 7. `/pathshala/enrollments` Enrollments (`P/enrollments/page.tsx`)
1. **Who:** principal (view/manage). Treasurer excluded.
2. **Jobs:** place requests into classes; waitlist; withdraw; reopen; add a walk-in or phone registration ("Enroll a student"); keep notes.
3. **Pattern and friction:** six status chips with counts (Requested default), a table (Student, Age, Household, Asked for, Registered, Class, Actions). Actions per row: class select grouped "Requested level" / "Other classes" with seats ("Jainism 3 — 18/20"), "Place even if full" checkbox, Place/Move, Waitlist, Withdraw (confirm), Reopen request, an "Add a note" disclosure. "Enroll a student" drawer: PersonPicker + class + level + over-capacity + note. Friction: this is the pre-0591 screen (A2.3): no holds, no fee state, no household card (only `display_name`; failure to read names is console-only and shows "—"), no waitlist position or why a level was suggested, no membership or waiver holds, no Register-a-family flow, no fee preview; Place and Waitlist and Withdraw call direct writes that the DB now refuses for held/billed/paid learners and cross-level moves, ending in "ask the office"; "Place even if full" has no reason box (the RPC requires one); one status per chip means no search across statuses and no search by name or ID; one note field is both the family's note and the office's (plan F12); bulk is impossible (place five siblings = five rows).
4. **Assistant:**
   - "Who is waiting to be placed in Jainism 3, oldest first, and how many seats are free?" R, `pathshala_registration_queue(p_term, p_view)` + `pathshala_seats`. Results carry the household card. No confirm.
   - "Place the Shah children in their requested classes" W, `place_pathshala_enrollment` per child. It bills a fee pledge (pledge mode) and notifies the household's adults. Confirm: yes, always. Show each household card (name alone is not enough: several Shah households), the class, the fee line in dollars (and cents sent), and the notification that will go out. If more than one household matches, stop and ask.
   - "Extend Riya's hold to Friday, she is paying by check" W, `extend_pathshala_hold(p_enrollment, p_until, p_reason)`. Confirm: yes; the assistant must ask for the reason if not given (the RPC refuses without one) and respect the office-window maximum the RPC reports.
   - "Withdraw Dev from Jainism 2" W. Cannot be built until `withdraw_pathshala_enrollment` (0592) exists; it must call with `p_apply=false` first and show the credit or pledge outcome. Confirm: yes (credits).
   - "Register the Mehta family, two kids, Jainism 1 and Gujarati 2" W, `register_pathshala_children` (office channel), preceded by `preview_pathshala_registration`. Confirm: yes (money, seats, notices); household picked by card.
5. **Visual:** the queue table stays a visual surface (scan many rows, compare seats). Fresh (plan PR 5): tabs To place / Seat held / Waitlisted / Held for membership / Placed / Withdrawn; household card in each row; fee status; outcome-first dialogs; a global search by name, Connect number, org person/household ID; bulk place for siblings; "Register a family" as a guided flow with a household-card picker. The assistant is the fast path for the same RPCs.
6. **Keep:** household card; money outcome shown before the click; 22023 refusal sentences shown as written; HistoryButton audit trail per row.

### 8. `/pathshala/terms` Terms (`P/terms/page.tsx`, `P/terms/term-form.tsx`)
1. **Who:** principal; treasurer (giving.manage) sees terms that have left Draft.
2. **Jobs:** list terms; create a term; see which terms are priced and locked; jump to Fees and rules.
3. **Pattern and friction:** table (Term, Dates, Registration window, Fees summary "Pledge · 4 of 6 offered levels priced · not locked yet", No-class count, Status badge) and a New term drawer. Friction: a term is created as a bare shell and the real work is two clicks away on another page; the status the user sees ("Draft") can only move through the Fees page's Open registration; no-class dates are a free-text YYYY-MM-DD textarea; the treasurer gets a different page title and explanatory paragraph (good) but must know to click "Fees and rules"; "Fees and rules lock" and "membership required" are policy terms with no inline help; the page degrades with a Notice if 0590 is missing (good, plain English).
4. **Assistant:**
   - "Create the 2027-28 term, Sept 12 to May 8, registration opens Aug 1 to Sept 5, no class Nov 28, Dec 26 and Jan 2" W, `saveTerm` (the model parses dates; no-class list becomes native). Confirm: summary of every date, in the center's time zone; created as Draft, so low risk.
   - "Which terms are not fully priced?" R, from the fee summary. No confirm.
5. **Visual:** list stays a table. Fresh: terms become cards with a lifecycle stepper (Set up, Price, Open, Run, Close) and one next action each.

### 9. `/pathshala/terms/[id]` Term summary and edit (`P/terms/[id]/page.tsx`)
1. **Who:** principal edit; treasurer read.
2. **Jobs:** read the term's rules in one place; edit dates, window, no-class days, membership rule.
3. **Pattern and friction:** a Summary card (13 label/value rows) above the Edit form, with "Fees and rules" as the header action. Friction: the page title/metadata says "Edit term" but is half summary; "Sunday classes: N" hard-codes Sunday (`classDaysInTerm(..., "sunday", ...)` L46) although a class can meet any day; sibling discount and family cap appear here but are edited on the Fees page (two homes for pricing rules); form duplicates the status concept (draft is read-only text, others a select that writes the status directly).
4. **Assistant:**
   - "What are the rules for 2026-27 in plain words?" R. No confirm.
   - "Add Nov 27 as a no-class day" W, `saveTerm` (needs the full list re-sent; read-modify-write by the assistant). Confirm: show the resulting list and how many class days remain.
5. **Visual:** summary stays. Fresh: merge with the Fees page as the Term workspace; edit-in-place per section.

### 10. `/pathshala/terms/[id]/fees` Fees and rules (`.../fees/page.tsx`, `fees-editor.tsx`, `rules-form.tsx`, `try-family.tsx`, `actions.ts`)
1. **Who:** principal before the lock; treasurer after (reason required); both read.
2. **Jobs:** set a fee for every offered level; choose how families pay (pledge or pay now); set seats rule, sibling discount, family cap, late window and fee, withdrawal deadline, age cut-off, fund; try a family; open registration.
3. **Pattern and friction:** an editing note, an "Open registration" checklist card (Missing / Check / Ready / Note) with the confirm modal, a fees table per track (box per level, suggestion from an earlier term with a "Use" button, tick levels and "Copy to N selected", status text per row, seats), a Registration rules form (radio for payment mode with the pay-now readiness sentence, hold hours, office payment, seat rule, discount, cap, late window and fee, deadlines, fund), and Try a family (name, age, level rows; quote). This is the best-designed screen: DB-backed (`set_pathshala_level_fees`, `set_pathshala_term_rules`, `open_pathshala_registration`, `pathshala_fee_example`), plain-English refusals, reasons after lock, "applies to new registrations only". Friction: it is long (4 cards), the checklist duplicates DB checks in TS, ages and cents live in separate inputs with different formats (dollars typed, cents stored), the "reason" appears only after lock, and the treasurer arrives with no signal that this page exists (Terms table link only).
4. **Assistant:** this is the strongest fit.
   - "Set Toddler to $45, Jainism 1 to 7 to $130, the adult classes $50" W, `set_pathshala_level_fees` (`saveFeesAction` logic: only changed fees sent; `changedFees`). Confirm: yes (money rules). Show a before/after table in dollars and the integer cents sent, and who is allowed (principal before lock, treasurer with reason after). Ask for the reason after lock.
   - "What would a family with a 4-year-old in Toddler and two kids in Jainism 2 and 5 pay, with the late fee?" R, `pathshala_fee_example` (writes nothing). No confirm. Show the line items and the sibling/cap logic.
   - "Why can't I open registration?" R: use the DB's own refusal sentences (or add `pathshala_open_readiness(term)`) rather than the TS checklist. No confirm.
   - "Open registration for 2026-27" W, `open_pathshala_registration`. Confirm: yes. List what locks, who can change fees afterwards, the opening date families will see, and any warning the RPC returns.
   - "Switch 2026-27 to pay-now" W, `set_pathshala_term_rules`. Confirm: yes; surface the readiness sentence ("cannot be used yet: ...") as the refusal, never hide it.
5. **Visual:** the per-level fee grid with row status is worth keeping as a table (compare, copy, tick). Fresh: a "Price" step in the Term workspace; the assistant fills the grid and the user reviews the diff in the same grid before saving.
6. **Keep:** cents; reason after lock; "applies to new registrations only"; owner confirmation for money rules in the build.

### 11. `/pathshala/levels` Levels (`P/levels/page.tsx`, `level-fields.tsx`, `actions.ts`)
1. **Who:** principal edit; view for `pathshala.view`.
2. **Jobs:** define the steps of each track, age bands, adult vs children's, order; retire or offer again.
3. **Pattern and friction:** one card per track (tracks themselves are in Setup › Lists), table (Level + key, Order, Age band, For, classes this term, Offered/Retired), Add level and Edit drawers, Retire with a long confirm. DB-backed through `save_pathshala_level` with plain refusals. Friction: tracks and levels are split across two areas; order is a typed number; the key (`3`, `adult-moms`) is exposed jargon; age bands in whole years "on the term's cut-off date" need an explainer paragraph; the Retire confirm mentions "the member app's older request form" (internal detail leaking to the principal); no preview of how many learners/classes a retire affects.
4. **Assistant:**
   - "Add Jainism 8 for ages 14 to 17" W, `save_pathshala_level` (key from `suggestLevelKey`). Confirm: summary (name, order, age band, audience). Low risk.
   - "Retire Gujarati 4" W, same RPC `active:false`. Confirm: yes; say how many classes/enrollments it keeps and that families can no longer choose it.
   - "Which levels are adult classes?" R. No confirm.
5. **Visual:** ordered list per track stays (drag-to-reorder is more natural than a number). Fresh: age bands drawn as a range bar so overlaps and gaps show; tracks editable here.

### 12. `/pathshala/teachers` Teacher positions (`P/teachers/page.tsx`)
1. **Who:** principal (manage). `pathshala.view` sees positions only.
2. **Jobs:** post an opening; close/reopen; read applications from the app; record selected/not selected.
3. **Pattern and friction:** Positions table (title, term, level, application count, Open/Closed, Close/Reopen) and an Applications card (one block per application: name, status badge, contact, disclosure with four answers, decision select + note). Friction: the tab is named "Teacher positions" but there is no list of who actually teaches what or whose background check expires (only a KPI count on Classes); "Selected" does nothing next: the applicant is not told and the principal must go to a class page and re-find them by name (the application has `person_id` but it is not used to assign); no ranking/compare; the decision note is "kept", not sent; decisions can be flipped back with no trace beyond HistoryButton.
4. **Assistant:**
   - "Post an opening for a Jainism 2 Sunday teacher, minimum: Pathshala graduate" W, `savePosition`. Confirm: yes, it is visible to all members in the app.
   - "Summarise the applications for the Gujarati opening" R. Applicant data is personal; principal only.
   - "Select Priya and put her on Jainism 2" W, `decideApplication` + `addTeacher` + role grant. Confirm: yes (permission change, step-up); also offer to draft a reply to the applicant (message to an adult, show before sending; there is no send path today).
5. **Visual:** applications list stays readable; fresh: a pipeline (New, Interviewing, Selected, Placed) with a single "Assign to class" action that creates the teacher row and grant, plus a Teachers directory (class, role, background-check expiry).

### 13. `/pathshala/signoffs` Gyan Path sign-offs (`P/signoffs/page.tsx`, `note-toggle.tsx`)
1. **Who:** teachers (RLS limits to their students), principal.
2. **Jobs:** decide a student's final Gyan Path level: sign off or ask for more practice.
3. **Pattern and friction:** "Awaiting sign-off / Decided" chips; table (Student, Class [shows the Pathshala level, class names in a tooltip], Goal and level, Teacher, Status, buttons Needs practice / Sign off with an optional "+ Note"). The page loads through eight chained queries. Friction: student by name only, no household, no age; "Needs practice" is red but the resulting status "Practice more" is green; decisions write `gyan_signoffs` directly and points are awarded by a trigger (`award_signoff_points`), with no confirm on a points-and-family-visible action; decided rows stay on the Waiting tab for the day (by design); the Class column does not name the class; a teacher cannot see the student's recent attendance or homework to inform the decision.
4. **Assistant:**
   - "Who is waiting for my sign-off?" R. No confirm.
   - "Sign off Anya for the Navkar Mantra level" W, `decideSignoff` (approved). Confirm: yes (points paid, family sees it). Show student + class + age to disambiguate.
   - "Ask Diya to practise the third line more" W, `decideSignoff` (needs_work) with a drafted note. Confirm: show the note (read by the learner, possibly a child, and the household) and approve wording.
5. **Visual:** table of requests is fine. Fresh: one row opens a panel with the learner's attempts, homework, attendance and a recorded recitation (media played, not summarised) beside the two decisions.

### 14. `/pathshala/homework` Homework review (`P/homework/page.tsx`, `parts.tsx`, `photo-lightbox.tsx`)
1. **Who:** teachers (own classes), principal, content team.
2. **Jobs:** review handed-in homework (photo, file, voice note, text); accept (points paid once) or send back with a note the family reads too.
3. **Pattern and friction:** "With the teacher / Decided" chips, class and level filters, one article per submission: learner (Child badge) + **household card** + homework title/points/attempt/late + the parts (photos in a lightbox, an audio player, file downloads, written answer) + note box with Send back / Accept. The most complete screen: RPC-backed (`gyan_homework_queue`, `review_gyan_submission`), household card shown (or an honest "could not be shown" warning), signed file URLs, scan states, a plain-English message when 0587 is missing. Friction: no bulk or keyboard review; every submission is a tall card; no "next" flow after a decision (the list refreshes); authoring homework is in Content › Gyan Path (another module), so a teacher setting homework leaves Pathshala; note "required to send back" only enforced on submit; `console.error` for the class-filter failure but a visible message is shown (good).
4. **Assistant:**
   - "What is waiting for me in Jainism 2?" R, `gyan_homework_queue` + class filter. No confirm.
   - "Accept the ones that are complete" W, `review_gyan_submission` per item. Confirm: yes, and the assistant cannot judge photos or voice (do not send media to the model unless the owner approves). Treat "complete" as parts present only; show the list and the total points before applying; teacher still opens the ones with media. Notes go to the family.
   - "Send Rohan's back: please record the whole verse, not just the first line" W. Confirm: show the note (child-appropriate, goes to the household adults too); never address a child alone.
5. **Visual:** the media (photos, voice) must stay visual/audible. Fresh: a review stream (one card at a time, keyboard accept/send back, next), assistant-drafted notes the teacher edits.
6. **Keep:** household card; never reviewing homework of your own household (DB rule); note visible to learner and adults.

### 15. `/pathshala/announcements` Class announcements (`P/announcements/page.tsx`)
1. **Who:** teachers (own classes), principal (also whole Pathshala).
2. **Jobs:** tell families about a class or the whole term; draft, publish, unpublish, delete.
3. **Pattern and friction:** left: list of announcements (Published/Draft badge, audience badge, title, body, author, Publish/Unpublish, Delete, Edit disclosure); right: New announcement (Send to, Title, Message, Save draft / Publish now). Friction: the page is not in the nav; "Publish now" publishes without confirmation while per-item Publish asks "Publish X to Y families?"; no count of families who will see it; no preview of what a parent sees; "Published to families" but nothing is pushed today (plan P31), so many parents will never see it, and the page can't show who read it; Edit disclosure re-asks title/body only (cannot change audience); "Parents only - never one-to-one messages to students" is hint text at the bottom of the form, not a guard; plain text only (`body_md` but "Plain text; line breaks are kept"); the Delete is permanent.
4. **Assistant:**
   - "Tell the Jainism 3 parents class is cancelled this Sunday because of the weather" W, `saveAnnouncement` (draft first). Confirm: yes, before publish: show the audience (class, N families via a new count), the exact text, and "families see it in the app". Default is Save draft; Publish needs an explicit yes. The assistant refuses requests to message a student or a single child.
   - "What have we told families this term?" R. No confirm.
   - "Unpublish the one about the picnic" W, `setAnnouncementPublished`. Confirm: light.
   - "Delete the draft about parking" W. Confirm: yes (delete data; owner rule is about the build, but the assistant should still confirm).
5. **Visual:** the list of past announcements stays. Fresh: composer with audience chips, "N families will see this", preview; the same composer reachable from My classes and from the assistant.

### 16. `/pathshala/committee` Committee dashboard (`.../committee/page.tsx`, `layout.tsx`, `committee-tabs.tsx`, `action-row.tsx`)
1. **Who:** principal and committee members with `events.view/manage`, `governance.view/manage`.
2. **Jobs:** see what is overdue, due soon, unassigned and which events are in the next two weeks.
3. **Pattern and friction:** 4 KPI tiles (Overdue, Due ≤3 days, Unassigned, Events ≤2 weeks) and cards of ActionRows. Good: an "All clear" state. Friction: the six committee chips sit under a nine-tab Pathshala strip (two tab rows, heading says "Pathshala" for a screen about events); buckets are computed in TS (`committeeDashboard`, `L/logic/eams.ts`); a role with only governance gets a Notice and must navigate to Concerns or Resolutions; rows link to a full page for every update, no inline "done" or "add note".
4. **Assistant:**
   - "What is at risk for the annual day?" R: dashboard buckets filtered by event. No confirm.
   - "Mark the sound-system booking done and note 'paid deposit'" W, `setActionState` + `addStatusUpdate`. Confirm: light, with undo.
   - "Assign all unassigned actions to Mehul" W, bulk `updateAction`. Confirm: yes (lists them); pick Mehul by member number.
5. **Visual:** the four tiles and risk lists stay. Fresh: inline complete/assign on the row; this belongs on the Events or Governance home, not under Pathshala.

### 17. `/pathshala/committee/actions` Actions list (`.../actions/page.tsx`, `action-form.tsx`)
1. **Who:** committee (`events.view/manage`), or anyone with a person record.
2. **Jobs:** see every checklist action across events, standalone tasks and ideas; add one.
3. **Pattern and friction:** chips Open / Mine / Ideas / Completed / All, an Event filter, rows, and a New action card at the bottom (name, event, phase, owner, backups, due, priority, type, details, confidential, idea). Friction: capped at 300 rows with no notice; owner chosen by `PersonPicker` showing name + member number/email only (two "Mehul Shah" are possible); "Phase: During always uses the event date" and "Just an idea" are jargon; the filter is a GET form with a button (page reload); no sort or search; the form is below the list.
4. **Assistant:**
   - "Show my open actions due this week" R. No confirm.
   - "Add an action: book the hall for annual day, owner Mehul, due Nov 5, high" W, `createAction`. Confirm: summary; pick Mehul with member number; light.
   - "Move all of Jay's actions to Nirav, Jay is travelling" W, bulk `updateAction`. Confirm: yes (list).
5. **Visual:** list stays; fresh: group by event/phase, inline status, assistant-created actions shown as a diff.

### 18. `/pathshala/committee/actions/[id]` Action detail (`.../actions/[id]/page.tsx`)
1. **Who:** committee.
2. **Jobs:** update state (Start, Mark complete, Reopen), edit details, add a status note, push to the template, delete.
3. **Pattern and friction:** state buttons, Details form, Status notes (append-only JSON), Delete card. Friction: Push to template is a multi-step non-atomic write that also adds the action to other events from the same template (confirm text is vague about how many); status notes are a JSON array appended by read-modify-write (lost updates under concurrency); Delete has a single generic confirm; "From concern" cross-link only one way.
4. **Assistant:**
   - "Add a note: caterer confirmed 120 plates" W, `addStatusUpdate`. Confirm: none (note); undo.
   - "Push this to the template for future years" W, `pushActionToTemplate`. Confirm: yes, listing the template and the upcoming events that will get it.
   - "Delete this action" W, `deleteAction`. Confirm: yes.
5. **Visual:** detail page fine. Fresh: activity timeline merging notes, state changes and audit.

### 19. `/pathshala/committee/templates` Templates list (`.../templates/page.tsx`)
1. **Who:** committee view; `events.manage` creates.
2. **Jobs:** see reusable event checklists; create one.
3. **Pattern and friction:** cards (name, confidential badge, counts "5 before · 8 during · 3 after · 2 lessons · 4 events made") and a New template form. Friction: counts are fetched across all templates and events and then filtered in TS; "Confidential" is unexplained; "lessons" is jargon; the template's purpose is Events, not Pathshala (the page copy says "Creating a Pathshala year makes one event from each template").
4. **Assistant:**
   - "Create a template for the Mahavir Jayanti program" W, `saveTemplate`. Confirm: light.
   - "Which templates have no lessons learned?" R.
   - "Build a template from last year's annual day event" W (not available today; needs a "template from event" function). Confirm: yes (creates many items).
5. **Visual:** cards fine; fresh: move to Events.

### 20. `/pathshala/committee/templates/[id]` Template detail (`.../templates/[id]/page.tsx`)
1. **Who:** committee view; manage edits.
2. **Jobs:** edit before/during/after items (priority, type, offset days, order, confidential); lessons learned; see events made; default owner.
3. **Pattern and friction:** three cards (Before / During / After) with per-item Edit and Remove disclosures and an Add form per phase; sidebar: Lessons learned, Events made from this template with Pull lessons, Template settings. Friction: "Days from the event: negative = before" is a mental-math field; "During" items are due on the event day with no way to see that in the list; order is a typed integer; per-item disclosures make a 20-item template a long scroll; lessons are a JSON array with the same append race.
4. **Assistant:**
   - "Add 'confirm caterer' 14 days before to the Annual Day template" W, `saveTemplateItem`. Confirm: light; resolve "14 days before" to `-14` and say so.
   - "Pull the lessons from the 2026 annual day into the template" W, `pushLessonsToTemplate`. Confirm: show the lessons being merged.
   - "Summarise what went wrong in past years for this event" R (lessons across events).
5. **Visual:** the checklist as a visual timeline (days relative to the event) stays; fresh: draggable items and a timeline view.

### 21. `/pathshala/committee/year` Create a Pathshala year (`.../year/page.tsx`)
1. **Who:** `events.manage` (view for others).
2. **Jobs:** once a year: create one event per template for the new year with the template's checklist.
3. **Pattern and friction:** a form (year "2027-2028", a ticked list of templates each with event name and optional date) and an "Existing years" accordion. Friction: it loops `create_event_from_template` and can half-finish ("Created 3; could not create: X"; there is no idempotency, so re-running duplicates what already worked); the same year can be created twice; dates optional so events appear undated; the year is also a different concept from the Pathshala *term* (two "years" in one module); the confirm is generic ("Create one event for each ticked template?").
4. **Assistant:**
   - "Plan 2027-28 from all templates; annual day is March 14, Paryushan Aug 29" W, `createYear` (per-template RPC). Confirm: yes; list the events to create with dates and checklist counts; refuse if the year already exists unless the user says add more.
   - "What happened in 2026-27?" R.
5. **Visual:** keep as a wizard-like screen. Fresh: a calendar of the year with each event as a draggable block, the assistant proposing dates from last year's.

### 22. `/pathshala/committee/concerns` Concerns (`.../concerns/page.tsx`)
1. **Who:** principal (view). Manage/log/update: `pathshala.manage` or the concern's owner. Creating actions needs `events.manage`.
2. **Jobs:** log a concern received by phone/email/in person; assign; update progress; close with a resolution; turn it into a committee action.
3. **Pattern and friction:** chips Open/Closed/All and source chips (Everyone / From teachers / From parents); list of cards (badges, title, description, suggestion, submitter name/email/phone, owner, linked action, resolution, update trail, "Update" and "Create action" disclosures); right: Log a concern form (source, name, email, phone, class, title, what happened, suggestion, assign to me). Friction: this is the only Pathshala-specific committee screen and it is buried; concerns may name children, teachers and parents (sensitive free text and PII on screen); the submitter is typed free text (no link to a household, no household card); owner is "me" or none only; no SLA or aging; updates are an append-only JSON array; closing requires a resolution (good) but nothing notifies the person who raised it; capped at 200.
4. **Assistant:**
   - "Log a concern from a parent: noisy classroom in Jainism 2, phone 713..." W, `createConcern`. Confirm: show the record as it will be stored, flag it contains personal data; no household guessing.
   - "What concerns are open and older than two weeks?" R. Principal only.
   - "Close concern X: spoke to the teacher, resolved" W, `updateConcern`. Confirm: light; resolution text required.
   - "Make this an action for Mehul due Friday" W, `createActionFromConcern`. Confirm: summary.
5. **Visual:** list/queue stays. Fresh: an inbox with aging and owner, linked household/teacher where known, and a clear "tell the person it is closed" step (draft a reply for review).
6. **Keep:** concerns are sensitive; the assistant must not surface them to roles without `pathshala.view/manage` (RLS already hides them, so a "no access" answer, not "no concerns").

### 23. `/pathshala/committee/resolutions` Resolutions (`.../resolutions/page.tsx`)
1. **Who:** `governance.view/manage`; chairs propose.
2. **Jobs:** list resolutions with lifecycle and days left; propose one.
3. **Pattern and friction:** chips Resolutions / Withdrawn; cards with a lifecycle badge (derived in TS: Draft, Comment period open, Ready for vote, Voting open, Closed - passed, ...) and a "N days left" badge; right: Propose a resolution (title, text, why, quorum). Friction: lifecycle and "days left" are computed in the browser/server from dates and votes, not stored; vote counts are fetched for all resolutions and tallied in TS; "quorum 4 (abstentions count); passes only when Yes outnumbers No" is rule text in a sub-heading, enforced nowhere in the DB; no notification when a comment period opens or a vote is due.
4. **Assistant:**
   - "What resolutions are open for comment and when do they close?" R. No confirm.
   - "Draft a resolution: change Sunday class start to 10:30" W (draft), `saveResolution`. Confirm: show text; it is created as draft (low risk).
   - "Summarise the comments on resolution 3" R.
5. **Visual:** list fine. Fresh: governance home (not Pathshala), with a timeline of comment and voting windows.

### 24. `/pathshala/committee/resolutions/[id]` Resolution detail (`.../resolutions/[id]/page.tsx`)
1. **Who:** governance view; chairs manage; members with `governance.vote` vote.
2. **Jobs:** read the text and rationale; comment during the comment period; open/pause/close comment and voting periods; cast or change a vote; record the outcome note; withdraw or restore.
3. **Pattern and friction:** Resolution card with Edit text, Comments card (period controls), Vote card (tally tiles, quorum badge, vote form with reason, vote log with history), Outcome note, Withdraw. Friction: period controls are `ActionForm`s with date pickers and direct updates; changing or closing a period is a single confirm with no consequence preview ("closes comments; N members have not voted"); a vote can be changed any time while open with history kept; the vote log shows who voted what (named); quorum met/pass/fail is computed on screen, not by a closing function; outcome is not stored as a status.
4. **Assistant:**
   - "What is the tally and who has not voted yet?" R, `resolution_votes`. Votes are named by design in this UI; follow the same visibility.
   - "Open voting until Nov 30" W, `setPeriod`. Confirm: yes (starts a formal process); show comment period state and the dates.
   - "Vote yes on this and say the schedule works better" W, `castVote`. Recommend: the assistant may prepare the ballot and read back the choice, but the user must press the ballot's own Cast button or confirm in a dedicated dialog; a vote is personal and audited (reason goes to the audit entry), so no bulk, no on-behalf voting, no "yes to all". This is an owner decision to confirm.
5. **Visual:** tally tiles and the vote form stay. Fresh: a vote card that states the effect ("Your vote is recorded by name and can be changed until Nov 30").

---

## C. Quick reference: assistant tools worth building first (Pathshala)

| Priority | Tool (read/write) | Backed by | Confirm |
|---|---|---|---|
| 1 | Take attendance from a sentence (W) | new `mark_pathshala_attendance` batch (roster + class-day checks), today `markAttendance`/`markAllPresent` | Preview of the whole sheet, ambiguous names resolved |
| 1 | Price a family / explain fees (R) | `pathshala_fee_example`, `pathshala_quote`, `preview_pathshala_registration` | None (writes nothing) |
| 1 | Set fees and rules, open registration (W) | `set_pathshala_level_fees`, `set_pathshala_term_rules`, `open_pathshala_registration` | Yes, before/after in dollars and cents, reason after lock |
| 1 | Registrations queue, place, extend hold, release hold, place next (R/W) | 0591 RPCs (unused today) | Yes for every write, with household card and money/notice outcome |
| 2 | "What needs me today" (R) | `pathshala_task_counts` + attendance/homework/signoff counts | None |
| 2 | Review homework and sign-offs (R/W) | `gyan_homework_queue`, `review_gyan_submission`, `decideSignoff` | Yes (points, family sees); notes drafted, teacher approves |
| 2 | Draft and publish announcements and reports (W) | `saveAnnouncement`, `saveProgressReport` | Yes before publish, with audience count; parents only |
| 3 | Teachers: assign, post openings, decide applications (W) | `addTeacher` + role grant (atomic RPC needed), `savePosition`, `decideApplication` | Yes (permission change, step-up) |
| 3 | Learner lookup (R) | `my_pathshala_overview` (0593, not built) | None, with household card |
| 4 | Committee actions, concerns, templates, year (R/W) | existing Server Actions; `create_event_from_template` | Light, except create year, push to template, close/open periods (yes) |
| Never alone | Casting a committee vote; messaging a child; reading homework media for the model | n/a | The user acts; owner decides on media |
