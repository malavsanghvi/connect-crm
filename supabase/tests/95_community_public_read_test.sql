-- 0614: the public part of a community through app.community_public / community_public_by_id / communities_public_list
-- (docs/COMMUNITY_PUBLIC_DATA.md). A caller who is not linked to a community gets only the allowlisted keys of `rules`
-- and `branding` and no feature flags; a member, a staff member, the owner and a platform admin get the full row.
-- (Written for 0614, where the readers showed the same communities as the table; 0615 then hid onboarding communities
-- from people who are not linked, and the three assertions about them say so. Test 96 covers 0615.)
--   A. A guest   B. A signed-in person of another community   C. A member, staff, the owner, an expired grant, a platform
--   admin   D. member_experience hands a guest the allowlisted branding only   E. The picker helper   F. Who may call what
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
create or replace function pg_temp.keys(j jsonb) returns text language sql as $$
  select coalesce(string_agg(k, ',' order by k), '') from jsonb_object_keys(j) k
$$;

\set a95 '''95000000-0000-4000-8000-0000000000a1'''
\set b95 '''95000000-0000-4000-8000-0000000000b1'''
\set s95 '''95000000-0000-4000-8000-0000000000c1'''
\set member95 '''95000000-0000-4000-8000-000000000001'''
\set staff95 '''95000000-0000-4000-8000-000000000002'''
\set owner95 '''95000000-0000-4000-8000-000000000003'''
\set outsider95 '''95000000-0000-4000-8000-000000000004'''
\set admin95 '''95000000-0000-4000-8000-000000000005'''
\set expired95 '''95000000-0000-4000-8000-000000000006'''

select pg_temp.no_claims();
insert into auth.users (id, email) values
  (:member95, 'member95@pub.test'), (:staff95, 'staff95@onb.test'), (:owner95, 'owner95@onb.test'),
  (:outsider95, 'outsider95@else.test'), (:admin95, 'admin95@platform.test'), (:expired95, 'expired95@pub.test');
insert into app.accounts (user_id, is_platform_admin) values (:admin95, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;

-- An active community with private settings next to the public ones, a sandbox still onboarding, a suspended one.
insert into app.centers (id, slug, name, short_name, state_region, status, environment, rules, branding, feature_flags) values
  (:a95, 'pub95', 'Public 95', 'P95', 'TX', 'active', 'production',
   jsonb_build_object(
     'security', jsonb_build_object('require_2fa_for_staff', true, 'admin_idle_minutes', 30),
     'payments', jsonb_build_object('offline_only', false, 'zelle', jsonb_build_object('bank_account_id', '95000000-0000-4000-8000-0000000000ff')),
     'bank', jsonb_build_object('institution', 'Chase'),
     'identifiers', jsonb_build_object('org_member_label', 'Member no.', 'org_household_label', 'Family no.',
                                       'legacy_systems', jsonb_build_array(jsonb_build_object('system', 'neon', 'label', 'Neon'))),
     'home', jsonb_build_object('shortcuts', jsonb_build_array('give', 'events'), 'layout', 'grid'),
     'points', jsonb_build_object('anumodana_points', 7, 'support_points', 2, 'day_complete_bonus', 30,
                                  'gyan_practice_daily_cap', 12, 'streak', 4),
     'store', jsonb_build_object('gift_pack_cents', 250, 'cutoff_hours', 48),
     'boli', jsonb_build_object('step_cents', 500),
     'onboarding', jsonb_build_object('production_slug', 'pub95', 'wizard_step', 9)),
   jsonb_build_object('colors', jsonb_build_object('primary', '#112233', 'accent', '#445566', 'muted', '#999999'),
                      'logo_url', 'https://example.org/logo95.png', 'phone', '+1 512 555 0195',
                      'links', jsonb_build_array(jsonb_build_object('label', 'Website', 'url', 'https://example.org')),
                      'internal_note', 'staff only 95'),
   jsonb_build_object('store', true, 'bolis', false)),
  (:b95, 'onb95-sandbox', 'Onboarding 95', 'O95', 'CA', 'onboarding', 'sandbox',
   jsonb_build_object('security', jsonb_build_object('require_2fa_for_staff', true), 'store', jsonb_build_object('gift_pack_cents', 100)),
   jsonb_build_object('primary', '#000000', 'internal_note', 'staff only onb95'),
   jsonb_build_object('store', true)),
  (:s95, 'sus95', 'Suspended 95', null, null, 'suspended', 'production', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb);

-- member95 is a member of pub95; staff95 has a staff role at the sandbox and owner95 owns it; expired95's role at
-- pub95 ended yesterday; outsider95 belongs to no community here.
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  ('95000000-0000-4000-8000-0000000000d1', :a95, 'Mira', 'Member95', date '1980-01-01');
insert into app.center_users (center_id, user_id, person_id) values (:a95, :member95, '95000000-0000-4000-8000-0000000000d1');
insert into app.center_owners (center_id, user_id) values (:b95, :owner95) on conflict (center_id) do update set user_id = excluded.user_id;
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values (:b95, :staff95, 'event_lead', 'center', 'test 95');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, starts_at, ends_at, reason) values
  (:a95, :expired95, 'event_lead', 'center', now() - interval '30 days', now() - interval '1 day', 'test 95');

