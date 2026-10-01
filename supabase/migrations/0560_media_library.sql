-- 0560: the media library behind the member app's 3L (Look, Listen, Learn): stavans, videos, podcasts and
-- recipes, with each member's likes and one playlist per member (owner request, 2026-09-30).
--
--   content_items.kind      gains stavan, podcast and recipe (video was already a kind). A link (media_url) on
--                           any of the four media kinds must be https:// — new and changed rows; NOT VALID leaves
--                           older rows alone, as 0511 did for live darshan.
--   content bucket          also accepts .m4a sent as audio/x-m4a, audio/mp3 and .mov (video/quicktime). The
--                           50 MB limit stays: a longer video goes on YouTube and the item links to it.
--   content_items.metadata  the conventions for media are written on the column (comment below).
--   app.media_likes         who likes which item          one row per person and item
--   app.media_playlist_items  each person's playlist      one playlist per person, so no playlist table
--
-- Privacy. A like and a playlist are the member's own:
--   * a person reads only their own rows: not their parents, not the household's adults, not staff;
--   * nobody writes the two tables directly; the RPCs below write the caller's own rows only;
--   * staff see aggregates only (app.media_like_counts: how many, never who), with content.view or content.manage;
--   * children like and keep a playlist like anyone else (it is not money).
-- Both tables belong to the Content module (a restrictive module_switch policy, and every RPC refuses while the
-- module is off), are audited (record id "<person_id>:<item_id>"), and are cleared with the rest of a sandbox on a
-- demo reset (they are not on app.demo_keep_tables).
--
-- RPCs (security definer; the Content module on; the caller a member of the community; only PUBLISHED items of
-- that community or shared by every community, i.e. center_id is null). Every read returns a MediaRow:
--   id, kind, title, body_md, language, media_path, media_url, metadata, published_at,
--   like_count (how many members of this community like it), liked_by_me, in_my_playlist
-- An item shared by every community is liked and kept per community. The RPCs that name only an item take an
-- optional p_center for that case; left out, the caller's only community is used.
set client_min_messages = warning;

-- ── Kinds ─────────────────────────────────────────────────────────────────────
-- The old list (0007) plus the three new media kinds.
alter table app.content_items drop constraint if exists content_items_kind_check;
alter table app.content_items add constraint content_items_kind_check
  check (kind in ('sutra','pachchakhan','audio_lesson','video','guide_page','explainer','darshan_stream','niva_source','faq','other',
                  'stavan','podcast','recipe'));
comment on column app.content_items.kind is
  'sutra, pachchakhan, audio_lesson, video, guide_page, explainer, darshan_stream, niva_source, faq, other; and the media library kinds stavan, video, podcast, recipe (0560), which members can like, and (all but recipe) keep in My playlist.';

-- A link on a media item is https:// only (or none: the file is in media_path instead).
do $$ begin
  alter table app.content_items add constraint content_items_media_https
    check (kind not in ('stavan','video','podcast','recipe') or media_url is null or media_url ~* '^https://[^[:space:]]+$') not valid;
exception when duplicate_object then null;
end $$;

comment on column app.content_items.metadata is
  'Per-kind details. Media kinds (stavan, video, podcast, recipe; 0560): source = upload | youtube | link; duration_seconds int; '
  'artist (the stavan''s singer, the podcast''s speaker, the video''s presenter); aliases text[] (other spellings, e.g. Navkar / Navkaar) '
  'and tags text[], both searched by app.media_library; thumbnail_path (a content-bucket key); youtube_id. A stavan keeps its lyrics in '
  'body_md. Podcast: series, episode. Recipe: fully_jain boolean (no root vegetables, onion, garlic and the like), ingredients text[], '
  'servings int, prep_minutes int, cook_minutes int, photo_path (a content-bucket key); the method in body_md. An uploaded file is at '
  'media_path = <center_id>/media/<kind>/<uuid>-<safe-name>.<ext> in the content bucket (50 MB at most; a bigger video goes on '
  'YouTube); a YouTube or web link is media_url (https only). Other kinds: pachchakhan keeps its timing rules here, darshan_stream its '
  'source, schedule and stream_status, niva_source its import details.';

