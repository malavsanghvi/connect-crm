-- 0547: the Survey tab on an event (builds on 0544).
--
--   app.manages_event_surveys     who may see and change an event's survey: events.manage, or the event's lead
--                                 (the same rule app.attach_event_survey uses)
--   read policies                 those people can read the event's feedback survey, the feedback templates and the
--                                 answers to their event's survey. Anonymous answers carry no person, so reading
--                                 them never reveals who answered; named answers are the ones the member chose to sign.
--   app.update_event_survey       change title, questions, points, automatic launch and anonymity before it launches
--   app.remove_event_survey       take the survey off the event while it is still an unsent draft with no answers
--   app.launch_event_survey_now   open the survey now for a completed event (for surveys not set to launch automatically)
--   app.event_survey_stats        invited adults, people who answered, anonymous answers, points awarded: the numbers
--                                 a person who cannot read the household and people tables still needs
set client_min_messages = warning;

-- ── Who manages an event's survey ──────────────────────────────────────────
-- p_event null = "any event of this center": used to let a lead see the survey templates they can attach.
create or replace function app.manages_event_surveys(p_center uuid, p_event uuid default null) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select app.has_permission(p_center, 'events.manage')
      or (p_event is not null and app.has_scoped_role(p_center, p_event, 'event_lead'))
      or (p_event is null and exists (
            select 1 from app.role_grants g
             where g.center_id = p_center and g.user_id = auth.uid() and g.role_key = 'event_lead'
               and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now())))
$$;
revoke execute on function app.manages_event_surveys(uuid, uuid) from public, anon;
grant execute on function app.manages_event_surveys(uuid, uuid) to authenticated, service_role;

-- ── Read access for event managers and leads ───────────────────────────────
-- The surveys table is otherwise readable only with comms.view / comms.send, which an event lead does not hold.
drop policy if exists surveys_event_manager_read on app.surveys;
create policy surveys_event_manager_read on app.surveys for select to authenticated
  using (kind = 'event_feedback' and app.manages_event_surveys(center_id, event_id));

drop policy if exists survey_responses_event_manager_read on app.survey_responses;
create policy survey_responses_event_manager_read on app.survey_responses for select to authenticated
  using (survey_id in (
    select s.id from app.surveys s
     where s.kind = 'event_feedback' and s.event_id is not null
       and app.manages_event_surveys(s.center_id, s.event_id)));

-- ── One place for the "may I change this survey" checks ────────────────────
create or replace function app._event_survey_for_change(p_survey uuid) returns app.surveys
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.surveys;
begin
  select * into s from app.surveys where id = p_survey for update;
  if s.id is null or s.event_id is null or s.kind <> 'event_feedback' then raise exception 'That survey was not found.'; end if;
  perform app.assert_module_enabled(s.center_id, 'events');
  perform app.assert_module_enabled(s.center_id, 'surveys');
  if not app.manages_event_surveys(s.center_id, s.event_id) then
    raise exception 'Only event managers and this event''s lead can change its survey.';
  end if;
  return s;
end $$;
revoke execute on function app._event_survey_for_change(uuid) from public, anon, authenticated;

-- ── Edit a survey before it launches ───────────────────────────────────────
-- A null argument keeps the current value.
create or replace function app.update_event_survey(
  p_survey uuid, p_title text default null, p_questions jsonb default null,
  p_points integer default null, p_auto boolean default null, p_anonymous boolean default null)
returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.surveys;
begin
  s := app._event_survey_for_change(p_survey);
  if s.status <> 'draft' or s.completion_started_at is not null then
    raise exception 'This survey has already started, so its questions and points can no longer be changed here.';
  end if;
  if p_points is not null and (p_points < 0 or p_points > 1000) then raise exception 'Points must be between 0 and 1000.'; end if;
  if p_questions is not null and (jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) = 0) then
    raise exception 'Add at least one question.';
  end if;
  perform app.set_audit_context('Event manager changed the event survey');
  update app.surveys
     set title = coalesce(nullif(trim(p_title), ''), title),
         questions = coalesce(p_questions, questions),
         reward_points = coalesce(p_points, reward_points),
         auto_on_complete = coalesce(p_auto, auto_on_complete),
         anonymous = coalesce(p_anonymous, anonymous)
   where id = s.id;
