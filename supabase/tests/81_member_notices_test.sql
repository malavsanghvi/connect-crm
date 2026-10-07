-- 0596: event feedback, lunch and boli pushes are queued for the sender (they were rows nothing ever sent).
-- Each row goes to the member's login, with purpose notification and a messaging.send job due at its scheduled_at, and
-- names no creator. Only people with a login AND a working phone get one. The send time is the real one: quiet hours
-- hold the survey push, not the lunch reminder or the boli notice (event-day; owner decision 2026-10-07), unless the
-- community does not let event-day messages through at night; held until after the notice stops being useful, nothing
-- is queued and ONE member_notice.not_sent audit row says why. Marking an event completed, Send survey and Request
-- feedback do no per-person work: they take set-based counts and queue ONE surveys.launch_notify job; the worker
-- batch queues each invited adult's push and two reminders (counted from that person's first push), once per person,
-- and counts what was refused on the run. What would stop every push (a template override) is refused in a sentence.
-- Answering, closing, a moved slot and a closed boli cancel what waits (jobs too); a moved boli close moves the
-- expiry; expired and topic-off notices are not sent; switched-off triggers queue nothing; sandbox refusals and
-- missing logins never break the pledge, the check-in or the completion; move_lunch_slot moves one RSVP the caller may
-- act for (owner approved 2026-10-07); old rows and old feedback requests are never sent, never deleted; and no queued
-- row is left without a job (keyword replies aside).
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.assert_raises(stmt text, expect text, label text, state text default null) returns void
language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if position(lower(expect) in lower(sqlerrm)) = 0 or (state is not null and sqlstate <> state) then
    raise exception 'FAIL: % (got % "%")', label, sqlstate, sqlerrm;
  end if;
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
create or replace function pg_temp.set_rule(p_center uuid, p_path text[], p_value jsonb) returns void language sql as $$
  update app.centers set rules = jsonb_set(coalesce(rules, '{}'::jsonb) || jsonb_build_object('notifications', coalesce(rules->'notifications', '{}'::jsonb)),
                                           p_path, p_value, true)
   where id = p_center $$;
