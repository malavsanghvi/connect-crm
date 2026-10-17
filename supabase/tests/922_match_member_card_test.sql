-- 0922 (CatchTheMatch Phase 1, piece 2, docs/CATCH_THE_MATCH.md section 13): the member's side, "Does your employer match?".
--   A. Structure: the helpers are not callable; the member functions are, by signed-in people only; the one-person gift read equals the community one.
--   B. The card: the employer the member put on file, the steps for it (confirmed by staff, or the one entry with exactly that name), the
--      registered name and tax ID, the member's own gifts that can still be claimed (a day and a last day, never an amount); nothing for a child,
--      for an employer another sign-in consented to, with CatchTheMatch off, or when two entries share the name.
--   C. "I have asked my employer": the gifts become requested claims marked as reported by the member; staff see it; a second tap finds nothing; a
--      claim staff had asked goes to requested and back; staff moving it on ends the member's undo; a member's own report disappears on undo.
--   D. Own data only: no one sees another member's card or claims; a platform admin is a member like any other; no direct table read.
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
-- The claims table as the test reads it (a member and a manager read it only through the functions or by role).
create or replace function pg_temp.mc() returns setof app.match_claims language sql security definer as $$ select * from app.match_claims $$;

\set c1 '''92200000-0000-4000-8000-0000000000c1'''
\set owner '''92200000-0000-4000-8000-000000000001'''
\set plat '''92200000-0000-4000-8000-000000000002'''
\set lead '''92200000-0000-4000-8000-000000000003'''
\set uana '''92200000-0000-4000-8000-000000000011'''
\set ubo '''92200000-0000-4000-8000-000000000012'''
\set ucy '''92200000-0000-4000-8000-000000000013'''
\set udee '''92200000-0000-4000-8000-000000000014'''
\set ukit '''92200000-0000-4000-8000-000000000015'''
\set uother '''92200000-0000-4000-8000-000000000016'''
\set ha '''92200000-0000-4000-8000-0000000000b1'''
\set hb '''92200000-0000-4000-8000-0000000000b2'''
\set hc '''92200000-0000-4000-8000-0000000000b3'''
\set hd '''92200000-0000-4000-8000-0000000000b4'''
\set hp '''92200000-0000-4000-8000-0000000000b5'''
\set pa '''92200000-0000-4000-8000-0000000000a1'''
\set pb '''92200000-0000-4000-8000-0000000000a2'''
\set pc '''92200000-0000-4000-8000-0000000000a3'''
\set pd '''92200000-0000-4000-8000-0000000000a4'''
\set pk '''92200000-0000-4000-8000-0000000000a5'''
\set pp '''92200000-0000-4000-8000-0000000000a6'''
\set ga1 '''92200000-0000-4000-8000-00000000f001'''
\set ga2 '''92200000-0000-4000-8000-00000000f002'''
\set ga3 '''92200000-0000-4000-8000-00000000f003'''
\set gb1 '''92200000-0000-4000-8000-00000000f004'''
\set gc1 '''92200000-0000-4000-8000-00000000f005'''
\set gd1 '''92200000-0000-4000-8000-00000000f006'''
\set gk1 '''92200000-0000-4000-8000-00000000f007'''

-- ══ A. Structure ═════════════════════════════════════════════════════════════
select pg_temp.assert(not has_function_privilege('authenticated', 'app._match_gifts_of(uuid, uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app._match_member_program(uuid, uuid, text)', 'execute')
                      and not has_function_privilege('authenticated', 'app._match_member_gifts(uuid, uuid, uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.my_match_card(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.report_my_match_request(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.undo_my_match_request(uuid, uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.my_match_card(uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.report_my_match_request(uuid)', 'execute'),
  'A · the helpers are not callable by a signed-in person; the card, the report and the undo are, and not by anyone signed out');

