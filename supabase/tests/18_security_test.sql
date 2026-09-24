-- 0150–0155 (stream o-security): 2FA and step-up checked by the database,
-- owner designation, staff invitations, organization agreements, readiness checks.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
-- A statement that must fail with a message containing `expect`.
create or replace function pg_temp.assert_raises(stmt text, expect text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if position(lower(expect) in lower(sqlerrm)) = 0 then raise exception 'FAIL: % (got "%")', label, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
-- A statement that must be refused with SQLSTATE CCSTP "This needs a fresh 2FA check."
create or replace function pg_temp.assert_step_up_needed(stmt text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no step-up was asked for)', label;
exception
  when sqlstate 'CCSTP' then
    if sqlerrm <> 'This needs a fresh 2FA check.' then raise exception 'FAIL: % (message "%")', label, sqlerrm; end if;
    raise notice 'PASS: %', label;
  when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise exception 'FAIL: % (got % "%")', label, sqlstate, sqlerrm;
end $$;
-- Sign in as a user for the rest of the transaction. p_totp_age: seconds since the
-- last authenticator check (null = no 2FA in this session, aal1).
create or replace function pg_temp.sign_in(p_user uuid, p_totp_age int default null, p_headers jsonb default null) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated',
    'aal', case when p_totp_age is null then 'aal1' else 'aal2' end,
    'amr', case when p_totp_age is null
                then jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', floor(extract(epoch from now())) - 3600))
                else jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', floor(extract(epoch from now())) - p_totp_age),
                                       jsonb_build_object('method', 'otp', 'timestamp', floor(extract(epoch from now())) - 3600)) end)::text, true);
  perform set_config('request.headers', coalesce(p_headers, '{}'::jsonb)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
\set jsh '''00000000-0000-4000-8000-000000000001'''
-- Users from earlier tests: 11 Ada (center admin, JSH's first admin), a9…01 a second
-- center admin, 03 Tara (treasurer), 01 Priya (member), a9…02 platform admin.
\set ada '''10000000-0000-4000-8000-000000000011'''
\set admin2 '''a9000000-0000-4000-8000-000000000001'''
\set tara '''10000000-0000-4000-8000-000000000003'''
\set priya '''10000000-0000-4000-8000-000000000001'''
\set platform '''a9000000-0000-4000-8000-000000000002'''

-- Ada, the second admin and Tara have authenticator apps; Priya has none.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status) values
  ('f1800000-0000-4000-8000-000000000011', :ada, 'Ada phone', 'totp', 'verified'),
  ('f1800000-0000-4000-8000-0000000000a1', :admin2, 'Admin phone', 'totp', 'verified'),
  ('f1800000-0000-4000-8000-000000000003', :tara, 'Tara phone', 'totp', 'verified'),
  ('f1800000-0000-4000-8000-000000000033', :tara, 'Tara old phone', 'totp', 'unverified');

-- ── Session checks ───────────────────────────────────────────────────────────
begin;
select pg_temp.sign_in(:ada, 60);
select pg_temp.assert(app.is_aal2() and app.has_recent_step_up(), 'a session that passed a totp check a minute ago is aal2 and fresh');
select pg_temp.assert(not app.has_recent_step_up(0), 'a 0-minute window is never fresh for a check a minute ago');
rollback;
begin;
select pg_temp.sign_in(:ada, 600);
select pg_temp.assert(app.is_aal2() and not app.has_recent_step_up(5) and app.has_recent_step_up(15),
  'a totp check 10 minutes ago is aal2 but not a fresh step-up (5 minutes); it is within 15');
rollback;
begin;
select pg_temp.sign_in(:ada);
select pg_temp.assert(not app.is_aal2() and not app.has_recent_step_up(), 'an email-code session is aal1 with no step-up');
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000011","role":"authenticated","aal":"aal2","amr":"garbage"}', true);
select pg_temp.assert(not app.has_recent_step_up(), 'a malformed amr claim is never a step-up');
rollback;

-- ── assert_step_up ──────────────────────────────────────────────────────────
select pg_temp.assert(app.require_2fa_for_staff(:jsh) = false, 'JSH records require_2fa_for_staff = false (its staff have not enrolled yet)');
insert into app.centers (id, slug, name) values ('00000000-0000-4000-8000-000000000018', 'newcenter18', 'New Center 18');
select pg_temp.assert(app.require_2fa_for_staff('00000000-0000-4000-8000-000000000018'), 'a new community requires 2FA for staff by default');
select app.assert_step_up('anything');
select pg_temp.assert(true, 'no signed-in user (service role, workers): assert_step_up passes');
begin;
select pg_temp.sign_in(:ada);
select pg_temp.assert_step_up_needed($$select app.assert_step_up('roles.grant')$$, 'a user with an authenticator app must pass a fresh check');
rollback;
begin;
select pg_temp.sign_in(:ada, 30);
select app.assert_step_up('roles.grant');
select pg_temp.assert(true, 'a totp check 30 seconds ago satisfies assert_step_up');
rollback;
begin;
select pg_temp.sign_in(:ada, 400);
select pg_temp.assert_step_up_needed($$select app.assert_step_up('roles.grant')$$, 'a totp check older than 5 minutes does not');
rollback;
-- Staff without an app: passes where the community has not switched the rule on, asked where it has.
insert into auth.users (id, email) values ('18000000-0000-4000-8000-000000000001', 'staff18@example.com');
insert into app.role_grants (center_id, user_id, role_key) values (:jsh, '18000000-0000-4000-8000-000000000001', 'content_editor');
begin;
select pg_temp.sign_in('18000000-0000-4000-8000-000000000001');
select app.assert_step_up('export.people');
select pg_temp.assert(true, 'staff without 2FA in a community that has not required it yet are not blocked');
rollback;
insert into app.role_grants (center_id, user_id, role_key) values ('00000000-0000-4000-8000-000000000018', '18000000-0000-4000-8000-000000000001', 'content_editor');
begin;
select pg_temp.sign_in('18000000-0000-4000-8000-000000000001');
do $$ declare v_hint text; begin
  perform app.assert_step_up('export.people');
  raise exception 'FAIL: staff of a 2FA-required community passed without 2FA';
exception when sqlstate 'CCSTP' then
  get stacked diagnostics v_hint = pg_exception_hint;
  if v_hint not like '%Account › Security%' then raise exception 'FAIL: the hint does not send them to set up 2FA (got "%")', v_hint; end if;
  raise notice 'PASS: staff of a community that requires 2FA, without an app, are asked (and told to set one up)';
end $$;
rollback;
begin;
select pg_temp.sign_in(:priya);
select app.assert_step_up('anything');
select pg_temp.assert(true, 'a member with no staff role and no app is not asked');
select pg_temp.assert((app.my_security_status(:jsh)->>'is_staff')::boolean = false and (app.my_security_status(:jsh)->>'has_totp')::boolean = false,
  'my_security_status: Priya is not staff and has no authenticator app');
rollback;
begin;
select pg_temp.sign_in(:tara, 10);
select pg_temp.assert((select (s->>'has_totp')::boolean and (s->>'totp_factors')::int = 1 and s->>'aal' = 'aal2' and (s->>'step_up_fresh')::boolean
                               and (s->>'is_staff')::boolean and not (s->>'required')::boolean
                          from app.my_security_status(:jsh) s),
  'my_security_status: Tara has one verified app (the unverified one does not count), a fresh aal2 session, staff, not required in JSH');
rollback;

-- ── Step-up wired into the sensitive actions ─────────────────────────────────
begin;
select pg_temp.sign_in(:ada);
select pg_temp.assert_step_up_needed($$select app.set_module_enabled('00000000-0000-4000-8000-000000000001', 'store', false, 'test')$$,
  'switching a module needs a fresh check (set_module_enabled)');
select pg_temp.assert_step_up_needed($$insert into app.role_grants (center_id, user_id, role_key) values ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'content_editor')$$,
  'granting a role needs a fresh check');
