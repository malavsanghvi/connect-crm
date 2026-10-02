-- Event flyers, v1 of the flyer maker (owner decisions 2026-10-01).
--
-- The portal now DESIGNS a flyer from the brand kit (template, size, headline,
-- tagline, date, venue, RSVP QR code) over one of four backgrounds: a pattern
-- drawn in code (lotus, rangoli, diya, mandala), a photo from the community's
-- own approved albums, free AI background art (Pollinations.ai, abstract or
-- decorative only: no text, no people, no deities or murtis), or a plain
-- colour. The design is kept on the event (flyer_design) so it can be
-- reopened and changed; the rendered PNG is the flyer (flyer_path).
--
-- What this migration changes:
--   A1  events.flyer_design (jsonb object) and flyer_source 'designed'.
--   A2  app.event_flyer_is_public(name): is this object the CURRENT flyer of an
--       event guests may see? Internal; only can_read_object calls it.
--   A3  app.can_read_object: anyone (anon included) may read that one object.
--       Centre members read all content as before. Event-folder paths are
--       gated on the Events module instead of the Content module.
--   A4  app.can_write_object: the event folder must belong to an event of
--       that centre (0535 never checked), with the same Events-module gate.
--   A5  app.event_flyer_leftovers(event): replaced or unused flyer and art
--       files the portal removes after a save (B17 gap 4).
--   A6  app.events_flyer_art_taken(event, path): once the portal has stored
--       the AI art, the image bytes leave app.jobs.result (B17 gap 2).
--   A7  app.events_request_flyer: strips old image bytes before queueing.
--   A8  app.storage_expired_objects / record_storage_deletions: a 7-day sweep
--       of orphaned flyer and art files (runs only where the worker holds
--       WORKER_SUPABASE_SECRET_KEY, docs/DEPLOY.md).
--   A9  events_public_read gains `not confidential` (owner sign-off needed).
--   A10 app.audit_mask: a job's result.image_b64 (the AI art bytes) is masked,
--       so the append-only audit log never keeps a copy of the image.
--
-- 0172 and 0535 are applied migrations and are never edited: every function
-- and policy below is redefined in full.

-- ── A1. The design, and flyer_source 'designed' ─────────────────────────────
alter table app.events add column if not exists flyer_design jsonb;
alter table app.events drop constraint if exists events_flyer_design_check;
alter table app.events add constraint events_flyer_design_check
  check (flyer_design is null or jsonb_typeof(flyer_design) = 'object');

comment on column app.events.flyer_design is
  'The flyer maker design behind the current flyer (flyer_source = designed), v1: '
  '{v: 1, template: classic|festival|minimal|photo, size: post|story|print, headline (1-90 chars), '
  'tagline (0-180), date_line (0-90), venue_line (0-120), show_qr: boolean, background: '
  '{source: pattern, pattern: lotus|rangoli|diya|mandala} | {source: photo, photo_id: uuid} | '
  '{source: ai, path: <center>/events/<event>/art-<ms>.jpg|png, prompt: text} | {source: plain}, '
  'made_for: {starts_at, ends_at, venue} (the event''s own values when the flyer was saved, so a later change is flagged)}. '
  'Written only by the portal (connect-crm). NULL for an uploaded or older AI flyer.';

-- 0535 declared the flyer_source check inline (manual, ai), so its name is
-- whatever Postgres chose; drop every check that mentions the column.
do $$
declare r record;
begin
  for r in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'app.events'::regclass and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%flyer_source%'
  loop
    execute format('alter table app.events drop constraint %I', r.conname);
  end loop;
end $$;
alter table app.events add constraint events_flyer_source_check
  check (flyer_source in ('manual', 'ai', 'designed'));

comment on column app.events.flyer_source is
  'How the current flyer_path was produced: designed (the flyer maker), manual (uploaded) or ai (an earlier full AI flyer). '
  'NULL: no flyer, or one set before this column existed.';

