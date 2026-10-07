-- Review fixes on 0590/0591 (Pathshala registration plan v2, PRs 1 and 2): a pledge a member makes up never confirms a
-- seat, withdrawing with the fee still open, the late fee once per learner, $0 lines in pay-now terms, the fund when Giving
-- was switched on late, late payments after a release, lock order, a new child in two tracks, the attendance import with two
-- tracks, direct API writes, and what a child can never read (P30). Everything runs in its own community (P76).
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
create or replace function pg_temp.assert_code(stmt text, code text, expect text, label text, want_hint text default null) returns void language plpgsql as $$
declare v_hint text;
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  if sqlerrm like 'FAIL:%' then raise; end if;
  if sqlstate <> code or position(lower(expect) in lower(sqlerrm)) = 0 or (want_hint is not null and v_hint is distinct from want_hint) then
    raise exception 'FAIL: % (got % "%" hint %)', label, sqlstate, sqlerrm, v_hint;
  end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.sign_in(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.today() returns date language sql as $$ select (now() at time zone 'America/Chicago')::date $$;
grant connect_worker to postgres;

-- ── Fixtures ─────────────────────────────────────────────────────────────────
\set c '''77000000-0000-4000-8000-0000000000c1'''
\set u_pia '''77000000-0000-4000-8000-000000000001'''
\set u_tara '''77000000-0000-4000-8000-000000000002'''
\set u_mira '''77000000-0000-4000-8000-000000000003'''
\set u_riya '''77000000-0000-4000-8000-000000000004'''
\set u_nita '''77000000-0000-4000-8000-000000000005'''
\set p_pia '''77000000-0000-4000-8000-000000000101'''
\set p_tara '''77000000-0000-4000-8000-000000000102'''
\set p_mira '''77000000-0000-4000-8000-000000000103'''
\set p_riya '''77000000-0000-4000-8000-000000000104'''
\set p_dev '''77000000-0000-4000-8000-000000000105'''
\set p_nita '''77000000-0000-4000-8000-000000000108'''
\set p_kiran '''77000000-0000-4000-8000-000000000109'''
\set p_isha '''77000000-0000-4000-8000-00000000010a'''
\set h1 '''77000000-0000-4000-8000-000000000201'''
\set h2 '''77000000-0000-4000-8000-000000000202'''
\set tr_j '''77000000-0000-4000-8000-000000000301'''
\set tr_g '''77000000-0000-4000-8000-000000000302'''
\set lv_j2 '''77000000-0000-4000-8000-000000000402'''
\set lv_j5 '''77000000-0000-4000-8000-000000000405'''
\set lv_g1 '''77000000-0000-4000-8000-000000000411'''
\set t1 '''77000000-0000-4000-8000-000000000501'''
\set cl_j2 '''77000000-0000-4000-8000-000000000602'''
\set cl_j5 '''77000000-0000-4000-8000-000000000605'''
\set cl_g1 '''77000000-0000-4000-8000-000000000611'''
\set t2 '''77000000-0000-4000-8000-000000000502'''
\set cl2_j2 '''77000000-0000-4000-8000-000000000622'''
\set cl2_j5 '''77000000-0000-4000-8000-000000000625'''
\set cl2_g1 '''77000000-0000-4000-8000-000000000631'''
\set fund_p '''77000000-0000-4000-8000-000000000701'''

insert into app.centers (id, slug, name, short_name, time_zone, environment) values (:c, 'p77-temple', 'P77 Jain Temple', 'P77', 'America/Chicago', 'production');
insert into auth.users (id, email) values
  (:u_pia, 'pia@p77.test'), (:u_tara, 'tara@p77.test'), (:u_mira, 'mira@p77.test'), (:u_riya, 'riya@p77.test'), (:u_nita, 'nita@p77.test');
-- Ages on the first day (2026-09-06): Riya 12, Dev 9, Kiran 10, Isha 10.
insert into app.people (id, center_id, first_name, last_name, date_of_birth, email) values
  (:p_pia, :c, 'Pia', 'Principal', '1975-05-05', 'pia@p77.test'), (:p_tara, :c, 'Tara', 'Treasurer', '1970-01-01', 'tara@p77.test'),
  (:p_mira, :c, 'Mira', 'Shah', '1982-02-02', 'mira@p77.test'), (:p_riya, :c, 'Riya', 'Shah', '2014-03-10', 'riya@p77.test'),
  (:p_dev, :c, 'Dev', 'Shah', '2017-01-15', null),
  (:p_nita, :c, 'Nita', 'Mehta', '1984-08-08', 'nita@p77.test'), (:p_kiran, :c, 'Kiran', 'Mehta', '2016-02-02', null),
  (:p_isha, :c, 'Isha', 'Mehta', '2016-07-07', null);
insert into app.households (id, center_id, display_name) values (:h1, :c, 'Shah household'), (:h2, :c, 'Mehta household');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :p_mira, :c, 'primary', true), (:h1, :p_riya, :c, 'child', false), (:h1, :p_dev, :c, 'child', false),
  (:h2, :p_nita, :c, 'primary', true), (:h2, :p_kiran, :c, 'child', false), (:h2, :p_isha, :c, 'child', false);
insert into app.center_users (center_id, user_id, person_id, is_default) values
  (:c, :u_pia, :p_pia, false), (:c, :u_tara, :p_tara, false), (:c, :u_mira, :p_mira, false), (:c, :u_riya, :p_riya, false),
  (:c, :u_nita, :p_nita, false);
insert into app.role_grants (center_id, user_id, role_key) values (:c, :u_pia, 'pathshala_principal'), (:c, :u_tara, 'treasurer');
insert into app.funds (id, center_id, key, name) values (:fund_p, :c, 'pathshala', 'Pathshala');
insert into app.membership_types (center_id, key, tier, name, period_months) values (:c, 'yearly', 'yearly', 'Yearly membership', 12);
insert into app.memberships (center_id, household_id, person_id, membership_type_id, tier, status, starts_on)
select :c, x.h, x.p, mt.id, 'yearly', 'active', current_date - 30
  from app.membership_types mt, (values (:h1::uuid, :p_mira::uuid), (:h2, :p_nita)) x(h, p)
 where mt.center_id = :c and mt.key = 'yearly';
insert into app.integration_connections (id, center_id, provider, status, settings)
values ('77000000-0000-4000-8000-000000000703', :c, 'stripe', 'connected', '{"mode":"live"}');
insert into app.center_payment_processors (center_id, processor, connection_id, status, methods, is_default)
values (:c, 'stripe', '77000000-0000-4000-8000-000000000703', 'live', array['card'], true);

