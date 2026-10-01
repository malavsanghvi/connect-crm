-- 0564: importing the photos of an album's Google Photos link. Staff with content.manage queue the import
-- (Content module on, a Google Photos shared-album link, one import at a time); only the background service
-- can write; imported photos are always PENDING; a photo already in the album is never added again, in any
-- status (a rejected or removed one is never resurrected); invalid addresses are ignored; the per-run (1000)
-- and per-album (2000) limits hold; the album remembers its last result and its last failure in plain English.
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
-- n fake base addresses "<prefix>NNNN": the shape Google serves, with invented tokens.
create or replace function pg_temp.urls(p_prefix text, p_from int, p_to int) returns jsonb language sql as $$
  select coalesce(jsonb_agg('https://lh3.googleusercontent.com/pw/' || p_prefix || lpad(g::text, 5, '0') || repeat('x', 40) order by g), '[]'::jsonb)
    from generate_series(p_from, p_to) g
$$;
grant connect_worker to postgres;

-- ── Fixtures ───────────────────────────────────────────────────────────────
\set c1 '''53000000-0000-4000-8000-0000000000c1'''
\set c2 '''53000000-0000-4000-8000-0000000000c2'''
\set admin '''53000000-0000-4000-8000-000000000001'''
\set editor '''53000000-0000-4000-8000-000000000002'''
\set mom '''53000000-0000-4000-8000-000000000003'''
\set admin2 '''53000000-0000-4000-8000-000000000004'''
\set p_mom '''53000000-0000-4000-8000-0000000000a1'''
\set h1 '''53000000-0000-4000-8000-0000000000b1'''
\set a_short '''53000000-0000-4000-8000-000000000d01'''
\set a_long '''53000000-0000-4000-8000-000000000d02'''
\set a_none '''53000000-0000-4000-8000-000000000d03'''
\set a_other '''53000000-0000-4000-8000-000000000d04'''
\set a_single '''53000000-0000-4000-8000-000000000d05'''
\set a_c2 '''53000000-0000-4000-8000-000000000d06'''
\set a_caps '''53000000-0000-4000-8000-000000000d07'''
\set a_missing '''53000000-0000-4000-8000-000000000dff'''

