-- 0200–0203 (onboarding stream o-platform): access requests, sandbox codes and their
-- redemption, attestations + readiness check 13, go-live with two approvals, support
-- grants, promotion sandbox → production (configuration only) and the expiry warnings.
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
create or replace function pg_temp.claims(p_user text, p_step_up boolean default false) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', case when p_step_up then 'aal2' else 'aal1' end,
    'amr', case when p_step_up
                then jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 600),
                                       jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 60))
                else jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 60)) end)::text, true);
end $$;
grant connect_worker to postgres;

\set cc1 '''23000000-0000-4000-8000-0000000000a1'''
\set cc2 '''23000000-0000-4000-8000-0000000000a2'''
\set owner '''23000000-0000-4000-8000-0000000000b1'''
\set stranger '''23000000-0000-4000-8000-0000000000b2'''
\set staff '''23000000-0000-4000-8000-0000000000b3'''
insert into auth.users (id, email, phone, phone_confirmed_at) values
  (:cc1, 'cc.one@platform.test', null, null),
  (:cc2, 'cc.two@platform.test', null, null),
  (:owner, 'asha@templeexample.org', '15555550199', null),
  (:stranger, 'someone@else.test', null, null),
  (:staff, 'tresa@templeexample.org', null, null);
insert into app.accounts (user_id, is_platform_admin) values (:cc1, true), (:cc2, true);
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status) values
  ('23000000-0000-4000-8000-0000000000f1', :owner, 'phone app', 'totp', 'verified');

-- ── Coverage ─────────────────────────────────────────────────────────────────
select pg_temp.assert((select count(*) from app.module_tables where module_key is null and table_name in
  ('access_requests','public_rate_events','sandbox_codes','center_attestations','golive_requests','support_grants',
   'sandbox_promotions','sandbox_expiry_notices')) = 8, 'the eight new tables are core platform tables in module_tables');
select pg_temp.assert((select check_fn::text from app.readiness_checks where key = 'staff_trained_pilot_done') = 'app.check_staff_trained_pilot_done',
  'readiness check 13 (staff_trained_pilot_done) is registered');
select pg_temp.assert(app.new_sandbox_code() ~ '^CC-SBX-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$'
                      and (select count(distinct app.new_sandbox_code()) from generate_series(1, 200)) = 200,
  'codes look like CC-SBX-XXXX-XXXX from the look-alike-free alphabet, and do not repeat');
select pg_temp.assert(app.normalize_sandbox_code(' cc-sbx 7k4m q2pd ') = 'CC-SBX-7K4M-Q2PD' and app.normalize_sandbox_code('7K4MQ2PD') = 'CC-SBX-7K4M-Q2PD'
                      and app.normalize_sandbox_code('CC-SBX-7K4M-Q2P0') is null and app.normalize_sandbox_code('CC-SBX-7K4M') is null,
  'a typed code is normalized (spaces, case, prefix optional); look-alike or short codes are refused');

-- ── Request access (anonymous) ───────────────────────────────────────────────
begin;
set local role anon;
select app.submit_access_request('Jain Temple of Example', 'temple', 'Dallas', 'TX', 240, 'Asha Mehta', 'Asha@TempleExample.org',
  '(713) 555-0142', 'https://templeexample.org', array['giving','events','not_a_module'], array['Neon', 'spreadsheets'], 'A friend',
  '198.51.100.7', 'TestAgent/1.0') as request_id \gset
select pg_temp.assert_raises($$select app.submit_access_request('X', 'temple', 'Dallas', 'TX', 1, 'Asha', 'a@b.c')$$, 'legal name',
  'a one-letter organization name is refused');
select pg_temp.assert_raises($$select app.submit_access_request('Temple', 'church', 'Dallas', 'TX', 1, 'Asha', 'a@b.c')$$, 'kind of organization',
  'an unknown organization type is refused');
select pg_temp.assert_raises($$select app.submit_access_request('Temple', 'temple', 'Dallas', 'TX', 1, 'Asha', 'not-an-email')$$, 'email address',
  'a bad email is refused');
select pg_temp.assert_raises($$select count(*) from app.access_requests$$, 'permission denied', 'anon cannot read access requests');
commit;
select pg_temp.assert((select contact_email = 'asha@templeexample.org' and contact_phone = '+17135550142' and modules_interested = '{events,giving}'
                              and status = 'new' and ip = '198.51.100.7'::inet and user_agent = 'TestAgent/1.0'
                         from app.access_requests where id = :'request_id'),
  'the request is stored with the email lower-cased, the phone in E.164, only real module keys, the address and browser');
