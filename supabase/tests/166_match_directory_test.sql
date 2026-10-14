-- 0765-0767: CatchTheMatch slice 2 (docs/CATCH_THE_MATCH.md sections 6, 7 and 9): the shared employer-program directory,
-- what members know sent as submissions and checked, and an employer on file linked to its program by staff.
--   A. The shape: the directory starts empty; RLS on every table, nobody writes them directly; the directory, its versions
--      and Weaver's switch belong to the platform, the submissions and links to CatchTheMatch, with a module switch and a
--      private audit; definer functions with the pinned search path; the helpers are private.
--   B. The name key: the same on any locale (case folding written out, ß, final sigma, dotted I), compatibility forms,
--      accents, every script's spaces, punctuation, symbols, currency signs, emoji and invisible characters; letters of every
--      script kept.
--   C. Weaver's team writes the directory (a reason; every rule in plain English; one entry per name and country, retired
--      entries included); old names are kept as retired aliases; every write is a version; the history names Weaver's team
--      and belongs to no community.
--   D. Who reads it: Weaver's team and the organization's own CatchTheMatch readers of a community where it is on; not other
--      staff, not a community where it is off, not anon. Search by any name in any script, part of a name from 3 characters,
--      retired aliases and retired entries not found by default.
--   E. Submissions: who sends; the community's own readers read them, not Weaver's filing grant; Weaver's team sees the facts
--      and the community's name, never the person; a community's manager publishes at once only a new company or a change to
--      an entry it verified itself, and everything else goes to Weaver's team (Weaver's check, another community's, links,
--      near-duplicates, names in use, retired entries, publishing paused); the daily cap; partner is Weaver's; reject with a
--      reason; duplicates; what Weaver's team checks afterwards.
--   F. Versions: Weaver's team lists them and reverts an entry in one step.
--   G. Links: candidates by name (Weaver's checks first), staff confirm (matching.manage), readers (not the filing grant), the
--      queue; "changed since you confirmed it"; a changed or withdrawn employer, or a birth date that makes the person a
--      child, drops or hides the link; merged entries are followed; retired ones cannot be chosen; reads logged.
--   H. CatchTheMatch off for a community: its people read none of it; the others and Weaver's team still read the directory.
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
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '', true);
end $$;
create or replace function pg_temp.no_claims() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;
-- The status (and why) a decision came back with.
create or replace function pg_temp.decided(r jsonb) returns text language sql as $$
  select (r->>'status') || coalesce(':' || (r->>'because'), '')
$$;

\set c1 '''16600000-0000-4000-8000-0000000000c1'''
\set c2 '''16600000-0000-4000-8000-0000000000c2'''
\set c3 '''16600000-0000-4000-8000-0000000000c3'''
\set weaver '''16600000-0000-4000-8000-000000000001'''
\set lead1 '''16600000-0000-4000-8000-000000000003'''
\set viewer1 '''16600000-0000-4000-8000-000000000004'''
\set treas1 '''16600000-0000-4000-8000-000000000005'''
\set lead2 '''16600000-0000-4000-8000-000000000006'''
\set lead3 '''16600000-0000-4000-8000-000000000007'''
\set pm '''16600000-0000-4000-8000-0000000000a1'''
\set pa '''16600000-0000-4000-8000-0000000000a2'''
\set pk '''16600000-0000-4000-8000-0000000000a3'''
\set pz '''16600000-0000-4000-8000-0000000000a4'''

-- ══ A. The shape ═════════════════════════════════════════════════════════════
select pg_temp.assert((select count(*) from app.match_programs) = 0 and (select count(*) from app.match_program_names) = 0
                      and (select count(*) from app.match_program_versions) = 0
                      and (select count(*) from app.match_program_submissions) = 0 and (select count(*) from app.person_match_programs) = 0,
  'A · the directory starts empty (owner, 2026-10-13: Weaver''s team adds entries from the employers'' own pages)');
select pg_temp.assert((select bool_and(c.relrowsecurity) and count(*) = 6 from pg_class c
                        where c.oid in ('app.match_programs'::regclass, 'app.match_program_names'::regclass,
                                        'app.match_program_versions'::regclass, 'app.match_publishing_controls'::regclass,
                                        'app.match_program_submissions'::regclass, 'app.person_match_programs'::regclass))
                      and not has_table_privilege('authenticated', 'app.match_programs', 'insert')
                      and not has_table_privilege('authenticated', 'app.match_programs', 'update')
                      and not has_table_privilege('authenticated', 'app.match_program_names', 'insert')
                      and not has_table_privilege('authenticated', 'app.match_program_versions', 'insert')
                      and not has_table_privilege('authenticated', 'app.match_publishing_controls', 'insert')
                      and not has_table_privilege('authenticated', 'app.match_program_submissions', 'insert')
                      and not has_table_privilege('authenticated', 'app.match_program_submissions', 'update')
                      and not has_table_privilege('authenticated', 'app.person_match_programs', 'insert')
                      and not has_table_privilege('anon', 'app.match_programs', 'select')
                      and has_table_privilege('authenticated', 'app.match_programs', 'select'),
  'A · the six tables have RLS and nobody writes them directly; anon reads nothing');
select pg_temp.assert((select array_agg(table_name || '=' || coalesce(module_key, 'core') order by table_name collate "C") from app.module_tables
                        where table_name in ('match_programs', 'match_program_names', 'match_program_versions', 'match_publishing_controls',
                                             'match_program_submissions', 'person_match_programs'))
                        = array['match_program_names=core', 'match_program_submissions=matching', 'match_program_versions=core',
                                'match_programs=core', 'match_publishing_controls=core', 'person_match_programs=matching'],
  'A · the directory, its versions and Weaver''s switch are the platform''s; the submissions and the links are CatchTheMatch''s, the organization''s own');
select pg_temp.assert((select count(*) from pg_policy p
                        where p.polname = 'module_switch' and not p.polpermissive
                          and p.polrelid in ('app.match_program_submissions'::regclass, 'app.person_match_programs'::regclass)
                          and position('''matching''' in pg_get_expr(p.polqual, p.polrelid)) > 0
                          and position('is_platform_admin' in pg_get_expr(p.polqual, p.polrelid)) = 0) = 2
                      and not exists (select 1 from pg_policy p
                                       where p.polrelid in ('app.match_program_submissions'::regclass, 'app.person_match_programs'::regclass)
                                         and (position('is_platform_admin' in coalesce(pg_get_expr(p.polqual, p.polrelid), '')) > 0
                                              or position('has_permission' in coalesce(pg_get_expr(p.polqual, p.polrelid), '')) > 0
                                              or position('matching_readable_centers' in coalesce(pg_get_expr(p.polqual, p.polrelid), '')) > 0)),
  'A · the organization''s two tables switch off with CatchTheMatch, and no policy of theirs lets a platform admin or Weaver''s filing grant through');
select pg_temp.assert((select count(*) from pg_trigger t where not t.tgisinternal and t.tgfoid = 'app.audit_shared_row'::regproc
                        and t.tgrelid in ('app.match_programs'::regclass, 'app.match_program_names'::regclass, 'app.match_program_versions'::regclass)) = 3
                      and (select count(*) from pg_trigger t where not t.tgisinternal and t.tgfoid = 'app.audit_private_row'::regproc
                            and t.tgrelid in ('app.match_program_submissions'::regclass, 'app.person_match_programs'::regclass)) = 2,
  'A · the directory''s history is app.audit_shared_row; the submissions and links have the private audit (0758)');
select pg_temp.assert((select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=app, public, extensions%')
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname in ('save_match_program', 'set_match_program_retired', 'merge_match_programs',
                              'revert_match_program', 'platform_match_program_versions', 'match_program_search', 'match_directory_can_read',
                              'matching_org_readable_centers', '_matching_org_can', 'audit_shared_row', '_match_program_write', '_match_find',
                              '_match_name_clash', '_match_name_used', '_match_near_weaver', '_match_program_facts', '_match_snapshot',
                              '_assert_weaver', 'match_programs_tidy', 'match_program_names_key', 'submit_match_program',
                              'decide_match_submission', 'platform_match_submissions', 'platform_match_recent_publishes',
                              'platform_match_communities', 'match_publishing_state', 'set_match_publishing', 'match_publishing_cap',
                              '_match_published_today', '_match_program_current', 'match_program_candidates', 'link_match_program',
                              'unlink_match_program', 'match_employers_queue', 'match_employer_changed_unlinks', 'person_match_programs_check',
                              'match_link_readable', '_match_org_reader_or_raise', '_match_entry_brief', '_match_link_card', '_match_candidates'))
                      and (select bool_and(array_to_string(p.proconfig, ',') like '%search_path=app, public, extensions%')
                             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname = 'app' and p.proname in ('employer_name_key', '_mj_text', '_mj_int', '_mj_bool', '_mj_choice',
                                  '_mj_list', '_mj_https', '_mj_array', '_match_keys', '_match_same_country', '_match_program_clean',
                                  'match_portals', 'match_gift_types')),
  'A · every function of 0765-0767 pins the search path; those that read or write run as the definer');
