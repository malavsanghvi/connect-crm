-- 0656 and 0657 (BACKLOG B90 phase 4, B83): the Giving summary reads.
--   A. Who is behind on pledges: the rule (past due, or 30 days after it was made), ranking, age buckets, one fund, the limit
--   B. One household's giving: what counts (opening balances and failed payments do not), years, open pledges
--   C. Bank lines nobody has matched    D. Zelle reports waiting for the bank
--   E. Waiting for a second approver (refunds and write-offs)    F. Funds and the QuickBooks mapping
--   G. What a prepared payment looks at: open pledges in order, locked month, likely duplicates
--   H. Row-level security decides what comes back (security invoker): a volunteer, a family member and another community
--   I. Nothing here writes (the functions are stable) and nobody outside the signed-in roles can call them
-- Everything runs in its own community (G107) and its own transactions; the dates are fixed ("today" is passed in) except for
-- the Zelle reports, which the database checks against the real day.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2',
    'amr', json_build_array(json_build_object('method','totp','timestamp',extract(epoch from now())::bigint)))::text, true);
  perform set_config('request.headers', '{"x-client-app":"portal","x-client-screen":"/giving/payments"}', true);
end $$;

\set c '''10700000-0000-4000-8000-0000000000c1'''
\set d '''10700000-0000-4000-8000-0000000000d1'''
\set tara '''10700000-0000-4000-8000-0000000000a1'''
\set vina '''10700000-0000-4000-8000-0000000000a2'''
\set mira '''10700000-0000-4000-8000-0000000000a3'''
\set zed '''10700000-0000-4000-8000-0000000000a4'''
\set h1 '''10700000-0000-4000-8000-000000000201'''
\set h2 '''10700000-0000-4000-8000-000000000202'''
\set h3 '''10700000-0000-4000-8000-000000000203'''
\set pl1 '''10700000-0000-4000-8000-000000000301'''
\set pl2 '''10700000-0000-4000-8000-000000000302'''
\set pl5 '''10700000-0000-4000-8000-000000000305'''
\set pay1 '''10700000-0000-4000-8000-000000000401'''
\set f1 '''10700000-0000-4000-8000-000000000501'''
\set ba '''10700000-0000-4000-8000-000000000701'''
\set nobody '''10700000-0000-4000-8000-0000000009ff'''

-- One transaction for the whole test, rolled back at the end, so nothing it creates (a report past its window, say) is
-- seen by the tests that run after it.
begin;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into app.centers (id, slug, name, short_name, time_zone) values
  (:c, 'g107-temple', 'G107 Jain Temple', 'G107', 'America/Chicago'),
  (:d, 'g107-other', 'G107 Other Temple', 'G107B', 'America/Chicago');
insert into auth.users (id, email) values
  (:tara, 'tara@g107.test'), (:vina, 'vina@g107.test'), (:mira, 'mira@g107.test'), (:zed, 'zed@g107.test');
insert into app.people (id, center_id, first_name, last_name, email, date_of_birth) values
  ('10700000-0000-4000-8000-000000000101', :c, 'Rahul', 'Shah', null, '1980-04-02'),
  ('10700000-0000-4000-8000-000000000102', :c, 'Mira', 'Shah', 'mira@g107.test', '1982-06-11'),
  ('10700000-0000-4000-8000-000000000103', :c, 'Kavi', 'Shah', null, current_date - interval '14 years'),
  ('10700000-0000-4000-8000-000000000104', :c, 'Kiran', 'Mehta', null, '1970-01-01'),
  ('10700000-0000-4000-8000-000000000105', :c, 'Tara', 'Treasurer', 'tara@g107.test', '1975-01-01'),
  ('10700000-0000-4000-8000-000000000106', :c, 'Vina', 'Volunteer', 'vina@g107.test', '1990-01-01'),
  ('10700000-0000-4000-8000-000000000108', :d, 'Zed', 'Other', 'zed@g107.test', '1975-01-01');
insert into app.households (id, center_id, display_name) values (:h1, :c, 'Shah family'), (:h2, :c, 'Mehta family'), (:h3, :d, 'Other family');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, '10700000-0000-4000-8000-000000000101', :c, 'primary', true),
  (:h1, '10700000-0000-4000-8000-000000000102', :c, 'spouse', false),
  (:h1, '10700000-0000-4000-8000-000000000103', :c, 'child', false),
  (:h2, '10700000-0000-4000-8000-000000000104', :c, 'primary', true);
