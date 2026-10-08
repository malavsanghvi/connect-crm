-- 0586: access levels. Each community has an ordered ladder (public, community, then its own membership
-- levels) and chooses the lowest level that may use each area (darshan, puja, listen, ...). A person's level
-- is the highest rung they meet in that community; the live darshan stream's row (its link) is protected by row
-- level security, so guests can watch it by default and a community can close it to signed-in members, Members or
-- Life members. Settings are changed through RPCs that need settings.manage, a reason and a fresh 2FA check.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
-- Runs a statement that must fail with a message containing `expect`.
create or replace function pg_temp.assert_raises(stmt text, expect text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if position(lower(expect) in lower(sqlerrm)) = 0 then raise exception 'FAIL: % (got "%")', label, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
-- Sign in as a user for the rest of the transaction. p_totp_age: seconds since the last authenticator check
-- (null = signed in without 2FA).
create or replace function pg_temp.sign_in(p_user uuid, p_totp_age int default null) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated',
    'aal', case when p_totp_age is null then 'aal1' else 'aal2' end,
    'amr', case when p_totp_age is null
                then jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', floor(extract(epoch from now())) - 60))
                else jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', floor(extract(epoch from now())) - p_totp_age)) end)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
-- The helpers below run one query as a user (null = a guest with the anon key), then come back to the test's
-- own role.
-- "key:rank:signed_in" of what the user is in the community.
create or replace function pg_temp.level_as(p_user uuid, p_center uuid) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', case when p_user is null then jsonb_build_object('role', 'anon')
                                                else jsonb_build_object('sub', p_user, 'role', 'authenticated') end::text, true);
  perform set_config('role', case when p_user is null then 'anon' else 'authenticated' end, true);
  select a.key || ':' || a.rank || ':' || a.signed_in into r from app.my_access(p_center) a;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return r;
end $$;
-- The member app's one call.
create or replace function pg_temp.access_as(p_user uuid, p_center uuid) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', case when p_user is null then jsonb_build_object('role', 'anon')
                                                else jsonb_build_object('sub', p_user, 'role', 'authenticated') end::text, true);
  perform set_config('role', case when p_user is null then 'anon' else 'authenticated' end, true);
  r := app.feature_access_for_me(p_center);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return r;
end $$;
create or replace function pg_temp.can_as(p_user uuid, p_center uuid, p_feature text) returns boolean language plpgsql as $$
declare r boolean;
begin
  perform set_config('request.jwt.claims', case when p_user is null then jsonb_build_object('role', 'anon')
                                                else jsonb_build_object('sub', p_user, 'role', 'authenticated') end::text, true);
  perform set_config('role', case when p_user is null then 'anon' else 'authenticated' end, true);
  r := app.can_use_feature(p_center, p_feature);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return r;
end $$;
-- Which of this test's content items the user can read through row level security (slugs without the acc71- prefix).
create or replace function pg_temp.seen_as(p_user uuid) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', case when p_user is null then jsonb_build_object('role', 'anon')
                                                else jsonb_build_object('sub', p_user, 'role', 'authenticated') end::text, true);
  perform set_config('role', case when p_user is null then 'anon' else 'authenticated' end, true);
  select coalesce(string_agg(replace(c.slug, 'acc71-', ''), ' ' order by c.slug), '') into r
    from app.content_items c where c.slug like 'acc71-%';
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return r;
end $$;

-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- C: a community that has not switched on staff 2FA (like JSH). C2: one that has (the default).
-- C3: a community nobody is linked to.
\set jsh '''00000000-0000-4000-8000-000000000001'''
\set c '''71000000-0000-4000-8000-0000000000c1'''
\set c2 '''71000000-0000-4000-8000-0000000000c2'''
\set c3 '''71000000-0000-4000-8000-0000000000c3'''
\set u_admin '''71000000-0000-4000-8000-000000000001'''
\set u_editor '''71000000-0000-4000-8000-000000000002'''
\set u_treas '''71000000-0000-4000-8000-000000000003'''
\set u_none '''71000000-0000-4000-8000-000000000004'''
\set u_yearly '''71000000-0000-4000-8000-000000000005'''
\set u_life '''71000000-0000-4000-8000-000000000006'''
\set u_child '''71000000-0000-4000-8000-000000000007'''
\set u_lapsed '''71000000-0000-4000-8000-000000000008'''
\set u_ended '''71000000-0000-4000-8000-000000000009'''
\set u_pending '''71000000-0000-4000-8000-00000000000a'''
\set u_susp '''71000000-0000-4000-8000-00000000000b'''
\set u_future '''71000000-0000-4000-8000-00000000000c'''
\set u_multi '''71000000-0000-4000-8000-00000000000d'''
\set u_type '''71000000-0000-4000-8000-00000000000e'''
\set u_two '''71000000-0000-4000-8000-00000000000f'''
\set u_stranger '''71000000-0000-4000-8000-000000000010'''
\set u_admin2 '''71000000-0000-4000-8000-000000000011'''
\set u_padmin '''71000000-0000-4000-8000-000000000012'''
\set u_padmin_l '''71000000-0000-4000-8000-000000000013'''
\set u_today '''71000000-0000-4000-8000-000000000014'''
\set u_left '''71000000-0000-4000-8000-000000000015'''
\set u_rel '''71000000-0000-4000-8000-000000000016'''
\set u_comm '''71000000-0000-4000-8000-000000000017'''

insert into auth.users (id, email)
select u, 'u' || substr(u::text, 33, 4) || '-71@example.com'
  from unnest(array[:u_admin, :u_editor, :u_treas, :u_none, :u_yearly, :u_life, :u_child, :u_lapsed, :u_ended, :u_pending,
                    :u_susp, :u_future, :u_multi, :u_type, :u_two, :u_stranger, :u_admin2, :u_padmin, :u_padmin_l,
                    :u_today, :u_left, :u_rel, :u_comm]::uuid[]) u;
insert into app.accounts (user_id, is_platform_admin) values (:u_padmin, true), (:u_padmin_l, true);
insert into app.centers (id, slug, name, short_name, state_region, status, rules) values
  (:c,  'orbit71',  'Orbit 71 Community', 'O71',  'TX', 'active', '{"security":{"require_2fa_for_staff":false}}'),
  (:c2, 'orbit71b', 'Other 71 Community', 'O71B', 'TX', 'active', '{}'),
  (:c3, 'orbit71c', 'Third 71 Community', 'O71C', 'TX', 'active', '{"security":{"require_2fa_for_staff":false}}');
insert into app.membership_types (center_id, key, tier, name) values
  (:c, 'community', 'community', 'Community membership'), (:c, 'yearly', 'yearly', 'Yearly membership'),
  (:c, 'life', 'life', 'Life membership'), (:c, 'senior_yearly', 'yearly', 'Senior yearly membership');

-- One person per login (the person's id is the login's id); the households carry the memberships.
insert into app.people (id, center_id, first_name, last_name, date_of_birth)
select p::uuid, c::uuid, n, 'Acc71', d
  from (values
    (:u_admin, :c, 'Ada', date '1975-01-01'), (:u_editor, :c, 'Edi', date '1976-01-01'), (:u_treas, :c, 'Tara', date '1977-01-01'),
    (:u_none, :c, 'Nora', date '1978-01-01'), (:u_yearly, :c, 'Yash', date '1979-01-01'), (:u_life, :c, 'Lata', date '1960-01-01'),
    (:u_child, :c, 'Dev', (current_date - interval '14 years')::date), (:u_lapsed, :c, 'Lalit', date '1981-01-01'),
    (:u_ended, :c, 'Esha', date '1982-01-01'), (:u_pending, :c, 'Pia', date '1983-01-01'), (:u_susp, :c, 'Sam', date '1984-01-01'),
    (:u_future, :c, 'Fay', date '1985-01-01'), (:u_multi, :c, 'Mia', date '1986-01-01'), (:u_type, :c, 'Tej', date '1987-01-01'),
    (:u_two, :c, 'Tia', date '1988-01-01'), (:u_admin2, :c2, 'Ana', date '1989-01-01'), (:u_padmin_l, :c, 'Paul', date '1990-01-01'),
    (:u_today, :c, 'Tod', date '1991-01-01'), (:u_left, :c, 'Lee', date '1992-01-01'), (:u_rel, :c, 'Rel', date '1993-01-01'),
    (:u_comm, :c, 'Cam', date '1994-01-01')) v(p, c, n, d);
-- Tia is a person in both communities.
insert into app.people (id, center_id, first_name, last_name, date_of_birth)
values ('71000000-0000-4000-8000-0000000000b2', :c2, 'Tia', 'Acc71', date '1988-01-01');

insert into app.households (id, center_id, display_name) values
  ('71000000-0000-4000-8000-0000000000a1', :c, 'Yearly 71'), ('71000000-0000-4000-8000-0000000000a2', :c, 'Life 71'),
  ('71000000-0000-4000-8000-0000000000a3', :c, 'Lapsed 71'), ('71000000-0000-4000-8000-0000000000a4', :c, 'Ended 71'),
  ('71000000-0000-4000-8000-0000000000a5', :c, 'Pending 71'), ('71000000-0000-4000-8000-0000000000a6', :c, 'Suspended 71'),
  ('71000000-0000-4000-8000-0000000000a7', :c, 'Future 71'), ('71000000-0000-4000-8000-0000000000a8', :c, 'Multi 71'),
  ('71000000-0000-4000-8000-0000000000a9', :c, 'Type 71'), ('71000000-0000-4000-8000-0000000000aa', :c, 'Two 71'),
  ('71000000-0000-4000-8000-0000000000ab', :c, 'Platform admin 71'), ('71000000-0000-4000-8000-0000000000ac', :c, 'Today 71'),
  ('71000000-0000-4000-8000-0000000000ad', :c, 'Community tier 71');
