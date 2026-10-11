-- 0658 and 0659 (BACKLOG B90 phase 4; NEEDS OWNER OK): recording a payment ONCE, all or nothing, exactly as shown, and looking at a
-- deposit first.
--   A. A payment and its allocations arrive together     B. The same key twice records once; a different payment with the same key
--   is refused     C. Named pledges, leaving it unapplied     D. A recorder who may not apply payments     E. Who may, and which
--   community     F. What it refuses (each refusal records nothing)     K. Exactly the pledges on the card, equal pledged_at, a
--   pledge that changed, never above what is open, locks     G. Nothing is left behind when a step fails     H. Two confirmations
--   racing (the conflict branch)     I. Keys are per community     J. Dates are the community's own day
--   L. "Was a payment like this just confirmed?"     M. app.giving_deposit_context
-- The whole test is one transaction that is rolled back at the end, so nothing it creates is seen by the tests that run after it.
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
-- One line of a plan, as the confirmation card stores it: the pledge, what goes to it, and what the pledge looked like.
create or replace function pg_temp.line(p_pledge uuid, p_take bigint, p_amount bigint, p_paid bigint) returns jsonb language sql as $$
  select jsonb_build_object('pledge_id', p_pledge, 'amount_cents', p_take, 'pledge_amount_cents', p_amount, 'pledge_paid_cents', p_paid)
$$;

\set c '''10800000-0000-4000-8000-0000000000c1'''
\set d '''10800000-0000-4000-8000-0000000000d1'''
\set tara '''10800000-0000-4000-8000-0000000000a1'''
\set vina '''10800000-0000-4000-8000-0000000000a2'''
\set mira '''10800000-0000-4000-8000-0000000000a3'''
\set zed '''10800000-0000-4000-8000-0000000000a4'''
\set pa '''10800000-0000-4000-8000-0000000000a5'''
\set h1 '''10800000-0000-4000-8000-000000000201'''
\set h2 '''10800000-0000-4000-8000-000000000202'''
\set h3 '''10800000-0000-4000-8000-000000000203'''
\set h4 '''10800000-0000-4000-8000-000000000204'''
\set pl1 '''10800000-0000-4000-8000-000000000301'''
\set pl2 '''10800000-0000-4000-8000-000000000302'''
\set pl3 '''10800000-0000-4000-8000-000000000303'''
\set plo '''10800000-0000-4000-8000-000000000341'''
\set phi '''10800000-0000-4000-8000-000000000342'''
\set ba '''10800000-0000-4000-8000-000000000701'''
\set line '''10800000-0000-4000-8000-000000000801'''
\set line2 '''10800000-0000-4000-8000-000000000802'''
\set nobody '''10800000-0000-4000-8000-0000000009ff'''

begin;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into app.centers (id, slug, name, short_name, time_zone) values
  (:c, 'g108-temple', 'G108 Jain Temple', 'G108', 'America/Chicago'),
  (:d, 'g108-other', 'G108 Other Temple', 'G108B', 'America/Chicago');
insert into auth.users (id, email) values (:tara, 'tara@g108.test'), (:vina, 'vina@g108.test'), (:mira, 'mira@g108.test'), (:zed, 'zed@g108.test'), (:pa, 'pa@g108.test');
insert into app.accounts (user_id, is_platform_admin) values (:pa, true) on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.people (id, center_id, first_name, last_name, email, date_of_birth) values
  ('10800000-0000-4000-8000-000000000101', :c, 'Rahul', 'Shah', null, '1980-04-02'),
  ('10800000-0000-4000-8000-000000000102', :c, 'Mira', 'Shah', 'mira@g108.test', '1982-06-11'),
  ('10800000-0000-4000-8000-000000000104', :c, 'Kiran', 'Mehta', null, '1970-01-01'),
  ('10800000-0000-4000-8000-000000000105', :c, 'Tara', 'Treasurer', 'tara@g108.test', '1975-01-01'),
  ('10800000-0000-4000-8000-000000000106', :c, 'Vina', 'Volunteer', 'vina@g108.test', '1990-01-01'),
  ('10800000-0000-4000-8000-000000000108', :d, 'Zed', 'Other', 'zed@g108.test', '1975-01-01');
insert into app.households (id, center_id, display_name) values (:h1, :c, 'Shah family'), (:h2, :c, 'Mehta family'), (:h3, :d, 'Other family'), (:h4, :c, 'Patel family');
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
-- H1: $500 (older) and $300. H2: $100. H4: two pledges of $300 made at the very same moment.
insert into app.pledges (id, center_id, household_id, source, amount_cents, pledged_at, status) values
  (:pl1, :c, :h1, 'general', 50000, timestamptz '2026-01-10 12:00:00+00', 'open'),
  (:pl2, :c, :h1, 'general', 30000, timestamptz '2026-03-01 12:00:00+00', 'open'),
  (:pl3, :c, :h2, 'general', 10000, timestamptz '2026-02-01 12:00:00+00', 'open'),
  (:plo, :c, :h4, 'general', 30000, timestamptz '2026-04-01 12:00:00+00', 'open'),
  (:phi, :c, :h4, 'general', 30000, timestamptz '2026-04-01 12:00:00+00', 'open');