select pg_temp.assert((select prosrc ilike '%for update%' and prosrc ilike '%pg_advisory_xact_lock%' from pg_proc
                        where oid = 'app.decide_match_submission(uuid, text, jsonb, text, uuid, uuid)'::regprocedure)
                      and (select prosrc not ilike '%lower(%' and prosrc not ilike '%collate%' from pg_proc where oid = 'app.employer_name_key(text)'::regprocedure),
  'A · an approval locks the entry it changes and counts the daily cap under a lock; the name key uses no lower() and no collation');
select pg_temp.assert(not has_function_privilege('authenticated', 'app._match_program_write(uuid, jsonb, text, date, uuid, uuid, text)', 'execute')
                      and not has_function_privilege('authenticated', 'app._match_program_clean(jsonb, text)', 'execute')
                      and not has_function_privilege('authenticated', 'app._match_find(text)', 'execute')
                      and not has_function_privilege('authenticated', 'app._match_candidates(text, int)', 'execute')
                      and not has_function_privilege('authenticated', 'app._matching_org_can(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.audit_shared_row()', 'execute')
                      and has_function_privilege('authenticated', 'app.match_program_search(text, text, int, int)', 'execute')
                      and not has_function_privilege('anon', 'app.match_program_search(text, text, int, int)', 'execute')
                      and has_function_privilege('authenticated', 'app.decide_match_submission(uuid, text, jsonb, text, uuid, uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.submit_match_program(uuid, uuid, jsonb, text)', 'execute')
                      and has_function_privilege('authenticated', 'app.link_match_program(uuid, uuid, uuid)', 'execute'),
  'A · the helpers are private; the reads and commands are for signed-in callers only');

-- ══ B. The name key ══════════════════════════════════════════════════════════
select pg_temp.assert(app.employer_name_key('ＡＣＭＥ Corp.') = 'acmecorp' and app.employer_name_key('acme corp') = 'acmecorp'
                      and app.employer_name_key('ACME-CORP') = 'acmecorp' and app.employer_name_key('  A.C.M.E   Corp ') = 'acmecorp',
  'B · full-width letters, case, spaces and punctuation do not change the key');
select pg_temp.assert(app.employer_name_key('Société Générale') = 'societegenerale' and app.employer_name_key('NESTLÉ') = 'nestle'
                      and app.employer_name_key('ÉCOLE') = app.employer_name_key('école'),
  'B · accents are dropped, capitals folded, precomposed or not');
select pg_temp.assert(app.employer_name_key('Straße') = 'strasse' and app.employer_name_key('STRASSE') = 'strasse'
                      and app.employer_name_key('ΟΔΟΣ') = app.employer_name_key('οδος')
                      and app.employer_name_key('İSTANBUL') = 'istanbul',
  'B · case folding written out: ß is ss, a final sigma is a sigma, a dotted capital I is i (whatever the database locale)');
select pg_temp.assert(app.employer_name_key('ГАЗПРОМ') = app.employer_name_key('газпром') and app.employer_name_key('Газпром') = 'газпром',
  'B · Cyrillic is kept, folded');
select pg_temp.assert(app.employer_name_key(U&'\FEFFAcme') = 'acme' and app.employer_name_key(U&'Acme \+01F680') = 'acme'
                      and app.employer_name_key('Acme $ €') = 'acme' and app.employer_name_key(U&'Acme\2122') = 'acme'
                      and app.employer_name_key('Acme®') = 'acme' and app.employer_name_key(U&'Acme\200D') = 'acme',
  'B · invisible characters, emoji, currency signs, symbols and the trademark sign are dropped');
select pg_temp.assert(app.employer_name_key('株式会社 日立製作所') = '株式会社日立製作所'
                      and strpos(app.employer_name_key('株式会社 日立製作所'), app.employer_name_key('日立製作所')) > 0
                      and app.employer_name_key('日立製作所。') = '日立製作所',
  'B · Han is kept as it is (no word dropped), CJK punctuation goes, so the shorter name is found inside the longer');
select pg_temp.assert(app.employer_name_key('टाटा कंसल्टेंसी') = app.employer_name_key('टाटा  कंसल्टेंसी!')
                      and app.employer_name_key('टाटा कंसल्टेंसी') like 'टाटा%' and app.employer_name_key('टाटा कंसल्टेंसी') <> 'tata'
                      and app.employer_name_key('أرامكو السعودية') = app.employer_name_key('أرامكو  السعودية،')
                      and app.employer_name_key('أرامكو السعودية') is not null,
  'B · Devanagari and Arabic letters and marks are kept; their spaces and punctuation go');
select pg_temp.assert(app.employer_name_key('!!! ...') is null and app.employer_name_key(null) is null and app.employer_name_key('') is null
                      and app.employer_name_key(U&'\+01F680') is null,
  'B · a name with no letter or digit has no key');

-- ══ Fixtures ═════════════════════════════════════════════════════════════════
insert into auth.users (id, email) values
  (:weaver, 'weaver166@weaver.test'), (:lead1, 'lead166@c1.test'), (:viewer1, 'viewer166@c1.test'), (:treas1, 'treas166@c1.test'),
  (:lead2, 'lead166@c2.test'), (:lead3, 'lead166@c3.test');
insert into app.accounts (user_id, is_platform_admin) values (:weaver, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:c1, 'mt166a', 'Matching Temple 166', 'M166', 'TX', 'active', 'America/Chicago'),
  (:c2, 'mt166b', 'Second Community 166', 'S166', 'TX', 'active', 'America/Chicago'),
  (:c3, 'mt166c', 'Third Community 166', 'T166', 'TX', 'active', 'America/Chicago');
-- Weaver grants CatchTheMatch to the first two only (0740's table; every kind starts it off, 0750).
insert into app.center_module_grants (center_id, module_key, granted, reason) values
  (:c1, 'matching', true, 'Test 166'), (:c2, 'matching', true, 'Test 166');
-- A role with matching.view only (only a migration or a job without an API role may make one: 0757's guard).
insert into app.roles (key, tier, name, default_scope, description, permissions) values
  ('matching_viewer166', 'center', 'Matching viewer 166', 'center', 'Test 166: matching.view only', '["matching.view"]');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:c1, :lead1, 'matching_lead', 'center', 'Test 166'), (:c1, :viewer1, 'matching_viewer166', 'center', 'Test 166'),
  (:c1, :treas1, 'treasurer', 'center', 'Test 166'), (:c2, :lead2, 'matching_lead', 'center', 'Test 166'),
  (:c3, :lead3, 'matching_lead', 'center', 'Test 166');
-- The first community gave a Weaver team member filing access (0758: for claims, slice 3).
insert into app.matching_filing_grants (center_id, grantee_user_id, granted_by, ends_at, reason) values
  (:c1, :weaver, :lead1, now() + interval '30 days', 'Test 166: filing for claims');
insert into app.people (id, center_id, first_name, last_name, date_of_birth, employer) values
  (:pm, :c1, 'Mia', 'Match166', date '1985-04-01', 'ACME Corporation'),
  (:pa, :c1, 'Aki', 'Match166', date '1980-01-01', null),
  (:pk, :c1, 'Kit', 'Match166', (current_date - interval '10 years')::date, null),
  (:pz, :c1, 'Zoe', 'Match166', date '1990-01-01', null);
-- The office records three adults' employers from signed paper forms (0759).
set role authenticated;
select pg_temp.claims(:lead1);
select app.record_match_employer(:c1, :pm, 'ACME Corporation');
select app.record_match_employer(:c1, :pa, '株式会社 日立製作所');
select app.record_match_employer(:c1, :pz, 'Zeta Widgets');
select pg_temp.claims(:weaver);
select pg_temp.assert(app.matching_can(:c1, 'view') and not app.matching_can(:c1, 'manage'),
  'Fixtures · the Weaver team member''s filing grant is live (CatchTheMatch view in the first community)');
reset role;

-- ══ C. Weaver's team writes the directory ════════════════════════════════════
set role authenticated;
select pg_temp.claims(:weaver);
select app.save_match_program(null,
  '{"company_name": "Acme", "names": ["ACME Corp", "アクメ", "acme"], "country": "us", "match_ratio_bp": 10000, "min_gift_cents": 2500,
    "max_gift_cents": 500000, "max_year_cents": 1000000, "gift_types": ["recurring", "one_time", "one_time"], "org_kinds": ["any_charity"],
    "religious_orgs": "non_worship_only", "eligibility_note": "Places of worship qualify for their food bank and classes only.",
    "portal": "benevity", "portal_url": "https://acme.benevity.example/match", "deadline_kind": "date_next_year",
    "deadline_month": 1, "deadline_day": 31, "deadline_months": 7, "source": "employer_site",
    "source_url": "https://acme.example/giving"}'::jsonb || jsonb_build_object('verified_on', (current_date - 12)::text),
  'Test 166: from Acme''s giving page') as acme \gset
