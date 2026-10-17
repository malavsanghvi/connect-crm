-- 0925 (CatchTheMatch Phase 1, piece 3, slice 4, docs/CATCH_THE_MATCH.md section 13): the match arrives in Giving.
--   A. Structure: the table is private and only the function writes; the helper is not callable.
--   B. Recording: who may (matching.manage AND giving.record_offline), what is checked (cents, day, claim state, ten times the gift, once),
--      what is created (one offline matching_gift payment for the donor's household, not applied, not credit, no receipt number), the claim received.
--   C. What the donor's paperwork shows: the year-end statement lists it apart and leaves it out of the total; the employer's name only to the
--      household and CatchTheMatch readers; the year-end review leaves it out; no receipt copy; household credit leaves it out; it is not a gift that
--      can itself be matched.
--   D. Claims: a claim with a payment cannot be moved off received; the list says it was recorded and shows the amount only with giving access.
--   E. The Bank tab: the existing engine proposes the payment for an incoming line of the same amount, and attaching reconciles it.
--   F. The donor's thank-you: DonorDelight's gift list (what opens its thank-you steps) includes the payment.
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
create or replace function pg_temp.claims(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('request.headers', '', true);
end $$;
create or replace function pg_temp.today() returns date language sql as $$ select (now() at time zone 'America/Chicago')::date $$;
create or replace function pg_temp.pay() returns setof app.payments language sql security definer as $$ select * from app.payments $$;
create or replace function pg_temp.mpay() returns setof app.match_payments language sql security definer as $$ select * from app.match_payments $$;
create or replace function pg_temp.mc() returns setof app.match_claims language sql security definer as $$ select * from app.match_claims $$;

\set c1 '''92500000-0000-4000-8000-0000000000c1'''
\set c2 '''92500000-0000-4000-8000-0000000000c2'''
\set owner '''92500000-0000-4000-8000-000000000001'''
\set plat '''92500000-0000-4000-8000-000000000002'''
\set lead '''92500000-0000-4000-8000-000000000003'''
\set clerk '''92500000-0000-4000-8000-000000000004'''
\set both '''92500000-0000-4000-8000-000000000005'''
\set tara '''92500000-0000-4000-8000-000000000006'''
\set gview '''92500000-0000-4000-8000-000000000007'''
\set ubo '''92500000-0000-4000-8000-000000000008'''
\set ha '''92500000-0000-4000-8000-0000000000b1'''
\set hb '''92500000-0000-4000-8000-0000000000b2'''
\set hz '''92500000-0000-4000-8000-0000000000b3'''
\set h2 '''92500000-0000-4000-8000-0000000000b4'''
\set pa '''92500000-0000-4000-8000-0000000000a1'''
\set pb '''92500000-0000-4000-8000-0000000000a2'''
\set p2 '''92500000-0000-4000-8000-0000000000a3'''
\set ga1 '''92500000-0000-4000-8000-00000000f001'''
\set gb1 '''92500000-0000-4000-8000-00000000f002'''
\set gb2 '''92500000-0000-4000-8000-00000000f003'''
\set g21 '''92500000-0000-4000-8000-00000000f004'''
\set acct '''92500000-0000-4000-8000-0000000003b1'''
\set l1 '''92500000-0000-4000-8000-0000000004a1'''

-- ══ A. Structure ═════════════════════════════════════════════════════════════
select pg_temp.assert((select relrowsecurity from pg_class where oid = 'app.match_payments'::regclass)
                      and not has_table_privilege('authenticated', 'app.match_payments', 'insert')
                      and not has_table_privilege('authenticated', 'app.match_payments', 'update')
                      and not has_table_privilege('authenticated', 'app.match_payments', 'delete')
                      and not has_table_privilege('anon', 'app.match_payments', 'select')
                      and not has_function_privilege('authenticated', 'app._is_match_payment(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.record_match_payment(uuid, uuid, bigint, date, text)', 'execute')
                      and not has_function_privilege('anon', 'app.record_match_payment(uuid, uuid, bigint, date, text)', 'execute')
                      and (select module_key from app.module_tables where table_name = 'match_payments') = 'matching',
  'A · the link table is private, only the function writes, the helper is not callable, and it belongs to CatchTheMatch');

-- ══ Fixtures ═════════════════════════════════════════════════════════════════
insert into auth.users (id, email) values
  (:owner, 'owner925@c1.test'), (:plat, 'plat925@weaver.test'), (:lead, 'lead925@c1.test'), (:clerk, 'clerk925@c1.test'), (:both, 'both925@c1.test'),
  (:tara, 'tara925@c1.test'), (:gview, 'gview925@c1.test'), (:ubo, 'bo925@c1.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone, category_key, environment, currency) values
  (:c1, 'ctm925a', 'Grace Church 925', 'G925', 'TX', 'active', 'America/Chicago', 'church', 'sandbox', 'USD'),
  (:c2, 'ctm925b', 'Second Church 925', 'S925', 'TX', 'active', 'America/Chicago', 'church', 'sandbox', 'USD');
insert into app.center_owners (center_id, user_id) values (:c1, :owner);
insert into app.center_module_grants (center_id, module_key, granted, reason, granted_at) values
  (:c1, 'matching', true, 'Test 925', now()), (:c1, 'giving', true, 'Test 925', now()), (:c1, 'giving_bank', true, 'Test 925', now()),
  (:c1, 'giving_statements', true, 'Test 925', now()), (:c2, 'matching', true, 'Test 925', now()), (:c2, 'giving', true, 'Test 925', now())
  on conflict (center_id, module_key) do update set granted = true;
insert into app.roles (key, tier, name, default_scope, description, permissions) values
  ('giving_clerk925', 'center', 'Giving clerk 925', 'center', 'Test 925: giving.record_offline only', '["giving.record_offline"]'),
  ('giving_viewer925', 'center', 'Giving viewer 925', 'center', 'Test 925: giving.view only', '["giving.view"]');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:c1, :plat, 'platform_owner', 'platform', 'Test 925: the platform owner role (holds "*")'),
  (:c1, :lead, 'matching_lead', 'center', 'Test 925'), (:c1, :clerk, 'giving_clerk925', 'center', 'Test 925'),
  (:c1, :both, 'matching_lead', 'center', 'Test 925'), (:c1, :both, 'giving_clerk925', 'center', 'Test 925'),
  (:c1, :tara, 'treasurer', 'center', 'Test 925'), (:c1, :tara, 'matching_lead', 'center', 'Test 925'),
  (:c1, :gview, 'giving_viewer925', 'center', 'Test 925');
insert into app.households (id, center_id, display_name) values
  (:ha, :c1, 'Alpha925, Ana'), (:hb, :c1, 'Bravo925, Bo'), (:hz, :c1, 'Zulu925, Zed'), (:h2, :c2, 'Other925, Oz');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (:pa, :c1, 'Ana', 'Alpha925', date '1980-01-01'), (:pb, :c1, 'Bo', 'Bravo925', date '1975-02-02'), (:p2, :c2, 'Oz', 'Other925', date '1980-01-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:ha, :pa, :c1, 'primary', true), (:hb, :pb, :c1, 'primary', true), (:h2, :p2, :c2, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values (:c1, :ubo, :pb);
create or replace function pg_temp.gift(p_id uuid, p_center uuid, p_h uuid, p_person uuid, p_cents int, p_days int) returns void language sql as $$
  insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, received_on, created_at,
                            receipt_number, is_opening_balance, is_historical, refunded_cents)
  values (p_id, p_center, p_h, p_person, p_cents, 'check', 'captured', 'offline', pg_temp.today() - p_days,
          now() - make_interval(days => p_days), 'R-925-' || right(p_id::text, 4), false, false, 0)
$$;
select pg_temp.gift(:ga1, :c1, :ha, :pa, 10000, 60), pg_temp.gift(:gb1, :c1, :hb, :pb, 20000, 10), pg_temp.gift(:gb2, :c1, :hb, :pb, 3000, 5),
       pg_temp.gift(:g21, :c2, :h2, :p2, 30000, 30);

set role authenticated;
select pg_temp.claims(:plat);
select app.save_match_program(null,
  '{"company_name": "Acme925", "names": ["Acme925 Corp"], "country": "US", "match_ratio_bp": 10000, "min_gift_cents": 2500,
    "portal": "benevity", "deadline_kind": "months_after_gift", "deadline_months": 6, "source": "employer_site"}'::jsonb, 'Test 925: Acme') as acme \gset
select pg_temp.claims(:lead);
select app.record_match_employer(:c1, :pa, 'Acme925 Corp');
select app.record_match_employer(:c1, :pb, 'Acme925 Corp');
select app.link_match_program(:c1, :pa, :'acme');
select app.link_match_program(:c1, :pb, :'acme');
select app.record_match_claim(:c1, :pa, :ga1, 'received', null, 'Benevity paid the first match');
select app.ask_match_claims(:c1, :pb, :'acme');
reset role;
select id as cl_gb1 from app.match_claims where payment_id = :gb1 \gset
select id as cl_gb2 from app.match_claims where payment_id = :gb2 \gset
select id as cl_ga1 from app.match_claims where payment_id = :ga1 \gset

-- ══ B. Recording ═════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:lead);
select pg_temp.assert_raises(format('select app.record_match_payment(%L, %L, 20000)', :c1, :'cl_gb1'), 'giving.record_offline',
  'B · a CatchTheMatch manager without a giving permission cannot move money');
select pg_temp.claims(:clerk);
select pg_temp.assert_raises(format('select app.record_match_payment(%L, %L, 20000)', :c1, :'cl_gb1'), 'don''t have access',
  'B · nor can a giving clerk without CatchTheMatch');
select pg_temp.claims(:plat);
select pg_temp.assert_raises(format('select app.record_match_payment(%L, %L, 20000)', :c1, :'cl_gb1'), 'don''t have access', 'B · nor Weaver''s team');
select pg_temp.claims(:both);
select pg_temp.assert_raises(format('select app.record_match_payment(%L, %L, 0)', :c1, :'cl_gb1'), 'greater than zero', 'B · an amount above zero');
select pg_temp.assert_raises(format('select app.record_match_payment(%L, %L, 20000, %L)', :c1, :'cl_gb1', (pg_temp.today() + 2)::text), 'in the future', 'B · not in the future');
select pg_temp.assert_raises(format('select app.record_match_payment(%L, %L, 40000)', :c1, :'cl_gb2'), 'more than ten times', 'B · more than ten times the gift is a typing slip, refused');
select pg_temp.assert_raises(format('select app.record_match_payment(%L, %L, 2000)', :c2, :'cl_gb1'), 'don''t have access', 'B · nor in another community');
reset role;
-- Receipt emails are on: an ordinary payment queues one; the employer's match must not.
insert into app.email_automations (center_id, kind, trigger_key, template_key, enabled) values (:c1, 'trigger', 'payment_receipt', 'payment_receipt', true);
select count(*) as jobs0 from app.jobs where kind = 'messaging.compose' \gset
select pg_temp.gift('92500000-0000-4000-8000-00000000f0b1', :c1, :ha, :pa, 1000, 1);
select count(*) as jobs1 from app.jobs where kind = 'messaging.compose' \gset
set role authenticated;
select pg_temp.claims(:both);
select app.record_match_payment(:c1, :'cl_gb1'::uuid, 20000, pg_temp.today() - 1, 'Benevity batch 4410') as rp \gset
reset role;
select count(*) as jobs2 from app.jobs where kind = 'messaging.compose' \gset
select pg_temp.assert(:jobs1 = :jobs0 + 1 and :jobs2 = :jobs1, 'B · an ordinary payment queues a receipt email; the employer''s match queues none');
set role authenticated;
select pg_temp.claims(:both);
select pg_temp.assert((:'rp'::jsonb ->> 'amount_cents') = '20000' and (:'rp'::jsonb ->> 'household_id') = :hb,
  'B · a manager with both permissions records the match');
reset role;
select pg_temp.assert((select count(*) from pg_temp.pay() where id = (:'rp'::jsonb ->> 'payment_id')::uuid and method = 'matching_gift' and provider = 'offline'
                          and status = 'captured' and amount_cents = 20000 and household_id = :hb and payer_person_id is null and receipt_number is not null
                          and receipt_sent_at is null and received_on = pg_temp.today() - 1 and idempotency_key = 'match:' || :'cl_gb1' and recorded_by = :both
                          and memo = 'Employer matching gift · Benevity batch 4410') = 1,
  'B · one offline matching_gift payment for the donor''s household: whole cents, the day given, a reference number but no receipt sent, no payer person, recorded by the manager; the employer''s name is not in the memo');
select pg_temp.assert((select count(*) from pg_temp.mpay() where claim_id = :'cl_gb1' and person_id = :pb and household_id = :hb and employer_name = 'Acme925') = 1
                      and (select state from pg_temp.mc() where id = :'cl_gb1') = 'received'
                      and (select received_on from pg_temp.mc() where id = :'cl_gb1') = pg_temp.today() - 1
                      and (select count(*) from app.payment_allocations where payment_id = (:'rp'::jsonb ->> 'payment_id')::uuid) = 0,
  'B · the link names the claim, the donor, the household and the employer; the claim is received on that day; the payment is applied to no pledge');
set role authenticated;
select pg_temp.claims(:both);
select pg_temp.assert_raises(format('select app.record_match_payment(%L, %L, 20000)', :c1, :'cl_gb1'), 'already recorded', 'B · a match is recorded once');
select pg_temp.claims(:lead);
select app.set_match_claim_state(:c1, :'cl_gb2'::uuid, 'declined', 'The employer excluded this gift');
select pg_temp.claims(:both);
select pg_temp.assert_raises(format('select app.record_match_payment(%L, %L, 2000)', :c1, :'cl_gb2'), 'ended without a match', 'B · a claim that ended without a match is opened again first');
select pg_temp.claims(:lead);
select app.set_match_claim_state(:c1, :'cl_gb2'::uuid, 'asked');
reset role;
-- A claim marked received by hand (the Phase 1 way, no amount) can still be given its payment.
set role authenticated;
select pg_temp.claims(:both);
select app.record_match_payment(:c1, :'cl_ga1'::uuid, 10000, pg_temp.today() - 2) as rp2 \gset
reset role;
select pg_temp.assert((select received_on from pg_temp.mc() where id = :'cl_ga1') = pg_temp.today() and (select household_id from pg_temp.pay() where id = (:'rp2'::jsonb ->> 'payment_id')::uuid) = :ha,
  'B · a claim the office had already marked received keeps its day and gets its payment');

-- ══ C. What the donor''s paperwork shows ═════════════════════════════════════
set role authenticated;
select pg_temp.claims(:ubo);
select app.year_end_statement(:hb, extract(year from pg_temp.today() - 1)::int) as st \gset
select pg_temp.assert((:'st'::jsonb ->> 'gift_count') = '2' and (:'st'::jsonb ->> 'total_cents') = '23000' and jsonb_array_length(:'st'::jsonb -> 'lines') = 2
                      and not ((:'st'::jsonb -> 'lines')::text like '%' || (:'rp'::jsonb ->> 'payment_id') || '%'),
  'C · the donor''s year-end statement counts only the donor''s own gifts: two gifts, $230.00, the match is not a line and not in the total');
select pg_temp.assert(jsonb_array_length(:'st'::jsonb -> 'employer_matches') = 1 and (:'st'::jsonb ->> 'employer_match_cents') = '20000'
                      and (:'st'::jsonb -> 'employer_matches' -> 0 ->> 'employer') = 'Acme925'
                      and (:'st'::jsonb ->> 'employer_match_note') like '%your employer''s gift to us, not yours%not a gift you can deduct%',
  'C · it is listed apart as the employer''s gift with a sentence, and the household''s adult sees the employer''s name');
select pg_temp.claims(:gview);
select app.year_end_statement(:hb, extract(year from pg_temp.today() - 1)::int) as st2 \gset
select pg_temp.assert((:'st2'::jsonb ->> 'total_cents') = '23000' and (:'st2'::jsonb -> 'employer_matches' -> 0 ->> 'employer') = 'Employer matching gift'
                      and not (:'st2'::jsonb::text like '%Acme925%'),
  'C · giving staff who are not CatchTheMatch readers see that it was an employer''s match, not whose');
select pg_temp.claims(:tara);
select app.year_end_statement(:hb, extract(year from pg_temp.today() - 1)::int) as st3 \gset
select pg_temp.assert((:'st3'::jsonb -> 'employer_matches' -> 0 ->> 'employer') = 'Acme925', 'C · a CatchTheMatch reader sees the employer''s name');
select pg_temp.assert((select given_cents from app.year_end_review(:c1, extract(year from pg_temp.today() - 1)::int) where household_id = :hb) = 23000
                      and (select gift_count from app.year_end_review(:c1, extract(year from pg_temp.today() - 1)::int) where household_id = :hb) = 2,
  'C · the year-end review''s total for the household is the donor''s own gifts');
select pg_temp.assert_raises(format('select app.receipt_copy(%L)', (:'rp'::jsonb ->> 'payment_id')), 'employer''s matching gift', 'C · there is no receipt copy for the employer''s money');
select pg_temp.claims(:ubo);
select pg_temp.assert(app.household_credit(:hb) = 23000, 'C · the household''s credit is its own unapplied gifts: the employer''s match is not credit');
reset role;
-- A household whose only payment in the year is a match gets no statement.
insert into app.payments (id, center_id, household_id, amount_cents, method, status, provider, received_on, receipt_number)
  values ('92500000-0000-4000-8000-00000000f0a1', :c1, :hz, 5000, 'matching_gift', 'captured', 'offline', pg_temp.today() - 3, null);
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values ('92500000-0000-4000-8000-0000000000a9', :c1, 'Zed', 'Zulu925', '1970-01-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values (:hz, '92500000-0000-4000-8000-0000000000a9', :c1, 'primary', true);
insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, received_on, receipt_number)
  values ('92500000-0000-4000-8000-00000000f0a2', :c1, :hz, '92500000-0000-4000-8000-0000000000a9', 10000, 'check', 'captured', 'offline', pg_temp.today() - 400, 'R-925-z');
insert into app.match_claims (id, center_id, person_id, program_id, payment_id, state, received_on)
  values ('92500000-0000-4000-8000-00000000c0a1', :c1, '92500000-0000-4000-8000-0000000000a9', :'acme', '92500000-0000-4000-8000-00000000f0a2', 'received', pg_temp.today() - 3);
insert into app.match_payments (payment_id, center_id, claim_id, person_id, household_id, employer_name)
  values ('92500000-0000-4000-8000-00000000f0a1', :c1, '92500000-0000-4000-8000-00000000c0a1', '92500000-0000-4000-8000-0000000000a9', :hz, 'Acme925');
set role authenticated;
select pg_temp.claims(:tara);
select pg_temp.assert(not exists (select 1 from app.year_end_review(:c1, extract(year from pg_temp.today())::int) where household_id = :hz),
  'C · a household whose only payment in the year is an employer''s match is not in the review: no statement to send');
reset role;
select pg_temp.assert(not exists (select 1 from app._match_gifts(:c1) where payment_id in (select payment_id from app.match_payments))
                      and not exists (select 1 from app._match_gifts_of(:c1, :pb) where payment_id in (select payment_id from app.match_payments)),
  'C · a match payment is not a gift that can itself be matched');
select pg_temp.assert(position('match_payments' in pg_get_functiondef('app.payments_receipt_email()'::regprocedure)) > 0,
  'C · the receipt email trigger skips an employer''s match');

-- ══ D. Claims ════════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:lead);
select pg_temp.assert_raises(format('select app.set_match_claim_state(%L, %L, %L)', :c1, :'cl_gb1', 'asked'), 'Refund or correct that payment in Giving first',
  'D · a claim with a payment recorded cannot be moved off received');
