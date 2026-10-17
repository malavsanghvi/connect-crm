-- 0928 (CatchTheMatch Phase 1, piece 4, docs/CATCH_THE_MATCH.md section 13): a file or screenshot for a library entry.
--   A. Structure: the bucket (private, 10 MB, four types), the table (private, only the functions write), the storage policies name the bucket,
--      the helpers are not callable, the bucket is not audited by community and not scanned (said in the migration), nothing purges it.
--   B. Storage: Weaver's team uploads under an existing entry's own folder only; a community, its owner and a clerk cannot write; a file reads for
--      the library's readers only once a live row names it; a removed or unregistered file reads as nothing; a stranger reads nothing.
--   C. Registering: Weaver's team only, a reason, the right folder and type, six files at most, the file must be in storage.
--   D. Reading: match_process_get lists the entry's live files; nothing about a community or a person.
-- Everything runs in one transaction that is rolled back.
\set ON_ERROR_STOP 1
begin;
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
create or replace function pg_temp.claims(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('request.headers', '', true);
end $$;
create or replace function pg_temp.objs(p_name text) returns bigint language sql security definer as $$ select count(*) from storage.objects where bucket_id = 'match-library' and name = p_name $$;

\set c1 '''92800000-0000-4000-8000-0000000000c1'''
\set owner '''92800000-0000-4000-8000-000000000001'''
\set plat '''92800000-0000-4000-8000-000000000002'''
\set lead '''92800000-0000-4000-8000-000000000003'''
\set clerk '''92800000-0000-4000-8000-000000000004'''
\set f1 '92800000-0000-4000-8000-00000000f001'
\set f2 '92800000-0000-4000-8000-00000000f002'
\set f3 '92800000-0000-4000-8000-00000000f003'

-- ══ A. Structure ═════════════════════════════════════════════════════════════
select pg_temp.assert((select public from storage.buckets where id = 'match-library') = false
                      and (select file_size_limit from storage.buckets where id = 'match-library') = 10485760
                      and (select allowed_mime_types from storage.buckets where id = 'match-library') = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  'A · the bucket is private, 10 MB at most, and takes JPEG, PNG, WebP and PDF');
select pg_temp.assert((select relrowsecurity from pg_class where oid = 'app.match_process_files'::regclass)
                      and not has_table_privilege('authenticated', 'app.match_process_files', 'insert')
                      and not has_table_privilege('authenticated', 'app.match_process_files', 'update')
                      and not has_table_privilege('authenticated', 'app.match_process_files', 'delete')
                      and not has_table_privilege('anon', 'app.match_process_files', 'select')
                      and not has_function_privilege('authenticated', 'app.match_library_object_readable(text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.match_library_object_writable(text)', 'execute')
                      and has_function_privilege('authenticated', 'app.add_match_process_file(uuid, text, text, bigint, text, text, text, text)', 'execute')
                      and not has_function_privilege('anon', 'app.add_match_process_file(uuid, text, text, bigint, text, text, text, text)', 'execute')
                      and (select module_key from app.module_tables where table_name = 'match_process_files') is null,
  'A · the table is private and shared (core), only the functions write, the helpers are not callable, and signed-out people cannot add');
select pg_temp.assert(not ('match-library' = any (app.connect_storage_buckets())) and not ('match-library' = any (app.storage_scan_buckets()))
                      and app.storage_retention_days('match-library', null) is null,
  'A · the bucket has no community, so it is not in the community audit or the virus scan, and nothing purges it by age');
select pg_temp.assert((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'connect_objects_%') = 4
                      and (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'connect_objects_%'
                              and (coalesce(qual, '') || coalesce(with_check, '')) like '%match-library%') = 4,
  'A · the four storage policies name the bucket');

-- ══ Fixtures ═════════════════════════════════════════════════════════════════
insert into auth.users (id, email) values (:owner, 'owner928@c1.test'), (:plat, 'plat928@weaver.test'), (:lead, 'lead928@c1.test'), (:clerk, 'clerk928@c1.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true) on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone, category_key, environment) values
  (:c1, 'ctm928a', 'Grace Church 928', 'G928', 'TX', 'active', 'America/Chicago', 'church', 'sandbox');
insert into app.center_owners (center_id, user_id) values (:c1, :owner);
insert into app.center_module_grants (center_id, module_key, granted, reason) values (:c1, 'matching', true, 'Test 928');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:c1, :plat, 'platform_owner', 'platform', 'Test 928: the platform owner role (holds "*")'), (:c1, :lead, 'matching_lead', 'center', 'Test 928');
set role authenticated;
select pg_temp.claims(:plat);
select app.save_match_program(null, '{"company_name": "Acme928", "country": "US", "match_ratio_bp": 10000, "portal": "benevity", "source": "employer_site"}'::jsonb, 'Test 928: Acme') as acme \gset
select app.save_match_program(null, '{"company_name": "Zeta928", "country": "US", "match_ratio_bp": 10000, "source": "other"}'::jsonb, 'Test 928: Zeta') as zeta \gset
reset role;
select :'acme' || '/' || :'f1' || '.pdf' as p1, :'acme' || '/' || :'f2' || '.png' as p2, :'acme' || '/' || :'f3' || '.jpg' as p3 \gset

-- ══ B. Storage ═══════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:lead);
select pg_temp.assert_raises(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'match-library', :'p1'), 'row-level security',
  'B · a community''s CatchTheMatch manager cannot upload to the library');
