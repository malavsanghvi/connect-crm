-- 0587: learning assignments (homework) with parent validation.
-- Who may create homework (content.manage / pathshala.manage everywhere; a class Teacher only for their own class)
-- and every field's plain-English refusal; draft → published → archived (back to draft only before the first
-- answer); publishing queues ONE job and the worker tells the learners and the parents of children, in batches,
-- once; the learner's view; drafts and their parts (allowed kinds, the file limit, the path rule, the bucket's own
-- write rule); handing in: a child from their own login waits for a parent, an adult does not, a parent handing in for
-- a child does not; a parent of another household cannot decide; the parent's send-back and OK; who reviews (the class
-- Teacher of a placed class yes, the Teacher of another class and of a past class no, and they READ NOTHING, table and
-- bucket; pathshala.teach, pathshala.manage and the content reviewer rule); points paid once and never again on
-- resubmit or re-accept; a required homework holds the level bonus until it is accepted, and accepting the last one
-- pays it; due dates (late, never refused); the module switch; retention nulls the file row's path; templates; audit;
-- coverage. The security review's findings, each with its own denial: no note in any message or in the audit log; the
-- reviewer and parent check frozen once answers exist; a child cannot change their own birth date (a separate access
-- change); nobody reviews their own household's homework; the class teacher's term must be open; households with no
-- adult who can sign in go straight to the teacher (the household is emailed); reviewers read only the listed parts;
-- levels with homework cannot be deleted; the bonus a required homework held is paid when it stops holding; wrong JSON
-- types get sentences; a class Teacher's points are capped; archived homework stays listed, read-only; due dates never
-- start in the past; the office can release an answer no parent checks.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.assert_raises(stmt text, expect text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if position(lower(expect) in lower(sqlerrm)) = 0 then raise exception 'FAIL: % (got "%")', label, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.sign_in(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
-- Points one person holds for one reason and reference, and how many ledger rows.
create or replace function pg_temp.pts(p_person uuid, p_reason text, p_ref uuid) returns bigint language sql stable as $$
  select coalesce(sum(points), 0) from app.points_ledger where person_id = p_person and reason = p_reason and ref_id = p_ref $$;
create or replace function pg_temp.rows(p_person uuid, p_reason text, p_ref uuid) returns bigint language sql stable as $$
  select count(*) from app.points_ledger where person_id = p_person and reason = p_reason and ref_id = p_ref $$;
-- Messages queued for one homework event: the template, and the submission or assignment it is about.
create or replace function pg_temp.msgs(p_template text, p_key text, p_id text) returns setof app.messages language sql stable as $$
  select * from app.messages where template_key = p_template and payload->>p_key = p_id $$;
-- What the signed-in role reads of one answer: its row, its part rows, its uploaded files ("1/2/2").
create or replace function pg_temp.reads(p_sub uuid) returns text language sql stable as $$
  select (select count(*) from app.gyan_submissions where id = p_sub) || '/' || (select count(*) from app.gyan_submission_files where submission_id = p_sub)
      || '/' || (select count(*) from storage.objects where bucket_id = 'homework' and name like '%/' || p_sub::text || '/%') $$;
-- The SQLSTATE a statement fails with ('OK' when it does not): a refusal must be ours (22023 and the like), never a raw error.
create or replace function pg_temp.state_of(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'OK';
exception when others then return sqlstate;
end $$;
-- The tests switch to connect_worker; a hosted postgres holds ADMIN on it but not SET.
grant connect_worker to postgres;

-- ── Fixtures ───────────────────────────────────────────────────────────────
\set c1 '''72000000-0000-4000-8000-0000000000c1'''
\set c2 '''72000000-0000-4000-8000-0000000000c2'''
\set mom '''72000000-0000-4000-8000-000000000001'''
\set dad '''72000000-0000-4000-8000-000000000002'''
\set kid '''72000000-0000-4000-8000-000000000003'''
\set neighbor '''72000000-0000-4000-8000-000000000004'''
\set classteacher '''72000000-0000-4000-8000-000000000005'''
\set otherteacher '''72000000-0000-4000-8000-000000000006'''
\set pastteacher '''72000000-0000-4000-8000-000000000007'''
\set centerteacher '''72000000-0000-4000-8000-000000000008'''
\set principal '''72000000-0000-4000-8000-000000000009'''
\set contentmgr '''72000000-0000-4000-8000-00000000000a'''
\set other '''72000000-0000-4000-8000-00000000000b'''
\set member '''72000000-0000-4000-8000-00000000000c'''
\set p_mom '''72000000-0000-4000-8000-0000000000a1'''
\set p_dad '''72000000-0000-4000-8000-0000000000a2'''
\set p_kid '''72000000-0000-4000-8000-0000000000a3'''
\set p_nb '''72000000-0000-4000-8000-0000000000a4'''
\set p_other '''72000000-0000-4000-8000-0000000000a5'''
\set p_member '''72000000-0000-4000-8000-0000000000a6'''
\set p_kid2 '''72000000-0000-4000-8000-0000000000a7'''
\set h1 '''72000000-0000-4000-8000-0000000000b1'''
\set h2 '''72000000-0000-4000-8000-0000000000b2'''
\set h3 '''72000000-0000-4000-8000-0000000000b3'''
\set h4 '''72000000-0000-4000-8000-0000000000b4'''
\set term1 '''72000000-0000-4000-8000-000000000a01'''
\set term0 '''72000000-0000-4000-8000-000000000a02'''
\set track '''72000000-0000-4000-8000-000000000a03'''
\set plevel '''72000000-0000-4000-8000-000000000a04'''
\set classA '''72000000-0000-4000-8000-000000000a05'''
\set classB '''72000000-0000-4000-8000-000000000a06'''
\set classC '''72000000-0000-4000-8000-000000000a07'''
\set enrA '''72000000-0000-4000-8000-000000000a08'''
\set enrC '''72000000-0000-4000-8000-000000000a09'''
\set g1 '''72000000-0000-4000-8000-000000000e01'''
\set gs '''72000000-0000-4000-8000-000000000e02'''
\set g2 '''72000000-0000-4000-8000-000000000e03'''
\set l1 '''72000000-0000-4000-8000-000000000f01'''
\set ls '''72000000-0000-4000-8000-000000000f02'''
\set l2 '''72000000-0000-4000-8000-000000000f03'''
\set lreq '''72000000-0000-4000-8000-000000000f04'''
\set ldue '''72000000-0000-4000-8000-000000000f05'''
\set s1 '''72000000-0000-4000-8000-000000000d01'''
\set s1b '''72000000-0000-4000-8000-000000000d02'''
\set ss '''72000000-0000-4000-8000-000000000d03'''
\set s2 '''72000000-0000-4000-8000-000000000d04'''
\set sreq '''72000000-0000-4000-8000-000000000d05'''
\set sdue '''72000000-0000-4000-8000-000000000d06'''

insert into auth.users (id, email) values
  (:mom, 'mom72@example.com'), (:dad, 'dad72@example.com'), (:kid, 'kid72@example.com'), (:neighbor, 'nb72@example.com'),
  (:classteacher, 'classteacher72@example.com'), (:otherteacher, 'otherteacher72@example.com'), (:pastteacher, 'pastteacher72@example.com'),
  (:centerteacher, 'centerteacher72@example.com'), (:principal, 'principal72@example.com'), (:contentmgr, 'content72@example.com'),
  (:other, 'other72@example.com'), (:member, 'member72@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:c1, 'hw72', 'Homework 72 Community', 'H72', 'TX', 'active', 'America/Chicago'),
  (:c2, 'hw72b', 'Other 72 Community', 'H72B', 'TX', 'active', 'America/Chicago');
insert into app.households (id, center_id, display_name) values
  (:h1, :c1, 'Shah household 72'), (:h2, :c1, 'Mehta household 72'), (:h3, :c1, 'Solo household 72'), (:h4, :c2, 'Doshi household 72');
insert into app.people (id, center_id, first_name, last_name, date_of_birth, email) values
  (:p_mom, :c1, 'Mira', 'Shah', date '1982-01-01', 'mom72@example.com'),
  (:p_dad, :c1, 'Raj', 'Shah', date '1980-01-01', null),
  (:p_kid, :c1, 'Anya', 'Shah', (current_date - interval '10 years')::date, null),
  (:p_kid2, :c1, 'Veer', 'Shah', (current_date - interval '7 years')::date, null),
  (:p_nb, :c1, 'Nita', 'Mehta', date '1981-05-05', null),
  (:p_member, :c1, 'Solo', 'Jain', null, null),
  (:p_other, :c2, 'Kiran', 'Doshi', date '1979-03-03', null);
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :p_mom, :c1, 'primary', true), (:h1, :p_dad, :c1, 'spouse', false), (:h1, :p_kid, :c1, 'child', false), (:h1, :p_kid2, :c1, 'child', false),
  (:h2, :p_nb, :c1, 'primary', true), (:h3, :p_member, :c1, 'primary', true), (:h4, :p_other, :c2, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values
  (:c1, :mom, :p_mom), (:c1, :dad, :p_dad), (:c1, :kid, :p_kid), (:c1, :neighbor, :p_nb), (:c1, :member, :p_member), (:c2, :other, :p_other);
-- Pathshala: a current term with classes A and B, a past term with class C; the kid is active in A and was withdrawn from C.
insert into app.pathshala_terms (id, center_id, name, starts_on, ends_on, status) values
  (:term1, :c1, 'Term 72', current_date - 30, current_date + 200, 'active'),
  (:term0, :c1, 'Term 71', current_date - 400, current_date - 200, 'closed');
insert into app.pathshala_tracks (id, center_id, key, name) values (:track, :c1, 'jainism72', 'Jainism 72');
insert into app.pathshala_levels (id, center_id, track_id, key, name) values (:plevel, :c1, :track, '1', 'Jainism 1 (72)');
insert into app.pathshala_classes (id, center_id, term_id, level_id, name) values
  (:classA, :c1, :term1, :plevel, 'Class A'), (:classB, :c1, :term1, :plevel, 'Class B'), (:classC, :c1, :term0, :plevel, 'Class C (last year)');
insert into app.pathshala_enrollments (id, center_id, term_id, student_person_id, household_id, class_id, status) values
  (:enrA, :c1, :term1, :p_kid, :h1, :classA, 'active'), (:enrC, :c1, :term0, :p_kid, :h1, :classC, 'withdrawn');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id) values
  (:c1, :classteacher, 'teacher', 'class', :classA), (:c1, :otherteacher, 'teacher', 'class', :classB), (:c1, :pastteacher, 'teacher', 'class', :classC),
  (:c1, :centerteacher, 'teacher', 'center', null), (:c1, :principal, 'pathshala_principal', 'pathshala', null),
  (:c1, :contentmgr, 'religious_coordinator', 'center', null);
-- Lessons: L1 (two steps, 20 points + 30 treasure, no sign-off), LS a shared library level, L2 another community's,
-- LREQ (one step, 20 + 10) for the required homework, LDUE for the due rules.
insert into app.gyan_goals (id, center_id, key, name) values (:g1, :c1, 'g72', 'Learn 72'), (:gs, null, 'shared72', 'Shared 72'), (:g2, :c2, 'other72', 'Other 72');
insert into app.gyan_levels (id, goal_id, key, name, sort_order, points, treasure, treasure_points, requires_teacher_signoff) values
  (:l1, :g1, '1', 'Foundations', 1, 20, 'Foundations badge', 30, false),
  (:ls, :gs, '1', 'Shared level', 1, 0, null, 0, false),
  (:l2, :g2, '1', 'Other level', 1, 0, null, 0, false),
  (:lreq, :g1, '2', 'Required level', 2, 20, 'Required badge', 10, false),
  (:ldue, :g1, '3', 'Due level', 3, 0, null, 0, false);
insert into app.gyan_steps (id, level_id, kind, title, sort_order, points) values
  (:s1, :l1, 'read', 'What is Samayik', 1, 5), (:s1b, :l1, 'read', 'Why Samayik', 2, 5), (:ss, :ls, 'read', 'Shared card', 1, 0),
  (:s2, :l2, 'read', 'Elsewhere', 1, 0), (:sreq, :lreq, 'read', 'The one step', 1, 0), (:sdue, :ldue, 'read', 'Due step', 1, 0);

-- ── The schema, the module, the grants ─────────────────────────────────────
select pg_temp.assert((select array_agg(module_key) from app.module_tables where table_name in ('gyan_assignments', 'gyan_submissions', 'gyan_submission_files')) = '{gyan_path,gyan_path,gyan_path}',
  'the three homework tables belong to the Gyan Path module');
select pg_temp.assert((select count(*) from pg_policy where polname = 'module_switch' and not polpermissive
                         and polrelid in ('app.gyan_assignments'::regclass, 'app.gyan_submissions'::regclass, 'app.gyan_submission_files'::regclass)) = 3
                      and (select count(*) from pg_trigger where tgname in ('audit_gyan_assignments', 'audit_gyan_submissions', 'audit_gyan_submission_files')) = 3,
  'each has a restrictive module_switch policy and an audit trigger');
select pg_temp.assert(not has_table_privilege('authenticated', 'app.gyan_assignments', 'insert') and not has_table_privilege('authenticated', 'app.gyan_assignments', 'update')
                      and not has_table_privilege('authenticated', 'app.gyan_assignments', 'delete')
                      and not has_table_privilege('authenticated', 'app.gyan_submissions', 'insert') and not has_table_privilege('authenticated', 'app.gyan_submissions', 'update')
                      and not has_table_privilege('authenticated', 'app.gyan_submissions', 'delete')
                      and not has_table_privilege('authenticated', 'app.gyan_submission_files', 'insert') and not has_table_privilege('authenticated', 'app.gyan_submission_files', 'update')
                      and not has_table_privilege('authenticated', 'app.gyan_submission_files', 'delete')
                      and has_table_privilege('authenticated', 'app.gyan_submissions', 'select')
                      and not has_table_privilege('anon', 'app.gyan_assignments', 'select'),
  'the homework tables are read-only over the API (the RPCs write them); anon reads nothing');
select pg_temp.assert(has_function_privilege('authenticated', 'app.save_gyan_assignment(uuid, jsonb)', 'execute')
                      and has_function_privilege('authenticated', 'app.hand_in_gyan_submission(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.gyan_homework_queue(uuid, text)', 'execute')
                      and not has_function_privilege('anon', 'app.save_gyan_assignment(uuid, jsonb)', 'execute')
                      and not has_function_privilege('anon', 'app.my_gyan_homework(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app._gyan_homework_send(uuid, text, text, text, jsonb, jsonb)', 'execute')
                      and not has_function_privilege('authenticated', 'app.gyan_award_level_bonus(uuid, uuid, uuid)', 'execute')
                      and has_function_privilege('service_role', 'app.review_gyan_submission(uuid, text, text)', 'execute'),
  'signed-in members may call the RPCs, anon may not, the notice helpers and the level award are internal');
select pg_temp.assert(has_function_privilege('authenticated', 'app.gyan_homework_editor(uuid, uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.gyan_homework_reviewer(uuid, uuid, text)', 'execute')
                      and has_function_privilege('authenticated', 'app.gyan_assignment_reviewer(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.gyan_submission_readable(uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.gyan_homework_reviewer(uuid, uuid, text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.gyan_submission_json(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.gyan_assignment_json(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.gyan_learner_name(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.person_is_minor(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.gyan_assignment_applies(uuid, uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.gyan_submission_writable(uuid, uuid, uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.gyan_assignment_due_on(uuid, uuid)', 'execute'),
  'only the four helpers the row level security policies call are open to members; the helpers that return an answer, a name or a minor flag for any id are internal');
select pg_temp.assert((select count(*) from app.message_templates where center_id is null and language = 'en'
                         and key in ('homework.assigned', 'homework.parent_check', 'homework.sent_back_parent', 'homework.submitted', 'homework.accepted', 'homework.sent_back', 'homework.heads_up')) = 14,
  'the seven homework templates are seeded as push and email platform defaults');
select pg_temp.assert(not exists (select 1 from app.message_templates where center_id is null and key like 'homework.%' and (body like '%{{note}}%' or subject like '%{{note}}%'))
                      and (select bool_and(body like '%Open the%app%') from app.message_templates where center_id is null and key in ('homework.sent_back', 'homework.sent_back_parent')),
  'no homework template carries a note: the notes stay in the app ("Open the app to read the note")');
select pg_temp.assert(has_function_privilege('authenticated', 'app.gyan_can_act_for(uuid, uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.gyan_can_act_for(uuid, uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.gyan_i_am_adult(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.gyan_in_household(uuid, uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.gyan_enrolled_in_class(uuid, uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.gyan_homework_reviewer_role(uuid, uuid, text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.gyan_homework_path_ok(text)', 'execute')
                      and not has_function_privilege('authenticated', 'app._gyan_homework_adults(uuid, uuid, boolean)', 'execute')
                      and not has_function_privilege('authenticated', 'app._gyan_homework_parent_check(uuid, uuid, uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app._gyan_homework_release_level_bonus(uuid, uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app._gyan_homework_publish_recipients(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.people_dob_guard()', 'execute')
                      and not has_function_privilege('authenticated', 'app.gyan_levels_homework_guard()', 'execute'),
  'the new helpers answer only through the policies and functions that call them: members cannot call them directly');
select pg_temp.assert(has_function_privilege('connect_worker', 'app.worker_homework_publish_notify(uuid, int, int)', 'execute')
                      and not has_function_privilege('authenticated', 'app.worker_homework_publish_notify(uuid, int, int)', 'execute')
                      and not has_function_privilege('anon', 'app.worker_homework_publish_notify(uuid, int, int)', 'execute')
                      and not has_function_privilege('service_role', 'app.worker_homework_publish_notify(uuid, int, int)', 'execute'),
  'the publish notice''s fan-out is the worker role''s alone');
-- Function hygiene for everything 0587 defines or redefines (the 54 functions minus the three pure helpers): a security
-- definer function pins its search path, none is open to PUBLIC, and anon can call only the two bucket rules.
create or replace function pg_temp.hw_fns() returns setof pg_proc language sql stable as $$
  select p.* from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = any (array[
    '_gyan_homework_adults', '_gyan_homework_household_card', '_gyan_homework_notify_family', '_gyan_homework_notify_person',
    '_gyan_homework_notify_reviewers', '_gyan_homework_parent_check', '_gyan_homework_publish_recipients',
    '_gyan_homework_release_level_bonus', '_gyan_homework_reviewer_users', '_gyan_homework_route', '_gyan_homework_send',
    '_gyan_homework_vars', 'can_read_object', 'can_write_object', 'center_storage_overview', 'gyan_assignment_applies',
    'gyan_assignment_due_on', 'gyan_assignment_json', 'gyan_assignment_reviewer', 'gyan_assignments_guard', 'gyan_award_level_bonus',
    'gyan_can_act_for', 'gyan_center_today', 'gyan_due_rule_problem', 'gyan_enrolled_in_class', 'gyan_homework_editor',
    'gyan_homework_mime_ok', 'gyan_homework_path_ok', 'gyan_homework_queue', 'gyan_homework_reviewer', 'gyan_homework_reviewer_role',
    'gyan_i_am_adult', 'gyan_in_household', 'gyan_learner_name', 'gyan_levels_homework_guard', 'gyan_submission_json',
    'gyan_submission_readable', 'gyan_submission_writable', 'hand_in_gyan_submission', 'my_gyan_homework',
    'parent_decide_gyan_submission', 'people_dob_guard', 'person_is_minor', 'record_storage_deletions', 'review_gyan_submission',
    'save_gyan_assignment', 'save_gyan_submission_draft', 'set_gyan_assignment_status', 'storage_expired_objects',
    'storage_retention_days', 'worker_homework_publish_notify']) $$;
select pg_temp.assert((select count(*) from pg_temp.hw_fns()) = 51
                      and (select count(*) from pg_temp.hw_fns() p where p.prosecdef and (p.proconfig is null or not (p.proconfig::text like '%search_path=app, public, extensions%'))) = 0
                      and (select count(*) from pg_temp.hw_fns() p where p.prosecdef
                              and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))) = 0
                      and (select array_agg(p.proname::text order by p.proname) from pg_temp.hw_fns() p where has_function_privilege('anon', p.oid, 'execute'))
                          = array['can_read_object', 'can_write_object'],
  'every security definer function 0587 defines pins its search path and none is open to PUBLIC; anon can call only the two bucket rules');
select pg_temp.assert_raises($$select app.worker_homework_publish_notify('72000000-0000-4000-8000-0000000000ff', 0, 50)$$,
  'only the background service', 'and it asserts the worker role itself, even for the database owner');
select pg_temp.assert((select not public and file_size_limit = 26214400 and 'image/heic' = any (allowed_mime_types) and 'application/pdf' = any (allowed_mime_types)
                          and 'audio/mp4' = any (allowed_mime_types) and 'text/plain' = any (allowed_mime_types)
                          and 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' = any (allowed_mime_types)
                          and not ('video/mp4' = any (allowed_mime_types))
                         from storage.buckets where id = 'homework')
                      and app.storage_bucket_module('homework') = 'gyan_path' and 'homework' = any (app.storage_scan_buckets())
                      and app.storage_retention_days('homework', :c1) = 365,
  'the private homework bucket exists (25 MB, pictures, PDF, audio, office files, text; no video), follows Gyan Path, is scanned and kept 365 days');
select pg_temp.assert(app.person_is_minor(:p_kid) and not app.person_is_minor(:p_mom) and not app.person_is_minor(:p_member) and not app.person_is_minor('72000000-0000-4000-8000-0000000000ff'),
  'person_is_minor: under 18 by date of birth; no date of birth (and no person) is an adult (F7)');
select pg_temp.assert(app.gyan_due_rule_problem('{"kind":"none"}') is null and app.gyan_due_rule_problem('{"kind":"days_after_start","days":7}') is null
                      and app.gyan_due_rule_problem('{"kind":"on","date":"2026-11-01"}') is null
                      and app.gyan_due_rule_problem('{"kind":"days_after_start","days":0}') like '%1 to 365%'
                      and app.gyan_due_rule_problem('{"kind":"on","date":"2026-13-01"}') like '%real date%'
                      and app.gyan_due_rule_problem('{"kind":"soon"}') like '%"none", "days_after_start"%'
                      and app.gyan_due_rule_problem('[]') like '%must be an object%',
  'the due rule checker accepts the three shapes and explains the rest');

-- ── Creating homework ──────────────────────────────────────────────────────
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "x"}')$$,
  'sign in', 'a signed-out caller cannot create homework');
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "Members cannot"}')$$,
  'needs content.manage or pathshala.manage', 'a member cannot create homework');
