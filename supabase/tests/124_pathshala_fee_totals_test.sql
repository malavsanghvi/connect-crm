-- 0666: app.pathshala_fee_totals(term): the Pathshala fee totals as sums only (B90 Learning, decision D2).
--   A. The principal and the treasurer get the totals, in total and level by level, and a cancelled line is left out
--   B. The answer carries sums and counts only: no name, household, enrollment or learner id
--   C. Who may call it: the committee (pathshala.view only) and a parent are told "You don't have access to this area"; a stranger
--      from another community and a term that does not exist get "not found"; nobody signed in is refused
--   D. It runs with the caller's own rights (SECURITY INVOKER) and only signed-in people may execute it
-- Everything runs in one transaction that is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
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
-- The call is refused, in either of the two ways the database refuses: no access (42501) or not found (P0002, a draft term is
-- staff-only so a parent does not even see that it exists).
create or replace function pg_temp.assert_refused(stmt text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if sqlstate not in ('42501', 'P0002') then raise exception 'FAIL: % (got % "%")', label, sqlstate, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.claims(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', 'aal1',
    'amr', jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 60)))::text, true);
  perform set_config('request.headers', '', true);
end $$;
create or replace function pg_temp.no_claims() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;
create or replace function pg_temp.keys(j jsonb) returns text language sql as $$
  select coalesce(string_agg(k, ',' order by k collate "C"), '') from jsonb_object_keys(j) k
$$;

\set c '''124a0000-0000-4000-8000-0000000000c1'''
\set c2 '''124a0000-0000-4000-8000-0000000000c2'''
\set u_pia '''124a0000-0000-4000-8000-000000000001'''
\set u_tara '''124a0000-0000-4000-8000-000000000002'''
\set u_cora '''124a0000-0000-4000-8000-000000000003'''
\set u_mira '''124a0000-0000-4000-8000-000000000004'''
\set u_other '''124a0000-0000-4000-8000-000000000005'''
\set p_pia '''124a0000-0000-4000-8000-0000000000a1'''
\set p_tara '''124a0000-0000-4000-8000-0000000000a2'''
\set p_cora '''124a0000-0000-4000-8000-0000000000a3'''
\set p_mira '''124a0000-0000-4000-8000-0000000000a4'''
\set p_k1 '''124a0000-0000-4000-8000-0000000000b1'''
\set p_k2 '''124a0000-0000-4000-8000-0000000000b2'''
\set p_k3 '''124a0000-0000-4000-8000-0000000000b3'''
\set p_k4 '''124a0000-0000-4000-8000-0000000000b4'''
\set h1 '''124a0000-0000-4000-8000-0000000000d1'''
\set tr '''124a0000-0000-4000-8000-0000000000e1'''
\set lv1 '''124a0000-0000-4000-8000-0000000000e2'''
\set lv2 '''124a0000-0000-4000-8000-0000000000e3'''
\set t1 '''124a0000-0000-4000-8000-0000000000f1'''
\set t_empty '''124a0000-0000-4000-8000-0000000000f2'''
\set t_other '''124a0000-0000-4000-8000-0000000000f3'''
\set en1 '''124a0000-0000-4000-8000-000000000ee1'''
\set en2 '''124a0000-0000-4000-8000-000000000ee2'''
\set en3 '''124a0000-0000-4000-8000-000000000ee3'''
\set en4 '''124a0000-0000-4000-8000-000000000ee4'''

select pg_temp.no_claims();
insert into app.centers (id, slug, name, short_name, time_zone, environment) values
  (:c, 'p124-temple', 'P124 Jain Temple', 'P124', 'America/Chicago', 'production'),
  (:c2, 'p124-other', 'P124 Other Temple', 'P124B', 'America/Chicago', 'production');
insert into auth.users (id, email) values (:u_pia, 'pia@p124.test'), (:u_tara, 'tara@p124.test'), (:u_cora, 'cora@p124.test'),
  (:u_mira, 'mira@p124.test'), (:u_other, 'other@p124.test');
insert into app.people (id, center_id, first_name, last_name, date_of_birth, email) values
  (:p_pia, :c, 'Pia', 'Principal', '1975-05-05', 'pia@p124.test'), (:p_tara, :c, 'Tara', 'Treasurer', '1970-01-01', 'tara@p124.test'),
  (:p_cora, :c, 'Cora', 'Committee', '1966-06-06', 'cora@p124.test'), (:p_mira, :c, 'Mira', 'Shah', '1982-02-02', 'mira@p124.test'),
  (:p_k1, :c, 'Riya', 'Shah', '2014-03-10', null), (:p_k2, :c, 'Dev', 'Shah', '2017-01-15', null),
  (:p_k3, :c, 'Anya', 'Shah', '2019-05-01', null), (:p_k4, :c, 'Kiran', 'Shah', '2016-02-02', null);
