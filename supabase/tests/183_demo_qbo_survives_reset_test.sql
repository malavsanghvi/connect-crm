-- 0785: a demo community keeps its QuickBooks setup across a reset (docs/DEMO_QUICKBOOKS.md).
--   A. A reset keeps the account mapping, its approvals and the poster's readiness; the fund's QuickBooks class is put back
--   B. A link that cannot be put back (the bank account is not in the pack) is skipped, never stops the reset; a second reset is the same
--   C. Every other sandbox still clears its mapping exactly as before
--   D. The new table: kept by a clear, audited, mapped to the core platform, closed to users
-- Everything runs in one transaction that is rolled back, so no demo community is left behind for the tests that follow.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
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
  perform set_config('request.headers', '{"x-client-app":"portal","x-client-screen":"/accounting/qbo/mapping"}', true);
end $$;
create or replace function pg_temp.no_claims() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '', true); end $$;
-- Rows the pack says a table gets, against the rows the community really has (empty text = all the same).
create or replace function pg_temp.pack_vs_rows(p_center uuid, p_pack text) returns text language plpgsql as $$
declare r record; n bigint; bad text := '';
begin
  for r in
    select o->>'t' as t, sum(case when o ? 'rows' then jsonb_array_length(o->'rows') else 1 end) as want
      from app.demo_packs p, jsonb_each(p.content->'steps') s, jsonb_array_elements(s.value) o
     where p.key = p_pack and o ? 't' group by 1 order by 1
  loop
    -- gyan_levels and gyan_steps carry no center_id (they belong to a goal of the community): counted through the goal, as app.demo_counts_raw does
    execute format('select count(*) from app.%I x where %s', r.t,
                   case r.t when 'gyan_levels' then 'x.goal_id in (select g.id from app.gyan_goals g where g.center_id = $1)'
                            when 'gyan_steps' then 'x.level_id in (select l.id from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id where g.center_id = $1)'
                            else 'x.center_id = $1' end) into n using p_center;
    if n <> r.want then bad := bad || r.t || ' (' || n || ' instead of ' || r.want || ') '; end if;
  end loop;
  return bad;
end $$;

\set pat '''18300000-0000-4000-8000-000000000001'''
\set tara '''18300000-0000-4000-8000-000000000002'''
\set conn '''18300000-0000-4000-8000-0000000000e1'''
\set bank '''18300000-0000-4000-8000-0000000000b1'''

select pg_temp.no_claims();
insert into auth.users (id, email) values (:pat, 'pat183@platform.test'), (:tara, 'tara183@demo-qbo.test');
insert into app.accounts (user_id, is_platform_admin) values (:pat, true) on conflict (user_id) do update set is_platform_admin = true;

-- ── The faith demo community, and a treasurer who sets QuickBooks up in it ───
select pg_temp.claims(:pat, true);
select app.create_demo_community('faith') as r \gset
select pg_temp.no_claims();
select (:'r'::jsonb)->>'center_id' as fc \gset
select pg_temp.assert(app.is_demo_center(:'fc') and app.module_enabled(:'fc', 'accounting'),
  'the faith demo community exists and has the Accounting module, so QuickBooks can be used in it');
select id as gen_fund from app.funds where center_id = :'fc' and key = 'general' \gset
insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id) values (:'fc', :tara, 'treasurer', 'center', null);

-- The connection is an Intuit sandbox company (a sandbox community posts to nothing else), pulled and on the cash basis.
insert into app.integration_connections (id, center_id, provider, status, external_account_id, display_name, settings)
values (:conn, :'fc', 'intuit_sandbox', 'connected', 'R183', 'Demo books (Intuit sandbox)',
        jsonb_build_object('mode', 'test', 'read_only', false, 'company', 'sandbox', 'basis', 'cash', 'posting', 'per_txn',
                           'go_live_date', to_char(current_date - 30, 'YYYY-MM-DD')));
