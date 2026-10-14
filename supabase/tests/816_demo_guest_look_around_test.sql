-- 0816: a demo community is open to guests (not signed in) while the demo is on, and only then.
--   A. The two questions: may a guest see this demo community now (app.demo_public_open), is it closed to guests (app.demo_closed_to_guests)
--   B. The demo is on: a guest opens the community, its areas, its public events, guide and store; the list tells the app which to open
--   C. Guests never write
--   D. The demo is off: the community is gone for a guest, in every reader; a platform admin still has it; a live community is untouched
--   E. On again, and a suspended demo community is not opened
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
  if position(lower(expect) in lower(sqlerrm)) = 0 then
    raise exception 'FAIL: % (got "%")', label, sqlerrm;
  end if;
  raise notice 'PASS: %', label;
end $$;
-- A write a guest may not make: refused for lack of a privilege or by row level security (both are SQLSTATE 42501).
create or replace function pg_temp.assert_denied(stmt text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (it was allowed)', label;
exception when insufficient_privilege then
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.claims(p_user text, p_step_up boolean default false) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', case when p_step_up then 'aal2' else 'aal1' end,
    'amr', case when p_step_up
                then jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 600),
                                       jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 60))
                else jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 60)) end)::text, true);
end $$;
create or replace function pg_temp.as_none() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
  set local role anon;
end $$;
create or replace function pg_temp.as_user(p_user text) returns void language plpgsql as $$
begin
  reset role;
  perform pg_temp.claims(p_user, false);
  perform set_config('request.headers', '', true);
  set local role authenticated;
end $$;

\set admin '''e8160000-0000-4000-8000-0000000000a1'''
\set jsh '''00000000-0000-4000-8000-000000000001'''

select pg_temp.as_none();
insert into auth.users (id, email) values (:admin, 'admin816@platform.test');
insert into app.accounts (user_id, is_platform_admin) values (:admin, true) on conflict (user_id) do update set is_platform_admin = true;
select pg_temp.claims(:admin, true);
select (app.create_demo_community('faith'))->>'center_id' as fc \gset
select (app.create_demo_community('neutral'))->>'center_id' as nc \gset
select slug::text as fslug from app.centers where id = :'fc' \gset
select slug::text as nslug from app.centers where id = :'nc' \gset
select slug::text as jslug from app.centers where id = :jsh \gset
select pg_temp.claims(:admin, false);
select app.demo_signin_setup('Set up the demo sign-ins for the test') is not null as setup_done \gset

-- What a guest may read of the faith demo, counted as the system itself (the same conditions the guest policies state).
select pg_temp.as_none();
select count(*) as n_events from app.events
 where center_id = :'fc' and audience in ('public', 'members_and_guests') and status in ('published', 'rsvp_closed', 'live') and not confidential \gset
select count(*) as n_store from app.store_items where center_id = :'fc' and status = 'active' \gset
select count(*) as n_guide from app.guide_sections where center_id = :'fc' and public \gset
select count(*) as n_jsh_events from app.events
 where center_id = :jsh and audience in ('public', 'members_and_guests') and status in ('published', 'rsvp_closed', 'live') and not confidential \gset
select pg_temp.assert(:n_events > 0, 'the faith demo has public events to look at');

-- ══ A. The two questions ════════════════════════════════════════════════════
select pg_temp.claims(:admin, false);
select pg_temp.assert(not app.demo_signin_enabled(), 'A · the demo is off to begin with');
select pg_temp.assert(not app.demo_public_open(:'fc') and not app.demo_public_open(:'nc'), 'A · off: no demo community is open to guests');
select pg_temp.assert(app.demo_closed_to_guests(:'fc') and app.demo_closed_to_guests(:'nc'), 'A · off: each is closed to guests');
select app.set_demo_signin(true, 'Open the demo for the test') is not null as switched_on \gset
select pg_temp.assert(app.demo_signin_enabled(), 'A · switched on');
select pg_temp.assert(app.demo_public_open(:'fc') and app.demo_public_open(:'nc'), 'A · on: both demo communities are open to guests');
select pg_temp.assert(not app.demo_closed_to_guests(:'fc') and not app.demo_closed_to_guests(:'nc'), 'A · on: neither is closed to guests');
select pg_temp.assert(not app.demo_public_open(:jsh) and not app.demo_closed_to_guests(:jsh),
  'A · a live community is not a demo one: it is neither "open because it is a demo" nor closed by the demo switch');