create or replace function pg_temp.set_trigger(p_center uuid, p_trigger text, p_on boolean) returns void language sql as $$
  update app.centers
     set rules = jsonb_set(coalesce(rules, '{}'::jsonb) || jsonb_build_object('notifications', coalesce(rules->'notifications', '{}'::jsonb)),
                           array['notifications', 'triggers'],
                           coalesce(rules #> '{notifications,triggers}', '{}'::jsonb) || jsonb_build_object(p_trigger, p_on))
   where id = p_center $$;
-- One batch of a survey's pushes, as the background service runs it.
create or replace function pg_temp.fan_out(p_survey uuid) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role connect_worker;
  r := app.worker_survey_launch_notify(p_survey, 200);
  reset role;
  return r;
end $$;
-- The member_notice.not_sent rows about one record.
create or replace function pg_temp.not_sent(p_table text, p_record text) returns setof app.audit_log language sql stable as $$
  select * from app.audit_log where action = 'member_notice.not_sent' and record_table = p_table and record_id = p_record $$;

grant connect_worker to postgres;

\set p '''81000000-0000-4000-8000-0000000000c1'''
\set sb '''81000000-0000-4000-8000-0000000000c2'''
\set nt '''81000000-0000-4000-8000-0000000000c3'''
\set u_admin '''81000000-0000-4000-8000-0000000000a1'''
\set u_asha '''81000000-0000-4000-8000-0000000000a2'''
\set u_bina '''81000000-0000-4000-8000-0000000000a3'''
\set u_esha '''81000000-0000-4000-8000-0000000000a4'''
\set u_sadmin '''81000000-0000-4000-8000-0000000000a5'''
\set u_gita '''81000000-0000-4000-8000-0000000000a6'''
\set u_hari '''81000000-0000-4000-8000-0000000000a7'''
\set u_pari '''81000000-0000-4000-8000-0000000000a8'''
\set u_ravi '''81000000-0000-4000-8000-0000000000a9'''
\set u_nila '''81000000-0000-4000-8000-0000000000aa'''
\set u_om '''81000000-0000-4000-8000-0000000000ab'''
\set asha '''81000000-0000-4000-8000-0000000000d1'''
\set bina '''81000000-0000-4000-8000-0000000000d2'''
\set chirag '''81000000-0000-4000-8000-0000000000d3'''
\set dev '''81000000-0000-4000-8000-0000000000d4'''
\set esha '''81000000-0000-4000-8000-0000000000d5'''
\set gita '''81000000-0000-4000-8000-0000000000d7'''
\set hari '''81000000-0000-4000-8000-0000000000d8'''
\set pari '''81000000-0000-4000-8000-0000000000d9'''
\set ravi '''81000000-0000-4000-8000-0000000000da'''
\set nila '''81000000-0000-4000-8000-0000000000db'''
\set om '''81000000-0000-4000-8000-0000000000dc'''
\set h1 '''81000000-0000-4000-8000-0000000000e1'''
\set h2 '''81000000-0000-4000-8000-0000000000e2'''
\set h3 '''81000000-0000-4000-8000-0000000000e3'''
\set h4 '''81000000-0000-4000-8000-0000000000e4'''
\set h5 '''81000000-0000-4000-8000-0000000000e5'''
\set h6 '''81000000-0000-4000-8000-0000000000e6'''
\set h7 '''81000000-0000-4000-8000-0000000000e7'''
\set ev_lunch '''81000000-0000-4000-8000-0000000000f1'''
\set ev_survey '''81000000-0000-4000-8000-0000000000f2'''
\set ev_now '''81000000-0000-4000-8000-0000000000f3'''
\set ev_off '''81000000-0000-4000-8000-0000000000f4'''
\set ev_sb '''81000000-0000-4000-8000-0000000000f5'''
\set ev_lunch2 '''81000000-0000-4000-8000-0000000000f6'''
\set ev_tpl '''81000000-0000-4000-8000-0000000000f7'''
\set ev_req '''81000000-0000-4000-8000-0000000000f8'''
\set ev_soon '''81000000-0000-4000-8000-0000000000f9'''
\set ev_old '''81000000-0000-4000-8000-0000000000fa'''
\set b1 '''81000000-0000-4000-8000-0000000000b1'''
\set b2 '''81000000-0000-4000-8000-0000000000b2'''
\set b3 '''81000000-0000-4000-8000-0000000000b3'''
\set b_sb '''81000000-0000-4000-8000-0000000000b4'''
\set b_on '''81000000-0000-4000-8000-0000000000b5'''
\set b_off '''81000000-0000-4000-8000-0000000000b6'''

-- ── Fixtures ─────────────────────────────────────────────────────────────────────
-- Production community P: the Ambani household (Asha with the app, Bina with a login but only an invalid phone, Chirag
-- with no login, Dev aged 10), Esha (the app) and the Rao household (Pari and Ravi, both with the app). Sandbox SB:
-- Gita and Hari, both with the app, neither a verified test recipient. Community NT, whose clock reads 21:xx now (a
-- fixed-offset zone chosen for it), with the default quiet hours (9 PM to 7 AM): Nila and Om, both with the app.
insert into auth.users (id, email) values
  (:u_admin, 'admin81@example.com'), (:u_asha, 'asha81@example.com'), (:u_bina, 'bina81@example.com'),
  (:u_esha, 'esha81@example.com'), (:u_sadmin, 'sadmin81@example.com'), (:u_gita, 'gita81@example.com'),
  (:u_hari, 'hari81@example.com'), (:u_pari, 'pari81@example.com'), (:u_ravi, 'ravi81@example.com'),
  (:u_nila, 'nila81@example.com'), (:u_om, 'om81@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone, rules) values
  (:p, 'notices81', 'Notices Test Center', 'NTC', 'TX', 'active', 'America/Chicago', '{"lunch": {"reminder_minutes_before": 10}}');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone, environment) values
  (:sb, 'notices81-sandbox', 'Notices Test Center (sandbox)', 'NTS', 'TX', 'active', 'America/Chicago', 'sandbox');
select ((21 - extract(hour from now() at time zone 'UTC')::int + 24) % 24) as k \gset
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone)
select :nt, 'notices81-night', 'Notices Night Center', 'NNC', 'TX', 'active',
       'Etc/GMT' || case when x.k > 14 then '+' || (24 - x.k)::text when x.k > 0 then '-' || x.k::text else '' end
  from (select :k::int as k) x;
insert into app.households (id, center_id, display_name) values
  (:h1, :p, 'Ambani family'), (:h2, :p, 'Desai family'), (:h7, :p, 'Rao family'),
  (:h3, :sb, 'Gandhi family'), (:h4, :sb, 'Hegde family'), (:h5, :nt, 'Naik family'), (:h6, :nt, 'Oza family');
insert into app.people (id, center_id, first_name, last_name, email, date_of_birth) values
  (:asha, :p, 'Asha', 'Ambani', 'asha81@example.com', '1980-02-01'),
  (:bina, :p, 'Bina', 'Ambani', 'bina81@example.com', '1982-03-01'),
  (:chirag, :p, 'Chirag', 'Ambani', null, '1950-04-01'),
  (:dev, :p, 'Dev', 'Ambani', null, current_date - interval '10 years'),
  (:esha, :p, 'Esha', 'Desai', 'esha81@example.com', '1985-05-01'),
  (:pari, :p, 'Pari', 'Rao', 'pari81@example.com', '1983-08-01'),
  (:ravi, :p, 'Ravi', 'Rao', 'ravi81@example.com', '1981-09-01'),
  (:gita, :sb, 'Gita', 'Gandhi', 'gita81@example.com', '1979-06-01'),
  (:hari, :sb, 'Hari', 'Hegde', 'hari81@example.com', '1981-07-01'),
  (:nila, :nt, 'Nila', 'Naik', 'nila81@example.com', '1984-10-01'),
  (:om, :nt, 'Om', 'Oza', 'om81@example.com', '1986-11-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :asha, :p, 'primary', true), (:h1, :bina, :p, 'spouse', false), (:h1, :chirag, :p, 'other', false),
  (:h1, :dev, :p, 'child', false), (:h2, :esha, :p, 'primary', true), (:h7, :pari, :p, 'primary', true), (:h7, :ravi, :p, 'spouse', false),
  (:h3, :gita, :sb, 'primary', true), (:h4, :hari, :sb, 'primary', true), (:h5, :nila, :nt, 'primary', true), (:h6, :om, :nt, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values
  (:p, :u_asha, :asha), (:p, :u_bina, :bina), (:p, :u_esha, :esha), (:p, :u_pari, :pari), (:p, :u_ravi, :ravi),
  (:sb, :u_gita, :gita), (:sb, :u_hari, :hari), (:nt, :u_nila, :nila), (:nt, :u_om, :om);
insert into app.role_grants (center_id, user_id, role_key, scope_kind) values
  (:p, :u_admin, 'center_admin', 'center'), (:sb, :u_sadmin, 'center_admin', 'center');
insert into app.push_devices (user_id, center_id, platform, token, last_seen_at, invalid_at) values
  (:u_asha, :p, 'ios', 'ExponentPushToken[notices81asha]', now(), null),
  (:u_asha, :p, 'android', 'ExponentPushToken[notices81ashaold]', now() - interval '90 days', now() - interval '30 days'),
  (:u_bina, :p, 'ios', 'ExponentPushToken[notices81bina]', now() - interval '60 days', now() - interval '20 days'),
  (:u_esha, :p, 'android', 'ExponentPushToken[notices81esha]', now(), null),
  (:u_pari, :p, 'ios', 'ExponentPushToken[notices81pari]', now(), null),
  (:u_ravi, :p, 'android', 'ExponentPushToken[notices81ravi]', now(), null),
  (:u_gita, :sb, 'ios', 'ExponentPushToken[notices81gita]', now(), null),
  (:u_hari, :sb, 'ios', 'ExponentPushToken[notices81hari]', now(), null),
  (:u_nila, :nt, 'ios', 'ExponentPushToken[notices81nila]', now(), null),
  (:u_om, :nt, 'ios', 'ExponentPushToken[notices81om]', now(), null);

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
     where n.nspname = 'app' and p.proname in ('_member_push', '_lunch_reminder', 'cancel_unconnected_member_notices', 'member_notice_reason_text',
                                               '_add_counts', '_member_notice_not_sent', '_survey_notice_audience', '_survey_notice_counts',
                                               '_survey_notice_vars', '_survey_notice_route', '_survey_notice_problem', '_survey_notice_summary',
                                               '_schedule_survey_notices', 'launch_event_survey', 'messages_cancel_waiting_job',
                                               'surveys_cancel_waiting_pushes', 'surveys_schedule_feedback_pushes', 'bolis_cancel_waiting_notices',
                                               'bolis_follow_close_time', 'worker_survey_launch_notify')
       and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'the helpers, trigger functions and the worker''s batch are not callable over the API');
select pg_temp.assert(has_function_privilege('connect_worker', 'app.worker_survey_launch_notify(uuid,integer)', 'execute')
                      and not has_function_privilege('service_role', 'app.worker_survey_launch_notify(uuid,integer)', 'execute')
                      and has_function_privilege('authenticated', 'app.launch_event_survey_now(uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.launch_event_survey_now(uuid)', 'execute'),
  'the batch is the worker role''s alone; Send survey is for signed-in staff (it checks who they are)');
select pg_temp.assert((select count(*) = 24 and bool_and(p.prosecdef and exists (select 1 from unnest(p.proconfig) as g(setting)
                                                                                   where g.setting ~ '^search_path=app, *public, *extensions$'))
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname in ('enqueue_message_at', 'enqueue_message', 'worker_message_to_send', '_member_push',
                          '_lunch_reminder', 'cancel_unconnected_member_notices', 'messages_cancel_waiting_job', 'surveys_cancel_waiting_pushes',
                          'surveys_schedule_feedback_pushes', 'bolis_cancel_waiting_notices', 'bolis_follow_close_time', 'launch_event_survey',
                          'launch_event_survey_now', 'assign_lunch_for_rsvp', 'move_lunch_slot', 'place_boli_entry', 'check_in',
                          '_member_notice_not_sent', '_survey_notice_audience', '_survey_notice_counts', '_survey_notice_problem',
                          '_survey_notice_summary', '_schedule_survey_notices', 'worker_survey_launch_notify')),
  'every new or replaced function that reads or writes is security definer and pins search_path = app, public, extensions');
select pg_temp.assert((select count(*) from app.message_templates
                        where center_id is null and channel = 'push' and language = 'en'
                          and key in ('event_survey', 'event_survey_reminder', 'lunch_reminder', 'boli_outbid')) = 4,
  'the four notices have platform push templates');
select pg_temp.assert((select bool_and(body !~* '\mbid' and coalesce(subject, '') !~* '\mbid' and body ~* 'pledge')
                         from app.message_templates where center_id is null and key = 'boli_outbid'),
  'the boli notice says "pledge", never "bid"');
select pg_temp.assert((select relrowsecurity from pg_class where oid = 'app.survey_notice_runs'::regclass)
                      and (select relrowsecurity from pg_class where oid = 'app.survey_notice_recipients'::regclass)
                      and not has_table_privilege('authenticated', 'app.survey_notice_runs', 'insert')
                      and not has_table_privilege('authenticated', 'app.survey_notice_recipients', 'update'),
  'the push runs and recipients are read under RLS and written only by the database');

-- ── Lunch ────────────────────────────────────────────────────────────────────────
select pg_temp.quiet_now(:p);
insert into app.events (id, center_id, name, starts_at, ends_at, status, lunch_enabled, lunch_starts_at, lunch_slot_minutes, lunch_seats_per_slot)
  values (:ev_lunch, :p, 'Lunch event 81', now() - interval '1 hour', now() + interval '3 hours', 'live', true, now() + interval '30 minutes', 15, 10);
insert into app.rsvps (id, center_id, event_id, household_id, status) values
  ('81000000-0000-4000-8000-000000000101', :p, :ev_lunch, :h1, 'confirmed'),
  ('81000000-0000-4000-8000-000000000102', :p, :ev_lunch, :h2, 'confirmed'),
  ('81000000-0000-4000-8000-000000000104', :p, :ev_lunch, :h7, 'confirmed');
insert into app.attendees (center_id, event_id, rsvp_id, person_id, display_name, is_child_under_12, ticket_token) values
  (:p, :ev_lunch, '81000000-0000-4000-8000-000000000101', :asha, 'Asha Ambani', false, 'tok81-asha'),
  (:p, :ev_lunch, '81000000-0000-4000-8000-000000000101', :chirag, 'Chirag Ambani', false, null),
  (:p, :ev_lunch, '81000000-0000-4000-8000-000000000101', :dev, 'Dev Ambani', true, null),
  (:p, :ev_lunch, '81000000-0000-4000-8000-000000000101', :bina, 'Bina Ambani', false, null),
  (:p, :ev_lunch, '81000000-0000-4000-8000-000000000102', :esha, 'Esha Desai', false, 'tok81-esha'),
  (:p, :ev_lunch, '81000000-0000-4000-8000-000000000104', :pari, 'Pari Rao', false, 'tok81-pari');

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
                               and m.created_by is null and j.created_by is null
                          from pg_temp.notices(array['lunch_reminder'], 'event_id', :ev_lunch) m join app.jobs j on j.id = m.job_id),
  'it goes to her login, as a notification, with a messaging.send job that runs at the scheduled time, and names no creator');
