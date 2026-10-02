-- 0576_niva_import_v2.sql (backlog B20, gap G18): web import, second version.
--
-- What went wrong with 0540's import (app.niva_import_pages, app.niva_worker_save_import):
--   * Staff could only paste addresses one by one; nothing read a site's sitemap.
--   * The address saved was the one typed, not the one the page lives at. jainsocietyhouston.org answers with a
--     301 to www.jainsocietyhouston.org, so importing both forms (or "/faq" and "/faq/") made two sets of sources
--     for one page, which crowd each other in Niva's top results once approved.
--   * A section's slug was its position on the page, so a heading added near the top moved every later section's
--     text into its neighbour's row.
--   * A section that had been sent for approval, approved or published was skipped on a re-import without looking
--     at it: nobody learned that the page now says something else. Sections a shorter page no longer has stayed
--     behind for ever.
--
-- This migration:
--   1. app.niva_page_address(url): one way to write a page's address. Lower-case scheme and host, no default port,
--      no #fragment, no trailing slash, no utm_* (or gclid / fbclid) tracking parameters. The path keeps its case.
--      app.niva_page_key(url) is the same without the scheme and a leading "www.", so the apex and www forms (and
--      http and https) are one page. Both are immutable helpers; the worker mirrors them (worker/src/web/sitemap.ts).
--   2. app.niva_import_pages (same signature): addresses are normalised before the duplicates are removed, so
--      "https://Example.org/faq/" and "https://www.example.org/faq?utm_source=x" are one job. A new batch queues
--      after the pages still waiting, 4 seconds apart, so two batches never read a site side by side. A page that is
--      in the site's page list (below) remembers its import job.
--   3. app.niva_worker_save_import(center, url, page_title, sections, created_by, requested_url): the worker now
--      passes the FINAL address (after redirects) and the one that was asked for. The old 5-argument form stays and
--      calls this one. Per page (every earlier form of its address counts, through niva_page_key):
--        - A section is found again by its key, md5(page key | heading), not its position; sections saved before
--          this migration (no key yet) are found by their title. Their slugs never change. A new section's slug
--          comes from its key.
--        - A draft takes the new text (as before).
--        - A section in review, approved or published keeps its text. Each section's text is hashed when imported
--          (metadata.body_hash); when the page's text no longer matches, the section gets metadata.page_changed =
--          true, page_text_now / page_title_now (what the page says now) and page_changed_at, for a person to
--          decide. If the page goes back to the approved text, the flag is cleared. A section saved before this
--          migration has no hash; its current text stands in for it once.
--        - A retired section is left alone (a person took it out of Niva).
--        - A section the page no longer has: a draft is deleted (nobody approved it and the page no longer says
--          it); a section in review, approved or published is flagged metadata.orphaned = true (orphaned_at), never
--          deleted. If the section comes back, the flag is cleared.
--        - Published and approved rows are written only when one of these flags changes, so a re-import that finds
--          nothing new does not make go-live check 12 (0572: published sources' updated_at) look stale. A section
--          waiting in review whose text matches takes the final address and its key (nothing of it is live yet), so
--          the approval queue shows a page's sections together under one address.
--      It returns {url, sections, created, updated, unchanged, kept_as_approved, changed, orphaned, removed,
--      retired}: kept_as_approved counts sections in review, approved or published that were left as they are
--      (0540's meaning); changed is how many of them now differ from the page.
--   4. app.niva_site_pages: the pages a site's sitemap lists, per community (center_id, site, url, url_key,
--      lastmod, discovered_at, last_import_job, last_hash). Owner decision 2026-10-01: content staff (content.draft
--      or content.manage) read it; nobody writes it directly (RLS select only; the functions below write). It belongs
--      to the Niva module (module_tables, module_switch), like niva_conversations.
--   5. app.niva_discover_site(center, url) (content.draft, Niva module on): queues niva.discover_site, which reads
--      the site's robots.txt and sitemap (worker/src/handlers/niva.discover_site.ts). One search at a time per
--      community.
--      app.niva_worker_save_discovery(center, root, pages) (worker): saves the list; pages the site no longer lists
--      leave it (the list is a copy of the sitemap; imported sources are not touched).
--      app.niva_discovery_status(center) (content.draft, Niva module on): the latest search and the list, each page with how many
--      sections it has in Niva, how many are published, how many differ from the page now, and its last import.
--
-- 0540 is applied and untouched; its functions are replaced with create or replace (same signatures).

set client_min_messages = warning;

-- ── 1. One way to write a page's address ─────────────────────────────────────
create or replace function app.niva_page_address(p_url text) returns text
language plpgsql immutable set search_path = app, public, extensions as $$
declare
  v text := btrim(coalesce(p_url, ''));
  m text[];
  v_scheme text;
  v_host text;
  v_path text;
  v_p text;
  v_kept text[] := '{}';
begin
  if v = '' then return null; end if;
  v := regexp_replace(v, '#.*$', '');                                   -- a #section is not a different page
  m := regexp_match(v, '^([A-Za-z][A-Za-z0-9+.-]*)://([^/?]*)([^?]*)(?:\?(.*))?$');
  if m is null then return v; end if;                                   -- not an address; the caller says so
  v_scheme := lower(m[1]);
  v_host := lower(m[2]);
  if v_scheme = 'https' then v_host := regexp_replace(v_host, ':443$', '');
  elsif v_scheme = 'http' then v_host := regexp_replace(v_host, ':80$', '');
  end if;
  v_host := regexp_replace(v_host, '\.$', '');                          -- "example.org." is example.org
  v_path := regexp_replace(coalesce(m[3], ''), '/+$', '');              -- "/faq/" is "/faq"; "/" is the site itself
  if coalesce(m[4], '') <> '' then
    foreach v_p in array string_to_array(m[4], '&') loop
      if v_p = '' or lower(split_part(v_p, '=', 1)) ~ '^(utm_.*|gclid|fbclid)$' then continue; end if;
      v_kept := v_kept || v_p;
    end loop;
  end if;
  return v_scheme || '://' || v_host || v_path
         || case when cardinality(v_kept) > 0 then '?' || array_to_string(v_kept, '&') else '' end;
end $$;
comment on function app.niva_page_address(text) is
  'A web page''s address written one way (0576): lower-case scheme and host, no default port, #fragment, trailing slash or utm_*/gclid/fbclid parameters. The path keeps its case.';

create or replace function app.niva_page_key(p_url text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select regexp_replace(regexp_replace(app.niva_page_address(p_url), '^[a-z][a-z0-9+.-]*://', ''), '^www\.', '')
$$;
comment on function app.niva_page_key(text) is
  'Which page an address is (0576): app.niva_page_address without the scheme and a leading "www.", so the apex and www forms (and http and https) of a page are one.';

-- ── 4. The pages a site's sitemap lists ──────────────────────────────────────
create table if not exists app.niva_site_pages (
  id              uuid primary key default gen_random_uuid(),
  center_id       uuid not null references app.centers(id) on delete cascade,
  site            text not null,
  url             text not null,
  url_key         text not null,
  lastmod         timestamptz,
  discovered_at   timestamptz not null default now(),
  last_import_job bigint references app.jobs(id) on delete set null,
  last_hash       text,
  unique (center_id, url_key)
);
create index if not exists niva_site_pages_site_idx on app.niva_site_pages (center_id, site);
comment on table app.niva_site_pages is
  'The pages a community''s website lists in its sitemap (0576), found by niva.discover_site, so content staff can pick which ones Niva reads. Written only by app.niva_worker_save_discovery (the list), app.niva_import_pages (last_import_job) and app.niva_worker_save_import (last_hash); read by content.draft / content.manage.';
comment on column app.niva_site_pages.site is 'The site''s host without "www." (app.niva_page_key of its address, host part).';
comment on column app.niva_site_pages.url is 'The page''s address as the sitemap gives it, normalised (app.niva_page_address).';
comment on column app.niva_site_pages.url_key is 'app.niva_page_key(url): the apex and www forms of an address are one page.';
comment on column app.niva_site_pages.lastmod is 'When the sitemap says the page last changed (its <lastmod>), when it says.';
comment on column app.niva_site_pages.discovered_at is 'When a search first found the page in the sitemap (a later search that finds it again leaves the row as it is).';
comment on column app.niva_site_pages.last_import_job is 'The niva.import_page job last queued for this page.';
comment on column app.niva_site_pages.last_hash is 'md5 over the page''s section texts at its last import (a later re-import compares).';

insert into app.module_tables (table_name, module_key) values ('niva_site_pages', 'niva')
  on conflict (table_name) do update set module_key = excluded.module_key;
drop trigger if exists audit_niva_site_pages on app.niva_site_pages;
create trigger audit_niva_site_pages after insert or update or delete on app.niva_site_pages
  for each row execute function app.audit_row();

alter table app.niva_site_pages enable row level security;
drop policy if exists niva_site_pages_content_staff on app.niva_site_pages;
create policy niva_site_pages_content_staff on app.niva_site_pages for select to authenticated
  using (app.has_permission(center_id, 'content.draft') or app.has_permission(center_id, 'content.manage'));
drop policy if exists module_switch on app.niva_site_pages;
create policy module_switch on app.niva_site_pages as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('niva'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('niva'))::uuid[])));
-- No write policy and no write grant: the functions below write.
revoke all on app.niva_site_pages from public, anon, authenticated, connect_worker;
grant select on app.niva_site_pages to authenticated;
grant all on app.niva_site_pages to service_role;