insert into app.pathshala_tracks (id, center_id, key, name) values (:tr_j, :c, 'jainism', 'Jainism'), (:tr_g, :c, 'gujarati', 'Gujarati');
insert into app.pathshala_levels (id, center_id, track_id, key, name, sort_order, min_age, max_age) values
  (:lv_j2, :c, :tr_j, '2', 'Jainism 2', 2, 8, 10), (:lv_j5, :c, :tr_j, '5', 'Jainism 5', 5, 11, 13), (:lv_g1, :c, :tr_g, '1', 'Gujarati 1', 1, null, null);
-- T1: pay now (opened in pledge mode, then switched by the database: pay now cannot be chosen until fee receipts, 0595).
insert into app.pathshala_terms (id, center_id, name, starts_on, ends_on, sibling_discount_pct, fee_per_family_cap_cents, registration_closes_at) values
  (:t1, :c, 'Summer 2027', '2026-09-06', '2027-05-30', 0, null, null);
insert into app.pathshala_classes (id, center_id, term_id, level_id, name, room, capacity, meets_on, starts_time, ends_time, waitlist_enabled) values
  (:cl_j2, :c, :t1, :lv_j2, 'Jainism 2 · Room B', 'B', 4, 'sunday', '10:00', '11:30', true),
  (:cl_j5, :c, :t1, :lv_j5, 'Jainism 5 · Room C', 'C', 4, 'sunday', '10:00', '11:30', true),
  (:cl_g1, :c, :t1, :lv_g1, 'Gujarati 1 · Library', 'Library', 4, 'sunday', '11:45', '12:45', true);
-- T2: pledge mode (the default), a 10% sibling discount.
insert into app.pathshala_terms (id, center_id, name, starts_on, ends_on, sibling_discount_pct, fee_per_family_cap_cents, registration_closes_at) values
  (:t2, :c, 'Fall 2026', '2026-09-06', '2027-05-30', 10, null, null);
insert into app.pathshala_classes (id, center_id, term_id, level_id, name, room, capacity, meets_on, starts_time, ends_time, waitlist_enabled) values
  (:cl2_j2, :c, :t2, :lv_j2, 'Jainism 2 · Room B (fall)', 'B', 4, 'sunday', '10:00', '11:30', true),
  (:cl2_j5, :c, :t2, :lv_j5, 'Jainism 5 · Room C (fall)', 'C', 4, 'sunday', '10:00', '11:30', true),
  (:cl2_g1, :c, :t2, :lv_g1, 'Gujarati 1 · Library (fall)', 'Library', 4, 'sunday', '11:45', '12:45', true);
begin;
select pg_temp.sign_in(:u_pia);
select app.set_pathshala_level_fees(:t2, jsonb_build_array(
  jsonb_build_object('level_id', :lv_j2, 'fee_cents', 13000), jsonb_build_object('level_id', :lv_j5, 'fee_cents', 13000),
  jsonb_build_object('level_id', :lv_g1, 'fee_cents', 4500)));
select app.open_pathshala_registration(:t2);
select app.set_pathshala_level_fees(:t1, jsonb_build_array(
  jsonb_build_object('level_id', :lv_j2, 'fee_cents', 13000), jsonb_build_object('level_id', :lv_j5, 'fee_cents', 13000),
  jsonb_build_object('level_id', :lv_g1, 'fee_cents', 4500)));
select app.open_pathshala_registration(:t1);
commit;
update app.pathshala_terms set payment_mode = 'pay_now' where id = :t1;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. A pledge a member makes up never confirms a seat
-- ════════════════════════════════════════════════════════════════════════════
begin;
select pg_temp.sign_in(:u_mira);
select app.register_pathshala_children(:t1, :h1, jsonb_build_array(jsonb_build_object('person_id', :p_dev, 'track_id', :tr_j, 'level_id', :lv_j2)),
                                       13000, null, null, 'k77-dev-1') as r1 \gset
commit;
select (:'r1'::jsonb -> 'lines' -> 0 ->> 'enrollment_id') as e_dev, (:'r1'::jsonb -> 'lines' -> 0 -> 'pledge' ->> 'id') as pl_dev \gset
select pg_temp.assert((select status = 'requested' and app._pathshala_hold(id) = 'payment' from app.pathshala_enrollments where id = :'e_dev')
                      and (select status = 'open' and amount_cents = 13000 from app.pledges where id = :'pl_dev'::uuid),
  'pay now: Dev is held for payment with a $130.00 pledge due today');
-- The members' own insert is refused for a fee pledge, and for any record id other than an RSVP's.
begin;
select pg_temp.sign_in(:u_mira);
select pg_temp.assert_raises(format($$insert into app.pledges (center_id, household_id, pledged_by_person_id, source, source_ref_id, amount_cents, created_by)
                                      values (%L, %L, %L, 'pathshala_fee', %L, 50, %L)$$, :c, :h1, :p_mira, :'e_dev', :u_mira),
  'row-level security', 'a member cannot insert a pledge with source pathshala_fee (RLS)');
rollback;
begin;
select pg_temp.sign_in(:u_mira);
select pg_temp.assert_raises(format($$insert into app.pledges (center_id, household_id, pledged_by_person_id, source, source_ref_id, amount_cents, created_by)
                                      values (%L, %L, %L, 'general', %L, 50, %L)$$, :c, :h1, :p_mira, :'e_dev', :u_mira),
  'row-level security', 'a member cannot insert a pledge that names another record (any non-null source_ref_id except an RSVP commitment)');
rollback;
begin;
select pg_temp.sign_in(:u_mira);
insert into app.pledges (center_id, household_id, pledged_by_person_id, source, amount_cents, created_by)
values (:c, :h1, :p_mira, 'general', 2500, :u_mira);
rollback;
-- Even if such a pledge existed (inserted here as the database owner, as the old policy allowed), paying it places nobody.
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, source, source_ref_id, amount_cents, created_by)
values ('77000000-0000-4000-8000-000000000901', :c, :h1, :p_mira, 'pathshala_fee', :'e_dev', 50, :u_mira);
begin;
select pg_temp.sign_in(:u_tara);
select app.record_offline_payment(:h1, 50, 'cash', pg_temp.today(), array['77000000-0000-4000-8000-000000000901'::uuid], '7701');
commit;
select pg_temp.assert((select status = 'paid' from app.pledges where id = '77000000-0000-4000-8000-000000000901')
                      and (select status = 'requested' and app._pathshala_hold(id) = 'payment' and class_id is null from app.pathshala_enrollments where id = :'e_dev')
                      and (select status = 'billed' from app.pathshala_enrollment_fees where enrollment_id = :'e_dev')
                      and (select status = 'open' from app.pledges where id = :'pl_dev'::uuid),
  'a self-made 50-cent pledge naming the enrollment, paid, places nobody: Dev stays held and the $130.00 pledge stays open');
