# Learning assignments (homework) with parent validation: plan

**Status: plan accepted 2026-10-05 — the owner took every recommended default (H1–H10, §4). Building as four pull requests (§5).** Owner request (2026-10-05): *"In the learning module, allow each learning session to be configured by the admin. Let admin assign an assignment/homework for that sub-module level. Allow a response (upload of a photo, file, voice note) by the user. Allow admin to say if the response needs to be validated by a parent in the case a child is submitting the response before it goes to the teacher / module admin."* Every claim about today's code names the file it came from.

**Rules already decided (this plan does not reopen them)**

| Rule | Source |
|---|---|
| A Gyan Path level's final sign-off is a teacher decision (`requested` → `approved` / `needs_work` with a note); the level's points are paid on approval | `0007_learning_content_calendar.sql` (`gyan_signoffs`), `0570` (`award_signoff_points`) |
| Who counts as a learner's teacher: anyone with `pathshala.teach` or `pathshala.manage`, or the Teacher role on the class the learner is placed in | `app.teaches_person` (`0172_storage.sql`), policy `gyan_signoffs_teacher` (`0010_rls.sql`) |
| An adult may act for anyone in their household (children included); a child only for themselves. "Adult" = date of birth unknown or 18 or older | `app.can_act_for_person`, `app.i_am_adult` (`0001`, `0010`) |
| Child login age is a per-community rule (JSH: 13) | DECISIONS "Child login age" |
| No one-to-one adult-to-minor messaging; parent communication only through class announcements and the parent inbox | DECISIONS "Child and organization safety", "Pathshala" |
| Uploaded recordings: readable by the learner, their household adults and their teachers; written by the learner or a parent; deleted after 90 days | `0172_storage.sql` (`can_read_object`, `can_write_object`, retention) |
| Gyan Path content (goals, levels, steps) is edited with `content.manage`; shared library goals (`center_id null`) are read-only for every community | `0010_rls.sql` (`gyan_levels_manage`, `gyan_steps_manage`) |
| Errors are always shown in plain English next to what the user did, with a retry; the database enforces, UI checks are convenience | `CLAUDE.md` |

---

## 0. Summary

1. **An assignment belongs to a Gyan Path level, per community.** Today a level is the owner's "sub-module" (the screenshot: Learn Samayik › Chapter 1 › level 1 "What is Samayik"). A community attaches homework to any level it can see, including the shared library levels it cannot otherwise edit, so JSH can add "Record yourself saying the Navkar Mantra" to a platform lesson without the platform changing.
2. **One response per learner per assignment, built from parts:** a photo, a file, a voice note and/or a short text, as the assignment allows. The learner can keep a draft, submit, and resubmit when the teacher sends it back.
3. **Parent validation is a per-assignment switch** with three positions: never, *for children*, always. When it applies and the learner is a child, the submission waits for a household adult, who approves it (it then goes to the teacher) or sends it back to the child with a note. A parent submitting on a child's behalf is already validated.
4. **The teacher is found the same way as today's sign-offs:** the Teacher of the class the learner is placed in; otherwise anyone with `pathshala.teach` or `pathshala.manage`. The teacher accepts (points are paid once) or sends it back with a note. Feedback is visible to the learner **and** the household adults, never only to the child.
5. **Four pull requests:** one database, one portal, two member-app (photo, voice and text go out over the air; file upload needs a new APK because the file picker is a native module). The database PR changes access rules and needs the owner's OK before merge.

---

## 1. What exists today, and what is missing

### 1.1 The map

