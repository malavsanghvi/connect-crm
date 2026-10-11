-- 0658 and 0659 (BACKLOG B90 phase 4; NEEDS OWNER OK): recording a payment ONCE, all or nothing, and looking at a deposit first.
--   A. A payment and its allocations arrive together    B. The same key twice records once (replay), a different payment with the
--   same key is refused    C. Naming pledges, leaving it unapplied    D. A recorder who may not apply payments    E. Who may
--   F. What it refuses    G. Nothing is left behind when a step fails    H. Keys are per community
--   I. app.giving_deposit_context: the totals, what cannot be matched, who sees what
-- Everything runs in its own community (G108).
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
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2',
    'amr', json_build_array(json_build_object('method','totp','timestamp',extract(epoch from now())::bigint)))::text, true);
  perform set_config('request.headers', '{"x-client-app":"portal","x-client-screen":"/giving/payments"}', true);
end $$;

\set c '''10800000-0000-4000-8000-0000000000c1'''
\set d '''10800000-0000-4000-8000-0000000000d1'''
\set tara '''10800000-0000-4000-8000-0000000000a1'''
\set vina '''10800000-0000-4000-8000-0000000000a2'''
\set mira '''10800000-0000-4000-8000-0000000000a3'''
\set zed '''10800000-0000-4000-8000-0000000000a4'''
\set h1 '''10800000-0000-4000-8000-000000000201'''
\set h2 '''10800000-0000-4000-8000-000000000202'''
\set h3 '''10800000-0000-4000-8000-000000000203'''
\set pl1 '''10800000-0000-4000-8000-000000000301'''
\set pl2 '''10800000-0000-4000-8000-000000000302'''
\set pl3 '''10800000-0000-4000-8000-000000000303'''
\set ba '''10800000-0000-4000-8000-000000000701'''
\set line '''10800000-0000-4000-8000-000000000801'''
\set line2 '''10800000-0000-4000-8000-000000000802'''
\set nobody '''10800000-0000-4000-8000-0000000009ff'''

-- One transaction for the whole test, rolled back at the end, so nothing it creates (a report past its window, say) is
-- seen by the tests that run after it.
begin;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into app.centers (id, slug, name, short_name, time_zone) values
  (:c, 'g108-temple', 'G108 Jain Temple', 'G108', 'America/Chicago'),
  (:d, 'g108-other', 'G108 Other Temple', 'G108B', 'America/Chicago');
insert into auth.users (id, email) values (:tara, 'tara@g108.test'), (:vina, 'vina@g108.test'), (:mira, 'mira@g108.test'), (:zed, 'zed@g108.test');
insert into app.people (id, center_id, first_name, last_name, email, date_of_birth) values
  ('10800000-0000-4000-8000-000000000101', :c, 'Rahul', 'Shah', null, '1980-04-02'),
  ('10800000-0000-4000-8000-000000000102', :c, 'Mira', 'Shah', 'mira@g108.test', '1982-06-11'),
  ('10800000-0000-4000-8000-000000000104', :c, 'Kiran', 'Mehta', null, '1970-01-01'),
  ('10800000-0000-4000-8000-000000000105', :c, 'Tara', 'Treasurer', 'tara@g108.test', '1975-01-01'),
  ('10800000-0000-4000-8000-000000000106', :c, 'Vina', 'Volunteer', 'vina@g108.test', '1990-01-01'),
  ('10800000-0000-4000-8000-000000000108', :d, 'Zed', 'Other', 'zed@g108.test', '1975-01-01');
insert into app.households (id, center_id, display_name) values (:h1, :c, 'Shah family'), (:h2, :c, 'Mehta family'), (:h3, :d, 'Other family');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, '10800000-0000-4000-8000-000000000101', :c, 'primary', true),
  (:h1, '10800000-0000-4000-8000-000000000102', :c, 'spouse', false),
  (:h2, '10800000-0000-4000-8000-000000000104', :c, 'primary', true);
