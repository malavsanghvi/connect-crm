-- 0893 (DonorDelight slice 5, the weekly reminder, docs/DONORDELIGHT.md section 13): a number to each relationship owner, once a week, through the usual messaging path.
--   A. The setting: off by default, care.manage changes it, nobody else reads or writes it.
--   B. The sweep: only the worker; nothing while it is off or on the wrong day; one message per person and week, holding a number and never a name;
--      a person with no tasks is not told; a sandbox that may message only verified recipients is refused WITH the reason, never hidden.
--   C. Audited under DonorDelight without names.
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
create or replace function pg_temp.claims(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('request.headers', '', true);
end $$;
create or replace function pg_temp.local_dow(p_center uuid) returns integer language sql security definer as $$
  select extract(dow from (now() at time zone coalesce((select time_zone from app.centers where id = p_center), 'America/Chicago')))::int
$$;

\set c1 '''89300000-0000-4000-8000-0000000000c1'''
\set c2 '''89300000-0000-4000-8000-0000000000c2'''
\set owner1 '''89300000-0000-4000-8000-000000000001'''
\set owner2 '''89300000-0000-4000-8000-000000000002'''
\set lead1 '''89300000-0000-4000-8000-000000000003'''
\set rel1 '''89300000-0000-4000-8000-000000000004'''
\set lead2 '''89300000-0000-4000-8000-000000000005'''
\set rel2 '''89300000-0000-4000-8000-000000000006'''
\set plat '''89300000-0000-4000-8000-000000000007'''
\set clerk '''89300000-0000-4000-8000-000000000008'''
\set h1 '''89300000-0000-4000-8000-0000000000b1'''
\set h2 '''89300000-0000-4000-8000-0000000000b2'''
\set p1 '''89300000-0000-4000-8000-0000000000a1'''
\set p2 '''89300000-0000-4000-8000-0000000000a2'''

insert into auth.users (id, email) values
  (:owner1, 'owner1-893@c1.test'), (:owner2, 'owner2-893@c2.test'), (:lead1, 'lead1-893@c1.test'), (:rel1, 'rel1-893@c1.test'),
  (:lead2, 'lead2-893@c2.test'), (:rel2, 'rel2-893@c2.test'), (:plat, 'plat893@weaver.test'), (:clerk, 'clerk893@c1.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true) on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone, category_key, environment) values
  (:c1, 'notify893a', 'Grace Center 893', 'G893', 'TX', 'active', 'America/Chicago', 'jain_center', 'production'),
  (:c2, 'notify893b', 'Harbor Food Bank 893', 'H893', 'TX', 'active', 'America/Chicago', 'nonprofit_secular', 'sandbox');
insert into app.center_owners (center_id, user_id) values (:c1, :owner1), (:c2, :owner2);
insert into app.center_module_grants (center_id, module_key, granted, reason) values (:c1, 'care', true, 'Test 893'), (:c2, 'care', true, 'Test 893');
insert into app.roles (key, tier, name, default_scope, description, permissions) values ('people_viewer_893', 'center', 'People viewer 893', 'center', 'Test 893', '["people.view"]');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:c1, :plat, 'platform_owner', 'platform', 'Test 893: the platform owner role (holds "*")'),
  (:c1, :lead1, 'care_lead', 'center', 'Test 893'), (:c1, :rel1, 'relationship_owner', 'center', 'Test 893'), (:c1, :clerk, 'people_viewer_893', 'center', 'Test 893'),
  (:c2, :lead2, 'care_lead', 'center', 'Test 893'), (:c2, :rel2, 'relationship_owner', 'center', 'Test 893');
insert into app.households (id, center_id, display_name) values (:h1, :c1, 'Newman893, Nia'), (:h2, :c2, 'Nolan893, Ned');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values (:p1, :c1, 'Nia', 'Newman893', date '1980-01-01'), (:p2, :c2, 'Ned', 'Nolan893', date '1980-01-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values (:h1, :p1, :c1, 'primary', true), (:h2, :p2, :c2, 'primary', true);
insert into app.care_owners (household_id, center_id, owner_user_id, assigned_by) values (:h1, :c1, :rel1, :lead1), (:h2, :c2, :rel2, :lead2);

set role authenticated;
select pg_temp.claims(:lead1);
select app.install_care_starters(:c1) as n1 \gset
select pg_temp.claims(:lead2);
select app.install_care_starters(:c2) as n2 \gset
reset role;
select app._care_runs_sync(:c1), app._care_runs_sync(:c2);
select pg_temp.assert(:n1::int >= 9 and :n2::int >= 9, 'Fixtures · both communities have their playbooks');
select pg_temp.assert((select count(*) from app._care_week_rows(:c1, :rel1)) >= 1 and (select count(*) from app._care_week_rows(:c2, :rel2)) >= 1, 'Fixtures · each owner has a task this week');

-- ══ A. The setting ═══════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:rel1);
select pg_temp.assert(not (app.care_week_settings_get(:c1) ->> 'notify')::boolean and (app.care_week_settings_get(:c1) ->> 'notify_dow')::int = 1 and not (app.care_week_settings_get(:c1) ->> 'can_manage')::boolean,
  'A · off by default, Monday, and a relationship owner may not change it');
select pg_temp.assert_raises($$select app.save_care_week_settings('89300000-0000-4000-8000-0000000000c1', true, 1)$$, 'don''t have access', 'A · a relationship owner cannot switch it on');
select pg_temp.claims(:clerk);
select pg_temp.assert_raises($$select app.care_week_settings_get('89300000-0000-4000-8000-0000000000c1')$$, 'don''t have access', 'A · people.view alone cannot read it');
select pg_temp.claims(:plat);
select pg_temp.assert_raises($$select app.save_care_week_settings('89300000-0000-4000-8000-0000000000c1', true, 1)$$, 'don''t have access', 'A · nor a platform admin');
select pg_temp.claims(:lead1);
select pg_temp.assert_raises($$select app.save_care_week_settings('89300000-0000-4000-8000-0000000000c1', true, 9)$$, 'choose the day', 'A · a weekday is 0 to 6');
select pg_temp.assert_raises($$select app.save_care_week_settings('89300000-0000-4000-8000-0000000000c2', true, 1)$$, 'don''t have access', 'A · a manager of one community cannot change another''s');

-- ══ B. The sweep ═════════════════════════════════════════════════════════════
select pg_temp.assert_raises($$select app.worker_care_week_sweep()$$, 'permission denied', 'B · the API cannot run the sweep');
reset role;
set local role connect_worker;
select app.worker_care_week_sweep() ->> 'queued' as q0 \gset
reset role;
select pg_temp.assert(:q0::int = 0 and not exists (select 1 from app.care_week_log where center_id in (:c1, :c2)), 'B · nothing is sent while the setting is off');
-- On, but not today and not in the next two days: the weekday is 3 days ago.
set role authenticated;
select pg_temp.claims(:lead1);
select app.save_care_week_settings(:c1, true, (pg_temp.local_dow(:c1) + 4) % 7) is not null as s1 \gset
select pg_temp.claims(:lead2);
select app.save_care_week_settings(:c2, true, (pg_temp.local_dow(:c2) + 6) % 7) is not null as s2 \gset
reset role;
set local role connect_worker;
select app.worker_care_week_sweep() ->> 'queued' as q1, app.worker_care_week_sweep() ->> 'centers' as ctr1 \gset
reset role;
select pg_temp.assert(:q1::int = 0 and :ctr1::int = 1 and not exists (select 1 from app.care_week_log where center_id = :c1),
  'B · three days after the chosen weekday it is too late for this week; a community whose weekday was yesterday is in');
select pg_temp.assert((select count(*) from app.care_week_log where center_id = :c2) = 1 and (select outcome from app.care_week_log where center_id = :c2) = 'refused'
                      and (select reason from app.care_week_log where center_id = :c2) ilike '%verified test recipients%',
  'B · a sandbox may message only verified recipients: the refusal is logged with its reason, not hidden');
set role authenticated;
select pg_temp.claims(:lead1);
select app.save_care_week_settings(:c1, true, (pg_temp.local_dow(:c1) + 6) % 7) is not null as s3 \gset
reset role;
set local role connect_worker;
select app.worker_care_week_sweep() as r2 \gset
reset role;
select pg_temp.assert((:'r2'::jsonb ->> 'queued')::int = 1 and (select outcome from app.care_week_log where center_id = :c1 and user_id = :rel1) = 'queued'
                      and (select tasks from app.care_week_log where center_id = :c1 and user_id = :rel1) >= 1,
  'B · the owner of a household with tasks is told, once');
select pg_temp.assert(not exists (select 1 from app.care_week_log where center_id = :c1 and user_id in (:lead1, :owner1, :clerk, :plat)),
  'B · nobody else is told: not a manager with no households, nor people.view, nor a platform admin');
select pg_temp.assert((select count(*) from app.messages where center_id = :c1 and template_key = 'care_week') = 1
                      and (select to_address from app.messages where center_id = :c1 and template_key = 'care_week') = 'rel1-893@c1.test'
                      and (select purpose from app.messages where center_id = :c1 and template_key = 'care_week') = 'notification',
  'B · one message through the usual messaging path, to the owner''s own address');
select pg_temp.assert((select body from app.messages where center_id = :c1 and template_key = 'care_week') ~ 'Your week in Member care at G893: [0-9]+ to do, [0-9]+ of them overdue'
                      and (select body || subject from app.messages where center_id = :c1 and template_key = 'care_week') !~* '(newman|nolan|welcome|reconnect|introduce)',
  'B · the message holds a number and the section''s name, never a household, a name or a step');
set local role connect_worker;
select app.worker_care_week_sweep() ->> 'queued' as q3 \gset
reset role;
select pg_temp.assert(:q3::int = 0 and (select count(*) from app.messages where center_id = :c1 and template_key = 'care_week') = 1, 'B · running it again the same week tells no one twice');
-- A person with no email address is logged, not silently dropped.
delete from app.care_week_log where center_id = :c1;
update auth.users set email = null where id = :rel1;
set local role connect_worker;
select app.worker_care_week_sweep() ->> 'no_email' as ne \gset
reset role;
select pg_temp.assert(:ne::int = 1 and (select outcome from app.care_week_log where center_id = :c1 and user_id = :rel1) = 'no_email', 'B · a person with no email address is logged as such');
-- An owner with nothing to do is not told.
delete from app.care_week_log where center_id = :c1;
update auth.users set email = 'rel1-893@c1.test' where id = :rel1;
insert into app.care_task_marks (center_id, household_id, run_id, step_id, status, note)
  select r.center_id, r.household_id, r.id, s.id, 'skipped', 'Test 893: nothing to do'
    from app.care_runs r join app.care_playbook_steps s on s.playbook_id = r.playbook_id where r.household_id = :h1 and s.archived_at is null;
set local role connect_worker;
select app.worker_care_week_sweep() ->> 'queued' as q4 \gset
reset role;
select pg_temp.assert(:q4::int = 0 and not exists (select 1 from app.care_week_log where center_id = :c1), 'B · a person with no task this week is not told');

-- ══ C. Audited ═══════════════════════════════════════════════════════════════
select pg_temp.assert((select count(*) from app.audit_log where action = 'care.week_notified' and module = 'care') >= 2
                      and not exists (select 1 from app.audit_log where action = 'care.week_notified' and (after::text ~* '(newman|nolan|893@)')),
  'C · each batch is audited under DonorDelight with counts only');
rollback;
