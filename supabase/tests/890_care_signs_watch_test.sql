-- 0890 (DonorDelight, Today groups, docs/DONORDELIGHT.md sections 9 and 12): the shortlist of households that may read Cooling or At risk.
--   A. Who is on it: gave last year and nothing since (first), gave fewer times than the year before, no gift for six months; not those who
--      gave as often as before, not those who never gave, not those who gave only long ago.
--   B. Who may ask: care.view every household, care.own only theirs, nobody else (platform admins included).
--   C. No amount, only households of the community, giving off answers giving_off.
--   D. Every read is logged without names.
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
create or replace function pg_temp.ids(j jsonb) returns uuid[] language sql as $$
  select coalesce(array_agg((e -> 'household' ->> 'id')::uuid order by ord), '{}') from jsonb_array_elements(j -> 'rows') with ordinality t(e, ord)
$$;

\set c1 '''89000000-0000-4000-8000-0000000000c1'''
\set owner '''89000000-0000-4000-8000-000000000001'''
\set plat '''89000000-0000-4000-8000-000000000002'''
\set lead '''89000000-0000-4000-8000-000000000003'''
\set rel '''89000000-0000-4000-8000-000000000004'''
\set clerk '''89000000-0000-4000-8000-000000000005'''
\set ha '''89000000-0000-4000-8000-0000000000b1'''
\set hb '''89000000-0000-4000-8000-0000000000b2'''
\set hc '''89000000-0000-4000-8000-0000000000b3'''
\set hd '''89000000-0000-4000-8000-0000000000b4'''
\set he '''89000000-0000-4000-8000-0000000000b5'''
\set hf '''89000000-0000-4000-8000-0000000000b6'''
\set hg '''89000000-0000-4000-8000-0000000000b7'''
\set pa '''89000000-0000-4000-8000-0000000000a1'''
\set pb '''89000000-0000-4000-8000-0000000000a2'''
\set pc '''89000000-0000-4000-8000-0000000000a3'''
\set pd '''89000000-0000-4000-8000-0000000000a4'''
\set pe '''89000000-0000-4000-8000-0000000000a5'''
\set pf '''89000000-0000-4000-8000-0000000000a6'''
\set pg '''89000000-0000-4000-8000-0000000000a7'''

insert into auth.users (id, email) values
  (:owner, 'owner890@c1.test'), (:plat, 'plat890@weaver.test'), (:lead, 'lead890@c1.test'), (:rel, 'rel890@c1.test'), (:clerk, 'clerk890@c1.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone, category_key, environment) values
  (:c1, 'care890', 'Grace Church 890', 'G890', 'TX', 'active', 'America/Chicago', 'church', 'sandbox');
insert into app.center_owners (center_id, user_id) values (:c1, :owner);
insert into app.center_module_grants (center_id, module_key, granted, reason) values (:c1, 'care', true, 'Test 890: DonorDelight');
insert into app.roles (key, tier, name, default_scope, description, permissions) values
  ('people_viewer_890', 'center', 'People viewer 890', 'center', 'Test 890', '["people.view"]');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:c1, :plat, 'platform_owner', 'platform', 'Test 890: the platform owner role (holds "*")'),
  (:c1, :lead, 'care_lead', 'center', 'Test 890'), (:c1, :rel, 'relationship_owner', 'center', 'Test 890'),
  (:c1, :clerk, 'people_viewer_890', 'center', 'Test 890');
insert into app.households (id, center_id, display_name) values
  (:ha, :c1, 'Alpha890, Ama'), (:hb, :c1, 'Bravo890, Bo'), (:hc, :c1, 'Charlie890, Cy'), (:hd, :c1, 'Delta890, Di'),
  (:he, :c1, 'Echo890, Ed'), (:hf, :c1, 'Fox890, Fay'), (:hg, :c1, 'Golf890, Gil');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (:pa, :c1, 'Ama', 'Alpha890', date '1980-01-01'), (:pb, :c1, 'Bo', 'Bravo890', date '1975-02-02'), (:pc, :c1, 'Cy', 'Charlie890', date '1976-03-03'),
  (:pd, :c1, 'Di', 'Delta890', date '1970-04-04'), (:pe, :c1, 'Ed', 'Echo890', date '1971-05-05'), (:pf, :c1, 'Fay', 'Fox890', date '1972-06-06'),
  (:pg, :c1, 'Gil', 'Golf890', date '1973-07-07');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:ha, :pa, :c1, 'primary', true), (:hb, :pb, :c1, 'primary', true), (:hc, :pc, :c1, 'primary', true), (:hd, :pd, :c1, 'primary', true),
  (:he, :pe, :c1, 'primary', true), (:hf, :pf, :c1, 'primary', true), (:hg, :pg, :c1, 'primary', true);
insert into app.care_owners (household_id, center_id, owner_user_id, assigned_by) values (:ha, :c1, :rel, :lead), (:hc, :c1, :rel, :lead);

create or replace function pg_temp.gift(p_h uuid, p_person uuid, p_days int, p_n int) returns void language sql as $$
  insert into app.payments (center_id, household_id, payer_person_id, amount_cents, method, status, provider, received_on, created_at, receipt_number)
  values ('89000000-0000-4000-8000-0000000000c1', p_h, p_person, 10000 + p_n, 'check', 'captured', 'offline', (now() at time zone 'America/Chicago')::date - p_days, now() - make_interval(days => p_days), 'R-890-' || p_n)
