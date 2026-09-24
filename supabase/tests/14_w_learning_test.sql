-- Wave 3 · w-learning: behaviour the learning flows rely on.
\set ON_ERROR_STOP 1
\set jsh '''00000000-0000-4000-8000-000000000001'''
create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'PASS: %', msg; end $$;

-- A re-scan reports the mark that is on the register, not the one it would have written.
insert into app.pathshala_sessions (id, center_id, class_id, held_on, attendance_token, token_expires_at)
  values ('f1400000-0000-4000-8000-000000000001', :jsh, '40000000-0000-4000-8000-00000000000b', current_date - 7, 'tok140', now() + interval '10 minutes');
insert into app.pathshala_attendance (center_id, session_id, enrollment_id, status, marked_via)
  select :jsh, 'f1400000-0000-4000-8000-000000000001', e.id, 'absent', 'teacher'
    from app.pathshala_enrollments e where e.class_id = '40000000-0000-4000-8000-00000000000b' and e.student_person_id = '30000000-0000-4000-8000-000000000004';
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select pg_temp.assert(app.redeem_attendance_qr('f1400000-0000-4000-8000-000000000001', 'tok140', '30000000-0000-4000-8000-000000000004') = 'absent',
                      'a re-scan after the teacher marked absent says absent (nothing changed)');
do $$ begin
  perform app.redeem_attendance_qr('f1400000-0000-4000-8000-00000000ffff', 'tok140', null);
  raise exception 'FAIL: unknown session accepted';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if sqlerrm not like '%not valid%' then raise exception 'FAIL: unknown session gave "%"', sqlerrm; end if;
  raise notice 'PASS: an unknown class code is "not valid"';
end $$;
commit;

-- Saathi points follow centers.rules.points; a repeat support message the same day earns nothing.
update app.centers set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{points}',
  coalesce(rules->'points', '{}'::jsonb) || '{"anumodana_points": 7, "support_points": 4, "anumodana_daily_cap": 50}'::jsonb) where id = :jsh;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select pg_temp.assert(app.send_anumodana(:jsh, '30000000-0000-4000-8000-000000000003', 'celebrate', null) = 7, 'anumodana credits the configured points');
select pg_temp.assert(app.send_anumodana(:jsh, '30000000-0000-4000-8000-000000000004', 'support', 'You can do it') = 4, 'support credits the configured points');
select pg_temp.assert(app.send_anumodana(:jsh, '30000000-0000-4000-8000-000000000004', 'support', 'Again') = 0, 'a second support to the same person today earns nothing');
select pg_temp.assert((select count(*) from app.anumodana where to_person_id = '30000000-0000-4000-8000-000000000004' and message = 'Again') = 1, 'the repeat message is still delivered');
commit;
update app.centers set rules = rules #- '{points,anumodana_points}' #- '{points,support_points}' #- '{points,anumodana_daily_cap}' where id = :jsh;