select pg_temp.assert(not app.demo_public_open(null) and not app.demo_closed_to_guests(null), 'A · nor is nothing');
select pg_temp.assert(has_function_privilege('anon', 'app.demo_public_open(uuid)', 'execute') and has_function_privilege('anon', 'app.demo_closed_to_guests(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.demo_public_open(uuid)', 'execute'),
  'A · the questions can be asked by a guest and by a signed-in person (the policies ask them as the reader)');

-- ══ B. The demo is on: what a guest reads ═══════════════════════════════════
select pg_temp.as_anon();
select count(*) as a_pub from app.community_public(:'fslug') \gset
select count(*) as a_pub_n from app.community_public(:'nslug') \gset
select count(*) as a_pub_id from app.community_public_by_id(:'fc') \gset
select count(*) as a_table from app.centers where id = :'fc' \gset
select jsonb_typeof(app.feature_access_for_me(:'fc')) as a_access \gset
select (app.member_experience(:'fc') ? 'center')::text as a_exp \gset
select count(*) as a_events from app.events where center_id = :'fc' \gset
select count(*) as a_store from app.store_items where center_id = :'fc' \gset
select count(*) as a_guide from app.guide_sections where center_id = :'fc' \gset
select count(*) as a_jsh from app.community_public(:'jslug') \gset
select count(*) as a_jsh_events from app.events where center_id = :jsh \gset
select app.demo_choices()::text as ch \gset
select pg_temp.as_none();
select pg_temp.assert(:a_pub = 1 and :a_pub_n = 1 and :a_pub_id = 1, 'B · a guest opens both demo communities, by web name and by id');
select pg_temp.assert(:a_table = 1, 'B · and an old app build, which reads the table, finds the community row');
select pg_temp.assert(:'a_access' = 'object' and :'a_exp' = 'true', 'B · and its areas and experience answer (no "not found")');
select pg_temp.assert(:a_events = :n_events, 'B · a guest reads exactly the public events of the demo community (and no other)');
select pg_temp.assert(:a_store = :n_store and :a_guide = :n_guide, 'B · and its store items and guide pages');
select pg_temp.assert(:a_jsh = 1 and :a_jsh_events = :n_jsh_events, 'B · the live community is read as before');
select pg_temp.assert((:'ch'::jsonb ->> 'enabled')::boolean and jsonb_array_length(:'ch'::jsonb -> 'communities') = 2, 'B · the public list offers both demo communities');
select pg_temp.assert(not exists (select 1 from jsonb_array_elements(:'ch'::jsonb -> 'communities') c
                                   where not ((c ->> 'id')::uuid in (:'fc'::uuid, :'nc'::uuid)
                                              and (c ->> 'slug') in (:'fslug', :'nslug')
                                              and (c ->> 'id')::uuid = (select ce.id from app.centers ce where ce.slug = (c ->> 'slug')::citext))),
  'B · and says each community''s own id and web name, so the app can open it as a guest');
select pg_temp.assert(position('weaverams.org' in :'ch') = 0, 'B · and still never an address');

-- ══ C. Guests never write ═══════════════════════════════════════════════════
select pg_temp.as_anon();
select pg_temp.assert_denied('insert into app.events select * from app.events limit 0', 'C · a guest cannot add an event');
select pg_temp.assert_denied(format('update app.events set status = status where center_id = %L', :'fc'), 'C · or change one');
select pg_temp.assert_denied(format('delete from app.events where center_id = %L', :'fc'), 'C · or delete one');
select pg_temp.assert_denied('insert into app.store_items select * from app.store_items limit 0', 'C · or add a store item');
select pg_temp.assert_denied(format('update app.guide_sections set title = title where center_id = %L', :'fc'), 'C · or change a guide page');
select pg_temp.assert_denied(format('update app.centers set name = name where id = %L', :'fc'), 'C · or the community');
select pg_temp.assert_denied('insert into app.rsvps select * from app.rsvps limit 0', 'C · RSVP stays for people who sign in');
select pg_temp.assert_denied('insert into app.pledges select * from app.pledges limit 0', 'C · so does giving');
select pg_temp.assert_denied('insert into app.store_orders select * from app.store_orders limit 0', 'C · and shopping');
select pg_temp.as_none();