insert into app.center_users (center_id, user_id, person_id, is_default) values
  (:c, :tara, '10800000-0000-4000-8000-000000000105', false),
  (:c, :vina, '10800000-0000-4000-8000-000000000106', false),
  (:c, :mira, '10800000-0000-4000-8000-000000000102', false),
  (:d, :zed, '10800000-0000-4000-8000-000000000108', false);
insert into app.role_grants (center_id, user_id, role_key) values (:c, :tara, 'treasurer'), (:c, :vina, 'finance_volunteer'), (:d, :zed, 'treasurer');
-- H1 has two open pledges: $500 (older) and $300; H2 has one of $100.
insert into app.pledges (id, center_id, household_id, source, amount_cents, pledged_at, status) values
  (:pl1, :c, :h1, 'general', 50000, timestamptz '2026-01-10 12:00:00+00', 'open'),
  (:pl2, :c, :h1, 'general', 30000, timestamptz '2026-03-01 12:00:00+00', 'open'),
  (:pl3, :c, :h2, 'general', 10000, timestamptz '2026-02-01 12:00:00+00', 'open');
select (now() at time zone 'America/Chicago')::date as today \gset

-- ═════════════════════════════════════════════════════════════════════════════
-- A. A payment and its allocations arrive together
-- ═════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user(:tara);
select app.record_offline_payment_once('key-108-0001', :h1, 60000, 'check', :'today'::date - 1, null, true, '1043', null, 'for Diwali')::text as r1 \gset
select (:'r1'::jsonb)->>'payment_id' as p1 \gset
reset role;

select pg_temp.assert(((:'r1'::jsonb)->>'replayed')::boolean = false and ((:'r1'::jsonb)->>'receipt_number') is not null
                      and ((:'r1'::jsonb)->>'amount_cents')::bigint = 60000 and ((:'r1'::jsonb)->>'unallocated_cents')::bigint = 0
                      and jsonb_array_length((:'r1'::jsonb)->'applied') = 2 and ((:'r1'::jsonb)->>'allocation_skipped') is null,
  'A: the payment is recorded and fully applied in one call: $500 + $100 across two pledges, nothing left over');
select pg_temp.assert((select amount_cents = 60000 and method = 'check' and status = 'captured' and provider = 'offline'
                              and recorded_by = :tara::uuid and idempotency_key = 'key-108-0001' and check_number = '1043'
                              and memo = 'for Diwali' and received_on = :'today'::date - 1 and receipt_number is not null
                         from app.payments where id = :'p1'::uuid),
  'A: the payment row has the screen''s values: captured, offline, recorded by the person, check number, memo, receipt number');
select pg_temp.assert((select count(*) from app.payment_allocations where payment_id = :'p1'::uuid) = 2
                      and (select status from app.pledges where id = :pl1) = 'paid' and (select paid_cents from app.pledges where id = :pl1) = 50000
                      and (select status from app.pledges where id = :pl2) = 'partially_paid' and (select paid_cents from app.pledges where id = :pl2) = 10000,
  'A: earliest pledge first: the first is paid in full, the overpayment rolled to the next, which stays open');
select pg_temp.assert(((:'r1'::jsonb)->'applied'->0->>'pledge_id') = '10800000-0000-4000-8000-000000000301'
                      and ((:'r1'::jsonb)->'applied'->0->>'closed')::boolean and not ((:'r1'::jsonb)->'applied'->1->>'closed')::boolean,
  'A: the answer says which pledge closed and which stayed open');
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'payments' and record_id = :'p1') >= 1, 'A: recording is audited like any payment');

-- ═════════════════════════════════════════════════════════════════════════════
-- B. The same key twice records once
-- ═════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user(:tara);
select app.record_offline_payment_once('key-108-0001', :h1, 60000, 'check', :'today'::date - 1, null, true, '1043', null, 'for Diwali')::text as r1b \gset
reset role;
select pg_temp.assert(((:'r1b'::jsonb)->>'replayed')::boolean and ((:'r1b'::jsonb)->>'payment_id') = :'p1',
  'B: a second confirmation with the same key returns the payment already recorded');
select pg_temp.assert((select count(*) from app.payments where center_id = :c) = 1 and (select count(*) from app.payment_allocations where payment_id = :'p1'::uuid) = 2,
  'B: ... and nothing was added: one payment, two allocations');