-- ── The content bucket takes the usual phone formats too ─────────────────────
-- 0172's list plus audio/x-m4a, audio/mp3 and video/quicktime; same size limit (50 MB).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('content', 'content', false, 52428800, array['image/png','image/jpeg','image/webp','image/gif','application/pdf',
                                                'audio/mpeg','audio/mp4','audio/aac','audio/ogg','audio/wav','audio/webm',
                                                'audio/x-m4a','audio/mp3',
                                                'video/mp4','video/webm','video/quicktime'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ── Likes ─────────────────────────────────────────────────────────────────────
-- center_id is the community of the person (for an item shared by every community, the community it was liked in).
create table if not exists app.media_likes (
  center_id  uuid not null references app.centers(id) on delete cascade,
  person_id  uuid not null references app.people(id) on delete cascade,
  item_id    uuid not null references app.content_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (person_id, item_id)
);
create index if not exists media_likes_item_idx on app.media_likes (item_id, center_id);
create index if not exists media_likes_center_idx on app.media_likes (center_id);
comment on table app.media_likes is
  'Media library likes (0560): one row per person and stavan, video, podcast or recipe. Read by the person only; written only by app.toggle_media_like; staff see counts (app.media_like_counts), never who.';

-- ── One playlist per person ──────────────────────────────────────────────────
create table if not exists app.media_playlist_items (
  center_id  uuid not null references app.centers(id) on delete cascade,
  person_id  uuid not null references app.people(id) on delete cascade,
  item_id    uuid not null references app.content_items(id) on delete cascade,
  position   integer not null check (position > 0),
  added_at   timestamptz not null default now(),
  primary key (person_id, item_id)
);
create index if not exists media_playlist_items_item_idx on app.media_playlist_items (item_id, center_id);
create index if not exists media_playlist_items_center_idx on app.media_playlist_items (center_id);
comment on table app.media_playlist_items is
  'My playlist (0560): a person''s stavans, videos and podcasts in their order (position). One playlist per person. Read by the person only; written only by app.add_to_playlist, app.remove_from_playlist and app.reorder_playlist; staff see counts, never who.';

-- ── Module, audit, access ────────────────────────────────────────────────────
insert into app.module_tables (table_name, module_key) values ('media_likes', 'content'), ('media_playlist_items', 'content')
  on conflict (table_name) do update set module_key = excluded.module_key;

drop trigger if exists audit_media_likes on app.media_likes;
create trigger audit_media_likes after insert or update or delete on app.media_likes
  for each row execute function app.audit_row('person_id', 'item_id');
drop trigger if exists audit_media_playlist_items on app.media_playlist_items;
create trigger audit_media_playlist_items after insert or update or delete on app.media_playlist_items
  for each row execute function app.audit_row('person_id', 'item_id');

alter table app.media_likes enable row level security;
alter table app.media_playlist_items enable row level security;

-- Own rows only. No policy for parents, household adults or staff, and no write policy (the RPCs write).
drop policy if exists media_likes_own on app.media_likes;
create policy media_likes_own on app.media_likes for select to authenticated
  using (person_id = app.my_person_id(center_id));
drop policy if exists media_playlist_items_own on app.media_playlist_items;
create policy media_playlist_items_own on app.media_playlist_items for select to authenticated
  using (person_id = app.my_person_id(center_id));

drop policy if exists module_switch on app.media_likes;
create policy module_switch on app.media_likes as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('content'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('content'))::uuid[])));
drop policy if exists module_switch on app.media_playlist_items;
create policy module_switch on app.media_playlist_items as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('content'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('content'))::uuid[])));

revoke all on app.media_likes, app.media_playlist_items from public, anon, authenticated, connect_worker;
grant select on app.media_likes, app.media_playlist_items to authenticated;
grant all on app.media_likes, app.media_playlist_items to service_role;