$$;
-- Alpha: two the year before, none since (At risk). Bravo: one in the last year, three the year before (Cooling). Charlie: two and two (as often
-- as before, recent). Delta: one gift 200 days ago and none before (no gift for six months). Echo: none. Fox: two, then one (more than before).
-- Golf: one gift 800 days ago (older than two years).
select pg_temp.gift(:ha, :pa, 400, 1), pg_temp.gift(:ha, :pa, 500, 2),
       pg_temp.gift(:hb, :pb, 30, 3), pg_temp.gift(:hb, :pb, 400, 4), pg_temp.gift(:hb, :pb, 450, 5), pg_temp.gift(:hb, :pb, 600, 6),
       pg_temp.gift(:hc, :pc, 20, 7), pg_temp.gift(:hc, :pc, 100, 8), pg_temp.gift(:hc, :pc, 400, 9), pg_temp.gift(:hc, :pc, 500, 10),
       pg_temp.gift(:hd, :pd, 200, 11),
       pg_temp.gift(:hf, :pf, 10, 12), pg_temp.gift(:hf, :pf, 90, 13), pg_temp.gift(:hf, :pf, 420, 14),
       pg_temp.gift(:hg, :pg, 800, 15);
select pg_temp.assert(app.module_enabled(:c1, 'care') and app.module_enabled(:c1, 'giving'), 'Fixtures · DonorDelight and Giving are on');

-- ══ A. Who is on the shortlist ═══════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:lead);
select app.care_signs_watch(:c1) as w \gset
select pg_temp.assert((:'w'::jsonb ->> 'state') = 'ok' and (:'w'::jsonb ->> 'total')::int = 3, 'A · three households may be cooling');
select pg_temp.assert(pg_temp.ids(:'w'::jsonb) = array[:ha, :hd, :hb]::uuid[],
  'A · gave last year and nothing since comes first, then the longest quiet; not Charlie, Echo, Fox or Golf');
select pg_temp.assert((:'w'::jsonb -> 'rows' -> 0 -> 'household' ->> 'name') = 'Alpha890, Ama' and (:'w'::jsonb -> 'rows' -> 0 ->> 'owner') is not null
                      and (:'w'::jsonb -> 'rows' -> 1 -> 'owner') = 'null'::jsonb,
  'A · each household comes as its card, with its relationship owner (or none)');
select pg_temp.assert(jsonb_array_length(app.care_signs_watch(:c1, 2) -> 'rows') = 2 and (app.care_signs_watch(:c1, 2) ->> 'total')::int = 3,
  'A · the limit cuts the list, the total stays');

-- ══ B. Who may ask ═══════════════════════════════════════════════════════════
select pg_temp.claims(:rel);
select pg_temp.assert(pg_temp.ids(app.care_signs_watch(:c1)) = array[:ha]::uuid[] and (app.care_signs_watch(:c1) ->> 'total')::int = 1,
  'B · a relationship owner sees only the households they own');
select pg_temp.claims(:clerk);
select pg_temp.assert_raises($$select app.care_signs_watch('89000000-0000-4000-8000-0000000000c1')$$, 'don''t have access', 'B · people.view alone sees nothing');
select pg_temp.claims(:plat);
select pg_temp.assert_raises($$select app.care_signs_watch('89000000-0000-4000-8000-0000000000c1')$$, 'don''t have access', 'B · a platform admin sees nothing');
select set_config('request.jwt.claims', '', true);
select pg_temp.assert_raises($$select app.care_signs_watch('89000000-0000-4000-8000-0000000000c1')$$, 'sign in', 'B · signed out is refused');

-- ══ C. Shape ═════════════════════════════════════════════════════════════════
select pg_temp.claims(:lead);
select pg_temp.assert(not exists (select 1 from jsonb_path_query(app.care_signs_watch(:c1), '$.**') v where jsonb_typeof(v) = 'string' and v #>> '{}' ~* 'R-890'),
  'C · no payment, receipt or amount is returned');
select pg_temp.assert(app.care_signs_watch(:c1)::text !~* '"[a-z_]*(amount|cents)[a-z_]*"',
  'C · there is no amount key');
reset role;
insert into app.center_module_grants (center_id, module_key, granted, reason) values (:c1, 'giving', false, 'Test 890: Giving off')
  on conflict (center_id, module_key) do update set granted = false;
set role authenticated;
select pg_temp.claims(:lead);
select pg_temp.assert((app.care_signs_watch(:c1) ->> 'state') = 'giving_off' and jsonb_array_length(app.care_signs_watch(:c1) -> 'rows') = 0,
  'C · with Giving off there are no gifts to compare');

-- ══ D. Logged ════════════════════════════════════════════════════════════════
reset role;
select pg_temp.assert((select count(*) from app.audit_log where action = 'care.read' and (after ->> 'what') = 'signs_watch') >= 3
                      and not exists (select 1 from app.audit_log where action = 'care.read' and after::text ~ '890'),
  'D · every read is logged (who, when, what, how many) and names no one');
rollback;