select app.set_match_claim_state(:c1, :'cl_gb1'::uuid, 'received');
select app.match_claims_list(:c1, 'ended') as cl \gset
select pg_temp.assert((select (e -> 'match' ->> 'recorded') from jsonb_array_elements(:'cl'::jsonb -> 'rows') e where e ->> 'id' = :'cl_gb1') = 'true'
                      and (select (e -> 'match' -> 'amount_cents') from jsonb_array_elements(:'cl'::jsonb -> 'rows') e where e ->> 'id' = :'cl_gb1') = 'null'::jsonb
                      and (:'cl'::jsonb ->> 'can_record') = 'false',
  'D · the list says the match was recorded, shows no amount without giving access, and offers a manager without a giving permission no way to record');
select pg_temp.claims(:tara);
select app.match_claims_list(:c1, 'ended') as cl2 \gset
select pg_temp.assert((select (e -> 'match' ->> 'amount_cents') from jsonb_array_elements(:'cl2'::jsonb -> 'rows') e where e ->> 'id' = :'cl_gb1') = '20000'
                      and (:'cl2'::jsonb ->> 'can_record') = 'true',
  'D · with giving access the amount shows, and the treasurer is offered Record the match');
select app.match_claim_get(:c1, :'cl_gb2'::uuid) as g1 \gset
select pg_temp.assert((:'g1'::jsonb ->> 'can_record') = 'true' and (:'g1'::jsonb -> 'claim' -> 'gift' ->> 'amount_cents') = '3000'
                      and (:'g1'::jsonb -> 'claim' -> 'match' ->> 'recorded') = 'false' and (:'g1'::jsonb -> 'claim' -> 'household') ? 'number'
                      and (:'g1'::jsonb -> 'claim' -> 'person' ->> 'name') = 'Bo Bravo925',
  'D · one claim, for the form that records its match: the donor, the household card, the gift, whether it is recorded, and whether this person may record it');
