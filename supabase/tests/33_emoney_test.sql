-- Wave E · stream e-money (0410–0414): the owner's money decisions of 2026-09-25.
--   #5  donor-covers-fee is not offered (no fee is ever added)
--   #6  a refund made in the Stripe/PayPal dashboard is FLAGGED and changes nothing
--       until two different people approve it after the fact
--   #7  email-only PayPal: a refund is recorded by hand after the two-person approval
--   #11 QuickBooks refunds / credit memos come in as historical refunds reducing the
--       matching historical payment (never posted back)
--   #24 pledge history import: one opening-balance line per pledge; written-off
--       pledges imported closed and unpaid, with who/when/why
--   write-off → QuickBooks: CreditMemo applied to the invoice / JournalEntry on
--       accrual / skipped with the reason; idempotent, go-live date, closed months
--   #10 the live test post is explained before it runs
-- Everything runs in its own community (E33), so earlier tests' QuickBooks and
-- payment state cannot change the outcome.
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
  perform set_config('request.headers', '{"x-client-app":"portal","x-client-screen":"/giving/payments"}', true);
end $$;
grant connect_worker to postgres;
create temp table ctx (k text primary key, v text);
grant all on ctx to public;

\set c '''00000000-0000-4000-8000-0000000000e3'''
\set tara '''10000000-0000-4000-8000-000000000003'''
\set sam '''10000000-0000-4000-8000-000000000008'''
\set priya '''10000000-0000-4000-8000-000000000001'''

-- ── Fixtures: a community, two treasurers, a family ──────────────────────────
insert into app.centers (id, slug, name, short_name, time_zone) values (:c, 'e33-temple', 'E33 Jain Temple', 'E33', 'America/Chicago');
insert into app.households (id, center_id, display_name) values ('e3300000-0000-4000-8000-000000000001', :c, 'Doshi family');
insert into app.people (id, center_id, first_name, last_name, email) values
  ('e3300000-0000-4000-8000-000000000101', :c, 'Hina', 'Doshi', 'hina@doshi.test');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  ('e3300000-0000-4000-8000-000000000001', 'e3300000-0000-4000-8000-000000000101', :c, 'primary', true);
insert into app.role_grants (center_id, user_id, role_key) values (:c, :tara, 'treasurer'), (:c, :sam, 'treasurer');
insert into app.funds (id, center_id, key, name) values ('e3300000-0000-4000-8000-0000000000f1', :c, 'general', 'General fund');

-- ═════════════════════════════════════════════════════════════════════════════
-- #5 Donor covers the fee: not offered
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert(not exists (select 1 from app.center_payment_processors where donor_covers_fee_allowed),
  '#5 no organization has donor-covers-fee switched on');
select pg_temp.assert_raises($$insert into app.center_payment_processors (center_id, processor, donor_covers_fee_allowed)
                               values ('00000000-0000-4000-8000-0000000000e3', 'stripe', true)$$,
  'center_payment_processors_no_donor_fee', '#5 the database refuses switching it on');
begin;
set local role authenticated;
select pg_temp.as_user(:tara);
select pg_temp.assert_raises($$select app.set_payment_processor('00000000-0000-4000-8000-0000000000e3', 'stripe', array['card'], null, true, 'Let donors cover it')$$,
  'not offered yet', '#5 set_payment_processor says plainly that it is not offered');
rollback;

-- ═════════════════════════════════════════════════════════════════════════════
-- #6 A refund made in the Stripe dashboard: flagged, then two approvals
-- ═════════════════════════════════════════════════════════════════════════════
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, source, amount_cents, pledged_at)
values ('e3300000-0000-4000-8000-0000000000a1', :c, 'e3300000-0000-4000-8000-000000000001', 'e3300000-0000-4000-8000-000000000101',
        'general', 10000, now() - interval '30 days');
insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, provider_ref, received_on)
values ('e3300000-0000-4000-8000-0000000000b1', :c, 'e3300000-0000-4000-8000-000000000001', 'e3300000-0000-4000-8000-000000000101',
        10000, 'card', 'captured', 'stripe', 'pi_e33_1', current_date - 3);
select app.allocate_payment('e3300000-0000-4000-8000-0000000000b1', array['e3300000-0000-4000-8000-0000000000a1']::uuid[], true);
insert into ctx select 'alloc_before', (select jsonb_agg(to_jsonb(a) - 'created_at' order by a.id)::text from app.payment_allocations a
                                         where payment_id = 'e3300000-0000-4000-8000-0000000000b1');

begin;
set local role authenticated;
select pg_temp.as_user(:tara);
select pg_temp.assert_raises($$select app.worker_flag_provider_refund('stripe', 'pi_e33_1', 2500, 're_dash_1', current_date, 'charge.refunded')$$,
  'permission denied', '#6 people cannot flag refunds (the background service only)');
rollback;

-- Our own refund still on its way: the event is tried again later.
insert into app.jobs (center_id, kind, payload, status) values (:c, 'payments.refund', '{"payment_id":"e3300000-0000-4000-8000-0000000000b1"}', 'running');
begin;
set local role connect_worker;
select pg_temp.assert_raises($$select app.worker_flag_provider_refund('stripe', 'pi_e33_1', 2500, 're_dash_1', current_date, 'charge.refunded')$$,
  'still being recorded', '#6 while a refund Community Connect sent is still on its way, the webhook waits and retries');
rollback;
update app.jobs set status = 'done' where center_id = :c and kind = 'payments.refund';

