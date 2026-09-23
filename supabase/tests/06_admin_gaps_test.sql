-- Fixes for connect-admin gaps.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
\set jsh '''00000000-0000-4000-8000-000000000001'''

-- principal granted with scope 'pathshala'
insert into auth.users (id, email) values ('10000000-0000-4000-8000-000000000009', 'principal@example.com');
insert into app.people (id, center_id, first_name, last_name) values ('30000000-0000-4000-8000-000000000029', :jsh, 'Pooja', 'Principal');
insert into app.center_users (center_id, user_id, person_id) values (:jsh, '10000000-0000-4000-8000-000000000009', '30000000-0000-4000-8000-000000000029');
insert into app.role_grants (center_id, user_id, role_key, scope_kind) values (:jsh, '10000000-0000-4000-8000-000000000009', 'pathshala_principal', 'pathshala');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000009';
select pg_temp.assert(app.has_permission('00000000-0000-4000-8000-000000000001', 'pathshala.manage'), 'a principal granted with scope pathshala has pathshala.manage');
select pg_temp.assert((select count(*) from app.households where display_name = 'Shah family') = 1, 'the principal sees households of enrolled students');
commit;

-- create_event_from_template needs events.manage
insert into app.event_templates (id, center_id, name) values ('f0000000-0000-4000-8000-000000000001', :jsh, 'Pathshala annual day');
insert into app.event_template_items (center_id, template_id, phase, name, offset_days) values
  (:jsh, 'f0000000-0000-4000-8000-000000000001', 'pre', 'Book hall', -30),
  (:jsh, 'f0000000-0000-4000-8000-000000000001', 'during', 'Run program', null);
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';  -- Priya, a member
do $$ begin
  perform app.create_event_from_template('f0000000-0000-4000-8000-000000000001', 'Annual day');
  raise exception 'FAIL: member created an event';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: only events.manage can create events from a template';
end $$;
commit;
select app.create_event_from_template('f0000000-0000-4000-8000-000000000001', 'Annual day 2027', null, '2026-2027') as new_event \gset
select pg_temp.assert((select count(*) from app.actions where event_id = :'new_event') = 2, 'an undated event from a template gets its checklist');

-- check-in: household id on no_rsvp; phone lookup is masked
insert into app.external_ids (center_id, person_id, kind, system, value) values
  (:jsh, '30000000-0000-4000-8000-000000000019', 'crm', 'namocrm', '99001');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000006';  -- volunteer for event ...002
select pg_temp.assert((select result || '|' || household_id from app.check_in('50000000-0000-4000-8000-000000000002', 'contact_id_99001'))
                      = 'no_rsvp|20000000-0000-4000-8000-000000000009', 'no_rsvp returns the household id for a walk-in');
select pg_temp.assert((select members_masked from app.checkin_lookup_phone('50000000-0000-4000-8000-000000000002', '(713) 555-0142')) like 'P•••• S.%',
                      'phone lookup shows masked names only');
select pg_temp.assert((select rsvp_status from app.checkin_lookup_phone('50000000-0000-4000-8000-000000000002', '713-555-0142')) = 'attended',
                      'phone lookup shows the household''s RSVP status');
commit;

-- attendance QR
update app.pathshala_sessions set attendance_token = 'tok123', token_expires_at = now() + interval '10 minutes' where false;
insert into app.pathshala_sessions (id, center_id, class_id, held_on, attendance_token, token_expires_at)
  values ('f1000000-0000-4000-8000-000000000001', :jsh, '40000000-0000-4000-8000-00000000000b', current_date, 'tok123', now() + interval '10 minutes');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';  -- Priya marks Anya (class B)
select pg_temp.assert(app.redeem_attendance_qr('f1000000-0000-4000-8000-000000000001', 'tok123', '30000000-0000-4000-8000-000000000004') in ('present','late'),
                      'a parent scans the class QR for their child');
do $$ begin
  perform app.redeem_attendance_qr('f1000000-0000-4000-8000-000000000001', 'wrong', '30000000-0000-4000-8000-000000000004');
  raise exception 'FAIL: wrong token accepted';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: a wrong class code is refused';
end $$;
commit;
select pg_temp.assert((select marked_via from app.pathshala_attendance where session_id = 'f1000000-0000-4000-8000-000000000001') = 'qr', 'attendance recorded via QR');

-- sign-off points
insert into app.gyan_signoffs (id, center_id, person_id, level_id)
  select 'f2000000-0000-4000-8000-000000000001', :jsh, '30000000-0000-4000-8000-000000000004', l.id
  from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id where g.key = 'navkar' and l.key = '9';
update app.gyan_signoffs set status = 'approved' where id = 'f2000000-0000-4000-8000-000000000001';
update app.gyan_signoffs set status = 'needs_work' where id = 'f2000000-0000-4000-8000-000000000001';
update app.gyan_signoffs set status = 'approved' where id = 'f2000000-0000-4000-8000-000000000001';
select pg_temp.assert((select count(*) from app.points_ledger where person_id = '30000000-0000-4000-8000-000000000004' and reason = 'level') = 1,
                      'a teacher sign-off awards level points exactly once');

-- stock
insert into app.inventory_movements (center_id, item_id, delta, reason)
  select :jsh, id, 24, 'received' from app.store_items where name = 'Mohanthal';
select pg_temp.assert((select stock_on_hand from app.store_items where name = 'Mohanthal') = 24, 'stock follows inventory movements');

\echo 'PASS: admin gap tests'
