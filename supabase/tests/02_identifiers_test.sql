-- Identifier registry, numbering and bank-statement reconciliation.
-- Runs after rls_test.sql (same database, its fixtures exist).
\set ON_ERROR_STOP 1

create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;

\set jsh '''00000000-0000-4000-8000-000000000001'''

-- ------------------------------------------------------------ numbering
select pg_temp.assert((select member_number from app.people where id = '30000000-0000-4000-8000-000000000001') ~ '^JSH-\d{5}$',
                      'every person gets a Connect member number like JSH-10001');
select pg_temp.assert((select household_number from app.households where id = '20000000-0000-4000-8000-000000000001') ~ '^JSH-H-\d{4}$',
                      'every household gets a Connect household number like JSH-H-2001');
select pg_temp.assert((select count(distinct member_number) = count(*) from app.people where center_id = :jsh), 'member numbers are unique');
select pg_temp.assert((select pledge_number from app.pledges where id = '60000000-0000-4000-8000-000000000001') ~ '^JSH-PL-\d+$', 'pledges are numbered');
do $$ begin
  update app.people set member_number = 'JSH-99999' where id = '30000000-0000-4000-8000-000000000001';
  raise exception 'FAIL: member number changed';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: member numbers are permanent';
end $$;
insert into app.people (center_id, first_name, last_name, member_number) values (:jsh, 'Legacy', 'Numbered', 'JSH-00042');
select pg_temp.assert(exists (select 1 from app.people where member_number = 'JSH-00042'),
                      'a center can adopt its existing register number as the Connect number');

-- ------------------------------------------------------------ registry
insert into app.external_ids (center_id, person_id, kind, system, value, label, source) values
  (:jsh, '30000000-0000-4000-8000-000000000001', 'org_member', 'jsh_register', 'LM-0417', 'JSH life member no.', 'import'),
  (:jsh, '30000000-0000-4000-8000-000000000001', 'crm', 'neon', '4374', 'Neon contact id', 'import');
insert into app.external_ids (center_id, household_id, kind, system, value, label, source) values
  (:jsh, '20000000-0000-4000-8000-000000000001', 'crm', 'neon', 'ACC-4374', 'Neon account id', 'import'),
  (:jsh, '20000000-0000-4000-8000-000000000001', 'accounting', 'quickbooks', '1187', 'QuickBooks customer', 'sync');
select pg_temp.assert((select household_id from app.external_ids where value = 'LM-0417') = '20000000-0000-4000-8000-000000000001',
                      'a person identifier is linked to their household automatically');
do $$ begin
  insert into app.external_ids (center_id, person_id, kind, system, value)
    values ('00000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000005', 'org_member', 'jsh_register', 'lm 0417');
  raise exception 'FAIL: duplicate org member number accepted';
exception when unique_violation then
  raise notice 'PASS: an org member number points at exactly one person (normalized: "lm 0417" = "LM-0417")';
end $$;
-- Two households may legitimately share a bank payer name.
insert into app.external_ids (center_id, household_id, kind, system, value) values
  (:jsh, '20000000-0000-4000-8000-000000000001', 'bank_payer', 'chase', 'RAHUL SHAH'),
  (:jsh, '20000000-0000-4000-8000-000000000002', 'bank_payer', 'chase', 'Rahul Shah');
select pg_temp.assert((select count(*) from app.external_ids where kind = 'bank_payer' and normalized = 'RAHUL SHAH') = 2,
                      'bank payer names may repeat across households');
delete from app.external_ids where kind = 'bank_payer';

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';  -- treasurer
select pg_temp.assert((select count(*) from app.resolve_identifier('00000000-0000-4000-8000-000000000001', 'lm-0417')) = 1,
                      'staff can find a member by their old register number');
select pg_temp.assert((select system from app.resolve_identifier('00000000-0000-4000-8000-000000000001', '1187')) = 'quickbooks',
                      'staff can find a household by QuickBooks customer id');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';  -- ordinary member
select pg_temp.assert((select count(*) from app.resolve_identifier('00000000-0000-4000-8000-000000000001', 'LM-0417')) = 0,
                      'ordinary members cannot resolve other people''s identifiers');
select pg_temp.assert((select count(*) from app.external_ids) = 0, 'ordinary members see no one else''s identifiers');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';  -- Priya
select pg_temp.assert((select count(*) from app.external_ids) = 1, 'a member sees only their household''s org member number');
commit;

