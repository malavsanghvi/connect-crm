-- Onboarding · stream o-setup · 5 of 5: the two storage areas this stream needs,
-- created defensively (stream o-vault owns storage; ONBOARDING_PLAN §1.9).
--
--   branding       public read (logos, leader photos); written by settings.manage,
--                  the owner or a platform admin of the center in the path.
--   org-documents  private (W-9, determination letter, …); read and written by
--                  settings.manage, the owner or a platform admin.
-- Object paths always start with <center_id>/.
--
-- If o-vault's storage helpers (app.can_read_object / app.can_write_object) are
-- present, its policies govern these buckets and none are added here. Without a
-- storage schema (plain Postgres in CI) this does nothing. app.ensure_setup_storage()
-- can be re-run safely (e.g. when the storage service created its schema after
-- the migrations ran).

create or replace function app.setup_path_center(p_name text) returns uuid
language plpgsql immutable set search_path = app, public, extensions as $$
declare v text := split_part(coalesce(p_name, ''), '/', 1);
begin
  if v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return v::uuid; end if;
  return null;
end $$;
grant execute on function app.setup_path_center(text) to anon, authenticated, service_role;

create or replace function app.ensure_setup_storage() returns text
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_vault boolean := to_regprocedure('app.can_write_object(text,text)') is not null;
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    return 'no storage schema: nothing to do';
  end if;
  execute $b$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('branding', 'branding', true, 5242880, array['image/png','image/jpeg','image/svg+xml','image/webp']),
           ('org-documents', 'org-documents', false, 10485760, array['application/pdf','image/png','image/jpeg'])
    on conflict (id) do nothing$b$;
  if v_vault then return 'buckets ensured; o-vault policies govern them'; end if;

  execute 'drop policy if exists setup_branding_read on storage.objects';
  execute $p$create policy setup_branding_read on storage.objects for select to anon, authenticated
    using (bucket_id = 'branding')$p$;
  execute 'drop policy if exists setup_branding_write on storage.objects';
  execute $p$create policy setup_branding_write on storage.objects for insert to authenticated
    with check (bucket_id = 'branding' and app.setup_can_manage(app.setup_path_center(name)))$p$;
  execute 'drop policy if exists setup_branding_update on storage.objects';
  execute $p$create policy setup_branding_update on storage.objects for update to authenticated
    using (bucket_id = 'branding' and app.setup_can_manage(app.setup_path_center(name)))
    with check (bucket_id = 'branding' and app.setup_can_manage(app.setup_path_center(name)))$p$;

  execute 'drop policy if exists setup_org_documents_read on storage.objects';
  execute $p$create policy setup_org_documents_read on storage.objects for select to authenticated
    using (bucket_id = 'org-documents' and app.setup_can_manage(app.setup_path_center(name)))$p$;
  execute 'drop policy if exists setup_org_documents_write on storage.objects';
  execute $p$create policy setup_org_documents_write on storage.objects for insert to authenticated
    with check (bucket_id = 'org-documents' and app.setup_can_manage(app.setup_path_center(name)))$p$;
  -- No update or delete on org-documents: evidence is kept (a new upload supersedes).
  return 'buckets and policies ensured';
end $$;
revoke execute on function app.ensure_setup_storage() from public, anon, authenticated;
grant execute on function app.ensure_setup_storage() to service_role;

select app.ensure_setup_storage();
