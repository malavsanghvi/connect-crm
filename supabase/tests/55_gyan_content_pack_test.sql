-- 0571: the Gyan Path content pack in the shared library (center_id null). Runs after seed.sql, which applies the
-- pack to the seeded Samayik and Navkar goals (a new database runs the migrations first). Checks: every level holds
-- exactly the pack's steps; every Samayik and Navkar level is playable; each payload is valid for its kind; points
-- follow the spec; the puja goal is there; running it again adds nothing and never overwrites or removes what
-- someone else made; a member can play a shared lesson and is paid.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.sign_in(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
-- The pack's levels, one row each, with the shared level they landed in.
create or replace function pg_temp.pack_levels() returns table (goal_key text, level_key text, steps jsonb, treasure_points int, level_id uuid)
language sql stable as $$
  select g->>'goal_key', l->>'level_key', l->'steps', coalesce((l->>'treasure_points')::int, 0),
         (select lv.id from app.gyan_levels lv join app.gyan_goals go on go.id = lv.goal_id
           where go.center_id is null and go.key = g->>'goal_key' and lv.key = l->>'level_key')
    from jsonb_array_elements(app.gyan_content_pack()->'goals') g, jsonb_array_elements(g->'levels') l
$$;
-- The pack's steps as stored.
create or replace function pg_temp.pack_steps() returns setof app.gyan_steps language sql stable as $$
  select s.* from pg_temp.pack_levels() pl cross join lateral jsonb_array_elements(pl.steps) with ordinality e(x, o)
    join app.gyan_steps s on s.id = app.gyan_pack_step_id(pl.goal_key, pl.level_key, e.o::int)
$$;
-- The spec's points for a kind (and a hotspot's mode): {points, repeat_points}.
create or replace function pg_temp.spec_points(p_kind text, p_mode text) returns int[] language sql immutable as $$
  select case p_kind when 'read' then array[5, 0] when 'quiz' then array[10, 0] when 'practice' then array[10, 0] when 'voice' then array[15, 3]
                     when 'hotspot' then case when p_mode = 'practice' then array[10, 3] else array[10, 0] end end
$$;

-- ── Who may run it ─────────────────────────────────────────────────────────
select pg_temp.assert(not has_function_privilege('authenticated', 'app.apply_gyan_content_pack()', 'execute')
                      and not has_function_privilege('anon', 'app.apply_gyan_content_pack()', 'execute')
                      and not has_function_privilege('authenticated', 'app.gyan_content_pack()', 'execute')
                      and has_function_privilege('service_role', 'app.apply_gyan_content_pack()', 'execute'),
  'only the platform (service role) can apply the pack; it is not part of the API');

-- ── What is in the shared library ──────────────────────────────────────────
select pg_temp.assert(not exists (select 1 from jsonb_array_elements(app.gyan_content_pack()->'goals') g
                                   where (select count(*) from app.gyan_goals x where x.center_id is null and x.key = g->>'goal_key') <> 1),
  'every goal of the pack is in the shared library exactly once (seed.sql and the pack never make a second Samayik)');
select pg_temp.assert(not exists (select 1 from pg_temp.pack_levels() where level_id is null),
  'every level of the pack matched a shared level (Samayik and Navkar by their seed.sql keys) or was created');
select pg_temp.assert(not exists (select 1 from pg_temp.pack_levels() pl
                                   where (select count(*) from app.gyan_steps s where s.level_id = pl.level_id
                                            and s.id in (select app.gyan_pack_step_id(pl.goal_key, pl.level_key, e.o::int)
                                                           from jsonb_array_elements(pl.steps) with ordinality e(x, o))) <> jsonb_array_length(pl.steps)),
  'every level holds exactly the pack''s steps for it');
select pg_temp.assert(not exists (select 1 from pg_temp.pack_levels() pl cross join lateral jsonb_array_elements(pl.steps) with ordinality e(x, o)
                                    join app.gyan_steps s on s.id = app.gyan_pack_step_id(pl.goal_key, pl.level_key, e.o::int)
                                   where s.kind <> e.x->>'kind' or s.title <> e.x->>'title' or s.sort_order <> e.o
                                      or s.activity <> e.x->'activity'
                                      or s.quiz is distinct from (case when jsonb_typeof(e.x->'quiz') = 'object' then e.x->'quiz' end)),
  'each step carries the pack''s kind, title, order, activity and quiz exactly');
select pg_temp.assert((select count(*) from pg_temp.pack_steps()) = (select sum(jsonb_array_length(steps)) from pg_temp.pack_levels())
                      and (select count(*) from pg_temp.pack_steps()) >= 70,
  'all of the pack''s steps are stored');

