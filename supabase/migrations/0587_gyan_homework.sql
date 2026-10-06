-- 0587_gyan_homework.sql: learning assignments (homework) with parent validation.
--
-- Owner request 2026-10-05 (docs/LEARNING_ASSIGNMENTS_PLAN.md, every default H1–H10 accepted): an admin attaches
-- homework to a Gyan Path level, per community (shared library levels included); a learner answers with a photo,
-- a file, a voice note and/or a short text; when the assignment asks for it and the learner is a child handing in
-- from their own login, a household adult checks the answer before it goes to the teacher; the teacher accepts
-- (points, once) or sends it back with a note.
--
--   app.gyan_assignments          one per level per community: what to do, how to answer, points, due rule,
--                                 parent_check (never | children | always), reviewer (teacher | content),
--                                 status (draft | published | archived), optionally for one Pathshala class (H6)
--   app.gyan_submissions          one live answer per learner per assignment (draft → awaiting_parent → submitted
--                                 → accepted | needs_work → draft again with attempt + 1)
--   app.gyan_submission_files     the parts of an answer (photo | file | voice) in the private bucket `homework`
--   app.save_gyan_assignment      content.manage or pathshala.manage; a class Teacher only for their own class (H2)
--   app.set_gyan_assignment_status  draft → published → archived; publishing tells the learners (and the parents
--                                 of children) with template homework.assigned
--   app.my_gyan_homework          the caller's homework, and their children's (member app)
--   app.save_gyan_submission_draft, app.hand_in_gyan_submission, app.parent_decide_gyan_submission,
--   app.review_gyan_submission    the life cycle; every write goes through these (no direct writes by any app role)
--   app.gyan_homework_queue       the review queue (portal: Pathshala › Homework) with the household card
--   app.gyan_award_level_bonus    (0570) now waits until every published required_for_level assignment that
--                                 applies to the person is accepted (H7)
--   Storage bucket `homework`     private, 25 MB a file, <center>/<person>/<submission>/<file>; written by the
--                                 learner or a household adult while the answer is a draft or sent back; read by
--                                 the family, and by the reviewers once the answer is with them (never a draft or an
--                                 answer waiting for a parent); Gyan Path module; kept 365 days (H9), a community
--                                 may change that like recordings; the retention job nulls the file row's path
--   Templates                     homework.assigned, homework.parent_check, homework.sent_back_parent,
--                                 homework.submitted, homework.accepted, homework.sent_back (push + email, en,
--                                 platform defaults a community may override, 0582's pattern)
--
-- Findings honoured (plan §1.3): F1 submissions are RPC-only; F4 every reviewer rule goes through the enrollment
-- link for class teachers (never has_permission('pathshala.teach') alone); F7 a learner with no date of birth is an
-- adult, as app.i_am_adult says. Points are not money; nothing here touches payments.
--
-- NEEDS OWNER SIGN-OFF (access rules): parents read and decide a child's homework; teachers read children's
-- uploads; the bucket rules; who may create homework. See the pull request.
set client_min_messages = warning;

-- ── Locks first ──────────────────────────────────────────────────────────────
-- A deploy applies this file as ONE transaction (migrate.sh --single-transaction) and it changes a check on
-- app.points_ledger, which a member completing a step writes through its triggers. Take it before anything else and
-- wait at most 10 seconds, so a busy moment fails the deploy cleanly (run it again) instead of queueing members
-- behind it. Inside a DO block because LOCK TABLE needs a transaction (run_local.sh applies statement by statement).
do $$
begin
  set local lock_timeout = '10s';
  lock table app.points_ledger in access exclusive mode;
end $$;

-- ── Points ledger: one new reason ────────────────────────────────────────────
alter table app.points_ledger drop constraint if exists points_ledger_reason_check;
alter table app.points_ledger add constraint points_ledger_reason_check
  check (reason in ('practice','level','anumodana_sent','anumodana_received','support','welcome','volunteer','correction',
                    'challenge','survey','gyan_try','gyan_treasure','assignment'));
comment on column app.points_ledger.reason is
  'practice | level (Gyan Path step points, ref_id = step; level points, ref_id = level) | anumodana_sent | anumodana_received | support | welcome | volunteer | correction | challenge | survey | gyan_try (a successful Gyan Path practice try, ref_id = step) | gyan_treasure (a level''s treasure, ref_id = level) | assignment (homework accepted, ref_id = the submission; once per assignment and person).';

-- ── Tables ───────────────────────────────────────────────────────────────────
create table if not exists app.gyan_assignments (
  id                 uuid primary key default gen_random_uuid(),
  center_id          uuid not null references app.centers(id) on delete cascade,
  level_id           uuid not null references app.gyan_levels(id) on delete cascade,
  class_id           uuid references app.pathshala_classes(id),
  title              text not null check (char_length(title) between 1 and 120),
  instructions_md    text check (instructions_md is null or char_length(instructions_md) <= 4000),
  allowed_kinds      text[] not null default '{photo,voice,text}'
                     check (cardinality(allowed_kinds) >= 1 and allowed_kinds <@ array['photo','file','voice','text']),
  max_files          integer not null default 3 check (max_files between 1 and 10),
  required_for_level boolean not null default false,
  points             integer not null default 10 check (points between 0 and 1000),
  due_rule           jsonb not null default '{"kind":"none"}'::jsonb check (jsonb_typeof(due_rule) = 'object'),
  parent_check       text not null default 'children' check (parent_check in ('never','children','always')),
  reviewer           text not null default 'teacher' check (reviewer in ('teacher','content')),
  status             text not null default 'draft' check (status in ('draft','published','archived')),
  sort_order         integer not null default 0,
  published_at       timestamptz,
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (center_id, level_id, title)
);
create index if not exists gyan_assignments_level_idx on app.gyan_assignments (level_id, status);
create index if not exists gyan_assignments_center_idx on app.gyan_assignments (center_id, status, class_id);
comment on table app.gyan_assignments is
  'Homework on a Gyan Path level, per community (0587; shared library levels included). class_id set: only the students placed in that Pathshala class get it (H6). parent_check: never | children (a learner under 18 handing in from their own login waits for a household adult) | always. reviewer: teacher (the learner''s class Teacher, else pathshala.teach / pathshala.manage) | content (content.manage); pathshala.manage always. required_for_level: the level is complete only once this is accepted (H7). due_rule: {"kind":"none"} | {"kind":"days_after_start","days":1-365} (from the learner''s first completed step of the level, else the publish date) | {"kind":"on","date":"YYYY-MM-DD"}; due dates are information, never a gate (H5). Written only by app.save_gyan_assignment and app.set_gyan_assignment_status.';
comment on column app.gyan_assignments.published_at is 'When it was last published (the start of a days_after_start due rule for a learner who has not completed a step of the level yet).';

create table if not exists app.gyan_submissions (
  id                uuid primary key default gen_random_uuid(),
  center_id         uuid not null references app.centers(id) on delete cascade,
  assignment_id     uuid not null references app.gyan_assignments(id) on delete cascade,
  person_id         uuid not null references app.people(id) on delete cascade,
  status            text not null default 'draft' check (status in ('draft','awaiting_parent','submitted','accepted','needs_work')),
  text_answer       text check (text_answer is null or char_length(text_answer) <= 2000),
  submitted_by      uuid references auth.users(id),
  submitted_at      timestamptz,
  parent_user       uuid references auth.users(id),
  parent_decided_at timestamptz,
  parent_note       text check (parent_note is null or char_length(parent_note) <= 500),
  reviewer_user     uuid references auth.users(id),
  decided_at        timestamptz,
  review_note       text check (review_note is null or char_length(review_note) <= 1000),
  attempt           integer not null default 1 check (attempt >= 1),
  points_awarded    integer not null default 0 check (points_awarded >= 0),
  late              boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (assignment_id, person_id)
);
create index if not exists gyan_submissions_center_status_idx on app.gyan_submissions (center_id, status, submitted_at);
create index if not exists gyan_submissions_person_idx on app.gyan_submissions (person_id);
comment on table app.gyan_submissions is
  'One live homework answer per learner per assignment (0587): draft → awaiting_parent (a child''s own hand-in when the assignment asks for a parent''s check) → submitted → accepted | needs_work → draft again with attempt + 1 (the history is in the audit log). Read by the learner and the adults of their household, and by the reviewers (app.gyan_homework_reviewer) once the answer is with them: never a draft or an answer waiting for a parent; written only by the homework RPCs. points_awarded: the assignment''s points when accepted, paid once ever into points_ledger (reason assignment, ref_id = this row).';

create table if not exists app.gyan_submission_files (
  id               uuid primary key default gen_random_uuid(),
  center_id        uuid not null references app.centers(id) on delete cascade,
  submission_id    uuid not null references app.gyan_submissions(id) on delete cascade,
  kind             text not null check (kind in ('photo','file','voice')),
  storage_path     text check (storage_path is null or (char_length(storage_path) <= 500 and position('..' in storage_path) = 0)),
  mime_type        text not null check (char_length(mime_type) between 1 and 120),
  bytes            integer not null check (bytes between 1 and 26214400),
  duration_seconds integer check (duration_seconds is null or duration_seconds between 0 and 86400),
  sort_order       integer not null default 0,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  constraint gyan_submission_files_path_unless_deleted check (storage_path is not null or deleted_at is not null)
);
create index if not exists gyan_submission_files_submission_idx on app.gyan_submission_files (submission_id, sort_order);
create index if not exists gyan_submission_files_path_idx on app.gyan_submission_files (storage_path) where storage_path is not null;
comment on table app.gyan_submission_files is
  'The parts of a homework answer (0587): a photo, a file or a voice note in the private `homework` bucket at <center>/<person>/<submission>/<file>. deleted_at is set (and storage_path cleared) by the retention job once the file is gone; the row, the notes and the points stay.';

insert into app.module_tables (table_name, module_key) values
  ('gyan_assignments', 'gyan_path'), ('gyan_submissions', 'gyan_path'), ('gyan_submission_files', 'gyan_path')
on conflict (table_name) do update set module_key = excluded.module_key;

drop trigger if exists audit_gyan_assignments on app.gyan_assignments;
create trigger audit_gyan_assignments after insert or update or delete on app.gyan_assignments
  for each row execute function app.audit_row();
drop trigger if exists audit_gyan_submissions on app.gyan_submissions;
create trigger audit_gyan_submissions after insert or update or delete on app.gyan_submissions
  for each row execute function app.audit_row();
drop trigger if exists audit_gyan_submission_files on app.gyan_submission_files;
create trigger audit_gyan_submission_files after insert or update or delete on app.gyan_submission_files
  for each row execute function app.audit_row();
drop trigger if exists touch_gyan_assignments on app.gyan_assignments;
create trigger touch_gyan_assignments before update on app.gyan_assignments for each row execute function app.touch_updated_at();
drop trigger if exists touch_gyan_submissions on app.gyan_submissions;
create trigger touch_gyan_submissions before update on app.gyan_submissions for each row execute function app.touch_updated_at();

-- ── Small helpers ────────────────────────────────────────────────────────────
-- A learner under 18 by their date of birth. No date of birth = an adult, as app.i_am_adult says (F7); the data
-- quality report lists minors without a birth date.
create or replace function app.person_is_minor(p_person uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce((select p.date_of_birth is not null and p.date_of_birth > current_date - interval '18 years'
                     from app.people p where p.id = p_person), false)
$$;

-- Who may create or change homework (H2): content.manage or pathshala.manage for everyone's; a class Teacher only
-- for homework that names one of their classes.
create or replace function app.gyan_homework_editor(p_center uuid, p_class uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select p_center is not null and auth.uid() is not null and (
         app.has_permission(p_center, 'content.manage')
      or app.has_permission(p_center, 'pathshala.manage')
      or (p_class is not null and app.has_scoped_role(p_center, p_class, 'teacher')))
$$;

-- Who reviews a learner's homework (H4, F4): pathshala.manage always; reviewer = teacher: a center-wide
-- pathshala.teach holder, or the Teacher of a class the learner is placed or active in NOW (the gyan_attempts_teacher
-- rule: a class-scoped grant never passes has_permission, so the enrollment link is the only way in for them);
-- reviewer = content: content.manage.
create or replace function app.gyan_homework_reviewer(p_center uuid, p_person uuid, p_reviewer text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select p_center is not null and auth.uid() is not null and (
         app.has_permission(p_center, 'pathshala.manage')
      or (p_reviewer = 'teacher' and (
            app.has_permission(p_center, 'pathshala.teach')
            or exists (select 1 from app.pathshala_enrollments e
                        where e.center_id = p_center and e.student_person_id = p_person
                          and e.class_id is not null and e.status in ('placed', 'active')
                          and app.has_scoped_role(e.center_id, e.class_id, 'teacher'))))
      or (p_reviewer = 'content' and app.has_permission(p_center, 'content.manage')))
$$;

-- The assignment's reviewer rule, read past row level security (policies on submissions and files use it, and a
-- member may not read an archived assignment).
create or replace function app.gyan_assignment_reviewer(p_assignment uuid) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select a.reviewer from app.gyan_assignments a where a.id = p_assignment
$$;

-- Does this homework apply to this person: published, the person's own community, and (when it names a class) the
-- person is placed or active in that class.
create or replace function app.gyan_assignment_applies(p_assignment uuid, p_person uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select exists (
    select 1 from app.gyan_assignments a join app.people p on p.id = p_person
     where a.id = p_assignment and a.status = 'published' and p.center_id = a.center_id
       and (a.class_id is null or exists (select 1 from app.pathshala_enrollments e
                                           where e.student_person_id = p.id and e.class_id = a.class_id
                                             and e.status in ('placed', 'active'))))
$$;

-- May the caller read this submission (and its files)? The learner and the adults of their household, always; the
-- reviewers only once the answer is with them (submitted, accepted or sent back), never a draft and never an answer
-- still waiting for a parent's OK: the parent's check comes before the teacher sees it. Nobody else, ever.
create or replace function app.gyan_submission_readable(p_submission uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select exists (
    select 1 from app.gyan_submissions s join app.gyan_assignments a on a.id = s.assignment_id
     where s.id = p_submission
       and (app.can_act_for_person(s.center_id, s.person_id)
            or (s.status in ('submitted', 'accepted', 'needs_work') and app.gyan_homework_reviewer(s.center_id, s.person_id, a.reviewer))))
$$;

-- Plain-English problem with a due rule; null = fine.
create or replace function app.gyan_due_rule_problem(p jsonb) returns text
language plpgsql immutable set search_path = app, public, extensions as $$
declare k text; d numeric;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'The due date rule must be an object such as {"kind":"none"}.'; end if;
  k := p->>'kind';
  if k = 'none' then return null; end if;
  if k = 'days_after_start' then
    if jsonb_typeof(p->'days') <> 'number' then return 'A "days after start" due rule needs "days", a whole number from 1 to 365.'; end if;
    d := (p->>'days')::numeric;
    if d <> floor(d) or d < 1 or d > 365 then return 'A "days after start" due rule needs "days", a whole number from 1 to 365.'; end if;
    return null;
  end if;
  if k = 'on' then
    if jsonb_typeof(p->'date') <> 'string' or (p->>'date') !~ '^\d{4}-\d{2}-\d{2}$' then
      return 'A due rule "on" needs a "date" written as YYYY-MM-DD.';
    end if;
    begin
      perform (p->>'date')::date;
    exception when others then
      return 'A due rule "on" needs a real date written as YYYY-MM-DD.';
    end;
    return null;
  end if;
  return 'The due date rule must be "none", "days_after_start" (with days) or "on" (with a date).';
end $$;

-- The community's local date today.
create or replace function app.gyan_center_today(p_center uuid) returns date
language sql stable security definer set search_path = app, public, extensions as $$
  select (now() at time zone coalesce(nullif(c.time_zone, ''), 'America/Chicago'))::date from app.centers c where c.id = p_center
$$;

-- When this homework is due for this learner (null = no due date). days_after_start counts from the learner's first
-- completed step of the level (app.gyan_progress keeps no started-at time, so the first completion is the earliest
-- date it has), else from the day it was published.
create or replace function app.gyan_assignment_due_on(p_assignment uuid, p_person uuid) returns date
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare a app.gyan_assignments; v_tz text; v_start timestamptz;
begin
  select * into a from app.gyan_assignments where id = p_assignment;
  if a.id is null then return null; end if;
  if a.due_rule->>'kind' = 'on' then return (a.due_rule->>'date')::date; end if;
  if a.due_rule->>'kind' = 'days_after_start' then
    select coalesce(nullif(c.time_zone, ''), 'America/Chicago') into v_tz from app.centers c where c.id = a.center_id;
    select min(gp.completed_at) into v_start
      from app.gyan_progress gp join app.gyan_steps st on st.id = gp.step_id
     where gp.person_id = p_person and st.level_id = a.level_id;
    v_start := coalesce(v_start, a.published_at);
    if v_start is null then return null; end if;
    return (v_start at time zone v_tz)::date + ((a.due_rule->>'days')::numeric)::int;
  end if;
  return null;
end $$;

-- A person's first name as the templates say it ("learner").
create or replace function app.gyan_learner_name(p_person uuid) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(nullif(btrim(p.preferred_name), ''), p.first_name) from app.people p where p.id = p_person
$$;

-- The adults of the learner's households, the learner excluded (the parents).
create or replace function app._gyan_homework_adults(p_center uuid, p_person uuid) returns setof uuid
language sql stable security definer set search_path = app, public, extensions as $$
  select distinct hm2.person_id
    from app.household_members hm
    join app.household_members hm2 on hm2.household_id = hm.household_id and hm2.left_at is null
    join app.people p on p.id = hm2.person_id
   where hm.center_id = p_center and hm.person_id = p_person and hm.left_at is null
     and hm2.person_id <> p_person and not coalesce(p.is_deceased, false)
     and (p.date_of_birth is null or p.date_of_birth <= current_date - interval '18 years')
$$;

-- Is this submission a draft the caller may fill in: can_act_for_person, and the row is a draft or was sent back?
-- (The bucket's write rule.)
create or replace function app.gyan_submission_writable(p_center uuid, p_person uuid, p_submission uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select p_submission is not null and app.can_act_for_person(p_center, p_person)
     and exists (select 1 from app.gyan_submissions s
                  where s.id = p_submission and s.center_id = p_center and s.person_id = p_person and s.status in ('draft', 'needs_work'))
$$;

-- ── The JSON the apps get ────────────────────────────────────────────────────
create or replace function app.gyan_assignment_json(p_assignment uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object(
           'id', a.id, 'center_id', a.center_id, 'level_id', a.level_id, 'class_id', a.class_id, 'title', a.title,
           'instructions_md', a.instructions_md, 'allowed_kinds', to_jsonb(a.allowed_kinds), 'max_files', a.max_files,
           'required_for_level', a.required_for_level, 'points', a.points, 'due_rule', a.due_rule,
           'parent_check', a.parent_check, 'reviewer', a.reviewer, 'status', a.status, 'sort_order', a.sort_order,
           'created_at', a.created_at, 'updated_at', a.updated_at)
    from app.gyan_assignments a where a.id = p_assignment
$$;

create or replace function app.gyan_submission_json(p_submission uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object(
           'id', s.id, 'status', s.status, 'attempt', s.attempt, 'text_answer', s.text_answer, 'submitted_at', s.submitted_at,
           'parent_note', s.parent_note, 'review_note', s.review_note, 'decided_at', s.decided_at,
           'points_awarded', s.points_awarded, 'late', s.late,
           'files', coalesce((select jsonb_agg(jsonb_build_object(
                                 'id', f.id, 'kind', f.kind, 'storage_path', f.storage_path, 'mime_type', f.mime_type,
                                 'bytes', f.bytes, 'duration_seconds', f.duration_seconds, 'sort_order', f.sort_order,
                                 'deleted_at', f.deleted_at) order by f.sort_order, f.created_at, f.id)
                               from app.gyan_submission_files f where f.submission_id = s.id), '[]'::jsonb))
    from app.gyan_submissions s where s.id = p_submission
$$;

-- ── Notices ──────────────────────────────────────────────────────────────────
-- One message, never failing the caller (0582's pattern): a refusal (a sandbox may reach only verified test
-- recipients; a suppression; no login) is written to the audit log as gyan_homework.notice_failed instead. The
-- routing (what a tapped push opens: worker/src/messaging.ts pushRouting reads it from the payload's top level)
-- is added to the message's payload. Returns the message id, or null when nothing was queued.
create or replace function app._gyan_homework_send(p_center uuid, p_template text, p_channel text, p_to text, p_vars jsonb, p_route jsonb)
returns uuid language plpgsql security definer set search_path = app, public, extensions as $$
declare v_id uuid; v_status text; v_why text;
begin
  if p_to is null then return null; end if;
  if to_regprocedure('app.enqueue_message(uuid,text,text,text,jsonb,text)') is null then return null; end if;
  begin
    v_id := app.enqueue_message(p_center, p_channel, p_to, p_template, p_vars, 'notification');
    update app.messages set payload = payload || coalesce(p_route, '{}'::jsonb) where id = v_id;
    select m.status, m.failure_reason into v_status, v_why from app.messages m where m.id = v_id;
    if v_status = 'suppressed' then
      perform app.log_audit(p_center, 'gyan_homework.notice_failed', 'messages', v_id::text, null,
                            jsonb_build_object('template', p_template, 'channel', p_channel, 'error', v_why),
                            'Homework notice not sent');
    end if;
  exception when others then
    perform app.log_audit(p_center, 'gyan_homework.notice_failed', 'messages', p_template, null,
                          jsonb_build_object('template', p_template, 'channel', p_channel, 'error', sqlerrm, 'person_id', p_vars->>'person_id'),
                          'Homework notice not sent');
    return null;
  end;
  return v_id;
end $$;

-- A push to every login of the person in this community, and (p_email) an email to the person's address.
create or replace function app._gyan_homework_notify_person(p_center uuid, p_template text, p_person uuid, p_vars jsonb, p_route jsonb, p_email boolean)
returns int language plpgsql security definer set search_path = app, public, extensions as $$
declare r record; n int := 0; v_email text; v_vars jsonb;
begin
  v_vars := coalesce(p_vars, '{}'::jsonb) || jsonb_build_object('person_id', p_person::text);
  for r in select cu.user_id from app.center_users cu where cu.center_id = p_center and cu.person_id = p_person loop
    if app._gyan_homework_send(p_center, p_template, 'push', r.user_id::text, v_vars, p_route) is not null then n := n + 1; end if;
  end loop;
  if p_email then
    select nullif(btrim(p.email::text), '') into v_email from app.people p where p.id = p_person and not coalesce(p.is_deceased, false);
    if v_email is not null and app._gyan_homework_send(p_center, p_template, 'email', v_email, v_vars, p_route) is not null then n := n + 1; end if;
  end if;
  return n;
end $$;

-- The logins that review a learner's homework: content.manage holders when the assignment's reviewer is content;
-- otherwise the Teachers of the homework's class (or, for homework for everyone, of the classes the learner is placed
-- or active in), and when there are none the community's pathshala.teach / pathshala.manage holders.
create or replace function app._gyan_homework_reviewer_users(p_center uuid, p_person uuid, p_class uuid, p_reviewer text) returns uuid[]
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v uuid[];
begin
  if p_reviewer = 'content' then
    select coalesce(array_agg(distinct g.user_id), '{}') into v
      from app.role_grants g join app.roles r on r.key = g.role_key
     where g.center_id = p_center and g.status = 'active' and g.scope_kind in ('center','platform','pathshala','store')
       and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now())
       and (r.permissions ? 'content.manage' or r.permissions ? '*');
    return v;
  end if;
  select coalesce(array_agg(distinct g.user_id), '{}') into v
    from app.role_grants g
   where g.center_id = p_center and g.role_key = 'teacher' and g.status = 'active' and g.scope_kind = 'class'
     and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now())
     and ((p_class is not null and g.scope_id = p_class)
          or (p_class is null and g.scope_id in (select e.class_id from app.pathshala_enrollments e
                                                   where e.center_id = p_center and e.student_person_id = p_person
                                                     and e.class_id is not null and e.status in ('placed', 'active'))));
  if cardinality(v) > 0 then return v; end if;
  select coalesce(array_agg(distinct g.user_id), '{}') into v
    from app.role_grants g join app.roles r on r.key = g.role_key
   where g.center_id = p_center and g.status = 'active' and g.scope_kind in ('center','platform','pathshala','store')
     and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now())
     and (r.permissions ? 'pathshala.teach' or r.permissions ? 'pathshala.manage' or r.permissions ? '*');
  return v;
end $$;

-- The template variables for one learner's homework (title, level, learner, note, due, deep_link, type), and the
-- routing a tapped push needs.
create or replace function app._gyan_homework_vars(p_assignment uuid, p_person uuid, p_note text, p_type text, p_submission uuid)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare a app.gyan_assignments; l app.gyan_levels; v_due date;
begin
  select * into a from app.gyan_assignments where id = p_assignment;
  select * into l from app.gyan_levels where id = a.level_id;
  v_due := app.gyan_assignment_due_on(a.id, p_person);
  return jsonb_build_object(
    'title', a.title, 'level', coalesce(l.name, ''), 'learner', coalesce(app.gyan_learner_name(p_person), ''),
    'note', coalesce(p_note, ''),
    'due', case when v_due is null then 'No due date' else 'Due ' || to_char(v_due, 'FMMonth FMDD, YYYY') end,
    'deep_link', '/gyan/homework/' || a.id::text || '?person=' || p_person::text,
    'type', p_type,
    'assignment_id', a.id::text, 'learner_id', p_person::text)
    || case when p_submission is null then '{}'::jsonb else jsonb_build_object('submission_id', p_submission::text) end;
end $$;

-- The routing keys of those vars (the push's data).
create or replace function app._gyan_homework_route(p_vars jsonb) returns jsonb
language sql immutable set search_path = app, public, extensions as $$
  select jsonb_strip_nulls(jsonb_build_object('type', p_vars->'type', 'deep_link', p_vars->'deep_link',
           'assignment_id', p_vars->'assignment_id', 'submission_id', p_vars->'submission_id', 'learner_id', p_vars->'learner_id'))
$$;

-- Tell the learner (p_learner) and the adults of their household (push + email): for a child always, for an adult
-- learner only when p_adults says so (the parent's check of an "always" homework waits for the other adult of the
-- household). The push's type is homework for the learner and homework_parent for a household adult (the member app
-- routes both to the homework screen; the adult's opens the child's). Returns how many were queued.
create or replace function app._gyan_homework_notify_family(p_center uuid, p_template text, p_assignment uuid, p_person uuid, p_note text, p_submission uuid, p_learner boolean, p_adults boolean default false)
returns int language plpgsql security definer set search_path = app, public, extensions as $$
declare v jsonb; v_adult jsonb; n int := 0; r record;
begin
  if p_learner then
    v := app._gyan_homework_vars(p_assignment, p_person, p_note, 'homework', p_submission);
    n := n + app._gyan_homework_notify_person(p_center, p_template, p_person, v, app._gyan_homework_route(v), true);
  end if;
  if p_adults or app.person_is_minor(p_person) then
    v_adult := app._gyan_homework_vars(p_assignment, p_person, p_note, 'homework_parent', p_submission);
    for r in select * from app._gyan_homework_adults(p_center, p_person) as x(person_id) loop
      n := n + app._gyan_homework_notify_person(p_center, p_template, r.person_id, v_adult, app._gyan_homework_route(v_adult), true);
    end loop;
  end if;
  return n;
end $$;

-- Tell the reviewers (push only). Returns how many were queued.
create or replace function app._gyan_homework_notify_reviewers(p_center uuid, p_assignment uuid, p_person uuid, p_submission uuid)
returns int language plpgsql security definer set search_path = app, public, extensions as $$
declare a app.gyan_assignments; v jsonb; v_route jsonb; n int := 0; u uuid; v_person uuid;
begin
  select * into a from app.gyan_assignments where id = p_assignment;
  -- Teachers review in the portal and the member app has no screen for them: their push has its own type and no deep
  -- link, so a tap just opens the app.
  v := app._gyan_homework_vars(p_assignment, p_person, null, 'homework_review', p_submission) - 'deep_link';
  v_route := app._gyan_homework_route(v);
  foreach u in array app._gyan_homework_reviewer_users(p_center, p_person, a.class_id, a.reviewer) loop
    select cu.person_id into v_person from app.center_users cu where cu.center_id = p_center and cu.user_id = u;
    if app._gyan_homework_send(p_center, 'homework.submitted', 'push', u::text,
                               v || case when v_person is null then '{}'::jsonb else jsonb_build_object('person_id', v_person::text) end,
                               v_route) is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- ── The assignments ──────────────────────────────────────────────────────────
-- The table's own guard (writes come through the RPCs, which say the same things first in plain English; this holds
-- for scripts and workers too): the class is one of this community's, the level is this community's own or the
-- shared library's, the due rule is well formed, and the title and kinds are tidy.
create or replace function app.gyan_assignments_guard() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_goal_center uuid; v_problem text;
begin
  new.title := btrim(coalesce(new.title, ''));
  new.instructions_md := nullif(btrim(coalesce(new.instructions_md, '')), '');
  new.allowed_kinds := (select coalesce(array_agg(distinct k order by k), '{}') from unnest(new.allowed_kinds) k);
  if new.class_id is not null and not exists (select 1 from app.pathshala_classes c where c.id = new.class_id and c.center_id = new.center_id) then
    raise exception 'That Pathshala class is not one of this community''s classes.' using errcode = '22023';
  end if;
  select g.center_id into v_goal_center from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id where l.id = new.level_id;
  if not found then raise exception 'That lesson level was not found.' using errcode = 'P0002'; end if;
  if v_goal_center is not null and v_goal_center <> new.center_id then
    raise exception 'That lesson belongs to another community.' using errcode = 'insufficient_privilege';
  end if;
  v_problem := app.gyan_due_rule_problem(new.due_rule);
  if v_problem is not null then raise exception '%', v_problem using errcode = '22023'; end if;
  return new;
end $$;
drop trigger if exists gyan_assignments_guard on app.gyan_assignments;
create trigger gyan_assignments_guard before insert or update on app.gyan_assignments
  for each row execute function app.gyan_assignments_guard();

-- Insert (no "id") or update. Validates every field in plain English; the status is set with
-- app.set_gyan_assignment_status (a new row starts as a draft).
create or replace function app.save_gyan_assignment(p_center uuid, p_assignment jsonb) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  a app.gyan_assignments; v_id uuid; v_level uuid; v_class uuid; v_title text; v_instr text; v_kinds text[];
  v_max int; v_required boolean; v_points int; v_due jsonb; v_parent text; v_reviewer text; v_sort int; v_problem text;
  v_level_name text; v_goal_center uuid; j jsonb := coalesce(p_assignment, '{}'::jsonb); k text; v_has_answers boolean;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then
    raise exception 'That community was not found.' using errcode = 'P0002';
  end if;
  perform app.assert_module_enabled(p_center, 'gyan_path');
  if jsonb_typeof(j) <> 'object' then raise exception 'The homework must be a JSON object.' using errcode = '22023'; end if;

  -- The row being changed, if any.
  if coalesce(jsonb_typeof(j->'id'), 'null') <> 'null' then
    if jsonb_typeof(j->'id') <> 'string' or (j->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'The homework''s "id" must be a UUID.' using errcode = '22023';
    end if;
    v_id := (j->>'id')::uuid;
    select * into a from app.gyan_assignments where id = v_id for update;
    if a.id is null or a.center_id <> p_center then
      raise exception 'That homework was not found. It may have been removed; reload the page.' using errcode = 'P0002';
    end if;
    if app.gyan_homework_editor(p_center, a.class_id) is not true then
      raise exception 'Changing this homework needs content.manage or pathshala.manage, or the Teacher role for its class.' using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- Level.
  if jsonb_typeof(j->'level_id') = 'string' and (j->>'level_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_level := (j->>'level_id')::uuid;
  elsif a.id is not null and coalesce(jsonb_typeof(j->'level_id'), 'null') = 'null' then
    v_level := a.level_id;
  else
    raise exception 'Choose the lesson level the homework belongs to.' using errcode = '22023';
  end if;
  select l.name, g.center_id into v_level_name, v_goal_center from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id where l.id = v_level;
  if not found then raise exception 'That lesson level was not found. It may have been removed; reload the page.' using errcode = 'P0002'; end if;
  if v_goal_center is not null and v_goal_center <> p_center then
    raise exception 'That lesson belongs to another community.' using errcode = 'insufficient_privilege';
  end if;

  -- Class (null = everyone doing the level).
  if coalesce(jsonb_typeof(j->'class_id'), 'null') = 'null' then
    v_class := case when a.id is not null and not (j ? 'class_id') then a.class_id end;
  elsif jsonb_typeof(j->'class_id') = 'string' and (j->>'class_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_class := (j->>'class_id')::uuid;
    if not exists (select 1 from app.pathshala_classes c where c.id = v_class and c.center_id = p_center) then
      raise exception 'That Pathshala class is not one of this community''s classes.' using errcode = '22023';
    end if;
  else
    raise exception 'The class must be one of this community''s Pathshala classes, or left empty for everyone.' using errcode = '22023';
  end if;

  -- Who may: content.manage or pathshala.manage; a class Teacher only for their own class (H2).
  if app.gyan_homework_editor(p_center, v_class) is not true then
    if v_class is null and app.has_role(p_center, 'teacher') then
      raise exception 'Teachers can set homework for their own class only: choose the class.' using errcode = 'insufficient_privilege';
    end if;
    raise exception 'Setting homework needs content.manage or pathshala.manage, or the Teacher role for the class it is for.' using errcode = 'insufficient_privilege';
  end if;

  -- Title and instructions.
  v_title := btrim(coalesce(j->>'title', a.title, ''));
  if v_title = '' then raise exception 'Give the homework a title.' using errcode = '22023'; end if;
  if char_length(v_title) > 120 then raise exception 'The title can be at most 120 characters.' using errcode = '22023'; end if;
  v_instr := case when j ? 'instructions_md' then nullif(btrim(coalesce(j->>'instructions_md', '')), '') else a.instructions_md end;
  if char_length(v_instr) > 4000 then raise exception 'The instructions can be at most 4,000 characters.' using errcode = '22023'; end if;

  -- How the learner may answer.
  if j ? 'allowed_kinds' then
    if jsonb_typeof(j->'allowed_kinds') <> 'array' then
      raise exception 'Choose at least one way to answer: photo, file, voice or text.' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct x order by x), '{}') into v_kinds from jsonb_array_elements_text(j->'allowed_kinds') x;
    if cardinality(v_kinds) = 0 then raise exception 'Choose at least one way to answer: photo, file, voice or text.' using errcode = '22023'; end if;
    foreach k in array v_kinds loop
      if k not in ('photo', 'file', 'voice', 'text') then
        raise exception '"%" is not a way to answer homework (photo, file, voice or text).', k using errcode = '22023';
      end if;
    end loop;
  else
    v_kinds := coalesce(a.allowed_kinds, '{photo,voice,text}');
  end if;
  if j ? 'max_files' then
    if jsonb_typeof(j->'max_files') <> 'number' or (j->>'max_files')::numeric <> floor((j->>'max_files')::numeric)
       or (j->>'max_files')::numeric not between 1 and 10 then
      raise exception 'The number of files allowed must be a whole number from 1 to 10.' using errcode = '22023';
    end if;
    v_max := (j->>'max_files')::int;
  else
    v_max := coalesce(a.max_files, 3);
  end if;
  if j ? 'required_for_level' then
    if jsonb_typeof(j->'required_for_level') <> 'boolean' then raise exception '"required_for_level" must be true or false.' using errcode = '22023'; end if;
    v_required := (j->>'required_for_level')::boolean;
  else
    v_required := coalesce(a.required_for_level, false);
  end if;
  if j ? 'points' then
    if jsonb_typeof(j->'points') <> 'number' or (j->>'points')::numeric <> floor((j->>'points')::numeric)
       or (j->>'points')::numeric not between 0 and 1000 then
      raise exception 'Points must be a whole number from 0 to 1,000.' using errcode = '22023';
    end if;
    v_points := (j->>'points')::int;
  else
    v_points := coalesce(a.points, 10);
  end if;
  v_due := case when j ? 'due_rule' then j->'due_rule' else coalesce(a.due_rule, '{"kind":"none"}'::jsonb) end;
  v_problem := app.gyan_due_rule_problem(v_due);
  if v_problem is not null then raise exception '%', v_problem using errcode = '22023'; end if;
  v_parent := coalesce(j->>'parent_check', a.parent_check, 'children');
  if v_parent not in ('never', 'children', 'always') then
    raise exception 'The parent check must be "never", "children" or "always".' using errcode = '22023';
  end if;
  v_reviewer := coalesce(j->>'reviewer', a.reviewer, 'teacher');
  if v_reviewer not in ('teacher', 'content') then
    raise exception 'The reviewer must be "teacher" or "content".' using errcode = '22023';
  end if;
  if j ? 'sort_order' then
    if jsonb_typeof(j->'sort_order') <> 'number' then raise exception '"sort_order" must be a number.' using errcode = '22023'; end if;
    v_sort := least(greatest(floor((j->>'sort_order')::numeric), -1000000), 1000000)::int;
  else
    v_sort := coalesce(a.sort_order, 0);
  end if;
  if a.id is null and coalesce(j->>'status', 'draft') <> 'draft' then
    raise exception 'New homework starts as a draft; save it, then publish it.' using errcode = '22023';
  end if;

  if a.id is not null then
    -- Once there are answers, the homework stays on its lesson and with its class.
    v_has_answers := exists (select 1 from app.gyan_submissions s where s.assignment_id = a.id);
    if v_has_answers and (v_level <> a.level_id or v_class is distinct from a.class_id) then
      raise exception 'This homework already has answers, so its lesson level and class cannot change. Archive it and make a new one.' using errcode = '22023';
    end if;
    -- A class Teacher may not move it to a class that is not theirs, nor open it to everyone.
    if v_class is distinct from a.class_id and app.gyan_homework_editor(p_center, v_class) is not true then
      raise exception 'Teachers can set homework for their own class only.' using errcode = 'insufficient_privilege';
    end if;
    perform app.set_audit_context('Changed homework "' || v_title || '" (' || v_level_name || ')');
    begin
      update app.gyan_assignments
         set level_id = v_level, class_id = v_class, title = v_title, instructions_md = v_instr, allowed_kinds = v_kinds,
             max_files = v_max, required_for_level = v_required, points = v_points, due_rule = v_due,
             parent_check = v_parent, reviewer = v_reviewer, sort_order = v_sort
       where id = a.id;
    exception when unique_violation then
      raise exception 'There is already homework called "%" on this lesson level.', v_title using errcode = '23505';
    end;
    return app.gyan_assignment_json(a.id);
  end if;

  perform app.set_audit_context('Created homework "' || v_title || '" (' || v_level_name || ')');
  begin
    insert into app.gyan_assignments (center_id, level_id, class_id, title, instructions_md, allowed_kinds, max_files, required_for_level,
                                      points, due_rule, parent_check, reviewer, status, sort_order, created_by)
    values (p_center, v_level, v_class, v_title, v_instr, v_kinds, v_max, v_required, v_points, v_due, v_parent, v_reviewer, 'draft', v_sort, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'There is already homework called "%" on this lesson level.', v_title using errcode = '23505';
  end;
  return app.gyan_assignment_json(v_id);
end $$;

-- draft → published → archived; published → draft only while nobody has started an answer. Publishing tells every
-- learner it applies to (push + email), and the household adults of each child learner: the students placed in the
-- homework's class, or, for homework for everyone, the members who have completed a step of the level (a whole
-- community is never messaged for one lesson's homework; the level screen shows it to everyone anyway).
create or replace function app.set_gyan_assignment_status(p_assignment uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare a app.gyan_assignments; l app.gyan_levels; r record; n int := 0;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  select * into a from app.gyan_assignments where id = p_assignment for update;
  if a.id is null then raise exception 'That homework was not found. It may have been removed; reload the page.' using errcode = 'P0002'; end if;
  perform app.assert_module_enabled(a.center_id, 'gyan_path');
  if app.gyan_homework_editor(a.center_id, a.class_id) is not true then
    raise exception 'Changing this homework needs content.manage or pathshala.manage, or the Teacher role for its class.' using errcode = 'insufficient_privilege';
  end if;
  if p_status is null or p_status not in ('draft', 'published', 'archived') then
    raise exception 'The status must be "draft", "published" or "archived".' using errcode = '22023';
  end if;
  if p_status = a.status then return app.gyan_assignment_json(a.id); end if;
  select * into l from app.gyan_levels where id = a.level_id;
  if a.status = 'draft' and p_status = 'published' then
    perform app.set_audit_context('Published homework "' || a.title || '" (' || l.name || ')');
    update app.gyan_assignments set status = 'published', published_at = now() where id = a.id;
    for r in
      select distinct p.id as person_id
        from app.people p
       where p.center_id = a.center_id and not coalesce(p.is_deceased, false)
         and (case when a.class_id is not null
                   then exists (select 1 from app.pathshala_enrollments e
                                 where e.student_person_id = p.id and e.class_id = a.class_id and e.status in ('placed', 'active'))
                   else exists (select 1 from app.gyan_progress gp join app.gyan_steps st on st.id = gp.step_id
                                 where gp.person_id = p.id and st.level_id = a.level_id and gp.completed_at is not null) end)
    loop
      n := n + app._gyan_homework_notify_family(a.center_id, 'homework.assigned', a.id, r.person_id, null, null, true);
    end loop;
  elsif a.status = 'published' and p_status = 'archived' then
    perform app.set_audit_context('Archived homework "' || a.title || '" (' || l.name || ')');
    update app.gyan_assignments set status = 'archived' where id = a.id;
  elsif a.status = 'published' and p_status = 'draft' then
    if exists (select 1 from app.gyan_submissions s where s.assignment_id = a.id) then
      raise exception 'Someone has already started this homework, so it cannot go back to a draft. Archive it instead.' using errcode = '22023';
    end if;
    perform app.set_audit_context('Unpublished homework "' || a.title || '" (' || l.name || ')');
    update app.gyan_assignments set status = 'draft' where id = a.id;
  elsif a.status = 'archived' then
    raise exception 'Archived homework stays archived; make new homework instead.' using errcode = '22023';
  else
    raise exception 'Homework goes from draft to published, then to archived (a draft cannot be archived).' using errcode = '22023';
  end if;
  return app.gyan_assignment_json(a.id);
end $$;

-- ── The learner's view ───────────────────────────────────────────────────────
-- Handing in NOW, by this caller, for this person, would wait for a parent: the caller is the learner, the
-- assignment asks for it (always, or children and the learner is under 18), and there is a household adult to ask.
create or replace function app._gyan_homework_waits_for_parent(p_center uuid, p_assignment uuid, p_person uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(app.my_person_id(p_center) = p_person, false)
     and exists (select 1 from app.gyan_assignments a where a.id = p_assignment
                  and (a.parent_check = 'always' or (a.parent_check = 'children' and app.person_is_minor(p_person))))
     and exists (select 1 from app._gyan_homework_adults(p_center, p_person))
$$;


-- The caller's own homework and, when the caller is an adult, every current member of their households'; only
-- published homework that applies to each person.
create or replace function app.my_gyan_homework(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_me uuid; v_people uuid[]; v_adult boolean;
begin
  if auth.uid() is null then raise exception 'Sign in to see your homework.' using errcode = 'insufficient_privilege'; end if;
  perform app.assert_module_enabled(p_center, 'gyan_path');
  v_me := app.my_person_id(p_center);
  if v_me is null then raise exception 'Only members of this community can see its homework.' using errcode = 'insufficient_privilege'; end if;
  v_adult := app.i_am_adult(p_center);
  select array[v_me] || coalesce(array_agg(x.person_id order by x.date_of_birth desc nulls last, x.first_name), '{}') into v_people
    from (select distinct p.id as person_id, p.date_of_birth, p.first_name
            from app.household_members hm join app.people p on p.id = hm.person_id
           where v_adult and hm.center_id = p_center and hm.left_at is null and hm.person_id <> v_me
             and hm.household_id in (select app.my_household_ids(p_center)) and not coalesce(p.is_deceased, false)) x;
  return jsonb_build_object(
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('person_id', p.id,
                                          'name', coalesce(nullif(btrim(p.preferred_name), ''), p.first_name) || ' ' || p.last_name,
                                          'is_child', app.person_is_minor(p.id)) order by o.ord)
        from unnest(v_people) with ordinality o(id, ord) join app.people p on p.id = o.id), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'assignment', jsonb_build_object(
                 'id', a.id, 'level_id', a.level_id, 'goal_id', l.goal_id, 'title', a.title, 'instructions_md', a.instructions_md,
                 'allowed_kinds', to_jsonb(a.allowed_kinds), 'max_files', a.max_files, 'points', a.points,
                 'required_for_level', a.required_for_level, 'due_on', app.gyan_assignment_due_on(a.id, o.id),
                 'parent_check', a.parent_check, 'class_id', a.class_id),
               'person_id', o.id,
               'submission', case when s.id is null then null else app.gyan_submission_json(s.id) end,
               'needs_parent', app._gyan_homework_waits_for_parent(p_center, a.id, o.id),
               'can_parent_decide', s.id is not null and s.status = 'awaiting_parent' and v_adult and o.id <> v_me)
             order by o.ord, l.sort_order, a.sort_order, a.title)
        from unnest(v_people) with ordinality o(id, ord)
        join app.gyan_assignments a on a.center_id = p_center and a.status = 'published' and app.gyan_assignment_applies(a.id, o.id)
        join app.gyan_levels l on l.id = a.level_id
        left join app.gyan_submissions s on s.assignment_id = a.id and s.person_id = o.id), '[]'::jsonb));
end $$;

-- ── The answer ───────────────────────────────────────────────────────────────
-- Is this MIME type one the bucket takes for this kind of part?
create or replace function app.gyan_homework_mime_ok(p_kind text, p_mime text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select p_mime is not null
     and exists (select 1 from storage.buckets b where b.id = 'homework' and p_mime = any (b.allowed_mime_types))
     and case p_kind when 'photo' then p_mime like 'image/%' when 'voice' then p_mime like 'audio/%' else true end
$$;

-- Creates the draft when there is none (so the app has an id to upload under), or updates it; a sent-back answer
-- becomes a draft again with attempt + 1. The file set is replaced by p_files: [{kind, storage_path, mime_type,
-- bytes, duration_seconds}], each under <center>/<person>/<submission>/<name> in the homework bucket.
create or replace function app.save_gyan_submission_draft(p_assignment uuid, p_person uuid, p_text text, p_files jsonb) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  a app.gyan_assignments; s app.gyan_submissions; v_text text; v_name text; v_prefix text; f jsonb; i int; n int;
  v_kind text; v_path text; v_mime text; v_bytes numeric; v_dur numeric; v_paths text[] := '{}';
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  select * into a from app.gyan_assignments where id = p_assignment;
  if a.id is null then raise exception 'That homework was not found. It may have been removed; reload the lesson.' using errcode = 'P0002'; end if;
  perform app.assert_module_enabled(a.center_id, 'gyan_path');
  if p_person is null or not exists (select 1 from app.people p where p.id = p_person and p.center_id = a.center_id) then
    raise exception 'That person is not a member of this community.' using errcode = 'P0002';
  end if;
  if app.can_act_for_person(a.center_id, p_person) is not true then
    raise exception 'You can only do homework for yourself or for someone in your family.' using errcode = 'insufficient_privilege';
  end if;
  v_name := coalesce(app.gyan_learner_name(p_person), 'the learner');
  if a.status <> 'published' then
    raise exception 'This homework is % and cannot be answered.', case a.status when 'draft' then 'not published yet' else 'archived' end using errcode = '22023';
  end if;
  if not app.gyan_assignment_applies(a.id, p_person) then
    raise exception 'This homework is for another class, not for %.', v_name using errcode = 'insufficient_privilege';
  end if;

  -- One answer per learner per homework; serialised so two taps cannot make two. The audit reason is set first:
  -- the row's insert is audited too.
  perform app.set_audit_context('Saved a draft of homework "' || a.title || '" for ' || v_name
                                || case when app.person_is_minor(p_person) then ' (child)' else '' end);
  insert into app.gyan_submissions (center_id, assignment_id, person_id) values (a.center_id, a.id, p_person)
  on conflict (assignment_id, person_id) do nothing;
  select * into s from app.gyan_submissions where assignment_id = a.id and person_id = p_person for update;
  if s.status = 'awaiting_parent' then
    raise exception 'This homework is waiting for a parent''s OK and cannot be changed now.' using errcode = '22023';
  elsif s.status = 'submitted' then
    raise exception 'This homework is with the teacher and cannot be changed now.' using errcode = '22023';
  elsif s.status = 'accepted' then
    raise exception 'This homework was accepted and cannot be changed.' using errcode = '22023';
  end if;

  -- The written answer.
  v_text := nullif(btrim(coalesce(p_text, '')), '');
  if v_text is not null and not ('text' = any (a.allowed_kinds)) then
    raise exception 'This homework does not take a written answer.' using errcode = '22023';
  end if;
  if char_length(v_text) > 2000 then raise exception 'The written answer can be at most 2,000 characters.' using errcode = '22023'; end if;

  -- The parts.
  if p_files is not null and jsonb_typeof(p_files) <> 'array' then
    raise exception 'The files must be a list.' using errcode = '22023';
  end if;
  n := coalesce(jsonb_array_length(p_files), 0);
  if n > a.max_files then
    raise exception 'This homework takes at most % %.', a.max_files, case when a.max_files = 1 then 'file' else 'files' end using errcode = '22023';
  end if;
  v_prefix := a.center_id::text || '/' || p_person::text || '/' || s.id::text || '/';
  delete from app.gyan_submission_files where submission_id = s.id;
  for i in 0 .. n - 1 loop
    f := p_files->i;
    if jsonb_typeof(f) <> 'object' then raise exception 'File % must be an object with kind, storage_path, mime_type and bytes.', i + 1 using errcode = '22023'; end if;
    v_kind := f->>'kind';
    if v_kind is null or v_kind not in ('photo', 'file', 'voice') then
      raise exception 'File %: the kind must be photo, file or voice.', i + 1 using errcode = '22023';
    end if;
    if not (v_kind = any (a.allowed_kinds)) then
      raise exception 'This homework does not take a % answer.', case v_kind when 'photo' then 'photo' when 'voice' then 'voice note' else 'file' end using errcode = '22023';
    end if;
    v_path := f->>'storage_path';
    if v_path is null or left(v_path, char_length(v_prefix)) <> v_prefix or app.storage_segment(v_path, 4) is null
       or app.storage_segment(v_path, 5) is not null or position('..' in v_path) > 0 or char_length(v_path) > 500 then
      raise exception 'File %: its path must be <community>/<person>/<submission>/<file name> for this answer.', i + 1 using errcode = '22023';
    end if;
    if v_path = any (v_paths) then raise exception 'File %: the same file is listed twice.', i + 1 using errcode = '22023'; end if;
    v_paths := v_paths || v_path;
    v_mime := nullif(btrim(coalesce(f->>'mime_type', '')), '');
    if not app.gyan_homework_mime_ok(v_kind, v_mime) then
      raise exception 'File %: "%" is not a file type this homework takes for a %.', i + 1, coalesce(v_mime, '?'),
        case v_kind when 'photo' then 'photo' when 'voice' then 'voice note' else 'file' end using errcode = '22023';
    end if;
    if jsonb_typeof(f->'bytes') <> 'number' then raise exception 'File %: "bytes" must be the file''s size in bytes.', i + 1 using errcode = '22023'; end if;
    v_bytes := (f->>'bytes')::numeric;
    if v_bytes < 1 or v_bytes > 26214400 or v_bytes <> floor(v_bytes) then
      raise exception 'File %: a homework file can be at most 25 MB.', i + 1 using errcode = '22023';
    end if;
    v_dur := null;
    if coalesce(jsonb_typeof(f->'duration_seconds'), 'null') <> 'null' then
      if jsonb_typeof(f->'duration_seconds') <> 'number' then raise exception 'File %: "duration_seconds" must be a number.', i + 1 using errcode = '22023'; end if;
      v_dur := (f->>'duration_seconds')::numeric;
      if v_dur < 0 or v_dur > 86400 then raise exception 'File %: "duration_seconds" is out of range.', i + 1 using errcode = '22023'; end if;
    end if;
    insert into app.gyan_submission_files (center_id, submission_id, kind, storage_path, mime_type, bytes, duration_seconds, sort_order)
    values (a.center_id, s.id, v_kind, v_path, v_mime, v_bytes::int, round(v_dur)::int, i);
  end loop;

  update app.gyan_submissions
     set text_answer = v_text,
         status = 'draft',
         attempt = case when s.status = 'needs_work' then s.attempt + 1 else s.attempt end
   where id = s.id;
  return app.gyan_submission_json(s.id);
end $$;

-- Hand in: a child's own hand-in waits for a household adult when the homework asks for it (parent_check always, or
-- children and the learner is under 18) and there is an adult in the household to ask; a household adult handing in
-- for someone else in the family goes straight to the teacher and is recorded as the parent (they are the parent).
-- Needs at least one part. A late hand-in is marked, never refused (H5).
create or replace function app.hand_in_gyan_submission(p_submission uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.gyan_submissions; a app.gyan_assignments; v_name text; v_me uuid; v_waits boolean; v_due date; v_late boolean; v_child boolean;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  select * into s from app.gyan_submissions where id = p_submission for update;
  if s.id is null then raise exception 'That homework answer was not found.' using errcode = 'P0002'; end if;
  select * into a from app.gyan_assignments where id = s.assignment_id;
  perform app.assert_module_enabled(s.center_id, 'gyan_path');
  if app.can_act_for_person(s.center_id, s.person_id) is not true then
    raise exception 'You can only hand in homework for yourself or for someone in your family.' using errcode = 'insufficient_privilege';
  end if;
  v_name := coalesce(app.gyan_learner_name(s.person_id), 'the learner');
  if a.status <> 'published' then
    raise exception 'This homework is % and cannot be handed in.', case a.status when 'draft' then 'not published yet' else 'archived' end using errcode = '22023';
  end if;
  if s.status = 'awaiting_parent' then
    raise exception 'This homework is already handed in and waiting for a parent''s OK.' using errcode = '22023';
  elsif s.status = 'submitted' then
    raise exception 'This homework is already with the teacher.' using errcode = '22023';
  elsif s.status = 'accepted' then
    raise exception 'This homework was already accepted.' using errcode = '22023';
  elsif s.status = 'needs_work' then
    raise exception 'The teacher sent this homework back: change it and save it first, then hand it in again.' using errcode = '22023';
  end if;
  if s.text_answer is null and not exists (select 1 from app.gyan_submission_files f where f.submission_id = s.id and f.storage_path is not null) then
    raise exception 'Add a photo, a file, a voice note or a written answer before handing in.' using errcode = '22023';
  end if;
  v_me := app.my_person_id(s.center_id);
  v_child := app.person_is_minor(s.person_id);
  v_waits := app._gyan_homework_waits_for_parent(s.center_id, a.id, s.person_id);
  v_due := app.gyan_assignment_due_on(a.id, s.person_id);
  v_late := v_due is not null and v_due < app.gyan_center_today(s.center_id);
  if v_waits then
    perform app.set_audit_context('Handed in homework "' || a.title || '" for ' || v_name || case when v_child then ' (child)' else '' end || ', awaiting a parent');
    update app.gyan_submissions
       set status = 'awaiting_parent', submitted_by = auth.uid(), submitted_at = now(), late = v_late,
           parent_user = null, parent_decided_at = null
     where id = s.id;
    -- The household adults are asked (an adult learner's too: "always" waits for the other adult); their push opens
    -- the family screen: its type says so.
    perform app._gyan_homework_notify_family(s.center_id, 'homework.parent_check', a.id, s.person_id, null, s.id, false, true);
  else
    perform app.set_audit_context('Handed in homework "' || a.title || '" for ' || v_name || case when v_child then ' (child)' else '' end
                                  || case when v_me is distinct from s.person_id then ' by a household adult' else '' end);
    update app.gyan_submissions
       set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(), late = v_late,
           parent_user = case when v_me is distinct from s.person_id then auth.uid() end,
           parent_decided_at = case when v_me is distinct from s.person_id then now() end
     where id = s.id;
    perform app._gyan_homework_notify_reviewers(s.center_id, a.id, s.person_id, s.id);
  end if;
  return app.gyan_submission_json(s.id);
end $$;

-- A household adult (not the learner) says the answer is ready for the teacher, or sends it back with a note.
create or replace function app.parent_decide_gyan_submission(p_submission uuid, p_decision text, p_note text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.gyan_submissions; a app.gyan_assignments; v_name text; v_note text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  select * into s from app.gyan_submissions where id = p_submission for update;
  if s.id is null then raise exception 'That homework answer was not found.' using errcode = 'P0002'; end if;
  select * into a from app.gyan_assignments where id = s.assignment_id;
  perform app.assert_module_enabled(s.center_id, 'gyan_path');
  v_name := coalesce(app.gyan_learner_name(s.person_id), 'the learner');
  if app.my_person_id(s.center_id) = s.person_id then
    raise exception 'You cannot give the parent''s OK for your own homework.' using errcode = 'insufficient_privilege';
  end if;
  if app.can_act_for_person(s.center_id, s.person_id) is not true then
    raise exception 'Only an adult of %''s household can check this homework.', v_name using errcode = 'insufficient_privilege';
  end if;
  if p_decision is null or p_decision not in ('ok', 'send_back') then
    raise exception 'The decision must be "ok" or "send_back".' using errcode = '22023';
  end if;
  if s.status <> 'awaiting_parent' then
    raise exception 'This homework is not waiting for a parent''s OK (it is %).',
      case s.status when 'draft' then 'still a draft' when 'submitted' then 'with the teacher' when 'accepted' then 'accepted' else 'sent back by the teacher' end
      using errcode = '22023';
  end if;
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if char_length(v_note) > 500 then raise exception 'The note can be at most 500 characters.' using errcode = '22023'; end if;
  if p_decision = 'ok' then
    perform app.set_audit_context('Parent OK for homework "' || a.title || '" of ' || v_name);
    update app.gyan_submissions
       set status = 'submitted', parent_user = auth.uid(), parent_decided_at = now(), parent_note = v_note
     where id = s.id;
    perform app._gyan_homework_notify_reviewers(s.center_id, a.id, s.person_id, s.id);
  else
    perform app.set_audit_context('Parent sent back homework "' || a.title || '" of ' || v_name);
    update app.gyan_submissions
       set status = 'draft', parent_user = auth.uid(), parent_decided_at = now(), parent_note = v_note
     where id = s.id;
    perform app._gyan_homework_notify_person(s.center_id, 'homework.sent_back_parent', s.person_id,
              app._gyan_homework_vars(a.id, s.person_id, v_note, 'homework', s.id),
              app._gyan_homework_route(app._gyan_homework_vars(a.id, s.person_id, v_note, 'homework', s.id)), false);
  end if;
  return app.gyan_submission_json(s.id);
end $$;

-- The reviewer accepts (the homework's points, once per assignment and person) or sends it back with a note. The
-- learner and the household adults are told either way (the feedback is never only the child's).
create or replace function app.review_gyan_submission(p_submission uuid, p_decision text, p_note text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.gyan_submissions; a app.gyan_assignments; v_name text; v_note text; v_paid boolean := false;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  select * into s from app.gyan_submissions where id = p_submission for update;
  if s.id is null then raise exception 'That homework answer was not found.' using errcode = 'P0002'; end if;
  select * into a from app.gyan_assignments where id = s.assignment_id;
  perform app.assert_module_enabled(s.center_id, 'gyan_path');
  v_name := coalesce(app.gyan_learner_name(s.person_id), 'the learner');
  if app.gyan_homework_reviewer(s.center_id, s.person_id, a.reviewer) is not true then
    if a.reviewer = 'content' then
      raise exception 'Reviewing this homework needs content.manage or pathshala.manage.' using errcode = 'insufficient_privilege';
    end if;
    raise exception 'Only %''s class teacher, or someone with pathshala.teach or pathshala.manage, can review this homework.', v_name using errcode = 'insufficient_privilege';
  end if;
  if p_decision is null or p_decision not in ('accept', 'send_back') then
    raise exception 'The decision must be "accept" or "send_back".' using errcode = '22023';
  end if;
  if s.status <> 'submitted' then
    raise exception 'This homework is not with the teacher (it is %).',
      case s.status when 'draft' then 'still a draft' when 'awaiting_parent' then 'waiting for a parent''s OK'
                    when 'accepted' then 'already accepted' else 'already sent back' end
      using errcode = '22023';
  end if;
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if char_length(v_note) > 1000 then raise exception 'The note can be at most 1,000 characters.' using errcode = '22023'; end if;
  if p_decision = 'send_back' then
    if v_note is null then raise exception 'Say what to change when sending homework back; the learner and their parents see the note.' using errcode = '22023'; end if;
    perform app.set_audit_context('Sent back homework "' || a.title || '" of ' || v_name);
    update app.gyan_submissions
       set status = 'needs_work', reviewer_user = auth.uid(), decided_at = now(), review_note = v_note
     where id = s.id;
    perform app._gyan_homework_notify_family(s.center_id, 'homework.sent_back', a.id, s.person_id, v_note, s.id, true);
    return app.gyan_submission_json(s.id);
  end if;

  perform app.set_audit_context('Accepted homework "' || a.title || '" of ' || v_name);
  -- The points, once ever per assignment and person (one submission per pair; its id is the once-only key).
  if a.points > 0 and not exists (select 1 from app.points_ledger p where p.person_id = s.person_id and p.reason = 'assignment' and p.ref_id = s.id) then
    insert into app.points_ledger (center_id, person_id, points, reason, ref_id, note)
    values (s.center_id, s.person_id, a.points, 'assignment', s.id, 'Homework: ' || a.title);
    v_paid := true;
  end if;
  update app.gyan_submissions
     set status = 'accepted', reviewer_user = auth.uid(), decided_at = now(), review_note = v_note,
         points_awarded = case when v_paid then a.points else points_awarded end
   where id = s.id;
  -- A required homework may have been the last thing the level was waiting for (H7).
  if a.required_for_level then
    perform app.gyan_award_level_bonus(s.center_id, s.person_id, a.level_id);
  end if;
  perform app._gyan_homework_notify_family(s.center_id, 'homework.accepted', a.id, s.person_id, v_note, s.id, true);
  return app.gyan_submission_json(s.id);
end $$;

-- The learner's household card for the queue: app.household_card's own JSON when the caller may see it (people.view,
-- giving.view or giving.record_offline, or their own household), else the reduced card with household_card's key names
-- and nothing more: the household's id, name and Connect number, so a learner is never shown by name alone. A class
-- Teacher, the queue's main reader, usually holds no people permission and gets the reduced card; nothing financial
-- ever reaches it.
create or replace function app._gyan_homework_household_card(p_household uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(
           (select to_jsonb(hc) from app.household_card(p_household) hc),
           (select jsonb_build_object('household_id', h.id, 'household_name', h.display_name, 'household_number', h.household_number)
              from app.households h where h.id = p_household))
$$;

-- ── The review queue ─────────────────────────────────────────────────────────
-- waiting: with the teacher, oldest first; decided: accepted or sent back, newest first; at most 200; only the
-- answers the caller may review.
create or replace function app.gyan_homework_queue(p_center uuid, p_view text) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  perform app.assert_module_enabled(p_center, 'gyan_path');
  if not (app.has_permission(p_center, 'pathshala.manage') or app.has_permission(p_center, 'pathshala.teach')
          or app.has_permission(p_center, 'content.manage')
          or exists (select 1 from app.role_grants g where g.center_id = p_center and g.user_id = auth.uid() and g.role_key = 'teacher'
                       and g.status = 'active' and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now()))) then
    raise exception 'You don''t have access to this area (the homework queue needs pathshala.teach, pathshala.manage, content.manage or a class Teacher role).'
      using errcode = 'insufficient_privilege';
  end if;
  if p_view is null or p_view not in ('waiting', 'decided') then
    raise exception 'The view must be "waiting" or "decided".' using errcode = '22023';
  end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(x.item order by x.o1 asc nulls last, x.o2 desc nulls last, x.o3)
      from (
        select jsonb_build_object(
                 'submission', app.gyan_submission_json(s.id),
                 'assignment', jsonb_build_object('id', a.id, 'title', a.title, 'points', a.points, 'class_id', a.class_id,
                                                  'level_name', l.name, 'goal_name', g.name),
                 'learner', jsonb_build_object(
                   'person_id', p.id,
                   'name', coalesce(nullif(btrim(p.preferred_name), ''), p.first_name) || ' ' || p.last_name,
                   'is_child', app.person_is_minor(p.id),
                   'household_id', hh.household_id,
                   'household_card', app._gyan_homework_household_card(hh.household_id))) as item,
               case when p_view = 'waiting' then s.submitted_at else null end as o1,
               case when p_view = 'decided' then s.decided_at else null end as o2,
               s.id as o3
          from app.gyan_submissions s
          join app.gyan_assignments a on a.id = s.assignment_id
          join app.gyan_levels l on l.id = a.level_id
          join app.gyan_goals g on g.id = l.goal_id
          join app.people p on p.id = s.person_id
          left join lateral (select hm.household_id
                               from app.household_members hm
                              where hm.person_id = p.id and hm.left_at is null
                              order by hm.is_primary desc, hm.joined_at nulls last, hm.household_id limit 1) hh on true
         where s.center_id = p_center
           and (case when p_view = 'waiting' then s.status = 'submitted' else s.status in ('accepted', 'needs_work') end)
           and app.gyan_homework_reviewer(s.center_id, s.person_id, a.reviewer)
         order by case when p_view = 'waiting' then s.submitted_at end asc, case when p_view = 'decided' then s.decided_at end desc, s.id
         limit 200) x), '[]'::jsonb));
end $$;

-- ── Level completion waits for required homework (H7) ────────────────────────
-- 0570's body, with one more condition: a level that has at least one published required_for_level assignment that
-- applies to the person is complete only once every such assignment is accepted. Same advisory lock, same once-only
-- ledger keys; app.review_gyan_submission(accept) calls it, so accepting the last required homework pays the bonus.
create or replace function app.gyan_award_level_bonus(p_center uuid, p_person uuid, p_level uuid) returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare l app.gyan_levels; v_total int; v_done int; v_paid int := 0;
begin
  if p_center is null or p_person is null or p_level is null then return 0; end if;
  perform pg_advisory_xact_lock(hashtextextended('app.gyan_level_award:' || p_person::text || ':' || p_level::text, 0));
  select * into l from app.gyan_levels where id = p_level;
  if not found then return 0; end if;
  -- Only a level of this community's own goal, or of the shared library, pays into it. (gyan_progress_guard already
  -- refuses another community's step; this keeps the award safe on its own.)
  if not exists (select 1 from app.gyan_goals g where g.id = l.goal_id and (g.center_id is null or g.center_id = p_center)) then
    return 0;
  end if;
  select count(*), count(gp.completed_at) into v_total, v_done
    from app.gyan_steps st
    left join app.gyan_progress gp on gp.step_id = st.id and gp.person_id = p_person
   where st.level_id = p_level;
  if v_total = 0 or v_done < v_total then return 0; end if;
  -- Required homework (0587): every published required_for_level assignment of this community on the level that
  -- applies to the person must be accepted.
  if exists (select 1 from app.gyan_assignments a
              where a.level_id = p_level and a.center_id = p_center and a.status = 'published' and a.required_for_level
                and app.gyan_assignment_applies(a.id, p_person)
                and not exists (select 1 from app.gyan_submissions s
                                 where s.assignment_id = a.id and s.person_id = p_person and s.status = 'accepted')) then
    return 0;
  end if;

  if not l.requires_teacher_signoff and coalesce(l.points, 0) > 0
     and not exists (select 1 from app.points_ledger p where p.person_id = p_person and p.reason = 'level' and p.ref_id = p_level) then
    insert into app.points_ledger (center_id, person_id, points, reason, ref_id, note)
      values (p_center, p_person, l.points, 'level', p_level, 'Gyan Path level complete: ' || l.name);
    v_paid := v_paid + l.points;
  end if;
  if coalesce(l.treasure_points, 0) > 0
     and not exists (select 1 from app.points_ledger p where p.person_id = p_person and p.reason = 'gyan_treasure' and p.ref_id = p_level) then
    insert into app.points_ledger (center_id, person_id, points, reason, ref_id, note)
      values (p_center, p_person, l.treasure_points, 'gyan_treasure', p_level, 'Gyan Path treasure: ' || coalesce(l.treasure, l.name));
    v_paid := v_paid + l.treasure_points;
  end if;
  return v_paid;
end $$;

comment on function app.gyan_award_level_bonus(uuid, uuid, uuid) is
  'Internal: once every step of the level is complete for the person, and every published required_for_level homework of the community on it that applies to the person is accepted (0587), pay the level''s points (only when it needs no teacher sign-off) and its treasure_points, each once ever. Pays nothing for a level of another community''s goal. Returns what it paid now.';

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table app.gyan_assignments enable row level security;
alter table app.gyan_submissions enable row level security;
alter table app.gyan_submission_files enable row level security;

-- Published homework to the community's members; drafts and archived homework to the people who may edit it.
drop policy if exists gyan_assignments_read on app.gyan_assignments;
create policy gyan_assignments_read on app.gyan_assignments for select to authenticated
  using ((status = 'published' and app.is_member_of(center_id)) or app.gyan_homework_editor(center_id, class_id));
-- The learner and the adults of their household, always; the reviewers once the answer is with them (submitted,
-- accepted or sent back), never a draft or an answer waiting for a parent. Nobody else, ever.
drop policy if exists gyan_submissions_read on app.gyan_submissions;
create policy gyan_submissions_read on app.gyan_submissions for select to authenticated
  using (app.can_act_for_person(center_id, person_id)
         or (status in ('submitted', 'accepted', 'needs_work')
             and app.gyan_homework_reviewer(center_id, person_id, app.gyan_assignment_reviewer(assignment_id))));
drop policy if exists gyan_submission_files_read on app.gyan_submission_files;
create policy gyan_submission_files_read on app.gyan_submission_files for select to authenticated
  using (app.gyan_submission_readable(submission_id));

do $$
declare t text;
begin
  foreach t in array array['gyan_assignments', 'gyan_submissions', 'gyan_submission_files'] loop
    execute format('drop policy if exists module_switch on app.%I', t);
    execute format($p$create policy module_switch on app.%I as restrictive for all to public
      using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('gyan_path'))::uuid[])))
      with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('gyan_path'))::uuid[])))$p$, t);
    -- No write policy and no write grant: the RPCs are the only way in (F1).
    execute format('revoke all on app.%I from public, anon, authenticated, connect_worker', t);
    execute format('grant select on app.%I to authenticated', t);
    execute format('grant all on app.%I to service_role', t);
  end loop;
