-- 0547: the Survey tab on an event: who can see and change an event's survey (events.manage or this event's lead),
-- edit / remove only before launch, "launch now" for a completed event, and the analytics numbers.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.assert_raises(stmt text, expect text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if position(lower(expect) in lower(sqlerrm)) = 0 then raise exception 'FAIL: % (got "%")', label, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.sign_in(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- The survey numbers as a given user (only the JWT claim is switched; the function is security definer).
create or replace function pg_temp.stat(p_user uuid, p_survey uuid, p_key text) returns int language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  return (app.event_survey_stats(p_survey)->>p_key)::int;
end $$;

\set jsh '''00000000-0000-4000-8000-000000000001'''
\set lead '''10000000-0000-4000-8000-0000000000f1'''
\set otherlead '''10000000-0000-4000-8000-0000000000f2'''
\set committee '''10000000-0000-4000-8000-0000000000f3'''
\set comms '''10000000-0000-4000-8000-0000000000f4'''
\set outsider '''10000000-0000-4000-8000-0000000000f5'''
\set priya '''10000000-0000-4000-8000-000000000001'''
\set evA '''50000000-0000-4000-8000-0000000000f1'''
\set evB '''50000000-0000-4000-8000-0000000000f2'''
\set evC '''50000000-0000-4000-8000-0000000000f3'''
\set evD '''50000000-0000-4000-8000-0000000000f4'''
\set hh '''20000000-0000-4000-8000-000000000001'''

insert into auth.users (id, email) values
  (:lead, 'lead47@example.com'), (:otherlead, 'otherlead47@example.com'), (:committee, 'committee47@example.com'),
  (:comms, 'comms47@example.com'), (:outsider, 'outsider47@example.com');
insert into app.events (id, center_id, name, starts_at, ends_at, status, capacity) values
  (:evA, :jsh, 'Survey tab event A', now() - interval '2 days', now() - interval '1 day', 'published', 100),
  (:evB, :jsh, 'Survey tab event B', now() - interval '2 days', now() - interval '1 day', 'published', 100),
  (:evC, :jsh, 'Survey tab event C', now() - interval '2 days', now() - interval '1 day', 'published', 100),
  (:evD, :jsh, 'Survey tab event D', now() - interval '2 days', now() - interval '1 day', 'published', 100);
insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id) values
  (:jsh, :lead, 'event_lead', 'event', :evA::uuid),
  (:jsh, :otherlead, 'event_lead', 'event', :evB::uuid),
  (:jsh, :committee, 'pathshala_committee', 'center', null),   -- events.manage, no comms
  (:jsh, :comms, 'communications_officer', 'center', null);    -- comms.view, no events.manage
insert into app.surveys (id, center_id, title, description, questions, kind, status, anonymous) values
  ('60000000-0000-4000-8000-0000000000f1', :jsh, 'Tab template 47', 'Standard', '[{"id":"q1","type":"rating","label":"How was it?","options":[],"required":true},{"id":"q2","type":"text","label":"Comments","options":[],"required":false}]'::jsonb, 'event_feedback', 'draft', false);

-- Priya RSVPs to events A and C, as a member would.
begin;
select pg_temp.sign_in(:priya);
select app.submit_rsvp(:evA::uuid, :hh::uuid, '[{"person_id":"30000000-0000-4000-8000-000000000001","name":"Priya Shah"}]') as ra \gset
select app.submit_rsvp(:evC::uuid, :hh::uuid, '[{"person_id":"30000000-0000-4000-8000-000000000001","name":"Priya Shah"}]') as rc \gset
commit;

-- ── Who can attach, see and change ─────────────────────────────────────────
begin;
select pg_temp.sign_in(:lead);
select pg_temp.assert((select count(*) from app.surveys where kind = 'event_feedback' and event_id is null and title = 'Tab template 47') = 1, 'an event lead can list the survey templates');
select app.attach_event_survey(:evA::uuid, '60000000-0000-4000-8000-0000000000f1'::uuid, null, null, 15, false, null) as sv \gset
select pg_temp.assert((select count(*) from app.surveys where id = :'sv') = 1, 'the lead can read the survey they attached');
select pg_temp.assert((select reward_points from app.surveys where id = :'sv') = 15, 'the template was copied with the points set');
select pg_temp.assert((select title from app.surveys where id = :'sv') = 'Survey tab event A · feedback', 'the survey is named after the event');
commit;

begin;
select pg_temp.sign_in(:otherlead);
select pg_temp.assert((select count(*) from app.surveys where id = :'sv') = 0, 'the lead of a different event cannot see this survey');
select pg_temp.assert_raises($$select app.update_event_survey('$$ || :'sv' || $$'::uuid, 'x', null, 5, null, null)$$, 'only event managers', 'the lead of a different event cannot edit it');
select pg_temp.assert_raises($$select app.remove_event_survey('$$ || :'sv' || $$'::uuid)$$, 'only event managers', 'the lead of a different event cannot remove it');
select pg_temp.assert_raises($$select app.event_survey_stats('$$ || :'sv' || $$'::uuid)$$, 'do not have access', 'the lead of a different event cannot read its numbers');
rollback;

begin;
select pg_temp.sign_in(:outsider);
select pg_temp.assert((select count(*) from app.surveys where kind = 'event_feedback') = 0, 'someone with no role sees no feedback surveys or templates');
select pg_temp.assert_raises($$select app.update_event_survey('$$ || :'sv' || $$'::uuid, 'x', null, 5, null, null)$$, 'only event managers', 'someone with no role cannot edit');
rollback;

begin;
select pg_temp.sign_in(:comms);
select pg_temp.assert((select count(*) from app.surveys where id = :'sv') = 1, 'communications staff still see the survey (comms.view)');
select pg_temp.assert_raises($$select app.update_event_survey('$$ || :'sv' || $$'::uuid, 'x', null, 5, null, null)$$, 'only event managers', 'communications staff cannot edit an event survey through the event');
select pg_temp.assert(pg_temp.stat(:comms, :'sv'::uuid, 'answered') = 0, 'communications staff can read the numbers');
rollback;

-- ── Edit before it launches ────────────────────────────────────────────────
begin;
select pg_temp.sign_in(:lead);
select pg_temp.assert_raises($$select app.update_event_survey('$$ || :'sv' || $$'::uuid, null, null, 1001, null, null)$$, 'between 0 and 1000', 'points above 1000 are refused');
select pg_temp.assert_raises($$select app.update_event_survey('$$ || :'sv' || $$'::uuid, null, '[]'::jsonb, null, null, null)$$, 'at least one question', 'an empty question list is refused');
select app.update_event_survey(:'sv'::uuid, 'Tell us about A', '[{"id":"q1","type":"rating","label":"Overall?","options":[],"required":true}]'::jsonb, 40, true, true);
select pg_temp.assert((select reward_points from app.surveys where id = :'sv') = 40, 'points changed');
select pg_temp.assert((select auto_on_complete from app.surveys where id = :'sv'), 'automatic launch switched on');
select pg_temp.assert((select anonymous from app.surveys where id = :'sv'), 'always anonymous set');
select pg_temp.assert((select title from app.surveys where id = :'sv') = 'Tell us about A', 'title changed');
select pg_temp.assert((select jsonb_array_length(questions) from app.surveys where id = :'sv') = 1, 'questions changed');
select app.update_event_survey(:'sv'::uuid, null, null, null, null, null);
select pg_temp.assert((select reward_points from app.surveys where id = :'sv') = 40 and (select title from app.surveys where id = :'sv') = 'Tell us about A', 'null arguments keep the current values');
select pg_temp.assert_raises($$select app.launch_event_survey_now('$$ || :'sv' || $$'::uuid)$$, 'marked completed', 'launch now waits for the event to be completed');
commit;

-- The numbers before launch: the adults of Priya's household are the audience.
select pg_temp.assert(pg_temp.stat(:committee, :'sv'::uuid, 'invited') = (
  select count(distinct hm.person_id) from app.household_members hm join app.people p on p.id = hm.person_id
   where hm.household_id = :hh::uuid and hm.left_at is null and (p.date_of_birth is null or p.date_of_birth <= current_date - interval '18 years') and not coalesce(p.is_deceased, false)
), 'invited = adults of households with an active RSVP');
select pg_temp.assert(pg_temp.stat(:committee, :'sv'::uuid, 'invited') > 0, 'the audience is not empty');

-- ── The event completes: the survey opens by itself; it can no longer be edited or removed ──
update app.events set status = 'completed' where id = :evA::uuid;
select pg_temp.assert((select status from app.surveys where id = :'sv') = 'open', 'completing the event opened the survey');
select pg_temp.assert(pg_temp.stat(:committee, :'sv'::uuid, 'invited') =
  (select count(distinct person_id) from app.messages where template_key = 'event_survey' and payload->>'survey_id' = :'sv'), 'invited matches the people the launch notified');
begin;
select pg_temp.sign_in(:lead);
select pg_temp.assert_raises($$select app.update_event_survey('$$ || :'sv' || $$'::uuid, null, null, 5, null, null)$$, 'already started', 'a launched survey cannot be edited here');
select pg_temp.assert_raises($$select app.remove_event_survey('$$ || :'sv' || $$'::uuid)$$, 'already started', 'a launched survey cannot be removed');
select pg_temp.assert_raises($$select app.launch_event_survey_now('$$ || :'sv' || $$'::uuid)$$, 'already been sent', 'a launched survey cannot be launched twice');
commit;

-- ── Answers and analytics ──────────────────────────────────────────────────
begin;
select pg_temp.sign_in(:priya);
select pg_temp.assert((app.submit_survey(:'sv'::uuid, '{"q1": 4}'::jsonb, false)->>'points')::int = 40, 'answering awards the points the event set');
commit;
select pg_temp.assert(pg_temp.stat(:committee, :'sv'::uuid, 'completions') = 1, 'one completion');
select pg_temp.assert(pg_temp.stat(:committee, :'sv'::uuid, 'responses') = 1, 'one answer');
select pg_temp.assert(pg_temp.stat(:committee, :'sv'::uuid, 'anonymous') = 1, 'the survey is always anonymous, so the answer has no person');
select pg_temp.assert(pg_temp.stat(:committee, :'sv'::uuid, 'points_awarded') = 40, 'points awarded in total');
begin;
select pg_temp.sign_in(:lead);
select pg_temp.assert((select count(*) from app.survey_responses where survey_id = :'sv') = 1, 'the lead reads the answers to their event''s survey');
select pg_temp.assert((select count(person_id) from app.survey_responses where survey_id = :'sv') = 0, 'an anonymous answer shows no person even to the event lead');
commit;
begin;
select pg_temp.sign_in(:otherlead);
select pg_temp.assert((select count(*) from app.survey_responses where survey_id = :'sv') = 0, 'the lead of a different event cannot read the answers');
rollback;

-- ── Launch now: completed event whose survey was not set to launch automatically ──
begin;
select pg_temp.sign_in(:committee);
select app.attach_event_survey(:evC::uuid, null, 'C feedback', '[{"id":"q1","type":"rating","label":"Overall?","options":[],"required":true}]'::jsonb, 10, false, false) as svc \gset
commit;
update app.events set status = 'completed' where id = :evC::uuid;
select pg_temp.assert((select status from app.surveys where id = :'svc') = 'draft', 'a survey not set to launch automatically stays a draft when the event completes');
begin;
select pg_temp.sign_in(:committee);
select pg_temp.assert((app.launch_event_survey_now(:'svc'::uuid)) >= 1, 'launch now notifies the audience');
select pg_temp.assert((select status from app.surveys where id = :'svc') = 'open', 'and opens the survey');
select pg_temp.assert_raises($$select app.launch_event_survey_now('$$ || :'svc' || $$'::uuid)$$, 'already been sent', 'it cannot be launched twice');
commit;

-- ── Remove while it is still a draft ───────────────────────────────────────
begin;
select pg_temp.sign_in(:committee);
select app.attach_event_survey(:evD::uuid, null, null, '[{"id":"q1","type":"text","label":"Anything?","options":[],"required":false}]'::jsonb, 0, true, null) as svd \gset
select app.remove_event_survey(:'svd'::uuid);
select pg_temp.assert((select count(*) from app.surveys where event_id = :evD::uuid) = 0, 'a draft survey can be removed');
select app.attach_event_survey(:evD::uuid, null, null, '[{"id":"q1","type":"text","label":"Anything?","options":[],"required":false}]'::jsonb, 0, true, null) as svd2 \gset
commit;
insert into app.survey_responses (center_id, survey_id, person_id, answers) values (:jsh, :'svd2', null, '{"q1":"hello"}'::jsonb);
begin;
select pg_temp.sign_in(:committee);
select pg_temp.assert_raises($$select app.remove_event_survey('$$ || :'svd2' || $$'::uuid)$$, 'already has answers', 'a survey with answers cannot be removed');
rollback;