select pg_temp.assert((select count(*) from app.public_rate_events where subject like '%@%' or subject = '198.51.100.7') = 0,
  'rate-limit subjects are hashed, never the address or email');

begin;
set local role anon;
select app.submit_access_request('Temple ' || i, 'temple', 'Austin', 'TX', 10, 'Bot Person', 'bot' || i || '@spam.test', null, null, '{}', '{}', null, '203.0.113.50')
  from generate_series(1, 5) i;
select pg_temp.assert_raises($$select app.submit_access_request('Temple 6', 'temple', 'Austin', 'TX', 10, 'Bot Person', 'bot6@spam.test', null, null, '{}', '{}', null, '203.0.113.50')$$,
  'Too many requests', 'a sixth request from the same address within the hour is refused');
select app.submit_access_request('Temple ' || i, 'temple', 'Austin', 'TX', 10, 'Same Person', 'same@spam.test', null, null, '{}', '{}', null, '203.0.113.' || (60 + i))
  from generate_series(1, 3) i;
select pg_temp.assert_raises($$select app.submit_access_request('Temple 4', 'temple', 'Austin', 'TX', 10, 'Same Person', 'SAME@spam.test', null, null, '{}', '{}', null, '203.0.113.99')$$,
  'already have requests from this email', 'a fourth request from the same email in a day is refused, whatever the address');
rollback;

-- ── Decide (platform admins) ─────────────────────────────────────────────────
begin;
set local role authenticated;
select pg_temp.claims(:stranger);
select pg_temp.assert((select count(*) from app.access_requests) = 0, 'a signed-in non-admin sees no access requests');
select pg_temp.assert_raises(format($$select app.decide_access_request(%L, 'approve')$$, :'request_id'), 'Community Connect team',
  'a non-admin cannot decide a request');
select pg_temp.claims(:cc1);
select pg_temp.assert((select count(*) from app.access_requests where id = :'request_id') = 1, 'a platform admin sees the request');
select pg_temp.assert_raises(format($$select app.decide_access_request(%L, 'decline')$$, :'request_id'), 'reason for declining',
  'declining needs a reason (the contact receives it)');
select pg_temp.assert_raises(format($$select app.issue_sandbox_code(%L, 'early')$$, :'request_id'), 'Approve the request',
  'no code before the request is approved');
select pg_temp.assert((app.decide_access_request(:'request_id', 'more_info', 'Which city is the temple in, exactly?'))->>'email_status' = 'queued',
  'asking for more information works and the email is queued (messaging is present)');
commit;
select pg_temp.assert((select status = 'more_info' and decision_note = 'Which city is the temple in, exactly?' and decided_by = :cc1
                              and decision_email_status = 'queued' from app.access_requests where id = :'request_id'),
  'the request records the question, who asked and that the email was not sent');
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'access_requests' and record_id = :'request_id'
                          and action = 'access_requests.update' and reason = 'Which city is the temple in, exactly?' and actor_user_id = :cc1) = 1,
  'audit: the decision with its note as the reason');

-- With messaging present (0220+), the email is queued, with the templates' names filled in (0290).
begin;
select (app.platform_send_message('x@y.test', 'sandbox_code',
          jsonb_build_object('code', 'CC-SBX-TEST-TEST', 'contact_name', 'Asha', 'org_name', 'Test Temple',
                             'expires_at', now() + interval '14 days', 'start_path', '/start'), 'sandbox_code')) as sent \gset
select pg_temp.assert((:'sent'::jsonb)->>'status' = 'queued', 'platform emails go through app.enqueue_message: ' || :'sent');
select pg_temp.assert((select body like '%Hello Asha,%' and body like '%only for x@y.test%' and body like '%Start here: \%PORTAL\_URL\%/start%'
                              and body not like '%CC-SBX-TEST-TEST%'
                         from app.messages where id = ((:'sent'::jsonb)->>'message_id')::uuid),
  'the sandbox-code email names the contact and address, links to /start through the portal marker, and does not store the code');
rollback;

