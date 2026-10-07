-- 0565: a parent can only ask for a Pathshala place for a current member of their own household; the class, the
-- placement, the fee pledge, the waiver, who registered and when are not theirs to set; the term must be open and the
-- term and level must belong to the same community. The member app's own insert (connect-mobile requestEnrollment),
-- with or without a level, still works, and staff placement is unchanged.
-- Each refusal is built on a base request that is shown to be allowed, so a case can only fail for its own reason.
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
create or replace function pg_temp.sign_in(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
\set c1 '''56000000-0000-4000-8000-0000000000c1'''
\set c2 '''56000000-0000-4000-8000-0000000000c2'''
\set mom '''56000000-0000-4000-8000-000000000001'''
\set kid_user '''56000000-0000-4000-8000-000000000002'''
\set other_user '''56000000-0000-4000-8000-000000000003'''
\set principal '''56000000-0000-4000-8000-000000000004'''
\set p_mom '''56000000-0000-4000-8000-0000000000a1'''
\set p_kid '''56000000-0000-4000-8000-0000000000a2'''
\set p_left '''56000000-0000-4000-8000-0000000000a3'''
\set p_other_kid '''56000000-0000-4000-8000-0000000000a4'''
\set p_other_mom '''56000000-0000-4000-8000-0000000000a5'''
\set p_kid2 '''56000000-0000-4000-8000-0000000000a6'''
\set p_mom_c2 '''56000000-0000-4000-8000-0000000000a7'''
\set p_h3_kid '''56000000-0000-4000-8000-0000000000a8'''
\set h1 '''56000000-0000-4000-8000-0000000000b1'''
\set h2 '''56000000-0000-4000-8000-0000000000b2'''
\set h3 '''56000000-0000-4000-8000-0000000000b3'''
\set tr1 '''56000000-0000-4000-8000-0000000000d1'''
\set tr2 '''56000000-0000-4000-8000-0000000000d2'''
\set lv1 '''56000000-0000-4000-8000-0000000000e1'''
\set lv2 '''56000000-0000-4000-8000-0000000000e2'''
\set t1 '''56000000-0000-4000-8000-0000000000f1'''
\set t2 '''56000000-0000-4000-8000-0000000000f2'''
\set t_draft '''56000000-0000-4000-8000-0000000000f3'''
\set t_closed '''56000000-0000-4000-8000-0000000000f4'''
\set cls '''56000000-0000-4000-8000-000000000c01'''

insert into auth.users (id, email) values (:mom, 'mom56@example.com'), (:kid_user, 'kid56@example.com'), (:other_user, 'other56@example.com'), (:principal, 'principal56@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, environment) values
  (:c1, 'orbit56', 'Orbit 56 Community', 'O56', 'TX', 'active', 'production'),
  (:c2, 'orbit56b', 'Other 56 Community', 'O56B', 'TX', 'active', 'production');
insert into app.households (id, center_id, display_name) values
  (:h1, :c1, 'Shah household 56'), (:h2, :c1, 'Mehta household 56'), (:h3, :c1, 'Shah grandparents 56');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (:p_mom, :c1, 'Mira', 'Shah', date '1980-01-01'),
  (:p_kid, :c1, 'Anya', 'Shah', (current_date - interval '9 years')::date),
  (:p_left, :c1, 'Ravi', 'Shah', (current_date - interval '11 years')::date),
  (:p_other_kid, :c1, 'Dev', 'Mehta', (current_date - interval '8 years')::date),
  (:p_other_mom, :c1, 'Nita', 'Mehta', date '1982-02-02'),
  (:p_kid2, :c1, 'Isha', 'Shah', (current_date - interval '7 years')::date),
  (:p_h3_kid, :c1, 'Kiran', 'Shah', (current_date - interval '10 years')::date),
  (:p_mom_c2, :c2, 'Mira', 'Shah', date '1980-01-01');
insert into app.household_members (household_id, person_id, center_id, role, left_at) values
  (:h1, :p_mom, :c1, 'primary', null), (:h1, :p_kid, :c1, 'child', null), (:h1, :p_kid2, :c1, 'child', null),
  (:h1, :p_left, :c1, 'child', date '2026-01-01'),
  (:h2, :p_other_mom, :c1, 'primary', null), (:h2, :p_other_kid, :c1, 'child', null),
  (:h3, :p_mom, :c1, 'other', null), (:h3, :p_h3_kid, :c1, 'child', null);
-- Mom also belongs to a second community (c2), so its open term is visible to her and only the community check refuses it.
insert into app.center_users (center_id, user_id, person_id) values
  (:c1, :mom, :p_mom), (:c1, :kid_user, :p_kid), (:c1, :other_user, :p_other_mom), (:c2, :mom, :p_mom_c2);
insert into app.pathshala_tracks (id, center_id, key, name) values (:tr1, :c1, 'jainism', 'Jainism'), (:tr2, :c2, 'jainism', 'Jainism');
insert into app.pathshala_levels (id, center_id, track_id, key, name, sort_order) values (:lv1, :c1, :tr1, '1', 'Level 1', 1), (:lv2, :c2, :tr2, '1', 'Level 1', 1);
insert into app.pathshala_terms (id, center_id, name, starts_on, ends_on, status) values
  (:t1, :c1, '2026-2027', date '2026-09-01', date '2027-05-31', 'registration'),
  (:t2, :c2, '2026-2027', date '2026-09-01', date '2027-05-31', 'registration'),
  (:t_draft, :c1, '2027-2028', date '2027-09-01', date '2028-05-31', 'draft'),
  (:t_closed, :c1, '2025-2026', date '2025-09-01', date '2026-05-31', 'closed');
insert into app.pathshala_classes (id, center_id, term_id, level_id, name) values (:cls, :c1, :t1, :lv1, 'Jainism 1 - Room A');
insert into app.role_grants (center_id, user_id, role_key) values (:c1, :principal, 'pathshala_principal');

-- The member app's insert, as it is sent today (connect-mobile src/lib/api/gyan.ts requestEnrollment); `extra` adds one
-- column the app never sends, as 'column=<SQL literal>'.
create or replace function pg_temp.ask(p_user uuid, p_term uuid, p_household uuid, p_student uuid, p_level uuid, extra text default '') returns text
language plpgsql as $$
begin
  return format('insert into app.pathshala_enrollments (center_id, term_id, household_id, student_person_id, requested_level_id, status, registered_by, notes%s) values (%L, %L, %L, %L, %L, %L, %L, %L%s)',
                case when extra = '' then '' else ', ' || split_part(extra, '=', 1) end,
                '56000000-0000-4000-8000-0000000000c1', p_term, p_household, p_student, p_level, 'requested', p_user, 'Please place with her cousin',
                case when extra = '' then '' else ', ' || substr(extra, position('=' in extra) + 1) end);
end $$;

-- ── A parent asks for their own children (unchanged) ───────────────────────
begin;
select pg_temp.sign_in(:mom);
select pg_temp.ask(:mom, :t1, :h1, :p_kid, :lv1) \gexec
select pg_temp.ask(:mom, :t1, :h1, :p_kid2, null) \gexec
select pg_temp.assert((select count(*) from app.pathshala_enrollments where student_person_id = :p_kid and term_id = :t1 and status = 'requested'
                         and registered_by = :mom and requested_level_id = :lv1) = 1,
  'a parent asks for a place for their own child, exactly as the member app sends it');
select pg_temp.assert((select requested_level_id is null from app.pathshala_enrollments where student_person_id = :p_kid2 and term_id = :t1),
  'a parent can ask without choosing a level');
commit;

-- ── What a parent can no longer do (each built on an allowed base request) ─
begin;
select pg_temp.sign_in(:mom);
select pg_temp.assert_raises(pg_temp.ask(:mom, :t1, :h1, :p_other_kid, :lv1), 'row-level security',
  'a parent cannot name a child of another household under their own household');
select pg_temp.assert_raises(pg_temp.ask(:mom, :t1, :h2, :p_other_kid, :lv1), 'row-level security',
  'a parent cannot ask under a household they are not an adult of');
select pg_temp.assert_raises(pg_temp.ask(:mom, :t1, :h1, :p_h3_kid, :lv1), 'row-level security',
  'a child of my other household cannot be filed under this one');
select pg_temp.assert_raises(pg_temp.ask(:mom, :t1, :h1, :p_left, :lv1), 'row-level security',
  'a child who has left the household cannot be enrolled by it');
select pg_temp.assert_raises(pg_temp.ask(:mom, :t1, :h1, :p_mom, :lv1, 'fee_pledge_id=' || quote_literal(gen_random_uuid()::text)), 'row-level security',
  'a parent cannot attach a fee pledge');
select pg_temp.assert_raises(pg_temp.ask(:mom, :t1, :h1, :p_mom, :lv1, 'waiver_consent_id=' || quote_literal(gen_random_uuid()::text)), 'row-level security',
  'a parent cannot attach a waiver consent');
select pg_temp.assert_raises(pg_temp.ask(:mom, :t1, :h1, :p_mom, :lv1, 'class_id=' || quote_literal(gen_random_uuid()::text)), 'row-level security',
  'a parent cannot choose a class');
select pg_temp.assert_raises(pg_temp.ask(:mom, :t1, :h1, :p_mom, :lv1, 'placed_at=' || quote_literal(now()::text)), 'row-level security',
  'a parent cannot set a placement time');
select pg_temp.assert_raises(pg_temp.ask(:other_user, :t1, :h1, :p_mom, :lv1), 'row-level security',
  'registered_by must be the person asking');
select pg_temp.assert_raises(pg_temp.ask(:mom, :t1, :h1, :p_mom, :lv1, 'registered_at=' || quote_literal((now() - interval '2 days')::text)), 'row-level security',
  'the registration time cannot be back-dated');
select pg_temp.assert_raises(pg_temp.ask(:mom, :t1, :h1, :p_mom, :lv1, 'registered_at=' || quote_literal((now() - interval '30 minutes')::text)), 'row-level security',
  'the registration time cannot be back-dated even a little (it is the time of the request)');
select pg_temp.assert_raises(pg_temp.ask(:mom, :t2, :h1, :p_mom, :lv1), 'row-level security',
  'an open term of another community (one she also belongs to) cannot be used');
select pg_temp.assert_raises(pg_temp.ask(:mom, :t1, :h1, :p_mom, :lv2), 'row-level security',
  'a level of another community cannot be requested');
select pg_temp.assert_raises(pg_temp.ask(:mom, :t_draft, :h1, :p_mom, :lv1), 'row-level security',
  'a draft term cannot be used');
select pg_temp.assert_raises(pg_temp.ask(:mom, :t_closed, :h1, :p_mom, :lv1), 'row-level security',
  'a closed term cannot be used');
select pg_temp.assert_raises(replace(pg_temp.ask(:mom, :t1, :h1, :p_mom, :lv1), '''requested''', '''placed'''), 'row-level security',
  'a parent cannot place a child themselves');
-- the base request every refusal above changes one thing of is itself allowed
select pg_temp.ask(:mom, :t1, :h1, :p_mom, :lv1) \gexec
select pg_temp.assert(exists (select 1 from app.pathshala_enrollments where student_person_id = :p_mom and term_id = :t1),
  'the base request used by the refusal cases is itself allowed');
-- and the same child of the other household is allowed under the household she really belongs to
select pg_temp.ask(:mom, :t1, :h3, :p_h3_kid, :lv1) \gexec
select pg_temp.assert(exists (select 1 from app.pathshala_enrollments where student_person_id = :p_h3_kid and household_id = :h3),
  'a child is enrolled under the household they belong to');
rollback;

-- ── Staff who can read every household still cannot ask under someone else's ──
begin;
insert into app.role_grants (center_id, user_id, role_key) values (:c1, :mom, 'membership_coordinator');
select pg_temp.sign_in(:mom);
select pg_temp.assert_raises(pg_temp.ask(:mom, :t1, :h2, :p_other_kid, :lv1), 'row-level security',
  'staff who can read every household still cannot ask under a household they are not an adult of');
rollback;

-- ── A child cannot ask (adults only, unchanged) ────────────────────────────
begin;
select pg_temp.sign_in(:kid_user);
select pg_temp.assert_raises(pg_temp.ask(:kid_user, :t1, :h1, :p_mom, :lv1), 'row-level security', 'a child cannot ask for a place');
rollback;

-- ── The office still places children (staff policy, unchanged) ─────────────
begin;
select pg_temp.sign_in(:principal);
insert into app.pathshala_enrollments (center_id, term_id, household_id, student_person_id, requested_level_id, class_id, status, placed_at, registered_by)
values (:c1, :t1, :h2, :p_other_kid, :lv1, :cls, 'placed', now(), :principal);
select pg_temp.assert((select status = 'placed' and class_id = :cls from app.pathshala_enrollments where student_person_id = :p_other_kid and term_id = :t1),
  'the Pathshala principal still places a child directly');
rollback;

select pg_temp.assert((select count(*) from app.pathshala_enrollments where center_id = :c1) = 2, 'only the two valid requests were stored');
