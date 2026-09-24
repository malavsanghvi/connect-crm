-- 0320 (stream o-platform-setup): the platform setup wizard — platform secrets in
-- the vault, platform settings, wizard steps with park-for-later, the worker readers.
\set ON_ERROR_STOP 1
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
create or replace function pg_temp.assert_state(stmt text, state text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if sqlstate <> state then raise exception 'FAIL: % (got % "%")', label, sqlstate, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.claims(p_user text, p_step_up boolean default false) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', case when p_step_up then 'aal2' else 'aal1' end,
    'amr', case when p_step_up
                then jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 3600),
                                       jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 60))
                else jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 60)) end)::text, true);
end $$;

grant connect_worker to postgres;

\set pa '''30000000-0000-4000-8000-0000000000a1'''
\set staff '''30000000-0000-4000-8000-0000000000a2'''
\set jsh '''00000000-0000-4000-8000-000000000001'''
insert into auth.users (id, email) values (:pa, 'setup.platform@example.com'), (:staff, 'setup.staff@example.com');
insert into app.accounts (user_id, is_platform_admin) values (:pa, true);
insert into app.role_grants (center_id, user_id, role_key, scope_kind) values (:jsh, :staff, 'center_admin', 'center');

-- ── Structure ────────────────────────────────────────────────────────────────
select pg_temp.assert((select count(*) from app.platform_setup_steps) = 10
                      and (select array_agg(key order by sort) from app.platform_setup_steps where required) = '{background,portal,email,hooks}',
  'the wizard has 10 steps and exactly four are required (background service, portal address, email, sign-in hooks)');
select pg_temp.assert((select bool_and(relrowsecurity) from pg_class where oid in ('app.platform_secrets'::regclass, 'app.platform_settings'::regclass, 'app.platform_setup_steps'::regclass)),
  'RLS is on for the three new tables');
select pg_temp.assert(not has_column_privilege('authenticated', 'app.platform_secrets', 'vault_secret_id', 'select'),
  'vault_secret_id is not granted to signed-in users');
select pg_temp.assert(not has_table_privilege('authenticated', 'app.platform_secrets', 'insert')
                      and not has_table_privilege('authenticated', 'app.platform_settings', 'update')
                      and not has_table_privilege('authenticated', 'app.platform_setup_steps', 'update'),
  'nobody writes the tables over the API (only the RPCs do)');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.worker_read_platform_secret(text, text)', 'execute')
                      and not has_function_privilege('anon', 'app.worker_platform_config()', 'execute')
                      and has_function_privilege('connect_worker', 'app.worker_read_platform_secret(text, text)', 'execute'),
  'only connect_worker may call the platform readers');
select pg_temp.assert(not ('WORKER_DATABASE_URL' = any (app.platform_secret_names())) and not ('WORKER_DATABASE_URL' = any (app.platform_setting_keys())),
  'WORKER_DATABASE_URL cannot be stored in the app (bootstrap)');

-- ── Secrets: platform admin + fresh 2FA + reason ─────────────────────────────
begin;
select pg_temp.claims(:staff, true);
set local role authenticated;
select pg_temp.assert_state($s$select app.set_platform_secret('STRIPE_TEST_SECRET_KEY', 'sk_test_e2e_platform_1234', 'first key')$s$, '42501',
  'an organization admin cannot set a platform key');
rollback;
begin;
select pg_temp.claims(:pa, false);
set local role authenticated;
select pg_temp.assert_state($s$select app.set_platform_secret('STRIPE_TEST_SECRET_KEY', 'sk_test_e2e_platform_1234', 'first key')$s$, 'CCSTP',
  'without a fresh 2FA check the platform admin gets CCSTP');
rollback;
begin;
select pg_temp.claims(:pa, true);
set local role authenticated;
select pg_temp.assert_raises($s$select app.set_platform_secret('WORKER_DATABASE_URL', 'postgres://x:y@z/db', 'try')$s$, 'is not a platform key',
  'an unknown name (the bootstrap connection string) is refused');
select pg_temp.assert_raises($s$select app.set_platform_secret('STRIPE_TEST_SECRET_KEY', 'sk_test_e2e_platform_1234', '  ')$s$, 'say why',
  'a reason is required');
select pg_temp.assert_raises($s$select app.set_platform_secret('STRIPE_TEST_SECRET_KEY', 'short', 'x')$s$, 'too short', 'a too-short value is refused');
select pg_temp.assert(app.set_platform_secret('stripe_test_secret_key', 'sk_test_e2e_platform_1234', 'Community Connect Stripe test key') ->> 'fingerprint' = '1234',
  'the platform admin saves a key and gets the fingerprint only');