-- ══ Fixtures ═════════════════════════════════════════════════════════════════
insert into auth.users (id, email) values
  (:owner, 'owner922@c1.test'), (:plat, 'plat922@weaver.test'), (:lead, 'lead922@c1.test'), (:uana, 'ana922@c1.test'), (:ubo, 'bo922@c1.test'),
  (:ucy, 'cy922@c1.test'), (:udee, 'dee922@c1.test'), (:ukit, 'kit922@c1.test'), (:uother, 'other922@c1.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone, category_key, environment) values
  (:c1, 'ctm922a', 'Grace Church 922', 'G922', 'TX', 'active', 'America/Chicago', 'church', 'sandbox');
insert into app.org_profiles (center_id, legal_name, ein) values (:c1, 'Grace Church of Austin 922, Inc.', '12-3456789')
  on conflict (center_id) do update set legal_name = excluded.legal_name, ein = excluded.ein;
insert into app.center_owners (center_id, user_id) values (:c1, :owner);
insert into app.center_module_grants (center_id, module_key, granted, reason) values (:c1, 'matching', true, 'Test 922: CatchTheMatch');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:c1, :plat, 'platform_owner', 'platform', 'Test 922: the platform owner role (holds "*")'),
  (:c1, :lead, 'matching_lead', 'center', 'Test 922');
insert into app.households (id, center_id, display_name) values
  (:ha, :c1, 'Alpha922, Ana'), (:hb, :c1, 'Bravo922, Bo'), (:hc, :c1, 'Charlie922, Cy'), (:hd, :c1, 'Delta922, Dee'), (:hp, :c1, 'Plat922, Pat');
insert into app.people (id, center_id, first_name, last_name, date_of_birth, email) values
  (:pa, :c1, 'Ana', 'Alpha922', date '1980-01-01', 'ana922@c1.test'), (:pb, :c1, 'Bo', 'Bravo922', date '1975-02-02', 'bo922@c1.test'),
  (:pc, :c1, 'Cy', 'Charlie922', date '1976-03-03', 'cy922@c1.test'), (:pd, :c1, 'Dee', 'Delta922', date '1970-04-04', 'dee922@c1.test'),
  (:pk, :c1, 'Kit', 'Alpha922', (pg_temp.today() - interval '10 years')::date, 'kit922@c1.test'),
  (:pp, :c1, 'Pat', 'Plat922', date '1960-05-05', 'plat922@weaver.test');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:ha, :pa, :c1, 'primary', true), (:ha, :pk, :c1, 'child', false), (:hb, :pb, :c1, 'primary', true), (:hc, :pc, :c1, 'primary', true),
  (:hd, :pd, :c1, 'primary', true), (:hp, :pp, :c1, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values
  (:c1, :uana, :pa), (:c1, :ubo, :pb), (:c1, :ucy, :pc), (:c1, :udee, :pd), (:c1, :ukit, :pk), (:c1, :plat, :pp);
create or replace function pg_temp.gift(p_id uuid, p_h uuid, p_person uuid, p_cents int, p_days int) returns void language sql as $$
  insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, received_on, created_at,
                            receipt_number, is_opening_balance, is_historical, refunded_cents)
  values (p_id, '92200000-0000-4000-8000-0000000000c1', p_h, p_person, p_cents, 'check', 'captured', 'offline', pg_temp.today() - p_days,
          now() - make_interval(days => p_days), 'R-922-' || right(p_id::text, 4), false, false, 0)
$$;
select pg_temp.gift(:ga1, :ha, :pa, 10000, 60), pg_temp.gift(:ga2, :ha, :pa, 5000, 20), pg_temp.gift(:ga3, :ha, :pa, 7000, 900),
       pg_temp.gift(:gb1, :hb, :pb, 20000, 10), pg_temp.gift(:gc1, :hc, :pc, 15000, 15), pg_temp.gift(:gd1, :hd, :pd, 12000, 5),
       pg_temp.gift(:gk1, :ha, :pk, 3000, 3);

set role authenticated;
select pg_temp.claims(:plat);
select app.save_match_program(null,
  '{"company_name": "Acme922", "names": ["Acme922 Corp"], "country": "US", "match_ratio_bp": 10000, "min_gift_cents": 2500,
    "portal": "benevity", "portal_url": "https://acme922.benevity.example/match", "deadline_kind": "months_after_gift", "deadline_months": 6,
    "source": "employer_site"}'::jsonb, 'Test 922: Acme') as acme \gset
