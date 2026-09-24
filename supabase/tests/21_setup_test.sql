-- 0180–0184 (onboarding stream o-setup): organization profile, legal identity and
-- non-profit verification, IRS lookup, leaders mirrored to the roster, the Setup
-- checklist with computed statuses, the readiness registry, the brand kit.
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

-- A fresh onboarding center so the results do not depend on earlier tests.
\set c '''21000000-0000-4000-8000-000000000001'''
insert into app.centers (id, slug, name, short_name, status) values (:c, 'setup-test', 'Setup Test Sangh', 'STS', 'onboarding');
insert into auth.users (id, email) values
  ('21000000-0000-4000-8000-00000000a001', 'owner.setup@example.com'),     -- center admin (settings.manage)
  ('21000000-0000-4000-8000-00000000a002', 'member.setup@example.com'),    -- member, no staff role
  ('21000000-0000-4000-8000-00000000a003', 'cc.one@example.com'),          -- platform admin
  ('21000000-0000-4000-8000-00000000a004', 'cc.two@example.com');          -- platform admin
insert into app.accounts (user_id, is_platform_admin) values
  ('21000000-0000-4000-8000-00000000a003', true), ('21000000-0000-4000-8000-00000000a004', true);
insert into app.people (id, center_id, first_name, last_name) values
  ('21000000-0000-4000-8000-00000000b001', :c, 'Ona', 'Owner'),
  ('21000000-0000-4000-8000-00000000b002', :c, 'Mani', 'Member');
insert into app.center_users (center_id, user_id, person_id) values
  (:c, '21000000-0000-4000-8000-00000000a001', '21000000-0000-4000-8000-00000000b001'),
  (:c, '21000000-0000-4000-8000-00000000a002', '21000000-0000-4000-8000-00000000b002');
insert into app.role_grants (center_id, user_id, role_key, scope_kind) values (:c, '21000000-0000-4000-8000-00000000a001', 'center_admin', 'center');