| Need | Exists | Where |
|---|---|---|
| Lessons as goal › level › step, with points per step and per level | Yes | `gyan_goals`, `gyan_levels`, `gyan_steps` (`0007`, `0018`, `0021`, `0570`) |
| Admin edits levels and steps in the portal | Yes, partly | Content › Gyan Path (`src/app/(app)/content/gyan-path/page.tsx`): new goal, edit goal, add/edit level, add/remove steps. Read-only for the shared library (B42 lists what is still missing) |
| A learner's completion of steps and levels | Yes | `gyan_progress` (direct writes, guarded by `gyan_progress_guard`), `record_gyan_attempt` |
| A teacher decision on a level | Yes | `gyan_signoffs`; portal Pathshala › Gyan Path sign-offs (`signoffs/page.tsx`, `decideSignoff`); app `requestSignoff` (`src/lib/api/gyan.ts:225`) |
| Uploading a recording for the teacher | Yes, one kind | Recite steps upload to bucket `recordings` at `<center>/<person>/<step>-<ts>.m4a` (`src/lib/api/gyan.ts:163`, `recite-step.tsx`); 90-day retention |
| Who may read or write an upload | Yes, per bucket | `app.can_read_object` / `app.can_write_object` (`0172`) |
| Parent ↔ child link | Yes | household membership; `app.can_act_for_person`, `app.adult_of_household` |
| Teacher ↔ learner link | Yes | `pathshala_enrollments.class_id` + scoped role `teacher` (`pathshala_teachers`), `app.teaches_person` |
| Push and email to a person, with templates and suppressions | Yes | `app.enqueue_message(center, channel, to, template_key, vars, 'notification')` (`0421`); templates seeded per migration (`0582` is the latest example) |
| Photo and voice capture in the app | Yes | `expo-image-picker`, `expo-camera`, `expo-audio` (package.json) |
| File picker in the app | **No** | `expo-document-picker` is not installed: a native module, so a new APK (runtime 4) |
| Homework of any kind | **No** | — |
| A parent approval step anywhere | **No** | Consents and change requests are office approvals, not parent ones |
| Malware scan of uploads | Queued only | `storage.scan` jobs stay pending until a scanner is chosen (`0172` header). Nothing claims a file is clean |

### 1.2 Need by need

- **"Each learning session configured by the admin."** A level already has name, chapter, points, treasure and `requires_teacher_signoff`, editable per community-owned goal. What is missing is anything a community can attach to a *shared* level, and homework itself. This plan adds homework; it does not rebuild the step editor (B42).
- **"Assignment for that sub-module level."** New table `gyan_assignments`, one or more per level per community.
- **"Response: photo, file, voice note."** New table `gyan_submissions` with parts in `gyan_submission_files`, stored in a new private bucket `homework`.
- **"Parent validates before it goes to the teacher."** A status machine with an `awaiting_parent` state, entered only when the assignment asks for it and the submitter is a child.

### 1.3 Findings worth fixing on the way

| # | Finding | Fix |
|---|---|---|
| F1 | `requestSignoff` in the app inserts directly into `gyan_signoffs`; the new flow should not repeat that pattern | Submissions go through functions only (no direct writes), like `record_gyan_attempt` |
| F2 | The recordings bucket lets a *parent* upload a child's recitation but the app has no screen for it | The homework screens are built for "me or a child in my family" from the start |
| F3 | B42: the portal cannot author hotspot/voice/quiz steps | Unchanged by this plan; noted so the owner is not surprised that "configure a session" still means name, points and homework, not new step types |
| F4 | A class Teacher's grant is scoped to the class, and `app.has_permission` only counts center-, platform-, pathshala- and store-scoped grants (`0400`), so a class teacher never passes a `pathshala.teach` check; `gyan_progress_teacher` already excludes them by mistake | Every reviewer rule in this plan goes through the enrollment link (`app.teaches_person`, narrowed to placed or active enrollments as `gyan_attempts_teacher` does), never through `has_permission('pathshala.teach')` alone |
| F5 | The push worker does not forward the notification `type` or payload, so a tapped push cannot open a screen (connect-mobile README gap 29) | PR 1 forwards `type` and `deep_link` in the push data; the app registers `homework` routes |
| F6 | `expo-image-picker`'s camera is switched off in `app.json` (`cameraPermission: false`), a native setting | Over the air the app offers **Choose a photo**; **Take a photo** and **Attach a file** arrive together with the APK (PR 4) |
| F7 | A person with no date of birth counts as an adult (`app.i_am_adult`) | The parent check follows the same rule: a learner with no date of birth is treated as an adult. The data-quality report already lists minors without a birth date |
| F8 | A `needs_work` sign-off is a dead end (`unique(person_id, level_id)`, no member update policy), so a learner cannot ask again | Out of scope; recorded in BACKLOG B44 |