insert into app.household_members (household_id, person_id, center_id, role, is_primary, left_at)
select v.h, v.p::uuid, :c, v.r::app.person_role_in_household, v.prim, v.l::date
  from (values
    ('71000000-0000-4000-8000-0000000000a1'::uuid, :u_yearly, 'primary', true, null),
    ('71000000-0000-4000-8000-0000000000a2'::uuid, :u_life, 'primary', true, null),
    ('71000000-0000-4000-8000-0000000000a2'::uuid, :u_child, 'child', false, null),
    ('71000000-0000-4000-8000-0000000000a2'::uuid, :u_left, 'other', false, (current_date - 5)::text),
    ('71000000-0000-4000-8000-0000000000a3'::uuid, :u_lapsed, 'primary', true, null),
    ('71000000-0000-4000-8000-0000000000a4'::uuid, :u_ended, 'primary', true, null),
    ('71000000-0000-4000-8000-0000000000a5'::uuid, :u_pending, 'primary', true, null),
    ('71000000-0000-4000-8000-0000000000a6'::uuid, :u_susp, 'primary', true, null),
    ('71000000-0000-4000-8000-0000000000a7'::uuid, :u_future, 'primary', true, null),
    ('71000000-0000-4000-8000-0000000000a8'::uuid, :u_multi, 'primary', true, null),
    ('71000000-0000-4000-8000-0000000000a9'::uuid, :u_type, 'primary', true, null),
    ('71000000-0000-4000-8000-0000000000aa'::uuid, :u_two, 'primary', true, null),
    ('71000000-0000-4000-8000-0000000000ab'::uuid, :u_padmin_l, 'primary', true, null),
    ('71000000-0000-4000-8000-0000000000ac'::uuid, :u_today, 'primary', true, null),
    ('71000000-0000-4000-8000-0000000000ad'::uuid, :u_comm, 'primary', true, null)) v(h, p, r, prim, l);
insert into app.center_users (center_id, user_id, person_id) values
  (:c, :u_admin, :u_admin), (:c, :u_editor, :u_editor), (:c, :u_treas, :u_treas), (:c, :u_none, :u_none),
  (:c, :u_yearly, :u_yearly), (:c, :u_life, :u_life), (:c, :u_child, :u_child), (:c, :u_lapsed, :u_lapsed),
  (:c, :u_ended, :u_ended), (:c, :u_pending, :u_pending), (:c, :u_susp, :u_susp), (:c, :u_future, :u_future),
  (:c, :u_multi, :u_multi), (:c, :u_type, :u_type), (:c, :u_two, :u_two), (:c, :u_padmin_l, :u_padmin_l),
  (:c, :u_today, :u_today), (:c, :u_left, :u_left), (:c, :u_rel, :u_rel), (:c, :u_comm, :u_comm),
  (:c2, :u_admin2, :u_admin2), (:c2, :u_two, '71000000-0000-4000-8000-0000000000b2');
insert into app.role_grants (center_id, user_id, role_key) values
  (:c, :u_admin, 'center_admin'), (:c, :u_editor, 'content_editor'), (:c, :u_treas, 'treasurer'),
  (:c, :u_rel, 'religious_coordinator'), (:c2, :u_admin2, 'center_admin');

-- Memberships. Dates are the community's own (America/Chicago): the first and the last day count.
insert into app.memberships (center_id, household_id, membership_type_id, tier, status, starts_on, ends_on)
select :c, v.h::uuid, t.id, t.tier, v.s::app.membership_status, v.a::date, v.z::date
  from (values
    ('71000000-0000-4000-8000-0000000000a1', 'yearly',        'active',    '2020-01-01', null),
    ('71000000-0000-4000-8000-0000000000a2', 'life',          'active',    '2020-01-01', null),
    ('71000000-0000-4000-8000-0000000000a3', 'life',          'lapsed',    '2020-01-01', null),
    ('71000000-0000-4000-8000-0000000000a4', 'yearly',        'active',    '2020-01-01', ((now() at time zone 'America/Chicago')::date - 1)::text),
    ('71000000-0000-4000-8000-0000000000a5', 'life',          'pending',   '2020-01-01', null),
    ('71000000-0000-4000-8000-0000000000a6', 'life',          'suspended', '2020-01-01', null),
    ('71000000-0000-4000-8000-0000000000a7', 'life',          'active',    ((now() at time zone 'America/Chicago')::date + 1)::text, null),
    ('71000000-0000-4000-8000-0000000000a8', 'community',     'active',    '2020-01-01', null),
    ('71000000-0000-4000-8000-0000000000a8', 'life',          'active',    '2021-01-01', null),
    ('71000000-0000-4000-8000-0000000000a9', 'senior_yearly', 'active',    '2020-01-01', null),
    ('71000000-0000-4000-8000-0000000000aa', 'life',          'active',    '2020-01-01', null),
    ('71000000-0000-4000-8000-0000000000ab', 'life',          'active',    '2020-01-01', null),
    ('71000000-0000-4000-8000-0000000000ac', 'life',          'active',    ((now() at time zone 'America/Chicago')::date)::text, ((now() at time zone 'America/Chicago')::date)::text),
    ('71000000-0000-4000-8000-0000000000ad', 'community',     'active',    '2020-01-01', null)) v(h, k, s, a, z)
  join app.membership_types t on t.center_id = :c and t.key = v.k;

-- Content: the live stream (published and draft), a stavan (members only), a guide page and an FAQ (public),
-- a video shared by every community, a Niva source; and one stream and one stavan of the other community.
insert into app.content_items (id, center_id, kind, slug, title, media_url, status, published_at) values
  ('71000000-0000-4000-8000-0000000000e1', :c,  'darshan_stream', 'acc71-darshan',        'Live darshan 71', 'https://example.org/live71', 'published', now()),
  ('71000000-0000-4000-8000-0000000000e2', :c,  'darshan_stream', 'acc71-darshan-draft',  'Next stream 71',  'https://example.org/next71', 'draft', null),
  ('71000000-0000-4000-8000-0000000000e3', :c,  'stavan',         'acc71-stavan',         'A stavan 71',     null, 'published', now()),
  ('71000000-0000-4000-8000-0000000000e4', :c,  'guide_page',     'acc71-guide',          'Guide 71',        null, 'published', now()),
  ('71000000-0000-4000-8000-0000000000e5', :c,  'faq',            'acc71-faq',            'FAQ 71',          null, 'published', now()),
  ('71000000-0000-4000-8000-0000000000e6', null, 'video',         'acc71-video-shared',   'Shared video 71', 'https://example.org/v71', 'published', now()),
  ('71000000-0000-4000-8000-0000000000e7', :c,  'niva_source',    'acc71-niva',           'Niva page 71',    null, 'published', now()),
  ('71000000-0000-4000-8000-0000000000e8', :c2, 'darshan_stream', 'acc71-darshan-c2',     'Other live 71',   'https://example.org/live71b', 'published', now()),
  ('71000000-0000-4000-8000-0000000000e9', :c2, 'stavan',         'acc71-stavan-c2',      'Other stavan 71', null, 'published', now());

-- ── The catalog and the ladders ──────────────────────────────────────────────
select pg_temp.assert((select array_agg(key order by sort) from app.access_features)
                        = array['darshan','puja','timings','guide','listen','look','learn','niva'],
  'the catalog has the eight areas of version 1, in order');
select pg_temp.assert((select array_agg(key order by key) from app.access_features where default_level = 'public') = array['darshan','guide','puja','timings']
                      and (select array_agg(key order by key) from app.access_features where default_level = 'community') = array['learn','listen','look','niva'],
  'darshan and puja are public by default (the owner''s request), as are timings and the guide; the rest keep today''s behaviour');
select pg_temp.assert((select array_agg(key order by key) from app.access_features where floor_level = 'community') = array['learn','listen','look','niva']
                      and (select bool_and(floor_level = 'public') from app.access_features where key in ('darshan','puja','timings','guide')),
  'listen, look, learn and Niva cannot go below community (their files are members-only); the others have no floor');
select pg_temp.assert((select enforced_by from app.access_features where key = 'darshan') = 'database'
                      and (select bool_and(enforced_by = 'app') from app.access_features where key <> 'darshan'),
  'only darshan is enforced by the database; the others are enforced by the app');
select pg_temp.assert((select array_agg(key || ':' || coalesce(module_key, '-') order by sort) from app.access_features)
                        = array['darshan:content','puja:gyan_path','timings:-','guide:-','listen:content','look:content','learn:gyan_path','niva:niva'],
  'each area is tied to the module that owns its content');
select pg_temp.assert(not exists (select 1 from app.access_features f where f.floor_level = 'community' and f.default_level = 'public'),
  'no area starts below its own floor');
select pg_temp.assert((select array_agg(key || ':' || rank || ':' || kind order by rank) from app.access_levels where center_id = :jsh)
                        = array['public:0:public','community:10:community','member:20:membership','life:30:membership'],
  'JSH has the starting ladder: Public, Community member, Member, Life member');
select pg_temp.assert((select tiers from app.access_levels where center_id = :jsh and key = 'member') = '{yearly,life}'
                      and (select tiers from app.access_levels where center_id = :jsh and key = 'life') = '{life}'
                      and (select label from app.access_levels where center_id = :jsh and key = 'life') = 'Life member',
  'Member is met by a yearly or life membership; Life member by a life membership');