begin;
select pg_temp.sign_in(:u_tara);
select app.record_offline_payment(:h1, 13000, 'check', pg_temp.today(), array[:'pl_dev'::uuid], '7702');
commit;
select pg_temp.assert((select status = 'placed' and class_id = :cl_j2 from app.pathshala_enrollments where id = :'e_dev')
                      and (select status = 'paid' from app.pathshala_enrollment_fees where enrollment_id = :'e_dev'),
  'the fee line''s own pledge, paid in full, places Dev');

-- ════════════════════════════════════════════════════════════════════════════
-- 2. The old Withdraw button leaves no fee behind (review B3)
-- ════════════════════════════════════════════════════════════════════════════
begin;
select pg_temp.sign_in(:u_nita);
select app.register_pathshala_children(:t2, :h2, jsonb_build_array(jsonb_build_object('person_id', :p_kiran, 'track_id', :tr_j, 'level_id', :lv_j2)),
                                       13000, null, null, 'k77-kiran-2') as r3 \gset
commit;
select (:'r3'::jsonb -> 'lines' -> 0 ->> 'enrollment_id') as e_kiran, (:'r3'::jsonb -> 'lines' -> 0 -> 'pledge' ->> 'id') as pl_kiran \gset
select pg_temp.assert((select e.status = 'placed' and f.status = 'billed' and f.pledge_id = :'pl_kiran'::uuid
                         from app.pathshala_enrollments e join app.pathshala_enrollment_fees f on f.enrollment_id = e.id where e.id = :'e_kiran')
                      and (select status = 'open' and amount_cents = 13000 from app.pledges where id = :'pl_kiran'::uuid),
  'pledge mode: Kiran is placed and billed one $130.00 pledge');
begin;
select pg_temp.sign_in(:u_pia);
select pg_temp.assert_code(format($$update app.pathshala_enrollments set status = 'withdrawn' where id = %L$$, :'e_kiran'),
  '22023', 'ask the pathshala office', 'the portal''s Withdraw button: refused while the fee is billed, with a plain sentence for the office');
select pg_temp.assert_code(format($$update app.pathshala_enrollments set status = 'requested', class_id = null where id = %L$$, :'e_kiran'),
  '22023', 'treasurer cancels or settles the fee pledge', 'moving a billed learner back to requests is refused too');
select pg_temp.assert_code(format($$update app.pathshala_enrollments set status = 'waitlisted' where id = %L$$, :'e_kiran'),
  '22023', 'ask the pathshala office', 'so is the waitlist');
update app.pathshala_enrollments set status = 'active' where id = :'e_kiran';
update app.pathshala_enrollments set status = 'completed' where id = :'e_kiran';
update app.pathshala_enrollments set status = 'placed' where id = :'e_kiran';
commit;
select pg_temp.assert((select status = 'placed' from app.pathshala_enrollments where id = :'e_kiran')
                      and (select status = 'open' from app.pledges where id = :'pl_kiran'::uuid),
  'placed, active and completed are still the principal''s to set; the billed fee pledge is untouched');
-- A withdrawal made before this fix (the owner of the database writes it, as the old button did) left the pledge open:
-- registering that learner again is refused, so there is never a second pledge for the same enrollment.
update app.pathshala_enrollments set status = 'withdrawn' where id = :'e_kiran';
begin;
select pg_temp.sign_in(:u_nita);
select pg_temp.assert_code(format($$select app.register_pathshala_children(%L, %L, %L)$$, :t2, :h2,
  jsonb_build_array(jsonb_build_object('person_id', :p_kiran, 'track_id', :tr_j, 'level_id', :lv_j2))),
  '22023', 'ask the pathshala office', 're-registration: refused while the earlier fee pledge is still open');
commit;
select pg_temp.assert((select count(*) = 1 from app.pledges where source = 'pathshala_fee' and source_ref_id = :'e_kiran'::uuid),
  're-registration: still one fee pledge for the enrollment (no second pledge)');

-- ════════════════════════════════════════════════════════════════════════════
-- 3. The late fee once per learner; a line the office prices later keeps the rules it was quoted with
-- ════════════════════════════════════════════════════════════════════════════
\set t3 '''77000000-0000-4000-8000-000000000503'''
\set cl3_j2 '''77000000-0000-4000-8000-000000000642'''
\set cl3_g1 '''77000000-0000-4000-8000-000000000651'''
insert into app.pathshala_terms (id, center_id, name, starts_on, ends_on, sibling_discount_pct, fee_per_family_cap_cents, registration_closes_at) values
  (:t3, :c, 'Late term', '2026-09-06', '2027-05-30', 10, null, now() + interval '1 day');
insert into app.pathshala_classes (id, center_id, term_id, level_id, name, room, capacity, meets_on, starts_time, ends_time, waitlist_enabled) values
  (:cl3_j2, :c, :t3, :lv_j2, 'Jainism 2 · Room B (late)', 'B', 4, 'sunday', '10:00', '11:30', true),
  (:cl3_g1, :c, :t3, :lv_g1, 'Gujarati 1 · Library (late)', 'Library', 4, 'sunday', '11:45', '12:45', true);
begin;
select pg_temp.sign_in(:u_pia);
select app.set_pathshala_level_fees(:t3, jsonb_build_array(jsonb_build_object('level_id', :lv_j2, 'fee_cents', 13000), jsonb_build_object('level_id', :lv_g1, 'fee_cents', 4500)));
select app.set_pathshala_term_rules(:t3, jsonb_build_object('late_fee_cents', 2500, 'late_registration_closes_at', (now() + interval '40 days')::text));
select app.open_pathshala_registration(:t3);
commit;
update app.pathshala_terms set registration_closes_at = now() - interval '1 day' where id = :t3;
begin;
select pg_temp.sign_in(:u_nita);
select app.register_pathshala_children(:t3, :h2, jsonb_build_array(jsonb_build_object('person_id', :p_kiran, 'track_id', :tr_g, 'level_id', :lv_g1)),
                                       null, null, null, 'k77-kiran-3') as r4 \gset
select app.register_pathshala_children(:t3, :h2, jsonb_build_array(jsonb_build_object('person_id', :p_isha, 'track_id', :tr_j, 'level_id', null),
                                                                   jsonb_build_object('person_id', :p_isha, 'track_id', :tr_g, 'level_id', :lv_g1)),
                                       null, null, null, 'k77-isha-3') as r5 \gset
