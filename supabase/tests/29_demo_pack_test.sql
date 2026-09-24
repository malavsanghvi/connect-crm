-- 0310–0312 (onboarding stream o-demo): the Demo data pack — activate, reset and clear a
-- sandbox; refused in production (database, not just the UI); money through the existing rules.
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
  if position(lower(expect) in lower(sqlerrm)) = 0 then
    raise exception 'FAIL: % (got "%")', label, sqlerrm;
  end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.claims(p_user text, p_step_up boolean default false) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', case when p_step_up then 'aal2' else 'aal1' end,
    'amr', case when p_step_up
                then jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 600),
                                       jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 60))
                else jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 60)) end)::text, true);
end $$;
create or replace function pg_temp.no_claims() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '', true); end $$;
-- The pack's contents flattened to {table: rows}.
create or replace function pg_temp.pack_rows() returns jsonb language sql as $$
  select jsonb_object_agg(r.key, r.value) from app.demo_packs p, jsonb_array_elements(p.contents) m, jsonb_each(m->'rows') r where p.key = 'community'
$$;
-- Run a demo job to the end as the background service would.
create or replace function pg_temp.run_load(p_center uuid) returns jsonb language plpgsql as $$
declare r jsonb; i int := 0;
begin
  loop
    r := app.worker_demo_load_next(p_center);
    i := i + 1;
    exit when (r->>'done')::boolean or i > 20;
  end loop;
  return r;
end $$;
grant connect_worker to postgres;

\set sbx '''29000000-0000-4000-8000-0000000000c1'''
\set prod '''29000000-0000-4000-8000-0000000000c2'''
\set promoted '''29000000-0000-4000-8000-0000000000c3'''
\set owner '''29000000-0000-4000-8000-0000000000a1'''
\set admin '''29000000-0000-4000-8000-0000000000a2'''
\set member '''29000000-0000-4000-8000-0000000000a3'''
\set demo_login '''29000000-0000-4000-8000-0000000000a4'''
\set jsh '''00000000-0000-4000-8000-000000000001'''

insert into auth.users (id, email) values
  (:owner, 'olivia@templeexample.test'), (:admin, 'adam@templeexample.test'), (:member, 'mo@templeexample.test'),
  (:demo_login, 'priya.shah@demo.communityconnect.test');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status) values
  ('29000000-0000-4000-8000-0000000000f1', :owner, 'phone', 'totp', 'verified');
insert into app.centers (id, slug, name, short_name, status, environment) values
  (:sbx, 'dmo-sandbox', 'Demo Temple', 'DMO', 'onboarding', 'sandbox'),
  (:prod, 'dmo-prod', 'Demo Temple (live)', 'DMP', 'onboarding', 'production'),
  (:promoted, 'dmo2-sandbox', 'Promoted Temple', 'DM2', 'onboarding', 'sandbox');
update app.centers set sandbox_for = :prod where id = :promoted;
-- The owner and a second administrator, each with their own household; a plain member.
insert into app.households (id, center_id, display_name) values
  ('29000000-0000-4000-8000-0000000000d1', :sbx, 'Olivia household'), ('29000000-0000-4000-8000-0000000000d2', :sbx, 'Adam household'),
  ('29000000-0000-4000-8000-0000000000d3', :sbx, 'Mo household');