commit;
begin;
select pg_temp.sign_in(:neighbor);
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "Parents cannot"}')$$,
  'needs content.manage or pathshala.manage', 'a parent cannot create homework');
commit;
begin;
select pg_temp.sign_in(:contentmgr);
select app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', '  Navkar recording ', 'instructions_md', 'Record yourself saying the Navkar Mantra.',
                                'allowed_kinds', jsonb_build_array('voice', 'text', 'photo', 'voice'), 'max_files', 2, 'points', 15)) as a1json \gset
commit;
select (:'a1json'::jsonb->>'id') as a1 \gset
select pg_temp.assert((select array_agg(k order by k) from jsonb_object_keys(:'a1json'::jsonb) k)
                        = array['allowed_kinds','center_id','class_id','created_at','due_rule','id','instructions_md','level_id','max_files','parent_check','points','required_for_level','reviewer','sort_order','status','title','updated_at'],
  'save_gyan_assignment returns the row with exactly the contract''s keys');
select pg_temp.assert(:'a1json'::jsonb->>'title' = 'Navkar recording' and :'a1json'::jsonb->'allowed_kinds' = '["photo", "text", "voice"]'::jsonb
                      and (:'a1json'::jsonb->>'max_files')::int = 2 and (:'a1json'::jsonb->>'points')::int = 15
                      and :'a1json'::jsonb->>'parent_check' = 'children' and :'a1json'::jsonb->>'reviewer' = 'teacher' and :'a1json'::jsonb->>'status' = 'draft'
                      and :'a1json'::jsonb->'due_rule' = '{"kind": "none"}'::jsonb and :'a1json'::jsonb->>'class_id' is null
                      and (:'a1json'::jsonb->>'required_for_level')::boolean = false,
  'a content manager creates a draft: the title is trimmed, the kinds de-duplicated and sorted, and the defaults are children / teacher / no due date / draft');
select pg_temp.assert((select created_by = :contentmgr::uuid and center_id = :c1::uuid from app.gyan_assignments where id = :'a1')
                      and (select reason from app.audit_log where record_table = 'gyan_assignments' and record_id = :'a1' and action = 'gyan_assignments.insert') = 'Created homework "Navkar recording" (Foundations)',
  'the row records who made it and the audit entry names the homework and its level');

begin;
select pg_temp.sign_in(:contentmgr);
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', '{"level_id": "72000000-0000-4000-8000-000000000f01"}')$$,
  'give the homework a title', 'a title is required');
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', jsonb_build_object('level_id', '72000000-0000-4000-8000-000000000f01', 'title', repeat('x', 121)))$$,
  'at most 120 characters', 'a title over 120 characters is refused');
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', '{"title": "No level"}')$$,
  'choose the lesson level', 'the level is required');
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', '{"level_id": "72000000-0000-4000-8000-000000000fff", "title": "Gone"}')$$,
  'was not found', 'an unknown level is refused');
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', '{"level_id": "72000000-0000-4000-8000-000000000f03", "title": "Not ours"}')$$,
  'belongs to another community', 'a level of another community''s goal is refused');
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "Bad kind", "allowed_kinds": ["video"]}')$$,
  'not a way to answer homework', 'an unknown way to answer is refused');
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "No kinds", "allowed_kinds": []}')$$,
  'at least one way to answer', 'at least one way to answer is required');
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "Too many", "max_files": 11}')$$,
  'from 1 to 10', 'more than 10 files is refused');
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "Rich", "points": 1001}')$$,
  'from 0 to 1,000', 'points above 1,000 are refused');
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "Bad due", "due_rule": {"kind": "days_after_start", "days": 400}}')$$,
  '1 to 365', 'a bad due rule is refused in plain English');
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "Bad parent", "parent_check": "maybe"}')$$,
  '"never", "children" or "always"', 'an unknown parent check is refused');
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "Bad reviewer", "reviewer": "parent"}')$$,
  '"teacher" or "content"', 'an unknown reviewer is refused');
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "Bad class", "class_id": "72000000-0000-4000-8000-000000000aff"}')$$,
  'not one of this community''s classes', 'a class that is not this community''s is refused');
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "Published at once", "status": "published"}')$$,
  'starts as a draft', 'new homework cannot be born published');
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "Navkar recording"}')$$,
  'already homework called "Navkar recording"', 'a second homework with the same title on the level is refused');
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', '{"id": "72000000-0000-4000-8000-0000000000ff", "title": "Gone"}')$$,
  'was not found', 'changing homework that does not exist is refused');
-- A shared library level takes a community's homework; the content reviewer rule.
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :ls, 'title', 'Shared level essay', 'allowed_kinds', jsonb_build_array('text'),
                                 'parent_check', 'never', 'reviewer', 'content', 'points', 5))->>'id') as a_content \gset
-- An update keeps what is not sent.
select app.save_gyan_assignment(:c1, jsonb_build_object('id', :'a1', 'instructions_md', 'Record the full mantra, slowly.')) as a1v2 \gset
commit;
select pg_temp.assert(:'a1v2'::jsonb->>'instructions_md' = 'Record the full mantra, slowly.' and (:'a1v2'::jsonb->>'points')::int = 15 and :'a1v2'::jsonb->>'title' = 'Navkar recording',
  'an update changes what is sent and keeps the rest');
select pg_temp.assert((select center_id = :c1::uuid and reviewer = 'content' and parent_check = 'never' from app.gyan_assignments where id = :'a_content'),
  'a community attaches its own homework to a shared library level');

-- A class Teacher: only for their own class (H2).
begin;
select pg_temp.sign_in(:classteacher);
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "For everyone"}')$$,
  'own class only', 'a class teacher cannot set homework for everyone');
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "For class B", "class_id": "72000000-0000-4000-8000-000000000a06"}')$$,
  'Teacher role for the class', 'nor for another teacher''s class');
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', jsonb_build_object('id', '$$ || :'a1' || $$', 'title', 'Renamed by a teacher'))$$,
  'Changing this homework needs', 'nor change homework for everyone');
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'Class A homework', 'class_id', :classA, 'allowed_kinds', jsonb_build_array('text')))->>'id') as a_teacher \gset
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', jsonb_build_object('id', '$$ || :'a_teacher' || $$', 'class_id', null))$$,
  'own class only', 'a class teacher cannot open their class''s homework to everyone');
select app.save_gyan_assignment(:c1, jsonb_build_object('id', :'a_teacher', 'points', 7)) as a_teacher_v2 \gset
commit;
select pg_temp.assert((select class_id = :classA::uuid and points = 7 from app.gyan_assignments where id = :'a_teacher') and :'a_teacher_v2'::jsonb->>'class_id' = :classA,
  'a class teacher creates and changes homework for their own class');

-- The principal (pathshala.manage) sets the rest: homework only for class B (required), the required homework on
-- LREQ, an "always" one, one that takes no written answer, and the two due rules.
begin;
select pg_temp.sign_in(:principal);
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'Class B only', 'class_id', :classB, 'required_for_level', true, 'allowed_kinds', jsonb_build_array('text')))->>'id') as a_class \gset
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :lreq, 'title', 'Required homework', 'required_for_level', true, 'parent_check', 'never',
                                 'allowed_kinds', jsonb_build_array('photo', 'text'), 'points', 10))->>'id') as a_req \gset
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'Always checked', 'parent_check', 'always', 'allowed_kinds', jsonb_build_array('text'), 'points', 0))->>'id') as a_always \gset
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'Photo only', 'allowed_kinds', jsonb_build_array('photo'), 'parent_check', 'never'))->>'id') as a_notext \gset
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :ldue, 'title', 'Due yesterday', 'allowed_kinds', jsonb_build_array('text'), 'parent_check', 'never',
                                 'due_rule', jsonb_build_object('kind', 'on', 'date', (current_date - 1)::text)))->>'id') as a_due \gset
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'A week after you start', 'allowed_kinds', jsonb_build_array('text'),
                                 'due_rule', '{"kind": "days_after_start", "days": 7}'::jsonb))->>'id') as a_days \gset
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'Stays a draft', 'allowed_kinds', jsonb_build_array('text')))->>'id') as a_tmp \gset
commit;

-- ── Publishing, and who is told ────────────────────────────────────────────
-- The kid has completed a step of L1 (the way the member app does it), so L1's homework for everyone reaches her.
begin;
select pg_temp.sign_in(:kid);
insert into app.gyan_progress (center_id, person_id, step_id, stars, completed_at) values (:c1, :p_kid, :s1, 3, now());
commit;
select pg_temp.assert(pg_temp.rows(:p_kid, 'level', :l1) = 0, 'one of two steps done: no level bonus yet');
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises($$select app.set_gyan_assignment_status('$$ || :'a1' || $$', 'published')$$,
  'Changing this homework needs', 'a member cannot publish homework');
commit;
begin;
select pg_temp.sign_in(:contentmgr);
select pg_temp.assert_raises($$select app.set_gyan_assignment_status('$$ || :'a1' || $$', 'archived')$$,
  'draft cannot be archived', 'a draft goes to published first');
select pg_temp.assert_raises($$select app.set_gyan_assignment_status('$$ || :'a1' || $$', 'gone')$$,
  '"draft", "published" or "archived"', 'an unknown status is refused');
select app.set_gyan_assignment_status(:'a1', 'published') as a1pub \gset
commit;
select pg_temp.assert(:'a1pub'::jsonb->>'status' = 'published' and (select published_at is not null from app.gyan_assignments where id = :'a1'),
  'a content manager publishes the homework');
-- Publishing tells nobody inside the request: it queues ONE job, and the worker tells the learners in batches.
select pg_temp.assert((select count(*) from app.jobs where kind = 'homework.publish_notify' and payload = jsonb_build_object('assignment_id', :'a1')
                          and center_id = :c1::uuid and status = 'queued') = 1
                      and (select count(*) from pg_temp.msgs('homework.assigned', 'assignment_id', :'a1')) = 0,
  'publishing queues one homework.publish_notify job and sends nothing itself');
begin;
set local role connect_worker;
select app.worker_homework_publish_notify(:'a1', 0, 50) as fan_a1 \gset
commit;
select pg_temp.assert((:'fan_a1'::jsonb->>'total')::int = 1 and (:'fan_a1'::jsonb->>'learners')::int = 1 and (:'fan_a1'::jsonb->>'messages')::int = 4
                      and (:'fan_a1'::jsonb->>'skipped')::int = 0 and (:'fan_a1'::jsonb->>'done')::boolean,
  'the worker''s batch tells the learner and her parents (4 messages) and says it is done');
select pg_temp.assert((select count(*) = 4 and count(*) filter (where channel = 'push') = 3 and count(*) filter (where channel = 'email') = 1
                          and bool_and(status = 'queued')
                          and array_agg(to_address order by to_address) filter (where channel = 'push') = array[:mom, :dad, :kid]
                          and bool_and(payload->>'type' = case when to_address = :kid then 'homework' else 'homework_parent' end
                                       and payload->'vars'->>'type' = payload->>'type'
                                       and payload->>'deep_link' = '/gyan/homework/' || :'a1' || '?person=' || :p_kid
                                       and payload->'vars'->>'title' = 'Navkar recording' and payload->'vars'->>'level' = 'Foundations'
                                       and payload->'vars'->>'learner' = 'Anya' and payload->'vars'->>'due' = 'No due date')
                         from pg_temp.msgs('homework.assigned', 'assignment_id', :'a1')),
  'publishing tells the learner (push: type homework) and, as she is a child, her parents (push and email: type homework_parent), with the homework''s name, level and the app link');
select pg_temp.assert((select person_id = :p_mom::uuid from pg_temp.msgs('homework.assigned', 'assignment_id', :'a1') where to_address = :mom)
                      and (select body like '%Anya has new homework in Foundations: "Navkar recording". No due date.%' from pg_temp.msgs('homework.assigned', 'assignment_id', :'a1') where to_address = :kid),
  'each message belongs to its recipient and reads in plain English');
begin;
select pg_temp.sign_in(:principal);
select app.set_gyan_assignment_status(:'a_class', 'published');
select app.set_gyan_assignment_status(:'a_req', 'published');
select app.set_gyan_assignment_status(:'a_always', 'published');
select app.set_gyan_assignment_status(:'a_notext', 'published');
select app.set_gyan_assignment_status(:'a_due', 'published');
select app.set_gyan_assignment_status(:'a_days', 'published');
select app.set_gyan_assignment_status(:'a_content', 'published');
commit;
begin;
set local role connect_worker;
select app.worker_homework_publish_notify(:'a_class', 0, 50) as fan_class \gset
select app.worker_homework_publish_notify(:'a_req', 0, 50) as fan_req \gset
commit;
select pg_temp.assert((:'fan_class'::jsonb->>'total')::int = 0 and (select count(*) from pg_temp.msgs('homework.assigned', 'assignment_id', :'a_class')) = 0,
  'homework for class B tells nobody: the class has no students');
select pg_temp.assert((:'fan_req'::jsonb->>'total')::int = 0 and (select count(*) from pg_temp.msgs('homework.assigned', 'assignment_id', :'a_req')) = 0,
  'homework on a level nobody has started tells nobody (the level screen shows it)');
select pg_temp.assert((select count(*) from app.jobs where kind = 'homework.publish_notify') = 8,
  'every publish queued a job (eight homeworks, each published once, so far)');
begin;
select pg_temp.sign_in(:classteacher);
select app.set_gyan_assignment_status(:'a_teacher', 'published');
commit;
begin;
set local role connect_worker;
select app.worker_homework_publish_notify(:'a_teacher', 0, 50) as fan_t \gset
commit;
begin;
select pg_temp.sign_in(:classteacher);
select app.set_gyan_assignment_status(:'a_teacher', 'draft');
select app.set_gyan_assignment_status(:'a_teacher', 'published');
commit;
begin;
set local role connect_worker;
select app.worker_homework_publish_notify(:'a_teacher', 0, 50) as fan_t2 \gset
commit;
begin;
select pg_temp.sign_in(:classteacher);
select app.set_gyan_assignment_status(:'a_teacher', 'archived') as a_teacher_arch \gset
select pg_temp.assert_raises($$select app.set_gyan_assignment_status('$$ || :'a_teacher' || $$', 'published')$$,
  'Archived homework stays archived', 'archived homework cannot come back');
select pg_temp.assert_raises($$select app.set_gyan_assignment_status('$$ || :'a_teacher' || $$', 'draft')$$,
  'Archived homework stays archived', 'nor go back to a draft');
commit;
select pg_temp.assert((select count(*) filter (where channel = 'push') = 3 and count(*) filter (where channel = 'email') = 1 from pg_temp.msgs('homework.assigned', 'assignment_id', :'a_teacher'))
                      and (select count(*) from app.jobs where kind = 'homework.publish_notify' and payload->>'assignment_id' = :'a_teacher') = 2
                      and (:'fan_t'::jsonb->>'messages')::int = 4
                      and (:'fan_t2'::jsonb->>'messages')::int = 0 and (:'fan_t2'::jsonb->>'skipped')::int = 1,
  'homework for class A tells its student (and her parents) once: publishing again after an unpublish queues another job, which finds her already told and sends nothing');
select pg_temp.assert(:'a_teacher_arch'::jsonb->>'status' = 'archived',
  'published → draft (nobody has started it) → published → archived');

-- ── The learner's view ─────────────────────────────────────────────────────
select pg_temp.assert_raises($$select app.my_gyan_homework('72000000-0000-4000-8000-0000000000c1')$$, 'sign in', 'a signed-out caller has no homework');
begin;
select pg_temp.sign_in(:other);
select pg_temp.assert_raises($$select app.my_gyan_homework('72000000-0000-4000-8000-0000000000c1')$$, 'only members of this community', 'a member of another community sees nothing');
commit;
begin;
select pg_temp.sign_in(:kid);
select app.my_gyan_homework(:c1) as hw_kid \gset
commit;
select pg_temp.assert(:'hw_kid'::jsonb->'people' = jsonb_build_array(jsonb_build_object('person_id', :p_kid, 'name', 'Anya Shah', 'is_child', true)),
  'a child sees only herself');
select pg_temp.assert((select array_agg(i->'assignment'->>'id' order by i->'assignment'->>'id') from jsonb_array_elements(:'hw_kid'::jsonb->'items') i)
                        = (select array_agg(x order by x) from unnest(array[:'a1', :'a_req', :'a_always', :'a_notext', :'a_due', :'a_days', :'a_content']) x)
                      and (select bool_and(i->>'person_id' = :p_kid and i->'submission' = 'null'::jsonb and (i->>'can_parent_decide')::boolean = false) from jsonb_array_elements(:'hw_kid'::jsonb->'items') i),
  'she sees every published homework that applies (the shared level''s too), not class B''s nor the archived one, with no answer yet');
select pg_temp.assert((select (i->>'needs_parent')::boolean from jsonb_array_elements(:'hw_kid'::jsonb->'items') i where i->'assignment'->>'id' = :'a1')
                      and (select (i->>'needs_parent')::boolean from jsonb_array_elements(:'hw_kid'::jsonb->'items') i where i->'assignment'->>'id' = :'a_always')
                      and not (select (i->>'needs_parent')::boolean from jsonb_array_elements(:'hw_kid'::jsonb->'items') i where i->'assignment'->>'id' = :'a_req'),
  'handing in from her own login would wait for a parent for "children" and "always" homework, not for "never"');
select pg_temp.assert((select i->'assignment' from jsonb_array_elements(:'hw_kid'::jsonb->'items') i where i->'assignment'->>'id' = :'a1')
                        = jsonb_build_object('id', :'a1', 'level_id', :l1, 'goal_id', :g1, 'title', 'Navkar recording', 'instructions_md', 'Record the full mantra, slowly.',
                                             'allowed_kinds', jsonb_build_array('photo', 'text', 'voice'), 'max_files', 2, 'points', 15, 'required_for_level', false,
                                             'due_on', null, 'parent_check', 'children', 'class_id', null, 'archived', false),
  'the assignment carries exactly the contract''s keys');
select pg_temp.assert((select i->'assignment'->>'due_on' from jsonb_array_elements(:'hw_kid'::jsonb->'items') i where i->'assignment'->>'id' = :'a_due') = (current_date - 1)::text
                      and (select i->'assignment'->>'due_on' from jsonb_array_elements(:'hw_kid'::jsonb->'items') i where i->'assignment'->>'id' = :'a_days') = (app.gyan_center_today(:c1) + 7)::text,
  'a due date is shown as the date, and "days after start" counts from her first completed step of the level');
begin;
select pg_temp.sign_in(:mom);
select app.my_gyan_homework(:c1) as hw_mom \gset
commit;
select pg_temp.assert((select array_agg(p->>'person_id' order by p->>'person_id') from jsonb_array_elements(:'hw_mom'::jsonb->'people') p)
                        = (select array_agg(x order by x) from unnest(array[:p_mom, :p_dad, :p_kid, :p_kid2]) x)
                      and (:'hw_mom'::jsonb->'people'->0->>'person_id') = :p_mom
                      and (select bool_and((p->>'is_child')::boolean = (p->>'person_id' in (:p_kid, :p_kid2))) from jsonb_array_elements(:'hw_mom'::jsonb->'people') p),
  'an adult sees herself first and every current member of her household, children marked');
select pg_temp.assert(not (select (i->>'needs_parent')::boolean from jsonb_array_elements(:'hw_mom'::jsonb->'items') i where i->'assignment'->>'id' = :'a1' and i->>'person_id' = :p_kid)
                      and not (select (i->>'needs_parent')::boolean from jsonb_array_elements(:'hw_mom'::jsonb->'items') i where i->'assignment'->>'id' = :'a1' and i->>'person_id' = :p_mom)
                      and (select (i->>'needs_parent')::boolean from jsonb_array_elements(:'hw_mom'::jsonb->'items') i where i->'assignment'->>'id' = :'a_always' and i->>'person_id' = :p_mom),
  'a parent handing in for her child does not wait; her own "children" homework does not wait; her own "always" homework waits for the other adult');
begin;
select pg_temp.sign_in(:member);
select app.my_gyan_homework(:c1) as hw_member \gset
commit;
select pg_temp.assert(not (select (i->>'needs_parent')::boolean from jsonb_array_elements(:'hw_member'::jsonb->'items') i where i->'assignment'->>'id' = :'a_always'),
  'an adult with no other adult in the household never waits (there is nobody to ask)');
begin;
select pg_temp.sign_in(:neighbor);
select app.my_gyan_homework(:c1) as hw_nb \gset
commit;
select pg_temp.assert(jsonb_array_length(:'hw_nb'::jsonb->'people') = 1 and not exists (select 1 from jsonb_array_elements(:'hw_nb'::jsonb->'items') i where i->>'person_id' = :p_kid),
  'another family sees nothing of the child');

-- ── Drafts and their parts ─────────────────────────────────────────────────
begin;
select pg_temp.sign_in(:neighbor);
select pg_temp.assert_raises($$select app.save_gyan_submission_draft('$$ || :'a1' || $$', '$$ || :p_kid || $$', null, null)$$,
  'yourself or for someone in your family', 'another family cannot start the child''s homework');
commit;
begin;
select pg_temp.sign_in(:kid);
select pg_temp.assert_raises($$select app.save_gyan_submission_draft('$$ || :'a_tmp' || $$', '$$ || :p_kid || $$', 'x', null)$$,
  'not published yet', 'a draft homework cannot be answered');
select pg_temp.assert_raises($$select app.save_gyan_submission_draft('$$ || :'a_class' || $$', '$$ || :p_kid || $$', 'x', null)$$,
  'for another class', 'homework for class B is not hers');
