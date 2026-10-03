-- 0582–0583 (payments plan PR 3): members report a Zelle; the treasurer matches it to the bank
-- statement. A report credits nobody until a bank line is matched; the double-count guard (G6);
-- the bulk "confirm every exact match"; the hourly sweep; rehearsal in a sandbox; RLS.
-- Everything runs in its own community (Z67).
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
create or replace function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{"x-client-app":"portal"}', true);
end $$;
grant connect_worker to postgres;
create temp table ctx (k text primary key, v text);
grant all on ctx to public;
create or replace function pg_temp.v(p_k text) returns text language sql as $$ select v from ctx where k = p_k $$;

\set c '''67000000-0000-4000-8000-0000000000c1'''
\set rahul '''67000000-0000-4000-8000-0000000000a1'''
\set mira '''67000000-0000-4000-8000-0000000000a2'''
\set kavi '''67000000-0000-4000-8000-0000000000a3'''
\set kiran '''67000000-0000-4000-8000-0000000000a4'''
\set tara '''67000000-0000-4000-8000-0000000000a5'''
\set vina '''67000000-0000-4000-8000-0000000000a6'''
\set esha '''67000000-0000-4000-8000-0000000000a7'''
\set h1 '''67000000-0000-4000-8000-000000000201'''
\set h2 '''67000000-0000-4000-8000-000000000202'''
\set pl1 '''67000000-0000-4000-8000-000000000301'''
\set pl2 '''67000000-0000-4000-8000-000000000302'''
\set pl3 '''67000000-0000-4000-8000-000000000303'''
\set pl4 '''67000000-0000-4000-8000-000000000304'''
\set ba '''67000000-0000-4000-8000-000000000401'''

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into app.centers (id, slug, name, short_name, time_zone) values (:c, 'z67-temple', 'Z67 Jain Temple', 'Z67', 'America/Chicago');
insert into auth.users (id, email) values
  (:rahul, 'rahul@z67.test'), (:mira, 'mira@z67.test'), (:kavi, 'kavi@z67.test'), (:kiran, 'kiran@z67.test'),
  (:tara, 'tara@z67.test'), (:vina, 'vina@z67.test'), (:esha, 'esha@z67.test');
insert into app.people (id, center_id, first_name, last_name, email, date_of_birth) values
  ('67000000-0000-4000-8000-000000000101', :c, 'Rahul', 'Shah', 'rahul@z67.test', '1980-04-02'),
  ('67000000-0000-4000-8000-000000000102', :c, 'Mira', 'Shah', 'mira@z67.test', '1982-06-11'),
  ('67000000-0000-4000-8000-000000000103', :c, 'Kavi', 'Shah', null, current_date - interval '14 years'),
  ('67000000-0000-4000-8000-000000000104', :c, 'Kiran', 'Mehta', 'kiran@z67.test', '1970-01-01'),
  ('67000000-0000-4000-8000-000000000105', :c, 'Tara', 'Treasurer', 'tara@z67.test', '1975-01-01'),
  ('67000000-0000-4000-8000-000000000106', :c, 'Vina', 'Volunteer', 'vina@z67.test', '1990-01-01'),
  ('67000000-0000-4000-8000-000000000107', :c, 'Esha', 'Board', 'esha@z67.test', '1968-01-01');
insert into app.households (id, center_id, display_name) values (:h1, :c, 'Shah family'), (:h2, :c, 'Mehta family');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, '67000000-0000-4000-8000-000000000101', :c, 'primary', true),
  (:h1, '67000000-0000-4000-8000-000000000102', :c, 'spouse', false),
  (:h1, '67000000-0000-4000-8000-000000000103', :c, 'child', false),
  (:h2, '67000000-0000-4000-8000-000000000104', :c, 'primary', true);
insert into app.center_users (center_id, user_id, person_id, is_default) values
  (:c, :rahul, '67000000-0000-4000-8000-000000000101', false), (:c, :mira, '67000000-0000-4000-8000-000000000102', false),
  (:c, :kavi, '67000000-0000-4000-8000-000000000103', false), (:c, :kiran, '67000000-0000-4000-8000-000000000104', false),
  (:c, :tara, '67000000-0000-4000-8000-000000000105', false), (:c, :vina, '67000000-0000-4000-8000-000000000106', false),
  (:c, :esha, '67000000-0000-4000-8000-000000000107', false);
insert into app.role_grants (center_id, user_id, role_key) values
  (:c, :tara, 'treasurer'), (:c, :vina, 'finance_volunteer'), (:c, :esha, 'executive_committee');
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, source, amount_cents, pledged_at, status) values
  (:pl1, :c, :h1, '67000000-0000-4000-8000-000000000101', 'general', 25100, now() - interval '30 days', 'open'),
  (:pl2, :c, :h1, '67000000-0000-4000-8000-000000000101', 'general', 10800, now() - interval '10 days', 'open'),
  (:pl3, :c, :h1, '67000000-0000-4000-8000-000000000101', 'general', 5000, now() - interval '40 days', 'cancelled'),
  (:pl4, :c, :h2, '67000000-0000-4000-8000-000000000104', 'general', 5000, now() - interval '20 days', 'open');
insert into app.bank_accounts (id, center_id, name, institution, last4, statement_format) values (:ba, :c, 'Chase operating', 'Chase', '6767', 'chase_csv');
insert into app.center_payment_methods (center_id, method, accepted, instructions, sort) values
  (:c, 'zelle', false, '{"recipient":"give@z67.test","name":"Z67 Jain Temple","memo_hint":"Your member number"}', 3);
select (now() at time zone 'America/Chicago')::date as today \gset
insert into ctx values ('today', :'today');

-- A Zelle of the Mehtas already on the statement and matched (its confirmation cannot be reported again).
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description, bank_type) values
  ('67000000-0000-4000-8000-000000000500', :c, :ba, :'today'::date - 5, 1500, 'Zelle Payment From Kiran Mehta Wfct0h7k2m1q', 'QUICKPAY_CREDIT');
begin;
set local role authenticated;
select pg_temp.as_user(:tara);
select app.confirm_bank_match('67000000-0000-4000-8000-000000000500', :h2);
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- Reporting a Zelle: who may, and the plain-English refusals
-- ═════════════════════════════════════════════════════════════════════════════
begin;
set local role authenticated;
select pg_temp.as_user(:rahul);
select pg_temp.assert_raises($$select app.report_payment('67000000-0000-4000-8000-0000000000c1', '67000000-0000-4000-8000-000000000201', 'zelle', 25100, current_date - 2, null, null, null, null)$$,
  'Zelle is not one of the ways Z67 takes gifts.', 'Zelle not accepted: the report is refused');
rollback;
update app.center_payment_methods set accepted = true where center_id = :c and method = 'zelle';

begin;
set local role authenticated;
select pg_temp.as_user(:kavi);
select pg_temp.assert_state($$select app.report_payment('67000000-0000-4000-8000-0000000000c1', '67000000-0000-4000-8000-000000000201', 'zelle', 25100, current_date - 2, null, null, null, null)$$,
  '42501', 'a child of the family is refused (42501)');
select pg_temp.assert_raises($$select app.report_payment('67000000-0000-4000-8000-0000000000c1', '67000000-0000-4000-8000-000000000201', 'zelle', 25100, current_date - 2, null, null, null, null)$$,
  'Only an adult of the family can report a payment.', 'a child is told only an adult can report');
select pg_temp.as_user(:kiran);
select pg_temp.assert_raises($$select app.report_payment('67000000-0000-4000-8000-0000000000c1', '67000000-0000-4000-8000-000000000201', 'zelle', 25100, current_date - 2, null, null, null, null)$$,
  'Only an adult of the family can report a payment.', 'an adult of another household is refused');
