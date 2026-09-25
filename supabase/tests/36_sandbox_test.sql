-- 0500–0503 (stream f-sandbox, Wave F): owner decisions 2026-09-25, second batch.
--   A. JSH's organization becomes a sandbox (0503): nothing deleted, sandbox rules apply, its own
--      records keep fitting, no inactivity expiry, a join code, idempotent.
--   B. Going live in place (0500): refused while demo data is loaded; the organization itself
--      becomes production with every record kept.
--   C. Community Connect creates a sandbox directly (0502); the invited owner accepts and becomes
--      the owner; the pipeline lists it. The sandbox-code redemption is covered by test 23.
--   D. The owner passes role-based checks (0501), except resetting another admin's 2FA.
-- Everything runs in one transaction that is rolled back, so JSH is production again for the
-- tests after this one (a new database gets JSH from seed.sql after the migrations).
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
                then jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 60))
                else jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 60)) end)::text, true);
  perform set_config('request.headers', '{"x-audit-reason":"f-sandbox test"}', true);
end $$;
create or replace function pg_temp.no_claims() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;
grant connect_worker to postgres;

\set jsh '''00000000-0000-4000-8000-000000000001'''
\set cc '''36000000-0000-4000-8000-000000000001'''
\set cc2 '''36000000-0000-4000-8000-000000000002'''
\set jowner '''36000000-0000-4000-8000-000000000003'''
\set jadmin '''36000000-0000-4000-8000-000000000004'''
\set newowner '''36000000-0000-4000-8000-000000000005'''
\set coordinator '''36000000-0000-4000-8000-000000000006'''
insert into auth.users (id, email) values
  (:cc, 'cc36@platform.test'), (:cc2, 'cc36b@platform.test'), (:jowner, 'owner36@jsh.test'),
  (:jadmin, 'admin36@jsh.test'), (:newowner, 'asha36@templeexample.org'), (:coordinator, 'coord36@jsh.test');
insert into app.accounts (user_id, is_platform_admin) values (:cc, true), (:cc2, true), (:jowner, false), (:jadmin, false), (:coordinator, false)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status) values
  ('f3600000-0000-4000-8000-000000000001', :cc, 'Phone', 'totp', 'verified'),
  ('f3600000-0000-4000-8000-000000000003', :jowner, 'Phone', 'totp', 'verified'),
  ('f3600000-0000-4000-8000-000000000004', :jadmin, 'Phone', 'totp', 'verified');

-- JSH as it is in production: an owner (no role grant), an administrator, records and a real
-- QuickBooks company connected live.
insert into app.center_owners (center_id, user_id) values (:jsh, :jowner) on conflict (center_id) do update set user_id = excluded.user_id;
insert into app.role_grants (center_id, user_id, role_key, reason) values (:jsh, :jadmin, 'center_admin', 'f-sandbox test'),
  (:jsh, :coordinator, 'membership_coordinator', 'f-sandbox test');
insert into app.households (id, center_id, display_name) values ('36000000-0000-4000-8000-0000000000a1', :jsh, 'Shah household (JSH)');
insert into app.people (id, center_id, first_name, last_name, email) values
  ('36000000-0000-4000-8000-0000000000b1', :jsh, 'Nila', 'Shah', 'nila.shah@example.org');
insert into app.household_members (household_id, person_id, center_id, is_primary) values
  ('36000000-0000-4000-8000-0000000000a1', '36000000-0000-4000-8000-0000000000b1', :jsh, true);
insert into app.integration_connections (center_id, provider, status, settings) values
  (:jsh, 'quickbooks_online', 'connected', '{"mode":"live","read_only":false,"company":"real"}')
  on conflict (center_id, provider) do update set status = 'connected', settings = excluded.settings;
update app.member_join_codes set active = false where center_id = :jsh;

select count(*) as people_before from app.people where center_id = :jsh \gset
select count(*) as households_before from app.households where center_id = :jsh \gset
select coalesce(max(id), 0) as audit_start from app.audit_log \gset

select pg_temp.assert((select environment from app.centers where id = :jsh) = 'production', 'before: JSH is production');
select pg_temp.assert(app.recipient_allowed(:jsh, 'email', 'nila.shah@example.org'), 'before: JSH may email any member');