-- ------------------------------------------------------------ bank parsing
select pg_temp.assert((select payer_name from app.parse_bank_description('Zelle Payment From Rahul Shah Jpm99bxk2q1v')) = 'Rahul Shah',
                      'parses Chase Zelle line');
select pg_temp.assert((select reference from app.parse_bank_description('Zelle Payment From Rahul Shah Jpm99bxk2q1v')) = 'Jpm99bxk2q1v',
                      'captures the Zelle confirmation');
select pg_temp.assert((select payer_name from app.parse_bank_description('ZELLE FROM PRIYA S SHAH ON 09/14 REF # PP0ABC123')) = 'PRIYA S SHAH',
                      'parses Zelle line with ON date and REF');
select pg_temp.assert((select channel from app.parse_bank_description('DEPOSITED CHECK # 1043')) = 'check', 'parses check deposit');
select pg_temp.assert((select channel from app.parse_bank_description('STRIPE TRANSFER ST-X1Y2')) = 'card_payout', 'recognizes card payouts');

-- ------------------------------------------------------------ reconciliation
insert into app.bank_accounts (id, center_id, name, institution, last4)
  values ('a0000000-0000-4000-8000-000000000001', :jsh, 'Chase operating', 'Chase', '4608');
insert into app.pledges (id, center_id, household_id, source, amount_cents, pledged_at)
  values ('60000000-0000-4000-8000-000000000009', :jsh, '20000000-0000-4000-8000-000000000002', 'general', 25100, now() - interval '3 days');
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description) values
  ('b0000000-0000-4000-8000-000000000001', :jsh, 'a0000000-0000-4000-8000-000000000001', current_date, 25100, 'Zelle Payment From Kiran Mehta Jpm11aaa22bb'),
  ('b0000000-0000-4000-8000-000000000002', :jsh, 'a0000000-0000-4000-8000-000000000001', current_date, 5000,  'Zelle Payment From K M MEHTA Jpm33ccc44dd');
do $$ begin
  insert into app.bank_transactions (center_id, bank_account_id, posted_on, amount_cents, description)
    values ('00000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', current_date, 25100, 'Zelle Payment From Kiran Mehta Jpm11aaa22bb');
  raise exception 'FAIL: re-imported line accepted';
exception when unique_violation then raise notice 'PASS: re-importing the same statement line is ignored';
end $$;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';  -- treasurer
select pg_temp.assert((select household_name from app.suggest_bank_matches('b0000000-0000-4000-8000-000000000001') limit 1) = 'Mehta family',
                      'first Zelle from Kiran Mehta is suggested by member name');
select pg_temp.assert((select score from app.suggest_bank_matches('b0000000-0000-4000-8000-000000000001') limit 1) > 0.7,
                      'exact open-pledge amount raises confidence');
select pg_temp.assert((select count(*) from app.suggest_bank_matches('b0000000-0000-4000-8000-000000000002')) = 0,
                      'unfamiliar payer name "K M MEHTA" has no suggestion yet');
select app.confirm_bank_match('b0000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002');
select pg_temp.assert((select status from app.pledges where id = '60000000-0000-4000-8000-000000000009') = 'paid', 'Zelle payment closes the open pledge');
select app.confirm_bank_match('b0000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002');
commit;

select pg_temp.assert((select count(*) from app.external_ids where kind = 'bank_payer' and household_id = '20000000-0000-4000-8000-000000000002') = 2,
                      'both payer spellings are learned for the Mehta household');
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description) values
  ('b0000000-0000-4000-8000-000000000003', :jsh, 'a0000000-0000-4000-8000-000000000001', current_date, 1100, 'ZELLE FROM K M MEHTA ON 09/30 REF # PP0XYZ999');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';
select pg_temp.assert((select reason from app.suggest_bank_matches('b0000000-0000-4000-8000-000000000003') limit 1) like 'Known bank payer name%',
                      'next month the learned payer name matches automatically');
commit;
select pg_temp.assert((select count(*) from app.ledger_postings where source_table = 'payments'
                         and source_id in (select payment_id from app.bank_transactions where status = 'matched')) = 2,
                      'each matched bank line is queued once for QuickBooks');

\echo 'PASS: identifier and bank reconciliation tests'