select app.save_match_program(null, '{"company_name": "Dup922", "country": "US", "match_ratio_bp": 10000, "source": "other"}'::jsonb, 'Test 922: Dup US') as dup1 \gset
select app.save_match_program(null, '{"company_name": "Dup922", "country": "CA", "match_ratio_bp": 10000, "source": "other"}'::jsonb, 'Test 922: Dup CA') as dup2 \gset
select app.save_match_process(:'acme',
  '{"summary": "The member requests the match in Benevity; staff verify it.", "who_submits": "member",
    "steps": ["Sign in to Benevity with your work email", "Find the organization by its legal name and tax ID"],
    "documents": ["The receipt of the gift"], "typical_days": 30, "tips": "Request it within 30 days of the gift."}'::jsonb, 'Test 922: steps') as v1 \gset
-- The members put their employers on file themselves, with their consent.
select pg_temp.claims(:uana);
select app.set_my_match_employer(:c1, 'Acme922 Corp');
select pg_temp.claims(:ubo);
select app.set_my_match_employer(:c1, 'Acme922 Corp');
select pg_temp.claims(:ucy);
select app.set_my_match_employer(:c1, 'Unknown Co 922');
select pg_temp.claims(:udee);
select app.set_my_match_employer(:c1, 'Dup922');
-- Staff confirm Ana's employer; Bo's is found by its exact name; Cy's is not in the directory.
select pg_temp.claims(:lead);
select app.link_match_program(:c1, :pa, :'acme');
reset role;

-- ══ A2. One person's gifts equal the community's ═════════════════════════════
select pg_temp.assert((select count(*) from (select payment_id, person_id, household_id, received_on, donation_cents from app._match_gifts(:c1) where person_id in (:pa, :pb, :pc, :pd)
                                              except select payment_id, person_id, household_id, received_on, donation_cents from app._match_gifts_of(:c1, :pa)
                                              except select payment_id, person_id, household_id, received_on, donation_cents from app._match_gifts_of(:c1, :pb)
                                              except select payment_id, person_id, household_id, received_on, donation_cents from app._match_gifts_of(:c1, :pc)
                                              except select payment_id, person_id, household_id, received_on, donation_cents from app._match_gifts_of(:c1, :pd)) x) = 0
                      and (select count(*) from app._match_gifts_of(:c1, :pa)) = (select count(*) from app._match_gifts(:c1) where person_id = :pa)
                      and (select count(*) from app._match_gifts_of(:c1, :pk)) = 0,
  'A · the one-person gift read is the community one for the same person (and a child has none)');

-- ══ B. The card ══════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:uana);
select app.my_match_card(:c1) as ca \gset
select pg_temp.assert((:'ca'::jsonb ->> 'matching_on') = 'true' and (:'ca'::jsonb ->> 'is_adult') = 'true' and (:'ca'::jsonb ->> 'employer') = 'Acme922 Corp'
                      and (:'ca'::jsonb -> 'program' ->> 'company_name') = 'Acme922' and (:'ca'::jsonb -> 'program' ->> 'portal_url') = 'https://acme922.benevity.example/match'
                      and (:'ca'::jsonb -> 'process' ->> 'who_submits') = 'member' and jsonb_array_length(:'ca'::jsonb -> 'process' -> 'steps') = 2
                      and (:'ca'::jsonb -> 'org' ->> 'legal_name') = 'Grace Church of Austin 922, Inc.' and (:'ca'::jsonb -> 'org' ->> 'ein') = '12-3456789',
  'B · Ana sees her employer, the steps for it from the library and the registered name and tax ID');
select pg_temp.assert(jsonb_array_length(:'ca'::jsonb -> 'gifts') = 2
                      and (:'ca'::jsonb -> 'gifts' -> 0 ->> 'received_on') = (pg_temp.today() - 20)::text
                      and (:'ca'::jsonb -> 'gifts' -> 0 ->> 'deadline_on') is not null
                      and (:'ca'::jsonb -> 'claims') = '[]'::jsonb
                      and not (:'ca'::jsonb::text ~ '(amount|10000|5000|7000|Bo|Bravo|Cy |Charlie)'),
  'B · her two gifts that can still be claimed (not the one older than two years): the day and the last day to ask, no amount, nobody else');
select pg_temp.claims(:ubo);
select app.my_match_card(:c1) as cb \gset
select pg_temp.assert((:'cb'::jsonb -> 'program' ->> 'company_name') = 'Acme922' and jsonb_array_length(:'cb'::jsonb -> 'gifts') = 1,
  'B · Bo has no confirmed link: the one entry with exactly his employer''s name is used');
