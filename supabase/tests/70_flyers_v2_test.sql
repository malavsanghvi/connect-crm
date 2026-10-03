-- 0585: Flyers v2 (owner decision 2026-10-02, "approach C"): the Poster's AI art. The Gemini key and model in
-- Platform › Setup (and the new optional "art" step and its Test); the community's AI art library in the content
-- bucket (<center>/flyer-art/<occasion>/<layer>-<seed>.<ext>) with its storage rules; asking for one layer of art
-- (app.events_request_flyer_art) and the daily limit; "art taken" for a layer job; is AI art available
-- (app.flyer_art_status, from the workers' heartbeats); partner logos in the leftovers list and the 7-day sweep.
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
create or replace function pg_temp.assert_state(stmt text, state text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if sqlstate <> state then raise exception 'FAIL: % (got % "%")', label, sqlstate, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.sign_in(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
-- A platform admin who has just passed a fresh two-factor check (what the setup wizard needs to save a key).
create or replace function pg_temp.sign_in_step_up(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', 'aal2',
    'amr', jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 3600),
                             jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 60)))::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.as_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end $$;
-- Does the CURRENT role see this content-bucket object (through the storage.objects read policy)?
create or replace function pg_temp.sees(p_name text) returns boolean language sql as $$
  select exists (select 1 from storage.objects where bucket_id = 'content' and name = p_name)
$$;
grant connect_worker to postgres;

-- ── Fixtures ────────────────────────────────────────────────────────────────
\set c '''70000000-0000-4000-8000-0000000000c1'''
\set c2 '''70000000-0000-4000-8000-0000000000c2'''
\set manager '''70000000-0000-4000-8000-000000000001'''
\set lead '''70000000-0000-4000-8000-000000000002'''
\set lead2 '''70000000-0000-4000-8000-000000000003'''
\set member '''70000000-0000-4000-8000-000000000004'''
\set curator '''70000000-0000-4000-8000-000000000005'''
\set other '''70000000-0000-4000-8000-000000000006'''
\set pa '''70000000-0000-4000-8000-000000000007'''
\set p_manager '''70000000-0000-4000-8000-0000000000a1'''
\set p_lead '''70000000-0000-4000-8000-0000000000a2'''
\set p_lead2 '''70000000-0000-4000-8000-0000000000a3'''
\set p_member '''70000000-0000-4000-8000-0000000000a4'''
\set p_curator '''70000000-0000-4000-8000-0000000000a5'''
\set p_other '''70000000-0000-4000-8000-0000000000a6'''
\set e1 '''70000000-0000-4000-8000-0000000000e1'''
\set e2 '''70000000-0000-4000-8000-0000000000e2'''
\set e_c2 '''70000000-0000-4000-8000-0000000000e3'''

insert into auth.users (id, email) values
  (:manager, 'manager70@example.com'), (:lead, 'lead70@example.com'), (:lead2, 'lead70b@example.com'), (:member, 'member70@example.com'),
  (:curator, 'curator70@example.com'), (:other, 'other70@example.com'), (:pa, 'platform70@example.com');
insert into app.accounts (user_id, is_platform_admin) values (:pa, true);
insert into app.centers (id, slug, name, short_name, state_region, status) values
  (:c, 'orbit70', 'Orbit 70 Community', 'O70', 'TX', 'active'),
  (:c2, 'orbit70b', 'Other 70 Community', 'O70B', 'TX', 'active');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (:p_manager, :c, 'Mona', 'Manager', date '1980-01-01'),
  (:p_lead, :c, 'Lalit', 'Lead', date '1981-01-01'),
  (:p_lead2, :c, 'Leena', 'Lead', date '1984-01-01'),
  (:p_member, :c, 'Mira', 'Member', date '1982-01-01'),
  (:p_curator, :c, 'Chitra', 'Curator', date '1985-01-01'),
  (:p_other, :c2, 'Omar', 'Other', date '1983-01-01');
insert into app.center_users (center_id, user_id, person_id) values
  (:c, :manager, :p_manager), (:c, :lead, :p_lead), (:c, :lead2, :p_lead2), (:c, :member, :p_member), (:c, :curator, :p_curator), (:c2, :other, :p_other);
insert into app.role_grants (center_id, user_id, role_key) values
  (:c, :manager, 'pathshala_committee'),      -- events.manage, NOT content.manage
  (:c, :curator, 'religious_coordinator');    -- content.manage, NOT events.manage
insert into app.events (id, center_id, name, status, audience, confidential) values
  (:e1, :c, 'Garba Night', 'published', 'public', false),
  (:e2, :c, 'Paryushan', 'draft', 'members_only', false),
  (:e_c2, :c2, 'Other Community Event', 'published', 'public', false);
insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id) values
  (:c, :lead, 'event_lead', 'event', :e1::uuid),
  (:c, :lead2, 'event_lead', 'event', :e2::uuid);

select :c || '/flyer-art/garba/frame-12345.png' as art_frame,
       :c || '/flyer-art/garba/scene-9.jpg' as art_scene,
       :c || '/flyer-art/diwali/frame-77.jpg' as art_diwali,
       :c2 || '/flyer-art/garba/frame-1.png' as art_c2,
       :c || '/events/' || :e1 || '/partner-1759300000000.png' as logo_cur,
       :c || '/events/' || :e1 || '/partner-1759200000000.png' as logo_old,
       :c || '/events/' || :e1 || '/partner-1759100000000.png' as logo_orphan,
       :c || '/events/' || :e1 || '/partner-1759400000000.png' as logo_fresh,
       :c || '/events/' || :e1 || '/flyer-1.png' as flyer_old
\gset

-- ── 1. Platform › Setup: the Gemini key and model ───────────────────────────
select pg_temp.assert(app.platform_secret_names() @> array['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'EXPO_ACCESS_TOKEN', 'STRIPE_SECRET_KEY', 'INTUIT_SANDBOX_CLIENT_SECRET']
                      and cardinality(app.platform_secret_names()) = 20,
  'the platform keys are 0320''s nineteen plus GEMINI_API_KEY');
select pg_temp.assert(app.platform_setting_keys() @> array['GEMINI_IMAGE_MODEL', 'portal_domain', 'INTUIT_REDIRECT_URI', 'PAYPAL_BN_CODE']
                      and cardinality(app.platform_setting_keys()) = 19,
  'the platform settings are 0320''s eighteen plus GEMINI_IMAGE_MODEL');
select pg_temp.assert((select required = false and sort = 85 and status = 'parked' and parked_at is not null and note like 'New with Flyers v2%'
                         from app.platform_setup_steps where key = 'art'),
  'the AI flyer art step is optional and starts parked, so a finished setup is not told it is unfinished');
select pg_temp.assert((select count(*) from app.platform_setup_steps) = 11
                      and (select array_agg(key order by sort) from app.platform_setup_steps where required) = '{background,portal,email,hooks}',
  'the wizard has 11 steps and the same four are required');

begin;
select pg_temp.sign_in_step_up(:pa);
select pg_temp.assert(app.set_platform_secret('gemini_api_key', 'AIzaSy-test-key-12345678901234567890', 'Flyers v2: the owner''s Gemini key') ->> 'fingerprint' = '7890',
  'a platform admin saves the Gemini key in the vault (only its last four characters are kept in the clear)');
select pg_temp.assert(app.set_platform_setting('GEMINI_IMAGE_MODEL', 'gemini-3.1-flash-image', 'Better quality for posters') ->> 'key' = 'GEMINI_IMAGE_MODEL',
  'and chooses the image model');
select pg_temp.assert_raises($s$select app.set_platform_secret('GEMINI_API_KEYS', 'AIzaSy-test-key-12345678901234567890', 'typo')$s$, 'is not a platform key', 'a name that is not on the list is still refused');
select app.complete_platform_setup_step('art', 'Key saved and tested');
select app.enqueue_platform_test('art') as art_test_job \gset
select pg_temp.assert_raises($s$select app.enqueue_platform_test('nope')$s$, 'no background test', 'an unknown step still has no test');
select pg_temp.assert_raises($s$select app.enqueue_platform_test('portal')$s$, 'no background test', 'and the portal step still has none');
commit;
reset role;
select pg_temp.assert((select count(*) from vault.secrets where name = 'connect/platform/GEMINI_API_KEY') = 1, 'the key is in the vault under the platform''s name');
select pg_temp.assert((select status = 'done' and parked_at is null from app.platform_setup_steps where key = 'art'), 'the art step can be completed like any other');
select pg_temp.assert((select kind = 'platform.test_provider' and center_id is null and payload ->> 'step' = 'art' from app.jobs where id = :'art_test_job'::bigint),
  'the Test button queues the background service''s art test (a free model lookup)');
begin;
select pg_temp.sign_in(:manager);
select pg_temp.assert_state($s$select app.enqueue_platform_test('art')$s$, '42501', 'an organization''s event manager cannot run the platform''s test');
select pg_temp.assert_state($s$select app.set_platform_secret('GEMINI_API_KEY', 'AIzaSy-test-key-12345678901234567890', 'sneaky')$s$, '42501', 'nor save its key');
rollback;

-- ── 2. The AI art library: who reads and writes it ──────────────────────────
insert into storage.objects (bucket_id, name, created_at) values
  ('content', :'art_frame', now() - interval '3 days'), ('content', :'art_scene', now() - interval '3 days'),
  ('content', :'art_diwali', now() - interval '3 days'), ('content', :'art_c2', now() - interval '3 days');

begin;
select pg_temp.sign_in(:member);
select pg_temp.assert(pg_temp.sees(:'art_frame') and pg_temp.sees(:'art_scene') and pg_temp.sees(:'art_diwali'), 'a member of the community reads its AI art library');
select pg_temp.assert(not pg_temp.sees(:'art_c2'), 'but not another community''s');
select pg_temp.assert(not app.can_write_object('content', :'art_frame') and not app.can_write_object('content', :c || '/flyer-art/garba/frame-2.png'),
  'a member cannot add to it');
rollback;
begin;
select pg_temp.as_anon();
select pg_temp.assert(not pg_temp.sees(:'art_frame') and not app.can_read_object('content', :'art_frame'), 'a guest never reads the library, even for a public event');
rollback;
begin;
select pg_temp.sign_in(:other);
select pg_temp.assert(not pg_temp.sees(:'art_frame') and not app.can_write_object('content', :c || '/flyer-art/garba/frame-3.png'),
  'a member of another community neither reads nor writes it');
rollback;

begin;
select pg_temp.sign_in(:manager);
select pg_temp.assert(app.can_write_object('content', :c || '/flyer-art/garba/frame-4.png') and app.can_write_object('content', :c || '/flyer-art/paryushan/scene-2147483647.jpg'),
  'an event manager (events.manage, no content.manage) adds a layer under its well-formed name');
select pg_temp.assert(not app.can_write_object('content', :c2 || '/flyer-art/garba/frame-4.png'), 'but not to another community''s library');
select pg_temp.assert(not app.can_write_object('content', :c || '/flyer-art/garba/frame-0.png')
                      and not app.can_write_object('content', :c || '/flyer-art/garba/frame-1.webp')
                      and not app.can_write_object('content', :c || '/flyer-art/garba/frame-1.gif')
                      and not app.can_write_object('content', :c || '/flyer-art/birthday/frame-1.png')
                      and not app.can_write_object('content', :c || '/flyer-art/garba/background-1.png')
                      and not app.can_write_object('content', :c || '/flyer-art/garba/frame-x.png')
                      and not app.can_write_object('content', :c || '/flyer-art/frame-1.png')
                      and not app.can_write_object('content', :c || '/flyer-art/garba/sub/frame-1.png')
                      and not app.can_write_object('content', :c || '/flyer-art/garba/../frame-1.png')
                      and not app.can_write_object('content', :c || '/flyer-art/garba/frame-1.png.exe'),
  'only a well-formed layer name is writable: no seed 0, no other type, occasion, layer, folder or path trick');
insert into storage.objects (bucket_id, name) values ('content', :c || '/flyer-art/garba/frame-4.png');
select pg_temp.assert(pg_temp.sees(:c || '/flyer-art/garba/frame-4.png'), 'the upload itself is accepted and the manager reads it back');
select pg_temp.assert_raises(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'content', :c || '/flyer-art/garba/notes.pdf'), 'row-level security',
  'a file that is not a layer is refused at the upload');