select pg_temp.assert(not exists (select 1 from app.centers c where (select count(*) from app.access_levels l where l.center_id = c.id) <> 4),
  'every community has the four starting levels, whether it existed before the migration or was created after it');
select pg_temp.assert((select count(*) from app.center_feature_access where center_id in (:jsh, :c, :c2, :c3)) = 0,
  'nothing is chosen yet: every area follows the catalog default');
select pg_temp.assert(exists (select 1 from app.module_tables where table_name = 'access_features' and module_key is null)
                      and exists (select 1 from app.module_tables where table_name = 'access_levels' and module_key is null)
                      and exists (select 1 from app.module_tables where table_name = 'center_feature_access' and module_key is null),
  'the three tables belong to the core platform');
select pg_temp.assert((select count(*) from pg_trigger t where t.tgrelid in ('app.access_features'::regclass, 'app.access_levels'::regclass, 'app.center_feature_access'::regclass)
                          and t.tgname like 'audit\_%' and t.tgfoid = 'app.audit_row'::regproc) = 3,
  'all three tables are audited');
select pg_temp.assert((select bool_and(relrowsecurity) from pg_class where oid in ('app.access_features'::regclass, 'app.access_levels'::regclass, 'app.center_feature_access'::regclass)),
  'row level security is on for all three');
select pg_temp.assert('access_levels' <> all (app.demo_clear_tables()) and 'center_feature_access' <> all (app.demo_clear_tables())
                      and 'access_features' <> all (app.demo_clear_tables()),
  'a sandbox reset keeps a community''s access settings');

-- The tables themselves refuse what the RPCs would refuse.
select pg_temp.assert_raises($$update app.access_levels set rank = 5 where center_id = '71000000-0000-4000-8000-0000000000c1' and key = 'public'$$,
  'access_levels_shape', 'the Public level cannot be moved');
select pg_temp.assert_raises($$update app.access_levels set tiers = '{life}' where center_id = '71000000-0000-4000-8000-0000000000c1' and key = 'community'$$,
  'access_levels_shape', 'a base level has no membership rule');
select pg_temp.assert_raises($$insert into app.access_levels (center_id, key, label, rank, kind, tiers) values ('71000000-0000-4000-8000-0000000000c1', 'low', 'Low', 15, 'membership', '{life}')$$,
  'access_levels_shape', 'a membership level sits above the community level (rank 20 or more)');
select pg_temp.assert_raises($$insert into app.access_levels (center_id, key, label, rank, kind) values ('71000000-0000-4000-8000-0000000000c1', 'norule', 'No rule', 40, 'membership')$$,
  'access_levels_shape', 'a membership level must say who it is for');
select pg_temp.assert_raises($$insert into app.access_levels (center_id, key, label, rank, kind, tiers) values ('71000000-0000-4000-8000-0000000000c1', 'Bad Key', 'Bad', 40, 'membership', '{life}')$$,
  'access_levels_key_check', 'a key is lower-case letters and underscores');
select pg_temp.assert_raises($$insert into app.access_levels (center_id, key, label, rank, kind, tiers) values ('71000000-0000-4000-8000-0000000000c1', 'long_name', repeat('x', 41), 40, 'membership', '{life}')$$,
  'access_levels_label_check', 'a name is at most 40 characters');
select pg_temp.assert_raises($$insert into app.access_levels (center_id, key, label, rank, kind, tiers) values ('71000000-0000-4000-8000-0000000000c1', 'twin', 'Twin', 20, 'membership', '{life}'); set constraints access_levels_rank_unique immediate$$,
  'access_levels_rank_unique', 'two levels cannot share a rank');
select pg_temp.assert_raises($$insert into app.access_levels (center_id, key, label, rank, kind, tiers) values ('71000000-0000-4000-8000-0000000000c1', 'nulltier', 'Null tier', 40, 'membership', array[null]::app.membership_tier[])$$,
  'access_levels_shape', 'a rule cannot hold a null tier (a level nobody can ever meet)');
select pg_temp.assert_raises($$insert into app.access_levels (center_id, key, label, rank, kind, tiers, membership_type_keys) values ('71000000-0000-4000-8000-0000000000c1', 'nulltype', 'Null type', 40, 'membership', '{life}', array[null]::text[])$$,
  'access_levels_shape', 'nor a null membership type, even next to a real tier');
select pg_temp.assert_raises($$insert into app.access_features (key, label, default_level, floor_level, enforced_by) values ('lowdefault', 'Low default', 'public', 'community', 'app')$$,
  'access_features_default_at_floor', 'an area cannot start below its own floor');
select pg_temp.assert_raises($$insert into app.center_feature_access (center_id, feature_key, level_key) values ('71000000-0000-4000-8000-0000000000c1', 'darshan', 'nope')$$,
  'center_feature_access_level_fk', 'an area can only be given a level the community has');

-- Who may read and write the tables.
begin;
select pg_temp.sign_in(:u_admin);
select pg_temp.assert((select count(*) from app.access_levels where center_id = :c) = 4 and (select count(*) from app.access_levels) = 4,
  'a settings manager reads their own community''s levels, and no other community''s');
select pg_temp.assert_raises($$update app.access_levels set label = 'Hacked' where center_id = '71000000-0000-4000-8000-0000000000c1'$$,
  'permission denied', 'even a settings manager cannot write the levels directly');
select pg_temp.assert_raises($$insert into app.center_feature_access (center_id, feature_key, level_key) values ('71000000-0000-4000-8000-0000000000c1', 'darshan', 'life')$$,
  'permission denied', 'nor the choices');
select pg_temp.assert_raises($$update app.access_features set default_level = 'community' where key = 'darshan'$$,
  'permission denied', 'nor the platform''s catalog');
commit;
begin;
select pg_temp.sign_in(:u_rel);   -- religious coordinator: content.manage, not settings.manage
select pg_temp.assert((select count(*) from app.access_levels where center_id = :c) = 4,
  'someone who manages content can read the levels too (to see who a page is for)');
select pg_temp.assert_raises($$select app.access_settings('71000000-0000-4000-8000-0000000000c1')$$, 'settings.manage',
  'but only settings.manage opens the settings');
commit;
begin;
select pg_temp.sign_in(:u_editor);   -- content.view and content.draft only
select pg_temp.assert((select count(*) from app.access_levels) = 0 and (select count(*) from app.center_feature_access) = 0,
  'content editors, members and the like read neither table');
select pg_temp.assert((select count(*) from app.access_features) = 8, 'but everyone signed in can read the catalog');
commit;
begin;
select set_config('request.jwt.claims', '{"role":"anon"}', true), set_config('role', 'anon', true);
select pg_temp.assert((select count(*) from app.access_features) = 8, 'a guest can read the catalog');
select pg_temp.assert_raises($$select * from app.access_levels$$, 'permission denied', 'a guest cannot read a community''s levels');
select pg_temp.assert_raises($$select * from app.center_feature_access$$, 'permission denied', 'nor its choices');
select pg_temp.assert_raises($$select app.access_settings('71000000-0000-4000-8000-0000000000c1')$$, 'permission denied', 'nor open its settings');
select pg_temp.assert_raises($$select app.set_feature_access('71000000-0000-4000-8000-0000000000c1', 'darshan', 'life', 'x')$$, 'permission denied', 'nor change a choice');
commit;

-- ── Which level is each person at? ───────────────────────────────────────────
select pg_temp.assert(pg_temp.level_as(null, :c) = 'public:0:false', 'a guest is public, and not signed in');
select pg_temp.assert(pg_temp.level_as(:u_stranger, :c) = 'public:0:true', 'someone signed in but not linked to this community is public');
select pg_temp.assert(pg_temp.level_as(:u_none, :c) = 'community:10:true', 'a linked person with no membership is a community member');
select pg_temp.assert(pg_temp.level_as(:u_comm, :c) = 'community:10:true', 'a household with only a community-tier membership is a community member (Member needs yearly or life)');
select pg_temp.assert(pg_temp.level_as(:u_yearly, :c) = 'member:20:true', 'a yearly membership makes a Member');
select pg_temp.assert(pg_temp.level_as(:u_life, :c) = 'life:30:true', 'a life membership makes a Life member');
select pg_temp.assert(pg_temp.level_as(:u_child, :c) = 'life:30:true', 'a child login in a life household shares the household''s membership');
select pg_temp.assert(pg_temp.level_as(:u_left, :c) = 'community:10:true', 'someone who left the household no longer shares its membership');
select pg_temp.assert(pg_temp.level_as(:u_lapsed, :c) = 'community:10:true', 'a lapsed membership does not count');
select pg_temp.assert(pg_temp.level_as(:u_pending, :c) = 'community:10:true', 'nor a pending one');
select pg_temp.assert(pg_temp.level_as(:u_susp, :c) = 'community:10:true', 'nor a suspended one');
select pg_temp.assert(pg_temp.level_as(:u_ended, :c) = 'community:10:true', 'an active membership that ended yesterday does not count');
select pg_temp.assert(pg_temp.level_as(:u_future, :c) = 'community:10:true', 'one that starts tomorrow does not count yet');
select pg_temp.assert(pg_temp.level_as(:u_today, :c) = 'life:30:true', 'one that starts and ends today does count (the community''s own date)');
select pg_temp.assert(pg_temp.level_as(:u_multi, :c) = 'life:30:true', 'with several memberships the highest level wins');
select pg_temp.assert(pg_temp.level_as(:u_two, :c) = 'life:30:true' and pg_temp.level_as(:u_two, :c2) = 'community:10:true'
                      and pg_temp.level_as(:u_two, :c3) = 'public:0:true',
  'a person in two communities has a level in each, independently (and is public in a third)');
