-- 0751 · Marketplace packs, part 2 of 4: WeaverSite and CommunityConnect own their tables and their functions
-- (docs/MARKETPLACE_PACKS.md sections 3 and 4).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   WeaverSite (module `website`, 0750) is the organization's website draft:
--     app.sites, app.site_pages, app.site_blocks (0642)      move from the core platform to `website` in app.module_tables,
--                                                            with the restrictive module_switch policy every module table has
--                                                            (nobody reaches these tables through the API anyway: RLS on, no
--                                                            policy, no grant, as 0642 left them)
--     site_draft_save, site_draft_get, site_page_set_status (0642) and site_draft_data (latest body 0743)
--                                                            refuse in plain words when WeaverSite is not on ("Weaver has not
--                                                            enabled WeaverSite for this community."); platform admins pass, as
--                                                            everywhere. Reading the current website at Setup (0640, site.crawl)
--                                                            stays core: it teaches the organization's agent at onboarding.
--   CommunityConnect (module `channels`, 0750) is WhatsApp Business messaging:
--     app.whatsapp_accounts, app.whatsapp_template_submissions (0220)
--                                                            move from `comms` to `channels`, their module_switch policy follows
--     save_whatsapp_account, submit_whatsapp_template (0222) and send_test_message's WhatsApp branch (0221)
--                                                            also require `channels` (after `comms`, whose sentence comes first)
--     worker_message_to_send (latest body 0598)              a queued WhatsApp message whose community does not have
--                                                            CommunityConnect on is not sent: the worker records it as not sent
--                                                            with the reason (the message log shows it), so a message queued
--                                                            before the product was turned off or paused never goes out.
--   WhatsApp group links and the join queue (whatsapp_groups, whatsapp_join_requests) stay in Communications: no integration,
--   and moving them would leave installed member apps with an empty screen.
--
-- Every function below is its latest body word for word, with only the lines marked 0751 added.
set client_min_messages = warning;

-- ── 1. The tables move to their product ──────────────────────────────────────
update app.module_tables set module_key = 'website' where table_name in ('sites', 'site_pages', 'site_blocks');
update app.module_tables set module_key = 'channels' where table_name in ('whatsapp_accounts', 'whatsapp_template_submissions');

-- Their restrictive module_switch policies, on the new key (each written out, as 0741 does).
drop policy if exists module_switch on app.sites;
create policy module_switch on app.sites as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('website'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('website'))::uuid[])));
drop policy if exists module_switch on app.site_pages;
create policy module_switch on app.site_pages as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('website'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('website'))::uuid[])));
drop policy if exists module_switch on app.site_blocks;
create policy module_switch on app.site_blocks as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('website'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('website'))::uuid[])));
drop policy if exists module_switch on app.whatsapp_accounts;
create policy module_switch on app.whatsapp_accounts as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('channels'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('channels'))::uuid[])));
drop policy if exists module_switch on app.whatsapp_template_submissions;
create policy module_switch on app.whatsapp_template_submissions as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('channels'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('channels'))::uuid[])));

-- The Setup step for the WhatsApp Business account follows CommunityConnect, so it is skipped where the product is off.
update app.setup_steps set module_key = 'channels' where key = 'svc.whatsapp';

-- ── 2. WeaverSite: the website draft functions ───────────────────────────────
-- app.site_draft_save (latest body: 0642)
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
  -- 0751: the website draft is WeaverSite (module `website`, a Marketplace product). Reading the current website at Setup
  -- (0640) stays core and is not guarded.
  perform app.assert_module_enabled(p_center, 'website');

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

-- app.site_draft_get (latest body: 0642)
create or replace function app.site_draft_get(p_center uuid, p_with_blocks boolean default true)
returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_site app.sites; v_pages jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.has_permission(p_center, 'settings.manage') then
    raise exception 'Seeing the website draft needs the settings.manage permission.' using errcode = 'insufficient_privilege';
  end if;
  -- 0751: the website draft is WeaverSite (module `website`, a Marketplace product). Reading the current website at Setup
  -- (0640) stays core and is not guarded.
  perform app.assert_module_enabled(p_center, 'website');
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

