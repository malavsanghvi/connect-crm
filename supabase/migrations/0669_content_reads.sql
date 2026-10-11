-- 0669: Content reads (BACKLOG B90 phase 4, Content). No table, column or policy changes: two read-only SQL functions that answer, in
-- one call, what the Content commands (and so Niva) would otherwise add up by reading many rows.
--
--   app.content_queue_summary(center, limit)       what waits in the approval queue: how many, by kind, how old, the oldest items, and
--                                                  the member photos waiting (counts only)
--   app.content_library_summary(center, stale_days) Niva's sources by status, the imported web pages that changed or disappeared since
--                                                  they were imported, and the media library by kind and status
--
-- Both are SECURITY INVOKER: they read the same tables the Content screens read, as the person asking, so row-level security decides
-- what comes back. A person who holds neither content.draft nor content.manage (the two that can read these rows) gets null (the command layer says "You don't have access
-- to this area"), never zeros. Nothing here writes.
--
-- WHAT THEY NEVER RETURN
--   * The text of an item (the approver reads it in the confirmation card, from the item itself), a photo's file path, caption or
--     uploader. Photos come back as counts only; the title of an album that has a photo of a child in it is left out, so a model
--     reading this answer can never describe such a photo (decision D2).
--
-- THE WORDS
--   "waiting" = status 'in_review'; the time it has waited is counted from updated_at, as the queue screen does (any edit moves it).
--   A "stale page" = a web page Niva imported (metadata.imported = true) whose sections say the page changed (metadata.page_changed)
--   or that the page no longer has (metadata.orphaned), as migration 0576 sets them. A retired section is not counted.
-- Hosted Supabase: search_path = app, public, extensions.
set client_min_messages = warning;

-- ── The approval queue ─────────────────────────────────────────────────────────────────────────────────
create or replace function app.content_queue_summary(p_center uuid, p_limit integer default 20) returns jsonb
language plpgsql stable security invoker set search_path = app, public, extensions as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_total integer;
  v_oldest timestamptz;
  v_by_kind jsonb;
  v_items jsonb;
  v_photos jsonb := null;
begin
  if p_center is null then return null; end if;
  -- Row-level security lets only content.draft (draft and waiting items) and content.manage (everything) read these rows; content.view
  -- alone reads published guide pages and FAQ, nothing of the queue or the library, so it would see zeros that are not true.
  if not (app.has_permission(p_center, 'content.draft') or app.has_permission(p_center, 'content.manage')) then
    return null;
  end if;

  select count(*), min(c.updated_at) into v_total, v_oldest
    from app.content_items c
   where c.center_id = p_center and c.status = 'in_review';

  select coalesce(jsonb_agg(jsonb_build_object('kind', k.kind, 'n', k.n, 'oldest_at', k.oldest) order by k.oldest, k.kind), '[]'::jsonb)
    into v_by_kind
    from (select c.kind, count(*) as n, min(c.updated_at) as oldest
            from app.content_items c
           where c.center_id = p_center and c.status = 'in_review'
           group by c.kind) k;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', w.id,
           'title', w.title,
           'kind', w.kind,
           'waiting_since', w.updated_at,
           'created_by', w.created_by,
           'page_url', case when w.kind = 'niva_source' and w.metadata->>'imported' = 'true' then w.metadata->>'source_url' end,
           'page_title', case when w.kind = 'niva_source' and w.metadata->>'imported' = 'true' then w.metadata->>'page_title' end
         ) order by w.updated_at, w.id), '[]'::jsonb)
    into v_items
    from (select c.id, c.title, c.kind, c.updated_at, c.created_by, c.metadata
            from app.content_items c
           where c.center_id = p_center and c.status = 'in_review'
           order by c.updated_at, c.id
           limit v_limit) w;

  -- Member photos wait for a content manager (the same people who may moderate them on the screen). Counts only.
  if app.has_permission(p_center, 'content.manage') then
    select jsonb_build_object(
             'photos', coalesce(sum(a.n), 0),
             'albums', count(*),
             'with_children', coalesce(sum(a.kids), 0),
             'oldest_at', min(a.oldest),
             'by_album', coalesce(jsonb_agg(jsonb_build_object(
                           'album_id', a.album_id,
                           'title', case when a.kids > 0 then null else a.title end,
                           'waiting', a.n,
                           'has_children', a.kids > 0) order by a.oldest, a.album_id), '[]'::jsonb))
      into v_photos
      from (select p.album_id, al.title, count(*) as n,
                   count(*) filter (where p.contains_children) as kids,
                   min(p.created_at) as oldest
              from app.photos p
              left join app.photo_albums al on al.id = p.album_id
             where p.center_id = p_center and p.status = 'pending'
             group by p.album_id, al.title) a;
  end if;

  return jsonb_build_object(
    'total', v_total,
    'oldest_at', v_oldest,
    'by_kind', v_by_kind,
    'items', v_items,
    'shown', jsonb_array_length(v_items),
    'photos', v_photos,
    'can_see_photos', v_photos is not null);