select app.save_match_program(null,
  '{"company_name": "日立製作所", "names": ["Hitachi"], "country": "JP", "match_ratio_bp": 10000, "religious_orgs": "excluded",
    "portal": "employer_form", "source": "employer_document"}'::jsonb, 'Test 166: from the employee handbook') as hitachi \gset
select app.save_match_program(null,
  '{"company_name": "Globex", "gift_match": false, "volunteer_grant": true, "match_ratio_bp": 20000, "gift_types": ["stock"],
    "volunteer_cents_per_hour": 1000, "volunteer_min_hours": 10, "source": "portal_listing"}'::jsonb, 'Test 166: volunteer grants only') as globex \gset
select app.save_match_program(null, '{"company_name": "Acme", "country": "IN", "match_ratio_bp": 5000, "source": "partner"}'::jsonb,
  'Test 166: the Indian program, from a licensed database') as acmein \gset
select pg_temp.assert((select country = 'US' and match_ratio_bp = 10000 and currency = 'USD' and min_gift_cents = 2500
                              and gift_types = array['one_time', 'recurring'] and religious_orgs = 'non_worship_only'
                              and deadline_kind = 'date_next_year' and deadline_month = 1 and deadline_day = 31 and deadline_months is null
                              and last_verified_on = current_date - 12 and verified_by_kind = 'weaver' and verified_submission_id is null
                              and status = 'active' and version = 1
                         from app.match_programs where id = :'acme')
                      and (select count(*) = 3 and count(*) filter (where is_primary) = 1
                                  and bool_or(is_primary and name = 'Acme') and bool_or(name = 'アクメ')
                             from app.match_program_names where program_id = :'acme')
                      and (select count(*) = 1 and bool_and(version = 1 and written_kind = 'weaver' and written_center_id is null
                                                            and facts->>'company_name' = 'Acme' and note = 'Test 166: from Acme''s giving page')
                             from app.match_program_versions where program_id = :'acme'),
  'C · an entry with its facts (the country upper-cased, each gift kind once, the deadline''s unused number dropped), checked by Weaver''s team on the date given, its names, and its first version');
select pg_temp.assert((select last_verified_on = current_date and verified_by_kind = 'weaver' from app.match_programs where id = :'hitachi')
                      and (select gift_match = false and volunteer_grant and match_ratio_bp is null and gift_types = '{}'
                                  and volunteer_cents_per_hour = 1000 and volunteer_min_hours = 10
                             from app.match_programs where id = :'globex')
                      and (select country = 'IN' and source = 'partner' from app.match_programs where id = :'acmein'),
  'C · checked today when no date is given; a volunteer-only program drops the gift rules sent with it; the same name for another country is a separate entry; Weaver''s team may name a licensed database');
select pg_temp.assert_raises($$select app.save_match_program(null, '{"company_name": "ACME corp.", "country": "US", "source": "other"}'::jsonb, 'x')$$,
  '"Acme" is already in the directory for US', 'C · one entry per name and country: the same name in another spelling is refused');
select pg_temp.assert_raises($$select app.save_match_program(null, '{"company_name": "Acme Holdings", "names": ["acme"], "source": "other"}'::jsonb, 'x')$$,
  'is already in the directory', 'C · so is another name of an entry, and a name with no country clashes with every country');
select pg_temp.assert_raises($$select app.save_match_program(null, '{"source": "employer_site"}'::jsonb, 'x')$$,
  'Enter the company''s name', 'C · the company''s name is needed');
select pg_temp.assert_raises($$select app.save_match_program(null, '{"company_name": "X166"}'::jsonb, 'x')$$,
  'Say where the facts come from', 'C · Weaver''s team says where the facts come from');
select pg_temp.assert_raises($$select app.save_match_program(null, '{"company_name": "X166", "source": "other", "portal": "paypal"}'::jsonb, 'x')$$,
  'Unknown portal "paypal"', 'C · a portal from the list');
select pg_temp.assert_raises($$select app.save_match_program(null, '{"company_name": "X166", "source": "other", "portal_url": "http://x.example"}'::jsonb, 'x')$$,
  'must be a full web address that starts with https://', 'C · links start with https://');
select pg_temp.assert_raises($$select app.save_match_program(null, '{"company_name": "X166", "source": "other", "min_gift_cents": 5000, "max_gift_cents": 100}'::jsonb, 'x')$$,
  'The minimum gift is more than the maximum', 'C · the minimum is not above the maximum');
select pg_temp.assert_raises($$select app.save_match_program(null, '{"company_name": "X166", "source": "other", "min_gift_cents": 12.5}'::jsonb, 'x')$$,
  'must be a whole number', 'C · money is whole cents');
select pg_temp.assert_raises($$select app.save_match_program(null, '{"company_name": "X166", "source": "other", "gift_types": ["crypto"]}'::jsonb, 'x')$$,
  'Unknown kind of gift "crypto"', 'C · kinds of gift from the list');
select pg_temp.assert_raises($$select app.save_match_program(null, '{"company_name": "X166", "source": "other", "deadline_kind": "date_next_year", "deadline_month": 2, "deadline_day": 30}'::jsonb, 'x')$$,
  'is not a real date', 'C · a deadline on a real date');
select pg_temp.assert_raises($$select app.save_match_program(null, '{"company_name": "X166", "source": "other", "deadline_kind": "months_after_gift"}'::jsonb, 'x')$$,
  'Say how many months after the gift', 'C · a deadline in months says how many');
select pg_temp.assert_raises($$select app.save_match_program(null, '{"company_name": "X166", "source": "other", "gift_match": false}'::jsonb, 'x')$$,
  'Say what the program does', 'C · it matches gifts, pays volunteer grants, or both');
select pg_temp.assert_raises($$select app.save_match_program(null, '{"company_name": "X166", "source": "other", "country": "USA"}'::jsonb, 'x')$$,
  'two-letter code', 'C · the country is a two-letter code');
select pg_temp.assert_raises(format($$select app.save_match_program(null, %L::jsonb, 'x')$$,
    jsonb_build_object('company_name', 'X166', 'source', 'other', 'verified_on', (current_date + 1)::text)),
  'today or earlier', 'C · it cannot have been checked tomorrow');
select pg_temp.assert_raises($$select app.save_match_program(null, '{"company_name": "X166", "source": "other"}'::jsonb, '  ')$$,
  'Say what changed and why', 'C · every change has a reason');
select pg_temp.assert_raises($$select app.save_match_program(null, '{"company_name": "!!!", "source": "other"}'::jsonb, 'x')$$,
  'needs at least one letter or digit', 'C · a name needs a letter or digit');
select pg_temp.assert_raises($$insert into app.match_programs (company_name, source) values ('Direct166', 'other')$$,
  'permission denied', 'C · not even Weaver''s team writes the table directly');
-- A change: a name no longer given is kept, retired; the facts change; it is the next version.
select app.save_match_program(:'acme',
  '{"company_name": "Acme", "names": ["ACME Corp"], "country": "US", "match_ratio_bp": 10000, "min_gift_cents": 2500,
    "max_gift_cents": 500000, "max_year_cents": 1000000, "gift_types": ["one_time", "recurring"], "org_kinds": ["any_charity"],
    "religious_orgs": "non_worship_only", "portal": "benevity", "portal_url": "https://acme.benevity.example/match",
    "deadline_kind": "date_next_year", "deadline_month": 1, "deadline_day": 31, "source": "employer_site",
    "source_url": "https://acme.example/giving"}'::jsonb,
  'Test 166: the Japanese name was a mistake');
select pg_temp.assert((select array_agg(name order by name collate "C") from app.match_program_names where program_id = :'acme' and retired_at is null)
                        = array['ACME Corp', 'Acme']
                      and (select retired_at is not null and not is_primary from app.match_program_names where program_id = :'acme' and name = 'アクメ')
                      and (select last_verified_on = current_date and version = 2 from app.match_programs where id = :'acme')
                      and (select count(*) from app.match_program_versions where program_id = :'acme') = 2,
  'C · a change keeps the dropped name as a retired alias (never deleted), records the day it was checked, and is version 2');
