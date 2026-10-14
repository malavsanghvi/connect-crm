-- 0746: Giving › Statements in the New look (docs/GIVING_REDESIGN.md slice 8). Two read functions; nothing is written or sent.
--   A. app.year_end_review: the calendar year's totals equal app.year_end_statement's (refunds netted, opening balances,
--      failed payments and other years left out; December 31 in, January 1 out); one row per household that gave.
--   B. Adults only: a child is never listed, a child's email never counts, the community's age of majority is honoured;
--      paper asked for with a complete or an incomplete address; an app account; a household with only a child.
--   C. app.receipt_copy: the name on the receipt is left out when the payer is a child or the name holds a child's first name;
--      an opening-balance line, a payment refunded in full and one that did not go through have no receipt; the templates'
--      approval travels with it.
--   D. Who may read: giving.view or giving.manage; a member is refused; anon cannot call either function.
--   E. Statements switched off: the review refuses with the module sentence; a receipt copy still works (receipts stay core).
--   F. A non-faith community reads the same way.
-- Everything runs in one transaction that is rolled back.
\set ON_ERROR_STOP 1
begin;
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
create or replace function pg_temp.claims(p_user uuid, p_step_up boolean default false) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', case when p_step_up then 'aal2' else 'aal1' end,
    'amr', case when p_step_up
                then jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 60))
                else jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 60)) end)::text, true);
  perform set_config('request.headers', '', true);
end $$;

\set admin '''15500000-0000-4000-8000-000000000001'''
\set member '''15500000-0000-4000-8000-000000000002'''
\set second '''15500000-0000-4000-8000-000000000003'''
\set appuser '''15500000-0000-4000-8000-000000000004'''
\set npadmin '''15500000-0000-4000-8000-000000000005'''
\set jc '''15500000-0000-4000-8000-0000000000c1'''
\set np '''15500000-0000-4000-8000-0000000000c2'''
\set h1 '''15500000-0000-4000-8000-0000000000b1'''
\set h2 '''15500000-0000-4000-8000-0000000000b2'''
\set h3 '''15500000-0000-4000-8000-0000000000b3'''
\set h4 '''15500000-0000-4000-8000-0000000000b4'''
\set h5 '''15500000-0000-4000-8000-0000000000b5'''
\set h6 '''15500000-0000-4000-8000-0000000000b6'''
\set hn '''15500000-0000-4000-8000-0000000000b9'''
\set mira '''15500000-0000-4000-8000-0000000000a1'''
\set kiran '''15500000-0000-4000-8000-0000000000a2'''
\set zoya '''15500000-0000-4000-8000-0000000000a3'''
\set dev '''15500000-0000-4000-8000-0000000000a4'''
\set ravi '''15500000-0000-4000-8000-0000000000a5'''
\set sara '''15500000-0000-4000-8000-0000000000a6'''
\set arjun '''15500000-0000-4000-8000-0000000000a7'''
\set omar '''15500000-0000-4000-8000-0000000000a8'''
\set lena '''15500000-0000-4000-8000-0000000000a9'''
\set tara '''15500000-0000-4000-8000-0000000000aa'''
\set noor '''15500000-0000-4000-8000-0000000000ab'''

insert into auth.users (id, email) values
  (:admin, 'admin155@temple.test'), (:member, 'mira155@temple.test'), (:second, 'second155@temple.test'),
  (:appuser, 'sara155@temple.test'), (:npadmin, 'admin155@club.test');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:jc, 'jc155', 'Temple 155', 'T155', 'TX', 'active', 'America/Chicago');
insert into app.centers (id, slug, name, environment, category_key, status)
values (:np, 'np155-sandbox', 'Club 155', 'sandbox', 'nonprofit_secular', 'onboarding');
insert into app.role_grants (center_id, user_id, role_key, reason) values
  (:jc, :admin, 'center_admin', 'year-end review test 155'), (:jc, :second, 'treasurer', 'year-end review test 155'),
  (:np, :npadmin, 'center_admin', 'year-end review test 155');

insert into app.households (id, center_id, display_name, physical_mail_opt_in, address_line1, city, postal_code) values
  (:h1, :jc, 'Member155, Mira', null, null, null, null),
  (:h2, :jc, 'Paper155, Ravi', true, '12 Main St', 'Austin', '78701'),
  (:h3, :jc, 'App155, Sara', false, null, null, null),
  (:h4, :jc, 'Child155 household', null, null, null, null),
  (:h5, :jc, 'Nozip155, Omar', true, '9 Elm St', 'Austin', null),
  (:h6, :jc, 'Kidmail155, Lena', null, null, null, null),
  (:hn, :np, 'Club155, Noor', null, null, null, null);
