-- 0620 + 0621 (backlog B91): the activity stream. app.record_activity takes the person and the community from the sign-in
-- and drops everything it should not store; raw rows are for platform admins only; the three stream tables are not in the
-- row-level audit; the community's switch is the platform admin's alone.
--   A. The tables, grants, indexes and functions   B. Screen keys   C. Who is recorded, by surface   D. What is stored
--   (shapes)   E. Dropped events   F. The switch and its guard   G. Opt-out (also after leaving a community)   H. Batch cap
--   and rate limit   I. Isolation between communities and pseudonyms   J. Raw rows are Weaver's   K. The daily sweep
--   L. The lock that serialises one person's calls   M. activity_status   N. No audit rows
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
-- Sign in as a user (claims and role) for the statements that follow; as_none() signs out again.
create or replace function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('request.headers', '', true);
  set local role authenticated;
end $$;
create or replace function pg_temp.as_none() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;
-- Record a batch as a user and sign out again; returns what record_activity returned.
create or replace function pg_temp.act(p_user uuid, p_center uuid, p_events jsonb) returns integer language plpgsql as $$
declare n integer;
begin
  perform pg_temp.as_user(p_user);
  n := app.record_activity(p_center, p_events);
  perform pg_temp.as_none();
  return n;
end $$;
-- The newest stored event of a community.
create or replace function pg_temp.newest(p_center uuid) returns app.activity_events language sql as $$
  select e from app.activity_events e where e.center_id = p_center order by e.id desc limit 1
$$;
-- n identical home-screen events from the portal (via screen) and from the member app (via app).
create or replace function pg_temp.screens(n integer) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('key', 'screen:/', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen')) from generate_series(1, n)
$$;
create or replace function pg_temp.app_screens(n integer) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('key', 'screen:/', 'kind', 'screen', 'outcome', 'ok', 'via', 'app')) from generate_series(1, n)
$$;
-- One portal action event.
create or replace function pg_temp.act1(p_key text, p_extra jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('key', p_key, 'kind', 'action', 'outcome', 'ok', 'via', 'screen') || p_extra)
$$;

\set a99 '''99000000-0000-4000-8000-0000000000a1'''
\set b99 '''99000000-0000-4000-8000-0000000000b1'''
\set c99 '''99000000-0000-4000-8000-0000000000c1'''
\set staff99 '''99000000-0000-4000-8000-000000000001'''
\set member99 '''99000000-0000-4000-8000-000000000002'''
\set kid99 '''99000000-0000-4000-8000-000000000003'''
\set nodob99 '''99000000-0000-4000-8000-000000000004'''
\set prim99 '''99000000-0000-4000-8000-000000000005'''
\set out99 '''99000000-0000-4000-8000-000000000006'''
\set adm99 '''99000000-0000-4000-8000-000000000007'''
\set plat99 '''99000000-0000-4000-8000-000000000008'''
\set ub99 '''99000000-0000-4000-8000-000000000009'''
\set stranger99 '''99000000-0000-4000-8000-00000000000a'''
\set cadm99 '''99000000-0000-4000-8000-00000000000b'''
\set teen99 '''99000000-0000-4000-8000-00000000000c'''
\set eighteen99 '''99000000-0000-4000-8000-00000000000d'''
\set both99 '''99000000-0000-4000-8000-00000000000e'''
\set nkid99 '''99000000-0000-4000-8000-00000000000f'''
\set staffnd99 '''99000000-0000-4000-8000-000000000010'''
\set staffteen99 '''99000000-0000-4000-8000-000000000011'''
\set leaver99 '''99000000-0000-4000-8000-000000000012'''
\set late99 '''99000000-0000-4000-8000-000000000013'''
\set latepa99 '''99000000-0000-4000-8000-000000000014'''
\set e1 '99000000-0000-4000-8000-0000000000e1'
\set s1 '99000000-0000-4000-8000-0000000005e1'

select pg_temp.as_none();
insert into auth.users (id, email) values
  (:staff99, 'staff99@act.test'), (:member99, 'member99@act.test'), (:kid99, 'kid99@act.test'), (:nodob99, 'nodob99@act.test'),
  (:prim99, 'prim99@act.test'), (:out99, 'out99@act.test'), (:adm99, 'adm99@act.test'), (:plat99, 'plat99@act.test'),
  (:ub99, 'ub99@act.test'), (:stranger99, 'stranger99@act.test'), (:cadm99, 'cadm99@act.test'), (:teen99, 'teen99@act.test'),
  (:eighteen99, 'eighteen99@act.test'), (:both99, 'both99@act.test'), (:nkid99, 'nkid99@act.test'),
  (:staffnd99, 'staffnd99@act.test'), (:staffteen99, 'staffteen99@act.test'), (:leaver99, 'leaver99@act.test'),
  (:late99, 'late99@act.test'), (:latepa99, 'latepa99@act.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat99, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;

-- A and B record (their switch is on); C is a community nobody has switched on.
insert into app.centers (id, slug, name, short_name, state_region, status, rules) values
  (:a99, 'act99a', 'Activity 99 A', 'A99', 'TX', 'active', '{"activity": {"enabled": true}}'::jsonb),
  (:b99, 'act99b', 'Activity 99 B', 'B99', 'CA', 'active', '{"activity": {"enabled": true}}'::jsonb),
  (:c99, 'act99c', 'Activity 99 C', 'C99', 'NY', 'active', '{}'::jsonb);

insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  ('99000000-0000-4000-8000-000000000101', :a99, 'Sam', 'Staff99', date '1975-03-01'),
  ('99000000-0000-4000-8000-000000000102', :a99, 'Mia', 'Member99', date '1980-04-02'),
  ('99000000-0000-4000-8000-000000000103', :a99, 'Kai', 'Kid99', current_date - interval '10 years'),
  ('99000000-0000-4000-8000-000000000104', :a99, 'Nora', 'Nodob99', null),
  ('99000000-0000-4000-8000-000000000105', :a99, 'Pia', 'Prim99', null),
  ('99000000-0000-4000-8000-000000000106', :a99, 'Omar', 'Out99', date '1985-05-05'),
  ('99000000-0000-4000-8000-000000000107', :a99, 'Ada', 'Admin99', date '1970-06-06'),
  ('99000000-0000-4000-8000-000000000108', :a99, 'Pat', 'Platform99', date '1979-07-07'),
  ('99000000-0000-4000-8000-00000000010c', :a99, 'Tess', 'Teen99', current_date - interval '17 years 11 months'),
  ('99000000-0000-4000-8000-00000000010d', :a99, 'Ezra', 'Eighteen99', current_date - interval '18 years'),
  ('99000000-0000-4000-8000-00000000010e', :a99, 'Bo', 'Both99', date '1982-08-08'),
  ('99000000-0000-4000-8000-00000000010f', :a99, 'Nell', 'Nkid99', null),
  ('99000000-0000-4000-8000-000000000110', :a99, 'Stan', 'Staffnd99', null),
  ('99000000-0000-4000-8000-000000000111', :a99, 'Tia', 'Staffteen99', current_date - interval '16 years'),
  ('99000000-0000-4000-8000-000000000112', :a99, 'Lee', 'Leaver99', date '1988-01-01'),
  ('99000000-0000-4000-8000-000000000113', :a99, 'Lu', 'Late99', date '1985-01-01'),
  ('99000000-0000-4000-8000-000000000114', :a99, 'Lea', 'Latepa99', date '1985-02-02'),
  ('99000000-0000-4000-8000-000000000109', :b99, 'Ulla', 'Ub99', date '1981-09-09'),
  ('99000000-0000-4000-8000-00000000011e', :b99, 'Bo', 'Both99', date '1982-08-08'),
  ('99000000-0000-4000-8000-000000000212', :b99, 'Lee', 'Leaver99', date '1988-01-01'),
  ('99000000-0000-4000-8000-00000000010b', :c99, 'Cy', 'Cadmin99', date '1972-10-10');
insert into app.households (id, center_id, display_name) values
  ('99000000-0000-4000-8000-0000000002a1', :a99, 'Household 99 one'), ('99000000-0000-4000-8000-0000000002a2', :a99, 'Household 99 two');
-- Pia (no birth date, "primary") is the girl who registered her own household through the member app.
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  ('99000000-0000-4000-8000-0000000002a1', '99000000-0000-4000-8000-000000000105', :a99, 'primary', true),
  ('99000000-0000-4000-8000-0000000002a2', '99000000-0000-4000-8000-000000000102', :a99, 'primary', true),
  ('99000000-0000-4000-8000-0000000002a2', '99000000-0000-4000-8000-00000000010f', :a99, 'child', false),
  ('99000000-0000-4000-8000-0000000002a2', '99000000-0000-4000-8000-000000000103', :a99, 'child', false);
insert into app.center_users (center_id, user_id, person_id) values
  (:a99, :staff99, '99000000-0000-4000-8000-000000000101'), (:a99, :member99, '99000000-0000-4000-8000-000000000102'),
  (:a99, :kid99, '99000000-0000-4000-8000-000000000103'), (:a99, :nodob99, '99000000-0000-4000-8000-000000000104'),
  (:a99, :prim99, '99000000-0000-4000-8000-000000000105'), (:a99, :out99, '99000000-0000-4000-8000-000000000106'),
  (:a99, :adm99, '99000000-0000-4000-8000-000000000107'), (:a99, :plat99, '99000000-0000-4000-8000-000000000108'),
  (:a99, :teen99, '99000000-0000-4000-8000-00000000010c'), (:a99, :eighteen99, '99000000-0000-4000-8000-00000000010d'),
  (:a99, :both99, '99000000-0000-4000-8000-00000000010e'), (:a99, :nkid99, '99000000-0000-4000-8000-00000000010f'),
  (:a99, :staffnd99, '99000000-0000-4000-8000-000000000110'), (:a99, :staffteen99, '99000000-0000-4000-8000-000000000111'),
  (:a99, :leaver99, '99000000-0000-4000-8000-000000000112'), (:a99, :late99, '99000000-0000-4000-8000-000000000113'),
  (:a99, :latepa99, '99000000-0000-4000-8000-000000000114'),
  (:b99, :ub99, '99000000-0000-4000-8000-000000000109'), (:b99, :both99, '99000000-0000-4000-8000-00000000011e'),
  (:b99, :leaver99, '99000000-0000-4000-8000-000000000212'),
  (:c99, :cadm99, '99000000-0000-4000-8000-00000000010b');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:a99, :staff99, 'treasurer', 'center', 'test 99'), (:a99, :adm99, 'center_admin', 'center', 'test 99'),
  (:a99, :staffnd99, 'treasurer', 'center', 'test 99'), (:a99, :staffteen99, 'event_lead', 'center', 'test 99'),
  (:c99, :cadm99, 'center_admin', 'center', 'test 99');