select pg_temp.assert(((:'r1b'::jsonb)->>'unallocated_cents')::bigint = 0 and jsonb_array_length((:'r1b'::jsonb)->'applied') = 2,
  'B: the repeat reports the same allocations');
set local role authenticated;
select pg_temp.as_user(:tara);
select pg_temp.assert_state($$select app.record_offline_payment_once('key-108-0001', '10800000-0000-4000-8000-000000000201', 61000, 'check', current_date - 1, null, true, '1043', null, null)$$,
  '23505', 'B: the same key for a different amount is refused (23505)');
select pg_temp.assert_raises($$select app.record_offline_payment_once('key-108-0001', '10800000-0000-4000-8000-000000000202', 60000, 'check', current_date - 1, null, true, null, null, null)$$,
  'already used for a different payment', 'B: ... and for a different household, with a plain sentence');
reset role;
select pg_temp.assert((select count(*) from app.payments where center_id = :c) = 1, 'B: a refused repeat records nothing');

-- ═════════════════════════════════════════════════════════════════════════════
-- C. A different key records a new payment; pledges named; leaving it unapplied
-- ═════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user(:tara);
select app.record_offline_payment_once('key-108-0002', :h1, 25000, 'zelle', :'today'::date, null, true, null, null, 'Ref WFCT')::text as r2 \gset
select app.record_offline_payment_once('key-108-0003', :h2, 5000, 'cash', :'today'::date, array[:pl3]::uuid[], true, null, '17', null)::text as r3 \gset
select app.record_offline_payment_once('key-108-0004', :h1, 500, 'cash', :'today'::date, null, false, null, null, null)::text as r4 \gset
reset role;
select pg_temp.assert(((:'r2'::jsonb)->>'replayed')::boolean = false and ((:'r2'::jsonb)->>'payment_id') <> :'p1', 'C: a new key is a new payment');
select pg_temp.assert(jsonb_array_length((:'r2'::jsonb)->'applied') = 1 and ((:'r2'::jsonb)->'applied'->0->>'amount_cents')::bigint = 20000
                      and ((:'r2'::jsonb)->'applied'->0->>'closed')::boolean and ((:'r2'::jsonb)->>'unallocated_cents')::bigint = 5000,
  'C: it finishes the open pledge ($200 left) and the extra $50 stays unapplied, a general gift');
select pg_temp.assert((select count(*) from app.payment_allocations a where a.payment_id = ((:'r3'::jsonb)->>'payment_id')::uuid and a.pledge_id = :pl3 and a.chosen_by_donor) = 1
                      and (select paid_cents from app.pledges where id = :pl3) = 5000,
  'C: a named pledge is used, and marked as chosen by the donor');
select pg_temp.assert(jsonb_array_length((:'r4'::jsonb)->'applied') = 0 and ((:'r4'::jsonb)->>'unallocated_cents')::bigint = 500
                      and (select count(*) from app.payment_allocations where payment_id = ((:'r4'::jsonb)->>'payment_id')::uuid) = 0,
  'C: "leave it unapplied" records the payment and applies nothing');
select pg_temp.assert((select envelope_number from app.payments where id = ((:'r3'::jsonb)->>'payment_id')::uuid) = '17', 'C: the envelope number is kept');

-- ═════════════════════════════════════════════════════════════════════════════
-- D. A recorder who may not apply payments
-- ═════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user(:vina);
select app.record_offline_payment_once('key-108-0005', :h2, 4000, 'check', :'today'::date, null, true, '2001', null, null)::text as r5 \gset
select app.record_offline_payment_once('key-108-0005', :h2, 4000, 'check', :'today'::date, null, true, '2001', null, null)::text as r5b \gset
reset role;
select pg_temp.assert((select recorded_by = :vina::uuid from app.payments where id = ((:'r5'::jsonb)->>'payment_id')::uuid)
                      and jsonb_array_length((:'r5'::jsonb)->'applied') = 0 and ((:'r5'::jsonb)->>'unallocated_cents')::bigint = 4000
                      and ((:'r5'::jsonb)->>'allocation_skipped') like '%giving.manage%',
  'D: a recorder without giving.manage gets the payment recorded and left unapplied, and is told why (never an error)');
