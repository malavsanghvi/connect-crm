-- 0813: the community table is closed (docs/COMMUNITY_PUBLIC_DATA.md).
--   A. A guest reads only the plain columns of active communities from the table (what installed apps' finders ask still
--      works; the settings are refused), and the public part through app.community_public.
--   B. A signed-in person reads from the table only the communities they are linked to; the rest through the readers.
--   C. Staff, the owner and a platform admin of a community still being set up; a member's own full row.
--   D. The things that asked the table as the caller: public leaders, the access areas (feature_access_for_me,
--      member_experience, can_use_feature) for a community still being set up.
--   E. Exactly which columns a guest holds (any column added later is refused until it is granted on purpose).
--   F. What counts as "linked" (a role of any scope) and what does not (an ended role, one waiting for its second approver,
--      another community's staff).
--   G. A community still being set up is hidden in every reader from guests and from strangers (table, community_public,
--      the access areas, can_use_feature, the member experience, the category profile).
--   H. What keeps working for the people who work in a community: saving the settings, a platform admin creating a community
--      and reading it back, and the during-event dates (the two triggers that read the community's time zone as the caller).
--   I. Every public-read function still answers a guest (finder, address, join code, own domain, HTTPS host, public pages).
--   J. A demo person (a faith demo community made as test 116 does, its sign-ins set up and linked by app.demo_signin_setup /
--      set_demo_signin, which call app.demo_link_personas) reads only the demo community; a guest still gets the demo list.
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
create or replace function pg_temp.claims(p_user uuid, p_step_up boolean default false) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', case when p_step_up then 'aal2' else 'aal1' end,
    'amr', case when p_step_up
                then jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 600),
                                       jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 60))
                else jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 60) ) end)::text, true);
  perform set_config('request.headers', '', true);
end $$;
create or replace function pg_temp.no_claims() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;
create or replace function pg_temp.keys(j jsonb) returns text language sql as $$
  select coalesce(string_agg(k, ',' order by k), '') from jsonb_object_keys(j) k
$$;

\set a813 '''81300000-0000-4000-8000-0000000000a1'''
\set b813 '''81300000-0000-4000-8000-0000000000b1'''
\set member813 '''81300000-0000-4000-8000-000000000001'''
\set staff813 '''81300000-0000-4000-8000-000000000002'''
\set owner813 '''81300000-0000-4000-8000-000000000003'''
\set outsider813 '''81300000-0000-4000-8000-000000000004'''
\set admin813 '''81300000-0000-4000-8000-000000000005'''
\set scoped813 '''81300000-0000-4000-8000-000000000006'''
\set expired813 '''81300000-0000-4000-8000-000000000007'''
\set pending813 '''81300000-0000-4000-8000-000000000008'''
\set manager813 '''81300000-0000-4000-8000-000000000009'''
\set ev813 '''81300000-0000-4000-8000-0000000000e1'''
\set new813 '''81300000-0000-4000-8000-0000000000c1'''
\set jsh '''00000000-0000-4000-8000-000000000001'''

select pg_temp.no_claims();
insert into auth.users (id, email) values
  (:member813, 'member813@pub813.test'), (:staff813, 'staff813@onb813.test'), (:owner813, 'owner813@onb813.test'),
  (:outsider813, 'outsider813@else813.test'), (:admin813, 'admin813@platform813.test'),
  (:scoped813, 'scoped813@pub813.test'), (:expired813, 'expired813@pub813.test'), (:pending813, 'pending813@pub813.test'),
  (:manager813, 'manager813@pub813.test');