select pg_temp.claims(:lead);
select pg_temp.assert((app.match_claim_get(:c1, :'cl_gb1'::uuid) -> 'claim' -> 'gift' -> 'amount_cents') = 'null'::jsonb
                      and (app.match_claim_get(:c1, :'cl_gb1'::uuid) -> 'claim' -> 'match' -> 'amount_cents') = 'null'::jsonb
                      and (app.match_claim_get(:c1, :'cl_gb1'::uuid) ->> 'can_record') = 'false',
  'D · without giving access no amount shows and the form is not offered');
select pg_temp.assert_raises(format('select app.match_claim_get(%L, %L)', :c1, '92500000-0000-4000-8000-00000000c0ff'), 'not found', 'D · a claim that is not there');
select pg_temp.claims(:clerk);
select pg_temp.assert_raises(format('select app.match_claim_get(%L, %L)', :c1, :'cl_gb1'), 'don''t have access', 'D · and a clerk without CatchTheMatch cannot read it');
reset role;

-- ══ E. The Bank tab ══════════════════════════════════════════════════════════
insert into app.bank_accounts (id, center_id, name, institution, last4) values (:acct, :c1, 'Operating', 'Chase', '4608');
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description, channel, fingerprint)
  values (:l1, :c1, :acct, pg_temp.today(), 20000, 'ACH CREDIT BENEVITY', 'ach', 'fp-925-l1');
