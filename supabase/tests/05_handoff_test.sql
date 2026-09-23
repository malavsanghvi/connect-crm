-- Handoff alignment: two-person rule, legacy QR check-in, role changes.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
\set jsh '''00000000-0000-4000-8000-000000000001'''

-- roles from the handoff memory
select pg_temp.assert((select permissions ? 'people.manage' from app.roles where key = 'treasurer'), 'treasurer can edit people-level data');
select pg_temp.assert((select permissions ? 'people.approve' and permissions ? 'people.manage' from app.roles where key = 'executive_committee'),
                      'EC can edit people-level data and approve life memberships');
select pg_temp.assert((select max(price_cents) <= 999 and min(price_cents) >= 499 from app.store_items), 'seeded store prices within the memory''s range');

-- two-person rule: write-off
insert into auth.users (id, email) values ('10000000-0000-4000-8000-000000000008', 'treasurer2@example.com');
insert into app.people (id, center_id, first_name, last_name) values ('30000000-0000-4000-8000-000000000021', :jsh, 'Second', 'Treasurer');
insert into app.center_users (center_id, user_id, person_id) values (:jsh, '10000000-0000-4000-8000-000000000008', '30000000-0000-4000-8000-000000000021');
insert into app.role_grants (center_id, user_id, role_key) values (:jsh, '10000000-0000-4000-8000-000000000008', 'treasurer');
insert into app.pledges (id, center_id, household_id, source, amount_cents) values
  ('60000000-0000-4000-8000-000000000031', :jsh, '20000000-0000-4000-8000-000000000002', 'general', 1100);

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';
do $$ begin
  update app.pledges set status = 'written_off', written_off_by = '10000000-0000-4000-8000-000000000003', write_off_reason = 'moved away'
   where id = '60000000-0000-4000-8000-000000000031';
  raise exception 'FAIL: single-person write-off accepted';
exception when check_violation then raise notice 'PASS: a write-off by one person is refused';
end $$;
update app.pledges set written_off_by = '10000000-0000-4000-8000-000000000003', write_off_reason = 'moved away'
 where id = '60000000-0000-4000-8000-000000000031';
do $$ begin
  perform app.approve_as_second('pledges', '60000000-0000-4000-8000-000000000031');
  raise exception 'FAIL: approved own write-off';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: the first approver cannot also be the second';
end $$;
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000008';
select app.approve_as_second('pledges', '60000000-0000-4000-8000-000000000031');
update app.pledges set status = 'written_off' where id = '60000000-0000-4000-8000-000000000031';
commit;
select pg_temp.assert((select status from app.pledges where id = '60000000-0000-4000-8000-000000000031') = 'written_off',
                      'write-off succeeds with two different approvers');

-- legacy QR codes at check-in
insert into app.external_ids (center_id, person_id, kind, system, value, label) values
  (:jsh, '30000000-0000-4000-8000-000000000005', 'crm', 'namocrm', '88213', 'NamoCRM contact ID');
-- (Priya already carries Neon ID 4374 from 02_identifiers_test.sql)
insert into app.events (id, center_id, name, starts_at, status) values
  ('50000000-0000-4000-8000-000000000002', :jsh, 'Samvatsari Pratikraman', now(), 'live');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id) values
  (:jsh, '10000000-0000-4000-8000-000000000006', 'checkin_volunteer', 'event', '50000000-0000-4000-8000-000000000002');
