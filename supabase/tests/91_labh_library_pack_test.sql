-- 0601: Labh as its own module, and the library pack on the shared rows (experiences stream; plan "PR 4").
--   A. The module: its row, its place in every experience (Jain Center on, every other never), its tables and their switch,
--      the import entity, commit_labh's guards.
--   B. JSH: Labh can be switched off alone (Giving stays on), Giving cannot be switched off while Labh is on, and switching it
--      back on restores everything; nothing changes for JSH until an administrator switches it.
--   C. The library pack: the shared Jain rows are tagged, a new shared Jain row is tagged by the trigger, a shared row with no
--      tradition and the school-district calendars stay shared, JSH sees every shared row it saw.
--   D. Niva's search offers a shared source only to an experience that has its library pack.
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
create or replace function pg_temp.no_claims() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;
-- The worker's search (the function asserts the worker role itself).
create or replace function pg_temp.search(p_center uuid, q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role connect_worker;
  r := app.niva_worker_search_sources(p_center, q, 10, array['published']);
  reset role;
  return r;
end $$;
create or replace function pg_temp.ids(r jsonb) returns text language sql as $$
  select coalesce(string_agg(e->>'id', ',' order by e->>'id'), '') from jsonb_array_elements(r) e
$$;

\set jsh '''00000000-0000-4000-8000-000000000001'''
\set jadmin '''91000000-0000-4000-8000-000000000001'''
\set cc '''91000000-0000-4000-8000-000000000002'''
\set c_chm '''91000000-0000-4000-8000-0000000000c1'''
\set c_npo '''91000000-0000-4000-8000-0000000000c2'''
\set c_chr '''91000000-0000-4000-8000-0000000000c3'''
\set p_adm '''91000000-0000-4000-8000-0000000000a1'''
\set h_adm '''91000000-0000-4000-8000-0000000000b1'''
\set h_chm '''91000000-0000-4000-8000-0000000000b2'''
\set sd_jsh '''91000000-0000-4000-8000-0000000000d1'''
\set sd_chm '''91000000-0000-4000-8000-0000000000d2'''
\set src_jain '''91000000-0000-4000-8000-0000000000e1'''
\set src_open '''91000000-0000-4000-8000-0000000000e2'''

insert into auth.users (id, email) values (:jadmin, 'jadmin91@jsh.test'), (:cc, 'cc91@platform.test');
insert into app.accounts (user_id, is_platform_admin) values (:cc, true) on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, environment, category_key, status) values
  (:c_chm, 'chm91-sandbox', 'Chamber 91',   'sandbox', 'chamber_of_commerce', 'onboarding'),
  (:c_npo, 'npo91-sandbox', 'Community 91', 'sandbox', 'nonprofit_secular',   'onboarding'),
  (:c_chr, 'chr91-sandbox', 'Church 91',    'sandbox', 'church',              'onboarding');
