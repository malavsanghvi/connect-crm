-- 0400–0401 (stream e-access, Wave E): owner decisions 2026-09-25 (1), (2), (21), (22), (23).
--   (2)  the organization's owner holds every permission; center admins still lack giving /
--        accounting / privacy; two-person rules still need a different second person
--   (1)  Community Connect's approval of the first second administrator is named in the audit
--   (21) sandboxes never appear in community search; join codes still open them
--   (22) members never receive staff-only custom-field values
--   (23) staff with an authenticator app must pass the fresh 2FA check even where the rule is off
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
create or replace function pg_temp.sign_in(p_user uuid, p_totp_age int default null) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated',
    'aal', case when p_totp_age is null then 'aal1' else 'aal2' end,
    'amr', case when p_totp_age is null
                then jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', floor(extract(epoch from now())) - 60))
                else jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', floor(extract(epoch from now())) - p_totp_age)) end)::text, true);
  perform set_config('request.headers', '{"x-audit-reason":"Second approval of a role grant (two-person rule)"}', true);
  perform set_config('role', 'authenticated', true);
end $$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- C: a production community that has not switched on staff 2FA (like JSH). S: a sandbox.
\set c '''32000000-0000-4000-8000-0000000000c1'''
\set s '''32000000-0000-4000-8000-0000000000c2'''
\set r '''32000000-0000-4000-8000-0000000000c3'''
\set owner '''32000000-0000-4000-8000-000000000001'''
\set admin '''32000000-0000-4000-8000-000000000002'''
\set treas '''32000000-0000-4000-8000-000000000003'''
\set member '''32000000-0000-4000-8000-000000000004'''
\set cc '''32000000-0000-4000-8000-000000000005'''
\set sowner '''32000000-0000-4000-8000-000000000006'''
\set second '''32000000-0000-4000-8000-000000000007'''
\set third '''32000000-0000-4000-8000-000000000008'''
\set totpstaff '''32000000-0000-4000-8000-000000000009'''
\set plainstaff '''32000000-0000-4000-8000-00000000000a'''
\set newbie '''32000000-0000-4000-8000-00000000000b'''
\set rowner '''32000000-0000-4000-8000-00000000000c'''
insert into auth.users (id, email) values
  (:owner, 'owner32@example.com'), (:admin, 'admin32@example.com'), (:treas, 'treas32@example.com'),
  (:member, 'member32@example.com'), (:cc, 'cc32@example.com'), (:sowner, 'sowner32@example.com'),
  (:second, 'second32@example.com'), (:third, 'third32@example.com'), (:totpstaff, 'totp32@example.com'),
  (:plainstaff, 'plain32@example.com'), (:newbie, 'newbie32@example.com'), (:rowner, 'rowner32@example.com');
insert into app.accounts (user_id, is_platform_admin) values (:cc, true);
insert into app.centers (id, slug, name, short_name, state_region, status, environment, rules) values
  (:c, 'orbit32', 'Orbit Test Community', 'OTC', 'TX', 'active', 'production', '{"security":{"require_2fa_for_staff":false}}'),
  (:s, 'orbit32-sandbox', 'Orbit Test Community Sandbox', 'OTCS', 'TX', 'active', 'sandbox', '{"security":{"require_2fa_for_staff":false}}'),
  (:r, 'strict32', 'Strict Test Community', 'STC', 'TX', 'active', 'production', '{"security":{"require_2fa_for_staff":true}}');
-- The owners hold no role grant at all; the admin, treasurer and staff hold theirs.
insert into app.center_owners (center_id, user_id) values (:c, :owner), (:s, :sowner), (:r, :rowner)
  on conflict (center_id) do update set user_id = excluded.user_id;
delete from app.role_grants where center_id in (:c, :s, :r);
insert into app.role_grants (center_id, user_id, role_key) values
  (:c, :admin, 'center_admin'), (:c, :treas, 'treasurer'), (:c, :totpstaff, 'content_editor'), (:c, :plainstaff, 'content_editor'),
  (:s, :sowner, 'center_admin');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status) values
  ('f3200000-0000-4000-8000-000000000009', :totpstaff, 'Phone', 'totp', 'verified');