select pg_temp.assert((select fingerprint = '1234' and set_by = '30000000-0000-4000-8000-0000000000a1' and rotated_at is null
                         from app.platform_secrets where name = 'STRIPE_TEST_SECRET_KEY'),
  'the row keeps the last 4 characters, who and when');
select pg_temp.assert((app.set_platform_secret('STRIPE_TEST_SECRET_KEY', 'sk_test_e2e_platform_9876', 'rotate')->>'rotated')::boolean,
  'saving again rotates it in place');
commit;
reset role;
select pg_temp.assert((select count(*) from vault.secrets where name = 'connect/platform/STRIPE_TEST_SECRET_KEY') = 1
                      and (select decrypted_secret from vault.decrypted_secrets where name = 'connect/platform/STRIPE_TEST_SECRET_KEY') = 'sk_test_e2e_platform_9876',
  'the value lives in the vault (one entry, updated on rotation)');
select pg_temp.assert((select count(*) from app.audit_log where action like 'platform_secrets.%' and record_id = 'STRIPE_TEST_SECRET_KEY') = 2
                      and not exists (select 1 from app.audit_log where action like 'platform_secrets.%' and (before::text like '%sk_test_e2e%' or after::text like '%sk_test_e2e%'))
                      and (select reason from app.audit_log where action = 'platform_secrets.insert' and record_id = 'STRIPE_TEST_SECRET_KEY') = 'Community Connect Stripe test key',
  'both saves are audited with the reason, and the audit never carries the value');
begin;
select pg_temp.claims(:pa, true);
set local role authenticated;
select pg_temp.assert((select count(*) from app.platform_secrets) >= 1, 'platform admins see the fingerprints');
select pg_temp.assert_raises('select vault_secret_id from app.platform_secrets', 'permission denied', 'but not the vault id');
rollback;
begin;
select pg_temp.claims(:staff, true);
set local role authenticated;
select pg_temp.assert((select count(*) from app.platform_secrets) = 0 and (select count(*) from app.platform_settings) = 0,
  'an organization admin sees no platform keys or settings');
rollback;

-- ── Settings ─────────────────────────────────────────────────────────────────
begin;
select pg_temp.claims(:pa, true);
set local role authenticated;
select pg_temp.assert(app.set_platform_setting('portal_domain', 'https://CRM.CommunityConnect.test/', 'Our portal') ->> 'value' = 'crm.communityconnect.test',
  'the portal domain is normalized to a bare lower-case host');
select pg_temp.assert(app.set_platform_setting('wildcard_domain', 'HTTPS://Communityconnect.test:8443/', 'x') ->> 'value' = 'communityconnect.test',
  'port, path and case are dropped');
select pg_temp.assert((select value from app.platform_settings where key = 'wildcard_domain') = '"communityconnect.test"'::jsonb,
  'the value is stored as a JSON string (o-https reads it)');
select pg_temp.assert(app.set_platform_setting('wildcard_domain', '*.communityconnect.test', 'Organizations') ->> 'value' = 'communityconnect.test',
  'the wildcard domain drops the "*."');
select pg_temp.assert_raises($s$select app.set_platform_setting('portal_domain', 'crm example', 'x')$s$, 'domain name only', 'a malformed domain is refused');
select pg_temp.assert_raises($s$select app.set_platform_setting('MESSAGING_EMAIL_PROVIDER', 'sendgrid', 'x')$s$, 'Resend or Postmark', 'an unknown email provider is refused');
select pg_temp.assert_raises($s$select app.set_platform_setting('TWILIO_FROM_NUMBER', '832-555-0100', 'x')$s$, 'international format', 'a phone number must be E.164');
select pg_temp.assert_raises($s$select app.set_platform_setting('SUPABASE_SECRET_KEY', 'x', 'x')$s$, 'not a platform setting', 'unknown setting keys are refused');
select app.set_platform_setting('MESSAGING_FROM_ADDRESS', 'no-reply@mail.communityconnect.test', 'Sender');
commit;
begin;
select pg_temp.claims(:pa, false);
set local role authenticated;
select pg_temp.assert_state($s$select app.set_platform_setting('STRIPE_CLIENT_ID', 'ca_e2e_fake_client', 'x')$s$, 'CCSTP', 'settings also need a fresh 2FA check');
rollback;

-- The on-demand TLS ask (anon): only yes/no for the platform's own names.
begin;
set local role anon;
select pg_temp.assert(app.platform_domain_allowed('crm.communityconnect.test') and app.platform_domain_allowed('communityconnect.test')
                      and app.platform_domain_allowed('www.communityconnect.test') and not app.platform_domain_allowed('evil.example.com')
                      and not app.platform_domain_allowed(null),
  'platform_domain_allowed answers yes for the portal and wildcard base names only');
rollback;