select pg_temp.assert(pg_temp.level_as(:u_padmin, :c) = 'public:0:true', 'a platform admin who is not linked to the community is public (their real level)');
select pg_temp.assert(pg_temp.level_as(:u_padmin_l, :c) = 'life:30:true', 'a platform admin who is linked is judged by their own household');
select pg_temp.assert(pg_temp.level_as(:u_admin, :c) = 'community:10:true', 'staff are judged like anyone else: by membership, not by role');
select pg_temp.assert(pg_temp.level_as(:u_life, :c3) = 'public:0:true', 'a life member is public in a community they are not linked to');
select pg_temp.assert((select count(*) from app.my_access(null)) = 1 and (select key from app.my_access(null)) = 'public',
  'asking about no community still answers (public)');

-- ── What may they use, by default? ───────────────────────────────────────────
select pg_temp.assert(pg_temp.can_as(null, :c, 'darshan') and pg_temp.can_as(null, :c, 'puja') and pg_temp.can_as(null, :c, 'timings')
                      and pg_temp.can_as(null, :c, 'guide'),
  'a guest may use darshan, puja, the timings and the guide by default');
select pg_temp.assert(not pg_temp.can_as(null, :c, 'listen') and not pg_temp.can_as(null, :c, 'look')
                      and not pg_temp.can_as(null, :c, 'learn') and not pg_temp.can_as(null, :c, 'niva'),
  'but not listen, look, learn or Niva');
select pg_temp.assert(pg_temp.can_as(:u_stranger, :c, 'darshan') and not pg_temp.can_as(:u_stranger, :c, 'listen'),
  'signed in without being linked is still public');
select pg_temp.assert((select bool_and(pg_temp.can_as(:u_none, :c, f.key)) from app.access_features f),
  'a community member may use every area by default');
select pg_temp.assert(not pg_temp.can_as(:u_none, :c, 'nope') and not pg_temp.can_as(:u_none, null, 'darshan')
                      and not pg_temp.can_as(:u_none, '71000000-0000-4000-8000-0000000000ff', 'darshan'),
  'an unknown area, no community or an unknown community is never allowed');
select pg_temp.assert(pg_temp.access_as(null, :c) =
  jsonb_build_object(
    'level', jsonb_build_object('key', 'public', 'label', 'Public', 'rank', 0),
    'signed_in', false,
    'features', jsonb_build_object(
      'darshan', jsonb_build_object('allowed', true,  'reason', null,      'min_level', jsonb_build_object('key', 'public',    'label', 'Public',           'rank', 0)),
      'puja',    jsonb_build_object('allowed', true,  'reason', null,      'min_level', jsonb_build_object('key', 'public',    'label', 'Public',           'rank', 0)),
      'timings', jsonb_build_object('allowed', true,  'reason', null,      'min_level', jsonb_build_object('key', 'public',    'label', 'Public',           'rank', 0)),
      'guide',   jsonb_build_object('allowed', true,  'reason', null,      'min_level', jsonb_build_object('key', 'public',    'label', 'Public',           'rank', 0)),
      'listen',  jsonb_build_object('allowed', false, 'reason', 'sign_in', 'min_level', jsonb_build_object('key', 'community', 'label', 'Community member', 'rank', 10)),
      'look',    jsonb_build_object('allowed', false, 'reason', 'sign_in', 'min_level', jsonb_build_object('key', 'community', 'label', 'Community member', 'rank', 10)),
      'learn',   jsonb_build_object('allowed', false, 'reason', 'sign_in', 'min_level', jsonb_build_object('key', 'community', 'label', 'Community member', 'rank', 10)),
      'niva',    jsonb_build_object('allowed', false, 'reason', 'sign_in', 'min_level', jsonb_build_object('key', 'community', 'label', 'Community member', 'rank', 10)))),
  'the member app''s call, for a guest: exactly the contract''s shape, with sign_in as the reason for what needs more');
select pg_temp.assert(pg_temp.access_as(:u_stranger, :c)->'features'->'listen' =
  jsonb_build_object('allowed', false, 'reason', 'level', 'min_level', jsonb_build_object('key', 'community', 'label', 'Community member', 'rank', 10))
  and (pg_temp.access_as(:u_stranger, :c)->>'signed_in')::boolean,
  'signed in but below the minimum: the reason is level, not sign_in');
select pg_temp.assert(not exists (select 1 from jsonb_each(pg_temp.access_as(:u_none, :c)->'features') e where (e.value->>'allowed')::boolean is not true or e.value->>'reason' is not null)
                      and pg_temp.access_as(:u_none, :c)->'level'->>'key' = 'community',
  'a community member is allowed everything by default, with no reason');