-- A member household with one person linked to a login.
insert into app.households (id, center_id, display_name) values ('32000000-0000-4000-8000-0000000000a1', :c, 'Orbit family');
insert into app.people (id, center_id, first_name, last_name) values ('32000000-0000-4000-8000-0000000000b1', :c, 'Mira', 'Orbit');
insert into app.household_members (household_id, person_id, center_id, is_primary) values
  ('32000000-0000-4000-8000-0000000000a1', '32000000-0000-4000-8000-0000000000b1', :c, true);
insert into app.center_users (center_id, user_id, person_id) values (:c, :member, '32000000-0000-4000-8000-0000000000b1');
insert into app.data_requests (id, center_id, person_id, kind) values ('32000000-0000-4000-8000-0000000000d1', :c, '32000000-0000-4000-8000-0000000000b1', 'export');

-- ══ (2) The owner can do every task ═════════════════════════════════════════
begin;
select pg_temp.sign_in(:owner);
select pg_temp.assert(app.has_permission(:c, 'giving.manage') and app.has_permission(:c, 'giving.approve')
                      and app.has_permission(:c, 'accounting.manage') and app.has_permission(:c, 'accounting.close')
                      and app.has_permission(:c, 'privacy.manage') and app.has_permission(:c, 'roles.manage'),
  '(2) the owner, with no role grant, holds giving, accounting, privacy and roles permissions');
select pg_temp.assert(not app.has_permission(:s, 'giving.manage'), '(2) …only in their own organization');
insert into app.funds (center_id, key, name) values (:c, 'owner32', 'Owner fund');
select pg_temp.assert(true, '(2) the owner adds a fund (giving.manage, through RLS)');
insert into app.bank_accounts (center_id, name) values (:c, 'Owner operating ··3232');
select pg_temp.assert(true, '(2) the owner adds a bank account (accounting.manage, through RLS)');
with u as (update app.data_requests set status = 'in_progress' where id = '32000000-0000-4000-8000-0000000000d1' returning 1)
select pg_temp.assert((select count(*) from u) = 1, '(2) the owner works a data request (privacy.manage, through RLS)');
rollback;

begin;
select pg_temp.sign_in(:admin);
select pg_temp.assert(app.has_permission(:c, 'settings.manage') and app.has_permission(:c, 'roles.manage'),
  '(2) the center admin keeps their own role''s permissions');
select pg_temp.assert(not app.has_permission(:c, 'giving.manage') and not app.has_permission(:c, 'accounting.manage')
                      and not app.has_permission(:c, 'accounting.close') and not app.has_permission(:c, 'privacy.manage'),
  '(2) the center admin still has no giving, accounting or privacy permission');
select pg_temp.assert_raises($$insert into app.funds (center_id, key, name) values ('32000000-0000-4000-8000-0000000000c1', 'admin32', 'Admin fund')$$,
  'row-level security', '(2) the center admin cannot add a fund');
select pg_temp.assert_raises($$insert into app.bank_accounts (center_id, name) values ('32000000-0000-4000-8000-0000000000c1', 'Admin ··0000')$$,
  'row-level security', '(2) the center admin cannot add a bank account');
with u as (update app.data_requests set status = 'in_progress' where id = '32000000-0000-4000-8000-0000000000d1' returning 1)
select pg_temp.assert((select count(*) from u) = 0, '(2) the center admin cannot touch a data request');
rollback;

-- Two-person rules: the owner requested the write-off, so the owner cannot also approve it.
insert into app.pledges (id, center_id, household_id, amount_cents) values
  ('32000000-0000-4000-8000-0000000000e1', :c, '32000000-0000-4000-8000-0000000000a1', 50000);
update app.pledges set written_off_by = :owner, write_off_reason = 'e-access test' where id = '32000000-0000-4000-8000-0000000000e1';
begin;
select pg_temp.sign_in(:owner, 30);
select pg_temp.assert_raises($$select app.approve_as_second('pledges', '32000000-0000-4000-8000-0000000000e1')$$,
  'different person', '(2) the owner cannot second-approve their own write-off request');
rollback;
begin;
select pg_temp.sign_in(:treas, 30);
select app.approve_as_second('pledges', '32000000-0000-4000-8000-0000000000e1');
select pg_temp.assert((select written_off_second_approver from app.pledges where id = '32000000-0000-4000-8000-0000000000e1') = :treas,
  '(2) a different person (the treasurer) can');