select pg_temp.as_user(:rahul);
select pg_temp.assert_raises($$select app.report_payment('67000000-0000-4000-8000-0000000000c1', '67000000-0000-4000-8000-000000000201', 'check', 25100, current_date - 2, null, null, null, null)$$,
  'Only a Zelle can be reported', 'only Zelle can be reported');
select pg_temp.assert_raises($$select app.report_payment('67000000-0000-4000-8000-0000000000c1', '67000000-0000-4000-8000-000000000201', 'zelle', 0, current_date - 2, null, null, null, null)$$,
  'Enter the amount you sent', 'the amount must be at least one cent');
select pg_temp.assert_raises(format($$select app.report_payment('67000000-0000-4000-8000-0000000000c1', '67000000-0000-4000-8000-000000000201', 'zelle', 25100, %L::date + 1, null, null, null, null)$$, :'today'),
  'cannot be after today', 'a date in the future is refused');
select pg_temp.assert_raises(format($$select app.report_payment('67000000-0000-4000-8000-0000000000c1', '67000000-0000-4000-8000-000000000201', 'zelle', 25100, %L::date - 61, null, null, null, null)$$, :'today'),
  'Report a Zelle you sent in the last 60 days. For an older one, contact the treasurer.', 'a 61-day-old Zelle is refused');
select pg_temp.assert_raises($$select app.report_payment('67000000-0000-4000-8000-0000000000c1', '67000000-0000-4000-8000-000000000201', 'zelle', 25100, current_date - 2, 'abc', null, null, null)$$,
  'That does not look like a Zelle confirmation number. Leave it blank if you do not have it.', 'a confirmation number that is too short is refused');
select pg_temp.assert_raises($$select app.report_payment('67000000-0000-4000-8000-0000000000c1', '67000000-0000-4000-8000-000000000201', 'zelle', 25100, current_date - 2, null, null, array['67000000-0000-4000-8000-000000000303']::uuid[], null)$$,
  'One of the pledges is not an open pledge of this family.', 'a cancelled pledge cannot be named');
select pg_temp.assert_raises($$select app.report_payment('67000000-0000-4000-8000-0000000000c1', '67000000-0000-4000-8000-000000000201', 'zelle', 25100, current_date - 2, null, null, array['67000000-0000-4000-8000-000000000304']::uuid[], null)$$,
  'One of the pledges is not an open pledge of this family.', 'another family''s pledge cannot be named');
select pg_temp.assert_raises($$select app.report_payment('67000000-0000-4000-8000-0000000000c1', '67000000-0000-4000-8000-000000000201', 'zelle', 25100, current_date - 2, 'WFCT0H7K2M1Q', null, null, null)$$,
  'That Zelle is already on the bank statement and recorded.', 'a confirmation already on a matched bank line is refused');
-- The 60-day edge is allowed.
select (app.report_payment(:c, :h1, 'zelle', 4242, :'today'::date - 60, null, null, null, null))->>'report_id' as r_edge \gset
select pg_temp.assert(:'r_edge' is not null, 'a Zelle sent exactly 60 days ago can be reported');
select app.withdraw_payment_report(:'r_edge', null);
commit;

-- What the treasurer and the family see before the report (nothing may change).
insert into ctx
select 'before_db', concat_ws('|',
  (select string_agg(id::text || ':' || paid_cents || ':' || status, ',' order by id) from app.pledges where household_id = :h1),
  (select count(*) from app.payments where household_id = :h1),
  (select count(*) from app.payment_allocations a join app.payments p on p.id = a.payment_id where p.household_id = :h1),
  (select count(*) from app.ledger_postings where center_id = :c));
begin;
set local role authenticated;
select pg_temp.as_user(:rahul);
insert into ctx select 'before_member', concat_ws('|', app.year_end_statement(:h1, extract(year from :'today'::date)::int)::text,
  app.household_credit(:h1), (select open_pledge_cents from app.household_card(:h1)));
commit;

-- The good report.
begin;
set local role authenticated;
select pg_temp.as_user(:rahul);
select app.report_payment(:c, :h1, 'zelle', 25100, :'today'::date - 2, 'jpm-99bxk-2q1v', 'Rahul Shah', array[:pl1]::uuid[], 'For the Paryushan pledge') as rep1 \gset
select pg_temp.assert((:'rep1'::jsonb->>'status') = 'reported' and not (:'rep1'::jsonb->>'is_test')::boolean
                      and (:'rep1'::jsonb->>'due_on') = (:'today'::date - 2 + 10)::text
                      and (:'rep1'::jsonb->>'message') = 'Thank you. The treasurer matches it when it reaches the bank, usually within a few days. Until then it shows as Reported and is not counted as given.',
  'an adult reports a Zelle: reported, not a test, due 10 days after it was sent, the plain thank-you');
select (:'rep1'::jsonb)->>'report_id' as r1 \gset
select pg_temp.assert((select confirmation_normalized = 'JPM99BXK2Q1V' and sender_normalized = 'RAHUL SHAH' and window_days = 10
                              and pledge_ids = array['67000000-0000-4000-8000-000000000301']::uuid[]
                              and reported_by_person = '67000000-0000-4000-8000-000000000101'
                         from app.payment_reports where id = :'r1'),
  'the confirmation number and the sender name are kept normalized; the pledge and the reporter are recorded');
select pg_temp.as_user(:mira);
select pg_temp.assert_raises($$select app.report_payment('67000000-0000-4000-8000-0000000000c1', '67000000-0000-4000-8000-000000000201', 'zelle', 25100, current_date - 3, 'JPM99BXK2Q1V', null, null, null)$$,
  'That confirmation number was already reported.', 'the same confirmation number cannot be reported twice');
select pg_temp.assert_raises(format($$select app.report_payment('67000000-0000-4000-8000-0000000000c1', '67000000-0000-4000-8000-000000000201', 'zelle', 25100, %L::date - 2, null, null, null, null)$$, :'today'),
  'You already reported this Zelle; it is waiting for the bank.', 'the same family, amount and date cannot be reported twice');
-- Withdraw, then report again with the same confirmation.
select (app.report_payment(:c, :h1, 'zelle', 999, :'today'::date - 1, 'BAC12345678X', null, null, null))->>'report_id' as r0 \gset
select app.withdraw_payment_report(:'r0', 'Typed the wrong amount');
select (app.report_payment(:c, :h1, 'zelle', 990, :'today'::date - 1, 'BAC12345678X', null, null, null))->>'report_id' as r0b \gset
select pg_temp.assert(:'r0b' is not null and (select status from app.payment_reports where id = :'r0') = 'withdrawn',
  'a withdrawn report frees its confirmation number for a new report');
select app.withdraw_payment_report(:'r0b', null);
commit;

-- A family may have at most 10 reports waiting.
begin;
set local role authenticated;
select pg_temp.as_user(:kiran);
do $$ begin
  for i in 1..10 loop
    perform app.report_payment('67000000-0000-4000-8000-0000000000c1', '67000000-0000-4000-8000-000000000202', 'zelle', 100 + i, current_date - 1, null, null, null, null);
  end loop;
end $$;
select pg_temp.assert_raises($$select app.report_payment('67000000-0000-4000-8000-0000000000c1', '67000000-0000-4000-8000-000000000202', 'zelle', 111, current_date - 1, null, null, null, null)$$,
  'already has 10 Zelle reports waiting for the bank', 'the 11th open report of a family is refused');
do $$ begin
  perform app.withdraw_payment_report(r.id, 'clean up') from app.payment_reports r
   where r.household_id = '67000000-0000-4000-8000-000000000202' and r.status = 'reported';
