-- 0590 (Pathshala registration plan v2, PR 1 "DB1"): levels and age bands, an explicit fee for every offered level,
-- the term's payment mode and rules, the lock when registration opens, the one pricing function (the owner's example
-- exactly), options, preview, "Try a family", seats, and the 'pathshala' checkout context. Nothing here bills anyone.
-- Everything runs in its own community (P75).
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
-- The same, and the error code the apps read (22023: a rule the user can fix; 42501: not allowed; P0002: not found).
create or replace function pg_temp.assert_code(stmt text, code text, expect text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if sqlstate <> code or position(lower(expect) in lower(sqlerrm)) = 0 then
    raise exception 'FAIL: % (got % "%")', label, sqlstate, sqlerrm;
  end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.sign_in(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- ── Fixtures ─────────────────────────────────────────────────────────────────
\set c '''75000000-0000-4000-8000-0000000000c1'''
\set u_pia '''75000000-0000-4000-8000-000000000001'''
\set u_tara '''75000000-0000-4000-8000-000000000002'''
\set u_mira '''75000000-0000-4000-8000-000000000003'''
\set u_riya '''75000000-0000-4000-8000-000000000004'''
\set u_nita '''75000000-0000-4000-8000-000000000005'''
\set u_cora '''75000000-0000-4000-8000-000000000006'''
\set u_rahul '''75000000-0000-4000-8000-000000000007'''
\set p_pia '''75000000-0000-4000-8000-0000000000a1'''
\set p_tara '''75000000-0000-4000-8000-0000000000a2'''
\set p_mira '''75000000-0000-4000-8000-0000000000a3'''
\set p_riya '''75000000-0000-4000-8000-0000000000a4'''
\set p_dev '''75000000-0000-4000-8000-0000000000a5'''
\set p_anya '''75000000-0000-4000-8000-0000000000a6'''
\set p_rahul '''75000000-0000-4000-8000-0000000000a7'''
\set p_nita '''75000000-0000-4000-8000-0000000000a8'''
\set p_kiran '''75000000-0000-4000-8000-0000000000a9'''
\set p_cora '''75000000-0000-4000-8000-0000000000aa'''
\set p_kid_nodob '''75000000-0000-4000-8000-0000000000ab'''
\set p_adult_nodob '''75000000-0000-4000-8000-0000000000ac'''
\set h1 '''75000000-0000-4000-8000-0000000000b1'''
\set h2 '''75000000-0000-4000-8000-0000000000b2'''
\set tr_j '''75000000-0000-4000-8000-0000000000d1'''
\set tr_g '''75000000-0000-4000-8000-0000000000d2'''
\set tr_h '''75000000-0000-4000-8000-0000000000d3'''
\set lv_tod '''75000000-0000-4000-8000-0000000000e0'''
\set lv_j1 '''75000000-0000-4000-8000-0000000000e1'''
\set lv_j2 '''75000000-0000-4000-8000-0000000000e2'''
\set lv_j3 '''75000000-0000-4000-8000-0000000000e3'''
\set lv_j5 '''75000000-0000-4000-8000-0000000000e5'''
\set lv_dads '''75000000-0000-4000-8000-0000000000e8'''
\set lv_moms '''75000000-0000-4000-8000-0000000000e9'''
\set lv_g1 '''75000000-0000-4000-8000-0000000000ea'''
\set lv_g3 '''75000000-0000-4000-8000-0000000000eb'''
\set lv_g4 '''75000000-0000-4000-8000-0000000000ec'''
\set lv_h1 '''75000000-0000-4000-8000-0000000000ed'''
\set t1 '''75000000-0000-4000-8000-0000000000f1'''
\set t2 '''75000000-0000-4000-8000-0000000000f2'''
\set fund_p '''75000000-0000-4000-8000-000000000f01'''

insert into app.centers (id, slug, name, short_name, time_zone, environment) values (:c, 'p75-temple', 'P75 Jain Temple', 'P75', 'America/Chicago', 'production');
insert into auth.users (id, email) values (:u_pia, 'pia@p75.test'), (:u_tara, 'tara@p75.test'), (:u_mira, 'mira@p75.test'),
  (:u_riya, 'riya@p75.test'), (:u_nita, 'nita@p75.test'), (:u_cora, 'cora@p75.test'), (:u_rahul, 'rahul@p75.test');
-- Ages on the term's cut-off (its first day, 2026-09-06): Riya 12, Dev 9, Anya 4, Mira 44, Kiran 10.
insert into app.people (id, center_id, first_name, last_name, date_of_birth, email) values
  (:p_pia, :c, 'Pia', 'Principal', '1975-05-05', 'pia@p75.test'), (:p_tara, :c, 'Tara', 'Treasurer', '1970-01-01', 'tara@p75.test'),
  (:p_mira, :c, 'Mira', 'Shah', '1982-02-02', 'mira@p75.test'), (:p_riya, :c, 'Riya', 'Shah', '2014-03-10', null),
  (:p_dev, :c, 'Dev', 'Shah', '2017-01-15', null), (:p_anya, :c, 'Anya', 'Shah', '2022-05-01', null),
  (:p_rahul, :c, 'Rahul', 'Shah', '1980-04-04', 'rahul@p75.test'),
  (:p_nita, :c, 'Nita', 'Mehta', '1984-08-08', 'nita@p75.test'), (:p_kiran, :c, 'Kiran', 'Mehta', '2016-02-02', null),
  (:p_cora, :c, 'Cora', 'Committee', '1966-06-06', 'cora@p75.test'),
  (:p_kid_nodob, :c, 'Isha', 'Shah', null, null), (:p_adult_nodob, :c, 'Kanta', 'Shah', null, null);
insert into app.households (id, center_id, display_name) values (:h1, :c, 'Shah household'), (:h2, :c, 'Mehta household');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :p_mira, :c, 'primary', true), (:h1, :p_rahul, :c, 'spouse', false), (:h1, :p_riya, :c, 'child', false),
  (:h1, :p_dev, :c, 'child', false), (:h1, :p_anya, :c, 'child', false),
  (:h1, :p_kid_nodob, :c, 'child', false), (:h1, :p_adult_nodob, :c, 'other', false),
  (:h2, :p_nita, :c, 'primary', true), (:h2, :p_kiran, :c, 'child', false);
insert into app.center_users (center_id, user_id, person_id, is_default) values
  (:c, :u_pia, :p_pia, false), (:c, :u_tara, :p_tara, false), (:c, :u_mira, :p_mira, false), (:c, :u_riya, :p_riya, false),
  (:c, :u_nita, :p_nita, false), (:c, :u_cora, :p_cora, false), (:c, :u_rahul, :p_rahul, false);
insert into app.role_grants (center_id, user_id, role_key) values
  (:c, :u_pia, 'pathshala_principal'), (:c, :u_tara, 'treasurer'), (:c, :u_cora, 'pathshala_committee');
insert into app.funds (id, center_id, key, name) values (:fund_p, :c, 'pathshala', 'Pathshala');
insert into app.membership_types (center_id, key, tier, name, period_months) values (:c, 'yearly', 'yearly', 'Yearly membership', 12);
insert into app.memberships (center_id, household_id, person_id, membership_type_id, tier, status, starts_on)
select :c, :h1, :p_mira, id, 'yearly', 'active', current_date - 30 from app.membership_types where center_id = :c and key = 'yearly';
insert into app.pathshala_tracks (id, center_id, key, name) values (:tr_j, :c, 'jainism', 'Jainism'), (:tr_g, :c, 'gujarati', 'Gujarati'), (:tr_h, :c, 'hindi', 'Hindi');
insert into app.pathshala_levels (id, center_id, track_id, key, name, sort_order, min_age, max_age) values
  (:lv_tod, :c, :tr_j, 'toddler', 'Toddler', 0, 3, 5), (:lv_j1, :c, :tr_j, '1', 'Jainism 1', 1, 5, 7),
  (:lv_j2, :c, :tr_j, '2', 'Jainism 2', 2, 8, 10), (:lv_j3, :c, :tr_j, '3', 'Jainism 3', 3, 9, 11),
  (:lv_j5, :c, :tr_j, '5', 'Jainism 5', 5, 11, 13),
  (:lv_dads, :c, :tr_j, 'adult_dads', 'Adult class (Dads)', 8, 18, null), (:lv_moms, :c, :tr_j, 'adult_moms', 'Adult class (Moms)', 9, 18, null),
  (:lv_g1, :c, :tr_g, '1', 'Gujarati 1', 1, null, null), (:lv_g3, :c, :tr_g, '3', 'Gujarati 3', 3, null, null),
  (:lv_g4, :c, :tr_g, '4', 'Gujarati 4', 4, null, null), (:lv_h1, :c, :tr_h, '1', 'Hindi 1', 1, null, null);
insert into app.pathshala_terms (id, center_id, name, starts_on, ends_on, fee_per_child_cents) values
  (:t1, :c, '2026-27', '2026-09-06', '2027-05-30', 13000),
  (:t2, :c, 'Rounding term', '2027-09-05', '2028-05-28', 0);
insert into app.pathshala_classes (id, center_id, term_id, level_id, name, room, capacity, meets_on, starts_time, ends_time, waitlist_enabled) values
  ('75000000-0000-4000-8000-000000000c00', :c, :t1, :lv_tod, 'Toddler · Room T', 'T', 10, 'sunday', '10:00', '11:00', true),
  ('75000000-0000-4000-8000-000000000c02', :c, :t1, :lv_j2, 'Jainism 2 · Room B', 'B', 15, 'sunday', '10:00', '11:30', true),
  ('75000000-0000-4000-8000-000000000c03', :c, :t1, :lv_j3, 'Jainism 3 · Room C', 'C', 0, 'sunday', '10:00', '11:30', false),
  ('75000000-0000-4000-8000-000000000c05', :c, :t1, :lv_j5, 'Jainism 5 · Room C', 'C', 15, 'sunday', '10:00', '11:30', true),
  ('75000000-0000-4000-8000-000000000c09', :c, :t1, :lv_moms, 'Adult class (Moms)', 'Hall', 20, 'sunday', '10:00', '11:30', true),
  ('75000000-0000-4000-8000-000000000c08', :c, :t1, :lv_dads, 'Adult class (Dads)', 'Hall 2', 20, 'sunday', '10:00', '11:30', true),
  ('75000000-0000-4000-8000-000000000c0a', :c, :t1, :lv_g1, 'Gujarati 1 · Library', 'Library', 10, 'sunday', '11:45', '12:45', true),
  ('75000000-0000-4000-8000-000000000c0b', :c, :t1, :lv_g3, 'Gujarati 3 · Library', 'Library', 10, 'sunday', '11:45', '12:45', true),
  ('75000000-0000-4000-8000-000000000c0d', :c, :t1, :lv_h1, 'Hindi 1 · Room H', 'H', 10, 'sunday', '11:45', '12:45', true),
  ('75000000-0000-4000-8000-000000000c21', :c, :t2, :lv_j1, 'Jainism 1 (next year)', 'A', 10, 'sunday', '10:00', '11:30', true);

-- ═════════════════════════════════════════════════════════════════════════════
-- Levels and age bands (§2.1)
-- ═════════════════════════════════════════════════════════════════════════════
begin;
select pg_temp.sign_in(:u_pia);
select app.save_pathshala_level(:c, jsonb_build_object('track_id', :tr_j, 'name', 'Jainism 8', 'min_age', 14, 'max_age', 17)) as lv8 \gset
select pg_temp.assert((:'lv8'::jsonb ->> 'key') = 'jainism_8' and (:'lv8'::jsonb ->> 'band') = 'children' and (:'lv8'::jsonb ->> 'active')::boolean
                      and (:'lv8'::jsonb ->> 'sort_order')::int = 10 and not (:'lv8'::jsonb ->> 'used')::boolean,
  'levels: the principal adds a level; its key comes from the name, it goes last in the track, and a maximum under 18 makes it a children''s level');
select pg_temp.assert_code(format($$select app.save_pathshala_level(%L, %L)$$, :c, jsonb_build_object('id', :'lv8'::jsonb ->> 'id', 'min_age', 12, 'max_age', 10)),
  '22023', 'The minimum age (12) is above the maximum age (10).', 'levels: a minimum above the maximum is refused in plain English');
select pg_temp.assert_code(format($$select app.save_pathshala_level(%L, %L)$$, :c, jsonb_build_object('id', :'lv8'::jsonb ->> 'id', 'max_age', 130)),
  '22023', 'The maximum age must be between 0 and 120', 'levels: ages are 0 to 120');
select pg_temp.assert_code(format($$select app.save_pathshala_level(%L, %L)$$, :c, jsonb_build_object('track_id', :tr_j, 'key', '2', 'name', 'Another 2')),
  '22023', 'There is already a level with the key "2" in Jainism.', 'levels: a key is unique in its track');
select pg_temp.assert_code(format($$select app.save_pathshala_level(%L, %L)$$, :c, jsonb_build_object('track_id', :tr_j, 'name', 'X', 'colour', 'red')),
  '22023', 'A level has no field called "colour".', 'levels: an unknown field is refused');
select pg_temp.assert_code(format($$select app.save_pathshala_level(%L, %L)$$, :c, jsonb_build_object('id', :lv_j2, 'track_id', :tr_g)),
  '22023', 'Jainism 2 has classes or registrations, so it cannot move to another track', 'levels: a used level cannot move to another track');
select app.save_pathshala_level(:c, jsonb_build_object('id', :'lv8'::jsonb ->> 'id', 'active', false)) as lv8r \gset
select pg_temp.assert(not (:'lv8r'::jsonb ->> 'active')::boolean and (:'lv8r'::jsonb ->> 'min_age')::int = 14,
  'levels: retiring a level keeps it (active false, nothing else changes)');
select pg_temp.assert_code(format($$delete from app.pathshala_levels where id = %L$$, :lv_j2),
  '22023', 'Jainism 2 has classes or registrations, so it cannot be deleted. Retire it instead', 'levels: a used level is never deleted');
delete from app.pathshala_levels where id = (:'lv8'::jsonb ->> 'id')::uuid;
select pg_temp.assert(not exists (select 1 from app.pathshala_levels where id = (:'lv8'::jsonb ->> 'id')::uuid),
  'levels: an unused level can still be deleted by the principal');
commit;
select pg_temp.assert(exists (select 1 from app.audit_log where record_table = 'pathshala_levels' and record_id = :'lv8'::jsonb ->> 'id'
                                and action = 'pathshala_levels.insert' and reason = 'Added the Pathshala level Jainism 8 (Jainism)')
                      and exists (select 1 from app.audit_log where record_table = 'pathshala_levels' and record_id = :'lv8'::jsonb ->> 'id'
                                    and action = 'pathshala_levels.update' and reason = 'Retired the Pathshala level Jainism 8 (Jainism)'),
  'levels: each change is audited with a plain reason');
begin;
select pg_temp.sign_in(:u_tara);
select pg_temp.assert_code(format($$select app.save_pathshala_level(%L, %L)$$, :c, jsonb_build_object('track_id', :tr_j, 'name', 'X')),
  '42501', 'needs pathshala.manage', 'levels: only the principal changes levels');
rollback;
select pg_temp.assert_raises(format($$insert into app.pathshala_levels (center_id, track_id, key, name, min_age, max_age) values (%L, %L, 'bad', 'Bad', 10, 5)$$, :c, :tr_j),
  'pathshala_levels_age_band', 'levels: the table itself refuses a minimum above the maximum (imports included)');
select pg_temp.assert(app.pathshala_level_band(18, null) = 'adult' and app.pathshala_level_band(3, 5) = 'children'
                      and app.pathshala_level_band(null, null) = 'any' and app.pathshala_level_band(12, 18) = 'any',
  'levels: minimum 18 or more is an adult class, a maximum under 18 a children''s level, anything else open to anyone');

-- ═════════════════════════════════════════════════════════════════════════════
-- The term form cannot leave Draft by itself (the trigger on the term's status)
-- ═════════════════════════════════════════════════════════════════════════════
begin;
select pg_temp.sign_in(:u_pia);
select pg_temp.assert_code(format($$update app.pathshala_terms set status = 'registration' where id = %L$$, :t1),
  '22023', 'use Open registration on its Fees screen', 'term form: a draft cannot be set to Registration directly');
select pg_temp.assert_code(format($$insert into app.pathshala_terms (center_id, name, starts_on, ends_on, status) values (%L, 'Direct', '2028-09-03', '2029-05-27', 'registration')$$, :c),
  '22023', 'use Open registration on its Fees screen', 'term form: a new term cannot start out of Draft');
select pg_temp.assert_code(format($$update app.pathshala_terms set payment_mode = 'pay_now' where id = %L$$, :t1),
  '22023', 'on its Fees screen', 'term form: pay now cannot be chosen by a direct write');
select pg_temp.assert_code(format($$update app.pathshala_terms set fees_locked_at = now() where id = %L$$, :t1),
  '22023', 'on its Fees screen', 'term form: the lock cannot be written directly');
update app.pathshala_terms set registration_closes_at = now() + interval '30 days', sibling_discount_pct = 10,
       fee_per_family_cap_cents = 27500 where id = :t1;
select pg_temp.assert((select sibling_discount_pct = 10 and fee_per_family_cap_cents = 27500 from app.pathshala_terms where id = :t1),
  'term form: before the lock it still sets the window, the sibling discount and the cap');
commit;
-- The bulk import is checked like the term form. It runs as the owner (app.import_set and app.import_insert are security
-- definer), so the guard knows it by the mark every write of a run carries: app.client_app = 'import' (app.import_audit).
begin;
select set_config('app.client_app', 'import', true);
select pg_temp.assert_code(format($$select app.import_set('pathshala_terms', %L, '{"status":"registration"}')$$, :t2),
  '22023', 'To open registration for Rounding term, use Open registration on its Fees screen', 'import: a draft cannot be imported straight to Registration (no fees, no lock)');
select pg_temp.assert_code(format($$select app.import_insert('pathshala_terms', %L)$$,
                                  jsonb_build_object('center_id', :c, 'name', 'Imported 2028-29', 'starts_on', '2028-09-03', 'ends_on', '2029-05-27', 'status', 'registration')),
  '22023', 'use Open registration on its Fees screen', 'import: nor can a new term be imported out of Draft');
select pg_temp.assert_code(format($$select app.import_set('pathshala_terms', %L, '{"payment_mode":"pay_now"}')$$, :t2),
  '22023', 'Set the payment mode and the fee rules of Rounding term on its Fees screen.', 'import: pay now cannot be imported either');
select app.import_insert('pathshala_terms', jsonb_build_object('center_id', :c, 'name', 'Imported draft', 'starts_on', '2029-09-02', 'ends_on', '2030-05-26')) as imported_draft \gset
select app.import_set('pathshala_terms', :'imported_draft', '{"name":"Imported draft (renamed)","sibling_discount_pct":5}');
select pg_temp.assert((select status = 'draft' and name = 'Imported draft (renamed)' and sibling_discount_pct = 5 from app.pathshala_terms where id = :'imported_draft'::uuid),
  'import: a draft term is still imported, and its unlocked rules still change');
rollback;
insert into app.pathshala_terms (center_id, name, starts_on, ends_on, status) values (:c, 'Imported 2024-25', '2024-09-01', '2025-05-25', 'closed');
select pg_temp.assert(exists (select 1 from app.pathshala_terms where center_id = :c and name = 'Imported 2024-25' and status = 'closed'),
  'term guard: the database itself (migrations, the demo pack, a script: the owner, with no import mark) still writes terms out of Draft');
-- The import's allow-list (app.import_entities, re-seeded in 0590 from the portal's registry): a Pathshala term takes its
-- dates, windows and membership rule only, so a file with a status, fee, cap or discount column is refused when it is
-- checked, before anything is written.
select pg_temp.assert((select columns from app.import_entities where key = 'pathshala_terms')
                        = array['ends_on','membership_required','name','registration_closes_at','registration_opens_at','starts_on'],
  'import: the allow-list of Pathshala terms is the dates, the windows and the membership rule (no status, fees, cap or discount)');
begin;
select pg_temp.sign_in(:u_pia);
select (app.import_create_run(:c, 'pathshala_terms', 'csv', 'terms.csv')) ->> 'id' as terms_run \gset
select pg_temp.assert_raises(format($$select app.import_stage_rows(%L, %L)$$, :'terms_run',
  '[{"row_no":2,"source_key":"2027-28","data":{"name":"2027-28","starts_on":"2027-09-05","ends_on":"2028-05-28","status":"registration"}}]'),
  'Row 2: status cannot be imported into "Pathshala terms".', 'import: a file that sets a term''s status is refused when it is checked');
select pg_temp.assert_raises(format($$select app.import_stage_rows(%L, %L)$$, :'terms_run',
  '[{"row_no":3,"source_key":"2027-28","data":{"name":"2027-28","starts_on":"2027-09-05","ends_on":"2028-05-28","sibling_discount_pct":15}}]'),
  'Row 3: sibling_discount_pct cannot be imported into "Pathshala terms".', 'import: so is one that sets the sibling discount');
select pg_temp.assert_raises(format($$select app.import_stage_rows(%L, %L)$$, :'terms_run',
  '[{"row_no":4,"source_key":"2027-28","data":{"name":"2027-28","starts_on":"2027-09-05","ends_on":"2028-05-28","fee_per_family_cap_cents":40000}}]'),
  'Row 4: fee_per_family_cap_cents cannot be imported into "Pathshala terms".', 'import: or the family cap');
select pg_temp.assert(app.import_stage_rows(:'terms_run'::uuid,
  '[{"row_no":5,"source_key":"2027-28","data":{"name":"2027-28","starts_on":"2027-09-05","ends_on":"2028-05-28","membership_required":true}}]'::jsonb) = 1,
  'import: a term''s dates and membership rule still import');
rollback;

-- ═════════════════════════════════════════════════════════════════════════════
-- An explicit fee for every offered level (§2.2, P21, P22)
-- ═════════════════════════════════════════════════════════════════════════════
begin;
select pg_temp.sign_in(:u_pia);
select pg_temp.assert_code(format($$select app.set_pathshala_level_fees(%L, %L)$$, :t1, jsonb_build_array(jsonb_build_object('level_id', :lv_tod, 'fee_cents', 49))),
  '22023', 'A fee is $0 (Free) or at least $0.50', 'fees: 1 to 49 cents is refused');
select pg_temp.assert_code(format($$select app.set_pathshala_level_fees(%L, %L)$$, :t1, jsonb_build_array(jsonb_build_object('level_id', :lv_tod, 'fee_cents', 'abc'))),
  '22023', 'must be a whole number', 'fees: a fee must be a whole number of cents');
select app.set_pathshala_level_fees(:t1, jsonb_build_array(
  jsonb_build_object('level_id', :lv_tod, 'fee_cents', 4500), jsonb_build_object('level_id', :lv_j1, 'fee_cents', 13000),
  jsonb_build_object('level_id', :lv_j2, 'fee_cents', 13000), jsonb_build_object('level_id', :lv_j3, 'fee_cents', 13000),
  jsonb_build_object('level_id', :lv_j5, 'fee_cents', 13000), jsonb_build_object('level_id', :lv_dads, 'fee_cents', 5000),
  jsonb_build_object('level_id', :lv_moms, 'fee_cents', 5000), jsonb_build_object('level_id', :lv_g1, 'fee_cents', 0))) as fees \gset
select pg_temp.assert(jsonb_array_length(:'fees'::jsonb -> 'fees') = 8 and not (:'fees'::jsonb ->> 'locked')::boolean
                      and (select array_agg(x ->> 'level' order by x ->> 'level') from jsonb_array_elements(:'fees'::jsonb -> 'missing') x) = array['Gujarati 3', 'Hindi 1'],
  'fees: the principal sets the owner''s example (Toddler $45, Jainism $130, adult classes $50, Gujarati 1 Free) while the term is a draft, and sees what is still missing');
select pg_temp.assert((select fee_cents from app.pathshala_level_fees where term_id = :t1 and level_id = :lv_g1) = 0, 'fees: $0 is allowed (Free)');
select pg_temp.assert_code(format($$select app.open_pathshala_registration(%L)$$, :t1),
  '22023', 'Set the fee for Gujarati 3 and Hindi 1 before opening registration.', 'fees: opening registration is refused with the missing levels named');
select pg_temp.assert((select status = 'draft' and fees_locked_at is null from app.pathshala_terms where id = :t1), 'fees: the refused opening changed nothing');
commit;
begin;
select pg_temp.sign_in(:u_mira);
select pg_temp.assert_code(format($$select app.set_pathshala_level_fees(%L, %L)$$, :t1, jsonb_build_array(jsonb_build_object('level_id', :lv_g3, 'fee_cents', 100))),
  '42501', 'needs pathshala.manage', 'fees: a member cannot set fees');
select pg_temp.assert_raises(format($$insert into app.pathshala_level_fees (center_id, term_id, level_id, fee_cents) values (%L, %L, %L, 100)$$, :c, :t1, :lv_g3),
  'permission denied', 'fees: nobody writes the fee table directly');
rollback;

-- ═════════════════════════════════════════════════════════════════════════════
-- Payment mode and its readiness (§2.7, P15–P20)
-- ═════════════════════════════════════════════════════════════════════════════
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c, 'giving', false, 'test');
begin;
select pg_temp.sign_in(:u_pia);
select pg_temp.assert(app.pathshala_pay_now_ready(:c) = 'Pay at registration needs Pledges & donations switched on (Settings › Modules).',
  'pay now: with Giving off the readiness answer says so');
