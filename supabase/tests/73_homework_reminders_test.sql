-- 0588: a reminder before homework is due, to the learners who have not handed it in (owner request 2026-10-06).
-- The new columns, table, function and template, and who may call and read what; every plain-English refusal of the
-- reminder's hours (no due date, 0, 721, not a whole number) in the function and in the table's own guard; when the
-- hours were set (remind_set_at follows the hours, never the title or the due date). The sweep: a learner with no answer,
-- a draft or a sent-back answer is reminded once at the right time, an answer waiting for a parent, with the teacher or
-- accepted is not; the household adults of a child are told, an adult learner alone (never the spouse); a class's
-- homework reminds its students only, homework for everyone the members who started the level (never a deceased one);
-- "days after start" counts per learner; nothing before the reminder time, after the due moment, when the time came
-- before the homework was published or the hours were set, for archived or draft homework, with the community's switch
-- off or the module off; changing the hours never reminds twice for one due date, moving the due date does; quiet hours
-- hold a reminder until they end, unless they end after the due moment (then the email goes at once and the push when
-- they end); a hand-in cancels the reminder that has not gone out (and the messaging job skips it), never one already
-- sent; a second run sends nothing. The time zone of the test community is chosen so that it is about noon there: the
-- due moments (midnight) are hours away whenever the test runs.
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
-- The SQLSTATE a statement fails with ('OK' when it does not): a refusal must be ours (22023), never a raw error.
create or replace function pg_temp.state_of(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'OK';
exception when others then return sqlstate;
end $$;
-- The reminder messages of one homework.
create or replace function pg_temp.rm(p_assignment text) returns setof app.messages language sql stable as $$
  select * from app.messages where template_key = 'homework.due_soon' and payload->>'assignment_id' = p_assignment $$;
-- The reminder log rows of one homework, as "learner|due date|hours|messages", in order.
create or replace function pg_temp.log(p_assignment text) returns text[] language sql stable as $$
  select coalesce(array_agg(person_id::text || '|' || due_on::text || '|' || remind_hours || '|' || messages order by person_id, due_on), '{}')
    from app.gyan_homework_reminders where assignment_id = p_assignment::uuid $$;
-- The tests switch to connect_worker; a hosted postgres holds ADMIN on it but not SET.
grant connect_worker to postgres;

-- ── Fixtures ───────────────────────────────────────────────────────────────
\set c1 '''73000000-0000-4000-8000-0000000000c1'''
\set c2 '''73000000-0000-4000-8000-0000000000c2'''
\set mom '''73000000-0000-4000-8000-000000000001'''
\set dad '''73000000-0000-4000-8000-000000000002'''
\set kid '''73000000-0000-4000-8000-000000000003'''
\set solo '''73000000-0000-4000-8000-000000000004'''
\set asha '''73000000-0000-4000-8000-000000000005'''
\set dev '''73000000-0000-4000-8000-000000000006'''
\set pc '''73000000-0000-4000-8000-000000000007'''
\set contentmgr '''73000000-0000-4000-8000-000000000008'''
\set classteacher '''73000000-0000-4000-8000-000000000009'''
\set nb '''73000000-0000-4000-8000-00000000000a'''
\set kiran '''73000000-0000-4000-8000-00000000000b'''
\set p_mom '''73000000-0000-4000-8000-0000000000a1'''
\set p_dad '''73000000-0000-4000-8000-0000000000a2'''
\set p_kid '''73000000-0000-4000-8000-0000000000a3'''
\set p_solo '''73000000-0000-4000-8000-0000000000a4'''
\set p_asha '''73000000-0000-4000-8000-0000000000a5'''
\set p_dev '''73000000-0000-4000-8000-0000000000a6'''
\set p_pc '''73000000-0000-4000-8000-0000000000a7'''
\set p_kidc '''73000000-0000-4000-8000-0000000000a8'''
\set p_nb '''73000000-0000-4000-8000-0000000000a9'''
\set p_kiran '''73000000-0000-4000-8000-0000000000aa'''
\set p_dead '''73000000-0000-4000-8000-0000000000ab'''
\set h1 '''73000000-0000-4000-8000-0000000000b1'''
\set h2 '''73000000-0000-4000-8000-0000000000b2'''
\set h3 '''73000000-0000-4000-8000-0000000000b3'''
\set h4 '''73000000-0000-4000-8000-0000000000b4'''
\set h5 '''73000000-0000-4000-8000-0000000000b5'''
\set h6 '''73000000-0000-4000-8000-0000000000b6'''
\set h7 '''73000000-0000-4000-8000-0000000000b7'''
\set term '''73000000-0000-4000-8000-000000000a01'''
\set track '''73000000-0000-4000-8000-000000000a02'''
\set plevel '''73000000-0000-4000-8000-000000000a03'''
\set classX '''73000000-0000-4000-8000-000000000a04'''
\set g1 '''73000000-0000-4000-8000-000000000e01'''
\set g2 '''73000000-0000-4000-8000-000000000e02'''
\set l1 '''73000000-0000-4000-8000-000000000f01'''
\set ld '''73000000-0000-4000-8000-000000000f02'''
\set l2 '''73000000-0000-4000-8000-000000000f03'''
\set s1 '''73000000-0000-4000-8000-000000000d01'''
\set sd '''73000000-0000-4000-8000-000000000d02'''
\set s2 '''73000000-0000-4000-8000-000000000d03'''
\set a_c2 '''73000000-0000-4000-8000-000000000c01'''

-- A fixed-offset zone where it is about noon now (Etc/GMT-N is N hours ahead of UTC).
select case when k > 0 then 'Etc/GMT-' || k when k < 0 then 'Etc/GMT+' || (-k) else 'Etc/GMT' end as tz73
  from (select 12 - extract(hour from now() at time zone 'UTC')::int as k) x \gset

insert into auth.users (id, email) values
  (:mom, 'mom73@example.com'), (:dad, 'dad73@example.com'), (:kid, 'kid73@example.com'), (:solo, 'solo73@example.com'),
  (:asha, 'asha73@example.com'), (:dev, 'dev73@example.com'), (:pc, 'pc73@example.com'), (:contentmgr, 'content73@example.com'),
  (:classteacher, 'classteacher73@example.com'), (:nb, 'nb73@example.com'), (:kiran, 'kiran73@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone, rules) values
  (:c1, 'hw73', 'Reminders 73 Community', 'R73', 'TX', 'active', :'tz73', '{"notifications": {"quiet_start_hour": 0, "quiet_end_hour": 0}}'),
  (:c2, 'hw73b', 'Other 73 Community', 'R73B', 'TX', 'active', :'tz73', '{"notifications": {"quiet_start_hour": 0, "quiet_end_hour": 0}}');
insert into app.households (id, center_id, display_name) values
  (:h1, :c1, 'Shah household 73'), (:h2, :c1, 'Jain household 73'), (:h3, :c1, 'Mehta household 73'), (:h4, :c1, 'Doshi household 73'),
  (:h5, :c1, 'Patel household 73'), (:h6, :c1, 'Vakil household 73'), (:h7, :c2, 'Vora household 73');
insert into app.people (id, center_id, first_name, last_name, date_of_birth, email) values
  (:p_mom, :c1, 'Mira', 'Shah', date '1982-01-01', 'mom73@example.com'),
  (:p_dad, :c1, 'Raj', 'Shah', date '1980-01-01', null),
  (:p_kid, :c1, 'Anya', 'Shah', (current_date - interval '10 years')::date, null),
  (:p_solo, :c1, 'Solo', 'Jain', date '1975-05-05', 'solo73@example.com'),
  (:p_asha, :c1, 'Asha', 'Mehta', date '1985-02-02', 'asha73@example.com'),
  (:p_dev, :c1, 'Dev', 'Mehta', date '1984-03-03', 'dev73@example.com'),
  (:p_pc, :c1, 'Pooja', 'Doshi', date '1983-04-04', 'pc73@example.com'),
  (:p_kidc, :c1, 'Kavi', 'Doshi', (current_date - interval '9 years')::date, null),
  (:p_nb, :c1, 'Nita', 'Patel', date '1981-06-06', null),
  (:p_kiran, :c2, 'Kiran', 'Vora', date '1979-07-07', 'kiran73@example.com');
insert into app.people (id, center_id, first_name, last_name, date_of_birth, email, is_deceased, deceased_on) values
  (:p_dead, :c1, 'Late', 'Vakil', date '1950-01-01', 'late73@example.com', true, date '2026-01-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :p_mom, :c1, 'primary', true), (:h1, :p_dad, :c1, 'spouse', false), (:h1, :p_kid, :c1, 'child', false),
  (:h2, :p_solo, :c1, 'primary', true),
  (:h3, :p_asha, :c1, 'primary', true), (:h3, :p_dev, :c1, 'spouse', false),
  (:h4, :p_pc, :c1, 'primary', true), (:h4, :p_kidc, :c1, 'child', false),
  (:h5, :p_nb, :c1, 'primary', true), (:h6, :p_dead, :c1, 'primary', true), (:h7, :p_kiran, :c2, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values
  (:c1, :mom, :p_mom), (:c1, :dad, :p_dad), (:c1, :kid, :p_kid), (:c1, :solo, :p_solo), (:c1, :asha, :p_asha), (:c1, :dev, :p_dev),
  (:c1, :pc, :p_pc), (:c1, :nb, :p_nb), (:c2, :kiran, :p_kiran);
-- Pathshala: Kavi (no login of his own) is placed in class X; Anya is in no class.
insert into app.pathshala_terms (id, center_id, name, starts_on, ends_on, status) values (:term, :c1, 'Term 73', current_date - 30, current_date + 200, 'active');
insert into app.pathshala_tracks (id, center_id, key, name) values (:track, :c1, 'jainism73', 'Jainism 73');
insert into app.pathshala_levels (id, center_id, track_id, key, name) values (:plevel, :c1, :track, '1', 'Jainism 1 (73)');
insert into app.pathshala_classes (id, center_id, term_id, level_id, name) values (:classX, :c1, :term, :plevel, 'Class X');
insert into app.pathshala_enrollments (center_id, term_id, student_person_id, household_id, class_id, status) values
  (:c1, :term, :p_kidc, :h4, :classX, 'placed');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id) values
  (:c1, :contentmgr, 'religious_coordinator', 'center', null), (:c1, :classteacher, 'teacher', 'class', :classX);
-- Lessons: L1 (homework for everyone, and the class's), LD (a "days after start" rule), L2 the other community's.
insert into app.gyan_goals (id, center_id, key, name) values (:g1, :c1, 'g73', 'Learn 73'), (:g2, :c2, 'other73', 'Other 73');
insert into app.gyan_levels (id, goal_id, key, name, sort_order, points, treasure, treasure_points, requires_teacher_signoff) values
  (:l1, :g1, '1', 'Foundations 73', 1, 0, null, 0, false), (:ld, :g1, '2', 'Daily 73', 2, 0, null, 0, false),
  (:l2, :g2, '1', 'Elsewhere 73', 1, 0, null, 0, false);
insert into app.gyan_steps (id, level_id, kind, title, sort_order, points) values
  (:s1, :l1, 'read', 'First card', 1, 0), (:sd, :ld, 'read', 'Daily card', 1, 0), (:s2, :l2, 'read', 'Other card', 1, 0);
-- Anya, Solo, Asha and the late Mr Vakil have started L1; Nita has not. On LD: Anya started yesterday, Solo ten days ago.
insert into app.gyan_progress (center_id, person_id, step_id, stars, completed_at) values
  (:c1, :p_kid, :s1, 3, now() - interval '10 days'), (:c1, :p_solo, :s1, 3, now() - interval '10 days'),
  (:c1, :p_asha, :s1, 3, now() - interval '10 days'), (:c1, :p_dead, :s1, 3, now() - interval '10 days'),
  (:c1, :p_kid, :sd, 3, now() - interval '1 day'), (:c1, :p_solo, :sd, 3, now() - interval '10 days'),
  (:c2, :p_kiran, :s2, 3, now() - interval '10 days');
select app.gyan_center_today(:c1) as today \gset
select to_char(:'today'::date, 'FMDay, FMMonth FMDD') as due_words, to_char(:'today'::date + 1, 'FMDay, FMMonth FMDD') as due_words_next \gset

-- ── The schema, the switches, the grants ───────────────────────────────────
select pg_temp.assert((select count(*) from information_schema.columns where table_schema = 'app' and table_name = 'gyan_assignments'
                         and column_name in ('remind_hours_before', 'remind_set_at')) = 2
                      and (select count(*) from pg_constraint where conrelid = 'app.gyan_assignments'::regclass
                             and conname in ('gyan_assignments_remind_hours_before_check', 'gyan_assignments_remind_needs_due_check')) = 2,
  'homework has the reminder''s hours (checked 1-720, only with a due date) and when they were set');
select pg_temp.assert((select module_key from app.module_tables where table_name = 'gyan_homework_reminders') = 'gyan_path'
                      and (select relrowsecurity from pg_class where oid = 'app.gyan_homework_reminders'::regclass)
                      and exists (select 1 from pg_policy where polrelid = 'app.gyan_homework_reminders'::regclass and polname = 'module_switch' and not polpermissive)
                      and exists (select 1 from pg_trigger where tgrelid = 'app.gyan_homework_reminders'::regclass and tgname = 'audit_gyan_homework_reminders' and not tgisinternal),
  'the reminder log belongs to the Gyan Path module: row level security, a restrictive module_switch policy and an audit trigger');
select pg_temp.assert(has_table_privilege('authenticated', 'app.gyan_homework_reminders', 'select')
                      and not has_table_privilege('authenticated', 'app.gyan_homework_reminders', 'insert')
                      and not has_table_privilege('authenticated', 'app.gyan_homework_reminders', 'update')
                      and not has_table_privilege('authenticated', 'app.gyan_homework_reminders', 'delete')
                      and not has_table_privilege('anon', 'app.gyan_homework_reminders', 'select')
                      and not has_table_privilege('connect_worker', 'app.gyan_homework_reminders', 'select')
                      and not has_table_privilege('connect_worker', 'app.gyan_homework_reminders', 'insert'),
  'the log is read-only over the API, anon reads nothing, and the worker role touches it only through the sweep');
select pg_temp.assert(has_function_privilege('connect_worker', 'app.worker_homework_reminders_sweep()', 'execute')
                      and not has_function_privilege('authenticated', 'app.worker_homework_reminders_sweep()', 'execute')
                      and not has_function_privilege('anon', 'app.worker_homework_reminders_sweep()', 'execute')
                      and not has_function_privilege('service_role', 'app.worker_homework_reminders_sweep()', 'execute')
                      and not has_function_privilege('authenticated', 'app._gyan_homework_reminders_due()', 'execute')
                      and not has_function_privilege('anon', 'app._gyan_homework_reminders_due()', 'execute'),
  'only the worker role may run the sweep; the list of who is due is internal');
select pg_temp.assert_raises($$select app.worker_homework_reminders_sweep()$$, 'only the background service',
  'the sweep asserts the worker role itself, even for the database owner');
begin;
select pg_temp.sign_in(:mom);
select pg_temp.assert_raises($$select app.worker_homework_reminders_sweep()$$, 'permission denied', 'a signed-in member cannot run the sweep');
select pg_temp.assert_raises($$select * from app._gyan_homework_reminders_due()$$, 'permission denied', 'nor read who is due');
commit;
begin;
set local role service_role;
select pg_temp.assert_raises($$select app.worker_homework_reminders_sweep()$$, 'permission denied', 'nor can the service role');
commit;
-- Function hygiene for everything 0588 defines or redefines.
create or replace function pg_temp.r_fns() returns setof pg_proc language sql stable as $$
  select p.* from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = any (array['worker_homework_reminders_sweep', '_gyan_homework_reminders_due', 'gyan_assignments_guard',
                                                     'gyan_assignment_json', 'save_gyan_assignment', 'my_gyan_homework', 'hand_in_gyan_submission']) $$;
select pg_temp.assert((select count(*) from pg_temp.r_fns()) = 7
                      and (select count(*) from pg_temp.r_fns() p where p.prosecdef and (p.proconfig is null or not (p.proconfig::text like '%search_path=app, public, extensions%'))) = 0
                      and (select count(*) from pg_temp.r_fns() p where p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')) = 0
                      and not exists (select 1 from pg_temp.r_fns() p where has_function_privilege('anon', p.oid, 'execute')),
  'every function 0588 defines or redefines is security definer with its search path pinned, none is open to PUBLIC or anon');
select pg_temp.assert(has_function_privilege('authenticated', 'app.save_gyan_assignment(uuid, jsonb)', 'execute')
                      and has_function_privilege('authenticated', 'app.hand_in_gyan_submission(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.my_gyan_homework(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.gyan_assignment_json(uuid)', 'execute'),
  'the redefined functions keep 0587''s grants');
select pg_temp.assert((select count(*) from app.message_templates where center_id is null and language = 'en' and key = 'homework.due_soon') = 2
                      and (select count(*) from app.message_templates where center_id is null and key = 'homework.due_soon' and channel in ('push', 'email')) = 2,
  'the homework.due_soon template is seeded for push and email, as a platform default');
select pg_temp.assert(not exists (select 1 from app.message_templates t, regexp_matches(coalesce(t.subject, '') || ' ' || t.body, '\{\{\s*([A-Za-z0-9_]+)\s*\}\}', 'g') m
                                   where t.center_id is null and t.key = 'homework.due_soon'
                                     and m[1] not in ('title', 'level', 'learner', 'due', 'deep_link', 'type', 'center_short_name', 'center_name'))
                      and not exists (select 1 from app.message_templates where key = 'homework.due_soon' and (body ~* 'note|hours' or subject ~* 'note|hours')),
  'the template uses only 0587''s variables (no note, no "in N hours")');

-- ── The reminder's hours, in plain English ─────────────────────────────────
begin;
select pg_temp.sign_in(:contentmgr);
select pg_temp.assert_raises($$select app.save_gyan_assignment('73000000-0000-4000-8000-0000000000c1', '{"level_id": "73000000-0000-4000-8000-000000000f01", "title": "v1", "remind_hours_before": 24}')$$,
  'A reminder needs a due date: choose when the homework is due, or leave the reminder empty.', 'a reminder without a due date is refused');
select pg_temp.assert_raises($$select app.save_gyan_assignment('73000000-0000-4000-8000-0000000000c1', '{"level_id": "73000000-0000-4000-8000-000000000f01", "title": "v2", "due_rule": {"kind": "on", "date": "2030-01-01"}, "remind_hours_before": 0}')$$,
  'The reminder must be a whole number of hours from 1 to 720 (30 days) before the homework is due, or empty for no reminder.', '0 hours is refused');
select pg_temp.assert_raises($$select app.save_gyan_assignment('73000000-0000-4000-8000-0000000000c1', '{"level_id": "73000000-0000-4000-8000-000000000f01", "title": "v3", "due_rule": {"kind": "on", "date": "2030-01-01"}, "remind_hours_before": 721}')$$,
  'whole number of hours from 1 to 720', '721 hours is refused');
select pg_temp.assert_raises($$select app.save_gyan_assignment('73000000-0000-4000-8000-0000000000c1', '{"level_id": "73000000-0000-4000-8000-000000000f01", "title": "v4", "due_rule": {"kind": "days_after_start", "days": 7}, "remind_hours_before": 1.5}')$$,
  'whole number of hours from 1 to 720', 'a part of an hour is refused, not rounded');
select pg_temp.assert_raises($$select app.save_gyan_assignment('73000000-0000-4000-8000-0000000000c1', '{"level_id": "73000000-0000-4000-8000-000000000f01", "title": "v5", "due_rule": {"kind": "days_after_start", "days": 7}, "remind_hours_before": "12"}')$$,
  'whole number of hours from 1 to 720', 'hours written as text are refused');
select pg_temp.assert((select bool_and(pg_temp.state_of(format($$select app.save_gyan_assignment('73000000-0000-4000-8000-0000000000c1', %L::jsonb)$$, j)) = '22023')
                         from unnest(array[
  '{"level_id": "73000000-0000-4000-8000-000000000f01", "title": "w1", "remind_hours_before": 24}',
  '{"level_id": "73000000-0000-4000-8000-000000000f01", "title": "w2", "due_rule": {"kind": "none"}, "remind_hours_before": 1}',
  '{"level_id": "73000000-0000-4000-8000-000000000f01", "title": "w3", "due_rule": {"kind": "on", "date": "2030-01-01"}, "remind_hours_before": 0}',
  '{"level_id": "73000000-0000-4000-8000-000000000f01", "title": "w4", "due_rule": {"kind": "on", "date": "2030-01-01"}, "remind_hours_before": 721}',
  '{"level_id": "73000000-0000-4000-8000-000000000f01", "title": "w5", "due_rule": {"kind": "on", "date": "2030-01-01"}, "remind_hours_before": -5}',
  '{"level_id": "73000000-0000-4000-8000-000000000f01", "title": "w6", "due_rule": {"kind": "on", "date": "2030-01-01"}, "remind_hours_before": 2.5}',
  '{"level_id": "73000000-0000-4000-8000-000000000f01", "title": "w7", "due_rule": {"kind": "on", "date": "2030-01-01"}, "remind_hours_before": "24"}',
  '{"level_id": "73000000-0000-4000-8000-000000000f01", "title": "w8", "due_rule": {"kind": "on", "date": "2030-01-01"}, "remind_hours_before": true}',
  '{"level_id": "73000000-0000-4000-8000-000000000f01", "title": "w9", "due_rule": {"kind": "on", "date": "2030-01-01"}, "remind_hours_before": [24]}',
  '{"level_id": "73000000-0000-4000-8000-000000000f01", "title": "w10", "due_rule": {"kind": "on", "date": "2030-01-01"}, "remind_hours_before": {"h": 24}}',
  '{"level_id": "73000000-0000-4000-8000-000000000f01", "title": "w11", "due_rule": {"kind": "on", "date": "2030-01-01"}, "remind_hours_before": 1e400}']) j),
  'every wrong reminder is refused with a plain sentence (22023), never a raw database error');
-- Right ones: 720 hours with a date, 1 hour with "days after start", none at all.
select app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'Thirty days ahead', 'allowed_kinds', jsonb_build_array('text'),
                                'due_rule', jsonb_build_object('kind', 'on', 'date', (:'today'::date + 40)::text), 'remind_hours_before', 720)) as v_ok \gset
select app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'An hour ahead', 'allowed_kinds', jsonb_build_array('text'),
                                'due_rule', '{"kind": "days_after_start", "days": 3}'::jsonb, 'remind_hours_before', 1.0)) as v_ok2 \gset
select app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'No due date yet', 'allowed_kinds', jsonb_build_array('text'),
                                'remind_hours_before', null)) as v_none \gset