rollback;
-- …and the owner's own role grant for someone needs another approver.
begin;
select pg_temp.sign_in(:owner, 30);
insert into app.role_grants (center_id, user_id, role_key) values (:c, :newbie, 'treasurer');
select pg_temp.assert((select status from app.role_grants where center_id = :c and user_id = :newbie) = 'pending',
  '(2) the owner grants a finance role: it waits for a second person');
select pg_temp.assert_raises(format('select app.approve_role_grant(%L)', (select id from app.role_grants where center_id = :c and user_id = :newbie)),
  'second, different person', '(2) the owner cannot approve the grant they made');
rollback;
-- The owner counts as staff for the 2FA rules: an owner without an authenticator app, in a
-- community that requires staff 2FA, is asked (holding every permission never means fewer checks).
select pg_temp.assert(app.is_staff_of(:r, :rowner) and app.staff_2fa_required(:rowner),
  '(2) an owner with no role grant counts as staff for the 2FA rules');
begin;
select pg_temp.sign_in(:rowner);
select pg_temp.assert_raises($$select app.assert_step_up('giving.refund')$$, 'fresh 2FA check',
  '(2) …so in a community that requires staff 2FA, the owner must pass it');
rollback;

-- ══ (1) Community Connect approves the first second administrator, named in the audit ═
-- The sandbox owner invites a second admin (pending, granted by the owner).
begin;
select pg_temp.sign_in(:sowner, 30);
insert into app.role_grants (center_id, user_id, role_key, reason) values (:s, :second, 'center_admin', 'second admin');
insert into app.role_grants (center_id, user_id, role_key, reason) values (:s, :third, 'center_admin', 'third admin');
commit;
select id as g2 from app.role_grants where center_id = :s and user_id = :second \gset
select id as g3 from app.role_grants where center_id = :s and user_id = :third \gset
select pg_temp.assert(app.is_first_second_admin_grant(:'g2') and app.is_first_second_admin_grant(:'g3'),
  '(1) with only the owner as administrator, a center_admin grant is the first second admin');
begin;
select pg_temp.sign_in(:sowner, 30);
select pg_temp.assert_raises(format('select app.approve_role_grant(%L)', :'g2'), 'second, different person',
  '(1) the owner who made the grant cannot approve it');
rollback;
select coalesce(max(id), 0) as a0 from app.audit_log \gset
begin;
select pg_temp.sign_in(:cc);
select app.approve_role_grant(:'g2');
commit;
select pg_temp.assert((select status || '|' || second_approver from app.role_grants where id = :'g2') = 'active|' || :cc,
  '(1) Community Connect approves it; the grant is active with the platform admin as second approver');
select pg_temp.assert((select count(*) from app.audit_log where id > :a0 and record_table = 'role_grants' and record_id = :'g2'
                         and actor_user_id = :cc and reason = 'Community Connect approval (two-person rule, first second admin)') = 1,
  '(1) the audit row names the approving platform admin with the reason "Community Connect approval (two-person rule, first second admin)"');
select pg_temp.assert(not app.is_first_second_admin_grant(:'g3'), '(1) once a second admin exists, the next one is not the first');
select coalesce(max(id), 0) as a1 from app.audit_log \gset
begin;
select pg_temp.sign_in(:cc);
select app.approve_role_grant(:'g3');
commit;
select pg_temp.assert((select reason from app.audit_log where id > :a1 and record_table = 'role_grants' and record_id = :'g3' order by id desc limit 1)
                        = 'Second approval of a role grant (two-person rule)',
  '(1) a later approval keeps the ordinary reason');

-- ══ (21) Sandboxes never appear in community search ═════════════════════════
select code as sbx_code from app.member_join_codes where center_id = :s and active limit 1 \gset
begin;
set local role anon;
select pg_temp.assert((select count(*) from app.find_community('Orbit Test')) = 1
                      and (select slug from app.find_community('Orbit Test')) = 'orbit32',
  '(21) searching finds the live community only, never its sandbox');
select pg_temp.assert((select count(*) from app.find_community('orbit32-sandbox')) = 0
                      and (select count(*) from app.find_community('OTCS')) = 0,
  '(21) not by the sandbox''s own slug or short name either');