select pg_temp.assert_code(format($$select app.set_pathshala_term_rules(%L, '{"payment_mode":"pay_now"}')$$, :t1),
  '22023', 'Pay at registration needs Pledges & donations switched on', 'pay now: refused while Giving is off');
rollback;
delete from app.center_modules where center_id = :c and module_key = 'giving';
begin;
select pg_temp.sign_in(:u_pia);
select pg_temp.assert_code(format($$select app.set_pathshala_term_rules(%L, '{"payment_mode":"pay_now"}')$$, :t1),
  '22023', 'Pay at registration needs card or PayPal payments connected', 'pay now: refused while no online method takes payments');
rollback;
insert into app.integration_connections (id, center_id, provider, status, settings)
values ('75000000-0000-4000-8000-000000000ec1', :c, 'stripe', 'connected', '{"mode":"live"}');
insert into app.center_payment_processors (center_id, processor, connection_id, status, methods, is_default)
values (:c, 'stripe', '75000000-0000-4000-8000-000000000ec1', 'live', array['card'], true);
begin;
select pg_temp.sign_in(:u_pia);
select pg_temp.assert(app.pathshala_pay_now_ready(:c) = 'Pay at registration waits for fee receipts (P13).',
  'pay now: with card payments live it still waits for fee receipts (P13) until 0595');