insert into app.households (id, center_id, display_name) values (:h1, :c, 'Shah household');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :p_mira, :c, 'primary', true), (:h1, :p_k1, :c, 'child', false), (:h1, :p_k2, :c, 'child', false),
  (:h1, :p_k3, :c, 'child', false), (:h1, :p_k4, :c, 'child', false);
insert into app.center_users (center_id, user_id, person_id, is_default) values
  (:c, :u_pia, :p_pia, false), (:c, :u_tara, :p_tara, false), (:c, :u_cora, :p_cora, false), (:c, :u_mira, :p_mira, false);
insert into app.role_grants (center_id, user_id, role_key) values
  (:c, :u_pia, 'pathshala_principal'), (:c, :u_tara, 'treasurer'), (:c, :u_cora, 'pathshala_committee');
insert into app.pathshala_tracks (id, center_id, key, name) values (:tr, :c, 'jainism', 'Jainism');
insert into app.pathshala_levels (id, center_id, track_id, key, name, sort_order, min_age, max_age) values
  (:lv1, :c, :tr, '1', 'Jainism 1', 1, 5, 7), (:lv2, :c, :tr, '2', 'Jainism 2', 2, 8, 10);
insert into app.pathshala_terms (id, center_id, name, starts_on, ends_on, fee_per_child_cents) values
  (:t1, :c, '2026-27', '2026-09-06', '2027-05-30', 0), (:t_empty, :c, 'Empty term', '2027-09-05', '2028-05-28', 0),
  (:t_other, :c2, 'Other temple term', '2026-09-06', '2027-05-30', 0);

-- Four fee lines: Jainism 1 has one paid ($130) and one billed ($117, after a $13 sibling discount), a cancelled one ($130) that must
-- be left out; Jainism 2 has one quoted ($45).
insert into app.pathshala_enrollments (id, center_id, term_id, student_person_id, household_id, requested_level_id, status) values
  (:en1, :c, :t1, :p_k1, :h1, :lv1, 'requested'), (:en2, :c, :t1, :p_k2, :h1, :lv1, 'requested'),
  (:en3, :c, :t1, :p_k3, :h1, :lv2, 'requested'), (:en4, :c, :t1, :p_k4, :h1, :lv1, 'requested');
insert into app.pathshala_enrollment_fees (center_id, enrollment_id, term_id, household_id, level_id, learner_kind, family_rank, base_fee_cents,
                                           sibling_discount_cents, total_cents, status) values
  (:c, :en1, :t1, :h1, :lv1, 'child', 1, 13000, 0, 13000, 'paid'),
  (:c, :en2, :t1, :h1, :lv1, 'child', 2, 13000, 1300, 11700, 'billed'),
  (:c, :en3, :t1, :h1, :lv2, 'child', 3, 4500, 0, 4500, 'quoted'),
  (:c, :en4, :t1, :h1, :lv1, 'child', 4, 13000, 0, 13000, 'cancelled');

-- ── A. The totals ───────────────────────────────────────────────────────────────
set role authenticated;
select pg_temp.claims(:u_pia);
select app.pathshala_fee_totals(:t1) as principal_totals \gset
select pg_temp.claims(:u_tara);
select app.pathshala_fee_totals(:t1) as treasurer_totals \gset
select pg_temp.claims(:u_pia);
select app.pathshala_fee_totals(:t_empty) as empty_totals \gset
reset role;

select pg_temp.assert((:'principal_totals'::jsonb ->> 'term') = '2026-27' and (:'principal_totals'::jsonb ->> 'fee_lines')::int = 3,
  'A · the principal gets the term and three fee lines (the cancelled one is left out)');
select pg_temp.assert((:'principal_totals'::jsonb ->> 'total_cents')::bigint = 29200
                      and (:'principal_totals'::jsonb ->> 'base_cents')::bigint = 30500
                      and (:'principal_totals'::jsonb ->> 'sibling_discount_cents')::bigint = 1300,
  'A · the sums add up: $292.00 in all, from $305.00 of fees less a $13.00 sibling discount');
select pg_temp.assert((:'principal_totals'::jsonb ->> 'paid_cents')::bigint = 13000
                      and (:'principal_totals'::jsonb ->> 'billed_unpaid_cents')::bigint = 11700
                      and (:'principal_totals'::jsonb ->> 'not_billed_cents')::bigint = 4500,
  'A · paid, billed but unpaid, and not yet billed are separate sums');