insert into app.qbo_accounts (center_id, connection_id, qbo_id, name, account_type, active) values
  (:'fc', :conn, '1', 'Donations', 'Income', true), (:'fc', :conn, '2', 'Chase Operating', 'Bank', true),
  (:'fc', :conn, '3', 'Undeposited Funds', 'Other Current Asset', true), (:'fc', :conn, '4', 'Stripe Clearing', 'Bank', true),
  (:'fc', :conn, '5', 'Merchant Fees', 'Expense', true), (:'fc', :conn, '7', 'Store Sales', 'Income', true),
  (:'fc', :conn, '8', 'Sales Tax Payable', 'Other Current Liability', true), (:'fc', :conn, '22', 'Chase Savings', 'Bank', true);
insert into app.qbo_items (center_id, connection_id, qbo_id, name, active, raw) values
  (:'fc', :conn, '20', 'Donation', true, '{"Type":"Service","IncomeAccountRef":{"value":"1"}}'),
  (:'fc', :conn, '23', 'Store item', true, '{"Type":"Service","IncomeAccountRef":{"value":"7"}}');
insert into app.qbo_classes (center_id, connection_id, qbo_id, name, active) values (:'fc', :conn, '30', 'General fund', true);
insert into app.qbo_pull_runs (center_id, connection_id, status, finished_at) values (:'fc', :conn, 'succeeded', now());
-- A bank account the pack does not have (so it goes with the clear), linked to a QuickBooks bank account.
insert into app.bank_accounts (id, center_id, name, institution, last4, statement_format)
values (:bank, :'fc', 'Chase operating (demo)', 'Chase', '1830', 'chase_csv');
select app._apply_account_mapping(:'fc', 'bank_account', :bank, '22', 'setup');

select pg_temp.claims(:tara, true);
set local role authenticated;
select app.request_account_mapping_change(:'fc', 'role', 'income.general', '1', 'Initial mapping');
select app.request_account_mapping_change(:'fc', 'role', 'bank', '2', 'Initial mapping');
select app.request_account_mapping_change(:'fc', 'role', 'undeposited_funds', '3', 'Initial mapping');
select app.request_account_mapping_change(:'fc', 'role', 'processor_clearing', '4', 'Initial mapping');
select app.request_account_mapping_change(:'fc', 'role', 'merchant_fees', '5', 'Initial mapping');
select app.request_account_mapping_change(:'fc', 'role', 'store.sales', '7', 'Initial mapping');
select app.request_account_mapping_change(:'fc', 'role', 'sales_tax_payable', '8', 'Initial mapping');
select app.request_account_mapping_change(:'fc', 'fund_class', :'gen_fund', '30', 'General fund class');
select app.approve_qbo_mapping(:'fc', 'Checked against the demo chart of accounts');
reset role;
select pg_temp.no_claims();
update app.integration_connections set settings = settings || jsonb_build_object('test_post_approved_at', now(), 'test_post_approved_by', :tara) where id = :conn;

select pg_temp.assert(app.account_mapping_in_use(:'fc') and (app.qbo_post_ready(:'fc')->>'ok')::boolean
                      and (select count(*) = 7 and bool_and(first_approved_at is not null and approved_at is not null)
                             from app.qbo_account_mappings where center_id = :'fc')
                      and (select qbo_class_id = '30' and qbo_class_realm = 'R183' from app.funds where id = :'gen_fund'),
  'before the reset: seven accounts mapped and approved, the General fund has its class, and the poster is ready');

