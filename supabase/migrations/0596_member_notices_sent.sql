-- 0596: event feedback, lunch and boli pushes are actually sent.
--
-- The bug: three shipped features wrote their notices straight into app.messages with no recipient (to_address),
-- no purpose and no job, and nothing sends such a row, so none of them ever reached anyone:
--   event feedback  app.launch_event_survey (0544): a push now, then reminders on day 1 and day 2; and Events ›
--                   Feedback › "Request feedback" scheduled surveys that nothing ever sent
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
--                   whose topic the member switched off for that channel in the app is not sent; the sandbox
--                   re-check no longer lets a row with no purpose through.
--   app._member_push   one push to a member's login with a working phone, or the reason why not (it never raises).
--                   Its send time is the real one (quiet hours unless event-day and allowed); held until after the
--                   notice stops being useful, nothing is queued. Refusals are audited ONCE per call or batch
--                   (member_notice.not_sent, counts by reason). System notices carry no created_by.
--   event feedback  marking an event completed, Send survey, attaching to a completed event and Request feedback
--                   only take set-based counts and queue ONE surveys.launch_notify job (at the send time); the
--                   background service queues each invited adult's push and two reminders (day 1 and day 2 after
--                   that person's first push) in batches, once per person (app.survey_notice_recipients), and
--                   counts what was refused (app.survey_notice_runs, shown on the Survey tab). Owner decision
--                   2026-10-07: the timing stays as built.
--   lunch           rules.lunch.reminder_minutes_before (default 5, 0 = off) before the slot, event-day.
--                   move_lunch_slot is tightened (owner approved 2026-10-07): one RSVP, on this event, the caller's.
--   bolis           the family that was on top just before the pledge (owner decision 2026-10-07: a family raising
--                   its own top pledge tells nobody), event-day (owner decision 2026-10-07), until the boli closes
--                   (a moved close moves it), opening the boli in the member app.
--   cancelling      a queued message that is cancelled or suppressed takes its waiting job with it; answering, a
--                   closed survey, a closed boli and a moved slot cancel what waits.
--   backlog         the old rows (queued, no job, no purpose) are cancelled with a reason, and feedback requests made
--                   before this change are never sent; nothing is deleted.
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
-- Except in one bulk path: closing a survey cancels every waiting push at once (thousands), and one job update per row
-- (each audited) took longer than the database allows a request. That path sets app.keep_cancelled_message_jobs for its
-- own transaction; the jobs it leaves are harmless: app.worker_message_to_send skips a message that is no longer queued.
create trigger messages_cancel_waiting_job after update of status on app.messages
  for each row when (old.status = 'queued' and new.status in ('cancelled', 'suppressed') and new.job_id is not null
                     and coalesce(current_setting('app.keep_cancelled_message_jobs', true), '') <> 'on')
  execute function app.messages_cancel_waiting_job();