begin;
set local role connect_worker;
insert into ctx select 'flag1', app.worker_flag_provider_refund('stripe', 'pi_e33_1', 2500, 're_dash_1', current_date, 'charge.refunded')::text;
insert into ctx select 'flag2', app.worker_flag_provider_refund('stripe', 'pi_e33_1', 2500, 're_dash_1', current_date, 'charge.refunded')::text;
insert into ctx select 'flag3', app.worker_flag_provider_refund('stripe', 'pi_unknown', 2500, 're_x', current_date, 'charge.refunded')::text;
commit;
select pg_temp.assert((select v::jsonb->>'outcome' = 'flagged' and (v::jsonb->>'amount_cents')::int = 2500 from ctx where k = 'flag1'),
  '#6 a $25 refund made in the Stripe dashboard is flagged');
select pg_temp.assert((select v::jsonb->>'outcome' = 'already_recorded' from ctx where k = 'flag2'),
  '#6 the same event again flags nothing more (idempotent)');
select pg_temp.assert((select v::jsonb->>'outcome' = 'not_ours' from ctx where k = 'flag3'), '#6 a charge that is not ours is ignored');
select pg_temp.assert((select refunded_cents = 0 and status = 'captured' and refund_approved_by is null
                         from app.payments where id = 'e3300000-0000-4000-8000-0000000000b1'),
  '#6 a flagged refund changes nothing on the payment');
select pg_temp.assert((select jsonb_agg(to_jsonb(a) - 'created_at' order by a.id)::text from app.payment_allocations a
                        where payment_id = 'e3300000-0000-4000-8000-0000000000b1') = (select v from ctx where k = 'alloc_before')
                      and (select status = 'paid' from app.pledges where id = 'e3300000-0000-4000-8000-0000000000a1'),
  '#6 ...nor on its allocations (the pledge stays paid)');
select pg_temp.assert((select status = 'flagged' and source = 'provider_dashboard' and provider_ref = 're_dash_1' and amount_cents = 2500
                         from app.payment_refunds where payment_id = 'e3300000-0000-4000-8000-0000000000b1'),
  '#6 the flagged refund keeps the provider''s refund reference');
select pg_temp.assert((select client_app = 'job' and module = 'giving' and reason like 'Refund made in the Stripe dashboard%flagged%'
                         from app.audit_log where action = 'payment_refunds.insert' order by id desc limit 1),
  '#6 flagging is audited as the background service, module giving, with why');
select pg_temp.assert(exists (select 1 from app.sync_log where operation = 'refund_flagged' and external_ref = 're_dash_1'),
  '#6 the sync log shows the refund came in from Stripe');

-- Where it shows: the screens' list, the readiness check, the count for alerts.
begin;
set local role authenticated;
select pg_temp.as_user(:tara, false);
select pg_temp.assert(jsonb_array_length(app.flagged_refunds('00000000-0000-4000-8000-0000000000e3')) = 1
                      and app.flagged_refund_count('00000000-0000-4000-8000-0000000000e3') = 1,
  '#6 Giving › Payments lists the flagged refund and the alerts count it');
select pg_temp.assert(app.check_payments_live('00000000-0000-4000-8000-0000000000e3')->>'detail' like '%1 refund made in the Stripe/PayPal dashboard waits for two approvals%',
  '#6 readiness check 6 mentions it');
rollback;
begin;
set local role authenticated;
select pg_temp.as_user(:priya);
select pg_temp.assert((select count(*) from app.payment_refunds) = 0 and jsonb_array_length(app.flagged_refunds('00000000-0000-4000-8000-0000000000e3')) = 0,
  '#6 a member reads no refunds');
rollback;

-- Approvals.
select id as rid from app.payment_refunds where payment_id = 'e3300000-0000-4000-8000-0000000000b1' \gset
begin;
set local role authenticated;
select pg_temp.as_user(:priya);
select pg_temp.assert_raises(format($$select app.approve_flagged_refund(%L, 'ok')$$, :'rid'), 'needs giving.manage',
  '#6 someone without the refund permission cannot approve');
rollback;
begin;
set local role authenticated;
select pg_temp.as_user(:tara, false);
select pg_temp.assert_state(format($$select app.approve_flagged_refund(%L, 'Donor asked in person')$$, :'rid'), 'CCSTP',
  '#6 approving needs a fresh 2FA check');
rollback;
begin;
set local role authenticated;
select pg_temp.as_user(:tara);
select pg_temp.assert_raises(format($$select app.approve_flagged_refund(%L, ' ')$$, :'rid'), 'say why', '#6 approving needs a reason');
select pg_temp.assert((app.approve_flagged_refund(:'rid', 'Donor asked in person; confirmed with the office')->>'stage') = 'first',
  '#6 the treasurer approves first');
select pg_temp.assert_raises(format($$select app.approve_flagged_refund(%L, 'me again')$$, :'rid'), 'different person',
  '#6 the same person cannot also be the second approver');
commit;
select pg_temp.assert((select refunded_cents = 0 from app.payments where id = 'e3300000-0000-4000-8000-0000000000b1'),
  '#6 one approval still changes nothing');
begin;
set local role authenticated;
select pg_temp.as_user(:sam);
select pg_temp.assert((app.approve_flagged_refund(:'rid', 'Checked the Stripe dashboard')->>'stage') = 'applied',
  '#6 a different person with giving.approve approves second, and it is recorded');