select pg_temp.assert_raises($$select app.save_gyan_submission_draft('$$ || :'a_notext' || $$', '$$ || :p_kid || $$', 'words', null)$$,
  'does not take a written answer', 'a written answer is refused where the homework takes none');
select app.save_gyan_submission_draft(:'a1', :p_kid, null, null) as sub1json \gset
commit;
select (:'sub1json'::jsonb->>'id') as sub1 \gset
select pg_temp.assert((select array_agg(k order by k) from jsonb_object_keys(:'sub1json'::jsonb) k)
                        = array['attempt','decided_at','files','id','late','parent_note','points_awarded','review_note','status','submitted_at','text_answer']
                      and :'sub1json'::jsonb->>'status' = 'draft' and (:'sub1json'::jsonb->>'attempt')::int = 1 and :'sub1json'::jsonb->'files' = '[]'::jsonb,
  'an empty draft is created at once (the app uploads under its id) and comes back with exactly the contract''s keys');
select pg_temp.assert((select count(*) from app.gyan_submissions where assignment_id = :'a1' and person_id = :p_kid) = 1
                      and (select reason from app.audit_log where record_table = 'gyan_submissions' and record_id = :'sub1' and action = 'gyan_submissions.insert')
                          = 'Saved a draft of homework "Navkar recording" for Anya (child)',
  'one answer per learner and homework, audited with the homework and the child''s name');
\set prefix '''72000000-0000-4000-8000-0000000000c1/72000000-0000-4000-8000-0000000000a3/'''
-- The bucket: the child and her parents upload under the draft's own folder; nobody else, nowhere else.
begin;
select pg_temp.sign_in(:kid);
insert into storage.objects (bucket_id, name, metadata) values ('homework', :prefix || :'sub1' || '/e1000000-0000-4000-8000-000000000001.m4a', '{"size": 1234, "mimetype": "audio/mp4"}');
select pg_temp.assert(true, 'homework bucket: the child uploads into her answer''s folder');
select pg_temp.assert_raises($$insert into storage.objects (bucket_id, name) values ('homework', '72000000-0000-4000-8000-0000000000c1/72000000-0000-4000-8000-0000000000a7/$$ || :'sub1' || $$/e1000000-0000-4000-8000-000000000007.jpg')$$,
  'row-level security', 'homework bucket: not into her brother''s folder');
select pg_temp.assert_raises($$insert into storage.objects (bucket_id, name) values ('homework', '72000000-0000-4000-8000-0000000000c1/72000000-0000-4000-8000-0000000000a3/72000000-0000-4000-8000-0000000000ee/e1000000-0000-4000-8000-000000000007.jpg')$$,
  'row-level security', 'homework bucket: not under an answer that does not exist');
select pg_temp.assert_raises($$insert into storage.objects (bucket_id, name) values ('homework', '72000000-0000-4000-8000-0000000000c1/72000000-0000-4000-8000-0000000000a3/$$ || :'sub1' || $$/deep/e1000000-0000-4000-8000-000000000007.jpg')$$,
  'row-level security', 'homework bucket: not deeper than the answer''s folder');
select pg_temp.assert_raises($$insert into storage.objects (bucket_id, name) values ('homework', '72000000-0000-4000-8000-0000000000c2/72000000-0000-4000-8000-0000000000a3/$$ || :'sub1' || $$/e1000000-0000-4000-8000-000000000007.jpg')$$,
  'row-level security', 'homework bucket: not under another community');
commit;
begin;
select pg_temp.sign_in(:mom);
insert into storage.objects (bucket_id, name, metadata) values ('homework', :prefix || :'sub1' || '/e1000000-0000-4000-8000-000000000002.jpg', '{"size": 999, "mimetype": "image/jpeg"}');
select pg_temp.assert(true, 'homework bucket: a parent uploads into the child''s answer');
commit;
begin;
select pg_temp.sign_in(:neighbor);
select pg_temp.assert_raises($$insert into storage.objects (bucket_id, name) values ('homework', '72000000-0000-4000-8000-0000000000c1/72000000-0000-4000-8000-0000000000a3/$$ || :'sub1' || $$/e1000000-0000-4000-8000-00000000000e.jpg')$$,
  'row-level security', 'homework bucket: another family cannot upload into it');
commit;
begin;
select pg_temp.sign_in(:classteacher);
select pg_temp.assert_raises($$insert into storage.objects (bucket_id, name) values ('homework', '72000000-0000-4000-8000-0000000000c1/72000000-0000-4000-8000-0000000000a3/$$ || :'sub1' || $$/e1000000-0000-4000-8000-00000000000d.jpg')$$,
  'row-level security', 'homework bucket: the teacher reads, never writes');
commit;
select pg_temp.assert((select count(*) from app.jobs where kind = 'storage.scan' and payload->>'bucket' = 'homework' and payload->>'name' like '%' || :'sub1' || '%') = 2,
  'every homework upload queues a malware scan');
begin;
select pg_temp.sign_in(:kid);
select pg_temp.assert_raises($$select app.save_gyan_submission_draft('$$ || :'a1' || $$', '$$ || :p_kid || $$', 'Namo', '{"kind": "voice"}')$$,
  'must be a list', 'the files must be a list');
select pg_temp.assert_raises($$select app.save_gyan_submission_draft('$$ || :'a1' || $$', '$$ || :p_kid || $$', 'Namo', jsonb_build_array(jsonb_build_object('kind', 'file', 'storage_path', '$$ || :prefix || :'sub1' || $$/e1000000-0000-4000-8000-00000000000b.pdf', 'mime_type', 'application/pdf', 'bytes', 10)))$$,
  'does not take a file answer', 'a kind the homework does not allow is refused');
select pg_temp.assert_raises($$select app.save_gyan_submission_draft('$$ || :'a1' || $$', '$$ || :p_kid || $$', 'Namo', jsonb_build_array(
    jsonb_build_object('kind', 'photo', 'storage_path', '$$ || :prefix || :'sub1' || $$/e1000000-0000-4000-8000-000000000008.jpg', 'mime_type', 'image/jpeg', 'bytes', 10),
    jsonb_build_object('kind', 'photo', 'storage_path', '$$ || :prefix || :'sub1' || $$/e1000000-0000-4000-8000-000000000009.jpg', 'mime_type', 'image/jpeg', 'bytes', 10),
    jsonb_build_object('kind', 'photo', 'storage_path', '$$ || :prefix || :'sub1' || $$/e1000000-0000-4000-8000-00000000000a.jpg', 'mime_type', 'image/jpeg', 'bytes', 10)))$$,
  'at most 2 files', 'more parts than the homework allows are refused');
select pg_temp.assert_raises($$select app.save_gyan_submission_draft('$$ || :'a1' || $$', '$$ || :p_kid || $$', 'Namo', jsonb_build_array(jsonb_build_object('kind', 'photo', 'storage_path', '$$ || :prefix || $$72000000-0000-4000-8000-0000000000ee/e1000000-0000-4000-8000-000000000008.jpg', 'mime_type', 'image/jpeg', 'bytes', 10)))$$,
  'its path must be', 'a part outside the answer''s own folder is refused');
select pg_temp.assert_raises($$select app.save_gyan_submission_draft('$$ || :'a1' || $$', '$$ || :p_kid || $$', 'Namo', jsonb_build_array(jsonb_build_object('kind', 'photo', 'storage_path', '$$ || :prefix || :'sub1' || $$/e1000000-0000-4000-8000-000000000016.txt', 'mime_type', 'text/plain', 'bytes', 10)))$$,
  'not a file type this homework takes for a photo', 'a text file is not a photo');
select pg_temp.assert_raises($$select app.save_gyan_submission_draft('$$ || :'a1' || $$', '$$ || :p_kid || $$', 'Namo', jsonb_build_array(jsonb_build_object('kind', 'voice', 'storage_path', '$$ || :prefix || :'sub1' || $$/e1000000-0000-4000-8000-00000000000c.m4a', 'mime_type', 'audio/mp4', 'bytes', 30000000)))$$,
  'at most 25 MB', 'a part over 25 MB is refused');
select pg_temp.assert_raises($$select app.save_gyan_submission_draft('$$ || :'a1' || $$', '$$ || :p_kid || $$', 'Namo', jsonb_build_array(jsonb_build_object('kind', 'voice', 'storage_path', '$$ || :prefix || :'sub1' || $$/e1000000-0000-4000-8000-00000000000c.m4a', 'mime_type', 'audio/mp4', 'bytes', 10.5)))$$,
  'whole number of bytes', 'a fractional size has its own sentence');
select pg_temp.assert_raises($$select app.save_gyan_submission_draft('$$ || :'a1' || $$', '$$ || :p_kid || $$', 'Namo', jsonb_build_array(jsonb_build_object('kind', 'voice', 'storage_path', '$$ || :prefix || :'sub1' || $$/e1000000-0000-4000-8000-00000000000c.m4a', 'mime_type', 'audio/mp4', 'bytes', 0)))$$,
  'the file is empty', 'and so does an empty file');
select pg_temp.assert_raises($$select app.save_gyan_submission_draft('$$ || :'a1' || $$', '$$ || :p_kid || $$', 'Namo', jsonb_build_array(
    jsonb_build_object('kind', 'photo', 'storage_path', '$$ || :prefix || :'sub1' || $$/e1000000-0000-4000-8000-000000000008.jpg', 'mime_type', 'image/jpeg', 'bytes', 10),
    jsonb_build_object('kind', 'photo', 'storage_path', '$$ || :prefix || :'sub1' || $$/e1000000-0000-4000-8000-000000000008.jpg', 'mime_type', 'image/jpeg', 'bytes', 10)))$$,
  'listed twice', 'the same part twice is refused');
select pg_temp.assert_raises($$select app.save_gyan_submission_draft('$$ || :'a1' || $$', '$$ || :p_kid || $$', repeat('x', 2001), null)$$,
  'at most 2,000 characters', 'a written answer over 2,000 characters is refused');
select app.save_gyan_submission_draft(:'a1', :p_kid, ' Namo Arihantanam ', jsonb_build_array(
         jsonb_build_object('kind', 'voice', 'storage_path', :prefix || :'sub1' || '/e1000000-0000-4000-8000-000000000001.m4a', 'mime_type', 'audio/mp4', 'bytes', 1234, 'duration_seconds', 12.4),
         jsonb_build_object('kind', 'photo', 'storage_path', :prefix || :'sub1' || '/e1000000-0000-4000-8000-000000000002.jpg', 'mime_type', 'image/jpeg', 'bytes', 999))) as sub1v2 \gset
commit;
select pg_temp.assert(:'sub1v2'::jsonb->>'text_answer' = 'Namo Arihantanam' and jsonb_array_length(:'sub1v2'::jsonb->'files') = 2
                      and :'sub1v2'::jsonb->'files'->0->>'kind' = 'voice' and (:'sub1v2'::jsonb->'files'->0->>'duration_seconds')::int = 12
                      and :'sub1v2'::jsonb->'files'->1->>'storage_path' = :prefix || :'sub1' || '/e1000000-0000-4000-8000-000000000002.jpg' and :'sub1v2'::jsonb->'files'->1->'deleted_at' = 'null'::jsonb
                      and (select array_agg(k order by k) from jsonb_object_keys(:'sub1v2'::jsonb->'files'->0) k) = array['bytes','deleted_at','duration_seconds','id','kind','mime_type','sort_order','storage_path'],
  'the draft keeps the trimmed text and its two parts, in order, with exactly the contract''s file keys');

-- ── Handing in ─────────────────────────────────────────────────────────────
begin;
select pg_temp.sign_in(:mom);
select (app.save_gyan_submission_draft(:'a1', :p_kid2, null, null)->>'id') as sub2 \gset
select pg_temp.assert_raises($$select app.hand_in_gyan_submission('$$ || :'sub2' || $$')$$,
  'Add a photo, a file, a voice note or a written answer', 'an empty answer cannot be handed in');
commit;
begin;
select pg_temp.sign_in(:neighbor);
select pg_temp.assert_raises($$select app.hand_in_gyan_submission('$$ || :'sub1' || $$')$$,
  'yourself or for someone in your family', 'another family cannot hand in the child''s homework');
commit;
begin;
select pg_temp.sign_in(:kid);
select app.hand_in_gyan_submission(:'sub1') as sub1in \gset
commit;
select pg_temp.assert(:'sub1in'::jsonb->>'status' = 'awaiting_parent' and (:'sub1in'::jsonb->>'late')::boolean = false and :'sub1in'::jsonb->>'submitted_at' is not null
                      and (select submitted_by = :kid::uuid and parent_user is null from app.gyan_submissions where id = :'sub1'),
  'a child handing in from her own login waits for a parent');
select pg_temp.assert((select count(*) = 3 and array_agg(to_address order by to_address) filter (where channel = 'push') = array[:mom, :dad]
                          and count(*) filter (where channel = 'email' and to_address = 'mom72@example.com') = 1
                          and bool_and(payload->>'type' = 'homework_parent' and payload->'vars'->>'type' = 'homework_parent' and payload->>'submission_id' = :'sub1'
                                       and payload->>'deep_link' = '/gyan/homework/' || :'a1' || '?person=' || :p_kid and payload->>'learner_id' = :p_kid)
                         from pg_temp.msgs('homework.parent_check', 'submission_id', :'sub1')),
  'the parents are asked (push to both, email to the one with an address) with the family screen''s type and the link');
select pg_temp.assert((select reason from app.audit_log where record_table = 'gyan_submissions' and record_id = :'sub1' and action = 'gyan_submissions.update' order by id desc limit 1)
                        = 'Handed in homework "Navkar recording" for Anya (child), awaiting a parent',
  'the hand-in is audited with the homework, the child and what happens next');
-- While a parent has it, the teachers read nothing of it: the parent's check comes before the teacher sees the answer.
begin;
select pg_temp.sign_in(:classteacher);
select pg_temp.reads(:'sub1') as r_wait_class \gset
commit;
begin;
select pg_temp.sign_in(:centerteacher);
select pg_temp.reads(:'sub1') as r_wait_center \gset
commit;
begin;
select pg_temp.sign_in(:principal);
select pg_temp.reads(:'sub1') as r_wait_principal \gset
commit;
begin;
select pg_temp.sign_in(:mom);
select pg_temp.reads(:'sub1') as r_wait_mom \gset
commit;
select pg_temp.assert(:'r_wait_class' = '0/0/0' and :'r_wait_center' = '0/0/0' and :'r_wait_principal' = '0/0/0' and :'r_wait_mom' = '1/2/2',
  'while a parent has it the class teacher, a center-wide teacher and the principal read nothing of it (row, parts, files); her parent reads all of it');
begin;
select pg_temp.sign_in(:kid);
select pg_temp.assert_raises($$select app.hand_in_gyan_submission('$$ || :'sub1' || $$')$$, 'already handed in', 'it cannot be handed in twice');
select pg_temp.assert_raises($$select app.save_gyan_submission_draft('$$ || :'a1' || $$', '$$ || :p_kid || $$', 'changed', null)$$,
  'waiting for a parent', 'nor changed while a parent looks at it');
select pg_temp.assert_raises($$insert into storage.objects (bucket_id, name) values ('homework', '$$ || :prefix || :'sub1' || $$/e1000000-0000-4000-8000-000000000005.jpg')$$,
  'row-level security', 'homework bucket: no more uploads once it is handed in');
select pg_temp.assert_raises($$select app.parent_decide_gyan_submission('$$ || :'sub1' || $$', 'ok', null)$$,
  'your own homework', 'the child cannot give the parent''s OK herself');
commit;
begin;
select pg_temp.sign_in(:neighbor);
select pg_temp.assert_raises($$select app.parent_decide_gyan_submission('$$ || :'sub1' || $$', 'ok', null)$$,
  'adult of Anya''s household', 'a parent of another household cannot decide');
commit;
begin;
select pg_temp.sign_in(:classteacher);
select pg_temp.assert_raises($$select app.parent_decide_gyan_submission('$$ || :'sub1' || $$', 'ok', null)$$,
  'adult of Anya''s household', 'the teacher is not the parent');
select pg_temp.assert_raises($$select app.review_gyan_submission('$$ || :'sub1' || $$', 'accept', null)$$,
  'waiting for a parent''s OK', 'and cannot review it before the parent has looked');
commit;
begin;
select pg_temp.sign_in(:mom);
select pg_temp.assert_raises($$select app.parent_decide_gyan_submission('$$ || :'sub1' || $$', 'maybe', null)$$,
  '"ok" or "send_back"', 'the decision is ok or send_back');
select pg_temp.assert_raises($$select app.parent_decide_gyan_submission('$$ || :'sub1' || $$', 'send_back', repeat('x', 501))$$,
  'at most 500 characters', 'the parent''s note is at most 500 characters');
select app.parent_decide_gyan_submission(:'sub1', 'send_back', ' Say it a little slower. ') as sub1back \gset
commit;
select pg_temp.assert(:'sub1back'::jsonb->>'status' = 'draft' and :'sub1back'::jsonb->>'parent_note' = 'Say it a little slower.'
                      and (select parent_user = :mom::uuid and parent_decided_at is not null and attempt = 1 from app.gyan_submissions where id = :'sub1'),
  'a parent sends it back: a draft again with the note');
begin;
select pg_temp.sign_in(:classteacher);
select pg_temp.reads(:'sub1') as r_draft_class \gset
commit;
select pg_temp.assert(:'r_draft_class' = '0/0/0', 'a draft again: the teacher reads nothing of it');
select pg_temp.assert((select count(*) = 1 and bool_and(channel = 'push' and to_address = :kid and payload->>'type' = 'homework'
                                                        and body = 'Your parent sent "Navkar recording" (Foundations) back to you. Open the app to read the note.'
                                                        and body not like '%slower%' and not (payload->'vars' ? 'note') and payload::text not like '%slower%')
                         from pg_temp.msgs('homework.sent_back_parent', 'submission_id', :'sub1')),
  'the child is told by push that there is a note and where to read it: the parent''s note is not in the message');
begin;
select pg_temp.sign_in(:kid);
insert into storage.objects (bucket_id, name, metadata) values ('homework', :prefix || :'sub1' || '/e1000000-0000-4000-8000-000000000003.m4a', '{"size": 2222, "mimetype": "audio/mp4"}');
select app.save_gyan_submission_draft(:'a1', :p_kid, 'Namo Arihantanam', jsonb_build_array(
         jsonb_build_object('kind', 'voice', 'storage_path', :prefix || :'sub1' || '/e1000000-0000-4000-8000-000000000003.m4a', 'mime_type', 'audio/mp4', 'bytes', 2222, 'duration_seconds', 20),
         jsonb_build_object('kind', 'photo', 'storage_path', :prefix || :'sub1' || '/e1000000-0000-4000-8000-000000000002.jpg', 'mime_type', 'image/jpeg', 'bytes', 999)));
select app.hand_in_gyan_submission(:'sub1') as sub1in2 \gset
commit;
select pg_temp.assert(:'sub1in2'::jsonb->>'status' = 'awaiting_parent' and (:'sub1in2'::jsonb->>'attempt')::int = 1 and :'sub1in2'::jsonb->'parent_note' = 'null'::jsonb,
  'after a parent''s send-back the child changes it and hands it in again (same attempt), and the parent''s earlier note is cleared');
begin;
select pg_temp.sign_in(:dad);
select app.my_gyan_homework(:c1) as hw_dad \gset
select app.parent_decide_gyan_submission(:'sub1', 'ok', null) as sub1ok \gset
commit;
select pg_temp.assert((select (i->>'can_parent_decide')::boolean from jsonb_array_elements(:'hw_dad'::jsonb->'items') i where i->'assignment'->>'id' = :'a1' and i->>'person_id' = :p_kid),
  'the other parent sees it is his to decide');
select pg_temp.assert(:'sub1ok'::jsonb->>'status' = 'submitted' and (select parent_user = :dad::uuid from app.gyan_submissions where id = :'sub1'),
  'the other parent''s OK sends it to the teacher');
select pg_temp.assert((select count(*) = 1 and bool_and(channel = 'push' and to_address = :classteacher and payload->>'type' = 'homework_review' and payload->>'submission_id' = :'sub1'
                                                        and payload->>'assignment_id' = :'a1' and not (payload ? 'deep_link'))
                         from pg_temp.msgs('homework.submitted', 'submission_id', :'sub1')),
  'the class teacher (and nobody else) is told by push: its own type and no deep link into the member app (teachers review in the portal)');
begin;
select pg_temp.sign_in(:contentmgr);
select pg_temp.assert_raises($$select app.set_gyan_assignment_status('$$ || :'a1' || $$', 'draft')$$,
  'already started this homework', 'homework with answers cannot go back to a draft');
commit;

-- ── Who reads the answer, its parts and its files ──────────────────────────
begin; select pg_temp.sign_in(:kid); select pg_temp.reads(:'sub1') as r_kid \gset
commit;
begin; select pg_temp.sign_in(:mom); select pg_temp.reads(:'sub1') as r_mom \gset
commit;
begin; select pg_temp.sign_in(:dad); select pg_temp.reads(:'sub1') as r_dad \gset
commit;
begin; select pg_temp.sign_in(:neighbor); select pg_temp.reads(:'sub1') as r_nb \gset
commit;
begin; select pg_temp.sign_in(:member); select pg_temp.reads(:'sub1') as r_member \gset
commit;
begin; select pg_temp.sign_in(:classteacher); select pg_temp.reads(:'sub1') as r_class \gset
commit;
begin; select pg_temp.sign_in(:otherteacher); select pg_temp.reads(:'sub1') as r_other \gset
commit;
begin; select pg_temp.sign_in(:pastteacher); select pg_temp.reads(:'sub1') as r_past \gset
commit;
begin; select pg_temp.sign_in(:centerteacher); select pg_temp.reads(:'sub1') as r_center \gset
commit;
begin; select pg_temp.sign_in(:principal); select pg_temp.reads(:'sub1') as r_principal \gset
commit;
begin; select pg_temp.sign_in(:contentmgr); select pg_temp.reads(:'sub1') as r_content \gset
commit;
begin; select pg_temp.sign_in(:other); select pg_temp.reads(:'sub1') as r_c2 \gset
commit;
select pg_temp.assert(:'r_kid' = '1/2/3' and :'r_mom' = '1/2/3' and :'r_dad' = '1/2/3', 'the child and both parents read the answer, its parts and the three uploaded files');
select pg_temp.assert(:'r_class' = '1/2/2' and :'r_center' = '1/2/2' and :'r_principal' = '1/2/2',
  'the Teacher of her class, a center-wide teacher (pathshala.teach) and the principal (pathshala.manage) read the answer, its parts and the two files it lists: not the file the child replaced');
