-- 0757-0759: the organization's own data (docs/WECARE.md section 3, W2 and W8; docs/CATCH_THE_MATCH.md section 6 and C8).
--   A. The shape: the checks run as the definer with the pinned search path, have no platform-admin branch, the helpers
--      are private, three new roles hold the keys and no existing role does.
--   B. app.org_private_can: a platform admin gets false (even holding platform_owner's "*" and platform_support in the
--      community), the owner and a granted role get true, a role without the key gets false, a paused, ungranted or
--      dependency-off module gives false, an expired, pending or scoped grant counts for nothing, another community's role
--      counts for nothing, an unknown key is false. care_can levels; care_amounts_can needs giving.view too.
--   C. has_permission's backstop: private keys follow org_private_can; every other key is unchanged.
--   D. Giving a private role: only the owner or the product's manager, never to oneself, platform admins included; whole
--      community only; an update that widens is checked, an end is not; invitations follow the same rule. Each grant is
--      audited under its product and the owner is emailed.
--   E. W8: a support grant opens WeCare settings only when the owner names the area; never care records.
--   F. C8: the Weaver filing grant: who gives it, to whom, for how long; what it opens; ended when Weaver turns
--      CatchTheMatch off; expiry.
--   G. Reads logged; the audit log keeps care and matching entries from platform admins and from audit.view alone.
--   H. The employer for gift matching: adults only, with consent, by the person or from a paper form; who reads it; the
--      person removes it at once; people.employer is untouched.
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
create or replace function pg_temp.claims(p_user uuid, p_step_up boolean default true) returns void language plpgsql as $$
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

\set c1 '''16300000-0000-4000-8000-0000000000c1'''
\set c2 '''16300000-0000-4000-8000-0000000000c2'''
\set owner '''16300000-0000-4000-8000-000000000001'''
\set plat '''16300000-0000-4000-8000-000000000002'''
\set weaver '''16300000-0000-4000-8000-000000000003'''
\set carelead '''16300000-0000-4000-8000-000000000004'''
\set relowner '''16300000-0000-4000-8000-000000000005'''
\set treas '''16300000-0000-4000-8000-000000000006'''
\set cadmin '''16300000-0000-4000-8000-000000000007'''
\set member '''16300000-0000-4000-8000-000000000008'''
\set kid '''16300000-0000-4000-8000-000000000009'''
\set matchlead '''16300000-0000-4000-8000-00000000000a'''
\set carefin '''16300000-0000-4000-8000-00000000000b'''
\set c2owner '''16300000-0000-4000-8000-00000000000c'''
\set newbie '''16300000-0000-4000-8000-00000000000d'''
\set expired '''16300000-0000-4000-8000-00000000000e'''
\set scoped '''16300000-0000-4000-8000-00000000000f'''
\set pending '''16300000-0000-4000-8000-000000000010'''
\set h1 '''16300000-0000-4000-8000-0000000000b1'''
\set h2 '''16300000-0000-4000-8000-0000000000b2'''
\set pm '''16300000-0000-4000-8000-0000000000a1'''
\set pk '''16300000-0000-4000-8000-0000000000a2'''
\set pa '''16300000-0000-4000-8000-0000000000a3'''
\set pn '''16300000-0000-4000-8000-0000000000a4'''
\set teachgrant '''16300000-0000-4000-8000-0000000000d1'''

-- ══ A. The shape ═════════════════════════════════════════════════════════════
select pg_temp.assert((select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=app, public, extensions%')
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname in ('org_private_can', '_org_holds', '_org_private_module_on', 'care_can',
                              'care_amounts_can', 'matching_can', 'role_private_products', '_may_grant_private', 'role_grants_private_rule',
                              'staff_invitations_private_rule', 'role_grants_private_notice', 'log_private_audit', 'care_settings_can',
                              'set_support_grant_areas', 'grant_weaver_filing', 'end_weaver_filing', '_weaver_filing_live',
                              'log_private_read', 'audit_private_row', 'person_match_employers_check', 'my_match_employer',
                              'set_my_match_employer', 'remove_my_match_employer', 'record_match_employer', 'has_permission')),
  'A · every function of 0757-0759 (and has_permission) runs as the definer with the pinned search path');
select pg_temp.assert(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                   where n.nspname = 'app' and p.proname in ('org_private_can', '_org_holds', '_org_private_module_on',
                                         'care_can', 'care_amounts_can', 'matching_can', '_weaver_filing_live', 'care_settings_can',
                                         '_may_grant_private')
                                     and p.prosrc ilike '%is_platform_admin%'),
  'A · none of the checks has a platform-admin branch');
