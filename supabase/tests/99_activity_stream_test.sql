-- 0620 + 0621 (backlog B91): the activity stream. app.record_activity takes the person and the community from the sign-in
-- and drops everything it should not store; raw rows are for platform admins only; the three stream tables are not in the
-- row-level audit; the community's switch is the platform admin's alone.
--   A. The tables, grants, indexes and functions   B. Screen keys   C. Who is recorded   D. What is stored (shapes)
--   E. Dropped events   F. The switch and its guard   G. Opt-out   H. Batch cap and rate limit   I. Isolation between
--   communities and pseudonyms   J. Raw rows are Weaver's   K. No audit rows
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
-- n identical screen events.
create or replace function pg_temp.screens(n integer) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('key', 'screen:/', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen')) from generate_series(1, n)
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
\set e1 '99000000-0000-4000-8000-0000000000e1'

select pg_temp.as_none();
insert into auth.users (id, email) values
  (:staff99, 'staff99@act.test'), (:member99, 'member99@act.test'), (:kid99, 'kid99@act.test'), (:nodob99, 'nodob99@act.test'),
  (:prim99, 'prim99@act.test'), (:out99, 'out99@act.test'), (:adm99, 'adm99@act.test'), (:plat99, 'plat99@act.test'),
  (:ub99, 'ub99@act.test'), (:stranger99, 'stranger99@act.test'), (:cadm99, 'cadm99@act.test'), (:teen99, 'teen99@act.test'),
  (:eighteen99, 'eighteen99@act.test'), (:both99, 'both99@act.test'), (:nkid99, 'nkid99@act.test');
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
  ('99000000-0000-4000-8000-000000000109', :b99, 'Ulla', 'Ub99', date '1981-09-09'),
  ('99000000-0000-4000-8000-00000000011e', :b99, 'Bo', 'Both99', date '1982-08-08'),
  ('99000000-0000-4000-8000-00000000010b', :c99, 'Cy', 'Cadmin99', date '1972-10-10');
insert into app.households (id, center_id, display_name) values
  ('99000000-0000-4000-8000-0000000002a1', :a99, 'Household 99 one'), ('99000000-0000-4000-8000-0000000002a2', :a99, 'Household 99 two');
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
  (:b99, :ub99, '99000000-0000-4000-8000-000000000109'), (:b99, :both99, '99000000-0000-4000-8000-00000000011e'),
  (:c99, :cadm99, '99000000-0000-4000-8000-00000000010b');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:a99, :staff99, 'treasurer', 'center', 'test 99'), (:a99, :adm99, 'center_admin', 'center', 'test 99'),
  (:c99, :cadm99, 'center_admin', 'center', 'test 99');
-- Ada is the owner of A (the first administrator becomes it anyway; stated here so the test does not depend on that).
insert into app.center_owners (center_id, user_id) values (:a99, :adm99)
  on conflict (center_id) do update set user_id = excluded.user_id;

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
                      and not has_function_privilege('service_role', 'app.record_activity(uuid, jsonb)', 'execute'),
  'A · signed-in people call the four public functions; guests and the service key do not');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.activity_actor_hash(uuid, uuid, boolean)', 'execute')
                      and not has_function_privilege('authenticated', 'app.activity_person_ok(uuid, uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.activity_enabled(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.activity_register(text, text, text, text, text, text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.activity_screen_key_norm(text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.centers_activity_guard()', 'execute'),
  'A · the helpers (pseudonym, adult check, switch, register, key check) are not callable from outside');