-- ── Shared checks (internal: not callable over the API) ──────────────────────
-- A community's library: the community exists, the caller is a member, the Content module is on there.
create or replace function app.media_check_center(p_center uuid) returns void
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then
    raise exception 'That community was not found.';
  end if;
  if not app.is_member_of(p_center) then
    raise exception 'Only members of this community can use its library.' using errcode = 'insufficient_privilege';
  end if;
  perform app.assert_module_enabled(p_center, 'content');
end $$;

-- One item: it exists, is a media kind, is published (p_published_only false: taking an item off your playlist
-- works whatever became of it), belongs to the community or is shared by every community, and the caller is a
-- member there with the Content module on. Returns the community the caller's like or playlist row belongs to:
-- the item's own, else p_center, else the caller's only community. Anything the caller may not see reads as
-- "not found", so an item of another community is never confirmed to exist.
create or replace function app.media_item_center(p_item uuid, p_center uuid, p_published_only boolean default true) returns uuid
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.content_items; v_center uuid; v_n int;
begin
  select * into c from app.content_items where id = p_item;
  if c.id is null or c.kind <> all (array['stavan','video','podcast','recipe'])
     or (coalesce(p_published_only, true) and c.status <> 'published')
     or (c.center_id is not null and p_center is not null and c.center_id <> p_center) then
    raise exception 'That item was not found in the library.';
  end if;
  v_center := coalesce(c.center_id, p_center);
  if v_center is null then
    select count(*)::int, (array_agg(cu.center_id))[1] into v_n, v_center from app.center_users cu where cu.user_id = auth.uid();
    if v_n > 1 then
      raise exception 'You belong to more than one community. Open the library from the community you want and try again.';
    end if;
  end if;
  if v_center is null or not app.is_member_of(v_center) then
    raise exception 'That item was not found in the library.';
  end if;
  perform app.assert_module_enabled(v_center, 'content');
  return v_center;
end $$;

-- The MediaRow of every published media item of a community and the shared ones, as one person sees them.
-- like_count counts this community's members only (an item shared by every community has a count per community).
create or replace function app.media_rows(p_center uuid, p_person uuid, p_kinds text[], p_items uuid[] default null)
returns table (id uuid, kind text, title text, body_md text, language text, media_path text, media_url text, metadata jsonb,
               published_at timestamptz, like_count int, liked_by_me boolean, in_my_playlist boolean)
language sql stable security definer set search_path = app, public, extensions as $$
  select c.id, c.kind, c.title, c.body_md, c.language, c.media_path, c.media_url, c.metadata, c.published_at,
         (select count(*)::int from app.media_likes l where l.item_id = c.id and l.center_id = p_center),
         p_person is not null and exists (select 1 from app.media_likes l where l.item_id = c.id and l.person_id = p_person),
         p_person is not null and exists (select 1 from app.media_playlist_items i where i.item_id = c.id and i.person_id = p_person)
    from app.content_items c
   where c.status = 'published'
     and (c.center_id = p_center or c.center_id is null)
     and c.kind = any (p_kinds)
     and (p_items is null or c.id = any (p_items))
$$;

-- ── Reading the library ──────────────────────────────────────────────────────
-- p_kinds: any of stavan, video, podcast, recipe (null or empty: all four). p_query: a case-insensitive part of
-- the title, the artist, an alias or a tag. p_sort: title | liked (most liked first, then newest) | recent.
create or replace function app.media_library(p_center uuid, p_kinds text[], p_query text default null,
                                             p_sort text default 'title', p_limit int default 100)
returns table (id uuid, kind text, title text, body_md text, language text, media_path text, media_url text, metadata jsonb,
               published_at timestamptz, like_count int, liked_by_me boolean, in_my_playlist boolean)