commit;
select pg_temp.assert((select refunded_cents = 2500 and status = 'partially_refunded' and refund_approved_by = :tara::uuid
                              and refund_second_approver = :sam::uuid
                         from app.payments where id = 'e3300000-0000-4000-8000-0000000000b1'),
  '#6 recorded exactly like any refund: $25 of $100, both approvers named');
select pg_temp.assert((select status = 'applied' and first_approver = :tara::uuid and second_approver = :sam::uuid and applied_at is not null
                         from app.payment_refunds where id = :'rid'), '#6 the flagged refund is marked recorded');
select pg_temp.assert((select count(*) = 2 from app.audit_log where action = 'payment_refunds.update' and record_id = :'rid'
                         and client_app = 'portal' and module = 'giving' and reason in ('Donor asked in person; confirmed with the office', 'Checked the Stripe dashboard')),
  '#6 both approvals are audited with their reasons');
begin;
set local role connect_worker;
select pg_temp.assert((app.worker_flag_provider_refund('stripe', 'pi_e33_1', 2500, 're_dash_1', current_date, 'charge.refunded')->>'outcome') = 'already_recorded',
  '#6 the same Stripe total after recording flags nothing');
select pg_temp.assert((app.worker_flag_provider_refund('stripe', 'pi_e33_1', 4000, 're_dash_2', current_date, 'charge.refunded')->>'amount_cents')::int = 1500,
  '#6 a second dashboard refund flags only the difference');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- #7 PayPal connected by email only: record the refund by hand
-- ═════════════════════════════════════════════════════════════════════════════
insert into app.integration_connections (id, center_id, provider, status, settings)
values ('e3300000-0000-4000-8000-0000000000c7', :c, 'paypal', 'connected',
        '{"mode":"live","connect_method":"email","paypal_email":"giving@e33.test"}');
insert into app.center_payment_processors (center_id, processor, connection_id, status, methods)
values (:c, 'paypal', 'e3300000-0000-4000-8000-0000000000c7', 'live', array['paypal']);
insert into app.payments (id, center_id, household_id, amount_cents, method, status, provider, provider_ref, received_on)
values ('e3300000-0000-4000-8000-0000000000b7', :c, 'e3300000-0000-4000-8000-000000000001', 5100, 'paypal', 'captured', 'paypal', 'CAP-E33-7',
        current_date - 5);
begin;
set local role authenticated;
select pg_temp.as_user(:tara);
select pg_temp.assert(app.paypal_email_only('00000000-0000-4000-8000-0000000000e3'), '#7 the PayPal account is connected by email only');
select pg_temp.assert_raises($$select app.record_manual_paypal_refund('e3300000-0000-4000-8000-0000000000b7', 5100, current_date, '1AB23456CD789012E', 'Duplicate')$$,
  'two different approvers', '#7 nothing is recorded before the two-person approval');
update app.payments set refund_approved_by = :tara, refund_reason = 'Duplicate gift', refund_requested_cents = 5100
 where id = 'e3300000-0000-4000-8000-0000000000b7';
commit;
begin;
set local role authenticated;
select pg_temp.as_user(:sam);
select app.approve_as_second('payments', 'e3300000-0000-4000-8000-0000000000b7');
commit;
begin;
set local role authenticated;
select pg_temp.as_user(:tara);
select pg_temp.assert_raises($$select app.record_manual_paypal_refund('e3300000-0000-4000-8000-0000000000b7', 5100, current_date, 'x', 'Duplicate')$$,
  'transaction id', '#7 the PayPal transaction id is required and checked');
select pg_temp.assert_raises($$select app.record_manual_paypal_refund('e3300000-0000-4000-8000-0000000000b7', 5100, current_date + 2, '1AB23456CD789012E', 'Duplicate')$$,
  'not in the future', '#7 the date cannot be in the future');
select pg_temp.assert_raises($$select app.record_manual_paypal_refund('e3300000-0000-4000-8000-0000000000b7', 9900, current_date, '1AB23456CD789012E', 'Duplicate')$$,
  'more than what is left', '#7 not more than the payment');
select pg_temp.assert(((app.record_manual_paypal_refund('e3300000-0000-4000-8000-0000000000b7', 5100, current_date - 1, '1ab23456cd789012e',
                                                        'Refunded in PayPal on the donor''s request'))->>'refunded_cents')::int = 5100,
  '#7 after both approvals the treasurer records the PayPal refund by hand');
select pg_temp.assert_raises($$select app.record_manual_paypal_refund('e3300000-0000-4000-8000-0000000000b7', 100, current_date, '1AB23456CD789012E', 'again')$$,
  'already recorded', '#7 the same PayPal transaction cannot be recorded twice');
commit;
select pg_temp.assert((select p.status = 'refunded' and r.source = 'manual_paypal' and r.provider_ref = '1AB23456CD789012E' and r.refunded_on = current_date - 1
                              and r.first_approver = :tara::uuid and r.second_approver = :sam::uuid
                         from app.payments p join app.payment_refunds r on r.payment_id = p.id where p.id = 'e3300000-0000-4000-8000-0000000000b7'),
  '#7 recorded: payment refunded, the PayPal id, date and both approvers kept');
select pg_temp.assert((select reason = 'Refunded in PayPal on the donor''s request' and client_app = 'portal'
                         from app.audit_log where action = 'payments.update' and record_id = 'e3300000-0000-4000-8000-0000000000b7' order by id desc limit 1),
  '#7 audited with the reason');
