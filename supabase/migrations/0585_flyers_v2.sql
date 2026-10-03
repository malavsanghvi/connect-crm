-- Flyers v2 (owner decision 2026-10-02, "approach C"): the Poster template.
-- Our layout and every word are set by code; only the ARTWORK (a frame and a
-- bottom scene) may come from an image model, with no text in it. Every
-- occasion has a code-drawn pack that costs nothing; with a Gemini key saved
-- in Platform › Setup › AI flyer art, an organizer may ask Google Gemini for a
-- text-free layer instead. Each AI layer is generated ONCE and kept at
--
--   content/<center>/flyer-art/<occasion>/<frame|scene>-<seed>.<png|jpg>
--
-- so every later flyer for that occasion in the same community reuses it for
-- free. The organizer sees the price (about 4¢) before anything is asked for.
-- Pollinations.ai is retired: events.generate_flyer now calls Gemini (worker).
--
-- What this migration changes:
--   A1  Platform › Setup: GEMINI_API_KEY (vault) and GEMINI_IMAGE_MODEL, a new
--       optional step 'art', and its Test (enqueue_platform_test).
--   A2  app.flyer_art_writer(center): may this user add to or discard from the
--       community's AI art library? content.manage, events.manage, or the lead
--       of any of the community's events.
--   A3  app.can_read_object / app.can_write_object: the flyer-art folder
--       follows the Events module; members read it (never guests); writers
--       (A2) write and delete only well-formed layer names.  NEEDS OWNER
--       SIGN-OFF (a storage permission change).
--   A4  app.events_request_flyer_art(event, occasion, layer, seed, prompt):
--       queues one layer; a community asks for at most 30 AI pictures a day
--       (both kinds of request together), so a runaway page cannot run up the
--       bill. app.events_request_flyer (0578) gets the same daily limit.
--   A5  app.events_flyer_art_taken: also accepts the layer's own cache key
--       (exactly the occasion, layer and seed the job was asked for).
--   A6  app.flyer_art_status(center): ready / no_key / no_service /
--       update_needed and the model, from the live workers' heartbeats (no
--       secret is read; any member of the community may ask).
--   A7  Partner logos (content/<center>/events/<event>/partner-<ms>.<ext>):
--       app.event_flyer_leftovers and the 7-day sweep keep the one the saved
--       design uses and tidy the rest.
--   A8  The flyer_design column comment names the `poster` field.
--
-- Applied migrations are never edited: every function below is redefined in
-- full from its latest definition (0320, 0578).

set client_min_messages = warning;

-- ── A1. Platform › Setup ─────────────────────────────────────────────────────
-- 0320's lists, plus the Gemini key and model (src/lib/platform-setup/catalog.ts
-- holds the same lists; tests/platform-setup.test.ts keeps them in step).
-- Anyone who changes either list again must start from THESE definitions (0585):
-- a later migration that copied 0320's lists would take the Gemini names away.
create or replace function app.platform_secret_names() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array[
    'RESEND_API_KEY','RESEND_WEBHOOK_SECRET','POSTMARK_SERVER_TOKEN','POSTMARK_ACCOUNT_TOKEN','POSTMARK_WEBHOOK_TOKEN',
    'MESSAGING_LINK_SECRET','SEND_EMAIL_HOOK_SECRET','SEND_SMS_HOOK_SECRET',
    'STRIPE_SECRET_KEY','STRIPE_TEST_SECRET_KEY','STRIPE_WEBHOOK_SECRET','PAYPAL_CLIENT_SECRET','PAYPAL_SANDBOX_CLIENT_SECRET',
    'OAUTH_STATE_SECRET','TWILIO_AUTH_TOKEN','INTUIT_CLIENT_SECRET','INTUIT_SANDBOX_CLIENT_SECRET',
    'ANTHROPIC_API_KEY','EXPO_ACCESS_TOKEN','GEMINI_API_KEY']
$$;

create or replace function app.platform_setting_keys() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array[
    'portal_domain','wildcard_domain',
    'MESSAGING_EMAIL_PROVIDER','MESSAGING_FROM_ADDRESS','MESSAGING_FROM_NAME',
    'STRIPE_CLIENT_ID','PAYPAL_CLIENT_ID','PAYPAL_SANDBOX_CLIENT_ID','PAYPAL_PARTNER_ID','PAYPAL_BN_CODE',
    'PAYPAL_WEBHOOK_ID','PAYPAL_SANDBOX_WEBHOOK_ID',
    'TWILIO_ACCOUNT_SID','TWILIO_FROM_NUMBER','TWILIO_MESSAGING_SERVICE_SID',
    'INTUIT_CLIENT_ID','INTUIT_SANDBOX_CLIENT_ID','INTUIT_REDIRECT_URI','GEMINI_IMAGE_MODEL']
