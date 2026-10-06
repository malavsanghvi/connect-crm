-- 0587: learning assignments (homework) with parent validation.
-- Who may create homework (content.manage / pathshala.manage everywhere; a class Teacher only for their own class)
-- and every field's plain-English refusal; draft → published → archived (back to draft only before the first
-- answer); publishing tells the learners and the parents of children; the learner's view; drafts and their parts
-- (allowed kinds, the file limit, the path rule, the bucket's own write rule); handing in: a child from their own
-- login waits for a parent, an adult does not, a parent handing in for a child does not; a parent of another
-- household cannot decide; the parent's send-back and OK; who reviews (the class Teacher of a placed class yes,
-- the Teacher of another class and of a past class no, and they READ NOTHING, table and bucket; pathshala.teach,
-- pathshala.manage and the content reviewer rule); points paid once and never again on resubmit or re-accept; a
-- required homework holds the level bonus until it is accepted, and accepting the last one pays it; due dates
-- (late, never refused); the module switch; retention nulls the file row's path; templates; audit; coverage.
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
                         and key in ('homework.assigned', 'homework.parent_check', 'homework.sent_back_parent', 'homework.submitted', 'homework.accepted', 'homework.sent_back')) = 12,
  'the six homework templates are seeded as push and email platform defaults');
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
select pg_temp.assert((select count(*) from pg_temp.msgs('homework.assigned', 'assignment_id', :'a_class')) = 0,
  'homework for class B tells nobody: the class has no students');
select pg_temp.assert((select count(*) from pg_temp.msgs('homework.assigned', 'assignment_id', :'a_req')) = 0,
  'homework on a level nobody has started tells nobody (the level screen shows it)');
begin;
select pg_temp.sign_in(:classteacher);
select app.set_gyan_assignment_status(:'a_teacher', 'published');
select app.set_gyan_assignment_status(:'a_teacher', 'draft');
select app.set_gyan_assignment_status(:'a_teacher', 'published');
select app.set_gyan_assignment_status(:'a_teacher', 'archived') as a_teacher_arch \gset
select pg_temp.assert_raises($$select app.set_gyan_assignment_status('$$ || :'a_teacher' || $$', 'published')$$,
  'Archived homework stays archived', 'archived homework cannot come back');
select pg_temp.assert_raises($$select app.set_gyan_assignment_status('$$ || :'a_teacher' || $$', 'draft')$$,
  'Archived homework stays archived', 'nor go back to a draft');
commit;
select pg_temp.assert((select count(*) filter (where channel = 'push') = 6 and count(*) filter (where channel = 'email') = 2 from pg_temp.msgs('homework.assigned', 'assignment_id', :'a_teacher')),
  'homework for class A reaches its student (and her parents) each time it is published');
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
                                             'due_on', null, 'parent_check', 'children', 'class_id', null),
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
insert into storage.objects (bucket_id, name, metadata) values ('homework', :prefix || :'sub1' || '/note.m4a', '{"size": 1234, "mimetype": "audio/mp4"}');
select pg_temp.assert(true, 'homework bucket: the child uploads into her answer''s folder');
select pg_temp.assert_raises($$insert into storage.objects (bucket_id, name) values ('homework', '72000000-0000-4000-8000-0000000000c1/72000000-0000-4000-8000-0000000000a7/$$ || :'sub1' || $$/x.jpg')$$,
  'row-level security', 'homework bucket: not into her brother''s folder');
select pg_temp.assert_raises($$insert into storage.objects (bucket_id, name) values ('homework', '72000000-0000-4000-8000-0000000000c1/72000000-0000-4000-8000-0000000000a3/72000000-0000-4000-8000-0000000000ee/x.jpg')$$,
  'row-level security', 'homework bucket: not under an answer that does not exist');
select pg_temp.assert_raises($$insert into storage.objects (bucket_id, name) values ('homework', '72000000-0000-4000-8000-0000000000c1/72000000-0000-4000-8000-0000000000a3/$$ || :'sub1' || $$/deep/x.jpg')$$,
  'row-level security', 'homework bucket: not deeper than the answer''s folder');
