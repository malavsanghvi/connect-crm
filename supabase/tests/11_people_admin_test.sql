-- People module actions (0030): add person, own household, move, tier change, merges.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
\set jsh '''00000000-0000-4000-8000-000000000001'''

-- Staff: a membership coordinator (people.manage + people.approve) and a privacy officer (people.view only).
insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000301', 'coordinator-0030@example.com'),
  ('10000000-0000-4000-8000-000000000302', 'privacy-0030@example.com'),
  ('10000000-0000-4000-8000-000000000303', 'member-0030@example.com');
insert into app.people (id, center_id, first_name, last_name) values
  ('30000000-0000-4000-8000-000000000301', :jsh, 'Mona', 'Coordinator'),
  ('30000000-0000-4000-8000-000000000302', :jsh, 'Pia', 'Privacy');
-- A family: Shah (Priya primary, Rahul spouse, Dev child), a second family Vora, and duplicates.
insert into app.households (id, center_id, display_name) values
  ('20000000-0000-4000-8000-000000000301', :jsh, 'Shah 0030'),
  ('20000000-0000-4000-8000-000000000302', :jsh, 'Vora 0030'),
  ('20000000-0000-4000-8000-000000000303', :jsh, 'Vora 0030 (duplicate)');
insert into app.people (id, center_id, first_name, last_name, date_of_birth, email) values
  ('30000000-0000-4000-8000-000000000311', :jsh, 'Priya', 'Shah0030', '1985-03-14', 'priya0030@example.com'),
  ('30000000-0000-4000-8000-000000000312', :jsh, 'Rahul', 'Shah0030', '1983-01-02', null),
  ('30000000-0000-4000-8000-000000000313', :jsh, 'Dev', 'Shah0030', (current_date - interval '14 years')::date, null),
  ('30000000-0000-4000-8000-000000000314', :jsh, 'Hetal', 'Vora0030', '1980-05-05', null),
  ('30000000-0000-4000-8000-000000000315', :jsh, 'Hetal', 'Vora0030', null, 'hetal0030@example.com'),
  ('30000000-0000-4000-8000-000000000316', :jsh, 'Kiran', 'Vora0030', '1990-01-01', null);
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  ('20000000-0000-4000-8000-000000000301', '30000000-0000-4000-8000-000000000311', :jsh, 'primary', true),
  ('20000000-0000-4000-8000-000000000301', '30000000-0000-4000-8000-000000000312', :jsh, 'spouse', false),
  ('20000000-0000-4000-8000-000000000301', '30000000-0000-4000-8000-000000000313', :jsh, 'child', false),
  ('20000000-0000-4000-8000-000000000302', '30000000-0000-4000-8000-000000000314', :jsh, 'primary', true),
  ('20000000-0000-4000-8000-000000000303', '30000000-0000-4000-8000-000000000315', :jsh, 'primary', true),
  ('20000000-0000-4000-8000-000000000303', '30000000-0000-4000-8000-000000000316', :jsh, 'spouse', false);
insert into app.center_users (center_id, user_id, person_id) values
  (:jsh, '10000000-0000-4000-8000-000000000301', '30000000-0000-4000-8000-000000000301'),
  (:jsh, '10000000-0000-4000-8000-000000000302', '30000000-0000-4000-8000-000000000302'),
  (:jsh, '10000000-0000-4000-8000-000000000303', '30000000-0000-4000-8000-000000000315');
insert into app.role_grants (center_id, user_id, role_key) values
  (:jsh, '10000000-0000-4000-8000-000000000301', 'membership_coordinator'),
  (:jsh, '10000000-0000-4000-8000-000000000302', 'privacy_officer');
insert into app.memberships (center_id, household_id, membership_type_id, tier, status, starts_on)
  select :jsh, '20000000-0000-4000-8000-000000000301', id, 'yearly', 'active', date '2025-01-01'
  from app.membership_types where center_id = :jsh and tier = 'yearly' limit 1;
insert into app.merge_candidates (id, center_id, kind, left_id, right_id, score) values
  ('f5000000-0000-4000-8000-000000000301', :jsh, 'person', '30000000-0000-4000-8000-000000000314', '30000000-0000-4000-8000-000000000315', 0.9),
  ('f5000000-0000-4000-8000-000000000302', :jsh, 'household', '20000000-0000-4000-8000-000000000302', '20000000-0000-4000-8000-000000000303', 0.8);

-- A people.view-only role cannot add people.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000302';
do $$ begin
  perform app.staff_add_person('20000000-0000-4000-8000-000000000301', 'Anya', 'Shah0030', 'child');
  raise exception 'FAIL: privacy officer added a person';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if sqlerrm not like '%people.manage%' then raise exception 'FAIL: unexpected refusal: %', sqlerrm; end if;
  raise notice 'PASS: adding a person needs people.manage';
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000301';

-- Add a person.
select app.staff_add_person('20000000-0000-4000-8000-000000000301', 'Anya', 'Shah0030', 'child', (current_date - interval '9 years')::date, 'female') as anya \gset
select pg_temp.assert((select role::text || ':' || is_primary::text from app.household_members
                       where household_id = '20000000-0000-4000-8000-000000000301' and person_id = :'anya') = 'child:false',
                      'staff add a child to a household');
