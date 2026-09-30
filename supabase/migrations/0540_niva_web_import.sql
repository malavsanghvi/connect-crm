-- 0540_niva_web_import.sql (backlog B14: the website-content ingestion Niva was deferred on)
--
-- Staff give Niva web pages to learn from (Content › Niva › Import from a web page).
-- Nothing here reads a page: the background service does (worker/src/handlers/niva.import_page.ts),
-- from public addresses only. What comes back is saved as DRAFT niva_source items, so the
-- existing approval queue is still what decides what Niva may say. This migration adds:
--   app.niva_import_pages(center, urls[])   staff: queue one job per address (content.draft)
--   app.niva_worker_save_import(...)        worker: write a page's sections as draft sources
--   app.niva_import_status(center, limit)   staff: recent import jobs, so failures are visible
-- A re-import refreshes the DRAFT sections of a page but never touches a section that has
-- been sent for approval, approved or published: those stay exactly as approved.

set client_min_messages = warning;

-- ── Staff: queue pages ───────────────────────────────────────────────────────
-- Up to 50 addresses per call. One job each, staggered a few seconds apart so a whole
-- site is fetched politely rather than all at once.
create or replace function app.niva_import_pages(p_center uuid, p_urls text[])
returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_raw text; v_url text; v_seen text[] := '{}'; v_n int := 0;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not (app.has_permission(p_center, 'content.draft') or app.has_permission(p_center, 'content.manage')) then
    raise exception 'Importing web pages into Niva needs content.draft.' using errcode = 'insufficient_privilege';
  end if;
  if p_urls is null or cardinality(p_urls) = 0 then raise exception 'Paste at least one web page address.'; end if;

  foreach v_raw in array p_urls loop
    v_url := nullif(btrim(coalesce(v_raw, '')), '');
    if v_url is null then continue; end if;
    v_url := regexp_replace(v_url, '#.*$', '');                       -- a #section is not a different page
    if char_length(v_url) > 2000 or v_url !~* '^https?://[^/[:space:]]+(/[^[:space:]]*)?$' then
      raise exception '"%" is not a web page address. It must start with http:// or https:// and have no spaces.', left(btrim(v_raw), 120);
    end if;
    if v_url = any (v_seen) then continue; end if;
    v_seen := v_seen || v_url;
  end loop;

  if cardinality(v_seen) = 0 then raise exception 'Paste at least one web page address.'; end if;
  if cardinality(v_seen) > 50 then
    raise exception 'That is % addresses; import at most 50 at a time.', cardinality(v_seen);
  end if;

  foreach v_url in array v_seen loop
    perform app.enqueue_job(p_center, 'niva.import_page', jsonb_build_object('url', v_url), now() + (v_n * interval '4 seconds'), 3);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ── Worker: save a page's sections as draft sources ──────────────────────────
-- p_sections: [{"title": "...", "body": "..."}, ...] in page order. Section n of a page
-- always has the same slug, so importing the same page again updates the same items.
create or replace function app.niva_worker_save_import(p_center uuid, p_url text, p_page_title text, p_sections jsonb, p_created_by uuid)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_i int := 0; v_sec jsonb; v_slug text; v_title text; v_body text; v_meta jsonb;
  v_status text; v_created int := 0; v_updated int := 0; v_kept int := 0;
begin
  perform app.assert_worker();
  if p_center is null or nullif(btrim(coalesce(p_url, '')), '') is null then
    raise exception 'niva_worker_save_import needs the center and the page address.';
  end if;
  if jsonb_typeof(p_sections) is distinct from 'array' or jsonb_array_length(p_sections) = 0 then
    raise exception 'niva_worker_save_import needs at least one section.';
  end if;
  if jsonb_array_length(p_sections) > 40 then
    raise exception 'A page is saved as at most 40 sections (got %).', jsonb_array_length(p_sections);
  end if;

  for v_sec in select value from jsonb_array_elements(p_sections) loop
    v_i := v_i + 1;
    v_title := left(nullif(btrim(coalesce(v_sec->>'title', '')), ''), 200);
    v_body := nullif(btrim(coalesce(v_sec->>'body', '')), '');
    if v_title is null or v_body is null then
      raise exception 'Section % has no title or no text.', v_i;
    end if;
    if char_length(v_body) > 6000 then raise exception 'Section % is longer than 6000 characters.', v_i; end if;

    v_slug := 'web-' || left(md5(p_url), 10) || '-' || lpad(v_i::text, 2, '0');
    v_meta := jsonb_build_object('imported', true, 'source_url', p_url, 'page_title', left(coalesce(p_page_title, ''), 200),
                                 'section', v_i, 'imported_at', now());

    select status into v_status from app.content_items
      where center_id = p_center and kind = 'niva_source' and slug = v_slug and version = 1;
    if not found then
      insert into app.content_items (center_id, kind, slug, title, body_md, language, metadata, status, created_by)
      values (p_center, 'niva_source', v_slug, v_title, v_body, 'en', v_meta, 'draft', p_created_by);
      v_created := v_created + 1;
    elsif v_status = 'draft' then
      update app.content_items set title = v_title, body_md = v_body, metadata = v_meta
        where center_id = p_center and kind = 'niva_source' and slug = v_slug and version = 1;
      v_updated := v_updated + 1;
    else
      v_kept := v_kept + 1;        -- in review, approved, published or retired: left exactly as it is
    end if;
  end loop;

  return jsonb_build_object('sections', v_i, 'created', v_created, 'updated', v_updated, 'kept_as_approved', v_kept);
end $$;

-- ── Staff: recent imports (so a failure is visible, in plain English) ────────
create or replace function app.niva_import_status(p_center uuid, p_limit int default 20)
returns table (job_id bigint, url text, status text, attempts int, last_error text, result jsonb, created_at timestamptz, finished_at timestamptz)
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not (app.has_permission(p_center, 'content.draft') or app.has_permission(p_center, 'content.manage')) then
    raise exception 'Seeing Niva imports needs content.draft.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select j.id, j.payload->>'url', j.status, j.attempts, j.last_error, j.result, j.created_at, j.finished_at
    from app.jobs j
    where j.center_id = p_center and j.kind = 'niva.import_page'
    order by j.id desc
    limit least(greatest(coalesce(p_limit, 20), 1), 100);
end $$;

-- ── Grants ───────────────────────────────────────────────────────────────────
revoke execute on function app.niva_import_pages(uuid, text[]), app.niva_worker_save_import(uuid, text, text, jsonb, uuid),
  app.niva_import_status(uuid, int)
  from public, anon, authenticated, service_role;
grant execute on function app.niva_import_pages(uuid, text[]), app.niva_import_status(uuid, int) to authenticated;
grant execute on function app.niva_worker_save_import(uuid, text, text, jsonb, uuid) to connect_worker;