-- ══ A. A guest ═══════════════════════════════════════════════════════════════
set role anon;
select pg_temp.assert((select count(*) = 1 and bool_and(not linked) from app.community_public('pub95')),
  'A · a guest finds the active community by its web name, not linked');
select pg_temp.assert((select pg_temp.keys(rules) = 'home,identifiers,points,store'
                              and pg_temp.keys(rules -> 'identifiers') = 'org_household_label,org_member_label'
                              and rules -> 'home' = '{"shortcuts": ["give", "events"]}'::jsonb
                              and rules -> 'points' = '{"anumodana_points": 7, "support_points": 2, "day_complete_bonus": 30, "gyan_practice_daily_cap": 12}'::jsonb
                              and rules -> 'store' = '{"gift_pack_cents": 250}'::jsonb
                         from app.community_public('pub95')),
  'A · rules: only the allowlisted keys (identifier labels, home shortcuts, the four point values, the gift-pack price)');
select pg_temp.assert((select not (rules ? 'security') and not (rules ? 'payments') and not (rules ? 'bank')
                              and not (rules ? 'onboarding') and not (rules ? 'boli')
                              and not ((rules -> 'identifiers') ? 'legacy_systems') and not ((rules -> 'points') ? 'streak')
                         from app.community_public('pub95')),
  'A · rules: no security settings, payments (Zelle account), bank, onboarding, boli, legacy systems or unlisted point keys');
select pg_temp.assert((select pg_temp.keys(branding) = 'colors,links,logo_url,phone'
                              and branding -> 'colors' = '{"primary": "#112233", "accent": "#445566"}'::jsonb
                              and branding #>> '{links,0,url}' = 'https://example.org'
                              and feature_flags = '{}'::jsonb
                         from app.community_public('pub95')),
  'A · branding: the brand kit and public contact only (no internal note, no unlisted colour); no feature flags');
select pg_temp.assert((select id = :a95 and slug = 'pub95' and name = 'Public 95' and short_name = 'P95' and state_region = 'TX'
                              and environment = 'production' and status = 'active' and category_key = 'jain_center'
                              and time_zone is not null and currency = 'USD' and tradition is not null
                         from app.community_public('pub95')),
  'A · the plain columns the apps use are there');
select pg_temp.assert((select count(*) = 1 from app.community_public('  PUB95 ')), 'A · the web name is matched trimmed and in any case');
select pg_temp.assert((select rules = (select rules from app.community_public('pub95')) and not linked
                         from app.community_public_by_id(:a95)),
  'A · by id: the same public row');
select pg_temp.assert((select count(*) = 0 from app.community_public('onb95-sandbox')),
  'A · a sandbox still onboarding is not shown to a guest (0615; test 96 has the rest)');
select pg_temp.assert((select count(*) = 0 from app.community_public('sus95'))
                      and (select count(*) = 0 from app.community_public_by_id(:s95))
                      and (select count(*) = 0 from app.community_public('no-such-95'))
                      and (select count(*) = 0 from app.community_public(null))
                      and (select count(*) = 0 from app.community_public('  '))
                      and (select count(*) = 0 from app.community_public_by_id(null)),
  'A · a suspended community, an unknown name and an empty question find nothing');
select pg_temp.assert((select count(*) = 1 from app.communities_public_list() where slug = 'pub95' and name = 'Public 95'
                                                                               and state_region = 'TX' and environment = 'production')
                      and not exists (select 1 from app.communities_public_list() where slug in ('onb95-sandbox', 'sus95')),
  'A · the picker lists the active community, never the onboarding or suspended one');
select pg_temp.assert(not app.linked_to_center(:a95), 'A · a guest is linked to nothing');
reset role;

-- ══ B. A signed-in person of no community here ═══════════════════════════════
set role authenticated;
select pg_temp.claims(:outsider95);
select pg_temp.assert((select pg_temp.keys(rules) = 'home,identifiers,points,store' and not linked and feature_flags = '{}'::jsonb
                              and not (branding ? 'internal_note')
                         from app.community_public('pub95')),
  'B · a signed-in person who is not linked gets the same public row as a guest');
select pg_temp.assert(not app.linked_to_center(:a95) and not app.linked_to_center(:b95), 'B · and is linked to neither');
reset role;