select pg_temp.assert((select m.scheduled_at = :'slot1'::timestamptz - interval '10 minutes' and m.expires_at = :'slot1'::timestamptz
                               and app.messaging_quiet_until(:p, m.scheduled_at) is not null
                          from pg_temp.notices(array['lunch_reminder'], 'event_id', :ev_lunch) m),
  'it is due 10 minutes before the slot (Settings › Rules), inside quiet hours and not held by them (event day), and expires when the slot starts');
select pg_temp.assert((select m.subject = 'Lunch at ' || to_char(:'slot1'::timestamptz at time zone 'America/Chicago', 'FMHH12:MI AM')
                               and m.body = 'Your lunch slot at Lunch event 81 starts at ' || to_char(:'slot1'::timestamptz at time zone 'America/Chicago', 'FMHH12:MI AM') || '.'
                               and m.payload->>'slot_id' is not null and m.payload->'vars'->>'person_id' = :asha
                          from pg_temp.notices(array['lunch_reminder'], 'event_id', :ev_lunch) m),
  'it says the slot''s time in the community''s time zone, and the slot is at the top level of the payload');

-- move_lunch_slot (owner approved 2026-10-07): one RSVP, on this event, that the caller may act for.
select id as old_lunch, job_id as old_lunch_job from pg_temp.notices(array['lunch_reminder'], 'event_id', :ev_lunch) \gset
select id as slot3, starts_at as slot3_at from app.lunch_slots where event_id = :ev_lunch order by starts_at offset 2 limit 1 \gset
-- The lists as the office sees them (a member's own reads are limited to their household).
select array_agg(id order by id)::text as own_ids from app.attendees where rsvp_id = '81000000-0000-4000-8000-000000000101' \gset
select array_agg(id order by id)::text as rao_ids from app.attendees where rsvp_id = '81000000-0000-4000-8000-000000000104' \gset
select array_agg(id order by id)::text as mix_ids from app.attendees
 where rsvp_id in ('81000000-0000-4000-8000-000000000101', '81000000-0000-4000-8000-000000000104') \gset
select array['81000000-0000-4000-8000-00000000ffff'::uuid, (select id from app.attendees where person_id = :asha and event_id = :ev_lunch)]::text as stray_ids \gset
begin;
select pg_temp.sign_in(:u_admin);
select app.check_in(:ev_lunch::uuid, 'tok81-pari');
select pg_temp.sign_in(:u_asha);
select pg_temp.assert_raises($$select app.move_lunch_slot('$$ || :'mix_ids' || $$'::uuid[], '$$ || :'slot3' || $$'::uuid)$$,
  'different RSVPs, so nobody was moved', 'Asha cannot move the Rao family along with her own: refused in a sentence', '22023');
select pg_temp.assert_raises($$select app.move_lunch_slot('$$ || :'rao_ids' || $$'::uuid[], '$$ || :'slot3' || $$'::uuid)$$,
  'Only an adult of the household or an event volunteer', 'nor the Rao family on their own', '22023');
select pg_temp.assert_raises($$select app.move_lunch_slot('$$ || :'stray_ids' || $$'::uuid[], '$$ || :'slot3' || $$'::uuid)$$,
  'not on this event, so nobody was moved', 'a person who is not on the event is refused too', '22023');
commit;
select pg_temp.assert((select count(*) from app.attendees where event_id = :ev_lunch and lunch_slot_id = :'slot3') = 0,
  'and nobody moved');
begin;
select pg_temp.sign_in(:u_asha);
select pg_temp.assert(app.move_lunch_slot(:'own_ids'::uuid[], :'slot3'::uuid) = 4, 'Asha moves her own family to a later slot');
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

-- A community that holds event-day messages at night: quiet hours that last past the slot queue nothing, and ONE
-- audit row for the check-in says why (two people, one row).
select pg_temp.set_rule(:p, array['notifications', 'event_day_during_quiet_hours'], 'false'::jsonb);
insert into app.events (id, center_id, name, starts_at, ends_at, status, lunch_enabled, lunch_starts_at, lunch_slot_minutes, lunch_seats_per_slot)
  values (:ev_lunch2, :p, 'Late lunch 81', now() - interval '1 hour', now() + interval '3 hours', 'live', true, now() + interval '30 minutes', 15, 10);
insert into app.rsvps (id, center_id, event_id, household_id, status) values ('81000000-0000-4000-8000-000000000105', :p, :ev_lunch2, :h7, 'confirmed');
insert into app.attendees (center_id, event_id, rsvp_id, person_id, display_name, ticket_token) values
  (:p, :ev_lunch2, '81000000-0000-4000-8000-000000000105', :pari, 'Pari Rao', 'tok81-pari2'),
  (:p, :ev_lunch2, '81000000-0000-4000-8000-000000000105', :ravi, 'Ravi Rao', null);
begin;
select pg_temp.sign_in(:u_admin);
select pg_temp.assert((select result from app.check_in(:ev_lunch2::uuid, 'tok81-pari2')) = 'ok', 'the Rao family checks in while quiet hours last past their slot');
commit;
select pg_temp.assert((select count(*) from pg_temp.notices(array['lunch_reminder'], 'event_id', :ev_lunch2)) = 0
                      and (select count(*) from pg_temp.not_sent('events', :ev_lunch2)) = 1
                      and (select after->'counts'->>'quiet_hours' = '2' and reason like '%2 not queued: quiet hours last until after the lunch slot starts%'
                             from pg_temp.not_sent('events', :ev_lunch2)),
  'with event-day messages held at night, a reminder that could only go after the slot starts is not queued; one audit row says why for both');
select pg_temp.set_rule(:p, array['notifications', 'event_day_during_quiet_hours'], 'true'::jsonb);

-- ── Event feedback: Mark completed takes counts and queues ONE job ──────────────────
insert into app.events (id, center_id, name, starts_at, ends_at, status, capacity) values
  (:ev_survey, :p, 'Survey event 81', now() - interval '2 days', now() - interval '1 day', 'published', 100),
  (:ev_now, :p, 'Send-now event 81', now() - interval '2 days', now() - interval '1 day', 'published', 100),
  (:ev_off, :p, 'Trigger-off event 81', now() - interval '2 days', now() - interval '1 day', 'published', 100),
  (:ev_tpl, :p, 'Template event 81', now() - interval '2 days', now() - interval '1 day', 'published', 100);
insert into app.rsvps (center_id, event_id, household_id, status) values
  (:p, :ev_survey, :h1, 'confirmed'), (:p, :ev_survey, :h2, 'confirmed'),
  (:p, :ev_now, :h1, 'confirmed'), (:p, :ev_now, :h2, 'attended'),
  (:p, :ev_off, :h1, 'confirmed'),
  (:p, :ev_tpl, :h1, 'confirmed'), (:p, :ev_tpl, :h2, 'confirmed'), (:p, :ev_tpl, :h7, 'confirmed');
begin;
select pg_temp.sign_in(:u_admin);
select app.attach_event_survey(:ev_survey::uuid, null, 'Survey event 81 feedback',
  '[{"id":"q1","type":"rating","label":"How was it?","options":[],"required":true}]'::jsonb, 20, true) as sv \gset
select app.attach_event_survey(:ev_now::uuid, null, 'Send-now feedback',
  '[{"id":"q1","type":"rating","label":"How was it?","options":[],"required":true}]'::jsonb, 0, false) as sv_now \gset
select app.attach_event_survey(:ev_off::uuid, null, 'Trigger-off feedback',
  '[{"id":"q1","type":"rating","label":"How was it?","options":[],"required":true}]'::jsonb, 0, true) as sv_off \gset
select app.attach_event_survey(:ev_tpl::uuid, null, 'Template feedback',
  '[{"id":"q1","type":"rating","label":"How was it?","options":[],"required":true}]'::jsonb, 0, true) as sv_tpl \gset
commit;

-- Quiet hours are on (pg_temp.quiet_now above): the survey push waits for them to end.
update app.events set status = 'completed' where id = :ev_survey;
select pg_temp.assert((select status from app.surveys where id = :'sv') = 'open', 'completing the event opens the survey');
select pg_temp.assert((select count(*) from pg_temp.notices(array['event_survey', 'event_survey_reminder'], 'survey_id', :'sv')) = 0
                      and (select count(*) from app.jobs where kind = 'surveys.launch_notify' and payload->>'survey_id' = :'sv' and status = 'queued') = 1,
  'nothing per person happens in the staff member''s request: ONE surveys.launch_notify job is queued');
select pg_temp.assert((select r.planned = jsonb_build_object('invited', 4, 'answered', 0, 'no_login', 1, 'no_phone', 1, 'pushes_off', 0,
                                                             'not_test_recipient', 0, 'will_push', 2)
                          from app.survey_notice_runs r where r.survey_id = :'sv'),
  'the counts are taken at once, set-based: 4 invited adults, 2 will get a push, Bina has no phone, Chirag no login (Dev is a child)');
select pg_temp.fan_out(:'sv'::uuid) as batch \gset
select pg_temp.assert((:'batch'::jsonb->>'done')::boolean and (:'batch'::jsonb->>'pushed')::int = 2 and (:'batch'::jsonb->>'refused')::int = 0,
  'the worker''s batch queues the two pushes');
select pg_temp.assert((select count(*) from pg_temp.notices(array['event_survey', 'event_survey_reminder'], 'survey_id', :'sv')) = 6
                      and (select array_agg(distinct person_id order by person_id) from pg_temp.notices(array['event_survey', 'event_survey_reminder'], 'survey_id', :'sv'))
                          = array[:asha, :esha]::uuid[],
  'Asha and Esha each get a push and two reminders');
select pg_temp.fan_out(:'sv'::uuid) as batch2 \gset
select pg_temp.assert((:'batch2'::jsonb->>'processed')::int = 0
                      and (select count(*) from pg_temp.notices(array['event_survey', 'event_survey_reminder'], 'survey_id', :'sv')) = 6
                      and (select count(*) from app.survey_notice_recipients where survey_id = :'sv') = 2,
  'a retried or doubled job pushes nobody twice');
select pg_temp.assert((select bool_and(m.to_address = cu.user_id::text and m.purpose = 'notification' and m.status = 'queued' and m.channel = 'push'
                                       and m.topic_key = 'events' and m.expires_at = s.closes_at and m.created_by is null
                                       and j.kind = 'messaging.send' and j.status = 'queued' and j.run_after = m.scheduled_at)
                         from pg_temp.notices(array['event_survey', 'event_survey_reminder'], 'survey_id', :'sv') m
                         join app.center_users cu on cu.center_id = m.center_id and cu.person_id = m.person_id
                         join app.jobs j on j.id = m.job_id
                         join app.surveys s on s.id = :'sv'),
  'every one goes to the person''s login as a notification, expires when the survey closes, names no creator, and has a job due at its scheduled time');
select pg_temp.assert((select count(*) from pg_temp.notices(array['event_survey'], 'survey_id', :'sv') m
                        where m.scheduled_at > m.created_at + interval '30 minutes' and m.scheduled_at = app.messaging_quiet_until(:p, m.created_at)) = 2
                      and (select count(*) from pg_temp.notices(array['event_survey_reminder'], 'survey_id', :'sv') m
                            where m.scheduled_at in ((select f.scheduled_at + interval '1 day' from pg_temp.notices(array['event_survey'], 'survey_id', :'sv') f where f.person_id = m.person_id),
                                                     (select f.scheduled_at + interval '2 days' from pg_temp.notices(array['event_survey'], 'survey_id', :'sv') f where f.person_id = m.person_id))) = 4
                      and (select bool_and(nr.first_push_at = (select f.scheduled_at from pg_temp.notices(array['event_survey'], 'survey_id', :'sv') f where f.person_id = nr.person_id))
                             from app.survey_notice_recipients nr where nr.survey_id = :'sv'),
  'the push waits for quiet hours to end; the reminders are one and two days after that person''s first push');
select pg_temp.assert((select bool_and(m.payload->>'survey_id' = :'sv' and m.payload->>'event_id' = :ev_survey
                                       and m.payload->>'deep_link' = 'survey/' || :'sv' and m.payload->'reward_points' = '20'::jsonb
                                       and m.payload->'vars'->>'person_id' = m.person_id::text)
                         from pg_temp.notices(array['event_survey', 'event_survey_reminder'], 'survey_id', :'sv') m),
  'survey_id, event_id, deep_link and reward_points are at the top level of the payload, where the worker reads them');
select pg_temp.assert((select subject = 'Survey event 81 · feedback' and body = 'How was Survey event 81? Share your feedback. Earn 20 points.'
                         from pg_temp.notices(array['event_survey'], 'survey_id', :'sv') where person_id = :asha),
  'the push names the event and the points, nothing else');
begin;
select pg_temp.sign_in(:u_admin);
select pg_temp.assert((select (n->'planned'->>'will_push')::int = 2 and (n->>'pushed')::int = 2 and n->>'finished_at' is not null
                          from (select app.event_survey_stats(:'sv'::uuid)->'notices' as n) y),
  'staff read the counts and the progress on the survey (event_survey_stats "notices")');
commit;

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

-- ── Send survey: the counts come back at once ────────────────────────────────────
select pg_temp.no_quiet(:p);
update app.events set status = 'completed' where id = :ev_now;
begin;
select pg_temp.sign_in(:u_admin);
select app.launch_event_survey_now(:'sv_now'::uuid) as launched \gset
commit;
select pg_temp.assert((:'launched'::jsonb->'planned'->>'will_push')::int = 2 and (:'launched'::jsonb->'planned'->>'invited')::int = 4
                      and (:'launched'::jsonb->'planned'->>'no_login')::int = 1 and (:'launched'::jsonb->'planned'->>'no_phone')::int = 1
                      and (:'launched'::jsonb->>'pushed')::int = 0 and :'launched'::jsonb->>'job_status' = 'queued',
  'Send survey returns the counts straight away (2 will get a push of 4 invited) and the job is queued');
select pg_temp.fan_out(:'sv_now'::uuid);
select pg_temp.assert((select count(*) from pg_temp.notices(array['event_survey', 'event_survey_reminder'], 'survey_id', :'sv_now') where status = 'queued') = 6,
  'the job queues them');
update app.surveys set status = 'closed' where id = :'sv_now';
select pg_temp.assert((select count(*) from pg_temp.notices(array['event_survey', 'event_survey_reminder'], 'survey_id', :'sv_now')
                        where status = 'cancelled' and failure_reason = 'Not sent: the survey closed before it went.') = 6
                      and (select count(*) from pg_temp.notices(array['event_survey', 'event_survey_reminder'], 'survey_id', :'sv_now') m
                                       join app.jobs j on j.id = m.job_id where j.status = 'queued') = 6
                      and not exists (select 1 from pg_temp.notices(array['event_survey', 'event_survey_reminder'], 'survey_id', :'sv_now') m
                                       where app.worker_message_to_send(m.id)->>'skip' is distinct from 'The message is already cancelled.'),
  'closing the survey cancels its waiting pushes in one update (their jobs stay queued: closing must stay quick for thousands), and the sender skips each of them');
-- The per-message job cancel still works everywhere else (answering, moving a slot, a boli, an expired notice: asserted above and below).

-- The community switched event feedback off: the survey still opens, nobody is pushed, and the counts say so.
select pg_temp.set_trigger(:p, 'event_feedback', false);
update app.events set status = 'completed' where id = :ev_off;
select pg_temp.assert((select status from app.surveys where id = :'sv_off') = 'open'
                      and (select (planned->>'will_push')::int = 0 and (planned->>'switched_off')::int = 1 and finished_at is not null and job_id is null
                             from app.survey_notice_runs where survey_id = :'sv_off')
                      and (select count(*) from pg_temp.notices(array['event_survey', 'event_survey_reminder'], 'survey_id', :'sv_off')) = 0,
  'with event feedback switched off the survey opens, no job is queued, and the counts say why');
select pg_temp.set_trigger(:p, 'event_feedback', true);

-- ── What would stop every push is refused up front ───────────────────────────────
insert into app.message_templates (center_id, key, channel, language, subject, body)
values (:p, 'event_survey', 'push', 'en', '{{event}}', 'Hi {{first_name}}, how was {{event}}?');
begin;
select pg_temp.sign_in(:u_admin);
select pg_temp.assert_raises($$select app.launch_event_survey_now('$$ || :'sv_now' || $$'::uuid)$$, 'already been sent', 'a sent survey is not sent again');
commit;
-- Mark completed never fails: the survey opens, the problem is stored and audited once, nothing is queued.
update app.events set status = 'completed' where id = :ev_tpl;
select pg_temp.assert((select status from app.surveys where id = :'sv_tpl') = 'open'
                      and (select problem_code = 'template' and problem like 'The community''s own "event_survey" push asks for {{first_name}}%' and job_id is null
                             from app.survey_notice_runs where survey_id = :'sv_tpl')
                      and (select count(*) from pg_temp.not_sent('surveys', :'sv_tpl')) = 1,
  'a community template asking for {{first_name}}: the event still completes, the survey shows the problem, one audit row, nothing queued');
-- Esha answers from Home in the meantime; Pari switches event pushes off.
begin;
select pg_temp.sign_in(:u_esha);
select app.submit_survey(:'sv_tpl'::uuid, '{"q1": 4}'::jsonb, true);
commit;
insert into app.notification_preferences (center_id, person_id, topic_key, channel, enabled) values (:p, :pari, 'events', 'push', false);
begin;
select pg_temp.sign_in(:u_admin);
select pg_temp.assert_raises($$select app.launch_event_survey_now('$$ || :'sv_tpl' || $$'::uuid)$$,
  'asks for {{first_name}}, which a survey push does not have', 'Send the pushes refuses in a sentence while the template is wrong', '22023');
commit;
update app.message_templates set subject = '{{event}} · feedback', body = 'How was {{event}}? Tell us.{{points}}'
 where center_id = :p and key = 'event_survey' and channel = 'push';
begin;
select pg_temp.sign_in(:u_admin);
select app.launch_event_survey_now(:'sv_tpl'::uuid) as retried \gset
commit;
select pg_temp.assert(:'retried'::jsonb->>'problem' is null and :'retried'::jsonb->>'job_status' = 'queued'
                      and :'retried'::jsonb->'planned' = jsonb_build_object('invited', 6, 'answered', 1, 'no_login', 1, 'no_phone', 1, 'pushes_off', 1,
                                                                            'not_test_recipient', 0, 'will_push', 2),
  'fixed, the same button sends the pushes, leaving out who answered (Esha) and who switched event pushes off (Pari)');
select pg_temp.fan_out(:'sv_tpl'::uuid);
select pg_temp.assert((select array_agg(distinct person_id order by person_id) from pg_temp.notices(array['event_survey'], 'survey_id', :'sv_tpl'))
                        = array[:asha, :ravi]::uuid[]
                      and (select body from pg_temp.notices(array['event_survey'], 'survey_id', :'sv_tpl') where person_id = :asha) = 'How was Template event 81? Tell us.',
  'Asha and Ravi get it, written from the community''s own template');
update app.notification_preferences set enabled = true where person_id = :pari and topic_key = 'events' and channel = 'push';

-- ── Events › Feedback › Request feedback ─────────────────────────────────────────
insert into app.events (id, center_id, name, starts_at, ends_at, status, capacity) values
  (:ev_req, :p, 'Request event 81', now() - interval '3 hours', now() - interval '1 hour', 'completed', 100),
  (:ev_soon, :p, 'Closing-soon event 81', now() - interval '3 hours', now() - interval '1 hour', 'completed', 100);
insert into app.rsvps (center_id, event_id, household_id, status) values
  (:p, :ev_req, :h1, 'attended'), (:p, :ev_req, :h7, 'attended'), (:p, :ev_soon, :h1, 'attended'), (:p, :ev_soon, :h7, 'attended');
-- As the portal writes it (surveys RLS, comms.send): open from the send time, tomorrow.
begin;
select pg_temp.sign_in(:u_admin);
insert into app.surveys (center_id, title, description, questions, audience, anonymous, status, opens_at, closes_at, event_id, kind, send_at, template_key)
values (:p, 'Request event 81 · feedback', 'Tell us how it went.', '[{"id":"q1","type":"rating","label":"Overall?","options":[],"required":true}]'::jsonb,
        jsonb_build_object('event_id', :ev_req, 'rsvp_statuses', jsonb_build_array('attended')), false, 'open',
        now() + interval '1 day', now() + interval '15 days', :ev_req, 'event_feedback', now() + interval '1 day', 'event_feedback')
returning id as sv_req \gset
commit;
select pg_temp.assert((select r.planned is null and r.send_at = s.send_at and j.run_after = s.send_at and j.kind = 'surveys.launch_notify'
                          from app.survey_notice_runs r join app.surveys s on s.id = r.survey_id join app.jobs j on j.id = r.job_id
                         where r.survey_id = :'sv_req'),
  'a feedback request schedules its pushes for its send time: the job runs then, and the counts are taken then');
update app.surveys set send_at = now() + interval '2 days', opens_at = now() + interval '2 days' where id = :'sv_req';
select pg_temp.assert((select j.run_after = s.send_at from app.survey_notice_runs r join app.surveys s on s.id = r.survey_id join app.jobs j on j.id = r.job_id
                        where r.survey_id = :'sv_req'),
  'moving its time moves the job');
-- Going now, with a survey that closes in 30 minutes during quiet hours: every push would arrive too late. The worker
-- counts the refusals on the run (staff see them) and audits the batch once.
select pg_temp.quiet_now(:p);
begin;
select pg_temp.sign_in(:u_admin);
insert into app.surveys (center_id, title, description, questions, audience, anonymous, status, opens_at, closes_at, event_id, kind, send_at, template_key)
values (:p, 'Closing-soon event 81 · feedback', 'Tell us how it went.', '[{"id":"q1","type":"rating","label":"Overall?","options":[],"required":true}]'::jsonb,
        jsonb_build_object('event_id', :ev_soon, 'rsvp_statuses', jsonb_build_array('attended')), false, 'open',
        now(), now() + interval '30 minutes', :ev_soon, 'event_feedback', now(), 'event_feedback')
returning id as sv_soon \gset
commit;
select pg_temp.assert((select (planned->>'will_push')::int = 3 from app.survey_notice_runs where survey_id = :'sv_soon'),
  'a request that goes now is counted when it is saved (Asha, Pari and Ravi)');
select pg_temp.fan_out(:'sv_soon'::uuid) as soon \gset
select pg_temp.assert((:'soon'::jsonb->>'refused')::int = 3
                      and (select refused = '{"quiet_hours": 3}'::jsonb and pushed = 0 and finished_at is not null from app.survey_notice_runs where survey_id = :'sv_soon')
                      and (select count(*) from pg_temp.not_sent('surveys', :'sv_soon')) = 1
                      and (select reason like '%3 not queued: quiet hours last until after the survey closes%' from pg_temp.not_sent('surveys', :'sv_soon')),
  'pushes that could only arrive after the survey closes are not queued: the run counts 3 refused (quiet hours) and ONE audit row says why');
select pg_temp.no_quiet(:p);
-- Going now with the broken community template: refused in a sentence, nothing saved.
update app.message_templates set body = 'Hi {{first_name}}' where center_id = :p and key = 'event_survey' and channel = 'push';
begin;
select pg_temp.sign_in(:u_admin);
select pg_temp.assert_raises($$insert into app.surveys (center_id, title, questions, audience, status, opens_at, closes_at, event_id, kind, send_at)
  values ('81000000-0000-4000-8000-0000000000c1', 'x', '[{"id":"q1","type":"rating","label":"x","options":[],"required":true}]'::jsonb,
          '{"event_id": "81000000-0000-4000-8000-0000000000f6", "rsvp_statuses": ["attended"]}'::jsonb, 'open', now(), now() + interval '14 days',
          '81000000-0000-4000-8000-0000000000f6', 'event_feedback', now())$$,
  'asks for {{first_name}}', 'a feedback request that would go now is refused in a sentence while the template is wrong', '22023');
commit;
select pg_temp.assert(not exists (select 1 from app.surveys where event_id = :ev_lunch2), 'and nothing was saved');
-- The same for a request scheduled for LATER: whether the push can be written does not depend on the time, so it is
-- refused now, in the same sentence, not on the day.
begin;
select pg_temp.sign_in(:u_admin);
select pg_temp.assert_raises($$insert into app.surveys (center_id, title, questions, audience, status, opens_at, closes_at, event_id, kind, send_at)
  values ('81000000-0000-4000-8000-0000000000c1', 'x', '[{"id":"q1","type":"rating","label":"x","options":[],"required":true}]'::jsonb,
          '{"event_id": "81000000-0000-4000-8000-0000000000f6", "rsvp_statuses": ["attended"]}'::jsonb, 'open', now() + interval '2 days', now() + interval '16 days',
          '81000000-0000-4000-8000-0000000000f6', 'event_feedback', now() + interval '2 days')$$,
  'asks for {{first_name}}', 'a feedback request scheduled for later is refused in the same sentence while the template is wrong', '22023');
commit;
select pg_temp.assert(not exists (select 1 from app.surveys where event_id = :ev_lunch2), 'and the request scheduled for later was not saved either');
update app.message_templates set body = 'How was {{event}}? Tell us.{{points}}' where center_id = :p and key = 'event_survey' and channel = 'push';

-- ── Bolis ────────────────────────────────────────────────────────────────────────
insert into app.bolis (id, center_id, name, kind, floor_cents, step_cents, status, closes_at) values
  (:b1, :p, 'Aarti labh 81', 'digital', 10000, 1000, 'open', now() + interval '2 days'),
  (:b2, :p, 'Mangal divo 81', 'digital', 10000, 1000, 'open', now() + interval '2 days');
insert into app.bolis (id, center_id, name, kind, floor_cents, step_cents, status, closes_at, soft_close_minutes, event_id) values
  (:b3, :p, 'Shanti kalash 81', 'digital', 10000, 1000, 'open', now() + interval '5 minutes', 10, :ev_lunch);
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
select pg_temp.assert((select m.created_by is null and j.created_by is null and m.payload->>'type' = 'boli_outbid'
                              and m.payload->>'deep_link' = '/boli/' || :b1 and m.payload->>'boli_id' = :b1 and (m.payload->'vars'->>'event_day')::boolean
                         from pg_temp.notices(array['boli_outbid'], 'boli_id', :b1) m join app.jobs j on j.id = m.job_id),
  'it names no creator (the queue does not learn who pledged), is an event-day message, and opens the boli (type and deep_link at the top level)');
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
  'a family raising its own top pledge tells nobody (owner decision 2026-10-07)');
