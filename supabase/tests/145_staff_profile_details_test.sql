-- 0723: app.staff_save_profile_details (People redesign, the person slide-over: staff change a member's anniversary, dietary
-- needs and emergency contact).
--   A. Who may call it: people.manage in the person's own community only. People.view alone, a plain member, a manager of another
--      community, nobody signed in, the public key, the service key and the background worker are refused; an unknown person is
--      refused the same way as a person elsewhere; a merged record is refused; nothing changes when refused
--   B. What it writes: each of the three groups, set and cleared; the row is created when none; a key that is absent is left alone;
--      one row per person; a child may have dietary needs and an emergency contact
--   C. The shape of the request: an unknown key, nothing to change, a dietary choice the community does not offer, text that is
--      too long, a date written the wrong way: each refused with a plain sentence and nothing written
--   D. The check trigger's sentences come through unchanged (future anniversary, an anniversary for a child or before the birth
--      date, a contact without a mobile number, a mobile without its country code, a note without "Other")
--   E. The audit entry: who, the reason (given, or "Updated by staff"), the sensitive values masked, no entry for a save that
--      changes nothing
--   F. The member's own way in is untouched: they read and change their own row; staff still read
--   G. Privileges and the activity allowlist
-- Names are from several cultures, and the dietary note and one dietary choice are not in the Latin alphabet.
-- Everything runs in one transaction that is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
-- Runs a statement that must fail with a message containing `expect`.
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
-- The number of rows a statement changed (a data-changing statement cannot sit inside a select).
create or replace function pg_temp.affected(stmt text) returns integer language plpgsql as $$
declare n integer;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;
-- Sign in as a user (claims and role) for the statements that follow; as_none() signs out again.
create or replace function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.headers', '', true);
  set local role authenticated;
end $$;
create or replace function pg_temp.as_none() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.headers', '', true);
end $$;
-- The details row of a person, as text, for "nothing changed" checks (read as the table owner).
create or replace function pg_temp.row_of(p_person uuid) returns text language sql stable as $$
  select coalesce((select to_jsonb(d) - 'updated_at' - 'created_at' - 'updated_by' from app.person_profile_details d where d.person_id = p_person)::text, 'no row')
$$;
create or replace function pg_temp.audits(p_person uuid) returns bigint language sql stable as $$
  select count(*) from app.audit_log where record_table = 'person_profile_details' and record_id = p_person::text
$$;

\set ca '''14500000-0000-4000-8000-0000000000c1'''
\set cb '''14500000-0000-4000-8000-0000000000c2'''
\set u_staff '''14500000-0000-4000-8000-0000000000a1'''
\set u_viewer '''14500000-0000-4000-8000-0000000000a2'''
\set u_member '''14500000-0000-4000-8000-0000000000a3'''
\set u_other '''14500000-0000-4000-8000-0000000000a4'''
\set p_ming '''14500000-0000-4000-8000-0000000000d1'''
\set p_nia '''14500000-0000-4000-8000-0000000000d2'''
\set p_zoya '''14500000-0000-4000-8000-0000000000d3'''
\set p_old '''14500000-0000-4000-8000-0000000000d4'''
\set p_bea '''14500000-0000-4000-8000-0000000000d5'''
\set p_ghost '''14500000-0000-4000-8000-0000000000dd'''

-- ── Fixtures: a neighbourhood association and a second community ──────────────────
select pg_temp.as_none();
insert into auth.users (id, email) values
  (:u_staff, 'staff145@example.com'), (:u_viewer, 'viewer145@example.com'), (:u_member, 'member145@example.com'), (:u_other, 'other145@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:ca, 'riv145', 'Riverside Neighbours 145', 'RN145', 'TX', 'active', 'America/Chicago'),
  (:cb, 'har145', 'Harbour Club 145', 'HC145', 'CA', 'active', 'America/Los_Angeles');
-- Riverside's staff: a coordinator (people.view and people.manage), a privacy officer (people.view only). Harbour has its own.
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:ca, :u_staff, 'membership_coordinator', 'center', 'test 145'),
  (:ca, :u_viewer, 'privacy_officer', 'center', 'test 145'),
  (:cb, :u_other, 'membership_coordinator', 'center', 'test 145');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (:p_ming, :ca, '明', '李', date '1980-05-05'),
  (:p_nia, :ca, 'Nia', 'Okafor', date '1985-03-03'),
  (:p_zoya, :ca, 'Zoya', 'Haddad', (current_date - interval '9 years')::date),
  (:p_old, :ca, 'Old', 'Record145', date '1950-01-01'),
  (:p_bea, :cb, 'Bea', 'Brandt', date '1988-09-07');
