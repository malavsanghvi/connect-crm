-- 0815: the public list of demo people offers only the featured roles, in two areas (owner decision 2026-10-14).
--   A. The featured list: one function, six roles, two areas, in order, with the one label that differs
--   B. What the public list offers: only those people (with a sign-in), each with an area, ordered by area then by the list, no address
--   C. Nothing else changed: every role still has its demo person and its sign-in, and a person who is not offered can still start a demo
--   D. The list is changed in one place only
--   E. Who may call what
-- Everything runs in one transaction that is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.claims(p_user text, p_step_up boolean default false) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', case when p_step_up then 'aal2' else 'aal1' end,
    'amr', case when p_step_up
                then jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 600),
                                       jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 60))
                else jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 60)) end)::text, true);
end $$;
create or replace function pg_temp.as_none() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
  set local role anon;
end $$;
create or replace function pg_temp.begin_as_worker(p_persona uuid, p_ip text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role connect_worker;
  r := app.worker_demo_begin(p_persona, p_ip);
  reset role;
  return r;
end $$;

grant connect_worker to postgres;   -- the test switches to connect_worker; a hosted postgres holds ADMIN on it but not SET
\set admin '''e8150000-0000-4000-8000-0000000000a1'''
\set jsh '''00000000-0000-4000-8000-000000000001'''
\set stranger '''e8150000-0000-4000-8000-0000000000c1'''

select pg_temp.as_none();
insert into auth.users (id, email) values (:admin, 'admin815@platform.test');
insert into app.accounts (user_id, is_platform_admin) values (:admin, true) on conflict (user_id) do update set is_platform_admin = true;
select pg_temp.claims(:admin, true);
select (app.create_demo_community('faith'))->>'center_id' as fc \gset
select (app.create_demo_community('neutral'))->>'center_id' as nc \gset
select id as p_teacher from app.demo_personas where center_id = :'fc' and role_key = 'teacher' \gset
select email as e_teacher from app.demo_personas where center_id = :'fc' and role_key = 'teacher' \gset
select id as p_member from app.demo_personas where center_id = :'fc' and role_key = 'community_member' \gset
-- A real person already holds the faith demo teacher's address: that one demo person gets no sign-in, so is not offered.
select pg_temp.as_none();
insert into auth.users (id, email) values (:stranger, :'e_teacher');
insert into app.role_grants (center_id, user_id, role_key, scope_kind) values (:jsh, :stranger, 'community_member', 'center');
select pg_temp.claims(:admin, false);

-- ══ A. The featured list ════════════════════════════════════════════════════
select pg_temp.assert((select count(*) = 6 from app.demo_featured_roles()), 'A · six featured roles');
select pg_temp.assert((select array_agg(role_key order by sort) from app.demo_featured_roles() where area = 'operations')
                        = array['center_admin', 'treasurer', 'membership_coordinator', 'event_lead', 'teacher'],
  'A · non-profit operational roles: the administrator, treasurer, membership coordinator, event lead and teacher, in that order');
select pg_temp.assert((select array_agg(role_key) from app.demo_featured_roles() where area = 'community') = array['primary_adult'],
  'A · community roles: the family''s main adult');
select pg_temp.assert((select count(distinct area) = 2 and bool_and(area in ('operations', 'community')) from app.demo_featured_roles()),
  'A · there are exactly two areas, operations and community');
select pg_temp.assert((select label from app.demo_featured_roles() where role_key = 'primary_adult') = 'Community member · Adult'
                      and (select count(*) = 0 from app.demo_featured_roles() where label is not null and role_key <> 'primary_adult'),
  'A · only the main adult is shown under other words: "Community member · Adult"');
select pg_temp.assert(not exists (select 1 from app.demo_featured_roles() f where not exists (select 1 from app.roles r where r.key = f.role_key)),
  'A · every featured role is a role of the catalog');
select pg_temp.assert((select provolatile = 'i' from pg_proc where oid = 'app.demo_featured_roles()'::regprocedure),
  'A · and the function is immutable');

-- ══ B. What the public list offers ══════════════════════════════════════════
select app.demo_signin_setup('Set up the demo sign-ins for the test')::text as setup \gset
select pg_temp.assert((:'setup'::jsonb ->> 'created')::int > 0 and jsonb_array_length(:'setup'::jsonb -> 'refused') = 1
                      and (:'setup'::jsonb -> 'refused' -> 0 ->> 'email') = :'e_teacher',
  'B · every demo person has a sign-in except the faith teacher, whose address belongs to a real person');
select pg_temp.as_anon();
select app.demo_choices()::text as ch \gset
select pg_temp.as_none();
select pg_temp.assert(jsonb_array_length(:'ch'::jsonb -> 'communities') = 2, 'B · both demo communities are listed');
-- For each community: its people are exactly the featured roles it has a person with a sign-in for, in the list's order.
select pg_temp.assert(not exists (
  select 1
    from jsonb_array_elements(:'ch'::jsonb -> 'communities') c
   where (select coalesce(array_agg(dp.role_key order by o), '{}'::text[])
            from jsonb_array_elements(c -> 'people') with ordinality p(v, o) join app.demo_personas dp on dp.id = (p.v ->> 'id')::uuid)
         is distinct from
         (select coalesce(array_agg(k order by o), '{}'::text[])
            from unnest(array['center_admin', 'treasurer', 'membership_coordinator', 'event_lead', 'teacher', 'primary_adult']) with ordinality u(k, o)
           where exists (select 1 from app.demo_personas d join app.demo_auth_users a on a.email = d.email
                          where d.role_key = u.k and d.center_id = (select ce.id from app.centers ce where ce.name = c ->> 'name' and app.is_demo_center(ce.id)))))
  , 'B · each community offers only the featured people that have a sign-in, operations first in the list''s order, then the community role');
select pg_temp.assert((select count(*) = 2 from jsonb_array_elements(:'ch'::jsonb -> 'communities') c
                        where jsonb_array_length(c -> 'people') between 1 and 6),
  'B · no community offers more than the six');
select pg_temp.assert(not exists (select 1 from jsonb_array_elements(:'ch'::jsonb -> 'communities') c, jsonb_array_elements(c -> 'people') p
                                   where (select array_agg(k order by k) from jsonb_object_keys(p) k) is distinct from array['area', 'id', 'name', 'role', 'story']),
  'B · each person is an id, a role, a name, a story and an area, nothing else');
select pg_temp.assert(not exists (select 1 from jsonb_array_elements(:'ch'::jsonb -> 'communities') c
                                   where (select array_agg(k order by k) from jsonb_object_keys(c) k) is distinct from array['id', 'kind', 'name', 'people', 'slug']
                                      or not exists (select 1 from app.centers ce where ce.id = (c ->> 'id')::uuid and ce.slug = (c ->> 'slug')::citext)),
  'B · each community is a kind, a name, its own public id and web name, and its people');
select pg_temp.assert(not exists (select 1 from jsonb_array_elements(:'ch'::jsonb -> 'communities') c, jsonb_array_elements(c -> 'people') p
                                   join app.demo_personas dp on dp.id = (p ->> 'id')::uuid
                                  where (p ->> 'area') is distinct from case when dp.role_key = 'primary_adult' then 'community' else 'operations' end),
  'B · every person''s area is the one of their role');
select pg_temp.assert(not exists (select 1 from jsonb_array_elements(:'ch'::jsonb -> 'communities') c, jsonb_array_elements(c -> 'people') p
                                   join app.demo_personas dp on dp.id = (p ->> 'id')::uuid
                                  where (p ->> 'role') is distinct from case when dp.role_key = 'primary_adult' then 'Community member · Adult' else dp.headline end),
  'B · the role is the role''s name, except the main adult, who is "Community member · Adult"');
select pg_temp.assert(exists (select 1 from jsonb_array_elements(:'ch'::jsonb -> 'communities') c, jsonb_array_elements(c -> 'people') p
                               where (p ->> 'area') = 'operations')
                      and exists (select 1 from jsonb_array_elements(:'ch'::jsonb -> 'communities') c, jsonb_array_elements(c -> 'people') p
                                   where (p ->> 'area') = 'community'),
  'B · both areas have people to choose from');
select pg_temp.assert(position(:'p_teacher' in :'ch') = 0, 'B · the faith teacher has no sign-in, so is not offered');
select pg_temp.assert(position(:'p_member' in :'ch') = 0, 'B · a role that is not featured (the community member) is not offered');
select pg_temp.assert(position('weaverams.org' in :'ch') = 0 and position(:'e_teacher' in :'ch') = 0, 'B · the list never shows an address');
select pg_temp.assert((select bool_and((c ->> 'name') like '%(Demo)') from jsonb_array_elements(:'ch'::jsonb -> 'communities') c)
                      and (select array_agg(c ->> 'kind' order by c ->> 'kind') from jsonb_array_elements(:'ch'::jsonb -> 'communities') c) = array['faith', 'neutral'],
  'B · and the communities are still the two demo ones');

-- ══ C. Nothing else changed ═════════════════════════════════════════════════
select pg_temp.assert(app.demo_missing_roles(:'fc') = '{}'::text[] and app.demo_missing_roles(:'nc') = '{}'::text[],
  'C · every role of each demo community still has its demo person (the pack is untouched)');
select pg_temp.assert((select count(*) > 6 from app.demo_personas where center_id = :'fc')
                      and (select count(*) = count(distinct role_key) from app.demo_personas where center_id = :'fc'),
  'C · and the faith community has many more demo people than the list offers, one per role');
select pg_temp.assert((select count(*) = (select count(*) from app.demo_personas) - 1 from app.demo_auth_users),
  'C · every demo person keeps their sign-in (but the one whose address is a real person''s)');
select app.set_demo_signin(true, 'Open the demo for the test')::text as sw \gset
select pg_temp.begin_as_worker(:'p_member', 'hash-815')::text as b \gset
select pg_temp.assert((:'b'::jsonb ->> 'ok')::boolean and (:'b'::jsonb ->> 'email') like '%@demo.weaverams.org',
  'C · a demo person who is not on the list can still start a session (worker_demo_begin is unchanged)');

-- ══ D. The list is changed in one place only ════════════════════════════════
create or replace function app.demo_featured_roles() returns table (role_key text, area text, sort int, label text)
language sql immutable set search_path = app, public, extensions as $$
  select * from (values ('adult_member', 'community', 10, null::text), ('treasurer', 'operations', 20, null)) f(role_key, area, sort, label)
$$;
select pg_temp.as_anon();
select app.demo_choices()::text as ch2 \gset
select pg_temp.as_none();
select pg_temp.assert(not exists (select 1 from jsonb_array_elements(:'ch2'::jsonb -> 'communities') c, jsonb_array_elements(c -> 'people') p
                                   join app.demo_personas dp on dp.id = (p ->> 'id')::uuid where dp.role_key not in ('adult_member', 'treasurer'))
                      and (select count(*) >= 2 and count(*) = (select count(*) from app.demo_personas d join app.demo_auth_users a on a.email = d.email
                                                                  where d.role_key in ('adult_member', 'treasurer'))
                             from jsonb_array_elements(:'ch2'::jsonb -> 'communities') c, jsonb_array_elements(c -> 'people') p),
  'D · changing the one function changes who is offered (here: the treasurer and the family''s other adult, in each community)');
select pg_temp.assert((select array_agg(dp.role_key order by o) from jsonb_array_elements(:'ch2'::jsonb -> 'communities') c,
                         jsonb_array_elements(c -> 'people') with ordinality p(v, o) join app.demo_personas dp on dp.id = (p.v ->> 'id')::uuid
                        where c ->> 'kind' = 'faith') = array['treasurer', 'adult_member'],
  'D · still ordered by area (operations first) and then by the list');

-- ══ E. Who may call what ════════════════════════════════════════════════════
select pg_temp.as_anon();
select pg_temp.assert(jsonb_typeof(app.demo_choices()) = 'object', 'E · the public can see the list');
select pg_temp.as_none();
select pg_temp.assert(has_function_privilege('anon', 'app.demo_choices()', 'execute') and has_function_privilege('authenticated', 'app.demo_choices()', 'execute')
                      and not has_function_privilege('anon', 'app.demo_featured_roles()', 'execute')
                      and not has_function_privilege('authenticated', 'app.demo_featured_roles()', 'execute'),
  'E · the list is public, the featured roles function is for the list only');
rollback;
