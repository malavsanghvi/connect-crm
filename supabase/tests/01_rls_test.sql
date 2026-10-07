-- Behaviour tests for tenancy, RLS and the core business rules.
-- Runs as superuser for fixtures, then impersonates users with
-- `set local role authenticated` + a JWT sub, exactly like PostgREST.
\set ON_ERROR_STOP 1

create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email, phone) values
  ('10000000-0000-4000-8000-000000000001', 'priya.shah@example.com', '17135550142'),
  ('10000000-0000-4000-8000-000000000002', 'dev.shah@example.com', null),
  ('10000000-0000-4000-8000-000000000003', 'treasurer@example.com', null),
  ('10000000-0000-4000-8000-000000000004', 'teacher@example.com', null),
  ('10000000-0000-4000-8000-000000000005', 'mehta@example.com', null),
  ('10000000-0000-4000-8000-000000000006', 'volunteer@example.com', null),
  ('10000000-0000-4000-8000-000000000007', 'otheradmin@example.com', null);

\set jsh '''00000000-0000-4000-8000-000000000001'''

insert into app.centers (id, slug, name) values ('00000000-0000-4000-8000-000000000002', 'other', 'Other Jain Center');

insert into app.households (id, center_id, display_name) values
  ('20000000-0000-4000-8000-000000000001', :jsh, 'Shah family'),
  ('20000000-0000-4000-8000-000000000002', :jsh, 'Mehta family'),
  ('20000000-0000-4000-8000-000000000003', :jsh, 'Staff household');

insert into app.people (id, center_id, first_name, last_name, email, phone_e164, date_of_birth) values
  ('30000000-0000-4000-8000-000000000001', :jsh, 'Priya', 'Shah', 'priya.shah@example.com', '+17135550142', '1985-03-14'),
  ('30000000-0000-4000-8000-000000000002', :jsh, 'Rahul', 'Shah', 'rahul.shah@example.com', null, '1983-07-02'),
  ('30000000-0000-4000-8000-000000000003', :jsh, 'Dev', 'Shah', 'dev.shah@example.com', null, current_date - interval '14 years'),
  ('30000000-0000-4000-8000-000000000004', :jsh, 'Anya', 'Shah', null, null, current_date - interval '9 years'),
  ('30000000-0000-4000-8000-000000000005', :jsh, 'Kiran', 'Mehta', 'mehta@example.com', null, '1970-01-01'),
  ('30000000-0000-4000-8000-000000000006', :jsh, 'Tara', 'Treasurer', 'treasurer@example.com', null, '1975-01-01'),
  ('30000000-0000-4000-8000-000000000007', :jsh, 'Tej', 'Teacher', 'teacher@example.com', null, '1980-01-01'),
  ('30000000-0000-4000-8000-000000000008', :jsh, 'Vina', 'Volunteer', 'volunteer@example.com', null, '1990-01-01');

insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', :jsh, 'primary', true),
  ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', :jsh, 'spouse', false),
  ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', :jsh, 'child', false),
  ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000004', :jsh, 'child', false),
  ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000005', :jsh, 'primary', true),
  ('20000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000006', :jsh, 'primary', true),
  ('20000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000007', :jsh, 'other', false),
  ('20000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000008', :jsh, 'other', false);

insert into app.center_users (center_id, user_id, person_id) values
  (:jsh, '10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003'),
  (:jsh, '10000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000006'),
  (:jsh, '10000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000007'),
  (:jsh, '10000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000005'),
  (:jsh, '10000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000008');

-- Pathshala: one term, two classes; the teacher teaches class A only.
insert into app.pathshala_terms (id, center_id, name, starts_on, ends_on, status)
  values ('40000000-0000-4000-8000-000000000001', :jsh, '2026-2027', '2026-08-30', '2027-05-30', 'active');