insert into auth.users (id, email) values (:admin, 'admin53@example.com'), (:editor, 'editor53@example.com'), (:mom, 'mom53@example.com'), (:admin2, 'admin53b@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, environment) values
  (:c1, 'orbit53', 'Orbit 53 Community', 'O53', 'TX', 'active', 'production'),
  (:c2, 'orbit53b', 'Other 53 Community', 'O53B', 'TX', 'active', 'production');
insert into app.households (id, center_id, display_name) values (:h1, :c1, 'Shah household 53');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values (:p_mom, :c1, 'Mira', 'Shah', date '1980-01-01');
insert into app.household_members (household_id, person_id, center_id, role) values (:h1, :p_mom, :c1, 'primary');
insert into app.center_users (center_id, user_id, person_id) values (:c1, :mom, :p_mom);
insert into app.role_grants (center_id, user_id, role_key) values
  (:c1, :admin, 'center_admin'),
  (:c1, :editor, 'content_editor'),          -- content.view and content.draft, not content.manage
  (:c2, :admin2, 'center_admin');
insert into app.photo_albums (id, center_id, title, external_url, visibility) values
  (:a_short, :c1, 'Short link album', 'https://photos.app.goo.gl/FakeShortId12345', 'members'),
  (:a_long, :c1, 'Long link album', 'https://photos.google.com/share/AF1QipFAKEALBUMKEYFAKEALBUMKEYFAKEALBUMKEY00?key=FAKESHAREKEY00', 'members'),
  (:a_none, :c1, 'No link album', null, 'members'),
  (:a_other, :c1, 'Other site album', 'https://example.com/album/abc', 'members'),
  (:a_single, :c1, 'Single photo link', 'https://photos.google.com/photo/AF1QipFAKEALBUMKEYFAKEALBUMKEYFAKEALBUMKEY00', 'members'),
  (:a_c2, :c2, 'Other community album', 'https://photos.app.goo.gl/FakeOtherId12345', 'members'),
  (:a_caps, :c1, 'Limits album', 'https://photos.app.goo.gl/FakeLimitsId1234', 'members');

-- ── Which links count as Google Photos albums ──────────────────────────────
select pg_temp.assert(app.is_google_photos_album_url('https://photos.app.goo.gl/FakeShortId12345')
                      and app.is_google_photos_album_url('  http://photos.app.goo.gl/FakeShortId12345?x=1  ')
                      and app.is_google_photos_album_url('https://photos.google.com/share/AF1QipFAKEALBUMKEYFAKEALBUMKEYFAKE?key=abc')
                      and app.is_google_photos_album_url('https://photos.google.com/u/2/share/AF1QipFAKEALBUMKEYFAKEALBUMKEYFAKE?key=abc&pli=1'),
  'short links and share links are Google Photos albums');
select pg_temp.assert(not app.is_google_photos_album_url(null) and not app.is_google_photos_album_url('') and not app.is_google_photos_album_url('   ')
                      and not app.is_google_photos_album_url('https://example.com/FakeShortId12345')
                      and not app.is_google_photos_album_url('https://photos.app.goo.gl.evil.example/FakeShortId12345')
                      and not app.is_google_photos_album_url('https://evilphotos.google.com/share/AF1QipFAKEALBUMKEYFAKEALBUMKEYFAKE')
                      and not app.is_google_photos_album_url('https://photos.google.com/photo/AF1QipFAKEALBUMKEYFAKEALBUMKEYFAKE')
                      and not app.is_google_photos_album_url('https://photos.google.com/albums/AF1QipFAKEALBUMKEYFAKEALBUMKEYFAKE')
                      and not app.is_google_photos_album_url('https://photos.app.goo.gl/short')
                      and not app.is_google_photos_album_url('ftp://photos.app.goo.gl/FakeShortId12345')
                      and not app.is_google_photos_album_url('https://user@photos.app.goo.gl/FakeShortId12345')
                      and not app.is_google_photos_album_url('https://photos.app.goo.gl/FakeShortId12345 and more'),
  'nothing else is: empty, other sites, look-alike hosts, a single photo, a private album page, short ids, other schemes');

-- ── Who may call what ──────────────────────────────────────────────────────
select pg_temp.assert(has_function_privilege('authenticated', 'app.import_external_album(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.photo_album_import_status(uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.import_external_album(uuid)', 'execute')
                      and not has_function_privilege('connect_worker', 'app.import_external_album(uuid)', 'execute'),
  'signed-in staff can queue an import and read its status; anonymous callers and the worker cannot queue one');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.photos_worker_save_import(uuid, uuid, jsonb, integer, integer, text)', 'execute')
                      and not has_function_privilege('anon', 'app.photos_worker_save_import(uuid, uuid, jsonb, integer, integer, text)', 'execute')
                      and not has_function_privilege('service_role', 'app.photos_worker_save_import(uuid, uuid, jsonb, integer, integer, text)', 'execute')
                      and has_function_privilege('connect_worker', 'app.photos_worker_save_import(uuid, uuid, jsonb, integer, integer, text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.photos_worker_record_failure(uuid, uuid, text)', 'execute')
                      and has_function_privilege('connect_worker', 'app.photos_worker_record_failure(uuid, uuid, text)', 'execute'),
  'only the background service can save imported photos or record a failure');

-- ── Staff queue the import ─────────────────────────────────────────────────
begin;
select pg_temp.sign_in(:admin);
select app.import_external_album(:a_short::uuid) as job1 \gset
commit;
select pg_temp.assert((select kind = 'photos.import_album' and status = 'queued' and center_id = :c1::uuid and created_by = :admin::uuid
                              and payload->>'album_id' = :a_short and payload->>'url' = 'https://photos.app.goo.gl/FakeShortId12345'
                         from app.jobs where id = :'job1'::bigint),
  'a content manager queues one photos.import_album job carrying the album and its link');
