-- 0650: app.merge_people_preview and app.merge_households_preview (read-only previews of the two merges).
--   A. People: the counts of what would move, and the same refusals merge_people gives, as plain sentences
--   B. Households: members moving, a second primary becoming "other", what stays on the duplicate
--   C. A people.view-only role is told why; nothing is ever changed; both functions run with the caller's rights
-- Everything runs in one transaction that is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
\set jsh '''00000000-0000-4000-8000-000000000001'''

insert into auth.users (id, email) values
  ('10300000-0000-4000-8000-000000000a01', 'coordinator-0650@example.com'),
  ('10300000-0000-4000-8000-000000000a02', 'privacy-0650@example.com'),
  ('10300000-0000-4000-8000-000000000a03', 'login-e-0650@example.com'),
  ('10300000-0000-4000-8000-000000000a04', 'login-g-0650@example.com');

insert into app.people (id, center_id, first_name, last_name, date_of_birth, email) values
  ('10300000-0000-4000-8000-000000000b01', :jsh, 'Mona', 'Coordinator0650', '1975-01-01', null),
  ('10300000-0000-4000-8000-000000000b02', :jsh, 'Pia', 'Privacy0650', '1976-01-01', null),
  ('10300000-0000-4000-8000-000000000b11', :jsh, 'Asha', 'Keep0650', '1980-05-05', null),                    -- A: kept
  ('10300000-0000-4000-8000-000000000b12', :jsh, 'Asha', 'Keep0650', null, 'asha0650@example.com'),          -- B: the duplicate
  ('10300000-0000-4000-8000-000000000b13', :jsh, 'Ravi', 'Keep0650', '1979-02-02', null),                    -- C: spouse of A and B
  ('10300000-0000-4000-8000-000000000b14', :jsh, 'Eshan', 'Login0650', '1985-03-03', null),                  -- E: signs in
  ('10300000-0000-4000-8000-000000000b15', :jsh, 'Eshan', 'Login0650', null, null),                          -- F: plain duplicate of E
  ('10300000-0000-4000-8000-000000000b16', :jsh, 'Gita', 'Login0650', '1986-04-04', null),                   -- G: also signs in
  ('10300000-0000-4000-8000-000000000b17', :jsh, 'Old', 'Merged0650', '1950-01-01', null);                   -- M: already merged
update app.people set merged_into_id = '10300000-0000-4000-8000-000000000b11' where id = '10300000-0000-4000-8000-000000000b17';

insert into app.households (id, center_id, display_name) values
  ('10300000-0000-4000-8000-000000000c01', :jsh, 'Keep0650'),
  ('10300000-0000-4000-8000-000000000c02', :jsh, 'Keep0650 (duplicate)'),
  ('10300000-0000-4000-8000-000000000c03', :jsh, 'Merged0650');
update app.households set merged_into_id = '10300000-0000-4000-8000-000000000c01' where id = '10300000-0000-4000-8000-000000000c03';
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  ('10300000-0000-4000-8000-000000000c01', '10300000-0000-4000-8000-000000000b11', :jsh, 'primary', true),
  ('10300000-0000-4000-8000-000000000c01', '10300000-0000-4000-8000-000000000b13', :jsh, 'spouse', false),
  ('10300000-0000-4000-8000-000000000c02', '10300000-0000-4000-8000-000000000b12', :jsh, 'primary', true),
  ('10300000-0000-4000-8000-000000000c02', '10300000-0000-4000-8000-000000000b13', :jsh, 'spouse', false);

insert into app.center_users (center_id, user_id, person_id) values
  (:jsh, '10300000-0000-4000-8000-000000000a01', '10300000-0000-4000-8000-000000000b01'),
  (:jsh, '10300000-0000-4000-8000-000000000a02', '10300000-0000-4000-8000-000000000b02'),
  (:jsh, '10300000-0000-4000-8000-000000000a03', '10300000-0000-4000-8000-000000000b14'),
  (:jsh, '10300000-0000-4000-8000-000000000a04', '10300000-0000-4000-8000-000000000b16');