-- app.site_page_set_status (latest body: 0642)
create or replace function app.site_page_set_status(p_center uuid, p_page uuid, p_status text)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_slug text; v_approved timestamptz;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.has_permission(p_center, 'settings.manage') then
    raise exception 'Approving a page of the website draft needs the settings.manage permission.' using errcode = 'insufficient_privilege';
  end if;
  -- 0751: the website draft is WeaverSite (module `website`, a Marketplace product). Reading the current website at Setup
  -- (0640) stays core and is not guarded.
  perform app.assert_module_enabled(p_center, 'website');
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

-- app.site_draft_data (latest body: 0743)
create or replace function app.site_draft_data(p_center uuid)
returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare
  v_center app.centers;
  v_prof app.org_profiles;
  v_addr jsonb;
  v_address text;
  v_tz text;
  v_events_on boolean;
  v_giving_on boolean;
  v_store_on boolean;
  v_school_on boolean;
  v_events jsonb := '[]'::jsonb;
  v_campaigns jsonb := '[]'::jsonb;
  v_leaders jsonb;
  v_today jsonb;
  v_albums jsonb;
  v_store_items jsonb := '[]'::jsonb;
  v_levels jsonb := '[]'::jsonb;
  v_term jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.has_permission(p_center, 'settings.manage') then
    raise exception 'Drafting the website from Weaver''s records needs the settings.manage permission.' using errcode = 'insufficient_privilege';
  end if;
  -- 0751: the website draft is WeaverSite (module `website`, a Marketplace product). Reading the current website at Setup
  -- (0640) stays core and is not guarded.
  perform app.assert_module_enabled(p_center, 'website');

  select * into v_center from app.centers where id = p_center;
  if not found then raise exception 'That community was not found.'; end if;
  select * into v_prof from app.org_profiles where center_id = p_center;
  v_tz := coalesce(nullif(btrim(v_center.time_zone), ''), 'UTC');

  v_addr := v_prof.registered_address;
  if v_addr is not null and jsonb_typeof(v_addr) = 'object' then
    v_address := nullif(concat_ws(', ',
        nullif(btrim(coalesce(v_addr ->> 'line1', '')), ''),
        nullif(btrim(coalesce(v_addr ->> 'line2', '')), ''),
        nullif(btrim(coalesce(v_addr ->> 'city', '')), ''),
        nullif(btrim(concat_ws(' ', nullif(btrim(coalesce(v_addr ->> 'state', '')), ''), nullif(btrim(coalesce(v_addr ->> 'postal_code', '')), ''))), '')), '');
  end if;

  v_events_on := app.module_enabled(p_center, 'events');
  v_giving_on := app.module_enabled(p_center, 'giving');
  v_store_on := app.module_enabled(p_center, 'store');
  v_school_on := app.module_enabled(p_center, 'pathshala');

  -- Upcoming events open to the public or to guests.
  if v_events_on then
    select coalesce(jsonb_agg(jsonb_build_object('title', e.name, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'venue', e.venue,
                                                 'description', left(e.description, 400)) order by e.starts_at), '[]'::jsonb)
      into v_events
      from (select ev.name, ev.starts_at, ev.ends_at, ev.venue, ev.description
              from app.events ev
             where ev.center_id = p_center
               and ev.status in ('published', 'rsvp_closed', 'live')
               and ev.audience in ('public', 'members_and_guests')
               and not coalesce(ev.confidential, false)
               and coalesce(ev.ends_at, ev.starts_at) >= now()
             order by ev.starts_at
             limit 12) e;
  end if;

  -- Published campaigns visible now, with their open opportunities.
  if v_giving_on then
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', c.name, 'kind', c.kind, 'description', left(c.description, 500),
             'items', coalesce((select jsonb_agg(jsonb_build_object('name', o.name, 'description', left(o.description, 300)) order by o.sort_order, o.name)
                                  from (select op.name, op.description, op.sort_order
                                          from app.opportunities op
                                         where op.campaign_id = c.id and op.status = 'open'
                                           and app.module_enabled(p_center, 'giving_opportunities')
                                           and app.giving_row_visible(op.active, op.visible_from, op.visible_until)
                                         order by op.sort_order, op.name
                                         limit 10) o), '[]'::jsonb)) order by c.starts_on nulls last, c.name), '[]'::jsonb)
      into v_campaigns
      from (select ca.id, ca.name, ca.kind, ca.description, ca.starts_on
              from app.campaigns ca
             where ca.center_id = p_center and ca.status = 'published'
               and app.giving_row_visible(ca.active, ca.visible_from, ca.visible_until)
               and (ca.ends_on is null or ca.ends_on >= current_date)
             order by ca.starts_on nulls last, ca.name
             limit 8) c;
  end if;

  -- The leaders the organization chose to show publicly: name and title, nothing else.
  select coalesce(jsonb_agg(jsonb_build_object('name', l.full_name, 'title', l.title) order by l.sort, l.full_name), '[]'::jsonb)
    into v_leaders
    from (select ol.full_name, ol.title, ol.sort from app.org_leaders ol
           where ol.center_id = p_center and ol.show_publicly
           order by ol.sort, ol.full_name limit 40) l;

  -- Today's opening and closing time (daily timings are kept by organizations that keep a tradition).
  select jsonb_build_object('date', t.on_date, 'open', left(t.temple_open::text, 5), 'close', left(t.temple_close::text, 5))
    into v_today
    from app.daily_timings t
   where t.center_id = p_center and t.on_date = (now() at time zone v_tz)::date;

  -- Public albums, with the number of approved photos that do not show children (plus the count of a linked album).
  select coalesce(jsonb_agg(jsonb_build_object('title', a.title, 'photos', a.n) order by a.created_at desc), '[]'::jsonb)
    into v_albums
    from (select pa.title, pa.created_at,
                 (select count(*) from app.photos ph where ph.album_id = pa.id and ph.status = 'approved' and not ph.contains_children)
                   + coalesce(pa.external_photo_count, 0) as n
            from app.photo_albums pa
           where pa.center_id = p_center and pa.visibility = 'public'
           order by pa.created_at desc limit 12) a;

  if v_store_on then
    select coalesce(jsonb_agg(s.name order by s.name), '[]'::jsonb) into v_store_items
      from (select si.name from app.store_items si where si.center_id = p_center and si.status = 'active' order by si.name limit 8) s;
  end if;

  if v_school_on then
    select coalesce(jsonb_agg(lv.name order by lv.sort_order, lv.name), '[]'::jsonb) into v_levels
      from (select pl.name, pl.sort_order from app.pathshala_levels pl where pl.center_id = p_center and pl.active order by pl.sort_order, pl.name limit 12) lv;
    select jsonb_build_object('name', pt.name, 'starts_on', pt.starts_on, 'ends_on', pt.ends_on, 'status', pt.status)
      into v_term
      from app.pathshala_terms pt
     where pt.center_id = p_center and pt.status in ('registration', 'active')
     order by pt.starts_on desc limit 1;
  end if;

  return jsonb_build_object(
    'center', jsonb_build_object('name', v_center.name, 'short_name', v_center.short_name, 'time_zone', v_center.time_zone),
    'profile', jsonb_build_object(
        'mission', v_prof.mission, 'about', v_prof.about, 'public_email', v_prof.public_email::text, 'public_phone', v_prof.public_phone,
        'office_hours', v_prof.office_hours, 'address', v_address, 'latitude', v_prof.latitude, 'longitude', v_prof.longitude,
        'social', coalesce(v_prof.social, '{}'::jsonb)),
    'leaders', v_leaders,
    'events', jsonb_build_object('on', v_events_on, 'items', v_events),
    'giving', jsonb_build_object('on', v_giving_on, 'campaigns', v_campaigns),
    'today', v_today,
    'albums', v_albums,
    'store', jsonb_build_object('on', v_store_on, 'items', v_store_items),
    'school', jsonb_build_object('on', v_school_on and (jsonb_array_length(v_levels) > 0 or v_term is not null), 'levels', v_levels, 'term', v_term));
