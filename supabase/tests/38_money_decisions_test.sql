-- Wave F · stream f-money (0520–0522): the owner's second batch of 2026-09-25.
--   #12 a used OAuth authorization code leaves the vault (the worker's delete path)
--   QuickBooks: the accounting basis is the first choice after connecting; changing
--       it later needs the treasurer, a reason and a fresh 2FA check; posting stays
--       cash-only (accrual: postings wait, readiness says so plainly)
--   Year-end statements leave out opening-balance lines; history still has them
-- Everything runs in its own community (F38).
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
create or replace function pg_temp.as_user(p_user uuid, p_fresh boolean default true) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2',
    'amr', case when p_fresh then json_build_array(json_build_object('method','totp','timestamp',extract(epoch from now())::bigint))
                else json_build_array(json_build_object('method','otp','timestamp',extract(epoch from now())::bigint)) end)::text, true);
  perform set_config('request.headers', '{"x-client-app":"portal","x-client-screen":"/accounting/qbo/setup"}', true);
end $$;
grant connect_worker to postgres;

\set c '''00000000-0000-4000-8000-0000000000f8'''
\set tara '''10000000-0000-4000-8000-000000000003'''
\set priya '''10000000-0000-4000-8000-000000000001'''
\set conn '''f3800000-0000-4000-8000-0000000000c1'''
\set qbo '''f3800000-0000-4000-8000-0000000000d1'''
\set hh '''f3800000-0000-4000-8000-000000000001'''

insert into app.centers (id, slug, name, short_name, time_zone) values (:c, 'f38-temple', 'F38 Jain Temple', 'F38', 'America/Chicago');
insert into app.households (id, center_id, display_name) values (:hh, :c, 'Mehta family');
insert into app.people (id, center_id, first_name, last_name, email) values
  ('f3800000-0000-4000-8000-000000000101', :c, 'Priya', 'Mehta', 'priya@f38.test'),
  ('f3800000-0000-4000-8000-000000000103', :c, 'Tara', 'Shah', 'tara@f38.test');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:hh, 'f3800000-0000-4000-8000-000000000101', :c, 'primary', true);
insert into app.center_users (center_id, user_id, person_id, is_default) values
  (:c, :priya, 'f3800000-0000-4000-8000-000000000101', false), (:c, :tara, 'f3800000-0000-4000-8000-000000000103', false);
insert into app.role_grants (center_id, user_id, role_key) values (:c, :tara, 'treasurer');

-- ═════════════════════════════════════════════════════════════════════════════
-- #12 Used authorization codes leave the vault
-- ═════════════════════════════════════════════════════════════════════════════
insert into app.integration_connections (id, center_id, provider, status) values (:conn, :c, 'stripe', 'disconnected');
begin;
set local role connect_worker;
select app.worker_store_secret(:conn, 'oauth.code', 'ac_test_CODE00001234', 'callback');
select app.worker_store_secret(:conn, 'access_token', 'sk_acct_TOKEN0005678', 'job 1 oauth.exchange');
commit;
create temp table ctx (k text primary key, v text);
grant all on ctx to public;
insert into ctx select 'vault', vault_secret_id::text from app.integration_secrets where connection_id = :conn and name = 'oauth.code';

begin;
set local role authenticated;
select pg_temp.as_user(:tara);
select pg_temp.assert_raises($$select app.worker_remove_oauth_code('f3800000-0000-4000-8000-0000000000c1', 'oauth.code', 'exchanged')$$,
  'permission denied', '#12 only the background service can remove a code this way');
rollback;
begin;
set local role connect_worker;
select pg_temp.assert_raises($$select app.worker_remove_oauth_code('f3800000-0000-4000-8000-0000000000c1', 'access_token', 'exchanged')$$,
  'Only an authorization code', '#12 the delete path cannot remove a token or API key');
select pg_temp.assert_raises($$select app.worker_remove_oauth_code('f3800000-0000-4000-8000-0000000000c1', 'oauth.code', 'because')$$,
  'exchanged or unusable', '#12 it says why the code is removed');
