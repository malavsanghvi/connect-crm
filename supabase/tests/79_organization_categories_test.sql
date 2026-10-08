-- 0594: organization categories, database part 1 of 3 (docs/ORGANIZATION_CATEGORIES_PLAN.md, section 6 "Test plan").
--   A. The catalogs: four categories (only Jain Center active), a row for every category and module, core modules
--      always on, no available module depends on one that is not, the Jain Center paths, guests read them.
--   B. JSH UNCHANGED: for every Jain Center and every module the module functions answer exactly as 0101's definitions
--      did; and a JSH member and a JSH administrator see exactly what they see today (every module table's row count,
--      my_modules, the access areas), proved by running the same reads under 0101's function bodies and comparing.
--   C. A non-Jain community (a chamber preview sandbox): its modules are off in the database (no rows readable, RPCs
--      refuse with the category sentence, storage, Setup, access areas, my_modules); a switch cannot turn them on; Store
--      starts off and can be switched on and off; platform admins pass; tradition is "other"; no Jain dietary option.
--   D. The category can change only through app.set_center_category (not through the table, not by a platform admin),
--      with a reason, a fresh 2FA check and a preview; data is hidden, not deleted, and comes back; paths are kept.
--   E. Creating and promoting carries the category (platform_create_sandbox, the request, the copy route).
--   F. A person's path: validated in plain English, private like the rest of person_profile_details, masked in the audit log.
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
-- The hint of the error a statement raises (null when it raises none).
create or replace function pg_temp.hint_of(stmt text) returns text language plpgsql as $$
declare v text;
begin
  execute stmt;
  return null;
exception when others then
  get stacked diagnostics v = pg_exception_hint;
  return v;