select (now() at time zone 'America/Chicago')::date as today \gset

-- ═════════════════════════════════════════════════════════════════════════════
-- A. A payment and its allocations arrive together
-- ═════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user(:tara);
select app.record_offline_payment_once('key-108-0001', :c, :h1, 60000, 'check', :'today'::date - 1,
         jsonb_build_array(pg_temp.line(:pl1, 50000, 50000, 0), pg_temp.line(:pl2, 10000, 30000, 0)), false, '1043', null, 'for Diwali')::text as r1 \gset
select (:'r1'::jsonb)->>'payment_id' as p1 \gset
reset role;

select pg_temp.assert(((:'r1'::jsonb)->>'replayed')::boolean = false and ((:'r1'::jsonb)->>'receipt_number') is not null
                      and ((:'r1'::jsonb)->>'amount_cents')::bigint = 60000 and ((:'r1'::jsonb)->>'unallocated_cents')::bigint = 0
                      and jsonb_array_length((:'r1'::jsonb)->'applied') = 2 and ((:'r1'::jsonb)->>'allocation_skipped') is null,
  'A: the payment is recorded and applied in one call: $500 + $100 across two pledges, nothing left over');
select pg_temp.assert((select amount_cents = 60000 and method = 'check' and status = 'captured' and provider = 'offline'
                              and recorded_by = :tara::uuid and idempotency_key = 'key-108-0001' and check_number = '1043'
                              and memo = 'for Diwali' and received_on = :'today'::date - 1 and receipt_number is not null
                         from app.payments where id = :'p1'::uuid),
  'A: the payment row has the screen''s values: captured, offline, recorded by the person, check number, memo, receipt number');
select pg_temp.assert((select count(*) from app.payment_allocations where payment_id = :'p1'::uuid) = 2
                      and (select status from app.pledges where id = :pl1) = 'paid' and (select paid_cents from app.pledges where id = :pl1) = 50000
                      and (select status from app.pledges where id = :pl2) = 'partially_paid' and (select paid_cents from app.pledges where id = :pl2) = 10000,
  'A: the pledges on the card are paid as shown: the first in full, the second in part');
select pg_temp.assert(((:'r1'::jsonb)->'applied'->0->>'closed')::boolean and not ((:'r1'::jsonb)->'applied'->1->>'closed')::boolean,
  'A: the answer says which pledge closed and which stayed open');
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'payments' and record_id = :'p1') >= 1, 'A: recording is audited like any payment');

-- ═════════════════════════════════════════════════════════════════════════════
-- B. The same key twice records once (separate statements, as separate confirmations would arrive)
-- ═════════════════════════════════════════════════════════════════════════════
select count(*) as payments_before from app.payments where center_id = :c \gset
select count(*) as allocations_before from app.payment_allocations where center_id = :c \gset
set local role authenticated;
select pg_temp.as_user(:tara);
select app.record_offline_payment_once('key-108-0001', :c, :h1, 60000, 'check', :'today'::date - 1,
         jsonb_build_array(pg_temp.line(:pl1, 50000, 50000, 0), pg_temp.line(:pl2, 10000, 30000, 0)), false, '1043', null, 'for Diwali')::text as r1b \gset
-- ... even when the repeat carries a different plan: the first confirmation's allocations stand, nothing is applied again
select app.record_offline_payment_once('key-108-0001', :c, :h1, 60000, 'check', :'today'::date - 1,
         jsonb_build_array(pg_temp.line(:pl2, 30000, 30000, 0)), false, '1043', null, 'for Diwali')::text as r1c \gset
reset role;
select pg_temp.assert(((:'r1b'::jsonb)->>'replayed')::boolean and ((:'r1b'::jsonb)->>'payment_id') = :'p1'
                      and ((:'r1c'::jsonb)->>'replayed')::boolean and ((:'r1c'::jsonb)->>'payment_id') = :'p1',
  'B: a second and a third confirmation with the same key return the payment already recorded');
select pg_temp.assert((select count(*) from app.payments where center_id = :c) = :payments_before
                      and (select count(*) from app.payment_allocations where center_id = :c) = :allocations_before
                      and (select paid_cents from app.pledges where id = :pl2) = 10000,
  'B: ... and nothing was added: the same number of payments and allocations, and the pledge is not paid twice');
select pg_temp.assert(((:'r1b'::jsonb)->>'unallocated_cents')::bigint = 0 and jsonb_array_length((:'r1b'::jsonb)->'applied') = 2,
  'B: the repeat reports the allocations of the first');
set local role authenticated;
select pg_temp.as_user(:tara);
select pg_temp.assert_state($$select app.record_offline_payment_once('key-108-0001', '10800000-0000-4000-8000-0000000000c1', '10800000-0000-4000-8000-000000000201', 61000, 'check', current_date - 2, '[]'::jsonb, false, '1043', null, null)$$,
  '23505', 'B: the same key for a different amount is refused (23505)');