insert into app.role_grants (center_id, user_id, role_key, reason) values (:jsh, :jadmin, 'center_admin', 'labh test 91');
insert into app.households (id, center_id, display_name) values (:h_adm, :jsh, 'Labh household 91 (JSH)'), (:h_chm, :c_chm, 'Labh household 91 (chamber)');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values (:p_adm, :jsh, 'Lab', 'Admin91', date '1975-01-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values (:h_adm, :p_adm, :jsh, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values (:jsh, :jadmin, :p_adm);
insert into app.special_days (id, center_id, household_id, kind, label, calendar_date) values
  (:sd_jsh, :jsh, :h_adm, 'birthday', 'Labh test day (JSH)', current_date + 10), (:sd_chm, :c_chm, :h_chm, 'birthday', 'Labh test day (chamber)', current_date + 10);
insert into app.labh_options (id, center_id, name, amount_cents) values ('91000000-0000-4000-8000-0000000000f1', :jsh, 'Labh option 91', 5100);

-- ══ A. The module ═══════════════════════════════════════════════════════════
select pg_temp.assert((select label = 'Labh' and depends_on = '{giving}' and not core and sort = 4 from app.modules where key = 'labh')
                      and (select count(*) from app.modules) = 19
                      and not exists (select 1 from app.modules where description like '%labh,%'),
  'A · Labh is a module of its own, under Pledges & donations (the description of Giving no longer lists it)');
select pg_temp.assert((select array_agg(category_key order by category_key) from app.category_modules where module_key = 'labh' and availability = 'default_on') = array['jain_center']
                      and (select array_agg(category_key order by category_key) from app.category_modules where module_key = 'labh' and availability = 'not_available')
                            = array['chamber_of_commerce', 'church', 'faith_other', 'mosque', 'nonprofit_secular', 'swaminarayan_temple'],
  'A · Jain Center has Labh on; the chamber, the neutral experience, the generic faith, Church, Mosque and Swaminarayan Temple never have it');
select pg_temp.assert((select count(*) from app.module_tables where table_name in ('labh_options', 'labh_fulfillments') and module_key = 'labh') = 2
                      and (select count(*) from pg_policy p where p.polname = 'module_switch' and not p.polpermissive
                              and p.polrelid in ('app.labh_options'::regclass, 'app.labh_fulfillments'::regclass)) = 2
                      and (select module_key from app.import_entities where key = 'labh_options') = 'labh',
  'A · its two tables and the labh import belong to it, with the restrictive switch policy');
select pg_temp.assert(app.module_enabled(:jsh, 'labh') and not app.module_enabled(:c_chm, 'labh') and not app.module_enabled(:c_npo, 'labh')
                      and not app.module_enabled(:c_chr, 'labh') and app.module_availability(:c_chm, 'labh') = 'not_available'
                      and not (:jsh::uuid = any (app.module_off_centers('labh')))
                      and :c_chm::uuid = any (app.module_off_centers('labh')) and :c_chr::uuid = any (app.module_off_centers('labh')),
  'A · JSH has Labh on (no switch was written); a chamber, the neutral experience and a church do not');
select pg_temp.assert_raises(format($$select app.commit_labh(%L, array[gen_random_uuid()])$$, :sd_chm),
  'Labh is not part of a Chamber of commerce organization.', 'A · commit_labh refuses in a chamber with the category sentence');
set role authenticated;
select pg_temp.claims(:cc);
select pg_temp.assert_raises(format($$select app.set_module_enabled(%L, 'labh', true, 'Please')$$, :c_chm),
  'cannot be switched on', 'A · and Labh cannot be switched on there (it is not even offered as a switch)');
reset role;
select pg_temp.no_claims();
select pg_temp.assert((select count(*) from app.labh_options where center_id = :jsh) > 0, 'A · (the Labh option of JSH is visible to the database owner)');

-- ══ B. JSH ══════════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:jadmin);
select pg_temp.assert((select count(*) from app.my_modules(:jsh)) = 19 and (select enabled and not core from app.my_modules(:jsh) where key = 'labh')
                      and (select bool_and(enabled) from app.my_modules(:jsh))
                      and (select count(*) from app.labh_options where center_id = :jsh) > 0,
  'B · my_modules(JSH) lists 19 modules, all on (Labh included), and the administrator reads the labh menu');
select pg_temp.assert_raises($$select app.set_module_enabled('00000000-0000-4000-8000-000000000001', 'giving', false, 'Test 91')$$,
  'Labh', 'B · Giving cannot be switched off while Labh is on, and the error names Labh');
select app.set_module_enabled(:jsh, 'labh', false, 'Test 91: Labh alone goes off');
select pg_temp.assert(app.module_enabled(:jsh, 'giving') and not app.module_enabled(:jsh, 'labh')
                      and (select count(*) from app.labh_options where center_id = :jsh) = 0
                      and (select not enabled from app.my_modules(:jsh) where key = 'labh'),
  'B · Labh can be switched off alone: Giving stays on, the labh menu is hidden, not deleted');
select pg_temp.assert_raises(format($$select app.commit_labh(%L, array['91000000-0000-4000-8000-0000000000f1']::uuid[])$$, :sd_jsh),
  'The Labh module is switched off for this community.', 'B · and commit_labh refuses with the usual sentence');
select app.set_module_enabled(:jsh, 'labh', true, 'Test 91: Labh is back');
select pg_temp.assert(app.module_enabled(:jsh, 'labh') and (select count(*) from app.labh_options where center_id = :jsh) > 0,
  'B · switched back on, the labh menu is readable again');
reset role;
select pg_temp.no_claims();
-- A platform admin's own (labh) paths are not blocked: the guard is the module, and platform admins pass.
select pg_temp.assert(app.member_experience(:jsh)->'flags'->>'labh' = 'true' and app.member_experience(:c_chm)->'flags'->>'labh' = 'false'
                      and app.member_experience(:c_chm)->'modules'->'labh'->>'availability' = 'not_available'
                      and app.member_experience(:jsh)->'modules'->'labh'->>'label' = 'Labh',
  'B · the one member read says so: labh on for JSH, never for a chamber');

-- ══ C. The library pack ═════════════════════════════════════════════════════
select pg_temp.assert(not exists (select 1 from app.content_items where center_id is null and tradition is not null and tradition <> 'other' and library_pack is distinct from 'jain')
                      and not exists (select 1 from app.gyan_goals where center_id is null and tradition is not null and tradition <> 'other' and library_pack is distinct from 'jain')
                      and not exists (select 1 from app.practices where center_id is null and tradition is not null and tradition <> 'other' and library_pack is distinct from 'jain')
                      and (select count(*) from app.practices where center_id is null and library_pack = 'jain') > 0
                      and (select count(*) from app.gyan_goals where center_id is null and library_pack = 'jain') > 0
                      and (select count(*) from app.content_items where center_id is null and library_pack = 'jain') > 0,
  'C · the shared Jain lessons, practices and sources are tagged jain');
