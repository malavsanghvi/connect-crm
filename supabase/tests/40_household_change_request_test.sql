-- 0523: deciding a household change request (approve an add-member / relationship
-- change, or reject with a reason) -- the gap that left two onboarding-added family
-- members invisible everywhere: nothing ever moved a request off 'open'.
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

-- ── Fixtures ────────────────────────────────────────────────────────────────
\set c '''40000000-0000-4000-8000-0000000000c1'''
\set admin '''40000000-0000-4000-8000-000000000001'''
\set member '''40000000-0000-4000-8000-000000000002'''
insert into auth.users (id, email) values (:admin, 'admin40@example.com'), (:member, 'member40@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status) values (:c, 'orbit40', 'Orbit Test Community', 'OTC', 'TX', 'active');
insert into app.role_grants (center_id, user_id, role_key) values (:c, :admin, 'center_admin');
insert into app.households (id, center_id, display_name) values ('40000000-0000-4000-8000-0000000000a1', :c, 'Doshi household');
insert into app.people (id, center_id, first_name, last_name) values ('40000000-0000-4000-8000-0000000000a2', :c, 'Kiran', 'Doshi');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  ('40000000-0000-4000-8000-0000000000a1', '40000000-0000-4000-8000-0000000000a2', :c, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values (:c, :member, '40000000-0000-4000-8000-0000000000a2');

-- ── A member requests adding a child ─────────────────────────────────────────
begin;
select pg_temp.sign_in(:member);
insert into app.household_change_requests (id, center_id, household_id, requested_by, kind, details) values
  ('40000000-0000-4000-8000-0000000000b1', :c, '40000000-0000-4000-8000-0000000000a1', :member, 'add_member',
   '{"first_name":"Priya","last_name":"Doshi","relationship":"Daughter","dob":"2015-03-02"}');
commit;
select pg_temp.assert((select count(*) from app.household_change_requests where id = '40000000-0000-4000-8000-0000000000b1' and status = 'open') = 1,
  'the request is open and visible to staff');

-- ── A member cannot decide it ─────────────────────────────────────────────
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises($$select app.decide_household_change_request('40000000-0000-4000-8000-0000000000b1', 'approve', 'child')$$,
  'people.manage', 'a member cannot approve a request');
commit;

-- ── Admin approves: a person + household_members row are created, request closes ──
begin;
select pg_temp.sign_in(:admin);
select app.decide_household_change_request('40000000-0000-4000-8000-0000000000b1', 'approve', 'child') as new_person \gset
select pg_temp.assert(:'new_person' is not null, 'approving returns the new person id');
select pg_temp.assert((select first_name || ' ' || last_name from app.people where id = :'new_person'::uuid) = 'Priya Doshi',
  'the new person was created from the request details');
select pg_temp.assert((select role::text from app.household_members where person_id = :'new_person'::uuid and household_id = '40000000-0000-4000-8000-0000000000a1') = 'child',
  'they join the household with the confirmed relationship');
select pg_temp.assert((select status || '|' || coalesce(decided_by::text,'') from app.household_change_requests where id = '40000000-0000-4000-8000-0000000000b1') = 'approved|' || :admin,
  'the request is marked approved, decided by the admin');
commit;

-- ── Re-approving an already-decided request fails ────────────────────────────
begin;
select pg_temp.sign_in(:admin);
select pg_temp.assert_raises($$select app.decide_household_change_request('40000000-0000-4000-8000-0000000000b1', 'approve', 'child')$$,
  'already decided', 'a decided request cannot be decided again');
commit;

-- ── A relationship-change request needs a reason to reject, and is audited ───
begin;
select pg_temp.sign_in(:member);
insert into app.household_change_requests (id, center_id, household_id, requested_by, kind, details) values
  ('40000000-0000-4000-8000-0000000000b2', :c, '40000000-0000-4000-8000-0000000000a1', :member, 'change_relationship',
   jsonb_build_object('person_id', :'new_person', 'relationship_from', 'child', 'relationship', 'Grandchild'));
commit;
begin;
select pg_temp.sign_in(:admin);
select pg_temp.assert_raises($$select app.decide_household_change_request('40000000-0000-4000-8000-0000000000b2', 'reject')$$,
  'give a reason', 'rejecting needs a reason');
select app.decide_household_change_request('40000000-0000-4000-8000-0000000000b2', 'reject', null, 'Grandchild is not one of our relationship options');
commit;
select pg_temp.assert((select status || '|' || reason from app.household_change_requests where id = '40000000-0000-4000-8000-0000000000b2') =
  'rejected|Grandchild is not one of our relationship options', 'rejecting records the reason and closes the request');
select pg_temp.assert((select role::text from app.household_members where person_id = :'new_person'::uuid) = 'child',
  'rejecting a relationship change leaves the household member as they were');
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'household_change_requests' and record_id::text in
  ('40000000-0000-4000-8000-0000000000b1', '40000000-0000-4000-8000-0000000000b2') and action like '%.update') >= 2,
  'both decisions are audited');
