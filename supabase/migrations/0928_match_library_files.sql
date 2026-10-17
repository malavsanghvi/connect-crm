-- 0928 · CatchTheMatch Phase 1, piece 4: an optional file or screenshot for each library entry (docs/CATCH_THE_MATCH.md sections 12 and 13; owner
-- request of 2026-10-17). NEEDS OWNER OK: storage and RLS (a new bucket and the four storage.objects policies are redefined).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   The how-to-claim library (0887) was text and links only (decision C12). Weaver's team can now attach, to an employer's entry, up to six files that
--   show the way: the employer's form, a screenshot of the portal's screen. They are PUBLIC FACTS like the rest of the library: a form or a screen,
--   never a person, a community, a gift or an amount. Readers: Weaver's team and the organization's own CatchTheMatch readers (app.match_directory_can_read),
--   exactly as the library itself. Writers: Weaver's team only, with a reason, in the shared audit.
--     bucket match-library       private; 10 MB; JPEG, PNG, WebP or PDF (a phone photo of a form is a JPEG; HEIC is not accepted here)
--     app.match_process_files    one row per file: the entry, a kind (form, screenshot, other), a caption, the stored name, its type, size and
--                                fingerprint, who added it. A removed file keeps its row (who removed it, when, why) and loses its stored copy.
--     app.add_match_process_file(program, path, type, bytes, sha256, kind, caption, reason)   registers a file already uploaded (Weaver's team)
--     app.remove_match_process_file(file, reason)                                              takes it back; the caller deletes the stored copy
--     app.match_process_get                                                                    now also lists the entry's live files
--   STORAGE. The path is <entry id>/<file id>.<ext>: no community (this is shared), so the usual rule "the first part is the community" does not
--   apply and the bucket has its own branch in app.can_read_object / app.can_write_object:
--     read   Weaver's team (every object, so it can also delete a removed file's stored copy) and CatchTheMatch readers (only an object a live row
--            names: an upload never registered, or a removed file, reads as nothing to a community)
--     write  Weaver's team only, only under an existing entry's own folder, one file deep, a lowercase uuid and a short lowercase extension
--   The four storage.objects policies are redefined with the twelfth bucket (0865's list plus match-library). NOT in app.connect_storage_buckets (the
--   object-level audit writes a community's id, and this bucket has none: the table's shared audit says who added and removed what), NOT in
--   app.storage_scan_buckets (Weaver's team's own uploads; like payment-evidence it joins the scan the day a scanner is installed), and no retention
--   (nothing here is purged by age: a removed file is deleted when it is removed).
set client_min_messages = warning;

