-- 0598: the notification gaps left after 0596 (BACKLOG B49).
-- (1) Every notice that has a sender follows the community's switch AND the member's own topic choice when it is SENT
--     (one mapping: app.notice_topic / notice_trigger); topics that nothing sends are flagged for the member app.
-- (2) New senders: RSVP confirmation, the boli notice before it closes, a special day's labh prompt, "your order is
--     ready", each once per thing and person, through app.enqueue_notice (the message and its job are written once).
-- (4) A STOP / HELP reply is made once per inbound message, so the webhook job can send the same reply again.
-- (5) The background service's status counts due jobs and scheduled jobs apart.
-- (7) A push is not updated after it is queued; a survey's per-person bookkeeping is not audited when written.
-- (8) A survey push is not sent to someone who has answered since it was queued.
-- (10) Event feedback switched off when a survey launches is recorded on the run, and Send survey sends the pushes once
--      the switch is on.
-- The sweeps and the store trigger never raise at the people who cause them: a refusal is counted and audited once.
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
create or replace function pg_temp.no_quiet(p_center uuid) returns void language sql as $$
  update app.centers
     set rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object('notifications',
                   coalesce(rules->'notifications', '{}'::jsonb) || '{"quiet_start_hour": 0, "quiet_end_hour": 0}'::jsonb)
   where id = p_center $$;
-- Quiet hours that cover the community's current hour and the next one (end = two hours on, at the top of the hour).
create or replace function pg_temp.quiet_now(p_center uuid) returns void language sql as $$
  update app.centers
     set rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object('notifications',
                   coalesce(rules->'notifications', '{}'::jsonb)
                   || jsonb_build_object('quiet_start_hour', extract(hour from now() at time zone time_zone)::int,
                                         'quiet_end_hour', (extract(hour from now() at time zone time_zone)::int + 2) % 24))
   where id = p_center $$;
