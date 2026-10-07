-- 0591 (Pathshala registration plan v2, PR 2 "DB2"): registering in both payment modes, seats under a lock, holds and
-- the 15-minute sweep, the paid-fee hook through every payment channel, billing (one pledge per enrollment), the
-- waitlist, membership holds, pending children, the waiver, the office's functions, the queue and the Home counts.
-- Everything runs in its own community (P76).
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
-- The error code the apps read (22023: a rule the user can fix; 42501: not allowed; P0002: not found), and the hint.
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
\set c '''76000000-0000-4000-8000-0000000000c1'''
\set u_pia '''76000000-0000-4000-8000-000000000001'''
\set u_tara '''76000000-0000-4000-8000-000000000002'''
\set u_mira '''76000000-0000-4000-8000-000000000003'''
\set u_riya '''76000000-0000-4000-8000-000000000004'''
\set u_nita '''76000000-0000-4000-8000-000000000005'''
\set u_rahul '''76000000-0000-4000-8000-000000000006'''
\set u_priya '''76000000-0000-4000-8000-000000000007'''
\set u_lata '''76000000-0000-4000-8000-000000000008'''
\set u_asha '''76000000-0000-4000-8000-000000000009'''
\set u_cora '''76000000-0000-4000-8000-00000000000a'''
\set u_leela '''76000000-0000-4000-8000-00000000000b'''
\set p_pia '''76000000-0000-4000-8000-000000000101'''
\set p_tara '''76000000-0000-4000-8000-000000000102'''
\set p_mira '''76000000-0000-4000-8000-000000000103'''
\set p_riya '''76000000-0000-4000-8000-000000000104'''
\set p_dev '''76000000-0000-4000-8000-000000000105'''
\set p_anya '''76000000-0000-4000-8000-000000000106'''
\set p_rahul '''76000000-0000-4000-8000-000000000107'''
\set p_nita '''76000000-0000-4000-8000-000000000108'''
\set p_kiran '''76000000-0000-4000-8000-000000000109'''
\set p_isha '''76000000-0000-4000-8000-00000000010a'''
\set p_priya '''76000000-0000-4000-8000-00000000010b'''
\set p_om '''76000000-0000-4000-8000-00000000010c'''
\set p_lata '''76000000-0000-4000-8000-00000000010d'''
\set p_ved '''76000000-0000-4000-8000-00000000010e'''
\set p_mina '''76000000-0000-4000-8000-00000000010f'''
\set p_asha '''76000000-0000-4000-8000-000000000110'''
\set p_jay '''76000000-0000-4000-8000-000000000111'''
\set p_neel '''76000000-0000-4000-8000-000000000112'''
\set p_kavya '''76000000-0000-4000-8000-000000000113'''
\set p_cora '''76000000-0000-4000-8000-000000000114'''
\set p_leela '''76000000-0000-4000-8000-000000000115'''
\set p_sai '''76000000-0000-4000-8000-000000000116'''
\set h1 '''76000000-0000-4000-8000-000000000201'''
\set h2 '''76000000-0000-4000-8000-000000000202'''
\set h3 '''76000000-0000-4000-8000-000000000203'''
\set h4 '''76000000-0000-4000-8000-000000000204'''
\set h5 '''76000000-0000-4000-8000-000000000205'''
\set h6 '''76000000-0000-4000-8000-000000000206'''
\set tr_j '''76000000-0000-4000-8000-000000000301'''
\set tr_g '''76000000-0000-4000-8000-000000000302'''
\set lv_tod '''76000000-0000-4000-8000-000000000400'''
\set lv_j2 '''76000000-0000-4000-8000-000000000402'''
\set lv_j3 '''76000000-0000-4000-8000-000000000403'''
\set lv_j5 '''76000000-0000-4000-8000-000000000405'''
\set lv_dads '''76000000-0000-4000-8000-000000000408'''
\set lv_moms '''76000000-0000-4000-8000-000000000409'''
\set lv_g1 '''76000000-0000-4000-8000-000000000411'''
\set t1 '''76000000-0000-4000-8000-000000000501'''
\set t2 '''76000000-0000-4000-8000-000000000502'''
\set t3 '''76000000-0000-4000-8000-000000000503'''
\set t4 '''76000000-0000-4000-8000-000000000504'''
\set cl_tod '''76000000-0000-4000-8000-000000000600'''
\set cl_j2 '''76000000-0000-4000-8000-000000000602'''
\set cl_j3 '''76000000-0000-4000-8000-000000000603'''
\set cl_j5 '''76000000-0000-4000-8000-000000000605'''
\set cl_dads '''76000000-0000-4000-8000-000000000608'''
\set cl_moms '''76000000-0000-4000-8000-000000000609'''
\set cl_g1 '''76000000-0000-4000-8000-000000000611'''
\set cl2_tod '''76000000-0000-4000-8000-000000000620'''
\set cl2_j2 '''76000000-0000-4000-8000-000000000622'''
\set cl2_j5 '''76000000-0000-4000-8000-000000000625'''
\set cl2_g1 '''76000000-0000-4000-8000-000000000631'''
\set cl4_j2 '''76000000-0000-4000-8000-000000000642'''
\set fund_p '''76000000-0000-4000-8000-000000000701'''
\set ba '''76000000-0000-4000-8000-000000000702'''

insert into app.centers (id, slug, name, short_name, time_zone, environment) values (:c, 'p76-temple', 'P76 Jain Temple', 'P76', 'America/Chicago', 'production');
insert into auth.users (id, email) values
  (:u_pia, 'pia@p76.test'), (:u_tara, 'tara@p76.test'), (:u_mira, 'mira@p76.test'), (:u_riya, 'riya@p76.test'), (:u_nita, 'nita@p76.test'),
  (:u_rahul, 'rahul@p76.test'), (:u_priya, 'priya@p76.test'), (:u_lata, 'lata@p76.test'), (:u_asha, 'asha@p76.test'), (:u_cora, 'cora@p76.test'),
  (:u_leela, 'leela@p76.test');
-- Ages on the cut-off (the first day, 2026-09-06): Riya 12, Dev 9, Anya 4, Kiran 10, Isha 10, Om 8, Ved 9, Mina 4, Jay 9,
-- Neel 10, Kavya 12, Sai 9.
insert into app.people (id, center_id, first_name, last_name, date_of_birth, email) values
  (:p_pia, :c, 'Pia', 'Principal', '1975-05-05', 'pia@p76.test'), (:p_tara, :c, 'Tara', 'Treasurer', '1970-01-01', 'tara@p76.test'),
  (:p_mira, :c, 'Mira', 'Shah', '1982-02-02', 'mira@p76.test'), (:p_riya, :c, 'Riya', 'Shah', '2014-03-10', 'riya@p76.test'),
  (:p_dev, :c, 'Dev', 'Shah', '2017-01-15', null), (:p_anya, :c, 'Anya', 'Shah', '2022-05-01', null),
  (:p_rahul, :c, 'Rahul', 'Shah', '1980-04-04', 'rahul@p76.test'),
  (:p_nita, :c, 'Nita', 'Mehta', '1984-08-08', 'nita@p76.test'), (:p_kiran, :c, 'Kiran', 'Mehta', '2016-02-02', null),
  (:p_isha, :c, 'Isha', 'Mehta', '2016-07-07', null),
  (:p_priya, :c, 'Priya', 'Patel', '1985-03-03', 'priya@p76.test'), (:p_om, :c, 'Om', 'Patel', '2018-01-01', null),
  (:p_lata, :c, 'Lata', 'Desai', '1983-03-03', 'lata@p76.test'), (:p_ved, :c, 'Ved', 'Desai', '2017-06-01', null),
  (:p_mina, :c, 'Mina', 'Desai', '2022-01-01', null),
  (:p_asha, :c, 'Asha', 'Joshi', '1981-01-01', 'asha@p76.test'), (:p_jay, :c, 'Jay', 'Joshi', '2017-03-03', null),
  (:p_neel, :c, 'Neel', 'Joshi', '2016-05-05', null), (:p_kavya, :c, 'Kavya', 'Joshi', '2014-01-01', null),
  (:p_cora, :c, 'Cora', 'Committee', '1966-06-06', 'cora@p76.test'),
  (:p_leela, :c, 'Leela', 'Rao', '1986-06-06', 'leela@p76.test'), (:p_sai, :c, 'Sai', 'Rao', '2017-02-02', null);
insert into app.households (id, center_id, display_name) values
  (:h1, :c, 'Shah household'), (:h2, :c, 'Mehta household'), (:h3, :c, 'Patel household'), (:h4, :c, 'Desai household'),
  (:h5, :c, 'Joshi household'), (:h6, :c, 'Rao household');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :p_mira, :c, 'primary', true), (:h1, :p_rahul, :c, 'spouse', false), (:h1, :p_riya, :c, 'child', false),
  (:h1, :p_dev, :c, 'child', false), (:h1, :p_anya, :c, 'child', false),
  (:h2, :p_nita, :c, 'primary', true), (:h2, :p_kiran, :c, 'child', false), (:h2, :p_isha, :c, 'child', false),
  (:h3, :p_priya, :c, 'primary', true), (:h3, :p_om, :c, 'child', false),
  (:h4, :p_lata, :c, 'primary', true), (:h4, :p_ved, :c, 'child', false), (:h4, :p_mina, :c, 'child', false),
  (:h5, :p_asha, :c, 'primary', true), (:h5, :p_jay, :c, 'child', false), (:h5, :p_neel, :c, 'child', false), (:h5, :p_kavya, :c, 'child', false),
  (:h6, :p_leela, :c, 'primary', true), (:h6, :p_sai, :c, 'child', false);
insert into app.center_users (center_id, user_id, person_id, is_default) values
  (:c, :u_pia, :p_pia, false), (:c, :u_tara, :p_tara, false), (:c, :u_mira, :p_mira, false), (:c, :u_riya, :p_riya, false),
  (:c, :u_nita, :p_nita, false), (:c, :u_rahul, :p_rahul, false), (:c, :u_priya, :p_priya, false), (:c, :u_lata, :p_lata, false),
  (:c, :u_asha, :p_asha, false), (:c, :u_cora, :p_cora, false), (:c, :u_leela, :p_leela, false);