-- ── Why a member notice was not queued ───────────────────────────────────────────
-- The reasons app._member_push gives. Expected, not audited: no_person, switched_off (Settings › Notifications),
-- no_login, no_phone, expired (it is already too late), off (a lunch reminder of 0 minutes). Refusals, written to the
-- audit log as ONE member_notice.not_sent row per call or batch with the counts by reason: quiet_hours (quiet hours
-- last until after it stops being useful), sandbox (only verified test recipients), template (the push could not be
-- written), suppressed (for example a person recorded as deceased), error.
create or replace function app.member_notice_reason_text(p_reason text, p_template text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case p_reason
    when 'quiet_hours' then 'quiet hours last until after ' ||
         case p_template when 'boli_outbid' then 'the boli closes' when 'lunch_reminder' then 'the lunch slot starts' else 'the survey closes' end
    when 'sandbox' then 'a sandbox pushes only to verified test recipients'
    when 'template' then 'the push could not be written from its template'
    when 'suppressed' then 'the recipient may not be messaged (for example recorded as deceased)'
    when 'expired' then 'it was already too late to be useful'
    when 'switched_off' then 'the community switched this notice off in Settings › Notifications'
    when 'no_login' then 'the person has no login in this community'
    when 'no_phone' then 'the person has no phone with the app'
    else 'it could not be queued' end
$$;

-- {"a": 1} + {"a": 2, "b": 1} = {"a": 3, "b": 1}.
create or replace function app._add_counts(p_a jsonb, p_b jsonb) returns jsonb
language sql immutable set search_path = app, public, extensions as $$
  select coalesce(jsonb_object_agg(y.k, y.n), '{}'::jsonb)
    from (select x.k, sum(x.n)::int as n
            from (select key as k, (value #>> '{}')::int as n from jsonb_each(coalesce(p_a, '{}'::jsonb))
                  union all
                  select key, (value #>> '{}')::int from jsonb_each(coalesce(p_b, '{}'::jsonb))) x
           group by x.k) y
$$;

-- ONE audit row for the refusals of one call or batch; nothing when there were none.
create or replace function app._member_notice_not_sent(p_center uuid, p_table text, p_record text, p_template text,
                                                       p_counts jsonb, p_error text default null) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_counts jsonb; v_text text;
begin
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_counts
    from jsonb_each(coalesce(p_counts, '{}'::jsonb))
   where key in ('quiet_hours', 'sandbox', 'template', 'suppressed', 'error') and (value #>> '{}')::int > 0;
  if v_counts = '{}'::jsonb then return; end if;
  select string_agg((value #>> '{}') || ' not queued: ' || app.member_notice_reason_text(key, p_template), '; ' order by key)
    into v_text from jsonb_each(v_counts);
  perform app.log_audit(p_center, 'member_notice.not_sent', p_table, p_record, null,
                        jsonb_build_object('template', p_template, 'counts', v_counts, 'error', left(p_error, 500)),
                        'Member notice "' || p_template || '": ' || v_text);
end $$;

-- ── One push to a member ─────────────────────────────────────────────────────────
-- Returns {"id", "send_at"} when the push is queued, else {"reason"[, "error"]} (above). Never raises: a pledge, a
-- check-in or an event completion never fails because of a notice. The send time is the one app.enqueue_message_at
-- will really use: quiet hours hold it, unless it is an event-day message and the community lets those through; when
-- that time is at or after p_expires_at nothing is queued (quiet_hours, or expired when it is simply too late). The
-- route (type, deep_link, ids) goes at the TOP level of the payload, where the worker's pushRouting, submit_survey's
-- cancel and the lunch duplicate check read it. A system notice names no creator, on the message or on its job (a
-- boli notice must not tell the message queue who pledged more).
create or replace function app._member_push(p_center uuid, p_person uuid, p_trigger text, p_topic text, p_template text,
                                            p_vars jsonb, p_route jsonb, p_send_at timestamptz, p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.centers; v_user uuid; v_phone boolean; v_id uuid; v_status text; v_why text; v_at timestamptz; v_job bigint;
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
  -- The same reading of the event-day rule as app.enqueue_message_at: absent means yes.
  if not (coalesce(p_vars->>'event_day', 'false') = 'true'
          and coalesce((c.rules #>> '{notifications,event_day_during_quiet_hours}')::boolean, true)) then
    v_quiet := app.messaging_quiet_until(p_center, v_send);
    if v_quiet is not null then v_send := v_quiet; end if;
  end if;
  if p_expires_at is not null and v_send >= p_expires_at then
    return jsonb_build_object('reason', case when v_quiet is not null then 'quiet_hours' else 'expired' end, 'send_at', v_send);
  end if;
  begin
    v_id := app.enqueue_message_at(p_center, 'push', v_user::text, p_template,
                                   coalesce(p_vars, '{}'::jsonb) || jsonb_build_object('person_id', p_person::text),
                                   'notification', p_send_at);
    update app.messages
       set topic_key = p_topic, expires_at = p_expires_at, payload = payload || coalesce(p_route, '{}'::jsonb), created_by = null
     where id = v_id
    returning status, failure_reason, scheduled_at, job_id into v_status, v_why, v_at, v_job;
    if v_job is not null then update app.jobs set created_by = null where id = v_job and created_by is not null; end if;
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

-- ── Event feedback: the pushes run in the background service ─────────────────────
-- Marking an event completed, "Send survey", attaching a survey to a completed event and "Request feedback" never do
-- per-person work in the staff member's request: they take the counts (set-based) and queue ONE surveys.launch_notify
-- job at the send time. The background service then queues each invited adult's push and two reminders in batches.
--
-- One run per survey: when the pushes go, the counts at the start, what stopped them, how many went and how many were
-- refused (by reason). Staff read it through app.event_survey_stats ("notices"); only these functions write it.
create table if not exists app.survey_notice_runs (
  survey_id    uuid primary key references app.surveys(id) on delete cascade,
  center_id    uuid not null references app.centers(id) on delete cascade,
  send_at      timestamptz not null,
  job_id       bigint,
  planned      jsonb,
  problem_code text check (problem_code in ('template', 'closed', 'backlog')),
  problem      text,
  pushed       integer not null default 0,
  refused      jsonb not null default '{}'::jsonb,
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists survey_notice_runs_center_idx on app.survey_notice_runs (center_id);
comment on table app.survey_notice_runs is
  'The pushes of one survey (0596): send_at (the surveys.launch_notify job''s run_after), planned (invited, answered, no_login, no_phone, pushes_off, not_test_recipient, will_push, switched_off), problem (what stopped everyone: template, closed, backlog), pushed and refused (by reason).';
-- Each invited adult the fan-out handled, once: a retried or doubled job never pushes anyone twice.
create table if not exists app.survey_notice_recipients (
  survey_id     uuid not null references app.surveys(id) on delete cascade,
  person_id     uuid not null references app.people(id) on delete cascade,
  center_id     uuid not null references app.centers(id) on delete cascade,
  outcome       text not null check (outcome in ('pushed', 'refused')),
  reason        text,
  first_push_at timestamptz,
  created_at    timestamptz not null default now(),
  primary key (survey_id, person_id)
);
create index if not exists survey_notice_recipients_center_idx on app.survey_notice_recipients (center_id, survey_id);
insert into app.module_tables (table_name, module_key) values ('survey_notice_runs', 'surveys'), ('survey_notice_recipients', 'surveys')
on conflict (table_name) do nothing;
drop trigger if exists audit_survey_notice_runs on app.survey_notice_runs;
create trigger audit_survey_notice_runs after insert or update or delete on app.survey_notice_runs
  for each row execute function app.audit_row('survey_id');
drop trigger if exists audit_survey_notice_recipients on app.survey_notice_recipients;
create trigger audit_survey_notice_recipients after insert or update or delete on app.survey_notice_recipients
  for each row execute function app.audit_row('survey_id', 'person_id');
alter table app.survey_notice_runs enable row level security;
alter table app.survey_notice_recipients enable row level security;
do $$
declare t text;
begin
  foreach t in array array['survey_notice_runs', 'survey_notice_recipients'] loop
    execute format('drop policy if exists %1$s_staff_read on app.%1$I', t);
    execute format($p$create policy %1$s_staff_read on app.%1$I for select to authenticated
      using (app.has_permission(center_id, 'comms.view') or app.has_permission(center_id, 'comms.send') or app.has_permission(center_id, 'events.manage'))$p$, t);
    execute format('drop policy if exists module_switch on app.%I', t);
    execute format($p$create policy module_switch on app.%I as restrictive for all to public
      using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('surveys'))::uuid[])))
      with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('surveys'))::uuid[])))$p$, t);
    execute format('revoke all on app.%I from public, anon, authenticated, connect_worker', t);
    execute format('grant select on app.%I to authenticated', t);
    execute format('grant all on app.%I to service_role', t);
  end loop;
end $$;

-- The adults a survey is for (households with an RSVP in the survey's statuses; 18 or older, or no date of birth; not
-- deceased) and what decides whether they get a push: answered already, a login with a working phone, the events
-- topic on for push (the worker's rule: no preference row = the topic's default), a verified test recipient in a
-- sandbox. Set-based: the launch counts it and the fan-out pages through it.
create or replace function app._survey_notice_audience(p_survey uuid)
returns table (person_id uuid, user_id uuid, answered boolean, has_phone boolean, push_on boolean, test_ok boolean)
language sql stable security definer set search_path = app, public, extensions as $$
  with s as (
    select sv.id, sv.center_id, sv.event_id,
           case when jsonb_typeof(sv.audience->'rsvp_statuses') = 'array'
                then array(select jsonb_array_elements_text(sv.audience->'rsvp_statuses'))
                else array['rsvpd', 'confirmed', 'attended'] end as statuses,
           coalesce(app.entitlement(sv.center_id, 'messaging.recipients') #>> '{}', 'all') = 'all' as everyone
      from app.surveys sv
     where sv.id = p_survey and sv.event_id is not null
  ), who as (
    select distinct s.id as survey_id, s.center_id, s.everyone, hm.person_id
      from s
      join app.rsvps r on r.event_id = s.event_id and r.status::text = any (s.statuses)
      join app.household_members hm on hm.household_id = r.household_id and hm.left_at is null
      join app.people p on p.id = hm.person_id
     where (p.date_of_birth is null or p.date_of_birth <= current_date - interval '18 years')
       and not coalesce(p.is_deceased, false)
  )
  select w.person_id, cu.user_id,
         exists (select 1 from app.survey_completions sc where sc.survey_id = w.survey_id and sc.person_id = w.person_id),
         cu.user_id is not null and exists (select 1 from app.push_devices d where d.user_id = cu.user_id and d.invalid_at is null),
         coalesce((select np.enabled from app.notification_preferences np
                    where np.person_id = w.person_id and np.topic_key = 'events' and np.channel = 'push'),
                  (select t.default_on from app.notification_topics t where t.key = 'events'), true),
         cu.user_id is not null and (w.everyone or app.messaging_recipient_ok(w.center_id, 'push', cu.user_id::text, 'notification'))
    from who w
    left join app.center_users cu on cu.center_id = w.center_id and cu.person_id = w.person_id
$$;

-- The counts, mutually exclusive in this order: answered, no_login, no_phone, pushes_off, not_test_recipient, will_push.
create or replace function app._survey_notice_counts(p_survey uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object(
           'invited', count(*),
           'answered', count(*) filter (where a.answered),
           'no_login', count(*) filter (where not a.answered and a.user_id is null),
           'no_phone', count(*) filter (where not a.answered and a.user_id is not null and not a.has_phone),
           'pushes_off', count(*) filter (where not a.answered and a.has_phone and not a.push_on),
           'not_test_recipient', count(*) filter (where not a.answered and a.has_phone and a.push_on and not a.test_ok),
           'will_push', count(*) filter (where not a.answered and a.has_phone and a.push_on and a.test_ok))
    from app._survey_notice_audience(p_survey) a
$$;

create or replace function app._survey_notice_vars(p_points integer, p_event text) returns jsonb
language sql immutable set search_path = app, public, extensions as $$
  select jsonb_build_object('event', coalesce(p_event, 'the event'),
                            'points', case when coalesce(p_points, 0) > 0 then ' Earn ' || p_points || ' points.' else '' end)
$$;

create or replace function app._survey_notice_route(p_survey uuid, p_event uuid, p_points integer) returns jsonb
language sql immutable set search_path = app, public, extensions as $$
  select jsonb_build_object('survey_id', p_survey::text, 'event_id', p_event::text, 'reward_points', coalesce(p_points, 0),
                            'deep_link', 'survey/' || p_survey::text)
$$;

-- What would stop every push of a survey, checked before anything is queued: its push templates cannot be written with
-- what a survey push has (a community's own template asking for, say, {{first_name}}). A plain sentence, or null.
create or replace function app._survey_notice_problem(p_survey uuid) returns text
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.surveys; v_event text; v_sandbox boolean; v_vars jsonb; k text; v_var text;
begin
  select * into s from app.surveys where id = p_survey;
  if s.id is null then return null; end if;
  select e.name into v_event from app.events e where e.id = s.event_id;
  select c.environment = 'sandbox' into v_sandbox from app.centers c where c.id = s.center_id;
  v_vars := app._survey_notice_vars(s.reward_points, v_event);
  foreach k in array array['event_survey', 'event_survey_reminder'] loop
    begin
      perform app.message_render(s.center_id, 'push', k, v_vars, coalesce(v_sandbox, false));
    exception when others then
      v_var := substring(sqlerrm from 'needs a value for "([^"]+)"');
      return case when v_var is not null
                  then 'The community''s own "' || k || '" push asks for {{' || v_var || '}}, which a survey push does not have. Change that template (or remove it to use the standard one), then send again.'
                  else 'The "' || k || '" push cannot be written: ' || sqlerrm end;
    end;
  end loop;
  return null;
end $$;

-- What staff see about a survey's pushes (app.event_survey_stats "notices"), and what a launch returns.
create or replace function app._survey_notice_summary(p_survey uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object(
           'send_at', r.send_at, 'planned', r.planned, 'pushed', r.pushed, 'refused', r.refused,
           'problem_code', r.problem_code, 'problem', r.problem, 'started_at', r.started_at, 'finished_at', r.finished_at,
           'job_status', (select j.status from app.jobs j where j.id = r.job_id))
    from app.survey_notice_runs r
   where r.survey_id = p_survey
$$;

-- Starts the pushes of one survey, once: ONE surveys.launch_notify job at the send time. When they go now the counts
-- are taken now and returned. p_retry: a run stopped by a template problem before anyone was pushed starts again.
create or replace function app._schedule_survey_notices(p_survey uuid, p_send_at timestamptz, p_retry boolean default false)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.surveys; c app.centers; r app.survey_notice_runs; v_send timestamptz := greatest(coalesce(p_send_at, now()), now());
        v_counts jsonb; v_problem text; v_job bigint;
begin
  select * into s from app.surveys where id = p_survey;
  if s.id is null then return null; end if;
  select * into r from app.survey_notice_runs where survey_id = s.id for update;
  if r.survey_id is not null and not (coalesce(p_retry, false) and r.problem_code = 'template' and r.pushed = 0) then
    return app._survey_notice_summary(s.id);
  end if;
  select * into c from app.centers where id = s.center_id;
  if v_send <= now() then
    v_counts := app._survey_notice_counts(s.id);
    if (c.rules #>> '{notifications,triggers,event_feedback}') = 'false' then
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
  values (s.id, s.center_id, v_send, v_counts, case when v_problem is not null then 'template' end, v_problem,
          case when v_problem is not null or (v_counts->>'will_push')::int = 0 then now() end)
  on conflict (survey_id) do update
     set send_at = excluded.send_at, planned = excluded.planned, problem_code = excluded.problem_code, problem = excluded.problem,
         finished_at = excluded.finished_at, started_at = null, refused = '{}'::jsonb, job_id = null;
  if v_problem is not null then
    perform app._member_notice_not_sent(s.center_id, 'surveys', s.id::text, 'event_survey',
                                        jsonb_build_object('template', (v_counts->>'will_push')::int), v_problem);
  elsif v_counts is null or (v_counts->>'will_push')::int > 0 then
    v_job := app.enqueue_job(s.center_id, 'surveys.launch_notify', jsonb_build_object('survey_id', s.id), v_send, 5);
    update app.survey_notice_runs set job_id = v_job where survey_id = s.id;
  end if;
  return app._survey_notice_summary(s.id);
end $$;

-- The 0544 launch: open the survey for two weeks for the 0544 audience, then schedule the pushes (now). Returns the
-- summary (counts) at once; nothing per person happens here.
drop function if exists app.launch_event_survey(uuid);
create function app.launch_event_survey(p_survey uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.surveys;
begin
  select * into s from app.surveys where id = p_survey for update;
  if s.id is null or s.event_id is null then return null; end if;
  if s.completion_started_at is not null or exists (select 1 from app.survey_notice_runs r where r.survey_id = s.id) then
    return app._survey_notice_summary(s.id);
  end if;
  update app.surveys set status = 'open', opens_at = now(), closes_at = now() + interval '14 days', completion_started_at = now(),
         audience = jsonb_build_object('event_id', s.event_id, 'rsvp_statuses', jsonb_build_array('rsvpd', 'confirmed', 'attended'))
   where id = s.id;
  return app._schedule_survey_notices(s.id, now());
end $$;

-- "Send survey" on the event's Survey tab. Refuses up front, in a sentence, what would stop everyone (the survey is
-- not opened then). After such a problem is fixed, the same button sends the pushes that did not go. Returns the
-- summary: planned {invited, answered, no_login, no_phone, pushes_off, not_test_recipient, will_push[, switched_off]}.
drop function if exists app.launch_event_survey_now(uuid);
create function app.launch_event_survey_now(p_survey uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.surveys; e app.events; r app.survey_notice_runs; v_problem text;
begin
  s := app._event_survey_for_change(p_survey);
  select * into e from app.events where id = s.event_id;
  select * into r from app.survey_notice_runs where survey_id = s.id;
  if r.survey_id is not null then
    -- A template problem stopped every push: once it is fixed the same button sends them (a feedback request too).
    if r.problem_code = 'template' and r.pushed = 0 and s.status = 'open' then
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

-- "Request feedback" (Events › Feedback) writes an open survey with its send time (send_at / opens_at): its pushes
-- start then, through the same run and job (straight away when that time has passed; what would stop every push is
-- then refused in a sentence, so the request is not saved). A send time that moves before the pushes start moves the
-- job. A survey launched from the event's Survey tab schedules itself (completion_started_at).
create or replace function app.surveys_schedule_feedback_pushes() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.survey_notice_runs; v_send timestamptz; v_summary jsonb;
begin
  if new.kind is distinct from 'event_feedback' or new.event_id is null or new.completion_started_at is not null
     or new.status is distinct from 'open' then
    return null;
  end if;
  v_send := greatest(coalesce(new.send_at, new.opens_at, now()), now());
  select * into r from app.survey_notice_runs where survey_id = new.id;
  if r.survey_id is null then
    v_summary := app._schedule_survey_notices(new.id, v_send);
    if v_summary->>'problem_code' = 'template' then
      raise exception '%', v_summary->>'problem' using errcode = '22023';
    end if;
  elsif r.started_at is null and r.finished_at is null and r.send_at is distinct from v_send then
    update app.survey_notice_runs set send_at = v_send where survey_id = new.id;
    update app.jobs set run_after = v_send where id = r.job_id and status = 'queued';
  end if;
  return null;
end $$;
drop trigger if exists surveys_schedule_feedback_pushes on app.surveys;
create trigger surveys_schedule_feedback_pushes after insert or update of status, opens_at, send_at on app.surveys
  for each row execute function app.surveys_schedule_feedback_pushes();

-- A survey that closes (or goes back to draft) cancels its waiting pushes, and its fan-out if that has not finished.
create or replace function app.surveys_cancel_waiting_pushes() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  -- One update for all of them, and no per-message job update (see messages_cancel_waiting_job): a push job that is
  -- left finds its message cancelled when it runs and ends at once.
  perform set_config('app.keep_cancelled_message_jobs', 'on', true);
  update app.messages
     set status = 'cancelled', failure_reason = 'Not sent: the survey closed before it went.'
   where center_id = new.center_id and status = 'queued' and template_key in ('event_survey', 'event_survey_reminder')
     and payload->>'survey_id' = new.id::text;
  perform set_config('app.keep_cancelled_message_jobs', 'off', true);
  update app.jobs j
     set status = 'cancelled', finished_at = now(), result = jsonb_build_object('survey_id', new.id, 'skipped', 'The survey closed before the pushes went.')
    from app.survey_notice_runs r
   where r.survey_id = new.id and r.finished_at is null and j.id = r.job_id and j.status = 'queued';
  update app.survey_notice_runs
     set finished_at = now(),
         problem_code = coalesce(problem_code, case when pushed = 0 then 'closed' end),
         problem = coalesce(problem, case when pushed = 0 then 'Not sent: the survey closed before the pushes went.' end)
   where survey_id = new.id and finished_at is null;
  return null;
end $$;
drop trigger if exists surveys_cancel_waiting_pushes on app.surveys;
create trigger surveys_cancel_waiting_pushes after update of status on app.surveys
  for each row when (old.status = 'open' and new.status is distinct from 'open')
  execute function app.surveys_cancel_waiting_pushes();

-- The 0547 numbers, plus "notices": the pushes (app._survey_notice_summary), so the Survey tab shows who will get one,
-- how many went, how many were refused and why.
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
    'completions', v_completions, 'answered', greatest(v_responses, v_completions), 'points_awarded', v_points,
    'notices', app._survey_notice_summary(s.id));
end $$;

-- The background service (job surveys.launch_notify): one batch of the invited adults who get a push and have not
-- been handled yet, in a fixed order. Each gets the push now (or when quiet hours end) and a reminder one and two days
-- after that first push, until the survey closes. The run is locked, so a doubled job waits and then finds nobody left.
-- Refusals are counted on the run (staff see them) and audited once per batch. Returns {done, processed, pushed, refused}.
create or replace function app.worker_survey_launch_notify(p_survey uuid, p_limit integer default 200) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.survey_notice_runs; s app.surveys; c app.centers; v_event text; v_lim int := least(greatest(coalesce(p_limit, 200), 1), 200);
        a record; v_vars jsonb; v_route jsonb; p1 jsonb; p2 jsonb; v_first timestamptz; d interval; v_problem text; v_more boolean;
        v_pushed int := 0; v_done int := 0; v_refused jsonb := '{}'::jsonb; v_audit jsonb := '{}'::jsonb; v_err text;
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
    if (c.rules #>> '{notifications,triggers,event_feedback}') = 'false' then
      r.planned := r.planned || jsonb_build_object('switched_off', (r.planned->>'will_push')::int, 'will_push', 0);
    elsif (r.planned->>'will_push')::int > 0 then
      v_problem := app._survey_notice_problem(s.id);
    end if;
    update app.survey_notice_runs
       set planned = r.planned, problem_code = case when v_problem is not null then 'template' end, problem = v_problem,
           finished_at = case when v_problem is not null or (r.planned->>'will_push')::int = 0 then now() end
     where survey_id = p_survey;
    if v_problem is not null then
      perform app._member_notice_not_sent(s.center_id, 'surveys', s.id::text, 'event_survey',
                                          jsonb_build_object('template', (r.planned->>'will_push')::int), v_problem);
    end if;
    if v_problem is not null or (r.planned->>'will_push')::int = 0 then
      return jsonb_build_object('done', true, 'processed', 0, 'pushed', 0, 'refused', 0, 'reason', coalesce(v_problem, 'Nobody gets a push.'));
    end if;
  elsif (c.rules #>> '{notifications,triggers,event_feedback}') = 'false' then
    update app.survey_notice_runs set finished_at = now() where survey_id = p_survey;
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
    p1 := app._member_push(s.center_id, a.person_id, 'event_feedback', 'events', 'event_survey', v_vars, v_route, now(), s.closes_at);
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
  v_more := exists (select 1 from app._survey_notice_audience(s.id) x
                     where not x.answered and x.has_phone and x.push_on and x.test_ok
                       and not exists (select 1 from app.survey_notice_recipients nr where nr.survey_id = s.id and nr.person_id = x.person_id));
  update app.survey_notice_runs
     set pushed = pushed + v_pushed, refused = app._add_counts(refused, v_refused), started_at = coalesce(started_at, now()),
         finished_at = case when v_more then null else now() end
   where survey_id = p_survey;
  perform app._member_notice_not_sent(s.center_id, 'surveys', s.id::text, 'event_survey', v_audit, v_err);
  return jsonb_build_object('done', not v_more, 'processed', v_done, 'pushed', v_pushed,
                            'refused', coalesce((select sum((value #>> '{}')::int) from jsonb_each(v_refused)), 0));
end $$;

-- ── Lunch ────────────────────────────────────────────────────────────────────────
-- One attendee's reminder: rules.lunch.reminder_minutes_before (Settings › Rules › Lunch; default 5, 0 = off) before
-- the slot, gone once the slot starts; event-day, so quiet hours hold it only when the community does not let
-- event-day messages through at night, and then nothing is queued if they last until the slot. Returns the
-- app._member_push answer; never raises.
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
           jsonb_build_object('event_id', e.id::text, 'slot_id', s.id::text),
           s.starts_at - make_interval(mins => v_minutes), s.starts_at);
exception when others then
  return jsonb_build_object('reason', 'error', 'error', sqlerrm);
end $$;

-- The 0104 body; the reminders at the end go through app._lunch_reminder (one per person and event, while one is
-- waiting or was sent); their refusals are audited once for the check-in.
create or replace function app.assign_lunch_for_rsvp(p_rsvp uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.rsvps; e app.events; v_group_first boolean; v_slot uuid; v_need int; a record; v_res jsonb;
        v_counts jsonb := '{}'::jsonb; v_err text;
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
    v_res := app._lunch_reminder(a.id);
    if not (v_res ? 'id') then
      v_counts := app._add_counts(v_counts, jsonb_build_object(coalesce(v_res->>'reason', 'error'), 1));
      v_err := coalesce(v_err, v_res->>'error');
    end if;
  end loop;
  perform app._member_notice_not_sent(e.center_id, 'events', e.id::text, 'lunch_reminder', v_counts, v_err);
end $$;

-- The 0104 body, tightened (owner approved 2026-10-07): every person named must be on this event, all of them on ONE
-- RSVP, and that RSVP one the caller may change (an adult of its household, or an event volunteer); otherwise it is
-- refused (22023) and nobody moves. A move cancels the moved people's waiting reminder (and its job) and queues one for
-- the new slot.
create or replace function app.move_lunch_slot(p_attendee_ids uuid[], p_slot uuid) returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.lunch_slots; v_n int; v_rsvp uuid; v_household uuid; v_current timestamptz; v_moved record; v_ids uuid[];
        v_found int; v_rsvps int; v_res jsonb; v_counts jsonb := '{}'::jsonb; v_err text;
begin
  select * into s from app.lunch_slots where id = p_slot for update;
  perform app.assert_module_enabled(s.center_id, 'events');
  if s.id is null then raise exception 'lunch slot not found'; end if;
  v_ids := array(select distinct x from unnest(coalesce(p_attendee_ids, '{}'::uuid[])) x where x is not null);
  if cardinality(v_ids) = 0 then raise exception 'Choose who to move to the new lunch time.' using errcode = '22023'; end if;
  select count(*), count(distinct a.rsvp_id), min(a.rsvp_id::text)::uuid into v_found, v_rsvps, v_rsvp
    from app.attendees a where a.id = any (v_ids) and a.event_id = s.event_id;
  if v_found <> cardinality(v_ids) then
    raise exception 'Some of these people are not on this event, so nobody was moved.' using errcode = '22023';
  end if;
  if v_rsvps <> 1 then
    raise exception 'These people are on different RSVPs, so nobody was moved. Move one family at a time.' using errcode = '22023';
  end if;
  select household_id into v_household from app.rsvps where id = v_rsvp;
  if not (app.adult_of_household(s.center_id, v_household)
          or app.has_scoped_role(s.center_id, s.event_id, 'event_lead', 'checkin_volunteer')) then
    raise exception 'Only an adult of the household or an event volunteer can change lunch times.' using errcode = '22023';
  end if;
  select min(ls.starts_at) into v_current from app.attendees a join app.lunch_slots ls on ls.id = a.lunch_slot_id
   where a.id = any (v_ids);
  if v_current is not null and s.starts_at <= v_current then raise exception 'choose a later lunch time'; end if;
  if s.starts_at < now() - make_interval(mins => 5) then raise exception 'that lunch time has passed'; end if;
  if s.seats - (select count(*) from app.attendees x where x.lunch_slot_id = s.id) < cardinality(v_ids) then
    raise exception 'that lunch time is full';
  end if;
  update app.attendees set lunch_slot_id = s.id where id = any (v_ids) and checked_in_at is not null;
  get diagnostics v_n = row_count;
  update app.lunch_slots ls set assigned = (select count(*) from app.attendees x where x.lunch_slot_id = ls.id) where ls.event_id = s.event_id;
  update app.messages m
     set status = 'cancelled', failure_reason = 'Not sent: the lunch time changed; a reminder for the new time replaces it.'
   where m.center_id = s.center_id and m.template_key = 'lunch_reminder' and m.status = 'queued'
     and m.payload->>'event_id' = s.event_id::text
     and m.person_id in (select x.person_id from app.attendees x
                          where x.id = any (v_ids) and x.lunch_slot_id = s.id and x.person_id is not null);
  for v_moved in select x.id from app.attendees x where x.id = any (v_ids) and x.lunch_slot_id = s.id and x.person_id is not null loop
    v_res := app._lunch_reminder(v_moved.id);
    if not (v_res ? 'id') then
      v_counts := app._add_counts(v_counts, jsonb_build_object(coalesce(v_res->>'reason', 'error'), 1));
      v_err := coalesce(v_err, v_res->>'error');
    end if;
  end loop;
  perform app._member_notice_not_sent(s.center_id, 'events', s.event_id::text, 'lunch_reminder', v_counts, v_err);
  return v_n;
end $$;

-- ── Bolis ────────────────────────────────────────────────────────────────────────
-- The 0104 body; the notice goes to the family that was on top just before this pledge (when it is another family
-- and its entry names a person), until the boli closes. Owner decision 2026-10-07: it is an event-day message, so it
-- goes during quiet hours whenever the community lets event-day messages through (the setting the lunch reminder
-- uses); held past the close it is not queued and the audit log says why. The new top family's own waiting notice is
-- cancelled. A tap opens the boli (deep_link /boli/<id>, the member app's boli screen; the event too, when it has one).
create or replace function app.place_boli_entry(p_boli uuid, p_household uuid, p_amount_cents bigint, p_anonymous boolean default false)
returns uuid language plpgsql security definer set search_path = app, public, extensions as $$
declare b app.bolis; v_min bigint; v_entry uuid; v_close timestamptz; v_prev app.boli_entries; v_res jsonb;
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
  -- Anti-sniping: a pledge inside the soft-close window extends the cutoff (the waiting notices follow:
  -- app.bolis_follow_close_time).
  if b.soft_close_minutes > 0 and v_close is not null and v_close - now() < make_interval(mins => b.soft_close_minutes) then
    update app.bolis set extended_until = now() + make_interval(mins => b.soft_close_minutes) where id = p_boli;
    v_close := now() + make_interval(mins => b.soft_close_minutes);
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
    v_res := app._member_push(b.center_id, v_prev.person_id, 'boli_outbid', 'giving', 'boli_outbid',
                              jsonb_build_object('boli', b.name, 'event_day', true),
                              jsonb_build_object('type', 'boli_outbid', 'deep_link', '/boli/' || b.id::text, 'boli_id', b.id::text)
                                || case when b.event_id is not null then jsonb_build_object('event_id', b.event_id::text) else '{}'::jsonb end,
                              now(), v_close);
    if not (v_res ? 'id') then
      perform app._member_notice_not_sent(b.center_id, 'bolis', b.id::text, 'boli_outbid',
                                          jsonb_build_object(coalesce(v_res->>'reason', 'error'), 1), v_res->>'error');
    end if;
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

-- Staff move a boli's close, or a soft-close extension moves it: the waiting notices last until the new close.
create or replace function app.bolis_follow_close_time() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  update app.messages
     set expires_at = coalesce(new.extended_until, new.closes_at)
   where center_id = new.center_id and status = 'queued' and template_key = 'boli_outbid' and payload->>'boli_id' = new.id::text;
  return null;
end $$;
drop trigger if exists bolis_follow_close_time on app.bolis;
create trigger bolis_follow_close_time after update of closes_at, extended_until on app.bolis
  for each row when (coalesce(old.extended_until, old.closes_at) is distinct from coalesce(new.extended_until, new.closes_at))
  execute function app.bolis_follow_close_time();

-- ── The demo pack (0312) ─────────────────────────────────────────────────────────
-- Loading the pack checks in families at a past event. The old lunch code wrote one reminder row per attendee with a
-- slot (35, which the pack then marked "never sent"); a slot that has passed gets no reminder now (and demo people
-- have no login), so the pack loads 35 fewer messages. Only from 0312's own count, so it is applied once.
update app.demo_packs p
   set contents = (select jsonb_agg(case when m->'rows' ? 'messages'
                                         then jsonb_set(m, '{rows,messages}', to_jsonb((m #>> '{rows,messages}')::int - 35))
                                         else m end order by o)
                     from jsonb_array_elements(p.contents) with ordinality x(m, o))
 where p.key = 'community'
   and exists (select 1 from jsonb_array_elements(p.contents) m where m->'rows' ? 'messages' and (m #>> '{rows,messages}')::int = 123);

-- ── The old rows: never sent, never deleted ──────────────────────────────────────
-- Messages the old code wrote (queued, no job, no purpose) for these four notices, and feedback requests made before
-- this change (Events › Feedback: a send time, never launched): too old to send now. Returns how many of each.
create or replace function app.cancel_unconnected_member_notices() returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_messages int; v_requests int;
begin
  update app.messages
     set status = 'cancelled',
         failure_reason = 'Not sent: queued before this notice was connected to the sender (fixed in 0596); too old to send now.'
   where status = 'queued' and job_id is null and purpose is null
     and template_key in ('event_survey', 'event_survey_reminder', 'lunch_reminder', 'boli_outbid');
  get diagnostics v_messages = row_count;
  insert into app.survey_notice_runs (survey_id, center_id, send_at, problem_code, problem, finished_at)
  select s.id, s.center_id, coalesce(s.send_at, s.opens_at, s.created_at), 'backlog',
         'Not sent: requested before feedback requests were connected to the sender (fixed in 0596); too old to send now.', now()
    from app.surveys s
   where s.kind = 'event_feedback' and s.event_id is not null and s.completion_started_at is null
     -- Opened or scheduled from Events › Feedback. A draft attached on the event's Survey tab (no send time) still
     -- sends when the event is marked completed, as it always would have.
     and (s.status <> 'draft' or s.send_at is not null)
     and not exists (select 1 from app.survey_notice_runs r where r.survey_id = s.id);
  get diagnostics v_requests = row_count;
  return jsonb_build_object('messages', v_messages, 'feedback_requests', v_requests);
end $$;

-- One transaction even under plain psql, so the audit entries carry the reason.
do $$
begin
  perform app.set_audit_context('0596: notices and feedback requests made before they were connected to the sender are cancelled, not sent');
  perform app.cancel_unconnected_member_notices();
end $$;

-- ── Comments and grants ──────────────────────────────────────────────────────────
comment on function app.enqueue_message_at(uuid, text, text, text, jsonb, text, timestamptz) is
  'app.enqueue_message with a send time (0596): the job runs at greatest(p_send_at, now()), or when quiet hours end if that time falls in them (event-day messages excepted). Not callable over the API.';
comment on function app._member_push(uuid, uuid, text, text, text, jsonb, jsonb, timestamptz, timestamptz) is
  'One push to a member''s login (0596). Returns {id, send_at} when queued, else {reason[, error]}: no_person, switched_off, no_login, no_phone, expired, quiet_hours, sandbox, template, suppressed, error. Never raises. Sets topic_key and expires_at, puts the route at the top level of the payload, and leaves created_by empty on the message and its job.';
comment on function app.worker_survey_launch_notify(uuid, integer) is
  'The worker role only (job surveys.launch_notify, 0596): one batch (up to 200) of a survey''s invited adults who get a push and were not handled yet: the push now (or when quiet hours end) and reminders 1 and 2 days after it, until the survey closes. Idempotent per survey and person. Returns {done, processed, pushed, refused}.';
comment on function app.launch_event_survey_now(uuid) is
  'Send survey (0596): refuses up front, in a sentence, what would stop every push; otherwise opens the survey and queues ONE surveys.launch_notify job; after a template problem is fixed it sends the pushes that did not go. Returns the summary (planned counts, pushed, refused, problem).';
comment on function app.cancel_unconnected_member_notices() is
  'Cancels, with a reason, the event survey, lunch and boli rows written before 0596 (queued, no job, no purpose) and marks feedback requests made before 0596 as never to be sent: nothing ever sent them and they are too old to send. Never deletes. Returns the counts.';

revoke execute on function app.enqueue_message(uuid, text, text, text, jsonb, text) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'app.enqueue_message_at(uuid, text, text, text, jsonb, text, timestamptz)',
    'app._member_push(uuid, uuid, text, text, text, jsonb, jsonb, timestamptz, timestamptz)',
    'app.member_notice_reason_text(text, text)', 'app._add_counts(jsonb, jsonb)',
    'app._member_notice_not_sent(uuid, text, text, text, jsonb, text)',
    'app._survey_notice_audience(uuid)', 'app._survey_notice_counts(uuid)', 'app._survey_notice_vars(integer, text)',
    'app._survey_notice_route(uuid, uuid, integer)', 'app._survey_notice_problem(uuid)', 'app._survey_notice_summary(uuid)',
    'app._schedule_survey_notices(uuid, timestamptz, boolean)', 'app.launch_event_survey(uuid)',
    'app._lunch_reminder(uuid)', 'app.cancel_unconnected_member_notices()',
    'app.messages_cancel_waiting_job()', 'app.surveys_cancel_waiting_pushes()', 'app.surveys_schedule_feedback_pushes()',
    'app.bolis_cancel_waiting_notices()', 'app.bolis_follow_close_time()'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    -- service_role as for enqueue_message (0221/0421); never a blanket grant on the schema, which would hand back the
    -- worker-only functions later migrations took away from it.
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
revoke execute on function app.launch_event_survey_now(uuid) from public, anon;
grant execute on function app.launch_event_survey_now(uuid) to authenticated, service_role;
revoke execute on function app.worker_survey_launch_notify(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function app.worker_survey_launch_notify(uuid, integer) to connect_worker;