select pg_temp.assert((select count(*) = 8 and bool_and(p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=app, public, extensions%')
                         from pg_proc p where p.pronamespace = 'app'::regnamespace
                          and p.proname in ('record_activity', 'set_activity_opt_out', 'activity_status', 'set_activity_recording',
                                            'activity_enabled', 'activity_person_ok', 'activity_actor_hash', 'centers_activity_guard')),
  'A · the eight security definer functions pin the search path to app, public, extensions');
select pg_temp.assert((select count(*) = 1 from pg_indexes where schemaname = 'app' and tablename = 'activity_events'
                          and indexdef like '%(center_id, occurred_at)%')
                      and (select count(*) = 1 from pg_indexes where schemaname = 'app' and tablename = 'activity_events'
                              and indexdef like '%(center_id, actor_hash, session_id, seq)%'),
  'A · the two indexes the miner needs exist: (center_id, occurred_at) and (center_id, actor_hash, session_id, seq)');
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
                                          'payment_failed', 'account_linked', 'screen:/events/[id]', 'screen:/')),
  'A · the keys named in the brief are in the allowlist');
-- A later migration adds a key with app.activity_register; a second call with only a command keeps the label and the entity kind.
select app.activity_register('test99.thing', 'action', 'portal', 'A test thing', 'person');
select app.activity_register('test99.thing', 'action', 'portal', 'A test thing', null, 'test99.thing');
select pg_temp.assert((select label = 'A test thing' and entity_kind = 'person' and commandable_key = 'test99.thing'
                         from app.activity_catalog where key = 'test99.thing'),
  'A · activity_register adds a key and a later call fills in the command without losing the entity kind');
select pg_temp.assert_raises($q$select app.activity_register('Bad Key', 'action', 'portal', 'x')$q$, 'check', 'A · a malformed action key is refused by the table');
select pg_temp.assert_raises($q$select app.activity_register('screen:/events/123', 'screen', 'portal', 'x')$q$, 'check', 'A · an id-like screen key is refused by the table');

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

-- ══ C. Who is recorded ═══════════════════════════════════════════════════════
-- Staff (a treasurer): recorded, as a pseudonym, with the role they hold, even when the payload claims otherwise.
select pg_temp.act(:staff99, :a99,
  jsonb_build_array(jsonb_build_object('key', 'giving.record_payment', 'kind', 'action', 'outcome', 'ok', 'via', 'screen',
    'entity_kind', 'payment', 'entity_id', :'e1', 'duration_ms', 1200, 'session_id', 's99-aaaaaaaa', 'seq', 1,
    'app_version', '1.2.3', 'platform', 'web',
    'user_id', '99000000-0000-4000-8000-000000000002', 'center_id', '99000000-0000-4000-8000-0000000000b1',
    'actor_hash', 'deadbeef', 'role_keys', jsonb_build_array('center_admin'), 'surface', 'member'))) as n_staff \gset
select pg_temp.assert(:n_staff = 1, 'C · a staff member''s event is stored (record_activity returns 1)');
select encode(extensions.hmac(convert_to(:staff99::text, 'UTF8'), s.salt, 'sha256'), 'hex') as h_staff
  from app.activity_salts s where s.center_id = :a99 \gset
select pg_temp.assert((select e.center_id = :a99 and e.actor_hash = :'h_staff' and e.role_keys = array['treasurer']
                              and e.surface = 'portal' and e.key = 'giving.record_payment' and e.kind = 'action'
                              and e.entity_kind = 'payment' and e.entity_id = :'e1'::uuid and e.outcome = 'ok' and e.error_code is null
                              and e.duration_ms = 1200 and e.via = 'screen' and e.seq = 1 and e.session_id = 's99-aaaaaaaa'
                              and e.app_version = '1.2.3' and e.platform = 'web'
                         from app.activity_events e where e.center_id = :a99 order by e.id desc limit 1),
  'C · the row has the community and the role from the sign-in, the pseudonym (hmac of the user id with the community''s salt) and the allowed fields');
select pg_temp.assert((select count(*) = 1 from app.activity_events)
                      and (select position(:staff99::text in to_jsonb(e)::text) = 0 from app.activity_events e limit 1)
                      and (select length(salt) = 32 from app.activity_salts where center_id = :a99),
  'C · nothing named another person, another community or a hash: one row, the raw user id appears nowhere in it, the salt is 32 random bytes');
select pg_temp.assert((select count(*) = 0 from app.activity_events where center_id = :b99), 'C · and nothing was written into community B, whatever the payload''s center_id said');

