-- Onboarding (stream o-messaging) · 2 of 5: the messaging API every stream uses.
--
--   app.enqueue_message(center, channel, to, template_key, vars, purpose) → uuid
--       Renders a template, writes an app.messages row (status queued) and a
--       messaging.send job (messaging.test_send for purpose 'test'). Honors, in order:
--         • the recipient entitlement: a sandbox reaches only verified test recipients
--           (app.assert_entitlement(center,'messaging.recipients') → CCENT);
--         • suppressions (bounce, complaint, STOP, manual) → the row is 'suppressed', no job;
--         • opt-outs (channel_optins) for notification / campaign → 'suppressed';
--         • quiet hours (centers.rules.notifications) for non-urgent purposes on text,
--           push and WhatsApp → the job waits until quiet hours end.
--       p_center NULL = Community Connect's own message (the sandbox code, request
--       decisions): its own sender, no entitlement. A sandbox's message carries the
--       "Sandbox · test data" prefix (subject / text) and the flag the sender uses for
--       the banner. Values named code / token / otp are kept in the vault until the
--       message is sent — the stored body shows •••••• instead.
--       Not callable over the API: other RPCs call it after checking their caller.
--   app.send_test_message(center, channel, to)   Settings' "Send a test" (to yourself by default)
--   app.send_recipient_verification(recipient) / app.confirm_recipient_verification(recipient, code)
--   app.add_message_suppression / app.lift_message_suppression
--   app.register_push_device(center, token, platform)  the member app registers its Expo token
set client_min_messages = warning;