-- ══ A. The switch ═══════════════════════════════════════════════════════════
\ir ../migrations/0503_jsh_sandbox.sql
set client_min_messages = notice;
select pg_temp.assert((select environment = 'sandbox' and status = 'active' and sandbox_for is null and slug::text = 'jsh' from app.centers where id = :jsh),
  'A · JSH is a sandbox, still active, same web name');
select pg_temp.assert((select count(*) from app.people where center_id = :jsh) = :people_before
                      and (select count(*) from app.households where center_id = :jsh) = :households_before,
  'A · nothing is deleted: every person and household is still there');
select pg_temp.assert(not app.recipient_allowed(:jsh, 'email', 'nila.shah@example.org'), 'A · messaging: only verified test recipients');
select pg_temp.assert(app.entitlement(:jsh, 'payments.mode') = '"test"' and app.payment_api_mode(:jsh, 'stripe') = 'test',
  'A · payments run in the provider''s test mode');
select pg_temp.assert(app.entitlement(:jsh, 'qbo.mode') = '"sandbox_or_read_only"', 'A · QuickBooks: Intuit sandbox or real company read-only');
select pg_temp.assert((select (settings->>'read_only')::boolean and settings->>'mode' = 'test' from app.integration_connections
                        where center_id = :jsh and provider = 'quickbooks_online'), 'A · the real QuickBooks company is kept, read-only');
select pg_temp.assert((app.qbo_post_ready(:jsh))->>'ok' = 'false', 'A · nothing posts to QuickBooks');
select pg_temp.assert_raises($$select app.public_kpis('jsh')$$, 'no public community dashboard', 'A · the public dashboard is off');
select pg_temp.assert(app.entitlement(:jsh, 'max_people') = 'null' and app.entitlement(:jsh, 'max_households') = 'null'
                      and app.entitlement(:jsh, 'storage.bytes') = 'null', 'A · JSH''s own records and files keep fitting (no limit)');
select pg_temp.assert(app.entitlement(:jsh, 'expiry_days_inactive') = 'null' and app.promotes_in_place(:jsh),
  'A · JSH never expires and goes live in place');
select pg_temp.assert((select count(*) from app.center_entitlements where center_id = :jsh and set_by is null and reason like 'Owner decision 2026-09-25%') = 5,
  'A · the five overrides carry the reason');
select pg_temp.assert(exists (select 1 from app.member_join_codes where center_id = :jsh and active and (expires_at is null or expires_at > now())),
  'A · JSH has an active member-app join code');
select code as jsh_code from app.member_join_codes where center_id = :jsh and active limit 1 \gset
select pg_temp.assert((select slug from app.community_by_join_code(:'jsh_code')) = 'jsh', 'A · the join code opens JSH');
select pg_temp.assert(not exists (select 1 from app.find_community('Jain Society') where slug = 'jsh'), 'A · JSH is out of community search');
select pg_temp.assert(app.center_slug_for_domain('nothing.example') is null
                      and exists (select 1 from app.centers where slug = 'jsh' and status in ('active','onboarding')),
  'A · the web name still resolves (portal and member app default community read centers by slug)');
select pg_temp.assert(exists (select 1 from app.audit_log where id > :audit_start and record_table = 'centers' and record_id = :jsh
                                and reason like 'Owner decision 2026-09-25%'), 'A · the switch is in the audit log with its reason');
select pg_temp.assert(app.demo_center_problem(:jsh) is null, 'A · demo data may be loaded (a sandbox), guarded by the typed name and 2FA');
select pg_temp.assert(app.demo_confirm_word(:jsh) = 'JSH', 'A · the word to type is JSH');
set role authenticated;
select pg_temp.claims(:jowner, false);
select pg_temp.assert((select count(*) from app.readiness(:jsh)) > 0, 'A · readiness still evaluates for JSH (its owner)');
reset role;
select pg_temp.no_claims();

-- Re-running changes nothing.
\ir ../migrations/0503_jsh_sandbox.sql
set client_min_messages = notice;
select pg_temp.assert((select count(*) from app.member_join_codes where center_id = :jsh and active) = 1
                      and (select count(*) from app.center_entitlements where center_id = :jsh) = 5,
  'A · the switch is idempotent');