update app.integration_connections set settings = settings || '{"connect_method":"partner"}' where id = 'e3300000-0000-4000-8000-0000000000c7';
begin;
set local role authenticated;
select pg_temp.as_user(:tara);
select pg_temp.assert_raises($$select app.record_manual_paypal_refund('e3300000-0000-4000-8000-0000000000b7', 100, current_date, '9ZZ23456CD789012E', 'x')$$,
  'Refund through PayPal', '#7 a PayPal account connected with refund permission refunds through PayPal instead');
rollback;

-- ═════════════════════════════════════════════════════════════════════════════
-- QuickBooks: a connected company for #11 and the write-off
-- ═════════════════════════════════════════════════════════════════════════════
insert into app.integration_connections (id, center_id, provider, status, external_account_id, settings)
values ('e3300000-0000-4000-8000-0000000000d1', :c, 'quickbooks_online', 'connected', '9130350000000001',
        jsonb_build_object('mode', 'live', 'basis', 'cash', 'posting', 'per_txn', 'go_live_date', to_char(current_date - 60, 'YYYY-MM-DD'),
                           'read_only', false));
insert into app.qbo_accounts (center_id, connection_id, qbo_id, name, account_type, active) values
  (:c, 'e3300000-0000-4000-8000-0000000000d1', '1', 'Donations', 'Income', true),
  (:c, 'e3300000-0000-4000-8000-0000000000d1', '2', 'Chase Operating', 'Bank', true),
  (:c, 'e3300000-0000-4000-8000-0000000000d1', '10', 'Pledge write-offs', 'Expense', true),
  (:c, 'e3300000-0000-4000-8000-0000000000d1', '11', 'Pledges receivable', 'Accounts Receivable', true);
insert into app.qbo_items (center_id, connection_id, qbo_id, name, active, raw) values
  (:c, 'e3300000-0000-4000-8000-0000000000d1', '20', 'Donation', true, '{"Type":"Service","IncomeAccountRef":{"value":"1"}}'),
  (:c, 'e3300000-0000-4000-8000-0000000000d1', '23', 'Pledge write-off', true, '{"Type":"Service","IncomeAccountRef":{"value":"10"}}');
insert into app.qbo_account_mappings (center_id, purpose, qbo_account_id) values
  (:c, 'income.general', '1'), (:c, 'bank', '2'), (:c, 'pledge_writeoffs', '10'), (:c, 'pledges_receivable', '11');
select set_config('app.qbo_mapping_approval', 'on', false);
update app.qbo_account_mappings set approved_at = now(), approved_by = :tara where center_id = :c;
select set_config('app.qbo_mapping_approval', 'off', false);
update app.integration_connections
   set settings = settings || jsonb_build_object('mapping_approved_at', now(), 'mapping_approved_by', :tara,
                                                 'test_post_approved_at', now(), 'test_post_approved_by', :tara)
 where id = 'e3300000-0000-4000-8000-0000000000d1';
select pg_temp.assert(app.qbo_purposes() ? 'pledge_writeoffs' and app.qbo_purposes()->'pledge_writeoffs' ? 'Expense',
  'write-off: a mapping purpose "Pledge write-offs" (expense or contra-income)');
select pg_temp.assert((app.qbo_post_ready(:c)->>'ok')::boolean, 'the E33 company is ready to post');

-- An approved donor match with history: two receipts, an invoice, a refund, two credit memos.
insert into app.qbo_customers (center_id, qbo_id, display_name) values (:c, '701', 'Doshi Family');
insert into app.qbo_customer_matches (center_id, qbo_customer_id, household_id, status, confidence, method, decided_by, decided_at, reason)
values (:c, '701', 'e3300000-0000-4000-8000-000000000001', 'approved', 1, 'manual', :tara, now(), 'Same family');
begin;
set local role connect_worker;
select pg_temp.assert(app.qbo_worker_store_transactions(:c, $$[
  {"qbo_type":"SalesReceipt","qbo_id":"7101","customer_qbo_id":"701","txn_date":"2024-01-10","doc_number":"SR-7101","total_cents":20000,"payment_method":"Check"},
  {"qbo_type":"SalesReceipt","qbo_id":"7102","customer_qbo_id":"701","txn_date":"2024-02-10","doc_number":"SR-7102","total_cents":7500,"payment_method":"Cash"},
  {"qbo_type":"RefundReceipt","qbo_id":"7201","customer_qbo_id":"701","txn_date":"2024-03-01","doc_number":"RR-7201","total_cents":7500,"memo":"Returned the duplicate"},
  {"qbo_type":"CreditMemo","qbo_id":"7301","customer_qbo_id":"701","txn_date":"2024-01-05","doc_number":"CM-7301","total_cents":2500},
  {"qbo_type":"CreditMemo","qbo_id":"7302","customer_qbo_id":"701","txn_date":"2024-04-01","doc_number":"CM-7302","total_cents":1000,
   "linked":[{"type":"Payment","id":"7999","amount_cents":0}]},
  {"qbo_type":"Invoice","qbo_id":"7401","customer_qbo_id":"701","txn_date":"2024-05-01","doc_number":"INV-7401","total_cents":50000,"open_balance_cents":50000}
]$$::jsonb) = 6, 'history copied: receipts, a refund receipt, two credit memos, an open invoice');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- #11 QuickBooks refunds and credit memos → historical refunds
-- ═════════════════════════════════════════════════════════════════════════════
begin;
set local role connect_worker;
insert into ctx select 'bring', app.qbo_worker_bring_in(:c, '701')::text;
commit;
select pg_temp.assert((select (v::jsonb->>'brought_in')::int = 4 and (v::jsonb->>'needs_review')::int = 2 from ctx where k = 'bring'),
  '#11 two receipts, an invoice and the refund are brought in; two credit memos wait');