select pg_temp.assert_code(format($$select app.set_pathshala_term_rules(%L, '{"payment_mode":"pay_now"}')$$, :t1),
  '22023', 'Pay at registration waits for fee receipts (P13).', 'pay now: refused before 0595 with its sentence');
select pg_temp.assert_code(format($$select app.set_pathshala_term_rules(%L, '{"seat_rule":"office","colour":1}')$$, :t1),
  '22023', 'A term has no rule called "colour".', 'rules: an unknown rule is refused');
select pg_temp.assert_code(format($$select app.set_pathshala_term_rules(%L, '{"hold_hours":200}')$$, :t1),
  '22023', '1 to 168 hours', 'rules: a hold is 1 to 168 hours');
select app.set_pathshala_term_rules(:t1, '{"seat_rule":"office"}') as r_office \gset
select app.set_pathshala_term_rules(:t1, jsonb_build_object('seat_rule', 'automatic', 'late_fee_cents', 2500,
         'late_registration_closes_at', (now() + interval '40 days')::text)) as r_auto \gset
select pg_temp.assert((:'r_office'::jsonb ->> 'seat_rule') = 'office' and (:'r_auto'::jsonb ->> 'seat_rule') = 'automatic'
                      and (:'r_auto'::jsonb -> 'window' ->> 'late_fee_cents')::int = 2500,
  'rules: the principal sets the seat rule (office step, pledge mode) and the late window and fee while the term is a draft');
select pg_temp.assert_code(format($$select app.set_pathshala_term_rules(%L, '{"fund_id":"75000000-0000-4000-8000-000000000f01"}')$$, :t1),
  '42501', 'needs giving.manage', 'rules: only the treasurer chooses the fund');
commit;
begin;
update app.pathshala_terms set payment_mode = 'pay_now' where id = :t1;
select pg_temp.assert_raises(format($$update app.pathshala_terms set seat_rule = 'office' where id = %L$$, :t1),
  'pathshala_terms_payment_rules', 'rules: the table refuses the office step with pay now');
select pg_temp.sign_in(:u_pia);
select pg_temp.assert_code(format($$select app.set_pathshala_term_rules(%L, '{"seat_rule":"office"}')$$, :t1),
  '22023', 'The office step works only with Pledge', 'rules: the office step is refused in a pay-now term, in plain English');
rollback;

-- ═════════════════════════════════════════════════════════════════════════════
-- Opening registration: the lock, the campaign and fund
-- ═════════════════════════════════════════════════════════════════════════════
begin;
select pg_temp.sign_in(:u_pia);
select app.set_pathshala_level_fees(:t1, jsonb_build_array(jsonb_build_object('level_id', :lv_g3, 'fee_cents', 13000),
                                                           jsonb_build_object('level_id', :lv_h1, 'fee_cents', 13000))) as fees2 \gset
select app.open_pathshala_registration(:t1) as opened \gset
select pg_temp.assert((:'opened'::jsonb ->> 'status') = 'registration' and not (:'opened'::jsonb ->> 'already_open')::boolean
                      and (:'opened'::jsonb ->> 'fund_id') = :fund_p and (:'opened'::jsonb ->> 'payment_mode') = 'pledge'
                      and jsonb_array_length(:'opened'::jsonb -> 'warnings') = 3,
  'open: every offered level has its fee, so registration opens (pledge mode) with the Pathshala fund; the three offered levels with no age band (Gujarati 1 and 3, Hindi 1) are warned about');
select app.open_pathshala_registration(:t1) as again \gset
select pg_temp.assert((:'again'::jsonb ->> 'already_open')::boolean, 'open: opening again changes nothing');
commit;
select pg_temp.assert((select t.status = 'registration' and t.fees_locked_at is not null and t.fees_locked_by = :u_pia
                          and t.age_cutoff_on = '2026-09-06' and t.withdrawal_credit_until = '2026-09-20'
                          and c.name = 'Pathshala fees 2026-27' and c.kind = 'pathshala' and c.status = 'closed' and c.fund_id = :fund_p
                         from app.pathshala_terms t join app.campaigns c on c.id = t.campaign_id where t.id = :t1),
  'open: the fees and rules are locked, the cut-off (the first day) and withdrawal deadline (first class day + 14) are fixed, and the closed campaign "Pathshala fees 2026-27" is linked to the Pathshala fund');
select pg_temp.assert((select count(*) from app.campaigns where center_id = :c and kind = 'pathshala') = 1, 'open: one campaign, however often it is opened');
select pg_temp.assert(exists (select 1 from app.audit_log where record_table = 'pathshala_terms' and record_id = :t1
                                and reason like 'Opened Pathshala registration for 2026-27 (pledge mode; fees and rules locked)%'),
  'open: the opening is audited in plain words');
-- A locked term's rules: the bulk import is refused (only the treasurer changes them, through the functions, with a reason).
begin;
select set_config('app.client_app', 'import', true);
select pg_temp.assert_code(format($$select app.import_set('pathshala_terms', %L, '{"sibling_discount_pct":20}')$$, :t1),
  '22023', 'The fee rules of 2026-27 are locked since registration opened.', 'import: a locked term''s sibling discount cannot be changed by an import');
select pg_temp.assert_code(format($$select app.import_set('pathshala_terms', %L, '{"fee_per_family_cap_cents":90000}')$$, :t1),
  '22023', 'are locked since registration opened', 'import: nor its family cap');
select pg_temp.assert_code(format($$select app.import_set('pathshala_terms', %L, '{"fund_id":null}')$$, :t1),
  '22023', 'Set the payment mode and the fee rules of 2026-27 on its Fees screen.', 'import: nor its fund');
select app.import_set('pathshala_terms', :t1, '{"name":"2026-27"}');
select pg_temp.assert((select name = '2026-27' from app.pathshala_terms where id = :t1), 'import: what is not locked (the name) still imports');
rollback;

-- After opening only the treasurer changes fees and rules, with a reason, for new registrations only (P9, P16).
-- An earlier quote (a fee row already written) never changes.
insert into app.pathshala_enrollments (id, center_id, term_id, student_person_id, household_id, requested_level_id, status)
values ('75000000-0000-4000-8000-000000000ee1', :c, :t1, :p_kiran, :h2, :lv_j2, 'requested');
insert into app.pathshala_enrollment_fees (center_id, enrollment_id, term_id, household_id, level_id, learner_kind, family_rank, base_fee_cents, total_cents)
values (:c, '75000000-0000-4000-8000-000000000ee1', :t1, :h2, :lv_j2, 'child', 1, 13000, 13000);
begin;
select pg_temp.sign_in(:u_pia);
select pg_temp.assert_code(format($$select app.set_pathshala_level_fees(%L, %L)$$, :t1, jsonb_build_array(jsonb_build_object('level_id', :lv_j2, 'fee_cents', 14000))),
  '42501', 'The treasurer (giving.manage) can change them', 'locked: the principal can no longer change a fee');
select pg_temp.assert_code(format($$select app.set_pathshala_term_rules(%L, '{"hold_hours":24}')$$, :t1),
  '42501', 'The treasurer (giving.manage) can change them', 'locked: nor a rule');
select pg_temp.assert_code(format($$update app.pathshala_terms set sibling_discount_pct = 20 where id = %L$$, :t1),
  '22023', 'are locked since registration opened', 'locked: the term form cannot change a locked rule directly');
update app.pathshala_terms set name = '2026-27' where id = :t1;
select pg_temp.assert_code(format($$update app.pathshala_terms set registration_closes_at = registration_closes_at + interval '7 days' where id = %L$$, :t1),
  '22023', 'The fee rules of 2026-27 are locked since registration opened.', 'locked: the term form cannot move when registration closes (where the late fee starts)');
