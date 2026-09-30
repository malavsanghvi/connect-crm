-- 0549: an anonymous survey answer is stamped with the day only.
-- Before, the anonymous answer row (no person) and the completion / points rows (a person) shared the exact
-- timestamp, so someone querying the database directly could link them. All three now carry midnight of the day
-- for an anonymous answer; named answers keep their exact time. The portal never showed the link.
set client_min_messages = warning;

create or replace function app.submit_survey(p_survey uuid, p_answers jsonb, p_anonymous boolean default false)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.surveys; v_person uuid; v_points int := 0; v_anon boolean; v_at timestamptz;
begin
  select * into s from app.surveys where id = p_survey for update;
  if s.id is null then raise exception 'That survey was not found.'; end if;
  perform app.assert_module_enabled(s.center_id, 'surveys');
  if not app.is_member_of(s.center_id) then raise exception 'Only members can answer this survey.'; end if;
  if s.status <> 'open' or (s.opens_at is not null and s.opens_at > now()) or (s.closes_at is not null and s.closes_at < now()) then
    raise exception 'This survey is closed.';
  end if;
  if not app.in_survey_audience(s.center_id, s.audience, s.event_id) then raise exception 'This survey is not for you.'; end if;
  v_person := app.my_person_id(s.center_id);
  if v_person is null then raise exception 'We could not tell who you are. Sign in again.'; end if;
  if jsonb_typeof(p_answers) is distinct from 'object' and jsonb_typeof(p_answers) is distinct from 'array' then raise exception 'Answers are missing.'; end if;
  if exists (select 1 from app.survey_completions c where c.survey_id = s.id and c.person_id = v_person) then
    raise exception 'You already answered this survey. Thank you!';
  end if;
  v_anon := s.anonymous or coalesce(p_anonymous, false);
  -- An anonymous answer is stamped with the DAY only, in all three rows, so nobody with database access can match the
  -- answer (no person) to the completion and points rows (a person) by their exact time.
  v_at := case when v_anon then date_trunc('day', now()) else now() end;
  insert into app.survey_responses (center_id, survey_id, person_id, answers, submitted_at) values (s.center_id, s.id, case when v_anon then null else v_person end, p_answers, v_at);
  v_points := coalesce(s.reward_points, 0);
  insert into app.survey_completions (survey_id, person_id, center_id, points_awarded, completed_at) values (s.id, v_person, s.center_id, v_points, v_at);
  if v_points > 0 then
    insert into app.points_ledger (center_id, person_id, points, reason, ref_id, note, occurred_at) values (s.center_id, v_person, v_points, 'survey', s.id, left('Feedback: ' || s.title, 200), v_at);
  end if;
  -- Reminders stop once they have answered.
  update app.messages set status = 'cancelled'
   where person_id = v_person and status = 'queued' and template_key in ('event_survey', 'event_survey_reminder') and payload->>'survey_id' = s.id::text;
  return jsonb_build_object('points', v_points, 'anonymous', v_anon);
end $$;
grant execute on function app.submit_survey(uuid, jsonb, boolean) to authenticated;