commit;
select (:'v_ok'::jsonb->>'id') as a_v, (:'v_none'::jsonb->>'id') as a_vnone \gset
select pg_temp.assert((:'v_ok'::jsonb->>'remind_hours_before')::int = 720 and :'v_ok'::jsonb->>'remind_set_at' is not null
                      and (:'v_ok2'::jsonb->>'remind_hours_before') = '1'
                      and :'v_none'::jsonb ? 'remind_hours_before' and :'v_none'::jsonb->'remind_hours_before' = 'null'::jsonb
                      and :'v_none'::jsonb->'remind_set_at' = 'null'::jsonb,
  'a reminder of 1 to 720 hours is kept with the time it was set (1.0 is 1); homework without one says so (null) and was never "set"');
-- When the hours were set: a change of the hours moves it, a change of anything else (the due date included) does not.
update app.gyan_assignments set remind_set_at = now() - interval '1 day' where id = :'a_v';
select remind_set_at::text as v_set0 from app.gyan_assignments where id = :'a_v' \gset
begin;
select pg_temp.sign_in(:contentmgr);
select app.save_gyan_assignment(:c1, jsonb_build_object('id', :'a_v', 'title', 'Thirty days ahead, renamed',
                                'due_rule', jsonb_build_object('kind', 'on', 'date', (:'today'::date + 41)::text))) as v_ren \gset