select pg_temp.assert_code(format($$update app.pathshala_terms set registration_opens_at = now() - interval '1 day' where id = %L$$, :t1),
  '22023', 'are locked since registration opened', 'locked: nor when it opens');
select pg_temp.assert_code(format($$update app.pathshala_terms set membership_required = false where id = %L$$, :t1),
  '22023', 'are locked since registration opened', 'locked: nor switch off the membership rule');
select pg_temp.assert_code(format($$update app.pathshala_terms set status = 'draft' where id = %L$$, :t1),
  '22023', '2026-27 has opened for registration, so it cannot go back to Draft.', 'locked: nor put the term back to Draft');
update app.pathshala_terms set no_class_dates = array['2026-11-29']::date[] where id = :t1;
select pg_temp.assert((select no_class_dates = array['2026-11-29']::date[] from app.pathshala_terms where id = :t1),
  'locked: the no-class dates (and the first day) stay with the principal');
rollback;
begin;
select pg_temp.sign_in(:u_tara);
select pg_temp.assert_code(format($$select app.set_pathshala_level_fees(%L, %L)$$, :t1, jsonb_build_array(jsonb_build_object('level_id', :lv_j2, 'fee_cents', 14000))),
  '22023', 'say why the fees change', 'locked: the treasurer must give a reason');
select app.set_pathshala_level_fees(:t1, jsonb_build_array(jsonb_build_object('level_id', :lv_j2, 'fee_cents', 14000)), 'Board raised the Jainism 2 fee') as f3 \gset
select pg_temp.assert_code(format($$select app.set_pathshala_level_fees(%L, %L, 'x')$$, :t1, jsonb_build_array(jsonb_build_object('level_id', :lv_j2, 'fee_cents', null))),
  '22023', 'Jainism 2 has a class in 2026-27, so its fee cannot be removed while registration is open.', 'locked: a fee of an offered level cannot be removed');
commit;
select pg_temp.assert((select fee_cents from app.pathshala_level_fees where term_id = :t1 and level_id = :lv_j2) = 14000
                      and exists (select 1 from app.audit_log where record_table = 'pathshala_level_fees' and reason = 'Board raised the Jainism 2 fee')
                      and (select total_cents from app.pathshala_enrollment_fees where enrollment_id = '75000000-0000-4000-8000-000000000ee1') = 13000,
  'locked: the treasurer changes a fee with a reason (audited); the quote already made stays at $130.00');
begin;
select pg_temp.sign_in(:u_tara);
select app.set_pathshala_level_fees(:t1, jsonb_build_array(jsonb_build_object('level_id', :lv_j2, 'fee_cents', 13000)), 'Back to $130 for the example') as f4 \gset
commit;
-- The fund every fee pledge carries can change after opening, never be emptied (0591 bills with it).
insert into app.funds (id, center_id, key, name) values ('75000000-0000-4000-8000-000000000f02', :c, 'education', 'Education');
begin;
select pg_temp.sign_in(:u_tara);
select pg_temp.assert_code(format($$select app.set_pathshala_term_rules(%L, '{"fund_id":null}', 'No fund')$$, :t1),
  '22023', 'The fund for the Pathshala fees cannot be cleared once registration has opened. Choose another fund instead.',
  'fund: the treasurer cannot clear the fund once registration has opened');
select app.set_pathshala_term_rules(:t1, '{"fund_id":"75000000-0000-4000-8000-000000000f02"}', 'Fees go to Education this year') as r_fund \gset
select pg_temp.assert((:'r_fund'::jsonb ->> 'fund_id') = '75000000-0000-4000-8000-000000000f02'
                      and (select c.fund_id = '75000000-0000-4000-8000-000000000f02' from app.campaigns c join app.pathshala_terms t on t.id = :t1 where c.id = t.campaign_id),
  'fund: choosing another fund works (with a reason), and the term''s campaign follows it');
rollback;
-- The registration dates and the membership rule are locked rules too: the treasurer changes them, with a reason, and the
-- late window still ends after registration closes.
begin;
select pg_temp.sign_in(:u_tara);
select pg_temp.assert_code(format($$select app.set_pathshala_term_rules(%L, '{"membership_required": false}')$$, :t1),
  '22023', 'say why the fee rules change', 'locked: changing the membership rule after opening needs a reason');
select app.set_pathshala_term_rules(:t1, jsonb_build_object('registration_closes_at', (now() + interval '35 days')::text, 'membership_required', false),
                                    'Registration extended by five days') as r_dates \gset
select pg_temp.assert_code(format($$select app.set_pathshala_term_rules(%L, %L, 'Later still')$$, :t1, jsonb_build_object('registration_closes_at', (now() + interval '45 days')::text)),
  '22023', 'The late window must end after registration closes.', 'locked: registration cannot close after the late window ends');
select pg_temp.assert_code(format($$select app.set_pathshala_term_rules(%L, %L, 'Backwards')$$, :t1, jsonb_build_object('registration_opens_at', (now() + interval '36 days')::text)),
  '22023', 'Registration must close after it opens.', 'locked: nor open after it closes');
rollback;
select pg_temp.assert(not (:'r_dates'::jsonb ->> 'membership_required')::boolean
                      and (:'r_dates'::jsonb -> 'window' ->> 'closes_at')::timestamptz > now() + interval '34 days',
  'locked: the treasurer moves when registration closes and the membership rule, with a reason');
delete from app.pathshala_enrollment_fees where enrollment_id = '75000000-0000-4000-8000-000000000ee1';
delete from app.pathshala_enrollments where id = '75000000-0000-4000-8000-000000000ee1';

-- ═════════════════════════════════════════════════════════════════════════════
-- The pricing rule: the owner's example exactly (§2.4)
-- ═════════════════════════════════════════════════════════════════════════════
\set family '''[{"person_id":"75000000-0000-4000-8000-0000000000a4","track_id":"75000000-0000-4000-8000-0000000000d1","level_id":"75000000-0000-4000-8000-0000000000e5"},{"person_id":"75000000-0000-4000-8000-0000000000a5","track_id":"75000000-0000-4000-8000-0000000000d1","level_id":"75000000-0000-4000-8000-0000000000e2"},{"person_id":"75000000-0000-4000-8000-0000000000a6","track_id":"75000000-0000-4000-8000-0000000000d1","level_id":"75000000-0000-4000-8000-0000000000e0"},{"person_id":"75000000-0000-4000-8000-0000000000a3","track_id":"75000000-0000-4000-8000-0000000000d1","level_id":"75000000-0000-4000-8000-0000000000e9"}]'''
select count(*) as audit_before from app.audit_log \gset
begin;
select pg_temp.sign_in(:u_mira);
select app.pathshala_quote(:t1, :h1, :family::jsonb) as q \gset
commit;
select pg_temp.assert((select array_agg((x ->> 'total_cents')::int order by (x ->> 'index')::int) from jsonb_array_elements(:'q'::jsonb -> 'lines') x)
                        = array[13000, 11700, 2800, 5000]
                      and (:'q'::jsonb ->> 'total_cents')::int = 32500 and (:'q'::jsonb ->> 'children_total_cents')::int = 27500
                      and (:'q'::jsonb ->> 'adults_total_cents')::int = 5000,
  'quote: the owner''s example is exactly $130.00, $117.00, $28.00 and $50.00 = $325.00 (children $275.00, adults $50.00)');
select pg_temp.assert((select array_agg(coalesce(x ->> 'family_rank', '-') || '/' || (x ->> 'sibling_discount_cents') || '/' || (x ->> 'cap_reduction_cents')
                                         || '/' || (x ->> 'learner_kind') || '/' || (x ->> 'age_on_cutoff') order by (x ->> 'index')::int)
                         from jsonb_array_elements(:'q'::jsonb -> 'lines') x)
                        = array['1/0/0/child/12', '2/1300/0/child/9', '3/450/1250/child/4', '-/0/0/adult/44'],
  'quote: Riya (12) is the first child; Dev gets 10% off; Anya''s $40.50 is cut by $12.50 to meet the $275.00 cap; Mira (44) is an adult, outside the discount and the cap');
select pg_temp.assert((select count(*) from app.audit_log) = :audit_before::bigint
                      and not exists (select 1 from app.pathshala_enrollment_fees where term_id = :t1),
  'quote: the quote writes nothing');
-- With no cap: Anya pays $40.50 and the family $337.50.
update app.pathshala_terms set fee_per_family_cap_cents = null where id = :t1;
begin;
select pg_temp.sign_in(:u_mira);
select app.pathshala_quote(:t1, :h1, :family::jsonb) as q_nocap \gset
commit;
select pg_temp.assert((:'q_nocap'::jsonb ->> 'total_cents')::int = 33750 and (:'q_nocap'::jsonb -> 'lines' -> 2 ->> 'total_cents')::int = 4050,
  'quote: with no cap Anya pays $40.50 and the family $337.50');
-- A family cap of $0 or less prices as no cap (it would make every child free); saving one is refused.
begin;
update app.pathshala_terms set fee_per_family_cap_cents = 0 where id = :t1;   -- an old row: the database itself writes it
select pg_temp.sign_in(:u_mira);
select app.pathshala_quote(:t1, :h1, :family::jsonb) as q_cap0 \gset
select app.pathshala_registration_options(:t1, :h1) as opt_cap0 \gset
rollback;
select pg_temp.assert((:'q_cap0'::jsonb ->> 'total_cents')::int = 33750 and (:'q_cap0'::jsonb -> 'rule_snapshot' -> 'family_cap_cents') = 'null'::jsonb
                      and (:'opt_cap0'::jsonb -> 'term' -> 'family_cap_cents') = 'null'::jsonb,
  'cap: a stored family cap of $0 prices as no cap ($337.50), never as free, and the term shows no cap');
begin;
select pg_temp.sign_in(:u_pia);
select pg_temp.assert_code(format($$update app.pathshala_terms set fee_per_family_cap_cents = 0 where id = %L$$, :t2),
  '22023', 'A family cap is at least $0.50 (at most $1,000,000); leave it empty for no cap.', 'cap: the term form cannot save a $0 cap');
select pg_temp.assert_code(format($$update app.pathshala_terms set fee_per_family_cap_cents = 49 where id = %L$$, :t2),
  '22023', 'A family cap is at least $0.50', 'cap: nor one under $0.50');
select pg_temp.assert_code(format($$select app.set_pathshala_term_rules(%L, '{"fee_per_family_cap_cents": 0}')$$, :t2),
  '22023', 'A family cap is at least $0.50', 'cap: nor the Fees screen');
rollback;
update app.pathshala_terms set fee_per_family_cap_cents = 27500 where id = :t1;
-- In the late window each of the four lines gets +$25.00: $425.00.
update app.pathshala_terms set registration_closes_at = now() - interval '1 day' where id = :t1;
begin;
select pg_temp.sign_in(:u_mira);
select app.pathshala_quote(:t1, :h1, :family::jsonb) as q_late \gset
select app.pathshala_registration_options(:t1, :h1) as opt_late \gset
commit;
select pg_temp.assert((:'q_late'::jsonb ->> 'total_cents')::int = 42500 and (:'q_late'::jsonb ->> 'late')::boolean
                      and (select bool_and((x ->> 'late_fee_cents')::int = 2500) from jsonb_array_elements(:'q_late'::jsonb -> 'lines') x)
                      and (:'opt_late'::jsonb -> 'term' -> 'window' ->> 'state') = 'late',
  'quote: in the late window each of the four learners gets the $25.00 late fee, outside the discount and the cap: $425.00');
