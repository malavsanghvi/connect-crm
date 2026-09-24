-- Onboarding (stream o-messaging) · 4 of 5: what the background service and the
-- portal's server routes (auth hooks, provider webhooks, unsubscribe links) call.
-- All of these run only as the connect_worker role (app.assert_worker): the portal's
-- server routes connect with that role too (PORTAL_DATABASE_URL), because they have
-- no signed-in user and the portal never holds a service-role key.
--
--   app.worker_message_to_send(id)          the message, re-checked, with its sender, footer and route
--   app.worker_message_result(id, …)        sent / failed / suppressed, provider reference, segments
--   app.worker_email_domains_due(limit)     the re-verify sweep
--   app.worker_email_domain(id) / app.worker_email_domain_result(id, …)
--   app.ingest_messaging_webhook(…)          webhook_events row (idempotent) + messaging.webhook.<email|twilio> job
--   app.worker_webhook_event(id) / app.worker_webhook_done(id, error)
--   app.worker_record_email_event(…)         delivered / opened / bounced / complained → message + suppression
--   app.worker_record_sms_status(…)          Twilio status callbacks
--   app.worker_record_inbound_sms(…)         STOP / START / HELP → suppression, opt-outs, the reply
--   app.worker_push_result(id, dead tokens)  Expo said a token is dead → push_devices.invalid_at
--   app.worker_sign_in_context(user, email, phone)   the center (member of exactly one) for branded sign-in
--   app.worker_record_hook_message(…)        a sign-in code sent by the hook (the code itself is never stored)
--   app.worker_unsubscribe(message)          an unsubscribe link: opt-out recorded
set client_min_messages = warning;

-- The sender for a purpose: the center's own verified sender, else none (the
-- service then uses Community Connect's default address with the center's name).
create or replace function app._messaging_sender(p_center uuid, p_purpose text) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select to_jsonb(s) - 'center_id' - 'updated_by' - 'updated_at'
    from app.email_senders s
   where s.center_id = p_center and s.verified
     and s.purpose in (case p_purpose when 'receipt' then 'receipts' when 'campaign' then 'newsletters'
                                      when 'auth_code' then 'auth' when 'verification_code' then 'auth' else 'office' end, 'office')
   order by (s.purpose = 'office')
   limit 1
$$;