insert into app.center_users (center_id, user_id, person_id, is_default) values
  (:c, :tara, '10700000-0000-4000-8000-000000000105', false),
  (:c, :vina, '10700000-0000-4000-8000-000000000106', false),
  (:c, :mira, '10700000-0000-4000-8000-000000000102', false),
  (:d, :zed, '10700000-0000-4000-8000-000000000108', false);
insert into app.role_grants (center_id, user_id, role_key) values (:c, :tara, 'treasurer'), (:c, :vina, 'finance_volunteer'), (:d, :zed, 'treasurer');
insert into app.funds (id, center_id, key, name, restricted) values
  (:f1, :c, 'g107-building', 'G107 Building fund', true),
  ('10700000-0000-4000-8000-000000000502', :c, 'g107-food', 'G107 Food bank', false);
insert into app.campaigns (id, center_id, name, kind, status) values ('10700000-0000-4000-8000-000000000601', :c, 'Paryushan 107', 'general', 'draft');

-- Pledges, as of 2026-10-10:
--   pl1  H1 $500, due 2026-06-30, will be $250 paid        -> $250 open, 102 days late
--   pl2  H2 $45, no due date, made 2026-08-20              -> due 2026-09-19 (30 days after), 21 days late
--   pl3  H1 $200, due 2026-12-01                           -> not late
--   pl4  H1 cancelled                                      -> never counted
--   pl5  H1 $100 to the Building fund, due 2026-09-01      -> 39 days late
--   pl6  another community, $999.99 long overdue           -> never counted for G107
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, source, amount_cents, pledged_at, due_on, status, fund_id, campaign_id) values
  (:pl1, :c, :h1, '10700000-0000-4000-8000-000000000101', 'general', 50000, timestamptz '2026-01-10 12:00:00+00', date '2026-06-30', 'open', null, '10700000-0000-4000-8000-000000000601'),
  (:pl2, :c, :h2, '10700000-0000-4000-8000-000000000104', 'general', 4500, timestamptz '2026-08-20 12:00:00+00', null, 'open', null, null),
  ('10700000-0000-4000-8000-000000000303', :c, :h1, '10700000-0000-4000-8000-000000000101', 'general', 20000, timestamptz '2026-10-01 12:00:00+00', date '2026-12-01', 'open', null, null),
  ('10700000-0000-4000-8000-000000000304', :c, :h1, '10700000-0000-4000-8000-000000000101', 'general', 5000, timestamptz '2026-02-01 12:00:00+00', date '2026-03-01', 'cancelled', null, null),
  (:pl5, :c, :h1, '10700000-0000-4000-8000-000000000101', 'general', 10000, timestamptz '2026-03-01 12:00:00+00', date '2026-09-01', 'open', :f1, null),
  ('10700000-0000-4000-8000-000000000306', :d, :h3, null, 'general', 99999, timestamptz '2025-01-01 12:00:00+00', date '2025-02-01', 'open', null, null);

-- Payments of H1 (the first is applied to pl1, so pl1 is partly paid), one of H2, and one the volunteer recorded.
insert into app.payments (id, center_id, household_id, amount_cents, method, status, provider, received_on, recorded_by, check_number, refunded_cents, is_historical, is_opening_balance) values
  (:pay1, :c, :h1, 25000, 'check', 'captured', 'offline', date '2026-09-14', :tara, '1043', 0, false, false),
  ('10700000-0000-4000-8000-000000000402', :c, :h1, 10000, 'zelle', 'captured', 'offline', date '2025-12-20', :tara, null, 0, false, false),
  ('10700000-0000-4000-8000-000000000403', :c, :h1, 3000, 'ach', 'partially_refunded', 'offline', date '2025-11-01', :tara, null, 1000, false, false),
  ('10700000-0000-4000-8000-000000000404', :c, :h1, 9999, 'check', 'failed', 'offline', date '2026-09-01', :tara, null, 0, false, false),
  ('10700000-0000-4000-8000-000000000405', :c, :h1, 77700, 'other', 'captured', 'offline', date '2020-01-01', :tara, null, 0, true, true),
  ('10700000-0000-4000-8000-000000000406', :c, :h1, 7000, 'cash', 'captured', 'offline', date '2026-10-02', :vina, null, 0, false, false),
  ('10700000-0000-4000-8000-000000000407', :c, :h2, 5500, 'check', 'captured', 'offline', date '2026-09-20', :tara, '2002', 0, false, false);
