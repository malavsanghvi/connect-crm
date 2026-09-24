-- Onboarding · o-quickbooks (0230–0236): connecting QuickBooks (signed single-use
-- state, the code to the vault, sandbox vs read-only real company), the pulled
-- read-only lists, the account mapping and its approval (step-up), the test post,
-- the poster's rules (history, go-live date, closed months, idempotent claim),
-- readiness check 7 and the Setup steps.
\set ON_ERROR_STOP 1
\set jsh '''00000000-0000-4000-8000-000000000001'''
\set other '''00000000-0000-4000-8000-000000000002'''
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
create or replace function pg_temp.assert_state(stmt text, state text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if sqlstate <> state then raise exception 'FAIL: % (got % "%")', label, sqlstate, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
-- Sign in as a user; p_fresh: with a TOTP check in the last minute (step-up).
create or replace function pg_temp.sign_in(p_user uuid, p_fresh boolean default true) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2',
    'amr', case when p_fresh then json_build_array(json_build_object('method','totp','timestamp',extract(epoch from now())::bigint))
                else json_build_array(json_build_object('method','otp','timestamp',extract(epoch from now())::bigint)) end)::text, true);
  perform set_config('request.headers', '{"x-client-app":"portal","x-client-screen":"/accounting/qbo/setup"}', true);
end $$;
-- Users: 03 Tara (treasurer: accounting.manage, integrations.view; has an authenticator),
-- 11 Ada (center admin: integrations.manage, no accounting.manage), 01 Priya (member),
-- 07 the other center's admin.
create temp table ctx (k text primary key, v text);
grant all on ctx to public;
grant connect_worker to postgres;
\set tara '''10000000-0000-4000-8000-000000000003'''
\set ada '''10000000-0000-4000-8000-000000000011'''

-- ── Registration ─────────────────────────────────────────────────────────────
select pg_temp.assert(exists (select 1 from app.readiness_checks where key = 'quickbooks_ready' and sort = 7
                              and check_fn = 'app.check_quickbooks_ready'::regproc), 'readiness check 7 quickbooks_ready is registered');
select pg_temp.assert((select count(*) from app.module_tables where module_key = 'accounting'
                        and table_name in ('qbo_accounts','qbo_classes','qbo_locations','qbo_items','qbo_tax_codes','qbo_payment_methods',
                                           'qbo_pull_runs','qbo_oauth_states','qbo_test_posts')) = 9,
  'the QuickBooks copies, pull runs, OAuth states and test posts belong to the Accounting module');
select pg_temp.assert(pg_get_constraintdef((select oid from pg_constraint where conname = 'integration_connections_provider_check')) like '%intuit_sandbox%',
  'an Intuit sandbox company is a provider');

-- Start clean: whatever earlier tests left on JSH's QuickBooks row.
update app.integration_connections set status = 'disconnected', settings = '{}', external_account_id = null
 where center_id = :jsh and provider in ('quickbooks_online','intuit_sandbox');

-- ── Who may connect ──────────────────────────────────────────────────────────
begin;
set local role authenticated;
select pg_temp.sign_in('10000000-0000-4000-8000-000000000001');
select pg_temp.assert_raises($$select app.start_qbo_connect('00000000-0000-4000-8000-000000000001', 'real', 'https://portal.test/api/oauth/intuit/callback', 'x')$$,
  'Connecting QuickBooks needs', 'a member cannot connect QuickBooks');
select pg_temp.assert_raises($$select app.qbo_status('00000000-0000-4000-8000-000000000001')$$, 'needs accounting.manage', 'nor see QuickBooks setup');
select pg_temp.assert((select count(*) from app.qbo_accounts) = 0, 'a member reads no chart of accounts');
commit;
begin;
set local role authenticated;
select pg_temp.sign_in(:tara, false);
select pg_temp.assert_state($$select app.start_qbo_connect('00000000-0000-4000-8000-000000000001', 'real', 'https://portal.test/api/oauth/intuit/callback', 'Connecting our books')$$,
  'CCSTP', 'the treasurer needs a fresh 2FA check to connect');