-- Ada is the owner of A (the first administrator becomes it anyway; stated here so the test does not depend on that).
insert into app.center_owners (center_id, user_id) values (:a99, :adm99)
  on conflict (center_id) do update set user_id = excluded.user_id;
grant connect_worker to postgres;   -- the tests switch to connect_worker; a hosted postgres holds ADMIN on it but not SET

-- ══ A. The tables, grants, indexes and functions ═════════════════════════════
select pg_temp.assert((select bool_and(relrowsecurity) and count(*) = 4 from pg_class
                        where relnamespace = 'app'::regnamespace
                          and relname in ('activity_catalog', 'activity_events', 'activity_optouts', 'activity_salts')),
  'A · all four stream tables have row level security on');
select pg_temp.assert(has_table_privilege('authenticated', 'app.activity_events', 'select')
                      and not has_table_privilege('authenticated', 'app.activity_events', 'insert')
                      and not has_table_privilege('authenticated', 'app.activity_events', 'update')
                      and not has_table_privilege('authenticated', 'app.activity_events', 'delete')
                      and not has_table_privilege('service_role', 'app.activity_events', 'insert')
                      and not has_table_privilege('service_role', 'app.activity_events', 'update')
                      and not has_table_privilege('service_role', 'app.activity_events', 'delete')
                      and not has_table_privilege('anon', 'app.activity_events', 'select')
                      and not has_table_privilege('connect_worker', 'app.activity_events', 'select'),
  'A · nobody can insert, update or delete events through the API (service key included); only signed-in people can select, through the platform-admin policy');
select pg_temp.assert(not has_table_privilege('authenticated', 'app.activity_salts', 'select')
                      and not has_table_privilege('service_role', 'app.activity_salts', 'select')
                      and not has_table_privilege('authenticated', 'app.activity_salts', 'insert')
                      and has_table_privilege('authenticated', 'app.activity_optouts', 'select')
                      and not has_table_privilege('authenticated', 'app.activity_optouts', 'insert')
                      and not has_table_privilege('authenticated', 'app.activity_optouts', 'delete')
                      and has_table_privilege('authenticated', 'app.activity_catalog', 'select')
                      and not has_table_privilege('authenticated', 'app.activity_catalog', 'insert')
                      and not has_table_privilege('anon', 'app.activity_catalog', 'select'),
  'A · the salts are not readable by any API role; opt-outs and the allowlist are read only');
select pg_temp.assert(has_function_privilege('authenticated', 'app.record_activity(uuid, jsonb)', 'execute')
                      and has_function_privilege('authenticated', 'app.set_activity_opt_out(boolean)', 'execute')
                      and has_function_privilege('authenticated', 'app.activity_status(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.set_activity_recording(uuid, boolean)', 'execute')
                      and not has_function_privilege('anon', 'app.record_activity(uuid, jsonb)', 'execute')
                      and not has_function_privilege('anon', 'app.set_activity_opt_out(boolean)', 'execute')
                      and not has_function_privilege('anon', 'app.activity_status(uuid)', 'execute')
                      and not has_function_privilege('service_role', 'app.record_activity(uuid, jsonb)', 'execute'),
  'A · signed-in people call the four public functions; guests and the service key do not');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.activity_actor_hash(uuid, uuid, boolean)', 'execute')
                      and not has_function_privilege('authenticated', 'app.activity_hash(uuid, bytea)', 'execute')
                      and not has_function_privilege('authenticated', 'app.activity_member_ok(uuid, uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.activity_portal_ok(uuid, uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.activity_enabled(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.activity_entity_id_ok(text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.activity_register(text, text, text, text, text, text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.activity_screen_key_norm(text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.centers_activity_guard()', 'execute')
                      and has_function_privilege('authenticated', 'app.activity_min_actors()', 'execute'),
  'A · the helpers (pseudonym, who may be recorded, switch, register, key check) are not callable from outside; the group-size constant is, because a row level policy reads it as the signed-in person');
