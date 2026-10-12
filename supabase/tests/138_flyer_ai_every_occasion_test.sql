-- 0703: AI flyer art for every occasion. app.flyer_art_name_ok and app.events_request_flyer_art accept any occasion KEY
-- SHAPE (the real list is the TypeScript catalog, checked by the portal and the background service), and nothing else
-- about them changed: who may call them, how they run, and the storage rules built on them.
--   A. Who may call them, and how they run (unchanged from 0585)   B. The storage name rule   C. Asking for a layer
--   D. The storage write rule for a new occasion
-- Everything runs in one transaction that is rolled back.
\set ON_ERROR_STOP 1
begin;
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
grant connect_worker to postgres;

\set c '''13800000-0000-4000-8000-0000000000c1'''
\set manager '''13800000-0000-4000-8000-000000000001'''
\set p_manager '''13800000-0000-4000-8000-0000000000a1'''
\set e1 '''13800000-0000-4000-8000-0000000000e1'''

insert into auth.users (id, email) values (:manager, 'manager138@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status) values (:c, 'grace138', 'Grace 138 Church', 'G138', 'TX', 'active');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values (:p_manager, :c, 'Mona', 'Manager', date '1980-01-01');
insert into app.center_users (center_id, user_id, person_id) values (:c, :manager, :p_manager);
insert into app.role_grants (center_id, user_id, role_key) values (:c, :manager, 'pathshala_committee');  -- events.manage
insert into app.events (id, center_id, name, status, audience, confidential) values (:e1, :c, 'Christmas Eve Candlelight Service', 'published', 'public', false);

-- ── A. Who may call them, and how they run ──────────────────────────────────
select pg_temp.assert(has_function_privilege('authenticated', 'app.events_request_flyer_art(uuid, text, text, bigint, text)', 'execute')
                      and has_function_privilege('service_role', 'app.events_request_flyer_art(uuid, text, text, bigint, text)', 'execute')
                      and not has_function_privilege('anon', 'app.events_request_flyer_art(uuid, text, text, bigint, text)', 'execute'),
  'signed-in organizers (and the service) may still ask for a layer; guests still may not');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.flyer_art_name_ok(text)', 'execute')
                      and not has_function_privilege('anon', 'app.flyer_art_name_ok(text)', 'execute'),
  'the name rule is still internal: only the storage rules and the request functions call it');
select pg_temp.assert((select prosecdef and array_to_string(proconfig, ',') like '%search_path=app, public, extensions%'
                         from pg_proc where oid = 'app.events_request_flyer_art(uuid, text, text, bigint, text)'::regprocedure),
  'asking for a layer still runs as its definer with the pinned search path');
select pg_temp.assert((select not prosecdef and provolatile = 'i' and array_to_string(proconfig, ',') like '%search_path=app, public, extensions%'
                         from pg_proc where oid = 'app.flyer_art_name_ok(text)'::regprocedure),
  'the name rule is still an immutable invoker function with the pinned search path');
select pg_temp.assert((select count(*) = 1 from pg_proc where proname = 'events_request_flyer_art' and pronamespace = 'app'::regnamespace)
                      and (select count(*) = 1 from pg_proc where proname = 'flyer_art_name_ok' and pronamespace = 'app'::regnamespace),
  'no second version of either function was added (the same signatures were replaced)');

-- ── B. The storage name rule ────────────────────────────────────────────────
select pg_temp.assert(app.flyer_art_name_ok(:c || '/flyer-art/christmas_eve/frame-1.png')
                      and app.flyer_art_name_ok(:c || '/flyer-art/ribbon_cutting/scene-2147483647.jpg')
                      and app.flyer_art_name_ok(:c || '/flyer-art/garba/frame-12345.png')
                      and app.flyer_art_name_ok(:c || '/flyer-art/eid/scene-9.jpg'),
  'a layer of a new occasion (and of a Flyers v2 one) is a well-formed name');