insert into app.role_grants (center_id, user_id, role_key) values
  (:c, :u_pia, 'pathshala_principal'), (:c, :u_tara, 'treasurer'), (:c, :u_cora, 'pathshala_committee');
insert into app.funds (id, center_id, key, name) values (:fund_p, :c, 'pathshala', 'Pathshala');
insert into app.membership_types (center_id, key, tier, name, period_months) values (:c, 'yearly', 'yearly', 'Yearly membership', 12);
insert into app.memberships (center_id, household_id, person_id, membership_type_id, tier, status, starts_on)
select :c, x.h, x.p, mt.id, 'yearly', 'active', current_date - 30
  from app.membership_types mt, (values (:h1::uuid, :p_mira::uuid), (:h2, :p_nita), (:h4, :p_lata), (:h5, :p_asha)) x(h, p)
 where mt.center_id = :c and mt.key = 'yearly';
-- Card payments are live (pay now needs them to take a registration), and the Zelle details exist for reports.
insert into app.integration_connections (id, center_id, provider, status, settings)
values ('76000000-0000-4000-8000-000000000703', :c, 'stripe', 'connected', '{"mode":"live"}');
insert into app.center_payment_processors (center_id, processor, connection_id, status, methods, is_default)
values (:c, 'stripe', '76000000-0000-4000-8000-000000000703', 'live', array['card'], true);
insert into app.center_payment_methods (center_id, method, accepted, instructions, sort) values
  (:c, 'zelle', true, '{"recipient":"give@p76.test","name":"P76 Jain Temple"}', 3);
insert into app.bank_accounts (id, center_id, name, institution, last4, statement_format) values (:ba, :c, 'Chase operating', 'Chase', '7676', 'chase_csv');

insert into app.pathshala_tracks (id, center_id, key, name) values (:tr_j, :c, 'jainism', 'Jainism'), (:tr_g, :c, 'gujarati', 'Gujarati');
insert into app.pathshala_levels (id, center_id, track_id, key, name, sort_order, min_age, max_age) values
  (:lv_tod, :c, :tr_j, 'toddler', 'Toddler', 0, 3, 5), (:lv_j2, :c, :tr_j, '2', 'Jainism 2', 2, 8, 10),
  (:lv_j3, :c, :tr_j, '3', 'Jainism 3', 3, 9, 11), (:lv_j5, :c, :tr_j, '5', 'Jainism 5', 5, 11, 13),
  (:lv_dads, :c, :tr_j, 'adult_dads', 'Adult class (Dads)', 8, 18, null), (:lv_moms, :c, :tr_j, 'adult_moms', 'Adult class (Moms)', 9, 18, null),
  (:lv_g1, :c, :tr_g, '1', 'Gujarati 1', 1, null, null);
-- T1: pledge mode (the default). T2: pay now (opened in pledge mode, then switched by the database: pay now cannot be
-- chosen until fee receipts, 0595). T3: a draft. T4: the office step (seat rule "office").
insert into app.pathshala_terms (id, center_id, name, starts_on, ends_on, sibling_discount_pct, fee_per_family_cap_cents, registration_closes_at) values
  (:t1, :c, '2026-27', '2026-09-06', '2027-05-30', 10, 27500, now() + interval '30 days'),
  (:t2, :c, 'Summer 2027', '2026-09-06', '2027-05-30', 0, null, null),
  (:t3, :c, '2027-28', '2027-09-05', '2028-05-28', 10, null, null),
  (:t4, :c, 'Office term', '2026-09-06', '2027-05-30', 10, null, null);
insert into app.pathshala_classes (id, center_id, term_id, level_id, name, room, capacity, meets_on, starts_time, ends_time, waitlist_enabled) values
  (:cl_tod, :c, :t1, :lv_tod, 'Toddler · Room T', 'T', 10, 'sunday', '10:00', '11:00', true),
  (:cl_j2, :c, :t1, :lv_j2, 'Jainism 2 · Room B', 'B', 2, 'sunday', '10:00', '11:30', true),
  (:cl_j3, :c, :t1, :lv_j3, 'Jainism 3 · Room D', 'D', 1, 'sunday', '10:00', '11:30', false),
  (:cl_j5, :c, :t1, :lv_j5, 'Jainism 5 · Room C', 'C', 15, 'sunday', '10:00', '11:30', true),
  (:cl_dads, :c, :t1, :lv_dads, 'Adult class (Dads)', 'Hall 2', 20, 'sunday', '10:00', '11:30', true),
  (:cl_moms, :c, :t1, :lv_moms, 'Adult class (Moms)', 'Hall', 20, 'sunday', '10:00', '11:30', true),
  (:cl_g1, :c, :t1, :lv_g1, 'Gujarati 1 · Library', 'Library', 10, 'sunday', '11:45', '12:45', true),
  (:cl2_tod, :c, :t2, :lv_tod, 'Toddler · summer', 'T', 5, 'sunday', '10:00', '11:00', true),
  (:cl2_j2, :c, :t2, :lv_j2, 'Jainism 2 · summer', 'B', 4, 'sunday', '10:00', '11:30', true),
  (:cl2_j5, :c, :t2, :lv_j5, 'Jainism 5 · summer', 'C', 2, 'sunday', '10:00', '11:30', true),
  (:cl2_g1, :c, :t2, :lv_g1, 'Gujarati 1 · summer', 'Library', 1, 'sunday', '11:45', '12:45', true),
  (:cl4_j2, :c, :t4, :lv_j2, 'Jainism 2 · office', 'B', 2, 'sunday', '10:00', '11:30', true);

begin;
select pg_temp.sign_in(:u_pia);
select app.set_pathshala_level_fees(:t1, jsonb_build_array(
  jsonb_build_object('level_id', :lv_tod, 'fee_cents', 4500), jsonb_build_object('level_id', :lv_j2, 'fee_cents', 13000),
  jsonb_build_object('level_id', :lv_j3, 'fee_cents', 13000), jsonb_build_object('level_id', :lv_j5, 'fee_cents', 13000),
  jsonb_build_object('level_id', :lv_dads, 'fee_cents', 5000), jsonb_build_object('level_id', :lv_moms, 'fee_cents', 5000),
  jsonb_build_object('level_id', :lv_g1, 'fee_cents', 13000)));
select app.open_pathshala_registration(:t1);
select app.set_pathshala_level_fees(:t2, jsonb_build_array(
  jsonb_build_object('level_id', :lv_tod, 'fee_cents', 0), jsonb_build_object('level_id', :lv_j2, 'fee_cents', 13000),
  jsonb_build_object('level_id', :lv_j5, 'fee_cents', 13000), jsonb_build_object('level_id', :lv_g1, 'fee_cents', 4500)));
select app.set_pathshala_term_rules(:t2, '{"office_payment_allowed": true}');
select app.open_pathshala_registration(:t2);
select app.set_pathshala_level_fees(:t4, jsonb_build_array(jsonb_build_object('level_id', :lv_j2, 'fee_cents', 13000)));
select app.set_pathshala_term_rules(:t4, '{"seat_rule": "office"}');
select app.open_pathshala_registration(:t4);
commit;
-- What 0595 and B28 PR 1 will allow one day: the summer term takes the fee when families register.
update app.pathshala_terms set payment_mode = 'pay_now' where id = :t2;

-- ═════════════════════════════════════════════════════════════════════════════
-- Pledge mode: a seat places the learner and bills one pledge per enrollment
-- ═════════════════════════════════════════════════════════════════════════════
\set family '''[{"person_id":"76000000-0000-4000-8000-000000000104","track_id":"76000000-0000-4000-8000-000000000301","level_id":"76000000-0000-4000-8000-000000000405"},{"person_id":"76000000-0000-4000-8000-000000000105","track_id":"76000000-0000-4000-8000-000000000301","level_id":"76000000-0000-4000-8000-000000000402","note":"Please seat him near the front"},{"person_id":"76000000-0000-4000-8000-000000000106","track_id":"76000000-0000-4000-8000-000000000301","level_id":"76000000-0000-4000-8000-000000000400"},{"person_id":"76000000-0000-4000-8000-000000000103","track_id":"76000000-0000-4000-8000-000000000301","level_id":"76000000-0000-4000-8000-000000000409"}]'''
begin;
select pg_temp.sign_in(:u_mira);
select app.preview_pathshala_registration(:t1, :h1, :family::jsonb) as pv1 \gset
select app.register_pathshala_children(:t1, :h1, :family::jsonb, 32500, (:'pv1'::jsonb) -> 'lines', null, 'shah-2026-k1') as reg1 \gset
commit;
select pg_temp.assert((select array_agg((x ->> 'outcome') || '/' || (x ->> 'total_cents') order by o) from jsonb_array_elements(:'reg1'::jsonb -> 'lines') with ordinality a(x, o))
                        = array['seat/13000', 'seat/11700', 'seat/2800', 'seat/5000']
                      and (:'reg1'::jsonb ->> 'total_cents')::int = 32500 and (:'reg1'::jsonb -> 'pay') = 'null'::jsonb
                      and (select bool_and(x ->> 'enrollment_id' is not null and jsonb_typeof(x -> 'pledge') = 'object' and x -> 'pledge' ->> 'number' is not null)
                             from jsonb_array_elements(:'reg1'::jsonb -> 'lines') x),
  'pledge mode: the owner''s family gets four seats, $325.00, and each line its enrollment and its pledge (number and due date)');
select pg_temp.assert((select array_agg(e.status || '/' || c.name order by e.registered_at, p.first_name)
                         from app.pathshala_enrollments e join app.pathshala_classes c on c.id = e.class_id join app.people p on p.id = e.student_person_id
                        where e.registration_id = (:'reg1'::jsonb ->> 'registration_id')::uuid)
                        @> array['placed/Jainism 5 · Room C', 'placed/Jainism 2 · Room B', 'placed/Toddler · Room T', 'placed/Adult class (Moms)']
                      and (select bool_and(e.track_id = :tr_j and e.channel = 'app' and e.placed_at is not null and e.hold_reason is null)
                             from app.pathshala_enrollments e where e.registration_id = (:'reg1'::jsonb ->> 'registration_id')::uuid)
                      and (select notes from app.pathshala_enrollments where term_id = :t1 and student_person_id = :p_dev) = 'Please seat him near the front',
  'pledge mode: each learner is placed in the class of their level (track recorded, the family''s note kept)');