select pg_temp.assert((select count(*) >= 2 and bool_and(actor_user_id = :weaver and center_id is null and module is null
                                                         and reason like 'Weaver''s team: Test 166%')
                         from app.audit_log where record_table = 'match_programs' and record_id = :'acme'),
  'C · Weaver''s team reads the directory''s history: no community, no module, Weaver''s team named, with the reason');
-- An ended program's name is not added again.
select app.set_match_program_retired(:'globex', true, 'Test 166: the program ended');
select pg_temp.assert_raises($$select app.save_match_program(null, '{"company_name": "GLOBEX", "volunteer_grant": true, "gift_match": false, "source": "other"}'::jsonb, 'x')$$,
  'is in the directory as an ended program', 'C · a retired entry''s name cannot be added again: bring it back instead');
select app.set_match_program_retired(:'globex', false, 'Test 166: it is running again');
reset role;

set role authenticated;
select pg_temp.claims(:lead1);
select pg_temp.assert_raises($$select app.save_match_program(null, '{"company_name": "Lead166", "source": "other"}'::jsonb, 'x')$$,
  'Only Weaver''s team can', 'C · a community''s CatchTheMatch manager does not write the directory directly');
select pg_temp.assert_raises(format($$select app.set_match_program_retired(%L, true, 'x')$$, :'acme'),
  'Only Weaver''s team can', 'C · nor retire an entry');
select pg_temp.assert_raises(format($$select app.merge_match_programs(%L, %L, 'x')$$, :'acme', :'acmein'),
  'Only Weaver''s team can', 'C · nor merge entries');
select pg_temp.assert_raises(format($$select app.revert_match_program(%L, 1, 'x')$$, :'acme'),
  'Only Weaver''s team can', 'C · nor revert one');
select pg_temp.assert((select count(*) from app.audit_log where record_table in ('match_programs', 'match_program_names', 'match_program_versions')) = 0
                      and (select count(*) from app.match_program_versions) = 0,
  'C · the directory''s history and versions are Weaver''s: a community''s staff read neither');
reset role;

-- ══ D. Who reads it ══════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:weaver);
select pg_temp.assert((select count(*) from app.match_programs) = 4 and app.match_directory_can_read(), 'D · Weaver''s team reads the directory');
select pg_temp.claims(:lead1);
select pg_temp.assert((select count(*) from app.match_programs) = 4 and (select count(*) from app.match_program_names) = 7,
  'D · a CatchTheMatch manager of a community where it is on reads every entry and name (the retired alias too)');
select pg_temp.claims(:viewer1);
select pg_temp.assert((select count(*) from app.match_programs) = 4, 'D · so does a matching.view holder');
select pg_temp.claims(:lead2);
select pg_temp.assert((select count(*) from app.match_programs) = 4, 'D · and the readers of another community: the directory is shared');
select pg_temp.claims(:treas1);
select pg_temp.assert((select count(*) from app.match_programs) = 0 and (select count(*) from app.match_program_names) = 0
                      and not app.match_directory_can_read(),
  'D · a treasurer without a CatchTheMatch role reads nothing');
select pg_temp.assert_raises($$select app.match_program_search('acme')$$, 'You don''t have access to this area', 'D · and cannot search it');
select pg_temp.claims(:lead3);
select pg_temp.assert((select count(*) from app.match_programs) = 0, 'D · a CatchTheMatch manager of a community where it is off reads nothing');
reset role;
set role anon;
select pg_temp.no_claims();
select pg_temp.assert_raises($$select count(*) from app.match_programs$$, 'permission denied', 'D · anon reads nothing');
reset role;

set role authenticated;
select pg_temp.claims(:lead1);
select pg_temp.assert((app.match_program_search('acme corp')->>'total')::int = 2
                      and app.match_program_search('acme corp')->'rows'->0->>'id' = :'acme'
                      and app.match_program_search('acme corp')->'rows'->0->>'how' = 'same_name'
                      and app.match_program_search('acme corp')->'rows'->0->>'matched_name' = 'ACME Corp'
                      and app.match_program_search('acme corp')->'rows'->1->>'how' = 'part_of_name',
  'D · search: the entry with that very name first, then the one whose name is part of it');
select pg_temp.assert(app.match_program_search('ＡＣＭＥ  CORP.')->'rows'->0->>'id' = :'acme',
  'D · in full-width capitals with punctuation too');
select pg_temp.assert(app.match_program_search('株式会社日立製作所')->'rows'->0->>'id' = :'hitachi'
                      and app.match_program_search('HITACHI')->'rows'->0->>'how' = 'same_name',
  'D · in any script, by any of its names, the longer or the shorter');
select pg_temp.assert((app.match_program_search('日立')->>'total')::int = 0 and (app.match_program_search('ac')->>'total')::int = 0,
  'D · part of a name counts from 3 characters only');
select pg_temp.assert((app.match_program_search('アクメ')->>'total')::int = 0,
  'D · a retired alias is not found');
select pg_temp.assert((app.match_program_search(null)->>'total')::int = 4
                      and app.match_program_search(null)->'rows'->0->>'company_name' = 'Acme'
                      and (app.match_program_search('zzz166')->>'total')::int = 0,
  'D · no query lists the directory by name; a name nothing has finds nothing');
reset role;
set role authenticated;
select pg_temp.claims(:weaver);
select app.set_match_program_retired(:'globex', true, 'Test 166: the program ended again');
select pg_temp.assert((app.match_program_search(null)->>'total')::int = 3 and (app.match_program_search(null, 'retired')->>'total')::int = 1
                      and (app.match_program_search(null, 'all')->>'total')::int = 4
                      and (select status = 'retired' and status_reason = 'Test 166: the program ended again' from app.match_programs where id = :'globex'),
  'D · a retired entry is listed only when asked for');
select pg_temp.assert_raises(format($$select app.save_match_program(%L, '{"company_name": "Globex", "volunteer_grant": true, "gift_match": false, "source": "other"}'::jsonb, 'x')$$, :'globex'),
  'This entry is retired. Bring it back first', 'D · a retired entry is brought back before it is changed');
reset role;

-- ══ E. Submissions ═══════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:lead1);
select app.submit_match_program(:c1, null,
  '{"company_name": "Initech", "match_ratio_bp": 10000, "max_year_cents": 300000, "portal": "yourcause"}'::jsonb,
  'A member said HR sends the form in January.') as s1 \gset
select pg_temp.claims(:viewer1);
select app.submit_match_program(:c1, :'acme', '{"company_name": "Acme", "names": ["ACME Corp"], "country": "US", "match_ratio_bp": 20000,
  "portal_url": "https://acme.benevity.example/match", "source_url": "https://acme.example/giving", "source": "employer_site"}'::jsonb) as s2 \gset
select pg_temp.assert((select status = 'pending' and source_ok and submitted_by = :viewer1 and program_id = :'acme' and channel = 'portal'
                         from (select s.*, s.proposal->>'source' = 'employer_site' as source_ok from app.match_program_submissions s where id = :'s2') x)
                      and (select proposal->>'source' = 'submission' and note = 'A member said HR sends the form in January.'
                             from app.match_program_submissions where id = :'s1'),
  'E · a matching.view holder sends too; the facts are kept in the directory''s shape (source "submission" when none is given)');
select pg_temp.assert_raises(format($$select app.submit_match_program(%L, null, '{"source": "other"}'::jsonb)$$, :c1),
  'Enter the company''s name', 'E · a submission names the company');
select pg_temp.claims(:lead1);
select pg_temp.assert_raises(format($$select app.submit_match_program(%L, null, '{"company_name": "Partner166", "source": "partner"}'::jsonb)$$, :c1),
  'Only Weaver''s team can name a licensed matching-gift database', 'E · only Weaver''s team may name a licensed database as the source');
select pg_temp.claims(:treas1);
select pg_temp.assert_raises(format($$select app.submit_match_program(%L, null, '{"company_name": "T166"}'::jsonb)$$, :c1),
  'needs a CatchTheMatch role', 'E · staff without a CatchTheMatch role cannot send one');
select pg_temp.claims(:weaver);
select pg_temp.assert_raises(format($$select app.submit_match_program(%L, null, '{"company_name": "W166"}'::jsonb)$$, :c1),
  'needs a CatchTheMatch role', 'E · nor can Weaver''s team, even with a filing grant there (it edits the directory itself)');
select pg_temp.claims(:lead3);
select pg_temp.assert_raises(format($$select app.submit_match_program(%L, null, '{"company_name": "C3"}'::jsonb)$$, :c3),
  'needs a CatchTheMatch role', 'E · nor a community where CatchTheMatch is off');