select pg_temp.assert_raises(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'content', :c2 || '/flyer-art/garba/frame-4.png'), 'row-level security',
  'and so is one for another community');
with d as (delete from storage.objects where bucket_id = 'content' and name = :'art_diwali' returning 1) select count(*) as removed from d \gset
select pg_temp.assert(:'removed'::int = 1, 'the manager discards a picture from the library');
rollback;
begin;
select pg_temp.sign_in(:lead);
select pg_temp.assert(app.can_write_object('content', :c || '/flyer-art/diwali/scene-5.jpg'), 'an event lead adds to it too');
rollback;
begin;
select pg_temp.sign_in(:curator);
select pg_temp.assert(app.can_write_object('content', :c || '/flyer-art/diwali/scene-5.jpg') and not app.can_write_object('content', :c || '/flyer-art/diwali/note.txt'),
  'so does a content manager, still only under a layer name');
rollback;
select pg_temp.assert(not has_function_privilege('authenticated', 'app.flyer_art_writer(uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.flyer_art_writer(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.flyer_art_name_ok(text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.flyer_art_daily_limit()', 'execute')
                      and not has_function_privilege('authenticated', 'app.flyer_art_over_limit(uuid)', 'execute'),
  'the helpers are internal: only the storage rules and the request functions call them');