begin;
select pg_temp.sign_in(:admin);
select pg_temp.assert_raises($$select app.import_external_album('53000000-0000-4000-8000-000000000d01'::uuid)$$, 'already running', 'a second import of the same album is refused while one is queued');
commit;
select pg_temp.assert((select count(*) from app.jobs where kind = 'photos.import_album' and payload->>'album_id' = :a_short) = 1, 'the refused click queued nothing');
update app.jobs set status = 'running', locked_by = 'w', locked_at = now() where id = :'job1'::bigint;
begin;
select pg_temp.sign_in(:admin);
select pg_temp.assert_raises($$select app.import_external_album('53000000-0000-4000-8000-000000000d01'::uuid)$$, 'already running', 'and refused while it is running');
commit;
update app.jobs set status = 'done', finished_at = now() where id = :'job1'::bigint;
begin;
select pg_temp.sign_in(:admin);
select app.import_external_album(:a_short::uuid) as job2 \gset
select app.import_external_album(:a_long::uuid) as job3 \gset
commit;
select pg_temp.assert(:'job2'::bigint > :'job1'::bigint and :'job3'::bigint > :'job2'::bigint, 'once the first import finished it can be queued again, and another album has its own queue');
update app.jobs set status = 'failed', finished_at = now(), last_error = 'Google did not return the album page; try again later.' where id = :'job2'::bigint;
update app.jobs set status = 'done', finished_at = now() where id = :'job3'::bigint;

-- ── Refusals ───────────────────────────────────────────────────────────────
begin;
select pg_temp.sign_in(:editor);
select pg_temp.assert_raises($$select app.import_external_album('53000000-0000-4000-8000-000000000d01'::uuid)$$, 'needs content.manage', 'a content editor (no content.manage) cannot queue an import');
select pg_temp.assert_raises($$select * from app.photo_album_import_status('53000000-0000-4000-8000-000000000d01'::uuid)$$, 'needs content.manage', 'nor read its status');
commit;
begin;
select pg_temp.sign_in(:mom);
select pg_temp.assert_raises($$select app.import_external_album('53000000-0000-4000-8000-000000000d01'::uuid)$$, 'needs content.manage', 'a member cannot queue an import');
commit;
begin;
select pg_temp.sign_in(:admin2);
select pg_temp.assert_raises($$select app.import_external_album('53000000-0000-4000-8000-000000000d01'::uuid)$$, 'needs content.manage', 'an admin of another community cannot queue an import here');
select pg_temp.assert_raises($$select * from app.photo_album_import_status('53000000-0000-4000-8000-000000000d01'::uuid)$$, 'needs content.manage', 'nor read its status');
commit;
select pg_temp.assert_raises($$select app.import_external_album('53000000-0000-4000-8000-000000000d01'::uuid)$$, 'sign in', 'a signed-out caller is refused');
begin;
select pg_temp.sign_in(:admin);
select pg_temp.assert_raises($$select app.import_external_album('53000000-0000-4000-8000-000000000d03'::uuid)$$, 'no Google Photos link', 'an album without a link is refused');
select pg_temp.assert_raises($$select app.import_external_album('53000000-0000-4000-8000-000000000d04'::uuid)$$, 'no Google Photos link', 'a link to another site is refused');
select pg_temp.assert_raises($$select app.import_external_album('53000000-0000-4000-8000-000000000d05'::uuid)$$, 'no Google Photos link', 'a link to a single Google photo (not a shared album) is refused');
select pg_temp.assert_raises($$select app.import_external_album('53000000-0000-4000-8000-000000000dff'::uuid)$$, 'was not found', 'an unknown album is refused');
commit;
select pg_temp.assert((select count(*) from app.jobs where kind = 'photos.import_album') = 3, 'no refused request queued a job');

-- The Content module off: the import is refused, and so is saving a late result.
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c1, 'content', false, 'test 53')
  on conflict (center_id, module_key) do update set enabled = false;