create or replace function pg_temp.set_trigger(p_center uuid, p_trigger text, p_on boolean) returns void language sql as $$
  update app.centers
     set rules = jsonb_set(coalesce(rules, '{}'::jsonb) || jsonb_build_object('notifications', coalesce(rules->'notifications', '{}'::jsonb)),
                           array['notifications', 'triggers'],
                           coalesce(rules #> '{notifications,triggers}', '{}'::jsonb) || jsonb_build_object(p_trigger, p_on))
   where id = p_center $$;
-- The background service's calls, as the worker role.
create or replace function pg_temp.sweep() returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role connect_worker;
  r := app.worker_notices_sweep(200);
  reset role;
  return r;
end $$;
create or replace function pg_temp.fan_out(p_survey uuid) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role connect_worker;
  r := app.worker_survey_launch_notify(p_survey, 200);
  reset role;
  return r;
end $$;
create or replace function pg_temp.to_send(p_message uuid) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role connect_worker;
  r := app.worker_message_to_send(p_message);
  reset role;
  return r;
end $$;
-- The notices of one kind about one thing (the id is in the payload's top level).
create or replace function pg_temp.notices(p_template text, p_key text, p_id text) returns setof app.messages language sql stable as $$
  select * from app.messages where template_key = p_template and payload->>p_key = p_id $$;

grant connect_worker to postgres;

\set p '''83000000-0000-4000-8000-0000000000c1'''
\set u_admin '''83000000-0000-4000-8000-0000000000a1'''
\set u_asha '''83000000-0000-4000-8000-0000000000a2'''
\set u_bina '''83000000-0000-4000-8000-0000000000a3'''
\set u_esha '''83000000-0000-4000-8000-0000000000a4'''
\set u_pari '''83000000-0000-4000-8000-0000000000a5'''
\set u_ravi '''83000000-0000-4000-8000-0000000000a6'''
\set asha '''83000000-0000-4000-8000-0000000000d1'''
\set bina '''83000000-0000-4000-8000-0000000000d2'''
\set chirag '''83000000-0000-4000-8000-0000000000d3'''
\set dev '''83000000-0000-4000-8000-0000000000d4'''
\set esha '''83000000-0000-4000-8000-0000000000d5'''
\set pari '''83000000-0000-4000-8000-0000000000d6'''
\set ravi '''83000000-0000-4000-8000-0000000000d7'''
\set h1 '''83000000-0000-4000-8000-0000000000e1'''
\set h2 '''83000000-0000-4000-8000-0000000000e2'''
\set h7 '''83000000-0000-4000-8000-0000000000e3'''
\set ev_conf '''83000000-0000-4000-8000-0000000000f1'''
\set ev_early '''83000000-0000-4000-8000-0000000000f2'''
\set ev_off '''83000000-0000-4000-8000-0000000000f3'''
\set ev_quiet '''83000000-0000-4000-8000-0000000000f4'''
\set ev_swoff '''83000000-0000-4000-8000-0000000000f5'''
\set ev_late '''83000000-0000-4000-8000-0000000000f6'''
\set ev_req '''83000000-0000-4000-8000-0000000000f7'''
\set b_close '''83000000-0000-4000-8000-0000000000b1'''
\set b_far '''83000000-0000-4000-8000-0000000000b2'''
\set sd_in '''83000000-0000-4000-8000-0000000000a9'''
\set sd_today '''83000000-0000-4000-8000-0000000000b9'''
\set sd_far '''83000000-0000-4000-8000-0000000000c9'''
\set sd_punya '''83000000-0000-4000-8000-0000000000d9'''
\set sd_off '''83000000-0000-4000-8000-0000000000e9'''
\set sd_tithi '''83000000-0000-4000-8000-0000000000f9'''
\set order1 '''83000000-0000-4000-8000-0000000000aa'''
\set order2 '''83000000-0000-4000-8000-0000000000ab'''

-- ── Fixtures ─────────────────────────────────────────────────────────────────────
-- Community P (no quiet hours unless a test asks): the Ambani household (Asha with the app, Bina with a login but only
-- an invalid phone, Chirag with no login, Dev aged 10), Esha (the app) and the Rao household (Pari and Ravi, both with
-- the app).
insert into auth.users (id, email) values
  (:u_admin, 'admin83@example.com'), (:u_asha, 'asha83@example.com'), (:u_bina, 'bina83@example.com'),
  (:u_esha, 'esha83@example.com'), (:u_pari, 'pari83@example.com'), (:u_ravi, 'ravi83@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:p, 'gaps83', 'Notice Gaps Center', 'NGC', 'TX', 'active', 'America/Chicago');
select pg_temp.no_quiet(:p);
insert into app.households (id, center_id, display_name) values
  (:h1, :p, 'Ambani family'), (:h2, :p, 'Desai family'), (:h7, :p, 'Rao family');
insert into app.people (id, center_id, first_name, last_name, email, date_of_birth, phone_e164) values
  (:asha, :p, 'Asha', 'Ambani', 'asha83@example.com', '1980-02-01', '+17135550183'),
  (:bina, :p, 'Bina', 'Ambani', 'bina83@example.com', '1982-03-01', null),
  (:chirag, :p, 'Chirag', 'Ambani', null, '1950-04-01', null),
  (:dev, :p, 'Dev', 'Ambani', null, current_date - interval '10 years', null),
  (:esha, :p, 'Esha', 'Desai', 'esha83@example.com', '1985-05-01', null),
  (:pari, :p, 'Pari', 'Rao', 'pari83@example.com', '1983-08-01', null),
  (:ravi, :p, 'Ravi', 'Rao', 'ravi83@example.com', '1981-09-01', null);
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :asha, :p, 'primary', true), (:h1, :bina, :p, 'spouse', false), (:h1, :chirag, :p, 'other', false),
  (:h1, :dev, :p, 'child', false), (:h2, :esha, :p, 'primary', true), (:h7, :pari, :p, 'primary', true), (:h7, :ravi, :p, 'spouse', false);
insert into app.center_users (center_id, user_id, person_id) values
  (:p, :u_asha, :asha), (:p, :u_bina, :bina), (:p, :u_esha, :esha), (:p, :u_pari, :pari), (:p, :u_ravi, :ravi);
insert into app.role_grants (center_id, user_id, role_key, scope_kind) values (:p, :u_admin, 'center_admin', 'center');
insert into app.push_devices (user_id, center_id, platform, token, last_seen_at, invalid_at) values
  (:u_asha, :p, 'ios', 'ExponentPushToken[gaps83asha]', now(), null),
  (:u_bina, :p, 'ios', 'ExponentPushToken[gaps83bina]', now() - interval '60 days', now() - interval '20 days'),
  (:u_esha, :p, 'android', 'ExponentPushToken[gaps83esha]', now(), null),
  (:u_pari, :p, 'ios', 'ExponentPushToken[gaps83pari]', now(), null),
  (:u_ravi, :p, 'android', 'ExponentPushToken[gaps83ravi]', now(), null);

-- ── The pieces ───────────────────────────────────────────────────────────────────
select pg_temp.assert(to_regprocedure('app.enqueue_message(uuid,text,text,text,jsonb,text)') is not null
                      and to_regprocedure('app.enqueue_message_at(uuid,text,text,text,jsonb,text,timestamptz)') is not null
                      and to_regprocedure('app.enqueue_notice(uuid,text,text,text,jsonb,text,timestamptz,text,timestamptz,jsonb,boolean)') is not null,
  'the six- and seven-argument enqueue functions keep their signatures; app.enqueue_notice carries the notice''s own facts');
select pg_temp.assert(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app'
       and p.proname in ('notice_topic', 'notice_trigger', 'notice_is_service', '_notice_topic_on', '_notice_household_adults', 'enqueue_notice',
                         '_survey_notice_off_text', '_rsvp_confirmation_sweep', '_boli_closing_sweep', '_special_day_labh_sweep',
                         'rsvps_cancel_waiting_confirmation', 'store_order_ready_notice', 'worker_notices_sweep')
       and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'the new functions are not callable over the API');
select pg_temp.assert(has_function_privilege('connect_worker', 'app.worker_notices_sweep(integer)', 'execute')
                      and not has_function_privilege('service_role', 'app.worker_notices_sweep(integer)', 'execute'),
  'the sweep is the worker role''s alone');
select pg_temp.assert((select count(*) = 17 and bool_and(exists (select 1 from unnest(p.proconfig) as g(setting)
                                                                   where g.setting ~ '^search_path=app, *public, *extensions$'))
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname in ('notice_topic', 'notice_trigger', 'notice_is_service', '_notice_topic_on',
                          '_notice_household_adults', 'enqueue_notice', '_survey_notice_off_text', '_rsvp_confirmation_sweep', '_boli_closing_sweep',
                          '_special_day_labh_sweep', 'rsvps_cancel_waiting_confirmation', 'store_order_ready_notice', 'worker_notices_sweep',
                          'worker_message_to_send', '_member_push', 'worker_record_inbound_sms', 'background_service_status')),
  'every new or replaced function pins search_path = app, public, extensions');
select pg_temp.assert((select bool_and(p.prosecdef) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname in ('enqueue_notice', '_notice_topic_on', '_notice_household_adults',
                          '_rsvp_confirmation_sweep', '_boli_closing_sweep', '_special_day_labh_sweep', 'rsvps_cancel_waiting_confirmation',
                          'store_order_ready_notice', 'worker_notices_sweep', 'worker_message_to_send', '_member_push', 'worker_record_inbound_sms',
                          'background_service_status')),
  'the functions that read or write are security definer');
select pg_temp.assert((select relrowsecurity from pg_class where oid = 'app.notice_log'::regclass)
                      and not has_table_privilege('authenticated', 'app.notice_log', 'insert')
                      and not has_table_privilege('authenticated', 'app.notice_log', 'update')
                      and exists (select 1 from app.module_tables where table_name = 'notice_log'),
  'the log of handled notices is read under RLS, written only by the database, and mapped to a module');
select pg_temp.assert((select pg_get_triggerdef(t.oid) like '%AFTER UPDATE OR DELETE ON %notice_log%' from pg_trigger t
                        where t.tgrelid = 'app.notice_log'::regclass and t.tgname = 'audit_notice_log' and not t.tgisinternal)
                      and (select pg_get_triggerdef(t.oid) like '%AFTER UPDATE OR DELETE ON %survey_notice_recipients%' from pg_trigger t
                            where t.tgrelid = 'app.survey_notice_recipients'::regclass and t.tgname = 'audit_survey_notice_recipients' and not t.tgisinternal),
  'the bookkeeping tables keep their audit trigger, which fires for a change or a deletion but not for the insert of a row');
select pg_temp.assert(app.notice_topic('lunch_reminder') = 'events' and app.notice_topic('rsvp_confirmation') = 'events'
                      and app.notice_topic('event_survey') = 'events' and app.notice_topic('event_survey_reminder') = 'events'
                      and app.notice_topic('boli_outbid') = 'giving' and app.notice_topic('boli_closing') = 'giving'
                      and app.notice_topic('special_day_labh') = 'giving' and app.notice_topic('store_order_ready') = 'store'
                      and app.notice_topic('pathshala_placed') = 'pathshala' and app.notice_topic('pathshala_payment_due') = 'pathshala'
                      and app.notice_topic('homework.assigned') is null and app.notice_topic('qbo_connection_alert') is null
                      and app.notice_topic(null) is null,
  'each notice belongs to one topic (homework and operational mail belong to none)');
select pg_temp.assert(app.notice_trigger('event_survey_reminder') = 'event_feedback' and app.notice_trigger('boli_closing') = 'boli_outbid'
                      and app.notice_trigger('rsvp_confirmation') = 'rsvp_confirmation' and app.notice_trigger('store_order_ready') = 'store_order_ready'
                      and app.notice_trigger('special_day_labh') = 'special_day_labh' and app.notice_trigger('lunch_reminder') = 'lunch_reminder'
                      and app.notice_trigger('homework.assigned') is null
                      and app.notice_is_service('store_order_ready') and not app.notice_is_service('lunch_reminder') and not app.notice_is_service(null),
  'each notice belongs to one Settings › Notifications switch; only the order notice is a service notice');
select pg_temp.assert((select array_agg(key order by key) from app.notification_topics where not has_sender)
                        = array['account', 'alerts', 'family', 'jain_way', 'newsletter', 'timings']
                      and (select bool_and(has_sender) from app.notification_topics where key in ('events', 'giving', 'pathshala', 'store')),
  'the topics nothing sends are flagged for the member app; the four with senders are not');
select pg_temp.assert((select count(*) from app.message_templates
                        where center_id is null and channel = 'push' and language = 'en'
                          and key in ('rsvp_confirmation', 'boli_closing', 'special_day_labh', 'store_order_ready')) = 4
                      and (select bool_and(body !~* '\mbid' and coalesce(subject, '') !~* '\mbid' and body ~* 'pledge')
                            from app.message_templates where center_id is null and key = 'boli_closing'),
  'the four new notices have platform push templates; the boli one says "pledge", never "bid"');
select pg_temp.assert(app.member_notice_reason_text('quiet_hours', 'rsvp_confirmation') like '%until after the event starts'
                      and app.member_notice_reason_text('quiet_hours', 'boli_closing') like '%until after the boli closes'
                      and app.member_notice_reason_text('quiet_hours', 'special_day_labh') like '%until after the special day is over',
  'the audit sentences name when each new notice stops being useful');

-- ── One insert for a push, with its topic, expiry, route and no creator ────────────
select app.enqueue_notice(:p, 'push', :u_asha, 'lunch_reminder',
         jsonb_build_object('event', 'Notice event 83', 'time', '1:00 PM', 'minutes', 5, 'person_id', :asha),
         'notification', now(), null, now() + interval '2 hours',
         jsonb_build_object('type', 'lunch_reminder', 'deep_link', '/event/x/tickets', 'event_id', 'x'), true) as n1 \gset
select pg_temp.assert((select m.topic_key = 'events' and m.person_id = :asha and m.expires_at is not null and m.job_id is not null
                              and m.created_by is null and j.created_by is null and m.status = 'queued' and m.purpose = 'notification'
                              and m.payload->>'type' = 'lunch_reminder' and m.payload->>'deep_link' = '/event/x/tickets'
                              and m.payload->'vars'->>'minutes' = '5' and not (m.payload ? 'secret_ref')
                              and j.kind = 'messaging.send' and j.status = 'queued' and j.run_after = m.scheduled_at
                              and j.payload->>'message_id' = m.id::text and j.center_id = m.center_id
                         from app.messages m join app.jobs j on j.id = m.job_id where m.id = :'n1'),
  'the push is written complete: its topic, expiry, route, and a job due at its scheduled time; neither names a creator');
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'messages' and record_id = :'n1') = 1
                      and (select count(*) from app.audit_log where record_table = 'jobs'
                            and record_id = (select job_id::text from app.messages where id = :'n1')) = 1,
  'ONE audit row for the message and ONE for its job: nothing updates a push after it is queued');
-- The six-argument API: the topic comes from the template, the person from the login.
select app.enqueue_message(:p, 'push', :u_pari, 'boli_outbid', jsonb_build_object('boli', 'Aarti labh 83'), 'notification') as n2 \gset
select pg_temp.assert((select m.topic_key = 'giving' and m.person_id = :pari and m.status = 'queued' and m.job_id is not null and m.created_by is null
                         from app.messages m where m.id = :'n2'),
  'a push through enqueue_message gets its template''s topic and the person behind the login (here, with no creator: no session)');
insert into app.message_templates (center_id, key, channel, language, subject, body) values (:p, 'plain_notice_83', 'push', 'en', 'Hello', 'A plain notice');
select app.enqueue_message(:p, 'push', :u_pari, 'plain_notice_83', '{}'::jsonb, 'notification') as n3 \gset
select pg_temp.assert((select m.topic_key is null and m.person_id is null and m.expires_at is null from app.messages m where m.id = :'n3'),
  'a notice with no topic is queued as it always was');

-- ── Send time: the member''s topic, the community''s switch, a service notice ──────────
insert into app.notification_preferences (center_id, person_id, topic_key, channel, enabled) values (:p, :pari, 'giving', 'push', false);
select pg_temp.assert(pg_temp.to_send(:'n2')->>'skip' = 'Not sent: the member switched off "Giving opportunities and bolis" push notifications in the app.',
  'a push whose topic the member switched off is not sent, with a plain reason');
delete from app.notification_preferences where person_id = :pari and topic_key = 'giving';
select pg_temp.assert((pg_temp.to_send(:'n2')->>'skip') is null, 'switched back on (no row: the default), it goes');
select pg_temp.set_trigger(:p, 'boli_outbid', false);
select pg_temp.assert(pg_temp.to_send(:'n2')->>'skip' = 'Not sent: the community switched this notice off in Settings › Notifications after it was queued.',
  'a notice the community switched off after it was queued is not sent');
select pg_temp.set_trigger(:p, 'boli_outbid', true);
select pg_temp.assert((pg_temp.to_send(:'n2')->>'skip') is null, 'switched back on, it goes');
-- The order notice: the Satvik Store topic is off by default, and "your order is ready" is not an offer.
select app.enqueue_message(:p, 'push', :u_ravi, 'store_order_ready', jsonb_build_object('order', 'N-83'), 'notification') as n4 \gset
select pg_temp.assert((select m.topic_key = 'store' and m.person_id = :ravi from app.messages m where m.id = :'n4')
                      and (select default_on from app.notification_topics where key = 'store') is false
                      and (pg_temp.to_send(:'n4')->>'skip') is null,
  'a service notice ignores a topic that is off by default (no row: it goes)');
insert into app.notification_preferences (center_id, person_id, topic_key, channel, enabled) values (:p, :ravi, 'store', 'push', false);
select pg_temp.assert(pg_temp.to_send(:'n4')->>'skip' = 'Not sent: the member switched off "Satvik Store" push notifications in the app.',
  'but an explicit off of the member holds it back');
delete from app.notification_preferences where person_id = :ravi and topic_key = 'store';

-- ── RSVP confirmation ───────────────────────────────────────────────────────────
-- N hours before the event (events.confirmation_hours_before), to the adults of a household that RSVP'd before that
-- window opened and has not confirmed; only people with a login and a working phone; once per person.
insert into app.events (id, center_id, name, starts_at, ends_at, status, capacity, confirmation_hours_before) values
  (:ev_conf, :p, 'Confirm event 83', now() + interval '20 hours', now() + interval '24 hours', 'published', 100, 24),
  (:ev_early, :p, 'Early event 83', now() + interval '40 hours', now() + interval '44 hours', 'published', 100, 24),
  (:ev_off, :p, 'No-reminder event 83', now() + interval '20 hours', now() + interval '24 hours', 'published', 100, 0);
insert into app.rsvps (id, center_id, event_id, household_id, status, created_at) values
  ('83000000-0000-4000-8000-000000000101', :p, :ev_conf, :h1, 'rsvpd', now() - interval '30 hours'),
  ('83000000-0000-4000-8000-000000000102', :p, :ev_conf, :h7, 'rsvpd', now() - interval '30 hours'),
  ('83000000-0000-4000-8000-000000000103', :p, :ev_conf, :h2, 'rsvpd', now()),
  ('83000000-0000-4000-8000-000000000104', :p, :ev_early, :h1, 'rsvpd', now() - interval '30 hours'),
  ('83000000-0000-4000-8000-000000000105', :p, :ev_off, :h1, 'rsvpd', now() - interval '30 hours');
-- Ravi has switched event pushes off: he is not a candidate (and gets one if he switches them back on within the window).
insert into app.notification_preferences (center_id, person_id, topic_key, channel, enabled) values (:p, :ravi, 'events', 'push', false);
select pg_temp.sweep() as sw1 \gset
select pg_temp.assert(not (:'sw1'::jsonb->'rsvp_confirmation' ? 'error') and not (:'sw1'::jsonb->'boli_closing' ? 'error')
                      and not (:'sw1'::jsonb->'special_day_labh' ? 'error'),
  'no sweep failed: ' || :'sw1');
select pg_temp.assert((select count(*) from pg_temp.notices('rsvp_confirmation', 'event_id', :ev_conf)) = 2
                      and (select array_agg(person_id order by person_id) from pg_temp.notices('rsvp_confirmation', 'event_id', :ev_conf))
                          = array[:asha, :pari]::uuid[],
  'Asha and Pari are asked to confirm: Bina has no working phone, Chirag no login, Dev is a child, Ravi switched event pushes off, and the Desai family RSVP''d inside the window');
select pg_temp.assert((select count(*) from pg_temp.notices('rsvp_confirmation', 'event_id', :ev_early)) = 0
                      and (select count(*) from pg_temp.notices('rsvp_confirmation', 'event_id', :ev_off)) = 0,
  'an event whose window has not opened, and one with the reminder set to 0 hours, send nothing');
select pg_temp.assert((select bool_and(m.topic_key = 'events' and m.purpose = 'notification' and m.status = 'queued' and m.channel = 'push'
                                       and m.expires_at = (select starts_at from app.events where id = :ev_conf) and m.created_by is null
                                       and m.payload->>'type' = 'rsvp_confirm' and m.payload->>'event_id' = :ev_conf
                                       and m.payload->>'deep_link' = '/event/' || :ev_conf || '/confirm'
                                       and m.payload->>'rsvp_id' in ('83000000-0000-4000-8000-000000000101', '83000000-0000-4000-8000-000000000102')
                                       and j.kind = 'messaging.send' and j.run_after = m.scheduled_at and j.created_by is null)
                         from pg_temp.notices('rsvp_confirmation', 'event_id', :ev_conf) m join app.jobs j on j.id = m.job_id),
  'each goes to the person''s login with a job, expires when the event starts, names no creator, and carries type, deep link and event');
select pg_temp.assert((select m.subject = 'Please confirm Confirm event 83'
                              and m.body like 'Your family is signed up for Confirm event 83 on % at %. Please confirm that you are coming.'
                         from pg_temp.notices('rsvp_confirmation', 'event_id', :ev_conf) m where m.person_id = :asha),
  'the push names the event and when, nothing personal');
select pg_temp.assert((select count(*) from app.notice_log where kind = 'rsvp_confirmation' and ref_id = :ev_conf and outcome = 'pushed') = 2
                      and not exists (select 1 from app.notice_log where kind = 'rsvp_confirmation' and ref_id = :ev_conf and person_id = :ravi),
  'the log has the two pushes; Ravi, who was not a candidate, is not in it');
select pg_temp.sweep() as sw2 \gset
select pg_temp.assert((select count(*) from pg_temp.notices('rsvp_confirmation', 'event_id', :ev_conf)) = 2,
  'a second sweep asks nobody twice');
-- Ravi switches event pushes back on within the window: the next sweep asks him.
update app.notification_preferences set enabled = true where person_id = :ravi and topic_key = 'events' and channel = 'push';
select pg_temp.sweep() as sw3 \gset
select pg_temp.assert((select count(*) from pg_temp.notices('rsvp_confirmation', 'event_id', :ev_conf)) = 3
                      and exists (select 1 from pg_temp.notices('rsvp_confirmation', 'event_id', :ev_conf) where person_id = :ravi),
  'and when he switches them back on, the next sweep asks him');
delete from app.notification_preferences where person_id = :ravi and topic_key = 'events';
-- Confirming (or settling) the RSVP first cancels the push still waiting, and its job.
select id as asha_conf, job_id as asha_conf_job from pg_temp.notices('rsvp_confirmation', 'event_id', :ev_conf) where person_id = :asha \gset
update app.rsvps set status = 'confirmed', confirmed_at = now() where id = '83000000-0000-4000-8000-000000000101';
select pg_temp.assert((select status = 'cancelled' and failure_reason = 'Not sent: the RSVP was settled before it went.' from app.messages where id = :'asha_conf')
                      and (select status = 'cancelled' from app.jobs where id = :'asha_conf_job')
                      and (select count(*) from pg_temp.notices('rsvp_confirmation', 'event_id', :ev_conf) where status = 'queued') = 2,
  'confirming the RSVP cancels the waiting push and its job; the Rao family''s pushes still wait');
-- The same check at send time, for a push the trigger did not reach.
select id as pari_conf from pg_temp.notices('rsvp_confirmation', 'event_id', :ev_conf) where person_id = :pari \gset
select pg_temp.assert((pg_temp.to_send(:'pari_conf')->>'skip') is null, 'the Rao family''s push may go while the RSVP waits');
alter table app.rsvps disable trigger rsvps_cancel_waiting_confirmation;
update app.rsvps set status = 'no_show' where id = '83000000-0000-4000-8000-000000000102';
alter table app.rsvps enable trigger rsvps_cancel_waiting_confirmation;
select pg_temp.assert(pg_temp.to_send(:'pari_conf')->>'skip' = 'Not sent: the RSVP is no longer waiting to be confirmed.',
  'and at send time an RSVP that was settled meanwhile stops it');
-- The community''s switch: nothing is queued for it.
select pg_temp.set_trigger(:p, 'rsvp_confirmation', false);
insert into app.events (id, center_id, name, starts_at, ends_at, status, capacity, confirmation_hours_before) values
  (:ev_quiet, :p, 'Quiet event 83', now() + interval '20 hours', now() + interval '24 hours', 'published', 100, 24);
insert into app.rsvps (center_id, event_id, household_id, status, created_at) values (:p, :ev_quiet, :h2, 'rsvpd', now() - interval '30 hours');
select pg_temp.sweep();
select pg_temp.assert((select count(*) from pg_temp.notices('rsvp_confirmation', 'event_id', :ev_quiet)) = 0
                      and not exists (select 1 from app.notice_log where kind = 'rsvp_confirmation' and ref_id = :ev_quiet),
  'with RSVP confirmations switched off in Settings › Notifications nothing is queued, and nothing is logged as handled');
-- Switched back on, and now inside quiet hours: the push waits for them to end, and still expires when the event starts.
select pg_temp.set_trigger(:p, 'rsvp_confirmation', true);
select pg_temp.quiet_now(:p);
select pg_temp.sweep();
select pg_temp.assert((select m.person_id = :esha and m.status = 'queued' and m.scheduled_at > now() + interval '30 minutes'
                              and m.scheduled_at = app.messaging_quiet_until(:p, m.created_at) and m.expires_at > m.scheduled_at
                         from pg_temp.notices('rsvp_confirmation', 'event_id', :ev_quiet) m),
  'inside quiet hours the push is held until they end (it is not an event-day message)');
select pg_temp.no_quiet(:p);

-- ── The boli notice before it closes ─────────────────────────────────────────────
insert into app.bolis (id, center_id, name, kind, floor_cents, step_cents, status, closes_at) values
  (:b_close, :p, 'Closing boli 83', 'digital', 10000, 1000, 'open', now() + interval '20 hours'),
  (:b_far, :p, 'Far boli 83', 'digital', 10000, 1000, 'open', now() + interval '3 days');
insert into app.boli_entries (center_id, boli_id, household_id, person_id, amount_cents, entered_at) values
  (:p, :b_close, :h1, :asha, 10000, now() - interval '6 hours'),
  (:p, :b_close, :h2, :esha, 11000, now() - interval '5 hours'),
  (:p, :b_close, :h7, :pari, 12000, now() - interval '10 minutes'),
  (:p, :b_far, :h1, :asha, 10000, now() - interval '6 hours');
select pg_temp.sweep() as sw4 \gset
select pg_temp.assert(not (:'sw4'::jsonb->'boli_closing' ? 'error'), 'the boli sweep did not fail: ' || :'sw4');
select pg_temp.assert((select array_agg(person_id order by person_id) from pg_temp.notices('boli_closing', 'boli_id', :b_close))
                        = array[:asha, :esha]::uuid[]
                      and (select count(*) from pg_temp.notices('boli_closing', 'boli_id', :b_far)) = 0,
  'Asha and Esha, who pledged before the 24-hour window opened, are told; Pari, who pledged inside it, is not; a boli closing in 3 days tells nobody');
select pg_temp.assert((select bool_and(m.topic_key = 'giving' and m.status = 'queued' and m.created_by is null and j.created_by is null
                                       and m.expires_at = (select closes_at from app.bolis where id = :b_close)
                                       and m.payload->>'type' = 'boli_closing' and m.payload->>'deep_link' = '/boli/' || :b_close
                                       and m.payload->>'boli_id' = :b_close and j.kind = 'messaging.send' and j.run_after = m.scheduled_at
                                       and m.subject = 'Closing soon: Closing boli 83'
                                       and m.body like 'Closing boli 83 closes % at %. Open the app to see the latest pledge.')
                         from pg_temp.notices('boli_closing', 'boli_id', :b_close) m join app.jobs j on j.id = m.job_id),
  'it names the boli and when it closes (no amounts), expires at the close, opens the boli, and names no creator');
select pg_temp.sweep();
select pg_temp.assert((select count(*) from pg_temp.notices('boli_closing', 'boli_id', :b_close)) = 2, 'once per person, however often the sweep runs');
update app.bolis set closes_at = now() + interval '21 hours' where id = :b_close;
select pg_temp.assert((select bool_and(expires_at = (select closes_at from app.bolis where id = :b_close)) from pg_temp.notices('boli_closing', 'boli_id', :b_close)),
  'staff moving the close moves the waiting notices'' expiry');
select id as esha_closing, job_id as esha_closing_job from pg_temp.notices('boli_closing', 'boli_id', :b_close) where person_id = :esha \gset
update app.bolis set status = 'closed' where id = :b_close;
select pg_temp.assert((select status = 'cancelled' and failure_reason = 'Not sent: the boli closed before it went.' from app.messages where id = :'esha_closing')
                      and (select status = 'cancelled' from app.jobs where id = :'esha_closing_job'),
  'closing the boli cancels the notices still waiting, and their jobs');

-- ── A special day''s labh prompt ──────────────────────────────────────────────────
insert into app.labh_options (center_id, name, amount_cents) values (:p, 'Aarti 83', 5100);
insert into app.special_days (id, center_id, household_id, person_id, kind, label, calendar_date, reminder_days_before, labh_prompt_enabled) values
  (:sd_in, :p, :h1, :asha, 'birthday', 'In ten days 83', (((now() at time zone 'America/Chicago')::date + 10) - interval '28 years')::date, 14, true),
  (:sd_today, :p, :h7, :pari, 'anniversary', 'Today 83', (((now() at time zone 'America/Chicago')::date) - interval '28 years')::date, 14, true),
  (:sd_far, :p, :h1, :asha, 'birthday', 'Far 83', (((now() at time zone 'America/Chicago')::date + 60) - interval '28 years')::date, 14, true),
  (:sd_punya, :p, :h1, :asha, 'punyatithi', 'Punyatithi 83', (((now() at time zone 'America/Chicago')::date + 5) - interval '28 years')::date, 14, true),
  (:sd_off, :p, :h1, :asha, 'birthday', 'Prompt off 83', (((now() at time zone 'America/Chicago')::date + 5) - interval '28 years')::date, 14, false);
insert into app.special_days (id, center_id, household_id, person_id, kind, label, calendar_date, tithi, tithi_month, reminder_days_before, labh_prompt_enabled)
values (:sd_tithi, :p, :h1, :asha, 'birthday', 'Tithi 83', null, 'sud 12', 'Kartak', 14, true);
select pg_temp.sweep() as sw5 \gset
select pg_temp.assert(not (:'sw5'::jsonb->'special_day_labh' ? 'error'), 'the special-day sweep did not fail: ' || :'sw5');
select pg_temp.assert((select count(*) from app.messages where template_key = 'special_day_labh' and center_id = :p) = 3
                      and (select array_agg(person_id order by person_id) from pg_temp.notices('special_day_labh', 'special_day_id', :sd_in)) = array[:asha]::uuid[]
                      and (select array_agg(person_id order by person_id) from pg_temp.notices('special_day_labh', 'special_day_id', :sd_today)) = array[:pari, :ravi]::uuid[]
                      and not exists (select 1 from app.messages where template_key = 'special_day_labh' and center_id = :p
                                         and payload->>'special_day_id' in (:sd_far::text, :sd_punya::text, :sd_off::text, :sd_tithi::text)),
  'the household''s adults with the app are told, from the reminder window until the day: not a day far off, a punyatithi, a day with the prompt off, or one kept by tithi');
select pg_temp.assert((select bool_and(m.topic_key = 'giving' and m.status = 'queued' and m.created_by is null
                                       and m.payload->>'type' = 'special_day' and m.payload->>'deep_link' = '/labh/' || m.payload->>'special_day_id'
                                       and m.expires_at > now() and j.kind = 'messaging.send')
                         from app.messages m join app.jobs j on j.id = m.job_id where m.template_key = 'special_day_labh' and m.center_id = :p),
  'each opens the labh screen of its day (type special_day, special_day_id, deep_link), expires when the day is over, and names no creator');
select pg_temp.assert((select m.body = 'In 10 days: plan a labh for a day your family remembers. Open the app to choose.'
                              and m.subject = 'A special day is coming up'
                         from pg_temp.notices('special_day_labh', 'special_day_id', :sd_in) m)
                      and (select bool_and(m.body like 'Today: %') from pg_temp.notices('special_day_labh', 'special_day_id', :sd_today) m),
  'the push says when, never whose day it is (no names on a lock screen)');
select pg_temp.sweep();
select pg_temp.assert((select count(*) from app.messages where template_key = 'special_day_labh' and center_id = :p) = 3
                      and (select count(*) from app.notice_log where kind = 'special_day_labh' and center_id = :p) = 3,
  'once per occurrence and person, however often the sweep runs');
select pg_temp.assert((select count(distinct period) from app.notice_log where kind = 'special_day_labh' and center_id = :p) = 2
                      and (select period from app.notice_log where kind = 'special_day_labh' and ref_id = :sd_in and person_id = :asha)
                          = ((now() at time zone 'America/Chicago')::date + 10)::text,
  'the log keys each by the date the day falls on, so next year''s occurrence is a new notice');

-- ── "Your order is ready" ─────────────────────────────────────────────────────────
insert into app.store_orders (id, center_id, order_number, household_id, person_id, status) values
  (:order1, :p, 'N83-1', :h1, :asha, 'preparing'),
  (:order2, :p, 'N83-2', null, null, 'preparing');
update app.store_orders set status = 'ready', ready_at = now() where id = :order1;
select pg_temp.assert((select count(*) from pg_temp.notices('store_order_ready', 'order_id', :order1)) = 1
                      and (select m.person_id = :asha and m.topic_key = 'store' and m.status = 'queued' and m.created_by is null and j.created_by is null
                                  and m.payload->>'type' = 'store_order_ready' and m.payload->>'deep_link' = '/store'
                                  and m.subject = 'Your order is ready' and m.body = 'Order N83-1 is ready for pickup.'
                             from pg_temp.notices('store_order_ready', 'order_id', :order1) m join app.jobs j on j.id = m.job_id),
  'moving an order to ready pushes the member who placed it, with the order number and the way to the store');
select pg_temp.assert((pg_temp.to_send((select id from pg_temp.notices('store_order_ready', 'order_id', :order1)))->>'skip') is null,
  'it goes although the Satvik Store topic is off by default');
update app.store_orders set status = 'preparing' where id = :order1;
update app.store_orders set status = 'ready' where id = :order1;
select pg_temp.assert((select count(*) from pg_temp.notices('store_order_ready', 'order_id', :order1)) = 1
                      and (select count(*) from app.notice_log where kind = 'store_order_ready' and ref_id = :order1) = 1,
  'an order moved back and to ready again is announced once');
update app.store_orders set status = 'ready' where id = :order2;
select pg_temp.assert((select status from app.store_orders where id = :order2) = 'ready'
                      and not exists (select 1 from app.messages where template_key = 'store_order_ready' and payload->>'order_id' = :order2::text),
  'a guest order (no member behind it) is marked ready and pushes nobody; the kitchen is never held up');

-- ── Event feedback: the community''s switch is off when the survey launches (10) ───────
insert into app.events (id, center_id, name, starts_at, ends_at, status, capacity) values
  (:ev_swoff, :p, 'Switch-off event 83', now() - interval '2 days', now() - interval '1 day', 'published', 100),
  (:ev_late, :p, 'Late switch-off event 83', now() - interval '2 days', now() - interval '1 day', 'published', 100),
  (:ev_req, :p, 'Request event 83', now() - interval '3 hours', now() - interval '1 hour', 'completed', 100);
insert into app.rsvps (center_id, event_id, household_id, status) values
  (:p, :ev_swoff, :h1, 'confirmed'), (:p, :ev_swoff, :h7, 'confirmed'),
  (:p, :ev_late, :h1, 'confirmed'), (:p, :ev_late, :h7, 'confirmed'),
  (:p, :ev_req, :h1, 'attended'), (:p, :ev_req, :h7, 'attended');
begin;
select pg_temp.sign_in(:u_admin);
select app.attach_event_survey(:ev_swoff::uuid, null, 'Switch-off feedback',
  '[{"id":"q1","type":"rating","label":"How was it?","options":[],"required":true}]'::jsonb, 0, true) as sv_off \gset
select app.attach_event_survey(:ev_late::uuid, null, 'Late switch-off feedback',
  '[{"id":"q1","type":"rating","label":"How was it?","options":[],"required":true}]'::jsonb, 0, true) as sv_late \gset
commit;
select pg_temp.set_trigger(:p, 'event_feedback', false);
update app.events set status = 'completed' where id = :ev_swoff;
select pg_temp.assert((select status from app.surveys where id = :'sv_off') = 'open'
                      and (select (planned->>'will_push')::int = 0 and (planned->>'switched_off')::int = 3 and finished_at is not null and job_id is null
                                  and problem_code = 'switched_off' and problem like 'Event feedback is switched off in Settings › Notifications.%'
                                  and pushed = 0
                             from app.survey_notice_runs where survey_id = :'sv_off'),
  'with event feedback switched off the survey opens, nothing is queued, and the run SAYS why (3 would have been pushed)');
begin;
select pg_temp.sign_in(:u_admin);
select pg_temp.assert((app.event_survey_stats(:'sv_off'::uuid)->'notices'->>'problem_code') = 'switched_off', 'the Survey tab''s numbers carry the reason');
select pg_temp.assert_raises($$select app.launch_event_survey_now('$$ || :'sv_off' || $$'::uuid)$$,
  'still switched off in Settings', 'Send survey while it is still off says so in a sentence, not "already sent"', '22023');
commit;
select pg_temp.set_trigger(:p, 'event_feedback', true);
begin;
select pg_temp.sign_in(:u_admin);
select app.launch_event_survey_now(:'sv_off'::uuid) as relaunched \gset
commit;
select pg_temp.assert(:'relaunched'::jsonb->>'problem' is null and :'relaunched'::jsonb->>'job_status' = 'queued'
                      and (:'relaunched'::jsonb->'planned'->>'will_push')::int = 3 and (:'relaunched'::jsonb->'planned'->>'invited')::int = 5
                      and (select problem_code is null and pushed = 0 and job_id is not null from app.survey_notice_runs where survey_id = :'sv_off'),
  'switched back on, the same Send survey button sends the pushes (3 of 5 invited: Bina has no phone, Chirag no login)');
select pg_temp.fan_out(:'sv_off'::uuid) as batch_off \gset
select pg_temp.assert((:'batch_off'::jsonb->>'done')::boolean and (:'batch_off'::jsonb->>'pushed')::int = 3
                      and (select count(*) from pg_temp.notices('event_survey', 'survey_id', :'sv_off')) = 3
                      and (select count(*) from pg_temp.notices('event_survey_reminder', 'survey_id', :'sv_off')) = 6,
  'the batch queues each person''s push and two reminders');
-- Audit volume (7): the pushes are not updated after they are queued, and the bookkeeping inserts are not audited.
select pg_temp.assert((select count(*) from app.audit_log a join app.messages m on m.id::text = a.record_id
                        where a.record_table = 'messages' and m.payload->>'survey_id' = :'sv_off' and a.action <> 'messages.insert') = 0
                      and (select count(*) from app.audit_log a join app.messages m on m.id::text = a.record_id
                            where a.record_table = 'messages' and m.payload->>'survey_id' = :'sv_off' and a.action = 'messages.insert') = 9
                      and (select count(*) from app.audit_log where record_table = 'survey_notice_recipients' and record_id like :'sv_off' || ':%') = 0,
  '9 messages are audited once each (their insert) and the 3 recipient bookkeeping rows not at all');
update app.survey_notice_recipients set reason = 'checked' where survey_id = :'sv_off' and person_id = :asha;
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'survey_notice_recipients' and record_id = :'sv_off' || ':' || :asha) = 1,
  'a later change to a bookkeeping row is still audited');
