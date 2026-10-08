-- 0546: member profile details (anniversary, dietary needs, emergency contact) and the
-- per-community dietary options. Who may read and write, what the database refuses in
-- plain English, and what the audit trail keeps and masks.
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
-- Rows a statement changed (an UPDATE that RLS filters away changes none and raises nothing).
create or replace function pg_temp.affected(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin execute stmt; get diagnostics n = row_count; return n; end $$;
create or replace function pg_temp.sign_in(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
\set c1 '''48000000-0000-4000-8000-0000000000c1'''
\set c2 '''48000000-0000-4000-8000-0000000000c2'''
\set mom '''48000000-0000-4000-8000-000000000001'''
\set dad '''48000000-0000-4000-8000-000000000002'''
\set kid '''48000000-0000-4000-8000-000000000003'''
\set stranger '''48000000-0000-4000-8000-000000000004'''
\set outsider '''48000000-0000-4000-8000-000000000005'''
\set staff_view '''48000000-0000-4000-8000-000000000006'''
\set staff_manage '''48000000-0000-4000-8000-000000000007'''
\set staff_none '''48000000-0000-4000-8000-000000000008'''
\set admin '''48000000-0000-4000-8000-000000000009'''
\set p_mom '''48000000-0000-4000-8000-0000000000a1'''
\set p_dad '''48000000-0000-4000-8000-0000000000a2'''
\set p_kid '''48000000-0000-4000-8000-0000000000a3'''
\set p_stranger '''48000000-0000-4000-8000-0000000000a4'''
\set p_outsider '''48000000-0000-4000-8000-0000000000a5'''
\set h1 '''48000000-0000-4000-8000-0000000000b1'''
\set h2 '''48000000-0000-4000-8000-0000000000b2'''

insert into auth.users (id, email) values
  (:mom, 'mom48@example.com'), (:dad, 'dad48@example.com'), (:kid, 'kid48@example.com'), (:stranger, 'stranger48@example.com'),
  (:outsider, 'outsider48@example.com'), (:staff_view, 'sv48@example.com'), (:staff_manage, 'sm48@example.com'),
  (:staff_none, 'sn48@example.com'), (:admin, 'admin48@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, environment) values
  (:c1, 'orbit48', 'Orbit 48 Community', 'O48', 'TX', 'active', 'production'),
  (:c2, 'orbit48b', 'Other 48 Community', 'O48B', 'TX', 'active', 'production');
insert into app.households (id, center_id, display_name) values (:h1, :c1, 'Shah household 48'), (:h2, :c1, 'Mehta household 48');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (:p_mom, :c1, 'Mira', 'Shah', date '1980-01-01'),
  (:p_dad, :c1, 'Rahul', 'Shah', date '1978-05-05'),
  (:p_kid, :c1, 'Anya', 'Shah', (current_date - interval '10 years')::date),
  (:p_stranger, :c1, 'Sonal', 'Mehta', date '1975-03-03'),
  (:p_outsider, :c2, 'Out', 'Sider', date '1970-01-01');
insert into app.household_members (household_id, person_id, center_id, role) values
  (:h1, :p_mom, :c1, 'primary'), (:h1, :p_dad, :c1, 'spouse'), (:h1, :p_kid, :c1, 'child'), (:h2, :p_stranger, :c1, 'primary');
insert into app.center_users (center_id, user_id, person_id) values
  (:c1, :mom, :p_mom), (:c1, :dad, :p_dad), (:c1, :kid, :p_kid), (:c1, :stranger, :p_stranger), (:c2, :outsider, :p_outsider);
insert into app.role_grants (center_id, user_id, role_key) values
  (:c1, :staff_view, 'privacy_officer'),            -- people.view only
  (:c1, :staff_manage, 'membership_coordinator'),   -- people.view + people.manage
  (:c1, :staff_none, 'executive_viewer'),           -- no people permission
  (:c1, :admin, 'center_admin');                    -- settings.manage

-- ── Coverage: mapped to the core people module, audited, RLS on ──────────────
select pg_temp.assert((select count(*) from app.module_tables where table_name in ('person_profile_details', 'dietary_options') and module_key = 'people') = 2,
  'both tables are mapped to the core people module');
select pg_temp.assert((select count(*) from pg_trigger t where not t.tgisinternal and t.tgname in ('audit_person_profile_details', 'audit_dietary_options')
                          and t.tgfoid = 'app.audit_row'::regproc) = 2,
  'both tables have an audit trigger on app.audit_row');
select pg_temp.assert((select bool_and(relrowsecurity) from pg_class where oid in ('app.person_profile_details'::regclass, 'app.dietary_options'::regclass)),
  'row-level security is on for both tables');
select pg_temp.assert(not has_table_privilege('anon', 'app.person_profile_details', 'select') and not has_table_privilege('authenticated', 'app.person_profile_details', 'delete'),
  'anonymous callers read nothing and nobody deletes through the API');

-- ── Dietary options: seeded, readable by members, written by settings.manage ─
select pg_temp.assert((select count(*) from app.dietary_options where center_id = :c1) = 7, 'a new community is seeded with the default dietary options');
select pg_temp.assert((select array_agg(key order by sort, key) from app.dietary_options where center_id = :c1)
                        = array['vegetarian','vegan','jain','gluten_free','nut_allergy','diabetic','other'],
  'the default set is vegetarian, vegan, Jain, gluten-free, nut allergy, diabetic, other (other last)');
select pg_temp.assert((select label from app.dietary_options where center_id = :c1 and key = 'jain') = 'Jain (no root vegetables)', 'the Jain option carries its explanation');

begin;
select pg_temp.sign_in(:mom);
select pg_temp.assert((select count(*) from app.dietary_options where center_id = :c1) = 7, 'a member reads the list');
select pg_temp.assert_raises(format($$insert into app.dietary_options (center_id, key, label) values (%L, 'halal', 'Halal')$$, :c1),
  'row-level security', 'a member cannot add an option');
select pg_temp.assert(pg_temp.affected(format($$update app.dietary_options set label = 'x' where center_id = %L$$, :c1)) = 0, 'a member cannot rename an option');
commit;
begin;
select pg_temp.sign_in(:outsider);
select pg_temp.assert((select count(*) from app.dietary_options where center_id = :c1) = 0, 'a member of another community reads nothing');
commit;
begin;
select pg_temp.sign_in(:staff_view);
select pg_temp.assert((select count(*) from app.dietary_options where center_id = :c1) = 7, 'staff who can see people read the list');
select pg_temp.assert_raises(format($$insert into app.dietary_options (center_id, key, label) values (%L, 'halal', 'Halal')$$, :c1),
  'row-level security', 'staff without settings.manage cannot add an option');
commit;
begin;
select pg_temp.sign_in(:admin);
insert into app.dietary_options (center_id, key, label, sort) values (:c1, 'halal', 'Halal', 50);
select pg_temp.assert((select count(*) from app.dietary_options where center_id = :c1 and key = 'halal' and active) = 1, 'an admin adds an option');
select pg_temp.assert_raises(format($$insert into app.dietary_options (center_id, key, label) values (%L, 'halal', 'Halal again')$$, :c1),
  'duplicate key', 'the same key cannot be added twice');
select pg_temp.assert_raises(format($$insert into app.dietary_options (center_id, key, label) values (%L, 'No Spaces', 'Bad key')$$, :c1),
  'check constraint', 'a key must be lower-case letters, digits and underscores');
update app.dietary_options set active = false where center_id = :c1 and key = 'halal';
select pg_temp.assert((select count(*) from app.dietary_options where center_id = :c1 and key = 'halal' and not active) = 1, 'an admin switches an option off');
commit;
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'dietary_options' and action like 'dietary_options.%') >= 2, 'option changes are audited');

-- ── A member writes their own details ────────────────────────────────────────
begin;
select pg_temp.sign_in(:mom);
-- The caller may name any center_id: the row is pinned to the person's own community.
insert into app.person_profile_details (person_id, center_id, anniversary, dietary, dietary_other, emergency_contact_name, emergency_contact_relationship, emergency_contact_phone)
  values (:p_mom, :c2, date '2008-02-14', array['jain','nut_allergy','jain','other'], '  no mushrooms  ', '  Kiran Shah  ', 'Sister', '+17135550142');
select pg_temp.assert((select center_id = :c1 from app.person_profile_details where person_id = :p_mom), 'the row always belongs to the person''s own community, whatever the caller sent');
select pg_temp.assert((select dietary = array['jain','nut_allergy','other'] from app.person_profile_details where person_id = :p_mom), 'each dietary choice is kept once, in the order given');
select pg_temp.assert((select dietary_other = 'no mushrooms' and emergency_contact_name = 'Kiran Shah' from app.person_profile_details where person_id = :p_mom), 'text is trimmed');
select pg_temp.assert((select updated_by = :mom and created_at is not null from app.person_profile_details where person_id = :p_mom), 'who saved it is stamped');
-- Saving again (an upsert) changes the same row.
insert into app.person_profile_details (person_id, center_id, anniversary, dietary)
  values (:p_mom, :c1, date '2008-02-14', array['vegetarian'])
  on conflict (person_id) do update set dietary = excluded.dietary, anniversary = excluded.anniversary,
    dietary_other = null, emergency_contact_name = null, emergency_contact_relationship = null, emergency_contact_phone = null;
select pg_temp.assert((select count(*) from app.person_profile_details where person_id = :p_mom) = 1
                        and (select dietary = array['vegetarian'] and emergency_contact_phone is null from app.person_profile_details where person_id = :p_mom),
  'saving again updates the one row and an emptied emergency contact is cleared');
-- 0594: the person's own path (their community is a Jain Center): an active path of the category, optional.
select pg_temp.assert((select path_key is null from app.person_profile_details where person_id = :p_mom), '0594: a path is optional (nothing stored until chosen)');
select pg_temp.assert_raises(format($$update app.person_profile_details set path_key = 'not_a_path' where person_id = %L$$, :p_mom),
  'not one of the paths this community offers', '0594: a path that is not on the community''s list is refused in plain English');
select pg_temp.assert(pg_temp.affected(format($$update app.person_profile_details set path_key = 'digambar' where person_id = %L$$, :p_mom)) = 1,
  '0594: a path of the community''s category is saved');
select pg_temp.assert((select path_key = 'digambar' from app.person_profile_details where person_id = :p_mom), '0594: and read back');
commit;

-- ── The adults of a household read and write each other's and the children's rows ─
begin;
select pg_temp.sign_in(:mom);
insert into app.person_profile_details (person_id, center_id, dietary, emergency_contact_name, emergency_contact_relationship, emergency_contact_phone)
  values (:p_kid, :c1, array['nut_allergy'], 'Kiran Shah', 'Aunt', '+17135550142');
select pg_temp.assert((select count(*) from app.person_profile_details where person_id = :p_kid) = 1, 'a parent writes a child''s details');
insert into app.person_profile_details (person_id, center_id, dietary) values (:p_dad, :c1, array['vegan']);
select pg_temp.assert((select count(*) from app.person_profile_details where person_id = :p_dad) = 1, 'an adult writes another adult of the household');
select pg_temp.assert_raises(format($$insert into app.person_profile_details (person_id, center_id, dietary) values (%L, %L, array['vegan'])$$, :p_kid, :c1),
  'duplicate key', 'the child already has a row (one row per person)');
commit;
-- A parent cannot record an anniversary for a child.
begin;
select pg_temp.sign_in(:mom);
select pg_temp.assert_raises(format($$update app.person_profile_details set anniversary = date '2010-01-01' where person_id = %L$$, :p_kid),
  'only be recorded for an adult', 'an anniversary cannot be recorded for a child');
commit;
begin;
select pg_temp.sign_in(:dad);
select pg_temp.assert((select count(*) from app.person_profile_details where person_id in (:p_mom, :p_kid, :p_dad)) = 3, 'an adult of the household reads every member''s details');
select pg_temp.assert(pg_temp.affected(format($$update app.person_profile_details set dietary = array['jain'] where person_id = %L$$, :p_mom)) = 1, 'and updates them');
commit;

-- ── A child reads their own row but never writes, and sees nobody else's ─────
begin;
select pg_temp.sign_in(:kid);
select pg_temp.assert((select count(*) from app.person_profile_details where person_id = :p_kid) = 1, 'a child reads their own details');
select pg_temp.assert((select count(*) from app.person_profile_details where person_id in (:p_mom, :p_dad)) = 0, 'a child does not read their parents'' details');
select pg_temp.assert(pg_temp.affected(format($$update app.person_profile_details set dietary = array['vegan'] where person_id = %L$$, :p_kid)) = 0,
  'a child''s own login cannot change their details (a parent writes them)');
select pg_temp.assert(pg_temp.affected(format($$update app.person_profile_details set dietary = array['vegan'] where person_id = %L$$, :p_mom)) = 0, 'a child cannot change a parent''s details');
commit;
delete from app.person_profile_details where person_id = :p_kid;
begin;
select pg_temp.sign_in(:kid);
select pg_temp.assert_raises(format($$insert into app.person_profile_details (person_id, center_id, dietary) values (%L, %L, array['vegan'])$$, :p_kid, :c1),
  'row-level security', 'a child cannot create their own details row');
commit;

-- ── Other households and other communities see nothing ───────────────────────
begin;
select pg_temp.sign_in(:stranger);
select pg_temp.assert((select count(*) from app.person_profile_details where center_id = :c1) = 0, 'an adult of another household reads nothing');
select pg_temp.assert(pg_temp.affected(format($$update app.person_profile_details set dietary = array['vegan'] where person_id = %L$$, :p_mom)) = 0, 'and changes nothing');
select pg_temp.assert_raises(format($$insert into app.person_profile_details (person_id, center_id, dietary) values (%L, %L, array['vegan'])$$, :p_kid, :c1),
  'row-level security', 'and cannot write a child that is not theirs');
commit;
begin;
select pg_temp.sign_in(:outsider);
select pg_temp.assert((select count(*) from app.person_profile_details) = 0, 'a member of another community reads nothing');
select pg_temp.assert_raises(format($$insert into app.person_profile_details (person_id, center_id, dietary) values (%L, %L, array['vegan'])$$, :p_mom, :c2),
  'row-level security', 'and cannot write into this community by naming their own center');
commit;

-- ── Staff: people.view / people.manage read, nobody writes ───────────────────
begin;
select pg_temp.sign_in(:staff_view);
select pg_temp.assert((select count(*) from app.person_profile_details where center_id = :c1) = 2, 'staff with people.view read the details');
select pg_temp.assert(pg_temp.affected(format($$update app.person_profile_details set dietary = array['vegan'] where person_id = %L$$, :p_mom)) = 0, 'and cannot change them');
select pg_temp.assert_raises(format($$insert into app.person_profile_details (person_id, center_id, dietary) values (%L, %L, array['vegan'])$$, :p_stranger, :c1),
  'row-level security', 'and cannot add a row');
commit;
begin;
select pg_temp.sign_in(:staff_manage);
select pg_temp.assert((select count(*) from app.person_profile_details where center_id = :c1) = 2, 'staff with people.manage read the details');
select pg_temp.assert(pg_temp.affected(format($$update app.person_profile_details set dietary = array['vegan'] where person_id = %L$$, :p_mom)) = 0, 'and do not write them either (the details are the member''s own to give)');
commit;
begin;
select pg_temp.sign_in(:staff_none);
select pg_temp.assert((select count(*) from app.person_profile_details where center_id = :c1) = 0, 'staff without a people permission read nothing');
commit;

-- ── What the database refuses, in plain English ──────────────────────────────
begin;
select pg_temp.sign_in(:mom);
select pg_temp.assert_raises(format($$update app.person_profile_details set emergency_contact_name = 'Kiran', emergency_contact_phone = '713 555 0142' where person_id = %L$$, :p_mom),
  'country code', 'an emergency number must include the country code');
select pg_temp.assert_raises(format($$update app.person_profile_details set emergency_contact_name = 'Kiran' where person_id = %L$$, :p_mom),
  'needs both a name and a mobile number', 'a name without a number is refused');
select pg_temp.assert_raises(format($$update app.person_profile_details set emergency_contact_phone = '+17135550142' where person_id = %L$$, :p_mom),
  'needs both a name and a mobile number', 'a number without a name is refused');
select pg_temp.assert_raises(format($$update app.person_profile_details set emergency_contact_relationship = 'Sister' where person_id = %L$$, :p_mom),
  'needs both a name and a mobile number', 'a relationship with no contact is refused');
select pg_temp.assert_raises(format($$update app.person_profile_details set dietary_other = 'only mild spice' where person_id = %L$$, :p_mom),
  'Choose "Other"', 'a free-text dietary note needs the Other choice');
select pg_temp.assert_raises(format($$update app.person_profile_details set anniversary = current_date + 1 where person_id = %L$$, :p_mom),
  'cannot be in the future', 'an anniversary in the future is refused');
select pg_temp.assert_raises(format($$update app.person_profile_details set anniversary = date '1970-01-01' where person_id = %L$$, :p_mom),
  'after the birth date', 'an anniversary before the birth date is refused');
select pg_temp.assert_raises(format($$update app.person_profile_details set dietary = array['Not A Key'] where person_id = %L$$, :p_mom),
  'check constraint', 'a malformed dietary key is refused');
select pg_temp.assert_raises(format($$update app.person_profile_details set person_id = %L where person_id = %L$$, :p_dad, :p_mom),
  'cannot be moved', 'a row cannot be moved to another person');
select pg_temp.assert(pg_temp.affected(format($$update app.person_profile_details set dietary = array['vegetarian','diabetic'], dietary_other = null where person_id = %L$$, :p_mom)) = 1,
  'an update that breaks no rule goes through');
commit;
select pg_temp.assert_raises($$insert into app.person_profile_details (person_id, center_id) values ('48000000-0000-4000-8000-0000000000ff', '48000000-0000-4000-8000-0000000000c1')$$,
  'person was not found', 'a row for a person who does not exist is refused');

-- ── Audit: recorded, values masked ───────────────────────────────────────────
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'person_profile_details' and record_id = '48000000-0000-4000-8000-0000000000a1') >= 2,
  'writes to the details are audited, keyed by the person');
