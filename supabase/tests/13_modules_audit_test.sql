-- 0100–0104 (stream S-CORE): modules switched on/off per organization, and
-- every row change audited with who, when, what, from where and why.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
-- Runs a statement that must fail with a message containing `expect`.
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
\set jsh '''00000000-0000-4000-8000-000000000001'''
\set other '''00000000-0000-4000-8000-000000000002'''
-- Users: 01 Priya (member), 03 Tara (treasurer), 07 admin of the other center,
-- 11 Ada (center admin: settings.manage, audit.view), 301 Mona (membership
-- coordinator), a9…02 platform admin.

-- ── Coverage ─────────────────────────────────────────────────────────────────
select pg_temp.assert(not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'app' and c.relkind in ('r','p') and c.relname <> 'audit_log'
       and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'audit_' || c.relname
                         and t.tgfoid = 'app.audit_row'::regproc and not t.tgisinternal)),
  'every app base table except audit_log has an audit_<table> trigger on app.audit_row');
select pg_temp.assert(not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'app' and c.relkind in ('r','p')
       and not exists (select 1 from app.module_tables mt where mt.table_name = c.relname)),
  'every app base table is mapped to a module (or to the core platform) in module_tables');
select pg_temp.assert(not exists (
    select 1 from app.module_tables mt where not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relname = mt.table_name and c.relkind in ('r','p'))),
  'module_tables lists no table that does not exist');
select pg_temp.assert((select count(*) from app.modules) = 18 and (select array_agg(key order by key) from app.modules where core) = '{people}',
  'the module catalog has the 18 contract modules and only people is core');
select pg_temp.assert(not exists (
    select mt.table_name from app.module_tables mt join app.modules m on m.key = mt.module_key
      join pg_class c on c.relname = mt.table_name join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'app'
     where not m.core and mt.table_name <> 'notification_topics'
       and not exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'module_switch' and not p.polpermissive)),
  'every table of a switchable module has a restrictive module_switch policy (the global notification_topics catalog aside)');

-- ── Header context is captured ───────────────────────────────────────────────
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000011","role":"authenticated"}';
set local request.headers = '{"x-request-id":"6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b","x-audit-reason":"Fixing%20the%20city%20%E2%9C%93","x-client-app":"portal","x-client-screen":"/households/20000000-0000-4000-8000-000000000002","user-agent":"TestAgent/1.0","x-forwarded-for":"203.0.113.9, 10.0.0.1"}';
update app.households set city = 'Sugar Land' where id = '20000000-0000-4000-8000-000000000002';
commit;
select pg_temp.assert((select correlation_id = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' and reason = 'Fixing the city ✓'
                          and client_app = 'portal' and client_screen = '/households/20000000-0000-4000-8000-000000000002'
                          and user_agent = 'TestAgent/1.0' and ip = '203.0.113.9'::inet and actor_role = 'authenticated'
                          and module = 'people' and actor_user_id = '10000000-0000-4000-8000-000000000011'
                          and center_id = :jsh and after->>'city' = 'Sugar Land' and before->>'city' is distinct from 'Sugar Land'
                         from app.audit_log where action = 'households.update' and record_id = '20000000-0000-4000-8000-000000000002'
                         order by id desc limit 1),
  'a portal write records request id, url-decoded reason, app, screen, user agent, first forwarded IP, JWT role, module, before and after');

-- Bad or missing values never fail the write; they are simply not recorded.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000011","role":"authenticated"}';
set local request.headers = '{"x-request-id":"not-a-uuid","x-audit-reason":"bad %E2%28 escape","x-client-app":"hacker","x-forwarded-for":"garbage"}';
update app.households set city = 'Katy' where id = '20000000-0000-4000-8000-000000000002';
commit;
select pg_temp.assert((select correlation_id is null and client_app is null and ip is null and reason = 'bad %E2%28 escape'
                         from app.audit_log where action = 'households.update' and record_id = '20000000-0000-4000-8000-000000000002'
                         order by id desc limit 1),
  'an invalid request id, client app or IP is dropped and a malformed escape keeps the reason as sent');
begin;
set local request.headers = 'this is not json';
update app.households set city = 'Pearland' where id = '20000000-0000-4000-8000-000000000002';
commit;
select pg_temp.assert((select reason is null and client_app is null and after->>'city' = 'Pearland'
                         from app.audit_log where action = 'households.update' and record_id = '20000000-0000-4000-8000-000000000002'
                         order by id desc limit 1),
  'unparseable request headers are ignored and the change is still audited');

