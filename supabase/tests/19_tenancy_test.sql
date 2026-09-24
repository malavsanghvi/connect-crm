-- 0160–0162 (stream o-tenancy): sandbox / production environments,
-- entitlements (CCENT), join codes and community search, test recipients,
-- portal domains and the organization switcher.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
-- Runs a statement that must fail with SQLSTATE `state` (null = any) and a message containing `expect`.
create or replace function pg_temp.assert_raises(stmt text, expect text, label text, state text default null) returns void
language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if position(lower(expect) in lower(sqlerrm)) = 0 or (state is not null and sqlstate <> state) then
    raise exception 'FAIL: % (got % "%")', label, sqlstate, sqlerrm;
  end if;
  raise notice 'PASS: %', label;
end $$;

\set jsh '''00000000-0000-4000-8000-000000000001'''
\set prod2 '''19000000-0000-4000-8000-0000000000c2'''
\set sbx '''19000000-0000-4000-8000-0000000000c3'''
-- Users: …a1 platform admin, …a2 admin of BOTH jsh and prod2, …a3 admin of the sandbox only.
insert into auth.users (id, email) values
  ('19000000-0000-4000-8000-0000000000a1', 'cc.platform@example.com'),
  ('19000000-0000-4000-8000-0000000000a2', 'two.centers@example.com'),
  ('19000000-0000-4000-8000-0000000000a3', 'sandbox.owner@example.com');
insert into app.accounts (user_id, is_platform_admin) values ('19000000-0000-4000-8000-0000000000a1', true);
insert into app.centers (id, slug, name, short_name, state_region, status) values
  (:prod2, 'jcnj', 'Jain Center of New Jersey', 'JCNJ', 'NJ', 'active');
insert into app.centers (id, slug, name, short_name, state_region, status, environment) values
  (:sbx, 'jcnj-sandbox', 'Jain Center of New Jersey (sandbox)', 'JCNJ', 'NJ', 'active', 'sandbox');
insert into app.role_grants (center_id, user_id, role_key, scope_kind) values
  (:jsh,   '19000000-0000-4000-8000-0000000000a2', 'center_admin', 'center'),
  (:prod2, '19000000-0000-4000-8000-0000000000a2', 'center_admin', 'center'),
  (:sbx,   '19000000-0000-4000-8000-0000000000a3', 'center_admin', 'center');

-- ── Environment ──────────────────────────────────────────────────────────────
select pg_temp.assert((select environment from app.centers where id = :jsh) = 'production'
                      and (select environment from app.centers where id = :sbx) = 'sandbox',
  'existing centers are production; a sandbox is marked sandbox');
select pg_temp.assert_raises($$update app.centers set environment = 'moon' where id = '19000000-0000-4000-8000-0000000000c3'$$,
  'centers_environment_check', 'environment is production or sandbox');
select pg_temp.assert_raises($$update app.centers set sandbox_for = '19000000-0000-4000-8000-0000000000c3' where id = '19000000-0000-4000-8000-0000000000c2'$$,
  'centers_sandbox_for_check', 'only a sandbox can point at the production center it was promoted to');

begin;
set local role authenticated;
set local request.jwt.claim.sub = '19000000-0000-4000-8000-0000000000a3';
select pg_temp.assert_raises($$update app.centers set environment = 'production' where id = '19000000-0000-4000-8000-0000000000c3'$$,
  'Only the Community Connect team', 'a sandbox''s own admin cannot turn it into production');
update app.centers set short_name = 'JCNJ-S' where id = :sbx;
select pg_temp.assert((select short_name from app.centers where id = :sbx) = 'JCNJ-S', 'the sandbox admin still edits other center details');
set local request.jwt.claim.sub = '19000000-0000-4000-8000-0000000000a1';
update app.centers set sandbox_for = :prod2 where id = :sbx;
select pg_temp.assert((select sandbox_for from app.centers where id = :sbx) = :prod2, 'a platform admin records the promotion target');
rollback;

-- ── Defaults and overrides ───────────────────────────────────────────────────
select pg_temp.assert((select count(*) from app.entitlement_defaults where environment = 'sandbox') = 9
                      and (select count(*) from app.entitlement_defaults where environment = 'production') = 9,
  'the nine contract keys have a sandbox and a production default');