select pg_temp.assert((select p.refunded_cents = 7500 and p.status = 'refunded' and p.is_historical
                         from app.payments p where p.crm_external_id = 'qbo:SalesReceipt:7102'),
  '#11 the $75 refund receipt reduces the $75 receipt it matches (exact amount, dated before it)');
select pg_temp.assert((select refunded_cents = 0 from app.payments where crm_external_id = 'qbo:SalesReceipt:7101'),
  '#11 ...and not the other one');
select pg_temp.assert((select r.source = 'qbo_history' and r.status = 'applied' and r.provider_ref = 'qbo:RefundReceipt:7201' and r.refunded_on = '2024-03-01'
                              and r.first_approver is null
                         from app.payment_refunds r where r.provider_ref = 'qbo:RefundReceipt:7201'),
  '#11 recorded as a historical refund with its QuickBooks reference');
select pg_temp.assert((select cc_status = 'brought_in' and cc_payment_id = (select id from app.payments where crm_external_id = 'qbo:SalesReceipt:7102')
                              and cc_detail like 'Brought in as a $75.00 refund of payment%'
                         from app.qbo_transactions where center_id = :c and qbo_id = '7201'),
  '#11 Donor matching shows what it reduced');
select pg_temp.assert((select cc_status = 'needs_review' and cc_detail like 'No payment brought in from this QuickBooks customer, dated on or before January 5, 2024%'
                         from app.qbo_transactions where center_id = :c and qbo_id = '7301'),
  '#11 a credit memo with no payment before it stays in Needs review with the reason');
select pg_temp.assert((select cc_status = 'needs_review' and cc_detail like 'This credit memo was applied to an invoice%'
                         from app.qbo_transactions where center_id = :c and qbo_id = '7302'),
  '#11 a credit memo applied to an invoice stays in Needs review: no money went back');
select pg_temp.assert(not exists (select 1 from app.ledger_postings l join app.payments p on p.id = l.source_id where p.center_id = :c and p.provider = 'quickbooks'),
  '#11 nothing brought in (refunds included) is ever posted back to QuickBooks');
begin;
set local role connect_worker;
insert into ctx select 'bring2', app.qbo_worker_bring_in(:c, '701')::text;
commit;
select pg_temp.assert((select (v::jsonb->>'brought_in')::int = 0 from ctx where k = 'bring2')
                      and (select refunded_cents = 7500 from app.payments where crm_external_id = 'qbo:SalesReceipt:7102')
                      and (select count(*) = 1 from app.payment_refunds where center_id = :c and source = 'qbo_history'),
  '#11 bringing in again refunds nothing twice');
begin;
set local role authenticated;
select pg_temp.as_user(:tara);
select pg_temp.assert_raises($$update app.payments set refunded_cents = 100 where crm_external_id = 'qbo:SalesReceipt:7101'$$,
  'two different approvers', '#11 a person still cannot record a refund on a historical payment without two approvers');
rollback;

-- ═════════════════════════════════════════════════════════════════════════════
-- Pledge write-off → QuickBooks
-- ═════════════════════════════════════════════════════════════════════════════
select id as inv_pledge from app.pledges where center_id = :c and crm_external_id = 'qbo:Invoice:7401' \gset
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, source, amount_cents, pledged_at, fund_id)
values ('e3300000-0000-4000-8000-0000000000a2', :c, 'e3300000-0000-4000-8000-000000000001', 'e3300000-0000-4000-8000-000000000101',
        'general', 30000, now() - interval '10 days', 'e3300000-0000-4000-8000-0000000000f1');

-- The existing two-person write-off, as the portal does it.
begin;
set local role authenticated;
select pg_temp.as_user(:tara);
update app.pledges set written_off_by = :tara, write_off_reason = 'Family moved away; agreed with the committee'
 where id in (:'inv_pledge', 'e3300000-0000-4000-8000-0000000000a2');
commit;
begin;
set local role authenticated;
select pg_temp.as_user(:sam);
select app.approve_as_second('pledges', :'inv_pledge');
select app.approve_as_second('pledges', 'e3300000-0000-4000-8000-0000000000a2');
commit;
select pg_temp.assert(not exists (select 1 from app.ledger_postings where txn_type = 'pledge_writeoff' and center_id = :c),
  'write-off: nothing is queued before the write-off is completed');
begin;
set local role authenticated;
select pg_temp.as_user(:tara);
update app.pledges set status = 'written_off', closed_at = now() where id in (:'inv_pledge', 'e3300000-0000-4000-8000-0000000000a2');
commit;
select pg_temp.assert((select status = 'queued' and amount_cents = 50000 and idempotency_key = 'writeoff:' || :'inv_pledge'
                              and period_month = date_trunc('month', current_date)::date and triggered_by = :tara::uuid
                         from app.ledger_postings where source_id = :'inv_pledge' and txn_type = 'pledge_writeoff'),
  'write-off: a pledge from a QuickBooks invoice queues one posting for the written-off balance');
