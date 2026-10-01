-- 0560: the media library — stavans, videos, podcasts and recipes; each member's likes and one playlist.
-- Kinds and links, the content bucket, module / audit / RLS coverage, own-only reads, the RPCs (members only,
-- published items of the community or shared by every community), children like too, isolation between
-- communities, staff see counts and never who, and the Content module switch.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.assert_raises(stmt text, expect text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if position(lower(expect) in lower(sqlerrm)) = 0 then raise exception 'FAIL: % (got "%")', label, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.sign_in(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
\set c1 '''49000000-0000-4000-8000-0000000000c1'''
\set c2 '''49000000-0000-4000-8000-0000000000c2'''
\set mom '''49000000-0000-4000-8000-000000000001'''
\set dad '''49000000-0000-4000-8000-000000000002'''
\set kid '''49000000-0000-4000-8000-000000000003'''
\set outsider '''49000000-0000-4000-8000-000000000004'''
\set curator '''49000000-0000-4000-8000-000000000005'''
\set staff_none '''49000000-0000-4000-8000-000000000006'''
\set multi '''49000000-0000-4000-8000-000000000007'''
\set editor '''49000000-0000-4000-8000-000000000008'''
\set p_mom '''49000000-0000-4000-8000-0000000000a1'''
\set p_dad '''49000000-0000-4000-8000-0000000000a2'''
\set p_kid '''49000000-0000-4000-8000-0000000000a3'''
\set p_out '''49000000-0000-4000-8000-0000000000a4'''
\set p_multi1 '''49000000-0000-4000-8000-0000000000a5'''
\set p_multi2 '''49000000-0000-4000-8000-0000000000a6'''
\set h1 '''49000000-0000-4000-8000-0000000000b1'''
\set h2 '''49000000-0000-4000-8000-0000000000b2'''
\set h3 '''49000000-0000-4000-8000-0000000000b3'''
\set h4 '''49000000-0000-4000-8000-0000000000b4'''
\set i_navkar '''49000000-0000-4000-8000-000000000d01'''
\set i_bhakta '''49000000-0000-4000-8000-000000000d02'''
\set i_pct '''49000000-0000-4000-8000-000000000d03'''
\set i_draft '''49000000-0000-4000-8000-000000000d04'''
\set i_video '''49000000-0000-4000-8000-000000000d05'''
\set i_podcast '''49000000-0000-4000-8000-000000000d06'''
\set i_dhokli '''49000000-0000-4000-8000-000000000d07'''
\set i_pakora '''49000000-0000-4000-8000-000000000d08'''
\set i_sutra '''49000000-0000-4000-8000-000000000d09'''
\set i_c2 '''49000000-0000-4000-8000-000000000d0a'''
\set i_shared '''49000000-0000-4000-8000-000000000d0b'''

insert into auth.users (id, email) values
  (:mom, 'mom49@example.com'), (:dad, 'dad49@example.com'), (:kid, 'kid49@example.com'), (:outsider, 'outsider49@example.com'),
  (:curator, 'curator49@example.com'), (:staff_none, 'staffnone49@example.com'), (:multi, 'multi49@example.com'),
  (:editor, 'editor49@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, environment) values
  (:c1, 'orbit49', 'Orbit 49 Community', 'O49', 'TX', 'active', 'production'),
  (:c2, 'orbit49b', 'Other 49 Community', 'O49B', 'TX', 'active', 'production');
insert into app.households (id, center_id, display_name) values
  (:h1, :c1, 'Shah household 49'), (:h2, :c2, 'Sider household 49'), (:h3, :c1, 'Doshi household 49'), (:h4, :c2, 'Doshi household 49b');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (:p_mom, :c1, 'Mira', 'Shah', date '1980-01-01'),
  (:p_dad, :c1, 'Rahul', 'Shah', date '1978-05-05'),
  (:p_kid, :c1, 'Anya', 'Shah', (current_date - interval '10 years')::date),
  (:p_out, :c2, 'Out', 'Sider', date '1970-01-01'),
  (:p_multi1, :c1, 'Meera', 'Doshi', date '1985-02-02'),
  (:p_multi2, :c2, 'Meera', 'Doshi', date '1985-02-02');
insert into app.household_members (household_id, person_id, center_id, role) values
  (:h1, :p_mom, :c1, 'primary'), (:h1, :p_dad, :c1, 'spouse'), (:h1, :p_kid, :c1, 'child'), (:h2, :p_out, :c2, 'primary'),
  (:h3, :p_multi1, :c1, 'primary'), (:h4, :p_multi2, :c2, 'primary');
insert into app.center_users (center_id, user_id, person_id) values
  (:c1, :mom, :p_mom), (:c1, :dad, :p_dad), (:c1, :kid, :p_kid), (:c2, :outsider, :p_out),
  (:c1, :multi, :p_multi1), (:c2, :multi, :p_multi2);
insert into app.role_grants (center_id, user_id, role_key) values
  (:c1, :curator, 'religious_coordinator'),      -- content.view + content.manage, not a member
  (:c1, :editor, 'content_editor'),              -- content.view (+ content.draft)
  (:c1, :staff_none, 'membership_coordinator');  -- no content permission

insert into app.content_items (id, center_id, kind, slug, title, body_md, media_path, media_url, metadata, status, published_at) values
  (:i_navkar, :c1, 'stavan', 'navkar-49', 'Navkar Mantra', 'Namo Arihantanam, Namo Siddhanam ...',
   '49000000-0000-4000-8000-0000000000c1/media/stavan/7c1e-navkar.m4a', null,
   '{"source":"upload","artist":"Lata Shah","aliases":["Navkaar","Namokar"],"tags":["mantra","morning"],"duration_seconds":180}',
   'published', now() - interval '3 days'),
  (:i_bhakta, :c1, 'stavan', 'bhaktamar-49', 'Bhaktamar Stotra', null, null, 'https://www.youtube.com/watch?v=bhaktamar49',
   '{"source":"youtube","youtube_id":"bhaktamar49","artist":"Anuradha Paudwal","tags":["stotra"]}', 'published', now() - interval '1 day'),
  (:i_pct, :c1, 'stavan', 'pct-49', 'Prabhu 100% Bhakti', null, null, null, '{}', 'published', now() - interval '2 days'),
  (:i_draft, :c1, 'stavan', 'draft-49', 'Draft Navkar Stavan', null, null, null, '{}', 'draft', null),
  (:i_video, :c1, 'video', 'pravachan-49', 'Paryushan Pravachan', null, null, 'https://youtu.be/pravachan49',
   '{"source":"youtube","youtube_id":"pravachan49","artist":"Muni Shri"}', 'published', now() - interval '5 days'),
  (:i_podcast, :c1, 'podcast', 'philosophy-49', 'Jain Philosophy 101', null, null, 'https://example.org/jain-101.mp3',
   '{"source":"link","series":"Basics","episode":1,"artist":"Dr. Mehta"}', 'published', now() - interval '6 days'),
  (:i_dhokli, :c1, 'recipe', 'dhokli-49', 'Dal Dhokli', 'Cook the toor dal, roll the dough ...', null, null,
   '{"fully_jain":true,"ingredients":["toor dal","wheat flour","spices"],"servings":4,"prep_minutes":20,"cook_minutes":40}',
   'published', now() - interval '7 days'),
  (:i_pakora, :c1, 'recipe', 'pakora-49', 'Onion Pakora', null, null, null, '{"fully_jain":false}', 'published', now() - interval '8 days'),
  (:i_sutra, :c1, 'sutra', 'uvasaggaharam-49', 'Uvasaggaharam', null, null, null, '{}', 'published', now() - interval '9 days'),
  (:i_c2, :c2, 'stavan', 'other-49', 'Other Community Stavan', null, null, null, '{}', 'published', now() - interval '1 day'),
  (:i_shared, null, 'stavan', 'mangal-49', 'Mangal Path', null, null, null, '{"artist":"Shared pack"}', 'published', now() - interval '10 days');

-- ── Coverage: Content module, audited with the key, RLS on, read-only to the API ──
select pg_temp.assert((select count(*) from app.module_tables where table_name in ('media_likes', 'media_playlist_items') and module_key = 'content') = 2,
  'both tables belong to the Content module');
select pg_temp.assert((select count(*) from pg_trigger t where not t.tgisinternal and t.tgname in ('audit_media_likes', 'audit_media_playlist_items')
                          and t.tgfoid = 'app.audit_row'::regproc and t.tgnargs = 2) = 2,
  'both tables have an audit trigger keyed by person and item');
select pg_temp.assert((select bool_and(relrowsecurity) from pg_class where oid in ('app.media_likes'::regclass, 'app.media_playlist_items'::regclass)),
  'row-level security is on for both tables');
select pg_temp.assert((select count(*) from pg_policy p where p.polrelid in ('app.media_likes'::regclass, 'app.media_playlist_items'::regclass)
                          and p.polname = 'module_switch' and not p.polpermissive) = 2,
  'both tables stop with the Content module (restrictive module_switch policy)');
select pg_temp.assert(not has_table_privilege('anon', 'app.media_likes', 'select') and not has_table_privilege('anon', 'app.media_playlist_items', 'select'),
  'anonymous callers read neither table');
select pg_temp.assert(has_table_privilege('authenticated', 'app.media_likes', 'select') and has_table_privilege('authenticated', 'app.media_playlist_items', 'select')
                      and not has_table_privilege('authenticated', 'app.media_likes', 'insert') and not has_table_privilege('authenticated', 'app.media_likes', 'update')
                      and not has_table_privilege('authenticated', 'app.media_likes', 'delete')
                      and not has_table_privilege('authenticated', 'app.media_playlist_items', 'insert')
                      and not has_table_privilege('authenticated', 'app.media_playlist_items', 'update')
                      and not has_table_privilege('authenticated', 'app.media_playlist_items', 'delete'),
  'signed-in users only read; every write goes through the RPCs');
select pg_temp.assert((select bool_and(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute'))
                         from unnest(array['app.media_library(uuid,text[],text,text,int)', 'app.media_item(uuid,uuid)', 'app.random_media(uuid,text,boolean)',
                                           'app.toggle_media_like(uuid,uuid)', 'app.media_like_counts(uuid)', 'app.my_playlist(uuid)',
                                           'app.add_to_playlist(uuid,uuid)', 'app.remove_from_playlist(uuid,uuid)', 'app.reorder_playlist(uuid,uuid[])']) as f),
  'signed-in users call the nine RPCs; anonymous callers cannot');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.media_rows(uuid,uuid,text[],uuid[])', 'execute')
                      and not has_function_privilege('authenticated', 'app.media_item_center(uuid,uuid,boolean)', 'execute')
                      and not has_function_privilege('authenticated', 'app.media_check_center(uuid)', 'execute'),
  'the internal helpers are not callable over the API');
select pg_temp.assert((select count(*) = 9 and bool_and(p.prosecdef and exists (select 1 from unnest(p.proconfig) as g(setting)
                                                                                 where g.setting ~ '^search_path=app, *public, *extensions$'))
                         from pg_proc p where p.pronamespace = 'app'::regnamespace
                          and p.proname in ('media_library', 'media_item', 'random_media', 'toggle_media_like', 'media_like_counts',
                                            'my_playlist', 'add_to_playlist', 'remove_from_playlist', 'reorder_playlist')),
  'every RPC is security definer with the hosted search path');

-- ── Kinds, links, the bucket ─────────────────────────────────────────────────
select pg_temp.assert((select count(*) from app.content_items where id in (:i_navkar, :i_podcast, :i_dhokli)) = 3,
  'stavan, podcast and recipe are content kinds now');
select pg_temp.assert_raises($$insert into app.content_items (center_id, kind, slug, title) values ('49000000-0000-4000-8000-0000000000c1', 'karaoke', 'k-49', 'Karaoke')$$,
  'content_items_kind_check', 'an unknown kind is still refused');
select pg_temp.assert_raises($$insert into app.content_items (center_id, kind, slug, title, media_url) values ('49000000-0000-4000-8000-0000000000c1', 'stavan', 'http-49', 'Insecure', 'http://example.com/a.mp3')$$,
  'content_items_media_https', 'a media link must be https://');
select pg_temp.assert_raises($$insert into app.content_items (center_id, kind, slug, title, media_url) values ('49000000-0000-4000-8000-0000000000c1', 'recipe', 'http-49r', 'Insecure recipe', 'http://example.com/r')$$,
  'content_items_media_https', 'for every media kind');
insert into app.content_items (center_id, kind, slug, title, media_url, status)
  values (:c1, 'audio_lesson', 'lesson-49', 'An older audio lesson', 'http://example.com/lesson.mp3', 'draft');
select pg_temp.assert(true, 'the older kinds keep their own rules (an audio lesson link is not checked)');
select pg_temp.assert((select file_size_limit = 52428800 and not public
                          and allowed_mime_types @> array['audio/x-m4a', 'audio/mp3', 'video/quicktime']
                          and allowed_mime_types @> array['audio/mpeg', 'audio/mp4', 'video/mp4', 'image/jpeg', 'application/pdf']
                         from storage.buckets where id = 'content'),
  'the content bucket also takes .m4a, audio/mp3 and .mov, keeps the earlier types and its 50 MB limit, and stays private');
select pg_temp.assert(col_description('app.content_items'::regclass,
                        (select attnum from pg_attribute where attrelid = 'app.content_items'::regclass and attname = 'metadata')::int) like '%fully_jain%',
  'the media metadata conventions are written on the column');

-- ── A member reads the library ────────────────────────────────────────────────
begin;
select pg_temp.sign_in(:mom);
select pg_temp.assert((select count(*) from app.media_library(:c1, null)) = 8,
  'the library lists every published stavan, video, podcast and recipe of the community and the shared ones');
select pg_temp.assert((select count(*) from app.media_library(:c1, '{}')) = 8, 'an empty kind list means all four kinds');
select pg_temp.assert(not exists (select 1 from app.media_library(:c1, null) where id in (:i_draft, :i_c2, :i_sutra)),
  'drafts, another community''s items and non-media kinds are not listed');
select pg_temp.assert((select array_agg(id) from app.media_library(:c1, array['stavan'])) = array[:i_bhakta, :i_shared, :i_navkar, :i_pct]::uuid[],
  'by title (the default sort), including the item shared by every community');
select pg_temp.assert((select array_agg(kind order by kind) from app.media_library(:c1, array['video', 'podcast'])) = array['podcast', 'video'],
  'the kinds asked for only');
select pg_temp.assert((select array_agg(id) from app.media_library(:c1, array['stavan'], null, 'recent')) = array[:i_bhakta, :i_pct, :i_navkar, :i_shared]::uuid[],
  'newest first');
select pg_temp.assert((select count(*) from app.media_library(:c1, null, null, 'title', 2)) = 2, 'the limit is applied');
select pg_temp.assert((select title = 'Navkar Mantra' and kind = 'stavan' and language = 'en' and media_path like '%/media/stavan/%'
                          and media_url is null and metadata->>'artist' = 'Lata Shah' and body_md like 'Namo Arihantanam%'
                          and published_at is not null and like_count = 0 and not liked_by_me and not in_my_playlist
                         from app.media_library(:c1, array['stavan']) where id = :i_navkar),
  'a MediaRow carries the item and its like and playlist state');
-- Search: title, artist, aliases and tags, any case; a typed % or _ is a character, not a wildcard.
select pg_temp.assert((select array_agg(id) from app.media_library(:c1, array['stavan'], 'navkaar')) = array[:i_navkar]::uuid[], 'search finds another spelling (an alias)');
select pg_temp.assert((select array_agg(id) from app.media_library(:c1, array['stavan'], 'NAVKAR')) = array[:i_navkar]::uuid[], 'search ignores case and skips drafts');
select pg_temp.assert((select array_agg(id) from app.media_library(:c1, array['stavan'], 'lata')) = array[:i_navkar]::uuid[], 'search finds the singer');
select pg_temp.assert((select array_agg(id) from app.media_library(:c1, array['stavan'], 'morning')) = array[:i_navkar]::uuid[], 'search finds a tag');
select pg_temp.assert((select array_agg(id) from app.media_library(:c1, array['stavan'], 'stotra')) = array[:i_bhakta]::uuid[], 'an item matching twice is listed once');
select pg_temp.assert((select array_agg(id) from app.media_library(:c1, null, 'mehta')) = array[:i_podcast]::uuid[], 'search across kinds finds the speaker');
select pg_temp.assert((select array_agg(id) from app.media_library(:c1, array['stavan'], '100%')) = array[:i_pct]::uuid[]
                      and (select array_agg(id) from app.media_library(:c1, array['stavan'], '%')) = array[:i_pct]::uuid[],
  'a typed % is searched for literally');
select pg_temp.assert((select count(*) from app.media_library(:c1, array['stavan'], '_')) = 0, 'a typed _ is searched for literally');
select pg_temp.assert((select count(*) from app.media_library(:c1, array['stavan'], '   ')) = 4, 'a blank search lists everything');
select pg_temp.assert_raises(format('select * from app.media_library(%L, array[''sutra''])', :c1), 'not one of them', 'only the four media kinds are asked for');
select pg_temp.assert_raises(format('select * from app.media_library(%L, null, null, %L)', :c1, 'popular'), 'Sort the library by title, liked or recent',
  'an unknown sort is refused');
commit;

-- ── Likes ─────────────────────────────────────────────────────────────────────
begin;
select pg_temp.sign_in(:mom);
select pg_temp.assert(app.toggle_media_like(:i_navkar) = true, 'liking returns the new state: liked');
select pg_temp.assert(app.toggle_media_like(:i_navkar) = false, 'liking again unlikes');
select pg_temp.assert(app.toggle_media_like(:i_navkar) = true, 'and again likes');
select pg_temp.assert(app.toggle_media_like(:i_shared) = true, 'an item shared by every community can be liked');
select pg_temp.assert_raises(format('select app.toggle_media_like(%L)', :i_sutra), 'not found in the library', 'only stavans, videos, podcasts and recipes can be liked');
select pg_temp.assert_raises(format('select app.toggle_media_like(%L)', :i_draft), 'not found in the library', 'an unpublished item cannot be liked');
select pg_temp.assert_raises(format('select app.toggle_media_like(%L)', :i_c2), 'not found in the library', 'another community''s item cannot be liked');
select pg_temp.assert_raises($$select app.toggle_media_like('49000000-0000-4000-8000-0000000000ff')$$, 'not found in the library', 'an item that does not exist');
select pg_temp.assert_raises(format('select app.toggle_media_like(%L, %L)', :i_navkar, :c2), 'not found in the library',
  'naming another community for an item is refused');
commit;
begin;
select pg_temp.sign_in(:dad);
select pg_temp.assert(app.toggle_media_like(:i_navkar), 'another adult of the household likes it too');
commit;
begin;
select pg_temp.sign_in(:kid);
select pg_temp.assert(app.toggle_media_like(:i_navkar), 'a child can like');
commit;

begin;
select pg_temp.sign_in(:mom);
select pg_temp.assert((select count(*) = 1 and bool_and(like_count = 3 and liked_by_me and not in_my_playlist) from app.media_item(:i_navkar)),
  'the detail row counts the community''s likes and says the caller likes it');
select pg_temp.assert((select like_count = 1 and liked_by_me from app.media_item(:i_shared)), 'a shared item counts this community''s likes');
select pg_temp.assert((select array_agg(id) from app.media_library(:c1, array['stavan'], null, 'liked')) = array[:i_navkar, :i_shared, :i_bhakta, :i_pct]::uuid[],
  'sorted by likes: most liked first, then the newest');
select pg_temp.assert_raises(format('select * from app.media_item(%L)', :i_draft), 'not found in the library', 'an unpublished item has no detail');
commit;
begin;
select pg_temp.sign_in(:dad);
select pg_temp.assert((select like_count = 1 and not liked_by_me from app.media_item(:i_shared)), 'liked_by_me is the caller''s own');
commit;

-- ── Own rows only; nobody writes directly ─────────────────────────────────────
begin;
select pg_temp.sign_in(:mom);
select pg_temp.assert((select count(*) = 2 and bool_and(person_id = :p_mom) from app.media_likes), 'a member reads only their own likes');
select pg_temp.assert_raises(format('insert into app.media_likes (center_id, person_id, item_id) values (%L, %L, %L)', :c1, :p_mom, :i_bhakta),
  'permission denied', 'nobody writes likes directly');
select pg_temp.assert_raises(format('delete from app.media_likes where person_id = %L', :p_mom), 'permission denied', 'or removes them directly');
select pg_temp.assert_raises(format('insert into app.media_playlist_items (center_id, person_id, item_id, position) values (%L, %L, %L, 1)', :c1, :p_mom, :i_bhakta),
  'permission denied', 'nobody writes a playlist directly');
commit;
begin;
select pg_temp.sign_in(:dad);
select pg_temp.assert((select count(*) = 1 and bool_and(person_id = :p_dad) from app.media_likes), 'another adult of the household does not see her likes');
commit;
begin;
select pg_temp.sign_in(:kid);
select pg_temp.assert((select count(*) = 1 and bool_and(person_id = :p_kid) from app.media_likes), 'a child reads only their own likes');
commit;
begin;
select pg_temp.sign_in(:curator);
select pg_temp.assert((select count(*) from app.media_likes) = 0 and (select count(*) from app.media_playlist_items) = 0,
  'staff with content.manage read no one''s likes or playlist');
commit;

-- ── My playlist ───────────────────────────────────────────────────────────────
begin;
select pg_temp.sign_in(:mom);
select app.add_to_playlist(:i_navkar);
select app.add_to_playlist(:i_video);
select app.add_to_playlist(:i_podcast);
select app.add_to_playlist(:i_navkar);
select pg_temp.assert((select array_agg(p.id) from app.my_playlist(:c1) p) = array[:i_navkar, :i_video, :i_podcast]::uuid[]
                      and (select array_agg(p.position) from app.my_playlist(:c1) p) = array[1, 2, 3]
                      and (select bool_and(p.in_my_playlist) from app.my_playlist(:c1) p),
  'items go to the end of My playlist in order; adding one again changes nothing');
select pg_temp.assert((select p.like_count = 3 and p.liked_by_me from app.my_playlist(:c1) p where p.id = :i_navkar), 'playlist rows carry the like state too');
select pg_temp.assert_raises(format('select app.add_to_playlist(%L)', :i_dhokli), 'Only stavans, videos and podcasts', 'a recipe does not go in My playlist');
select pg_temp.assert_raises(format('select app.add_to_playlist(%L)', :i_sutra), 'not found in the library', 'nor does a non-media item');
select app.reorder_playlist(:c1, array[:i_podcast, :i_navkar, '49000000-0000-4000-8000-0000000000ff']::uuid[]);
select pg_temp.assert((select array_agg(p.id) from app.my_playlist(:c1) p) = array[:i_podcast, :i_navkar, :i_video]::uuid[]
                      and (select array_agg(p.position) from app.my_playlist(:c1) p) = array[1, 2, 3],
  'reordering puts the named items first, the rest keep their order after them, an unknown id is ignored');
select pg_temp.assert_raises(format('select app.reorder_playlist(%L, null)', :c1), 'new order', 'a reorder needs the list');
select app.remove_from_playlist(:i_video);
select app.remove_from_playlist(:i_video);
select pg_temp.assert((select array_agg(p.id) from app.my_playlist(:c1) p) = array[:i_podcast, :i_navkar]::uuid[], 'removing takes it off (twice is harmless)');
select pg_temp.assert((select in_my_playlist from app.media_item(:i_navkar)), 'the detail row says it is in My playlist');
commit;
update app.content_items set status = 'retired' where id = :i_podcast;
begin;
select pg_temp.sign_in(:mom);
select pg_temp.assert((select array_agg(p.id) from app.my_playlist(:c1) p) = array[:i_navkar]::uuid[], 'an item that is no longer published drops out of My playlist');
select app.remove_from_playlist(:i_podcast);
commit;
select pg_temp.assert((select array_agg(item_id) from app.media_playlist_items where person_id = :p_mom) = array[:i_navkar]::uuid[],
  'and can still be taken off it');
update app.content_items set status = 'published' where id = :i_podcast;
begin;
select pg_temp.sign_in(:dad);
select pg_temp.assert((select count(*) from app.my_playlist(:c1)) = 0, 'every person has their own playlist');
commit;
begin;
select pg_temp.sign_in(:kid);
select app.add_to_playlist(:i_bhakta);
select pg_temp.assert(app.toggle_media_like(:i_bhakta), 'a child likes another stavan');
select pg_temp.assert((select array_agg(p.id) from app.my_playlist(:c1) p) = array[:i_bhakta]::uuid[], 'a child keeps a playlist too');
commit;

-- ── A random item ────────────────────────────────────────────────────────────
begin;
select pg_temp.sign_in(:mom);
select pg_temp.assert((select count(*) = 5 and bool_and(r.title = 'Dal Dhokli')
                         from generate_series(1, 5) as g cross join lateral app.random_media(:c1, 'recipe', true) as r),
  'a random fully Jain recipe is always one marked fully_jain');
select pg_temp.assert((select count(*) = 1 and bool_and(kind = 'recipe') from app.random_media(:c1, 'recipe')), 'a random recipe is one recipe');
select pg_temp.assert((select title from app.random_media(:c1, 'podcast')) = 'Jain Philosophy 101', 'a random podcast');
select pg_temp.assert((select count(*) from app.random_media(:c1, 'stavan', true)) = 0, 'fully_jain keeps recipes only');
select pg_temp.assert_raises(format('select * from app.random_media(%L, %L)', :c1, 'sutra'), 'Choose a stavan, video, podcast or recipe',
  'a random item is one of the media kinds');
commit;
begin;
select pg_temp.sign_in(:outsider);
select pg_temp.assert((select count(*) from app.random_media(:c2, 'recipe', true)) = 0, 'a community with no recipes gets none (the app says so)');
commit;

-- ── Staff: counts, never who ─────────────────────────────────────────────────
begin;
select pg_temp.sign_in(:curator);
select pg_temp.assert((select array_agg(item_id::text || ':' || like_count || ':' || playlist_count) from app.media_like_counts(:c1))
                        = array[:i_navkar || ':3:1', :i_bhakta || ':1:1', :i_shared || ':1:0'],
  'staff with content.manage see how many members like and keep each item');
commit;
begin;
select pg_temp.sign_in(:editor);
select pg_temp.assert((select count(*) from app.media_like_counts(:c1)) = 3, 'content.view is enough to see the counts');
commit;
begin;
select pg_temp.sign_in(:staff_none);
select pg_temp.assert_raises(format('select * from app.media_like_counts(%L)', :c1), 'content.view or content.manage', 'staff without a content permission see no counts');
commit;
begin;
select pg_temp.sign_in(:mom);
select pg_temp.assert_raises(format('select * from app.media_like_counts(%L)', :c1), 'content.view or content.manage', 'a member sees no counts');
commit;
begin;
select pg_temp.sign_in(:curator);
select pg_temp.assert_raises(format('select * from app.media_like_counts(%L)', :c2), 'content.view or content.manage', 'staff see no other community''s counts');
commit;
select pg_temp.assert((select proargnames from pg_proc where oid = 'app.media_like_counts(uuid)'::regprocedure) = array['p_center', 'item_id', 'like_count', 'playlist_count'],
  'the counts carry no person: the item, its likes and its playlist adds');

-- ── Communities are kept apart ───────────────────────────────────────────────
begin;
select pg_temp.sign_in(:outsider);
select pg_temp.assert_raises(format('select * from app.media_library(%L, null)', :c1), 'Only members of this community', 'a member of another community cannot open this library');
select pg_temp.assert_raises(format('select * from app.media_item(%L)', :i_navkar), 'not found in the library', 'nor see one of its items');
select pg_temp.assert_raises(format('select app.toggle_media_like(%L)', :i_navkar), 'not found in the library', 'nor like one');
select pg_temp.assert_raises(format('select app.add_to_playlist(%L)', :i_navkar), 'not found in the library', 'nor add one to a playlist');
select pg_temp.assert_raises(format('select * from app.my_playlist(%L)', :c1), 'Only members of this community', 'nor read a playlist there');
select pg_temp.assert((select array_agg(id) from app.media_library(:c2, null)) = array[:i_shared, :i_c2]::uuid[],
  'their own library: their community''s items and the shared ones');
select pg_temp.assert(app.toggle_media_like(:i_shared), 'they like the shared item in their own community');
select pg_temp.assert((select like_count = 1 and liked_by_me from app.media_item(:i_shared)), 'counted in their community only');
commit;
begin;
select pg_temp.sign_in(:multi);
select pg_temp.assert_raises(format('select app.toggle_media_like(%L)', :i_shared), 'more than one community',
  'someone in two communities says which one a shared item is liked in');
select pg_temp.assert(app.toggle_media_like(:i_shared, :c2), 'and then likes it there');
select pg_temp.assert_raises(format('select * from app.media_item(%L, %L)', :i_navkar, :c2), 'not found in the library',
  'an item of one community is not shown in the other');
select pg_temp.assert((select count(*) from app.media_library(:c1, null)) = 8, 'they read each community''s library as a member of it');
commit;
select pg_temp.assert((select center_id from app.media_likes where person_id = :p_multi2 and item_id = :i_shared) = :c2,
  'the like belongs to the community it was made in');
begin;
select pg_temp.sign_in(:mom);
select pg_temp.assert((select like_count from app.media_item(:i_shared)) = 1, 'likes in another community do not change this community''s count');
commit;
begin;
select pg_temp.sign_in(:outsider);
select pg_temp.assert((select like_count from app.media_item(:i_shared)) = 2, 'and the other community counts its own two');
commit;

-- ── The Content module switch ────────────────────────────────────────────────
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c1, 'content', false, 'Test 49: the library is off');
begin;
select pg_temp.sign_in(:mom);
select pg_temp.assert_raises(format('select * from app.media_library(%L, null)', :c1), 'switched off', 'with Content off the library refuses');
select pg_temp.assert_raises(format('select * from app.media_item(%L)', :i_navkar), 'switched off', 'so does an item''s detail');
select pg_temp.assert_raises(format('select app.toggle_media_like(%L)', :i_navkar), 'switched off', 'and liking');
select pg_temp.assert_raises(format('select app.toggle_media_like(%L)', :i_shared), 'switched off', 'a shared item too');
select pg_temp.assert_raises(format('select * from app.my_playlist(%L)', :c1), 'switched off', 'and My playlist');
select pg_temp.assert_raises(format('select app.add_to_playlist(%L)', :i_video), 'switched off', 'and adding to it');
select pg_temp.assert_raises(format('select app.reorder_playlist(%L, array[]::uuid[])', :c1), 'switched off', 'and reordering it');
select pg_temp.assert_raises(format('select * from app.random_media(%L, %L)', :c1, 'recipe'), 'switched off', 'and a random recipe');
select pg_temp.assert((select count(*) from app.media_likes) = 0 and (select count(*) from app.media_playlist_items) = 0, 'and her own rows are hidden');
commit;
begin;
select pg_temp.sign_in(:curator);
select pg_temp.assert_raises(format('select * from app.media_like_counts(%L)', :c1), 'switched off', 'staff counts refuse too');
commit;
begin;
select pg_temp.sign_in(:outsider);
select pg_temp.assert((select count(*) from app.media_library(:c2, null)) = 2, 'another community''s library is unaffected');
commit;
delete from app.center_modules where center_id = :c1 and module_key = 'content';
begin;
select pg_temp.sign_in(:mom);
select pg_temp.assert((select count(*) from app.media_likes) = 2 and (select count(*) from app.my_playlist(:c1)) = 1,
  'switching it back on restores everything as it was');
commit;

-- ── Audit ────────────────────────────────────────────────────────────────────
select pg_temp.assert(exists (select 1 from app.audit_log where action = 'media_likes.insert' and record_id = :p_mom || ':' || :i_navkar
                                and module = 'content' and center_id = :c1 and actor_user_id = :mom),
  'a like is audited with who, keyed "<person>:<item>", under the Content module');
select pg_temp.assert(exists (select 1 from app.audit_log where action = 'media_likes.delete' and record_id = :p_mom || ':' || :i_navkar),
  'an unlike is audited');
select pg_temp.assert(exists (select 1 from app.audit_log where action = 'media_playlist_items.update' and record_id = :p_mom || ':' || :i_podcast)
                      and exists (select 1 from app.audit_log where action = 'media_playlist_items.delete' and record_id = :p_mom || ':' || :i_video),
  'playlist changes are audited');

-- ── Removals cascade; a sandbox reset clears the member rows ─────────────────
delete from app.content_items where id = :i_bhakta;
select pg_temp.assert(not exists (select 1 from app.media_likes where item_id = :i_bhakta)
                      and not exists (select 1 from app.media_playlist_items where item_id = :i_bhakta),
  'removing an item removes its likes and playlist places');
delete from app.people where id = :p_dad;
select pg_temp.assert(not exists (select 1 from app.media_likes where person_id = :p_dad), 'removing a person removes their likes');
select pg_temp.assert('media_likes' <> all (app.demo_keep_tables()) and 'media_playlist_items' <> all (app.demo_keep_tables())
                      and 'media_likes' = any (app.demo_clear_tables()) and 'media_playlist_items' = any (app.demo_clear_tables()),
  'a sandbox reset clears likes and playlists (member data, not set-up)');
select pg_temp.assert((select array_position(o, 'media_likes') < array_position(o, 'content_items')
                          and array_position(o, 'media_playlist_items') < array_position(o, 'content_items')
                         from (select array(select jsonb_array_elements_text(app.demo_clear_plan()->'order')) as o) x),
  'and removes them before the items they point at');

-- The shared test item would show in every later community's library: remove it.
delete from app.content_items where id = :i_shared;
select pg_temp.assert(not exists (select 1 from app.media_likes where item_id = :i_shared), 'the shared test item is gone with its likes');
