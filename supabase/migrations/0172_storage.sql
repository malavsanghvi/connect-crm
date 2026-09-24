-- Onboarding (stream o-vault) · 3 of 3: file storage (plan §1.9).
--
-- Nine buckets, created for every organization at once: every object path
-- starts with "<center_id>/", and the policies below read that first segment.
--
--   bucket         public  read                                           write
--   branding       yes     anyone                                         settings.manage
--   content        no      the center's members                           content.manage
--   photos         no      content.manage; members: approved photos       content.manage; a member into
--                          and their own uploads                          <center>/<album>/<their user id>-…
--   store          no      the center's members                           store.manage
--   statements     no      the household's adults (<center>/<household>/…) giving.manage
--                          and finance roles (giving.view)
--   recordings     no      the child (<center>/<person>/…), their parents, the child or a parent
--                          their teachers (pathshala.teach / .manage or
--                          a class-scoped teacher of the child)
--   imports        no      people.manage, giving.manage, accounting.manage or settings.manage (read and write)
--   org-documents  no      the owner and platform admins                  the owner
--   exports        no      the person who asked (<center>/<user id>/…)     the same person (server-generated)
--
-- A bucket that belongs to a module (content, photos → content; store →
-- store; statements → giving; recordings → gyan_path) is refused while that
-- module is switched off, except for platform admins, as in 0103.
--
-- Retention (job kind storage.retention, run daily by the worker): imports 90
-- days, exports 7 days, recordings 90 days. Imports and recordings are the
-- organization's choice (✱ in the plan): centers.rules.storage.retention_days
-- .<bucket> overrides the default, 1–3650 days. Deletion goes through the
-- Storage API (so the file itself is removed, not just its row) and every
-- removed object gets an audit entry.
--
-- Malware scanning: every upload to a bucket people upload into queues a
-- storage.scan job. No scanner provider is chosen yet, so nothing claims these
-- jobs: they stay queued ("pending") and the portal says so. No scan result is
-- ever invented.