select pg_temp.assert((select status = 'skipped' and last_error like 'Nothing to post: the books are on cash basis and the pledge never was in QuickBooks%'
                         from app.ledger_postings where source_id = 'e3300000-0000-4000-8000-0000000000a2' and txn_type = 'pledge_writeoff'),
  'write-off: a cash-basis pledge that never was in QuickBooks is recorded as skipped, with the reason');
select id as wo_post from app.ledger_postings where source_id = :'inv_pledge' and txn_type = 'pledge_writeoff' \gset
select pg_temp.assert((select d->'doc'->>'entity' = 'CreditMemo' and d->'doc'->>'customer_ref' = '701' and d->'doc'->>'apply_to_invoice' = '7401'
                              and (d->'doc'->'lines'->0->>'amount_cents')::int = 50000 and d->'doc'->'lines'->0->>'item_id' = '23'
                              and d->'doc'->'lines'->0->>'account_id' = '10'
                         from (select app.qbo_posting_doc(:'wo_post') d) x),
  'write-off: it becomes a CreditMemo to the invoice''s customer, through the Pledge write-offs item, applied to invoice 7401');
select pg_temp.assert((select count(*) = 1 from app.jobs where center_id = :c and kind = 'qbo.post' and status = 'queued'),
  'write-off: the poster is asked to run');

-- Claimed once; posted once; never twice.
begin;
set local role connect_worker;
insert into ctx select 'claim1', app.qbo_worker_claim(:c, 25)::text;
commit;
select pg_temp.assert((select jsonb_array_length(v::jsonb->'units') = 1 and v::jsonb->'units'->0->'doc'->>'entity' = 'CreditMemo'
                              and v::jsonb->'units'->0->>'unit_id' = :'wo_post' from ctx where k = 'claim1'),
  'write-off: the poster claims it as one unit, requestid = the posting id');
begin;
set local role connect_worker;
select app.qbo_worker_posting_done(array[:'wo_post']::uuid[], 'CreditMemo', '3001', 1);
insert into ctx select 'claim2', app.qbo_worker_claim(:c, 25)::text;
commit;
select pg_temp.assert((select status = 'posted' and qbo_ref = '3001' and qbo_entity = 'CreditMemo' from app.ledger_postings where id = :'wo_post'),
  'write-off: posted, with the QuickBooks credit memo id');
select pg_temp.assert((select jsonb_array_length(v::jsonb->'units') = 0 from ctx where k = 'claim2'), 'write-off: nothing is claimed a second time');
select pg_temp.assert((select app.enqueue_pledge_writeoff_posting(:'inv_pledge')) is null
                      and (select count(*) = 1 from app.ledger_postings where source_id = :'inv_pledge'),
  'write-off: queuing it again adds nothing (one posting per pledge)');
begin;
set local role authenticated;
select pg_temp.as_user(:tara, false);
select pg_temp.assert((app.pledge_writeoff_postings(array[:'inv_pledge']::uuid[])->:'inv_pledge'->>'qbo_ref') = '3001',
  'write-off: the pledge screen can show what was posted');
rollback;

-- Go-live date and closed months, like every posting.
insert into app.qbo_transactions (center_id, qbo_type, qbo_id, customer_qbo_id, txn_date, doc_number, total_cents, open_balance_cents)
values (:c, 'Invoice', '7402', '701', '2023-01-01', 'INV-7402', 4000, 4000), (:c, 'Invoice', '7403', '701', '2024-01-01', 'INV-7403', 6000, 6000);
insert into app.pledges (id, center_id, household_id, source, amount_cents, pledged_at, crm_external_id, written_off_by, written_off_second_approver,
                         write_off_reason)
values ('e3300000-0000-4000-8000-0000000000a3', :c, 'e3300000-0000-4000-8000-000000000001', 'general', 4000, now() - interval '400 days',
        'qbo:Invoice:7402', :tara, :sam, 'Old promise'),
       ('e3300000-0000-4000-8000-0000000000a4', :c, 'e3300000-0000-4000-8000-000000000001', 'general', 6000, now() - interval '300 days',
        'qbo:Invoice:7403', :tara, :sam, 'Old promise');
-- Written off 90 days ago (before the go-live date, 60 days ago), and in last month, which is closed.
update app.pledges set status = 'written_off', closed_at = now() - interval '90 days' where id = 'e3300000-0000-4000-8000-0000000000a3';
update app.pledges set status = 'written_off', closed_at = date_trunc('month', now()) - interval '10 days' where id = 'e3300000-0000-4000-8000-0000000000a4';
insert into app.accounting_periods (center_id, period_month, status)
values (:c, (date_trunc('month', now()) - interval '1 month')::date, 'closed');
begin;
set local role connect_worker;
select app.qbo_worker_claim(:c, 25);
commit;
select pg_temp.assert((select status = 'skipped' and last_error like '%before the QuickBooks go-live date%'
                         from app.ledger_postings where source_id = 'e3300000-0000-4000-8000-0000000000a3'),
  'write-off: one written off before the go-live date is skipped');
select pg_temp.assert((select status = 'failed' and last_error like '%is closed in Community Connect%'
                         from app.ledger_postings where source_id = 'e3300000-0000-4000-8000-0000000000a4'),
  'write-off: one dated in a closed month waits for the treasurer');

-- Accrual basis: a journal entry from Pledge write-offs to Pledges receivable.
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, source, amount_cents, pledged_at, written_off_by,
                         written_off_second_approver, write_off_reason)
values ('e3300000-0000-4000-8000-0000000000a5', :c, 'e3300000-0000-4000-8000-000000000001', 'e3300000-0000-4000-8000-000000000101',
        'general', 12000, now() - interval '5 days', :tara, :sam, 'Hardship');