-- (8) Answered since it was queued: not sent.
select id as asha_survey from pg_temp.notices('event_survey', 'survey_id', :'sv_off') where person_id = :asha \gset
select pg_temp.assert((pg_temp.to_send(:'asha_survey')->>'skip') is null, 'before she answers, Asha''s survey push may go');
insert into app.survey_completions (survey_id, person_id, center_id) values (:'sv_off', :asha, :p);
select pg_temp.assert(pg_temp.to_send(:'asha_survey')->>'skip' = 'Not sent: they have already answered the survey.',
  'a survey push for someone who answered since it was queued is not sent (the audience is read when a batch starts)');
-- The community switches event feedback off AFTER the pushes are queued: they are not sent either.
select id as pari_survey from pg_temp.notices('event_survey', 'survey_id', :'sv_off') where person_id = :pari \gset
select pg_temp.set_trigger(:p, 'event_feedback', false);
select pg_temp.assert(pg_temp.to_send(:'pari_survey')->>'skip' = 'Not sent: the community switched this notice off in Settings › Notifications after it was queued.',
  'event feedback switched off after the pushes were queued stops them');
select pg_temp.set_trigger(:p, 'event_feedback', true);

-- Switched off after the job was queued, before it runs: recorded on the run, not a silent finish.
update app.events set status = 'completed' where id = :ev_late;
select pg_temp.assert((select job_id is not null and finished_at is null and (planned->>'will_push')::int = 3 from app.survey_notice_runs where survey_id = :'sv_late'),
  'set-up: the pushes of the second survey are queued, the counts taken');
