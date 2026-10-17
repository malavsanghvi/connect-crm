-- 0886-0888 (CatchTheMatch Phase 1, docs/CATCH_THE_MATCH.md section 12): claims, the match a member missed, and the library of how to
-- claim from each employer.
--   A. Structure: the tables are private and only the functions write; the helpers are not callable by a signed-in person.
--   B. The deadline rule, in dates.
--   C. The catch list: empty until an employer's program has paid this community; then the other members whose employer on file is
--      linked to that program and whose gifts have no claim, the gifts that count (adults, completed, in the last two years, at or above the
--      program's minimum, no history import or opening balance), the ones past their deadline kept apart, the household as the community
--      knows it, amounts only for someone who also sees giving.
--   D. Claims: asking, moving a claim on, closing it, opening it again; who may write.
--   E. The library: only Weaver's team writes; communities read; cleaned input; the count of communities paid through a program.
--   F. Every read is logged without names; the module off, or no access, is "You don't have access to this area".
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
-- The row of a catch-list answer for one person.
create or replace function pg_temp.row_of(j jsonb, p_person uuid) returns jsonb language sql as $$
  select e from jsonb_array_elements(j -> 'rows') e where e -> 'person' ->> 'id' = p_person::text
$$;

\set c1 '''88600000-0000-4000-8000-0000000000c1'''
\set c2 '''88600000-0000-4000-8000-0000000000c2'''
\set owner '''88600000-0000-4000-8000-000000000001'''
\set plat '''88600000-0000-4000-8000-000000000002'''
\set lead '''88600000-0000-4000-8000-000000000003'''
\set viewer '''88600000-0000-4000-8000-000000000004'''
\set giver '''88600000-0000-4000-8000-000000000005'''
\set clerk '''88600000-0000-4000-8000-000000000006'''
\set ha '''88600000-0000-4000-8000-0000000000b1'''
\set hb '''88600000-0000-4000-8000-0000000000b2'''
\set hc '''88600000-0000-4000-8000-0000000000b3'''
\set hd '''88600000-0000-4000-8000-0000000000b4'''
\set he '''88600000-0000-4000-8000-0000000000b5'''
\set h2 '''88600000-0000-4000-8000-0000000000b9'''
\set pa '''88600000-0000-4000-8000-0000000000a1'''
\set pb '''88600000-0000-4000-8000-0000000000a2'''
\set pc '''88600000-0000-4000-8000-0000000000a3'''
\set pd '''88600000-0000-4000-8000-0000000000a4'''
\set pe '''88600000-0000-4000-8000-0000000000a5'''
\set pk '''88600000-0000-4000-8000-0000000000a6'''
\set p2 '''88600000-0000-4000-8000-0000000000a9'''

-- ══ A. Structure ═════════════════════════════════════════════════════════════
select pg_temp.assert((select relrowsecurity from pg_class where oid = 'app.match_claims'::regclass)
                      and (select relrowsecurity from pg_class where oid = 'app.match_processes'::regclass)
                      and not has_table_privilege('authenticated', 'app.match_claims', 'insert')
                      and not has_table_privilege('authenticated', 'app.match_claims', 'update')
                      and not has_table_privilege('authenticated', 'app.match_processes', 'insert')
                      and not has_table_privilege('authenticated', 'app.match_processes', 'update')
                      and not has_table_privilege('anon', 'app.match_claims', 'select')
                      and not has_table_privilege('anon', 'app.match_processes', 'select'),
  'A · both tables are private and nobody but a function writes to them');
select pg_temp.assert(not has_function_privilege('authenticated', 'app._match_catch(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app._match_gifts(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app._match_today(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app._match_process_clean(jsonb)', 'execute')
                      and has_function_privilege('authenticated', 'app.match_catch_list(uuid, text, int, int)', 'execute')
                      and has_function_privilege('authenticated', 'app.ask_match_claims(uuid, uuid, uuid, text)', 'execute')
                      and not has_function_privilege('anon', 'app.match_catch_list(uuid, text, int, int)', 'execute'),
  'A · the helpers are not callable by a signed-in person; the reads and writes are, and not by anyone signed out');
select pg_temp.assert((select module_key from app.module_tables where table_name = 'match_claims') = 'matching'
                      and (select module_key from app.module_tables where table_name = 'match_processes') is null,
  'A · claims belong to CatchTheMatch; the library is shared like the directory');

-- ══ B. The deadline rule ═════════════════════════════════════════════════════
select pg_temp.assert(app._match_deadline('end_of_gift_year', null, null, null, date '2026-03-05') = date '2026-12-31'
                      and app._match_deadline('months_after_gift', 6, null, null, date '2026-08-31') = date '2027-02-28'
                      and app._match_deadline('date_next_year', null, 1, 31, date '2026-05-05') = date '2027-01-31'
                      and app._match_deadline('date_next_year', null, 2, 30, date '2026-05-05') = date '2027-02-28'
                      and app._match_deadline('none', null, null, null, date '2026-05-05') is null
                      and app._match_deadline(null, null, null, null, date '2026-05-05') is null,
  'B · the deadline: end of the gift year, months after, a date the next year (a day past the month''s end falls on its last), none or unknown is no deadline');

-- ══ Fixtures ═════════════════════════════════════════════════════════════════
insert into auth.users (id, email) values
  (:owner, 'owner886@c1.test'), (:plat, 'plat886@weaver.test'), (:lead, 'lead886@c1.test'), (:viewer, 'viewer886@c1.test'),
  (:giver, 'giver886@c1.test'), (:clerk, 'clerk886@c1.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone, category_key, environment) values
  (:c1, 'ctm886a', 'Grace Church 886', 'G886', 'TX', 'active', 'America/Chicago', 'church', 'sandbox'),
  (:c2, 'ctm886b', 'Second Church 886', 'S886', 'TX', 'active', 'America/Chicago', 'church', 'sandbox');
insert into app.center_owners (center_id, user_id) values (:c1, :owner);
insert into app.center_module_grants (center_id, module_key, granted, reason) values
  (:c1, 'matching', true, 'Test 886: CatchTheMatch'), (:c2, 'matching', true, 'Test 886: CatchTheMatch');
insert into app.roles (key, tier, name, default_scope, description, permissions) values
  ('matching_viewer886', 'center', 'Matching viewer 886', 'center', 'Test 886: matching.view only', '["matching.view"]'),
  ('matching_giver886', 'center', 'Matching and giving 886', 'center', 'Test 886: matching.view and giving.view', '["matching.view","giving.view"]'),
  ('people_viewer886', 'center', 'People viewer 886', 'center', 'Test 886', '["people.view"]');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:c1, :plat, 'platform_owner', 'platform', 'Test 886: the platform owner role (holds "*")'),
  (:c1, :lead, 'matching_lead', 'center', 'Test 886'), (:c1, :viewer, 'matching_viewer886', 'center', 'Test 886'),
  (:c1, :giver, 'matching_giver886', 'center', 'Test 886'), (:c1, :clerk, 'people_viewer886', 'center', 'Test 886');
select pg_temp.assert(app.module_enabled(:c1, 'matching') and app.module_enabled(:c1, 'giving'), 'Fixtures · CatchTheMatch and Giving are on');

insert into app.households (id, center_id, display_name) values
  (:ha, :c1, 'Alpha886, Ana'), (:hb, :c1, 'Bravo886, Bo'), (:hc, :c1, 'Charlie886, Cy'), (:hd, :c1, 'Delta886, Di'),
  (:he, :c1, 'Echo886, Ed'), (:h2, :c2, 'Other886, Oz');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (:pa, :c1, 'Ana', 'Alpha886', date '1980-01-01'), (:pb, :c1, 'Bo', 'Bravo886', date '1975-02-02'),
  (:pc, :c1, 'Cy', 'Charlie886', date '1976-03-03'), (:pd, :c1, 'Di', 'Delta886', date '1970-04-04'),
  (:pe, :c1, 'Ed', 'Echo886', date '1971-05-05'),
  (:pk, :c1, 'Kit', 'Alpha886', (pg_temp.today() - interval '10 years')::date), (:p2, :c2, 'Oz', 'Other886', date '1980-01-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:ha, :pa, :c1, 'primary', true), (:ha, :pk, :c1, 'child', false), (:hb, :pb, :c1, 'primary', true), (:hc, :pc, :c1, 'primary', true),
  (:hd, :pd, :c1, 'primary', true), (:he, :pe, :c1, 'primary', true), (:h2, :p2, :c2, 'primary', true);

-- Gifts: p_days ago, in cents; flags: opening balance, history import. Ids are a1.. so the test can name them.
create or replace function pg_temp.gift(p_id uuid, p_center uuid, p_h uuid, p_person uuid, p_cents int, p_days int, p_opening boolean default false,
                                        p_history boolean default false) returns void language sql as $$
  insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, received_on, created_at,
                            receipt_number, is_opening_balance, is_historical, refunded_cents)
  values (p_id, p_center, p_h, p_person, p_cents, 'check', 'captured', 'offline', pg_temp.today() - p_days, now() - make_interval(days => p_days),
          'R-886-' || right(p_id::text, 4), p_opening, p_opening or p_history, 0)
$$;
\set ga1 '''88600000-0000-4000-8000-00000000f001'''
\set ga2 '''88600000-0000-4000-8000-00000000f002'''
\set gb1 '''88600000-0000-4000-8000-00000000f003'''
\set gb2 '''88600000-0000-4000-8000-00000000f004'''
\set gb3 '''88600000-0000-4000-8000-00000000f005'''
\set gb4 '''88600000-0000-4000-8000-00000000f006'''
\set gb5 '''88600000-0000-4000-8000-00000000f007'''
\set gb6 '''88600000-0000-4000-8000-00000000f008'''
\set gc1 '''88600000-0000-4000-8000-00000000f009'''
\set gd1 '''88600000-0000-4000-8000-00000000f00a'''
\set ge1 '''88600000-0000-4000-8000-00000000f00b'''
\set gk1 '''88600000-0000-4000-8000-00000000f00c'''
\set g21 '''88600000-0000-4000-8000-00000000f00d'''
select pg_temp.gift(:ga1, :c1, :ha, :pa, 10000, 60),                -- Ana's gift the employer matched
       pg_temp.gift(:ga2, :c1, :ha, :pa, 5000, 20),                 -- Ana's other gift: catchable
       pg_temp.gift(:gb1, :c1, :hb, :pb, 20000, 10),                -- Bo's gift: catchable
       pg_temp.gift(:gb2, :c1, :hb, :pb, 1000, 10),                 -- under the program's $25 minimum
       pg_temp.gift(:gb3, :c1, :hb, :pb, 8000, 300),                -- 10 months ago: past the 6-month deadline (missed)
       pg_temp.gift(:gb4, :c1, :hb, :pb, 9000, 800),                -- older than two years
       pg_temp.gift(:gb5, :c1, :hb, :pb, 7000, 5, false, true),     -- a history import
       pg_temp.gift(:gb6, :c1, :hb, :pb, 6000, 5, true),            -- an opening balance
       pg_temp.gift(:gc1, :c1, :hc, :pc, 15000, 15),                -- Cy's employer is on file but not linked to a program
       pg_temp.gift(:gd1, :c1, :hd, :pd, 12000, 5),                 -- Di's program has never paid this community
       pg_temp.gift(:ge1, :c1, :he, :pe, 11000, 12),                -- Ed: linked, later withdrawn
       pg_temp.gift(:g21, :c2, :h2, :p2, 30000, 30);                -- another community's gift

-- The directory (Weaver's team) and the employers on file (the office, from signed paper forms).
set role authenticated;
select pg_temp.claims(:plat);
select app.save_match_program(null,
  '{"company_name": "Acme886", "names": ["Acme886 Corp"], "country": "US", "match_ratio_bp": 10000, "min_gift_cents": 2500,
    "portal": "benevity", "portal_url": "https://acme886.benevity.example/match", "deadline_kind": "months_after_gift", "deadline_months": 6,
    "source": "employer_site"}'::jsonb, 'Test 886: Acme') as acme \gset
select app.save_match_program(null, '{"company_name": "Zeta886", "country": "US", "match_ratio_bp": 10000, "source": "other"}'::jsonb, 'Test 886: Zeta') as zeta \gset
select pg_temp.claims(:lead);
select app.record_match_employer(:c1, :pa, 'Acme886 Corp');
select app.record_match_employer(:c1, :pb, 'Acme886 Corp');
select app.record_match_employer(:c1, :pc, 'Acme886 Corp');
select app.record_match_employer(:c1, :pd, 'Zeta886');
select app.record_match_employer(:c1, :pe, 'Acme886 Corp');
select app.link_match_program(:c1, :pa, :'acme');
select app.link_match_program(:c1, :pb, :'acme');
select app.link_match_program(:c1, :pd, :'zeta');
select app.link_match_program(:c1, :pe, :'acme');
reset role;

-- ══ C. The catch list ════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:lead);
select app.match_catch_list(:c1) as l0 \gset
select pg_temp.assert((:'l0'::jsonb -> 'rows') = '[]'::jsonb and (:'l0'::jsonb -> 'counts' ->> 'catchable') = '0'
                      and (:'l0'::jsonb -> 'counts' ->> 'missed') = '0',
  'C · no employer has paid this community yet, so nobody is a missed match (nothing is guessed from a company name)');

-- The first match: Ana's gift, recorded by the office as received.
select pg_temp.assert_raises(format('select app.record_match_claim(%L, %L, %L)', :c1, :pc, :gc1), 'Confirm this person''s employer first',
  'C · a claim needs the person''s employer confirmed (linked to a program) first');
select pg_temp.assert_raises(format('select app.record_match_claim(%L, %L, %L)', :c1, :pa, :gb1), 'own gift',
  'C · a claim is for the person''s own gift, never another''s');
select pg_temp.assert_raises(format('select app.record_match_claim(%L, %L, %L, %L, %L)', :c1, :pa, :ga1, 'received', (pg_temp.today() + 3)::text),
  'in the future', 'C · a match cannot have been received in the future');
select pg_temp.assert_raises(format('select app.record_match_claim(%L, %L, %L, %L)', :c1, :pa, :ga1, 'declined'), 'starts as',
  'C · a recorded claim starts as asked, requested, verified or received');
select app.record_match_claim(:c1, :pa, :ga1, 'received', null, 'Benevity paid in the spring') as rec \gset
select pg_temp.assert((:'rec'::jsonb ->> 'state') = 'received'
                      and (select received_on from app.match_claims where id = (:'rec'::jsonb ->> 'id')::uuid) = pg_temp.today(),
  'C · the first match is recorded as received today');
select pg_temp.assert_raises(format('select app.record_match_claim(%L, %L, %L)', :c1, :pa, :ga1), 'already has a claim',
  'C · a gift has one claim');

select app.match_catch_list(:c1) as l1 \gset
select pg_temp.assert(jsonb_array_length(:'l1'::jsonb -> 'rows') = 3
                      and pg_temp.row_of(:'l1'::jsonb, :pa) is not null and pg_temp.row_of(:'l1'::jsonb, :pb) is not null
                      and pg_temp.row_of(:'l1'::jsonb, :pe) is not null
                      and pg_temp.row_of(:'l1'::jsonb, :pc) is null and pg_temp.row_of(:'l1'::jsonb, :pd) is null,
  'C · once Acme has paid, its other members are listed; the one not linked to a program and the one whose program never paid are not');
select pg_temp.assert(jsonb_array_length(pg_temp.row_of(:'l1'::jsonb, :pa) -> 'gifts') = 1
                      and (pg_temp.row_of(:'l1'::jsonb, :pa) -> 'gifts' -> 0 ->> 'payment_id') = :ga2
                      and jsonb_array_length(pg_temp.row_of(:'l1'::jsonb, :pb) -> 'gifts') = 1
                      and (pg_temp.row_of(:'l1'::jsonb, :pb) -> 'gifts' -> 0 ->> 'payment_id') = :gb1,
  'C · only gifts that can be claimed count: not one already matched, one under the minimum, a history import, an opening balance, one older than two years or one past its deadline');
select pg_temp.assert((pg_temp.row_of(:'l1'::jsonb, :pa) -> 'proven' ->> 'received') = '1'
                      and (pg_temp.row_of(:'l1'::jsonb, :pa) ->> 'employer') = 'Acme886 Corp'
                      and (pg_temp.row_of(:'l1'::jsonb, :pa) -> 'program' ->> 'company_name') = 'Acme886'
                      and (pg_temp.row_of(:'l1'::jsonb, :pa) -> 'process') = 'null'::jsonb,
  'C · each row says how many matches the program has paid here, the employer on file, the program and whether the library has its steps');
select pg_temp.assert((pg_temp.row_of(:'l1'::jsonb, :pa) -> 'household') ? 'number'
                      and (pg_temp.row_of(:'l1'::jsonb, :pa) -> 'household' ->> 'name') = 'Alpha886, Ana'
                      and (pg_temp.row_of(:'l1'::jsonb, :pa) -> 'household' -> 'adults') is not null
                      and not (pg_temp.row_of(:'l1'::jsonb, :pa)::text like '%Kit%'),
  'C · the household as the community knows it (its number and city, never a name alone), and no child');
select pg_temp.assert((:'l1'::jsonb ->> 'amounts') = 'false'
                      and (pg_temp.row_of(:'l1'::jsonb, :pb) -> 'gifts' -> 0 -> 'amount_cents') = 'null'::jsonb
                      and (:'l1'::jsonb -> 'counts' ->> 'catchable') = '3' and (:'l1'::jsonb -> 'counts' ->> 'missed') = '1'
                      and (:'l1'::jsonb -> 'counts' ->> 'ended') = '1' and (:'l1'::jsonb -> 'counts' ->> 'open') = '0'
                      and (:'l1'::jsonb -> 'org' ->> 'name') = 'Grace Church 886' and (:'l1'::jsonb ->> 'can_manage') = 'true',
  'C · no amount without giving; the counts; the organization''s own name for the steps; the manager is told they can write');
select app.match_catch_list(:c1, 'missed') as lm \gset
select pg_temp.assert(jsonb_array_length(:'lm'::jsonb -> 'rows') = 1 and pg_temp.row_of(:'lm'::jsonb, :pb) is not null
                      and (pg_temp.row_of(:'lm'::jsonb, :pb) -> 'gifts' -> 0 ->> 'payment_id') = :gb3
                      and ((pg_temp.row_of(:'lm'::jsonb, :pb) -> 'gifts' -> 0 ->> 'days_left')::int) < 0,
  'C · a gift past its deadline with no claim is kept apart, as what was missed');

-- Amounts follow giving.view; a viewer reads; someone with neither is refused.
select pg_temp.claims(:giver);
select app.match_catch_list(:c1) as lg \gset
select pg_temp.assert((:'lg'::jsonb ->> 'amounts') = 'true' and (pg_temp.row_of(:'lg'::jsonb, :pb) -> 'gifts' -> 0 ->> 'amount_cents') = '20000'
                      and (:'lg'::jsonb ->> 'can_manage') = 'false',
  'C · a role that also sees giving sees the amount; one that only views is not offered the writes');
select pg_temp.claims(:viewer);
select pg_temp.assert(jsonb_array_length((app.match_catch_list(:c1)) -> 'rows') = 3, 'C · a CatchTheMatch viewer reads the list');
select pg_temp.claims(:clerk);
select pg_temp.assert_raises(format('select app.match_catch_list(%L)', :c1), 'don''t have access', 'C · someone without CatchTheMatch is refused');
select pg_temp.claims(:plat);
select pg_temp.assert_raises(format('select app.match_catch_list(%L)', :c1), 'don''t have access', 'C · Weaver''s team is refused: no platform-admin branch');
select pg_temp.assert_raises(format('select app.match_claims_list(%L)', :c1), 'don''t have access', 'C · nor may it read the claims');
select pg_temp.claims(:owner);
select pg_temp.assert(jsonb_array_length((app.match_catch_list(:c1)) -> 'rows') = 3, 'C · the organization''s owner reads it');
reset role;

-- ══ D. Claims ════════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:viewer);
select pg_temp.assert_raises(format('select app.ask_match_claims(%L, %L, %L)', :c1, :pb, :'acme'), 'don''t have access', 'D · a viewer cannot ask');
select pg_temp.assert_raises(format('select app.record_match_claim(%L, %L, %L)', :c1, :pb, :gb1), 'don''t have access', 'D · nor record a claim');
select pg_temp.claims(:lead);
select pg_temp.assert_raises(format('select app.ask_match_claims(%L, %L, %L)', :c1, :pc, :'acme'), 'Nothing is left to ask for',
  'D · nothing to ask for someone with no claimable gift (here: not linked)');