select pg_temp.assert_raises($$select app.record_offline_payment_once('key-108-0001', '10800000-0000-4000-8000-0000000000c1', '10800000-0000-4000-8000-000000000202', 60000, 'check', current_date - 2, '[]'::jsonb, false, null, null, null)$$,
  'already used for a different payment', 'B: ... and for a different household, with a plain sentence');
reset role;
select pg_temp.assert((select count(*) from app.payments where center_id = :c) = :payments_before, 'B: a refused repeat records nothing');

-- ═════════════════════════════════════════════════════════════════════════════
-- C. A different key records a new payment; pledges named; leaving it unapplied
-- ═════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user(:tara);
select app.record_offline_payment_once('key-108-0002', :c, :h1, 25000, 'zelle', :'today'::date,
         jsonb_build_array(pg_temp.line(:pl2, 20000, 30000, 10000)), false, null, null, 'Ref WFCT')::text as r2 \gset
select app.record_offline_payment_once('key-108-0003', :c, :h2, 5000, 'cash', :'today'::date,
         jsonb_build_array(pg_temp.line(:pl3, 5000, 10000, 0)), true, null, '17', null)::text as r3 \gset
select app.record_offline_payment_once('key-108-0004', :c, :h1, 500, 'cash', :'today'::date, '[]'::jsonb, false, null, null, null)::text as r4 \gset
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
  'C: "leave it unapplied" (an empty plan) records the payment and applies nothing');
select pg_temp.assert((select envelope_number from app.payments where id = ((:'r3'::jsonb)->>'payment_id')::uuid) = '17', 'C: the envelope number is kept');

-- ═════════════════════════════════════════════════════════════════════════════
-- D. A recorder who may not apply payments
-- ═════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user(:vina);
select app.record_offline_payment_once('key-108-0005', :c, :h2, 4000, 'check', :'today'::date,
         jsonb_build_array(pg_temp.line(:pl3, 4000, 10000, 5000)), false, '2001', null, null)::text as r5 \gset
select app.record_offline_payment_once('key-108-0005', :c, :h2, 4000, 'check', :'today'::date,
         jsonb_build_array(pg_temp.line(:pl3, 4000, 10000, 5000)), false, '2001', null, null)::text as r5b \gset
select app.record_offline_payment_once('key-108-0006', :c, :h2, 100, 'cash', :'today'::date, '[]'::jsonb, false, null, null, null)::text as r5c \gset
reset role;
select pg_temp.assert((select recorded_by = :vina::uuid from app.payments where id = ((:'r5'::jsonb)->>'payment_id')::uuid)
                      and jsonb_array_length((:'r5'::jsonb)->'applied') = 0 and ((:'r5'::jsonb)->>'unallocated_cents')::bigint = 4000
                      and ((:'r5'::jsonb)->>'allocation_skipped') like '%giving.manage%',
  'D: a recorder without giving.manage gets the payment recorded and left unapplied, and is told why (never an error)');
select pg_temp.assert(((:'r5b'::jsonb)->>'replayed')::boolean and ((:'r5b'::jsonb)->>'payment_id') = ((:'r5'::jsonb)->>'payment_id'),
  'D: the recorder''s repeat is recognised too');
select pg_temp.assert((select count(*) from app.payment_allocations where payment_id = ((:'r5'::jsonb)->>'payment_id')::uuid) = 0
                      and (select paid_cents from app.pledges where id = :pl3) = 5000,
  'D: no allocation was written for the recorder, and the pledge is untouched');
select pg_temp.assert(((:'r5c'::jsonb)->>'allocation_skipped') is null, 'D: with nothing to apply there is nothing to explain');

-- ═════════════════════════════════════════════════════════════════════════════
-- E / F. Who may, which community, and what it refuses (each refusal records nothing)
-- ═════════════════════════════════════════════════════════════════════════════
select count(*) as before_refusals from app.payments where center_id = :c \gset
select count(*) as allocs_before_refusals from app.payment_allocations where center_id = :c \gset
set local role authenticated;
select pg_temp.as_user(:mira);
select pg_temp.assert_state($$select app.record_offline_payment_once('key-108-m001', '10800000-0000-4000-8000-0000000000c1', '10800000-0000-4000-8000-000000000201', 1000, 'cash', current_date - 1, '[]'::jsonb, false, null, null, null)$$,
  '42501', 'E: a family member cannot record a payment (42501)');
select pg_temp.as_user(:zed);
select pg_temp.assert_state($$select app.record_offline_payment_once('key-108-z001', '10800000-0000-4000-8000-0000000000d1', '10800000-0000-4000-8000-000000000201', 1000, 'cash', current_date - 1, '[]'::jsonb, false, null, null, null)$$,
  '42501', 'E: another community''s treasurer cannot record for this community''s household, even naming their own community (42501)');
select pg_temp.assert_state($$select app.record_offline_payment_once('key-108-z002', '10800000-0000-4000-8000-0000000000c1', '10800000-0000-4000-8000-000000000201', 1000, 'cash', current_date - 1, '[]'::jsonb, false, null, null, null)$$,
  '42501', 'E: ... nor naming this community (42501)');