-- ── Wizard steps: required cannot be parked ──────────────────────────────────
begin;
select pg_temp.claims(:pa, true);
set local role authenticated;
select pg_temp.assert_raises($s$select app.park_platform_setup_step('email', 'later')$s$, 'required and cannot be parked', 'a required step cannot be parked');
select pg_temp.assert_raises($s$select app.park_platform_setup_step('payments', '')$s$, 'say why', 'parking needs a reason');
select app.park_platform_setup_step('payments', 'No Stripe account yet');
select pg_temp.assert((select status = 'parked' and parked_by = '30000000-0000-4000-8000-0000000000a1' and parked_at is not null and note = 'No Stripe account yet'
                         from app.platform_setup_steps where key = 'payments'),
  'an optional step is parked with who, when and why');
select app.complete_platform_setup_step('payments', 'Keys saved and tested');
select pg_temp.assert((select status = 'done' and parked_at is null and completed_by is not null from app.platform_setup_steps where key = 'payments'),
  'completing a parked step clears the parking');
select app.reopen_platform_setup_step('payments', 'Re-check');
select pg_temp.assert((select status from app.platform_setup_steps where key = 'payments') = 'not_started', 'a step can be reopened');
commit;
reset role;
select pg_temp.assert((select reason from app.audit_log where action = 'platform_setup_steps.update' and record_id = 'payments' order by id desc limit 1) = 'Re-check',
  'step changes are audited with the reason');
begin;
select pg_temp.claims(:staff, true);
set local role authenticated;
select pg_temp.assert_state($s$select app.park_platform_setup_step('ai', 'no')$s$, '42501', 'an organization admin cannot touch the wizard');
select pg_temp.assert_state($s$select app.enqueue_platform_test('payments')$s$, '42501', 'nor queue its tests');
rollback;
begin;
select pg_temp.claims(:pa, true);
set local role authenticated;
select set_config('test.job', app.enqueue_platform_test('payments')::text, true);
select pg_temp.assert((select kind = 'platform.test_provider' and center_id is null and payload->>'step' = 'payments'
                         from app.jobs where id = current_setting('test.job')::bigint),
  'the Test button queues a platform-wide platform.test_provider job');
select pg_temp.assert_raises($s$select app.enqueue_platform_test('portal')$s$, 'no background test', 'only provider steps have a worker test');
select pg_temp.assert(app.platform_auth_hook_activity(now() - interval '1 minute') is not null, 'the hook activity summary answers');
rollback;

-- ── The readers (connect_worker) ─────────────────────────────────────────────
begin;
set local role connect_worker;
select pg_temp.assert((select (c->'secrets'->'STRIPE_TEST_SECRET_KEY'->>'fingerprint') = '9876' and c->'settings'->>'portal_domain' = 'crm.communityconnect.test'
                              and c::text not like '%sk_test_e2e%'
                         from app.worker_platform_config() c),
  'worker_platform_config gives settings and secret fingerprints/versions, never a value');
select set_config('app.worker_id', 'test-worker', true);
select pg_temp.assert(app.worker_read_platform_secret('STRIPE_TEST_SECRET_KEY', 'platform config') = 'sk_test_e2e_platform_9876',
  'the worker reads the value');
select pg_temp.assert(app.worker_read_platform_secret('ANTHROPIC_API_KEY', 'platform config') is null, 'an unset key reads as NULL');
commit;
reset role;
select pg_temp.assert((select count(*) from app.secret_access_log where name = 'platform:STRIPE_TEST_SECRET_KEY' and reader = 'test-worker'
                         and outcome = 'read' and connection_id is null and center_id is null) = 1
                      and (select count(*) from app.secret_access_log where name = 'platform:ANTHROPIC_API_KEY' and outcome = 'missing') = 1,
  'every platform read is logged in secret_access_log (read and missing)');
begin;
select pg_temp.claims(:pa, true);
set local role authenticated;
select pg_temp.assert_raises($s$select app.worker_read_platform_secret('STRIPE_TEST_SECRET_KEY')$s$, 'permission denied', 'a platform admin cannot read a value back');
rollback;
begin;
select pg_temp.claims(:staff, true);
set local role authenticated;
select pg_temp.assert((select count(*) from app.secret_access_log where name like 'platform:%') = 0,
  'organization staff never see the platform access log');
rollback;

-- ── Who saved what (0321) ────────────────────────────────────────────────────
begin;
select pg_temp.claims(:pa, false);
set local role authenticated;
select pg_temp.assert((select count(*) from app.platform_admin_directory() where email = 'setup.platform@example.com') = 1,
  'a platform admin sees the platform admins by email');
rollback;
begin;
select pg_temp.claims(:staff, true);
set local role authenticated;
select pg_temp.assert_state('select * from app.platform_admin_directory()', '42501', 'an organization admin cannot list them');
rollback;