update app.people set merged_into_id = :p_ming where id = :p_old;
insert into app.center_users (center_id, user_id, person_id) values (:ca, :u_member, :p_nia);
-- Riverside offers the seeded dietary list, plus a choice with a name in Arabic, and a choice that was switched off.
insert into app.dietary_options (center_id, key, label, sort, active) values
  (:ca, 'halal', 'حلال', 20, true),
  (:ca, 'dairy_free', 'Dairy-free', 21, false);
-- Nia already has a details row of her own (the member's way in), with a switched-off choice and an emergency contact.
insert into app.person_profile_details (person_id, center_id, dietary, emergency_contact_name, emergency_contact_relationship, emergency_contact_phone)
  values (:p_nia, :ca, '{dairy_free,vegan}', 'Chidi Okafor', 'Brother', '+2348012345678');

select pg_temp.row_of(:p_nia) as nia_before \gset
select pg_temp.row_of(:p_bea) as bea_before \gset

-- ── A. Who may call it ───────────────────────────────────────────────────────────────
select pg_temp.as_user(:u_viewer);
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', '{"dietary": ["vegan"]}')$q$,
  'needs the people.manage permission', 'A · staff with people.view only cannot change the details');
select pg_temp.as_user(:u_member);
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d2', '{"dietary": ["vegan"]}')$q$,
  'needs the people.manage permission', 'A · a plain member cannot call it, not even for themselves (their own way in is the app)');
select pg_temp.as_user(:u_other);
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', '{"dietary": ["vegan"]}')$q$,
  'needs the people.manage permission', 'A · a manager of another community cannot change a person here');
select pg_temp.as_user(:u_staff);
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d5', '{"dietary": ["vegan"]}')$q$,
  'needs the people.manage permission', 'A · nor can Riverside''s coordinator change a person of Harbour Club');
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000dd', '{"dietary": ["vegan"]}')$q$,
  'needs the people.manage permission', 'A · a person who does not exist gets the same answer (nothing to learn about who exists)');
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d4', '{"dietary": ["vegan"]}')$q$,
  'merged into another person', 'A · a record that was merged into another person is refused, with the way forward');
select pg_temp.as_none();
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', '{"dietary": ["vegan"]}')$q$,
  'sign in', 'A · nobody signed in: refused');
set local role anon;
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', '{"dietary": ["vegan"]}')$q$,
  'permission denied', 'A · the public key cannot run it');
reset role;
set local role service_role;
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', '{"dietary": ["vegan"]}')$q$,
  'permission denied', 'A · the service key cannot run it');
reset role;
set local role connect_worker;
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', '{"dietary": ["vegan"]}')$q$,
  'permission denied', 'A · the background worker cannot run it');
reset role;
select pg_temp.assert(pg_temp.row_of(:p_ming) = 'no row' and pg_temp.row_of(:p_nia) = :'nia_before' and pg_temp.row_of(:p_bea) = :'bea_before'
                      and pg_temp.audits(:p_ming) = 0,
  'A · every refused call changed nothing and wrote no audit entry');

-- ── B. What it writes ────────────────────────────────────────────────────────────────
select pg_temp.as_user(:u_staff);
-- B1. A group at a time, on a person with no row: the row is created.
select app.staff_save_profile_details(:p_ming, '{"anniversary": "2009-06-20"}');
select pg_temp.as_none();
select pg_temp.assert((select d.anniversary = date '2009-06-20' and d.dietary = '{}' and d.dietary_other is null and d.emergency_contact_name is null
                              and d.center_id = :ca and d.updated_by = :u_staff
                         from app.person_profile_details d where d.person_id = :p_ming),
  'B · the anniversary alone creates the row, in the person''s own community, stamped with who changed it');