select app.ask_match_claims(:c1, :pb, :'acme', 'Asked at the Sunday coffee') as ask \gset
select pg_temp.assert((:'ask'::jsonb ->> 'asked') = '1' and (select count(*) from app.match_claims where person_id = :pb and state = 'asked') = 1
                      and (select payment_id from app.match_claims where person_id = :pb) = :gb1,
  'D · asking records one claim for each gift that can still be claimed (the past-deadline gift is left out)');
select pg_temp.assert_raises(format('select app.ask_match_claims(%L, %L, %L)', :c1, :pb, :'acme'), 'Nothing is left to ask for',
  'D · asking again finds nothing new');
select app.match_catch_list(:c1) as l2 \gset
select pg_temp.assert(pg_temp.row_of(:'l2'::jsonb, :pb) is null and pg_temp.row_of(:'l2'::jsonb, :pa) is not null
                      and (:'l2'::jsonb -> 'counts' ->> 'open') = '1' and (:'l2'::jsonb -> 'counts' ->> 'missed') = '1',
  'D · once asked, a member leaves the list to catch and the claim shows as open; what was missed stays missed');
select app.match_claims_list(:c1, 'open') as co \gset
select pg_temp.assert((:'co'::jsonb ->> 'total') = '1' and (:'co'::jsonb -> 'rows' -> 0 ->> 'state') = 'asked'
                      and (:'co'::jsonb -> 'rows' -> 0 -> 'person' ->> 'name') = 'Bo Bravo886'
                      and (:'co'::jsonb -> 'rows' -> 0 -> 'program' ->> 'company_name') = 'Acme886'
                      and (:'co'::jsonb -> 'rows' -> 0 -> 'gift' -> 'amount_cents') = 'null'::jsonb
                      and (:'co'::jsonb -> 'rows' -> 0 ->> 'deadline_on') is not null,
  'D · the open claims, with the person, program, gift and last day to ask (no amount without giving)');