-- ═════════════════════════════════════════════════════════════════════════════
-- A. A reset (the platform admin's, with her fresh 2FA check) keeps the setup
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.claims(:pat, true);
select app.reset_demo_community(:'fc') as rr \gset
select pg_temp.no_claims();
select pg_temp.assert(pg_temp.pack_vs_rows(:'fc', 'demo_faith_jain_v1') = '', 'the reset loaded the pack again: every table holds exactly the rows the pack says');
select pg_temp.assert((select count(*) = 7 and bool_and(first_approved_at is not null and approved_at is not null and realm_id = 'R183')
                         from app.qbo_account_mappings where center_id = :'fc')
                      and app.account_mapping_in_use(:'fc'),
  'the account mapping is still there after the reset, still approved, still in the same QuickBooks company');
select pg_temp.assert((select qbo_class_id = '30' and qbo_class_realm = 'R183' from app.funds where id = :'gen_fund')
                      and (select count(*) = 1 from app.funds where center_id = :'fc' and qbo_class_id is not null),
  'the General fund has its QuickBooks class again (the same fund id: record ids are stable), and no other fund got one');
select pg_temp.assert((app.qbo_post_ready(:'fc')->>'ok')::boolean,
  'QuickBooks posting is still ready after the reset: no one has to map and approve again');
select pg_temp.assert((select status = 'loaded' and last_error is null and (detail->'quickbooks'->>'restored')::int = 1
                         from app.center_demo_state where center_id = :'fc'),
  'the demo state says one QuickBooks link was put back');

-- ═════════════════════════════════════════════════════════════════════════════
-- B. A link that cannot be put back is skipped; a second reset gives the same answer
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert((select (detail->'quickbooks'->>'skipped')::int = 1 from app.center_demo_state where center_id = :'fc')
                      and not exists (select 1 from app.bank_accounts where id = :bank),
  'the bank account is not in the pack, so it went with the clear and its link was skipped without stopping the reset');
select pg_temp.claims(:pat, true);
select app.reset_demo_community(:'fc') as rr2 \gset
select pg_temp.no_claims();
select pg_temp.assert((select count(*) = 7 from app.qbo_account_mappings where center_id = :'fc')
                      and (select qbo_class_id = '30' from app.funds where id = :'gen_fund')
                      and (app.qbo_post_ready(:'fc')->>'ok')::boolean
                      and pg_temp.pack_vs_rows(:'fc', 'demo_faith_jain_v1') = '',
  'a second reset leaves the same QuickBooks setup and the same pack data');

-- ═════════════════════════════════════════════════════════════════════════════
-- C. Every other sandbox clears its mapping, as before
-- ═════════════════════════════════════════════════════════════════════════════
select app._create_sandbox_center('plain183', 'Plain sandbox 183', 'TX', 'Dallas', null, '{}'::jsonb) as plain \gset
set local session_replication_role = replica;
insert into app.qbo_account_mappings (center_id, purpose, qbo_account_id, qbo_account_name) values (:'plain', 'income.general', '1', 'Donations');
set local session_replication_role = origin;
select pg_temp.assert(not app.is_demo_center(:'plain') and exists (select 1 from app.qbo_account_mappings where center_id = :'plain'),
  'an ordinary sandbox with a mapping (not a demo community)');
select app.demo_clear_center(:'plain');
select pg_temp.assert(not exists (select 1 from app.qbo_account_mappings where center_id = :'plain'),
  'clearing an ordinary sandbox still removes its mapping (only a demo community keeps it)');

-- ═════════════════════════════════════════════════════════════════════════════
-- D. The new table
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert('demo_qbo_links' = any (app.demo_keep_tables()) and 'demo_qbo_links' <> all (app.demo_clear_tables())
                      and 'qbo_account_mappings' = any (app.demo_clear_tables()),
  'a clear keeps demo_qbo_links; the mapping table is still a clearable table (the rule is per community, in the filter)');
select pg_temp.assert(exists (select 1 from pg_trigger t where t.tgrelid = 'app.demo_qbo_links'::regclass and t.tgname = 'audit_demo_qbo_links')
                      and exists (select 1 from app.module_tables where table_name = 'demo_qbo_links' and module_key is null)
                      and (select relrowsecurity from pg_class where oid = 'app.demo_qbo_links'::regclass)
                      and not has_table_privilege('authenticated', 'app.demo_qbo_links', 'select')
                      and not has_table_privilege('anon', 'app.demo_qbo_links', 'select'),
  'demo_qbo_links is audited, mapped to the core platform, behind RLS, and closed to signed-in users and visitors');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.demo_qbo_save(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.demo_qbo_restore(uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.demo_qbo_restore(uuid)', 'execute'),
  'saving and restoring the links is not callable by users');
select pg_temp.assert(app.demo_qbo_save('00000000-0000-4000-8000-000000000001') = 0
                      and (app.demo_qbo_restore('00000000-0000-4000-8000-000000000001')->>'restored')::int = 0
                      and not exists (select 1 from app.demo_qbo_links where center_id = '00000000-0000-4000-8000-000000000001'),
  'for a community that is not a demo community both do nothing, whatever it holds');

rollback;
\echo 'PASS: a demo community keeps its QuickBooks setup across a reset'