-- An existing community: JSH has the same defaults, and its seeded live stream is open to guests (the owner's request).
select pg_temp.assert(pg_temp.can_as(null, :jsh, 'darshan') and pg_temp.can_as(null, :jsh, 'puja') and not pg_temp.can_as(null, :jsh, 'listen')
                      and pg_temp.can_as(:u_stranger, :jsh, 'darshan'),
  'an existing community (JSH) gets the same defaults');
select pg_temp.assert(pg_temp.can_as(:u_none, :jsh, 'darshan') and not pg_temp.can_as(:u_none, :jsh, 'listen'),
  'a person linked to another community is public in JSH');
begin;
select set_config('request.jwt.claims', '{"role":"anon"}', true), set_config('role', 'anon', true);
select pg_temp.assert(exists (select 1 from app.content_items where slug = 'jsh-live-stream' and kind = 'darshan_stream' and status = 'published'),
  'a guest reads JSH''s published live stream');
commit;
select pg_temp.assert_raises($$select app.feature_access_for_me('71000000-0000-4000-8000-0000000000ff')$$, 'not found', 'an unknown community is an error, in plain English');
select pg_temp.assert_raises($$select app.feature_access_for_me(null)$$, 'not found', 'so is no community');

-- ── Content: the live stream is the one thing the database protects ───────────
select pg_temp.assert(pg_temp.seen_as(null) = 'darshan darshan-c2 faq guide video-shared',
  'by default a guest reads the published live streams, the guide page, the FAQ and the shared video, and nothing else');
select pg_temp.assert(pg_temp.seen_as(:u_stranger) = 'darshan darshan-c2 faq guide video-shared',
  'someone signed in but not linked reads the same');
select pg_temp.assert(pg_temp.seen_as(:u_none) = 'darshan darshan-c2 faq guide niva stavan video-shared',
  'a member also reads their community''s other published items (and the other community''s public stream), exactly as before');
select pg_temp.assert(pg_temp.seen_as(:u_admin2) = 'darshan darshan-c2 faq guide stavan-c2 video-shared',
  'another community''s member reads their own community''s items and, by default, this one''s stream');

-- ── A community that is not open to guests ───────────────────────────────────
-- centers_public_read (0010) lists only active and onboarding communities to people who are not part of them. The
-- public level follows it: the public areas of a suspended or exited community are open to its own people and to
-- platform admins, not to guests or strangers (so its stream row and its ladder are not handed out).
\set c5 '''71000000-0000-4000-8000-0000000000c5'''
\set c6 '''71000000-0000-4000-8000-0000000000c6'''
\set c7 '''71000000-0000-4000-8000-0000000000c7'''
\set u_sm '''71000000-0000-4000-8000-000000000018'''
insert into auth.users (id, email) values (:u_sm, 'u0018-71@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status) values
  (:c5, 'orbit71e', 'Suspended 71 Community',  'O71E', 'TX', 'suspended'),
  (:c6, 'orbit71f', 'Exited 71 Community',     'O71F', 'TX', 'exited'),
  (:c7, 'orbit71g', 'Onboarding 71 Community', 'O71G', 'TX', 'onboarding');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values (:u_sm, :c5, 'Sue', 'Acc71', date '1995-01-01');
insert into app.center_users (center_id, user_id, person_id) values (:c5, :u_sm, :u_sm);
insert into app.content_items (id, center_id, kind, slug, title, media_url, status, published_at) values
  ('71000000-0000-4000-8000-0000000000f5', :c5, 'darshan_stream', 'acc71s-susp',    'Suspended live 71',  'https://example.org/live71e', 'published', now()),
  ('71000000-0000-4000-8000-0000000000f6', :c6, 'darshan_stream', 'acc71s-exited',  'Exited live 71',     'https://example.org/live71f', 'published', now()),
  ('71000000-0000-4000-8000-0000000000f7', :c7, 'darshan_stream', 'acc71s-onboard', 'Onboarding live 71', 'https://example.org/live71g', 'published', now());
-- Which of these three streams the user can read through row level security (slugs without the acc71s- prefix).
create or replace function pg_temp.seen_s_as(p_user uuid) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', case when p_user is null then jsonb_build_object('role', 'anon')
                                                else jsonb_build_object('sub', p_user, 'role', 'authenticated') end::text, true);
  perform set_config('role', case when p_user is null then 'anon' else 'authenticated' end, true);
  select coalesce(string_agg(replace(c.slug, 'acc71s-', ''), ' ' order by c.slug), '') into r
    from app.content_items c where c.slug like 'acc71s-%';
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return r;
end $$;
begin;
select set_config('request.jwt.claims', '{"role":"anon"}', true), set_config('role', 'anon', true);
select pg_temp.assert((select count(*) from app.centers where id in (:c5, :c6, :c7)) = 0,
  'a guest reads neither an onboarding (0615), a suspended nor an exited community (the public level follows the same rule)');
commit;
select pg_temp.assert(not pg_temp.can_as(null, :c5, 'darshan') and not pg_temp.can_as(null, :c6, 'darshan')
                      and not pg_temp.can_as(null, :c5, 'puja') and not pg_temp.can_as(null, :c6, 'timings') and not pg_temp.can_as(null, :c5, 'guide'),
  'a guest cannot use the public areas of a suspended or exited community');
select pg_temp.assert(not pg_temp.can_as(:u_stranger, :c5, 'darshan') and not pg_temp.can_as(:u_stranger, :c6, 'darshan')
                      and not pg_temp.can_as(:u_none, :c5, 'darshan'),
  'nor can someone signed in who is not part of it');
select pg_temp.assert(not pg_temp.can_as(null, :c7, 'darshan') and not pg_temp.can_as(:u_stranger, :c7, 'puja'),
  'an onboarding community is not open to guests or strangers (0615: only to its own people)');
select pg_temp.assert(pg_temp.can_as(:u_sm, :c5, 'darshan') and pg_temp.can_as(:u_sm, :c5, 'puja') and pg_temp.can_as(:u_sm, :c5, 'listen'),
  'a person linked to a suspended community keeps its areas, as before');
select pg_temp.assert(pg_temp.can_as(:u_padmin, :c5, 'darshan') and pg_temp.can_as(:u_padmin, :c6, 'darshan'),
  'and so does a platform admin');
select pg_temp.assert(pg_temp.seen_s_as(null) = '' and pg_temp.seen_s_as(:u_stranger) = '' and pg_temp.seen_s_as(:u_none) = '',
  'row level security gives a guest or a stranger no stream of the onboarding (0615), suspended or exited communities');
select pg_temp.assert(pg_temp.seen_s_as(:u_sm) = 'susp', 'a member of the suspended community reads its stream (not the onboarding one, 0615)');
select pg_temp.assert(pg_temp.seen_s_as(:u_padmin) = 'exited onboard susp', 'a platform admin reads them all');
select pg_temp.assert_raises($$select pg_temp.access_as(null, '71000000-0000-4000-8000-0000000000c5')$$, 'not found',
  'a guest asking for the access of a suspended community is told it was not found (its ladder is not shown)');
select pg_temp.assert_raises($$select pg_temp.access_as('71000000-0000-4000-8000-000000000004', '71000000-0000-4000-8000-0000000000c6')$$, 'not found',
  'so is someone signed in who is not part of an exited community');
select pg_temp.assert(pg_temp.access_as(:u_sm, :c5)->'level'->>'key' = 'community' and pg_temp.access_as(:u_padmin, :c6)->>'signed_in' = 'true'
                      and pg_temp.access_as(:u_padmin, :c7)->'features'->'darshan'->>'allowed' = 'true',
  'while a member of it and a platform admin get their answer (an onboarding one too, for the platform admin)');
select pg_temp.assert_raises($$select pg_temp.access_as(null, '71000000-0000-4000-8000-0000000000c7')$$, 'not found',
  'a guest asking about an onboarding community is told it was not found (0615)');

-- ── Choosing a level for an area ─────────────────────────────────────────────
begin;
select pg_temp.sign_in(:u_treas);
select pg_temp.assert_raises($$select app.access_settings('71000000-0000-4000-8000-0000000000c1')$$, 'settings.manage', 'seeing the settings needs settings.manage');
select pg_temp.assert_raises($$select app.set_feature_access('71000000-0000-4000-8000-0000000000c1', 'darshan', 'life', 'because')$$, 'settings.manage', 'choosing a level needs settings.manage');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[]'::jsonb, null, 'because')$$, 'settings.manage', 'so does editing the levels');
commit;
begin;
select pg_temp.sign_in(:u_admin2);   -- an administrator of another community
select pg_temp.assert_raises($$select app.set_feature_access('71000000-0000-4000-8000-0000000000c1', 'darshan', 'life', 'because')$$, 'settings.manage', 'an administrator of another community cannot change this one''s areas');
select pg_temp.assert_raises($$select app.access_settings('71000000-0000-4000-8000-0000000000c1')$$, 'settings.manage', 'nor read its settings');
commit;
begin;
select pg_temp.sign_in(:u_padmin);   -- a platform admin, not linked to the community
select pg_temp.assert(jsonb_array_length(app.access_settings(:c)->'levels') = 4, 'a platform admin can read any community''s settings');
commit;
begin;
select pg_temp.sign_in(:u_admin);
select pg_temp.assert_raises($$select app.set_feature_access('71000000-0000-4000-8000-0000000000c1', 'darshan', 'life', '   ')$$, 'Give a reason', 'a reason is required');
select pg_temp.assert_raises($$select app.set_feature_access('71000000-0000-4000-8000-0000000000c1', 'nope', 'life', 'because')$$, 'no area called', 'an unknown area is refused');
select pg_temp.assert_raises($$select app.set_feature_access('71000000-0000-4000-8000-0000000000c1', 'darshan', 'platinum', 'because')$$, 'no access level called', 'an unknown level is refused');
select pg_temp.assert_raises($$select app.set_feature_access('71000000-0000-4000-8000-0000000000c1', 'listen', 'public', 'because')$$, 'Community member', 'an area cannot go below its floor, and the error names the lowest level it may have');
select pg_temp.assert_raises($$select app.set_feature_access('71000000-0000-4000-8000-0000000000ff', 'darshan', 'life', 'because')$$, 'not found', 'an unknown community is refused');
select pg_temp.assert((select count(*) from app.center_feature_access where center_id = :c) = 0, 'nothing was saved by the refused changes');
-- Close the live stream to signed-in community members.
select app.set_feature_access(:c, 'darshan', 'community', 'The stream is for the community only for now');
commit;
select pg_temp.assert((select level_key = 'community' and changed_by = '71000000-0000-4000-8000-000000000001'
                          and reason = 'The stream is for the community only for now'
                         from app.center_feature_access where center_id = :c and feature_key = 'darshan'),
  'the choice is stored with who made it and why');
select pg_temp.assert((select action = 'center_feature_access.insert' and actor_user_id = '71000000-0000-4000-8000-000000000001' and center_id = :c
                          and reason = 'The stream is for the community only for now' and after->>'level_key' = 'community'
                          and module is null
                         from app.audit_log where record_table = 'center_feature_access' and record_id = :c || ':darshan' order by id desc limit 1),
  'and audited, with the reason');
select pg_temp.assert(not pg_temp.can_as(null, :c, 'darshan') and not pg_temp.can_as(:u_stranger, :c, 'darshan')
                      and pg_temp.can_as(:u_none, :c, 'darshan') and pg_temp.can_as(:u_yearly, :c, 'darshan'),
  'darshan now needs a signed-in community member: guests and strangers are out, members are in');
select pg_temp.assert(pg_temp.can_as(null, :c2, 'darshan'), 'another community''s darshan is unaffected');
select pg_temp.assert(pg_temp.access_as(null, :c)->'features'->'darshan' =
  jsonb_build_object('allowed', false, 'reason', 'sign_in', 'min_level', jsonb_build_object('key', 'community', 'label', 'Community member', 'rank', 10)),
  'a guest is told to sign in');
select pg_temp.assert(pg_temp.access_as(:u_stranger, :c)->'features'->'darshan'->>'reason' = 'level',
  'someone signed in but not part of the community is told the level is what they lack');
select pg_temp.assert(pg_temp.seen_as(null) = 'darshan-c2 faq guide video-shared'
                      and pg_temp.seen_as(:u_stranger) = 'darshan-c2 faq guide video-shared',
  'row level security hides this community''s stream from guests and strangers (the other community''s stays open); guide, FAQ and shared items stay public');
select pg_temp.assert(pg_temp.seen_as(:u_none) = 'darshan darshan-c2 faq guide niva stavan video-shared',
  'members still read it');
select pg_temp.assert(pg_temp.seen_as(:u_admin2) = 'darshan-c2 faq guide stavan-c2 video-shared',
  'another community''s member does not, since they are not part of this community');

-- Close it to Life members.
begin;
select pg_temp.sign_in(:u_admin);
select app.set_feature_access(:c, 'darshan', 'life', 'Only life members get the live stream (test)');
commit;
select pg_temp.assert((select action = 'center_feature_access.update' and before->>'level_key' = 'community' and after->>'level_key' = 'life'
                         from app.audit_log where record_table = 'center_feature_access' and record_id = :c || ':darshan' order by id desc limit 1),
  'changing the choice is audited with what it was and what it became');
select pg_temp.assert(pg_temp.can_as(:u_life, :c, 'darshan') and pg_temp.can_as(:u_child, :c, 'darshan') and pg_temp.can_as(:u_multi, :c, 'darshan')
                      and pg_temp.can_as(:u_two, :c, 'darshan') and pg_temp.can_as(:u_today, :c, 'darshan'),
  'Life members, their children, and people with a life membership among several are in');
select pg_temp.assert(not pg_temp.can_as(:u_yearly, :c, 'darshan') and not pg_temp.can_as(:u_none, :c, 'darshan')
                      and not pg_temp.can_as(:u_lapsed, :c, 'darshan') and not pg_temp.can_as(:u_ended, :c, 'darshan')
                      and not pg_temp.can_as(:u_comm, :c, 'darshan') and not pg_temp.can_as(null, :c, 'darshan'),
  'yearly members, community members, lapsed and ended memberships and guests are out');
select pg_temp.assert(pg_temp.access_as(:u_yearly, :c)->'features'->'darshan' =
  jsonb_build_object('allowed', false, 'reason', 'level', 'min_level', jsonb_build_object('key', 'life', 'label', 'Life member', 'rank', 30)),
  'a Member is told Life member is the level they lack');
select pg_temp.assert(pg_temp.seen_as(:u_life) = 'darshan darshan-c2 faq guide niva stavan video-shared'
                      and pg_temp.seen_as(:u_child) = 'darshan darshan-c2 faq guide niva stavan video-shared',
  'a Life member (and their child) reads the stream');
select pg_temp.assert(pg_temp.seen_as(:u_yearly) = 'darshan-c2 faq guide niva stavan video-shared'
                      and pg_temp.seen_as(:u_none) = 'darshan-c2 faq guide niva stavan video-shared',
  'a Member does not, but still reads every other item of their community, as before');
select pg_temp.assert(pg_temp.seen_as(:u_treas) = 'darshan-c2 faq guide niva stavan video-shared',
  'staff without content access are judged like members (the treasurer is a community member)');
select pg_temp.assert(pg_temp.seen_as(:u_editor) = 'darshan darshan-c2 darshan-draft faq guide niva stavan video-shared',
  'a content editor still reads the published stream (content.view) and their own drafts, whatever their level');
select pg_temp.assert(pg_temp.seen_as(:u_admin) = 'darshan darshan-c2 darshan-draft faq guide niva stavan video-shared'
                      and pg_temp.seen_as(:u_rel) = 'darshan darshan-c2 darshan-draft faq guide niva stavan video-shared',
  'people who manage content read every row of their community');
select pg_temp.assert(pg_temp.seen_as(:u_padmin) = 'darshan darshan-c2 darshan-draft faq guide niva stavan stavan-c2 video-shared',
  'a platform admin reads everything, as before');

-- A switched-off module closes what it owns, for everyone (only platform admins still read it).
begin;
select pg_temp.sign_in(:u_admin);
select app.set_module_enabled(:c, 'niva', false, 'Test: Niva off');
select app.set_module_enabled(:c, 'content', false, 'Test: Content off');
commit;
select pg_temp.assert(not pg_temp.can_as(:u_life, :c, 'darshan') and not pg_temp.can_as(:u_life, :c, 'listen') and not pg_temp.can_as(:u_life, :c, 'look'),
  'with Content off, even a Life member cannot use darshan, listen or look');
select pg_temp.assert(pg_temp.access_as(:u_life, :c)->'features'->'darshan'->>'reason' = 'module_off'
                      and pg_temp.access_as(null, :c)->'features'->'listen'->>'reason' = 'module_off'
                      and (pg_temp.access_as(:u_life, :c)->'features'->'darshan'->>'allowed')::boolean = false,
  'and the reason is module_off, for a guest too');
select pg_temp.assert(pg_temp.can_as(null, :c, 'puja') and pg_temp.can_as(:u_none, :c, 'learn') and not pg_temp.can_as(:u_none, :c, 'niva')
                      and pg_temp.can_as(null, :c, 'timings') and pg_temp.can_as(null, :c, 'guide'),
  'puja and learn follow Gyan Path (still on); Niva is off; the timings and the guide belong to no module');
select pg_temp.assert(pg_temp.seen_as(:u_life) = 'darshan-c2 video-shared' and pg_temp.seen_as(null) = 'darshan-c2 video-shared',
  'row level security hides the community''s content while Content is off (the other community''s stream and the shared video stay)');
begin;
select pg_temp.sign_in(:u_admin);
select app.set_module_enabled(:c, 'content', true, 'Test: Content back on');
select app.set_module_enabled(:c, 'niva', true, 'Test: Niva back on');
select app.set_module_enabled(:c, 'gyan_path', false, 'Test: Gyan Path off');
commit;
select pg_temp.assert(not pg_temp.can_as(null, :c, 'puja') and not pg_temp.can_as(:u_none, :c, 'learn') and pg_temp.can_as(:u_life, :c, 'darshan')
                      and pg_temp.can_as(:u_none, :c, 'niva'),
  'with Gyan Path off, puja and learn are off; darshan and Niva are back');
begin;
select pg_temp.sign_in(:u_admin);
select app.set_module_enabled(:c, 'gyan_path', true, 'Test: Gyan Path back on');
commit;
select pg_temp.assert(pg_temp.can_as(null, :c, 'puja') and pg_temp.can_as(:u_none, :c, 'learn'), 'switched back on, they work again');

-- The Membership module hides the membership screens and data; it does not take anyone's membership away, so
-- switching it off must not lock members out of an area chosen for them (darshan is Life member only here).
begin;
select pg_temp.sign_in(:u_admin);
select app.set_module_enabled(:c, 'membership', false, 'Test: Membership off');
commit;
select pg_temp.assert(pg_temp.level_as(:u_life, :c) = 'life:30:true' and pg_temp.level_as(:u_child, :c) = 'life:30:true'
                      and pg_temp.level_as(:u_yearly, :c) = 'member:20:true' and pg_temp.level_as(:u_none, :c) = 'community:10:true'
                      and pg_temp.level_as(:u_lapsed, :c) = 'community:10:true' and pg_temp.level_as(:u_ended, :c) = 'community:10:true',
  'with Membership off everyone keeps the level their memberships give them (lapsed and ended ones still do not count)');
select pg_temp.assert(pg_temp.can_as(:u_life, :c, 'darshan') and pg_temp.can_as(:u_child, :c, 'darshan')
                      and not pg_temp.can_as(:u_yearly, :c, 'darshan') and not pg_temp.can_as(:u_none, :c, 'darshan'),
  'so a Life member still reaches the Life-only darshan, and a Member still does not');
select pg_temp.assert(pg_temp.access_as(:u_life, :c)->'features'->'darshan'->>'allowed' = 'true'
                      and pg_temp.access_as(:u_yearly, :c)->'features'->'darshan'->>'reason' = 'level',
  'and the member app is told the same');
begin;
select pg_temp.sign_in(:u_admin);
select app.set_module_enabled(:c, 'membership', true, 'Test: Membership back on');
commit;
select pg_temp.assert(pg_temp.level_as(:u_life, :c) = 'life:30:true' and pg_temp.can_as(:u_life, :c, 'darshan'), 'and back on nothing changed');

-- An area other than darshan: the app decides, the database only answers.
begin;
select pg_temp.sign_in(:u_admin);
select app.set_feature_access(:c, 'listen', 'member', 'Listen is for paying members (test)');
commit;
select pg_temp.assert(pg_temp.access_as(:u_yearly, :c)->'features'->'listen'->>'allowed' = 'true'
                      and pg_temp.access_as(:u_none, :c)->'features'->'listen'->>'reason' = 'level'
                      and pg_temp.access_as(:u_none, :c)->'features'->'listen'->'min_level'->>'label' = 'Member'
                      and pg_temp.access_as(null, :c)->'features'->'listen'->>'reason' = 'sign_in',
  'Listen at Member: a Member is allowed, a community member is told they lack Member, a guest is told to sign in');
select pg_temp.assert(pg_temp.seen_as(:u_none) like '%stavan%',
  'but the stavan row is still readable by every member in the database (B45: only the app hides it)');

-- ── Editing the ladder ───────────────────────────────────────────────────────
begin;
select pg_temp.sign_in(:u_admin);
select pg_temp.assert((app.access_settings(:c)->'levels') @> '[{"key":"life","label":"Life member","rank":30,"kind":"membership","locked":false}]'::jsonb
                      and (app.access_settings(:c)->'levels'->0->>'locked')::boolean and (app.access_settings(:c)->'levels'->1->>'locked')::boolean
                      and jsonb_array_length(app.access_settings(:c)->'levels') = 4
                      and app.access_settings(:c)->'levels'->0->>'key' = 'public'
                      and app.access_settings(:c)->'levels'->2->'tiers' = '["yearly","life"]'::jsonb,
  'access_settings lists the levels in rank order, the two base levels locked');
select pg_temp.assert(jsonb_array_length(app.access_settings(:c)->'features') = 8
                      and (select e->>'level_key' from jsonb_array_elements(app.access_settings(:c)->'features') e where e->>'key' = 'darshan') = 'life'
                      and (select e->>'level_key' from jsonb_array_elements(app.access_settings(:c)->'features') e where e->>'key' = 'listen') = 'member'
                      and (select e->>'level_key' from jsonb_array_elements(app.access_settings(:c)->'features') e where e->>'key' = 'puja') = 'public'
                      and (select (e->>'module_on')::boolean from jsonb_array_elements(app.access_settings(:c)->'features') e where e->>'key' = 'timings')
                      and (select e->>'enforced_by' from jsonb_array_elements(app.access_settings(:c)->'features') e where e->>'key' = 'darshan') = 'database',
  'and every area with the level it has now (the choice, else the default), whether its module is on, and where it is enforced');
select pg_temp.assert((select array_agg(e->>'key' order by e->>'key') from jsonb_array_elements(app.access_settings(:c)->'membership_types') e)
                        = array['community','life','senior_yearly','yearly']
                      and not (app.access_settings(:c) ? 'membership_on'),
  'and the community''s membership types, for the rule picker');

select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[]'::jsonb, null, '  ')$$, 'Give a reason', 'saving needs a reason');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', null, null, 'because')$$, 'as a list', 'the levels must be a list');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '{"a":1}'::jsonb, null, 'because')$$, 'as a list', 'an object is not a list');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[1]'::jsonb, null, 'because')$$, 'needs a name', 'each level must be an object');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[{"key":"Bad Key","label":"X","rank":20,"tiers":["life"]}]'::jsonb, null, 'because')$$, 'lower-case letters', 'a bad key is refused');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[{"key":"public","label":"X","rank":20,"tiers":["life"]}]'::jsonb, null, 'because')$$, 'fixed levels', 'the base keys cannot be used for a membership level');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[{"key":"a_one","label":"A","rank":20,"tiers":["life"]},{"key":"a_one","label":"B","rank":30,"tiers":["life"]}]'::jsonb, null, 'because')$$, 'used twice', 'a key cannot be used twice');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[{"key":"a_one","label":"  ","rank":20,"tiers":["life"]}]'::jsonb, null, 'because')$$, '1 to 40 characters', 'a name cannot be empty');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', jsonb_build_array(jsonb_build_object('key','a_one','label',repeat('x',41),'rank',20,'tiers',jsonb_build_array('life'))), null, 'because')$$, '1 to 40 characters', 'a name is at most 40 characters');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[{"key":"a_one","label":"Member","rank":20,"tiers":["life"]},{"key":"a_two","label":"member","rank":30,"tiers":["life"]}]'::jsonb, null, 'because')$$, 'share the name', 'two levels cannot share a name, whatever the capitals');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[{"key":"a_one","label":"Public","rank":20,"tiers":["life"]}]'::jsonb, null, 'because')$$, 'share the name', 'nor a name a base level has');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[{"key":"a_one","label":"A","rank":15,"tiers":["life"]}]'::jsonb, null, 'because')$$, 'between 20 and 1000', 'a level cannot sit at or below the community level');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[{"key":"a_one","label":"A","rank":"high","tiers":["life"]}]'::jsonb, null, 'because')$$, 'whole number', 'a position is a number');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[{"key":"a_one","label":"A","rank":20,"tiers":["life"]},{"key":"a_two","label":"B","rank":20,"tiers":["life"]}]'::jsonb, null, 'because')$$, 'share the position', 'two levels cannot share a position');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[{"key":"a_one","label":"A","rank":20}]'::jsonb, null, 'because')$$, 'at least one membership tier or type', 'a level must say who it is for');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[{"key":"a_one","label":"A","rank":20,"tiers":[]}]'::jsonb, null, 'because')$$, 'at least one membership tier or type', 'an empty rule says nothing');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[{"key":"a_one","label":"A","rank":20,"tiers":["gold"]}]'::jsonb, null, 'because')$$, 'no membership tier called', 'a tier must exist');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[{"key":"a_one","label":"A","rank":20,"membership_type_keys":["platinum"]}]'::jsonb, null, 'because')$$, 'no membership type called', 'a membership type must exist in this community');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[{"key":"a_one","label":"A","rank":20,"tiers":"life"}]'::jsonb, null, 'because')$$, 'must be a list', 'tiers must be a list');
-- A rule is a list of names: a null (or a number, or a nested list) inside it is refused, not stored as a level nobody can meet.
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[{"key":"a_one","label":"A","rank":20,"tiers":[null]}]'::jsonb, null, 'because')$$, 'Each membership tier', 'a null tier is refused');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[{"key":"a_one","label":"A","rank":20,"tiers":["life",null]}]'::jsonb, null, 'because')$$, 'Each membership tier', 'even next to a real one');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[{"key":"a_one","label":"A","rank":20,"tiers":[1]}]'::jsonb, null, 'because')$$, 'Each membership tier', 'a number is not a tier');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[{"key":"a_one","label":"A","rank":20,"tiers":[["life"]]}]'::jsonb, null, 'because')$$, 'Each membership tier', 'nor a nested list');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[{"key":"a_one","label":"A","rank":20,"membership_type_keys":[null]}]'::jsonb, null, 'because')$$, 'Each membership type', 'a null membership type is refused');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[{"key":"a_one","label":"A","rank":20,"tiers":["life"],"membership_type_keys":["yearly",null]}]'::jsonb, null, 'because')$$, 'Each membership type', 'even next to a real one');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[{"key":"a_one","label":"A","rank":20,"membership_type_keys":[{"a":1}]}]'::jsonb, null, 'because')$$, 'Each membership type', 'nor an object');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', (select jsonb_agg(jsonb_build_object('key','lvl_' || chr(96 + g),'label','Level ' || g,'rank',20 + g,'tiers',jsonb_build_array('life'))) from generate_series(1, 11) g), null, 'because')$$, 'at most 10', 'at most ten membership levels');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[]'::jsonb, '{"public":"","community":"Community"}'::jsonb, 'because')$$, 'Public level', 'the Public level needs a name');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[]'::jsonb, jsonb_build_object('community', repeat('c', 41)), 'because')$$, 'community level', 'and the community level too (1 to 40 characters)');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[]'::jsonb, '{"public":"Guests","community":"guests"}'::jsonb, 'because')$$, 'share the name', 'the two base names must differ');
-- A level an area still uses cannot go: darshan needs Life member, listen needs Member.
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[{"key":"member","label":"Member","rank":20,"tiers":["yearly","life"]}]'::jsonb, null, 'because')$$,
  'Live darshan', 'removing a level an area still uses is refused, and the error names the area');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[{"key":"life","label":"Life member","rank":30,"tiers":["life"]}]'::jsonb, null, 'because')$$,
  'Stavans, podcasts and playlist', 'the same for the other level');
