-- 0170–0172 (stream o-vault): the credential vault, the job queue and the
-- background service, and the storage buckets and their policies.
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
  if position(lower(expect) in lower(sqlerrm)) = 0 then
    raise exception 'FAIL: % (got "%")', label, sqlerrm;
  end if;
  raise notice 'PASS: %', label;
end $$;
-- Runs a statement that must fail with this SQLSTATE.
create or replace function pg_temp.assert_state(stmt text, state text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if sqlstate <> state then raise exception 'FAIL: % (got % "%")', label, sqlstate, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
-- JWT claims for a signed-in user; p_step_up adds a TOTP entry from a minute ago.
create or replace function pg_temp.claims(p_user text, p_step_up boolean default false, p_age_minutes int default 1) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', case when p_step_up then 'aal2' else 'aal1' end,
    'amr', case when p_step_up
                then jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 3600),
                                       jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - p_age_minutes * 60))
                else jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 60)) end)::text, true);
end $$;

\set jsh '''00000000-0000-4000-8000-000000000001'''
\set other '''00000000-0000-4000-8000-000000000002'''
-- Users: 01 Priya (adult, Shah household 20…01), 02 Dev (child 30…03 in that
-- household), 03 Tara (treasurer: integrations.view, giving.manage), 04 teacher
-- of Dev's class, 05 Kiran (other household), 07 admin of the other center,
-- 11 Ada (center admin: integrations.manage, settings.manage), a9…02 platform admin.

-- The tests switch to connect_worker; a hosted postgres holds ADMIN on it but not SET.
grant connect_worker to postgres;

insert into app.integration_connections (id, center_id, provider, status, display_name)
values ('c0170000-0000-4000-8000-000000000001', :jsh, 'stripe', 'connected', 'Stripe (test)'),
       ('c0170000-0000-4000-8000-000000000002', :other, 'stripe', 'connected', 'Other Stripe');

-- ── Vault is closed to the API roles ─────────────────────────────────────────
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000011', true);
set local role authenticated;
select pg_temp.assert_raises('select * from vault.secrets', 'permission denied', 'authenticated cannot read vault.secrets');
select pg_temp.assert_raises('select * from vault.decrypted_secrets', 'permission denied', 'authenticated cannot read vault.decrypted_secrets');
rollback;
begin;
set local role anon;
select pg_temp.assert_raises('select * from vault.decrypted_secrets', 'permission denied', 'anon cannot read vault.decrypted_secrets');
rollback;

-- ── Setting a secret ─────────────────────────────────────────────────────────
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000011', false);
set local role authenticated;
select pg_temp.assert_state($s$select app.set_integration_secret('c0170000-0000-4000-8000-000000000001', 'api_key', 'sk_test_ABCDEFGH1234', 'Initial key')$s$,
  'CCSTP', 'without a fresh 2FA check the admin gets CCSTP');
rollback;
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000011', true, 30);
set local role authenticated;
select pg_temp.assert_state($s$select app.set_integration_secret('c0170000-0000-4000-8000-000000000001', 'api_key', 'sk_test_ABCDEFGH1234', 'Initial key')$s$,
  'CCSTP', 'a 2FA check from 30 minutes ago is not fresh');
rollback;

begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000011', true);
set local request.headers = '{"x-client-app":"portal","x-client-screen":"/settings/integrations"}';
set local role authenticated;
select pg_temp.assert((app.set_integration_secret('c0170000-0000-4000-8000-000000000001', 'api_key', 'sk_test_ABCDEFGH1234', 'Initial key')
                       ->>'fingerprint') = '1234', 'an admin with integrations.manage and a fresh 2FA check sets a secret; the fingerprint is the last 4');
select pg_temp.assert_raises($s$select app.set_integration_secret('c0170000-0000-4000-8000-000000000001', 'api_key', 'sk_test_ABCDEFGH1234', '  ')$s$,
  'say why', 'a reason is required');
select pg_temp.assert_raises($s$select app.set_integration_secret('c0170000-0000-4000-8000-000000000001', 'api_key', 'short', 'x')$s$,
  'too short', 'a value too short to be a secret is refused');