insert into app.payment_allocations (center_id, payment_id, pledge_id, amount_cents) values (:c, :pay1, :pl1, 25000);

-- A month that is locked, bank lines, and a Zelle account.
insert into app.accounting_periods (center_id, period_month, status) values (:c, date '2026-09-01', 'closed');
insert into app.bank_accounts (id, center_id, name, institution, last4, statement_format) values (:ba, :c, 'Chase operating', 'Chase', '1070', 'chase_csv');
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description, bank_type, status, is_batch_deposit, channel) values
  ('10700000-0000-4000-8000-000000000801', :c, :ba, date '2026-09-20', 25000, 'Zelle Payment From Rahul Shah Wfct0h7k2m1q', 'QUICKPAY_CREDIT', 'unmatched', false, null),
  ('10700000-0000-4000-8000-000000000802', :c, :ba, date '2026-10-05', 5000, 'Zelle Payment From Kiran Mehta Wfct0h7k2m9z', 'QUICKPAY_CREDIT', 'suggested', false, null),
  ('10700000-0000-4000-8000-000000000803', :c, :ba, date '2026-10-01', 51000, 'Deposit', null, 'unmatched', true, 'cash_deposit'),
  ('10700000-0000-4000-8000-000000000804', :c, :ba, date '2026-10-02', -12000, 'Electric bill', null, 'unmatched', false, 'other'),
  ('10700000-0000-4000-8000-000000000805', :c, :ba, date '2026-10-03', 3000, 'Zelle Payment From Somebody Ignored', 'QUICKPAY_CREDIT', 'ignored', false, null),
  ('10700000-0000-4000-8000-000000000806', :c, :ba, date '2026-10-04', 8000, 'Stripe payout', null, 'payout', false, 'card_payout');
insert into app.center_payment_methods (center_id, method, accepted, instructions, sort) values
  (:c, 'zelle', false, '{"recipient":"give@g107.test","name":"G107 Jain Temple","memo_hint":"Your member number"}', 3);
update app.center_payment_methods set accepted = true where center_id = :c and method = 'zelle';
select (now() at time zone 'America/Chicago')::date as today \gset

-- Two Zelle reports from a member of H1: one sent 2 days ago, one 12 days ago (past the 10-day window).
set local role authenticated;
select pg_temp.as_user(:mira);
select (app.report_payment(:c, :h1, 'zelle', 25100, :'today'::date - 2, null, null, null, null))->>'report_id' as rep1 \gset
select (app.report_payment(:c, :h1, 'zelle', 10800, :'today'::date - 12, null, null, null, null))->>'report_id' as rep2 \gset
reset role;

-- A refund asked for on pay1 and a write-off asked for on pl2, both by the treasurer (a second person has not approved).
set local role authenticated;
select pg_temp.as_user(:tara);
update app.payments set refund_approved_by = :tara, refund_reason = 'Duplicate check', refund_requested_cents = 10000 where id = :pay1;
update app.pledges set written_off_by = :tara, write_off_reason = 'Moved away' where id = :pl2;
reset role;

-- ═════════════════════════════════════════════════════════════════════════════
-- What each person gets (the answers are kept in psql variables, then checked below)
-- ═════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user(:tara);
select app.giving_pledges_behind(:c, date '2026-10-10')::text as behind \gset
select app.giving_pledges_behind(:c, date '2026-10-10', 1, 10, :f1)::text as behind_fund \gset
select app.giving_pledges_behind(:c, date '2026-10-10', 30, 10, null)::text as behind_30 \gset
select app.giving_pledges_behind(:c, date '2026-10-10', 1, 1, null)::text as behind_limit1 \gset
select app.giving_pledges_behind(:c, date '2027-10-10')::text as behind_later \gset
select app.giving_household_summary(:h1, date '2026-10-10')::text as sum_h1 \gset
select app.giving_household_summary(:h2, date '2026-10-10')::text as sum_h2 \gset
select coalesce(app.giving_household_summary(:nobody, date '2026-10-10')::text, 'null') as sum_nobody \gset
select app.giving_unmatched_bank_lines(:c, 10, date '2026-10-10')::text as bank \gset
select app.giving_unmatched_bank_lines(:c, 2, date '2026-10-10')::text as bank2 \gset
select app.giving_zelle_waiting(:c, 10, :'today'::date)::text as zelle \gset
select app.giving_second_approver_queue(:c)::text as queue \gset
select app.giving_fund_mapping_status(:c)::text as mapping \gset
select app.giving_draft_context(:h1, 25000, 'check', '1043', date '2026-09-16')::text as ctx_dup \gset
select app.giving_draft_context(:h1, 999, 'cash', null, date '2026-09-14')::text as ctx_closed \gset
select app.giving_draft_context(:h1, 1, 'check', '2002', date '2026-10-04')::text as ctx_elsewhere \gset
select app.giving_draft_context(:h1, 1, 'check', '9999', date '2026-10-04')::text as ctx_clean \gset
select app.giving_draft_context(:h2, 1, 'check', null, date '2026-10-04')::text as ctx_h2 \gset
select coalesce(app.giving_draft_context(:nobody, 1, 'check', null, date '2026-10-04')::text, 'null') as ctx_nobody \gset
reset role;