select pg_temp.assert_step_up_needed($$update app.people set merged_into_id = '30000000-0000-4000-8000-000000000001' where id = '30000000-0000-4000-8000-000000000002'$$,
  'merging a person needs a fresh check');
select pg_temp.assert_step_up_needed($$update app.households set merged_into_id = '20000000-0000-4000-8000-000000000001' where id = '20000000-0000-4000-8000-000000000003'$$,
  'merging a household needs a fresh check');
select pg_temp.assert_step_up_needed($$select app.record_export('00000000-0000-4000-8000-000000000001', 'people', '{"rows": 3}')$$,
  'an export needs a fresh check');
rollback;
begin;
select pg_temp.sign_in(:admin2);
select pg_temp.assert_step_up_needed($$select app.approve_role_grant((select id from app.role_grants where status = 'pending' and center_id = '00000000-0000-4000-8000-000000000001'
                                         and granted_by is distinct from 'a9000000-0000-4000-8000-000000000001' limit 1))$$,
  'approving a pending role grant needs a fresh check');
rollback;
begin;
select pg_temp.sign_in(:ada, 20, '{"x-client-app":"portal","x-client-screen":"/settings/modules"}');
select app.set_module_enabled(:jsh, 'store', false, 'o-security test');
select pg_temp.assert(not app.module_enabled(:jsh, 'store'), 'with a fresh check the module switch goes through');
select app.set_module_enabled(:jsh, 'store', true, 'o-security test: back on');
select app.record_export(:jsh, 'people', '{"rows": 3}');
select pg_temp.assert(exists (select 1 from app.audit_log where action = 'export.people' and actor_user_id = '10000000-0000-4000-8000-000000000011'
                                and after->>'rows' = '3' and client_screen = '/settings/modules'),
  'a checked export is written to the audit log as export.people with its detail');
