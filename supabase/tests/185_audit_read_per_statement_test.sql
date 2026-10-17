-- 0788: reading the audit log as a member with no audit permission answers at once (empty), not by timing out.
--   A. The shape: the policy, the two helpers (closed to anon), the plan puts the caller's answer in front of the scan
--   B. Nobody who holds no audit permission reads a row: a community member, a role without audit.view, a lapsed privacy
--      officer, a sign-in with no community at all
--   C. Who reads what is unchanged: a privacy officer (audit.view) reads the ordinary entries of their own community only;
--      an owner also reads the WeCare and CatchTheMatch entries; a care or matching lead reads only that product's entries;
--      a platform admin reads every ordinary entry (those with no community too) and none of the private ones
--   D. The permission checks run once per statement, not once per row (counted with track_functions)
-- Everything runs in one transaction that is rolled back.
\set ON_ERROR_STOP 1
begin;
set local track_functions = 'all';
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.claims(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('request.headers', '', true);
end $$;
create or replace function pg_temp.no_claims() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;
-- How many times the three permission checks the old policy called for every row have run in this transaction.
create or replace function pg_temp.perm_calls() returns bigint language sql as $$
  select coalesce(pg_stat_get_xact_function_calls('app.has_permission(uuid,text)'::regprocedure), 0)
       + coalesce(pg_stat_get_xact_function_calls('app.is_center_owner(uuid)'::regprocedure), 0)
       + coalesce(pg_stat_get_xact_function_calls('app.org_private_can(uuid,text)'::regprocedure), 0)
$$;
-- The plan of a statement, as text.
create or replace function pg_temp.plan_of(q text) returns text language plpgsql as $$
declare r text; res text := '';
begin
  for r in execute 'explain (costs off) ' || q loop res := res || r || E'\n'; end loop;
  return res;
end $$;
-- What one signed-in user reads of the whole log, and how many permission checks that took.
create or replace function pg_temp.probe(p_user uuid, p_c1 uuid, p_c2 uuid,
  out total bigint, out c1_ord bigint, out c1_care bigint, out c1_match bigint, out c2_ord bigint, out c2_priv bigint,
  out nocenter bigint, out checks bigint, out gate int)
language plpgsql as $$
declare c0 bigint;
begin
  perform pg_temp.claims(p_user);
  gate := case when app._audit_can_read_any() then 1 else 0 end;
  c0 := pg_temp.perm_calls();
  select count(*),
         count(*) filter (where center_id = p_c1 and coalesce(module, '') not in ('care', 'matching')),
         count(*) filter (where center_id = p_c1 and module = 'care'),
         count(*) filter (where center_id = p_c1 and module = 'matching'),
         count(*) filter (where center_id = p_c2 and coalesce(module, '') not in ('care', 'matching')),
         count(*) filter (where center_id = p_c2 and module in ('care', 'matching')),
         count(*) filter (where center_id is null)
    into total, c1_ord, c1_care, c1_match, c2_ord, c2_priv, nocenter
    from app.audit_log;
  checks := pg_temp.perm_calls() - c0;
end $$;

\set c1 '''18500000-0000-4000-8000-0000000000c1'''
\set c2 '''18500000-0000-4000-8000-0000000000c2'''
\set owner1 '''18500000-0000-4000-8000-000000000001'''
\set priv1 '''18500000-0000-4000-8000-000000000002'''
\set member '''18500000-0000-4000-8000-000000000003'''
\set plat '''18500000-0000-4000-8000-000000000004'''
\set carelead '''18500000-0000-4000-8000-000000000005'''
\set matchlead '''18500000-0000-4000-8000-000000000006'''
\set coord '''18500000-0000-4000-8000-000000000007'''
\set priv2 '''18500000-0000-4000-8000-000000000008'''
\set nobody '''18500000-0000-4000-8000-000000000009'''
\set owner2 '''18500000-0000-4000-8000-00000000000a'''
\set both '''18500000-0000-4000-8000-00000000000b'''
\set lapsed '''18500000-0000-4000-8000-00000000000c'''
\set pm '''18500000-0000-4000-8000-0000000000a1'''
\set pp '''18500000-0000-4000-8000-0000000000a2'''
\set pc '''18500000-0000-4000-8000-0000000000a3'''

-- ══ Fixtures ═════════════════════════════════════════════════════════════════
select pg_temp.no_claims();
insert into auth.users (id, email) values
  (:owner1, 'owner185@c1.test'), (:priv1, 'priv185@c1.test'), (:member, 'member185@c1.test'), (:plat, 'plat185@weaver.test'),
  (:carelead, 'care185@c1.test'), (:matchlead, 'match185@c1.test'), (:coord, 'coord185@c1.test'), (:priv2, 'priv185@c2.test'),
  (:nobody, 'nobody185@nowhere.test'), (:owner2, 'owner185@c2.test'), (:both, 'both185@c1.test'), (:lapsed, 'lapsed185@c1.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true) on conflict (user_id) do update set is_platform_admin = true;
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:c1, 'au185', 'Audit Temple 185', 'A185', 'TX', 'active', 'America/Chicago'),
  (:c2, 'au185b', 'Other Audit Temple 185', 'B185', 'TX', 'active', 'America/Chicago');
insert into app.center_owners (center_id, user_id) values (:c1, :owner1), (:c2, :owner2);
-- WeCare and CatchTheMatch are on for the first community (the same grant test 163 uses).
insert into app.center_module_grants (center_id, module_key, granted, reason) values
  (:c1, 'care', true, 'Test 185: WeCare'), (:c1, 'matching', true, 'Test 185: CatchTheMatch');
insert into app.people (id, center_id, first_name, last_name) values
  (:pm, :c1, 'Mina', 'Member185'), (:pp, :c1, 'Pia', 'Privacy185'), (:pc, :c1, 'Cory', 'Coordinator185');
insert into app.center_users (center_id, user_id, person_id) values (:c1, :member, :pm), (:c1, :priv1, :pp), (:c1, :coord, :pc);
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:c1, :member, 'community_member', 'center', 'Test 185: no permissions'),
  (:c1, :coord, 'membership_coordinator', 'center', 'Test 185: people.view and people.manage, not audit.view'),
  (:c1, :priv1, 'privacy_officer', 'center', 'Test 185'),
  (:c2, :priv2, 'privacy_officer', 'center', 'Test 185: the other community'),
  (:c1, :carelead, 'care_lead', 'center', 'Test 185'),
  (:c1, :matchlead, 'matching_lead', 'center', 'Test 185'),
  (:c1, :both, 'privacy_officer', 'center', 'Test 185'), (:c1, :both, 'care_lead', 'center', 'Test 185');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason, starts_at, ends_at) values
  (:c1, :lapsed, 'privacy_officer', 'center', 'Test 185: ended yesterday', now() - interval '30 days', now() - interval '1 day');