select pg_temp.assert(app.worker_remove_oauth_code(:conn, 'oauth.code', 'exchanged'), '#12 the worker removes the used code');
select pg_temp.assert(not app.worker_remove_oauth_code(:conn, 'oauth.code', 'exchanged'), '#12 removing it again finds nothing (no error)');
commit;
select pg_temp.assert(not exists (select 1 from app.integration_secrets where connection_id = :conn and name = 'oauth.code')
                      and not exists (select 1 from vault.secrets where id = (select v::uuid from ctx where k = 'vault')),
  '#12 the fingerprint row and the vault entry are both gone');
select pg_temp.assert(exists (select 1 from app.integration_secrets where connection_id = :conn and name = 'access_token'),
  '#12 the tokens stay');
select pg_temp.assert((select reason = 'Background service: used authorization code removed after exchange' and client_app = 'job'
                         and before->>'name' = 'oauth.code'
                         and position('ac_test_CODE' in coalesce(before::text, '') || coalesce(after::text, '')) = 0
                         from app.audit_log where action = 'integration_secrets.delete' and before->>'connection_id' = :conn
                        order by id desc limit 1),
  '#12 audited as the background service''s work, "used authorization code removed after exchange", without the value');
begin;
set local role connect_worker;
select app.worker_store_secret(:conn, 'oauth.code', 'ac_test_CODE00009999', 'callback');
select app.worker_remove_oauth_code(:conn, 'oauth.code', 'unusable');
commit;
select pg_temp.assert((select reason like '%failed exchange (a retry could not use it)' from app.audit_log
                        where action = 'integration_secrets.delete' and before->>'connection_id' = :conn order by id desc limit 1),
  '#12 a code a retry could not use is removed with its own reason');

-- ═════════════════════════════════════════════════════════════════════════════
-- QuickBooks: the basis first, cash posting only
-- ═════════════════════════════════════════════════════════════════════════════
insert into app.integration_connections (id, center_id, provider, status, external_account_id, display_name, settings)
values (:qbo, :c, 'quickbooks_online', 'connected', '9130350000000038', 'F38 books', '{"mode":"live","read_only":false}');
insert into app.qbo_accounts (center_id, connection_id, qbo_id, name, account_type, active) values
  (:c, :qbo, '1', 'Donations', 'Income', true), (:c, :qbo, '2', 'Chase Operating', 'Bank', true),
  (:c, :qbo, '3', 'Undeposited Funds', 'Other Current Asset', true), (:c, :qbo, '4', 'Stripe Clearing', 'Bank', true),
  (:c, :qbo, '5', 'Merchant Fees', 'Expense', true), (:c, :qbo, '11', 'Pledges receivable', 'Accounts Receivable', true);
insert into app.qbo_pull_runs (center_id, connection_id, status, finished_at) values (:c, :qbo, 'succeeded', now());

select pg_temp.assert(app.qbo_post_ready(:c)->>'reason' = 'The accounting basis (cash or accrual) is not chosen yet.',
  'basis: nothing posts before the basis is chosen');
select pg_temp.assert((app.check_quickbooks_ready(:c)->>'detail') like '%choose the accounting basis (cash or accrual)%',
  'basis: readiness check 7 lists the basis as still to do');

begin;
set local role authenticated;
select pg_temp.as_user(:priya);
select pg_temp.assert_raises($$select app.set_qbo_basis('00000000-0000-4000-8000-0000000000f8', 'cash', 'x')$$, 'treasurer (accounting.manage)',
  'basis: a member cannot choose it');
rollback;
begin;
set local role authenticated;
select pg_temp.as_user(:tara, false);
select pg_temp.assert_raises($$select app.set_qbo_mapping('00000000-0000-4000-8000-0000000000f8', 'income.general', '1', 'x')$$, 'accounting basis',
  'basis: nothing is mapped before the basis is chosen');
select pg_temp.assert_raises($$select app.set_qbo_settings('00000000-0000-4000-8000-0000000000f8', null, 'per_txn', current_date, 'x')$$, 'accounting basis',
  'basis: posting and go-live wait for the basis');
select pg_temp.assert_raises($$select app.set_qbo_basis('00000000-0000-4000-8000-0000000000f8', 'cash', ' ')$$, 'Say why',
  'basis: a reason is required');
