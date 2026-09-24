-- Chase statement formats, batch deposits, DAF / payout lines, JSH member IDs.
-- Runs after 01 and 02 (same database, their fixtures exist).
\set ON_ERROR_STOP 1

create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;

\set jsh '''00000000-0000-4000-8000-000000000001'''

-- ------------------------------------------------------------ parsing (Chase CSV "Description" + "Type")
select pg_temp.assert((select payer_name || '|' || reference from app.parse_bank_description('Zelle Payment From Rahul Shah Bacw8k3x9p2q', '[]', 'QUICKPAY_CREDIT'))
                      = 'Rahul Shah|Bacw8k3x9p2q', 'Chase Zelle from a Bank of America sender');
select pg_temp.assert((select payer_name from app.parse_bank_description('Zelle Payment From NEHA P MEHTA Wfct0h7k2m1q', '[]', 'QUICKPAY_CREDIT'))
                      = 'NEHA P MEHTA', 'Chase Zelle from a Wells Fargo sender');
select pg_temp.assert((select payer_name || '|' || reference from app.parse_bank_description('Zelle Payment From Rahul Shah Jpm55qq66rr8 household 212', '[]', 'QUICKPAY_CREDIT'))
                      = 'Rahul Shah|Jpm55qq66rr8', 'a memo after the confirmation is not part of the payer name');
select pg_temp.assert((select payer_name from app.parse_bank_description('Zelle Payment From Anand Parikh', '[]', 'QUICKPAY_CREDIT'))
                      = 'Anand Parikh', 'Chase Zelle without a confirmation token');
select pg_temp.assert((select payer_name || '|' || channel from app.parse_bank_description(
    'ORIG CO NAME:FIDELITY CHARITABLE ORIG ID:1234567890 DESC DATE:260915 CO ENTRY DESCR:GRANT SEC:CCD TRACE#:021000021234567 EED:260915 IND ID:0000 IND NAME:JAIN SOCIETY OF HOUSTON', '[]', 'ACH_CREDIT'))
                      = 'FIDELITY CHARITABLE|ach', 'Chase ACH originator name is parsed');
select pg_temp.assert((select is_batch from app.parse_bank_description('REMOTE ONLINE DEPOSIT #          1', '[]', 'CHECK_DEPOSIT')),
                      'Chase remote online deposit is a batch');
select pg_temp.assert((select is_batch from app.parse_bank_description('DEPOSIT  ID NUMBER 804512', '[]', 'DEPOSIT')),
                      'Chase branch deposit is a batch');
select pg_temp.assert((select channel from app.parse_bank_description('ZELLE FROM PRIYA S SHAH ON 09/14 REF # PP0ABC123')) = 'zelle'
                      and (select payer_name from app.parse_bank_description('ZELLE FROM PRIYA S SHAH ON 09/14 REF # PP0ABC123')) = 'PRIYA S SHAH',
                      'other-bank Zelle format still parses');

-- ------------------------------------------------------------ fixtures
insert into app.bank_accounts (id, center_id, name, institution, last4, statement_format)
  values ('a0000000-0000-4000-8000-000000000002', :jsh, 'Chase operating', 'Chase', '0000', 'chase_csv');

-- Two checks recorded by a finance volunteer on Sunday, deposited Monday as one Chase line.
insert into app.payments (id, center_id, household_id, amount_cents, method, provider, status, check_number, envelope_number, received_on) values
  ('c0000000-0000-4000-8000-000000000001', :jsh, '20000000-0000-4000-8000-000000000001', 10100, 'check', 'offline', 'captured', '2217', 'E-12', current_date - 1),
  ('c0000000-0000-4000-8000-000000000002', :jsh, '20000000-0000-4000-8000-000000000002', 25100, 'check', 'offline', 'captured', '5530', 'E-13', current_date - 1);
select pg_temp.assert((select count(*) from app.ledger_postings where source_id in ('c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002')
                         and txn_type = 'offline_receipt') = 2, 'recorded checks queue as offline receipts (undeposited funds)');

insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description, bank_type, bank_details, check_or_slip, raw) values
  ('d0000000-0000-4000-8000-000000000001', :jsh, 'a0000000-0000-4000-8000-000000000002', current_date, 35200,
   'REMOTE ONLINE DEPOSIT #          1', 'CHECK_DEPOSIT', 'DSLIP', '', '{"Details":"DSLIP"}'),
  ('d0000000-0000-4000-8000-000000000002', :jsh, 'a0000000-0000-4000-8000-000000000002', current_date, 50000,
   'ORIG CO NAME:FIDELITY CHARITABLE ORIG ID:1234567890 DESC DATE:260915 CO ENTRY DESCR:GRANT SEC:CCD TRACE#:021000021234567', 'ACH_CREDIT', 'CREDIT', '', null),
  ('d0000000-0000-4000-8000-000000000003', :jsh, 'a0000000-0000-4000-8000-000000000002', current_date, 128433,
   'ORIG CO NAME:STRIPE ORIG ID:1800948598 DESC DATE:260915 CO ENTRY DESCR:TRANSFER SEC:CCD TRACE#:091000019999999', 'ACH_CREDIT', 'CREDIT', '', null),
  ('d0000000-0000-4000-8000-000000000004', :jsh, 'a0000000-0000-4000-8000-000000000002', current_date, 10800,
   'Zelle Payment From Priya Shah Jpm77zz88yy1 member 417', 'QUICKPAY_CREDIT', 'CREDIT', '', null);

select pg_temp.assert((select is_batch_deposit from app.bank_transactions where id = 'd0000000-0000-4000-8000-000000000001'), 'deposit line flagged as batch');
select pg_temp.assert((select originator_kind from app.bank_transactions where id = 'd0000000-0000-4000-8000-000000000002') = 'daf', 'Fidelity Charitable recognized as a donor-advised fund');
select pg_temp.assert((select status from app.bank_transactions where id = 'd0000000-0000-4000-8000-000000000003') = 'payout', 'Stripe transfer is a payout, not a gift');

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';  -- treasurer
select pg_temp.assert((select count(*) from app.suggest_bank_matches('d0000000-0000-4000-8000-000000000001')) = 0,
                      'no household suggestions for a batch deposit');
select pg_temp.assert((select bool_and(exact_total) and count(*) = 2 from app.suggest_deposit_payments('d0000000-0000-4000-8000-000000000001')),
                      'deposit candidates are the two recorded checks and they total exactly');
do $$ begin
  perform app.match_deposit('d0000000-0000-4000-8000-000000000001', array['c0000000-0000-4000-8000-000000000001']::uuid[]);
  raise exception 'FAIL: partial deposit accepted';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: a deposit only matches when the payments add up to it';
end $$;
select pg_temp.assert(app.match_deposit('d0000000-0000-4000-8000-000000000001',
                      array['c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002']::uuid[]) = 2,
                      'deposit matched to its two checks');
do $$ begin
  perform app.confirm_bank_match('d0000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001');
  raise exception 'FAIL: payout matched to a household';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: a processor payout cannot be recorded as a household gift';
end $$;
select pg_temp.assert((select reason from app.suggest_bank_matches('d0000000-0000-4000-8000-000000000004') limit 1) like '%member ID 0417%',
                      'a JSH member ID in the Zelle memo ("member 417") points to the household');
select app.confirm_bank_match('d0000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001');
commit;

select pg_temp.assert((select count(*) from app.ledger_postings where idempotency_key = 'deposit:d0000000-0000-4000-8000-000000000001') = 1,
                      'the deposit posts once to QuickBooks as a Deposit');
select pg_temp.assert((select method from app.payments where deposit_bank_transaction_id = 'd0000000-0000-4000-8000-000000000002') = 'daf',
                      'a DAF grant is recorded with method daf');
select pg_temp.assert(not exists (select 1 from app.external_ids where kind = 'bank_payer' and normalized = 'FIDELITY CHARITABLE'),
                      'a DAF name is never learned as the family''s payer name');
select pg_temp.assert((select txn_type from app.ledger_postings where source_id =
                        (select id from app.payments where deposit_bank_transaction_id = 'd0000000-0000-4000-8000-000000000002')) = 'bank_receipt',
                      'money that landed in the bank posts as a bank receipt');

\echo 'PASS: Chase and JSH member ID tests'