commit;
begin;
set local role authenticated;
select pg_temp.sign_in(:tara);
select pg_temp.assert_state($$select app.start_qbo_connect('00000000-0000-4000-8000-000000000001', 'sandbox', 'https://portal.test/api/oauth/intuit/callback', 'Try')$$,
  'CCENT', 'a live community cannot connect an Intuit sandbox company');
select pg_temp.assert_raises($$select app.start_qbo_connect('00000000-0000-4000-8000-000000000001', 'real', 'https://evil.test/steal', 'Try')$$,
  'return address', 'the return address must be the portal callback');
select pg_temp.assert_raises($$select app.start_qbo_connect('00000000-0000-4000-8000-000000000001', 'real', 'https://portal.test/api/oauth/intuit/callback', ' ')$$,
  'Say why', 'connecting needs a reason');
insert into ctx select 'n1', (app.start_qbo_connect(:jsh, 'real', 'https://portal.test/api/oauth/intuit/callback', 'Connecting our books'))->>'nonce';
commit;
select pg_temp.assert((select settings->>'mode' = 'live' and settings->>'read_only' = 'false' and status = 'disconnected'
                        from app.integration_connections where center_id = :jsh and provider = 'quickbooks_online'),
  'a live community connects its real company in live mode, not read-only');
select pg_temp.assert(not exists (select 1 from app.qbo_oauth_states where nonce_hash = (select v from ctx where k = 'n1')),
  'the nonce itself is never stored, only its hash');
select pg_temp.assert(exists (select 1 from app.audit_log where action = 'qbo_oauth_states.insert' and reason = 'Connecting our books'
                              and client_app = 'portal' and client_screen = '/accounting/qbo/setup' and module = 'accounting'),
  'starting the connection is audited with its reason, app, screen and module');

-- The callback, as someone else: refused and burnt.
begin;
set local role authenticated;
select pg_temp.sign_in(:ada);
select pg_temp.assert((app.complete_qbo_connect((select v from ctx where k = 'n1'), 'AB11-auth-code-xyz', '9130350000000001'))->>'error' like '%started by someone else%',
  'a sign-in started by the treasurer cannot be completed by another person');
commit;
begin;
set local role authenticated;
select pg_temp.sign_in(:tara);
select pg_temp.assert((app.complete_qbo_connect((select v from ctx where k = 'n1'), 'AB11-auth-code-xyz', '9130350000000001'))->>'error' like '%already used%',
  'and the state is single-use afterwards');
select pg_temp.assert((app.complete_qbo_connect('0000', 'AB11-auth-code-xyz', '9130350000000001'))->>'error' like '%not recognised%',
  'a forged state is not recognised');
insert into ctx select 'n2', (app.start_qbo_connect(:jsh, 'real', 'https://portal.test/api/oauth/intuit/callback', 'Connecting our books'))->>'nonce';
insert into ctx select 'n3', (app.start_qbo_connect(:jsh, 'real', 'https://portal.test/api/oauth/intuit/callback', 'Second try'))->>'nonce';
insert into ctx select 'done', app.complete_qbo_connect((select v from ctx where k = 'n2'), 'AB11-auth-code-xyz', '9130350000000001')::text;
select pg_temp.assert((app.fail_qbo_connect((select v from ctx where k = 'n3'), 'access_denied'))->>'message' like '%cancelled%',
  'Intuit sending the person back without a code is recorded in plain English');
commit;
update app.qbo_oauth_states set expires_at = now() - interval '1 minute' where used_at is null;
select pg_temp.assert(((select v from ctx where k = 'done')::jsonb->>'ok')::boolean, 'the treasurer completes the sign-in');
select pg_temp.assert((select payload->>'provider' = 'intuit' and payload->>'code_secret' = 'oauth.code' and not (payload ? 'code')
                              and payload::text not like '%AB11-auth-code-xyz%'
                         from app.jobs where id = ((select v from ctx where k = 'done')::jsonb->>'job_id')::bigint and kind = 'oauth.exchange'),
  'an oauth.exchange job is queued; the code is not in its payload');
