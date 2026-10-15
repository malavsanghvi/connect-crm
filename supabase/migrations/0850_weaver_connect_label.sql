-- 0850 · The Marketplace product called CommunityConnect is now called Weaver Connect (the words only: the key `channels` never changes)
-- (owner decision 2026-10-15; docs/MARKETPLACE_PACKS.md rule P6: a module key never changes, the label does).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   Weaver Connect is the Marketplace product behind WhatsApp Business messages (and, later, Facebook and Instagram posts for
--   events). 0750 to 0752 stored its name as "CommunityConnect". Only words change here; no key, switch, grant, permission, policy,
--   table or amount moves, and a community's Weaver Connect is on or off exactly as it was. The generated types do not change.
--
--   A  app.modules                  the module's own name (label): what Settings › Modules, the module-off sentences ("Weaver has not
--                                   enabled Weaver Connect for this community.") and Settings › Marketplace read
--   B  app.category_modules         a name an experience gave the module (none does today; the update is exact and safe to repeat)
--   C  app.marketplace_products     the Marketplace card's name and its badge (CC stood for CommunityConnect; the badge is now WCo)
--   D  app.worker_message_to_send   the send-time sentence recorded in the message log when a queued WhatsApp message is not sent
--                                   because the product is off: "Not sent: WhatsApp messages are part of Weaver Connect, which is
--                                   not on for this community." The function is its latest body (0751, which took 0598's) word for
--                                   word, with only that sentence and the comment above it changed.
--
--   Only a value that is exactly the old one changes, so the migration is safe to run twice. Left alone on purpose: the message log
--   and the audit log are history and keep the words they were written with; the words "Community Connect" (two words) that mean the
--   platform's own team (the old name of Weaver itself, for example "Ask Community Connect." in save_whatsapp_account) are not this
--   product and are not touched here.
--
-- CHECKED, FAIL-CLOSED: at the end, the module must read "Weaver Connect" under the unchanged key `channels` (still needing
-- Communications), and nothing in the module catalog, the experiences' module names, the Marketplace catalog or the send-time
-- function may still carry the old spelling. If anything does, the migration stops and nothing changes.
set client_min_messages = warning;

-- ── A, B, C. The names ───────────────────────────────────────────────────────
do $$
begin
  perform app.set_audit_context('0850: CommunityConnect is now called Weaver Connect');

  update app.modules set label = 'Weaver Connect' where key = 'channels' and label = 'CommunityConnect';
  update app.category_modules set label = 'Weaver Connect' where module_key = 'channels' and label = 'CommunityConnect';

  update app.marketplace_products set name = 'Weaver Connect' where key = 'channels' and name = 'CommunityConnect';
  update app.marketplace_products set mark = 'WCo' where key = 'channels' and mark = 'CC';
end $$;

-- ── D. Send time ─────────────────────────────────────────────────────────────
-- app.worker_message_to_send (latest body: 0751)
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

  -- 0596: the member switched this topic off for this channel in the app (no row = the topic's default). 0598: not for a
  -- service notice (a member's own order): only the community's switch below holds that back.
  if v_skip is null and m.topic_key is not null and m.person_id is not null and not app.notice_is_service(m.template_key) then
    select app._notice_topic_on(m.person_id, t.key, m.channel::text), t.name
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
  -- 0751, 0850: a WhatsApp message is Weaver Connect (module `channels`), checked again at send time, so a message queued before
  -- the product was turned off or paused is not sent. It is recorded as not sent, with this reason, in the message log.
  if v_skip is null and m.channel = 'whatsapp' and m.center_id is not null and not app.module_enabled(m.center_id, 'channels') then
    v_skip := 'Not sent: WhatsApp messages are part of Weaver Connect, which is not on for this community.';
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

-- ── The check ────────────────────────────────────────────────────────────────
do $$
declare v_left text;
begin
  if not exists (select 1 from app.modules where key = 'channels' and label = 'Weaver Connect' and not core and depends_on = '{comms}') then
    raise exception 'Weaver Connect (0850): the module "channels" does not read "Weaver Connect" with its key and its dependency unchanged. Nothing was changed.';
  end if;
  select string_agg(w, ', ' order by w) into v_left from (
    select 'modules.' || m.key as w from app.modules m where to_jsonb(m)::text ~* 'communityconnect'
    union all
    select 'category_modules.' || c.category_key || '.' || c.module_key from app.category_modules c where to_jsonb(c)::text ~* 'communityconnect'
    union all
    select 'marketplace_products.' || p.key from app.marketplace_products p where to_jsonb(p)::text ~* 'communityconnect'
    union all
    -- The function's own text without its comments (a comment is not shown to anyone).
    select 'worker_message_to_send' from pg_proc f
     where f.oid = 'app.worker_message_to_send(uuid)'::regprocedure
       and regexp_replace(f.prosrc, '--[^\n]*', '', 'g') ~* 'communityconnect'
  ) left_over;
  if v_left is not null then
    raise exception 'Weaver Connect (0850): the old name CommunityConnect is still in: %. Nothing was changed.', v_left;
  end if;
end $$;