-- An RPC's explicit context wins over the headers, and a later header string in
-- the same transaction is read afresh (the per-transaction parse cache).
begin;
set local request.headers = '{"x-audit-reason":"header reason","x-client-app":"member","x-client-screen":"/first"}';
select app.set_audit_context('RPC reason', '11111111-2222-4333-8444-555555555555');
update app.households set city = 'Houston' where id = '20000000-0000-4000-8000-000000000002';
set local request.headers = '{"x-client-app":"kiosk","x-client-screen":"/second"}';
update app.households set city = 'Bellaire' where id = '20000000-0000-4000-8000-000000000002';
commit;
select pg_temp.assert((select array_agg(reason || '|' || correlation_id || '|' || client_app || '|' || client_screen order by id)
                         from (select * from app.audit_log where action = 'households.update'
                                 and record_id = '20000000-0000-4000-8000-000000000002' order by id desc limit 2) x)
                       = array['RPC reason|11111111-2222-4333-8444-555555555555|member|/first',
                               'RPC reason|11111111-2222-4333-8444-555555555555|kiosk|/second'],
  'set_audit_context overrides the header reason for the rest of the transaction; changed headers are re-read');
begin;
select set_config('app.client_app', 'job', true), set_config('app.audit_reason', 'nightly job', true);
update app.households set city = 'Houston' where id = '20000000-0000-4000-8000-000000000002';
commit;
select pg_temp.assert((select client_app = 'job' and reason = 'nightly job' from app.audit_log
                        where action = 'households.update' and record_id = '20000000-0000-4000-8000-000000000002' order by id desc limit 1),
  'jobs set app.client_app and app.audit_reason with set_config');

-- Tables without an id column key the entry by their primary key.
update app.household_members set joined_at = coalesce(joined_at, current_date) - 1
 where household_id = '20000000-0000-4000-8000-000000000001' and person_id = '30000000-0000-4000-8000-000000000001';
select pg_temp.assert(exists (select 1 from app.audit_log where action = 'household_members.update'
                                and record_id = '20000000-0000-4000-8000-000000000001:30000000-0000-4000-8000-000000000001'),
  'composite-key rows are recorded as "<household_id>:<person_id>"');
update app.roles set description = coalesce(description, '') || ' ' where key = 'teacher';
select pg_temp.assert(exists (select 1 from app.audit_log where action = 'roles.update' and record_id = 'teacher' and center_id is null),
  'a keyed global table (roles) is audited by its key, with no center');
-- Tables without center_id resolve it through the parent.
insert into app.gyan_levels (id, goal_id, key, name)
select 'e1300000-0000-4000-8000-000000000001', g.id, 'audit_test', 'Audit test level' from app.gyan_goals g where g.center_id = :jsh limit 1;
select pg_temp.assert((select center_id = :jsh and module = 'gyan_path' from app.audit_log
                        where action = 'gyan_levels.insert' and record_id = 'e1300000-0000-4000-8000-000000000001'),
  'gyan_levels (no center_id) is audited under its goal''s center');

-- The chain still links and the log is still append-only.
select pg_temp.assert((select a.prev_hash = (select b.hash from app.audit_log b where b.center_id = a.center_id and b.id < a.id order by b.id desc limit 1)
                         from app.audit_log a where a.center_id = :jsh order by a.id desc limit 1),
  'the newest entry is chained to the previous entry of the same center');
select pg_temp.assert((select a.prev_hash = (select b.hash from app.audit_log b where b.center_id is null and b.id < a.id order by b.id desc limit 1)
                         from app.audit_log a where a.center_id is null order by a.id desc limit 1),
  'the center-less chain still links');
do $$ begin
  update app.audit_log set reason = 'tampered' where id = (select max(id) from app.audit_log);
  raise exception 'FAIL: audit_log accepted an update';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: audit_log stays append-only';
end $$;

-- ── Record history ───────────────────────────────────────────────────────────
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000011';
select pg_temp.assert((select count(*) >= 5 and bool_and(action like 'households.%')
                         from app.record_history('households', '20000000-0000-4000-8000-000000000002')),
  'audit.view sees a record''s history');
select pg_temp.assert((select array_agg(id) = array_agg(id order by id desc)
                         from app.record_history('households', '20000000-0000-4000-8000-000000000002')),
  'history is newest first');
select pg_temp.assert((select bool_and(actor_name not in ('System', 'Unknown user') and actor_name like '% %')
                         from app.record_history('households', '20000000-0000-4000-8000-000000000002')
                        where actor_user_id = '10000000-0000-4000-8000-000000000011'),
  'history shows the actor''s name');