language plpgsql stable security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
declare v_kinds text[]; v_bad text; v_sort text; v_q text; v_pat text;
        v_limit int := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  perform app.media_check_center(p_center);
  v_kinds := case when p_kinds is null or cardinality(p_kinds) = 0 then array['stavan','video','podcast','recipe'] else p_kinds end;
  select k into v_bad from unnest(v_kinds) as k where k is null or k <> all (array['stavan','video','podcast','recipe']) limit 1;
  if found then
    raise exception 'The library has stavans, videos, podcasts and recipes; "%" is not one of them.', coalesce(v_bad, '');
  end if;
  v_sort := lower(coalesce(nullif(btrim(p_sort), ''), 'title'));
  if v_sort not in ('title', 'liked', 'recent') then
    raise exception 'Sort the library by title, liked or recent (not "%").', p_sort;
  end if;
  v_q := nullif(btrim(coalesce(p_query, '')), '');
  if v_q is not null then
    -- A typed % or _ is a character to find, not a wildcard.
    v_pat := '%' || replace(replace(replace(left(v_q, 200), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  return query
  select r.id, r.kind, r.title, r.body_md, r.language, r.media_path, r.media_url, r.metadata, r.published_at,
         r.like_count, r.liked_by_me, r.in_my_playlist
    from app.media_rows(p_center, app.my_person_id(p_center), v_kinds) r
   where v_pat is null
      or r.title ilike v_pat
      or coalesce(r.metadata->>'artist', '') ilike v_pat
      or exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(r.metadata->'aliases') = 'array'
                                                              then r.metadata->'aliases' else '[]'::jsonb end) as a(v)
                  where a.v ilike v_pat)
      or exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(r.metadata->'tags') = 'array'
                                                              then r.metadata->'tags' else '[]'::jsonb end) as t(v)
                  where t.v ilike v_pat)
   order by case when v_sort = 'liked' then r.like_count end desc nulls last,
            case when v_sort in ('liked', 'recent') then r.published_at end desc nulls last,
            lower(r.title), r.id
   limit v_limit;
end $$;

-- One item for a detail screen (one row; an error when the caller may not see it).
create or replace function app.media_item(p_item uuid, p_center uuid default null)
returns table (id uuid, kind text, title text, body_md text, language text, media_path text, media_url text, metadata jsonb,
               published_at timestamptz, like_count int, liked_by_me boolean, in_my_playlist boolean)
language plpgsql stable security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
declare v_center uuid;
begin
  v_center := app.media_item_center(p_item, p_center);
  return query
  select r.id, r.kind, r.title, r.body_md, r.language, r.media_path, r.media_url, r.metadata, r.published_at,
         r.like_count, r.liked_by_me, r.in_my_playlist
    from app.media_rows(v_center, app.my_person_id(v_center), array['stavan','video','podcast','recipe'], array[p_item]) r;
end $$;

-- A random item of one kind (or none when the library has none). p_fully_jain true: only recipes marked fully
-- Jain (metadata.fully_jain); null or false: any.
create or replace function app.random_media(p_center uuid, p_kind text, p_fully_jain boolean default null)
returns table (id uuid, kind text, title text, body_md text, language text, media_path text, media_url text, metadata jsonb,
               published_at timestamptz, like_count int, liked_by_me boolean, in_my_playlist boolean)
language plpgsql security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
begin
  perform app.media_check_center(p_center);
  if p_kind is null or p_kind <> all (array['stavan','video','podcast','recipe']) then
    raise exception 'Choose a stavan, video, podcast or recipe (not "%").', coalesce(p_kind, '');
  end if;
  return query
  select r.id, r.kind, r.title, r.body_md, r.language, r.media_path, r.media_url, r.metadata, r.published_at,
         r.like_count, r.liked_by_me, r.in_my_playlist
    from app.media_rows(p_center, app.my_person_id(p_center), array[p_kind]) r
   where p_fully_jain is not true or (r.kind = 'recipe' and r.metadata->>'fully_jain' = 'true')
   order by random()
   limit 1;
end $$;