end $$;
revoke execute on function app.update_event_survey(uuid, text, jsonb, integer, boolean, boolean) from public, anon;
grant execute on function app.update_event_survey(uuid, text, jsonb, integer, boolean, boolean) to authenticated, service_role;

-- ── Take the survey off the event ──────────────────────────────────────────
create or replace function app.remove_event_survey(p_survey uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.surveys;
begin
  s := app._event_survey_for_change(p_survey);
  if s.status <> 'draft' or s.completion_started_at is not null then
    raise exception 'This survey has already started and cannot be removed. Close it instead.';
  end if;
  if exists (select 1 from app.survey_responses where survey_id = s.id) or exists (select 1 from app.survey_completions where survey_id = s.id) then
    raise exception 'This survey already has answers, so it cannot be removed.';
  end if;
  perform app.set_audit_context('Event manager removed the event survey');
  delete from app.surveys where id = s.id;
end $$;
revoke execute on function app.remove_event_survey(uuid) from public, anon;
grant execute on function app.remove_event_survey(uuid) to authenticated, service_role;

-- ── Launch now (completed event, survey not sent yet) ──────────────────────
-- Returns how many people were notified. The same launch the completion trigger runs.
create or replace function app.launch_event_survey_now(p_survey uuid) returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.surveys; e app.events;
begin
  s := app._event_survey_for_change(p_survey);
  select * into e from app.events where id = s.event_id;
  if e.status <> 'completed' then raise exception 'The survey can be sent once the event is marked completed.'; end if;
  if s.completion_started_at is not null then raise exception 'This survey has already been sent.'; end if;
  if s.status = 'closed' then raise exception 'This survey was closed. Reopen it from Event feedback instead.'; end if;
  perform app.set_audit_context('Event manager launched the event survey');
  perform app.launch_event_survey(s.id);
  return (select count(distinct m.person_id)::integer from app.messages m
           where m.template_key = 'event_survey' and m.payload->>'survey_id' = s.id::text);
end $$;
revoke execute on function app.launch_event_survey_now(uuid) from public, anon;
grant execute on function app.launch_event_survey_now(uuid) to authenticated, service_role;

-- ── Analytics numbers that need the household and people tables ────────────
--   invited   adults of households with an active RSVP (or who attended), the same people app.launch_event_survey
--             notifies, plus anyone who answered even if their RSVP changed afterwards
--   answered  the larger of answers received and completions (older surveys have answers but no completion rows)
create or replace function app.event_survey_stats(p_survey uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare s app.surveys; v_statuses text[]; v_invited integer := 0; v_responses integer; v_anon integer; v_completions integer; v_points integer;
begin
  select * into s from app.surveys where id = p_survey;
  if s.id is null then raise exception 'That survey was not found.'; end if;
  if not (app.has_permission(s.center_id, 'comms.view') or app.has_permission(s.center_id, 'comms.send')
          or (s.event_id is not null and app.manages_event_surveys(s.center_id, s.event_id))) then
    raise exception 'You do not have access to this survey''s results.';
  end if;
  v_statuses := case when jsonb_typeof(s.audience->'rsvp_statuses') = 'array'
                     then array(select jsonb_array_elements_text(s.audience->'rsvp_statuses'))
                     else array['rsvpd', 'confirmed', 'attended'] end;
  if s.event_id is not null then
    select count(*) into v_invited from (
      select hm.person_id
        from app.rsvps r
        join app.household_members hm on hm.household_id = r.household_id and hm.left_at is null
        join app.people p on p.id = hm.person_id
       where r.event_id = s.event_id and r.status::text = any (v_statuses)
         and (p.date_of_birth is null or p.date_of_birth <= current_date - interval '18 years')
         and not coalesce(p.is_deceased, false)
      union
      select c.person_id from app.survey_completions c where c.survey_id = s.id
    ) who;
  end if;
  select count(*), count(*) filter (where person_id is null) into v_responses, v_anon from app.survey_responses where survey_id = s.id;
  select count(*), coalesce(sum(points_awarded), 0) into v_completions, v_points from app.survey_completions where survey_id = s.id;
  return jsonb_build_object(
    'invited', v_invited, 'responses', v_responses, 'anonymous', v_anon,
    'completions', v_completions, 'answered', greatest(v_responses, v_completions), 'points_awarded', v_points);
end $$;
revoke execute on function app.event_survey_stats(uuid) from public, anon;
grant execute on function app.event_survey_stats(uuid) to authenticated, service_role;