insert into app.pathshala_classes (id, center_id, term_id, level_id, name)
  select '40000000-0000-4000-8000-00000000000a', :jsh, '40000000-0000-4000-8000-000000000001', l.id, 'Jainism 3 – A'
  from app.pathshala_levels l join app.pathshala_tracks t on t.id = l.track_id where t.key = 'jainism' and l.key = '3';
insert into app.pathshala_classes (id, center_id, term_id, level_id, name)
  select '40000000-0000-4000-8000-00000000000b', :jsh, '40000000-0000-4000-8000-000000000001', l.id, 'Jainism 1 – B'
  from app.pathshala_levels l join app.pathshala_tracks t on t.id = l.track_id where t.key = 'jainism' and l.key = '1';
insert into app.pathshala_enrollments (center_id, term_id, student_person_id, household_id, class_id, status) values
  (:jsh, '40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-00000000000a', 'active'),
  (:jsh, '40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-00000000000b', 'active');

insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id) values
  (:jsh, '10000000-0000-4000-8000-000000000003', 'treasurer', 'center', null),
  (:jsh, '10000000-0000-4000-8000-000000000004', 'teacher', 'class', '40000000-0000-4000-8000-00000000000a'),
  ('00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000007', 'center_admin', 'center', null);

-- Event with lunch.
insert into app.events (id, center_id, name, starts_at, ends_at, status, lunch_enabled, lunch_starts_at, lunch_slot_minutes, lunch_seats_per_slot)
  values ('50000000-0000-4000-8000-000000000001', :jsh, 'Tapasvi Bahuman', now() - interval '1 hour', now() + interval '3 hours', 'live',
          true, now() + interval '1 hour', 15, 2);
insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id, ends_at) values
  (:jsh, '10000000-0000-4000-8000-000000000006', 'checkin_volunteer', 'event', '50000000-0000-4000-8000-000000000001', now() + interval '12 hours');

-- ------------------------------------------------------------ identity
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select pg_temp.assert((select count(*) from app.find_my_family(:jsh)) = 1, 'Priya''s email matches exactly one household member');
select pg_temp.assert((select household_name from app.find_my_family(:jsh)) = 'Shah family', 'match returns the Shah family');
select app.link_account(:jsh, '30000000-0000-4000-8000-000000000001');
select pg_temp.assert(app.my_person_id(:jsh) = '30000000-0000-4000-8000-000000000001', 'link_account links Priya');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';
do $$ begin
  perform app.link_account('00000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001');
  raise exception 'FAIL: Mehta linked to Priya';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: cannot link to a person whose email/phone is not yours';
end $$;
commit;

-- ------------------------------------------------------------ household isolation
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select pg_temp.assert((select count(*) from app.households) = 1, 'Priya sees only her household');
select pg_temp.assert((select count(*) from app.people) = 4, 'Priya sees her four family members');
select pg_temp.assert(not exists (select 1 from app.people where last_name = 'Mehta'), 'Priya cannot see the Mehtas');
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, source, amount_cents, pledged_at)
  values ('60000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
          '30000000-0000-4000-8000-000000000001', 'general', 15100, now() - interval '10 days');
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, source, amount_cents, pledged_at)
  values ('60000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
          '30000000-0000-4000-8000-000000000001', 'construction', 50000, now() - interval '5 days');