select pg_temp.assert_raises($s$select app.set_integration_secret('c0170000-0000-4000-8000-000000000001', 'API KEY!', 'sk_test_ABCDEFGH1234', 'x')$s$,
  'short name', 'a badly formed secret name is refused');
select pg_temp.assert((select count(*) = 1 and bool_and(fingerprint = '1234' and set_by = '10000000-0000-4000-8000-000000000011')
                         from app.integration_secrets where connection_id = 'c0170000-0000-4000-8000-000000000001'),
  'the admin sees the fingerprint row');
select pg_temp.assert_raises('select vault_secret_id from app.integration_secrets', 'permission denied',
  'vault_secret_id is not readable over the API');
select pg_temp.assert_raises($s$insert into app.integration_secrets (center_id, connection_id, name, vault_secret_id, fingerprint)
                               values ('00000000-0000-4000-8000-000000000001', 'c0170000-0000-4000-8000-000000000001', 'x', gen_random_uuid(), 'abcd')$s$,
  'permission denied', 'nobody writes integration_secrets directly');
commit;
select pg_temp.assert((select d.decrypted_secret = 'sk_test_ABCDEFGH1234' and s.secret <> 'sk_test_ABCDEFGH1234'
                         from app.integration_secrets i join vault.decrypted_secrets d on d.id = i.vault_secret_id
                         join vault.secrets s on s.id = i.vault_secret_id
                        where i.connection_id = 'c0170000-0000-4000-8000-000000000001' and i.name = 'api_key'),
  'the value is in the vault, and not stored as plain text');
select pg_temp.assert(not exists (select 1 from app.audit_log where coalesce(before::text, '') || coalesce(after::text, '') || coalesce(reason, '') like '%ABCDEFGH%'),
  'the value appears in no audit entry');
select pg_temp.assert((select reason = 'Initial key' and client_app = 'portal' and actor_user_id = '10000000-0000-4000-8000-000000000011'
                          and after->>'fingerprint' = '1234'
                         from app.audit_log where action = 'integration_secrets.insert' order by id desc limit 1),
  'setting a secret is audited with the reason, the app and the fingerprint');

-- Replace: the vault entry is updated in place and rotated_at is stamped.
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000011', true);
set local role authenticated;
select pg_temp.assert((app.set_integration_secret('c0170000-0000-4000-8000-000000000001', 'api_key', 'sk_test_NEWVALUE9876', 'Rotated after staff change')
                       ->>'rotated')::boolean, 'setting the same name again is a rotation');
commit;
select pg_temp.assert((select i.rotated_at is not null and i.fingerprint = '9876' and d.decrypted_secret = 'sk_test_NEWVALUE9876'
                          and (select count(*) from vault.secrets where name like 'connect/c0170000-0000-4000-8000-000000000001/%') = 1
                         from app.integration_secrets i join vault.decrypted_secrets d on d.id = i.vault_secret_id
                        where i.connection_id = 'c0170000-0000-4000-8000-000000000001'),
  'rotation updates the one vault entry and stamps rotated_at');

-- Who may not.
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select pg_temp.assert_raises($s$select app.set_integration_secret('c0170000-0000-4000-8000-000000000001', 'api_key', 'sk_test_ZZZZZZZZ0000', 'x')$s$,
  'owner or the integrations.manage', 'the treasurer (integrations.view only) cannot change a secret');
select pg_temp.assert((select count(*) from app.integration_secrets) = 1, 'the treasurer can see the fingerprint (integrations.view)');
rollback;
begin;
select pg_temp.claims('a9000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select pg_temp.assert_raises($s$select app.set_integration_secret('c0170000-0000-4000-8000-000000000001', 'api_key', 'sk_test_ZZZZZZZZ0000', 'x')$s$,
  'owner or the integrations.manage', 'a platform admin cannot change an organization''s secret');
rollback;
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000007', true);
set local role authenticated;
select pg_temp.assert_raises($s$select app.set_integration_secret('c0170000-0000-4000-8000-000000000001', 'api_key', 'sk_test_ZZZZZZZZ0000', 'x')$s$,
  'owner or the integrations.manage', 'another center''s admin cannot change this center''s secret');