update app.pathshala_terms set registration_closes_at = now() + interval '30 days' where id = :t1;
begin;
select pg_temp.sign_in(:u_pia);
select app.pathshala_fee_example(:t1, jsonb_build_object('late', true, 'lines', jsonb_build_array(
  jsonb_build_object('name', 'Riya', 'age', 12, 'level_id', :lv_j5), jsonb_build_object('name', 'Dev', 'age', 9, 'level_id', :lv_j2),
  jsonb_build_object('name', 'Anya', 'age', 4, 'level_id', :lv_tod), jsonb_build_object('name', 'Mira', 'age', 44, 'level_id', :lv_moms)))) as ex_late \gset
select app.pathshala_fee_example(:t1, jsonb_build_array(
  jsonb_build_object('name', 'Riya', 'age', 12, 'level_id', :lv_j5), jsonb_build_object('name', 'Dev', 'age', 9, 'level_id', :lv_j2),
  jsonb_build_object('name', 'Anya', 'age', 4, 'level_id', :lv_tod), jsonb_build_object('name', 'Mira', 'age', 44, 'level_id', :lv_moms))) as ex \gset
commit;
select pg_temp.assert((:'ex'::jsonb ->> 'total_cents')::int = 32500 and (:'ex_late'::jsonb ->> 'total_cents')::int = 42500,
  'Try a family: the Fees screen shows the same $325.00, and $425.00 in the late window');
-- "Try a family" prices as a registration does (P10). The Riya case: one learner in Jainism 5 and a $130 Gujarati level
-- (Gujarati 3 here) with a 10% sibling discount is ONE child: $260.00, not the $247.00 of two children, and one late fee.
begin;
select pg_temp.sign_in(:u_pia);
select app.pathshala_fee_example(:t1, jsonb_build_object('late', false, 'lines', jsonb_build_array(
  jsonb_build_object('learner', 'Riya', 'age', 12, 'level_id', :lv_j5),
  jsonb_build_object('learner', ' riya ', 'level_id', :lv_g3)))) as ex_riya \gset
select app.pathshala_fee_example(:t1, jsonb_build_object('late', true, 'lines', jsonb_build_array(
  jsonb_build_object('learner', 'Riya', 'age', 12, 'level_id', :lv_j5),
  jsonb_build_object('learner', 'RIYA', 'level_id', :lv_g3)))) as ex_riya_late \gset
select app.pathshala_fee_example(:t1, jsonb_build_object('late', false, 'lines', jsonb_build_array(
  jsonb_build_object('name', 'Riya', 'age', 12, 'level_id', :lv_j5),
  jsonb_build_object('name', 'Riya', 'age', 12, 'level_id', :lv_g3)))) as ex_two \gset
-- Each line's refusal: the sentence a registration would give, or null.
select app.pathshala_fee_example(:t1, jsonb_build_array(
  jsonb_build_object('learner', 'Dev', 'age', 9, 'level_id', :lv_moms),
  jsonb_build_object('learner', 'Mira', 'age', 44, 'level_id', :lv_j2),
  jsonb_build_object('learner', 'Dev', 'level_id', :lv_j2),
  jsonb_build_object('learner', 'Dev', 'level_id', :lv_j5),
  jsonb_build_object('learner', 'Kiran', 'age', 10, 'level_id', :lv_g4),
  jsonb_build_object('learner', 'Anya', 'age', 4, 'level_id', :lv_tod),
  jsonb_build_object('learner', 'Anya', 'track_id', :tr_g, 'level_id', :lv_j3),
  jsonb_build_object('learner', 'Isha', 'age', 6, 'level_id', :lv_j1),
  jsonb_build_object('learner', 'Kanta'))) as ex_ref \gset
select pg_temp.assert_code(format($$select app.pathshala_fee_example(%L, %L)$$, :t1, jsonb_build_array(jsonb_build_object('learner', repeat('x', 81), 'level_id', :lv_j2))),
  '22023', 'A learner''s name is 1 to 80 characters.', 'Try a family: a learner''s name is 1 to 80 characters');
select pg_temp.assert_code(format($$select app.pathshala_fee_example(%L, %L)$$, :t1, jsonb_build_array(jsonb_build_object('learner', '   ', 'level_id', :lv_j2))),
  '22023', 'A learner''s name is 1 to 80 characters.', 'Try a family: a blank learner name is refused');
select pg_temp.assert_code(format($$select app.pathshala_fee_example(%L, %L)$$, :t1,
                                  jsonb_build_array(jsonb_build_object('learner', 'Dev', 'age', 9, 'level_id', :lv_j2), jsonb_build_object('learner', 'dev', 'age', 10, 'level_id', :lv_g3))),
  '22023', 'Dev is listed with two different ages.', 'Try a family: one learner cannot be given two ages');
commit;
select pg_temp.assert((:'ex_riya'::jsonb ->> 'total_cents')::int = 26000 and (:'ex_two'::jsonb ->> 'total_cents')::int = 24700
                      and (select array_agg((x ->> 'family_rank') || '/' || (x ->> 'sibling_discount_cents') || '/' || (x ->> 'total_cents') || '/' || coalesce(x ->> 'refusal', '-')
                                            order by (x ->> 'index')::int)
                             from jsonb_array_elements(:'ex_riya'::jsonb -> 'lines') x) = array['1/0/13000/-', '1/0/13000/-'],
  'Try a family: Riya in Jainism 5 and Gujarati 3 is one child, first in both tracks: $260.00, not the $247.00 of two children (lines without a learner stay separate)');
select pg_temp.assert((:'ex_riya_late'::jsonb ->> 'total_cents')::int = 28500
                      and (select array_agg((x ->> 'late_fee_cents')::int order by (x ->> 'index')::int) from jsonb_array_elements(:'ex_riya_late'::jsonb -> 'lines') x) = array[2500, 0],
  'Try a family: in the late window Riya pays one $25.00 late fee, not one per track: $285.00');
select pg_temp.assert((select array_agg(coalesce(x ->> 'refusal', '-') order by (x ->> 'index')::int) from jsonb_array_elements(:'ex_ref'::jsonb -> 'lines') x)
                        = array['Adult class (Moms) is for adults, and Dev is 9.', 'Jainism 2 is a children''s class, and Mira is an adult.', '-',
                                'Dev is listed twice for Jainism.', 'Gujarati 4 has no fee for 2026-27 yet, so it cannot be chosen.', '-',
                                'That level is not in the Gujarati track.', 'Jainism 1 is not offered in 2026-27.',
                                'Choose a track (Jainism, Gujarati, Hindi …) for Kanta.'],
  'Try a family: each line carries the sentence a registration would refuse it with (an adult class for a child, a children''s level for an adult, one level per track, no fee, another track''s level, not offered, no track), or null');
select pg_temp.assert((:'ex_ref'::jsonb ->> 'total_cents')::int = 17050 and (:'ex_ref'::jsonb ->> 'children_total_cents')::int = 17050
                      and (select bool_and(not (x ->> 'priced')::boolean and (x ->> 'base_fee_cents')::int = 0 and (x ->> 'sibling_discount_cents')::int = 0
                                           and (x ->> 'cap_reduction_cents')::int = 0 and (x ->> 'late_fee_cents')::int = 0
                                           and (x ->> 'total_cents')::int = 0 and x ->> 'family_rank' is null)
                             from jsonb_array_elements(:'ex_ref'::jsonb -> 'lines') x where x ->> 'refusal' is not null)
                      and (select array_agg((x ->> 'family_rank') || '/' || (x ->> 'total_cents') order by (x ->> 'index')::int)
                             from jsonb_array_elements(:'ex_ref'::jsonb -> 'lines') x where x ->> 'refusal' is null) = array['1/13000', '2/4050'],
  'Try a family: a refused line is not priced (every amount 0, no rank) and is out of the totals and the sibling order: Dev $130.00 and Anya (second child) $40.50 = $170.50');
select pg_temp.assert((:'ex'::jsonb -> 'lines' -> 0 ? 'refusal') and not (:'q'::jsonb -> 'lines' -> 0 ? 'refusal'),
  'Try a family: every line of the example has refusal; a family''s quote has none (only "Try a family" adds it)');

-- P2: the first child is the one with the highest level fee; between equal fees the older child.
\set ties '''[{"person_id":"75000000-0000-4000-8000-0000000000a5","track_id":"75000000-0000-4000-8000-0000000000d1","level_id":"75000000-0000-4000-8000-0000000000e2"},{"person_id":"75000000-0000-4000-8000-0000000000a6","track_id":"75000000-0000-4000-8000-0000000000d1","level_id":"75000000-0000-4000-8000-0000000000e0"},{"person_id":"75000000-0000-4000-8000-0000000000a4","track_id":"75000000-0000-4000-8000-0000000000d1","level_id":"75000000-0000-4000-8000-0000000000e5"}]'''
begin;
select pg_temp.sign_in(:u_mira);
select app.pathshala_quote(:t1, :h1, :ties::jsonb) as q_ties \gset
commit;
select pg_temp.assert((select array_agg((x ->> 'family_rank')::int order by (x ->> 'index')::int) from jsonb_array_elements(:'q_ties'::jsonb -> 'lines') x) = array[2, 3, 1],
  'P2: listed Dev, Anya, Riya: Riya (the older of the two $130 children) pays full, Dev is second, Anya ($45) third');

-- A second batch: Riya registered in August, Dev in September: Dev still gets the 10%.
insert into app.pathshala_enrollments (id, center_id, term_id, student_person_id, household_id, requested_level_id, status, registered_at)
values ('75000000-0000-4000-8000-000000000ee2', :c, :t1, :p_riya, :h1, :lv_j5, 'requested', now() - interval '30 days');
insert into app.pathshala_enrollment_fees (center_id, enrollment_id, term_id, household_id, level_id, learner_kind, family_rank, base_fee_cents, total_cents)
values (:c, '75000000-0000-4000-8000-000000000ee2', :t1, :h1, :lv_j5, 'child', 1, 13000, 13000);
begin;
select pg_temp.sign_in(:u_mira);
select app.pathshala_quote(:t1, :h1, jsonb_build_array(jsonb_build_object('person_id', :p_dev, 'track_id', :tr_j, 'level_id', :lv_j2),
                                                        jsonb_build_object('person_id', :p_dev, 'track_id', :tr_g, 'level_id', :lv_g3))) as q_batch \gset
commit;
select pg_temp.assert((select array_agg((x ->> 'family_rank')::int || '/' || (x ->> 'sibling_discount_cents') order by (x ->> 'index')::int)
                         from jsonb_array_elements(:'q_batch'::jsonb -> 'lines') x) = array['2/1300', '2/1300'],
  'quote: Riya was registered earlier, so Dev is the second child in a later batch and gets 10% off EACH of his two tracks (Jainism 2 and Gujarati 3)');
