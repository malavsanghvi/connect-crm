-- Onboarding · o-import · 2 of 4: money history never posts to QuickBooks (G18).
--
-- It is already in the books. Two rules, both enforced where the posting is
-- queued (app.enqueue_payment_posting, called by the offline-payment trigger,
-- confirm_bank_match and the payments webhook):
--   1. a payment marked is_historical is never queued;
--   2. nothing received before the QuickBooks go-live date is ever queued
--      (integration_connections row for quickbooks_online, settings->>'go_live_date').
-- Legacy receipt / payment numbers are kept: payments gain crm_external_id
-- (pledges and memberships already have it), unique per center.
--
-- No allocation, write-off or refund rule changes: allocations of imported
-- payments are inserted as given and the existing recompute trigger keeps the
-- pledge balance equal to the sum of its allocations, exactly as today.

alter table app.payments add column if not exists is_historical boolean not null default false;
alter table app.payments add column if not exists crm_external_id text;
create unique index if not exists payments_crm_external_id_idx on app.payments (center_id, crm_external_id)
  where crm_external_id is not null;

-- History stays history: once imported as history a payment cannot be turned
-- into a live one (that would post an old receipt to the books).
create or replace function app.payments_keep_historical() returns trigger
language plpgsql set search_path = app, public, extensions as $$
begin
  if old.is_historical and not new.is_historical then
    raise exception 'An imported historical payment cannot be turned into a live one; it is already in the books.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists payments_keep_historical on app.payments;
create trigger payments_keep_historical before update of is_historical on app.payments
  for each row execute function app.payments_keep_historical();

-- The organization's QuickBooks go-live date, or null when none is set.
create or replace function app.qbo_go_live_date(p_center uuid) returns date
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v text;
begin
  select settings->>'go_live_date' into v from app.integration_connections
   where center_id = p_center and provider = 'quickbooks_online';
  if v is null or v !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return v::date;
exception when others then
  return null;   -- a malformed date in settings is "not set"; the Accounting screen shows it
end $$;

-- True when this payment may ever be queued for posting.
create or replace function app.payment_posts_to_qbo(p_payment uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select not p.is_historical
         and (app.qbo_go_live_date(p.center_id) is null or p.received_on >= app.qbo_go_live_date(p.center_id))
    from app.payments p where p.id = p_payment
$$;

-- 0104's definition plus the history guard at the top.
create or replace function app.enqueue_payment_posting(p_payment uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare v uuid; p record; v_type text;
begin
  select * into p from app.payments where id = p_payment;
  -- Called directly it is a Giving RPC; from the payments trigger it is part of a write
  -- that Giving's own RLS and RPC guards already admitted.
  if pg_trigger_depth() = 0 then perform app.assert_module_enabled(p.center_id, 'giving'); end if;
  -- Money history is already in the books: never queue it (ONBOARDING_PLAN G18).
  if p.id is null or not app.payment_posts_to_qbo(p.id) then return null; end if;
  v_type := case
    when p.provider = 'bank' then 'bank_receipt'
    when p.method = 'stock' then 'stock_gift'
    when p.provider = 'offline' then 'offline_receipt'
    else 'donation_card' end;
  insert into app.ledger_postings (center_id, idempotency_key, source_table, source_id, txn_type, amount_cents, period_month, triggered_by)
  values (p.center_id, 'payment:' || p.id, 'payments', p.id, v_type, p.amount_cents, date_trunc('month', p.received_on)::date, p.recorded_by)
  on conflict (center_id, idempotency_key) do nothing
  returning id into v;
  if p.fee_cents > 0 then
    insert into app.ledger_postings (center_id, idempotency_key, source_table, source_id, txn_type, amount_cents, period_month)
    values (p.center_id, 'fee:' || p.id, 'payments', p.id, 'processor_fee', p.fee_cents, date_trunc('month', p.received_on)::date)
    on conflict do nothing;
  end if;
  return v;
end $function$;

-- The offline trigger checks too, so the rule holds even if the enqueue function is replaced.
create or replace function app.on_offline_payment() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if new.provider = 'offline' and not new.is_historical then perform app.enqueue_payment_posting(new.id); end if;
  return new;
end $$;

revoke execute on function app.on_offline_payment(), app.payments_keep_historical() from public, anon, authenticated;
grant execute on function app.qbo_go_live_date(uuid), app.payment_posts_to_qbo(uuid) to authenticated;
grant execute on all functions in schema app to service_role;