set local role authenticated;
select pg_temp.as_user(:vina);
select app.giving_pledges_behind(:c, date '2026-10-10')::text as v_behind \gset
select coalesce(app.giving_household_summary(:h1, date '2026-10-10')::text, 'null') as v_sum \gset
select app.giving_second_approver_queue(:c)::text as v_queue \gset
select coalesce(app.giving_draft_context(:h1, 25000, 'check', '1043', date '2026-09-14')::text, 'null') as v_ctx \gset
reset role;

set local role authenticated;
select pg_temp.as_user(:mira);
select coalesce(app.giving_household_summary(:h1, date '2026-10-10')::text, 'null') as m_sum_h1 \gset
select coalesce(app.giving_household_summary(:h2, date '2026-10-10')::text, 'null') as m_sum_h2 \gset
select app.giving_pledges_behind(:c, date '2026-10-10')::text as m_behind \gset
select app.giving_unmatched_bank_lines(:c, 10, date '2026-10-10')::text as m_bank \gset
select app.giving_second_approver_queue(:c)::text as m_queue \gset
reset role;

set local role authenticated;
select pg_temp.as_user(:zed);
select app.giving_pledges_behind(:c, date '2026-10-10')::text as z_behind \gset
select app.giving_pledges_behind(:d, date '2026-10-10')::text as z_own \gset
select coalesce(app.giving_household_summary(:h1, date '2026-10-10')::text, 'null') as z_sum \gset
select app.giving_unmatched_bank_lines(:c, 10, date '2026-10-10')::text as z_bank \gset
select app.giving_zelle_waiting(:c, 10, :'today'::date)::text as z_zelle \gset
select app.giving_second_approver_queue(:c)::text as z_queue \gset
select app.giving_fund_mapping_status(:c)::text as z_mapping \gset
reset role;

-- ═════════════════════════════════════════════════════════════════════════════
-- A. Who is behind on pledges
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert(((:'behind'::jsonb)->>'as_of') = '2026-10-10', 'A: it reports the day it was asked about');
select pg_temp.assert(((:'behind'::jsonb)->>'households_behind')::int = 2 and ((:'behind'::jsonb)->>'pledges_behind')::int = 3,
  'A: two households and three pledges are behind (paid, cancelled, not-yet-due and other-community pledges are left out)');
select pg_temp.assert(((:'behind'::jsonb)->>'total_open_cents')::bigint = 39500, 'A: the open balance is whole cents: 25000 + 10000 + 4500');
select pg_temp.assert(((:'behind'::jsonb)->'rows'->0->>'household_id') = '10700000-0000-4000-8000-000000000201'
                      and ((:'behind'::jsonb)->'rows'->0->>'open_cents')::bigint = 35000
                      and ((:'behind'::jsonb)->'rows'->0->>'pledges_behind')::int = 2
                      and ((:'behind'::jsonb)->'rows'->0->>'oldest_days_overdue')::int = 102,
  'A: the household with the biggest unpaid balance comes first, with its oldest overdue days (due date)');
select pg_temp.assert(((:'behind'::jsonb)->'rows'->1->>'household_id') = '10700000-0000-4000-8000-000000000202'
                      and ((:'behind'::jsonb)->'rows'->1->>'oldest_days_overdue')::int = 21,
  'A: a pledge with no due date counts as due 30 days after it was made');