select pg_temp.assert((select count(*) from app.access_levels where center_id = :c) = 4, 'the refused saves changed nothing');
commit;

-- Rename the base levels, swap the order of Member and Life member, widen Member by a membership type.
begin;
select pg_temp.sign_in(:u_admin);
select app.save_access_levels(:c,
  '[{"key":"life","label":"Life member","rank":20,"tiers":["life"]},
    {"key":"member","label":"Supporting member","rank":30,"tiers":["yearly","life"],"membership_type_keys":["senior_yearly"]}]'::jsonb,
  '{"public":"Visitor","community":"Friend of the temple"}'::jsonb,
  'New names, and Life member now ranks below Supporting member (test)');
commit;
select pg_temp.assert((select array_agg(key || ':' || rank || ':' || label order by rank) from app.access_levels where center_id = :c)
                        = array['public:0:Visitor','community:10:Friend of the temple','life:20:Life member','member:30:Supporting member'],
  'the base names changed and the two levels swapped places in one save; the base keys and ranks did not move');
select pg_temp.assert((select tiers = '{yearly,life}' and membership_type_keys = '{senior_yearly}' from app.access_levels where center_id = :c and key = 'member'),
  'the rule was saved');
select pg_temp.assert((select count(*) from app.access_levels where center_id = :c2) = 4
                      and (select label from app.access_levels where center_id = :c2 and key = 'public') = 'Public',
  'another community''s ladder is untouched');
