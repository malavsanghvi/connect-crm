-- 0860 (owner decision 2026-10-15, "go with your recommendations"): an area the community's kind of organization does not have is in the
-- member app's access answer as NOT AVAILABLE (allowed false, reason module_off), not left out, so the app hides it. Only a removal: nothing is
-- granted to anyone, and a Jain Center's answer is byte for byte what it was.
--   A. The yardstick: 0600's own body (kept in this file, nowhere else) leaves the areas out, so the comparison below measures something
--   B. A Jain Center (JSH and a Jain Center sandbox): the full answer is identical, text for text, for a guest, a stranger, a member and an
--      administrator, also when the community changed a level or switched a module off
--   C. Every other kind, for the same four callers: every area the kind has is exactly what it was; every area it does not have is in the answer
--      as not allowed / module_off; nothing else differs; nothing becomes allowed that was not
--   D. The faith demo (the Faith community with the modules the demo switches on) and a chamber, in plain words
--   E. Staff and permissions unchanged: can_use_feature, Settings > Access levels (access_settings), who may call it
--   F. Row level security unchanged: the live darshan stream of a kind without it is not handed to anyone new
--   G. Errors and the function itself: an unknown or closed community is "not found", privileges, security definer, pinned search path
--   H. The member app's one read embeds the same answer (a Jain Center's unchanged)
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

-- ── The answer of 0600, word for word. It is the yardstick: what the function said before this change. ──────────────────────────────
create or replace function pg_temp.access_0600(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare me record; f record; v_out jsonb := '{}'::jsonb; v_on boolean; v_ok boolean; v_reason text;
        v_min_key text; v_min_label text; v_min_rank integer; v_cat text;
begin
  if p_center is null or not app.access_center_open(p_center) then
    raise exception 'That community was not found.';
  end if;
  v_cat := app.center_category(p_center);
  select * into me from app.my_access(p_center);
  for f in select * from app.access_features a where app.catalog_shows(a.category_keys, v_cat) order by a.sort, a.key loop
    select m.key, m.label, m.rank into v_min_key, v_min_label, v_min_rank from app.feature_min_level(p_center, f.key) m;
    if v_min_key is null then
      v_min_key := f.default_level;
      v_min_label := case f.default_level when 'community' then 'Community member' else 'Public' end;
      v_min_rank := case f.default_level when 'community' then 10 else 0 end;
    end if;
    v_on := f.module_key is null or app.module_enabled(p_center, f.module_key);
    v_ok := v_on and me.rank >= v_min_rank;
    v_reason := case when not v_on then 'module_off'
                     when v_ok then null
                     when not me.signed_in then 'sign_in'
                     else 'level' end;
    v_out := v_out || jsonb_build_object(f.key, jsonb_build_object(
               'allowed', v_ok, 'reason', v_reason,
               'min_level', jsonb_build_object('key', v_min_key, 'label', v_min_label, 'rank', v_min_rank)));
  end loop;
  return jsonb_build_object('level', jsonb_build_object('key', me.key, 'label', me.label, 'rank', me.rank),
                            'signed_in', me.signed_in, 'features', v_out);
end $$;

-- The answer as a caller (null = a guest with the anon key), by the new function ('new') or by 0600's ('old'), then back to the test's own role.
create or replace function pg_temp.answer(p_user uuid, p_center uuid, p_which text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', case when p_user is null then jsonb_build_object('role', 'anon')
                                                else jsonb_build_object('sub', p_user, 'role', 'authenticated') end::text, true);
  perform set_config('role', case when p_user is null then 'anon' else 'authenticated' end, true);
  r := case p_which when 'old' then pg_temp.access_0600(p_center) else app.feature_access_for_me(p_center) end;
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
-- The areas Settings > Access levels lists for a community, as a sorted comma list.
create or replace function pg_temp.settings_as(p_user uuid, p_center uuid) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select string_agg(e->>'key', ',' order by e->>'key') into r from jsonb_array_elements(app.access_settings(p_center)->'features') e;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return r;
end $$;
-- Which of this test's content items the caller can read through row level security (slugs without the acc860- prefix).
create or replace function pg_temp.seen_as(p_user uuid) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', case when p_user is null then jsonb_build_object('role', 'anon')
                                                else jsonb_build_object('sub', p_user, 'role', 'authenticated') end::text, true);
  perform set_config('role', case when p_user is null then 'anon' else 'authenticated' end, true);
  select coalesce(string_agg(replace(c.slug, 'acc860-', ''), ' ' order by c.slug), '') into r
    from app.content_items c where c.slug like 'acc860-%';
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return r;
end $$;
-- The keys of a JSON object as one sorted comma list.
create or replace function pg_temp.keys(j jsonb) returns text language sql as $$
  select coalesce(string_agg(k, ',' order by k), '') from jsonb_object_keys(j) k
