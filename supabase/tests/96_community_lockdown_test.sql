-- 0615: the community table is closed (docs/COMMUNITY_PUBLIC_DATA.md).
--   A. A guest reads only the plain columns of active communities from the table (what installed apps' finders ask still
--      works; the settings are refused), and the public part through app.community_public.
--   B. A signed-in person reads from the table only the communities they are linked to; the rest through the readers.
--   C. Staff, the owner and a platform admin of a community still being set up; a member's own full row.
--   D. The things that asked the table as the caller: public leaders, the access areas (feature_access_for_me,
--      member_experience, can_use_feature) for a community still being set up.
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
  select coalesce(string_agg(k, ',' order by k), '') from jsonb_object_keys(j) k
$$;

\set a96 '''96000000-0000-4000-8000-0000000000a1'''
\set b96 '''96000000-0000-4000-8000-0000000000b1'''
\set member96 '''96000000-0000-4000-8000-000000000001'''
\set staff96 '''96000000-0000-4000-8000-000000000002'''
\set owner96 '''96000000-0000-4000-8000-000000000003'''
\set outsider96 '''96000000-0000-4000-8000-000000000004'''
\set admin96 '''96000000-0000-4000-8000-000000000005'''

select pg_temp.no_claims();
insert into auth.users (id, email) values
  (:member96, 'member96@pub.test'), (:staff96, 'staff96@onb.test'), (:owner96, 'owner96@onb.test'),
  (:outsider96, 'outsider96@else.test'), (:admin96, 'admin96@platform.test');
insert into app.accounts (user_id, is_platform_admin) values (:admin96, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, short_name, state_region, status, environment, rules, branding, feature_flags) values
  (:a96, 'pub96', 'Public 96', 'P96', 'TX', 'active', 'production',
   jsonb_build_object('security', jsonb_build_object('require_2fa_for_staff', true), 'store', jsonb_build_object('gift_pack_cents', 300)),
   jsonb_build_object('logo_url', 'https://example.org/logo96.png', 'internal_note', 'staff only 96'),
   jsonb_build_object('store', true)),
  (:b96, 'onb96-sandbox', 'Onboarding 96', 'O96', 'CA', 'onboarding', 'sandbox',
   jsonb_build_object('security', jsonb_build_object('require_2fa_for_staff', true)), '{}'::jsonb, '{}'::jsonb);
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  ('96000000-0000-4000-8000-0000000000d1', :a96, 'Mira', 'Member96', date '1980-01-01');
insert into app.center_users (center_id, user_id, person_id) values (:a96, :member96, '96000000-0000-4000-8000-0000000000d1');
insert into app.center_owners (center_id, user_id) values (:b96, :owner96) on conflict (center_id) do update set user_id = excluded.user_id;
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values (:b96, :staff96, 'event_lead', 'center', 'test 96');
insert into app.org_leaders (center_id, full_name, title, show_publicly) values
  (:a96, 'Asha Leader96', 'President', true), (:b96, 'Bina Leader96', 'President', true);

-- ══ A. A guest ═══════════════════════════════════════════════════════════════
set role anon;
-- The finder of an installed app (connect-mobile before 1.13.1): these columns, active communities.
select pg_temp.assert((select count(*) = 1 from app.centers where status = 'active' and slug = 'pub96'
                                                              and name = 'Public 96' and short_name = 'P96' and state_region = 'TX'
                                                              and environment = 'production'),
  'A · the old finder''s columns still read for an active community');
select pg_temp.assert((select count(*) = 1 from (select id, tradition, time_zone, country, currency, category_key from app.centers where id = :a96) x),
  'A · and the other plain columns');
select pg_temp.assert((select count(*) = 0 from app.centers where id = :b96),
  'A · a community still being set up is not in the table for a guest');
select pg_temp.assert_raises($$select rules from app.centers where slug = 'pub96'$$, 'permission denied',
  'A · rules are refused to a guest');
select pg_temp.assert_raises($$select branding from app.centers where slug = 'pub96'$$, 'permission denied',
  'A · branding is refused to a guest');