insert into app.role_grants (center_id, user_id, role_key) values
  (:jsh, '10300000-0000-4000-8000-000000000a01', 'membership_coordinator'),
  (:jsh, '10300000-0000-4000-8000-000000000a02', 'privacy_officer');

-- What the duplicate B holds: an identifier and a membership; the duplicate household holds an identifier and the same membership.
insert into app.external_ids (center_id, person_id, kind, system, value, source)
  values (:jsh, '10300000-0000-4000-8000-000000000b12', 'crm', 'neon', 'N-0650-B', 'manual');
insert into app.external_ids (center_id, household_id, kind, system, value, source)
  values (:jsh, '10300000-0000-4000-8000-000000000c02', 'accounting', 'quickbooks', 'QB-0650-H2', 'manual');
insert into app.memberships (center_id, household_id, person_id, membership_type_id, tier, status, starts_on)
  select :jsh, '10300000-0000-4000-8000-000000000c02', '10300000-0000-4000-8000-000000000b12', id, 'yearly', 'active', date '2025-01-01'
  from app.membership_types where center_id = :jsh and tier = 'yearly' limit 1;
insert into app.merge_candidates (id, center_id, kind, left_id, right_id, score) values
  ('10300000-0000-4000-8000-000000000d01', :jsh, 'person', '10300000-0000-4000-8000-000000000b11', '10300000-0000-4000-8000-000000000b12', 0.9),
  ('10300000-0000-4000-8000-000000000d02', :jsh, 'household', '10300000-0000-4000-8000-000000000c01', '10300000-0000-4000-8000-000000000c02', 0.8);

-- ---------------------------------------------------------------------------
-- A coordinator (people.manage) asks
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '10300000-0000-4000-8000-000000000a01';

-- A. People
select app.merge_people_preview('10300000-0000-4000-8000-000000000b11', '10300000-0000-4000-8000-000000000b12', array['date_of_birth']) as pv \gset
select pg_temp.assert((:'pv'::jsonb->>'can_merge')::boolean and jsonb_array_length(:'pv'::jsonb->'blockers') = 0,
                      'two plain duplicates can be merged');
select pg_temp.assert(:'pv'::jsonb->'keep'->>'id' = '10300000-0000-4000-8000-000000000b11'
                      and :'pv'::jsonb->'drop'->>'id' = '10300000-0000-4000-8000-000000000b12',
                      'the preview names the kept record and the duplicate');
select pg_temp.assert((:'pv'::jsonb->'moves'->>'household_links')::int = 1
                      and (:'pv'::jsonb->'moves'->>'external_ids')::int = 1
                      and (:'pv'::jsonb->'moves'->>'memberships')::int = 1
                      and (:'pv'::jsonb->'moves'->>'primary_links')::int = 1
                      and (:'pv'::jsonb->'moves'->>'open_suggestions')::int = 1
                      and (:'pv'::jsonb->'moves'->>'shared_households')::int = 0,
                      'it counts the links, identifiers and memberships that would move');
select pg_temp.assert(:'pv'::jsonb->'fields' = '["date_of_birth"]'::jsonb, 'it echoes the fields taken from the duplicate');

select pg_temp.assert(app.merge_people_preview('10300000-0000-4000-8000-000000000b11', '10300000-0000-4000-8000-000000000b12', array['center_id'])->'blockers'->>0
                        = 'The field "center_id" cannot be copied in a merge',
                      'a field outside the allow-list is refused in plain words');
select pg_temp.assert(app.merge_people_preview('10300000-0000-4000-8000-000000000b11', '10300000-0000-4000-8000-000000000b11')->'blockers'->>0
                        = 'Choose two different records to merge',
                      'a record cannot be merged with itself');
select pg_temp.assert(app.merge_people_preview('10300000-0000-4000-8000-000000000b11', '10300000-0000-4000-8000-0000000000ff')->'blockers'->>0
                        like 'One of the two records was not found%',
                      'a record that does not exist is reported');
select pg_temp.assert(app.merge_people_preview('10300000-0000-4000-8000-000000000b11', '10300000-0000-4000-8000-000000000b17')->'blockers'->>0
                        = 'One of the two records was already merged',
                      'an already merged record is reported');