$$;

-- What differs between 0600's answer and the new one for one caller and one community, in words ('' = exactly what is wanted):
-- the level and signed_in are the same; every area of the catalog is in the new answer; an area the community's kind has is the same entry as
-- before, character for character; an area it does not have was absent before and is now {allowed false, reason module_off}; nothing else.
create or replace function pg_temp.problems(p_user uuid, p_center uuid) returns text language plpgsql as $$
declare o jsonb := pg_temp.answer(p_user, p_center, 'old'); n jsonb := pg_temp.answer(p_user, p_center, 'new');
        v_cat text := (select category_key from app.centers where id = p_center); k record; r text := '';
begin
  if o->'level' is distinct from n->'level' or o->'signed_in' is distinct from n->'signed_in' then r := r || 'level or signed_in differs; '; end if;
  if (select array_agg(x order by x) from jsonb_object_keys(n) x) is distinct from (select array_agg(x order by x) from jsonb_object_keys(o) x) then
    r := r || 'top-level keys differ; ';
  end if;
  for k in select a.key, a.category_keys from app.access_features a order by a.key loop
    if not (n->'features' ? k.key) then
      r := r || k.key || ' is missing; ';
    elsif app.catalog_shows(k.category_keys, v_cat) then
      if (n->'features'->k.key)::text is distinct from (o->'features'->k.key)::text then r := r || k.key || ' changed; '; end if;
    else
      if o->'features' ? k.key then r := r || k.key || ' was already in the old answer; '; end if;
      if n->'features'->k.key->>'allowed' is distinct from 'false' or n->'features'->k.key->>'reason' is distinct from 'module_off' then
        r := r || k.key || ' is not {allowed false, module_off}; ';
      end if;
    end if;
  end loop;
  if (select count(*) from jsonb_object_keys(n->'features')) <> (select count(*) from app.access_features) then r := r || 'an unknown area appeared; '; end if;
  -- the hard line: nothing that was not allowed is allowed now
  for k in select e.key from jsonb_each(n->'features') e where (e.value->>'allowed')::boolean loop
    if (o->'features'->k.key->>'allowed') is distinct from 'true' then r := r || k.key || ' became allowed; '; end if;
  end loop;
  return r;
end $$;
-- The same for the four callers of every community of the test: a guest, someone signed in but linked to nothing, a member, an administrator.
create or replace function pg_temp.all_problems() returns text language plpgsql as $$
declare c record; v record; p text; r text := '';
begin
  for c in select * from pg_temp.test_centers() loop
    for v in select * from (values ('guest', null::uuid), ('stranger', pg_temp.uid(3, 1)), ('member', pg_temp.uid(1, c.n)), ('admin', pg_temp.uid(2, c.n))) x(who, u) loop
      p := pg_temp.problems(v.u, c.id);
      if p <> '' then r := r || c.cat || '/' || c.n || ' ' || v.who || ': ' || p || E'\n'; end if;
    end loop;
  end loop;
  return r;
end $$;
-- Text for text, for the Jain Centers of the test.
create or replace function pg_temp.jain_differences() returns text language plpgsql as $$
declare c record; v record; r text := '';
begin
  for c in select * from pg_temp.test_centers() where cat = 'jain_center' loop
    for v in select * from (values ('guest', null::uuid), ('stranger', pg_temp.uid(3, 1)), ('member', pg_temp.uid(1, c.n)), ('admin', pg_temp.uid(2, c.n))) x(who, u) loop
      if pg_temp.answer(v.u, c.id, 'new')::text is distinct from pg_temp.answer(v.u, c.id, 'old')::text then r := r || c.n || ' ' || v.who || '; '; end if;
    end loop;
  end loop;
  return r;