---

## 2. Proposed design

### 2.1 Vocabulary (what the member sees)

- **Homework** (the app and portal word; "assignment" in code): a task a learner does outside the lesson and hands in.
- **Hand in**: submit. **Needs a parent's OK**: awaiting a household adult. **With the teacher**: submitted. **Accepted** / **Sent back**: the teacher's decision, always with the note.

### 2.2 Data changes

| Object | Change | Why |
|---|---|---|
| `app.gyan_assignments` (new) | `id, center_id not null, level_id → gyan_levels, class_id → pathshala_classes null, title (1–120), instructions_md, allowed_kinds text[] check ⊆ {photo,file,voice,text} not empty, max_files 1–10 default 3, required_for_level boolean default false, points integer ≥ 0 default 10, due_rule jsonb (`{"kind":"none"}` / `{"kind":"days_after_start","days":7}` / `{"kind":"on","date":"2026-11-01"}`), parent_check text check in ('never','children','always') default 'children', reviewer text check in ('teacher','content') default 'teacher', status text check in ('draft','published','archived') default 'draft', sort_order, created_by, created_at, updated_at`; unique `(center_id, level_id, title)` | Per-community homework on any level (shared levels included). `class_id` set = homework only for that class's students (H6) |
| `app.gyan_submissions` (new) | `id, center_id, assignment_id, person_id, status text check in ('draft','awaiting_parent','submitted','accepted','needs_work'), text_answer (≤ 2000), submitted_by (user), submitted_at, parent_user, parent_decided_at, parent_note (≤ 500), reviewer_user, decided_at, review_note (≤ 1000), attempt integer default 1, points_awarded integer default 0, created_at, updated_at`; unique `(assignment_id, person_id)` | One live response per learner; resubmission bumps `attempt` and keeps the history in the audit trail |
| `app.gyan_submission_files` (new) | `id, submission_id, kind check in ('photo','file','voice'), storage_path, mime_type, bytes ≤ bucket limit, duration_seconds null, sort_order, created_at` | Parts of a response; at most `max_files` |
| Storage bucket `homework` (new, private) | 25 MB per file; images (png, jpeg, webp, heic), pdf, audio (the recordings list), plus docx/xlsx/pptx and plain text for "file" (H8). Path `<center>/<person>/<submission>/<file>` | Keeps homework out of `recordings` (whose 90-day retention is wrong for homework) and `content` (staff-only writes) |
| `app.module_tables` | the three tables under `gyan_path` | Module switch and test 13 coverage |
| `app.points_ledger.reason` | new value `assignment` (`ref_id` = submission) | Paid once on accept |
| Message templates (push + email) | `homework.assigned`, `homework.parent_check`, `homework.accepted`, `homework.sent_back`, `homework.submitted` (teacher) | Seeded per community like `0582` |

### 2.3 The submission life cycle

```
draft ──hand in──▶ awaiting_parent ──parent OK──▶ submitted ──accept──▶ accepted
  ▲                     │ parent sends back            │ send back
  └─────────────────────┴──────────────────────────────┴──▶ needs_work ──edit──▶ draft (attempt + 1)
```