select pg_temp.assert((select bool_and(after->>'emergency_contact_phone' is null or after->>'emergency_contact_phone' = '***')
                          and bool_and(after->>'emergency_contact_name' is null or after->>'emergency_contact_name' = '***')
                          and bool_and(after->>'dietary_other' is null or after->>'dietary_other' = '***')
                          and bool_and(coalesce(after->>'dietary', '***') in ('***', '[]'))
                          and bool_and(before->>'emergency_contact_phone' is null or before->>'emergency_contact_phone' = '***')
                         from app.audit_log where record_table = 'person_profile_details'),
  'the audit trail masks the emergency contact and the dietary values');
select pg_temp.assert((select bool_or(after->>'anniversary' = '2008-02-14') from app.audit_log where record_table = 'person_profile_details' and action = 'person_profile_details.insert'),
  'the audit trail still shows the non-sensitive fields (the anniversary)');
select pg_temp.assert((select bool_or(after->>'emergency_contact_phone' = '***') from app.audit_log where record_table = 'person_profile_details' and action = 'person_profile_details.insert'),
  'a masked value still shows that one was given');
select pg_temp.assert(app.audit_mask('{"date_of_birth":"1980-01-01","provider_ref":"x","token":"t"}'::jsonb) = '{"date_of_birth":"***","token":"***"}'::jsonb,
  'the earlier masks still apply');