select pg_temp.assert(not has_function_privilege('authenticated', 'app._org_holds(uuid, uuid, text)', 'execute')
                      and not has_function_privilege('authenticated', 'app._may_grant_private(uuid, uuid, text[])', 'execute')
                      and not has_function_privilege('authenticated', 'app.log_private_audit(text, uuid, text, text, text, jsonb, text)', 'execute')
                      and has_function_privilege('authenticated', 'app.log_private_read(uuid, text, text, int)', 'execute')
                      and not has_function_privilege('authenticated', 'app._weaver_filing_live(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.org_private_can(uuid, text)', 'execute')
                      and not has_function_privilege('anon', 'app.org_private_can(uuid, text)', 'execute')
                      and has_function_privilege('authenticated', 'app.grant_weaver_filing(uuid, uuid, int, text)', 'execute')
                      and not has_function_privilege('anon', 'app.set_my_match_employer(uuid, text)', 'execute'),
  'A · the helpers that take a user or write the audit log are private; the checks and commands are for signed-in callers');
select pg_temp.assert((select permissions = '["care.view","care.manage"]'::jsonb and tier = 'center' from app.roles where key = 'care_lead')
                      and (select permissions = '["care.own"]'::jsonb from app.roles where key = 'relationship_owner')
                      and (select permissions = '["matching.view","matching.manage"]'::jsonb from app.roles where key = 'matching_lead')
                      and not exists (select 1 from app.roles r cross join lateral jsonb_array_elements_text(r.permissions) k
                                       where r.key not in ('care_lead', 'relationship_owner', 'matching_lead')
                                         and (k like 'care.%' or k like 'matching.%')),
  'A · three new roles hold the private keys; no other role holds any of them');
select pg_temp.assert(app.role_private_products('care_lead') = array['care'] and app.role_private_products('matching_lead') = array['matching']
                      and app.role_private_products('treasurer') = '{}' and app.role_private_products('platform_owner') = '{}'
                      and app.org_private_product('care.view') = 'care' and app.org_private_product('caretaker.view') is null,
  'A · which products a role opens (platform_owner''s "*" opens none: it is a platform-tier role)');
select pg_temp.assert(exists (select 1 from app.message_templates where center_id is null and key = 'private_access_granted' and channel = 'email'),
  'A · the owner''s email has a platform template');
select pg_temp.assert(exists (select 1 from app.module_tables where table_name = 'person_match_employers' and module_key = 'matching')
                      and exists (select 1 from app.module_tables where table_name = 'matching_filing_grants' and module_key is null)
                      and (select relrowsecurity from pg_class where oid = 'app.person_match_employers'::regclass)
                      and (select relrowsecurity from pg_class where oid = 'app.matching_filing_grants'::regclass)
                      and not has_table_privilege('authenticated', 'app.person_match_employers', 'insert')
                      and not has_table_privilege('authenticated', 'app.matching_filing_grants', 'insert'),
  'A · the two tables have RLS, nobody writes them directly; the employers belong to CatchTheMatch, the filing grants to the platform');

-- ══ Fixtures ═════════════════════════════════════════════════════════════════
insert into auth.users (id, email) values
  (:owner, 'owner163@c1.test'), (:plat, 'plat163@weaver.test'), (:weaver, 'filer163@weaver.test'),
  (:carelead, 'carelead163@c1.test'), (:relowner, 'relowner163@c1.test'), (:treas, 'treas163@c1.test'),
  (:cadmin, 'cadmin163@c1.test'), (:member, 'member163@c1.test'), (:kid, 'kid163@c1.test'), (:matchlead, 'match163@c1.test'),
  (:carefin, 'carefin163@c1.test'), (:c2owner, 'owner163@c2.test'), (:newbie, 'newbie163@c1.test'),
  (:expired, 'expired163@c1.test'), (:scoped, 'scoped163@c1.test'), (:pending, 'pending163@c1.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true), (:weaver, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:c1, 'pv163', 'Private Temple 163', 'P163', 'TX', 'active', 'America/Chicago'),
  (:c2, 'pv163b', 'Other Temple 163', 'O163', 'TX', 'active', 'America/Chicago');
insert into app.center_owners (center_id, user_id) values (:c1, :owner), (:c2, :c2owner);
-- Weaver grants both products to the first community only (0740's table; the kinds start them off, 0750).
insert into app.center_module_grants (center_id, module_key, granted, reason) values
  (:c1, 'care', true, 'Test 163: WeCare'), (:c1, 'matching', true, 'Test 163: CatchTheMatch');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:c1, :plat, 'platform_owner', 'platform', 'Test 163: the platform owner role (holds "*")'),
  (:c1, :weaver, 'platform_support', 'center', 'Test 163: platform support'),
  (:c1, :carelead, 'care_lead', 'center', 'Test 163'), (:c1, :relowner, 'relationship_owner', 'center', 'Test 163'),
  (:c1, :treas, 'treasurer', 'center', 'Test 163'), (:c1, :cadmin, 'center_admin', 'center', 'Test 163'),
  (:c1, :matchlead, 'matching_lead', 'center', 'Test 163'),
  (:c1, :carefin, 'care_lead', 'center', 'Test 163'), (:c1, :carefin, 'treasurer', 'center', 'Test 163'),
  (:c2, :c2owner, 'center_admin', 'center', 'Test 163'), (:c2, :carelead, 'care_lead', 'center', 'Test 163: the other community');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason, starts_at, ends_at) values
  (:c1, :expired, 'care_lead', 'center', 'Test 163: ended yesterday', now() - interval '30 days', now() - interval '1 day');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id, reason) values
  (:c1, :scoped, 'care_lead', 'event', '16300000-0000-4000-8000-0000000000e1', 'Test 163: one event');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason, status) values
  (:c1, :pending, 'care_lead', 'center', 'Test 163: waiting', 'pending');