select pg_temp.set_trigger(:p, 'event_feedback', false);
select pg_temp.fan_out(:'sv_late'::uuid) as batch_late \gset
select pg_temp.assert((:'batch_late'::jsonb->>'done')::boolean
                      and (select problem_code = 'switched_off' and finished_at is not null and pushed = 0 from app.survey_notice_runs where survey_id = :'sv_late')
                      and (select count(*) from pg_temp.notices('event_survey', 'survey_id', :'sv_late')) = 0,
  'switched off before the queued job ran: nobody is pushed and the run says why');
select pg_temp.set_trigger(:p, 'event_feedback', true);
begin;
select pg_temp.sign_in(:u_admin);
select app.launch_event_survey_now(:'sv_late'::uuid) as relaunched_late \gset
commit;
select pg_temp.fan_out(:'sv_late'::uuid);
select pg_temp.assert((select count(*) from pg_temp.notices('event_survey', 'survey_id', :'sv_late')) = 3
                      and (select pushed = 3 and problem_code is null from app.survey_notice_runs where survey_id = :'sv_late'),
  'switched back on, Send survey sends them');

-- A feedback request scheduled for later whose time comes while the switch is off.
begin;
select pg_temp.sign_in(:u_admin);
insert into app.surveys (center_id, title, description, questions, audience, anonymous, status, opens_at, closes_at, event_id, kind, send_at, template_key)
values (:p, 'Request event 83 · feedback', 'Tell us how it went.', '[{"id":"q1","type":"rating","label":"Overall?","options":[],"required":true}]'::jsonb,
        jsonb_build_object('event_id', :ev_req, 'rsvp_statuses', jsonb_build_array('attended')), false, 'open',
        now() + interval '1 day', now() + interval '15 days', :ev_req, 'event_feedback', now() + interval '1 day', 'event_feedback')