-- A log big enough that a call per row would show: ordinary entries of both communities (half of them with no module),
-- entries that belong to no community, and the private ones of each product.
insert into app.audit_log (center_id, action, record_table, record_id, module)
select :c1::uuid, 'test185.bulk', 'people', gen_random_uuid()::text, case when n % 2 = 0 then 'people' end from generate_series(1, 300) n;
insert into app.audit_log (center_id, action, record_table, record_id, module)
select :c2::uuid, 'test185.bulk', 'people', gen_random_uuid()::text, case when n % 2 = 0 then 'people' end from generate_series(1, 300) n;
insert into app.audit_log (center_id, action, record_table, record_id, module)
select null::uuid, 'test185.bulk', 'roles', gen_random_uuid()::text, null from generate_series(1, 50) n;
insert into app.audit_log (center_id, action, record_table, record_id, module)
select :c1::uuid, 'care.read', 'care_notes', gen_random_uuid()::text, 'care' from generate_series(1, 3) n;
insert into app.audit_log (center_id, action, record_table, record_id, module)
select :c1::uuid, 'matching.read', 'person_match_employers', gen_random_uuid()::text, 'matching' from generate_series(1, 2) n;
insert into app.audit_log (center_id, action, record_table, record_id, module)
select :c2::uuid, 'care.read', 'care_notes', gen_random_uuid()::text, 'care' from generate_series(1, 2) n;
insert into app.audit_log (center_id, action, record_table, record_id, module)
select :c2::uuid, 'matching.read', 'person_match_employers', gen_random_uuid()::text, 'matching';