select pg_temp.assert(jsonb_array_length(:'principal_totals'::jsonb -> 'by_level') = 2
                      and (select x ->> 'level' = 'Jainism 1' and (x ->> 'fee_lines')::int = 2 and (x ->> 'total_cents')::bigint = 24700 and (x ->> 'paid_cents')::bigint = 13000
                           from jsonb_array_elements(:'principal_totals'::jsonb -> 'by_level') x where x ->> 'level' = 'Jainism 1')
                      and (select (x ->> 'fee_lines')::int = 1 and (x ->> 'total_cents')::bigint = 4500 and (x ->> 'paid_cents')::bigint = 0
                           from jsonb_array_elements(:'principal_totals'::jsonb -> 'by_level') x where x ->> 'level' = 'Jainism 2'),
  'A · level by level: Jainism 1 has two lines ($247.00, $130.00 paid) and Jainism 2 one ($45.00)');
select pg_temp.assert(:'treasurer_totals'::jsonb = :'principal_totals'::jsonb,
  'A · the treasurer (giving.manage) gets exactly the same totals');
select pg_temp.assert((:'empty_totals'::jsonb ->> 'fee_lines')::int = 0 and (:'empty_totals'::jsonb ->> 'total_cents')::bigint = 0
                      and :'empty_totals'::jsonb -> 'by_level' = '[]'::jsonb,
  'A · a term with no fee lines gives zeros and no levels, not an error');

-- ── B. Sums and counts only ─────────────────────────────────────────────────────
select pg_temp.assert((select string_agg(k, ',' order by k collate "C") = 'assistance_cents,base_cents,billed_unpaid_cents,by_level,cap_reduction_cents,fee_lines,late_fee_cents,not_billed_cents,paid_cents,sibling_discount_cents,term,term_id,total_cents,unpriced_lines'
                         from jsonb_object_keys(:'principal_totals'::jsonb) k),
  'B · the answer has only totals, counts, the term and its name');
select pg_temp.assert((select bool_and(pg_temp.keys(x) = 'fee_lines,level,level_id,paid_cents,total_cents,track') from jsonb_array_elements(:'principal_totals'::jsonb -> 'by_level') x),
  'B · each level line has only the level, its track and sums');
select pg_temp.assert(:'principal_totals' !~* '(riya|dev|anya|kiran|mira|shah|household|enrollment|person|learner|student|child)',
  'B · no name of a learner or a parent, and no household, enrollment or person anywhere in the answer');

-- ── C. Who may call it ───────────────────────────────────────────────────────────
set role authenticated;
select pg_temp.claims(:u_cora);
select pg_temp.assert_code(format($$select app.pathshala_fee_totals(%L)$$, :t1), '42501', 'You don''t have access to this area',
  'C · the committee (pathshala.view only) is told it has no access to this area');
select pg_temp.claims(:u_mira);
select pg_temp.assert_refused(format($$select app.pathshala_fee_totals(%L)$$, :t1),
  'C · a parent whose own fee lines are on the term may not call it either');
select pg_temp.claims(:u_other);
select pg_temp.assert_code(format($$select app.pathshala_fee_totals(%L)$$, :t1), 'P0002', 'not found',
  'C · a person from nowhere does not even see that the term exists');
select pg_temp.claims(:u_pia);
select pg_temp.assert_code(format($$select app.pathshala_fee_totals(%L)$$, :t_other), 'P0002', 'not found',
  'C · the principal of one community cannot read another community''s term');
select pg_temp.assert_code(format($$select app.pathshala_fee_totals(%L)$$, '124a0000-0000-4000-8000-00000000ffff'), 'P0002', 'not found',
  'C · a term that does not exist is not found');
reset role;
select pg_temp.no_claims();
set role authenticated;
select pg_temp.assert_code(format($$select app.pathshala_fee_totals(%L)$$, :t1), '42501', 'Sign in first',
  'C · nobody signed in is refused');
reset role;

-- ── D. Rights and grants ─────────────────────────────────────────────────────────
select pg_temp.assert((select not p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname = 'pathshala_fee_totals'),
  'D · it is SECURITY INVOKER: the caller''s own rights and row-level security apply');
select pg_temp.assert((select p.provolatile = 's' and 'search_path=app, public, extensions' = any (p.proconfig)
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'pathshala_fee_totals'),
  'D · it only reads (stable) and pins the search path the hosted database needs');
select pg_temp.assert(has_function_privilege('authenticated', 'app.pathshala_fee_totals(uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.pathshala_fee_totals(uuid)', 'execute'),
  'D · signed-in people may execute it and anonymous visitors may not');

rollback;
\echo 'PASS: Pathshala fee totals tests'