select pg_temp.assert((app.set_qbo_basis(:c, 'accrual', 'Our auditor keeps pledges receivable'))->>'first' = 'true',
  'basis: the treasurer chooses it first, without a fresh 2FA check');
commit;
select pg_temp.assert((select settings->>'basis' = 'accrual' and settings->>'basis_chosen_by' = :tara and settings ? 'basis_chosen_at'
                         from app.integration_connections where id = :qbo),
  'basis: stored in integration_connections.settings.basis with who and when');
select pg_temp.assert(exists (select 1 from app.audit_log where action = 'integration_connections.update' and reason = 'Our auditor keeps pledges receivable'),
  'basis: the choice is audited with its reason');
select pg_temp.assert('pledges_receivable' = any (app.qbo_required_purposes(:c)), 'basis: accrual needs the pledges receivable account');

-- Accrual: postings wait, plainly.
select pg_temp.assert((app.qbo_post_ready(:c)->>'reason') like 'Accrual-basis posting isn''t available yet%postings wait in the queue%'
                      or (app.qbo_post_ready(:c)->>'reason') like 'Accrual-basis posting isn''t available yet%Postings wait in the queue%',
  'accrual: the poster says accrual posting is not available yet and postings wait');
select pg_temp.assert(not (app.check_quickbooks_ready(:c)->>'ok')::boolean
                      and (app.check_quickbooks_ready(:c)->>'detail') like '%on accrual basis. Accrual-basis posting isn''t available yet%',
  'accrual: readiness check 7 says so plainly');
update app.integration_connections set settings = settings || jsonb_build_object('go_live_date', to_char(current_date - 30, 'YYYY-MM-DD'),
  'mapping_approved_at', now(), 'test_post_approved_at', now()) where id = :qbo;
insert into app.payments (id, center_id, household_id, amount_cents, method, status, provider, received_on)
values ('f3800000-0000-4000-8000-0000000000a1', :c, :hh, 2500, 'check', 'captured', 'offline', current_date);
select pg_temp.assert(exists (select 1 from app.ledger_postings where center_id = :c and source_id = 'f3800000-0000-4000-8000-0000000000a1' and status = 'queued'),
  'accrual: the new payment is queued for QuickBooks');
begin;
set local role connect_worker;
select pg_temp.assert((app.qbo_worker_claim(:c, 25)->>'ready') = 'false', 'accrual: the poster claims nothing');
commit;
select pg_temp.assert(not exists (select 1 from app.ledger_postings where center_id = :c and status <> 'queued'),
  'accrual: every posting still waits in the queue (nothing posted, skipped or failed)');
begin;
set local role connect_worker;
select pg_temp.assert(not exists (select 1 from jsonb_array_elements(app.qbo_worker_due()) d where d->>'center_id' = :c and (d->>'post')::boolean),
  'accrual: the hourly round does not queue the poster');
commit;

-- Changing the basis later: the treasurer, a reason and a fresh 2FA check.
begin;
set local role authenticated;
select pg_temp.as_user(:tara, false);
select pg_temp.assert_state($$select app.set_qbo_basis('00000000-0000-4000-8000-0000000000f8', 'cash', 'Back to cash')$$, 'CCSTP',
  'change: needs a fresh 2FA check');
select pg_temp.assert_state($$select app.set_qbo_settings('00000000-0000-4000-8000-0000000000f8', 'cash', 'per_txn', current_date, 'Back to cash')$$, 'CCSTP',
  'change: set_qbo_settings cannot change it without the 2FA check either');
select pg_temp.assert((app.set_qbo_basis(:c, 'accrual', 'Same again'))->>'changed' = 'false', 'change: choosing the same basis changes nothing');
rollback;
begin;
set local role authenticated;
select pg_temp.as_user(:tara);
select pg_temp.assert((app.set_qbo_basis(:c, 'cash', 'We stay on cash basis until an accrual customer needs it'))->>'from' = 'accrual',
  'change: with a fresh 2FA check the treasurer changes it');