-- What each reader should see, counted by the database owner (who is not held to the policy).
select count(*) filter (where center_id = :c1 and coalesce(module, '') not in ('care', 'matching')) as e_c1_ord,
       count(*) filter (where center_id = :c1 and module = 'care') as e_c1_care,
       count(*) filter (where center_id = :c1 and module = 'matching') as e_c1_match,
       count(*) filter (where center_id = :c2 and coalesce(module, '') not in ('care', 'matching')) as e_c2_ord,
       count(*) filter (where center_id = :c2 and module in ('care', 'matching')) as e_c2_priv,
       count(*) filter (where coalesce(module, '') not in ('care', 'matching')) as e_ord_all,
       count(*) filter (where center_id is null and coalesce(module, '') not in ('care', 'matching')) as e_none
  from app.audit_log \gset
select pg_temp.assert(:e_c1_ord >= 300 and :e_c2_ord >= 300 and :e_none >= 50 and :e_c1_care >= 3 and :e_c1_match >= 2 and :e_c2_priv >= 3,
  'fixtures · a log of more than 650 entries across two communities, with private entries in both');

-- ══ A. The shape ═════════════════════════════════════════════════════════════
select pg_temp.assert((select count(*) from pg_policies
                        where schemaname = 'app' and tablename = 'audit_log' and policyname = 'audit_read'
                          and cmd = 'SELECT' and roles = array['authenticated']::name[]) = 1,
  'A · audit_read is a select policy for signed-in users');
select pg_temp.assert((select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=app, public, extensions%')
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname in ('_audit_read_centers', '_audit_can_read_any'))
                      and has_function_privilege('authenticated', 'app._audit_read_centers(text)', 'execute')
                      and has_function_privilege('authenticated', 'app._audit_can_read_any()', 'execute')
                      and not has_function_privilege('anon', 'app._audit_read_centers(text)', 'execute')
                      and not has_function_privilege('anon', 'app._audit_can_read_any()', 'execute'),
  'A · the two helpers run as the definer with the pinned search path, for signed-in callers only');
set role authenticated;
select pg_temp.claims(:member);
select pg_temp.plan_of('select id from app.audit_log') as p \gset
reset role;
select pg_temp.assert(:'p' like '%One-Time Filter%',
  'A · the caller''s answer sits in front of the scan (a one-time filter), so a reader of nothing never reads the table');

-- ══ B. No audit permission, no rows ══════════════════════════════════════════
set role authenticated;
select * from pg_temp.probe(:member, :c1, :c2) \gset mem_
select * from pg_temp.probe(:coord, :c1, :c2) \gset crd_
select * from pg_temp.probe(:lapsed, :c1, :c2) \gset lps_
select * from pg_temp.probe(:nobody, :c1, :c2) \gset nob_
reset role;
select pg_temp.assert(:mem_total = 0 and :mem_gate = 0 and :crd_total = 0 and :crd_gate = 0
                      and :lps_total = 0 and :lps_gate = 0 and :nob_total = 0 and :nob_gate = 0,
  'B · a community member, a membership coordinator (people.view, people.manage), a privacy officer whose grant ended and a sign-in with no community each read no entry');
set role authenticated;
select pg_temp.claims(:member);
select pg_temp.assert((select count(*) from app.audit_log where center_id = :c1) = 0
                      and (select count(*) from app.audit_log where id = (select max(id) from app.audit_log)) = 0
                      and not exists (select 1 from app.audit_log limit 1),
  'B · however the question is put (a community, one entry, any entry), the answer is empty and not an error');
reset role;

-- ══ C. Who reads what is unchanged ═══════════════════════════════════════════
set role authenticated;
select * from pg_temp.probe(:priv1, :c1, :c2) \gset pr1_
select * from pg_temp.probe(:priv2, :c1, :c2) \gset pr2_
select * from pg_temp.probe(:owner1, :c1, :c2) \gset ow1_
select * from pg_temp.probe(:owner2, :c1, :c2) \gset ow2_
select * from pg_temp.probe(:carelead, :c1, :c2) \gset cal_
select * from pg_temp.probe(:matchlead, :c1, :c2) \gset mal_
select * from pg_temp.probe(:both, :c1, :c2) \gset bth_
select * from pg_temp.probe(:plat, :c1, :c2) \gset plt_
reset role;
select pg_temp.assert(:pr1_gate = 1 and :pr1_total = :e_c1_ord and :pr1_c1_ord = :e_c1_ord
                      and :pr1_c1_care = 0 and :pr1_c1_match = 0 and :pr1_c2_ord = 0 and :pr1_c2_priv = 0 and :pr1_nocenter = 0,
  'C · a privacy officer (audit.view) reads every ordinary entry of their own community: not another community''s, not the ones with no community, not WeCare''s or CatchTheMatch''s');
