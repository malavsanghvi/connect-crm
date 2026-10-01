-- 0544: surveys attached to events, with points, automatic launch when the event completes, and reminders.
--
--   surveys.reward_points      points the event admin sets; awarded once per person when they answer
--   surveys.auto_on_complete   open the survey and notify attendees the moment the event is marked completed
--   app.survey_completions     who answered which survey (works for anonymous answers: the answer row carries
--                              no person, the completion row does, so points and "already answered" still work)
--   app.submit_survey          the ONE way a member answers: saves the answer, records the completion, awards points
--   app.attach_event_survey    an event manager attaches a template (copied) or a new survey to an event
--   event completed trigger    opens the survey for everyone with an active RSVP or who attended, queues a push
--                              now and two reminders (day 1, day 2) that stop once they answer
-- Points are the same points ledger as My Jain Way (reason "survey").
set client_min_messages = warning;

alter table app.surveys add column if not exists reward_points integer not null default 0 check (reward_points between 0 and 1000);
alter table app.surveys add column if not exists auto_on_complete boolean not null default false;
alter table app.surveys add column if not exists completion_started_at timestamptz;

alter table app.points_ledger drop constraint if exists points_ledger_reason_check;
alter table app.points_ledger add constraint points_ledger_reason_check
  check (reason in ('practice','level','anumodana_sent','anumodana_received','support','welcome','volunteer','correction','challenge','survey'));

create table if not exists app.survey_completions (
  survey_id      uuid not null references app.surveys(id) on delete cascade,
  person_id      uuid not null references app.people(id) on delete cascade,
  center_id      uuid not null references app.centers(id) on delete cascade,
  completed_at   timestamptz not null default now(),
  points_awarded integer not null default 0,
  primary key (survey_id, person_id)
);
create index if not exists survey_completions_center_idx on app.survey_completions (center_id, survey_id);
insert into app.module_tables (table_name, module_key) values ('survey_completions', 'surveys') on conflict (table_name) do nothing;
drop trigger if exists audit_survey_completions on app.survey_completions;
create trigger audit_survey_completions after insert or update or delete on app.survey_completions for each row execute function app.audit_row();
alter table app.survey_completions enable row level security;
drop policy if exists survey_completions_own on app.survey_completions;
create policy survey_completions_own on app.survey_completions for select to authenticated using (app.can_act_for_person(center_id, person_id));
drop policy if exists module_switch on app.survey_completions;
create policy module_switch on app.survey_completions as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('surveys'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('surveys'))::uuid[])));
revoke all on app.survey_completions from public, anon, authenticated, connect_worker;
grant select on app.survey_completions to authenticated;
grant all on app.survey_completions to service_role;
drop policy if exists survey_completions_staff on app.survey_completions;
create policy survey_completions_staff on app.survey_completions for select to authenticated
  using (app.has_permission(center_id, 'comms.view') or app.has_permission(center_id, 'comms.send') or app.has_permission(center_id, 'events.manage'));

-- ── Answer a survey ─────────────────────────────────────────────────────────
create or replace function app.submit_survey(p_survey uuid, p_answers jsonb, p_anonymous boolean default false)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.surveys; v_person uuid; v_points int := 0; v_anon boolean;
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
  insert into app.survey_responses (center_id, survey_id, person_id, answers) values (s.center_id, s.id, case when v_anon then null else v_person end, p_answers);
  v_points := coalesce(s.reward_points, 0);
  insert into app.survey_completions (survey_id, person_id, center_id, points_awarded) values (s.id, v_person, s.center_id, v_points);
  if v_points > 0 then
    insert into app.points_ledger (center_id, person_id, points, reason, ref_id, note) values (s.center_id, v_person, v_points, 'survey', s.id, left('Feedback: ' || s.title, 200));
  end if;
  -- Reminders stop once they have answered.
  update app.messages set status = 'cancelled'
   where person_id = v_person and status = 'queued' and template_key in ('event_survey', 'event_survey_reminder') and payload->>'survey_id' = s.id::text;
  return jsonb_build_object('points', v_points, 'anonymous', v_anon);
end $$;
grant execute on function app.submit_survey(uuid, jsonb, boolean) to authenticated;

-- ── Attach a survey to an event ────────────────────────────────────────────
-- p_template set: copy that template's questions. Otherwise p_questions is the new survey. Either way the event
-- gets its own survey row (so editing it never changes the template or another event).
create or replace function app.attach_event_survey(
  p_event uuid, p_template uuid default null, p_title text default null, p_questions jsonb default null,
  p_points integer default 0, p_auto boolean default true, p_anonymous boolean default null)
returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare e app.events; t app.surveys; v_id uuid; v_q jsonb; v_title text; v_anon boolean;
begin
  select * into e from app.events where id = p_event;
  if e.id is null then raise exception 'That event was not found.'; end if;
  perform app.assert_module_enabled(e.center_id, 'events');
  perform app.assert_module_enabled(e.center_id, 'surveys');
  if not (app.has_permission(e.center_id, 'events.manage') or app.has_scoped_role(e.center_id, e.id, 'event_lead')) then
    raise exception 'Only event managers and this event''s lead can attach a survey.';
  end if;
  if exists (select 1 from app.surveys where event_id = e.id and kind = 'event_feedback') then
    raise exception 'This event already has a survey. Edit or remove it first.';
  end if;
  if p_points < 0 or p_points > 1000 then raise exception 'Points must be between 0 and 1000.'; end if;
  if p_template is not null then
    select * into t from app.surveys where id = p_template and center_id = e.center_id and kind = 'event_feedback' and event_id is null;
    if t.id is null then raise exception 'That survey template was not found.'; end if;
    v_q := t.questions; v_anon := coalesce(p_anonymous, t.anonymous); v_title := coalesce(nullif(trim(p_title), ''), e.name || ' · feedback');
  else
    if p_questions is null or jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) = 0 then raise exception 'Add at least one question.'; end if;
    v_q := p_questions; v_anon := coalesce(p_anonymous, false); v_title := coalesce(nullif(trim(p_title), ''), e.name || ' · feedback');
  end if;
  perform app.set_audit_context('Event manager attached a survey to the event');
  insert into app.surveys (center_id, title, description, questions, audience, anonymous, status, kind, event_id, reward_points, auto_on_complete, created_by, template_key)
    values (e.center_id, v_title, 'Tell us how it went.', v_q,
            jsonb_build_object('event_id', e.id, 'rsvp_statuses', jsonb_build_array('rsvpd', 'confirmed', 'attended')),
            v_anon, 'draft', 'event_feedback', e.id, p_points, p_auto, auth.uid(), 'event_feedback')
    returning id into v_id;
  -- Already completed and set to launch automatically: start it now.
  if e.status = 'completed' and p_auto then perform app.launch_event_survey(v_id); end if;
  return v_id;
end $$;
grant execute on function app.attach_event_survey(uuid, uuid, text, jsonb, integer, boolean, boolean) to authenticated;

-- ── Launch: open the survey and notify ─────────────────────────────────────
create or replace function app.launch_event_survey(p_survey uuid) returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.surveys; e app.events; n int := 0; v_body text; v_pts text;
begin
  select * into s from app.surveys where id = p_survey for update;
  if s.id is null or s.event_id is null then return 0; end if;
  if s.completion_started_at is not null then return 0; end if;
  select * into e from app.events where id = s.event_id;
  update app.surveys set status = 'open', opens_at = now(), closes_at = now() + interval '14 days', completion_started_at = now(),
         audience = jsonb_build_object('event_id', s.event_id, 'rsvp_statuses', jsonb_build_array('rsvpd', 'confirmed', 'attended'))
   where id = s.id;
  v_pts := case when s.reward_points > 0 then ' Earn ' || s.reward_points || ' points.' else '' end;
  v_body := 'How was ' || e.name || '? Share your feedback.' || v_pts;
  -- Adults of every household with an active RSVP or who attended; a push now, then a reminder on day 1 and day 2.
  with who as (
    select distinct hm.person_id
      from app.rsvps r
      join app.household_members hm on hm.household_id = r.household_id and hm.left_at is null
      join app.people p on p.id = hm.person_id
     where r.event_id = s.event_id and r.status in ('rsvpd', 'confirmed', 'attended')
       and (p.date_of_birth is null or p.date_of_birth <= current_date - interval '18 years')
       and not coalesce(p.is_deceased, false)
  ), slots(tpl, delay) as (values ('event_survey', interval '0'), ('event_survey_reminder', interval '1 day'), ('event_survey_reminder', interval '2 days'))
  insert into app.messages (center_id, person_id, channel, topic_key, template_key, subject, body, payload, scheduled_at)
  select s.center_id, w.person_id, 'push', 'events', sl.tpl, e.name || ' · feedback', v_body,
         jsonb_build_object('survey_id', s.id, 'event_id', s.event_id, 'reward_points', s.reward_points, 'deep_link', 'survey/' || s.id), now() + sl.delay
    from who w cross join slots sl;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function app.on_event_completed() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare r record;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    for r in select id from app.surveys where event_id = new.id and kind = 'event_feedback' and auto_on_complete and completion_started_at is null loop
      perform app.launch_event_survey(r.id);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists events_survey_on_completed on app.events;
create trigger events_survey_on_completed after update of status on app.events for each row execute function app.on_event_completed();
revoke execute on function app.launch_event_survey(uuid), app.on_event_completed() from public, anon, authenticated;
