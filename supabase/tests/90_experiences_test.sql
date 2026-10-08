-- 0600: experiences, the kind of organization as data (docs/ORGANIZATION_CATEGORIES_PLAN.md, owner direction 2026-10-08).
--   A. The picker: list_experiences before login (only active ones, with their family), and for a platform admin all of them,
--      in picker order; the catalog rules (a faith-based experience has a family, wording is text).
--   B. The mechanism: an experience inherits modules, words and wording pack from its parent, and a new one is one call.
--   C. What each experience shows: roles, notification topics, access areas (and the area is closed when not shown).
--   D. Setup: an experience's own words, a step tagged for another experience is left out, JSH's checklist is unchanged.
--   E. The dietary seed follows the experience (JSH's list unchanged).
--   F. The one read for the member app: JSH as a Jain Center, a chamber, a church; the stamp and what changes it.
--   G. Sandboxes: the applicant's stated kind (the column; the public request function is migration 0612's), one choice
--      to create a sandbox.
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
-- Sign in as a user; a fresh 2FA check (aal2 and a totp step a minute ago) when asked.
create or replace function pg_temp.claims(p_user uuid, p_step_up boolean default false) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', case when p_step_up then 'aal2' else 'aal1' end,
    'amr', case when p_step_up
                then jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 60))
                else jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 60)) end)::text, true);
  perform set_config('request.headers', '', true);
end $$;
create or replace function pg_temp.no_claims() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;
-- The keys of a JSON object, or the items of a JSON array of text, as one sorted comma list.
create or replace function pg_temp.keys(j jsonb) returns text language sql as $$
  select coalesce(string_agg(k, ',' order by k), '') from jsonb_object_keys(j) k
$$;
create or replace function pg_temp.items(j jsonb) returns text language sql as $$
  select coalesce(string_agg(x, ',' order by x), '') from jsonb_array_elements_text(j) x
$$;
-- The dietary choices of an organization as "key:label:sort", in list order.
create or replace function pg_temp.diet(p_center uuid) returns text language sql as $$
  select coalesce(string_agg(key || ':' || label || ':' || sort, ',' order by sort, key), '') from app.dietary_options where center_id = p_center
$$;

\set jsh '''00000000-0000-4000-8000-000000000001'''
\set cc '''90000000-0000-4000-8000-000000000001'''
\set chadmin '''90000000-0000-4000-8000-000000000002'''
\set jadmin '''90000000-0000-4000-8000-000000000003'''
\set c_chm '''90000000-0000-4000-8000-0000000000c1'''
\set c_npo '''90000000-0000-4000-8000-0000000000c2'''
\set c_fth '''90000000-0000-4000-8000-0000000000c3'''
\set c_chr '''90000000-0000-4000-8000-0000000000c4'''
\set c_mos '''90000000-0000-4000-8000-0000000000c5'''
\set c_swm '''90000000-0000-4000-8000-0000000000c6'''
\set c_jc '''90000000-0000-4000-8000-0000000000c7'''

insert into auth.users (id, email) values
  (:cc, 'cc90@platform.test'), (:chadmin, 'chadmin90@chm.test'), (:jadmin, 'jadmin90@jsh.test');
insert into app.accounts (user_id, is_platform_admin) values (:cc, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status) values
  ('f9000000-0000-4000-8000-000000000001', :cc, 'Phone', 'totp', 'verified');

-- One preview sandbox of each experience (a sandbox may take an inactive one), as Community Connect would make them.
insert into app.centers (id, slug, name, environment, category_key, status) values
  (:c_chm, 'chm90-sandbox', 'Chamber 90',        'sandbox', 'chamber_of_commerce', 'onboarding'),
  (:c_npo, 'npo90-sandbox', 'Community 90',      'sandbox', 'nonprofit_secular',   'onboarding'),
  (:c_fth, 'fth90-sandbox', 'Faith 90',          'sandbox', 'faith_other',         'onboarding'),
  (:c_chr, 'chr90-sandbox', 'Church 90',         'sandbox', 'church',              'onboarding'),
  (:c_mos, 'mos90-sandbox', 'Mosque 90',         'sandbox', 'mosque',              'onboarding'),
  (:c_swm, 'swm90-sandbox', 'Swaminarayan 90',   'sandbox', 'swaminarayan_temple', 'onboarding'),
  (:c_jc,  'jc90-sandbox',  'Jain Center 90',    'sandbox', 'jain_center',         'onboarding');
insert into app.role_grants (center_id, user_id, role_key, reason) values
  (:jsh, :jadmin, 'center_admin', 'experience test 90'), (:c_chm, :chadmin, 'center_admin', 'experience test 90');