select pg_temp.assert((select action = 'access.levels_saved' and actor_user_id = '71000000-0000-4000-8000-000000000001'
                          and reason like 'New names, and Life member now ranks below%'
                          and before->'levels' @> '[{"key":"member","rank":20}]'::jsonb and after->'levels' @> '[{"key":"member","rank":30}]'::jsonb
                          and jsonb_array_length(before->'levels') = 4 and jsonb_array_length(after->'levels') = 4
                         from app.audit_log where center_id = :c and record_table = 'access_levels' and action = 'access.levels_saved' order by id desc limit 1),
  'the save is one audit entry with the whole ladder before and after, and the reason');
select pg_temp.assert((select count(*) >= 3 and bool_and(reason like 'New names, and Life member now ranks below%')
                         from app.audit_log where center_id = :c and record_table = 'access_levels' and action = 'access_levels.update'
                          and occurred_at >= now() - interval '1 minute'),
  'and each changed row is audited with the same reason');
select pg_temp.assert(pg_temp.access_as(null, :c)->'level' = '{"key":"public","label":"Visitor","rank":0}'::jsonb
                      and pg_temp.access_as(:u_none, :c)->'level'->>'label' = 'Friend of the temple'
                      and pg_temp.access_as(:u_yearly, :c)->'features'->'darshan'->'min_level' = '{"key":"life","label":"Life member","rank":20}'::jsonb,
  'the member app sees the new names and ranks');
select pg_temp.assert(pg_temp.level_as(:u_yearly, :c) = 'member:30:true' and pg_temp.level_as(:u_life, :c) = 'member:30:true'
                      and pg_temp.can_as(:u_yearly, :c, 'darshan'),
  'with Member above Life member, a yearly member is at the top and reaches darshan (the ladder is an order, not a name)');

-- Put it back: Life member above Member, then a level that is met by a membership TYPE alone.
begin;
select pg_temp.sign_in(:u_admin);
select app.save_access_levels(:c,
  '[{"key":"member","label":"Member","rank":20,"tiers":["yearly","life"]},
    {"key":"life","label":"Life member","rank":30,"tiers":["life"]},
    {"key":"senior","label":"Senior friend","rank":25,"membership_type_keys":["senior_yearly"]}]'::jsonb,
  '{"public":"Public","community":"Community member"}'::jsonb, 'Back to the usual names, plus a level for one membership type (test)');
commit;
select pg_temp.assert((select array_agg(key || ':' || rank order by rank) from app.access_levels where center_id = :c)
                        = array['public:0','community:10','member:20','senior:25','life:30'],
  'a level can sit between two others');
select pg_temp.assert(pg_temp.level_as(:u_type, :c) = 'senior:25:true' and pg_temp.level_as(:u_yearly, :c) = 'member:20:true',
  'a level met by a membership type alone: the senior-yearly household reaches it, a plain yearly household does not');
select pg_temp.assert((select tiers is null and membership_type_keys = '{senior_yearly}' from app.access_levels where center_id = :c and key = 'senior'),
  'its rule names the type and no tier');