insert into app.people (id, center_id, first_name, last_name, email) values
  ('29000000-0000-4000-8000-0000000000e1', :sbx, 'Olivia', 'Owner', 'olivia@templeexample.test'),
  ('29000000-0000-4000-8000-0000000000e2', :sbx, 'Adam', 'Admin', 'adam@templeexample.test'),
  ('29000000-0000-4000-8000-0000000000e3', :sbx, 'Mo', 'Member', 'mo@templeexample.test');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  ('29000000-0000-4000-8000-0000000000d1', '29000000-0000-4000-8000-0000000000e1', :sbx, 'primary', true),
  ('29000000-0000-4000-8000-0000000000d2', '29000000-0000-4000-8000-0000000000e2', :sbx, 'primary', true),
  ('29000000-0000-4000-8000-0000000000d3', '29000000-0000-4000-8000-0000000000e3', :sbx, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values
  (:sbx, :owner, '29000000-0000-4000-8000-0000000000e1'), (:sbx, :admin, '29000000-0000-4000-8000-0000000000e2'),
  (:sbx, :member, '29000000-0000-4000-8000-0000000000e3');
insert into app.role_grants (center_id, user_id, role_key, reason) values
  (:sbx, :owner, 'center_admin', 'test'), (:sbx, :admin, 'center_admin', 'test');
insert into app.center_owners (center_id, user_id) values (:sbx, :owner) on conflict (center_id) do update set user_id = excluded.user_id;
-- The organization's own configuration, which clearing keeps.
insert into app.org_profiles (center_id, legal_name, mission) values (:sbx, 'Demo Temple Inc.', 'Our own mission') on conflict (center_id) do update set mission = excluded.mission;
insert into app.integration_connections (center_id, provider, status, display_name) values (:sbx, 'stripe', 'connected', 'Stripe (test)');
insert into app.legal_documents (center_id, kind, version, title, body_md, published_at) values (:sbx, 'privacy', '1', 'Privacy', 'Ours.', now());
insert into app.center_modules (center_id, module_key, enabled, reason) values (:sbx, 'niva', false, 'not yet');
-- Something the organization entered itself before trying the pack.
insert into app.zones (center_id, name) values (:sbx, 'Our own zone');

-- ── Catalog and coverage ─────────────────────────────────────────────────────
select pg_temp.assert((select count(*) from app.module_tables where module_key is null and table_name in ('demo_packs','center_demo_state')) = 2,
  'demo_packs and center_demo_state are core platform tables in module_tables');
select pg_temp.assert((select count(*) from pg_trigger where tgname in ('audit_demo_packs','audit_center_demo_state')) = 2, 'both new tables are audited');
select pg_temp.assert((select version = 1 and jsonb_array_length(contents) >= 15 from app.demo_packs where key = 'community'),
  'the community pack is in the catalog with its contents per module');
select pg_temp.assert((select count(distinct m->>'module') from app.demo_packs p, jsonb_array_elements(p.contents) m where p.key = 'community')
                      = (select count(*) from app.modules), 'the pack has data for every module');
select pg_temp.assert(jsonb_array_length(app.demo_pack_steps('community')) = 10, 'a load runs in ten steps');
select pg_temp.assert(app.demo_id('29000000-0000-4000-8000-000000000099', 'x') = app.demo_id('29000000-0000-4000-8000-000000000099', 'x')
                      and app.demo_id('29000000-0000-4000-8000-000000000099', 'x') <> app.demo_id('29000000-0000-4000-8000-000000000098', 'x'),
  'record ids are stable within a load and differ between loads');

-- ── The guard ────────────────────────────────────────────────────────────────
select pg_temp.assert(app.demo_center_problem(:sbx) is null, 'an onboarding sandbox may hold demo data');
select pg_temp.assert(app.demo_center_problem(:prod) like 'Demo data is only for sandboxes.%', 'a production organization may not');
select pg_temp.assert(app.demo_center_problem(:jsh) like 'Demo data is only for sandboxes.%', 'JSH (production) may not');
select pg_temp.assert(app.demo_center_problem(:promoted) like 'Demo data is only for sandboxes%promoted%', 'a promoted sandbox may not');

begin;
select pg_temp.claims(:owner, true);
select pg_temp.assert_raises($$select app.activate_demo_pack('29000000-0000-4000-8000-0000000000c2', 'community', 'try')$$,
  'Only the owner or an administrator with settings.manage', 'someone without settings.manage in production is refused before anything else');
rollback;
begin;
insert into app.accounts (user_id, is_platform_admin) values (:admin, true) on conflict (user_id) do update set is_platform_admin = true;
select pg_temp.claims(:admin, true);
select pg_temp.assert_raises($$select app.activate_demo_pack('00000000-0000-4000-8000-000000000001', 'community', 'try')$$,
  'Demo data is only for sandboxes', 'a platform admin cannot load demo data into JSH');
select pg_temp.assert_raises($$select app.clear_sandbox('00000000-0000-4000-8000-000000000001', 'JSH', 'try')$$,
  'Demo data is only for sandboxes', 'a platform admin cannot clear JSH');
select pg_temp.assert_raises($$select app.reset_sandbox('29000000-0000-4000-8000-0000000000c3', 'community', 'DM2', 'try')$$,
  'Demo data is only for sandboxes', 'a promoted sandbox cannot be reset');
rollback;
begin;
select pg_temp.no_claims();
select pg_temp.assert_raises($$select app.demo_clear_center('00000000-0000-4000-8000-000000000001')$$,
  'Demo data is only for sandboxes', 'the clearing function itself refuses a production center (no session at all)');
rollback;
begin;
set local role connect_worker;
select pg_temp.assert_raises($$select app.demo_clear_center('00000000-0000-4000-8000-000000000001')$$, 'permission denied', 'the worker cannot call the clearing function directly');
rollback;
begin;
-- Even a forged "clearing" state for JSH (written straight to the table) cannot make the worker clear it.
insert into app.center_demo_state (center_id, status, operation, reason) values ('00000000-0000-4000-8000-000000000001', 'clearing', 'clear', 'forged');
set local role connect_worker;
select pg_temp.assert_raises($$select app.worker_demo_clear('00000000-0000-4000-8000-000000000001')$$, 'Demo data is only for sandboxes',
  'a forged clear request for a production center is refused by the database');
rollback;
select pg_temp.assert((select count(*) from app.people where center_id = '00000000-0000-4000-8000-000000000001') >= 0
                      and not exists (select 1 from app.center_demo_state where center_id = '00000000-0000-4000-8000-000000000001'),
  'and nothing of JSH changed');
select pg_temp.assert_raises($$select app.worker_demo_load_next('29000000-0000-4000-8000-0000000000c1')$$, 'Only the background service',
  'only the background service runs a load');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.demo_clear_center(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.worker_demo_clear(uuid)', 'execute')
                      and has_function_privilege('connect_worker', 'app.worker_demo_clear(uuid)', 'execute'),
  'signed-in users cannot call the clearing functions; the worker can');
insert into app.points_ledger (center_id, person_id, points, reason) values (:sbx, '29000000-0000-4000-8000-0000000000e3', 5, 'welcome');
select pg_temp.assert_raises($$delete from app.points_ledger where center_id = '29000000-0000-4000-8000-0000000000c1'$$, 'append-only',
  'points stay append-only outside a sandbox clear, even in a sandbox');

-- ── Permissions and checks ───────────────────────────────────────────────────
begin;
select pg_temp.claims(:member, true);
select pg_temp.assert_raises($$select app.activate_demo_pack('29000000-0000-4000-8000-0000000000c1', 'community', 'try')$$,
  'Only the owner or an administrator with settings.manage', 'a member without settings.manage cannot load demo data');
select pg_temp.claims(:owner, true);
select pg_temp.assert_raises($$select app.activate_demo_pack('29000000-0000-4000-8000-0000000000c1', 'community', ' ')$$, 'Give a reason', 'a reason is required');
select pg_temp.assert_raises($$select app.activate_demo_pack('29000000-0000-4000-8000-0000000000c1', 'nope', 'try')$$, 'no demo pack', 'an unknown pack is refused');
select pg_temp.assert_raises($$select app.clear_sandbox('29000000-0000-4000-8000-0000000000c1', 'wrong', 'try')$$, 'Type DMO to confirm', 'clear needs the short name typed');
select pg_temp.claims(:owner, false);
select pg_temp.assert_raises($$select app.clear_sandbox('29000000-0000-4000-8000-0000000000c1', 'dmo', 'try')$$, 'fresh 2FA check', 'clear needs a fresh 2FA check');
select pg_temp.assert_raises($$select app.reset_sandbox('29000000-0000-4000-8000-0000000000c1', 'community', 'DMO', 'try')$$, 'fresh 2FA check', 'reset needs a fresh 2FA check');
rollback;

-- ── Activate ─────────────────────────────────────────────────────────────────
begin;
select pg_temp.claims(:owner);
select app.activate_demo_pack(:sbx, 'community', 'Show the team every module') as job \gset
commit;
select pg_temp.assert((select status = 'loading' and operation = 'activate' and steps_total = 10 and job_id = :job and requested_by = :owner
                         and reason = 'Show the team every module' from app.center_demo_state where center_id = :sbx),
  'activating queues a load: status loading, 10 steps, the job and who asked');
select pg_temp.assert((select kind = 'demo.load' and status = 'queued' and payload->>'pack' = 'community' from app.jobs where id = :job), 'a demo.load job is queued');
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'center_demo_state' and actor_user_id = :owner
                         and reason = 'Demo data · load Demo community: Show the team every module') >= 1
                      and not exists (select 1 from app.audit_log where record_table = 'center_demo_state' and actor_user_id = :owner and reason is null),
  'audit: the request, with its reason on every row');