select pg_temp.as_user(:tara);
select pg_temp.assert_raises($$select app.record_offline_payment_once('key-108-t0c1', '10800000-0000-4000-8000-0000000000d1', '10800000-0000-4000-8000-000000000201', 1000, 'cash', current_date - 1, '[]'::jsonb, false, null, null, null)$$,
  'different community', 'E: a household of one community cannot be recorded into while working in another, even by someone who may record in both');
select pg_temp.as_user(:pa);
select pg_temp.assert_raises($$select app.record_offline_payment_once('key-108-p0c1', '10800000-0000-4000-8000-0000000000d1', '10800000-0000-4000-8000-000000000201', 1000, 'cash', current_date - 1, '[]'::jsonb, false, null, null, null)$$,
  'different community', 'E: a platform admin is held to the same rule (the household is this community''s, the work is in another)');
select pg_temp.assert_raises($$select app.record_offline_payment_once('key-108-p0c2', null, '10800000-0000-4000-8000-000000000201', 1000, 'cash', current_date - 1, '[]'::jsonb, false, null, null, null)$$,
  'different community', 'E: ... and a call that names no community records nothing');
select pg_temp.as_user(:tara);
select pg_temp.assert_state($$select app.record_offline_payment_once('key-108-t001', '10800000-0000-4000-8000-0000000000c1', '10800000-0000-4000-8000-0000000009ff', 1000, 'cash', current_date - 1, '[]'::jsonb, false, null, null, null)$$,
  'P0002', 'F: a household that does not exist is refused');
select pg_temp.assert_raises($$select app.record_offline_payment_once('short', '10800000-0000-4000-8000-0000000000c1', '10800000-0000-4000-8000-000000000201', 1000, 'cash', current_date - 1, '[]'::jsonb, false, null, null, null)$$,
  'confirmation key', 'F: a missing or short key is refused: a payment cannot be recorded without one');
select pg_temp.assert_raises($$select app.record_offline_payment_once(null, '10800000-0000-4000-8000-0000000000c1', '10800000-0000-4000-8000-000000000201', 1000, 'cash', current_date - 1, '[]'::jsonb, false, null, null, null)$$,
  'confirmation key', 'F: ... and a null key');
select pg_temp.assert_raises($$select app.record_offline_payment_once('key-108-t002', '10800000-0000-4000-8000-0000000000c1', '10800000-0000-4000-8000-000000000201', 0, 'cash', current_date - 1, '[]'::jsonb, false, null, null, null)$$,
  'greater than zero', 'F: an amount of zero is refused');
select pg_temp.assert_raises($$select app.record_offline_payment_once('key-108-t003', '10800000-0000-4000-8000-0000000000c1', '10800000-0000-4000-8000-000000000201', -100, 'cash', current_date - 1, '[]'::jsonb, false, null, null, null)$$,
  'greater than zero', 'F: a negative amount is refused');
select pg_temp.assert_raises($$select app.record_offline_payment_once('key-108-t004', '10800000-0000-4000-8000-0000000000c1', '10800000-0000-4000-8000-000000000201', 1000, 'card', current_date - 1, '[]'::jsonb, false, null, null, null)$$,
  'check, cash, ACH, Zelle or stock', 'F: a card is taken through the payment provider, not recorded by hand');
select pg_temp.assert_raises($$select app.record_offline_payment_once('key-108-t005', '10800000-0000-4000-8000-0000000000c1', '10800000-0000-4000-8000-000000000201', 1000, 'cash', current_date + 2, '[]'::jsonb, false, null, null, null)$$,
  'not in the future', 'F: a date in the future is refused');
select pg_temp.assert_raises($$select app.record_offline_payment_once('key-108-t006', '10800000-0000-4000-8000-0000000000c1', '10800000-0000-4000-8000-000000000201', 1000, 'cash', null, '[]'::jsonb, false, null, null, null)$$,
  'received date', 'F: a missing date is refused');
select pg_temp.assert_raises($$select app.record_offline_payment_once('key-108-t007', '10800000-0000-4000-8000-0000000000c1', '10800000-0000-4000-8000-000000000201', 1000, 'cash', current_date - 1, '{"a":1}'::jsonb, false, null, null, null)$$,
  'must be a list', 'F: pledges that are not a list are refused');
reset role;
select pg_temp.assert((select count(*) from app.payments where center_id = :c) = :before_refusals
                      and (select count(*) from app.payment_allocations where center_id = :c) = :allocs_before_refusals,
  'E/F: none of the refusals recorded or applied anything');
select pg_temp.assert(exists (select 1 from pg_constraint where conname = 'payments_idempotency_key_len'), 'F: the key length is also a table constraint');

-- ═════════════════════════════════════════════════════════════════════════════
-- K. Exactly the pledges on the card; a pledge that changed; never above what is open; locks
-- ═════════════════════════════════════════════════════════════════════════════
-- State now: pl1 paid in full, pl2 paid in full (100 + 200 of 300), pl3 $50 of $100 paid, plo and phi untouched.
select pg_temp.assert((select status from app.pledges where id = :pl2) = 'paid' and (select paid_cents from app.pledges where id = :pl3) = 5000,
  'K: (setup) the pledges are where earlier steps left them');