insert into app.accounts (user_id, is_platform_admin) values (:admin813, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, short_name, state_region, time_zone, status, environment, rules, branding, feature_flags) values
  (:a813, 'pub813', 'Public 813', 'P813', 'TX', 'Pacific/Auckland', 'active', 'production',
   jsonb_build_object('security', jsonb_build_object('require_2fa_for_staff', true), 'store', jsonb_build_object('gift_pack_cents', 300)),
   jsonb_build_object('logo_url', 'https://example.org/logo813.png', 'internal_note', 'staff only 813'),
   jsonb_build_object('store', true)),
  (:b813, 'onb813-sandbox', 'Onboarding 813', 'O813', 'CA', 'America/Chicago', 'onboarding', 'sandbox',
   jsonb_build_object('security', jsonb_build_object('require_2fa_for_staff', true)), '{}'::jsonb, '{}'::jsonb);
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  ('81300000-0000-4000-8000-0000000000d1', :a813, 'Mira', 'Member813', date '1980-01-01');
insert into app.center_users (center_id, user_id, person_id) values (:a813, :member813, '81300000-0000-4000-8000-0000000000d1');
insert into app.center_owners (center_id, user_id) values (:b813, :owner813) on conflict (center_id) do update set user_id = excluded.user_id;
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values (:b813, :staff813, 'event_lead', 'center', 'test 813');
insert into app.org_leaders (center_id, full_name, title, show_publicly) values
  (:a813, 'Asha Leader813', 'President', true), (:b813, 'Bina Leader813', 'President', true);
-- A tester's roles (F): an event-scoped lead (linked only by that scoped role), a role that ended yesterday, a center administrator
-- still waiting for the second approver, and a settings manager. An event of the active community, in a time zone whose date differs
-- from UTC's at noon UTC, so a lost community row would show as a wrong (UTC) or empty date (H).
insert into app.events (id, center_id, name, starts_at) values (:ev813, :a813, 'Evening event 813', timestamptz '2030-03-10 12:00:00+00');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id, reason) values
  (:a813, :scoped813, 'event_lead', 'event', :ev813, 'test 813');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, starts_at, ends_at, reason) values
  (:a813, :expired813, 'event_lead', 'center', now() - interval '3 days', now() - interval '1 day', 'test 813');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, status, starts_at, reason) values
  (:a813, :pending813, 'center_admin', 'center', 'pending', 'infinity', 'test 813');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:a813, :manager813, 'center_admin', 'center', 'test 813');
-- The address, the join code and the HTTPS host a guest arrives with (I).
insert into app.center_domains (domain, center_id) values ('pub813.example.test', :a813);
select code as code813 from app.member_join_codes where center_id = :a813 and active limit 1 \gset

-- ══ A. A guest ═══════════════════════════════════════════════════════════════
set role anon;
-- The finder of an installed app (connect-mobile before 1.13.1): these columns, active communities.
select pg_temp.assert((select count(*) = 1 from app.centers where status = 'active' and slug = 'pub813'
                                                              and name = 'Public 813' and short_name = 'P813' and state_region = 'TX'
                                                              and environment = 'production'),
  'A · the old finder''s columns still read for an active community');
select pg_temp.assert((select count(*) = 1 from (select id, tradition, time_zone, country, currency, category_key from app.centers where id = :a813) x),
  'A · and the other plain columns');
select pg_temp.assert((select count(*) = 0 from app.centers where id = :b813),
  'A · a community still being set up is not in the table for a guest');
select pg_temp.assert_raises($$select rules from app.centers where slug = 'pub813'$$, 'permission denied',
  'A · rules are refused to a guest');
select pg_temp.assert_raises($$select branding from app.centers where slug = 'pub813'$$, 'permission denied',
  'A · branding is refused to a guest');
select pg_temp.assert_raises($$select feature_flags from app.centers where slug = 'pub813'$$, 'permission denied',
  'A · feature flags are refused to a guest');
select pg_temp.assert_raises($$select * from app.centers where slug = 'pub813'$$, 'permission denied',
  'A · so is the whole row (what an installed app''s guest community read asks)');
select pg_temp.assert((select count(*) = 1 and bool_and(pg_temp.keys(rules) = 'store') and bool_and(not (branding ? 'internal_note'))
                         from app.community_public('pub813')),
  'A · the public part comes through app.community_public');
select pg_temp.assert((select count(*) = 0 from app.community_public('onb813-sandbox'))
                      and (select count(*) = 0 from app.community_public_by_id(:b813)),
  'A · and a community still being set up is not found there either');
reset role;

-- ══ B. A signed-in person of no community here ═══════════════════════════════
set role authenticated;
select pg_temp.claims(:outsider813);
select pg_temp.assert((select count(*) = 0 from app.centers where id in (:a813, :b813)),
  'B · a signed-in outsider reads neither community from the table (not even the active one''s settings)');