select pg_temp.as_user(:u_staff);
-- B2. Dietary needs, with a note in Japanese under Other; the anniversary is not in the patch, so it stays.
select app.staff_save_profile_details(:p_ming, jsonb_build_object('dietary', jsonb_build_array('halal', 'other'), 'dietary_other', 'エビ・カニにアレルギーがあります'));
select pg_temp.as_none();
select pg_temp.assert((select d.dietary = '{halal,other}' and d.dietary_other = 'エビ・カニにアレルギーがあります' and d.anniversary = date '2009-06-20'
                         from app.person_profile_details d where d.person_id = :p_ming),
  'B · dietary needs and a note in Japanese are saved in the order given; the anniversary, absent from the patch, is left alone');
select pg_temp.as_user(:u_staff);
-- B3. The emergency contact as one unit.
select app.staff_save_profile_details(:p_ming, '{"emergency_contact_name": "  田中 健 ", "emergency_contact_relationship": "Brother", "emergency_contact_phone": "+81398765432"}');
select pg_temp.as_none();
select pg_temp.assert((select d.emergency_contact_name = '田中 健' and d.emergency_contact_relationship = 'Brother' and d.emergency_contact_phone = '+81398765432'
                              and d.dietary = '{halal,other}'
                         from app.person_profile_details d where d.person_id = :p_ming),
  'B · the emergency contact is saved together (the name trimmed) and leaves the rest alone');
select pg_temp.as_user(:u_staff);
-- B4. One part of the contact on its own, while the rest of it stays.
select app.staff_save_profile_details(:p_ming, '{"emergency_contact_phone": "+81311112222", "emergency_contact_relationship": null}');
select pg_temp.as_none();
select pg_temp.assert((select d.emergency_contact_name = '田中 健' and d.emergency_contact_relationship is null and d.emergency_contact_phone = '+81311112222'
                         from app.person_profile_details d where d.person_id = :p_ming),
  'B · a new mobile number and a cleared relationship change those two and keep the name');
select pg_temp.as_user(:u_staff);
-- B5. Clearing: null empties each group.
select app.staff_save_profile_details(:p_ming, '{"anniversary": null}');
select app.staff_save_profile_details(:p_ming, '{"dietary": null, "dietary_other": null}');
select app.staff_save_profile_details(:p_ming, '{"emergency_contact_name": null, "emergency_contact_relationship": null, "emergency_contact_phone": null}');
select pg_temp.as_none();
select pg_temp.assert((select d.anniversary is null and d.dietary = '{}' and d.dietary_other is null and d.emergency_contact_name is null
                              and d.emergency_contact_relationship is null and d.emergency_contact_phone is null
                         from app.person_profile_details d where d.person_id = :p_ming)
                      and (select count(*) from app.person_profile_details where person_id = :p_ming) = 1,
  'B · null clears the anniversary, the dietary needs with their note, and the whole emergency contact; still one row for the person');
-- B6. A switched-off choice a person already has stays; a new one cannot be added; other people's rows are not touched.
select pg_temp.as_user(:u_staff);
select app.staff_save_profile_details(:p_nia, '{"dietary": ["dairy_free", "vegan", "halal"]}');
select pg_temp.as_none();
select pg_temp.assert((select d.dietary = '{dairy_free,vegan,halal}' and d.emergency_contact_name = 'Chidi Okafor' from app.person_profile_details d where d.person_id = :p_nia),
  'B · a choice the community switched off stays on a person who has it, and the rest of their row is kept');