-- The community's owner (here the first center admin) also carries the "owner" role key.
select pg_temp.act(:adm99, :a99, jsonb_build_array(jsonb_build_object('key', 'events.save', 'kind', 'action', 'outcome', 'ok', 'via', 'palette'))) as n_adm \gset
select pg_temp.assert(:n_adm = 1 and (select 'center_admin' = any (role_keys) and 'owner' = any (role_keys) and via = 'palette'
                                         from app.activity_events where center_id = :a99 order by id desc limit 1),
  'C · a center admin is recorded with the role center_admin (and owner, as the first administrator), started from the palette');

-- A plain adult member: recorded with no roles; a member-app funnel step defaults to via app and the member surface.
select pg_temp.act(:member99, :a99, jsonb_build_array(jsonb_build_object('key', 'rsvp_started', 'kind', 'action', 'outcome', 'ok',
                                                                        'entity_kind', 'person'))) as n_mem \gset
select pg_temp.assert(:n_mem = 1 and (select role_keys = '{}' and surface = 'member' and via = 'app' and entity_kind = 'event'
                                         from app.activity_events where center_id = :a99 order by id desc limit 1),
  'C · a member is recorded with no roles; a funnel step is a member-surface event, via app, and its entity kind comes from the allowlist, not the payload');

-- Not recorded: a child, a teenager, a person with no birth date and nothing that shows an adult, a child with no birth
-- date, a person who is not in the community, a platform admin, a guest. Recorded: exactly 18, and an adult with no birth
-- date who is a primary member of a household.
select pg_temp.act(:kid99, :a99, pg_temp.screens(3)) as n_kid,
       pg_temp.act(:teen99, :a99, pg_temp.screens(3)) as n_teen,
       pg_temp.act(:nodob99, :a99, pg_temp.screens(3)) as n_nodob,
       pg_temp.act(:nkid99, :a99, pg_temp.screens(3)) as n_nkid,
       pg_temp.act(:stranger99, :a99, pg_temp.screens(3)) as n_stranger,
       pg_temp.act(:plat99, :a99, pg_temp.screens(3)) as n_plat,
       pg_temp.act(null, :a99, pg_temp.screens(3)) as n_guest,
       pg_temp.act(:eighteen99, :a99, pg_temp.screens(3)) as n_18,
       pg_temp.act(:prim99, :a99, pg_temp.screens(3)) as n_prim \gset
select pg_temp.assert(:n_kid = 0 and :n_teen = 0 and :n_nodob = 0 and :n_nkid = 0,
  'C · nothing is recorded for a child, for someone aged 17 years 11 months, for a person with no birth date and no sign of being an adult, or for a child with no birth date');
select pg_temp.assert(:n_stranger = 0 and :n_plat = 0 and :n_guest = 0,
  'C · nothing for someone who is not in the community, for a platform admin (even one with a person record there), or for a guest');
select pg_temp.assert(:n_18 = 3 and :n_prim = 3,
  'C · recorded: a person who is exactly 18 today, and an adult with no birth date who is the primary member of a household');
select pg_temp.assert((select count(*) = 0 from app.activity_events e
                        where e.actor_hash in (select app.activity_actor_hash(:a99, u, false)
                                                 from (values (:kid99::uuid), (:teen99::uuid), (:nodob99::uuid), (:nkid99::uuid), (:stranger99::uuid), (:plat99::uuid)) t(u)
                                                where app.activity_actor_hash(:a99, u, false) is not null)),
  'C · and no row exists under the pseudonym of anyone who was not to be recorded');

-- ══ D. What is stored: every value is held to its shape ═════════════════════
select pg_temp.act(:staff99, :a99, jsonb_build_array(jsonb_build_object('key', 'screen:/events/[id]', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen',
         'entity_kind', 'hello world free text', 'entity_id', 'not-a-uuid'))) as n1 \gset