-- ── 2. Staff: queue pages ────────────────────────────────────────────────────
-- Up to 50 addresses per call, one job each. Addresses are normalised first, so the forms of one page are one job.
create or replace function app.niva_import_pages(p_center uuid, p_urls text[])
returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_raw text; v_url text; v_key text;
  v_keys text[] := '{}'; v_urls text[] := '{}';
  v_start timestamptz; v_job bigint; i int;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not (app.has_permission(p_center, 'content.draft') or app.has_permission(p_center, 'content.manage')) then
    raise exception 'Importing web pages into Niva needs content.draft.' using errcode = 'insufficient_privilege';
  end if;
  if p_urls is null or cardinality(p_urls) = 0 then raise exception 'Paste at least one web page address.'; end if;

  foreach v_raw in array p_urls loop
    v_url := nullif(btrim(coalesce(v_raw, '')), '');
    if v_url is null then continue; end if;
    v_url := regexp_replace(v_url, '#.*$', '');
    if char_length(v_url) > 2000 or v_url !~* '^https?://[^/[:space:]]+(/[^[:space:]]*)?$' then
      raise exception '"%" is not a web page address. It must start with http:// or https:// and have no spaces.', left(btrim(v_raw), 120);
    end if;
    v_url := app.niva_page_address(v_url);
    v_key := app.niva_page_key(v_url);
    if v_key = any (v_keys) then continue; end if;
    v_keys := v_keys || v_key;
    v_urls := v_urls || v_url;
  end loop;

  if cardinality(v_urls) = 0 then raise exception 'Paste at least one web page address.'; end if;
  if cardinality(v_urls) > 50 then
    raise exception 'That is % addresses; import at most 50 at a time.', cardinality(v_urls);
  end if;

  -- After the pages of an earlier batch that are still waiting (never tried yet; a retry's later run_after is its
  -- backoff, not a place in the line), so a site is never read by two batches side by side.
  select greatest(now(), coalesce(max(j.run_after) + interval '4 seconds', now())) into v_start
    from app.jobs j
   where j.center_id = p_center and j.kind = 'niva.import_page' and j.status = 'queued' and j.attempts = 0;

  for i in 1 .. cardinality(v_urls) loop
    v_job := app.enqueue_job(p_center, 'niva.import_page', jsonb_build_object('url', v_urls[i]), v_start + ((i - 1) * interval '4 seconds'), 3);
    update app.niva_site_pages set last_import_job = v_job where center_id = p_center and url_key = v_keys[i];
  end loop;
  return cardinality(v_urls);