-- A level nobody can reach cannot be chosen: the type is no longer offered.
update app.membership_types set active = false where center_id = :c and key = 'senior_yearly';
begin;
select pg_temp.sign_in(:u_admin);
select pg_temp.assert_raises($$select app.set_feature_access('71000000-0000-4000-8000-0000000000c1', 'look', 'senior', 'because')$$, 'Nobody can reach', 'an area cannot be given a level none of whose membership types is offered any more');
select pg_temp.assert((select (e->>'active')::boolean from jsonb_array_elements(app.access_settings(:c)->'membership_types') e where e->>'key' = 'senior_yearly') = false,
  'the settings say the type is not offered any more');
commit;
update app.membership_types set active = true where center_id = :c and key = 'senior_yearly';
begin;
select pg_temp.sign_in(:u_admin);
select app.set_feature_access(:c, 'look', 'senior', 'Look is for the senior friends (test)');
commit;
select pg_temp.assert(pg_temp.can_as(:u_type, :c, 'look') and not pg_temp.can_as(:u_yearly, :c, 'look') and not pg_temp.can_as(:u_none, :c, 'look'),
  'with the type offered again it can be chosen, and only that household reaches it');

-- Removing a level: refused while an area uses it (naming the area), allowed once it moved.
begin;
select pg_temp.sign_in(:u_admin);
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[{"key":"member","label":"Member","rank":20,"tiers":["yearly","life"]},{"key":"life","label":"Life member","rank":30,"tiers":["life"]}]'::jsonb, null, 'because')$$,
  'Videos and recipes', 'the senior level is the level for Look, so it cannot be removed (the error names the area)');
select app.set_feature_access(:c, 'look', 'community', 'Look is for everyone in the community again (test)');
select app.set_feature_access(:c, 'darshan', 'public', 'Darshan is public again (test)');
select app.set_feature_access(:c, 'listen', 'community', 'Listen is for the community again (test)');
select app.save_access_levels(:c, '[{"key":"member","label":"Member","rank":20,"tiers":["yearly","life"]}]'::jsonb, null,
  'Only Member is left (test)');
commit;
select pg_temp.assert((select array_agg(key || ':' || rank order by rank) from app.access_levels where center_id = :c) = array['public:0','community:10','member:20'],
  'unused levels were removed; the two base levels stayed');
select pg_temp.assert(pg_temp.level_as(:u_life, :c) = 'member:20:true', 'a Life member now reaches the highest level left (Member)');
select pg_temp.assert((select count(*) from app.audit_log where center_id = :c and record_table = 'access_levels' and action = 'access_levels.delete') = 2,
  'and each removal was audited');
-- The ladder can end at the community level when no area uses the others.
begin;
select pg_temp.sign_in(:u_admin);
select app.set_feature_access(:c, 'puja', 'member', 'Puja for Members (test)');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c1', '[]'::jsonb, null, 'because')$$, 'Virtual puja', 'Member is the level for puja now');
select app.set_feature_access(:c, 'puja', 'public', 'Puja for everyone again (test)');
select app.save_access_levels(:c, '[]'::jsonb, null, 'No membership levels at all (test)');
commit;
select pg_temp.assert((select array_agg(key order by rank) from app.access_levels where center_id = :c) = array['public','community']
                      and pg_temp.level_as(:u_life, :c) = 'community:10:true',
  'a community can have only the two base levels; members are then community members');
begin;
select pg_temp.sign_in(:u_admin);
select app.save_access_levels(:c,
  '[{"key":"member","label":"Member","rank":20,"tiers":["yearly","life"]},{"key":"life","label":"Life member","rank":30,"tiers":["life"]}]'::jsonb, null, 'The usual ladder again (test)');
commit;
select pg_temp.assert(pg_temp.level_as(:u_life, :c) = 'life:30:true' and pg_temp.level_as(:u_yearly, :c) = 'member:20:true',
  'the usual ladder is back');

-- A time zone name the database does not know must not break the rule (it runs inside row level security).
update app.centers set time_zone = 'Mars/Phobos' where id = :c;
select pg_temp.assert(pg_temp.level_as(:u_life, :c) = 'life:30:true' and pg_temp.can_as(:u_life, :c, 'listen'),
  'a community with a time zone the database does not know still gets its members their level (the database''s date is used)');
update app.centers set time_zone = 'America/Chicago' where id = :c;

-- A choice below the floor that somehow got into the table is lifted to the floor when it is applied.
insert into app.center_feature_access (center_id, feature_key, level_key, reason) values (:c3, 'niva', 'public', 'written by hand');
select pg_temp.assert(not pg_temp.can_as(null, :c3, 'niva') and pg_temp.access_as(null, :c3)->'features'->'niva'->'min_level'->>'key' = 'community',
  'a choice below an area''s floor is never applied (belt and braces: the RPC refuses it first)');
delete from app.center_feature_access where center_id = :c3;

-- ── Step-up: the changes need a fresh 2FA check where the community requires it ──
begin;
select pg_temp.sign_in(:u_admin2);   -- an administrator of C2, which has the default (2FA required for staff)
select pg_temp.assert_raises($$select app.set_feature_access('71000000-0000-4000-8000-0000000000c2', 'darshan', 'community', 'because')$$, 'fresh 2FA check', 'choosing a level needs a fresh 2FA check');
select pg_temp.assert_raises($$select app.save_access_levels('71000000-0000-4000-8000-0000000000c2', '[]'::jsonb, null, 'because')$$, 'fresh 2FA check', 'so does editing the ladder');
commit;
begin;
select pg_temp.sign_in(:u_admin2, 30);   -- authenticator code entered 30 seconds ago
select app.set_feature_access(:c2, 'darshan', 'community', 'Test: with a fresh 2FA check');
select app.save_access_levels(:c2, '[]'::jsonb, '{"community":"Parishioner"}'::jsonb, 'Test: with a fresh 2FA check');
commit;
select pg_temp.assert((select level_key from app.center_feature_access where center_id = :c2 and feature_key = 'darshan') = 'community'
                      and (select label from app.access_levels where center_id = :c2 and key = 'community') = 'Parishioner',
  'with a fresh 2FA check both go through');

-- ── Who may call what ────────────────────────────────────────────────────────
select pg_temp.assert(has_function_privilege('anon', 'app.can_use_feature(uuid,text)', 'execute')
                      and has_function_privilege('anon', 'app.feature_access_for_me(uuid)', 'execute')
                      and has_function_privilege('anon', 'app.my_access(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.feature_access_for_me(uuid)', 'execute'),
  'guests and members can ask about their own access');
select pg_temp.assert(not has_function_privilege('anon', 'app.access_settings(uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.set_feature_access(uuid,text,text,text)', 'execute')
                      and not has_function_privilege('anon', 'app.save_access_levels(uuid,jsonb,jsonb,text)', 'execute')
                      and has_function_privilege('authenticated', 'app.set_feature_access(uuid,text,text,text)', 'execute'),
  'only signed-in people can reach the settings RPCs (which then check settings.manage)');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.feature_min_level(uuid,text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.access_level_reachable(uuid,text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.access_center_open(uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.access_center_open(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.access_seed_center(uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.access_seed_center(uuid)', 'execute'),
  'the helpers are not callable over the API');
select pg_temp.assert(has_function_privilege('service_role', 'app.can_use_feature(uuid,text)', 'execute')
                      and has_function_privilege('service_role', 'app.save_access_levels(uuid,jsonb,jsonb,text)', 'execute')
                      and has_function_privilege('service_role', 'app.access_center_open(uuid)', 'execute')
                      and has_function_privilege('service_role', 'app.access_seed_center(uuid)', 'execute'),
  'the service role can run them too');
select pg_temp.assert((select bool_and(p.prosecdef and exists (select 1 from unnest(p.proconfig) as g(setting)
                                                                 where g.setting ~ '^search_path=app, *public, *extensions$'))
                         from pg_proc p where p.oid in ('app.my_access(uuid)'::regprocedure, 'app.feature_min_level(uuid,text)'::regprocedure,
                                                       'app.can_use_feature(uuid,text)'::regprocedure, 'app.feature_access_for_me(uuid)'::regprocedure,
                                                       'app.access_level_reachable(uuid,text)'::regprocedure, 'app.access_center_open(uuid)'::regprocedure,
                                                       'app.access_settings(uuid)'::regprocedure,
                                                       'app.set_feature_access(uuid,text,text,text)'::regprocedure,
                                                       'app.save_access_levels(uuid,jsonb,jsonb,text)'::regprocedure,
                                                       'app.access_seed_center(uuid)'::regprocedure, 'app.access_seed_new_center()'::regprocedure)),
  'the security definer functions pin search_path = app, public, extensions');

-- ── A community created after the migration gets the ladder ──────────────────
insert into app.centers (id, slug, name, short_name, state_region, status)
values ('71000000-0000-4000-8000-0000000000c4', 'orbit71d', 'Fourth 71 Community', 'O71D', 'TX', 'active');
select pg_temp.assert((select array_agg(key || ':' || rank order by rank) from app.access_levels where center_id = '71000000-0000-4000-8000-0000000000c4')
                        = array['public:0','community:10','member:20','life:30'],
  'a new community starts with the same four levels');

-- Leave nothing global behind: the two platform admins of this test.
delete from app.accounts where user_id in (:u_padmin, :u_padmin_l);
select pg_temp.assert(not exists (select 1 from app.accounts where user_id in (:u_padmin, :u_padmin_l)), 'the test''s platform admins are removed');