insert into app.rsvps (id, center_id, event_id, household_id, status) values
  ('90000000-0000-4000-8000-000000000011', :jsh, '50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'confirmed'),
  ('90000000-0000-4000-8000-000000000012', :jsh, '50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'confirmed');
insert into app.attendees (center_id, event_id, rsvp_id, person_id, display_name) values
  (:jsh, '50000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000011', '30000000-0000-4000-8000-000000000005', 'Kiran Mehta'),
  (:jsh, '50000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000012', '30000000-0000-4000-8000-000000000001', 'Priya Shah');

-- Read Priya's card number as superuser: a check-in volunteer cannot see people rows.
select member_number as priya_card from app.people where id = '30000000-0000-4000-8000-000000000001' \gset
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000006';  -- check-in volunteer
select pg_temp.assert((select result || '|' || household_name from app.check_in('50000000-0000-4000-8000-000000000002', 'contact_id_88213'))
                      = 'ok|Mehta family', 'an old NamoCRM ticket (contact_id_88213) checks in the family');
select pg_temp.assert((select result from app.check_in('50000000-0000-4000-8000-000000000002', '4374')) = 'ok',
                      'a JSH Connect family QR (Neon ID) checks in the family');
select pg_temp.assert((select result from app.check_in('50000000-0000-4000-8000-000000000002', :'priya_card')) = 'duplicate',
                      'a Connect member card finds the same RSVP (already checked in)');
select pg_temp.assert(not exists (select 1 from app.people where id = '30000000-0000-4000-8000-000000000001'), 'the volunteer still cannot read the scanned family''s records');
commit;
select pg_temp.assert((select count(*) from app.scan_log where matched_via in ('legacy_namocrm','legacy_neon','connect_member')) = 3,
                      'scan log records how each scan was matched');
select pg_temp.assert((select result from app.scan_log where token = 'contact_id_88213') = 'ok', 'legacy scans are logged');


-- missed lunch slot -> any later slot (Mehta family from 01 is checked in at Tapasvi Bahuman)
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';  -- Kiran Mehta, adult of the Mehta household
select pg_temp.assert(app.move_lunch_slot(
  array(select id from app.attendees where display_name = 'Kiran Mehta' and event_id = '50000000-0000-4000-8000-000000000001'),
  (select id from app.lunch_slots where event_id = '50000000-0000-4000-8000-000000000001' order by starts_at offset 4 limit 1)) = 1,
  'a family can move to any later lunch slot');
do $$ begin
  perform app.move_lunch_slot(
    array(select id from app.attendees where display_name = 'Kiran Mehta' and event_id = '50000000-0000-4000-8000-000000000001'),
    (select id from app.lunch_slots where event_id = '50000000-0000-4000-8000-000000000001' order by starts_at limit 1));
  raise exception 'FAIL: moved to an earlier slot';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: moving to an earlier lunch slot is refused';
end $$;
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';  -- Priya, not in the Mehta household
do $$ begin
  perform app.move_lunch_slot(
    array(select id from app.attendees where display_name = 'Kiran Mehta' and event_id = '50000000-0000-4000-8000-000000000001'),
    (select id from app.lunch_slots where event_id = '50000000-0000-4000-8000-000000000001' order by starts_at desc limit 1));
  raise exception 'FAIL: moved another family';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: cannot move another family''s lunch time';
end $$;
commit;

-- bhandar counting needs two counters from different households
do $$ begin
  insert into app.counting_sessions (center_id, kind, counters)
    values ('00000000-0000-4000-8000-000000000001', 'bhandar', array['10000000-0000-4000-8000-000000000003']::uuid[]);
  raise exception 'FAIL: one counter accepted';
exception when check_violation then raise notice 'PASS: bhandar counting refuses a single counter';
end $$;
do $$ begin
  insert into app.counting_sessions (center_id, kind, counters)   -- treasurer + teacher share the staff household
    values ('00000000-0000-4000-8000-000000000001', 'bhandar',
            array['10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004']::uuid[]);
  raise exception 'FAIL: same-household counters accepted';
exception when check_violation then raise notice 'PASS: bhandar counters must be from different households';
end $$;
insert into app.counting_sessions (center_id, kind, counters)
  values (:jsh, 'bhandar', array['10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000005']::uuid[]);
select pg_temp.assert(true, 'bhandar counting accepted with counters from two households');

\echo 'PASS: handoff alignment tests'