select pg_temp.assert((select slug || '|' || environment from app.community_by_join_code(:'sbx_code')) = 'orbit32-sandbox|sandbox',
  '(21) the sandbox''s join code still opens it');
rollback;

-- ══ (22) Members never receive staff-only custom-field values ═══════════════
insert into app.custom_field_definitions (center_id, entity, key, label, type, sensitivity) values
  (:c, 'people', 'pastoral_note', 'Pastoral note', 'text', 'staff'),
  (:c, 'people', 'tshirt', 'T-shirt size', 'text', 'member_self'),
  (:c, 'people', 'hometown', 'Hometown', 'text', 'directory'),
  (:c, 'households', 'legacy_account', 'Legacy account', 'text', 'staff');
begin;
select pg_temp.sign_in(:admin);
update app.people set custom = custom || '{"pastoral_note":"Needs a visit","tshirt":"M","hometown":"Palitana"}'
 where id = '32000000-0000-4000-8000-0000000000b1';
update app.households set custom = custom || '{"legacy_account":"NEON-77"}' where id = '32000000-0000-4000-8000-0000000000a1';
commit;
select pg_temp.assert((select custom from app.people where id = '32000000-0000-4000-8000-0000000000b1') = '{"tshirt":"M","hometown":"Palitana"}',
  '(22) the record keeps only the values members may see');
select pg_temp.assert((select custom from app.custom_staff_values where entity = 'people' and record_key = '32000000-0000-4000-8000-0000000000b1')
                        = '{"pastoral_note":"Needs a visit"}',
  '(22) the staff-only value is kept apart');
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert((select custom from app.people where id = '32000000-0000-4000-8000-0000000000b1') = '{"tshirt":"M","hometown":"Palitana"}',
  '(22) a member reading their own record gets no staff-only value');
select pg_temp.assert((select custom from app.households where id = '32000000-0000-4000-8000-0000000000a1') = '{}',
  '(22) …nor on their household');
select pg_temp.assert((select count(*) from app.custom_staff_values) = 0, '(22) a member reads nothing of the staff-only values');
select pg_temp.assert((select custom from app.custom_values('people', array['32000000-0000-4000-8000-0000000000b1'])) = '{"tshirt":"M","hometown":"Palitana"}',
  '(22) app.custom_values gives a member only what they may see');
select pg_temp.assert((select string_agg(key, ',' order by key) from app.person_custom_fields(:c, '32000000-0000-4000-8000-0000000000b1')) = 'hometown,tshirt',
  '(22) the member app''s list: their member_self and directory fields, no staff-only one');
select pg_temp.assert_raises($$update app.people set custom = custom || '{"tshirt":"L"}' where id = '32000000-0000-4000-8000-0000000000b1'$$,
  'Only staff', '(22) members still cannot change custom details');
rollback;
begin;
select pg_temp.sign_in(:admin);
select pg_temp.assert((select custom from app.custom_values('people', array['32000000-0000-4000-8000-0000000000b1']))
                        = '{"tshirt":"M","hometown":"Palitana","pastoral_note":"Needs a visit"}',
  '(22) staff who may read people get every value');
select pg_temp.assert(app.set_custom_value('people', '32000000-0000-4000-8000-0000000000b1', 'pastoral_note', null)
                        = '{"tshirt":"M","hometown":"Palitana"}',
  '(22) clearing a staff-only value in place removes it');
select pg_temp.assert(app.set_custom_value('people', '32000000-0000-4000-8000-0000000000b1', 'pastoral_note', '"Called in May"')
                        ->> 'pastoral_note' = 'Called in May',
  '(22) setting one returns the full set for staff');
commit;
begin;
select pg_temp.sign_in(:treas);   -- people.view: reads staff-only values of people
select pg_temp.assert((select custom ->> 'pastoral_note' from app.custom_values('people', array['32000000-0000-4000-8000-0000000000b1'])) = 'Called in May',
  '(22) staff with read access see the staff-only values');
rollback;
-- Changing a field's sensitivity moves its values.
begin;
select pg_temp.sign_in(:admin);
select (app.update_custom_field(id, p_sensitivity => 'member_self')).sensitivity from app.custom_field_definitions where center_id = :c and key = 'pastoral_note';
commit;
select pg_temp.assert((select custom ->> 'pastoral_note' from app.people where id = '32000000-0000-4000-8000-0000000000b1') = 'Called in May'
                      and not exists (select 1 from app.custom_staff_values where record_key = '32000000-0000-4000-8000-0000000000b1' and custom ? 'pastoral_note'),
  '(22) made visible to members: the value moves onto the record');