set local role authenticated;
select pg_temp.as_user(:tara);
select pg_temp.assert_raises($$select app.record_offline_payment_once('key-108-k001', '10800000-0000-4000-8000-0000000000c1', '10800000-0000-4000-8000-000000000202', 3000, 'cash', current_date - 1, jsonb_build_array(pg_temp.line('10800000-0000-4000-8000-000000000303', 3000, 10000, 0)), false, null, null, null)$$,
  'changed since you saw the card', 'K: a pledge that was paid in part since the card was made (the card said nothing was paid) is refused');
select pg_temp.assert_raises($$select app.record_offline_payment_once('key-108-k002', '10800000-0000-4000-8000-0000000000c1', '10800000-0000-4000-8000-000000000202', 3000, 'cash', current_date - 1, jsonb_build_array(pg_temp.line('10800000-0000-4000-8000-000000000303', 3000, 12000, 5000)), false, null, null, null)$$,
  'changed since you saw the card', 'K: ... or whose amount changed');
select pg_temp.assert_raises($$select app.record_offline_payment_once('key-108-k003', '10800000-0000-4000-8000-0000000000c1', '10800000-0000-4000-8000-000000000201', 3000, 'cash', current_date - 1, jsonb_build_array(pg_temp.line('10800000-0000-4000-8000-000000000301', 3000, 50000, 0)), false, null, null, null)$$,
  'changed since you saw the card', 'K: ... or that has since been paid in full');
select pg_temp.assert_raises($$select app.record_offline_payment_once('key-108-k004', '10800000-0000-4000-8000-0000000000c1', '10800000-0000-4000-8000-000000000202', 9000, 'cash', current_date - 1, jsonb_build_array(pg_temp.line('10800000-0000-4000-8000-000000000303', 6000, 10000, 5000)), false, null, null, null)$$,
  'cannot take that amount', 'K: it never puts more on a pledge than is open ($50 open, $60 asked)');
select pg_temp.assert_raises($$select app.record_offline_payment_once('key-108-k005', '10800000-0000-4000-8000-0000000000c1', '10800000-0000-4000-8000-000000000202', 4000, 'cash', current_date - 1, jsonb_build_array(pg_temp.line('10800000-0000-4000-8000-000000000303', 3000, 10000, 5000), pg_temp.line('10800000-0000-4000-8000-000000000303', 2000, 10000, 5000)), false, null, null, null)$$,
  'twice', 'K: the same pledge twice on a card is refused');
select pg_temp.assert_raises($$select app.record_offline_payment_once('key-108-k006', '10800000-0000-4000-8000-0000000000c1', '10800000-0000-4000-8000-000000000202', 1000, 'cash', current_date - 1, jsonb_build_array(pg_temp.line('10800000-0000-4000-8000-000000000303', 3000, 10000, 5000)), false, null, null, null)$$,
  'add up to more than the payment', 'K: amounts that add up to more than the payment are refused');
select pg_temp.assert_raises($$select app.record_offline_payment_once('key-108-k007', '10800000-0000-4000-8000-0000000000c1', '10800000-0000-4000-8000-000000000202', 1000, 'cash', current_date - 1, jsonb_build_array(pg_temp.line('10800000-0000-4000-8000-000000000302', 1000, 30000, 0)), false, null, null, null)$$,
  'no longer one of this household', 'K: a pledge of another household on the card is refused');
reset role;
select pg_temp.assert((select count(*) from app.payments where center_id = :c) = :before_refusals, 'K: every one of those left nothing behind (no payment without its allocations)');
-- Pledges made at the same moment: the database applies the one the card named, not "the earliest".
set local role authenticated;
select pg_temp.as_user(:tara);
select app.record_offline_payment_once('key-108-k100', :c, :h4, 10000, 'check', :'today'::date, jsonb_build_array(pg_temp.line(:phi, 10000, 30000, 0)), false, '5001', null, null)::text as r6 \gset
reset role;
select pg_temp.assert((select paid_cents from app.pledges where id = :phi) = 10000 and (select paid_cents from app.pledges where id = :plo) = 0
                      and (select pledged_at from app.pledges where id = :plo) = (select pledged_at from app.pledges where id = :phi),
  'K: two pledges made at the same moment: exactly the one on the card is paid, whatever order the database would have picked');
select pg_temp.assert(pg_get_functiondef('app.record_offline_payment_once(text, uuid, uuid, bigint, app.payment_method, date, jsonb, boolean, text, text, text)'::regprocedure) ilike '%for update%',
  'K: the function locks the pledges (FOR UPDATE) before it reads what is paid');
select pg_temp.assert(pg_get_functiondef('app.record_offline_payment_once(text, uuid, uuid, bigint, app.payment_method, date, jsonb, boolean, text, text, text)'::regprocedure) not ilike '%allocate_payment%',
  'K: ... and it does not use the order-guessing app.allocate_payment (that stays as it is for the screen)');
select pg_temp.assert(not exists (select 1 from app.pledges where paid_cents > amount_cents), 'K: no pledge anywhere is paid above its amount');