select pg_temp.assert_raises($$insert into storage.objects (bucket_id, name) values ('homework', '72000000-0000-4000-8000-0000000000c2/72000000-0000-4000-8000-0000000000a3/$$ || :'sub1' || $$/x.jpg')$$,
  'row-level security', 'homework bucket: not under another community');
commit;
begin;
select pg_temp.sign_in(:mom);
insert into storage.objects (bucket_id, name, metadata) values ('homework', :prefix || :'sub1' || '/photo.jpg', '{"size": 999, "mimetype": "image/jpeg"}');
select pg_temp.assert(true, 'homework bucket: a parent uploads into the child''s answer');
commit;
begin;
select pg_temp.sign_in(:neighbor);
select pg_temp.assert_raises($$insert into storage.objects (bucket_id, name) values ('homework', '72000000-0000-4000-8000-0000000000c1/72000000-0000-4000-8000-0000000000a3/$$ || :'sub1' || $$/nb.jpg')$$,
  'row-level security', 'homework bucket: another family cannot upload into it');
commit;
begin;
select pg_temp.sign_in(:classteacher);
select pg_temp.assert_raises($$insert into storage.objects (bucket_id, name) values ('homework', '72000000-0000-4000-8000-0000000000c1/72000000-0000-4000-8000-0000000000a3/$$ || :'sub1' || $$/t.jpg')$$,
  'row-level security', 'homework bucket: the teacher reads, never writes');
commit;
select pg_temp.assert((select count(*) from app.jobs where kind = 'storage.scan' and payload->>'bucket' = 'homework' and payload->>'name' like '%' || :'sub1' || '%') = 2,
  'every homework upload queues a malware scan');
begin;
select pg_temp.sign_in(:kid);
select pg_temp.assert_raises($$select app.save_gyan_submission_draft('$$ || :'a1' || $$', '$$ || :p_kid || $$', 'Namo', '{"kind": "voice"}')$$,
  'must be a list', 'the files must be a list');
select pg_temp.assert_raises($$select app.save_gyan_submission_draft('$$ || :'a1' || $$', '$$ || :p_kid || $$', 'Namo', jsonb_build_array(jsonb_build_object('kind', 'file', 'storage_path', '$$ || :prefix || :'sub1' || $$/a.pdf', 'mime_type', 'application/pdf', 'bytes', 10)))$$,
  'does not take a file answer', 'a kind the homework does not allow is refused');
select pg_temp.assert_raises($$select app.save_gyan_submission_draft('$$ || :'a1' || $$', '$$ || :p_kid || $$', 'Namo', jsonb_build_array(
    jsonb_build_object('kind', 'photo', 'storage_path', '$$ || :prefix || :'sub1' || $$/1.jpg', 'mime_type', 'image/jpeg', 'bytes', 10),
    jsonb_build_object('kind', 'photo', 'storage_path', '$$ || :prefix || :'sub1' || $$/2.jpg', 'mime_type', 'image/jpeg', 'bytes', 10),
    jsonb_build_object('kind', 'photo', 'storage_path', '$$ || :prefix || :'sub1' || $$/3.jpg', 'mime_type', 'image/jpeg', 'bytes', 10)))$$,
  'at most 2 files', 'more parts than the homework allows are refused');
select pg_temp.assert_raises($$select app.save_gyan_submission_draft('$$ || :'a1' || $$', '$$ || :p_kid || $$', 'Namo', jsonb_build_array(jsonb_build_object('kind', 'photo', 'storage_path', '$$ || :prefix || $$72000000-0000-4000-8000-0000000000ee/1.jpg', 'mime_type', 'image/jpeg', 'bytes', 10)))$$,
  'its path must be', 'a part outside the answer''s own folder is refused');
select pg_temp.assert_raises($$select app.save_gyan_submission_draft('$$ || :'a1' || $$', '$$ || :p_kid || $$', 'Namo', jsonb_build_array(jsonb_build_object('kind', 'photo', 'storage_path', '$$ || :prefix || :'sub1' || $$/1.txt', 'mime_type', 'text/plain', 'bytes', 10)))$$,
  'not a file type this homework takes for a photo', 'a text file is not a photo');