select pg_temp.claims(:owner);
select pg_temp.assert_raises(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'match-library', :'p1'), 'row-level security',
  'B · nor can a community''s owner');
select pg_temp.claims(:plat);
select pg_temp.assert_raises(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'match-library', 'not-a-folder/x.pdf'), 'row-level security',
  'B · Weaver''s team cannot upload outside an entry''s folder');
select pg_temp.assert_raises(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'match-library', '92800000-0000-4000-8000-00000000dead/' || :'f1' || '.pdf'), 'row-level security',
  'B · nor under an entry that does not exist');
select pg_temp.assert_raises(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'match-library', :'acme' || '/' || :'f1' || '.exe'), 'row-level security',
  'B · nor with an extension that is not allowed');
select pg_temp.assert_raises(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'match-library', :'acme' || '/a/' || :'f1' || '.pdf'), 'row-level security',
  'B · nor deeper than one file');
insert into storage.objects (bucket_id, name, metadata) values ('match-library', :'p1', '{"size": 120000, "mimetype": "application/pdf"}');
insert into storage.objects (bucket_id, name, metadata) values ('match-library', :'p2', '{"size": 40000, "mimetype": "image/png"}');
select pg_temp.assert(pg_temp.objs(:'p1') = 1, 'B · Weaver''s team uploads under an existing entry''s own folder');
-- Not registered yet: Weaver's team (who wrote it) sees it; no community does.
select pg_temp.assert((select count(*) from storage.objects where bucket_id = 'match-library') = 2, 'B · Weaver''s team sees what it uploaded before it is registered');
select pg_temp.claims(:lead);
select pg_temp.assert((select count(*) from storage.objects where bucket_id = 'match-library') = 0, 'B · a community sees nothing of it until a live row names it');
select pg_temp.claims(:plat);
reset role;

-- ══ C. Registering ═══════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:lead);
select pg_temp.assert_raises(format('select app.add_match_process_file(%L, %L, %L, 120000, null, %L, %L, %L)', :'acme', :'p1', 'application/pdf', 'form', 'The form', 'Test'),
  'Only Weaver''s team', 'C · a community cannot register a file');
select pg_temp.claims(:plat);
select pg_temp.assert_raises(format('select app.add_match_process_file(%L, %L, %L, 120000, null, %L, %L, %L)', :'acme', :'p1', 'application/pdf', 'form', 'The form', ''),
  'Say why', 'C · a file needs a reason');
select pg_temp.assert_raises(format('select app.add_match_process_file(%L, %L, %L, 120000, null, %L, %L, %L)', :'acme', :'p1', 'application/pdf', 'poster', 'The form', 'Test'),
  'a form, a screenshot or something else', 'C · and a kind');
select pg_temp.assert_raises(format('select app.add_match_process_file(%L, %L, %L, 120000, null, %L, %L, %L)', :'acme', :'p1', 'application/pdf', 'form', '   ', 'Test'),
  'short caption', 'C · and a caption');
select pg_temp.assert_raises(format('select app.add_match_process_file(%L, %L, %L, 120000, null, %L, %L, %L)', :'acme', :'p1', 'application/zip', 'form', 'The form', 'Test'),
  'JPEG, PNG or WebP picture or a PDF', 'C · only the four types');
select pg_temp.assert_raises(format('select app.add_match_process_file(%L, %L, %L, 99999999, null, %L, %L, %L)', :'acme', :'p1', 'application/pdf', 'form', 'The form', 'Test'),
  'at most 10 MB', 'C · at most 10 MB');
select pg_temp.assert_raises(format('select app.add_match_process_file(%L, %L, %L, 120000, null, %L, %L, %L)', :'zeta', :'p1', 'application/pdf', 'form', 'The form', 'Test'),
  'not uploaded to this entry''s folder', 'C · the file must be under this entry''s own folder');
select pg_temp.assert_raises(format('select app.add_match_process_file(%L, %L, %L, 120000, null, %L, %L, %L)', :'acme', :'p1', 'image/png', 'form', 'The form', 'Test'),
  'not uploaded to this entry''s folder', 'C · and its type must match its name');
select pg_temp.assert_raises(format('select app.add_match_process_file(%L, %L, %L, 120000, null, %L, %L, %L)', :'acme', :'acme' || '/' || :'f3' || '.jpg', 'image/jpeg', 'form', 'The form', 'Test'),
  'not in storage yet', 'C · and must be in storage');