end $$;
-- Rows a statement changed (an UPDATE that RLS filters away changes none and raises nothing).
create or replace function pg_temp.affected(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin execute stmt; get diagnostics n = row_count; return n; end $$;
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
-- What the caller (the current role and JWT) can see of one community: the row count of every module table that has a
-- center_id (as the caller's RLS shows it), my_modules and the access areas.
create or replace function pg_temp.visible_state(p_center uuid) returns jsonb language plpgsql as $$
declare t record; n bigint; v_counts jsonb := '{}'::jsonb;
begin
  for t in
    select mt.table_name
      from app.module_tables mt
     where mt.module_key is not null
       and exists (select 1 from pg_attribute a where a.attrelid = ('app.' || quote_ident(mt.table_name))::regclass
                      and a.attname = 'center_id' and not a.attisdropped)
       and has_table_privilege('app.' || quote_ident(mt.table_name), 'select')
     order by mt.table_name
  loop
    begin
      execute format('select count(*) from app.%I', t.table_name) into n;
    exception when others then
      n := -1;
    end;
    v_counts := v_counts || jsonb_build_object(t.table_name, n);
  end loop;
  return jsonb_build_object('counts', v_counts,
                            'modules', (select jsonb_agg(to_jsonb(m) order by m.key) from app.my_modules(p_center) m),
                            'access', app.feature_access_for_me(p_center));
end $$;
grant connect_worker to postgres;

\set jsh '''00000000-0000-4000-8000-000000000001'''
\set cc '''79000000-0000-4000-8000-000000000001'''
\set cc2 '''79000000-0000-4000-8000-000000000002'''
\set chowner '''79000000-0000-4000-8000-000000000003'''
\set chadmin '''79000000-0000-4000-8000-000000000004'''
\set chmember '''79000000-0000-4000-8000-000000000005'''
\set jowner '''79000000-0000-4000-8000-000000000006'''
\set jadmin '''79000000-0000-4000-8000-000000000007'''
\set mom '''79000000-0000-4000-8000-000000000008'''
\set dad '''79000000-0000-4000-8000-000000000009'''
\set kid '''79000000-0000-4000-8000-00000000000a'''
\set stranger '''79000000-0000-4000-8000-00000000000b'''
\set jshadmin '''79000000-0000-4000-8000-00000000000c'''
\set jshmember '''79000000-0000-4000-8000-00000000000d'''
\set p_mom '''79000000-0000-4000-8000-0000000000a1'''
\set p_dad '''79000000-0000-4000-8000-0000000000a2'''
\set p_kid '''79000000-0000-4000-8000-0000000000a3'''
\set p_stranger '''79000000-0000-4000-8000-0000000000a4'''
\set p_jsh '''79000000-0000-4000-8000-0000000000a5'''
\set p_chm '''79000000-0000-4000-8000-0000000000a6'''
\set h1 '''79000000-0000-4000-8000-0000000000b1'''
\set h2 '''79000000-0000-4000-8000-0000000000b2'''
\set h_jsh '''79000000-0000-4000-8000-0000000000b3'''
\set h_chm '''79000000-0000-4000-8000-0000000000b4'''
\set p_chadm '''79000000-0000-4000-8000-0000000000a7'''
\set h_chadm '''79000000-0000-4000-8000-0000000000b5'''

insert into auth.users (id, email) values
  (:cc, 'cc79@platform.test'), (:cc2, 'cc79b@platform.test'), (:chowner, 'chowner79@hcc.test'), (:chadmin, 'chadmin79@hcc.test'),
  (:chmember, 'chmember79@hcc.test'), (:jowner, 'owner79@jt79.test'), (:jadmin, 'jadmin79@jt79.test'), (:mom, 'mom79@jt79.test'),
  (:dad, 'dad79@jt79.test'), (:kid, 'kid79@jt79.test'), (:stranger, 'stranger79@jt79.test'),
  (:jshadmin, 'jshadmin79@jsh.test'), (:jshmember, 'jshmember79@jsh.test');
insert into app.accounts (user_id, is_platform_admin) values (:cc, true), (:cc2, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status) values
  ('f7900000-0000-4000-8000-000000000001', :cc, 'Phone', 'totp', 'verified');

-- JSH: an administrator and a member with a household of their own (a family of one).
insert into app.role_grants (center_id, user_id, role_key, reason) values (:jsh, :jshadmin, 'center_admin', 'category test 79');
insert into app.households (id, center_id, display_name) values (:h_jsh, :jsh, 'Equivalence household 79');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values (:p_jsh, :jsh, 'Eq', 'Member79', date '1980-01-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values (:h_jsh, :p_jsh, :jsh, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values (:jsh, :jshmember, :p_jsh);
insert into app.bolis (id, center_id, name, kind) values ('79000000-0000-4000-8000-0000000000e0', :jsh, 'Equivalence boli 79', 'digital');

-- ══ A. The catalogs ═════════════════════════════════════════════════════════
select pg_temp.assert((select array_agg(key order by sort) from app.organization_categories)
                        = array['jain_center', 'chamber_of_commerce', 'nonprofit_secular', 'faith_other', 'swaminarayan_temple', 'church', 'mosque']
                      and (select array_agg(key) from app.organization_categories where active) = array['jain_center'],
  'A · the four categories of 0594 and the three inactive experiences of 0600, and only Jain Center is active');
select pg_temp.assert((select faith_based and uses_tradition and path_label = 'Which Jain tradition do you follow?' from app.organization_categories where key = 'jain_center')
                      and (select not faith_based and not uses_tradition and path_label is null from app.organization_categories where key = 'chamber_of_commerce')
                      and (select not faith_based and not uses_tradition and path_label is null from app.organization_categories where key = 'nonprofit_secular')
                      and (select faith_based and not uses_tradition and path_label is null from app.organization_categories where key = 'faith_other'),
  'A · only Jain Center uses a tradition and asks a path; the others ask none');
select pg_temp.assert((select terms->>'greeting' = 'Jai Jinendra' and terms->>'practice_tab' = 'Jain Way' and terms->>'store' = 'Satvik Store'
                              and terms->>'place' = 'derasar' and terms->>'assistant_context' = 'a Jain community'
                         from app.organization_categories where key = 'jain_center')
                      and (select terms->>'greeting' = 'Welcome' and terms->>'give_tab' = 'Pay' and terms->>'family_tab' = 'My business'
                                  and jsonb_typeof(terms->'practice_tab') = 'null' and jsonb_typeof(terms->'school') = 'null'
                                  and terms->>'assistant_context' = 'a chamber of commerce'
                           from app.organization_categories where key = 'chamber_of_commerce')
                      and (select terms->>'practice_tab' = 'Learn' and terms->>'school' = 'Religious school' and terms->>'learning' = 'Learning path'
                                  and terms->>'place' = 'place of worship'
                           from app.organization_categories where key = 'faith_other'),
  'A · the named words: Jain Center keeps today''s words, a chamber says Welcome / Pay / My business, faith-based says Learn');
select pg_temp.assert_raises($$insert into app.organization_categories (key, label, faith_based, terms) values ('bad_one', 'Bad', false, '{"greeting":"Hi"}')$$,
  'organization_categories_terms_ok', 'A · terms with missing keys are refused');
select pg_temp.assert_raises($$insert into app.organization_categories (key, label, faith_based, terms) values ('bad_two', 'Bad', false,
    '{"greeting":null,"practice_tab":null,"give_tab":"Give","family_tab":"Family","store":"Store","school":null,"learning":null,"place":"office","assistant_context":"x"}')$$,
  'organization_categories_terms_ok', 'A · a greeting cannot be empty');
select pg_temp.assert_raises($$insert into app.organization_categories (key, label, faith_based, terms) values ('bad_three', 'Bad', false,
    '{"greeting":"Hi","practice_tab":null,"give_tab":"Give","family_tab":"Family","store":"Store","school":null,"learning":null,"place":"office","assistant_context":"x","extra":"no"}')$$,
  'organization_categories_terms_ok', 'A · a word the database does not know is refused');

-- Every category has a row for every module; the matrix of the plan.
select pg_temp.assert((select count(*) from app.category_modules) = 126
                      and not exists (select 1 from app.organization_categories k cross join app.modules m
                                       where not exists (select 1 from app.category_modules cm where cm.category_key = k.key and cm.module_key = m.key)),
  'A · every category has a row for every module (7 x 18)');
select pg_temp.assert((select count(*) from app.category_modules where category_key = 'jain_center' and availability = 'default_on' and label is null and description is null) = 18,
  'A · Jain Center: all 18 modules default_on, with no names of their own (today)');
select pg_temp.assert((select array_agg(module_key order by module_key) from app.category_modules where category_key = 'chamber_of_commerce' and availability = 'not_available')
                        = array['bolis', 'gyan_path', 'jain_way', 'pathshala']
                      and (select array_agg(module_key order by module_key) from app.category_modules where category_key = 'chamber_of_commerce' and availability = 'default_off')
                        = array['niva', 'store']
                      and (select label from app.category_modules where category_key = 'chamber_of_commerce' and module_key = 'giving') = 'Dues & payments'
                      and (select label from app.category_modules where category_key = 'chamber_of_commerce' and module_key = 'store') = 'Store',
  'A · a chamber never has Bolis, Gyan Path, My Jain Way or Pathshala; Store and Niva start off; giving is "Dues & payments"');
select pg_temp.assert((select array_agg(module_key order by module_key) from app.category_modules where category_key = 'nonprofit_secular' and availability = 'not_available')
                        = array['bolis', 'gyan_path', 'jain_way', 'pathshala']
                      and (select array_agg(module_key order by module_key) from app.category_modules where category_key = 'nonprofit_secular' and availability = 'default_off')
                        = array['niva', 'store'],
  'A · a secular non-profit: the same modules as a chamber');
select pg_temp.assert((select array_agg(module_key order by module_key) from app.category_modules where category_key = 'faith_other' and availability = 'not_available')
                        = array['bolis', 'jain_way']
                      and (select array_agg(module_key order by module_key) from app.category_modules where category_key = 'faith_other' and availability = 'default_off')
                        = array['gyan_path', 'niva', 'pathshala', 'store']
                      and (select label from app.category_modules where category_key = 'faith_other' and module_key = 'pathshala') = 'Religious school'
                      and (select label from app.category_modules where category_key = 'faith_other' and module_key = 'gyan_path') = 'Learning path',
  'A · other faiths never have Bolis or My Jain Way; Pathshala ("Religious school") and Gyan Path ("Learning path") can be switched on');
select pg_temp.assert(not exists (select 1 from app.category_modules cm join app.modules m on m.key = cm.module_key where m.core and cm.availability <> 'default_on'),
  'A · a core module is default_on in every category');
select pg_temp.assert_raises($$update app.category_modules set availability = 'default_off' where category_key = 'chamber_of_commerce' and module_key = 'people'$$,
  'core platform', 'A · and the database refuses to make one otherwise');
select pg_temp.assert(not exists (
    select 1 from app.category_modules cm
      join app.modules m on m.key = cm.module_key
      cross join lateral unnest(m.depends_on) as d(dep)
      join app.category_modules dm on dm.category_key = cm.category_key and dm.module_key = d.dep
     where cm.availability <> 'not_available' and dm.availability = 'not_available'),
  'A · a module that is available never depends on one that is not');

-- The Jain Center paths.
select pg_temp.assert((select count(*) from app.category_paths) = 10 and (select count(*) from app.category_paths where category_key = 'jain_center') = 10,
  'A · ten Jain Center paths, none for the other categories');
select pg_temp.assert((select array_agg(key order by sort) from app.category_paths where parent_key is null) = array['shwetambar', 'digambar', 'other', 'not_sure']
                      and (select array_agg(key order by sort) from app.category_paths where parent_key = 'shwetambar')
                        = array['shwetambar_murtipujak', 'shwetambar_sthanakvasi', 'shwetambar_terapanth']
                      and (select array_agg(key order by sort) from app.category_paths where parent_key = 'digambar')
                        = array['digambar_bispanthi', 'digambar_terapanth', 'digambar_taranpanth']
                      and not exists (select 1 from app.category_paths c join app.category_paths p on p.category_key = c.category_key and p.key = c.parent_key
                                       where p.parent_key is not null),
  'A · the branches are Shwetambar and Digambar, each with three paths, plus Another path and Not sure; two levels only');
select pg_temp.assert((select tradition from app.category_paths where key = 'shwetambar_murtipujak') = 'shvetambar_murtipujak'
                      and (select tradition from app.category_paths where key = 'shwetambar_sthanakvasi') = 'sthanakvasi'
                      and (select tradition from app.category_paths where key = 'shwetambar_terapanth') = 'terapanthi'
                      and (select tradition from app.category_paths where key = 'digambar') = 'digambar'
                      and (select label from app.category_paths where key = 'shwetambar') like 'Shwetambar%'
                      and (select 'Shvetambar' = any (aliases) from app.category_paths where key = 'shwetambar')
                      and (select 'Beespanthi' = any (aliases) from app.category_paths where key = 'digambar_bispanthi'),
  'A · today''s tradition maps to a path (terapanthi is the Shwetambar Terapanth), "Shwetambar" is the spelling and the others are found by search');
select pg_temp.assert((select count(*) from app.module_tables where table_name in ('organization_categories', 'category_modules', 'category_paths') and module_key is null) = 3
                      and (select count(*) from pg_trigger t where not t.tgisinternal and t.tgfoid = 'app.audit_row'::regproc
                             and t.tgname in ('audit_organization_categories', 'audit_category_modules', 'audit_category_paths')) = 3,
  'A · the three catalogs are core platform tables and audited');
set role anon;
select pg_temp.assert((select count(*) from app.organization_categories) = 7 and (select count(*) from app.category_modules) = 126
                      and (select count(*) from app.category_paths) = 10, 'A · guests read the three catalogs');
select pg_temp.assert_raises($$insert into app.organization_categories (key, label, faith_based, terms) values ('guest_made', 'Guest', false, '{}')$$,
  'permission denied', 'A · a guest cannot write a catalog');
reset role;
set role authenticated;
select pg_temp.claims(:cc, true);
select pg_temp.assert_raises($$update app.category_modules set availability = 'default_on' where category_key = 'chamber_of_commerce' and module_key = 'bolis'$$,
  'permission denied', 'A · not even a platform admin writes a catalog through the API (migrations do)');
reset role;
select pg_temp.no_claims();

-- ══ B. JSH is unchanged ═════════════════════════════════════════════════════
select pg_temp.assert(not exists (select 1 from app.centers where category_key <> 'jain_center'),
  'B · before anything is created, every existing community is a Jain Center (the column default)');
select pg_temp.assert((select category_key = 'jain_center' and tradition = 'shvetambar_murtipujak' and environment = 'production' from app.centers where id = :jsh),
  'B · JSH is a Jain Center, its tradition is unchanged (production, as seeded after the migrations)');
select pg_temp.assert((select count(*) from app.dietary_options where center_id = :jsh and key = 'jain') = 1,
  'B · and its dietary list still has the Jain option');
-- (called as the superuser, but with a platform admin's JWT: the readiness part refuses a caller who is not staff of the
-- community, and the go-live part one without settings.manage)
select pg_temp.claims(:cc, true);
select pg_temp.assert(app.setup_auto_status(:jsh) = app._setup_auto_status_before_0594(:jsh),
  'B · Setup''s computed statuses for JSH are exactly what they were');
select pg_temp.no_claims();
select pg_temp.assert((select bool_and(app.module_availability(:jsh, m.key) = 'default_on') and count(*) = 18 from app.modules m),
  'B · every one of the 18 modules is default_on for JSH');

-- Reads as a JSH administrator and as a JSH member, with every module on (any switch earlier tests left is cleared; the
-- whole test is rolled back), under the new functions...
delete from app.center_modules where center_id = :jsh;
set role authenticated;
select pg_temp.claims(:jshadmin, true);
select pg_temp.visible_state(:jsh) as a_new \gset
select pg_temp.claims(:jshmember, true);
select pg_temp.visible_state(:jsh) as am_new \gset
reset role;
select pg_temp.no_claims();
-- ...and under 0101's definitions of the two functions every module table's policy and every RPC guard use.
savepoint as_in_0101;
create or replace function app.module_enabled(p_center uuid, p_module text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select not exists (select 1 from app.center_modules
                      where center_id = p_center and module_key = p_module and not enabled)
$$;
create or replace function app.module_off_centers(p_module text) returns uuid[]
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(array_agg(center_id), '{}') from app.center_modules where module_key = p_module and not enabled
$$;
set role authenticated;
select pg_temp.claims(:jshadmin, true);
select pg_temp.visible_state(:jsh) as a_old \gset
select pg_temp.claims(:jshmember, true);
select pg_temp.visible_state(:jsh) as am_old \gset
reset role;
select pg_temp.no_claims();
rollback to savepoint as_in_0101;
select pg_temp.assert(:'a_new'::jsonb = :'a_old'::jsonb, 'B · a JSH administrator reads the same rows from every module table, the same my_modules and the same access areas as under 0101');
select pg_temp.assert(:'am_new'::jsonb = :'am_old'::jsonb, 'B · a JSH member reads the same rows from every module table, the same my_modules and the same access areas as under 0101');
select pg_temp.assert(jsonb_array_length(:'am_new'::jsonb->'modules') = 18
                      and (select bool_and((e->>'enabled')::boolean) from jsonb_array_elements(:'am_new'::jsonb->'modules') e),
  'B · my_modules(JSH) returns the same 18 rows, all on');
select pg_temp.assert((select count(*) from jsonb_each(:'a_new'::jsonb->'counts') e where (e.value)::text::bigint >= 0) > 40
                      and (:'a_new'::jsonb->'counts'->>'bolis')::bigint >= 1,
  'B · the comparison is not empty: dozens of module tables were counted and the administrator reads the boli');

-- The same with four modules switched off by JSH itself (the switch is the 0101 rule, untouched).
insert into app.center_modules (center_id, module_key, enabled, reason) values
  (:jsh, 'bolis', false, 'equivalence 79'), (:jsh, 'store', false, 'equivalence 79'),
  (:jsh, 'jain_way', false, 'equivalence 79'), (:jsh, 'pathshala', false, 'equivalence 79');
set role authenticated;
select pg_temp.claims(:jshadmin, true);
select pg_temp.visible_state(:jsh) as b_new \gset
select pg_temp.claims(:jshmember, true);
select pg_temp.visible_state(:jsh) as bm_new \gset
reset role;
select pg_temp.no_claims();
savepoint as_in_0101_again;
create or replace function app.module_enabled(p_center uuid, p_module text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select not exists (select 1 from app.center_modules
                      where center_id = p_center and module_key = p_module and not enabled)
$$;
create or replace function app.module_off_centers(p_module text) returns uuid[]
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(array_agg(center_id), '{}') from app.center_modules where module_key = p_module and not enabled
$$;
set role authenticated;
select pg_temp.claims(:jshadmin, true);
select pg_temp.visible_state(:jsh) as b_old \gset
select pg_temp.claims(:jshmember, true);
select pg_temp.visible_state(:jsh) as bm_old \gset
reset role;
select pg_temp.no_claims();
rollback to savepoint as_in_0101_again;
select pg_temp.assert(:'b_new'::jsonb = :'b_old'::jsonb and :'bm_new'::jsonb = :'bm_old'::jsonb,
  'B · with Bolis, Store, My Jain Way and Pathshala switched off by JSH, administrator and member still read exactly what 0101 gave');
select pg_temp.assert((:'a_new'::jsonb->'counts'->>'bolis')::bigint >= 1 and (:'b_new'::jsonb->'counts'->>'bolis')::bigint = 0
                      and (select count(*) from jsonb_array_elements(:'bm_new'::jsonb->'modules') e where not (e->>'enabled')::boolean) = 4,
  'B · and that is not vacuous: the boli is hidden by the switch, and my_modules shows the four modules off');
-- Function level, over every community and module (the other tests' communities are all here too).
select pg_temp.assert(not exists (
    select 1 from app.centers c cross join app.modules m
     where c.category_key = 'jain_center'
       and app.module_enabled(c.id, m.key) is distinct from (not exists (select 1 from app.center_modules x
                                                                          where x.center_id = c.id and x.module_key = m.key and not x.enabled))),
  'B · for every Jain Center and every module, module_enabled equals the 0101 rule');
select pg_temp.assert(not exists (
    select 1 from app.modules m
     where (select coalesce(array_agg(x order by x), '{}') from unnest(app.module_off_centers(m.key)) as x)
           is distinct from (select coalesce(array_agg(center_id order by center_id), '{}') from app.center_modules where module_key = m.key and not enabled)),
  'B · module_off_centers is the 0101 set, module by module (every community is a Jain Center so far)');
select pg_temp.assert(pg_temp.hint_of($$select app.assert_module_enabled('00000000-0000-4000-8000-000000000001', 'bolis')$$)
                        = 'An administrator can switch it on in Settings › Modules.',
  'B · a module JSH switched off refuses with the sentence and hint it always had');
select pg_temp.assert_raises($$select app.assert_module_enabled('00000000-0000-4000-8000-000000000001', 'bolis')$$,
  'The Bolis module is switched off for this community.', 'B · the sentence itself');
select pg_temp.assert(app.assert_module_enabled(:jsh, 'giving'), 'B · and a module JSH has on passes');
-- Switching still works the 0101 way for JSH.
set role authenticated;
select pg_temp.claims(:jshadmin, true);
select app.set_module_enabled(:jsh, 'bolis', true, 'Bolis back on after the equivalence test');
select pg_temp.assert(app.module_enabled(:jsh, 'bolis'), 'B · JSH switches a module back on exactly as before');
select pg_temp.assert_raises($$select app.set_module_enabled('00000000-0000-4000-8000-000000000001', 'people', false, 'x')$$,
  'core platform', 'B · and a core module still cannot be switched off');
reset role;
select pg_temp.no_claims();
delete from app.center_modules where center_id = :jsh;

-- ══ E1. Creating a sandbox with a category ══════════════════════════════════
set role authenticated;
select pg_temp.claims(:cc, true);
select pg_temp.assert_raises($$select app.platform_create_sandbox('Houston Chamber', 'hcc', 'other_nonprofit', 'Houston', 'TX', 'Chet', 'Owner',
    'chet79@hcc.test', 'No category', 'http://portal.test', 'no_such_category')$$,
  'Choose the kind of organization', 'E · an unknown category is refused');
select pg_temp.assert_raises($$select app.platform_create_sandbox('Houston Chamber', 'hcc', 'other_nonprofit', 'Houston', 'TX', 'Chet', 'Owner',
    'chet79@hcc.test', 'No category', 'http://portal.test', null)$$,
  'Choose the kind of organization', 'E · an explicit empty category is refused (the console shows nothing pre-selected)');
select app.platform_create_sandbox('Houston Chamber of Commerce', 'hcc', 'other_nonprofit', 'Houston', 'TX', 'Chet', 'Owner',
                                   'chet79@hcc.test', 'Preview of the chamber category', 'http://portal.test', 'chamber_of_commerce') as made_chm \gset
-- The ten-argument call the portal makes today still works and makes a Jain Center.
select app.platform_create_sandbox('Jain Temple 79', 'jt79', 'temple', 'Austin', 'TX', 'Asha', 'Mehta',
                                   'asha79@jt79.test', 'Default category', 'http://portal.test') as made_jt \gset
reset role;
select pg_temp.no_claims();
select (:'made_chm'::jsonb)->>'center_id' as chm \gset
select (:'made_jt'::jsonb)->>'center_id' as jt \gset
select pg_temp.assert((select category_key = 'chamber_of_commerce' and environment = 'sandbox' and tradition = 'other'
                              and not (rules->'onboarding') ? 'category_key' and rules #>> '{onboarding,source}' = 'platform_admin'
                         from app.centers where id = :'chm'),
  'E · a chamber sandbox: its category is a column (not kept in rules), its tradition is "other"');
select pg_temp.assert((select category_key = 'jain_center' and tradition = 'shvetambar_murtipujak' and environment = 'sandbox' from app.centers where id = :'jt'),
  'E · created without a category (the old call): a Jain Center with its default tradition');
select pg_temp.assert(not exists (select 1 from app.dietary_options where center_id = :'chm' and key = 'jain')
                      and (select count(*) from app.dietary_options where center_id = :'chm') = 6
                      and (select count(*) from app.dietary_options where center_id = :'jt') = 7
                      and exists (select 1 from app.dietary_options where center_id = :'jt' and key = 'jain'),
  'E · no "Jain (no root vegetables)" dietary option for a chamber, today''s seven for a Jain Center');
select pg_temp.assert(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                   where n.nspname = 'app' and p.proname = 'platform_create_sandbox' and p.pronargs = 10)
                      and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname = 'app' and p.proname = 'platform_create_sandbox') = 1,
  'E · the old ten-argument function is gone: the API sees one platform_create_sandbox');

-- Insert rule and tradition rule.
select pg_temp.assert_raises($$insert into app.centers (slug, name, category_key) values ('prod79', 'Prod 79', 'chamber_of_commerce')$$,
  'not switched on yet', 'E · a production organization cannot take an inactive category');
select pg_temp.assert_raises($$insert into app.centers (slug, name, category_key) values ('nocat79', 'No category 79', 'no_such_category')$$,
  'no organization category called', 'E · nor a category that does not exist');
insert into app.centers (id, slug, name, environment, category_key, status)
values ('79000000-0000-4000-8000-0000000000d1', 'prev79-sandbox', 'Preview 79', 'sandbox', 'faith_other', 'onboarding');
select pg_temp.assert((select tradition = 'other' from app.centers where id = '79000000-0000-4000-8000-0000000000d1'),
  'E · a sandbox may take an inactive category (a preview); a category without a tradition forces "other"');
update app.centers set tradition = 'digambar' where id = '79000000-0000-4000-8000-0000000000d1';
select pg_temp.assert((select tradition = 'other' from app.centers where id = '79000000-0000-4000-8000-0000000000d1'),
  'E · and a tradition written afterwards is put back to "other"');

-- A request carries its category to the sandbox made from it.
insert into app.access_requests (id, org_legal_name, org_type, city, state, contact_name, contact_email) values
  ('79000000-0000-4000-8000-0000000000f1', 'Request Chamber 79', 'other_nonprofit', 'Houston', 'TX', 'Rita Request', 'rita79@req.test'),
  ('79000000-0000-4000-8000-0000000000f2', 'Request Temple 79', 'temple', 'Houston', 'TX', 'Tej Request', 'tej79@req.test'),
  ('79000000-0000-4000-8000-0000000000f3', 'Request Declined 79', 'temple', 'Houston', 'TX', 'Dee Request', 'dee79@req.test');
update app.access_requests set status = 'declined', decision_note = 'Not now' where id = '79000000-0000-4000-8000-0000000000f3';
set role authenticated;
select pg_temp.claims(:jadmin, true);
select pg_temp.assert_raises($$select app.set_access_request_category('79000000-0000-4000-8000-0000000000f1', 'chamber_of_commerce')$$,
  'Community Connect team', 'E · only a platform admin chooses a request''s category');
select pg_temp.claims(:cc, true);
select pg_temp.assert_raises($$select app.set_access_request_category('79000000-0000-4000-8000-0000000000f1', 'no_such_category')$$,
  'Choose one of the organization categories', 'E · it must be a real category');
select pg_temp.assert_raises($$select app.set_access_request_category('79000000-0000-4000-8000-0000000000f3', 'chamber_of_commerce')$$,
  'was declined', 'E · a declined request keeps no category');
select app.set_access_request_category('79000000-0000-4000-8000-0000000000f1', 'chamber_of_commerce');
select pg_temp.assert((select category_key from app.access_requests where id = '79000000-0000-4000-8000-0000000000f1') = 'chamber_of_commerce'
                      and (select category_key from app.access_requests where id = '79000000-0000-4000-8000-0000000000f2') is null,
  'E · Community Connect sets the category on the request; a request without one stays empty');
reset role;
select pg_temp.no_claims();
select app._create_sandbox_center('req79', 'Request Chamber 79', 'TX', 'Houston', null,
                                  jsonb_build_object('source', 'sandbox_code', 'request_id', '79000000-0000-4000-8000-0000000000f1'::uuid)) as req_chamber \gset
select app._create_sandbox_center('req79b', 'Request Temple 79', 'TX', 'Houston', null,
                                  jsonb_build_object('source', 'sandbox_code', 'request_id', '79000000-0000-4000-8000-0000000000f2'::uuid)) as req_temple \gset
select pg_temp.assert((select category_key = 'chamber_of_commerce' and tradition = 'other' and not (rules->'onboarding') ? 'category_key' from app.centers where id = :'req_chamber')
                      and (select category_key = 'jain_center' from app.centers where id = :'req_temple'),
  'E · redeeming a code takes the request''s category (the sandbox-creation part redeem_sandbox_code calls); a request with none gives a Jain Center, as before');
insert into app.sandbox_codes (request_id, code_hash, code_last4, email, expires_at, issued_by, redeemed_by, redeemed_at, center_id)
values ('79000000-0000-4000-8000-0000000000f1', repeat('a', 64), '2222', 'rita79@req.test', now() + interval '1 day', :cc, :cc2, now(), :'req_chamber');
set role authenticated;
select pg_temp.claims(:cc, true);
select pg_temp.assert_raises($$select app.set_access_request_category('79000000-0000-4000-8000-0000000000f1', 'faith_other')$$,
  'already created from this request', 'E · once a sandbox exists, the organization''s own page is the way');
reset role;
select pg_temp.no_claims();
-- A sandbox of an inactive category cannot become production by flipping `environment` either (a job, the superuser, or
-- a platform admin writing the table).
select pg_temp.assert_raises(format($$update app.centers set environment = 'production' where id = %L$$, :'req_chamber'),
  'not switched on yet', 'E · an inactive category cannot go to production by a direct update (a job or migration included)');
set role authenticated;
select pg_temp.claims(:cc, true);
select pg_temp.assert_raises(format($$update app.centers set environment = 'production' where id = %L$$, :'req_chamber'),
  'not switched on yet', 'E · nor by a platform admin writing the table');
reset role;
select pg_temp.no_claims();
select pg_temp.assert((select environment = 'sandbox' from app.centers where id = :'req_chamber'), 'E · and it is still a sandbox');

-- ══ C. A chamber of commerce preview sandbox ════════════════════════════════
-- The owner is named first: a center_admin grant makes the first administrator the owner when there is none (0151).
insert into app.center_owners (center_id, user_id) values (:'chm', :chowner);
insert into app.role_grants (center_id, user_id, role_key, reason) values
  (:'chm', :chadmin, 'center_admin', 'category test 79'), (:'chm', :chadmin, 'religious_coordinator', 'category test 79');
insert into app.households (id, center_id, display_name) values (:h_chm, :'chm', 'Chamber member household 79');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values (:p_chm, :'chm', 'Cam', 'Member79', date '1980-01-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values (:h_chm, :p_chm, :'chm', 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values (:'chm', :chmember, :p_chm);
-- The chamber's administrator is also one of its people (Setup's readiness checks are for a community's own people).
insert into app.households (id, center_id, display_name) values (:h_chadm, :'chm', 'Chamber office household 79');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values (:p_chadm, :'chm', 'Ada', 'Office79', date '1975-01-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values (:h_chadm, :p_chadm, :'chm', 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values (:'chm', :chadmin, :p_chadm);
insert into app.bolis (id, center_id, name, kind) values ('79000000-0000-4000-8000-0000000000e8', :'chm', 'Chamber boli 79', 'digital');
insert into app.pathshala_terms (id, center_id, name, starts_on, ends_on) values
  ('79000000-0000-4000-8000-0000000000e9', :'chm', 'Chamber term 79', current_date, current_date + 30);
insert into app.gyan_goals (id, center_id, key, name) values ('79000000-0000-4000-8000-0000000000ea', :'chm', 'g79', 'Chamber goal 79');
insert into app.practices (id, center_id, category, key, name) values ('79000000-0000-4000-8000-0000000000eb', :'chm', 'tapa', 'p79', 'Chamber practice 79');
insert into app.store_categories (id, center_id, name) values ('79000000-0000-4000-8000-0000000000ec', :'chm', 'Chamber store category 79');
insert into app.funds (id, center_id, key, name) values ('79000000-0000-4000-8000-0000000000ed', :'chm', 'g79', 'Chamber dues fund 79');

-- The module functions.
select pg_temp.assert(not app.module_enabled(:'chm', 'bolis') and not app.module_enabled(:'chm', 'pathshala') and not app.module_enabled(:'chm', 'gyan_path')
                      and not app.module_enabled(:'chm', 'jain_way') and not app.module_enabled(:'chm', 'store') and not app.module_enabled(:'chm', 'niva')
                      and app.module_enabled(:'chm', 'people') and app.module_enabled(:'chm', 'giving') and app.module_enabled(:'chm', 'events')
                      and app.module_enabled(:'chm', 'content') and app.module_enabled(:'chm', 'accounting') and app.module_enabled(:'chm', 'governance'),
  'C · module_enabled: a chamber has no Bolis, Pathshala, Gyan Path or My Jain Way, Store and Niva are off, the rest are on');
select pg_temp.assert(:'chm'::uuid = any (app.module_off_centers('bolis')) and :'chm'::uuid = any (app.module_off_centers('store'))
                      and not (:'chm'::uuid = any (app.module_off_centers('giving')))
                      and not (:jsh::uuid = any (app.module_off_centers('bolis'))),
  'C · module_off_centers lists the chamber for the modules it does not have (and for Store until switched on), not for the rest, and never JSH');
select pg_temp.assert(not app.storage_module_on('homework', :'chm') and not app.storage_module_on('recordings', :'chm')
                      and app.storage_module_on('content', :'chm') and app.storage_module_on('homework', :jsh),
  'C · the storage buckets of Gyan Path are closed for a chamber and open for JSH');

-- Fail closed: a module or a category added later gets a row in every category, off for all but Jain Center.
savepoint a_new_module_and_a_new_category;
insert into app.modules (key, label, description, core, depends_on, sort) values
  ('test_module79', 'Test module', 'Added by test 79', false, '{}', 98), ('test_core79', 'Test core module', 'Added by test 79', true, '{}', 99);
select pg_temp.assert((select count(*) from app.category_modules where module_key = 'test_module79') = 7
                      and (select availability from app.category_modules where module_key = 'test_module79' and category_key = 'jain_center') = 'default_on'
                      and (select count(*) from app.category_modules where module_key = 'test_module79' and availability = 'default_off') = 6
                      and (select count(*) from app.category_modules where module_key = 'test_core79' and availability = 'default_on') = 7,
  'A · a module added later gets a row in every category: on for Jain Center (and for a core module), off for the others');
select pg_temp.assert(app.module_enabled(:jsh, 'test_module79') and not app.module_enabled(:'chm', 'test_module79')
                      and :'chm'::uuid = any (app.module_off_centers('test_module79')) and app.module_enabled(:'chm', 'test_core79'),
  'A · so a new module is on for JSH and off for a chamber until a migration says otherwise');
insert into app.organization_categories (key, label, faith_based, terms) values
  ('test_cat79', 'Test category', false,
   '{"greeting":"Welcome","practice_tab":null,"give_tab":"Give","family_tab":"Family","store":"Store","school":null,"learning":null,"place":"office","assistant_context":"a test"}');
select pg_temp.assert((select count(*) from app.category_modules where category_key = 'test_cat79') = 20
                      and (select count(*) from app.category_modules where category_key = 'test_cat79' and availability = 'default_on') = 2
                      and (select availability from app.category_modules where category_key = 'test_cat79' and module_key = 'people') = 'default_on',
  'A · a category added later gets a row for every module (20 with the two test modules): only the core modules on');
rollback to savepoint a_new_module_and_a_new_category;
select pg_temp.assert((select count(*) from app.modules) = 18 and (select count(*) from app.category_modules) = 126
                      and (select count(*) from app.organization_categories) = 7,
  'A · (and the rollback put the catalogs back)');

-- What a chamber's administrator reads: nothing from the modules it does not have; the rest as usual.
set role authenticated;
select pg_temp.claims(:chadmin, true);
select pg_temp.assert((select count(*) from app.bolis where center_id = :'chm') = 0
                      and (select count(*) from app.pathshala_terms where center_id = :'chm') = 0
                      and (select count(*) from app.gyan_goals where center_id = :'chm') = 0
                      and (select count(*) from app.practices where center_id = :'chm') = 0
                      and (select count(*) from app.store_categories where center_id = :'chm') = 0,
  'C · the chamber''s administrator reads no bolis, Pathshala terms, Gyan Path goals, practices or store items (RLS)');
select pg_temp.assert((select count(*) from app.funds where center_id = :'chm') = 1 and (select count(*) from app.people where center_id = :'chm') >= 1,
  'C · and still reads its funds and people (modules it has)');
select pg_temp.assert_raises(format($$insert into app.bolis (center_id, name, kind) values (%L, 'Another boli', 'digital')$$, :'chm'),
  'row-level security', 'C · it cannot add a boli either');
select pg_temp.assert_raises($$select app.pathshala_term_stats('79000000-0000-4000-8000-0000000000e9')$$,
  'Pathshala is not part of a Chamber of commerce organization.', 'C · a Pathshala RPC refuses with the category sentence');
select pg_temp.assert_raises($$select app.boli_minimum('79000000-0000-4000-8000-0000000000e8')$$,
  'Bolis is not part of a Chamber of commerce organization.', 'C · a Bolis SQL function refuses too');
select pg_temp.assert(pg_temp.hint_of($$select app.boli_minimum('79000000-0000-4000-8000-0000000000e8')$$)
                        = 'Community Connect can change an organization''s category.',
  'C · and says who can change the category');
select pg_temp.assert((select array_agg(key order by key) from app.my_modules(:'chm') where not enabled) = array['bolis', 'gyan_path', 'jain_way', 'niva', 'pathshala', 'store']
                      and (select count(*) from app.my_modules(:'chm')) = 18 and (select enabled and core from app.my_modules(:'chm') where key = 'people'),
  'C · my_modules: the same 18 rows, the modules the chamber does not have come back enabled = false');
-- The switch: a module the category does not have cannot be switched on.
select pg_temp.assert_raises(format($$select app.set_module_enabled(%L, 'bolis', true, 'Please')$$, :'chm'),
  'Bolis is not part of a Chamber of commerce organization, so it cannot be switched on', 'C · set_module_enabled refuses to switch on a module the category does not have');
select pg_temp.assert_raises(format($$select app.set_module_enabled(%L, 'pathshala', true, 'Please')$$, :'chm'),
  'not part of a Chamber of commerce organization', 'C · Pathshala too');
select pg_temp.assert(pg_temp.hint_of(format($$select app.set_module_enabled(%L, 'jain_way', true, 'Please')$$, :'chm'))
                        = 'Community Connect can change an organization''s category.',
  'C · with the same hint');
-- Setup.
select pg_temp.assert((select detail from app.setup_checklist(:'chm') where step_key = 'org.modules') = 'The Chamber of commerce set of modules (the default)',
  'C · Setup''s "Choose modules" says the organization has the Chamber of commerce set');
select pg_temp.assert((select count(*) from app.setup_checklist(:'chm') where module_key in ('bolis', 'pathshala', 'gyan_path', 'jain_way')) > 0
                      and not exists (select 1 from app.setup_checklist(:'chm') where module_key in ('bolis', 'pathshala', 'gyan_path', 'jain_way')
                                        and (status <> 'skipped' or detail <> 'Not part of a Chamber of commerce organization.')),
  'C · the Setup steps of modules a chamber does not have are skipped with "Not part of a Chamber of commerce organization."');
select pg_temp.assert((select count(*) from app.setup_checklist(:'chm') where module_key = 'store') > 0
                      and not exists (select 1 from app.setup_checklist(:'chm') where module_key = 'store'
                                        and (status <> 'skipped' or detail <> 'The Satvik Store module is switched off.')),
  'C · and the Store steps, which the chamber may switch on, say what they always said');
-- Settings › Modules.
select pg_temp.assert((select count(*) from app.module_states(:'chm')) = 18
                      and (select availability = 'not_available' and not enabled and not switchable and label = 'Bolis' from app.module_states(:'chm') where key = 'bolis')
                      and (select availability = 'default_off' and not enabled and switchable and label = 'Store' from app.module_states(:'chm') where key = 'store')
                      and (select label = 'Dues & payments' and enabled and switchable from app.module_states(:'chm') where key = 'giving')
                      and (select core and enabled and not switchable from app.module_states(:'chm') where key = 'people'),
  'C · module_states: availability next to the switch, the category''s own names, nothing to switch for a core or unavailable module');
-- A settings manager sets a tradition on a chamber: it stays "other".
update app.centers set tradition = 'sthanakvasi' where id = :'chm';
select pg_temp.assert((select tradition = 'other' from app.centers where id = :'chm'), 'C · a tradition written on a chamber is put back to "other"');
-- Store starts off; the chamber switches it on and off.
select pg_temp.assert(not app.module_enabled(:'chm', 'store') and (select count(*) from app.store_categories where center_id = :'chm') = 0,
  'C · Store starts off');
select app.set_module_enabled(:'chm', 'store', true, 'Opening a store for members');
select pg_temp.assert(app.module_enabled(:'chm', 'store') and (select count(*) from app.store_categories where center_id = :'chm') = 1
                      and not (:'chm'::uuid = any (app.module_off_centers('store')))
                      and (select enabled and changed_by = :chadmin and reason = 'Opening a store for members' from app.module_states(:'chm') where key = 'store'),
  'C · switched on, Store is readable, and the switch records who and why');
select app.set_module_enabled(:'chm', 'store', false, 'Closing the store again');
select pg_temp.assert(not app.module_enabled(:'chm', 'store') and (select count(*) from app.store_categories where center_id = :'chm') = 0
                      and :'chm'::uuid = any (app.module_off_centers('store')),
  'C · and switched off again, hidden again');
select app.set_module_enabled(:'chm', 'niva', true, 'Trying Niva');
select pg_temp.assert(app.module_enabled(:'chm', 'niva'), 'C · Niva can be switched on too (it needs Content, which a chamber has)');
select app.set_module_enabled(:'chm', 'niva', false, 'Niva was a trial');
select pg_temp.claims(:chmember, true);
select pg_temp.assert_raises(format($$select * from app.module_states(%L)$$, :'chm'), 'have access to this community''s modules',
  'C · a member without settings.manage cannot read the module list');
select pg_temp.assert_raises(format($$select * from app.log_practice(%L, '79000000-0000-4000-8000-0000000000eb')$$, :'chm'),
  'My Jain Way is not part of a Chamber of commerce organization.', 'C · a member cannot log a practice in a chamber (the Jain Way RPC refuses)');
select pg_temp.assert((select count(*) from app.practices where center_id = :'chm') = 0 and (select count(*) from app.my_modules(:'chm')) = 18,
  'C · a chamber member reads no practices and gets the same my_modules');
reset role;
select pg_temp.no_claims();
-- A member of the chamber (a sandbox still onboarding: since 0615 guests do not see it): its access areas and category profile.
set role authenticated;
select pg_temp.claims(:chmember);
select pg_temp.assert(not ((select app.feature_access_for_me(:'chm')->'features') ? 'puja')
                      and not ((select app.feature_access_for_me(:'chm')->'features') ? 'learn')
                      and not ((select app.feature_access_for_me(:'chm')->'features') ? 'darshan')
                      and (select app.feature_access_for_me(:'chm')->'features'->'niva'->>'reason') = 'module_off'
                      and ((select app.feature_access_for_me(:'chm')->'features') ? 'listen')
                      and (select (app.feature_access_for_me(:'chm')->'features'->'guide'->>'allowed')::boolean),
  'C · the member app''s access areas (0600): a chamber has no puja, learn or darshan area at all, Ask Niva is module_off, the library and the guide are there');
select pg_temp.assert((select app.category_profile(:'chm')->'category'->>'key') = 'chamber_of_commerce'
                      and (select app.category_profile(:'chm')->'category'->'terms'->>'greeting') = 'Welcome'
                      and (select jsonb_typeof(app.category_profile(:'chm')->'category'->'terms'->'practice_tab')) = 'null'
                      and (select app.category_profile(:'chm')->'modules'->'bolis'->>'availability') = 'not_available'
                      and (select app.category_profile(:'chm')->'modules'->'store'->>'availability') = 'default_off'
                      and (select app.category_profile(:'chm')->'modules'->'giving'->>'label') = 'Dues & payments'
                      and (select jsonb_array_length(app.category_profile(:'chm')->'paths')) = 0
                      and (select jsonb_typeof(app.category_profile(:'chm')->'default_path')) = 'null',
  'C · category_profile for guests: the chamber''s words, its modules, no paths, no default path');
select pg_temp.assert((select app.category_profile(:jsh)->'category'->>'key') = 'jain_center'
                      and (select (app.category_profile(:jsh)->'category'->>'uses_tradition')::boolean)
                      and (select app.category_profile(:jsh)->'category'->'terms'->>'greeting') = 'Jai Jinendra'
                      and (select jsonb_array_length(app.category_profile(:jsh)->'paths')) = 10
                      and (select app.category_profile(:jsh)->>'default_path') = 'shwetambar_murtipujak'
                      and (select count(*) from jsonb_each(app.category_profile(:jsh)->'modules') e where e.value->>'availability' = 'default_on') = 18,
  'C · category_profile for JSH: today''s words, all 18 modules default_on, ten paths, the default path of its Murtipujak tradition');
select pg_temp.assert_raises($$select app.category_profile('79000000-0000-4000-8000-0000000000ff')$$, 'That community was not found.',
  'C · category_profile: an unknown community is "not found"');
reset role;
select pg_temp.no_claims();
update app.centers set status = 'suspended' where id = '79000000-0000-4000-8000-0000000000d1';
set role anon;
select pg_temp.assert_raises($$select app.category_profile('79000000-0000-4000-8000-0000000000d1')$$, 'That community was not found.',
  'C · and so is a community that is not open to guests');
reset role;
-- The default path follows the community's default tradition.
update app.centers set tradition = 'sthanakvasi' where id = :'jt';
select pg_temp.assert(app.category_profile(:'jt')->>'default_path' = 'shwetambar_sthanakvasi', 'C · a Sthanakvasi community defaults to the Sthanakvasi path');
update app.centers set tradition = 'terapanthi' where id = :'jt';
select pg_temp.assert(app.category_profile(:'jt')->>'default_path' = 'shwetambar_terapanth', 'C · terapanthi reads as the Shwetambar Terapanth');
update app.centers set tradition = 'digambar' where id = :'jt';
select pg_temp.assert(app.category_profile(:'jt')->>'default_path' = 'digambar', 'C · digambar becomes the Digambar branch');
update app.centers set tradition = 'other' where id = :'jt';
select pg_temp.assert(jsonb_typeof(app.category_profile(:'jt')->'default_path') = 'null', 'C · "other" has no default path');
update app.centers set tradition = 'shvetambar_murtipujak' where id = :'jt';
-- Platform admins pass the module switch, as they always did.
set role authenticated;
select pg_temp.claims(:cc, true);
select pg_temp.assert(app.assert_module_enabled(:'chm', 'bolis') and (select count(*) from app.bolis where center_id = :'chm') = 1
                      and (select count(*) from app.pathshala_terms where center_id = :'chm') = 1,
  'C · a platform admin still passes the guards and reads a module the chamber does not have');
select pg_temp.assert((select count(*) from app.module_states(:jsh)) = 18 and not exists (select 1 from app.module_states(:jsh) where availability <> 'default_on')
                      and (select count(*) from app.module_states(:jsh) where switchable) = 17
                      and not exists (select 1 from app.module_states(:jsh) m join app.modules b on b.key = m.key where m.label <> b.label),
  'C · module_states for JSH: every module default_on with its own name, 17 can be switched (People is core)');
reset role;
select pg_temp.no_claims();

-- ══ D. Changing the category ════════════════════════════════════════════════
-- A Jain sandbox with an owner, some Jain data and a family.
insert into app.center_owners (center_id, user_id) values (:'jt', :jowner);
insert into app.role_grants (center_id, user_id, role_key, reason) values
  (:'jt', :jadmin, 'center_admin', 'category test 79'), (:'jt', :jadmin, 'religious_coordinator', 'category test 79');
insert into app.households (id, center_id, display_name) values (:h1, :'jt', 'Shah household 79'), (:h2, :'jt', 'Mehta household 79');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (:p_mom, :'jt', 'Mira', 'Shah', date '1980-01-01'), (:p_dad, :'jt', 'Rahul', 'Shah', date '1978-05-05'),
  (:p_kid, :'jt', 'Anya', 'Shah', (current_date - interval '10 years')::date), (:p_stranger, :'jt', 'Sonal', 'Mehta', date '1975-03-03');
insert into app.household_members (household_id, person_id, center_id, role) values
  (:h1, :p_mom, :'jt', 'primary'), (:h1, :p_dad, :'jt', 'spouse'), (:h1, :p_kid, :'jt', 'child'), (:h2, :p_stranger, :'jt', 'primary');
insert into app.center_users (center_id, user_id, person_id) values
  (:'jt', :mom, :p_mom), (:'jt', :dad, :p_dad), (:'jt', :kid, :p_kid), (:'jt', :stranger, :p_stranger);
insert into app.bolis (id, center_id, name, kind) values ('79000000-0000-4000-8000-0000000000e2', :'jt', 'Jain boli 79', 'digital');
insert into app.pathshala_terms (id, center_id, name, starts_on, ends_on) values
  ('79000000-0000-4000-8000-0000000000e3', :'jt', 'Jain term 79', current_date, current_date + 30);
insert into app.gyan_goals (id, center_id, key, name) values ('79000000-0000-4000-8000-0000000000e4', :'jt', 'g79', 'Jain goal 79');
insert into app.practices (id, center_id, category, key, name) values ('79000000-0000-4000-8000-0000000000e5', :'jt', 'tapa', 'p79', 'Jain practice 79');
insert into app.store_categories (id, center_id, name) values ('79000000-0000-4000-8000-0000000000e6', :'jt', 'Jain store category 79');
insert into app.funds (id, center_id, key, name) values ('79000000-0000-4000-8000-0000000000e7', :'jt', 'g79', 'Jain fund 79');
-- Two people have a path (set by themselves and by a parent, below, through RLS).
set role authenticated;
select pg_temp.claims(:mom, true);
insert into app.person_profile_details (person_id, center_id, path_key) values (:p_mom, :'jt', 'shwetambar_sthanakvasi');
insert into app.person_profile_details (person_id, center_id, path_key) values (:p_kid, :'jt', 'shwetambar_sthanakvasi');
reset role;
select pg_temp.no_claims();

-- The table cannot be used to change a category: not by a settings manager, not by a platform admin.
set role authenticated;
select pg_temp.claims(:chadmin, true);
select pg_temp.assert_raises(format($$update app.centers set category_key = 'jain_center' where id = %L$$, :'chm'),
  'only be changed by Community Connect', 'D · a settings manager cannot change the category through the table');
select pg_temp.assert_raises(format($$select app.set_center_category(%L, 'nonprofit_secular', 'Please')$$, :'chm'),
  'Only the Community Connect team', 'D · nor through the function');
select pg_temp.assert_raises(format($$select app.category_change_preview(%L, 'nonprofit_secular')$$, :'chm'),
  'Only the Community Connect team', 'D · nor can they preview one');
select pg_temp.claims(:cc, true);
select pg_temp.assert_raises(format($$update app.centers set category_key = 'jain_center' where id = %L$$, :'chm'),
  'only be changed by Community Connect', 'D · a platform admin''s direct table update is refused too (the reason and 2FA cannot be skipped)');
select pg_temp.assert((select category_key from app.centers where id = :'chm') = 'chamber_of_commerce', 'D · and nothing changed');
select pg_temp.assert_raises(format($$select app.set_center_category(%L, 'chamber_of_commerce', 'Same again')$$, :'chm'),
  'already a Chamber of commerce organization', 'D · changing to the category it already has is refused');
select pg_temp.assert_raises(format($$select app.set_center_category(%L, 'no_such_category', 'Reason')$$, :'chm'),
  'Choose one of the organization categories', 'D · an unknown category is refused');
select pg_temp.assert_raises($$select app.set_center_category('00000000-0000-4000-8000-000000000001', 'chamber_of_commerce', 'Switching JSH')$$,
  'not switched on yet', 'D · a live organization (JSH) cannot take a category that is not switched on yet');
select pg_temp.assert_raises(format($$select app.set_center_category(%L, 'nonprofit_secular', '   ')$$, :'jt'),
  'Give a reason', 'D · a reason is required');
select pg_temp.claims(:cc, false);
select pg_temp.assert_raises(format($$select app.set_center_category(%L, 'nonprofit_secular', 'Without the 2FA check')$$, :'jt'),
  'fresh 2FA check', 'D · and a fresh 2FA check');
select pg_temp.claims(:cc, true);
select pg_temp.assert((select category_key from app.centers where id = :'jt') = 'jain_center', 'D · every refusal left the category alone');

-- The preview says what will be hidden, in plain English, and changes nothing.
select app.category_change_preview(:'jt', 'chamber_of_commerce') as preview \gset
select pg_temp.assert((:'preview'::jsonb->>'changed')::boolean
                      and (select array_agg(h->>'module') from jsonb_array_elements(:'preview'::jsonb->'hidden') h) = array['bolis', 'store', 'pathshala', 'gyan_path', 'jain_way', 'niva']
                      and (select (h->>'records')::int from jsonb_array_elements(:'preview'::jsonb->'hidden') h where h->>'module' = 'bolis') = 1
                      and (select h->>'text' from jsonb_array_elements(:'preview'::jsonb->'hidden') h where h->>'module' = 'bolis')
                            = 'Bolis: 1 record will be hidden, not deleted (1 in bolis).'
                      and (select h->>'text' from jsonb_array_elements(:'preview'::jsonb->'hidden') h where h->>'module' = 'niva')
                            = 'Niva assistant: nothing is stored yet, so nothing is hidden; it can be switched on again in Settings › Modules.'
                      and (:'preview'::jsonb->>'paths_kept')::int = 2
                      and :'preview'::jsonb->'tradition'->>'after' = 'other'
                      and :'preview'::jsonb->'summary' ? 'Nothing is deleted; changing back restores it.',
  'D · the preview names every module that will be hidden with its record counts, the paths kept and the tradition; nothing is deleted');
select pg_temp.assert((select category_key from app.centers where id = :'jt') = 'jain_center' and app.module_enabled(:'jt', 'bolis'),
  'D · the preview changed nothing');
select pg_temp.assert((app.category_change_preview(:jsh, 'jain_center')->>'changed')::boolean is false
                      and jsonb_array_length(app.category_change_preview(:jsh, 'jain_center')->'hidden') = 0,
  'D · previewing the category an organization already has says nothing changes');

-- Section G can be dropped on its own: with the column gone, the preview and the change still work (and count no paths).
reset role;
select pg_temp.no_claims();
savepoint without_section_g;
alter table app.person_profile_details drop column path_key;
set role authenticated;
select pg_temp.claims(:cc, true);
select app.category_change_preview(:'jt', 'chamber_of_commerce') as preview_no_g \gset
select app.set_center_category(:'jt', 'chamber_of_commerce', 'Without section G') as changed_no_g \gset
reset role;
select pg_temp.no_claims();
select pg_temp.assert((:'preview_no_g'::jsonb->>'paths_kept')::int = 0
                      and (select array_agg(h->>'module') from jsonb_array_elements(:'preview_no_g'::jsonb->'hidden') h) = array['bolis', 'store', 'pathshala', 'gyan_path', 'jain_way', 'niva']
                      and (select category_key from app.centers where id = :'jt') = 'chamber_of_commerce',
  'D · section G is separable: without person_profile_details.path_key the preview counts no paths and set_center_category still works');
rollback to savepoint without_section_g;
select pg_temp.assert((select category_key from app.centers where id = :'jt') = 'jain_center'
                      and exists (select 1 from pg_attribute where attrelid = 'app.person_profile_details'::regclass and attname = 'path_key' and not attisdropped),
  'D · (and the rollback put the column and the category back)');
set role authenticated;
select pg_temp.claims(:cc, true);

-- The change itself.
select app.set_center_category(:'jt', 'chamber_of_commerce', 'Switching the Austin temple to the chamber preview') as changed \gset
reset role;
select pg_temp.no_claims();
select pg_temp.assert((select category_key = 'chamber_of_commerce' and tradition = 'other' from app.centers where id = :'jt'),
  'D · set_center_category changes the category, and the tradition becomes "other"');
select pg_temp.assert(:'changed'::jsonb->>'email_status' = 'queued'
                      and exists (select 1 from app.messages where template_key = 'category_changed' and to_address = 'owner79@jt79.test'
                                     and body like '%Switching the Austin temple to the chamber preview%' and body like '%Bolis: 1 record will be hidden%'),
  'D · the owner is emailed, with the reason and what was hidden');
select pg_temp.assert((select count(*) from app.audit_log where center_id = :'jt' and action = 'category.changed'
                          and reason = 'Switching the Austin temple to the chamber preview' and actor_user_id = :cc
                          and before->>'category' = 'jain_center' and after->>'category' = 'chamber_of_commerce'
                          and before->>'tradition' = 'shvetambar_murtipujak' and after->>'tradition' = 'other'
                          and after->'hidden' ? 'bolis' and after->'hidden' ? 'pathshala') = 1
                      and exists (select 1 from app.audit_log where center_id = :'jt' and action = 'centers.update' and after->>'category_key' = 'chamber_of_commerce'
                                     and reason = 'Switching the Austin temple to the chamber preview'),
  'D · audited: the row change and one category.changed entry with before, after and what was hidden, with the reason');
set role authenticated;
select pg_temp.claims(:jadmin, true);
select pg_temp.assert((select count(*) from app.bolis where center_id = :'jt') = 0 and (select count(*) from app.pathshala_terms where center_id = :'jt') = 0
                      and (select count(*) from app.gyan_goals where center_id = :'jt') = 0 and (select count(*) from app.practices where center_id = :'jt') = 0
                      and (select count(*) from app.store_categories where center_id = :'jt') = 0 and (select count(*) from app.funds where center_id = :'jt') = 1,
  'D · after the change the Jain data is hidden from its administrator (not deleted), the modules the chamber has are readable');
select pg_temp.claims(:cc, true);
select pg_temp.assert((select count(*) from app.bolis where center_id = :'jt') = 1 and (select count(*) from app.pathshala_terms where center_id = :'jt') = 1,
  'D · and a platform admin still sees it: nothing was deleted');
select pg_temp.assert(exists (select 1 from app.dietary_options where center_id = :'jt' and key = 'jain'),
  'D · the community''s dietary list is left as it is');
-- Paths from the old category stay stored and are ignored; they do not block saving other details.
select pg_temp.claims(:mom, true);
select pg_temp.assert((select path_key from app.person_profile_details where person_id = :p_mom) = 'shwetambar_sthanakvasi',
  'D · the path stays stored after the change');
select pg_temp.assert(pg_temp.affected(format($$update app.person_profile_details set dietary = array['vegetarian'] where person_id = %L$$, :p_mom)) = 1,
  'D · and a stale path does not stop the person saving other details');
select pg_temp.assert_raises(format($$update app.person_profile_details set path_key = 'digambar' where person_id = %L$$, :p_mom),
  'does not ask which path', 'D · but a path cannot be set in a category that asks none');
select pg_temp.assert(pg_temp.affected(format($$update app.person_profile_details set path_key = null where person_id = %L$$, :p_kid)) = 1,
  'D · and a path can be cleared (a parent clears the child''s)');
reset role;
select pg_temp.no_claims();

-- Back again: everything is as it was, including the tradition.
set role authenticated;
select pg_temp.claims(:cc, true);
select app.set_center_category(:'jt', 'jain_center', 'The temple is a Jain Center after all') as changed_back \gset
select pg_temp.assert((select category_key = 'jain_center' and tradition = 'shvetambar_murtipujak' from app.centers where id = :'jt'),
  'D · changed back: the category and the tradition it had are restored');
select pg_temp.claims(:jadmin, true);
select pg_temp.assert((select count(*) from app.bolis where center_id = :'jt') = 1 and (select count(*) from app.pathshala_terms where center_id = :'jt') = 1
                      and (select count(*) from app.gyan_goals where center_id = :'jt') = 1 and (select count(*) from app.practices where center_id = :'jt') = 1
                      and (select count(*) from app.store_categories where center_id = :'jt') = 1 and app.module_enabled(:'jt', 'bolis'),
  'D · and the hidden data is visible again');
reset role;
select pg_temp.no_claims();
select pg_temp.assert((select count(*) from app.audit_log where center_id = :'jt' and action = 'category.changed') = 2
                      and (select count(*) from app.messages where template_key = 'category_changed' and to_address = 'owner79@jt79.test') = 2,
  'D · two category.changed entries, two emails to the owner');
-- A sandbox may be moved to an inactive category and back (previews) without an owner to email.
set role authenticated;
select pg_temp.claims(:cc, true);
select app.set_center_category(:'chm', 'faith_other', 'Trying the other-faiths preview on the chamber sandbox') as to_faith \gset
reset role;
select pg_temp.no_claims();
select pg_temp.assert((select category_key = 'faith_other' and tradition = 'other' from app.centers where id = :'chm')
                      and :'to_faith'::jsonb->>'email_status' = 'queued'
                      and app.module_availability(:'chm', 'pathshala') = 'default_off' and not app.module_enabled(:'chm', 'pathshala')
                      and app.module_availability(:'chm', 'bolis') = 'not_available',
  'D · a sandbox can take an inactive category to preview it; Pathshala becomes switchable (off), Bolis stay unavailable');
set role authenticated;
select pg_temp.claims(:cc, true);
select app.set_center_category(:'chm', 'chamber_of_commerce', 'Back to the chamber preview');
-- A sandbox with no owner and no administrator yet: the change is made and the answer says nobody was emailed; with no
-- tradition on record, coming back to a Jain Center leaves the tradition "other".
select app.set_center_category('79000000-0000-4000-8000-0000000000d1', 'jain_center', 'Previewed, moving on') as to_jain \gset
reset role;
select pg_temp.no_claims();
select pg_temp.assert((select category_key from app.centers where id = :'chm') = 'chamber_of_commerce'
                      and (select category_key = 'jain_center' and tradition = 'other' from app.centers where id = '79000000-0000-4000-8000-0000000000d1')
                      and :'to_jain'::jsonb->>'email_status' = 'no_owner',
  'D · and back; a sandbox without an owner is changed with no email, its unknown tradition left as "other"');
select pg_temp.assert(not has_function_privilege('anon', 'app.set_center_category(uuid, text, text)', 'execute')
                      and not has_function_privilege('anon', 'app.category_change_preview(uuid, text)', 'execute')
                      and not has_function_privilege('anon', 'app.set_access_request_category(uuid, text)', 'execute')
                      and not has_function_privilege('anon', 'app.module_states(uuid)', 'execute')
                      and has_function_privilege('anon', 'app.category_profile(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.module_availability(uuid, text)', 'execute'),
  'D · who can call what: guests only category_profile; the internal readers nobody');

-- ══ E2. Promotion: the copy route keeps the category ═══════════════════════
insert into app.golive_requests (id, center_id, requested_by, status, first_approver, first_approved_at, second_approver, second_approved_at)
values ('79000000-0000-4000-8000-0000000000c1', :'chm', :chowner, 'approved', :cc, now(), :cc2, now());
set role authenticated;
select pg_temp.claims(:chowner, true);
select pg_temp.assert_raises(format($$select app.promote_sandbox(%L, 'hcc', 'Go live')$$, :'chm'),
  'not switched on yet', 'E · a sandbox whose category is not active yet cannot go live (it is a preview)');
reset role;
select pg_temp.no_claims();
update app.organization_categories set active = true where key = 'chamber_of_commerce';
set role authenticated;
select pg_temp.claims(:chowner, true);
select app.promote_sandbox(:'chm', 'hcc', 'Approved by Community Connect; going live') as promo79 \gset
reset role;
select pg_temp.no_claims();
-- The category is switched off again before the job runs: the worker refuses and nothing is created.
update app.organization_categories set active = false where key = 'chamber_of_commerce';
set role connect_worker;
select pg_temp.assert_raises(format($$select app.worker_promote_sandbox(%L)$$, :'promo79'),
  'not switched on yet', 'E · the worker checks the category again: switched off since the request, the promotion is refused');
reset role;
select pg_temp.no_claims();
select pg_temp.assert(not exists (select 1 from app.centers where slug = 'hcc')
                      and (select status from app.sandbox_promotions where id = :'promo79') = 'queued',
  'E · and nothing was created');
update app.organization_categories set active = true where key = 'chamber_of_commerce';
set role connect_worker;
select app.worker_promote_sandbox(:'promo79') as promoted79 \gset
reset role;
select pg_temp.no_claims();
select id as hccprod from app.centers where slug = 'hcc' \gset
select pg_temp.assert((select category_key = 'chamber_of_commerce' and tradition = 'other' and environment = 'production' from app.centers where id = :'hccprod')
                      and (select production_id = :'hccprod' and status = 'done' from app.sandbox_promotions where id = :'promo79'),
  'E · the copy route: the production organization comes back a chamber, not a Jain Center');
select pg_temp.assert(not exists (select 1 from app.dietary_options where center_id = :'hccprod' and key = 'jain')
                      and (select count(*) from app.dietary_options where center_id = :'hccprod') = 6,
  'E · and without the Jain dietary option the copy seeded for a moment');
select pg_temp.assert(not app.module_enabled(:'hccprod', 'bolis') and app.module_enabled(:'hccprod', 'giving'),
  'E · and its modules are the chamber''s');
update app.organization_categories set active = false where key = 'chamber_of_commerce';

-- ══ F. A person's path ══════════════════════════════════════════════════════
select pg_temp.assert((select category_key from app.centers where id = :'jt') = 'jain_center', 'F · (the Jain sandbox is a Jain Center again)');
set role authenticated;
select pg_temp.claims(:mom, true);
select pg_temp.assert((select path_key from app.person_profile_details where person_id = :p_mom) = 'shwetambar_sthanakvasi',
  'F · a person''s own path is saved (through the 0546 policies, unchanged)');
select pg_temp.assert(pg_temp.affected(format($$update app.person_profile_details set path_key = 'shwetambar_sthanakvasi' where person_id = %L$$, :p_kid)) = 1,
  'F · and a parent sets the child''s');
select pg_temp.assert_raises(format($$update app.person_profile_details set path_key = 'made_up' where person_id = %L$$, :p_mom),
  'not one of the paths this community offers', 'F · an unknown path is refused in plain English');
select pg_temp.assert_raises(format($$update app.person_profile_details set path_key = 'Not A Key' where person_id = %L$$, :p_mom),
  'not one of the paths this community offers', 'F · and so is a malformed one');
select pg_temp.assert(pg_temp.affected(format($$update app.person_profile_details set path_key = 'digambar' where person_id = %L$$, :p_mom)) = 1,
  'F · a person may stop at the branch');
select pg_temp.assert(pg_temp.affected(format($$update app.person_profile_details set path_key = '  digambar_bispanthi  ' where person_id = %L$$, :p_mom)) = 1,
  'F · or choose a path');
select pg_temp.assert((select path_key from app.person_profile_details where person_id = :p_mom) = 'digambar_bispanthi', 'F · (the key is trimmed)');
reset role;
select pg_temp.no_claims();
update app.category_paths set active = false where key = 'not_sure';
set role authenticated;
select pg_temp.claims(:mom, true);
select pg_temp.assert_raises(format($$update app.person_profile_details set path_key = 'not_sure' where person_id = %L$$, :p_mom),
  'not one of the paths this community offers', 'F · a path that is switched off cannot be chosen');
reset role;
select pg_temp.no_claims();
update app.category_paths set active = true where key = 'not_sure';
set role authenticated;
select pg_temp.claims(:mom, true);
select pg_temp.assert(pg_temp.affected(format($$update app.person_profile_details set path_key = 'not_sure' where person_id = %L$$, :p_mom)) = 1,
  'F · and can again when it is back');
select pg_temp.claims(:dad, true);
select pg_temp.assert(pg_temp.affected(format($$update app.person_profile_details set path_key = 'shwetambar_murtipujak' where person_id = %L$$, :p_kid)) = 1,
  'F · the other parent changes the child''s path');
select pg_temp.assert((select count(*) from app.person_profile_details where person_id in (:p_mom, :p_kid)) = 2, 'F · and reads both');
select pg_temp.claims(:kid, true);
select pg_temp.assert((select path_key from app.person_profile_details where person_id = :p_kid) = 'shwetambar_murtipujak'
                      and (select count(*) from app.person_profile_details where person_id = :p_mom) = 0,
  'F · a child reads their own path and nobody else''s');
select pg_temp.assert(pg_temp.affected(format($$update app.person_profile_details set path_key = 'other' where person_id = %L$$, :p_kid)) = 0,
  'F · and cannot change it (a parent sets it)');
select pg_temp.claims(:stranger, true);
select pg_temp.assert((select count(*) from app.person_profile_details where center_id = :'jt') = 0
                      and pg_temp.affected(format($$update app.person_profile_details set path_key = 'other' where person_id = %L$$, :p_mom)) = 0,
  'F · an adult of another household reads and changes nothing');
select pg_temp.claims(:jadmin, true);
select pg_temp.assert((select count(*) from app.person_profile_details where center_id = :'jt') = 2
                      and pg_temp.affected(format($$update app.person_profile_details set path_key = 'other' where person_id = %L$$, :p_mom)) = 0,
  'F · staff with people.view read the path (the office) and cannot write it');
select pg_temp.claims(:chmember, true);
select pg_temp.assert_raises(format($$insert into app.person_profile_details (person_id, center_id, path_key) values (%L, %L, 'digambar')$$, :p_chm, :'chm'),
  'does not ask which path', 'F · a chamber asks no path: setting one is refused');
select pg_temp.assert(pg_temp.affected(format($$insert into app.person_profile_details (person_id, center_id, dietary) values (%L, %L, array['vegan'])$$, :p_chm, :'chm')) = 1,
  'F · while the rest of the details work there');
reset role;
select pg_temp.no_claims();
-- Audit: that it changed, never the answer.
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'person_profile_details' and after->>'path_key' is not null) >= 4
                      and not exists (select 1 from app.audit_log where record_table = 'person_profile_details'
                                         and (after->>'path_key' not in ('***') or before->>'path_key' not in ('***'))),
  'F · the audit log records that a path changed, never which one');
select pg_temp.assert(app.audit_mask('{"path_key":"x"}'::jsonb)->>'path_key' = '***',
  'F · MERGE ORDER guard: the current app.audit_mask masks path_key (if this fails, an earlier-numbered migration was applied after 0594 and put the older mask back)');
select pg_temp.assert(app.audit_mask('{"path_key":"digambar","dietary":[]}'::jsonb) = '{"path_key":"***","dietary":[]}'::jsonb
                      and app.audit_mask('{"path_key":null}'::jsonb) = '{"path_key":null}'::jsonb
                      and app.audit_mask('{"date_of_birth":"1980-01-01","assistance_note":"abcd"}'::jsonb)
                            = '{"date_of_birth":"***","assistance_note":"*** (4 characters)"}'::jsonb,
  'F · audit_mask masks path_key, leaves a cleared one clear, and keeps the earlier masks');
select pg_temp.assert(not has_column_privilege('anon', 'app.person_profile_details', 'path_key', 'select'),
  'F · guests read nothing of it');

rollback;