-- Who reads them.
select pg_temp.claims(:lead1);
select pg_temp.assert((select count(*) from app.match_program_submissions) = 2, 'E · the community''s CatchTheMatch manager reads its submissions');
select pg_temp.claims(:viewer1);
select pg_temp.assert((select count(*) from app.match_program_submissions) = 2, 'E · so does its matching.view holder');
select pg_temp.claims(:lead2);
select pg_temp.assert((select count(*) from app.match_program_submissions) = 0, 'E · another community reads none of them');
select pg_temp.claims(:treas1);
select pg_temp.assert((select count(*) from app.match_program_submissions) = 0, 'E · nor staff without a CatchTheMatch role');
select pg_temp.claims(:weaver);
select pg_temp.assert((select count(*) from app.match_program_submissions) = 0,
  'E · nor Weaver''s team directly, not even the team member with a filing grant there (the grant is for claims): no submitted_by, forwarded_by or decided_by');
select pg_temp.assert(jsonb_array_length(app.platform_match_submissions('open')) = 2
                      and app.platform_match_submissions('open')->0->>'community' = 'Matching Temple 166'
                      and app.platform_match_submissions('open')->0 ? 'proposal'
                      and position('submitted_by' in app.platform_match_submissions('all')::text) = 0
                      and position('decided_by' in app.platform_match_submissions('all')::text) = 0
                      and position('forwarded_by' in app.platform_match_submissions('all')::text) = 0
                      and position('16600000-0000-4000-8000-000000000003' in app.platform_match_submissions('all')::text) = 0
                      and position('16600000-0000-4000-8000-000000000004' in app.platform_match_submissions('all')::text) = 0,
  'E · Weaver''s team sees the facts and the community''s name through platform_match_submissions, never who sent them');
select pg_temp.claims(:lead1);
select pg_temp.assert_raises($$select app.platform_match_submissions('open')$$, 'Only Weaver''s team can', 'E · a community cannot call it');

-- Deciding.
select pg_temp.claims(:viewer1);
select pg_temp.assert_raises(format($$select app.decide_match_submission(%L, 'approve')$$, :'s1'),
  'needs the CatchTheMatch manager role', 'E · a matching.view holder does not decide');
select pg_temp.claims(:lead2);
select pg_temp.assert_raises(format($$select app.decide_match_submission(%L, 'approve')$$, :'s1'),
  'needs the CatchTheMatch manager role', 'E · nor another community''s manager');
select pg_temp.claims(:lead1);
select pg_temp.assert_raises(format($$select app.decide_match_submission(%L, 'maybe')$$, :'s1'),
  'Unknown decision', 'E · a decision from the list');
-- Approved from a screen (the portal sends its address): the shared history keeps no screen of a community's manager.
select set_config('request.headers', '{"x-client-app":"portal","x-client-screen":"/giving/matching/submissions","user-agent":"TestAgent/166","x-forwarded-for":"203.0.113.66"}', true);
select (app.decide_match_submission(:'s1', 'approve', null, 'Checked with the member''s HR page'))->>'program_id' as initech \gset
select pg_temp.claims(:lead1);
select pg_temp.assert((select status = 'approved' and decided_kind = 'community' and decided_by = :lead1 and result_program_id = :'initech'
                         from app.match_program_submissions where id = :'s1')
                      and (select company_name = 'Initech' and verified_by_kind = 'community' and verified_submission_id = :'s1'
                                  and last_verified_on = current_date and source = 'submission' and max_year_cents = 300000 and version = 1
                             from app.match_programs where id = :'initech'),
  'E · the community''s manager publishes a new company at once, "verified by a community" today');
reset role;
set role authenticated;
select pg_temp.claims(:weaver);
select pg_temp.assert((select count(*) >= 3 and bool_and(actor_user_id is null and ip is null and user_agent is null and correlation_id is null
                                                         and client_screen is null and center_id is null
                                                         and reason like 'Verified by a community (Matching Temple 166): approved a submission%')
                         from app.audit_log where record_table in ('match_programs', 'match_program_names', 'match_program_versions')
                          and (record_id = :'initech' or after->>'program_id' = :'initech'))
                      and (select written_kind = 'community' and written_center_id = :c1 from app.match_program_versions
                            where program_id = :'initech' and version = 1),
  'E · the directory''s history names the community that verified it, never the person (no user, address, browser, request or screen); the version says which community');
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'match_program_submissions') = 0,
  'E · the submissions'' own audit stays in the community: Weaver''s team reads none of it');
select pg_temp.claims(:lead2);
select pg_temp.assert((select verified_by_kind = 'community' from app.match_programs where id = :'initech')
                      and (select count(*) from app.match_program_submissions where id = :'s1') = 0,
  'E · another community sees "verified by a community" but cannot open the submission behind it');
select pg_temp.claims(:lead1);
select pg_temp.assert((select count(*) > 0 and bool_and(module = 'matching' and center_id = :c1)
                         from app.audit_log where record_table = 'match_program_submissions'),
  'E · the community''s manager reads the submissions'' private audit');

-- An entry Weaver's team checked: forwarded to them, with the manager's edits.
select pg_temp.decided(app.decide_match_submission(:'s2', 'approve', null, 'The member showed the 2026 policy')) as s2_status \gset
select pg_temp.assert(:'s2_status' = 'forwarded:weaver_checked'
                      and (select status = 'forwarded' and forwarded_by = :lead1 and forward_note = 'The member showed the 2026 policy'
                                  and forwarded_because = 'weaver_checked' and reviewed->>'match_ratio_bp' = '20000' and decided_at is null
                             from app.match_program_submissions where id = :'s2')
                      and (select match_ratio_bp = 10000 and verified_by_kind = 'weaver' from app.match_programs where id = :'acme'),
  'E · a community does not change an entry Weaver''s team checked: it is forwarded to them, the entry unchanged');
select pg_temp.assert_raises(format($$select app.decide_match_submission(%L, 'approve')$$, :'s2'),
  'is with Weaver''s team', 'E · and the community cannot decide it again');
reset role;
set role authenticated;
select pg_temp.claims(:weaver);
select pg_temp.assert(app.platform_match_submissions('forwarded')->0->>'id' = :'s2'
                      and app.platform_match_submissions('forwarded')->0->>'forward_note' = 'The member showed the 2026 policy'
                      and app.platform_match_submissions('forwarded')->0->>'forwarded_because' = 'weaver_checked',
  'E · Weaver''s team finds it among the forwarded ones, with the manager''s note and why it came to them');
select pg_temp.decided(app.decide_match_submission(:'s2', 'approve')) as s2_status \gset
select pg_temp.assert(:'s2_status' = 'approved'
                      and (select match_ratio_bp = 20000 and verified_by_kind = 'weaver' and last_verified_on = current_date and version = 3
                             from app.match_programs where id = :'acme')
                      and exists (select 1 from jsonb_array_elements(app.platform_match_submissions('decided')) e
                                   where e->>'id' = :'s2' and e->>'status' = 'approved' and e->>'decided_kind' = 'weaver'),
  'E · Weaver''s team approves it: the entry changes, checked by Weaver''s team today');
reset role;

set role authenticated;
select pg_temp.claims(:lead1);
-- An entry this community verified changes at once.
select app.submit_match_program(:c1, :'initech', '{"company_name": "Initech", "match_ratio_bp": 5000, "max_year_cents": 300000, "portal": "yourcause"}'::jsonb) as s3 \gset
select pg_temp.decided(app.decide_match_submission(:'s3', 'approve')) as s3_status \gset
select pg_temp.assert(:'s3_status' = 'approved'
                      and (select match_ratio_bp = 5000 and verified_submission_id = :'s3' and version = 2 from app.match_programs where id = :'initech'),
  'E · an entry this community verified changes at once when its manager approves');
-- Another community's entry: forwarded.
select pg_temp.claims(:lead2);
select app.submit_match_program(:c2, :'initech', '{"company_name": "Initech", "match_ratio_bp": 100000, "portal": "yourcause"}'::jsonb) as sx \gset
select pg_temp.decided(app.decide_match_submission(:'sx', 'approve')) as sx_status \gset
select pg_temp.assert(:'sx_status' = 'forwarded:other_community'
                      and (select match_ratio_bp = 5000 from app.match_programs where id = :'initech'),
  'E · a community does not overwrite what another community verified: it goes to Weaver''s team');