end $$;

-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- One community of every kind (a sandbox may take an inactive kind), plus JSH. Active, so guests may ask about them.
\set jsh '''00000000-0000-4000-8000-000000000001'''
\set c_jc '''86000000-0000-4000-8000-0000000000c1'''
\set c_swm '''86000000-0000-4000-8000-0000000000c2'''
\set c_chr '''86000000-0000-4000-8000-0000000000c3'''
\set c_mos '''86000000-0000-4000-8000-0000000000c4'''
\set c_fth '''86000000-0000-4000-8000-0000000000c5'''
\set c_chm '''86000000-0000-4000-8000-0000000000c6'''
\set c_npo '''86000000-0000-4000-8000-0000000000c7'''
-- Callers: uid(1, n) the member of community number n, uid(2, n) its administrator, uid(3, 1) one stranger linked to nothing.
create or replace function pg_temp.uid(kind int, n int) returns uuid language sql immutable as $$
  select ('86000000-0000-4000-8000-00000000' || lpad(kind::text, 2, '0') || lpad(n::text, 2, '0'))::uuid
$$;
create or replace function pg_temp.test_centers() returns table (n int, id uuid, cat text) language sql as $$
  select * from (values
    (1, '00000000-0000-4000-8000-000000000001'::uuid, 'jain_center'),
    (2, '86000000-0000-4000-8000-0000000000c1'::uuid, 'jain_center'),
    (3, '86000000-0000-4000-8000-0000000000c2'::uuid, 'swaminarayan_temple'),
    (4, '86000000-0000-4000-8000-0000000000c3'::uuid, 'church'),
    (5, '86000000-0000-4000-8000-0000000000c4'::uuid, 'mosque'),
    (6, '86000000-0000-4000-8000-0000000000c5'::uuid, 'faith_other'),
    (7, '86000000-0000-4000-8000-0000000000c6'::uuid, 'chamber_of_commerce'),
    (8, '86000000-0000-4000-8000-0000000000c7'::uuid, 'nonprofit_secular')) v(n, id, cat)
$$;

insert into app.centers (id, slug, name, environment, category_key, status) values
  (:c_jc,  'jc860-sandbox',  'Jain Center 860',   'sandbox', 'jain_center',         'active'),
  (:c_swm, 'swm860-sandbox', 'Swaminarayan 860',  'sandbox', 'swaminarayan_temple', 'active'),
  (:c_chr, 'chr860-sandbox', 'Church 860',        'sandbox', 'church',              'active'),
  (:c_mos, 'mos860-sandbox', 'Mosque 860',        'sandbox', 'mosque',              'active'),
  (:c_fth, 'fth860-sandbox', 'Faith 860',         'sandbox', 'faith_other',         'active'),
  (:c_chm, 'chm860-sandbox', 'Chamber 860',       'sandbox', 'chamber_of_commerce', 'active'),
  (:c_npo, 'npo860-sandbox', 'Community 860',     'sandbox', 'nonprofit_secular',   'active');
insert into auth.users (id, email)
select pg_temp.uid(k.kind, c.n), 'u' || k.kind || c.n || '-860@example.com'
  from pg_temp.test_centers() c cross join (values (1), (2)) k(kind);
insert into auth.users (id, email) values (pg_temp.uid(3, 1), 'stranger-860@example.com');
insert into app.people (id, center_id, first_name, last_name, date_of_birth)
select pg_temp.uid(k.kind, c.n), c.id, case k.kind when 1 then 'Mem' else 'Adm' end, 'Acc860-' || c.n, date '1980-01-01'
  from pg_temp.test_centers() c cross join (values (1), (2)) k(kind);
insert into app.center_users (center_id, user_id, person_id)
select c.id, pg_temp.uid(k.kind, c.n), pg_temp.uid(k.kind, c.n)
  from pg_temp.test_centers() c cross join (values (1), (2)) k(kind);