- `hand in` goes to `awaiting_parent` only when `parent_check = 'always'`, or `parent_check = 'children'` **and** the learner is not an adult (`app.i_am_adult` logic applied to the learner's date of birth, not the caller's) **and** the caller is the learner themselves **and** a household adult who can sign in can be asked (§7). A household adult handing in for a child skips the parent step (they *are* the parent).
- `awaiting_parent` can be decided by any household adult of the learner (`app.adult_of_household`), with an optional note; "send back" returns it to `draft` with the note shown to the child.
- `submitted` can be decided by a reviewer: when `reviewer = 'teacher'`, a center-wide `pathshala.teach` or `pathshala.manage` holder, or the Teacher of a class the learner's enrollment is **placed or active** in (the `gyan_attempts_teacher` rule, F4); when `reviewer = 'content'`, `content.manage`; `pathshala.manage` always.
- `accepted` pays `points` once (ledger `assignment`), and, when `required_for_level`, counts toward level completion (the level's own points still follow today's rule). `needs_work` carries the note; editing it returns the row to `draft` with `attempt + 1`.
- Due dates are information, not gates: a late hand-in is marked **late**, never refused (H5).

### 2.4 Database functions (security definer, `set search_path = app, public, extensions`)

| Function | Who | Does |
|---|---|---|
| `app.save_gyan_assignment(p_center, p_assignment jsonb)` | `content.manage`, or `pathshala.manage`; a class Teacher only when `class_id` is one of their classes (H7) | Insert or update; validates every field in plain English; audited |
| `app.publish_gyan_assignment(p_id, p_status)` (built as `app.set_gyan_assignment_status`) | same | draft → published → archived; the first publish queues ONE job (`homework.publish_notify`) and the worker tells every learner the homework applies to (their household adults too for children), in batches, once (§7) |
| `app.my_gyan_homework(p_center)` | member | The learner's (and, for an adult, their children's) assignments with each submission's status, due, late, note, files (signed URL paths) |
| `app.save_gyan_submission_draft(p_assignment, p_person, p_text, p_files jsonb)` | `can_act_for_person` | Creates/updates the draft and its file rows after the app has uploaded to the bucket; refuses kinds the assignment does not allow and more than `max_files` |
| `app.hand_in_gyan_submission(p_submission)` | `can_act_for_person` | draft → awaiting_parent or submitted (rule above); queues `homework.parent_check` or `homework.submitted` |
| `app.parent_decide_gyan_submission(p_submission, p_decision, p_note)` | `adult_of_household` of the learner, not the learner | OK → submitted (and tells the teacher); send back → draft with the note |
| `app.review_gyan_submission(p_submission, p_decision, p_note)` | reviewer (rule above) | accept (points once) or needs_work; a note is required when sending back; queues the result to the learner and the household adults |
| `app.gyan_homework_queue(p_center, p_view)` | reviewers | With the teacher / decided, per class, with the household card for each learner |
| retention (no new function) | worker (`storage.retention`) | The existing per-bucket mechanism (`app.storage_retention_days`, `storage_expired_objects`, `record_storage_deletions`): `homework` files are deleted **365 days after upload** (H9; a community can change it in Settings › Storage like recordings); the deletion nulls `gyan_submission_files.storage_path`, and the row, note and points stay |

### 2.5 Access rules, audit, module