select pg_temp.assert(((:'behind'::jsonb)->'by_age'->0->>'bucket') = '1 to 30 days' and ((:'behind'::jsonb)->'by_age'->0->>'open_cents')::bigint = 4500
                      and ((:'behind'::jsonb)->'by_age'->1->>'bucket') = '31 to 60 days' and ((:'behind'::jsonb)->'by_age'->1->>'open_cents')::bigint = 10000
                      and ((:'behind'::jsonb)->'by_age'->2->>'bucket') = 'Over 90 days' and ((:'behind'::jsonb)->'by_age'->2->>'open_cents')::bigint = 25000
                      and jsonb_array_length((:'behind'::jsonb)->'by_age') = 3,
  'A: late pledges are grouped by age (1-30, 31-60, over 90 here; empty groups are left out)');
select pg_temp.assert(((:'behind_fund'::jsonb)->>'households_behind')::int = 1 and ((:'behind_fund'::jsonb)->>'total_open_cents')::bigint = 10000,
  'A: limited to one fund, only that fund''s pledges count');
select pg_temp.assert(((:'behind_30'::jsonb)->>'households_behind')::int = 1 and ((:'behind_30'::jsonb)->>'pledges_behind')::int = 2,
  'A: "at least 30 days late" leaves out the pledge that is 21 days late');
select pg_temp.assert(jsonb_array_length((:'behind_limit1'::jsonb)->'rows') = 1 and ((:'behind_limit1'::jsonb)->>'households_behind')::int = 2,
  'A: the limit shortens the list but not the totals');
select pg_temp.assert(((:'behind_later'::jsonb)->>'pledges_behind')::int = 4,
  'A: asked about a later day, the pledge that was not yet due is late too (the day is a parameter, so answers are repeatable)');

-- ═════════════════════════════════════════════════════════════════════════════
-- B. One household's giving
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert(((:'sum_h1'::jsonb)->'lifetime'->>'payments')::int = 4 and ((:'sum_h1'::jsonb)->'lifetime'->>'received_cents')::bigint = 45000
                      and ((:'sum_h1'::jsonb)->'lifetime'->>'refunded_cents')::bigint = 1000,
  'B: lifetime counts four payments and 450.00 received; the failed payment and the opening balance are left out');
select pg_temp.assert(((:'sum_h1'::jsonb)->'lifetime'->>'first_gift_on') = '2025-11-01' and ((:'sum_h1'::jsonb)->'lifetime'->>'last_gift_on') = '2026-10-02',
  'B: first and last gift dates');
select pg_temp.assert(jsonb_array_length((:'sum_h1'::jsonb)->'years') = 2
                      and ((:'sum_h1'::jsonb)->'years'->0->>'year')::int = 2026 and ((:'sum_h1'::jsonb)->'years'->0->>'received_cents')::bigint = 32000
                      and ((:'sum_h1'::jsonb)->'years'->1->>'year')::int = 2025 and ((:'sum_h1'::jsonb)->'years'->1->>'received_cents')::bigint = 13000
                      and ((:'sum_h1'::jsonb)->'years'->1->>'refunded_cents')::bigint = 1000,
  'B: year by year, newest first, refunds apart');
select pg_temp.assert(jsonb_array_length((:'sum_h1'::jsonb)->'recent_payments') = 4
                      and ((:'sum_h1'::jsonb)->'recent_payments'->0->>'received_on') = '2026-10-02'
                      and ((:'sum_h1'::jsonb)->'recent_payments'->1->>'received_on') = '2026-09-14',
  'B: recent payments are newest first');
select pg_temp.assert(((:'sum_h1'::jsonb)->>'open_pledge_count')::int = 3 and ((:'sum_h1'::jsonb)->>'open_cents')::bigint = 55000
                      and ((:'sum_h1'::jsonb)->>'behind_cents')::bigint = 35000,
  'B: three open pledges, 550.00 still owed, 350.00 of it late (the partly paid pledge counts only what is left)');
select pg_temp.assert(((:'sum_h1'::jsonb)->'open_pledges'->0->>'open_cents')::bigint = 25000 and ((:'sum_h1'::jsonb)->'open_pledges'->0->>'days_overdue')::int = 102
                      and ((:'sum_h1'::jsonb)->'open_pledges'->0->>'campaign') = 'Paryushan 107'
                      and ((:'sum_h1'::jsonb)->'open_pledges'->1->>'fund') = 'G107 Building fund'
                      and ((:'sum_h1'::jsonb)->'open_pledges'->2->>'days_overdue')::int = 0,
  'B: open pledges are oldest first with campaign, fund and days late (never negative)');