update app.bolis set closes_at = now() + interval '3 days' where id = :b1;
select pg_temp.assert((select expires_at = (select closes_at from app.bolis where id = :b1)
                         from pg_temp.notices(array['boli_outbid'], 'boli_id', :b1) where person_id = :esha and status = 'queued'),
  'staff moving the close moves the waiting notice''s expiry');
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

-- Soft close: the notice lasts until the extended close, and names the boli's event too.
begin;
select pg_temp.sign_in(:u_asha);
select app.place_boli_entry(:b3::uuid, :h1::uuid, 10000);
select pg_temp.sign_in(:u_esha);
select app.place_boli_entry(:b3::uuid, :h2::uuid, 11000);
commit;
select pg_temp.assert((select m.expires_at = b.extended_until and b.extended_until > b.closes_at and m.payload->>'event_id' = :ev_lunch
                         from pg_temp.notices(array['boli_outbid'], 'boli_id', :b3) m join app.bolis b on b.id = :b3),
  'a pledge in the soft-close window extends the boli; the notice lasts until the extended close and names the boli''s event');

-- Owner decision 2026-10-07: at 21:xx, inside the default quiet hours (9 PM to 7 AM), a boli closing in 30 minutes.
insert into app.bolis (id, center_id, name, kind, floor_cents, step_cents, status, closes_at) values
  (:b_on, :nt, 'Night boli on 81', 'digital', 10000, 1000, 'open', now() + interval '30 minutes'),
  (:b_off, :nt, 'Night boli off 81', 'digital', 10000, 1000, 'open', now() + interval '30 minutes');