select pg_temp.assert((select count(*) from app.pledges) = 2, 'adult can create and see family pledges');
do $$ begin
  insert into app.pledges (center_id, household_id, source, amount_cents)
    values ('00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'general', 100);
  raise exception 'FAIL: pledged against another household';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: cannot pledge against another household';
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000002';  -- Dev, 14
select pg_temp.assert((select count(*) from app.people) = 4, 'child sees family members');
select pg_temp.assert((select count(*) from app.pledges) = 0, 'child never sees pledges');
do $$ begin
  insert into app.pledges (center_id, household_id, source, amount_cents)
    values ('00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'general', 100);
  raise exception 'FAIL: child created a pledge';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: child cannot create pledges';
end $$;
commit;

-- ------------------------------------------------------------ staff scopes
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';  -- treasurer
select pg_temp.assert((select count(*) from app.pledges) = 2, 'treasurer sees all pledges');
select pg_temp.assert((select count(*) from app.households) = 3, 'treasurer (people.view) sees all households');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000004';  -- teacher of class A
select pg_temp.assert((select count(*) from app.pledges) = 0, 'teacher sees no pledges');
select pg_temp.assert((select count(*) from app.pathshala_enrollments) = 1, 'teacher sees only enrollments in own class');
select pg_temp.assert(exists (select 1 from app.people where first_name = 'Dev'), 'teacher sees students on own class roster');
select pg_temp.assert(not exists (select 1 from app.people where first_name in ('Priya','Anya')), 'teacher cannot see parents or other classes');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000007';  -- admin of ANOTHER center
select pg_temp.assert((select count(*) from app.households) = 0, 'other center admin sees no JSH households');
select pg_temp.assert((select count(*) from app.pledges) = 0, 'other center admin sees no JSH pledges');
commit;

begin;
set local role anon;
select pg_temp.assert((select count(*) from app.centers) >= 1, 'anon can list centers');
select pg_temp.assert(not has_table_privilege('anon', 'app.people', 'select'), 'anon has no access to people');
select pg_temp.assert(not has_table_privilege('anon', 'app.pledges', 'select'), 'anon has no access to pledges');
select pg_temp.assert((select count(*) from app.zones) = 7, 'anon can read zones for the guide');
commit;

-- ------------------------------------------------------------ payment allocation
insert into app.payments (id, center_id, household_id, amount_cents, method, provider, provider_ref, status)
  values ('70000000-0000-4000-8000-000000000001', :jsh, '20000000-0000-4000-8000-000000000001', 30000, 'card', 'stripe', 'pi_test_1', 'captured');
select pg_temp.assert((select array_agg(amount_cents order by amount_cents) from app.allocate_payment('70000000-0000-4000-8000-000000000001')) = '{14900,15100}',
                      'preview: earliest pledge closed first, remainder rolls to the next');
select count(*) from app.allocate_payment('70000000-0000-4000-8000-000000000001', null, true);
select pg_temp.assert((select status from app.pledges where id = '60000000-0000-4000-8000-000000000001') = 'paid', 'earliest pledge paid');
select pg_temp.assert((select status from app.pledges where id = '60000000-0000-4000-8000-000000000002') = 'partially_paid', 'partial payment keeps pledge open');
select pg_temp.assert((select paid_cents from app.pledges where id = '60000000-0000-4000-8000-000000000002') = 14900, 'partial amount recorded');
select app.enqueue_payment_posting('70000000-0000-4000-8000-000000000001');
select app.enqueue_payment_posting('70000000-0000-4000-8000-000000000001');
select pg_temp.assert((select count(*) from app.ledger_postings where source_id = '70000000-0000-4000-8000-000000000001') = 1,
                      'QuickBooks posting is queued exactly once (idempotent)');

-- ------------------------------------------------------------ audit
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'pledges') >= 2, 'pledge changes are audited');
select pg_temp.assert((select count(*) from app.audit_log a1 join app.audit_log a2 on a2.prev_hash = a1.hash) >= 1, 'audit entries are hash-chained');
do $$ begin
  update app.audit_log set action = 'tampered';
  raise exception 'FAIL: audit row updated';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: audit log is append-only';
end $$;

-- ------------------------------------------------------------ bolis
insert into app.bolis (id, center_id, name, kind, floor_cents, step_cents, status, closes_at)
  values ('80000000-0000-4000-8000-000000000001', :jsh, 'Swamivatsalya labh', 'digital', 50100, 2100, 'open', now() + interval '2 days');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