insert into app.role_grants (id, center_id, user_id, role_key, scope_kind, reason) values
  (:teachgrant, :c1, :newbie, 'teacher', 'center', 'Test 163: a teacher');
insert into app.households (id, center_id, display_name) values (:h1, :c1, 'Member163, Mia'), (:h2, :c1, 'Newbie163, Ned');
insert into app.people (id, center_id, first_name, last_name, date_of_birth, employer) values
  (:pm, :c1, 'Mia', 'Member163', date '1985-04-01', 'Acme Corp'),
  (:pk, :c1, 'Kit', 'Member163', (current_date - interval '10 years')::date, null),
  (:pa, :c1, 'Ari', 'Member163', null, 'Globex'),
  (:pn, :c1, 'Ned', 'Newbie163', date '1990-01-01', null);
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :pm, :c1, 'primary', true), (:h1, :pk, :c1, 'child', false), (:h1, :pa, :c1, 'spouse', false), (:h2, :pn, :c1, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values (:c1, :member, :pm), (:c1, :kid, :pk), (:c1, :newbie, :pn);
select pg_temp.assert((select status from app.role_grants where center_id = :c1 and user_id = :pending) = 'pending'
                      and app.module_enabled(:c1, 'care') and app.module_enabled(:c1, 'matching') and not app.module_enabled(:c2, 'care'),
  'Fixtures · WeCare and CatchTheMatch are on in the first community only');

-- ══ B. org_private_can ═══════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:plat);
select pg_temp.assert(app.is_platform_admin()
                      and not app.org_private_can(:c1, 'care.view') and not app.org_private_can(:c1, 'care.own')
                      and not app.org_private_can(:c1, 'care.manage') and not app.org_private_can(:c1, 'matching.view')
                      and not app.org_private_can(:c1, 'matching.manage')
                      and not app.care_can(:c1, 'view') and not app.care_can(:c1, 'own') and not app.matching_can(:c1, 'view'),
  'B · a platform admin gets false for every private key, holding platform_owner ("*") in the community');
select pg_temp.claims(:weaver);
select pg_temp.assert(not app.org_private_can(:c1, 'care.view') and not app.matching_can(:c1, 'view'),
  'B · so does a platform admin holding platform_support there');
select pg_temp.claims(:owner);
select pg_temp.assert(app.org_private_can(:c1, 'care.view') and app.org_private_can(:c1, 'care.own') and app.org_private_can(:c1, 'care.manage')
                      and app.org_private_can(:c1, 'matching.view') and app.org_private_can(:c1, 'matching.manage')
                      and app.care_can(:c1, 'manage') and app.matching_can(:c1, 'manage'),
  'B · the community''s owner gets true for every private key');
select pg_temp.assert(not app.org_private_can(:c1, 'care.export') and not app.org_private_can(:c1, 'people.view')
                      and not app.org_private_can(:c1, null) and not app.care_can(:c1, 'everything'),
  'B · an unknown key, a key that is not private, and no key are false, even for the owner');
select pg_temp.assert(not app.org_private_can(:c2, 'care.view'),
  'B · the owner of one community has nothing in another');
select pg_temp.claims(:carelead);
select pg_temp.assert(app.org_private_can(:c1, 'care.view') and app.org_private_can(:c1, 'care.manage') and not app.org_private_can(:c1, 'care.own')
                      and app.care_can(:c1, 'view') and app.care_can(:c1, 'own') and app.care_can(:c1, 'manage')
                      and not app.matching_can(:c1, 'view'),
  'B · a Care lead gets WeCare (view and manage, so their own households too) and nothing of CatchTheMatch');
select pg_temp.assert(not app.org_private_can(:c2, 'care.view'),
  'B · their Care lead grant in another community counts there only, and WeCare is off there');