-- No inactivity warnings for JSH, even after a long quiet spell; another sandbox is warned.
update app.centers set created_at = now() - interval '200 days' where id = :jsh;
delete from app.sandbox_expiry_notices where center_id = :jsh;
insert into app.centers (id, slug, name, status, environment, created_at)
values ('36000000-0000-4000-8000-0000000000e1', 'quiet36-sandbox', 'Quiet 36', 'onboarding', 'sandbox', now() - interval '85 days');
set role connect_worker;
select app.worker_sandbox_expiry() as expiry \gset
reset role;
select pg_temp.no_claims();
select pg_temp.assert(not exists (select 1 from app.sandbox_expiry_notices where center_id = :jsh)
                      and :'expiry'::jsonb->'details' @> '[{"center":"quiet36-sandbox"}]'
                      and not (:'expiry'::jsonb->'details' @> '[{"center":"jsh"}]'),
  'A · the expiry job warns another quiet sandbox but never JSH');

-- ══ B. Going live in place ══════════════════════════════════════════════════
insert into app.golive_requests (id, center_id, requested_by, status, first_approver, first_approved_at, second_approver, second_approved_at)
values ('36000000-0000-4000-8000-0000000000c1', :jsh, :jowner, 'approved', :cc, now(), :cc2, now());
insert into app.center_demo_state (center_id, pack_key, version, status) values (:jsh, 'community', 1, 'loaded')
  on conflict (center_id) do update set status = 'loaded';
set role authenticated;
select pg_temp.claims(:jowner, true);
select pg_temp.assert_raises(format($$select app.promote_sandbox(%L, null, 'Go live')$$, :jsh), 'Demo data is loaded',
  'B · refused while demo data is loaded (it would become real records)');
reset role;
select pg_temp.no_claims();
update app.center_demo_state set status = 'empty' where center_id = :jsh;
set role authenticated;
select pg_temp.claims(:jowner, true);
select pg_temp.assert_raises(format($$select app.promote_sandbox(%L, 'jsh-live', 'Go live')$$, :jsh), 'own web name',
  'B · going live in place keeps the web name');
select pg_temp.claims(:jowner, false);
select pg_temp.assert_raises(format($$select app.promote_sandbox(%L, null, 'Go live')$$, :jsh), 'fresh 2FA', 'B · it needs a fresh 2FA check');
select pg_temp.claims(:jowner, true);
select app.promote_sandbox(:jsh, null, 'Go-live approved by Community Connect') as promotion \gset
reset role;
select pg_temp.no_claims();
set role connect_worker;
select app.worker_promote_sandbox(:'promotion') as promoted \gset
reset role;
select pg_temp.no_claims();
select pg_temp.assert((select environment = 'production' and slug::text = 'jsh' and sandbox_for is null from app.centers where id = :jsh),
  'B · JSH itself is production, same web name');
select pg_temp.assert((select count(*) from app.people where center_id = :jsh) = :people_before
                      and (select count(*) from app.households where center_id = :jsh) = :households_before
                      and not exists (select 1 from app.centers where slug in ('jsh-live','jsh-sandbox')),
  'B · every record kept; no second organization was created');
select pg_temp.assert((select status = 'done' and production_id = :jsh and (result->>'in_place')::boolean from app.sandbox_promotions where id = :'promotion')
                      and (select status from app.golive_requests where id = '36000000-0000-4000-8000-0000000000c1') = 'live',
  'B · the promotion is done and the go-live request is live');
select pg_temp.assert(app.recipient_allowed(:jsh, 'email', 'nila.shah@example.org') and app.demo_center_problem(:jsh) is not null,
  'B · production rules again: members get messages, demo data is refused');
\ir ../migrations/0503_jsh_sandbox.sql
set client_min_messages = notice;
select pg_temp.assert((select environment from app.centers where id = :jsh) = 'production', 'B · re-running the switch never turns it back into a sandbox');
-- Back to a sandbox for the rest of this test.
update app.sandbox_promotions set status = 'failed' where id = :'promotion';
update app.centers set environment = 'sandbox' where id = :jsh;

-- ══ C. Community Connect creates a sandbox directly ═════════════════════════
set role authenticated;
select pg_temp.claims(:jadmin, true);
select pg_temp.assert_raises($$select app.platform_create_sandbox('Jain Temple of Austin', 'jta', 'temple', 'Austin', 'TX', 'Asha', 'Mehta', 'asha36@templeexample.org', 'New customer', 'http://portal.test')$$,
  'Community Connect team', 'C · only a platform admin creates a sandbox');
select pg_temp.claims(:cc, false);
select pg_temp.assert_raises($$select app.platform_create_sandbox('Jain Temple of Austin', 'jta', 'temple', 'Austin', 'TX', 'Asha', 'Mehta', 'asha36@templeexample.org', 'New customer', 'http://portal.test')$$,
  'fresh 2FA', 'C · it needs a fresh 2FA check');