-- The cap counts the earlier batch first: Riya $130 + Dev $117 = $247; Dev's second $117 would make $364, so it is cut by
-- $89 to $28 (the children's total is the $275 cap).
select pg_temp.assert((select array_agg((x ->> 'cap_reduction_cents') || '/' || (x ->> 'total_cents') order by (x ->> 'index')::int)
                         from jsonb_array_elements(:'q_batch'::jsonb -> 'lines') x) = array['0/11700', '8900/2800']
                      and (:'q_batch'::jsonb ->> 'children_total_cents')::int = 14500,
  'quote: Riya''s $130.00 already counts toward the $275.00 cap, so Dev''s second line is cut to $28.00');
delete from app.pathshala_enrollment_fees where enrollment_id = '75000000-0000-4000-8000-000000000ee2';
delete from app.pathshala_enrollments where id = '75000000-0000-4000-8000-000000000ee2';

-- A child with no birth date counts as a child when the household records them as one (the 0587 rule); an adult with no
-- birth date who is not recorded as a child is an adult.
begin;
select pg_temp.sign_in(:u_mira);
select app.pathshala_quote(:t1, :h1, jsonb_build_array(jsonb_build_object('person_id', :p_kid_nodob, 'track_id', :tr_g, 'level_id', :lv_g3),
                                                        jsonb_build_object('person_id', :p_adult_nodob, 'track_id', :tr_g, 'level_id', :lv_g3),
                                                        jsonb_build_object('person_id', :p_dev, 'track_id', :tr_j, 'level_id', :lv_j2))) as q_nodob \gset
commit;
select pg_temp.assert((select array_agg((x ->> 'learner_kind') || '/' || coalesce(x ->> 'family_rank', '-') || '/' || (x ->> 'total_cents') order by (x ->> 'index')::int)
                         from jsonb_array_elements(:'q_nodob'::jsonb -> 'lines') x) = array['child/2/11700', 'adult/-/13000', 'child/1/13000'],
  'quote: Isha (no birth date, a child of the household) is a child; Kanta (no birth date, not recorded as a child) is an adult; Dev (older, known age) ranks first');

-- Rounding to the cent: $45.50 at 15% is $6.825 → $6.83 off; $45.55 at 15% is $6.8325 → $6.83 off.
update app.pathshala_terms set sibling_discount_pct = 15, fee_per_family_cap_cents = null where id = :t2;
insert into app.pathshala_level_fees (center_id, term_id, level_id, fee_cents) values (:c, :t2, :lv_j1, 4550);
begin;
select pg_temp.sign_in(:u_pia);
select app.pathshala_fee_example(:t2, jsonb_build_array(jsonb_build_object('name', 'A', 'age', 6, 'level_id', :lv_j1),
                                                         jsonb_build_object('name', 'B', 'age', 5, 'level_id', :lv_j1))) as q_round \gset
commit;
update app.pathshala_level_fees set fee_cents = 4555 where term_id = :t2 and level_id = :lv_j1;
begin;
select pg_temp.sign_in(:u_pia);
select app.pathshala_fee_example(:t2, jsonb_build_array(jsonb_build_object('name', 'A', 'age', 6, 'level_id', :lv_j1),
                                                         jsonb_build_object('name', 'B', 'age', 5, 'level_id', :lv_j1))) as q_round2 \gset
commit;
select pg_temp.assert((:'q_round'::jsonb -> 'lines' -> 1 ->> 'sibling_discount_cents')::int = 683 and (:'q_round'::jsonb -> 'lines' -> 1 ->> 'total_cents')::int = 3867
                      and (:'q_round2'::jsonb -> 'lines' -> 1 ->> 'sibling_discount_cents')::int = 683 and (:'q_round2'::jsonb -> 'lines' -> 1 ->> 'total_cents')::int = 3872,
  'quote: discounts are rounded to the cent (half a cent rounds up)');
-- Opening with no fund for the fees: the principal is told what to ask for. A treasurer with giving.manage but without
-- pathshala.view cannot read a draft term, so the Fees screen is not the only way: a fund called Pathshala in Setup › Lists.
begin;
update app.funds set active = false where center_id = :c;
insert into app.funds (center_id, key, name) values (:c, 'pathshala_building', 'Pathshala building fund');   -- not the fees' fund
select pg_temp.sign_in(:u_pia);
select pg_temp.assert_code(format($$select app.open_pathshala_registration(%L)$$, :t2),
  '22023', 'There is no fund for the Pathshala fees yet. Ask the treasurer to add a fund called Pathshala in Setup › Lists, or choose a fund on this Fees screen if you also manage Giving; then open registration.',
  'open: with no fund for the fees (a "Pathshala building fund" is not it: the fund is found by its key, pathshala) the refusal says to add a fund called Pathshala in Setup › Lists');
rollback;

-- Refusals and who may ask.
begin;
select pg_temp.sign_in(:u_mira);
select pg_temp.assert_code(format($$select app.pathshala_quote(%L, %L, %L)$$, :t1, :h1, jsonb_build_array(jsonb_build_object('person_id', :p_dev, 'track_id', :tr_g, 'level_id', :lv_g4))),
  '22023', 'Gujarati 4 has no fee for 2026-27 yet, so it cannot be chosen.', 'quote: a level without a fee is refused, never guessed');
select pg_temp.assert_code(format($$select app.pathshala_quote(%L, %L, %L)$$, :t1, :h2, :family),
  '42501', 'Only an adult of the family', 'quote: another family''s adult cannot see this family''s fees');
rollback;
begin;
select pg_temp.sign_in(:u_mira);
select pg_temp.assert_code(format($$select app.pathshala_quote(%L, %L, %L)$$, :t1, :h1, jsonb_build_array(jsonb_build_object('person_id', :p_kiran, 'track_id', :tr_j, 'level_id', :lv_j2))),
  '22023', 'That learner is not a current member of the Shah household (P75-H-2001).', 'quote: a family cannot price someone of another family (no age or child status of theirs is returned)');
rollback;
begin;
select pg_temp.sign_in(:u_cora);
select pg_temp.assert_code(format($$select app.pathshala_quote(%L, %L, %L)$$, :t1, :h1, jsonb_build_array(jsonb_build_object('person_id', :p_nita, 'track_id', :tr_j, 'level_id', :lv_moms))),
  '22023', 'That learner is not a current member of the Shah household', 'quote: nor can staff price a person through a family they are not in');
rollback;
begin;
select pg_temp.sign_in(:u_riya);
select pg_temp.assert_code(format($$select app.pathshala_quote(%L, %L, %L)$$, :t1, :h1, :family),
  '42501', 'Only an adult of the family', 'quote: a child of the household cannot see what it costs (money is adults only)');
rollback;
begin;
select pg_temp.sign_in(:u_cora);
select pg_temp.assert((app.pathshala_quote(:t1, :h1, :family::jsonb) ->> 'total_cents')::int = 32500, 'quote: Pathshala staff with pathshala.view can price a family');
rollback;

-- ═════════════════════════════════════════════════════════════════════════════
-- Options, seats and the preview (§2.17)
-- ═════════════════════════════════════════════════════════════════════════════
begin;
select pg_temp.sign_in(:u_mira);
select app.pathshala_registration_options(:t1, null) as opt \gset
select app.pathshala_seats(:t1) as seats \gset
commit;
select pg_temp.assert((:'opt'::jsonb ->> 'can_register')::boolean and (:'opt'::jsonb ->> 'cannot_reason') is null
                      and (:'opt'::jsonb -> 'term' -> 'window' ->> 'state') = 'open' and (:'opt'::jsonb -> 'term' ->> 'payment_mode') = 'pledge'
                      and (:'opt'::jsonb -> 'term' ->> 'hold_hours')::int = 48 and (:'opt'::jsonb -> 'term' -> 'office_payment' ->> 'hold_days')::int = 7
                      and (:'opt'::jsonb -> 'term' ->> 'seat_rule') = 'automatic' and (:'opt'::jsonb -> 'term' ->> 'withdrawal_credit_until') = '2026-09-20'
                      and (:'opt'::jsonb -> 'term' ->> 'age_cutoff_on') = '2026-09-06' and (:'opt'::jsonb -> 'term' ->> 'membership_required')::boolean
                      and (:'opt'::jsonb -> 'term' -> 'waiver') = 'null'::jsonb
                      and (:'opt'::jsonb -> 'household' ->> 'id') = :h1 and (:'opt'::jsonb -> 'household' ->> 'membership') = 'active'
                      and jsonb_array_length(:'opt'::jsonb -> 'households') = 1,
  'options: the term (window, payment mode, hold, office payment, seat rule, deadlines, membership, no waiver yet) and the caller''s household (a member)');
select pg_temp.assert((select array_agg(x ->> 'first_name' order by o) from jsonb_array_elements(:'opt'::jsonb -> 'learners') with ordinality a(x, o))
                        = array['Riya', 'Dev', 'Anya', 'Isha', 'Mira', 'Kanta', 'Rahul']
                      and (select (x ->> 'age_on_cutoff')::int = 4 and (x ->> 'counts_as_child')::boolean and not (x ->> 'needs_birth_date')::boolean
                             from jsonb_array_elements(:'opt'::jsonb -> 'learners') x where x ->> 'first_name' = 'Anya')
                      and (select (x ->> 'is_me')::boolean and not (x ->> 'counts_as_child')::boolean
                             from jsonb_array_elements(:'opt'::jsonb -> 'learners') x where x ->> 'first_name' = 'Mira')
                      and (select (x ->> 'needs_birth_date')::boolean from jsonb_array_elements(:'opt'::jsonb -> 'learners') x where x ->> 'first_name' = 'Isha'),
  'options: everyone in the household with their age on the cut-off: children first (oldest first, no birth date last), then the adults, "Me" first');
select pg_temp.assert((select x -> 'suggested' from jsonb_array_elements(:'opt'::jsonb -> 'learners') x where x ->> 'first_name' = 'Dev')
                        = jsonb_build_array(jsonb_build_object('track_id', :tr_j, 'level_id', :lv_j2, 'reason', 'age'))
                      and (select x -> 'suggested' -> 0 ->> 'level_id' from jsonb_array_elements(:'opt'::jsonb -> 'learners') x where x ->> 'first_name' = 'Mira') in (:lv_dads, :lv_moms),
  'options: a level is suggested by age (Dev 9: Jainism 2; Mira 44: an adult class), the reason given');
select pg_temp.assert((select array_agg(x ->> 'name' order by x ->> 'name') from jsonb_array_elements(:'opt'::jsonb -> 'tracks') x) = array['Gujarati', 'Hindi', 'Jainism']
                      and (select array_agg((y ->> 'name') || ':' || (y ->> 'fee_cents') || ':' || (y ->> 'seats') || ':' || (y ->> 'band') order by o)
                             from jsonb_array_elements(:'opt'::jsonb -> 'tracks') x, jsonb_array_elements(x -> 'levels') with ordinality b(y, o)
                            where x ->> 'name' = 'Jainism')
                          = array['Toddler:4500:open:children', 'Jainism 2:13000:open:children', 'Jainism 3:13000:full:children', 'Jainism 5:13000:open:children',
                                  'Adult class (Dads):5000:open:adult', 'Adult class (Moms):5000:open:adult'],
  'options: the offered levels per track with their fee and seats (Jainism 3 has no room and no waitlist: full)');
select pg_temp.assert((select (x ->> 'seats') is null and (x ->> 'free') is null from jsonb_array_elements(:'seats'::jsonb) x where x ->> 'level' = 'Toddler') is not true
                      and (select (x ->> 'seats')::int = 15 and (x ->> 'taken')::int = 0 and (x ->> 'free')::int = 15 and (x ->> 'state') = 'open'
                             from jsonb_array_elements(:'seats'::jsonb) x where x ->> 'level' = 'Jainism 2')
                      and (select (x ->> 'state') = 'full' and not (x ->> 'waitlist_on')::boolean from jsonb_array_elements(:'seats'::jsonb) x where x ->> 'level' = 'Jainism 3'),
  'seats: per level the seats, taken, free and state, for members (counts only)');
begin;
select pg_temp.sign_in(:u_riya);
select app.pathshala_registration_options(:t1, :h1) as opt_kid \gset
rollback;
select pg_temp.assert(not (:'opt_kid'::jsonb ->> 'can_register')::boolean
                      and (:'opt_kid'::jsonb ->> 'cannot_reason') = 'Ask a parent or guardian in your family to register you.',
  'options: a child sees "Ask a parent or guardian in your family to register you."');
select pg_temp.assert((select bool_and(y -> 'fee_cents' = 'null'::jsonb) from jsonb_array_elements(:'opt_kid'::jsonb -> 'tracks') x, jsonb_array_elements(x -> 'levels') y)
                      and (:'opt_kid'::jsonb -> 'term' -> 'sibling_discount_pct') = 'null'::jsonb and (:'opt_kid'::jsonb -> 'term' -> 'family_cap_cents') = 'null'::jsonb
                      and (:'opt_kid'::jsonb -> 'term' -> 'window' -> 'late_fee_cents') = 'null'::jsonb
                      and jsonb_array_length(:'opt_kid'::jsonb -> 'tracks') > 0,
  'options: a child sees the levels but no fee, discount, cap or late fee (P30)');
begin;
select pg_temp.sign_in(:u_nita);
select pg_temp.assert_code(format($$select app.pathshala_registration_options(%L, %L)$$, :t1, :h1),
  '42501', 'Only an adult of the family', 'options: another family cannot read this family''s options');
rollback;

-- The preview: outcomes, the same money, nothing written.
select count(*) as audit_before2 from app.audit_log \gset
begin;
select pg_temp.sign_in(:u_mira);
select app.preview_pathshala_registration(:t1, :h1, :family::jsonb) as pv \gset
select app.preview_pathshala_registration(:t1, :h1, jsonb_build_array(
  jsonb_build_object('person_id', :p_dev, 'track_id', :tr_g, 'level_id', null),
  jsonb_build_object('new_child', jsonb_build_object('first_name', 'Tara', 'last_name', 'Shah', 'date_of_birth', '2020-06-01'), 'track_id', :tr_j, 'level_id', :lv_tod),
  jsonb_build_object('person_id', :p_anya, 'track_id', :tr_j, 'level_id', :lv_j2))) as pv2 \gset
select pg_temp.assert_code(format($$select app.preview_pathshala_registration(%L, %L, %L)$$, :t1, :h1,
  jsonb_build_array(jsonb_build_object('person_id', :p_dev, 'track_id', :tr_j, 'level_id', :lv_moms))),
  '22023', 'Adult class (Moms) is for adults, and Dev is 9.', 'preview: a child cannot take an adult class');
select pg_temp.assert_code(format($$select app.preview_pathshala_registration(%L, %L, %L)$$, :t1, :h1,
  jsonb_build_array(jsonb_build_object('person_id', :p_mira, 'track_id', :tr_j, 'level_id', :lv_j2))),
  '22023', 'Jainism 2 is a children''s class, and Mira is an adult.', 'preview: an adult cannot take a children''s level');
select pg_temp.assert_code(format($$select app.preview_pathshala_registration(%L, %L, %L)$$, :t1, :h1,
  jsonb_build_array(jsonb_build_object('person_id', :p_dev, 'track_id', :tr_j, 'level_id', :lv_j3))),
  '22023', 'Jainism 3 is full and has no waitlist. Ask the Pathshala office.', 'preview: a full level with no waitlist is refused with the plain sentence');
select pg_temp.assert_code(format($$select app.preview_pathshala_registration(%L, %L, %L)$$, :t1, :h1,
  jsonb_build_array(jsonb_build_object('person_id', :p_kiran, 'track_id', :tr_j, 'level_id', :lv_j2))),
  '22023', 'That learner is not a current member of the Shah household', 'preview: only current members of the household can be registered');
select pg_temp.assert_code(format($$select app.preview_pathshala_registration(%L, %L, %L)$$, :t1, :h1,
  jsonb_build_array(jsonb_build_object('person_id', :p_dev, 'track_id', :tr_j, 'level_id', :lv_j2), jsonb_build_object('person_id', :p_dev, 'track_id', :tr_j, 'level_id', :lv_j5))),
  '22023', 'Dev is listed twice for Jainism.', 'preview: one enrollment per learner per track (P10)');
select pg_temp.assert_code(format($$select app.preview_pathshala_registration(%L, %L, %L)$$, :t1, :h1,
  jsonb_build_array(jsonb_build_object('person_id', :p_dev, 'level_id', :lv_j2))),
  '22023', 'Choose a track', 'preview: the track is required (even for "not sure")');
commit;
select pg_temp.assert((select array_agg(x ->> 'outcome' order by o) from jsonb_array_elements(:'pv'::jsonb -> 'lines') with ordinality a(x, o)) = array['seat', 'seat', 'seat', 'seat']
                      and (:'pv'::jsonb ->> 'total_cents')::int = 32500 and (:'pv'::jsonb ->> 'due_now_cents')::int = 32500
                      and (:'pv'::jsonb -> 'pay') = 'null'::jsonb and (:'pv'::jsonb -> 'registration_id') = 'null'::jsonb
                      and not (:'pv'::jsonb -> 'lines' -> 0 ? 'enrollment_id') and not (:'pv'::jsonb -> 'lines' -> 0 ? 'pledge'),
  'preview: four seats, $325.00 added to pledges when registering (pledge mode: no pay object), no enrollment or pledge in a preview');
select pg_temp.assert((select array_agg(x ->> 'outcome' order by o) from jsonb_array_elements(:'pv2'::jsonb -> 'lines') with ordinality a(x, o)) = array['office', 'pending_child', 'office']
                      and (:'pv2'::jsonb -> 'lines' -> 0 ->> 'priced')::boolean is false
                      and (:'pv2'::jsonb -> 'pending' -> 0 ->> 'first_name') = 'Tara',
  'preview: "not sure" waits for the office (priced when placed), a child not yet on the family is pending, a child outside the band waits for the office (P24, P25)');
-- A new child in two tracks is one child (review C9): name plus birth date, any case and spacing.
begin;
select pg_temp.sign_in(:u_mira);
select app.preview_pathshala_registration(:t1, :h1, jsonb_build_array(
  jsonb_build_object('new_child', jsonb_build_object('first_name', 'Ravi', 'last_name', 'Shah', 'date_of_birth', '2017-03-03'), 'track_id', :tr_j, 'level_id', :lv_j2),
  jsonb_build_object('new_child', jsonb_build_object('first_name', ' ravi ', 'last_name', 'SHAH', 'date_of_birth', '2017-03-03'), 'track_id', :tr_g, 'level_id', :lv_g3))) as pv_ravi \gset
select pg_temp.assert_code(format($$select app.preview_pathshala_registration(%L, %L, %L)$$, :t1, :h1, jsonb_build_array(
  jsonb_build_object('new_child', jsonb_build_object('first_name', 'Ravi', 'last_name', 'Shah', 'date_of_birth', '2017-03-03'), 'track_id', :tr_j, 'level_id', :lv_j2),
  jsonb_build_object('new_child', jsonb_build_object('first_name', 'Ravi', 'last_name', 'Shah', 'date_of_birth', '2017-03-03'), 'track_id', :tr_j, 'level_id', :lv_j5))),
  '22023', 'Ravi is listed twice for Jainism.', 'preview: a new child is one learner per track too');
commit;
select pg_temp.assert((select array_agg((x ->> 'outcome') || '/' || (x ->> 'family_rank') || '/' || (x ->> 'total_cents') order by o)
                         from jsonb_array_elements(:'pv_ravi'::jsonb -> 'lines') with ordinality a(x, o)) = array['pending_child/1/13000', 'pending_child/1/13000']
                      and jsonb_array_length(:'pv_ravi'::jsonb -> 'pending') = 2,
  'preview: Ravi, a new child in Jainism 2 and Gujarati 3, is one child (first in both tracks: $130.00 + $130.00), pending in each track');
select pg_temp.assert((select count(*) from app.audit_log) = :audit_before2::bigint, 'preview: the preview writes nothing');
-- A learner withdrawn with the old Withdraw button keeps an open fee pledge: registering them again is refused until the
-- office settles it (review B3); with the pledge cancelled the withdrawn enrollment is reused.
insert into app.pathshala_enrollments (id, center_id, term_id, student_person_id, household_id, requested_level_id, status)
values ('75000000-0000-4000-8000-000000000ee4', :c, :t1, :p_dev, :h1, :lv_j2, 'withdrawn');
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, source, source_ref_id, amount_cents, status)
values ('75000000-0000-4000-8000-000000000ab4', :c, :h1, :p_mira, 'pathshala_fee', '75000000-0000-4000-8000-000000000ee4', 13000, 'open');
begin;
select pg_temp.sign_in(:u_mira);
select pg_temp.assert_code(format($$select app.preview_pathshala_registration(%L, %L, %L)$$, :t1, :h1,
  jsonb_build_array(jsonb_build_object('person_id', :p_dev, 'track_id', :tr_j, 'level_id', :lv_j2))),
  '22023', 'Dev still has a Pathshala fee for Jainism in 2026-27 from an earlier registration. Ask the Pathshala office.',
  'preview: a withdrawn learner whose fee pledge is still open is not registered again (no second fee on one enrollment)');
