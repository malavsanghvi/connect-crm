-- 0540: Niva web import — staff queue pages, only the background service can write the
-- sections, everything lands as DRAFT, a re-import never touches approved text, and
-- Niva still answers from published sources only. Since 0576 (test 63 has the rest): addresses are
-- written one way before duplicates are removed, and an approved section whose page changed is
-- flagged for a person instead of being skipped silently.
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

-- ── Fixtures ─────────────────────────────────────────────────────────────────
\set c '''46000000-0000-4000-8000-0000000000c1'''
\set c2 '''46000000-0000-4000-8000-0000000000c2'''
\set admin '''46000000-0000-4000-8000-000000000001'''
\set member '''46000000-0000-4000-8000-000000000002'''
\set admin2 '''46000000-0000-4000-8000-000000000003'''
insert into auth.users (id, email) values (:admin, 'admin46@example.com'), (:member, 'member46@example.com'), (:admin2, 'admin46b@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status) values
  (:c, 'orbit46', 'Orbit Import Community', 'OIC', 'TX', 'active'),
  (:c2, 'orbit46b', 'Other Import Community', 'OIC2', 'TX', 'active');
insert into app.role_grants (center_id, user_id, role_key) values (:c, :admin, 'center_admin'), (:c2, :admin2, 'center_admin');

-- ── Staff queue pages: duplicates and #fragments collapse, one job each ─────
begin;
select pg_temp.sign_in(:admin);
select app.niva_import_pages(:c::uuid, array['https://example.org/relocation', '  https://example.org/relocation#faq ', 'https://www.example.org/relocation/', 'https://example.org/pathshala', '', null]) as n \gset
commit;
select pg_temp.assert(:'n'::int = 2, 'two distinct pages are queued (the duplicate, the #fragment, the www form with a trailing slash and blanks collapse)');
select pg_temp.assert((select count(*) from app.jobs where kind = 'niva.import_page' and center_id = :c::uuid) = 2, 'one niva.import_page job per page');
select pg_temp.assert((select bool_and(created_by = :admin::uuid) from app.jobs where kind = 'niva.import_page' and center_id = :c::uuid), 'the job records who asked for the import');
select pg_temp.assert((select count(distinct run_after) from app.jobs where kind = 'niva.import_page' and center_id = :c::uuid) = 2, 'the jobs are staggered, not all due at the same instant');
select pg_temp.assert((select count(*) from app.jobs where kind = 'niva.import_page' and payload->>'url' = 'https://example.org/relocation') = 1, 'the address is stored without its #fragment');

-- ── Refusals ─────────────────────────────────────────────────────────────────
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises($$select app.niva_import_pages('46000000-0000-4000-8000-0000000000c1'::uuid, array['https://example.org/x'])$$, 'needs content.draft', 'someone without content.draft cannot queue an import');
commit;
begin;
select pg_temp.sign_in(:admin2);
select pg_temp.assert_raises($$select app.niva_import_pages('46000000-0000-4000-8000-0000000000c1'::uuid, array['https://example.org/x'])$$, 'needs content.draft', 'an admin of another center cannot queue an import here');
commit;
begin;
select pg_temp.sign_in(:admin);
select pg_temp.assert_raises($$select app.niva_import_pages('46000000-0000-4000-8000-0000000000c1'::uuid, array['ftp://example.org/x'])$$, 'is not a web page address', 'only http(s) addresses are accepted');
select pg_temp.assert_raises($$select app.niva_import_pages('46000000-0000-4000-8000-0000000000c1'::uuid, array['not a url'])$$, 'is not a web page address', 'text that is not an address is refused, naming it');
select pg_temp.assert_raises($$select app.niva_import_pages('46000000-0000-4000-8000-0000000000c1'::uuid, array[]::text[])$$, 'at least one', 'an empty list is refused');
select pg_temp.assert_raises($$select app.niva_import_pages('46000000-0000-4000-8000-0000000000c1'::uuid, array['', '  '])$$, 'at least one', 'a list of blanks is refused');
select pg_temp.assert_raises($$select app.niva_import_pages('46000000-0000-4000-8000-0000000000c1'::uuid, (select array_agg('https://example.org/p' || g) from generate_series(1, 51) g))$$, 'at most 50', 'more than 50 addresses is refused');
commit;
select pg_temp.assert((select count(*) from app.jobs where kind = 'niva.import_page' and center_id = :c::uuid) = 2, 'no job was queued by a refused request');

-- ── Only the background service can write sections ───────────────────────────
begin;
select pg_temp.sign_in(:admin);
select pg_temp.assert_raises($$select app.niva_worker_save_import('46000000-0000-4000-8000-0000000000c1'::uuid, 'https://example.org/relocation', 'Relocation', '[{"title":"a","body":"b"}]'::jsonb, null)$$,
  'permission denied', 'even a center admin cannot write imported sections directly');
commit;

-- ── The worker saves a page's sections as drafts ─────────────────────────────
begin;
set local role connect_worker;
select app.niva_worker_save_import(:c::uuid, 'https://example.org/relocation', 'JSH Relocation FAQs',
  '[{"title":"Relocation: the new facility","body":"The new facility has 13 pathshala rooms and a kitchen."},{"title":"Relocation: donating","body":"Donations to the new facility are tax deductible."}]'::jsonb,
  :admin::uuid) as r1 \gset
commit;
select pg_temp.assert((:'r1'::jsonb->>'created')::int = 2 and (:'r1'::jsonb->>'updated')::int = 0 and (:'r1'::jsonb->>'changed')::int = 0
                      and :'r1'::jsonb->>'url' = 'https://example.org/relocation', 'two sections are created on the first import');
select pg_temp.assert((select count(*) from app.content_items where center_id = :c::uuid and kind = 'niva_source' and status = 'draft' and metadata->>'imported' = 'true') = 2, 'they are saved as DRAFT niva_source items');
select pg_temp.assert((select bool_and(metadata->>'source_url' = 'https://example.org/relocation' and created_by = :admin::uuid) from app.content_items where center_id = :c::uuid and metadata->>'imported' = 'true'), 'each remembers its page address and who imported it');

-- Niva answers only from published sources: an imported draft is invisible to it.
begin;
set local role connect_worker;
select app.niva_worker_search_sources(:c::uuid, 'pathshala rooms kitchen', 6) as found \gset
commit;
select pg_temp.assert(:'found' = '[]', 'an imported draft is never offered to Niva');

-- ── Re-import: drafts refresh, approved text is never touched ───────────────
update app.content_items set status = 'published', published_at = now()
  where center_id = :c::uuid and metadata->>'imported' = 'true' and metadata->>'section' = '1';
begin;
set local role connect_worker;
select app.niva_worker_save_import(:c::uuid, 'https://example.org/relocation', 'JSH Relocation FAQs',
  '[{"title":"Relocation: the new facility","body":"CHANGED on the website: 20 rooms."},{"title":"Relocation: donating","body":"Donations are tax deductible; talk to your CPA."}]'::jsonb,
  :admin::uuid) as r2 \gset
commit;
select pg_temp.assert((:'r2'::jsonb->>'updated')::int = 1 and (:'r2'::jsonb->>'kept_as_approved')::int = 1 and (:'r2'::jsonb->>'created')::int = 0, 'a re-import updates the draft section and keeps the published one');
select pg_temp.assert((select body_md from app.content_items where center_id = :c::uuid and metadata->>'section' = '1' and metadata->>'imported' = 'true') like '%13 pathshala rooms%', 'the published section still says exactly what was approved');
select pg_temp.assert((:'r2'::jsonb->>'changed')::int = 1
                      and (select metadata->>'page_changed' = 'true' and metadata->>'page_text_now' like '%20 rooms%'
                             from app.content_items where center_id = :c::uuid and metadata->>'section' = '1' and metadata->>'imported' = 'true'),
  'the published section is flagged with the page''s new text for a person to decide (0576)');
select pg_temp.assert((select body_md from app.content_items where center_id = :c::uuid and metadata->>'section' = '2' and metadata->>'imported' = 'true') like '%talk to your CPA%', 'the draft section carries the new text');
select pg_temp.assert((select count(*) from app.content_items where center_id = :c::uuid and metadata->>'imported' = 'true') = 2, 'a re-import creates no duplicates');

-- Once published, the section is offered to Niva.
begin;
set local role connect_worker;
select app.niva_worker_search_sources(:c::uuid, 'pathshala rooms kitchen', 6) as found2 \gset
commit;
select pg_temp.assert(:'found2'::jsonb @> '[{"title":"Relocation: the new facility"}]'::jsonb, 'a published imported section is offered to Niva');

-- ── The worker refuses malformed input ───────────────────────────────────────
begin;
set local role connect_worker;
select pg_temp.assert_raises($$select app.niva_worker_save_import('46000000-0000-4000-8000-0000000000c1'::uuid, 'https://example.org/x', 'X', '[]'::jsonb, null)$$, 'at least one section', 'a page with no sections is refused');
select pg_temp.assert_raises($$select app.niva_worker_save_import('46000000-0000-4000-8000-0000000000c1'::uuid, 'https://example.org/x', 'X', '[{"title":"","body":"text"}]'::jsonb, null)$$, 'no title or no text', 'a section without a title is refused');
select pg_temp.assert_raises($$select app.niva_worker_save_import('46000000-0000-4000-8000-0000000000c1'::uuid, 'https://example.org/x', 'X', jsonb_build_array(jsonb_build_object('title','t','body',repeat('a', 6001))), null)$$, 'longer than 6000', 'an oversized section is refused');
commit;

-- ── Recent imports: staff of this center only ────────────────────────────────
begin;
select pg_temp.sign_in(:admin);
select count(*) as n_status from app.niva_import_status(:c::uuid, 10) \gset
commit;
select pg_temp.assert(:'n_status'::int = 2, 'staff see this center''s recent import jobs');
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises($$select * from app.niva_import_status('46000000-0000-4000-8000-0000000000c1'::uuid, 10)$$, 'needs content.draft', 'a member cannot see import jobs');
commit;
begin;
select pg_temp.sign_in(:admin2);
select pg_temp.assert_raises($$select * from app.niva_import_status('46000000-0000-4000-8000-0000000000c1'::uuid, 10)$$, 'needs content.draft', 'another center''s admin cannot see this center''s import jobs');
commit;