select app.add_match_process_file(:'acme', :'p1', 'application/pdf', 120000, null, 'form', '  Acme''s  matching   form ', 'Test 928: the form') as id1 \gset
select app.add_match_process_file(:'acme', :'p2', 'image/png', 40000, repeat('a', 64), 'screenshot', 'The Benevity screen', 'Test 928: the screen') as id2 \gset
select pg_temp.assert((select caption from app.match_process_files where id = :'id1'::uuid) = 'Acme''s matching form'
                      and (select sha256 from app.match_process_files where id = :'id2'::uuid) = repeat('a', 64)
                      and (select added_by from app.match_process_files where id = :'id1'::uuid) = :plat,
  'C · Weaver''s team registers a file: the caption is cleaned, the fingerprint kept, who added it');
select pg_temp.assert(exists (select 1 from app.audit_log where record_table = 'match_process_files' and action = 'match_process_files.insert' and center_id is null),
  'C · the shared audit says Weaver''s team added it, in no community');
reset role;
-- A sixth file is the last; the seventh is refused.
set role authenticated;
select pg_temp.claims(:plat);
select pg_temp.assert((select count(*) from app.match_process_files where program_id = :'acme' and removed_at is null) = 2, 'C · two live files');
reset role;
insert into storage.objects (bucket_id, name) select 'match-library', :'acme' || '/' || ('92800000-0000-4000-8000-0000000001' || lpad(g::text, 2, '0')) || '.pdf' from generate_series(1, 5) g;
set role authenticated;
select pg_temp.claims(:plat);
select app.add_match_process_file(:'acme', :'acme' || '/' || ('92800000-0000-4000-8000-0000000001' || lpad(g::text, 2, '0')) || '.pdf', 'application/pdf', 1000, null, 'other', 'Extra ' || g, 'Test 928: extra')
  from generate_series(1, 4) g;
select pg_temp.assert_raises(format('select app.add_match_process_file(%L, %L, %L, 1000, null, %L, %L, %L)', :'acme', :'acme' || '/92800000-0000-4000-8000-000000000105.pdf', 'application/pdf', 'other', 'Extra 5', 'Test'),
  'up to 6 files', 'C · an entry holds six files at most');
reset role;

-- ══ D. Reading ═══════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:lead);
select pg_temp.assert(pg_temp.objs(:'p1') = 1 and (select count(*) from storage.objects where bucket_id = 'match-library' and name = :'p1') = 1,
  'D · a CatchTheMatch reader reads a registered file');
select pg_temp.assert((select count(*) from storage.objects where bucket_id = 'match-library' and name = :'acme' || '/92800000-0000-4000-8000-000000000105.pdf') = 0,
  'D · and an upload nothing names reads as nothing');
select app.match_process_get(:'acme', :c1) as pg \gset
select pg_temp.assert(jsonb_array_length(:'pg'::jsonb -> 'files') = 6
                      and (select count(*) from jsonb_array_elements(:'pg'::jsonb -> 'files') e where e ->> 'path' = :'p1' and e ->> 'kind' = 'form') = 1
                      and (select count(*) from jsonb_array_elements(:'pg'::jsonb -> 'files') e where e ->> 'caption' = 'The Benevity screen' and e ->> 'content_type' = 'image/png') = 1
                      and not (:'pg'::jsonb::text ~ 'Grace|lead928|owner928'),
  'D · the entry''s answer lists its live files and names no community and no person');
select pg_temp.claims(:clerk);
select pg_temp.assert((select count(*) from storage.objects where bucket_id = 'match-library') = 0, 'D · someone with no CatchTheMatch role reads nothing');
select pg_temp.claims(:plat);
select pg_temp.assert((select count(*) from storage.objects where bucket_id = 'match-library') = 7, 'D · Weaver''s team reads every object, registered or not');
-- Removing.
select pg_temp.claims(:lead);
select pg_temp.assert_raises(format('select app.remove_match_process_file(%L, %L)', :'id1', 'x'), 'Only Weaver''s team', 'D · a community cannot remove a file');
select pg_temp.claims(:plat);
select pg_temp.assert_raises(format('select app.remove_match_process_file(%L, %L)', :'id1', ''), 'Say why', 'D · removing needs a reason');
select app.remove_match_process_file(:'id1'::uuid, 'Test 928: the employer replaced the form') as rm \gset
select pg_temp.assert((:'rm'::jsonb ->> 'storage_path') = :'p1' and (select removed_at from app.match_process_files where id = :'id1'::uuid) is not null
                      and (select removed_by from app.match_process_files where id = :'id1'::uuid) = :plat,
  'D · the row stays as a record and names the stored copy to delete');
select pg_temp.assert_raises(format('select app.remove_match_process_file(%L, %L)', :'id1', 'again'), 'already removed', 'D · a file is removed once');
select pg_temp.claims(:lead);
select pg_temp.assert((select count(*) from storage.objects where bucket_id = 'match-library' and name = :'p1') = 0
                      and jsonb_array_length(app.match_process_get(:'acme', :c1) -> 'files') = 5,
  'D · a removed file reads as nothing and leaves the list');
select pg_temp.claims(:plat);
delete from storage.objects where bucket_id = 'match-library' and name = :'p1';
select pg_temp.assert(pg_temp.objs(:'p1') = 0, 'D · Weaver''s team deletes the stored copy');
reset role;
rollback;