create or replace function app._messaging_brand(p_center uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select case when c.id is null then null else jsonb_build_object(
           'id', c.id, 'name', c.name, 'short_name', coalesce(nullif(btrim(c.short_name), ''), c.name), 'slug', c.slug,
           'environment', c.environment, 'time_zone', c.time_zone,
           'logo_path', coalesce(c.branding->>'email_header_path', c.branding->>'logo_path', c.branding->>'mark_path'),
           'primary_color', c.branding #>> '{colors,primary}',
           'public_email', p.public_email, 'public_phone', p.public_phone) end
    from app.centers c left join app.org_profiles p on p.center_id = c.id
   where c.id = p_center
$$;

-- ── Sending ──────────────────────────────────────────────────────────────────
create or replace function app.worker_message_to_send(p_message uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare m app.messages; st app.messaging_settings; v_secret jsonb; v_rendered jsonb; v_skip text; s app.message_suppressions;
        v_provider text; v_conn app.integration_connections; v_route jsonb := '{}'::jsonb; v_tokens jsonb; w app.whatsapp_accounts;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  select * into m from app.messages where id = p_message;
  if not found then raise exception 'Message % was not found.', p_message; end if;
  if m.status <> 'queued' then v_skip := 'The message is already ' || m.status || '.'; end if;

  -- Re-checked at send time: a suppression or a sandbox allow-list change since it was queued.
  if v_skip is null and m.channel::text <> 'push' and not coalesce((m.payload->>'keyword_reply')::boolean, false) then
    s := app.message_suppression_for(m.center_id, m.channel::text, m.to_address);
    if s.id is not null then v_skip := 'Not sent: ' || m.to_address || ' was suppressed (' || s.reason || ') after it was queued.'; end if;
  end if;
  if v_skip is null and m.center_id is not null and not coalesce((m.payload->>'keyword_reply')::boolean, false)
     and m.purpose not in ('test','verification_code')
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

create or replace function app.worker_message_result(p_message uuid, p_status text, p_provider text, p_provider_ref text,
                                                     p_error text, p_segments int default null) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare m app.messages;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  if p_status not in ('sent','failed','suppressed','cancelled') then raise exception 'Unknown result "%".', p_status; end if;
  select * into m from app.messages where id = p_message for update;
  if not found then raise exception 'Message % was not found.', p_message; end if;
  perform app.set_audit_context(case p_status when 'sent' then 'Sent by ' || coalesce(p_provider, 'the provider')
                                              else 'Not sent: ' || left(coalesce(p_error, p_status), 400) end);
  update app.messages
     set status = p_status, sent_at = case when p_status = 'sent' then now() else sent_at end,
         provider = coalesce(p_provider, provider), provider_ref = coalesce(p_provider_ref, provider_ref),
         failure_reason = case when p_status = 'sent' then null else left(p_error, 2000) end,
         segments = coalesce(p_segments, segments)
   where id = p_message;
  -- The code is gone from the vault once the message has been sent or given up on.
  if m.payload ? 'secret_ref' then
    perform vault.update_secret((m.payload->>'secret_ref')::uuid, '{}');
  end if;
  if m.purpose = 'test' and m.center_id is not null then
    update app.messaging_settings set last_test_status = p_status where center_id = m.center_id and last_test_channel = m.channel::text;
    if p_status = 'sent' and m.channel = 'push' then
      perform app._messaging_setup_step(m.center_id, 'svc.push', 'done', 'A test push reached ' || coalesce((select email from auth.users where id::text = m.to_address), 'a phone') || '.');
    end if;
  end if;
end $$;

create or replace function app.worker_push_result(p_message uuid, p_dead_tokens text[], p_reason text) returns int
language plpgsql security definer set search_path = app, public, extensions as $$
declare n int;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context('Expo reported the phone is no longer registered');
  update app.push_devices set invalid_at = now(), invalid_reason = left(coalesce(p_reason, 'DeviceNotRegistered'), 200)
   where token = any (coalesce(p_dead_tokens, '{}')) and invalid_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- ── Domains ──────────────────────────────────────────────────────────────────
create or replace function app.worker_email_domains_due(p_limit int default 20) returns setof uuid
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  return query
  select d.id from app.email_domains d
   where (d.status in ('pending','failed') and (d.last_checked_at is null or d.last_checked_at < now() - interval '10 minutes')
          and d.created_at > now() - interval '30 days')
      or (d.status = 'verified' and (d.last_checked_at is null or d.last_checked_at < now() - interval '1 day'))
   order by d.last_checked_at nulls first
   limit least(greatest(coalesce(p_limit, 20), 1), 200);
end $$;

create or replace function app.worker_email_domain(p_domain uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare d app.email_domains;
begin
  perform app.assert_worker();
  select * into d from app.email_domains where id = p_domain;
  if not found then return null; end if;
  return jsonb_build_object('id', d.id, 'center_id', d.center_id, 'domain', d.domain, 'provider', d.provider,
    'provider_domain_id', d.provider_domain_id, 'status', d.status,
    'connection_id', (select id from app.integration_connections where center_id = d.center_id and provider = d.provider));
end $$;

create or replace function app.worker_email_domain_result(p_domain uuid, p_provider_domain_id text, p_records jsonb,
                                                          p_status text, p_error text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare d app.email_domains; v_senders int;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  if p_status not in ('pending','verified','failed') then raise exception 'Unknown domain status "%".', p_status; end if;
  select * into d from app.email_domains where id = p_domain for update;
  if not found then return; end if;
  if d.status is distinct from p_status or d.provider_domain_id is distinct from coalesce(p_provider_domain_id, d.provider_domain_id) then
    perform app.set_audit_context('Email provider checked ' || d.domain || ': ' || p_status);
  end if;
  update app.email_domains
     set provider_domain_id = coalesce(p_provider_domain_id, provider_domain_id),
         dns_records = coalesce(p_records, dns_records), status = p_status, last_checked_at = now(),
         verified_at = case when p_status = 'verified' then coalesce(verified_at, now()) else verified_at end,
         last_error = case when p_status = 'verified' then null else left(p_error, 1000) end
   where id = p_domain;
  update app.email_senders s set verified = (p_status = 'verified')
   where s.center_id = d.center_id and split_part(s.from_address, '@', 2) = d.domain and s.verified is distinct from (p_status = 'verified');
  select count(*) into v_senders from app.email_senders where center_id = d.center_id and verified and purpose in ('auth','office');
  if p_status = 'verified' then
    perform app._messaging_setup_step(d.center_id, 'svc.email', case when v_senders > 0 then 'done' else 'in_progress' end,
      case when v_senders > 0 then d.domain || ' verified; sign-in codes go from your own address.'
           else d.domain || ' verified. Set up the office or sign-in sender next.' end);
  elsif p_status = 'pending' then
    perform app._messaging_setup_step(d.center_id, 'svc.email', 'waiting_on_provider', 'Waiting for the DNS records of ' || d.domain || ' to verify.');
  end if;
end $$;

-- ── Webhooks ─────────────────────────────────────────────────────────────────
-- Called by the portal's webhook routes after they verified the provider's
-- signature. Idempotent on (provider, event_id).
create or replace function app.ingest_messaging_webhook(p_provider text, p_event_id text, p_type text, p_center uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare v_id uuid; v_job bigint;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  if p_provider not in ('resend','postmark','twilio') then raise exception 'Unknown messaging webhook provider "%".', p_provider; end if;
  if nullif(btrim(coalesce(p_event_id, '')), '') is null then raise exception 'A webhook event needs its id.'; end if;
  insert into app.webhook_events (provider, event_id, event_type, center_id, payload)
  values (p_provider, p_event_id, coalesce(nullif(btrim(p_type), ''), 'unknown'), p_center, coalesce(p_payload, '{}'::jsonb))
  on conflict (provider, event_id) do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('duplicate', true, 'id', (select id from app.webhook_events where provider = p_provider and event_id = p_event_id));
  end if;
  v_job := app.enqueue_job(p_center, case when p_provider = 'twilio' then 'messaging.webhook.twilio' else 'messaging.webhook.email' end,
                           jsonb_build_object('event_id', v_id), now(), 5);
  return jsonb_build_object('duplicate', false, 'id', v_id, 'job_id', v_job);
end $$;

create or replace function app.worker_webhook_event(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  return (select jsonb_build_object('id', e.id, 'provider', e.provider, 'event_id', e.event_id, 'type', e.event_type,
                                    'center_id', e.center_id, 'payload', e.payload, 'processed_at', e.processed_at)
            from app.webhook_events e where e.id = p_id);
end $$;

create or replace function app.worker_webhook_done(p_id uuid, p_error text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  update app.webhook_events set processed_at = now(), error = left(p_error, 2000) where id = p_id;
end $$;

-- p_event: delivered | opened | bounced | complained | delayed
create or replace function app.worker_record_email_event(p_provider text, p_provider_ref text, p_event text, p_address text, p_detail text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare m app.messages; v_addr text := app.normalize_recipient('email', p_address); v_supp uuid; v_center uuid;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  if p_event not in ('delivered','opened','bounced','complained','delayed') then raise exception 'Unknown email event "%".', p_event; end if;
  select * into m from app.messages where provider = p_provider and provider_ref = p_provider_ref limit 1;
  v_center := m.center_id;
  v_addr := coalesce(v_addr, m.to_address);
  perform app.set_audit_context(case p_event when 'bounced' then 'The email provider reported a bounce'
                                             when 'complained' then 'The recipient marked the email as spam'
                                             else 'The email provider reported: ' || p_event end);
  if m.id is not null then
    update app.messages
       set status = case when p_event = 'delivered' and status in ('sent','queued') then 'delivered'
                         when p_event = 'bounced' then 'bounced' when p_event = 'complained' then 'complained' else status end,
           delivered_at = case when p_event = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
           opened_at = case when p_event = 'opened' then coalesce(opened_at, now()) else opened_at end,
           failure_reason = case when p_event in ('bounced','complained') then left(coalesce(p_detail, p_event), 2000) else failure_reason end
     where id = m.id;
  end if;
  if p_event in ('bounced','complained') and v_addr is not null
     and (app.message_suppression_for(v_center, 'email', v_addr)).id is null then
    insert into app.message_suppressions (center_id, channel, address, reason, detail, message_id)
    values (v_center, 'email', v_addr, case p_event when 'bounced' then 'bounce' else 'complaint' end, left(p_detail, 1000), m.id)
    returning id into v_supp;
  end if;
  return jsonb_build_object('message_id', m.id, 'suppression_id', v_supp);
end $$;

-- Twilio status callback: queued, sending, sent, delivered, undelivered, failed (+ error code).
create or replace function app.worker_record_sms_status(p_provider_ref text, p_status text, p_error_code text, p_error text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare m app.messages; v_supp uuid;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  select * into m from app.messages where provider = 'twilio' and provider_ref = p_provider_ref limit 1;
  if m.id is null then return jsonb_build_object('message_id', null); end if;
  if p_status in ('delivered','undelivered','failed') then
    perform app.set_audit_context('Twilio reported: ' || p_status || coalesce(' (error ' || p_error_code || ')', ''));
    update app.messages
       set status = case when p_status = 'delivered' then 'delivered' else 'failed' end,
           delivered_at = case when p_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
           failure_reason = case when p_status = 'delivered' then failure_reason
                                 else left('Twilio: ' || p_status || coalesce(' · error ' || p_error_code, '') || coalesce(' · ' || p_error, ''), 2000) end
     where id = m.id;
    -- 21610: the recipient replied STOP to this number.
    if p_error_code = '21610' and (app.message_suppression_for(m.center_id, m.channel::text, m.to_address)).id is null then
      insert into app.message_suppressions (center_id, channel, address, reason, detail, message_id)
      values (m.center_id, m.channel::text, m.to_address, 'stop', 'Twilio: the recipient has opted out (21610)', m.id)
      returning id into v_supp;
    end if;
  end if;
  return jsonb_build_object('message_id', m.id, 'suppression_id', v_supp);
end $$;

-- An inbound text. STOP / START / HELP keywords (CTIA): recorded, and the reply queued.
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

-- ── Unsubscribe links ────────────────────────────────────────────────────────
create or replace function app.worker_unsubscribe(p_message uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare m app.messages; p record; n int := 0;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  select * into m from app.messages where id = p_message;
  if not found or m.channel <> 'email' or m.center_id is null then return null; end if;
  perform app.set_audit_context('Unsubscribed from an email link');
  for p in select id from app.people where center_id = m.center_id
             and (id = m.person_id or lower(email::text) = m.to_address) loop
    insert into app.channel_optins (center_id, person_id, channel, address, opted_in, source)
    values (m.center_id, p.id, 'email', m.to_address, false, 'unsubscribe_link');
    n := n + 1;
  end loop;
  -- Not a member on file: stop newsletters to the address itself (receipts still go).
  if n = 0 and (app.message_suppression_for(m.center_id, 'email', m.to_address)).id is null then
    insert into app.message_suppressions (center_id, channel, address, reason, detail, message_id)
    values (m.center_id, 'email', m.to_address, 'manual', 'Unsubscribed from an email link', m.id);
  end if;
  return jsonb_build_object('center_name', (select name from app.centers where id = m.center_id), 'address', m.to_address, 'people', n);
end $$;

-- ── Branded sign-in (Supabase Auth send-email / send-SMS hooks) ──────────────
-- The center is the one the login belongs to (center_users) or, for a first
-- sign-in, the one whose member records carry this email / phone — when that is
-- exactly one community. Otherwise Community Connect's own branding.
create or replace function app.worker_sign_in_context(p_user uuid, p_email text, p_phone text) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_centers uuid[]; v_center uuid; st app.messaging_settings; v_email text := app.normalize_recipient('email', p_email);
        v_phone text := app.normalize_recipient('sms', p_phone); v_conn app.integration_connections; v_tw app.integration_connections;
begin
  perform app.assert_worker();
  select coalesce(array_agg(distinct x), '{}') into v_centers from (
    select cu.center_id as x from app.center_users cu where cu.user_id = p_user
    union select g.center_id from app.role_grants g where g.user_id = p_user and g.center_id is not null
      and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now())
    union select pe.center_id from app.people pe where pe.merged_into_id is null
      and ((v_email is not null and lower(pe.email::text) = v_email) or (v_phone is not null and pe.phone_e164 = v_phone))
  ) q;
  if cardinality(v_centers) = 1 then v_center := v_centers[1]; end if;
  select * into st from app.messaging_settings where center_id = v_center;
  select * into v_conn from app.integration_connections where center_id = v_center and provider = coalesce(st.email_provider, 'resend');
  select * into v_tw from app.integration_connections where center_id = v_center and provider = 'twilio';
  return jsonb_build_object(
    'center_count', cardinality(v_centers),
    'brand', app._messaging_brand(v_center),
    'email', jsonb_build_object('provider', coalesce(st.email_provider, 'resend'), 'connection_id', v_conn.id,
                                'sender', app._messaging_sender(v_center, 'auth_code'),
                                'footer', jsonb_build_object('postal_address', st.footer_postal_address, 'note', st.footer_note),
                                'suppressed', v_email is not null and (app.message_suppression_for(v_center, 'email', v_email)).id is not null),
    'sms', jsonb_build_object('connected', v_tw.status = 'connected', 'from_number', v_tw.settings->>'from_number',
                              'messaging_service_sid', v_tw.settings->>'messaging_service_sid',
                              'suppressed', v_phone is not null and (app.message_suppression_for(v_center, 'sms', v_phone)).id is not null));
end $$;

create or replace function app.worker_record_hook_message(p_center uuid, p_channel text, p_to text, p_subject text, p_status text,
                                                          p_provider text, p_provider_ref text, p_error text, p_sandbox boolean)
returns uuid language plpgsql security definer set search_path = app, public, extensions as $$
declare v_id uuid;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  if p_channel not in ('email','sms') or p_status not in ('sent','failed','suppressed') then raise exception 'Unknown sign-in message result.'; end if;
  perform app.set_audit_context('Sign-in code ' || case p_status when 'sent' then 'sent' else 'not sent' end || ' by the Auth hook');
  insert into app.messages (center_id, to_address, channel, template_key, subject, body, status, sent_at, failure_reason,
                            provider, provider_ref, purpose, sandbox, segments)
  values (p_center, case when p_channel = 'email' then app.normalize_recipient('email', p_to) else app.normalize_recipient('sms', p_to) end,
          p_channel::app.channel, 'sign_in_code', left(p_subject, 300), 'Sign-in code (the code itself is never stored)', p_status,
          case when p_status = 'sent' then now() end, left(p_error, 2000), p_provider, p_provider_ref, 'auth_code', coalesce(p_sandbox, false),
          case when p_channel = 'sms' then 1 end)
  returning id into v_id;
  return v_id;
end $$;

-- ── Grants: connect_worker only ──────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'app._messaging_sender(uuid, text)', 'app._messaging_brand(uuid)',
    'app.worker_message_to_send(uuid)', 'app.worker_message_result(uuid, text, text, text, text, integer)',
    'app.worker_push_result(uuid, text[], text)', 'app.worker_email_domains_due(integer)', 'app.worker_email_domain(uuid)',
    'app.worker_email_domain_result(uuid, text, jsonb, text, text)', 'app.ingest_messaging_webhook(text, text, text, uuid, jsonb)',
    'app.worker_webhook_event(uuid)', 'app.worker_webhook_done(uuid, text)', 'app.worker_record_email_event(text, text, text, text, text)',
    'app.worker_record_sms_status(text, text, text, text)', 'app.worker_record_inbound_sms(text, text, text, text)',
    'app.worker_unsubscribe(uuid)', 'app.worker_sign_in_context(uuid, text, text)',
    'app.worker_record_hook_message(uuid, text, text, text, text, text, text, text, boolean)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    if f not like 'app._messaging%' then
      execute format('grant execute on function %s to connect_worker', f);
    end if;
  end loop;
end $$;
grant execute on all functions in schema app to service_role;