end $$;
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- A report changes nothing
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert(pg_temp.v('before_db') = concat_ws('|',
  (select string_agg(id::text || ':' || paid_cents || ':' || status, ',' order by id) from app.pledges where household_id = :h1),
  (select count(*) from app.payments where household_id = :h1),
  (select count(*) from app.payment_allocations a join app.payments p on p.id = a.payment_id where p.household_id = :h1),
  (select count(*) from app.ledger_postings where center_id = :c)),
  'a report creates no payment, allocation or QuickBooks posting, and pledge balances are unchanged');
begin;
set local role authenticated;
select pg_temp.as_user(:rahul);
select pg_temp.assert(pg_temp.v('before_member') = concat_ws('|', app.year_end_statement(:h1, extract(year from :'today'::date)::int)::text,
  app.household_credit(:h1), (select open_pledge_cents from app.household_card(:h1))),
  'the year-end statement, the household credit and the open balance are the same as before the report');
select pg_temp.assert((select jsonb_array_length(app.my_payment_reports(:c, :h1))) >= 1
                      and (select x->>'status' = 'reported' and x->>'receipt_number' is null and (x->>'amount_cents')::bigint = 25100
                             from jsonb_array_elements(app.my_payment_reports(:c, null)) x where x->>'id' = :'r1'),
  'the family sees its report as reported, with no receipt');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- The Chase line arrives: suggestion, confirm with the report
-- ═════════════════════════════════════════════════════════════════════════════
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description, bank_type) values
  ('67000000-0000-4000-8000-000000000501', :c, :ba, :'today'::date - 1, 25100, 'Zelle Payment From Rahul Shah Jpm99bxk2q1v', 'QUICKPAY_CREDIT');
select pg_temp.assert((select channel = 'zelle' and reference = 'Jpm99bxk2q1v' and payer_name = 'Rahul Shah'
                         from app.bank_transactions where id = '67000000-0000-4000-8000-000000000501'),
  'the Chase Zelle line is parsed to its payer name and confirmation number');
begin;
set local role authenticated;
select pg_temp.as_user(:tara);
select pg_temp.assert((select household_id = :h1 and score >= 0.99 and report_id = :'r1' and reason like '%Member reported this Zelle (confirmation jpm-99bxk-2q1v, $251.00 on%'
                         from app.suggest_bank_matches('67000000-0000-4000-8000-000000000501') limit 1),
  'the reporting household is suggested first at 0.99 or more, with its report');
select app.confirm_bank_match('67000000-0000-4000-8000-000000000501', :h1, null, true, null, :'r1') as p1 \gset
commit;
select pg_temp.assert((select count(*) from app.payments where deposit_bank_transaction_id = '67000000-0000-4000-8000-000000000501') = 1
                      and (select provider = 'bank' and method = 'zelle' and status = 'settled' and amount_cents = 25100
                                  and payer_person_id = '67000000-0000-4000-8000-000000000101'
                             from app.payments where id = :'p1'),
  'one bank Zelle payment is recorded, settled, with the reporter as payer');
select pg_temp.assert((select count(*) = 1 and bool_and(pledge_id = :pl1 and chosen_by_donor and amount_cents = 25100)
                         from app.payment_allocations where payment_id = :'p1')
                      and (select status from app.pledges where id = :pl1) = 'paid',
  'it is applied to the pledge the member named, as chosen by the donor');
select pg_temp.assert((select count(*) from app.ledger_postings where source_id = :'p1') = 1
                      and (select txn_type from app.ledger_postings where source_id = :'p1') = 'bank_receipt',
  'exactly one QuickBooks bank receipt is queued');
select pg_temp.assert(exists (select 1 from app.external_ids where center_id = :c and household_id = :h1 and kind = 'bank_payer' and normalized = 'RAHUL SHAH'),
  'the payer name is learned for the household');
select pg_temp.assert((select status = 'matched' and payment_id = :'p1' and bank_transaction_id = '67000000-0000-4000-8000-000000000501'
                              and matched_by = :tara and matched_at is not null
                         from app.payment_reports where id = :'r1'),
  'the report is matched to the line and the payment');
begin;
set local role authenticated;
select pg_temp.as_user(:tara);
select pg_temp.assert_raises(format($$select app.confirm_bank_match('67000000-0000-4000-8000-000000000501', '67000000-0000-4000-8000-000000000201', null, true, null, %L)$$, :'r1'),
  'bank line already matched', 'a second confirm of the same line is refused');
select pg_temp.as_user(:rahul);
select pg_temp.assert((select x->>'status' = 'matched' and x->>'receipt_number' = (select receipt_number from app.payments where id = :'p1')
                         from jsonb_array_elements(app.my_payment_reports(:c, :h1)) x where x->>'id' = :'r1'),
  'the family now sees the report matched, with its receipt number');
rollback;

-- ═════════════════════════════════════════════════════════════════════════════
-- Automatic link by confirmation number; an amount that differs from the report
-- ═════════════════════════════════════════════════════════════════════════════
begin;
set local role authenticated;
select pg_temp.as_user(:mira);
select (app.report_payment(:c, :h1, 'zelle', 10800, :'today'::date - 3, 'BAC7Q8W9E0R1', 'Mira Shah', null, null))->>'report_id' as r2 \gset
select (app.report_payment(:c, :h1, 'zelle', 5000, :'today'::date - 1, 'JPM5K5K5K5K5', null, null, null))->>'report_id' as r3 \gset
commit;
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description, bank_type) values
  ('67000000-0000-4000-8000-000000000502', :c, :ba, :'today'::date - 2, 10800, 'Zelle Payment From Mira Shah Bac7q8w9e0r1', 'QUICKPAY_CREDIT'),
  ('67000000-0000-4000-8000-000000000503', :c, :ba, :'today'::date, 5100, 'Zelle Payment From Mira Shah Jpm5k5k5k5k5', 'QUICKPAY_CREDIT');
begin;
set local role authenticated;
select pg_temp.as_user(:tara);
select pg_temp.assert_raises(format($$select app.confirm_bank_match('67000000-0000-4000-8000-000000000503', '67000000-0000-4000-8000-000000000201', null, true, null, %L)$$, :'r3'),
  'The report says $50.00 but the bank line is $51.00; confirm without the report, then reject or withdraw it.',
  'a report of another amount cannot be confirmed with the line');
select app.confirm_bank_match('67000000-0000-4000-8000-000000000502', :h1) as p2 \gset
commit;
select pg_temp.assert((select status = 'matched' and payment_id = :'p2' from app.payment_reports where id = :'r2'),
  'without a named report, the family''s one open report with that confirmation number and amount is linked');
select pg_temp.assert((select payer_person_id from app.payments where id = :'p2') = '67000000-0000-4000-8000-000000000102'
                      and (select bool_and(not chosen_by_donor) and min(pledge_id::text) = '67000000-0000-4000-8000-000000000302'
                             from app.payment_allocations where payment_id = :'p2'),
  'a report with no pledges: earliest open pledge first; the payer is the reporter');
select pg_temp.assert((select status from app.payment_reports where id = :'r3') = 'reported'
                      and (select status from app.bank_transactions where id = '67000000-0000-4000-8000-000000000503') = 'unmatched',
  'the refused confirm changed nothing');

-- ═════════════════════════════════════════════════════════════════════════════
-- G6: a Zelle already recorded by hand is not counted twice
-- ═════════════════════════════════════════════════════════════════════════════
begin;
set local role authenticated;
select pg_temp.as_user(:tara);
select app.record_offline_payment(:h2, 7500, 'zelle', :'today'::date - 3) as hp1 \gset
commit;
insert into ctx values ('hp1', :'hp1');
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description, bank_type) values
  ('67000000-0000-4000-8000-000000000504', :c, :ba, :'today'::date - 1, 7500, 'Zelle Payment From Kiran Mehta Jpm4g6g6g6g6', 'QUICKPAY_CREDIT'),
  ('67000000-0000-4000-8000-000000000506', :c, :ba, :'today'::date, 7500, 'Zelle Payment From Kiran Mehta Jpm6h6h6h6h6', 'QUICKPAY_CREDIT');
