-- 0570: interactive Gyan Path activities and points for practice tries.
-- New kinds (hotspot, voice) with checked payloads and typed quiz questions; app.record_gyan_attempt only for members
-- of the community, refused while Gyan Path is off; successful tries pay repeat_points up to the daily cap (default 10,
-- rules.points.gyan_practice_daily_cap) per person per step per COMMUNITY-LOCAL day, then 0; failed tries are recorded
-- and pay nothing; a success completes the step (step points still once ever); a level pays its points (no sign-off)
-- and its treasure once, also under a SHARED goal; sign-off levels keep paying on approval only; who reads the tries.
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
-- The test community keeps its day on Kiritimati time (UTC+14), so its day and the UTC day differ most hours.
create or replace function pg_temp.center_today() returns date language sql stable as $$ select (now() at time zone 'Pacific/Kiritimati')::date $$;
create or replace function pg_temp.local_midnight() returns timestamptz language sql stable as $$
  select pg_temp.center_today()::timestamp at time zone 'Pacific/Kiritimati' $$;
-- Points the kid holds for one reason and reference.
create or replace function pg_temp.pts(p_reason text, p_ref uuid) returns bigint language sql stable as $$
  select coalesce(sum(points), 0) from app.points_ledger where person_id = '54000000-0000-4000-8000-0000000000a2' and reason = p_reason and ref_id = p_ref $$;
create or replace function pg_temp.rows(p_reason text, p_ref uuid) returns bigint language sql stable as $$
  select count(*) from app.points_ledger where person_id = '54000000-0000-4000-8000-0000000000a2' and reason = p_reason and ref_id = p_ref $$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
\set c1 '''54000000-0000-4000-8000-0000000000c1'''
\set c2 '''54000000-0000-4000-8000-0000000000c2'''
\set mom '''54000000-0000-4000-8000-000000000001'''
\set kid '''54000000-0000-4000-8000-000000000002'''
\set neighbor '''54000000-0000-4000-8000-000000000003'''
\set teacher '''54000000-0000-4000-8000-000000000004'''
\set other '''54000000-0000-4000-8000-000000000005'''
\set p_mom '''54000000-0000-4000-8000-0000000000a1'''
\set p_kid '''54000000-0000-4000-8000-0000000000a2'''
\set p_neighbor '''54000000-0000-4000-8000-0000000000a3'''
\set p_other '''54000000-0000-4000-8000-0000000000a5'''
\set h1 '''54000000-0000-4000-8000-0000000000b1'''
\set h2 '''54000000-0000-4000-8000-0000000000b2'''
\set h3 '''54000000-0000-4000-8000-0000000000b3'''
-- Goals, levels and steps
\set g1 '''54000000-0000-4000-8000-000000000e01'''
\set gs '''54000000-0000-4000-8000-000000000e02'''
\set g2 '''54000000-0000-4000-8000-000000000e03'''
\set l1 '''54000000-0000-4000-8000-000000000f01'''
\set l2 '''54000000-0000-4000-8000-000000000f02'''
\set l3 '''54000000-0000-4000-8000-000000000f03'''
\set ls '''54000000-0000-4000-8000-000000000f04'''
\set l4 '''54000000-0000-4000-8000-000000000f05'''
\set s1 '''54000000-0000-4000-8000-000000000d01'''
\set s2 '''54000000-0000-4000-8000-000000000d02'''
\set s3 '''54000000-0000-4000-8000-000000000d03'''
\set s5 '''54000000-0000-4000-8000-000000000d05'''
\set s6 '''54000000-0000-4000-8000-000000000d06'''
\set ss '''54000000-0000-4000-8000-000000000d07'''
\set s4 '''54000000-0000-4000-8000-000000000d04'''

