-- 0598: the notification gaps left after 0596 (BACKLOG B49), except staff writing app.messages directly (0599).
--
-- What this fixes, in the order of the backlog row:
--   (1) Settings › Notifications switches that nothing read. Every notice that has a sender now follows BOTH switches at
--       the moment it is sent, not only when it is queued: the community's switch (Settings › Notifications) and the
--       member's own choice (Settings › Notifications in the app, notification_preferences). One mapping decides which
--       topic and which community switch a notice belongs to (app.notice_topic / app.notice_trigger), so a new sender
--       cannot forget either. A topic with no sender at all is flagged (notification_topics.has_sender = false) and the
--       member app hides its switch; the portal shows the same rows as "not sent yet" instead of a switch.
--       New senders (all through app.enqueue_notice, like 0596): RSVP confirmation, the boli notice before it closes,
--       a special day's labh prompt, and "your store order is ready".
--   (2) The advertised notices that had no sender (RSVP confirmation, the boli notice before cutoff). Guests' SMS and
--       WhatsApp (lunch reminder, event feedback) are NOT built: the repository records no consent of a guest for a
--       channel (consents and channel_optins both need a person on file; a guest RSVP only keeps a phone number), and
--       STOP / HELP only suppress an address after it replied.
--   (4) STOP / HELP replies are sent again when Twilio fails: app.worker_record_inbound_sms is idempotent per inbound
--       message, so the webhook job can run again and send the same reply; the worker marks the event processed only
--       after the reply went (or after its last try).
--   (5) app.background_service_status counts only jobs that are due as "queued" and shows the scheduled ones apart.
--   (6) lunch_reminder carries type and deep_link (and keeps slot_id).
--   (7) Audit volume: app.enqueue_notice writes the message once with its topic, expiry, route and creator and the job
--       once with its creator, so a push is no longer updated three times after it is queued; the per-person
--       survey_notice_recipients bookkeeping is not audited when written (its changes and deletions still are).
--   (8) A survey push is re-checked for each person right before it is queued, and again when it is sent (someone who
--       answered while a batch was running no longer gets that batch's push).
--   (10) Event feedback switched off when a survey launches: the run records WHY nothing went out
--       (problem_code switched_off), the Survey tab says so, and "Send survey" sends the pushes once the switch is on.
-- (9), the portal's "sends now" window, is a portal change: the database's rule (a send time that is not in the future)
-- is now the only one.
set client_min_messages = warning;

-- ── Which topics have a sender ───────────────────────────────────────────────────
alter table app.notification_topics add column if not exists has_sender boolean not null default true;
comment on column app.notification_topics.has_sender is
  'False when nothing in Weaver sends notices of this topic (0598), so the member app hides its switch instead of showing one that does nothing. Set it to true in the migration that builds the sender.';

-- The five topics the notices below carry (seed.sql loads all ten into a new database AFTER the migrations, with the same
-- has_sender values; a notice whose topic is missing would be refused by the foreign key, so make sure).
insert into app.notification_topics (key, name, default_on, marketing, has_sender) values
  ('events', 'Events and reminders', true, false, true),
  ('giving', 'Giving opportunities and bolis', true, true, true),
  ('pathshala', 'Pathshala updates', true, false, true),
  ('family', 'Family celebrations and support', true, false, false),
  ('store', 'Satvik Store', false, true, true)
on conflict (key) do nothing;
do $$
begin
  perform app.set_audit_context('0598: topics that nothing sends are hidden from the member app''s notification switches');
  -- (A database that already has the topics gets the flags here; a new one gets them from seed.sql.)
  -- timings: no daily-timings push exists. jain_way: My Jain Way reminders are set on the phone itself, per practice.
  -- family: no family-circle push exists. newsletter: newsletters are not built (BACKLOG B60). alerts: alerts show in
  -- the app, they are not pushed. account: codes and security mail are always sent and cannot be switched off.
  update app.notification_topics set has_sender = false
   where key in ('timings', 'jain_way', 'family', 'newsletter', 'alerts', 'account') and has_sender;
end $$;

-- ── One mapping from a notice to its topic, its community switch and its kind ────────
-- topic: the member's choice (notification_preferences). trigger: the community's switch (rules.notifications.triggers).
-- service: a notice about the member's own order or payment, held back only by an explicit "off" of the member, never by
-- a topic that is off by default (the store's offers are off until chosen; "your order is ready" is not an offer).
-- Homework notices are not mapped: which topic they belong to is the owner's choice (they have their own switch).
create or replace function app.notice_topic(p_template text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case
    when p_template in ('event_survey', 'event_survey_reminder', 'lunch_reminder', 'rsvp_confirmation') then 'events'
    when p_template in ('boli_outbid', 'boli_closing', 'special_day_labh') then 'giving'
    when p_template = 'store_order_ready' then 'store'
    when p_template like 'pathshala\_%' then 'pathshala'
  end
$$;

create or replace function app.notice_trigger(p_template text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case p_template
    when 'event_survey' then 'event_feedback'
    when 'event_survey_reminder' then 'event_feedback'
    when 'lunch_reminder' then 'lunch_reminder'
    when 'rsvp_confirmation' then 'rsvp_confirmation'
    when 'boli_outbid' then 'boli_outbid'
    when 'boli_closing' then 'boli_outbid'
    when 'special_day_labh' then 'special_day_labh'
    when 'store_order_ready' then 'store_order_ready'
  end
$$;

create or replace function app.notice_is_service(p_template text) returns boolean
language sql immutable set search_path = app, public, extensions as $$
  select coalesce(p_template = 'store_order_ready', false)
$$;

-- Is this topic on for the person on this channel (no row = the topic's default; a service notice ignores the default)?
create or replace function app._notice_topic_on(p_person uuid, p_topic text, p_channel text, p_service boolean default false)
returns boolean language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce((select np.enabled from app.notification_preferences np
                    where np.person_id = p_person and np.topic_key = p_topic and np.channel = p_channel::app.channel),
                  case when p_service then true else (select t.default_on from app.notification_topics t where t.key = p_topic) end,
                  true)
$$;

-- ── enqueue_notice: enqueue_message_at with the notice's own facts, in one insert ─────
-- The 0596 body plus: the topic (given, or the template's), the expiry, the route (type, deep_link, ids: top level of the
-- payload) and "system" (no creator on the message or its job). The message is written ONCE, with its job already
-- chosen: no update follows (0596 updated each push three times, each audited). A push whose topic is known is tied to
-- the person behind the login so the member's choices apply when it is sent.
create or replace function app.enqueue_notice(p_center uuid, p_channel text, p_to text, p_template_key text, p_vars jsonb,
                                              p_purpose text, p_send_at timestamptz, p_topic text default null,
                                              p_expires_at timestamptz default null, p_route jsonb default null,
                                              p_system boolean default false) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  c app.centers; s app.message_suppressions; v_rendered jsonb;
  v_to text; v_vars jsonb; v_masked jsonb; v_secret jsonb := '{}'::jsonb; k text;
  v_subject text; v_body text; v_sandbox boolean := false; v_status text := 'queued'; v_reason text;
  v_when timestamptz := greatest(coalesce(p_send_at, now()), now()); v_quiet timestamptz; v_id uuid := gen_random_uuid();
  v_job bigint; v_vault uuid; v_person uuid; v_payload jsonb; v_optout boolean; v_dead text; v_topic text;
  v_label constant jsonb := '{"email":"email","sms":"text","push":"push","whatsapp":"WhatsApp"}';
begin
  if p_channel is null or p_channel not in ('email','sms','push','whatsapp') then
    raise exception 'A message goes by email, sms, push or whatsapp (got "%").', p_channel using errcode = '22023';
  end if;
  if p_purpose is null or p_purpose not in ('auth_code','sandbox_code','verification_code','receipt','notification','campaign','test') then
    raise exception 'Unknown message purpose "%".', p_purpose using errcode = '22023';
  end if;
  if p_center is not null then
    select * into c from app.centers where id = p_center;
    if not found then raise exception 'That community was not found.'; end if;
    v_sandbox := c.environment = 'sandbox';
  end if;

  v_to := case when p_channel = 'push' then nullif(btrim(coalesce(p_to, '')), '') else app.normalize_recipient(p_channel, p_to) end;
  if v_to is null then raise exception 'There is no % address to send the message to.', v_label->>p_channel using errcode = '22023'; end if;
  if p_channel = 'email' and v_to !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception '"%" is not an email address.', v_to using errcode = '22023';
  end if;
  if p_channel in ('sms','whatsapp') and v_to !~ '^\+\d{8,15}$' then
    raise exception '"%" is not a mobile number. Use the international form, for example +1 713 555 0100.', v_to using errcode = '22023';
  end if;
  if p_channel = 'push' and (v_to !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                             or not exists (select 1 from auth.users where id = v_to::uuid)) then
    raise exception 'A push notification goes to a member''s login; "%" is not one.', v_to using errcode = '22023';
  end if;

  v_vars := coalesce(p_vars, '{}'::jsonb);
  v_masked := v_vars;
  foreach k in array array['code','token','otp'] loop
    if v_vars ? k then
      v_secret := v_secret || jsonb_build_object(k, v_vars->>k);
      v_masked := jsonb_set(v_masked, array[k], '"••••••"'::jsonb);
    end if;
  end loop;
  v_rendered := app.message_render(p_center, p_channel, p_template_key, v_masked, v_sandbox);
  v_subject := v_rendered->>'subject';
  v_body := v_rendered->>'body';

  -- The recipient entitlement (a sandbox: verified test recipients only).
  if not app.messaging_recipient_ok(p_center, p_channel, v_to, p_purpose) then
    perform app.assert_entitlement(p_center, 'messaging.recipients', '"all"'::jsonb);
    raise exception using errcode = 'CCENT', message = 'Sandboxes can send only to verified test recipients.';
  end if;

  -- Suppressions, then opt-outs for what is not transactional.
  if p_channel <> 'push' then
    s := app.message_suppression_for(p_center, p_channel, v_to);
    if s.id is not null then
      v_status := 'suppressed';
      v_reason := 'Not sent: ' || v_to || ' is suppressed (' ||
                  case s.reason when 'bounce' then 'it bounced' when 'complaint' then 'the recipient marked a message as spam'
                                when 'stop' then 'the recipient replied STOP' else 'added by staff' end ||
                  ' on ' || to_char(s.created_at at time zone 'UTC', 'FMMonth FMDD, YYYY') || ').';
    end if;
  end if;
  -- #15 (owner, 2026-09-25): an address that is not a member's and unsubscribed from a link
  -- stops newsletters and announcements only; receipts, codes and other transactional mail still go.
  if v_status = 'queued' and p_center is not null and p_purpose in ('notification','campaign') and p_channel <> 'push' then
    s := app.message_newsletter_suppression_for(p_center, p_channel, v_to);
    if s.id is not null then
      v_status := 'suppressed';
      v_reason := 'Not sent: ' || v_to || ' unsubscribed from newsletters on ' ||
                  to_char(s.created_at at time zone 'UTC', 'FMMonth FMDD, YYYY') || ' (receipts still go).';
    end if;
  end if;
  if v_status = 'queued' and p_center is not null and p_purpose in ('notification','campaign') and p_channel <> 'push' then
    select not o.opted_in into v_optout from app.channel_optins o
     where o.center_id = p_center and o.channel = p_channel::app.channel
       and (case when p_channel = 'email' then lower(btrim(o.address)) else app.normalize_recipient(p_channel, o.address) end) = v_to
     order by o.recorded_at desc limit 1;
    if coalesce(v_optout, false) then
      v_status := 'suppressed';
      v_reason := 'Not sent: ' || v_to || ' opted out of ' || (v_label->>p_channel) || ' messages.';
    end if;
  end if;

  -- Quiet hours, judged at the send time (0596): non-urgent text, push and WhatsApp wait (event-day messages may go
  -- through when the center's rule allows it).
  if v_status = 'queued' and p_center is not null and p_purpose in ('notification','campaign','receipt')
     and p_channel in ('sms','push','whatsapp')
     and not (coalesce(p_vars->>'event_day', 'false') = 'true'
              and coalesce((c.rules #>> '{notifications,event_day_during_quiet_hours}')::boolean, true)) then
    v_quiet := app.messaging_quiet_until(p_center, v_when);
    if v_quiet is not null then v_when := v_quiet; end if;
  end if;

  v_topic := coalesce(p_topic, app.notice_topic(p_template_key));
  v_person := case when coalesce(p_vars->>'person_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                   then (p_vars->>'person_id')::uuid end;
  if v_person is not null and not exists (select 1 from app.people where id = v_person and center_id is not distinct from p_center) then
    v_person := null;
  end if;
  -- 0598: a push of a known topic is tied to the person behind the login, so that person's choices apply when it is sent.
  if v_person is null and v_topic is not null and p_channel = 'push' and p_center is not null then
    select cu.person_id into v_person from app.center_users cu where cu.center_id = p_center and cu.user_id = v_to::uuid;
  end if;
  -- Deceased (0420): nothing of any channel goes to them — by person, login, or an address
  -- that only deceased people on file hold.
  if v_status = 'queued' then
    v_dead := app.message_recipient_deceased(p_center, p_channel, v_to, v_person);
    if v_dead is not null then
      v_status := 'suppressed';
      v_reason := 'Not sent: ' || v_dead || ' is recorded as deceased.';
    end if;
  end if;
  v_payload := jsonb_build_object('vars', v_masked) || coalesce(p_route, '{}'::jsonb);
  if v_status = 'queued' and v_secret <> '{}'::jsonb then
    v_vault := vault.create_secret(v_secret::text, 'message:' || v_id::text, 'Values held until this message is sent');
    v_payload := v_payload || jsonb_build_object('secret_ref', v_vault);
  end if;

  -- The job first (it only names the message by id), so the message is written once, complete.
  if v_status = 'queued' then
    insert into app.jobs (center_id, kind, payload, run_after, max_attempts, created_by)
    values (p_center, case when p_purpose = 'test' then 'messaging.test_send' else 'messaging.send' end,
            jsonb_build_object('message_id', v_id), v_when, 5, case when p_system then null else auth.uid() end)
    returning id into v_job;
  end if;
  insert into app.messages (id, center_id, person_id, to_address, channel, topic_key, template_key, subject, body, payload,
                            scheduled_at, status, failure_reason, purpose, sandbox, segments, expires_at, job_id, created_by)
  values (v_id, p_center, v_person, v_to, p_channel::app.channel, v_topic, p_template_key, v_subject, v_body, v_payload,
          v_when, v_status, v_reason, p_purpose, v_sandbox,
          case when p_channel = 'sms' then app.sms_segments(v_body) end, p_expires_at, v_job,
          case when p_system then null else auth.uid() end);
  return v_id;
end $$;

-- The 0596 signature, unchanged: the notice's own facts (topic, expiry, route, system) come from app.enqueue_notice.
create or replace function app.enqueue_message_at(p_center uuid, p_channel text, p_to text, p_template_key text,
                                                  p_vars jsonb, p_purpose text, p_send_at timestamptz) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  return app.enqueue_notice(p_center, p_channel, p_to, p_template_key, p_vars, p_purpose, p_send_at);
end $$;

-- ── Why a member notice was not queued (the reasons now cover every notice) ───────────
create or replace function app.member_notice_reason_text(p_reason text, p_template text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case p_reason
    when 'quiet_hours' then 'quiet hours last until after ' ||
         case p_template when 'boli_outbid' then 'the boli closes' when 'boli_closing' then 'the boli closes'
                         when 'lunch_reminder' then 'the lunch slot starts' when 'rsvp_confirmation' then 'the event starts'
                         when 'special_day_labh' then 'the special day is over' else 'the survey closes' end
    when 'sandbox' then 'a sandbox pushes only to verified test recipients'
    when 'template' then 'the push could not be written from its template'
    when 'suppressed' then 'the recipient may not be messaged (for example recorded as deceased)'
    when 'expired' then 'it was already too late to be useful'
    when 'switched_off' then 'the community switched this notice off in Settings › Notifications'
    when 'no_login' then 'the person has no login in this community'
    when 'no_phone' then 'the person has no phone with the app'
    else 'it could not be queued' end
$$;

-- ── One push to a member (0596), now one insert ───────────────────────────────────
-- Same answer as before: {"id", "send_at"} when queued, else {"reason"[, "error"]}; never raises. The notice's topic,
-- expiry and route go into the single insert, and it names no creator (a boli notice must not tell the message queue
-- who pledged more).
create or replace function app._member_push(p_center uuid, p_person uuid, p_trigger text, p_topic text, p_template text,
                                            p_vars jsonb, p_route jsonb, p_send_at timestamptz, p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.centers; v_user uuid; v_phone boolean; v_id uuid; v_status text; v_why text; v_at timestamptz;
        v_send timestamptz; v_quiet timestamptz;
begin
  if p_center is null or p_person is null then return jsonb_build_object('reason', 'no_person'); end if;
  select * into c from app.centers where id = p_center;
  if not found then return jsonb_build_object('reason', 'no_person'); end if;
  if p_trigger is not null and (c.rules #>> array['notifications', 'triggers', p_trigger]) = 'false' then
    return jsonb_build_object('reason', 'switched_off');
  end if;
  select cu.user_id, exists (select 1 from app.push_devices d where d.user_id = cu.user_id and d.invalid_at is null)
    into v_user, v_phone
    from app.center_users cu
   where cu.center_id = p_center and cu.person_id = p_person;
  if v_user is null then return jsonb_build_object('reason', 'no_login'); end if;
  if not v_phone then return jsonb_build_object('reason', 'no_phone'); end if;
  v_send := greatest(coalesce(p_send_at, now()), now());
  -- The same reading of the event-day rule as app.enqueue_notice: absent means yes.
  if not (coalesce(p_vars->>'event_day', 'false') = 'true'
          and coalesce((c.rules #>> '{notifications,event_day_during_quiet_hours}')::boolean, true)) then
    v_quiet := app.messaging_quiet_until(p_center, v_send);
    if v_quiet is not null then v_send := v_quiet; end if;
  end if;
  if p_expires_at is not null and v_send >= p_expires_at then
    return jsonb_build_object('reason', case when v_quiet is not null then 'quiet_hours' else 'expired' end, 'send_at', v_send);
  end if;
  begin
    v_id := app.enqueue_notice(p_center, 'push', v_user::text, p_template,
                               coalesce(p_vars, '{}'::jsonb) || jsonb_build_object('person_id', p_person::text),
                               'notification', p_send_at, p_topic, p_expires_at, p_route, true);
    select m.status, m.failure_reason, m.scheduled_at into v_status, v_why, v_at from app.messages m where m.id = v_id;
  exception when others then
    return jsonb_build_object('reason', case when sqlstate = 'CCENT' then 'sandbox'
                                             when sqlerrm like 'The message template % needs a value for %' or sqlerrm like 'There is no % template called %' then 'template'
                                             else 'error' end,
                              'error', sqlerrm);
  end;
  if v_status is distinct from 'queued' then return jsonb_build_object('reason', 'suppressed', 'error', v_why); end if;
  return jsonb_build_object('id', v_id, 'send_at', v_at);
exception when others then
  return jsonb_build_object('reason', 'error', 'error', sqlerrm);
end $$;

-- ── Send-time re-check (0596 + the community's switch, an answered survey, a settled RSVP) ──
create or replace function app.worker_message_to_send(p_message uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare m app.messages; st app.messaging_settings; v_secret jsonb; v_rendered jsonb; v_skip text; s app.message_suppressions;
        v_provider text; v_conn app.integration_connections; v_route jsonb := '{}'::jsonb; v_tokens jsonb; w app.whatsapp_accounts; v_dead text;
        v_tz text; v_topic text; v_on boolean; v_trigger text; v_switch text; v_survey uuid; v_rsvp text;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  select * into m from app.messages where id = p_message;
  if not found then raise exception 'Message % was not found.', p_message; end if;
  if m.status <> 'queued' then v_skip := 'The message is already ' || m.status || '.'; end if;

  -- 0596: a notice that is no longer useful (the lunch slot started, the survey or the boli closed) is cancelled, not
  -- sent late. The skip starts "The message is already", so the sender records nothing over it.
  if v_skip is null and m.expires_at is not null and m.expires_at <= now() then
    select c.time_zone into v_tz from app.centers c where c.id = m.center_id;
    perform app.set_audit_context('Not sent: it expired before it was due');
    update app.messages
       set status = 'cancelled',
           failure_reason = 'Not sent: it was no longer useful by the time it was due (it expired on ' ||
                            to_char(m.expires_at at time zone coalesce(v_tz, 'UTC'), 'FMMonth FMDD, YYYY "at" FMHH12:MI AM') || ').'
     where id = m.id and status = 'queued';
    m.status := 'cancelled';
    v_skip := 'The message is already cancelled: it expired before it was due.';
  end if;

  -- 0596: the member switched this topic off for this channel in the app (no row = the topic's default; 0598: a notice
  -- about the member's own order ignores a default that is off).
  if v_skip is null and m.topic_key is not null and m.person_id is not null then
    select app._notice_topic_on(m.person_id, t.key, m.channel::text, app.notice_is_service(m.template_key)), t.name
      into v_on, v_topic
      from app.notification_topics t
     where t.key = m.topic_key;
    if v_on is false then
      v_skip := 'Not sent: the member switched off "' || coalesce(v_topic, m.topic_key) || '" ' ||
                case m.channel::text when 'sms' then 'text' when 'whatsapp' then 'WhatsApp' else m.channel::text end ||
                ' notifications in the app.';
    end if;
  end if;

  -- 0598: the community switched this kind of notice off in Settings › Notifications after it was queued.
  v_trigger := app.notice_trigger(m.template_key);
  if v_skip is null and v_trigger is not null and m.center_id is not null then
    select c.rules #>> array['notifications', 'triggers', v_trigger] into v_switch from app.centers c where c.id = m.center_id;
    if v_switch = 'false' then
      v_skip := 'Not sent: the community switched this notice off in Settings › Notifications after it was queued.';
    end if;
  end if;

  -- 0598: a survey push or reminder for someone who has answered since it was queued.
  if v_skip is null and m.template_key in ('event_survey', 'event_survey_reminder') and m.person_id is not null
     and (m.payload->>'survey_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_survey := (m.payload->>'survey_id')::uuid;
    if exists (select 1 from app.survey_completions sc where sc.survey_id = v_survey and sc.person_id = m.person_id) then
      v_skip := 'Not sent: they have already answered the survey.';
    end if;
  end if;

  -- 0598: an RSVP confirmation for an RSVP that was confirmed or cancelled since it was queued.
  if v_skip is null and m.template_key = 'rsvp_confirmation' and (m.payload->>'rsvp_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select r.status::text into v_rsvp from app.rsvps r where r.id = (m.payload->>'rsvp_id')::uuid;
    if v_rsvp is distinct from 'rsvpd' then
      v_skip := 'Not sent: the RSVP is no longer waiting to be confirmed.';
    end if;
  end if;

  -- Re-checked at send time: a suppression or a sandbox allow-list change since it was queued.
  if v_skip is null and m.channel::text <> 'push' and not coalesce((m.payload->>'keyword_reply')::boolean, false) then
    s := app.message_suppression_for(m.center_id, m.channel::text, m.to_address);
    if s.id is not null then v_skip := 'Not sent: ' || m.to_address || ' was suppressed (' || s.reason || ') after it was queued.'; end if;
  end if;
  if v_skip is null and m.channel::text <> 'push' and m.purpose in ('notification','campaign')
     and not coalesce((m.payload->>'keyword_reply')::boolean, false) then
    s := app.message_newsletter_suppression_for(m.center_id, m.channel::text, m.to_address);
    if s.id is not null then v_skip := 'Not sent: ' || m.to_address || ' unsubscribed from newsletters after it was queued.'; end if;
  end if;
  if v_skip is null and not coalesce((m.payload->>'keyword_reply')::boolean, false) then
    v_dead := app.message_recipient_deceased(m.center_id, m.channel::text, m.to_address, m.person_id);
    if v_dead is not null then v_skip := 'Not sent: ' || v_dead || ' is recorded as deceased.'; end if;
  end if;
  -- A row with no purpose is re-checked too (0596: before, "null not in (...)" let it through).
  if v_skip is null and m.center_id is not null and not coalesce((m.payload->>'keyword_reply')::boolean, false)
     and coalesce(m.purpose, '') not in ('test','verification_code')
     and not app.messaging_recipient_ok(m.center_id, m.channel::text, m.to_address, m.purpose) then
    v_skip := 'Not sent: this community may message only verified test recipients now.';
  end if;

  v_rendered := jsonb_build_object('subject', m.subject, 'body', m.body);
  if v_skip is null and m.payload ? 'secret_ref' then
    select decrypted_secret::jsonb into v_secret from vault.decrypted_secrets where id = (m.payload->>'secret_ref')::uuid;
    if v_secret is null or v_secret = '{}'::jsonb then
      v_skip := 'Not sent: the code in this message is no longer available (it was already sent or expired).';
    else
      v_rendered := app.message_render(m.center_id, m.channel::text, m.template_key, coalesce(m.payload->'vars', '{}'::jsonb) || v_secret, m.sandbox);
    end if;
  end if;

  select * into st from app.messaging_settings where center_id = m.center_id;
  if m.channel = 'email' then
    v_provider := coalesce(st.email_provider, 'resend');
    select * into v_conn from app.integration_connections where center_id = m.center_id and provider = v_provider;
    v_route := jsonb_build_object('provider', v_provider, 'connection_id', v_conn.id,
                                  'sender', app._messaging_sender(m.center_id, m.purpose),
                                  'footer', jsonb_build_object('postal_address', st.footer_postal_address, 'note', st.footer_note),
                                  'unsubscribe', m.purpose in ('notification','campaign'));
  elsif m.channel = 'sms' then
    select * into v_conn from app.integration_connections where center_id = m.center_id and provider = 'twilio';
    v_route := jsonb_build_object('provider', 'twilio', 'connection_id', v_conn.id, 'connected', v_conn.status = 'connected',
                                  'from_number', v_conn.settings->>'from_number', 'messaging_service_sid', v_conn.settings->>'messaging_service_sid');
  elsif m.channel = 'whatsapp' then
    select * into w from app.whatsapp_accounts where center_id = m.center_id;
    v_route := jsonb_build_object('provider', 'twilio', 'approved', w.status = 'approved', 'status', coalesce(w.status, 'not_started'),
                                  'from_number', w.detail->>'phone_e164');
  else
    select coalesce(jsonb_agg(d.token order by d.last_seen_at desc), '[]'::jsonb) into v_tokens
      from app.push_devices d where d.user_id = m.to_address::uuid and d.invalid_at is null;
    v_route := jsonb_build_object('provider', 'expo_push', 'tokens', v_tokens);
  end if;

  return jsonb_build_object(
    'id', m.id, 'center_id', m.center_id, 'channel', m.channel, 'to', m.to_address, 'purpose', m.purpose,
    'template_key', m.template_key, 'subject', v_rendered->>'subject', 'body', v_rendered->>'body',
    'sandbox', m.sandbox, 'status', m.status, 'skip', v_skip, 'payload', m.payload - 'secret_ref' - 'vars',
    'brand', app._messaging_brand(m.center_id), 'route', v_route);
end $$;

-- ── Platform templates ───────────────────────────────────────────────────────────
-- Variables: event (the event's name), when (a day and time in the community's time zone, or "Today", "Tomorrow",
-- "In 5 days"), boli (the boli's name), order (the order number). Nothing personal: no names, no amounts.
insert into app.message_templates (center_id, key, channel, language, subject, body)
select null, v.key, v.channel::app.channel, 'en', v.subject, v.body
  from (values
  ('rsvp_confirmation', 'push', 'Please confirm {{event}}',
   'Your family is signed up for {{event}} on {{when}}. Please confirm that you are coming.'),
  ('boli_closing', 'push', 'Closing soon: {{boli}}',
   '{{boli}} closes {{when}}. Open the app to see the latest pledge.'),
  ('special_day_labh', 'push', 'A special day is coming up',
   '{{when}}: plan a labh for a day your family remembers. Open the app to choose.'),
  ('store_order_ready', 'push', 'Your order is ready',
   'Order {{order}} is ready for pickup.')
  ) as v(key, channel, subject, body)
 where not exists (select 1 from app.message_templates t
                    where t.center_id is null and t.key = v.key and t.channel = v.channel::app.channel and t.language = 'en');

-- ── The notices already handled: once per thing and person ───────────────────────
-- One row per notice a sweep or trigger has dealt with, so a notice goes at most once and a refusal (and its audit
-- entry) is not repeated every few minutes. Nothing is recorded for a person with no login or no working phone (there
-- is nothing to tell them), so a person who installs the app inside a notice's window still gets it. kind: rsvp_confirmation (ref = the event), boli_closing (the boli),
-- special_day_labh (the special day; period = the date it falls on), store_order_ready (the order). Written only by the
-- database; inserts are not audited (the message itself is), a change or deletion is.
create table if not exists app.notice_log (
  kind       text not null,
  ref_id     uuid not null,
  period     text not null default '',
  person_id  uuid not null references app.people(id) on delete cascade,
  center_id  uuid not null references app.centers(id) on delete cascade,
  outcome    text not null check (outcome in ('pushed', 'refused')),
  reason     text,
  created_at timestamptz not null default now(),
  primary key (kind, ref_id, period, person_id)
);
create index if not exists notice_log_center_idx on app.notice_log (center_id, kind);
create index if not exists notice_log_person_idx on app.notice_log (person_id);
comment on table app.notice_log is
  'Each notice a sweep or trigger handled, once per thing and person (0598): rsvp_confirmation, boli_closing, special_day_labh, store_order_ready. outcome pushed | refused (reason: quiet_hours, sandbox, template, suppressed, expired, error).';
insert into app.module_tables (table_name, module_key) values ('notice_log', 'comms') on conflict (table_name) do nothing;
drop trigger if exists audit_notice_log on app.notice_log;
create trigger audit_notice_log after update or delete on app.notice_log
  for each row execute function app.audit_row('kind', 'ref_id', 'period', 'person_id');
alter table app.notice_log enable row level security;
drop policy if exists notice_log_staff_read on app.notice_log;
create policy notice_log_staff_read on app.notice_log for select to authenticated
  using (app.has_permission(center_id, 'comms.view') or app.has_permission(center_id, 'comms.send'));
drop policy if exists module_switch on app.notice_log;
create policy module_switch on app.notice_log as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('comms'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('comms'))::uuid[])));
revoke all on app.notice_log from public, anon, authenticated, connect_worker;
grant select on app.notice_log to authenticated;
grant all on app.notice_log to service_role;

-- The per-person bookkeeping of a survey's pushes is not audited when written (one row per invited adult: thousands
-- for a big event, each a row of the audit log). The pushes themselves are audited as messages; a change or a deletion
-- of a bookkeeping row still is. The trigger stays (every table has its audit_<table> trigger).
drop trigger if exists audit_survey_notice_recipients on app.survey_notice_recipients;
create trigger audit_survey_notice_recipients after update or delete on app.survey_notice_recipients
  for each row execute function app.audit_row('survey_id', 'person_id');

-- ── Lunch: the reminder carries its type and deep link (item 6) ──────────────────
create or replace function app._lunch_reminder(p_attendee uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare a app.attendees; s app.lunch_slots; e app.events; c app.centers; v_raw jsonb; v_minutes int;
begin
  select * into a from app.attendees where id = p_attendee;
  if a.id is null or a.person_id is null or a.lunch_slot_id is null then return jsonb_build_object('reason', 'no_person'); end if;
  select * into s from app.lunch_slots where id = a.lunch_slot_id;
  select * into e from app.events where id = a.event_id;
  select * into c from app.centers where id = e.center_id;
  v_raw := c.rules #> '{lunch,reminder_minutes_before}';
  v_minutes := case when jsonb_typeof(v_raw) = 'number' and (v_raw #>> '{}')::numeric >= 0
                         and (v_raw #>> '{}')::numeric = trunc((v_raw #>> '{}')::numeric)
                    then least((v_raw #>> '{}')::numeric, 120)::int else 5 end;
  if v_minutes = 0 or s.starts_at is null then return jsonb_build_object('reason', 'off'); end if;
  return app._member_push(e.center_id, a.person_id, 'lunch_reminder', 'events', 'lunch_reminder',
           jsonb_build_object('event', e.name, 'time', to_char(s.starts_at at time zone c.time_zone, 'FMHH12:MI AM'),
                              'minutes', v_minutes, 'event_day', true),
           jsonb_build_object('type', 'lunch_reminder', 'deep_link', '/event/' || e.id::text || '/tickets',
                              'event_id', e.id::text, 'slot_id', s.id::text),
           s.starts_at - make_interval(mins => v_minutes), s.starts_at);
exception when others then
  return jsonb_build_object('reason', 'error', 'error', sqlerrm);
end $$;

-- ── Bolis: the 24-hour notice is cancelled, and follows the close, like "another family pledged more" ──
create or replace function app.bolis_cancel_waiting_notices() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  update app.messages
     set status = 'cancelled', failure_reason = 'Not sent: the boli closed before it went.'
   where center_id = new.center_id and status = 'queued' and template_key in ('boli_outbid', 'boli_closing')
     and payload->>'boli_id' = new.id::text;
  return null;
end $$;

create or replace function app.bolis_follow_close_time() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  update app.messages
     set expires_at = coalesce(new.extended_until, new.closes_at)
   where center_id = new.center_id and status = 'queued' and template_key in ('boli_outbid', 'boli_closing')
     and payload->>'boli_id' = new.id::text;
  return null;
end $$;

-- ── The sweeps: RSVP confirmation, the boli notice before it closes, a special day's labh prompt ──
-- Each runs every few minutes in the background service (job notices.sweep) and handles the notices that are due NOW,
-- once per thing and person (app.notice_log). A notice is queued when its window opens, so nothing waits in the queue
-- for days and a changed event, boli or special day is simply read again. The candidates are only people who can be
-- reached (a login with a working phone) and whose topic is on; the community's switch is checked per community. What
-- is refused after that (quiet hours past the expiry, a sandbox, a template that cannot be written) is logged once and
-- audited once per thing.

-- The adults of a household.
create or replace function app._notice_household_adults(p_household uuid) returns setof uuid
language sql stable security definer set search_path = app, public, extensions as $$
  select distinct hm.person_id
    from app.household_members hm join app.people p on p.id = hm.person_id
   where hm.household_id = p_household and hm.left_at is null and not coalesce(p.is_deceased, false)
     and not app.person_is_minor(hm.person_id)
$$;

-- "Please confirm": N hours before the event (events.confirmation_hours_before; 0 = off), to the adults of a household
-- that RSVP'd before that window opened and has not confirmed. Someone who RSVPs inside the window sees the confirm
-- pop-up on Home and gets no push. Cancelled by app.rsvps_cancel_waiting_confirmation when the RSVP is settled first.
create or replace function app._rsvp_confirmation_sweep(p_limit integer default 200) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare ev record; a record; v_res jsonb; v_left int := greatest(coalesce(p_limit, 200), 1); v_pushed int := 0; v_refused int := 0;
        v_counts jsonb; v_err text; v_more boolean := false;
begin
  for ev in
    select e.id, e.center_id, e.name, e.starts_at, e.confirmation_hours_before as hrs, c.time_zone
      from app.events e join app.centers c on c.id = e.center_id
     where e.status in ('published', 'rsvp_closed') and e.confirmation_hours_before > 0 and e.starts_at is not null
       and e.starts_at > now() and now() >= e.starts_at - make_interval(hours => e.confirmation_hours_before)
       and coalesce(c.rules #>> '{notifications,triggers,rsvp_confirmation}', '') <> 'false'
     order by e.starts_at, e.id
  loop
    if v_left <= 0 then v_more := true; exit; end if;
    if not app.module_enabled(ev.center_id, 'events') then continue; end if;
    v_counts := '{}'::jsonb; v_err := null;
    for a in
      select distinct on (p.id) p.id as person_id, r.id as rsvp_id
        from app.rsvps r
        join app.household_members hm on hm.household_id = r.household_id and hm.left_at is null
        join app.people p on p.id = hm.person_id
        join app.center_users cu on cu.center_id = ev.center_id and cu.person_id = p.id
       where r.event_id = ev.id and r.status = 'rsvpd' and r.confirmed_at is null and r.household_id is not null
         and r.created_at <= ev.starts_at - make_interval(hours => ev.hrs)
         and not coalesce(p.is_deceased, false) and not app.person_is_minor(p.id)
         and exists (select 1 from app.push_devices d where d.user_id = cu.user_id and d.invalid_at is null)
         and app._notice_topic_on(p.id, 'events', 'push')
         and not exists (select 1 from app.notice_log l
                          where l.kind = 'rsvp_confirmation' and l.ref_id = ev.id and l.period = '' and l.person_id = p.id)
       order by p.id, r.created_at
       limit v_left
    loop
      v_res := app._member_push(ev.center_id, a.person_id, 'rsvp_confirmation', 'events', 'rsvp_confirmation',
                 jsonb_build_object('event', ev.name,
                                    'when', to_char(ev.starts_at at time zone ev.time_zone, 'FMDy, FMMon FMDD "at" FMHH12:MI AM'),
                                    'hours', ev.hrs),
                 jsonb_build_object('type', 'rsvp_confirm', 'deep_link', '/event/' || ev.id::text || '/confirm',
                                    'event_id', ev.id::text, 'rsvp_id', a.rsvp_id::text),
                 now(), ev.starts_at);
      if coalesce(v_res->>'reason', '') not in ('no_person', 'no_login', 'no_phone', 'switched_off') then
        insert into app.notice_log (kind, ref_id, period, person_id, center_id, outcome, reason)
        values ('rsvp_confirmation', ev.id, '', a.person_id, ev.center_id, case when v_res ? 'id' then 'pushed' else 'refused' end, v_res->>'reason')
        on conflict do nothing;
      end if;
      v_left := v_left - 1;
      if v_res ? 'id' then
        v_pushed := v_pushed + 1;
      else
        v_refused := v_refused + 1;
        v_counts := app._add_counts(v_counts, jsonb_build_object(coalesce(v_res->>'reason', 'error'), 1));
        v_err := coalesce(v_err, v_res->>'error');
      end if;
    end loop;
    perform app._member_notice_not_sent(ev.center_id, 'events', ev.id::text, 'rsvp_confirmation', v_counts, v_err);
  end loop;
  return jsonb_build_object('pushed', v_pushed, 'refused', v_refused, 'more', v_more or v_left <= 0);
end $$;

-- "Closing soon": 24 hours before a digital boli closes (its extended close when it was extended), to each person who
-- pledged on it before that window opened. No amounts, no names: the app shows where they stand.
create or replace function app._boli_closing_sweep(p_limit integer default 200) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare b record; a record; v_res jsonb; v_left int := greatest(coalesce(p_limit, 200), 1); v_pushed int := 0; v_refused int := 0;
        v_counts jsonb; v_err text; v_more boolean := false;
begin
  for b in
    select bo.id, bo.center_id, bo.name, bo.event_id, coalesce(bo.extended_until, bo.closes_at) as close_at, c.time_zone
      from app.bolis bo join app.centers c on c.id = bo.center_id
     where bo.status = 'open' and bo.kind = 'digital' and coalesce(bo.extended_until, bo.closes_at) is not null
       and coalesce(bo.extended_until, bo.closes_at) > now()
       and now() >= coalesce(bo.extended_until, bo.closes_at) - interval '24 hours'
       and (bo.opens_at is null or bo.opens_at <= now())
       and coalesce(c.rules #>> '{notifications,triggers,boli_outbid}', '') <> 'false'
     order by 5, bo.id
  loop
    if v_left <= 0 then v_more := true; exit; end if;
    if not app.module_enabled(b.center_id, 'bolis') then continue; end if;
    v_counts := '{}'::jsonb; v_err := null;
    for a in
      select distinct p.id as person_id
        from app.boli_entries en
        join app.people p on p.id = en.person_id
        join app.center_users cu on cu.center_id = b.center_id and cu.person_id = p.id
       where en.boli_id = b.id and en.entered_at <= b.close_at - interval '24 hours'
         and not coalesce(p.is_deceased, false) and not app.person_is_minor(p.id)
         and exists (select 1 from app.push_devices d where d.user_id = cu.user_id and d.invalid_at is null)
         and app._notice_topic_on(p.id, 'giving', 'push')
         and not exists (select 1 from app.notice_log l
                          where l.kind = 'boli_closing' and l.ref_id = b.id and l.period = '' and l.person_id = p.id)
       order by p.id
       limit v_left
    loop
      v_res := app._member_push(b.center_id, a.person_id, 'boli_outbid', 'giving', 'boli_closing',
                 jsonb_build_object('boli', b.name,
                                    'when', to_char(b.close_at at time zone b.time_zone, 'FMDy, FMMon FMDD "at" FMHH12:MI AM')),
                 jsonb_build_object('type', 'boli_closing', 'deep_link', '/boli/' || b.id::text, 'boli_id', b.id::text)
                   || case when b.event_id is not null then jsonb_build_object('event_id', b.event_id::text) else '{}'::jsonb end,
                 now(), b.close_at);
      if coalesce(v_res->>'reason', '') not in ('no_person', 'no_login', 'no_phone', 'switched_off') then
        insert into app.notice_log (kind, ref_id, period, person_id, center_id, outcome, reason)
        values ('boli_closing', b.id, '', a.person_id, b.center_id, case when v_res ? 'id' then 'pushed' else 'refused' end, v_res->>'reason')
        on conflict do nothing;
      end if;
      v_left := v_left - 1;
      if v_res ? 'id' then
        v_pushed := v_pushed + 1;
      else
        v_refused := v_refused + 1;
        v_counts := app._add_counts(v_counts, jsonb_build_object(coalesce(v_res->>'reason', 'error'), 1));
        v_err := coalesce(v_err, v_res->>'error');
      end if;
    end loop;
    perform app._member_notice_not_sent(b.center_id, 'bolis', b.id::text, 'boli_closing', v_counts, v_err);
  end loop;
  return jsonb_build_object('pushed', v_pushed, 'refused', v_refused, 'more', v_more or v_left <= 0);
end $$;

-- "A special day is coming up": from the day the family chose (special_days.reminder_days_before before it, default 14)
-- until the day itself, once per occurrence and adult of the household. Days remembered by tithi are not covered (their
-- date needs the tithi table; a later change); a punyatithi never offers a labh; a community with the Giving module
-- off, or with no labh options, sends none.
create or replace function app._special_day_labh_sweep(p_limit integer default 200) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare sd record; a record; v_res jsonb; v_left int := greatest(coalesce(p_limit, 200), 1); v_pushed int := 0; v_refused int := 0;
        v_counts jsonb; v_err text; v_more boolean := false; v_days int; v_expires timestamptz;
begin
  for sd in
    select x.* from (
      select s.id, s.center_id, s.household_id, s.reminder_days_before as lead_days, c.time_zone,
             (now() at time zone c.time_zone)::date as today,
             app.next_special_day_on(s.id, (now() at time zone c.time_zone)::date) as occurs_on
        from app.special_days s join app.centers c on c.id = s.center_id
       where s.calendar_date is not null and s.labh_prompt_enabled and s.kind <> 'punyatithi'
         and coalesce(c.rules #>> '{notifications,triggers,special_day_labh}', '') <> 'false'
    ) x
     where x.occurs_on is not null and x.occurs_on - greatest(x.lead_days, 0) <= x.today
     order by x.occurs_on, x.id
  loop
    if v_left <= 0 then v_more := true; exit; end if;
    if not app.module_enabled(sd.center_id, 'giving')
       or not exists (select 1 from app.labh_options o where o.center_id = sd.center_id and o.active) then
      continue;
    end if;
    v_counts := '{}'::jsonb; v_err := null;
    v_days := sd.occurs_on - sd.today;
    v_expires := (sd.occurs_on + 1)::timestamp at time zone sd.time_zone;
    for a in
      select distinct on (p.id) p.id as person_id
        from app._notice_household_adults(sd.household_id) h(person_id)
        join app.people p on p.id = h.person_id
        join app.center_users cu on cu.center_id = sd.center_id and cu.person_id = p.id
       where exists (select 1 from app.push_devices d where d.user_id = cu.user_id and d.invalid_at is null)
         and app._notice_topic_on(p.id, 'giving', 'push')
         and not exists (select 1 from app.notice_log l
                          where l.kind = 'special_day_labh' and l.ref_id = sd.id and l.period = sd.occurs_on::text and l.person_id = p.id)
       order by p.id
       limit v_left
    loop
      v_res := app._member_push(sd.center_id, a.person_id, 'special_day_labh', 'giving', 'special_day_labh',
                 jsonb_build_object('when', case when v_days <= 0 then 'Today' when v_days = 1 then 'Tomorrow' else 'In ' || v_days || ' days' end),
                 jsonb_build_object('type', 'special_day', 'deep_link', '/labh/' || sd.id::text, 'special_day_id', sd.id::text),
                 now(), v_expires);
      if coalesce(v_res->>'reason', '') not in ('no_person', 'no_login', 'no_phone', 'switched_off') then
        insert into app.notice_log (kind, ref_id, period, person_id, center_id, outcome, reason)
        values ('special_day_labh', sd.id, sd.occurs_on::text, a.person_id, sd.center_id,
                case when v_res ? 'id' then 'pushed' else 'refused' end, v_res->>'reason')
        on conflict do nothing;
      end if;
      v_left := v_left - 1;
      if v_res ? 'id' then
        v_pushed := v_pushed + 1;
      else
        v_refused := v_refused + 1;
        v_counts := app._add_counts(v_counts, jsonb_build_object(coalesce(v_res->>'reason', 'error'), 1));
        v_err := coalesce(v_err, v_res->>'error');
      end if;
    end loop;
    perform app._member_notice_not_sent(sd.center_id, 'special_days', sd.id::text, 'special_day_labh', v_counts, v_err);
  end loop;
  return jsonb_build_object('pushed', v_pushed, 'refused', v_refused, 'more', v_more or v_left <= 0);
end $$;

-- The background service's call (job notices.sweep, every 5 minutes): every sweep once; one that fails does not stop
-- the others (its error is in the answer, which the service logs). Returns {rsvp_confirmation, boli_closing,
-- special_day_labh: {pushed, refused, more} | {error}}.
create or replace function app.worker_notices_sweep(p_limit integer default 200) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v jsonb := '{}'::jsonb; r jsonb;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context('Member notices: RSVP confirmations, boli closing, special days');
  begin r := app._rsvp_confirmation_sweep(p_limit); exception when others then r := jsonb_build_object('error', sqlerrm); end;
  v := v || jsonb_build_object('rsvp_confirmation', r);
  begin r := app._boli_closing_sweep(p_limit); exception when others then r := jsonb_build_object('error', sqlerrm); end;
  v := v || jsonb_build_object('boli_closing', r);
  begin r := app._special_day_labh_sweep(p_limit); exception when others then r := jsonb_build_object('error', sqlerrm); end;
  v := v || jsonb_build_object('special_day_labh', r);
  return v;
end $$;

-- An RSVP that is confirmed, cancelled or marked attended / no-show first: its confirmation push still waiting is cancelled.
create or replace function app.rsvps_cancel_waiting_confirmation() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  update app.messages
     set status = 'cancelled', failure_reason = 'Not sent: the RSVP was settled before it went.'
   where center_id = new.center_id and status = 'queued' and template_key = 'rsvp_confirmation'
     and payload->>'rsvp_id' = new.id::text;
  return null;
end $$;
drop trigger if exists rsvps_cancel_waiting_confirmation on app.rsvps;
create trigger rsvps_cancel_waiting_confirmation after update of status on app.rsvps
  for each row when (new.status::text in ('confirmed', 'cancelled', 'attended', 'no_show') and old.status is distinct from new.status)
  execute function app.rsvps_cancel_waiting_confirmation();

-- ── Store: "your order is ready" ─────────────────────────────────────────────────
-- When the kitchen moves an order to ready, the member who placed it gets a push, once per order (a guest order has no
-- login). It never blocks the kitchen: any trouble is swallowed. A service notice: only an explicit "off" of the member's
-- Satvik Store choice holds it back, not the topic's default.
create or replace function app.store_order_ready_notice() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_res jsonb;
begin
  begin
    if new.person_id is null then return null; end if;
    if exists (select 1 from app.notice_log l where l.kind = 'store_order_ready' and l.ref_id = new.id and l.period = '' and l.person_id = new.person_id) then
      return null;
    end if;
    v_res := app._member_push(new.center_id, new.person_id, 'store_order_ready', 'store', 'store_order_ready',
               jsonb_build_object('order', new.order_number),
               jsonb_build_object('type', 'store_order_ready', 'deep_link', '/store', 'order_id', new.id::text),
               now(), null);
    -- A member with no login or no phone has nothing to be told (and a demo community's people have neither): nothing is
    -- recorded, so a later change of that order is judged afresh.
    if coalesce(v_res->>'reason', '') in ('no_person', 'no_login', 'no_phone', 'switched_off') then return null; end if;
    insert into app.notice_log (kind, ref_id, period, person_id, center_id, outcome, reason)
    values ('store_order_ready', new.id, '', new.person_id, new.center_id, case when v_res ? 'id' then 'pushed' else 'refused' end, v_res->>'reason')
    on conflict do nothing;
    if not (v_res ? 'id') then
      perform app._member_notice_not_sent(new.center_id, 'store_orders', new.id::text, 'store_order_ready',
                                          jsonb_build_object(coalesce(v_res->>'reason', 'error'), 1), v_res->>'error');
    end if;
  exception when others then
    null;
  end;
  return null;
end $$;
drop trigger if exists store_orders_ready_notice on app.store_orders;
create trigger store_orders_ready_notice after update of status on app.store_orders
  for each row when (new.status = 'ready' and old.status is distinct from 'ready')
  execute function app.store_order_ready_notice();

-- ── Event feedback: switched off when a survey launches (item 10), re-checked per person (item 8) ──
-- A run stopped because the community's switch was off says so (problem_code switched_off, the Survey tab shows it) and
-- the same "Send survey" button sends the pushes once the switch is on and nobody was pushed yet.
alter table app.survey_notice_runs drop constraint if exists survey_notice_runs_problem_code_check;
alter table app.survey_notice_runs add constraint survey_notice_runs_problem_code_check
  check (problem_code in ('template', 'closed', 'backlog', 'switched_off'));
comment on table app.survey_notice_runs is
  'The pushes of one survey (0596): send_at (the surveys.launch_notify job''s run_after), planned (invited, answered, no_login, no_phone, pushes_off, not_test_recipient, will_push, switched_off), problem (what stopped everyone: template, closed, backlog, switched_off), pushed and refused (by reason).';

create or replace function app._survey_notice_off_text() returns text
language sql immutable set search_path = app, public, extensions as $$
  select 'Event feedback is switched off in Settings › Notifications. Switch it on there, then press "Send the pushes" on the survey.'::text
$$;

create or replace function app._schedule_survey_notices(p_survey uuid, p_send_at timestamptz, p_retry boolean default false)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.surveys; c app.centers; r app.survey_notice_runs; v_send timestamptz := greatest(coalesce(p_send_at, now()), now());
        v_counts jsonb; v_problem text; v_job bigint; v_off boolean := false;
begin
  select * into s from app.surveys where id = p_survey;
  if s.id is null then return null; end if;
  select * into r from app.survey_notice_runs where survey_id = s.id for update;
  if r.survey_id is not null and not (coalesce(p_retry, false) and r.problem_code in ('template', 'switched_off') and r.pushed = 0) then
    return app._survey_notice_summary(s.id);
  end if;
  select * into c from app.centers where id = s.center_id;
  -- One rule for "now": a send time that is not in the future (the portal asks the answer, it does not guess).
  if v_send <= now() then
    v_counts := app._survey_notice_counts(s.id);
    if (c.rules #>> '{notifications,triggers,event_feedback}') = 'false' then
      v_off := (v_counts->>'will_push')::int > 0;
      v_counts := v_counts || jsonb_build_object('switched_off', (v_counts->>'will_push')::int, 'will_push', 0);
    elsif (v_counts->>'will_push')::int > 0 then
      v_problem := app._survey_notice_problem(s.id);
    end if;
  else
    -- Scheduled for later: who will be pushed is not known yet, but whether the push CAN be written does not depend on
    -- the time, so a template that could never be written is refused now, in the same sentence, not on the day.
    v_problem := app._survey_notice_problem(s.id);
  end if;
  insert into app.survey_notice_runs (survey_id, center_id, send_at, planned, problem_code, problem, finished_at)
  values (s.id, s.center_id, v_send, v_counts,
          case when v_problem is not null then 'template' when v_off then 'switched_off' end,
          coalesce(v_problem, case when v_off then app._survey_notice_off_text() end),
          case when v_problem is not null or v_off or (v_counts->>'will_push')::int = 0 then now() end)
  on conflict (survey_id) do update
     set send_at = excluded.send_at, planned = excluded.planned, problem_code = excluded.problem_code, problem = excluded.problem,
         finished_at = excluded.finished_at, started_at = null, refused = '{}'::jsonb, job_id = null;
  if v_problem is not null then
    perform app._member_notice_not_sent(s.center_id, 'surveys', s.id::text, 'event_survey',
                                        jsonb_build_object('template', (v_counts->>'will_push')::int), v_problem);
  elsif not v_off and (v_counts is null or (v_counts->>'will_push')::int > 0) then
    v_job := app.enqueue_job(s.center_id, 'surveys.launch_notify', jsonb_build_object('survey_id', s.id), v_send, 5);
    update app.survey_notice_runs set job_id = v_job where survey_id = s.id;
  end if;
  return app._survey_notice_summary(s.id);
end $$;

create or replace function app.launch_event_survey_now(p_survey uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.surveys; e app.events; r app.survey_notice_runs; v_problem text; v_switch text;
begin
  s := app._event_survey_for_change(p_survey);
  select * into e from app.events where id = s.event_id;
  select * into r from app.survey_notice_runs where survey_id = s.id;
  if r.survey_id is not null then
    -- A template problem, or the community's switch, stopped every push: once it is fixed the same button sends them
    -- (a feedback request too).
    if r.problem_code in ('template', 'switched_off') and r.pushed = 0 and s.status = 'open' then
      select c.rules #>> '{notifications,triggers,event_feedback}' into v_switch from app.centers c where c.id = s.center_id;
      if r.problem_code = 'switched_off' and v_switch = 'false' then
        raise exception 'Event feedback is still switched off in Settings › Notifications. Switch it on there, then send the survey again.' using errcode = '22023';
      end if;
      v_problem := app._survey_notice_problem(s.id);
      if v_problem is not null then raise exception '%', v_problem using errcode = '22023'; end if;
      perform app.set_audit_context('Event manager sent the survey pushes again');
      return app._schedule_survey_notices(s.id, now(), true);
    end if;
    raise exception 'This survey has already been sent.';
  end if;
  if e.status <> 'completed' then raise exception 'The survey can be sent once the event is marked completed.'; end if;
  if s.completion_started_at is not null then raise exception 'This survey has already been sent.'; end if;
  if s.status = 'closed' then raise exception 'This survey was closed. Reopen it from Event feedback instead.'; end if;
  v_problem := app._survey_notice_problem(s.id);
  if v_problem is not null then raise exception '%', v_problem using errcode = '22023'; end if;
  perform app.set_audit_context('Event manager launched the event survey');
  return app.launch_event_survey(s.id);
end $$;

-- The background service (job surveys.launch_notify): one batch of the invited adults who get a push and have not been
-- handled yet, in a fixed order. Each gets the push now (or when quiet hours end) and a reminder one and two days after
-- that first push, until the survey closes. The run is locked, so a doubled job waits and then finds nobody left.
-- 0598: each person is re-checked right before their push is queued (answered since the batch started), and the
-- community's switch being off is recorded on the run instead of the run silently finishing.
create or replace function app.worker_survey_launch_notify(p_survey uuid, p_limit integer default 200) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.survey_notice_runs; s app.surveys; c app.centers; v_event text; v_lim int := least(greatest(coalesce(p_limit, 200), 1), 200);
        a record; v_vars jsonb; v_route jsonb; p1 jsonb; p2 jsonb; v_first timestamptz; d interval; v_problem text; v_more boolean;
        v_pushed int := 0; v_done int := 0; v_refused jsonb := '{}'::jsonb; v_audit jsonb := '{}'::jsonb; v_err text;
        v_stop boolean := false; v_off boolean := false; v_orig int;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  select * into r from app.survey_notice_runs where survey_id = p_survey for update;
  if r.survey_id is null or r.finished_at is not null then
    return jsonb_build_object('done', true, 'processed', 0, 'pushed', 0, 'refused', 0,
                              'reason', case when r.survey_id is null then 'Nothing is scheduled for this survey.' else 'Its pushes are finished.' end);
  end if;
  select * into s from app.surveys where id = p_survey;
  select * into c from app.centers where id = r.center_id;
  if s.id is null or s.status <> 'open' or (s.closes_at is not null and s.closes_at <= now()) then
    update app.survey_notice_runs
       set finished_at = now(),
           problem_code = coalesce(problem_code, case when pushed = 0 then 'closed' end),
           problem = coalesce(problem, case when pushed = 0 then 'Not sent: the survey closed before the pushes went.' end)
     where survey_id = p_survey;
    return jsonb_build_object('done', true, 'processed', 0, 'pushed', 0, 'refused', 0, 'reason', 'The survey is closed.');
  end if;
  if s.opens_at is not null and s.opens_at > now() + interval '1 minute' then
    -- It opens later (its time moved): the pushes wait for it.
    update app.survey_notice_runs
       set send_at = s.opens_at, job_id = app.enqueue_job(s.center_id, 'surveys.launch_notify', jsonb_build_object('survey_id', s.id), s.opens_at, 5)
     where survey_id = p_survey;
    return jsonb_build_object('done', true, 'processed', 0, 'pushed', 0, 'refused', 0, 'reason', 'The survey opens later; the pushes wait for it.');
  end if;
  if r.planned is null then
    -- Scheduled ahead (Request feedback): take the counts and check what would stop everyone, now.
    r.planned := app._survey_notice_counts(s.id);
    v_orig := (r.planned->>'will_push')::int;
    if (c.rules #>> '{notifications,triggers,event_feedback}') = 'false' then
      v_off := v_orig > 0;
      r.planned := r.planned || jsonb_build_object('switched_off', v_orig, 'will_push', 0);
    elsif v_orig > 0 then
      v_problem := app._survey_notice_problem(s.id);
    end if;
    update app.survey_notice_runs
       set planned = r.planned,
           problem_code = case when v_problem is not null then 'template' when v_off then 'switched_off' end,
           problem = coalesce(v_problem, case when v_off then app._survey_notice_off_text() end),
           finished_at = case when v_problem is not null or v_off or (r.planned->>'will_push')::int = 0 then now() end
     where survey_id = p_survey;
    if v_problem is not null then
      perform app._member_notice_not_sent(s.center_id, 'surveys', s.id::text, 'event_survey',
                                          jsonb_build_object('template', v_orig), v_problem);
    end if;
    if v_problem is not null or v_off or (r.planned->>'will_push')::int = 0 then
      return jsonb_build_object('done', true, 'processed', 0, 'pushed', 0, 'refused', 0,
                                'reason', coalesce(v_problem, case when v_off then app._survey_notice_off_text() end, 'Nobody gets a push.'));
    end if;
  elsif (c.rules #>> '{notifications,triggers,event_feedback}') = 'false' then
    -- Switched off after the job was queued: say so on the run (when nobody was pushed yet) so "Send the pushes" can send.
    update app.survey_notice_runs
       set finished_at = now(),
           problem_code = case when pushed = 0 then 'switched_off' else problem_code end,
           problem = case when pushed = 0 then app._survey_notice_off_text() else problem end
     where survey_id = p_survey;
    return jsonb_build_object('done', true, 'processed', 0, 'pushed', 0, 'refused', 0,
                              'reason', 'Event feedback is switched off in Settings › Notifications.');
  end if;
  perform app.set_audit_context('Event feedback: the survey push and its reminders are queued');
  select e.name into v_event from app.events e where e.id = s.event_id;
  v_vars := app._survey_notice_vars(s.reward_points, v_event);
  v_route := app._survey_notice_route(s.id, s.event_id, s.reward_points);
  for a in select x.person_id
             from app._survey_notice_audience(s.id) x
            where not x.answered and x.has_phone and x.push_on and x.test_ok
              and not exists (select 1 from app.survey_notice_recipients nr where nr.survey_id = s.id and nr.person_id = x.person_id)
            order by x.person_id
            limit v_lim
  loop
    v_done := v_done + 1;
    -- The audience above was read when this batch started: check this person again now (they may have answered since).
    if exists (select 1 from app.survey_completions sc where sc.survey_id = s.id and sc.person_id = a.person_id) then
      insert into app.survey_notice_recipients (survey_id, person_id, center_id, outcome, reason)
      values (s.id, a.person_id, s.center_id, 'refused', 'answered');
      continue;
    end if;
    p1 := app._member_push(s.center_id, a.person_id, 'event_feedback', 'events', 'event_survey', v_vars, v_route, now(), s.closes_at);
    if p1->>'reason' = 'switched_off' then
      -- Switched off while the batch ran: stop, and leave this person (and everyone after) for the next send.
      v_stop := true;
      v_done := v_done - 1;
      exit;
    end if;
    if p1 ? 'id' then
      v_first := (p1->>'send_at')::timestamptz;
      foreach d in array array[interval '1 day', interval '2 days'] loop
        p2 := app._member_push(s.center_id, a.person_id, 'event_feedback', 'events', 'event_survey_reminder', v_vars, v_route,
                               v_first + d, s.closes_at);
        if not (p2 ? 'id') then
          v_audit := app._add_counts(v_audit, jsonb_build_object(coalesce(p2->>'reason', 'error'), 1));
          v_err := coalesce(v_err, p2->>'error');
        end if;
      end loop;
      insert into app.survey_notice_recipients (survey_id, person_id, center_id, outcome, first_push_at)
      values (s.id, a.person_id, s.center_id, 'pushed', v_first);
      v_pushed := v_pushed + 1;
    else
      insert into app.survey_notice_recipients (survey_id, person_id, center_id, outcome, reason)
      values (s.id, a.person_id, s.center_id, 'refused', coalesce(p1->>'reason', 'error'));
      v_refused := app._add_counts(v_refused, jsonb_build_object(coalesce(p1->>'reason', 'error'), 1));
      v_audit := app._add_counts(v_audit, jsonb_build_object(coalesce(p1->>'reason', 'error'), 1));
      v_err := coalesce(v_err, p1->>'error');
    end if;
  end loop;
  v_more := not v_stop and exists (select 1 from app._survey_notice_audience(s.id) x
                     where not x.answered and x.has_phone and x.push_on and x.test_ok
                       and not exists (select 1 from app.survey_notice_recipients nr where nr.survey_id = s.id and nr.person_id = x.person_id));
  update app.survey_notice_runs
     set pushed = pushed + v_pushed, refused = app._add_counts(refused, v_refused), started_at = coalesce(started_at, now()),
         finished_at = case when v_more then null else now() end,
         problem_code = case when v_stop and pushed + v_pushed = 0 then 'switched_off' else problem_code end,
         problem = case when v_stop and pushed + v_pushed = 0 then app._survey_notice_off_text() else problem end
   where survey_id = p_survey;
  perform app._member_notice_not_sent(s.center_id, 'surveys', s.id::text, 'event_survey', v_audit, v_err);
  return jsonb_build_object('done', not v_more, 'processed', v_done, 'pushed', v_pushed,
                            'refused', coalesce((select sum((value #>> '{}')::int) from jsonb_each(v_refused)), 0));
end $$;

-- ── The background service's status: due jobs and scheduled jobs apart (item 5) ──────
-- The 0589 body. "queued" counts the jobs that are due (run_after reached); the ones scheduled for later (a reminder due
-- tomorrow, a retry waiting out its back-off) are "scheduled", so the count staff read is the real backlog.
create or replace function app.background_service_status(p_center uuid)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_last timestamptz; v_workers jsonb; v_jobs jsonb; v_state text; v_live int;
begin
  if not (app.has_permission(p_center, 'settings.manage') or app.has_permission(p_center, 'integrations.view')
          or app.has_permission(p_center, 'integrations.manage') or app.is_center_owner(p_center)) then
    raise exception 'Seeing the background service needs settings.manage or integrations.view.' using errcode = 'insufficient_privilege';
  end if;
  select max(beat_at), count(*) filter (where stopped_at is null and beat_at >= now() - app.worker_stale_after()),
         coalesce(jsonb_agg(jsonb_build_object('worker', worker, 'started_at', started_at, 'beat_at', beat_at,
                                               'stopped_at', stopped_at, 'version', version, 'kinds', kinds,
                                               'handlers', coalesce(info->'handlers', '{}'::jsonb))
                            order by (stopped_at is null) desc, beat_at desc), '[]'::jsonb)
    into v_last, v_live, v_workers
    from app.worker_heartbeats;
  v_state := case when v_last is null then 'not_configured'
                  when v_live > 0 then 'running'
                  else 'stopped' end;
  select jsonb_build_object(
           'queued',     count(*) filter (where status = 'queued' and run_after <= now()),
           'scheduled',  count(*) filter (where status = 'queued' and run_after > now()),
           'running',    count(*) filter (where status = 'running'),
           'failed_24h', count(*) filter (where status = 'failed' and finished_at > now() - interval '24 hours'),
           'done_24h',   count(*) filter (where status = 'done' and finished_at > now() - interval '24 hours'),
           'scan_pending', count(*) filter (where kind = 'storage.scan' and status in ('queued','running')))
    into v_jobs
    from app.jobs where center_id = p_center;
  return jsonb_build_object('state', v_state, 'last_beat_at', v_last,
                            'age_seconds', case when v_last is null then null else extract(epoch from now() - v_last)::int end,
                            'workers', v_workers, 'jobs', v_jobs,
                            'scan', case when to_regclass('storage.objects') is null then null else app._upload_scan_summary(p_center) end);
end $$;

-- ── STOP / HELP replies: the same inbound text never makes two replies (item 4) ─────
-- The 0223 body, plus: when a reply for this inbound message (its MessageSid) already exists, nothing is recorded or
-- queued again and the same reply is returned, so the webhook job can run again after a Twilio error and send it.
create or replace function app.worker_record_inbound_sms(p_from text, p_to text, p_body text, p_sid text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_from text := app.normalize_recipient('sms', p_from); v_to text := app.normalize_recipient('sms', p_to);
        v_center uuid; c app.centers; v_word text := upper(regexp_replace(btrim(coalesce(p_body, '')), '[^A-Za-z]', '', 'g'));
        v_kind text; v_reply text; v_msg uuid; v_name text; v_contact text; p record; s app.message_suppressions;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  select coalesce(
           (select center_id from app.integration_connections where provider = 'twilio' and app.normalize_recipient('sms', settings->>'from_number') = v_to limit 1),
           (select center_id from app.texting_registrations where app.normalize_recipient('sms', detail->>'from_number') = v_to limit 1))
    into v_center;
  select * into c from app.centers where id = v_center;
  v_name := coalesce(nullif(btrim(c.short_name), ''), c.name, 'Community Connect');
  v_kind := case when v_word in ('STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT','OPTOUT','REVOKE') then 'stop'
                 when v_word in ('START','YES','UNSTOP','SUBSCRIBE') then 'start'
                 when v_word in ('HELP','INFO') then 'help' end;
  if v_kind is null or v_from is null then return jsonb_build_object('keyword', null, 'center_id', v_center); end if;

  -- Already answered (the webhook job ran again after the reply failed to send): the same reply, nothing recorded twice.
  if nullif(btrim(coalesce(p_sid, '')), '') is not null then
    select m.id into v_msg from app.messages m
     where m.template_key = 'keyword_reply' and m.payload->>'inbound_sid' = p_sid
     order by m.created_at limit 1;
    if v_msg is not null then
      return jsonb_build_object('keyword', v_kind, 'center_id', v_center, 'reply_message_id', v_msg, 'repeated', true);
    end if;
  end if;

  perform app.set_audit_context('Text from ' || v_from || ': ' || v_word);
  if v_kind = 'stop' then
    if (app.message_suppression_for(v_center, 'sms', v_from)).id is null then
      insert into app.message_suppressions (center_id, channel, address, reason, detail)
      values (v_center, 'sms', v_from, 'stop', 'Replied ' || v_word || coalesce(' · ' || p_sid, ''));
    end if;
    v_reply := v_name || ': You are unsubscribed and will get no more texts from us. Reply START to subscribe again.';
  elsif v_kind = 'start' then
    for s in select * from app.message_suppressions
              where channel = 'sms' and address = v_from and reason = 'stop' and lifted_at is null
                and center_id is not distinct from v_center loop
      update app.message_suppressions set lifted_at = now(), lift_reason = 'Replied ' || v_word where id = s.id;
    end loop;
    v_reply := v_name || ': You are subscribed to texts again. Reply HELP for help, STOP to unsubscribe. Msg & data rates may apply.';
  else
    select coalesce(pr.public_email::text, pr.public_phone) into v_contact from app.org_profiles pr where pr.center_id = v_center;
    v_reply := v_name || ': texts from ' || coalesce(c.name, 'Community Connect') || ' via Community Connect.'
               || coalesce(' Help: ' || v_contact || '.', '') || ' Reply STOP to unsubscribe. Msg & data rates may apply.';
  end if;
  if v_center is not null and v_kind in ('stop','start') then
    for p in select id from app.people where center_id = v_center and phone_e164 = v_from loop
      insert into app.channel_optins (center_id, person_id, channel, address, opted_in, source)
      values (v_center, p.id, 'sms', v_from, v_kind = 'start', 'keyword');
    end loop;
  end if;
  insert into app.messages (center_id, to_address, channel, template_key, body, payload, status, purpose, sandbox, segments)
  values (v_center, v_from, 'sms', 'keyword_reply',
          case when c.environment = 'sandbox' then 'Sandbox · test data: ' else '' end || v_reply,
          jsonb_build_object('keyword_reply', true, 'keyword', v_kind, 'inbound_sid', p_sid, 'reply_from', v_to),
          'queued', 'notification', coalesce(c.environment = 'sandbox', false), app.sms_segments(v_reply))
  returning id into v_msg;
  return jsonb_build_object('keyword', v_kind, 'center_id', v_center, 'reply_message_id', v_msg);
end $$;

-- ── Comments and grants ──────────────────────────────────────────────────────────
comment on function app.enqueue_notice(uuid, text, text, text, jsonb, text, timestamptz, text, timestamptz, jsonb, boolean) is
  'app.enqueue_message_at plus the notice''s own facts (0598): its topic (given, else the template''s: app.notice_topic), its expiry, its route (type, deep_link, ids: the top level of the payload) and system (no creator on the message or its job). One insert for the message, one for its job. Not callable over the API.';
comment on function app.enqueue_message_at(uuid, text, text, text, jsonb, text, timestamptz) is
  'app.enqueue_message with a send time (0596): the job runs at greatest(p_send_at, now()), or when quiet hours end if that time falls in them (event-day messages excepted). Since 0598 a wrapper over app.enqueue_notice. Not callable over the API.';
comment on function app.notice_topic(text) is
  'The notification topic a notice template belongs to, or null (0598): the member''s choice for that topic and channel is applied when the notice is sent.';
comment on function app.notice_trigger(text) is
  'The Settings › Notifications switch a notice template belongs to, or null (0598): checked when the notice is queued and again when it is sent.';
comment on function app.notice_is_service(text) is
  'A notice about the member''s own order: only an explicit off of the member''s topic choice holds it back, never the topic''s default (0598).';
comment on function app.worker_notices_sweep(integer) is
  'The worker role only (job notices.sweep, 0598): the RSVP confirmations, the boli notices before they close and the special-day labh prompts that are due now, once per thing and person. Returns each sweep''s {pushed, refused, more}.';
comment on function app.store_order_ready_notice() is
  'Trigger (0598): a store order moved to ready pushes the member who placed it, once; it never blocks the kitchen.';
comment on function app.worker_record_inbound_sms(text, text, text, text) is
  'The worker role only: an inbound text. STOP / START / HELP keywords (CTIA) are recorded and ONE reply per inbound message is queued; the same MessageSid again returns that reply and records nothing (0598).';

do $$
declare f text;
begin
  foreach f in array array[
    'app.notice_topic(text)', 'app.notice_trigger(text)', 'app.notice_is_service(text)',
    'app._notice_topic_on(uuid, text, text, boolean)', 'app._notice_household_adults(uuid)',
    'app.enqueue_notice(uuid, text, text, text, jsonb, text, timestamptz, text, timestamptz, jsonb, boolean)',
    'app._survey_notice_off_text()',
    'app._rsvp_confirmation_sweep(integer)', 'app._boli_closing_sweep(integer)', 'app._special_day_labh_sweep(integer)',
    'app.rsvps_cancel_waiting_confirmation()', 'app.store_order_ready_notice()'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    -- service_role as for enqueue_message (0221/0421); never a blanket grant on the schema, which would hand back the
    -- worker-only functions later migrations took away from it.
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
revoke execute on function app.worker_notices_sweep(integer) from public, anon, authenticated, service_role;
grant execute on function app.worker_notices_sweep(integer) to connect_worker;