select pg_temp.assert((select count(*) = 1 and bool_and(not linked) and bool_and(not (rules ? 'security')) from app.community_public('pub813'))
                      and (select count(*) = 0 from app.community_public('onb813-sandbox')),
  'B · the active one''s public part comes through the reader; the onboarding one is not shown');
select pg_temp.assert((select count(*) = 1 from app.communities_public_list() where slug = 'pub813'),
  'B · the picker still lists the active community');

-- ══ C. Linked people ═════════════════════════════════════════════════════════
select pg_temp.claims(:member813);
select pg_temp.assert((select rules ? 'security' and branding ? 'internal_note' and feature_flags = '{"store": true}'::jsonb
                         from app.centers where id = :a813),
  'C · a member still reads their own community''s full row from the table (portal and app)');
select pg_temp.assert((select count(*) = 0 from app.centers where id = :b813), 'C · but not another community');
select pg_temp.claims(:staff813);
select pg_temp.assert((select count(*) = 1 from app.centers where id = :b813 and rules ? 'security'),
  'C · staff of the community still being set up read its row');
select pg_temp.assert((select count(*) = 1 and bool_and(linked) from app.community_public('onb813-sandbox')),
  'C · and find it through the reader, linked');
select pg_temp.claims(:owner813);
select pg_temp.assert((select count(*) = 1 from app.centers where id = :b813), 'C · so does its owner');
select pg_temp.claims(:admin813);
select pg_temp.assert((select count(*) = 2 from app.centers where id in (:a813, :b813)), 'C · a platform admin reads every row');
reset role;
select pg_temp.no_claims();

-- ══ D. What asked the table as the caller ════════════════════════════════════
set role anon;
select pg_temp.assert((select count(*) = 1 from app.org_leaders where center_id = :a813 and full_name = 'Asha Leader813')
                      and (select count(*) = 0 from app.org_leaders where center_id = :b813),
  'D · a guest sees the public leaders of an active community, not of one still being set up');
select pg_temp.assert_raises(format('select app.feature_access_for_me(%L::uuid)', :b813), 'not found',
  'D · the access areas of a community still being set up are "not found" for a guest');
select pg_temp.assert_raises(format('select app.member_experience(%L::uuid)', :b813), 'not found',
  'D · and so is its member experience');
select pg_temp.assert((select app.feature_access_for_me(:a813) ? 'features'), 'D · an active community''s areas still answer a guest');
reset role;
set role authenticated;
select pg_temp.claims(:outsider813);
select pg_temp.assert((select count(*) = 1 from app.org_leaders where center_id = :a813),
  'D · a signed-in outsider still sees the active community''s public leaders (the policy no longer reads the table as the caller)');
select pg_temp.claims(:staff813);
select pg_temp.assert((select count(*) = 1 from app.org_leaders where center_id = :b813)
                      and (select app.feature_access_for_me(:b813) ? 'features'),
  'D · staff of the community still being set up see its leaders and areas');
reset role;
select pg_temp.no_claims();

-- ══ E. Exactly which columns a guest holds ═══════════════════════════════════
select pg_temp.assert(not exists (
    select 1 from information_schema.columns c
     where c.table_schema = 'app' and c.table_name = 'centers'
       and c.column_name <> all (array['id', 'slug', 'name', 'short_name', 'tradition', 'time_zone', 'country', 'state_region',
                                       'currency', 'status', 'environment', 'category_key'])
       and has_column_privilege('anon', 'app.centers', c.column_name, 'select')),
  'E · a guest holds no column of the table beyond the twelve plain ones (rules, branding, feature_flags, sandbox_for, the timestamps, and any column added later)');
select pg_temp.assert((select count(*) = 12 from information_schema.columns c
                        where c.table_schema = 'app' and c.table_name = 'centers'
                          and has_column_privilege('anon', 'app.centers', c.column_name, 'select')),
  'E · and holds all twelve');