select pg_temp.assert(:'r_other' = '0/0/0' and :'r_past' = '0/0/0',
  'the Teacher of another class and the Teacher of last year''s class read NOTHING: not the answer, not its parts, not the files');
select pg_temp.assert(:'r_nb' = '0/0/0' and :'r_member' = '0/0/0' and :'r_content' = '0/0/0' and :'r_c2' = '0/0/0',
  'another family, a plain member, a content manager (teacher-reviewed homework) and another community read nothing');
begin;
select pg_temp.sign_in(:kid);
select (select count(*) from app.gyan_assignments where id in (:'a1', :'a_tmp')) as n_kid_assignments \gset
commit;
begin;
select pg_temp.sign_in(:contentmgr);
select (select count(*) from app.gyan_assignments where id in (:'a1', :'a_tmp')) as n_cm_assignments \gset
commit;
begin;
select pg_temp.sign_in(:classteacher);
select (select count(*) from app.gyan_assignments where id in (:'a1', :'a_tmp', :'a_teacher')) as n_ct_assignments \gset
commit;
begin;
set local role anon;
select pg_temp.assert_raises($$select count(*) from app.gyan_assignments$$, 'permission denied', 'anon has no grant on the homework tables at all');
commit;
select pg_temp.assert(:'n_kid_assignments'::int = 1 and :'n_cm_assignments'::int = 2 and :'n_ct_assignments'::int = 1,
  'members read published homework; editors read drafts too; a class teacher reads their own class''s (archived) homework');

begin;
select pg_temp.sign_in(:neighbor);
select pg_temp.assert_raises($$select app.gyan_submission_json('$$ || :'sub1' || $$')$$, 'permission denied',
  'another family cannot pull the child''s answer by its id through a helper');
select pg_temp.assert_raises($$select app.gyan_learner_name('$$ || :p_kid || $$')$$, 'permission denied', 'nor the child''s name');
select pg_temp.assert_raises($$select app.person_is_minor('$$ || :p_kid || $$')$$, 'permission denied', 'nor whether she is a child');
commit;

-- ── The teacher's decision ─────────────────────────────────────────────────
begin;
select pg_temp.sign_in(:otherteacher);
select pg_temp.assert_raises($$select app.review_gyan_submission('$$ || :'sub1' || $$', 'accept', null)$$,
  'Only Anya''s class teacher', 'the Teacher of another class cannot review');
commit;
begin;
select pg_temp.sign_in(:pastteacher);
select pg_temp.assert_raises($$select app.review_gyan_submission('$$ || :'sub1' || $$', 'accept', null)$$,
  'Only Anya''s class teacher', 'nor the Teacher of last year''s class');
commit;
begin;
select pg_temp.sign_in(:mom);
select pg_temp.assert_raises($$select app.review_gyan_submission('$$ || :'sub1' || $$', 'accept', null)$$,
  'Only Anya''s class teacher', 'nor a parent');
commit;
begin;
select pg_temp.sign_in(:classteacher);
select pg_temp.assert_raises($$select app.review_gyan_submission('$$ || :'sub1' || $$', 'maybe', null)$$, '"accept" or "send_back"', 'the decision is accept or send_back');
select pg_temp.assert_raises($$select app.review_gyan_submission('$$ || :'sub1' || $$', 'send_back', '  ')$$, 'Say what to change', 'sending back needs a note');
select pg_temp.assert_raises($$select app.review_gyan_submission('$$ || :'sub1' || $$', 'send_back', repeat('x', 1001))$$, 'at most 1,000 characters', 'the note is at most 1,000 characters');
select app.review_gyan_submission(:'sub1', 'send_back', 'Add the last line of the mantra.') as sub1nw \gset
commit;
select pg_temp.assert(:'sub1nw'::jsonb->>'status' = 'needs_work' and :'sub1nw'::jsonb->>'review_note' = 'Add the last line of the mantra.' and :'sub1nw'::jsonb->>'decided_at' is not null
                      and (select reviewer_user = :classteacher::uuid and points_awarded = 0 from app.gyan_submissions where id = :'sub1'),
  'the class teacher sends it back with a note; no points');
select pg_temp.assert((select count(*) = 4 and array_agg(to_address order by to_address) filter (where channel = 'push') = array[:mom, :dad, :kid]
                          and count(*) filter (where channel = 'email' and to_address = 'mom72@example.com') = 1
                          and bool_and(body like '%Open the%app to read%' and body not like '%mantra%' and not (payload->'vars' ? 'note') and payload::text not like '%mantra%')
                         from pg_temp.msgs('homework.sent_back', 'submission_id', :'sub1')),
  'the child AND her parents are told that the teacher left a note (feedback is never only the child''s), and the note itself is in no message');
begin;
select pg_temp.sign_in(:classteacher);
select pg_temp.reads(:'sub1') as r_nw_class \gset
commit;
select pg_temp.assert(split_part(:'r_nw_class', '/', 1) = '1' and split_part(:'r_nw_class', '/', 2) = '2',
  'a sent-back answer stays readable by the teacher who sent it back');
begin;
select pg_temp.sign_in(:kid);
select pg_temp.assert_raises($$select app.hand_in_gyan_submission('$$ || :'sub1' || $$')$$,
  'change it and save it first', 'a sent-back answer is changed and saved before it is handed in again');
insert into storage.objects (bucket_id, name, metadata) values ('homework', :prefix || :'sub1' || '/e1000000-0000-4000-8000-000000000004.m4a', '{"size": 3333, "mimetype": "audio/mp4"}');
select pg_temp.assert(true, 'homework bucket: the child uploads again once it was sent back');
select app.save_gyan_submission_draft(:'a1', :p_kid, 'Namo Arihantanam, Namo Siddhanam', jsonb_build_array(
         jsonb_build_object('kind', 'voice', 'storage_path', :prefix || :'sub1' || '/e1000000-0000-4000-8000-000000000004.m4a', 'mime_type', 'audio/mp4', 'bytes', 3333, 'duration_seconds', 30))) as sub1v3 \gset
select app.hand_in_gyan_submission(:'sub1');
commit;
select pg_temp.assert(:'sub1v3'::jsonb->>'status' = 'draft' and (:'sub1v3'::jsonb->>'attempt')::int = 2 and jsonb_array_length(:'sub1v3'::jsonb->'files') = 1
                      and :'sub1v3'::jsonb->>'review_note' = 'Add the last line of the mantra.',
  'saving after a send-back starts attempt 2, replaces the parts and keeps the teacher''s note in view');
begin;
select pg_temp.sign_in(:mom);
select app.parent_decide_gyan_submission(:'sub1', 'ok', 'Much better');
commit;
begin;
select pg_temp.sign_in(:centerteacher);
select app.review_gyan_submission(:'sub1', 'accept', 'Well done') as sub1acc \gset
commit;
select pg_temp.assert(:'sub1acc'::jsonb->>'status' = 'accepted' and (:'sub1acc'::jsonb->>'points_awarded')::int = 15 and :'sub1acc'::jsonb->>'review_note' = 'Well done'
                      and :'sub1acc'::jsonb->>'parent_note' = 'Much better' and (:'sub1acc'::jsonb->>'attempt')::int = 2,
  'a center-wide teacher accepts it: 15 points on the answer');
select pg_temp.assert(pg_temp.rows(:p_kid, 'assignment', :'sub1') = 1 and pg_temp.pts(:p_kid, 'assignment', :'sub1') = 15
                      and (select note = 'Homework: Navkar recording' and center_id = :c1::uuid from app.points_ledger where person_id = :p_kid and reason = 'assignment' and ref_id = :'sub1'),
  'one ledger row: reason assignment, the submission as reference, "Homework: <title>"');
select pg_temp.assert((select count(*) = 4 and array_agg(to_address order by to_address) filter (where channel = 'push') = array[:mom, :dad, :kid]
                          and bool_and(body not like '%Well done%' and not (payload->'vars' ? 'note') and payload::text not like '%Well done%')
                         from pg_temp.msgs('homework.accepted', 'submission_id', :'sub1')),
  'the child and her parents are told it was accepted, without the teacher''s note in the message');
select pg_temp.assert((select bool_and(payload->>'type' = case when to_address = :kid then 'homework' else 'homework_parent' end
                                       and payload->>'deep_link' = '/gyan/homework/' || :'a1' || '?person=' || :p_kid)
                         from pg_temp.msgs('homework.accepted', 'submission_id', :'sub1')),
  'the learner''s push is typed homework, the parents'' homework_parent, both open the child''s homework');
begin;
select pg_temp.sign_in(:classteacher);
select pg_temp.assert_raises($$select app.review_gyan_submission('$$ || :'sub1' || $$', 'accept', null)$$, 'already accepted', 'accepted homework is not reviewed again');
select pg_temp.assert_raises($$select app.review_gyan_submission('$$ || :'sub1' || $$', 'send_back', 'x')$$, 'already accepted', 'nor sent back');
commit;
begin;
select pg_temp.sign_in(:kid);
select pg_temp.assert_raises($$select app.save_gyan_submission_draft('$$ || :'a1' || $$', '$$ || :p_kid || $$', 'again', null)$$, 'was accepted and cannot be changed', 'nor changed by the learner');
select pg_temp.assert_raises($$insert into storage.objects (bucket_id, name) values ('homework', '$$ || :prefix || :'sub1' || $$/e1000000-0000-4000-8000-000000000006.jpg')$$,
  'row-level security', 'homework bucket: closed once accepted');
commit;
-- Even if the answer somehow came back to the teacher (written here outside the RPCs), a second accept pays nothing.
update app.gyan_submissions set status = 'submitted' where id = :'sub1';
begin;
select pg_temp.sign_in(:principal);
select app.review_gyan_submission(:'sub1', 'accept', 'Still good') as sub1acc2 \gset
commit;
select pg_temp.assert(:'sub1acc2'::jsonb->>'status' = 'accepted' and (:'sub1acc2'::jsonb->>'points_awarded')::int = 15
                      and pg_temp.rows(:p_kid, 'assignment', :'sub1') = 1 and pg_temp.pts(:p_kid, 'assignment', :'sub1') = 15,
  'the points are paid once per homework and learner, never again on a re-accept');

-- ── The review queue ───────────────────────────────────────────────────────
begin;
select pg_temp.sign_in(:neighbor);
select pg_temp.assert_raises($$select app.gyan_homework_queue('72000000-0000-4000-8000-0000000000c1', 'waiting')$$, 'don''t have access', 'a parent has no review queue');
commit;
begin;
select pg_temp.sign_in(:classteacher);
select pg_temp.assert_raises($$select app.gyan_homework_queue('72000000-0000-4000-8000-0000000000c1', 'all')$$, '"waiting" or "decided"', 'the view is waiting or decided');
select app.gyan_homework_queue(:c1, 'decided') as q_class \gset
select app.gyan_homework_queue(:c1, 'waiting') as q_class_waiting \gset
commit;
begin;
select pg_temp.sign_in(:otherteacher);
select app.gyan_homework_queue(:c1, 'decided') as q_other \gset
commit;
select pg_temp.assert((select count(*) = 1 and bool_and(i->'submission'->>'id' = :'sub1' and i->'submission'->>'status' = 'accepted'
                                                        and i->'assignment' = jsonb_build_object('id', :'a1', 'title', 'Navkar recording', 'points', 15, 'class_id', null, 'level_name', 'Foundations', 'goal_name', 'Learn 72')
                                                        and i->'learner'->>'person_id' = :p_kid and i->'learner'->>'name' = 'Anya Shah' and (i->'learner'->>'is_child')::boolean
                                                        and i->'learner'->>'household_id' = :h1
                                                        and i->'learner'->'household_card'
                                                            = jsonb_build_object('household_id', :h1, 'household_name', 'Shah household 72',
                                                                                 'household_number', (select household_number from app.households where id = :h1))
                                                        and (i->'learner'->'household_card'->>'household_number') <> '')
                         from jsonb_array_elements(:'q_class'::jsonb->'items') i)
                      and jsonb_array_length(:'q_class_waiting'::jsonb->'items') = 0,
  'the class teacher''s decided queue holds the answer with its homework, level, goal and the learner''s reduced household card (id, name and Connect number: no people permission, nothing financial)');
select pg_temp.assert(:'q_other'::jsonb = '{"items": []}'::jsonb, 'the Teacher of another class has an empty queue');
-- A reviewer who may see the full household card (people.view) gets app.household_card's JSON.
insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id) values (:c1, :centerteacher, 'membership_coordinator', 'center', null);
begin;
select pg_temp.sign_in(:centerteacher);
select app.gyan_homework_queue(:c1, 'decided') as q_center \gset
commit;
select pg_temp.assert((select bool_and(i->'learner'->'household_card'->>'household_id' = :h1 and i->'learner'->'household_card'->>'household_name' = 'Shah household 72'
                                       and i->'learner'->'household_card'->>'members' = 'Mira, Raj, Anya, Veer' and i->'learner'->'household_card'->>'primary_member' = 'Mira Shah'
                                       and (i->'learner'->'household_card') ? 'open_pledge_cents')
                         from jsonb_array_elements(:'q_center'::jsonb->'items') i),
  'a reviewer with people.view gets the full household card (members, primary member, the giving columns household_card itself allows)');

-- ── A required homework holds the level bonus (H7) ─────────────────────────
-- L1: "Class B only" is required but does not apply to the kid, so finishing the second step pays the level.
begin;
select pg_temp.sign_in(:kid);
insert into app.gyan_progress (center_id, person_id, step_id, stars, completed_at) values (:c1, :p_kid, :s1b, 3, now());
commit;
select pg_temp.assert(pg_temp.pts(:p_kid, 'level', :l1) = 20 and pg_temp.pts(:p_kid, 'gyan_treasure', :l1) = 30,
  'a required homework for another class does not hold the level: finishing L1 pays its 20 points and 30 treasure');
-- LREQ: its one step is done, but the required homework is not accepted.
begin;
select pg_temp.sign_in(:kid);
insert into app.gyan_progress (center_id, person_id, step_id, stars, completed_at) values (:c1, :p_kid, :sreq, 3, now());
commit;
select pg_temp.assert(pg_temp.rows(:p_kid, 'level', :lreq) = 0 and pg_temp.rows(:p_kid, 'gyan_treasure', :lreq) = 0
                      and app.gyan_award_level_bonus(:c1, :p_kid, :lreq) = 0,
  'every step done, but the required homework is not accepted: the level bonus waits');
begin;
select pg_temp.sign_in(:kid);
select (app.save_gyan_submission_draft(:'a_req', :p_kid, 'I did it', null)->>'id') as subreq \gset
select app.hand_in_gyan_submission(:'subreq') as subreq_in \gset
commit;
select pg_temp.assert(:'subreq_in'::jsonb->>'status' = 'submitted' and (select parent_user is null and submitted_by = :kid::uuid from app.gyan_submissions where id = :'subreq'),
  '"never" homework from a child''s own login goes straight to the teacher');
select pg_temp.assert(pg_temp.rows(:p_kid, 'level', :lreq) = 0, 'handing in pays nothing yet');
begin;
select pg_temp.sign_in(:classteacher);
select app.review_gyan_submission(:'subreq', 'accept', null);
commit;
select pg_temp.assert(pg_temp.pts(:p_kid, 'assignment', :'subreq') = 10 and pg_temp.pts(:p_kid, 'level', :lreq) = 20 and pg_temp.pts(:p_kid, 'gyan_treasure', :lreq) = 10,
  'accepting the last required homework pays its 10 points and the level''s 20 + 10 treasure');
update app.gyan_submissions set status = 'submitted' where id = :'subreq';
begin;
select pg_temp.sign_in(:classteacher);
select app.review_gyan_submission(:'subreq', 'accept', null);
commit;
select pg_temp.assert(pg_temp.rows(:p_kid, 'assignment', :'subreq') = 1 and pg_temp.rows(:p_kid, 'level', :lreq) = 1 and pg_temp.rows(:p_kid, 'gyan_treasure', :lreq) = 1
                      and app.gyan_award_level_bonus(:c1, :p_kid, :lreq) = 0,
  'a re-accept pays neither the homework nor the level again (one ledger row each)');

-- ── The content reviewer, an adult's own homework, a parent on behalf, "always", due dates ──
begin;
select pg_temp.sign_in(:mom);
select (app.save_gyan_submission_draft(:'a_content', :p_mom, 'Equanimity is the heart of Samayik.', null)->>'id') as subc \gset
select app.hand_in_gyan_submission(:'subc') as subc_in \gset
commit;
select pg_temp.assert(:'subc_in'::jsonb->>'status' = 'submitted' and (select parent_user is null from app.gyan_submissions where id = :'subc'),
  'an adult''s own hand-in goes straight to the reviewer');
select pg_temp.assert((select count(*) = 1 and bool_and(to_address = :contentmgr) from pg_temp.msgs('homework.submitted', 'submission_id', :'subc')),
  'for content-reviewed homework the content manager is told, not the teachers');
begin;
select pg_temp.sign_in(:classteacher);
select pg_temp.assert_raises($$select app.review_gyan_submission('$$ || :'subc' || $$', 'accept', null)$$, 'needs content.manage', 'a teacher cannot review content-reviewed homework');
commit;
begin;
select pg_temp.sign_in(:principal);
select app.gyan_homework_reviewer(:c1, :p_mom, 'content') as principal_content \gset
commit;
begin;
select pg_temp.sign_in(:contentmgr);
select pg_temp.reads(:'subc') as r_content_own \gset
select app.review_gyan_submission(:'subc', 'accept', null) as subc_acc \gset
commit;
select pg_temp.assert(:'principal_content'::boolean and :'r_content_own' = '1/0/0' and :'subc_acc'::jsonb->>'status' = 'accepted' and pg_temp.pts(:p_mom, 'assignment', :'subc') = 5,
  'the content manager reads and accepts it (5 points); pathshala.manage could too');
-- A parent doing a younger child's homework: no parent step, the parent is recorded.
begin;
select pg_temp.sign_in(:mom);
select app.save_gyan_submission_draft(:'a1', :p_kid2, 'Veer said it with me.', null);
select app.hand_in_gyan_submission(:'sub2') as sub2in \gset
commit;
select pg_temp.assert(:'sub2in'::jsonb->>'status' = 'submitted'
                      and (select parent_user = :mom::uuid and parent_decided_at is not null and submitted_by = :mom::uuid from app.gyan_submissions where id = :'sub2'),
  'a household adult handing in for a child goes straight to the teacher and is recorded as the parent');
-- "Always": an adult's own hand-in waits for the other adult; an adult alone does not wait.
begin;
select pg_temp.sign_in(:mom);
select (app.save_gyan_submission_draft(:'a_always', :p_mom, 'Mine', null)->>'id') as suba \gset
select app.hand_in_gyan_submission(:'suba') as suba_in \gset
commit;
begin;
select pg_temp.sign_in(:dad);
select app.parent_decide_gyan_submission(:'suba', 'ok', null) as suba_ok \gset
commit;
begin;
select pg_temp.sign_in(:member);
select (app.save_gyan_submission_draft(:'a_always', :p_member, 'Alone', null)->>'id') as subm \gset
select app.hand_in_gyan_submission(:'subm') as subm_in \gset
commit;
select pg_temp.assert(:'suba_in'::jsonb->>'status' = 'awaiting_parent' and :'suba_ok'::jsonb->>'status' = 'submitted' and :'subm_in'::jsonb->>'status' = 'submitted',
  '"always" homework: an adult''s own hand-in waits for the other adult of the household; an adult with nobody to ask goes straight to the teacher');
select pg_temp.assert((select count(*) = 1 and bool_and(channel = 'push' and to_address = :dad and payload->>'type' = 'homework_parent')
                         from pg_temp.msgs('homework.parent_check', 'submission_id', :'suba'))
                      and (select count(*) from pg_temp.msgs('homework.parent_check', 'submission_id', :'subm')) = 0,
  'the other adult is asked to check it (push; he has no email); nobody is asked when there is nobody');
-- Due dates are information: a late hand-in is marked, never refused.
begin;
select pg_temp.sign_in(:kid);
select (app.save_gyan_submission_draft(:'a_due', :p_kid, 'Late but done', null)->>'id') as subd \gset
select app.hand_in_gyan_submission(:'subd') as subd_in \gset
commit;
select pg_temp.assert(:'subd_in'::jsonb->>'status' = 'submitted' and (:'subd_in'::jsonb->>'late')::boolean,
  'homework due yesterday is handed in and marked late');