begin;
select pg_temp.sign_in(:admin);
select pg_temp.assert_raises($$select app.import_external_album('53000000-0000-4000-8000-000000000d07'::uuid)$$, 'module is switched off', 'with the Content module off the import is refused');
commit;
begin;
set local role connect_worker;
select pg_temp.assert_raises($$select app.photos_worker_save_import('53000000-0000-4000-8000-0000000000c1'::uuid, '53000000-0000-4000-8000-000000000d07'::uuid, '["https://lh3.googleusercontent.com/pw/MODxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"]'::jsonb, 1, 0, null)$$, 'module is switched off', 'and the worker does not add photos');
commit;
update app.center_modules set enabled = true where center_id = :c1 and module_key = 'content';
select pg_temp.assert((select count(*) from app.photos where album_id = :a_caps) = 0, 'nothing was added while the module was off');

-- ── The status staff see ───────────────────────────────────────────────────
begin;
select pg_temp.sign_in(:admin);
select app.photo_album_import_status(:a_short::uuid) as st1 \gset
select app.import_external_album(:a_short::uuid) as job4 \gset
select app.photo_album_import_status(:a_short::uuid) as st2 \gset
commit;
select pg_temp.assert((:'st1'::jsonb->>'importing')::boolean = false and (:'st1'::jsonb->>'has_link')::boolean
                      and :'st1'::jsonb->>'synced_at' is null and :'st1'::jsonb->>'photo_count' is null,
  'before any import the status says nothing was imported yet');
select pg_temp.assert(:'st1'::jsonb->>'error' = 'Google did not return the album page; try again later.',
  'a job that failed without the worker recording it still shows its plain-English reason');
select pg_temp.assert((:'st2'::jsonb->>'importing')::boolean and :'st2'::jsonb->>'since' is not null, 'while a job is queued the status says importing');
update app.jobs set status = 'cancelled', finished_at = now() where id = :'job4'::bigint;

-- ── Only the background service writes ─────────────────────────────────────
select pg_temp.urls('AAA', 1, 5) as u_a5 \gset
begin;
select pg_temp.sign_in(:admin);
select pg_temp.assert_raises($$select app.photos_worker_save_import('53000000-0000-4000-8000-0000000000c1'::uuid, '53000000-0000-4000-8000-000000000d02'::uuid, '[]'::jsonb, 0, 0, null)$$,
  'permission denied', 'even a center admin cannot write imported photos directly');
select pg_temp.assert_raises($$select app.photos_worker_record_failure('53000000-0000-4000-8000-0000000000c1'::uuid, '53000000-0000-4000-8000-000000000d02'::uuid, 'x')$$,
  'permission denied', 'nor record a failure');
commit;

-- ── The worker adds the photos, all pending ────────────────────────────────
begin;
set local role connect_worker;
select app.photos_worker_save_import(:c1::uuid, :a_long::uuid, :'u_a5'::jsonb, 5, 1, null) as r1 \gset
commit;
select pg_temp.assert(:'r1'::jsonb = '{"found": 5, "added": 5, "already_there": 0, "not_added_limit": 0, "videos_skipped": 1}'::jsonb, 'five photos found, five added, one video skipped');
select pg_temp.assert((select count(*) = 5 and bool_and(status = 'pending' and uploaded_by is null and moderated_by is null and not contains_children
                                                        and center_id = :c1::uuid and storage_path not like '%=%'
                                                        and storage_path like 'https://lh3.googleusercontent.com/pw/AAA%')
                         from app.photos where album_id = :a_long::uuid),
  'every imported photo is pending, with no uploader, no moderator, not marked as children, and the bare base address as its path');
select pg_temp.assert((select count(distinct created_at) = 5 and array_agg(storage_path order by created_at) = array_agg(storage_path order by storage_path)
                         from app.photos where album_id = :a_long::uuid),
  'created_at steps up one photo at a time, so the app shows them in the album''s order');