select pg_temp.claims(:lead1);
-- Links: a new or changed link always goes to Weaver's team.
select app.submit_match_program(:c1, :'initech', '{"company_name": "Initech", "match_ratio_bp": 5000, "max_year_cents": 300000, "portal": "yourcause", "portal_url": "https://initech.example/match"}'::jsonb) as sl \gset
select pg_temp.decided(app.decide_match_submission(:'sl', 'approve')) as sl_status \gset
select app.submit_match_program(:c1, null, '{"company_name": "Hooli", "source_url": "https://hooli.example/giving"}'::jsonb) as sh \gset
select pg_temp.decided(app.decide_match_submission(:'sh', 'approve')) as sh_status \gset
select pg_temp.assert(:'sl_status' = 'forwarded:links_changed' and :'sh_status' = 'forwarded:links_changed'
                      and (select portal_url is null from app.match_programs where id = :'initech'),
  'E · a changed portal link, or a new company with a link, goes to Weaver''s team, even on the community''s own entry');
-- A near-duplicate of an entry Weaver's team checked.
select app.submit_match_program(:c1, null, '{"company_name": "Acme Holdings"}'::jsonb) as sn \gset
select pg_temp.decided(app.decide_match_submission(:'sn', 'approve')) as sn_status \gset
select pg_temp.assert(:'sn_status' = 'forwarded:near_duplicate', 'E · a new company whose name contains a name Weaver''s team checked goes to them');
-- A name another entry went by (a retired alias), an ended entry's name, an ended entry.
select app.submit_match_program(:c1, null, '{"company_name": "アクメ"}'::jsonb) as su \gset
select pg_temp.decided(app.decide_match_submission(:'su', 'approve')) as su_status \gset
select app.submit_match_program(:c1, null, '{"company_name": "Globex", "gift_match": false, "volunteer_grant": true}'::jsonb) as sg \gset
select pg_temp.decided(app.decide_match_submission(:'sg', 'approve')) as sg_status \gset
select app.submit_match_program(:c1, :'globex', '{"company_name": "Globex", "gift_match": false, "volunteer_grant": true}'::jsonb) as sr \gset
select pg_temp.decided(app.decide_match_submission(:'sr', 'approve')) as sr_status \gset
select pg_temp.assert(:'su_status' = 'forwarded:name_in_use' and :'sg_status' = 'forwarded:retired' and :'sr_status' = 'forwarded:retired'
                      and (select count(*) from app.match_programs where company_name in ('Globex', 'アクメ')) = 1,
  'E · a retired alias, an ended entry''s name, and a change to an ended entry all go to Weaver''s team');
-- A new-company submission approved into an existing entry this community verified.
select app.submit_match_program(:c1, null, '{"company_name": "Initech Corp"}'::jsonb) as si \gset
select pg_temp.decided(app.decide_match_submission(:'si', 'approve',
  '{"company_name": "Initech", "names": ["Initech Corp"], "match_ratio_bp": 5000, "max_year_cents": 300000, "portal": "yourcause"}'::jsonb,
  'Same company', :'initech')) as si_status \gset
select pg_temp.assert(:'si_status' = 'approved'
                      and (select result_program_id = :'initech' and program_id = :'initech' from app.match_program_submissions where id = :'si')
                      and (select version = 3 from app.match_programs where id = :'initech')
                      and exists (select 1 from app.match_program_names where program_id = :'initech' and name = 'Initech Corp' and retired_at is null),
  'E · a new-company submission approved into the entry it repeats changes that entry (the same rules apply)');
-- The daily cap.
reset role;
set role authenticated;
select pg_temp.claims(:weaver);
select app.set_match_publishing(:c1, null, 3, 'Test 166: three a day');
select pg_temp.claims(:lead1);
select pg_temp.assert((app.match_publishing_state(:c1)->>'daily_cap')::int = 3 and (app.match_publishing_state(:c1)->>'published_today')::int = 3
                      and (app.match_publishing_state(:c1)->>'paused')::boolean = false,
  'E · the community''s managers see their daily cap and what they published today');
select app.submit_match_program(:c1, null, '{"company_name": "Vandelay"}'::jsonb) as sv \gset
select pg_temp.assert_raises(format($$select app.decide_match_submission(%L, 'approve')$$, :'sv'),
  'published 3 approvals to the directory today', 'E · past the daily cap, an approval waits until tomorrow');
select pg_temp.assert_raises(format($$select app.set_match_publishing(%L, true, null, 'x')$$, :c1),
  'Only Weaver''s team can', 'E · only Weaver''s team pauses publishing or sets the cap');
select pg_temp.claims(:treas1);
select pg_temp.assert_raises(format($$select app.match_publishing_state(%L)$$, :c1), 'You don''t have access to this area',
  'E · staff without a CatchTheMatch role do not see it');
select pg_temp.claims(:weaver);
select app.set_match_publishing(:c1, null, 20, 'Test 166: back to twenty');
select pg_temp.claims(:lead1);
select pg_temp.decided(app.decide_match_submission(:'sv', 'approve')) as sv_status \gset
select pg_temp.assert(:'sv_status' = 'approved', 'E · under the cap it publishes');
-- Publishing paused by Weaver's team.
select pg_temp.claims(:weaver);
select app.set_match_publishing(:c1, true, null, 'Test 166: checking this week''s publishes');
select pg_temp.claims(:lead1);
select app.submit_match_program(:c1, null, '{"company_name": "Kramerica"}'::jsonb) as sp \gset
select pg_temp.decided(app.decide_match_submission(:'sp', 'approve')) as sp_status \gset
select pg_temp.assert(:'sp_status' = 'forwarded:paused'
                      and (app.match_publishing_state(:c1)->>'pause_reason') = 'Test 166: checking this week''s publishes',
  'E · while Weaver''s team has paused the community''s publishing, its approvals go to them, and the managers see why');
select pg_temp.claims(:weaver);
select app.set_match_publishing(:c1, false, null, 'Test 166: checked');
select pg_temp.claims(:lead1);
-- Reject, with a reason.
select app.submit_match_program(:c1, null, '{"company_name": "Umbrella166"}'::jsonb) as s4 \gset
select pg_temp.assert_raises(format($$select app.decide_match_submission(%L, 'reject')$$, :'s4'),
  'Say why it is rejected', 'E · a rejection has a reason');
select pg_temp.decided(app.decide_match_submission(:'s4', 'reject', null, 'No such program at that company')) as s4_status \gset
select pg_temp.assert(:'s4_status' = 'rejected'
                      and (select decision_reason = 'No such program at that company' from app.match_program_submissions where id = :'s4')
                      and not exists (select 1 from app.match_programs where company_name = 'Umbrella166'),
  'E · rejected: nothing reaches the directory, the reason is kept');
select pg_temp.assert_raises(format($$select app.decide_match_submission(%L, 'approve')$$, :'s4'),
  'already decided', 'E · a decided submission stays decided');
-- Duplicates.
select app.submit_match_program(:c1, null, '{"company_name": "ACME corp"}'::jsonb) as s5 \gset
select pg_temp.assert_raises(format($$select app.decide_match_submission(%L, 'approve')$$, :'s5'),
  'is already in the directory', 'E · approving a company already in the directory is refused (a submission with no country included)');
select pg_temp.assert_raises(format($$select app.decide_match_submission(%L, 'duplicate')$$, :'s5'),
  'Choose the directory entry or the submission it repeats', 'E · a duplicate names what it repeats');
select pg_temp.decided(app.decide_match_submission(:'s5', 'duplicate', null, null, :'acme')) as s5_status \gset
select pg_temp.assert(:'s5_status' = 'merged'
                      and (select status = 'merged' and result_program_id = :'acme' and decision_reason = 'A duplicate'
                             from app.match_program_submissions where id = :'s5'),
  'E · marked a duplicate of the entry');
select app.submit_match_program(:c1, null, '{"company_name": "Initrode166"}'::jsonb) as s6 \gset
select app.submit_match_program(:c1, null, '{"company_name": "Initrode 166"}'::jsonb) as s7 \gset
select pg_temp.decided(app.decide_match_submission(:'s7', 'duplicate', null, 'Sent twice', null, :'s6')) as s7_status \gset
select pg_temp.assert(:'s7_status' = 'merged'
                      and (select duplicate_of = :'s6' from app.match_program_submissions where id = :'s7'),
  'E · or of another submission');
select pg_temp.assert_raises(format($$select app.decide_match_submission(%L, 'duplicate', null, null, null, %L)$$, :'s6', :'s6'),
  'cannot repeat itself', 'E · not of itself');