-- ═════════════════════════════════════════════════════════════════════════════
-- G. Nothing is left behind when a step fails (one call = one transaction)
-- ═════════════════════════════════════════════════════════════════════════════
create function public.g108_boom() returns trigger language plpgsql as $$ begin raise exception 'g108 boom: applying failed'; end $$;
create trigger g108_boom before insert on app.payment_allocations for each row execute function public.g108_boom();
set local role authenticated;
select pg_temp.as_user(:tara);
select pg_temp.assert_raises($$select app.record_offline_payment_once('key-108-boom0001', '10800000-0000-4000-8000-0000000000c1', '10800000-0000-4000-8000-000000000202', 1000, 'cash', current_date - 1, jsonb_build_array(pg_temp.line('10800000-0000-4000-8000-000000000303', 1000, 10000, 5000)), false, null, null, null)$$,
  'g108 boom', 'G: applying to pledges fails');
reset role;
drop trigger g108_boom on app.payment_allocations;
drop function public.g108_boom();
select pg_temp.assert(not exists (select 1 from app.payments where idempotency_key = 'key-108-boom0001'),
  'G: ... and then the payment does not exist either: it is all or nothing, never a payment without its allocation');
set local role authenticated;
select pg_temp.as_user(:tara);
select app.record_offline_payment_once('key-108-boom0001', :c, :h2, 1000, 'cash', :'today'::date, jsonb_build_array(pg_temp.line(:pl3, 1000, 10000, 5000)), false, null, null, null)::text as r7 \gset
reset role;
select pg_temp.assert(((:'r7'::jsonb)->>'replayed')::boolean = false, 'G: after the problem is gone the same key records normally (a failed try did not use it up)');

-- ═════════════════════════════════════════════════════════════════════════════
-- H. Two confirmations racing: the other one wins between the lookup and the insert
-- ═════════════════════════════════════════════════════════════════════════════
-- A trigger stands in for the other confirmation: just before this one's row goes in, the competing payment with the same key is
-- inserted (as it would be by a second session). The insert then meets the key; it must turn into a repeat, not an error and not a second payment.
create function public.g108_race() returns trigger language plpgsql as $$
begin
  if new.idempotency_key = 'key-108-race0001' and pg_trigger_depth() = 1 then
    insert into app.payments (center_id, household_id, amount_cents, method, status, provider, received_on, recorded_by, idempotency_key)
      values (new.center_id, new.household_id, new.amount_cents, new.method, 'captured', 'offline', new.received_on, new.recorded_by, new.idempotency_key);
  end if;
  return new;
end $$;
create trigger g108_race before insert on app.payments for each row execute function public.g108_race();
set local role authenticated;
select pg_temp.as_user(:tara);
select app.record_offline_payment_once('key-108-race0001', :c, :h2, 700, 'cash', :'today'::date, jsonb_build_array(pg_temp.line(:pl3, 700, 10000, 6000)), false, null, null, null)::text as r8 \gset
reset role;
drop trigger g108_race on app.payments;
drop function public.g108_race();
select pg_temp.assert(((:'r8'::jsonb)->>'replayed')::boolean and (select count(*) from app.payments where idempotency_key = 'key-108-race0001') = 1,
  'H: when the other confirmation won the race, this one is a repeat: one payment with that key, not two and not an error');
select pg_temp.assert((select count(*) from app.payment_allocations where payment_id = ((:'r8'::jsonb)->>'payment_id')::uuid) = 0 and (select paid_cents from app.pledges where id = :pl3) = 6000,
  'H: ... and it applied nothing a second time');

-- ═════════════════════════════════════════════════════════════════════════════
-- I. Keys belong to a community
-- ═════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user(:zed);
select app.record_offline_payment_once('key-108-0001', :d, :h3, 1000, 'cash', :'today'::date, '[]'::jsonb, false, null, null, null)::text as r9 \gset
reset role;
select pg_temp.assert(((:'r9'::jsonb)->>'replayed')::boolean = false and ((:'r9'::jsonb)->>'payment_id') <> :'p1',
  'I: another community can use the same key text: it records its own payment');
do $$ begin
  insert into app.payments (center_id, household_id, amount_cents, method, provider, received_on, idempotency_key)
  values ('10800000-0000-4000-8000-0000000000c1', '10800000-0000-4000-8000-000000000201', 100, 'cash', 'offline', current_date, 'key-108-0001');
  raise exception 'FAIL: the table accepted a second payment with the same key';
exception when unique_violation then raise notice 'PASS: I: the table itself refuses a second payment with the same key in a community';
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- J. Dates are the community's own day, and a stored day stays valid
-- ═════════════════════════════════════════════════════════════════════════════
-- A community 14 hours ahead of UTC: its today can be tomorrow in UTC. The day the card stored is accepted; the next day is not.
update app.centers set time_zone = 'Pacific/Kiritimati' where id = :c;
select (now() at time zone 'Pacific/Kiritimati')::date as kdate \gset
set local role authenticated;
select pg_temp.as_user(:tara);
select app.record_offline_payment_once('key-108-j0001', :c, :h2, 300, 'cash', :'kdate'::date, '[]'::jsonb, false, null, null, null)::text as r10 \gset
select pg_temp.assert_raises(format($q$select app.record_offline_payment_once('key-108-j0002', '10800000-0000-4000-8000-0000000000c1', '10800000-0000-4000-8000-000000000202', 300, 'cash', %L::date + 1, '[]'::jsonb, false, null, null, null)$q$, :'kdate'),
  'not in the future', 'J: the community''s own tomorrow is still the future');