begin;
select pg_temp.claims(:owner);
select pg_temp.assert_raises($$select app.activate_demo_pack('29000000-0000-4000-8000-0000000000c1', 'community', 'again')$$, 'being loaded right now',
  'a second request waits for the first');
rollback;
begin;
set local role connect_worker;
select (pg_temp.run_load(:sbx))->>'status' as st \gset
commit;
select pg_temp.assert(:'st' = 'loaded', 'the worker runs the ten steps and the pack is loaded');
select pg_temp.assert((select status = 'loaded' and steps_done = 10 and loaded_by = :owner and loaded_at is not null from app.center_demo_state where center_id = :sbx),
  'the state shows loaded, by whom and when');
select pg_temp.assert((select detail->'loaded' from app.center_demo_state where center_id = :sbx) = pg_temp.pack_rows(),
  'the rows loaded are exactly the pack''s contents, table by table');
select pg_temp.assert((select count(*) from app.people where center_id = :sbx and email like '%@demo.communityconnect.test') = 55
                      and not exists (select 1 from app.people where center_id = :sbx and email is not null and email not like '%@demo.communityconnect.test'
                                        and email not like '%@templeexample.test'),
  'every demo e-mail address ends in @demo.communityconnect.test');
select pg_temp.assert((select count(*) from app.payments where center_id = :sbx) = 43
                      and not exists (select 1 from app.payments where center_id = :sbx and not is_historical)
                      and not exists (select 1 from app.ledger_postings where center_id = :sbx),
  'every demo payment is historical, so nothing is queued for QuickBooks');