select app.match_claims_list(:c1, 'ended') as ce \gset
select pg_temp.assert((:'ce'::jsonb ->> 'total') = '1' and (:'ce'::jsonb -> 'rows' -> 0 ->> 'state') = 'received',
  'D · the ended claims: the first match, received');

select id as bo_claim from app.match_claims where person_id = :pb \gset
select app.set_match_claim_state(:c1, :'bo_claim'::uuid, 'requested', 'She asked HR on Monday');
select app.set_match_claim_state(:c1, :'bo_claim'::uuid, 'verified');
select pg_temp.assert((select state from app.match_claims where id = :'bo_claim'::uuid) = 'verified'
                      and (select note from app.match_claims where id = :'bo_claim'::uuid) = 'She asked HR on Monday'
                      and (select received_on from app.match_claims where id = :'bo_claim'::uuid) is null,
  'D · a claim moves on (asked, requested, verified) and keeps its note');
select app.set_match_claim_state(:c1, :'bo_claim'::uuid, 'received');
select pg_temp.assert((select received_on from app.match_claims where id = :'bo_claim'::uuid) = pg_temp.today(),
  'D · received carries the day');
select pg_temp.assert_raises(format('select app.set_match_claim_state(%L, %L, %L)', :c1, :'bo_claim', 'requested'), 'has ended',
  'D · an ended claim cannot just move to another state');