set role anon;
select pg_temp.assert_raises($$select created_at from app.centers where slug = 'pub813'$$, 'permission denied', 'E · the timestamps are refused to a guest');
select pg_temp.assert_raises($$select sandbox_for from app.centers where slug = 'pub813'$$, 'permission denied', 'E · so is the sandbox link');
select pg_temp.assert_raises($$select id, slug, rules from app.centers where status = 'active'$$, 'permission denied',
  'E · asking for one refused column among permitted ones refuses the whole read');
reset role;

-- ══ F. What counts as "linked" ═══════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:scoped813);
select pg_temp.assert((select count(*) = 1 and bool_and(rules ? 'security') from app.centers where id = :a813)
                      and (select count(*) = 0 from app.centers where id = :b813),
  'F · a role of any scope links (an event lead of one event reads the community''s row, and no other community''s)');
select pg_temp.claims(:manager813);
select pg_temp.assert((select count(*) = 1 from app.centers where id = :a813), 'F · a center administrator reads their community');
select pg_temp.claims(:expired813);
select pg_temp.assert((select count(*) = 0 from app.centers where id = :a813)
                      and (select count(*) = 1 and bool_and(not linked) and bool_and(not (rules ? 'security')) from app.community_public('pub813')),
  'F · a role that ended links to nothing: no row from the table, the public part through the reader');
select pg_temp.claims(:pending813);
select pg_temp.assert((select count(*) = 0 from app.centers where id = :a813) and not app.linked_to_center(:a813),
  'F · nor does a role still waiting for its second approver');
select pg_temp.claims(:staff813);
select pg_temp.assert((select count(*) = 1 and bool_and(id = :b813) from app.centers where id in (:a813, :b813)),
  'F · staff of one community read that one, not another''s');
reset role;
select pg_temp.no_claims();

-- ══ G. A community still being set up is hidden from guests and strangers ═══════
set role anon;
select pg_temp.assert_raises(format('select app.category_profile(%L::uuid)', :b813), 'not found', 'G · its category profile is "not found" for a guest');
select pg_temp.assert(not app.can_use_feature(:b813, 'timings') and app.can_use_feature(:a813, 'timings'),
  'G · its public areas are closed to a guest, an active community''s are open');
reset role;
set role authenticated;
select pg_temp.claims(:outsider813);
select pg_temp.assert_raises(format('select app.feature_access_for_me(%L::uuid)', :b813), 'not found', 'G · and the access areas, for a signed-in stranger');
select pg_temp.assert_raises(format('select app.member_experience(%L::uuid)', :b813), 'not found', 'G · the member experience');
select pg_temp.assert_raises(format('select app.category_profile(%L::uuid)', :b813), 'not found', 'G · the category profile');
select pg_temp.assert_raises(format('select app.resolve_template(%L::uuid)', :b813), 'not found', 'G · the member app template');
select pg_temp.assert(not app.can_use_feature(:b813, 'timings') and app.can_use_feature(:a813, 'timings'),
  'G · the public areas (can_use_feature, inside the content policies)');
select pg_temp.assert((select count(*) = 0 from app.community_public_by_id(:b813)) and (select count(*) = 1 from app.community_public_by_id(:a813)),
  'G · community_public_by_id');
select pg_temp.claims(:member813);
select pg_temp.assert_raises(format('select app.category_profile(%L::uuid)', :b813), 'not found',
  'G · a member of another community is a stranger to this one');
select pg_temp.claims(:staff813);
select pg_temp.assert((select app.category_profile(:b813) ? 'category') and (select app.member_experience(:b813) is not null)
                      and app.can_use_feature(:b813, 'timings'),
  'G · its own staff read all of it');
select pg_temp.claims(:owner813);
select pg_temp.assert((select app.category_profile(:b813) ? 'category'), 'G · and so does its owner');
select pg_temp.claims(:admin813);
select pg_temp.assert((select app.category_profile(:b813) ? 'category') and (select count(*) = 1 from app.community_public('onb813-sandbox')),
  'G · and a platform admin');
reset role;
select pg_temp.no_claims();

