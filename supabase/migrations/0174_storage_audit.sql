-- Onboarding (stream o-vault): uploads, replacements and removals in the nine
-- Connect buckets are audited like any other change (who, when, which file,
-- size and type; never the contents).
--
-- The Storage API checks the caller's permission with the caller's role, then
-- writes the row with its own (service) role, so auth.uid() is empty here. The
-- uploader is the row's owner_id, which the Storage API sets from the caller's
-- token: an upload or replacement is recorded as that person, acting through
-- the Storage API (actor_role 'authenticated'). A removal records its owner in
-- `before`; who removed it is known only when the database sees the caller.
--
-- Reads (downloads, signed links) happen in the Storage API, not in a table
-- write, so they cannot be audited from the database; that part of plan §1.9
-- ("access logging for the sensitive areas") is still open.

create or replace function app.storage_audit() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare r record; v_action text; c record; v_owner uuid; v_actor uuid; v_role text;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if r.bucket_id is null or r.bucket_id <> all (array['branding','content','photos','store','statements','recordings',
                                                       'imports','org-documents','exports']) then
    return r;
  end if;
  if tg_op = 'UPDATE' and old.version is not distinct from new.version and old.name is not distinct from new.name then
    return r;   -- metadata-only touches (last_accessed_at and the like) are not changes to the file
  end if;
  v_action := 'storage.' || case tg_op when 'INSERT' then 'upload' when 'UPDATE' then 'replace' else 'remove' end;
  v_owner := case when coalesce(r.owner_id, r.owner::text) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  then coalesce(r.owner_id, r.owner::text)::uuid end;
  v_actor := coalesce(auth.uid(), case when tg_op <> 'DELETE' then v_owner end);
  v_role := case when auth.uid() is null and v_actor is not null then 'authenticated' else auth.jwt()->>'role' end;
  select * into c from app.audit_context();
  insert into app.audit_log (center_id, actor_user_id, actor_role, action, record_table, record_id, before, after,
                             reason, correlation_id, ip, user_agent, module, client_app, client_screen)
  values (app.storage_center(r.name), v_actor, v_role, v_action, 'storage.objects', r.bucket_id || '/' || r.name,
          case when tg_op <> 'INSERT' then jsonb_build_object('bucket', old.bucket_id, 'name', old.name, 'owner', old.owner_id,
                                                              'size', old.metadata->'size', 'mimetype', old.metadata->>'mimetype') end,
          case when tg_op <> 'DELETE' then jsonb_build_object('bucket', new.bucket_id, 'name', new.name, 'owner', new.owner_id,
                                                              'size', new.metadata->'size', 'mimetype', new.metadata->>'mimetype') end,
          c.reason, c.correlation_id, c.ip, c.user_agent, app.storage_bucket_module(r.bucket_id), c.client_app, c.client_screen);
  return r;
end $$;
revoke execute on function app.storage_audit() from public, anon, authenticated;

drop trigger if exists connect_audit_objects on storage.objects;
create trigger connect_audit_objects after insert or update or delete on storage.objects
  for each row execute function app.storage_audit();