insert into app.people (id, center_id, first_name, last_name, date_of_birth, email) values
  (:mira, :jc, 'Mira', 'Member155', date '1980-01-01', 'mira155@temple.test'),
  (:kiran, :jc, 'Kiran', 'Member155', date '2015-05-05', 'kiran155@temple.test'),
  (:zoya, :jc, 'Zoya', 'Member155', null, 'zoya155@temple.test'),
  (:dev, :jc, 'Dev', 'Member155', (current_date - interval '19 years')::date, null),
  (:ravi, :jc, 'Ravi', 'Paper155', date '1975-02-02', null),
  (:sara, :jc, 'Sara', 'App155', date '1990-03-03', null),
  (:arjun, :jc, 'Arjun', 'Child155', date '2014-04-04', null),
  (:omar, :jc, 'Omar', 'Nozip155', date '1985-06-06', null),
  (:lena, :jc, 'Lena', 'Kidmail155', date '1970-07-07', null),
  (:tara, :jc, 'Tara', 'Kidmail155', date '2016-08-08', 'tara155@temple.test'),
  (:noor, :np, 'Noor', 'Club155', date '1982-01-01', 'noor155@club.test');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :mira, :jc, 'primary', true), (:h1, :kiran, :jc, 'child', false), (:h1, :zoya, :jc, 'child', false),
  (:h1, :dev, :jc, 'child', false),
  (:h2, :ravi, :jc, 'primary', true), (:h3, :sara, :jc, 'primary', true), (:h4, :arjun, :jc, 'child', true),
  (:h5, :omar, :jc, 'primary', true), (:h6, :lena, :jc, 'primary', true), (:h6, :tara, :jc, 'child', false),
  (:hn, :noor, :np, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values (:jc, :member, :mira), (:jc, :appuser, :sara);

insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, received_on,
                          receipt_number, receipt_name, is_historical, is_opening_balance) values
  ('15500000-0000-4000-8000-0000000001b1', :jc, :h1, :mira, 10000, 'check', 'settled', 'offline', '2025-03-01', 'R-155-0001', 'Mira Member155', false, false),
  ('15500000-0000-4000-8000-0000000001b2', :jc, :h1, null, 50000, 'other', 'settled', 'import', '2025-01-15', null, null, true, true),
  ('15500000-0000-4000-8000-0000000001b4', :jc, :h1, :mira, 9900, 'card', 'failed', 'offline', '2025-07-01', 'R-155-0004', null, false, false),
  ('15500000-0000-4000-8000-0000000001b5', :jc, :h1, :mira, 4000, 'cash', 'captured', 'offline', '2024-12-31', 'R-155-0005', null, false, false),
  ('15500000-0000-4000-8000-0000000001b6', :jc, :h1, :kiran, 1000, 'cash', 'settled', 'offline', '2025-12-31', 'R-155-0006', 'Kiran Member155', false, false),
  ('15500000-0000-4000-8000-0000000001b7', :jc, :h1, :mira, 3000, 'cash', 'settled', 'offline', '2026-01-01', 'R-155-0007', null, false, false),
  ('15500000-0000-4000-8000-0000000001b9', :jc, :h1, :mira, 2500, 'zelle', 'settled', 'offline', '2025-09-01', 'R-155-0009', 'Mira and Kiran Member155', false, false),
  ('15500000-0000-4000-8000-0000000002b2', :jc, :h2, :ravi, 2500, 'check', 'settled', 'offline', '2025-04-01', 'R-155-0102', null, false, false),
  ('15500000-0000-4000-8000-0000000002b3', :jc, :h3, :sara, 2500, 'check', 'settled', 'offline', '2025-04-01', 'R-155-0103', null, false, false),
  ('15500000-0000-4000-8000-0000000002b4', :jc, :h4, :arjun, 2500, 'cash', 'settled', 'offline', '2025-04-01', 'R-155-0104', 'Arjun Child155', false, false),
  ('15500000-0000-4000-8000-0000000002b5', :jc, :h5, :omar, 2500, 'check', 'settled', 'offline', '2025-04-01', 'R-155-0105', null, false, false),
  ('15500000-0000-4000-8000-0000000002b6', :jc, :h6, :lena, 2500, 'check', 'settled', 'offline', '2025-04-01', 'R-155-0106', null, false, false),
  ('15500000-0000-4000-8000-0000000003b1', :np, :hn, :noor, 12000, 'card', 'settled', 'offline', '2025-05-01', 'C-155-0001', 'Noor Club155', false, false);
-- Refunds already approved by two people: b3 partly (2,000 of 7,000), b8 in full.
insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, refunded_cents, refund_approved_by, refund_second_approver,
                          method, status, provider, received_on, receipt_number) values
  ('15500000-0000-4000-8000-0000000001b3', :jc, :h1, :mira, 7000, 2000, :admin, :second, 'card', 'partially_refunded', 'offline', '2025-06-01', 'R-155-0003'),
  ('15500000-0000-4000-8000-0000000001b8', :jc, :h1, :mira, 3000, 3000, :admin, :second, 'card', 'refunded', 'offline', '2025-08-01', 'R-155-0008');