select pg_temp.assert(pg_temp.row_of(:p_bea) = :'bea_before', 'B · another community''s person was not touched');
-- B7. A child: dietary needs and an emergency contact are allowed (an allergy matters).
select pg_temp.as_user(:u_staff);
select app.staff_save_profile_details(:p_zoya, '{"dietary": ["nut_allergy"], "emergency_contact_name": "Layla Haddad", "emergency_contact_relationship": "Mother", "emergency_contact_phone": "+17135550100"}');
select pg_temp.as_none();
select pg_temp.assert((select d.dietary = '{nut_allergy}' and d.emergency_contact_name = 'Layla Haddad' and d.anniversary is null from app.person_profile_details d where d.person_id = :p_zoya),
  'B · a child''s dietary needs and emergency contact are saved');

-- ── C. The shape of the request ──────────────────────────────────────────────────────
select pg_temp.row_of(:p_ming) as ming_empty \gset
select pg_temp.audits(:p_ming) as ming_audits \gset
select pg_temp.as_user(:u_staff);
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', '{"center_id": "14500000-0000-4000-8000-0000000000c2"}')$q$,
  'cannot be changed here', 'C · a key that is not one of the six is refused (the community cannot be named)');
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', '{"person_id": "14500000-0000-4000-8000-0000000000d2"}')$q$,
  'cannot be changed here', 'C · nor can the row be moved to another person');
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', '{"dietary": ["vegan"], "updated_by": "x"}')$q$,
  'cannot be changed here', 'C · one unknown key refuses the whole request, even beside good ones');
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', '{}')$q$, 'nothing to change', 'C · an empty patch is refused');
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', null)$q$, 'nothing to change', 'C · no patch is refused');
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', '["vegan"]')$q$, 'nothing to change', 'C · a patch that is not an object is refused');
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', '{"dietary": ["pizza"]}')$q$,
  'not on this community''s list', 'C · a dietary choice the community does not offer is refused');
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', '{"dietary": ["dairy_free"]}')$q$,
  'not on this community''s list', 'C · a switched-off choice cannot be newly added');
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', '{"dietary": ["Vegan; drop table"]}')$q$,
  'not on this community''s list', 'C · a dietary choice that is not a key is refused');
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', '{"dietary": "vegan"}')$q$,
  'list of choices', 'C · dietary needs have to be a list');
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', '{"dietary": [1]}')$q$,
  'list of choices', 'C · a list of numbers is refused');
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', '{"emergency_contact_name": 7}')$q$,
  'has to be text', 'C · a number where text belongs is refused');
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', '{"anniversary": "06/20/2009"}')$q$,
  'written like 2019-06-02', 'C · a date has to be written year-month-day');
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', '{"anniversary": "today"}')$q$,
  'written like 2019-06-02', 'C · a date word such as today is not a date');
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', '{"anniversary": "2019-02-30"}')$q$,
  'real date', 'C · a day that does not exist is refused');
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', jsonb_build_object('dietary', jsonb_build_array('other'), 'dietary_other', repeat('ก', 201)))$q$,
  'at most 200 characters', 'C · a dietary note over 200 characters is refused in words (counted in characters, not bytes)');
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', jsonb_build_object('emergency_contact_name', repeat('李', 121), 'emergency_contact_phone', '+81311112222'))$q$,
  'at most 120 characters', 'C · a contact name over 120 characters is refused in words');
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', jsonb_build_object('emergency_contact_name', 'Ken', 'emergency_contact_relationship', repeat('x', 61), 'emergency_contact_phone', '+81311112222'))$q$,
  'at most 60 characters', 'C · a relationship over 60 characters is refused in words');
select pg_temp.as_none();
select pg_temp.assert(pg_temp.row_of(:p_ming) = :'ming_empty' and pg_temp.audits(:p_ming) = :ming_audits, 'C · every refused request wrote nothing');