commit;
select pg_temp.assert((select remind_set_at::text = :'v_set0' and remind_hours_before = 720 from app.gyan_assignments where id = :'a_v')
                      and (:'v_ren'::jsonb->>'remind_hours_before')::int = 720,
  'saving without the key keeps the reminder; a new title or due date does not move the time the hours were set');
begin;
select pg_temp.sign_in(:contentmgr);
select app.save_gyan_assignment(:c1, jsonb_build_object('id', :'a_v', 'remind_hours_before', 700)) as v_hrs \gset
commit;
select pg_temp.assert((select remind_set_at::text <> :'v_set0' and remind_set_at > now() - interval '1 hour' and remind_hours_before = 700 from app.gyan_assignments where id = :'a_v'),
  'changing the hours sets the time again');
begin;
select pg_temp.sign_in(:contentmgr);
select pg_temp.assert_raises($$select app.save_gyan_assignment('73000000-0000-4000-8000-0000000000c1', jsonb_build_object('id', '$$ || :'a_v' || $$', 'due_rule', '{"kind": "none"}'::jsonb))$$,
  'A reminder needs a due date', 'taking the due date away while a reminder is set is refused (clear the reminder too)');
select app.save_gyan_assignment(:c1, jsonb_build_object('id', :'a_v', 'due_rule', '{"kind": "none"}'::jsonb, 'remind_hours_before', null)) as v_clear \gset
commit;
select pg_temp.assert(:'v_clear'::jsonb->'remind_hours_before' = 'null'::jsonb and :'v_clear'::jsonb->'due_rule' = '{"kind": "none"}'::jsonb,
  'taking both away together works');
