-- 0421 (stream e-people-legal) · messaging: #15 a non-member unsubscribe blocks newsletters only,
-- and nothing is sent to a person recorded as deceased (0420).
--
-- Owner decision 2026-09-25 (#15): "A non-member unsubscribe blocks newsletters only."
-- Until now an unsubscribe link clicked by an address with no member on file added a
-- 'manual' suppression, which stopped EVERY message to it — receipts included. Suppressions
-- now carry a scope:
--   scope 'all'          bounce, complaint, STOP, staff (unchanged: nothing is sent)
--   scope 'newsletters'  reason 'unsubscribe': notifications and campaigns are not sent;
--                        receipts, sign-in and verification codes, and tests still go.
-- Members' opt-outs are unchanged (channel_optins, per person). The existing link-made rows
-- are moved to the new scope. message_suppression_for keeps meaning "nothing may be sent"
-- (scope 'all'), so a later bounce still suppresses an address that had only unsubscribed.
--
-- enqueue_message and worker_message_to_send (send-time re-check) are the 0221/0223 bodies with
-- two additions each: the newsletter scope, and app.message_recipient_deceased.
set client_min_messages = warning;

alter table app.message_suppressions add column if not exists scope text not null default 'all';
alter table app.message_suppressions drop constraint if exists message_suppressions_scope_check;
alter table app.message_suppressions add constraint message_suppressions_scope_check check (scope in ('all','newsletters'));
alter table app.message_suppressions drop constraint if exists message_suppressions_reason_check;
alter table app.message_suppressions add constraint message_suppressions_reason_check
  check (reason in ('bounce','complaint','stop','manual','unsubscribe'));
alter table app.message_suppressions drop constraint if exists message_suppressions_unsubscribe_scope_check;
alter table app.message_suppressions add constraint message_suppressions_unsubscribe_scope_check
  check ((reason = 'unsubscribe') = (scope = 'newsletters'));
comment on column app.message_suppressions.scope is
  'all = nothing is sent (bounce, complaint, STOP, staff); newsletters = a non-member unsubscribed from a link: notifications and campaigns are not sent, receipts and codes still go (#15).';

update app.message_suppressions
   set scope = 'newsletters', reason = 'unsubscribe', detail = 'Unsubscribed from an email link (newsletters only)'
 where reason = 'manual' and detail = 'Unsubscribed from an email link' and lifted_at is null;

drop index if exists app.message_suppressions_active_idx;
create unique index if not exists message_suppressions_active_scope_idx
  on app.message_suppressions (coalesce(center_id, '00000000-0000-0000-0000-000000000000'::uuid), channel, address, scope)
  where lifted_at is null;

-- The suppression that stops EVERY message (scope 'all').
create or replace function app.message_suppression_for(p_center uuid, p_channel text, p_to text) returns app.message_suppressions
language sql stable security definer set search_path = app, public, extensions as $$
  select s.* from app.message_suppressions s
   where s.lifted_at is null and s.channel = p_channel and s.scope = 'all'
     and s.address = case when p_channel = 'push' then btrim(p_to) else app.normalize_recipient(p_channel, p_to) end
     and (s.center_id = p_center or s.center_id is null)
   order by s.created_at desc limit 1
$$;

-- The newsletters-only suppression (a non-member's unsubscribe), if any.
create or replace function app.message_newsletter_suppression_for(p_center uuid, p_channel text, p_to text) returns app.message_suppressions
language sql stable security definer set search_path = app, public, extensions as $$
  select s.* from app.message_suppressions s
   where s.lifted_at is null and s.channel = p_channel and s.scope = 'newsletters'
     and s.address = case when p_channel = 'push' then btrim(p_to) else app.normalize_recipient(p_channel, p_to) end
     and (s.center_id = p_center or s.center_id is null)
   order by s.created_at desc limit 1
$$;

-- ── enqueue_message (0221 + #15 + deceased) ─────────────────────────────────────
create or replace function app.enqueue_message(p_center uuid, p_channel text, p_to text, p_template_key text,
                                               p_vars jsonb, p_purpose text) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  c app.centers; s app.message_suppressions; v_rendered jsonb;
  v_to text; v_vars jsonb; v_masked jsonb; v_secret jsonb := '{}'::jsonb; k text;
  v_subject text; v_body text; v_sandbox boolean := false; v_status text := 'queued'; v_reason text;
  v_when timestamptz := now(); v_quiet timestamptz; v_id uuid := gen_random_uuid(); v_job bigint; v_vault uuid;
  v_person uuid; v_payload jsonb; v_optout boolean; v_dead text;
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

  -- Quiet hours: non-urgent text, push and WhatsApp wait (event-day messages may go
  -- through when the center's rule allows it).
  if v_status = 'queued' and p_center is not null and p_purpose in ('notification','campaign','receipt')
     and p_channel in ('sms','push','whatsapp')
     and not (coalesce(p_vars->>'event_day', 'false') = 'true'
              and coalesce((c.rules #>> '{notifications,event_day_during_quiet_hours}')::boolean, true)) then
    v_quiet := app.messaging_quiet_until(p_center, now());
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

-- ── Send-time re-check (0223 + #15 + deceased) ──────────────────────────────────
create or replace function app.worker_message_to_send(p_message uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare m app.messages; st app.messaging_settings; v_secret jsonb; v_rendered jsonb; v_skip text; s app.message_suppressions;
        v_provider text; v_conn app.integration_connections; v_route jsonb := '{}'::jsonb; v_tokens jsonb; w app.whatsapp_accounts; v_dead text;
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
  if v_skip is null and m.channel::text <> 'push' and m.purpose in ('notification','campaign')
     and not coalesce((m.payload->>'keyword_reply')::boolean, false) then
    s := app.message_newsletter_suppression_for(m.center_id, m.channel::text, m.to_address);
    if s.id is not null then v_skip := 'Not sent: ' || m.to_address || ' unsubscribed from newsletters after it was queued.'; end if;
  end if;
  if v_skip is null and not coalesce((m.payload->>'keyword_reply')::boolean, false) then
    v_dead := app.message_recipient_deceased(m.center_id, m.channel::text, m.to_address, m.person_id);
    if v_dead is not null then v_skip := 'Not sent: ' || v_dead || ' is recorded as deceased.'; end if;
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

-- ── Unsubscribe links (0223, #15) ──────────────────────────────────────────────
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
  -- Not a member on file: stop newsletters to the address itself; receipts still go (#15).
  if n = 0 and (app.message_newsletter_suppression_for(m.center_id, 'email', m.to_address)).id is null then
    insert into app.message_suppressions (center_id, channel, address, reason, scope, detail, message_id)
    values (m.center_id, 'email', m.to_address, 'unsubscribe', 'newsletters', 'Unsubscribed from an email link (newsletters only)', m.id);
  end if;
  return jsonb_build_object('center_name', (select name from app.centers where id = m.center_id), 'address', m.to_address, 'people', n);
end $$;

revoke execute on function app.message_newsletter_suppression_for(uuid, text, text) from public, anon, authenticated;
grant execute on all functions in schema app to service_role;