begin;
set local role authenticated;
select pg_temp.as_user(:tara);
select pg_temp.assert_state($$select app.confirm_bank_match('67000000-0000-4000-8000-000000000504', '67000000-0000-4000-8000-000000000202')$$,
  'CCDUP', 'G6: confirming a Zelle line already recorded by hand raises CCDUP');
do $$
declare v_msg text; v_detail text;
begin
  perform app.confirm_bank_match('67000000-0000-4000-8000-000000000504', '67000000-0000-4000-8000-000000000202');
  raise exception 'FAIL: no CCDUP';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  if v_msg not like 'This family already has a Zelle of $75.00 recorded by hand on % (receipt %). Attach this bank line to that payment so the gift is not counted twice, or say why this is a separate gift.'
     or v_detail <> pg_temp.v('hp1') then
    raise exception 'FAIL: G6 message or detail (got "%" / "%")', v_msg, v_detail;
  end if;
  raise notice 'PASS: G6: the message names the hand-recorded payment and the detail carries its id';
end $$;
select pg_temp.assert(app.possible_duplicate_zelle(:h2, 7500, :'today'::date - 2) @> jsonb_build_array(jsonb_build_object('kind', 'hand_recorded', 'id', :'hp1')),
  'possible_duplicate_zelle lists the hand-recorded Zelle');
-- With a reason it is recorded as a separate gift (rolled back here).
select app.confirm_bank_match('67000000-0000-4000-8000-000000000504', :h2, null, false, null, null, 'Two gifts: Paryushan and the general fund') as p_sep \gset
reset role;
select pg_temp.assert((select count(*) from app.payments where household_id = :h2 and method = 'zelle' and amount_cents = 7500) = 2
                      and exists (select 1 from app.audit_log where record_table = 'payments' and record_id = :'p_sep'
                                    and reason = 'Two gifts: Paryushan and the general fund'),
  'G6: with a reason the line is recorded as a separate gift, and the reason is in the audit log');
rollback;
begin;
set local role authenticated;
select pg_temp.as_user(:tara);
select pg_temp.assert(app.attach_bank_line_to_payment('67000000-0000-4000-8000-000000000504', :'hp1') = :'hp1',
  'G6: the bank line is attached to the hand-recorded payment instead');
commit;
select pg_temp.assert((select deposit_bank_transaction_id = '67000000-0000-4000-8000-000000000504' and status = 'settled' from app.payments where id = :'hp1')
                      and (select status = 'matched' and matched_household_id = :h2 and payment_id = :'hp1'
                             from app.bank_transactions where id = '67000000-0000-4000-8000-000000000504'),
  'attach: the payment is settled and the line is matched to it');
select pg_temp.assert((select count(*) from app.payments where household_id = :h2 and method = 'zelle' and amount_cents = 7500) = 1
                      and (select count(*) from app.ledger_postings where idempotency_key = 'deposit:67000000-0000-4000-8000-000000000504'
                             and txn_type = 'payout_deposit' and source_table = 'bank_transactions') = 1,
  'attach: no second payment; one QuickBooks Deposit (undeposited funds to the bank)');
select pg_temp.assert((select times_matched from app.external_ids where center_id = :c and household_id = :h2 and kind = 'bank_payer' and normalized = 'KIRAN MEHTA') = 2,
  'attach: the payer name is learned (seen a second time)');
begin;
set local role authenticated;
select pg_temp.as_user(:tara);
select pg_temp.assert_raises(format($$select app.attach_bank_line_to_payment('67000000-0000-4000-8000-000000000504', %L)$$, :'hp1'),
  'That bank line is already matched.', 'attaching the same line twice is refused');
select pg_temp.assert_raises(format($$select app.attach_bank_line_to_payment('67000000-0000-4000-8000-000000000506', %L)$$, :'hp1'),
  'That payment is already attached to a bank line.', 'a payment takes one bank line only');
select pg_temp.assert_raises(format($$select app.attach_bank_line_to_payment('67000000-0000-4000-8000-000000000503', %L)$$, :'p1'),
  'Only a payment recorded by hand', 'only hand-recorded payments can be attached');
select pg_temp.as_user(:esha);
select pg_temp.assert_state(format($$select app.attach_bank_line_to_payment('67000000-0000-4000-8000-000000000506', %L)$$, :'hp1'),
  '42501', 'giving.view alone cannot attach a bank line');
commit;
update app.bank_transactions set status = 'ignored' where id = '67000000-0000-4000-8000-000000000506';

-- ═════════════════════════════════════════════════════════════════════════════
-- Exact matches and "Confirm every exact match"
-- ═════════════════════════════════════════════════════════════════════════════
begin;
set local role authenticated;
select pg_temp.as_user(:rahul);
select (app.report_payment(:c, :h1, 'zelle', 5100, :'today'::date - 2, 'JPMEXACT0001', null, null, null))->>'report_id' as r4 \gset
select pg_temp.as_user(:kiran);
select (app.report_payment(:c, :h2, 'zelle', 2600, :'today'::date - 2, 'WFCEXACT0002', null, null, null))->>'report_id' as r5 \gset
select (app.report_payment(:c, :h2, 'zelle', 4100, :'today'::date - 2, 'JPMEXACT0004', null, null, null))->>'report_id' as r7 \gset
select pg_temp.as_user(:mira);
select (app.report_payment(:c, :h1, 'zelle', 3100, :'today'::date - 2, 'BACEXACT0003', null, null, null))->>'report_id' as r6 \gset
commit;
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description, bank_type) values
  ('67000000-0000-4000-8000-000000000507', :c, :ba, :'today'::date - 1, 5100, 'Zelle Payment From Rahul Shah Jpmexact0001', 'QUICKPAY_CREDIT'),
  ('67000000-0000-4000-8000-000000000508', :c, :ba, :'today'::date - 1, 2600, 'Zelle Payment From Kiran Mehta Wfcexact0002', 'QUICKPAY_CREDIT'),
  ('67000000-0000-4000-8000-000000000509', :c, :ba, :'today'::date - 1, 3100, 'Zelle Payment From Mira Shah Bacexact0003', 'QUICKPAY_CREDIT'),
  ('67000000-0000-4000-8000-000000000510', :c, :ba, :'today'::date - 1, 4100, 'Zelle Payment From Kiran Mehta Jpmexact0004', 'QUICKPAY_CREDIT');
begin;
set local role authenticated;
select pg_temp.as_user(:vina);
select app.zelle_exact_matches(:c) as exact \gset
select pg_temp.assert(jsonb_array_length(:'exact'::jsonb) = 4
                      and (select bool_and((x->>'report_id', x->>'bank_transaction_id') in (
                                (:'r4', '67000000-0000-4000-8000-000000000507'), (:'r5', '67000000-0000-4000-8000-000000000508'),
                                (:'r6', '67000000-0000-4000-8000-000000000509'), (:'r7', '67000000-0000-4000-8000-000000000510'))
                                and x #>> '{household,household_id}' is not null)
                             from jsonb_array_elements(:'exact'::jsonb) x),
  'zelle_exact_matches lists exactly the four one-to-one pairs, each with its household card (not the $50 report against the $51 line)');
commit;
-- The Mira pair stops being exact: a second unmatched line with the same reference arrives.
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description, bank_type) values
  ('67000000-0000-4000-8000-000000000511', :c, :ba, :'today'::date, 3100, 'Zelle Payment From Mira Shah Bacexact0003', 'QUICKPAY_CREDIT');