select app.set_match_claim_state(:c1, :'bo_claim'::uuid, 'asked');
select pg_temp.assert((select state from app.match_claims where id = :'bo_claim'::uuid) = 'asked'
                      and (select received_on from app.match_claims where id = :'bo_claim'::uuid) is null,
  'D · an ended claim can be opened again (it was a mistake): it is asked, with no day of receipt');
select pg_temp.assert_raises(format('select app.set_match_claim_state(%L, %L, %L)', :c1, :'bo_claim', 'bogus'), 'Choose where the claim stands',
  'D · an unknown state is refused in words');
select pg_temp.assert_raises(format('select app.set_match_claim_state(%L, %L, %L)', :c2, :'bo_claim', 'requested'), 'don''t have access',
  'D · another community''s claim is not reachable: no access there');
select app.set_match_claim_state(:c1, :'bo_claim'::uuid, 'declined', 'HR said the program excludes places of worship');
select pg_temp.assert((select state from app.match_claims where id = :'bo_claim'::uuid) = 'declined', 'D · a claim can end without a match');
select app.set_match_claim_state(:c1, :'bo_claim'::uuid, 'asked');
select app.set_match_claim_state(:c1, :'bo_claim'::uuid, 'received');
reset role;

-- A claim is an adult's own gift in their own community.
select pg_temp.assert_raises(format('insert into app.match_claims (center_id, person_id, program_id, payment_id) values (%L, %L, %L, %L)', :c1, :pa, :'acme', :gb1),
  'person''s own gift', 'D · the database refuses a claim on someone else''s gift');
insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, received_on, created_at, receipt_number,
                          is_opening_balance, is_historical, refunded_cents)
  values (:gk1, :c1, :ha, :pk, 5000, 'check', 'captured', 'offline', pg_temp.today() - 2, now(), 'R-886-kid', false, false, 0);
select pg_temp.assert_raises(format('insert into app.match_claims (center_id, person_id, program_id, payment_id) values (%L, %L, %L, %L)', :c1, :pk, :'acme', :gk1),
  'adults only', 'D · and a claim for a child');
select pg_temp.assert_raises(format('insert into app.match_claims (center_id, person_id, program_id, payment_id) values (%L, %L, %L, %L)', :c2, :pa, :'acme', :ga2),
  'not found in this community', 'D · and a gift of another community');
select pg_temp.assert_raises(format('update app.match_claims set person_id = %L where id = %L', :pa, :'bo_claim'), 'keeps its gift',
  'D · a claim keeps its gift, its person and its program');

-- ══ E. The library ═══════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:lead);
select pg_temp.assert_raises(format('select app.save_match_process(%L, %L::jsonb, %L)', :'acme', '{"summary":"x","who_submits":"member","steps":["a"]}', 'x'),
  'Only Weaver''s team', 'E · a community cannot write the library');
select pg_temp.claims(:plat);
select pg_temp.assert_raises(format('select app.save_match_process(%L, %L::jsonb, %L)', :'acme', '{"summary":"x","who_submits":"member","steps":[]}', 'x'),
  'at least one step', 'E · a process needs at least one step');