select pg_temp.assert((select actor_name from app.record_history('households', '20000000-0000-4000-8000-000000000002')
                        where actor_user_id is null limit 1) = 'System',
  'changes with no signed-in user show as System');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select pg_temp.assert((select count(*) from app.record_history('households', '20000000-0000-4000-8000-000000000002')) = 0,
  'a member without audit.view gets no history');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000007';
select pg_temp.assert((select count(*) from app.record_history('households', '20000000-0000-4000-8000-000000000002')) = 0,
  'another center''s admin gets no history');
commit;

-- ── Switching modules ────────────────────────────────────────────────────────
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';   -- treasurer: no settings.manage
select pg_temp.assert_raises($$select app.set_module_enabled('00000000-0000-4000-8000-000000000001', 'store', false, 'test')$$,
  'settings.manage', 'only settings.manage can switch a module');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000007';   -- admin of the other center
select pg_temp.assert_raises($$select app.set_module_enabled('00000000-0000-4000-8000-000000000001', 'store', false, 'test')$$,
  'settings.manage', 'an admin of another center cannot switch this center''s modules');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000011';
select pg_temp.assert_raises($$insert into app.center_modules (center_id, module_key, enabled) values ('00000000-0000-4000-8000-000000000001', 'store', false)$$,
  'permission denied', 'even a settings manager cannot write center_modules directly');
select pg_temp.assert_raises($$select app.set_module_enabled('00000000-0000-4000-8000-000000000001', 'store', false, '  ')$$,
  'Give a reason', 'a reason is required');
select pg_temp.assert_raises($$select app.set_module_enabled('00000000-0000-4000-8000-000000000001', 'people', false, 'test')$$,
  'core platform', 'a core module cannot be switched off');
select pg_temp.assert_raises($$select app.set_module_enabled('00000000-0000-4000-8000-000000000001', 'giving', false, 'test')$$,
  'Bolis', 'a module cannot be switched off while a module that depends on it is on (the error names it)');
select pg_temp.assert_raises($$select app.set_module_enabled('00000000-0000-4000-8000-000000000001', 'nope', false, 'test')$$,
  'no module called', 'an unknown module is refused');
select app.set_module_enabled(:jsh, 'bolis', false, 'Bolis are run on paper this year');
select app.set_module_enabled(:jsh, 'accounting', false, 'QuickBooks not connected yet');
select app.set_module_enabled(:jsh, 'giving', false, 'Giving moves to the new system in October');
select pg_temp.assert_raises($$select app.set_module_enabled('00000000-0000-4000-8000-000000000001', 'bolis', true, 'test')$$,
  'needs Pledges & donations', 'a module cannot be switched on while its dependency is off');
select app.set_module_enabled(:jsh, 'events', false, 'Testing the events switch');
select app.set_module_enabled(:jsh, 'jain_way', false, 'Testing the Jain Way switch');
select app.set_module_enabled(:jsh, 'gyan_path', false, 'Testing the Gyan Path switch');
commit;

select pg_temp.assert((select count(*) from app.center_modules where center_id = :jsh and not enabled
                         and changed_by = '10000000-0000-4000-8000-000000000011') = 6,
  'the switches are stored with who changed them');
select pg_temp.assert((select reason = 'Giving moves to the new system in October' and actor_user_id = '10000000-0000-4000-8000-000000000011'
                          and center_id = :jsh and module is null and after->>'enabled' = 'false'
                         from app.audit_log where record_table = 'center_modules' and record_id = :jsh || ':giving' order by id desc limit 1),
  'switching a module is audited with its reason');

-- Members read their center's switches; my_modules reports them.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select pg_temp.assert((select count(*) from app.center_modules where center_id = :jsh) = 6, 'members read their center''s module switches');
select pg_temp.assert((select array_agg(key order by key) from app.my_modules(:jsh) where not enabled)
                        = '{accounting,bolis,events,giving,gyan_path,jain_way}'
                      and (select enabled and core from app.my_modules(:jsh) where key = 'people')
                      and (select count(*) from app.my_modules(:jsh)) = 18,
  'my_modules lists every module with its state, core ones always on');
select pg_temp.assert((select count(*) from app.my_modules(:other)) = 0, 'my_modules says nothing about a center you do not belong to');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000007';
select pg_temp.assert((select bool_and(enabled) from app.my_modules(:other)), 'another center keeps every module on');
commit;

-- RLS: reads and writes are blocked for the switched-off module.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';   -- treasurer
select pg_temp.assert((select count(*) from app.pledges) = 0 and (select count(*) from app.payments) = 0
                      and (select count(*) from app.funds) = 0,
  'with Giving off the treasurer reads no pledges, payments or funds');