reset role;
select pg_temp.assert(((:'r10'::jsonb)->>'replayed')::boolean = false and (select received_on from app.payments where id = ((:'r10'::jsonb)->>'payment_id')::uuid) = :'kdate'::date,
  'J: the community''s own today is accepted even when it is already tomorrow in UTC');
update app.centers set time_zone = 'America/Chicago' where id = :c;
-- The day is an input, never "now": a day that was on the card and is now in the past is recorded as given.
set local role authenticated;
select pg_temp.as_user(:tara);
select app.record_offline_payment_once('key-108-j0003', :c, :h2, 300, 'cash', :'today'::date - 3, '[]'::jsonb, false, null, null, null)::text as r11 \gset
reset role;
select pg_temp.assert((select received_on from app.payments where id = ((:'r11'::jsonb)->>'payment_id')::uuid) = :'today'::date - 3, 'J: an earlier day is recorded as given');

-- ═════════════════════════════════════════════════════════════════════════════
-- L. "Was a payment like this just confirmed?"
-- ═════════════════════════════════════════════════════════════════════════════
insert into app.assistant_proposals (id, center_id, actor_user_id, command_key, input, input_hash, status, expires_at, confirmed_at) values
  ('10800000-0000-4000-8000-000000000b01', :c, :tara, 'giving.record_payment', jsonb_build_object('household_id', '10800000-0000-4000-8000-000000000201', 'amount_cents', 77700), repeat('a', 64), 'confirmed', now() + interval '10 minutes', now() - interval '5 minutes'),
  ('10800000-0000-4000-8000-000000000b02', :c, :tara, 'giving.record_payment', jsonb_build_object('household_id', '10800000-0000-4000-8000-000000000201', 'amount_cents', 11100), repeat('b', 64), 'confirmed', now() + interval '10 minutes', now() - interval '45 minutes'),
  ('10800000-0000-4000-8000-000000000b03', :c, :tara, 'giving.record_payment', jsonb_build_object('household_id', '10800000-0000-4000-8000-000000000201', 'amount_cents', 22200), repeat('c', 64), 'proposed', now() + interval '10 minutes', null),
  ('10800000-0000-4000-8000-000000000b04', :c, :vina, 'giving.record_payment', jsonb_build_object('household_id', '10800000-0000-4000-8000-000000000201', 'amount_cents', 33300), repeat('d', 64), 'confirmed', now() + interval '10 minutes', now() - interval '2 minutes');
insert into app.assistant_proposals (id, center_id, actor_user_id, command_key, input, input_hash, status, expires_at, confirmed_at, finished_at) values
  ('10800000-0000-4000-8000-000000000b05', :c, :tara, 'giving.record_payment', jsonb_build_object('household_id', '10800000-0000-4000-8000-000000000201', 'amount_cents', 44400), repeat('e', 64), 'executed', now() + interval '10 minutes', now() - interval '3 minutes', now() - interval '2 minutes');
set local role authenticated;
select pg_temp.as_user(:tara);
select app.record_offline_payment_once('proposal:10800000-0000-4000-8000-000000000b99', :c, :h1, 31100, 'cash', :'today'::date, '[]'::jsonb, false, null, null, null)::text as r12 \gset
select app.giving_payment_confirm_guard(:h1, 77700)::text as g_unfinished \gset
select app.giving_payment_confirm_guard(:h1, 11100)::text as g_old \gset
select app.giving_payment_confirm_guard(:h1, 22200)::text as g_proposed \gset
select app.giving_payment_confirm_guard(:h1, 33300)::text as g_other_actor \gset
select app.giving_payment_confirm_guard(:h1, 44400)::text as g_executed \gset
select app.giving_payment_confirm_guard(:h1, 31100)::text as g_recorded \gset
select app.giving_payment_confirm_guard(:h1, 31101)::text as g_other_amount \gset
select app.giving_payment_confirm_guard(:h2, 31100)::text as g_other_household \gset
reset role;
update app.payments set created_at = now() - interval '45 minutes' where id = ((:'r12'::jsonb)->>'payment_id')::uuid;
set local role authenticated;
select pg_temp.as_user(:tara);
select app.giving_payment_confirm_guard(:h1, 31100)::text as g_recorded_old \gset
select app.giving_payment_confirm_guard(:h1, 31100, 60)::text as g_recorded_wide \gset
reset role;
select pg_temp.assert(((:'g_unfinished'::jsonb)->>'unfinished')::int = 1, 'L: a confirmation of this command for this household and amount in the last 30 minutes that never finished is found');
select pg_temp.assert(((:'g_old'::jsonb)->>'unfinished')::int = 0, 'L: ... but not one confirmed 45 minutes ago');
select pg_temp.assert(((:'g_proposed'::jsonb)->>'unfinished')::int = 0, 'L: ... nor one still waiting for its button (it was never confirmed)');
select pg_temp.assert(((:'g_other_actor'::jsonb)->>'unfinished')::int = 0, 'L: ... nor someone else''s confirmation (row-level security: you see your own)');
select pg_temp.assert(((:'g_executed'::jsonb)->>'unfinished')::int = 0, 'L: ... nor one that finished (its payment is looked for below)');
select pg_temp.assert(((:'g_recorded'::jsonb)->>'recorded')::int = 1, 'L: a payment recorded by a confirmation in the last 30 minutes for this household and amount is found');
select pg_temp.assert(((:'g_other_amount'::jsonb)->>'recorded')::int = 0 and ((:'g_other_household'::jsonb)->>'recorded')::int = 0, 'L: ... only for this household and this amount');
select pg_temp.assert(((:'g_recorded_old'::jsonb)->>'recorded')::int = 0 and ((:'g_recorded_wide'::jsonb)->>'recorded')::int = 1, 'L: ... within the window, which can be widened');