end $$;

-- ── 3. CommunityConnect: the WhatsApp Business functions ────────────────────
-- app.send_test_message (latest body: 0221)
create or replace function app.send_test_message(p_center uuid, p_channel text, p_to text default null) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare u auth.users; v_to text; v_id uuid;
begin
  if not (app.messaging_can_manage(p_center) or app.has_permission(p_center, 'comms.send')) then
    raise exception 'Sending a test needs settings.manage, integrations.manage or comms.send.' using errcode = 'insufficient_privilege';
  end if;
  -- 0751: WhatsApp Business messages are CommunityConnect (module `channels`), which needs Communications.
  if p_channel = 'whatsapp' then
    perform app.assert_module_enabled(p_center, 'comms');
    perform app.assert_module_enabled(p_center, 'channels');
  end if;
  select * into u from auth.users where id = auth.uid();
  v_to := nullif(btrim(coalesce(p_to, '')), '');
  if v_to is null then
    v_to := case p_channel
      when 'email' then u.email
      when 'push' then u.id::text
      else case when u.phone_confirmed_at is not null then u.phone end end;
    if v_to is null then
      raise exception 'Your sign-in has no verified mobile number. Add one in Settings › Security, or type a number to send to.' using errcode = '22023';
    end if;
  end if;
  perform app.set_audit_context('Test ' || p_channel || ' message from Settings');
  v_id := app.enqueue_message(p_center, p_channel, v_to, 'test_message', '{}'::jsonb, 'test');
  insert into app.messaging_settings (center_id, last_test_at, last_test_channel, last_test_status, updated_by)
  values (p_center, now(), p_channel, (select status from app.messages where id = v_id), auth.uid())
  on conflict (center_id) do update set last_test_at = excluded.last_test_at, last_test_channel = excluded.last_test_channel,
    last_test_status = excluded.last_test_status, updated_by = excluded.updated_by, updated_at = now();
  return v_id;