$$;

-- A new OPTIONAL step. It starts parked, so a platform whose setup was complete is
-- not told it is unfinished; it shows up as a parked step (the Platform home reminder
-- lists it) until the owner opens it and adds the key. A re-run keeps whatever status it has.
insert into app.platform_setup_steps (key, required, sort, status, parked_at, note)
values ('art', false, 85, 'parked', now(),
        'New with Flyers v2: add a Gemini API key so organizers can ask for AI flyer art. The drawn art works without it.')
on conflict (key) do update set required = excluded.required, sort = excluded.sort;

-- 0320's body with 'art' added to the steps the background service can test.
create or replace function app.enqueue_platform_test(p_step text)
returns bigint language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_platform_admin('test the platform setup');
  if p_step not in ('email','payments','texting','quickbooks','ai','push','art') then
    raise exception 'There is no background test for that step.';
  end if;
  perform app.set_audit_context('Platform setup: test ' || p_step);
  return app.enqueue_job(null, 'platform.test_provider', jsonb_build_object('step', p_step), now(), 1);
end $$;

-- ── A2. Who may add to (or discard from) the community's AI art library ─────
-- The people who may ask for AI art for an event (events.manage, or the lead of an
-- event: app.has_scoped_role, the rule app.events_request_flyer_art applies), and
-- content managers.
create or replace function app.flyer_art_writer(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select p_center is not null and auth.uid() is not null and (
         app.has_permission(p_center, 'content.manage')
      or app.has_permission(p_center, 'events.manage')
      or exists (select 1 from app.events ev
                  where ev.center_id = p_center and app.has_scoped_role(p_center, ev.id, 'event_lead')))
$$;

-- Internal, like app.event_flyer_is_public (0578): only the storage rules below call it, as
-- their definer, so nobody needs to (or can) call it directly.
revoke execute on function app.flyer_art_writer(uuid) from public, anon, authenticated;

-- A well-formed layer name: <center>/flyer-art/<occasion>/<frame|scene>-<seed>.<png|jpg>.
create or replace function app.flyer_art_name_ok(p_name text) returns boolean
language sql immutable set search_path = app, public, extensions as $$
  select coalesce(p_name, '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/flyer-art/(garba|paryushan|diwali|mahavir|convention|pathshala|bhakti|general)/(frame|scene)-[1-9][0-9]{0,9}\.(png|jpg)$'
$$;

revoke execute on function app.flyer_art_name_ok(text) from public, anon, authenticated;

-- ── A3. Reading and writing objects ──────────────────────────────────────────
-- 0578's bodies, with <center>/flyer-art/… in the content bucket gated on the
-- Events module (like the event folders), readable by members (the content
-- rule, unchanged) and writable only by A2's writers, only under a layer name.
create or replace function app.can_read_object(bucket text, name text) returns boolean
language plpgsql stable security definer set search_path = app, public, extensions as $$
-- $1/$2: the contract names the arguments bucket and name, which read badly next to columns.
declare b text := $1; n text := $2; c uuid := app.storage_center($2); s2 uuid := app.storage_segment_uuid($2, 2);
begin
  if b = 'branding' then return c is not null; end if;
  if c is null or not exists (select 1 from app.centers where id = c) then return false; end if;
  if not (case when b = 'content' and app.storage_segment(n, 2) in ('events', 'flyer-art')
               then app.module_enabled(c, 'events') or app.is_platform_admin()
               else app.storage_module_on(b, c) end) then return false; end if;
  return case b
    when 'content'       then app.is_member_of(c) or app.event_flyer_is_public(n)
    when 'photos'        then app.has_permission(c, 'content.manage')
                              or (app.is_member_of(c) and (
                                    (auth.uid() is not null and app.storage_segment(n, 3) like auth.uid()::text || '-%')
                                    or exists (select 1 from app.photos p
                                                where p.center_id = c and p.status = 'approved'
                                                  and p.storage_path in (n, 'photos/' || n))))
    when 'store'         then app.is_member_of(c)
    when 'statements'    then app.has_permission(c, 'giving.view')
                              or (s2 is not null and app.adult_of_household(c, s2))
    when 'recordings'    then s2 is not null and (app.can_act_for_person(c, s2) or app.teaches_person(c, s2))
    when 'imports'       then app.has_permission(c, 'people.manage') or app.has_permission(c, 'giving.manage')
                              or app.has_permission(c, 'accounting.manage') or app.has_permission(c, 'settings.manage')
    when 'org-documents' then app.is_center_owner(c) or app.is_platform_admin()
    when 'exports'       then auth.uid() is not null and s2 = auth.uid()
    else false
  end;
end $$;

create or replace function app.can_write_object(bucket text, name text) returns boolean
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare b text := $1; n text := $2; c uuid := app.storage_center($2); s2 uuid := app.storage_segment_uuid($2, 2);
begin
  if c is null or auth.uid() is null or not exists (select 1 from app.centers where id = c) then return false; end if;
  if not (case when b = 'content' and app.storage_segment(n, 2) in ('events', 'flyer-art')
               then app.module_enabled(c, 'events') or app.is_platform_admin()
               else app.storage_module_on(b, c) end) then return false; end if;
  -- The AI art library: only layer names, only the library's writers (content.manage included).
  if b = 'content' and app.storage_segment(n, 2) = 'flyer-art' then
    return app.flyer_art_name_ok(n) and app.flyer_art_writer(c);
  end if;
  return case b
    when 'branding'      then app.has_permission(c, 'settings.manage')
    when 'content'       then app.has_permission(c, 'content.manage')
                              or (app.storage_segment(n, 2) = 'events' and app.storage_segment_uuid(n, 3) is not null
                                  and exists (select 1 from app.events ev
                                               where ev.id = app.storage_segment_uuid(n, 3) and ev.center_id = c)
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

revoke execute on function app.can_read_object(text, text), app.can_write_object(text, text) from public;
grant execute on function app.can_read_object(text, text), app.can_write_object(text, text) to anon, authenticated, service_role;

-- ── A4. Ask for AI art: one Poster layer, and the daily limit ───────────────
-- At most this many AI pictures a day per community (layers and backgrounds together).
create or replace function app.flyer_art_daily_limit() returns int
language sql immutable set search_path = app, public, extensions as $$ select 30 $$;

revoke execute on function app.flyer_art_daily_limit() from public, anon, authenticated;

-- The limit's message when it is reached, or null.
create or replace function app.flyer_art_over_limit(p_center uuid) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select case when count(*) >= app.flyer_art_daily_limit()
              then 'This community has asked for ' || app.flyer_art_daily_limit() || ' AI pictures in the last 24 hours, the most allowed in a day. '
                   || 'Reuse one already made, use the drawn art, or try again tomorrow.'
         end
    from app.jobs
   where center_id = p_center and kind = 'events.generate_flyer' and created_at > now() - interval '24 hours'
$$;

revoke execute on function app.flyer_art_over_limit(uuid) from public, anon, authenticated;

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
  if p_occasion is null or p_occasion not in ('garba','paryushan','diwali','mahavir','convention','pathshala','bhakti','general') then
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

-- 0578's body, with the daily limit (AI art now costs money).
create or replace function app.events_request_flyer(p_event uuid, p_prompt text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare e app.events; v_prompt text; v_job text; v_limit text;
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
  if to_regproc('app.enqueue_job') is null then
    return jsonb_build_object('status', 'unavailable', 'reason', 'The background service is not set up yet, so AI flyers are off. Upload a flyer instead.');
  end if;
  v_limit := app.flyer_art_over_limit(e.center_id);
  if v_limit is not null then return jsonb_build_object('status', 'unavailable', 'reason', v_limit); end if;
  update app.jobs j
     set result = j.result - 'image_b64'
   where j.kind = 'events.generate_flyer' and j.status = 'done' and j.center_id = e.center_id
     and j.result ? 'image_b64'
     and (j.payload ->> 'event_id' = e.id::text or j.finished_at < now() - interval '1 day');
  begin
    execute 'select (app.enqueue_job($1, $2, $3, $4, $5))::text' into v_job
      using e.center_id, 'events.generate_flyer', jsonb_build_object('event_id', e.id, 'prompt', v_prompt), now(), 2;
  exception when others then
    return jsonb_build_object('status', 'unavailable', 'reason', 'The background service did not accept the request: ' || sqlerrm);
  end;
  update app.events set flyer_job_id = v_job::bigint where id = e.id;
  return jsonb_build_object('status', 'queued', 'job_id', v_job);
end $$;

revoke execute on function app.events_request_flyer(uuid, text) from public, anon;
grant execute on function app.events_request_flyer(uuid, text) to authenticated, service_role;

-- ── A5. The AI art is stored: drop its bytes from the job ───────────────────
-- 0578's body; a job that asked for a Poster layer accepts exactly that
-- layer's cache key (its occasion, layer and seed), nothing else.
create or replace function app.events_flyer_art_taken(p_event uuid, p_path text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare e app.events; v_payload jsonb; v_key text;
begin
  select * into e from app.events where id = p_event;
  if e.id is null then raise exception 'that event no longer exists.'; end if;
  if auth.uid() is not null and not (app.has_permission(e.center_id, 'events.manage') or app.has_scoped_role(e.center_id, e.id, 'event_lead')) then
    raise exception 'only event managers and this event''s lead can save this event''s flyer art.';
  end if;
  if e.flyer_job_id is not null then
    select payload into v_payload from app.jobs where id = e.flyer_job_id and kind = 'events.generate_flyer';
  end if;
  if v_payload ? 'layer' then
    v_key := e.center_id::text || '/flyer-art/' || (v_payload ->> 'occasion') || '/' || (v_payload ->> 'layer') || '-' || (v_payload ->> 'seed');
    if p_path is null or p_path not in (v_key || '.png', v_key || '.jpg') or not app.flyer_art_name_ok(p_path) then
      raise exception 'that file is not the art this request made.';
    end if;
  elsif p_path is null
     or left(p_path, length(e.center_id::text || '/events/' || e.id::text || '/art-')) <> e.center_id::text || '/events/' || e.id::text || '/art-'
     or p_path like '%/%/%/%/%' or p_path like '%..%' then
    raise exception 'that file is not this event''s flyer art.';
  end if;
  if e.flyer_job_id is null then return; end if;
  update app.jobs
     set result = (coalesce(result, '{}'::jsonb) - 'image_b64') || jsonb_build_object('stored_path', p_path, 'stored_at', now())
   where id = e.flyer_job_id and kind = 'events.generate_flyer' and status = 'done';
end $$;

revoke execute on function app.events_flyer_art_taken(uuid, text) from public, anon;
grant execute on function app.events_flyer_art_taken(uuid, text) to authenticated, service_role;

-- ── A6. Is AI art available? ─────────────────────────────────────────────────
-- From the live workers' heartbeats (info.handlers['events.generate_flyer'] =
-- {configured, provider: 'gemini', model}; worker/src/handlers/events.generate_flyer.ts).
--   ready          a live worker has a Gemini key (and says which model)
--   no_key         live workers, none with a key
--   update_needed  live workers, none of them knows Gemini yet (an older deploy)
--   no_service     no worker has reported in the last few minutes
create or replace function app.flyer_art_status(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_live int; v_h jsonb;
begin
  if not (app.is_member_of(p_center) or app.is_platform_admin()) then
    raise exception 'you can''t see this community''s flyer settings.' using errcode = 'insufficient_privilege';
  end if;
  select count(*) into v_live from app.worker_heartbeats
   where stopped_at is null and beat_at >= now() - app.worker_stale_after();
  if v_live = 0 then return jsonb_build_object('state', 'no_service'); end if;
  select h.info -> 'handlers' -> 'events.generate_flyer' into v_h
    from app.worker_heartbeats h
   where h.stopped_at is null and h.beat_at >= now() - app.worker_stale_after()
     and h.info -> 'handlers' -> 'events.generate_flyer' ->> 'provider' = 'gemini'
   order by (h.info -> 'handlers' -> 'events.generate_flyer' ->> 'configured') = 'true' desc, h.beat_at desc
   limit 1;
  if v_h is null then return jsonb_build_object('state', 'update_needed'); end if;
  if v_h ->> 'configured' = 'true' then
    return jsonb_build_object('state', 'ready', 'model', left(coalesce(v_h ->> 'model', ''), 80));
  end if;
  return jsonb_build_object('state', 'no_key');
end $$;

revoke execute on function app.flyer_art_status(uuid) from public, anon;
grant execute on function app.flyer_art_status(uuid) to authenticated, service_role;

-- ── A7. Partner logos: tidy what the saved design does not use ──────────────
-- 0578's body; partner-* files are kept a day (an organizer may still be
-- choosing) and the one the saved design uses is never listed.
create or replace function app.event_flyer_leftovers(p_event uuid) returns table (name text)
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare e app.events; v_prefix text; v_current text; v_art text; v_partner text;
begin
  select * into e from app.events where id = p_event;
  if e.id is null then raise exception 'that event no longer exists.'; end if;
  if auth.uid() is not null and not (app.has_permission(e.center_id, 'events.manage') or app.has_scoped_role(e.center_id, e.id, 'event_lead')) then
    raise exception 'only event managers and this event''s lead can tidy this event''s flyer files.';
  end if;
  v_prefix := e.center_id::text || '/events/' || e.id::text || '/';
  v_current := case when e.flyer_path like 'content/%' then substr(e.flyer_path, 9) else e.flyer_path end;
  v_art := e.flyer_design #>> '{background,path}';
  v_partner := e.flyer_design #>> '{poster,partner,logo_path}';
  return query
    select o.name::text
      from storage.objects o
     where o.bucket_id = 'content'
       and left(o.name, length(v_prefix)) = v_prefix
       and (app.storage_segment(o.name, 4) like 'flyer-%' or app.storage_segment(o.name, 4) like 'art-%'
            or app.storage_segment(o.name, 4) like 'partner-%')
       and o.name is distinct from v_current
       and o.name is distinct from v_art
       and o.name is distinct from v_partner
       and o.created_at < now() - case when app.storage_segment(o.name, 4) like 'flyer-%' then interval '10 minutes' else interval '1 day' end
     order by o.created_at, o.name
     limit 200;
end $$;

revoke execute on function app.event_flyer_leftovers(uuid) from public, anon;
grant execute on function app.event_flyer_leftovers(uuid) to authenticated, service_role;

-- 0578's body; orphaned partner logos join the 7-day sweep. The flyer-art
-- library is never swept: it is the cache every later flyer reuses.
create or replace function app.storage_expired_objects(p_limit int default 500)
returns table (bucket_id text, name text, center_id uuid, created_at timestamptz, retention_days int)
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  return query
  select x.bucket_id, x.name, x.center_id, x.created_at, x.retention_days
    from (
      select o.bucket_id::text as bucket_id, o.name::text as name, app.storage_center(o.name) as center_id, o.created_at as created_at,
             app.storage_retention_days(o.bucket_id, app.storage_center(o.name)) as retention_days
        from storage.objects o
       where o.bucket_id in ('imports','exports','recordings')
         and o.created_at < now() - make_interval(days => app.storage_retention_days(o.bucket_id, app.storage_center(o.name)))
      union all
      select o.bucket_id::text, o.name::text, app.storage_center(o.name), o.created_at, 7
        from storage.objects o
       where o.bucket_id = 'content'
         and app.storage_segment(o.name, 2) = 'events'
         and (app.storage_segment(o.name, 4) like 'flyer-%' or app.storage_segment(o.name, 4) like 'art-%'
              or app.storage_segment(o.name, 4) like 'partner-%')
         and o.created_at < now() - interval '7 days'
         and not exists (select 1 from app.events e
                          where e.flyer_path in (o.name, 'content/' || o.name)
                             or e.flyer_design #>> '{background,path}' = o.name
                             or e.flyer_design #>> '{poster,partner,logo_path}' = o.name)
    ) x
   order by x.created_at
   limit least(greatest(coalesce(p_limit, 500), 1), 1000);
end $$;

revoke execute on function app.storage_expired_objects(int) from public, anon, authenticated, service_role;
grant execute on function app.storage_expired_objects(int) to connect_worker;

-- ── A8. The design's shape ───────────────────────────────────────────────────
comment on column app.events.flyer_design is
  'The flyer maker design behind the current flyer (flyer_source = designed), v1: '
  '{v: 1, template: classic|festival|minimal|photo|poster, size: post|tall|story|print, headline (1-90 chars), '
  'tagline (0-180), date_line (0-90), venue_line (0-120), show_qr: boolean, background: '
  '{source: pattern, pattern: lotus|rangoli|diya|mandala} | {source: photo, photo_id: uuid} | '
  '{source: ai, path: <center>/events/<event>/art-<ms>.jpg|png, prompt: text} | {source: plain}, '
  'poster (0585, optional; required when template = poster): {occasion, frame and scene: {source: code|none} | '
  '{source: ai, path: <center>/flyer-art/<occasion>/<frame|scene>-<seed>.png|jpg}, logo, partner {on, label, sub, '
  'logo_path: <center>/events/<event>/partner-<ms>.png|jpg}, subhead, slogan, stat {on, icon, label, value, caption}, '
  'ribbon {on, date, time}, agenda [{icon, time, text}] (0-5), paragraph, footer}, '
  'made_for: {starts_at, ends_at, venue} (the event''s own values when the flyer was saved, so a later change is flagged)}. '
  'Written only by the portal (connect-crm). NULL for an uploaded or older AI flyer.';