select pg_temp.assert(not exists (select 1 from app.calendar_layers where center_id is null and kind in ('tithi', 'festival') and library_pack is distinct from 'jain')
                      and (select count(*) from app.calendar_layers where center_id is null and kind = 'school_district' and library_pack is null) > 0
                      and not exists (select 1 from app.calendar_layers where kind = 'school_district' and library_pack is not null),
  'C · the Jain tithi and festival calendars are the jain pack; the school-district calendars stay shared');
savepoint new_shared_rows;
insert into app.practices (center_id, tradition, category, key, name) values
  (null, 'sthanakvasi', 'seva', 'pack91_jain', 'Pack 91 Jain'), (null, null, 'seva', 'pack91_open', 'Pack 91 open'), (null, 'other', 'seva', 'pack91_other', 'Pack 91 other');
insert into app.calendar_layers (center_id, key, name, kind) values
  (null, 'pack91_tithi', 'Pack 91 tithi', 'tithi'), (null, 'pack91_district', 'Pack 91 district', 'school_district');
insert into app.practices (center_id, category, key, name, library_pack) values (null, 'seva', 'pack91_given', 'Pack 91 given', 'chamber_only');
select pg_temp.assert((select library_pack from app.practices where key = 'pack91_jain') = 'jain'
                      and (select library_pack from app.practices where key = 'pack91_open') is null
                      and (select library_pack from app.practices where key = 'pack91_other') is null
                      and (select library_pack from app.calendar_layers where key = 'pack91_tithi') = 'jain'
                      and (select library_pack from app.calendar_layers where key = 'pack91_district') is null
                      and (select library_pack from app.practices where key = 'pack91_given') = 'chamber_only',
  'C · a new shared row is tagged by the trigger (Jain tradition or tithi layer: jain), left alone when it says otherwise, and shared when it has none');
rollback to savepoint new_shared_rows;
select pg_temp.assert(app.library_pack_shows(null, :c_chm) and app.library_pack_shows('jain', :jsh) and not app.library_pack_shows('jain', :c_chm)
                      and not app.library_pack_shows('jain', :c_chr) and not app.library_pack_shows('jain', null),
  'C · app.library_pack_shows: no pack is for everyone; the jain pack is for Jain Center only');
select pg_temp.assert((select count(*) filter (where app.library_pack_shows(library_pack, :jsh)) = count(*) from app.practices where center_id is null)
                      and (select count(*) filter (where app.library_pack_shows(library_pack, :jsh)) = count(*) from app.gyan_goals where center_id is null)
                      and (select count(*) filter (where app.library_pack_shows(library_pack, :jsh)) = count(*) from app.content_items where center_id is null)
                      and (select count(*) filter (where app.library_pack_shows(library_pack, :jsh)) = count(*) from app.calendar_layers where center_id is null)
                      and (select count(*) filter (where app.library_pack_shows(library_pack, :jsh)) = count(*) from app.tithi_days where center_id is null)
                      and (select count(*) filter (where app.library_pack_shows(library_pack, :c_chm)) from app.practices where center_id is null) = 0
                      and (select count(*) filter (where app.library_pack_shows(library_pack, :c_chm)) from app.calendar_layers where center_id is null) > 0,
  'C · JSH sees every shared row it saw; a chamber sees none of the Jain practices and keeps the shared school calendars');

-- ══ D. Niva's search ════════════════════════════════════════════════════════
insert into app.content_items (id, center_id, tradition, kind, slug, title, body_md, status, library_pack) values
  (:src_jain, null, null, 'niva_source', 'pack91-jain', 'Zorbaglorp in the Jain pack', 'The zorbaglorp ceremony belongs to the Jain library.', 'published', 'jain'),
  (:src_open, null, null, 'niva_source', 'pack91-open', 'Zorbaglorp for everyone', 'The zorbaglorp reading room is open to every community.', 'published', null);
select pg_temp.assert(pg_temp.ids(pg_temp.search(:jsh, 'zorbaglorp')) = '91000000-0000-4000-8000-0000000000e1,91000000-0000-4000-8000-0000000000e2',
  'D · JSH is offered the shared Jain source and the open one, as before');
select pg_temp.assert(pg_temp.ids(pg_temp.search(:c_chm, 'zorbaglorp')) = '91000000-0000-4000-8000-0000000000e2'
                      and pg_temp.ids(pg_temp.search(:c_chr, 'zorbaglorp')) = '91000000-0000-4000-8000-0000000000e2'
                      and pg_temp.ids(pg_temp.search(:c_npo, 'zorbaglorp')) = '91000000-0000-4000-8000-0000000000e2',
  'D · a chamber, a church and the neutral experience are offered only the open source, never the Jain one, even with no tradition on it');

rollback;