end $$;

-- ── 3. Worker: save a page's sections ────────────────────────────────────────
-- p_sections: [{"title": "...", "body": "...", "heading": "..."}, ...] in page order ("heading" is optional; the
-- title stands in for it). p_url is the page's final address; p_requested_url the one that was asked for.
create or replace function app.niva_worker_save_import(p_center uuid, p_url text, p_page_title text, p_sections jsonb,
                                                       p_created_by uuid, p_requested_url text)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_url text;                       -- the page's address as saved
  v_key text;                       -- which page it is (apex and www, http and https as one)
  v_keys text[];                    -- this page's keys: the final address's and, after a redirect, the asked one's
  v_page_ids uuid[];                -- the page's sections already in the library (every form of its address)
  v_matched uuid[] := '{}';
  v_heads text[] := '{}';
  v_i int := 0; v_sec jsonb; v_title text; v_body text; v_head text; v_n int; v_skey text; v_hash text; v_old_hash text;
  v_slug text; v_id uuid; v_meta jsonb; v_page_hash text := '';
  v_row app.content_items%rowtype;
  v_created int := 0; v_updated int := 0; v_unchanged int := 0; v_kept int := 0; v_changed int := 0;
  v_orphaned int := 0; v_removed int := 0; v_retired int := 0;
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

  v_url := app.niva_page_address(p_url);
  v_key := app.niva_page_key(v_url);
  v_keys := array[v_key];
  if nullif(btrim(coalesce(p_requested_url, '')), '') is not null and app.niva_page_key(p_requested_url) <> v_key then
    v_keys := v_keys || app.niva_page_key(p_requested_url);
  end if;
  -- Two imports of one page (say its apex and www forms, queued at different times) run one after the other.
  perform pg_advisory_xact_lock(hashtextextended('app.niva_import:' || p_center::text || ':' || v_key, 0));

  select coalesce(array_agg(c.id), '{}') into v_page_ids
    from app.content_items c
   where c.center_id = p_center and c.kind = 'niva_source' and c.version = 1
     and c.metadata->>'imported' = 'true' and c.metadata ? 'source_url'
     and app.niva_page_key(c.metadata->>'source_url') = any (v_keys);

  for v_sec in select value from jsonb_array_elements(p_sections) loop
    v_i := v_i + 1;
    v_title := left(nullif(btrim(coalesce(v_sec->>'title', '')), ''), 200);
    v_body := nullif(btrim(coalesce(v_sec->>'body', '')), '');
    if v_title is null or v_body is null then
      raise exception 'Section % has no title or no text.', v_i;
    end if;
    if char_length(v_body) > 6000 then raise exception 'Section % is longer than 6000 characters.', v_i; end if;

    -- The section's key: the page and its heading (a heading used twice on a page is told apart by its turn).
    v_head := lower(regexp_replace(btrim(coalesce(nullif(btrim(coalesce(v_sec->>'heading', '')), ''), v_title)), '\s+', ' ', 'g'));
    v_n := 1 + (select count(*) from unnest(v_heads) h where h = v_head);
    v_heads := v_heads || v_head;
    v_skey := md5(v_key || '|' || v_head || case when v_n > 1 then '|' || v_n else '' end);
    v_hash := md5(v_body);
    v_page_hash := md5(v_page_hash || v_hash);
    v_meta := jsonb_build_object('imported', true, 'source_url', v_url, 'page_key', v_key,
                                 'page_title', left(coalesce(p_page_title, ''), 200), 'section', v_i,
                                 'section_key', v_skey, 'body_hash', v_hash, 'imported_at', now());

    -- Found again by its key; a section saved before 0576 (no key) by its title, the furthest along first.
    v_row := null;
    select c.* into v_row from app.content_items c
     where c.id = any (v_page_ids) and not (c.id = any (v_matched)) and c.metadata->>'section_key' = v_skey
     order by c.created_at, c.id limit 1;
    if v_row.id is null then
      select c.* into v_row from app.content_items c
       where c.id = any (v_page_ids) and not (c.id = any (v_matched)) and lower(c.title) = lower(v_title)
       order by array_position(array['published', 'approved', 'in_review', 'draft', 'retired'], c.status), c.created_at, c.id
       limit 1;
    end if;

    if v_row.id is null then
      v_slug := 'web-' || left(md5(v_key), 10) || '-' || left(v_skey, 10);
      if exists (select 1 from app.content_items where center_id = p_center and kind = 'niva_source' and slug = v_slug and version = 1) then
        v_slug := v_slug || '-' || lpad(v_i::text, 2, '0');   -- a row of another address already holds the slug
      end if;
      insert into app.content_items (center_id, kind, slug, title, body_md, language, metadata, status, created_by)
      values (p_center, 'niva_source', v_slug, v_title, v_body, 'en', v_meta, 'draft', p_created_by)
      returning id into v_id;
      v_matched := v_matched || v_id;
      v_created := v_created + 1;
      continue;
    end if;

    v_matched := v_matched || v_row.id;
    if v_row.status = 'draft' then
      if v_row.title = v_title and v_row.body_md = v_body and v_row.metadata->>'section_key' = v_skey
         and v_row.metadata->>'source_url' = v_url and (v_row.metadata->>'section')::int = v_i
         and not (v_row.metadata ?| array['orphaned', 'page_changed']) then
        v_unchanged := v_unchanged + 1;
      else
        update app.content_items
           set title = v_title, body_md = v_body,
               metadata = (metadata - 'orphaned' - 'orphaned_at' - 'page_changed' - 'page_text_now' - 'page_title_now'
                                    - 'page_hash_now' - 'page_changed_at') || v_meta
         where id = v_row.id;
        v_updated := v_updated + 1;
      end if;
    elsif v_row.status = 'retired' then
      v_retired := v_retired + 1;       -- a person took it out of Niva: left exactly as it is
    else
      -- In review, approved or published: the text stays as it is; a person decides about a change on the page.
      v_kept := v_kept + 1;
      v_old_hash := coalesce(v_row.metadata->>'body_hash', md5(coalesce(v_row.body_md, '')));
      if v_old_hash = v_hash then
        if v_row.metadata ?| array['orphaned', 'page_changed'] then
          update app.content_items
             set metadata = (metadata - 'orphaned' - 'orphaned_at' - 'page_changed' - 'page_text_now' - 'page_title_now'
                                      - 'page_hash_now' - 'page_changed_at')
                            || jsonb_build_object('source_url', v_url, 'page_key', v_key, 'section', v_i,
                                                  'section_key', v_skey, 'body_hash', v_hash)
           where id = v_row.id;
        elsif v_row.status = 'in_review'
              and (v_row.metadata->>'source_url' is distinct from v_url or v_row.metadata->>'section_key' is distinct from v_skey
                   or v_row.metadata->>'section' is distinct from v_i::text or v_row.metadata->>'body_hash' is distinct from v_hash) then
          -- Waiting in the approval queue (nothing live, so no go-live evidence moves): it takes the final address and
          -- its key, so the queue shows a page's sections together under one address.
          update app.content_items
             set metadata = metadata || jsonb_build_object('source_url', v_url, 'page_key', v_key, 'section', v_i,
                                                           'section_key', v_skey, 'body_hash', v_hash)
           where id = v_row.id;
        end if;
      else
        v_changed := v_changed + 1;
        -- Written only when the flag is new or the page changed again (or the section had been orphaned).
        if not (coalesce(v_row.metadata->>'page_changed', '') = 'true' and coalesce(v_row.metadata->>'page_hash_now', '') = v_hash
                and coalesce(v_row.metadata->>'page_title_now', '') = v_title and not (v_row.metadata ? 'orphaned')) then
          update app.content_items
             set metadata = (metadata - 'orphaned' - 'orphaned_at')
                            || jsonb_build_object('source_url', v_url, 'page_key', v_key, 'section', v_i,
                                                  'section_key', v_skey, 'body_hash', v_old_hash,
                                                  'page_changed', true, 'page_text_now', v_body, 'page_title_now', v_title,
                                                  'page_hash_now', v_hash, 'page_changed_at', now())
           where id = v_row.id;
        end if;
      end if;
    end if;
  end loop;

  -- Sections the page no longer has.
  for v_row in select c.* from app.content_items c where c.id = any (v_page_ids) and not (c.id = any (v_matched)) loop
    if v_row.status = 'draft'
       and not exists (select 1 from app.gyan_steps s where s.content_item_id = v_row.id) then
      delete from app.content_items where id = v_row.id;
      v_removed := v_removed + 1;
    elsif v_row.status = 'retired' then
      null;
    else
      v_orphaned := v_orphaned + 1;
      if v_row.metadata->>'orphaned' is distinct from 'true' then
        update app.content_items set metadata = metadata || jsonb_build_object('orphaned', true, 'orphaned_at', now())
         where id = v_row.id;
      end if;
    end if;
  end loop;

  update app.niva_site_pages set last_hash = v_page_hash
   where center_id = p_center and url_key = any (v_keys) and last_hash is distinct from v_page_hash;

  return jsonb_build_object('url', v_url, 'sections', v_i, 'created', v_created, 'updated', v_updated,
                            'unchanged', v_unchanged, 'kept_as_approved', v_kept, 'changed', v_changed,
                            'orphaned', v_orphaned, 'removed', v_removed, 'retired', v_retired);