select pg_temp.claims(:relowner);
select pg_temp.assert(app.care_can(:c1, 'own') and not app.care_can(:c1, 'view') and not app.care_can(:c1, 'manage'),
  'B · a Relationship owner gets their own households only');
select pg_temp.claims(:matchlead);
select pg_temp.assert(app.matching_can(:c1, 'view') and app.matching_can(:c1, 'manage') and app.matching_can(:c1, 'file')
                      and not app.care_can(:c1, 'own'),
  'B · a Matching lead gets CatchTheMatch and nothing of WeCare');
select pg_temp.claims(:treas);
select pg_temp.assert(not app.org_private_can(:c1, 'care.view') and not app.care_can(:c1, 'own') and not app.matching_can(:c1, 'view'),
  'B · a role without the key (Treasurer) gets false');
select pg_temp.claims(:cadmin);
select pg_temp.assert(not app.org_private_can(:c1, 'care.view') and not app.matching_can(:c1, 'manage'),
  'B · so does the Center admin (roles.manage, settings.manage)');
select pg_temp.claims(:expired);
select pg_temp.assert(not app.care_can(:c1, 'own'), 'B · an ended grant counts for nothing');
select pg_temp.claims(:scoped);
select pg_temp.assert(not app.care_can(:c1, 'own'), 'B · a grant for one event counts for nothing');
select pg_temp.claims(:pending);
select pg_temp.assert(not app.care_can(:c1, 'own'), 'B · a pending grant counts for nothing');
select pg_temp.no_claims();
select pg_temp.assert(not app.org_private_can(:c1, 'care.view'), 'B · nobody signed in gets false');

-- Paused by the community, not granted by Weaver, and a module it needs off.
reset role;
savepoint paused;
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c1, 'care', false, 'Test 163: paused');
set role authenticated;
select pg_temp.claims(:owner);
select pg_temp.assert(not app.org_private_can(:c1, 'care.view') and app.org_private_can(:c1, 'matching.view'),
  'B · WeCare paused by the community: the owner gets false for WeCare (CatchTheMatch is unaffected)');
select pg_temp.claims(:carelead);
select pg_temp.assert(not app.care_can(:c1, 'own'), 'B · and so does the Care lead');
reset role;
rollback to savepoint paused;
savepoint ungranted;
update app.center_module_grants set granted = false where center_id = :c1 and module_key = 'care';
set role authenticated;
select pg_temp.claims(:owner);
select pg_temp.assert(not app.care_can(:c1, 'own'), 'B · WeCare not granted by Weaver: false');
reset role;
rollback to savepoint ungranted;
savepoint giving_off;
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c1, 'giving', false, 'Test 163: Giving paused');
set role authenticated;
select pg_temp.claims(:matchlead);
select pg_temp.assert(not app.matching_can(:c1, 'view'), 'B · CatchTheMatch needs Giving: with Giving paused it is off');
reset role;
rollback to savepoint giving_off;

-- Amounts need giving.view as well, through the organization's own grant.
set role authenticated;
select pg_temp.claims(:carelead);
select pg_temp.assert(not app.care_amounts_can(:c1), 'B · a Care lead without a giving role sees no amounts');
select pg_temp.claims(:carefin);
select pg_temp.assert(app.care_amounts_can(:c1), 'B · a Care lead who is also Treasurer sees amounts');
select pg_temp.claims(:treas);
select pg_temp.assert(not app.care_amounts_can(:c1), 'B · a Treasurer without WeCare sees no care amounts');
select pg_temp.claims(:plat);
select pg_temp.assert(not app.care_amounts_can(:c1), 'B · nor does a platform admin');

-- ══ C. has_permission's backstop ═════════════════════════════════════════════
select pg_temp.claims(:plat);
select pg_temp.assert(not app.has_permission(:c1, 'care.view') and not app.has_permission(:c1, 'matching.manage')
                      and app.has_permission(:c1, 'people.view') and app.has_permission(:c1, 'giving.manage'),
  'C · has_permission refuses a platform admin the private keys and keeps every other key as before');
select pg_temp.claims(:owner);
select pg_temp.assert(app.has_permission(:c1, 'care.view') and app.has_permission(:c1, 'giving.approve'),
  'C · the owner keeps every key, private ones included where the product is on');
select pg_temp.claims(:treas);
select pg_temp.assert(app.has_permission(:c1, 'giving.view') and not app.has_permission(:c1, 'care.view'),
  'C · a Treasurer: giving yes, care no');

-- ══ D. Giving a private role ═════════════════════════════════════════════════
select pg_temp.claims(:cadmin);
select pg_temp.assert_raises(format($$insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values (%L, %L, 'care_lead', 'center', 'x')$$, :c1, :newbie),
  'Care lead can be given only by the organization''s owner or by someone who manages',
  'D · the Center admin (roles.manage) cannot give a WeCare role');