begin;
set local role authenticated;
select pg_temp.as_user(:vina);
select app.confirm_exact_zelle_matches(:c, jsonb_build_array(
  jsonb_build_object('report_id', :'r4', 'bank_transaction_id', '67000000-0000-4000-8000-000000000507'),
  jsonb_build_object('report_id', :'r5', 'bank_transaction_id', '67000000-0000-4000-8000-000000000508'),
  jsonb_build_object('report_id', :'r6', 'bank_transaction_id', '67000000-0000-4000-8000-000000000509'))) as bulk \gset
commit;
select pg_temp.assert(jsonb_array_length(:'bulk'::jsonb->'confirmed') = 2 and jsonb_array_length(:'bulk'::jsonb->'skipped') = 1
                      and (:'bulk'::jsonb #>> '{skipped,0,report_id}') = :'r6'
                      and (select bool_and(x->>'payment_id' is not null and x->>'receipt_number' is not null) from jsonb_array_elements(:'bulk'::jsonb->'confirmed') x),
  'the bulk confirm records the two pairs still exact (with receipts) and skips the one that stopped being exact');
select pg_temp.assert((select status from app.payment_reports where id = :'r4') = 'matched' and (select status from app.payment_reports where id = :'r5') = 'matched'
                      and (select status from app.payment_reports where id = :'r6') = 'reported'
                      and (select status from app.bank_transactions where id = '67000000-0000-4000-8000-000000000509') = 'unmatched',
  'the matched reports are matched; the skipped one is untouched');
select pg_temp.assert((select status from app.payment_reports where id = :'r7') = 'reported'
                      and (select status from app.bank_transactions where id = '67000000-0000-4000-8000-000000000510') = 'unmatched'
                      and (select count(*) from app.payments where deposit_bank_transaction_id = '67000000-0000-4000-8000-000000000510') = 0,
  'a pair the treasurer did not send is never confirmed');
begin;
set local role authenticated;
select pg_temp.as_user(:esha);
select pg_temp.assert_state(format($$select app.confirm_exact_zelle_matches('67000000-0000-4000-8000-0000000000c1', jsonb_build_array(jsonb_build_object('report_id', %L, 'bank_transaction_id', '67000000-0000-4000-8000-000000000510')))$$, :'r7'),
  '42501', 'giving.view alone cannot confirm matches');
select pg_temp.as_user(:rahul);
select pg_temp.assert_state($$select app.zelle_exact_matches('67000000-0000-4000-8000-0000000000c1')$$, '42501', 'members cannot list matches');
commit;

-- ═════════════════════════════════════════════════════════════════════════════
-- The hourly sweep
-- ═════════════════════════════════════════════════════════════════════════════
begin;
set local role authenticated;
select pg_temp.as_user(:kiran);
select (app.report_payment(:c, :h2, 'zelle', 9900, :'today'::date - 15, null, null, null, null))->>'report_id' as r8 \gset
select (app.report_payment(:c, :h2, 'zelle', 6300, :'today'::date - 15, 'WFC-HOLD-0001', null, null, null))->>'report_id' as r12 \gset
select pg_temp.as_user(:rahul);
select (app.report_payment(:c, :h1, 'zelle', 7700, :'today'::date - 20, null, 'R SHAH', null, null))->>'report_id' as r9 \gset
select pg_temp.as_user(:tara);
select app.record_offline_payment(:h1, 7700, 'zelle', :'today'::date - 19) as hp2 \gset
commit;
-- r12's Zelle is on the imported statement, waiting for the treasurer's click: the bank HAS seen it.
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description, bank_type) values
  ('67000000-0000-4000-8000-000000000513', :c, :ba, :'today'::date - 12, 6300, 'Zelle Payment From Kiran Mehta Wfchold0001', 'QUICKPAY_CREDIT');
select count(*) as msgs_before from app.messages where center_id = :c \gset
begin;
set local role connect_worker;
select app.worker_payment_reports_sweep() as sweep1 \gset
commit;
select pg_temp.assert((:'sweep1'::jsonb->>'marked')::int = 1 and (:'sweep1'::jsonb->>'notices')::int = 1
                      and (:'sweep1'::jsonb->>'notice_failures')::int = 0 and (:'sweep1'::jsonb->>'held_for_review')::int = 2,
  'sweep: one report past its window is marked, its member told once; the two the treasurer can already settle are held');
select pg_temp.assert((select status = 'unmatched' and unmatched_at is not null and notice_sent_at is not null and notice_error is null
                         from app.payment_reports where id = :'r8')
                      and (select status from app.payment_reports where id = :'r9') = 'reported',
  'sweep: the overdue report is unmatched; the held one stays reported for the treasurer');
select pg_temp.assert((select status = 'reported' and unmatched_at is null and notice_sent_at is null from app.payment_reports where id = :'r12')
                      and not exists (select 1 from app.messages where center_id = :c and to_address = :kiran and body like '%$63.00%'),
  'sweep: a report whose exact bank line is waiting for the treasurer is not flagged, and the member is not told the bank has not seen it');
select pg_temp.assert((select count(*) from app.messages where center_id = :c and template_key = 'zelle_report_unmatched') = 2
                      and exists (select 1 from app.messages where center_id = :c and template_key = 'zelle_report_unmatched' and channel = 'push'
                                    and to_address = :kiran and body like 'Your Zelle of $99.00 sent on % to Z67 is not on the bank statement after 10 days.%Nothing has been credited yet.')
                      and exists (select 1 from app.messages where center_id = :c and template_key = 'zelle_report_unmatched' and channel = 'email'
                                    and to_address = 'kiran@z67.test' and subject = 'Your Zelle to Z67 Jain Temple is not on the bank statement yet'),
  'sweep: one push to the reporter and one email, in plain English');
begin;
set local role connect_worker;
select app.worker_payment_reports_sweep() as sweep2 \gset
commit;
select pg_temp.assert((:'sweep2'::jsonb->>'marked')::int = 0 and (:'sweep2'::jsonb->>'notices')::int = 0
                      and (select count(*) from app.messages where center_id = :c) = :msgs_before + 2,
  'sweep: a second run changes nothing and tells nobody again');
begin;
set local role authenticated;
select pg_temp.as_user(:tara);
select pg_temp.assert_raises($$select app.worker_payment_reports_sweep()$$, 'permission denied', 'sweep: users cannot run it');
select pg_temp.assert_raises($$select app._zelle_report_held('67000000-0000-4000-8000-000000000999')$$, 'permission denied', 'sweep: the held check is internal');
select pg_temp.assert((app.payment_report_counts(:c)->>'unmatched')::int = 1 and (app.payment_report_counts(:c)->>'reported')::int >= 3,
  'payment_report_counts gives the Home task its numbers');
commit;
-- r12 is settled elsewhere in the real world: withdraw it and set its line aside.
begin;
set local role authenticated;
select pg_temp.as_user(:kiran);
select app.withdraw_payment_report(:'r12', 'Test: done with the held report');
commit;
update app.bank_transactions set status = 'ignored' where id = '67000000-0000-4000-8000-000000000513';
-- An unmatched report can still be matched when its line arrives late.
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description, bank_type) values
  ('67000000-0000-4000-8000-000000000512', :c, :ba, :'today'::date - 6, 9900, 'Zelle Payment From Kiran Mehta', 'QUICKPAY_CREDIT');
begin;
set local role authenticated;
select pg_temp.as_user(:tara);
select pg_temp.assert((select report_id = :'r8' and reason like '%Member reported a Zelle of $99.00 sent on %'
                         from app.suggest_bank_matches('67000000-0000-4000-8000-000000000512') where household_id = :h2),
  'a line without a confirmation number is suggested by amount and date, with the report');