select pg_temp.assert_raises(format('select app.save_match_process(%L, %L::jsonb, %L)', :'acme', '{"summary":"x","who_submits":"member","steps":["a"],"links":[{"label":"Portal","url":"http://x.example"}]}', 'x'),
  'https://', 'E · a link must start with https://');
select pg_temp.assert_raises(format('select app.save_match_process(%L, %L::jsonb, %L)', :'acme', '{"summary":"x","who_submits":"nobody","steps":["a"]}', 'x'),
  'Unknown', 'E · who submits is one of the three');
select pg_temp.assert_raises(format('select app.save_match_process(%L, %L::jsonb, %L)', :'acme', '{"summary":"x","who_submits":"member","steps":["a"],"worked_note":"it worked"}', 'x'),
  'Give the day it worked', 'E · a note on how it worked needs its day');
select pg_temp.assert_raises(format('select app.save_match_process(%L, %L::jsonb, %L)', :'acme', '{"summary":"x","who_submits":"member","steps":["a"]}', ''),
  'Say what changed', 'E · a change says why');
select app.save_match_process(:'acme',
  '{"summary": "  The member requests the match in Benevity;   staff verify it.  ", "who_submits": "either",
    "steps": ["Sign in to Benevity with your work email", "  Find the organization by its legal name and tax ID ", "", "Enter the gift date and amount"],
    "documents": ["The receipt or bank line of the gift"], "links": [{"label": "Acme''s Benevity page", "url": "https://acme886.benevity.example/match"}],
    "typical_days": 45, "tips": "Request it within 30 days of the gift.", "worked_on": "2026-09-01", "worked_note": "Paid to a community in the spring"}'::jsonb,
  'Test 886: the steps that worked') as v1 \gset