begin;
set local role authenticated;
select pg_temp.claims(:cc1);
select (app.decide_access_request(:'request_id', 'approve', 'Looks like a real temple')) as approval \gset
commit;
select :'approval'::jsonb->>'code' as code, :'approval'::jsonb->>'code_id' as code_id \gset
select pg_temp.assert(:'code' ~ '^CC-SBX-' and (:'approval'::jsonb)->>'email_status' = 'queued', 'approving returns the plain code once, and says the email was queued');
select pg_temp.assert((select code_hash = encode(extensions.digest(:'code', 'sha256'), 'hex') and code_last4 = right(:'code', 4)
                              and email = 'asha@templeexample.org' and expires_at between now() + interval '13 days 23 hours' and now() + interval '14 days 1 minute'
                              and issued_by = :cc1 and email_status = 'queued'
                         from app.sandbox_codes where id = :'code_id'),
  'the code is stored as its sha-256 hash with the last 4 characters, bound to the contact email, for 14 days');
select pg_temp.assert(not exists (select 1 from app.sandbox_codes where to_jsonb(sandbox_codes)::text like '%' || :'code' || '%')
                      and not exists (select 1 from app.audit_log where record_table = 'sandbox_codes' and after::text like '%' || :'code' || '%'),
  'the plain code is neither in the table nor in the audit log');

-- Re-issue: the old code stops working.
begin;
set local role authenticated;
select pg_temp.claims(:cc1);
select code as code2, code_id as code2_id from app.issue_sandbox_code(:'request_id', 'Contact lost the email') \gset
commit;
begin;
set local role anon;
select pg_temp.assert(app.check_sandbox_code(:'code') = 'invalid' and app.check_sandbox_code(lower(replace(:'code2', '-', ' '))) = 'valid'
                      and app.check_sandbox_code('CC-SBX-2222-2222') = 'invalid',
  're-issuing revokes the earlier code; anon can check a code (any spacing or case) and learns only valid or invalid');
commit;
select pg_temp.assert((select revoke_reason from app.sandbox_codes where id = :'code_id') = 'Re-issued: Contact lost the email', 'the old code records why it was revoked');

-- Revoke needs a reason; a third code for the flow below.
begin;
set local role authenticated;
select pg_temp.claims(:cc2);
select pg_temp.assert_raises(format($$select app.revoke_sandbox_code(%L, '')$$, :'code2_id'), 'reason', 'revoking needs a reason');
select app.revoke_sandbox_code(:'code2_id', 'Sent to the wrong person');
select code as code3, code_id as code3_id from app.issue_sandbox_code(:'request_id', 'Fresh code') \gset
commit;

begin;
set local role anon;
select app.check_sandbox_code('CC-SBX-3333-3333', '192.0.2.44') from generate_series(1, 20);
select pg_temp.assert_raises($$select app.check_sandbox_code('CC-SBX-3333-3334', '192.0.2.44')$$, 'Too many codes', 'checking codes is rate-limited per address (20 an hour)');
rollback;

-- ── /start: the redeemer's progress ──────────────────────────────────────────
select id as terms_id from app.legal_documents where center_id is null and kind = 'sandbox_terms' \gset
begin;
set local role authenticated;
select pg_temp.claims(:stranger);
select pg_temp.assert((app.sandbox_start_status(:'code3'))->>'email_matches' = 'false'
                      and (app.sandbox_start_status(:'code3'))->>'code_email' like 'a%@templeexample.org',
  'someone signed in with another email learns only that the code is for a different (masked) email');
select pg_temp.assert_raises(format($$select app.redeem_sandbox_code(%L, 'jte')$$, :'code3'), 'This code was sent to', 'and cannot redeem it');
select pg_temp.claims(:owner);
select pg_temp.assert((select (s->>'email_matches')::boolean and not (s->>'phone_verified')::boolean and (s->>'has_totp')::boolean
                              and s->>'aal' = 'aal1' and not (s->>'terms_published')::boolean and s->>'suggested_slug' = 'jain-temple-of-example'
                         from app.sandbox_start_status(:'code3') s),
  'the contact sees their progress: email matches, phone not verified, an authenticator app, aal1, the terms not published, a suggested web name');
select pg_temp.assert_raises(format($$select app.accept_sandbox_terms(%L, %L)$$, :'code3', :'terms_id'),
  'not been published', 'unpublished sandbox terms cannot be accepted');
commit;
update app.legal_documents set published_at = now() - interval '1 minute' where center_id is null and kind in ('sandbox_terms','org_terms','dpa','children_addendum');