set role authenticated;
select pg_temp.claims(:admin);

-- ══ A. Totals ══════════════════════════════════════════════════════════════
select pg_temp.assert((select count(*) from app.year_end_review(:jc, 2025)) = 6,
  'A · one row per household that gave in 2025 (six households)');
select pg_temp.assert((select r.given_cents = 18500 and r.gift_count = 4 from app.year_end_review(:jc, 2025) r where r.household_id = :h1),
  'A · 10,000 + (7,000 - 2,000 refunded) + 1,000 on December 31 + 2,500 = 18,500 in four gifts');
select pg_temp.assert((select r.given_cents from app.year_end_review(:jc, 2025) r where r.household_id = :h1)
                      = (app.year_end_statement(:h1, 2025)->>'total_cents')::bigint,
  'A · the review total is the year-end statement''s total, to the cent');
select pg_temp.assert((select r.refunded_cents = 5000 and r.refunded_count = 1 from app.year_end_review(:jc, 2025) r where r.household_id = :h1),
  'A · refunds are netted (2,000 partly, 3,000 in full) and the gift refunded in full is counted apart');
select pg_temp.assert((select r.opening_balance_count = 1 and r.opening_balance_cents = 50000 from app.year_end_review(:jc, 2025) r where r.household_id = :h1),
  'A · the opening-balance line is left out of the total and reported apart');
select pg_temp.assert((select r.given_cents = 4000 and r.gift_count = 1 from app.year_end_review(:jc, 2024) r where r.household_id = :h1)
                      and (select r.given_cents = 3000 from app.year_end_review(:jc, 2026) r where r.household_id = :h1),
  'A · December 31 belongs to its year and January 1 to the next (calendar year)');
select pg_temp.assert(not exists (select 1 from app.year_end_review(:jc, 2023)),
  'A · a year without gifts has no rows');
select pg_temp.assert_raises(format($$select * from app.year_end_review(%L, 1500)$$, :jc), 'Choose a tax year', 'A · a year out of range is refused');

-- ══ B. Adults only ═════════════════════════════════════════════════════════
select pg_temp.assert((select jsonb_array_length(r.adults) = 2
                              and r.adults->0->>'name' = 'Mira Member155' and (r.adults->0->>'email')::boolean
                              and (r.adults->0->>'app')::boolean
                              and r.adults::text not like '%Kiran%' and r.adults::text not like '%Zoya%'
                         from app.year_end_review(:jc, 2025) r where r.household_id = :h1),
  'B · the adults are Mira (email, app) and Dev (19); Kiran (10) and Zoya (no birth date, a child) are never listed');
select pg_temp.assert((select jsonb_array_length(r.adults) = 1 from app.year_end_review(:jc, 2025, 21) r where r.household_id = :h1),
  'B · where the age of majority is 21, Dev (19) is not an adult');
select pg_temp.assert((select jsonb_array_length(r.adults) = 2 from app.year_end_review(:jc, 2025, 12) r where r.household_id = :h1),
  'B · a majority below 18 is raised to 18 (Kiran stays a child)');
select pg_temp.assert((select r.mail_opt_in and r.address_complete and not (r.adults->0->>'email')::boolean
                         from app.year_end_review(:jc, 2025) r where r.household_id = :h2),
  'B · Ravi asked for paper and his address is complete');
select pg_temp.assert((select (r.adults->0->>'app')::boolean and not (r.adults->0->>'email')::boolean
                         from app.year_end_review(:jc, 2025) r where r.household_id = :h3),
  'B · Sara has the app and no email');
select pg_temp.assert((select r.adults = '[]'::jsonb and r.given_cents = 2500 from app.year_end_review(:jc, 2025) r where r.household_id = :h4),
  'B · a household with only a child lists no adult (the statement has no one to be addressed to)');
select pg_temp.assert((select r.mail_opt_in and not r.address_complete from app.year_end_review(:jc, 2025) r where r.household_id = :h5),
  'B · Omar asked for paper but his address has no postal code');
select pg_temp.assert((select jsonb_array_length(r.adults) = 1 and not (r.adults->0->>'email')::boolean and r.adults::text not like '%Tara%'
                         from app.year_end_review(:jc, 2025) r where r.household_id = :h6),
  'B · a child''s email never counts: Lena''s household has no email to send to');
select pg_temp.assert(not exists (select 1 from app.year_end_review(:jc, 2025) r where r::text like '%155@temple.test%'),
  'B · no email address leaves the database');

