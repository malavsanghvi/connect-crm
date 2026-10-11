-- 134: a person's language is any language (0684) and a community's language list is readable by the people linked to it (0685)
--   A. people.language takes any BCP-47 code, and still refuses text that is not a language code
--   B. app.community_languages: a member, a staff role and the owner read the list, in the community's order; a guest and a person of another
--      community get null; a community that never chose gets English; the list of another community is not leaked
--   C. Who may call it, and how it is defined
-- Everything runs in one transaction that is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
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
create or replace function pg_temp.refused(stmt text) returns boolean language plpgsql as $$
begin
  execute stmt;
  return false;
exception when check_violation then return true;
end $$;

\set a134 '''13400000-0000-4000-8000-0000000000a1'''
\set b134 '''13400000-0000-4000-8000-0000000000b1'''
\set c134 '''13400000-0000-4000-8000-0000000000c1'''
\set mira134 '''13400000-0000-4000-8000-0000000000d1'''
\set member134 '''13400000-0000-4000-8000-000000000001'''
\set staff134 '''13400000-0000-4000-8000-000000000002'''
\set owner134 '''13400000-0000-4000-8000-000000000003'''
\set outsider134 '''13400000-0000-4000-8000-000000000004'''

select pg_temp.no_claims();
insert into auth.users (id, email) values
  (:member134, 'member134@lang.test'), (:staff134, 'staff134@lang.test'), (:owner134, 'owner134@lang.test'), (:outsider134, 'outsider134@else.test');

-- a134 speaks Spanish first, then English; b134 never chose (no profile row at all); c134 speaks Arabic only.
insert into app.centers (id, slug, name, short_name, status, environment) values
  (:a134, 'lang134-a', 'Lang 134 A', 'L134A', 'active', 'production'),
  (:b134, 'lang134-b', 'Lang 134 B', 'L134B', 'active', 'production'),
  (:c134, 'lang134-c', 'Lang 134 C', 'L134C', 'active', 'production');
insert into app.org_profiles (center_id, languages) values (:a134, array['es', 'en']), (:c134, array['ar']);

insert into app.people (id, center_id, first_name, last_name, date_of_birth) values (:mira134, :a134, 'Mira', 'Member134', date '1980-01-01');
insert into app.center_users (center_id, user_id, person_id) values (:a134, :member134, :mira134);
insert into app.center_owners (center_id, user_id) values (:b134, :owner134), (:c134, :owner134)
  on conflict (center_id) do update set user_id = excluded.user_id;
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values (:a134, :staff134, 'event_lead', 'center', 'test 134');

-- ══ A. A person's language ═══════════════════════════════════════════════════
insert into app.people (center_id, first_name, last_name, language) values
  (:a134, 'Lucia', 'Lang134', 'es'), (:a134, 'Paulo', 'Lang134', 'pt-BR'), (:a134, 'Wei', 'Lang134', 'zh-Hant-TW'),
  (:a134, 'Fatima', 'Lang134', 'ar'), (:a134, 'Nita', 'Lang134', 'gu'), (:a134, 'Tom', 'Lang134', 'en'), (:a134, 'Fil', 'Lang134', 'fil');
select pg_temp.assert((select count(*) = 7 from app.people where center_id = :a134 and last_name = 'Lang134'),
  'A · Spanish, Brazilian Portuguese, Traditional Chinese, Arabic, Gujarati, English and Filipino can all be saved');
select pg_temp.assert((select language = 'en' from app.people where id = :mira134), 'A · a person with no language still gets English');
select pg_temp.assert(pg_temp.refused('update app.people set language = ''english'' where id = ''13400000-0000-4000-8000-0000000000d1''')
                      and pg_temp.refused('update app.people set language = '''' where id = ''13400000-0000-4000-8000-0000000000d1''')
                      and pg_temp.refused('update app.people set language = ''e'' where id = ''13400000-0000-4000-8000-0000000000d1''')
                      and pg_temp.refused('update app.people set language = ''en US'' where id = ''13400000-0000-4000-8000-0000000000d1''')
                      and pg_temp.refused('update app.people set language = ''en_US'' where id = ''13400000-0000-4000-8000-0000000000d1''')
                      and pg_temp.refused('update app.people set language = ''1234'' where id = ''13400000-0000-4000-8000-0000000000d1''')
                      and pg_temp.refused('update app.people set language = ''en-'' where id = ''13400000-0000-4000-8000-0000000000d1''')
                      and pg_temp.refused('update app.people set language = ''en-abcdefgh-abcdefgh-abcdefgh-abcdefg'' where id = ''13400000-0000-4000-8000-0000000000d1'''),
  'A · text that is not a language code is still refused (a name, empty, one letter, a space, an underscore, digits, a trailing dash, over 35 characters)');
select pg_temp.assert(not exists (select 1 from pg_constraint where conrelid = 'app.people'::regclass and conname = 'people_language_check')
                      and exists (select 1 from pg_constraint where conrelid = 'app.people'::regclass and conname = 'people_language_bcp47'),
  'A · the old three-language list is gone and the code-shape check is in its place');

-- ══ B. A community's language list ═══════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:member134);
select pg_temp.assert(app.community_languages(:a134) = array['es', 'en'], 'B · a member reads their community''s languages, in its order');
select pg_temp.assert(app.community_languages(:b134) is null and app.community_languages(:c134) is null,
  'B · and gets nothing for a community they are not linked to (the Arabic list is not leaked)');
select pg_temp.claims(:staff134);
select pg_temp.assert(app.community_languages(:a134) = array['es', 'en'], 'B · a staff role reads the list');
select pg_temp.claims(:owner134);
select pg_temp.assert(app.community_languages(:c134) = array['ar'], 'B · the owner reads the list');
select pg_temp.assert(app.community_languages(:b134) = array['en'], 'B · a community with no profile yet is English');
select pg_temp.claims(:outsider134);
select pg_temp.assert(app.community_languages(:a134) is null and app.community_languages(:c134) is null, 'B · a person of no community here gets null');
reset role;
-- A community whose list was emptied is English too.
update app.org_profiles set languages = '{}' where center_id = :c134;
set role authenticated;
select pg_temp.claims(:owner134);
select pg_temp.assert(app.community_languages(:c134) = array['en'], 'B · and so is one whose list was emptied');
reset role;
select pg_temp.no_claims();

-- ══ C. Who may call it, and how it is defined ═════════════════════════════════
select pg_temp.assert(has_function_privilege('authenticated', 'app.community_languages(uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.community_languages(uuid)', 'execute'),
  'C · signed-in people can call it, guests cannot');
select pg_temp.assert((select p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=app, public, extensions%'
                         from pg_proc p where p.oid = 'app.community_languages(uuid)'::regprocedure),
  'C · it is security definer with the pinned search path');

rollback;