commit;
begin;
select pg_temp.sign_in(:tara);
select pg_temp.assert_step_up_needed($$update app.pledges set written_off_by = '10000000-0000-4000-8000-000000000003' where id = '60000000-0000-4000-8000-000000000042'$$,
  'requesting a write-off needs a fresh check');
select pg_temp.assert_step_up_needed($$update app.payments set refund_approved_by = '10000000-0000-4000-8000-000000000003'
                                        where id = (select id from app.payments where center_id = '00000000-0000-4000-8000-000000000001' and refund_approved_by is null order by created_at limit 1)$$,
  'requesting a refund needs a fresh check');
select pg_temp.assert_step_up_needed($$insert into app.accounting_periods (center_id, period_month, status) values ('00000000-0000-4000-8000-000000000001', '2019-01-01', 'closed')$$,
  'locking a month needs a fresh check');
rollback;
begin;
select pg_temp.sign_in(:tara, 5);
insert into app.accounting_periods (center_id, period_month, status) values (:jsh, '2019-01-01', 'closed');
select pg_temp.assert((select status = 'closed' from app.accounting_periods where center_id = :jsh and period_month = '2019-01-01'),
  'with a fresh check the month lock goes through');
update app.pledges set written_off_by = :tara where id = '60000000-0000-4000-8000-000000000042';
select pg_temp.assert((select written_off_by = :tara from app.pledges where id = '60000000-0000-4000-8000-000000000042'),
  'with a fresh check the write-off request goes through (the two-person rule still applies to completing it)');
rollback;
begin;
-- A withdrawal loosens nothing: no check.
select pg_temp.sign_in(:tara);
update app.pledges set written_off_by = null where id = '60000000-0000-4000-8000-000000000042';
select pg_temp.assert(true, 'withdrawing a write-off request needs no check');
rollback;
begin;
select pg_temp.sign_in(:ada);
update app.centers set rules = jsonb_set(rules, '{security,require_2fa_for_staff}', 'true') where id = :jsh;
select pg_temp.assert(app.require_2fa_for_staff(:jsh), 'switching the staff 2FA rule ON needs no check');
select pg_temp.assert_step_up_needed($$update app.centers set rules = jsonb_set(rules, '{security,require_2fa_for_staff}', 'false') where id = '00000000-0000-4000-8000-000000000001'$$,
  'switching the staff 2FA rule OFF needs a fresh check');
rollback;

-- ── Owner ───────────────────────────────────────────────────────────────────
select pg_temp.assert((select user_id from app.center_owners where center_id = :jsh) = :ada::uuid,
  'JSH''s owner is its first administrator (the earliest active center_admin grant)');
select pg_temp.assert(not exists (select 1 from app.center_owners where center_id = '00000000-0000-4000-8000-000000000018'),
  'a community with no administrator has no owner yet');
select pg_temp.assert((app.check_owner_admins_2fa('00000000-0000-4000-8000-000000000018')->>'ok')::boolean = false,
  'the owner readiness check fails without an owner');