select pg_temp.assert(:n1 = 1 and (select entity_kind is null and entity_id is null and surface = 'portal' from pg_temp.newest(:a99)),
  'D · an entity kind that is not in the allowlist and an entity id that is not a uuid are stored as empty');
select pg_temp.act(:staff99, :a99, jsonb_build_array(jsonb_build_object('key', 'screen:/events/[id]', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen',
         'entity_kind', 'event', 'entity_id', :'e1'))) as n2 \gset
select pg_temp.assert((select entity_kind = 'event' and entity_id = :'e1'::uuid from pg_temp.newest(:a99)),
  'D · a screen event keeps a known entity kind and a uuid');
select pg_temp.act(:staff99, :a99, jsonb_build_array(jsonb_build_object('key', 'people.update_person', 'kind', 'action', 'outcome', 'error', 'via', 'screen',
         'error_code', 'Customer Jane Doe was not found'))) as n3 \gset
select pg_temp.assert((select error_code is null and outcome = 'error' and entity_kind = 'person' from pg_temp.newest(:a99)),
  'D · an error "code" that is a sentence is not stored; the outcome still is');
select pg_temp.act(:staff99, :a99, jsonb_build_array(jsonb_build_object('key', 'people.update_person', 'kind', 'action', 'outcome', 'error', 'via', 'screen',
         'error_code', 'P0001'))) as n4 \gset
select pg_temp.assert((select error_code = 'p0001' from pg_temp.newest(:a99)), 'D · a short error code is kept, in lower case');
select pg_temp.act(:staff99, :a99, jsonb_build_array(jsonb_build_object('key', 'people.update_person', 'kind', 'action', 'outcome', 'ok', 'via', 'screen',
         'error_code', 'p0001'))) as n5 \gset
select pg_temp.assert((select error_code is null from pg_temp.newest(:a99)), 'D · an error code on an event that did not fail is dropped');
select pg_temp.act(:staff99, :a99, jsonb_build_array(jsonb_build_object('key', 'events.save', 'kind', 'action', 'outcome', 'ok', 'via', 'screen',
         'duration_ms', 12.6, 'platform', 'Web', 'app_version', 'x y', 'session_id', 'bad id', 'seq', 'abc'))) as n6 \gset
select pg_temp.assert((select duration_ms = 13 and platform = 'web' and app_version is null and session_id is null and seq is null from pg_temp.newest(:a99)),
  'D · a fractional duration is rounded; the platform is lower-cased; a version with a space, a session id with a space and a seq that is not a number are stored as empty');
select pg_temp.act(:staff99, :a99, jsonb_build_array(jsonb_build_object('key', 'events.save', 'kind', 'action', 'outcome', 'ok', 'via', 'screen', 'duration_ms', -5))) as n7 \gset
select pg_temp.assert((select duration_ms is null from pg_temp.newest(:a99)), 'D · a negative duration is stored as empty');
select pg_temp.act(:staff99, :a99, jsonb_build_array(jsonb_build_object('key', 'events.save', 'kind', 'action', 'outcome', 'ok', 'via', 'screen', 'duration_ms', 7200000))) as n8 \gset
select pg_temp.assert((select duration_ms is null from pg_temp.newest(:a99)), 'D · a duration over an hour is stored as empty');
select pg_temp.act(:staff99, :a99, jsonb_build_array(jsonb_build_object('key', 'events.save', 'kind', 'action', 'via', 'screen'))) as n9 \gset
select pg_temp.assert(:n9 = 1 and (select outcome = 'ok' from pg_temp.newest(:a99)), 'D · a missing outcome is ok');
select pg_temp.act(:staff99, :a99, jsonb_build_array(jsonb_build_object('key', 'events.save', 'kind', 'action', 'outcome', 'cancelled', 'via', 'assistant'))) as n10 \gset
select pg_temp.assert(:n10 = 1 and (select outcome = 'cancelled' and via = 'assistant' from pg_temp.newest(:a99)), 'D · cancelled and assistant are stored');
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
  jsonb_build_object('key', 'events.save', 'kind', 'thing', 'outcome', 'ok', 'via', 'screen'),
  jsonb_build_object('key', 'events.save', 'kind', 'action', 'outcome', 'maybe', 'via', 'screen'),
  jsonb_build_object('key', 'events.save', 'kind', 'action', 'outcome', 'ok', 'via', 'carrier-pigeon'),
  jsonb_build_object('key', 42, 'kind', 'action', 'outcome', 'ok', 'via', 'screen'),
  jsonb_build_object('kind', 'action', 'outcome', 'ok', 'via', 'screen'),
  to_jsonb(123), to_jsonb('events.save'::text), 'null'::jsonb, '[]'::jsonb)) as n_bad \gset