-- ══ C. A copy of one receipt ═══════════════════════════════════════════════
select pg_temp.assert((select c->>'receipt_name' = 'Mira Member155' and not (c->>'receipt_name_hidden')::boolean
                              and (c->>'payer_is_adult')::boolean and c->>'receipt_number' = 'R-155-0001'
                              and (c->>'amount_cents')::bigint = 10000 and c->'household'->>'name' = 'Member155, Mira'
                              and c->'templates' ? 'ok' and not (c->'templates'->>'ok')::boolean
                         from app.receipt_copy('15500000-0000-4000-8000-0000000001b1') c),
  'C · an adult''s receipt keeps the name on it, and says the templates are not approved yet');
select pg_temp.assert((select c->'receipt_name' = 'null'::jsonb and (c->>'receipt_name_hidden')::boolean
                              and not (c->>'payer_is_adult')::boolean and c::text not like '%Kiran%'
                         from app.receipt_copy('15500000-0000-4000-8000-0000000001b6') c),
  'C · a child paid: the child''s name is left out and the copy is addressed to the adults');
select pg_temp.assert((select (c->>'receipt_name_hidden')::boolean and c::text not like '%Kiran%'
                         from app.receipt_copy('15500000-0000-4000-8000-0000000001b9') c),
  'C · a receipt name that holds a child''s first name is left out');
select pg_temp.assert((select (c->>'receipt_name_hidden')::boolean and c->'adults' = '[]'::jsonb and c::text not like '%Arjun%'
                         from app.receipt_copy('15500000-0000-4000-8000-0000000002b4') c),
  'C · a household with only a child: no name at all on the copy');
select pg_temp.assert((select (c->>'refunded_cents')::bigint = 2000 and (c->>'amount_cents')::bigint = 7000
                         from app.receipt_copy('15500000-0000-4000-8000-0000000001b3') c),
  'C · a partly refunded gift shows its refund');
select pg_temp.assert_raises($$select app.receipt_copy('15500000-0000-4000-8000-0000000001b2')$$, 'opening-balance line never gets a receipt',
  'C · an opening-balance line has no receipt');
select pg_temp.assert_raises($$select app.receipt_copy('15500000-0000-4000-8000-0000000001b8')$$, 'refunded in full',
  'C · a gift refunded in full has no receipt');
select pg_temp.assert_raises($$select app.receipt_copy('15500000-0000-4000-8000-0000000001b4')$$, 'did not go through',
  'C · a failed payment has no receipt');

-- ══ D. Who may read ════════════════════════════════════════════════════════
select pg_temp.claims(:second);
select pg_temp.assert((select count(*) from app.year_end_review(:jc, 2025)) = 6, 'D · the treasurer (giving.manage) reads the review');
select pg_temp.claims(:member);
select pg_temp.assert_raises(format($$select * from app.year_end_review(%L, 2025)$$, :jc), 'needs giving.view or giving.manage',
  'D · a member is refused the review');
select pg_temp.assert_raises($$select app.receipt_copy('15500000-0000-4000-8000-0000000001b1')$$, 'needs giving.view or giving.manage',
  'D · a member is refused a receipt copy');
reset role;
select pg_temp.assert(not has_function_privilege('anon', 'app.year_end_review(uuid, int, int)', 'execute')
                      and not has_function_privilege('anon', 'app.receipt_copy(uuid, int)', 'execute')
                      and not has_function_privilege('authenticated', 'app._statement_adult(date, app.person_role_in_household, int)', 'execute'),
  'D · anon cannot call either function; the adult rule is internal');

-- ══ E. Statements switched off ═════════════════════════════════════════════
savepoint statements_off;
set role authenticated;
select pg_temp.claims(:admin, true);
select app.set_module_enabled(:jc, 'giving_statements', false, 'Test 155: statements come from the accountant');
select pg_temp.assert_raises(format($$select * from app.year_end_review(%L, 2025)$$, :jc), 'Statements module is switched off',
  'E · the review refuses with the module sentence');
select pg_temp.assert((select c->>'receipt_number' = 'R-155-0001' from app.receipt_copy('15500000-0000-4000-8000-0000000001b1') c),
  'E · a receipt copy still works: receipts stay core');
rollback to savepoint statements_off;

-- ══ F. A non-faith community ═══════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:npadmin);
select pg_temp.assert((select r.given_cents = 12000 and r.adults->0->>'name' = 'Noor Club155' and (r.adults->0->>'email')::boolean
                         from app.year_end_review(:np, 2025) r where r.household_id = :hn),
  'F · a non-faith community: the same totals and the same adults-only addressing');
select pg_temp.assert((select c->>'receipt_name' = 'Noor Club155' from app.receipt_copy('15500000-0000-4000-8000-0000000003b1') c),
  'F · and the same receipt copy');
select pg_temp.assert_raises(format($$select * from app.year_end_review(%L, 2025)$$, :jc), 'needs giving.view or giving.manage',
  'F · one community''s admin cannot read another''s review');
reset role;

rollback;
