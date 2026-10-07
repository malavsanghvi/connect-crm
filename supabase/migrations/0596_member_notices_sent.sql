-- 0596: event feedback, lunch and boli pushes are actually sent.
--
-- The bug: three shipped features wrote their notices straight into app.messages with no recipient (to_address),
-- no purpose and no job, and nothing sends such a row, so none of them ever reached anyone:
--   event feedback  app.launch_event_survey (0544): a push now, then reminders on day 1 and day 2
--   lunch           app.assign_lunch_for_rsvp (0104, called by app.check_in and the demo pack): before the slot;
--                   app.move_lunch_slot only rewrote the queued row's time and text
--   bolis           app.place_boli_entry (0104): "another family pledged more" to the previous top family
-- Messages go out only through app.enqueue_message (0221/0421): it renders the template, applies the sandbox
-- allow-list, suppressions, quiet hours and the deceased rule, and queues a messaging.send job that the background
-- service runs at the job's run_after.
--
-- What changes:
--   app.enqueue_message_at(center, channel, to, template, vars, purpose, send_at)
--                   the 0421 body with a send time: greatest(send_at, now()), and quiet hours judged AT that time;
--                   the job's run_after and the row's scheduled_at are the real send time.
--   app.enqueue_message(6 arguments)  unchanged signature (six callers check for it): a wrapper, send now.
--   messages.expires_at   a notice past it is not sent late (the slot started, the survey or the boli closed).
--   app.worker_message_to_send  the 0421 body plus: an expired notice is cancelled with a plain reason; a notice
--                   whose topic the member switched off for that channel in the app (notification_preferences,
--                   no row = the topic's default) is not sent; the sandbox re-check no longer lets a row with no
--                   purpose through (coalesce).
--   app._member_push(center, person, trigger, topic, template, vars, route, send_at, expires_at)
--                   one push to a member's login; null (nothing queued) when there is no person, it is already past
--                   expiry, the community switched the trigger off (rules.notifications.triggers.<trigger> = false),
--                   or the person has no login in this community or no working phone. Any refusal (a sandbox's CCENT,
--                   a missing template, anything) is written to the audit log as member_notice.not_sent and
--                   swallowed: a pledge, a check-in or an event completion never fails because of a notice. The
--                   route (type, deep_link, ids) goes at the TOP level of the payload, where the worker's pushRouting,
--                   app.submit_survey's cancel and the lunch duplicate check read it.
--   templates       platform push templates event_survey, event_survey_reminder, lunch_reminder, boli_outbid.
--   call sites      launch_event_survey (timing kept: now, +1 day, +2 days, until the survey closes; returns the
--                   number of people queued), launch_event_survey_now (counts queued rows only),
--                   assign_lunch_for_rsvp and move_lunch_slot (rules.lunch.reminder_minutes_before, default 5,
--                   0 = off; event-day, so quiet hours do not hold it), place_boli_entry (the previous top family,
--                   when its entry has a person; the new top family's own waiting notice is cancelled).
--   cancelling      a queued message that is cancelled or suppressed takes its waiting job with it; a survey that
--                   closes cancels its waiting pushes; a boli that closes cancels its waiting outbid notices.
--   backlog         the old rows (queued, no job, no purpose) are cancelled with a reason, never sent, never deleted.
set client_min_messages = warning;

-- The two topics these notices carry (seed.sql loads them into a new database; a notice whose topic is missing would
-- be refused by the foreign key, so make sure).
insert into app.notification_topics (key, name, default_on, marketing) values
  ('events', 'Events and reminders', true, false),
  ('giving', 'Giving opportunities and bolis', true, true)
on conflict (key) do nothing;

-- ── messages.expires_at ─────────────────────────────────────────────────────────
alter table app.messages add column if not exists expires_at timestamptz;
comment on column app.messages.expires_at is
  'When the message stops being useful (0596): a lunch reminder at the slot''s start, a survey push when the survey closes, a boli notice when the boli closes. app.worker_message_to_send cancels it instead of sending it late.';

-- ── enqueue_message_at (the 0421 body with a send time) ─────────────────────────
create or replace function app.enqueue_message_at(p_center uuid, p_channel text, p_to text, p_template_key text,
                                                  p_vars jsonb, p_purpose text, p_send_at timestamptz) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  c app.centers; s app.message_suppressions; v_rendered jsonb;
  v_to text; v_vars jsonb; v_masked jsonb; v_secret jsonb := '{}'::jsonb; k text;
  v_subject text; v_body text; v_sandbox boolean := false; v_status text := 'queued'; v_reason text;
  v_when timestamptz := greatest(coalesce(p_send_at, now()), now()); v_quiet timestamptz; v_id uuid := gen_random_uuid();
  v_job bigint; v_vault uuid; v_person uuid; v_payload jsonb; v_optout boolean; v_dead text;
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

  v_person := case when coalesce(p_vars->>'person_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                   then (p_vars->>'person_id')::uuid end;
  if v_person is not null and not exists (select 1 from app.people where id = v_person and center_id is not distinct from p_center) then
    v_person := null;
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
  v_payload := jsonb_build_object('vars', v_masked);
  if v_status = 'queued' and v_secret <> '{}'::jsonb then
    v_vault := vault.create_secret(v_secret::text, 'message:' || v_id::text, 'Values held until this message is sent');
    v_payload := v_payload || jsonb_build_object('secret_ref', v_vault);
  end if;

  insert into app.messages (id, center_id, person_id, to_address, channel, template_key, subject, body, payload,
                            scheduled_at, status, failure_reason, purpose, sandbox, segments, created_by)
  values (v_id, p_center, v_person, v_to, p_channel::app.channel, p_template_key, v_subject, v_body, v_payload,
          v_when, v_status, v_reason, p_purpose, v_sandbox,
          case when p_channel = 'sms' then app.sms_segments(v_body) end, auth.uid());

  if v_status = 'queued' then
    v_job := app.enqueue_job(p_center, case when p_purpose = 'test' then 'messaging.test_send' else 'messaging.send' end,
                             jsonb_build_object('message_id', v_id), v_when, 5);
    update app.messages set job_id = v_job where id = v_id;
  end if;
  return v_id;
end $$;

-- The six-argument API every caller uses: send now.
create or replace function app.enqueue_message(p_center uuid, p_channel text, p_to text, p_template_key text,
                                               p_vars jsonb, p_purpose text) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  return app.enqueue_message_at(p_center, p_channel, p_to, p_template_key, p_vars, p_purpose, now());
end $$;

-- ── Send-time re-check (0421 + expiry + the member's topic choice) ──────────────
create or replace function app.worker_message_to_send(p_message uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare m app.messages; st app.messaging_settings; v_secret jsonb; v_rendered jsonb; v_skip text; s app.message_suppressions;
        v_provider text; v_conn app.integration_connections; v_route jsonb := '{}'::jsonb; v_tokens jsonb; w app.whatsapp_accounts; v_dead text;
        v_tz text; v_topic text; v_on boolean;
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

  -- 0596: the member switched this topic off for this channel in the app (no row = the topic's default).
  if v_skip is null and m.topic_key is not null and m.person_id is not null then
    select coalesce(np.enabled, t.default_on, true), t.name into v_on, v_topic
      from app.notification_topics t
      left join app.notification_preferences np on np.person_id = m.person_id and np.topic_key = t.key and np.channel = m.channel
     where t.key = m.topic_key;
    if v_on is false then
      v_skip := 'Not sent: the member switched off "' || coalesce(v_topic, m.topic_key) || '" ' ||
                case m.channel::text when 'sms' then 'text' when 'whatsapp' then 'WhatsApp' else m.channel::text end ||
                ' notifications in the app.';
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

-- ── A message that will not be sent leaves no job waiting ───────────────────────
-- Cancelled (an answered survey, a moved lunch slot, a closed boli or survey, an expired notice) or suppressed (a
-- person recorded as deceased): its messaging.send job is cancelled too, so the queue only holds work that will run.
-- A job the worker already claimed (running) is left to finish.
create or replace function app.messages_cancel_waiting_job() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  update app.jobs
     set status = 'cancelled', finished_at = now(), locked_by = null, locked_at = null,
         result = jsonb_build_object('message_id', new.id, 'skipped', 'The message is already ' || new.status || '.')
   where id = new.job_id and status = 'queued' and kind in ('messaging.send', 'messaging.test_send')
     and payload->>'message_id' = new.id::text;
  return null;
end $$;
drop trigger if exists messages_cancel_waiting_job on app.messages;
create trigger messages_cancel_waiting_job after update of status on app.messages
  for each row when (old.status = 'queued' and new.status in ('cancelled', 'suppressed') and new.job_id is not null)
  execute function app.messages_cancel_waiting_job();

-- ── One push to a member ─────────────────────────────────────────────────────────
-- Returns the id of the queued message, or null when nothing was queued. Never raises for a messaging reason.
create or replace function app._member_push(p_center uuid, p_person uuid, p_trigger text, p_topic text, p_template text,
                                            p_vars jsonb, p_route jsonb, p_send_at timestamptz, p_expires_at timestamptz)
returns uuid language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.centers; v_user uuid; v_id uuid; v_status text;
begin
  if p_center is null or p_person is null then return null; end if;
  if p_expires_at is not null and p_expires_at <= greatest(coalesce(p_send_at, now()), now()) then return null; end if;
  select * into c from app.centers where id = p_center;
  if not found then return null; end if;
  -- Settings › Notifications: the community switched this trigger off.
  if p_trigger is not null and (c.rules #>> array['notifications', 'triggers', p_trigger]) = 'false' then return null; end if;
  -- The person's login in this community, with a phone that takes notifications.
  select cu.user_id into v_user
    from app.center_users cu
   where cu.center_id = p_center and cu.person_id = p_person
     and exists (select 1 from app.push_devices d where d.user_id = cu.user_id and d.invalid_at is null);
  if v_user is null then return null; end if;
  begin
    v_id := app.enqueue_message_at(p_center, 'push', v_user::text, p_template,
                                   coalesce(p_vars, '{}'::jsonb) || jsonb_build_object('person_id', p_person::text),
                                   'notification', p_send_at);
    update app.messages
       set topic_key = p_topic, expires_at = p_expires_at, payload = payload || coalesce(p_route, '{}'::jsonb)
     where id = v_id
    returning status into v_status;
  exception when others then
    perform app.log_audit(p_center, 'member_notice.not_sent', 'people', p_person::text, null,
                          jsonb_build_object('template', p_template, 'trigger', p_trigger, 'error', sqlerrm, 'sqlstate', sqlstate),
                          'Member notice not queued');
    return null;
  end;
  return case when v_status = 'queued' then v_id end;
end $$;

-- ── Platform templates (a community may override them) ──────────────────────────
-- Variables: event (the event's name), points (" Earn 25 points." or ""), time (the slot's start, community time),
-- minutes (how long before the slot), boli (the boli's name). Nothing personal: no names, no amounts.
insert into app.message_templates (center_id, key, channel, language, subject, body)
select null, v.key, v.channel::app.channel, 'en', v.subject, v.body
  from (values
  ('event_survey', 'push', '{{event}} · feedback',
   'How was {{event}}? Share your feedback.{{points}}'),
  ('event_survey_reminder', 'push', '{{event}} · feedback',
   'Reminder: how was {{event}}? Your feedback takes a minute.{{points}}'),
  ('lunch_reminder', 'push', 'Lunch at {{time}}',
   'Your lunch slot at {{event}} starts at {{time}}.'),
  ('boli_outbid', 'push', 'Another family pledged more',
   'Another family pledged more for {{boli}}. Open the app to see the latest pledge.')
  ) as v(key, channel, subject, body)
 where not exists (select 1 from app.message_templates t
                    where t.center_id is null and t.key = v.key and t.channel = v.channel::app.channel and t.language = 'en');

-- ── Event feedback ───────────────────────────────────────────────────────────────
-- Adults of every household with an active RSVP or who attended (the 0544 audience): a push now, then a reminder on
-- day 1 and day 2, until they answer or the survey closes. Returns how many people had a push queued.
create or replace function app.launch_event_survey(p_survey uuid) returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.surveys; e app.events; n int := 0; w record; sl record; v_any boolean; v_vars jsonb; v_route jsonb;
        v_closes timestamptz := now() + interval '14 days';
begin
  select * into s from app.surveys where id = p_survey for update;
  if s.id is null or s.event_id is null then return 0; end if;
  if s.completion_started_at is not null then return 0; end if;
  select * into e from app.events where id = s.event_id;
  update app.surveys set status = 'open', opens_at = now(), closes_at = v_closes, completion_started_at = now(),
         audience = jsonb_build_object('event_id', s.event_id, 'rsvp_statuses', jsonb_build_array('rsvpd', 'confirmed', 'attended'))
   where id = s.id;
  v_vars := jsonb_build_object('event', e.name,
                               'points', case when s.reward_points > 0 then ' Earn ' || s.reward_points || ' points.' else '' end);
  v_route := jsonb_build_object('survey_id', s.id::text, 'event_id', s.event_id::text, 'reward_points', s.reward_points,
                                'deep_link', 'survey/' || s.id::text);
  for w in
    select distinct hm.person_id
      from app.rsvps r
      join app.household_members hm on hm.household_id = r.household_id and hm.left_at is null
      join app.people p on p.id = hm.person_id
     where r.event_id = s.event_id and r.status in ('rsvpd', 'confirmed', 'attended')
       and (p.date_of_birth is null or p.date_of_birth <= current_date - interval '18 years')
       and not coalesce(p.is_deceased, false)
  loop
    v_any := false;
    for sl in select * from (values ('event_survey', interval '0'), ('event_survey_reminder', interval '1 day'),
                                    ('event_survey_reminder', interval '2 days')) x(tpl, delay) loop
      if app._member_push(s.center_id, w.person_id, 'event_feedback', 'events', sl.tpl, v_vars, v_route,
                          now() + sl.delay, v_closes) is not null then
        v_any := true;
      end if;
    end loop;
    if v_any then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Returns how many people had a push queued (only rows that will be sent).
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
           where m.center_id = s.center_id and m.template_key = 'event_survey' and m.payload->>'survey_id' = s.id::text
             and m.status = 'queued' and m.job_id is not null);
end $$;

-- A survey that closes (or goes back to draft) cancels its waiting pushes.
create or replace function app.surveys_cancel_waiting_pushes() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  update app.messages
     set status = 'cancelled', failure_reason = 'Not sent: the survey closed before it went.'
   where center_id = new.center_id and status = 'queued' and template_key in ('event_survey', 'event_survey_reminder')
     and payload->>'survey_id' = new.id::text;
  return null;
end $$;
drop trigger if exists surveys_cancel_waiting_pushes on app.surveys;
create trigger surveys_cancel_waiting_pushes after update of status on app.surveys
  for each row when (old.status = 'open' and new.status is distinct from 'open')
  execute function app.surveys_cancel_waiting_pushes();

-- ── Lunch ────────────────────────────────────────────────────────────────────────
-- One attendee's reminder: rules.lunch.reminder_minutes_before (Settings › Rules › Lunch; default 5, 0 = off) before
-- the slot, gone once the slot starts; event-day, so quiet hours do not hold it.
create or replace function app._lunch_reminder(p_attendee uuid) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare a app.attendees; s app.lunch_slots; e app.events; c app.centers; v_raw jsonb; v_minutes int;
begin
  select * into a from app.attendees where id = p_attendee;
  if a.id is null or a.person_id is null or a.lunch_slot_id is null then return null; end if;
  select * into s from app.lunch_slots where id = a.lunch_slot_id;
  select * into e from app.events where id = a.event_id;
  select * into c from app.centers where id = e.center_id;
  v_raw := c.rules #> '{lunch,reminder_minutes_before}';
  v_minutes := case when jsonb_typeof(v_raw) = 'number' and (v_raw #>> '{}')::numeric >= 0
                         and (v_raw #>> '{}')::numeric = trunc((v_raw #>> '{}')::numeric)
                    then least((v_raw #>> '{}')::numeric, 120)::int else 5 end;
  if v_minutes = 0 or s.starts_at is null then return null; end if;
  return app._member_push(e.center_id, a.person_id, 'lunch_reminder', 'events', 'lunch_reminder',
           jsonb_build_object('event', e.name, 'time', to_char(s.starts_at at time zone c.time_zone, 'FMHH12:MI AM'),
                              'minutes', v_minutes, 'event_day', true),
           jsonb_build_object('event_id', e.id::text, 'slot_id', s.id::text),
           s.starts_at - make_interval(mins => v_minutes), s.starts_at);
exception when others then
  -- A check-in never fails because of its reminder.
  perform app.log_audit(e.center_id, 'member_notice.not_sent', 'people', a.person_id::text, null,
                        jsonb_build_object('template', 'lunch_reminder', 'trigger', 'lunch_reminder', 'error', sqlerrm, 'sqlstate', sqlstate),
                        'Member notice not queued');
  return null;
end $$;

-- The 0104 body; the reminders at the end go through app._lunch_reminder (one per person and event, while one is
-- waiting or was sent).
create or replace function app.assign_lunch_for_rsvp(p_rsvp uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.rsvps; e app.events; v_group_first boolean; v_slot uuid; v_need int; a record;
begin
  select * into r from app.rsvps where id = p_rsvp;
  select * into e from app.events where id = r.event_id;
  perform app.assert_module_enabled(e.center_id, 'events');
  if not e.lunch_enabled then return; end if;
  perform app.ensure_lunch_slots(e.id);
  v_group_first := coalesce((e.lunch_priority_rules->>'family_with_child_under_12_at_start')::boolean, true)
    and exists (select 1 from app.attendees where rsvp_id = p_rsvp and checked_in_at is not null and is_child_under_12);
  -- Whole family at the first slot if there is a child under 12.
  if v_group_first then
    select id into v_slot from app.lunch_slots where event_id = e.id order by starts_at limit 1;
    update app.attendees set lunch_slot_id = v_slot where rsvp_id = p_rsvp and checked_in_at is not null and lunch_slot_id is null;
  else
    -- Seniors at the first slot.
    if coalesce((e.lunch_priority_rules->>'senior_at_start')::boolean, true) then
      select id into v_slot from app.lunch_slots where event_id = e.id order by starts_at limit 1;
      update app.attendees set lunch_slot_id = v_slot where rsvp_id = p_rsvp and checked_in_at is not null and is_senior and lunch_slot_id is null;
    end if;
    -- Everyone else: earliest slot with room, in arrival order (they arrive now, so the next open slot).
    for a in select id from app.attendees where rsvp_id = p_rsvp and checked_in_at is not null and lunch_slot_id is null loop
      select s.id into v_slot from app.lunch_slots s where s.event_id = e.id
        and s.seats > (select count(*) from app.attendees x where x.lunch_slot_id = s.id)
        order by s.starts_at limit 1;
      update app.attendees set lunch_slot_id = v_slot where id = a.id;
    end loop;
  end if;
  update app.lunch_slots s set assigned = (select count(*) from app.attendees x where x.lunch_slot_id = s.id) where s.event_id = e.id;
  -- Reminders (0596: queued for the sender; before, rows nothing sent).
  for a in select at.id from app.attendees at
            where at.rsvp_id = p_rsvp and at.person_id is not null and at.lunch_slot_id is not null
              and not exists (select 1 from app.messages m
                               where m.center_id = e.center_id and m.template_key = 'lunch_reminder' and m.person_id = at.person_id
                                 and m.payload->>'event_id' = e.id::text and m.status in ('queued', 'sent', 'delivered'))
  loop
    perform app._lunch_reminder(a.id);
  end loop;
end $$;

-- The 0104 body; a move cancels the moved people's waiting reminder (and its job) and queues one for the new slot.
create or replace function app.move_lunch_slot(p_attendee_ids uuid[], p_slot uuid) returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.lunch_slots; v_n int; v_rsvp uuid; v_household uuid; v_current timestamptz; v_moved record;
begin
  select * into s from app.lunch_slots where id = p_slot for update;
  perform app.assert_module_enabled(s.center_id, 'events');
  if s.id is null then raise exception 'lunch slot not found'; end if;
  select distinct a.rsvp_id into v_rsvp from app.attendees a where a.id = any(p_attendee_ids) and a.event_id = s.event_id;
  if v_rsvp is null then raise exception 'these people are not on this event'; end if;
  select household_id into v_household from app.rsvps where id = v_rsvp;
  if not (app.adult_of_household(s.center_id, v_household)
          or app.has_scoped_role(s.center_id, s.event_id, 'event_lead', 'checkin_volunteer')) then
    raise exception 'only an adult of the household or an event volunteer can change lunch times';
  end if;
  select min(ls.starts_at) into v_current from app.attendees a join app.lunch_slots ls on ls.id = a.lunch_slot_id
   where a.id = any(p_attendee_ids);
  if v_current is not null and s.starts_at <= v_current then raise exception 'choose a later lunch time'; end if;
  if s.starts_at < now() - make_interval(mins => 5) then raise exception 'that lunch time has passed'; end if;
  v_n := coalesce(array_length(p_attendee_ids, 1), 0);
  if s.seats - (select count(*) from app.attendees x where x.lunch_slot_id = s.id) < v_n then
    raise exception 'that lunch time is full';
  end if;
  update app.attendees set lunch_slot_id = s.id where id = any(p_attendee_ids) and checked_in_at is not null;
  get diagnostics v_n = row_count;
  update app.lunch_slots ls set assigned = (select count(*) from app.attendees x where x.lunch_slot_id = ls.id) where ls.event_id = s.event_id;
  update app.messages m
     set status = 'cancelled', failure_reason = 'Not sent: the lunch time changed; a reminder for the new time replaces it.'
   where m.center_id = s.center_id and m.template_key = 'lunch_reminder' and m.status = 'queued'
     and m.payload->>'event_id' = s.event_id::text
     and m.person_id in (select x.person_id from app.attendees x
                          where x.id = any(p_attendee_ids) and x.lunch_slot_id = s.id and x.person_id is not null);
  for v_moved in select x.id from app.attendees x where x.id = any(p_attendee_ids) and x.lunch_slot_id = s.id and x.person_id is not null loop
    perform app._lunch_reminder(v_moved.id);
  end loop;
  return v_n;
end $$;

-- ── Bolis ────────────────────────────────────────────────────────────────────────
-- The 0104 body; the notice goes to the family that was on top just before this pledge (when it is another family
-- and its entry names a person), until the boli closes. The new top family's own waiting notice is cancelled.
create or replace function app.place_boli_entry(p_boli uuid, p_household uuid, p_amount_cents bigint, p_anonymous boolean default false)
returns uuid language plpgsql security definer set search_path = app, public, extensions as $$
declare b app.bolis; v_min bigint; v_entry uuid; v_close timestamptz; v_prev app.boli_entries;
begin
  select * into b from app.bolis where id = p_boli for update;
  perform app.assert_module_enabled(b.center_id, 'bolis');
  if b.id is null or b.kind <> 'digital' then raise exception 'not a digital boli'; end if;
  if not app.adult_of_household(b.center_id, p_household) then raise exception 'only adults of the household can pledge'; end if;
  v_close := coalesce(b.extended_until, b.closes_at);
  if b.status <> 'open' or (b.opens_at is not null and now() < b.opens_at) or (v_close is not null and now() >= v_close) then
    raise exception 'this boli is not open for pledges';
  end if;
  v_min := app.boli_minimum(p_boli);
  if p_amount_cents < v_min then raise exception 'pledge must be at least %', v_min; end if;
  insert into app.boli_entries (center_id, boli_id, household_id, person_id, amount_cents, entered_by, anonymous)
    values (b.center_id, p_boli, p_household, app.my_person_id(b.center_id), p_amount_cents, auth.uid(), p_anonymous)
    returning id into v_entry;
  -- Anti-sniping: a pledge inside the soft-close window extends the cutoff.
  if b.soft_close_minutes > 0 and v_close is not null and v_close - now() < make_interval(mins => b.soft_close_minutes) then
    update app.bolis set extended_until = now() + make_interval(mins => b.soft_close_minutes) where id = p_boli;
    v_close := now() + make_interval(mins => b.soft_close_minutes);
    update app.messages set expires_at = v_close
     where center_id = b.center_id and template_key = 'boli_outbid' and status = 'queued' and payload->>'boli_id' = p_boli::text;
  end if;
  -- This family is on top now: a notice still waiting to tell it that another family pledged more is out of date.
  update app.messages
     set status = 'cancelled', failure_reason = 'Not sent: they pledged more before it went.'
   where center_id = b.center_id and template_key = 'boli_outbid' and status = 'queued' and payload->>'boli_id' = p_boli::text
     and person_id in (select hm.person_id from app.household_members hm where hm.household_id = p_household and hm.left_at is null);
  -- "Another family pledged more" to the family that was on top until now.
  select * into v_prev from app.boli_entries e
   where e.boli_id = p_boli and e.id <> v_entry
   order by e.amount_cents desc, e.entered_at limit 1;
  if v_prev.id is not null and v_prev.household_id <> p_household and v_prev.person_id is not null then
    perform app._member_push(b.center_id, v_prev.person_id, 'boli_outbid', 'giving', 'boli_outbid',
                             jsonb_build_object('boli', b.name), jsonb_build_object('boli_id', b.id::text), now(), v_close);
  end if;
  return v_entry;
end $$;

-- A boli that closes or is settled cancels its waiting notices.
create or replace function app.bolis_cancel_waiting_notices() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  update app.messages
     set status = 'cancelled', failure_reason = 'Not sent: the boli closed before it went.'
   where center_id = new.center_id and status = 'queued' and template_key = 'boli_outbid' and payload->>'boli_id' = new.id::text;
  return null;
end $$;
drop trigger if exists bolis_cancel_waiting_notices on app.bolis;
create trigger bolis_cancel_waiting_notices after update of status on app.bolis
  for each row when (new.status in ('closed', 'settled') and old.status not in ('closed', 'settled'))
  execute function app.bolis_cancel_waiting_notices();

-- ── The demo pack (0312) ─────────────────────────────────────────────────────────
-- Loading the pack checks in families at a past event. The old lunch code wrote one reminder row per attendee with a
-- slot (35, which the pack then marked "never sent"); a slot that has passed gets no reminder now (and demo people
-- have no login), so the pack loads 35 fewer messages.
update app.demo_packs p
   set contents = (select jsonb_agg(case when m->'rows' ? 'messages'
                                         then jsonb_set(m, '{rows,messages}', to_jsonb((m #>> '{rows,messages}')::int - 35))
                                         else m end order by o)
                     from jsonb_array_elements(p.contents) with ordinality x(m, o))
 where p.key = 'community';

-- ── The old rows: never sent, never deleted ──────────────────────────────────────
-- Rows the old code wrote (queued, no job, no purpose) for these four notices. They are too old to send now.
create or replace function app.cancel_unconnected_member_notices() returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare n int;
begin
  update app.messages
     set status = 'cancelled',
         failure_reason = 'Not sent: queued before this notice was connected to the sender (fixed in 0596); too old to send now.'
   where status = 'queued' and job_id is null and purpose is null
     and template_key in ('event_survey', 'event_survey_reminder', 'lunch_reminder', 'boli_outbid');
  get diagnostics n = row_count;
  return n;
end $$;

-- One transaction even under plain psql, so the audit entries carry the reason.
do $$
begin
  perform app.set_audit_context('0596: notices queued before they were connected to the sender are cancelled, not sent');
  perform app.cancel_unconnected_member_notices();
end $$;

-- ── Comments and grants ──────────────────────────────────────────────────────────
comment on function app.enqueue_message_at(uuid, text, text, text, jsonb, text, timestamptz) is
  'app.enqueue_message with a send time (0596): the job runs at greatest(p_send_at, now()), or when quiet hours end if that time falls in them (event-day messages excepted). Not callable over the API.';
comment on function app._member_push(uuid, uuid, text, text, text, jsonb, jsonb, timestamptz, timestamptz) is
  'One push to a member''s login (0596): null when there is no person, the notice is past expiry, the community switched the trigger off, or the person has no login here or no working phone. Refusals are audited as member_notice.not_sent and never raised. Sets topic_key and expires_at and puts the route at the top level of the payload. Returns the queued message id or null.';
comment on function app.cancel_unconnected_member_notices() is
  'Cancels, with a reason, the event survey, lunch and boli rows written before 0596 (queued, no job, no purpose): nothing ever sent them and they are too old to send. Never deletes. Returns how many.';

revoke execute on function app.enqueue_message_at(uuid, text, text, text, jsonb, text, timestamptz),
  app._member_push(uuid, uuid, text, text, text, jsonb, jsonb, timestamptz, timestamptz),
  app._lunch_reminder(uuid), app.cancel_unconnected_member_notices(),
  app.messages_cancel_waiting_job(), app.surveys_cancel_waiting_pushes(), app.bolis_cancel_waiting_notices()
  from public, anon, authenticated;
revoke execute on function app.enqueue_message(uuid, text, text, text, jsonb, text), app.launch_event_survey(uuid)
  from public, anon, authenticated;
grant execute on all functions in schema app to service_role;