select app.confirm_bank_match('67000000-0000-4000-8000-000000000512', :h2, null, true, null, :'r8') as p8 \gset
commit;
select pg_temp.assert((select status = 'matched' and payment_id = :'p8' from app.payment_reports where id = :'r8'),
  'an unmatched report is matched later');
-- In a sandbox the notice reaches only verified test recipients: the refusal is stored, the sweep goes on.
update app.centers set environment = 'sandbox' where id = :c;
begin;
set local role authenticated;
select pg_temp.as_user(:mira);
select app.report_payment(:c, :h1, 'zelle', 1234, :'today'::date - 14, null, null, null, null) as rep10 \gset
commit;
select (:'rep10'::jsonb)->>'report_id' as r10 \gset
select pg_temp.assert((:'rep10'::jsonb->>'is_test')::boolean and (:'rep10'::jsonb->>'message') = 'Test report saved. In a sandbox no real money moves.'
                      and (select is_test from app.payment_reports where id = :'r10'),
  'a report made in a sandbox is a test report');
begin;
set local role connect_worker;
select app.worker_payment_reports_sweep() as sweep3 \gset
commit;
select pg_temp.assert((:'sweep3'::jsonb->>'marked')::int = 1 and (:'sweep3'::jsonb->>'notice_failures')::int = 1
                      and (select status = 'unmatched' and notice_sent_at is null and notice_error like '%Sandboxes can send only to verified test recipients%'
                             from app.payment_reports where id = :'r10'),
  'sweep in a sandbox: the refused notice (CCENT) is stored on the report and the sweep does not fail');
update app.centers set environment = 'production' where id = :c;

-- ═════════════════════════════════════════════════════════════════════════════
-- Reject and withdraw
-- ═════════════════════════════════════════════════════════════════════════════
begin;
set local role authenticated;
select pg_temp.as_user(:kiran);
select pg_temp.assert_state(format($$select app.reject_payment_report(%L, 'no')$$, :'r3'), '42501', 'reject: a member cannot reject');
select pg_temp.as_user(:esha);
select pg_temp.assert_state(format($$select app.reject_payment_report(%L, 'no')$$, :'r3'), '42501', 'reject: giving.view alone cannot reject');
select pg_temp.as_user(:vina);
select pg_temp.assert_raises(format($$select app.reject_payment_report(%L, '  ')$$, :'r3'), 'Say why the report is not accepted',
  'reject: a reason is required');
select app.reject_payment_report(:'r3', 'The bank shows $51.00 from this confirmation number, not $50.00.');
select pg_temp.assert_raises(format($$select app.reject_payment_report(%L, 'again')$$, :'r3'), 'already rejected',
  'reject: only a waiting report can be rejected');
select pg_temp.assert_raises(format($$select app.reject_payment_report(%L, 'no')$$, :'r1'), 'already matched',
  'reject: a matched report cannot be rejected');
select pg_temp.as_user(:mira);
select pg_temp.assert_raises(format($$select app.withdraw_payment_report(%L, null)$$, :'r3'), 'cannot be withdrawn',
  'withdraw: a rejected report cannot be withdrawn');
select pg_temp.assert_raises(format($$select app.withdraw_payment_report(%L, null)$$, :'r1'), 'cannot be withdrawn',
  'withdraw: a matched report cannot be withdrawn');
select (app.report_payment(:c, :h1, 'zelle', 5100, :'today'::date - 1, 'JPM5K5K5K5K5', 'Mira Shah', null, null))->>'report_id' as r3b \gset
select pg_temp.assert(:'r3b' is not null and (select status from app.payment_reports where id = :'r3') = 'rejected',
  'a rejected report frees its confirmation number: the member reports it again with the right amount');
select pg_temp.assert_raises($$select app.report_payment('67000000-0000-4000-8000-0000000000c1', '67000000-0000-4000-8000-000000000201', 'zelle', 5100, current_date - 2, 'JPM5K5K5K5K5', null, null, null)$$,
  'That confirmation number was already reported.', 'the live report still holds the confirmation number');
select app.withdraw_payment_report(:'r3b', 'Test: done');
select pg_temp.as_user(:rahul);
select pg_temp.assert_state(format($$select app.withdraw_payment_report(%L, null)$$, :'r7'), '42501',
  'withdraw: an adult of another family cannot withdraw it');
select pg_temp.as_user(:kiran);
select app.withdraw_payment_report(:'r7', 'Sent it to the wrong organization');
commit;
select pg_temp.assert((select status = 'rejected' and rejected_by = :vina and reject_reason like 'The bank shows $51.00%' and notice_sent_at is not null
                         from app.payment_reports where id = :'r3')
                      and exists (select 1 from app.messages where center_id = :c and template_key = 'zelle_report_rejected' and channel = 'push'
                                    and to_address = :mira and body like 'The treasurer could not match your Zelle of $50.00 sent on %: The bank shows $51.00%')
                      and (select status from app.payment_reports where id = :'r7') = 'withdrawn',
  'reject tells the member why; withdraw closes the report');
select pg_temp.assert(exists (select 1 from app.audit_log where record_table = 'payment_reports' and record_id = :'r3'
                                and reason = 'The bank shows $51.00 from this confirmation number, not $50.00.'),
  'the reject reason is in the audit log');

-- ═════════════════════════════════════════════════════════════════════════════
-- Link a report to a payment already recorded
-- ═════════════════════════════════════════════════════════════════════════════
begin;
set local role authenticated;
select pg_temp.as_user(:tara);
select app.record_offline_payment(:h1, 7700, 'check', :'today'::date - 2, null, '4417') as chk \gset
select pg_temp.as_user(:vina);
select pg_temp.assert_raises(format($$select app.link_payment_report(%L, %L, 'Recorded at the office')$$, :'r9', :'hp1'),
  'not one of this family''s payments', 'link: another family''s payment is refused');
select pg_temp.assert_raises(format($$select app.link_payment_report(%L, %L, 'Recorded at the office')$$, :'r9', :'chk'),
  'That payment is not a Zelle payment.', 'link: only a Zelle payment');
select pg_temp.assert_raises(format($$select app.link_payment_report(%L, %L, 'Recorded at the office')$$, :'r9', :'p1'),
  'The report says $77.00 but the payment is $251.00.', 'link: the amounts must be the same');
select pg_temp.assert_raises(format($$select app.link_payment_report(%L, %L, '')$$, :'r9', :'hp2'),
  'Say why', 'link: a reason is required');
select app.link_payment_report(:'r9', :'hp2', 'Recorded by hand at the office on Sunday');
select pg_temp.assert_raises(format($$select app.link_payment_report(%L, %L, 'again')$$, :'r6', :'hp2'),
  'The report says $31.00 but the payment is $77.00.', 'link: a $31 report cannot take a $77 payment of the family either');
select pg_temp.as_user(:rahul);
select (app.report_payment(:c, :h1, 'zelle', 7700, :'today'::date - 18, null, null, null, null))->>'report_id' as r11 \gset
select pg_temp.as_user(:vina);
select pg_temp.assert_raises(format($$select app.link_payment_report(%L, %L, 'again')$$, :'r11', :'hp2'),
  'That payment is already linked to another report.', 'link: a payment is linked to one report only');
select pg_temp.as_user(:rahul);
select app.withdraw_payment_report(:'r11', 'Reported twice');
commit;
select pg_temp.assert((select status = 'matched' and payment_id = :'hp2' from app.payment_reports where id = :'r9')
                      and (select status = 'captured' and deposit_bank_transaction_id is null from app.payments where id = :'hp2'),
  'link is bookkeeping only: the report is matched, the payment does not change');