end $$;

-- 0540's form (no requested address), kept for any caller of the old signature.
create or replace function app.niva_worker_save_import(p_center uuid, p_url text, p_page_title text, p_sections jsonb, p_created_by uuid)
returns jsonb
language sql security definer set search_path = app, public, extensions as $$
  select app.niva_worker_save_import(p_center, p_url, p_page_title, p_sections, p_created_by, null::text)
$$;

-- ── 5. Finding a site's pages ────────────────────────────────────────────────
create or replace function app.niva_discover_site(p_center uuid, p_url text)
returns bigint
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_url text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not (app.has_permission(p_center, 'content.draft') or app.has_permission(p_center, 'content.manage')) then
    raise exception 'Finding a website''s pages for Niva needs content.draft.' using errcode = 'insufficient_privilege';
  end if;
  perform app.assert_module_enabled(p_center, 'niva');
  v_url := regexp_replace(btrim(coalesce(p_url, '')), '#.*$', '');
  if v_url = '' then raise exception 'Type the website''s address, for example https://www.example.org.'; end if;
  if char_length(v_url) > 2000 or v_url !~* '^https?://[^/[:space:]]+(/[^[:space:]]*)?$' then
    raise exception '"%" is not a website address. It must start with http:// or https:// and have no spaces.', left(btrim(p_url), 120);
  end if;
  -- One search at a time. One that was queued more than 15 minutes ago and never finished (the background service
  -- was down) does not block a new one.
  if exists (select 1 from app.jobs j where j.center_id = p_center and j.kind = 'niva.discover_site'
               and j.status in ('queued', 'running') and j.created_at > now() - interval '15 minutes') then
    raise exception 'Niva is already looking for a website''s pages. Wait for that to finish (about a minute), then try again.';
  end if;
  return app.enqueue_job(p_center, 'niva.discover_site', jsonb_build_object('url', app.niva_page_address(v_url)), now(), 3);