end $$;

-- app.save_whatsapp_account (latest body: 0222)
create or replace function app.save_whatsapp_account(p_center uuid, p_waba_id text, p_phone_number_id text, p_display_name text,
                                                     p_phone text, p_reason text) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_phone text := app.normalize_recipient('whatsapp', p_phone); v_id uuid; a app.whatsapp_accounts;
begin
  perform app.assert_module_enabled(p_center, 'comms');
  -- 0751: the WhatsApp Business account and its templates are CommunityConnect (module `channels`).
  perform app.assert_module_enabled(p_center, 'channels');
  perform app._messaging_require(p_center, p_reason, 'Changing the WhatsApp Business account');
  if nullif(btrim(coalesce(p_display_name, '')), '') is null then raise exception 'Enter the display name Meta should approve.' using errcode = '22023'; end if;
  if v_phone is null or v_phone !~ '^\+\d{8,15}$' then
    raise exception 'Enter the WhatsApp number in the international form, for example +1 713 555 0100.' using errcode = '22023';
  end if;
  select * into a from app.whatsapp_accounts where center_id = p_center;
  if a.status = 'approved' and (a.detail->>'phone_e164' is distinct from v_phone or a.display_name is distinct from btrim(p_display_name)) then
    raise exception 'The approved number and display name cannot be changed here; Meta must review a change. Ask Community Connect.' using errcode = '22023';
  end if;
  perform app.set_audit_context(p_reason);
  insert into app.whatsapp_accounts (center_id, waba_id, phone_number_id, display_name, status, detail, updated_by)
  values (p_center, nullif(btrim(coalesce(p_waba_id, '')), ''), nullif(btrim(coalesce(p_phone_number_id, '')), ''), btrim(p_display_name),
          'pending_meta', jsonb_build_object('phone_e164', v_phone, 'submitted_at', now()), auth.uid())
  on conflict (center_id) do update set waba_id = excluded.waba_id, phone_number_id = excluded.phone_number_id,
    display_name = excluded.display_name,
    status = case when app.whatsapp_accounts.status = 'approved' then 'approved' else 'pending_meta' end,
    detail = app.whatsapp_accounts.detail || excluded.detail, updated_by = excluded.updated_by, updated_at = now()
  returning id into v_id;
  insert into app.integration_connections (center_id, provider, status, display_name, settings)
  values (p_center, 'whatsapp', 'disconnected', 'WhatsApp Business · ' || btrim(p_display_name),
          jsonb_build_object('mode', case when (select environment from app.centers where id = p_center) = 'sandbox' then 'test' else 'live' end))
  on conflict (center_id, provider) do update set display_name = excluded.display_name;
  perform app._messaging_setup_step(p_center, 'svc.whatsapp', 'waiting_on_provider', 'Waiting for Meta to approve the number and display name.');
  return v_id;