-- Events and Content module switches.
begin;
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c, 'events', false, 'Test 70: events off');
select pg_temp.sign_in(:manager);
select pg_temp.assert(not app.can_write_object('content', :c || '/flyer-art/garba/frame-4.png'), 'with Events off, nobody adds to the AI art library');
select pg_temp.sign_in(:member);
select pg_temp.assert(not pg_temp.sees(:'art_frame'), 'and nobody reads it (it belongs to Events, like an event''s own folder)');
rollback;
begin;
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c, 'content', false, 'Test 70: content off');
select pg_temp.sign_in(:manager);
select pg_temp.assert(app.can_write_object('content', :c || '/flyer-art/garba/frame-4.png'), 'with Content off and Events on, the manager still adds to it');
select pg_temp.sign_in(:member);
select pg_temp.assert(pg_temp.sees(:'art_frame'), 'and a member still reads it');
rollback;

-- The rules for everything else are as they were (spot checks; test 65 has the full set).
begin;
select pg_temp.sign_in(:manager);
select pg_temp.assert(app.can_write_object('content', :c || '/events/' || :e1 || '/flyer-9.png') and not app.can_write_object('content', :c || '/guide/x.png'),
  'an event folder is still writable by the manager, and the rest of the bucket still needs content.manage');
select pg_temp.assert(not app.can_write_object('content', :c || '/events/' || :e_c2 || '/flyer-9.png'), 'an event folder must still be an event of that community');
rollback;

-- ── 3. Asking for one layer of art ──────────────────────────────────────────
select pg_temp.assert(has_function_privilege('authenticated', 'app.events_request_flyer_art(uuid, text, text, bigint, text)', 'execute')
                      and not has_function_privilege('anon', 'app.events_request_flyer_art(uuid, text, text, bigint, text)', 'execute')
                      and has_function_privilege('authenticated', 'app.flyer_art_status(uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.flyer_art_status(uuid)', 'execute'),
  'signed-in organizers may ask and may check; guests may do neither');

begin;
select pg_temp.sign_in(:manager);
select app.events_request_flyer_art(:e1::uuid, 'garba', 'frame', 4242, 'A decorative border frame. No text of any kind.') as q1 \gset
commit;
select pg_temp.assert((:'q1'::jsonb ->> 'status') = 'queued', 'an event manager asks for a frame and it is queued');
select pg_temp.assert((select kind = 'events.generate_flyer' and center_id = :c::uuid and max_attempts = 3
                              and payload = jsonb_build_object('event_id', :e1::uuid, 'occasion', 'garba', 'layer', 'frame', 'seed', 4242, 'prompt', 'A decorative border frame. No text of any kind.')
                         from app.jobs where id = (:'q1'::jsonb ->> 'job_id')::bigint),
  'the job carries the event, the occasion, the layer, the seed and the prompt');
select pg_temp.assert((select flyer_job_id = (:'q1'::jsonb ->> 'job_id')::bigint from app.events where id = :e1::uuid), 'and the event points at it, so a reload finds the picture');

begin;
select pg_temp.sign_in(:lead);
select app.events_request_flyer_art(:e1::uuid, 'garba', 'scene', 4243, 'A festive Navratri night.') as q2 \gset
commit;
select pg_temp.assert((:'q2'::jsonb ->> 'status') = 'queued', 'the event''s lead may ask too');
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises(format('select app.events_request_flyer_art(%L::uuid, %L, %L, 5, %L)', :e1, 'garba', 'frame', 'x'), 'only event managers', 'a member cannot ask');
rollback;
begin;
select pg_temp.sign_in(:lead2);
select pg_temp.assert_raises(format('select app.events_request_flyer_art(%L::uuid, %L, %L, 5, %L)', :e1, 'garba', 'frame', 'x'), 'only event managers', 'nor the lead of a different event');
rollback;
begin;
select pg_temp.sign_in(:manager);
select pg_temp.assert_raises(format('select app.events_request_flyer_art(%L::uuid, %L, %L, 5, %L)', :e1, 'birthday', 'frame', 'x'), 'choose one of the occasions', 'the occasion must be one of the eight');
select pg_temp.assert_raises(format('select app.events_request_flyer_art(%L::uuid, %L, %L, 5, %L)', :e1, 'garba', 'background', 'x'), 'frame or a bottom scene', 'the layer must be a frame or a scene');
select pg_temp.assert_raises(format('select app.events_request_flyer_art(%L::uuid, %L, %L, 0, %L)', :e1, 'garba', 'frame', 'x'), 'out of range', 'the seed must be at least 1');
select pg_temp.assert_raises(format('select app.events_request_flyer_art(%L::uuid, %L, %L, 2147483648, %L)', :e1, 'garba', 'frame', 'x'), 'out of range', 'and at most 2^31 - 1');
select pg_temp.assert_raises(format('select app.events_request_flyer_art(%L::uuid, %L, %L, 5, %L)', :e1, 'garba', 'frame', '   '), 'no description', 'the prompt cannot be empty');
select pg_temp.assert_raises(format('select app.events_request_flyer_art(%L::uuid, %L, %L, 5, %L)', '70000000-0000-4000-8000-0000000000ff', 'garba', 'frame', 'x'), 'no longer exists', 'the event must exist');
select app.events_request_flyer_art(:e1::uuid, 'garba', 'frame', 6, repeat('x', 5000)) as q3 \gset
commit;
select pg_temp.assert((select char_length(payload ->> 'prompt') = 2000 from app.jobs where id = (:'q3'::jsonb ->> 'job_id')::bigint), 'a long prompt is cut at 2,000 characters');

