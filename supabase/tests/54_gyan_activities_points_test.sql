-- 0570: interactive Gyan Path activities and points for practice tries.
-- New kinds (hotspot, voice) with checked payloads and typed quiz questions; try points only on tap-the-spots practice
-- and voice steps; app.record_gyan_attempt only for members of the community, refused while Gyan Path is off;
-- successful tries pay repeat_points up to the daily cap (default 10, rules.points.gyan_practice_daily_cap, clamped to
-- 0-1000) per person per step per COMMUNITY-LOCAL day, then 0; failed tries are recorded and pay nothing; a success
-- completes the step (step points still once ever); a level pays its points (no sign-off) and its treasure once, also
-- under a SHARED goal; sign-off levels keep paying on approval only; a progress row for another community's lesson is
-- refused and stars / completions never go backwards; a try sent twice (same try_id) is recorded and paid once; at most
-- 200 tries per step and day are stored; who reads the tries (class teachers only while the learner is in the class).
-- Not covered here: two connections racing (the per person+step and per person+level locks are never contended in a
-- single-session test); see BACKLOG B44.
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
\set classteacher '''54000000-0000-4000-8000-000000000006'''
\set p_mom '''54000000-0000-4000-8000-0000000000a1'''
\set p_kid '''54000000-0000-4000-8000-0000000000a2'''
\set p_neighbor '''54000000-0000-4000-8000-0000000000a3'''
\set p_other '''54000000-0000-4000-8000-0000000000a5'''
\set p_other1 '''54000000-0000-4000-8000-0000000000a6'''
\set h1 '''54000000-0000-4000-8000-0000000000b1'''
\set h2 '''54000000-0000-4000-8000-0000000000b2'''
\set h3 '''54000000-0000-4000-8000-0000000000b3'''
\set h4 '''54000000-0000-4000-8000-0000000000b4'''
-- Goals, levels and steps
\set g1 '''54000000-0000-4000-8000-000000000e01'''
\set gs '''54000000-0000-4000-8000-000000000e02'''
\set g2 '''54000000-0000-4000-8000-000000000e03'''
\set l1 '''54000000-0000-4000-8000-000000000f01'''
\set l2 '''54000000-0000-4000-8000-000000000f02'''
\set l3 '''54000000-0000-4000-8000-000000000f03'''
\set ls '''54000000-0000-4000-8000-000000000f04'''
\set l4 '''54000000-0000-4000-8000-000000000f05'''
\set l5 '''54000000-0000-4000-8000-000000000f06'''
\set l6 '''54000000-0000-4000-8000-000000000f07'''
\set s1 '''54000000-0000-4000-8000-000000000d01'''
\set s2 '''54000000-0000-4000-8000-000000000d02'''
\set s3 '''54000000-0000-4000-8000-000000000d03'''
\set s4 '''54000000-0000-4000-8000-000000000d04'''
\set s5 '''54000000-0000-4000-8000-000000000d05'''
\set s6 '''54000000-0000-4000-8000-000000000d06'''
\set ss '''54000000-0000-4000-8000-000000000d07'''
\set s7 '''54000000-0000-4000-8000-000000000d08'''
\set s8 '''54000000-0000-4000-8000-000000000d09'''
\set s9 '''54000000-0000-4000-8000-000000000d0a'''
\set s10 '''54000000-0000-4000-8000-000000000d0b'''
\set sq '''54000000-0000-4000-8000-000000000d0c'''
-- Pathshala: a term, a class and the kid's place in it (for the class teacher)
\set term '''54000000-0000-4000-8000-000000000a01'''
\set track '''54000000-0000-4000-8000-000000000a02'''
\set plevel '''54000000-0000-4000-8000-000000000a03'''
\set class '''54000000-0000-4000-8000-000000000a04'''
\set enr '''54000000-0000-4000-8000-000000000a05'''

insert into auth.users (id, email) values (:mom, 'mom54@example.com'), (:kid, 'kid54@example.com'), (:neighbor, 'nb54@example.com'),
  (:teacher, 'teacher54@example.com'), (:other, 'other54@example.com'), (:classteacher, 'classteacher54@example.com');
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