-- The table's own guard says the same to scripts and workers.
select pg_temp.assert_raises($$update app.gyan_assignments set remind_hours_before = 5 where id = '$$ || :'a_vnone' || $$'$$,
  'A reminder needs a due date', 'the guard refuses a reminder on homework with no due date');
select pg_temp.assert_raises($$update app.gyan_assignments set remind_hours_before = 0, due_rule = '{"kind": "days_after_start", "days": 2}' where id = '$$ || :'a_vnone' || $$'$$,
  'whole number of hours from 1 to 720', 'and hours out of range, in a sentence (before the check constraint)');

-- ── Homework with reminders, and who is reminded ───────────────────────────
-- Due today (the end of today is the due moment), 48 hours ahead: the reminder time was yesterday at midnight.
begin;
select pg_temp.sign_in(:contentmgr);
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'Due today, no answers', 'allowed_kinds', jsonb_build_array('text'),
                                 'due_rule', jsonb_build_object('kind', 'on', 'date', :'today'), 'remind_hours_before', 48))->>'id') as a_none \gset
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'Due today, answers in every state', 'allowed_kinds', jsonb_build_array('text'),
                                 'due_rule', jsonb_build_object('kind', 'on', 'date', :'today'), 'remind_hours_before', 48))->>'id') as a_states \gset
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'Due today, mostly handed in', 'allowed_kinds', jsonb_build_array('text'),
                                 'due_rule', jsonb_build_object('kind', 'on', 'date', :'today'), 'remind_hours_before', 48))->>'id') as a_done \gset
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'Class X homework', 'class_id', :classX, 'allowed_kinds', jsonb_build_array('text'),
                                 'due_rule', jsonb_build_object('kind', 'on', 'date', :'today'), 'remind_hours_before', 48))->>'id') as a_class \gset
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :ld, 'title', 'A day after you start', 'allowed_kinds', jsonb_build_array('text'),
                                 'due_rule', '{"kind": "days_after_start", "days": 1}'::jsonb, 'remind_hours_before', 48))->>'id') as a_days \gset
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'Due in three days', 'allowed_kinds', jsonb_build_array('text'),
                                 'due_rule', jsonb_build_object('kind', 'on', 'date', (:'today'::date + 3)::text), 'remind_hours_before', 24))->>'id') as a_early \gset
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'Was due yesterday', 'allowed_kinds', jsonb_build_array('text'),
                                 'due_rule', jsonb_build_object('kind', 'on', 'date', (:'today'::date - 1)::text), 'remind_hours_before', 48))->>'id') as a_late \gset
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'Published an hour ago', 'allowed_kinds', jsonb_build_array('text'),
                                 'due_rule', jsonb_build_object('kind', 'on', 'date', :'today'), 'remind_hours_before', 48))->>'id') as a_prepub \gset
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'Reminder set an hour ago', 'allowed_kinds', jsonb_build_array('text'),
                                 'due_rule', jsonb_build_object('kind', 'on', 'date', :'today'), 'remind_hours_before', 48))->>'id') as a_preset \gset
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'Archived', 'allowed_kinds', jsonb_build_array('text'),
                                 'due_rule', jsonb_build_object('kind', 'on', 'date', :'today'), 'remind_hours_before', 48))->>'id') as a_arch \gset
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'Still a draft', 'allowed_kinds', jsonb_build_array('text'),
                                 'due_rule', jsonb_build_object('kind', 'on', 'date', :'today'), 'remind_hours_before', 48))->>'id') as a_draft \gset
