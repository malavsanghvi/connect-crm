-- Settings and Platform (portal stream P-SETTINGS): rule saves are visible in
-- the center's own audit log, and only platform admins create centers.
\set ON_ERROR_STOP 1

create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;

insert into auth.users (id, email) values
  ('a9000000-0000-4000-8000-000000000001', 'settings.admin@example.com'),
  ('a9000000-0000-4000-8000-000000000002', 'platform.owner@example.com'),
  ('a9000000-0000-4000-8000-000000000003', 'auditor@example.com');
insert into app.accounts (user_id, is_platform_admin) values ('a9000000-0000-4000-8000-000000000002', true);
insert into app.role_grants (center_id, user_id, role_key, scope_kind) values
  ('00000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001', 'center_admin', 'center'),
  ('00000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000003', 'privacy_officer', 'center');

-- A center admin saves a rule with the version guard used by the app.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a9000000-0000-4000-8000-000000000001';
with u as (
  update app.centers set rules = rules || '{"version": 1}'::jsonb
   where id = '00000000-0000-4000-8000-000000000001' and rules->>'version' is null
  returning id)
select pg_temp.assert((select count(*) from u) = 1, 'a center admin saves the rules when the version matches');
with u as (
  update app.centers set rules = rules || '{"version": 2}'::jsonb
   where id = '00000000-0000-4000-8000-000000000001' and rules->>'version' = '0'
  returning id)
select pg_temp.assert((select count(*) from u) = 0, 'a save on a stale version changes nothing');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a9000000-0000-4000-8000-000000000003';  -- privacy officer: audit.view
select pg_temp.assert(
  (select count(*) from app.audit_log where action = 'centers.update' and record_id = '00000000-0000-4000-8000-000000000001'
     and center_id = '00000000-0000-4000-8000-000000000001') >= 1,
  'the center''s own audit viewers see its settings changes');
commit;

-- Only platform admins create centers.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a9000000-0000-4000-8000-000000000001';
do $$ begin
  begin
    insert into app.centers (slug, name, status) values ('not-allowed', 'Not allowed', 'onboarding');
    raise exception 'FAIL: a center admin created a center';
  exception when insufficient_privilege then
    raise notice 'PASS: a center admin cannot create a center';
  end;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a9000000-0000-4000-8000-000000000002';
insert into app.centers (id, slug, name, status, rules)
  values ('a9000000-0000-4000-8000-0000000000c1', 'partner-a', 'Design partner center A', 'onboarding', '{"version":1,"onboarding":{"wizard_step":2}}');
select pg_temp.assert((select status from app.centers where slug = 'partner-a') = 'onboarding', 'a platform admin creates an onboarding center');
select pg_temp.assert(
  (select count(*) from app.audit_log where action = 'centers.insert' and center_id = 'a9000000-0000-4000-8000-0000000000c1') = 1,
  'creating a center is audited under that center');
update app.centers set status = 'active' where id = 'a9000000-0000-4000-8000-0000000000c1' and status = 'onboarding';
select pg_temp.assert((select status from app.centers where slug = 'partner-a') = 'active', 'a platform admin takes a center live');
commit;

\echo 'PASS: settings and platform tests'