select pg_temp.assert((select fingerprint = '-xyz' from app.integration_secrets s join app.integration_connections c on c.id = s.connection_id
                        where c.center_id = :jsh and c.provider = 'quickbooks_online' and s.name = 'oauth.code'),
  'the code is in the vault (fingerprint only in the app)');
select pg_temp.assert((select external_account_id = '9130350000000001' and connected_by = :tara::uuid from app.integration_connections
                        where center_id = :jsh and provider = 'quickbooks_online'), 'the company id and who connected it are recorded');
insert into ctx select 'conn', id::text from app.integration_connections where center_id = :jsh and provider = 'quickbooks_online';

-- ── The background service connects, pulls ───────────────────────────────────
begin;
set local role authenticated;
select pg_temp.sign_in(:tara);
select pg_temp.assert_raises($$select app.qbo_worker_connected((select v::uuid from ctx where k = 'conn'), now() + interval '1 hour', now() + interval '100 days', 'x')$$,
  'permission denied', 'people cannot call the service''s functions');
commit;
begin;
set local role connect_worker;
select app.qbo_worker_connected((select v::uuid from ctx where k = 'conn'), now() + interval '1 hour', now() + interval '100 days', 'Jain Society of Houston (test)');
select pg_temp.assert_raises($$insert into app.qbo_accounts (center_id, connection_id, qbo_id, name) values ('00000000-0000-4000-8000-000000000001', (select v::uuid from ctx where k = 'conn'), '1', 'x')$$,
  'permission denied', 'the service writes the copies only through its function');
select app.qbo_worker_store_list((select v::uuid from ctx where k = 'conn'), 'accounts', $$[
  {"qbo_id":"1","name":"Donations","account_type":"Income","classification":"Revenue","active":true,"raw":{"Id":"1"}},
  {"qbo_id":"2","name":"Chase Operating","account_type":"Bank","active":true,"raw":{"Id":"2"}},
  {"qbo_id":"3","name":"Undeposited Funds","account_type":"Other Current Asset","active":true,"raw":{"Id":"3"}},
  {"qbo_id":"4","name":"Stripe Clearing","account_type":"Bank","active":true,"raw":{"Id":"4"}},
  {"qbo_id":"5","name":"Merchant Fees","account_type":"Expense","active":true,"raw":{"Id":"5"}},
  {"qbo_id":"6","name":"Old Income","account_type":"Income","active":false,"raw":{"Id":"6"}},
  {"qbo_id":"7","name":"Store Sales","account_type":"Income","active":true,"raw":{"Id":"7"}},
  {"qbo_id":"8","name":"Sales Tax Payable","account_type":"Other Current Liability","active":true,"raw":{"Id":"8"}}]$$);
select app.qbo_worker_store_list((select v::uuid from ctx where k = 'conn'), 'items', $$[
  {"qbo_id":"20","name":"Donation","active":true,"raw":{"Id":"20","Type":"Service","IncomeAccountRef":{"value":"1"}}},
  {"qbo_id":"21","name":"Store item","active":true,"raw":{"Id":"21","Type":"Service","IncomeAccountRef":{"value":"7"}}},
  {"qbo_id":"22","name":"Sales tax","active":true,"raw":{"Id":"22","Type":"Service","IncomeAccountRef":{"value":"8"}}}]$$);
select app.qbo_worker_store_list((select v::uuid from ctx where k = 'conn'), 'classes', $$[
  {"qbo_id":"30","name":"General","active":true},{"qbo_id":"31","name":"Construction","active":true},{"qbo_id":"32","name":"Retired","active":false}]$$);
select pg_temp.assert(app.qbo_worker_store_list((select v::uuid from ctx where k = 'conn'), 'classes', $$[{"qbo_id":"30","name":"General","active":true}]$$) = 0,
  'a pull that changes nothing writes nothing (no audit noise)');
