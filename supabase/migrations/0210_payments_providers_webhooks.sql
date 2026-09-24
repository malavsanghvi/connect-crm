-- Onboarding Wave B · stream o-payments · 1 of 4: the shared provider list and
-- the webhook inbox every Wave B stream codes against (ONBOARDING_WAVE_B.md,
-- "Providers and connections").
--
--   1. app.integration_connections.provider gains 'paypal', 'postmark',
--      'expo_push', 'intuit_sandbox'. unique (center_id, provider) is kept.
--   2. app.payment_method gains 'paypal' and 'venmo' (money PayPal takes).
--      Nothing else about payments changes here; the new values are only used
--      from 0211 on (an enum value cannot be used in the transaction that adds it).
--   3. app.ingest_webhook(p_provider, p_event_id, p_type, p_center, p_payload):
--      the one door from a verified public webhook route into the database.
--      Idempotent on (provider, event_id): a provider re-sending an event gets
--      the same webhook_events row back and no second job. A new event queues
--      one job for the provider's worker handler (app.webhook_job_kind).
--      Executable by service_role only: the portal's webhook routes verify the
--      provider's signature first and then call it with the service key; no
--      browser or member session can reach it.
--   4. Worker helpers: app.worker_webhook_event (read one event) and
--      app.worker_webhook_done (mark it processed, or record why it was not).

-- ── 1. Providers ─────────────────────────────────────────────────────────────
do $$
declare v_name text;
begin
  select c.conname into v_name
    from pg_constraint c
   where c.conrelid = 'app.integration_connections'::regclass and c.contype = 'c'
     and pg_get_constraintdef(c.oid) ilike '%provider%quickbooks_online%';
  if v_name is not null then
    execute format('alter table app.integration_connections drop constraint %I', v_name);
  end if;
end $$;
alter table app.integration_connections add constraint integration_connections_provider_check
  check (provider in ('quickbooks_online','stripe','neon_crm','whatsapp','twilio','sendgrid','resend','google_calendar','other',
                      'paypal','postmark','expo_push','intuit_sandbox'));
comment on column app.integration_connections.settings is
  'Per provider. Every connection: mode (test|live; forced to test in a sandbox). Payments: connect_method (oauth|partner|email), '
  'charges_enabled, paypal_email, paypal_email_verified_at, provider_env. QuickBooks: basis, posting, go_live_date, ...';

-- ── 2. Payment methods PayPal takes ──────────────────────────────────────────
alter type app.payment_method add value if not exists 'paypal';
alter type app.payment_method add value if not exists 'venmo';

-- ── 3. The webhook inbox ─────────────────────────────────────────────────────
alter table app.webhook_events add column if not exists job_id bigint;
create index if not exists webhook_events_center_idx on app.webhook_events (center_id, received_at desc);
create index if not exists webhook_events_unprocessed_idx on app.webhook_events (provider, received_at) where processed_at is null;