select pg_temp.assert(((:'r5b'::jsonb)->>'replayed')::boolean and ((:'r5b'::jsonb)->>'payment_id') = ((:'r5'::jsonb)->>'payment_id'),
  'D: the recorder''s repeat is recognised too');
select pg_temp.assert((select count(*) from app.payment_allocations where payment_id = ((:'r5'::jsonb)->>'payment_id')::uuid) = 0, 'D: no allocation was written for the recorder');

-- ═════════════════════════════════════════════════════════════════════════════
-- E / F. Who may, and what it refuses (each refusal records nothing)
-- ═════════════════════════════════════════════════════════════════════════════
select count(*) as before_refusals from app.payments where center_id = :c \gset
set local role authenticated;
select pg_temp.as_user(:mira);
select pg_temp.assert_state($$select app.record_offline_payment_once('key-108-m001', '10800000-0000-4000-8000-000000000201', 1000, 'cash', current_date, null, true, null, null, null)$$,
  '42501', 'E: a family member cannot record a payment (42501)');
select pg_temp.as_user(:zed);
select pg_temp.assert_state($$select app.record_offline_payment_once('key-108-z001', '10800000-0000-4000-8000-000000000201', 1000, 'cash', current_date, null, true, null, null, null)$$,
  '42501', 'E: another community''s treasurer cannot record into this community (42501)');
select pg_temp.as_user(:tara);
select pg_temp.assert_state($$select app.record_offline_payment_once('key-108-t001', '10800000-0000-4000-8000-0000000009ff', 1000, 'cash', current_date, null, true, null, null, null)$$,
  'P0002', 'F: a household that does not exist is refused');
select pg_temp.assert_raises($$select app.record_offline_payment_once('short', '10800000-0000-4000-8000-000000000201', 1000, 'cash', current_date, null, true, null, null, null)$$,
  'confirmation key', 'F: a missing or short key is refused: a payment cannot be recorded without one');
select pg_temp.assert_raises($$select app.record_offline_payment_once(null, '10800000-0000-4000-8000-000000000201', 1000, 'cash', current_date, null, true, null, null, null)$$,
  'confirmation key', 'F: ... and a null key');
select pg_temp.assert_raises($$select app.record_offline_payment_once('key-108-t002', '10800000-0000-4000-8000-000000000201', 0, 'cash', current_date, null, true, null, null, null)$$,
  'greater than zero', 'F: an amount of zero is refused');
select pg_temp.assert_raises($$select app.record_offline_payment_once('key-108-t003', '10800000-0000-4000-8000-000000000201', -100, 'cash', current_date, null, true, null, null, null)$$,
  'greater than zero', 'F: a negative amount is refused');
select pg_temp.assert_raises($$select app.record_offline_payment_once('key-108-t004', '10800000-0000-4000-8000-000000000201', 1000, 'card', current_date, null, true, null, null, null)$$,
  'check, cash, ACH, Zelle or stock', 'F: a card is taken through the payment provider, not recorded by hand');
select pg_temp.assert_raises($$select app.record_offline_payment_once('key-108-t005', '10800000-0000-4000-8000-000000000201', 1000, 'cash', current_date + 2, null, true, null, null, null)$$,
  'not in the future', 'F: a date in the future is refused');
select pg_temp.assert_raises($$select app.record_offline_payment_once('key-108-t006', '10800000-0000-4000-8000-000000000201', 1000, 'cash', null, null, true, null, null, null)$$,
  'received date', 'F: a missing date is refused');
reset role;
select pg_temp.assert((select count(*) from app.payments where center_id = :c) = :before_refusals, 'E/F: none of the refusals recorded anything');
select pg_temp.assert(exists (select 1 from pg_constraint where conname = 'payments_idempotency_key_len'), 'F: the key length is also a table constraint');