insert into app.role_grants (center_id, user_id, role_key, reason)
select c.id, pg_temp.uid(2, c.n), 'center_admin', 'access test 860' from pg_temp.test_centers() c;
-- The faith demo is the Faith community with the modules its pack switches on: here the one that matters, Gyan Path (the Learning path), so the
-- puja and learn areas are NOT closed by their module and only the kind can hide puja.
insert into app.center_module_grants (center_id, module_key, granted, reason)
select :c_fth::uuid, m, true, 'Test 860: the demo switches the learning path on' from unnest(app._module_chain('gyan_path')) m
on conflict (center_id, module_key) do nothing;
-- The live stream of a Jain Center sandbox and of the Faith community (published).
insert into app.content_items (id, center_id, kind, slug, title, media_url, status, published_at) values
  ('86000000-0000-4000-8000-0000000000e1', :c_jc,  'darshan_stream', 'acc860-darshan-jc',  'Live darshan 860', 'https://example.org/live860',  'published', now()),
  ('86000000-0000-4000-8000-0000000000e2', :c_fth, 'darshan_stream', 'acc860-darshan-fth', 'Live stream 860',  'https://example.org/live860b', 'published', now());

-- ══ A. The yardstick ════════════════════════════════════════════════════════
select pg_temp.assert(not exists (select 1 from pg_temp.test_centers() c
                                   where pg_temp.keys(pg_temp.answer(null, c.id, 'old')->'features')
                                         is distinct from (select string_agg(a.key, ',' order by a.key) from app.access_features a where app.catalog_shows(a.category_keys, c.cat))),
  'A · 0600''s body, kept here, answers for each kind exactly the areas its kind has, and leaves the others out');
select pg_temp.assert((select array_agg(key order by key) from app.access_features where not app.catalog_shows(category_keys, 'faith_other')) = array['darshan', 'puja', 'timings']
                      and (select array_agg(key order by key) from app.access_features where not app.catalog_shows(category_keys, 'chamber_of_commerce')) = array['darshan', 'learn', 'puja', 'timings']
                      and (select array_agg(key order by key) from app.access_features where not app.catalog_shows(category_keys, 'nonprofit_secular')) = array['darshan', 'learn', 'puja', 'timings']
                      and (select count(*) from app.access_features where not app.catalog_shows(category_keys, 'jain_center')) = 0
                      and (select count(*) from app.access_features) >= 8,
  'A · the catalog: a Jain Center has every area; a faith community lacks darshan, puja and timings; a chamber and the neutral kind also lack learn');

-- ══ B. A Jain Center: identical, text for text ══════════════════════════════
select pg_temp.assert(pg_temp.jain_differences() = '',
  'B · JSH and a Jain Center sandbox: the full answer is identical, character for character, for a guest, a stranger, a member and an administrator (differences: '
  || pg_temp.jain_differences() || ')');
select pg_temp.assert(pg_temp.answer(null, :jsh, 'new')->'features'->'darshan' = '{"allowed": true, "reason": null, "min_level": {"key": "public", "label": "Public", "rank": 0}}'::jsonb
                      and pg_temp.answer(null, :jsh, 'new')->'features'->'puja'->>'allowed' = 'true'
                      and pg_temp.answer(null, :jsh, 'new')->'features'->'timings'->>'allowed' = 'true'
                      and pg_temp.answer(null, :jsh, 'new')->'features'->'listen'->>'reason' = 'sign_in'
                      and pg_temp.answer(pg_temp.uid(1, 1), :jsh, 'new')->'features'->'listen'->>'allowed' = 'true',
  'B · and in words: a guest at JSH may use darshan, puja and timings; listen asks them to sign in; a member may use it');
-- The community's own choices and switches still work the way they did: darshan closed to members, Gyan Path switched off.
savepoint s860_choices;
insert into app.center_feature_access (center_id, feature_key, level_key, reason) values (:c_jc, 'darshan', 'community', 'test 860');
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c_jc, 'gyan_path', false, 'test 860');
select pg_temp.assert(pg_temp.jain_differences() = ''
                      and pg_temp.answer(null, :c_jc, 'new')->'features'->'darshan' = '{"allowed": false, "reason": "sign_in", "min_level": {"key": "community", "label": "Community member", "rank": 10}}'::jsonb
                      and pg_temp.answer(null, :c_jc, 'new')->'features'->'puja'->>'reason' = 'module_off',
  'B · a Jain Center that closed darshan to members and switched Gyan Path off: still the same answer as 0600 gave (sign_in for darshan, module_off for puja)');
rollback to savepoint s860_choices;