set role authenticated;
select pg_temp.claims(:tara);
select pg_temp.assert((select kind from app.reconcile_candidates(:l1) order by rank limit 1) = 'payment'
                      and (select ref_id from app.reconcile_candidates(:l1) order by rank limit 1) = (:'rp'::jsonb ->> 'payment_id')::uuid,
  'E · an incoming bank line of the same amount is proposed to the recorded match payment');
select app.attach_bank_line_to_payment(:l1, (:'rp'::jsonb ->> 'payment_id')::uuid);
reset role;
select pg_temp.assert((select reconciled_at from pg_temp.pay() where id = (:'rp'::jsonb ->> 'payment_id')::uuid) is not null
                      and (select status from app.bank_transactions where id = :l1) = 'matched',
  'E · attaching the bank line reconciles the match payment');

-- ══ F. The donor''s thank-you ════════════════════════════════════════════════
select pg_temp.assert((select count(*) from app._care_gifts(:c1) where payment_id = (:'rp'::jsonb ->> 'payment_id')::uuid) = 1,
  'F · DonorDelight''s gift list includes the payment, so a thank-you step opens for the donor when DonorDelight is on');

-- ══ G. The modules ═══════════════════════════════════════════════════════════
update app.center_module_grants set granted = false where center_id = :c1 and module_key = 'giving';
set role authenticated;
select pg_temp.claims(:both);
select pg_temp.assert_raises(format('select app.record_match_payment(%L, %L, 2000)', :c1, :'cl_gb2'), 'have access', 'G · with Giving off nothing is recorded');
reset role;
delete from app.center_module_grants where center_id = :c1 and module_key = 'matching';
set role authenticated;
select pg_temp.claims(:both);
select pg_temp.assert_raises(format('select app.record_match_payment(%L, %L, 2000)', :c1, :'cl_gb2'), 'don''t have access', 'G · nor with CatchTheMatch off');
reset role;
rollback;