-- ── Buckets ──────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('branding',      'branding',      true,   5242880, array['image/png','image/jpeg','image/webp','image/gif']),
  ('content',       'content',       false, 52428800, array['image/png','image/jpeg','image/webp','image/gif','application/pdf',
                                                            'audio/mpeg','audio/mp4','audio/aac','audio/ogg','audio/wav','audio/webm',
                                                            'video/mp4','video/webm']),
  ('photos',        'photos',        false, 26214400, array['image/png','image/jpeg','image/webp','image/gif','image/heic','image/heif',
                                                            'video/mp4','video/quicktime']),
  ('store',         'store',         false,  5242880, array['image/png','image/jpeg','image/webp']),
  ('statements',    'statements',    false, 10485760, array['application/pdf']),
  ('recordings',    'recordings',    false, 26214400, array['audio/mp4','audio/x-m4a','audio/mpeg','audio/aac','audio/webm','audio/wav',
                                                            'audio/x-wav','audio/ogg','audio/3gpp','audio/x-caf']),
  ('imports',       'imports',       false, 52428800, array['text/csv','text/plain','text/tab-separated-values','application/json',
                                                            'application/vnd.ms-excel',
                                                            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  ('org-documents', 'org-documents', false, 20971520, array['application/pdf','image/png','image/jpeg']),
  ('exports',       'exports',       false, 52428800, array['text/csv','application/json','application/pdf','application/zip',
                                                            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ── Path helpers (contract) ──────────────────────────────────────────────────
create or replace function app.storage_segment(p_name text, p_n int) returns text
language sql immutable set search_path = app, public, extensions as $$
  select nullif(split_part(coalesce(p_name, ''), '/', p_n), '')
$$;

-- The second segment as a uuid (household, person, user), NULL when it is not one.
create or replace function app.storage_segment_uuid(p_name text, p_n int) returns uuid
language sql immutable set search_path = app, public, extensions as $$
  select case when app.storage_segment(p_name, p_n) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then app.storage_segment(p_name, p_n)::uuid end
$$;

create or replace function app.storage_center(name text) returns uuid
language sql immutable set search_path = app, public, extensions as $$
  select app.storage_segment_uuid(name, 1)
$$;

-- Which module a bucket belongs to (NULL: none, never switched off).
create or replace function app.storage_bucket_module(p_bucket text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case p_bucket when 'content' then 'content' when 'photos' then 'content' when 'store' then 'store'
                       when 'statements' then 'giving' when 'recordings' then 'gyan_path' end
$$;

create or replace function app.storage_module_on(p_bucket text, p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select app.storage_bucket_module(p_bucket) is null
      or app.module_enabled(p_center, app.storage_bucket_module(p_bucket))
      or app.is_platform_admin()
$$;

-- Is the caller one of this child's teachers (mirrors gyan_signoffs_teacher)?
create or replace function app.teaches_person(p_center uuid, p_person uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select app.has_permission(p_center, 'pathshala.teach') or app.has_permission(p_center, 'pathshala.manage')
      or exists (select 1 from app.pathshala_enrollments e
                  where e.center_id = p_center and e.student_person_id = p_person and e.class_id is not null
                    and app.has_scoped_role(e.center_id, e.class_id, 'teacher'))
$$;

create or replace function app.can_read_object(bucket text, name text) returns boolean
language plpgsql stable security definer set search_path = app, public, extensions as $$
-- $1/$2: the contract names the arguments bucket and name, which read badly next to columns.
declare b text := $1; n text := $2; c uuid := app.storage_center($2); s2 uuid := app.storage_segment_uuid($2, 2);
begin
  if b = 'branding' then return c is not null; end if;
  if c is null or not exists (select 1 from app.centers where id = c) then return false; end if;
  if not app.storage_module_on(b, c) then return false; end if;
  return case b
    when 'content'       then app.is_member_of(c)
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
  if not app.storage_module_on(b, c) then return false; end if;
  return case b
    when 'branding'      then app.has_permission(c, 'settings.manage')
    when 'content'       then app.has_permission(c, 'content.manage')
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

revoke execute on function app.storage_module_on(text, uuid), app.teaches_person(uuid, uuid),
  app.can_read_object(text, text), app.can_write_object(text, text) from public;
grant execute on function app.storage_segment(text, int), app.storage_segment_uuid(text, int), app.storage_center(text),
  app.storage_bucket_module(text), app.storage_module_on(text, uuid), app.teaches_person(uuid, uuid),
  app.can_read_object(text, text), app.can_write_object(text, text) to anon, authenticated, service_role;

-- ── Policies on storage.objects (only our nine buckets) ─────────────────────
drop policy if exists connect_objects_read on storage.objects;
create policy connect_objects_read on storage.objects for select to anon, authenticated
  using (bucket_id in ('branding','content','photos','store','statements','recordings','imports','org-documents','exports')
         and app.can_read_object(bucket_id, name));
drop policy if exists connect_objects_insert on storage.objects;
create policy connect_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('branding','content','photos','store','statements','recordings','imports','org-documents','exports')
              and app.can_write_object(bucket_id, name));
drop policy if exists connect_objects_update on storage.objects;
create policy connect_objects_update on storage.objects for update to authenticated
  using (bucket_id in ('branding','content','photos','store','statements','recordings','imports','org-documents','exports')
         and app.can_write_object(bucket_id, name))
  with check (bucket_id in ('branding','content','photos','store','statements','recordings','imports','org-documents','exports')
              and app.can_write_object(bucket_id, name));
drop policy if exists connect_objects_delete on storage.objects;
create policy connect_objects_delete on storage.objects for delete to authenticated
  using (bucket_id in ('branding','content','photos','store','statements','recordings','imports','org-documents','exports')
         and app.can_write_object(bucket_id, name));

-- ── Malware-scan hook ────────────────────────────────────────────────────────
create or replace function app.storage_scan_buckets() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array['branding','content','photos','store','recordings','imports','org-documents']
$$;

create or replace function app.storage_enqueue_scan() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if new.bucket_id = any (app.storage_scan_buckets())
     and not exists (select 1 from app.jobs where kind = 'storage.scan' and status in ('queued','running')
                       and payload->>'bucket' = new.bucket_id and payload->>'name' = new.name) then
    perform app.enqueue_job(app.storage_center(new.name), 'storage.scan',
      jsonb_build_object('bucket', new.bucket_id, 'name', new.name, 'object_id', new.id,
                         'size', new.metadata->'size', 'mimetype', new.metadata->>'mimetype'),
      now(), 5);
  end if;
  return new;
end $$;
revoke execute on function app.storage_enqueue_scan() from public, anon, authenticated;
drop trigger if exists connect_scan_on_upload on storage.objects;
create trigger connect_scan_on_upload after insert on storage.objects
  for each row execute function app.storage_enqueue_scan();
drop trigger if exists connect_scan_on_replace on storage.objects;
create trigger connect_scan_on_replace after update on storage.objects
  for each row when (old.version is distinct from new.version) execute function app.storage_enqueue_scan();

-- ── Retention ────────────────────────────────────────────────────────────────
-- Days an object in this bucket is kept; NULL = kept until removed.
create or replace function app.storage_retention_days(p_bucket text, p_center uuid) returns int
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_default int; v_override text;
begin
  v_default := case p_bucket when 'imports' then 90 when 'exports' then 7 when 'recordings' then 90 end;
  if v_default is null then return null; end if;
  if p_bucket in ('imports','recordings') and p_center is not null then
    select c.rules #>> array['storage','retention_days',p_bucket] into v_override from app.centers c where c.id = p_center;
    if v_override ~ '^[0-9]{1,4}$' and v_override::int between 1 and 3650 then return v_override::int; end if;
  end if;
  return v_default;
end $$;

-- connect_worker: the next objects past their retention.
create or replace function app.storage_expired_objects(p_limit int default 500)
returns table (bucket_id text, name text, center_id uuid, created_at timestamptz, retention_days int)
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  return query
  select o.bucket_id, o.name, app.storage_center(o.name), o.created_at,
         app.storage_retention_days(o.bucket_id, app.storage_center(o.name))
    from storage.objects o
   where o.bucket_id in ('imports','exports','recordings')
     and o.created_at < now() - make_interval(days => app.storage_retention_days(o.bucket_id, app.storage_center(o.name)))
   order by o.created_at
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
                          'Retention: ' || (o->>'bucket') || ' files are kept ' || coalesce(v_days::text, '?') || ' days (job ' || p_job || ')');
    if o->>'bucket' = 'recordings' then
      update app.gyan_progress set recording_path = null
       where recording_path in (o->>'name', 'recordings/' || (o->>'name'));
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function app.storage_retention_days(text, uuid), app.storage_expired_objects(int),
  app.record_storage_deletions(bigint, jsonb) from public, anon, authenticated, service_role;
grant execute on function app.storage_retention_days(text, uuid) to authenticated;
grant execute on function app.storage_expired_objects(int), app.record_storage_deletions(bigint, jsonb) to connect_worker;