begin;
select pg_temp.sign_in(:admin);
select (app.update_custom_field(id, p_sensitivity => 'staff')).sensitivity from app.custom_field_definitions where center_id = :c and key = 'pastoral_note';
commit;
select pg_temp.assert(not ((select custom from app.people where id = '32000000-0000-4000-8000-0000000000b1') ? 'pastoral_note')
                      and (select custom ->> 'pastoral_note' from app.custom_staff_values where record_key = '32000000-0000-4000-8000-0000000000b1') = 'Called in May',
  '(22) made staff-only again: the value leaves the record');
-- A record that goes takes its staff-only values with it.
insert into app.households (id, center_id, display_name, custom) values ('32000000-0000-4000-8000-0000000000a2', :c, 'Gone family', '{"legacy_account":"NEON-9"}');
select pg_temp.assert(exists (select 1 from app.custom_staff_values where record_key = '32000000-0000-4000-8000-0000000000a2'), '(22) inserting routes the staff-only value too');
delete from app.households where id = '32000000-0000-4000-8000-0000000000a2';
select pg_temp.assert(not exists (select 1 from app.custom_staff_values where record_key = '32000000-0000-4000-8000-0000000000a2'), '(22) deleting the record removes it');
select pg_temp.assert(not has_table_privilege('anon', 'app.custom_staff_values', 'select'), '(22) the public key cannot read staff-only values at all');
select pg_temp.assert((select count(*) from app.module_tables where table_name = 'custom_staff_values') = 1
                      and exists (select 1 from pg_trigger where tgname = 'audit_custom_staff_values'),
  '(22) the new table is registered and audited');

-- ══ (23) Staff with an authenticator app pass the fresh 2FA check even where the rule is off ═
select pg_temp.assert(not app.require_2fa_for_staff(:c), '(23) the community has not switched staff 2FA on (as JSH)');
begin;
select pg_temp.sign_in(:totpstaff);
select pg_temp.assert_raises($$select app.assert_step_up('export.people')$$, 'fresh 2FA check',
  '(23) a staff member with an authenticator app is asked for a fresh check');
rollback;
begin;
select pg_temp.sign_in(:totpstaff, 30);
select app.assert_step_up('export.people');
select pg_temp.assert(true, '(23) …and passes once they entered a code in the last 5 minutes');
rollback;
begin;
select pg_temp.sign_in(:plainstaff);
select app.assert_step_up('export.people');
select pg_temp.assert(true, '(23) a staff member without one keeps today''s behaviour (not asked while the rule is off)');
rollback;

-- ══ (22) The import engine sees and restores a record's custom values as one object (0402) ═
select pg_temp.assert((app.import_current('people', '32000000-0000-4000-8000-0000000000b1') -> 'custom')
                        = '{"tshirt":"M","hometown":"Palitana","pastoral_note":"Called in May"}',
  '(22) import_current: a record''s custom values include the staff-only ones');
select app.import_set('people', '32000000-0000-4000-8000-0000000000b1', '{"custom":{"tshirt":"L","hometown":"Palitana"}}');
select pg_temp.assert((select custom from app.people where id = '32000000-0000-4000-8000-0000000000b1') = '{"tshirt":"L","hometown":"Palitana"}'
                      and not exists (select 1 from app.custom_staff_values where record_key = '32000000-0000-4000-8000-0000000000b1' and custom ? 'pastoral_note'),
  '(22) import_set sets the whole object: a staff-only value left out is removed (as undo needs)');
select app.import_set('people', '32000000-0000-4000-8000-0000000000b1', '{"custom":{"tshirt":"M","hometown":"Palitana","pastoral_note":"Called in May"}}');
select pg_temp.assert((app.import_current('people', '32000000-0000-4000-8000-0000000000b1') -> 'custom')
                        = '{"tshirt":"M","hometown":"Palitana","pastoral_note":"Called in May"}'
                      and (select custom from app.people where id = '32000000-0000-4000-8000-0000000000b1') = '{"tshirt":"M","hometown":"Palitana"}',
  '(22) …and restores it, still kept apart from the row');