update app.integration_connections set settings = settings || '{"basis":"accrual"}' where id = 'e3300000-0000-4000-8000-0000000000d1';
update app.pledges set status = 'written_off', closed_at = now() where id = 'e3300000-0000-4000-8000-0000000000a5';
select id as je_post from app.ledger_postings where source_id = 'e3300000-0000-4000-8000-0000000000a5' \gset
select pg_temp.assert((select d->'doc'->>'entity' = 'JournalEntry'
                              and d->'doc'->'lines'->0->>'posting' = 'Debit' and d->'doc'->'lines'->0->>'account_id' = '10'
                              and d->'doc'->'lines'->1->>'posting' = 'Credit' and d->'doc'->'lines'->1->>'account_id' = '11'
                              and d->'doc'->'lines'->1->>'customer_ref' = '701'
                              and (d->'doc'->'lines'->1->>'amount_cents')::int = 12000
                         from (select app.qbo_posting_doc(:'je_post') d) x),
  'write-off (accrual): a journal entry debits Pledge write-offs and credits Pledges receivable, with the donor');
select pg_temp.assert((select status = 'queued' from app.ledger_postings where id = :'je_post')
                      and app.qbo_post_ready(:c)->>'reason' like 'Accrual-basis posting%',
  'write-off (accrual): it waits in the queue while accrual posting as a whole is not switched on');
delete from app.qbo_account_mappings where center_id = :c and purpose = 'pledge_writeoffs';
select pg_temp.assert((app.qbo_posting_doc(:'je_post')->>'error') like 'The Pledge write-offs account is not mapped%',
  'write-off: without the Pledge write-offs account the entry fails with a plain reason');
update app.integration_connections set settings = settings || '{"basis":"cash"}' where id = 'e3300000-0000-4000-8000-0000000000d1';

-- ═════════════════════════════════════════════════════════════════════════════
-- #24 Pledge history import: opening balances and written-off pledges
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function pg_temp.import_ok(p_run uuid) returns void language plpgsql as $$
declare v jsonb;
begin
  perform app.import_preview(p_run);
  loop
    v := app.import_commit_batch(p_run, 100);
    exit when coalesce((v->>'done')::boolean, true) or coalesce((v->>'remaining')::int, 0) = 0;
  end loop;
end $$;
begin;
set local role authenticated;
select pg_temp.as_user(:tara);
insert into ctx select 'prun', (app.import_create_run(:c, 'pledges', 'csv', 'neon-pledges.csv'))->>'id';
select app.import_stage_rows((select v::uuid from ctx where k = 'prun'), $$[
  {"row_no":1,"source_key":"PL-1","data":{"crm_external_id":"PL-1","household_id":"e3300000-0000-4000-8000-000000000001","amount_cents":100000,
    "source":"general","pledged_at":"2019-08-30"},"extra":{"paid_so_far":60000}},
  {"row_no":2,"source_key":"PL-2","data":{"crm_external_id":"PL-2","household_id":"e3300000-0000-4000-8000-000000000001","amount_cents":50000,
    "source":"general","pledged_at":"2018-01-15","status":"written_off","closed_at":"2021-06-30","written_off_by_name":"R. Mehta (old treasurer)",
    "write_off_reason":"Family moved to India"},"extra":{"paid_so_far":20000}},
  {"row_no":3,"source_key":"PL-3","data":{"crm_external_id":"PL-3","household_id":"e3300000-0000-4000-8000-000000000001","amount_cents":10000,
    "source":"general","pledged_at":"2020-01-01","written_off_by_name":"Nobody"},"extra":{"paid_so_far":10000}}
]$$::jsonb);
select pg_temp.import_ok((select v::uuid from ctx where k = 'prun'));
commit;
select pg_temp.assert((select count(*) = 3 from app.import_rows where run_id = (select v::uuid from ctx where k = 'prun') and status = 'created'),
  '#24 the three pledges import');
select pg_temp.assert((select status = 'written_off' and closed_at::date = '2021-06-30' and paid_cents = 20000
                              and written_off_by_name = 'R. Mehta (old treasurer)' and write_off_reason = 'Family moved to India'
                              and written_off_by is null
                         from app.pledges where center_id = :c and crm_external_id = 'PL-2'),
  '#24 a written-off pledge imports written off, closed, unpaid beyond what was paid, with who/when/why');
select pg_temp.assert(not exists (select 1 from app.ledger_postings l join app.pledges p on p.id = l.source_id where p.crm_external_id = 'PL-2'),
  '#24 an imported write-off is history: nothing is posted to QuickBooks');
select pg_temp.assert((select written_off_by_name is null from app.pledges where center_id = :c and crm_external_id = 'PL-3'),
  '#24 "written off by" is kept only on a written-off pledge');

-- One payment of the imported history paid PL-1 (in 2023): $100 of the $600 paid so far.
begin;
set local role authenticated;
select pg_temp.as_user(:tara);
insert into ctx select 'payrun', (app.import_create_run(:c, 'payments', 'csv', 'neon-payments.csv'))->>'id';
select app.import_stage_rows((select v::uuid from ctx where k = 'payrun'), format($$[
  {"row_no":1,"source_key":"R-1","data":{"crm_external_id":"R-1","household_id":"e3300000-0000-4000-8000-000000000001","amount_cents":10000,
    "method":"check","received_on":"2023-03-01"},"extra":{"allocate_to":"%s"}}
]$$, (select id from app.pledges where center_id = '00000000-0000-4000-8000-0000000000e3' and crm_external_id = 'PL-1'))::jsonb);
select pg_temp.import_ok((select v::uuid from ctx where k = 'payrun'));
commit;
select pg_temp.assert((select paid_cents = 10000 from app.pledges where center_id = :c and crm_external_id = 'PL-1'),
  '#24 after the payment history, PL-1 shows only what that history paid');
