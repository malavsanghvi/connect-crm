-- 0597 (payments plan PR 5): who may change where gifts go (a second, different person with giving.approve,
-- each with a fresh 2FA check and a reason), Community Connect's pause of a way to pay (platform admins only),
-- readiness check 6 for every enabled way to pay, the Zelle instructions approval, and the refresh of the stored
-- plugin rows when a rehearsal Zelle report is matched.
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
end $$;
create or replace function pg_temp.no_claims() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
end $$;
-- The stored plugin rows agree with the derived state.
create or replace function pg_temp.in_step(p_center uuid) returns boolean language sql as $$
  select count(*) = 12 and bool_and(cpp.enabled = app.payment_plugin_enabled(p_center, cpp.plugin_key)
                                    and cpp.mode = app.payment_plugin_mode(p_center, cpp.plugin_key)
                                    and cpp.status = app.payment_plugin_status(p_center, cpp.plugin_key))
    from app.center_payment_plugins cpp where cpp.center_id = p_center
$$;
create or replace function pg_temp.st(p_center uuid, p_key text) returns text language sql as $$
  select status from app.center_payment_plugins where center_id = p_center and plugin_key = p_key
$$;
create or replace function pg_temp.zelle_recipient(p_center uuid) returns text language sql as $$
  select instructions->>'recipient' from app.center_payment_methods where center_id = p_center and method = 'zelle'
$$;
create or replace function pg_temp.req_status(p_request uuid) returns text language sql as $$
  select status from app.payee_changes where id = p_request
$$;

\set c '''00000000-0000-4000-8000-000000008201'''
\set cb '''00000000-0000-4000-8000-000000008202'''
\set cs '''00000000-0000-4000-8000-000000008203'''
\set cr '''00000000-0000-4000-8000-000000008204'''
\set ami '''82000000-0000-4000-8000-000000000001'''
\set tanu '''82000000-0000-4000-8000-000000000002'''
\set tara '''82000000-0000-4000-8000-000000000003'''
\set basil '''82000000-0000-4000-8000-000000000004'''
\set vik '''82000000-0000-4000-8000-000000000005'''
\set mira '''82000000-0000-4000-8000-000000000006'''
\set pat '''82000000-0000-4000-8000-000000000007'''
\set nik '''82000000-0000-4000-8000-000000000008'''
\set h1 '''82000000-0000-4000-8000-0000000000a1'''
\set hs '''82000000-0000-4000-8000-0000000000a2'''
\set ba1 '''82000000-0000-4000-8000-0000000000b1'''
\set ba2 '''82000000-0000-4000-8000-0000000000b2'''
\set ba3 '''82000000-0000-4000-8000-0000000000b3'''
\set ba4 '''82000000-0000-4000-8000-0000000000b4'''
\set ba5 '''82000000-0000-4000-8000-0000000000b5'''
-- Users: 01 Ami (center admin, becomes the owner of c), 02 Tanu and 03 Tara (treasurers: giving.manage and
-- giving.approve), 04 Basil (a second center admin: integrations.manage, no giving.approve), 05 Vik (finance
-- volunteer), 06 Mira (an adult member), 07 Pat (Community Connect platform admin, with an authenticator app),
-- 08 Nik (treasurer of the other organization cb).
-- Organizations: c (the change-control tests), cb (never uses the new paths), cs (a sandbox: rehearsal),
-- cr (readiness).

begin;
insert into auth.users (id, email) values
  ('82000000-0000-4000-8000-000000000001', 'ami82@pc.example'), ('82000000-0000-4000-8000-000000000002', 'tanu82@pc.example'),
  ('82000000-0000-4000-8000-000000000003', 'tara82@pc.example'), ('82000000-0000-4000-8000-000000000004', 'basil82@pc.example'),
  ('82000000-0000-4000-8000-000000000005', 'vik82@pc.example'), ('82000000-0000-4000-8000-000000000006', 'mira82@pc.example'),
  ('82000000-0000-4000-8000-000000000007', 'pat82@pc.example'), ('82000000-0000-4000-8000-000000000008', 'nik82@pc.example');
insert into app.centers (id, slug, name, short_name) values
  (:c, 'pc82', 'Payee Test Temple', 'PTT82'), (:cb, 'pc82b', 'Other Test Temple', 'OTT82'),
  (:cs, 'pc82s', 'Sandbox Test Temple', 'STT82'), (:cr, 'pc82r', 'Readiness Test Temple', 'RTT82');
update app.centers set environment = 'sandbox' where id = :cs;
insert into app.accounts (user_id, is_platform_admin) values (:pat, true);
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status) values
  ('82000000-0000-4000-8000-0000000000f1', :pat, 'Phone', 'totp', 'verified');

insert into app.households (id, center_id, display_name) values (:h1, :c, 'Doshi family'), (:hs, :cs, 'Sandbox family');
insert into app.people (id, center_id, first_name, last_name, email, date_of_birth) values
  ('82000000-0000-4000-8000-0000000000c1', :c, 'Mira', 'Doshi', 'mira82@pc.example', '1982-05-05');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, '82000000-0000-4000-8000-0000000000c1', :c, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values (:c, :mira, '82000000-0000-4000-8000-0000000000c1');
-- Ami first: the first active center admin is the owner.
insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id) values (:c, :ami, 'center_admin', 'center', null);
insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id) values
  (:c, :basil, 'center_admin', 'center', null), (:c, :tanu, 'treasurer', 'center', null), (:c, :tara, 'treasurer', 'center', null),
  (:c, :vik, 'finance_volunteer', 'center', null), (:cb, :nik, 'treasurer', 'center', null), (:cr, :tanu, 'treasurer', 'center', null);

-- Organization c: Zelle and checks are accepted, Zelle's bank account is linked.
insert into app.bank_accounts (id, center_id, name, institution, last4, statement_format) values
  (:ba1, :c, 'Chase operating', 'Chase', '8201', 'chase_csv'), (:ba2, :c, 'Savings', 'Chase', '8202', 'generic_csv'),
  (:ba3, :cb, 'Other operating', 'Chase', '8203', 'chase_csv'), (:ba4, :cr, 'Readiness operating', 'Chase', '8204', 'ofx'),
  (:ba5, :cs, 'Sandbox operating', 'Chase', '8205', 'chase_csv');
insert into app.center_payment_methods (center_id, method, accepted, instructions, sort) values
  (:c, 'check', true, '{"payee":"Payee Test Temple","address":"1 Temple Rd, Houston TX"}', 1),
  (:c, 'zelle', true, '{"recipient":"give@pc82.example","name":"Payee Test Temple","memo_hint":"Your member number"}', 3);
update app.centers set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{payments}',
         coalesce(rules->'payments', '{}'::jsonb) || jsonb_build_object('zelle', jsonb_build_object('bank_account_id', :ba1)))
 where id = :c;
select pg_temp.assert(pg_temp.in_step(:c) and pg_temp.zelle_recipient(:c) = 'give@pc82.example' and app.zelle_bank_account_id(:c) = :ba1,
  'fixtures: organization c has Zelle and checks accepted, the bank account linked, and its plugin rows in step');

-- ═════════════════════════════════════════════════════════════════════════════
-- Organizations that never use the new paths: first-time settings are saved exactly as before
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.claims('82000000-0000-4000-8000-000000000008');
set local role authenticated;
select app.set_payment_method('00000000-0000-4000-8000-000000008202', 'zelle', true,
  '{"recipient":"pay@cb82.example","name":"Other Test Temple"}', 3, 'First Zelle address');
select app.set_payment_method('00000000-0000-4000-8000-000000008202', 'zelle', true,
  '{"recipient":"PAY@cb82.example","name":"Other Test Temple","memo_hint":"Member number"}', 3, 'Memo wording and capital letters only');
select app.set_payment_plugin('00000000-0000-4000-8000-000000008202', 'check', true, '{"payee":"Other Test Temple","address":"2 Rd, Austin TX"}', null, null, 'Checks by mail');
select pg_temp.assert(not (app.set_zelle_reporting('00000000-0000-4000-8000-000000008202', 7, '82000000-0000-4000-8000-0000000000b3', 'First link') ? 'pending_change'),
  'choosing the Zelle bank account for the first time is saved at once, with no pending change');
select pg_temp.assert(app.set_zelle_reporting('00000000-0000-4000-8000-000000008202', 9, '82000000-0000-4000-8000-0000000000b3', 'A longer window')
                      = jsonb_build_object('report_window_days', 9, 'bank_account_id', :ba3),
  'saving the report window with the same account answers exactly as before (no second person, no 2FA)');
reset role;
select pg_temp.assert((select instructions->>'memo_hint' = 'Member number' and instructions->>'recipient' = 'PAY@cb82.example'
                         from app.center_payment_methods where center_id = :cb and method = 'zelle')
                      and not exists (select 1 from app.payee_changes where center_id = :cb) and pg_temp.in_step(:cb),
  'organization cb: a first Zelle address, a memo change and a capital-letter change are saved as before; no request exists');

-- ═════════════════════════════════════════════════════════════════════════════
-- One person alone changes nothing
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.claims('82000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select pg_temp.assert_raises($$select app.set_payment_method('00000000-0000-4000-8000-000000008201', 'zelle', true,
  '{"recipient":"new@pc82.example","name":"Payee Test Temple","memo_hint":"Your member number"}', 3, 'Change the address')$$,
  'needs a second person', 'a treasurer cannot change the Zelle address alone (set_payment_method)');
select pg_temp.assert_raises($$select app.set_payment_plugin('00000000-0000-4000-8000-000000008201', 'zelle', null,
  '{"recipient":"new@pc82.example","name":"Payee Test Temple","memo_hint":"Your member number"}', null, null, 'Change the address')$$,
  'needs a second person', 'nor through the plugin switch (set_payment_plugin)');
select pg_temp.assert_raises($$select app.set_payment_method('00000000-0000-4000-8000-000000008201', 'zelle', true,
  '{"recipient":"give@pc82.example","name":"Another Name","memo_hint":"Your member number"}', 3, 'Change the name')$$,
  'name shown in Zelle', 'the name shown in Zelle needs a second person too');
select pg_temp.assert_raises($$select app.set_payment_method('00000000-0000-4000-8000-000000008201', 'zelle', true,
  '{"recipient":"give@pc82.example","memo_hint":"Your member number"}', 3, 'Clear the name')$$,
  'name shown in Zelle', 'clearing the name is a change as well (clear, then set another is no way round)');
select pg_temp.assert_raises($$update app.center_payment_methods set instructions = '{"recipient":"x@y.example"}' where center_id = '00000000-0000-4000-8000-000000008201' and method = 'zelle'$$,
  'permission denied', 'nobody can write the method rows directly over the API');
-- What is allowed: the wording of the memo, and the same address in other letters.
select app.set_payment_method('00000000-0000-4000-8000-000000008201', 'zelle', true,
  '{"recipient":"GIVE@pc82.example","name":"Payee Test Temple","memo_hint":"Write your member number"}', 3, 'Memo wording');