select pg_temp.assert(not exists (select 1 from app.pledges pl where pl.center_id = :sbx
                                   and pl.paid_cents <> coalesce((select sum(a.amount_cents) from app.payment_allocations a where a.pledge_id = pl.id), 0)),
  'every pledge''s paid amount is the sum of its allocations (the recompute rule)');
select pg_temp.assert((select count(*) from app.pledges where center_id = :sbx and status = 'paid') > 30
                      and (select count(*) from app.pledges where center_id = :sbx and status = 'partially_paid') > 3
                      and (select count(*) from app.pledges where center_id = :sbx and status = 'open') > 3,
  'pledges are paid, partly paid and open');
select pg_temp.assert((select sum(a.amount_cents) from app.payment_allocations a join app.payments p on p.id = a.payment_id where p.center_id = :sbx)
                      <= (select sum(amount_cents) from app.payments where center_id = :sbx),
  'no payment is allocated beyond its amount');
select pg_temp.assert((select count(*) from app.store_orders where center_id = :sbx and status = 'picked_up') = 5
                      and (select stock_on_hand from app.store_items where center_id = :sbx and sku = 'DEMO-101') = 36
                      and (select total_cents from app.store_orders o where o.center_id = :sbx and o.status = 'picked_up' and o.person_id in
                            (select id from app.people where email = 'priya.shah@demo.communityconnect.test')) = 2397,
  'store orders went through the store rules: priced by the database, stock taken and returned on a cancel');
select pg_temp.assert((select count(*) from app.attendees a where a.center_id = :sbx and a.lunch_slot_id is not null) > 20
                      and not exists (select 1 from app.messages where center_id = :sbx and status = 'queued'),
  'lunch seats came from the lunch rule, and nothing is left queued to send');
select pg_temp.assert((select count(*) from app.events where center_id = :sbx and starts_at > now()) = 3
                      and (select count(*) from app.events where center_id = :sbx and status = 'completed') = 2,
  'dates are relative to today: three upcoming events, two past ones');
select pg_temp.assert((select count(*) from app.center_users cu join app.people p on p.id = cu.person_id
                        where cu.center_id = :sbx and cu.user_id = :demo_login and p.email = 'priya.shah@demo.communityconnect.test') = 1,
  'a login that already exists for a demo e-mail is linked to that demo person');
select pg_temp.assert((select count(*) from app.audit_log where center_id = :sbx and client_app = 'job' and record_table = 'people'
                         and action = 'people.insert' and reason like 'Demo data · Demo community · Households and people: Show the team every module') = 76,
  'audit: every demo person is recorded as a job change with the step and the admin''s reason');
begin;
select pg_temp.claims(:owner);
select pg_temp.assert_raises($$select app.activate_demo_pack('29000000-0000-4000-8000-0000000000c1', 'community', 'again')$$, 'already loaded',
  'activating twice is refused: reset instead');
rollback;

-- ── Reset: clear everything, then load again ─────────────────────────────────
select count(*) as audit_before from app.audit_log \gset
-- The organization adds a few things of its own meanwhile.
insert into app.households (center_id, display_name) values (:sbx, 'Typed-in family');
insert into app.funds (center_id, key, name) values (:sbx, 'typed', 'Typed-in fund');
begin;
select pg_temp.claims(:owner, true);
select app.reset_sandbox(:sbx, 'community', ' dmo ', 'Start the training again') as job2 \gset
commit;
select pg_temp.assert((select status = 'clearing' and operation = 'reset' and job_id = :job2 from app.center_demo_state where center_id = :sbx)
                      and (select kind = 'demo.clear' and payload->>'then_load' = 'community' from app.jobs where id = :job2),
  'reset (short name typed in any case, fresh 2FA) queues demo.clear, which will load the pack again');