-- IRS fixture rows (the loader's output shape).
insert into app.irs_exempt_orgs (ein, name, city, state, subsection, deductibility, status, source, in_pub78, revoked_on) values
  ('741234567', 'SETUP TEST SANGH INC', 'HOUSTON', 'TX', '03', '1', 'active', 'eo_bmf+pub78', true, null),
  ('749999999', 'REVOKED TEMPLE', 'AUSTIN', 'TX', '03', '1', 'revoked', 'eo_bmf+revocation', false, '2020-05-15');

-- ── Catalog, registry, coverage ──────────────────────────────────────────────
select pg_temp.assert((select count(distinct stage) from app.setup_steps) = 9 and (select min(stage) from app.setup_steps) = 0
                       and (select max(stage) from app.setup_steps) = 8, 'the checklist covers stages 0 to 8');
select pg_temp.assert((select count(*) from app.setup_steps where stage = 0) >= 8, 'stage 0 has its sub-steps (security, legal, profile, brand, leaders, modules, team, rules, agreements)');
select pg_temp.assert((select array_agg(key order by sort) from app.readiness_checks where key in ('nonprofit_verified','setup_data_complete','member_legal_documents_published'))
                       = array['nonprofit_verified','setup_data_complete','member_legal_documents_published'],
  'o-setup registers its three readiness checks in plan order');
select pg_temp.assert((select bool_and(module_key is null) from app.module_tables
                        where table_name in ('org_profiles','org_documents','org_leaders','irs_exempt_orgs','setup_steps','center_setup_steps','readiness_checks'))
                       and (select count(*) from app.module_tables
                        where table_name in ('org_profiles','org_documents','org_leaders','irs_exempt_orgs','setup_steps','center_setup_steps','readiness_checks')) = 7,
  'the new tables are core platform in module_tables');

-- ── IRS lookup ───────────────────────────────────────────────────────────────
begin;
set local role authenticated;
set local request.jwt.claim.sub = '21000000-0000-4000-8000-00000000a002';
select pg_temp.assert((select (j->>'found')::boolean and (j->>'ok')::boolean and j->>'name_match' = 'exact' and j->>'ein' = '74-1234567'
                         from (select app.irs_lookup('74-1234567', 'Setup Test Sangh, Inc.') j) x),
  'irs_lookup finds the EIN in any format and matches the name without punctuation or "Inc"');
select pg_temp.assert((select j->>'name_match' = 'different' and not (j->>'ok')::boolean from (select app.irs_lookup('741234567', 'Another Group') j) x),
  'a different name is flagged');
select pg_temp.assert((select (j->>'revoked')::boolean and not (j->>'ok')::boolean and j->>'detail' like '%revoked%' from (select app.irs_lookup('74-9999999') j) x),
  'a revoked exemption is flagged');
select pg_temp.assert((select not (j->>'found')::boolean and j->>'detail' like '%board or attorney letter%' from (select app.irs_lookup('11-1111111') j) x),
  'an EIN not in the list says so, and points houses of worship to a letter');
select pg_temp.assert((select count(*) from app.irs_exempt_orgs) = 0, 'the IRS table itself is readable by platform admins only');
commit;

-- ── Legal identity, documents, verification ──────────────────────────────────
begin;
set local role authenticated;
set local request.jwt.claim.sub = '21000000-0000-4000-8000-00000000a002';   -- member
select pg_temp.assert_raises($$insert into app.org_profiles (center_id, legal_name) values ('21000000-0000-4000-8000-000000000001', 'X Y')$$,
  'row-level security', 'a member cannot write the organization profile');
select pg_temp.assert((select count(*) from app.org_profiles) = 0, 'a member cannot read the legal identity');
select pg_temp.assert_raises($$select * from app.setup_checklist('21000000-0000-4000-8000-000000000001')$$,
  'don''t have access', 'a member cannot open the Setup checklist');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '21000000-0000-4000-8000-00000000a001';   -- center admin
set local request.headers = '{"x-client-app":"portal","x-client-screen":"/setup/organization","x-request-id":"21212121-2121-4121-8121-212121212121"}';
insert into app.org_profiles (center_id, legal_name, ein, entity_type, incorporation_state, fiscal_year_start_month, authorized_signer_name, authorized_signer_title)
values (:c, 'Setup Test Sangh Inc', '741234567', 'public_charity', 'TX', 1, 'Ona Owner', 'President');
select pg_temp.assert((select ein = '74-1234567' and verification_status = 'unverified' from app.org_profiles where center_id = :c),
  'the EIN is stored as NN-NNNNNNN and a new profile is unverified');
select pg_temp.assert_raises($$update app.org_profiles set verification_status = 'verified' where center_id = '21000000-0000-4000-8000-000000000001'$$,
  'Submit for verification', 'the organization cannot mark itself verified');
select pg_temp.assert_raises($$select app.submit_org_verification('21000000-0000-4000-8000-000000000001')$$,
  'a signed W-9', 'submitting without documents names what is missing');
insert into app.org_documents (center_id, kind, storage_path, file_name, uploaded_by)
values (:c, 'w9', '21000000-0000-4000-8000-000000000001/w9-1.pdf', 'w9.pdf', '21000000-0000-4000-8000-00000000a001');
select pg_temp.assert_raises($$insert into app.org_documents (center_id, kind, storage_path, uploaded_by) values ('21000000-0000-4000-8000-000000000001', 'other', '00000000-0000-4000-8000-000000000001/x.pdf', '21000000-0000-4000-8000-00000000a001')$$,
  'check', 'a document path must be under the center''s own folder');
select pg_temp.assert_raises($$select app.submit_org_verification('21000000-0000-4000-8000-000000000001')$$,
  'determination letter', 'a W-9 alone is not enough');
insert into app.org_documents (center_id, kind, storage_path, file_name, uploaded_by)
values (:c, 'determination_letter', '21000000-0000-4000-8000-000000000001/dl-1.pdf', 'letter.pdf', '21000000-0000-4000-8000-00000000a001');
select pg_temp.assert((select app.submit_org_verification(:c)->>'status') = 'submitted', 'with a W-9 and a determination letter the organization submits');
select pg_temp.assert_raises($$select app.decide_org_verification('21000000-0000-4000-8000-000000000001', true, null)$$,
  'platform admins', 'the organization cannot verify itself');
commit;

select pg_temp.assert((select after->'irs_lookup'->>'name_match' = 'exact' and client_screen = '/setup/organization'
                          and correlation_id = '21212121-2121-4121-8121-212121212121'
                         from app.audit_log where action = 'org_profiles.submit_verification' and center_id = :c order by id desc limit 1),
  'submitting is audited with the IRS lookup, the screen and the request id');
select pg_temp.assert((select count(*) from app.audit_log where action = 'org_documents.insert' and center_id = :c) = 2,
  'each document upload is audited');

begin;
set local role authenticated;
set local request.jwt.claim.sub = '21000000-0000-4000-8000-00000000a003';   -- platform admin
select pg_temp.assert((select verification_status = 'submitted' and documents = 2 and irs->>'name_match' = 'exact'
                         from app.org_verification_queue() where center_id = :c),
  'Platform › Verification shows the submission with its documents and the IRS result');
select pg_temp.assert_raises($$select app.decide_org_verification('21000000-0000-4000-8000-000000000001', false, '  ')$$,
  'what is missing', 'sending back needs a note');
select pg_temp.assert((select app.decide_org_verification(:c, false, 'The W-9 is not signed.')->>'status') = 'rejected', 'a platform admin sends it back with a note');
commit;
select pg_temp.assert((select reason = 'The W-9 is not signed.' from app.audit_log where action = 'org_profiles.reject_verification' and center_id = :c order by id desc limit 1),
  'the send-back is audited with the note as the reason');

begin;
set local role authenticated;
set local request.jwt.claim.sub = '21000000-0000-4000-8000-00000000a001';
insert into app.org_documents (center_id, kind, storage_path, file_name, uploaded_by, note)
values (:c, 'w9', '21000000-0000-4000-8000-000000000001/w9-2.pdf', 'w9-signed.pdf', '21000000-0000-4000-8000-00000000a001', 'Signed');
select pg_temp.assert((select app.submit_org_verification(:c)->>'status') = 'submitted', 'the organization re-submits after fixing it');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '21000000-0000-4000-8000-00000000a004';   -- a second platform admin
select pg_temp.assert((select app.decide_org_verification(:c, true, null)->>'status') = 'verified', 'a platform admin verifies');
commit;
select pg_temp.assert((select verification_status = 'verified' and verified_by = '21000000-0000-4000-8000-00000000a004' and verified_at is not null
                         from app.org_profiles where center_id = :c), 'who verified and when are recorded');
select pg_temp.assert((select count(*) from app.audit_log where action = 'org_profiles.verify' and center_id = :c) = 1, 'verifying is audited');

-- Changing the legal identity after verification un-verifies it.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '21000000-0000-4000-8000-00000000a001';
update app.org_profiles set legal_name = 'Setup Test Sangh of Texas' where center_id = :c;
select pg_temp.assert((select verification_status = 'unverified' and verification_note like '%changed after it was verified%'
                         from app.org_profiles where center_id = :c), 'a changed legal name after verification goes back to unverified');
rollback;

-- ── Leaders → roster ─────────────────────────────────────────────────────────
begin;
set local role authenticated;
set local request.jwt.claim.sub = '21000000-0000-4000-8000-00000000a001';
insert into app.org_leaders (id, center_id, person_id, full_name, title, sort) values
  ('21000000-0000-4000-8000-00000000c001', :c, '21000000-0000-4000-8000-00000000b001', 'Ona Owner', 'President', 1);
insert into app.org_leaders (id, center_id, full_name, title, body, sort) values
  ('21000000-0000-4000-8000-00000000c002', :c, 'Tej Trustee', 'Trustee', 'trustees', 2);
select pg_temp.assert_raises($$insert into app.org_leaders (center_id, person_id, full_name, title) values ('21000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Someone Else', 'Secretary')$$,
  'not in this community', 'a leader can only be linked to a person of the same community');
commit;
select pg_temp.assert((select count(*) from app.role_roster where center_id = :c and org_leader_id is not null) = 2
                      and (select display_name = 'Tej Trustee' and body = 'trustees' and person_id is null from app.role_roster where org_leader_id = '21000000-0000-4000-8000-00000000c002'),
  'leaders shown publicly are mirrored into the roster, with the name for unlinked leaders');
update app.org_leaders set show_publicly = false where id = '21000000-0000-4000-8000-00000000c002';
select pg_temp.assert(not exists (select 1 from app.role_roster where org_leader_id = '21000000-0000-4000-8000-00000000c002'),
  'hiding a leader takes them off the roster');
begin;
set local role anon;
select pg_temp.assert((select count(*) from app.org_leaders where center_id = :c) = 1, 'visitors see only the leaders shown publicly');
commit;

-- ── Brand kit ────────────────────────────────────────────────────────────────
begin;
set local role authenticated;
set local request.jwt.claim.sub = '21000000-0000-4000-8000-00000000a001';
select pg_temp.assert((select app.set_center_branding(:c, '{"logo_path":"21000000-0000-4000-8000-000000000001/logo.png","colors":{"primary":"#1B2C5C","accent":"#C9731C"}}')
                         #>> '{colors,primary}') = '#1B2C5C', 'the brand kit saves an uploaded logo path and colors');
select pg_temp.assert_raises($$select app.set_center_branding('21000000-0000-4000-8000-000000000001', '{"logo_path":"00000000-0000-4000-8000-000000000001/logo.png"}')$$,
  'file of this community', 'a logo path must be the community''s own file');
select pg_temp.assert_raises($$select app.set_center_branding('21000000-0000-4000-8000-000000000001', '{"colors":{"primary":"red"}}')$$,
  'like #1B2C5C', 'colors must be hex');
select pg_temp.assert_raises($$select app.set_center_branding('21000000-0000-4000-8000-000000000001', '{"secret":"x"}')$$,
  'no setting called', 'unknown brand keys are refused');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '21000000-0000-4000-8000-00000000a002';
select pg_temp.assert_raises($$select app.set_center_branding('21000000-0000-4000-8000-000000000001', '{"colors":{"primary":"#000000"}}')$$,
  'Only the owner', 'a member cannot change the brand kit');
commit;

-- ── Checklist ────────────────────────────────────────────────────────────────
begin;
set local role authenticated;
set local request.jwt.claim.sub = '21000000-0000-4000-8000-00000000a001';
select pg_temp.assert((select status = 'not_started' and computed_status = 'not_started' from app.setup_checklist(:c) where step_key = 'org.profile'),
  'the profile step starts not started');
update app.org_profiles set mission = 'Serve the sangh', public_email = 'office@setup.test', latitude = 29.76, longitude = -95.37 where center_id = :c;
select pg_temp.assert((select status from app.setup_checklist(:c) where step_key = 'org.profile') = 'done', 'saving the mission, contact and map pin marks the profile done');
select pg_temp.assert((select status from app.setup_checklist(:c) where step_key = 'org.brand_kit') = 'done', 'an uploaded logo and a color mark the brand kit done');
select pg_temp.assert((select status from app.setup_checklist(:c) where step_key = 'org.leaders') = 'done', 'adding a leader marks leaders done');
select pg_temp.assert((select status from app.setup_checklist(:c) where step_key = 'org.legal_identity') = 'done', 'verification marks the legal identity done');
insert into app.center_setup_steps (center_id, step_key, status, owner_person_id, due_on, notes)
values (:c, 'svc.email', 'waiting_on_provider', '21000000-0000-4000-8000-00000000b001', current_date + 7, 'DNS records sent to the web host');
select pg_temp.assert((select status = 'waiting_on_provider' and owner_name = 'Ona Owner' and notes like 'DNS%' from app.setup_checklist(:c) where step_key = 'svc.email'),
  'a step keeps its status, owner, due date and notes');
update app.center_setup_steps set status = 'done' where center_id = :c and step_key = 'svc.email';
select pg_temp.assert((select completed_by = '21000000-0000-4000-8000-00000000a001' and completed_at is not null from app.center_setup_steps
                         where center_id = :c and step_key = 'svc.email'), 'marking a step done records who and when');
select pg_temp.assert_raises($$insert into app.center_setup_steps (center_id, step_key, status) values ('21000000-0000-4000-8000-000000000001', 'org.legal_identity', 'done')$$,
  'worked out automatically', 'non-profit verification cannot be marked done by hand');
select pg_temp.assert_raises($$insert into app.center_setup_steps (center_id, step_key, owner_person_id) values ('21000000-0000-4000-8000-000000000001', 'org.team', '30000000-0000-4000-8000-000000000001')$$,
  'person in this community', 'a step owner must be in the community');
select pg_temp.assert((select count(*) from app.setup_staff_options(:c) where person_id = '21000000-0000-4000-8000-00000000b001') = 1
                      and (select count(*) from app.setup_staff_options(:c) where person_id = '21000000-0000-4000-8000-00000000b002') = 0,
  'only staff are offered as step owners');
commit;
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'center_setup_steps' and center_id = :c) >= 2
                      and (select record_id from app.audit_log where record_table = 'center_setup_steps' and center_id = :c order by id desc limit 1)
                          = '21000000-0000-4000-8000-000000000001:svc.email',
  'checklist changes are audited, keyed by center and step');

-- Module off → skipped.
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c, 'store', false, 'No store');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '21000000-0000-4000-8000-00000000a001';
select pg_temp.assert((select bool_and(status = 'skipped') from app.setup_checklist(:c) where module_key = 'store'), 'store steps are skipped while the Store is off');
select pg_temp.assert((select status from app.setup_checklist(:c) where step_key = 'org.modules') = 'done', 'choosing modules marks that step done');
commit;