-- ═══ The security review's findings: each with its own denial ═══════════════
-- Fixtures: a brother who is a child with a login, one who is an adult, families with no adult who can sign in, a
-- household where the only adults are the principal and the owner, learners in every enrollment state, and staff who
-- read the audit log and the message queue.
\set teen '''72000000-0000-4000-8000-000000000111'''
\set adultkid '''72000000-0000-4000-8000-000000000112'''
\set treasurer '''72000000-0000-4000-8000-000000000113'''
\set commsuser '''72000000-0000-4000-8000-000000000114'''
\set peopleview '''72000000-0000-4000-8000-000000000115'''
\set owner '''72000000-0000-4000-8000-000000000116'''
\set platadmin '''72000000-0000-4000-8000-000000000117'''
\set nlteen '''72000000-0000-4000-8000-000000000118'''
\set mxteen '''72000000-0000-4000-8000-000000000119'''
\set mxa1 '''72000000-0000-4000-8000-00000000011a'''
\set ndchild '''72000000-0000-4000-8000-00000000011b'''
\set ndmom '''72000000-0000-4000-8000-00000000011c'''
\set stchild '''72000000-0000-4000-8000-00000000011d'''
\set u_wl '''72000000-0000-4000-8000-00000000011e'''
\set u_rq '''72000000-0000-4000-8000-00000000011f'''
\set u_comp '''72000000-0000-4000-8000-000000000120'''
\set u_pl '''72000000-0000-4000-8000-000000000121'''
\set volunteer '''72000000-0000-4000-8000-000000000122'''
\set p_teen '''72000000-0000-4000-8000-0000000001a1'''
\set p_adultkid '''72000000-0000-4000-8000-0000000001a2'''
\set p_nl_teen '''72000000-0000-4000-8000-0000000001a3'''
\set p_nl_adult '''72000000-0000-4000-8000-0000000001a4'''
\set p_mx_teen '''72000000-0000-4000-8000-0000000001a5'''
\set p_mx_a1 '''72000000-0000-4000-8000-0000000001a6'''
\set p_mx_a2 '''72000000-0000-4000-8000-0000000001a7'''
\set p_nd_child '''72000000-0000-4000-8000-0000000001a8'''
\set p_nd_mom '''72000000-0000-4000-8000-0000000001a9'''
\set p_nd_sis '''72000000-0000-4000-8000-0000000001aa'''
\set p_st_principal '''72000000-0000-4000-8000-0000000001ab'''
\set p_st_owner '''72000000-0000-4000-8000-0000000001ac'''
\set p_st_child '''72000000-0000-4000-8000-0000000001ad'''
\set p_selfrev '''72000000-0000-4000-8000-0000000001ae'''
\set p_wl '''72000000-0000-4000-8000-0000000001af'''
\set p_rq '''72000000-0000-4000-8000-0000000001b0'''
\set p_comp '''72000000-0000-4000-8000-0000000001b1'''
\set p_pl '''72000000-0000-4000-8000-0000000001b2'''
\set p_vol '''72000000-0000-4000-8000-0000000001b3'''
\set p_pa '''72000000-0000-4000-8000-0000000001b4'''
\set h_nl '''72000000-0000-4000-8000-0000000001c1'''
\set h_mx '''72000000-0000-4000-8000-0000000001c2'''
\set h_nd '''72000000-0000-4000-8000-0000000001c3'''
\set h_st '''72000000-0000-4000-8000-0000000001c4'''
\set h_self '''72000000-0000-4000-8000-0000000001c5'''
\set h_wl '''72000000-0000-4000-8000-0000000001c6'''
\set h_rq '''72000000-0000-4000-8000-0000000001c7'''
\set h_comp '''72000000-0000-4000-8000-0000000001c8'''
\set h_pl '''72000000-0000-4000-8000-0000000001c9'''
\set h_vol '''72000000-0000-4000-8000-0000000001ca'''
insert into auth.users (id, email) values
  (:teen, 'teen72@example.com'), (:adultkid, 'adultkid72@example.com'), (:treasurer, 'treasurer72@example.com'),
  (:commsuser, 'comms72@example.com'), (:peopleview, 'pv72@example.com'), (:owner, 'owner72@example.com'),
  (:platadmin, 'plat72@example.com'), (:nlteen, 'nlteen72@example.com'), (:mxteen, 'mxteen72@example.com'),
  (:mxa1, 'mxa172@example.com'), (:ndchild, 'ndchild72@example.com'), (:ndmom, 'ndmom72@example.com'),
  (:stchild, 'stchild72@example.com'), (:u_wl, 'wl72@example.com'), (:u_rq, 'rq72@example.com'),
  (:u_comp, 'comp72@example.com'), (:u_pl, 'pl72@example.com'), (:volunteer, 'volunteer72@example.com');
insert into app.people (id, center_id, first_name, last_name, date_of_birth, email) values
  (:p_teen, :c1, 'Tara', 'Shah', (current_date - interval '14 years')::date, null),
  (:p_adultkid, :c1, 'Akash', 'Shah', (current_date - interval '20 years')::date, null),
  (:p_nl_teen, :c1, 'Nina', 'Nolog', (current_date - interval '15 years')::date, null),
  (:p_nl_adult, :c1, 'Nan', 'Nolog', date '1975-01-01', 'nanparent72@example.com'),
  (:p_mx_teen, :c1, 'Mia', 'Mixed', (current_date - interval '15 years')::date, null),
  (:p_mx_a1, :c1, 'Max', 'Mixed', date '1976-01-01', 'mxa172@example.com'),
  (:p_mx_a2, :c1, 'Mel', 'Mixed', date '1977-01-01', 'mxa272@example.com'),
  (:p_nd_child, :c1, 'Dev', 'Nodob', null, null),
  (:p_nd_mom, :c1, 'Dana', 'Nodob', date '1978-01-01', null),
  (:p_nd_sis, :c1, 'Sia', 'Nodob', (current_date - interval '8 years')::date, null),
  (:p_st_principal, :c1, 'Pam', 'Staff', date '1979-01-01', null),
  (:p_st_owner, :c1, 'Omar', 'Staff', date '1978-01-01', null),
  (:p_st_child, :c1, 'Sam', 'Staff', (current_date - interval '11 years')::date, null),
  (:p_selfrev, :c1, 'Sol', 'Selfrev', date '1980-01-01', null),
  (:p_wl, :c1, 'Wally', 'Wait', date '1990-01-01', null), (:p_rq, :c1, 'Rita', 'Req', date '1990-01-01', null),
  (:p_comp, :c1, 'Carl', 'Comp', date '1990-01-01', null), (:p_pl, :c1, 'Pia', 'Placed', date '1990-01-01', null),
  (:p_vol, :c1, 'Vik', 'Volunteer', (current_date - interval '16 years')::date, null),
  (:p_pa, :c1, 'Paz', 'Admin', (current_date - interval '15 years')::date, null);
insert into app.households (id, center_id, display_name) values
  (:h_nl, :c1, 'Nolog household 72'), (:h_mx, :c1, 'Mixed household 72'), (:h_nd, :c1, 'Nodob household 72'), (:h_st, :c1, 'Staff household 72'),
  (:h_self, :c1, 'Selfrev household 72'), (:h_wl, :c1, 'WL household 72'), (:h_rq, :c1, 'RQ household 72'), (:h_comp, :c1, 'COMP household 72'),
  (:h_pl, :c1, 'PL household 72'), (:h_vol, :c1, 'Volunteer household 72');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :p_teen, :c1, 'child', false), (:h1, :p_adultkid, :c1, 'child', false),
  (:h_nl, :p_nl_teen, :c1, 'child', false), (:h_nl, :p_nl_adult, :c1, 'primary', true),
  (:h_mx, :p_mx_teen, :c1, 'child', false), (:h_mx, :p_mx_a1, :c1, 'primary', true), (:h_mx, :p_mx_a2, :c1, 'spouse', false),
  (:h_nd, :p_nd_child, :c1, 'child', false), (:h_nd, :p_nd_mom, :c1, 'primary', true), (:h_nd, :p_nd_sis, :c1, 'child', false),
  (:h_st, :p_st_principal, :c1, 'primary', true), (:h_st, :p_st_owner, :c1, 'spouse', false), (:h_st, :p_st_child, :c1, 'child', false),
  (:h_self, :p_selfrev, :c1, 'primary', true),
  (:h_wl, :p_wl, :c1, 'primary', true), (:h_rq, :p_rq, :c1, 'primary', true), (:h_comp, :p_comp, :c1, 'primary', true), (:h_pl, :p_pl, :c1, 'primary', true),
  (:h_vol, :p_vol, :c1, 'child', false), (:h_vol, :p_pa, :c1, 'child', false);
insert into app.center_users (center_id, user_id, person_id) values
  (:c1, :teen, :p_teen), (:c1, :adultkid, :p_adultkid), (:c1, :nlteen, :p_nl_teen), (:c1, :mxteen, :p_mx_teen), (:c1, :mxa1, :p_mx_a1),
  (:c1, :ndchild, :p_nd_child), (:c1, :ndmom, :p_nd_mom), (:c1, :stchild, :p_st_child),
  (:c1, :principal, :p_st_principal), (:c1, :owner, :p_st_owner), (:c1, :centerteacher, :p_selfrev),
  (:c1, :u_wl, :p_wl), (:c1, :u_rq, :p_rq), (:c1, :u_comp, :p_comp), (:c1, :u_pl, :p_pl),
  (:c1, :volunteer, :p_vol), (:c1, :platadmin, :p_pa);
insert into app.center_owners (center_id, user_id) values (:c1, :owner);
insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id) values
  (:c1, :treasurer, 'treasurer', 'center', null), (:c1, :commsuser, 'executive_viewer', 'center', null),
  (:c1, :peopleview, 'membership_coordinator', 'center', null), (:c1, :volunteer, 'membership_coordinator', 'center', null),
  (:c1, :mom, 'teacher', 'class', :classA);
insert into app.accounts (user_id, is_platform_admin) values (:platadmin, true) on conflict (user_id) do update set is_platform_admin = true;
insert into app.pathshala_enrollments (center_id, term_id, student_person_id, household_id, class_id, status) values
  (:c1, :term1, :p_wl, :h_wl, :classA, 'waitlisted'), (:c1, :term1, :p_rq, :h_rq, :classA, 'requested'),
  (:c1, :term1, :p_comp, :h_comp, :classA, 'completed'), (:c1, :term1, :p_pl, :h_pl, :classA, 'placed');

begin;
select pg_temp.sign_in(:contentmgr);
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'Review round homework', 'allowed_kinds', jsonb_build_array('text', 'photo'),
                                 'parent_check', 'never', 'points', 5))->>'id') as a_rr \gset
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'Parent check homework', 'allowed_kinds', jsonb_build_array('text'),
                                 'parent_check', 'children', 'points', 0))->>'id') as a_pc \gset
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'Files homework', 'allowed_kinds', jsonb_build_array('photo', 'text'),
                                 'max_files', 3, 'parent_check', 'never', 'points', 0))->>'id') as a_files \gset
select app.set_gyan_assignment_status(:'a_rr', 'published');
select app.set_gyan_assignment_status(:'a_pc', 'published');
select app.set_gyan_assignment_status(:'a_files', 'published');
commit;

-- ── A child sibling with a login, an adult sibling, a spouse ────────────────
begin; select pg_temp.sign_in(:kid);
select (app.save_gyan_submission_draft(:'a_rr', :p_kid, 'Words only the family should read', null)->>'id') as sub_rr \gset
commit;
begin; select pg_temp.sign_in(:teen); select pg_temp.reads(:'sub_rr') as rr_teen \gset
commit;
begin; select pg_temp.sign_in(:adultkid); select pg_temp.reads(:'sub_rr') as rr_adultkid \gset
commit;
begin; select pg_temp.sign_in(:dad); select pg_temp.reads(:'sub_rr') as rr_dad \gset
commit;
select pg_temp.assert(:'rr_teen' = '0/0/0' and :'rr_adultkid' = '1/0/0' and :'rr_dad' = '1/0/0',
  'her brother with a login (a child) reads nothing of her draft; her adult brother and her father read it');
begin; select pg_temp.sign_in(:teen);
select pg_temp.assert_raises($$select app.save_gyan_submission_draft('$$ || :'a_rr' || $$', '$$ || :p_kid || $$', 'x', null)$$,
  'yourself or for someone in your family', 'a child cannot save a draft for her sister');
select pg_temp.assert_raises($$select app.hand_in_gyan_submission('$$ || :'sub_rr' || $$')$$,
  'yourself or for someone in your family', 'nor hand in her homework');
select pg_temp.assert_raises($$select app.parent_decide_gyan_submission('$$ || :'sub_rr' || $$', 'ok', null)$$,
  'adult of Anya''s household', 'nor give her parent''s OK');
select pg_temp.assert_raises($$insert into storage.objects (bucket_id, name) values ('homework', '$$ || :prefix || :'sub_rr' || $$/e1000000-0000-4000-8000-00000000000f.jpg')$$,
  'row-level security', 'nor upload into her answer''s folder');
commit;
begin; select pg_temp.sign_in(:adultkid);
insert into storage.objects (bucket_id, name, metadata) values ('homework', :prefix || :'sub_rr' || '/e1000000-0000-4000-8000-000000000010.jpg', '{"size": 10, "mimetype": "image/jpeg"}');
select pg_temp.assert(true, 'an adult brother uploads into her folder');
select (app.save_gyan_submission_draft(:'a_rr', :p_teen, 'written by his adult brother', null)->>'id') as sub_teen \gset
select app.hand_in_gyan_submission(:'sub_teen') as sub_teen_in \gset
commit;
select pg_temp.assert(:'sub_teen_in'::jsonb->>'status' = 'submitted' and (select parent_user = :adultkid::uuid from app.gyan_submissions where id = :'sub_teen'),
  'an adult brother hands in for the 14-year-old: straight to the teacher, recorded as the parent');
select pg_temp.assert(not app.person_is_minor(:p_adultkid) and app.person_is_minor(:p_teen) and app.person_is_minor(:p_nd_child) and not app.person_is_minor(:p_nd_mom),
  'person_is_minor: a household child with no birth date on file is a minor; an adult household member is not');

-- ── Learners in every enrollment state, and a closed term ───────────────────
begin; select pg_temp.sign_in(:u_wl);
select (app.save_gyan_submission_draft(:'a_rr', :p_wl, 'waitlisted words', null)->>'id') as sub_wl \gset
select app.hand_in_gyan_submission(:'sub_wl');
commit;
begin; select pg_temp.sign_in(:u_rq);
select (app.save_gyan_submission_draft(:'a_rr', :p_rq, 'requested words', null)->>'id') as sub_rq \gset
select app.hand_in_gyan_submission(:'sub_rq');
commit;
begin; select pg_temp.sign_in(:u_comp);
select (app.save_gyan_submission_draft(:'a_rr', :p_comp, 'completed words', null)->>'id') as sub_comp \gset
select app.hand_in_gyan_submission(:'sub_comp');
commit;
begin; select pg_temp.sign_in(:u_pl);
select (app.save_gyan_submission_draft(:'a_rr', :p_pl, 'placed words', null)->>'id') as sub_pl \gset
select app.hand_in_gyan_submission(:'sub_pl');
commit;
begin; select pg_temp.sign_in(:kid); select app.hand_in_gyan_submission(:'sub_rr') as sub_rr_in \gset
commit;
select pg_temp.assert(:'sub_rr_in'::jsonb->>'status' = 'submitted', '"never" homework from the child''s own login goes straight to the teacher');
begin; select pg_temp.sign_in(:classteacher);
select pg_temp.reads(:'sub_wl') as ct_wl \gset
select pg_temp.reads(:'sub_rq') as ct_rq \gset
select pg_temp.reads(:'sub_comp') as ct_comp \gset
select pg_temp.reads(:'sub_pl') as ct_pl \gset
select pg_temp.assert_raises($$select app.review_gyan_submission('$$ || :'sub_wl' || $$', 'accept', null)$$, 'Only Wally''s class teacher', 'the Teacher of class A cannot review a waitlisted student''s answer');
select pg_temp.assert_raises($$select app.review_gyan_submission('$$ || :'sub_rq' || $$', 'accept', null)$$, 'Only Rita''s class teacher', 'nor a requested one''s');
select pg_temp.assert_raises($$select app.review_gyan_submission('$$ || :'sub_comp' || $$', 'accept', null)$$, 'Only Carl''s class teacher', 'nor a completed one''s');
commit;
begin; select pg_temp.sign_in(:centerteacher);
select pg_temp.reads(:'sub_wl') as cw_wl \gset
select pg_temp.reads(:'sub_comp') as cw_comp \gset
commit;
select pg_temp.assert(:'ct_wl' = '0/0/0' and :'ct_rq' = '0/0/0' and :'ct_comp' = '0/0/0' and :'ct_pl' = '1/0/0' and :'cw_wl' = '1/0/0' and :'cw_comp' = '1/0/0',
  'a class Teacher reads only students placed or active in the class (not waitlisted, requested or completed ones); pathshala.teach reads them all');
-- Last year's class teacher, with an enrollment of a closed term that was never closed.
update app.pathshala_enrollments set status = 'active' where id = :enrC;
begin; select pg_temp.sign_in(:pastteacher);
select pg_temp.reads(:'sub_rr') as past_reads \gset
select pg_temp.assert_raises($$select app.review_gyan_submission('$$ || :'sub_rr' || $$', 'send_back', 'x')$$, 'Only Anya''s class teacher', 'and cannot review it');
commit;
update app.pathshala_enrollments set status = 'withdrawn' where id = :enrC;
update app.pathshala_terms set status = 'registration' where id = :term1;
begin; select pg_temp.sign_in(:classteacher); select pg_temp.reads(:'sub_rr') as reg_reads \gset
commit;
update app.pathshala_terms set status = 'active' where id = :term1;
select pg_temp.assert(:'past_reads' = '0/0/0' and :'reg_reads' = '1/0/0',
  'last year''s class teacher (a still-"active" enrollment in a CLOSED term) reads and reviews nothing; a class whose term is in registration still counts');

-- ── Nobody decides on their own household's homework ────────────────────────
begin; select pg_temp.sign_in(:mom);
select pg_temp.assert_raises($$select app.review_gyan_submission('$$ || :'sub_rr' || $$', 'accept', null)$$,
  'cannot decide on homework from your own family', 'a parent who is also the class Teacher cannot review her own child''s homework');
select app.gyan_homework_queue(:c1, 'waiting') as q_mom \gset
commit;
select pg_temp.assert((select array_agg(i->'learner'->>'person_id' order by i->'learner'->>'person_id') from jsonb_array_elements(:'q_mom'::jsonb->'items') i) = array[:p_pl],
  'and her review queue lists the class''s other students only: not her own child''s answer (nor the waitlisted, requested and completed ones)');
begin; select pg_temp.sign_in(:stchild);
select (app.save_gyan_submission_draft(:'a_rr', :p_st_child, 'staff child words', null)->>'id') as sub_st \gset
select app.hand_in_gyan_submission(:'sub_st') as sub_st_in \gset
commit;
select pg_temp.assert(:'sub_st_in'::jsonb->>'status' = 'submitted', 'the principal''s and the owner''s child hands in');
begin; select pg_temp.sign_in(:principal);
select pg_temp.assert_raises($$select app.review_gyan_submission('$$ || :'sub_st' || $$', 'accept', null)$$,
  'cannot decide on homework from your own family', 'the principal (pathshala.manage) cannot review her own household''s homework');
select app.gyan_homework_queue(:c1, 'waiting') as q_principal \gset
select pg_temp.reads(:'sub_st') as principal_reads_own \gset
commit;
begin; select pg_temp.sign_in(:owner);
select pg_temp.assert_raises($$select app.review_gyan_submission('$$ || :'sub_st' || $$', 'accept', null)$$,
  'cannot decide on homework from your own family', 'nor can the owner');
commit;
select pg_temp.assert(jsonb_array_length(:'q_principal'::jsonb->'items') > 0
                      and not exists (select 1 from jsonb_array_elements(:'q_principal'::jsonb->'items') i where i->'learner'->>'person_id' = :p_st_child)
                      and :'principal_reads_own' = '1/0/0',
  'the principal''s queue holds other households'' answers, never her own household''s (she reads her own family''s answer as a parent, like any parent)');
begin; select pg_temp.sign_in(:centerteacher);
select (app.save_gyan_submission_draft(:'a_rr', :p_selfrev, 'the teacher''s own words', null)->>'id') as sub_self \gset
select app.hand_in_gyan_submission(:'sub_self') as sub_self_in \gset
select pg_temp.assert_raises($$select app.review_gyan_submission('$$ || :'sub_self' || $$', 'accept', null)$$,
  'cannot decide on homework from your own family', 'a teacher cannot review their own homework');
select app.gyan_homework_queue(:c1, 'waiting') as q_self \gset
commit;
select pg_temp.assert(not exists (select 1 from jsonb_array_elements(:'q_self'::jsonb->'items') i where i->'learner'->>'person_id' = :p_selfrev)
                      and exists (select 1 from jsonb_array_elements(:'q_self'::jsonb->'items') i where i->'learner'->>'person_id' = :p_st_child),
  'their queue does not list their own answer, and lists the principal''s child''s');
select pg_temp.assert((select count(*) from pg_temp.msgs('homework.submitted', 'submission_id', :'sub_st') where to_address in (:principal, :owner)) = 0
                      and (select count(*) from pg_temp.msgs('homework.submitted', 'submission_id', :'sub_st')) >= 1,
  'the principal and the owner are not told to review their own child''s homework; the other reviewers are');
begin; select pg_temp.sign_in(:centerteacher);
select app.review_gyan_submission(:'sub_st', 'accept', null) as sub_st_acc \gset
commit;
select pg_temp.assert(:'sub_st_acc'::jsonb->>'status' = 'accepted' and pg_temp.pts(:p_st_child, 'assignment', :'sub_st') = 5,
  'another teacher accepts it (5 points)');

-- ── Reviewers read only the parts an answer lists; replaced and undeclared files ──
begin; select pg_temp.sign_in(:kid);
select (app.save_gyan_submission_draft(:'a_files', :p_kid, null, null)->>'id') as sub_f \gset
insert into storage.objects (bucket_id, name, metadata) values
  ('homework', :prefix || :'sub_f' || '/e1000000-0000-4000-8000-000000000011.jpg', '{"size": 10, "mimetype": "image/jpeg"}'),
  ('homework', :prefix || :'sub_f' || '/e1000000-0000-4000-8000-000000000012.jpg', '{"size": 10, "mimetype": "image/jpeg"}'),
  ('homework', :prefix || :'sub_f' || '/e1000000-0000-4000-8000-000000000013.jpg', '{"size": 10, "mimetype": "image/jpeg"}');
select pg_temp.assert_raises(format($$insert into storage.objects (bucket_id, name) values ('homework', %L)$$, upper(:prefix || :'sub_f' || '/e1000000-0000-4000-8000-000000000014.jpg')),
  'row-level security', 'homework bucket: a path written with upper-case ids is refused (lower-case uuids only)');
