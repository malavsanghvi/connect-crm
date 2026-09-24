-- Onboarding (stream o-vault) · 2 of 3: the job queue and the background service.
--
--   app.jobs               one row per piece of background work
--   app.enqueue_job        called from inside other RPCs, after they checked the caller
--   app.claim_jobs         connect_worker: take up to N due jobs (FOR UPDATE SKIP LOCKED)
--   app.finish_job         connect_worker: mark done with a result
--   app.fail_job           connect_worker: retry with exponential backoff, or fail for good
--   app.worker_heartbeats  one row per running worker, refreshed every minute
--   app.readiness_checks   (created defensively; o-setup owns the registry) +
--                          the 'background_service' check
--
-- A job's payload and result must never contain a secret: they are audited
-- and readable by the center's administrators. Handlers fetch secrets with
-- app.worker_read_secret at run time instead.
--
-- Retries: attempt n that fails is retried after 30 s × 2^(n-1), capped at one
-- hour, until max_attempts (default 5). A job whose worker died while running
-- it is released again after 15 minutes.

create table if not exists app.jobs (
  id           bigserial primary key,
  center_id    uuid references app.centers(id) on delete cascade,   -- NULL: platform-wide work
  kind         text not null check (kind ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'),
  payload      jsonb not null default '{}'::jsonb,
  status       text not null default 'queued' check (status in ('queued','running','done','failed','cancelled')),
  run_after    timestamptz not null default now(),
  attempts     int not null default 0,
  max_attempts int not null default 5 check (max_attempts between 1 and 25),
  last_error   text,
  locked_by    text,
  locked_at    timestamptz,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  finished_at  timestamptz,
  result       jsonb
);
create index if not exists jobs_due_idx on app.jobs (run_after, id) where status = 'queued';
create index if not exists jobs_running_idx on app.jobs (locked_at) where status = 'running';
create index if not exists jobs_center_idx on app.jobs (center_id, created_at desc);
create index if not exists jobs_kind_idx on app.jobs (kind, created_at desc);

create table if not exists app.worker_heartbeats (
  worker     text primary key,
  started_at timestamptz not null,
  beat_at    timestamptz not null default now(),
  version    text,
  kinds      text[] not null default '{}',
  info       jsonb not null default '{}'::jsonb,     -- per handler: configured or not, and why; never a secret
  stopped_at timestamptz                              -- set when the worker shut down cleanly
);

insert into app.module_tables (table_name, module_key) values ('jobs', null), ('worker_heartbeats', null)
on conflict (table_name) do update set module_key = excluded.module_key;

drop trigger if exists audit_jobs on app.jobs;
create trigger audit_jobs after insert or update or delete on app.jobs
  for each row execute function app.audit_row();
-- A worker starting, stopping or changing what it can run is audited. The
-- once-a-minute tick that only moves beat_at is not: it would add 1,440 audit
-- entries a day that say nothing.
drop trigger if exists audit_worker_heartbeats on app.worker_heartbeats;
create trigger audit_worker_heartbeats after insert or delete on app.worker_heartbeats
  for each row execute function app.audit_row('worker');
drop trigger if exists audit_worker_heartbeats_change on app.worker_heartbeats;
create trigger audit_worker_heartbeats_change after update on app.worker_heartbeats
  for each row when (old.started_at is distinct from new.started_at or old.version is distinct from new.version
                     or old.kinds is distinct from new.kinds or old.info is distinct from new.info
                     or old.stopped_at is distinct from new.stopped_at)
  execute function app.audit_row('worker');

alter table app.jobs enable row level security;
alter table app.worker_heartbeats enable row level security;

-- A center's administrators see its jobs; platform admins see every job.
drop policy if exists jobs_staff_read on app.jobs;
create policy jobs_staff_read on app.jobs for select to authenticated
  using ((center_id is not null and (app.has_permission(center_id, 'settings.manage')
                                     or app.has_permission(center_id, 'integrations.manage')))
         or app.is_platform_admin());
drop policy if exists worker_heartbeats_platform_read on app.worker_heartbeats;
create policy worker_heartbeats_platform_read on app.worker_heartbeats for select to authenticated
  using (app.is_platform_admin());

revoke all on app.jobs, app.worker_heartbeats from public, anon, authenticated, service_role, connect_worker;
grant select on app.jobs, app.worker_heartbeats to authenticated;
revoke all on sequence app.jobs_id_seq from public, anon, authenticated, service_role;

-- ── Enqueue ──────────────────────────────────────────────────────────────────
-- Not callable over the API: an RPC that has checked its caller calls it, and
-- the job records that caller (created_by).
create or replace function app.enqueue_job(p_center uuid, p_kind text, p_payload jsonb, p_run_after timestamptz default now(),
                                           p_max_attempts int default 5)
returns bigint language plpgsql security definer set search_path = app, public, extensions as $$
declare v_id bigint;
begin
  if p_kind is null or p_kind !~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$' then
    raise exception 'A job kind looks like "area.action", for example demo.ping (got "%").', p_kind;
  end if;
  insert into app.jobs (center_id, kind, payload, run_after, max_attempts, created_by)
  values (p_center, p_kind, coalesce(p_payload, '{}'::jsonb), coalesce(p_run_after, now()),
          least(greatest(coalesce(p_max_attempts, 5), 1), 25), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ── The worker's side ────────────────────────────────────────────────────────
create or replace function app.claim_jobs(p_worker text, p_kinds text[], p_limit int)
returns setof app.jobs language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  if nullif(btrim(p_worker), '') is null then raise exception 'claim_jobs needs the worker''s name.'; end if;
  perform set_config('app.client_app', 'job', true);

  -- Jobs left 'running' by a worker that died: release them (or give up).
  update app.jobs
     set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
         finished_at = case when attempts >= max_attempts then now() end,
         last_error = 'The background service stopped while running this job (worker ' || coalesce(locked_by, '?') || ').',
         locked_by = null, locked_at = null
   where status = 'running' and locked_at < now() - interval '15 minutes';

  return query
  update app.jobs j
     set status = 'running', attempts = j.attempts + 1, locked_by = left(btrim(p_worker), 200), locked_at = now()
   where j.id in (select q.id from app.jobs q
                   where q.status = 'queued' and q.run_after <= now() and q.kind = any (coalesce(p_kinds, '{}'))
                   order by q.run_after, q.id
                   limit least(greatest(coalesce(p_limit, 1), 1), 100)
                   for update skip locked)
  returning j.*;
end $$;

create or replace function app.finish_job(p_id bigint, p_result jsonb)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  update app.jobs set status = 'done', result = p_result, finished_at = now(), last_error = null,
                      locked_by = null, locked_at = null
   where id = p_id and status = 'running';
  if not found then raise exception 'Job % is not running, so it cannot be finished.', p_id; end if;
end $$;

-- p_retry = false: the failure will not change by trying again (for example a
-- handler that is not configured); the job fails now.
create or replace function app.fail_job(p_id bigint, p_error text, p_retry boolean default true)
returns text language plpgsql security definer set search_path = app, public, extensions as $$
declare j app.jobs;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  select * into j from app.jobs where id = p_id and status = 'running' for update;
  if not found then raise exception 'Job % is not running, so it cannot be failed.', p_id; end if;
  if coalesce(p_retry, true) and j.attempts < j.max_attempts then
    update app.jobs set status = 'queued', last_error = left(coalesce(p_error, 'failed'), 2000),
                        run_after = now() + make_interval(secs => least(3600, 30 * power(2, greatest(j.attempts - 1, 0)))),
                        locked_by = null, locked_at = null
     where id = p_id;
    return 'retrying';
  end if;
  update app.jobs set status = 'failed', last_error = left(coalesce(p_error, 'failed'), 2000), finished_at = now(),
                      locked_by = null, locked_at = null
   where id = p_id;
  return 'failed';
end $$;

create or replace function app.worker_heartbeat(p_worker text, p_started_at timestamptz, p_version text, p_kinds text[], p_info jsonb)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  if nullif(btrim(p_worker), '') is null then raise exception 'worker_heartbeat needs the worker''s name.'; end if;
  perform set_config('app.client_app', 'job', true);
  insert into app.worker_heartbeats (worker, started_at, beat_at, version, kinds, info)
  values (left(btrim(p_worker), 200), coalesce(p_started_at, now()), now(), left(p_version, 100),
          coalesce(p_kinds, '{}'), coalesce(p_info, '{}'::jsonb))
  on conflict (worker) do update
    set started_at = excluded.started_at, beat_at = now(), version = excluded.version,
        kinds = excluded.kinds, info = excluded.info, stopped_at = null;
end $$;

-- A worker leaving cleanly says so (audited), so a stop is not mistaken for a crash.
create or replace function app.worker_stopped(p_worker text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  update app.worker_heartbeats set stopped_at = now() where worker = p_worker;
end $$;

-- Recurring platform work: queue one job of this kind unless one is already
-- queued or running, or one was created within p_every. Several workers can
-- call it at once; the advisory lock makes exactly one of them queue it.
create or replace function app.worker_schedule(p_kind text, p_every interval, p_payload jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  perform pg_advisory_xact_lock(hashtext('app.worker_schedule:' || p_kind));
  if exists (select 1 from app.jobs where kind = p_kind and center_id is null
               and (status in ('queued','running') or created_at > now() - p_every)) then
    return null;
  end if;
  return app.enqueue_job(null, p_kind, p_payload, now(), 3);
end $$;

-- ── What the portal shows ────────────────────────────────────────────────────
-- A heartbeat older than this means the service is not running.
create or replace function app.worker_stale_after() returns interval
language sql immutable set search_path = app, public, extensions as $$ select interval '3 minutes' $$;

create or replace function app.background_service_status(p_center uuid)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_last timestamptz; v_workers jsonb; v_jobs jsonb; v_state text; v_live int;
begin
  if not (app.has_permission(p_center, 'settings.manage') or app.has_permission(p_center, 'integrations.view')
          or app.has_permission(p_center, 'integrations.manage') or app.is_center_owner(p_center)) then
    raise exception 'Seeing the background service needs settings.manage or integrations.view.' using errcode = 'insufficient_privilege';
  end if;
  select max(beat_at), count(*) filter (where stopped_at is null and beat_at >= now() - app.worker_stale_after()),
         coalesce(jsonb_agg(jsonb_build_object('worker', worker, 'started_at', started_at, 'beat_at', beat_at,
                                               'stopped_at', stopped_at, 'version', version, 'kinds', kinds,
                                               'handlers', coalesce(info->'handlers', '{}'::jsonb))
                            order by (stopped_at is null) desc, beat_at desc), '[]'::jsonb)
    into v_last, v_live, v_workers
    from app.worker_heartbeats;
  v_state := case when v_last is null then 'not_configured'
                  when v_live > 0 then 'running'
                  else 'stopped' end;
  select jsonb_build_object(
           'queued',     count(*) filter (where status = 'queued'),
           'running',    count(*) filter (where status = 'running'),
           'failed_24h', count(*) filter (where status = 'failed' and finished_at > now() - interval '24 hours'),
           'done_24h',   count(*) filter (where status = 'done' and finished_at > now() - interval '24 hours'),
           'scan_pending', count(*) filter (where kind = 'storage.scan' and status in ('queued','running')))
    into v_jobs
    from app.jobs where center_id = p_center;
  return jsonb_build_object('state', v_state, 'last_beat_at', v_last,
                            'age_seconds', case when v_last is null then null else extract(epoch from now() - v_last)::int end,
                            'workers', v_workers, 'jobs', v_jobs);
end $$;

-- "Test the background service": a demo.ping job for this center.
create or replace function app.enqueue_worker_test(p_center uuid)
returns bigint language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if not (app.has_permission(p_center, 'settings.manage') or app.is_platform_admin()) then
    raise exception 'Testing the background service needs settings.manage.' using errcode = 'insufficient_privilege';
  end if;
  return app.enqueue_job(p_center, 'demo.ping', jsonb_build_object('requested_at', now()), now(), 3);
end $$;

-- ── Readiness (registry owned by o-setup; created here only if missing) ─────
create table if not exists app.readiness_checks (
  key      text primary key,
  title    text not null,
  sort     int not null default 0,
  check_fn regproc not null
);
insert into app.module_tables (table_name, module_key) values ('readiness_checks', null)
on conflict (table_name) do nothing;
alter table app.readiness_checks enable row level security;
do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'app.readiness_checks'::regclass and tgname = 'audit_readiness_checks') then
    create trigger audit_readiness_checks after insert or update or delete on app.readiness_checks
      for each row execute function app.audit_row('key');
  end if;
  if not exists (select 1 from pg_policy where polrelid = 'app.readiness_checks'::regclass and polname = 'readiness_checks_read') then
    create policy readiness_checks_read on app.readiness_checks for select to authenticated using (true);
  end if;
end $$;
grant select on app.readiness_checks to authenticated;

create or replace function app.check_background_service(p_center uuid)
returns jsonb language sql stable security definer set search_path = app, public, extensions as $$
  select case
    when b.last is null then jsonb_build_object('ok', false, 'detail',
      'The background service is not running (never deployed, or stopped). The deploy starts it once the WORKER_DATABASE_URL secret is added.')
    when b.last < now() - app.worker_stale_after() then jsonb_build_object('ok', false, 'detail',
      'The background service last reported in ' || to_char(b.last at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC and is not running now.')
    else jsonb_build_object('ok', true, 'detail', 'Running; last reported in ' || extract(epoch from now() - b.last)::int || ' seconds ago.')
  end
  from (select max(beat_at) filter (where stopped_at is null) as last from app.worker_heartbeats) b
$$;

insert into app.readiness_checks (key, title, sort, check_fn)
values ('background_service', 'Background service running', 90, 'app.check_background_service'::regproc)
on conflict (key) do update set title = excluded.title, check_fn = excluded.check_fn;

-- ── Grants ───────────────────────────────────────────────────────────────────
revoke execute on function app.enqueue_job(uuid, text, jsonb, timestamptz, int), app.claim_jobs(text, text[], int),
  app.finish_job(bigint, jsonb), app.fail_job(bigint, text, boolean),
  app.worker_heartbeat(text, timestamptz, text, text[], jsonb), app.worker_stopped(text),
  app.worker_schedule(text, interval, jsonb), app.background_service_status(uuid), app.enqueue_worker_test(uuid),
  app.check_background_service(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app.claim_jobs(text, text[], int), app.finish_job(bigint, jsonb), app.fail_job(bigint, text, boolean),
  app.worker_heartbeat(text, timestamptz, text, text[], jsonb), app.worker_stopped(text),
  app.worker_schedule(text, interval, jsonb), app.enqueue_job(uuid, text, jsonb, timestamptz, int) to connect_worker;
grant execute on function app.background_service_status(uuid), app.enqueue_worker_test(uuid),
  app.check_background_service(uuid) to authenticated;