select pg_temp.assert((select count(*) = 9 and bool_and(p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=app, public, extensions%')
                         from pg_proc p where p.pronamespace = 'app'::regnamespace
                          and p.proname in ('record_activity', 'set_activity_opt_out', 'activity_status', 'set_activity_recording',
                                            'activity_enabled', 'activity_member_ok', 'activity_portal_ok', 'activity_actor_hash',
                                            'centers_activity_guard')),
  'A · the nine security definer functions pin the search path to app, public, extensions');
select pg_temp.assert((select count(*) = 1 from pg_indexes where schemaname = 'app' and tablename = 'activity_events'
                          and indexdef like '%(center_id, occurred_at)%')
                      and (select count(*) = 1 from pg_indexes where schemaname = 'app' and tablename = 'activity_events'
                              and indexdef like '%(center_id, actor_hash, received_at)%')
                      and (select count(*) = 0 from pg_indexes where schemaname = 'app' and tablename = 'activity_events'
                              and indexdef like '%session_id%'),
  'A · the indexes: (center_id, occurred_at) for the miner and the totals, (center_id, actor_hash, received_at) for the rate limit and the deletes by person; none on the session, nothing reads by it');
select pg_temp.assert(not exists (select 1 from pg_trigger where tgrelid in ('app.activity_events'::regclass, 'app.activity_optouts'::regclass,
                                                                              'app.activity_salts'::regclass) and not tgisinternal)
                      and exists (select 1 from pg_trigger where tgrelid = 'app.activity_catalog'::regclass and tgname = 'audit_activity_catalog'
                                    and tgfoid = 'app.audit_row'::regproc and not tgisinternal)
                      and (select count(*) = 4 and bool_and(module_key is null) from app.module_tables
                            where table_name in ('activity_catalog', 'activity_events', 'activity_optouts', 'activity_salts')),
  'A · events, opt-outs and salts have no audit trigger; the allowlist is audited; all four are core platform tables');
select pg_temp.assert((select count(*) filter (where kind = 'action' and surface = 'portal') >= 40
                              and count(*) filter (where kind = 'action' and surface = 'member') >= 7
                              and count(*) filter (where kind = 'screen' and surface = 'portal') >= 100
                              and count(*) filter (where kind = 'screen' and surface = 'member') >= 40
                              and bool_and(kind <> 'screen' or app.activity_screen_key_norm(key) = key)
                         from app.activity_catalog),
  'A · the allowlist is seeded: 40+ portal actions, the 7 member funnel steps, the portal and member screens; every screen key is a valid route pattern');
select pg_temp.assert((select count(*) = 14 from app.activity_catalog
                        where key in ('giving.record_payment', 'people.update_person', 'events.save', 'events.set_status', 'comms.send',
                                      'rsvp_started', 'rsvp_completed', 'pledge_placed', 'payment_started', 'payment_completed',
                                      'payment_failed', 'account_linked', 'screen:/events/[id]')
                           or (key = 'screen:/' and surface = 'portal')),
  'A · the keys named in the brief are in the allowlist');
select pg_temp.assert((select count(*) = 2 and bool_and(kind = 'screen') from app.activity_catalog where key = 'screen:/events')
                      and (select count(*) = 2 from app.activity_catalog where key = 'screen:/')
                      and (select count(*) = 1 from app.activity_catalog where key = 'screen:/bolis' and surface = 'member')
                      and (select count(*) = 1 from app.activity_catalog where key = 'screen:/store' and surface = 'member')
                      and (select count(*) = 1 from app.activity_catalog where key = 'screen:/settings' and surface = 'member')
                      and (select count(*) = 5 from app.activity_catalog
                            where surface = 'member' and key in ('screen:/guide/[slug]', 'screen:/gyan/[goalid]', 'screen:/gyan/[goalid]/level/[levelid]',
                                                                'screen:/gyan/homework/[assignmentid]', 'screen:/labh/[dayid]')),
  'A · a screen the portal and the member app share (events, bolis, store, settings, home) is listed once for each surface; the member app''s parameter names are the app''s own, lower-cased');
-- A later migration adds a key with app.activity_register; a second call with only a command keeps the label and the entity kind.
select app.activity_register('test99.thing', 'action', 'portal', 'A test thing', 'person');
select app.activity_register('test99.thing', 'action', 'portal', 'A test thing', null, 'test99.thing');
select pg_temp.assert((select label = 'A test thing' and entity_kind = 'person' and commandable_key = 'test99.thing'
                         from app.activity_catalog where key = 'test99.thing' and surface = 'portal'),
  'A · activity_register adds a key and a later call fills in the command without losing the entity kind');
select pg_temp.assert_raises($q$select app.activity_register('Bad Key', 'action', 'portal', 'x')$q$, 'check', 'A · a malformed action key is refused by the table');
select pg_temp.assert_raises($q$select app.activity_register('screen:/events/123', 'screen', 'portal', 'x')$q$, 'check', 'A · an id-like screen key is refused by the table');
select pg_temp.assert(not app.activity_entity_id_ok('person') and not app.activity_entity_id_ok('household') and not app.activity_entity_id_ok('student')
                      and not app.activity_entity_id_ok('learner') and not app.activity_entity_id_ok('enrollment') and not app.activity_entity_id_ok('rsvp')
                      and not app.activity_entity_id_ok(null) and app.activity_entity_id_ok('event') and app.activity_entity_id_ok('payment'),
  'A · an id is never kept for a person, household, student, learner, enrollment or RSVP; it is for events, payments and the like');
select pg_temp.assert(app.activity_min_actors() = 3, 'A · a group below 3 people is hidden: the one place the number lives');

-- ══ B. Screen keys ═══════════════════════════════════════════════════════════
select pg_temp.assert(app.activity_screen_key_norm('screen:/') = 'screen:/'
                      and app.activity_screen_key_norm('screen:/events/[id]') = 'screen:/events/[id]'
                      and app.activity_screen_key_norm('screen:/gyan/[goalId]/level/[levelId]') = 'screen:/gyan/[goalid]/level/[levelid]'
                      and app.activity_screen_key_norm('screen:/pathshala/classes/[id]/attendance') = 'screen:/pathshala/classes/[id]/attendance'
                      and app.activity_screen_key_norm('screen:/settings/2fa') = 'screen:/settings/2fa'
                      and app.activity_screen_key_norm('screen:/' || repeat('abcdefghij/', 7) || 'abc') is not null
                      and app.activity_screen_key_norm('screen:/media/[kind]/[id]') = 'screen:/media/[kind]/[id]',
  'B · route patterns pass; [Name] placeholders are lower-cased; a short segment with a digit is not an id');
select pg_temp.assert(app.activity_screen_key_norm('screen:/events/123') is null
                      and app.activity_screen_key_norm('screen:/events/2026-10-10') is null
                      and app.activity_screen_key_norm('screen:/events/99000000-0000-4000-8000-0000000000e1') is null
                      and app.activity_screen_key_norm('screen:/events/990000000000400080000000000000e1') is null
                      and app.activity_screen_key_norm('screen:/orders/a1b2c3d4e5') is null
                      and app.activity_screen_key_norm('screen:/people/ab12cd') is null
                      and app.activity_screen_key_norm('screen:/events/1234') is null,
  'B · numbers, dates, uuids, hex ids and letter-digit mixes of 6 or more are not route patterns');
select pg_temp.assert(app.activity_screen_key_norm('screen:/Events/list') is null
                      and app.activity_screen_key_norm('screen:/events/') is null
                      and app.activity_screen_key_norm('screen:/a//b') is null
                      and app.activity_screen_key_norm('screen:/households?x=1') is null
                      and app.activity_screen_key_norm('screen:/people/john smith') is null
                      and app.activity_screen_key_norm('screen:/people/john.smith') is null
                      and app.activity_screen_key_norm('events/[id]') is null
                      and app.activity_screen_key_norm('screen:') is null
                      and app.activity_screen_key_norm('screen:/[id') is null
                      and app.activity_screen_key_norm('screen:/[Id]x') is null
                      and app.activity_screen_key_norm('screen:/' || repeat('abcdefghij/', 7) || 'abcd') is null
                      and app.activity_screen_key_norm('screen:/' || repeat('a', 41)) is null
                      and app.activity_screen_key_norm(null) is null,
  'B · capitals outside [placeholders], empty segments, query strings, spaces, dots, a missing prefix, a bad placeholder, more than 80 characters or a 41-character segment are refused');

-- ══ C. Who is recorded, by surface ═══════════════════════════════════════════
-- Staff (a treasurer) in the portal: recorded, as a pseudonym, with the role they hold, even when the payload claims otherwise.
select pg_temp.act(:staff99, :a99,
  jsonb_build_array(jsonb_build_object('key', 'giving.record_payment', 'kind', 'action', 'outcome', 'ok', 'via', 'screen',
    'entity_kind', 'person', 'entity_id', :'e1', 'duration_ms', 1200, 'session_id', :'s1', 'seq', 1,
    'app_version', '1.2.3', 'platform', 'web',
    'user_id', '99000000-0000-4000-8000-000000000002', 'center_id', '99000000-0000-4000-8000-0000000000b1',
    'actor_hash', 'deadbeef', 'role_keys', jsonb_build_array('center_admin'), 'surface', 'member'))) as n_staff \gset
select pg_temp.assert(:n_staff = 1, 'C · a staff member''s portal event is stored (record_activity returns 1)');
select encode(extensions.hmac(convert_to(:staff99::text, 'UTF8'), s.salt, 'sha256'), 'hex') as h_staff
  from app.activity_salts s where s.center_id = :a99 \gset
select pg_temp.assert((select e.center_id = :a99 and e.actor_hash = :'h_staff' and e.role_keys = array['treasurer']
                              and e.surface = 'portal' and e.key = 'giving.record_payment' and e.kind = 'action'
                              and e.entity_kind = 'payment' and e.entity_id = :'e1'::uuid and e.outcome = 'ok' and e.error_code is null
                              and e.duration_ms = 1200 and e.via = 'screen' and e.seq = 1 and e.session_id = :'s1'::uuid
                              and e.app_version = '1.2.3' and e.platform = 'web'
                         from app.activity_events e where e.center_id = :a99 order by e.id desc limit 1),
  'C · the row has the community and the role from the sign-in, the pseudonym (hmac of the user id with the community''s salt), the catalog''s entity kind (not the payload''s) and the allowed fields');
select pg_temp.assert((select count(*) = 1 from app.activity_events)
                      and (select position(:staff99::text in to_jsonb(e)::text) = 0 from app.activity_events e limit 1)
                      and (select length(salt) = 32 from app.activity_salts where center_id = :a99),
  'C · nothing named another person, another community or a hash: one row, the raw user id appears nowhere in it, the salt is 32 random bytes');
select pg_temp.assert((select count(*) = 0 from app.activity_events where center_id = :b99), 'C · and nothing was written into community B, whatever the payload''s center_id said');

-- The community's owner (here the first center admin) also carries the "owner" role key.
select pg_temp.act(:adm99, :a99, pg_temp.act1('events.save', '{"via": "palette"}')) as n_adm \gset
select pg_temp.assert(:n_adm = 1 and (select 'center_admin' = any (role_keys) and 'owner' = any (role_keys) and via = 'palette'
                                         from app.activity_events where center_id = :a99 order by id desc limit 1),
  'C · a center admin is recorded with the role center_admin (and owner, as the first administrator), started from the palette');

-- A plain adult member in the member app: recorded, with no roles; a funnel step is a member-surface event.
select pg_temp.act(:member99, :a99, jsonb_build_array(jsonb_build_object('key', 'rsvp_started', 'kind', 'action', 'outcome', 'ok', 'via', 'app',
                                                                        'entity_id', :'e1'))) as n_mem \gset
select pg_temp.assert(:n_mem = 1 and (select role_keys = '{}' and surface = 'member' and via = 'app' and entity_kind = 'event' and entity_id = :'e1'::uuid
                                         from app.activity_events where center_id = :a99 order by id desc limit 1),
  'C · a member is recorded in the app with no roles; a funnel step is a member-surface event whose entity kind is the allowlist''s');
-- ... and the same adult, not staff, is not recorded in the portal; a staff member in the app carries no roles either.
select pg_temp.act(:member99, :a99, pg_temp.screens(2)) as n_mem_portal, pg_temp.act(:staff99, :a99, pg_temp.app_screens(2)) as n_staff_app \gset
select pg_temp.assert(:n_mem_portal = 0 and :n_staff_app = 2 and (select role_keys = '{}' and surface = 'member' from pg_temp.newest(:a99)),
  'C · a member who holds no staff role is not recorded in the portal; a staff member using the member app is a member there, with no roles');

-- Not recorded, member app: a child, a teenager (17 years 11 months), a person with no birth date (whatever else the records
-- say: Pia has the role primary), a child with no birth date, a staff member with no birth date, a staff member under 18.
select pg_temp.act(:kid99, :a99, pg_temp.app_screens(3)) as m_kid, pg_temp.act(:teen99, :a99, pg_temp.app_screens(3)) as m_teen,
       pg_temp.act(:nodob99, :a99, pg_temp.app_screens(3)) as m_nodob, pg_temp.act(:nkid99, :a99, pg_temp.app_screens(3)) as m_nkid,
       pg_temp.act(:prim99, :a99, pg_temp.app_screens(3)) as m_prim, pg_temp.act(:staffnd99, :a99, pg_temp.app_screens(3)) as m_staffnd,
       pg_temp.act(:staffteen99, :a99, pg_temp.app_screens(3)) as m_staffteen \gset
select pg_temp.assert(:m_kid = 0 and :m_teen = 0 and :m_nodob = 0 and :m_nkid = 0,
  'C · member app: nothing for a child, for someone aged 17 years 11 months, for a person with no birth date or for a child with none');
select pg_temp.assert(:m_prim = 0,
  'C · member app: nothing for a self-registered teenager who has no birth date and the household role "primary"');
select pg_temp.assert(:m_staffnd = 0 and :m_staffteen = 0,
  'C · member app: and none for a staff member with no birth date or one under 18: the member app needs a recorded birth date of 18 or more');
-- Not recorded, portal.
select pg_temp.act(:kid99, :a99, pg_temp.screens(3)) as p_kid, pg_temp.act(:prim99, :a99, pg_temp.screens(3)) as p_prim,
       pg_temp.act(:nodob99, :a99, pg_temp.screens(3)) as p_nodob, pg_temp.act(:teen99, :a99, pg_temp.screens(3)) as p_teen,
       pg_temp.act(:staffteen99, :a99, pg_temp.screens(3)) as p_staffteen, pg_temp.act(:eighteen99, :a99, pg_temp.screens(3)) as p_18,
       pg_temp.act(:stranger99, :a99, pg_temp.screens(3)) as p_stranger, pg_temp.act(:plat99, :a99, pg_temp.screens(3)) as p_plat,
       pg_temp.act(:plat99, :a99, pg_temp.app_screens(3)) as m_plat, pg_temp.act(:stranger99, :a99, pg_temp.app_screens(3)) as m_stranger,
       pg_temp.act(null, :a99, pg_temp.screens(3)) as p_guest \gset
select pg_temp.assert(:p_kid = 0 and :p_prim = 0 and :p_nodob = 0 and :p_teen = 0 and :p_18 = 0,
  'C · portal: nothing for anyone who holds no staff role, whatever their age');
select pg_temp.assert(:p_staffteen = 0, 'C · portal: nothing for a staff member whose birth date shows under 18');
select pg_temp.assert(:p_stranger = 0 and :m_stranger = 0 and :p_plat = 0 and :m_plat = 0 and :p_guest = 0,
  'C · nothing for someone who is not in the community, for a platform admin (even one with a person record there, on either surface), or for a guest');
-- Recorded: exactly 18 today in the app; a staff member with no birth date in the portal.
select pg_temp.act(:eighteen99, :a99, pg_temp.app_screens(3)) as m_18, pg_temp.act(:staffnd99, :a99, pg_temp.screens(3)) as p_staffnd \gset
select pg_temp.assert(:m_18 = 3, 'C · member app: a person who is exactly 18 today is recorded');
select pg_temp.assert(:p_staffnd = 3, 'C · portal: a staff member with no birth date on file is recorded (an administrator granted the role)');
select pg_temp.assert((select count(*) = 0 from app.activity_events e
                        where e.actor_hash in (select app.activity_actor_hash(:a99, u, false)
                                                 from (values (:kid99::uuid), (:teen99::uuid), (:nodob99::uuid), (:nkid99::uuid), (:prim99::uuid),
                                                              (:staffteen99::uuid), (:stranger99::uuid), (:plat99::uuid)) t(u)
                                                where app.activity_actor_hash(:a99, u, false) is not null)),
  'C · and no row exists under the pseudonym of anyone who was not to be recorded');

-- ══ D. What is stored: every value is held to its shape ═════════════════════
select pg_temp.act(:staff99, :a99, jsonb_build_array(jsonb_build_object('key', 'screen:/events/[id]', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen',
         'entity_kind', 'hello world free text', 'entity_id', :'e1'))) as n1 \gset
select pg_temp.assert(:n1 = 1 and (select entity_kind = 'event' and entity_id = :'e1'::uuid and surface = 'portal' from pg_temp.newest(:a99)),
  'D · the entity kind is the allowlist''s (a free-text one in the payload is ignored); an event''s id is kept');
select pg_temp.act(:staff99, :a99, jsonb_build_array(jsonb_build_object('key', 'people.update_person', 'kind', 'action', 'outcome', 'ok', 'via', 'screen',
         'entity_id', :'e1'))) as n2 \gset
select pg_temp.assert(:n2 = 1 and (select entity_kind = 'person' and entity_id is null from pg_temp.newest(:a99)),
  'D · for a person (or household, student, enrollment ...) the kind is kept and the id is not');
select pg_temp.act(:staff99, :a99, jsonb_build_array(jsonb_build_object('key', 'giving.record_payment', 'kind', 'action', 'outcome', 'ok', 'via', 'screen',
         'entity_id', 'not-a-uuid'))) as n2b \gset
select pg_temp.assert((select entity_kind = 'payment' and entity_id is null from pg_temp.newest(:a99)), 'D · an entity id that is not a uuid is stored as empty');
select pg_temp.act(:staff99, :a99, jsonb_build_array(jsonb_build_object('key', 'people.update_person', 'kind', 'action', 'outcome', 'error', 'via', 'screen',
         'error_code', 'Customer Jane Doe was not found'))) as n3 \gset
select pg_temp.assert((select error_code is null and outcome = 'error' from pg_temp.newest(:a99)),
  'D · an error "code" that is a sentence is not stored; the outcome still is');
select pg_temp.act(:staff99, :a99, jsonb_build_array(jsonb_build_object('key', 'people.update_person', 'kind', 'action', 'outcome', 'error', 'via', 'screen',
         'error_code', 'Validation_Failed'))) as n4 \gset
select pg_temp.assert((select error_code = 'validation_failed' from pg_temp.newest(:a99)), 'D · a short error code of letters and underscores is kept, in lower case');
select pg_temp.act(:staff99, :a99, jsonb_build_array(jsonb_build_object('key', 'people.update_person', 'kind', 'action', 'outcome', 'error', 'via', 'screen',
         'error_code', 'P0001'))) as n4b \gset
select pg_temp.assert((select error_code is null from pg_temp.newest(:a99)), 'D · a code with digits (a database error number) is not an allowed shape');
select pg_temp.act(:staff99, :a99, jsonb_build_array(jsonb_build_object('key', 'people.update_person', 'kind', 'action', 'outcome', 'ok', 'via', 'screen',
         'error_code', 'forbidden'))) as n5 \gset
select pg_temp.assert((select error_code is null from pg_temp.newest(:a99)), 'D · an error code on an event that did not fail is dropped');
select pg_temp.act(:staff99, :a99, jsonb_build_array(jsonb_build_object('key', 'events.save', 'kind', 'action', 'outcome', 'ok', 'via', 'screen',
         'duration_ms', 12.6, 'platform', 'Web', 'app_version', '1.2', 'session_id', :'s1', 'seq', 7))) as n6 \gset
select pg_temp.assert((select duration_ms = 13 and platform = 'web' and app_version = '1.2' and session_id = :'s1'::uuid and seq = 7 from pg_temp.newest(:a99)),
  'D · a fractional duration is rounded; the platform is lower-cased; a version of two numbers, a session uuid and a seq are kept');
select pg_temp.act(:staff99, :a99, jsonb_build_array(jsonb_build_object('key', 'events.save', 'kind', 'action', 'outcome', 'ok', 'via', 'screen',
         'platform', 'windows', 'app_version', '1.2.3.4', 'session_id', 'bad id', 'seq', 'abc'))) as n6b \gset
select pg_temp.assert((select platform is null and app_version is null and session_id is null and seq is null from pg_temp.newest(:a99)),
  'D · a platform that is not ios, android or web, a version with four numbers, a session that is not a uuid and a seq that is not a number are stored as empty');
select pg_temp.act(:staff99, :a99, jsonb_build_array(jsonb_build_object('key', 'events.save', 'kind', 'action', 'outcome', 'ok', 'via', 'screen',
         'app_version', 'v1.2', 'platform', 'iOS'))) as n6c \gset
select pg_temp.assert((select app_version is null and platform = 'ios' from pg_temp.newest(:a99)), 'D · a version with a letter is stored as empty; iOS is ios');
select pg_temp.act(:staff99, :a99, jsonb_build_array(jsonb_build_object('key', 'events.save', 'kind', 'action', 'outcome', 'ok', 'via', 'screen', 'duration_ms', -5))) as n7 \gset
select pg_temp.assert((select duration_ms is null from pg_temp.newest(:a99)), 'D · a negative duration is stored as empty');
select pg_temp.act(:staff99, :a99, jsonb_build_array(jsonb_build_object('key', 'events.save', 'kind', 'action', 'outcome', 'ok', 'via', 'screen', 'duration_ms', 7200000))) as n8 \gset
select pg_temp.assert((select duration_ms is null from pg_temp.newest(:a99)), 'D · a duration over an hour is stored as empty');
select pg_temp.act(:staff99, :a99, jsonb_build_array(jsonb_build_object('key', 'events.save', 'kind', 'action', 'via', 'screen'))) as n9 \gset
select pg_temp.assert(:n9 = 1 and (select outcome = 'ok' from pg_temp.newest(:a99)), 'D · a missing outcome is ok');
select pg_temp.act(:staff99, :a99, jsonb_build_array(jsonb_build_object('key', 'events.save', 'kind', 'action', 'outcome', 'cancelled', 'via', 'assistant'))) as n10 \gset
select pg_temp.assert(:n10 = 1 and (select outcome = 'cancelled' and via = 'assistant' and surface = 'portal' from pg_temp.newest(:a99)), 'D · cancelled and assistant are stored (assistant is a portal way of starting)');
-- The device's clock is held within 7 days before and 5 minutes after now.
select pg_temp.act(:staff99, :a99, jsonb_build_array(jsonb_build_object('key', 'events.save', 'kind', 'action', 'outcome', 'ok', 'via', 'screen',
         'at', to_char((now() at time zone 'UTC') - interval '2 hours', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))) as n11 \gset
select pg_temp.assert((select abs(extract(epoch from (occurred_at - (now() - interval '2 hours')))) < 60 from pg_temp.newest(:a99)), 'D · a valid time is kept');
select pg_temp.act(:staff99, :a99, jsonb_build_array(jsonb_build_object('key', 'events.save', 'kind', 'action', 'outcome', 'ok', 'via', 'screen', 'at', '2020-01-01T00:00:00Z'))) as n12 \gset
select pg_temp.assert((select abs(extract(epoch from (occurred_at - (now() - interval '7 days')))) < 60 from pg_temp.newest(:a99)), 'D · a time long ago is held at 7 days before now');
select pg_temp.act(:staff99, :a99, jsonb_build_array(jsonb_build_object('key', 'events.save', 'kind', 'action', 'outcome', 'ok', 'via', 'screen', 'at', '2099-01-01T00:00:00Z'))) as n13 \gset
select pg_temp.assert((select occurred_at <= now() + interval '5 minutes 5 seconds' and occurred_at >= now() + interval '4 minutes' from pg_temp.newest(:a99)), 'D · a time in the future is held at 5 minutes after now');
select pg_temp.act(:staff99, :a99, jsonb_build_array(jsonb_build_object('key', 'events.save', 'kind', 'action', 'outcome', 'ok', 'via', 'screen', 'at', '2026-13-45T99:00:00Z'))) as n14 \gset
select pg_temp.assert(:n14 = 1 and (select abs(extract(epoch from (occurred_at - now()))) < 60 from pg_temp.newest(:a99)), 'D · a time that is not a time is replaced by now, and does not raise');

-- ══ E. Dropped events ═══════════════════════════════════════════════════════
select count(*) as before_e from app.activity_events where center_id = :a99 \gset
select pg_temp.act(:staff99, :a99, jsonb_build_array(
  jsonb_build_object('key', 'giving.refund_everything', 'kind', 'action', 'outcome', 'ok', 'via', 'screen'),   -- not in the allowlist
  jsonb_build_object('key', 'screen:/events/[id]', 'kind', 'action', 'outcome', 'ok', 'via', 'screen'),        -- a screen key sent as an action
  jsonb_build_object('key', 'giving.record_payment', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen'),      -- an action key sent as a screen
  jsonb_build_object('key', 'rsvp_started', 'kind', 'action', 'outcome', 'ok', 'via', 'screen'),               -- a member-app key from the portal
  jsonb_build_object('key', 'events.save', 'kind', 'action', 'outcome', 'ok', 'via', 'app'),                   -- a portal key from the member app
  jsonb_build_object('key', 'events.save', 'kind', 'action', 'outcome', 'ok'),                                 -- no via
  jsonb_build_object('key', 'events.save', 'kind', 'thing', 'outcome', 'ok', 'via', 'screen'),
  jsonb_build_object('key', 'events.save', 'kind', 'action', 'outcome', 'maybe', 'via', 'screen'),
  jsonb_build_object('key', 'events.save', 'kind', 'action', 'outcome', 'ok', 'via', 'carrier-pigeon'),
  jsonb_build_object('key', 42, 'kind', 'action', 'outcome', 'ok', 'via', 'screen'),
  jsonb_build_object('kind', 'action', 'outcome', 'ok', 'via', 'screen'),
  to_jsonb(123), to_jsonb('events.save'::text), 'null'::jsonb, '[]'::jsonb)) as n_bad \gset
select pg_temp.assert(:n_bad = 0 and (select count(*) from app.activity_events where center_id = :a99) = :before_e,
  'E · keys that are not in the allowlist, one for the other surface, a missing via, a bad kind, outcome or via, a key that is not text, a missing key and elements that are not events: nothing stored, nothing raised');
select pg_temp.act(:staff99, :a99, jsonb_build_array(
  jsonb_build_object('key', 'screen:/events/[id]', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen'),                    -- 1  portal row: stored
  jsonb_build_object('key', 'screen:/events/123', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen'),
  jsonb_build_object('key', 'screen:/events/99000000-0000-4000-8000-0000000000e1', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen'),
  jsonb_build_object('key', 'screen:/Events/list', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen'),
  jsonb_build_object('key', 'screen:/gyan/[goalId]', 'kind', 'screen', 'outcome', 'ok', 'via', 'app'),                     -- 5  member row, lower-cased: stored
  jsonb_build_object('key', 'screen:/', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen'),                                -- 6  stored
  jsonb_build_object('key', 'screen:/events/', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen'),
  jsonb_build_object('key', 'screen:/a//b', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen'),
  jsonb_build_object('key', 'screen:/households?search=jane', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen'),
  jsonb_build_object('key', 'events/[id]', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen'),
  jsonb_build_object('key', 'screen:/unknown/page', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen'),                   -- a route pattern, but not in the allowlist
  jsonb_build_object('key', 'screen:/give', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen'),                           -- a member screen from the portal
  jsonb_build_object('key', 'screen:/give', 'kind', 'screen', 'outcome', 'ok', 'via', 'app'),                              -- 13 stored
  jsonb_build_object('key', 'screen:/giving/pledges', 'kind', 'screen', 'outcome', 'ok', 'via', 'app'),                   -- a portal screen from the app
  jsonb_build_object('key', 'screen:/guide/[slug]', 'kind', 'screen', 'outcome', 'ok', 'via', 'app'),                      -- 15 stored
  jsonb_build_object('key', 'screen:/labh/[dayId]', 'kind', 'screen', 'outcome', 'ok', 'via', 'app'),                      -- 16 stored
  jsonb_build_object('key', 'screen:/events', 'kind', 'screen', 'outcome', 'ok', 'via', 'app'))) as n_screens \gset        -- 17 stored (a shared screen, its member row)
select pg_temp.assert(:n_screens = 7, 'E · of 17 screen events only the 7 that are route patterns listed for the surface they were sent from are stored');
select pg_temp.assert((select array_agg(key order by id desc) from (select id, key from app.activity_events where center_id = :a99 order by id desc limit 7) t)
                        = array['screen:/events', 'screen:/labh/[dayid]', 'screen:/guide/[slug]', 'screen:/give', 'screen:/', 'screen:/gyan/[goalid]', 'screen:/events/[id]'],
  'E · stored as: the member app''s own parameter names lower-cased, the home screen, a shared screen');
select pg_temp.assert((select array_agg(surface order by id desc) from (select id, surface from app.activity_events where center_id = :a99 order by id desc limit 7) t)
                        = array['member', 'member', 'member', 'member', 'portal', 'member', 'portal'],
  'E · a screen sent from the app is a member-surface event; any other is a portal one');
select pg_temp.assert(pg_temp.act(:staff99, :a99, '{}'::jsonb) = 0 and pg_temp.act(:staff99, :a99, '"events.save"'::jsonb) = 0
                      and pg_temp.act(:staff99, :a99, '[]'::jsonb) = 0 and pg_temp.act(:staff99, :a99, null) = 0
                      and pg_temp.act(:staff99, null, pg_temp.screens(1)) = 0,
  'E · a payload that is not an array, an empty array, null, or no community: 0, nothing raised');

-- ══ F. The switch, and who may flip it ═══════════════════════════════════════
select pg_temp.assert(pg_temp.act(:cadm99, :c99, pg_temp.screens(2)) = 0
                      and pg_temp.act(:staff99, :c99, pg_temp.screens(2)) = 0
                      and (select count(*) = 0 from app.activity_events where center_id = :c99),
  'F · a community nobody has switched on records nothing (the default): not for its own administrator, not for anyone else');
select pg_temp.as_user(:staff99);
select pg_temp.assert_raises($q$select app.set_activity_recording('99000000-0000-4000-8000-0000000000c1', true)$q$, 'only the weaver team',
  'F · a staff member cannot call the platform switch');
select pg_temp.as_user(:cadm99);
select pg_temp.assert_raises($q$select app.set_activity_recording('99000000-0000-4000-8000-0000000000c1', true)$q$, 'only the weaver team',
  'F · neither can the community''s own administrator');
select pg_temp.assert_raises($q$update app.centers set rules = jsonb_set(rules, '{activity}', '{"enabled": true}') where id = '99000000-0000-4000-8000-0000000000c1'$q$,
  'weaver switches activity recording on', 'F · and a direct update that switches it on is refused');
select pg_temp.assert_raises($q$update app.centers set rules = rules || '{"activity": {"enabled": "true"}}' where id = '99000000-0000-4000-8000-0000000000c1'$q$,
  'weaver switches activity recording on', 'F · also when written as the text "true"');
update app.centers set rules = rules || '{"home": {"layout": "grid"}}' where id = :c99;
select pg_temp.as_none();
select pg_temp.assert((select rules -> 'home' ->> 'layout' = 'grid' and not (rules ? 'activity') from app.centers where id = :c99),
  'F · the administrator can still change the community''s other rules (the guard looks at the activity key only)');
select pg_temp.as_user(:plat99);
select app.set_activity_recording(:c99, true);
select pg_temp.as_none();
select pg_temp.assert((select app.activity_enabled(:c99)) and (select rules #>> '{activity,enabled}' = 'true' and rules -> 'home' ->> 'layout' = 'grid' from app.centers where id = :c99),
  'F · a platform admin switches the community on (its other rules stay)');
select pg_temp.assert(pg_temp.act(:cadm99, :c99, pg_temp.screens(2)) = 2, 'F · and then it records');
select pg_temp.as_user(:cadm99);
update app.centers set rules = jsonb_set(rules, '{activity,enabled}', 'false') where id = :c99;
select pg_temp.as_none();
select pg_temp.assert(not app.activity_enabled(:c99) and pg_temp.act(:cadm99, :c99, pg_temp.screens(2)) = 0,
  'F · the community''s own administrator can switch it back off');
select pg_temp.as_user(:plat99);
select pg_temp.assert_raises($q$select app.set_activity_recording('99000000-0000-4000-8000-0000000000ff', true)$q$, 'not found', 'F · switching on a community that does not exist says so');
select pg_temp.as_none();
-- rules.activity.enabled has to be the true value: text "yes", number 1 and missing are all off.
update app.centers set rules = '{"activity": {"enabled": "yes"}}'::jsonb where id = :c99;
select pg_temp.assert(not app.activity_enabled(:c99), 'F · only true switches it on ("yes" does not)');

-- ══ G. Opt-out ══════════════════════════════════════════════════════════════
select pg_temp.act(:out99, :a99, pg_temp.app_screens(4)) as n_out1 \gset
select app.activity_actor_hash(:a99, :out99, false) as h_out \gset
select pg_temp.assert(:n_out1 = 4 and (select count(*) = 4 from app.activity_events where actor_hash = :'h_out'), 'G · before opting out the person is recorded');
select pg_temp.as_user(:out99);
select app.set_activity_opt_out(true);
select (app.activity_status(:a99)) ->> 'opted_out' as st_out, (app.activity_status(:a99)) ->> 'eligible' as st_elig, (app.activity_status(:a99)) ->> 'enabled' as st_en \gset
select count(*) as own_optouts from app.activity_optouts \gset
select pg_temp.as_none();
select pg_temp.assert((select count(*) = 0 from app.activity_events where actor_hash = :'h_out')
                      and exists (select 1 from app.activity_optouts where user_id = :out99),
  'G · opting out records the choice and deletes what was already stored about the person');
select pg_temp.assert(:'st_out' = 'true' and :'st_elig' = 'true' and :'st_en' = 'true' and :own_optouts = 1,
  'G · activity_status says enabled, opted out, eligible; the person reads their own opt-out row');
select pg_temp.assert(pg_temp.act(:out99, :a99, pg_temp.app_screens(4)) = 0 and (select count(*) = 0 from app.activity_events where actor_hash = :'h_out'),
  'G · and nothing is recorded for them afterwards');
select pg_temp.as_user(:staff99);
select count(*) as others_optouts from app.activity_optouts \gset
select pg_temp.as_none();
select pg_temp.assert(:others_optouts = 0, 'G · another person sees no opt-out rows (not even the one that exists)');
select pg_temp.as_user(:out99);
select app.set_activity_opt_out(false);
select pg_temp.as_none();
select pg_temp.assert(not exists (select 1 from app.activity_optouts where user_id = :out99) and pg_temp.act(:out99, :a99, pg_temp.app_screens(2)) = 2,
  'G · opting back in starts recording again');
select pg_temp.assert_raises($q$select app.set_activity_opt_out(true)$q$, 'sign in', 'G · with no sign-in the opt-out refuses');
-- A person who has left a community: the opt-out still reaches their events there (it goes by the salts, not by who is a
-- member now).
select pg_temp.act(:leaver99, :a99, pg_temp.app_screens(3)) as n_lv_a, pg_temp.act(:leaver99, :b99, pg_temp.app_screens(2)) as n_lv_b \gset
select app.activity_actor_hash(:a99, :leaver99, false) as h_lv_a, app.activity_actor_hash(:b99, :leaver99, false) as h_lv_b \gset
delete from app.center_users where center_id = :a99 and user_id = :leaver99;
select pg_temp.assert(:n_lv_a = 3 and :n_lv_b = 2 and (select count(*) = 3 from app.activity_events where actor_hash = :'h_lv_a')
                      and (select count(*) = 2 from app.activity_events where actor_hash = :'h_lv_b'),
  'G · a person recorded in two communities, who then leaves one');
select pg_temp.as_user(:leaver99);
select app.set_activity_opt_out(true);
select pg_temp.as_none();
select pg_temp.assert((select count(*) = 0 from app.activity_events where actor_hash in (:'h_lv_a', :'h_lv_b')),
  'G · opting out deletes their events in both communities, also the one they have left');
select pg_temp.as_user(:kid99);
select (app.activity_status(:a99)) ->> 'eligible' as st_kid \gset
select pg_temp.as_none();
select pg_temp.assert(:'st_kid' = 'false', 'G · activity_status says a child is not eligible');

-- ══ H. Batch cap and rate limit ═════════════════════════════════════════════
select pg_temp.assert(pg_temp.act(:member99, :a99, pg_temp.app_screens(150)) = 100, 'H · a call of 150 events stores the first 100');
-- 2000 events per person per community per hour: the member has 101 so far (one in section C, 100 above); 1889 more make 1990.
select app.activity_actor_hash(:a99, :member99, false) as h_mem \gset
insert into app.activity_events (center_id, occurred_at, received_at, surface, actor_hash, key, kind, outcome, via)
select :a99, now() - interval '30 minutes', now() - interval '30 minutes', 'member', :'h_mem', 'screen:/', 'screen', 'ok', 'app' from generate_series(1, 1889);
select pg_temp.assert(pg_temp.act(:member99, :a99, pg_temp.app_screens(30)) = 10, 'H · with 1990 events in the last hour, a call of 30 stores the 10 that fit under 2000');
select pg_temp.assert(pg_temp.act(:member99, :a99, pg_temp.app_screens(5)) = 0, 'H · and then nothing more until the hour has passed');
update app.activity_events set received_at = now() - interval '2 hours' where actor_hash = :'h_mem';
select pg_temp.assert(pg_temp.act(:member99, :a99, pg_temp.app_screens(5)) = 5, 'H · events older than an hour no longer count against the limit');

-- ══ I. Communities are separate ═════════════════════════════════════════════
select count(*) as a_before from app.activity_events where center_id = :a99 \gset
select count(*) as b_before from app.activity_events where center_id = :b99 \gset
select pg_temp.act(:ub99, :a99, pg_temp.app_screens(3)) as n_ub_a, pg_temp.act(:staff99, :b99, pg_temp.screens(3)) as n_staff_b,
       pg_temp.act(:staff99, :b99, pg_temp.app_screens(3)) as n_staff_b2, pg_temp.act(:member99, :b99, pg_temp.app_screens(3)) as n_mem_b \gset
select pg_temp.assert(:n_ub_a = 0 and :n_staff_b = 0 and :n_staff_b2 = 0 and :n_mem_b = 0
                      and (select count(*) = :a_before from app.activity_events where center_id = :a99)
                      and (select count(*) = :b_before from app.activity_events where center_id = :b99),
  'I · a person of B cannot write into A, and staff or members of A cannot write into B, whatever p_center says');
select pg_temp.act(:ub99, :b99, pg_temp.app_screens(3)) as n_ub_b \gset
select pg_temp.assert(:n_ub_b = 3 and (select count(*) = :b_before + 3 from app.activity_events where center_id = :b99), 'I · a person of B records in B');
select pg_temp.act(:both99, :a99, pg_temp.app_screens(1)) as n_both_a, pg_temp.act(:both99, :b99, pg_temp.app_screens(1)) as n_both_b \gset
select app.activity_actor_hash(:a99, :both99, false) as h_both_a, app.activity_actor_hash(:b99, :both99, false) as h_both_b \gset
select pg_temp.assert(:n_both_a = 1 and :n_both_b = 1 and :'h_both_a' <> :'h_both_b' and :'h_both_a' ~ '^[0-9a-f]{64}$'
                      and (select count(distinct salt) = 2 from app.activity_salts where center_id in (:a99, :b99)),
  'I · a person of both communities is recorded in each under two different pseudonyms (each community has its own salt)');
select pg_temp.assert((select count(*) = 1 from app.activity_salts where center_id = :a99) and (select count(*) = 1 from app.activity_salts where center_id = :b99),
  'I · a salt is made for a community when its first event is recorded, once');

-- ══ J. Raw rows are Weaver's ════════════════════════════════════════════════
select pg_temp.as_user(:staff99);
select count(*) as seen_staff from app.activity_events \gset
select count(*) as seen_catalog from app.activity_catalog \gset
select pg_temp.assert_raises($q$select count(*) from app.activity_salts$q$, 'permission denied', 'J · the salts are unreadable');
select pg_temp.assert_raises($q$insert into app.activity_events (center_id, occurred_at, surface, actor_hash, key, kind, outcome, via) values ('99000000-0000-4000-8000-0000000000a1', now(), 'portal', repeat('a', 64), 'screen:/', 'screen', 'ok', 'screen')$q$,
  'permission denied', 'J · nobody can insert events directly');
select pg_temp.assert_raises($q$update app.activity_events set outcome = 'error'$q$, 'permission denied', 'J · nor change them');
select pg_temp.assert_raises($q$delete from app.activity_events$q$, 'permission denied', 'J · nor delete them');
select pg_temp.assert_raises($q$insert into app.activity_catalog (key, kind, surface, label) values ('mine.key', 'action', 'portal', 'x')$q$,
  'permission denied', 'J · nor add to the allowlist');
select pg_temp.as_user(:adm99);
select count(*) as seen_admin from app.activity_events \gset
select pg_temp.as_user(:plat99);
select count(*) as seen_plat from app.activity_events \gset
select pg_temp.as_none();
select pg_temp.assert(:seen_staff = 0 and :seen_admin = 0 and :seen_catalog > 100 and :seen_plat = (select count(*) from app.activity_events) and :seen_plat > 0,
  'J · staff and even the community''s owner see no raw events (an empty result, not an error); everyone reads the allowlist; a platform admin reads every event');
set role anon;
select pg_temp.assert_raises($q$select count(*) from app.activity_events$q$, 'permission denied', 'J · a guest reads nothing');
select pg_temp.assert_raises($q$select app.record_activity('99000000-0000-4000-8000-0000000000a1', '[]'::jsonb)$q$, 'permission denied', 'J · a guest cannot record');
reset role;

-- ══ K. The daily sweep deletes what is no longer allowed ═════════════════════
-- Ezra (exactly 18, recorded 3 member events) turns out to have been born 16 years ago; Stan (staff, no birth date, 3 portal
-- events) has a birth date under 18 added; Lu recorded 2 events and an opt-out raced them (the row is written directly);
-- Lea recorded 2 events and became a platform admin.
select pg_temp.act(:late99, :a99, pg_temp.app_screens(2)) as n_late, pg_temp.act(:latepa99, :a99, pg_temp.app_screens(2)) as n_latepa \gset
select app.activity_actor_hash(:a99, :eighteen99, false) as h_18, app.activity_actor_hash(:a99, :staffnd99, false) as h_snd,
       app.activity_actor_hash(:a99, :late99, false) as h_late, app.activity_actor_hash(:a99, :latepa99, false) as h_latepa,
       app.activity_actor_hash(:a99, :staff99, false) as h_s99, app.activity_actor_hash(:a99, :member99, false) as h_m99 \gset
select count(*) filter (where actor_hash = :'h_s99') as keep_staff, count(*) filter (where actor_hash = :'h_m99') as keep_member from app.activity_events \gset
select pg_temp.assert(:n_late = 2 and :n_latepa = 2 and (select count(*) = 3 from app.activity_events where actor_hash = :'h_18')
                      and (select count(*) = 3 from app.activity_events where actor_hash = :'h_snd'),
  'K · before the sweep all of them are stored');
update app.people set date_of_birth = current_date - interval '16 years' where id in ('99000000-0000-4000-8000-00000000010d', '99000000-0000-4000-8000-000000000110');
insert into app.activity_optouts (user_id) values (:late99);
insert into app.accounts (user_id, is_platform_admin) values (:latepa99, true) on conflict (user_id) do update set is_platform_admin = true;
select pg_temp.assert_raises($q$select app.activity_purge(10, true)$q$, 'background service', 'K · only the worker can run the sweep');
set local role connect_worker;
select app.activity_purge(10, false)::text as pres0 \gset
select app.activity_purge(10, true)::text as pres1 \gset
select app.activity_purge(10, true)::text as pres2 \gset
reset role;
select pg_temp.assert((:'pres0'::jsonb ->> 'swept')::integer = 0 and (select count(*) = 3 from app.activity_events where actor_hash = :'h_18'),
  'K · without the sweep nothing is deleted');
select pg_temp.assert((:'pres1'::jsonb ->> 'swept')::integer = 10 and (:'pres1'::jsonb ->> 'expired')::integer = 0
                      and (select count(*) = 0 from app.activity_events where actor_hash in (:'h_18', :'h_snd', :'h_late', :'h_latepa')),
  'K · the sweep removes the events of a person now under 18 (member surface and portal), of a platform admin and of a person who opted out: 3 + 3 + 2 + 2');
select pg_temp.assert((:'pres2'::jsonb ->> 'swept')::integer = 0
                      and (select count(*) = :keep_staff from app.activity_events where actor_hash = :'h_s99')
                      and (select count(*) = :keep_member from app.activity_events where actor_hash = :'h_m99'),
  'K · a second sweep finds nothing; staff and members who still pass keep every event');

-- ══ L. One person''s calls run one at a time ═══════════════════════════════════
-- The transaction-level advisory lock taken by record_activity (and the opt-out) is held to the end of this transaction, so
-- it is visible here for the people who recorded above.
select pg_temp.assert(exists (select 1 from pg_locks l
                               where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted and l.objsubid = 1
                                 and l.classid::bigint = ((hashtextextended('activity:' || :staff99::text, 0) >> 32) & 4294967295)
                                 and l.objid::bigint = (hashtextextended('activity:' || :staff99::text, 0) & 4294967295)),
  'L · record_activity takes a per-person advisory lock before it counts the allowance (so two calls cannot both spend it)');
select pg_temp.assert(exists (select 1 from pg_locks l
                               where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted and l.objsubid = 1
                                 and l.classid::bigint = ((hashtextextended('activity:' || :out99::text, 0) >> 32) & 4294967295)
                                 and l.objid::bigint = (hashtextextended('activity:' || :out99::text, 0) & 4294967295)),
  'L · and so does the opt-out, on the same key, so an opt-out and a call from the same person cannot cross');

-- ══ M. activity_status ═══════════════════════════════════════════════════════
select pg_temp.as_user(:staff99);
select (app.activity_status(:a99))::text as st_staff, (app.activity_status(:b99))::text as st_staff_b \gset
select pg_temp.as_user(:member99);
select (app.activity_status(:a99))::text as st_member \gset
select pg_temp.as_user(:stranger99);
select (app.activity_status(:a99))::text as st_stranger \gset
select pg_temp.as_user(:plat99);
select (app.activity_status(:a99))::text as st_plat \gset
select pg_temp.as_none();
select pg_temp.assert(:'st_staff'::jsonb = '{"enabled": true, "opted_out": false, "eligible": true, "member": true, "portal": true}'::jsonb
                      and :'st_member'::jsonb = '{"enabled": true, "opted_out": false, "eligible": true, "member": true, "portal": false}'::jsonb,
  'M · a staff member (adult) can be recorded on both surfaces, an adult member on the member app only');
select pg_temp.assert(:'st_stranger'::jsonb = '{"enabled": false, "opted_out": false, "eligible": false, "member": false, "portal": false}'::jsonb
                      and :'st_staff_b'::jsonb = '{"enabled": false, "opted_out": false, "eligible": false, "member": false, "portal": false}'::jsonb,
  'M · someone who is not a member or staff member of the community is told nothing about it: not whether it records, not that it exists');
select pg_temp.assert((:'st_plat'::jsonb ->> 'enabled')::boolean and not (:'st_plat'::jsonb ->> 'eligible')::boolean,
  'M · a platform admin sees whether a community records, and is never eligible');

-- ══ N. No audit rows ════════════════════════════════════════════════════════
select pg_temp.assert((select count(*) = 0 from app.audit_log where record_table in ('activity_events', 'activity_optouts', 'activity_salts')),
  'N · after thousands of events, opt-outs, a sweep and a direct opt-out row, the audit log holds no row for events, opt-outs or salts');
select pg_temp.assert((select count(*) = 1 from app.audit_log where record_table = 'activity_catalog' and action = 'activity_catalog.insert' and record_id = 'test99.thing:portal')
                      and (select count(*) = 1 from app.audit_log where record_table = 'activity_catalog' and action = 'activity_catalog.update' and record_id = 'test99.thing:portal')
                      and exists (select 1 from app.audit_log where record_table = 'centers' and record_id = :c99::text and after #>> '{rules,activity,enabled}' = 'true'),
  'N · the allowlist and the community''s switch are audited like any other reference data or setting');

rollback;