returning id as sv_req \gset
commit;
select pg_temp.assert((select r.planned is null and j.run_after = s.send_at from app.survey_notice_runs r join app.surveys s on s.id = r.survey_id
                         join app.jobs j on j.id = r.job_id where r.survey_id = :'sv_req'),
  'set-up: the request is scheduled for tomorrow, its counts not taken yet');
update app.surveys set send_at = now() - interval '1 minute', opens_at = now() - interval '1 minute' where id = :'sv_req';
select pg_temp.set_trigger(:p, 'event_feedback', false);
select pg_temp.fan_out(:'sv_req'::uuid);
select pg_temp.assert((select problem_code = 'switched_off' and finished_at is not null and pushed = 0 and (planned->>'switched_off')::int = 3
                         from app.survey_notice_runs where survey_id = :'sv_req'),
  'its time came while event feedback was off: the run records it with the counts, instead of finishing as if nothing was due');
select pg_temp.set_trigger(:p, 'event_feedback', true);
begin;
select pg_temp.sign_in(:u_admin);
select app.launch_event_survey_now(:'sv_req'::uuid) as relaunched_req \gset
commit;
select pg_temp.assert(:'relaunched_req'::jsonb->>'problem' is null and (:'relaunched_req'::jsonb->'planned'->>'will_push')::int = 3,
  'and Send survey sends it once the switch is on');