-- The daily limit: 30 AI pictures a community, layers and backgrounds together, in 24 hours.
select pg_temp.assert(app.flyer_art_daily_limit() = 30, 'the limit is thirty pictures a day');
select pg_temp.assert((select count(*) from app.jobs where center_id = :c::uuid and kind = 'events.generate_flyer' and created_at > now() - interval '24 hours') = 3,
  'so far this community has asked for three pictures today');
insert into app.jobs (center_id, kind, payload, status, created_at)
select :c::uuid, 'events.generate_flyer', jsonb_build_object('event_id', :e2::uuid, 'prompt', 'x'), 'failed', now() - interval '2 hours' from generate_series(1, 26);
insert into app.jobs (center_id, kind, payload, status, created_at)
select :c::uuid, 'events.generate_flyer', jsonb_build_object('event_id', :e2::uuid, 'prompt', 'x'), 'done', now() - interval '30 hours' from generate_series(1, 10);
insert into app.jobs (center_id, kind, payload, status, created_at)
select :c2::uuid, 'events.generate_flyer', jsonb_build_object('event_id', :e_c2::uuid, 'prompt', 'x'), 'done', now() from generate_series(1, 40);
select pg_temp.assert(app.flyer_art_over_limit(:c::uuid) is null, 'at 29 in the last day (older ones and other communities'' do not count) the community is still under its limit');
select pg_temp.assert(app.flyer_art_over_limit(:c2::uuid) is not null, 'another community with forty is over its own');
begin;
select pg_temp.sign_in(:manager);
select app.events_request_flyer_art(:e1::uuid, 'diwali', 'frame', 8, 'Rows of small glowing lamps.') as q30 \gset
commit;
select pg_temp.assert((:'q30'::jsonb ->> 'status') = 'queued', 'the thirtieth is accepted');
begin;
select pg_temp.sign_in(:manager);
select app.events_request_flyer_art(:e1::uuid, 'diwali', 'scene', 9, 'Rows of small glowing lamps.') as q31 \gset
select app.events_request_flyer(:e1::uuid, 'Abstract golden mandala pattern') as q32 \gset
commit;
select pg_temp.assert((:'q31'::jsonb ->> 'status') = 'unavailable'
                      and (:'q31'::jsonb ->> 'reason') like 'This community has asked for 30 AI pictures in the last 24 hours, the most allowed in a day.%',
  'the thirty-first is refused with a plain sentence (reuse one already made, use the drawn art, or try again tomorrow)');
select pg_temp.assert((:'q32'::jsonb ->> 'status') = 'unavailable' and (:'q32'::jsonb ->> 'reason') like 'This community has asked for 30 AI pictures%',
  'a background request counts against the same limit');
select pg_temp.assert((select count(*) from app.jobs where center_id = :c::uuid and kind = 'events.generate_flyer' and created_at > now() - interval '24 hours') = 30,
  'and nothing was queued for either');
begin;
select pg_temp.sign_in(:other);
select pg_temp.assert_raises(format('select app.events_request_flyer_art(%L::uuid, %L, %L, 5, %L)', :e_c2, 'garba', 'frame', 'x'), 'only event managers', 'a member of another community still cannot ask');
rollback;
-- Put the day's jobs back so the rest of the test starts clean.
update app.events set flyer_job_id = null where center_id in (:c::uuid, :c2::uuid);
delete from app.jobs where center_id in (:c::uuid, :c2::uuid) and kind = 'events.generate_flyer';