select pg_temp.assert((select count(*) from app.integration_secrets) = 0, 'another center''s admin sees none of its fingerprints');
rollback;
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select pg_temp.assert((select count(*) from app.integration_secrets) = 0 and (select count(*) from app.secret_access_log) = 0,
  'a member sees no fingerprints and no access log');
rollback;

-- The owner may, through app.is_center_owner (a scratch app.center_owners when o-security is not merged).
begin;
do $$ begin
  if to_regclass('app.center_owners') is null then
    create table app.center_owners (center_id uuid primary key, user_id uuid not null);
  end if;
end $$;
insert into app.center_owners (center_id, user_id) values ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001')
on conflict (center_id) do update set user_id = excluded.user_id;
select pg_temp.claims('10000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select pg_temp.assert(app.is_center_owner('00000000-0000-4000-8000-000000000001'), 'is_center_owner is true for the owner');
select pg_temp.assert((app.set_integration_secret('c0170000-0000-4000-8000-000000000001', 'webhook_secret', 'whsec_test_OWNER4242', 'Owner adds the webhook secret')
                       ->>'fingerprint') = '4242', 'the owner (without integrations.manage) sets a secret with step-up');
rollback;

-- ── The one reader ───────────────────────────────────────────────────────────
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000011', true);
set local role authenticated;
select pg_temp.assert_raises($s$select app.worker_read_secret('c0170000-0000-4000-8000-000000000001', 'api_key')$s$,
  'permission denied', 'a signed-in admin cannot call worker_read_secret');
rollback;
begin;
grant execute on function app.worker_read_secret(uuid, text, text) to service_role;   -- as a later blanket grant would
set local role service_role;
select pg_temp.assert_raises($s$select app.worker_read_secret('c0170000-0000-4000-8000-000000000001', 'api_key')$s$,
  'only the background service', 'even with EXECUTE granted, service_role is refused by the worker check');
rollback;
begin;
set local role connect_worker;
select set_config('app.worker_id', 'worker-test-1', true), set_config('app.job_id', '4242', true);
select pg_temp.assert(app.worker_read_secret('c0170000-0000-4000-8000-000000000001', 'api_key', 'demo.ping test') = 'sk_test_NEWVALUE9876',
  'connect_worker reads the secret');
select pg_temp.assert(app.worker_read_secret('c0170000-0000-4000-8000-000000000001', 'nope') is null,
  'reading a secret that is not stored returns NULL');
select pg_temp.assert_raises('select count(*) from app.integration_secrets', 'permission denied',
  'connect_worker has no direct access to the fingerprint table');
select pg_temp.assert_raises('select count(*) from vault.secrets', 'permission denied', 'connect_worker has no access to the vault itself');
commit;
select pg_temp.assert((select array_agg(outcome || '|' || reader || '|' || purpose || '|' || job_id || '|' || center_id order by id)
                         from app.secret_access_log)
                       = array['read|worker-test-1|demo.ping test|4242|00000000-0000-4000-8000-000000000001',
                               'missing|worker-test-1|unspecified|4242|00000000-0000-4000-8000-000000000001'],
  'every read is logged: reader, purpose, job, center and whether it was there');
select pg_temp.assert((select client_app = 'job' and actor_user_id is null from app.audit_log
                        where action = 'secret_access_log.insert' order by id desc limit 1),
  'the access log entry is itself audited as a job');
select pg_temp.assert_raises('update app.secret_access_log set purpose = ''x''', 'cannot be changed', 'the access log is append-only');

-- ── Revoking ─────────────────────────────────────────────────────────────────
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000011', false);
set local role authenticated;
select pg_temp.assert_state($s$select app.revoke_integration_secret('c0170000-0000-4000-8000-000000000001', 'api_key', 'Disconnecting')$s$,
  'CCSTP', 'revoking needs a fresh 2FA check');
rollback;
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000011', true);
set local role authenticated;
select app.revoke_integration_secret('c0170000-0000-4000-8000-000000000001', 'api_key', 'Disconnecting Stripe');
commit;
select pg_temp.assert(not exists (select 1 from app.integration_secrets where connection_id = 'c0170000-0000-4000-8000-000000000001')
                      and not exists (select 1 from vault.secrets where name like 'connect/c0170000-0000-4000-8000-000000000001/%'),
  'revoking removes the fingerprint row and the vault entry');
select pg_temp.assert((select reason = 'Disconnecting Stripe' from app.audit_log where action = 'integration_secrets.delete' order by id desc limit 1),
  'revoking is audited with the reason');

-- The worker stores what a provider hands back (0173).
begin;
set local role connect_worker;
select pg_temp.assert((app.worker_store_secret('c0170000-0000-4000-8000-000000000001', 'oauth.refresh_token', 'rt_test_TOKEN5678', 'job 5 oauth.exchange')
                       ->>'fingerprint') = '5678', 'the worker stores a provider token in the vault');
commit;
select pg_temp.assert((select i.set_by is null and d.decrypted_secret = 'rt_test_TOKEN5678'
                         from app.integration_secrets i join vault.decrypted_secrets d on d.id = i.vault_secret_id
                        where i.name = 'oauth.refresh_token'), 'stored by the service (no person), value in the vault');
select pg_temp.assert((select reason = 'Background service: job 5 oauth.exchange' and client_app = 'job' and actor_user_id is null
                         from app.audit_log where action = 'integration_secrets.insert' order by id desc limit 1),
  'the worker''s write is audited as a job with its purpose');
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000011', true);
set local role authenticated;
select pg_temp.assert_raises($s$select app.worker_store_secret('c0170000-0000-4000-8000-000000000001', 'x', 'yyyyyyyyyy', 'x')$s$,
  'permission denied', 'people cannot use the worker''s store function');
rollback;

-- ── Job queue ────────────────────────────────────────────────────────────────
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000011');
set local role authenticated;
select pg_temp.assert_raises($s$select app.enqueue_job('00000000-0000-4000-8000-000000000001', 'demo.ping', '{}')$s$,
  'permission denied', 'enqueue_job is not callable over the API');
select pg_temp.assert(app.enqueue_worker_test('00000000-0000-4000-8000-000000000001') > 0, 'an admin queues a test job');
select pg_temp.assert_raises($s$select app.claim_jobs('x', array['demo.ping'], 5)$s$, 'permission denied', 'claim_jobs is not callable by users');
commit;
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.assert_raises($s$select app.enqueue_worker_test('00000000-0000-4000-8000-000000000001')$s$,
  'needs settings.manage', 'a member cannot queue a test job');
select pg_temp.assert((select count(*) from app.jobs) = 0, 'a member sees no jobs');
rollback;
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000007');
set local role authenticated;
select pg_temp.assert((select count(*) from app.jobs) = 0, 'another center''s admin sees none of this center''s jobs');
rollback;
select pg_temp.assert((select created_by = '10000000-0000-4000-8000-000000000011' and status = 'queued' and kind = 'demo.ping' and max_attempts = 3
                         from app.jobs order by id desc limit 1), 'the test job records who asked');

begin;
set local role connect_worker;
create temp table claimed as select * from app.claim_jobs('worker-a', array['demo.ping'], 10);
select pg_temp.assert((select count(*) = 1 and bool_and(status = 'running' and attempts = 1 and locked_by = 'worker-a') from claimed),
  'claim_jobs takes the due job, marks it running and counts the attempt');
select pg_temp.assert((select count(*) from app.claim_jobs('worker-b', array['demo.ping'], 10)) = 0, 'a running job is not claimed twice');
select pg_temp.assert(app.fail_job((select id from claimed), 'provider timed out') = 'retrying', 'a first failure is retried');
select pg_temp.assert((select count(*) from app.claim_jobs('worker-a', array['demo.ping'], 10)) = 0, 'a job in backoff is not claimed early');
select pg_temp.assert_raises('select count(*) from app.jobs', 'permission denied', 'connect_worker has no direct access to the jobs table');
commit;
select pg_temp.assert((select status = 'queued' and run_after > now() + interval '20 seconds' and last_error = 'provider timed out'
                         from app.jobs where kind = 'demo.ping' order by id desc limit 1), 'the retry waits (backoff) and keeps the error');
update app.jobs set run_after = now() where kind = 'demo.ping';
select id as ping_id from app.jobs where kind = 'demo.ping' order by id desc limit 1 \gset
begin;
set local role connect_worker;
select pg_temp.assert((select attempts from app.claim_jobs('worker-a', array['demo.ping'], 10)) = 2, 'after the backoff it is claimed again (attempt 2)');
select app.finish_job(:ping_id, '{"pong":true}');
select pg_temp.assert_raises('select app.finish_job(' || :ping_id || ', ''{}'')',
  'is not running', 'a finished job cannot be finished again');
commit;
select pg_temp.assert((select status = 'done' and result = '{"pong":true}' and finished_at is not null and locked_by is null
                         from app.jobs where kind = 'demo.ping' order by id desc limit 1), 'finish_job stores the result');
select pg_temp.assert((select count(*) >= 4 and bool_and(client_app = 'job') from app.audit_log where action = 'jobs.update'),
  'every status change of a job is audited as a job');

-- Retries run out; a non-retryable failure fails at once; a dead worker's job is released.
select app.enqueue_job(:jsh, 'demo.ping', '{"n":2}', now(), 2) as n2 \gset
select app.enqueue_job(:jsh, 'demo.ping', '{"n":3}', now(), 5) as n3 \gset
begin;
set local role connect_worker;
select app.claim_jobs('worker-a', array['demo.ping'], 10);
select pg_temp.assert(app.fail_job(:n3, 'not configured', false) = 'failed', 'p_retry = false fails the job at once');
select app.fail_job(:n2, 'boom');
commit;
update app.jobs set run_after = now() where payload->>'n' = '2';
begin;
set local role connect_worker;
select app.claim_jobs('worker-a', array['demo.ping'], 10);
select pg_temp.assert(app.fail_job(:n2, 'boom again') = 'failed',
  'the last allowed attempt fails for good');
commit;
select app.enqueue_job(:jsh, 'demo.ping', '{"n":4}', now(), 5);
begin;
set local role connect_worker;
select app.claim_jobs('worker-dead', array['demo.ping'], 10);
commit;
update app.jobs set locked_at = now() - interval '20 minutes' where payload->>'n' = '4';
begin;
set local role connect_worker;
select pg_temp.assert((select locked_by = 'worker-a' and attempts = 2 from app.claim_jobs('worker-a', array['demo.ping'], 10)),
  'a job left running by a dead worker is released and claimed again');
commit;
select pg_temp.assert((select last_error like 'The background service stopped%' from app.jobs where payload->>'n' = '4'),
  'the released job says why');
select pg_temp.assert_raises($s$select app.enqueue_job(null, 'Bad Kind', '{}')$s$, 'area.action', 'a malformed job kind is refused');

-- ── Heartbeat, status, readiness ─────────────────────────────────────────────
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000011');
set local role authenticated;
select pg_temp.assert(app.background_service_status(:jsh)->>'state' = 'not_configured', 'with no heartbeat ever, the service reads "not configured"');
select pg_temp.assert(not (app.check_background_service(:jsh)->>'ok')::boolean, 'the readiness check fails with no heartbeat');
rollback;
select coalesce(max(id), 0) as audit_mark from app.audit_log \gset
begin;
set local role connect_worker;
select app.worker_heartbeat('worker-a', now() - interval '5 minutes', '0.1.0', array['demo.ping'],
                            '{"handlers":{"demo.ping":{"configured":true},"oauth.exchange":{"configured":false,"reason":"STRIPE_CLIENT_ID is not set"}}}');
select app.worker_heartbeat('worker-a', now() - interval '5 minutes', '0.1.0', array['demo.ping'],
                            '{"handlers":{"demo.ping":{"configured":true},"oauth.exchange":{"configured":false,"reason":"STRIPE_CLIENT_ID is not set"}}}');
commit;
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'worker_heartbeats' and id > :audit_mark) = 1,
  'a worker starting is audited; a plain tick is not');
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000011');
set local role authenticated;
select pg_temp.assert((select s->>'state' = 'running' and (s->'workers'->0->'handlers'->'oauth.exchange'->>'configured') = 'false'
                         from app.background_service_status(:jsh) s), 'status shows running and which handlers are configured');