insert into auth.users (id, email) values ('18000000-0000-4000-8000-000000000002', 'owner18@example.com');
insert into app.role_grants (center_id, user_id, role_key) values ('00000000-0000-4000-8000-000000000018', '18000000-0000-4000-8000-000000000002', 'center_admin');
select pg_temp.assert((select user_id from app.center_owners where center_id = '00000000-0000-4000-8000-000000000018') = '18000000-0000-4000-8000-000000000002',
  'a new community''s first active center_admin becomes its owner');
begin;
select pg_temp.sign_in(:ada);
select pg_temp.assert(app.is_center_owner(:jsh), 'is_center_owner: Ada owns JSH');
select pg_temp.assert_step_up_needed($$select app.transfer_ownership('00000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001', 'handing over')$$,
  'transferring ownership needs a fresh check');
rollback;
begin;
select pg_temp.sign_in(:admin2, 5);
select pg_temp.assert_raises($$select app.transfer_ownership('00000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001', 'mine now')$$,
  'Only the owner', 'someone who is not the owner cannot transfer ownership');
rollback;
begin;
select pg_temp.sign_in(:ada, 5);
select pg_temp.assert_raises($$select app.transfer_ownership('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'to the treasurer')$$,
  'must be an active administrator', 'ownership only goes to an active center_admin');
select pg_temp.assert_raises($$select app.transfer_ownership('00000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001', '  ')$$,
  'reason', 'a transfer needs a reason');
select app.transfer_ownership(:jsh, :admin2, 'Ada is stepping down as president');
select pg_temp.assert((select user_id = :admin2::uuid and transferred_from = :ada::uuid from app.center_owners where center_id = :jsh),
  'the owner transfers ownership to another administrator');
select pg_temp.assert(exists (select 1 from app.audit_log where action = 'center_owners.update' and record_id = '00000000-0000-4000-8000-000000000001'
                                and reason = 'Ada is stepping down as president' and actor_user_id = :ada::uuid),
  'the transfer is audited with its reason');
rollback;

-- ── Readiness: owner and second admin with 2FA ──────────────────────────────
select pg_temp.assert((app.check_owner_admins_2fa(:jsh)->>'ok')::boolean,
  'owner_admins_2fa passes for JSH: Ada (owner) and a second admin both have authenticator apps');
delete from auth.mfa_factors where id = 'f1800000-0000-4000-8000-0000000000a1';
select pg_temp.assert((select (r->>'ok')::boolean = false and r->>'detail' like '%second administrator has not set up 2FA%' from app.check_owner_admins_2fa(:jsh) r),
  'owner_admins_2fa fails, in plain English, when the second admin has no app');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status) values
  ('f1800000-0000-4000-8000-0000000000a1', :admin2, 'Admin phone', 'totp', 'verified');
select pg_temp.assert(exists (select 1 from app.readiness_checks where key = 'owner_admins_2fa' and check_fn = 'app.check_owner_admins_2fa'::regproc)
                  and exists (select 1 from app.readiness_checks where key = 'agreements_accepted' and check_fn = 'app.check_agreements_accepted'::regproc),
  'both o-security readiness checks are registered in app.readiness_checks');

-- ── Lost phone: reset by the second admin ───────────────────────────────────
begin;
select pg_temp.sign_in(:tara, 5);
select pg_temp.assert_raises($$select app.reset_staff_2fa('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000011', 'lost phone')$$,
  'Only another administrator', 'a treasurer cannot reset an admin''s 2FA');
rollback;
begin;
select pg_temp.sign_in(:ada, 5);
select pg_temp.assert_raises($$select app.reset_staff_2fa('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000011', 'lost phone')$$,
  'cannot reset your own', 'nobody resets their own 2FA');