rollback;
update app.pledges set status = 'cancelled' where id = '75000000-0000-4000-8000-000000000ab4';
begin;
select pg_temp.sign_in(:u_mira);
select app.preview_pathshala_registration(:t1, :h1, jsonb_build_array(jsonb_build_object('person_id', :p_dev, 'track_id', :tr_j, 'level_id', :lv_j2))) as pv_dev_again \gset
rollback;
select pg_temp.assert((:'pv_dev_again'::jsonb -> 'lines' -> 0 ->> 'outcome') = 'seat',
  'preview: once that pledge is cancelled, Dev can be registered again (the withdrawn enrollment is reused)');
delete from app.pledges where id = '75000000-0000-4000-8000-000000000ab4';
delete from app.pathshala_enrollments where id = '75000000-0000-4000-8000-000000000ee4';
-- A family that is not a member waits for its membership (P6).
begin;
select pg_temp.sign_in(:u_nita);
select app.preview_pathshala_registration(:t1, :h2, jsonb_build_array(jsonb_build_object('person_id', :p_kiran, 'track_id', :tr_j, 'level_id', :lv_j2))) as pv3 \gset
select app.pathshala_registration_options(:t1, :h2) as opt_nita \gset
commit;
select pg_temp.assert((:'pv3'::jsonb -> 'lines' -> 0 ->> 'outcome') = 'membership_hold' and (:'opt_nita'::jsonb -> 'household' ->> 'membership') = 'none',
  'preview: a household with no yearly or life membership waits for it (membership_hold)');
-- Another adult learner must agree to the published waiver in their own app first (P14).
insert into app.legal_documents (center_id, kind, version, title, body_md, published_at) values (:c, 'pathshala_waiver', '2026.1', 'Pathshala waiver', 'I agree.', now());
begin;
select pg_temp.sign_in(:u_mira);
select app.preview_pathshala_registration(:t1, :h1, jsonb_build_array(jsonb_build_object('person_id', :p_rahul, 'track_id', :tr_j, 'level_id', :lv_dads),
                                                                      jsonb_build_object('person_id', :p_mira, 'track_id', :tr_j, 'level_id', :lv_moms))) as pv4 \gset
select app.pathshala_registration_options(:t1, :h1) as opt_waiver \gset
commit;
select pg_temp.assert((select array_agg(x ->> 'outcome' order by o) from jsonb_array_elements(:'pv4'::jsonb -> 'lines') with ordinality a(x, o)) = array['waiver_hold', 'seat']
                      and (:'opt_waiver'::jsonb -> 'term' -> 'waiver' ->> 'title') = 'Pathshala waiver'
                      and (:'opt_waiver'::jsonb -> 'term' -> 'waiver' ->> 'version') = '2026.1',
  'preview: the published waiver is offered; another adult learner (Rahul) waits for his own agreement, the registering adult does not');