select pg_temp.assert(app.merge_people_preview('10300000-0000-4000-8000-000000000b11', '10300000-0000-4000-8000-000000000b14')->'blockers'->>0
                        like 'The duplicate signs in to the app.%'
                      and not (app.merge_people_preview('10300000-0000-4000-8000-000000000b11', '10300000-0000-4000-8000-000000000b14')->>'can_merge')::boolean,
                      'the duplicate that signs in is not merged away');
select pg_temp.assert((app.merge_people_preview('10300000-0000-4000-8000-000000000b14', '10300000-0000-4000-8000-000000000b15')->>'can_merge')::boolean,
                      'the record that signs in can be the one kept');
select pg_temp.assert(app.merge_people_preview('10300000-0000-4000-8000-000000000b14', '10300000-0000-4000-8000-000000000b16')->'blockers'->>0
                        like 'Both records sign in to the app%',
                      'two records that both sign in are refused');

-- B. Households
select app.merge_households_preview('10300000-0000-4000-8000-000000000c01', '10300000-0000-4000-8000-000000000c02') as hv \gset
select pg_temp.assert((:'hv'::jsonb->>'can_merge')::boolean, 'two plain duplicate households can be merged');
select pg_temp.assert((:'hv'::jsonb->'moves'->>'members_moving')::int = 2
                      and (:'hv'::jsonb->'moves'->>'already_in_keep')::int = 1
                      and (:'hv'::jsonb->'moves'->>'primary_becomes_other')::int = 1
                      and (:'hv'::jsonb->'moves'->>'household_ids_staying')::int = 1
                      and (:'hv'::jsonb->'moves'->>'active_memberships_staying')::int = 1
                      and (:'hv'::jsonb->'moves'->>'open_suggestions')::int = 1,
                      'it counts members moving, the second primary, and what stays on the duplicate');
select pg_temp.assert(app.merge_households_preview('10300000-0000-4000-8000-000000000c01', '10300000-0000-4000-8000-000000000c01')->'blockers'->>0
                        = 'Choose two different households to merge',
                      'a household cannot be merged with itself');
select pg_temp.assert(app.merge_households_preview('10300000-0000-4000-8000-000000000c01', '10300000-0000-4000-8000-000000000c03')->'blockers'->>0
                        = 'One of the two households was already merged',
                      'an already merged household is reported');

-- C. Nothing changed (and both run with the caller's rights)
select pg_temp.assert((select count(*) from app.people where merged_into_id is not null and id::text like '10300000%') = 1
                      and (select count(*) from app.households where merged_into_id is not null and id::text like '10300000%') = 1
                      and (select count(*) from app.merge_candidates where id::text like '10300000%' and status = 'open') = 2
                      and (select count(*) from app.household_members where household_id = '10300000-0000-4000-8000-000000000c02' and left_at is null) = 2,
                      'previews change nothing');
select pg_temp.assert((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'app' and p.proname in ('merge_people_preview', 'merge_households_preview') and not p.prosecdef and p.provolatile = 's') = 2,
                      'both previews are security invoker and stable');

-- ---------------------------------------------------------------------------
-- A people.view-only role is told why
-- ---------------------------------------------------------------------------
set local request.jwt.claim.sub = '10300000-0000-4000-8000-000000000a02';
select pg_temp.assert(not (app.merge_people_preview('10300000-0000-4000-8000-000000000b11', '10300000-0000-4000-8000-000000000b12')->>'can_merge')::boolean
                      and app.merge_people_preview('10300000-0000-4000-8000-000000000b11', '10300000-0000-4000-8000-000000000b12')->'blockers'->>0
                        = 'Merging records needs the people.manage permission',
                      'merging people needs people.manage, said before anything happens');
select pg_temp.assert(app.merge_households_preview('10300000-0000-4000-8000-000000000c01', '10300000-0000-4000-8000-000000000c02')->'blockers'->>0
                        = 'Merging households needs the people.manage permission',
                      'merging households needs people.manage, said before anything happens');

rollback;
\echo 'PASS: merge previews tests'
