-- Wave B integration: the pieces streams built against each other's contract.
--
-- Built-in message templates the other streams send through o-messaging's
-- app.enqueue_message but that o-messaging did not seed:
--   sandbox_expiry        o-platform (0203): the 60- and 80-day inactivity warnings
--   qbo_connection_alert  o-quickbooks (0230): a QuickBooks connection needs attention
-- Platform defaults (center_id null), like 0220's; Wave C makes them editable.
set client_min_messages = warning;

insert into app.message_templates (center_id, key, channel, language, subject, body)
select null, v.key, v.channel::app.channel, 'en', v.subject, v.body
  from (values
  ('sandbox_expiry', 'email', 'Your Community Connect sandbox for {{org_name}} has been quiet for {{inactive_days}} days',
   E'Hello,\n\nNobody has used the Community Connect sandbox for {{org_name}} ({{slug}}) for {{inactive_days}} days (last activity {{last_activity_at}}).\n\nSandboxes close after {{expiry_days}} days without activity. Sign in to keep it.\n\nThe Community Connect team'),
  ('qbo_connection_alert', 'email', 'QuickBooks for {{center_name}}: {{subject}}',
   E'The QuickBooks connection for {{center_name}} ({{company}}) needs attention.\n\n{{subject}}\n\n{{detail}}\n\nOpen Accounting › QuickBooks setup in Community Connect to fix it.')
  ) as v(key, channel, subject, body)
 where not exists (select 1 from app.message_templates t
                    where t.center_id is null and t.key = v.key and t.channel = v.channel::app.channel and t.language = 'en');

-- ── Community Connect's own emails: speak the templates' language ────────────
-- o-platform built its emails against the messaging contract before 0220's
-- templates existed, so its variable names differ ({{contact_name}} vs {{name}},
-- expires_at vs {{expires_on}}, a path vs a {{link}}). Fill the template names from
-- what the callers pass. Links are written as %PORTAL_URL%<path>: only the
-- background service knows the portal's public address (PORTAL_PUBLIC_URL) and
-- puts it in when it sends (worker/src/messaging.ts).
create or replace function app.platform_send_message(p_to text, p_template text, p_vars jsonb, p_purpose text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_id uuid; v jsonb := coalesce(p_vars, '{}'::jsonb); v_path text;
begin
  if to_regprocedure('app.enqueue_message(uuid,text,text,text,jsonb,text)') is null then
    return jsonb_build_object('status', 'not_set_up');
  end if;
  if not v ? 'name' then v := v || jsonb_build_object('name', coalesce(v->>'contact_name', '')); end if;
  if not v ? 'email' then v := v || jsonb_build_object('email', p_to); end if;
  if not v ? 'inviter' then v := v || jsonb_build_object('inviter', 'Community Connect'); end if;
  if not v ? 'expires_on' then
    v := v || jsonb_build_object('expires_on',
      case when v ? 'expires_at' then to_char((v->>'expires_at')::timestamptz at time zone 'America/Chicago', 'FMMonth FMDD, YYYY') else 'the date shown in Community Connect' end);
  end if;
  if not v ? 'link' then
    v_path := coalesce(v->>'start_path', v->>'invite_path', '/');
    v := v || jsonb_build_object('link', '%PORTAL_URL%' || v_path);
  end if;
  if jsonb_typeof(v->'roles') = 'array' then
    v := v || jsonb_build_object('roles', (select string_agg(replace(r, '_', ' '), ', ') from jsonb_array_elements_text(v->'roles') r));
  end if;
  begin
    execute 'select app.enqueue_message(null::uuid, ''email'', $1, $2, $3, $4)' into v_id
      using p_to, p_template, v, p_purpose;
  exception when others then
    return jsonb_build_object('status', 'failed', 'error', sqlerrm);
  end;
  return jsonb_build_object('status', 'queued', 'message_id', v_id);
end $$;
revoke execute on function app.platform_send_message(text, text, jsonb, text) from public, anon, authenticated;