select pg_temp.assert(app.entitlement(:sbx, 'max_people') = '2000' and app.entitlement(:sbx, 'max_households') = '800'
                      and app.entitlement(:sbx, 'messaging.recipients') = '"test_only"' and app.entitlement(:sbx, 'payments.mode') = '"test"'
                      and app.entitlement(:sbx, 'qbo.mode') = '"sandbox_or_read_only"' and app.entitlement(:sbx, 'public_dashboard') = 'false'
                      and app.entitlement(:sbx, 'niva.monthly_questions') = '300' and app.entitlement(:sbx, 'storage.bytes') = '2147483648'
                      and app.entitlement(:sbx, 'expiry_days_inactive') = '90',
  'a sandbox gets the contract''s sandbox defaults');
select pg_temp.assert(app.entitlement(:jsh, 'max_people') = 'null' and app.entitlement(:jsh, 'messaging.recipients') = '"all"'
                      and app.entitlement(:jsh, 'public_dashboard') = 'true',
  'production has no people limit, sends to everyone and has a public dashboard');

begin;
set local role authenticated;
set local request.jwt.claim.sub = '19000000-0000-4000-8000-0000000000a3';
select pg_temp.assert_raises($$select app.set_center_entitlement('19000000-0000-4000-8000-0000000000c3', 'max_people', '5000', 'more please')$$,
  'Only the Community Connect team', 'a center admin cannot raise their own limit');
select pg_temp.assert_raises($$insert into app.center_entitlements (center_id, key, value, reason) values ('19000000-0000-4000-8000-0000000000c3', 'max_people', '5000', 'x')$$,
  'row-level security', 'nor write the override table directly');
select pg_temp.assert((select count(*) from app.center_entitlement_list(:sbx)) = 9, 'the sandbox admin reads the sandbox''s limits');
select pg_temp.assert((select count(*) from app.center_entitlement_list(:jsh)) = 0, 'but not another center''s');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '19000000-0000-4000-8000-0000000000a1';
select pg_temp.assert_raises($$select app.set_center_entitlement('19000000-0000-4000-8000-0000000000c3', 'max_people', '5', '  ')$$,
  'Give a reason', 'an override needs a reason');
select pg_temp.assert_raises($$select app.set_center_entitlement('19000000-0000-4000-8000-0000000000c3', 'max_people', '"lots"', 'pilot')$$,
  'a number', 'an override must be the same kind as the default');
select pg_temp.assert_raises($$select app.set_center_entitlement('19000000-0000-4000-8000-0000000000c3', 'max_people', '-1', 'pilot')$$,
  'negative', 'a limit cannot be negative');
select pg_temp.assert_raises($$select app.set_center_entitlement('19000000-0000-4000-8000-0000000000c3', 'max_bananas', '1', 'pilot')$$,
  'no entitlement called', 'unknown keys are refused');
select app.set_center_entitlement(:sbx, 'max_people', '3', 'Test the cap');
select app.set_center_entitlement(:sbx, 'max_households', '2', 'Test the cap');
select app.set_center_entitlement(:jsh, 'max_households', 'null', 'Plan: unlimited');
commit;
select pg_temp.assert(app.entitlement(:sbx, 'max_people') = '3', 'an override wins over the environment default');
select pg_temp.assert((select set_by = '19000000-0000-4000-8000-0000000000a1' and reason = 'Test the cap'
                         from app.center_entitlements where center_id = :sbx and key = 'max_people'),
  'the override records who set it and why');
select pg_temp.assert((select reason = 'Test the cap' and actor_user_id = '19000000-0000-4000-8000-0000000000a1' and after->>'value' = '3'
                         from app.audit_log where action = 'center_entitlements.insert'
                          and record_id = '19000000-0000-4000-8000-0000000000c3:max_people' order by id desc limit 1),
  'the override is audited with the reason');

-- ── assert_entitlement ───────────────────────────────────────────────────────
select pg_temp.assert_raises($$select app.assert_entitlement('19000000-0000-4000-8000-0000000000c3', 'messaging.recipients', '"all"')$$,
  'Sandboxes can send only to verified test recipients.', 'text entitlements refuse a different mode with CCENT', 'CCENT');