select pg_temp.assert(extract(hour from now() at time zone (select time_zone from app.centers where id = :nt)) between 21 and 22
                      and app.messaging_quiet_until(:nt, now()) is not null,
  'set-up: the night community''s clock reads after 9 PM, inside its quiet hours');
begin;
select pg_temp.sign_in(:u_nila);
select app.place_boli_entry(:b_on::uuid, :h5::uuid, 10000);
select pg_temp.sign_in(:u_om);
select app.place_boli_entry(:b_on::uuid, :h6::uuid, 11000);
commit;
select pg_temp.assert((select m.status = 'queued' and m.scheduled_at <= now() and m.person_id = :nila
                         from pg_temp.notices(array['boli_outbid'], 'boli_id', :b_on) m),
  'with event-day messages allowed at night (the default), the notice goes at once during quiet hours');
select pg_temp.set_rule(:nt, array['notifications', 'event_day_during_quiet_hours'], 'false'::jsonb);
begin;
select pg_temp.sign_in(:u_nila);
select app.place_boli_entry(:b_off::uuid, :h5::uuid, 10000);
select pg_temp.sign_in(:u_om);
select pg_temp.assert(app.place_boli_entry(:b_off::uuid, :h6::uuid, 11000) is not null, 'with them held at night, Om''s pledge is still taken');
commit;
select pg_temp.assert((select count(*) from pg_temp.notices(array['boli_outbid'], 'boli_id', :b_off)) = 0
                      and (select count(*) from pg_temp.not_sent('bolis', :b_off)) = 1
                      and (select after->'counts'->>'quiet_hours' = '1' and reason like '%quiet hours last until after the boli closes%'
                             from pg_temp.not_sent('bolis', :b_off)),
  'but the notice, which could only go at 7 AM after the boli closes, is not queued, and one audit row says why');