select pg_temp.assert(:v1 = 1, 'E · Weaver''s team saves the steps (version 1)');
select app.save_match_process(:'acme', '{"summary": "The member requests the match in Benevity; staff verify it.", "who_submits": "either",
  "steps": ["Sign in to Benevity with your work email", "Find the organization by its legal name and tax ID", "Enter the gift date and amount"],
  "typical_days": 30}'::jsonb, 'Test 886: shorter') as v2 \gset
select pg_temp.assert(:v2 = 2 and (select cardinality(steps) from app.match_processes where program_id = :'acme') = 3
                      and (select tips from app.match_processes where program_id = :'acme') is null,
  'E · a change is a new version, and what is no longer sent is cleared');
select pg_temp.assert(exists (select 1 from app.audit_log where record_table = 'match_processes' and action = 'match_processes.update' and center_id is null),
  'E · the history is the shared audit: no community');
select pg_temp.claims(:lead);
select app.match_process_get(:'acme', :c1) as pg1 \gset
select pg_temp.assert((:'pg1'::jsonb -> 'process' ->> 'who_submits') = 'either' and jsonb_array_length(:'pg1'::jsonb -> 'process' -> 'steps') = 3
                      and (:'pg1'::jsonb -> 'program' ->> 'company_name') = 'Acme886'
                      and (:'pg1'::jsonb ->> 'worked_communities') = '1' and (:'pg1'::jsonb -> 'here' ->> 'received') = '2'
                      and not (:'pg1'::jsonb::text ~ 'Ana|Bo |Bravo|Alpha'),
  'E · a community reads the steps, how many communities were paid through the program and how many matches it received itself; no person in it');
reset role;
-- A second community that has been paid through Acme: the count is of communities, never which.
insert into app.match_claims (center_id, person_id, program_id, payment_id, state, received_on) values (:c2, :p2, :'acme', :g21, 'received', pg_temp.today());
set role authenticated;
select pg_temp.claims(:lead);
select app.match_process_get(:'acme', :c1) as pg2 \gset
select pg_temp.assert((:'pg2'::jsonb ->> 'worked_communities') = '2' and (:'pg2'::jsonb -> 'here' ->> 'received') = '2',
  'E · two communities have been paid; this one sees only its own matches');