select pg_temp.assert_raises($$select app.save_gyan_submission_draft('$$ || :'a1' || $$', '$$ || :p_kid || $$', 'Namo', jsonb_build_array(jsonb_build_object('kind', 'voice', 'storage_path', '$$ || :prefix || :'sub1' || $$/n.m4a', 'mime_type', 'audio/mp4', 'bytes', 30000000)))$$,
  'at most 25 MB', 'a part over 25 MB is refused');
select pg_temp.assert_raises($$select app.save_gyan_submission_draft('$$ || :'a1' || $$', '$$ || :p_kid || $$', 'Namo', jsonb_build_array(
    jsonb_build_object('kind', 'photo', 'storage_path', '$$ || :prefix || :'sub1' || $$/1.jpg', 'mime_type', 'image/jpeg', 'bytes', 10),
    jsonb_build_object('kind', 'photo', 'storage_path', '$$ || :prefix || :'sub1' || $$/1.jpg', 'mime_type', 'image/jpeg', 'bytes', 10)))$$,
  'listed twice', 'the same part twice is refused');
select pg_temp.assert_raises($$select app.save_gyan_submission_draft('$$ || :'a1' || $$', '$$ || :p_kid || $$', repeat('x', 2001), null)$$,
  'at most 2,000 characters', 'a written answer over 2,000 characters is refused');
select app.save_gyan_submission_draft(:'a1', :p_kid, ' Namo Arihantanam ', jsonb_build_array(
         jsonb_build_object('kind', 'voice', 'storage_path', :prefix || :'sub1' || '/note.m4a', 'mime_type', 'audio/mp4', 'bytes', 1234, 'duration_seconds', 12.4),
         jsonb_build_object('kind', 'photo', 'storage_path', :prefix || :'sub1' || '/photo.jpg', 'mime_type', 'image/jpeg', 'bytes', 999))) as sub1v2 \gset
