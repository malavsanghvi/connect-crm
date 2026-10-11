-- 0640 / 0641: "What we found" about an organization's website (B92 W2).
--   A. One website address: a bare name becomes https, #fragment and trailing slash go; a non-web address, a space, a user
--      name, a number, localhost, a name with no dot and a private suffix are each refused in plain English.
--   B. Saving the addresses: settings.manage only (a content editor, another community's administrator, a visitor are
--      refused); up to 3 websites the organization likes (repeats kept once, a 4th refused, the organization's own website
--      refused as one it likes); blanks clear; centers.rules is never written; the table is closed to the API.
--   C. Queuing the reads: only the SAVED addresses, mode own for the organization and reference for the others, the job
--      payload the worker expects; one read at a time per website; at most 8 an hour per community, with the minutes to
--      wait; a single website can be read again; an unknown or unsaved slot is refused.
--   D. The status (latest read per website, no report) and one finished report, for settings.manage holders of that
--      community only.
--   E. Who may call what, search paths, the audit trigger, the module map and the activity catalog (0641).
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
create or replace function pg_temp.sign_in(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
-- The address check on its own, for the refusals.
create or replace function pg_temp.clean_raises(p_raw text, p_expect text, p_label text) returns void language plpgsql as $$
begin
  perform pg_temp.assert_raises(format('select app.site_clean_address(%L)', p_raw), p_expect, p_label);
end $$;

\set c '''11800000-0000-4000-8000-0000000000c1'''
\set c2 '''11800000-0000-4000-8000-0000000000c2'''
\set admin '''11800000-0000-4000-8000-000000000001'''
\set editor '''11800000-0000-4000-8000-000000000002'''
\set admin2 '''11800000-0000-4000-8000-000000000003'''
\insert into auth.users (id, email) values (:admin, 'admin118@example.com'), (:editor, 'editor118@example.com'),
  (:admin2, 'admin118b@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status) values
  (:c, 'site118', 'Website One', 'WS1', 'TX', 'active'),
  (:c2, 'site118b', 'Website Two', 'WS2', 'TX', 'active');
insert into app.role_grants (center_id, user_id, role_key) values
  (:c, :admin, 'center_admin'), (:c, :editor, 'content_editor'), (:c2, :admin2, 'center_admin');
insert into app.org_profiles (center_id, website) values (:c, 'https://profile118.example.org');
create temp table before_rules as select rules::text as t from app.centers where id = :c;

-- ── A. One website address ───────────────────────────────────────────────────
select pg_temp.assert(app.site_clean_address('  WWW.Example.ORG/ ') = 'https://www.example.org',
  'A · a bare name becomes an https address, in lower case, without the trailing slash');
select pg_temp.assert(app.site_clean_address('http://example.org/about/#team') = 'http://example.org/about',
  'A · http is allowed; a #section and the trailing slash are dropped');
select pg_temp.assert(app.site_clean_address('example.org:8080/x?utm_source=a') = 'https://example.org:8080/x',
  'A · a port is kept; utm_ parameters are dropped');
select pg_temp.assert(app.site_clean_address('  ') is null and app.site_clean_address(null) is null, 'A · a blank is no address');
select pg_temp.clean_raises('ftp://example.org', 'must start with http', 'A · ftp is refused');
select pg_temp.clean_raises('javascript:alert(1)', 'not a website address', 'A · javascript: is refused');
select pg_temp.clean_raises('mailto:a@example.org', 'not a website address', 'A · mailto: is refused');
select pg_temp.clean_raises('https://exa mple.org', 'has a space', 'A · a space is refused');
select pg_temp.clean_raises('https://admin:pw@example.org', 'user name or password', 'A · a user name and password are refused');
select pg_temp.clean_raises('http://localhost:3000', 'private network', 'A · localhost is refused');
select pg_temp.clean_raises('http://127.0.0.1/', 'private network', 'A · a loopback number is refused');
select pg_temp.clean_raises('http://10.0.0.5/admin', 'private network', 'A · a private number is refused');
select pg_temp.clean_raises('http://[::1]/', 'not a website address', 'A · an IPv6 number is refused');
select pg_temp.clean_raises('http://intranet/', 'private network', 'A · a name with no dot is refused');
select pg_temp.clean_raises('https://printer.local', 'private network', 'A · a .local name is refused');
select pg_temp.clean_raises('https://wiki.internal/home', 'private network', 'A · an .internal name is refused');
select pg_temp.clean_raises('https://example.org:99999', 'port number', 'A · a port that does not exist is refused');
select pg_temp.clean_raises('https://-bad-.org', 'not a website name', 'A · a malformed name is refused');

-- ── B. Saving the addresses ──────────────────────────────────────────────────
select pg_temp.sign_in(:editor);
select pg_temp.assert_raises(format('select app.site_found_save_inputs(%L, %L, null)', :c, 'https://www.example.org'), 'settings.manage',
  'B · a content editor (no settings.manage) cannot save the addresses');
select pg_temp.sign_in(:admin2);
select pg_temp.assert_raises(format('select app.site_found_save_inputs(%L, %L, null)', :c, 'https://www.example.org'), 'settings.manage',
  'B · another community''s administrator cannot save this community''s addresses');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select pg_temp.assert_raises(format('select app.site_found_save_inputs(%L, %L, null)', :c, 'https://www.example.org'), 'permission denied',
  'B · a visitor who is not signed in cannot call it at all');
reset role;

select pg_temp.sign_in(:admin);
select pg_temp.assert_raises(format('select app.site_found_save_inputs(%L, %L, array[%L, %L, %L, %L])', :c, 'https://www.example.org',
    'https://one.example.net', 'https://two.example.net', 'https://three.example.net', 'https://four.example.net'),
  'at most 3', 'B · a fourth website the organization likes is refused');
select pg_temp.assert_raises(format('select app.site_found_save_inputs(%L, %L, array[%L])', :c, 'https://www.example.org', 'example.org/about'),
  'own website', 'B · the organization''s own website cannot also be one it likes');
select pg_temp.assert_raises(format('select app.site_found_save_inputs(%L, %L, array[%L])', :c, 'https://www.example.org', 'http://10.0.0.5'),
  'private network', 'B · a private address among the ones it likes is refused, and nothing is saved');
reset role;
select pg_temp.assert(not exists (select 1 from app.center_site_inputs where center_id = :c), 'B · nothing was saved by the refused attempts');

select pg_temp.sign_in(:admin);
select pg_temp.assert((app.site_found_save_inputs(:c, 'www.Example.org/', array['https://one.example.net/', 'HTTPS://Two.Example.Net', '', 'https://www.one.example.net']) ->> 'own_url') = 'https://www.example.org',
  'B · settings.manage saves the addresses; the organization''s website is written one way');
reset role;
select pg_temp.assert((select reference_urls from app.center_site_inputs where center_id = :c) = array['https://one.example.net', 'https://two.example.net'],
  'B · blanks are dropped and the same website with and without www is kept once');
select pg_temp.assert((select rules::text from app.centers where id = :c) = (select t from before_rules)
                      and (select rules::text from app.centers where id = :c) not like '%example.net%',
  'B · centers.rules (which anyone can read) is untouched: the addresses are not kept there');
select pg_temp.assert(exists (select 1 from app.audit_log where record_table = 'center_site_inputs' and center_id = :c),
  'B · saving the addresses is in the audit log');

-- ── C. Queuing the reads ─────────────────────────────────────────────────────
select pg_temp.sign_in(:admin2);
select pg_temp.assert_raises(format('select app.site_crawl_start(%L)', :c2), 'save it first',
  'C · a community with no saved address is told to save one first');
select pg_temp.sign_in(:editor);
select pg_temp.assert_raises(format('select app.site_crawl_start(%L)', :c), 'settings.manage', 'C · a content editor cannot start a read');

select pg_temp.sign_in(:admin);
create temp table run1 as select app.site_crawl_start(:c) as r;
reset role;
select pg_temp.assert((select jsonb_array_length(r -> 'queued') from run1) = 3
                      and (select array_agg(q ->> 'slot' order by q ->> 'slot') from run1, jsonb_array_elements(r -> 'queued') q) = array['own', 'ref1', 'ref2'],
  'C · one read for the organization''s website and one for each website it likes');
select pg_temp.assert((select count(*) from app.jobs where center_id = :c and kind = 'site.crawl' and status = 'queued') = 3
                      and (select count(*) from app.jobs where center_id = :c and kind = 'site.crawl' and payload ->> 'mode' = 'own' and payload ->> 'slot' = 'own'
                             and payload ->> 'start_url' = 'https://www.example.org' and (payload ->> 'max_pages')::int = 40 and max_attempts = 2 and created_by = :admin) = 1
                      and (select count(*) from app.jobs where center_id = :c and kind = 'site.crawl' and payload ->> 'mode' = 'reference' and (payload ->> 'max_pages')::int = 20
                             and payload ->> 'start_url' in ('https://one.example.net', 'https://two.example.net')) = 2,
  'C · the jobs carry the saved addresses, mode own for the organization''s website and reference for the others (the payload site.crawl reads)');
select pg_temp.assert((select count(distinct j.payload ->> 'run') from app.jobs j where j.center_id = :c and j.kind = 'site.crawl') = 1,
  'C · the reads of one press share a run');

select pg_temp.sign_in(:admin);
select pg_temp.assert_raises(format('select app.site_crawl_start(%L)', :c), 'already reading', 'C · pressing again while the websites are being read is refused');
select pg_temp.assert_raises(format('select app.site_crawl_start(%L, %L)', :c, 'ref1'), 'already reading', 'C · so is reading one of them again');
reset role;

-- The reads finish; a single website can be read again; then a whole run again.
update app.jobs set status = 'done', finished_at = now(), result = jsonb_build_object('schema', 1, 'mode', payload ->> 'mode', 'crawl', jsonb_build_object('pages_fetched', 7))
 where center_id = :c and kind = 'site.crawl';
select pg_temp.sign_in(:admin);
select pg_temp.assert((app.site_crawl_start(:c, 'ref2') -> 'queued' -> 0 ->> 'slot') = 'ref2', 'C · one website can be read again by itself (Try again)');
select pg_temp.assert_raises(format('select app.site_crawl_start(%L, %L)', :c, 'ref3'), 'no saved address', 'C · a website with no saved address is refused');
select pg_temp.assert_raises(format('select app.site_crawl_start(%L, %L)', :c, 'bogus'), 'does not know', 'C · an unknown slot is refused');
reset role;
update app.jobs set status = 'done', finished_at = now() where center_id = :c and kind = 'site.crawl' and status = 'queued';
select pg_temp.sign_in(:admin);
select pg_temp.assert(jsonb_array_length(app.site_crawl_start(:c) -> 'queued') = 3, 'C · a whole run again (4 + 3 = 7 reads so far this hour)');
reset role;
update app.jobs set status = 'done', finished_at = now() where center_id = :c and kind = 'site.crawl' and status = 'queued';
select pg_temp.sign_in(:admin);
select pg_temp.assert(jsonb_array_length(app.site_crawl_start(:c, 'own') -> 'queued') = 1, 'C · the 8th read in the hour is allowed');
reset role;
update app.jobs set status = 'done', finished_at = now() where center_id = :c and kind = 'site.crawl' and status = 'queued';
-- The oldest read of the hour is 50 minutes old: a place frees in 10 minutes.
update app.jobs set created_at = now() - interval '50 minutes'
 where id = (select min(id) from app.jobs where center_id = :c and kind = 'site.crawl');
select pg_temp.sign_in(:admin);
select pg_temp.assert_raises(format('select app.site_crawl_start(%L, %L)', :c, 'own'), 'at most 8 websites an hour', 'C · the 9th read in an hour is refused');
select pg_temp.assert_raises(format('select app.site_crawl_start(%L, %L)', :c, 'own'), 'about 10 minutes', 'C · and says how long to wait');
reset role;
-- A read that has aged out of the hour no longer counts.
update app.jobs set created_at = now() - interval '2 hours' where center_id = :c and kind = 'site.crawl';
select pg_temp.sign_in(:admin);
select pg_temp.assert(jsonb_array_length(app.site_crawl_start(:c) -> 'queued') = 3, 'C · reads older than an hour do not count toward the limit');
reset role;
-- A read queued long ago and never finished (the background service was down) does not block a new one.
update app.jobs set created_at = now() - interval '30 minutes' where center_id = :c and kind = 'site.crawl' and status = 'queued';
select pg_temp.sign_in(:admin);
select pg_temp.assert(jsonb_array_length(app.site_crawl_start(:c) -> 'queued') = 3, 'C · a stale unfinished read does not block a new one');
reset role;

-- ── D. The status and one report ─────────────────────────────────────────────
update app.jobs set status = 'failed', last_error = 'The website did not answer.', finished_at = now(), attempts = 2
 where center_id = :c and kind = 'site.crawl' and payload ->> 'slot' = 'ref1' and status = 'queued';
update app.jobs set status = 'done', finished_at = now(), result = jsonb_build_object('schema', 1, 'mode', 'own', 'site', 'example.org', 'crawl', jsonb_build_object('pages_fetched', 12))
 where center_id = :c and kind = 'site.crawl' and payload ->> 'slot' = 'own' and status = 'queued';
select pg_temp.sign_in(:admin);
create temp table st as select app.site_found_status(:c) as s;
reset role;
select pg_temp.assert((select s ->> 'own_url' from st) = 'https://www.example.org'
                      and (select s -> 'reference_urls' from st) = '["https://one.example.net", "https://two.example.net"]'::jsonb
                      and (select s ->> 'profile_website' from st) = 'https://profile118.example.org',
  'D · the status gives the saved addresses and the website on the public profile');
select pg_temp.assert((select jsonb_array_length(s -> 'jobs') from st) = 3
                      and (select count(*) from st, jsonb_array_elements(s -> 'jobs') j where j ? 'result') = 0
                      and (select (j ->> 'pages_read')::int from st, jsonb_array_elements(s -> 'jobs') j where j ->> 'slot' = 'own') = 12
                      and (select j ->> 'status' from st, jsonb_array_elements(s -> 'jobs') j where j ->> 'slot' = 'own') = 'done'
                      and (select j ->> 'status' from st, jsonb_array_elements(s -> 'jobs') j where j ->> 'slot' = 'ref1') = 'failed'
                      and (select j ->> 'last_error' from st, jsonb_array_elements(s -> 'jobs') j where j ->> 'slot' = 'ref1') = 'The website did not answer.'
                      and (select j ->> 'status' from st, jsonb_array_elements(s -> 'jobs') j where j ->> 'slot' = 'ref2') = 'queued',
  'D · the status gives the LATEST read of each website (done, failed with its reason, still waiting) and no report');
select pg_temp.assert((select (s ->> 'reads_last_hour')::int from st) = 6 and (select (s ->> 'max_reads_per_hour')::int from st) = 8,
  'D · the status says how many reads this hour has had and the limit');

select (select id from app.jobs where center_id = :c and payload ->> 'slot' = 'own' and status = 'done' order by id desc limit 1) as own_done,
       (select id from app.jobs where center_id = :c and payload ->> 'slot' = 'ref2' and status = 'queued' order by id desc limit 1) as ref2_waiting
\gset
select pg_temp.sign_in(:editor);
select pg_temp.assert_raises(format('select app.site_found_status(%L)', :c), 'settings.manage', 'D · a content editor cannot see the status');
select pg_temp.sign_in(:admin2);
select pg_temp.assert_raises(format('select app.site_found_status(%L)', :c), 'settings.manage', 'D · another community''s administrator cannot see the status');
select pg_temp.assert_raises(format('select app.site_found_report(%L, %s)', :c2, :own_done),
  'not available', 'D · a report of another community cannot be read through your own');
select pg_temp.assert_raises(format('select app.site_found_report(%L, %s)', :c, :own_done),
  'settings.manage', 'D · nor through the other community''s id');

select pg_temp.sign_in(:admin);
select pg_temp.assert((app.site_found_report(:c, :own_done) -> 'result' ->> 'site') = 'example.org',
  'D · settings.manage reads a finished report in full');
select pg_temp.assert_raises(format('select app.site_found_report(%L, %s)', :c, :ref2_waiting),
  'not available', 'D · a read that has not finished has no report');
reset role;
insert into app.jobs (center_id, kind, payload, status, result) values (:c, 'niva.import_page', '{}'::jsonb, 'done', '{"secret": 1}'::jsonb);
select max(id) as other_job from app.jobs where kind = 'niva.import_page' and center_id = :c
\gset
select pg_temp.sign_in(:admin);
select pg_temp.assert_raises(format('select app.site_found_report(%L, %s)', :c, :other_job),
  'not available', 'D · only website reads can be fetched, not any other job''s result');
reset role;

-- ── E. Who may call what, and the bookkeeping ────────────────────────────────
select pg_temp.assert(not exists (
    select 1 from unnest(array['app.site_found_save_inputs(uuid,text,text[])', 'app.site_crawl_start(uuid,text)', 'app.site_found_status(uuid)', 'app.site_found_report(uuid,bigint)']) f
     where has_function_privilege('anon', f, 'execute') or not has_function_privilege('authenticated', f, 'execute')),
  'E · the four functions are for signed-in people only (not anon)');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.site_clean_address(text)', 'execute')
                      and not has_function_privilege('anon', 'app.site_clean_address(text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.site_host_key(text)', 'execute'),
  'E · the address check and the host key are internal helpers, closed to the API');
select pg_temp.assert(not exists (
    select 1 from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['select', 'insert', 'update', 'delete']) p
     where has_table_privilege(r, 'app.center_site_inputs', p)),
  'E · the table has no grant for the API at all');
