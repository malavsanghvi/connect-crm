-- 0703: AI flyer art for every occasion (B96 follow-up, 2026-10-11).
--
-- PR #186 made the flyer occasions data (src/lib/events/flyer-occasions.ts): a church has Christmas Eve and Easter, a
-- mosque Eid, a chamber a mixer and a ribbon cutting, every community "Other occasion". 0585 still listed the eight
-- Flyers v2 occasions in two places, so AI frames and scenes could only be asked for, and kept, for those eight:
--
--   app.flyer_art_name_ok(name)            the storage rule's name check for <center>/flyer-art/<occasion>/<layer>-<seed>.<ext>
--                                          (app.can_write_object and app.events_flyer_art_taken call it)
--   app.events_request_flyer_art(...)      the occasion check before a job is queued
--
-- Both now accept any occasion KEY SHAPE (a lowercase letter, then 1 to 39 lowercase letters, digits or underscores),
-- so a new occasion in the catalog needs no migration. The list itself is not copied into SQL: the real allow-list is
-- the TypeScript catalog, checked on the server (flyer-art-actions.ts, isFlyerOccasion) and again by the background
-- service before it builds a prompt (worker/src/handlers/events.generate_flyer.ts, readPayload). A key the catalog does
-- not know gets no picture; the shape check keeps paths and payloads safe (no slashes, dots or capitals).
--
-- Everything else is 0585's text unchanged: the same signatures, language, volatility, security (flyer_art_name_ok is
-- SECURITY INVOKER and internal, events_request_flyer_art is SECURITY DEFINER), search path, and the same revoke and
-- grant lines (CREATE OR REPLACE keeps a function's privileges; the lines are repeated so the file is complete and
-- idempotent). Nobody new may call either function, and no policy changes. Test 138.

-- ── The storage name rule ───────────────────────────────────────────────────

create or replace function app.flyer_art_name_ok(p_name text) returns boolean
language sql immutable set search_path = app, public, extensions as $$
  select coalesce(p_name, '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/flyer-art/[a-z][a-z0-9_]{1,39}/(frame|scene)-[1-9][0-9]{0,9}\.(png|jpg)$'
$$;

revoke execute on function app.flyer_art_name_ok(text) from public, anon, authenticated;

-- ── Asking for one layer of art ─────────────────────────────────────────────

create or replace function app.events_request_flyer_art(p_event uuid, p_occasion text, p_layer text, p_seed bigint, p_prompt text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare e app.events; v_prompt text; v_job text; v_limit text;
begin
  select * into e from app.events where id = p_event;
  if e.id is null then raise exception 'that event no longer exists.'; end if;
  perform app.assert_module_enabled(e.center_id, 'events');
  if auth.uid() is not null and not (app.has_permission(e.center_id, 'events.manage') or app.has_scoped_role(e.center_id, e.id, 'event_lead')) then
    raise exception 'only event managers and this event''s lead can ask for AI art for it.';
  end if;
  if p_occasion is null or p_occasion !~ '^[a-z][a-z0-9_]{1,39}$' then
    raise exception 'choose one of the occasions for the AI art.';
  end if;
  if p_layer is null or p_layer not in ('frame','scene') then raise exception 'ask for a frame or a bottom scene.'; end if;
  if p_seed is null or p_seed < 1 or p_seed > 2147483647 then raise exception 'the picture''s number (seed) is out of range.'; end if;
  v_prompt := btrim(coalesce(p_prompt, ''));
  if v_prompt = '' then raise exception 'the AI art request has no description.'; end if;
  v_prompt := left(v_prompt, 2000);
  if to_regproc('app.enqueue_job') is null then
    return jsonb_build_object('status', 'unavailable', 'reason', 'The background service is not set up yet, so AI art is off. The drawn art always works.');
  end if;
  v_limit := app.flyer_art_over_limit(e.center_id);
  if v_limit is not null then return jsonb_build_object('status', 'unavailable', 'reason', v_limit); end if;
  -- As 0578 A7: image bytes still held by this community's finished flyer jobs (this event's, or older than a day) are dropped first.
  update app.jobs j
     set result = j.result - 'image_b64'
   where j.kind = 'events.generate_flyer' and j.status = 'done' and j.center_id = e.center_id
     and j.result ? 'image_b64'
     and (j.payload ->> 'event_id' = e.id::text or j.finished_at < now() - interval '1 day');
  begin
    execute 'select (app.enqueue_job($1, $2, $3, $4, $5))::text' into v_job
      using e.center_id, 'events.generate_flyer',
            jsonb_build_object('event_id', e.id, 'occasion', p_occasion, 'layer', p_layer, 'seed', p_seed, 'prompt', v_prompt), now(), 3;
  exception when others then
    return jsonb_build_object('status', 'unavailable', 'reason', 'The background service did not accept the request: ' || sqlerrm);
  end;
  update app.events set flyer_job_id = v_job::bigint where id = e.id;
  return jsonb_build_object('status', 'queued', 'job_id', v_job);
end $$;

revoke execute on function app.events_request_flyer_art(uuid, text, text, bigint, text) from public, anon;
grant execute on function app.events_request_flyer_art(uuid, text, text, bigint, text) to authenticated, service_role;