commit;
select pg_temp.assert((select f.total_cents = 7000 and f.late_fee_cents = 2500 and f.family_rank = 1
                         from app.pathshala_enrollment_fees f where f.enrollment_id = (:'r4'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid),
  'late registration: Kiran''s Gujarati line is $45.00 plus the $25.00 late fee');
select (x ->> 'enrollment_id') as e_isha_g from jsonb_array_elements(:'r5'::jsonb -> 'lines') x where x ->> 'track_id' = :tr_g::text \gset
select (x ->> 'enrollment_id') as e_isha_j from jsonb_array_elements(:'r5'::jsonb -> 'lines') x where x ->> 'track_id' = :tr_j::text \gset
select pg_temp.assert((select f.total_cents = 6550 and f.late_fee_cents = 2500 and f.sibling_discount_cents = 450 and f.family_rank = 2
                         from app.pathshala_enrollment_fees f where f.enrollment_id = :'e_isha_g'::uuid)
                      and (select not f.priced and f.total_cents = 0 and f.late_fee_cents = 0 from app.pathshala_enrollment_fees f where f.enrollment_id = :'e_isha_j'::uuid),
  'late registration: Isha (second child) pays 10% less on Gujarati plus one late fee; her "not sure" Jainism line waits unpriced');
-- The term's rules change after the registration (the owner of the database writes it): the saved rules still apply.
update app.pathshala_terms set sibling_discount_pct = 50, late_fee_cents = 9900 where id = :t3;
begin;
select pg_temp.sign_in(:u_pia);
select app.place_pathshala_enrollment(:'e_isha_j'::uuid, :cl3_j2) as pl_j \gset
commit;
select pg_temp.assert((select f.priced and f.base_fee_cents = 13000 and f.sibling_discount_cents = 1300 and f.late_fee_cents = 0 and f.total_cents = 11700
                         from app.pathshala_enrollment_fees f where f.enrollment_id = :'e_isha_j'::uuid)
                      and (select amount_cents = 11700 from app.pledges where id = (select pledge_id from app.pathshala_enrollment_fees where enrollment_id = :'e_isha_j'::uuid)),
  'a line the office prices later: the sibling discount of the rules it was quoted with (10%, not 50%) and no second late fee ($117.00, not $155.00)');

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Pay now: a $0 or Giving-off line is never held for a payment that does not exist
-- ════════════════════════════════════════════════════════════════════════════
\set u_priya '''77000000-0000-4000-8000-000000000006'''
\set u_lata '''77000000-0000-4000-8000-000000000007'''
\set p_anya '''77000000-0000-4000-8000-00000000010b'''
\set p_mina '''77000000-0000-4000-8000-00000000010c'''
\set p_priya '''77000000-0000-4000-8000-00000000010d'''
\set p_tia '''77000000-0000-4000-8000-00000000010e'''
\set p_zoe '''77000000-0000-4000-8000-00000000010f'''
\set p_lata '''77000000-0000-4000-8000-000000000110'''
\set p_ved '''77000000-0000-4000-8000-000000000111'''
\set h3 '''77000000-0000-4000-8000-000000000203'''
\set h4 '''77000000-0000-4000-8000-000000000204'''
\set lv_tod '''77000000-0000-4000-8000-000000000400'''
\set t4 '''77000000-0000-4000-8000-000000000504'''
\set cl4_tod '''77000000-0000-4000-8000-000000000660'''
\set cl4_j2 '''77000000-0000-4000-8000-000000000662'''
insert into auth.users (id, email) values (:u_priya, 'priya@p77.test'), (:u_lata, 'lata@p77.test');
insert into app.people (id, center_id, first_name, last_name, date_of_birth, email) values
  (:p_anya, :c, 'Anya', 'Shah', '2022-05-01', null), (:p_mina, :c, 'Mina', 'Mehta', '2022-01-01', null),
  (:p_priya, :c, 'Priya', 'Patel', '1985-03-03', 'priya@p77.test'), (:p_tia, :c, 'Tia', 'Patel', '2022-08-08', null),
  (:p_zoe, :c, 'Zoe', 'Mehta', '2022-03-03', null),
  (:p_lata, :c, 'Lata', 'Desai', '1983-03-03', 'lata@p77.test'), (:p_ved, :c, 'Ved', 'Desai', '2017-06-01', null);
insert into app.households (id, center_id, display_name) values (:h3, :c, 'Patel household'), (:h4, :c, 'Desai household');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :p_anya, :c, 'child', false), (:h2, :p_mina, :c, 'child', false), (:h2, :p_zoe, :c, 'child', false),
  (:h3, :p_priya, :c, 'primary', true), (:h3, :p_tia, :c, 'child', false),
  (:h4, :p_lata, :c, 'primary', true), (:h4, :p_ved, :c, 'child', false);
insert into app.center_users (center_id, user_id, person_id, is_default) values (:c, :u_priya, :p_priya, false), (:c, :u_lata, :p_lata, false);
insert into app.pathshala_levels (id, center_id, track_id, key, name, sort_order, min_age, max_age) values
  (:lv_tod, :c, :tr_j, 'toddler', 'Toddler', 0, 3, 5);
-- T4: pay now; the Toddler level is Free and has one seat.
insert into app.pathshala_terms (id, center_id, name, starts_on, ends_on, sibling_discount_pct, fee_per_family_cap_cents, registration_closes_at) values
  (:t4, :c, 'Pay-now two', '2026-09-06', '2027-05-30', 0, null, null);
insert into app.pathshala_classes (id, center_id, term_id, level_id, name, room, capacity, meets_on, starts_time, ends_time, waitlist_enabled) values
  (:cl4_tod, :c, :t4, :lv_tod, 'Toddler · Room T', 'T', 1, 'sunday', '10:00', '11:00', true),
  (:cl4_j2, :c, :t4, :lv_j2, 'Jainism 2 · Room B (two)', 'B', 4, 'sunday', '10:00', '11:30', true);
begin;
select pg_temp.sign_in(:u_pia);
select app.set_pathshala_level_fees(:t4, jsonb_build_array(jsonb_build_object('level_id', :lv_tod, 'fee_cents', 0), jsonb_build_object('level_id', :lv_j2, 'fee_cents', 13000)));
select app.open_pathshala_registration(:t4);
commit;
update app.pathshala_terms set payment_mode = 'pay_now' where id = :t4;
-- Anya takes the one Toddler seat (nothing to pay: placed at once); Mina waits; Tia and Ved's families have no membership.
begin;
select pg_temp.sign_in(:u_mira);
select app.register_pathshala_children(:t4, :h1, jsonb_build_array(jsonb_build_object('person_id', :p_anya, 'track_id', :tr_j, 'level_id', :lv_tod)),
                                       null, null, null, 'k77-anya-4') as r6 \gset
