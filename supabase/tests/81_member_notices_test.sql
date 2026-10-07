-- 0596: event feedback, lunch and boli pushes are queued for the sender (they were rows nothing ever sent).
-- Each new row goes to the member's login, with purpose notification and a messaging.send job whose run_after is
-- its scheduled_at; only people with a login AND a working phone get one; quiet hours hold the survey push but not the
-- lunch reminder (event day); the lunch reminder follows Settings › Rules (minutes before, 0 = off) and a moved slot
-- replaces it; a boli tells the family that was on top, and a family that pledges more loses its own waiting notice;
-- the route (survey_id, deep_link, ids) is at the top level of the payload; the push resolves to the member's phones;
-- answering, closing the survey and closing the boli cancel what is waiting (jobs too); an expired notice and a topic
-- the member switched off are not sent; a switched-off trigger queues nothing; a sandbox refusal or a missing login
-- never breaks the pledge, the check-in or the event completion; the old rows are cancelled, not sent, not deleted;
-- and no queued row is left without a job (keyword replies aside).
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.sign_in(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
-- The notices of one kind about one thing (survey, event or boli id in the payload's top level).
create or replace function pg_temp.notices(p_templates text[], p_key text, p_id text) returns setof app.messages language sql stable as $$
  select * from app.messages where template_key = any (p_templates) and payload->>p_key = p_id $$;
-- Quiet hours that cover the community's current hour and the next one (end = two hours on, at the top of the hour).
create or replace function pg_temp.quiet_now(p_center uuid) returns void language sql as $$
  update app.centers
     set rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object('notifications',
                   coalesce(rules->'notifications', '{}'::jsonb)
                   || jsonb_build_object('quiet_start_hour', extract(hour from now() at time zone time_zone)::int,
                                         'quiet_end_hour', (extract(hour from now() at time zone time_zone)::int + 2) % 24))
   where id = p_center $$;
create or replace function pg_temp.no_quiet(p_center uuid) returns void language sql as $$
  update app.centers
     set rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object('notifications',
                   coalesce(rules->'notifications', '{}'::jsonb) || '{"quiet_start_hour": 0, "quiet_end_hour": 0}'::jsonb)
   where id = p_center $$;
create or replace function pg_temp.set_trigger(p_center uuid, p_trigger text, p_on boolean) returns void language sql as $$
  update app.centers
     set rules = jsonb_set(coalesce(rules, '{}'::jsonb) || jsonb_build_object('notifications', coalesce(rules->'notifications', '{}'::jsonb)),
                           array['notifications', 'triggers'],
                           coalesce(rules #> '{notifications,triggers}', '{}'::jsonb) || jsonb_build_object(p_trigger, p_on))
   where id = p_center $$;

grant connect_worker to postgres;

\set p '''81000000-0000-4000-8000-0000000000c1'''
\set sb '''81000000-0000-4000-8000-0000000000c2'''
\set u_admin '''81000000-0000-4000-8000-0000000000a1'''
\set u_asha '''81000000-0000-4000-8000-0000000000a2'''
\set u_bina '''81000000-0000-4000-8000-0000000000a3'''
\set u_esha '''81000000-0000-4000-8000-0000000000a4'''
\set u_sadmin '''81000000-0000-4000-8000-0000000000a5'''
\set u_gita '''81000000-0000-4000-8000-0000000000a6'''
\set u_hari '''81000000-0000-4000-8000-0000000000a7'''
\set asha '''81000000-0000-4000-8000-0000000000d1'''
\set bina '''81000000-0000-4000-8000-0000000000d2'''
\set chirag '''81000000-0000-4000-8000-0000000000d3'''
\set dev '''81000000-0000-4000-8000-0000000000d4'''
\set esha '''81000000-0000-4000-8000-0000000000d5'''
\set gita '''81000000-0000-4000-8000-0000000000d7'''
\set hari '''81000000-0000-4000-8000-0000000000d8'''
\set h1 '''81000000-0000-4000-8000-0000000000e1'''
\set h2 '''81000000-0000-4000-8000-0000000000e2'''
\set h3 '''81000000-0000-4000-8000-0000000000e3'''
\set h4 '''81000000-0000-4000-8000-0000000000e4'''
\set ev_lunch '''81000000-0000-4000-8000-0000000000f1'''
\set ev_survey '''81000000-0000-4000-8000-0000000000f2'''
\set ev_now '''81000000-0000-4000-8000-0000000000f3'''
\set ev_off '''81000000-0000-4000-8000-0000000000f4'''
\set ev_sb '''81000000-0000-4000-8000-0000000000f5'''
\set b1 '''81000000-0000-4000-8000-0000000000b1'''
\set b2 '''81000000-0000-4000-8000-0000000000b2'''
\set b3 '''81000000-0000-4000-8000-0000000000b3'''
\set b_sb '''81000000-0000-4000-8000-0000000000b4'''

-- ── Fixtures ─────────────────────────────────────────────────────────────────────
-- Production community P: the Ambani household (Asha with the app, Bina with a login but no working phone, Chirag with
-- no login, Dev aged 10) and Esha (the app) in a second household. Sandbox community SB: Gita and Hari, both with the
-- app, neither a verified test recipient.
insert into auth.users (id, email) values
  (:u_admin, 'admin81@example.com'), (:u_asha, 'asha81@example.com'), (:u_bina, 'bina81@example.com'),
  (:u_esha, 'esha81@example.com'), (:u_sadmin, 'sadmin81@example.com'), (:u_gita, 'gita81@example.com'),
  (:u_hari, 'hari81@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone, rules) values
  (:p, 'notices81', 'Notices Test Center', 'NTC', 'TX', 'active', 'America/Chicago', '{"lunch": {"reminder_minutes_before": 10}}');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone, environment) values
  (:sb, 'notices81-sandbox', 'Notices Test Center (sandbox)', 'NTS', 'TX', 'active', 'America/Chicago', 'sandbox');
insert into app.households (id, center_id, display_name) values
  (:h1, :p, 'Ambani family'), (:h2, :p, 'Desai family'), (:h3, :sb, 'Gandhi family'), (:h4, :sb, 'Hegde family');
insert into app.people (id, center_id, first_name, last_name, email, date_of_birth) values
  (:asha, :p, 'Asha', 'Ambani', 'asha81@example.com', '1980-02-01'),
  (:bina, :p, 'Bina', 'Ambani', 'bina81@example.com', '1982-03-01'),
  (:chirag, :p, 'Chirag', 'Ambani', null, '1950-04-01'),
  (:dev, :p, 'Dev', 'Ambani', null, current_date - interval '10 years'),
  (:esha, :p, 'Esha', 'Desai', 'esha81@example.com', '1985-05-01'),
  (:gita, :sb, 'Gita', 'Gandhi', 'gita81@example.com', '1979-06-01'),
  (:hari, :sb, 'Hari', 'Hegde', 'hari81@example.com', '1981-07-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :asha, :p, 'primary', true), (:h1, :bina, :p, 'spouse', false), (:h1, :chirag, :p, 'other', false),
  (:h1, :dev, :p, 'child', false), (:h2, :esha, :p, 'primary', true),
  (:h3, :gita, :sb, 'primary', true), (:h4, :hari, :sb, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values
  (:p, :u_asha, :asha), (:p, :u_bina, :bina), (:p, :u_esha, :esha), (:sb, :u_gita, :gita), (:sb, :u_hari, :hari);
insert into app.role_grants (center_id, user_id, role_key, scope_kind) values
  (:p, :u_admin, 'center_admin', 'center'), (:sb, :u_sadmin, 'center_admin', 'center');
insert into app.push_devices (user_id, center_id, platform, token, last_seen_at, invalid_at) values
  (:u_asha, :p, 'ios', 'ExponentPushToken[notices81asha]', now(), null),
  (:u_asha, :p, 'android', 'ExponentPushToken[notices81ashaold]', now() - interval '90 days', now() - interval '30 days'),
  (:u_bina, :p, 'ios', 'ExponentPushToken[notices81bina]', now() - interval '60 days', now() - interval '20 days'),
  (:u_esha, :p, 'android', 'ExponentPushToken[notices81esha]', now(), null),
  (:u_gita, :sb, 'ios', 'ExponentPushToken[notices81gita]', now(), null),
  (:u_hari, :sb, 'ios', 'ExponentPushToken[notices81hari]', now(), null);

-- ── The pieces ───────────────────────────────────────────────────────────────────
select pg_temp.assert(to_regprocedure('app.enqueue_message(uuid,text,text,text,jsonb,text)') is not null
                      and to_regprocedure('app.enqueue_message_at(uuid,text,text,text,jsonb,text,timestamptz)') is not null,
  'enqueue_message keeps its exact six-argument signature; enqueue_message_at takes the send time');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.enqueue_message_at(uuid,text,text,text,jsonb,text,timestamptz)', 'execute')
                      and not has_function_privilege('anon', 'app.enqueue_message_at(uuid,text,text,text,jsonb,text,timestamptz)', 'execute')
                      and not has_function_privilege('authenticated', 'app.enqueue_message(uuid,text,text,text,jsonb,text)', 'execute')
                      and not has_function_privilege('anon', 'app.enqueue_message(uuid,text,text,text,jsonb,text)', 'execute'),
  'neither enqueue function is callable over the API');
select pg_temp.assert(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname in ('_member_push', '_lunch_reminder', 'cancel_unconnected_member_notices',
                                               'messages_cancel_waiting_job', 'surveys_cancel_waiting_pushes', 'bolis_cancel_waiting_notices')
       and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'the helpers and trigger functions are not callable over the API');
select pg_temp.assert((select count(*) = 15 and bool_and(p.prosecdef and exists (select 1 from unnest(p.proconfig) as g(setting)
                                                                                   where g.setting ~ '^search_path=app, *public, *extensions$'))
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname in ('enqueue_message_at', 'enqueue_message', 'worker_message_to_send', '_member_push',
                          '_lunch_reminder', 'cancel_unconnected_member_notices', 'messages_cancel_waiting_job', 'surveys_cancel_waiting_pushes',
                          'bolis_cancel_waiting_notices', 'launch_event_survey', 'launch_event_survey_now', 'assign_lunch_for_rsvp',
                          'move_lunch_slot', 'place_boli_entry', 'check_in')),
  'every new or replaced function is security definer and pins search_path = app, public, extensions');
select pg_temp.assert((select count(*) from app.message_templates
                        where center_id is null and channel = 'push' and language = 'en'
                          and key in ('event_survey', 'event_survey_reminder', 'lunch_reminder', 'boli_outbid')) = 4,
  'the four notices have platform push templates');
select pg_temp.assert((select bool_and(body !~* '\mbid' and coalesce(subject, '') !~* '\mbid' and body ~* 'pledge')
                         from app.message_templates where center_id is null and key = 'boli_outbid'),
  'the boli notice says "pledge", never "bid"');

-- ── Lunch: quiet hours do not hold it; Settings › Rules sets the minutes ─────────────
select pg_temp.quiet_now(:p);
insert into app.events (id, center_id, name, starts_at, ends_at, status, lunch_enabled, lunch_starts_at, lunch_slot_minutes, lunch_seats_per_slot)
  values (:ev_lunch, :p, 'Lunch event 81', now() - interval '1 hour', now() + interval '3 hours', 'live', true, now() + interval '30 minutes', 15, 10);
insert into app.rsvps (id, center_id, event_id, household_id, status) values
  ('81000000-0000-4000-8000-000000000101', :p, :ev_lunch, :h1, 'confirmed'),
  ('81000000-0000-4000-8000-000000000102', :p, :ev_lunch, :h2, 'confirmed');
insert into app.attendees (center_id, event_id, rsvp_id, person_id, display_name, is_child_under_12, ticket_token) values
  (:p, :ev_lunch, '81000000-0000-4000-8000-000000000101', :asha, 'Asha Ambani', false, 'tok81-asha'),
  (:p, :ev_lunch, '81000000-0000-4000-8000-000000000101', :chirag, 'Chirag Ambani', false, null),
  (:p, :ev_lunch, '81000000-0000-4000-8000-000000000101', :dev, 'Dev Ambani', true, null),
  (:p, :ev_lunch, '81000000-0000-4000-8000-000000000101', :bina, 'Bina Ambani', false, null),
  (:p, :ev_lunch, '81000000-0000-4000-8000-000000000102', :esha, 'Esha Desai', false, 'tok81-esha');

begin;
select pg_temp.sign_in(:u_admin);
select pg_temp.assert((select result from app.check_in(:ev_lunch::uuid, 'tok81-asha')) = 'ok',
  'checking in a family with no login (Chirag), no phone (Bina) and a child (Dev) works');
select pg_temp.assert((select result from app.check_in(:ev_lunch::uuid, 'tok81-asha')) = 'duplicate', 'a second scan is a duplicate');
commit;
select (select s.starts_at from app.attendees a join app.lunch_slots s on s.id = a.lunch_slot_id where a.person_id = :asha and a.event_id = :ev_lunch) as slot1 \gset
select pg_temp.assert((select count(*) from pg_temp.notices(array['lunch_reminder'], 'event_id', :ev_lunch)) = 1
                      and (select person_id from pg_temp.notices(array['lunch_reminder'], 'event_id', :ev_lunch)) = :asha,
  'one lunch reminder, to Asha: only a person with a login and a working phone gets one, and a second scan adds none');
select pg_temp.assert((select m.to_address = :u_asha and m.purpose = 'notification' and m.status = 'queued' and m.channel = 'push'
                               and m.topic_key = 'events' and j.kind = 'messaging.send' and j.status = 'queued' and j.run_after = m.scheduled_at
                          from pg_temp.notices(array['lunch_reminder'], 'event_id', :ev_lunch) m join app.jobs j on j.id = m.job_id),
  'it goes to her login, as a notification, with a messaging.send job that runs at the scheduled time');
select pg_temp.assert((select m.scheduled_at = :'slot1'::timestamptz - interval '10 minutes' and m.expires_at = :'slot1'::timestamptz
                               and app.messaging_quiet_until(:p, m.scheduled_at) is not null
                          from pg_temp.notices(array['lunch_reminder'], 'event_id', :ev_lunch) m),
  'it is due 10 minutes before the slot (Settings › Rules), inside quiet hours and not held by them (event day), and expires when the slot starts');
select pg_temp.assert((select m.subject = 'Lunch at ' || to_char(:'slot1'::timestamptz at time zone 'America/Chicago', 'FMHH12:MI AM')
                               and m.body = 'Your lunch slot at Lunch event 81 starts at ' || to_char(:'slot1'::timestamptz at time zone 'America/Chicago', 'FMHH12:MI AM') || '.'
                               and m.payload->>'slot_id' is not null and m.payload->'vars'->>'person_id' = :asha
                          from pg_temp.notices(array['lunch_reminder'], 'event_id', :ev_lunch) m),
  'it says the slot''s time in the community''s time zone, and the slot is at the top level of the payload');

-- A moved slot replaces the reminder (and its job).
select id as old_lunch, job_id as old_lunch_job from pg_temp.notices(array['lunch_reminder'], 'event_id', :ev_lunch) \gset
select id as slot3, starts_at as slot3_at from app.lunch_slots where event_id = :ev_lunch order by starts_at offset 2 limit 1 \gset
begin;
select pg_temp.sign_in(:u_asha);
select pg_temp.assert(app.move_lunch_slot(array(select id from app.attendees where rsvp_id = '81000000-0000-4000-8000-000000000101'), :'slot3'::uuid) = 4,
  'Asha moves her family to a later slot');
commit;
select pg_temp.assert((select status = 'cancelled' and failure_reason like 'Not sent: the lunch time changed%' from app.messages where id = :'old_lunch')
                      and (select status = 'cancelled' from app.jobs where id = :'old_lunch_job'),
  'the old reminder is cancelled, and so is its job');
select pg_temp.assert((select count(*) from pg_temp.notices(array['lunch_reminder'], 'event_id', :ev_lunch) m
                        where m.status = 'queued' and m.person_id = :asha and m.payload->>'slot_id' = :'slot3'
                          and m.scheduled_at = :'slot3_at'::timestamptz - interval '10 minutes' and m.expires_at = :'slot3_at'::timestamptz
                          and m.job_id is not null) = 1,
  'a new reminder is queued for the new slot');

-- 0 minutes = off; a switched-off trigger queues nothing; switched back on, the next scan queues it.
update app.centers set rules = rules || '{"lunch": {"reminder_minutes_before": 0}}' where id = :p;
begin;
select pg_temp.sign_in(:u_admin);
select pg_temp.assert((select result from app.check_in(:ev_lunch::uuid, 'tok81-esha')) = 'ok', 'Esha checks in');
commit;
select pg_temp.assert((select count(*) from pg_temp.notices(array['lunch_reminder'], 'event_id', :ev_lunch) where person_id = :esha) = 0,
  'with the reminder set to 0 minutes there is none');
update app.centers set rules = rules || '{"lunch": {"reminder_minutes_before": 5}}' where id = :p;
select pg_temp.set_trigger(:p, 'lunch_reminder', false);
begin;
select pg_temp.sign_in(:u_admin);
select app.check_in(:ev_lunch::uuid, 'tok81-esha');
commit;
select pg_temp.assert((select count(*) from pg_temp.notices(array['lunch_reminder'], 'event_id', :ev_lunch) where person_id = :esha) = 0,
  'with the lunch reminder switched off in Settings › Notifications there is none');
select pg_temp.set_trigger(:p, 'lunch_reminder', true);
begin;
select pg_temp.sign_in(:u_admin);
select app.check_in(:ev_lunch::uuid, 'tok81-esha');
commit;
select pg_temp.assert((select count(*) from pg_temp.notices(array['lunch_reminder'], 'event_id', :ev_lunch) m
                        where m.person_id = :esha and m.status = 'queued'
                          and m.scheduled_at = (select s.starts_at - interval '5 minutes' from app.lunch_slots s where s.id::text = m.payload->>'slot_id')) = 1,
  'switched back on, the next scan queues it, 5 minutes before her slot');

-- ── Event feedback: the people, the timing, the route ─────────────────────────────
insert into app.events (id, center_id, name, starts_at, ends_at, status, capacity) values
  (:ev_survey, :p, 'Survey event 81', now() - interval '2 days', now() - interval '1 day', 'published', 100),
  (:ev_now, :p, 'Send-now event 81', now() - interval '2 days', now() - interval '1 day', 'published', 100),
  (:ev_off, :p, 'Trigger-off event 81', now() - interval '2 days', now() - interval '1 day', 'published', 100);
insert into app.rsvps (center_id, event_id, household_id, status) values
  (:p, :ev_survey, :h1, 'confirmed'), (:p, :ev_survey, :h2, 'confirmed'),
  (:p, :ev_now, :h1, 'confirmed'), (:p, :ev_now, :h2, 'attended'),
  (:p, :ev_off, :h1, 'confirmed');
begin;
select pg_temp.sign_in(:u_admin);
select app.attach_event_survey(:ev_survey::uuid, null, 'Survey event 81 feedback',
  '[{"id":"q1","type":"rating","label":"How was it?","options":[],"required":true}]'::jsonb, 20, true) as sv \gset
select app.attach_event_survey(:ev_now::uuid, null, 'Send-now feedback',
  '[{"id":"q1","type":"rating","label":"How was it?","options":[],"required":true}]'::jsonb, 0, false) as sv_now \gset
select app.attach_event_survey(:ev_off::uuid, null, 'Trigger-off feedback',
  '[{"id":"q1","type":"rating","label":"How was it?","options":[],"required":true}]'::jsonb, 0, true) as sv_off \gset
commit;

-- Quiet hours are on now (pg_temp.quiet_now above): the survey push waits for them to end.
update app.events set status = 'completed' where id = :ev_survey;
select pg_temp.assert((select status from app.surveys where id = :'sv') = 'open', 'completing the event opens the survey');
select pg_temp.assert((select count(*) from pg_temp.notices(array['event_survey', 'event_survey_reminder'], 'survey_id', :'sv')) = 6
                      and (select array_agg(distinct person_id order by person_id) from pg_temp.notices(array['event_survey', 'event_survey_reminder'], 'survey_id', :'sv'))
                          = array[:asha, :esha]::uuid[],
  'Asha and Esha (the app) each get a push and two reminders; Bina (no working phone), Chirag (no login) and Dev (a child) get none');
select pg_temp.assert((select bool_and(m.to_address = cu.user_id::text and m.purpose = 'notification' and m.status = 'queued' and m.channel = 'push'
                                       and m.topic_key = 'events' and m.expires_at = s.closes_at
                                       and j.kind = 'messaging.send' and j.status = 'queued' and j.run_after = m.scheduled_at)
                         from pg_temp.notices(array['event_survey', 'event_survey_reminder'], 'survey_id', :'sv') m
                         join app.center_users cu on cu.center_id = m.center_id and cu.person_id = m.person_id
                         join app.jobs j on j.id = m.job_id
                         join app.surveys s on s.id = :'sv'),
  'every one goes to the person''s login as a notification, expires when the survey closes, and has a messaging.send job due at its scheduled time');
select pg_temp.assert((select count(*) from pg_temp.notices(array['event_survey'], 'survey_id', :'sv') m
                        where m.scheduled_at > m.created_at + interval '30 minutes' and m.scheduled_at = app.messaging_quiet_until(:p, m.created_at)) = 2
                      and (select count(*) from pg_temp.notices(array['event_survey_reminder'], 'survey_id', :'sv') m
                            where m.scheduled_at in (coalesce(app.messaging_quiet_until(:p, m.created_at + interval '1 day'), m.created_at + interval '1 day'),
                                                     coalesce(app.messaging_quiet_until(:p, m.created_at + interval '2 days'), m.created_at + interval '2 days'))) = 4
                      and (select count(distinct (person_id, scheduled_at)) from pg_temp.notices(array['event_survey_reminder'], 'survey_id', :'sv')) = 4,
  'the push is for now, held until quiet hours end; the reminders are for day 1 and day 2, each held the same way');
select pg_temp.assert((select bool_and(m.payload->>'survey_id' = :'sv' and m.payload->>'event_id' = :ev_survey
                                       and m.payload->>'deep_link' = 'survey/' || :'sv' and m.payload->'reward_points' = '20'::jsonb
                                       and m.payload->'vars'->>'person_id' = m.person_id::text)
                         from pg_temp.notices(array['event_survey', 'event_survey_reminder'], 'survey_id', :'sv') m),
  'survey_id, event_id, deep_link and reward_points are at the top level of the payload, where the worker reads them');
select pg_temp.assert((select subject = 'Survey event 81 · feedback' and body = 'How was Survey event 81? Share your feedback. Earn 20 points.'
                         from pg_temp.notices(array['event_survey'], 'survey_id', :'sv') where person_id = :asha),
  'the push names the event and the points, nothing else');

-- What the sender gets: Asha's working phone only, the route, no template variables.
select id as asha_push from pg_temp.notices(array['event_survey'], 'survey_id', :'sv') where person_id = :asha \gset
select id as esha_push from pg_temp.notices(array['event_survey'], 'survey_id', :'sv') where person_id = :esha \gset
begin;
set local role connect_worker;
select app.worker_message_to_send(:'asha_push') as w \gset
reset role;
commit;
select pg_temp.assert((:'w'::jsonb->>'skip') is null and (:'w'::jsonb->'route'->>'provider') = 'expo_push'
                      and (:'w'::jsonb->'route'->'tokens') = '["ExponentPushToken[notices81asha]"]'::jsonb,
  'the push resolves to Asha''s working phone (not her old, invalid one)');
select pg_temp.assert((:'w'::jsonb->'payload'->>'survey_id') = :'sv' and (:'w'::jsonb->'payload'->>'deep_link') = 'survey/' || :'sv'
                      and not (:'w'::jsonb->'payload' ? 'vars') and (:'w'::jsonb->>'purpose') = 'notification',
  'the sender gets the route at the top level of the payload and no template variables');

-- Answering cancels her pushes (and their jobs); Esha's stay.
begin;
select pg_temp.sign_in(:u_asha);
select pg_temp.assert((app.submit_survey(:'sv'::uuid, '{"q1": 5}'::jsonb, false)->>'points')::int = 20, 'Asha answers');
commit;
select pg_temp.assert((select count(*) from pg_temp.notices(array['event_survey', 'event_survey_reminder'], 'survey_id', :'sv') m
                         join app.jobs j on j.id = m.job_id
                        where m.person_id = :asha and m.status = 'cancelled' and j.status = 'cancelled') = 3
                      and (select count(*) from pg_temp.notices(array['event_survey', 'event_survey_reminder'], 'survey_id', :'sv')
                            where person_id = :esha and status = 'queued') = 3,
  'answering cancels her push and reminders, and their jobs; Esha''s still wait');

-- A topic switched off in the app is not sent; switched back on, the next one goes.
insert into app.notification_preferences (center_id, person_id, topic_key, channel, enabled) values (:p, :esha, 'events', 'push', false);
begin;
set local role connect_worker;
select app.worker_message_to_send(:'esha_push')->>'skip' as esha_skip \gset
reset role;
commit;
select pg_temp.assert(:'esha_skip' = 'Not sent: the member switched off "Events and reminders" push notifications in the app.',
  'a push whose topic the member switched off in the app is not sent, with a plain reason');
update app.notification_preferences set enabled = true where person_id = :esha and topic_key = 'events' and channel = 'push';
select id as esha_day1 from pg_temp.notices(array['event_survey_reminder'], 'survey_id', :'sv') where person_id = :esha order by scheduled_at limit 1 \gset
select id as esha_day2 from pg_temp.notices(array['event_survey_reminder'], 'survey_id', :'sv') where person_id = :esha order by scheduled_at desc limit 1 \gset
begin;
set local role connect_worker;
select pg_temp.assert((app.worker_message_to_send(:'esha_day1')->>'skip') is null, 'switched back on, her next reminder goes');
reset role;
commit;

-- An expired notice is cancelled with a reason, not sent late; its job goes too.
update app.messages set expires_at = now() - interval '1 minute' where id = :'esha_day2';
begin;
set local role connect_worker;
select app.worker_message_to_send(:'esha_day2')->>'skip' as day2_skip \gset
reset role;
commit;
select pg_temp.assert(:'day2_skip' like 'The message is already cancelled%'
                      and (select status = 'cancelled' and failure_reason like 'Not sent: it was no longer useful by the time it was due (it expired on %'
                             from app.messages where id = :'esha_day2')
                      and (select j.status = 'cancelled' from app.jobs j join app.messages m on m.job_id = j.id where m.id = :'esha_day2'),
  'an expired notice is cancelled with a plain reason (the sender records nothing over it), and its job is cancelled');

-- "Send survey" from the event's Survey tab counts the people who got a push.
update app.events set status = 'completed' where id = :ev_now;
begin;
select pg_temp.sign_in(:u_admin);
select pg_temp.assert(app.launch_event_survey_now(:'sv_now'::uuid) = 2, 'Send survey says 2: Asha and Esha got a push');
select pg_temp.assert((app.event_survey_stats(:'sv_now'::uuid)->>'invited')::int = 4, 'while 4 adults are invited (Asha, Bina, Chirag, Esha)');
commit;
-- Closing the survey cancels what is waiting.
update app.surveys set status = 'closed' where id = :'sv_now';
select pg_temp.assert((select count(*) from pg_temp.notices(array['event_survey', 'event_survey_reminder'], 'survey_id', :'sv_now')
                        where status = 'cancelled' and failure_reason = 'Not sent: the survey closed before it went.') = 6
                      and not exists (select 1 from pg_temp.notices(array['event_survey', 'event_survey_reminder'], 'survey_id', :'sv_now') m
                                       join app.jobs j on j.id = m.job_id where j.status = 'queued'),
  'closing the survey cancels its waiting pushes and their jobs');

-- The community switched event feedback off: the survey still opens, nobody is pushed.
select pg_temp.set_trigger(:p, 'event_feedback', false);
update app.events set status = 'completed' where id = :ev_off;
select pg_temp.assert((select status from app.surveys where id = :'sv_off') = 'open'
                      and (select count(*) from pg_temp.notices(array['event_survey', 'event_survey_reminder'], 'survey_id', :'sv_off')) = 0,
  'with event feedback switched off the survey opens and no push is queued');
select pg_temp.set_trigger(:p, 'event_feedback', true);

-- ── Bolis ────────────────────────────────────────────────────────────────────────
select pg_temp.no_quiet(:p);
insert into app.bolis (id, center_id, name, kind, floor_cents, step_cents, status, closes_at) values
  (:b1, :p, 'Aarti labh 81', 'digital', 10000, 1000, 'open', now() + interval '2 days'),
  (:b2, :p, 'Mangal divo 81', 'digital', 10000, 1000, 'open', now() + interval '2 days');
insert into app.bolis (id, center_id, name, kind, floor_cents, step_cents, status, closes_at, soft_close_minutes) values
  (:b3, :p, 'Shanti kalash 81', 'digital', 10000, 1000, 'open', now() + interval '5 minutes', 10);
begin;
select pg_temp.sign_in(:u_asha);
select app.place_boli_entry(:b1::uuid, :h1::uuid, 10000);
commit;
select pg_temp.assert((select count(*) from pg_temp.notices(array['boli_outbid'], 'boli_id', :b1)) = 0, 'the first pledge tells nobody');
begin;
select pg_temp.sign_in(:u_esha);
select app.place_boli_entry(:b1::uuid, :h2::uuid, 11000);
commit;
select pg_temp.assert((select count(*) from pg_temp.notices(array['boli_outbid'], 'boli_id', :b1)) = 1
                      and (select m.person_id = :asha and m.to_address = :u_asha and m.status = 'queued' and m.topic_key = 'giving'
                                  and m.purpose = 'notification' and m.expires_at = (select closes_at from app.bolis where id = :b1)
                                  and m.scheduled_at <= now() and j.run_after = m.scheduled_at and j.kind = 'messaging.send'
                                  and m.subject = 'Another family pledged more'
                                  and m.body = 'Another family pledged more for Aarti labh 81. Open the app to see the latest pledge.'
                             from pg_temp.notices(array['boli_outbid'], 'boli_id', :b1) m join app.jobs j on j.id = m.job_id),
  'when Esha pledges more, Asha (on top until then) gets "another family pledged more" now, until the boli closes');
select id as asha_outbid, job_id as asha_outbid_job from pg_temp.notices(array['boli_outbid'], 'boli_id', :b1) \gset
begin;
select pg_temp.sign_in(:u_asha);
select app.place_boli_entry(:b1::uuid, :h1::uuid, 12000);
commit;
select pg_temp.assert((select status = 'cancelled' and failure_reason = 'Not sent: they pledged more before it went.' from app.messages where id = :'asha_outbid')
                      and (select status = 'cancelled' from app.jobs where id = :'asha_outbid_job')
                      and (select count(*) from pg_temp.notices(array['boli_outbid'], 'boli_id', :b1) where person_id = :esha and status = 'queued') = 1,
  'when Asha pledges more, her own waiting notice (and its job) is cancelled and Esha is told');
begin;
select pg_temp.sign_in(:u_asha);
select app.place_boli_entry(:b1::uuid, :h1::uuid, 13000);
commit;
select pg_temp.assert((select count(*) from pg_temp.notices(array['boli_outbid'], 'boli_id', :b1)) = 2,
  'a family raising its own top pledge tells nobody');
update app.bolis set status = 'closed' where id = :b1;
select pg_temp.assert((select status = 'cancelled' and failure_reason = 'Not sent: the boli closed before it went.'
                         from pg_temp.notices(array['boli_outbid'], 'boli_id', :b1) where person_id = :esha),
  'closing the boli cancels the notice still waiting');

select pg_temp.set_trigger(:p, 'boli_outbid', false);
begin;
select pg_temp.sign_in(:u_asha);
select app.place_boli_entry(:b2::uuid, :h1::uuid, 10000);
select pg_temp.sign_in(:u_esha);
select app.place_boli_entry(:b2::uuid, :h2::uuid, 11000);
commit;
select pg_temp.assert((select count(*) from app.boli_entries where boli_id = :b2) = 2
                      and (select count(*) from pg_temp.notices(array['boli_outbid'], 'boli_id', :b2)) = 0,
  'with boli notices switched off the pledges are taken and nobody is pushed');
select pg_temp.set_trigger(:p, 'boli_outbid', true);

-- Soft close: the notice lasts until the extended close.
begin;
select pg_temp.sign_in(:u_asha);
select app.place_boli_entry(:b3::uuid, :h1::uuid, 10000);
select pg_temp.sign_in(:u_esha);
select app.place_boli_entry(:b3::uuid, :h2::uuid, 11000);
commit;
select pg_temp.assert((select m.expires_at = b.extended_until and b.extended_until > b.closes_at
                         from pg_temp.notices(array['boli_outbid'], 'boli_id', :b3) m join app.bolis b on b.id = :b3),
  'a pledge in the soft-close window extends the boli, and the notice lasts until the extended close');

-- ── A sandbox: refusals never break the pledge, the check-in or the completion ──────
insert into app.bolis (id, center_id, name, kind, floor_cents, step_cents, status, closes_at) values
  (:b_sb, :sb, 'Sandbox boli 81', 'digital', 10000, 1000, 'open', now() + interval '2 days');
insert into app.events (id, center_id, name, starts_at, ends_at, status, lunch_enabled, lunch_starts_at, lunch_slot_minutes, lunch_seats_per_slot)
  values (:ev_sb, :sb, 'Sandbox event 81', now() - interval '1 hour', now() + interval '3 hours', 'live', true, now() + interval '30 minutes', 15, 10);
insert into app.rsvps (id, center_id, event_id, household_id, status) values ('81000000-0000-4000-8000-000000000103', :sb, :ev_sb, :h3, 'confirmed');
insert into app.attendees (center_id, event_id, rsvp_id, person_id, display_name, ticket_token) values
  (:sb, :ev_sb, '81000000-0000-4000-8000-000000000103', :gita, 'Gita Gandhi', 'tok81-gita');
select count(*) as audit_before from app.audit_log where action = 'member_notice.not_sent' and record_id = :gita \gset
begin;
select pg_temp.sign_in(:u_gita);
select app.place_boli_entry(:b_sb::uuid, :h3::uuid, 10000);
select pg_temp.sign_in(:u_hari);
select pg_temp.assert(app.place_boli_entry(:b_sb::uuid, :h4::uuid, 11000) is not null, 'in a sandbox Hari''s pledge is taken');
select pg_temp.sign_in(:u_sadmin);
select pg_temp.assert((select result from app.check_in(:ev_sb::uuid, 'tok81-gita')) = 'ok', 'and Gita''s check-in works');
select app.attach_event_survey(:ev_sb::uuid, null, 'Sandbox feedback',
  '[{"id":"q1","type":"rating","label":"How was it?","options":[],"required":true}]'::jsonb, 0, true) as sv_sb \gset
commit;
update app.events set status = 'completed' where id = :ev_sb;
select pg_temp.assert((select status from app.surveys where id = :'sv_sb') = 'open', 'and completing the event opens its survey');
select pg_temp.assert(not exists (select 1 from app.messages where center_id = :sb and person_id = :gita),
  'nothing is queued to Gita: she is not a verified test recipient');
select pg_temp.assert((select count(*) from app.audit_log where action = 'member_notice.not_sent' and record_table = 'people' and record_id = :gita
                          and after->>'sqlstate' = 'CCENT' and after->>'error' = 'Sandboxes can send only to verified test recipients.') - :audit_before >= 3
                      and exists (select 1 from app.audit_log where action = 'member_notice.not_sent' and record_id = :gita and after->>'template' = 'boli_outbid')
                      and exists (select 1 from app.audit_log where action = 'member_notice.not_sent' and record_id = :gita and after->>'template' = 'lunch_reminder')
                      and exists (select 1 from app.audit_log where action = 'member_notice.not_sent' and record_id = :gita and after->>'template' = 'event_survey'),
  'each refusal is written to the audit log as member_notice.not_sent (boli, lunch, survey), with the reason');
-- A verified tester does get the sandbox's notice, marked as test data.
insert into app.sandbox_test_recipients (center_id, channel, address, verified_at) values (:sb, 'push', 'gita81@example.com', now());
begin;
select pg_temp.sign_in(:u_gita);
select app.place_boli_entry(:b_sb::uuid, :h3::uuid, 12000);
select pg_temp.sign_in(:u_hari);
select app.place_boli_entry(:b_sb::uuid, :h4::uuid, 13000);
commit;
select pg_temp.assert((select m.status = 'queued' and m.sandbox and m.body like 'Sandbox · test data: Another family pledged more for Sandbox boli 81.%'
                               and m.job_id is not null
                          from pg_temp.notices(array['boli_outbid'], 'boli_id', :b_sb) m where m.person_id = :gita),
  'once Gita is a verified test recipient her notice is queued, marked as sandbox test data');

-- ── The old rows: cancelled with a reason, never sent, never deleted ───────────────
insert into app.messages (center_id, person_id, channel, topic_key, template_key, body, payload, scheduled_at) values
  (:p, :asha, 'push', 'events', 'event_survey', 'How was it?', jsonb_build_object('survey_id', :'sv'), now() - interval '20 days'),
  (:p, :asha, 'push', 'events', 'event_survey_reminder', 'How was it?', jsonb_build_object('survey_id', :'sv'), now() - interval '19 days'),
  (:p, :asha, 'push', 'events', 'lunch_reminder', 'Lunch in 5 minutes', jsonb_build_object('event_id', :ev_lunch), now() - interval '30 days'),
  (:p, :esha, 'push', 'giving', 'boli_outbid', 'Another family pledged more', jsonb_build_object('boli_id', :b1), now() - interval '10 days'),
  (:p, :esha, 'push', 'events', 'some_other_notice', 'Not one of the four', '{}'::jsonb, now() - interval '10 days');
select count(*) as old_rows from app.messages where center_id = :p and job_id is null and purpose is null \gset
select pg_temp.assert(app.cancel_unconnected_member_notices() = 4, 'the four old rows are cancelled');
select pg_temp.assert((select count(*) from app.messages where center_id = :p and job_id is null and purpose is null) = :old_rows
                      and (select count(*) from app.messages where center_id = :p and job_id is null and purpose is null and status = 'cancelled'
                              and failure_reason = 'Not sent: queued before this notice was connected to the sender (fixed in 0596); too old to send now.') = 4
                      and (select status from app.messages where center_id = :p and template_key = 'some_other_notice') = 'queued',
  'with the reason; none is deleted, none gets a job, and other rows are left alone');
update app.messages set status = 'cancelled', failure_reason = 'Test fixture' where center_id = :p and template_key = 'some_other_notice';

-- ── The invariant ────────────────────────────────────────────────────────────────
select pg_temp.assert(not exists (select 1 from app.messages
                                   where status = 'queued' and job_id is null and not coalesce((payload->>'keyword_reply')::boolean, false)),
  'no message is queued without a job (STOP/HELP replies aside, which the webhook sends itself)');