rollback;
begin;
select pg_temp.sign_in(:admin2);
select pg_temp.assert_step_up_needed($$select app.reset_staff_2fa('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'lost phone')$$,
  'the resetting admin needs a fresh check');
rollback;
begin;
insert into auth.sessions (id, user_id, aal) values ('51800000-0000-4000-8000-000000000003', :tara, 'aal2');
select pg_temp.sign_in(:admin2, 5);
select pg_temp.assert(app.reset_staff_2fa(:jsh, :tara, 'Lost phone; identity checked in person') = 2,
  'the second admin resets Tara''s 2FA (both of her factors are removed)');
reset role;
select pg_temp.assert(not exists (select 1 from auth.mfa_factors where user_id = :tara) and not exists (select 1 from auth.sessions where user_id = :tara),
  'Tara has no authenticator apps and no sessions left');
select pg_temp.assert(exists (select 1 from app.audit_log where action = 'security.reset_2fa' and record_id = '10000000-0000-4000-8000-000000000003'
                                and actor_user_id = :admin2::uuid and reason = 'Lost phone; identity checked in person' and before->>'factors' = '2'),
  'the reset is audited with the reason and the factor count');
rollback;

-- ── Staff invitations ────────────────────────────────────────────────────────
begin;
select pg_temp.sign_in(:tara, 5);
select pg_temp.assert_raises($$select * from app.invite_staff('00000000-0000-4000-8000-000000000001', 'new.staff@example.com', null, null, array['content_editor'])$$,
  'roles.manage', 'inviting staff needs roles.manage');
rollback;
begin;
select pg_temp.sign_in(:ada);
select pg_temp.assert_step_up_needed($$select * from app.invite_staff('00000000-0000-4000-8000-000000000001', 'new.staff@example.com', null, null, array['content_editor'])$$,
  'inviting staff needs a fresh check');
rollback;
begin;
select pg_temp.sign_in(:ada, 5);
select pg_temp.assert_raises($$select * from app.invite_staff('00000000-0000-4000-8000-000000000001', 'x@example.com', null, null, array['platform_owner'])$$,
  'cannot be given by invitation', 'platform roles cannot be given by invitation');
select pg_temp.assert_raises($$select * from app.invite_staff('00000000-0000-4000-8000-000000000001', null, '713-555', null, array['content_editor'])$$,
  'country code', 'a malformed mobile number is refused in plain English');
create temp table inv18 on commit drop as
  select * from app.invite_staff(:jsh, 'New.Staff@Example.com', null, null, array['content_editor', 'treasurer'], '{"kind":"center"}', 'Nisha', 'Patel');
select pg_temp.assert((select length(token) >= 30 and expires_at > now() + interval '6 days' from inv18), 'invite_staff returns a long link token valid for 7 days');
select pg_temp.assert_raises($$select * from app.invite_staff('00000000-0000-4000-8000-000000000001', 'new.staff@example.com', null, null, array['content_editor'])$$,
  'already has an open invitation', 'a second open invitation for the same person is refused');
select pg_temp.assert((select p.status = 'pending' and p.contact = 'n•••@example.com' and p.center_name = 'Jain Society of Houston'
                         from inv18 t, app.invitation_preview(t.token) p), 'invitation_preview shows the status and a masked email');
select set_config('test.token18', (select token from inv18), false);
commit;
select pg_temp.assert((select i.token_hash = app.invitation_token_hash(current_setting('test.token18')) and i.invited_by = :ada::uuid
                         from app.staff_invitations i where i.email = 'new.staff@example.com'),
  'only the token''s hash is stored; the email is kept in lower case');
insert into auth.users (id, email) values ('18000000-0000-4000-8000-000000000003', 'new.staff@example.com'),
                                          ('18000000-0000-4000-8000-000000000004', 'someone.else@example.com');
begin;
select pg_temp.sign_in('18000000-0000-4000-8000-000000000004');
select pg_temp.assert_raises(format('select app.accept_invitation(%L)', current_setting('test.token18')),
  'Sign in with that email', 'a different login cannot accept the invitation');
rollback;
begin;
select pg_temp.sign_in('18000000-0000-4000-8000-000000000003');
select pg_temp.assert_raises($$select app.accept_invitation('not-a-real-token-at-all')$$, 'not valid', 'a wrong token is "not valid"');
create temp table acc18 on commit drop as select app.accept_invitation(current_setting('test.token18')) as r;
select pg_temp.assert((select r->'active_roles' = '["content_editor"]'::jsonb and r->'pending_roles' = '["treasurer"]'::jsonb from acc18),
  'accepting grants content_editor now; treasurer waits for a second approver (two-person rule)');
reset role;
select pg_temp.assert((select count(*) = 2 and bool_and(granted_by = :ada::uuid) from app.role_grants
                        where center_id = :jsh and user_id = '18000000-0000-4000-8000-000000000003'),
  'the grants are recorded as granted by the inviter');
select pg_temp.assert((select p.first_name = 'Nisha' and p.last_name = 'Patel' and p.email::text = 'new.staff@example.com'
                         from app.center_users cu join app.people p on p.id = cu.person_id
                        where cu.center_id = :jsh and cu.user_id = '18000000-0000-4000-8000-000000000003'),
  'the new login is linked to a new person record named on the invitation');
select pg_temp.assert(exists (select 1 from app.audit_log where action = 'staff_invitations.update' and after->>'accepted_by' = '18000000-0000-4000-8000-000000000003'
                                and reason = 'Staff invitation accepted'),
  'the acceptance is audited');
commit;
begin;
select pg_temp.sign_in('18000000-0000-4000-8000-000000000003');
select pg_temp.assert_raises(format('select app.accept_invitation(%L)', current_setting('test.token18')), 'already accepted',
  'an invitation cannot be accepted twice');
select pg_temp.assert_raises($$select app.approve_role_grant((select id from app.role_grants where user_id = '18000000-0000-4000-8000-000000000003' and status = 'pending'))$$,
  'not allowed', 'the invitee cannot approve their own pending grant');
rollback;
begin;
select pg_temp.sign_in(:ada, 5);
select pg_temp.assert_raises($$select app.approve_role_grant((select id from app.role_grants where user_id = '18000000-0000-4000-8000-000000000003' and status = 'pending'))$$,
  'second, different person', 'the inviter cannot be the second approver');
rollback;
begin;
select pg_temp.sign_in(:admin2, 5);
select app.approve_role_grant((select id from app.role_grants where user_id = '18000000-0000-4000-8000-000000000003' and status = 'pending'));
select pg_temp.assert((select status = 'active' and second_approver = :admin2::uuid from app.role_grants
                        where user_id = '18000000-0000-4000-8000-000000000003' and role_key = 'treasurer'),
  'a second administrator approves the treasurer grant');
rollback;
-- Withdrawn and expired invitations.
begin;
select pg_temp.sign_in(:ada, 5);
create temp table inv18b on commit drop as select * from app.invite_staff(:jsh, 'someone.else@example.com', null, null, array['content_editor']);
select app.revoke_invitation((select invitation_id from inv18b), 'wrong person');
select pg_temp.assert((select revoked_at is not null and revoked_by = :ada::uuid from app.staff_invitations where id = (select invitation_id from inv18b)),
  'an invitation can be withdrawn');
select set_config('test.token18b', (select token from inv18b), false);
commit;
begin;
select pg_temp.sign_in('18000000-0000-4000-8000-000000000004');
select pg_temp.assert_raises(format('select app.accept_invitation(%L)', current_setting('test.token18b')), 'withdrawn', 'a withdrawn invitation cannot be accepted');
rollback;
begin;
select pg_temp.sign_in(:ada, 5);
create temp table inv18c on commit drop as select * from app.invite_staff(:jsh, 'someone.else@example.com', null, null, array['content_editor']);
select set_config('test.token18c', (select token from inv18c), false);
select set_config('test.inv18c', (select invitation_id::text from inv18c), false);
commit;
update app.staff_invitations set expires_at = now() - interval '1 minute' where id = current_setting('test.inv18c')::uuid;
begin;
select pg_temp.sign_in('18000000-0000-4000-8000-000000000004');
select pg_temp.assert_raises(format('select app.accept_invitation(%L)', current_setting('test.token18c')), 'expired', 'an expired invitation cannot be accepted');
rollback;
begin;
select pg_temp.sign_in(:ada, 5);
create temp table res18 on commit drop as select * from app.resend_invitation(current_setting('test.inv18c')::uuid);
select pg_temp.assert((select token <> current_setting('test.token18c') and expires_at > now() from res18), 'resending issues a new link and a new expiry');
select pg_temp.assert((select status from app.invitation_preview(current_setting('test.token18c'))) is null, 'the old link stops working');
commit;

-- ── Organization agreements ─────────────────────────────────────────────────
select pg_temp.assert((select count(*) from app.legal_documents where center_id is null and published_at is null
                         and kind in ('org_terms','dpa','children_addendum','sandbox_terms','order_form')) = 5,
  'the five platform agreement drafts exist, unpublished');
select set_config('test.dpa', (select id::text from app.legal_documents where center_id is null and kind = 'dpa'), false);
begin;
select pg_temp.sign_in(:ada);
select pg_temp.assert_raises($$select app.accept_org_agreement('00000000-0000-4000-8000-000000000001', current_setting('test.dpa')::uuid)$$,
  'not been published', 'an unpublished agreement cannot be accepted');
select pg_temp.assert_raises($$select app.publish_platform_document(current_setting('test.dpa')::uuid)$$,
  'Community Connect team', 'a community admin cannot publish platform agreements');
rollback;
begin;
select pg_temp.sign_in(:platform);
select app.publish_platform_document(id) from app.legal_documents where center_id is null and kind in ('org_terms','dpa','children_addendum','order_form');
commit;
select pg_temp.assert((select (r->>'ok')::boolean = false and r->>'detail' like 'Not accepted yet: terms of service, data processing agreement, children''s data addendum, order form.%'
                         from app.check_agreements_accepted(:jsh) r),
  'agreements_accepted lists what is not accepted yet (production: terms, DPA, children''s addendum, order form)');
begin;
select pg_temp.sign_in(:admin2, null, '{"user-agent":"Mozilla/5.0 test","x-forwarded-for":"198.51.100.7"}');
select pg_temp.assert_raises($$select app.accept_org_agreement('00000000-0000-4000-8000-000000000001', current_setting('test.dpa')::uuid)$$,
  'Only the owner', 'only the owner accepts the agreements');
rollback;
begin;
select pg_temp.sign_in(:ada, null, '{"user-agent":"Mozilla/5.0 test","x-forwarded-for":"198.51.100.7, 10.0.0.1","x-client-app":"portal"}');
select app.accept_org_agreement(:jsh, id) from app.legal_documents where center_id is null and kind in ('org_terms','dpa','children_addendum','order_form');
select pg_temp.assert((select count(*) = 4 and bool_and(accepted_by = :ada::uuid and ip = '198.51.100.7'::inet and user_agent = 'Mozilla/5.0 test'
                                               and version = '2026-09-draft')
                         from app.org_agreements where center_id = :jsh),
  'the owner accepts: who, which version, when, IP and browser are recorded');
select pg_temp.assert((select array_agg(kind order by kind) from app.org_agreements where center_id = :jsh) = array['children_addendum','dpa','order_form','terms'],
  'the organization terms are recorded as kind "terms" (the document is org_terms)');
select pg_temp.assert((select count(*) filter (where required and accepted) = 4 and bool_and(not required or accepted) from app.org_agreement_status(:jsh)),
  'org_agreement_status: every required agreement is accepted (sandbox terms are not required in production)');
reset role;
select pg_temp.assert(exists (select 1 from app.audit_log where action = 'org_agreements.insert' and center_id = :jsh and actor_user_id = :ada::uuid
                                and reason like 'Accepted Data processing agreement%' and client_app = 'portal'),
  'each acceptance is audited');
select pg_temp.assert((app.check_agreements_accepted(:jsh)->>'ok')::boolean, 'agreements_accepted passes once they are accepted');
rollback;
begin;
select pg_temp.sign_in(:priya);
select pg_temp.assert(not exists (select 1 from app.org_agreements), 'a member cannot read the organization''s agreement records');
select pg_temp.assert(not exists (select 1 from app.staff_invitations), 'a member cannot read staff invitations');
rollback;
-- Leave the platform documents unpublished for anyone who runs later tests.
update app.legal_documents set published_at = null where center_id is null and kind in ('org_terms','dpa','children_addendum','order_form');

-- ── Security events in the app audit log ────────────────────────────────────
begin;
select pg_temp.sign_in(:ada, 5);
select app.record_security_event(:jsh, 'mfa.enrolled');
select pg_temp.assert(exists (select 1 from app.audit_log where action = 'security.mfa.enrolled' and actor_user_id = :ada::uuid and after->>'authenticator_apps' = '1'),
  'an enrolment is written to the community audit log');
select pg_temp.assert_raises($$select app.record_security_event('00000000-0000-4000-8000-000000000001', 'phone.verified')$$, 'has not been verified',
  'a phone verification that did not happen cannot be recorded');
select pg_temp.assert_raises($$select app.record_security_event('00000000-0000-4000-8000-000000000001', 'made.up')$$, 'Unknown security event', 'unknown events are refused');
rollback;
begin;
select pg_temp.sign_in(:priya);
select pg_temp.assert_raises($$select app.record_security_event('00000000-0000-4000-8000-000000000001', 'mfa.enrolled')$$, 'No authenticator app',
  'an enrolment that did not happen cannot be recorded');
rollback;