begin;
set local role connect_worker;
select app.worker_demo_clear(:sbx) as cleared \gset
commit;
select pg_temp.assert((:'cleared'::jsonb->>'removed_total')::int > 2000 and (:'cleared'::jsonb->>'kept_logins')::int = 2,
  'the clear removed the records and kept the two logins with a role');
select pg_temp.assert((select status = 'loading' and cleared_by = :owner from app.center_demo_state where center_id = :sbx)
                      and exists (select 1 from app.jobs where kind = 'demo.load' and center_id = :sbx and status = 'queued' and id > :job2),
  'after the clear, the load is queued');
select pg_temp.assert((select count(*) from app.people where center_id = :sbx) = 2
                      and exists (select 1 from app.people where id = '29000000-0000-4000-8000-0000000000e1')
                      and exists (select 1 from app.people where id = '29000000-0000-4000-8000-0000000000e2')
                      and (select count(*) from app.households where center_id = :sbx) = 2,
  'only the owner and the administrator (and their households) are left; the member without a role and every demo family are gone');
select pg_temp.assert(not exists (select 1 from app.zones where center_id = :sbx) and not exists (select 1 from app.funds where center_id = :sbx)
                      and not exists (select 1 from app.payments where center_id = :sbx) and not exists (select 1 from app.points_ledger where center_id = :sbx),
  'setup data, money and points the organization typed in are cleared too');
select pg_temp.assert((select mission from app.org_profiles where center_id = :sbx) = 'Our own mission'
                      and exists (select 1 from app.integration_connections where center_id = :sbx and provider = 'stripe')
                      and exists (select 1 from app.legal_documents where center_id = :sbx and kind = 'privacy')
                      and exists (select 1 from app.center_modules where center_id = :sbx and module_key = 'niva' and not enabled)
                      and exists (select 1 from app.center_owners where center_id = :sbx and user_id = :owner)
                      and (select count(*) from app.role_grants where center_id = :sbx and status = 'active') = 2,
  'kept: the profile, connections, legal documents, module switches, the owner and the role grants');
select pg_temp.assert((select count(*) from app.audit_log) > :audit_before
                      and (select count(*) from app.audit_log where center_id = :sbx and action = 'people.delete'
                             and reason = 'Demo data · reset the sandbox: Start the training again' and client_app = 'job') = 77,
  'audit: every removed person is logged with the reason; the audit log itself only grows');
begin;
set local role connect_worker;
select (pg_temp.run_load(:sbx))->>'status' as st2 \gset
commit;
select pg_temp.assert(:'st2' = 'loaded' and (select detail->'loaded' from app.center_demo_state where center_id = :sbx) = pg_temp.pack_rows(),
  'after the reset the counts are the pack''s again, table by table');
select pg_temp.assert((select count(*) from app.people where center_id = :sbx) = 78, 'people: the pack''s 76 plus the two kept staff');

-- ── Clear only ───────────────────────────────────────────────────────────────
begin;
select pg_temp.claims(:admin, true);
select app.clear_sandbox(:sbx, 'DMO', 'Our real data comes next') as job3 \gset
set local role connect_worker;
select app.worker_demo_clear(:sbx) as cleared3 \gset
commit;
select pg_temp.assert((select status = 'empty' and pack_key is null and cleared_by = :admin from app.center_demo_state where center_id = :sbx)
                      and not exists (select 1 from app.jobs where kind = 'demo.load' and center_id = :sbx and id > :job3),
  'clear (by the second administrator) leaves the sandbox empty and loads nothing');
select pg_temp.no_claims();
select pg_temp.assert(app.demo_data_counts(:sbx) = '{"people": 2, "households": 2, "household_members": 2, "center_users": 2}'::jsonb,
  'only the two staff members'' own records are left');

-- ── A live organization stays protected even if it were marked sandbox by mistake ──
-- A center that is live (status active) stays protected even if its environment says sandbox.
update app.centers set environment = 'sandbox' where id = :prod;
update app.centers set status = 'active' where id = :prod;
select pg_temp.assert(app.demo_center_problem(:prod) like 'Demo data is only for sandboxes.%live%', 'a live organization is refused even if marked sandbox');
update app.centers set environment = 'production' where id = :prod;