-- ── Rendering ────────────────────────────────────────────────────────────────
create or replace function app.render_message_text(p_text text, p_vars jsonb, p_template text default null) returns text
language plpgsql immutable set search_path = app, public, extensions as $$
declare m text[]; v text := p_text;
begin
  if p_text is null then return null; end if;
  for m in select regexp_matches(p_text, '\{\{\s*([A-Za-z0-9_]+)\s*\}\}', 'g') loop
    if not (coalesce(p_vars, '{}'::jsonb) ? m[1]) then
      raise exception 'The message template "%" needs a value for "%".', coalesce(p_template, '?'), m[1] using errcode = '22023';
    end if;
    v := regexp_replace(v, '\{\{\s*' || m[1] || '\s*\}\}',
                        replace(coalesce(case jsonb_typeof(p_vars->m[1]) when 'string' then p_vars->>m[1] when 'null' then '' else (p_vars->m[1])::text end, ''), '\', '\\'),
                        'g');
  end loop;
  return v;
end $$;

-- GSM-7 text: 160 characters in one segment, 153 per segment when split; anything
-- else (Gujarati, Hindi, emoji, "·") is Unicode: 70, then 67. An estimate for the
-- row; the sender stores the exact count it computed (src/lib/messaging/sms.ts).
create or replace function app.sms_segments(p_text text) returns int
language plpgsql immutable set search_path = app, public, extensions as $$
declare n int; v_ext int;
begin
  if p_text is null or p_text = '' then return 0; end if;
  if p_text ~ ('^[A-Za-z0-9 @£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&''()*+,./:;<=>?¡ÄÖÑÜ§¿äöñüà' || E'\n\r' || '\^{}\\\[~\]|€-]*$') then
    v_ext := char_length(regexp_replace(p_text, '[^\^{}\\\[~\]|€]', '', 'g'));
    n := char_length(p_text) + v_ext;
    return case when n <= 160 then 1 else ceil(n / 153.0)::int end;
  end if;
  n := char_length(p_text);
  return case when n <= 70 then 1 else ceil(n / 67.0)::int end;
end $$;

-- ── Quiet hours ──────────────────────────────────────────────────────────────
-- When p_at falls in the center's quiet hours (rules.notifications.quiet_start_hour
-- / quiet_end_hour, local time; default 21–7), the moment they end; else NULL.
create or replace function app.messaging_quiet_until(p_center uuid, p_at timestamptz default now()) returns timestamptz
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.centers; s int; e int; h int; v_local timestamp; v_end timestamp; v_quiet boolean;
begin
  select * into c from app.centers where id = p_center;
  if not found then return null; end if;
  s := coalesce(case when (c.rules #>> '{notifications,quiet_start_hour}') ~ '^\d+$' then (c.rules #>> '{notifications,quiet_start_hour}')::int end, 21);
  e := coalesce(case when (c.rules #>> '{notifications,quiet_end_hour}') ~ '^\d+$' then (c.rules #>> '{notifications,quiet_end_hour}')::int end, 7);
  if s = e then return null; end if;
  v_local := p_at at time zone c.time_zone;
  h := extract(hour from v_local)::int;
  v_quiet := case when s > e then (h >= s or h < e) else (h >= s and h < e) end;
  if not v_quiet then return null; end if;
  v_end := date_trunc('day', v_local) + make_interval(hours => e);
  if v_end <= v_local then v_end := v_end + interval '1 day'; end if;
  return v_end at time zone c.time_zone;
end $$;

-- ── Who may this center message? ─────────────────────────────────────────────
-- A push "address" is the member's login (auth user id). In a sandbox a push may
-- reach a login whose email is a verified email or push test recipient.
create or replace function app.messaging_recipient_ok(p_center uuid, p_channel text, p_to text, p_purpose text) returns boolean
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_email text; v_uid uuid;
begin
  if p_center is null then return true; end if;
  if p_channel <> 'push' then
    if app.recipient_allowed(p_center, p_channel, p_to) then return true; end if;
    -- The code that verifies a test recipient goes to that (not yet verified) recipient.
    if p_purpose = 'verification_code' and exists (select 1 from app.sandbox_test_recipients r
         where r.center_id = p_center and r.channel = p_channel and r.address = app.normalize_recipient(p_channel, p_to)) then
      return true;
    end if;
    -- A test to your own sign-in address or verified phone.
    if p_purpose = 'test' and auth.uid() is not null and exists (select 1 from auth.users u where u.id = auth.uid()
         and ((p_channel = 'email' and lower(u.email) = app.normalize_recipient('email', p_to))
              or (p_channel in ('sms','whatsapp') and u.phone_confirmed_at is not null
                  and app.normalize_recipient('sms', u.phone) = app.normalize_recipient('sms', p_to)))) then
      return true;
    end if;
    return false;
  end if;
  if coalesce(app.entitlement(p_center, 'messaging.recipients') #>> '{}', 'all') = 'all' then return true; end if;
  v_uid := case when p_to ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_to::uuid end;
  select lower(email) into v_email from auth.users where id = v_uid;
  if v_email is null then return false; end if;
  if p_purpose = 'test' and v_uid = auth.uid() then return true; end if;
  return exists (select 1 from app.sandbox_test_recipients r
                  where r.center_id = p_center and r.channel in ('push','email') and r.address = v_email
                    and (r.verified_at is not null or (p_purpose = 'verification_code' and r.channel = 'push')));
end $$;

-- The active suppression for an address (this center's, or Community Connect's own), if any.
create or replace function app.message_suppression_for(p_center uuid, p_channel text, p_to text) returns app.message_suppressions
language sql stable security definer set search_path = app, public, extensions as $$
  select s.* from app.message_suppressions s
   where s.lifted_at is null and s.channel = p_channel
     and s.address = case when p_channel = 'push' then btrim(p_to) else app.normalize_recipient(p_channel, p_to) end
     and (s.center_id = p_center or s.center_id is null)
   order by s.created_at desc limit 1
$$;

-- A template rendered for one center, channel and language (with the sandbox
-- prefix): {subject, body}. Used when queuing (values masked) and when sending.
create or replace function app.message_render(p_center uuid, p_channel text, p_key text, p_vars jsonb, p_sandbox boolean)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.centers; t app.message_templates; v_lang text; v_vars jsonb; v_subject text; v_body text;
  v_label constant jsonb := '{"email":"email","sms":"text","push":"push","whatsapp":"WhatsApp"}';
begin
  if p_center is not null then select * into c from app.centers where id = p_center; end if;
  v_lang := coalesce(nullif(btrim(p_vars->>'language'), ''), 'en');
  select * into t from app.message_templates m
   where m.key = p_key and m.channel = p_channel::app.channel
     and (m.center_id = p_center or m.center_id is null) and m.language in (v_lang, 'en')
   order by (m.center_id is not null) desc, (m.language = v_lang) desc, m.version desc
   limit 1;
  if not found then
    raise exception 'There is no % template called "%".', coalesce(v_label->>p_channel, p_channel), p_key using errcode = '22023';
  end if;
  v_vars := jsonb_build_object('center_name', coalesce(c.name, 'Community Connect'),
                               'center_short_name', coalesce(nullif(btrim(c.short_name), ''), c.name, 'Community Connect'))
            || coalesce(p_vars, '{}'::jsonb);
  v_subject := app.render_message_text(t.subject, v_vars, p_key);
  v_body := app.render_message_text(t.body, v_vars, p_key);
  if p_sandbox then
    if p_channel = 'email' or (p_channel = 'push' and v_subject is not null) then
      v_subject := '[Sandbox · test data] ' || coalesce(v_subject, '');
    end if;
    if p_channel <> 'email' then v_body := 'Sandbox · test data: ' || v_body; end if;
  end if;
  return jsonb_build_object('subject', v_subject, 'body', v_body);
end $$;

-- ── enqueue_message ──────────────────────────────────────────────────────────
create or replace function app.enqueue_message(p_center uuid, p_channel text, p_to text, p_template_key text,
                                               p_vars jsonb, p_purpose text) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  c app.centers; s app.message_suppressions; v_rendered jsonb;
  v_to text; v_vars jsonb; v_masked jsonb; v_secret jsonb := '{}'::jsonb; k text;
  v_subject text; v_body text; v_sandbox boolean := false; v_status text := 'queued'; v_reason text;
  v_when timestamptz := now(); v_quiet timestamptz; v_id uuid := gen_random_uuid(); v_job bigint; v_vault uuid;
  v_person uuid; v_payload jsonb; v_optout boolean;
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

-- ── Test sends ───────────────────────────────────────────────────────────────
-- To yourself by default (your sign-in email, your verified mobile, your phones).
create or replace function app.send_test_message(p_center uuid, p_channel text, p_to text default null) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare u auth.users; v_to text; v_id uuid;
begin
  if not (app.messaging_can_manage(p_center) or app.has_permission(p_center, 'comms.send')) then
    raise exception 'Sending a test needs settings.manage, integrations.manage or comms.send.' using errcode = 'insufficient_privilege';
  end if;
  if p_channel = 'whatsapp' then perform app.assert_module_enabled(p_center, 'comms'); end if;
  select * into u from auth.users where id = auth.uid();
  v_to := nullif(btrim(coalesce(p_to, '')), '');
  if v_to is null then
    v_to := case p_channel
      when 'email' then u.email
      when 'push' then u.id::text
      else case when u.phone_confirmed_at is not null then u.phone end end;
    if v_to is null then
      raise exception 'Your sign-in has no verified mobile number. Add one in Settings › Security, or type a number to send to.' using errcode = '22023';
    end if;
  end if;
  perform app.set_audit_context('Test ' || p_channel || ' message from Settings');
  v_id := app.enqueue_message(p_center, p_channel, v_to, 'test_message', '{}'::jsonb, 'test');
  insert into app.messaging_settings (center_id, last_test_at, last_test_channel, last_test_status, updated_by)
  values (p_center, now(), p_channel, (select status from app.messages where id = v_id), auth.uid())
  on conflict (center_id) do update set last_test_at = excluded.last_test_at, last_test_channel = excluded.last_test_channel,
    last_test_status = excluded.last_test_status, updated_by = excluded.updated_by, updated_at = now();
  return v_id;
end $$;

-- ── Sandbox test recipients: verified by a code ──────────────────────────────
-- The test-recipient guard (0161) lets only the sender or a platform admin set
-- verified_at. A code confirmed here counts as the sender's confirmation.
create or replace function app.sandbox_test_recipients_guard() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  new.address := app.normalize_recipient(new.channel, new.address);
  if new.address is null then raise exception 'Enter the % address of the test recipient.', new.channel; end if;
  if new.channel in ('email','push') and new.address !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception '"%" is not an email address.', new.address;
  end if;
  if new.channel in ('sms','whatsapp') and new.address !~ '^\+\d{8,15}$' then
    raise exception '"%" is not a mobile number. Use the international form, for example +1 713 555 0100.', new.address;
  end if;
  if new.channel = 'push' then new.address := lower(new.address); end if;
  -- Staff add addresses; only the sender (no signed-in user), a confirmed code, or a platform admin marks them verified.
  if auth.uid() is not null and not app.is_platform_admin()
     and coalesce(current_setting('app.messaging_recipient_verified', true), '') <> 'on' then
    new.verified_at := case when tg_op = 'UPDATE' and new.address = old.address and new.channel = old.channel
                            then old.verified_at end;
  end if;
  if tg_op = 'INSERT' then
    new.added_by := coalesce(new.added_by, auth.uid());
    perform pg_advisory_xact_lock(hashtextextended('app.sandbox_test_recipients:' || new.center_id::text, 0));
    if (select count(*) from app.sandbox_test_recipients where center_id = new.center_id) >= 10 then
      raise exception using errcode = 'CCENT',
        message = 'A community can have up to 10 test recipients. Remove one before adding another.';
    end if;
  end if;
  return new;
end $$;

create or replace function app.send_recipient_verification(p_recipient uuid) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.sandbox_test_recipients; v_code text; v_to text; v_msg uuid; v_id uuid;
begin
  select * into r from app.sandbox_test_recipients where id = p_recipient;
  if not found or not app.messaging_can_manage(r.center_id) and not app.has_permission(r.center_id, 'settings.manage') then
    raise exception 'That test recipient was not found, or you cannot manage it (it needs settings.manage).' using errcode = 'insufficient_privilege';
  end if;
  if r.verified_at is not null then raise exception '% is already verified.', r.address using errcode = '22023'; end if;
  if (select count(*) from app.recipient_verifications where recipient_id = p_recipient and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Five codes were sent to % in the last hour. Wait a little before sending another.', r.address using errcode = '22023';
  end if;
  v_code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  v_to := r.address;
  if r.channel = 'push' then
    select id::text into v_to from auth.users where lower(email) = r.address;
    if v_to is null then
      raise exception 'Nobody signs in with %, so no phone is registered for it. Push test recipients are the email a tester signs in with.', r.address
        using errcode = '22023';
    end if;
  end if;
  perform app.set_audit_context('Verification code for test recipient ' || r.address);
  v_msg := app.enqueue_message(r.center_id, r.channel, v_to, 'recipient_verification',
                               jsonb_build_object('code', v_code, 'minutes', 15), 'verification_code');
  insert into app.recipient_verifications (center_id, recipient_id, code_hash, expires_at, message_id, sent_by)
  values (r.center_id, p_recipient, encode(extensions.digest(v_code, 'sha256'), 'hex'), now() + interval '15 minutes', v_msg, auth.uid())
  returning id into v_id;
  return v_msg;
end $$;

create or replace function app.confirm_recipient_verification(p_recipient uuid, p_code text) returns boolean
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.sandbox_test_recipients; v app.recipient_verifications;
begin
  select * into r from app.sandbox_test_recipients where id = p_recipient;
  if not found or not app.messaging_can_manage(r.center_id) and not app.has_permission(r.center_id, 'settings.manage') then
    raise exception 'That test recipient was not found, or you cannot manage it (it needs settings.manage).' using errcode = 'insufficient_privilege';
  end if;
  select * into v from app.recipient_verifications
   where recipient_id = p_recipient and confirmed_at is null and expires_at > now()
   order by created_at desc limit 1 for update;
  if not found then raise exception 'There is no current code for %. Send a new one.', r.address using errcode = '22023'; end if;
  if v.attempts >= 5 then raise exception 'Too many wrong codes. Send a new one.' using errcode = '22023'; end if;
  if encode(extensions.digest(btrim(coalesce(p_code, '')), 'sha256'), 'hex') <> v.code_hash then
    update app.recipient_verifications set attempts = attempts + 1 where id = v.id;
    return false;
  end if;
  perform app.set_audit_context('Test recipient ' || r.address || ' confirmed the code sent to it');
  update app.recipient_verifications set confirmed_at = now(), confirmed_by = auth.uid(), attempts = attempts + 1 where id = v.id;
  perform set_config('app.messaging_recipient_verified', 'on', true);
  update app.sandbox_test_recipients set verified_at = now() where id = p_recipient;
  perform set_config('app.messaging_recipient_verified', '', true);
  return true;
end $$;

-- ── Suppressions (staff) ─────────────────────────────────────────────────────
create or replace function app.add_message_suppression(p_center uuid, p_channel text, p_address text, p_reason text) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_addr text; v_id uuid;
begin
  if not app.messaging_can_manage(p_center) then
    raise exception 'Suppressing an address needs settings.manage or integrations.manage.' using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Give a reason. It goes in the audit log.' using errcode = '22023'; end if;
  if p_channel not in ('email','sms','whatsapp') then raise exception 'Suppress an email address or a mobile number.' using errcode = '22023'; end if;
  v_addr := app.normalize_recipient(p_channel, p_address);
  if v_addr is null then raise exception 'Enter the address to suppress.' using errcode = '22023'; end if;
  if (app.message_suppression_for(p_center, p_channel, v_addr)).id is not null then
    raise exception '% is already suppressed.', v_addr using errcode = '23505';
  end if;
  perform app.set_audit_context(p_reason);
  insert into app.message_suppressions (center_id, channel, address, reason, detail, created_by)
  values (p_center, p_channel, v_addr, 'manual', btrim(p_reason), auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function app.lift_message_suppression(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.message_suppressions;
begin
  select * into s from app.message_suppressions where id = p_id;
  if not found or (s.center_id is null and not app.is_platform_admin()) or (s.center_id is not null and not app.messaging_can_manage(s.center_id)) then
    raise exception 'That suppression was not found, or you cannot change it.' using errcode = 'insufficient_privilege';
  end if;
  if s.lifted_at is not null then raise exception 'That suppression was already lifted.' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Give a reason. It goes in the audit log.' using errcode = '22023'; end if;
  perform app.set_audit_context(p_reason);
  update app.message_suppressions set lifted_at = now(), lifted_by = auth.uid(), lift_reason = btrim(p_reason) where id = p_id;
end $$;

-- ── Push: the member app registers this phone ────────────────────────────────
-- The token is proof the caller holds the phone; a phone that changes hands (or
-- sign-ins) follows the login now using it. A dead token is re-armed here.
create or replace function app.register_push_device(p_center uuid, p_token text, p_platform text) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_id uuid; v_token text := btrim(coalesce(p_token, ''));
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is not null and not app.is_member_of(p_center) then
    raise exception 'You are not a member of that community.' using errcode = 'insufficient_privilege';
  end if;
  if v_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,}\]$' then
    raise exception 'That is not an Expo push token.' using errcode = '22023';
  end if;
  if p_platform not in ('ios','android','web') then raise exception 'Unknown platform "%".', p_platform using errcode = '22023'; end if;
  insert into app.push_devices (user_id, center_id, platform, token, last_seen_at)
  values (auth.uid(), p_center, p_platform, v_token, now())
  on conflict (token) do update set user_id = excluded.user_id, center_id = excluded.center_id, platform = excluded.platform,
    last_seen_at = now(), invalid_at = null, invalid_reason = null
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function app.enqueue_message(uuid, text, text, text, jsonb, text), app.messaging_recipient_ok(uuid, text, text, text),
  app.message_suppression_for(uuid, text, text), app.messaging_quiet_until(uuid, timestamptz),
  app.render_message_text(text, jsonb, text), app.message_render(uuid, text, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function app.send_test_message(uuid, text, text), app.send_recipient_verification(uuid),
  app.confirm_recipient_verification(uuid, text), app.add_message_suppression(uuid, text, text, text),
  app.lift_message_suppression(uuid, text), app.register_push_device(uuid, text, text),
  app.sms_segments(text), app.messaging_can_manage(uuid), app.messaging_can_view(uuid) to authenticated;
revoke execute on function app.send_test_message(uuid, text, text), app.send_recipient_verification(uuid),
  app.confirm_recipient_verification(uuid, text), app.add_message_suppression(uuid, text, text, text),
  app.lift_message_suppression(uuid, text), app.register_push_device(uuid, text, text) from anon;
grant execute on all functions in schema app to service_role;