-- ── A sandbox: refusals never break the pledge, the check-in or the completion ──────
insert into app.bolis (id, center_id, name, kind, floor_cents, step_cents, status, closes_at) values
  (:b_sb, :sb, 'Sandbox boli 81', 'digital', 10000, 1000, 'open', now() + interval '2 days');
insert into app.events (id, center_id, name, starts_at, ends_at, status, lunch_enabled, lunch_starts_at, lunch_slot_minutes, lunch_seats_per_slot)
  values (:ev_sb, :sb, 'Sandbox event 81', now() - interval '1 hour', now() + interval '3 hours', 'live', true, now() + interval '30 minutes', 15, 10);
insert into app.rsvps (id, center_id, event_id, household_id, status) values ('81000000-0000-4000-8000-000000000103', :sb, :ev_sb, :h3, 'confirmed');
insert into app.attendees (center_id, event_id, rsvp_id, person_id, display_name, ticket_token) values
  (:sb, :ev_sb, '81000000-0000-4000-8000-000000000103', :gita, 'Gita Gandhi', 'tok81-gita');
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
select pg_temp.assert((select status from app.surveys where id = :'sv_sb') = 'open'
                      and (select (planned->>'not_test_recipient')::int = 1 and (planned->>'will_push')::int = 0 from app.survey_notice_runs where survey_id = :'sv_sb'),
  'and completing the event opens its survey; the counts say Gita is not a verified test recipient');