begin;
set local role authenticated;
select pg_temp.claims(:owner);
select app.accept_sandbox_terms(:'code3', :'terms_id', '198.51.100.7', 'TestAgent/2.0');
select pg_temp.assert_raises(format($$select app.redeem_sandbox_code(%L, 'jte')$$, :'code3'), 'authenticator app', 'redeeming needs an aal2 session');
select pg_temp.claims(:owner, true);
select pg_temp.assert_raises(format($$select app.redeem_sandbox_code(%L, 'jte')$$, :'code3'), 'Verify your mobile number', 'and a verified phone');
commit;
update auth.users set phone_confirmed_at = now() where id = :owner;
insert into app.centers (slug, name, status) values ('taken-name', 'Someone Else', 'active');

begin;
set local role authenticated;
select pg_temp.claims(:owner, true);
select pg_temp.assert_raises(format($$select app.redeem_sandbox_code(%L, 'Taken-Name')$$, :'code3'), 'already taken', 'a web name in use is refused');
select pg_temp.assert_raises(format($$select app.redeem_sandbox_code(%L, 'my-sandbox')$$, :'code3'), 'without "-sandbox"', 'the name must not end with -sandbox');
select pg_temp.assert_raises(format($$select app.redeem_sandbox_code(%L, 'Bad Name!')$$, :'code3'), 'web name', 'a malformed name is refused');
select (app.redeem_sandbox_code(:'code3', 'jte'))->>'center_id' as sandbox \gset
commit;

select pg_temp.assert((select slug::text = 'jte-sandbox' and environment = 'sandbox' and status = 'onboarding' and name = 'Jain Temple of Example'
                              and sandbox_for is null and (rules #>> '{security,require_2fa_for_staff}')::boolean
                              and rules #>> '{onboarding,production_slug}' = 'jte'
                         from app.centers where id = :'sandbox'),
  'the sandbox exists: <slug>-sandbox, environment sandbox, onboarding, 2FA required for staff');
select pg_temp.assert((select user_id from app.center_owners where center_id = :'sandbox') = :owner, 'the redeemer is the owner');
select pg_temp.assert((select status = 'active' and granted_by = :cc2 and reason like 'Sandbox code …% redeemed'
                         from app.role_grants where center_id = :'sandbox' and user_id = :owner and role_key = 'center_admin'),
  'and an active center_admin, granted on behalf of the admin who issued the code');
select pg_temp.assert((select count(*) from app.center_users cu join app.people p on p.id = cu.person_id
                        where cu.center_id = :'sandbox' and cu.user_id = :owner and p.first_name = 'Asha' and p.last_name = 'Mehta'
                          and p.email = 'asha@templeexample.org' and p.phone_e164 = '+15555550199') = 1,
  'the owner is linked to a person record in the sandbox');
select pg_temp.assert((select kind = 'sandbox_terms' and accepted_by = :owner and ip = '198.51.100.7'::inet and user_agent = 'TestAgent/2.0'
                         from app.org_agreements where center_id = :'sandbox'),
  'the sandbox-terms acceptance is recorded for the new organization (who, when, address, browser)');
select pg_temp.assert((select status from app.center_setup_steps where center_id = :'sandbox' and step_key = 'org.security') = 'done'
                      and (select count(*) from app.member_join_codes where center_id = :'sandbox') = 1
                      and (select legal_name from app.org_profiles where center_id = :'sandbox') = 'Jain Temple of Example',
  'the Setup checklist starts with owner security done, a member join code and the legal name');
select pg_temp.assert((select redeemed_by = :owner and center_id = :'sandbox' from app.sandbox_codes where id = :'code3_id'), 'the code is marked used');
select pg_temp.assert((select count(*) from app.audit_log where center_id = :'sandbox' and action = 'role_grants.insert'
                          and reason like 'Sandbox code …% redeemed') = 1
                      and (select count(*) from app.audit_log where action = 'sandbox_codes.update' and record_id = :'code3_id'
                              and actor_user_id = :owner and reason like 'Sandbox code …% redeemed') = 1,
  'audit: the grant and the redemption, with the reason');
begin;
set local role anon;
select pg_temp.assert(app.check_sandbox_code(:'code3') = 'used', 'the code now reads as used');
commit;
begin;
set local role authenticated;
select pg_temp.claims(:owner, true);
select pg_temp.assert_raises(format($$select app.redeem_sandbox_code(%L, 'jte2')$$, :'code3'), 'already been used', 'a code works once');
commit;
update app.sandbox_codes set expires_at = now() - interval '1 minute' where id = :'code2_id';
begin;
set local role anon;
select pg_temp.assert(app.check_sandbox_code(:'code2') = 'invalid', 'a revoked code stays invalid even once expired');
commit;

-- ── Attestations and readiness 13 ────────────────────────────────────────────
begin;
set local role authenticated;
select pg_temp.claims(:stranger);
select pg_temp.assert_raises(format($$select app.attest_center(%L, 'staff_trained')$$, :'sandbox'), 'Only the owner', 'only the owner confirms');
select pg_temp.claims(:owner, true);
select app.attest_center(:'sandbox', 'staff_trained', 'All six staff watched the videos');
select pg_temp.assert((select detail from app.readiness(:'sandbox') where key = 'staff_trained_pilot_done') like '%not confirmed yet: sandbox health check green, pilot%',
  'check 13 lists what the owner has not confirmed');
select app.attest_center(:'sandbox', 'health_check_green');
select app.attest_center(:'sandbox', 'pilot_done', '40 families, 97% signed in');
select pg_temp.assert((select ok and detail like 'The owner confirmed: staff trained%' from app.readiness(:'sandbox') where key = 'staff_trained_pilot_done'),
  'with all three confirmations check 13 passes');
select pg_temp.assert((select count(*) from app.setup_checklist(:'sandbox') where step_key like 'test.%' and status = 'done') = 3,
  'and the three test.* Setup steps are done');
select pg_temp.assert_raises(format($$select app.check_staff_trained_pilot_done(%L)$$, :'sandbox'), 'permission denied', 'the check itself runs only through app.readiness');
select pg_temp.assert_raises(format($$select app.request_golive(%L)$$, :'sandbox'), 'Not passing yet', 'go-live is refused while any readiness check fails');
commit;
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'center_attestations' and center_id = :'sandbox'
                          and reason = '40 families, 97% signed in') = 1, 'audit: the attestation with the owner''s note');