commit;
select pg_temp.assert((select settings->>'basis' = 'cash' and settings->>'basis_changed_by' = :tara and settings->>'basis_changed_from' = 'accrual'
                          and not (settings ? 'mapping_approved_at') and not (settings ? 'test_post_approved_at')
                         from app.integration_connections where id = :qbo),
  'change: recorded, and the mapping and test post must be approved again');

-- Existing connections: a mapping made before this rule keeps cash (what the poster already used).
select pg_temp.assert((select count(*) = 0 from app.integration_connections c
                        where c.provider in ('quickbooks_online','intuit_sandbox')
                          and coalesce(c.settings->>'basis', '') not in ('cash','accrual')
                          and exists (select 1 from app.qbo_account_mappings m where m.center_id = c.center_id)),
  'backfill: no connection with a mapping is left without a basis');

-- ═════════════════════════════════════════════════════════════════════════════
-- Year-end statements leave out opening-balance lines
-- ═════════════════════════════════════════════════════════════════════════════
-- (b3 was partly refunded earlier: 2,000 of 7,000, approved by two people.)
insert into app.payments (id, center_id, household_id, amount_cents, method, status, provider, received_on, is_historical, is_opening_balance) values
  ('f3800000-0000-4000-8000-0000000000b1', :c, :hh, 10000, 'check', 'settled', 'offline', '2025-03-01', true, false),
  ('f3800000-0000-4000-8000-0000000000b2', :c, :hh, 50000, 'other', 'settled', 'import', '2025-01-15', true, true),
  ('f3800000-0000-4000-8000-0000000000b4', :c, :hh, 9900, 'card', 'failed', 'offline', '2025-07-01', false, false),
  ('f3800000-0000-4000-8000-0000000000b5', :c, :hh, 4000, 'cash', 'captured', 'offline', '2024-12-31', false, false);
insert into app.payments (id, center_id, household_id, amount_cents, refunded_cents, refund_approved_by, refund_second_approver, method, status, provider, received_on)
values ('f3800000-0000-4000-8000-0000000000b3', :c, :hh, 7000, 2000, :tara, :priya, 'card', 'partially_refunded', 'offline', '2025-06-01');

begin;
set local role authenticated;
select pg_temp.as_user(:priya);
select pg_temp.assert((app.year_end_statement(:hh, 2025)->>'total_cents')::bigint = 15000
                      and (app.year_end_statement(:hh, 2025)->>'gift_count')::int = 2,
  'statement: the 2025 total is the gifts only (opening balance, failed and other years left out; refunds netted)');
select pg_temp.assert(not exists (select 1 from jsonb_array_elements(app.year_end_statement(:hh, 2025)->'lines') l
                                   where l->>'payment_id' = 'f3800000-0000-4000-8000-0000000000b2'),
  'statement: the opening-balance line is not on the statement');
select pg_temp.assert((app.year_end_statement(:hh, 2025)->'left_out'->>'opening_balance_cents')::bigint = 50000
                      and (app.year_end_statement(:hh, 2025)->'left_out'->>'reason') like 'Opening-balance lines are left out%',
  'statement: it says what it left out and why');
select pg_temp.assert(exists (select 1 from app.payments where id = 'f3800000-0000-4000-8000-0000000000b2' and is_opening_balance),
  'history: the household still sees the opening-balance line in its payments');
rollback;
begin;
set local role authenticated;
select pg_temp.as_user('10000000-0000-4000-8000-000000000007');
select pg_temp.assert_raises($$select app.year_end_statement('f3800000-0000-4000-8000-000000000001', 2025)$$, 'needs an adult of the household',
  'statement: someone outside the household and without giving access cannot read it');
rollback;
begin;
set local role authenticated;
select pg_temp.as_user(:tara);
select pg_temp.assert((app.year_end_statement(:hh, 2025)->>'total_cents')::bigint = 15000, 'statement: the treasurer sees the same total');
rollback;
select pg_temp.assert_raises($$update app.payments set receipt_sent_at = now() where id = 'f3800000-0000-4000-8000-0000000000b2'$$,
  'payments_opening_balance_no_receipt', 'receipts: an opening-balance line is never sent a receipt');