select app.set_gyan_assignment_status(:'a_none', 'published');
select app.set_gyan_assignment_status(:'a_states', 'published');
select app.set_gyan_assignment_status(:'a_done', 'published');
select app.set_gyan_assignment_status(:'a_class', 'published');
select app.set_gyan_assignment_status(:'a_days', 'published');
select app.set_gyan_assignment_status(:'a_early', 'published');
select app.set_gyan_assignment_status(:'a_late', 'published');
select app.set_gyan_assignment_status(:'a_prepub', 'published');
select app.set_gyan_assignment_status(:'a_preset', 'published');
select app.set_gyan_assignment_status(:'a_arch', 'published');
select app.set_gyan_assignment_status(:'a_arch', 'archived');
-- And one with no due date (so no reminder) on the same level.
select app.set_gyan_assignment_status(:'a_vnone', 'published');
commit;
-- Published (and the hours set) five days ago, except the two that say otherwise.
update app.gyan_assignments set published_at = now() - interval '5 days', remind_set_at = now() - interval '5 days'
 where id in (:'a_none', :'a_states', :'a_done', :'a_class', :'a_days', :'a_early', :'a_late', :'a_arch');
update app.gyan_assignments set published_at = now() - interval '1 hour', remind_set_at = now() - interval '5 days' where id = :'a_prepub';
update app.gyan_assignments set published_at = now() - interval '5 days', remind_set_at = now() - interval '1 hour' where id = :'a_preset';
-- The answers (written here directly): a draft, one waiting for a parent, one sent back, one with the teacher, one accepted.
insert into app.gyan_submissions (center_id, assignment_id, person_id, status) values
  (:c1, :'a_states', :p_kid, 'draft'), (:c1, :'a_states', :p_solo, 'awaiting_parent'), (:c1, :'a_states', :p_asha, 'needs_work'),
  (:c1, :'a_done', :p_kid, 'submitted'), (:c1, :'a_done', :p_solo, 'accepted');
select pg_temp.assert(not exists (select 1 from app.messages where template_key = 'homework.due_soon'),
  'nothing is reminded until the sweep runs');

begin;
set local role connect_worker;
select app.worker_homework_reminders_sweep() as run1 \gset
commit;
select pg_temp.assert(:'run1'::jsonb = '{"busy": 0, "messages": 22, "reminded": 8, "unreached": 0, "held_for_quiet_hours": 0}'::jsonb,
  'one run reminds eight learners with 22 messages: ' || :'run1');
select pg_temp.assert(pg_temp.log(:'a_none') = array[:p_kid || '|' || :'today' || '|48|4', :p_solo || '|' || :'today' || '|48|2', :p_asha || '|' || :'today' || '|48|2'],
  'homework with no answers: the child (4 messages: her own push, a push to each parent, an email to the parent with an address) and both adult learners (push and email) are reminded, once each, for today''s due date');
select pg_temp.assert((select count(*) = 4
                          and array_agg(to_address order by to_address) filter (where channel = 'push') = array[:mom, :dad, :kid]
                          and array_agg(to_address) filter (where channel = 'email') = array['mom73@example.com']
                          and bool_and(status = 'queued' and purpose = 'notification'
                                       and payload->>'type' = case when to_address = :kid then 'homework' else 'homework_parent' end
                                       and payload->>'deep_link' = '/gyan/homework/' || :'a_none' || '?person=' || :p_kid
                                       and payload->>'learner_id' = :p_kid and payload->>'assignment_id' = :'a_none'
                                       and payload->'vars'->>'due' = :'due_words')
                         from pg_temp.rm(:'a_none') where payload->>'learner_id' = :p_kid),
  'a child''s reminder: her own push opens her homework (type homework), her parents'' open the family screen (homework_parent), all with the link and the due date in words');
select pg_temp.assert((select bool_and(body = 'Reminder: "Due today, no answers" (Foundations 73) is due ' || :'due_words' || '. Anya has not handed it in yet.'
                                       and subject = 'Homework reminder for Anya')
                         from pg_temp.rm(:'a_none') where payload->>'learner_id' = :p_kid and channel = 'push')
                      and (select subject = 'Reminder: Anya''s homework "Due today, no answers" is due ' || :'due_words'
                                  and body like 'Reminder: "Due today, no answers" (Foundations 73) at R73 is due ' || :'due_words' || '. Anya has not handed it in yet.%'
                                  and person_id = :p_mom::uuid
                             from pg_temp.rm(:'a_none') where channel = 'email' and to_address = 'mom73@example.com'),
  'it reads in plain English with an absolute due date ("is due ' || :'due_words' || '"), names the child for her parents, and belongs to its recipient');
select pg_temp.assert((select count(*) = 2 and bool_and(payload->>'type' = 'homework') from pg_temp.rm(:'a_none') where payload->>'learner_id' = :p_solo)
                      and (select count(*) = 2 from pg_temp.rm(:'a_none') where payload->>'learner_id' = :p_asha)
                      and not exists (select 1 from pg_temp.rm(:'a_none') where to_address in (:dev, 'dev73@example.com')),
  'an adult learner is told alone: Solo (push and email), and Asha but never her husband');