-- ── Likes ─────────────────────────────────────────────────────────────────────
-- Like or unlike; returns the new state (true = liked). Any member, children included.
create or replace function app.toggle_media_like(p_item uuid, p_center uuid default null) returns boolean
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid; v_person uuid;
begin
  v_center := app.media_item_center(p_item, p_center);
  v_person := app.my_person_id(v_center);
  if v_person is null then raise exception 'We could not tell who you are. Sign in again.'; end if;
  delete from app.media_likes where person_id = v_person and item_id = p_item;
  if found then return false; end if;
  insert into app.media_likes (center_id, person_id, item_id) values (v_center, v_person, p_item)
  on conflict (person_id, item_id) do nothing;
  return true;
end $$;

-- Staff: how many members like each item and keep it in their playlist. Counts only, never who. Items nobody
-- likes or keeps are left out (read them as 0).
create or replace function app.media_like_counts(p_center uuid)
returns table (item_id uuid, like_count int, playlist_count int)
language plpgsql stable security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
begin
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then
    raise exception 'That community was not found.';
  end if;
  if not (app.has_permission(p_center, 'content.view') or app.has_permission(p_center, 'content.manage')) then
    raise exception 'Like and playlist counts need the content.view or content.manage permission.' using errcode = 'insufficient_privilege';
  end if;
  perform app.assert_module_enabled(p_center, 'content');
  return query
  with l as (select x.item_id as iid, count(*)::int as n from app.media_likes x where x.center_id = p_center group by x.item_id),
       p as (select y.item_id as iid, count(*)::int as n from app.media_playlist_items y where y.center_id = p_center group by y.item_id)
  select coalesce(l.iid, p.iid), coalesce(l.n, 0), coalesce(p.n, 0)
    from l full join p on p.iid = l.iid
   order by 2 desc, 3 desc, 1;
end $$;

-- ── My playlist ───────────────────────────────────────────────────────────────
-- In the member's order. Items no longer published drop out of the list (and come back if published again).
create or replace function app.my_playlist(p_center uuid)
returns table (id uuid, kind text, title text, body_md text, language text, media_path text, media_url text, metadata jsonb,
               published_at timestamptz, like_count int, liked_by_me boolean, in_my_playlist boolean, "position" int)
language plpgsql stable security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
declare v_person uuid;
begin
  perform app.media_check_center(p_center);
  v_person := app.my_person_id(p_center);
  if v_person is null then return; end if;
  return query
  select r.id, r.kind, r.title, r.body_md, r.language, r.media_path, r.media_url, r.metadata, r.published_at,
         r.like_count, r.liked_by_me, r.in_my_playlist, pi.position
    from app.media_playlist_items pi
    join app.media_rows(p_center, v_person, array['stavan','video','podcast'],
                        array(select x.item_id from app.media_playlist_items x where x.person_id = v_person)) r on r.id = pi.item_id
   where pi.person_id = v_person
   order by pi.position, pi.added_at, pi.item_id;
end $$;

-- Add to the end of My playlist. Adding an item that is already there changes nothing.
create or replace function app.add_to_playlist(p_item uuid, p_center uuid default null) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid; v_person uuid; v_kind text;
begin
  v_center := app.media_item_center(p_item, p_center);
  select c.kind into v_kind from app.content_items c where c.id = p_item;
  if v_kind not in ('stavan','video','podcast') then
    raise exception 'Only stavans, videos and podcasts can go in My playlist.';
  end if;
  v_person := app.my_person_id(v_center);
  if v_person is null then raise exception 'We could not tell who you are. Sign in again.'; end if;
  -- One change to a person's playlist at a time, so two quick taps never get the same place.
  perform pg_advisory_xact_lock(hashtextextended('app.media_playlist_items:' || v_person::text, 0));
  insert into app.media_playlist_items (center_id, person_id, item_id, position)
  values (v_center, v_person, p_item,
          coalesce((select max(x.position) from app.media_playlist_items x where x.person_id = v_person), 0) + 1)
  on conflict (person_id, item_id) do nothing;
end $$;

