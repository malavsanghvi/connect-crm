-- 0612 · Neutral "Request access": what the applicant chose is stored in the catalog's words, the old three-word kind
-- is gone as a rule (old rows stay valid), a caller that still sends 14 arguments keeps working, and the platform's own
-- templates say Weaver. JSH is untouched: nothing here reads or writes an organization's own rows.
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
  if position(lower(expect) in lower(sqlerrm)) = 0 then
    raise exception 'FAIL: % (got "%")', label, sqlerrm;
  end if;
  raise notice 'PASS: %', label;
end $$;

-- ── One function, callable by an anonymous visitor ───────────────────────────
select pg_temp.assert((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname = 'submit_access_request') = 1,
  'there is one submit_access_request, whatever its number of arguments (the 14-argument one of 0200 and any 15-argument one were replaced, not kept beside it)');
select pg_temp.assert((select has_function_privilege('anon', p.oid, 'execute')
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname = 'submit_access_request'),
  'an anonymous visitor may submit a request');
select pg_temp.assert((select p.pronargs = 19 and p.pronargdefaults = 12
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname = 'submit_access_request'),
  'it takes the 14 arguments of 0200, the requested category and the four new fields: 19 in all, the last 12 optional');

-- ── Submitting with the new fields ──────────────────────────────────────────
begin;
set local role anon;
select app.submit_access_request('Riverside Chamber of Commerce', 'business_association', 'Springfield', 'IL', 120, 'Pat Lee', 'Pat@Riverside.example',
  '(212) 555-0123', null, array['events','not_a_module','membership'], array['Spreadsheets'], null, '198.51.100.21', 'TestAgent/2.0',
  p_org_detail => 'Mostly local retailers', p_org_type_label => 'Chamber of commerce or business association') as chamber_id \gset
select app.submit_access_request('First Example Church', 'faith_based', 'Dallas', 'TX', 300, 'Sam Ortiz', 'sam@church.example',
  null, null, '{}', '{}', null, '198.51.100.22', null,
  p_experience_key => 'church', p_org_detail => 'A Filipino church in Dallas', p_org_type_label => 'Faith-based', p_experience_label => 'Church') as church_id \gset
select app.submit_access_request('Example Hall', 'faith_based', 'Austin', 'TX', 80, 'Lee Tran', 'lee@hall.example',
  null, null, '{}', '{}', null, '198.51.100.24', null,
  p_experience_key => 'other', p_org_detail => 'We are a small community that meets in a hall', p_org_type_label => 'Faith-based',
  p_experience_label => 'Another tradition or community') as other_faith_id \gset
-- The experience the applicant chose from the catalog (an active row; Jain Center always is) goes to requested_category_key.
select app.submit_access_request('Example Jain Temple', 'faith_based', 'Houston', 'TX', 500, 'Asha Shah', 'asha@jaintemple.example',
  null, null, '{}', '{}', null, '198.51.100.25', null, 'jain_center', p_experience_key => 'jain_center', p_org_type_label => 'Faith-based',
  p_experience_label => 'Jain temple') as catalog_id \gset
-- A caller that sends only the experience (the shape an earlier 15-argument version had) gets its group worked out.
select app.submit_access_request('Only A Kind', '', 'Houston', 'TX', 5, 'Asha Shah', 'only@kind.example',
  null, null, '{}', '{}', null, '198.51.100.26', null, 'jain_center') as only_kind_id \gset
-- A portal that has not been updated yet still sends the 14 arguments, with one of the three old kinds.
select app.submit_access_request('Old Temple', 'temple', 'Austin', 'TX', 10, 'Old Caller', 'old@caller.example',
  null, null, '{}', '{}', null, '198.51.100.23', 'OldPortal/1') as old_id \gset
commit;

select pg_temp.assert((select org_type = 'business_association' and experience_key is null and org_detail = 'Mostly local retailers'
                              and org_type_label = 'Chamber of commerce or business association' and experience_label is null
                              and contact_email = 'pat@riverside.example' and contact_phone = '+12125550123'
                              and modules_interested = '{events,membership}' and status = 'new'
                         from app.access_requests where id = :'chamber_id'),
  'a chamber of commerce request keeps its group, its own words and its label; the email is lower-cased, the phone is E.164 and only real module keys stay');
select pg_temp.assert((select org_type = 'faith_based' and experience_key = 'church' and experience_label = 'Church'
                              and org_detail = 'A Filipino church in Dallas' and org_type_label = 'Faith-based'
                         from app.access_requests where id = :'church_id'),
  'a faith-based request keeps the specific choice and the applicant''s own words');
select pg_temp.assert((select experience_key = 'other' and org_detail like 'We are a small community%'
                         from app.access_requests where id = :'other_faith_id'),
  'Another tradition or community is accepted with a description');
select pg_temp.assert((select org_type = 'temple' and experience_key is null and org_detail is null and org_type_label is null
                              and requested_category_key is null
                         from app.access_requests where id = :'old_id'),
  'a call with the old 14 arguments still works and stores an old kind as before');
select pg_temp.assert((select requested_category_key = 'jain_center' and experience_key = 'jain_center' and org_type = 'faith_based'
                         from app.access_requests where id = :'catalog_id'),
  'the experience chosen from the catalog is stored as requested_category_key (so Platform > New sandbox can preselect it)');