select pg_temp.claims(:ucy);
select app.my_match_card(:c1) as cc \gset
select pg_temp.assert((:'cc'::jsonb ->> 'employer') = 'Unknown Co 922' and (:'cc'::jsonb -> 'program') = 'null'::jsonb and (:'cc'::jsonb -> 'process') = 'null'::jsonb
                      and (:'cc'::jsonb -> 'gifts') = '[]'::jsonb,
  'B · an employer the directory does not have: no steps, no gifts to report');
select pg_temp.claims(:udee);
select pg_temp.assert((app.my_match_card(:c1) -> 'program') = 'null'::jsonb, 'B · two entries with the same name (two countries) show nothing rather than guess');
select pg_temp.claims(:ukit);
select app.my_match_card(:c1) as ck \gset
select pg_temp.assert((:'ck'::jsonb ->> 'is_adult') = 'false' and (:'ck'::jsonb -> 'claims') = '[]'::jsonb and (:'ck'::jsonb -> 'program') = 'null'::jsonb and (:'ck'::jsonb ->> 'employer') is null,
  'B · a child''s sign-in gets nothing');
select pg_temp.assert_raises(format('select app.report_my_match_request(%L)', :c1), 'adults only', 'B · and cannot report');
select pg_temp.claims(:uother);
select pg_temp.assert_raises(format('select app.my_match_card(%L)', :c1), 'not linked to a person', 'B · a sign-in with no person in this community is told so');
reset role;

-- An employer another sign-in consented to is not shown to this one (0759).
update app.person_match_employers set consented_by_user = :uother where person_id = :pb;
set role authenticated;
select pg_temp.claims(:ubo);
select app.my_match_card(:c1) as cb2 \gset
select pg_temp.assert((:'cb2'::jsonb ->> 'employer') is null and (:'cb2'::jsonb -> 'claims') = '[]'::jsonb and (:'cb2'::jsonb -> 'program') = 'null'::jsonb,
  'B · an employer another sign-in consented to (or a paper form) is not shown to this sign-in, nor its claims');
reset role;
update app.person_match_employers set consented_by_user = :ubo where person_id = :pb;

-- ══ C. "I have asked my employer" ════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:uana);
select app.report_my_match_request(:c1) as r1 \gset
select pg_temp.assert((:'r1'::jsonb ->> 'requested') = '2'
                      and (select count(*) from pg_temp.mc() where person_id = :pa and state = 'requested' and requested_by_member_at is not null) = 2
                      and (select count(*) from pg_temp.mc() where person_id = :pa) = 2,
  'C · Ana''s two gifts become requested claims, marked as reported by the member');
reset role;
select pg_temp.assert((select count(*) from pg_temp.mc() where person_id = :pa and created_by = :uana and state_by = :uana) = 2, 'C · by her own sign-in');
set role authenticated;
select pg_temp.claims(:uana);
select pg_temp.assert_raises(format('select app.report_my_match_request(%L)', :c1), 'no gift that can still be claimed', 'C · a second tap finds nothing left to report');
select app.my_match_card(:c1) as ca2 \gset
select pg_temp.assert(jsonb_array_length(:'ca2'::jsonb -> 'claims') = 2 and (:'ca2'::jsonb -> 'gifts') = '[]'::jsonb
                      and (:'ca2'::jsonb -> 'claims' -> 0 ->> 'state') = 'requested' and (:'ca2'::jsonb -> 'claims' -> 0 ->> 'reported_by_member') = 'true'
                      and (:'ca2'::jsonb -> 'claims' -> 0 ->> 'can_undo') = 'true' and (:'ca2'::jsonb -> 'claims' -> 0 ->> 'company_name') = 'Acme922'
                      and not (:'ca2'::jsonb::text ~ '(amount|10000|5000)'),
  'C · her card shows her two requests and where they stand, with no amount');
-- Staff see it came from the member.
select pg_temp.claims(:lead);
select app.match_claims_list(:c1, 'open') as cl \gset
select pg_temp.assert((:'cl'::jsonb ->> 'total') = '2' and (select count(*) from jsonb_array_elements(:'cl'::jsonb -> 'rows') e where e ->> 'requested_by_member_at' is not null) = 2
                      and (:'cl'::jsonb -> 'rows' -> 0 ->> 'state') = 'requested',
  'C · staff see the two requests as reported by the member');