reset role;
select pg_temp.assert(pg_temp.zelle_recipient(:c) = 'GIVE@pc82.example'
                      and (select instructions->>'memo_hint' = 'Write your member number' and instructions->>'name' = 'Payee Test Temple'
                             from app.center_payment_methods where center_id = :c and method = 'zelle'),
  'the memo wording and the capital letters of the same address are not payee changes');
select pg_temp.no_claims();
update app.center_payment_methods set instructions = jsonb_set(instructions, '{recipient}', '"give@pc82.example"') where center_id = :c and method = 'zelle';

-- A platform admin has no way round it either.
select pg_temp.claims('82000000-0000-4000-8000-000000000007', true);
set local role authenticated;
select pg_temp.assert_raises($$select app.set_payment_method('00000000-0000-4000-8000-000000008201', 'zelle', true,
  '{"recipient":"evil@elsewhere.example","name":"Payee Test Temple","memo_hint":"Write your member number"}', 3, 'Support fix')$$,
  'needs a second person', 'a platform admin cannot change where an organization''s Zelle gifts go');
reset role;
-- The guards sit on the tables: a signed-in person's direct write is refused, the background service is not asked.
select pg_temp.claims('82000000-0000-4000-8000-000000000001', true);
select pg_temp.assert_raises($$update app.center_payment_methods set instructions = '{"recipient":"x@y.example","name":"Payee Test Temple"}' where center_id = '00000000-0000-4000-8000-000000008201' and method = 'zelle'$$,
  'needs a second person', 'the guard on center_payment_methods refuses any signed-in route');
select pg_temp.assert_raises($$update app.centers set rules = jsonb_set(rules, '{payments,zelle,bank_account_id}', '"82000000-0000-4000-8000-0000000000b2"') where id = '00000000-0000-4000-8000-000000008201'$$,
  'bank account', 'the guard on centers.rules refuses a different Zelle bank account');
select pg_temp.assert_raises($$update app.centers set rules = jsonb_set(rules, '{payments,zelle,bank_account_id}', 'null') where id = '00000000-0000-4000-8000-000000008201'$$,
  'bank account', 'and clearing it');
update app.centers set rules = jsonb_set(rules, '{payments,zelle,report_window_days}', '12') where id = :c;
select pg_temp.assert(app.zelle_report_window_days(:c) = 12, 'other settings in rules.payments.zelle are not guarded');
update app.centers set rules = jsonb_set(rules, '{payments,zelle,report_window_days}', '10') where id = :c;
select pg_temp.no_claims();
update app.center_payment_methods set instructions = jsonb_set(instructions, '{recipient}', '"seed@pc82.example"') where center_id = :c and method = 'zelle';
select pg_temp.assert(pg_temp.zelle_recipient(:c) = 'seed@pc82.example', 'a session with no signed-in person (the service role, a seed) is not asked');
update app.center_payment_methods set instructions = jsonb_set(instructions, '{recipient}', '"give@pc82.example"') where center_id = :c and method = 'zelle';

-- ═════════════════════════════════════════════════════════════════════════════
-- Asking for a change
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.claims('82000000-0000-4000-8000-000000000005', true);
set local role authenticated;
select pg_temp.assert_state($$select app.request_payee_change('00000000-0000-4000-8000-000000008201', 'zelle', '{"recipient":"new@pc82.example"}', 'Moved')$$,
  '42501', 'a finance volunteer cannot ask for a change');
reset role;
select pg_temp.claims('82000000-0000-4000-8000-000000000006', true);
set local role authenticated;
select pg_temp.assert_state($$select app.request_payee_change('00000000-0000-4000-8000-000000008201', 'zelle', '{"recipient":"new@pc82.example"}', 'Moved')$$,
  '42501', 'nor a member');
reset role;
select pg_temp.claims('82000000-0000-4000-8000-000000000007', true);
set local role authenticated;
select pg_temp.assert_state($$select app.request_payee_change('00000000-0000-4000-8000-000000008201', 'zelle', '{"recipient":"new@pc82.example"}', 'Moved')$$,
  '42501', 'nor a Community Connect platform admin');
reset role;

-- Tanu: no fresh 2FA check.
select pg_temp.claims('82000000-0000-4000-8000-000000000002', false);
set local role authenticated;
select pg_temp.assert_state($$select app.request_payee_change('00000000-0000-4000-8000-000000008201', 'zelle', '{"recipient":"new@pc82.example"}', 'The treasurer moved to a new Zelle address')$$,
  'CCSTP', 'asking for a change needs a fresh 2FA check');
reset role;
select pg_temp.assert(not exists (select 1 from app.payee_changes where center_id = :c), 'and nothing was written');
select pg_temp.claims('82000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select pg_temp.assert_raises($$select app.request_payee_change('00000000-0000-4000-8000-000000008201', 'zelle', '{"recipient":"new@pc82.example"}', ' ')$$,
  'say why', 'asking for a change needs a reason');
select pg_temp.assert_raises($$select app.request_payee_change('00000000-0000-4000-8000-000000008201', 'zelle', '{"recipient":"not an address"}', 'Moved')$$,
  'email address or a US phone number', 'an address that is not an address is refused before anyone is asked to confirm it');
select pg_temp.assert_raises($$select app.request_payee_change('00000000-0000-4000-8000-000000008201', 'zelle', '{"recipient":"GIVE@pc82.example"}', 'Moved')$$,
  'same as the current value', 'the same address is not a change');
select pg_temp.assert_raises($$select app.request_payee_change('00000000-0000-4000-8000-000000008201', 'zelle', '{"memo_hint":"x"}', 'Moved')$$,
  'not something that needs a second approver', 'only payee fields are asked for this way');
select pg_temp.assert_raises($$select app.request_payee_change('00000000-0000-4000-8000-000000008201', 'zelle', '{}', 'Moved')$$,
  'say what to change', 'an empty request is refused');
select pg_temp.assert_raises($$select app.request_payee_change('00000000-0000-4000-8000-000000008201', 'zelle', '{"bank_account_id":"not-a-uuid"}', 'Moved')$$,
  'Choose one of the bank accounts', 'a bank account that is not an id is refused');
select pg_temp.assert_raises($$select app.request_payee_change('00000000-0000-4000-8000-000000008201', 'zelle', '{"bank_account_id":"82000000-0000-4000-8000-0000000000b3"}', 'Moved')$$,
  'active bank accounts', 'another organization''s bank account is refused');
select pg_temp.assert_raises($$select app.request_payee_change('00000000-0000-4000-8000-000000008201', 'paypal', '{"recipient":"new@pc82.example"}', 'Moved')$$,
  'Only the Zelle address', 'the PayPal email is not asked for here (it is asked for when the new one is verified)');
select app.request_payee_change('00000000-0000-4000-8000-000000008201', 'zelle', '{"recipient":"new@pc82.example"}', 'The treasurer moved to a new Zelle address') as r1 \gset
select (:'r1'::jsonb)->>'id' as req1 \gset
select pg_temp.assert((:'r1'::jsonb)->>'status' = 'pending', 'the request is waiting for a second person');
reset role;
select pg_temp.assert(pg_temp.zelle_recipient(:c) = 'give@pc82.example'
                      and (select changes #>> '{recipient,from}' = 'give@pc82.example' and changes #>> '{recipient,to}' = 'new@pc82.example'
                                  and status = 'pending' and requested_by = :tanu and decided_by is null and expires_at > now() + interval '13 days'
                             from app.payee_changes where id = :'req1'),
  'one person alone changed nothing: the address is still the old one; the request names old and new and who asked');
select pg_temp.assert((select reason = 'The treasurer moved to a new Zelle address' and module = 'giving' and actor_user_id = :tanu
                         from app.audit_log where action = 'payee_changes.insert' and record_id = :'req1'),
  'the first person''s reason is audited (module giving, by Tanu)');

-- What members and staff see while it waits: the old address, no notice.
select pg_temp.claims('82000000-0000-4000-8000-000000000006');
set local role authenticated;
select pg_temp.assert((select e#>>'{instructions,recipient}' = 'give@pc82.example' and not (e ? 'payee_notice')
                         from jsonb_array_elements(app.member_payment_methods(:c)->'methods') e where e->>'key' = 'zelle'),
  'members still see the old address and no notice while the request waits');
reset role;

-- The same person cannot confirm their own request.
select pg_temp.claims('82000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select pg_temp.assert_raises(format($$select app.decide_payee_change(%L, true, 'I approve my own request')$$, :'req1'),
  'different person', 'the person who asked cannot confirm their own change');
reset role;
select pg_temp.assert(pg_temp.req_status(:'req1') = 'pending' and pg_temp.zelle_recipient(:c) = 'give@pc82.example', 'and it is still waiting');

-- Someone without giving.approve cannot confirm.
select pg_temp.claims('82000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select pg_temp.assert_state(format($$select app.decide_payee_change(%L, true, 'Looks right')$$, :'req1'), '42501',
  'an administrator with integrations.manage but no giving.approve cannot confirm');
select pg_temp.assert_raises(format($$select app.decide_payee_change(%L, true, 'Looks right')$$, :'req1'), 'giving.approve',
  'and is told what is needed');
reset role;
select pg_temp.claims('82000000-0000-4000-8000-000000000005', true);
set local role authenticated;
select pg_temp.assert_state(format($$select app.decide_payee_change(%L, true, 'Looks right')$$, :'req1'), '42501', 'a finance volunteer cannot confirm');
reset role;
select pg_temp.claims('82000000-0000-4000-8000-000000000006', true);
set local role authenticated;
select pg_temp.assert_state(format($$select app.decide_payee_change(%L, true, 'Looks right')$$, :'req1'), '42501', 'a member cannot confirm');
reset role;
select pg_temp.claims('82000000-0000-4000-8000-000000000007', true);
set local role authenticated;
select pg_temp.assert_state(format($$select app.decide_payee_change(%L, true, 'Support approval')$$, :'req1'), '42501',
  'a Community Connect platform admin cannot confirm a change to where an organization''s gifts go');
reset role;
select pg_temp.assert(pg_temp.req_status(:'req1') = 'pending' and pg_temp.zelle_recipient(:c) = 'give@pc82.example', 'none of them changed anything');

-- The second person: a fresh 2FA check and a reason.
select pg_temp.claims('82000000-0000-4000-8000-000000000003', false);
set local role authenticated;
select pg_temp.assert_state(format($$select app.decide_payee_change(%L, true, 'Checked with the bank')$$, :'req1'), 'CCSTP',
  'confirming needs a fresh 2FA check');