-- ═════════════════════════════════════════════════════════════════════════════
-- A report only goes with a Zelle (or unlabelled) line; a linked report makes the line a Zelle
-- ═════════════════════════════════════════════════════════════════════════════
begin;
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description, bank_type) values
  ('67000000-0000-4000-8000-000000000514', :c, :ba, :'today'::date - 1, 3300, 'Online transfer from savings 4411', null),
  ('67000000-0000-4000-8000-000000000515', :c, :ba, :'today'::date - 1, 3100, 'Check #4417', null);
select pg_temp.assert((select channel = 'other' from app.bank_transactions where id = '67000000-0000-4000-8000-000000000514')
                      and (select channel = 'check' and not is_batch_deposit from app.bank_transactions where id = '67000000-0000-4000-8000-000000000515'),
  'fixture: one line the bank did not label, one check line');
set local role authenticated;
select pg_temp.as_user(:tara);
select app.record_offline_payment(:h2, 3300, 'zelle', :'today'::date - 2) as hp3 \gset
select pg_temp.as_user(:kiran);
select (app.report_payment(:c, :h2, 'zelle', 3300, :'today'::date - 2, null, null, null, null))->>'report_id' as r13 \gset
select pg_temp.as_user(:tara);
select pg_temp.assert_raises(format($$select app.confirm_bank_match('67000000-0000-4000-8000-000000000515', '67000000-0000-4000-8000-000000000201', null, true, null, %L)$$, :'r6'),
  'A Zelle report can only be matched to a Zelle line', 'a Zelle report cannot be matched to a check line');
select pg_temp.assert_state(format($$select app.confirm_bank_match('67000000-0000-4000-8000-000000000514', '67000000-0000-4000-8000-000000000202', null, true, null, %L)$$, :'r13'),
  'CCDUP', 'G6: an unlabelled line named by a member''s report is held to the guard too');
select app.confirm_bank_match('67000000-0000-4000-8000-000000000514', :h2, null, false, null, :'r13', 'Two gifts the same week') as p13 \gset
reset role;
select pg_temp.assert((select method = 'zelle' and provider = 'bank' and amount_cents = 3300 from app.payments where id = :'p13')
                      and (select status = 'matched' and payment_id = :'p13' from app.payment_reports where id = :'r13'),
  'a line named by a Zelle report is recorded as a Zelle, and the report is matched');
rollback;

begin;
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description, bank_type) values
  ('67000000-0000-4000-8000-000000000516', :c, :ba, :'today'::date - 1, 4400, 'Zelle Payment From Kiran Mehta Jpm7i7i7i7i7', 'QUICKPAY_CREDIT');
set local role authenticated;
select pg_temp.as_user(:tara);
select app.record_offline_payment(:h2, 4400, 'zelle', :'today'::date - 2) as hp4 \gset
select pg_temp.as_user(:kiran);
select (app.report_payment(:c, :h2, 'zelle', 4400, :'today'::date - 2, 'JPM7I7I7I7I7', null, null, null))->>'report_id' as ra \gset
select (app.report_payment(:c, :h2, 'zelle', 4400, :'today'::date - 3, null, null, null, null))->>'report_id' as rb \gset
select pg_temp.as_user(:vina);
select app.link_payment_report(:'ra', :'hp4', 'Recorded at the office');
select pg_temp.as_user(:tara);
select pg_temp.assert_raises(format($$select app.attach_bank_line_to_payment('67000000-0000-4000-8000-000000000516', %L, %L)$$, :'hp4', :'rb'),
  'already linked to another report', 'attach: a payment is linked to one report only');
select app.attach_bank_line_to_payment('67000000-0000-4000-8000-000000000516', :'hp4');
reset role;
select pg_temp.assert((select bank_transaction_id = '67000000-0000-4000-8000-000000000516' and payment_id = :'hp4' and status = 'matched'
                         from app.payment_reports where id = :'ra')
                      and (select status = 'reported' from app.payment_reports where id = :'rb'),
  'attach: a report linked earlier learns its bank line');
rollback;

-- An attach with no reason typed is audited with the default one (a typed reason would win).
begin;
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description, bank_type) values
  ('67000000-0000-4000-8000-000000000517', :c, :ba, :'today'::date - 1, 4500, 'Zelle Payment From Kiran Mehta Jpm8j8j8j8j8', 'QUICKPAY_CREDIT');
set local role authenticated;
select pg_temp.as_user(:tara);
select app.record_offline_payment(:h2, 4500, 'zelle', :'today'::date - 2) as hp5 \gset
select app.attach_bank_line_to_payment('67000000-0000-4000-8000-000000000517', :'hp5');
reset role;
select pg_temp.assert(exists (select 1 from app.audit_log where record_table = 'payments' and record_id = :'hp5'
                                and reason like 'Bank line attached to the Zelle or ACH payment%'),
  'attach: with no reason typed, the audit log says the bank line was attached to the payment recorded by hand');
rollback;