-- Staff move one on: the member can no longer take that one back.
select id as c_ga2 from pg_temp.mc() where payment_id = :ga2 \gset
select app.set_match_claim_state(:c1, :'c_ga2'::uuid, 'verified');
select pg_temp.claims(:uana);
select pg_temp.assert_raises(format('select app.undo_my_match_request(%L, %L)', :c1, :'c_ga2'), 'already moved this on', 'C · once staff move a request on, the member cannot take it back');
select id as c_ga1 from pg_temp.mc() where payment_id = :ga1 \gset
select pg_temp.assert(app.undo_my_match_request(:c1, :'c_ga1'::uuid) and not exists (select 1 from pg_temp.mc() where id = :'c_ga1'::uuid),
  'C · a request the member''s own report created disappears when they take it back');
select app.my_match_card(:c1) as ca3 \gset
select pg_temp.assert(jsonb_array_length(:'ca3'::jsonb -> 'gifts') = 1 and jsonb_array_length(:'ca3'::jsonb -> 'claims') = 1,
  'C · and the gift can be reported again');
-- A claim staff had already asked about goes to requested, and back to asked.
select pg_temp.claims(:lead);
select app.link_match_program(:c1, :pb, :'acme');
select app.record_match_claim(:c1, :pb, :gb1, 'asked');
select pg_temp.claims(:ubo);
select app.report_my_match_request(:c1) as r2 \gset
select pg_temp.assert((:'r2'::jsonb ->> 'requested') = '1' and (select state from pg_temp.mc() where payment_id = :gb1) = 'requested'
                      and (select count(*) from pg_temp.mc() where payment_id = :gb1) = 1,
  'C · a gift staff had marked asked becomes requested (the same claim)');
select id as c_gb1 from pg_temp.mc() where payment_id = :gb1 \gset
select pg_temp.assert(app.undo_my_match_request(:c1, :'c_gb1'::uuid) and (select state from pg_temp.mc() where id = :'c_gb1'::uuid) = 'asked'
                      and (select requested_by_member_at from pg_temp.mc() where id = :'c_gb1'::uuid) is null,
  'C · taking it back returns it to asked: staff''s claim stays');
select pg_temp.claims(:ucy);
select pg_temp.assert_raises(format('select app.report_my_match_request(%L)', :c1), 'do not have the steps for your employer', 'C · no directory entry for the employer: nothing to report, said in words');
reset role;

-- ══ D. Own data only ═════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:ubo);
select pg_temp.assert_raises(format('select app.undo_my_match_request(%L, %L)', :c1, :'c_ga2'), 'not found', 'D · Bo cannot take back Ana''s request');
select pg_temp.assert((select count(*) from app.match_claims) = 0 and (select count(*) from app.person_match_employers) = 1
                      and (select person_id from app.person_match_employers) = :pb,
  'D · a member reads no claim directly, and of the employer records only their own (0759)');
select pg_temp.claims(:plat);
select app.my_match_card(:c1) as cp \gset
select pg_temp.assert((:'cp'::jsonb ->> 'employer') is null and (:'cp'::jsonb -> 'claims') = '[]'::jsonb and (:'cp'::jsonb -> 'gifts') = '[]'::jsonb
                      and (select count(*) from app.match_claims) = 0 and (select count(*) from app.person_match_employers) = 0,
  'D · a platform admin is a member like any other: their own (empty) card, no claim and no employer of anyone else');
select pg_temp.assert_raises(format('select app.match_claims_list(%L)', :c1), 'don''t have access', 'D · and no staff read');
reset role;

-- CatchTheMatch off: the card says so and nothing else; no report.
delete from app.center_module_grants where center_id = :c1 and module_key = 'matching';
set role authenticated;
select pg_temp.claims(:uana);
select app.my_match_card(:c1) as coff \gset
select pg_temp.assert((:'coff'::jsonb ->> 'matching_on') = 'false' and (:'coff'::jsonb -> 'claims') = '[]'::jsonb and (:'coff'::jsonb -> 'program') = 'null'::jsonb,
  'D · with CatchTheMatch off the card shows nothing but that it is off');
select pg_temp.assert_raises(format('select app.report_my_match_request(%L)', :c1), 'not on for this community', 'D · and a member cannot report');
reset role;
rollback;