select pg_temp.assert((select count(*) = 4 and bool_and(pl.campaign_id = t.campaign_id and pl.fund_id = :fund_p and pl.source = 'pathshala_fee'
                                                         and pl.source_ref_id = e.id and pl.amount_cents = f.total_cents and pl.status = 'open'
                                                         and pl.household_id = :h1 and pl.pledged_by_person_id = :p_mira
                                                         and pl.due_on = pg_temp.today() + 14 and f.status = 'billed' and f.pledge_id = pl.id
                                                         and e.fee_pledge_id = pl.id)
                         from app.pathshala_enrollments e join app.pathshala_terms t on t.id = e.term_id
                         join app.pathshala_enrollment_fees f on f.enrollment_id = e.id join app.pledges pl on pl.id = f.pledge_id
                        where e.registration_id = (:'reg1'::jsonb ->> 'registration_id')::uuid),
  'pledge mode: one pledge per enrollment with the term''s campaign and fund, source pathshala_fee, source_ref_id = the enrollment, the line''s amount, due 14 days after the seat (the first class day has passed)');
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'pathshala_enrollments'
                         and reason = 'Shah household registered 4 learners for Pathshala 2026-27, pledge mode, $325.00') >= 4,
  'pledge mode: the registration is audited in plain words');
select pg_temp.assert((select count(*) from app.messages where center_id = :c and template_key = 'pathshala_registration_received' and to_address in (:u_mira::text, 'mira@p76.test')) = 2
                      and (select count(*) from app.messages where center_id = :c and template_key = 'pathshala_registered' and to_address in (:u_rahul::text, 'rahul@p76.test')) = 8
                      and not exists (select 1 from app.messages where center_id = :c and template_key = 'pathshala_registered' and to_address in (:u_mira::text, 'mira@p76.test'))
                      and not exists (select 1 from app.messages where center_id = :c and to_address in (:u_riya::text, 'riya@p76.test'))
                      and (select bool_and(payload ->> 'type' = 'pathshala' and payload ->> 'deep_link' like '/pathshala?person=%')
                             from app.messages where center_id = :c and template_key = 'pathshala_registered' and channel = 'push'),
  'messages: the summary to Mira, each learner''s news to the other adult of the household (never a child), pushes routed to the learner''s page');

-- The same request again (a retry) gives the same answer; the same key with other details is refused.
begin;
select pg_temp.sign_in(:u_mira);
select app.register_pathshala_children(:t1, :h1, :family::jsonb, 32500, (:'pv1'::jsonb) -> 'lines', null, 'shah-2026-k1') as reg1b \gset
select pg_temp.assert_code(format($$select app.register_pathshala_children(%L, %L, %L, null, null, null, 'shah-2026-k1')$$, :t1, :h1,
  jsonb_build_array(jsonb_build_object('person_id', :p_dev, 'track_id', :tr_g, 'level_id', :lv_g1))),
  '22023', 'This registration was already sent with other details', 'idempotent: the same key with other details is refused');
commit;
select pg_temp.assert((:'reg1b'::jsonb ->> 'registration_id') = (:'reg1'::jsonb ->> 'registration_id') and (:'reg1b'::jsonb ->> 'replayed')::boolean
                      and (select count(*) from app.pathshala_enrollments where household_id = :h1 and term_id = :t1) = 4
                      and (select count(*) from app.pledges where household_id = :h1 and source = 'pathshala_fee') = 4,
  'idempotent: the same client key returns the same registration and creates nothing more');

-- ═════════════════════════════════════════════════════════════════════════════
-- The last seat: never sold twice; a changed outcome or total is refused (hint review_again)
-- ═════════════════════════════════════════════════════════════════════════════
-- Jainism 2 has 2 seats: Dev took one. The Joshis preview Jay while one is left; the Mehtas register Kiran first.
begin;
select pg_temp.sign_in(:u_asha);
select app.preview_pathshala_registration(:t1, :h5, jsonb_build_array(jsonb_build_object('person_id', :p_jay, 'track_id', :tr_j, 'level_id', :lv_j2))) as pv_jay \gset
commit;
begin;
select pg_temp.sign_in(:u_nita);
select app.register_pathshala_children(:t1, :h2, jsonb_build_array(jsonb_build_object('person_id', :p_kiran, 'track_id', :tr_j, 'level_id', :lv_j2)),
                                       13000, '["seat"]', null, 'mehta-k1') as reg_kiran \gset
commit;
begin;
select pg_temp.sign_in(:u_asha);
select pg_temp.assert_code(format($$select app.register_pathshala_children(%L, %L, %L, 13000, %L, null, 'joshi-k1')$$, :t1, :h5,
  jsonb_build_array(jsonb_build_object('person_id', :p_jay, 'track_id', :tr_j, 'level_id', :lv_j2)), (:'pv_jay'::jsonb) -> 'lines'),
  '22023', 'The last seat in Jainism 2 was just taken. Jay can join the waitlist instead: please review again.',
  'the last seat: the family that looked first is told plainly that it was just taken (hint review_again)', 'review_again');
select pg_temp.assert_code(format($$select app.register_pathshala_children(%L, %L, %L, 1, null, null, 'joshi-k2')$$, :t1, :h5,
  jsonb_build_array(jsonb_build_object('person_id', :p_jay, 'track_id', :tr_j, 'level_id', :lv_j2))),
  '22023', 'The fee changed since you looked; please review the new total ($130.00).', 'a changed total is refused (hint review_again)', 'review_again');
select app.register_pathshala_children(:t1, :h5, jsonb_build_array(jsonb_build_object('person_id', :p_jay, 'track_id', :tr_j, 'level_id', :lv_j2)),
                                       13000, '["waitlist"]', null, 'joshi-k3') as reg_jay \gset
commit;
begin;
select pg_temp.sign_in(:u_asha);
select app.register_pathshala_children(:t1, :h5, jsonb_build_array(jsonb_build_object('person_id', :p_neel, 'track_id', :tr_j, 'level_id', :lv_j2)),
                                       null, null, null, 'joshi-k4') as reg_neel \gset