-- L1: no sign-off, 20 points + 50 treasure; steps S1 tap-the-spots practice (10 + 3 a try) and S2 read (5).
-- L2: needs a teacher sign-off, 20 points + 40 treasure; step S3 tap-the-spots practice (10 + 3 a try).
-- L3: S5 (0 + 2 a try) and S6 (0 + 4 a try), tap-the-spots practice, for the cap and the day.
-- LS: a SHARED goal (center_id null), no sign-off, 20 + 50 treasure; step SS voice (15 + 3 a try).
-- L4: another community's goal, 20 + 30 treasure; step S4 practice (10).
-- L5: S9 (5 + 1 a try) for the storage limit and S10 (0 + 2 a try) for a try sent twice.
-- L6: no sign-off, 20 + 30 treasure, approved by a teacher before it is finished; step S8 read (5).
insert into app.gyan_goals (id, center_id, key, name) values (:g1, :c1, 'g54', 'Learn 54'), (:gs, null, 'shared54', 'Shared 54'), (:g2, :c2, 'other54', 'Other 54');
insert into app.gyan_levels (id, goal_id, key, name, sort_order, points, treasure, treasure_points, requires_teacher_signoff) values
  (:l1, :g1, '1', 'Foundations', 1, 20, 'Foundations badge', 50, false),
  (:l2, :g1, '2', 'Perform with your teacher', 2, 20, 'Performer badge', 40, true),
  (:l3, :g1, '3', 'Practice ground', 3, 0, null, 0, false),
  (:ls, :gs, '1', 'Shared level', 1, 20, 'Shared badge', 50, false),
  (:l4, :g2, '1', 'Other level', 1, 20, 'Other badge', 30, false),
  (:l5, :g1, '5', 'Extra checks', 5, 0, null, 0, false),
  (:l6, :g1, '6', 'Signed off early', 6, 20, 'Early badge', 30, false);
insert into app.gyan_steps (id, level_id, kind, title, sort_order, points, repeat_points, activity) values
  (:s1, :l1, 'hotspot', 'Practise the greeting', 1, 10, 3,
   '{"image": "asset:mahavir-murti", "mode": "practice", "spots": [{"key": "hands", "order": 1, "label": "Folded hands", "x": 0.5, "y": 0.5, "r": 0.1}], "review": "needs_pathshala_review"}'),
  (:s2, :l1, 'read', 'What is Samayik', 2, 5, 0, '{"cards": [{"title": "Equanimity", "body_md": "Samayik is 48 minutes of calm.", "emoji": "🪔"}], "review": "needs_pathshala_review"}'),
  (:s3, :l2, 'hotspot', 'Tap the nine places', 1, 10, 3,
   '{"image": "asset:mahavir-murti", "mode": "practice", "intro": "Tap in order.", "spots": [{"key": "toes", "order": 1, "label": "Toes", "x": 0.42, "y": 0.92, "r": 0.05, "say": "Right toe first", "why": "Own words"}, {"key": "knees", "order": 2, "label": "Knees", "x": 0.45, "y": 0.75, "r": 0.05}]}'),
  (:s5, :l3, 'hotspot', 'Cap practice', 1, 0, 2,
   '{"image": "asset:mahavir-murti", "mode": "practice", "spots": [{"key": "a", "order": 1, "label": "A", "x": 0.5, "y": 0.5, "r": 0.1}]}'),
  (:s6, :l3, 'hotspot', 'Day practice', 2, 0, 4,
   '{"image": "asset:mahavir-murti", "mode": "practice", "spots": [{"key": "a", "order": 1, "label": "A", "x": 0.5, "y": 0.5, "r": 0.1}]}'),
  (:ss, :ls, 'voice', 'Say the first line', 1, 15, 3,
   '{"lang": "hi-IN", "mode": "listen_repeat_say", "pass_ratio": 0.7, "verses": [{"text": "णमो अरिहंताणं", "translit": "Namo Arihantanam", "meaning": "I bow to the Arihants."}]}'),
  (:s4, :l4, 'practice', 'Elsewhere', 1, 10, 0, '{}'),
  (:s8, :l6, 'read', 'Read after the sign-off', 1, 5, 0, '{}'),
  (:s9, :l5, 'hotspot', 'Practised a lot', 1, 5, 1,
   '{"image": "asset:mahavir-murti", "mode": "practice", "spots": [{"key": "a", "order": 1, "label": "A", "x": 0.5, "y": 0.5, "r": 0.1}]}'),
  (:s10, :l5, 'hotspot', 'Sent twice', 2, 0, 2,
   '{"image": "asset:mahavir-murti", "mode": "practice", "spots": [{"key": "a", "order": 1, "label": "A", "x": 0.5, "y": 0.5, "r": 0.1}]}');

-- ── The schema ─────────────────────────────────────────────────────────────
select pg_temp.assert((select count(*) from app.gyan_steps where id in (:s3, :ss) and kind in ('hotspot', 'voice')) = 2,
  'hotspot and voice are step kinds');