select pg_temp.assert((app.check_background_service(:jsh)->>'ok')::boolean, 'the readiness check passes while it reports in');
select pg_temp.assert((select count(*) from app.worker_heartbeats) = 0, 'heartbeat rows are for platform admins only (the status RPC is the way in)');
rollback;
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.assert_raises($s$select app.background_service_status('00000000-0000-4000-8000-000000000001')$s$,
  'needs settings.manage', 'a member cannot see the background service status');
rollback;
update app.worker_heartbeats set beat_at = now() - interval '10 minutes';
select pg_temp.assert(not (app.check_background_service(:jsh)->>'ok')::boolean, 'a stale heartbeat fails the readiness check');
select pg_temp.assert((select check_fn = 'app.check_background_service'::regproc and title = 'Background service running'
                         from app.readiness_checks where key = 'background_service'), 'readiness_checks has the background service row');
begin;
set local role connect_worker;
select pg_temp.assert(app.worker_schedule('storage.retention', interval '1 day') is not null, 'worker_schedule queues a recurring job');
select pg_temp.assert(app.worker_schedule('storage.retention', interval '1 day') is null, 'and does not queue it twice');
select app.worker_stopped('worker-a');
commit;
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000011');
set local role authenticated;
select pg_temp.assert(app.background_service_status(:jsh)->>'state' = 'stopped', 'a worker that shut down cleanly reads "stopped", not "not configured"');
rollback;
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'worker_heartbeats' and action = 'worker_heartbeats.update'
                         and after->>'stopped_at' is not null and id > :audit_mark) = 1, 'the clean stop is audited');