select pg_temp.assert_raises(format($$insert into storage.objects (bucket_id, name) values ('homework', %L)$$, :prefix || :'sub_f' || '/a//e1000000-0000-4000-8000-000000000012.jpg'),
  'row-level security', 'homework bucket: an empty folder name inside the path is refused');
select pg_temp.assert_raises(format($$insert into storage.objects (bucket_id, name) values ('homework', %L)$$, :prefix || :'sub_f' || '/x/'),
  'row-level security', 'homework bucket: a trailing slash is refused');
select pg_temp.assert_raises(format($$insert into storage.objects (bucket_id, name) values ('homework', %L)$$, :prefix || :'sub_f' || '/'),
  'row-level security', 'homework bucket: an empty file name is refused');
select pg_temp.assert_raises(format($$insert into storage.objects (bucket_id, name) values ('homework', %L)$$, :prefix || :'sub_f' || '/SECRETFILENAME-anya-voice.m4a'),
  'row-level security', 'homework bucket: a file name the learner chose is refused (her words could sit in it)');
select pg_temp.assert_raises(format($$insert into storage.objects (bucket_id, name) values ('homework', %L)$$, :prefix || :'sub_f' || '/my homework.jpg'),
  'row-level security', 'homework bucket: not a name with a space either');
select pg_temp.assert_raises(format($$insert into storage.objects (bucket_id, name) values ('homework', %L)$$, :prefix || :'sub_f' || '/e1000000-0000-4000-8000-0000000000aa'),
  'row-level security', 'homework bucket: a uuid with no extension is refused');
select pg_temp.assert_raises(format($$insert into storage.objects (bucket_id, name) values ('homework', %L)$$, :prefix || :'sub_f' || '/e1000000-0000-4000-8000-0000000000aa.JPG'),
  'row-level security', 'homework bucket: nor an upper-case extension');
select pg_temp.assert_raises(format($$insert into storage.objects (bucket_id, name) values ('homework', %L)$$, :prefix || :'sub_f' || '/e1000000-0000-4000-8000-0000000000aa.abcdef'),
  'row-level security', 'homework bucket: nor an extension longer than five characters');
select pg_temp.assert_raises(format($$insert into storage.objects (bucket_id, name) values ('homework', %L)$$, :prefix || :'sub_f' || '/e1000000-0000-4000-8000-0000000000aa.jpg.exe'),
  'row-level security', 'homework bucket: nor two extensions');
select pg_temp.assert_raises(format($$select app.save_gyan_submission_draft(%L, %L, 'x', jsonb_build_array(jsonb_build_object('kind', 'photo', 'storage_path', %L, 'mime_type', 'image/jpeg', 'bytes', 5)))$$,
                                    :'a_files', :p_kid, :prefix || :'sub_f' || '/my secret photo.jpg'),
  'its path must be', 'and a part cannot name a file the learner called anything');
select pg_temp.assert_raises(format($$insert into storage.objects (bucket_id, name) values ('homework', %L)$$, :prefix || :'sub_f' || '/' || repeat('n', 480)),
  'row-level security', 'homework bucket: a name over 500 characters is refused');
select pg_temp.assert_raises(format($$select app.save_gyan_submission_draft(%L, %L, 'x', jsonb_build_array(jsonb_build_object('kind', 'photo', 'storage_path', %L, 'mime_type', 'image/jpeg', 'bytes', 5)))$$,
                                    :'a_files', :p_kid, upper(:prefix || :'sub_f' || '/e1000000-0000-4000-8000-000000000014.jpg')),
  'its path must be', 'and a part cannot name such a path either');
select app.save_gyan_submission_draft(:'a_files', :p_kid, 'my words', jsonb_build_array(
         jsonb_build_object('kind', 'photo', 'storage_path', :prefix || :'sub_f' || '/e1000000-0000-4000-8000-000000000011.jpg', 'mime_type', 'image/jpeg', 'bytes', 10),
         jsonb_build_object('kind', 'photo', 'storage_path', :prefix || :'sub_f' || '/e1000000-0000-4000-8000-000000000012.jpg', 'mime_type', 'image/jpeg', 'bytes', 10))) as f1 \gset
select app.save_gyan_submission_draft(:'a_files', :p_kid, 'my words', null) as f2 \gset
select app.save_gyan_submission_draft(:'a_files', :p_kid, 'my words', 'null'::jsonb) as f3 \gset
select app.save_gyan_submission_draft(:'a_files', :p_kid, 'my words', jsonb_build_array(
         jsonb_build_object('kind', 'photo', 'storage_path', :prefix || :'sub_f' || '/e1000000-0000-4000-8000-000000000011.jpg', 'mime_type', 'image/jpeg', 'bytes', 10))) as f4 \gset
select app.save_gyan_submission_draft(:'a_files', :p_kid, 'my words', '[]'::jsonb) as f5 \gset
select app.save_gyan_submission_draft(:'a_files', :p_kid, 'my words', jsonb_build_array(
         jsonb_build_object('kind', 'photo', 'storage_path', :prefix || :'sub_f' || '/e1000000-0000-4000-8000-000000000011.jpg', 'mime_type', 'image/jpeg', 'bytes', 10))) as f6 \gset
select app.hand_in_gyan_submission(:'sub_f') as sub_f_in \gset
commit;
select pg_temp.assert(jsonb_array_length(:'f1'::jsonb->'files') = 2 and jsonb_array_length(:'f2'::jsonb->'files') = 2 and jsonb_array_length(:'f3'::jsonb->'files') = 2
                      and jsonb_array_length(:'f4'::jsonb->'files') = 1 and jsonb_array_length(:'f5'::jsonb->'files') = 0 and jsonb_array_length(:'f6'::jsonb->'files') = 1,
  'a NULL list of files (SQL or JSON null) leaves the registered parts as they are; a list, even an empty one, replaces them');
begin; select pg_temp.sign_in(:classteacher); select pg_temp.reads(:'sub_f') as f_class \gset
commit;
begin; select pg_temp.sign_in(:centerteacher); select pg_temp.reads(:'sub_f') as f_center \gset
commit;
begin; select pg_temp.sign_in(:principal); select pg_temp.reads(:'sub_f') as f_principal \gset
commit;
begin; select pg_temp.sign_in(:mom); select pg_temp.reads(:'sub_f') as f_mom \gset
commit;
select pg_temp.assert(:'f_class' = '1/1/1' and :'f_center' = '1/1/1' and :'f_principal' = '1/1/1' and :'f_mom' = '1/1/3',
  'reviewers read the one file the answer lists, not the file the child replaced nor the one she never listed; her parent reads the whole folder (three files)');
select pg_temp.assert(app.gyan_homework_path_ok(:prefix || :'sub_f' || '/e1000000-0000-4000-8000-0000000000aa.jpg')
                      and app.gyan_homework_path_ok(:prefix || :'sub_f' || '/e1000000-0000-4000-8000-0000000000aa.m4a')
                      and app.gyan_homework_path_ok(:prefix || :'sub_f' || '/e1000000-0000-4000-8000-0000000000aa.3gp')
                      and app.gyan_homework_path_ok(:prefix || :'sub_f' || '/e1000000-0000-4000-8000-0000000000aa.docx')
                      and app.gyan_homework_path_ok(:prefix || :'sub_f' || '/e1000000-0000-4000-8000-0000000000aa.a')
                      and not app.gyan_homework_path_ok(:prefix || :'sub_f' || '/SECRET.jpg')
                      and not app.gyan_homework_path_ok(:prefix || :'sub_f' || '/e1000000-0000-4000-8000-0000000000aa.')
                      and not app.gyan_homework_path_ok(:prefix || :'sub_f' || '/e1000000-0000-4000-8000-0000000000aa.jpg/x.jpg')
                      and not app.gyan_homework_path_ok(upper(:prefix || :'sub_f' || '/e1000000-0000-4000-8000-0000000000aa.jpg')),
  'the path rule: <community>/<person>/<submission>/<lower-case uuid>.<one to five lower-case letters or digits>: what the member app uploads');
select pg_temp.assert(not exists (select 1 from app.jobs where kind = 'storage.scan' and payload->>'bucket' = 'homework'
                                    and payload->>'name' !~ '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/){3}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,5}$'),
  'every homework file the storage scan job names has an opaque name: no child''s words can sit in the job or its audit entry');
update storage.objects set created_at = now() - interval '400 days'
 where bucket_id = 'homework' and name in (:prefix || :'sub_f' || '/e1000000-0000-4000-8000-000000000012.jpg', :prefix || :'sub_f' || '/e1000000-0000-4000-8000-000000000013.jpg');
begin; set local role connect_worker;
select pg_temp.assert((select array_agg(name order by name) from app.storage_expired_objects(100) where bucket_id = 'homework' and name like '%/' || :'sub_f' || '/%')
                        = array[:prefix || :'sub_f' || '/e1000000-0000-4000-8000-000000000012.jpg', :prefix || :'sub_f' || '/e1000000-0000-4000-8000-000000000013.jpg'],
  'a replaced or never-listed file is cleaned up by the retention job like any other homework file (365 days after upload by default)');
commit;
update storage.objects set created_at = now()
 where bucket_id = 'homework' and name in (:prefix || :'sub_f' || '/e1000000-0000-4000-8000-000000000012.jpg', :prefix || :'sub_f' || '/e1000000-0000-4000-8000-000000000013.jpg');

-- ── A household with nobody who can sign in; one with a parent who can; a child with no birth date ──
begin; select pg_temp.sign_in(:nlteen); select app.my_gyan_homework(:c1) as hw_nl \gset
commit;
select pg_temp.assert(not (select (i->>'needs_parent')::boolean from jsonb_array_elements(:'hw_nl'::jsonb->'items') i where i->'assignment'->>'id' = :'a_pc' and i->>'person_id' = :p_nl_teen),
  'a teenager whose only parent cannot sign in is not told she must wait for a parent''s OK');
begin; select pg_temp.sign_in(:nlteen);
select (app.save_gyan_submission_draft(:'a_pc', :p_nl_teen, 'nolog words', null)->>'id') as sub_nl \gset
select app.hand_in_gyan_submission(:'sub_nl') as sub_nl_in \gset
commit;
select pg_temp.assert(:'sub_nl_in'::jsonb->>'status' = 'submitted' and (select parent_user is null and submitted_by = :nlteen::uuid from app.gyan_submissions where id = :'sub_nl'),
  'her hand-in goes straight to the teacher: a check nobody can do would wait for ever');
select pg_temp.assert((select count(*) = 1 and bool_and(channel = 'email' and to_address = 'nanparent72@example.com' and status = 'queued' and payload->>'type' = 'homework_parent'
                                                        and payload->>'learner_id' = :p_nl_teen and body like '%Nina''s homework "Parent check homework" (Foundations)%'
                                                        and body like '%It went straight to the teacher, because nobody in the household has signed in%'
                                                        and not (payload->'vars' ? 'note'))
                         from pg_temp.msgs('homework.heads_up', 'submission_id', :'sub_nl'))
                      and (select count(*) from pg_temp.msgs('homework.parent_check', 'submission_id', :'sub_nl')) = 0
                      and (select count(*) from pg_temp.msgs('homework.submitted', 'submission_id', :'sub_nl')) >= 1,
  'the household''s adult gets the heads-up by email (no push: no login), nobody is asked for an OK, and the reviewers are told');
select pg_temp.assert((select reason like '%straight to the teacher: no parent can sign in (a heads-up email goes to the household''s adults)%'
                         from app.audit_log where record_table = 'gyan_submissions' and record_id = :'sub_nl' and action = 'gyan_submissions.update' order by id desc limit 1),
  'the hand-in is audited as going straight to the teacher because no parent can sign in');
begin; select pg_temp.sign_in(:mxteen);
select (app.save_gyan_submission_draft(:'a_pc', :p_mx_teen, 'mixed words', null)->>'id') as sub_mx \gset
select app.hand_in_gyan_submission(:'sub_mx') as sub_mx_in \gset
commit;
select pg_temp.assert(:'sub_mx_in'::jsonb->>'status' = 'awaiting_parent'
                      and (select count(*) = 2 and bool_and(person_id = :p_mx_a1::uuid) and count(*) filter (where channel = 'push' and to_address = :mxa1) = 1
                                  and count(*) filter (where channel = 'email' and to_address = 'mxa172@example.com') = 1
                           from pg_temp.msgs('homework.parent_check', 'submission_id', :'sub_mx'))
                      and (select count(*) from pg_temp.msgs('homework.heads_up', 'submission_id', :'sub_mx')) = 0,
  'with one parent who can sign in and one who cannot, the hand-in waits and only the parent who can sign in is asked (push and email)');
-- The office releases an answer that nobody in the family can check (pathshala.manage, decision ok): only when no adult of
-- the household can sign in now, or after the answer has waited seven days.
begin; select pg_temp.sign_in(:principal);
select pg_temp.assert_raises($$select app.parent_decide_gyan_submission('$$ || :'sub_mx' || $$', 'send_back', 'x')$$,
  'only an adult of Mia''s household can send it back', 'the office can release the answer but not send it back for the family');
commit;
begin; select pg_temp.sign_in(:classteacher);
select pg_temp.assert_raises($$select app.parent_decide_gyan_submission('$$ || :'sub_mx' || $$', 'ok', null)$$,
  'adult of Mia''s household', 'a class teacher cannot release it');
commit;
begin; select pg_temp.sign_in(:member);
select pg_temp.assert_raises($$select app.parent_decide_gyan_submission('$$ || :'sub_mx' || $$', 'ok', null)$$,
  'adult of Mia''s household', 'nor a member of the community');
commit;
-- One of her parents can still sign in and the answer is new: the principal, the owner and Community Connect staff are refused.
begin; select pg_temp.sign_in(:principal);
select pg_temp.assert_raises($$select app.parent_decide_gyan_submission('$$ || :'sub_mx' || $$', 'ok', null)$$,
  'A parent in the family can still sign in and check this. It can be released after 7 days.', 'the office cannot release an answer while a parent can sign in and check it');
commit;
begin; select pg_temp.sign_in(:owner);
select pg_temp.assert_raises($$select app.parent_decide_gyan_submission('$$ || :'sub_mx' || $$', 'ok', null)$$,
  'can still sign in and check this', 'nor can the owner');
commit;
begin; select pg_temp.sign_in(:platadmin);
select pg_temp.assert_raises($$select app.parent_decide_gyan_submission('$$ || :'sub_mx' || $$', 'ok', null)$$,
  'can still sign in and check this', 'nor Community Connect staff');
commit;
select pg_temp.assert((select status = 'awaiting_parent' and parent_user is null from app.gyan_submissions where id = :'sub_mx')
                      and (select count(*) from pg_temp.msgs('homework.heads_up', 'submission_id', :'sub_mx')) = 0,
  'the refused attempts changed nothing and told nobody');
update app.gyan_submissions set submitted_at = now() - interval '6 days 23 hours' where id = :'sub_mx';
begin; select pg_temp.sign_in(:principal);
select pg_temp.assert_raises($$select app.parent_decide_gyan_submission('$$ || :'sub_mx' || $$', 'ok', null)$$,
  'It can be released after 7 days.', 'six days and 23 hours is not seven days');
commit;
-- After seven days the answer can be released although a parent could still sign in.
update app.gyan_submissions set submitted_at = now() - interval '7 days' - interval '1 minute' where id = :'sub_mx';
begin; select pg_temp.sign_in(:principal);
select app.parent_decide_gyan_submission(:'sub_mx', 'ok', 'The family asked the office') as sub_mx_rel \gset
commit;
select pg_temp.assert(:'sub_mx_rel'::jsonb->>'status' = 'submitted'
                      and :'sub_mx_rel'::jsonb->>'parent_note' = 'Released to the teacher by the office: it had waited 7 days for a parent. The family asked the office'
                      and (select parent_user = :principal::uuid and parent_decided_at is not null from app.gyan_submissions where id = :'sub_mx')
                      and (select reason = 'Released homework "Parent check homework" of Mia to the teacher (the office: it had waited 7 days for a parent)' from app.audit_log
                            where record_table = 'gyan_submissions' and record_id = :'sub_mx' and action = 'gyan_submissions.update' order by id desc limit 1)
                      and (select count(*) from pg_temp.msgs('homework.submitted', 'submission_id', :'sub_mx')) >= 1,
  'after seven days the office releases an answer a parent could have checked, recorded as released by the office (who, when, why) and the reviewers are told');
select pg_temp.assert((select count(*) = 3 and count(*) filter (where channel = 'push' and to_address = :mxa1) = 1
                              and count(*) filter (where channel = 'email' and to_address = 'mxa172@example.com') = 1
                              and count(*) filter (where channel = 'email' and to_address = 'mxa272@example.com') = 1
                              and bool_and(body like '%Mia''s homework "Parent check homework" (Foundations)%'
                                           and body like '%The office sent it on to the teacher, because it had waited seven days for a parent to check it.%'
                                           and body not like '%The family asked the office%' and not (payload->'vars' ? 'note'))
                         from pg_temp.msgs('homework.heads_up', 'submission_id', :'sub_mx')),
  'both parents are told by email that the office sent it on (a push too for the one who can sign in), in plain words and without the office''s note');
-- The other branch: nobody in the family can sign in NOW. The parent could when the child handed in; the login is gone.
\set nlparent '''72000000-0000-4000-8000-000000000123'''
insert into auth.users (id, email) values (:nlparent, 'nlparent72@example.com');
insert into app.center_users (center_id, user_id, person_id) values (:c1, :nlparent, :p_nl_adult);
begin; select pg_temp.sign_in(:contentmgr);
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'Parent check two', 'allowed_kinds', jsonb_build_array('text'), 'parent_check', 'children', 'points', 0))->>'id') as a_pc2 \gset
select app.set_gyan_assignment_status(:'a_pc2', 'published');
commit;
begin; select pg_temp.sign_in(:nlteen);
select (app.save_gyan_submission_draft(:'a_pc2', :p_nl_teen, 'nolog words two', null)->>'id') as sub_nl2 \gset
select app.hand_in_gyan_submission(:'sub_nl2') as sub_nl2_in \gset
commit;
begin; select pg_temp.sign_in(:principal);
select pg_temp.assert_raises($$select app.parent_decide_gyan_submission('$$ || :'sub_nl2' || $$', 'ok', null)$$,
  'A parent in the family can still sign in and check this.', 'while the parent has a login the office cannot release it');
commit;
delete from app.center_users where user_id = :nlparent;
begin; select pg_temp.sign_in(:principal);
select app.parent_decide_gyan_submission(:'sub_nl2', 'ok', null) as sub_nl2_rel \gset
commit;
select pg_temp.assert(:'sub_nl2_in'::jsonb->>'status' = 'awaiting_parent' and :'sub_nl2_rel'::jsonb->>'status' = 'submitted'
                      and :'sub_nl2_rel'::jsonb->>'parent_note' = 'Released to the teacher by the office: no parent could sign in.'
                      and (select reason = 'Released homework "Parent check two" of Nina to the teacher (the office: no parent could sign in)' from app.audit_log
                            where record_table = 'gyan_submissions' and record_id = :'sub_nl2' and action = 'gyan_submissions.update' order by id desc limit 1)
                      and (select count(*) = 1 and bool_and(channel = 'email' and to_address = 'nanparent72@example.com'
                                                            and body like '%The office sent it on to the teacher, because nobody in the household could sign in to check it.%')
                             from pg_temp.msgs('homework.heads_up', 'submission_id', :'sub_nl2')),
  'once no adult of the household can sign in (the parent''s login is gone), the office releases the waiting answer at once, and the parent is emailed');
-- A child with no birth date on file, recorded as a child of the household.
begin; select pg_temp.sign_in(:ndchild);
select (app.save_gyan_submission_draft(:'a_pc', :p_nd_child, 'nodob words', null)->>'id') as sub_nd \gset
select app.hand_in_gyan_submission(:'sub_nd') as sub_nd_in \gset
select pg_temp.assert_raises($$select app.save_gyan_submission_draft('$$ || :'a_pc' || $$', '$$ || :p_nd_sis || $$', 'x', null)$$,
  'yourself or for someone in your family', 'a child with no birth date on file cannot act as a parent for his sister');
select app.my_gyan_homework(:c1) as hw_nd \gset
commit;
select pg_temp.assert(:'sub_nd_in'::jsonb->>'status' = 'awaiting_parent',
  'a child with no birth date on file is a child: his own hand-in waits for his mother''s OK');
select pg_temp.assert(jsonb_array_length(:'hw_nd'::jsonb->'people') = 1 and (:'hw_nd'::jsonb->'people'->0->>'is_child')::boolean,
  'and he sees only himself, as a child');
begin; select pg_temp.sign_in(:ndmom);
select app.my_gyan_homework(:c1) as hw_ndmom \gset
select (app.save_gyan_submission_draft(:'a_pc', :p_nd_sis, 'sis words', null)->>'id') as sub_sis \gset
select app.hand_in_gyan_submission(:'sub_sis') as sub_sis_in \gset
commit;
begin; select pg_temp.sign_in(:ndchild); select pg_temp.reads(:'sub_sis') as nd_reads_sis \gset
commit;
select pg_temp.assert((select array_agg(p->>'person_id' order by p->>'person_id') from jsonb_array_elements(:'hw_ndmom'::jsonb->'people') p)
                        = (select array_agg(x order by x) from unnest(array[:p_nd_mom, :p_nd_child, :p_nd_sis]) x)
                      and :'sub_sis_in'::jsonb->>'status' = 'submitted' and :'nd_reads_sis' = '0/0/0',
  'his mother sees both children and hands in for his sister (straight to the teacher); he reads nothing of his sister''s answer');