select pg_temp.sign_in(:u_nita);
select app.register_pathshala_children(:t4, :h2, jsonb_build_array(jsonb_build_object('person_id', :p_mina, 'track_id', :tr_j, 'level_id', :lv_tod)),
                                       null, null, null, 'k77-mina-4') as r7 \gset
select pg_temp.sign_in(:u_priya);
select app.register_pathshala_children(:t4, :h3, jsonb_build_array(jsonb_build_object('person_id', :p_tia, 'track_id', :tr_j, 'level_id', :lv_tod)),
                                       null, null, null, 'k77-tia-4') as r8 \gset
select pg_temp.sign_in(:u_lata);
select app.register_pathshala_children(:t4, :h4, jsonb_build_array(jsonb_build_object('person_id', :p_ved, 'track_id', :tr_j, 'level_id', :lv_j2)),
                                       null, null, null, 'k77-ved-4') as r9 \gset
commit;
select (:'r7'::jsonb -> 'lines' -> 0 ->> 'enrollment_id') as e_mina, (:'r8'::jsonb -> 'lines' -> 0 ->> 'enrollment_id') as e_tia,
       (:'r9'::jsonb -> 'lines' -> 0 ->> 'enrollment_id') as e_ved, (:'r6'::jsonb -> 'lines' -> 0 ->> 'enrollment_id') as e_anya \gset
select pg_temp.assert((select status = 'placed' from app.pathshala_enrollments where id = :'e_anya')
                      and (select status = 'waitlisted' from app.pathshala_enrollments where id = :'e_mina')
                      and (select status = 'requested' and app._pathshala_hold(id) = 'membership' from app.pathshala_enrollments where id = :'e_tia')
                      and (select status = 'requested' and app._pathshala_hold(id) = 'membership' from app.pathshala_enrollments where id = :'e_ved'),
  'pay now, free level: Anya is placed at once, Mina waits for the seat, Tia and Ved wait for their families'' membership');
-- (a) The waitlist: the seat that opens goes to Mina; her fee is $0, so she is placed, not held for a payment.
update app.pathshala_classes set capacity = 2 where id = :cl4_tod;
select pg_temp.assert((select e.status = 'placed' and e.class_id = :cl4_tod and f.status = 'no_fee' and f.hold_reason is null and f.pledge_id is null and e.hold_expires_at is null
                         from app.pathshala_enrollments e join app.pathshala_enrollment_fees f on f.enrollment_id = e.id where e.id = :'e_mina')
                      and exists (select 1 from app.messages where center_id = :c and template_key = 'pathshala_placed' and payload -> 'vars' ->> 'enrollment_id' = :'e_mina'),
  'waitlist, pay now, $0: the freed seat places Mina at once (no hold, no pledge) and tells her family she is placed');
-- (b) A membership hold lifts: Tia's seat is $0, so she is placed.
update app.pathshala_classes set capacity = 3 where id = :cl4_tod;
insert into app.memberships (center_id, household_id, person_id, membership_type_id, tier, status, starts_on)
select :c, :h3, :p_priya, mt.id, 'yearly', 'active', current_date - 1 from app.membership_types mt where mt.center_id = :c and mt.key = 'yearly';
select pg_temp.assert((select e.status = 'placed' and e.class_id = :cl4_tod and f.status = 'no_fee' and f.hold_reason is null and f.pledge_id is null
                         from app.pathshala_enrollments e join app.pathshala_enrollment_fees f on f.enrollment_id = e.id where e.id = :'e_tia'),
  'membership lift, pay now, $0: Tia is placed at once, not held for a payment');
-- (c) The office places a waitlisted learner by hand (automatic serving held off for a moment): $0, so placed.
begin;
select pg_temp.sign_in(:u_nita);
select app.register_pathshala_children(:t4, :h2, jsonb_build_array(jsonb_build_object('person_id', :p_zoe, 'track_id', :tr_j, 'level_id', :lv_tod)),
                                       null, null, null, 'k77-zoe-4') as r10 \gset
commit;
select (:'r10'::jsonb -> 'lines' -> 0 ->> 'enrollment_id') as e_zoe \gset
select pg_temp.assert((select status = 'waitlisted' from app.pathshala_enrollments where id = :'e_zoe'), 'Zoe waits: the Toddler class is full');
alter table app.pathshala_classes disable trigger pathshala_classes_seats;
update app.pathshala_classes set capacity = 4 where id = :cl4_tod;
alter table app.pathshala_classes enable trigger pathshala_classes_seats;
select pg_temp.assert((select status = 'waitlisted' from app.pathshala_enrollments where id = :'e_zoe'), 'with the automatic serving held off, a seat that opens is not given by itself');
begin;
select pg_temp.sign_in(:u_pia);
select app.place_next_from_waitlist(:lv_tod, :t4) as pn \gset
commit;
select pg_temp.assert((:'pn'::jsonb ->> 'outcome') = 'placed'
                      and (select e.status = 'placed' and f.status = 'no_fee' and f.hold_reason is null and f.pledge_id is null
                             from app.pathshala_enrollments e join app.pathshala_enrollment_fees f on f.enrollment_id = e.id where e.id = :'e_zoe'),
  'office placement, pay now, $0: "Place next" places Zoe (outcome placed), nothing held');
-- The sweep leaves all three alone.
begin;
set local role connect_worker;
select app.worker_pathshala_holds_sweep() as sw_free \gset
commit;
select pg_temp.assert((:'sw_free'::jsonb ->> 'released')::int = 0
                      and (select count(*) = 3 from app.pathshala_enrollments where id in (:'e_mina'::uuid, :'e_tia'::uuid, :'e_zoe'::uuid) and status = 'placed'),
  'the sweep releases nobody: no free learner was ever held for a payment');
-- (d) Giving off: Ved's membership lifts while Pledges & donations is switched off: placed, "not billed", never held.
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c, 'giving', false, 'test');
insert into app.memberships (center_id, household_id, person_id, membership_type_id, tier, status, starts_on)
select :c, :h4, :p_lata, mt.id, 'yearly', 'active', current_date - 1 from app.membership_types mt where mt.center_id = :c and mt.key = 'yearly';
delete from app.center_modules where center_id = :c and module_key = 'giving';
select pg_temp.assert((select e.status = 'placed' and e.class_id = :cl4_j2 and f.status = 'not_billed_giving_off' and f.hold_reason is null and f.pledge_id is null
                         from app.pathshala_enrollments e join app.pathshala_enrollment_fees f on f.enrollment_id = e.id where e.id = :'e_ved'),
  'giving off, pay now: Ved''s lifted seat is placed with the fee "not billed in the app", never held for a payment that cannot be made');