commit;
select pg_temp.assert(:'sub1v2'::jsonb->>'text_answer' = 'Namo Arihantanam' and jsonb_array_length(:'sub1v2'::jsonb->'files') = 2
                      and :'sub1v2'::jsonb->'files'->0->>'kind' = 'voice' and (:'sub1v2'::jsonb->'files'->0->>'duration_seconds')::int = 12
                      and :'sub1v2'::jsonb->'files'->1->>'storage_path' = :prefix || :'sub1' || '/photo.jpg' and :'sub1v2'::jsonb->'files'->1->'deleted_at' = 'null'::jsonb
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
select pg_temp.assert_raises($$insert into storage.objects (bucket_id, name) values ('homework', '$$ || :prefix || :'sub1' || $$/late.jpg')$$,
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
select pg_temp.assert((select count(*) = 1 and bool_and(channel = 'push' and to_address = :kid and payload->>'type' = 'homework' and body like '%Say it a little slower.%')
                         from pg_temp.msgs('homework.sent_back_parent', 'submission_id', :'sub1')),
  'the child is told by push, with the note');
begin;
select pg_temp.sign_in(:kid);
insert into storage.objects (bucket_id, name, metadata) values ('homework', :prefix || :'sub1' || '/note2.m4a', '{"size": 2222, "mimetype": "audio/mp4"}');
select app.save_gyan_submission_draft(:'a1', :p_kid, 'Namo Arihantanam', jsonb_build_array(
         jsonb_build_object('kind', 'voice', 'storage_path', :prefix || :'sub1' || '/note2.m4a', 'mime_type', 'audio/mp4', 'bytes', 2222, 'duration_seconds', 20),
         jsonb_build_object('kind', 'photo', 'storage_path', :prefix || :'sub1' || '/photo.jpg', 'mime_type', 'image/jpeg', 'bytes', 999)));
select app.hand_in_gyan_submission(:'sub1') as sub1in2 \gset
commit;
select pg_temp.assert(:'sub1in2'::jsonb->>'status' = 'awaiting_parent' and (:'sub1in2'::jsonb->>'attempt')::int = 1,
  'after a parent''s send-back the child changes it and hands it in again (same attempt)');
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
select pg_temp.assert(:'r_class' = '1/2/3' and :'r_center' = '1/2/3' and :'r_principal' = '1/2/3',
  'the Teacher of her class, a center-wide teacher (pathshala.teach) and the principal (pathshala.manage) read them');
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
                          and bool_and(body like '%Add the last line of the mantra.%')
                         from pg_temp.msgs('homework.sent_back', 'submission_id', :'sub1')),
  'the child AND her parents are told, with the note (feedback is never only the child''s)');
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
insert into storage.objects (bucket_id, name, metadata) values ('homework', :prefix || :'sub1' || '/note3.m4a', '{"size": 3333, "mimetype": "audio/mp4"}');
select pg_temp.assert(true, 'homework bucket: the child uploads again once it was sent back');
select app.save_gyan_submission_draft(:'a1', :p_kid, 'Namo Arihantanam, Namo Siddhanam', jsonb_build_array(
         jsonb_build_object('kind', 'voice', 'storage_path', :prefix || :'sub1' || '/note3.m4a', 'mime_type', 'audio/mp4', 'bytes', 3333, 'duration_seconds', 30))) as sub1v3 \gset
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
                         from pg_temp.msgs('homework.accepted', 'submission_id', :'sub1')),
  'the child and her parents are told it was accepted');
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
select pg_temp.assert_raises($$insert into storage.objects (bucket_id, name) values ('homework', '$$ || :prefix || :'sub1' || $$/more.jpg')$$,
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
update storage.objects set created_at = now() - interval '400 days' where bucket_id = 'homework' and name = :prefix || :'sub1' || '/note3.m4a';
begin;
set local role connect_worker;
select pg_temp.assert((select array_agg(name || '|' || retention_days) from app.storage_expired_objects(100) where bucket_id = 'homework') = array[:prefix || :'sub1' || '/note3.m4a|365'],
  'the 400-day-old homework file is due; the fresh ones are not');
select pg_temp.assert(app.record_storage_deletions(99, (select jsonb_agg(jsonb_build_object('bucket', bucket_id, 'name', name, 'created_at', created_at))
                                                          from app.storage_expired_objects(100) where bucket_id = 'homework')) = 1, 'the deletion is recorded');
commit;
-- A batch that mixes buckets: the homework reason must not stick to the recordings update that follows it.
update app.gyan_progress set recording_path = :prefix || 'step-72.m4a' where person_id = :p_kid and step_id = :s1;
begin;
set local role connect_worker;
select app.record_storage_deletions(98, jsonb_build_array(
         jsonb_build_object('bucket', 'homework', 'name', :prefix || :'sub1' || '/gone.jpg', 'created_at', now() - interval '400 days'),
         jsonb_build_object('bucket', 'recordings', 'name', :prefix || 'step-72.m4a', 'created_at', now() - interval '100 days'))) as n_mixed \gset
commit;
select pg_temp.assert(:'n_mixed'::int = 2 and (select recording_path is null from app.gyan_progress where person_id = :p_kid and step_id = :s1)
                      and (select count(*) = 1 and bool_and(coalesce(reason, '') not like 'Retention: homework%')
                             from app.audit_log
                            where record_table = 'gyan_progress' and action = 'gyan_progress.update'
                              and before->>'recording_path' = (:prefix || 'step-72.m4a') and after->>'recording_path' is null),
  'a batch that mixes buckets: the homework reason does not stick to the recordings update that follows it');
delete from storage.objects where bucket_id = 'homework' and name = :prefix || :'sub1' || '/note3.m4a';
select pg_temp.assert((select storage_path is null and deleted_at is not null and kind = 'voice' and bytes = 3333 from app.gyan_submission_files where submission_id = :'sub1' and mime_type = 'audio/mp4' and bytes = 3333),
  'the file row loses its path and is marked deleted');
select pg_temp.assert((select status = 'accepted' and points_awarded = 15 and review_note = 'Still good' and parent_note = 'Much better' from app.gyan_submissions where id = :'sub1'),
  'the answer, its notes and its points stay');
select pg_temp.assert((select reason like 'Retention: homework files are kept 365 days (job 99)%' and client_app = 'job' and center_id = :c1::uuid
                         from app.audit_log where action = 'storage.retention_delete' and record_id = 'homework/' || :prefix || :'sub1' || '/note3.m4a'),
  'the removal has its audit entry with the rule that removed it');
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