select pg_temp.assert(not app.flyer_art_name_ok(:c || '/flyer-art/Christmas/frame-1.png')
                      and not app.flyer_art_name_ok(:c || '/flyer-art/bad-key/frame-1.png')
                      and not app.flyer_art_name_ok(:c || '/flyer-art/_eid/frame-1.png')
                      and not app.flyer_art_name_ok(:c || '/flyer-art/9eid/frame-1.png')
                      and not app.flyer_art_name_ok(:c || '/flyer-art/e/frame-1.png')
                      and not app.flyer_art_name_ok(:c || '/flyer-art/' || repeat('a', 41) || '/frame-1.png')
                      and not app.flyer_art_name_ok(:c || '/flyer-art/eid/../frame-1.png')
                      and not app.flyer_art_name_ok(:c || '/flyer-art/eid/sub/frame-1.png')
                      and not app.flyer_art_name_ok(:c || '/flyer-art/eid/background-1.png')
                      and not app.flyer_art_name_ok(:c || '/flyer-art/eid/frame-0.png')
                      and not app.flyer_art_name_ok(:c || '/flyer-art/eid/frame-1.webp')
                      and not app.flyer_art_name_ok(null),
  'a malformed occasion key (capitals, a dash, a leading underscore or digit, one letter, over 40 characters) or path is refused');
select pg_temp.assert(app.flyer_art_name_ok(:c || '/flyer-art/' || repeat('a', 40) || '/frame-1.png'), 'a 40-character key is the longest allowed');

-- ── C. Asking for a layer ───────────────────────────────────────────────────
select pg_temp.sign_in(:manager);
select app.events_request_flyer_art(:e1::uuid, 'christmas_eve', 'frame', 77, '{"flyer_art_facts":1,"occasion":"christmas_eve","layer":"frame"}') as q1 \gset
select pg_temp.assert((:'q1'::jsonb ->> 'status') = 'queued', 'an event manager asks for a frame for a new occasion and it is queued');
select pg_temp.assert_raises(format('select app.events_request_flyer_art(%L::uuid, %L, %L, 5, %L)', :e1, 'Bad-Key!', 'frame', 'x'), 'choose one of the occasions', 'a malformed key is refused');
select pg_temp.assert_raises(format('select app.events_request_flyer_art(%L::uuid, %L, %L, 5, %L)', :e1, '../garba', 'frame', 'x'), 'choose one of the occasions', 'a key that is a path is refused');
select pg_temp.assert_raises(format('select app.events_request_flyer_art(%L::uuid, %L, %L, 5, %L)', :e1, repeat('a', 41), 'frame', 'x'), 'choose one of the occasions', 'an over-long key is refused');
select pg_temp.assert_raises(format('select app.events_request_flyer_art(%L::uuid, NULL, %L, 5, %L)', :e1, 'frame', 'x'), 'choose one of the occasions', 'no key is refused');
select pg_temp.assert_raises(format('select app.events_request_flyer_art(%L::uuid, %L, %L, 5, %L)', :e1, 'eid', 'background', 'x'), 'frame or a bottom scene', 'the layer is still checked');

-- ── D. The storage write rule for a new occasion ────────────────────────────
select pg_temp.assert(app.can_write_object('content', :c || '/flyer-art/christmas_eve/frame-77.png'), 'the manager may keep the new occasion''s picture in the library');
select pg_temp.assert(not app.can_write_object('content', :c || '/flyer-art/Bad-Key/frame-77.png'), 'but not under a malformed key');

-- The queued job, read back as the database owner (organizers do not read app.jobs).
reset role;
select set_config('request.jwt.claims', '', true);
select pg_temp.assert((select payload ->> 'occasion' = 'christmas_eve' and payload ->> 'layer' = 'frame' and (payload ->> 'seed')::bigint = 77
                         from app.jobs where id = (:'q1'::jsonb ->> 'job_id')::bigint),
  'the job carries the new occasion');

rollback;
