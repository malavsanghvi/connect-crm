-- 0524: duplicate-account guard for family onboarding. Two family members
-- should never each end up with their own login and household for the same
-- person -- checked by phone/email (or exact name+DOB when neither is given)
-- both when a request is sent and when someone tries to self-onboard.
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
\set c '''41000000-0000-4000-8000-0000000000c1'''
\set admin '''41000000-0000-4000-8000-000000000001'''
\set asha '''41000000-0000-4000-8000-000000000002'''
\set vikram '''41000000-0000-4000-8000-000000000003'''
\set priya '''41000000-0000-4000-8000-000000000004'''
insert into auth.users (id, email, phone) values
  (:admin, 'admin41@example.com', null),
  (:asha, 'asha41@example.com', null),
  (:vikram, 'vikram41@example.com', null),
  (:priya, 'priya41@example.com', null);
insert into app.centers (id, slug, name, short_name, state_region, status) values (:c, 'orbit41', 'Orbit Test Community', 'OTC', 'TX', 'active');
insert into app.role_grants (center_id, user_id, role_key) values (:c, :admin, 'center_admin');
insert into app.households (id, center_id, display_name) values
  ('41000000-0000-4000-8000-0000000000a1', :c, 'Shah household'),
  ('41000000-0000-4000-8000-0000000000b1', :c, 'Patel household');
insert into app.people (id, center_id, first_name, last_name) values
  ('41000000-0000-4000-8000-0000000000a2', :c, 'Asha', 'Shah'),
  ('41000000-0000-4000-8000-0000000000b2', :c, 'Vikram', 'Patel');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  ('41000000-0000-4000-8000-0000000000a1', '41000000-0000-4000-8000-0000000000a2', :c, 'primary', true),
  ('41000000-0000-4000-8000-0000000000b1', '41000000-0000-4000-8000-0000000000b2', :c, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values
  (:c, :asha, '41000000-0000-4000-8000-0000000000a2'),
  (:c, :vikram, '41000000-0000-4000-8000-0000000000b2');

-- ── Asha requests adding Priya, with contact info ────────────────────────────
begin;
select pg_temp.sign_in(:asha);
select app.request_add_family_member('41000000-0000-4000-8000-0000000000a1', 'Priya', 'Shah', 'spouse', '1990-05-02'::date, '+15551234567', 'priya41@example.com') as req1 \gset
commit;
select pg_temp.assert(:'req1' is not null, 'the request is created');
select pg_temp.assert((select (details->>'phone') || '|' || (details->>'email') from app.household_change_requests where id = :'req1'::uuid) = '+15551234567|priya41@example.com',
  'phone and email are captured on the request');

-- ── Asha cannot send the same request twice ──────────────────────────────────
begin;
select pg_temp.sign_in(:asha);
select pg_temp.assert_raises($$select app.request_add_family_member('41000000-0000-4000-8000-0000000000a1', 'Priya', 'Shah', 'spouse', '1990-05-02'::date, '+15551234567', 'priya41@example.com')$$,
  'no need to send it twice', 'the same household cannot request the same person again');
commit;

-- ── Vikram cannot add the same person into a different household ────────────
begin;
select pg_temp.sign_in(:vikram);
select pg_temp.assert_raises($$select app.request_add_family_member('41000000-0000-4000-8000-0000000000b1', 'P', 'Confusion', null, null, '+15551234567', null)$$,
  'another household', 'a matching phone from a different household is refused');
commit;

-- ── Name+DOB fallback catches a duplicate with no contact info at all ────────
begin;
select pg_temp.sign_in(:asha);
select app.request_add_family_member('41000000-0000-4000-8000-0000000000a1', 'Rohan', 'Shah', 'child', '2010-01-01'::date) as req2 \gset
commit;
begin;
select pg_temp.sign_in(:vikram);
select pg_temp.assert_raises($$select app.request_add_family_member('41000000-0000-4000-8000-0000000000b1', 'Rohan', 'Shah', null, '2010-01-01'::date)$$,
  'another household', 'matching name and DOB with no contact info is still caught, from a different household');
commit;

-- ── Priya signs up before her request is approved: she is offered the pending match, not a new household ──
begin;
select pg_temp.sign_in(:priya);
select pg_temp.assert((select count(*) from app.find_pending_family_add_requests(:c::uuid) where request_id = :'req1'::uuid and household_name = 'Shah household') = 1,
  'Priya sees the pending request naming her, before it is approved');
select pg_temp.assert_raises($$select app.create_my_household('41000000-0000-4000-8000-0000000000c1'::uuid, 'Priya', 'Shah')$$,
  'already asked to add you', 'Priya cannot start a new household while the pending request is open');
commit;

-- ── Admin approves: the new person gets the phone/email from the request ────
begin;
select pg_temp.sign_in(:admin);
select app.decide_household_change_request(:'req1'::uuid, 'approve', 'spouse') as priya_person \gset
commit;
select pg_temp.assert((select phone_e164 || '|' || email::text from app.people where id = :'priya_person'::uuid) = '+15551234567|priya41@example.com',
  'the approved person keeps the phone and email from the request');

-- ── The loop is now closed: Priya signing in finds herself via find_my_family ──
begin;
select pg_temp.sign_in(:priya);
select pg_temp.assert((select count(*) from app.find_my_family(:c::uuid) where person_id = :'priya_person'::uuid) = 1,
  'once approved, Priya''s own sign-in now matches the real person record');
commit;

-- ── Approval-time guard: refuses to approve into a duplicate created meanwhile ──
insert into app.household_change_requests (id, center_id, household_id, requested_by, kind, status, details) values
  ('41000000-0000-4000-8000-0000000000d1', :c, '41000000-0000-4000-8000-0000000000b1', :vikram, 'add_member', 'open',
   '{"first_name":"Someone","last_name":"Else","phone":"+15551234567"}');
begin;
select pg_temp.sign_in(:admin);
select pg_temp.assert_raises($$select app.decide_household_change_request('41000000-0000-4000-8000-0000000000d1', 'approve', 'other')$$,
  'may be a duplicate', 'approving is refused when the phone now matches someone already on file');
commit;
