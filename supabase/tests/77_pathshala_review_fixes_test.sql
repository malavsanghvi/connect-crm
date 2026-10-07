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
