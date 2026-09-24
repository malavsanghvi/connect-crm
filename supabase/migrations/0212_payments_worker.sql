-- Onboarding Wave B · stream o-payments · 3 of 4: what the background service
-- (connect_worker) may do with money, and nothing more.
--
-- Every function here is connect_worker only (app.assert_worker) and writes
-- with client_app 'job' and a reason naming the provider and its reference.
-- Money rules are the existing ones, called, not copied:
--   * a provider payment becomes an app.payments row and is allocated by
--     app.allocate_payment (earliest open pledge first unless the donor chose,
--     overpayment to the next) and queued for QuickBooks by
--     app.enqueue_payment_posting (which already skips history and anything
--     before the QuickBooks go-live date);
--   * a provider refund is recorded exactly as a hand-recorded refund is
--     (refunded_cents, refunded / partially_refunded), and only after the
--     two-person approval the existing trigger enforces;
--   * payouts land in the existing app.payouts, where bank reconciliation
--     already recognises them.
-- The $1 processor test is never a gift: it is recorded only in
-- app.payment_processor_tests.

-- ── Connections ──────────────────────────────────────────────────────────────
-- After oauth.exchange stored the tokens (any provider): the connection is
-- connected; a payment processor moves to test mode (or waits for the
-- provider's verification when it says charges are not enabled yet).
create or replace function app.worker_connection_connected(p_connection uuid, p_external_account_id text, p_display_name text,
                                                           p_expires_at timestamptz, p_settings jsonb)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare ic app.integration_connections; v_settings jsonb := coalesce(p_settings, '{}'::jsonb); v_status text;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  select * into ic from app.integration_connections where id = p_connection for update;
  if ic.id is null then raise exception 'That connection was not found.'; end if;
  if jsonb_typeof(v_settings) <> 'object' then v_settings := '{}'::jsonb; end if;
  perform app.set_audit_context('Background service: ' || initcap(ic.provider) || ' connected'
                                || coalesce(' (' || nullif(btrim(p_external_account_id), '') || ')', ''));
  update app.integration_connections
     set status = 'connected', external_account_id = coalesce(nullif(btrim(p_external_account_id), ''), external_account_id),
         display_name = coalesce(nullif(btrim(p_display_name), ''), display_name),
         token_expires_at = p_expires_at, connected_at = now(),
         connected_by = coalesce(case when settings->>'connecting_user' ~ '^[0-9a-f-]{36}$' then (settings->>'connecting_user')::uuid end, connected_by),
         settings = (settings - 'connecting_user') || v_settings || jsonb_build_object('mode', coalesce(settings->>'mode', 'test')),
         last_error = null
   where id = p_connection
  returning * into ic;
  if ic.provider in ('stripe','paypal') then
    v_status := case when ic.settings->'charges_enabled' = 'false'::jsonb then 'pending_verification'
                     else coalesce(nullif(ic.settings->>'mode', ''), 'test') end;
    update app.center_payment_processors
       set status = v_status, connection_id = ic.id, updated_by = ic.connected_by
     where center_id = ic.center_id and processor = ic.provider
       and status in ('not_connected','pending_verification','disabled','test','live');
  end if;
  return jsonb_build_object('connection_id', ic.id, 'provider', ic.provider, 'status', ic.status);
end $$;

-- A provider says an account changed (Stripe account.updated, PayPal onboarding
-- completed): merge the facts into every connection with that account id.
create or replace function app.worker_connection_settings(p_provider text, p_external_account_id text, p_settings jsonb)
returns int language plpgsql security definer set search_path = app, public, extensions as $$
declare v_n int := 0; r record;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  if nullif(btrim(p_external_account_id), '') is null or jsonb_typeof(p_settings) <> 'object' then return 0; end if;
  perform app.set_audit_context('Background service: ' || initcap(p_provider) || ' account ' || p_external_account_id || ' updated');
  for r in update app.integration_connections set settings = settings || p_settings
            where provider = p_provider and external_account_id = btrim(p_external_account_id)
           returning id, center_id, settings, status loop
    v_n := v_n + 1;
    if r.status = 'connected' then
      update app.center_payment_processors
         set status = case when r.settings->'charges_enabled' = 'false'::jsonb then 'pending_verification'
                           else coalesce(nullif(r.settings->>'mode', ''), 'test') end
       where center_id = r.center_id and processor = p_provider and status in ('pending_verification','test','live')
         and status is distinct from (case when r.settings->'charges_enabled' = 'false'::jsonb then 'pending_verification'
                                           else coalesce(nullif(r.settings->>'mode', ''), 'test') end);
    end if;
  end loop;
  return v_n;
end $$;

-- ── Checkouts ────────────────────────────────────────────────────────────────
create or replace function app.worker_checkout_json(k app.payment_checkouts) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare ic app.integration_connections;
begin
  select i.* into ic from app.center_payment_processors cp join app.integration_connections i on i.id = cp.connection_id
   where cp.center_id = k.center_id and cp.processor = k.processor;
  return jsonb_build_object('id', k.id, 'center_id', k.center_id, 'household_id', k.household_id, 'person_id', k.person_id,
           'processor', k.processor, 'mode', k.mode, 'context', k.context, 'amount_cents', k.amount_cents, 'currency', k.currency,
           'pledge_ids', to_jsonb(k.pledge_ids), 'status', k.status, 'provider_ref', k.provider_ref,
           'provider_payment_ref', k.provider_payment_ref, 'payment_id', k.payment_id,
           'account_id', ic.external_account_id, 'connect_method', ic.settings->>'connect_method',
           'payee_email', ic.settings->>'paypal_email');
end $$;

create or replace function app.worker_checkout(p_checkout uuid, p_processor text default null, p_provider_ref text default null)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare k app.payment_checkouts;
begin
  perform app.assert_worker();
  if p_checkout is not null then
    select * into k from app.payment_checkouts where id = p_checkout;
  elsif p_provider_ref is not null then
    select * into k from app.payment_checkouts where processor = p_processor and provider_ref = p_provider_ref;
  end if;
  if k.id is null then return null; end if;
  return app.worker_checkout_json(k);
end $$;

-- A connected processor's account, for a job that only knows the center.
create or replace function app.worker_payment_connection(p_center uuid, p_processor text)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare r record;
begin
  perform app.assert_worker();
  select ic.id, ic.external_account_id, ic.status, ic.settings, cp.status as processor_status
    into r
    from app.center_payment_processors cp join app.integration_connections ic on ic.id = cp.connection_id
   where cp.center_id = p_center and cp.processor = p_processor;
  if r.id is null then return null; end if;
  return jsonb_build_object('connection_id', r.id, 'account_id', r.external_account_id, 'status', r.status,
                            'processor_status', r.processor_status, 'mode', app.payment_api_mode(p_center, p_processor),
                            'connect_method', r.settings->>'connect_method', 'payee_email', r.settings->>'paypal_email');
end $$;

-- Every connected Stripe account (for the daily payout sync), or one center's.
create or replace function app.worker_payout_accounts(p_center uuid default null)
returns setof jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  return query
  select jsonb_build_object('center_id', cp.center_id, 'processor', cp.processor, 'account_id', ic.external_account_id,
                            'mode', app.payment_api_mode(cp.center_id, cp.processor))
    from app.center_payment_processors cp join app.integration_connections ic on ic.id = cp.connection_id
   where cp.status in ('test','live') and ic.status = 'connected' and ic.external_account_id is not null
     and (p_center is null or cp.center_id = p_center)
     and app.module_enabled(cp.center_id, 'giving')
   order by cp.center_id, cp.processor;
end $$;

-- The provider says the checkout was paid. Records the payment once (by the
-- provider's reference) through the existing allocation and posting
-- functions, or, for the $1 test, only marks it paid and queues the refund.
create or replace function app.worker_record_online_payment(p_checkout uuid, p_provider_ref text, p_amount_cents bigint,
                                                            p_fee_cents bigint, p_method text, p_detail text default null)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare k app.payment_checkouts; c app.centers; v_payment uuid; v_existing uuid; v_method app.payment_method; v_job bigint;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  if nullif(btrim(p_provider_ref), '') is null then raise exception 'The provider''s payment reference is missing.'; end if;
  select * into k from app.payment_checkouts where id = p_checkout for update;
  if k.id is null then raise exception 'Checkout % was not found.', p_checkout; end if;
  if p_amount_cents is distinct from k.amount_cents then
    -- Never record an amount the checkout did not ask for; someone must look.
    raise exception '% reports % cents for checkout %, which asked for % cents. Not recorded.',
      initcap(k.processor), p_amount_cents, k.id, k.amount_cents;
  end if;
  if k.payment_id is not null or (k.context = 'processor_test' and k.status = 'paid') then
    return jsonb_build_object('duplicate', true, 'payment_id', k.payment_id, 'checkout_id', k.id);
  end if;
  select * into c from app.centers where id = k.center_id;
  perform app.set_audit_context('Paid online · ' || initcap(k.processor) || ' ' || btrim(p_provider_ref)
                                || case when k.mode = 'test' then ' (test mode)' else '' end);

  if k.context = 'processor_test' then
    update app.payment_checkouts set status = 'paid', provider_payment_ref = btrim(p_provider_ref), paid_at = now(), error = null
     where id = k.id;
    v_job := app.enqueue_job(k.center_id, 'payments.test_charge',
                             jsonb_build_object('checkout_id', k.id, 'provider_payment_ref', btrim(p_provider_ref)), now(), 5);
    return jsonb_build_object('test', true, 'checkout_id', k.id, 'refund_job', v_job);
  end if;

  select id into v_existing from app.payments
   where center_id = k.center_id and provider = k.processor and provider_ref = btrim(p_provider_ref);
  if v_existing is not null then
    update app.payment_checkouts set status = 'paid', payment_id = v_existing, provider_payment_ref = btrim(p_provider_ref),
                                     paid_at = coalesce(paid_at, now())
     where id = k.id;
    return jsonb_build_object('duplicate', true, 'payment_id', v_existing, 'checkout_id', k.id);
  end if;

  v_method := case when p_method in ('card','ach','apple_pay','google_pay','paypal','venmo') then p_method::app.payment_method
                   else 'card'::app.payment_method end;
  insert into app.payments (center_id, household_id, payer_person_id, amount_cents, fee_cents, method, status, provider, provider_ref,
                            received_on, memo)
  values (k.center_id, k.household_id, k.person_id, k.amount_cents, greatest(coalesce(p_fee_cents, 0), 0), v_method, 'captured',
          k.processor, btrim(p_provider_ref), (now() at time zone coalesce(c.time_zone, 'America/Chicago'))::date,
          left('Paid online · ' || k.for_label || case when k.mode = 'test' then ' · test mode' else '' end
               || coalesce(' · ' || nullif(btrim(p_detail), ''), ''), 500))
  returning id into v_payment;
  -- The existing rules: the donor's chosen pledges first, else earliest open; overpayment rolls on.
  perform app.allocate_payment(v_payment, case when cardinality(k.pledge_ids) > 0 then k.pledge_ids end, true);
  perform app.enqueue_payment_posting(v_payment);
  update app.payment_checkouts set status = 'paid', payment_id = v_payment, provider_payment_ref = btrim(p_provider_ref),
                                   paid_at = now(), error = null
   where id = k.id;
  insert into app.sync_log (center_id, provider, direction, operation, record_table, record_id, external_ref, status, detail)
  values (k.center_id, k.processor, 'inbound', 'payment', 'payments', v_payment, btrim(p_provider_ref), 'ok',
          jsonb_build_object('checkout_id', k.id, 'mode', k.mode, 'amount_cents', k.amount_cents, 'fee_cents', coalesce(p_fee_cents, 0)));
  return jsonb_build_object('duplicate', false, 'payment_id', v_payment, 'checkout_id', k.id);
end $$;

create or replace function app.worker_checkout_closed(p_checkout uuid, p_status text, p_error text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  if p_status not in ('failed','cancelled','expired') then raise exception 'Unknown checkout outcome "%".', p_status; end if;
  perform app.set_audit_context('Checkout ' || p_status || coalesce(': ' || nullif(btrim(p_error), ''), ''));
  update app.payment_checkouts set status = p_status, error = left(p_error, 1000)
   where id = p_checkout and status in ('created','pending');
end $$;

create or replace function app.worker_record_processor_test(p_checkout uuid, p_ok boolean, p_charge_ref text, p_refund_ref text, p_detail text)
returns uuid language plpgsql security definer set search_path = app, public, extensions as $$
declare k app.payment_checkouts; v uuid;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  select * into k from app.payment_checkouts where id = p_checkout and context = 'processor_test';
  if k.id is null then raise exception 'That $1 test was not found.'; end if;
  select id into v from app.payment_processor_tests where checkout_id = k.id;
  if v is not null then return v; end if;
  perform app.set_audit_context('$1 ' || k.mode || ' test of ' || initcap(k.processor) || case when p_ok then ' passed' else ' failed' end);
  insert into app.payment_processor_tests (center_id, processor, mode, checkout_id, charge_ref, refund_ref, ok, ran_by, detail)
  values (k.center_id, k.processor, k.mode, k.id, p_charge_ref, p_refund_ref, coalesce(p_ok, false), k.created_by, left(p_detail, 1000))
  returning id into v;
  if not coalesce(p_ok, false) then
    update app.payment_checkouts set error = left(p_detail, 1000) where id = k.id;
  end if;
  return v;
end $$;

-- ── Refunds ──────────────────────────────────────────────────────────────────
create or replace function app.worker_payment_json(p_payment uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare p app.payments; k app.payment_checkouts;
begin
  perform app.assert_worker();
  select * into p from app.payments where id = p_payment;
  if p.id is null then return null; end if;
  select * into k from app.payment_checkouts where payment_id = p.id limit 1;
  return jsonb_build_object('id', p.id, 'center_id', p.center_id, 'provider', p.provider, 'provider_ref', p.provider_ref,
           'amount_cents', p.amount_cents, 'refunded_cents', p.refunded_cents, 'refund_requested_cents', p.refund_requested_cents,
           'approved', p.refund_approved_by is not null and p.refund_second_approver is not null
                       and p.refund_approved_by <> p.refund_second_approver,
           'mode', coalesce(k.mode, app.payment_api_mode(p.center_id, p.provider)), 'checkout_id', k.id, 'order_ref', k.provider_ref,
           'connection', app.worker_payment_connection(p.center_id, p.provider));
end $$;

-- By the provider's own reference (webhooks about refunds name the charge).
create or replace function app.worker_payment_by_ref(p_provider text, p_ref text) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v uuid;
begin
  perform app.assert_worker();
  select id into v from app.payments where provider = p_provider and provider_ref = p_ref limit 1;
  if v is null then return null; end if;
  return app.worker_payment_json(v);
end $$;

-- The provider refunded it: record it the way a hand-recorded refund is recorded.
-- p_refunded_before makes it idempotent: a retried job finds it already applied.
create or replace function app.worker_record_provider_refund(p_payment uuid, p_amount_cents bigint, p_refunded_before bigint, p_refund_ref text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.payments; v_total bigint;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  select * into p from app.payments where id = p_payment for update;
  if p.id is null then raise exception 'Payment % was not found.', p_payment; end if;
  if p.refunded_cents <> p_refunded_before then
    return jsonb_build_object('duplicate', true, 'refunded_cents', p.refunded_cents);
  end if;
  v_total := p.refunded_cents + p_amount_cents;
  if p_amount_cents <= 0 or v_total > p.amount_cents then
    raise exception 'A refund of % cents on a % cent payment (% already refunded) is not possible.', p_amount_cents, p.amount_cents, p.refunded_cents;
  end if;
  perform app.set_audit_context(left('Refunded through ' || initcap(p.provider) || ' · ' || coalesce(p_refund_ref, '?')
                                     || coalesce(' · ' || nullif(btrim(p.refund_reason), ''), ''), 500));
  -- The two-person trigger (0016) still requires both approvers here.
  update app.payments set refunded_cents = v_total,
                          status = (case when v_total = amount_cents then 'refunded' else 'partially_refunded' end)::app.payment_status
   where id = p.id;
  insert into app.sync_log (center_id, provider, direction, operation, record_table, record_id, external_ref, status, detail)
  values (p.center_id, p.provider, 'outbound', 'refund', 'payments', p.id, p_refund_ref, 'ok',
          jsonb_build_object('amount_cents', p_amount_cents, 'refunded_cents', v_total));
  return jsonb_build_object('duplicate', false, 'refunded_cents', v_total);
end $$;

-- ── Payouts ──────────────────────────────────────────────────────────────────
create or replace function app.worker_upsert_payout(p_center uuid, p_provider text, p_ref text, p_gross bigint, p_fee bigint, p_net bigint,
                                                    p_arrives_on date)
returns uuid language plpgsql security definer set search_path = app, public, extensions as $$
declare v uuid;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  if nullif(btrim(p_ref), '') is null then raise exception 'A payout needs its provider reference.'; end if;
  perform app.set_audit_context('Payout from ' || initcap(p_provider) || ' · ' || p_ref);
  insert into app.payouts (center_id, provider, provider_ref, gross_cents, fee_cents, net_cents, arrives_on)
  values (p_center, p_provider, btrim(p_ref), coalesce(p_gross, 0), coalesce(p_fee, 0), coalesce(p_net, 0), p_arrives_on)
  on conflict (center_id, provider, provider_ref) do update
     set gross_cents = excluded.gross_cents, fee_cents = excluded.fee_cents, net_cents = excluded.net_cents, arrives_on = excluded.arrives_on
   where not app.payouts.matched
     and (app.payouts.gross_cents, app.payouts.fee_cents, app.payouts.net_cents, app.payouts.arrives_on)
         is distinct from (excluded.gross_cents, excluded.fee_cents, excluded.net_cents, excluded.arrives_on)
  returning id into v;
  if v is null then select id into v from app.payouts where center_id = p_center and provider = p_provider and provider_ref = btrim(p_ref); end if;
  -- Payments paid out in it carry the payout reference (bank reconciliation reads it).
  return v;
end $$;

create or replace function app.worker_mark_payout_payments(p_center uuid, p_provider text, p_payout_ref text, p_payment_refs text[])
returns int language plpgsql security definer set search_path = app, public, extensions as $$
declare v_n int;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context('Payout from ' || initcap(p_provider) || ' · ' || p_payout_ref);
  update app.payments set provider_payout_ref = p_payout_ref
   where center_id = p_center and provider = p_provider and provider_ref = any (coalesce(p_payment_refs, '{}'))
     and provider_payout_ref is distinct from p_payout_ref;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function app.worker_connection_connected(uuid, text, text, timestamptz, jsonb),
  app.worker_connection_settings(text, text, jsonb), app.worker_checkout_json(app.payment_checkouts),
  app.worker_checkout(uuid, text, text), app.worker_payment_connection(uuid, text), app.worker_payout_accounts(uuid),
  app.worker_record_online_payment(uuid, text, bigint, bigint, text, text), app.worker_checkout_closed(uuid, text, text),
  app.worker_record_processor_test(uuid, boolean, text, text, text), app.worker_payment_json(uuid),
  app.worker_payment_by_ref(text, text), app.worker_record_provider_refund(uuid, bigint, bigint, text),
  app.worker_upsert_payout(uuid, text, text, bigint, bigint, bigint, date),
  app.worker_mark_payout_payments(uuid, text, text, text[])
  from public, anon, authenticated, service_role;
grant execute on function app.worker_connection_connected(uuid, text, text, timestamptz, jsonb),
  app.worker_connection_settings(text, text, jsonb), app.worker_checkout(uuid, text, text), app.worker_payment_connection(uuid, text),
  app.worker_payout_accounts(uuid), app.worker_record_online_payment(uuid, text, bigint, bigint, text, text),
  app.worker_checkout_closed(uuid, text, text), app.worker_record_processor_test(uuid, boolean, text, text, text),
  app.worker_payment_json(uuid), app.worker_payment_by_ref(text, text), app.worker_record_provider_refund(uuid, bigint, bigint, text),
  app.worker_upsert_payout(uuid, text, text, bigint, bigint, bigint, date), app.worker_mark_payout_payments(uuid, text, text, text[])
  to connect_worker;