end $$;

-- p_pages: [{"url": "...", "lastmod": "2026-09-18T00:00:00.000Z" | null}, ...], at most 500. Only pages of the
-- root's site are kept (the apex and www forms are one site); the same page twice is saved once.
create or replace function app.niva_worker_save_discovery(p_center uuid, p_root text, p_pages jsonb)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_site text; v_p jsonb; v_url text; v_key text; v_lastmod timestamptz; v_raw text; v_new boolean;
  v_keys text[] := '{}'; v_added int := 0; v_kept int := 0; v_removed int := 0; v_other int := 0;
begin
  perform app.assert_worker();
  if p_center is null or nullif(btrim(coalesce(p_root, '')), '') is null then
    raise exception 'niva_worker_save_discovery needs the center and the website address.';
  end if;
  if jsonb_typeof(p_pages) is distinct from 'array' then
    raise exception 'niva_worker_save_discovery needs the list of pages.';
  end if;
  if jsonb_array_length(p_pages) > 500 then
    raise exception 'A website''s page list is saved with at most 500 pages (got %).', jsonb_array_length(p_pages);
  end if;
  v_site := regexp_replace(app.niva_page_key(p_root), '[/?].*$', '');

  for v_p in select value from jsonb_array_elements(p_pages) loop
    v_url := nullif(btrim(coalesce(v_p->>'url', '')), '');
    if v_url is null or char_length(v_url) > 2000 or v_url !~* '^https?://[^/[:space:]]+(/[^[:space:]]*)?$' then
      v_other := v_other + 1;
      continue;
    end if;
    v_url := app.niva_page_address(v_url);
    v_key := app.niva_page_key(v_url);
    if regexp_replace(v_key, '[/?].*$', '') <> v_site then v_other := v_other + 1; continue; end if;
    if v_key = any (v_keys) then continue; end if;
    v_keys := v_keys || v_key;
    v_lastmod := null;
    v_raw := nullif(btrim(coalesce(v_p->>'lastmod', '')), '');
    if v_raw ~ '^\d{4}-\d{2}-\d{2}' then
      begin
        v_lastmod := v_raw::timestamptz;
      exception when others then
        v_lastmod := null;                -- an impossible date in the sitemap is just not shown
      end;
    end if;
    -- A page found again is written only when the sitemap now says something else about it (no audit noise).
    v_new := null;
    insert into app.niva_site_pages as sp (center_id, site, url, url_key, lastmod, discovered_at)
    values (p_center, v_site, v_url, v_key, v_lastmod, now())
    on conflict (center_id, url_key) do update
      set site = excluded.site, url = excluded.url, lastmod = excluded.lastmod
      where (sp.site, sp.url, sp.lastmod) is distinct from (excluded.site, excluded.url, excluded.lastmod)
    returning (xmax = 0) into v_new;
    if v_new then v_added := v_added + 1; else v_kept := v_kept + 1; end if;
  end loop;

  -- The list is a copy of what the sitemap says: a page it no longer lists leaves the list. Sources imported from
  -- that page are not touched.
  delete from app.niva_site_pages where center_id = p_center and site = v_site and not (url_key = any (v_keys));
  get diagnostics v_removed = row_count;

  return jsonb_build_object('site', v_site, 'pages', cardinality(v_keys), 'added', v_added, 'kept', v_kept,
                            'removed', v_removed, 'other_site', v_other);