select pg_temp.claims(:plat);
select pg_temp.assert_raises(format($$insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values (%L, %L, 'care_lead', 'center', 'x')$$, :c1, :plat),
  'Nobody can give themselves Care lead', 'D · a platform admin cannot give themselves a WeCare role');
select pg_temp.assert_raises(format($$insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason, granted_by) values (%L, %L, 'matching_lead', 'center', 'x', %L)$$, :c1, :weaver, :owner),
  'Matching lead can be given only by', 'D · nor give one to a colleague, even naming the owner as the giver');
select pg_temp.claims(:carelead);
select pg_temp.assert_raises(format($$insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values (%L, %L, 'matching_lead', 'center', 'x')$$, :c1, :newbie),
  'Matching lead can be given only by', 'D · a Care lead cannot give a CatchTheMatch role');
select pg_temp.claims(:owner);
select pg_temp.assert_raises(format($$insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id, reason) values (%L, %L, 'care_lead', 'event', %L, 'x')$$, :c1, :newbie, '16300000-0000-4000-8000-0000000000e2'),
  'works for the whole organization only', 'D · a private role is for the whole community, never one event');
select pg_temp.assert((select count(*) from app.role_grants where center_id = :c1 and user_id = :newbie and role_key in ('care_lead', 'matching_lead')) = 0,
  'D · every refusal wrote nothing');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values (:c1, :newbie, 'relationship_owner', 'center', 'Test 163: the owner gives it');
select pg_temp.claims(:carelead);
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values (:c1, :member, 'relationship_owner', 'center', 'Test 163: the Care lead gives it');
reset role;
select pg_temp.assert((select granted_by from app.role_grants where center_id = :c1 and user_id = :newbie and role_key = 'relationship_owner') = :owner
                      and (select granted_by from app.role_grants where center_id = :c1 and user_id = :member and role_key = 'relationship_owner') = :carelead
                      and (select status from app.role_grants where center_id = :c1 and user_id = :member and role_key = 'relationship_owner') = 'active',
  'D · the owner and a WeCare manager give it; it starts at once (no second approver) and records who gave it');
select pg_temp.assert((select count(*) from app.audit_log where center_id = :c1 and action = 'care.access_granted' and module = 'care'
                         and after->>'role' = 'relationship_owner' and after->>'user_id' in (:newbie, :member)) = 2
                      and (select count(*) from app.messages where template_key = 'private_access_granted' and to_address = 'owner163@c1.test') >= 2,
  'D · each grant is audited under WeCare and the owner is emailed');
set role authenticated;
-- An update that widens is checked like a grant; an update that ends one is not.
select pg_temp.claims(:cadmin);
select pg_temp.assert_raises(format($$update app.role_grants set role_key = 'care_lead' where id = %L$$, :teachgrant),
  'Care lead can be given only by', 'D · turning a Teacher grant into a Care lead grant is refused to the Center admin');
select pg_temp.assert_raises(format($$update app.role_grants set ends_at = null where center_id = %L and user_id = %L and role_key = 'care_lead'$$, :c1, :expired),
  'Care lead can be given only by', 'D · so is bringing an ended Care lead grant back');
update app.role_grants set ends_at = now() where center_id = :c1 and user_id = :newbie and role_key = 'relationship_owner';
reset role;
select pg_temp.assert((select ends_at <= now() from app.role_grants where center_id = :c1 and user_id = :newbie and role_key = 'relationship_owner'),
  'D · but the Center admin may end a private grant (taking access away needs no product manager)');
set role authenticated;
-- Invitations.
select pg_temp.claims(:cadmin);
select pg_temp.assert_raises(format($$select * from app.invite_staff(%L, 'invitee163@c1.test', null, null, array['care_lead'], '{"kind":"center"}'::jsonb, 'In', 'Vitee', 7)$$, :c1),
  'Care lead can be given only by', 'D · the Center admin cannot invite someone as Care lead');
select pg_temp.claims(:owner);
select pg_temp.assert((select count(*) from app.invite_staff(:c1, 'invitee163@c1.test', null, null, array['care_lead'], '{"kind":"center"}'::jsonb, 'In', 'Vitee', 7)) = 1,
  'D · the owner can');
select pg_temp.assert_raises(format($$select * from app.invite_staff(%L, 'invitee163b@c1.test', null, null, array['matching_lead'], '{"kind":"zone","id":"16300000-0000-4000-8000-0000000000e3"}'::jsonb, 'In', 'Vitee', 7)$$, :c1),
  'whole organization only', 'D · and never for one zone');

-- ══ E. W8: support may open WeCare settings only ═════════════════════════════
reset role;
select pg_temp.no_claims();
insert into app.support_grants (id, center_id, grantee_user_id, granted_by, expires_at, reason) values
  ('16300000-0000-4000-8000-0000000000f1', :c1, :plat, :owner, now() + interval '2 days', 'Test 163: help with setup');