select pg_temp.assert_raises($$select feature_flags from app.centers where slug = 'pub96'$$, 'permission denied',
  'A · feature flags are refused to a guest');
select pg_temp.assert_raises($$select * from app.centers where slug = 'pub96'$$, 'permission denied',
  'A · so is the whole row (what an installed app''s guest community read asks)');
select pg_temp.assert((select count(*) = 1 and bool_and(pg_temp.keys(rules) = 'store') and bool_and(not (branding ? 'internal_note'))
                         from app.community_public('pub96')),
  'A · the public part comes through app.community_public');
select pg_temp.assert((select count(*) = 0 from app.community_public('onb96-sandbox'))
                      and (select count(*) = 0 from app.community_public_by_id(:b96)),
  'A · and a community still being set up is not found there either');
reset role;

-- ══ B. A signed-in person of no community here ═══════════════════════════════
set role authenticated;
select pg_temp.claims(:outsider96);
select pg_temp.assert((select count(*) = 0 from app.centers where id in (:a96, :b96)),
  'B · a signed-in outsider reads neither community from the table (not even the active one''s settings)');
select pg_temp.assert((select count(*) = 1 and bool_and(not linked) and bool_and(not (rules ? 'security')) from app.community_public('pub96'))
                      and (select count(*) = 0 from app.community_public('onb96-sandbox')),
  'B · the active one''s public part comes through the reader; the onboarding one is not shown');
select pg_temp.assert((select count(*) = 1 from app.communities_public_list() where slug = 'pub96'),
  'B · the picker still lists the active community');

-- ══ C. Linked people ═════════════════════════════════════════════════════════
select pg_temp.claims(:member96);
select pg_temp.assert((select rules ? 'security' and branding ? 'internal_note' and feature_flags = '{"store": true}'::jsonb
                         from app.centers where id = :a96),
  'C · a member still reads their own community''s full row from the table (portal and app)');
select pg_temp.assert((select count(*) = 0 from app.centers where id = :b96), 'C · but not another community');
select pg_temp.claims(:staff96);
select pg_temp.assert((select count(*) = 1 from app.centers where id = :b96 and rules ? 'security'),
  'C · staff of the community still being set up read its row');
select pg_temp.assert((select count(*) = 1 and bool_and(linked) from app.community_public('onb96-sandbox')),
  'C · and find it through the reader, linked');
select pg_temp.claims(:owner96);
select pg_temp.assert((select count(*) = 1 from app.centers where id = :b96), 'C · so does its owner');
select pg_temp.claims(:admin96);
select pg_temp.assert((select count(*) = 2 from app.centers where id in (:a96, :b96)), 'C · a platform admin reads every row');
reset role;
select pg_temp.no_claims();

-- ══ D. What asked the table as the caller ════════════════════════════════════
set role anon;
select pg_temp.assert((select count(*) = 1 from app.org_leaders where center_id = :a96 and full_name = 'Asha Leader96')
                      and (select count(*) = 0 from app.org_leaders where center_id = :b96),
  'D · a guest sees the public leaders of an active community, not of one still being set up');
select pg_temp.assert_raises(format('select app.feature_access_for_me(%L::uuid)', :b96), 'not found',
  'D · the access areas of a community still being set up are "not found" for a guest');
select pg_temp.assert_raises(format('select app.member_experience(%L::uuid)', :b96), 'not found',
  'D · and so is its member experience');
select pg_temp.assert((select app.feature_access_for_me(:a96) ? 'features'), 'D · an active community''s areas still answer a guest');
reset role;
set role authenticated;
select pg_temp.claims(:outsider96);
select pg_temp.assert((select count(*) = 1 from app.org_leaders where center_id = :a96),
  'D · a signed-in outsider still sees the active community''s public leaders (the policy no longer reads the table as the caller)');
select pg_temp.claims(:staff96);
select pg_temp.assert((select count(*) = 1 from app.org_leaders where center_id = :b96)
                      and (select app.feature_access_for_me(:b96) ? 'features'),
  'D · staff of the community still being set up see its leaders and areas');
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