select pg_temp.claims(:cc, true);
select pg_temp.assert_raises($$select app.platform_create_sandbox('Jain Temple of Austin', 'jta', 'temple', 'Austin', 'TX', 'Asha', 'Mehta', 'asha36@templeexample.org', ' ', 'http://portal.test')$$,
  'reason', 'C · it needs a reason');
select pg_temp.assert_raises($$select app.platform_create_sandbox('Jain Temple of Austin', 'jsh', 'temple', 'Austin', 'TX', 'Asha', 'Mehta', 'asha36@templeexample.org', 'New customer', 'http://portal.test')$$,
  'already taken', 'C · the web name must be free');
select pg_temp.assert_raises($$select app.platform_create_sandbox('Jain Temple of Austin', 'jta', 'mosque', 'Austin', 'TX', 'Asha', 'Mehta', 'asha36@templeexample.org', 'New customer', 'http://portal.test')$$,
  'kind of organization', 'C · the organization type is checked');
select app.platform_create_sandbox('Jain Temple of Austin', 'jta-sandbox', 'temple', 'Austin', 'tx', 'Asha', 'Mehta', 'Asha36@TempleExample.org',
                                   'Owner asked on the phone', 'http://portal.test') as created \gset
reset role;
select pg_temp.no_claims();
select (:'created'::jsonb)->>'center_id' as newc, (:'created'::jsonb)->>'token' as token \gset
select pg_temp.assert((select slug::text = 'jta-sandbox' and environment = 'sandbox' and status = 'onboarding' and state_region = 'TX'
                              and rules #>> '{onboarding,source}' = 'platform_admin' and rules #>> '{onboarding,org_type}' = 'temple'
                              and rules #>> '{onboarding,production_slug}' = 'jta' and (rules #>> '{security,require_2fa_for_staff}')::boolean
                         from app.centers where id = :'newc'),
  'C · the <slug>-sandbox center exists: sandbox, onboarding, staff 2FA on, type and production name recorded');
select pg_temp.assert((select legal_name = 'Jain Temple of Austin' and registered_address->>'city' = 'Austin' from app.org_profiles where center_id = :'newc'),
  'C · its organization profile has the name and city');
select pg_temp.assert(exists (select 1 from app.member_join_codes where center_id = :'newc' and active), 'C · it has a member-app join code');
select pg_temp.assert(not exists (select 1 from app.center_owners where center_id = :'newc'), 'C · no owner until the invitation is accepted');
select pg_temp.assert((select makes_owner and email = 'asha36@templeexample.org' and role_keys = array['center_admin'] and invited_by = :cc
                         from app.staff_invitations where center_id = :'newc'), 'C · the owner is invited (owner invitation, administrator role)');
select pg_temp.assert((:'created'::jsonb)->>'email_status' is not null, 'C · the email outcome is reported to the console');
select pg_temp.assert((select count(*) from app.audit_log where id > :audit_start and actor_user_id = :cc and reason = 'Owner asked on the phone'
                         and record_table in ('centers','staff_invitations','org_profiles')) >= 3,
  'C · audited as the platform admin with the reason');
set role authenticated;
select pg_temp.claims(:cc, true);
select pg_temp.assert(exists (select 1 from app.platform_onboarding_pipeline() where slug = 'jta-sandbox' and stage = 'sandbox'),
  'C · the pipeline lists it');
select pg_temp.assert_raises($$select app.platform_create_sandbox('Jain Temple of Austin 2', 'jta', 'temple', 'Austin', 'TX', 'Asha', 'Mehta', 'x@example.org', 'again', null)$$,
  'already taken', 'C · the same web name cannot be used twice');
-- The owner accepts.
select pg_temp.claims(:newowner, false);
select app.accept_invitation(:'token') as accepted \gset
reset role;
select pg_temp.no_claims();
select pg_temp.assert((:'accepted'::jsonb->>'owner')::boolean and (select user_id from app.center_owners where center_id = :'newc') = :newowner,
  'C · accepting makes her the owner');
select pg_temp.assert((select status from app.role_grants where center_id = :'newc' and user_id = :newowner and role_key = 'center_admin') = 'pending',
  'C · her administrator grant waits for a second person (two-person rule unchanged)');