-- An adult with no birth date on file who is a "child" in their parents' household and the "primary" of their own household.
\set adam '''72000000-0000-4000-8000-000000000124'''
\set p_adam '''72000000-0000-4000-8000-0000000001b5'''
\set p_ap1 '''72000000-0000-4000-8000-0000000001b6'''
\set h_adam '''72000000-0000-4000-8000-0000000001cb'''
\set h_ap '''72000000-0000-4000-8000-0000000001cc'''
insert into auth.users (id, email) values (:adam, 'adam72@example.com');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (:p_adam, :c1, 'Adam', 'Grown', null), (:p_ap1, :c1, 'Anil', 'Grown', date '1955-01-01');
insert into app.households (id, center_id, display_name) values (:h_adam, :c1, 'Adam own household 72'), (:h_ap, :c1, 'Adam parents household 72');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h_ap, :p_ap1, :c1, 'primary', true), (:h_ap, :p_adam, :c1, 'child', false), (:h_adam, :p_adam, :c1, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values (:c1, :adam, :p_adam);
select pg_temp.assert(not app.person_is_minor(:p_adam) and app.person_is_minor(:p_nd_child) and not app.person_is_minor(:p_ap1),
  'a missing birth date makes someone a minor only when they are a household child and nobody''s primary or spouse: Adam (a child in his parents'' household, the primary of his own) is an adult, the child with no other role is a minor');
begin; select pg_temp.sign_in(:adam);
select (app.save_gyan_submission_draft(:'a_pc', :p_adam, 'adam words', null)->>'id') as sub_adam \gset
select app.hand_in_gyan_submission(:'sub_adam') as sub_adam_in \gset
select app.my_gyan_homework(:c1) as hw_adam \gset
update app.people set date_of_birth = date '1990-01-01' where id = :p_adam;
select pg_temp.assert(true, 'and he can add his own birth date');
commit;
select pg_temp.assert(:'sub_adam_in'::jsonb->>'status' = 'submitted' and (select parent_user is null from app.gyan_submissions where id = :'sub_adam')
                      and (select count(*) from pg_temp.msgs('homework.parent_check', 'submission_id', :'sub_adam')) = 0
                      and (select count(*) from pg_temp.msgs('homework.heads_up', 'submission_id', :'sub_adam')) = 0
                      and not (select (p->>'is_child')::boolean from jsonb_array_elements(:'hw_adam'::jsonb->'people') p where p->>'person_id' = :p_adam),
  'Adam, an adult with no birth date, hands in "children" homework straight to the teacher: nobody in his parents'' household is asked or told, and the app does not call him a child');

-- ── A child cannot change their own date of birth (the separate access change) ──
begin; select pg_temp.sign_in(:kid);
select pg_temp.assert_raises($$update app.people set date_of_birth = date '1990-01-01' where id = '72000000-0000-4000-8000-0000000000a3'$$,
  'A child''s date of birth can only be changed by a parent or the office.', 'a child cannot move her own birth date back to become an adult');
update app.people set preferred_name = 'Ani' where id = :p_kid;
select pg_temp.assert((select preferred_name = 'Ani' from app.people where id = :p_kid), 'she can still change the rest of her own record');
update app.people set date_of_birth = date_of_birth where id = :p_kid;
select pg_temp.assert(true, 'and saving her record with the same birth date is not a change');
commit;
begin; select pg_temp.sign_in(:ndchild);
select pg_temp.assert_raises($$update app.people set date_of_birth = date '1990-01-01' where id = '72000000-0000-4000-8000-0000000001a8'$$,
  'only be changed by a parent or the office', 'nor can a child with no birth date on file give himself one');
commit;
select pg_temp.assert((select date_of_birth > current_date - interval '18 years' from app.people where id = :p_kid) and app.person_is_minor(:p_kid),
  'her birth date is unchanged: she is still a minor');
begin; select pg_temp.sign_in(:kid);
select (app.save_gyan_submission_draft(:'a_pc', :p_kid, 'kid words', null)->>'id') as sub_kpc \gset
select app.hand_in_gyan_submission(:'sub_kpc') as sub_kpc_in \gset
commit;
select pg_temp.assert(:'sub_kpc_in'::jsonb->>'status' = 'awaiting_parent', 'so her own hand-in of "children" homework still waits for a parent');
begin; select pg_temp.sign_in(:mom);
update app.people set date_of_birth = (current_date - interval '10 years' - interval '1 day')::date where id = :p_kid;
select pg_temp.assert(true, 'a parent can change her child''s birth date');
update app.people set date_of_birth = date '1982-01-02' where id = :p_mom;
select pg_temp.assert(true, 'an adult can change their own');
commit;
begin; select pg_temp.sign_in(:peopleview);
update app.people set date_of_birth = (current_date - interval '10 years')::date where id = :p_kid;
select pg_temp.assert(true, 'the office (people.manage) can change it');
commit;
begin; select pg_temp.sign_in(:volunteer);
update app.people set date_of_birth = (current_date - interval '16 years' - interval '2 days')::date where id = :p_vol;
select pg_temp.assert(true, 'a minor who holds people.manage can correct their own');
commit;
begin; select pg_temp.sign_in(:platadmin);
update app.people set date_of_birth = (current_date - interval '15 years' - interval '2 days')::date where id = :p_pa;
select pg_temp.assert(true, 'and a platform admin');
commit;

-- ── The reviewer and the parent check are fixed once answers exist ──────────
begin; select pg_temp.sign_in(:contentmgr);
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', jsonb_build_object('id', '$$ || :'a_rr' || $$', 'reviewer', 'content'))$$,
  'who reviews it and its parent check cannot change', 'once an answer exists a content manager cannot make themselves its reviewer');
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', jsonb_build_object('id', '$$ || :'a_rr' || $$', 'parent_check', 'always'))$$,
  'who reviews it and its parent check cannot change', 'nor change the parent check');
select app.save_gyan_assignment(:c1, jsonb_build_object('id', :'a_rr', 'points', 6, 'reviewer', 'teacher', 'parent_check', 'never')) as a_rr_v2 \gset
select app.save_gyan_assignment(:c1, jsonb_build_object('id', :'a_tmp', 'parent_check', 'always', 'reviewer', 'content')) as a_tmp_v2 \gset
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', jsonb_build_object('level_id', '72000000-0000-4000-8000-000000000f01', 'title', 'Content class', 'class_id', '72000000-0000-4000-8000-000000000a05', 'reviewer', 'content'))$$,
  'always reviewed by the class teacher', 'homework for a class cannot be reviewed by the content team');
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', jsonb_build_object('id', '$$ || :'a_class' || $$', 'reviewer', 'content'))$$,
  'always reviewed by the class teacher', 'nor switched to it later');
commit;
select pg_temp.assert(:'a_rr_v2'::jsonb->>'points' = '6' and :'a_tmp_v2'::jsonb->>'parent_check' = 'always' and :'a_tmp_v2'::jsonb->>'reviewer' = 'content',
  'the rest of the homework still changes, and the reviewer and parent check change freely while nobody has answered');
select pg_temp.assert_raises($$insert into app.gyan_assignments (center_id, level_id, class_id, title, reviewer) values ('72000000-0000-4000-8000-0000000000c1', '72000000-0000-4000-8000-000000000f01', '72000000-0000-4000-8000-000000000a05', 'Direct insert', 'content')$$,
  'always reviewed by the class teacher', 'the table says so too, for scripts');

-- ── Wrong JSON types get sentences, never raw database errors ───────────────
begin; select pg_temp.sign_in(:contentmgr);
select pg_temp.assert((select bool_and(pg_temp.state_of(format($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', %L::jsonb)$$, j)) = '22023')
                         from unnest(array[
  '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "j1", "allowed_kinds": [null]}',
  '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "j2", "allowed_kinds": ["photo", null]}',
  '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "j3", "allowed_kinds": [1]}',
  '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "j4", "allowed_kinds": "photo"}',
  '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "j5", "allowed_kinds": [["photo"]]}',
  '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "j6", "allowed_kinds": null}',
  '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "j7", "max_files": 2.5}',
  '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "j8", "max_files": "3"}',
  '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "j9", "max_files": null}',
  '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "j10", "points": "10"}',
  '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "j11", "points": 10.5}',
  '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "j12", "points": 1e400}',
  '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": 123}',
  '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": {"a": 1}}',
  '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "j15", "instructions_md": 42}',
  '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "j16", "required_for_level": "yes"}',
  '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "j17", "parent_check": 5}',
  '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "j18", "reviewer": 5}',
  '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "j19", "class_id": 5}',
  '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "j20", "class_id": ""}',
  '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "j21", "sort_order": "x"}',
  '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "j22", "due_rule": {"kind": "days_after_start"}}',
  '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "j23", "due_rule": {"kind": "days_after_start", "days": "7"}}',
  '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "j24", "due_rule": {"kind": "on"}}',
  '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "j25", "due_rule": {"kind": "on", "date": "2026-02-30"}}',
  '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "j26", "due_rule": "soon"}',
  '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "j27", "due_rule": {"kind": 5}}',
  '{"level_id": 5, "title": "j28"}',
  '{"id": 5, "title": "j29"}',
  'null', '[]', '"x"']) j),
  'a value of the wrong type or kind is refused with a plain sentence (22023): never a raw database error');
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "k1", "allowed_kinds": [null]}')$$,
  'Each way to answer must be one of the words', 'a null among the kinds says so');
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": 123}')$$,
  'The title must be text.', 'a title that is not text says so');
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "k2", "instructions_md": 42}')$$,
  'The instructions must be text.', 'and so do instructions');
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "k3", "points": 10.5}')$$,
  'Points must be a whole number from 0 to 1,000', 'a fractional number of points is refused, not rounded');
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "k4", "due_rule": {"kind": "days_after_start"}}')$$,
  'needs "days"', 'a "days after start" rule without days says so');
select app.save_gyan_assignment(:c1, '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "Lenient numbers", "max_files": 3.0, "points": 10.0, "sort_order": 1e1,
                                       "due_rule": {"kind": "days_after_start", "days": 7.0, "junk": [1, 2, 3]}}'::jsonb) as j_ok \gset
select app.save_gyan_assignment(:c1, '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "Junk rule", "due_rule": {"kind": "none", "junk": [1, 2]}}'::jsonb) as j_none \gset
commit;
select pg_temp.assert((:'j_ok'::jsonb->>'max_files') = '3' and (:'j_ok'::jsonb->>'points') = '10' and (:'j_ok'::jsonb->'due_rule')::text = '{"days": 7, "kind": "days_after_start"}'
                      and (:'j_none'::jsonb->'due_rule')::text = '{"kind": "none"}',
  'whole numbers written 3.0 and 10.0 are accepted as 3 and 10, and a due rule is stored in its one canonical form (no junk keys, 7 not 7.0)');

-- ── A class Teacher's points are capped at 100 ──────────────────────────────
begin; select pg_temp.sign_in(:classteacher);
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', jsonb_build_object('level_id', '72000000-0000-4000-8000-000000000f01', 'class_id', '72000000-0000-4000-8000-000000000a05', 'title', 'Big prize', 'allowed_kinds', jsonb_build_array('text'), 'points', 101))$$,
  'up to 100 points', 'a class Teacher cannot offer more than 100 points');
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'class_id', :classA, 'title', 'Fair prize', 'allowed_kinds', jsonb_build_array('text'), 'points', 100))->>'id') as a_fair \gset
commit;
begin; select pg_temp.sign_in(:principal);
select app.save_gyan_assignment(:c1, jsonb_build_object('id', :'a_fair', 'points', 1000)) as a_fair_big \gset
commit;
begin; select pg_temp.sign_in(:classteacher);
select app.save_gyan_assignment(:c1, jsonb_build_object('id', :'a_fair', 'title', 'Fair prize, renamed')) as a_fair_ren \gset
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', jsonb_build_object('id', '$$ || :'a_fair' || $$', 'points', 900))$$,
  'up to 100 points', 'nor lower it to a figure that is still above 100');
commit;
select pg_temp.assert((:'a_fair_big'::jsonb->>'points') = '1000' and (:'a_fair_ren'::jsonb->>'points') = '1000' and (:'a_fair_ren'::jsonb->>'title') = 'Fair prize, renamed',
  'a class Teacher offers 100; the office (pathshala.manage) may set 1,000; the Teacher can still change the rest of homework the office gave 1,000 points');

-- ── Required homework that stops holding releases the level bonus it held ───
\set l_arch '''72000000-0000-4000-8000-000000000f11'''
\set l_unpub '''72000000-0000-4000-8000-000000000f12'''
\set l_unreq '''72000000-0000-4000-8000-000000000f13'''
\set l_due2 '''72000000-0000-4000-8000-000000000f14'''
\set l_del '''72000000-0000-4000-8000-000000000f15'''
\set s_arch '''72000000-0000-4000-8000-000000000d11'''
\set s_unpub '''72000000-0000-4000-8000-000000000d12'''
\set s_unreq '''72000000-0000-4000-8000-000000000d13'''
\set s_due2 '''72000000-0000-4000-8000-000000000d14'''
insert into app.gyan_levels (id, goal_id, key, name, sort_order, points, treasure, treasure_points, requires_teacher_signoff) values
  (:l_arch, :g1, '11', 'Archive level', 11, 20, 'Archive badge', 10, false),
  (:l_unpub, :g1, '12', 'Unpublish level', 12, 20, 'Unpublish badge', 10, false),
  (:l_unreq, :g1, '13', 'Unrequire level', 13, 20, 'Unrequire badge', 10, false),
  (:l_due2, :g1, '14', 'Due start level', 14, 0, null, 0, false),
  (:l_del, :g1, '15', 'Deletable level', 15, 0, null, 0, false);
insert into app.gyan_steps (id, level_id, kind, title, sort_order, points) values
  (:s_arch, :l_arch, 'read', 'Archive step', 1, 0), (:s_unpub, :l_unpub, 'read', 'Unpublish step', 1, 0),
  (:s_unreq, :l_unreq, 'read', 'Unrequire step', 1, 0), (:s_due2, :l_due2, 'read', 'Due step', 1, 0);
begin; select pg_temp.sign_in(:contentmgr);
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l_arch, 'title', 'Required to archive', 'allowed_kinds', jsonb_build_array('text'), 'required_for_level', true, 'parent_check', 'never'))->>'id') as a_arch \gset
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l_unpub, 'title', 'Required to unpublish', 'allowed_kinds', jsonb_build_array('text'), 'required_for_level', true, 'parent_check', 'never'))->>'id') as a_unpub \gset
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l_unreq, 'title', 'Required to un-require', 'allowed_kinds', jsonb_build_array('text'), 'required_for_level', true, 'parent_check', 'never'))->>'id') as a_unreq \gset
select app.set_gyan_assignment_status(:'a_arch', 'published');
select app.set_gyan_assignment_status(:'a_unpub', 'published');
select app.set_gyan_assignment_status(:'a_unreq', 'published');
commit;
begin; select pg_temp.sign_in(:kid);
insert into app.gyan_progress (center_id, person_id, step_id, stars, completed_at) values
  (:c1, :p_kid, :s_arch, 3, now()), (:c1, :p_kid, :s_unpub, 3, now()), (:c1, :p_kid, :s_unreq, 3, now());
commit;
select pg_temp.assert(pg_temp.rows(:p_kid, 'level', :l_arch) + pg_temp.rows(:p_kid, 'level', :l_unpub) + pg_temp.rows(:p_kid, 'level', :l_unreq)
                      + pg_temp.rows(:p_kid, 'gyan_treasure', :l_arch) + pg_temp.rows(:p_kid, 'gyan_treasure', :l_unpub) + pg_temp.rows(:p_kid, 'gyan_treasure', :l_unreq) = 0,
  'every step of three levels is done, and the required homework on each holds the bonus');
begin; select pg_temp.sign_in(:contentmgr);
select app.set_gyan_assignment_status(:'a_arch', 'archived');
select app.set_gyan_assignment_status(:'a_unpub', 'draft');
select app.save_gyan_assignment(:c1, jsonb_build_object('id', :'a_unreq', 'required_for_level', false));
commit;
select pg_temp.assert(pg_temp.pts(:p_kid, 'level', :l_arch) = 20 and pg_temp.pts(:p_kid, 'gyan_treasure', :l_arch) = 10
                      and pg_temp.pts(:p_kid, 'level', :l_unpub) = 20 and pg_temp.pts(:p_kid, 'gyan_treasure', :l_unpub) = 10
                      and pg_temp.pts(:p_kid, 'level', :l_unreq) = 20 and pg_temp.pts(:p_kid, 'gyan_treasure', :l_unreq) = 10,
  'archiving, unpublishing or un-requiring the required homework pays the level''s points and treasure it was holding');
select pg_temp.assert(pg_temp.rows(:p_kid, 'level', :l_arch) = 1 and pg_temp.rows(:p_kid, 'gyan_treasure', :l_arch) = 1
                      and app.gyan_award_level_bonus(:c1, :p_kid, :l_arch) = 0 and app.gyan_award_level_bonus(:c1, :p_kid, :l_unreq) = 0,
  'once each, and never again');

-- ── Archived homework stays on the family's list, read-only, with its notes ──
begin; select pg_temp.sign_in(:contentmgr);
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'Archive me later', 'allowed_kinds', jsonb_build_array('text'), 'parent_check', 'never', 'points', 0))->>'id') as a_arc \gset
select app.set_gyan_assignment_status(:'a_arc', 'published');
commit;
begin; select pg_temp.sign_in(:kid);
select (app.save_gyan_submission_draft(:'a_arc', :p_kid, 'arc words', null)->>'id') as sub_arc \gset
select app.hand_in_gyan_submission(:'sub_arc');
commit;
begin; select pg_temp.sign_in(:classteacher);
select app.review_gyan_submission(:'sub_arc', 'send_back', 'Fix the date') as sub_arc_nw \gset
commit;
begin; select pg_temp.sign_in(:contentmgr); select app.set_gyan_assignment_status(:'a_arc', 'archived');
commit;
begin; select pg_temp.sign_in(:kid);
select app.my_gyan_homework(:c1) as hw_arc \gset
select pg_temp.assert_raises($$select app.save_gyan_submission_draft('$$ || :'a_arc' || $$', '$$ || :p_kid || $$', 'more', null)$$,
  'has been archived', 'archived homework cannot be changed...');
select pg_temp.assert_raises($$select app.hand_in_gyan_submission('$$ || :'sub_arc' || $$')$$,
  'has been archived', '...or handed in');
commit;
begin; select pg_temp.sign_in(:mom); select app.my_gyan_homework(:c1) as hw_arc_mom \gset
commit;
select pg_temp.assert((select (i->'assignment'->>'archived')::boolean and i->'submission'->>'status' = 'needs_work' and i->'submission'->>'review_note' = 'Fix the date'
                              and not (i->>'needs_parent')::boolean
                         from jsonb_array_elements(:'hw_arc'::jsonb->'items') i where i->'assignment'->>'id' = :'a_arc')
                      and (select bool_and(not (i->'assignment'->>'archived')::boolean) from jsonb_array_elements(:'hw_arc'::jsonb->'items') i where i->'assignment'->>'id' <> :'a_arc')
                      and not exists (select 1 from jsonb_array_elements(:'hw_arc'::jsonb->'items') i where i->'assignment'->>'id' = :'a_teacher')
                      and exists (select 1 from jsonb_array_elements(:'hw_arc_mom'::jsonb->'items') i where i->'assignment'->>'id' = :'a_arc' and i->>'person_id' = :p_kid),
  'archived homework with an answer stays on the list (assignment.archived, status and the teacher''s note intact; her mother sees it too); archived homework nobody answered is not listed');
-- Archived homework is read-only for the parents too: an answer waiting for a parent cannot be decided on by anyone.
begin; select pg_temp.sign_in(:contentmgr);
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'Archive me while a parent looks', 'allowed_kinds', jsonb_build_array('text'), 'parent_check', 'children', 'points', 0))->>'id') as a_arc2 \gset
select app.set_gyan_assignment_status(:'a_arc2', 'published');
commit;
begin; select pg_temp.sign_in(:kid);
select (app.save_gyan_submission_draft(:'a_arc2', :p_kid, 'arc2 words', null)->>'id') as sub_arc2 \gset
select app.hand_in_gyan_submission(:'sub_arc2') as sub_arc2_in \gset
select app.my_gyan_homework(:c1) as hw_arc2_kid_before \gset
commit;
begin; select pg_temp.sign_in(:mom); select app.my_gyan_homework(:c1) as hw_arc2_before \gset
commit;
begin; select pg_temp.sign_in(:contentmgr); select app.set_gyan_assignment_status(:'a_arc2', 'archived');
commit;
begin; select pg_temp.sign_in(:mom);
select app.my_gyan_homework(:c1) as hw_arc2_after \gset
select pg_temp.assert_raises($$select app.parent_decide_gyan_submission('$$ || :'sub_arc2' || $$', 'ok', null)$$, 'has been archived', 'a parent cannot give the OK for archived homework');
select pg_temp.assert_raises($$select app.parent_decide_gyan_submission('$$ || :'sub_arc2' || $$', 'send_back', 'x')$$, 'has been archived', 'nor send it back');
commit;
begin; select pg_temp.sign_in(:kid); select app.my_gyan_homework(:c1) as hw_arc2_kid_after \gset
commit;
begin; select pg_temp.sign_in(:principal);
select pg_temp.assert_raises($$select app.parent_decide_gyan_submission('$$ || :'sub_arc2' || $$', 'ok', null)$$, 'has been archived', 'and the office cannot release it either');
commit;
select pg_temp.assert(:'sub_arc2_in'::jsonb->>'status' = 'awaiting_parent'
                      and (select (i->>'can_parent_decide')::boolean and not (i->'assignment'->>'archived')::boolean
                             from jsonb_array_elements(:'hw_arc2_before'::jsonb->'items') i where i->'assignment'->>'id' = :'a_arc2' and i->>'person_id' = :p_kid)
                      and (select (i->>'needs_parent')::boolean from jsonb_array_elements(:'hw_arc2_kid_before'::jsonb->'items') i where i->'assignment'->>'id' = :'a_arc2')
                      and (select (i->'assignment'->>'archived')::boolean and not (i->>'can_parent_decide')::boolean and i->'submission'->>'status' = 'awaiting_parent'
                             from jsonb_array_elements(:'hw_arc2_after'::jsonb->'items') i where i->'assignment'->>'id' = :'a_arc2' and i->>'person_id' = :p_kid)
                      and (select (i->'assignment'->>'archived')::boolean and not (i->>'needs_parent')::boolean and not (i->>'can_parent_decide')::boolean
                             from jsonb_array_elements(:'hw_arc2_kid_after'::jsonb->'items') i where i->'assignment'->>'id' = :'a_arc2'),
  'once the homework is archived, an answer waiting for a parent keeps its status but can_parent_decide and needs_parent turn false; neither a parent nor the office can decide on it');