reset role;
select pg_temp.assert(pg_temp.req_status(:'req1') = 'pending' and pg_temp.zelle_recipient(:c) = 'give@pc82.example', 'and without it nothing changed');
select pg_temp.claims('82000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select pg_temp.assert_raises(format($$select app.decide_payee_change(%L, true, ' ')$$, :'req1'), 'say why', 'confirming needs a reason');
select pg_temp.assert((app.decide_payee_change(:'req1', true, 'Checked with the bank that the new address is ours')->>'status') = 'applied',
  'a different treasurer with a fresh 2FA check and a reason confirms it');
select pg_temp.assert_raises(format($$select app.decide_payee_change(%L, true, 'Again')$$, :'req1'), 'already confirmed', 'a confirmed request cannot be confirmed twice');
reset role;
select pg_temp.assert(pg_temp.zelle_recipient(:c) = 'new@pc82.example'
                      and (select instructions->>'name' = 'Payee Test Temple' and instructions->>'memo_hint' = 'Write your member number'
                             from app.center_payment_methods where center_id = :c and method = 'zelle')
                      and (select status = 'applied' and requested_by = :tanu and decided_by = :tara and applied_at is not null
                                  and decision_reason = 'Checked with the bank that the new address is ours'
                             from app.payee_changes where id = :'req1')
                      and (select live_approved_by = :tara and changed_by = :tanu and live_approved_at is not null
                             from app.center_payment_plugins where center_id = :c and plugin_key = 'zelle')
                      and pg_temp.in_step(:c),
  'confirmed: the address changed, the rest of the instructions did not, both people are recorded and the plugin row is in step');
select pg_temp.assert((select reason = 'Checked with the bank that the new address is ours' and actor_user_id = :tara
                         from app.audit_log where action = 'payee_changes.update' and record_id = :'req1' order by id desc limit 1),
  'the second person''s reason is audited on the request');
select pg_temp.assert((select reason like 'Payee change confirmed by a second person: Checked with the bank%' and actor_user_id = :tara
                         from app.audit_log where action = 'center_payment_methods.update' and record_id = :c || ':zelle' order by id desc limit 1),
  'and the change of the address itself is audited with that reason');
select pg_temp.claims('82000000-0000-4000-8000-000000000006');
set local role authenticated;
select pg_temp.assert((select e#>>'{instructions,recipient}' = 'new@pc82.example' and e#>>'{payee_notice,days}' = '30'
                              and e#>>'{payee_notice,changed_on}' = ((now() at time zone coalesce(nullif((select time_zone from app.centers where id = :c), ''), 'America/Chicago'))::date)::text
                              and e#>>'{payee_notice,text}' like 'The Zelle details changed on %. Check it before you pay.'
                         from jsonb_array_elements(app.member_payment_methods(:c)->'methods') e where e->>'key' = 'zelle'),
  'members now see the new address with a dated notice for 30 days');
reset role;

-- Turning a change down, withdrawing one, and a newer request replacing a waiting one.
select pg_temp.claims('82000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select (app.request_payee_change(:c, 'zelle', '{"name":"Payee Test Temple Inc"}', 'The legal name has Inc'))->>'id' as req2 \gset
reset role;
select pg_temp.claims('82000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select pg_temp.assert_raises(format($$select app.decide_payee_change(%L, false, ' ')$$, :'req2'), 'say why', 'turning a change down needs a reason too');
select pg_temp.assert((app.decide_payee_change(:'req2', false, 'The bank account is held under the old name'))->>'status' = 'rejected', 'the second person turns the change down');
reset role;
select pg_temp.assert(pg_temp.req_status(:'req2') = 'rejected' and (select instructions->>'name' = 'Payee Test Temple' from app.center_payment_methods where center_id = :c and method = 'zelle')
                      and (select decided_by = :tara from app.payee_changes where id = :'req2'),
  'turned down: nothing changed');

select pg_temp.claims('82000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select (app.request_payee_change(:c, 'zelle', '{"recipient":"owner@pc82.example"}', 'The owner prefers her own address'))->>'id' as req3 \gset
select pg_temp.assert_raises(format($$select app.cancel_payee_change(%L, ' ')$$, :'req3'), 'say why', 'withdrawing a request needs a reason');
select app.cancel_payee_change(:'req3', 'Asked too early');
reset role;
select pg_temp.claims('82000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select pg_temp.assert_raises(format($$select app.decide_payee_change(%L, true, 'ok')$$, :'req3'), 'withdrawn', 'a withdrawn request cannot be confirmed');
reset role;
select pg_temp.assert(pg_temp.req_status(:'req3') = 'cancelled' and pg_temp.zelle_recipient(:c) = 'new@pc82.example', 'the owner may ask, and withdraw; nothing changed');

select pg_temp.claims('82000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select (app.request_payee_change(:c, 'zelle', '{"recipient":"x1@pc82.example"}', 'First attempt'))->>'id' as req4 \gset
reset role;
select pg_temp.claims('82000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select (app.request_payee_change(:c, 'zelle', '{"recipient":"x2@pc82.example"}', 'Second attempt by the other administrator'))->>'id' as req5 \gset
reset role;
select pg_temp.assert(pg_temp.req_status(:'req4') = 'superseded' and pg_temp.req_status(:'req5') = 'pending',
  'a newer request for the same field replaces the waiting one');
select pg_temp.claims('82000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select pg_temp.assert_raises(format($$select app.decide_payee_change(%L, true, 'ok')$$, :'req4'), 'replaced by a newer request', 'a replaced request cannot be confirmed');
reset role;
-- The owner can be the second person.
select pg_temp.claims('82000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select pg_temp.assert((app.decide_payee_change(:'req5', true, 'Confirmed with the administrator by phone'))->>'status' = 'applied', 'the owner can be the second person');
reset role;
select pg_temp.assert(pg_temp.zelle_recipient(:c) = 'x2@pc82.example', 'the address is the confirmed one');

-- A request that lapsed cannot be confirmed; asking again marks it lapsed.
select pg_temp.claims('82000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select (app.request_payee_change(:c, 'zelle', '{"recipient":"x3@pc82.example"}', 'Third attempt'))->>'id' as req6 \gset
reset role;
update app.payee_changes set expires_at = now() - interval '1 day' where id = :'req6';
select pg_temp.claims('82000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select pg_temp.assert_raises(format($$select app.decide_payee_change(%L, true, 'ok')$$, :'req6'), 'lapsed', 'a request that lapsed (14 days) cannot be confirmed');
reset role;
select pg_temp.claims('82000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select (app.request_payee_change(:c, 'zelle', '{"recipient":"x4@pc82.example"}', 'Fourth attempt'))->>'id' as req7 \gset
select app.cancel_payee_change(:'req7', 'Not needed after all');
reset role;
select pg_temp.assert(pg_temp.req_status(:'req6') = 'expired' and pg_temp.req_status(:'req7') = 'cancelled' and pg_temp.zelle_recipient(:c) = 'x2@pc82.example',
  'asking again marked the lapsed request lapsed; nothing changed');

-- The bank account Zelle payments arrive in: the window is saved now, the account waits for a second person.
select pg_temp.claims('82000000-0000-4000-8000-000000000002', false);
set local role authenticated;
select pg_temp.assert_state($$select app.set_zelle_reporting('00000000-0000-4000-8000-000000008201', 7, '82000000-0000-4000-8000-0000000000b2', 'Move Zelle to the savings account')$$,
  'CCSTP', 'changing the Zelle bank account needs a fresh 2FA check');
reset role;
select pg_temp.assert(app.zelle_report_window_days(:c) = 10 and app.zelle_bank_account_id(:c) = :ba1, 'and without it neither the window nor the account changed');
select pg_temp.claims('82000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select app.set_zelle_reporting('00000000-0000-4000-8000-000000008201', 7, '82000000-0000-4000-8000-0000000000b2', 'Move Zelle to the savings account') as zr \gset
reset role;
select (:'zr'::jsonb)->>'pending_change' as req8 \gset
select pg_temp.assert(app.zelle_report_window_days(:c) = 7 and app.zelle_bank_account_id(:c) = :ba1 and (:'zr'::jsonb)->>'bank_account_id' = '82000000-0000-4000-8000-0000000000b1'
                      and pg_temp.req_status(:'req8') = 'pending',
  'the window was saved at once; the account stays as it was until a second person confirms the change');
select pg_temp.claims('82000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select pg_temp.assert((select (r->'fields'->0->>'label') = 'the bank account Zelle payments arrive in' and (r->'fields'->0->>'to') like 'Savings%8202'
                              and (r->'fields'->0->>'from') like 'Chase operating%8201' and (r->>'mine')::boolean = false
                         from jsonb_array_elements(app.payee_change_queue(:c)->'requests') r where r->>'id' = :'req8'),
  'the waiting request shows the account names, not ids, and is not Tara''s own');
select pg_temp.assert((app.decide_payee_change(:'req8', true, 'The savings account receives Zelle now'))->>'status' = 'applied', 'a second person confirms the new account');
reset role;
select pg_temp.assert(app.zelle_bank_account_id(:c) = :ba2 and app.zelle_report_window_days(:c) = 7, 'the Zelle bank account changed only after that');

-- The PayPal email: the first one is saved at once; replacing it waits for a second person.
select pg_temp.no_claims();
select app.payment_processor_ensure(:c, 'paypal');
select id as conn from app.integration_connections where center_id = :c and provider = 'paypal' \gset
insert into app.paypal_email_verifications (center_id, connection_id, email, code_hash, expires_at, requested_by)
values (:c, :'conn', 'first@pp82.example', encode(extensions.digest('123456:' || :c, 'sha256'), 'hex'), now() + interval '15 minutes', :ami);
select pg_temp.claims('82000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select app.confirm_paypal_email('00000000-0000-4000-8000-000000008201', '123456') as pp1 \gset
reset role;
select pg_temp.assert((:'pp1'::jsonb)->>'ok' = 'true' and not (:'pp1'::jsonb ? 'pending')
                      and (select ic.status = 'connected' and ic.settings->>'paypal_email' = 'first@pp82.example'
                             from app.integration_connections ic where ic.id = :'conn')
                      and (select cp.status = 'test' from app.center_payment_processors cp where cp.center_id = :c and cp.processor = 'paypal')
                      and not exists (select 1 from app.payee_changes where center_id = :c and plugin_key = 'paypal'),
  'the first PayPal Business email is verified and saved at once, as before');
select pg_temp.no_claims();
insert into app.paypal_email_verifications (center_id, connection_id, email, code_hash, expires_at, requested_by)
values (:c, :'conn', 'second@pp82.example', encode(extensions.digest('123456:' || :c, 'sha256'), 'hex'), now() + interval '15 minutes', :ami)
on conflict (center_id) do update set connection_id = excluded.connection_id, email = excluded.email, code_hash = excluded.code_hash,
  expires_at = excluded.expires_at, attempts = 0, used_at = null;
select pg_temp.claims('82000000-0000-4000-8000-000000000001', true);
select pg_temp.assert_raises($$update app.integration_connections set settings = settings || '{"paypal_email":"direct@pp82.example"}' where center_id = '00000000-0000-4000-8000-000000008201' and provider = 'paypal'$$,
  'PayPal email needs a second person', 'the guard on connections refuses a direct change of the PayPal email');
set local role authenticated;
select app.confirm_paypal_email('00000000-0000-4000-8000-000000008201', '123456') as pp2 \gset
reset role;
select (:'pp2'::jsonb)->>'request_id' as req9 \gset
select pg_temp.assert((:'pp2'::jsonb)->>'ok' = 'true' and (:'pp2'::jsonb)->>'pending' = 'true'
                      and (select ic.settings->>'paypal_email' = 'first@pp82.example' from app.integration_connections ic where ic.id = :'conn')
                      and pg_temp.req_status(:'req9') = 'pending'
                      and (select changes #>> '{paypal_email,to}' = 'second@pp82.example' and plugin_key = 'paypal' from app.payee_changes where id = :'req9'),
  'replacing the PayPal email waits for a second person: the connection still names the first email');
select pg_temp.claims('82000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select pg_temp.assert((select r->>'status' = 'pending' and r->>'plugin_key' = 'paypal'
                         from jsonb_array_elements(app.payee_change_queue(:c)->'requests') r limit 1),
  'a waiting request is listed first');
select pg_temp.assert((app.decide_payee_change(:'req9', true, 'Checked the PayPal Business account with the treasurer'))->>'status' = 'applied', 'a second person confirms the new PayPal email');
reset role;
select pg_temp.assert((select ic.status = 'connected' and ic.settings->>'paypal_email' = 'second@pp82.example' and ic.settings->>'paypal_email_verified_at' is not null
                              and ic.settings->>'connect_method' = 'email'
                         from app.integration_connections ic where ic.id = :'conn')
                      and (select cp.status = 'test' from app.center_payment_processors cp where cp.center_id = :c and cp.processor = 'paypal'),
  'the PayPal email changed only then, and PayPal is connected in test mode again');

-- ═════════════════════════════════════════════════════════════════════════════
-- A direct write to the connection rows cannot go round the guard
-- ═════════════════════════════════════════════════════════════════════════════
-- The table grant of 0001 lets a signed-in person write every app table and the policy lets integrations.manage write this
-- one, so without a guard one administrator could delete the PayPal row, verify any email as "the first", or write the
-- connected account's id. The grant is still there; the guard is what closes it.
select pg_temp.assert(has_table_privilege('authenticated', 'app.integration_connections', 'insert')
                      and has_table_privilege('authenticated', 'app.integration_connections', 'update')
                      and has_table_privilege('authenticated', 'app.integration_connections', 'delete'),
  'the table grant still lets a signed-in person write the connection rows (so the guard, not the grant, is what closes the route)');
select pg_temp.no_claims();
insert into app.integration_connections (center_id, provider, status, external_account_id, display_name, settings)
values (:c, 'stripe', 'connected', 'acct_82TEST', 'Stripe', '{"mode":"test","charges_enabled":true}');
-- Basil administers a second organization for a moment (the sandbox, which has no PayPal row): the person in two
-- organizations who tries to move a connected row from one to the other.
insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id) values (:cs, :basil, 'center_admin', 'center', null);
select pg_temp.claims('82000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select pg_temp.assert_raises($$delete from app.integration_connections where center_id = '00000000-0000-4000-8000-000000008201' and provider = 'paypal'$$,
  'cannot be deleted', 'an administrator with only integrations.manage cannot delete the PayPal connection to start again');
select pg_temp.assert_raises($$update app.integration_connections set settings = settings - 'paypal_email' where center_id = '00000000-0000-4000-8000-000000008201' and provider = 'paypal'$$,
  'PayPal email needs a second person', 'nor clear the saved PayPal email');
select pg_temp.assert_raises($$update app.integration_connections set settings = settings || '{"paypal_email":"direct@pp82.example"}' where center_id = '00000000-0000-4000-8000-000000008201' and provider = 'paypal'$$,
  'PayPal email needs a second person', 'nor replace it');
select pg_temp.assert_raises($$update app.integration_connections set provider = 'other' where center_id = '00000000-0000-4000-8000-000000008201' and provider = 'paypal'$$,
  'cannot be moved to another provider', 'nor move the row to another provider and back');
select pg_temp.assert_raises($$update app.integration_connections set external_account_id = 'acct_evil' where center_id = '00000000-0000-4000-8000-000000008201' and provider = 'stripe'$$,
  'set by the connect flow', 'nor write the Stripe account id directly');
select pg_temp.assert_raises($$delete from app.integration_connections where center_id = '00000000-0000-4000-8000-000000008201' and provider = 'stripe'$$,
  'cannot be deleted', 'nor delete the Stripe connection');
-- An email-connected PayPal row has an email and no account id. Giving it one would redirect PayPal gifts (checkout prefers the
-- account id over the email), so once the row holds ANY payee the account id is closed as well.
select pg_temp.assert_raises($$update app.integration_connections set external_account_id = 'MERCHANT_EVIL' where center_id = '00000000-0000-4000-8000-000000008201' and provider = 'paypal'$$,
  'set by the connect flow', 'nor give the email-connected PayPal row a merchant account id');
select pg_temp.assert_raises($$insert into app.integration_connections (center_id, provider, status, external_account_id)
  values ('00000000-0000-4000-8000-000000008201', 'paypal', 'connected', 'MERCHANT_EVIL')
  on conflict (center_id, provider) do update set external_account_id = excluded.external_account_id$$,
  'set by the connect flow', 'nor do the same with an upsert (insert ... on conflict do update)');
select pg_temp.assert_raises($$insert into app.integration_connections (center_id, provider, status, settings)
  values ('00000000-0000-4000-8000-000000008201', 'paypal', 'connected', '{"paypal_email":"upsert@pp82.example"}')
  on conflict (center_id, provider) do update set settings = excluded.settings$$,
  'PayPal email needs a second person', 'nor replace the PayPal email with an upsert');
select pg_temp.assert_raises($$update app.integration_connections set external_account_id = null where center_id = '00000000-0000-4000-8000-000000008201' and provider = 'stripe'$$,
  'set by the connect flow', 'nor clear the Stripe account id');
-- A connection belongs to one organization: moving it would leave the first with an empty row, and the next email verified
-- there would count as "the first one" with no second person.
select pg_temp.assert_raises($$update app.integration_connections set center_id = '00000000-0000-4000-8000-000000008203' where center_id = '00000000-0000-4000-8000-000000008201' and provider = 'paypal'$$,
  'cannot be moved to another organization', 'a person who administers two organizations cannot move one organization''s connected PayPal row to the other');
select pg_temp.assert_raises($$update app.integration_connections set center_id = '00000000-0000-4000-8000-000000008203' where center_id = '00000000-0000-4000-8000-000000008201' and provider = 'stripe'$$,
  'cannot be moved to another organization', 'nor the Stripe row');
reset role;
select pg_temp.no_claims();
delete from app.role_grants where center_id = :cs and user_id = :basil;
delete from app.center_owners where center_id = :cs and user_id = :basil;
-- A platform admin has every permission through has_permission, so the table's policy lets them write these rows; the guard does not.
select pg_temp.claims('82000000-0000-4000-8000-000000000007', true);
set local role authenticated;
select pg_temp.assert_raises($$update app.integration_connections set external_account_id = 'MERCHANT_EVIL' where center_id = '00000000-0000-4000-8000-000000008201' and provider = 'paypal'$$,
  'set by the connect flow', 'a platform admin cannot write an account id on a connected PayPal row either');
select pg_temp.assert_raises($$update app.integration_connections set settings = settings || '{"paypal_email":"admin@cc.example"}' where center_id = '00000000-0000-4000-8000-000000008201' and provider = 'paypal'$$,
  'PayPal email needs a second person', 'nor replace its email');
select pg_temp.assert_raises($$delete from app.integration_connections where center_id = '00000000-0000-4000-8000-000000008201' and provider = 'paypal'$$,
  'cannot be deleted', 'nor delete it');
select pg_temp.assert_raises($$update app.integration_connections set center_id = '00000000-0000-4000-8000-000000008203' where center_id = '00000000-0000-4000-8000-000000008201' and provider = 'stripe'$$,
  'cannot be moved to another organization', 'nor move a connected row to another organization');
select pg_temp.assert_raises($$insert into app.integration_connections (center_id, provider, status, external_account_id)
  values ('00000000-0000-4000-8000-000000008201', 'stripe', 'connected', 'acct_admin')
  on conflict (center_id, provider) do update set external_account_id = excluded.external_account_id$$,
  'set by the connect flow', 'nor upsert one');
reset role;
select pg_temp.assert((select ic.settings->>'paypal_email' = 'second@pp82.example' and ic.external_account_id is null and ic.center_id = :c
                         from app.integration_connections ic where ic.id = :'conn')
                      and (select external_account_id = 'acct_82TEST' from app.integration_connections where center_id = :c and provider = 'stripe')
                      and not exists (select 1 from app.integration_connections where center_id = :cs and provider in ('paypal', 'stripe')),
  'none of those attempts changed anything');
-- The connect flow (the background service: no signed-in person) is not asked, so it can still connect.
select pg_temp.no_claims();
update app.integration_connections set external_account_id = 'acct_82NEW' where center_id = :c and provider = 'stripe';
select pg_temp.assert((select external_account_id = 'acct_82NEW' from app.integration_connections where center_id = :c and provider = 'stripe'),
  'the connect flow can still set the account id');

-- "Connect with PayPal" saves a merchant account, not an email; replacing it with a verified email is a payee change too.
update app.integration_connections set external_account_id = 'MERCHANT82', settings = (settings - 'paypal_email') || '{"connect_method":"partner"}' where id = :'conn';
insert into app.paypal_email_verifications (center_id, connection_id, email, code_hash, expires_at, requested_by)
values (:c, :'conn', 'third@pp82.example', encode(extensions.digest('123456:' || :c, 'sha256'), 'hex'), now() + interval '15 minutes', :ami)
on conflict (center_id) do update set connection_id = excluded.connection_id, email = excluded.email, code_hash = excluded.code_hash,
  expires_at = excluded.expires_at, attempts = 0, used_at = null;
select pg_temp.claims('82000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select app.confirm_paypal_email('00000000-0000-4000-8000-000000008201', '123456') as pp3 \gset
reset role;
select (:'pp3'::jsonb)->>'request_id' as req11 \gset
select pg_temp.assert((:'pp3'::jsonb)->>'pending' = 'true' and pg_temp.req_status(:'req11') = 'pending'
                      and (select ic.external_account_id = 'MERCHANT82' and ic.settings->>'connect_method' = 'partner' and ic.settings->>'paypal_email' is null
                             from app.integration_connections ic where ic.id = :'conn'),
  'verifying an email on a PayPal account connected with "Connect with PayPal" waits for a second person; the merchant account stays');
select pg_temp.claims('82000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select pg_temp.assert((app.decide_payee_change(:'req11', true, 'The treasurer moved PayPal to the Business email'))->>'status' = 'applied', 'a second person confirms it');
reset role;
select pg_temp.assert((select ic.external_account_id is null and ic.settings->>'paypal_email' = 'third@pp82.example' and ic.settings->>'connect_method' = 'email'
                         from app.integration_connections ic where ic.id = :'conn'),
  'and only then does PayPal move to the email');

-- ═════════════════════════════════════════════════════════════════════════════
-- "Fresh 2FA" is conditional: the rule of app.assert_step_up (0150)
-- ═════════════════════════════════════════════════════════════════════════════
-- (Tara is staff of this organization only: the rule is read for every organization a person is staff of.)
-- A payee change asks for a fresh 2FA check from a person who has an authenticator app, or whose organization requires 2FA
-- for its staff (the default for a new community). Communities that existed in 0150 (JSH among them) have the rule off, and
-- a person there without an authenticator app is not asked. This is an owner decision of 0150 and is not changed here.
select pg_temp.no_claims();
update app.centers set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{security}', coalesce(rules->'security', '{}'::jsonb) || '{"require_2fa_for_staff": false}') where id = :c;
select pg_temp.claims('82000000-0000-4000-8000-000000000003', false);
set local role authenticated;
select (app.request_payee_change(:c, 'zelle', '{"recipient":"rule-off@pc82.example"}', 'Checking the 2FA rule'))->>'id' as req10 \gset
select app.cancel_payee_change(:'req10', 'Only checking the 2FA rule');
reset role;
select pg_temp.assert(pg_temp.req_status(:'req10') = 'cancelled',
  '2FA rule off and no authenticator app: the person is not asked for a fresh check (the caveat stated in the pull request)');
select pg_temp.no_claims();
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status) values ('82000000-0000-4000-8000-0000000000f2', :tara, 'Phone', 'totp', 'verified');
select pg_temp.claims('82000000-0000-4000-8000-000000000003', false);
set local role authenticated;
select pg_temp.assert_state($$select app.request_payee_change('00000000-0000-4000-8000-000000008201', 'zelle', '{"recipient":"rule-off@pc82.example"}', 'Checking the 2FA rule')$$,
  'CCSTP', '2FA rule off but the person has an authenticator app: a fresh check is asked');
reset role;
select pg_temp.no_claims();
delete from auth.mfa_factors where id = '82000000-0000-4000-8000-0000000000f2';
update app.centers set rules = rules #- '{security,require_2fa_for_staff}' where id = :c;
select pg_temp.claims('82000000-0000-4000-8000-000000000003', false);
set local role authenticated;
select pg_temp.assert_state($$select app.request_payee_change('00000000-0000-4000-8000-000000008201', 'zelle', '{"recipient":"rule-off@pc82.example"}', 'Checking the 2FA rule')$$,
  'CCSTP', '2FA rule on (the default of a new community): a fresh check is asked even without an authenticator app');
reset role;

-- ═════════════════════════════════════════════════════════════════════════════
-- A waiting request is checked again when it is confirmed, and withdrawn when what it waits for goes away
-- ═════════════════════════════════════════════════════════════════════════════
-- The person who asked must still hold a role that may ask (Basil's administrator role ends while his request waits).
select pg_temp.claims('82000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select (app.request_payee_change(:c, 'zelle', '{"recipient":"asker-gone@pc82.example"}', 'Moving Zelle to a new address'))->>'id' as req12 \gset
reset role;
select pg_temp.no_claims();
update app.role_grants set status = 'revoked' where center_id = :c and user_id = :basil;
select pg_temp.claims('82000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select pg_temp.assert_raises(format($$select app.decide_payee_change(%L, true, 'Looks right')$$, :'req12'), 'no longer holds a role',
  'a request cannot be confirmed once the person who asked has lost the role that lets them ask');
select pg_temp.assert((app.decide_payee_change(:'req12', false, 'The person who asked no longer has that role'))->>'status' = 'rejected',
  'but it can still be turned down');
reset role;
select pg_temp.no_claims();
update app.role_grants set status = 'active' where center_id = :c and user_id = :basil;
select pg_temp.assert(pg_temp.zelle_recipient(:c) = 'x2@pc82.example', 'and the address is still the confirmed one');

-- PayPal is disconnected while a new email waits: the request is withdrawn, it cannot bring PayPal back.
insert into app.paypal_email_verifications (center_id, connection_id, email, code_hash, expires_at, requested_by)
values (:c, :'conn', 'fourth@pp82.example', encode(extensions.digest('123456:' || :c, 'sha256'), 'hex'), now() + interval '15 minutes', :ami)
on conflict (center_id) do update set connection_id = excluded.connection_id, email = excluded.email, code_hash = excluded.code_hash,
  expires_at = excluded.expires_at, attempts = 0, used_at = null;
select pg_temp.claims('82000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select app.confirm_paypal_email('00000000-0000-4000-8000-000000008201', '123456') as pp4 \gset
reset role;
select (:'pp4'::jsonb)->>'request_id' as req13 \gset
select pg_temp.assert((:'pp4'::jsonb)->>'pending' = 'true' and pg_temp.req_status(:'req13') = 'pending', 'a new PayPal email waits for a second person');
select pg_temp.claims('82000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select app.disconnect_payment_processor('00000000-0000-4000-8000-000000008201', 'paypal', 'We stopped taking PayPal');
reset role;
select pg_temp.assert(pg_temp.req_status(:'req13') = 'cancelled'
                      and (select decision_reason like 'PayPal was disconnected%' from app.payee_changes where id = :'req13')
                      and (select ic.status = 'disconnected' and ic.settings->>'paypal_email' = 'third@pp82.example' from app.integration_connections ic where ic.id = :'conn'),
  'disconnecting PayPal withdraws the waiting request, and the saved email is untouched');
select pg_temp.claims('82000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select pg_temp.assert_raises(format($$select app.decide_payee_change(%L, true, 'Looks right')$$, :'req13'), 'withdrawn',
  'so a second person cannot confirm it and bring a disconnected PayPal back');
reset role;
select pg_temp.no_claims();
update app.integration_connections set status = 'connected' where id = :'conn';
update app.center_payment_processors set status = 'test' where center_id = :c and processor = 'paypal';

-- Zelle is switched off while a change waits: withdrawn as well.
select instructions as zi from app.center_payment_methods where center_id = :c and method = 'zelle' \gset
select pg_temp.claims('82000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select (app.request_payee_change(:c, 'zelle', '{"recipient":"switch-off@pc82.example"}', 'Moving Zelle to a new address'))->>'id' as req14 \gset
select app.set_payment_method('00000000-0000-4000-8000-000000008201', 'zelle', false, :'zi'::jsonb, 3, 'We stopped taking Zelle for now');
reset role;
select pg_temp.assert(pg_temp.req_status(:'req14') = 'cancelled' and (select decision_reason like 'Zelle was switched off%' from app.payee_changes where id = :'req14'),
  'switching Zelle off withdraws the waiting request');
select pg_temp.claims('82000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select app.set_payment_method('00000000-0000-4000-8000-000000008201', 'zelle', true, :'zi'::jsonb, 3, 'Zelle is back');
reset role;
select pg_temp.assert(pg_temp.zelle_recipient(:c) = 'x2@pc82.example' and pg_temp.in_step(:c), 'and switching it back on does not change the address');

-- The bank account chosen must still be an active account when the change is confirmed.
select pg_temp.claims('82000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select (app.request_payee_change(:c, 'zelle', '{"bank_account_id":"82000000-0000-4000-8000-0000000000b1"}', 'Back to the operating account'))->>'id' as req15 \gset
reset role;
select pg_temp.no_claims();
update app.bank_accounts set active = false where id = :ba1;
select pg_temp.claims('82000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select pg_temp.assert_raises(format($$select app.decide_payee_change(%L, true, 'Looks right')$$, :'req15'), 'no longer an active account',
  'a bank account that was closed while the change waited is refused when it is confirmed');
reset role;
select pg_temp.no_claims();
update app.bank_accounts set active = true where id = :ba1;
select pg_temp.claims('82000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select app.cancel_payee_change(:'req15', 'Not needed after all');
reset role;
select pg_temp.assert(app.zelle_bank_account_id(:c) = :ba2 and pg_temp.req_status(:'req15') = 'cancelled', 'and the Zelle bank account is the one confirmed before');

-- Who sees the requests.
select pg_temp.claims('82000000-0000-4000-8000-000000000006');
set local role authenticated;
select pg_temp.assert_state($$select app.payee_change_queue('00000000-0000-4000-8000-000000008201')$$, '42501', 'a member cannot read the requests');
select pg_temp.assert(not exists (select 1 from app.payee_changes), 'nor read the table');
reset role;
select pg_temp.claims('82000000-0000-4000-8000-000000000008');
set local role authenticated;
select pg_temp.assert(not exists (select 1 from app.payee_changes where center_id = '00000000-0000-4000-8000-000000008201'), 'another organization''s treasurer reads none of them');
select pg_temp.assert_state($$select app.payee_change_queue('00000000-0000-4000-8000-000000008201')$$, '42501', 'or its queue');
reset role;
select pg_temp.claims('82000000-0000-4000-8000-000000000004');
set local role authenticated;
select pg_temp.assert((select (q->>'can_request')::boolean and not (q->>'can_approve')::boolean from app.payee_change_queue(:c) q),
  'an administrator may ask but not confirm');
reset role;
select pg_temp.claims('82000000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.assert((select (q->>'can_request')::boolean and (q->>'can_approve')::boolean and jsonb_array_length(q->'requests') >= 8 from app.payee_change_queue(:c) q)
                      and exists (select 1 from app.payee_changes where center_id = '00000000-0000-4000-8000-000000008201'),
  'a treasurer reads the queue and the table of her own organization');
select pg_temp.assert_raises($$insert into app.payee_changes (center_id, plugin_key, changes, requested_by, request_reason, expires_at)
  values ('00000000-0000-4000-8000-000000008201', 'zelle', '{"recipient":{"from":"a","to":"b"}}', '82000000-0000-4000-8000-000000000003', 'x', now())$$,
  'permission denied', 'nobody writes a request directly');
reset role;

-- ═════════════════════════════════════════════════════════════════════════════
-- Community Connect's pause
-- ═════════════════════════════════════════════════════════════════════════════
-- Money that is already on its way is never stopped by a pause. Set up now, finished while the way to pay is paused: a Zelle
-- report and the payment it matches, and a card payment that was started before the pause.
select pg_temp.no_claims();
insert into app.payments (id, center_id, household_id, amount_cents, method, status, provider, provider_ref, received_on)
values ('82000000-0000-4000-8000-0000000000e2', :c, :h1, 4200, 'zelle', 'settled', 'bank', 'bank82c', current_date);
insert into app.payment_reports (id, center_id, household_id, reported_by, amount_cents, sent_on, window_days, due_on)
values ('82000000-0000-4000-8000-0000000000d3', :c, :h1, :mira, 4200, current_date - 1, 10, current_date + 9);
insert into app.payment_checkouts (id, center_id, household_id, processor, mode, context, amount_cents, for_label, status, provider_ref)
values ('82000000-0000-4000-8000-0000000000f5', :c, :h1, 'stripe', 'test', 'other', 5000, 'Gift started before the pause', 'pending', 'cs_82pre');
select pg_temp.claims('82000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select pg_temp.assert_state($$select app.suspend_payment_plugin('zelle', '00000000-0000-4000-8000-000000008201', 'We want it off')$$, '42501',
  'an organization''s owner cannot pause a way to pay');
select pg_temp.assert_state($$select app.suspend_payment_plugin('card', null, 'We want it off')$$, '42501', 'nor pause it for everyone');
select pg_temp.assert_state($$select app.payment_plugin_pauses()$$, '42501', 'nor read the pauses');
select pg_temp.assert(not exists (select 1 from app.payment_plugin_suspensions), 'nor read the table');
reset role;
select pg_temp.claims('82000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select pg_temp.assert_state($$select app.suspend_payment_plugin('zelle', '00000000-0000-4000-8000-000000008201', 'We want it off')$$, '42501', 'a treasurer cannot either');
reset role;

select pg_temp.claims('82000000-0000-4000-8000-000000000007', false);
set local role authenticated;
select pg_temp.assert_state($$select app.suspend_payment_plugin('zelle', '00000000-0000-4000-8000-000000008201', 'The bank reported a problem')$$, 'CCSTP',
  'pausing needs a fresh 2FA check');
reset role;
select pg_temp.claims('82000000-0000-4000-8000-000000000007', true);
set local role authenticated;
select pg_temp.assert_raises($$select app.suspend_payment_plugin('zelle', '00000000-0000-4000-8000-000000008201', ' ')$$, 'say why', 'and a reason');
select pg_temp.assert_raises($$select app.suspend_payment_plugin('venmo_direct', null, 'x')$$, 'not a payment method', 'an unknown way to pay is refused');
select pg_temp.assert_raises($$select app.suspend_payment_plugin('zelle', '00000000-0000-4000-8000-0000000099ff', 'x')$$, 'community was not found', 'and an unknown community');
select (app.suspend_payment_plugin('zelle', '00000000-0000-4000-8000-000000008201', 'The bank reported a problem with Zelle receiving'))->>'id' as sp1 \gset
select pg_temp.assert_raises($$select app.suspend_payment_plugin('zelle', '00000000-0000-4000-8000-000000008201', 'Again')$$, 'already paused for that community', 'pausing twice is refused');
select pg_temp.assert(exists (select 1 from app.payment_plugin_suspensions where plugin_key = 'zelle') and jsonb_array_length(app.payment_plugin_pauses()->'plugins') = 12,
  'a platform admin reads the pauses');
reset role;
select pg_temp.assert(pg_temp.st(:c, 'zelle') = 'suspended' and pg_temp.st(:cb, 'zelle') <> 'suspended' and pg_temp.in_step(:c) and pg_temp.in_step(:cb)
                      and app.payment_plugin_problem(:c, 'zelle') = 'Community Connect has paused Zelle for now.',
  'paused for one organization: the stored row says so at once, the other organization is untouched');
select pg_temp.assert((select reason = 'The bank reported a problem with Zelle receiving' and actor_user_id = :pat
                         from app.audit_log where action = 'payment_plugin_suspensions.insert' order by id desc limit 1),
  'the reason is audited, by the platform admin');
-- The reason is for platform admins only: the rows the refresh writes for the organization carry a generic reason.
select pg_temp.assert(not exists (select 1 from app.audit_log where center_id is not null and reason like '%problem with Zelle receiving%')
                      and exists (select 1 from app.audit_log where center_id = :c and action = 'center_payment_plugins.update'
                                    and record_id = :c || ':zelle' and reason = 'Community Connect paused or resumed a way to pay'),
  'the pause reason is on no audit row that carries an organization id; the organization''s plugin row change says only that Community Connect paused it');
select pg_temp.claims('82000000-0000-4000-8000-000000000006');
set local role authenticated;
select pg_temp.assert(not (app.member_payment_methods(:c)->'methods' @? '$[*] ? (@.key == "zelle")')
                      and (app.member_payment_methods(:c)->'methods' @? '$[*] ? (@.key == "check")'),
  'members are not offered a paused Zelle; the other ways stay');
select pg_temp.assert_raises($$select app.report_payment('00000000-0000-4000-8000-000000008201', '82000000-0000-4000-8000-0000000000a1', 'zelle', 5000, current_date - 1, null, null, null, null)$$,
  'paused Zelle', 'and a new Zelle report is refused while it is paused');
reset role;
select pg_temp.claims('82000000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.assert(not exists (select 1 from app.payment_plugin_suspensions), 'an organization''s owner cannot read the pause rows (platform admins only)');
reset role;
select pg_temp.claims('82000000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.assert((select r->>'ready' = 'false' and r->>'detail' like 'Community Connect has paused Zelle%'
                         from jsonb_array_elements(app.payment_readiness(:c)->'plugins') r where r->>'key' = 'zelle'),
  'readiness names the pause (an organization cannot go live with a paused way to pay turned on)');
reset role;

-- A pause stops a new payment from starting. It never stops money already paid from being recorded: the treasurer still matches
-- the report that was made before the pause to the Zelle on the bank statement.
select pg_temp.claims('82000000-0000-4000-8000-000000000002', false);
set local role authenticated;
select app.link_payment_report('82000000-0000-4000-8000-0000000000d3', '82000000-0000-4000-8000-0000000000e2', 'The Zelle is on the bank statement');
reset role;
select pg_temp.assert((select status = 'matched' and payment_id = '82000000-0000-4000-8000-0000000000e2' from app.payment_reports where id = '82000000-0000-4000-8000-0000000000d3')
                      and pg_temp.st(:c, 'zelle') = 'suspended',
  'while Zelle is paused, a report made before the pause is still matched to its payment');
select pg_temp.claims('82000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select pg_temp.assert_state($$select app.lift_payment_plugin_suspension('zelle', '00000000-0000-4000-8000-000000008201', 'Please')$$, '42501', 'the owner cannot lift a pause');
reset role;
select pg_temp.claims('82000000-0000-4000-8000-000000000007', true);
set local role authenticated;
select pg_temp.assert_raises($$select app.lift_payment_plugin_suspension('zelle', '00000000-0000-4000-8000-000000008201', ' ')$$, 'say why', 'lifting needs a reason');
select pg_temp.assert_raises($$select app.lift_payment_plugin_suspension('check', '00000000-0000-4000-8000-000000008201', 'x')$$, 'not paused', 'lifting what is not paused is refused');
select app.lift_payment_plugin_suspension('zelle', '00000000-0000-4000-8000-000000008201', 'The bank fixed it');
reset role;
select pg_temp.assert(pg_temp.st(:c, 'zelle') = 'live' and pg_temp.in_step(:c)
                      and (select lifted_at is not null and lifted_by = :pat and lift_reason = 'The bank fixed it' from app.payment_plugin_suspensions where id = :'sp1'),
  'lifted: the row is back to normal and the history keeps who paused and who resumed it');

-- For every organization: the catalog changes, every organization's rows follow, new checkouts stop.
select pg_temp.claims('82000000-0000-4000-8000-000000000007', true);
set local role authenticated;
select app.suspend_payment_plugin('card', null, 'Stripe is having an outage');
reset role;
select pg_temp.assert((select status = 'suspended' from app.payment_plugins where key = 'card')
                      and pg_temp.st(:c, 'card') = 'suspended' and pg_temp.st(:cb, 'card') = 'suspended' and pg_temp.st(:cr, 'card') = 'suspended'
                      and pg_temp.in_step(:c) and pg_temp.in_step(:cb)
                      and not exists (select 1 from app.center_payment_plugins p join app.centers c on c.id = p.center_id
                                       where p.plugin_key = 'card' and p.status <> 'suspended'),
  'paused for everyone: the catalog and every organization''s stored row say so');
select pg_temp.no_claims();
select pg_temp.assert_raises($$insert into app.payment_checkouts (center_id, household_id, processor, mode, context, amount_cents, for_label)
  values ('00000000-0000-4000-8000-000000008201', '82000000-0000-4000-8000-0000000000a1', 'stripe', 'test', 'other', 5000, 'Gift')$$,
  'paused Card', 'a new card checkout cannot start while Card is paused');
insert into app.payment_checkouts (center_id, household_id, processor, mode, context, amount_cents, for_label)
values (:c, :h1, 'paypal', 'test', 'other', 5000, 'Gift');
select pg_temp.assert(true, 'a PayPal checkout still can (only the paused way to pay stops)');
delete from app.payment_checkouts where center_id = :c and for_label = 'Gift';
-- A payment started before the pause is still recorded when Stripe confirms it; a refund made in the Stripe dashboard is still
-- flagged and still takes its two approvals. The pause only stops a NEW checkout from starting.
select pg_temp.no_claims();
grant connect_worker to postgres;
set local role connect_worker;
select pg_temp.assert(not (app.worker_record_online_payment('82000000-0000-4000-8000-0000000000f5', 'pi_82pre', 5000, 175, 'card')->>'duplicate')::boolean,
  'while Card is paused for everyone, a card payment started before the pause is still recorded when Stripe confirms it');
select pg_temp.assert((app.worker_flag_provider_refund('stripe', 'pi_82pre', 2000, 're_82pre', (now() at time zone 'America/Chicago')::date, 'charge.refunded')->>'outcome') = 'flagged',
  'and a refund made in the Stripe dashboard is still flagged');
reset role;
select id as rid82 from app.payment_refunds where provider_ref = 're_82pre' \gset
select pg_temp.assert((select p.status = 'captured' and p.amount_cents = 5000 and p.fee_cents = 175 and p.center_id = :c from app.payments p where p.provider = 'stripe' and p.provider_ref = 'pi_82pre')
                      and (select k.status = 'paid' and k.payment_id is not null from app.payment_checkouts k where k.id = '82000000-0000-4000-8000-0000000000f5'),
  'the payment and its checkout are recorded as they always are');
select pg_temp.claims('82000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select pg_temp.assert((app.approve_flagged_refund(:'rid82', 'Donor asked for part of the gift back'))->>'stage' = 'first', 'the first treasurer approves the flagged refund while Card is paused');
reset role;
select pg_temp.claims('82000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select pg_temp.assert((app.approve_flagged_refund(:'rid82', 'Checked the Stripe dashboard'))->>'stage' = 'applied', 'a different treasurer approves second');
reset role;
select pg_temp.assert((select refunded_cents = 2000 and status = 'partially_refunded' from app.payments where provider = 'stripe' and provider_ref = 'pi_82pre')
                      and pg_temp.st(:c, 'card') = 'suspended',
  'the refund is recorded while Card stays paused');

select pg_temp.claims('82000000-0000-4000-8000-000000000007', true);
select pg_temp.assert_raises($$select app.suspend_payment_plugin('card', null, 'Again')$$, 'already paused for every community', 'pausing it twice is refused');
set local role authenticated;
select app.lift_payment_plugin_suspension('card', null, 'Stripe is back');
reset role;
select pg_temp.assert((select status = 'available' from app.payment_plugins where key = 'card') and pg_temp.st(:c, 'card') = 'off' and pg_temp.in_step(:c) and pg_temp.in_step(:cb),
  'lifted for everyone: the catalog is back and the stored rows follow');
select pg_temp.assert(not exists (select 1 from app.audit_log where center_id is not null
                                    and (reason like '%problem with Zelle receiving%' or reason like '%The bank fixed it%'
                                         or reason like '%Stripe is having an outage%' or reason like '%Stripe is back%'))
                      and exists (select 1 from app.audit_log where center_id is null and action = 'payment_plugin_suspensions.insert' and reason = 'Stripe is having an outage')
                      and exists (select 1 from app.audit_log where center_id is null and action = 'payment_plugin_suspensions.update' and reason = 'Stripe is back'),
  'none of the four pause and resume reasons is on an audit row with an organization id (pausing and resuming, for one community and for everyone); the platform rows keep them');
select pg_temp.claims('82000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.assert(not exists (select 1 from app.audit_log where reason like '%problem with Zelle receiving%' or reason like '%Stripe is having an outage%'
                                    or reason like '%The bank fixed it%' or reason like '%Stripe is back%'),
  'a treasurer reading the audit log cannot find why Community Connect paused a way to pay');
reset role;
select pg_temp.no_claims();
insert into app.payment_checkouts (center_id, household_id, processor, mode, context, amount_cents, for_label) values (:c, :h1, 'stripe', 'test', 'other', 5000, 'Gift');
delete from app.payment_checkouts where center_id = :c and for_label = 'Gift';
select pg_temp.assert(true, 'and a card checkout can start again');

-- A platform admin's only power over payments is the pause.
select pg_temp.claims('82000000-0000-4000-8000-000000000007', true);
select pg_temp.assert(not app.payments_can_connect(:c) and not app.payee_can_request(:c) and not app.payee_can_approve(:c)
                      and not app.can_manage_integration_secrets(:c),
  'a platform admin cannot connect an account, read a credential, ask for a payee change or confirm one');
select pg_temp.no_claims();

-- ═════════════════════════════════════════════════════════════════════════════
-- A rehearsal report matched in a sandbox refreshes the stored plugin rows (0582's follow-up)
-- ═════════════════════════════════════════════════════════════════════════════
insert into app.center_payment_methods (center_id, method, accepted, instructions, sort) values
  (:cs, 'zelle', true, '{"recipient":"give@pc82s.example","name":"Sandbox Test Temple"}', 3);
select pg_temp.assert(pg_temp.st(:cs, 'zelle') = 'ready' and pg_temp.in_step(:cs), 'a sandbox Zelle is ready to rehearse');
insert into app.payment_reports (id, center_id, household_id, reported_by, amount_cents, sent_on, window_days, due_on, is_test)
values ('82000000-0000-4000-8000-0000000000d1', :cs, :hs, :mira, 5000, current_date - 1, 10, current_date + 9, true);
select pg_temp.assert(pg_temp.st(:cs, 'zelle') = 'ready', 'a report that is only reported does not pass the rehearsal');
insert into app.payments (id, center_id, household_id, amount_cents, method, status, provider, provider_ref, received_on)
values ('82000000-0000-4000-8000-0000000000e1', :cs, :hs, 5000, 'zelle', 'settled', 'bank', 'bank82', current_date);
update app.payment_reports set status = 'matched', payment_id = '82000000-0000-4000-8000-0000000000e1', matched_at = now()
 where id = '82000000-0000-4000-8000-0000000000d1';
select pg_temp.assert(pg_temp.st(:cs, 'zelle') = 'test_passed' and pg_temp.in_step(:cs),
  'when the rehearsal report is matched the STORED row becomes "test passed" (it used to lag until something else touched the row)');
delete from app.payment_reports where id = '82000000-0000-4000-8000-0000000000d1';
select pg_temp.assert(pg_temp.st(:cs, 'zelle') = 'ready' and pg_temp.in_step(:cs), 'and it follows when the report goes away');

-- ═════════════════════════════════════════════════════════════════════════════
-- Readiness: check 6 walks every enabled way to pay
-- ═════════════════════════════════════════════════════════════════════════════
-- Organization cr (production) takes offline payments only, so the earlier rules pass on their own.
update app.centers set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{payments}', coalesce(rules->'payments', '{}'::jsonb) || '{"offline_only": true}') where id = :cr;
insert into app.center_payment_methods (center_id, method, accepted, instructions, sort) values
  (:cr, 'check', true, '{"payee":"Readiness Test Temple","address":"3 Temple Rd, Houston TX"}', 1),
  (:cr, 'zelle', true, '{"recipient":"give@pc82r.example"}', 3);
select pg_temp.assert((app.check_payments_live(:cr)->>'ok')::boolean = false and app.check_payments_live(:cr)->>'detail' like 'Offline payments only%Not ready: Zelle: Add the name shown in Zelle%',
  'check 6: the earlier rule still passes (offline only) but an enabled Zelle without its display name is named as not ready');
update app.center_payment_methods set instructions = instructions || '{"name":"Readiness Test Temple"}' where center_id = :cr and method = 'zelle';
select pg_temp.assert(app.check_payments_live(:cr)->>'detail' like '%Zelle: Choose the bank account Zelle payments arrive in%', 'then the bank account is asked for');
update app.centers set rules = jsonb_set(rules, '{payments}', (rules->'payments') || jsonb_build_object('zelle', jsonb_build_object('bank_account_id', :ba4))) where id = :cr;
select pg_temp.assert(app.check_payments_live(:cr)->>'detail' like '%Zelle: That bank account''s statement format (OFX) cannot be read for Zelle lines yet%',
  'a statement format that cannot parse Zelle lines is refused');
update app.bank_accounts set statement_format = 'chase_csv' where id = :ba4;
select pg_temp.assert(app.check_payments_live(:cr)->>'detail' like '%Zelle: The treasurer has not approved the Zelle instructions and matching process yet%',
  'then the treasurer''s approval is asked for');
select pg_temp.assert(not (app.check_payments_live(:cr)->>'ok')::boolean and (select not (r->>'ready')::boolean from jsonb_array_elements(app._payment_readiness(:cr)->'plugins') r where r->>'key' = 'zelle')
                      and (select (r->>'ready')::boolean from jsonb_array_elements(app._payment_readiness(:cr)->'plugins') r where r->>'key' = 'check'),
  'Check is ready while Zelle is not; the check as a whole does not pass');

select pg_temp.claims('82000000-0000-4000-8000-000000000006');
set local role authenticated;
select pg_temp.assert_state($$select app.approve_zelle_instructions('00000000-0000-4000-8000-000000008204', 'Looks fine')$$, '42501', 'a member cannot approve the Zelle instructions');
select pg_temp.assert_state($$select app.payment_readiness('00000000-0000-4000-8000-000000008204')$$, '42501', 'nor read the payment readiness');
reset role;
select pg_temp.claims('82000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.assert((app.approve_zelle_instructions(:cr, 'Address, name and account checked against the bank letter')->>'state') = 'current', 'the treasurer approves the Zelle instructions');
select pg_temp.assert((select p.ok and (p.zelle_approval->>'state') = 'current' and p.is_treasurer and p.can_configure
                         from (select (a->>'ok')::boolean as ok, a->'zelle_approval' as zelle_approval, (a->>'is_treasurer')::boolean as is_treasurer,
                                      (a->>'can_configure')::boolean as can_configure from app.payment_readiness(:cr) a) p),
  'Settings › Payments reads the approval and that every enabled way to pay is ready');
reset role;
select pg_temp.assert((app.check_payments_live(:cr)->>'ok')::boolean and app.check_payments_live(:cr)->>'detail' like 'Offline payments only%'
                      and app.check_payments_live(:cr)->>'detail' not like '%Not ready%',
  'check 6 passes; its detail is the earlier rule''s, unchanged');
select pg_temp.assert((select approved_by = :tanu and approver_role = 'Treasurer' and evidence->>'recipient' = 'give@pc82r.example' from app.golive_approvals where center_id = :cr and key = 'zelle_instructions'),
  'the approval records who, the role and what exactly was approved');
-- A later change stops the pass until it is approved again.
update app.center_payment_methods set instructions = instructions || '{"memo_hint":"Your member number"}' where center_id = :cr and method = 'zelle';
select pg_temp.assert(not (app.check_payments_live(:cr)->>'ok')::boolean and app.check_payments_live(:cr)->>'detail' like '%Zelle: The Zelle details changed after %approved them on %',
  'a change after the approval stops check 6 passing, and says so');
select pg_temp.claims('82000000-0000-4000-8000-000000000002');
set local role authenticated;
select app.approve_zelle_instructions(:cr, null);
reset role;
select pg_temp.assert((app.check_payments_live(:cr)->>'ok')::boolean, 'until the treasurer approves the new version');

-- Online ways to pay count once the organization stops being offline only.
select pg_temp.no_claims();
update app.centers set rules = rules #- '{payments,offline_only}' where id = :cr;
select app.payment_processor_ensure(:cr, 'stripe');
update app.integration_connections set status = 'connected', settings = settings || '{"charges_enabled": true}' where center_id = :cr and provider = 'stripe';
update app.center_payment_processors set status = 'live', is_default = true, methods = '{apple_pay,card}' where center_id = :cr and processor = 'stripe';
select pg_temp.assert(not (app.check_payments_live(:cr)->>'ok')::boolean and app.check_payments_live(:cr)->>'detail' like '%Card: Run the $1 live test%'
                      and app.check_payments_live(:cr)->>'detail' like '%Apple Pay: Card is not ready yet.%',
  'a live Card without a live $1 test is not ready, and Apple Pay (which rides on it) says so');
insert into app.payment_processor_tests (center_id, processor, mode, charge_ref, refund_ref, ok) values (:cr, 'stripe', 'live', 'pi_82', 're_82', true);
select pg_temp.assert(not (app.check_payments_live(:cr)->>'ok')::boolean and app.check_payments_live(:cr)->>'detail' like '%Apple Pay: Turn Apple Pay on in your Stripe payment settings%'
                      and app.check_payments_live(:cr)->>'detail' not like '%Card:%',
  'Card is ready after the live test; Apple Pay still needs the statement that it is on in Stripe');
update app.integration_connections set settings = settings || '{"livemode": false}' where center_id = :cr and provider = 'stripe';
select pg_temp.assert(app.check_payments_live(:cr)->>'detail' like '%Card: Stripe was connected in test mode, so it cannot take live payments%',
  'a Stripe connection made in test mode is not ready for production');
update app.integration_connections set settings = settings || '{"livemode": true}' where center_id = :cr and provider = 'stripe';
select pg_temp.claims('82000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.assert_raises($$select app.confirm_wallet_in_stripe('00000000-0000-4000-8000-000000008204', 'card', 'x')$$, 'Only Apple Pay and Google Pay', 'only the wallets are confirmed this way');
select pg_temp.assert_raises($$select app.confirm_wallet_in_stripe('00000000-0000-4000-8000-000000008204', 'google_pay', 'x')$$, 'Turn Google Pay on first', 'and only when they are on');
select pg_temp.assert_raises($$select app.confirm_wallet_in_stripe('00000000-0000-4000-8000-000000008204', 'apple_pay', ' ')$$, 'say why', 'with a reason');
select app.confirm_wallet_in_stripe('00000000-0000-4000-8000-000000008204', 'apple_pay', 'Turned on in the Stripe dashboard payment settings');
reset role;
select pg_temp.assert((app.check_payments_live(:cr)->>'ok')::boolean and (select wallet_confirmed_by = :tanu and wallet_confirmed_at is not null
                                                                             from app.center_payment_plugins where center_id = :cr and plugin_key = 'apple_pay'),
  'with the owner''s statement about Apple Pay recorded, check 6 passes');

-- ═════════════════════════════════════════════════════════════════════════════
-- Sandbox rehearsal is part of the Zelle readiness
-- ═════════════════════════════════════════════════════════════════════════════
update app.centers set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{payments}', coalesce(rules->'payments', '{}'::jsonb) || jsonb_build_object('zelle', jsonb_build_object('bank_account_id', :ba5))) where id = :cs;
insert into app.golive_approvals (center_id, key, approved_by, approver_role, evidence, evidence_hash)
values (:cs, 'zelle_instructions', :tanu, 'Treasurer', app.zelle_instructions_evidence(:cs), app.golive_evidence_hash(app.zelle_instructions_evidence(:cs)));
select pg_temp.assert((select r->>'detail' like 'Rehearse it once:%' and r->>'ready' = 'false' from jsonb_array_elements(app._payment_readiness(:cs)->'plugins') r where r->>'key' = 'zelle'),
  'in a sandbox Zelle is not ready until one rehearsal report has been matched');
insert into app.payment_reports (id, center_id, household_id, reported_by, amount_cents, sent_on, window_days, due_on, is_test, status, payment_id, matched_at)
values ('82000000-0000-4000-8000-0000000000d2', :cs, :hs, :mira, 5000, current_date - 1, 10, current_date + 9, true, 'matched', '82000000-0000-4000-8000-0000000000e1', now());
select pg_temp.assert((select (r->>'ready')::boolean from jsonb_array_elements(app._payment_readiness(:cs)->'plugins') r where r->>'key' = 'zelle') and pg_temp.st(:cs, 'zelle') = 'test_passed',
  'and ready once one has been matched end to end');

-- ═════════════════════════════════════════════════════════════════════════════
-- Tables, demo reset and function properties
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert((select bool_and(relrowsecurity) from pg_class where oid in ('app.payee_changes'::regclass, 'app.payment_plugin_suspensions'::regclass))
                      and not has_table_privilege('anon', 'app.payee_changes', 'select') and not has_table_privilege('anon', 'app.payment_plugin_suspensions', 'select')
                      and has_table_privilege('authenticated', 'app.payee_changes', 'select') and not has_table_privilege('authenticated', 'app.payee_changes', 'insert')
                      and not has_table_privilege('authenticated', 'app.payee_changes', 'update') and not has_table_privilege('authenticated', 'app.payee_changes', 'delete')
                      and not has_table_privilege('authenticated', 'app.payment_plugin_suspensions', 'insert')
                      and not has_table_privilege('authenticated', 'app.payment_plugin_suspensions', 'update'),
  'both new tables have row level security and are read-only over the API');
select pg_temp.assert('payee_changes' = any (app.demo_clear_tables()) and 'payment_plugin_suspensions' <> all (app.demo_clear_tables()),
  'a sandbox reset clears pending requests with the other transactions but can never lift Community Connect''s pause');
rollback;

select pg_temp.assert((select bool_and(p.prosecdef = (p.oid <> 'app.payee_field_label(text)'::regprocedure)
                                       and 'search_path=app, public, extensions' = any (p.proconfig)
                                       and not has_function_privilege('anon', p.oid, 'execute'))
                         from pg_proc p
                        where p.oid in ('app.payee_has_permission(uuid,text)'::regprocedure, 'app.payee_can_request(uuid)'::regprocedure,
                                        'app.payee_user_has_permission(uuid,uuid,text)'::regprocedure, 'app.payee_changes_cancel_on_disconnect()'::regprocedure,
                                        'app.payee_can_approve(uuid)'::regprocedure, 'app.payee_field_label(text)'::regprocedure,
                                        'app.payment_plugin_is_paused(uuid,text)'::regprocedure, 'app.payee_guard_methods()'::regprocedure,
                                        'app.payee_guard_centers()'::regprocedure, 'app.payee_guard_connections()'::regprocedure,
                                        'app._create_payee_change(uuid,text,jsonb,jsonb,text)'::regprocedure,
                                        'app.request_payee_change(uuid,text,jsonb,text)'::regprocedure,
                                        'app.decide_payee_change(uuid,boolean,text)'::regprocedure, 'app.cancel_payee_change(uuid,text)'::regprocedure,
                                        'app.payee_change_queue(uuid)'::regprocedure, 'app.payee_notice(uuid,text)'::regprocedure,
                                        'app.confirm_paypal_email(uuid,text)'::regprocedure, 'app.set_zelle_reporting(uuid,integer,uuid,text)'::regprocedure,
                                        'app.payment_plugin_status(uuid,text)'::regprocedure, 'app.payment_plugins_catalog_sync()'::regprocedure,
                                        'app.payment_plugins_suspension_sync()'::regprocedure, 'app.payment_checkouts_pause_guard()'::regprocedure,
                                        'app.payment_reports_pause_guard()'::regprocedure, 'app.suspend_payment_plugin(text,uuid,text)'::regprocedure,
                                        'app.lift_payment_plugin_suspension(text,uuid,text)'::regprocedure, 'app.payment_plugin_pauses()'::regprocedure,
                                        'app.member_payment_methods(uuid)'::regprocedure, 'app.zelle_instructions_evidence(uuid)'::regprocedure,
                                        'app.golive_approval_state(uuid,text)'::regprocedure, 'app.approve_zelle_instructions(uuid,text)'::regprocedure,
                                        'app.confirm_wallet_in_stripe(uuid,text,text)'::regprocedure, 'app._payment_processor_readiness(uuid,text)'::regprocedure,
                                        'app._payment_plugin_readiness(uuid,text)'::regprocedure, 'app._payment_readiness(uuid)'::regprocedure,
                                        'app.payment_readiness(uuid)'::regprocedure, 'app.check_payments_live(uuid)'::regprocedure)),
  'every new or redefined function pins search_path = app, public, extensions, is security definer (the label function aside) and anon runs none');
select pg_temp.assert(has_function_privilege('authenticated', 'app.payee_can_request(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.payee_can_approve(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.request_payee_change(uuid,text,jsonb,text)', 'execute')
                      and has_function_privilege('authenticated', 'app.decide_payee_change(uuid,boolean,text)', 'execute')
                      and has_function_privilege('authenticated', 'app.cancel_payee_change(uuid,text)', 'execute')
                      and has_function_privilege('authenticated', 'app.payee_change_queue(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.suspend_payment_plugin(text,uuid,text)', 'execute')
                      and has_function_privilege('authenticated', 'app.lift_payment_plugin_suspension(text,uuid,text)', 'execute')
                      and has_function_privilege('authenticated', 'app.payment_plugin_pauses()', 'execute')
                      and has_function_privilege('authenticated', 'app.payment_readiness(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.approve_zelle_instructions(uuid,text)', 'execute')
                      and has_function_privilege('authenticated', 'app.confirm_wallet_in_stripe(uuid,text,text)', 'execute')
                      and has_function_privilege('authenticated', 'app.confirm_paypal_email(uuid,text)', 'execute')
                      and has_function_privilege('authenticated', 'app.set_zelle_reporting(uuid,integer,uuid,text)', 'execute')
                      and has_function_privilege('authenticated', 'app.member_payment_methods(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.check_payments_live(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.payee_has_permission(uuid,text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.payee_user_has_permission(uuid,uuid,text)', 'execute')
                      and not has_function_privilege('authenticated', 'app._create_payee_change(uuid,text,jsonb,jsonb,text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.payment_plugin_is_paused(uuid,text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.payment_plugin_status(uuid,text)', 'execute')
                      and not has_function_privilege('authenticated', 'app._payment_readiness(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app._payment_plugin_readiness(uuid,text)', 'execute')
                      and not has_function_privilege('authenticated', 'app._payment_processor_readiness(uuid,text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.zelle_instructions_evidence(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.golive_approval_state(uuid,text)', 'execute')
                      and not has_function_privilege('authenticated', 'app._check_payments_live_before_0597(uuid)', 'execute'),
  'signed-in people run only the request, decide, cancel, queue, pause, readiness, approval and settings functions');
select pg_temp.assert((select count(*) = 1 from pg_trigger where tgname = 'payee_guard' and not tgisinternal and tgrelid = 'app.center_payment_methods'::regclass)
                      and (select count(*) = 1 from pg_trigger where tgname = 'payee_guard' and not tgisinternal and tgrelid = 'app.centers'::regclass)
                      and (select count(*) = 1 from pg_trigger where tgname = 'payee_guard' and not tgisinternal and tgrelid = 'app.integration_connections'::regclass)
                      and not exists (select 1 from pg_trigger where tgname = 'payment_plugins_sync_reports' and tgrelid = 'app.payment_reports'::regclass)
                      and (select count(*) = 3 from pg_trigger
                            where tgname in ('payment_plugins_sync_reports_ins', 'payment_plugins_sync_reports_upd', 'payment_plugins_sync_reports_del')
                              and not tgisinternal and tgrelid = 'app.payment_reports'::regclass
                              and pg_get_triggerdef(oid) ilike '%WHEN (%is_test%'),
  'the payee guards sit on the three places a payee lives, and the report triggers on payment_reports run only for rehearsal (test) reports');
select pg_temp.assert((select count(*) = 1 from pg_trigger where tgname = 'payee_changes_cancel' and not tgisinternal and tgrelid = 'app.center_payment_processors'::regclass)
                      and (select count(*) = 1 from pg_trigger where tgname = 'payee_changes_cancel' and not tgisinternal and tgrelid = 'app.center_payment_methods'::regclass),
  'a waiting request is withdrawn by triggers on the processors and on the offline methods');
select pg_temp.assert((select check_fn = 'app.check_payments_live'::regproc from app.readiness_checks where key = 'payments_live'),
  'readiness check 6 is registered on the new function');