select pg_temp.assert(not exists (select 1 from app.messages where center_id = :sb and person_id = :gita),
  'nothing is queued to Gita');
select pg_temp.assert((select count(*) from pg_temp.not_sent('bolis', :b_sb)) = 1
                      and (select after->'counts'->>'sandbox' = '1' and reason like '%a sandbox pushes only to verified test recipients%' from pg_temp.not_sent('bolis', :b_sb))
                      and (select count(*) from pg_temp.not_sent('events', :ev_sb)) = 1,
  'each refusal is audited once for its call (the pledge, the check-in), with the reason');
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
-- A feedback request made before this change (written without the trigger, as the old code left it).
insert into app.events (id, center_id, name, starts_at, ends_at, status, capacity) values
  (:ev_old, :p, 'Old request event 81', now() - interval '30 days', now() - interval '29 days', 'completed', 100);
insert into app.rsvps (center_id, event_id, household_id, status) values (:p, :ev_old, :h1, 'attended');
begin;
alter table app.surveys disable trigger surveys_schedule_feedback_pushes;
insert into app.surveys (center_id, title, questions, audience, status, opens_at, closes_at, event_id, kind, send_at)
values (:p, 'Old request 81', '[{"id":"q1","type":"rating","label":"x","options":[],"required":true}]'::jsonb,
        jsonb_build_object('event_id', :ev_old, 'rsvp_statuses', jsonb_build_array('attended')), 'open',
        now() - interval '28 days', now() + interval '1 day', :ev_old, 'event_feedback', now() - interval '28 days')