select pg_temp.assert((select external_synced_at is not null and external_photo_count = 5 and external_sync_error is null from app.photo_albums where id = :a_long::uuid),
  'the album remembers when it was imported and how many photos were found');
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'photos' and center_id = :c1::uuid and client_app = 'job'
                         and reason like 'Imported from the album%') = 5,
  'each photo is audited with the import as the reason, as a background job');

-- Members see approved photos only: imported ones wait for a content manager.
begin;
select pg_temp.sign_in(:mom);
select count(*) as n_mom0 from app.photos where album_id = :a_long::uuid \gset
commit;
select pg_temp.assert(:'n_mom0'::int = 0, 'a member sees none of the imported photos while they are waiting for approval');
begin;
select pg_temp.sign_in(:admin);
select count(*) as n_admin0 from app.photos where album_id = :a_long::uuid \gset
update app.photos set status = 'approved', moderated_by = :admin::uuid
  where album_id = :a_long::uuid and (storage_path like '%AAA00001%' or storage_path like '%AAA00002%');
commit;
select pg_temp.assert(:'n_admin0'::int = 5, 'a content manager sees all five');
begin;
select pg_temp.sign_in(:mom);
select count(*) as n_mom2 from app.photos where album_id = :a_long::uuid \gset
commit;
select pg_temp.assert(:'n_mom2'::int = 2, 'once two are approved, a member sees exactly those two');

-- ── Running it again adds only what is new ─────────────────────────────────
select pg_temp.urls('AAA', 1, 7) || pg_temp.urls('AAA', 6, 7) as u_a7 \gset
begin;
set local role connect_worker;
select app.photos_worker_save_import(:c1::uuid, :a_long::uuid, :'u_a7'::jsonb, 7, 0, null) as r2 \gset
commit;
select pg_temp.assert(:'r2'::jsonb = '{"found": 7, "added": 2, "already_there": 5, "not_added_limit": 0, "videos_skipped": 0}'::jsonb,
  'a second run adds the two new photos and skips the five already there (an address listed twice counts once)');
select pg_temp.assert((select count(*) = 7 and count(distinct storage_path) = 7 from app.photos where album_id = :a_long::uuid), 'no duplicates');
select pg_temp.assert((select count(*) = 2 from app.photos where album_id = :a_long::uuid and status = 'approved'), 'photos approved earlier stay approved');

-- Rejected and removed photos are never resurrected.
update app.photos set status = 'rejected', moderated_by = :admin::uuid where album_id = :a_long::uuid and storage_path like '%AAA00003%';
update app.photos set status = 'removed', moderated_by = :admin::uuid where album_id = :a_long::uuid and storage_path like '%AAA00004%';
select pg_temp.urls('AAA', 1, 8) as u_a8 \gset
begin;
set local role connect_worker;
select app.photos_worker_save_import(:c1::uuid, :a_long::uuid, :'u_a8'::jsonb, 8, 0, null) as r3 \gset
commit;
select pg_temp.assert((:'r3'::jsonb->>'added')::int = 1 and (:'r3'::jsonb->>'already_there')::int = 7, 'a third run adds only photo 8');
select pg_temp.assert((select count(*) = 8 from app.photos where album_id = :a_long::uuid)
                      and (select status = 'rejected' from app.photos where album_id = :a_long::uuid and storage_path like '%AAA00003%')
                      and (select status = 'removed' from app.photos where album_id = :a_long::uuid and storage_path like '%AAA00004%'),
  'a rejected photo stays rejected and a removed one stays removed; neither is added again');
select pg_temp.assert((select count(*) = 1 from app.photos where album_id = :a_long::uuid and storage_path like '%AAA00003%')
                      and (select count(*) = 1 from app.photos where album_id = :a_long::uuid and storage_path like '%AAA00004%'),
  'and no second row appears for them');

-- A photo saved with a size suffix is the same photo.
insert into app.photos (center_id, album_id, storage_path, status)
  values (:c1, :a_long, 'https://lh3.googleusercontent.com/pw/SUF00001' || repeat('x', 40) || '=w600-h400', 'approved');
