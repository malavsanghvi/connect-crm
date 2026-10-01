-- 0562: sample stavans, videos, podcasts and recipes for the JSH sandbox.
-- The seed function only ever acts on a sandbox, adds each item once, is not callable over the API; what it adds
-- is published, linked over https, labelled as a sample, every recipe is flagged fully Jain and has no excluded
-- ingredient, the reviewers' fixes are in, and a member finds the items through the real library RPCs.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.sign_in(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
\set sbx '''51000000-0000-4000-8000-0000000000c1'''
\set prod '''51000000-0000-4000-8000-0000000000c2'''
\set mom '''51000000-0000-4000-8000-000000000001'''
\set p_mom '''51000000-0000-4000-8000-0000000000a1'''
\set h1 '''51000000-0000-4000-8000-0000000000b1'''

insert into auth.users (id, email) values (:mom, 'mom51@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, environment) values
  (:sbx, 'sandbox51', 'Sandbox 51 Community', 'S51', 'TX', 'active', 'sandbox'),
  (:prod, 'prod51', 'Production 51 Community', 'P51', 'TX', 'active', 'production');
insert into app.households (id, center_id, display_name) values (:h1, :sbx, 'Shah household 51');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values (:p_mom, :sbx, 'Mira', 'Shah', date '1980-01-01');
insert into app.household_members (household_id, person_id, center_id, role) values (:h1, :p_mom, :sbx, 'primary');
insert into app.center_users (center_id, user_id, person_id) values (:sbx, :mom, :p_mom);

-- ── Who may run it ─────────────────────────────────────────────────────────
select pg_temp.assert(not has_function_privilege('authenticated', 'app.seed_jsh_sample_media(uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.seed_jsh_sample_media(uuid)', 'execute')
                      and has_function_privilege('service_role', 'app.seed_jsh_sample_media(uuid)', 'execute'),
  'only the service role can run the sample-media seed; signed-in and anonymous callers cannot');

-- ── It acts on a sandbox only ──────────────────────────────────────────────
select pg_temp.assert((select app.seed_jsh_sample_media(:prod)) = '{"added": 0, "skipped": "not a sandbox"}'::jsonb
                      and not exists (select 1 from app.content_items where center_id = :prod),
  'a production organization is refused and gets nothing');
select pg_temp.assert((select app.seed_jsh_sample_media('51000000-0000-4000-8000-0000000000ff')) = '{"added": 0, "skipped": "no such organization"}'::jsonb,
  'an organization that does not exist is refused');

-- ── What it adds, once ─────────────────────────────────────────────────────
select pg_temp.assert((select app.seed_jsh_sample_media(:sbx)) = '{"added": 25, "already_there": 0}'::jsonb,
  'the sandbox gets 25 samples');
select pg_temp.assert((select app.seed_jsh_sample_media(:sbx)) = '{"added": 0, "already_there": 25}'::jsonb
                      and (select count(*) from app.content_items where center_id = :sbx) = 25,
  'running it again adds nothing (same community, kind and slug)');
select pg_temp.assert((select jsonb_object_agg(kind, n) from (select kind, count(*) n from app.content_items where center_id = :sbx group by kind) k)
                      = '{"stavan": 8, "video": 6, "podcast": 4, "recipe": 7}'::jsonb,
  '8 stavans, 6 videos, 4 podcast episodes and 7 recipes');
select pg_temp.assert((select bool_and(status = 'published' and published_at is not null and metadata->>'sample' = 'true' and title <> '')
                         from app.content_items where center_id = :sbx),
  'every sample is published and labelled metadata.sample = true, so all of it can be removed with one statement');

-- ── Links ──────────────────────────────────────────────────────────────────
select pg_temp.assert((select bool_and(media_url ~ '^https://[^[:space:]]+$') from app.content_items where center_id = :sbx and kind <> 'recipe'),
  'every stavan, video and podcast link is https');
select pg_temp.assert((select bool_and(media_url is null and media_path is null) from app.content_items where center_id = :sbx and kind = 'recipe'),
  'recipes carry no link or file');
select pg_temp.assert((select bool_and(metadata->>'source' = 'youtube' and metadata->>'youtube_id' ~ '^[A-Za-z0-9_-]{11}$'
                                       and media_url like 'https://www.youtube.com/watch?v=' || (metadata->>'youtube_id'))
                         from app.content_items where center_id = :sbx and kind in ('stavan', 'video')),
  'every stavan and video is a YouTube link whose id matches its address');
select pg_temp.assert((select bool_and(metadata->>'source' = 'link' and media_url ~* '\.mp3$' and metadata->>'series' is not null and metadata->>'episode' is not null)
                         from app.content_items where center_id = :sbx and kind = 'podcast'),
  'every podcast episode is a direct .mp3 link with its series and episode, so the in-app player can play it');
select pg_temp.assert((select bool_and(body_md is null) from app.content_items where center_id = :sbx and kind = 'stavan'),
  'no stavan carries lyrics');
select pg_temp.assert((select count(*) from app.content_items where center_id = :sbx and kind = 'stavan' and tradition = 'shvetambar_murtipujak') = 5
                      and (select count(*) from app.content_items where center_id = :sbx and kind = 'stavan' and tradition = 'digambar') = 1,
  'stavans keep their tradition (5 Shvetambar, 1 Digambar, the rest common to both)');

-- ── Recipes ────────────────────────────────────────────────────────────────
select pg_temp.assert((select bool_and(metadata->>'fully_jain' = 'true' and jsonb_array_length(metadata->'ingredients') >= 4
                                       and (metadata->>'servings')::int > 0 and (metadata->>'prep_minutes')::int > 0 and (metadata->>'cook_minutes')::int > 0
                                       and body_md like '%## Method%' and body_md like '%Step 1:%')
                         from app.content_items where center_id = :sbx and kind = 'recipe'),
  'every recipe is flagged fully Jain and has ingredients, servings, times and a numbered method');
select pg_temp.assert(not exists (
    select 1 from app.content_items c, jsonb_array_elements_text(c.metadata->'ingredients') as ing(line)
     where c.center_id = :sbx and c.kind = 'recipe'
       and ing.line ~* '\m(potato(es)?|onions?|shallots?|garlic|carrots?|beetroot|radish(es)?|turnips?|yams?|suran|taro|mushrooms?|yeast|vinegar|eggs?|honey|gelatin|peanuts?|fresh ginger|fresh turmeric|brinjal|eggplant|cauliflower|cabbage)\M'),
  'no recipe lists a root vegetable, onion, garlic, mushroom, yeast, egg, honey, gelatin or another excluded ingredient');
select pg_temp.assert((select cook_minutes from (select (metadata->>'cook_minutes')::int cook_minutes from app.content_items where center_id = :sbx and slug = 'dal-dhokli') x) = 50
                      and (select body_md from app.content_items where center_id = :sbx and slug = 'gujarati-kadhi-jain-style') not like '%If you buy yogurt%'
                      and (select body_md from app.content_items where center_id = :sbx and slug = 'gujarati-moong-dal-khichdi') like '%Sauté mode%'
                      and (select metadata->'ingredients' from app.content_items where center_id = :sbx and slug = 'dal-dhokli')::text like '%plus 1 to 2 teaspoons for serving%',
  'the reviewers'' fixes are in: dal dhokli time and serving ghee, kadhi no store-bought yogurt, khichdi Instant Pot steps');

-- ── A member finds them through the real RPCs ──────────────────────────────
begin;
select pg_temp.sign_in(:mom);
select pg_temp.assert((select count(*) from app.media_library(:sbx, null)) = 25, 'a member sees all 25 in the library');
select pg_temp.assert((select count(*) from app.media_library(:sbx, array['recipe'])) = 7, 'seven recipes');
select pg_temp.assert((select count(*) from app.media_library(:sbx, array['podcast'])) = 4, 'four podcast episodes');
select pg_temp.assert((select title from app.media_library(:sbx, array['stavan'], 'navkar')) like 'Namokaar Mantra Hai Nyaara%',
  'searching "navkar" finds the Navkar Mantra bhajan by its alias');
select pg_temp.assert((select count(*) from app.media_library(:sbx, array['stavan'], 'mangal')) = 1
                      and (select count(*) from app.media_library(:sbx, array['stavan'], 'Mahek')) = 1,
  'search finds a stavan by title and by singer');
select pg_temp.assert((select count(*) from app.media_library(:sbx, array['video'], 'Young Jains')) = 2, 'search finds videos by channel');
select pg_temp.assert((select metadata->>'fully_jain' from app.random_media(:sbx, 'recipe', true)) = 'true', 'the Random recipe shortcut finds a fully Jain recipe');
select pg_temp.assert((select kind from app.random_media(:sbx, 'podcast')) = 'podcast', 'the Podcast shortcut finds a podcast');
select pg_temp.assert((select app.toggle_media_like(id) from app.media_library(:sbx, array['stavan'], 'mangal')), 'a member can like a sample stavan');
rollback;