-- ── Storage ──────────────────────────────────────────────────────────────────
select pg_temp.assert((select array_agg(id order by id) from storage.buckets where id in
                         ('branding','content','photos','store','statements','recordings','imports','org-documents','exports'))
                       = array['branding','content','exports','imports','org-documents','photos','recordings','statements','store']
                      and (select array_agg(id) from storage.buckets where public) = array['branding']
                      and not exists (select 1 from storage.buckets where file_size_limit is null or allowed_mime_types is null),
  'the nine buckets exist, only branding is public, each has a size and type limit');
select pg_temp.assert(app.storage_center('00000000-0000-4000-8000-000000000001/a/b.pdf') = :jsh
                      and app.storage_center('not-a-uuid/b.pdf') is null and app.storage_center(null) is null,
  'storage_center reads the first path segment');

-- Test objects, inserted as the storage service would (bypassing the policies).
insert into storage.objects (bucket_id, name, metadata) values
  ('statements', '00000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/2025.pdf', '{"size":100}'),
  ('recordings', '00000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000003/step-1.m4a', '{"size":100}'),
  ('org-documents', '00000000-0000-4000-8000-000000000001/w9.pdf', '{"size":100}'),
  ('exports', '00000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000011/people.csv', '{"size":100}'),
  ('branding', '00000000-0000-4000-8000-000000000001/logo.png', '{"size":100}');