end $$;

-- app.submit_whatsapp_template (latest body: 0222)
create or replace function app.submit_whatsapp_template(p_center uuid, p_name text, p_language text, p_category text,
                                                        p_body text, p_reason text) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_name text := lower(regexp_replace(btrim(coalesce(p_name, '')), '[^A-Za-z0-9]+', '_', 'g')); v_id uuid;
begin
  perform app.assert_module_enabled(p_center, 'comms');
  -- 0751: the WhatsApp Business account and its templates are CommunityConnect (module `channels`).
  perform app.assert_module_enabled(p_center, 'channels');
  perform app._messaging_require(p_center, p_reason, 'Submitting a WhatsApp template');
  if v_name = '' then raise exception 'Name the template (letters, digits and underscores).' using errcode = '22023'; end if;
  if p_category not in ('utility','marketing','authentication') then raise exception 'Choose utility, marketing or authentication.' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_body, '')), '') is null then raise exception 'Write the template text.' using errcode = '22023'; end if;
  if not exists (select 1 from app.whatsapp_accounts where center_id = p_center) then
    raise exception 'Add the WhatsApp Business account first.' using errcode = '22023';
  end if;
  if exists (select 1 from app.whatsapp_template_submissions where center_id = p_center and name = v_name
               and language = coalesce(nullif(btrim(p_language), ''), 'en') and status <> 'rejected') then
    raise exception 'A template called % is already submitted in that language.', v_name using errcode = '23505';
  end if;
  perform app.set_audit_context(p_reason);
  insert into app.whatsapp_template_submissions (center_id, name, language, category, body, status, submitted_by)
  values (p_center, v_name, coalesce(nullif(btrim(p_language), ''), 'en'), p_category, btrim(p_body), 'pending_meta', auth.uid())
  on conflict (center_id, name, language) do update set category = excluded.category, body = excluded.body, status = 'pending_meta',
    rejection_reason = null, decided_at = null, submitted_by = excluded.submitted_by, submitted_at = now()
  returning id into v_id;
  return v_id;
end $$;

