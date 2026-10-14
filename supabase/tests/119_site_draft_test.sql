-- 0642 / 0643 / 0644: the first draft of an organization's website, as data (B92 W3).
--   A. Storing a draft: settings.manage only (a content editor, another community's administrator and a visitor are refused).
--   B. What is refused, in plain English, and that nothing is saved by a refused draft (no pages, too many pages or blocks, an
--      unusable page name, a repeated name, an unknown page or block kind, words kept from the old website with no old page
--      named, an old page named for words that are not from it, a block with no source, content that is not an object, a
--      website read of another community).
--   C. A good draft: pages and blocks in order, a stand-in is always marked, a second draft is refused unless replacing is
--      asked for, replacing clears the approvals and raises the version.
--   D. Reading the draft (with and without blocks), for settings.manage of that community only.
--   E. Approving a page and reopening it.
--   F. Guests read NOTHING: the tables have no grant and no policy, no function is open to anon, the audit trigger and the
--      activity catalog entries are in place.
--   G. Weaver's own records for the draft (app.site_draft_data): only what is public, nothing about money or people beyond the
--      leaders chosen for the public, and only for settings.manage of that community.
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
create or replace function pg_temp.sign_in(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
-- A good draft of two pages (the home page has one block of each source), and a way to try a broken one.
create or replace function pg_temp.good() returns jsonb language sql as $$
  select jsonb_build_object(
    'name', 'Website One',
    'theme', jsonb_build_object('palette', jsonb_build_object('primary', '#1b2c5c'), 'hero_style', 'text'),
    'pages', jsonb_build_array(
      jsonb_build_object('slug', 'home', 'title', 'Home', 'kind', 'home', 'source_path', '/', 'blocks', jsonb_build_array(
        jsonb_build_object('type', 'hero', 'content', jsonb_build_object('heading', 'Website One', 'subheading', 'A friendly place.'),
                           'source', 'own_site', 'source_page', 'https://www.old119.example.org/'),
        jsonb_build_object('type', 'text', 'content', jsonb_build_object('heading', 'About us', 'paragraphs', jsonb_build_array('Add your own words here.')),
                           'source', 'written', 'needs_text', false),
        jsonb_build_object('type', 'footer', 'content', jsonb_build_object('name', 'Website One'), 'source', 'weaver_data'))),
      jsonb_build_object('slug', 'about', 'title', 'About us', 'kind', 'about', 'blocks', jsonb_build_array(
        jsonb_build_object('type', 'text', 'content', jsonb_build_object('heading', 'About us'), 'source', 'weaver_data')))))
$$;
create or replace function pg_temp.save_raises(p_center uuid, p_draft jsonb, p_expect text, p_label text) returns void language plpgsql as $$
begin
  perform pg_temp.assert_raises(format('select app.site_draft_save(%L, %L::jsonb)', p_center, p_draft::text), p_expect, p_label);
end $$;

\set c '''11900000-0000-4000-8000-0000000000c1'''
\set c2 '''11900000-0000-4000-8000-0000000000c2'''
\set admin '''11900000-0000-4000-8000-000000000001'''
\set editor '''11900000-0000-4000-8000-000000000002'''
\set admin2 '''11900000-0000-4000-8000-000000000003'''
insert into auth.users (id, email) values (:admin, 'admin119@example.com'), (:editor, 'editor119@example.com'), (:admin2, 'admin119b@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status) values
  (:c, 'site119', 'Website One', 'WS1', 'TX', 'active'),
  (:c2, 'site119b', 'Website Two', 'WS2', 'TX', 'active');
-- 0751: the website draft is WeaverSite (module `website`), which every kind starts off; these communities hold it (test 160
-- covers one that does not).
insert into app.center_module_grants (center_id, module_key, granted, reason) values
  (:c, 'website', true, 'Test 119: the draft needs WeaverSite (0751)'), (:c2, 'website', true, 'Test 119: the draft needs WeaverSite (0751)');
insert into app.role_grants (center_id, user_id, role_key) values
  (:c, :admin, 'center_admin'), (:c, :editor, 'content_editor'), (:c2, :admin2, 'center_admin');
-- A finished website read for each community (the draft may name the read it was built from).
insert into app.jobs (center_id, kind, payload, status, result) values
  (:c, 'site.crawl', '{"slot":"own","mode":"own"}'::jsonb, 'done', '{}'::jsonb),
  (:c2, 'site.crawl', '{"slot":"own","mode":"own"}'::jsonb, 'done', '{}'::jsonb);
select (select id from app.jobs where center_id = :c and kind = 'site.crawl') as job_c,
       (select id from app.jobs where center_id = :c2 and kind = 'site.crawl') as job_c2
\gset

-- ── A. Who may store a draft ─────────────────────────────────────────────────
select pg_temp.sign_in(:editor);
select pg_temp.save_raises(:c, pg_temp.good(), 'settings.manage', 'A · a content editor (no settings.manage) cannot store a draft');
select pg_temp.sign_in(:admin2);
select pg_temp.save_raises(:c, pg_temp.good(), 'settings.manage', 'A · another community''s administrator cannot store this community''s draft');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select pg_temp.save_raises(:c, pg_temp.good(), 'permission denied', 'A · a visitor who is not signed in cannot call it at all');
reset role;

-- ── B. What is refused ───────────────────────────────────────────────────────
select pg_temp.sign_in(:admin);
select pg_temp.assert_raises(format('select app.site_draft_save(%L, null)', :c), 'not in the expected form', 'B · no draft at all is refused');
select pg_temp.save_raises(:c, pg_temp.good() - 'name', 'needs the organization''s name', 'B · a draft with no name is refused');
select pg_temp.save_raises(:c, pg_temp.good() - 'theme', 'needs a theme', 'B · a draft with no theme is refused');
select pg_temp.save_raises(:c, jsonb_set(pg_temp.good(), '{pages}', '[]'), 'at least one page', 'B · a draft with no pages is refused');
select pg_temp.save_raises(:c,
  jsonb_set(pg_temp.good(), '{pages}', (select jsonb_agg(jsonb_build_object('slug', 'p' || g, 'title', 'P', 'kind', 'about',
      'blocks', jsonb_build_array(jsonb_build_object('type', 'text', 'content', '{}'::jsonb, 'source', 'weaver_data')))) from generate_series(1, 13) g)),
  'at most 12 pages', 'B · thirteen pages are refused');
select pg_temp.save_raises(:c, jsonb_set(pg_temp.good(), '{pages,1,slug}', '"Bad Slug"'), 'web address', 'B · a page name that cannot be a web address is refused');
select pg_temp.save_raises(:c, jsonb_set(pg_temp.good(), '{pages,1,slug}', '"home"'), 'both called', 'B · two pages with the same name are refused');
select pg_temp.save_raises(:c, jsonb_set(pg_temp.good(), '{pages,1,kind}', '"shop"'), 'does not know', 'B · an unknown page kind is refused');
select pg_temp.save_raises(:c, jsonb_set(pg_temp.good(), '{pages,1,blocks}', '[]'), 'has no blocks', 'B · a page with no blocks is refused');
select pg_temp.save_raises(:c,
  jsonb_set(pg_temp.good(), '{pages,1,blocks}', (select jsonb_agg(jsonb_build_object('type', 'text', 'content', '{}'::jsonb, 'source', 'weaver_data')) from generate_series(1, 31))),
  'at most 30', 'B · thirty-one blocks on one page are refused');
select pg_temp.save_raises(:c, jsonb_set(pg_temp.good(), '{pages,0,blocks,1,type}', '"script"'), 'does not know', 'B · an unknown block kind is refused');
select pg_temp.save_raises(:c, jsonb_set(pg_temp.good(), '{pages,0,blocks,1,source}', '"somewhere"'), 'where its words came from', 'B · a block with an unknown source is refused');
select pg_temp.save_raises(:c, jsonb_set(pg_temp.good(), '{pages,0,blocks,0,source_page}', 'null'::jsonb), 'does not say which page',
  'B · words kept from the old website with no old page named are refused');
select pg_temp.save_raises(:c, jsonb_set(pg_temp.good(), '{pages,0,blocks,0,source}', '"weaver_data"'), 'names an old page',
  'B · an old page named for words that are not from it is refused');
select pg_temp.save_raises(:c, jsonb_set(pg_temp.good(), '{pages,0,blocks,1,content}', '"just text"'), 'not in the expected form', 'B · block content that is not an object is refused');
select pg_temp.save_raises(:c, jsonb_set(pg_temp.good(), '{pages,0,blocks,1,content}', jsonb_build_object('heading', repeat('x', 31000))), 'too long',
  'B · a block of more than 30,000 characters is refused');
select pg_temp.assert_raises(format('select app.site_draft_save(%L, %L::jsonb, %s)', :c, pg_temp.good()::text, :job_c2), 'does not belong to this community',
  'B · a website read of another community cannot be named as the source');
reset role;
select pg_temp.assert(not exists (select 1 from app.sites where center_id = :c) and not exists (select 1 from app.site_pages where center_id = :c),
  'B · nothing was saved by the refused drafts');


-- ── C. A good draft ──────────────────────────────────────────────────────────
select pg_temp.sign_in(:admin);
select app.site_draft_save(:c, pg_temp.good(), :job_c) as first_save
\gset
reset role;
select pg_temp.assert((:'first_save'::jsonb ->> 'draft_version')::int = 1 and (:'first_save'::jsonb ->> 'pages')::int = 2
                      and (:'first_save'::jsonb ->> 'blocks')::int = 4 and (:'first_save'::jsonb ->> 'replaced')::boolean = false,
  'C · settings.manage stores a draft: version 1, two pages, four blocks');
select pg_temp.assert((select name = 'Website One' and status = 'draft' and draft_version = 1 and source_job = :job_c and built_by = :admin
                         from app.sites where center_id = :c),
  'C · the site is a draft, built by the administrator from that website read');
select pg_temp.assert((select array_agg(slug order by sort) from app.site_pages where center_id = :c) = array['home', 'about'],
  'C · the pages keep their order');
select pg_temp.assert((select array_agg(b.type order by b.sort) from app.site_blocks b join app.site_pages p on p.id = b.page_id where p.center_id = :c and p.slug = 'home')
                      = array['hero', 'text', 'footer'],
  'C · the blocks of a page keep their order');
select pg_temp.assert((select needs_text from app.site_blocks where center_id = :c and source = 'written'),
  'C · a stand-in is marked for the person to replace even when the draft did not say so');
select pg_temp.assert((select count(*) from app.site_blocks where center_id = :c and source = 'own_site' and source_page = 'https://www.old119.example.org/') = 1
                      and (select count(*) from app.site_blocks where center_id = :c and source = 'weaver_data' and source_page is null) = 2,
  'C · words kept from the old website name the old page; the others name none');

select pg_temp.sign_in(:admin);
select pg_temp.assert_raises(format('select app.site_draft_save(%L, %L::jsonb)', :c, pg_temp.good()::text), 'already has a website draft',
  'C · a second draft is refused unless replacing is asked for');
select pg_temp.assert_raises(format('select app.site_draft_save(%L, %L::jsonb, null, false)', :c, pg_temp.good()::text), 'already has a website draft',
  'C · replace = false is the same as leaving it out');
reset role;
select id as home_id from app.site_pages where center_id = :c and slug = 'home'
\gset
select pg_temp.sign_in(:admin);
select app.site_page_set_status(:c, :'home_id', 'approved');
select app.site_draft_save(:c, jsonb_set(pg_temp.good(), '{name}', '"Website One again"'), :job_c, true) as second_save
\gset
reset role;
select pg_temp.assert((:'second_save'::jsonb ->> 'draft_version')::int = 2 and (:'second_save'::jsonb ->> 'replaced')::boolean = true
                      and (select name = 'Website One again' and draft_version = 2 from app.sites where center_id = :c),
  'C · replacing a draft raises its version');
select pg_temp.assert(not exists (select 1 from app.site_pages where id = :'home_id')
                      and (select count(*) from app.site_pages where center_id = :c) = 2
                      and (select count(*) from app.site_blocks where center_id = :c) = 4,
  'C · replacing a draft leaves no page or block of the old one behind');
select pg_temp.assert(not exists (select 1 from app.site_pages where center_id = :c and (status <> 'draft' or approved_at is not null or approved_by is not null)),
  'C · replacing a draft clears the approvals');

-- ── D. Reading the draft ─────────────────────────────────────────────────────
select pg_temp.sign_in(:admin);
select app.site_draft_get(:c) as full_draft, app.site_draft_get(:c, false) as light_draft
\gset
reset role;
select pg_temp.assert((:'full_draft'::jsonb -> 'site' ->> 'draft_version')::int = 2 and (:'full_draft'::jsonb -> 'site' ->> 'name') = 'Website One again'
                      and (:'full_draft'::jsonb -> 'site' ->> 'source_job')::bigint = :job_c and (:'full_draft'::jsonb -> 'site' -> 'theme' -> 'palette' ->> 'primary') = '#1b2c5c',
  'D · the draft comes back with its name, version, theme and the read it was built from');
select pg_temp.assert(jsonb_array_length(:'full_draft'::jsonb -> 'pages') = 2
                      and (:'full_draft'::jsonb -> 'pages' -> 0 ->> 'slug') = 'home'
                      and jsonb_array_length(:'full_draft'::jsonb -> 'pages' -> 0 -> 'blocks') = 3
                      and (:'full_draft'::jsonb -> 'pages' -> 0 -> 'blocks' -> 0 ->> 'type') = 'hero'
                      and (:'full_draft'::jsonb -> 'pages' -> 0 -> 'blocks' -> 0 ->> 'source') = 'own_site'
                      and (:'full_draft'::jsonb -> 'pages' -> 0 -> 'blocks' -> 0 -> 'content' ->> 'heading') = 'Website One'
                      and (:'full_draft'::jsonb -> 'pages' -> 0 -> 'blocks' -> 1 ->> 'needs_text')::boolean,
  'D · the pages and blocks come back in order, with their content and where it came from');
select pg_temp.assert(not ((:'light_draft'::jsonb -> 'pages' -> 0) ? 'blocks')
                      and (:'light_draft'::jsonb -> 'pages' -> 0 ->> 'block_count')::int = 3
                      and (:'light_draft'::jsonb -> 'pages' -> 0 ->> 'stand_ins')::int = 1
                      and (:'light_draft'::jsonb -> 'pages' -> 1 ->> 'stand_ins')::int = 0,
  'D · without blocks, each page says how many blocks it has and how many are stand-ins');

select pg_temp.sign_in(:editor);
select pg_temp.assert_raises(format('select app.site_draft_get(%L)', :c), 'settings.manage', 'D · a content editor cannot read the draft');
select pg_temp.sign_in(:admin2);
select pg_temp.assert_raises(format('select app.site_draft_get(%L)', :c), 'settings.manage', 'D · another community''s administrator cannot read the draft');
select pg_temp.assert(app.site_draft_get(:c2) is null, 'D · a community with no draft gets null');
reset role;

-- ── E. Approving a page, and reopening it ────────────────────────────────────
select id as home_id2 from app.site_pages where center_id = :c and slug = 'home'
\gset
select pg_temp.sign_in(:admin);
select pg_temp.assert((app.site_page_set_status(:c, :'home_id2', 'approved') ->> 'status') = 'approved', 'E · settings.manage approves a page');
reset role;
select pg_temp.assert((select status = 'approved' and approved_by = :admin and approved_at is not null from app.site_pages where id = :'home_id2'),
  'E · the page records who approved it and when');
select pg_temp.sign_in(:admin);
select pg_temp.assert((app.site_page_set_status(:c, :'home_id2', 'draft') ->> 'status') = 'draft', 'E · a page can be reopened');
reset role;
select pg_temp.assert((select status = 'draft' and approved_by is null and approved_at is null from app.site_pages where id = :'home_id2'),
  'E · a reopened page forgets its approval');
select pg_temp.sign_in(:admin);
select pg_temp.assert_raises(format('select app.site_page_set_status(%L, %L, %L)', :c, :'home_id2', 'published'), 'either a draft or approved',
  'E · there is no "published" in this phase');
select pg_temp.assert_raises(format('select app.site_page_set_status(%L, %L, %L)', :c, '11900000-0000-4000-8000-0000000000ff', 'approved'), 'not part of',
  'E · a page that does not exist is refused');
select pg_temp.sign_in(:editor);
select pg_temp.assert_raises(format('select app.site_page_set_status(%L, %L, %L)', :c, :'home_id2', 'approved'), 'settings.manage', 'E · a content editor cannot approve a page');
select pg_temp.sign_in(:admin2);
select pg_temp.assert_raises(format('select app.site_page_set_status(%L, %L, %L)', :c, :'home_id2', 'approved'), 'settings.manage',
  'E · another community''s administrator cannot approve this community''s page');
select pg_temp.assert_raises(format('select app.site_page_set_status(%L, %L, %L)', :c2, :'home_id2', 'approved'), 'not part of',
  'E · a page cannot be approved through another community''s id');
reset role;

-- ── F. Guests read NOTHING ───────────────────────────────────────────────────
select pg_temp.assert(not exists (
    select 1 from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['select', 'insert', 'update', 'delete']) p,
                  unnest(array['app.sites', 'app.site_pages', 'app.site_blocks']) t
     where has_table_privilege(r, t, p)),
  'F · the three tables have no grant for the API at all');
select pg_temp.assert((select count(*) from pg_class where oid in ('app.sites'::regclass, 'app.site_pages'::regclass, 'app.site_blocks'::regclass) and relrowsecurity) = 3
                      and not exists (select 1 from pg_policy where polrelid in ('app.sites'::regclass, 'app.site_pages'::regclass, 'app.site_blocks'::regclass)
                                         and (polpermissive or polname <> 'module_switch')),
  'F · row level security is on and no policy lets anything in (0751 adds only the restrictive module_switch, which can only narrow): nothing but the checked functions reaches the draft');
select pg_temp.sign_in(:admin);
select pg_temp.assert_raises('select * from app.sites', 'permission denied', 'F · even an administrator cannot read the sites table directly');
select pg_temp.assert_raises('select * from app.site_pages', 'permission denied', 'F · nor the pages');
select pg_temp.assert_raises('select * from app.site_blocks', 'permission denied', 'F · nor the blocks');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select pg_temp.assert_raises('select * from app.site_blocks', 'permission denied', 'F · a visitor cannot read the blocks');
select pg_temp.assert_raises(format('select app.site_draft_get(%L)', :c), 'permission denied', 'F · a visitor cannot call site_draft_get');
select pg_temp.assert_raises(format('select app.site_page_set_status(%L, %L, %L)', :c, :'home_id2', 'approved'), 'permission denied', 'F · a visitor cannot approve a page');
select pg_temp.assert_raises(format('select app.site_draft_data(%L)', :c), 'permission denied', 'F · a visitor cannot read Weaver''s records for the draft');
reset role;
select pg_temp.assert(not exists (
    select 1 from unnest(array['app.site_draft_save(uuid,jsonb,bigint,boolean)', 'app.site_draft_get(uuid,boolean)', 'app.site_page_set_status(uuid,uuid,text)', 'app.site_draft_data(uuid)']) f,
                  unnest(array['anon', 'service_role']) r
     where has_function_privilege(r, f, 'execute'))
                      and not exists (
    select 1 from unnest(array['app.site_draft_save(uuid,jsonb,bigint,boolean)', 'app.site_draft_get(uuid,boolean)', 'app.site_page_set_status(uuid,uuid,text)', 'app.site_draft_data(uuid)']) f
     where not has_function_privilege('authenticated', f, 'execute')),
  'F · the four functions are for signed-in people only (not anon, not service_role)');
select pg_temp.assert((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname in ('site_draft_save', 'site_draft_get', 'site_page_set_status', 'site_draft_data')
                          and p.prosecdef and p.proconfig::text like '%search_path=app, public, extensions%') = 4,
  'F · every function is security definer and pins the search path app, public, extensions');
select pg_temp.assert((select count(*) from pg_trigger t where t.tgname in ('audit_sites', 'audit_site_pages', 'audit_site_blocks')
                          and t.tgrelid in ('app.sites'::regclass, 'app.site_pages'::regclass, 'app.site_blocks'::regclass)
                          and t.tgfoid = 'app.audit_row'::regproc and not t.tgisinternal) = 3
                      and (select count(*) from app.module_tables where table_name in ('sites', 'site_pages', 'site_blocks') and module_key = 'website') = 3,
  'F · the three tables are audited and mapped to WeaverSite (0751; they were core platform tables until then)');
select pg_temp.assert(exists (select 1 from app.audit_log where record_table = 'site_pages' and center_id = :c),
  'F · changes to the pages are in the audit log');
select pg_temp.assert((select count(*) from app.activity_catalog
                        where (key, surface) in (('screen:/setup/website/preview', 'portal'), ('website.build_draft', 'portal'), ('website.approve_page', 'portal'))) = 3,
  'F · the preview and its two actions are in the activity allowlist (0644)');

-- ── G. Weaver's own records for the draft ────────────────────────────────────
insert into app.org_profiles (center_id, mission, about, public_email, public_phone, office_hours, registered_address, latitude, longitude, social)
values (:c, 'We bring neighbours together.', 'First paragraph.' || chr(10) || chr(10) || 'Second paragraph.', 'hello119@example.org', '+12815550199', 'Weekdays, ten to four',
        '{"line1":"77 Orchard Lane","city":"Katy","state":"TX","postal_code":"77494"}'::jsonb, 29.7858, -95.8244, '{"facebook":"https://www.facebook.com/site119"}'::jsonb);
insert into app.events (center_id, name, starts_at, ends_at, status, audience, confidential, venue, description) values
  (:c, 'Public supper', now() + interval '10 days', now() + interval '10 days 2 hours', 'published', 'public', false, 'Main hall', 'A shared meal.'),
  (:c, 'Guests welcome', now() + interval '5 days', null, 'published', 'members_and_guests', false, null, null),
  (:c, 'Members only', now() + interval '6 days', null, 'published', 'members_only', false, null, null),
  (:c, 'Draft event', now() + interval '7 days', null, 'draft', 'public', false, null, null),
  (:c, 'Secret event', now() + interval '8 days', null, 'published', 'public', true, null, null),
  (:c, 'Past event', now() - interval '3 days', now() - interval '3 days' + interval '2 hours', 'published', 'public', false, null, null);
insert into app.campaigns (id, center_id, name, kind, description, status, active, ends_on) values
  ('11900000-0000-4000-8000-0000000000a1', :c, 'Roof Fund', 'construction', 'Repair the roof.', 'published', true, null),
  ('11900000-0000-4000-8000-0000000000a2', :c, 'Hidden draft', 'general', null, 'draft', true, null),
  ('11900000-0000-4000-8000-0000000000a3', :c, 'Old campaign', 'general', null, 'published', true, current_date - 1),
  ('11900000-0000-4000-8000-0000000000a4', :c, 'Switched off', 'general', null, 'published', false, null);
insert into app.opportunities (center_id, campaign_id, name, description, amount_cents, status) values
  (:c, '11900000-0000-4000-8000-0000000000a1', 'Sponsor a beam', 'One beam.', 10100, 'open'),
  (:c, '11900000-0000-4000-8000-0000000000a1', 'Closed item', null, 5000, 'closed');
insert into app.org_leaders (center_id, full_name, title, body, show_publicly, sort) values
  (:c, 'Asha Verma', 'President', 'executive_committee', true, 1),
  (:c, 'Hidden Person', 'Secretary', 'executive_committee', false, 2);
insert into app.photo_albums (id, center_id, title, visibility) values
  ('11900000-0000-4000-8000-0000000000b1', :c, 'Harvest', 'public'),
  ('11900000-0000-4000-8000-0000000000b2', :c, 'Members album', 'members');
insert into app.photos (center_id, album_id, storage_path, status, contains_children) values
  (:c, '11900000-0000-4000-8000-0000000000b1', '11900000-0000-4000-8000-0000000000c1/p1.jpg', 'approved', false),
  (:c, '11900000-0000-4000-8000-0000000000b1', '11900000-0000-4000-8000-0000000000c1/p2.jpg', 'approved', true),
  (:c, '11900000-0000-4000-8000-0000000000b1', '11900000-0000-4000-8000-0000000000c1/p3.jpg', 'pending', false),
  (:c, '11900000-0000-4000-8000-0000000000b2', '11900000-0000-4000-8000-0000000000c1/p4.jpg', 'approved', false);
insert into app.store_items (center_id, name, price_cents, status) values
  (:c, 'Tea towels', 500, 'active'), (:c, 'Retired thing', 100, 'retired'), (:c2, 'Hidden shop item', 100, 'active');
insert into app.daily_timings (center_id, on_date, temple_open, temple_close)
  select :c, (now() at time zone coalesce(nullif(btrim(time_zone), ''), 'UTC'))::date, '06:00', '20:00' from app.centers where id = :c;
insert into app.pathshala_tracks (id, center_id, key, name) values ('11900000-0000-4000-8000-0000000000d1', :c, 'main119', 'Main');
insert into app.pathshala_levels (id, center_id, track_id, key, name, sort_order)
  values ('11900000-0000-4000-8000-0000000000d2', :c, '11900000-0000-4000-8000-0000000000d1', '1', 'Level One', 1);
insert into app.pathshala_terms (center_id, name, starts_on, ends_on, status) values (:c, 'Autumn term', current_date - 10, current_date + 200, 'active');

select pg_temp.sign_in(:admin);
select app.site_draft_data(:c) as d119
\gset
reset role;
select pg_temp.assert((select string_agg(k, ',' order by k) from jsonb_object_keys(:'d119'::jsonb) k) = 'albums,center,events,giving,leaders,profile,school,store,today',
  'G · the answer has exactly these parts: center, profile, leaders, events, giving, today, albums, store, school');
select pg_temp.assert((:'d119'::jsonb -> 'center' ->> 'name') = 'Website One' and (:'d119'::jsonb -> 'center' ->> 'short_name') = 'WS1'
                      and (:'d119'::jsonb -> 'profile' ->> 'mission') = 'We bring neighbours together.'
                      and (:'d119'::jsonb -> 'profile' ->> 'public_email') = 'hello119@example.org' and (:'d119'::jsonb -> 'profile' ->> 'public_phone') = '+12815550199'
                      and (:'d119'::jsonb -> 'profile' ->> 'address') = '77 Orchard Lane, Katy, TX 77494'
                      and (:'d119'::jsonb -> 'profile' -> 'social' ->> 'facebook') = 'https://www.facebook.com/site119',
  'G · the name and the public profile come back, the address written on one line');
select pg_temp.assert((select jsonb_agg(i ->> 'title' order by ord) from jsonb_array_elements(:'d119'::jsonb -> 'events' -> 'items') with ordinality t(i, ord))
                         = '["Guests welcome", "Public supper"]'::jsonb
                      and (:'d119'::jsonb -> 'events' ->> 'on')::boolean,
  'G · only upcoming, published events open to the public or to guests, and not confidential, soonest first');
select pg_temp.assert((select string_agg(k, ',' order by k) from jsonb_object_keys(:'d119'::jsonb -> 'events' -> 'items' -> 1) k) = 'description,ends_at,starts_at,title,venue',
  'G · an event carries its title, times, place and description, and nothing about who is coming or what it costs');
select pg_temp.assert((select jsonb_agg(c ->> 'name') from jsonb_array_elements(:'d119'::jsonb -> 'giving' -> 'campaigns') c) = '["Roof Fund"]'::jsonb
                      and (select jsonb_agg(i ->> 'name') from jsonb_array_elements(:'d119'::jsonb -> 'giving' -> 'campaigns' -> 0 -> 'items') i) = '["Sponsor a beam"]'::jsonb,
  'G · only a published campaign that is visible now (not a draft, not past its end, not switched off), with its open opportunities');
select pg_temp.assert(position('amount' in :'d119') = 0 and position('Hidden Person' in :'d119') = 0 and position('Hidden shop item' in :'d119') = 0 and position('Closed item' in :'d119') = 0,
  'G · no amount, no closed opportunity, no leader who is not shown publicly and nothing of another community is in the answer');
select pg_temp.assert((:'d119'::jsonb -> 'leaders') = '[{"name": "Asha Verma", "title": "President"}]'::jsonb,
  'G · only the leaders the organization chose to show, with their name and title');
select pg_temp.assert((:'d119'::jsonb -> 'albums') = '[{"title": "Harvest", "photos": 1}]'::jsonb,
  'G · only public albums, counting approved photos that do not show children');
select pg_temp.assert((:'d119'::jsonb -> 'store') = '{"on": true, "items": ["Tea towels"]}'::jsonb,
  'G · the store: on, and the names of active items only');
select pg_temp.assert((:'d119'::jsonb -> 'school' ->> 'on')::boolean and (:'d119'::jsonb -> 'school' -> 'levels') = '["Level One"]'::jsonb
                      and (:'d119'::jsonb -> 'school' -> 'term' ->> 'name') = 'Autumn term',
  'G · the school: on, with its levels and its current term');
select pg_temp.assert((:'d119'::jsonb -> 'today' ->> 'open') = '06:00' and (:'d119'::jsonb -> 'today' ->> 'close') = '20:00',
  'G · today''s opening and closing time');

-- Switch the store off for the second community the way other tests do, as the database owner (writing the table directly).
select set_config('request.jwt.claims', '', true);
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c2, 'store', false, 'test 119');
select pg_temp.sign_in(:admin2);
select app.site_draft_data(:c2) as d119b
\gset
reset role;
select pg_temp.assert((:'d119b'::jsonb -> 'events' -> 'items') = '[]'::jsonb and (:'d119b'::jsonb -> 'giving' -> 'campaigns') = '[]'::jsonb
                      and (:'d119b'::jsonb -> 'leaders') = '[]'::jsonb and (:'d119b'::jsonb -> 'albums') = '[]'::jsonb and (:'d119b'::jsonb -> 'today') = 'null'::jsonb
                      and not (:'d119b'::jsonb -> 'school' ->> 'on')::boolean,
  'G · a community with nothing set up gets empty lists, not an error');
select pg_temp.assert((:'d119b'::jsonb -> 'store') = '{"on": false, "items": []}'::jsonb,
  'G · a store that is switched off gives nothing, though it has an active item');

select pg_temp.sign_in(:editor);
select pg_temp.assert_raises(format('select app.site_draft_data(%L)', :c), 'settings.manage', 'G · a content editor cannot read Weaver''s records for the draft');
select pg_temp.sign_in(:admin2);
select pg_temp.assert_raises(format('select app.site_draft_data(%L)', :c), 'settings.manage', 'G · another community''s administrator cannot read them either');
reset role;

rollback;