-- ── D. The check trigger's sentences come through ────────────────────────────────────
select pg_temp.as_user(:u_staff);
select pg_temp.assert_raises(format($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', '{"anniversary": "%s"}')$q$, (current_date + 30)::text),
  'cannot be in the future', 'D · an anniversary in the future is refused with the trigger''s sentence');
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', '{"anniversary": "1975-01-01"}')$q$,
  'has to be after the birth date', 'D · an anniversary before the birth date is refused');
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d3', '{"anniversary": "2020-01-01"}')$q$,
  'only be recorded for an adult', 'D · an anniversary for a child is refused');
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', '{"emergency_contact_name": "Ken Tanaka"}')$q$,
  'needs both a name and a mobile number', 'D · a contact without a mobile number is refused');
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', '{"emergency_contact_phone": "+81311112222"}')$q$,
  'needs both a name and a mobile number', 'D · a mobile number without a name is refused');
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', '{"emergency_contact_name": "Ken Tanaka", "emergency_contact_phone": "713 555 0100"}')$q$,
  'must include the country code', 'D · a mobile number without its country code is refused');
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d1', '{"dietary": ["vegan"], "dietary_other": "no peanuts"}')$q$,
  'Choose "Other"', 'D · a note without Other is refused');
select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d2', '{"dietary": ["vegan", "other"], "dietary_other": "no mushrooms"}');
select pg_temp.assert_raises($q$select app.staff_save_profile_details('14500000-0000-4000-8000-0000000000d2', '{"dietary": ["vegan"]}')$q$,
  'Choose "Other"', 'D · taking Other away while its note stays is refused, so the screen clears the note with it');
select pg_temp.as_none();
select pg_temp.assert(pg_temp.row_of(:p_ming) = :'ming_empty' and pg_temp.audits(:p_ming) = :ming_audits, 'D · nothing was written by any refused save');

-- ── E. The audit entry ───────────────────────────────────────────────────────────────
-- Ming's row has been created, changed and cleared by staff above. The first save was made without a reason.
select pg_temp.assert((select a.reason = 'Updated by staff' and a.actor_user_id = :u_staff::uuid and a.action = 'person_profile_details.insert' and a.center_id = :ca::uuid
                         from app.audit_log a where a.record_table = 'person_profile_details' and a.record_id = :p_ming::text order by a.id limit 1),
  'E · the first save is in the audit trail as an insert by the staff member, with the default reason "Updated by staff"');
select pg_temp.as_user(:u_staff);
select app.staff_save_profile_details(:p_ming, '{"dietary": ["vegetarian"]}', '  Undo of dietary needs change  ');
select pg_temp.as_none();
select pg_temp.assert((select a.reason = 'Undo of dietary needs change' and a.actor_user_id = :u_staff::uuid and a.action = 'person_profile_details.update'
                         from app.audit_log a where a.record_table = 'person_profile_details' and a.record_id = :p_ming::text order by a.id desc limit 1),
  'E · a reason given with the save is the reason in the audit trail (trimmed)');
select pg_temp.as_user(:u_staff);
select app.staff_save_profile_details(:p_ming, jsonb_build_object('emergency_contact_name', 'Kofi Mensah', 'emergency_contact_phone', '+233201234567'), 'Called to confirm');
select pg_temp.as_none();
select pg_temp.assert((select a.reason = 'Called to confirm' and a.after->>'emergency_contact_name' = '***' and a.after->>'emergency_contact_phone' = '***'
                              and a.after::text !~ 'Kofi' and a.after::text !~ '233201234567'
                         from app.audit_log a where a.record_table = 'person_profile_details' and a.record_id = :p_ming::text order by a.id desc limit 1),
  'E · the emergency contact''s name and number are masked in the audit trail');
select pg_temp.as_user(:u_staff);
select app.staff_save_profile_details(:p_ming, '{"dietary": ["other"], "dietary_other": "ไม่ทานถั่วลิสง"}');
select pg_temp.as_none();
select pg_temp.assert((select a.after->>'dietary' = '***' and a.after->>'dietary_other' = '***' and a.after::text !~ 'ถั่ว'
                         from app.audit_log a where a.record_table = 'person_profile_details' and a.record_id = :p_ming::text order by a.id desc limit 1),
  'E · the dietary needs and the note (in Thai) are masked in the audit trail');