end $$;

-- ── Niva's sources, stale pages and the media library ──────────────────────────────────────────────────────
create or replace function app.content_library_summary(p_center uuid, p_stale_days integer default 180) returns jsonb
language plpgsql stable security invoker set search_path = app, public, extensions as $$
declare
  v_days integer := least(greatest(coalesce(p_stale_days, 180), 1), 3650);
  v_by_status jsonb;
  v_imported integer;
  v_stale_total integer;
  v_stale jsonb;
  v_old integer;
  v_media jsonb;
begin
  if p_center is null then return null; end if;
  -- Row-level security lets only content.draft (draft and waiting items) and content.manage (everything) read these rows; content.view
  -- alone reads published guide pages and FAQ, nothing of the queue or the library, so it would see zeros that are not true.
  if not (app.has_permission(p_center, 'content.draft') or app.has_permission(p_center, 'content.manage')) then
    return null;
  end if;

  select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb) into v_by_status
    from (select c.status, count(*) as n
            from app.content_items c
           where c.center_id = p_center and c.kind = 'niva_source'
           group by c.status) s;

  select count(distinct c.metadata->>'source_url') into v_imported
    from app.content_items c
   where c.center_id = p_center and c.kind = 'niva_source' and c.status <> 'retired'
     and c.metadata->>'imported' = 'true' and c.metadata ? 'source_url';

  with g as (
    select c.metadata->>'source_url' as url,
           max(c.metadata->>'page_title') as title,
           count(*) as sections,
           count(*) filter (where c.metadata->>'page_changed' = 'true') as changed,
           count(*) filter (where c.metadata->>'orphaned' = 'true') as orphaned,
           max(c.updated_at) as last_edited_at
      from app.content_items c
     where c.center_id = p_center and c.kind = 'niva_source' and c.status <> 'retired'
       and c.metadata->>'imported' = 'true' and c.metadata ? 'source_url'
     group by c.metadata->>'source_url'
    having count(*) filter (where c.metadata->>'page_changed' = 'true') > 0
        or count(*) filter (where c.metadata->>'orphaned' = 'true') > 0
  )
  select (select count(*) from g),
         coalesce((select jsonb_agg(jsonb_build_object(
                          'url', x.url, 'title', x.title, 'sections', x.sections, 'changed', x.changed,
                          'orphaned', x.orphaned, 'last_edited_at', x.last_edited_at) order by x.last_edited_at, x.url)
                     from (select * from g order by last_edited_at, url limit 20) x), '[]'::jsonb)
    into v_stale_total, v_stale;

  select count(*) into v_old
    from app.content_items c
   where c.center_id = p_center and c.kind = 'niva_source' and c.status = 'published'
     and c.updated_at < now() - make_interval(days => v_days);

  select coalesce(jsonb_object_agg(m.kind, m.s), '{}'::jsonb) into v_media
    from (select t.kind, jsonb_object_agg(t.status, t.n) as s
            from (select c.kind, c.status, count(*) as n
                    from app.content_items c
                   where c.center_id = p_center and c.kind in ('stavan', 'video', 'podcast', 'recipe')
                   group by c.kind, c.status) t
           group by t.kind) m;

  return jsonb_build_object(
    'niva', jsonb_build_object(
      'by_status', v_by_status,
      'imported_pages', v_imported,
      'stale_pages_total', v_stale_total,
      'stale_pages', v_stale,
      'published_not_edited_for_days', v_days,
      'published_not_edited', v_old),
    'media', v_media);
end $$;

revoke execute on function app.content_queue_summary(uuid, integer), app.content_library_summary(uuid, integer) from public, anon;
grant execute on function app.content_queue_summary(uuid, integer), app.content_library_summary(uuid, integer) to authenticated, service_role;

comment on function app.content_queue_summary(uuid, integer) is
  'What waits in the Content approval queue: the number, the kinds, the age, the oldest items and the member photos waiting (counts only, nothing about a photo). Security invoker; null for someone with no content permission (0669).';
comment on function app.content_library_summary(uuid, integer) is
  'Niva''s sources by status, the imported web pages that changed since the import, and the media library by kind and status. Counts, no text. Security invoker; null for someone with no content permission (0669).';