-- ═════════════════════════════════════════════════════════════════════════════
-- M. Looking at a deposit first (security invoker)
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
select pg_temp.as_user(:vina);
select coalesce(app.giving_deposit_context(:line, array[:'p1'::uuid, ((:'r5'::jsonb)->>'payment_id')::uuid])::text, 'null') as dep_vina \gset
select pg_temp.as_user(:mira);
select coalesce(app.giving_deposit_context(:line, array[:'p1'::uuid])::text, 'null') as dep_mira \gset
select pg_temp.as_user(:zed);
select coalesce(app.giving_deposit_context(:line, array[:'p1'::uuid])::text, 'null') as dep_zed \gset
reset role;

select pg_temp.assert(((:'dep_ok'::jsonb)->>'total_cents')::bigint = 85000 and ((:'dep_ok'::jsonb)->>'difference_cents')::bigint = 0
                      and jsonb_array_length((:'dep_ok'::jsonb)->'payments') = 2 and jsonb_array_length((:'dep_ok'::jsonb)->'missing_ids') = 0
                      and not exists (select 1 from jsonb_array_elements((:'dep_ok'::jsonb)->'payments') p where not (p->>'can_match')::boolean),
  'M: the chosen payments add up to the deposit to the cent, and every one can be matched');
select pg_temp.assert(((:'dep_ok'::jsonb)->'bank_line'->>'amount_cents')::bigint = 85000 and ((:'dep_ok'::jsonb)->'bank_line'->>'status') = 'unmatched'
                      and ((:'dep_ok'::jsonb)->'bank_line'->>'center_id') = '10800000-0000-4000-8000-0000000000c1',
  'M: the bank line is described, with the community it belongs to');
select pg_temp.assert(((:'dep_short'::jsonb)->>'difference_cents')::bigint = 25000, 'M: the difference says how much is missing (positive) or over (negative)');
select pg_temp.assert(jsonb_array_length((:'dep_missing'::jsonb)->'missing_ids') = 1 and ((:'dep_missing'::jsonb)->'missing_ids'->>0) = '10800000-0000-4000-8000-0000000009ff',
  'M: a payment that is not found is listed, not silently skipped');
select pg_temp.assert(not ((select p->>'can_match' from jsonb_array_elements((:'dep_blocked'::jsonb)->'payments') p where p->>'id' = '10800000-0000-4000-8000-000000000491')::boolean)
                      and ((select p->>'already_deposited' from jsonb_array_elements((:'dep_blocked'::jsonb)->'payments') p where p->>'id' = '10800000-0000-4000-8000-000000000492')::boolean),
  'M: a card payment cannot be matched by hand, and a payment already on a deposit says so');
select pg_temp.assert(:'dep_noline' = 'null', 'M: a bank line that does not exist gives null');
select pg_temp.assert(:'dep_vina' = 'null' or ((:'dep_vina'::jsonb)->'missing_ids') @> to_jsonb(:'p1'::text),
  'M: a finance volunteer does not see the treasurer''s payment (it is listed as not found)');
select pg_temp.assert(:'dep_mira' = 'null' and :'dep_zed' = 'null', 'M: a family member and another community''s treasurer do not see the bank line at all');
select pg_temp.assert((select bool_and(p.provolatile = 's' and not p.prosecdef) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname in ('giving_deposit_context', 'giving_payment_confirm_guard')), 'M: the deposit look-up and the repeat guard are stable and security invoker (they only read)');
select pg_temp.assert((select count(*) from app.bank_transactions where center_id = :c and status = 'matched') = 1, 'M: looking changed nothing: still one matched line');
select pg_temp.assert(not has_function_privilege('anon', 'app.record_offline_payment_once(text, uuid, uuid, bigint, app.payment_method, date, jsonb, boolean, text, text, text)', 'execute')
                      and has_function_privilege('authenticated', 'app.record_offline_payment_once(text, uuid, uuid, bigint, app.payment_method, date, jsonb, boolean, text, text, text)', 'execute')
                      and not has_function_privilege('anon', 'app.giving_deposit_context(uuid, uuid[])', 'execute')
                      and not has_function_privilege('anon', 'app.giving_payment_confirm_guard(uuid, bigint, integer)', 'execute'),
  'M: signed-out visitors cannot call these functions');

rollback;