-- Image bytes still held by this event's finished jobs are dropped before a new request (as 0578's request does).
insert into app.jobs (center_id, kind, payload, status, result, finished_at)
values (:c, 'events.generate_flyer', jsonb_build_object('event_id', :e1, 'occasion', 'garba', 'layer', 'frame', 'seed', 1, 'prompt', 'x'), 'done',
        jsonb_build_object('image_b64', 'ZmFrZQ==', 'content_type', 'image/png'), now())
returning id as job_old \gset
insert into app.jobs (center_id, kind, payload, status, result, finished_at)
values (:c, 'events.generate_flyer', jsonb_build_object('event_id', :e2, 'prompt', 'x'), 'done', jsonb_build_object('image_b64', 'ZmFrZQ=='), now())
returning id as job_e2 \gset
begin;
select pg_temp.sign_in(:manager);
select app.events_request_flyer_art(:e1::uuid, 'garba', 'scene', 11, 'A festive night.') as q4 \gset
commit;
select pg_temp.assert((select not (result ? 'image_b64') from app.jobs where id = :job_old), 'asking again drops the bytes this event''s earlier finished job still held');
select pg_temp.assert((select result ? 'image_b64' from app.jobs where id = :job_e2), 'and leaves another event''s fresh result for its organizer');

-- ── 4. "Art taken": the bytes leave app.jobs, and only at the picture's own key ──
-- A layer job accepts exactly the cache key it was asked for (its occasion, layer and seed), as .png or .jpg.
insert into app.jobs (center_id, kind, payload, status, result, finished_at)
values (:c, 'events.generate_flyer', jsonb_build_object('event_id', :e1, 'occasion', 'garba', 'layer', 'frame', 'seed', 12345, 'prompt', 'x'), 'done',
        jsonb_build_object('image_b64', 'ZmFrZQ==', 'content_type', 'image/png', 'model', 'gemini-3.1-flash-lite-image', 'provider', 'gemini',
                           'layer', 'frame', 'occasion', 'garba', 'seed', 12345, 'prompt', 'x'), now())
returning id as job_layer \gset
update app.events set flyer_job_id = :job_layer where id = :e1;
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises(format('select app.events_flyer_art_taken(%L::uuid, %L)', :e1, :'art_frame'), 'only event managers', 'a member cannot mark a picture as stored');
rollback;
begin;
select pg_temp.sign_in(:manager);
select pg_temp.assert_raises(format('select app.events_flyer_art_taken(%L::uuid, %L)', :e1, :c || '/flyer-art/garba/frame-12346.png'), 'not the art this request made', 'another seed is refused');
select pg_temp.assert_raises(format('select app.events_flyer_art_taken(%L::uuid, %L)', :e1, :c || '/flyer-art/garba/scene-12345.png'), 'not the art this request made', 'another layer is refused');
select pg_temp.assert_raises(format('select app.events_flyer_art_taken(%L::uuid, %L)', :e1, :c || '/flyer-art/diwali/frame-12345.png'), 'not the art this request made', 'another occasion is refused');
select pg_temp.assert_raises(format('select app.events_flyer_art_taken(%L::uuid, %L)', :e1, :c2 || '/flyer-art/garba/frame-12345.png'), 'not the art this request made', 'another community''s library is refused');
select pg_temp.assert_raises(format('select app.events_flyer_art_taken(%L::uuid, %L)', :e1, :c || '/flyer-art/garba/frame-12345.webp'), 'not the art this request made', 'another type is refused');
select pg_temp.assert_raises(format('select app.events_flyer_art_taken(%L::uuid, %L)', :e1, :c || '/events/' || :e1 || '/art-1.jpg'), 'not the art this request made', 'a background-art path is refused for a layer');
select pg_temp.assert_raises(format('select app.events_flyer_art_taken(%L::uuid, %L)', :e1, null), 'not the art this request made', 'no path is refused');
commit;
begin;
select pg_temp.sign_in(:manager);
select app.events_flyer_art_taken(:e1::uuid, :c || '/flyer-art/garba/frame-12345.png');
commit;
select pg_temp.assert((select not (result ? 'image_b64') and result ->> 'stored_path' = :c || '/flyer-art/garba/frame-12345.png' and result ? 'stored_at'
                              and result ->> 'layer' = 'frame' and (result ->> 'seed')::int = 12345 and result ->> 'content_type' = 'image/png'
                         from app.jobs where id = :job_layer),
  'the bytes leave the job, the stored path is recorded, and the rest of the result (layer, occasion, seed) is kept');