-- ═════════════════════════════════════════════════════════════════════════════
-- G. Nothing is left behind when a step fails (one call = one transaction)
-- ═════════════════════════════════════════════════════════════════════════════
create function public.g108_boom() returns trigger language plpgsql as $$ begin raise exception 'g108 boom: applying failed'; end $$;
create trigger g108_boom before insert on app.payment_allocations for each row execute function public.g108_boom();
set local role authenticated;
select pg_temp.as_user(:tara);
select pg_temp.assert_raises($$select app.record_offline_payment_once('key-108-boom', '10800000-0000-4000-8000-000000000202', 1000, 'cash', current_date, null, true, null, null, null)$$,
  'g108 boom', 'G: applying to pledges fails');
reset role;
drop trigger g108_boom on app.payment_allocations;
drop function public.g108_boom();
select pg_temp.assert(not exists (select 1 from app.payments where idempotency_key = 'key-108-boom'),
  'G: ... and then the payment does not exist either: it is all or nothing, never a payment without its allocation');
set local role authenticated;
select pg_temp.as_user(:tara);
select app.record_offline_payment_once('key-108-boom', :h2, 1000, 'cash', :'today'::date, null, true, null, null, null)::text as r6 \gset
reset role;
select pg_temp.assert(((:'r6'::jsonb)->>'replayed')::boolean = false, 'G: after the problem is gone the same key records normally (a failed try did not use it up)');

-- ═════════════════════════════════════════════════════════════════════════════
-- H. Keys belong to a community
-- ═════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user(:zed);
select app.record_offline_payment_once('key-108-0001', :h3, 1000, 'cash', :'today'::date, null, true, null, null, null)::text as r7 \gset
reset role;
select pg_temp.assert(((:'r7'::jsonb)->>'replayed')::boolean = false and ((:'r7'::jsonb)->>'payment_id') <> :'p1',
  'H: another community can use the same key text: it records its own payment');
do $$ begin
  insert into app.payments (center_id, household_id, amount_cents, method, provider, received_on, idempotency_key)
  values ('10800000-0000-4000-8000-0000000000c1', '10800000-0000-4000-8000-000000000201', 100, 'cash', 'offline', current_date, 'key-108-0001');
  raise exception 'FAIL: the table accepted a second payment with the same key';
exception when unique_violation then raise notice 'PASS: the table itself refuses a second payment with the same key in a community';
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- I. Looking at a deposit first (security invoker)
-- ═════════════════════════════════════════════════════════════════════════════
insert into app.bank_accounts (id, center_id, name, institution, last4, statement_format) values (:ba, :c, 'Chase operating', 'Chase', '1080', 'chase_csv');
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description, status, is_batch_deposit, channel) values
  (:line, :c, :ba, :'today'::date, 85000, 'Deposit', 'unmatched', true, 'cash_deposit'),
  (:line2, :c, :ba, :'today'::date - 3, 1234, 'Deposit', 'matched', true, 'cash_deposit');
-- A card payment (not recorded by hand) and a payment already on another deposit.
insert into app.payments (id, center_id, household_id, amount_cents, method, status, provider, provider_ref, received_on) values
  ('10800000-0000-4000-8000-000000000491', :c, :h1, 700, 'card', 'captured', 'stripe', 'pi_g108', :'today'::date),
  ('10800000-0000-4000-8000-000000000492', :c, :h1, 800, 'cash', 'settled', 'offline', null, :'today'::date);
update app.payments set deposit_bank_transaction_id = :line2 where id = '10800000-0000-4000-8000-000000000492';
select ((:'r2'::jsonb)->>'payment_id') as p2 \gset