-- ══ C. Every kind, four callers ═════════════════════════════════════════════
select pg_temp.assert(pg_temp.all_problems() = '',
  'C · for all eight communities (every kind) and four callers each: areas the kind has are unchanged, areas it does not have are {allowed false, module_off}, nothing else differs, nothing became allowed'
  || case when pg_temp.all_problems() = '' then '' else E' (' || pg_temp.all_problems() || ')' end);
select pg_temp.assert(not exists (select 1 from app.organization_categories k where k.key <> all (select cat from pg_temp.test_centers()))
                      and (select count(*) from pg_temp.test_centers()) = 8,
  'C · and those communities cover every kind the platform has (Jain Center twice: JSH and a sandbox)');

-- ══ D. The faith demo and a chamber, in plain words ═════════════════════════
select pg_temp.assert(pg_temp.answer(null, :c_fth, 'new')->'features'->'darshan'  = '{"allowed": false, "reason": "module_off", "min_level": {"key": "public", "label": "Public", "rank": 0}}'::jsonb
                      and pg_temp.answer(null, :c_fth, 'new')->'features'->'puja'    = '{"allowed": false, "reason": "module_off", "min_level": {"key": "public", "label": "Public", "rank": 0}}'::jsonb
                      and pg_temp.answer(null, :c_fth, 'new')->'features'->'timings' = '{"allowed": false, "reason": "module_off", "min_level": {"key": "public", "label": "Public", "rank": 0}}'::jsonb,
  'D · the Faith community, for a guest: darshan, puja and timings are not allowed, module_off (they were not in the answer, which the app read as allowed)');
select pg_temp.assert(app.module_enabled(:c_fth, 'gyan_path')
                      and pg_temp.answer(pg_temp.uid(1, 6), :c_fth, 'new')->'features'->'puja'->>'allowed' = 'false'
                      and pg_temp.answer(pg_temp.uid(1, 6), :c_fth, 'new')->'features'->'puja'->>'reason' = 'module_off'
                      and pg_temp.answer(pg_temp.uid(1, 6), :c_fth, 'new')->'features'->'darshan'->>'allowed' = 'false'
                      and pg_temp.answer(pg_temp.uid(1, 6), :c_fth, 'new')->'features'->'timings'->>'allowed' = 'false',
  'D · a member of the Faith community whose Gyan Path is on (as in the demo): puja is still not allowed, because its kind does not have it, not because of the module');
select pg_temp.assert(pg_temp.answer(pg_temp.uid(1, 6), :c_fth, 'new')->'features'->'learn' = '{"allowed": true, "reason": null, "min_level": {"key": "community", "label": "Community member", "rank": 10}}'::jsonb
                      and pg_temp.answer(null, :c_fth, 'new')->'features'->'learn'->>'reason' = 'sign_in'
                      and (pg_temp.answer(pg_temp.uid(1, 6), :c_fth, 'new')->'features'->'guide'->>'allowed')::boolean
                      and (pg_temp.answer(pg_temp.uid(1, 6), :c_fth, 'new')->'features'->'listen'->>'allowed')::boolean
                      and (pg_temp.answer(pg_temp.uid(1, 6), :c_fth, 'new')->'features'->'look'->>'allowed')::boolean
                      and pg_temp.answer(pg_temp.uid(1, 6), :c_fth, 'new')->'features'->'niva'->>'reason' = 'module_off',
  'D · and what the Faith community does have is as before: learn (a member may, a guest signs in), the guide, listen and look are allowed, Ask Niva is off until Weaver switches it on');
select pg_temp.assert(pg_temp.answer(pg_temp.uid(1, 7), :c_chm, 'new')->'features'->'learn'->>'allowed' = 'false'
                      and pg_temp.answer(pg_temp.uid(1, 7), :c_chm, 'new')->'features'->'learn'->>'reason' = 'module_off'
                      and pg_temp.answer(pg_temp.uid(1, 7), :c_chm, 'new')->'features'->'darshan'->>'reason' = 'module_off'
                      and (pg_temp.answer(pg_temp.uid(1, 7), :c_chm, 'new')->'features'->'guide'->>'allowed')::boolean
                      and pg_temp.answer(pg_temp.uid(1, 7), :c_chm, 'new')->'features'->'puja'->>'reason' = 'module_off'
                      and pg_temp.answer(pg_temp.uid(1, 7), :c_chm, 'new')->'features'->'timings'->>'reason' = 'module_off'
                      and (pg_temp.answer(pg_temp.uid(1, 7), :c_chm, 'new')->'features'->'listen'->>'allowed')::boolean
                      and (pg_temp.answer(pg_temp.uid(1, 7), :c_chm, 'new')->'features'->'look'->>'allowed')::boolean,
  'D · a chamber''s member: darshan, puja, timings and learn are module_off; the guide, listen and look are allowed');