reset role;
-- What Weaver's team checks afterwards.
set role authenticated;
select pg_temp.claims(:weaver);
select pg_temp.assert(exists (select 1 from jsonb_array_elements(app.platform_match_recent_publishes(7)) e
                               where e->>'program_id' = :'initech' and e->>'community' = 'Matching Temple 166')
                      and exists (select 1 from jsonb_array_elements(app.platform_match_recent_publishes(7)) e
                                   where e->>'company_name' = 'Vandelay')
                      and not exists (select 1 from jsonb_array_elements(app.platform_match_recent_publishes(7)) e
                                       where e->>'program_id' = :'acme'),
  'E · Weaver''s team lists what communities published lately, with the community''s name (its own writes are not in it)');
select pg_temp.assert(exists (select 1 from jsonb_array_elements(app.platform_match_communities()) e
                               where e->>'center_id' = :c1 and (e->>'published_today')::int = 4 and (e->>'daily_cap')::int = 20
                                 and (e->>'paused')::boolean = false)
                      and not exists (select 1 from jsonb_array_elements(app.platform_match_communities()) e where e->>'center_id' = :c3),
  'E · and each community''s publishing, cap and pause (communities where CatchTheMatch is on)');
-- A rename or a new alias is checked as a new company's name is.
select pg_temp.claims(:lead1);
select app.submit_match_program(:c1, null, '{"company_name": "Zzyzx166"}'::jsonb) as sq \gset
select (app.decide_match_submission(:'sq', 'approve'))->>'program_id' as zzyzx \gset
select app.submit_match_program(:c1, :'zzyzx', '{"company_name": "Acme Holdings"}'::jsonb) as sq2 \gset
select pg_temp.decided(app.decide_match_submission(:'sq2', 'approve')) as sq2_status \gset
select app.submit_match_program(:c1, :'zzyzx', '{"company_name": "Zzyzx166", "names": ["Acme Holdings"]}'::jsonb) as sq3 \gset
select pg_temp.decided(app.decide_match_submission(:'sq3', 'approve')) as sq3_status \gset
select app.submit_match_program(:c1, :'zzyzx', '{"company_name": "Zzyzx166", "match_ratio_bp": 10000}'::jsonb) as sq4 \gset
select pg_temp.decided(app.decide_match_submission(:'sq4', 'approve')) as sq4_status \gset
select app.submit_match_program(:c1, null, '{"company_name": "Globex Labs", "gift_match": false, "volunteer_grant": true}'::jsonb) as sq5 \gset
select pg_temp.decided(app.decide_match_submission(:'sq5', 'approve')) as sq5_status \gset
select pg_temp.assert(:'sq2_status' = 'forwarded:near_duplicate' and :'sq3_status' = 'forwarded:near_duplicate'
                      and :'sq4_status' = 'approved' and :'sq5_status' = 'forwarded:near_duplicate'
                      and (select company_name = 'Zzyzx166' and match_ratio_bp = 10000 from app.match_programs where id = :'zzyzx')
                      and not exists (select 1 from app.match_program_names where program_id = :'zzyzx' and name = 'Acme Holdings'),
  'E · renaming an entry, or adding an alias, close to a name Weaver''s team checked goes to them (an ended entry of theirs too); an edit that adds no name publishes');
reset role;

-- ══ F. Versions ══════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:weaver);
select pg_temp.assert(jsonb_array_length(app.platform_match_program_versions(:'acme')) = 3
                      and (app.platform_match_program_versions(:'acme')->0->>'version')::int = 3,
  'F · Weaver''s team lists an entry''s versions, newest first');
select app.revert_match_program(:'acme', 1, 'Test 166: the 2:1 ratio was not confirmed') as acme_v \gset
select pg_temp.assert(:'acme_v' = '4'
                      and (select match_ratio_bp = 10000 and version = 4 and verified_by_kind = 'weaver' from app.match_programs where id = :'acme')
                      and exists (select 1 from app.match_program_names where program_id = :'acme' and name = 'アクメ' and retired_at is null)
                      and (select note like 'Reverted to version 1%' from app.match_program_versions where program_id = :'acme' and version = 4),
  'F · reverted to version 1 in one step: the facts and names come back (the retired alias too), as version 4');
select pg_temp.assert_raises(format($$select app.revert_match_program(%L, 4, 'x')$$, :'acme'),
  'That is the entry as it is now', 'F · not to the version it is');
select pg_temp.assert_raises(format($$select app.revert_match_program(%L, 99, 'x')$$, :'acme'),
  'That version of the entry was not found', 'F · nor to one it never had');
reset role;

-- ══ G. Links ═════════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:lead1);
select pg_temp.assert((select x->>'employer' = 'ACME Corporation' and x->'link' = 'null'::jsonb
                              and jsonb_array_length(x->'candidates') = 2
                              and x->'candidates'->0->>'id' = :'acme' and x->'candidates'->0->>'how' = 'part_of_name'
                              and x->'candidates'->1->>'id' = :'acmein'
                         from (select app.match_program_candidates(:c1, :pm) as x) q),
  'G · an employer on file finds the entries whose name is part of it, the closest first');
select pg_temp.assert(app.match_program_candidates(:c1, :pa)->'candidates'->0->>'id' = :'hitachi'
                      and app.match_program_candidates(:c1, :pa)->'candidates'->0->>'matched_name' = '日立製作所'
                      and jsonb_array_length(app.match_program_candidates(:c1, :pz)->'candidates') = 0
                      and app.match_program_candidates(:c1, :pk)->'employer' = 'null'::jsonb,
  'G · in any script; a name nothing has finds nothing; a child has nothing on file');
-- At the same level, an entry Weaver's team checked comes before one a community verified (even with a closer name).
select app.submit_match_program(:c1, null, '{"company_name": "Zeta Widgets Intl"}'::jsonb) as sz \gset
select pg_temp.decided(app.decide_match_submission(:'sz', 'approve')) as sz_status \gset
reset role;
set role authenticated;
select pg_temp.claims(:weaver);
select app.save_match_program(null, '{"company_name": "Zeta", "source": "employer_site"}'::jsonb, 'Test 166: Zeta''s own page') as zeta \gset
select pg_temp.claims(:lead1);
select pg_temp.assert(:'sz_status' = 'approved'
                      and app.match_program_candidates(:c1, :pz)->'candidates'->0->>'id' = :'zeta'
                      and app.match_program_candidates(:c1, :pz)->'candidates'->1->>'company_name' = 'Zeta Widgets Intl',
  'G · Weaver''s team''s check ranks first at the same level');
select pg_temp.assert(exists (select 1 from app.audit_log where center_id = :c1 and action = 'matching.read' and module = 'matching'
                                and after->>'what' = 'employer_candidates'),
  'G · each read of an employer''s candidates is logged in the community''s private audit');
select pg_temp.claims(:viewer1);
select pg_temp.assert_raises(format($$select app.link_match_program(%L, %L, %L)$$, :c1, :pm, :'acme'),
  'needs the CatchTheMatch manager role', 'G · a matching.view holder does not link');
select pg_temp.claims(:treas1);
select pg_temp.assert_raises(format($$select app.match_program_candidates(%L, %L)$$, :c1, :pm),
  'You don''t have access to this area', 'G · nor reads candidates without a CatchTheMatch role');
select pg_temp.claims(:lead1);
select app.link_match_program(:c1, :pm, :'acme')->>'how' as pm_how \gset
select app.link_match_program(:c1, :pz, :'initech')->>'how' as pz_how \gset
select pg_temp.assert(:'pm_how' = 'part_of_name' and :'pz_how' = 'chosen'
                      and (select program_id = :'acme' and confirmed_by = :lead1 and confirmed_version = 4 from app.person_match_programs where person_id = :pm),
  'G · the manager confirms a candidate (part of the name) or chooses another entry from the directory; the entry''s version is kept');
select pg_temp.assert_raises(format($$select app.link_match_program(%L, %L, %L)$$, :c1, :pa, :'globex'),
  'That program has ended', 'G · a retired entry cannot be chosen');
select pg_temp.assert_raises(format($$select app.link_match_program(%L, %L, %L)$$, :c1, :pk, :'acme'),
  'Nothing is on file for this person', 'G · nor linked for someone with nothing on file (a child never has)');
select pg_temp.assert((select count(*) from app.person_match_programs) = 2, 'G · the manager reads the links');
select pg_temp.assert((app.match_employers_queue(:c1)->>'total')::int = 1
                      and app.match_employers_queue(:c1)->'rows'->0->>'person_id' = :pa
                      and app.match_employers_queue(:c1)->'rows'->0->'best'->>'id' = :'hitachi'
                      and (app.match_employers_queue(:c1, 'linked')->>'total')::int = 2
                      and app.match_employers_queue(:c1, 'linked')->'rows'->0->'link'->'program'->>'id' = :'acme'
                      and (app.match_employers_queue(:c1, 'all')->>'total')::int = 3,
  'G · the employers on file: those not linked yet with their best candidate, the linked ones with their entry');