select pg_temp.assert((select requested_category_key = 'jain_center' and org_type = 'faith_based'
                         from app.access_requests where id = :'only_kind_id'),
  'a caller that gives only the experience gets its group (faith_based) worked out');
select pg_temp.assert((select requested_category_key is null from app.access_requests where id = :'church_id'),
  'a choice that is not a catalog row (the built-in list) stores no requested category');

-- ── Refusals, in plain English ──────────────────────────────────────────────
begin;
set local role anon;
select pg_temp.assert_raises($$select app.submit_access_request('Some Club', 'other', 'Austin', 'TX', 10, 'Pat Lee', 'pat@club.example', null, null, '{}', '{}', null, '198.51.100.31')$$,
  'Tell us a little about your organization', 'Other needs a description');
select pg_temp.assert_raises($$select app.submit_access_request('Some Hall', 'faith_based', 'Austin', 'TX', 10, 'Pat Lee', 'pat@hall.example', null, null, '{}', '{}', null, '198.51.100.32', null, p_experience_key => 'other', p_org_detail => '  ')$$,
  'Tell us a little about your organization', 'Another tradition needs a description');
select pg_temp.assert_raises($$select app.submit_access_request('Some Hall', 'faith_based', 'Austin', 'TX', 10, 'Pat Lee', 'pat@hall.example', null, null, '{}', '{}', null, '198.51.100.37', null, 'no_such_kind')$$,
  'Choose one of the kinds of organization in the list', 'a requested category that is not in the catalog is refused');
select pg_temp.assert_raises($$select app.submit_access_request('Some Club', 'Not A Key!', 'Austin', 'TX', 10, 'Pat Lee', 'pat@club.example', null, null, '{}', '{}', null, '198.51.100.33')$$,
  'kind of organization', 'a kind that is not a key is refused');
select pg_temp.assert_raises($$select app.submit_access_request('Some Club', '', 'Austin', 'TX', 10, 'Pat Lee', 'pat@club.example', null, null, '{}', '{}', null, '198.51.100.34')$$,
  'kind of organization', 'no kind is refused');
select pg_temp.assert_raises($$select app.submit_access_request('Some Hall', 'faith_based', 'Austin', 'TX', 10, 'Pat Lee', 'pat@hall.example', null, null, '{}', '{}', null, '198.51.100.35', null, p_experience_key => 'Not A Key!')$$,
  'Choose which description fits', 'a specific choice that is not a key is refused');
select pg_temp.assert_raises($$select app.submit_access_request('Some Club', 'club_association', 'Austin', 'TX', 10, 'Pat Lee', 'pat@club.example', 'call me', null, '{}', '{}', null, '198.51.100.36')$$,
  '(212) 555-0123', 'a bad phone number is explained with a neutral example');
select pg_temp.assert_raises($$select count(*) from app.access_requests$$, 'permission denied', 'an anonymous visitor still cannot read access requests');
rollback;

-- ── The table's own rules ────────────────────────────────────────────────────
select pg_temp.assert_raises($$insert into app.access_requests (org_legal_name, org_type, city, state, contact_name, contact_email)
                               values ('Bad Kind', 'Bad Kind', 'Austin', 'TX', 'Pat Lee', 'pat@bad.example')$$,
  'access_requests_org_type_format', 'the table refuses a kind that is not a key');
select pg_temp.assert_raises($$insert into app.access_requests (org_legal_name, org_type, city, state, contact_name, contact_email, org_detail)
                               values ('Long Detail', 'other', 'Austin', 'TX', 'Pat Lee', 'pat@long.example', repeat('x', 501))$$,
  'access_requests_org_detail_length', 'the table refuses a description over 500 characters');
select pg_temp.assert((select count(*) from app.access_requests where org_type in ('temple','community_center','other_nonprofit')) >= 1,
  'requests of the old three kinds stay valid');

-- ── The platform's own templates say Weaver ─────────────────────────────────
-- Only a platform row that still held the exact text its migration seeded (0220, 0290, 0594) was rewritten (the VALUES of 0612
-- section C); an edited row or an organization's own copy would keep its words. Here: every seeded default now says Weaver.
select pg_temp.assert((select count(*) from app.message_templates
                        where center_id is null and (coalesce(subject, '') like '%Community Connect%' or body like '%Community Connect%')
                          and key in ('sandbox_code','request_declined','request_more_info','staff_invitation','test_message',
                                      'recipient_verification','sandbox_expiry','qbo_connection_alert','category_changed')) = 0,
  'the platform default templates of 0220, 0290 and 0594 no longer say Community Connect');
select pg_temp.assert((select subject = 'Your Weaver sandbox code' and body like '%{{code}}%' and body like '%{{link}}%' and body like '%The Weaver team%'
                         from app.message_templates where center_id is null and key = 'sandbox_code' and channel = 'email' and language = 'en'),
  'the sandbox code e-mail says Weaver and keeps every placeholder');
select pg_temp.assert((select count(*) from app.message_templates where center_id is null and key = 'test_message' and channel = 'sms'
                          and body = '{{center_short_name}}: this is a test text from Weaver. Texting works.') = 1,
  'the test text says Weaver');
select pg_temp.assert((select count(*) from app.message_templates where center_id is null and key in
  ('sandbox_code','request_declined','request_more_info','staff_invitation','test_message','recipient_verification','sandbox_expiry','category_changed')) >= 10,
  'the platform templates are all still there (a wording change, nothing removed)');