select pg_temp.urls('SUF', 1, 2) as u_suf \gset
begin;
set local role connect_worker;
select app.photos_worker_save_import(:c1::uuid, :a_long::uuid, :'u_suf'::jsonb, 2, 0, null) as r4 \gset
commit;
select pg_temp.assert((:'r4'::jsonb->>'added')::int = 1 and (:'r4'::jsonb->>'already_there')::int = 1,
  'an address already in the album with a "=size" suffix is recognised, not added twice');

-- Addresses that are not Google image addresses are ignored, whatever the worker sends.
select ('["https://evil.example.com/pw/' || repeat('a', 60) || '","https://lh3.googleusercontent.com/pw/short",123,null,"https://lh3.googleusercontent.com/pw/' || repeat('b', 60)
        || '=w100","http://lh3.googleusercontent.com/pw/' || repeat('c', 60) || '","https://lh9.googleusercontent.com/pw/' || repeat('d', 60) || '"]')::jsonb
       || pg_temp.urls('VAL', 1, 1) as u_bad \gset
begin;
set local role connect_worker;
select app.photos_worker_save_import(:c1::uuid, :a_long::uuid, :'u_bad'::jsonb, 1, 0, null) as r5 \gset
commit;
select pg_temp.assert((:'r5'::jsonb->>'found')::int = 1 and (:'r5'::jsonb->>'added')::int = 1
                      and not exists (select 1 from app.photos where album_id = :a_long::uuid and (storage_path like '%evil.example%' or storage_path like '%/short' or storage_path like 'http:%' or storage_path like '%lh9%' or storage_path like '%=w100')),
  'another site, a short token, a size suffix, plain http, an unknown host, numbers and nulls are all ignored; only the valid address is added');

-- Bad calls.
begin;
set local role connect_worker;
select pg_temp.assert_raises($$select app.photos_worker_save_import('53000000-0000-4000-8000-0000000000c1'::uuid, '53000000-0000-4000-8000-000000000d02'::uuid, '{"a":1}'::jsonb, 0, 0, null)$$, 'as a list', 'the addresses must be a list');
select pg_temp.assert_raises($$select app.photos_worker_save_import('53000000-0000-4000-8000-0000000000c1'::uuid, '53000000-0000-4000-8000-000000000dff'::uuid, '[]'::jsonb, 0, 0, null)$$, 'no longer exists', 'an album that does not exist is refused');
select pg_temp.assert_raises($$select app.photos_worker_save_import('53000000-0000-4000-8000-0000000000c1'::uuid, '53000000-0000-4000-8000-000000000d06'::uuid, '[]'::jsonb, 0, 0, null)$$, 'no longer exists', 'an album of another community is refused');
select pg_temp.assert_raises($$select app.photos_worker_save_import(null, '53000000-0000-4000-8000-000000000d02'::uuid, '[]'::jsonb, 0, 0, null)$$, 'needs the community', 'no community is refused');
commit;

-- ── The album remembers a failure, in plain English, until the next good import ──
begin;
set local role connect_worker;
select app.photos_worker_record_failure(:c1::uuid, :a_long::uuid, 'No photos were found — the album may be private, empty, or Google changed its page.');
commit;
select pg_temp.assert((select external_sync_error = 'No photos were found — the album may be private, empty, or Google changed its page.' and external_photo_count is not null and external_synced_at is not null
                         from app.photo_albums where id = :a_long::uuid),
  'a failed import leaves its plain-English reason on the album and keeps the last good result');
begin;
set local role connect_worker;
select app.photos_worker_record_failure(:c2::uuid, :a_long::uuid, 'Someone else''s failure');
commit;
select pg_temp.assert((select external_sync_error like 'No photos were found%' from app.photo_albums where id = :a_long::uuid), 'a failure recorded for the wrong community changes nothing');
begin;
select pg_temp.sign_in(:admin);
select app.photo_album_import_status(:a_long::uuid) as st3 \gset
commit;
select pg_temp.assert(:'st3'::jsonb->>'error' like 'No photos were found%' and (:'st3'::jsonb->>'importing')::boolean = false and :'st3'::jsonb->>'synced_at' is not null,
  'staff see the last error, and that nothing is running');