-- 2b. Once the treasurer has cancelled the fee pledge in Giving, the office can withdraw the learner, and register them again.
begin;
select pg_temp.sign_in(:u_nita);
select app.register_pathshala_children(:t2, :h2, jsonb_build_array(jsonb_build_object('person_id', :p_isha, 'track_id', :tr_j, 'level_id', :lv_j2)),
                                       null, null, null, 'k77-isha-2') as r11 \gset
commit;
select (:'r11'::jsonb -> 'lines' -> 0 ->> 'enrollment_id') as e_isha2, (:'r11'::jsonb -> 'lines' -> 0 -> 'pledge' ->> 'id') as pl_isha2 \gset
begin;
select pg_temp.sign_in(:u_pia);
select pg_temp.assert_code(format($$update app.pathshala_enrollments set status = 'withdrawn' where id = %L$$, :'e_isha2'),
  '22023', 'ask the pathshala office', 'Isha: the billed fee blocks a direct withdrawal');
rollback;
update app.pledges set status = 'cancelled', closed_at = now() where id = :'pl_isha2'::uuid;
select pg_temp.assert((select status = 'cancelled' from app.pathshala_enrollment_fees where enrollment_id = :'e_isha2'),
  'the treasurer cancels the fee pledge in Giving: its fee line ends too');
begin;
select pg_temp.sign_in(:u_pia);
update app.pathshala_enrollments set status = 'withdrawn' where id = :'e_isha2';
commit;
select pg_temp.assert((select status = 'withdrawn' from app.pathshala_enrollments where id = :'e_isha2'),
  'with the fee pledge cancelled, the principal can withdraw the learner');
begin;
select pg_temp.sign_in(:u_nita);
select app.register_pathshala_children(:t2, :h2, jsonb_build_array(jsonb_build_object('person_id', :p_isha, 'track_id', :tr_j, 'level_id', :lv_j2)),
                                       null, null, null, 'k77-isha-2b') as r12 \gset
commit;
select pg_temp.assert((:'r12'::jsonb -> 'lines' -> 0 ->> 'enrollment_id') = :'e_isha2'
                      and (select count(*) filter (where status in ('open', 'partially_paid')) = 1 and count(*) = 2
                             from app.pledges where source = 'pathshala_fee' and source_ref_id = :'e_isha2'::uuid),
  're-registration after the pledge was cancelled: the same enrollment, one new open pledge (the cancelled one is history)');

-- ════════════════════════════════════════════════════════════════════════════
-- 5. A term opened while Pledges & donations was off gets its campaign and fund when the first fee is billed
-- ════════════════════════════════════════════════════════════════════════════
\set t5 '''77000000-0000-4000-8000-000000000505'''
\set cl5_j5 '''77000000-0000-4000-8000-000000000675'''
insert into app.pathshala_terms (id, center_id, name, starts_on, ends_on, sibling_discount_pct, fee_per_family_cap_cents, registration_closes_at) values
  (:t5, :c, 'Giving late', '2026-09-06', '2027-05-30', 0, null, null);
insert into app.pathshala_classes (id, center_id, term_id, level_id, name, room, capacity, meets_on, starts_time, ends_time, waitlist_enabled) values
  (:cl5_j5, :c, :t5, :lv_j5, 'Jainism 5 · Room C (giving late)', 'C', 4, 'sunday', '10:00', '11:30', true);
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c, 'giving', false, 'test');
begin;
select pg_temp.sign_in(:u_pia);
select app.set_pathshala_level_fees(:t5, jsonb_build_array(jsonb_build_object('level_id', :lv_j5, 'fee_cents', 13000)));
select app.open_pathshala_registration(:t5);
commit;
delete from app.center_modules where center_id = :c and module_key = 'giving';
select pg_temp.assert((select campaign_id is null and fund_id is null and fees_locked_at is not null from app.pathshala_terms where id = :t5),
  'a term opened while Giving was off has no campaign and no fund yet');
begin;
select pg_temp.sign_in(:u_mira);
select app.register_pathshala_children(:t5, :h1, jsonb_build_array(jsonb_build_object('person_id', :p_riya, 'track_id', :tr_j, 'level_id', :lv_j5)),
                                       13000, null, null, 'k77-riya-5') as r13 \gset
commit;
select pg_temp.assert((select pl.campaign_id is not null and pl.fund_id = :fund_p and pl.amount_cents = 13000 and pl.campaign_id = t.campaign_id and t.fund_id = :fund_p
                         from app.pledges pl, app.pathshala_terms t where pl.id = (:'r13'::jsonb -> 'lines' -> 0 -> 'pledge' ->> 'id')::uuid and t.id = :t5)
                      and (select kind = 'pathshala' and status = 'closed' and name = 'Pathshala fees Giving late' from app.campaigns
                            where id = (select campaign_id from app.pathshala_terms where id = :t5)),
  'Giving switched on later: the first fee pledge carries the term''s new closed campaign and the Pathshala fund, saved on the term');
-- No fund at all: the fee is quoted and kept "not billed" with a plain note; the seat is not held for a payment.
\set t6 '''77000000-0000-4000-8000-000000000506'''
\set cl6_g1 '''77000000-0000-4000-8000-000000000691'''
insert into app.pathshala_terms (id, center_id, name, starts_on, ends_on, sibling_discount_pct, fee_per_family_cap_cents, registration_closes_at) values
  (:t6, :c, 'No fund', '2026-09-06', '2027-05-30', 0, null, null);
insert into app.pathshala_classes (id, center_id, term_id, level_id, name, room, capacity, meets_on, starts_time, ends_time, waitlist_enabled) values
  (:cl6_g1, :c, :t6, :lv_g1, 'Gujarati 1 · Library (no fund)', 'Library', 4, 'sunday', '11:45', '12:45', true);
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c, 'giving', false, 'test');
begin;
select pg_temp.sign_in(:u_pia);
select app.set_pathshala_level_fees(:t6, jsonb_build_array(jsonb_build_object('level_id', :lv_g1, 'fee_cents', 4500)));
select app.open_pathshala_registration(:t6);
commit;
delete from app.center_modules where center_id = :c and module_key = 'giving';
update app.funds set active = false where id = :fund_p;
begin;
select pg_temp.sign_in(:u_mira);
select app.register_pathshala_children(:t6, :h1, jsonb_build_array(jsonb_build_object('person_id', :p_riya, 'track_id', :tr_g, 'level_id', :lv_g1)),
                                       4500, null, null, 'k77-riya-6') as r14 \gset