set role authenticated;
select pg_temp.claims(:plat);
select pg_temp.assert(app.has_support_grant(:c1) and not app.care_settings_can(:c1) and not app.care_can(:c1, 'own'),
  'E · a support grant alone opens nothing of WeCare');
select pg_temp.assert_raises($$select app.set_support_grant_areas('16300000-0000-4000-8000-0000000000f1', array['care.settings'], 'Fix WeCare setup')$$,
  'Only the owner', 'E · the person given support cannot widen it');
select pg_temp.claims(:owner);
select pg_temp.assert_raises($$select app.set_support_grant_areas('16300000-0000-4000-8000-0000000000f1', array['care.records'], 'All of it')$$,
  'can open only: care.settings', 'E · there is no area for care records');
select pg_temp.assert_raises($$select app.set_support_grant_areas('16300000-0000-4000-8000-0000000000f1', array['care.settings'], '  ')$$,
  'Say why', 'E · a reason is needed');
select pg_temp.assert(app.set_support_grant_areas('16300000-0000-4000-8000-0000000000f1', array['care.settings', 'care.settings'], 'Fix WeCare setup')
                        = array['care.settings'],
  'E · the owner names WeCare settings');
select pg_temp.claims(:plat);
select pg_temp.assert(app.care_settings_can(:c1) and not app.care_can(:c1, 'own') and not app.org_private_can(:c1, 'care.view')
                      and not app.care_can(:c1, 'manage'),
  'E · now support opens WeCare settings, and still no care record');
select pg_temp.claims(:weaver);
select pg_temp.assert(not app.care_settings_can(:c1), 'E · another Weaver team member without the grant gets nothing');
select pg_temp.claims(:carelead);
select pg_temp.assert(app.care_settings_can(:c1), 'E · the Care lead (care.manage) opens the settings too');
reset role;
update app.support_grants set expires_at = now() - interval '1 minute', granted_at = now() - interval '1 day'
 where id = '16300000-0000-4000-8000-0000000000f1';
set role authenticated;
select pg_temp.claims(:plat);
select pg_temp.assert(not app.care_settings_can(:c1), 'E · an expired support grant opens nothing');

-- ══ F. C8: the Weaver filing grant ═══════════════════════════════════════════
select pg_temp.claims(:cadmin);
select pg_temp.assert_raises(format($$select app.grant_weaver_filing(%L, %L, 90, 'File our matches')$$, :c1, :weaver),
  'Only the organization''s owner or someone who manages CatchTheMatch', 'F · the Center admin cannot give filing access');
select pg_temp.claims(:plat);
select pg_temp.assert_raises(format($$select app.grant_weaver_filing(%L, %L, 90, 'File their matches')$$, :c1, :weaver),
  'Only the organization''s owner', 'F · nor can a platform admin');
select pg_temp.claims(:owner);
select pg_temp.assert_raises(format($$select app.grant_weaver_filing(%L, %L, 90, 'File our matches')$$, :c1, :treas),
  'only to a member of Weaver''s team', 'F · filing access goes to Weaver''s team only');
select pg_temp.assert_raises(format($$select app.grant_weaver_filing(%L, %L, 400, 'File our matches')$$, :c1, :weaver),
  'from 1 day to 366 days', 'F · for at most 366 days');
select pg_temp.assert_raises(format($$select app.grant_weaver_filing(%L, %L, 90, ' ')$$, :c1, :weaver),
  'Say what the filing access is for', 'F · with a reason');
select pg_temp.assert_raises(format($$select app.grant_weaver_filing(%L, %L, 90, 'File our matches')$$, :c2, :weaver),
  'Only the organization''s owner', 'F · nor in a community one does not own');
select pg_temp.claims(:weaver);
select pg_temp.assert(not app.matching_can(:c1, 'view'), 'F · before the grant, the filer sees nothing');
select pg_temp.claims(:matchlead);
select app.grant_weaver_filing(:c1, :weaver, 90, 'Test 163: file our matches this quarter') as filing \gset
select pg_temp.assert_raises(format($$select app.grant_weaver_filing(%L, %L, 30, 'Again')$$, :c1, :weaver),
  'already has filing access until', 'F · one live grant per person');
select pg_temp.claims(:weaver);
select pg_temp.assert(app.matching_can(:c1, 'view') and app.matching_can(:c1, 'file') and not app.matching_can(:c1, 'manage')
                      and not app.org_private_can(:c1, 'matching.view') and not app.care_can(:c1, 'own')
                      and not app.care_settings_can(:c1),
  'F · the filer sees and files CatchTheMatch, never manages it, and nothing of WeCare');