select pg_temp.assert(exists (select 1 from app.audit_log where record_table = 'person_profile_details' and after->>'path_key' = '***')
                      and not exists (select 1 from app.audit_log where record_table = 'person_profile_details'
                                         and (after->>'path_key' not in ('***') or before->>'path_key' not in ('***'))),
  '0594: the audit trail records that a path changed, never which one');
select pg_temp.assert(app.audit_mask('{"dietary":[],"emergency_contact_name":null}'::jsonb) = '{"dietary":[],"emergency_contact_name":null}'::jsonb,
  'an empty value stays empty so a clear still reads as a change');

-- ── A sandbox reset keeps the dietary choices but clears member rows ─────────
select pg_temp.assert('dietary_options' = any (app.demo_keep_tables()) and not ('person_profile_details' = any (app.demo_keep_tables())),
  'a reset keeps the community''s dietary choices and clears members'' own details');
select pg_temp.assert('dietary_options' <> all (app.demo_clear_tables()) and 'person_profile_details' = any (app.demo_clear_tables()),
  'and the clear plan agrees');
select pg_temp.assert(app.demo_keep_tables() @> array['message_templates','receipt_templates','golive_approvals','audit_log','jobs','center_modules'],
  'the rest of the keep list is unchanged');

-- ── A person's removal takes their details with it ───────────────────────────
delete from app.people where id = :p_dad;
select pg_temp.assert((select count(*) from app.person_profile_details where person_id = :p_dad) = 0, 'deleting a person deletes their details');