-- ── Go-live (readiness narrowed to the passing check, inside this test only) ─
create temp table saved_checks as select * from app.readiness_checks;
delete from app.readiness_checks where key <> 'staff_trained_pilot_done';
begin;
set local role authenticated;
select pg_temp.claims(:owner, true);
select app.request_golive(:'sandbox') as golive \gset
select pg_temp.assert_raises(format($$select app.request_golive(%L)$$, :'sandbox'), 'already open', 'one open go-live request at a time');
select pg_temp.assert_raises(format($$select app.approve_golive(%L)$$, :'golive'), 'Community Connect team', 'the owner cannot approve');
select pg_temp.claims(:cc1);
select pg_temp.assert(app.approve_golive(:'golive', 'Checked the evidence') = 'first_approval', 'the first platform admin approves');
select pg_temp.assert_raises(format($$select app.approve_golive(%L)$$, :'golive'), 'second, different', 'the same admin cannot approve twice');
commit;
begin;
set local role authenticated;
select pg_temp.claims(:owner, true);
select pg_temp.assert_raises(format($$select app.promote_sandbox(%L, 'jte', 'Go live')$$, :'sandbox'), 'two approvals', 'no promotion before the second approval');
select pg_temp.claims(:cc2);
select pg_temp.assert(app.approve_golive(:'golive') = 'approved', 'a second, different platform admin approves');
commit;
select pg_temp.assert((select status = 'approved' and first_approver = :cc1 and second_approver = :cc2 and jsonb_array_length(readiness) = 1
                         from app.golive_requests where id = :'golive'),
  'the request is approved by two different people, with the readiness evidence captured at request time');
select pg_temp.assert((select status from app.center_setup_steps where center_id = :'sandbox' and step_key = 'golive.request') = 'in_progress',
  'the golive.request step moves on');
insert into app.readiness_checks select * from saved_checks on conflict (key) do nothing;

-- ── Support access ───────────────────────────────────────────────────────────
begin;
set local role authenticated;
select pg_temp.claims(:owner, true);
select pg_temp.assert_raises(format($$select app.grant_support_access(%L, %L, 4, 'help')$$, :'sandbox', :stranger), 'Community Connect team',
  'support access goes only to the Community Connect team');
select app.grant_support_access(:'sandbox', :cc1, 4, 'Help with the import mapping') as grant_id \gset
select pg_temp.claims(:cc1);
select pg_temp.assert(app.has_support_grant(:'sandbox') and (select count(*) from app.support_grants where center_id = :'sandbox') = 1,
  'the grantee has a live grant and sees it');