select pg_temp.audits(:p_ming) as before_noop \gset
select pg_temp.as_user(:u_staff);
select app.staff_save_profile_details(:p_ming, '{"dietary": ["other"], "dietary_other": "ไม่ทานถั่วลิสง"}');
select pg_temp.as_none();
select pg_temp.assert(pg_temp.audits(:p_ming) = :before_noop, 'E · saving what is already there writes no audit entry');
-- A reason sent with the request (the portal''s x-audit-reason header) is used when the call gives none.
select pg_temp.as_user(:u_staff);
-- (Earlier calls in this one transaction left a reason behind; a real request starts clean.)
select set_config('app.audit_reason', '', true);
select set_config('request.headers', '{"x-audit-reason": "Phoned the family"}', true);
select app.staff_save_profile_details(:p_ming, '{"anniversary": "2009-06-20"}');
select pg_temp.as_none();
select pg_temp.assert((select a.reason = 'Phoned the family' from app.audit_log a where a.record_table = 'person_profile_details' and a.record_id = :p_ming::text order by a.id desc limit 1),
  'E · with no reason given, the request''s own reason is kept');

-- ── F. The member's own way in, and what staff can read ──────────────────────────────
select pg_temp.as_user(:u_member);
select pg_temp.assert(pg_temp.affected($q$update app.person_profile_details set dietary = '{vegan}', dietary_other = null where person_id = '14500000-0000-4000-8000-0000000000d2'$q$) = 1,
  'F · a member still changes their own row');
select pg_temp.assert((select count(*) = 1 and bool_and(d.person_id = :p_nia::uuid) from app.person_profile_details d), 'F · and reads only their own row');
select pg_temp.assert(pg_temp.affected($q$update app.person_profile_details set dietary = '{vegan}' where person_id = '14500000-0000-4000-8000-0000000000d1'$q$) = 0,
  'F · but not another person''s (staff changes are made through the function, not by the member path)');
select pg_temp.as_user(:u_staff);
select pg_temp.assert(pg_temp.affected($q$update app.person_profile_details set dietary = '{vegan}' where person_id = '14500000-0000-4000-8000-0000000000d2'$q$) = 0,
  'F · staff still have no write policy on the table: only the function writes for them');
select pg_temp.assert((select count(*) >= 3 from app.person_profile_details), 'F · staff still read the rows of their community');
select pg_temp.as_user(:u_viewer);
select pg_temp.assert((select count(*) >= 3 from app.person_profile_details), 'F · people.view alone still reads the rows');
select pg_temp.as_none();

-- ── G. Privileges and the allowlist ──────────────────────────────────────────────────
select pg_temp.assert(has_function_privilege('authenticated', 'app.staff_save_profile_details(uuid, jsonb, text)', 'execute')
                      and not has_function_privilege('anon', 'app.staff_save_profile_details(uuid, jsonb, text)', 'execute')
                      and not has_function_privilege('service_role', 'app.staff_save_profile_details(uuid, jsonb, text)', 'execute')
                      and not has_function_privilege('connect_worker', 'app.staff_save_profile_details(uuid, jsonb, text)', 'execute'),
  'G · signed-in people can run it (and are then checked inside); the public key, the service key and the worker cannot');
select pg_temp.assert((select p.prosecdef and p.proconfig::text like '%search_path=app, public, extensions%' and p.prosrc like '%assert_module_enabled%'
                              and p.prosrc like '%has_permission(p.center_id, ''people.manage'')%' and p.prorettype = 'void'::regtype
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'staff_save_profile_details'),
  'G · it is security definer with the extensions search path, asks for people.manage and the People module, and returns nothing');
select pg_temp.assert((select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'staff_save_profile_details'),
  'G · there is one function');
select pg_temp.assert(not exists (select 1 from pg_policies where schemaname = 'app' and tablename = 'person_profile_details' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
                                    and (qual like '%people.manage%' or with_check like '%people.manage%')),
  'G · no table policy gives staff a write: the table is unchanged');
select pg_temp.assert(exists (select 1 from app.activity_catalog c where c.key = 'people.save_profile_details' and c.surface = 'portal' and c.commandable_key is null)
                      and not exists (select 1 from app.activity_catalog c where c.key like '%profile_details%' and c.key like 'assistant.%'),
  'G · the screen''s button is in the activity allowlist, and it is not a command (Niva and the palette never get these details)');

rollback;
\echo 'PASS: staff profile details tests'