select pg_temp.assert_raises($$select app.assert_entitlement('19000000-0000-4000-8000-0000000000c3', 'public_dashboard')$$,
  'Sandboxes have no public community dashboard', 'a false boolean refuses with CCENT', 'CCENT');
select pg_temp.assert_raises($$select app.assert_entitlement('19000000-0000-4000-8000-0000000000c3', 'max_people', '4')$$,
  'can hold up to 3 people', 'a number refuses more than the limit with CCENT', 'CCENT');
select app.assert_entitlement(:sbx, 'max_people', '3');
select app.assert_entitlement(:jsh, 'messaging.recipients', '"all"');
select app.assert_entitlement(:jsh, 'max_people', '1000000');
select pg_temp.assert(true, 'at the limit, in the right mode, or with no limit, nothing is raised');
select pg_temp.assert(app.entitlement_message('sandbox', 'storage.bytes', '2147483648', null) like '%2.0 GB%'
                      and app.entitlement_message('production', 'max_people', '12000', null) like 'This community''s plan can hold up to 12,000 people%',
  'messages are plain English with readable numbers');

-- ── People and households caps ───────────────────────────────────────────────
insert into app.households (center_id, display_name) values (:sbx, 'Test family A'), (:sbx, 'Test family B');
select pg_temp.assert_raises($$insert into app.households (center_id, display_name) values ('19000000-0000-4000-8000-0000000000c3', 'Test family C')$$,
  'can hold up to 2 households', 'the households cap refuses the 3rd household with CCENT', 'CCENT');
insert into app.people (center_id, first_name, last_name) values (:sbx, 'Asha', 'Test'), (:sbx, 'Bina', 'Test');
select pg_temp.assert_raises($$insert into app.people (center_id, first_name, last_name) values
    ('19000000-0000-4000-8000-0000000000c3', 'Chirag', 'Test'), ('19000000-0000-4000-8000-0000000000c3', 'Dev', 'Test')$$,
  'can hold up to 3 people', 'a bulk insert that crosses the people cap is refused as a whole', 'CCENT');
select pg_temp.assert((select count(*) from app.people where center_id = :sbx) = 2, 'nothing from the refused insert was saved');
insert into app.people (center_id, first_name, last_name) values (:sbx, 'Chirag', 'Test');
select pg_temp.assert((select count(*) from app.people where center_id = :sbx) = 3, 'up to the limit is fine');
insert into app.households (center_id, display_name) select :jsh, 'Bulk ' || g from generate_series(1, 5) g;
select pg_temp.assert(true, 'production (no limit) is never capped');
delete from app.households where center_id = :jsh and display_name like 'Bulk %';

-- ── Public dashboard ─────────────────────────────────────────────────────────
select pg_temp.assert(app.public_kpis('jsh') is not null, 'a production community''s public dashboard still answers');
select pg_temp.assert(app.public_kpis('no-such-center') is null, 'an unknown slug still returns nothing');
select pg_temp.assert_raises($$select app.public_kpis('jcnj-sandbox')$$, 'Sandboxes have no public community dashboard',
  'a sandbox''s public dashboard is refused with CCENT', 'CCENT');
begin;
set local role anon;
select pg_temp.assert_raises($$select app.public_kpis_unchecked('jcnj-sandbox', current_date, current_date, null)$$,
  'permission denied', 'the unchecked body cannot be called directly');
rollback;

-- ── Join codes and finding a community ──────────────────────────────────────
select pg_temp.assert((select count(*) from app.member_join_codes where center_id in (:jsh, :prod2, :sbx) and active) = 3,
  'every community (existing and new) has one active join code');
