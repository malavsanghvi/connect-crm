-- 0140 (wave 3 · w-learning): the attendance QR answers honestly on a re-scan.
--
-- redeem_attendance_qr inserted "on conflict do nothing" and then returned the
-- status it WOULD have written, so a child the teacher had already marked absent
-- (or late) was told "present" while nothing changed. It now returns the mark
-- that is actually on the register. It also checks the code before the module
-- guard, so an unknown session is "not valid" rather than a guard on a null center.
create or replace function app.redeem_attendance_qr(p_session uuid, p_token text, p_person uuid default null)
returns text
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.pathshala_sessions; v_person uuid; v_enrollment uuid; v_status text; c app.pathshala_classes;
begin
  select * into s from app.pathshala_sessions where id = p_session;
  if s.id is null then raise exception 'this class code is not valid'; end if;
  perform app.assert_module_enabled(s.center_id, 'pathshala');
  if s.attendance_token is null or s.attendance_token <> p_token then raise exception 'this class code is not valid'; end if;
  if s.token_expires_at is not null and s.token_expires_at < now() then raise exception 'this class code has expired — ask the teacher to show a new one'; end if;
  v_person := coalesce(p_person, app.my_person_id(s.center_id));
  if v_person is null or not app.can_act_for_person(s.center_id, v_person) then raise exception 'you can only mark your own attendance or your child''s'; end if;
  select e.id into v_enrollment from app.pathshala_enrollments e
   where e.class_id = s.class_id and e.student_person_id = v_person and e.status in ('placed','active');
  if v_enrollment is null then raise exception 'not enrolled in this class'; end if;
  select * into c from app.pathshala_classes where id = s.class_id;
  v_status := case when c.starts_time is not null
                        and (now() at time zone (select time_zone from app.centers where id = s.center_id))::time > c.starts_time + interval '10 minutes'
                   then 'late' else 'present' end;
  insert into app.pathshala_attendance (center_id, session_id, enrollment_id, status, marked_by, marked_via)
    values (s.center_id, s.id, v_enrollment, v_status, auth.uid(), 'qr')
  on conflict (session_id, enrollment_id) do nothing;
  if not found then
    -- Already on the register (the teacher marked it, or an earlier scan): report that mark.
    select a.status into v_status from app.pathshala_attendance a where a.session_id = s.id and a.enrollment_id = v_enrollment;
  end if;
  return v_status;
end $$;
grant execute on function app.redeem_attendance_qr(uuid, text, uuid) to authenticated;