-- ══ D. The demo is off: gone for a guest ════════════════════════════════════
select pg_temp.claims(:admin, false);
select app.set_demo_signin(false, 'Close the demo for the test') is not null as switched_off \gset
select pg_temp.assert(not app.demo_signin_enabled() and app.demo_closed_to_guests(:'fc') and not app.demo_public_open(:'fc'), 'D · switched off');
select pg_temp.as_anon();
select count(*) as d_pub from app.community_public(:'fslug') \gset
select count(*) as d_pub_n from app.community_public(:'nslug') \gset
select count(*) as d_pub_id from app.community_public_by_id(:'fc') \gset
select count(*) as d_table from app.centers where id = :'fc' \gset
select count(*) as d_events from app.events where center_id = :'fc' \gset
select count(*) as d_store from app.store_items where center_id = :'fc' \gset
select count(*) as d_guide from app.guide_sections where center_id = :'fc' \gset
select count(*) as d_jsh from app.community_public(:'jslug') \gset
select count(*) as d_jsh_events from app.events where center_id = :jsh \gset
select pg_temp.assert(:d_pub = 0 and :d_pub_n = 0 and :d_pub_id = 0, 'D · a guest cannot open a demo community any more');
select pg_temp.assert(:d_table = 0, 'D · nor find its row in the table');
select pg_temp.assert(:d_events = 0 and :d_store = 0 and :d_guide = 0, 'D · nor read its events, store or guide');
select pg_temp.assert_raises(format('select app.feature_access_for_me(%L)', :'fc'), 'not found', 'D · its areas are "not found"');
select pg_temp.assert_raises(format('select app.member_experience(%L)', :'fc'), 'not found', 'D · and so is its experience');
select pg_temp.assert(not app.can_use_feature(:'fc', 'events'), 'D · and no area of it can be used');
select app.demo_choices()::text as ch_off \gset
select pg_temp.as_none();
select pg_temp.assert(:d_jsh = 1 and :d_jsh_events = :n_jsh_events, 'D · the live community is untouched by the switch');
select pg_temp.assert(not (:'ch_off'::jsonb ->> 'enabled')::boolean, 'D · and the public list says the demo is off');
-- The Weaver team still has the demo community while it is off.
select pg_temp.as_user(:'admin');
select count(*) as p_pub from app.community_public(:'fslug') \gset
select count(*) as p_table from app.centers where id = :'fc' \gset
select pg_temp.as_none();
select pg_temp.assert(:p_pub = 1 and :p_table = 1, 'D · a platform admin still opens it');

-- ══ E. On again; a demo community that is suspended is not opened ═══════════
select pg_temp.claims(:admin, false);
select app.set_demo_signin(true, 'Open the demo again for the test') is not null as switched_on2 \gset
select pg_temp.as_anon();
select count(*) as e_pub from app.community_public(:'fslug') \gset
select count(*) as e_events from app.events where center_id = :'fc' \gset
select pg_temp.as_none();
select pg_temp.assert(:e_pub = 1 and :e_events = :n_events, 'E · switched on again, a guest opens it again and reads its events');
update app.centers set status = 'suspended' where id = :'nc';
select pg_temp.assert(not app.demo_public_open(:'nc') and app.demo_public_open(:'fc'), 'E · a suspended demo community is not open to guests, the other one is');
select pg_temp.as_anon();
select count(*) as e_susp from app.community_public(:'nslug') \gset
select count(*) as e_susp_table from app.centers where id = :'nc' \gset
select pg_temp.as_none();
select pg_temp.assert(:e_susp = 0 and :e_susp_table = 0, 'E · and a guest does not find the suspended one, whatever the switch says');

rollback;