set local role authenticated;
select pg_temp.as_user(:tara);
select app.giving_deposit_context(:line, array[:'p1'::uuid, :'p2'::uuid])::text as dep_ok \gset
select app.giving_deposit_context(:line, array[:'p1'::uuid])::text as dep_short \gset
select app.giving_deposit_context(:line, array[:'p1'::uuid, :nobody::uuid])::text as dep_missing \gset
select app.giving_deposit_context(:line, array['10800000-0000-4000-8000-000000000491'::uuid, '10800000-0000-4000-8000-000000000492'::uuid])::text as dep_blocked \gset
select coalesce(app.giving_deposit_context(:nobody, array[:'p1'::uuid])::text, 'null') as dep_noline \gset
reset role;
set local role authenticated;
select pg_temp.as_user(:vina);
select coalesce(app.giving_deposit_context(:line, array[:'p1'::uuid, ((:'r5'::jsonb)->>'payment_id')::uuid])::text, 'null') as dep_vina \gset
reset role;
set local role authenticated;
select pg_temp.as_user(:mira);
select coalesce(app.giving_deposit_context(:line, array[:'p1'::uuid])::text, 'null') as dep_mira \gset
select pg_temp.as_user(:zed);
select coalesce(app.giving_deposit_context(:line, array[:'p1'::uuid])::text, 'null') as dep_zed \gset
reset role;

select pg_temp.assert(((:'dep_ok'::jsonb)->>'total_cents')::bigint = 85000 and ((:'dep_ok'::jsonb)->>'difference_cents')::bigint = 0
                      and jsonb_array_length((:'dep_ok'::jsonb)->'payments') = 2 and jsonb_array_length((:'dep_ok'::jsonb)->'missing_ids') = 0
                      and not exists (select 1 from jsonb_array_elements((:'dep_ok'::jsonb)->'payments') p where not (p->>'can_match')::boolean),
  'I: the chosen payments add up to the deposit to the cent, and every one can be matched');
select pg_temp.assert(((:'dep_ok'::jsonb)->'bank_line'->>'amount_cents')::bigint = 85000 and ((:'dep_ok'::jsonb)->'bank_line'->>'status') = 'unmatched',
  'I: the bank line is described');
select pg_temp.assert(((:'dep_short'::jsonb)->>'difference_cents')::bigint = 25000, 'I: the difference says how much is missing (positive) or over (negative)');
select pg_temp.assert(jsonb_array_length((:'dep_missing'::jsonb)->'missing_ids') = 1 and ((:'dep_missing'::jsonb)->'missing_ids'->>0) = '10800000-0000-4000-8000-0000000009ff',
  'I: a payment that is not found is listed, not silently skipped');
select pg_temp.assert(not ((select p->>'can_match' from jsonb_array_elements((:'dep_blocked'::jsonb)->'payments') p where p->>'id' = '10800000-0000-4000-8000-000000000491')::boolean)
                      and ((select p->>'already_deposited' from jsonb_array_elements((:'dep_blocked'::jsonb)->'payments') p where p->>'id' = '10800000-0000-4000-8000-000000000492')::boolean),
  'I: a card payment cannot be matched by hand, and a payment already on a deposit says so');
select pg_temp.assert(:'dep_noline' = 'null', 'I: a bank line that does not exist gives null');
select pg_temp.assert(:'dep_vina' = 'null' or ((:'dep_vina'::jsonb)->'missing_ids') @> to_jsonb(:'p1'::text),
  'I: a finance volunteer does not see the treasurer''s payment (it is listed as not found)');
select pg_temp.assert(:'dep_mira' = 'null' and :'dep_zed' = 'null', 'I: a family member and another community''s treasurer do not see the bank line at all');
select pg_temp.assert((select bool_and(p.provolatile = 's' and not p.prosecdef) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname = 'giving_deposit_context'), 'I: the deposit look-up is stable and security invoker (it only reads)');
select pg_temp.assert((select count(*) from app.bank_transactions where center_id = :c and status = 'matched') = 1, 'I: looking changed nothing: still one matched line');
select pg_temp.assert(not has_function_privilege('anon', 'app.record_offline_payment_once(text, uuid, bigint, app.payment_method, date, uuid[], boolean, text, text, text)', 'execute')
                      and has_function_privilege('authenticated', 'app.record_offline_payment_once(text, uuid, bigint, app.payment_method, date, uuid[], boolean, text, text, text)', 'execute')
                      and not has_function_privilege('anon', 'app.giving_deposit_context(uuid, uuid[])', 'execute'),
  'I: signed-out visitors cannot call either function');

rollback;