select app.qbo_worker_pull_done((select v::uuid from ctx where k = 'conn'), null, true, '{"accounts":8,"items":3,"classes":3}', '{}', null);
commit;
select pg_temp.assert((select status = 'connected' and display_name = 'Jain Society of Houston (test)' and token_expires_at > now() + interval '99 days'
                        from app.integration_connections where id = (select v::uuid from ctx where k = 'conn')),
  'connected: company name and the sign-in''s expiry are shown');
select pg_temp.assert(exists (select 1 from app.jobs where center_id = :jsh and kind = 'qbo.pull_lists' and payload->>'connection_id' = (select v from ctx where k = 'conn')),
  'connecting queues the first pull of the lists');
select pg_temp.assert((select status = 'done' from app.center_setup_steps where center_id = :jsh and step_key = 'data.chart_of_accounts'),
  'Setup step data.chart_of_accounts is done once a pull succeeded');
select pg_temp.assert((select status = 'in_progress' from app.center_setup_steps where center_id = :jsh and step_key = 'svc.quickbooks'),
  'and svc.quickbooks is in progress');
select pg_temp.assert((select client_app = 'job' and module = 'accounting' from app.audit_log where action = 'qbo_accounts.insert' order by id desc limit 1),
  'the copies are audited as the background service''s work');

-- ── Mapping ──────────────────────────────────────────────────────────────────
begin;
set local role authenticated;
select pg_temp.sign_in(:ada);
select pg_temp.assert_raises($$select app.set_qbo_mapping('00000000-0000-4000-8000-000000000001', 'bank', '2', 'x')$$, 'accounting.manage',
  'mapping needs accounting.manage');
commit;
begin;
set local role authenticated;
select pg_temp.sign_in(:tara);
select pg_temp.assert_raises($$select app.set_qbo_mapping('00000000-0000-4000-8000-000000000001', 'bank', '999', 'typed')$$, 'pulled from QuickBooks',
  'an account id that is not in the pulled chart is refused (nobody types account ids)');
select pg_temp.assert_raises($$select app.set_qbo_mapping('00000000-0000-4000-8000-000000000001', 'income.general', '6', 'x')$$, 'inactive',
  'an inactive account is refused');
select pg_temp.assert_raises($$select app.set_qbo_mapping('00000000-0000-4000-8000-000000000001', 'bank', '1', 'x')$$, 'needs one of',
  'an account of the wrong type is refused');
select pg_temp.assert_raises($$insert into app.qbo_account_mappings (center_id, purpose, qbo_account_id) values ('00000000-0000-4000-8000-000000000001', 'stock_clearing', '77')$$,
  'pulled from QuickBooks', 'a direct insert must also come from the chart');
select app.set_qbo_mapping(:jsh, 'income.general', '1', 'Initial mapping');
select app.set_qbo_mapping(:jsh, 'bank', '2', 'Initial mapping');
select app.set_qbo_mapping(:jsh, 'undeposited_funds', '3', 'Initial mapping');
select app.set_qbo_mapping(:jsh, 'payment_clearing', '4', 'Initial mapping');
select pg_temp.assert_raises($$select app.approve_qbo_mapping('00000000-0000-4000-8000-000000000001', 'ok')$$, 'Map these first',
  'approval lists what is still unmapped');
select app.set_qbo_mapping(:jsh, 'merchant_fees', '5', 'Initial mapping');
select app.set_qbo_mapping(:jsh, 'store.sales', '7', 'Initial mapping');
select app.set_qbo_mapping(:jsh, 'sales_tax_payable', '8', 'Initial mapping');
select app.set_qbo_fund_class(:jsh, (select id from app.funds where center_id = :jsh and key = 'general'), '30', 'General fund class');
select pg_temp.assert_raises($$select app.set_qbo_fund_class('00000000-0000-4000-8000-000000000001', (select id from app.funds where center_id = '00000000-0000-4000-8000-000000000001' and key = 'construction'), '32', 'x')$$,
  'inactive', 'an inactive class is refused');
select pg_temp.assert_raises($$update app.qbo_account_mappings set approved_by = '10000000-0000-4000-8000-000000000003', approved_at = now() where center_id = '00000000-0000-4000-8000-000000000001'$$,
  'approved as a whole', 'a mapping row cannot be marked approved directly');