-- ══ C. Linked callers get the full row ═══════════════════════════════════════
set role authenticated;
select pg_temp.claims(:member95);
select pg_temp.assert((select linked and rules = (select c.rules from app.centers c where c.id = :a95)
                              and branding ? 'internal_note' and feature_flags = '{"store": true, "bolis": false}'::jsonb
                         from app.community_public('pub95')),
  'C · a member gets the full rules, branding and feature flags of their own community');
select pg_temp.assert((select count(*) = 0 from app.community_public('onb95-sandbox')),
  'C · but not another community still onboarding (0615)');
select pg_temp.claims(:staff95);
select pg_temp.assert((select linked and rules ? 'security' and branding ? 'internal_note' from app.community_public_by_id(:b95)),
  'C · a staff role (any scope) links: the full row of the sandbox');
select pg_temp.claims(:owner95);
select pg_temp.assert((select linked and rules ? 'security' from app.community_public('onb95-sandbox')),
  'C · the owner gets the full row');
select pg_temp.claims(:expired95);
select pg_temp.assert((select not linked and not (rules ? 'security') from app.community_public('pub95')),
  'C · a role that has ended does not link');
select pg_temp.claims(:admin95);
select pg_temp.assert((select linked and rules ? 'security' from app.community_public('pub95'))
                      and (select linked and rules ? 'security' from app.community_public('onb95-sandbox'))
                      and (select count(*) = 1 from app.community_public('sus95')),
  'C · a platform admin gets every full row, a suspended community included (as the table shows them)');
reset role;
select pg_temp.no_claims();
-- A role still waiting for its second approval does not link either.
update app.role_grants set status = 'pending' where center_id = :b95 and user_id = :staff95;
set role authenticated;
select pg_temp.claims(:staff95);
select pg_temp.assert(not app.linked_to_center(:b95), 'C · a pending role does not link');
reset role;
select pg_temp.no_claims();

-- ══ D. member_experience ═════════════════════════════════════════════════════
set role anon;
select pg_temp.assert((select not ((x #> '{setup,branding}') ? 'internal_note')
                              and x #> '{setup,branding,colors}' = '{"primary": "#112233", "accent": "#445566"}'::jsonb
                              and x #>> '{setup,branding,logo_url}' = 'https://example.org/logo95.png'
                              and x #> '{setup,home_shortcuts}' = '["give", "events"]'::jsonb
                              and x #>> '{setup,identifiers,org_member_label}' = 'Member no.'
                         from (select app.member_experience(:a95) as x) e),
  'D · a guest''s member_experience carries the allowlisted branding only (shortcuts and labels as before)');
reset role;
set role authenticated;
select pg_temp.claims(:member95);
select pg_temp.assert((select (x #> '{setup,branding}') = (select c.branding from app.centers c where c.id = :a95)
                         from (select app.member_experience(:a95) as x) e),
  'D · a member''s member_experience carries the full branding, as before');
reset role;
select pg_temp.no_claims();

-- ══ E. The picker helper ═════════════════════════════════════════════════════
select pg_temp.assert(app.community_pick('"text"'::jsonb, array['a']) = '{}'::jsonb
                      and app.community_pick(null, array['a']) = '{}'::jsonb
                      and app.community_pick('{"a": 1}'::jsonb, null) = '{}'::jsonb,
  'E · anything that is not an object, or no paths, gives {}');
select pg_temp.assert(app.community_pick('{"a": {"b": {"c": 1, "d": 2}}, "e": 3, "f": "x"}'::jsonb, array['a.b.c', 'e', 'f.g', 'z'])
                        = '{"a": {"b": {"c": 1}}, "e": 3}'::jsonb,
  'E · nested paths keep only the named leaf; a path through a non-object or a missing key is skipped');
select pg_temp.assert(app.community_pick('{"a": {"b": 1, "c": 2}}'::jsonb, array['a.b', 'a.c']) = '{"a": {"b": 1, "c": 2}}'::jsonb,
  'E · two paths under one parent share it');

-- ══ F. Who may call what ═════════════════════════════════════════════════════
select pg_temp.assert(has_function_privilege('anon', 'app.community_public(text)', 'execute')
                      and has_function_privilege('anon', 'app.community_public_by_id(uuid)', 'execute')
                      and has_function_privilege('anon', 'app.communities_public_list()', 'execute')
                      and has_function_privilege('authenticated', 'app.community_public(text)', 'execute'),
  'F · guests and signed-in people can call the three readers');
select pg_temp.assert(not has_function_privilege('anon', 'app.community_public_lookup(uuid, text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.community_public_lookup(uuid, text)', 'execute')
                      and not has_function_privilege('anon', 'app.community_pick(jsonb, text[])', 'execute'),
  'F · the inner lookup and the picker are not callable from outside');
select pg_temp.assert((select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=app, public, extensions%')
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname in ('community_public', 'community_public_by_id', 'communities_public_list',
                                                                  'community_public_lookup', 'linked_to_center', 'community_open')),
  'F · the readers are security definer with the pinned search path');

rollback;