-- ── The bucket ───────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('match-library', 'match-library', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ── The files ────────────────────────────────────────────────────────────────
create table if not exists app.match_process_files (
  id             uuid primary key default gen_random_uuid(),
  program_id     uuid not null references app.match_programs(id) on delete cascade,
  kind           text not null check (kind in ('form', 'screenshot', 'other')),
  caption        text not null check (char_length(caption) between 1 and 200),
  storage_path   text not null unique check (storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$'),
  content_type   text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  bytes          bigint not null check (bytes > 0 and bytes <= 10485760),
  sha256         text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  added_by       uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  removed_at     timestamptz,
  removed_by     uuid references auth.users(id),
  removed_reason text check (removed_reason is null or char_length(removed_reason) <= 300),
  constraint match_process_files_removed check ((removed_at is null) = (removed_reason is null))
);
create index if not exists match_process_files_program_idx on app.match_process_files (program_id) where removed_at is null;
comment on table app.match_process_files is
  'A file or screenshot that shows how to claim from an employer program (0928): public facts, written by Weaver''s team only, read by Weaver''s team and CatchTheMatch readers like the library itself. The stored copy is in the private bucket match-library at <entry id>/<file id>.<ext>. A removed file keeps its row.';

drop trigger if exists audit_match_process_files on app.match_process_files;
create trigger audit_match_process_files after insert or update or delete on app.match_process_files
  for each row execute function app.audit_shared_row();
insert into app.module_tables (table_name, module_key) values ('match_process_files', null)
  on conflict (table_name) do update set module_key = excluded.module_key;

alter table app.match_process_files enable row level security;
drop policy if exists match_process_files_read on app.match_process_files;
create policy match_process_files_read on app.match_process_files for select to authenticated
  using ((select app.match_directory_can_read()));
revoke all on app.match_process_files from public, anon, authenticated;
grant select on app.match_process_files to authenticated;
grant all on app.match_process_files to service_role;

-- ── Registering and removing (Weaver's team) ─────────────────────────────────
create or replace function app.add_match_process_file(p_program uuid, p_path text, p_content_type text, p_bytes bigint, p_sha256 text,
                                                      p_kind text, p_caption text, p_reason text) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare g app.match_programs; v_reason text; v_caption text; v_id uuid; v_ext text; v_want text;
begin
  perform app._assert_weaver('add a file to the how-to-claim library');
  v_reason := app.audit_clean_reason(p_reason);
  if v_reason is null then raise exception 'Say why you are adding it. It goes in the library''s history.' using errcode = '22023'; end if;
  select * into g from app.match_programs where id = p_program;
  if g.id is null then raise exception 'That directory entry was not found.' using errcode = '22023'; end if;
  if g.status = 'merged' then raise exception 'This entry was merged into another one. Add the file there.' using errcode = '22023'; end if;
  if p_kind is null or p_kind not in ('form', 'screenshot', 'other') then
    raise exception 'Say what the file is: a form, a screenshot or something else.' using errcode = '22023';
  end if;
  v_caption := nullif(btrim(regexp_replace(coalesce(p_caption, ''), '\s+', ' ', 'g')), '');
  if v_caption is null then raise exception 'Give the file a short caption: what it shows.' using errcode = '22023'; end if;
  if char_length(v_caption) > 200 then raise exception 'The caption is too long (200 characters at most).' using errcode = '22023'; end if;
  if p_content_type is null or p_content_type not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then
    raise exception 'Attach a JPEG, PNG or WebP picture or a PDF.' using errcode = '22023';
  end if;
  if p_bytes is null or p_bytes <= 0 or p_bytes > 10485760 then raise exception 'A file can be at most 10 MB.' using errcode = '22023'; end if;
  if p_sha256 is not null and p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'The file''s fingerprint is not valid.' using errcode = '22023'; end if;
  v_ext := lower(substring(coalesce(p_path, '') from '\.([a-z]+)$'));
  v_want := case p_content_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' else 'pdf' end;
  if p_path is null or split_part(p_path, '/', 1) <> p_program::text or p_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$'
     or v_ext is distinct from v_want then
    raise exception 'The file was not uploaded to this entry''s folder. Upload it again.' using errcode = '22023';
  end if;
  if (select count(*) from app.match_process_files f where f.program_id = p_program and f.removed_at is null) >= 6 then
    raise exception 'An entry can have up to 6 files. Remove one first.' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'match-library' and o.name = p_path) then
    raise exception 'The file is not in storage yet. Upload it again.' using errcode = '22023';
  end if;
  perform app.set_audit_context('Weaver''s team: ' || v_reason);
  insert into app.match_process_files (program_id, kind, caption, storage_path, content_type, bytes, sha256, added_by)
  values (p_program, p_kind, v_caption, p_path, p_content_type, p_bytes, lower(p_sha256), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function app.remove_match_process_file(p_file uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare f app.match_process_files; v_reason text;
begin
  perform app._assert_weaver('remove a file from the how-to-claim library');
  v_reason := app.audit_clean_reason(p_reason);
  if v_reason is null then raise exception 'Say why you are removing it. It goes in the library''s history.' using errcode = '22023'; end if;
  select * into f from app.match_process_files where id = p_file for update;
  if f.id is null then raise exception 'That file was not found.' using errcode = '22023'; end if;
  if f.removed_at is not null then raise exception 'That file was already removed.' using errcode = '22023'; end if;
  perform app.set_audit_context('Weaver''s team: ' || v_reason);
  update app.match_process_files set removed_at = now(), removed_by = auth.uid(), removed_reason = left(v_reason, 300) where id = f.id;
  return jsonb_build_object('id', f.id, 'storage_path', f.storage_path);
end $$;

-- ── The entry's answer lists its live files (0887's body plus one key) ───────
create or replace function app.match_process_get(p_program uuid, p_center uuid default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare g app.match_programs; m app.match_processes; v_here jsonb := null; v_files jsonb;
begin
  if not app.match_directory_can_read() then
    raise exception 'You don''t have access to this area.' using errcode = 'insufficient_privilege';
  end if;
  select * into g from app._match_program_current(p_program);
  if g.id is null then raise exception 'That directory entry was not found.' using errcode = '22023'; end if;
  select x.* into m from app.match_processes x
   where x.program_id in (select y.id from app.match_programs y where y.id = g.id or y.merged_into = g.id)
   order by (x.program_id = g.id) desc, x.updated_at desc limit 1;
  if p_center is not null and app._matching_org_can(p_center) then
    select jsonb_build_object('received', count(*), 'last_on', max(c.received_on)) into v_here
      from app.match_claims c
     where c.center_id = p_center and c.state = 'received'
       and c.program_id in (select y.id from app.match_programs y where y.id = g.id or y.merged_into = g.id);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'caption', f.caption, 'content_type', f.content_type,
                                               'bytes', f.bytes, 'path', f.storage_path, 'added_at', f.created_at)
                            order by f.created_at, f.id), '[]'::jsonb)
    into v_files
    from app.match_process_files f
   where f.removed_at is null and f.program_id in (select y.id from app.match_programs y where y.id = g.id or y.merged_into = g.id);
  return jsonb_build_object(
    'program', jsonb_build_object('id', g.id, 'company_name', g.company_name, 'country', g.country, 'portal', g.portal,
                                  'portal_url', g.portal_url, 'status', g.status),
    'process', case when m.program_id is null then null else app._match_process_json(m) end,
    'files', v_files,
    'worked_communities', app._match_worked_communities(g.id),
    'here', v_here);
end $$;

-- ── Who may read and write the bucket ────────────────────────────────────────
-- Weaver's team reads every object of the bucket (it writes them, and storage can delete only what the caller can also see, so a removed file's
-- stored copy is deleted by the same hands). A community's CatchTheMatch reader reads an object only while a live row names it.
create or replace function app.match_library_object_readable(p_name text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select auth.uid() is not null
     and (app.is_platform_admin()
          or (app.match_directory_can_read()
              and exists (select 1 from app.match_process_files f where f.storage_path = p_name and f.removed_at is null)))
$$;
revoke execute on function app.match_library_object_readable(text) from public, anon, authenticated;

-- Weaver's team writes only under an existing entry's folder, one file deep, a lowercase uuid and a short lowercase extension.
create or replace function app.match_library_object_writable(p_name text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select auth.uid() is not null and app.is_platform_admin()
     and p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$'
     and exists (select 1 from app.match_programs g where g.id = app.storage_segment_uuid(p_name, 1))
$$;
revoke execute on function app.match_library_object_writable(text) from public, anon, authenticated;

-- 0867's bodies; the only change is the first lines: the library's bucket has no community in its path, so it is decided before the community is read.
create or replace function app.can_read_object(bucket text, name text) returns boolean
language plpgsql stable security definer set search_path = app, public, extensions as $$
-- $1/$2: the contract names the arguments bucket and name, which read badly next to columns.
declare b text := $1; n text := $2; c uuid := app.storage_center($2); s2 uuid := app.storage_segment_uuid($2, 2); v_ok boolean;
begin
  if b = 'branding' then return c is not null; end if;
  if b = 'match-library' then return app.match_library_object_readable(n); end if;
  if c is null or not exists (select 1 from app.centers where id = c) then return false; end if;
  if not (case when b = 'content' and app.storage_segment(n, 2) in ('events', 'flyer-art')
               then app.module_enabled(c, 'events') or app.is_platform_admin()
               else app.storage_module_on(b, c) end) then return false; end if;
  v_ok := case b
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
    when 'homework'      then s2 is not null and auth.uid() is not null and app.storage_segment_uuid(n, 3) is not null
                              and exists (select 1 from app.gyan_submissions s
                                           where s.id = app.storage_segment_uuid(n, 3) and s.center_id = c and s.person_id = s2)
                              and app.gyan_submission_readable(app.storage_segment_uuid(n, 3))
                              and (app.gyan_can_act_for(c, s2)
                                   or exists (select 1 from app.gyan_submission_files f
                                               where f.submission_id = app.storage_segment_uuid(n, 3) and f.storage_path = n and f.deleted_at is null))
    when 'payment-evidence' then app.has_permission(c, 'giving.view') or app.has_permission(c, 'giving.record_offline')
                              or app.has_permission(c, 'giving.manage') or (s2 is not null and app.adult_of_household(c, s2))
    when 'imports'       then app.has_permission(c, 'people.manage') or app.has_permission(c, 'giving.manage')
                              or app.has_permission(c, 'accounting.manage') or app.has_permission(c, 'settings.manage')
    when 'org-documents' then app.is_center_owner(c) or app.is_platform_admin()
    when 'exports'       then auth.uid() is not null and s2 = auth.uid()
    else false
  end;
  if v_ok is not true then return false; end if;
  -- 0589: the virus check. Off and monitor deny nothing (this is the one lookup they cost).
  if app.upload_scan_mode() <> 'enforce' or not (b = any (app.storage_scan_buckets())) then return true; end if;
  if app.upload_scan_state(b, n) = 'infected' then return false; end if;
  if app.upload_scan_held(b, n) then
    return case b when 'homework'   then app.gyan_can_act_for(c, s2)
                  when 'recordings' then app.can_act_for_person(c, s2)
                  else false end;
  end if;
  return true;
end $$;

create or replace function app.can_write_object(bucket text, name text) returns boolean
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare b text := $1; n text := $2; c uuid := app.storage_center($2); s2 uuid := app.storage_segment_uuid($2, 2);
begin
  if b = 'match-library' then return app.match_library_object_writable(n); end if;
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
    when 'homework'      then s2 is not null and app.gyan_homework_path_ok(n)
                              and app.gyan_submission_writable(c, s2, app.storage_segment_uuid(n, 3))
    when 'payment-evidence' then (s2 is not null and app.adult_of_household(c, s2) and app.storage_segment_uuid(n, 3) is not null)
                              or (app.storage_segment(n, 2) = 'staff' and (app.has_permission(c, 'giving.record_offline') or app.has_permission(c, 'giving.manage')))
    when 'imports'       then app.has_permission(c, 'people.manage') or app.has_permission(c, 'giving.manage')
                              or app.has_permission(c, 'accounting.manage') or app.has_permission(c, 'settings.manage')
    when 'org-documents' then app.is_center_owner(c)
    when 'exports'       then s2 = auth.uid() and app.is_member_of(c)
    else false
  end;
end $$;

-- The four storage.objects policies, with the twelfth bucket (0865's list plus match-library).
do $$
declare v_list text := $l$array['branding','content','photos','store','statements','recordings','imports','org-documents','exports','homework','payment-evidence','match-library']$l$;
begin
  execute 'drop policy if exists connect_objects_read on storage.objects';
  execute 'drop policy if exists connect_objects_insert on storage.objects';
  execute 'drop policy if exists connect_objects_update on storage.objects';
  execute 'drop policy if exists connect_objects_delete on storage.objects';
  execute format('create policy connect_objects_read on storage.objects for select to anon, authenticated using (bucket_id = any (%s) and app.can_read_object(bucket_id, name))', v_list);
  execute format('create policy connect_objects_insert on storage.objects for insert to authenticated with check (bucket_id = any (%s) and app.can_write_object(bucket_id, name))', v_list);
  execute format('create policy connect_objects_update on storage.objects for update to authenticated using (bucket_id = any (%s) and app.can_write_object(bucket_id, name)) with check (bucket_id = any (%s) and app.can_write_object(bucket_id, name))', v_list, v_list);
  execute format('create policy connect_objects_delete on storage.objects for delete to authenticated using (bucket_id = any (%s) and app.can_write_object(bucket_id, name))', v_list);
end $$;

revoke execute on function app.add_match_process_file(uuid, text, text, bigint, text, text, text, text), app.remove_match_process_file(uuid, text) from public, anon;
grant execute on function app.add_match_process_file(uuid, text, text, bigint, text, text, text, text), app.remove_match_process_file(uuid, text) to authenticated, service_role;