select pg_temp.assert((select count(*) from app.matching_filing_grants where center_id = :c1) = 1,
  'F · the filer sees their own grant');
select pg_temp.claims(:cadmin);
select pg_temp.assert((select count(*) from app.matching_filing_grants where center_id = :c1) = 0,
  'F · the Center admin does not (only the owner and CatchTheMatch managers)');
select pg_temp.claims(:owner);
select pg_temp.assert((select count(*) from app.matching_filing_grants where center_id = :c1 and granted_by = :matchlead) = 1,
  'F · the owner sees who gave it');
reset role;
select pg_temp.assert(exists (select 1 from app.audit_log where center_id = :c1 and action = 'matching.filing_granted' and module = 'matching'
                                and record_id = :'filing')
                      and exists (select 1 from app.messages where template_key = 'private_access_granted' and to_address = 'owner163@c1.test'
                                    and body like '%Weaver filing access%'),
  'F · the grant is audited under CatchTheMatch and the owner is emailed');

-- ══ G. Reads are logged and kept in the organization ═════════════════════════
set role authenticated;
select pg_temp.claims(:weaver);
select app.log_private_read(:c1, 'matching', 'claims.list', 12);
select pg_temp.claims(:carelead);
select app.log_private_read(:c1, 'care', 'households.list', 5);
select pg_temp.assert_raises(format($$select app.log_private_read(%L, 'matching', 'claims.list', 1)$$, :c1),
  'You don''t have access to this area', 'G · a read is logged only by someone who may read it');
reset role;
select pg_temp.assert((select after->>'as' = 'weaver_filing' and (after->>'rows')::int = 12 and actor_user_id = :weaver
                         from app.audit_log where center_id = :c1 and action = 'matching.read' order by id desc limit 1)
                      and (select after->>'as' = 'organization' and module = 'care'
                             from app.audit_log where center_id = :c1 and action = 'care.read' order by id desc limit 1),
  'G · each read writes who, what and how many rows, and whether it was Weaver''s filing team');
set role authenticated;
select pg_temp.claims(:owner);
select pg_temp.assert((select count(*) from app.audit_log where center_id = :c1 and module = 'matching' and action = 'matching.read') = 1
                      and (select count(*) from app.audit_log where center_id = :c1 and module = 'care') >= 3,
  'G · the owner reads the WeCare and CatchTheMatch entries, the filing team''s reads included');
select pg_temp.claims(:matchlead);
select pg_temp.assert((select count(*) from app.audit_log where center_id = :c1 and module = 'matching') >= 2
                      and (select count(*) from app.audit_log where center_id = :c1 and module = 'care') = 0,
  'G · a CatchTheMatch manager reads CatchTheMatch''s entries, not WeCare''s');
select pg_temp.claims(:cadmin);
select pg_temp.assert((select count(*) from app.audit_log where center_id = :c1 and module in ('care', 'matching')) = 0
                      and (select count(*) from app.audit_log where center_id = :c1 and action = 'role_grants.insert') > 0,
  'G · audit.view alone (Center admin) reads none of them, and every other entry as before');
select pg_temp.claims(:weaver);
select pg_temp.assert((select count(*) from app.audit_log where center_id = :c1 and module in ('care', 'matching')) = 0
                      and (select count(*) from app.audit_log where center_id = :c1 and action = 'role_grants.insert') > 0,
  'G · a platform admin reads none of them, not even the filing team''s own reads, and every other entry as before');

-- ══ H. The employer for gift matching ════════════════════════════════════════
select pg_temp.claims(:member);
select pg_temp.assert((app.my_match_employer(:c1))->>'employer' is null and (app.my_match_employer(:c1))->>'suggestion' = 'Acme Corp'
                      and ((app.my_match_employer(:c1))->>'is_adult')::boolean,
  'H · nothing on file yet; the profile''s employer is offered to confirm');
select pg_temp.assert((app.set_my_match_employer(:c1, '  Acme   Corp ')) ->> 'employer' = 'Acme Corp',
  'H · the person puts their employer on file (the name tidied)');
select pg_temp.assert((select count(*) from app.person_match_employers where person_id = :pm) = 1
                      and (app.my_match_employer(:c1))->>'source' = 'member' and (app.my_match_employer(:c1))->>'suggestion' is null,
  'H · and reads it back, from the app');
select pg_temp.claims(:kid);
select pg_temp.assert_raises(format($$select app.set_my_match_employer(%L, 'Lemonade stand')$$, :c1),
  'for an adult only', 'H · a child cannot');
select pg_temp.claims(:matchlead);
select pg_temp.assert_raises(format($$select app.record_match_employer(%L, %L, 'Toy shop')$$, :c1, :pk),
  'for an adult only', 'H · nor can the office record one for a child');
select pg_temp.assert((app.record_match_employer(:c1, :pa, 'Globex')) ->> 'source' = 'paper_form',
  'H · the office records one from a signed paper form for an adult');