-- ══ H. What keeps working for the people who work in a community ══════════════
set role authenticated;
select pg_temp.claims(:manager813);
with u as (update app.centers set rules = rules || '{"x813": 1}'::jsonb where id = :a813 returning id)
select pg_temp.assert((select count(*) = 1 from u), 'H · a settings manager still saves the rules of their own community');
with u as (update app.centers set rules = rules || '{"x813": 1}'::jsonb where id = :b813 returning id)
select pg_temp.assert((select count(*) = 0 from u), 'H · and cannot see, or change, another community''s row');
select pg_temp.claims(:admin813);
with i as (insert into app.centers (id, slug, name, status) values (:new813, 'new813', 'New community 813', 'onboarding') returning id)
select pg_temp.assert((select count(*) = 1 from i), 'H · a platform admin creates a community and gets it back (the onboarding wizard)');
select pg_temp.assert((select count(*) = 1 from app.centers where slug = 'new813'), 'H · and reads it');
select pg_temp.claims(:outsider813);
select pg_temp.assert((select count(*) = 0 from app.centers where slug = 'new813'), 'H · which a stranger does not');
-- The two triggers that read the community's time zone as the caller (0004): an event lead of one event (linked only by that scoped
-- role) adds a "during the event" action and moves the event; the dates follow the community's time zone (Auckland: a day ahead of UTC
-- at noon UTC), never UTC and never empty.
select pg_temp.claims(:scoped813);
with ins as (insert into app.actions (center_id, event_id, phase, name) values (:a813, :ev813, 'during', 'Set up the hall 813') returning due_on)
select pg_temp.assert((select count(*) = 1 and bool_and(due_on = date '2030-03-11') from ins),
  'H · a "during" action takes the event''s date in the community''s time zone, read by an event lead');
update app.events set starts_at = timestamptz '2030-03-20 12:00:00+00' where id = :ev813;
select pg_temp.assert((select count(*) = 1 and bool_and(due_on = date '2030-03-21') from app.actions where event_id = :ev813 and phase = 'during'),
  'H · and follows when the event moves');
reset role;
select pg_temp.no_claims();

-- ══ I. Every public-read function still answers a guest ══════════════════════
set role anon;
select pg_temp.assert((select count(*) = 1 from app.community_public('pub813')) and (select count(*) = 1 from app.community_public_by_id(:a813))
                      and exists (select 1 from app.communities_public_list() where slug = 'pub813')
                      and not exists (select 1 from app.communities_public_list() where slug = 'onb813-sandbox'),
  'I · community_public, community_public_by_id and the picker (active communities only)');
select pg_temp.assert((select count(*) = 1 from app.find_community('pub813')) and (select count(*) = 0 from app.find_community('onb813-sandbox')),
  'I · find_community lists live communities only');
select pg_temp.assert((select count(*) = 1 and bool_and(name = 'Public 813') from app.community_by_join_code(:'code813')),
  'I · community_by_join_code opens an active community');
select pg_temp.assert(app.center_slug_for_domain('pub813.example.test') = 'pub813', 'I · center_slug_for_domain (a community''s own address)');
select pg_temp.assert(app.tls_host_allowed('pub813.weaver813.test', 'weaver813.test') = 'center_subdomain', 'I · tls_host_allowed (the HTTPS check of a community''s address)');
select pg_temp.assert((select app.category_profile(:a813) ? 'category') and (select app.member_experience(:a813) is not null)
                      and (select app.feature_access_for_me(:a813) ? 'features') and (select app.category_profile(:a813) ? 'template'),
  'I · the profile, the member experience, the access areas and the template of an active community (the sign-in screen, the public page, the app)');
select pg_temp.assert(app.module_enabled(:a813, 'reports') is not null and (select count(*) = 1 from app.org_leaders where center_id = :a813),
  'I · the module switch and the public leaders (the public community page)');
select pg_temp.assert(exists (select 1 from app.list_experiences()), 'I · the list of kinds of organization');
reset role;

-- ══ J. A demo person reads only the demo community ═══════════════════════════
select pg_temp.claims(:admin813, true);
select (app.create_demo_community('faith'))->>'center_id' as fc813 \gset
select slug::text as fslug813 from app.centers where id = :'fc813' \gset
select pg_temp.assert((select status = 'onboarding' and environment = 'sandbox' and app.is_demo_center(id) from app.centers where id = :'fc813'),
  'J · the demo community is a sandbox flagged as a demo, still being set up (so it is hidden from guests and strangers by design)');