commit;
select pg_temp.assert((select qbo_account_name = 'Chase Operating' from app.qbo_account_mappings where center_id = :jsh and purpose = 'bank'),
  'the account name comes from the chart');
begin;
set local role authenticated;
select pg_temp.sign_in(:tara, false);
select pg_temp.assert_state($$select app.approve_qbo_mapping('00000000-0000-4000-8000-000000000001', 'Checked against the books')$$, 'CCSTP',
  'approving the mapping needs a fresh 2FA check');
commit;
begin;
set local role authenticated;
select pg_temp.sign_in(:tara);
select pg_temp.assert(((app.approve_qbo_mapping(:jsh, 'Checked against the books'))->>'approved')::int = 7, 'the treasurer approves the mapping');
commit;
select pg_temp.assert((select settings->>'mapping_approved_by' = :tara from app.integration_connections where id = (select v::uuid from ctx where k = 'conn'))
                      and (select bool_and(approved_by = :tara::uuid) from app.qbo_account_mappings where center_id = :jsh),
  'the approval is recorded on the connection and on every mapping row');
select pg_temp.assert(exists (select 1 from app.audit_log where action = 'qbo_account_mappings.update' and reason = 'Checked against the books'
                              and client_screen = '/accounting/qbo/setup' and module = 'accounting'),
  'the approval is audited with its reason and screen');

-- A pull finds the income account renamed, then the bank account inactive.
begin;
set local role connect_worker;
select app.qbo_worker_store_list((select v::uuid from ctx where k = 'conn'), 'accounts', $$[{"qbo_id":"1","name":"Donations - General","account_type":"Income","active":true,"raw":{"Id":"1"}}]$$);
select pg_temp.assert(((app.qbo_worker_pull_done((select v::uuid from ctx where k = 'conn'), null, true, '{}', '{}', null))->'warnings'->0->>'text') like '%renamed%',
  'a renamed mapped account is a warning after the pull');
select app.qbo_worker_store_list((select v::uuid from ctx where k = 'conn'), 'accounts', $$[{"qbo_id":"2","name":"Chase Operating","account_type":"Bank","active":false,"raw":{"Id":"2"}}]$$);
select app.qbo_worker_pull_done((select v::uuid from ctx where k = 'conn'), null, true, '{}', '{}', null);
commit;
select pg_temp.assert(exists (select 1 from jsonb_array_elements(app.qbo_mapping_warnings(:jsh)) w where w->>'level' = 'error' and w->>'text' like '%inactive%'),
  'an inactive mapped account is an error');
select pg_temp.assert((select settings->>'alert_subject' = 'A mapped QuickBooks account changed' from app.integration_connections where id = (select v::uuid from ctx where k = 'conn')),
  'and it raises an alert on the connection');
select pg_temp.assert(not (app.qbo_post_ready(:jsh)->>'ok')::boolean, 'nothing posts while a mapped account is inactive');
begin;
set local role connect_worker;
select app.qbo_worker_store_list((select v::uuid from ctx where k = 'conn'), 'accounts', $$[{"qbo_id":"2","name":"Chase Operating","account_type":"Bank","active":true,"raw":{"Id":"2"}}]$$);
select app.qbo_worker_pull_done((select v::uuid from ctx where k = 'conn'), null, true, '{}', '{}', null);
commit;

-- ── Choices, test post ───────────────────────────────────────────────────────
begin;
set local role authenticated;
select pg_temp.sign_in(:tara);
select app.approve_qbo_mapping(:jsh, 'Renamed account accepted');
select pg_temp.assert((select qbo_account_name = 'Donations - General' from app.qbo_account_mappings where center_id = :jsh and purpose = 'income.general'),
  'approving again accepts the new name');
select app.set_qbo_settings(:jsh, 'cash', 'per_txn', '2026-01-01', 'Cash basis; books in QuickBooks until the end of 2025');
select pg_temp.assert_raises($$select app.request_qbo_test_post('00000000-0000-4000-8000-000000000001', false, 'Test')$$, 'real QuickBooks company',
  'a test post to a live company''s real books needs an explicit confirmation');