select pg_temp.assert(((:'sum_h1'::jsonb)->>'recurring_active')::int = 0, 'B: no recurring gift');
select pg_temp.assert(((:'sum_h2'::jsonb)->'lifetime'->>'payments')::int = 1 and ((:'sum_h2'::jsonb)->>'open_cents')::bigint = 4500,
  'B: another household has its own numbers');
select pg_temp.assert(:'sum_nobody' = 'null', 'B: a household that does not exist (or is not visible) gives null, not zeros');

-- ═════════════════════════════════════════════════════════════════════════════
-- C. Bank lines nobody has matched
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert(((:'bank'::jsonb)->>'gifts')::int = 2 and ((:'bank'::jsonb)->>'gifts_cents')::bigint = 30000
                      and ((:'bank'::jsonb)->>'deposits')::int = 1 and ((:'bank'::jsonb)->>'deposits_cents')::bigint = 51000,
  'C: two gifts (one only suggested) and one batch deposit are waiting; ignored and matched lines are not');
select pg_temp.assert(((:'bank'::jsonb)->>'debits')::int = 1 and ((:'bank'::jsonb)->>'payouts')::int = 1, 'C: money out and card payouts are counted, not listed');
select pg_temp.assert(((:'bank'::jsonb)->>'oldest_posted_on') = '2026-09-20' and ((:'bank'::jsonb)->>'oldest_days')::int = 20, 'C: the oldest waiting line and its age');
select pg_temp.assert(jsonb_array_length((:'bank'::jsonb)->'lines') = 3
                      and ((:'bank'::jsonb)->'lines'->0->>'kind') = 'gift' and ((:'bank'::jsonb)->'lines'->0->>'posted_on') = '2026-09-20'
                      and ((:'bank'::jsonb)->'lines'->1->>'kind') = 'deposit'
                      and ((:'bank'::jsonb)->'lines'->2->>'status') = 'suggested'
                      and ((:'bank'::jsonb)->'lines'->0->>'account') = 'Chase operating',
  'C: lines are listed oldest first with kind, status and the bank account');
select pg_temp.assert(jsonb_array_length((:'bank2'::jsonb)->'lines') = 2 and ((:'bank2'::jsonb)->>'gifts')::int = 2, 'C: the limit shortens the list but not the counts');

-- ═════════════════════════════════════════════════════════════════════════════
-- D. Zelle reports waiting
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert(((:'zelle'::jsonb)->>'reported')::int = 2 and ((:'zelle'::jsonb)->>'unmatched')::int = 0
                      and ((:'zelle'::jsonb)->>'total_cents')::bigint = 35900,
  'D: two reports are waiting, 359.00 in all');
select pg_temp.assert(((:'zelle'::jsonb)->>'past_window')::int = 1, 'D: one is past the report window');
select pg_temp.assert(((:'zelle'::jsonb)->'reports'->0->>'id') = :'rep2' and ((:'zelle'::jsonb)->'reports'->0->>'days_waiting')::int = 12
                      and ((:'zelle'::jsonb)->'reports'->0->>'past_window')::boolean
                      and ((:'zelle'::jsonb)->'reports'->1->>'id') = :'rep1' and ((:'zelle'::jsonb)->'reports'->1->>'days_waiting')::int = 2
                      and not ((:'zelle'::jsonb)->'reports'->1->>'past_window')::boolean,
  'D: oldest first, with how long each has waited');
select pg_temp.assert(((:'zelle'::jsonb)->'reports'->0->>'household_id') = '10700000-0000-4000-8000-000000000201'
                      and not ((:'zelle'::jsonb)->'reports'->0->>'has_confirmation')::boolean
                      and not (((:'zelle'::jsonb)->'reports'->0) ? 'confirmation'),
  'D: the household is named by id only, and the confirmation number itself is never returned');

-- ═════════════════════════════════════════════════════════════════════════════
-- E. Waiting for a second approver
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert(((:'queue'::jsonb)->>'refund_count')::int = 1 and ((:'queue'::jsonb)->'refunds'->0->>'payment_id') = '10700000-0000-4000-8000-000000000401'
                      and ((:'queue'::jsonb)->'refunds'->0->>'requested_cents')::bigint = 10000
                      and ((:'queue'::jsonb)->'refunds'->0->>'payment_amount_cents')::bigint = 25000
                      and ((:'queue'::jsonb)->'refunds'->0->>'reason') = 'Duplicate check'
                      and ((:'queue'::jsonb)->'refunds'->0->>'requested_by') = '10700000-0000-4000-8000-0000000000a1'
                      and not ((:'queue'::jsonb)->'refunds'->0->>'matched_to_deposit')::boolean,
  'E: the refund waiting for a second approver, with the evidence: amounts, who asked, why');