select pg_temp.assert((select bool_and(code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$') from app.member_join_codes),
  'codes are 8 characters with no look-alikes');
select pg_temp.assert(app.normalize_join_code('communityconnect://join/7k4m-q2pd') = '7K4MQ2PD'
                      and app.normalize_join_code('https://app.example.org/join/7K4M-Q2PD') = '7K4MQ2PD'
                      and app.normalize_join_code(' 7k4m q2pd ') = '7K4MQ2PD',
  'codes are read from typed text, the app link and the web link');
begin;
set local role anon;
select pg_temp.assert((select count(*) from app.find_community('jersey')) = 1
                      and (select slug from app.find_community('jersey')) = 'jcnj',
  'search finds the production community by name, never its sandbox');
select pg_temp.assert((select count(*) from app.find_community('NJ')) = 1, 'search matches the state too');
select pg_temp.assert((select count(*) from app.find_community('sandbox')) = 0, 'a sandbox is not searchable, even by its own name');
select pg_temp.assert((select count(*) from app.find_community('j')) = 0, 'one letter is not a search');
select pg_temp.assert((select count(*) from app.find_community('%')) = 0, 'LIKE wildcards are matched literally');
select pg_temp.assert_raises($$select * from app.member_join_codes$$, 'permission denied', 'guests cannot list join codes');
rollback;
select pg_temp.assert((select slug || '|' || environment from app.community_by_join_code(
                         'communityconnect://join/' || (select code from app.member_join_codes where center_id = :sbx and active)))
                      = 'jcnj-sandbox|sandbox',
  'the sandbox is found by its join code (QR link form)');

begin;
set local role authenticated;
set local request.jwt.claim.sub = '19000000-0000-4000-8000-0000000000a3';
select pg_temp.assert_raises($$select app.rotate_member_join_code('00000000-0000-4000-8000-000000000001')$$,
  'settings.manage', 'a sandbox admin cannot rotate another community''s code');
create temp table old_code as select code from app.member_join_codes where center_id = :sbx and active;
select pg_temp.assert(app.rotate_member_join_code(:sbx, null, 'Poster reprinted') ~ '^[A-Z2-9]{8}$', 'the admin rotates the code');
commit;
select pg_temp.assert((select count(*) from app.community_by_join_code((select code from old_code))) = 0
                      and (select count(*) from app.member_join_codes where center_id = :sbx and active) = 1,
  'the old code stops working; one active code remains');
select pg_temp.assert((select reason = 'Poster reprinted' from app.audit_log where action = 'member_join_codes.insert'
                         and center_id = :sbx order by id desc limit 1), 'the rotation is audited with its reason');
update app.member_join_codes set expires_at = now() - interval '1 minute' where center_id = :prod2;
select pg_temp.assert((select count(*) from app.community_by_join_code((select code from app.member_join_codes where center_id = :prod2))) = 0,
  'an expired code finds nothing');

-- ── Test recipients ──────────────────────────────────────────────────────────
begin;
set local role authenticated;
set local request.jwt.claim.sub = '19000000-0000-4000-8000-0000000000a3';
insert into app.sandbox_test_recipients (center_id, channel, address, verified_at) values
  (:sbx, 'email', ' Tester@Example.COM ', now()),
  (:sbx, 'sms', '(713) 555-0100', null);
select pg_temp.assert((select array_agg(address order by channel) from app.sandbox_test_recipients where center_id = :sbx)
                        = array['tester@example.com', '+17135550100'],
  'addresses are normalized (email lower-case, phone E.164)');
select pg_temp.assert((select bool_and(verified_at is null) from app.sandbox_test_recipients where center_id = :sbx),
  'staff cannot mark a test recipient verified themselves');
insert into app.sandbox_test_recipients (center_id, channel, address) select :sbx, 'email', 'test' || g || '@example.com' from generate_series(1, 8) g;
select pg_temp.assert_raises($$insert into app.sandbox_test_recipients (center_id, channel, address) values ('19000000-0000-4000-8000-0000000000c3', 'email', 'eleven@example.com')$$,
  'up to 10 test recipients', 'the 11th test recipient is refused with CCENT', 'CCENT');
select pg_temp.assert_raises($$insert into app.sandbox_test_recipients (center_id, channel, address) values ('00000000-0000-4000-8000-000000000001', 'email', 'x@example.com')$$,
  'row-level security', 'a sandbox admin cannot add recipients to another community');
commit;
select pg_temp.assert(not app.recipient_allowed(:sbx, 'email', 'TESTER@example.com'), 'an unverified test recipient is not allowed yet');
update app.sandbox_test_recipients set verified_at = now() where center_id = :sbx and address = 'tester@example.com';
select pg_temp.assert(app.recipient_allowed(:sbx, 'email', 'TESTER@example.com'), 'once verified (by the sender service), it is allowed');
select pg_temp.assert(not app.recipient_allowed(:sbx, 'email', 'member@example.com'), 'a sandbox cannot message anyone else');
select pg_temp.assert(app.recipient_allowed(:jsh, 'email', 'member@example.com'), 'production messages everyone');
begin;
set local role authenticated;
select pg_temp.assert_raises($$select app.recipient_allowed('19000000-0000-4000-8000-0000000000c3', 'email', 'x@example.com')$$,
  'permission denied', 'recipient_allowed is for the sender service only');
rollback;

-- ── Portal domains ───────────────────────────────────────────────────────────
begin;
set local role authenticated;
set local request.jwt.claim.sub = '19000000-0000-4000-8000-0000000000a2';
select pg_temp.assert_raises($$insert into app.center_domains (domain, center_id) values ('portal.jcnj.org', '19000000-0000-4000-8000-0000000000c2')$$,
  'row-level security', 'a center admin cannot claim a web address');
set local request.jwt.claim.sub = '19000000-0000-4000-8000-0000000000a1';
insert into app.center_domains (domain, center_id) values ('Portal.JCNJ.org', :prod2);
commit;
begin;
set local role anon;
select pg_temp.assert(app.center_slug_for_domain('portal.jcnj.org') = 'jcnj' and app.center_slug_for_domain('evil.example.org') is null,
  'the portal resolves an organization''s own domain (case-insensitive) and nothing else');
rollback;

-- ── Organization switcher ────────────────────────────────────────────────────
begin;
set local role authenticated;
set local request.jwt.claim.sub = '19000000-0000-4000-8000-0000000000a2';
select pg_temp.assert((select array_agg(slug order by slug) from app.my_centers()) = array['jcnj', 'jsh']
                      and (select portal_domain from app.my_centers() where slug = 'jcnj') = 'portal.jcnj.org',
  'a user with roles in two centers sees both in the switcher (with the custom domain)');
set local request.jwt.claim.sub = '19000000-0000-4000-8000-0000000000a3';
select pg_temp.assert((select array_agg(slug || ':' || environment) from app.my_centers()) = array['jcnj-sandbox:sandbox'],
  'a sandbox-only admin sees only the sandbox');
set local request.jwt.claim.sub = '19000000-0000-4000-8000-0000000000a1';
select pg_temp.assert((select count(*) from app.my_centers() where slug in ('jsh', 'jcnj', 'jcnj-sandbox')) = 3
                      and (select environment from app.my_centers() order by 1 desc limit 1) is not null,
  'a platform admin can switch to any center');
rollback;
begin;
set local role anon;
select pg_temp.assert_raises($$select * from app.my_centers()$$, 'permission denied', 'signed out, there is no switcher');
rollback;

-- ── Data isolation across the new tables ────────────────────────────────────
begin;
set local role authenticated;
set local request.jwt.claim.sub = '19000000-0000-4000-8000-0000000000a3';
select pg_temp.assert((select count(*) from app.member_join_codes where center_id <> '19000000-0000-4000-8000-0000000000c3') = 0
                      and (select count(*) from app.center_entitlements where center_id <> '19000000-0000-4000-8000-0000000000c3') = 0
                      and (select count(*) from app.people where center_id = '00000000-0000-4000-8000-000000000001') = 0,
  'a sandbox admin sees none of another community''s codes, limits or people');
rollback;

-- Clean up so later test files see the database as before (the audit log keeps
-- the two test centers, so they are retired rather than deleted).
delete from app.center_domains where center_id = :prod2;
delete from app.role_grants where user_id in ('19000000-0000-4000-8000-0000000000a2', '19000000-0000-4000-8000-0000000000a3');
delete from app.center_entitlements where center_id = :jsh;
update app.centers set status = 'exited' where id in (:sbx, :prod2);
update app.member_join_codes set active = false where center_id in (:sbx, :prod2);
