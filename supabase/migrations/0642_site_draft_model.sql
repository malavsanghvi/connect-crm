-- 0642_site_draft_model.sql (backlog B92, phase W3: the first draft of an organization's website, as data)
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   Setup › Your website (0640) reads the organization's current website and shows "What we found". This adds the place where
--   a FIRST DRAFT of the new website is kept, so staff can look at it privately and approve it page by page. Nothing is
--   published and nothing is visible to visitors: the draft is data, shown only to the people who may change settings.
--     app.sites               one row per community: its name, theme (colours, fonts, logo) and the draft's version
--     app.site_pages          the pages (home, about, events, give, contact, and classes or photos when the organization has them)
--     app.site_blocks         the blocks of a page (hero, text, events_list, giving_cta, gallery, leaders, contact, map, faq, footer),
--                             each saying where its words came from: the old website (own_site), Weaver's own records (weaver_data)
--                             or a short stand-in Weaver wrote for the person to replace (written)
--     app.site_draft_save     staff: store a draft the portal built (replaces the earlier draft only when asked to)
--     app.site_draft_get      staff: read the draft, with or without its blocks
--     app.site_page_set_status staff: approve a page, or reopen it
--   The draft itself is built by the portal (src/lib/site-draft, pure code with tests) from the finished website read and
--   from app.site_draft_data (0643); this migration only keeps it and checks its shape.
--
-- WHO MAY DO WHAT (the pattern of 0640, nothing new granted)
--   The three tables have row level security ON and NO policy and NO grant: nobody reaches them through the API, not even
--   an administrator. Only the SECURITY DEFINER functions below touch them, and each checks app.has_permission(center,
--   'settings.manage') itself ("Sign in first" for a caller with no user). Visitors (anon) and members read NOTHING: there
--   is no read function for them yet; publishing (and the public read it needs) comes in a later phase and will widen this
--   deliberately. execute is revoked from public, anon and service_role and granted to authenticated only.
--
-- WHAT IS KEPT HONEST BY THE DATABASE
--   * a block kept from the old website must name the old page (source_page, a web address); the other sources must not;
--   * a stand-in (source 'written') is always marked needs_text, so the person is told to replace it;
--   * page names are web-safe words, unique in a community; at most 12 pages, 30 blocks a page, 30 KB of content a block;
--   * a draft that already exists is replaced only when the caller says so (p_replace), and replacing it clears every
--     approval, because the pages are new. The version number goes up each time.
--   Every change is in the audit log (the tables carry app.audit_row like every other table).
--
-- Idempotent where it can be: create table if not exists, create or replace function.

set client_min_messages = warning;

-- ── 1. The site ──────────────────────────────────────────────────────────────
create table if not exists app.sites (
  center_id     uuid primary key references app.centers(id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 200),
  -- Only a draft exists in this phase; publishing (a later phase) widens this check.
  status        text not null default 'draft' check (status = 'draft'),
  theme         jsonb not null default '{}'::jsonb check (jsonb_typeof(theme) = 'object' and octet_length(theme::text) <= 20000),
  draft_version int not null default 1 check (draft_version >= 1),
  -- The finished website read (app.jobs.id) the draft was built from; no foreign key, because old jobs are cleaned away.
  source_job    bigint,
  built_at      timestamptz not null default now(),
  built_by      uuid references auth.users(id) on delete set null,
  updated_at    timestamptz not null default now()
);
comment on table app.sites is
  'The organization''s website as a draft (0642, B92 W3). One row per community. Row level security is on with no policy and no grant: only app.site_draft_* (settings.manage) reach it. Visitors read nothing.';
comment on column app.sites.theme is 'Colours, fonts, logo and layout hints, with where each came from (own website, a hint from a website the organization likes, or Weaver''s default).';
comment on column app.sites.draft_version is 'Goes up by one each time the draft is built again.';

-- ── 2. The pages ─────────────────────────────────────────────────────────────
create table if not exists app.site_pages (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.sites(center_id) on delete cascade,
  slug        text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  title       text not null check (char_length(btrim(title)) between 1 and 120),
  kind        text not null check (kind in ('home', 'about', 'events', 'give', 'contact', 'school', 'gallery')),
  sort        int not null default 0,
  status      text not null default 'draft' check (status in ('draft', 'approved')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  -- The path of the old page this one grew from, when there was one.
  source_path text check (source_path is null or (char_length(source_path) <= 300 and source_path like '/%')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (center_id, slug),
  check ((status = 'approved') = (approved_at is not null))
);
comment on table app.site_pages is 'The pages of a community''s website draft (0642). status approved means the administrator looked at the page and accepted it; nothing is published by it.';

-- ── 3. The blocks ────────────────────────────────────────────────────────────
create table if not exists app.site_blocks (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  page_id     uuid not null references app.site_pages(id) on delete cascade,
  sort        int not null,
  type        text not null check (type in ('hero', 'text', 'events_list', 'giving_cta', 'gallery', 'leaders', 'contact', 'map', 'faq', 'footer')),
  content     jsonb not null check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 30000),
  source      text not null check (source in ('own_site', 'weaver_data', 'written')),
  source_page text check (source_page is null or (source_page ~* '^https?://' and char_length(source_page) <= 2000)),
  needs_text  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (page_id, sort),
  -- Words kept from the old website name their old page; the other sources do not.
  check ((source = 'own_site') = (source_page is not null)),
  -- A stand-in is always marked, so the person is told to replace it.
  check (source <> 'written' or needs_text)
);
create index if not exists site_blocks_center_idx on app.site_blocks (center_id);
comment on table app.site_blocks is 'The blocks of a page of the website draft (0642). source says where the words came from: own_site (the old website, with source_page), weaver_data (Weaver''s own records) or written (a stand-in, needs_text).';

alter table app.sites enable row level security;
alter table app.site_pages enable row level security;
alter table app.site_blocks enable row level security;
revoke all on app.sites, app.site_pages, app.site_blocks from public, anon, authenticated, service_role;

insert into app.module_tables (table_name, module_key) values ('sites', null), ('site_pages', null), ('site_blocks', null)
on conflict (table_name) do update set module_key = excluded.module_key;

drop trigger if exists audit_sites on app.sites;
create trigger audit_sites after insert or update or delete on app.sites
  for each row execute function app.audit_row('center_id');
drop trigger if exists audit_site_pages on app.site_pages;
create trigger audit_site_pages after insert or update or delete on app.site_pages
  for each row execute function app.audit_row();
drop trigger if exists audit_site_blocks on app.site_blocks;
create trigger audit_site_blocks after insert or update or delete on app.site_blocks
  for each row execute function app.audit_row();

-- ── 4. Staff: store a draft ──────────────────────────────────────────────────
-- p_draft: { name, theme: {…}, pages: [ { slug, title, kind, source_path?, blocks: [ { type, content, source, source_page?, needs_text? } ] } ] }
-- The portal builds it (src/lib/site-draft/generate.ts); everything is checked again here, in plain English, because any
-- signed-in person with settings.manage can call this directly.
-- p_job: the finished website read (app.jobs.id) it was built from, or null when it was built from Weaver's records alone.
-- p_replace: false (the default) refuses when a draft already exists; true replaces it, and its approvals go with it.
create or replace function app.site_draft_save(p_center uuid, p_draft jsonb, p_job bigint default null, p_replace boolean default false)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_old app.sites;
  v_pages jsonb;
  v_page jsonb;
  v_blocks jsonb;
  v_block jsonb;
  v_i int;
  v_j int;
  v_page_id uuid;
  v_slug text;
  v_slugs text[] := '{}';
  v_kind text;
  v_type text;
  v_source text;
  v_source_page text;
  v_n_blocks int := 0;
  v_version int;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.has_permission(p_center, 'settings.manage') then
    raise exception 'Saving the website draft needs the settings.manage permission.' using errcode = 'insufficient_privilege';
  end if;

  if p_draft is null or jsonb_typeof(p_draft) <> 'object' then
    raise exception 'The website draft is missing or not in the expected form. Nothing was saved.';
  end if;
  if nullif(btrim(coalesce(p_draft ->> 'name', '')), '') is null then
    raise exception 'The website draft needs the organization''s name. Nothing was saved.';
  end if;
  if jsonb_typeof(p_draft -> 'theme') is distinct from 'object' then
    raise exception 'The website draft needs a theme (its colours and fonts). Nothing was saved.';
  end if;
  v_pages := p_draft -> 'pages';
  if jsonb_typeof(v_pages) is distinct from 'array' or jsonb_array_length(v_pages) = 0 then
    raise exception 'The website draft needs at least one page. Nothing was saved.';
  end if;
  if jsonb_array_length(v_pages) > 12 then
    raise exception 'A website draft can have at most 12 pages (this one has %). Nothing was saved.', jsonb_array_length(v_pages);
  end if;
  if p_job is not null and not exists (select 1 from app.jobs j where j.id = p_job and j.center_id = p_center and j.kind = 'site.crawl') then
    raise exception 'That website read does not belong to this community. Nothing was saved.';
  end if;

  -- Two people pressing the button at once take turns.
  perform pg_advisory_xact_lock(hashtextextended('site_draft:' || p_center::text, 0));
  select * into v_old from app.sites where center_id = p_center;
  if found and not coalesce(p_replace, false) then
    raise exception 'This community already has a website draft. Start the draft again to replace it; the approvals on its pages will be cleared.';
  end if;

  delete from app.site_pages where center_id = p_center;       -- the blocks go with their pages
  v_version := coalesce(v_old.draft_version, 0) + 1;
  insert into app.sites (center_id, name, theme, draft_version, source_job, built_at, built_by, updated_at)
  values (p_center, btrim(p_draft ->> 'name'), p_draft -> 'theme', v_version, p_job, now(), auth.uid(), now())
  on conflict (center_id) do update
    set name = excluded.name, theme = excluded.theme, draft_version = excluded.draft_version, source_job = excluded.source_job,
        built_at = now(), built_by = auth.uid(), updated_at = now();

  for v_i in 0 .. jsonb_array_length(v_pages) - 1 loop
    v_page := v_pages -> v_i;
    if jsonb_typeof(v_page) <> 'object' then raise exception 'Page % of the draft is not in the expected form. Nothing was saved.', v_i + 1; end if;
    v_slug := v_page ->> 'slug';
    v_kind := v_page ->> 'kind';
    if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) > 60 then
      raise exception 'Page % has a name ("%") that cannot be used in a web address. Nothing was saved.', v_i + 1, left(coalesce(v_slug, ''), 40);
    end if;
    if v_slug = any (v_slugs) then raise exception 'Two pages are both called "%". Nothing was saved.', v_slug; end if;
    v_slugs := v_slugs || v_slug;
    if v_kind is null or v_kind not in ('home', 'about', 'events', 'give', 'contact', 'school', 'gallery') then
      raise exception 'Page "%" is of a kind Weaver does not know ("%"). Nothing was saved.', v_slug, left(coalesce(v_kind, ''), 30);
    end if;
    if nullif(btrim(coalesce(v_page ->> 'title', '')), '') is null or char_length(v_page ->> 'title') > 120 then
      raise exception 'Page "%" needs a title of up to 120 characters. Nothing was saved.', v_slug;
    end if;

    insert into app.site_pages (center_id, slug, title, kind, sort, source_path)
    values (p_center, v_slug, btrim(v_page ->> 'title'), v_kind, v_i, nullif(v_page ->> 'source_path', ''))
    returning id into v_page_id;

    v_blocks := v_page -> 'blocks';
    if jsonb_typeof(v_blocks) is distinct from 'array' or jsonb_array_length(v_blocks) = 0 then
      raise exception 'Page "%" has no blocks. Nothing was saved.', v_slug;
    end if;
    if jsonb_array_length(v_blocks) > 30 then
      raise exception 'Page "%" has % blocks; a page can have at most 30. Nothing was saved.', v_slug, jsonb_array_length(v_blocks);
    end if;
    for v_j in 0 .. jsonb_array_length(v_blocks) - 1 loop
      v_block := v_blocks -> v_j;
      v_type := v_block ->> 'type';
      v_source := v_block ->> 'source';
      v_source_page := nullif(v_block ->> 'source_page', '');
      if jsonb_typeof(v_block) <> 'object' or jsonb_typeof(v_block -> 'content') is distinct from 'object' then
        raise exception 'Block % of page "%" is not in the expected form. Nothing was saved.', v_j + 1, v_slug;
      end if;
      if v_type is null or v_type not in ('hero', 'text', 'events_list', 'giving_cta', 'gallery', 'leaders', 'contact', 'map', 'faq', 'footer') then
        raise exception 'Block % of page "%" is of a kind Weaver does not know ("%"). Nothing was saved.', v_j + 1, v_slug, left(coalesce(v_type, ''), 30);
      end if;
      if v_source is null or v_source not in ('own_site', 'weaver_data', 'written') then
        raise exception 'Block % of page "%" does not say where its words came from. Nothing was saved.', v_j + 1, v_slug;
      end if;
      if v_source = 'own_site' and v_source_page is null then
        raise exception 'Block % of page "%" keeps words from the old website but does not say which page. Nothing was saved.', v_j + 1, v_slug;
      end if;
      if v_source <> 'own_site' and v_source_page is not null then
        raise exception 'Block % of page "%" names an old page but its words are not from the old website. Nothing was saved.', v_j + 1, v_slug;
      end if;
      if octet_length((v_block -> 'content')::text) > 30000 then
        raise exception 'Block % of page "%" is too long (the limit is 30,000 characters). Nothing was saved.', v_j + 1, v_slug;
      end if;
      insert into app.site_blocks (center_id, page_id, sort, type, content, source, source_page, needs_text)
      values (p_center, v_page_id, v_j, v_type, v_block -> 'content', v_source, v_source_page,
              v_source = 'written' or coalesce(v_block ->> 'needs_text' = 'true', false));
      v_n_blocks := v_n_blocks + 1;
    end loop;
  end loop;

  return jsonb_build_object('draft_version', v_version, 'pages', jsonb_array_length(v_pages), 'blocks', v_n_blocks, 'replaced', v_old.center_id is not null);
end $$;
comment on function app.site_draft_save(uuid, jsonb, bigint, boolean) is
  'Store the first draft of the community''s website (0642). settings.manage only. Replaces an existing draft, and clears its approvals, only when p_replace is true.';

-- ── 5. Staff: read the draft ─────────────────────────────────────────────────
-- p_with_blocks false gives the pages with how many blocks they have and how many are stand-ins (for the Setup screen);
-- true adds the blocks (for the preview). Null when there is no draft yet.
create or replace function app.site_draft_get(p_center uuid, p_with_blocks boolean default true)
returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_site app.sites; v_pages jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.has_permission(p_center, 'settings.manage') then
    raise exception 'Seeing the website draft needs the settings.manage permission.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_site from app.sites where center_id = p_center;
  if not found then return null; end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', p.id, 'slug', p.slug, 'title', p.title, 'kind', p.kind, 'sort', p.sort, 'status', p.status,
             'approved_at', p.approved_at, 'source_path', p.source_path,
             'block_count', (select count(*) from app.site_blocks b where b.page_id = p.id),
             'stand_ins', (select count(*) from app.site_blocks b where b.page_id = p.id and b.needs_text))
           || case when coalesce(p_with_blocks, true)
                   then jsonb_build_object('blocks', coalesce((
                          select jsonb_agg(jsonb_build_object('id', b.id, 'type', b.type, 'content', b.content, 'source', b.source,
                                                              'source_page', b.source_page, 'needs_text', b.needs_text) order by b.sort)
                            from app.site_blocks b where b.page_id = p.id), '[]'::jsonb))
                   else '{}'::jsonb end
           order by p.sort), '[]'::jsonb)
    into v_pages
    from app.site_pages p
   where p.center_id = p_center;

  return jsonb_build_object(
    'site', jsonb_build_object('name', v_site.name, 'status', v_site.status, 'theme', v_site.theme, 'draft_version', v_site.draft_version,
                               'built_at', v_site.built_at, 'source_job', v_site.source_job),
    'pages', v_pages);