select pg_temp.assert(((:'queue'::jsonb)->>'write_off_count')::int = 1 and ((:'queue'::jsonb)->'write_offs'->0->>'pledge_id') = '10700000-0000-4000-8000-000000000302'
                      and ((:'queue'::jsonb)->'write_offs'->0->>'open_cents')::bigint = 4500
                      and ((:'queue'::jsonb)->'write_offs'->0->>'reason') = 'Moved away',
  'E: the write-off waiting for a second approver');
select pg_temp.assert(jsonb_typeof((:'queue'::jsonb)->'provider_refunds') = 'array' and ((:'queue'::jsonb)->>'provider_refund_count')::int = 0,
  'E: refunds made in Stripe or PayPal come as a list (none here)');

-- ═════════════════════════════════════════════════════════════════════════════
-- F. Funds and the QuickBooks mapping
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert((:'mapping'::jsonb->'missing_purposes') @> '["income.general"]'::jsonb and ((:'mapping'::jsonb)->>'mapped_count')::int = 0,
  'F: nothing is mapped, so the required income account is missing');
select pg_temp.assert((:'mapping'::jsonb->'funds_without_class') @> '[{"name":"G107 Building fund","restricted":true}]'::jsonb,
  'F: funds with no QuickBooks class are listed');

-- ═════════════════════════════════════════════════════════════════════════════
-- G. What a prepared payment looks at
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert(jsonb_array_length((:'ctx_dup'::jsonb)->'open_pledges') = 3
                      and ((:'ctx_dup'::jsonb)->'open_pledges'->0->>'id') = '10700000-0000-4000-8000-000000000301'
                      and ((:'ctx_dup'::jsonb)->'open_pledges'->1->>'id') = '10700000-0000-4000-8000-000000000305'
                      and ((:'ctx_dup'::jsonb)->'open_pledges'->2->>'id') = '10700000-0000-4000-8000-000000000303'
                      and ((:'ctx_dup'::jsonb)->'open_pledges'->0->>'paid_cents')::bigint = 25000
                      and ((:'ctx_dup'::jsonb)->'open_pledges'->0->>'status') = 'partially_paid',
  'G: open pledges come in the allocation order (earliest first), the cancelled one left out, with what is already paid');
select pg_temp.assert(jsonb_array_length((:'ctx_dup'::jsonb)->'duplicates') = 1 and ((:'ctx_dup'::jsonb)->'duplicates'->0->>'same_check_number')::boolean,
  'G: the same check number and amount near the date is a likely duplicate');
select pg_temp.assert(jsonb_array_length((:'ctx_closed'::jsonb)->'duplicates') = 0 and ((:'ctx_closed'::jsonb)->>'month_closed')::boolean,
  'G: a different amount is not a duplicate, and a date in a locked month says so');
select pg_temp.assert(not ((:'ctx_clean'::jsonb)->>'month_closed')::boolean and jsonb_array_length((:'ctx_clean'::jsonb)->'duplicates') = 0
                      and ((:'ctx_clean'::jsonb)->>'check_number_elsewhere')::int = 0,
  'G: an ordinary payment: open month, no duplicates, check number new');
select pg_temp.assert(((:'ctx_elsewhere'::jsonb)->>'check_number_elsewhere')::int = 1 and jsonb_array_length((:'ctx_elsewhere'::jsonb)->'duplicates') = 0,
  'G: a check number already on another household''s payment is counted, with no details of that payment');
select pg_temp.assert(jsonb_array_length((:'ctx_h2'::jsonb)->'open_pledges') = 1, 'G: another household has its own pledges');
select pg_temp.assert(:'ctx_nobody' = 'null', 'G: a household that does not exist gives null');

-- ═════════════════════════════════════════════════════════════════════════════
-- H. Row-level security decides (security invoker)
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert(((:'v_behind'::jsonb)->>'households_behind')::int = 2,
  'H: a finance volunteer reads pledges (as the Pledges screen lets them), so the late list is the same');
select pg_temp.assert(:'v_sum' = 'null' or (((:'v_sum'::jsonb)->'lifetime'->>'received_cents')::bigint <= 7000),
  'H: a finance volunteer sees at most the payments they recorded themselves, never the treasurer''s');