-- Which worker handler takes a provider's events (worker/src/handlers/<kind>.ts).
create or replace function app.webhook_job_kind(p_provider text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case lower(btrim(p_provider))
    when 'stripe' then 'payments.webhook.stripe'
    when 'paypal' then 'payments.webhook.paypal'
    when 'resend' then 'messaging.webhook.email'
    when 'postmark' then 'messaging.webhook.email'
    when 'sendgrid' then 'messaging.webhook.email'
    when 'twilio' then 'messaging.webhook.twilio'
    when 'intuit' then 'qbo.webhook'
    when 'quickbooks_online' then 'qbo.webhook'
    else 'webhook.' || regexp_replace(lower(btrim(p_provider)), '[^a-z0-9_]', '_', 'g') end
$$;

-- The community a provider event belongs to, when the route could not tell:
-- Stripe Connect events name the connected account ("account"); that account
-- is a connection's external_account_id.
create or replace function app.webhook_center_for(p_provider text, p_payload jsonb) returns uuid
language sql stable security definer set search_path = app, public, extensions as $$
  select c.center_id from app.integration_connections c
   where c.provider = lower(btrim(p_provider))
     and c.external_account_id is not null
     and c.external_account_id = coalesce(p_payload->>'account', p_payload #>> '{resource,payee,merchant_id}')
   order by c.connected_at desc nulls last
   limit 1
$$;

create or replace function app.ingest_webhook(p_provider text, p_event_id text, p_type text, p_center uuid, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = app, public, extensions as $$
declare v_provider text := lower(btrim(p_provider)); v_id uuid; v_center uuid := p_center; v_job bigint;
begin
  if v_provider is null or v_provider !~ '^[a-z][a-z0-9_]{1,40}$' then
    raise exception 'A webhook needs its provider name (got "%").', p_provider using errcode = '22023';
  end if;
  if nullif(btrim(p_event_id), '') is null or char_length(p_event_id) > 255 then
    raise exception 'A % webhook needs its event id (at most 255 characters).', v_provider using errcode = '22023';
  end if;
  if nullif(btrim(p_type), '') is null or char_length(p_type) > 200 then
    raise exception 'A % webhook needs its event type.', v_provider using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'A % webhook body must be a JSON object.', v_provider using errcode = '22023';
  end if;
  if pg_column_size(p_payload) > 1048576 then
    raise exception 'That % webhook is larger than 1 MB and was not stored.', v_provider using errcode = '22023';
  end if;
  if v_center is not null and not exists (select 1 from app.centers where id = v_center) then
    raise exception 'The community named by this % webhook was not found.', v_provider using errcode = '22023';
  end if;
  v_center := coalesce(v_center, app.webhook_center_for(v_provider, p_payload));

  insert into app.webhook_events (provider, event_id, event_type, center_id, payload)
  values (v_provider, btrim(p_event_id), btrim(p_type), v_center, p_payload)
  on conflict (provider, event_id) do nothing
  returning id into v_id;
  if v_id is null then
    -- Seen before: providers retry until they get a 2xx. Same row, no second job.
    select id into v_id from app.webhook_events where provider = v_provider and event_id = btrim(p_event_id);
    return v_id;
  end if;

  perform set_config('app.client_app', 'job', true);
  v_job := app.enqueue_job(v_center, app.webhook_job_kind(v_provider),
                           jsonb_build_object('webhook_event_id', v_id, 'provider', v_provider,
                                              'event_id', btrim(p_event_id), 'type', btrim(p_type)),
                           now(), 8);
  update app.webhook_events set job_id = v_job where id = v_id;
  return v_id;
end $$;
comment on function app.ingest_webhook(text, text, text, uuid, jsonb) is
  'Verified provider webhook → app.webhook_events (idempotent on provider+event_id) + one job for app.webhook_job_kind(provider). service_role only.';

-- ── 4. The worker's side ─────────────────────────────────────────────────────
create or replace function app.worker_webhook_event(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare w app.webhook_events;
begin
  perform app.assert_worker();
  select * into w from app.webhook_events where id = p_id;
  if w.id is null then return null; end if;
  return jsonb_build_object('id', w.id, 'provider', w.provider, 'event_id', w.event_id, 'event_type', w.event_type,
                            'center_id', w.center_id, 'payload', w.payload, 'processed_at', w.processed_at,
                            'error', w.error, 'received_at', w.received_at);
end $$;

-- p_error null: processed. Otherwise the reason it was not (shown to staff).
create or replace function app.worker_webhook_done(p_id uuid, p_error text default null, p_center uuid default null) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  update app.webhook_events
     set processed_at = case when p_error is null then now() else processed_at end,
         error = left(p_error, 2000),
         center_id = coalesce(center_id, p_center)
   where id = p_id;
end $$;

revoke execute on function app.ingest_webhook(text, text, text, uuid, jsonb), app.webhook_center_for(text, jsonb),
  app.worker_webhook_event(uuid), app.worker_webhook_done(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function app.ingest_webhook(text, text, text, uuid, jsonb) to service_role;
revoke execute on function app.worker_webhook_event(uuid), app.worker_webhook_done(uuid, text, uuid) from service_role;
grant execute on function app.worker_webhook_event(uuid), app.worker_webhook_done(uuid, text, uuid) to connect_worker;
grant execute on function app.webhook_job_kind(text) to authenticated, service_role, connect_worker;