set role authenticated;
select pg_temp.claims(:newowner, false);
select pg_temp.assert(app.has_permission(:'newc', 'settings.manage') and exists (select 1 from app.setup_checklist(:'newc')),
  'C · as owner she can open Setup (every permission)');
reset role;
select pg_temp.no_claims();
select pg_temp.assert(not exists (select 1 from app.centers x where x.slug::text = 'jta'), 'C · no production organization is created');

-- ══ D. The owner passes role-based checks ══════════════════════════════════
select id as zone from app.zones where center_id = :jsh limit 1 \gset
set role authenticated;
select pg_temp.claims(:jowner, false);
select pg_temp.assert(app.has_scoped_role(:jsh, :'zone', 'zone_lead') and app.has_role(:jsh, 'executive_committee')
                      and app.has_scoped_role(:jsh, gen_random_uuid(), 'teacher', 'event_lead'),
  'D · the owner passes zone lead, Executive Committee, teacher and event lead checks');
select pg_temp.assert(app.is_active_treasurer(:jsh), 'D · the owner passes the treasurer''s template approval check');
select pg_temp.claims(:jadmin, false);
select pg_temp.assert(not app.has_scoped_role(:jsh, :'zone', 'zone_lead') and not app.has_role(:jsh, 'executive_committee') and not app.is_active_treasurer(:jsh),
  'D · an administrator without those roles still does not');
reset role;
select pg_temp.no_claims();
-- Executive Committee decision on a life membership.
select id as life from app.membership_types where center_id = :jsh and key = 'life' \gset
insert into app.membership_applications (id, center_id, applicant_person_id, household_id, membership_type_id, tier, status,
                                         reference_decision, center_decided_by, center_decided_at)
values ('36000000-0000-4000-8000-0000000000d1', :jsh, '36000000-0000-4000-8000-0000000000b1', '36000000-0000-4000-8000-0000000000a1',
        :'life', 'life', 'awaiting_ec', 'approved', :coordinator, now()),
       ('36000000-0000-4000-8000-0000000000d2', :jsh, '36000000-0000-4000-8000-0000000000b1', '36000000-0000-4000-8000-0000000000a1',
        :'life', 'life', 'awaiting_ec', 'approved', :jowner, now());
update app.membership_applications set status = 'approved', ec_decided_by = :jowner, ec_decided_at = now()
 where id = '36000000-0000-4000-8000-0000000000d1';
select pg_temp.assert((select status from app.membership_applications where id = '36000000-0000-4000-8000-0000000000d1') = 'approved',
  'D · the owner makes the Executive Committee decision on a life membership');
select pg_temp.assert_raises($$update app.membership_applications set status = 'approved', ec_decided_by = '36000000-0000-4000-8000-000000000003', ec_decided_at = now()
                               where id = '36000000-0000-4000-8000-0000000000d2'$$,
  'different person', 'D · …but never as the second person on their own review');
select pg_temp.assert_raises($$update app.membership_applications set status = 'approved', ec_decided_by = '36000000-0000-4000-8000-000000000004', ec_decided_at = now()
                               where id = '36000000-0000-4000-8000-0000000000d2'$$,
  'Executive Committee role', 'D · an administrator without the role cannot make that decision');
-- Resetting another admin's 2FA still needs a separate administrator.
set role authenticated;
select pg_temp.claims(:jowner, true);
select pg_temp.assert_raises(format($$select app.reset_staff_2fa(%L, %L, 'lost phone')$$, :jsh, :jadmin),
  'Only another administrator', 'D · the owner (no administrator grant) cannot reset another admin''s 2FA');
reset role;
select pg_temp.no_claims();
select pg_temp.assert(exists (select 1 from auth.mfa_factors where user_id = :jadmin), 'D · the admin''s authenticator app is untouched');
insert into app.role_grants (center_id, user_id, role_key, reason) values (:jsh, :cc2, 'center_admin', 'f-sandbox test: a separate administrator');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status) values ('f3600000-0000-4000-8000-000000000002', :cc2, 'Phone', 'totp', 'verified');
update app.accounts set is_platform_admin = false where user_id = :cc2;
set role authenticated;
select pg_temp.claims(:cc2, true);
select pg_temp.assert(app.reset_staff_2fa(:jsh, :jadmin, 'lost phone, identity checked in person') = 1, 'D · a separate administrator can');
reset role;
select pg_temp.no_claims();

rollback;