select pg_temp.assert((select count(*) from app.match_claims where center_id = :c2) = 0, 'E · and cannot read the other community''s claims directly');
select app.match_process_list(null, 50, 0) as pl \gset
select pg_temp.assert((:'pl'::jsonb ->> 'total') = '1' and (:'pl'::jsonb -> 'rows' -> 0 ->> 'company_name') = 'Acme886'
                      and (:'pl'::jsonb -> 'rows' -> 0 ->> 'worked_communities') = '2'
                      and (app.match_process_list('acme886', 50, 0) ->> 'total') = '1' and (app.match_process_list('nothing here', 50, 0) ->> 'total') = '0',
  'E · the library lists the programs that have steps, found by any of their names');
select app.match_catch_list(:c1) as l3 \gset
select pg_temp.assert((pg_temp.row_of(:'l3'::jsonb, :pa) -> 'process' ->> 'who_submits') = 'either',
  'E · the catch list says when the library has the program''s steps');
select pg_temp.claims(:clerk);
select pg_temp.assert_raises(format('select app.match_process_get(%L)', :'acme'), 'don''t have access', 'E · someone without CatchTheMatch cannot read the library');
select pg_temp.claims(:plat);
select pg_temp.assert((app.match_process_get(:'acme') ->> 'worked_communities') = '2' and (app.match_process_get(:'acme') -> 'here') = 'null'::jsonb,
  'E · Weaver''s team reads it too, with no community''s own count');
select app.remove_match_process(:'zeta', 'Test 886: nothing to remove');
select pg_temp.assert((select count(*) from app.match_processes) = 1, 'E · removing what is not there changes nothing');
reset role;

-- ══ E2. One person's gifts, for recording a match the office already knows about ═══
set role authenticated;
select pg_temp.claims(:lead);
select app.match_person_gifts(:c1, :pa) as pg \gset
select pg_temp.assert(jsonb_array_length(:'pg'::jsonb -> 'gifts') = 2
                      and (select e -> 'claim' ->> 'state' from jsonb_array_elements(:'pg'::jsonb -> 'gifts') e where e ->> 'payment_id' = :ga1) = 'received'
                      and (select e -> 'claim' from jsonb_array_elements(:'pg'::jsonb -> 'gifts') e where e ->> 'payment_id' = :ga2) = 'null'::jsonb
                      and (:'pg'::jsonb -> 'program' ->> 'company_name') = 'Acme886' and (:'pg'::jsonb -> 'household' ->> 'name') = 'Alpha886, Ana'
                      and (:'pg'::jsonb ->> 'amounts') = 'false',
  'E · a person''s claimable gifts, each with its claim, the program their employer is linked to and the household; no amount without giving');
select pg_temp.assert_raises(format('select app.match_person_gifts(%L, %L)', :c1, :pk), 'not found', 'E · a child is never shown (the answer does not say why)');
select pg_temp.assert_raises(format('select app.match_person_gifts(%L, %L)', :c1, :p2), 'not found', 'E · nor a person of another community');
select pg_temp.claims(:clerk);
select pg_temp.assert_raises(format('select app.match_person_gifts(%L, %L)', :c1, :pa), 'don''t have access', 'E · and nobody without CatchTheMatch');
reset role;

-- ══ F. Reads are logged; access and the module ═══════════════════════════════
select pg_temp.assert((select count(*) from app.audit_log where action = 'matching.read' and (after ->> 'what') = 'catch_list') > 0
                      and (select count(*) from app.audit_log where action = 'matching.read' and (after ->> 'what') = 'claims') > 0
                      and not exists (select 1 from app.audit_log where action = 'matching.read' and after::text ~ '886'),
  'F · every read is logged (who, when, what, how many) and names no one');
set role authenticated;
select pg_temp.claims(:lead);
select app.withdraw_match_employer(:c1, :pe, 'By phone on the day of the test');
select pg_temp.assert(pg_temp.row_of(app.match_catch_list(:c1), :pe) is null,
  'F · a member who withdraws their employer leaves the list at once');
reset role;
delete from app.center_module_grants where center_id = :c1 and module_key = 'matching';
set role authenticated;
select pg_temp.claims(:lead);
select pg_temp.assert_raises(format('select app.match_catch_list(%L)', :c1), 'don''t have access', 'F · with CatchTheMatch off nobody reads the list');
select pg_temp.assert_raises(format('select app.ask_match_claims(%L, %L, %L)', :c1, :pb, :'acme'), 'don''t have access', 'F · nor writes a claim');
select pg_temp.assert((select count(*) from app.match_claims where center_id = :c1) = 0, 'F · and the claims are hidden from every direct read');
reset role;
rollback;