-- Every level of Samayik (12) and of Navkar (9) is playable: it has steps.
select pg_temp.assert((select count(*) from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id where g.center_id is null and g.key = 'samayik') = 12
                      and not exists (select 1 from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id
                                       where g.center_id is null and g.key = 'samayik' and not exists (select 1 from app.gyan_steps s where s.level_id = l.id)),
  'all 12 Samayik levels have steps');
select pg_temp.assert(not exists (select 1 from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id
                                   where g.center_id is null and g.key = 'navkar' and not exists (select 1 from app.gyan_steps s where s.level_id = l.id)),
  'all Navkar levels have steps');

-- ── Shapes, points and the review mark ─────────────────────────────────────
select pg_temp.assert(not exists (select 1 from pg_temp.pack_steps() s
                                   where app.gyan_activity_problems(s.kind, s.activity) <> '{}'::text[] or app.gyan_quiz_problems(s.quiz) <> '{}'::text[]),
  'every payload is valid for its kind (the database''s own checks find nothing)');
select pg_temp.assert(not exists (select 1 from pg_temp.pack_steps() s where s.activity->>'review' is distinct from 'needs_pathshala_review'),
  'every lesson is marked as needing Pathshala review');
select pg_temp.assert(not exists (select 1 from pg_temp.pack_steps() s
                                   where (s.kind = 'read' and jsonb_array_length(coalesce(s.activity->'cards', '[]')) = 0)
                                      or (s.kind = 'quiz' and jsonb_array_length(coalesce(s.quiz->'questions', '[]')) = 0)
                                      or (s.kind = 'voice' and (jsonb_array_length(coalesce(s.activity->'verses', '[]')) = 0 or s.activity->>'lang' is null))
                                      or (s.kind = 'hotspot' and (jsonb_array_length(coalesce(s.activity->'spots', '[]')) = 0 or s.activity->>'image' is null))),
  'learn steps have cards, quizzes have questions, voice steps have a language and verses, hotspots a picture and spots');
select pg_temp.assert(not exists (select 1 from pg_temp.pack_steps() s
                                   where array[s.points, s.repeat_points] is distinct from pg_temp.spec_points(s.kind, s.activity->>'mode')),
  'points follow the spec: read 5, quiz 10, practice 10, hotspot 10 (+3 a try when practising), voice 15 + 3 a try');
select pg_temp.assert((select count(*) from pg_temp.pack_steps() where kind = 'voice') > 0
                      and (select count(*) from pg_temp.pack_steps() where kind = 'quiz' and quiz->'questions' @> '[{"type": "truefalse"}]') > 0,
  'the pack uses the new kinds and question types');
select pg_temp.assert((select treasure_points from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id where g.center_id is null and g.key = 'samayik' and l.key = '4') = 50
                      and (select treasure_points from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id where g.center_id is null and g.key = 'samayik' and l.key = '8') = 50
                      and not exists (select 1 from pg_temp.pack_levels() pl join app.gyan_levels l on l.id = pl.level_id where l.treasure_points <> pl.treasure_points),
  'the badge levels carry their 50 treasure points (Samayik 4 and 8), as the pack says');
select pg_temp.assert(not exists (select 1 from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id
                                   where g.center_id is null and g.key in ('samayik', 'navkar') and l.points <> 20)
                      and (select requires_teacher_signoff from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id where g.center_id is null and g.key = 'samayik' and l.key = '12')
                      and not (select requires_teacher_signoff from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id where g.center_id is null and g.key = 'samayik' and l.key = '1'),
  'the seeded levels keep their 20 points and their sign-off settings');

-- ── The puja goal ──────────────────────────────────────────────────────────
select pg_temp.assert((select count(*) = 1 and bool_and(center_id is null and tradition = 'shvetambar_murtipujak' and name like 'Learn Puja%')
                         from app.gyan_goals where key = 'navang_puja'),
  'the shared Navang puja goal is there');
select pg_temp.assert((select array_agg(s.kind || ':' || (s.activity->>'mode') || ':' || s.repeat_points order by l.sort_order, s.sort_order)
                         from app.gyan_steps s join app.gyan_levels l on l.id = s.level_id join app.gyan_goals g on g.id = l.goal_id
                        where g.key = 'navang_puja') = array['hotspot:learn:0', 'hotspot:practice:3'],
  'it is learn (guided, touch by touch) then practice (tap in order, points every successful try)');
select pg_temp.assert((select bool_and(s.activity->>'image' = 'asset:mahavir-murti' and jsonb_array_length(s.activity->'spots') >= 9)
                         from app.gyan_steps s join app.gyan_levels l on l.id = s.level_id join app.gyan_goals g on g.id = l.goal_id where g.key = 'navang_puja'),
  'both use the bundled murti picture (asset:mahavir-murti) and at least the nine places');