-- ── A2. Is this object the current flyer of a guest-visible event? ──────────
-- True only for the exact object the event's flyer_path names (a legacy value
-- may carry the bucket prefix), inside that event's own folder, for an event
-- guests may see: audience public or members and guests, published / RSVPs
-- closed / live, and not confidential. Older flyers and AI art files are never
-- public, even if a flyer_path were pointed at one by hand.
create or replace function app.event_flyer_is_public(p_name text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select app.storage_segment(p_name, 2) = 'events'
     and coalesce(app.storage_segment(p_name, 4), '') not like 'art-%'
     and exists (
       select 1
         from app.events e
        where e.id = app.storage_segment_uuid(p_name, 3)
          and e.center_id = app.storage_center(p_name)
          and e.flyer_path in (p_name, 'content/' || p_name)
          and e.audience in ('public', 'members_and_guests')
          and e.status in ('published', 'rsvp_closed', 'live')
          and not e.confidential)
$$;

revoke execute on function app.event_flyer_is_public(text) from public, anon, authenticated;

-- ── A3. Reading objects ─────────────────────────────────────────────────────
-- 0172's body verbatim, with two changes: (i) a path under <center>/events/ in
-- the content bucket is gated on the Events module (an event flyer belongs to
-- Events, not to Content & library); (ii) the content branch also lets anyone
-- read the current flyer of a guest-visible event (A2).
create or replace function app.can_read_object(bucket text, name text) returns boolean
language plpgsql stable security definer set search_path = app, public, extensions as $$
-- $1/$2: the contract names the arguments bucket and name, which read badly next to columns.
declare b text := $1; n text := $2; c uuid := app.storage_center($2); s2 uuid := app.storage_segment_uuid($2, 2);
begin
  if b = 'branding' then return c is not null; end if;
  if c is null or not exists (select 1 from app.centers where id = c) then return false; end if;
  if not (case when b = 'content' and app.storage_segment(n, 2) = 'events'
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

-- ── A4. Writing objects ─────────────────────────────────────────────────────
-- 0535's body, with the same Events-module gate for event folders, and an
-- event folder must name an event of THIS centre (0535 accepted any uuid).
create or replace function app.can_write_object(bucket text, name text) returns boolean
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare b text := $1; n text := $2; c uuid := app.storage_center($2); s2 uuid := app.storage_segment_uuid($2, 2);
begin
  if c is null or auth.uid() is null or not exists (select 1 from app.centers where id = c) then return false; end if;
  if not (case when b = 'content' and app.storage_segment(n, 2) = 'events'
               then app.module_enabled(c, 'events') or app.is_platform_admin()
               else app.storage_module_on(b, c) end) then return false; end if;
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

-- ── A5. Flyer files the portal may tidy up ──────────────────────────────────
-- After a flyer is saved, replaced or removed, the portal removes the event's
-- other flyer-* and art-* files through the Storage API, as the signed-in
-- editor (the 0172 delete policy allows an editor to delete what they may
-- write). Never the current flyer, never the art the saved design uses; art
-- is kept a day (an organizer may still be choosing), other files ten minutes
-- (a save in flight in another tab). Gated like app.events_flyer_result.
create or replace function app.event_flyer_leftovers(p_event uuid) returns table (name text)
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare e app.events; v_prefix text; v_current text; v_art text;
begin
  select * into e from app.events where id = p_event;
  if e.id is null then raise exception 'that event no longer exists.'; end if;
  if auth.uid() is not null and not (app.has_permission(e.center_id, 'events.manage') or app.has_scoped_role(e.center_id, e.id, 'event_lead')) then
    raise exception 'only event managers and this event''s lead can tidy this event''s flyer files.';
  end if;
  v_prefix := e.center_id::text || '/events/' || e.id::text || '/';
  v_current := case when e.flyer_path like 'content/%' then substr(e.flyer_path, 9) else e.flyer_path end;
  v_art := e.flyer_design #>> '{background,path}';
  return query
    select o.name::text
      from storage.objects o
     where o.bucket_id = 'content'
       and left(o.name, length(v_prefix)) = v_prefix
       and (app.storage_segment(o.name, 4) like 'flyer-%' or app.storage_segment(o.name, 4) like 'art-%')
       and o.name is distinct from v_current
       and o.name is distinct from v_art
       and o.created_at < now() - case when app.storage_segment(o.name, 4) like 'art-%' then interval '1 day' else interval '10 minutes' end
     order by o.created_at, o.name
     limit 200;
end $$;

revoke execute on function app.event_flyer_leftovers(uuid) from public, anon;
grant execute on function app.event_flyer_leftovers(uuid) to authenticated, service_role;

-- ── A6. The AI art is stored: drop its bytes from the job ───────────────────
-- The worker hands the image back inside app.jobs.result (it holds no Storage
-- key for this). Once the portal has uploaded it to
-- content/<center>/events/<event>/art-<ms>.<ext>, the bytes are removed from
-- the job and the stored path is recorded instead, so a reload finds the art
-- without the database keeping a second copy (B17 gap 2).
create or replace function app.events_flyer_art_taken(p_event uuid, p_path text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare e app.events;
begin
  select * into e from app.events where id = p_event;
  if e.id is null then raise exception 'that event no longer exists.'; end if;
  if auth.uid() is not null and not (app.has_permission(e.center_id, 'events.manage') or app.has_scoped_role(e.center_id, e.id, 'event_lead')) then
    raise exception 'only event managers and this event''s lead can save this event''s flyer art.';
  end if;
  if p_path is null
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

-- ── A7. Ask for AI art (signature and body of 0535) ─────────────────────────
-- Before queueing, image bytes still held by this centre's finished flyer jobs
-- for this event, or finished more than a day ago, are removed: the portal
-- stores the art as a file, so app.jobs never piles up images.
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

-- ── A8. Retention: orphaned flyer and art files after 7 days ────────────────
-- 0172's two worker functions, copied, plus event flyer-* and art-* files in
-- the content bucket that no event uses any more (neither its flyer_path nor
-- its design's background art), once they are 7 days old. The cleanup the
-- portal runs on every save usually removes them first; this catches the
-- rest (a failed cleanup, art generated and never used).
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
         and (app.storage_segment(o.name, 4) like 'flyer-%' or app.storage_segment(o.name, 4) like 'art-%')
         and o.created_at < now() - interval '7 days'
         and not exists (select 1 from app.events e
                          where e.flyer_path in (o.name, 'content/' || o.name)
                             or e.flyer_design #>> '{background,path}' = o.name)
    ) x
   order by x.created_at
   limit least(greatest(coalesce(p_limit, 500), 1), 1000);
end $$;

-- connect_worker: after the Storage API removed the files, one audit entry per
-- object, and recordings no longer point at a file that is gone.
create or replace function app.record_storage_deletions(p_job bigint, p_objects jsonb)
returns int language plpgsql security definer set search_path = app, public, extensions as $$
declare o jsonb; n int := 0; v_center uuid; v_days int;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  for o in select * from jsonb_array_elements(coalesce(p_objects, '[]'::jsonb)) loop
    v_center := app.storage_center(o->>'name');
    v_days := app.storage_retention_days(o->>'bucket', v_center);
    perform app.log_audit(v_center, 'storage.retention_delete', 'storage.objects', (o->>'bucket') || '/' || (o->>'name'),
                          jsonb_build_object('bucket', o->>'bucket', 'name', o->>'name', 'created_at', o->>'created_at'),
                          null,
                          case when o->>'bucket' = 'content'
                               then 'Event flyer tidy-up: a replaced or unused flyer file (job ' || p_job || ')'
                               else 'Retention: ' || (o->>'bucket') || ' files are kept ' || coalesce(v_days::text, '?') || ' days (job ' || p_job || ')'
                          end);
    if o->>'bucket' = 'recordings' then
      update app.gyan_progress set recording_path = null
       where recording_path in (o->>'name', 'recordings/' || (o->>'name'));
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function app.storage_expired_objects(int), app.record_storage_deletions(bigint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function app.storage_expired_objects(int), app.record_storage_deletions(bigint, jsonb) to connect_worker;

-- ── A9. Guests never see a confidential event (NEEDS OWNER SIGN-OFF) ────────
-- 0010's events_public_read let a guest (anon) read a confidential event that
-- is public or members-and-guests; events_member_read already excluded
-- confidential events for members. This matches the owner's rule and the
-- guest flyer rule above (A2). If the owner declines, drop this section: the
-- flyer rule stays correct on its own because A2 checks confidential itself.
drop policy if exists events_public_read on app.events;
create policy events_public_read on app.events for select to anon
  using (audience in ('public', 'members_and_guests') and status in ('published', 'rsvp_closed', 'live') and not confidential);

-- ── A10. The AI art bytes never reach the audit log ─────────────────────────
-- app.jobs is audited row by row (0171), and app.audit_log is append-only and
-- hash-chained, so a finished events.generate_flyer job used to keep its
-- base64 image (a few hundred KB) in the entry's after-image for ever, and the
-- strip in A6/A7 added a second copy in the before-image. Masking
-- result.image_b64 keeps both out; the rest of the result (content type,
-- model, prompt, stored_path) stays in the log.
-- Starts from 0573's definition (see the note there) and adds result.image_b64.
-- Anyone who changes app.audit_mask again must start from THIS definition
-- (0578), including the Niva migrations numbered 0574–0577 that may be merged
-- after it.
--   0102   date_of_birth and the secrets / tokens
--   0546   the emergency contact's name and number, both dietary fields
--   0545   staged_rows (the uploaded rows, personal data) and merge_answers (they grow with the file)
--   0573   niva_tsv (derived search vector, dropped rather than masked)
--   0578   result.image_b64 (AI flyer art bytes in app.jobs.result)
create or replace function app.audit_mask(j jsonb) returns jsonb
language sql immutable as $$
  select case when j is null then null else
    j - 'date_of_birth' - 'provider_ref' - 'fee_authorization_ref' - 'secret_ref' - 'niva_tsv'
      || case when j ? 'date_of_birth' then jsonb_build_object('date_of_birth', '***') else '{}'::jsonb end
      || case when j->>'ticket_token' is not null then jsonb_build_object('ticket_token', '***') else '{}'::jsonb end
      || case when j->>'attendance_token' is not null then jsonb_build_object('attendance_token', '***') else '{}'::jsonb end
      || case when j->>'token' is not null then jsonb_build_object('token', '***') else '{}'::jsonb end
      || case when j->>'emergency_contact_name' is not null then jsonb_build_object('emergency_contact_name', '***') else '{}'::jsonb end
      || case when j->>'emergency_contact_phone' is not null then jsonb_build_object('emergency_contact_phone', '***') else '{}'::jsonb end
      || case when j->>'dietary_other' is not null then jsonb_build_object('dietary_other', '***') else '{}'::jsonb end
      || case when j->'dietary' is not null and j->'dietary' <> '[]'::jsonb and j->'dietary' <> 'null'::jsonb
              then jsonb_build_object('dietary', '***') else '{}'::jsonb end
      || case when j ? 'staged_rows' then jsonb_build_object('staged_rows', '***') else '{}'::jsonb end
      || case when j ? 'merge_answers' then jsonb_build_object('merge_answers', '***') else '{}'::jsonb end
      || case when jsonb_typeof(j->'result') = 'object' and (j->'result') ? 'image_b64'
              then jsonb_build_object('result', (j->'result') || jsonb_build_object('image_b64', '***')) else '{}'::jsonb end
  end
$$;
