-- 0787 (owner rule 2026-10-14): a fresh 2FA code is asked for only on four gatekeeping actions: creating a sandbox, approving
-- go-live, promoting to production and granting a module (a marketplace feature) to an organization. Every other action runs
-- without one, for a person who has an authenticator too. Sign-in's own 2FA gate is not touched.
--   A. The list   B. The four still refuse without a fresh code, and pass with one   C. Everything else passes without a code
--   D. Real actions that used to ask   E. Who may call what
-- Everything runs in one transaction that is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
-- The statement must raise exactly this SQLSTATE.
create or replace function pg_temp.assert_state(stmt text, state text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if sqlstate <> state then raise exception 'FAIL: % (got % "%")', label, sqlstate, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
-- The statement must run without any error.
create or replace function pg_temp.assert_ok(stmt text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise notice 'PASS: %', label;
exception when others then
  raise exception 'FAIL: % (raised % "%")', label, sqlstate, sqlerrm;
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
create or replace function pg_temp.no_claims() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '', true); end $$;

\set pat '''18400000-0000-4000-8000-000000000001'''

select pg_temp.no_claims();
insert into auth.users (id, email) values (:pat, 'pat184@platform.test');
insert into app.accounts (user_id, is_platform_admin) values (:pat, true) on conflict (user_id) do update set is_platform_admin = true;
-- A platform admin who HAS an authenticator app (so a missing fresh code is a refusal, not "set one up first").
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status)
values ('18400000-0000-4000-8000-0000000000f1', :pat, 'Phone', 'totp', 'verified');

-- ═════════════════════════════════════════════════════════════════════════════
-- A. The list
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert(app.step_up_required('platform.create_sandbox') and app.step_up_required('golive.approve')
                      and app.step_up_required('platform.promote') and app.step_up_required('platform.module_grant'),
  'A. the four gatekeeping actions ask for a fresh code: create a sandbox, approve go-live, promote to production, grant a module');
select pg_temp.assert(not app.step_up_required('giving.refund') and not app.step_up_required('roles.grant')
                      and not app.step_up_required('ownership.transfer') and not app.step_up_required('security.policy')
                      and not app.step_up_required('qbo.connect') and not app.step_up_required('qbo.approve_mapping')
                      and not app.step_up_required('payments.payee') and not app.step_up_required('payments.live')
                      and not app.step_up_required('integration_secret.set') and not app.step_up_required('modules.switch')
                      and not app.step_up_required('export.people') and not app.step_up_required('demo.signin_setup')
                      and not app.step_up_required('platform_setting.set') and not app.step_up_required('platform.create_demo_community')
                      and not app.step_up_required('') and not app.step_up_required(null) and not app.step_up_required('anything new'),
  'A. nothing else does: refunds, role grants, secrets, payee changes, exports, QuickBooks, demo sign-in, platform settings, a new action nobody listed');

-- ═════════════════════════════════════════════════════════════════════════════
-- B. The four: refused without a fresh code (for someone with an authenticator), accepted with one
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.claims(:pat, false);
select pg_temp.assert_state($$select app.assert_step_up('platform.create_sandbox')$$, 'CCSTP', 'B. creating a sandbox needs a fresh code');
select pg_temp.assert_state($$select app.assert_step_up('golive.approve')$$, 'CCSTP', 'B. approving go-live needs a fresh code');
select pg_temp.assert_state($$select app.assert_step_up('platform.promote')$$, 'CCSTP', 'B. promoting to production needs a fresh code');
select pg_temp.assert_state($$select app.assert_step_up('platform.module_grant')$$, 'CCSTP', 'B. granting a module (a marketplace feature) needs a fresh code');
select pg_temp.assert_state($$select app.assert_platform_step_up('platform.create_sandbox')$$, 'CCSTP', 'B. the platform check asks for it on a listed action too');
select pg_temp.claims(:pat, true);
select pg_temp.assert_ok($$select app.assert_step_up('platform.create_sandbox'), app.assert_step_up('golive.approve'),
                                  app.assert_step_up('platform.promote'), app.assert_step_up('platform.module_grant')$$,
  'B. with a fresh code the four pass');

-- ═════════════════════════════════════════════════════════════════════════════
-- C. Everything else runs without a code, even for someone who has an authenticator
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.claims(:pat, false);
select pg_temp.assert_ok($$select app.assert_step_up('giving.refund'), app.assert_step_up('giving.write_off'), app.assert_step_up('accounting.month_lock'),
                                  app.assert_step_up('people.merge'), app.assert_step_up('export.people'), app.assert_step_up('roles.grant'),
                                  app.assert_step_up('ownership.transfer'), app.assert_step_up('security.policy'), app.assert_step_up('access.change'),
                                  app.assert_step_up('modules.switch'), app.assert_step_up('payments.payee'), app.assert_step_up('payments.connect'),
                                  app.assert_step_up('payments.live'), app.assert_step_up('qbo.connect'), app.assert_step_up('qbo.disconnect'),
                                  app.assert_step_up('qbo.approve_mapping'), app.assert_step_up('qbo.approve_test_post'),
                                  app.assert_step_up('qbo.change_basis'), app.assert_step_up('integration_secret.set'),
                                  app.assert_step_up('support.grant'), app.assert_step_up('activity.consent'), app.assert_step_up('a brand new action')$$,
  'C. refunds, write-offs, month lock, merges, exports, role grants, ownership, security policy, access, modules, payments, QuickBooks, secrets, support and consent run without a code');
select pg_temp.assert_ok($$select app.assert_platform_step_up('platform_setting.set'), app.assert_platform_step_up('platform_secret.set'),
                                  app.assert_platform_step_up('demo.signin_setup'), app.assert_platform_step_up('demo.signin_switch')$$,
  'C. the platform''s own settings, secrets and demo sign-in run without a code');

-- ═════════════════════════════════════════════════════════════════════════════
-- D. Real actions that used to ask
-- ═════════════════════════════════════════════════════════════════════════════
select app.create_demo_community('faith') as r \gset
select pg_temp.assert(((:'r'::jsonb)->>'created')::boolean, 'D. a platform admin creates the demo community without a fresh code');
select app.reset_demo_community(((:'r'::jsonb)->>'center_id')::uuid) as rr \gset
select pg_temp.assert(((:'rr'::jsonb)->>'center_id') = ((:'r'::jsonb)->>'center_id'), 'D. and starts it over without a fresh code');
select pg_temp.assert((select count(*) from app.demo_personas where center_id = ((:'r'::jsonb)->>'center_id')::uuid) = 26,
  'D. with its 26 demo people');
select pg_temp.assert((app.demo_signin_setup('Set up the demo sign-ins')->>'created')::int >= 0,
  'D. and sets up the demo sign-ins without a fresh code');

-- ═════════════════════════════════════════════════════════════════════════════
-- E. Who may call what
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert(not has_function_privilege('authenticated', 'app.step_up_required(text)', 'execute')
                      and not has_function_privilege('anon', 'app.step_up_required(text)', 'execute'),
  'E. the list is internal: users and visitors cannot call it');
select pg_temp.assert(exists (select 1 from pg_proc where proname = 'staff_2fa_required' and pronamespace = 'app'::regnamespace)
                      and exists (select 1 from pg_proc where proname = 'has_verified_totp' and pronamespace = 'app'::regnamespace),
  'E. the sign-in gate (staff_2fa_required) and the authenticator check are still there: only the second code in the middle of a session went');

rollback;
\echo 'PASS: a fresh 2FA code only on the four gatekeeping actions'