select pg_temp.assert(:pr2_gate = 1 and :pr2_total = :e_c2_ord and :pr2_c2_ord = :e_c2_ord
                      and :pr2_c1_ord = 0 and :pr2_c1_care = 0 and :pr2_c1_match = 0 and :pr2_c2_priv = 0 and :pr2_nocenter = 0,
  'C · the other community''s privacy officer reads the other community''s ordinary entries and nothing of the first');
select pg_temp.assert(:ow1_gate = 1 and :ow1_total = :e_c1_ord + :e_c1_care + :e_c1_match
                      and :ow1_c1_ord = :e_c1_ord and :ow1_c1_care = :e_c1_care and :ow1_c1_match = :e_c1_match
                      and :ow1_c2_ord = 0 and :ow1_c2_priv = 0 and :ow1_nocenter = 0,
  'C · the owner reads every entry of their own community, WeCare''s and CatchTheMatch''s too, and nothing of another community');
select pg_temp.assert(:ow2_gate = 1 and :ow2_total = :e_c2_ord + :e_c2_priv and :ow2_c2_ord = :e_c2_ord and :ow2_c2_priv = :e_c2_priv
                      and :ow2_c1_ord = 0 and :ow2_c1_care = 0 and :ow2_c1_match = 0 and :ow2_nocenter = 0,
  'C · the other community''s owner reads that community''s entries, private ones included, and nothing of the first');
select pg_temp.assert(:cal_gate = 1 and :cal_total = :e_c1_care and :cal_c1_care = :e_c1_care and :cal_c1_ord = 0 and :cal_c1_match = 0
                      and :cal_c2_ord = 0 and :cal_c2_priv = 0 and :cal_nocenter = 0,
  'C · a WeCare lead (care.manage, no audit.view) reads WeCare''s entries and nothing else');
select pg_temp.assert(:mal_gate = 1 and :mal_total = :e_c1_match and :mal_c1_match = :e_c1_match and :mal_c1_ord = 0 and :mal_c1_care = 0
                      and :mal_c2_ord = 0 and :mal_c2_priv = 0 and :mal_nocenter = 0,
  'C · a CatchTheMatch lead (matching.manage, no audit.view) reads CatchTheMatch''s entries and nothing else');
select pg_temp.assert(:bth_gate = 1 and :bth_total = :e_c1_ord + :e_c1_care and :bth_c1_match = 0 and :bth_c2_ord = 0 and :bth_c2_priv = 0 and :bth_nocenter = 0,
  'C · audit.view plus WeCare reads the ordinary entries and WeCare''s, not CatchTheMatch''s');
select pg_temp.assert(:plt_gate = 1 and :plt_total = :e_ord_all
                      and :plt_c1_ord = :e_c1_ord and :plt_c2_ord = :e_c2_ord and :plt_nocenter = :e_none
                      and :plt_c1_care = 0 and :plt_c1_match = 0 and :plt_c2_priv = 0,
  'C · a platform admin reads every ordinary entry (those with no community too) and none of the WeCare or CatchTheMatch ones');

-- ══ D. Once per statement, not once per row ══════════════════════════════════
-- The control: with tracking on, a check that depends on the row is counted once per row.
select pg_temp.perm_calls() as ctl0 \gset
select count(*) as ctl from generate_series(1, 25) n where app.has_permission(:c1::uuid, 'control.' || n) is not null \gset
select pg_temp.assert(pg_temp.perm_calls() - :ctl0 >= 25,
  'D · (control) the call counter counts a check made for each of 25 rows');
-- The log has more than 650 entries. The old policy ran the checks for every one of them; now the answer is asked once.
select pg_temp.assert(:mem_checks < 20 and :crd_checks < 20 and :nob_checks < 20 and :lps_checks < 20
                      and :pr1_checks < 20 and :pr2_checks < 20 and :ow1_checks < 20 and :ow2_checks < 20
                      and :cal_checks < 20 and :mal_checks < 20 and :bth_checks < 20 and :plt_checks < 20,
  'D · reading the whole log runs the permission checks a handful of times for each reader, never once per entry');

rollback;
\echo 'PASS: reading the audit log asks the permission checks once per statement and changes no one access'