-- ── 4. Send time: a WhatsApp message needs CommunityConnect ───────────────────
-- app.worker_message_to_send (latest body: 0598)
create or replace function app.worker_message_to_send(p_message uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare m app.messages; st app.messaging_settings; v_secret jsonb; v_rendered jsonb; v_skip text; s app.message_suppressions;
        v_provider text; v_conn app.integration_connections; v_route jsonb := '{}'::jsonb; v_tokens jsonb; w app.whatsapp_accounts; v_dead text;
        v_tz text; v_topic text; v_on boolean; v_trigger text; v_switch text; v_survey uuid; v_rsvp text;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  select * into m from app.messages where id = p_message;
  if not found then raise exception 'Message % was not found.', p_message; end if;
  if m.status <> 'queued' then v_skip := 'The message is already ' || m.status || '.'; end if;

  -- 0596: a notice that is no longer useful (the lunch slot started, the survey or the boli closed) is cancelled, not
  -- sent late. The skip starts "The message is already", so the sender records nothing over it.
  if v_skip is null and m.expires_at is not null and m.expires_at <= now() then
    select c.time_zone into v_tz from app.centers c where c.id = m.center_id;
    perform app.set_audit_context('Not sent: it expired before it was due');
    update app.messages
       set status = 'cancelled',
           failure_reason = 'Not sent: it was no longer useful by the time it was due (it expired on ' ||
                            to_char(m.expires_at at time zone coalesce(v_tz, 'UTC'), 'FMMonth FMDD, YYYY "at" FMHH12:MI AM') || ').'
     where id = m.id and status = 'queued';
    m.status := 'cancelled';
    v_skip := 'The message is already cancelled: it expired before it was due.';
  end if;

  -- 0596: the member switched this topic off for this channel in the app (no row = the topic's default). 0598: not for a
  -- service notice (a member's own order): only the community's switch below holds that back.
  if v_skip is null and m.topic_key is not null and m.person_id is not null and not app.notice_is_service(m.template_key) then
    select app._notice_topic_on(m.person_id, t.key, m.channel::text), t.name
      into v_on, v_topic
      from app.notification_topics t
     where t.key = m.topic_key;
    if v_on is false then
      v_skip := 'Not sent: the member switched off "' || coalesce(v_topic, m.topic_key) || '" ' ||
                case m.channel::text when 'sms' then 'text' when 'whatsapp' then 'WhatsApp' else m.channel::text end ||
                ' notifications in the app.';
    end if;
  end if;

  -- 0598: the community switched this kind of notice off in Settings › Notifications after it was queued.
  v_trigger := app.notice_trigger(m.template_key);
  if v_skip is null and v_trigger is not null and m.center_id is not null then
    select c.rules #>> array['notifications', 'triggers', v_trigger] into v_switch from app.centers c where c.id = m.center_id;
    if v_switch = 'false' then
      v_skip := 'Not sent: the community switched this notice off in Settings › Notifications after it was queued.';
    end if;
  end if;

  -- 0598: a survey push or reminder for someone who has answered since it was queued.
  if v_skip is null and m.template_key in ('event_survey', 'event_survey_reminder') and m.person_id is not null
     and (m.payload->>'survey_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_survey := (m.payload->>'survey_id')::uuid;
    if exists (select 1 from app.survey_completions sc where sc.survey_id = v_survey and sc.person_id = m.person_id) then
      v_skip := 'Not sent: they have already answered the survey.';
    end if;
  end if;

  -- 0598: an RSVP confirmation for an RSVP that was confirmed or cancelled since it was queued.
  if v_skip is null and m.template_key = 'rsvp_confirmation' and (m.payload->>'rsvp_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select r.status::text into v_rsvp from app.rsvps r where r.id = (m.payload->>'rsvp_id')::uuid;
    if v_rsvp is distinct from 'rsvpd' then
      v_skip := 'Not sent: the RSVP is no longer waiting to be confirmed.';
    end if;
  end if;

  -- Re-checked at send time: a suppression or a sandbox allow-list change since it was queued.
  if v_skip is null and m.channel::text <> 'push' and not coalesce((m.payload->>'keyword_reply')::boolean, false) then
    s := app.message_suppression_for(m.center_id, m.channel::text, m.to_address);
    if s.id is not null then v_skip := 'Not sent: ' || m.to_address || ' was suppressed (' || s.reason || ') after it was queued.'; end if;
  end if;
  if v_skip is null and m.channel::text <> 'push' and m.purpose in ('notification','campaign')
     and not coalesce((m.payload->>'keyword_reply')::boolean, false) then
    s := app.message_newsletter_suppression_for(m.center_id, m.channel::text, m.to_address);
    if s.id is not null then v_skip := 'Not sent: ' || m.to_address || ' unsubscribed from newsletters after it was queued.'; end if;
  end if;
  if v_skip is null and not coalesce((m.payload->>'keyword_reply')::boolean, false) then
    v_dead := app.message_recipient_deceased(m.center_id, m.channel::text, m.to_address, m.person_id);
    if v_dead is not null then v_skip := 'Not sent: ' || v_dead || ' is recorded as deceased.'; end if;
  end if;
  -- A row with no purpose is re-checked too (0596: before, "null not in (...)" let it through).
  if v_skip is null and m.center_id is not null and not coalesce((m.payload->>'keyword_reply')::boolean, false)
     and coalesce(m.purpose, '') not in ('test','verification_code')
     and not app.messaging_recipient_ok(m.center_id, m.channel::text, m.to_address, m.purpose) then
    v_skip := 'Not sent: this community may message only verified test recipients now.';
  end if;
  -- 0751: a WhatsApp message is CommunityConnect (module `channels`), checked again at send time, so a message queued before
  -- the product was turned off or paused is not sent. It is recorded as not sent, with this reason, in the message log.
  if v_skip is null and m.channel = 'whatsapp' and m.center_id is not null and not app.module_enabled(m.center_id, 'channels') then
    v_skip := 'Not sent: WhatsApp messages are part of CommunityConnect, which is not on for this community.';
  end if;

  v_rendered := jsonb_build_object('subject', m.subject, 'body', m.body);
  if v_skip is null and m.payload ? 'secret_ref' then
    select decrypted_secret::jsonb into v_secret from vault.decrypted_secrets where id = (m.payload->>'secret_ref')::uuid;
    if v_secret is null or v_secret = '{}'::jsonb then
      v_skip := 'Not sent: the code in this message is no longer available (it was already sent or expired).';
    else
      v_rendered := app.message_render(m.center_id, m.channel::text, m.template_key, coalesce(m.payload->'vars', '{}'::jsonb) || v_secret, m.sandbox);
    end if;
  end if;

  select * into st from app.messaging_settings where center_id = m.center_id;
  if m.channel = 'email' then
    v_provider := coalesce(st.email_provider, 'resend');
    select * into v_conn from app.integration_connections where center_id = m.center_id and provider = v_provider;
    v_route := jsonb_build_object('provider', v_provider, 'connection_id', v_conn.id,
                                  'sender', app._messaging_sender(m.center_id, m.purpose),
                                  'footer', jsonb_build_object('postal_address', st.footer_postal_address, 'note', st.footer_note),
                                  'unsubscribe', m.purpose in ('notification','campaign'));
  elsif m.channel = 'sms' then
    select * into v_conn from app.integration_connections where center_id = m.center_id and provider = 'twilio';
    v_route := jsonb_build_object('provider', 'twilio', 'connection_id', v_conn.id, 'connected', v_conn.status = 'connected',
                                  'from_number', v_conn.settings->>'from_number', 'messaging_service_sid', v_conn.settings->>'messaging_service_sid');
  elsif m.channel = 'whatsapp' then
    select * into w from app.whatsapp_accounts where center_id = m.center_id;
    v_route := jsonb_build_object('provider', 'twilio', 'approved', w.status = 'approved', 'status', coalesce(w.status, 'not_started'),
                                  'from_number', w.detail->>'phone_e164');
  else
    select coalesce(jsonb_agg(d.token order by d.last_seen_at desc), '[]'::jsonb) into v_tokens
      from app.push_devices d where d.user_id = m.to_address::uuid and d.invalid_at is null;
    v_route := jsonb_build_object('provider', 'expo_push', 'tokens', v_tokens);
  end if;

  return jsonb_build_object(
    'id', m.id, 'center_id', m.center_id, 'channel', m.channel, 'to', m.to_address, 'purpose', m.purpose,
    'template_key', m.template_key, 'subject', v_rendered->>'subject', 'body', v_rendered->>'body',
    'sandbox', m.sandbox, 'status', m.status, 'skip', v_skip, 'payload', m.payload - 'secret_ref' - 'vars',
    'brand', app._messaging_brand(m.center_id), 'route', v_route);
end $$;