insert into ctx select 'test', app.request_qbo_test_post(:jsh, true, 'Test post before go-live')::text;
commit;
select pg_temp.assert((select mode = 'post' and status = 'queued' from app.qbo_test_posts where id = (select v::uuid from ctx where k = 'test')),
  'the test post is queued in post mode');
begin;
set local role connect_worker;
insert into ctx select 'plan', app.qbo_worker_test_post_plan((select v::uuid from ctx where k = 'test'))::text;
select pg_temp.assert((select jsonb_agg(d->>'entity' order by d->>'entity') = '["Deposit","JournalEntry","RefundReceipt","SalesReceipt"]'::jsonb
                         from jsonb_array_elements((select v::jsonb from ctx where k = 'plan')->'docs') d),
  'the test post is one SalesReceipt, RefundReceipt, Deposit and JournalEntry');
select pg_temp.assert(((select v::jsonb from ctx where k = 'plan') #>> '{docs,0,lines,0,item_id}') = '20'
                      and ((select v::jsonb from ctx where k = 'plan') #>> '{docs,0,lines,0,class_id}') = '30',
  'the sales line goes through the item that posts to the income account, with the fund''s class');
select app.qbo_worker_test_post_done((select v::uuid from ctx where k = 'test'), true,
  '[{"entity":"SalesReceipt","ok":true,"qbo_id":"501"},{"entity":"RefundReceipt","ok":true,"qbo_id":"502"},{"entity":"Deposit","ok":true,"qbo_id":"503"},{"entity":"JournalEntry","ok":true,"qbo_id":"504"}]', null);
commit;
select pg_temp.assert(not (app.check_quickbooks_ready(:jsh)->>'ok')::boolean
                      and app.check_quickbooks_ready(:jsh)->>'detail' like '%approve a test post%', 'readiness 7 waits for the test post approval');
begin;
set local role authenticated;
select pg_temp.sign_in(:tara, false);
select pg_temp.assert_state($$select app.approve_qbo_test_post((select v::uuid from ctx where k = 'test'), 'Looks right')$$, 'CCSTP',
  'approving the test post needs a fresh 2FA check');
commit;
begin;
set local role authenticated;
select pg_temp.sign_in(:tara);
select app.approve_qbo_test_post((select v::uuid from ctx where k = 'test'), 'Four entries checked in QuickBooks');
commit;
select pg_temp.assert((app.check_quickbooks_ready(:jsh)->>'ok')::boolean, 'readiness 7 passes: connected, mapping and test post approved, go-live set');
select pg_temp.assert((select status = 'done' from app.center_setup_steps where center_id = :jsh and step_key = 'svc.quickbooks'),
  'Setup step svc.quickbooks is done');
select pg_temp.assert((app.qbo_post_ready(:jsh)->>'ok')::boolean, 'the poster is ready');

-- ── The poster ───────────────────────────────────────────────────────────────
update app.ledger_postings set status = 'superseded' where center_id = :jsh and status in ('queued','failed');   -- earlier tests' leftovers
update app.jobs set status = 'cancelled' where center_id = :jsh and kind = 'qbo.post' and status = 'queued';
insert into app.payments (id, center_id, household_id, amount_cents, method, provider, received_on, receipt_number)
values ('26000000-0000-4000-8000-000000000001', :jsh, '20000000-0000-4000-8000-000000000002', 5100, 'cash', 'offline', '2026-03-02', 'R-26-1');
select pg_temp.assert((select count(*) = 1 from app.ledger_postings where source_id = '26000000-0000-4000-8000-000000000001' and status = 'queued'),
  'a live offline payment after go-live is queued');
select pg_temp.assert(exists (select 1 from app.jobs where center_id = :jsh and kind = 'qbo.post' and status = 'queued'),
  'and a qbo.post job is queued for it');
-- A queued posting of history (should never happen) and one before go-live.
insert into app.payments (id, center_id, household_id, amount_cents, method, provider, received_on, is_historical)
values ('26000000-0000-4000-8000-000000000002', :jsh, '20000000-0000-4000-8000-000000000002', 7000, 'check', 'offline', '2026-03-03', true),
       ('26000000-0000-4000-8000-000000000003', :jsh, '20000000-0000-4000-8000-000000000002', 7100, 'check', 'import', '2025-11-03', false),
       ('26000000-0000-4000-8000-000000000004', :jsh, '20000000-0000-4000-8000-000000000002', 7200, 'check', 'import', '2026-04-03', false);
select pg_temp.assert(not exists (select 1 from app.ledger_postings where source_id = '26000000-0000-4000-8000-000000000002'),
  'a historical payment is never queued');
insert into app.ledger_postings (center_id, idempotency_key, source_table, source_id, txn_type, amount_cents, period_month) values
  (:jsh, 't26:hist', 'payments', '26000000-0000-4000-8000-000000000002', 'offline_receipt', 7000, '2026-03-01'),
  (:jsh, 't26:early', 'payments', '26000000-0000-4000-8000-000000000003', 'offline_receipt', 7100, '2025-11-01'),
  (:jsh, 't26:closed', 'payments', '26000000-0000-4000-8000-000000000004', 'offline_receipt', 7200, '2026-04-01');
insert into app.accounting_periods (center_id, period_month, status) values (:jsh, '2026-04-01', 'closed')
on conflict (center_id, period_month) do update set status = 'closed';
begin;
set local role connect_worker;
insert into ctx select 'claim', app.qbo_worker_claim(:jsh, 25)::text;
commit;
select pg_temp.assert(((select v::jsonb from ctx where k = 'claim')->>'ready')::boolean
                      and jsonb_array_length((select v::jsonb from ctx where k = 'claim')->'units') = 1, 'the poster claims exactly the one live payment');
select pg_temp.assert((select u->'doc'->>'entity' = 'SalesReceipt' and u->'doc'->>'deposit_account' = '3' and u->'doc'->>'doc_number' = 'R-26-1'
                              and u->'doc'->>'customer_status' in ('not_built','unmatched','matched','none')
                              and (u->'doc'->'lines'->0->>'amount_cents')::int = 5100 and u->'doc'->'lines'->0->>'item_id' = '20'
                         from jsonb_array_elements((select v::jsonb from ctx where k = 'claim')->'units') u),
  'as a SalesReceipt to undeposited funds, through the donation item, with the receipt number');
select pg_temp.assert((select status = 'skipped' and last_error like 'Historical payment%' from app.ledger_postings where idempotency_key = 't26:hist'),
  'a queued historical payment is skipped, never posted');
select pg_temp.assert((select status = 'skipped' and last_error like '%before the QuickBooks go-live date%' from app.ledger_postings where idempotency_key = 't26:early'),
  'a posting dated before go-live is skipped');
select pg_temp.assert((select status = 'failed' and last_error like 'April 2026 is closed%' from app.ledger_postings where idempotency_key = 't26:closed'),
  'a posting in a closed month waits for a person');
insert into ctx select 'lp1', id::text from app.ledger_postings where source_id = '26000000-0000-4000-8000-000000000001' and status = 'posting';
begin;
set local role connect_worker;
select pg_temp.assert(jsonb_array_length((app.qbo_worker_claim(:jsh, 25))->'units') = 0, 'a claimed posting is not handed out twice');
select pg_temp.assert(app.qbo_worker_posting_done(array[(select v::uuid from ctx where k = 'lp1')],
                                                   'SalesReceipt', '777', null) = 1, 'the service records the posted entry');
commit;
select pg_temp.assert((select status = 'posted' and qbo_ref = '777' and qbo_entity = 'SalesReceipt' and request_id = id::text
                        from app.ledger_postings where source_id = '26000000-0000-4000-8000-000000000001'),
  'posted once, with the QuickBooks id and the idempotency request id');
select pg_temp.assert(exists (select 1 from app.sync_log where external_ref = '777' and status = 'ok'), 'and logged in the sync log');

-- ── Sandbox community: sandbox company or real company read-only ─────────────
update app.centers set environment = 'sandbox' where id = :other;
begin;
set local role authenticated;
select pg_temp.sign_in('10000000-0000-4000-8000-000000000007');
insert into ctx select 'sb_real', app.start_qbo_connect(:other, 'real', 'https://portal.test/api/oauth/intuit/callback', 'Map the real chart')::text;
commit;
select pg_temp.assert(((select v::jsonb from ctx where k = 'sb_real')->>'read_only')::boolean and (select v::jsonb from ctx where k = 'sb_real')->>'mode' = 'test',
  'in a sandbox the real company is connected read-only, in test mode');
update app.integration_connections set status = 'connected', settings = settings || '{"mapping_approved_at":"2026-01-01","test_post_approved_at":"2026-01-01","go_live_date":"2026-01-01","basis":"cash"}'
 where center_id = :other and provider = 'quickbooks_online';
select pg_temp.assert(app.qbo_post_ready(:other)->>'reason' like '%read-only%', 'nothing ever posts to a read-only company');
begin;
set local role authenticated;
select pg_temp.sign_in('10000000-0000-4000-8000-000000000007');
select pg_temp.assert_raises($$select app.start_qbo_connect('00000000-0000-4000-8000-000000000002', 'sandbox', 'https://portal.test/api/oauth/intuit/callback', 'x')$$,
  'Disconnect it first', 'one QuickBooks company at a time');
commit;
update app.integration_connections set status = 'disconnected' where center_id = :other and provider = 'quickbooks_online';
begin;
set local role authenticated;
select pg_temp.sign_in('10000000-0000-4000-8000-000000000007');
insert into ctx select 'sb_sbx', app.start_qbo_connect(:other, 'sandbox', 'https://portal.test/api/oauth/intuit/callback', 'Sandbox company')::text;
commit;
select pg_temp.assert((select v::jsonb from ctx where k = 'sb_sbx')->>'provider' = 'intuit_sandbox'
                      and not ((select v::jsonb from ctx where k = 'sb_sbx')->>'read_only')::boolean,
  'a sandbox may connect an Intuit sandbox company, which it can post to');
update app.centers set environment = 'production' where id = :other;
update app.integration_connections set status = 'disconnected' where center_id = :other;

-- ── Module switch and readiness when QuickBooks is not used ──────────────────
begin;
set local role authenticated;
select pg_temp.sign_in(:ada);
select app.set_module_enabled(:jsh, 'accounting', false, 'QuickBooks test');
select pg_temp.assert((select ok and detail like 'QuickBooks not used%' from app.readiness(:jsh) where key = 'quickbooks_ready'),
  'with Accounting off, readiness 7 passes as "not used"');
select pg_temp.assert_raises($$select app.request_qbo_pull('00000000-0000-4000-8000-000000000001')$$, 'switched off', 'a switched-off module refuses its RPCs');
select app.set_module_enabled(:jsh, 'accounting', true, 'QuickBooks test done');
commit;

-- ── Disconnect ───────────────────────────────────────────────────────────────
begin;
set local role authenticated;
select pg_temp.sign_in(:tara, false);
select pg_temp.assert_state($$select app.disconnect_qbo('00000000-0000-4000-8000-000000000001', 'Test done')$$, 'CCSTP', 'disconnecting needs a fresh 2FA check');
commit;
begin;
set local role authenticated;
select pg_temp.sign_in(:tara);
select app.disconnect_qbo(:jsh, 'Test done');
commit;
select pg_temp.assert((select status = 'disconnected' from app.integration_connections where id = (select v::uuid from ctx where k = 'conn'))
                      and not exists (select 1 from app.integration_secrets where connection_id = (select v::uuid from ctx where k = 'conn')),
  'disconnected: the tokens are gone from the vault');
select pg_temp.assert(not (app.check_quickbooks_ready(:jsh)->>'ok')::boolean, 'readiness 7 fails again while Accounting is on and QuickBooks is disconnected');
update app.accounting_periods set status = 'open' where center_id = :jsh and period_month = '2026-04-01';
