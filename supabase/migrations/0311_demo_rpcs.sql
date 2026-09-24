-- Onboarding · stream o-demo · 2 of 4: activate, reset and clear — the RPCs an administrator
-- calls, and the worker functions the background jobs demo.load / demo.clear run.
--
--   app.activate_demo_pack(center, pack, reason)            owner or settings.manage; sandbox only;
--                                                           enqueues demo.load
--   app.reset_sandbox(center, pack, confirm, reason)        + the organization's short name typed
--                                                           to confirm + a fresh 2FA check; enqueues
--                                                           demo.clear, which then enqueues demo.load
--   app.clear_sandbox(center, confirm, reason)              the same, without loading again
--   app.demo_pack_steps(pack)                               the steps one load runs, in order
--   app.worker_demo_load_next(center)                       connect_worker: runs the next step of the
--                                                           load (each step its own transaction, so
--                                                           the screen shows progress and a retry
--                                                           resumes where it stopped)
--   app.worker_demo_clear(center)                           connect_worker: clears the sandbox in ONE
--                                                           transaction (all or nothing)
--   app.worker_demo_failed(center, error, final)            connect_worker: records a failed try
--
-- Every refusal is a plain sentence; "Demo data is only for sandboxes." is raised with SQLSTATE
-- CCDMO by app.demo_assert_sandbox. Every change is audited with the reason the admin gave
-- ("Demo data · <step> · <reason>", client_app job for the worker's writes).
set client_min_messages = warning;

-- The steps of a pack, in order: [{key, label}]. A step is the function app.demo_<pack>_<key>.
create or replace function app.demo_pack_steps(p_pack text) returns jsonb
language sql immutable set search_path = app, public, extensions as $$
  select case p_pack
    when 'community' then jsonb_build_array(
      jsonb_build_object('key', 'setup',      'label', 'Setup data: zones, funds, membership types, store, Pathshala, practices'),
      jsonb_build_object('key', 'people',     'label', 'Households and people'),
      jsonb_build_object('key', 'membership', 'label', 'Memberships, applications and staff'),
      jsonb_build_object('key', 'giving',     'label', 'Pledges, payments, recurring gifts and bolis'),
      jsonb_build_object('key', 'events',     'label', 'Events, RSVPs, tickets, check-ins and lunch'),
      jsonb_build_object('key', 'store',      'label', 'Store orders'),
      jsonb_build_object('key', 'pathshala',  'label', 'Pathshala enrollments, attendance and progress'),
      jsonb_build_object('key', 'learning',   'label', 'Gyan Path and My Jain Way'),
      jsonb_build_object('key', 'community',  'label', 'Messages, surveys, volunteers, governance and content'),
      jsonb_build_object('key', 'logins',     'label', 'Linking demo sign-ins'))
    else '[]'::jsonb end
$$;

-- A job of this center that is still waiting or running (the state's own job).
create or replace function app.demo_job_open(p_job bigint) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select p_job is not null and exists (select 1 from app.jobs j where j.id = p_job and j.status in ('queued','running'))
$$;

-- Shared checks for the three RPCs. Returns the (locked) state row, creating it if needed.
create or replace function app.demo_begin(p_center uuid, p_reason text, p_doing text) returns app.center_demo_state
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.center_demo_state;
begin
  if not app.demo_can_manage(p_center) then
    raise exception 'Only the owner or an administrator with settings.manage can % demo data.', p_doing using errcode = '42501';
  end if;
  -- Lock the center, then check it: it cannot turn into production half-way.
  perform 1 from app.centers where id = p_center for update;
  perform app.demo_assert_sandbox(p_center);
  if app.audit_clean_reason(p_reason) is null then
    raise exception 'Give a reason. It goes in the audit log.';
  end if;
  if exists (select 1 from app.sandbox_promotions where sandbox_id = p_center and status = 'queued') then
    raise exception 'A promotion of this sandbox is running. Wait for it to finish before changing its demo data.';
  end if;
  insert into app.center_demo_state (center_id) values (p_center) on conflict (center_id) do nothing;
  select * into s from app.center_demo_state where center_id = p_center for update;
  if s.status in ('loading','clearing') and app.demo_job_open(s.job_id) then
    raise exception 'Demo data is being % right now. Wait for it to finish (this page shows the progress).',
      case s.status when 'loading' then 'loaded' else 'cleared' end;
  end if;
  return s;
end $$;

create or replace function app.demo_check_confirm(p_center uuid, p_confirm text) returns void
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v text := app.demo_confirm_word(p_center);
begin
  if lower(btrim(coalesce(p_confirm, ''))) is distinct from lower(v) then
    raise exception 'Type % to confirm. Nothing was changed.', v;
  end if;
end $$;

-- ── Activate ─────────────────────────────────────────────────────────────────
create or replace function app.activate_demo_pack(p_center uuid, p_pack text, p_reason text) returns bigint
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.center_demo_state; p app.demo_packs; v_job bigint;
begin
  select * into p from app.demo_packs where key = p_pack and active;
  perform app.set_audit_context('Demo data · load ' || coalesce(p.title, 'a demo pack') || ': ' || coalesce(app.audit_clean_reason(p_reason), ''));
  s := app.demo_begin(p_center, p_reason, 'load');
  if p.key is null then raise exception 'There is no demo pack called "%".', coalesce(p_pack, ''); end if;
  if s.status = 'loaded' then
    raise exception 'The % demo pack is already loaded. Use Reset sandbox to clear it and load it again.', (select title from app.demo_packs where key = s.pack_key);
  end if;
  update app.center_demo_state
     set pack_key = p.key, version = p.version, status = 'loading', operation = 'activate', reason = app.audit_clean_reason(p_reason),
         requested_by = auth.uid(), requested_at = now(), steps_done = 0, steps_total = jsonb_array_length(app.demo_pack_steps(p.key)),
         step_label = 'Waiting for the background service', load_seed = gen_random_uuid(), last_error = null,
         detail = jsonb_build_object('counts_before', app.demo_data_counts(p_center)), updated_at = now()
   where center_id = p_center;
  v_job := app.enqueue_job(p_center, 'demo.load', jsonb_build_object('pack', p.key), now(), 3);
  update app.center_demo_state set job_id = v_job where center_id = p_center;
  return v_job;
end $$;

-- ── Reset (clear + load again) and clear ─────────────────────────────────────
create or replace function app.demo_start_clear(p_center uuid, p_pack text, p_confirm text, p_reason text, p_op text) returns bigint
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.center_demo_state; p app.demo_packs; v_job bigint;
begin
  perform app.set_audit_context('Demo data · ' || case p_op when 'reset' then 'reset the sandbox' else 'clear the sandbox' end
                                || ': ' || coalesce(app.audit_clean_reason(p_reason), ''));
  s := app.demo_begin(p_center, p_reason, case p_op when 'reset' then 'reset' else 'clear' end);
  if p_op = 'reset' then
    select * into p from app.demo_packs where key = p_pack and active;
    if p.key is null then raise exception 'There is no demo pack called "%".', coalesce(p_pack, ''); end if;
  end if;
  perform app.demo_check_confirm(p_center, p_confirm);
  -- Deleting data: a fresh 2FA check (ONBOARDING_CONTRACT "Security").
  perform app.assert_step_up(case p_op when 'reset' then 'demo.reset_sandbox' else 'demo.clear_sandbox' end);
  update app.center_demo_state
     set pack_key = case when p_op = 'reset' then p.key else s.pack_key end,
         version = case when p_op = 'reset' then p.version else s.version end,
         status = 'clearing', operation = p_op, reason = app.audit_clean_reason(p_reason),
         requested_by = auth.uid(), requested_at = now(), steps_done = 0, steps_total = 0,
         step_label = 'Waiting for the background service', last_error = null,
         detail = jsonb_build_object('counts_before_clear', app.demo_data_counts(p_center)), updated_at = now()
   where center_id = p_center;
  v_job := app.enqueue_job(p_center, 'demo.clear', jsonb_build_object('then_load', case when p_op = 'reset' then p.key end), now(), 3);
  update app.center_demo_state set job_id = v_job where center_id = p_center;
  return v_job;
end $$;

create or replace function app.reset_sandbox(p_center uuid, p_pack text, p_confirm text, p_reason text) returns bigint
language sql security definer set search_path = app, public, extensions as $$
  select app.demo_start_clear(p_center, p_pack, p_confirm, p_reason, 'reset')
$$;

create or replace function app.clear_sandbox(p_center uuid, p_confirm text, p_reason text) returns bigint
language sql security definer set search_path = app, public, extensions as $$
  select app.demo_start_clear(p_center, null, p_confirm, p_reason, 'clear')
$$;

-- ── Worker: one step of a load ───────────────────────────────────────────────
create or replace function app.worker_demo_load_next(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.center_demo_state; p app.demo_packs; v_steps jsonb; v_step jsonb; i int; v_after jsonb; v_before jsonb;
        v_loaded jsonb := '{}'::jsonb; k text;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  select * into s from app.center_demo_state where center_id = p_center for update;
  if s.center_id is null or s.status <> 'loading' then
    return jsonb_build_object('done', true, 'status', coalesce(s.status, 'empty'), 'note', 'nothing to load');
  end if;
  perform 1 from app.centers where id = p_center for update;
  perform app.demo_assert_sandbox(p_center);
  select * into p from app.demo_packs where key = s.pack_key;
  v_steps := app.demo_pack_steps(s.pack_key);
  i := s.steps_done + 1;
  if i <= jsonb_array_length(v_steps) then
    v_step := v_steps -> (i - 1);
    perform app.set_audit_context('Demo data · ' || p.title || ' · ' || (v_step->>'label') || ': ' || coalesce(s.reason, 'demo pack'), s.load_seed);
    execute format('select app.%I($1, $2, $3)', 'demo_' || s.pack_key || '_' || (v_step->>'key')) using p_center, s.load_seed, s.requested_by;
    update app.center_demo_state
       set steps_done = i,
           step_label = coalesce((v_steps -> i)->>'label', 'Finishing'),
           detail = detail || jsonb_build_object('steps_completed', coalesce(detail->'steps_completed', '[]'::jsonb) || to_jsonb(v_step->>'key')),
           last_error = null, updated_at = now()
     where center_id = p_center;
  end if;
  if i < jsonb_array_length(v_steps) then
    return jsonb_build_object('done', false, 'steps_done', i, 'steps_total', jsonb_array_length(v_steps), 'step', v_step->>'key');
  end if;
  -- Last step done: what the pack added, table by table.
  select detail->'counts_before' into v_before from app.center_demo_state where center_id = p_center;
  v_after := app.demo_data_counts(p_center);
  for k in select jsonb_object_keys(v_after) loop
    if (v_after->>k)::bigint - coalesce((v_before->>k)::bigint, 0) <> 0 then
      v_loaded := v_loaded || jsonb_build_object(k, (v_after->>k)::bigint - coalesce((v_before->>k)::bigint, 0));
    end if;
  end loop;
  perform app.set_audit_context('Demo data · ' || p.title || ' loaded: ' || coalesce(s.reason, 'demo pack'), s.load_seed);
  -- Sign-ins linked to demo people are not part of the pack (they depend on who has signed in).
  update app.center_demo_state
     set status = 'loaded', step_label = null, loaded_at = now(), loaded_by = s.requested_by, last_error = null,
         detail = detail || jsonb_build_object('counts_after', v_after, 'loaded', v_loaded - 'center_users',
                                               'linked_logins', coalesce((v_loaded->>'center_users')::int, 0)), updated_at = now()
   where center_id = p_center;
  return jsonb_build_object('done', true, 'status', 'loaded', 'steps_done', jsonb_array_length(v_steps), 'loaded', v_loaded - 'center_users');
end $$;

-- ── Worker: clear (and, for a reset, queue the load) ─────────────────────────
create or replace function app.worker_demo_clear(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.center_demo_state; v_result jsonb; v_job bigint; v_then text;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  select * into s from app.center_demo_state where center_id = p_center for update;
  if s.center_id is null or s.status <> 'clearing' then
    return jsonb_build_object('status', coalesce(s.status, 'empty'), 'note', 'nothing to clear');
  end if;
  perform app.set_audit_context('Demo data · ' || case s.operation when 'reset' then 'reset the sandbox' else 'clear the sandbox' end
                                || ': ' || coalesce(s.reason, ''), s.load_seed);
  update app.center_demo_state set step_label = 'Removing the sandbox''s records', updated_at = now() where center_id = p_center;
  v_result := app.demo_clear_center(p_center);
  v_then := case when s.operation = 'reset' then s.pack_key end;
  if v_then is not null then
    update app.center_demo_state
       set status = 'loading', cleared_at = now(), cleared_by = s.requested_by, steps_done = 0,
           steps_total = jsonb_array_length(app.demo_pack_steps(v_then)), step_label = 'Waiting for the background service',
           load_seed = gen_random_uuid(), last_error = null,
           detail = detail || jsonb_build_object('cleared', v_result, 'counts_before', app.demo_data_counts(p_center)), updated_at = now()
     where center_id = p_center;
    v_job := app.enqueue_job(p_center, 'demo.load', jsonb_build_object('pack', v_then), now(), 3);
    update app.center_demo_state set job_id = v_job where center_id = p_center;
  else
    update app.center_demo_state
       set status = 'empty', pack_key = null, version = null, cleared_at = now(), cleared_by = s.requested_by,
           step_label = null, last_error = null, loaded_at = null, loaded_by = null,
           detail = detail || jsonb_build_object('cleared', v_result), updated_at = now()
     where center_id = p_center;
  end if;
  return v_result || jsonb_build_object('then_load', v_then, 'load_job', v_job);
end $$;

create or replace function app.worker_demo_failed(p_center uuid, p_error text, p_final boolean default false) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  update app.center_demo_state
     set last_error = left(coalesce(p_error, 'unknown error'), 2000),
         status = case when p_final then 'failed' else status end,
         step_label = case when p_final then null else step_label end,
         updated_at = now()
   where center_id = p_center and status in ('loading','clearing');
end $$;

revoke execute on function app.demo_begin(uuid, text, text), app.demo_start_clear(uuid, text, text, text, text),
  app.worker_demo_load_next(uuid), app.worker_demo_clear(uuid), app.worker_demo_failed(uuid, text, boolean),
  app.demo_job_open(bigint), app.demo_check_confirm(uuid, text) from public, anon, authenticated;
revoke execute on function app.activate_demo_pack(uuid, text, text), app.reset_sandbox(uuid, text, text, text),
  app.clear_sandbox(uuid, text, text), app.demo_pack_steps(text) from public, anon;
grant execute on function app.activate_demo_pack(uuid, text, text), app.reset_sandbox(uuid, text, text, text),
  app.clear_sandbox(uuid, text, text), app.demo_pack_steps(text) to authenticated;
grant execute on function app.worker_demo_load_next(uuid), app.worker_demo_clear(uuid), app.worker_demo_failed(uuid, text, boolean)
  to connect_worker;
grant execute on all functions in schema app to service_role;