commit;
update app.funds set active = true where id = :fund_p;
select pg_temp.assert((select e.status = 'placed' and f.status = 'not_billed_giving_off' and f.pledge_id is null and f.billing_note like 'Not billed: there is no fund for the Pathshala fees yet%'
                         from app.pathshala_enrollments e join app.pathshala_enrollment_fees f on f.enrollment_id = e.id
                        where e.id = (:'r14'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid),
  'no Pathshala fund: the seat is given, the $45.00 is quoted and kept "not billed" with a note for the office (no pledge without a fund)');

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Money that arrives for a released seat through ANY checkout is credit, with a row for the treasurer
-- ════════════════════════════════════════════════════════════════════════════
begin;
select pg_temp.sign_in(:u_mira);
select app.register_pathshala_children(:t1, :h1, jsonb_build_array(jsonb_build_object('person_id', :p_riya, 'track_id', :tr_j, 'level_id', :lv_j5)),
                                       13000, null, null, 'k77-riya-1') as r15 \gset
-- The family pays from My Donations: a plain "pledges" checkout that names the fee pledge.
select app.create_checkout(:c, :h1, 13000, array[(:'r15'::jsonb -> 'lines' -> 0 -> 'pledge' ->> 'id')::uuid], null, 'pledges', 'Pledges') as ck_mydon \gset
commit;
select (:'r15'::jsonb -> 'lines' -> 0 ->> 'enrollment_id') as e_riya, (:'r15'::jsonb -> 'lines' -> 0 -> 'pledge' ->> 'id') as pl_riya,
       (:'ck_mydon'::jsonb ->> 'checkout_id') as ck_id \gset
update app.payment_checkouts set created_at = now() - interval '25 hours' where id = :'ck_id'::uuid;
update app.pathshala_enrollments set hold_expires_at = now() - interval '1 minute' where id = :'e_riya';
begin;
set local role connect_worker;
select app.worker_pathshala_holds_sweep() as sw_late \gset
commit;
select pg_temp.assert((select status = 'withdrawn' from app.pathshala_enrollments where id = :'e_riya')
                      and (select status = 'cancelled' from app.pledges where id = :'pl_riya'::uuid),
  'Riya''s unpaid hold is released: the seat is withdrawn and the fee pledge cancelled');
begin;
set local role connect_worker;
select app.worker_record_online_payment(:'ck_id'::uuid, 'pi_p77_late', 13000, 407, 'card') as paid_late \gset
commit;
select pg_temp.assert((select context = 'pledges' from app.payment_checkouts where id = :'ck_id'::uuid)
                      and not exists (select 1 from app.payment_allocations where payment_id = (:'paid_late'::jsonb ->> 'payment_id')::uuid)
                      and (select kind = 'pathshala_late_payment' and released_cents = 13000 and household_id = :h1 and enrollment_id = :'e_riya'::uuid and status = 'pending'
                             from app.rsvp_credit_releases where pledge_id = :'pl_riya'::uuid and kind = 'pathshala_late_payment'),
  'a My Donations (context pledges) checkout that pays a released fee pledge: $130.00 stays unallocated and a credit row (with the enrollment) goes to the treasurer');

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Lock order between the sweep and a payment
-- ════════════════════════════════════════════════════════════════════════════
begin;
select pg_temp.sign_in(:u_nita);
select app.register_pathshala_children(:t1, :h2, jsonb_build_array(jsonb_build_object('person_id', :p_isha, 'track_id', :tr_g, 'level_id', :lv_g1)),
                                       4500, null, null, 'k77-isha-1') as r16 \gset
commit;
select (:'r16'::jsonb -> 'lines' -> 0 ->> 'enrollment_id') as e_isha1, (:'r16'::jsonb -> 'lines' -> 0 -> 'pledge' ->> 'id') as pl_isha1 \gset
-- (a) The hook was busy (switched off here): the fee pledge is paid and the seat is still held. A release attempt stops.
alter table app.pledges disable trigger pathshala_fee_paid;
begin;
select pg_temp.sign_in(:u_tara);
select app.record_offline_payment(:h2, 4500, 'check', pg_temp.today(), array[:'pl_isha1'::uuid], '7703');
commit;
alter table app.pledges enable trigger pathshala_fee_paid;
select pg_temp.assert((select status = 'paid' from app.pledges where id = :'pl_isha1'::uuid)
                      and (select status = 'requested' and app._pathshala_hold(id) = 'payment' from app.pathshala_enrollments where id = :'e_isha1'),
  'the hook was busy: the fee pledge is paid and Isha''s seat is still held');
select app._pathshala_release_hold(:'e_isha1'::uuid, 'The fee was not paid') as rel \gset
select pg_temp.assert((:'rel'::jsonb ->> 'released')::boolean is false and (:'rel'::jsonb ->> 'paid')::boolean
                      and (select status = 'requested' and app._pathshala_hold(id) = 'payment' from app.pathshala_enrollments where id = :'e_isha1')
                      and (select status = 'paid' and paid_cents = 4500 from app.pledges where id = :'pl_isha1'::uuid)
                      and not exists (select 1 from app.rsvp_credit_releases where enrollment_id = :'e_isha1'::uuid),
  'releasing a hold stops when one of its fee pledges is paid: nothing cancelled, no credit, the learner still held');
update app.pathshala_enrollments set hold_expires_at = now() - interval '1 minute' where id = :'e_isha1';
begin;
set local role connect_worker;
select app.worker_pathshala_holds_sweep() as sw_a \gset
commit;
select pg_temp.assert((:'sw_a'::jsonb ->> 'paid_placed')::int = 1 and (:'sw_a'::jsonb ->> 'released')::int = 0
                      and (select e.status = 'placed' and e.class_id = :cl_g1 and f.status = 'paid' and f.hold_reason is null
                             from app.pathshala_enrollments e join app.pathshala_enrollment_fees f on f.enrollment_id = e.id where e.id = :'e_isha1'),
  'the sweep waits for nobody and places the paid seat (fee line paid, hold ended) instead of releasing it');
-- (b) One bad row does not roll back the others: two holds are released, the one that fails is logged and kept for the next run.
begin;
select pg_temp.sign_in(:u_nita);
select app.register_pathshala_children(:t1, :h2, jsonb_build_array(jsonb_build_object('person_id', :p_kiran, 'track_id', :tr_j, 'level_id', :lv_j2),
                                                                   jsonb_build_object('person_id', :p_mina, 'track_id', :tr_g, 'level_id', :lv_g1)),
                                       17500, null, null, 'k77-kiran-1') as r17 \gset
select pg_temp.sign_in(:u_mira);
select app.register_pathshala_children(:t1, :h1, jsonb_build_array(jsonb_build_object('person_id', :p_anya, 'track_id', :tr_g, 'level_id', :lv_g1)),
                                       4500, null, null, 'k77-anya-1') as r18 \gset
commit;
select (x ->> 'enrollment_id') as e_kiran1 from jsonb_array_elements(:'r17'::jsonb -> 'lines') x where x ->> 'person_id' = :p_kiran::text \gset
select (x ->> 'enrollment_id') as e_mina1 from jsonb_array_elements(:'r17'::jsonb -> 'lines') x where x ->> 'person_id' = :p_mina::text \gset
select (:'r18'::jsonb -> 'lines' -> 0 ->> 'enrollment_id') as e_anya1 \gset
update app.pathshala_enrollments set hold_expires_at = now() - interval '1 minute' where id in (:'e_kiran1'::uuid, :'e_mina1'::uuid, :'e_anya1'::uuid);
create function app.t77_boom() returns trigger language plpgsql as $$ begin
  if new.status = 'withdrawn' and new.id = (select e.id from app.pathshala_enrollments e where e.student_person_id = '77000000-0000-4000-8000-000000000109' and e.term_id = '77000000-0000-4000-8000-000000000501')
  then raise exception 'boom: this one row fails'; end if;
  return new;
end $$;
create trigger t77_boom before update on app.pathshala_enrollments for each row execute function app.t77_boom();
begin;
set local role connect_worker;
select app.worker_pathshala_holds_sweep() as sw_b \gset
commit;
drop trigger t77_boom on app.pathshala_enrollments;
drop function app.t77_boom();
select pg_temp.assert((:'sw_b'::jsonb ->> 'released')::int = 2 and (:'sw_b'::jsonb ->> 'failed')::int = 1
                      and (select status = 'withdrawn' from app.pathshala_enrollments where id = :'e_mina1'::uuid)
                      and (select status = 'withdrawn' from app.pathshala_enrollments where id = :'e_anya1'::uuid)
                      and (select status = 'requested' and app._pathshala_hold(id) = 'payment' from app.pathshala_enrollments where id = :'e_kiran1'::uuid)
                      and (select status = 'open' from app.pledges where source = 'pathshala_fee' and source_ref_id = :'e_kiran1'::uuid)
                      and exists (select 1 from app.audit_log where action = 'pathshala.sweep_failed' and record_id = :'e_kiran1' and (after ->> 'step') = 'release'),
  'sweep: Mina and Anya are released; Kiran''s failure is written to the audit log and rolled back alone (still held, pledge still open)');
begin;
set local role connect_worker;
select app.worker_pathshala_holds_sweep() as sw_c \gset
commit;
select pg_temp.assert((:'sw_c'::jsonb ->> 'released')::int = 1 and (:'sw_c'::jsonb ->> 'failed')::int = 0
                      and (select status = 'withdrawn' from app.pathshala_enrollments where id = :'e_kiran1'::uuid),
  'the next run releases Kiran');
-- (c) The hook never waits long, and a statement timeout inside it cannot fail a payment.
select pg_temp.assert((select proconfig @> array['lock_timeout=3s'] from pg_proc where oid = 'app._pathshala_fee_paid(uuid, boolean)'::regprocedure)
                      and (select prosrc like '%query_canceled%' from pg_proc where oid = 'app.pathshala_fee_paid_trigger()'::regprocedure)
                      and (select prosrc like '%pg_try_advisory_xact_lock%' from pg_proc where oid = 'app._pathshala_try_lock_level(uuid, uuid)'::regprocedure),
  'the paid-fee hook gives up after 3 seconds of waiting, takes its locks without waiting, and its trigger swallows a statement timeout');

-- ════════════════════════════════════════════════════════════════════════════
-- 8. A new child in two tracks is one child: one add-member request, one rank, one late fee
-- ════════════════════════════════════════════════════════════════════════════
begin;
select pg_temp.sign_in(:u_nita);
select app.register_pathshala_children(:t3, :h2, jsonb_build_array(
  jsonb_build_object('new_child', jsonb_build_object('first_name', 'Ravi', 'last_name', 'Mehta', 'date_of_birth', '2016-09-09'), 'track_id', :tr_j, 'level_id', :lv_j2),
  jsonb_build_object('new_child', jsonb_build_object('first_name', 'Ravi', 'last_name', 'Mehta', 'date_of_birth', '2016-09-09'), 'track_id', :tr_g, 'level_id', :lv_g1)),
  null, null, null, 'k77-ravi-3') as r19 \gset
commit;
select pg_temp.assert((select count(*) = 2 and bool_and(x ->> 'outcome' = 'pending_child') and count(distinct x ->> 'family_rank') = 1
                              and sum((x ->> 'late_fee_cents')::int) = (select late_fee_cents from app.pathshala_terms where id = :t3) and count(*) filter (where (x ->> 'late_fee_cents')::int > 0) = 1
                         from jsonb_array_elements(:'r19'::jsonb -> 'lines') x),
  'a new child in two tracks: two lines, one family rank, ONE late fee (the term''s, once)');
select pg_temp.assert((select count(distinct change_request_id) = 1 and count(*) = 2 from app.pathshala_pending_registrations where registration_id = (:'r19'::jsonb ->> 'registration_id')::uuid)
                      and (select count(*) = 1 from app.household_change_requests r where r.household_id = :h2 and r.kind = 'add_member' and r.status = 'open'
                              and lower(r.details ->> 'first_name') = 'ravi')
                      and jsonb_array_length(:'r19'::jsonb -> 'pending') = 2,
  'a new child in two tracks: ONE add-member request (the office decides once), two pending registrations');
begin;
select pg_temp.sign_in(:u_tara);
select app.decide_household_change_request((select distinct change_request_id from app.pathshala_pending_registrations where registration_id = (:'r19'::jsonb ->> 'registration_id')::uuid),
                                           'approve', 'child') as ravi_person \gset
commit;
select pg_temp.assert((select count(*) = 2 and bool_and(e.student_person_id = :'ravi_person'::uuid) and count(distinct e.track_id) = 2 and bool_and(e.status = 'placed')
                         from app.pathshala_pending_registrations pr join app.pathshala_enrollments e on e.id = pr.enrollment_id
                        where pr.registration_id = (:'r19'::jsonb ->> 'registration_id')::uuid and pr.status = 'converted'),
  'the office adds Ravi once: both registrations go ahead (one enrollment per track), each placed');