select pg_temp.assert(not exists (select 1 from app.messages m, jsonb_object_keys(m.payload->'vars') k where m.template_key = 'homework.due_soon'
                                   and k not in ('title', 'level', 'learner', 'due', 'deep_link', 'type', 'assignment_id', 'learner_id', 'person_id'))
                      and not exists (select 1 from app.messages where template_key = 'homework.due_soon' and (body ~* 'hours|note' or payload ? 'note')),
  'the reminder carries only the homework''s variables: no note, no "in N hours"');
select pg_temp.assert(pg_temp.log(:'a_states') = array[:p_kid || '|' || :'today' || '|48|4', :p_asha || '|' || :'today' || '|48|2'],
  'a draft (Anya) and an answer sent back (Asha) are reminded; an answer waiting for a parent (Solo) is not');
select pg_temp.assert(pg_temp.log(:'a_done') = array[:p_asha || '|' || :'today' || '|48|2'],
  'an answer with the teacher (Anya) or accepted (Solo) is not reminded; Asha, who has not answered, is');
select pg_temp.assert(pg_temp.log(:'a_class') = array[:p_kidc || '|' || :'today' || '|48|2']
                      and (select count(*) = 2 and bool_and(payload->>'type' = 'homework_parent' and person_id = :p_pc::uuid)
                             from pg_temp.rm(:'a_class')),
  'a class''s homework reminds its student only (not Anya, who started the level but is in no class); Kavi has no login, so his mother is told (push and email)');
select pg_temp.assert(pg_temp.log(:'a_days') = array[:p_kid || '|' || :'today' || '|48|4'],
  '"a day after you start": Anya started yesterday, so it is due today and she is reminded; Solo''s day passed long ago');
select pg_temp.assert(pg_temp.log(:'a_early') = '{}' and pg_temp.log(:'a_late') = '{}' and pg_temp.log(:'a_prepub') = '{}' and pg_temp.log(:'a_preset') = '{}'
                      and pg_temp.log(:'a_arch') = '{}' and pg_temp.log(:'a_draft') = '{}'
                      and not exists (select 1 from app.messages where template_key = 'homework.due_soon'
                                        and payload->>'assignment_id' in (:'a_early', :'a_late', :'a_prepub', :'a_preset', :'a_arch', :'a_draft')),
  'nothing before the reminder time, after the due moment, when the time came before the publish or before the hours were set, for archived homework or for a draft');
select pg_temp.assert(not exists (select 1 from app.gyan_homework_reminders where person_id in (:p_dead, :p_nb, :p_mom, :p_dad, :p_dev, :p_pc)),
  'only learners are reminded: never someone recorded as deceased, nor a member who has not started the level');
select pg_temp.assert((select bool_and(r.remind_at = ((:'today'::date + 1)::timestamp at time zone :'tz73') - interval '48 hours' and r.center_id = :c1::uuid)
                         from app.gyan_homework_reminders r where r.assignment_id = :'a_none'::uuid)
                      and (select reason = 'Homework due soon: the learners who have not handed it in are reminded' and client_app = 'job'
                             from app.audit_log where record_table = 'gyan_homework_reminders' and action = 'gyan_homework_reminders.insert' order by id limit 1),
  'the log keeps the reminder time (48 hours before the end of the due day), and its rows are audited as the job''s');

begin;
set local role connect_worker;
select app.worker_homework_reminders_sweep() as run2 \gset
commit;
select pg_temp.assert((:'run2'::jsonb->>'reminded')::int = 0 and (:'run2'::jsonb->>'messages')::int = 0
                      and (select count(*) from app.messages where template_key = 'homework.due_soon') = 22,
  'a second run reminds nobody again');

-- ── Changing the hours never reminds twice for one due date; moving the due date does ──
begin;
select pg_temp.sign_in(:contentmgr);
select app.save_gyan_assignment(:c1, jsonb_build_object('id', :'a_none', 'remind_hours_before', 72)) as none72 \gset
commit;
select pg_temp.assert((select remind_set_at > now() - interval '1 hour' from app.gyan_assignments where id = :'a_none'),
  'the new hours are set now');
-- Even when the new hours' time came after they were set (here written back five days), the same due date is not reminded again.
update app.gyan_assignments set remind_set_at = now() - interval '5 days' where id = :'a_none';
select remind_set_at::text as none_set from app.gyan_assignments where id = :'a_none' \gset
begin;
set local role connect_worker;
select app.worker_homework_reminders_sweep() as run3 \gset
commit;
select pg_temp.assert((:'run3'::jsonb->>'reminded')::int = 0 and (select count(*) from pg_temp.rm(:'a_none')) = 8
                      and pg_temp.log(:'a_none') = array[:p_kid || '|' || :'today' || '|48|4', :p_solo || '|' || :'today' || '|48|2', :p_asha || '|' || :'today' || '|48|2'],
  'changing the hours never reminds anyone twice for the same due date');
begin;
select pg_temp.sign_in(:contentmgr);
select app.save_gyan_assignment(:c1, jsonb_build_object('id', :'a_none', 'due_rule', jsonb_build_object('kind', 'on', 'date', (:'today'::date + 1)::text))) as none_moved \gset
commit;
select pg_temp.assert((select remind_set_at::text = :'none_set' from app.gyan_assignments where id = :'a_none'),
  'moving the due date does not move the time the hours were set');
begin;
set local role connect_worker;
select app.worker_homework_reminders_sweep() as run4 \gset
commit;
select pg_temp.assert((:'run4'::jsonb->>'reminded')::int = 3 and (:'run4'::jsonb->>'messages')::int = 8
                      and (select count(*) from pg_temp.rm(:'a_none')) = 16
                      and (select count(*) = 8 and bool_and(payload->'vars'->>'due' = :'due_words_next') from pg_temp.rm(:'a_none') where payload->'vars'->>'due' <> :'due_words')
                      and (select count(*) from app.gyan_homework_reminders where assignment_id = :'a_none'::uuid and due_on = :'today'::date + 1 and remind_hours = 72) = 3,
  'moving the due date reminds again, once, for the new date (72 hours before the end of tomorrow), in the new date''s words');
begin;
select pg_temp.sign_in(:kid);
select app.my_gyan_homework(:c1) as hw_kid \gset
commit;
select pg_temp.assert((select (i->'assignment'->>'remind_hours_before')::int = 72 and i->'assignment'->>'remind_set_at' is not null
                         from jsonb_array_elements(:'hw_kid'::jsonb->'items') i where i->'assignment'->>'id' = :'a_none')
                      and (select i->'assignment'->'remind_hours_before' = 'null'::jsonb
                             from jsonb_array_elements(:'hw_kid'::jsonb->'items') i where i->'assignment'->>'id' = :'a_vnone'),
  'the member app reads the reminder''s hours on each homework (null when there is none)');