select pg_temp.assert_raises($$insert into app.funds (center_id, key, name) values ('00000000-0000-4000-8000-000000000001', 'blocked', 'Blocked fund')$$,
  'row-level security', 'with Giving off the treasurer cannot add a fund');
update app.pledges set dedication = 'blocked' where center_id = '00000000-0000-4000-8000-000000000001';
select pg_temp.assert((select count(*) from app.people) > 0, 'core People data stays readable');
select pg_temp.assert_raises($$select app.record_offline_payment('20000000-0000-4000-8000-000000000001', 1000, 'cash')$$,
  'The Pledges & donations module is switched off for this community', 'with Giving off its RPCs refuse in plain English');
select pg_temp.assert_raises($$select * from app.preview_allocation('20000000-0000-4000-8000-000000000001', 1000)$$,
  'switched off', 'SQL-language Giving RPCs refuse too');
commit;
select pg_temp.assert((select count(*) from app.pledges where dedication = 'blocked') = 0, 'the blocked update changed nothing');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000011';   -- center admin (events.view)
select pg_temp.assert((select count(*) from app.events) = 0, 'with Events off even the center admin reads no events');
select pg_temp.assert_raises($$select * from app.event_live_stats('50000000-0000-4000-8000-000000000001')$$,
  'The Events & RSVP module is switched off', 'with Events off the live event numbers refuse');
select pg_temp.assert((select count(*) from app.gyan_levels where id = 'e1300000-0000-4000-8000-000000000001') = 0,
  'with Gyan Path off the center''s gyan levels (no center_id; resolved through the goal) are hidden');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';   -- member
select pg_temp.assert_raises($$select * from app.log_practice('00000000-0000-4000-8000-000000000001', 'caf0d8cf-b151-493c-a3f9-939a55c4e1b0')$$,
  'The My Jain Way module is switched off', 'with My Jain Way off a member cannot log a practice');
select pg_temp.assert((select count(*) from app.practice_logs) = 0, 'with My Jain Way off a member reads no practice logs');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a9000000-0000-4000-8000-000000000002';   -- platform admin
select pg_temp.assert((select count(*) from app.pledges where center_id = :jsh) > 0, 'a platform admin still reads a switched-off module');
commit;

-- Switch back on (dependencies first); everything is readable again.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000011';
select app.set_module_enabled(:jsh, 'giving', true, 'Back on after the test');
select app.set_module_enabled(:jsh, 'bolis', true, 'Back on after the test');
select app.set_module_enabled(:jsh, 'accounting', true, 'Back on after the test');
select app.set_module_enabled(:jsh, 'events', true, 'Back on after the test');
select app.set_module_enabled(:jsh, 'jain_way', true, 'Back on after the test');
select app.set_module_enabled(:jsh, 'gyan_path', true, 'Back on after the test');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';
select pg_temp.assert((select count(*) from app.pledges) > 0, 'switching Giving back on restores the treasurer''s access');
commit;

-- ── Reason-taking RPCs put the reason on every row they change ────────────────
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000301';   -- membership coordinator
select app.change_household_tier('20000000-0000-4000-8000-000000000302', 'life', 'Paid the life membership at the gala');
commit;
select pg_temp.assert((select count(*) >= 1 and bool_and(reason = 'Paid the life membership at the gala')
                         from app.audit_log where record_table = 'memberships' and actor_user_id = '10000000-0000-4000-8000-000000000301'
                          and occurred_at >= now() - interval '1 minute'
                          and coalesce(after->>'household_id', before->>'household_id') = '20000000-0000-4000-8000-000000000302'),
  'a tier change carries its reason on every membership row it writes');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000011';
select app.set_module_enabled(:jsh, 'membership', false, 'Testing the membership guard');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000301';
select pg_temp.assert_raises($$select app.change_household_tier('20000000-0000-4000-8000-000000000302', 'yearly', 'test')$$,
  'The Membership module is switched off', 'with Membership off a tier change refuses');
select pg_temp.assert_raises($$select app.merge_people('30000000-0000-4000-8000-000000000301', '30000000-0000-4000-8000-000000000302')$$,
  'needs the Membership module', 'with Membership off a person merge refuses instead of leaving memberships behind');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000011';
select app.set_module_enabled(:jsh, 'membership', true, 'Back on after the test');
commit;
select pg_temp.assert(not exists (select 1 from app.center_modules where not enabled), 'the test leaves every module on');