begin;
set local role connect_worker;
select app.photos_worker_record_failure(:c1::uuid, :a_long::uuid, repeat('e', 900));
commit;
select pg_temp.assert((select char_length(external_sync_error) = 500 from app.photo_albums where id = :a_long::uuid), 'a very long reason is cut to 500 characters');
begin;
set local role connect_worker;
select app.photos_worker_save_import(:c1::uuid, :a_long::uuid, :'u_a8'::jsonb, 8, 0, 'Google stopped answering after 8 photos. Run the import again to bring in the rest.') as r6 \gset
commit;
select pg_temp.assert((select external_sync_error = 'Google stopped answering after 8 photos. Run the import again to bring in the rest.' and external_photo_count = 8
                         from app.photo_albums where id = :a_long::uuid),
  'a partial read is saved with its note beside the count');
begin;
set local role connect_worker;
select app.photos_worker_save_import(:c1::uuid, :a_long::uuid, :'u_a8'::jsonb, 8, 0, null) as r7 \gset
commit;
select pg_temp.assert((select external_sync_error is null from app.photo_albums where id = :a_long::uuid), 'the next clean import clears the error');

-- ── The limits ─────────────────────────────────────────────────────────────
select pg_temp.urls('CAP', 1, 1200) as u_cap \gset
begin;
set local role connect_worker;
select app.photos_worker_save_import(:c1::uuid, :a_caps::uuid, :'u_cap'::jsonb, 1200, 0, null) as r8 \gset
commit;
select pg_temp.assert(:'r8'::jsonb = '{"found": 1200, "added": 1000, "already_there": 0, "not_added_limit": 200, "videos_skipped": 0}'::jsonb, 'one run adds at most 1000 photos');
begin;
set local role connect_worker;
select app.photos_worker_save_import(:c1::uuid, :a_caps::uuid, :'u_cap'::jsonb, 1200, 0, null) as r9 \gset
commit;
select pg_temp.assert(:'r9'::jsonb = '{"found": 1200, "added": 200, "already_there": 1000, "not_added_limit": 0, "videos_skipped": 0}'::jsonb, 'running it again adds the remaining 200');
select pg_temp.urls('DUP', 1, 1500) as u_cap2 \gset
begin;
set local role connect_worker;
select app.photos_worker_save_import(:c1::uuid, :a_caps::uuid, :'u_cap2'::jsonb, 1500, 0, null) as r10 \gset
commit;
select pg_temp.assert(:'r10'::jsonb = '{"found": 1500, "added": 800, "already_there": 0, "not_added_limit": 700, "videos_skipped": 0}'::jsonb, 'an album never holds more than 2000 waiting or approved photos');
select pg_temp.assert((select count(*) from app.photos where album_id = :a_caps::uuid and status in ('pending', 'approved')) = 2000, 'two thousand are waiting');
select pg_temp.urls('NEW', 1, 10) as u_new \gset
begin;
set local role connect_worker;
select app.photos_worker_save_import(:c1::uuid, :a_caps::uuid, :'u_new'::jsonb, 10, 0, null) as r11 \gset
commit;
select pg_temp.assert(:'r11'::jsonb = '{"found": 10, "added": 0, "already_there": 0, "not_added_limit": 10, "videos_skipped": 0}'::jsonb, 'a full album takes nothing more');
update app.photos set status = 'removed' where id in (select id from app.photos where album_id = :a_caps::uuid order by created_at limit 5);
begin;
set local role connect_worker;
select app.photos_worker_save_import(:c1::uuid, :a_caps::uuid, :'u_new'::jsonb, 10, 0, null) as r12 \gset
commit;
select pg_temp.assert((:'r12'::jsonb->>'added')::int = 5 and (:'r12'::jsonb->>'not_added_limit')::int = 5, 'removed photos make room for new ones');