-- ── Readiness ────────────────────────────────────────────────────────────────
begin;
set local role authenticated;
set local request.jwt.claim.sub = '21000000-0000-4000-8000-00000000a001';
select pg_temp.assert((select ok and detail like 'Verified non-profit%' from app.readiness(:c) where key = 'nonprofit_verified'), 'readiness: non-profit verified passes');
select pg_temp.assert((select not ok and detail like '%Membership types%' and detail not like '%Store%' from app.readiness(:c) where key = 'setup_data_complete'),
  'readiness: setup data lists what is missing, only for modules that are on');
select pg_temp.assert((select not ok and detail like 'Not published yet: terms of use, privacy policy, photo policy%' from app.readiness(:c) where key = 'member_legal_documents_published'),
  'readiness: missing legal documents are named');
commit;
insert into app.legal_documents (center_id, kind, version, title, body_md, published_at) values
  (:c, 'terms', '1', 'Terms', 'x', now()), (:c, 'privacy', '1', 'Privacy', 'x', now()), (:c, 'photo_release', '1', 'Photos', 'x', now()),
  (:c, 'volunteer_waiver', '1', 'Volunteers', 'x', now()), (:c, 'pathshala_waiver', '1', 'Youth', 'x', now());
begin;
set local role authenticated;
set local request.jwt.claim.sub = '21000000-0000-4000-8000-00000000a001';
select pg_temp.assert((select ok from app.readiness(:c) where key = 'member_legal_documents_published'), 'readiness: published documents pass');
select pg_temp.assert((select status from app.setup_checklist(:c) where step_key = 'tpl.legal') = 'done', 'the legal documents step follows the check');
commit;