end $$;

-- The latest search for pages and the list, for Content › Niva. Each page carries what Niva already has from it.
create or replace function app.niva_discovery_status(p_center uuid)
returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_job jsonb; v_pages jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not (app.has_permission(p_center, 'content.draft') or app.has_permission(p_center, 'content.manage')) then
    raise exception 'Seeing a website''s pages for Niva needs content.draft.' using errcode = 'insufficient_privilege';
  end if;
  perform app.assert_module_enabled(p_center, 'niva');   -- as the table's module_switch policy says

  select jsonb_build_object('id', j.id, 'url', j.payload->>'url', 'status', j.status, 'attempts', j.attempts,
                            'max_attempts', j.max_attempts, 'last_error', j.last_error, 'result', j.result,
                            'created_at', j.created_at, 'finished_at', j.finished_at)
    into v_job
    from app.jobs j
   where j.center_id = p_center and j.kind = 'niva.discover_site'
   order by j.id desc
   limit 1;

  with src as (
    select app.niva_page_key(c.metadata->>'source_url') as k, c.status, c.metadata
      from app.content_items c
     where c.center_id = p_center and c.kind = 'niva_source' and c.version = 1
       and c.metadata->>'imported' = 'true' and c.metadata ? 'source_url'
  ), per as (
    select k,
           count(*) filter (where status <> 'retired') as sections,
           count(*) filter (where status = 'published') as included,
           count(*) filter (where status in ('in_review', 'approved', 'published') and metadata->>'page_changed' = 'true') as changed,
           max((metadata->>'imported_at')::timestamptz) as imported_at
      from src
     group by k
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'url', sp.url, 'lastmod', sp.lastmod, 'discovered_at', sp.discovered_at,
           'sections', coalesce(per.sections, 0), 'included', coalesce(per.included, 0), 'changed', coalesce(per.changed, 0),
           'imported_at', per.imported_at,
           'import_status', j.status,
           'import_error', case when j.status = 'failed' or (j.status = 'queued' and j.attempts > 0) then j.last_error end)
           order by sp.url), '[]'::jsonb)
    into v_pages
    from app.niva_site_pages sp
    left join per on per.k = sp.url_key
    left join app.jobs j on j.id = sp.last_import_job
   where sp.center_id = p_center;

  return jsonb_build_object('job', v_job, 'pages', v_pages);
end $$;

-- ── Grants ───────────────────────────────────────────────────────────────────
-- niva_import_pages, the 5-argument niva_worker_save_import and niva_import_status keep 0540's grants.
revoke execute on function app.niva_page_address(text), app.niva_page_key(text),
  app.niva_worker_save_import(uuid, text, text, jsonb, uuid, text),
  app.niva_discover_site(uuid, text), app.niva_worker_save_discovery(uuid, text, jsonb), app.niva_discovery_status(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app.niva_discover_site(uuid, text), app.niva_discovery_status(uuid) to authenticated;
grant execute on function app.niva_worker_save_import(uuid, text, text, jsonb, uuid, text),
  app.niva_worker_save_discovery(uuid, text, jsonb) to connect_worker;