select pg_temp.assert(((:'v_queue'::jsonb)->>'refund_count')::int = 0, 'H: a finance volunteer does not see the treasurer''s payments, so no refund waits for them');
select pg_temp.assert(:'v_ctx' = 'null' or ((:'v_ctx'::jsonb)->'duplicates') = '[]'::jsonb, 'H: a volunteer is not shown a payment they did not record as a duplicate');
select pg_temp.assert(:'m_sum_h1' <> 'null' and ((:'m_sum_h1'::jsonb)->'lifetime'->>'payments')::int = 4,
  'H: an adult of the household sees their own household''s giving');
select pg_temp.assert(:'m_sum_h2' = 'null' or (((:'m_sum_h2'::jsonb)->'lifetime'->>'payments')::int = 0 and ((:'m_sum_h2'::jsonb)->>'open_pledge_count')::int = 0),
  'H: ... and nothing of another household''s');
select pg_temp.assert(((:'m_behind'::jsonb)->>'households_behind')::int = 1 and ((:'m_behind'::jsonb)->'rows'->0->>'household_id') = '10700000-0000-4000-8000-000000000201',
  'H: a family member''s "behind on pledges" is only their own household');
select pg_temp.assert(((:'m_bank'::jsonb)->>'gifts')::int = 0 and ((:'m_bank'::jsonb)->>'deposits')::int = 0 and jsonb_array_length((:'m_bank'::jsonb)->'lines') = 0,
  'H: a family member sees no bank lines');
select pg_temp.assert(((:'m_queue'::jsonb)->>'write_off_count')::int = 0, 'H: a family member sees no write-offs waiting');
select pg_temp.assert(((:'z_behind'::jsonb)->>'households_behind')::int = 0 and ((:'z_behind'::jsonb)->>'total_open_cents')::bigint = 0,
  'H: another community''s treasurer gets nothing from this community''s pledges');
select pg_temp.assert(((:'z_own'::jsonb)->>'households_behind')::int = 1 and ((:'z_own'::jsonb)->>'total_open_cents')::bigint = 99999,
  'H: ... and their own community''s numbers, which stay out of ours');
select pg_temp.assert(:'z_sum' = 'null' or ((:'z_sum'::jsonb)->'lifetime'->>'payments')::int = 0, 'H: another community''s treasurer cannot read our household''s giving');
select pg_temp.assert(((:'z_bank'::jsonb)->>'gifts')::int = 0 and jsonb_array_length((:'z_bank'::jsonb)->'lines') = 0, 'H: nor our bank lines');
select pg_temp.assert(((:'z_zelle'::jsonb)->>'reported')::int = 0 and jsonb_array_length((:'z_zelle'::jsonb)->'reports') = 0, 'H: nor our Zelle reports');
select pg_temp.assert(((:'z_queue'::jsonb)->>'refund_count')::int = 0 and ((:'z_queue'::jsonb)->>'write_off_count')::int = 0
                      and ((:'z_queue'::jsonb)->>'provider_refund_count')::int = 0, 'H: nor our refunds and write-offs');
select pg_temp.assert(((:'z_mapping'::jsonb)->>'funds_count')::int = 0, 'H: nor our funds');

-- ═════════════════════════════════════════════════════════════════════════════
-- I. They read, never write; and who may call them
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert((select bool_and(p.provolatile in ('s', 'i') and not p.prosecdef)
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app'
                          and p.proname in ('giving_pledges_behind', 'giving_household_summary', 'giving_unmatched_bank_lines', 'giving_zelle_waiting',
                                            'giving_second_approver_queue', 'giving_fund_mapping_status', 'giving_draft_context')),
  'I: all seven are stable and security invoker');
select pg_temp.assert((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname like 'giving\_%' and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=app, public, extensions%')) >= 7,
  'I: each pins the search path to app, public, extensions');
select pg_temp.assert(not has_function_privilege('anon', 'app.giving_pledges_behind(uuid, date, integer, integer, uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.giving_household_summary(uuid, date)', 'execute')
                      and not has_function_privilege('anon', 'app.giving_second_approver_queue(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.giving_draft_context(uuid, bigint, text, text, date)', 'execute'),
  'I: signed-out visitors cannot call them; signed-in people can (and see only what row-level security lets them)');
select pg_temp.assert((select count(*) from app.payments where center_id = :c) = 7 and (select count(*) from app.pledges where center_id = :c) = 5,
  'I: reading changed nothing: no payment or pledge was added');

rollback;