select pg_temp.assert(:n_bad = 0 and (select count(*) from app.activity_events where center_id = :a99) = :before_e,
  'E · keys that are not in the allowlist, a screen key as an action, an action key as a screen, a bad kind, outcome or via, a key that is not text, a missing key and elements that are not events: nothing stored, nothing raised');
select pg_temp.act(:staff99, :a99, jsonb_build_array(
  jsonb_build_object('key', 'screen:/events/[id]', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen'),
  jsonb_build_object('key', 'screen:/events/123', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen'),
  jsonb_build_object('key', 'screen:/events/99000000-0000-4000-8000-0000000000e1', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen'),
  jsonb_build_object('key', 'screen:/Events/list', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen'),
  jsonb_build_object('key', 'screen:/gyan/[goalId]', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen'),
  jsonb_build_object('key', 'screen:/', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen'),
  jsonb_build_object('key', 'screen:/events/', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen'),
  jsonb_build_object('key', 'screen:/a//b', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen'),
  jsonb_build_object('key', 'screen:/households?search=jane', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen'),
  jsonb_build_object('key', 'events/[id]', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen'),
  jsonb_build_object('key', 'screen:/' || repeat('abcdefghij/', 7) || 'abcd', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen'),
  jsonb_build_object('key', 'screen:/' || repeat('abcdefghij/', 7) || 'abc', 'kind', 'screen', 'outcome', 'ok', 'via', 'screen'),
  jsonb_build_object('key', 'screen:/give', 'kind', 'screen', 'outcome', 'ok', 'via', 'app'))) as n_screens \gset
select pg_temp.assert(:n_screens = 5, 'E · of 13 screen events only the 5 route patterns are stored (an id, a uuid, capitals, a trailing or doubled slash, a query string, no prefix and 81 characters are dropped)');
select pg_temp.assert((select array_agg(key order by id desc) from (select id, key from app.activity_events where center_id = :a99 order by id desc limit 5) t)
                        = array['screen:/give', 'screen:/' || repeat('abcdefghij/', 7) || 'abc', 'screen:/', 'screen:/gyan/[goalid]', 'screen:/events/[id]'],
  'E · stored as: the placeholder lower-cased, and the home screen');
select pg_temp.assert((select surface = 'member' from pg_temp.newest(:a99))
                      and (select bool_and(surface = 'portal') from (select surface from app.activity_events where center_id = :a99 order by id desc offset 1 limit 4) t),
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
select pg_temp.act(:out99, :a99, pg_temp.screens(4)) as n_out1 \gset
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
select pg_temp.assert(pg_temp.act(:out99, :a99, pg_temp.screens(4)) = 0 and (select count(*) = 0 from app.activity_events where actor_hash = :'h_out'),
  'G · and nothing is recorded for them afterwards');
select pg_temp.as_user(:staff99);
select count(*) as others_optouts from app.activity_optouts \gset
select pg_temp.as_none();
select pg_temp.assert(:others_optouts = 0, 'G · another person sees no opt-out rows (not even the one that exists)');
select pg_temp.as_user(:out99);
select app.set_activity_opt_out(false);
select pg_temp.as_none();
select pg_temp.assert(not exists (select 1 from app.activity_optouts where user_id = :out99) and pg_temp.act(:out99, :a99, pg_temp.screens(2)) = 2,
  'G · opting back in starts recording again');
select pg_temp.as_none();
select pg_temp.assert_raises($q$select app.set_activity_opt_out(true)$q$, 'sign in', 'G · with no sign-in the opt-out refuses');
select pg_temp.as_user(:kid99);
select (app.activity_status(:a99)) ->> 'eligible' as st_kid \gset
select pg_temp.as_none();
select pg_temp.assert(:'st_kid' = 'false', 'G · activity_status says a child is not eligible');

-- ══ H. Batch cap and rate limit ═════════════════════════════════════════════
select pg_temp.assert(pg_temp.act(:member99, :a99, pg_temp.screens(150)) = 100, 'H · a call of 150 events stores the first 100');
-- 2000 events per person per community per hour: the member has 101 so far (one in section C, 100 above); 1889 more make 1990.
select app.activity_actor_hash(:a99, :member99, false) as h_mem \gset
insert into app.activity_events (center_id, occurred_at, received_at, surface, actor_hash, key, kind, outcome, via)
select :a99, now() - interval '30 minutes', now() - interval '30 minutes', 'portal', :'h_mem', 'screen:/', 'screen', 'ok', 'screen' from generate_series(1, 1889);
select pg_temp.assert(pg_temp.act(:member99, :a99, pg_temp.screens(30)) = 10, 'H · with 1990 events in the last hour, a call of 30 stores the 10 that fit under 2000');
select pg_temp.assert(pg_temp.act(:member99, :a99, pg_temp.screens(5)) = 0, 'H · and then nothing more until the hour has passed');
update app.activity_events set received_at = now() - interval '2 hours' where actor_hash = :'h_mem';
select pg_temp.assert(pg_temp.act(:member99, :a99, pg_temp.screens(5)) = 5, 'H · events older than an hour no longer count against the limit');

-- ══ I. Communities are separate ═════════════════════════════════════════════
select count(*) as a_before from app.activity_events where center_id = :a99 \gset
select count(*) as b_before from app.activity_events where center_id = :b99 \gset
select pg_temp.act(:ub99, :a99, pg_temp.screens(3)) as n_ub_a, pg_temp.act(:staff99, :b99, pg_temp.screens(3)) as n_staff_b,
       pg_temp.act(:member99, :b99, pg_temp.screens(3)) as n_mem_b \gset
select pg_temp.assert(:n_ub_a = 0 and :n_staff_b = 0 and :n_mem_b = 0
                      and (select count(*) = :a_before from app.activity_events where center_id = :a99)
                      and (select count(*) = :b_before from app.activity_events where center_id = :b99),
  'I · a person of B cannot write into A, and staff or members of A cannot write into B, whatever p_center says');
select pg_temp.act(:ub99, :b99, pg_temp.screens(3)) as n_ub_b \gset
select pg_temp.assert(:n_ub_b = 3 and (select count(*) = :b_before + 3 from app.activity_events where center_id = :b99), 'I · a person of B records in B');
select pg_temp.act(:both99, :a99, pg_temp.screens(1)) as n_both_a, pg_temp.act(:both99, :b99, pg_temp.screens(1)) as n_both_b \gset
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

-- ══ K. No audit rows ════════════════════════════════════════════════════════
select pg_temp.assert((select count(*) = 0 from app.audit_log where record_table in ('activity_events', 'activity_optouts', 'activity_salts')),
  'K · after thousands of events, an opt-out, an opt-back-in and a purge-free run, the audit log holds no row for events, opt-outs or salts');
select pg_temp.assert((select count(*) = 1 from app.audit_log where record_table = 'activity_catalog' and action = 'activity_catalog.insert' and record_id = 'test99.thing')
                      and (select count(*) = 1 from app.audit_log where record_table = 'activity_catalog' and action = 'activity_catalog.update' and record_id = 'test99.thing')
                      and exists (select 1 from app.audit_log where record_table = 'centers' and record_id = :c99::text and after #>> '{rules,activity,enabled}' = 'true'),
  'K · the allowlist and the community''s switch are audited like any other reference data or setting');

rollback;
