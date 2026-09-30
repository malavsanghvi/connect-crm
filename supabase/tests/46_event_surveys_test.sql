-- 0544: event surveys: attach (manager only), launch on completion, reminders, points once.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
\set jsh '''00000000-0000-4000-8000-000000000001'''

insert into auth.users (id, email) values ('10000000-0000-4000-8000-0000000000e1', 'eventmgr46@example.com');
insert into app.people (id, center_id, first_name, last_name) values ('30000000-0000-4000-8000-0000000000e1', :jsh, 'Event', 'Manager');
insert into app.center_users (center_id, user_id, person_id) values (:jsh, '10000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000e1');
insert into app.role_grants (center_id, user_id, role_key, scope_kind) values (:jsh, '10000000-0000-4000-8000-0000000000e1', 'center_admin', 'center');
insert into app.events (id, center_id, name, starts_at, ends_at, status, capacity) values
  ('50000000-0000-4000-8000-0000000000e1', :jsh, 'Survey event 46', now() - interval '2 days', now() - interval '1 day', 'published', 100);

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';  -- Priya
select app.submit_rsvp('50000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-000000000001',
  '[{"person_id":"30000000-0000-4000-8000-000000000001","name":"Priya Shah"}]') as rsvp \gset
do $$ begin
  perform app.attach_event_survey('50000000-0000-4000-8000-0000000000e1', null, 'x', '[{"id":"q1","type":"rating","label":"How was it?","options":[],"required":true}]'::jsonb, 10, true);
  raise exception 'FAIL: a member attached a survey';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: only event managers can attach a survey';
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-0000000000e1';
select app.attach_event_survey('50000000-0000-4000-8000-0000000000e1', null, 'Survey event 46 feedback',
  '[{"id":"q1","type":"rating","label":"How was it?","options":[],"required":true}]'::jsonb, 25, true) as sv \gset
select pg_temp.assert((select status from app.surveys where id = :'sv') = 'draft', 'the attached survey waits as a draft until the event completes');
select pg_temp.assert((select reward_points from app.surveys where id = :'sv') = 25, 'the admin-set points are saved');
do $$ begin
  perform app.attach_event_survey('50000000-0000-4000-8000-0000000000e1', null, 'again', '[{"id":"q1","type":"text","label":"x","options":[],"required":false}]'::jsonb, 0, true);
  raise exception 'FAIL: two surveys on one event';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: an event has one survey';
end $$;
commit;

-- The event completes: the survey opens and members are told (push now + day 1 + day 2).
update app.events set status = 'completed' where id = '50000000-0000-4000-8000-0000000000e1';
select pg_temp.assert((select status from app.surveys where event_id = '50000000-0000-4000-8000-0000000000e1') = 'open', 'completing the event opens the survey');
select pg_temp.assert((select count(*) from app.messages where template_key in ('event_survey', 'event_survey_reminder') and payload->>'survey_id' = :'sv' and person_id = '30000000-0000-4000-8000-000000000001') = 3, 'an adult with an RSVP gets a push now and two reminders');
select pg_temp.assert((select count(*) from app.messages where template_key = 'event_survey' and payload->>'survey_id' = :'sv' and scheduled_at <= now() + interval '1 minute') >= 1, 'the first push is for now');
select pg_temp.assert((select body from app.messages where template_key = 'event_survey' and payload->>'survey_id' = :'sv' limit 1) like '%Earn 25 points%', 'the message tells them the points');

begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select pg_temp.assert((select count(*) from app.surveys where id = :'sv') = 1, 'the member can see the open survey');
select pg_temp.assert((app.submit_survey(:'sv', '{"q1": 5}'::jsonb, true)->>'points')::int = 25, 'answering gives the points');
select pg_temp.assert((select points from app.points_ledger where ref_id = :'sv' and person_id = '30000000-0000-4000-8000-000000000001' and reason = 'survey') = 25, 'the points are in the ledger');
select pg_temp.assert((select count(*) from app.messages where payload->>'survey_id' = :'sv' and person_id = '30000000-0000-4000-8000-000000000001' and status = 'queued') = 0, 'reminders stop after answering');
do $$ begin
  perform app.submit_survey((select id from app.surveys where event_id = '50000000-0000-4000-8000-0000000000e1'), '{"q1": 1}'::jsonb, false);
  raise exception 'FAIL: answered twice';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: a survey can be answered once (and points once)';
end $$;
commit;
select pg_temp.assert((select count(*) from app.survey_responses where survey_id = :'sv' and person_id is null) = 1, 'an anonymous answer stores no person');
select pg_temp.assert((select count(*) from app.points_ledger where ref_id = :'sv') = 1, 'points were given once');

-- 0549: the anonymous answer, its completion and its points share only the day.
select pg_temp.assert((select submitted_at from app.survey_responses where survey_id = :'sv' and person_id is null) = date_trunc('day', (select completed_at from app.survey_completions where survey_id = :'sv' limit 1)), 'an anonymous answer and its completion carry only the day');
select pg_temp.assert((select completed_at from app.survey_completions where survey_id = :'sv' limit 1) = date_trunc('day', (select completed_at from app.survey_completions where survey_id = :'sv' limit 1)), 'the completion time of an anonymous answer is midnight');