select pg_temp.assert((select column_default from information_schema.columns where table_schema = 'app' and table_name = 'gyan_steps' and column_name = 'activity') like '''{}''%'
                      and (select is_nullable from information_schema.columns where table_schema = 'app' and table_name = 'gyan_steps' and column_name = 'activity') = 'NO'
                      and (select column_default from information_schema.columns where table_schema = 'app' and table_name = 'gyan_steps' and column_name = 'repeat_points') = '0'
                      and (select column_default from information_schema.columns where table_schema = 'app' and table_name = 'gyan_levels' and column_name = 'treasure_points') = '0',
  'activity defaults to {} (never null); repeat_points and treasure_points default to 0');
select pg_temp.assert((select count(*) from pg_constraint where conrelid = 'app.gyan_steps'::regclass and contype = 'c'
                         and pg_get_constraintdef(oid) ~ '\mkind\M') = 2
                      and exists (select 1 from pg_constraint where conrelid = 'app.gyan_steps'::regclass and conname = 'gyan_steps_repeat_points_kind'),
  'two checks on gyan_steps look at the kind: the list of kinds and which kinds may pay for tries');
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
select pg_temp.assert_raises($$insert into app.gyan_steps (level_id, kind, title, quiz) values ('54000000-0000-4000-8000-000000000f03', 'quiz', 'Long question', jsonb_build_object('questions', jsonb_build_array(jsonb_build_object('question', repeat('Why? ', 120), 'options', jsonb_build_array('a', 'b'), 'answer', 0))))$$,
  'needs its "question" (at most 500 characters)', 'a question over the limit is refused with the limit, not as if it were missing');
select pg_temp.assert_raises($$insert into app.gyan_steps (level_id, kind, title, quiz) values ('54000000-0000-4000-8000-000000000f03', 'quiz', 'Long option', jsonb_build_object('questions', jsonb_build_array(jsonb_build_object('question', 'Q', 'options', jsonb_build_array(repeat('a', 250), 'b'), 'answer', 0))))$$,
  'at most 200 characters each', 'an option over the limit says the limit');
select pg_temp.assert_raises($$insert into app.gyan_steps (level_id, kind, title) values ('54000000-0000-4000-8000-000000000f03', 'game', 'Nope')$$,
  'gyan_steps_kind_check', 'an unknown kind is still refused');
select pg_temp.assert(array_length(app.gyan_activity_problems('hotspot', '{"image": "asset:x", "mode": "fly", "spots": "none"}'), 1) = 2
                      and app.gyan_activity_problems('listen', '{"tip": "Breathe"}') = '{}'::text[]
                      and app.gyan_quiz_problems(null) = '{}'::text[],
  'the checkers list every problem and pass what is fine');

-- Points for each try only on tap-the-spots practice and voice steps.
select pg_temp.assert_raises($$insert into app.gyan_steps (level_id, kind, title, repeat_points, quiz) values ('54000000-0000-4000-8000-000000000f03', 'quiz', 'Quiz with tries', 3, '{"questions": [{"question": "Q", "options": ["a", "b"], "answer": 0}]}')$$,
  'only for tap-the-spots practice and voice', 'a quiz step cannot carry points for each try (plain English)');
select pg_temp.assert_raises($$insert into app.gyan_steps (level_id, kind, title, repeat_points) values ('54000000-0000-4000-8000-000000000f03', 'practice', 'Practice with tries', 3)$$,
  'only for tap-the-spots practice and voice', 'nor a practice step (the app records no tries for it)');
select pg_temp.assert_raises($$insert into app.gyan_steps (level_id, kind, title, repeat_points, activity) values ('54000000-0000-4000-8000-000000000f03', 'hotspot', 'Learn with tries', 3, '{"image": "asset:mahavir-murti", "mode": "learn", "spots": [{"key": "a", "order": 1, "label": "A", "x": 0.5, "y": 0.5, "r": 0.1}]}')$$,
  'only for tap-the-spots practice and voice', 'nor a tap-the-spots step in learn mode');
select pg_temp.assert_raises($$update app.gyan_steps set activity = activity || '{"mode": "learn"}' where id = '54000000-0000-4000-8000-000000000d03'$$,
  'only for tap-the-spots practice and voice', 'a practice step that pays for tries cannot be switched to learn mode');
begin;
set local session_replication_role = replica;   -- triggers off: the table's own check still holds
select pg_temp.assert_raises($$insert into app.gyan_steps (level_id, kind, title, repeat_points) values ('54000000-0000-4000-8000-000000000f03', 'read', 'Read with tries', 3)$$,
  'gyan_steps_repeat_points_kind', 'the table itself refuses try points on any other kind');
rollback;

-- Scripts and workers write steps as service_role: the checkers' helpers must run for it too.
select pg_temp.assert(has_function_privilege('service_role', 'app.gyan_is_text(jsonb, integer)', 'execute')
                      and has_function_privilege('service_role', 'app.gyan_num(jsonb)', 'execute')
                      and has_function_privilege('service_role', 'app.gyan_list_len(jsonb)', 'execute')
                      and has_function_privilege('service_role', 'app.gyan_media_ref_ok(jsonb)', 'execute'),
  'service_role may run the step checkers'' helpers');
begin;
set local role service_role;
with i as (
  insert into app.gyan_steps (level_id, kind, title, activity) values (:l3, 'hotspot', 'Written by a script',
    '{"image": "asset:mahavir-murti", "mode": "learn", "spots": [{"key": "a", "order": 1, "label": "A", "x": 0.5, "y": 0.5, "r": 0.1}]}')
  returning id)
select pg_temp.assert(count(*) = 1, 'service_role can write a checked lesson step') from i;
rollback;

-- Earlier points reasons still work, next to the two new ones.
insert into app.points_ledger (center_id, person_id, points, reason, note) values (:c1, :p_mom, 1, 'survey', 'test 54'), (:c1, :p_mom, 1, 'practice', 'test 54');
select pg_temp.assert((select count(*) from app.points_ledger where person_id = :p_mom and note = 'test 54') = 2, 'existing points reasons stay valid');

-- ── Who may call it, and who may write tries ───────────────────────────────
select pg_temp.assert(has_function_privilege('authenticated', 'app.record_gyan_attempt(uuid, uuid, boolean, integer, jsonb)', 'execute')
                      and not has_function_privilege('anon', 'app.record_gyan_attempt(uuid, uuid, boolean, integer, jsonb)', 'execute')
                      and not has_function_privilege('authenticated', 'app.gyan_award_level_bonus(uuid, uuid, uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.gyan_progress_guard()', 'execute'),
  'signed-in members can record a try; anonymous callers cannot; the level award and the progress guard are internal');
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
select pg_temp.assert_raises($$select app.record_gyan_attempt('54000000-0000-4000-8000-0000000000c1', '54000000-0000-4000-8000-000000000d01', true, null, jsonb_build_object('pad', repeat('x', 3000)))$$,
  'at most 2 KB', 'details over 2 KB are refused');
select pg_temp.assert_raises($$select app.record_gyan_attempt('54000000-0000-4000-8000-0000000000c1', '54000000-0000-4000-8000-000000000d01', true, null, '{"try_id": "try-1"}')$$,
  '"try_id" must be a UUID', 'a try_id that is not a UUID is refused');
select pg_temp.assert_raises($$select app.record_gyan_attempt('54000000-0000-4000-8000-0000000000c1', '54000000-0000-4000-8000-000000000d01', true, null, '{"try_id": 7}')$$,
  '"try_id" must be a UUID', 'so is a try_id that is a number');
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
                      and (:'f1'::jsonb->>'first_time')::boolean = false and (:'f1'::jsonb->>'replayed')::boolean = false,
  'a failed try earns nothing and does not count as a try today (the cap is 10 by default)');
select pg_temp.assert((select count(*) = 1 and bool_and(not success and score = 30 and detail = '{"wrong": ["knees"]}'::jsonb and points = 0 and center_id = :c1::uuid
                                                and try_id is null and result = :'f1'::jsonb)
                         from app.gyan_attempts where person_id = :p_kid and step_id = :s1)
                      and not exists (select 1 from app.gyan_progress where person_id = :p_kid and step_id = :s1),
  'the failed try is recorded with its score, its details and its answer, and the step is not completed');

begin;
select pg_temp.sign_in(:kid);
select app.record_gyan_attempt(:c1::uuid, :s1::uuid, true, 95) as t1 \gset
select app.record_gyan_attempt(:c1::uuid, :s1::uuid, true) as t2 \gset
commit;
select pg_temp.assert(:'t1'::jsonb = '{"points_awarded": 13, "tries_today": 1, "cap": 10, "first_time": true, "try_points": 3, "step_points": 10, "level_points": 0, "treasure_points": 0, "level_complete": false, "replayed": false}'::jsonb,
  'the first success pays the try (3) and, as the first completion, the step''s points (10)');
select pg_temp.assert(:'t2'::jsonb = '{"points_awarded": 3, "tries_today": 2, "cap": 10, "first_time": false, "try_points": 3, "step_points": 0, "level_points": 0, "treasure_points": 0, "level_complete": false, "replayed": false}'::jsonb,
  'the next success pays only the try');
select pg_temp.assert((select completed_at is not null and stars = 3 and center_id = :c1::uuid from app.gyan_progress where person_id = :p_kid and step_id = :s1),
  'a success completes the step (a 95 score is three stars)');

-- What was earned stays: the member writes their own progress rows, but cannot lower the stars or clear a completion.
select completed_at as s1_done from app.gyan_progress where person_id = :p_kid and step_id = :s1 \gset
begin;
select pg_temp.sign_in(:kid);
update app.gyan_progress set stars = 0, completed_at = null where person_id = :p_kid and step_id = :s1;
update app.gyan_progress set completed_at = now() + interval '1 day' where person_id = :p_kid and step_id = :s1;
commit;
select pg_temp.assert((select stars = 3 and completed_at = :'s1_done'::timestamptz from app.gyan_progress where person_id = :p_kid and step_id = :s1),
  'a member cannot lower the stars or clear (or move) the completion of their own step');

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
-- Odd values written outside the portal: text means the default, a negative number 0, a fraction its whole part, and
-- a huge number the most allowed (1000) instead of an "integer out of range" error on every try.
update app.centers set rules = jsonb_set(rules, '{points,gyan_practice_daily_cap}', '"5"') where id = :c1;
begin;
select pg_temp.sign_in(:kid);
select app.record_gyan_attempt(:c1::uuid, :s6::uuid, false) as cap_text \gset
commit;
update app.centers set rules = jsonb_set(rules, '{points,gyan_practice_daily_cap}', '-3') where id = :c1;
begin;
select pg_temp.sign_in(:kid);
select app.record_gyan_attempt(:c1::uuid, :s6::uuid, false) as cap_negative \gset
commit;
update app.centers set rules = jsonb_set(rules, '{points,gyan_practice_daily_cap}', '2.7') where id = :c1;
begin;
select pg_temp.sign_in(:kid);
select app.record_gyan_attempt(:c1::uuid, :s6::uuid, false) as cap_fraction \gset
commit;
update app.centers set rules = jsonb_set(rules, '{points,gyan_practice_daily_cap}', '1e10') where id = :c1;
begin;
select pg_temp.sign_in(:kid);
select app.record_gyan_attempt(:c1::uuid, :s6::uuid, false) as cap_huge \gset
commit;
update app.centers set rules = jsonb_set(rules, '{points,gyan_practice_daily_cap}', '1e300') where id = :c1;
begin;
select pg_temp.sign_in(:kid);
select app.record_gyan_attempt(:c1::uuid, :s6::uuid, false) as cap_vast \gset
commit;
select pg_temp.assert((:'cap_text'::jsonb->>'cap')::int = 10 and (:'cap_negative'::jsonb->>'cap')::int = 0
                      and (:'cap_fraction'::jsonb->>'cap')::int = 2 and (:'cap_huge'::jsonb->>'cap')::int = 1000
                      and (:'cap_vast'::jsonb->>'cap')::int = 1000,
  'a cap rule of "5" reads as 10, -3 as 0, 2.7 as 2, and 1e10 or 1e300 as 1000; no try fails because of it');
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
-- Replays: completing the step again (its progress row deleted and written again), or more tries, pay no bonus twice.
delete from app.gyan_progress where person_id = :p_kid and step_id = :s2;
insert into app.gyan_progress (center_id, person_id, step_id, stars, completed_at) values (:c1, :p_kid, :s2, 2, now());
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
-- A step added to the level after it paid: finishing it pays that step's own points, never the level again.
insert into app.gyan_steps (id, level_id, kind, title, sort_order, points) values (:s7, :l1, 'read', 'One more card', 3, 5);
begin;
select pg_temp.sign_in(:kid);
insert into app.gyan_progress (center_id, person_id, step_id, stars, completed_at) values (:c1, :p_kid, :s7, 3, now());
commit;
select pg_temp.assert(pg_temp.pts('level', :s7) = 5 and pg_temp.rows('level', :l1) = 1 and pg_temp.rows('gyan_treasure', :l1) = 1,
  'a step added after the level was paid pays its own points; the level''s points and treasure are not paid again');

-- Existing step points stay once ever, even when the progress row is removed and the step completed again.
delete from app.gyan_progress where person_id = :p_kid and step_id = :s1;
begin;
select pg_temp.sign_in(:kid);
select app.record_gyan_attempt(:c1::uuid, :s1::uuid, true) as r2 \gset
commit;
select pg_temp.assert((:'r2'::jsonb->>'first_time')::boolean and (:'r2'::jsonb->>'step_points')::int = 0 and pg_temp.rows('level', :s1) = 1,
  'a step completed again after a reset pays its points no second time');

-- A level that needs a teacher sign-off: completing it pays the step, the try and the treasure, never the level;
-- approval pays the level once.
begin;
select pg_temp.sign_in(:kid);
select app.record_gyan_attempt(:c1::uuid, :s3::uuid, true, 80, '{"taps": ["toes", "knees"]}') as signoff1 \gset
commit;
select pg_temp.assert(:'signoff1'::jsonb = '{"points_awarded": 53, "tries_today": 1, "cap": 10, "first_time": true, "try_points": 3, "step_points": 10, "level_points": 0, "treasure_points": 40, "level_complete": true, "replayed": false}'::jsonb,
  'completing a sign-off level pays the step, the try and its treasure, but not the level');
select pg_temp.assert(pg_temp.rows('level', :l2) = 0 and pg_temp.rows('gyan_treasure', :l2) = 1 and pg_temp.pts('gyan_treasure', :l2) = 40,
  'no level points before the teacher signs off; the treasure (40) is paid on completion');
insert into app.gyan_signoffs (center_id, person_id, level_id) values (:c1, :p_kid, :l2);
update app.gyan_signoffs set status = 'approved' where person_id = :p_kid and level_id = :l2;
update app.gyan_signoffs set status = 'needs_work' where person_id = :p_kid and level_id = :l2;
update app.gyan_signoffs set status = 'approved' where person_id = :p_kid and level_id = :l2;
select pg_temp.assert(pg_temp.rows('level', :l2) = 1 and pg_temp.pts('level', :l2) = 20 and pg_temp.rows('gyan_treasure', :l2) = 1,
  'the teacher''s approval pays the level''s 20 points once, as before, and the treasure stays paid once');

-- A level with no sign-off that a teacher approves before it is finished: the approval pays its points; finishing it
-- later pays the step and the treasure, and the level's points no second time.
insert into app.gyan_signoffs (center_id, person_id, level_id) values (:c1, :p_kid, :l6);
update app.gyan_signoffs set status = 'approved' where person_id = :p_kid and level_id = :l6;
select pg_temp.assert(pg_temp.rows('level', :l6) = 1 and pg_temp.pts('level', :l6) = 20 and pg_temp.rows('gyan_treasure', :l6) = 0,
  'an approval before the level is finished pays its points, not yet its treasure');
begin;
select pg_temp.sign_in(:kid);
insert into app.gyan_progress (center_id, person_id, step_id, stars, completed_at) values (:c1, :p_kid, :s8, 3, now());
commit;
select pg_temp.assert(pg_temp.pts('level', :s8) = 5 and pg_temp.rows('level', :l6) = 1 and pg_temp.rows('gyan_treasure', :l6) = 1
                      and pg_temp.pts('gyan_treasure', :l6) = 30,
  'finishing it afterwards pays the step (5) and the treasure (30); the level''s points are not paid twice');

-- ── Another community's lesson, written directly ───────────────────────────
-- The member app completes steps with its own gyan_progress write, so the table itself refuses a step of another
-- community's goal: no step points, no level points, no treasure.
begin;
select pg_temp.sign_in(:kid);
select pg_temp.assert_raises($$insert into app.gyan_progress (center_id, person_id, step_id, stars, completed_at) values ('54000000-0000-4000-8000-0000000000c1', '54000000-0000-4000-8000-0000000000a2', '54000000-0000-4000-8000-000000000d04', 3, now())$$,
  'that lesson belongs to another community', 'a member cannot mark another community''s lesson step done by writing their progress');
select pg_temp.assert_raises($$update app.gyan_progress set step_id = '54000000-0000-4000-8000-000000000d04' where person_id = '54000000-0000-4000-8000-0000000000a2' and step_id = '54000000-0000-4000-8000-000000000d02'$$,
  'that lesson belongs to another community', 'nor move one of their own progress rows onto it');
commit;
select pg_temp.assert(not exists (select 1 from app.gyan_progress where step_id = :s4)
                      and pg_temp.rows('level', :s4) = 0 and pg_temp.rows('level', :l4) = 0 and pg_temp.rows('gyan_treasure', :l4) = 0,
  'another community''s step and level paid nothing: no ''level'' or ''gyan_treasure'' rows');
-- The level award checks the community on its own too: even with a completed row for S4 in place (written here with
-- the triggers off, then rolled back) it pays nothing into c1.
begin;
set local session_replication_role = replica;
insert into app.gyan_progress (center_id, person_id, step_id, stars, completed_at) values (:c1, :p_kid, :s4, 3, now());
set local session_replication_role = origin;
select app.gyan_award_level_bonus(:c1::uuid, :p_kid::uuid, :l4::uuid) as foreign_bonus \gset
select pg_temp.rows('level', :l4) + pg_temp.rows('gyan_treasure', :l4) as foreign_rows \gset
rollback;
select pg_temp.assert(:'foreign_bonus'::int = 0 and :'foreign_rows'::int = 0,
  'the level award pays nothing for another community''s level, whatever the progress rows say');

-- A SHARED goal: the community is the person's; one try can pay the try, the step, the level and its treasure.
begin;
select pg_temp.sign_in(:kid);
select app.record_gyan_attempt(:c1::uuid, :ss::uuid, true, 72, '{"fix": []}') as v1 \gset
select app.record_gyan_attempt(:c1::uuid, :ss::uuid, true) as v2 \gset
commit;
select pg_temp.assert(:'v1'::jsonb = '{"points_awarded": 88, "tries_today": 1, "cap": 10, "first_time": true, "try_points": 3, "step_points": 15, "level_points": 20, "treasure_points": 50, "level_complete": true, "replayed": false}'::jsonb,
  'under a shared goal the first success pays 3 + 15 + 20 + 50');
select pg_temp.assert((:'v2'::jsonb->>'points_awarded')::int = 3, 'and the next one only the try');
select pg_temp.assert((select bool_and(center_id = :c1::uuid) from app.points_ledger where person_id = :p_kid and ref_id in (:ss, :ls))
                      and (select bool_and(center_id = :c1::uuid) from app.gyan_attempts where step_id = :ss),
  'points and tries for a shared lesson belong to the person''s community');

-- ── The same try sent twice (the app retrying after a lost answer) ─────────
begin;
select pg_temp.sign_in(:kid);
select app.record_gyan_attempt(:c1::uuid, :s10::uuid, true, 70, '{"try_id": "54000000-0000-4000-8000-0000000071a1", "taps": ["a"]}') as try1 \gset
commit;
begin;
select pg_temp.sign_in(:kid);
select app.record_gyan_attempt(:c1::uuid, :s10::uuid, true, 70, '{"try_id": "54000000-0000-4000-8000-0000000071a1", "taps": ["a"]}') as try2 \gset
commit;
select pg_temp.assert(:'try1'::jsonb = '{"points_awarded": 2, "tries_today": 1, "cap": 10, "first_time": true, "try_points": 2, "step_points": 0, "level_points": 0, "treasure_points": 0, "level_complete": false, "replayed": false}'::jsonb,
  'a try with a try_id is recorded and paid as usual');
select pg_temp.assert(:'try2'::jsonb = :'try1'::jsonb || '{"replayed": true}'::jsonb,
  'the same try_id again gets the first answer back, marked replayed');
select pg_temp.assert((select count(*) from app.gyan_attempts where person_id = :p_kid and step_id = :s10) = 1
                      and (select detail = '{"taps": ["a"]}'::jsonb and try_id = '54000000-0000-4000-8000-0000000071a1'::uuid
                             from app.gyan_attempts where person_id = :p_kid and step_id = :s10)
                      and pg_temp.rows('gyan_try', :s10) = 1,
  'and nothing is recorded or paid again: one try, one try award (the try_id kept in its own column)');
begin;
select pg_temp.sign_in(:kid);
select pg_temp.assert_raises($$select app.record_gyan_attempt('54000000-0000-4000-8000-0000000000c1', '54000000-0000-4000-8000-000000000d05', true, null, '{"try_id": "54000000-0000-4000-8000-0000000071a1"}')$$,
  'already used for another lesson step', 'a try_id already used for another step is refused');
commit;

-- ── Storage limit: 200 tries of one step a day ─────────────────────────────
insert into app.gyan_attempts (center_id, person_id, step_id, success, created_at)
select :c1, :p_kid, :s9, false, now() from generate_series(1, 199);
begin;
select pg_temp.sign_in(:kid);
select app.record_gyan_attempt(:c1::uuid, :s9::uuid, false) as m200 \gset
select app.record_gyan_attempt(:c1::uuid, :s9::uuid, true, 100) as m201 \gset
commit;
select pg_temp.assert((select count(*) from app.gyan_attempts where person_id = :p_kid and step_id = :s9) = 200,
  'the 200th try of a step in a day is stored, the 201st is not');
select pg_temp.assert(:'m201'::jsonb = '{"points_awarded": 0, "tries_today": 0, "cap": 10, "first_time": false, "try_points": 0, "step_points": 0, "level_points": 0, "treasure_points": 0, "level_complete": false, "replayed": false}'::jsonb
                      and (select array_agg(k order by k) from jsonb_object_keys(:'m201'::jsonb) k) = (select array_agg(k order by k) from jsonb_object_keys(:'t1'::jsonb) k),
  'past the limit even a success answers in the usual shape, with every points figure 0');
select pg_temp.assert(not exists (select 1 from app.gyan_progress where person_id = :p_kid and step_id = :s9)
                      and pg_temp.rows('gyan_try', :s9) = 0 and pg_temp.rows('level', :s9) = 0,
  'and pays and completes nothing');

-- The RPC pays try points only on tap-the-spots practice and voice, even for a step that somehow carries them (the
-- table check is dropped here, inside a transaction that is rolled back).
begin;
alter table app.gyan_steps drop constraint gyan_steps_repeat_points_kind;
set local session_replication_role = replica;
insert into app.gyan_steps (id, level_id, kind, title, sort_order, points, repeat_points, quiz)
  values (:sq, :l5, 'quiz', 'A quiz with try points', 9, 0, 3, '{"questions": [{"question": "Q", "options": ["a", "b"], "answer": 0}]}');
set local session_replication_role = origin;
select pg_temp.sign_in(:kid);
select app.record_gyan_attempt(:c1::uuid, :sq::uuid, true) as q1 \gset
rollback;
select pg_temp.assert((:'q1'::jsonb->>'try_points')::int = 0 and (:'q1'::jsonb->>'points_awarded')::int = 0,
  'record_gyan_attempt pays no try points for a kind without tries, even when the step carries some');
select pg_temp.assert(exists (select 1 from pg_constraint where conrelid = 'app.gyan_steps'::regclass and conname = 'gyan_steps_repeat_points_kind')
                      and not exists (select 1 from app.gyan_steps where id = :sq),
  '(and the check is back after the rollback)');

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
-- A class teacher (no community-wide Pathshala role) reads them while the learner is in the class, not after.
insert into app.pathshala_terms (id, center_id, name, starts_on, ends_on) values (:term, :c1, 'Term 54', current_date - 30, current_date + 200);
insert into app.pathshala_tracks (id, center_id, key, name) values (:track, :c1, 'jainism54', 'Jainism 54');
insert into app.pathshala_levels (id, center_id, track_id, key, name) values (:plevel, :c1, :track, '1', 'Jainism 1 (54)');
insert into app.pathshala_classes (id, center_id, term_id, level_id, name) values (:class, :c1, :term, :plevel, 'Jainism 1, room 54');
insert into app.pathshala_enrollments (id, center_id, term_id, student_person_id, household_id, class_id, status)
  values (:enr, :c1, :term, :p_kid, :h1, :class, 'active');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id) values (:c1, :classteacher, 'teacher', 'class', :class);
begin;
select pg_temp.sign_in(:classteacher);
select count(*) as n_class_active from app.gyan_attempts where person_id = :p_kid \gset
commit;
update app.pathshala_enrollments set status = 'withdrawn' where id = :enr;
begin;
select pg_temp.sign_in(:classteacher);
select count(*) as n_class_withdrawn from app.gyan_attempts where person_id = :p_kid \gset
commit;
select pg_temp.assert(:'n_class_active'::int = :'n_all'::int, 'a class teacher reads the tries of a learner in their class');
select pg_temp.assert(:'n_class_withdrawn'::int = 0, 'and none once the learner has withdrawn from it');
update app.center_modules set enabled = false where center_id = :c1 and module_key = 'gyan_path';
begin;
select pg_temp.sign_in(:kid);
select count(*) as n_off from app.gyan_attempts \gset
commit;
update app.center_modules set enabled = true where center_id = :c1 and module_key = 'gyan_path';
select pg_temp.assert(:'n_off'::int = 0, 'with Gyan Path switched off the tries are hidden too');
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'gyan_attempts' and center_id = :c1::uuid and module = 'gyan_path') > 0,
  'tries are audited under the community and the Gyan Path module');

-- ── One person in two communities ──────────────────────────────────────────
-- Points are per community membership: a user who belongs to two communities has a member record in each, so a shared
-- lesson pays, and has its daily cap, in each, into that community's own ledger. (BACKLOG B44: the owner to confirm.)
insert into app.households (id, center_id, display_name) values (:h4, :c1, 'Doshi household 54, here too');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values (:p_other1, :c1, 'Kiran', 'Doshi', date '1979-03-03');
insert into app.household_members (household_id, person_id, center_id, role) values (:h4, :p_other1, :c1, 'primary');
insert into app.center_users (center_id, user_id, person_id) values (:c1, :other, :p_other1);
begin;
select pg_temp.sign_in(:other);
select app.record_gyan_attempt(:c1::uuid, :ss::uuid, true) as e1 \gset
select app.record_gyan_attempt(:c2::uuid, :ss::uuid, true) as e2 \gset
commit;
select pg_temp.assert((:'e1'::jsonb->>'points_awarded')::int = 88 and (:'e1'::jsonb->>'tries_today')::int = 1
                      and (:'e2'::jsonb->>'points_awarded')::int = 88 and (:'e2'::jsonb->>'tries_today')::int = 1,
  'the same user practising a shared lesson in two communities is paid, and counted against the cap, in each');
select pg_temp.assert((select count(*) = 4 and bool_and(center_id = :c1::uuid) from app.points_ledger where person_id = :p_other1 and ref_id in (:ss, :ls))
                      and (select count(*) = 4 and bool_and(center_id = :c2::uuid) from app.points_ledger where person_id = :p_other and ref_id in (:ss, :ls)),
  'each community''s ledger holds its own member''s try, step, level and treasure rows');