-- ═════════════════════════════════════════════════════════════════════════════
-- The treasurer's queue and the settings
-- ═════════════════════════════════════════════════════════════════════════════
begin;
set local role authenticated;
select pg_temp.as_user(:esha);
select app.payment_report_queue(:c) as q \gset
select pg_temp.assert((:'q'::jsonb->>'window_days')::int = 10 and (:'q'::jsonb #>> '{counts,exact}')::int = 0
                      and exists (select 1 from jsonb_array_elements(:'q'::jsonb->'reports') x
                                   where x->>'id' = :'r6' and x #>> '{household,household_id}' = :h1
                                     and jsonb_array_length(x->'candidates') = 2 and not (x #>> '{candidates,0,exact}')::boolean)
                      and not exists (select 1 from jsonb_array_elements(:'q'::jsonb->'reports') x where x->>'id' in (:'r1', :'r3', :'r7')),
  'the queue lists the waiting reports with their household card and candidate lines (none exact while two lines share a number)');
select pg_temp.assert_state($$select app.set_zelle_reporting('67000000-0000-4000-8000-0000000000c1', 7, null, 'shorter')$$, '42501',
  'settings: giving.view cannot change the Zelle settings');
select pg_temp.as_user(:tara);
select pg_temp.assert_raises($$select app.set_zelle_reporting('67000000-0000-4000-8000-0000000000c1', 31, null, 'longer')$$,
  'The report window is 3 to 30 days.', 'settings: the window is 3 to 30 days');
select pg_temp.assert_raises($$select app.set_zelle_reporting('67000000-0000-4000-8000-0000000000c1', 7, null, ' ')$$,
  'Say why', 'settings: a reason is required');
select pg_temp.assert_raises($$select app.set_zelle_reporting('67000000-0000-4000-8000-0000000000c1', 7, '67000000-0000-4000-8000-0000000000ff', 'x')$$,
  'active bank accounts', 'settings: the bank account must be one of the organization''s');
select pg_temp.assert(app.set_zelle_reporting(:c, 7, :ba, 'Chase posts Zelle the same day') = jsonb_build_object('report_window_days', 7, 'bank_account_id', :ba),
  'settings: the treasurer sets a 7-day window and the Chase account');
commit;
select pg_temp.assert(app.zelle_report_window_days(:c) = 7 and app.zelle_bank_account_id(:c) = :ba
                      and (select (rules #>> '{payments,zelle,report_window_days}')::int = 7 from app.centers where id = :c),
  'settings: stored under centers.rules.payments.zelle');
update app.centers set rules = jsonb_set(rules, '{payments,zelle,report_window_days}', '99') where id = :c;
select pg_temp.assert(app.zelle_report_window_days(:c) = 30, 'the window read back is clamped to 3..30');
update app.centers set rules = rules #- '{payments,zelle}' where id = :c;
select pg_temp.assert(app.zelle_report_window_days(:c) = 10, 'no setting: 10 days');

-- ═════════════════════════════════════════════════════════════════════════════
-- Rehearsal: a sandbox hides the real Zelle address from members
-- ═════════════════════════════════════════════════════════════════════════════
begin;
set local role authenticated;
select pg_temp.as_user(:rahul);
select pg_temp.assert(app.member_payment_options(:c) = '{"online": null, "online_unavailable": "not_connected", "environment": "production",
    "offline": [{"method": "zelle", "instructions": {"recipient": "give@z67.test", "name": "Z67 Jain Temple", "memo_hint": "Your member number"}}]}'::jsonb,
  'production: members see exactly what 0211 showed (the Zelle address, name and memo hint)');
select pg_temp.assert((select count(*) from app.center_payment_methods where center_id = :c and method = 'zelle') = 1,
  'production: members read the Zelle method row');
commit;
insert into auth.users (id, email) values ('67000000-0000-4000-8000-0000000000b1', 'stranger@z67.test');
update app.centers set environment = 'sandbox' where id = :c;
begin;
set local role authenticated;
select pg_temp.as_user(:rahul);
select pg_temp.assert((app.member_payment_options(:c)->'offline') = '[{"method": "zelle", "instructions": {"name": "Sandbox: no real money moves", "memo_hint": "Your member number"}, "rehearsal": true}]'::jsonb
                      and position('give@z67.test' in app.member_payment_options(:c)::text) = 0,
  'sandbox: members see "Sandbox: no real money moves", the memo hint and rehearsal, never the address');
select pg_temp.assert((select count(*) from app.center_payment_methods where center_id = :c and method = 'zelle') = 0,
  'sandbox: members cannot read the Zelle method row');
select pg_temp.as_user(:tara);
select pg_temp.assert(position('give@z67.test' in app.payment_settings(:c)::text) > 0
                      and (select count(*) from app.center_payment_methods where center_id = :c and method = 'zelle') = 1,
  'sandbox: staff still see the real address');
select pg_temp.assert(app.zelle_rehearsal(:c), 'rehearsal: members and staff are told their organization is a sandbox');
select pg_temp.as_user('67000000-0000-4000-8000-0000000000b1');
select pg_temp.assert(not app.zelle_rehearsal(:c), 'rehearsal: a stranger cannot ask whether another organization is a sandbox');
commit;
update app.centers set environment = 'production' where id = :c;

-- ═════════════════════════════════════════════════════════════════════════════
-- RLS, grants, search paths
-- ═════════════════════════════════════════════════════════════════════════════
begin;
set local role authenticated;
select pg_temp.as_user(:rahul);
select pg_temp.assert((select count(*) > 0 and bool_and(household_id = :h1) from app.payment_reports),
  'RLS: an adult reads only the family''s reports');
select pg_temp.as_user(:kiran);
select pg_temp.assert((select count(*) > 0 and bool_and(household_id = :h2) from app.payment_reports),
  'RLS: another family reads only its own');
select pg_temp.as_user(:kavi);
select pg_temp.assert((select count(*) from app.payment_reports) = 0, 'RLS: a child reads none');
select pg_temp.as_user(:esha);
select pg_temp.assert((select count(*) from app.payment_reports where center_id = :c)
                      = (select count(*) from app.payment_reports where center_id = :c and household_id in (:h1, :h2))
                      and (select count(distinct household_id) from app.payment_reports where center_id = :c) = 2,
  'RLS: giving.view staff read every report of the organization');
select pg_temp.assert_raises($$insert into app.payment_reports (center_id, household_id, reported_by, amount_cents, sent_on, window_days, due_on)
                               values ('67000000-0000-4000-8000-0000000000c1', '67000000-0000-4000-8000-000000000201', '67000000-0000-4000-8000-0000000000a7', 100, current_date, 10, current_date)$$,
  'permission denied', 'nobody inserts a report directly');
select pg_temp.as_user(:tara);
select pg_temp.assert_raises($$update app.payment_reports set status = 'matched'$$, 'permission denied', 'nobody updates a report directly');
select pg_temp.assert_raises($$delete from app.payment_reports$$, 'permission denied', 'nobody deletes a report directly');
commit;

select pg_temp.assert((select bool_and(exists (select 1 from unnest(p.proconfig) as g(setting) where g.setting ~ '^search_path=app, *public, *extensions$'))
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname in ('payment_reports_prepare','zelle_report_window_days','zelle_bank_account_id','zelle_rehearsal','_zelle_report_held',
                          'set_zelle_reporting','_zelle_report_notice','zelle_recorded_payments','report_payment','withdraw_payment_report','my_payment_reports',
                          'reject_payment_report','link_payment_report','payment_report_counts','worker_payment_reports_sweep','member_payment_options',
                          'possible_duplicate_zelle','zelle_pair_is_exact','zelle_exact_matches','suggest_bank_matches','confirm_bank_match',
                          'attach_bank_line_to_payment','confirm_exact_zelle_matches','payment_report_queue'))
                      and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname = 'app' and p.proname in ('suggest_bank_matches','confirm_bank_match')) = 2,
  'every new or replaced function pins search_path = app, public, extensions; one suggest_bank_matches and one confirm_bank_match');
select pg_temp.assert(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname in ('zelle_report_window_days','zelle_bank_account_id','zelle_rehearsal','_zelle_report_held',
                          'set_zelle_reporting','_zelle_report_notice','zelle_recorded_payments','report_payment','withdraw_payment_report','my_payment_reports',
                          'reject_payment_report','link_payment_report','payment_report_counts','worker_payment_reports_sweep','member_payment_options',
                          'possible_duplicate_zelle','zelle_pair_is_exact','zelle_exact_matches','suggest_bank_matches','confirm_bank_match',
                          'attach_bank_line_to_payment','confirm_exact_zelle_matches','payment_report_queue')
       and has_function_privilege('anon', p.oid, 'execute')),
  'nothing new is executable by anon');
select pg_temp.assert(has_function_privilege('connect_worker', 'app.worker_payment_reports_sweep()', 'execute')
                      and not has_function_privilege('authenticated', 'app.worker_payment_reports_sweep()', 'execute')
                      and not has_function_privilege('service_role', 'app.worker_payment_reports_sweep()', 'execute'),
  'the sweep is for the background service only');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.zelle_pair_is_exact(uuid,uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app._zelle_report_notice(uuid,text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.zelle_recorded_payments(uuid,bigint,date)', 'execute')
                      and has_function_privilege('authenticated', 'app.report_payment(uuid,uuid,text,bigint,date,text,text,uuid[],text)', 'execute')
                      and has_function_privilege('authenticated', 'app.confirm_bank_match(uuid,uuid,uuid[],boolean,uuid,uuid,text)', 'execute'),
  'internal helpers are not callable by users; the RPCs are');
select pg_temp.assert((select module_key from app.module_tables where table_name = 'payment_reports') = 'giving'
                      and 'payment_reports' = any (app.demo_clear_tables()) and not ('payment_reports' = any (app.demo_keep_tables())),
  'payment_reports belongs to Giving and a demo clear removes it');

-- A demo clear of the (now sandbox) organization removes the reports with the other transactions.
update app.centers set environment = 'sandbox', status = 'onboarding' where id = :c;
begin;
select app.demo_clear_center(:c);
select pg_temp.assert(not exists (select 1 from app.payment_reports where center_id = :c), 'demo clear removes payment_reports');
rollback;
update app.centers set environment = 'production', status = 'active' where id = :c;

\echo 'PASS: Zelle reports and bank matching'