select pg_temp.claims(:stranger);
select pg_temp.assert((select count(*) from app.support_grants) = 0 and not app.has_support_grant(:'sandbox'), 'others see no grants');
select pg_temp.claims(:owner, true);
select app.revoke_support_access(:'grant_id', 'Done');
commit;
select pg_temp.assert((select revoked_by = :owner and expires_at <= now() + interval '4 hours' from app.support_grants where id = :'grant_id'),
  'the owner ends it; the grant was time-boxed');

-- ── Promotion (configuration only) ───────────────────────────────────────────
-- Sandbox configuration and test data.
insert into app.zones (center_id, name) values (:'sandbox', 'North zone');
insert into app.center_modules (center_id, module_key, enabled, reason) values (:'sandbox', 'store', false, 'No store');
insert into app.funds (id, center_id, key, name) values ('23000000-0000-4000-8000-0000000000d1', :'sandbox', 'general', 'General fund');
insert into app.campaigns (center_id, fund_id, name, kind, status) values (:'sandbox', '23000000-0000-4000-8000-0000000000d1', 'Paryushan 2026', 'general', 'published');
insert into app.households (center_id, display_name) values (:'sandbox', 'Test family household');
insert into app.people (center_id, first_name, last_name, email) values (:'sandbox', 'Test', 'Person', 'test.person@example.test');
insert into app.integration_connections (center_id, provider, status, display_name) values (:'sandbox', 'stripe', 'connected', 'Stripe test');
insert into app.people (id, center_id, first_name, last_name, email) values ('23000000-0000-4000-8000-0000000000c3', :'sandbox', 'Tresa', 'Shah', 'tresa@templeexample.org');
insert into app.center_users (center_id, user_id, person_id) values (:'sandbox', :staff, '23000000-0000-4000-8000-0000000000c3');
insert into app.role_grants (center_id, user_id, role_key, scope_kind) values (:'sandbox', :staff, 'treasurer', 'center');

begin;
set local role authenticated;
select pg_temp.claims(:stranger, true);
select pg_temp.assert_raises(format($$select app.promote_sandbox(%L, 'jte', 'Go live')$$, :'sandbox'), 'Only the owner', 'only the owner promotes');
select pg_temp.claims(:owner, false);
select pg_temp.assert_raises(format($$select app.promote_sandbox(%L, 'jte', 'Go live')$$, :'sandbox'), 'fresh 2FA', 'promotion needs a fresh 2FA check');
select pg_temp.claims(:owner, true);
select pg_temp.assert_raises(format($$select app.promote_sandbox(%L, 'taken-name', 'Go live')$$, :'sandbox'), 'already taken', 'the production web name must be free');
select app.promote_sandbox(:'sandbox', 'jte', 'Approved by CC; final data load next') as promotion \gset
commit;
select job_id from app.sandbox_promotions where id = :'promotion' \gset
select pg_temp.assert((select kind = 'platform.promote' and payload->>'promotion_id' = :'promotion' and center_id = :'sandbox' and status = 'queued'
                         from app.jobs where id = :'job_id'), 'promotion queues the platform.promote job');

begin;
set local role authenticated;
select pg_temp.claims(:owner, true);
select pg_temp.assert_raises(format($$select app.worker_promote_sandbox(%L)$$, :'promotion'), 'permission denied', 'only the worker runs the promotion');
commit;
begin;
set local role connect_worker;
select app.worker_promote_sandbox(:'promotion') as result \gset
commit;
select id as prod from app.centers where slug = 'jte' \gset
select pg_temp.assert((select environment = 'production' and status = 'onboarding' and name = 'Jain Temple of Example' and rules #>> '{onboarding,promoted_from}' = :'sandbox'
                         from app.centers where id = :'prod')
                      and (select sandbox_for from app.centers where id = :'sandbox') = :'prod',
  'the production center exists (onboarding) and the sandbox points to it');
select pg_temp.assert((select count(*) from app.zones where center_id = :'prod' and name = 'North zone') = 1
                      and (select c.fund_id = f.id from app.campaigns c join app.funds f on f.center_id = :'prod' and f.key = 'general'
                            where c.center_id = :'prod' and c.name = 'Paryushan 2026')
                      and (select id from app.funds where center_id = :'prod' and key = 'general') <> '23000000-0000-4000-8000-0000000000d1',
  'configuration is copied with new ids, and references between copied rows follow (campaign → fund)');