-- ── STOP / HELP: one reply per inbound message (4) ───────────────────────────────
insert into app.integration_connections (center_id, provider, status, settings) values (:p, 'twilio', 'connected', '{"from_number":"+18325550183"}');
begin;
set local role connect_worker;
select app.worker_record_inbound_sms('+17135550183', '+18325550183', ' stop ', 'SM83-1') as stop1 \gset
select app.worker_record_inbound_sms('+17135550183', '+18325550183', ' stop ', 'SM83-1') as stop2 \gset
select app.worker_record_inbound_sms('+17135550183', '+18325550183', 'HELP', 'SM83-2') as help1 \gset
reset role;
commit;
select pg_temp.assert((:'stop1'::jsonb->>'keyword') = 'stop' and (:'stop2'::jsonb->>'keyword') = 'stop'
                      and (:'stop1'::jsonb->>'reply_message_id') = (:'stop2'::jsonb->>'reply_message_id')
                      and (:'stop2'::jsonb->>'repeated')::boolean is true and (:'stop1'::jsonb->>'repeated') is null,
  'the same inbound text again returns the same reply, so the webhook job can run again and send it');
select pg_temp.assert((select count(*) from app.messages where template_key = 'keyword_reply' and payload->>'inbound_sid' = 'SM83-1') = 1
                      and (select count(*) from app.message_suppressions where center_id = :p and channel = 'sms' and address = '+17135550183' and reason = 'stop') = 1
                      and (select count(*) from app.channel_optins where person_id = :asha and channel = 'sms' and source = 'keyword') = 1,
  'and nothing is recorded twice: one reply, one suppression, one opt-out');
