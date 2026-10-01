-- 0564_google_album_import.sql: bring the photos of an album's Google Photos link into the app.
--
-- Staff create an album (Content › Photos) with the community's shared Google Photos album as its
-- external_url. The member app only shows rows of app.photos, so the album read "No photos" while the
-- real album held hundreds. This adds an import, with nothing copied or hosted:
--   app.import_external_album(album)         staff (content.manage): queue the import job
--   app.photo_album_import_status(album)     staff: importing now? last result, last error in plain English
--   app.photos_worker_save_import(...)       worker: add the photos as PENDING rows of app.photos
--   app.photos_worker_record_failure(...)    worker: remember why an import failed, on the album
-- The background service reads the public share page (worker/src/handlers/photos.import_album.ts) and
-- hands back each photo's base image address (https://lh3.googleusercontent.com/pw/<token>, no size
-- suffix; the app adds "=w480-h480-c" for a grid thumbnail or "=w1600" for a full view). storage_path
-- already accepts a full https URL (the app passes it through), so an imported photo is an ordinary row.
--
-- Policy (founder rules): photos follow moderation. Imported photos are ALWAYS 'pending'; a content manager
-- approves them (the album page's "Approve all"). A photo already in the album, whatever its status, is
-- never added again, so a photo someone rejected or removed is never resurrected by a re-import. At most
-- 1,000 photos are added per run, and an album never holds more than 2,000 waiting or approved photos (the
-- member app loads 2,000 per album). Videos are not imported.

set client_min_messages = warning;

-- ── What the album remembers about its last import ───────────────────────────
alter table app.photo_albums
  add column if not exists external_synced_at timestamptz,
  add column if not exists external_photo_count integer check (external_photo_count is null or external_photo_count >= 0),
  add column if not exists external_sync_error text;
comment on column app.photo_albums.external_synced_at is 'When photos were last imported from external_url (a Google Photos shared album).';
comment on column app.photo_albums.external_photo_count is 'How many photos the last import found on the Google Photos album (videos are not counted).';
comment on column app.photo_albums.external_sync_error is 'Plain-English reason the last import failed or only partly worked; cleared by the next good import.';

-- The album page, the import and the member app all look photos up by album.
create index if not exists photos_album_idx on app.photos (album_id);

-- ── Is this a Google Photos shared-album link? ──────────────────────────────
-- photos.app.goo.gl/<id> or photos.google.com/share/<id>?key=...; the same rule as src/lib/google-photos.ts
-- and the worker. Anything else (another site, a single photo, a private album page) is refused.
create or replace function app.is_google_photos_album_url(p_url text) returns boolean
language sql immutable set search_path = app, public, extensions as $$
  select p_url is not null
     and char_length(btrim(p_url)) between 1 and 2000
     and (btrim(p_url) ~* '^https?://photos\.app\.goo\.gl/[A-Za-z0-9_-]{8,64}/?([?#][^[:space:]]*)?$'
          or btrim(p_url) ~* '^https?://photos\.google\.com/(u/[0-9]{1,2}/)?share/[A-Za-z0-9_-]{20,200}/?([?#][^[:space:]]*)?$')
$$;

-- ── Staff: queue the import ──────────────────────────────────────────────────
create or replace function app.import_external_album(p_album uuid)
returns bigint
language plpgsql security definer set search_path = app, public, extensions as $$
declare a app.photo_albums; v_job bigint;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  select * into a from app.photo_albums where id = p_album;
  if not found then raise exception 'That album was not found.'; end if;
  if not app.has_permission(a.center_id, 'content.manage') then
    raise exception 'Importing photos from Google Photos needs content.manage.' using errcode = 'insufficient_privilege';
  end if;
  perform app.assert_module_enabled(a.center_id, 'content');
  if not app.is_google_photos_album_url(a.external_url) then
    raise exception 'This album has no Google Photos link. Add a shared-album link (photos.app.goo.gl/… or photos.google.com/share/…) to the album first.';
  end if;

  -- One import per album at a time (two clicks at once queue one job).
  perform pg_advisory_xact_lock(hashtextextended('app.import_external_album:' || p_album::text, 0));
  if exists (select 1 from app.jobs where kind = 'photos.import_album' and status in ('queued', 'running') and payload->>'album_id' = p_album::text) then
    raise exception 'An import for this album is already running. Wait for it to finish, then try again.';
  end if;

  v_job := app.enqueue_job(a.center_id, 'photos.import_album', jsonb_build_object('album_id', p_album, 'url', btrim(a.external_url)), now(), 3);
  return v_job;
end $$;

-- ── Staff: where the import stands ───────────────────────────────────────────
create or replace function app.photo_album_import_status(p_album uuid)
returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare a app.photo_albums; q app.jobs; f app.jobs; v_error text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  select * into a from app.photo_albums where id = p_album;
  if not found then raise exception 'That album was not found.'; end if;
  if not app.has_permission(a.center_id, 'content.manage') then
    raise exception 'Seeing the Google Photos import needs content.manage.' using errcode = 'insufficient_privilege';
  end if;
  select * into q from app.jobs
   where kind = 'photos.import_album' and payload->>'album_id' = p_album::text and status in ('queued', 'running')
   order by id desc limit 1;
  v_error := a.external_sync_error;
  if v_error is null then
    -- The worker could not even record its failure (it died): fall back to what the job says.
    select * into f from app.jobs
     where kind = 'photos.import_album' and payload->>'album_id' = p_album::text and status = 'failed'
     order by id desc limit 1;
    if f.id is not null and f.finished_at > coalesce(a.external_synced_at, '-infinity'::timestamptz) then v_error := f.last_error; end if;
  end if;
  return jsonb_build_object(
    'has_link', app.is_google_photos_album_url(a.external_url),
    'importing', q.id is not null,
    'since', q.created_at,
    'synced_at', a.external_synced_at,
    'photo_count', a.external_photo_count,
    'error', v_error);
end $$;

-- ── Worker: add the photos as pending rows ───────────────────────────────────
-- p_urls: a JSON list of base image addresses in the album's order. Only https://lh3-6.googleusercontent.com
-- addresses of the expected shape are accepted; anything else is ignored. A photo already in the album
-- (compared without any "=size" suffix), in any status, is skipped. created_at steps up a millisecond per
-- photo so the app, which orders an album by created_at, shows them in Google's order.
create or replace function app.photos_worker_save_import(p_center uuid, p_album uuid, p_urls jsonb, p_found integer, p_videos integer, p_note text)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_center uuid;
  v_per_run constant int := 1000;
  v_album_max constant int := 2000;
  v_valid int; v_known int; v_active int; v_new int; v_take int; v_added int := 0;
  v_start timestamptz := clock_timestamp();
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  if p_center is null or p_album is null then raise exception 'photos_worker_save_import needs the community and the album.'; end if;
  if jsonb_typeof(p_urls) is distinct from 'array' then raise exception 'photos_worker_save_import needs the photo addresses as a list.'; end if;
  if jsonb_array_length(p_urls) > 10000 then raise exception 'photos_worker_save_import takes at most 10,000 addresses per call (got %).', jsonb_array_length(p_urls); end if;

  -- Serialises two imports of one album, so the "already there" check below cannot race.
  select center_id into v_center from app.photo_albums where id = p_album and center_id = p_center for update;
  if not found then raise exception 'That album no longer exists.'; end if;
  if not app.module_enabled(p_center, 'content') then
    raise exception 'The Content module is switched off for this community, so no photos were imported.';
  end if;

  with src as (
    select u.url
      from jsonb_array_elements_text(p_urls) as u(url)
     where u.url ~ '^https://lh[3-6]\.googleusercontent\.com/[A-Za-z0-9_/-]{40,255}$'
     group by u.url),
  known as (
    select distinct split_part(p.storage_path, '=', 1) as u from app.photos p where p.album_id = p_album)
  select count(*), count(k.u) into v_valid, v_known
    from src s left join known k on k.u = s.url;

  select count(*) into v_active from app.photos where album_id = p_album and status in ('pending', 'approved');
  v_new := v_valid - v_known;
  v_take := least(v_new, v_per_run, greatest(0, v_album_max - v_active));

  if v_take > 0 then
    perform set_config('app.audit_reason', 'Imported from the album''s Google Photos link; waiting for approval', true);
    with src as (
      select u.url, min(u.ord) as ord
        from jsonb_array_elements_text(p_urls) with ordinality as u(url, ord)
       where u.url ~ '^https://lh[3-6]\.googleusercontent\.com/[A-Za-z0-9_/-]{40,255}$'
       group by u.url),
    known as (
      select distinct split_part(p.storage_path, '=', 1) as u from app.photos p where p.album_id = p_album),
    fresh as (
      select s.url, s.ord from src s
       where not exists (select 1 from known k where k.u = s.url)
       order by s.ord
       limit v_take),
    ins as (
      insert into app.photos (center_id, album_id, storage_path, uploaded_by, contains_children, status, moderated_by, created_at)
      select p_center, p_album, f.url, null, false, 'pending', null, v_start + (f.ord::int * interval '1 millisecond')
        from fresh f
      returning 1)
    select count(*) into v_added from ins;
  end if;

  perform set_config('app.audit_reason', 'Google Photos import finished', true);
  update app.photo_albums
     set external_synced_at = now(),
         external_photo_count = greatest(coalesce(p_found, v_valid), 0),
         external_sync_error = nullif(left(btrim(coalesce(p_note, '')), 500), '')
   where id = p_album;

  return jsonb_build_object('found', v_valid, 'added', v_added, 'already_there', v_known,
                            'not_added_limit', v_new - v_added, 'videos_skipped', greatest(coalesce(p_videos, 0), 0));
end $$;

-- ── Worker: remember why an import failed ────────────────────────────────────
create or replace function app.photos_worker_record_failure(p_center uuid, p_album uuid, p_error text)
returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  perform set_config('app.audit_reason', 'Google Photos import failed', true);
  update app.photo_albums
     set external_sync_error = left(coalesce(nullif(btrim(p_error), ''), 'The import failed.'), 500)
   where id = p_album and center_id = p_center;
end $$;

comment on function app.import_external_album(uuid) is
  'Staff (content.manage, Content module on): queue photos.import_album for an album whose external_url is a Google Photos shared-album link. One import per album at a time. Returns the job id.';
comment on function app.photo_album_import_status(uuid) is
  'Staff (content.manage): {has_link, importing, since, synced_at, photo_count, error} for the album''s Google Photos import.';
comment on function app.photos_worker_save_import(uuid, uuid, jsonb, integer, integer, text) is
  'Worker only: add imported photos (base image addresses) to an album as PENDING rows; skips any address already in the album in any status; at most 1000 per run and 2000 waiting or approved per album.';
comment on function app.photos_worker_record_failure(uuid, uuid, text) is
  'Worker only: remember a plain-English reason an album import failed.';

-- ── Grants ───────────────────────────────────────────────────────────────────
revoke execute on function app.is_google_photos_album_url(text), app.import_external_album(uuid), app.photo_album_import_status(uuid),
  app.photos_worker_save_import(uuid, uuid, jsonb, integer, integer, text), app.photos_worker_record_failure(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function app.import_external_album(uuid), app.photo_album_import_status(uuid) to authenticated;
grant execute on function app.photos_worker_save_import(uuid, uuid, jsonb, integer, integer, text), app.photos_worker_record_failure(uuid, uuid, text) to connect_worker;