select pg_temp.claims(:viewer1);
select pg_temp.assert((select count(*) from app.person_match_programs) = 2 and (app.match_employers_queue(:c1, 'all')->>'total')::int = 3,
  'G · a matching.view holder reads them');
select pg_temp.claims(:treas1);
select pg_temp.assert((select count(*) from app.person_match_programs) = 0, 'G · staff without a CatchTheMatch role read none');
select pg_temp.assert_raises(format($$select app.match_employers_queue(%L)$$, :c1), 'You don''t have access to this area', 'G · nor the queue');
select pg_temp.claims(:lead2);
select pg_temp.assert((select count(*) from app.person_match_programs) = 0, 'G · nor another community');
select pg_temp.claims(:weaver);
select pg_temp.assert((select count(*) from app.person_match_programs) = 0
                      and (select count(*) from app.audit_log where record_table = 'person_match_programs') = 0,
  'G · nor Weaver''s team, the filing grant included: not the links, not their audit');
select pg_temp.assert_raises(format($$select app.match_program_candidates(%L, %L)$$, :c1, :pm),
  'You don''t have access to this area', 'G · the filing grant reads no candidates');
select pg_temp.assert_raises(format($$select app.match_employers_queue(%L)$$, :c1),
  'You don''t have access to this area', 'G · nor the employers on file queue');
-- "Changed since you confirmed it".
select pg_temp.claims(:lead1);
select pg_temp.assert((app.match_program_candidates(:c1, :pz)->'link'->>'changed_since_confirmed')::boolean = false,
  'G · a link just confirmed has not changed');
select pg_temp.claims(:weaver);
select app.save_match_program(:'initech', '{"company_name": "Initech", "names": ["Initech Corp"], "match_ratio_bp": 5000, "max_year_cents": 300000,
  "portal": "yourcause", "notes": "HR sends the form in January.", "source": "submission"}'::jsonb, 'Test 166: checked with Initech');
select pg_temp.claims(:lead1);
select pg_temp.assert((app.match_program_candidates(:c1, :pz)->'link'->>'changed_since_confirmed')::boolean = true,
  'G · after the entry changed, the community sees "changed since you confirmed it"');
select app.link_match_program(:c1, :pz, :'initech');
select pg_temp.assert((app.match_program_candidates(:c1, :pz)->'link'->>'changed_since_confirmed')::boolean = false,
  'G · confirming it again records the entry as it is now');
-- A birth date that makes the person a child hides the link.
reset role;
update app.people set date_of_birth = (current_date - interval '10 years')::date where id = :pm;
set role authenticated;
select pg_temp.claims(:lead1);
select pg_temp.assert(not exists (select 1 from app.person_match_programs where person_id = :pm)
                      and (app.match_employers_queue(:c1, 'linked')->>'total')::int = 1
                      and app.match_program_candidates(:c1, :pm)->'employer' = 'null'::jsonb,
  'G · a birth date that makes the person a child hides the link, the queue row and the candidates');
reset role;
update app.people set date_of_birth = date '1985-04-01' where id = :pm;
-- Weaver merges the Indian entry into the American one; a link to it follows, and counts as changed.
set role authenticated;
select pg_temp.claims(:lead1);
select app.link_match_program(:c1, :pm, :'acmein');
select pg_temp.claims(:weaver);
select app.merge_match_programs(:'acme', :'acmein', 'Test 166: one global program');
select pg_temp.assert((select status = 'merged' and merged_into = :'acme' from app.match_programs where id = :'acmein')
                      and (select count(*) = 1 and bool_and(retired_at is not null) from app.match_program_names where program_id = :'acmein')
                      and (app.match_program_search('acme')->>'total')::int = 1,
  'G · a merged entry keeps its name as a retired alias (never deleted) and is no longer listed');
select pg_temp.claims(:lead1);
select pg_temp.assert(app.match_program_candidates(:c1, :pm)->'link'->'program'->>'id' = :'acme'
                      and (app.match_program_candidates(:c1, :pm)->'link'->>'changed_since_confirmed')::boolean = true
                      and (select program_id = :'acmein' from app.person_match_programs where person_id = :pm),
  'G · a link to the merged entry shows the entry it joined, as changed (the organization''s row is not rewritten by Weaver''s team)');
-- Approving into a merged entry follows it, and the rules of the entry it joined apply.
select app.submit_match_program(:c1, null, '{"company_name": "Acme India"}'::jsonb) as sm \gset
select pg_temp.decided(app.decide_match_submission(:'sm', 'approve', null, null, :'acmein')) as sm_status \gset
select pg_temp.assert(:'sm_status' = 'forwarded:weaver_checked'
                      and (select program_id = :'acme' from app.match_program_submissions where id = :'sm'),
  'G · approving into a merged entry follows it to the entry it joined (Weaver''s team checked it: forwarded)');
-- Weaver's team merges its own entry into one a community verified: the entry it keeps is Weaver's check from then on.
select pg_temp.claims(:weaver);
select id as zwi from app.match_programs where company_name = 'Zeta Widgets Intl' \gset
select app.merge_match_programs(:'zwi', :'zeta', 'Test 166: the same program');
select pg_temp.assert((select verified_by_kind = 'weaver' and verified_submission_id is null and last_verified_on = current_date
                         from app.match_programs where id = :'zwi')
                      and exists (select 1 from app.match_program_names where program_id = :'zwi' and name = 'Zeta' and retired_at is null),
  'G · the entry Weaver''s team keeps in a merge counts as checked by them, with the names it absorbed');
select pg_temp.claims(:lead1);
select app.submit_match_program(:c1, :'zwi', '{"company_name": "Zeta Widgets Intl", "names": ["Zeta"], "match_ratio_bp": 10000}'::jsonb) as sw \gset
select pg_temp.decided(app.decide_match_submission(:'sw', 'approve')) as sw_status \gset
select pg_temp.assert(:'sw_status' = 'forwarded:weaver_checked',
  'G · so the community that verified it first no longer changes it, or the names it absorbed, directly');
-- The employer on file changes, or is withdrawn: the link goes.
select app.record_match_employer(:c1, :pm, 'Acme Corp');
select pg_temp.assert(not exists (select 1 from app.person_match_programs where person_id = :pm),
  'G · a changed employer drops the link');
select app.withdraw_match_employer(:c1, :pz, 'By phone on 13 October');
select pg_temp.assert(not exists (select 1 from app.person_match_programs where person_id = :pz),
  'G · a withdrawn employer drops the link');
select app.link_match_program(:c1, :pa, :'hitachi');
select app.unlink_match_program(:c1, :pa) as unlinked \gset
select pg_temp.assert(:'unlinked' and not exists (select 1 from app.person_match_programs where person_id = :pa),
  'G · the manager removes a link');
select pg_temp.assert(not app.unlink_match_program(:c1, :pa), 'G · removing it again finds nothing to remove');
select pg_temp.assert((select count(*) > 0 and bool_and(module = 'matching' and center_id = :c1 and after->>'how' is distinct from 'part_of_name')
                         from app.audit_log where record_table = 'person_match_programs'),
  'G · every link change is in the community''s private audit (its words masked)');
reset role;

-- ══ H. CatchTheMatch off for a community ═════════════════════════════════════
set role authenticated;
select pg_temp.claims(:weaver);
select count(*) as all_entries from app.match_programs \gset
reset role;
select pg_temp.no_claims();
update app.center_module_grants set granted = false, reason = 'Test 166: off' where center_id = :c1 and module_key = 'matching';
set role authenticated;
select pg_temp.claims(:lead1);
select pg_temp.assert((select count(*) from app.match_programs) = 0 and (select count(*) from app.match_program_submissions) = 0
                      and not app.match_directory_can_read(),
  'H · with CatchTheMatch off, the community''s manager reads neither the directory nor its submissions');
select pg_temp.assert_raises(format($$select app.submit_match_program(%L, null, '{"company_name": "Off166"}'::jsonb)$$, :c1),
  'needs a CatchTheMatch role', 'H · and sends nothing');
select pg_temp.claims(:lead2);
select pg_temp.assert((select count(*) from app.match_programs) = :all_entries, 'H · another community where it is on still reads the whole directory');
select pg_temp.claims(:weaver);
select pg_temp.assert((select count(*) from app.match_programs) = :all_entries
                      and not exists (select 1 from jsonb_array_elements(app.platform_match_submissions('all')) e where e->>'center_id' = :c1),
  'H · Weaver''s team reads every entry, and sees no submission of a community where it is off');
reset role;

select pg_temp.no_claims();
rollback;
\echo 'PASS: gift matching directory tests'
