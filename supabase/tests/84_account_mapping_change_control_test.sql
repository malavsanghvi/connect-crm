-- 0606 (owner priority 3a, docs/FUND_ACCOUNT_MAPPING_GAPS.md): which QuickBooks account each fund and role posts to.
-- Setup unchanged (one person, then the treasurer approves the whole mapping); once in use a change is a request that a
-- second, different person with giving.approve confirms (a fresh 2FA check and a reason each); guards close every other
-- signed-in route; a fund without an account blocks its posting (no silent default) and the posting goes back in the
-- queue once the account is confirmed; posted entries keep their accounts; a switched QuickBooks company invalidates
-- the old choices; one organization cannot see or decide another's; the account roles catalog and the resolvers.
-- Everything runs in one transaction on fresh organizations and is rolled back at the end.
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
create or replace function pg_temp.assert_state(stmt text, state text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if sqlstate <> state then raise exception 'FAIL: % (got % "%")', label, sqlstate, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.claims(p_user text, p_step_up boolean default false) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', case when p_step_up then 'aal2' else 'aal1' end,
    'amr', case when p_step_up
                then jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 3600),
                                       jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 60))
                else jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 60)) end)::text, true);
  perform set_config('request.headers', '{"x-client-app":"portal","x-client-screen":"/accounting/qbo/mapping"}', true);
end $$;
create or replace function pg_temp.no_claims() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
end $$;
create or replace function pg_temp.req_status(p_request uuid) returns text language sql as $$
  select status from app.account_mapping_changes where id = p_request
$$;
create or replace function pg_temp.mapped(p_center uuid, p_purpose text) returns text language sql as $$
  select qbo_account_id from app.qbo_account_mappings where center_id = p_center and purpose = p_purpose
$$;
create or replace function pg_temp.posting(p_source uuid) returns app.ledger_postings language sql as $$
  select * from app.ledger_postings where source_id = p_source order by created_at desc limit 1
$$;
-- The poster's claim, as the background service (no signed-in person).
create or replace function pg_temp.claim(p_center uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', '', true);
  set local role connect_worker;
  v := app.qbo_worker_claim(p_center, 25);
  reset role;
  return v;
end $$;
create or replace function pg_temp.done(p_posting uuid, p_ref text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  set local role connect_worker;
  perform app.qbo_worker_posting_done(array[p_posting], 'SalesReceipt', p_ref, null);
  reset role;
end $$;
-- The unit of a claim for a posting.
create or replace function pg_temp.unit_of(p_claim jsonb, p_posting uuid) returns jsonb language sql as $$
  select u from jsonb_array_elements(p_claim->'units') u where u->'posting_ids' ? p_posting::text limit 1
$$;

\set c '''00000000-0000-4000-8000-000000008301'''
\set cb '''00000000-0000-4000-8000-000000008302'''
\set ami '''83000000-0000-4000-8000-000000000001'''
\set tanu '''83000000-0000-4000-8000-000000000002'''
\set tara '''83000000-0000-4000-8000-000000000003'''
\set basil '''83000000-0000-4000-8000-000000000004'''
\set vik '''83000000-0000-4000-8000-000000000005'''
\set mira '''83000000-0000-4000-8000-000000000006'''
\set pat '''83000000-0000-4000-8000-000000000007'''
\set nik '''83000000-0000-4000-8000-000000000008'''
\set bea '''83000000-0000-4000-8000-000000000009'''
\set gus '''83000000-0000-4000-8000-000000000010'''
\set conn '''83000000-0000-4000-8000-0000000000e1'''
\set f1 '''83000000-0000-4000-8000-0000000000f1'''
\set f2 '''83000000-0000-4000-8000-0000000000f2'''
\set f3 '''83000000-0000-4000-8000-0000000000f3'''
\set ba1 '''83000000-0000-4000-8000-0000000000b1'''
\set ba2 '''83000000-0000-4000-8000-0000000000b2'''
\set h1 '''83000000-0000-4000-8000-0000000000a1'''
\set cp1 '''83000000-0000-4000-8000-0000000000d1'''
-- Users: 01 Ami (center admin, becomes the owner), 02 Tanu and 03 Tara (treasurers: accounting.manage and giving.approve),
-- 04 Basil (a second center admin: no accounting.manage, no giving.approve), 05 Vik (finance volunteer), 06 Mira (a member),
-- 07 Pat (Community Connect platform admin, with an authenticator app), 08 Nik (treasurer of the other organization cb),
-- 09 Bea (a bookkeeper: accounting.manage only), 10 Gus (an approver: giving.approve only).
-- Organizations: c (everything), cb (another organization: tenant isolation).

begin;
insert into auth.users (id, email) values
  ('83000000-0000-4000-8000-000000000001', 'ami83@am.example'), ('83000000-0000-4000-8000-000000000002', 'tanu83@am.example'),
  ('83000000-0000-4000-8000-000000000003', 'tara83@am.example'), ('83000000-0000-4000-8000-000000000004', 'basil83@am.example'),
  ('83000000-0000-4000-8000-000000000005', 'vik83@am.example'), ('83000000-0000-4000-8000-000000000006', 'mira83@am.example'),
  ('83000000-0000-4000-8000-000000000007', 'pat83@am.example'), ('83000000-0000-4000-8000-000000000008', 'nik83@am.example'),
  ('83000000-0000-4000-8000-000000000009', 'bea83@am.example'), ('83000000-0000-4000-8000-000000000010', 'gus83@am.example');
insert into app.centers (id, slug, name, short_name) values (:c, 'am83', 'Mapping Test Temple', 'MTT83'), (:cb, 'am83b', 'Other Mapping Temple', 'OMT83');
insert into app.accounts (user_id, is_platform_admin) values (:pat, true);
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status) values
  ('83000000-0000-4000-8000-0000000000ff', :pat, 'Phone', 'totp', 'verified');
insert into app.roles (key, tier, name, description, permissions) values
  ('t83_bookkeeper', 'center', 'Bookkeeper (test 84)', 'Maps QuickBooks accounts only', '["accounting.manage"]'),
  ('t83_approver', 'center', 'Approver (test 84)', 'Second approver only', '["giving.approve"]');
insert into app.households (id, center_id, display_name) values (:h1, :c, 'Shah family');
insert into app.people (id, center_id, first_name, last_name, email, date_of_birth) values
  ('83000000-0000-4000-8000-0000000000c1', :c, 'Mira', 'Shah', 'mira83@am.example', '1980-04-04');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, '83000000-0000-4000-8000-0000000000c1', :c, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values (:c, :mira, '83000000-0000-4000-8000-0000000000c1');
-- Ami first: the first active center admin is the owner.
insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id) values (:c, :ami, 'center_admin', 'center', null);
insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id) values
  (:c, :basil, 'center_admin', 'center', null), (:c, :tanu, 'treasurer', 'center', null), (:c, :tara, 'treasurer', 'center', null),
  (:c, :vik, 'finance_volunteer', 'center', null), (:c, :bea, 't83_bookkeeper', 'center', null), (:c, :gus, 't83_approver', 'center', null),
  (:cb, :nik, 'treasurer', 'center', null);

-- Organization c: funds, a boli campaign, two bank accounts, QuickBooks connected (company R83A) on cash basis, the chart pulled.
insert into app.funds (id, center_id, key, name, restricted) values
  (:f1, :c, 'general', 'General fund', false), (:f2, :c, 'construction', 'Temple construction', true),
  (:f3, :c, 'deva_dravya', 'Deva Dravya', true),
  ('83000000-0000-4000-8000-0000000000f4', :cb, 'general', 'General fund', false);
insert into app.campaigns (id, center_id, fund_id, name, kind, status) values (:cp1, :c, :f3, 'Paryushan bolis', 'boli', 'published');
insert into app.bank_accounts (id, center_id, name, institution, last4, statement_format) values
  (:ba1, :c, 'Chase operating', 'Chase', '8301', 'chase_csv'), (:ba2, :c, 'Chase savings', 'Chase', '8302', 'generic_csv');