select pg_temp.assert(pg_temp.answer(null, :c_npo, 'new')->'features'->'timings'->>'reason' = 'module_off'
                      and pg_temp.answer(null, :c_npo, 'new')->'features'->'darshan'->>'reason' = 'module_off'
                      and pg_temp.answer(null, :c_npo, 'new')->'features'->'puja'->>'reason' = 'module_off'
                      and (pg_temp.answer(null, :c_npo, 'new')->'features'->'guide'->>'allowed')::boolean
                      and pg_temp.answer(null, :c_npo, 'new')->'features'->'listen'->>'reason' = 'sign_in',
  'D · the neutral kind, for a guest: the guide is allowed, listen asks them to sign in, darshan, puja and timings are module_off');

-- ══ E. Staff and permissions are unchanged ══════════════════════════════════
select pg_temp.assert(not pg_temp.can_as(null, :c_fth, 'darshan') and not pg_temp.can_as(pg_temp.uid(1, 6), :c_fth, 'darshan')
                      and not pg_temp.can_as(pg_temp.uid(2, 6), :c_fth, 'puja') and not pg_temp.can_as(pg_temp.uid(2, 6), :c_fth, 'timings')
                      and pg_temp.can_as(pg_temp.uid(1, 6), :c_fth, 'guide') and pg_temp.can_as(pg_temp.uid(1, 6), :c_fth, 'learn')
                      and pg_temp.can_as(null, :jsh, 'darshan') and pg_temp.can_as(null, :jsh, 'puja') and pg_temp.can_as(null, :jsh, 'timings'),
  'E · can_use_feature is as before (the live darshan policy calls it): closed for a kind without the area, even for an administrator; open at JSH');
select pg_temp.assert(not exists (select 1 from pg_temp.test_centers() c
                                   where pg_temp.settings_as(pg_temp.uid(2, c.n), c.id)
                                         is distinct from (select string_agg(a.key, ',' order by a.key) from app.access_features a where app.catalog_shows(a.category_keys, c.cat)))
                      and pg_temp.settings_as(pg_temp.uid(2, 6), :c_fth) = 'guide,learn,listen,look,niva'
                      and pg_temp.settings_as(pg_temp.uid(2, 7), :c_chm) = 'guide,listen,look,niva',
  'E · Settings > Access levels still lists only the areas the kind has (a faith community: guide, learn, listen, look, Niva; a chamber: no learn) and a Jain Center all of them');
set role authenticated;
select pg_temp.claims(pg_temp.uid(1, 6));
select pg_temp.assert_raises(format($$select app.access_settings(%L::uuid)$$, :c_fth), 'settings.manage',
  'E · a member of a community still cannot read Settings > Access levels');