do $$ begin
  perform app.staff_add_person('20000000-0000-4000-8000-000000000301', 'Second', 'Primary', 'primary');
  raise exception 'FAIL: added a second primary';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: a new person cannot be added as the primary member';
end $$;

-- Make primary of own household: an adult, not already primary.
do $$ begin
  perform app.make_primary_of_own_household('30000000-0000-4000-8000-000000000313');
  raise exception 'FAIL: a minor became a primary member';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: a minor cannot be primary of their own household';
end $$;
do $$ begin
  perform app.make_primary_of_own_household('30000000-0000-4000-8000-000000000311');
  raise exception 'FAIL: an existing primary got a second household';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: someone already primary is refused';
end $$;
select app.make_primary_of_own_household('30000000-0000-4000-8000-000000000312') as rahul_hh \gset
select pg_temp.assert((select count(*) from app.household_members where person_id = '30000000-0000-4000-8000-000000000312' and left_at is null) = 2
                      and (select is_primary from app.household_members where household_id = :'rahul_hh' and person_id = '30000000-0000-4000-8000-000000000312')
                      and (select tier::text from app.memberships where household_id = :'rahul_hh' and status = 'active') = 'community'
                      and (select display_name from app.households where id = :'rahul_hh') = 'Shah0030, Rahul',
                      'own household: primary, community membership, and still in the family household');

-- Move a person.
do $$ begin
  perform app.move_person_household('30000000-0000-4000-8000-000000000311', '20000000-0000-4000-8000-000000000301', '20000000-0000-4000-8000-000000000302', 'other');
  raise exception 'FAIL: moved the primary away from a household with members';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: the primary member cannot leave a household that still has members';
end $$;
select app.move_person_household(:'anya', '20000000-0000-4000-8000-000000000301', '20000000-0000-4000-8000-000000000302', 'child');
select pg_temp.assert((select left_at from app.household_members where household_id = '20000000-0000-4000-8000-000000000301' and person_id = :'anya') = current_date
                      and (select left_at is null from app.household_members where household_id = '20000000-0000-4000-8000-000000000302' and person_id = :'anya'),
                      'moving ends the old link and starts the new one');

-- Tier change (people.approve + people.manage) ends the current membership and starts the new tier.
do $$ begin
  perform app.change_household_tier('20000000-0000-4000-8000-000000000301', 'life', '  ');
  raise exception 'FAIL: tier change without a reason';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: a tier change needs a reason';
end $$;
select app.change_household_tier('20000000-0000-4000-8000-000000000301', 'life', 'Paid life fee at the office');
select pg_temp.assert((select string_agg(tier::text || ':' || status::text, ',' order by starts_on, tier) from app.memberships
                       where household_id = '20000000-0000-4000-8000-000000000301') = 'yearly:ended,life:active',
                      'tier change ends yearly and starts life');

-- Merge people: the record that signs in must be kept.
do $$ begin
  perform app.merge_people('30000000-0000-4000-8000-000000000314', '30000000-0000-4000-8000-000000000315', '{}');
  raise exception 'FAIL: merged away the record that signs in';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: the duplicate that signs in to the app is not merged away';
end $$;
do $$ begin
  perform app.merge_people('30000000-0000-4000-8000-000000000315', '30000000-0000-4000-8000-000000000314', array['center_id']);
  raise exception 'FAIL: copied a field outside the allow-list';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: only profile fields can be copied in a merge';
end $$;
select app.merge_people('30000000-0000-4000-8000-000000000315', '30000000-0000-4000-8000-000000000314', array['date_of_birth']);
select pg_temp.assert((select date_of_birth from app.people where id = '30000000-0000-4000-8000-000000000315') = date '1980-05-05'
                      and (select merged_into_id from app.people where id = '30000000-0000-4000-8000-000000000314') = '30000000-0000-4000-8000-000000000315'
                      and (select is_primary and left_at is null from app.household_members
                           where household_id = '20000000-0000-4000-8000-000000000302' and person_id = '30000000-0000-4000-8000-000000000315')
                      and (select status from app.merge_candidates where id = 'f5000000-0000-4000-8000-000000000301') = 'merged',
                      'merge people: fields copied, links moved, duplicate marked merged, candidate resolved');

-- Merge households: members move, the duplicate keeps its history and points to the kept one.
select app.merge_households('20000000-0000-4000-8000-000000000302', '20000000-0000-4000-8000-000000000303');
select pg_temp.assert((select count(*) from app.household_members where household_id = '20000000-0000-4000-8000-000000000303' and left_at is null) = 0
                      and (select role::text || ':' || is_primary::text from app.household_members
                           where household_id = '20000000-0000-4000-8000-000000000302' and person_id = '30000000-0000-4000-8000-000000000316') = 'spouse:false'
                      and (select merged_into_id from app.households where id = '20000000-0000-4000-8000-000000000303') = '20000000-0000-4000-8000-000000000302'
                      and (select status from app.merge_candidates where id = 'f5000000-0000-4000-8000-000000000302') = 'merged',
                      'merge households: members move and the duplicate points to the kept household');
commit;

-- Every change is audited.
select pg_temp.assert((select count(*) from app.audit_log where actor_user_id = '10000000-0000-4000-8000-000000000301'
                       and record_table in ('people','households','household_members','memberships')) >= 10,
                      'people module changes are in the audit log');

\echo 'PASS: people admin tests'