-- ═════════════════════════════════════════════════════════════════════════════
-- The 'pathshala' checkout context (F17)
-- ═════════════════════════════════════════════════════════════════════════════
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, source, amount_cents, status)
values ('75000000-0000-4000-8000-000000000ab1', :c, :h1, :p_mira, 'pathshala_fee', 13000, 'open');
begin;
select pg_temp.sign_in(:u_mira);
select app.create_checkout(:c, :h1, 13000, array['75000000-0000-4000-8000-000000000ab1']::uuid[], null, 'pathshala', 'Pathshala fee 2026-27 · Riya') as ck \gset
commit;
select pg_temp.assert((select context = 'pathshala' and for_label = 'Pathshala fee 2026-27 · Riya' and pledge_ids = array['75000000-0000-4000-8000-000000000ab1']::uuid[]
                         from app.payment_checkouts where id = (:'ck'::jsonb ->> 'checkout_id')::uuid),
  'checkout: create_checkout accepts the pathshala context, labelled "Pathshala fee 2026-27 · Riya"');
select pg_temp.assert(app.pathshala_fee_label('2026-27', array['Riya', 'Dev', 'Anya', 'Mira']) = 'Pathshala fee 2026-27 · Riya, Dev, Anya, Mira',
  'checkout: the fee label names the term and the learners');

-- ═════════════════════════════════════════════════════════════════════════════
-- Access: who reads what
-- ═════════════════════════════════════════════════════════════════════════════
insert into app.pathshala_enrollments (id, center_id, term_id, student_person_id, household_id, requested_level_id, status)
values ('75000000-0000-4000-8000-000000000ee3', :c, :t1, :p_dev, :h1, :lv_j2, 'requested');
insert into app.pathshala_enrollment_fees (center_id, enrollment_id, term_id, household_id, level_id, learner_kind, family_rank, base_fee_cents,
                                           sibling_discount_cents, total_cents, assistance_requested)
values (:c, '75000000-0000-4000-8000-000000000ee3', :t1, :h1, :lv_j2, 'child', 2, 13000, 1300, 11700, true);
insert into app.pathshala_assistance_notes (enrollment_id, center_id, assistance_note)
values ('75000000-0000-4000-8000-000000000ee3', :c, 'We lost a job this year.');
begin;
select pg_temp.sign_in(:u_mira);
select pg_temp.assert((select count(*) from app.pathshala_enrollment_fees where household_id = :h1) = 1
                      and (select count(*) from app.pathshala_level_fees where term_id = :t1) = 10
                      and (select count(*) from app.pathshala_level_fees where term_id = :t2) = 0
                      and (select count(*) from app.pathshala_assistance_notes) = 0,
  'access: a household adult reads the family''s fee lines and the open term''s level fees (not a draft term''s), but not the assistance note');
rollback;
begin;
select pg_temp.sign_in(:u_riya);
select pg_temp.assert((select count(*) from app.pathshala_enrollment_fees) = 0 and (select count(*) from app.pathshala_level_fees) = 0
                      and (select count(*) from app.pathshala_assistance_notes) = 0,
  'access: a child never reads the family''s fees, the level fees or the assistance note (P30)');
rollback;
begin;
select pg_temp.sign_in(:u_nita);
select pg_temp.assert((select count(*) from app.pathshala_enrollment_fees) = 0, 'access: another family reads nothing of them');
rollback;
begin;
select pg_temp.sign_in(:u_cora);
select pg_temp.assert((select count(*) from app.pathshala_enrollment_fees) = 0 and (select count(*) from app.pathshala_level_fees where term_id = :t2) = 1
                      and (select count(*) from app.pathshala_assistance_notes) = 0,
  'access: the committee (pathshala.view) reads level fees, even a draft term''s, but no family''s fee lines and no assistance note');
rollback;
begin;
select pg_temp.sign_in(:u_tara);
select pg_temp.assert((select count(*) from app.pathshala_enrollment_fees where household_id = :h1) = 1
                      and (select assistance_note from app.pathshala_assistance_notes where enrollment_id = '75000000-0000-4000-8000-000000000ee3') = 'We lost a job this year.',
  'access: the treasurer (giving.manage) reads the fee lines and the assistance note');
rollback;
begin;
select pg_temp.sign_in(:u_pia);
select pg_temp.assert((select count(*) from app.pathshala_assistance_notes) = 1, 'access: the principal reads the assistance note');
rollback;
select pg_temp.assert((select after ->> 'assistance_note' from app.audit_log where record_table = 'pathshala_assistance_notes' and action = 'pathshala_assistance_notes.insert'
                        order by id desc limit 1) = '*** (24 characters)',
  'audit: the private fee-assistance note is masked in the audit log');
select pg_temp.assert(app.audit_mask(jsonb_build_object('bucket_id', 'homework', 'name',
                        '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/riya-navkar.m4a')) ->> 'name'
                        = '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/***'
                      and app.audit_mask(jsonb_build_object('bucket', 'homework', 'name',
                        '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/a.pdf')) ->> 'name' like '%/***'
                      and app.audit_mask(jsonb_build_object('bucket_id', 'flyers', 'name', 'a/b/c/d.png')) ->> 'name' = 'a/b/c/d.png'
                      and app.audit_mask('{"assistance_note":"We lost a job this year."}'::jsonb) ->> 'assistance_note' = '*** (24 characters)',
  'audit: 0590''s audit_mask carries 0589''s clause verbatim (a homework file''s name is masked, other buckets are not) next to the assistance note');

-- ═════════════════════════════════════════════════════════════════════════════
-- Module switches
-- ═════════════════════════════════════════════════════════════════════════════
begin;
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c, 'pathshala', false, 'test');
select pg_temp.sign_in(:u_mira);
select pg_temp.assert_code(format($$select app.pathshala_quote(%L, %L, %L)$$, :t1, :h1, :family),
  '42501', 'The Pathshala module is switched off for this community.', 'module: with Pathshala off the quote refuses');
select pg_temp.assert_code(format($$select app.pathshala_registration_options(%L, %L)$$, :t1, :h1),
  '42501', 'The Pathshala module is switched off', 'module: and the options');
select pg_temp.assert((select count(*) from app.pathshala_level_fees where center_id = :c) = 0, 'module: and the level fees are hidden');
rollback;

-- ═════════════════════════════════════════════════════════════════════════════
-- The functions
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert((select count(*) = 10 and bool_and(p.prosecdef and exists (select 1 from unnest(p.proconfig) as g(setting)
                                                                                  where g.setting ~ '^search_path=app, *public, *extensions$')
                                         and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute'))
                         from pg_proc p where p.pronamespace = 'app'::regnamespace
                          and p.proname in ('save_pathshala_level', 'set_pathshala_level_fees', 'set_pathshala_term_rules', 'open_pathshala_registration',
                                            'pathshala_quote', 'pathshala_fee_example', 'pathshala_registration_options',
                                            'preview_pathshala_registration', 'pathshala_seats', 'pathshala_pay_now_ready')),
  'functions: every RPC is security definer with the hosted search path, callable when signed in and never anonymously');
select pg_temp.assert(not has_function_privilege('authenticated', 'app._pathshala_price(uuid,uuid,jsonb,boolean,boolean)', 'execute')
                      and not has_function_privilege('authenticated', 'app._pathshala_plan(uuid,uuid,jsonb,text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.pathshala_counts_as_child(uuid,date)', 'execute')
                      and not has_function_privilege('authenticated', 'app.pathshala_suggestions(uuid,uuid)', 'execute'),
  'functions: the internal helpers are not callable over the API');
select pg_temp.assert((select bool_and(exists (select 1 from unnest(p.proconfig) as g(setting) where g.setting ~ '^search_path=app, *public, *extensions$'))
                         from pg_proc p where p.pronamespace = 'app'::regnamespace and (p.proname like '%pathshala%' and p.proname not in ('pathshala_term_stats'))),
  'functions: every Pathshala function pins search_path = app, public, extensions');

-- ═════════════════════════════════════════════════════════════════════════════
-- A term opened while Pledges & donations is off (review C6): no campaign or fund yet; the billing function (0591) finds
-- or creates them later with the same helper
-- ═════════════════════════════════════════════════════════════════════════════
\set t3 '''75000000-0000-4000-8000-0000000000f3'''
insert into app.pathshala_terms (id, center_id, name, starts_on, ends_on) values (:t3, :c, 'Giving-off term', '2031-09-07', '2032-05-30');
insert into app.pathshala_classes (id, center_id, term_id, level_id, name, room, capacity, meets_on, starts_time, ends_time)
values ('75000000-0000-4000-8000-000000000c31', :c, :t3, :lv_j1, 'Jainism 1 · giving off', 'A', 10, 'sunday', '10:00', '11:30');
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c, 'giving', false, 'test');
begin;
select pg_temp.sign_in(:u_pia);
select app.set_pathshala_level_fees(:t3, jsonb_build_array(jsonb_build_object('level_id', :lv_j1, 'fee_cents', 9000))) as f_off \gset
select app.open_pathshala_registration(:t3) as opened_off \gset
commit;
select pg_temp.assert((:'opened_off'::jsonb -> 'campaign_id') = 'null'::jsonb and (:'opened_off'::jsonb -> 'fund_id') = 'null'::jsonb
                      and (select campaign_id is null and fund_id is null and fees_locked_at is not null and status = 'registration' from app.pathshala_terms where id = :t3),
  'money: with Pledges & donations off registration opens, locked, with no campaign or fund');
select pg_temp.assert(app._pathshala_fees_money(:t3, null, false) = jsonb_build_object('campaign_id', null, 'fund_id', null),
  'money: and the helper finds none while Giving is off');
delete from app.center_modules where center_id = :c and module_key = 'giving';
select app._pathshala_fees_money(:t3, 'Billing the first Pathshala fee', false) as money_on \gset
select app._pathshala_fees_money(:t3, null, false) as money_again \gset
select pg_temp.assert((:'money_on'::jsonb ->> 'fund_id') = :fund_p
                      and exists (select 1 from app.campaigns c where c.id = (:'money_on'::jsonb ->> 'campaign_id')::uuid and c.name = 'Pathshala fees Giving-off term'
                                    and c.kind = 'pathshala' and c.status = 'closed' and c.fund_id = :fund_p)
                      and (:'money_again'::jsonb ->> 'campaign_id') = (:'money_on'::jsonb ->> 'campaign_id'),
  'money: with Giving back on the helper finds the Pathshala fund by its key and creates the closed campaign once (a second call reuses it)');
update app.funds set active = false where id = :fund_p;
select pg_temp.assert(app._pathshala_fees_money(:t3, null, false) ->> 'fund_id' is null,
  'money: with no fund the billing side gets none (the line is then left "not billed" with a note)');
select pg_temp.assert_code(format($$select app._pathshala_fees_money(%L, null, true)$$, :t3),
  '22023', 'There is no fund for the Pathshala fees yet.', 'money: opening refuses the same case in plain English');
update app.funds set active = true where id = :fund_p;
delete from app.campaigns where center_id = :c and name = 'Pathshala fees Giving-off term';
delete from app.pathshala_classes where term_id = :t3;
delete from app.pathshala_level_fees where term_id = :t3;
delete from app.pathshala_terms where id = :t3;

-- Leave the shared database tidy for the tests that follow.
delete from app.pathshala_enrollment_fees where center_id = :c;