-- Both administrators are also people of their community (Setup's readiness checks are for a community's own people).
insert into app.households (id, center_id, display_name) values
  ('90000000-0000-4000-8000-0000000000b1', :jsh, 'Office household 90 (JSH)'), ('90000000-0000-4000-8000-0000000000b2', :c_chm, 'Office household 90 (chamber)');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  ('90000000-0000-4000-8000-0000000000a1', :jsh, 'Jo', 'Office90', date '1975-01-01'), ('90000000-0000-4000-8000-0000000000a2', :c_chm, 'Ada', 'Office90', date '1975-01-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  ('90000000-0000-4000-8000-0000000000b1', '90000000-0000-4000-8000-0000000000a1', :jsh, 'primary', true),
  ('90000000-0000-4000-8000-0000000000b2', '90000000-0000-4000-8000-0000000000a2', :c_chm, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values
  (:jsh, :jadmin, '90000000-0000-4000-8000-0000000000a1'), (:c_chm, :chadmin, '90000000-0000-4000-8000-0000000000a2');

-- ══ A. The picker ═══════════════════════════════════════════════════════════
set role anon;
select pg_temp.assert((select array_agg(key order by sort) from app.list_experiences()) = array['jain_center']
                      and (select family_key = 'jain' and family_label = 'Jain' and faith_based and active and sort = 1
                                  and label = 'Jain Center' and description <> ''
                             from app.list_experiences() where key = 'jain_center'),
  'A · a guest (the Request access page) sees only the active experience, with its family');
reset role;
set role authenticated;
select pg_temp.claims(:jadmin);
select pg_temp.assert((select array_agg(key order by sort) from app.list_experiences()) = array['jain_center'],
  'A · a signed-in member or administrator of a community sees only the active experiences too');
select pg_temp.claims(:cc);
select pg_temp.assert((select array_agg(key order by sort) from app.list_experiences())
                        = array['jain_center', 'swaminarayan_temple', 'church', 'mosque', 'faith_other', 'chamber_of_commerce', 'nonprofit_secular']
                      and (select array_agg(sort order by sort) from app.list_experiences()) = array[1, 2, 3, 4, 5, 6, 7],
  'A · a platform admin sees all seven, faith-based first (by family), then the others; sort is the position');
select pg_temp.assert((select array_agg(coalesce(family_key, '-') || '/' || coalesce(family_label, '-') order by sort) from app.list_experiences())
                        = array['jain/Jain', 'hindu/Hindu', 'christian/Christian', 'muslim/Muslim', 'other_faith/Other faith', '-/-', '-/-']
                      and (select array_agg(faith_based order by sort) from app.list_experiences()) = array[true, true, true, true, true, false, false]
                      and (select array_agg(active order by sort) from app.list_experiences()) = array[true, false, false, false, false, false, false],
  'A · family, faith-based and active are on every row; Chamber and the neutral experience have no family');
select pg_temp.assert((select label || '|' || description from app.list_experiences() where key = 'nonprofit_secular')
                        = 'Community organization|Clubs, associations, non-profits and any other group that is not a house of worship'
                      and (select label from app.list_experiences() where key = 'faith_other') = 'Faith community',
  'A · the neutral experience is "Community organization", the generic faith is "Faith community"');
reset role;
select pg_temp.no_claims();
select pg_temp.assert(has_function_privilege('anon', 'app.list_experiences()', 'execute')
                      and has_function_privilege('authenticated', 'app.list_experiences()', 'execute')
                      and has_function_privilege('anon', 'app.member_experience(uuid, text)', 'execute')
                      and not has_function_privilege('anon', 'app.add_experience(text, text, text, text, text, integer, jsonb, jsonb, boolean)', 'execute')
                      and not has_function_privilege('authenticated', 'app.experience_apply_tags()', 'execute'),
  'A · the picker and the one read are open to guests; building an experience is not');
set role anon;
select pg_temp.assert((select count(*) from app.experience_families) = 8 and (select count(*) from app.category_dietary_options) >= 3,
  'A · guests read the families and the dietary extras');
select pg_temp.assert_raises($$select count(*) from app.setup_step_wording$$, 'permission denied', 'A · but not the Setup wording');
reset role;
select pg_temp.assert_raises($$insert into app.organization_categories (key, label, faith_based, terms) values ('faith_nofam90', 'Faith without a family', true,
    '{"greeting":"Welcome","practice_tab":null,"give_tab":"Give","family_tab":"Family","store":"Store","school":null,"learning":null,"place":"office","assistant_context":"a test"}')$$,
  'organization_categories_faith_needs_family', 'A · a faith-based experience needs a family');
select pg_temp.assert_raises($$insert into app.organization_categories (key, label, faith_based, family_key, terms) values ('mismatch90', 'Mismatch', false, 'jain',
    '{"greeting":"Welcome","practice_tab":null,"give_tab":"Give","family_tab":"Family","store":"Store","school":null,"learning":null,"place":"office","assistant_context":"a test"}')$$,
  'must both be faith-based', 'A · a family and its experiences are both faith-based, or neither');
select pg_temp.assert_raises($$insert into app.organization_categories (key, label, faith_based, wording, terms) values ('wording90', 'Wording', false, '{"a": 1}',
    '{"greeting":"Welcome","practice_tab":null,"give_tab":"Give","family_tab":"Family","store":"Store","school":null,"learning":null,"place":"office","assistant_context":"a test"}')$$,
  'organization_categories_wording_ok', 'A · wording is text');
select pg_temp.assert((select family_key = 'jain' and wording_pack = 'jain' and library_pack = 'jain' and wording = '{}'::jsonb and inherits_from is null and lineage = array['jain_center']
                         from app.organization_categories where key = 'jain_center')
                      and (select wording_pack = 'chamber' and family_key is null and library_pack is null from app.organization_categories where key = 'chamber_of_commerce')
                      and (select wording_pack = 'neutral' and family_key is null and terms->>'assistant_context' = 'a community organization'
                             from app.organization_categories where key = 'nonprofit_secular')
                      and (select wording_pack = 'faith' and family_key = 'other_faith' from app.organization_categories where key = 'faith_other'),
  'A · Jain Center keeps its words and an empty wording; each other experience names its wording pack');

-- ══ B. The mechanism ════════════════════════════════════════════════════════
select pg_temp.assert((select lineage = array['church', 'faith_other'] and inherits_from = 'faith_other' and not active and family_key = 'christian'
                              and wording_pack = 'faith' and faith_based and terms->>'greeting' = 'Welcome' and terms->>'place' = 'church'
                              and terms->>'school' = 'Sunday school' and terms->>'practice_tab' = 'Learn'
                         from app.organization_categories where key = 'church')
                      and (select terms->>'greeting' = 'Jai Swaminarayan' and terms->>'place' = 'mandir' and terms->>'school' = 'Religious school'
                                  and family_key = 'hindu' and not active
                         from app.organization_categories where key = 'swaminarayan_temple')
                      and (select terms->>'place' = 'mosque' and terms->>'school' = 'Weekend school' and terms->>'learning' = 'Learning path'
                                  and family_key = 'muslim' and not active
                         from app.organization_categories where key = 'mosque'),
  'B · Church, Swaminarayan Temple and Mosque start from the generic faith with only their own words changed, and are inactive');
select pg_temp.assert(not exists (select 1 from app.category_modules a join app.category_modules b on b.module_key = a.module_key and b.category_key = 'faith_other'
                                   where a.category_key in ('church', 'mosque', 'swaminarayan_temple') and a.availability is distinct from b.availability)
                      and (select label from app.category_modules where category_key = 'church' and module_key = 'pathshala') = 'Sunday school'
                      and (select label from app.category_modules where category_key = 'church' and module_key = 'gyan_path') = 'Faith formation'
                      and (select label from app.category_modules where category_key = 'mosque' and module_key = 'pathshala') = 'Weekend school'
                      and (select label from app.category_modules where category_key = 'swaminarayan_temple' and module_key = 'pathshala') = 'Religious school'
                      and (select availability from app.category_modules where category_key = 'church' and module_key = 'bolis') = 'not_available'
                      and (select availability from app.category_modules where category_key = 'church' and module_key = 'pathshala') = 'default_off',
  'B · their modules are the generic faith''s (no Bolis or My Jain Way, Pathshala and Gyan Path switchable), named in their own words');
-- A new experience is one call; nothing else is needed.
savepoint a_new_experience;
select app.add_experience('gurdwara90', 'Gurdwara', 'Sikh gurdwaras', 'faith_other', 'sikh', 44,
                          '{"place":"gurdwara"}'::jsonb, '{"home.today":"Sat Sri Akal"}'::jsonb);
select pg_temp.assert((select lineage = array['gurdwara90', 'faith_other'] and terms->>'place' = 'gurdwara' and terms->>'greeting' = 'Welcome'
                              and wording->>'home.today' = 'Sat Sri Akal' and wording_pack = 'faith' and family_key = 'sikh' and not active
                         from app.organization_categories where key = 'gurdwara90')
                      and not exists (select 1 from app.category_modules a join app.category_modules b on b.module_key = a.module_key and b.category_key = 'faith_other'
                                       where a.category_key = 'gurdwara90' and (a.availability, a.label) is distinct from (b.availability, b.label))
                      and (select count(*) from app.category_modules where category_key = 'gurdwara90') = (select count(*) from app.modules),
  'B · a new experience inherits the modules, words and wording pack of its parent and changes only what it says');
select pg_temp.assert(app.catalog_shows((select category_keys from app.roles where key = 'religious_coordinator'), 'gurdwara90')
                      and not app.catalog_shows((select category_keys from app.roles where key = 'boli_recorder'), 'gurdwara90')
                      and app.catalog_shows((select category_keys from app.access_features where key = 'learn'), 'gurdwara90')
                      and not app.catalog_shows((select category_keys from app.access_features where key = 'darshan'), 'gurdwara90'),
  'B · and what it shows follows its parent with no copying (roles, access areas)');
set role authenticated;
select pg_temp.claims(:cc);
select pg_temp.assert((select family_key = 'sikh' and family_label = 'Sikh' and not active and sort = 5 from app.list_experiences() where key = 'gurdwara90')
                      and (select count(*) from app.list_experiences()) = 8,
  'B · it appears in the picker for a platform admin under its family, with no change to any code');
reset role;
select pg_temp.no_claims();
select pg_temp.assert_raises($$select app.add_experience('orphan90', 'Orphan', '', 'no_such_parent', 'sikh', 90)$$,
  'no experience called', 'B · an experience needs a parent that exists');
rollback to savepoint a_new_experience;
select pg_temp.assert((select count(*) from app.organization_categories) = 7 and not exists (select 1 from app.organization_categories where key = 'gurdwara90'),
  'B · (and the rollback put the catalog back)');

-- ══ C. What each experience shows ═══════════════════════════════════════════
select pg_temp.assert((select count(*) from app.roles where app.catalog_shows(category_keys, 'jain_center')) = (select count(*) from app.roles)
                      and (select array_agg(key order by key) from app.roles where not app.catalog_shows(category_keys, 'chamber_of_commerce'))
                            = array['boli_recorder', 'pathshala_committee', 'pathshala_principal', 'religious_coordinator', 'teacher']
                      and (select array_agg(key order by key) from app.roles where not app.catalog_shows(category_keys, 'nonprofit_secular'))
                            = array['boli_recorder', 'pathshala_committee', 'pathshala_principal', 'religious_coordinator', 'teacher']
                      and (select array_agg(key order by key) from app.roles where not app.catalog_shows(category_keys, 'faith_other')) = array['boli_recorder']
                      and (select array_agg(key order by key) from app.roles where not app.catalog_shows(category_keys, 'church')) = array['boli_recorder']
                      and (select array_agg(key order by key) from app.roles where not app.catalog_shows(category_keys, 'mosque')) = array['boli_recorder'],
  'C · roles: a Jain Center has them all; a chamber and the neutral experience have no religious coordinator, boli recorder or Pathshala roles; a faith community has all but the boli recorder');
select pg_temp.assert(pg_temp.keys(app.member_experience(:jsh)->'access'->'features') = 'darshan,guide,learn,listen,look,niva,puja,timings'
                      and pg_temp.keys(app.member_experience(:c_jc)->'access'->'features') = 'darshan,guide,learn,listen,look,niva,puja,timings'
                      and pg_temp.keys(app.member_experience(:c_chm)->'access'->'features') = 'guide,listen,look,niva'
                      and pg_temp.keys(app.member_experience(:c_npo)->'access'->'features') = 'guide,listen,look,niva'
                      and pg_temp.keys(app.member_experience(:c_fth)->'access'->'features') = 'guide,learn,listen,look,niva'
                      and pg_temp.keys(app.member_experience(:c_chr)->'access'->'features') = 'guide,learn,listen,look,niva'
                      and pg_temp.keys(app.member_experience(:c_mos)->'access'->'features') = 'guide,learn,listen,look,niva'
                      and pg_temp.keys(app.member_experience(:c_swm)->'access'->'features') = 'guide,learn,listen,look,niva',
  'C · access areas: a Jain Center has all eight; a chamber and the neutral experience have the guide, listen, look and Ask Niva; a faith community adds learn');
select pg_temp.assert(app.can_use_feature(:jsh, 'darshan') and not app.can_use_feature(:c_chm, 'darshan') and not app.can_use_feature(:c_fth, 'darshan')
                      and not app.can_use_feature(:c_chm, 'timings') and app.can_use_feature(:c_chm, 'guide'),
  'C · and an area an experience does not have is closed, not only hidden');
select pg_temp.assert(pg_temp.items(app.member_experience(:jsh)->'topics') = (select string_agg(key, ',' order by key) from app.notification_topics)
                      and pg_temp.items(app.member_experience(:c_jc)->'topics') = (select string_agg(key, ',' order by key) from app.notification_topics)
                      and (select count(*) from app.notification_topics) >= 10,
  'C · notification topics: a Jain Center shows every topic');
select pg_temp.assert((select string_agg(key, ',' order by key) from app.notification_topics
                        where key <> all (array['pathshala', 'timings', 'jain_way'])) = pg_temp.items(app.member_experience(:c_chm)->'topics')
                      and (select string_agg(key, ',' order by key) from app.notification_topics
                            where key <> all (array['pathshala', 'timings', 'jain_way'])) = pg_temp.items(app.member_experience(:c_npo)->'topics')
                      and (select string_agg(key, ',' order by key) from app.notification_topics
                            where key <> all (array['timings', 'jain_way'])) = pg_temp.items(app.member_experience(:c_fth)->'topics')
                      and (select string_agg(key, ',' order by key) from app.notification_topics
                            where key <> all (array['timings', 'jain_way'])) = pg_temp.items(app.member_experience(:c_chr)->'topics'),
  'C · notification topics: a chamber and the neutral experience have no Pathshala, temple timings or My Jain Way; a faith community keeps Pathshala');
set role authenticated;
select pg_temp.claims(:cc);
select pg_temp.assert(pg_temp.keys((select jsonb_object_agg(f->>'key', true) from jsonb_array_elements(app.access_settings(:c_chm)->'features') f)) = 'guide,listen,look,niva'
                      and jsonb_array_length(app.access_settings(:jsh)->'features') = 8,
  'C · Settings › Access levels lists the areas of the experience only (JSH: all eight)');
reset role;
select pg_temp.no_claims();

-- ══ D. Setup ════════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:chadmin);
select pg_temp.assert((select help from app.setup_checklist(:c_chm) where step_key = 'org.profile') not like '%navkarsi%'
                      and (select help from app.setup_checklist(:c_chm) where step_key = 'org.profile') like '%place your organization on the map%'
                      and (select description from app.setup_checklist(:c_chm) where step_key = 'org.rules') not like '%bolis%'
                      and (select owner_role from app.setup_checklist(:c_chm) where step_key = 'niva.train') = 'Communications officer'
                      and (select help from app.setup_checklist(:c_chm) where step_key = 'org.legal_identity') like '%501(c)(6)%',
  'D · a chamber''s Setup says nothing of navkarsi, bolis or the religious coordinator, and speaks of the 501(c)(6) letter');
select pg_temp.assert((select count(*) from app.setup_checklist(:c_chm)) = (select count(*) from app.setup_steps)
                      and not exists (select 1 from app.setup_checklist(:c_chm) where module_key in ('bolis', 'pathshala', 'gyan_path', 'jain_way')
                                        and (status <> 'skipped' or detail <> 'Not part of a Chamber of commerce organization.')),
  'D · every step is still listed, and the steps of modules the chamber does not have are skipped with the category sentence');
select pg_temp.claims(:jadmin);
select pg_temp.assert(not exists (select 1 from app.setup_checklist(:jsh) c join app.setup_steps s on s.key = c.step_key
                                   where (c.title, c.description, c.help, c.done_means, c.owner_role)
                                         is distinct from (s.title, s.description, s.help, s.done_means, s.owner_role))
                      and (select count(*) from app.setup_checklist(:jsh)) = (select count(*) from app.setup_steps)
                      and (select help from app.setup_checklist(:jsh) where step_key = 'org.profile') like '%navkarsi%',
  'D · JSH''s Setup checklist is the catalog''s own, word for word');
reset role;
select pg_temp.no_claims();
savepoint a_tagged_step;
update app.setup_steps set category_keys = array['jain_center'] where key = 'data.zones';
set role authenticated;
select pg_temp.claims(:chadmin);
select pg_temp.assert(not exists (select 1 from app.setup_checklist(:c_chm) where step_key = 'data.zones'), 'D · a step tagged for another experience is left out of a chamber''s checklist');
select pg_temp.claims(:jadmin);
select pg_temp.assert(exists (select 1 from app.setup_checklist(:jsh) where step_key = 'data.zones'), 'D · and kept for JSH');
reset role;
select pg_temp.no_claims();
rollback to savepoint a_tagged_step;

-- ══ E. The dietary seed ═════════════════════════════════════════════════════
select pg_temp.assert(pg_temp.diet(:jsh) = 'vegetarian:Vegetarian:1,vegan:Vegan:2,jain:Jain (no root vegetables):3,gluten_free:Gluten-free:4,nut_allergy:Nut allergy:5,diabetic:Diabetic:6,other:Other:99'
                      and pg_temp.diet(:c_jc) = pg_temp.diet(:jsh),
  'E · a Jain Center''s list is today''s seven, in the same order with the same names (JSH''s is unchanged)');
select pg_temp.assert(pg_temp.diet(:c_chm) = 'vegetarian:Vegetarian:1,vegan:Vegan:2,gluten_free:Gluten-free:4,nut_allergy:Nut allergy:5,diabetic:Diabetic:6,other:Other:99'
                      and pg_temp.diet(:c_npo) = pg_temp.diet(:c_chm) and pg_temp.diet(:c_fth) = pg_temp.diet(:c_chm) and pg_temp.diet(:c_chr) = pg_temp.diet(:c_chm),
  'E · a chamber, the neutral experience, the generic faith and a church have the six common choices and no Jain option');
select pg_temp.assert(pg_temp.diet(:c_mos) = 'vegetarian:Vegetarian:1,vegan:Vegan:2,halal:Halal:3,gluten_free:Gluten-free:4,nut_allergy:Nut allergy:5,diabetic:Diabetic:6,other:Other:99'
                      and pg_temp.diet(:c_swm) like '%satvik:Satvik (no onion or garlic):3%' and pg_temp.diet(:c_swm) not like '%jain%',
  'E · an experience adds its own dietary choices (Mosque: halal, Swaminarayan Temple: satvik)');

-- ══ F. The one read for the member app ══════════════════════════════════════
select app.member_experience(:jsh) as v_jsh \gset
select pg_temp.assert(pg_temp.keys(:'v_jsh'::jsonb) = 'access,center,default_path,experience,flags,modules,paths,setup,stamp,topics,unchanged,updated_at'
                      and (:'v_jsh'::jsonb)->'experience'->>'key' = 'jain_center' and (:'v_jsh'::jsonb)->'experience'->>'family_key' = 'jain'
                      and (:'v_jsh'::jsonb)->'experience'->>'family_label' = 'Jain' and (:'v_jsh'::jsonb)->'experience'->>'wording_pack' = 'jain'
                      and (:'v_jsh'::jsonb)->'experience'->'wording' = '{}'::jsonb and (:'v_jsh'::jsonb)->'experience'->>'library_pack' = 'jain'
                      and (:'v_jsh'::jsonb)->'experience'->'terms'->>'greeting' = 'Jai Jinendra'
                      and (:'v_jsh'::jsonb)->'experience'->'terms'->>'practice_tab' = 'Jain Way'
                      and (:'v_jsh'::jsonb)->'experience'->>'path_label' = 'Which Jain tradition do you follow?'
                      and (:'v_jsh'::jsonb)->'center'->>'slug' = 'jsh' and ((:'v_jsh'::jsonb)->>'unchanged')::boolean = false,
  'F · JSH reads as a Jain Center: its words, its family, its wording pack, nothing extra');
select pg_temp.assert(not exists (select 1 from jsonb_each((:'v_jsh'::jsonb)->'modules') m
                                   where m.value->>'availability' <> 'default_on'
                                      or (m.value->>'enabled')::boolean is distinct from app.module_enabled(:jsh, m.key))
                      and (select count(*) from jsonb_each((:'v_jsh'::jsonb)->'modules')) = (select count(*) from app.modules)
                      and ((:'v_jsh'::jsonb)->'flags'->>'labh')::boolean and ((:'v_jsh'::jsonb)->'flags'->>'school')::boolean = app.module_enabled(:jsh, 'pathshala')
                      and ((:'v_jsh'::jsonb)->'setup'->'timings'->>'enabled')::boolean
                      and jsonb_typeof((:'v_jsh'::jsonb)->'setup'->'home_shortcuts') = 'null'
                      and jsonb_array_length((:'v_jsh'::jsonb)->'paths') = 10 and (:'v_jsh'::jsonb)->>'default_path' = 'shwetambar_murtipujak'
                      and (:'v_jsh'::jsonb)->'access' = app.feature_access_for_me(:jsh),
  'F · JSH: every module available as before and on as its administrator set it, the access answer unchanged, timings on, its ten paths');
set role anon;
select pg_temp.assert(app.member_experience(:jsh)->'experience'->>'key' = 'jain_center'
                      and app.member_experience(:jsh)->'access'->>'signed_in' = 'false'
                      and (app.member_experience(:jsh)->'access'->'features'->'darshan'->>'allowed')::boolean,
  'F · a guest gets the same read, with the access of a visitor (the live darshan is open to the public by default)');
select pg_temp.assert_raises($$select app.member_experience('90000000-0000-4000-8000-00000000dead')$$, 'That community was not found.',
  'F · an unknown community is not found');
reset role;
select app.member_experience(:c_chm) as v_chm \gset
select pg_temp.assert((:'v_chm'::jsonb)->'experience'->>'key' = 'chamber_of_commerce' and (:'v_chm'::jsonb)->'experience'->>'wording_pack' = 'chamber'
                      and jsonb_typeof((:'v_chm'::jsonb)->'experience'->'family_key') = 'null' and jsonb_typeof((:'v_chm'::jsonb)->'experience'->'library_pack') = 'null'
                      and (:'v_chm'::jsonb)->'experience'->'terms'->>'greeting' = 'Welcome' and (:'v_chm'::jsonb)->'experience'->'terms'->>'family_tab' = 'My business'
                      and (:'v_chm'::jsonb)->'modules'->'bolis'->>'availability' = 'not_available'
                      and not ((:'v_chm'::jsonb)->'modules'->'bolis'->>'enabled')::boolean
                      and (:'v_chm'::jsonb)->'modules'->'store'->>'availability' = 'default_off' and not ((:'v_chm'::jsonb)->'modules'->'store'->>'enabled')::boolean
                      and (:'v_chm'::jsonb)->'modules'->'giving'->>'label' = 'Dues & payments' and ((:'v_chm'::jsonb)->'modules'->'giving'->>'enabled')::boolean
                      and (:'v_chm'::jsonb)->'modules'->'people'->>'label' = 'Members & families'
                      and not ((:'v_chm'::jsonb)->'flags'->>'school')::boolean and not ((:'v_chm'::jsonb)->'flags'->>'learning')::boolean
                      and not ((:'v_chm'::jsonb)->'flags'->>'store')::boolean and not ((:'v_chm'::jsonb)->'flags'->>'labh')::boolean
                      and not ((:'v_chm'::jsonb)->'flags'->>'practice')::boolean and not ((:'v_chm'::jsonb)->'flags'->>'niva')::boolean
                      and not ((:'v_chm'::jsonb)->'setup'->'timings'->>'enabled')::boolean
                      and jsonb_array_length((:'v_chm'::jsonb)->'paths') = 0 and jsonb_typeof((:'v_chm'::jsonb)->'default_path') = 'null',
  'F · a chamber: its words, no Bolis, Pathshala or labh, Store and Niva off until switched on, no timings, no paths');
select app.member_experience(:c_chr) as v_chr \gset
select pg_temp.assert((:'v_chr'::jsonb)->'experience'->>'key' = 'church' and (:'v_chr'::jsonb)->'experience'->>'family_key' = 'christian'
                      and (:'v_chr'::jsonb)->'experience'->>'family_label' = 'Christian' and (:'v_chr'::jsonb)->'experience'->>'inherits_from' = 'faith_other'
                      and (:'v_chr'::jsonb)->'experience'->>'wording_pack' = 'faith' and jsonb_typeof((:'v_chr'::jsonb)->'experience'->'library_pack') = 'null'
                      and (:'v_chr'::jsonb)->'experience'->'terms'->>'school' = 'Sunday school'
                      and (:'v_chr'::jsonb)->'modules'->'pathshala'->>'label' = 'Sunday school'
                      and (:'v_chr'::jsonb)->'modules'->'pathshala'->>'availability' = 'default_off'
                      and not ((:'v_chr'::jsonb)->'modules'->'pathshala'->>'enabled')::boolean
                      and (:'v_chr'::jsonb)->'modules'->'jain_way'->>'availability' = 'not_available',
  'F · a church: its family, its parent, its own words for the school and the learning, Pathshala available but off');

-- The stamp.
select (:'v_jsh'::jsonb)->>'stamp' as s1 \gset
select rules as orig_rules, branding as orig_branding from app.centers where id = :jsh \gset
select pg_temp.assert(app.member_experience(:jsh)->>'stamp' = :'s1' and length(:'s1') = 32,
  'H · the stamp is steady: the same community read twice gives the same stamp');
select pg_temp.assert(pg_temp.keys(app.member_experience(:jsh, :'s1')) = 'stamp,unchanged,updated_at'
                      and (app.member_experience(:jsh, :'s1')->>'unchanged')::boolean
                      and pg_temp.keys(app.member_experience(:jsh, 'not-the-stamp')) = pg_temp.keys(:'v_jsh'::jsonb),
  'H · asked with the stamp it already has, the answer is only {stamp, unchanged}; with another stamp it is the whole read');
set role authenticated;
select pg_temp.claims(:jadmin);
select app.set_module_enabled(:jsh, 'store', false, 'Test 90: the store is closed for a while');
reset role;
select pg_temp.no_claims();
select app.member_experience(:jsh)->>'stamp' as s2 \gset
select pg_temp.assert(:'s2' <> :'s1' and not (app.member_experience(:jsh)->'modules'->'store'->>'enabled')::boolean
                      and not (app.member_experience(:jsh)->'flags'->>'store')::boolean,
  'H · an administrator''s module switch changes the stamp (and the read says the module is off)');
set role authenticated;
select pg_temp.claims(:jadmin);
select app.set_module_enabled(:jsh, 'store', true, 'Test 90: the store is open again');
reset role;
select pg_temp.no_claims();
select pg_temp.assert(app.member_experience(:jsh)->>'stamp' = :'s1', 'H · and switching it back brings the stamp back (it is a fingerprint of what the app shows)');
update app.centers set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{home}', '{"shortcuts":["photos","guide"]}'::jsonb) where id = :jsh;
select pg_temp.assert(app.member_experience(:jsh)->>'stamp' <> :'s1' and app.member_experience(:jsh)->'setup'->'home_shortcuts' = '["photos","guide"]'::jsonb,
  'H · the home shortcuts the administrator chose are in the read and change the stamp');
update app.centers set rules = :'orig_rules'::jsonb where id = :jsh;
update app.centers set branding = jsonb_build_object('wordmark', jsonb_build_array('JAIN SOCIETY', 'OF HOUSTON')) where id = :jsh;
select pg_temp.assert(app.member_experience(:jsh)->>'stamp' <> :'s1' and app.member_experience(:jsh)->'setup'->'branding'->'wordmark' = '["JAIN SOCIETY","OF HOUSTON"]'::jsonb,
  'H · branding is in the read and changes the stamp');
update app.centers set branding = :'orig_branding'::jsonb where id = :jsh;
update app.access_levels set label = 'Everyone' where center_id = :jsh and key = 'public';
select pg_temp.assert(app.member_experience(:jsh)->>'stamp' <> :'s1' and app.member_experience(:jsh)->'access'->'level'->>'label' = 'Everyone',
  'H · access levels are in the read and change the stamp');
update app.access_levels set label = 'Public' where center_id = :jsh and key = 'public';
select pg_temp.assert(app.member_experience(:jsh)->>'stamp' = :'s1', 'H · and everything put back gives the first stamp again');
select app.member_experience(:c_chm)->>'stamp' as s_chm \gset
set role authenticated;
select pg_temp.claims(:cc, true);
select app.set_center_category(:c_chm, 'nonprofit_secular', 'Test 90: the chamber is really a club');
reset role;
select pg_temp.no_claims();
select pg_temp.assert(app.member_experience(:c_chm)->>'stamp' <> :'s_chm' and app.member_experience(:c_chm)->'experience'->>'key' = 'nonprofit_secular'
                      and app.member_experience(:c_chm)->'experience'->>'label' = 'Community organization',
  'H · changing a community''s kind (set_center_category) changes the stamp and the read follows');

-- ══ G. Sandboxes ════════════════════════════════════════════════════════════
-- The applicant's stated kind is the column access_requests.requested_category_key (the public request function that writes it
-- is migration 0612's). The sandbox made from a request: Community Connect's choice, else the applicant's, else Jain Center.
insert into app.access_requests (id, org_legal_name, org_type, city, state, contact_name, contact_email, requested_category_key) values
  ('90000000-0000-4000-8000-0000000000f1', 'Request Chamber 90', 'other_nonprofit', 'Houston', 'TX', 'Rita Request', 'rita90@req.test', 'chamber_of_commerce'),
  ('90000000-0000-4000-8000-0000000000f2', 'Request Club 90', 'other_nonprofit', 'Houston', 'TX', 'Cleo Request', 'cleo90@req.test', 'chamber_of_commerce'),
  ('90000000-0000-4000-8000-0000000000f3', 'Request Temple 90', 'temple', 'Houston', 'TX', 'Tej Request', 'tej90@req.test', null);
select pg_temp.assert_raises($$insert into app.access_requests (org_legal_name, org_type, city, state, contact_name, contact_email, requested_category_key)
    values ('Bad Kind 90', 'temple', 'Houston', 'TX', 'Bo Bad', 'bo90@req.test', 'no_such_kind')$$,
  'requested_category_key', 'G · a stated kind must be a real experience');
set role authenticated;
select pg_temp.claims(:cc, true);
select app.set_access_request_category('90000000-0000-4000-8000-0000000000f2', 'nonprofit_secular');
reset role;
select pg_temp.no_claims();
select app._create_sandbox_center('req90a', 'Request Chamber 90', 'TX', 'Houston', null, jsonb_build_object('request_id', '90000000-0000-4000-8000-0000000000f1'::uuid)) as q1 \gset
select app._create_sandbox_center('req90b', 'Request Club 90', 'TX', 'Houston', null, jsonb_build_object('request_id', '90000000-0000-4000-8000-0000000000f2'::uuid)) as q2 \gset
select app._create_sandbox_center('req90c', 'Request Temple 90', 'TX', 'Houston', null, jsonb_build_object('request_id', '90000000-0000-4000-8000-0000000000f3'::uuid)) as q3 \gset
select pg_temp.assert((select category_key from app.centers where id = :'q1') = 'chamber_of_commerce'
                      and (select category_key from app.centers where id = :'q2') = 'nonprofit_secular'
                      and (select category_key from app.centers where id = :'q3') = 'jain_center',
  'G · the sandbox takes Community Connect''s choice, else the applicant''s, else Jain Center (as before)');
-- Platform › New sandbox: the experience is the only choice.
set role authenticated;
select pg_temp.claims(:cc, true);
select app.platform_create_sandbox('Grace Church 90', 'grace90', '', 'Austin', 'TX', 'Pat', 'Pastor', 'pat90@grace.test',
                                   'Preview of the church experience', 'http://portal.test', 'church') as made_church \gset
select app.platform_create_sandbox('Houston Chamber 90', 'hcc90', null, 'Houston', 'TX', 'Chet', 'Owner', 'chet90@hcc.test',
                                   'Preview of the chamber experience', 'http://portal.test', 'chamber_of_commerce') as made_chm \gset
select pg_temp.assert_raises($$select app.platform_create_sandbox('Bad Type 90', 'bad90', 'mosque', 'Austin', 'TX', 'Bo', 'Owner', 'bo90@bad.test',
    'A reason', 'http://portal.test', 'church')$$, 'kind of organization', 'G · a value given for the older question must still be one of the three');
select pg_temp.assert_raises($$select app.platform_create_sandbox('No Kind 90', 'nokind90', '', 'Austin', 'TX', 'Bo', 'Owner', 'bo90@bad.test',
    'A reason', 'http://portal.test', 'no_such_experience')$$, 'Choose the kind of organization', 'G · an unknown kind is refused');
reset role;
select pg_temp.no_claims();
select pg_temp.assert((select category_key = 'church' and environment = 'sandbox' and rules #>> '{onboarding,org_type}' = 'temple'
                         from app.centers where id = ((:'made_church'::jsonb)->>'center_id')::uuid)
                      and (select category_key = 'chamber_of_commerce' and rules #>> '{onboarding,org_type}' = 'other_nonprofit'
                         from app.centers where id = ((:'made_chm'::jsonb)->>'center_id')::uuid)
                      and pg_temp.diet(((:'made_church'::jsonb)->>'center_id')::uuid) = pg_temp.diet(:c_chm),
  'G · a sandbox needs one choice: the experience (the older "kind" is worked out from it), and it starts with that experience''s dietary list');

rollback;