select pg_temp.assert((:'help1'::jsonb->>'keyword') = 'help' and (:'help1'::jsonb->>'reply_message_id') <> (:'stop1'::jsonb->>'reply_message_id')
                      and (select status = 'queued' and payload->>'keyword' = 'help' from app.messages where id = (:'help1'::jsonb->>'reply_message_id')::uuid),
  'another inbound text is a new reply');
-- The reply is still sendable after the first try failed: it stayed queued.
select pg_temp.assert((pg_temp.to_send((:'stop1'::jsonb->>'reply_message_id')::uuid)->>'skip') is null,
  'a reply whose first try failed is still queued and goes on the retry');

-- ── The background service''s status: due and scheduled jobs apart (5) ──────────────
begin;
select pg_temp.sign_in(:u_admin);
select (app.background_service_status(:p)->'jobs'->>'queued')::int as due0, (app.background_service_status(:p)->'jobs'->>'scheduled')::int as later0 \gset
reset role;
select app.enqueue_job(:p, 'demo.ping', '{}'::jsonb, now() - interval '1 minute', 1) as due_job \gset
select app.enqueue_job(:p, 'demo.ping', '{}'::jsonb, now() + interval '1 day', 1) as later_job \gset
select pg_temp.sign_in(:u_admin);
select (app.background_service_status(:p)->'jobs'->>'queued')::int as due1, (app.background_service_status(:p)->'jobs'->>'scheduled')::int as later1 \gset
commit;
select pg_temp.assert(:due1::int = :due0::int + 1 and :later1::int = :later0::int + 1,
  'a job due now counts as waiting, a job scheduled for tomorrow counts as scheduled: reminders due tomorrow no longer look like a backlog');

-- ── The invariant ────────────────────────────────────────────────────────────────
select pg_temp.assert(not exists (select 1 from app.messages
                                   where center_id = :p and status = 'queued' and job_id is null and not coalesce((payload->>'keyword_reply')::boolean, false)),
  'no message of this community is queued without a job (STOP/HELP replies aside, which the webhook job sends itself)');
select pg_temp.assert(not exists (select 1 from app.messages m where m.center_id = :p and m.status = 'queued' and m.job_id is not null
                                     and not exists (select 1 from app.jobs j where j.id = m.job_id and j.status in ('queued', 'running'))),
  'and every queued message has a job that is still waiting to run');