- **Reads.** `gyan_assignments`: published rows to members of the community (and anon never); drafts to the staff who may edit. `gyan_submissions` and files: `can_act_for_person` (the learner and household adults) and the reviewers (`teaches_person`, `content.manage` when the assignment's reviewer is content, `pathshala.manage`). **No one else, ever:** a teacher of another class cannot read a child's homework.
- **Writes.** Only the functions above; no direct insert/update/delete from any app (unlike `gyan_signoffs` today).
- **Bucket `homework`.** `can_write_object`: `can_act_for_person(center, person)` for the path's person; `can_read_object`: the same plus `teaches_person` and the `content.manage`/`pathshala.manage` holders of that community; the bucket is tied to module `gyan_path` like recordings.
- **Audit.** `audit_row` on the three tables; every function passes a reason ("Handed in homework 'Navkar recording' for Aarav Shah (child), awaiting a parent"). The written answer and both notes are masked in the audit log as `*** (n characters)`, and a part's file name is masked (§7): the family reads them in the app, the audit log never holds a child's words.
- **Child safety.** The teacher's note is delivered to the learner *and* to the household adults, in the app and by push/email; there is no reply channel from the child to the teacher inside homework.
- **Module off.** With `gyan_path` off the tables and bucket refuse every read and write (existing `module_tables` and `storage_module_on` mechanism).

### 2.6 Notifications

| Event | To | Channel |
|---|---|---|
| Homework published (or due in 2 days, H5) | Learner; for a child, the household adults too | push, email |
| Handed in, needs a parent's OK | Household adults | push, email |
| Parent sent it back | Learner (child) | push |
| Submitted (after parent OK or an adult learner) | Reviewers: in-app queue; push to the class teachers | push |
| Accepted / Sent back | Learner and household adults | push, email |

All through `app.enqueue_message` with the existing suppressions, quiet hours and sandbox rules.

---

## 3. Flows

### 3.1 Member app (connect-mobile)

1. **Level screen** (the screenshot): under the step list, a **Homework** card per published assignment: title, due, status chip (Not started / Draft / Needs a parent's OK / With the teacher / Accepted / Sent back), points. Tap → the homework screen.
2. **Homework screen:** instructions; the allowed ways to answer as big buttons: **Choose a photo** (and **Take a photo** from the APK release, F6), **Record a voice note** (same recorder as recite steps), **Attach a file** (APK release only), **Write**. Parts list with remove; **Save draft**; **Hand in** (explains "A parent will check this first" when it applies). Errors in plain English with Try again; uploads retry; a part that fails to upload is never silently dropped.
3. **Parent's view (Family tab › child › Homework, and a Home strip "Needs your OK"):** the child's answer as the teacher will see it; **It's ready, send to the teacher** / **Send back to <child>** with a note. A parent may also do the homework *for* a younger child from the same screen (no parent step then).
4. **After the decision:** the note and the status on the level screen; **Edit and hand in again** when sent back; the points celebration on accept (same celebration component as level completion).
5. **Teacher's view:** in the portal (§3.2) in v1. The app has no teacher screens today (teachers take attendance and decide sign-offs in the portal), so an in-app queue is a follow-up once the portal queue has been used for a term.
6. **Gating:** `useFeature('learn')` and the `gyan_path` module like the rest of Gyan Path; a visitor never sees homework.

### 3.2 Portal (connect-crm)

1. **Content › Gyan Path › level › Homework:** list and drawer form (title, instructions, allowed kinds, max files, points, required for level, due rule, parent check, reviewer, class or everyone, status). Works on shared library levels too (the drawer says "Homework is yours even though the lesson is shared").
2. **Pathshala › Homework:** the review queue (With the teacher / Decided), filters by class and level, each submission with the household card, parts, Accept / Send back with note; `ActionForm`, `failure()` errors, "You don't have access to this area" for people without `pathshala.teach`.
3. **Settings › Rules › Points:** nothing new (points are per assignment).

---

## 4. Decisions

| # | Decision | Recommended default |
|---|---|---|
| **H1** | What homework attaches to | **A Gyan Path level, per community** (shared library levels included). Not a Pathshala session: sessions are attendance records (`pathshala_sessions`) and most learners are not enrolled |
| **H2** | Who may create homework | **`content.manage` and `pathshala.manage` for everyone's homework; a class Teacher only for their own class** (`class_id` set). The parent-check and reviewer switches are per assignment |
| **H3** | When a parent must validate | **Default "children": a learner under 18 handing in from their own login waits for a household adult.** "Always" and "never" are per-assignment choices. A parent handing in for a child is already validated |
| **H4** | Who reviews | **The learner's class Teacher (today's sign-off rule); otherwise anyone with `pathshala.teach` or `pathshala.manage`.** An assignment may instead choose "content" (the Content › Gyan Path editors) for lessons outside Pathshala |
| **H5** | Due dates | **Information only: shown, reminded 2 days before, marked late, never refused** |
| **H6** | Who gets the homework | **Everyone doing the level**, or **only the students of one class** when the assignment names a class |
| **H7** | Points and level completion | **Points per assignment (default 10), paid once on accept.** "Required for level" (default off) makes the level incomplete until accepted; the level's own points and treasure follow today's rules |
| **H8** | File types and sizes | **Photo (png/jpeg/webp/heic), voice (m4a and the recordings list), file (pdf, docx, xlsx, pptx, txt), text (2000 characters); 25 MB per file, 3 files per response by default (up to 10)**. No video in v1 (size) |
| **H9** | Retention | **Files deleted 1 year after upload; rows, notes and points stay.** Longer than recordings' 90 days because homework is part of a term's record |
| **H10** | Release order | **DB → portal → app OTA (photo, voice, text) → app APK (file picker, runtime 4)**. Testers get homework on their phones before the APK; "Attach a file" appears with the APK |

---

## 5. Phased PR plan

| # | Repo | PR | Size | Needs | Owner sign-off |
|---|---|---|---|---|---|
| 1 | connect-crm | **DB: tables, bucket, functions, templates, retention, tests** (migration 0587, test 72); the worker forwards push `type` (F5); types regenerated and copied | L | H1–H9 | **Yes**: new access rules (parents approve, teachers read children's uploads, bucket policies) |
| 2 | connect-crm | **Portal: level › Homework editor; Pathshala › Homework queue**; BACKLOG/DECISIONS/MODULES docs | M | PR 1 (contract) | No |
| 3 | connect-mobile | **App (OTA): homework card and screen (choose a photo, voice, text), parent OK, notification routes**; v1.8.0; keeps working (homework hidden) until PR 1 is deployed | L | PR 1 (contract) | No |
| 4 | connect-mobile | **App (APK): "Take a photo" and "Attach a file"** (`expo-document-picker`, picker camera on), runtime 4, build 5 | S | PR 3 | No (the owner installs the APK) |

---

## 6. Test plan

| Layer | Where | What |
|---|---|---|
| Database | `supabase/tests/72_gyan_homework_test.sql` | Status machine (every transition, every refusal); child vs adult vs parent-on-behalf; a teacher of another class reads nothing; `content` reviewer; points paid once on accept and never on resubmit; required-for-level blocks completion; bucket read/write per role; module off; templates queued; retention |
| Portal | vitest + e2e fixture | Editor validation messages; queue decisions; no-access screens |
| App | jest (pure) + browser harness | Status chips, allowed kinds, parent step shown only when it applies, upload retry, deep links |
| Hand check | JSH sandbox | A parent with a child under 13 (no login) and a teen with a login; a teacher of their class; accept and send back; the APK file flow |

---

## 7. As built (migration 0587, 2026-10-06; and the independent security review of the pull request, owner decisions a-d)

The database follows §2 and §4. Where building it, and the security review of the pull request, refined the text, the refinement is listed here and in the pull request's access section, so the portal and the member app code against what exists.

- **Reviewers read an answer only once it is with them, and only the parts it lists.** The Teacher of the learner's class (placed or active in it, with the enrollment's term open: registration or active), `pathshala.teach`, `pathshala.manage` and, for content-reviewed homework, `content.manage` read an answer, its parts and the files the parts name from `submitted` onward (accepted, sent back). They never read a draft, an answer waiting for a parent, or an uploaded object the answer does not list. The family (the learner and the household adults) reads the whole folder. A part the learner replaces loses its row, so reviewers can no longer read its file; the object stays in the bucket for the family until the retention job removes it (365 days after upload by default). (§2.5 said "the reviewers" without a status.)
- **Nobody decides on their own household's homework** (owner decision c). Nobody can review the homework of themselves, a spouse, a child, a parent or a brother or sister: the principal and the owner included. Their queue does not list it, they are not told to review it, and `review_gyan_submission` says "You cannot decide on homework from your own family. Ask another teacher." They read their own family's answers as parents, like any parent.
- **Who counts as an adult.** A learner is a minor when the date of birth says so, or when there is no date of birth and a household records them as its child (F7 counted every person without a birth date as an adult, so a child with no birth date could act as a parent). The same rule applies to the caller: a household "child" with no birth date cannot act for anyone else.
- **When there is nobody to ask.** A learner with no adult in their household hands in straight to the teacher. A household whose adults **cannot sign in** (no login in this community) also goes straight to the teacher, and the household's adults get a heads-up email (`homework.heads_up`, owner decision a): a check nobody can do would wait for ever. With one adult who can sign in and one who cannot, the hand-in waits and only the one who can is asked. An adult learner's "always" homework waits for another adult who can sign in. A household adult handing in for someone else in the family is the check, whatever the parent check says. The office (`pathshala.manage`) can release an answer that is waiting for a parent through `parent_decide_gyan_submission` with decision `ok`, recorded as released by the office (who, when, an audit reason).
- **Fixed once an answer exists:** the lesson level, the class, the reviewer and the parent check. Homework for a class is always reviewed by the class teacher. A class Teacher can offer up to 100 points for a piece of homework; the office (`content.manage` or `pathshala.manage`) up to 1,000.
- **Birth dates (a separate access change, the last section of 0587; the owner may decline it).** A child can no longer change their own date of birth: a parent or the office does it.
- **Pushes.** `homework` to the learner, `homework_parent` to a household adult, `homework_review` (no deep link: teachers review in the portal) to a reviewer. The payload carries `deep_link`, `assignment_id`, `submission_id` and `learner_id`, and the worker forwards them with the type (F5).
- **No note travels in a message** (owner decision d). The templates say that there is a note and where to read it ("Open the app to read the note"); there is no note variable. The audit log holds no child's words: the written answer and both notes are masked as `*** (n characters)`, and a part's file name is masked (its folder, which is the answer, is not). A parent's note is cleared when the child hands in again.
- **Publishing queues one job** (owner decision b). The first publish queues `homework.publish_notify`; the worker tells the class's students, or, for homework for everyone, the members who have completed a step of the level, and the household adults of each child, in batches (`app.worker_homework_publish_notify`, offset and limit), once: publishing again after an unpublish tells nobody twice, and a retried job skips whoever was told. Never the whole community.
- **Required for level** holds the automatic level bonus (the points of a level with no sign-off, and the treasure). A level that needs a sign-off still pays its points when the teacher approves the sign-off. Archiving, unpublishing or un-requiring such homework pays what it was holding to everyone who has finished the level's steps.
- **Archived homework** stays on the family's list with its status and the teacher's note, read-only (`assignment.archived` in `my_gyan_homework`); saving or handing in refuses with a sentence. A lesson level that has homework cannot be deleted (`gyan_assignments.level_id` is `on delete restrict`).
- **Due dates.** `days_after_start` counts from the later of the learner's first completed step of the level and the day the homework was first published: nobody gets a due date in the past.
- **The queue's household card** is `app.household_card` when the caller may see it, otherwise `{household_id, household_name, household_number}`: a class Teacher usually holds no people permission, and a learner is never shown by name alone.
- **Function grants.** Signed-in members can call the eight functions of §2.4 and the five helpers the row level security policies call (each answers only about the caller); every other helper is internal; `worker_homework_publish_notify` is the worker role's alone.
- **Left for later** (BACKLOG B46): the in-app teacher queue, Take a photo and Attach a file (APK), a malware scanner for uploads, the due-date reminder job, a learner taking back an answer that is waiting for a parent, limits on draft saves and uploads, `merge_people` moving homework, and the owner's call on keeping homework files 180 days instead of 365.