do $$ begin
  perform app.place_boli_entry('80000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 40000);
  raise exception 'FAIL: pledge below floor accepted';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: boli pledge below the floor is rejected';
end $$;
select app.place_boli_entry('80000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 50100);
select pg_temp.assert((select minimum_cents from app.boli_summary('80000000-0000-4000-8000-000000000001')) = 52200, 'next minimum = top + step');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000002';  -- Dev
do $$ begin
  perform app.place_boli_entry('80000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 60000);
  raise exception 'FAIL: child placed a boli pledge';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: children cannot pledge in bolis';
end $$;
commit;

-- ------------------------------------------------------------ check-in + lunch
insert into app.rsvps (id, center_id, event_id, household_id, status)
  values ('90000000-0000-4000-8000-000000000001', :jsh, '50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'confirmed'),
         ('90000000-0000-4000-8000-000000000002', :jsh, '50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'confirmed');
insert into app.attendees (center_id, event_id, rsvp_id, person_id, display_name, is_child_under_12, ticket_token) values
  (:jsh, '50000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Priya Shah', false, 'tok-shah'),
  (:jsh, '50000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000004', 'Anya Shah', true, null),
  (:jsh, '50000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000005', 'Kiran Mehta', false, 'tok-mehta');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000006';  -- check-in volunteer, event-scoped
select pg_temp.assert((select result from app.check_in('50000000-0000-4000-8000-000000000001', 'tok-shah')) = 'ok', 'volunteer checks in the Shah family');
select pg_temp.assert((select result from app.check_in('50000000-0000-4000-8000-000000000001', 'tok-shah')) = 'duplicate', 'second scan reports duplicate');
select pg_temp.assert((select result from app.check_in('50000000-0000-4000-8000-000000000001', 'nope')) = 'invalid', 'unknown token is invalid');
select app.check_in('50000000-0000-4000-8000-000000000001', 'tok-mehta');
select pg_temp.assert((select count(*) from app.pledges) = 0, 'check-in volunteer sees no giving data');
commit;
select pg_temp.assert(
  (select count(distinct lunch_slot_id) from app.attendees where rsvp_id = '90000000-0000-4000-8000-000000000001') = 1
  and (select s.starts_at from app.attendees a join app.lunch_slots s on s.id = a.lunch_slot_id where a.display_name = 'Priya Shah')
      = (select min(starts_at) from app.lunch_slots where event_id = '50000000-0000-4000-8000-000000000001'),
  'family with a child under 12 eats together at lunch start');
select pg_temp.assert((select lunch_slot_id from app.attendees where display_name = 'Kiran Mehta') is not null, 'others get the next open slot');
select pg_temp.assert((select count(*) from app.messages where template_key = 'lunch_reminder') = 3, 'one 5-minute lunch reminder per checked-in member');

-- ------------------------------------------------------------ My Jain Way
insert into app.practice_selections (center_id, person_id, practice_id)
  select :jsh, '30000000-0000-4000-8000-000000000001', id from app.practices where key in ('navkar_waking', 'darshan');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select pg_temp.assert((select points_awarded from app.log_practice('00000000-0000-4000-8000-000000000001',
                        (select id from app.practices where key = 'navkar_waking'))) = 5, 'practice awards its points');
select pg_temp.assert((select points_awarded from app.log_practice('00000000-0000-4000-8000-000000000001',
                        (select id from app.practices where key = 'navkar_waking'))) = 0, 'same practice twice in a day awards nothing');
select pg_temp.assert((select day_complete from app.log_practice('00000000-0000-4000-8000-000000000001',
                        (select id from app.practices where key = 'darshan'))), 'finishing all selected practices completes the day');
select pg_temp.assert((select sum(points) from app.points_ledger) = 35, '5 + 10 + 20 bonus');
select pg_temp.assert((select current_days from app.streaks) = 1, 'streak starts at 1');
commit;

-- ------------------------------------------------------------ public KPIs
begin;
set local role anon;
select pg_temp.assert((app.public_kpis('jsh')->'metrics'->>'community_people') is null, 'KPI groups under 10 are suppressed');
commit;

\echo 'PASS: all RLS and rule tests'