select pg_temp.assert(not exists (select 1 from app.audit_log where record_table = 'jobs' and record_id = :'job_layer'
                                     and (coalesce(before #>> '{result,image_b64}', '***') <> '***' or coalesce(after #>> '{result,image_b64}', '***') <> '***')),
  'no audit entry of the layer job holds the image bytes');
-- The same job, a JPEG this time, and a lead may keep it.
insert into app.jobs (center_id, kind, payload, status, result, finished_at)
values (:c, 'events.generate_flyer', jsonb_build_object('event_id', :e1, 'occasion', 'garba', 'layer', 'scene', 'seed', 9, 'prompt', 'x'), 'done',
        jsonb_build_object('image_b64', 'ZmFrZQ==', 'content_type', 'image/jpeg'), now())
returning id as job_scene \gset
update app.events set flyer_job_id = :job_scene where id = :e1;
begin;
select pg_temp.sign_in(:lead);
select app.events_flyer_art_taken(:e1::uuid, :'art_scene');
commit;
select pg_temp.assert((select not (result ? 'image_b64') and result ->> 'stored_path' = :'art_scene' from app.jobs where id = :job_scene), 'a JPEG scene is kept at its .jpg key, by the event''s lead');
-- A background job (no layer) keeps 0578's rule: the picture is in the event's own folder, never in the library.
insert into app.jobs (center_id, kind, payload, status, result, finished_at)
values (:c, 'events.generate_flyer', jsonb_build_object('event_id', :e1, 'prompt', 'x'), 'done', jsonb_build_object('image_b64', 'ZmFrZQ=='), now())
returning id as job_bg \gset
update app.events set flyer_job_id = :job_bg where id = :e1;
begin;
select pg_temp.sign_in(:manager);
select pg_temp.assert_raises(format('select app.events_flyer_art_taken(%L::uuid, %L)', :e1, :'art_frame'), 'not this event''s flyer art', 'a library path is refused for a background request');
select app.events_flyer_art_taken(:e1::uuid, :c || '/events/' || :e1 || '/art-1759300000000.jpg');
commit;
select pg_temp.assert((select not (result ? 'image_b64') and result ->> 'stored_path' = :c || '/events/' || :e1 || '/art-1759300000000.jpg' from app.jobs where id = :job_bg),
  'and the event''s own art-<ms> path is accepted, as in 0578');

-- ── 5. Is AI art available? From the workers' heartbeats ────────────────────
delete from app.worker_heartbeats;
begin;
select pg_temp.sign_in(:member);
select app.flyer_art_status(:c::uuid) as s0 \gset
commit;
select pg_temp.assert((:'s0'::jsonb ->> 'state') = 'no_service', 'with no worker reporting, AI art is "no service" (the drawn art still works)');
insert into app.worker_heartbeats (worker, started_at, beat_at, version, kinds, info) values
  ('old-worker', now() - interval '1 day', now(), '0.5.0', array['events.generate_flyer'],
   jsonb_build_object('handlers', jsonb_build_object('events.generate_flyer', jsonb_build_object('configured', true))));
begin;
select pg_temp.sign_in(:member);
select app.flyer_art_status(:c::uuid) as s1 \gset
commit;
select pg_temp.assert((:'s1'::jsonb ->> 'state') = 'update_needed', 'a live worker that does not know Gemini yet (an older deploy) is "update needed", even if it says it is configured');
update app.worker_heartbeats set info = jsonb_build_object('handlers', jsonb_build_object('events.generate_flyer',
         jsonb_build_object('configured', false, 'reason', 'AI art needs a Gemini key', 'provider', 'gemini', 'model', 'gemini-3.1-flash-lite-image')))
 where worker = 'old-worker';
begin;
select pg_temp.sign_in(:member);
select app.flyer_art_status(:c::uuid) as s2 \gset
commit;
select pg_temp.assert((:'s2'::jsonb ->> 'state') = 'no_key', 'a worker that knows Gemini but has no key is "no key"');
update app.worker_heartbeats set info = jsonb_build_object('handlers', jsonb_build_object('events.generate_flyer',
         jsonb_build_object('configured', true, 'provider', 'gemini', 'model', 'gemini-3.1-flash-image')))
 where worker = 'old-worker';
begin;
select pg_temp.sign_in(:member);
select app.flyer_art_status(:c::uuid) as s3 \gset
commit;
select pg_temp.assert((:'s3'::jsonb ->> 'state') = 'ready' and (:'s3'::jsonb ->> 'model') = 'gemini-3.1-flash-image', 'a worker with a key is "ready", and says which model');
insert into app.worker_heartbeats (worker, started_at, beat_at, version, kinds, info) values
  ('new-worker', now(), now(), '0.6.0', array['events.generate_flyer'],
   jsonb_build_object('handlers', jsonb_build_object('events.generate_flyer', jsonb_build_object('configured', false, 'provider', 'gemini', 'model', 'gemini-3.1-flash-lite-image'))));
begin;
select pg_temp.sign_in(:member);
select app.flyer_art_status(:c::uuid) as s4 \gset
commit;
select pg_temp.assert((:'s4'::jsonb ->> 'state') = 'ready', 'with two workers, one with a key is enough');
update app.worker_heartbeats set beat_at = now() - interval '10 minutes';
begin;
select pg_temp.sign_in(:member);
select app.flyer_art_status(:c::uuid) as s5 \gset
commit;
select pg_temp.assert((:'s5'::jsonb ->> 'state') = 'no_service', 'workers that stopped reporting (older than the service''s 3 minutes) do not count');
update app.worker_heartbeats set beat_at = now(), stopped_at = now();
begin;
select pg_temp.sign_in(:member);
select app.flyer_art_status(:c::uuid) as s6 \gset
commit;
select pg_temp.assert((:'s6'::jsonb ->> 'state') = 'no_service', 'nor do workers that shut down cleanly');
update app.worker_heartbeats set stopped_at = null where worker = 'old-worker';
begin;
select pg_temp.sign_in(:other);
select pg_temp.assert_state(format('select app.flyer_art_status(%L::uuid)', :c), '42501', 'a member of another community cannot ask about this community');
rollback;
begin;
select pg_temp.as_anon();
select pg_temp.assert_state(format('select app.flyer_art_status(%L::uuid)', :c), '42501', 'nor can a guest');
rollback;
begin;
select pg_temp.sign_in_step_up(:pa);
select pg_temp.assert(app.flyer_art_status(:c::uuid) ->> 'state' = 'ready', 'a platform admin may');
rollback;
select pg_temp.assert(:'s3' not like '%AIzaSy%' and :'s2' not like '%AIzaSy%', 'the answer never carries a key (it is built from names only)');
delete from app.worker_heartbeats;

-- ── 6. Partner logos: tidied like the other flyer files, but never the one in use ──
insert into storage.objects (bucket_id, name, created_at) values
  ('content', :'logo_cur', now() - interval '9 days'), ('content', :'logo_old', now() - interval '2 days'),
  ('content', :'logo_orphan', now() - interval '8 days'), ('content', :'logo_fresh', now() - interval '3 hours'),
  ('content', :'flyer_old', now() - interval '5 minutes');
update app.events set flyer_path = null, flyer_source = 'designed',
       flyer_design = jsonb_build_object('v', 1, 'template', 'poster', 'size', 'tall', 'headline', 'Garba Night', 'show_qr', true,
                                         'background', jsonb_build_object('source', 'plain'),
                                         'poster', jsonb_build_object('occasion', 'garba', 'partner', jsonb_build_object('on', true, 'logo_path', :'logo_cur')))
 where id = :e1;
begin;
select pg_temp.sign_in(:manager);
select pg_temp.assert(array(select l.name from app.event_flyer_leftovers(:e1::uuid) l) = array[:'logo_orphan', :'logo_old']::text[],
  'leftovers: partner logos older than a day, oldest first; never the one the saved design uses, and not fresh ones or flyers under ten minutes');
rollback;
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises(format('select * from app.event_flyer_leftovers(%L::uuid)', :e1), 'only event managers', 'a member still cannot list an event''s flyer files');
rollback;
begin;
set local role connect_worker;
select pg_temp.assert((select array_agg(x.name || '|' || x.retention_days order by x.name) from app.storage_expired_objects(1000) x where x.center_id = :c::uuid)
                        = array[:'logo_orphan' || '|7']::text[],
  'the 7-day sweep lists an orphaned partner logo; not the one the design uses, newer ones, or anything in the AI art library');
commit;
select pg_temp.assert(exists (select 1 from storage.objects where bucket_id = 'content' and name = :'art_frame') and (select count(*) from storage.objects where name like :c || '/flyer-art/%') >= 3,
  'the AI art library is the cache every later flyer reuses: nothing sweeps it');

-- ── 7. The column's note names the poster ───────────────────────────────────
select pg_temp.assert((select col_description('app.events'::regclass, attnum) like '%poster (0585, optional; required when template = poster)%'
                              and col_description('app.events'::regclass, attnum) like '%post|tall|story|print%'
                         from pg_attribute where attrelid = 'app.events'::regclass and attname = 'flyer_design'),
  'the flyer_design column comment describes the poster field and the Tall size');