select pg_temp.assert((select count(*) from app.person_match_employers where center_id = :c1) = 2,
  'H · CatchTheMatch''s manager reads the employers on file');
select pg_temp.claims(:cadmin);
select pg_temp.assert((select count(*) from app.person_match_employers where center_id = :c1) = 0,
  'H · people.view (Center admin) reads none of them');
select pg_temp.assert_raises(format($$select app.record_match_employer(%L, %L, 'Initech')$$, :c1, :pn),
  'needs the CatchTheMatch manager role', 'H · nor records one');
select pg_temp.claims(:plat);
select pg_temp.assert((select count(*) from app.person_match_employers where center_id = :c1) = 0,
  'H · a platform admin reads none of them');
select pg_temp.claims(:weaver);
select pg_temp.assert((select count(*) from app.person_match_employers where center_id = :c1) = 2,
  'H · the Weaver filing grant reads them (CatchTheMatch data)');
select pg_temp.assert_raises(format($$select app.record_match_employer(%L, %L, 'Initech')$$, :c1, :pn),
  'needs the CatchTheMatch manager role', 'H · but records nothing');
select pg_temp.claims(:member);
select pg_temp.assert((select count(*) from app.person_match_employers where center_id = :c1) = 1,
  'H · a person reads their own only, not their household''s');
reset role;
select pg_temp.assert((select count(*) from app.consents where person_id = :pm and kind = 'employer_matching' and granted and source = 'app' and given_by_user = :member) = 1
                      and (select count(*) from app.consents where person_id = :pa and kind = 'employer_matching' and granted and source = 'paper_form' and given_by_user = :matchlead) = 1
                      and (select recorded_by = :matchlead and recorded_at is not null from app.person_match_employers where person_id = :pa),
  'H · each one is the person''s consent: from the app, or from a paper form with who recorded it and when');
select pg_temp.assert(not exists (select 1 from app.audit_log where record_table = 'person_match_employers' and (after::text like '%Acme%' or after::text like '%Globex%'))
                      and (select bool_and(module = 'matching' and after->>'employer_name' = '***') from app.audit_log where record_table = 'person_match_employers'),
  'H · the audit trail says who and when, never the employer''s name, and belongs to CatchTheMatch');
select pg_temp.assert((select employer from app.people where id = :pm) = 'Acme Corp' and (select employer from app.people where id = :pa) = 'Globex',
  'H · people.employer is untouched');
-- The person removes it, with CatchTheMatch off for good measure.
update app.center_module_grants set granted = false where center_id = :c1 and module_key = 'matching';
select pg_temp.assert((select ended_at is not null and end_reason = 'CatchTheMatch was turned off for this community'
                         from app.matching_filing_grants where id = :'filing'),
  'F · Weaver turning CatchTheMatch off ends the filing grant at once');
set role authenticated;
select pg_temp.claims(:weaver);
select pg_temp.assert(not app.matching_can(:c1, 'view'), 'F · and the filer sees nothing any more');
select pg_temp.claims(:member);
select pg_temp.assert_raises(format($$select app.set_my_match_employer(%L, 'Acme Corp')$$, :c1),
  'is not on for this community', 'H · with CatchTheMatch off a new employer cannot be added');
select pg_temp.assert((select count(*) from app.person_match_employers where center_id = :c1) = 0
                      and (app.my_match_employer(:c1))->>'employer' = 'Acme Corp',
  'H · the table hides it while CatchTheMatch is off, but the person still sees their own');
select pg_temp.assert(app.remove_my_match_employer(:c1) and not app.remove_my_match_employer(:c1),
  'H · and removes it at once (a second removal finds nothing)');
reset role;
select pg_temp.assert(not exists (select 1 from app.person_match_employers where person_id = :pm)
                      and (select count(*) from app.consents where person_id = :pm and kind = 'employer_matching' and not granted) = 1,
  'H · the row is gone and the withdrawal is recorded');

-- An expired filing grant opens nothing.
update app.center_module_grants set granted = true where center_id = :c1 and module_key = 'matching';
insert into app.matching_filing_grants (center_id, grantee_user_id, granted_by, granted_at, ends_at, reason) values
  (:c1, :weaver, :owner, now() - interval '10 days', now() - interval '1 day', 'Test 163: ended yesterday');
set role authenticated;
select pg_temp.claims(:weaver);
select pg_temp.assert(not app.matching_can(:c1, 'view'), 'F · an expired filing grant opens nothing');
select pg_temp.claims(:owner);
select pg_temp.assert(app.matching_can(:c1, 'view'), 'F · while the organization''s own access comes back with the module');

reset role;
select pg_temp.no_claims();
rollback;
\echo 'PASS: organization private access tests'