end $$;
comment on function app.site_draft_get(uuid, boolean) is 'The website draft of the community (0642), with or without its blocks. settings.manage only; null when there is none.';

-- ── 6. Staff: approve a page, or reopen it ───────────────────────────────────
create or replace function app.site_page_set_status(p_center uuid, p_page uuid, p_status text)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_slug text; v_approved timestamptz;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.has_permission(p_center, 'settings.manage') then
    raise exception 'Approving a page of the website draft needs the settings.manage permission.' using errcode = 'insufficient_privilege';
  end if;
  if p_status is null or p_status not in ('draft', 'approved') then
    raise exception 'A page is either a draft or approved.';
  end if;
  update app.site_pages
     set status = p_status,
         approved_by = case when p_status = 'approved' then auth.uid() end,
         approved_at = case when p_status = 'approved' then now() end,
         updated_at = now()
   where id = p_page and center_id = p_center
  returning slug, approved_at into v_slug, v_approved;
  if not found then raise exception 'That page is not part of this community''s website draft.'; end if;
  return jsonb_build_object('id', p_page, 'slug', v_slug, 'status', p_status, 'approved_at', v_approved);
end $$;
comment on function app.site_page_set_status(uuid, uuid, text) is 'Approve a page of the website draft, or reopen it (0642). settings.manage only. Nothing is published by it.';

-- ── 7. Grants (as 0640) ──────────────────────────────────────────────────────
revoke execute on function app.site_draft_save(uuid, jsonb, bigint, boolean), app.site_draft_get(uuid, boolean), app.site_page_set_status(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function app.site_draft_save(uuid, jsonb, bigint, boolean), app.site_draft_get(uuid, boolean), app.site_page_set_status(uuid, uuid, text)
  to authenticated;
