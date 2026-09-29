-- Event flyers: "Generate flyer with AI" alongside the existing manual
-- flyer_path (plan: add an AI plugin connection to event creation so it
-- proposes a flyer/picture for the event).
--
-- The image call itself is a worker job (events.generate_flyer, o-vault's
-- job queue), the same shape as import.suggest_mapping / qbo.match_suggest_ai:
-- the portal never holds the OpenAI key (it holds no provider secret at all —
-- see docs/DEPLOY.md), so it asks the background service and polls the
-- result. The bytes the worker returns are then uploaded to Supabase Storage
-- by the PORTAL, as the signed-in admin, through the same "content" bucket
-- every other piece of member-facing media in the app already uses — that
-- upload needs its own write rule below, because content bucket writes were
-- content.manage-only and an events.manage admin usually holds no such role.
--
-- flyer_source records how the current flyer_path got there ('manual' or
-- 'ai'); flyer_prompt is the prompt an AI flyer was generated from (the
-- audit trail asked for — "every change has a reason"); flyer_job_id points
-- at the worker job so the portal can poll it without holding onto a job id
-- client-side across a page reload.
alter table app.events
  add column if not exists flyer_source text check (flyer_source in ('manual', 'ai')),
  add column if not exists flyer_prompt text,
  add column if not exists flyer_generated_at timestamptz,
  add column if not exists flyer_job_id bigint references app.jobs(id);

comment on column app.events.flyer_source is 'How the current flyer_path was produced: manual (uploaded) or ai (generated). NULL: no flyer, or one set before this column existed.';
comment on column app.events.flyer_prompt is 'The prompt that produced the current AI flyer (NULL for a manual upload).';
comment on column app.events.flyer_job_id is 'The most recent events.generate_flyer worker job for this event (app.jobs.id), so the portal can poll a generation in progress after a reload.';

-- ── Ask the background service for a flyer image ────────────────────────────
-- Mirrors app.import_request_ai_mapping (0192): only when the job queue
-- exists in this database, and it re-checks the caller itself rather than
-- relying only on RLS, so it reports the exact reason rather than a bare
-- permission error.
create or replace function app.events_request_flyer(p_event uuid, p_prompt text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare e app.events; v_prompt text; v_job text;
begin
  select * into e from app.events where id = p_event;
  if e.id is null then raise exception 'that event no longer exists.'; end if;
  perform app.assert_module_enabled(e.center_id, 'events');
  if auth.uid() is not null and not (app.has_permission(e.center_id, 'events.manage') or app.has_scoped_role(e.center_id, e.id, 'event_lead')) then
    raise exception 'only event managers and this event''s lead can generate a flyer for it.';
  end if;
  v_prompt := btrim(coalesce(p_prompt, ''));
  if v_prompt = '' then raise exception 'describe the flyer you want, in a sentence or two.'; end if;
  v_prompt := left(v_prompt, 2000);
  -- Named lookup (to_regproc), not to_regprocedure with an explicit arg list:
  -- enqueue_job's last two parameters carry defaults, so a signature match
  -- against a shorter, explicit type list never resolves even when the
  -- function exists and the call below (which supplies every argument) would
  -- succeed. Safe because enqueue_job has exactly one overload.
  if to_regproc('app.enqueue_job') is null then
    return jsonb_build_object('status', 'unavailable', 'reason', 'The background service is not set up yet, so AI flyers are off. Upload a flyer instead.');
  end if;
  begin
    execute 'select (app.enqueue_job($1, $2, $3, $4, $5))::text' into v_job
      using e.center_id, 'events.generate_flyer', jsonb_build_object('event_id', e.id, 'prompt', v_prompt), now(), 2;
  exception when others then
    return jsonb_build_object('status', 'unavailable', 'reason', 'The background service did not accept the request: ' || sqlerrm);
  end;
  update app.events set flyer_job_id = v_job::bigint where id = e.id;
  return jsonb_build_object('status', 'queued', 'job_id', v_job);
end $$;

-- Poll the job (mirrors app.import_ai_mapping_result). Reads app.jobs
-- directly (bypassing its own RLS, which is settings/integrations.manage-only
-- and would otherwise hide this from most event managers) after checking the
-- caller itself.
create or replace function app.events_flyer_result(p_event uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare e app.events; v jsonb;
begin
  select * into e from app.events where id = p_event;
  if e.id is null then raise exception 'that event no longer exists.'; end if;
  if auth.uid() is not null and not (app.has_permission(e.center_id, 'events.manage') or app.has_scoped_role(e.center_id, e.id, 'event_lead')) then
    raise exception 'only event managers and this event''s lead can see this event''s flyer generation.';
  end if;
  if e.flyer_job_id is null then return jsonb_build_object('status', 'none'); end if;
  if to_regclass('app.jobs') is null then return jsonb_build_object('status', 'unavailable', 'reason', 'The background service is not set up.'); end if;
  execute 'select jsonb_build_object(''status'', status, ''result'', result, ''error'', last_error) from app.jobs where id = $1'
    into v using e.flyer_job_id;
  return coalesce(v, jsonb_build_object('status', 'missing'));
end $$;

revoke execute on function app.events_request_flyer(uuid, text), app.events_flyer_result(uuid) from public, anon;
grant execute on function app.events_request_flyer(uuid, text), app.events_flyer_result(uuid) to authenticated, service_role;

-- ── Storage: let an event manager (or this event's lead) write a flyer into
-- the "content" bucket, under <center>/events/<event id>/… only. Everything
-- else about the bucket (content.manage for the rest of it, is_member_of to
-- read) is unchanged — this is the smallest addition to app.can_write_object
-- (0172) that makes flyers writable by the people who actually manage events,
-- not just whoever also holds content.manage. Redefined in full because
-- 0172 is an already-numbered migration and is never edited in place.
create or replace function app.can_write_object(bucket text, name text) returns boolean
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare b text := $1; n text := $2; c uuid := app.storage_center($2); s2 uuid := app.storage_segment_uuid($2, 2);
begin
  if c is null or auth.uid() is null or not exists (select 1 from app.centers where id = c) then return false; end if;
  if not app.storage_module_on(b, c) then return false; end if;
  return case b
    when 'branding'      then app.has_permission(c, 'settings.manage')
    when 'content'       then app.has_permission(c, 'content.manage')
                              or (app.storage_segment(n, 2) = 'events' and app.storage_segment_uuid(n, 3) is not null
                                  and (app.has_permission(c, 'events.manage') or app.has_scoped_role(c, app.storage_segment_uuid(n, 3), 'event_lead')))
    when 'photos'        then app.has_permission(c, 'content.manage')
                              or (app.is_member_of(c) and s2 is not null
                                  and app.storage_segment(n, 3) like auth.uid()::text || '-%')
    when 'store'         then app.has_permission(c, 'store.manage')
    when 'statements'    then app.has_permission(c, 'giving.manage')
    when 'recordings'    then s2 is not null and app.can_act_for_person(c, s2)
    when 'imports'       then app.has_permission(c, 'people.manage') or app.has_permission(c, 'giving.manage')
                              or app.has_permission(c, 'accounting.manage') or app.has_permission(c, 'settings.manage')
    when 'org-documents' then app.is_center_owner(c)
    when 'exports'       then s2 = auth.uid() and app.is_member_of(c)
    else false
  end;
end $$;

revoke execute on function app.can_write_object(text, text) from public;
grant execute on function app.can_write_object(text, text) to anon, authenticated, service_role;