insert into app.integration_connections (id, center_id, provider, status, external_account_id, display_name, settings)
values (:conn, :c, 'quickbooks_online', 'connected', 'R83A', 'Mapping Test Temple books',
        jsonb_build_object('mode', 'live', 'read_only', false, 'company', 'real', 'basis', 'cash', 'posting', 'per_txn',
                           'go_live_date', to_char(current_date - 60, 'YYYY-MM-DD')));
insert into app.qbo_accounts (center_id, connection_id, qbo_id, name, account_type, active) values
  (:c, :conn, '1', 'Donations', 'Income', true), (:c, :conn, '2', 'Chase Operating', 'Bank', true),
  (:c, :conn, '3', 'Undeposited Funds', 'Other Current Asset', true), (:c, :conn, '4', 'Stripe Clearing', 'Bank', true),
  (:c, :conn, '5', 'Merchant Fees', 'Expense', true), (:c, :conn, '6', 'Old Income', 'Income', false),
  (:c, :conn, '7', 'Store Sales', 'Income', true), (:c, :conn, '8', 'Sales Tax Payable', 'Other Current Liability', true),
  (:c, :conn, '9', 'Office Supplies', 'Expense', true), (:c, :conn, '12', 'Boli Income', 'Income', true),
  (:c, :conn, '13', 'Dues Income', 'Income', true), (:c, :conn, '14', 'Unitemized Income', 'Income', true),
  (:c, :conn, '15', 'Donations 2027', 'Income', true), (:c, :conn, '16', 'Pathshala Fees', 'Income', true),
  (:c, :conn, '22', 'Chase Savings', 'Bank', true);
insert into app.qbo_items (center_id, connection_id, qbo_id, name, active, raw) values
  (:c, :conn, '20', 'Donation', true, '{"Type":"Service","IncomeAccountRef":{"value":"1"}}'),
  (:c, :conn, '21', 'Boli', true, '{"Type":"Service","IncomeAccountRef":{"value":"12"}}'),
  (:c, :conn, '22', 'Dues', true, '{"Type":"Service","IncomeAccountRef":{"value":"13"}}'),
  (:c, :conn, '23', 'Store item', true, '{"Type":"Service","IncomeAccountRef":{"value":"7"}}'),
  (:c, :conn, '24', 'Donation 2027', true, '{"Type":"Service","IncomeAccountRef":{"value":"15"}}'),
  (:c, :conn, '25', 'Pathshala fee', true, '{"Type":"Service","IncomeAccountRef":{"value":"16"}}');
insert into app.qbo_classes (center_id, connection_id, qbo_id, name, active) values
  (:c, :conn, '30', 'General', true), (:c, :conn, '31', 'Construction', true), (:c, :conn, '32', 'Retired', false),
  (:c, :conn, '33', 'Deva Dravya', true);
insert into app.qbo_pull_runs (center_id, connection_id, status, finished_at) values (:c, :conn, 'succeeded', now());

-- ═════════════════════════════════════════════════════════════════════════════
-- The catalog of account roles
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert((select count(*) from app.account_roles where active) = 22
                      and (select count(*) from app.account_roles where kind = 'fund' and active) = 10
                      and (select bool_and(key like 'income.%') from app.account_roles where kind = 'fund'),
  'catalog: ten funds (income.*) and twelve other roles');
select pg_temp.assert(app.qbo_purposes() ?& array['income.general','income.boli','income.sponsorship','income.construction','income.pathshala',
                        'income.jeevdaya','income.event','income.membership','income.store','income.other','store.sales','store.gift_packing',
                        'sales_tax_payable','merchant_fees','payment_clearing','bank','undeposited_funds','pledges_receivable','stock_clearing',
                        'pledge_writeoffs','refunds','store.cost']
                      and app.qbo_purposes()->'bank' = '["Bank"]'::jsonb
                      and app.qbo_purposes()->'pledge_writeoffs' = '["Expense","Other Expense","Income","Other Income"]'::jsonb
                      and app.qbo_purposes()->'merchant_fees' = '["Expense","Other Expense","Cost of Goods Sold"]'::jsonb,
  'catalog: every purpose of 0232 and 0412 keeps its account types; refunds and store cost of goods are new');
select pg_temp.assert(app.account_role_key('processor_clearing') = 'payment_clearing' and app.account_role_key('processor_fees') = 'merchant_fees'
                      and app.account_role_key('store_sales_income') = 'store.sales' and app.account_role_key('store_cost') = 'store.cost'
                      and app.account_role_key('refunds') = 'refunds' and app.account_role_key('dues') = 'income.membership'
                      and app.account_role_key('bank') = 'bank' and app.account_role_key('nope') is null,
  'catalog: the aliases other money streams use resolve to one role each');
select pg_temp.assert(not exists (select 1 from app.account_roles r, unnest(r.aliases) al
                                   where exists (select 1 from app.account_roles k where k.key = al)
                                      or exists (select 1 from app.account_roles o, unnest(o.aliases) a2 where o.key <> r.key and a2 = al)),
  'catalog: no alias is also a key or another role''s alias');
select pg_temp.assert(app.pledge_fund_key('membership_fee', null) = 'membership' and app.pledge_fund_key('pathshala_fee', null) = 'pathshala'
                      and app.pledge_fund_key('rsvp_commitment', null) = 'event' and app.pledge_fund_key('boli', null) = 'boli'
                      and app.pledge_fund_key('pujan', null) = 'sponsorship' and app.pledge_fund_key('general', null) = 'general'
                      and app.pledge_fund_key('recurring', null) = 'general' and app.pledge_fund_key('membership_fee', 'event') = 'event',
  'a pledge belongs to its campaign''s fund, else to the fund of its source (dues are dues, not general income)');
select pg_temp.assert((select array_agg(x order by x) from unnest(app.qbo_required_purposes(:c)) x)
                      = array['bank','income.general','merchant_fees','payment_clearing','sales_tax_payable','store.sales','undeposited_funds'],
  'what must be mapped before approval is the same set as before (cash basis, Store module on)');

-- ═════════════════════════════════════════════════════════════════════════════
-- Setup: one person chooses, as before, and it is recorded
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert(not app.account_mapping_in_use(:c), 'a mapping never approved is not in use');
select pg_temp.claims('83000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select pg_temp.assert_state($$select app.request_account_mapping_change('00000000-0000-4000-8000-000000008301', 'role', 'income.general', '1', 'Setup')$$,
  '42501', 'setup: an administrator without accounting.manage cannot choose accounts');
reset role;
select pg_temp.claims('83000000-0000-4000-8000-000000000007', true);
set local role authenticated;
select pg_temp.assert_state($$select app.request_account_mapping_change('00000000-0000-4000-8000-000000008301', 'role', 'income.general', '1', 'Support setup')$$,
  '42501', 'setup: nor a Community Connect platform admin');
reset role;
-- Tanu, without a fresh 2FA check: setup does not ask for one (as set_qbo_mapping did not).
select pg_temp.claims('83000000-0000-4000-8000-000000000002', false);
set local role authenticated;
select pg_temp.assert_raises($$select app.request_account_mapping_change('00000000-0000-4000-8000-000000008301', 'role', 'income.general', '9', 'Setup')$$,
  'needs one of', 'setup: an account of the wrong type is refused');
select pg_temp.assert_raises($$select app.request_account_mapping_change('00000000-0000-4000-8000-000000008301', 'role', 'income.general', '6', 'Setup')$$,
  'inactive', 'setup: an inactive account is refused');
select pg_temp.assert_raises($$select app.request_account_mapping_change('00000000-0000-4000-8000-000000008301', 'role', 'income.general', '99', 'Setup')$$,
  'pulled from QuickBooks', 'setup: an account that is not in the pulled chart is refused (nobody types ids)');
select pg_temp.assert_raises($$select app.request_account_mapping_change('00000000-0000-4000-8000-000000008301', 'role', 'income.boli', '14', 'Setup')$$,
  'No QuickBooks item posts', 'setup: a fund account with no QuickBooks item to post through is refused before money depends on it');
