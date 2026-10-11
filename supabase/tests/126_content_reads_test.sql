-- 0669: app.content_queue_summary and app.content_library_summary, the reads behind the Content commands (B90 phase 4, Content).
--   A. The approval queue: the number waiting, by kind, how old, the oldest items first; a limit shortens the list and not the count;
--      only this community's items; a web page's sections carry the page they came from.
--   B. Member photos waiting are counts only: no path, no caption; an album with a photo of a child in it has no title in the answer.
--   C. Who may read: a content manager and an editor who only drafts read the queue; only a content manager sees the photo counts;
--      someone who may only view content (the communications officer), someone with no content permission, a person of another
--      community and a missing community get null (never zeros).
--   D. The text of an item never comes back.
--   E. Niva's sources by status, the imported web pages that changed or disappeared (a retired section is not counted), published
--      sources not edited for a long time, and the media library by kind and status.
--   F. Both are security invoker and callable by signed-in people only.
-- Everything runs as the signed-in person (row-level security) and in one transaction that is not committed.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.sign_in(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.keep(p_name text, p_j jsonb) returns void language plpgsql as $$
begin perform set_config('t126.' || p_name, coalesce(p_j::text, 'null'), true); end $$;
create or replace function pg_temp.got(p_name text) returns jsonb language sql stable as $$ select current_setting('t126.' || p_name)::jsonb $$;

\set c '''26000000-0000-4000-8000-0000000000c1'''
\set c2 '''26000000-0000-4000-8000-0000000000c2'''
\set u_coord '''26000000-0000-4000-8000-0000000000a1'''
\set u_editor '''26000000-0000-4000-8000-0000000000a2'''
\set u_comms '''26000000-0000-4000-8000-0000000000a3'''
\set u_nobody '''26000000-0000-4000-8000-0000000000a4'''
\set u_other '''26000000-0000-4000-8000-0000000000a5'''
\set al_kids '''26000000-0000-4000-8000-0000000000b1'''
\set al_plain '''26000000-0000-4000-8000-0000000000b2'''
\set al_done '''26000000-0000-4000-8000-0000000000b3'''
\set it_oldest '''26000000-0000-4000-8000-0000000000d1'''

-- ── Fixtures ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  (:u_coord, 'coord126@example.com'), (:u_editor, 'editor126@example.com'), (:u_comms, 'comms126@example.com'),
  (:u_nobody, 'nobody126@example.com'), (:u_other, 'other126@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:c, 'cr126', 'Content Center', 'CCR', 'TX', 'active', 'America/Chicago'),
  (:c2, 'cr126b', 'Other Content Center', 'OCC', 'TX', 'active', 'America/Chicago');
insert into app.role_grants (center_id, user_id, role_key, scope_kind) values
  (:c, :u_coord, 'religious_coordinator', 'center'), (:c, :u_editor, 'content_editor', 'center'),
  (:c, :u_comms, 'communications_officer', 'center'), (:c2, :u_other, 'center_admin', 'center');

-- Waiting (in_review): a sutra 10 days old (the oldest), two sections of one imported web page, a faq, a stavan. Everything else is not in the queue.
insert into app.content_items (id, center_id, kind, slug, title, body_md, metadata, status, updated_at) values
  (:it_oldest, :c, 'sutra', 'sutra-126', 'Namokar sutra', 'SECRET-BODY-126 one', '{}', 'in_review', now() - interval '10 days'),
  (gen_random_uuid(), :c, 'niva_source', 'visit-1', 'Visiting hours: weekdays', 'SECRET-BODY-126 two',
     '{"imported": true, "source_url": "https://example.org/visit", "page_title": "Visiting"}', 'in_review', now() - interval '5 days'),
  (gen_random_uuid(), :c, 'niva_source', 'visit-2', 'Visiting hours: weekends', 'SECRET-BODY-126 three',
     '{"imported": true, "source_url": "https://example.org/visit", "page_title": "Visiting"}', 'in_review', now() - interval '5 days' + interval '1 hour'),
  (gen_random_uuid(), :c, 'faq', 'faq-126', 'Where do I park?', 'SECRET-BODY-126 four', '{}', 'in_review', now() - interval '2 days'),
  (gen_random_uuid(), :c, 'stavan', 'stavan-126', 'Evening stavan', null, '{}', 'in_review', now() - interval '1 day'),
  -- Not waiting: a published source nobody has edited for 200 days whose web page changed, a published one whose page lost the section,
  -- a draft, a retired one that also lost its section (not counted), and a published one that is current.
  (gen_random_uuid(), :c, 'niva_source', 'changed-1', 'Library hours', 'old', '{"imported": true, "source_url": "https://example.org/lib", "page_title": "Library", "page_changed": true}', 'published', now() - interval '200 days'),
  (gen_random_uuid(), :c, 'niva_source', 'orphan-1', 'Old camp page', 'old', '{"imported": true, "source_url": "https://example.org/camp", "page_title": "Camp", "orphaned": true}', 'published', now() - interval '3 days'),
  (gen_random_uuid(), :c, 'niva_source', 'draft-1', 'A draft', 'draft', '{}', 'draft', now() - interval '1 day'),
  (gen_random_uuid(), :c, 'niva_source', 'retired-1', 'Retired page', 'x', '{"imported": true, "source_url": "https://example.org/gone", "orphaned": true}', 'retired', now() - interval '1 day'),
  (gen_random_uuid(), :c, 'niva_source', 'current-1', 'Current page', 'x', '{"imported": true, "source_url": "https://example.org/now"}', 'published', now() - interval '1 day'),
  -- The media library.
  (gen_random_uuid(), :c, 'video', 'video-1', 'Pravachan', null, '{}', 'published', now() - interval '1 day'),
  (gen_random_uuid(), :c, 'video', 'video-2', 'Pravachan 2', null, '{}', 'draft', now() - interval '1 day'),
  (gen_random_uuid(), :c, 'podcast', 'pod-1', 'Weekly talk', null, '{}', 'published', now() - interval '1 day'),
  (gen_random_uuid(), :c, 'recipe', 'recipe-1', 'Kitchari', null, '{}', 'retired', now() - interval '1 day'),
  -- Another community's waiting item must never show up.
  (gen_random_uuid(), :c2, 'faq', 'faq-other', 'Other community faq', 'x', '{}', 'in_review', now() - interval '30 days');

-- Member photos: an album with a photo of a child (3 days old), an album without (1 day old), an album already decided.
insert into app.photo_albums (id, center_id, title, visibility) values
  (:al_kids, :c, 'Zoya birthday party', 'members'), (:al_plain, :c, 'Picnic', 'members'), (:al_done, :c, 'Done album', 'members');
insert into app.photos (center_id, album_id, storage_path, caption, contains_children, status, created_at) values
  (:c, :al_kids, 'secret-path-126/kids-1.jpg', 'SECRET-CAPTION-126 a child', true, 'pending', now() - interval '3 days'),
  (:c, :al_kids, 'secret-path-126/kids-2.jpg', 'SECRET-CAPTION-126 adults', false, 'pending', now() - interval '2 days'),
  (:c, :al_plain, 'secret-path-126/plain-1.jpg', 'SECRET-CAPTION-126 plain', false, 'pending', now() - interval '1 day'),
  (:c, :al_done, 'secret-path-126/done-1.jpg', 'SECRET-CAPTION-126 done', false, 'approved', now() - interval '9 days');

-- ── A. The approval queue ─────────────────────────────────────────────────────────────
select pg_temp.sign_in(:u_coord);
select pg_temp.keep('q', app.content_queue_summary(:c));
select pg_temp.assert((pg_temp.got('q')->>'total')::int = 5, 'A1 five items wait (the other community''s item, drafts and published items do not count)');
select pg_temp.assert((pg_temp.got('q')->>'shown')::int = 5 and jsonb_array_length(pg_temp.got('q')->'items') = 5, 'A2 all five are listed when they fit under the limit');
select pg_temp.assert(pg_temp.got('q')->'items'->0->>'title' = 'Namokar sutra' and pg_temp.got('q')->'items'->0->>'id' = :it_oldest,
  'A3 the oldest comes first');
select pg_temp.assert(pg_temp.got('q')->'items'->0->>'kind' = 'sutra'
  and (pg_temp.got('q')->'items'->0->>'waiting_since')::timestamptz < now() - interval '9 days'
  and (pg_temp.got('q')->>'oldest_at')::timestamptz = (pg_temp.got('q')->'items'->0->>'waiting_since')::timestamptz,
  'A4 each item says how long it has waited, and the oldest date is the first item''s');
select pg_temp.assert((select count(*) from jsonb_array_elements(pg_temp.got('q')->'by_kind')) = 4
  and (select (e->>'n')::int from jsonb_array_elements(pg_temp.got('q')->'by_kind') e where e->>'kind' = 'niva_source') = 2
  and (select (e->>'n')::int from jsonb_array_elements(pg_temp.got('q')->'by_kind') e where e->>'kind' = 'sutra') = 1
  and (select (e->>'n')::int from jsonb_array_elements(pg_temp.got('q')->'by_kind') e where e->>'kind' = 'faq') = 1
  and (select (e->>'n')::int from jsonb_array_elements(pg_temp.got('q')->'by_kind') e where e->>'kind' = 'stavan') = 1,
  'A5 the numbers by kind');
select pg_temp.assert((select count(*) from jsonb_array_elements(pg_temp.got('q')->'items') e where e->>'page_url' = 'https://example.org/visit' and e->>'page_title' = 'Visiting') = 2
  and (select count(*) from jsonb_array_elements(pg_temp.got('q')->'items') e where e->>'page_url' is not null) = 2,
  'A6 the two sections of an imported web page say which page they came from; other items say nothing');
select pg_temp.keep('q2', app.content_queue_summary(:c, 2));
select pg_temp.assert((pg_temp.got('q2')->>'total')::int = 5 and (pg_temp.got('q2')->>'shown')::int = 2, 'A7 a limit shortens the list, not the count');
select pg_temp.keep('q0', app.content_queue_summary(:c, 0));
select pg_temp.assert((pg_temp.got('q0')->>'shown')::int = 1, 'A8 a limit below one is one');

-- ── B. Photos: counts only ────────────────────────────────────────────────────────────
select pg_temp.assert((pg_temp.got('q')->>'can_see_photos')::boolean
  and (pg_temp.got('q')->'photos'->>'photos')::int = 3 and (pg_temp.got('q')->'photos'->>'albums')::int = 2
  and (pg_temp.got('q')->'photos'->>'with_children')::int = 1,
  'B1 three photos in two albums wait; one of them has a child in it; the decided photo is not counted');
select pg_temp.assert((select e->>'title' is null and (e->>'has_children')::boolean and (e->>'waiting')::int = 2
                         from jsonb_array_elements(pg_temp.got('q')->'photos'->'by_album') e where e->>'album_id' = :al_kids),
  'B2 the album with a photo of a child has no title in the answer');
select pg_temp.assert((select e->>'title' = 'Picnic' and not (e->>'has_children')::boolean and (e->>'waiting')::int = 1
                         from jsonb_array_elements(pg_temp.got('q')->'photos'->'by_album') e where e->>'album_id' = :al_plain),
  'B3 an album without children keeps its title');
select pg_temp.assert(pg_temp.got('q')::text !~ 'secret-path-126|SECRET-CAPTION-126|Zoya|storage_path|caption|uploaded_by',
  'B4 no photo path, caption or uploader, and no child''s name, anywhere in the answer');

-- ── D. The text of an item never comes back ────────────────────────────────────────────
select pg_temp.assert(pg_temp.got('q')::text !~ 'SECRET-BODY-126|body_md', 'D1 the queue answer holds no item text');

-- ── C. Who may read ───────────────────────────────────────────────────────────────────
select pg_temp.sign_in(:u_editor);
select pg_temp.keep('qe', app.content_queue_summary(:c));
select pg_temp.assert((pg_temp.got('qe')->>'total')::int = 5 and not (pg_temp.got('qe')->>'can_see_photos')::boolean and pg_temp.got('qe')->'photos' = 'null'::jsonb,
  'C1 an editor who only drafts reads the queue but sees no photo counts');
select pg_temp.sign_in(:u_comms);
select pg_temp.assert(app.content_queue_summary(:c) is null and app.content_library_summary(:c) is null, 'C2 content.view alone reads none of these rows, so it gets null and not zeros');
select pg_temp.sign_in(:u_nobody);
select pg_temp.assert(app.content_queue_summary(:c) is null and app.content_library_summary(:c) is null, 'C3 someone with no content permission gets null, not zeros');
select pg_temp.sign_in(:u_other);
select pg_temp.assert(app.content_queue_summary(:c) is null and app.content_library_summary(:c) is null, 'C4 a person of another community gets null for this one');
select pg_temp.assert((app.content_queue_summary(:c2)->>'total')::int = 1, 'C5 and sees only their own community''s queue');
select pg_temp.assert(app.content_queue_summary(null) is null and app.content_library_summary(null) is null, 'C6 a missing community gets null');

-- ── E. Niva's sources and the media library ─────────────────────────────────────────────
select pg_temp.sign_in(:u_coord);
select pg_temp.keep('l', app.content_library_summary(:c));
select pg_temp.assert((pg_temp.got('l')->'niva'->'by_status'->>'published')::int = 3
  and (pg_temp.got('l')->'niva'->'by_status'->>'in_review')::int = 2
  and (pg_temp.got('l')->'niva'->'by_status'->>'draft')::int = 1
  and (pg_temp.got('l')->'niva'->'by_status'->>'retired')::int = 1,
  'E1 Niva''s sources by status (3 published, 2 waiting, 1 draft, 1 retired)');
select pg_temp.assert((pg_temp.got('l')->'niva'->>'imported_pages')::int = 4,
  'E2 four imported pages are in use (visit, library, camp, current); the retired one is not counted');
select pg_temp.assert((pg_temp.got('l')->'niva'->>'stale_pages_total')::int = 2 and jsonb_array_length(pg_temp.got('l')->'niva'->'stale_pages') = 2
  and (select (e->>'changed')::int = 1 and (e->>'orphaned')::int = 0 and e->>'title' = 'Library'
         from jsonb_array_elements(pg_temp.got('l')->'niva'->'stale_pages') e where e->>'url' = 'https://example.org/lib')
  and (select (e->>'changed')::int = 0 and (e->>'orphaned')::int = 1
         from jsonb_array_elements(pg_temp.got('l')->'niva'->'stale_pages') e where e->>'url' = 'https://example.org/camp'),
  'E3 two stale pages: one whose web page changed, one whose page lost the section; the retired section is left out');
select pg_temp.assert((pg_temp.got('l')->'niva'->>'published_not_edited_for_days')::int = 180 and (pg_temp.got('l')->'niva'->>'published_not_edited')::int = 1,
  'E4 one published source has not been edited for 180 days');
select pg_temp.assert((app.content_library_summary(:c, 400)->'niva'->>'published_not_edited')::int = 0
  and (app.content_library_summary(:c, 100)->'niva'->>'published_not_edited')::int = 1,
  'E5 the number of days is a choice');
select pg_temp.assert((pg_temp.got('l')->'media'->'video'->>'published')::int = 1 and (pg_temp.got('l')->'media'->'video'->>'draft')::int = 1
  and (pg_temp.got('l')->'media'->'podcast'->>'published')::int = 1 and (pg_temp.got('l')->'media'->'recipe'->>'retired')::int = 1
  and (pg_temp.got('l')->'media'->'stavan'->>'in_review')::int = 1,
  'E6 the media library by kind and status');
select pg_temp.assert(pg_temp.got('l')::text !~ 'SECRET-BODY-126|body_md', 'E7 the library answer holds no item text');
select pg_temp.sign_in(:u_editor);
select pg_temp.assert(app.content_library_summary(:c) is not null, 'E8 an editor may read the library counts');

-- ── F. Security invoker, signed-in people only ──────────────────────────────────────────
reset role;
select pg_temp.assert((select bool_and(not p.prosecdef) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname in ('content_queue_summary', 'content_library_summary')),
  'F1 both functions are security invoker');
select pg_temp.assert(not has_function_privilege('anon', 'app.content_queue_summary(uuid, integer)', 'execute')
  and not has_function_privilege('anon', 'app.content_library_summary(uuid, integer)', 'execute')
  and has_function_privilege('authenticated', 'app.content_queue_summary(uuid, integer)', 'execute')
  and has_function_privilege('authenticated', 'app.content_library_summary(uuid, integer)', 'execute'),
  'F2 signed-in people may call them; guests may not');

rollback;
\echo 'PASS: content reads tests'