create or replace function pg_temp.visible(p_bucket text) returns bigint language sql as $$
  select count(*) from storage.objects where bucket_id = p_bucket
$$;

begin;   -- Priya: adult of the Shah household, parent of Dev
select pg_temp.claims('10000000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.assert(pg_temp.visible('statements') = 1, 'statements: a household adult reads the household''s statement');
select pg_temp.assert(pg_temp.visible('recordings') = 1, 'recordings: a parent hears the child''s recitation');
select pg_temp.assert(pg_temp.visible('org-documents') = 0, 'org-documents: a member cannot read them');
select pg_temp.assert(pg_temp.visible('exports') = 0, 'exports: someone else''s export is invisible');
select pg_temp.assert(pg_temp.visible('branding') = 1, 'branding is readable');
select pg_temp.assert_raises($s$insert into storage.objects (bucket_id, name) values ('statements', '00000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/fake.pdf')$s$,
  'row-level security', 'statements: a member cannot write one');
select pg_temp.assert_raises($s$insert into storage.objects (bucket_id, name) values ('imports', '00000000-0000-4000-8000-000000000001/people.csv')$s$,
  'row-level security', 'imports: a member cannot upload');
rollback;
begin;   -- Kiran: another household
select pg_temp.claims('10000000-0000-4000-8000-000000000005');
set local role authenticated;
select pg_temp.assert(pg_temp.visible('statements') = 0 and pg_temp.visible('recordings') = 0,
  'another household sees neither the statement nor the recording');
rollback;
begin;   -- Dev: the child
select pg_temp.claims('10000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.assert(pg_temp.visible('recordings') = 1, 'recordings: the child hears their own recitation');
insert into storage.objects (bucket_id, name) values ('recordings', '00000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000003/step-2.m4a');
select pg_temp.assert(true, 'recordings: the child uploads into their own folder');
select pg_temp.assert_raises($s$insert into storage.objects (bucket_id, name) values ('recordings', '00000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000005/x.m4a')$s$,
  'row-level security', 'recordings: nobody uploads into another person''s folder');
rollback;
begin;   -- the teacher of Dev's class
select pg_temp.claims('10000000-0000-4000-8000-000000000004');
set local role authenticated;
select pg_temp.assert(pg_temp.visible('recordings') = 1 and pg_temp.visible('statements') = 0,
  'recordings: the child''s teacher listens; statements stay private');
rollback;
begin;   -- Tara, treasurer
select pg_temp.claims('10000000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.assert(pg_temp.visible('statements') = 1 and pg_temp.visible('recordings') = 0,
  'statements: the treasurer reads them; recordings are not a finance matter');
insert into storage.objects (bucket_id, name) values ('statements', '00000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/2026.pdf');
select pg_temp.assert(true, 'statements: the treasurer (giving.manage) writes one');
rollback;
begin;   -- Ada, center admin (not the owner)
select pg_temp.claims('10000000-0000-4000-8000-000000000011');
set local role authenticated;
select pg_temp.assert(pg_temp.visible('org-documents') = 0, 'org-documents: an admin who is not the owner cannot read them');
select pg_temp.assert_raises($s$insert into storage.objects (bucket_id, name) values ('org-documents', '00000000-0000-4000-8000-000000000001/board.pdf')$s$,
  'row-level security', 'org-documents: an admin who is not the owner cannot upload');
select pg_temp.assert(pg_temp.visible('exports') = 1, 'exports: the person who asked reads their export');
insert into storage.objects (bucket_id, name) values ('imports', '00000000-0000-4000-8000-000000000001/run-1/people.csv');
select pg_temp.assert((select count(*) = 1 from app.jobs where kind = 'storage.scan' and status = 'queued'
                         and payload->>'bucket' = 'imports' and payload->>'name' = '00000000-0000-4000-8000-000000000001/run-1/people.csv'
                         and center_id = '00000000-0000-4000-8000-000000000001'),
  'imports: an admin uploads, and the upload queues a pending malware scan');
select pg_temp.assert_raises($s$insert into storage.objects (bucket_id, name) values ('imports', 'people.csv')$s$,
  'row-level security', 'a path without a center prefix is refused');
select pg_temp.assert_raises($s$insert into storage.objects (bucket_id, name) values ('imports', '00000000-0000-4000-8000-000000000002/people.csv')$s$,
  'row-level security', 'an admin cannot upload into another center''s folder');
rollback;
begin;
select pg_temp.claims('a9000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.assert(pg_temp.visible('org-documents') = 1, 'org-documents: a platform admin (verification) reads them');
rollback;
begin;
do $$ begin
  if to_regclass('app.center_owners') is null then
    create table app.center_owners (center_id uuid primary key, user_id uuid not null);
  end if;
end $$;
insert into app.center_owners (center_id, user_id) values ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000012')
on conflict (center_id) do update set user_id = excluded.user_id;
select pg_temp.claims('10000000-0000-4000-8000-000000000012');
set local role authenticated;
select pg_temp.assert(pg_temp.visible('org-documents') = 1, 'org-documents: the owner reads them');
insert into storage.objects (bucket_id, name) values ('org-documents', '00000000-0000-4000-8000-000000000001/determination.pdf');
select pg_temp.assert(true, 'org-documents: the owner uploads');
rollback;
begin;   -- a switched-off module closes its bucket
insert into app.center_modules (center_id, module_key, enabled, reason) values (:jsh, 'gyan_path', false, 'test')
  on conflict (center_id, module_key) do update set enabled = false;
select pg_temp.claims('10000000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.assert(pg_temp.visible('recordings') = 0 and pg_temp.visible('statements') = 1,
  'with Gyan Path switched off its recordings are closed; other buckets are not');
rollback;
begin;
set local role anon;
select pg_temp.assert(pg_temp.visible('branding') = 1 and pg_temp.visible('statements') = 0, 'anon reads branding and nothing private');
rollback;

-- Uploads and removals in the Connect buckets are audited (0174).
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000011');
set local role authenticated;
insert into storage.objects (bucket_id, name, metadata)
values ('imports', '00000000-0000-4000-8000-000000000001/audit/people.csv', '{"size":42,"mimetype":"text/csv"}');
commit;
select pg_temp.assert((select actor_user_id = '10000000-0000-4000-8000-000000000011' and center_id = :jsh
                          and after->>'mimetype' = 'text/csv' and (after->>'size')::int = 42
                         from app.audit_log where action = 'storage.upload'
                          and record_id = 'imports/00000000-0000-4000-8000-000000000001/audit/people.csv'),
  'an upload is audited with who, which file, its size and type');
delete from storage.objects where name = '00000000-0000-4000-8000-000000000001/audit/people.csv';
select pg_temp.assert(exists (select 1 from app.audit_log where action = 'storage.remove'
                                and record_id = 'imports/00000000-0000-4000-8000-000000000001/audit/people.csv'),
  'a removal is audited');
update storage.objects set last_accessed_at = now() where bucket_id = 'branding';
select pg_temp.assert(not exists (select 1 from app.audit_log where action = 'storage.replace'),
  'touching an object without changing the file is not an audit entry');

-- ── Retention ────────────────────────────────────────────────────────────────
select pg_temp.assert(app.storage_retention_days('imports', :jsh) = 90 and app.storage_retention_days('exports', :jsh) = 7
                      and app.storage_retention_days('recordings', :jsh) = 90 and app.storage_retention_days('statements', :jsh) is null,
  'retention: imports 90 days, exports 7, recordings 90, statements not deleted by the job');
begin;
update app.centers set rules = jsonb_set(coalesce(rules, '{}'), '{storage}', '{"retention_days":{"recordings":30,"exports":1}}') where id = :jsh;
select pg_temp.assert(app.storage_retention_days('recordings', :jsh) = 30 and app.storage_retention_days('exports', :jsh) = 7,
  'retention: the organization may choose for recordings and imports, not exports');
rollback;
update storage.objects set created_at = now() - interval '100 days' where bucket_id = 'recordings';
update storage.objects set created_at = now() - interval '3 days' where bucket_id = 'exports';
update app.gyan_progress set recording_path = '00000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000003/step-1.m4a'
 where person_id = '30000000-0000-4000-8000-000000000003';
begin;
set local role connect_worker;
select pg_temp.assert((select array_agg(bucket_id || '|' || retention_days) from app.storage_expired_objects(100)) = array['recordings|90'],
  'the expired recording is due; the 3-day-old export is not');
select pg_temp.assert(app.record_storage_deletions(77, (select jsonb_agg(jsonb_build_object('bucket', bucket_id, 'name', name, 'created_at', created_at))
                                                          from app.storage_expired_objects(100))) = 1, 'deletions are recorded');
commit;
select pg_temp.assert((select reason like 'Retention: recordings files are kept 90 days (job 77)%' and client_app = 'job'
                          and record_id = 'recordings/00000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000003/step-1.m4a'
                          and center_id = :jsh
                         from app.audit_log where action = 'storage.retention_delete' order by id desc limit 1),
  'each removed object has an audit entry with the rule that removed it');
select pg_temp.assert(not exists (select 1 from app.gyan_progress where recording_path like '%step-1.m4a'),
  'progress rows no longer point at the removed recording');
begin;
select pg_temp.claims('10000000-0000-4000-8000-000000000011');
set local role authenticated;
select pg_temp.assert_raises('select * from app.storage_expired_objects(10)', 'permission denied', 'only the worker lists expired objects');
rollback;

delete from storage.objects;
delete from app.jobs;
delete from app.integration_connections where id in ('c0170000-0000-4000-8000-000000000001', 'c0170000-0000-4000-8000-000000000002');