select pg_temp.assert_raises($$select app.request_account_mapping_change('00000000-0000-4000-8000-000000008301', 'role', 'income.general', '1', ' ')$$,
  'Say why', 'setup: a reason is needed');
select pg_temp.assert_raises($$select app.request_account_mapping_change('00000000-0000-4000-8000-000000008301', 'fund_class', '83000000-0000-4000-8000-0000000000f1', '32', 'Setup')$$,
  'inactive', 'setup: an inactive class is refused');
select pg_temp.assert_raises($$select app.request_account_mapping_change('00000000-0000-4000-8000-000000008301', 'bank_account', '83000000-0000-4000-8000-0000000000b1', '5', 'Setup')$$,
  'needs one of', 'setup: a bank account''s QuickBooks account must be a bank account');
select pg_temp.assert((app.request_account_mapping_change(:c, 'role', 'income.general', '1', 'Initial mapping'))->>'status' = 'applied',
  'setup: the choice is saved at once');
select app.request_account_mapping_change(:c, 'role', 'bank', '2', 'Initial mapping');
select app.request_account_mapping_change(:c, 'role', 'undeposited_funds', '3', 'Initial mapping');
select app.request_account_mapping_change(:c, 'role', 'processor_clearing', '4', 'Initial mapping');
select app.request_account_mapping_change(:c, 'role', 'merchant_fees', '5', 'Initial mapping');
select app.request_account_mapping_change(:c, 'role', 'store.sales', '7', 'Initial mapping');
select app.request_account_mapping_change(:c, 'role', 'sales_tax_payable', '8', 'Initial mapping');
select app.request_account_mapping_change(:c, 'fund_class', '83000000-0000-4000-8000-0000000000f1', '30', 'General fund class');
select pg_temp.assert_raises($$select app.request_account_mapping_change('00000000-0000-4000-8000-000000008301', 'role', 'income.general', '1', 'Again')$$,
  'Nothing to change', 'setup: the same account again is not a change');
reset role;
select pg_temp.assert(pg_temp.mapped(:c, 'payment_clearing') = '4'
                      and (select bool_and(realm_id = 'R83A' and approved_at is null and first_approved_at is null)
                             from app.qbo_account_mappings where center_id = :c)
                      and (select qbo_class_id = '30' and qbo_class_realm = 'R83A' from app.funds where id = :f1)
                      and (select count(*) = 8 and bool_and(mode = 'setup' and status = 'applied' and requested_by = :tanu and decided_by is null)
                             from app.account_mapping_changes where center_id = :c)
                      and not app.account_mapping_in_use(:c),
  'setup: seven accounts and a class are chosen by one person (an alias works), each records its QuickBooks company, nothing is approved yet, and each choice is in the history');
select pg_temp.assert((select from_ref is null and to_ref = '1' and to_name = 'Donations' and target_label = 'General donations income' and realm_id = 'R83A'
                         from app.account_mapping_changes where center_id = :c and target_key = 'income.general'),
  'setup: the history says what was chosen, by name, in which company');