commit;
select pg_temp.assert((:'pv_jay'::jsonb -> 'lines' -> 0 ->> 'outcome') = 'seat' and (:'reg_kiran'::jsonb -> 'lines' -> 0 ->> 'outcome') = 'seat'
                      and (:'reg_jay'::jsonb -> 'lines' -> 0 ->> 'outcome') = 'waitlist' and (:'reg_jay'::jsonb -> 'lines' -> 0 -> 'pledge') = 'null'::jsonb
                      and (select status = 'waitlisted' and waitlisted_at is not null and class_id is null from app.pathshala_enrollments
                            where id = (:'reg_jay'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid)
                      and (select status from app.pathshala_enrollment_fees where enrollment_id = (:'reg_jay'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid) = 'quoted'
                      and app.pathshala_waitlist_position((:'reg_neel'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid) = 2,
  'the last seat: Kiran got it; Jay joins the waitlist (no pledge; the quote is locked), Neel is number 2');
select pg_temp.assert((select s.taken = 2 and s.free = 0 and s.waitlist = 2 from app.pathshala_level_seats(:t1, :lv_j2) s),
  'seats: Jainism 2 is full (2 of 2) with 2 waiting');
-- Jainism 3 has one seat and no waitlist.
begin;
select pg_temp.sign_in(:u_lata);
select app.register_pathshala_children(:t1, :h4, jsonb_build_array(jsonb_build_object('person_id', :p_ved, 'track_id', :tr_j, 'level_id', :lv_j3))) as reg_ved \gset
commit;
begin;
select pg_temp.sign_in(:u_nita);
select pg_temp.assert_code(format($$select app.register_pathshala_children(%L, %L, %L)$$, :t1, :h2,
  jsonb_build_array(jsonb_build_object('person_id', :p_isha, 'track_id', :tr_j, 'level_id', :lv_j3))),
  '22023', 'Jainism 3 is full and has no waitlist. Ask the Pathshala office.', 'a full level with no waitlist is refused in plain English');
rollback;

-- ═════════════════════════════════════════════════════════════════════════════
-- "Not sure of the level" (pledge mode, P25): the office places, then it is billed at that level, at the child's rank
-- ═════════════════════════════════════════════════════════════════════════════
begin;
select pg_temp.sign_in(:u_mira);
select app.register_pathshala_children(:t1, :h1, jsonb_build_array(jsonb_build_object('person_id', :p_dev, 'track_id', :tr_g, 'level_id', null)),
                                       0, '["office"]') as reg_devg \gset
commit;
select pg_temp.assert((:'reg_devg'::jsonb -> 'lines' -> 0 ->> 'outcome') = 'office'
                      and (select e.status = 'requested' and e.hold_reason is null and f.status = 'quoted' and not f.priced and f.family_rank = 2 and f.pledge_id is null
                             from app.pathshala_enrollments e join app.pathshala_enrollment_fees f on f.enrollment_id = e.id
                            where e.id = (:'reg_devg'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid),
  'not sure: Dev''s Gujarati waits for the office (rank 2 kept, not priced, nothing billed)');
begin;
select pg_temp.sign_in(:u_pia);
select app.place_pathshala_enrollment((:'reg_devg'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid, :cl_g1) as placed_devg \gset
commit;
select pg_temp.assert((:'placed_devg'::jsonb ->> 'outcome') = 'placed'
                      and (select e.status = 'placed' and e.class_id = :cl_g1 and f.priced and f.level_id = :lv_g1 and f.base_fee_cents = 13000
                                  and f.sibling_discount_cents = 1300 and f.cap_reduction_cents = 11700 and f.total_cents = 0 and f.status = 'no_fee'
                                  and jsonb_array_length(f.requotes) = 1
                             from app.pathshala_enrollments e join app.pathshala_enrollment_fees f on f.enrollment_id = e.id
                            where e.id = (:'reg_devg'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid),
  'not sure: placed in Gujarati 1 and priced then at his rank: $130 less 10%, cut to the $275 cap the family already reached: no fee');

-- One enrollment per learner per track (P10).
begin;
select pg_temp.sign_in(:u_mira);
select pg_temp.assert_code(format($$select app.register_pathshala_children(%L, %L, %L)$$, :t1, :h1,
  jsonb_build_array(jsonb_build_object('person_id', :p_dev, 'track_id', :tr_j, 'level_id', :lv_j5))),
  '22023', 'Dev is already registered for Jainism in 2026-27 (placed).', 'one enrollment per track: a second Jainism registration is refused');
rollback;
select pg_temp.assert_raises(format($$insert into app.pathshala_enrollments (center_id, term_id, student_person_id, household_id, track_id, status) values (%L, %L, %L, %L, %L, 'requested')$$,
  :c, :t1, :p_dev, :h1, :tr_j), 'pathshala_enrollments_term_student_track_key', 'one enrollment per track: the table refuses a second one too');

-- ═════════════════════════════════════════════════════════════════════════════
-- Membership (P6): held, then going ahead by itself when the membership is active
-- ═════════════════════════════════════════════════════════════════════════════
begin;
select pg_temp.sign_in(:u_priya);
select app.register_pathshala_children(:t1, :h3, jsonb_build_array(jsonb_build_object('person_id', :p_om, 'track_id', :tr_g, 'level_id', :lv_g1))) as reg_om \gset
commit;
select pg_temp.assert((:'reg_om'::jsonb -> 'lines' -> 0 ->> 'outcome') = 'membership_hold'
                      and (select e.status = 'requested' and e.hold_reason = 'membership' and f.status = 'quoted' and f.pledge_id is null
                             from app.pathshala_enrollments e join app.pathshala_enrollment_fees f on f.enrollment_id = e.id
                            where e.id = (:'reg_om'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid),
  'membership: a family that is not a member is held (no seat, no bill)');
insert into app.memberships (center_id, household_id, person_id, membership_type_id, tier, status, starts_on)
select :c, :h3, :p_priya, id, 'yearly', 'active', current_date from app.membership_types where center_id = :c and key = 'yearly';
select pg_temp.assert((select e.status = 'placed' and e.hold_reason is null and e.class_id = :cl_g1 and f.status = 'billed' and f.total_cents = 13000
                         from app.pathshala_enrollments e join app.pathshala_enrollment_fees f on f.enrollment_id = e.id
                        where e.id = (:'reg_om'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid)
                      and exists (select 1 from app.messages where center_id = :c and template_key = 'pathshala_hold_lifted' and to_address = :u_priya::text),
  'membership: when the family''s membership becomes active the hold lifts by itself: placed and billed, and the family told');

-- ═════════════════════════════════════════════════════════════════════════════
-- A child not yet on the family: pending, then registered at the original time
-- ═════════════════════════════════════════════════════════════════════════════
begin;
select pg_temp.sign_in(:u_mira);
select app.register_pathshala_children(:t1, :h1, jsonb_build_array(jsonb_build_object(
  'new_child', jsonb_build_object('first_name', 'Tara', 'last_name', 'Shah', 'date_of_birth', '2021-05-01', 'relationship', 'child'),
  'track_id', :tr_j, 'level_id', :lv_tod, 'note', 'Our youngest'))) as reg_tara \gset
commit;
begin;
select pg_temp.sign_in(:u_lata);
select app.register_pathshala_children(:t1, :h4, jsonb_build_array(jsonb_build_object(
  'new_child', jsonb_build_object('first_name', 'Ravi', 'last_name', 'Desai', 'date_of_birth', '2021-08-08'),
  'track_id', :tr_j, 'level_id', :lv_tod))) as reg_ravi \gset
commit;
select pg_temp.assert((:'reg_tara'::jsonb -> 'lines' -> 0 ->> 'outcome') = 'pending_child' and (:'reg_tara'::jsonb -> 'lines' -> 0 -> 'enrollment_id') = 'null'::jsonb
                      and (:'reg_tara'::jsonb -> 'pending' -> 0 ->> 'first_name') = 'Tara'
                      and (select pr.status = 'pending' and r.kind = 'add_member' and r.status = 'open' and (pr.quote ->> 'family_rank')::int = 4
                             from app.pathshala_pending_registrations pr join app.household_change_requests r on r.id = pr.change_request_id
                            where pr.id = (:'reg_tara'::jsonb -> 'pending' -> 0 ->> 'pending_registration_id')::uuid),
  'pending child: Tara is waiting for the office to add her to the family (an add-member request; her line keeps rank 4)');
update app.pathshala_pending_registrations set registered_at = now() - interval '3 days'
 where id = (:'reg_tara'::jsonb -> 'pending' -> 0 ->> 'pending_registration_id')::uuid;
begin;
select pg_temp.sign_in(:u_tara);
select app.decide_household_change_request((select change_request_id from app.pathshala_pending_registrations
                                             where id = (:'reg_tara'::jsonb -> 'pending' -> 0 ->> 'pending_registration_id')::uuid), 'approve', 'child') as tara_person \gset
select app.decide_household_change_request((select change_request_id from app.pathshala_pending_registrations
                                             where id = (:'reg_ravi'::jsonb -> 'pending' -> 0 ->> 'pending_registration_id')::uuid), 'reject', null, 'Not in our records') as ravi_none \gset
commit;
select pg_temp.assert((select pr.status = 'converted' and e.student_person_id = :'tara_person'::uuid and e.registered_at = pr.registered_at
                              and e.status = 'placed' and e.class_id = :cl_tod and e.notes = 'Our youngest' and f.family_rank = 4
                              and f.status = 'no_fee' and f.total_cents = 0
                         from app.pathshala_pending_registrations pr join app.pathshala_enrollments e on e.id = pr.enrollment_id
                         join app.pathshala_enrollment_fees f on f.enrollment_id = e.id
                        where pr.id = (:'reg_tara'::jsonb -> 'pending' -> 0 ->> 'pending_registration_id')::uuid)
                      and exists (select 1 from app.messages where center_id = :c and template_key = 'pathshala_child_added' and to_address = :u_mira::text),
  'pending child: added by the office, Tara is registered at the ORIGINAL time with her locked line (the family is at its cap: no fee) and Mira is told');
select pg_temp.assert((select status = 'cancelled' from app.pathshala_pending_registrations where id = (:'reg_ravi'::jsonb -> 'pending' -> 0 ->> 'pending_registration_id')::uuid)
                      and exists (select 1 from app.messages where center_id = :c and template_key = 'pathshala_child_not_added' and to_address = :u_lata::text),
  'pending child: declined by the office, the registration is cancelled and the parent told');

-- ═════════════════════════════════════════════════════════════════════════════
-- The waiver (P14): agreed per learner; another adult learner agrees in their own app
-- ═════════════════════════════════════════════════════════════════════════════
insert into app.legal_documents (id, center_id, kind, version, title, body_md, published_at)
values ('76000000-0000-4000-8000-000000000801', :c, 'pathshala_waiver', '2026.1', 'Pathshala waiver', 'We agree to the Pathshala rules.', now());
begin;
select pg_temp.sign_in(:u_mira);
select pg_temp.assert_code(format($$select app.register_pathshala_children(%L, %L, %L)$$, :t1, :h1,
  jsonb_build_array(jsonb_build_object('person_id', :p_rahul, 'track_id', :tr_j, 'level_id', :lv_dads))),
  '22023', 'Agree to the Pathshala waiver to register.', 'waiver: registering without agreeing to the published waiver is refused');
select pg_temp.assert_code(format($$select app.register_pathshala_children(%L, %L, %L, null, null, %L)$$, :t1, :h1,
  jsonb_build_array(jsonb_build_object('person_id', :p_rahul, 'track_id', :tr_j, 'level_id', :lv_dads)), gen_random_uuid()),
  '22023', 'The Pathshala waiver was updated', 'waiver: an old version is refused');
select app.register_pathshala_children(:t1, :h1, jsonb_build_array(jsonb_build_object('person_id', :p_rahul, 'track_id', :tr_j, 'level_id', :lv_dads)),
                                       null, null, '76000000-0000-4000-8000-000000000801') as reg_rahul \gset
commit;
select pg_temp.assert((:'reg_rahul'::jsonb -> 'lines' -> 0 ->> 'outcome') = 'waiver_hold'
                      and (select status = 'requested' and hold_reason = 'waiver' from app.pathshala_enrollments
                            where id = (:'reg_rahul'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid)
                      and not exists (select 1 from app.consents where person_id = :p_rahul and kind = 'pathshala_waiver'),
  'waiver: Mira cannot agree for another adult: Rahul''s place waits for his own agreement (no seat, no consent recorded for him)');
begin;
select pg_temp.sign_in(:u_rahul);
select app.register_pathshala_children(:t1, :h1, jsonb_build_array(jsonb_build_object('person_id', :p_rahul, 'track_id', :tr_j, 'level_id', :lv_dads)),
                                       5000, '["seat"]', '76000000-0000-4000-8000-000000000801') as reg_rahul2 \gset
commit;
select pg_temp.assert((:'reg_rahul2'::jsonb -> 'lines' -> 0 ->> 'enrollment_id') = (:'reg_rahul'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')
                      and (select e.status = 'placed' and e.hold_reason is null and e.waiver_consent_id is not null and f.status = 'billed' and f.total_cents = 5000
                             from app.pathshala_enrollments e join app.pathshala_enrollment_fees f on f.enrollment_id = e.id
                            where e.id = (:'reg_rahul'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid)
                      and (select given_by_user = :u_rahul and granted and legal_document_id = '76000000-0000-4000-8000-000000000801'
                             from app.consents where person_id = :p_rahul and kind = 'pathshala_waiver'),
  'waiver: Rahul agrees in his own app: the same registration goes ahead (placed, billed $50.00) with his consent');

-- From here on the community has a published waiver: every registration agrees to it.
\set waiver '''76000000-0000-4000-8000-000000000801'''

-- ═════════════════════════════════════════════════════════════════════════════
-- Who may register, and when
-- ═════════════════════════════════════════════════════════════════════════════
begin;
select pg_temp.sign_in(:u_riya);
select pg_temp.assert_code(format($$select app.register_pathshala_children(%L, %L, %L, null, null, %L)$$, :t1, :h1,
  jsonb_build_array(jsonb_build_object('person_id', :p_riya, 'track_id', :tr_g, 'level_id', :lv_g1)), :waiver),
  '42501', 'Ask a parent or guardian in your family to register you.', 'who: a child cannot register (not even themselves)');
rollback;
begin;
select pg_temp.sign_in(:u_nita);
select pg_temp.assert_code(format($$select app.register_pathshala_children(%L, %L, %L, null, null, %L)$$, :t1, :h1,
  jsonb_build_array(jsonb_build_object('person_id', :p_riya, 'track_id', :tr_g, 'level_id', :lv_g1)), :waiver),
  '42501', 'Only an adult of the family can register its learners.', 'who: an adult of another family cannot register this family''s learners');
select pg_temp.assert_code(format($$select app.register_pathshala_children(%L, %L, %L, null, null, %L)$$, :t1, :h2,
  jsonb_build_array(jsonb_build_object('person_id', :p_riya, 'track_id', :tr_g, 'level_id', :lv_g1)), :waiver),
  '22023', 'That learner is not a current member of the Mehta household', 'who: only current members of the household can be registered under it');
rollback;
begin;
select pg_temp.sign_in(:u_mira);
select pg_temp.assert_code(format($$select app.register_pathshala_children(%L, %L, %L, null, null, %L)$$, :t3, :h1,
  jsonb_build_array(jsonb_build_object('person_id', :p_riya, 'track_id', :tr_j, 'level_id', :lv_j5)), :waiver),
  '22023', 'Registration for 2027-28 is not open yet.', 'when: a term that is not open refuses');
rollback;
update app.pathshala_terms set registration_closes_at = now() - interval '1 day' where id = :t1;
begin;
select pg_temp.sign_in(:u_mira);
select pg_temp.assert_code(format($$select app.register_pathshala_children(%L, %L, %L, null, null, %L)$$, :t1, :h1,
  jsonb_build_array(jsonb_build_object('person_id', :p_riya, 'track_id', :tr_g, 'level_id', :lv_g1)), :waiver),
  '22023', '. Ask the Pathshala office.', 'when: after registration closed a family is refused (and told to ask the office)');
rollback;
begin;
select pg_temp.sign_in(:u_pia);
select app.register_pathshala_children(:t1, :h1, jsonb_build_array(jsonb_build_object('person_id', :p_riya, 'track_id', :tr_g, 'level_id', :lv_g1)),
                                       null, null, :waiver) as reg_office \gset
commit;
update app.pathshala_terms set registration_closes_at = now() + interval '30 days' where id = :t1;
select pg_temp.assert((:'reg_office'::jsonb -> 'lines' -> 0 ->> 'outcome') = 'seat'
                      and (select e.channel = 'office' and e.status = 'placed' and r.channel = 'office' and r.registered_by = :u_pia
                             from app.pathshala_enrollments e join app.pathshala_registrations r on r.id = e.registration_id
                            where e.id = (:'reg_office'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid)
                      and (select source = 'admin' and given_by_user = :u_pia from app.consents where person_id = :p_riya and kind = 'pathshala_waiver'),
  'when: the office still registers after the window (office channel; the family''s paper agreement recorded as an admin consent)');
begin;
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c, 'pathshala', false, 'test');
select pg_temp.sign_in(:u_mira);
select pg_temp.assert_code(format($$select app.register_pathshala_children(%L, %L, %L, null, null, %L)$$, :t1, :h1,
  jsonb_build_array(jsonb_build_object('person_id', :p_anya, 'track_id', :tr_g, 'level_id', :lv_g1)), :waiver),
  '42501', 'The Pathshala module is switched off for this community.', 'module: with Pathshala off registration refuses');
rollback;
-- Pledges & donations off: registration works and the quote is kept "not billed" (as membership fees); a pay-now term refuses.
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c, 'giving', false, 'test');
begin;
select pg_temp.sign_in(:u_nita);
select app.register_pathshala_children(:t1, :h2, jsonb_build_array(jsonb_build_object('person_id', :p_isha, 'track_id', :tr_g, 'level_id', :lv_g1)),
                                       null, null, :waiver) as reg_isha_g \gset
select pg_temp.assert_code(format($$select app.register_pathshala_children(%L, %L, %L, null, null, %L)$$, :t2, :h2,
  jsonb_build_array(jsonb_build_object('person_id', :p_isha, 'track_id', :tr_j, 'level_id', :lv_j2)), :waiver),
  '22023', 'takes the fee when you register, and Pledges & donations is switched off', 'giving off: a pay-now term refuses new registrations in plain words');
commit;
delete from app.center_modules where center_id = :c and module_key = 'giving';
select pg_temp.assert((:'reg_isha_g'::jsonb -> 'lines' -> 0 ->> 'outcome') = 'seat' and (:'reg_isha_g'::jsonb -> 'lines' -> 0 -> 'pledge') = 'null'::jsonb
                      and (select e.status = 'placed' and f.status = 'not_billed_giving_off' and f.pledge_id is null
                                  and f.billing_note = 'Not billed: Pledges & donations is switched off ($117.00 quoted).'
                             from app.pathshala_enrollments e join app.pathshala_enrollment_fees f on f.enrollment_id = e.id
                            where e.id = (:'reg_isha_g'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid),
  'giving off: Isha is placed and her $117.00 line kept, marked not billed (no pledge)');

-- ═════════════════════════════════════════════════════════════════════════════
-- Pay now: the seat is held, the pledges are due today, nothing is placed until paid
-- ═════════════════════════════════════════════════════════════════════════════
begin;
select pg_temp.sign_in(:u_lata);
select app.register_pathshala_children(:t2, :h4, jsonb_build_array(jsonb_build_object('person_id', :p_ved, 'track_id', :tr_j, 'level_id', :lv_j2),
                                                                    jsonb_build_object('person_id', :p_mina, 'track_id', :tr_j, 'level_id', :lv_tod)),
                                       13000, '["seat","seat"]', :waiver, 'desai-summer-1') as reg_ved2 \gset
select pg_temp.assert_code(format($$select app.register_pathshala_children(%L, %L, %L, null, null, %L)$$, :t2, :h4,
  jsonb_build_array(jsonb_build_object('person_id', :p_mina, 'track_id', :tr_g, 'level_id', null)), :waiver),
  '22023', 'Choose a level for Mina: in Summer 2027 the fee is paid when you register.', 'pay now: "not sure" is not offered (P25)');
commit;
select (:'reg_ved2'::jsonb -> 'lines' -> 0 ->> 'enrollment_id') as ved2 \gset
select pg_temp.assert((select array_agg(x ->> 'outcome' order by o) from jsonb_array_elements(:'reg_ved2'::jsonb -> 'lines') with ordinality a(x, o)) = array['seat', 'seat']
                      and (:'reg_ved2'::jsonb -> 'pay' ->> 'amount_cents')::int = 13000
                      and jsonb_array_length(:'reg_ved2'::jsonb -> 'pay' -> 'pledge_ids') = 1
                      and (:'reg_ved2'::jsonb -> 'pay' ->> 'for_label') = 'Pathshala fee Summer 2027 · Ved, Mina'
                      and (:'reg_ved2'::jsonb -> 'pay' ->> 'office_payment_allowed')::boolean and (:'reg_ved2'::jsonb -> 'pay' ->> 'hold_until') is not null
                      and (:'reg_ved2'::jsonb -> 'lines' -> 0 -> 'pledge' ->> 'due_on') = pg_temp.today()::text,
  'pay now: both get a seat; the family pays $130.00 once (Ved; Mina''s level is Free), due today, "Pathshala fee Summer 2027 · Ved, Mina"');
select pg_temp.assert((select bool_and(e.status = 'requested' and e.hold_reason = 'payment' and e.class_id is null
                                       and e.hold_expires_at between now() + interval '47 hours 59 minutes' and now() + interval '48 hours 1 minute')
                         from app.pathshala_enrollments e where e.registration_id = (:'reg_ved2'::jsonb ->> 'registration_id')::uuid)
                      and (select f.status from app.pathshala_enrollment_fees f join app.pathshala_enrollments e on e.id = f.enrollment_id
                            where e.registration_id = (:'reg_ved2'::jsonb ->> 'registration_id')::uuid and e.student_person_id = :p_mina) = 'no_fee'
                      and (select s.held = 1 and s.taken = 0 and s.free = 3 from app.pathshala_level_seats(:t2, :lv_j2) s),
  'pay now: nothing is placed: both seats are held for 48 hours (a held seat counts as taken), Mina''s $0 line waits with Ved''s');

-- The paid-fee hook, channel 1: the card payment the provider's webhook records.
begin;
select pg_temp.sign_in(:u_lata);
select app.create_checkout(:c, :h4, 13000, array[(:'reg_ved2'::jsonb -> 'pay' -> 'pledge_ids' ->> 0)::uuid], null, 'pathshala',
                           :'reg_ved2'::jsonb -> 'pay' ->> 'for_label') as ck_ved \gset
commit;
begin;
set local role connect_worker;
select app.worker_record_online_payment((:'ck_ved'::jsonb ->> 'checkout_id')::uuid, 'pi_p76_ved', 13000, 407, 'card') as paid_ved \gset
select app.worker_record_online_payment((:'ck_ved'::jsonb ->> 'checkout_id')::uuid, 'pi_p76_ved', 13000, 407, 'card') as paid_ved_again \gset
commit;
select pg_temp.assert((select bool_and(e.status = 'placed' and e.hold_reason is null and e.class_id is not null)
                         from app.pathshala_enrollments e where e.registration_id = (:'reg_ved2'::jsonb ->> 'registration_id')::uuid)
                      and (select f.status from app.pathshala_enrollment_fees f where f.enrollment_id = :'ved2'::uuid) = 'paid'
                      and (:'paid_ved_again'::jsonb ->> 'duplicate')::boolean
                      and (select count(*) from app.audit_log where record_table = 'pathshala_enrollments' and record_id = :'ved2'
                             and after ->> 'status' = 'placed' and before ->> 'status' = 'requested') = 1
                      and (select count(*) from app.messages where center_id = :c and template_key = 'pathshala_registered' and to_address = :u_lata::text) = 2,
  'hook (card webhook): Ved is placed once the payment is recorded, Mina''s $0 seat is confirmed with it, a repeated webhook changes nothing, Lata is told');

-- A family with nothing to pay (a Free level): its seat is confirmed at once.
begin;
select pg_temp.sign_in(:u_mira);
select app.register_pathshala_children(:t2, :h1, jsonb_build_array(jsonb_build_object('person_id', :p_anya, 'track_id', :tr_j, 'level_id', :lv_tod)),
                                       0, '["seat"]', :waiver) as reg_anya2 \gset
commit;
select pg_temp.assert((:'reg_anya2'::jsonb -> 'pay' ->> 'amount_cents')::int = 0 and (:'reg_anya2'::jsonb -> 'pay' -> 'hold_until') = 'null'::jsonb
                      and (:'reg_anya2'::jsonb -> 'lines' -> 0 -> 'pledge') = 'null'::jsonb
                      and (select e.status = 'placed' and e.hold_reason is null and e.class_id = :cl2_tod and f.status = 'no_fee'
                             from app.pathshala_enrollments e join app.pathshala_enrollment_fees f on f.enrollment_id = e.id
                            where e.id = (:'reg_anya2'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid),
  'pay now: a family with nothing to pay (a Free level) is placed at once, with no pledge');

-- Channel 2: an office payment the treasurer records.
begin;
select pg_temp.sign_in(:u_asha);
select app.register_pathshala_children(:t2, :h5, jsonb_build_array(jsonb_build_object('person_id', :p_jay, 'track_id', :tr_g, 'level_id', :lv_g1)),
                                       4500, null, :waiver) as reg_jay2 \gset
commit;
begin;
select pg_temp.sign_in(:u_tara);
select app.record_offline_payment(:h5, 4500, 'check', pg_temp.today(), array[(:'reg_jay2'::jsonb -> 'pay' -> 'pledge_ids' ->> 0)::uuid], '7601') as pay_jay \gset
commit;
select pg_temp.assert((select status = 'placed' and class_id = :cl2_g1 from app.pathshala_enrollments where id = (:'reg_jay2'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid),
  'hook (office payment): a check the treasurer records completes Jay''s held seat');
begin;
select pg_temp.sign_in(:u_asha);
select app.register_pathshala_children(:t2, :h5, jsonb_build_array(jsonb_build_object('person_id', :p_neel, 'track_id', :tr_g, 'level_id', :lv_g1)),
                                       4500, '["waitlist"]', :waiver) as reg_neel2 \gset
commit;
-- Channel 3: a Zelle line on the bank statement the treasurer matches.
begin;
select pg_temp.sign_in(:u_nita);
select app.register_pathshala_children(:t2, :h2, jsonb_build_array(jsonb_build_object('person_id', :p_kiran, 'track_id', :tr_j, 'level_id', :lv_j2)),
                                       13000, null, :waiver) as reg_kiran2 \gset
commit;
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description, bank_type)
values ('76000000-0000-4000-8000-000000000901', :c, :ba, pg_temp.today(), 13000, 'Zelle Payment From Nita Mehta Wfct0h7k2p76', 'QUICKPAY_CREDIT');
begin;
select pg_temp.sign_in(:u_tara);
select app.confirm_bank_match('76000000-0000-4000-8000-000000000901', :h2, array[(:'reg_kiran2'::jsonb -> 'pay' -> 'pledge_ids' ->> 0)::uuid]) as pay_kiran \gset
commit;
select pg_temp.assert((select status = 'placed' from app.pathshala_enrollments where id = (:'reg_kiran2'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid),
  'hook (bank match): matching the Zelle bank line completes Kiran''s held seat');
-- Channel 4: the treasurer applies money the family already has as credit.
begin;
select pg_temp.sign_in(:u_tara);
select app.record_offline_payment(:h2, 13000, 'cash', pg_temp.today(), array['76000000-0000-4000-8000-0000000dead1']::uuid[]) as credit_pay \gset
commit;
begin;
select pg_temp.sign_in(:u_nita);
select app.register_pathshala_children(:t2, :h2, jsonb_build_array(jsonb_build_object('person_id', :p_isha, 'track_id', :tr_j, 'level_id', :lv_j2)),
                                       13000, null, :waiver) as reg_isha2 \gset
commit;
begin;
select pg_temp.sign_in(:u_tara);
insert into app.payment_allocations (center_id, payment_id, pledge_id, amount_cents)
values (:c, :'credit_pay'::uuid, (:'reg_isha2'::jsonb -> 'pay' -> 'pledge_ids' ->> 0)::uuid, 13000);
commit;
select pg_temp.assert((select status = 'placed' from app.pathshala_enrollments where id = (:'reg_isha2'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid)
                      and (select s.taken = 3 and s.held = 0 from app.pathshala_level_seats(:t2, :lv_j2) s),
  'hook (credit applied by the treasurer): allocating the family''s credit to the fee pledge completes Isha''s held seat');

-- ═════════════════════════════════════════════════════════════════════════════
-- The sweep: an unpaid hold is released; money paid toward it becomes credit; the seat goes to the waitlist
-- ═════════════════════════════════════════════════════════════════════════════
begin;
select pg_temp.sign_in(:u_mira);
select app.register_pathshala_children(:t2, :h1, jsonb_build_array(jsonb_build_object('person_id', :p_dev, 'track_id', :tr_j, 'level_id', :lv_j2)),
                                       13000, null, :waiver) as reg_dev2 \gset
select app.choose_pathshala_office_payment((:'reg_dev2'::jsonb ->> 'registration_id')::uuid) as office_dev2 \gset
select pg_temp.assert_code(format($$select app.choose_pathshala_office_payment(%L)$$, :'reg1'::jsonb ->> 'registration_id'),
  '22023', '2026-27 takes the fee online only.', 'office payment: a term that does not allow it refuses');
commit;
begin;
select pg_temp.sign_in(:u_priya);
select app.register_pathshala_children(:t2, :h3, jsonb_build_array(jsonb_build_object('person_id', :p_om, 'track_id', :tr_j, 'level_id', :lv_j2)),
                                       13000, '["waitlist"]', :waiver) as reg_om2 \gset
commit;
select pg_temp.assert((select hold_reason = 'office_payment' and hold_expires_at between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour'
                         from app.pathshala_enrollments where id = (:'reg_dev2'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid)
                      and (:'office_dev2'::jsonb ->> 'amount_cents')::int = 13000,
  'office payment: the family moves its hold to the office window (7 days)');
begin;
select pg_temp.sign_in(:u_tara);
select app.record_offline_payment(:h1, 5000, 'check', pg_temp.today(), array[(:'reg_dev2'::jsonb -> 'lines' -> 0 -> 'pledge' ->> 'id')::uuid], '7602') as part_dev \gset
commit;
select pg_temp.assert((select status from app.pledges where id = (:'reg_dev2'::jsonb -> 'lines' -> 0 -> 'pledge' ->> 'id')::uuid) = 'partially_paid'
                      and (select status = 'requested' and hold_reason = 'office_payment' from app.pathshala_enrollments
                            where id = (:'reg_dev2'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid),
  'a part payment does nothing until the pledge is paid in full: Dev stays held');
update app.pathshala_enrollments set hold_expires_at = now() - interval '1 minute' where id = (:'reg_dev2'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid;
begin;
set local role connect_worker;
select app.worker_pathshala_holds_sweep() as sw1 \gset
commit;
select pg_temp.assert((:'sw1'::jsonb ->> 'released')::int = 1 and (:'sw1'::jsonb ->> 'credited')::int = 1 and (:'sw1'::jsonb ->> 'credit_cents')::int = 5000,
  'sweep: one expired hold released, $50.00 already paid toward it is credited');
select pg_temp.assert((select e.status = 'withdrawn' and e.hold_reason is null and e.withdrawal_reason like 'The fee was not paid by %, so the seat was released.'
                              and f.status = 'cancelled' and p.status = 'cancelled' and p.paid_cents = 0
                         from app.pathshala_enrollments e join app.pathshala_enrollment_fees f on f.enrollment_id = e.id join app.pledges p on p.id = f.pledge_id
                        where e.id = (:'reg_dev2'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid)
                      and not exists (select 1 from app.payment_allocations where pledge_id = (:'reg_dev2'::jsonb -> 'lines' -> 0 -> 'pledge' ->> 'id')::uuid)
                      and (select kind = 'pathshala_hold_released' and released_cents = 5000 and household_id = :h1 and rsvp_id is null and status = 'pending'
                             from app.rsvp_credit_releases where enrollment_id = (:'reg_dev2'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid),
  'sweep: Dev is withdrawn with the reason, the fee pledge cancelled, the $50.00 released into a credit row (with the enrollment) for the treasurer');
select pg_temp.assert((select count(*) from app.messages where center_id = :c and template_key = 'pathshala_hold_released'
                         and payload -> 'vars' ->> 'enrollment_id' = (:'reg_dev2'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')) = 4,
  'sweep: the family''s adults are told once each (push and email to Mira and Rahul)');
select pg_temp.assert((select e.status = 'requested' and e.hold_reason = 'payment' and e.offered_at is not null and f.status = 'billed' and p.due_on = pg_temp.today()
                              and e.hold_expires_at > now() + interval '47 hours'
                         from app.pathshala_enrollments e join app.pathshala_enrollment_fees f on f.enrollment_id = e.id join app.pledges p on p.id = f.pledge_id
                        where e.id = (:'reg_om2'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid)
                      and exists (select 1 from app.messages where center_id = :c and template_key = 'pathshala_payment_due' and to_address = :u_priya::text),
  'waitlist (pay now, P19): the freed seat is offered to Om, held 48 hours for payment, and his family told');
select pg_temp.assert_raises(format($$insert into app.rsvp_credit_releases (center_id, household_id, pledge_id, released_cents) values (%L, %L, %L, 100)$$,
  :c, :h1, (:'reg_dev2'::jsonb -> 'lines' -> 0 -> 'pledge' ->> 'id')),
  'rsvp_credit_releases_one_source', 'credit queue: a credit row names exactly one RSVP or one enrollment');
begin;
select pg_temp.sign_in(:u_tara);
select app.resolve_rsvp_credit((select id from app.rsvp_credit_releases where enrollment_id = (:'reg_dev2'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid),
                               'Applied to the yearly pledge');
commit;
select pg_temp.assert((select status = 'handled' and handled_by = :u_tara from app.rsvp_credit_releases
                        where enrollment_id = (:'reg_dev2'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid)
                      and exists (select 1 from app.audit_log where record_table = 'rsvp_credit_releases'
                                    and reason = 'Treasurer handled the credit released when a Pathshala seat held for payment was released'),
  'credit queue: the treasurer handles the Pathshala credit with the same tool as RSVP credit');
-- A lapsed seat offer leaves the waitlist.
update app.pathshala_enrollments set hold_expires_at = now() - interval '1 minute' where id = (:'reg_om2'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid;
begin;
set local role connect_worker;
select app.worker_pathshala_holds_sweep() as sw2 \gset
commit;
select pg_temp.assert((select status = 'withdrawn' from app.pathshala_enrollments where id = (:'reg_om2'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid)
                      and (select status from app.pledges where id = (select pledge_id from app.pathshala_enrollment_fees
                                                                      where enrollment_id = (:'reg_om2'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid)) = 'cancelled',
  'waitlist: an unpaid seat offer lapses: Om leaves the waitlist and his pledge is cancelled (his family can join again, at the end)');

-- An open payment page keeps the hold live (at most 24 hours); money that arrives after the release is credit, applied to nothing.
begin;
select pg_temp.sign_in(:u_mira);
select app.register_pathshala_children(:t2, :h1, jsonb_build_array(jsonb_build_object('person_id', :p_riya, 'track_id', :tr_j, 'level_id', :lv_j5)),
                                       13000, null, :waiver) as reg_riya2 \gset
select app.create_checkout(:c, :h1, 13000, array[(:'reg_riya2'::jsonb -> 'pay' -> 'pledge_ids' ->> 0)::uuid], null, 'pathshala',
                           :'reg_riya2'::jsonb -> 'pay' ->> 'for_label') as ck_riya \gset
commit;
update app.pathshala_enrollments set hold_expires_at = now() - interval '1 minute' where id = (:'reg_riya2'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid;
begin;
set local role connect_worker;
select app.worker_pathshala_holds_sweep() as sw3 \gset
commit;
select pg_temp.assert((:'sw3'::jsonb ->> 'kept_paying')::int >= 1
                      and (select status = 'requested' and hold_reason = 'payment' from app.pathshala_enrollments
                            where id = (:'reg_riya2'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid),
  'sweep: a payment page still open for the hold (under 24 hours) keeps Riya''s seat: a parent who is paying never loses it');
update app.payment_checkouts set created_at = now() - interval '25 hours' where id = (:'ck_riya'::jsonb ->> 'checkout_id')::uuid;
begin;
set local role connect_worker;
select app.worker_pathshala_holds_sweep() as sw4 \gset
select app.worker_record_online_payment((:'ck_riya'::jsonb ->> 'checkout_id')::uuid, 'pi_p76_late', 13000, 407, 'card') as paid_late \gset
commit;
select pg_temp.assert((select status = 'withdrawn' from app.pathshala_enrollments where id = (:'reg_riya2'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid)
                      and (select status from app.pledges where id = (:'reg_riya2'::jsonb -> 'pay' -> 'pledge_ids' ->> 0)::uuid) = 'cancelled'
                      and not exists (select 1 from app.payment_allocations where payment_id = (:'paid_late'::jsonb ->> 'payment_id')::uuid)
                      and (select kind = 'pathshala_late_payment' and released_cents = 13000 and household_id = :h1 and status = 'pending'
                             from app.rsvp_credit_releases where enrollment_id = (:'reg_riya2'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid),
  'after a release: the late online payment is recorded, applied to nothing (the seat stays released) and put in front of the treasurer as credit');

-- A member's Zelle report keeps an office hold, but never confirms it.
begin;
select pg_temp.sign_in(:u_asha);
select app.register_pathshala_children(:t2, :h5, jsonb_build_array(jsonb_build_object('person_id', :p_kavya, 'track_id', :tr_j, 'level_id', :lv_j5)),
                                       13000, null, :waiver) as reg_kavya \gset
select app.choose_pathshala_office_payment((:'reg_kavya'::jsonb ->> 'registration_id')::uuid) as office_kavya \gset
select app.report_payment(:c, :h5, 'zelle', 13000, pg_temp.today(), null, 'ASHA JOSHI', array[(:'reg_kavya'::jsonb -> 'pay' -> 'pledge_ids' ->> 0)::uuid], null) as zelle_kavya \gset
commit;
select (:'reg_kavya'::jsonb -> 'lines' -> 0 ->> 'enrollment_id') as kavya \gset
begin;
select pg_temp.sign_in(:u_pia);
select pg_temp.assert_code(format($$select app.extend_pathshala_hold(%L, now() + interval '30 days', 'Family asked')$$, :'kavya'),
  '22023', 'at most until', 'holds: a seat cannot be held past the office window');
select app.extend_pathshala_hold(:'kavya'::uuid, now() + interval '5 days', 'The family will pay on Sunday') as ext_kavya \gset
select pg_temp.assert_code(format($$select app.release_pathshala_hold(%L, 'x')$$, :'kavya'),
  '22023', 'seat is held for payment. To give more time, extend the hold', 'holds: a payment hold is not "released" (extend it, or withdraw)');
select pg_temp.assert_code(format($$update app.pathshala_enrollments set status = 'placed', class_id = %L where id = %L$$, :cl2_j5, :'kavya'),
  '22023', 'held for payment', 'holds: a held learner cannot be placed or moved by a direct write');
commit;
update app.pathshala_enrollments set hold_expires_at = now() - interval '1 minute' where id = :'kavya'::uuid;
begin;
set local role connect_worker;
select app.worker_pathshala_holds_sweep() as sw5 \gset
commit;
select pg_temp.assert((select status = 'requested' and hold_reason = 'office_payment' from app.pathshala_enrollments where id = :'kavya'::uuid)
                      and (select status from app.pledges where id = (:'reg_kavya'::jsonb -> 'pay' -> 'pledge_ids' ->> 0)::uuid) = 'open',
  'Zelle report: the reported Zelle keeps Kavya''s office hold while it waits for the treasurer, and pays nothing');
begin;
select pg_temp.sign_in(:u_tara);
select app.reject_payment_report((:'zelle_kavya'::jsonb ->> 'report_id')::uuid, 'Not seen at our bank');
commit;
begin;
set local role connect_worker;
select app.worker_pathshala_holds_sweep() as sw6 \gset
commit;
select pg_temp.assert((select status = 'withdrawn' from app.pathshala_enrollments where id = :'kavya'::uuid),
  'Zelle report: once the treasurer rejects it the hold is no longer live and the sweep releases it');

-- The hook never stops a payment from being recorded; if it could not place the learner, the sweep does (never releases).
begin;
select pg_temp.sign_in(:u_asha);
select app.register_pathshala_children(:t2, :h5, jsonb_build_array(jsonb_build_object('person_id', :p_kavya, 'track_id', :tr_j, 'level_id', :lv_j5)),
                                       13000, '["seat"]', :waiver) as reg_kavya2 \gset
commit;
alter table app.pledges disable trigger pathshala_fee_paid;
begin;
select pg_temp.sign_in(:u_tara);
select app.record_offline_payment(:h5, 13000, 'cash', pg_temp.today(), array[(:'reg_kavya2'::jsonb -> 'pay' -> 'pledge_ids' ->> 0)::uuid]) as pay_kavya2 \gset
commit;
alter table app.pledges enable trigger pathshala_fee_paid;
select pg_temp.assert((:'reg_kavya2'::jsonb -> 'lines' -> 0 ->> 'enrollment_id') = :'kavya'
                      and (select status from app.pledges where id = (:'reg_kavya2'::jsonb -> 'pay' -> 'pledge_ids' ->> 0)::uuid) = 'paid'
                      and (select status = 'requested' and hold_reason = 'payment' from app.pathshala_enrollments where id = :'kavya'::uuid),
  'self-healing: Kavya registers again (her released enrollment is reused); the fee is paid while the hook is off, so she is still held');
update app.pathshala_enrollments set hold_expires_at = now() - interval '1 minute' where id = :'kavya'::uuid;
begin;
set local role connect_worker;
select app.worker_pathshala_holds_sweep() as sw7 \gset
commit;
select pg_temp.assert((:'sw7'::jsonb ->> 'paid_placed')::int = 1 and (:'sw7'::jsonb ->> 'released')::int = 0
                      and (select e.status = 'placed' and e.class_id = :cl2_j5 and f.status = 'paid'
                             from app.pathshala_enrollments e join app.pathshala_enrollment_fees f on f.enrollment_id = e.id where e.id = :'kavya'::uuid),
  'self-healing: the sweep places a held learner whose fee is paid (even past the hold''s window), and never releases a paid seat');

-- ═════════════════════════════════════════════════════════════════════════════
-- Pledge mode: a seat that frees goes to the waitlist, placed and billed (P19)
-- ═════════════════════════════════════════════════════════════════════════════
begin;
select pg_temp.sign_in(:u_pia);
update app.pathshala_enrollments set status = 'withdrawn' where id = (:'reg_kiran'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid;
commit;
select pg_temp.assert((select e.status = 'placed' and e.class_id = :cl_j2 and f.status = 'billed' and p.amount_cents = 13000 and p.due_on = pg_temp.today() + 14
                         from app.pathshala_enrollments e join app.pathshala_enrollment_fees f on f.enrollment_id = e.id join app.pledges p on p.id = f.pledge_id
                        where e.id = (:'reg_jay'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid)
                      and exists (select 1 from app.messages where center_id = :c and template_key = 'pathshala_placed' and to_address = :u_asha::text)
                      and (select status = 'waitlisted' from app.pathshala_enrollments where id = (:'reg_neel'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid)
                      and app.pathshala_waitlist_position((:'reg_neel'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid) = 1,
  'waitlist (pledge mode): Kiran withdraws, so Jay (first waiting) is placed and billed at his locked line, and his family told how to withdraw at no charge');
begin;
select pg_temp.sign_in(:u_pia);
update app.pathshala_classes set capacity = 3 where id = :cl_j2;
commit;
select pg_temp.assert((select e.status = 'placed' and f.status = 'billed' and f.total_cents = 11700
                         from app.pathshala_enrollments e join app.pathshala_enrollment_fees f on f.enrollment_id = e.id
                        where e.id = (:'reg_neel'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid),
  'waitlist (pledge mode): raising the capacity serves the next one (Neel, $117.00 as quoted when he registered)');

-- ═════════════════════════════════════════════════════════════════════════════
-- The office step (seat rule "office", pledge mode): the office places; "Place next"
-- ═════════════════════════════════════════════════════════════════════════════
begin;
select pg_temp.sign_in(:u_mira);
select app.register_pathshala_children(:t4, :h1, jsonb_build_array(jsonb_build_object('person_id', :p_dev, 'track_id', :tr_j, 'level_id', :lv_j2)),
                                       13000, '["office"]', :waiver) as reg_dev4 \gset
commit;
begin;
select pg_temp.sign_in(:u_lata);
select app.register_pathshala_children(:t4, :h4, jsonb_build_array(jsonb_build_object('person_id', :p_ved, 'track_id', :tr_j, 'level_id', :lv_j2)),
                                       null, null, :waiver) as reg_ved4 \gset
commit;
begin;
select pg_temp.sign_in(:u_nita);
select app.register_pathshala_children(:t4, :h2, jsonb_build_array(jsonb_build_object('person_id', :p_kiran, 'track_id', :tr_j, 'level_id', :lv_j2)),
                                       null, null, :waiver) as reg_kiran4 \gset
commit;
begin;
select pg_temp.sign_in(:u_pia);
select app.place_pathshala_enrollment((:'reg_dev4'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid) as pl_dev4 \gset
update app.pathshala_enrollments set status = 'waitlisted', waitlisted_at = now() where id = (:'reg_ved4'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid;
select app.place_next_from_waitlist(:lv_j2, :t4) as pl_next \gset
select pg_temp.assert_code(format($$select app.place_pathshala_enrollment(%L)$$, :'reg_kiran4'::jsonb -> 'lines' -> 0 ->> 'enrollment_id'),
  '22023', 'is full', 'office step: placing into a full class is refused');
select pg_temp.assert_code(format($$select app.place_pathshala_enrollment(%L, null, true)$$, :'reg_kiran4'::jsonb -> 'lines' -> 0 ->> 'enrollment_id'),
  '22023', 'Say why Kiran is placed in a full class', 'office step: over capacity needs a reason');
select app.place_pathshala_enrollment((:'reg_kiran4'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid, null, true, 'Twin of a student already placed') as pl_kiran4 \gset
commit;
select pg_temp.assert((:'reg_dev4'::jsonb -> 'lines' -> 0 ->> 'outcome') = 'office' and (:'reg_dev4'::jsonb -> 'lines' -> 0 -> 'pledge') = 'null'::jsonb
                      and (:'pl_dev4'::jsonb ->> 'outcome') = 'placed' and (:'pl_next'::jsonb ->> 'outcome') = 'placed' and (:'pl_kiran4'::jsonb ->> 'outcome') = 'placed'
                      and (select count(*) = 3 and bool_and(e.status = 'placed' and f.status = 'billed') from app.pathshala_enrollments e
                             join app.pathshala_enrollment_fees f on f.enrollment_id = e.id where e.term_id = :t4),
  'office step: nothing is placed or billed at registration; the office places (billed then), "Place next" serves the waitlist, over capacity with a reason');

-- A membership hold released at the desk (with a reason): treated as registering now.
begin;
select pg_temp.sign_in(:u_leela);
select app.register_pathshala_children(:t1, :h6, jsonb_build_array(jsonb_build_object('person_id', :p_sai, 'track_id', :tr_j, 'level_id', :lv_j2)),
                                       13000, '["membership_hold"]', :waiver) as reg_sai \gset
commit;
begin;
select pg_temp.sign_in(:u_pia);
select pg_temp.assert_code(format($$select app.release_pathshala_hold(%L, '  ')$$, :'reg_sai'::jsonb -> 'lines' -> 0 ->> 'enrollment_id'),
  '22023', 'Say why the hold is released', 'holds: releasing a membership hold needs a reason');
select app.release_pathshala_hold((:'reg_sai'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')::uuid, 'Membership paid at the desk on Sunday') as rel_sai \gset
commit;
select pg_temp.assert((:'rel_sai'::jsonb ->> 'outcome') = 'waitlist' and (:'rel_sai'::jsonb ->> 'status') = 'waitlisted'
                      and exists (select 1 from app.messages where center_id = :c and template_key = 'pathshala_hold_lifted' and to_address = :u_leela::text),
  'holds: the principal releases Sai''s membership hold: Jainism 2 is full, so Sai joins its waitlist (and the family is told)');

-- ═════════════════════════════════════════════════════════════════════════════
-- The office's queue and the Home counts
-- ═════════════════════════════════════════════════════════════════════════════
begin;
select pg_temp.sign_in(:u_pia);
select app.pathshala_registration_queue(:t1, 'waitlisted') as q_pia \gset
commit;
begin;
select pg_temp.sign_in(:u_cora);
select app.pathshala_registration_queue(:t1, 'all') as q_cora \gset
select app.pathshala_task_counts(:c) as tc_cora \gset
commit;
begin;
select pg_temp.sign_in(:u_tara);
select app.pathshala_task_counts(:c) as tc_tara \gset
commit;
begin;
select pg_temp.sign_in(:u_mira);
select pg_temp.assert_code(format($$select app.pathshala_registration_queue(%L)$$, :t1), '42501', 'You don''t have access to this area',
  'queue: a member cannot read the office''s queue');
rollback;
select pg_temp.assert((:'q_pia'::jsonb ->> 'fees_visible')::boolean
                      and (select x -> 'learner' ->> 'name' = 'Sai Rao' and (x ->> 'waitlist_position')::int = 1 and x -> 'household_card' ->> 'household_number' is not null
                                  and x -> 'fee' ->> 'status' = 'quoted' and (x -> 'fee' ->> 'total_cents')::int = 13000
                             from jsonb_array_elements(:'q_pia'::jsonb -> 'items') x where x ->> 'enrollment_id' = (:'reg_sai'::jsonb -> 'lines' -> 0 ->> 'enrollment_id')),
  'queue: the principal sees the waitlist with each family''s household card, the position and the locked line');
select pg_temp.assert(not (:'q_cora'::jsonb ->> 'fees_visible')::boolean
                      and (select bool_and(x -> 'fee' = 'null'::jsonb) from jsonb_array_elements(:'q_cora'::jsonb -> 'items') x)
                      and jsonb_array_length(:'q_cora'::jsonb -> 'items') > 5,
  'queue: the committee (pathshala.view) sees the registrations but no family''s fees');
select pg_temp.assert((:'tc_tara'::jsonb ->> 'payments_after_release')::int = 1 and (:'tc_tara'::jsonb ->> 'waitlisted')::int >= 1
                      and (:'tc_cora'::jsonb -> 'payments_after_release') = 'null'::jsonb and (:'tc_cora'::jsonb ->> 'waitlisted')::int >= 1,
  'Home: the treasurer sees the payment that arrived after a release; the committee sees the counts but no money');

-- ═════════════════════════════════════════════════════════════════════════════
-- Access and the functions
-- ═════════════════════════════════════════════════════════════════════════════
begin;
select pg_temp.sign_in(:u_mira);
select pg_temp.assert((select count(*) from app.pathshala_registrations where household_id = :h1) >= 4
                      and (select count(*) from app.pathshala_pending_registrations where household_id = :h1) = 1
                      and (select count(*) from app.pathshala_enrollment_fees where household_id = :h1) >= 6,
  'access: the household''s adult reads its registrations, pending children and fee lines');
select pg_temp.assert_raises(format($$insert into app.pathshala_registrations (center_id, term_id, household_id, channel, payment_mode) values (%L, %L, %L, 'app', 'pledge')$$, :c, :t1, :h1),
  'permission denied', 'access: nobody writes the registrations directly');
rollback;
begin;
select pg_temp.sign_in(:u_riya);
select pg_temp.assert((select count(*) from app.pathshala_registrations) = 0 and (select count(*) from app.pathshala_pending_registrations) = 0
                      and (select count(*) from app.pathshala_enrollment_fees) = 0,
  'access: a child reads none of it');
rollback;
begin;
select pg_temp.sign_in(:u_nita);
select pg_temp.assert((select count(*) from app.pathshala_registrations where household_id = :h1) = 0, 'access: another family reads none of it');
rollback;
select pg_temp.assert((select count(*) = 8 and bool_and(p.prosecdef and exists (select 1 from unnest(p.proconfig) as g(setting)
                                                                                 where g.setting ~ '^search_path=app, *public, *extensions$')
                                         and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute'))
                         from pg_proc p where p.pronamespace = 'app'::regnamespace
                          and p.proname in ('register_pathshala_children', 'choose_pathshala_office_payment', 'place_pathshala_enrollment',
                                            'place_next_from_waitlist', 'release_pathshala_hold', 'extend_pathshala_hold',
                                            'pathshala_registration_queue', 'pathshala_task_counts')),
  'functions: every RPC is security definer with the hosted search path, callable when signed in and never anonymously');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.worker_pathshala_holds_sweep()', 'execute')
                      and not has_function_privilege('service_role', 'app.worker_pathshala_holds_sweep()', 'execute')
                      and has_function_privilege('connect_worker', 'app.worker_pathshala_holds_sweep()', 'execute')
                      and not has_function_privilege('authenticated', 'app._pathshala_bill(uuid,boolean)', 'execute')
                      and not has_function_privilege('authenticated', 'app._pathshala_release_hold(uuid,text,boolean)', 'execute'),
  'functions: the sweep is the worker''s only; the billing and release helpers are not callable over the API');
begin;
select pg_temp.sign_in(:u_pia);
select pg_temp.assert_raises($$select app.worker_pathshala_holds_sweep()$$, 'permission denied', 'functions: a signed-in user cannot run the sweep');
rollback;
select pg_temp.assert((select bool_and(exists (select 1 from unnest(p.proconfig) as g(setting) where g.setting ~ '^search_path=app, *public, *extensions$'))
                         from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname like '%pathshala%' and p.proname <> 'pathshala_term_stats'),
  'functions: every Pathshala function pins search_path = app, public, extensions');
select pg_temp.assert(not exists (select 1 from app.audit_log where center_id = :c and action = 'pathshala.notice_failed'),
  'messages: every Pathshala notice rendered and queued (no notice failed)');