select pg_temp.claims(:admin813, false);
select app.demo_signin_setup('Set up the demo sign-ins for test 813')::text as setup813 \gset
select app.set_demo_signin(true, 'Open the demo for test 813')::text as switch813 \gset
select a.user_id as u_dadmin813 from app.demo_auth_users a join app.demo_personas d on d.email = a.email
 where d.center_id = :'fc813' and d.role_key = 'center_admin' \gset
select a.user_id as u_dmember813 from app.demo_auth_users a join app.demo_personas d on d.email = a.email
 where d.center_id = :'fc813' and d.role_key = 'community_member' \gset
select pg_temp.assert(app.demo_signin_enabled()
                      and exists (select 1 from app.center_users cu where cu.center_id = :'fc813' and cu.user_id = :'u_dadmin813')
                      and exists (select 1 from app.center_users cu where cu.center_id = :'fc813' and cu.user_id = :'u_dmember813'),
  'J · demo sign-in is on and linked the demo people to their demo community (app.demo_link_personas)');
select pg_temp.no_claims();
set role authenticated;
select pg_temp.claims(:'u_dadmin813'::uuid);
select pg_temp.assert((select count(*) = 1 and bool_and(id = :'fc813'::uuid) from app.centers),
  'J · the demo administrator reads exactly one community from the table: the demo');
select pg_temp.assert((select count(*) = 0 from app.centers where id in (:jsh, :a813, :b813)),
  'J · not JSH, and no other community');
select pg_temp.assert((select rules ? 'security' and branding is not null from app.centers where id = :'fc813'::uuid)
                      and (select app.category_profile(:'fc813'::uuid) ? 'category'),
  'J · the demo community itself opens in full (the portal session)');
select pg_temp.assert((select count(*) = 1 and bool_and(not linked) from app.community_public('jsh'))
                      and not exists (select 1 from app.community_public('jsh') p, jsonb_object_keys(p.rules) k
                                       where k not in ('identifiers', 'home', 'points', 'store'))
                      and not exists (select 1 from app.community_public('jsh') p where p.feature_flags <> '{}'::jsonb),
  'J · JSH through the reader: its public part only, not linked');
select pg_temp.assert((select count(*) = 1 and bool_and(id = :'fc813'::uuid) from app.my_centers()),
  'J · the switcher lists the demo only');
select pg_temp.claims(:'u_dmember813'::uuid);
select pg_temp.assert((select count(*) = 1 and bool_and(id = :'fc813'::uuid) from app.centers),
  'J · so does a demo member');
reset role;
select pg_temp.no_claims();
set role anon;
select pg_temp.assert((select count(*) = 0 from app.community_public(:'fslug813')) and (select count(*) = 0 from app.centers where id = :'fc813'::uuid),
  'J · a guest cannot find the demo community');
select pg_temp.assert((app.demo_choices() -> 'enabled') = 'true'::jsonb and jsonb_array_length(app.demo_choices() -> 'communities') >= 1,
  'J · but the "Try the demo" list still answers a guest');
reset role;
select pg_temp.no_claims();

-- The privileges as granted.
select pg_temp.assert(not has_column_privilege('anon', 'app.centers', 'rules', 'select')
                      and not has_column_privilege('anon', 'app.centers', 'branding', 'select')
                      and not has_column_privilege('anon', 'app.centers', 'feature_flags', 'select')
                      and not has_column_privilege('anon', 'app.centers', 'sandbox_for', 'select')
                      and has_column_privilege('anon', 'app.centers', 'slug', 'select')
                      and has_column_privilege('authenticated', 'app.centers', 'rules', 'select'),
  'privileges: anon has the plain columns only; signed-in people keep the columns (rows are narrowed instead)');
select pg_temp.assert(not exists (select 1 from pg_policies where schemaname = 'app' and tablename = 'centers' and policyname = 'centers_public_read'),
  'privileges: the old read-everything policy is gone');

rollback;