select pg_temp.assert((select relrowsecurity from pg_class where oid = 'app.center_site_inputs'::regclass)
                      and not exists (select 1 from pg_policy where polrelid = 'app.center_site_inputs'::regclass),
  'E · row level security is on and there is NO policy: nothing but the checked functions reaches the addresses');
select pg_temp.sign_in(:admin);
select pg_temp.assert_raises('select * from app.center_site_inputs', 'permission denied', 'E · even an administrator cannot read the table directly');
reset role;
select pg_temp.assert((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname in ('site_clean_address', 'site_host_key', 'site_found_save_inputs', 'site_crawl_start', 'site_found_status', 'site_found_report')
                          and p.proconfig::text like '%search_path=app, public, extensions%') = 6,
  'E · every function pins the search path app, public, extensions');
select pg_temp.assert((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname in ('site_found_save_inputs', 'site_crawl_start', 'site_found_status', 'site_found_report') and p.prosecdef) = 4
                      and not (select p.prosecdef from pg_proc p where p.oid = 'app.site_clean_address(text)'::regprocedure),
  'E · the four functions are security definer as app.niva_discover_site is; the address helper is not');
select pg_temp.assert(exists (select 1 from pg_trigger t where t.tgrelid = 'app.center_site_inputs'::regclass and t.tgname = 'audit_center_site_inputs'
                                and t.tgfoid = 'app.audit_row'::regproc and not t.tgisinternal)
                      and exists (select 1 from app.module_tables where table_name = 'center_site_inputs' and module_key is null),
  'E · the table is audited and mapped to the core platform');
select pg_temp.assert((select count(*) from app.activity_catalog
                        where (key, surface) in (('screen:/setup/website', 'portal'), ('website.save_addresses', 'portal'), ('website.look_at_site', 'portal'))) = 3,
  'E · the screen and its two actions are in the activity allowlist (0641)');

rollback;