returning id as sv_old \gset
alter table app.surveys enable trigger surveys_schedule_feedback_pushes;
commit;
select count(*) as old_rows from app.messages where center_id = :p and job_id is null and purpose is null \gset
select app.cancel_unconnected_member_notices() as cleared \gset
select pg_temp.assert((:'cleared'::jsonb->>'messages')::int = 4 and (:'cleared'::jsonb->>'feedback_requests')::int >= 1,
  'the four old rows and the old feedback request are dealt with');
select pg_temp.assert((select count(*) from app.messages where center_id = :p and job_id is null and purpose is null) = :old_rows
                      and (select count(*) from app.messages where center_id = :p and job_id is null and purpose is null and status = 'cancelled'
                              and failure_reason = 'Not sent: queued before this notice was connected to the sender (fixed in 0596); too old to send now.') = 4
                      and (select status from app.messages where center_id = :p and template_key = 'some_other_notice') = 'queued',
  'with the reason; none is deleted, none gets a job, and other rows are left alone');
update app.surveys set opens_at = now() where id = :'sv_old';
select pg_temp.assert((select problem_code = 'backlog' and job_id is null from app.survey_notice_runs where survey_id = :'sv_old')
                      and not exists (select 1 from app.jobs where kind = 'surveys.launch_notify' and payload->>'survey_id' = :'sv_old'),
  'an old feedback request is never launched, even when it is edited afterwards');
update app.messages set status = 'cancelled', failure_reason = 'Test fixture' where center_id = :p and template_key = 'some_other_notice';

-- ── The invariant ────────────────────────────────────────────────────────────────
select pg_temp.assert(not exists (select 1 from app.messages
                                   where status = 'queued' and job_id is null and not coalesce((payload->>'keyword_reply')::boolean, false)),
  'no message is queued without a job (STOP/HELP replies aside, which the webhook sends itself)');