select pg_temp.assert((select legal_name from app.org_profiles where center_id = :'prod') = 'Jain Temple of Example'
                      and (select not enabled from app.center_modules where center_id = :'prod' and module_key = 'store'),
  'the profile / legal identity and the module switches (a platform catalog reference) are copied');
select pg_temp.assert((select count(*) from app.people where center_id = :'prod') = 1
                      and (select count(*) from app.households where center_id = :'prod') = 1
                      and (select count(*) from app.integration_connections where center_id = :'prod') = 0
                      and (select count(*) from app.org_agreements where center_id = :'prod') = 0,
  'no test people or households (only the owner''s own record), no connections or credentials, no agreements');
select pg_temp.assert((select user_id from app.center_owners where center_id = :'prod') = :owner
                      and (select status from app.role_grants where center_id = :'prod' and user_id = :owner and role_key = 'center_admin') = 'active',
  'the owner owns production as its first administrator');
select pg_temp.assert((select email = 'tresa@templeexample.org' and role_keys = '{treasurer}' and invited_by = :owner and accepted_at is null
                         from app.staff_invitations where center_id = :'prod'),
  'the sandbox staff member is re-invited to production with the same roles (not copied as a login)');
select pg_temp.assert((select status = 'done' and production_id = :'prod' and (result->>'staff_reinvited')::int = 1 from app.sandbox_promotions where id = :'promotion'),
  'the promotion is recorded as done with its summary');
select pg_temp.assert((select count(*) from app.audit_log where center_id = :'prod' and client_app = 'job' and reason like 'Promotion from sandbox jte-sandbox%') > 5,
  'audit: every copied row is recorded as a job change with the promotion reason');
select count(*) as n_centers from app.centers \gset
begin;
set local role connect_worker;
select app.worker_promote_sandbox(:'promotion') as again \gset
commit;
select pg_temp.assert(:'again'::jsonb = (select result from app.sandbox_promotions where id = :'promotion') and (select count(*) from app.centers) = :n_centers,
  'running the job again changes nothing (idempotent)');
update app.centers set status = 'active' where id = :'prod';
select pg_temp.assert((select status from app.golive_requests where id = :'golive') = 'live', 'when production goes live, the go-live request is live');

-- ── Pipeline and expiry warnings ─────────────────────────────────────────────
insert into app.centers (id, slug, name, status, environment, created_at)
values ('23000000-0000-4000-8000-0000000000e9', 'quiet-sandbox', 'Quiet Sangh', 'onboarding', 'sandbox', now() - interval '65 days');
insert into app.center_owners (center_id, user_id) values ('23000000-0000-4000-8000-0000000000e9', :stranger);
begin;
set local role authenticated;
select pg_temp.claims(:stranger);
select pg_temp.assert_raises($$select * from app.platform_onboarding_pipeline()$$, 'Community Connect team', 'the pipeline is for platform admins');
select pg_temp.assert_raises($$select app.worker_sandbox_expiry()$$, 'permission denied', 'only the worker runs the expiry job');
select pg_temp.claims(:cc1);
select pg_temp.assert((select stage = 'promoted' and promoted_to = 'jte' and owner_email = 'asha@templeexample.org' and steps_total > 0
                         from app.platform_onboarding_pipeline() where slug = 'jte-sandbox'),
  'the pipeline shows the sandbox as promoted, with its owner and checklist');
commit;
begin;
set local role connect_worker;
select pg_temp.assert(((app.worker_sandbox_expiry())->>'warnings')::int >= 1, 'the expiry job warns a sandbox inactive for 65 days');
select pg_temp.assert(((app.worker_sandbox_expiry())->>'warnings')::int = 0, 'and does not warn twice for the same threshold');
commit;
select pg_temp.assert((select threshold_days = 60 and email_status = 'queued' from app.sandbox_expiry_notices
                        where center_id = '23000000-0000-4000-8000-0000000000e9'),
  'the 60-day notice is recorded (email not set up yet)');
select pg_temp.assert(not exists (select 1 from app.sandbox_expiry_notices where center_id = :'sandbox'), 'a promoted sandbox gets no warnings');
select pg_temp.assert(exists (select 1 from app.centers where id = '23000000-0000-4000-8000-0000000000e9'), 'nothing is deleted');