-- ── Due dates never start in the past ───────────────────────────────────────
begin; select pg_temp.sign_in(:kid);
insert into app.gyan_progress (center_id, person_id, step_id, stars, completed_at) values (:c1, :p_kid, :s_due2, 3, now() - interval '100 days');
commit;
begin; select pg_temp.sign_in(:contentmgr);
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l_due2, 'title', 'Seven days after you start', 'allowed_kinds', jsonb_build_array('text'), 'parent_check', 'never',
                                 'due_rule', '{"kind": "days_after_start", "days": 7}'::jsonb))->>'id') as a_due2 \gset
select app.set_gyan_assignment_status(:'a_due2', 'published');
commit;
begin; select pg_temp.sign_in(:kid);
select app.my_gyan_homework(:c1) as hw_due2 \gset
select (app.save_gyan_submission_draft(:'a_due2', :p_kid, 'on time', null)->>'id') as sub_due2 \gset
select app.hand_in_gyan_submission(:'sub_due2') as sub_due2_in \gset
commit;
select pg_temp.assert((select i->'assignment'->>'due_on' from jsonb_array_elements(:'hw_due2'::jsonb->'items') i where i->'assignment'->>'id' = :'a_due2') = (app.gyan_center_today(:c1) + 7)::text
                      and not (:'sub_due2_in'::jsonb->>'late')::boolean,
  'a learner who started the level 100 days before the homework was published gets seven days from the publish date, and is not late the day she hands in');

-- ── A level that has homework cannot be deleted ─────────────────────────────
select pg_temp.assert_raises($$delete from app.gyan_levels where id = '72000000-0000-4000-8000-000000000f01'$$,
  'has homework', 'a lesson level with homework cannot be deleted');
select pg_temp.assert_raises($$delete from app.gyan_goals where id = '72000000-0000-4000-8000-000000000e01'$$,
  'has homework', 'nor its goal');
select pg_temp.assert((select confdeltype from pg_constraint where conrelid = 'app.gyan_assignments'::regclass and confrelid = 'app.gyan_levels'::regclass) = 'r',
  'the foreign key is on delete restrict: no level delete can ever take homework and answers with it');
begin; select pg_temp.sign_in(:contentmgr);
select pg_temp.assert_raises($$delete from app.gyan_levels where id = '72000000-0000-4000-8000-000000000f01'$$, 'has homework', 'a content manager deleting it through the API is refused too');
delete from app.gyan_levels where id = :l_del;
commit;
select pg_temp.assert(not exists (select 1 from app.gyan_levels where id = :l_del) and (select count(*) from app.gyan_submissions where assignment_id = :'a1') > 0,
  'a level without homework can still be deleted, and nothing was deleted with the others');

-- ── Publishing a big class: one job, tells in batches, once ─────────────────
-- Five students placed in class B, each with a login, and a parent with a login and an email.
create or replace function pg_temp.u(n int, k int) returns uuid language sql immutable as $$
  select ('74000000-0000-4000-8000-' || lpad(to_hex(n * 10 + k), 12, '0'))::uuid $$;
insert into auth.users (id, email) select pg_temp.u(g, 1), 'bs' || g || '@example.com' from generate_series(1, 5) g;
insert into auth.users (id, email) select pg_temp.u(g, 2), 'bp' || g || '@example.com' from generate_series(1, 5) g;
insert into app.households (id, center_id, display_name) select pg_temp.u(g, 5), :c1, 'Bulk household ' || g from generate_series(1, 5) g;
insert into app.people (id, center_id, first_name, last_name, date_of_birth, email)
  select pg_temp.u(g, 3), :c1, 'Bs' || g, 'Bulk' || g, (current_date - interval '9 years')::date, null from generate_series(1, 5) g;
insert into app.people (id, center_id, first_name, last_name, date_of_birth, email)
  select pg_temp.u(g, 4), :c1, 'Bp' || g, 'Bulk' || g, date '1980-01-01', 'bp' || g || '@example.com' from generate_series(1, 5) g;
insert into app.household_members (household_id, person_id, center_id, role, is_primary)
  select pg_temp.u(g, 5), pg_temp.u(g, 4), :c1, 'primary', true from generate_series(1, 5) g;
insert into app.household_members (household_id, person_id, center_id, role, is_primary)
  select pg_temp.u(g, 5), pg_temp.u(g, 3), :c1, 'child', false from generate_series(1, 5) g;
insert into app.center_users (center_id, user_id, person_id) select :c1, pg_temp.u(g, 1), pg_temp.u(g, 3) from generate_series(1, 5) g;
insert into app.center_users (center_id, user_id, person_id) select :c1, pg_temp.u(g, 2), pg_temp.u(g, 4) from generate_series(1, 5) g;
insert into app.pathshala_enrollments (center_id, term_id, student_person_id, household_id, class_id, status)
  select :c1, :term1, pg_temp.u(g, 3), pg_temp.u(g, 5), :classB, 'placed' from generate_series(1, 5) g;
begin; select pg_temp.sign_in(:principal);
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'Class B bulk', 'class_id', :classB, 'allowed_kinds', jsonb_build_array('text'), 'parent_check', 'never'))->>'id') as a_bulk \gset
select app.set_gyan_assignment_status(:'a_bulk', 'published');
commit;
select pg_temp.assert((select count(*) from app.jobs where kind = 'homework.publish_notify' and payload->>'assignment_id' = :'a_bulk') = 1
                      and (select count(*) from pg_temp.msgs('homework.assigned', 'assignment_id', :'a_bulk')) = 0,
  'publishing homework for five students queues one job and creates no message at all inside the request');
begin; set local role connect_worker;
select app.worker_homework_publish_notify(:'a_bulk', 0, 2) as bulk0 \gset
select app.worker_homework_publish_notify(:'a_bulk', 2, 2) as bulk1 \gset
select app.worker_homework_publish_notify(:'a_bulk', 4, 2) as bulk2 \gset
select app.worker_homework_publish_notify(:'a_bulk', 0, 2) as bulk_retry \gset
select app.worker_homework_publish_notify(:'a_tmp', 0, 50) as bulk_draft \gset
select app.worker_homework_publish_notify('72000000-0000-4000-8000-0000000000ff', 0, 50) as bulk_gone \gset
commit;
select pg_temp.assert((:'bulk0'::jsonb->>'total')::int = 5 and (:'bulk0'::jsonb->>'learners')::int = 2 and (:'bulk0'::jsonb->>'messages')::int = 6 and not (:'bulk0'::jsonb->>'done')::boolean
                      and (:'bulk1'::jsonb->>'learners')::int = 2 and (:'bulk1'::jsonb->>'messages')::int = 6 and not (:'bulk1'::jsonb->>'done')::boolean
                      and (:'bulk2'::jsonb->>'learners')::int = 1 and (:'bulk2'::jsonb->>'messages')::int = 3 and (:'bulk2'::jsonb->>'done')::boolean,
  'the worker pages through the five learners with offset and limit (2, 2, 1): each student and each parent are told (three messages a family) and the last page says it is done');
select pg_temp.assert((select count(*) = 15 and count(distinct payload->>'learner_id') = 5 from pg_temp.msgs('homework.assigned', 'assignment_id', :'a_bulk'))
                      and (:'bulk_retry'::jsonb->>'learners')::int = 2 and (:'bulk_retry'::jsonb->>'skipped')::int = 2 and (:'bulk_retry'::jsonb->>'messages')::int = 0,
  'a retried job tells nobody twice: learners already told are skipped');
select pg_temp.assert((:'bulk_draft'::jsonb->>'total')::int = 0 and (:'bulk_draft'::jsonb->>'done')::boolean and (:'bulk_draft'::jsonb->>'reason') like '%no longer published%'
                      and (:'bulk_gone'::jsonb->>'reason') like '%no longer exists%',
  'homework that is no longer published (or gone) is told to nobody');
begin; select pg_temp.sign_in(:principal);
select app.set_gyan_assignment_status(:'a_bulk', 'draft');
select app.set_gyan_assignment_status(:'a_bulk', 'published');
commit;
begin; set local role connect_worker;
select app.worker_homework_publish_notify(:'a_bulk', 0, 200) as bulk_again \gset
commit;
select pg_temp.assert((select count(*) from app.jobs where kind = 'homework.publish_notify' and payload->>'assignment_id' = :'a_bulk') = 2
                      and (select count(*) from pg_temp.msgs('homework.assigned', 'assignment_id', :'a_bulk')) = 15
                      and (:'bulk_again'::jsonb->>'learners')::int = 5 and (:'bulk_again'::jsonb->>'skipped')::int = 5 and (:'bulk_again'::jsonb->>'messages')::int = 0,
  'publishing again after an unpublish queues another job, and it tells nobody twice: all five are already told');
-- Publish, unpublish while the job runs, publish again: everyone is told, exactly once.
begin; select pg_temp.sign_in(:principal);
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'Class B toggled', 'class_id', :classB, 'allowed_kinds', jsonb_build_array('text'), 'parent_check', 'never'))->>'id') as a_tog \gset
select app.set_gyan_assignment_status(:'a_tog', 'published');
select app.set_gyan_assignment_status(:'a_tog', 'draft');
commit;
begin; set local role connect_worker;
select app.worker_homework_publish_notify(:'a_tog', 0, 50) as tog_draft \gset
commit;
begin; select pg_temp.sign_in(:principal);
select app.set_gyan_assignment_status(:'a_tog', 'published');
commit;
begin; set local role connect_worker;
select app.worker_homework_publish_notify(:'a_tog', 0, 50) as tog_second \gset
commit;
select pg_temp.assert((:'tog_draft'::jsonb->>'reason') like '%no longer published%' and (:'tog_draft'::jsonb->>'messages')::int = 0
                      and (select count(*) from pg_temp.msgs('homework.assigned', 'assignment_id', :'a_tog')) = 15
                      and (:'tog_second'::jsonb->>'learners')::int = 5 and (:'tog_second'::jsonb->>'messages')::int = 15
                      and (select count(*) from app.jobs where kind = 'homework.publish_notify' and payload->>'assignment_id' = :'a_tog') = 2,
  'publish, unpublish while the first job runs (it finishes "no longer published"), publish again: the second job tells all five learners and their parents, exactly once');
-- Toggle spam: more rounds, more jobs, no more messages.
begin; select pg_temp.sign_in(:principal);
select app.set_gyan_assignment_status(:'a_tog', 'draft');
select app.set_gyan_assignment_status(:'a_tog', 'published');
select app.set_gyan_assignment_status(:'a_tog', 'draft');
select app.set_gyan_assignment_status(:'a_tog', 'published');
select app.set_gyan_assignment_status(:'a_tog', 'draft');
select app.set_gyan_assignment_status(:'a_tog', 'published');
commit;
begin; set local role connect_worker;
select jsonb_agg(app.worker_homework_publish_notify(:'a_tog', 0, 50)) as tog_runs from generate_series(1, 5) \gset
commit;
select pg_temp.assert((select count(*) from app.jobs where kind = 'homework.publish_notify' and payload->>'assignment_id' = :'a_tog') = 5
                      and (select count(*) from pg_temp.msgs('homework.assigned', 'assignment_id', :'a_tog')) = 15
                      and (select bool_and((r->>'messages')::int = 0 and (r->>'skipped')::int = 5) from jsonb_array_elements(:'tog_runs'::jsonb) r)
                      and (select count(*) from jsonb_array_elements(:'tog_runs'::jsonb)) = 5,
  'five toggles queue five cheap jobs and no second round of messages: every run finds everyone already told');

-- ── The audit log and the message queue hold no child's words ───────────────
select pg_temp.assert((select bool_and(coalesce(after->>'text_answer', '*** (0 characters)') ~ '^\*\*\* \(\d+ characters\)$'
                                       and coalesce(before->>'text_answer', '*** (0 characters)') ~ '^\*\*\* \(\d+ characters\)$'
                                       and coalesce(after->>'parent_note', '*** (0 characters)') ~ '^\*\*\* \(\d+ characters\)$'
                                       and coalesce(before->>'parent_note', '*** (0 characters)') ~ '^\*\*\* \(\d+ characters\)$'
                                       and coalesce(after->>'review_note', '*** (0 characters)') ~ '^\*\*\* \(\d+ characters\)$'
                                       and coalesce(before->>'review_note', '*** (0 characters)') ~ '^\*\*\* \(\d+ characters\)$')
                         from app.audit_log where record_table = 'gyan_submissions')
                      and (select count(*) from app.audit_log where record_table = 'gyan_submissions' and record_id = :'sub1') >= 8
                      and not exists (select 1 from app.audit_log where record_table = 'gyan_submissions' and (coalesce(before::text, '') || coalesce(after::text, '')) ~* '(Namo|slower|mantra|Much better|Well done|Still good|family should read)')
                      and (select after->>'text_answer' from app.audit_log where record_table = 'gyan_submissions' and record_id = :'sub1' and after->>'text_answer' is not null order by id desc limit 1) = '*** (32 characters)'
                      and (select after->>'review_note' from app.audit_log where record_table = 'gyan_submissions' and record_id = :'sub1' and after->>'review_note' is not null order by id desc limit 1) = '*** (10 characters)',
  'the audit log keeps who and when and how long, never the child''s written answer, the parent''s note or the teacher''s note');
select pg_temp.assert((select bool_and((coalesce(after->>'storage_path', '') = '' or after->>'storage_path' ~ '/\*\*\*$') and (coalesce(before->>'storage_path', '') = '' or before->>'storage_path' ~ '/\*\*\*$'))
                         from app.audit_log where record_table = 'gyan_submission_files')
                      and (select count(*) from app.audit_log where record_table = 'gyan_submission_files' and after->>'storage_path' like (:prefix || :'sub1' || '/***')) >= 2
                      and not exists (select 1 from app.audit_log where record_table = 'gyan_submission_files' and (coalesce(before::text, '') || coalesce(after::text, '')) ~ '\.(m4a|jpg)'),
  'a part''s file name is masked in the audit log; its folder (the answer) is not');
begin; select pg_temp.sign_in(:treasurer);
select count(*) as n_hist from app.record_history('gyan_submissions', :'sub1') h where h.after->>'text_answer' = '*** (32 characters)' \gset
select count(*) as n_hist_bad from app.record_history('gyan_submissions', :'sub1') h where (coalesce(h.before::text, '') || coalesce(h.after::text, '')) ~* '(Namo|slower|mantra|Much better|Well done)' \gset
select count(*) as n_audit_seen from app.audit_log where record_table = 'gyan_submissions' and record_id = :'sub1' \gset
commit;
select pg_temp.assert(:n_hist::int >= 1 and :n_hist_bad::int = 0 and :n_audit_seen::int >= 8,
  'a treasurer (audit.view) sees the masked history of the answer, in the audit log and in record_history');
begin; select pg_temp.sign_in(:commsuser);
select count(*) as n_msgs_seen from app.messages where template_key like 'homework.%' \gset
select count(*) as n_msgs_bad from app.messages where template_key like 'homework.%'
   and ((coalesce(body, '') || coalesce(subject, '') || payload::text) ~* '(slower|mantra|Much better|Well done|Fix the date)' or payload->'vars' ? 'note') \gset
commit;
select pg_temp.assert(:n_msgs_seen::int > 20 and :n_msgs_bad::int = 0,
  'whoever can read the message queue (comms.view) reads no note: not in a body, a subject or the payload''s variables');
select pg_temp.assert(not exists (select 1 from app.messages where template_key like 'homework.%' and (payload->'vars' ? 'note' or payload ? 'note')),
  'and no homework message of any kind carries a note variable');

-- ── Odds and ends: who may ask what an assignment's reviewer is ─────────────
begin; select pg_temp.sign_in(:other);
select coalesce(app.gyan_assignment_reviewer(:'a1'), '(nothing)') as rv_other \gset
commit;
begin; select pg_temp.sign_in(:neighbor);
select app.gyan_assignment_reviewer(:'a1') as rv_nb \gset
select app.gyan_assignment_reviewer(:'a_content') as rv_nb2 \gset
commit;
select pg_temp.assert(:'rv_other' = '(nothing)' and :'rv_nb' = 'teacher' and :'rv_nb2' = 'content',
  'a member of another community learns nothing of an assignment''s reviewer; members of its community do');

-- ── The module switch ──────────────────────────────────────────────────────
update app.center_modules set enabled = false where center_id = :c1 and module_key = 'gyan_path';
insert into app.center_modules (center_id, module_key, enabled, reason) select :c1, 'gyan_path', false, 'test 72'
 where not exists (select 1 from app.center_modules where center_id = :c1 and module_key = 'gyan_path');
begin;
select pg_temp.sign_in(:kid);
select pg_temp.assert_raises($$select app.my_gyan_homework('72000000-0000-4000-8000-0000000000c1')$$, 'switched off', 'with Gyan Path off the homework screen refuses');
select pg_temp.assert_raises($$select app.save_gyan_submission_draft('$$ || :'a_days' || $$', '$$ || :p_kid || $$', 'x', null)$$, 'switched off', 'and so does saving a draft');
select pg_temp.assert((select count(*) from app.gyan_assignments) = 0 and pg_temp.reads(:'sub1') = '0/0/0',
  'with Gyan Path off the homework, the answers and the bucket are hidden');
commit;
begin;
select pg_temp.sign_in(:contentmgr);
select pg_temp.assert_raises($$select app.save_gyan_assignment('72000000-0000-4000-8000-0000000000c1', '{"level_id": "72000000-0000-4000-8000-000000000f01", "title": "While off"}')$$,
  'switched off', 'nor can homework be set');
commit;
update app.center_modules set enabled = true where center_id = :c1 and module_key = 'gyan_path';

-- ── Retention ──────────────────────────────────────────────────────────────
begin;
update app.centers set rules = jsonb_set(coalesce(rules, '{}'), '{storage}', '{"retention_days":{"homework":30}}') where id = :c1;
select pg_temp.assert(app.storage_retention_days('homework', :c1) = 30 and app.storage_retention_days('homework', :c2) = 365,
  'a community may keep homework files for its own number of days');
rollback;
update storage.objects set created_at = now() - interval '400 days' where bucket_id = 'homework' and name = :prefix || :'sub1' || '/e1000000-0000-4000-8000-000000000004.m4a';
begin;
set local role connect_worker;
select pg_temp.assert((select array_agg(name || '|' || retention_days) from app.storage_expired_objects(100) where bucket_id = 'homework') = array[:prefix || :'sub1' || '/e1000000-0000-4000-8000-000000000004.m4a|365'],
  'the 400-day-old homework file is due; the fresh ones are not');
select pg_temp.assert(app.record_storage_deletions(99, (select jsonb_agg(jsonb_build_object('bucket', bucket_id, 'name', name, 'created_at', created_at))
                                                          from app.storage_expired_objects(100) where bucket_id = 'homework')) = 1, 'the deletion is recorded');
commit;
-- A batch that mixes buckets: the homework reason must not stick to the recordings update that follows it.
update app.gyan_progress set recording_path = :prefix || 'step-72.m4a' where person_id = :p_kid and step_id = :s1;
begin;
set local role connect_worker;
select app.record_storage_deletions(98, jsonb_build_array(
         jsonb_build_object('bucket', 'homework', 'name', :prefix || :'sub1' || '/e1000000-0000-4000-8000-000000000015.jpg', 'created_at', now() - interval '400 days'),
         jsonb_build_object('bucket', 'recordings', 'name', :prefix || 'step-72.m4a', 'created_at', now() - interval '100 days'))) as n_mixed \gset
commit;
select pg_temp.assert(:'n_mixed'::int = 2 and (select recording_path is null from app.gyan_progress where person_id = :p_kid and step_id = :s1)
                      and (select count(*) = 1 and bool_and(coalesce(reason, '') not like 'Retention: homework%')
                             from app.audit_log
                            where record_table = 'gyan_progress' and action = 'gyan_progress.update'
                              and before->>'recording_path' = (:prefix || 'step-72.m4a') and after->>'recording_path' is null),
  'a batch that mixes buckets: the homework reason does not stick to the recordings update that follows it');
delete from storage.objects where bucket_id = 'homework' and name = :prefix || :'sub1' || '/e1000000-0000-4000-8000-000000000004.m4a';
select pg_temp.assert((select storage_path is null and deleted_at is not null and kind = 'voice' and bytes = 3333 from app.gyan_submission_files where submission_id = :'sub1' and mime_type = 'audio/mp4' and bytes = 3333),
  'the file row loses its path and is marked deleted');
select pg_temp.assert((select status = 'accepted' and points_awarded = 15 and review_note = 'Still good' and parent_note = 'Much better' from app.gyan_submissions where id = :'sub1'),
  'the answer, its notes and its points stay');
select pg_temp.assert((select reason like 'Retention: homework files are kept 365 days (job 99)%' and client_app = 'job' and center_id = :c1::uuid
                              and before->>'name' = (:prefix || :'sub1' || '/***')
                         from app.audit_log where action = 'storage.retention_delete' and record_id = 'homework/' || :prefix || :'sub1' || '/***' and reason like '%(job 99)%'),
  'the removal has its audit entry with the rule that removed it, and the entry keeps the answer''s folder but not the file name');
begin;
select pg_temp.sign_in(:kid);
select app.my_gyan_homework(:c1) as hw_kid2 \gset
commit;
select pg_temp.assert((select f->>'storage_path' is null and f->>'deleted_at' is not null
                         from jsonb_array_elements(:'hw_kid2'::jsonb->'items') i, jsonb_array_elements(i->'submission'->'files') f
                        where i->'assignment'->>'id' = :'a1'),
  'the app sees the part as gone (deleted_at) rather than a broken link');
delete from storage.objects where bucket_id = 'homework';
delete from app.jobs where kind = 'storage.scan' and payload->>'bucket' = 'homework';