-- A registered check that raises is reported, not fatal.
create function app.check_zz_broken(p_center uuid) returns jsonb language plpgsql as $$ begin raise exception 'boom'; end $$;
insert into app.readiness_checks (key, title, sort, check_fn) values ('zz_broken', 'Broken', 99, 'app.check_zz_broken'::regproc);
begin;
set local role authenticated;
set local request.jwt.claim.sub = '21000000-0000-4000-8000-00000000a001';
select pg_temp.assert((select not ok and detail like '%could not run: boom%' from app.readiness(:c) where key = 'zz_broken'), 'a failing check shows why and the others still run');
select pg_temp.assert((select count(*) from app.readiness(:c)) = (select count(*) from app.readiness_checks), 'every registered check is listed');
commit;
delete from app.readiness_checks where key = 'zz_broken';
drop function app.check_zz_broken(uuid);

begin;
set local role authenticated;
set local request.jwt.claim.sub = '21000000-0000-4000-8000-00000000a002';
select pg_temp.assert_raises($$select * from app.readiness('21000000-0000-4000-8000-000000000001')$$, 'don''t have access', 'a member cannot see readiness');
select pg_temp.assert_raises($$select app.check_nonprofit_verified('21000000-0000-4000-8000-000000000001')$$, 'permission denied', 'check functions are not callable directly');
commit;

-- Public profile.
begin;
set local role anon;
select pg_temp.assert((select verified_nonprofit and mission = 'Serve the sangh' from app.public_org_profile(:c)), 'the public profile shows the mission and the verified badge');
commit;