-- ── Quiet hours ────────────────────────────────────────────────────────────
-- (1) Quiet now, ending within the hour, long before the due moment (the end of tomorrow): the reminder waits.
begin;
select pg_temp.sign_in(:contentmgr);
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'Quiet hours wait', 'allowed_kinds', jsonb_build_array('text'),
                                 'due_rule', jsonb_build_object('kind', 'on', 'date', (:'today'::date + 1)::text), 'remind_hours_before', 48))->>'id') as a_q1 \gset
select app.set_gyan_assignment_status(:'a_q1', 'published');
commit;
update app.gyan_assignments set published_at = now() - interval '5 days', remind_set_at = now() - interval '5 days' where id = :'a_q1';
begin;
update app.centers set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{notifications}',
         jsonb_build_object('quiet_start_hour', extract(hour from now() at time zone time_zone)::int,
                            'quiet_end_hour', (extract(hour from now() at time zone time_zone)::int + 1) % 24))
 where id = :c1;
set local role connect_worker;
select app.worker_homework_reminders_sweep() as q1 \gset
commit;
select pg_temp.assert((:'q1'::jsonb->>'reminded')::int = 0 and (:'q1'::jsonb->>'held_for_quiet_hours')::int = 3
                      and pg_temp.log(:'a_q1') = '{}' and not exists (select 1 from pg_temp.rm(:'a_q1')),
  'during quiet hours that end before the homework is due, the reminder waits (three learners held)');
update app.centers set rules = jsonb_set(rules, '{notifications}', '{"quiet_start_hour": 0, "quiet_end_hour": 0}') where id = :c1;
begin;
set local role connect_worker;
select app.worker_homework_reminders_sweep() as q2 \gset
commit;
select pg_temp.assert((:'q2'::jsonb->>'reminded')::int = 3 and (:'q2'::jsonb->>'held_for_quiet_hours')::int = 0
                      and (select count(*) from pg_temp.rm(:'a_q1')) = 8,
  'and the first run after quiet hours end sends it');
-- (2) Quiet now and until tomorrow, after the homework is due tonight: waiting would miss it, so it goes now. The email
-- goes at once; the push, as every push, waits for the end of quiet hours (app.enqueue_message).
begin;
select pg_temp.sign_in(:contentmgr);
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'Quiet hours end after it is due', 'allowed_kinds', jsonb_build_array('text'),
                                 'due_rule', jsonb_build_object('kind', 'on', 'date', :'today'), 'remind_hours_before', 48))->>'id') as a_q2 \gset
select app.set_gyan_assignment_status(:'a_q2', 'published');
commit;
update app.gyan_assignments set published_at = now() - interval '5 days', remind_set_at = now() - interval '5 days' where id = :'a_q2';
begin;
update app.centers set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{notifications}',
         jsonb_build_object('quiet_start_hour', extract(hour from now() at time zone time_zone)::int,
                            'quiet_end_hour', (extract(hour from now() at time zone time_zone)::int + 23) % 24))
 where id = :c1;
set local role connect_worker;
select app.worker_homework_reminders_sweep() as q3 \gset
commit;
select pg_temp.assert((:'q3'::jsonb->>'reminded')::int = 3 and (:'q3'::jsonb->>'held_for_quiet_hours')::int = 0
                      and pg_temp.log(:'a_q2') = array[:p_kid || '|' || :'today' || '|48|4', :p_solo || '|' || :'today' || '|48|2', :p_asha || '|' || :'today' || '|48|2'],
  'when quiet hours end only after the due moment, the reminder is not held');
select pg_temp.assert((select bool_and(scheduled_at <= now()) from pg_temp.rm(:'a_q2') where channel = 'email')
                      and (select bool_and(scheduled_at > (:'today'::date + 1)::timestamp at time zone :'tz73') from pg_temp.rm(:'a_q2') where channel = 'push')
                      and (select count(*) from pg_temp.rm(:'a_q2') where channel = 'push') = 5,
  'its emails go at once; its pushes wait for the end of quiet hours, as the community''s rule says');
update app.centers set rules = jsonb_set(rules, '{notifications}', '{"quiet_start_hour": 0, "quiet_end_hour": 0}') where id = :c1;

-- ── Handing in cancels the reminder that has not gone out ──────────────────
begin;
select pg_temp.sign_in(:contentmgr);
select (app.save_gyan_assignment(:c1, jsonb_build_object('level_id', :l1, 'title', 'Hand in cancels the reminder', 'allowed_kinds', jsonb_build_array('text'),
                                 'due_rule', jsonb_build_object('kind', 'on', 'date', :'today'), 'remind_hours_before', 48))->>'id') as a_hand \gset
select app.set_gyan_assignment_status(:'a_hand', 'published');
commit;
update app.gyan_assignments set published_at = now() - interval '5 days', remind_set_at = now() - interval '5 days' where id = :'a_hand';
begin;
set local role connect_worker;
select app.worker_homework_reminders_sweep() as h1 \gset
commit;
select pg_temp.assert((:'h1'::jsonb->>'reminded')::int = 3 and (select count(*) from pg_temp.rm(:'a_hand')) = 8,
  'the homework''s reminder is queued for its three learners');
-- The email to Anya's mother already went out.
update app.messages set status = 'sent', sent_at = now()
 where template_key = 'homework.due_soon' and payload->>'assignment_id' = :'a_hand' and payload->>'learner_id' = :p_kid and channel = 'email';
begin;
select pg_temp.sign_in(:kid);
select (app.save_gyan_submission_draft(:'a_hand', :p_kid, 'My answer', null)->>'id') as sub_kid \gset
select app.hand_in_gyan_submission(:'sub_kid') as kid_in \gset
commit;
select pg_temp.assert(:'kid_in'::jsonb->>'status' = 'awaiting_parent'
                      and (select count(*) = 3 and bool_and(status = 'cancelled' and failure_reason = 'Not sent: the homework was handed in before the reminder went out.')
                             from pg_temp.rm(:'a_hand') where payload->>'learner_id' = :p_kid and channel = 'push')
                      and (select status = 'sent' from pg_temp.rm(:'a_hand') where payload->>'learner_id' = :p_kid and channel = 'email'),
  'a child''s hand-in (waiting for a parent) cancels her reminder that has not gone out, her parents'' pushes included; the email already sent stays sent');
select pg_temp.assert((select bool_and(status = 'queued') from pg_temp.rm(:'a_hand') where payload->>'learner_id' in (:p_solo, :p_asha))
                      and (select bool_and(status = 'queued') from pg_temp.rm(:'a_none') where payload->>'learner_id' = :p_kid)
                      and (select count(*) > 0 and bool_and(status = 'queued') from app.messages where template_key = 'homework.parent_check' and payload->>'assignment_id' = :'a_hand'),
  'only that learner''s reminder for that homework is cancelled: the other learners'', her other homework''s and the parent check''s messages stay queued');