-- ── Running it again ───────────────────────────────────────────────────────
select count(*) as steps_before from app.gyan_steps \gset
select count(*) as levels_before from app.gyan_levels \gset
select app.apply_gyan_content_pack() as again \gset
select pg_temp.assert(:'again'::jsonb = '{"goals_added": 0, "levels_added": 0, "steps_added": 0, "treasure_points_set": 0, "goals_not_here_yet": []}'::jsonb
                      and (select count(*) from app.gyan_steps) = :'steps_before'::bigint and (select count(*) from app.gyan_levels) = :'levels_before'::bigint,
  'running it again adds nothing');

-- Someone edits a pack step, adds a step of their own and sets other treasure points: a re-run keeps all of it.
update app.gyan_steps set title = 'Edited by the platform team' where id = app.gyan_pack_step_id('samayik', '1', 1);
insert into app.gyan_steps (id, level_id, kind, title, sort_order, points)
select '55000000-0000-4000-8000-000000000d01', l.id, 'read', 'A step of our own', 99, 5
  from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id where g.center_id is null and g.key = 'samayik' and l.key = '1';
update app.gyan_levels l set treasure_points = 75 from app.gyan_goals g where g.id = l.goal_id and g.center_id is null and g.key = 'samayik' and l.key = '4';
delete from app.gyan_steps where id = app.gyan_pack_step_id('navkar', '9', 4);
select app.apply_gyan_content_pack() as third \gset
select pg_temp.assert((select title from app.gyan_steps where id = app.gyan_pack_step_id('samayik', '1', 1)) = 'Edited by the platform team',
  'a pack step someone edited keeps their edit');
select pg_temp.assert(exists (select 1 from app.gyan_steps where id = '55000000-0000-4000-8000-000000000d01' and title = 'A step of our own'),
  'a step someone else created is never removed or changed');
select pg_temp.assert((select treasure_points from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id where g.center_id is null and g.key = 'samayik' and l.key = '4') = 75,
  'treasure points someone set are not overwritten');
select pg_temp.assert(:'third'::jsonb = '{"goals_added": 0, "levels_added": 0, "steps_added": 1, "treasure_points_set": 0, "goals_not_here_yet": []}'::jsonb
                      and exists (select 1 from app.gyan_steps where id = app.gyan_pack_step_id('navkar', '9', 4)),
  'a re-run only puts back a pack step that had been removed');

-- ── A member plays a shared lesson ─────────────────────────────────────────
\set c '''55000000-0000-4000-8000-0000000000c1'''
\set u '''55000000-0000-4000-8000-000000000001'''
\set p '''55000000-0000-4000-8000-0000000000a1'''
\set h '''55000000-0000-4000-8000-0000000000b1'''
insert into auth.users (id, email) values (:u, 'learner55@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, tradition) values (:c, 'gyan55', 'Gyan 55 Community', 'G55', 'TX', 'active', 'shvetambar_murtipujak');
insert into app.households (id, center_id, display_name) values (:h, :c, 'Shah household 55');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values (:p, :c, 'Asha', 'Shah', date '1990-01-01');
insert into app.household_members (household_id, person_id, center_id, role) values (:h, :p, :c, 'primary');
insert into app.center_users (center_id, user_id, person_id) values (:c, :u, :p);
select (select count(*) from jsonb_array_elements(l->'steps')) as n1 from jsonb_array_elements(app.gyan_content_pack()->'goals') g, jsonb_array_elements(g->'levels') l
 where g->>'goal_key' = 'navkar' and l->>'level_key' = '1' \gset
-- The level's step ids, worked out before signing in (the id function is not part of the API).
select array_agg(app.gyan_pack_step_id('navkar', '1', o) order by o)::text as n1_ids from generate_series(1, :n1) o \gset
begin;
select pg_temp.sign_in(:u);
select coalesce(sum((app.record_gyan_attempt(:c::uuid, x.id, true)->>'points_awarded')::int), 0) as earned
  from unnest(:'n1_ids'::uuid[]) x(id) \gset
select (app.record_gyan_attempt(:c::uuid, (:'n1_ids'::uuid[])[1], true)->>'level_complete')::boolean as level_complete \gset
commit;
select pg_temp.assert(:'level_complete'::boolean, 'a member of a community finishes Navkar level 1 of the shared library');
select pg_temp.assert(:'earned'::int = (select sum(s.points + s.repeat_points) from pg_temp.pack_steps() s
                                          where s.id in (select app.gyan_pack_step_id('navkar', '1', o) from generate_series(1, :n1) o)) + 20,
  'and is paid each step''s points, each first try''s points and the level''s 20');
select pg_temp.assert((select count(*) from app.points_ledger where person_id = :p and center_id = :c and reason = 'level'
                         and ref_id = (select l.id from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id where g.center_id is null and g.key = 'navkar' and l.key = '1')) = 1,
  'the level is paid once, into the member''s own community');