insert into auth.users (id, email) values (:mom, 'mom54@example.com'), (:kid, 'kid54@example.com'), (:neighbor, 'nb54@example.com'),
  (:teacher, 'teacher54@example.com'), (:other, 'other54@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:c1, 'gyan54', 'Gyan 54 Community', 'G54', 'TX', 'active', 'Pacific/Kiritimati'),
  (:c2, 'gyan54b', 'Other 54 Community', 'G54B', 'TX', 'active', 'America/Chicago');
insert into app.households (id, center_id, display_name) values (:h1, :c1, 'Shah household 54'), (:h2, :c1, 'Mehta household 54'), (:h3, :c2, 'Doshi household 54');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (:p_mom, :c1, 'Mira', 'Shah', date '1982-01-01'),
  (:p_kid, :c1, 'Anya', 'Shah', (current_date - interval '10 years')::date),
  (:p_neighbor, :c1, 'Raj', 'Mehta', date '1980-05-05'),
  (:p_other, :c2, 'Kiran', 'Doshi', date '1979-03-03');
insert into app.household_members (household_id, person_id, center_id, role) values
  (:h1, :p_mom, :c1, 'primary'), (:h1, :p_kid, :c1, 'child'), (:h2, :p_neighbor, :c1, 'primary'), (:h3, :p_other, :c2, 'primary');
insert into app.center_users (center_id, user_id, person_id) values
  (:c1, :mom, :p_mom), (:c1, :kid, :p_kid), (:c1, :neighbor, :p_neighbor), (:c2, :other, :p_other);
insert into app.role_grants (center_id, user_id, role_key) values (:c1, :teacher, 'teacher');

-- L1: no sign-off, 20 points + 50 treasure; steps S1 practice (10 + 3 a try) and S2 read (5).
-- L2: needs a teacher sign-off, 20 points; step S3 hotspot practice (10 + 3 a try).
-- L3: S5 practice (0 + 2 a try) and S6 practice (0 + 4 a try), for the cap and the day.
-- LS: a SHARED goal (center_id null), no sign-off, 20 + 50 treasure; step SS voice (15 + 3 a try).
-- L4: another community's goal.
insert into app.gyan_goals (id, center_id, key, name) values (:g1, :c1, 'g54', 'Learn 54'), (:gs, null, 'shared54', 'Shared 54'), (:g2, :c2, 'other54', 'Other 54');
insert into app.gyan_levels (id, goal_id, key, name, sort_order, points, treasure, treasure_points, requires_teacher_signoff) values
  (:l1, :g1, '1', 'Foundations', 1, 20, 'Foundations badge', 50, false),
  (:l2, :g1, '2', 'Perform with your teacher', 2, 20, null, 0, true),
  (:l3, :g1, '3', 'Practice ground', 3, 0, null, 0, false),
  (:ls, :gs, '1', 'Shared level', 1, 20, 'Shared badge', 50, false),
  (:l4, :g2, '1', 'Other level', 1, 20, null, 0, false);
insert into app.gyan_steps (id, level_id, kind, title, sort_order, points, repeat_points, activity) values
  (:s1, :l1, 'practice', 'Practise the greeting', 1, 10, 3, '{"review": "needs_pathshala_review"}'),
  (:s2, :l1, 'read', 'What is Samayik', 2, 5, 0, '{"cards": [{"title": "Equanimity", "body_md": "Samayik is 48 minutes of calm.", "emoji": "🪔"}], "review": "needs_pathshala_review"}'),
  (:s3, :l2, 'hotspot', 'Tap the nine places', 1, 10, 3,
   '{"image": "asset:mahavir-murti", "mode": "practice", "intro": "Tap in order.", "spots": [{"key": "toes", "order": 1, "label": "Toes", "x": 0.42, "y": 0.92, "r": 0.05, "say": "Right toe first", "why": "Own words"}, {"key": "knees", "order": 2, "label": "Knees", "x": 0.45, "y": 0.75, "r": 0.05}]}'),
  (:s5, :l3, 'practice', 'Cap practice', 1, 0, 2, '{}'),
  (:s6, :l3, 'practice', 'Day practice', 2, 0, 4, '{}'),
  (:ss, :ls, 'voice', 'Say the first line', 1, 15, 3,
   '{"lang": "hi-IN", "mode": "listen_repeat_say", "pass_ratio": 0.7, "verses": [{"text": "णमो अरिहंताणं", "translit": "Namo Arihantanam", "meaning": "I bow to the Arihants."}]}'),
  (:s4, :l4, 'practice', 'Elsewhere', 1, 10, 3, '{}');

-- ── The schema ─────────────────────────────────────────────────────────────
select pg_temp.assert((select count(*) from app.gyan_steps where id in (:s3, :ss) and kind in ('hotspot', 'voice')) = 2,
  'hotspot and voice are step kinds');
select pg_temp.assert((select column_default from information_schema.columns where table_schema = 'app' and table_name = 'gyan_steps' and column_name = 'activity') like '''{}''%'
                      and (select is_nullable from information_schema.columns where table_schema = 'app' and table_name = 'gyan_steps' and column_name = 'activity') = 'NO'
                      and (select column_default from information_schema.columns where table_schema = 'app' and table_name = 'gyan_steps' and column_name = 'repeat_points') = '0'
                      and (select column_default from information_schema.columns where table_schema = 'app' and table_name = 'gyan_levels' and column_name = 'treasure_points') = '0',
  'activity defaults to {} (never null); repeat_points and treasure_points default to 0');
insert into app.gyan_steps (level_id, kind, title, quiz) values
  (:l3, 'quiz', 'Old-style quiz', '[{"q": "Which Tirthankar?", "options": ["Mahavir", "Parshvanath"], "answer": 1}]'),
  (:l3, 'quiz', 'Portal quiz', '{"questions": [{"question": "How many lines?", "options": ["5", "9"], "answer": 1}]}'),
  (:l3, 'quiz', 'Typed quiz', '{"questions": [
     {"type": "choice", "question": "Who?", "options": ["A", "B", "C"], "answer": 2, "explain": "C it is."},
     {"type": "truefalse", "statement": "Samayik lasts 48 minutes.", "answer": true},
     {"type": "order", "prompt": "Put in order", "items": ["one", "two", "three"]},
     {"type": "match", "prompt": "Match", "pairs": [["Namo", "I bow"], ["Arihantanam", "to the Arihants"]]},
     {"type": "fill", "sentence": "Namo ___", "answer": "Arihantanam", "options": ["Arihantanam", "Siddhanam"]}]}');
select pg_temp.assert((select count(*) from app.gyan_steps where level_id = :l3 and kind = 'quiz') = 3,
  'the older bare list, the portal''s one-question quiz and all five typed questions are accepted');
select pg_temp.assert_raises($$insert into app.gyan_steps (level_id, kind, title, activity) values ('54000000-0000-4000-8000-000000000f03', 'hotspot', 'Bad spots', '{"image": "asset:mahavir-murti", "mode": "practice", "spots": [{"key": "toes", "order": 1, "label": "Toes", "x": 1.4, "y": 0.9, "r": 0.05}]}')$$,
  'fraction of the picture', 'a hotspot outside the picture is refused in plain English');
select pg_temp.assert_raises($$insert into app.gyan_steps (level_id, kind, title, activity) values ('54000000-0000-4000-8000-000000000f03', 'hotspot', 'No picture', '{"mode": "learn", "spots": [{"key": "a", "order": 1, "label": "A", "x": 0.1, "y": 0.1, "r": 0.1}]}')$$,
  'needs an "image"', 'a hotspot step without a picture is refused');
select pg_temp.assert_raises($$insert into app.gyan_steps (level_id, kind, title, activity) values ('54000000-0000-4000-8000-000000000f03', 'hotspot', 'Twice', '{"image": "https://example.org/m.png", "mode": "learn", "spots": [{"key": "a", "order": 1, "label": "A", "x": 0.1, "y": 0.1, "r": 0.1}, {"key": "a", "order": 1, "label": "B", "x": 0.2, "y": 0.2, "r": 0.1}]}')$$,
  'used twice', 'two spots with the same key or order are refused');
select pg_temp.assert_raises($$insert into app.gyan_steps (level_id, kind, title, activity) values ('54000000-0000-4000-8000-000000000f03', 'voice', 'No verses', '{"lang": "hi-IN", "mode": "listen_repeat_say", "verses": []}')$$,
  'needs "verses"', 'a voice step without verses is refused');
select pg_temp.assert_raises($$insert into app.gyan_steps (level_id, kind, title, activity) values ('54000000-0000-4000-8000-000000000f03', 'voice', 'Bad ratio', '{"lang": "hi-IN", "mode": "listen_repeat_say", "pass_ratio": 7, "verses": [{"text": "Namo"}]}')$$,
  'pass_ratio', 'a pass ratio above 1 is refused');
select pg_temp.assert_raises($$insert into app.gyan_steps (level_id, kind, title, activity) values ('54000000-0000-4000-8000-000000000f03', 'read', 'Bad card', '{"cards": [{"title": "No body"}]}')$$,
  'body_md', 'a learn card without its text is refused');
select pg_temp.assert_raises($$insert into app.gyan_steps (level_id, kind, title, activity) values ('54000000-0000-4000-8000-000000000f03', 'read', 'Bad image', '{"cards": [{"title": "T", "body_md": "B", "image": "http://insecure.example/x.png"}]}')$$,
  'https address', 'a card picture over plain http is refused');
select pg_temp.assert_raises($$insert into app.gyan_steps (level_id, kind, title, quiz) values ('54000000-0000-4000-8000-000000000f03', 'quiz', 'Bad fill', '{"questions": [{"type": "fill", "sentence": "Namo ___", "answer": "Siddhanam", "options": ["Arihantanam", "Ayariyanam"]}]}')$$,
  'one of the options', 'a fill-in whose answer is not among the options is refused');
select pg_temp.assert_raises($$insert into app.gyan_steps (level_id, kind, title, quiz) values ('54000000-0000-4000-8000-000000000f03', 'quiz', 'Bad type', '{"questions": [{"type": "essay", "question": "Write"}]}')$$,
  'not a question type', 'an unknown question type is refused');
select pg_temp.assert_raises($$insert into app.gyan_steps (level_id, kind, title, quiz) values ('54000000-0000-4000-8000-000000000f03', 'quiz', 'Bad answer', '{"questions": [{"question": "Q", "options": ["a", "b"], "answer": 2}]}')$$,
  'counting from 0', 'a choice answer outside the options is refused');
select pg_temp.assert_raises($$insert into app.gyan_steps (level_id, kind, title) values ('54000000-0000-4000-8000-000000000f03', 'game', 'Nope')$$,
  'gyan_steps_kind_check', 'an unknown kind is still refused');
select pg_temp.assert(array_length(app.gyan_activity_problems('hotspot', '{"image": "asset:x", "mode": "fly", "spots": "none"}'), 1) = 2
                      and app.gyan_activity_problems('listen', '{"tip": "Breathe"}') = '{}'::text[]
                      and app.gyan_quiz_problems(null) = '{}'::text[],
  'the checkers list every problem and pass what is fine');

-- Earlier points reasons still work, next to the two new ones.
insert into app.points_ledger (center_id, person_id, points, reason, note) values (:c1, :p_mom, 1, 'survey', 'test 54'), (:c1, :p_mom, 1, 'practice', 'test 54');
select pg_temp.assert((select count(*) from app.points_ledger where person_id = :p_mom and note = 'test 54') = 2, 'existing points reasons stay valid');

-- ── Who may call it, and who may write tries ───────────────────────────────
select pg_temp.assert(has_function_privilege('authenticated', 'app.record_gyan_attempt(uuid, uuid, boolean, integer, jsonb)', 'execute')
                      and not has_function_privilege('anon', 'app.record_gyan_attempt(uuid, uuid, boolean, integer, jsonb)', 'execute')
                      and not has_function_privilege('authenticated', 'app.gyan_award_level_bonus(uuid, uuid, uuid)', 'execute'),
  'signed-in members can record a try; anonymous callers cannot; the level award is internal');
select pg_temp.assert(has_table_privilege('authenticated', 'app.gyan_attempts', 'select')
                      and not has_table_privilege('authenticated', 'app.gyan_attempts', 'insert')
                      and not has_table_privilege('authenticated', 'app.gyan_attempts', 'update')
                      and not has_table_privilege('authenticated', 'app.gyan_attempts', 'delete'),
  'tries are read-only over the API: only the RPC writes them');
select pg_temp.assert(exists (select 1 from pg_policy where polrelid = 'app.gyan_attempts'::regclass and polname = 'module_switch' and not polpermissive)
                      and (select module_key from app.module_tables where table_name = 'gyan_attempts') = 'gyan_path'
                      and exists (select 1 from pg_trigger where tgrelid = 'app.gyan_attempts'::regclass and tgname = 'audit_gyan_attempts'),
  'gyan_attempts belongs to the Gyan Path module (switch policy) and is audited');

select pg_temp.assert_raises($$select app.record_gyan_attempt('54000000-0000-4000-8000-0000000000c1', '54000000-0000-4000-8000-000000000d01', true)$$,
  'sign in', 'a signed-out caller is refused');
begin;
select pg_temp.sign_in(:other);
select pg_temp.assert_raises($$select app.record_gyan_attempt('54000000-0000-4000-8000-0000000000c1', '54000000-0000-4000-8000-000000000d01', true)$$,
  'only members of this community', 'a member of another community cannot practise here');
commit;
begin;
select pg_temp.sign_in(:teacher);
select pg_temp.assert_raises($$select app.record_gyan_attempt('54000000-0000-4000-8000-0000000000c1', '54000000-0000-4000-8000-000000000d01', true)$$,
  'only members of this community', 'staff without a member record cannot record tries');
commit;
begin;
select pg_temp.sign_in(:kid);
select pg_temp.assert_raises($$select app.record_gyan_attempt('54000000-0000-4000-8000-0000000000c1', '54000000-0000-4000-8000-000000000d04', true)$$,
  'belongs to another community', 'a lesson of another community is refused');
select pg_temp.assert_raises($$select app.record_gyan_attempt('54000000-0000-4000-8000-0000000000c1', '54000000-0000-4000-8000-000000000dff', true)$$,
  'was not found', 'an unknown step is refused');
select pg_temp.assert_raises($$select app.record_gyan_attempt('54000000-0000-4000-8000-0000000000c1', '54000000-0000-4000-8000-000000000d01', true, 101)$$,
  'between 0 and 100', 'a score above 100 is refused');
select pg_temp.assert_raises($$select app.record_gyan_attempt('54000000-0000-4000-8000-0000000000c1', '54000000-0000-4000-8000-000000000d01', true, null, '[1]')$$,
  'JSON object', 'details that are not an object are refused');
select pg_temp.assert_raises($$insert into app.gyan_attempts (center_id, person_id, step_id, success) values ('54000000-0000-4000-8000-0000000000c1', '54000000-0000-4000-8000-0000000000a2', '54000000-0000-4000-8000-000000000d01', true)$$,
  'permission denied', 'a member cannot write a try directly');
commit;

insert into app.center_modules (center_id, module_key, enabled, reason) values (:c1, 'gyan_path', false, 'test 54')
  on conflict (center_id, module_key) do update set enabled = false;
begin;
select pg_temp.sign_in(:kid);
select pg_temp.assert_raises($$select app.record_gyan_attempt('54000000-0000-4000-8000-0000000000c1', '54000000-0000-4000-8000-000000000d01', true)$$,
  'module is switched off', 'with Gyan Path switched off a try is refused');
commit;
update app.center_modules set enabled = true where center_id = :c1 and module_key = 'gyan_path';
select pg_temp.assert(not exists (select 1 from app.gyan_attempts where center_id = :c1) and not exists (select 1 from app.points_ledger where person_id = :p_kid),
  'no refused call recorded a try or paid a point');

-- ── Tries: failures, the first success, the cap ────────────────────────────
begin;
select pg_temp.sign_in(:kid);
select app.record_gyan_attempt(:c1::uuid, :s1::uuid, false, 30, '{"wrong": ["knees"]}') as f1 \gset
commit;
select pg_temp.assert((:'f1'::jsonb->>'points_awarded')::int = 0 and (:'f1'::jsonb->>'tries_today')::int = 0 and (:'f1'::jsonb->>'cap')::int = 10
                      and (:'f1'::jsonb->>'first_time')::boolean = false,
  'a failed try earns nothing and does not count as a try today (the cap is 10 by default)');
select pg_temp.assert((select count(*) = 1 and bool_and(not success and score = 30 and detail = '{"wrong": ["knees"]}'::jsonb and points = 0 and center_id = :c1::uuid)
                         from app.gyan_attempts where person_id = :p_kid and step_id = :s1)
                      and not exists (select 1 from app.gyan_progress where person_id = :p_kid and step_id = :s1),
  'the failed try is recorded with its score and details, and the step is not completed');

begin;
select pg_temp.sign_in(:kid);
select app.record_gyan_attempt(:c1::uuid, :s1::uuid, true, 95) as t1 \gset
select app.record_gyan_attempt(:c1::uuid, :s1::uuid, true) as t2 \gset
commit;
select pg_temp.assert(:'t1'::jsonb = '{"points_awarded": 13, "tries_today": 1, "cap": 10, "first_time": true, "try_points": 3, "step_points": 10, "level_points": 0, "treasure_points": 0, "level_complete": false}'::jsonb,
  'the first success pays the try (3) and, as the first completion, the step''s points (10)');
select pg_temp.assert(:'t2'::jsonb = '{"points_awarded": 3, "tries_today": 2, "cap": 10, "first_time": false, "try_points": 3, "step_points": 0, "level_points": 0, "treasure_points": 0, "level_complete": false}'::jsonb,
  'the next success pays only the try');
select pg_temp.assert((select completed_at is not null and stars = 3 and center_id = :c1::uuid from app.gyan_progress where person_id = :p_kid and step_id = :s1),
  'a success completes the step (a 95 score is three stars)');

begin;
select pg_temp.sign_in(:kid);
select app.record_gyan_attempt(:c1::uuid, :s1::uuid, true);
select app.record_gyan_attempt(:c1::uuid, :s1::uuid, true);
select app.record_gyan_attempt(:c1::uuid, :s1::uuid, true);
select app.record_gyan_attempt(:c1::uuid, :s1::uuid, false);
select app.record_gyan_attempt(:c1::uuid, :s1::uuid, true);
select app.record_gyan_attempt(:c1::uuid, :s1::uuid, true);
select app.record_gyan_attempt(:c1::uuid, :s1::uuid, true);
select app.record_gyan_attempt(:c1::uuid, :s1::uuid, true) as t10 \gset
select app.record_gyan_attempt(:c1::uuid, :s1::uuid, true) as t11 \gset
select app.record_gyan_attempt(:c1::uuid, :s1::uuid, true) as t12 \gset
commit;
select pg_temp.assert((:'t10'::jsonb->>'points_awarded')::int = 3 and (:'t10'::jsonb->>'tries_today')::int = 9,
  'tries 3 to 9 pay (a failed one in between changes nothing)');
select pg_temp.assert((:'t11'::jsonb->>'points_awarded')::int = 3 and (:'t11'::jsonb->>'tries_today')::int = 10,
  'the tenth successful try today still pays');
select pg_temp.assert((:'t12'::jsonb->>'points_awarded')::int = 0 and (:'t12'::jsonb->>'tries_today')::int = 11 and (:'t12'::jsonb->>'cap')::int = 10,
  'the eleventh pays 0: the daily cap is reached');
select pg_temp.assert(pg_temp.rows('gyan_try', :s1) = 10 and pg_temp.pts('gyan_try', :s1) = 30,
  'ten try awards of 3 points, one ledger row each');
select pg_temp.assert(pg_temp.rows('level', :s1) = 1 and pg_temp.pts('level', :s1) = 10,
  'the step''s own points were paid once');
select pg_temp.assert((select count(*) from app.gyan_attempts where person_id = :p_kid and step_id = :s1) = 13
                      and (select count(*) from app.gyan_attempts where person_id = :p_kid and step_id = :s1 and not success) = 2
                      and (select sum(points) from app.gyan_attempts where person_id = :p_kid and step_id = :s1) = 30,
  'every try is recorded, paid or not, with what it earned');

-- The cap is the community's rule.
update app.centers set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{points}', coalesce(rules->'points', '{}'::jsonb) || '{"gyan_practice_daily_cap": 2}') where id = :c1;
begin;
select pg_temp.sign_in(:kid);
select app.record_gyan_attempt(:c1::uuid, :s5::uuid, true) as k1 \gset
select app.record_gyan_attempt(:c1::uuid, :s5::uuid, true) as k2 \gset
select app.record_gyan_attempt(:c1::uuid, :s5::uuid, true) as k3 \gset
commit;
select pg_temp.assert((:'k1'::jsonb->>'points_awarded')::int = 2 and (:'k2'::jsonb->>'points_awarded')::int = 2
                      and (:'k3'::jsonb->>'points_awarded')::int = 0 and (:'k3'::jsonb->>'cap')::int = 2,
  'with gyan_practice_daily_cap = 2 the third try pays nothing');
update app.centers set rules = jsonb_set(rules, '{points,gyan_practice_daily_cap}', '0') where id = :c1;
begin;
select pg_temp.sign_in(:kid);
select app.record_gyan_attempt(:c1::uuid, :s6::uuid, true) as k0 \gset
commit;
select pg_temp.assert((:'k0'::jsonb->>'points_awarded')::int = 0 and (:'k0'::jsonb->>'cap')::int = 0 and (:'k0'::jsonb->>'tries_today')::int = 1,
  'a cap of 0 switches try points off (the try is still recorded)');
update app.centers set rules = rules #- '{points,gyan_practice_daily_cap}' where id = :c1;
delete from app.gyan_attempts where person_id = :p_kid and step_id in (:s5, :s6);

-- ── The day is the community's day ─────────────────────────────────────────
-- Ten successful tries one second before the community's midnight are yesterday's: today starts at zero.
insert into app.gyan_attempts (center_id, person_id, step_id, success, created_at)
select :c1, :p_kid, :s6, true, pg_temp.local_midnight() - interval '1 second' from generate_series(1, 10);
begin;
select pg_temp.sign_in(:kid);
select app.record_gyan_attempt(:c1::uuid, :s6::uuid, true) as d1 \gset
commit;
select pg_temp.assert((:'d1'::jsonb->>'points_awarded')::int = 4 and (:'d1'::jsonb->>'tries_today')::int = 1,
  'tries just before the community''s local midnight count for yesterday, so today''s first try pays');
-- Nine more one second after the community's midnight are today's: with the one above that is ten.
insert into app.gyan_attempts (center_id, person_id, step_id, success, created_at)
select :c1, :p_kid, :s6, true, pg_temp.local_midnight() + interval '1 second' from generate_series(1, 9);
begin;
select pg_temp.sign_in(:kid);
select app.record_gyan_attempt(:c1::uuid, :s6::uuid, true) as d2 \gset
commit;
select pg_temp.assert((:'d2'::jsonb->>'points_awarded')::int = 0 and (:'d2'::jsonb->>'tries_today')::int = 11,
  'tries just after the community''s local midnight count for today, so the cap holds');
-- Move today's S1 tries to yesterday: the next try pays again.
update app.gyan_attempts set created_at = created_at - interval '1 day' where person_id = :p_kid and step_id = :s1;
begin;
select pg_temp.sign_in(:kid);
select app.record_gyan_attempt(:c1::uuid, :s1::uuid, true) as d3 \gset
commit;
select pg_temp.assert((:'d3'::jsonb->>'points_awarded')::int = 3 and (:'d3'::jsonb->>'tries_today')::int = 1,
  'on a new day the tries start again at one');

-- ── Completing a level ─────────────────────────────────────────────────────
-- S2 is completed the way the member app does it today (a gyan_progress write of your own): L1's points and treasure.
begin;
select pg_temp.sign_in(:kid);
insert into app.gyan_progress (center_id, person_id, step_id, stars, completed_at) values (:c1, :p_kid, :s2, 2, now());
commit;
select pg_temp.assert(pg_temp.pts('level', :s2) = 5 and pg_temp.pts('level', :l1) = 20 and pg_temp.pts('gyan_treasure', :l1) = 50,
  'finishing the last step of a level with no sign-off pays the step (5), the level (20) and its treasure (50)');
select pg_temp.assert((select note from app.points_ledger where person_id = :p_kid and reason = 'gyan_treasure' and ref_id = :l1) = 'Gyan Path treasure: Foundations badge',
  'the treasure is named in the ledger');
-- Replays: completing the step again, or more tries, pay no bonus twice.
update app.gyan_progress set completed_at = null where person_id = :p_kid and step_id = :s2;
update app.gyan_progress set completed_at = now() where person_id = :p_kid and step_id = :s2;
begin;
select pg_temp.sign_in(:kid);
select app.record_gyan_attempt(:c1::uuid, :s1::uuid, true) as r1 \gset
commit;
select pg_temp.assert(pg_temp.rows('level', :l1) = 1 and pg_temp.rows('gyan_treasure', :l1) = 1 and pg_temp.rows('level', :s2) = 1,
  'redoing a finished level pays neither its points nor its treasure again, nor the step''s points');
select pg_temp.assert((:'r1'::jsonb->>'points_awarded')::int = 3 and (:'r1'::jsonb->>'level_complete')::boolean,
  'a try on a finished level pays the try only, and says the level is complete');
-- A sign-off approved later for a level that already paid on completion pays nothing more.
insert into app.gyan_signoffs (center_id, person_id, level_id) values (:c1, :p_kid, :l1);
update app.gyan_signoffs set status = 'approved' where person_id = :p_kid and level_id = :l1;
select pg_temp.assert(pg_temp.rows('level', :l1) = 1, 'a later sign-off approval cannot pay the level a second time');

-- Existing step points stay once ever, even when the progress row is reset and the step completed again.
update app.gyan_progress set completed_at = null where person_id = :p_kid and step_id = :s1;
begin;
select pg_temp.sign_in(:kid);
select app.record_gyan_attempt(:c1::uuid, :s1::uuid, true) as r2 \gset
commit;
select pg_temp.assert((:'r2'::jsonb->>'first_time')::boolean and (:'r2'::jsonb->>'step_points')::int = 0 and pg_temp.rows('level', :s1) = 1,
  'a step completed again after a reset pays its points no second time');

-- A level that needs a teacher sign-off: completing it pays the step and tries, never the level; approval pays it once.
begin;
select pg_temp.sign_in(:kid);
select app.record_gyan_attempt(:c1::uuid, :s3::uuid, true, 80, '{"taps": ["toes", "knees"]}') as h1 \gset
commit;
select pg_temp.assert(:'h1'::jsonb = '{"points_awarded": 13, "tries_today": 1, "cap": 10, "first_time": true, "try_points": 3, "step_points": 10, "level_points": 0, "treasure_points": 0, "level_complete": true}'::jsonb,
  'completing a sign-off level pays the step and the try but not the level');
select pg_temp.assert(pg_temp.rows('level', :l2) = 0, 'no level points before the teacher signs off');
insert into app.gyan_signoffs (center_id, person_id, level_id) values (:c1, :p_kid, :l2);
update app.gyan_signoffs set status = 'approved' where person_id = :p_kid and level_id = :l2;
update app.gyan_signoffs set status = 'needs_work' where person_id = :p_kid and level_id = :l2;
update app.gyan_signoffs set status = 'approved' where person_id = :p_kid and level_id = :l2;
select pg_temp.assert(pg_temp.rows('level', :l2) = 1 and pg_temp.pts('level', :l2) = 20,
  'the teacher''s approval pays the level''s 20 points once, as before');

-- A SHARED goal: the community is the person's; one try can pay the try, the step, the level and its treasure.
begin;
select pg_temp.sign_in(:kid);
select app.record_gyan_attempt(:c1::uuid, :ss::uuid, true, 72, '{"fix": []}') as v1 \gset
select app.record_gyan_attempt(:c1::uuid, :ss::uuid, true) as v2 \gset
commit;
select pg_temp.assert(:'v1'::jsonb = '{"points_awarded": 88, "tries_today": 1, "cap": 10, "first_time": true, "try_points": 3, "step_points": 15, "level_points": 20, "treasure_points": 50, "level_complete": true}'::jsonb,
  'under a shared goal the first success pays 3 + 15 + 20 + 50');
select pg_temp.assert((:'v2'::jsonb->>'points_awarded')::int = 3, 'and the next one only the try');
select pg_temp.assert((select bool_and(center_id = :c1::uuid) from app.points_ledger where person_id = :p_kid and ref_id in (:ss, :ls))
                      and (select bool_and(center_id = :c1::uuid) from app.gyan_attempts where step_id = :ss),
  'points and tries for a shared lesson belong to the person''s community');

-- ── Who reads the tries ────────────────────────────────────────────────────
select count(*) as n_all from app.gyan_attempts where person_id = :p_kid \gset
begin;
select pg_temp.sign_in(:kid);
select count(*) as n_kid from app.gyan_attempts \gset
commit;
begin;
select pg_temp.sign_in(:mom);
select count(*) as n_mom from app.gyan_attempts where person_id = :p_kid \gset
commit;
begin;
select pg_temp.sign_in(:neighbor);
select count(*) as n_nb from app.gyan_attempts \gset
commit;
begin;
select pg_temp.sign_in(:teacher);
select count(*) as n_teacher from app.gyan_attempts where person_id = :p_kid \gset
commit;
begin;
select pg_temp.sign_in(:other);
select count(*) as n_other from app.gyan_attempts \gset
commit;
select pg_temp.assert(:'n_kid'::int = :'n_all'::int and :'n_all'::int > 0, 'the learner reads all their own tries');
select pg_temp.assert(:'n_mom'::int = :'n_all'::int, 'a parent (adult of the household) reads their child''s tries');
select pg_temp.assert(:'n_nb'::int = 0, 'another family of the same community reads none');
select pg_temp.assert(:'n_teacher'::int = :'n_all'::int, 'a Pathshala teacher reads them');
select pg_temp.assert(:'n_other'::int = 0, 'a member of another community reads none');
update app.center_modules set enabled = false where center_id = :c1 and module_key = 'gyan_path';
begin;
select pg_temp.sign_in(:kid);
select count(*) as n_off from app.gyan_attempts \gset
commit;
update app.center_modules set enabled = true where center_id = :c1 and module_key = 'gyan_path';
select pg_temp.assert(:'n_off'::int = 0, 'with Gyan Path switched off the tries are hidden too');
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'gyan_attempts' and center_id = :c1::uuid and module = 'gyan_path') > 0,
  'tries are audited under the community and the Gyan Path module');