begin;
select pg_temp.sign_in(:solo);
select (app.save_gyan_submission_draft(:'a_hand', :p_solo, 'Done', null)->>'id') as sub_solo \gset
select app.hand_in_gyan_submission(:'sub_solo') as solo_in \gset
commit;
select pg_temp.assert(:'solo_in'::jsonb->>'status' = 'submitted'
                      and (select count(*) = 2 and bool_and(status = 'cancelled') from pg_temp.rm(:'a_hand') where payload->>'learner_id' = :p_solo),
  'an adult''s hand-in (straight to the teacher) cancels his reminder too');
select id as cancelled_msg from pg_temp.rm(:'a_hand') where payload->>'learner_id' = :p_kid and channel = 'push' and to_address = :kid \gset
begin;
set local role connect_worker;
select app.worker_message_to_send(:'cancelled_msg') as wm \gset
select app.worker_homework_reminders_sweep() as h2 \gset
commit;
select pg_temp.assert(:'wm'::jsonb->>'skip' = 'The message is already cancelled.'
                      and (:'h2'::jsonb->>'reminded')::int = 0 and (select count(*) from pg_temp.rm(:'a_hand')) = 8,
  'the messaging job skips a cancelled reminder, and the next run reminds nobody who handed in');

-- ── The community's switch and the module switch ───────────────────────────
-- Kiran, of the other community, has homework due today with a reminder (written here directly; the guard still runs).
insert into app.gyan_assignments (id, center_id, level_id, title, allowed_kinds, due_rule, status, published_at, remind_hours_before)
values (:a_c2, :c2, :l2, 'Other community homework', '{text}', jsonb_build_object('kind', 'on', 'date', app.gyan_center_today(:c2)::text), 'published', now() - interval '5 days', 48);
update app.gyan_assignments set remind_set_at = now() - interval '5 days' where id = :a_c2;
update app.centers set rules = jsonb_set(rules, '{notifications,triggers}', '{"homework_reminder": false}') where id = :c2;
begin;
set local role connect_worker;
select app.worker_homework_reminders_sweep() as sw_off \gset
commit;
select pg_temp.assert((:'sw_off'::jsonb->>'reminded')::int = 0 and pg_temp.log(:a_c2) = '{}',
  'a community that switched homework reminders off (Settings › Notifications) gets none');
update app.centers set rules = jsonb_set(rules, '{notifications,triggers}', '{"homework_reminder": true}') where id = :c2;
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c2, 'gyan_path', false, 'test 73');
begin;
set local role connect_worker;
select app.worker_homework_reminders_sweep() as mod_off \gset
commit;
select pg_temp.assert((:'mod_off'::jsonb->>'reminded')::int = 0 and pg_temp.log(:a_c2) = '{}',
  'nor one with Gyan Path switched off');
update app.center_modules set enabled = true where center_id = :c2 and module_key = 'gyan_path';
begin;
set local role connect_worker;
select app.worker_homework_reminders_sweep() as back_on \gset
commit;
select pg_temp.assert((:'back_on'::jsonb->>'reminded')::int = 1 and pg_temp.log(:a_c2) = array[:p_kiran || '|' || :'today' || '|48|2'],
  'with both switches on again, the next run reminds Kiran (the switches were what held it)');

-- ── Who reads the log ──────────────────────────────────────────────────────
create or replace function pg_temp.seen() returns text language sql stable as $$
  select count(*) || '/' || count(distinct person_id) from app.gyan_homework_reminders $$;
select (select count(*) from app.gyan_homework_reminders where person_id = :p_kid) || '/1' as n_kid,
       (select count(*) from app.gyan_homework_reminders where person_id = :p_asha) || '/1' as n_asha,
       (select count(*) from app.gyan_homework_reminders where person_id = :p_solo) || '/1' as n_solo,
       (select count(*) || '/' || count(distinct person_id) from app.gyan_homework_reminders where center_id = :c1::uuid) as n_c1 \gset
begin; select pg_temp.sign_in(:kid); select pg_temp.seen() as r_kid \gset
commit;
begin; select pg_temp.sign_in(:mom); select pg_temp.seen() as r_mom \gset
commit;
begin; select pg_temp.sign_in(:dad); select pg_temp.seen() as r_dad \gset
commit;
begin; select pg_temp.sign_in(:asha); select pg_temp.seen() as r_asha \gset
commit;
begin; select pg_temp.sign_in(:dev); select pg_temp.seen() as r_dev \gset
commit;
begin; select pg_temp.sign_in(:solo); select pg_temp.seen() as r_solo \gset
commit;
begin; select pg_temp.sign_in(:pc); select pg_temp.seen() as r_pc \gset
commit;
begin; select pg_temp.sign_in(:nb); select pg_temp.seen() as r_nb \gset
commit;
begin; select pg_temp.sign_in(:contentmgr); select pg_temp.seen() as r_content \gset
commit;
begin; select pg_temp.sign_in(:classteacher); select pg_temp.seen() as r_teacher \gset
commit;
begin; select pg_temp.sign_in(:kiran); select pg_temp.seen() as r_kiran \gset
commit;
select pg_temp.assert(:'r_kid' = :'n_kid' and :'r_mom' = :'n_kid' and :'r_dad' = :'n_kid' and :'r_asha' = :'n_asha' and :'r_dev' = :'n_asha'
                      and :'r_solo' = :'n_solo' and :'r_pc' = '1/1' and :'r_nb' = '0/0',
  'the learner and the adults of their household read the learner''s reminders; another family reads none');
select pg_temp.assert(:'r_content' = :'n_c1' and :'r_teacher' = '1/1' and :'r_kiran' = '1/1',
  'the people who may change the homework read its reminders (all of it for the content team, only their class''s for a class Teacher); another community''s member reads only his own');
begin;
select pg_temp.sign_in(:mom);
select pg_temp.assert_raises($$insert into app.gyan_homework_reminders (assignment_id, person_id, center_id, due_on, remind_hours, remind_at) values ('$$ || :'a_hand' || $$', '73000000-0000-4000-8000-0000000000a3', '73000000-0000-4000-8000-0000000000c1', current_date + 9, 1, now())$$,
  'permission denied', 'nobody writes the log over the API');
select pg_temp.assert_raises($$delete from app.gyan_homework_reminders$$, 'permission denied', 'nor deletes from it');
commit;
update app.center_modules set enabled = false where center_id = :c1 and module_key = 'gyan_path';
insert into app.center_modules (center_id, module_key, enabled, reason) select :c1, 'gyan_path', false, 'test 73'
 where not exists (select 1 from app.center_modules where center_id = :c1 and module_key = 'gyan_path');
begin; select pg_temp.sign_in(:mom); select pg_temp.seen() as r_mom_off \gset
commit;
update app.center_modules set enabled = true where center_id = :c1 and module_key = 'gyan_path';
select pg_temp.assert(:'r_mom_off' = '0/0', 'with Gyan Path off the reminders are hidden');