-- Take an item off My playlist (nothing happens when it is not there). Works for an item that is no longer published.
create or replace function app.remove_from_playlist(p_item uuid, p_center uuid default null) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid; v_person uuid;
begin
  v_center := app.media_item_center(p_item, p_center, false);
  v_person := app.my_person_id(v_center);
  if v_person is null then raise exception 'We could not tell who you are. Sign in again.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('app.media_playlist_items:' || v_person::text, 0));
  delete from app.media_playlist_items where person_id = v_person and item_id = p_item;
end $$;

-- Put My playlist in a new order: p_items first, in that order; anything on the playlist that p_items leaves out
-- keeps its order after them; an id that is not on the playlist is ignored (it may have just been removed elsewhere).
create or replace function app.reorder_playlist(p_center uuid, p_items uuid[]) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_person uuid;
begin
  perform app.media_check_center(p_center);
  v_person := app.my_person_id(p_center);
  if v_person is null then raise exception 'We could not tell who you are. Sign in again.'; end if;
  if p_items is null then raise exception 'Send the playlist in its new order.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('app.media_playlist_items:' || v_person::text, 0));
  with given as (
    select g.item_id, min(g.ord) as ord
      from unnest(p_items) with ordinality as g(item_id, ord)
     where g.item_id is not null
     group by g.item_id
  ), ranked as (
    select pi.item_id, (row_number() over (order by gv.ord nulls last, pi.position, pi.added_at, pi.item_id))::int as pos
      from app.media_playlist_items pi
      left join given gv on gv.item_id = pi.item_id
     where pi.person_id = v_person
  )
  update app.media_playlist_items pi set position = r.pos
    from ranked r
   where pi.person_id = v_person and pi.item_id = r.item_id and pi.position <> r.pos;
end $$;

comment on function app.media_library(uuid, text[], text, text, int) is
  'Media library (0560): published stavans, videos, podcasts and recipes of the community and the shared ones, as MediaRow. p_query matches title, artist, aliases and tags; p_sort title | liked | recent. Members only; Content module.';
comment on function app.media_item(uuid, uuid) is 'One media item as a MediaRow (0560). p_center only matters for an item shared by every community.';
comment on function app.random_media(uuid, text, boolean) is 'A random published item of one kind, or none (0560). p_fully_jain true keeps only fully Jain recipes.';
comment on function app.toggle_media_like(uuid, uuid) is 'Like or unlike a stavan, video, podcast or recipe; returns the new state (0560). Any member, children included.';
comment on function app.media_like_counts(uuid) is 'Likes and playlist adds per item for staff with content.view or content.manage (0560). Counts only, never who.';
comment on function app.my_playlist(uuid) is 'The caller''s playlist in order, as MediaRow plus position (0560).';
comment on function app.add_to_playlist(uuid, uuid) is 'Add a stavan, video or podcast to the end of the caller''s playlist; idempotent (0560).';
comment on function app.remove_from_playlist(uuid, uuid) is 'Take an item off the caller''s playlist; idempotent (0560).';
comment on function app.reorder_playlist(uuid, uuid[]) is 'Put the caller''s playlist in the given order; items left out keep their order after them (0560).';

revoke execute on function app.media_check_center(uuid), app.media_item_center(uuid, uuid, boolean),
  app.media_rows(uuid, uuid, text[], uuid[]) from public, anon, authenticated;
revoke execute on function app.media_library(uuid, text[], text, text, int), app.media_item(uuid, uuid),
  app.random_media(uuid, text, boolean), app.toggle_media_like(uuid, uuid), app.media_like_counts(uuid),
  app.my_playlist(uuid), app.add_to_playlist(uuid, uuid), app.remove_from_playlist(uuid, uuid),
  app.reorder_playlist(uuid, uuid[]) from public, anon;
grant execute on function app.media_library(uuid, text[], text, text, int), app.media_item(uuid, uuid),
  app.random_media(uuid, text, boolean), app.toggle_media_like(uuid, uuid), app.media_like_counts(uuid),
  app.my_playlist(uuid), app.add_to_playlist(uuid, uuid), app.remove_from_playlist(uuid, uuid),
  app.reorder_playlist(uuid, uuid[]) to authenticated;
grant execute on all functions in schema app to service_role;