reset role;
select pg_temp.no_claims();
-- The same administrator, the same member, the same stranger and guest are at the same levels as before (the answer's level is compared in C; here in words).
select pg_temp.assert(pg_temp.answer(null, :c_fth, 'new')->'level'->>'key' = 'public'
                      and pg_temp.answer(pg_temp.uid(3, 1), :c_fth, 'new')->'level'->>'key' = 'public'
                      and pg_temp.answer(pg_temp.uid(3, 1), :c_fth, 'new')->>'signed_in' = 'true'
                      and pg_temp.answer(pg_temp.uid(1, 6), :c_fth, 'new')->'level'->>'key' = 'community'
                      and pg_temp.answer(pg_temp.uid(2, 6), :c_fth, 'new')->'level'->>'key' = 'community',
  'E · the levels of the callers are unchanged: a guest and a stranger are public, a member and an administrator are community members');

-- ══ F. Row level security is unchanged ══════════════════════════════════════
select pg_temp.assert(pg_temp.seen_as(null) = 'darshan-jc' and pg_temp.seen_as(pg_temp.uid(3, 1)) = 'darshan-jc',
  'F · a guest and a stranger read the live stream of a Jain Center (public by default) and still not that of a kind without darshan');
select pg_temp.assert(pg_temp.seen_as(pg_temp.uid(1, 6)) = 'darshan-jc' and pg_temp.seen_as(pg_temp.uid(1, 2)) = 'darshan-jc',
  'F · a member of the Faith community still does not read its stream (members lost the blanket read in 0586, and the kind does not have the area); the Jain Center''s stream is public');
select pg_temp.assert(exists (select 1 from pg_policy p where p.polrelid = 'app.content_items'::regclass and p.polname = 'content_darshan_feature'
                                and pg_get_expr(p.polqual, p.polrelid) like '%can_use_feature%'),
  'F · the live darshan policy is still the one that asks can_use_feature');

-- ══ G. Errors and the function itself ═══════════════════════════════════════
set role anon;
select pg_temp.assert_raises($$select app.feature_access_for_me('86000000-0000-4000-8000-0000000000ff')$$, 'That community was not found.', 'G · an unknown community is "not found"');
select pg_temp.assert_raises($$select app.feature_access_for_me(null)$$, 'That community was not found.', 'G · so is no community');
reset role;
update app.centers set status = 'suspended' where id = :c_swm;
set role anon;
select pg_temp.assert_raises(format($$select app.feature_access_for_me(%L::uuid)$$, :c_swm), 'That community was not found.', 'G · a suspended community is "not found" for a guest');
reset role;
set role authenticated;
select pg_temp.claims(pg_temp.uid(3, 1));
select pg_temp.assert_raises(format($$select app.feature_access_for_me(%L::uuid)$$, :c_swm), 'That community was not found.', 'G · and for a stranger');
reset role;
select pg_temp.no_claims();
select pg_temp.assert(pg_temp.answer(pg_temp.uid(1, 3), :c_swm, 'new') ? 'features' and pg_temp.answer(pg_temp.uid(1, 3), :c_swm, 'new')->'features'->'darshan'->>'reason' = 'module_off',
  'G · a member of that community still gets the answer (as before: its own people may ask)');
select pg_temp.assert(has_function_privilege('anon', 'app.feature_access_for_me(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.feature_access_for_me(uuid)', 'execute')
                      and has_function_privilege('service_role', 'app.feature_access_for_me(uuid)', 'execute'),
  'G · the function is still callable by a guest (anon), a signed-in person and the service role');
select pg_temp.assert((select p.prosecdef and p.provolatile = 's' and p.prorettype = 'jsonb'::regtype
                              and exists (select 1 from unnest(p.proconfig) as g(setting) where g.setting ~ '^search_path=app, *public, *extensions$')
                         from pg_proc p where p.oid = 'app.feature_access_for_me(uuid)'::regprocedure),
  'G · still security definer, stable, returning jsonb, with the search path pinned to app, public, extensions (0019)');
select pg_temp.assert(not has_function_privilege('anon', 'app.access_settings(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.access_settings(uuid)', 'execute')
                      and has_function_privilege('anon', 'app.can_use_feature(uuid,text)', 'execute'),
  'G · who may call the neighbours is as before: can_use_feature for guests, access_settings for signed-in people only');

-- ══ H. The member app's one read ════════════════════════════════════════════
select pg_temp.assert(app.member_experience(:c_fth)->'access' = app.feature_access_for_me(:c_fth)
                      and pg_temp.keys(app.member_experience(:c_fth)->'access'->'features') = 'darshan,guide,learn,listen,look,niva,puja,timings'
                      and app.member_experience(:c_fth)->'access'->'features'->'puja'->>'reason' = 'module_off'
                      and app.member_experience(:c_chm)->'access' = app.feature_access_for_me(:c_chm),
  'H · member_experience carries the same answer for a faith community and a chamber: all eight areas, the three Jain ones module_off');
select pg_temp.assert((app.member_experience(:jsh)->'access')::text = pg_temp.access_0600(:jsh)::text
                      and (app.member_experience(:c_jc)->'access')::text = pg_temp.access_0600(:c_jc)::text,
  'H · and for a Jain Center it is exactly 0600''s answer, so its stamp (a hash of the whole read) does not change');

rollback;