begin;
set local role authenticated;
select pg_temp.as_user(:tara);
insert into ctx select 'plan', app.import_opening_balance_plan((select v::uuid from ctx where k = 'prun'))::text;
select pg_temp.assert_raises(format($$select app.import_pledge_opening_balances(%L, ' ')$$, (select v from ctx where k = 'prun')), 'Say why',
  '#24 bringing in opening balances needs a reason');
insert into ctx select 'ob', app.import_pledge_opening_balances((select v::uuid from ctx where k = 'prun'), 'Paid before our 2023 payment history')::text;
insert into ctx select 'ob2', app.import_pledge_opening_balances((select v::uuid from ctx where k = 'prun'), 'Again')::text;
commit;
select pg_temp.assert((select jsonb_array_length(v::jsonb->'rows') = 3 and (v::jsonb->'rows'->0->>'opening_cents')::int = 50000 from ctx where k = 'plan'),
  '#24 the plan: PL-1 $500 before the history, the written-off PL-2 $200 paid before its write-off, PL-3 $100 with no history');
select pg_temp.assert((select (v::jsonb->>'added')::int = 3 and (v::jsonb->>'total_cents')::int = 80000 from ctx where k = 'ob')
                      and (select (v::jsonb->>'added')::int = 0 and (v::jsonb->>'already')::int = 3 from ctx where k = 'ob2'),
  '#24 one opening-balance line per pledge; running it again adds nothing');
select pg_temp.assert((select p.is_opening_balance and p.is_historical and p.amount_cents = 50000 and p.received_on = '2023-02-28'
                              and p.memo like 'Opening balance: paid on pledge PL-1 before the imported payment history%'
                         from app.payments p join app.payment_allocations a on a.payment_id = p.id
                         join app.pledges pl on pl.id = a.pledge_id where pl.crm_external_id = 'PL-1' and p.is_opening_balance),
  '#24 PL-1''s opening line: $500, historical, dated the day before its first imported payment');
select pg_temp.assert((select paid_cents = 60000 and status = 'partially_paid' from app.pledges where center_id = :c and crm_external_id = 'PL-1'),
  '#24 PL-1 now shows the $600 paid so far, $400 open');
select pg_temp.assert((select status = 'written_off' and paid_cents = 20000 from app.pledges where center_id = :c and crm_external_id = 'PL-2'),
  '#24 the written-off pledge keeps its $200 paid and stays written off');
select pg_temp.assert(not exists (select 1 from app.ledger_postings l join app.payments p on p.id = l.source_id where p.is_opening_balance),
  '#24 opening-balance lines are history: never posted to QuickBooks');
select pg_temp.assert((select bool_and(client_app = 'import' and reason like 'Opening balances · Import #%Paid before our 2023 payment history')
                         from app.audit_log where action = 'payments.insert' and after->>'is_opening_balance' = 'true'),
  '#24 the opening lines are audited as an import, with the reason');
begin;
set local role authenticated;
select pg_temp.as_user(:tara);
select pg_temp.assert(((app.import_reconcile((select v::uuid from ctx where k = 'prun')))->>'ok')::boolean,
  '#24 the pledges import reconciles: paid so far matches the file');
commit;

-- An open pledge already here cannot be written off by an import.
begin;
set local role authenticated;
select pg_temp.as_user(:tara);
insert into ctx select 'prun2', (app.import_create_run(:c, 'pledges', 'csv', 'neon-pledges-2.csv'))->>'id';
select app.import_stage_rows((select v::uuid from ctx where k = 'prun2'), $$[
  {"row_no":1,"source_key":"PL-1","data":{"crm_external_id":"PL-1","household_id":"e3300000-0000-4000-8000-000000000001","amount_cents":100000,
    "source":"general","status":"written_off"},"extra":{"paid_so_far":60000}}
]$$::jsonb);
select pg_temp.import_ok((select v::uuid from ctx where k = 'prun2'));
commit;
select pg_temp.assert((select status = 'failed' and message like '%An import cannot write it off%' from app.import_rows
                        where run_id = (select v::uuid from ctx where k = 'prun2')),
  '#24 an open pledge already in Community Connect is not written off by an import (two people do that)');
select pg_temp.assert((select status = 'partially_paid' from app.pledges where center_id = :c and crm_external_id = 'PL-1'), '#24 ...and it stays open');

-- ═════════════════════════════════════════════════════════════════════════════
-- #10 The live test post is explained before it runs
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert((select help like '%four real $1.00 entries%void%More › Void%' from app.setup_steps where key = 'svc.quickbooks'),
  '#10 the Setup checklist explains the four real $1.00 entries and how to void them');
begin;
set local role authenticated;
select pg_temp.as_user(:tara);
select pg_temp.assert_raises($$select app.request_qbo_test_post('00000000-0000-4000-8000-0000000000e3', false, 'Checking the mapping')$$,
  'four real $1.00 entries', '#10 the database asks for the confirmation with the same explanation');
rollback;