-- The treasurer approves the whole mapping (fresh 2FA check), as before. From then on it is in use.
select pg_temp.claims('83000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select pg_temp.assert(((app.approve_qbo_mapping(:c, 'Checked against our chart of accounts'))->>'approved')::int = 7, 'the treasurer approves the mapping');
reset role;
select pg_temp.no_claims();
update app.integration_connections set settings = settings || jsonb_build_object('test_post_approved_at', now(), 'test_post_approved_by', :tanu) where id = :conn;
select pg_temp.assert(app.account_mapping_in_use(:c)
                      and (select bool_and(first_approved_at is not null and approved_by = :tanu) from app.qbo_account_mappings where center_id = :c)
                      and (app.qbo_post_ready(:c)->>'ok')::boolean,
  'approved: the mapping is in use and the poster is ready');

-- ═════════════════════════════════════════════════════════════════════════════
-- In use: one person alone changes nothing
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.claims('83000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select pg_temp.assert_raises($$select app.set_qbo_mapping('00000000-0000-4000-8000-000000008301', 'income.general', '15', 'Alone')$$,
  'needs a second person', 'the old mapping function cannot change an account in use');
select pg_temp.assert_raises($$update app.qbo_account_mappings set qbo_account_id = '15' where center_id = '00000000-0000-4000-8000-000000008301' and purpose = 'income.general'$$,
  'needs a second person', 'nor a direct write over the API');
select pg_temp.assert_raises($$insert into app.qbo_account_mappings (center_id, purpose, qbo_account_id) values ('00000000-0000-4000-8000-000000008301', 'income.boli', '12')$$,
  'needs a second person', 'nor adding a fund''s account directly');
select pg_temp.assert_raises($$delete from app.qbo_account_mappings where center_id = '00000000-0000-4000-8000-000000008301' and purpose = 'income.general'$$,
  'cannot be removed', 'nor removing an account ("remove, then add another" is no way round)');
select pg_temp.assert_raises($$select app.set_qbo_fund_class('00000000-0000-4000-8000-000000008301', '83000000-0000-4000-8000-0000000000f2', '31', 'Alone')$$,
  'needs a second person', 'nor the old fund class function');
select pg_temp.assert_raises($$update app.funds set qbo_class_id = '31' where id = '83000000-0000-4000-8000-0000000000f2'$$,
  'needs a second person', 'nor a fund''s class over the API');
select pg_temp.assert_raises($$update app.bank_accounts set qbo_account_id = '2' where id = '83000000-0000-4000-8000-0000000000b1'$$,
  'needs a second person', 'nor a bank account''s QuickBooks account over the API');
update app.qbo_account_mappings set first_approved_at = null where center_id = :c;
update app.funds set qbo_class_realm = 'ANOTHER' where id = :f1;
reset role;
select pg_temp.assert((select bool_and(first_approved_at is not null) from app.qbo_account_mappings where center_id = :c)
                      and (select qbo_class_realm = 'R83A' from app.funds where id = :f1),
  'what the database keeps (when a row was first approved, the company of a choice) cannot be written directly');
select pg_temp.claims('83000000-0000-4000-8000-000000000007', true);
set local role authenticated;
select pg_temp.assert_raises($$update app.qbo_account_mappings set qbo_account_id = '15' where center_id = '00000000-0000-4000-8000-000000008301' and purpose = 'income.general'$$,
  'needs a second person', 'a platform admin has no way round it either');
reset role;
select pg_temp.claims('83000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select pg_temp.assert_raises($$update app.qbo_account_mappings set purpose = 'income.boli' where center_id = '00000000-0000-4000-8000-000000008301' and purpose = 'income.general'$$,
  'needs a second person', 'nor moving an account to another fund by changing its role');
select pg_temp.assert_raises($$update app.qbo_account_mappings set approved_at = null, approved_by = null where center_id = '00000000-0000-4000-8000-000000008301' and purpose = 'income.general'$$,
  'approved as a whole', 'nor withdrawing an approval directly (it would stop posting)');
update app.qbo_account_mappings set qbo_account_name = 'Looks like another account' where center_id = :c and purpose = 'income.general';
reset role;
select pg_temp.assert((select qbo_account_name = 'Donations' from app.qbo_account_mappings where center_id = :c and purpose = 'income.general'),
  'nor renaming the account the second person would be shown');
-- The QuickBooks connection row: an administrator with integrations.manage could otherwise write approvals or switch the company.
select pg_temp.claims('83000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select pg_temp.assert_raises($$update app.integration_connections set settings = settings || '{"test_post_approved_at":"2026-01-01"}' where id = '83000000-0000-4000-8000-0000000000e1'$$,
  'changed only in Accounting', 'nobody writes "test post approved" on the QuickBooks connection over the API');
select pg_temp.assert_raises($$update app.integration_connections set external_account_id = 'ELSEWHERE' where id = '83000000-0000-4000-8000-0000000000e1'$$,
  'changed only in Accounting', 'nor switches its company');
select pg_temp.assert_raises($$delete from app.integration_connections where id = '83000000-0000-4000-8000-0000000000e1'$$,
  'changed only in Accounting', 'nor deletes it');
reset role;
select pg_temp.assert((select external_account_id = 'R83A' from app.integration_connections where id = :conn), 'the connection is unchanged');
select pg_temp.assert(pg_temp.mapped(:c, 'income.general') = '1' and (select qbo_class_id is null from app.funds where id = :f2)
                      and (select qbo_account_id is null from app.bank_accounts where id = :ba1),
  'none of those attempts changed anything');
-- Sessions without a signed-in person (the service role, migrations, seeds) are not asked, as in 0597.
select pg_temp.no_claims();
update app.funds set qbo_class_id = '33' where id = :f3;
select pg_temp.assert((select qbo_class_id = '33' and qbo_class_realm = 'R83A' from app.funds where id = :f3),
  'a session with no signed-in person is not asked; the company is still recorded');

-- ═════════════════════════════════════════════════════════════════════════════
-- Asking for a change, and the second person
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.claims('83000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select pg_temp.assert_state($$select app.request_account_mapping_change('00000000-0000-4000-8000-000000008301', 'role', 'income.boli', '12', 'Bolis')$$,
  '42501', 'an administrator without accounting.manage cannot ask');
reset role;
select pg_temp.claims('83000000-0000-4000-8000-000000000005', true);
set local role authenticated;
select pg_temp.assert_state($$select app.request_account_mapping_change('00000000-0000-4000-8000-000000008301', 'role', 'income.boli', '12', 'Bolis')$$,
  '42501', 'nor a finance volunteer');
reset role;
select pg_temp.claims('83000000-0000-4000-8000-000000000006', true);
set local role authenticated;
select pg_temp.assert_state($$select app.request_account_mapping_change('00000000-0000-4000-8000-000000008301', 'role', 'income.boli', '12', 'Bolis')$$,
  '42501', 'nor a member');
reset role;
select pg_temp.claims('83000000-0000-4000-8000-000000000007', true);
set local role authenticated;
select pg_temp.assert_state($$select app.request_account_mapping_change('00000000-0000-4000-8000-000000008301', 'role', 'income.boli', '12', 'Bolis')$$,
  '42501', 'nor a Community Connect platform admin');
reset role;
select pg_temp.claims('83000000-0000-4000-8000-000000000002', false);
set local role authenticated;
select pg_temp.assert_state($$select app.request_account_mapping_change('00000000-0000-4000-8000-000000008301', 'role', 'income.boli', '12', 'Bolis have their own account')$$,
  'CCSTP', 'asking for a change needs a fresh 2FA check (the conditional rule of 0150: a new organization requires 2FA for staff)');
reset role;
select pg_temp.assert(not exists (select 1 from app.account_mapping_changes where center_id = :c and status = 'pending'), 'and nothing was written');
select pg_temp.claims('83000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select pg_temp.assert_raises($$select app.request_account_mapping_change('00000000-0000-4000-8000-000000008301', 'role', 'income.boli', '12', ' ')$$,
  'Say why', 'asking needs a reason');
select pg_temp.assert_raises($$select app.request_account_mapping_change('00000000-0000-4000-8000-000000008301', 'role', 'income.nope', '12', 'x')$$,
  'does not know the account role', 'an unknown role is refused');
select pg_temp.assert_raises($$select app.request_account_mapping_change('00000000-0000-4000-8000-000000008301', 'role', 'income.boli', '9', 'x')$$,
  'needs one of', 'an account of the wrong type is refused before anyone is asked to confirm it');
select pg_temp.assert_raises($$select app.request_account_mapping_change('00000000-0000-4000-8000-000000008301', 'role', 'income.general', '1', 'x')$$,
  'Nothing to change', 'the current account is not a change');
select app.request_account_mapping_change(:c, 'role', 'income.boli', '12', 'Bolis have their own income account') as r1 \gset
select (:'r1'::jsonb)->>'id' as req1 \gset
reset role;
select pg_temp.assert((:'r1'::jsonb)->>'status' = 'pending' and pg_temp.mapped(:c, 'income.boli') is null
                      and (select mode = 'request' and from_ref is null and to_ref = '12' and to_name = 'Boli Income' and requested_by = :tanu
                                  and expires_at > now() + interval '13 days' and realm_id = 'R83A'
                             from app.account_mapping_changes where id = :'req1'),
  'one person alone changed nothing: the request names old and new, who asked and in which company');
select pg_temp.assert((select reason = 'Bolis have their own income account' and module = 'accounting' and actor_user_id = :tanu
                         from app.audit_log where action = 'account_mapping_changes.insert' and record_id = :'req1'),
  'the first person''s reason is audited (module accounting, by Tanu)');

select pg_temp.claims('83000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select pg_temp.assert_raises(format($$select app.decide_account_mapping_change(%L, true, 'I approve my own request')$$, :'req1'),
  'different person', 'the person who asked cannot confirm their own change');
reset role;
select pg_temp.claims('83000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select pg_temp.assert_state(format($$select app.decide_account_mapping_change(%L, true, 'Looks right')$$, :'req1'), '42501',
  'an administrator without giving.approve cannot confirm');
reset role;
select pg_temp.claims('83000000-0000-4000-8000-000000000009', true);
set local role authenticated;
select pg_temp.assert_state(format($$select app.decide_account_mapping_change(%L, true, 'Looks right')$$, :'req1'), '42501',
  'a bookkeeper with accounting.manage but not giving.approve cannot confirm');
reset role;
select pg_temp.claims('83000000-0000-4000-8000-000000000007', true);
set local role authenticated;
select pg_temp.assert_state(format($$select app.decide_account_mapping_change(%L, true, 'Support approval')$$, :'req1'), '42501',
  'a Community Connect platform admin cannot confirm');
reset role;
select pg_temp.claims('83000000-0000-4000-8000-000000000003', false);
set local role authenticated;
select pg_temp.assert_state(format($$select app.decide_account_mapping_change(%L, true, 'Checked the chart')$$, :'req1'), 'CCSTP',
  'confirming needs a fresh 2FA check');
reset role;
select pg_temp.claims('83000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select pg_temp.assert_raises(format($$select app.decide_account_mapping_change(%L, true, ' ')$$, :'req1'), 'say why', 'confirming needs a reason');
select pg_temp.assert((app.decide_account_mapping_change(:'req1', true, 'Checked the boli account with our accountant'))->>'status' = 'applied',
  'a different treasurer with a fresh 2FA check and a reason confirms it');
select pg_temp.assert_raises(format($$select app.decide_account_mapping_change(%L, true, 'Again')$$, :'req1'), 'already confirmed',
  'a confirmed request cannot be confirmed twice');
reset role;
select pg_temp.assert(pg_temp.mapped(:c, 'income.boli') = '12'
                      and (select approved_by = :tara and approved_at is not null and first_approved_at is not null and realm_id = 'R83A'
                                  and qbo_account_name = 'Boli Income'
                             from app.qbo_account_mappings where center_id = :c and purpose = 'income.boli')
                      and (select status = 'applied' and decided_by = :tara and applied_at is not null
                                  and decision_reason = 'Checked the boli account with our accountant'
                             from app.account_mapping_changes where id = :'req1')
                      and (select settings ? 'mapping_approved_at' and settings ? 'test_post_approved_at' from app.integration_connections where id = :conn)
                      and (app.qbo_post_ready(:c)->>'ok')::boolean,
  'confirmed: the account is mapped and approved by the second person; the rest of the mapping and the test post stay approved, so posting goes on');
select pg_temp.assert((select reason like 'Account mapping change confirmed by a second person: Checked the boli account%' and actor_user_id = :tara
                         from app.audit_log where action = 'qbo_account_mappings.insert' and center_id = :c order by id desc limit 1),
  'the mapping row itself is audited with the second person''s reason');
select pg_temp.assert(app.account_for_fund(:c, 'boli') = '12' and app.account_for_fund(:c, 'income.boli') = '12'
                      and app.account_for_role(:c, 'processor_clearing') = '4' and app.account_for_role(:c, 'income.general') = '1',
  'the resolvers answer the confirmed account (by fund, by role, by alias)');

-- Turning down, withdrawing, a newer request replacing a waiting one, a lapsed one, an asker who lost the role.
select pg_temp.claims('83000000-0000-4000-8000-000000000009', true);
set local role authenticated;
select (app.request_account_mapping_change(:c, 'role', 'income.general', '15', 'New donations account for 2027'))->>'id' as req2 \gset
reset role;
select pg_temp.claims('83000000-0000-4000-8000-000000000010', true);
set local role authenticated;
select pg_temp.assert((app.decide_account_mapping_change(:'req2', false, 'Not until the new fiscal year'))->>'status' = 'rejected',
  'a person with giving.approve only turns it down');
reset role;
select pg_temp.assert(pg_temp.req_status(:'req2') = 'rejected' and pg_temp.mapped(:c, 'income.general') = '1'
                      and (select decided_by = :gus from app.account_mapping_changes where id = :'req2'),
  'turned down: nothing changed');
select pg_temp.claims('83000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select (app.request_account_mapping_change(:c, 'fund_class', '83000000-0000-4000-8000-0000000000f2', '31', 'Construction class'))->>'id' as req3 \gset
select pg_temp.assert_raises(format($$select app.cancel_account_mapping_change(%L, ' ')$$, :'req3'), 'say why', 'withdrawing needs a reason');
select app.cancel_account_mapping_change(:'req3', 'Asked too early');
reset role;
select pg_temp.claims('83000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select pg_temp.assert_raises(format($$select app.decide_account_mapping_change(%L, true, 'ok')$$, :'req3'), 'withdrawn', 'a withdrawn request cannot be confirmed');
reset role;
select pg_temp.assert(pg_temp.req_status(:'req3') = 'cancelled' and (select cancelled_by = :tanu from app.account_mapping_changes where id = :'req3')
                      and (select qbo_class_id is null from app.funds where id = :f2),
  'withdrawn: who withdrew is kept; nothing changed');
select pg_temp.claims('83000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select (app.request_account_mapping_change(:c, 'bank_account', '83000000-0000-4000-8000-0000000000b1', '22', 'Operating is the savings register?'))->>'id' as req4 \gset
reset role;
select pg_temp.claims('83000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select (app.request_account_mapping_change(:c, 'bank_account', '83000000-0000-4000-8000-0000000000b1', '2', 'Operating lands in Chase Operating'))->>'id' as req5 \gset
reset role;
select pg_temp.assert(pg_temp.req_status(:'req4') = 'superseded' and pg_temp.req_status(:'req5') = 'pending',
  'a newer request for the same thing (the owner may ask) replaces the waiting one');
select pg_temp.claims('83000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select pg_temp.assert_raises(format($$select app.decide_account_mapping_change(%L, true, 'ok')$$, :'req4'), 'replaced by a newer request',
  'a replaced request cannot be confirmed');
reset role;
select pg_temp.claims('83000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select pg_temp.assert((app.decide_account_mapping_change(:'req5', true, 'Matches the bank statement'))->>'status' = 'applied',
  'a treasurer confirms the owner''s request');
reset role;
select pg_temp.assert((select qbo_account_id = '2' and qbo_account_realm = 'R83A' from app.bank_accounts where id = :ba1),
  'the operating bank account now has its own QuickBooks account');
select pg_temp.claims('83000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select (app.request_account_mapping_change(:c, 'fund_class', '83000000-0000-4000-8000-0000000000f2', '31', 'Construction class'))->>'id' as req6 \gset
reset role;
update app.account_mapping_changes set expires_at = now() - interval '1 day' where id = :'req6';
select pg_temp.claims('83000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select pg_temp.assert_raises(format($$select app.decide_account_mapping_change(%L, true, 'ok')$$, :'req6'), 'lapsed', 'a request that lapsed (14 days) cannot be confirmed');
reset role;
select pg_temp.claims('83000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select (app.request_account_mapping_change(:c, 'fund_class', '83000000-0000-4000-8000-0000000000f2', '31', 'Construction class, again'))->>'id' as req7 \gset
reset role;
select pg_temp.assert(pg_temp.req_status(:'req6') = 'expired' and pg_temp.req_status(:'req7') = 'pending', 'asking again marks the lapsed request lapsed');
select pg_temp.claims('83000000-0000-4000-8000-000000000009', true);
set local role authenticated;
select (app.request_account_mapping_change(:c, 'role', 'income.general', '15', 'New donations account'))->>'id' as req8 \gset
reset role;
select pg_temp.no_claims();
update app.role_grants set status = 'revoked' where center_id = :c and user_id = :bea;
select pg_temp.claims('83000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select pg_temp.assert_raises(format($$select app.decide_account_mapping_change(%L, true, 'Looks right')$$, :'req8'), 'no longer holds a role',
  'a request cannot be confirmed once the person who asked has lost the role that lets them ask');
select pg_temp.assert((app.decide_account_mapping_change(:'req8', false, 'The bookkeeper left'))->>'status' = 'rejected', 'but it can be turned down');
reset role;
select pg_temp.no_claims();
update app.role_grants set status = 'active' where center_id = :c and user_id = :bea;
-- What the second person is shown must still be true when they confirm.
select pg_temp.no_claims();
update app.funds set qbo_class_id = '31' where id = :f2;
select pg_temp.claims('83000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select pg_temp.assert_raises(format($$select app.decide_account_mapping_change(%L, true, 'ok')$$, :'req7'), 'changed after this request',
  'a request whose current value changed meanwhile cannot be confirmed');
select app.cancel_account_mapping_change(:'req7', 'Superseded by the direct fix');
reset role;
select pg_temp.no_claims();
update app.funds set qbo_class_id = null where id = :f2;

-- ═════════════════════════════════════════════════════════════════════════════
-- A fund without an account blocks its posting; confirming the account puts it back in the queue
-- ═════════════════════════════════════════════════════════════════════════════
insert into app.pledges (id, center_id, household_id, source, amount_cents) values
  ('83000000-0000-4000-8000-00000000a101', :c, :h1, 'membership_fee', 5000);
insert into app.payments (id, center_id, household_id, amount_cents, method, provider, received_on, receipt_number)
values ('83000000-0000-4000-8000-00000000b201', :c, :h1, 5000, 'cash', 'offline', current_date - 1, 'R83-1');
insert into app.payment_allocations (center_id, payment_id, pledge_id, amount_cents)
values (:c, '83000000-0000-4000-8000-00000000b201', '83000000-0000-4000-8000-00000000a101', 5000);
select (pg_temp.posting('83000000-0000-4000-8000-00000000b201')).id as lp1 \gset
select pg_temp.assert((pg_temp.posting('83000000-0000-4000-8000-00000000b201')).status = 'queued', 'membership dues paid in cash: one posting queued');
select pg_temp.claim(:c) as cl1 \gset
select pg_temp.assert(pg_temp.unit_of(:'cl1'::jsonb, :'lp1') is null
                      and (select status = 'failed' and needs_mapping = 'role:income.membership' and qbo_doc is null
                                  and last_error like 'Membership dues income has no QuickBooks account yet.%'
                             from app.ledger_postings where id = :'lp1'),
  'dues with no dues account are NOT posted to general income: the posting waits with a plain reason naming the fund');
select pg_temp.assert(app.qbo_posting_doc(:'lp1')->>'needs_mapping' = 'role:income.membership', 'the document says which mapping it waits for');
select pg_temp.assert_state($$select app.account_for_fund('00000000-0000-4000-8000-000000008301', 'dues')$$, 'CCMAP',
  'the resolver raises CCMAP for a fund without an account (never a default)');
select pg_temp.assert_raises($$select app.account_for_fund('00000000-0000-4000-8000-000000008301', 'nonsense')$$, 'does not know the fund',
  'an unknown fund is a plain error');
select pg_temp.claims('83000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select (app.request_account_mapping_change(:c, 'role', 'dues', '13', 'Dues have their own income account'))->>'id' as req9 \gset
reset role;
select pg_temp.assert((pg_temp.posting('83000000-0000-4000-8000-00000000b201')).status = 'failed', 'asking alone does not release the posting');
select pg_temp.claims('83000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select app.decide_account_mapping_change(:'req9', true, 'Dues account checked') as d9 \gset
reset role;
select pg_temp.assert((:'d9'::jsonb)->>'requeued' = '1'
                      and (select status = 'queued' and needs_mapping is null and last_error is null from app.ledger_postings where id = :'lp1')
                      and (select requeued_postings = 1 from app.account_mapping_changes where id = :'req9'),
  'confirming the dues account put the waiting posting back in the queue by itself');
select pg_temp.claim(:c) as cl2 \gset
select pg_temp.assert((select u->'doc'->'lines'->0->>'account_id' = '13' and u->'doc'->'lines'->0->>'item_id' = '22'
                              and u->'doc'->>'deposit_account' = '3' and (u->'doc'->'lines'->0->>'amount_cents')::int = 5000
                         from (select pg_temp.unit_of(:'cl2'::jsonb, :'lp1') u) x)
                      and (select status = 'posting' and qbo_realm = 'R83A' and qbo_doc->'lines'->0->>'account_id' = '13' from app.ledger_postings where id = :'lp1'),
  'it posts to the dues account, and the posting keeps the document it is sent with');
select pg_temp.done(:'lp1', 'QB-1');

-- A boli pledge: its campaign's kind (boli) decides the account, its campaign's fund the class.
insert into app.pledges (id, center_id, household_id, source, amount_cents, campaign_id) values
  ('83000000-0000-4000-8000-00000000a103', :c, :h1, 'boli', 7000, :cp1);
insert into app.payments (id, center_id, household_id, amount_cents, method, provider, received_on, receipt_number)
values ('83000000-0000-4000-8000-00000000b206', :c, :h1, 7000, 'check', 'offline', current_date - 1, 'R83-6');
insert into app.payment_allocations (center_id, payment_id, pledge_id, amount_cents)
values (:c, '83000000-0000-4000-8000-00000000b206', '83000000-0000-4000-8000-00000000a103', 7000);
select (pg_temp.posting('83000000-0000-4000-8000-00000000b206')).id as lp6 \gset
select pg_temp.claim(:c) as cl6 \gset
select pg_temp.assert((select u->'doc'->'lines'->0->>'account_id' = '12' and u->'doc'->'lines'->0->>'class_id' = '33'
                         from (select pg_temp.unit_of(:'cl6'::jsonb, :'lp6') u) x),
  'a boli payment posts to the boli account with the Deva Dravya class of its campaign''s fund');
select pg_temp.done(:'lp6', 'QB-6');

-- ═════════════════════════════════════════════════════════════════════════════
-- Only postings sent after a change use it; posted entries keep their accounts and are never re-sent
-- ═════════════════════════════════════════════════════════════════════════════
insert into app.payments (id, center_id, household_id, amount_cents, method, provider, received_on, receipt_number)
values ('83000000-0000-4000-8000-00000000b202', :c, :h1, 2500, 'cash', 'offline', current_date - 1, 'R83-2');
select (pg_temp.posting('83000000-0000-4000-8000-00000000b202')).id as lp2 \gset
select pg_temp.claim(:c) as cl3 \gset
select pg_temp.assert((select u->'doc'->'lines'->0->>'account_id' = '1' and u->'doc'->'lines'->0->>'class_id' = '30'
                         from (select pg_temp.unit_of(:'cl3'::jsonb, :'lp2') u) x),
  'a donation not tied to a pledge is a general donation: the General fund''s own account and class');
select pg_temp.done(:'lp2', 'QB-2');
select pg_temp.claims('83000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select (app.request_account_mapping_change(:c, 'role', 'income.general', '15', 'Donations go to the 2027 account'))->>'id' as req10 \gset
reset role;
select pg_temp.claims('83000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select app.decide_account_mapping_change(:'req10', true, 'New fiscal year account') as d10 \gset
reset role;
select pg_temp.assert(pg_temp.mapped(:c, 'income.general') = '15' and (:'d10'::jsonb)->>'requeued' = '0',
  'the general donations account changes');
select pg_temp.assert((select status = 'posted' and qbo_ref = 'QB-2' and qbo_doc->'lines'->0->>'account_id' = '1' and qbo_realm = 'R83A'
                         from app.ledger_postings where id = :'lp2'),
  'the donation already posted keeps its account (the document it was posted with is kept)');
select pg_temp.claim(:c) as cl4 \gset
select pg_temp.assert(jsonb_array_length((:'cl4'::jsonb)->'units') = 0, 'and nothing already posted is sent again');
insert into app.payments (id, center_id, household_id, amount_cents, method, provider, received_on, receipt_number)
values ('83000000-0000-4000-8000-00000000b203', :c, :h1, 1500, 'cash', 'offline', current_date - 1, 'R83-3');
select (pg_temp.posting('83000000-0000-4000-8000-00000000b203')).id as lp3 \gset
select pg_temp.claim(:c) as cl5 \gset
select pg_temp.assert((select u->'doc'->'lines'->0->>'account_id' = '15' and u->'doc'->'lines'->0->>'item_id' = '24'
                         from (select pg_temp.unit_of(:'cl5'::jsonb, :'lp3') u) x),
  'a donation sent after the change posts to the new account');
-- An entry whose answer was lost (the worker vanished) is sent again exactly as it was first sent, under the same requestid.
select pg_temp.claims('83000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select (app.request_account_mapping_change(:c, 'role', 'income.general', '1', 'Back to the old account'))->>'id' as req11 \gset
reset role;
select pg_temp.claims('83000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select app.decide_account_mapping_change(:'req11', true, 'The 2027 account is not open yet');
reset role;
update app.ledger_postings set claimed_at = now() - interval '20 minutes' where id = :'lp3';
select pg_temp.claim(:c) as cl7 \gset
select pg_temp.assert((select u->'doc'->'lines'->0->>'account_id' = '15' and u->>'unit_id' = :'lp3'
                         from (select pg_temp.unit_of(:'cl7'::jsonb, :'lp3') u) x)
                      and pg_temp.mapped(:c, 'income.general') = '1',
  'a re-send after a lost answer carries the first document (same account, same requestid), whatever the mapping became');
select pg_temp.done(:'lp3', 'QB-3');

-- Over the API: only Retry of a failed posting.
insert into app.pledges (id, center_id, household_id, source, amount_cents) values
  ('83000000-0000-4000-8000-00000000a102', :c, :h1, 'pathshala_fee', 3000);
insert into app.payments (id, center_id, household_id, amount_cents, method, provider, received_on, receipt_number)
values ('83000000-0000-4000-8000-00000000b205', :c, :h1, 3000, 'cash', 'offline', current_date - 1, 'R83-5');
insert into app.payment_allocations (center_id, payment_id, pledge_id, amount_cents)
values (:c, '83000000-0000-4000-8000-00000000b205', '83000000-0000-4000-8000-00000000a102', 3000);
select (pg_temp.posting('83000000-0000-4000-8000-00000000b205')).id as lp5 \gset
select pg_temp.claim(:c);
select pg_temp.assert((select status = 'failed' and needs_mapping = 'role:income.pathshala' from app.ledger_postings where id = :'lp5'),
  'a Pathshala fee with no Pathshala account waits too');
select pg_temp.claims('83000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select pg_temp.assert_raises(format($$update app.ledger_postings set status = 'queued' where id = %L$$, :'lp2'),
  'written by the QuickBooks poster only', 'a posted entry cannot be put back in the queue over the API (it would post twice)');
select pg_temp.assert_raises(format($$update app.ledger_postings set qbo_ref = 'FORGED' where id = %L$$, :'lp2'),
  'written by the QuickBooks poster only', 'nor its QuickBooks reference rewritten');
select pg_temp.assert_raises(format($$delete from app.ledger_postings where id = %L$$, :'lp2'),
  'written by the QuickBooks poster only', 'nor deleted');
select pg_temp.assert_raises($$insert into app.ledger_postings (center_id, idempotency_key, source_table, source_id, txn_type, amount_cents, period_month, status)
  values ('00000000-0000-4000-8000-000000008301', 'forged:1', 'payments', '83000000-0000-4000-8000-00000000b205', 'offline_receipt', 1, current_date, 'posted')$$,
  'written by the QuickBooks poster only', 'nor a posting added directly (a "posted" one would stop the real one from ever posting)');
select pg_temp.assert_raises(format($$update app.ledger_postings set status = 'queued', amount_cents = 1 where id = %L$$, :'lp5'),
  'written by the QuickBooks poster only', 'Retry cannot change anything else on the posting');
update app.ledger_postings set status = 'queued' where id = :'lp5';
reset role;
select pg_temp.assert((select status = 'queued' and needs_mapping is null and qbo_doc is null from app.ledger_postings where id = :'lp5')
                      and (select status = 'posted' and qbo_ref = 'QB-2' and qbo_doc is not null from app.ledger_postings where id = :'lp2'),
  'Retry of a failed posting works (it is built again from the mapping in force); the posted one is untouched');

-- ═════════════════════════════════════════════════════════════════════════════
-- Bank accounts: with two, each needs its own QuickBooks account
-- ═════════════════════════════════════════════════════════════════════════════
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description, fingerprint)
values ('83000000-0000-4000-8000-00000000b301', :c, :ba2, current_date - 2, 4500, 'DEPOSIT', 'fp83-1');
insert into app.ledger_postings (center_id, idempotency_key, source_table, source_id, txn_type, amount_cents, period_month)
values (:c, 'deposit:83000000-0000-4000-8000-00000000b301', 'bank_transactions', '83000000-0000-4000-8000-00000000b301', 'payout_deposit', 4500,
        date_trunc('month', current_date - 2)::date);
select id as lp7 from app.ledger_postings where idempotency_key = 'deposit:83000000-0000-4000-8000-00000000b301' \gset
select pg_temp.claim(:c);
select pg_temp.assert((select status = 'failed' and needs_mapping = 'bank_account:83000000-0000-4000-8000-0000000000b2'
                              and last_error like 'The bank account "Chase savings" has no QuickBooks account of its own%'
                         from app.ledger_postings where id = :'lp7'),
  'a deposit into the savings account does not silently land in the main bank account');
select pg_temp.assert(exists (select 1 from jsonb_array_elements(app.qbo_mapping_warnings(:c)) w
                               where w->>'level' = 'warning' and w->>'bank_account_id' = '83000000-0000-4000-8000-0000000000b2'),
  'the setup screen warns about it (a warning: other postings go on)');
select pg_temp.claims('83000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select (app.request_account_mapping_change(:c, 'bank_account', '83000000-0000-4000-8000-0000000000b2', '22', 'Savings has its own register'))->>'id' as req12 \gset
reset role;
select pg_temp.claims('83000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select app.decide_account_mapping_change(:'req12', true, 'Matches the savings statement');
reset role;
select pg_temp.claim(:c) as cl8 \gset
select pg_temp.assert((select u->'doc'->>'deposit_account' = '22' and u->'doc'->>'entity' = 'Deposit'
                         from (select pg_temp.unit_of(:'cl8'::jsonb, :'lp7') u) x),
  'once confirmed the deposit goes back in the queue and lands in the savings register');

-- ═════════════════════════════════════════════════════════════════════════════
-- What the screens show
-- ═════════════════════════════════════════════════════════════════════════════
-- An open Pathshala fee: the fund is in use and has no account.
insert into app.pledges (id, center_id, household_id, source, amount_cents) values
  ('83000000-0000-4000-8000-00000000a104', :c, :h1, 'pathshala_fee', 2000);
select pg_temp.claims('83000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select (app.request_account_mapping_change(:c, 'role', 'income.event', '1', 'Event money with donations for now'))->>'id' as req13 \gset
reset role;
select pg_temp.claims('83000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select app.account_mapping_overview(:c) as ov \gset
select app.account_mapping_waiting(:c) as wt \gset
reset role;
select pg_temp.assert((:'ov'::jsonb)->>'in_use' = 'true' and (:'ov'::jsonb)->>'can_approve' = 'true'
                      and (select r->>'account_id' = '13' and r->>'label' = 'Membership dues income' and r->>'problem' is null
                             from jsonb_array_elements((:'ov'::jsonb)->'roles') r where r->>'key' = 'income.membership')
                      and (select r->>'problem' like 'Pathshala income has no QuickBooks account yet.%' and (r->>'used')::int >= 1
                                  and (r->>'waiting_postings')::int = 1
                             from jsonb_array_elements((:'ov'::jsonb)->'roles') r where r->>'key' = 'income.pathshala')
                      and (select (r->>'used')::int >= 1 from jsonb_array_elements((:'ov'::jsonb)->'roles') r where r->>'key' = 'income.boli')
                      and (select f->>'class_id' = '33' from jsonb_array_elements((:'ov'::jsonb)->'funds') f where f->>'key' = 'deva_dravya')
                      and (select b->>'account_id' = '22' from jsonb_array_elements((:'ov'::jsonb)->'bank_accounts') b where b->>'name' = 'Chase savings'),
  'the overview shows what each fund, role, class and bank account posts to now, and which funds are in use without an account');
select pg_temp.assert(((:'ov'::jsonb)->'requests'->0->>'id') = :'req13'
                      and ((:'ov'::jsonb)->'requests'->0->>'requested_by_name') = 'tanu83@am.example'
                      and ((:'ov'::jsonb)->'requests'->0->>'mine') = 'false'
                      and exists (select 1 from jsonb_array_elements((:'ov'::jsonb)->'requests') q
                                   where q->>'id' = :'req1' and q->>'decided_by_name' = 'tara83@am.example' and q->>'from_ref' is null and q->>'to_name' = 'Boli Income')
                      and exists (select 1 from jsonb_array_elements((:'ov'::jsonb)->'requests') q where q->>'mode' = 'setup'),
  'the history lists waiting requests first, then every change with both people, old and new (setup choices included)');
select pg_temp.assert(jsonb_array_length((:'wt'::jsonb)->'requests') = 1 and (:'wt'::jsonb)->'requests'->0->>'id' = :'req13',
  'the Home task of the second person lists the change that waits');

-- ═════════════════════════════════════════════════════════════════════════════
-- Another QuickBooks company: the old choices count as unmapped
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.no_claims();
update app.integration_connections set external_account_id = 'R83B' where id = :conn;
select pg_temp.assert(pg_temp.req_status(:'req13') = 'cancelled'
                      and (select decision_reason like 'The QuickBooks company changed%' from app.account_mapping_changes where id = :'req13')
                      and not exists (select 1 from app.qbo_accounts where connection_id = :conn and active)
                      and not exists (select 1 from app.qbo_classes where connection_id = :conn and active),
  'switching company withdraws waiting requests and marks the old company''s pulled lists inactive until the new ones arrive');
select pg_temp.assert_raises($$select app.account_for_role('00000000-0000-4000-8000-000000008301', 'income.general')$$, 'another QuickBooks company',
  'an account chosen in the old company is not used in the new one');
select pg_temp.assert_raises($$select app.class_for_fund('00000000-0000-4000-8000-000000008301', '83000000-0000-4000-8000-0000000000f1')$$, 'another QuickBooks company',
  'nor a class');
select pg_temp.assert(exists (select 1 from jsonb_array_elements(app.qbo_mapping_warnings(:c)) w where w->>'level' = 'error' and w->>'text' like '%another QuickBooks company%')
                      and not (app.qbo_post_ready(:c)->>'ok')::boolean,
  'the setup screen shows it as an error and nothing posts');
select pg_temp.claims('83000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select pg_temp.assert_raises($$select app.request_account_mapping_change('00000000-0000-4000-8000-000000008301', 'role', 'income.general', '1', 'x')$$,
  'inactive', 'nothing can be chosen from the old company''s lists');
reset role;
select pg_temp.no_claims();
set local role connect_worker;
select app.qbo_worker_store_list(:conn, 'accounts', '[{"qbo_id":"1","name":"Donations (new books)","account_type":"Income","active":true}]');
select app.qbo_worker_store_list(:conn, 'items', '[{"qbo_id":"20","name":"Donation","active":true,"raw":{"Type":"Service","IncomeAccountRef":{"value":"1"}}}]');
reset role;
select pg_temp.claims('83000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select app.request_account_mapping_change(:c, 'role', 'income.general', '1', 'The same account number in the new books') as r14 \gset
reset role;
select pg_temp.assert((:'r14'::jsonb)->>'status' = 'pending'
                      and (select from_ref = '1' and from_name like '%(another QuickBooks company)' and to_name = 'Donations (new books)' and realm_id = 'R83B'
                             from app.account_mapping_changes where id = ((:'r14'::jsonb)->>'id')::uuid),
  'the same account number in the new company is a change, and the request says the old one belongs to another company');
select pg_temp.claims('83000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select app.decide_account_mapping_change(((:'r14'::jsonb)->>'id')::uuid, true, 'Checked in the new books');
reset role;
select pg_temp.assert(app.account_for_role(:c, 'income.general') = '1'
                      and (select realm_id = 'R83B' and approved_by = :tara from app.qbo_account_mappings where center_id = :c and purpose = 'income.general'),
  'confirmed by a second person, it belongs to the new company');

-- ═════════════════════════════════════════════════════════════════════════════
-- One organization never sees or decides another's
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.claims('83000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select (app.request_account_mapping_change(:c, 'role', 'income.event', '1', 'Event money with donations for now'))->>'id' as req15 \gset
reset role;
select pg_temp.claims('83000000-0000-4000-8000-000000000008', true);
set local role authenticated;
select pg_temp.assert((select count(*) from app.account_mapping_changes where center_id = '00000000-0000-4000-8000-000000008301') = 0,
  'a treasurer of another organization reads none of its requests');
select pg_temp.assert_state($$select app.account_mapping_overview('00000000-0000-4000-8000-000000008301')$$, '42501', 'nor its overview');
select pg_temp.assert_state(format($$select app.decide_account_mapping_change(%L, true, 'Looks right')$$, :'req15'), '42501', 'nor can decide its request');
select pg_temp.assert_state($$select app.request_account_mapping_change('00000000-0000-4000-8000-000000008301', 'role', 'income.boli', '1', 'x')$$, '42501',
  'nor ask for a change in it');
reset role;
select pg_temp.claims('83000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select pg_temp.assert_state($$select app.request_account_mapping_change('00000000-0000-4000-8000-000000008302', 'role', 'income.general', '1', 'x')$$, '42501',
  'a treasurer of one organization cannot ask for a change in another');
select pg_temp.assert_raises($$insert into app.account_mapping_changes (center_id, subject, target_key, target_label, to_ref, mode, status, requested_by, request_reason, expires_at)
  values ('00000000-0000-4000-8000-000000008301', 'role', 'income.boli', 'Boli income', '1', 'request', 'applied', '83000000-0000-4000-8000-000000000002', 'x', now())$$,
  'permission denied', 'nobody writes a request row directly over the API');
reset role;
select pg_temp.claims('83000000-0000-4000-8000-000000000006', true);
set local role authenticated;
select pg_temp.assert((select count(*) from app.account_mapping_changes) = 0, 'a member reads no requests');
select pg_temp.assert_state($$select app.account_mapping_overview('00000000-0000-4000-8000-000000008301')$$, '42501', 'nor the overview');
reset role;

-- ═════════════════════════════════════════════════════════════════════════════
-- The rules of the tables and functions
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert((select bool_and(relrowsecurity) from pg_class where oid in ('app.account_roles'::regclass, 'app.account_mapping_changes'::regclass))
                      and exists (select 1 from pg_policy where polrelid = 'app.account_mapping_changes'::regclass and polname = 'module_switch' and not polpermissive)
                      and (select module_key = 'accounting' from app.module_tables where table_name = 'account_mapping_changes')
                      and exists (select 1 from app.module_tables where table_name = 'account_roles' and module_key is null)
                      and not has_table_privilege('authenticated', 'app.account_mapping_changes', 'insert')
                      and not has_table_privilege('authenticated', 'app.account_roles', 'update'),
  'both tables have RLS, the requests follow the Accounting module switch, and nobody writes either over the API');
select pg_temp.assert((select bool_and(p.prosecdef and 'search_path=app, public, extensions' = any (p.proconfig)
                                       and not has_function_privilege('anon', p.oid, 'execute'))
                         from pg_proc p
                        where p.pronamespace = 'app'::regnamespace
                          and p.proname in ('account_map_can_request','account_map_can_approve','account_mapping_in_use','account_role_key','_qbo_realm',
                                            '_account_for_role','account_for_role','account_for_fund','_fund_class_state','class_for_fund',
                                            '_bank_account_state','account_for_bank_account','qbo_account_mappings_delete_guard','funds_qbo_class_guard',
                                            'bank_accounts_qbo_guard','qbo_company_switched','_apply_account_mapping','_requeue_waiting_postings',
                                            'request_account_mapping_change','decide_account_mapping_change','cancel_account_mapping_change',
                                            'account_mapping_overview','account_mapping_waiting','_account_mapping_request_json'))
                      and (select bool_and(not p.prosecdef and 'search_path=app, public, extensions' = any (p.proconfig))
                             from pg_proc p where p.oid in ('app.ledger_postings_api_guard()'::regprocedure, 'app.qbo_connection_api_guard()'::regprocedure)),
  'every new function pins the search path and is closed to anon; the two API guards run as the caller (they must see who wrote)');
select pg_temp.assert(has_function_privilege('authenticated', 'app.request_account_mapping_change(uuid,text,text,text,text)', 'execute')
                      and has_function_privilege('authenticated', 'app.decide_account_mapping_change(uuid,boolean,text)', 'execute')
                      and has_function_privilege('authenticated', 'app.cancel_account_mapping_change(uuid,text)', 'execute')
                      and has_function_privilege('authenticated', 'app.account_mapping_overview(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.account_mapping_waiting(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.account_for_role(uuid,text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.account_for_fund(uuid,text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.account_for_bank_account(uuid,uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.class_for_fund(uuid,uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app._apply_account_mapping(uuid,text,text,text,text)', 'execute')
                      and not has_function_privilege('authenticated', 'app._requeue_waiting_postings(uuid,text,text)', 'execute')
                      and has_function_privilege('service_role', 'app.account_for_role(uuid,text)', 'execute'),
  'signed-in people run the request, decide, cancel and screen functions; the resolvers belong to the database (and the service role)');
select pg_temp.assert((select count(*) = 1 from pg_trigger where tgname = 'qbo_account_mappings_delete_guard' and not tgisinternal)
                      and (select count(*) = 1 from pg_trigger where tgname = 'funds_qbo_class_guard' and tgrelid = 'app.funds'::regclass)
                      and (select count(*) = 1 from pg_trigger where tgname = 'bank_accounts_qbo_guard' and tgrelid = 'app.bank_accounts'::regclass)
                      and (select count(*) = 1 from pg_trigger where tgname = 'ledger_postings_api_guard' and tgrelid = 'app.ledger_postings'::regclass)
                      and (select count(*) = 1 from pg_trigger where tgname = 'qbo_company_switched' and tgrelid = 'app.integration_connections'::regclass)
                      and (select count(*) = 1 from pg_trigger where tgname = 'qbo_connection_api_guard' and tgrelid = 'app.integration_connections'::regclass),
  'the guards sit on the mapping, the funds, the bank accounts, the ledger postings and the connection');

rollback;