end $$;

-- ── Storage: the homework bucket ─────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('homework', 'homework', false, 26214400, array[
     'image/png','image/jpeg','image/webp','image/heic','image/heif','application/pdf',
     'audio/mp4','audio/x-m4a','audio/mpeg','audio/aac','audio/webm','audio/wav','audio/x-wav','audio/ogg','audio/3gpp','audio/x-caf',
     'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
     'text/plain'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 0172's helpers with the homework bucket: it follows the Gyan Path module, every upload queues a scan, and it is
-- kept 365 days (a community may choose 1-3650, like recordings).
create or replace function app.storage_bucket_module(p_bucket text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case p_bucket when 'content' then 'content' when 'photos' then 'content' when 'store' then 'store'
                       when 'statements' then 'giving' when 'recordings' then 'gyan_path' when 'homework' then 'gyan_path' end
$$;

create or replace function app.storage_scan_buckets() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array['branding','content','photos','store','recordings','imports','org-documents','homework']
$$;

create or replace function app.storage_retention_days(p_bucket text, p_center uuid) returns int
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_default int; v_override text;
begin
  v_default := case p_bucket when 'imports' then 90 when 'exports' then 7 when 'recordings' then 90 when 'homework' then 365 end;
  if v_default is null then return null; end if;
  if p_bucket in ('imports','recordings','homework') and p_center is not null then
    select c.rules #>> array['storage','retention_days',p_bucket] into v_override from app.centers c where c.id = p_center;
    if v_override ~ '^[0-9]{1,4}$' and v_override::int between 1 and 3650 then return v_override::int; end if;
  end if;
  return v_default;
end $$;

-- 0585's bodies with the homework branch. Path <center>/<person>/<submission>/<file>.
--   write: the learner or a household adult (can_act_for_person), only while that person's answer to the homework is
--          a draft or was sent back, only under that answer's own folder;
--   read:  the same people, and the reviewers of that answer once it is with them (never a draft or an answer waiting for
--          a parent's OK): the learner's class Teacher, pathshala.teach /
--          pathshala.manage, content.manage when the homework's reviewer is content).
create or replace function app.can_read_object(bucket text, name text) returns boolean
language plpgsql stable security definer set search_path = app, public, extensions as $$
-- $1/$2: the contract names the arguments bucket and name, which read badly next to columns.
declare b text := $1; n text := $2; c uuid := app.storage_center($2); s2 uuid := app.storage_segment_uuid($2, 2);
begin
  if b = 'branding' then return c is not null; end if;
  if c is null or not exists (select 1 from app.centers where id = c) then return false; end if;
  if not (case when b = 'content' and app.storage_segment(n, 2) in ('events', 'flyer-art')
               then app.module_enabled(c, 'events') or app.is_platform_admin()
               else app.storage_module_on(b, c) end) then return false; end if;
  return case b
    when 'content'       then app.is_member_of(c) or app.event_flyer_is_public(n)
    when 'photos'        then app.has_permission(c, 'content.manage')
                              or (app.is_member_of(c) and (
                                    (auth.uid() is not null and app.storage_segment(n, 3) like auth.uid()::text || '-%')
                                    or exists (select 1 from app.photos p
                                                where p.center_id = c and p.status = 'approved'
                                                  and p.storage_path in (n, 'photos/' || n))))
    when 'store'         then app.is_member_of(c)
    when 'statements'    then app.has_permission(c, 'giving.view')
                              or (s2 is not null and app.adult_of_household(c, s2))
    when 'recordings'    then s2 is not null and (app.can_act_for_person(c, s2) or app.teaches_person(c, s2))
    when 'homework'      then s2 is not null and auth.uid() is not null and app.storage_segment_uuid(n, 3) is not null
                              and exists (select 1 from app.gyan_submissions s
                                           where s.id = app.storage_segment_uuid(n, 3) and s.center_id = c and s.person_id = s2)
                              and app.gyan_submission_readable(app.storage_segment_uuid(n, 3))
    when 'imports'       then app.has_permission(c, 'people.manage') or app.has_permission(c, 'giving.manage')
                              or app.has_permission(c, 'accounting.manage') or app.has_permission(c, 'settings.manage')
    when 'org-documents' then app.is_center_owner(c) or app.is_platform_admin()
    when 'exports'       then auth.uid() is not null and s2 = auth.uid()
    else false
  end;
end $$;

create or replace function app.can_write_object(bucket text, name text) returns boolean
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare b text := $1; n text := $2; c uuid := app.storage_center($2); s2 uuid := app.storage_segment_uuid($2, 2);
begin
  if c is null or auth.uid() is null or not exists (select 1 from app.centers where id = c) then return false; end if;
  if not (case when b = 'content' and app.storage_segment(n, 2) in ('events', 'flyer-art')
               then app.module_enabled(c, 'events') or app.is_platform_admin()
               else app.storage_module_on(b, c) end) then return false; end if;
  -- The AI art library: only layer names, only the library's writers (content.manage included).
  if b = 'content' and app.storage_segment(n, 2) = 'flyer-art' then
    return app.flyer_art_name_ok(n) and app.flyer_art_writer(c);
  end if;
  return case b
    when 'branding'      then app.has_permission(c, 'settings.manage')
    when 'content'       then app.has_permission(c, 'content.manage')
                              or (app.storage_segment(n, 2) = 'events' and app.storage_segment_uuid(n, 3) is not null
                                  and exists (select 1 from app.events ev
                                               where ev.id = app.storage_segment_uuid(n, 3) and ev.center_id = c)
                                  and (app.has_permission(c, 'events.manage') or app.has_scoped_role(c, app.storage_segment_uuid(n, 3), 'event_lead')))
    when 'photos'        then app.has_permission(c, 'content.manage')
                              or (app.is_member_of(c) and s2 is not null
                                  and app.storage_segment(n, 3) like auth.uid()::text || '-%')
    when 'store'         then app.has_permission(c, 'store.manage')
    when 'statements'    then app.has_permission(c, 'giving.manage')
    when 'recordings'    then s2 is not null and app.can_act_for_person(c, s2)
    when 'homework'      then s2 is not null and app.storage_segment(n, 4) is not null and app.storage_segment(n, 5) is null
                              and position('..' in n) = 0
                              and app.gyan_submission_writable(c, s2, app.storage_segment_uuid(n, 3))
    when 'imports'       then app.has_permission(c, 'people.manage') or app.has_permission(c, 'giving.manage')
                              or app.has_permission(c, 'accounting.manage') or app.has_permission(c, 'settings.manage')
    when 'org-documents' then app.is_center_owner(c)
    when 'exports'       then s2 = auth.uid() and app.is_member_of(c)
    else false
  end;
end $$;

revoke execute on function app.can_read_object(text, text), app.can_write_object(text, text) from public;
grant execute on function app.can_read_object(text, text), app.can_write_object(text, text) to anon, authenticated, service_role;

-- 0172's policies on storage.objects, now over ten buckets.
drop policy if exists connect_objects_read on storage.objects;
create policy connect_objects_read on storage.objects for select to anon, authenticated
  using (bucket_id in ('branding','content','photos','store','statements','recordings','imports','org-documents','exports','homework')
         and app.can_read_object(bucket_id, name));
drop policy if exists connect_objects_insert on storage.objects;
create policy connect_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('branding','content','photos','store','statements','recordings','imports','org-documents','exports','homework')
              and app.can_write_object(bucket_id, name));
drop policy if exists connect_objects_update on storage.objects;
create policy connect_objects_update on storage.objects for update to authenticated
  using (bucket_id in ('branding','content','photos','store','statements','recordings','imports','org-documents','exports','homework')
         and app.can_write_object(bucket_id, name))
  with check (bucket_id in ('branding','content','photos','store','statements','recordings','imports','org-documents','exports','homework')
              and app.can_write_object(bucket_id, name));
drop policy if exists connect_objects_delete on storage.objects;
create policy connect_objects_delete on storage.objects for delete to authenticated
  using (bucket_id in ('branding','content','photos','store','statements','recordings','imports','org-documents','exports','homework')
         and app.can_write_object(bucket_id, name));

-- 0585's retention bodies, with homework files past their retention, and the file rows told when they are gone.
create or replace function app.storage_expired_objects(p_limit int default 500)
returns table (bucket_id text, name text, center_id uuid, created_at timestamptz, retention_days int)
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  return query
  select x.bucket_id, x.name, x.center_id, x.created_at, x.retention_days
    from (
      select o.bucket_id::text as bucket_id, o.name::text as name, app.storage_center(o.name) as center_id, o.created_at as created_at,
             app.storage_retention_days(o.bucket_id, app.storage_center(o.name)) as retention_days
        from storage.objects o
       where o.bucket_id in ('imports','exports','recordings','homework')
         and o.created_at < now() - make_interval(days => app.storage_retention_days(o.bucket_id, app.storage_center(o.name)))
      union all
      select o.bucket_id::text, o.name::text, app.storage_center(o.name), o.created_at, 7
        from storage.objects o
       where o.bucket_id = 'content'
         and app.storage_segment(o.name, 2) = 'events'
         and (app.storage_segment(o.name, 4) like 'flyer-%' or app.storage_segment(o.name, 4) like 'art-%'
              or app.storage_segment(o.name, 4) like 'partner-%')
         and o.created_at < now() - interval '7 days'
         and not exists (select 1 from app.events e
                          where e.flyer_path in (o.name, 'content/' || o.name)
                             or e.flyer_design #>> '{background,path}' = o.name
                             or e.flyer_design #>> '{poster,partner,logo_path}' = o.name)
    ) x
   order by x.created_at
   limit least(greatest(coalesce(p_limit, 500), 1), 1000);
end $$;

create or replace function app.record_storage_deletions(p_job bigint, p_objects jsonb)
returns int language plpgsql security definer set search_path = app, public, extensions as $$
declare o jsonb; n int := 0; v_center uuid; v_days int;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  for o in select * from jsonb_array_elements(coalesce(p_objects, '[]'::jsonb)) loop
    v_center := app.storage_center(o->>'name');
    v_days := app.storage_retention_days(o->>'bucket', v_center);
    perform app.log_audit(v_center, 'storage.retention_delete', 'storage.objects', (o->>'bucket') || '/' || (o->>'name'),
                          jsonb_build_object('bucket', o->>'bucket', 'name', o->>'name', 'created_at', o->>'created_at'),
                          null,
                          case when o->>'bucket' = 'content'
                               then 'Event flyer tidy-up: a replaced or unused flyer file (job ' || p_job || ')'
                               else 'Retention: ' || (o->>'bucket') || ' files are kept ' || coalesce(v_days::text, '?') || ' days (job ' || p_job || ')'
                          end);
    if o->>'bucket' = 'recordings' then
      update app.gyan_progress set recording_path = null
       where recording_path in (o->>'name', 'recordings/' || (o->>'name'));
    end if;
    if o->>'bucket' = 'homework' then
      perform set_config('app.audit_reason', 'Retention: homework files are kept ' || coalesce(v_days::text, '?') || ' days (job ' || p_job || ')', true);
      update app.gyan_submission_files set storage_path = null, deleted_at = now()
       where storage_path in (o->>'name', 'homework/' || (o->>'name')) and deleted_at is null;
      -- That reason is for this update only: the next object of the batch may belong to another bucket.
      perform set_config('app.audit_reason', '', true);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function app.storage_retention_days(text, uuid), app.storage_expired_objects(int),
  app.record_storage_deletions(bigint, jsonb) from public, anon, authenticated, service_role;
grant execute on function app.storage_retention_days(text, uuid) to authenticated;
grant execute on function app.storage_expired_objects(int), app.record_storage_deletions(bigint, jsonb) to connect_worker;

-- 0302's storage overview (Setup › Storage, Settings › Storage) now lists the homework bucket, retention editable.
create or replace function app.center_storage_overview(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v jsonb := '[]'; v_used jsonb := '{}'; v_limit jsonb;
begin
  if not app.setup_can_manage(p_center) then
    raise exception 'You don''t have access to this community''s storage settings (it needs settings.manage).' using errcode = 'insufficient_privilege';
  end if;
  v_limit := app.entitlement(p_center, 'storage.bytes');
  if to_regclass('storage.buckets') is null then
    return jsonb_build_object('available', false, 'areas', v, 'limit_bytes', v_limit, 'used_bytes', 0);
  end if;
  if to_regclass('storage.objects') is not null then
    execute $q$
      select coalesce(jsonb_object_agg(bucket_id, jsonb_build_object('files', n, 'bytes', b)), '{}'::jsonb)
        from (select o.bucket_id, count(*) n, coalesce(sum(coalesce((o.metadata->>'size')::bigint, 0)), 0) b
                from storage.objects o where split_part(o.name, '/', 1) = $1::text group by o.bucket_id) x
    $q$ into v_used using p_center;
  end if;
  execute $q$
    select coalesce(jsonb_agg(jsonb_build_object(
             'bucket', b.id, 'public', b.public, 'max_file_bytes', b.file_size_limit, 'types', to_jsonb(b.allowed_mime_types),
             'files', coalesce(($1->b.id->>'files')::int, 0), 'bytes', coalesce(($1->b.id->>'bytes')::bigint, 0),
             'retention_days', app.storage_retention_days(b.id, $2),
             'retention_editable', b.id in ('imports','recordings','homework'),
             'module', app.storage_bucket_module(b.id),
             'module_on', app.storage_bucket_module(b.id) is null or app.module_enabled($2, app.storage_bucket_module(b.id)))
             order by array_position(array['branding','content','photos','store','statements','recordings','homework','imports','org-documents','exports'], b.id::text), b.id), '[]'::jsonb)
      from storage.buckets b
     where b.id in ('branding','content','photos','store','statements','recordings','homework','imports','org-documents','exports')
  $q$ into v using v_used, p_center;
  return jsonb_build_object('available', true, 'areas', v, 'limit_bytes', v_limit,
    'used_bytes', coalesce((select sum((e.value->>'bytes')::bigint) from jsonb_each(v_used) e), 0));
end $$;

-- ── Templates (platform defaults; a community may override them) ─────────────
-- Variables: title, level, learner (first name), note, due ("Due October 12, 2026" or "No due date"), deep_link
-- (the member app screen: /gyan/homework/<assignment>?person=<person>), type (homework to the learner,
-- homework_parent to a household adult, homework_review to a reviewer, who gets no deep_link).
insert into app.message_templates (center_id, key, channel, language, subject, body)
select null, v.key, v.channel::app.channel, 'en', v.subject, v.body
  from (values
  ('homework.assigned', 'push', 'New homework: {{title}}',
   '{{learner}} has new homework in {{level}}: "{{title}}". {{due}}.'),
  ('homework.assigned', 'email', 'New homework for {{learner}}: {{title}}',
   E'{{learner}} has new homework in {{level}} at {{center_short_name}}: "{{title}}". {{due}}.\n\nOpen the Community Connect app, go to the lesson and tap the homework to see what to do and hand it in.'),
  ('homework.parent_check', 'push', 'Please check {{learner}}''s homework',
   '{{learner}} handed in "{{title}}" ({{level}}). Please look at it, then send it to the teacher or send it back with a note.'),
  ('homework.parent_check', 'email', 'Please check {{learner}}''s homework: {{title}}',
   E'{{learner}} handed in "{{title}}" ({{level}}) at {{center_short_name}} and it is waiting for your OK.\n\nOpen the Community Connect app, go to Family › {{learner}} › Homework, look at the answer, then send it to the teacher or send it back with a note.'),
  ('homework.sent_back_parent', 'push', 'Your homework was sent back',
   'Your parent sent "{{title}}" ({{level}}) back to you. {{note}}'),
  ('homework.sent_back_parent', 'email', 'Your homework "{{title}}" was sent back',
   E'Your parent sent "{{title}}" ({{level}}) back to you. {{note}}\n\nOpen the lesson in the Community Connect app, change your answer and hand it in again.'),
  ('homework.submitted', 'push', 'Homework to review',
   '{{learner}} handed in "{{title}}" ({{level}}). Open Pathshala › Homework in the portal to review it.'),
  ('homework.submitted', 'email', 'Homework to review: {{title}} from {{learner}}',
   E'{{learner}} handed in "{{title}}" ({{level}}) at {{center_short_name}}.\n\nOpen Pathshala › Homework in the Community Connect portal to review it.'),
  ('homework.accepted', 'push', 'Homework accepted',
   '"{{title}}" ({{level}}) by {{learner}} was accepted by the teacher. {{note}}'),
  ('homework.accepted', 'email', 'Homework accepted: {{title}}',
   E'"{{title}}" ({{level}}) by {{learner}} was accepted by the teacher at {{center_short_name}}. {{note}}\n\nThe points are in the Community Connect app.'),
  ('homework.sent_back', 'push', 'Homework sent back',
   'The teacher sent "{{title}}" ({{level}}) back to {{learner}}: {{note}}'),
  ('homework.sent_back', 'email', 'Homework sent back: {{title}}',
   E'The teacher at {{center_short_name}} sent "{{title}}" ({{level}}) back to {{learner}}: {{note}}\n\nOpen the lesson in the Community Connect app, change the answer and hand it in again.')
  ) as v(key, channel, subject, body)
 where not exists (select 1 from app.message_templates t
                    where t.center_id is null and t.key = v.key and t.channel = v.channel::app.channel and t.language = 'en');

-- ── Comments ─────────────────────────────────────────────────────────────────
comment on function app.save_gyan_assignment(uuid, jsonb) is
  'content.manage or pathshala.manage, or a class Teacher for homework that names their class (H2): insert (no "id") or update homework on a Gyan Path level of this community or the shared library. Keys: id, level_id, class_id, title (1-120), instructions_md (<= 4000), allowed_kinds (photo | file | voice | text), max_files (1-10), required_for_level, points (0-1000), due_rule, parent_check (never | children | always), reviewer (teacher | content), sort_order. New homework starts as a draft; app.set_gyan_assignment_status publishes it. Returns the row as JSON.';
comment on function app.set_gyan_assignment_status(uuid, text) is
  'Same callers as save_gyan_assignment: draft → published → archived (published → draft only while nobody has started an answer). Publishing queues homework.assigned (push + email) to the learners it applies to (the class''s students, or the members who completed a step of the level) and to the household adults of each child learner.';
comment on function app.my_gyan_homework(uuid) is
  'Member: {people: [{person_id, name, is_child}], items: [{assignment, person_id, submission | null, needs_parent, can_parent_decide}]} for yourself and, when you are an adult, every current member of your households; published homework that applies to each person only.';
comment on function app.save_gyan_submission_draft(uuid, uuid, text, jsonb) is
  'can_act_for_person: create or update the draft answer (a sent-back answer becomes a draft with attempt + 1); replaces the parts with p_files [{kind, storage_path, mime_type, bytes, duration_seconds}] under <center>/<person>/<submission>/<name>; refused while the answer is waiting for a parent, with the teacher or accepted. Returns the submission as JSON (with files).';
comment on function app.hand_in_gyan_submission(uuid) is
  'can_act_for_person: draft → awaiting_parent (a child''s own hand-in when the homework asks for a parent''s check and there is a household adult to ask) or → submitted (an adult, or a household adult handing in for someone in the family: recorded as parent_user). Needs at least one part. Marks late, never refuses for it. Tells the household adults (homework.parent_check) or the reviewers (homework.submitted).';
comment on function app.parent_decide_gyan_submission(uuid, text, text) is
  'An adult of the learner''s household, not the learner: ok → submitted (the reviewers are told); send_back → draft with the note (the learner is told).';
comment on function app.review_gyan_submission(uuid, text, text) is
  'app.gyan_homework_reviewer: accept → accepted, the homework''s points once per assignment and person (points_ledger reason assignment, ref_id = the submission), and the level bonus when this was the last required homework; send_back (a note is required) → needs_work. The learner and the household adults are told either way.';
comment on function app.gyan_homework_queue(uuid, text) is
  'Reviewers: {items: [{submission, assignment: {id, title, points, class_id, level_name, goal_name}, learner: {person_id, name, is_child, household_id, household_card}}]}; waiting = with the teacher (oldest first), decided = accepted or sent back (newest first); at most 200; only the answers the caller may review.';
comment on function app.gyan_homework_reviewer(uuid, uuid, text) is
  'May the caller review this learner''s homework: pathshala.manage always; reviewer teacher: pathshala.teach, or the Teacher of a class the learner is placed or active in; reviewer content: content.manage.';
comment on function app.person_is_minor(uuid) is 'Under 18 by date of birth; no date of birth counts as an adult (app.i_am_adult''s rule).';
comment on function app.gyan_assignment_applies(uuid, uuid) is 'Published, the person''s own community, and (when it names a class) the person is placed or active in that class.';

-- ── Grants ───────────────────────────────────────────────────────────────────
-- The RPCs: signed-in members (each one checks who may), and service_role for scripts.
revoke execute on function
  app.save_gyan_assignment(uuid, jsonb), app.set_gyan_assignment_status(uuid, text), app.my_gyan_homework(uuid),
  app.save_gyan_submission_draft(uuid, uuid, text, jsonb), app.hand_in_gyan_submission(uuid),
  app.parent_decide_gyan_submission(uuid, text, text), app.review_gyan_submission(uuid, text, text),
  app.gyan_homework_queue(uuid, text)
  from public, anon;
grant execute on function
  app.save_gyan_assignment(uuid, jsonb), app.set_gyan_assignment_status(uuid, text), app.my_gyan_homework(uuid),
  app.save_gyan_submission_draft(uuid, uuid, text, jsonb), app.hand_in_gyan_submission(uuid),
  app.parent_decide_gyan_submission(uuid, text, text), app.review_gyan_submission(uuid, text, text),
  app.gyan_homework_queue(uuid, text)
  to authenticated, service_role;
-- The helpers the row level security policies call (a policy runs as the signed-in member, so these need execute). Each
-- answers only about the caller: may I edit, review or read this?
revoke execute on function
  app.gyan_homework_editor(uuid, uuid), app.gyan_homework_reviewer(uuid, uuid, text),
  app.gyan_assignment_reviewer(uuid), app.gyan_submission_readable(uuid)
  from public, anon;
grant execute on function
  app.gyan_homework_editor(uuid, uuid), app.gyan_homework_reviewer(uuid, uuid, text),
  app.gyan_assignment_reviewer(uuid), app.gyan_submission_readable(uuid)
  to authenticated, service_role;
-- Internal: only the RPCs and the helpers above call these, as their definer. A signed-in member can never call them
-- directly: several are security definer and would return private rows or names for any id they are given
-- (gyan_submission_json: a whole answer with its notes and file paths; gyan_assignment_json: a draft; gyan_learner_name:
-- a person's name; person_is_minor: a child flag).
revoke execute on function
  app.person_is_minor(uuid), app.gyan_assignment_applies(uuid, uuid), app.gyan_submission_writable(uuid, uuid, uuid),
  app.gyan_due_rule_problem(jsonb), app.gyan_center_today(uuid), app.gyan_assignment_due_on(uuid, uuid),
  app.gyan_learner_name(uuid), app.gyan_assignment_json(uuid), app.gyan_submission_json(uuid), app.gyan_homework_mime_ok(text, text),
  app._gyan_homework_adults(uuid, uuid), app._gyan_homework_send(uuid, text, text, text, jsonb, jsonb),
  app._gyan_homework_notify_person(uuid, text, uuid, jsonb, jsonb, boolean), app._gyan_homework_reviewer_users(uuid, uuid, uuid, text),
  app._gyan_homework_vars(uuid, uuid, text, text, uuid), app._gyan_homework_route(jsonb),
  app._gyan_homework_notify_family(uuid, text, uuid, uuid, text, uuid, boolean, boolean), app._gyan_homework_notify_reviewers(uuid, uuid, uuid, uuid),
  app._gyan_homework_waits_for_parent(uuid, uuid, uuid), app._gyan_homework_household_card(uuid), app.gyan_assignments_guard(),
  app.gyan_award_level_bonus(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function
  app.person_is_minor(uuid), app.gyan_assignment_applies(uuid, uuid), app.gyan_submission_writable(uuid, uuid, uuid),
  app.gyan_due_rule_problem(jsonb), app.gyan_center_today(uuid), app.gyan_assignment_due_on(uuid, uuid),
  app.gyan_learner_name(uuid), app.gyan_assignment_json(uuid), app.gyan_submission_json(uuid), app.gyan_homework_mime_ok(text, text),
  app._gyan_homework_adults(uuid, uuid), app._gyan_homework_send(uuid, text, text, text, jsonb, jsonb),
  app._gyan_homework_notify_person(uuid, text, uuid, jsonb, jsonb, boolean), app._gyan_homework_reviewer_users(uuid, uuid, uuid, text),
  app._gyan_homework_vars(uuid, uuid, text, text, uuid), app._gyan_homework_route(jsonb),
  app._gyan_homework_notify_family(uuid, text, uuid, uuid, text, uuid, boolean, boolean), app._gyan_homework_notify_reviewers(uuid, uuid, uuid, uuid),
  app._gyan_homework_waits_for_parent(uuid, uuid, uuid), app._gyan_homework_household_card(uuid)
  to service_role;
