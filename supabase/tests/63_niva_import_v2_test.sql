-- 0576: Niva web import v2. One way to write a page's address (the apex and www forms are one page, and one job);
-- the final address is saved and earlier forms of it are found again; a section is found by its heading, not its
-- place on the page, and keeps its slug; a section in review, approved or published is never overwritten, but
-- flagged when the page now says something else (and unflagged when it goes back, or when a person takes the page's
-- text); sections the page no longer has are deleted when they are drafts and flagged when they are not; a retired
-- section is left alone; a re-import that finds nothing new does not touch a published row, and no flag gives a
-- published row a new updated_at or changes go-live check 12's evidence. Discovery: content staff queue a search for
-- a site's pages, the worker saves the sitemap's list (same site only, once per page; nothing removed when the search
-- was incomplete; a date-only lastmod in the community's zone), content staff of that community alone read it, and
-- the status shows what Niva already has from each page and names the sections flagged.
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
create or replace function pg_temp.sign_in(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant connect_worker to postgres;

-- The background service saving a page: final address, sections, and the address that was asked for.
create or replace function pg_temp.save(p_center uuid, p_url text, p_sections jsonb, p_requested text default null)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role connect_worker;
  r := app.niva_worker_save_import(p_center, p_url, 'Relocation FAQs', p_sections, null, p_requested);
  reset role;
  return r;
end $$;
create or replace function pg_temp.discover(p_center uuid, p_root text, p_pages jsonb, p_complete boolean default true)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role connect_worker;
  r := app.niva_worker_save_discovery(p_center, p_root, p_pages, p_complete);
  reset role;
  return r;
end $$;
-- One section of the page, by its title.
create or replace function pg_temp.sec(p_center uuid, p_title text) returns app.content_items language sql as $$
  select * from app.content_items where center_id = p_center and kind = 'niva_source' and title = p_title
$$;

-- ── Fixtures ─────────────────────────────────────────────────────────────────
\set c '''63000000-0000-4000-8000-0000000000c1'''
\set c2 '''63000000-0000-4000-8000-0000000000c2'''
\set admin '''63000000-0000-4000-8000-000000000001'''
\set editor '''63000000-0000-4000-8000-000000000002'''
\set member '''63000000-0000-4000-8000-000000000003'''
\set admin2 '''63000000-0000-4000-8000-000000000004'''
insert into auth.users (id, email) values (:admin, 'admin63@example.com'), (:editor, 'editor63@example.com'),
  (:member, 'member63@example.com'), (:admin2, 'admin63b@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status) values
  (:c, 'orbit63', 'Orbit Import Two', 'OI2', 'TX', 'active'),
  (:c2, 'orbit63b', 'Other Import Two', 'OI3', 'TX', 'active');
insert into app.role_grants (center_id, user_id, role_key) values
  (:c, :admin, 'center_admin'), (:c, :editor, 'content_editor'), (:c2, :admin2, 'center_admin');

-- ── One way to write an address ──────────────────────────────────────────────
select pg_temp.assert(app.niva_page_address('HTTPS://WWW.Example.ORG:443/FAQ/?utm_source=x&id=7&UTM_Medium=y&gclid=1#top') = 'https://www.example.org/FAQ?id=7',
  'an address is written one way: lower-case scheme and host, no default port, trailing slash, utm_*/gclid or #fragment; the path keeps its case');
select pg_temp.assert(app.niva_page_address('https://example.org/') = 'https://example.org' and app.niva_page_address('  ') is null,
  'a site''s own address has no trailing slash; a blank is no address');
select pg_temp.assert(app.niva_page_key('https://www.example.org/faq/') = 'example.org/faq'
                      and app.niva_page_key('http://example.org/faq?utm_campaign=z') = 'example.org/faq',
  'the apex and www forms (and http and https) of a page are one page');
select pg_temp.assert(app.niva_page_key('https://example.org/FAQ') <> app.niva_page_key('https://example.org/faq')
                      and app.niva_page_key('https://news.example.org/faq') <> app.niva_page_key('https://example.org/faq')
                      and app.niva_page_key('https://example.org/faq?id=1') <> app.niva_page_key('https://example.org/faq?id=2'),
  'a different path (case counts), another subdomain or another query is another page');

-- ── Staff queue pages: the forms of one page are one job ─────────────────────
begin;
select pg_temp.sign_in(:editor);
select app.niva_import_pages(:c::uuid, array['https://example.org/relocation/', 'https://WWW.example.org/relocation?utm_source=mail',
  'http://www.example.org/relocation#faq', 'https://www.example.org/pathshala']) as n \gset
commit;
select pg_temp.assert(:'n'::int = 2, 'apex, www, trailing-slash, utm and http forms of one page are queued once (content.draft is enough)');
select pg_temp.assert((select array_agg(payload->>'url' order by id) from app.jobs where kind = 'niva.import_page' and center_id = :c::uuid)
                      = array['https://example.org/relocation', 'https://www.example.org/pathshala'],
  'each job carries its address written one way');
select max(run_after) as first_last from app.jobs where kind = 'niva.import_page' and center_id = :c::uuid \gset
begin;
select pg_temp.sign_in(:editor);
select app.niva_import_pages(:c::uuid, array['https://www.example.org/membership']) as n2 \gset
commit;
select pg_temp.assert((select run_after from app.jobs where kind = 'niva.import_page' and payload->>'url' = 'https://www.example.org/membership')
                      >= :'first_last'::timestamptz + interval '4 seconds',
  'a second batch queues after the pages still waiting, so a site is never read by two batches side by side');

-- ── Pages imported before 0576 ───────────────────────────────────────────────
-- As 0540 saved them: the address as typed, slugs by position. One published section and one draft from the apex
-- form, plus a duplicate draft of the first section from the www form with a trailing slash.
insert into app.content_items (center_id, kind, slug, title, body_md, metadata, status, published_at) values
  (:c, 'niva_source', 'web-' || left(md5('https://example.org/relocation'), 10) || '-01', 'Relocation FAQs: The new facility',
   'The new facility has 13 pathshala rooms.',
   jsonb_build_object('imported', true, 'source_url', 'https://example.org/relocation', 'page_title', 'Relocation FAQs', 'section', 1, 'imported_at', now() - interval '3 days'),
   'published', now() - interval '2 days'),
  (:c, 'niva_source', 'web-' || left(md5('https://example.org/relocation'), 10) || '-02', 'Relocation FAQs: Donating',
   'Donations are tax deductible.',
   jsonb_build_object('imported', true, 'source_url', 'https://example.org/relocation', 'page_title', 'Relocation FAQs', 'section', 2, 'imported_at', now() - interval '3 days'),
   'draft', null),
  (:c, 'niva_source', 'web-' || left(md5('https://www.example.org/relocation/'), 10) || '-01', 'Relocation FAQs: The new facility',
   'The new facility has 13 pathshala rooms.',
   jsonb_build_object('imported', true, 'source_url', 'https://www.example.org/relocation/', 'page_title', 'Relocation FAQs', 'section', 1, 'imported_at', now() - interval '3 days'),
   'draft', null);
select id as facility_id, slug as facility_slug, updated_at as facility_touched
  from app.content_items where center_id = :c::uuid and status = 'published' and title = 'Relocation FAQs: The new facility' \gset
select id as donating_id, slug as donating_slug from app.content_items where center_id = :c::uuid and title = 'Relocation FAQs: Donating' \gset

-- The page redirected from the apex form to www; a new heading now opens it.
select pg_temp.save(:c::uuid, 'https://www.example.org/relocation', '[
  {"title":"Relocation FAQs: What is new","heading":"What is new","body":"A new heading at the top of the page."},
  {"title":"Relocation FAQs: The new facility","heading":"The new facility","body":"The new facility has 13 pathshala rooms."},
  {"title":"Relocation FAQs: Donating","heading":"Donating","body":"Donations are tax deductible; ask your CPA."}]'::jsonb,
  'https://example.org/relocation') as r1 \gset
select pg_temp.assert((:'r1'::jsonb->>'created')::int = 1 and (:'r1'::jsonb->>'updated')::int = 1 and (:'r1'::jsonb->>'kept_as_approved')::int = 1
                      and (:'r1'::jsonb->>'changed')::int = 0 and (:'r1'::jsonb->>'removed')::int = 1 and (:'r1'::jsonb->>'orphaned')::int = 0
                      and (:'r1'::jsonb->>'sections')::int = 3 and :'r1'::jsonb->>'url' = 'https://www.example.org/relocation',
  'counts: the new heading is created, the draft refreshed, the published section kept, the www duplicate removed');
select pg_temp.assert((select count(*) from app.content_items where center_id = :c::uuid and title = 'Relocation FAQs: The new facility') = 1,
  'normalisation dedupes the apex and www imports of one page: the duplicate draft is gone, the published section stays');
select pg_temp.assert((select id = :'facility_id'::uuid and body_md = 'The new facility has 13 pathshala rooms.' and status = 'published'
                              and updated_at = :'facility_touched'::timestamptz
                              and metadata->>'source_url' = 'https://example.org/relocation' and metadata->>'page_key' = 'example.org/relocation'
                              and metadata ? 'section_key' and metadata->>'body_hash' = md5(body_md)
                         from app.content_items where id = :'facility_id'::uuid),
  'the published section is found again by its title; its text, its cited address and updated_at stay, and it takes its page key and key once');
select pg_temp.assert((pg_temp.sec(:c::uuid, 'Relocation FAQs: Donating')).id = :'donating_id'::uuid
                      and (pg_temp.sec(:c::uuid, 'Relocation FAQs: Donating')).slug = :'donating_slug'
                      and (pg_temp.sec(:c::uuid, 'Relocation FAQs: Donating')).body_md like '%ask your CPA%',
  'a section saved before 0576 keeps its row and its slug although a heading above it moved it from 2nd to 3rd');
select pg_temp.assert((select metadata->>'source_url' = 'https://www.example.org/relocation' and metadata->>'page_key' = 'example.org/relocation'
                              and (metadata->>'section')::int = 3 and metadata ? 'section_key' and metadata->>'body_hash' = md5(body_md)
                         from app.content_items where id = :'donating_id'::uuid),
  'a refreshed draft carries the final address, its page key, its place, its key and the hash of the page text');
select pg_temp.assert((select slug = 'web-' || left(md5('example.org/relocation'), 10) || '-' || left(md5('example.org/relocation|what is new'), 10)
                              and status = 'draft' and created_by is null
                         from app.content_items where center_id = :c::uuid and title = 'Relocation FAQs: What is new'),
  'a new section''s slug comes from md5(page | heading), not its position');

-- ── A heading inserted above keyed sections moves nothing ────────────────────
select id as whatsnew_id from app.content_items where center_id = :c::uuid and title = 'Relocation FAQs: What is new' \gset
select pg_temp.save(:c::uuid, 'https://www.example.org/relocation', '[
  {"title":"Relocation FAQs: Timeline","heading":"Timeline","body":"Construction starts in spring."},
  {"title":"Relocation FAQs: What is new","heading":"What is new","body":"A new heading at the top of the page."},
  {"title":"Relocation FAQs: The new facility","heading":"The new facility","body":"The new facility has 13 pathshala rooms."},
  {"title":"Relocation FAQs: Donating","heading":"Donating","body":"Donations are tax deductible; ask your CPA."}]'::jsonb) as r2 \gset
select pg_temp.assert((pg_temp.sec(:c::uuid, 'Relocation FAQs: What is new')).id = :'whatsnew_id'::uuid
                      and (pg_temp.sec(:c::uuid, 'Relocation FAQs: What is new')).body_md = 'A new heading at the top of the page.'
                      and (pg_temp.sec(:c::uuid, 'Relocation FAQs: Donating')).id = :'donating_id'::uuid,
  'with a heading inserted on top, every section keeps its own row and text');
select pg_temp.assert((:'r2'::jsonb->>'created')::int = 1 and (:'r2'::jsonb->>'unchanged')::int = 0 and (:'r2'::jsonb->>'updated')::int = 2,
  'only the new heading is created; the moved drafts are rewritten with their new place');
select pg_temp.save(:c::uuid, 'https://www.example.org/relocation', '[
  {"title":"Relocation FAQs: Timeline","heading":"Timeline","body":"Construction starts in spring."},
  {"title":"Relocation FAQs: What is new","heading":"What is new","body":"A new heading at the top of the page."},
  {"title":"Relocation FAQs: The new facility","heading":"The new facility","body":"The new facility has 13 pathshala rooms."},
  {"title":"Relocation FAQs: Donating","heading":"Donating","body":"Donations are tax deductible; ask your CPA."}]'::jsonb) as r3 \gset
select pg_temp.assert((:'r3'::jsonb->>'unchanged')::int = 3 and (:'r3'::jsonb->>'updated')::int = 0 and (:'r3'::jsonb->>'created')::int = 0,
  'importing the same page again changes nothing and says so');

-- ── A changed approved section is flagged, never overwritten ─────────────────
\set changed_page '''[{"title":"Relocation FAQs: Timeline","heading":"Timeline","body":"Construction starts in spring."},{"title":"Relocation FAQs: What is new","heading":"What is new","body":"A new heading at the top of the page."},{"title":"Relocation FAQs: The new facility","heading":"The new facility","body":"The new facility has 20 pathshala rooms."},{"title":"Relocation FAQs: Donating","heading":"Donating","body":"Donations are tax deductible; ask your CPA."}]'''
select pg_temp.save(:c::uuid, 'https://www.example.org/relocation', :changed_page::jsonb) as r4 \gset
select pg_temp.assert((:'r4'::jsonb->>'changed')::int = 1 and (:'r4'::jsonb->>'kept_as_approved')::int = 1,
  'the re-import reports one approved section that differs from the page');
select pg_temp.assert((select body_md = 'The new facility has 13 pathshala rooms.' and status = 'published'
                              and metadata->>'page_changed' = 'true' and metadata->>'page_text_now' = 'The new facility has 20 pathshala rooms.'
                              and metadata ? 'page_changed_at' and metadata->>'section_key' is not null
                         from app.content_items where id = :'facility_id'::uuid),
  'the published section still says what was approved, and carries the page''s new text for a person to decide');
select pg_temp.assert((select updated_at from app.content_items where id = :'facility_id'::uuid) = :'facility_touched'::timestamptz,
  'flagging a published section leaves its updated_at alone (the date Niva is shown and go-live check 12 read it)');
select xmin::text as flagged_xmin from app.content_items where id = :'facility_id'::uuid \gset
select pg_temp.save(:c::uuid, 'https://www.example.org/relocation', :changed_page::jsonb) as r5 \gset
select pg_temp.assert((:'r5'::jsonb->>'changed')::int = 1 and (select xmin::text from app.content_items where id = :'facility_id'::uuid) = :'flagged_xmin',
  'importing the same changed page again keeps the flag without writing the published row again');
begin;
set local role connect_worker;
select app.niva_worker_search_sources(:c::uuid, 'pathshala rooms', 6) as found \gset
commit;
select pg_temp.assert(:'found'::jsonb @> '[{"title":"Relocation FAQs: The new facility"}]'::jsonb and :'found' like '%13 pathshala rooms%' and :'found' not like '%20 pathshala%',
  'Niva still answers from the approved text, not the page''s new one');
select pg_temp.save(:c::uuid, 'https://www.example.org/relocation', '[
  {"title":"Relocation FAQs: Timeline","heading":"Timeline","body":"Construction starts in spring."},
  {"title":"Relocation FAQs: What is new","heading":"What is new","body":"A new heading at the top of the page."},
  {"title":"Relocation FAQs: The new facility","heading":"The new facility","body":"The new facility has 13 pathshala rooms."},
  {"title":"Relocation FAQs: Donating","heading":"Donating","body":"Donations are tax deductible; ask your CPA."}]'::jsonb) as r6 \gset
select pg_temp.assert((:'r6'::jsonb->>'changed')::int = 0
                      and (select not (metadata ?| array['page_changed', 'page_text_now', 'page_changed_at']) from app.content_items where id = :'facility_id'::uuid),
  'when the page goes back to the approved text, the flag is cleared');

-- ── Sections the page no longer has; a retired section ───────────────────────
update app.content_items set status = 'retired' where id = :'whatsnew_id'::uuid;
select updated_at as retired_touched from app.content_items where id = :'whatsnew_id'::uuid \gset
select pg_temp.save(:c::uuid, 'https://www.example.org/relocation', '[
  {"title":"Relocation FAQs: Timeline","heading":"Timeline","body":"Construction starts in spring."},
  {"title":"Relocation FAQs: What is new","heading":"What is new","body":"Rewritten on the website."}]'::jsonb) as r7 \gset
select pg_temp.assert((:'r7'::jsonb->>'orphaned')::int = 1 and (:'r7'::jsonb->>'removed')::int = 1 and (:'r7'::jsonb->>'retired')::int = 1,
  'counts: one approved section orphaned, one draft removed, one retired section left alone');
select pg_temp.assert((select status = 'published' and body_md like '%13 pathshala rooms%' and metadata->>'orphaned' = 'true' and metadata ? 'orphaned_at'
                         from app.content_items where id = :'facility_id'::uuid),
  'a published section the page no longer has is kept and flagged orphaned, never deleted');
select pg_temp.assert(not exists (select 1 from app.content_items where id = :'donating_id'::uuid),
  'a draft section the page no longer has is deleted');
select pg_temp.assert((select status = 'retired' and body_md = 'A new heading at the top of the page.' and updated_at = :'retired_touched'::timestamptz
                         from app.content_items where id = :'whatsnew_id'::uuid),
  'a retired section is left exactly as it is, even when the page''s text for it changed');
select pg_temp.save(:c::uuid, 'https://www.example.org/relocation', '[
  {"title":"Relocation FAQs: Timeline","heading":"Timeline","body":"Construction starts in spring."},
  {"title":"Relocation FAQs: The new facility","heading":"The new facility","body":"The new facility has 13 pathshala rooms."}]'::jsonb) as r8 \gset
select pg_temp.assert((:'r8'::jsonb->>'orphaned')::int = 0
                      and (select not (metadata ? 'orphaned') from app.content_items where id = :'facility_id'::uuid),
  'a section that comes back on the page is no longer flagged orphaned');

-- ── A section waiting in the approval queue takes the final address ──────────
-- Saved before 0576 from the apex form and sent for approval; the page now redirects to www and says the same.
insert into app.content_items (center_id, kind, slug, title, body_md, metadata, status) values
  (:c, 'niva_source', 'web-' || left(md5('https://example.org/parking'), 10) || '-01', 'Parking: Where to park',
   'Park in the north lot.',
   jsonb_build_object('imported', true, 'source_url', 'https://example.org/parking', 'page_title', 'Parking', 'section', 1, 'imported_at', now() - interval '3 days'),
   'in_review');
select id as parking_id from app.content_items where center_id = :c::uuid and title = 'Parking: Where to park' \gset
select pg_temp.save(:c::uuid, 'https://www.example.org/parking', '[{"title":"Parking: Where to park","heading":"Where to park","body":"Park in the north lot."}]'::jsonb,
  'https://example.org/parking') as rp \gset
select pg_temp.assert((:'rp'::jsonb->>'kept_as_approved')::int = 1 and (:'rp'::jsonb->>'changed')::int = 0 and (:'rp'::jsonb->>'created')::int = 0,
  'a section in review whose text matches the page is kept');
select pg_temp.assert((select status = 'in_review' and body_md = 'Park in the north lot.' and metadata->>'source_url' = 'https://www.example.org/parking'
                              and metadata->>'page_key' = 'example.org/parking' and metadata ? 'section_key' and metadata->>'body_hash' = md5(body_md)
                         from app.content_items where id = :'parking_id'::uuid),
  'and takes the final address and its key, so the approval queue shows the page''s sections under one address');

-- ── A person takes the page's new text; flags never move go-live check 12 ─────
create or replace function pg_temp.timings_new() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('title', 'Timings: Derasar', 'heading', 'Derasar', 'body', E'Open 6 am to 9 pm.\n\nClosed on Mondays.'),
    jsonb_build_object('title', 'Timings: Office', 'heading', 'Office', 'body', 'Office hours are 10 am to 2 pm.'))
$$;
select pg_temp.save(:c::uuid, 'https://www.example.org/timings', '[
  {"title":"Timings: Derasar","heading":"Derasar","body":"Open 7 am to 9 pm."},
  {"title":"Timings: Office","heading":"Office","body":"Office hours are 10 am to 2 pm."}]'::jsonb) as t0 \gset
update app.content_items set status = 'published', published_at = now()
 where center_id = :c::uuid and title in ('Timings: Derasar', 'Timings: Office');
select id as derasar_id, updated_at as derasar_touched from app.content_items where center_id = :c::uuid and title = 'Timings: Derasar' \gset
select id as office_id, updated_at as office_touched from app.content_items where center_id = :c::uuid and title = 'Timings: Office' \gset
select app.golive_evidence_hash(app.niva_content_evidence(:c::uuid)) as ev_pub \gset
select pg_temp.save(:c::uuid, 'https://www.example.org/timings', pg_temp.timings_new()) as t1 \gset
select pg_temp.assert((:'t1'::jsonb->>'changed')::int = 1
                      and (select metadata->>'page_changed' = 'true' and body_md = 'Open 7 am to 9 pm.' and updated_at = :'derasar_touched'::timestamptz
                             from app.content_items where id = :'derasar_id'::uuid),
  'the page changed: the published section is flagged and keeps its text and its updated_at');
select pg_temp.assert(app.golive_evidence_hash(app.niva_content_evidence(:c::uuid)) = :'ev_pub',
  'flagging a published section does not change what go-live check 12 approved');
-- The content editor keeps metadata it does not show (src/app/(app)/content/actions.ts): the old body_hash and the
-- flag ride along. A textarea sends CR LF line ends; the editor trims.
update app.content_items set body_md = E'Open 6 am to 9 pm.\r\n\r\nClosed on Mondays.', status = 'in_review', approved_by = null
 where id = :'derasar_id'::uuid;
update app.content_items set status = 'published', published_at = now() where id = :'derasar_id'::uuid;
select updated_at as derasar_edited from app.content_items where id = :'derasar_id'::uuid \gset
select pg_temp.assert(:'derasar_edited'::timestamptz > :'derasar_touched'::timestamptz
                      and (select metadata->>'page_changed' = 'true' from app.content_items where id = :'derasar_id'::uuid),
  'a person''s edit still sets updated_at (and, as the editor saves it, the flag is still there)');
select pg_temp.save(:c::uuid, 'https://www.example.org/timings', pg_temp.timings_new()) as t2 \gset
select pg_temp.assert((:'t2'::jsonb->>'changed')::int = 0 and (:'t2'::jsonb->>'kept_as_approved')::int = 2
                      and (select not (metadata ?| array['page_changed', 'page_text_now', 'page_title_now', 'page_hash_now', 'page_changed_at'])
                                  and metadata->>'body_hash' = md5(E'Open 6 am to 9 pm.\n\nClosed on Mondays.')
                                  and body_md = E'Open 6 am to 9 pm.\r\n\r\nClosed on Mondays.' and status = 'published'
                                  and updated_at = :'derasar_edited'::timestamptz
                             from app.content_items where id = :'derasar_id'::uuid),
  'once the section says what the page says, the next import clears the flag and records the page''s hash (not counted as changed)');
select xmin::text as derasar_xmin from app.content_items where id = :'derasar_id'::uuid \gset
select pg_temp.save(:c::uuid, 'https://www.example.org/timings', pg_temp.timings_new()) as t3 \gset
select pg_temp.assert((:'t3'::jsonb->>'changed')::int = 0 and (select xmin::text from app.content_items where id = :'derasar_id'::uuid) = :'derasar_xmin',
  'and after that, the same page changes nothing');
select app.golive_evidence_hash(app.niva_content_evidence(:c::uuid)) as ev_edit \gset
select pg_temp.save(:c::uuid, 'https://www.example.org/timings',
  '[{"title":"Timings: Office","heading":"Office","body":"Office hours are 9 am to 1 pm."}]'::jsonb) as t4 \gset
select pg_temp.assert((:'t4'::jsonb->>'changed')::int = 1 and (:'t4'::jsonb->>'orphaned')::int = 1
                      and (select metadata->>'orphaned' = 'true' and updated_at = :'derasar_edited'::timestamptz from app.content_items where id = :'derasar_id'::uuid)
                      and (select metadata->>'page_changed' = 'true' and updated_at = :'office_touched'::timestamptz from app.content_items where id = :'office_id'::uuid),
  'a section the page dropped is flagged orphaned and one it changed is flagged, neither with a new updated_at');
select pg_temp.assert(app.golive_evidence_hash(app.niva_content_evidence(:c::uuid)) = :'ev_edit',
  'nor do those flags change what go-live check 12 approved');
-- The address Niva cites is not bookkeeping: changing it is a change (updated_at moves, so check 12 sees it).
select updated_at as office_flagged from app.content_items where id = :'office_id'::uuid \gset
update app.content_items set metadata = metadata || '{"source_url": "https://elsewhere.example.net/timings"}'::jsonb where id = :'office_id'::uuid;
select pg_temp.assert((select updated_at > :'office_flagged'::timestamptz from app.content_items where id = :'office_id'::uuid)
                      and app.golive_evidence_hash(app.niva_content_evidence(:c::uuid)) <> :'ev_edit',
  'changing a published section''s cited address still sets updated_at and changes go-live check 12''s evidence');
update app.content_items set metadata = metadata || '{"source_url": "https://www.example.org/timings"}'::jsonb where id = :'office_id'::uuid;

-- ── The worker refuses malformed input; staff cannot write sections ─────────
begin;
select pg_temp.sign_in(:admin);
select pg_temp.assert_raises($$select app.niva_worker_save_import('63000000-0000-4000-8000-0000000000c1'::uuid, 'https://example.org/x', 'X', '[{"title":"a","body":"b"}]'::jsonb, null, null)$$,
  'permission denied', 'even a center admin cannot write imported sections directly');
commit;
begin;
set local role connect_worker;
select pg_temp.assert_raises($$select app.niva_worker_save_import('63000000-0000-4000-8000-0000000000c1'::uuid, 'https://example.org/x', 'X', '[]'::jsonb, null, null)$$,
  'at least one section', 'a page with no sections is refused');
commit;

-- ── Discovery: queue a search ────────────────────────────────────────────────
begin;
select pg_temp.sign_in(:editor);
select app.niva_discover_site(:c::uuid, 'https://WWW.Example.org/#home') as djob \gset
commit;
select pg_temp.assert((select kind = 'niva.discover_site' and payload->>'url' = 'https://www.example.org' and created_by = :editor::uuid and max_attempts = 3
                         from app.jobs where id = :'djob'::bigint),
  'content.draft queues one niva.discover_site job for the site, its address written one way');
begin;
select pg_temp.sign_in(:editor);
select pg_temp.assert_raises($$select app.niva_discover_site('63000000-0000-4000-8000-0000000000c1'::uuid, 'https://www.example.org')$$,
  'already looking', 'a second search while one is waiting is refused in plain words');
select pg_temp.assert_raises($$select app.niva_discover_site('63000000-0000-4000-8000-0000000000c1'::uuid, 'www.example.org')$$,
  'is not a website address', 'an address without http(s) is refused, naming it');
commit;
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises($$select app.niva_discover_site('63000000-0000-4000-8000-0000000000c1'::uuid, 'https://example.org')$$,
  'needs content.draft', 'someone without content.draft cannot search a site');
select pg_temp.assert_raises($$select app.niva_discovery_status('63000000-0000-4000-8000-0000000000c1'::uuid)$$,
  'needs content.draft', 'someone without content.draft cannot see the page list');
commit;
begin;
select pg_temp.sign_in(:admin2);
select pg_temp.assert_raises($$select app.niva_discover_site('63000000-0000-4000-8000-0000000000c1'::uuid, 'https://example.org')$$,
  'needs content.draft', 'another community''s admin cannot search for this one');
commit;

-- ── Discovery: the worker saves the list ─────────────────────────────────────
begin;
select pg_temp.sign_in(:admin);
select pg_temp.assert_raises($$select app.niva_worker_save_discovery('63000000-0000-4000-8000-0000000000c1'::uuid, 'https://www.example.org', '[]'::jsonb)$$,
  'permission denied', 'only the background service saves a page list');
commit;
select pg_temp.discover(:c::uuid, 'https://www.example.org', '[
  {"url":"https://www.example.org","lastmod":"2026-09-18"},
  {"url":"https://www.example.org/relocation/","lastmod":"2026-09-01T10:00:00+00:00"},
  {"url":"https://example.org/relocation?utm_source=sitemap"},
  {"url":"https://www.example.org/pathshala","lastmod":"2026-13-45"},
  {"url":"https://www.example.org/membership","lastmod":"yesterday"},
  {"url":"https://www.example.org/privacy-policy"},
  {"url":"https://elsewhere.example.net/page"},
  {"url":"not an address"}]'::jsonb) as d1 \gset
select pg_temp.assert((:'d1'::jsonb->>'pages')::int = 5 and (:'d1'::jsonb->>'added')::int = 5 and (:'d1'::jsonb->>'other_site')::int = 2
                      and :'d1'::jsonb->>'site' = 'example.org',
  'the list keeps each page of the site once (apex and www as one) and leaves out other sites and non-addresses');
select pg_temp.assert((select count(*) from app.niva_site_pages where center_id = :c::uuid) = 5
                      and (select url from app.niva_site_pages where center_id = :c::uuid and url_key = 'example.org/relocation') = 'https://www.example.org/relocation'
                      and (select lastmod is null from app.niva_site_pages where center_id = :c::uuid and url_key = 'example.org/pathshala')
                      and (select lastmod is null from app.niva_site_pages where center_id = :c::uuid and url_key = 'example.org/membership'),
  'pages are saved written one way, with the sitemap''s lastmod when it is a real date');
select pg_temp.assert((select lastmod from app.niva_site_pages where center_id = :c::uuid and url_key = 'example.org')
                        = '2026-09-18 00:00'::timestamp at time zone 'America/Chicago'
                      and (select lastmod from app.niva_site_pages where center_id = :c::uuid and url_key = 'example.org/relocation')
                        = '2026-09-01T10:00:00+00:00'::timestamptz,
  'a date-only lastmod is that day in the community''s time zone (not UTC midnight, the day before in Houston); one with a zone is kept as it is');

-- RLS: content staff of this community read the list; nobody else does; nobody writes it directly.
begin;
select pg_temp.sign_in(:editor);
select count(*) as n_editor from app.niva_site_pages \gset
select pg_temp.assert_raises($$insert into app.niva_site_pages (center_id, site, url, url_key) values ('63000000-0000-4000-8000-0000000000c1', 'example.org', 'https://example.org/x', 'example.org/x')$$,
  'permission denied', 'content staff cannot write the page list directly');
commit;
begin;
select pg_temp.sign_in(:admin);
select count(*) as n_admin from app.niva_site_pages \gset
commit;
begin;
select pg_temp.sign_in(:member);
select count(*) as n_member from app.niva_site_pages \gset
commit;
begin;
select pg_temp.sign_in(:admin2);
select count(*) as n_admin2 from app.niva_site_pages \gset
commit;
select pg_temp.assert(:'n_editor'::int = 5 and :'n_admin'::int = 5, 'content.draft and content.manage staff read their community''s page list');
select pg_temp.assert(:'n_member'::int = 0 and :'n_admin2'::int = 0, 'a member, and another community''s admin, read none of it');
select pg_temp.assert((select relrowsecurity from pg_class where oid = 'app.niva_site_pages'::regclass)
                      and exists (select 1 from pg_policy where polrelid = 'app.niva_site_pages'::regclass and polname = 'module_switch' and not polpermissive)
                      and (select module_key from app.module_tables where table_name = 'niva_site_pages') = 'niva',
  'niva_site_pages has RLS and follows the Niva module switch');

-- ── Discovery: status, imports from the list, a later search ─────────────────
begin;
select pg_temp.sign_in(:editor);
select app.niva_import_pages(:c::uuid, array['https://example.org/pathshala']) as n3 \gset
select app.niva_discovery_status(:c::uuid) as st \gset
commit;
select pg_temp.assert((select last_import_job is not null from app.niva_site_pages where center_id = :c::uuid and url_key = 'example.org/pathshala'),
  'queuing a listed page remembers its import job on the list');
select pg_temp.assert(:'st'::jsonb->'job'->>'status' = 'queued' and (:'st'::jsonb->'job'->>'id')::bigint = :'djob'::bigint
                      and jsonb_array_length(:'st'::jsonb->'pages') = 5,
  'the status shows the latest search and the list');
select pg_temp.assert((select (p->>'sections')::int = 2 and (p->>'included')::int = 1 and (p->>'changed')::int = 0 and p->>'imported_at' is not null
                         from jsonb_array_elements(:'st'::jsonb->'pages') p where p->>'url' = 'https://www.example.org/relocation'),
  'each page says how many sections Niva has from it (every form of its address) and how many are published');
select pg_temp.assert((select p->>'import_status' = 'queued' and (p->>'sections')::int = 0
                         from jsonb_array_elements(:'st'::jsonb->'pages') p where p->>'url' = 'https://www.example.org/pathshala'),
  'a page queued from the list shows its import as waiting');

select pg_temp.save(:c::uuid, 'https://www.example.org/pathshala', '[{"title":"Pathshala","body":"Classes on Sundays."}]'::jsonb) as r9 \gset
select pg_temp.assert((select last_hash = md5('' || md5('Classes on Sundays.')) from app.niva_site_pages where center_id = :c::uuid and url_key = 'example.org/pathshala'),
  'an import records the page''s text hash on the list');

update app.jobs set status = 'done', finished_at = now() where id = :'djob'::bigint;
select discovered_at as reloc_found from app.niva_site_pages where center_id = :c::uuid and url_key = 'example.org/relocation' \gset
select pg_temp.discover(:c::uuid, 'https://example.org', '[{"url":"https://www.example.org/relocation","lastmod":"2026-09-01T10:00:00+00:00"},{"url":"https://www.example.org/events"}]'::jsonb) as d2 \gset
select pg_temp.assert((:'d2'::jsonb->>'removed')::int = 4 and (:'d2'::jsonb->>'added')::int = 1 and (:'d2'::jsonb->>'kept')::int = 1
                      and (select array_agg(url_key order by url_key) from app.niva_site_pages where center_id = :c::uuid) = array['example.org/events', 'example.org/relocation'],
  'a later search replaces the list: pages the sitemap no longer lists leave it');
select pg_temp.assert((select discovered_at = :'reloc_found'::timestamptz and lastmod = '2026-09-01T10:00:00+00:00'::timestamptz
                         from app.niva_site_pages where center_id = :c::uuid and url_key = 'example.org/relocation'),
  'a page found again, unchanged, keeps its row as it was (nothing new to write)');
select pg_temp.assert(exists (select 1 from app.content_items where center_id = :c::uuid and metadata->>'page_key' = 'example.org/pathshala'),
  'sources imported from a page that left the list are not touched');
begin;
select pg_temp.sign_in(:editor);
select app.niva_discover_site(:c::uuid, 'https://example.org') as djob2 \gset
commit;
select pg_temp.assert(:'djob2'::bigint > :'djob'::bigint, 'once the first search finished, a new one can be queued');

-- A search that could not read every sitemap adds what it saw and takes nothing off the list.
select pg_temp.discover(:c::uuid, 'https://www.example.org', '[{"url":"https://www.example.org/timings","lastmod":"2026-09-18"}]'::jsonb, false) as d3 \gset
select pg_temp.assert((:'d3'::jsonb->>'added')::int = 1 and (:'d3'::jsonb->>'removed')::int = 0 and (:'d3'::jsonb->>'complete')::boolean = false
                      and (select array_agg(url_key order by url_key) from app.niva_site_pages where center_id = :c::uuid)
                          = array['example.org/events', 'example.org/relocation', 'example.org/timings'],
  'an incomplete search (a sitemap could not be read) removes no page from the list');
begin;
select pg_temp.sign_in(:editor);
select app.niva_discovery_status(:c::uuid) as st2 \gset
commit;
select pg_temp.assert((select (p->>'sections')::int = 2 and (p->>'included')::int = 2
                              and (p->>'changed')::int = 1 and p->'changed_titles' = '["Timings: Office"]'::jsonb
                              and (p->>'orphaned')::int = 1 and p->'orphaned_titles' = '["Timings: Derasar"]'::jsonb
                         from jsonb_array_elements(:'st2'::jsonb->'pages') p where p->>'url' = 'https://www.example.org/timings'),
  'the status names the sections the page has changed and the ones it no longer has, so staff can find them');
select pg_temp.assert((select p->'changed_titles' = '[]'::jsonb and p->'orphaned_titles' = '[]'::jsonb and (p->>'orphaned')::int = 0
                         from jsonb_array_elements(:'st2'::jsonb->'pages') p where p->>'url' = 'https://www.example.org/relocation'),
  'a page with nothing flagged lists no titles');

-- With the Niva module switched off, nobody searches or reads the list (as the table's module_switch says).
insert into app.center_modules (center_id, module_key, enabled) values (:c, 'niva', false);
begin;
select pg_temp.sign_in(:editor);
select pg_temp.assert_raises($$select app.niva_discovery_status('63000000-0000-4000-8000-0000000000c1'::uuid)$$,
  'switched off', 'with Niva off, the page list is not shown');
select pg_temp.assert_raises($$select app.niva_discover_site('63000000-0000-4000-8000-0000000000c1'::uuid, 'https://example.org')$$,
  'switched off', 'with Niva off, no search is queued');
select count(*) as n_off from app.niva_site_pages \gset
commit;
select pg_temp.assert(:'n_off'::int = 0, 'with Niva off, the table shows content staff nothing');
delete from app.center_modules where center_id = :c and module_key = 'niva';
