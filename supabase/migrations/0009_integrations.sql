-- 0009_integrations.sql
-- Integration hub: connections (QuickBooks, payments, CRM import, WhatsApp),
-- account mappings, ledger posting queue (one poster per transaction type,
-- idempotent), payout reconciliation, sync log, imports.

create table app.integration_connections (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  provider      text not null check (provider in ('quickbooks_online','stripe','neon_crm','whatsapp','twilio','sendgrid','resend','google_calendar','other')),
  status        text not null default 'disconnected' check (status in ('disconnected','connected','expiring','error')),
  external_account_id text,                                -- QBO realm id, Stripe account id
  display_name  text,
  secret_ref    text,                                      -- key in Supabase Vault; never the secret itself
  settings      jsonb not null default '{}'::jsonb,        -- basis: cash|accrual, posting: per_txn|daily_summary, go_live_on
  token_expires_at timestamptz,
  connected_by  uuid references auth.users(id),
  connected_at  timestamptz,
  last_error    text,
  updated_at    timestamptz not null default now(),
  unique (center_id, provider)
);
create trigger touch_integration_connections before update on app.integration_connections for each row execute function app.touch_updated_at();

-- QuickBooks chart-of-accounts mapping, approved by the treasurer before posting.
create table app.qbo_account_mappings (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  purpose       text not null,                             -- 'income.general','income.boli','income.sponsorship','income.construction','income.pathshala','income.jeevdaya','store.sales','store.gift_packing','sales_tax_payable','merchant_fees','payment_clearing','bank','undeposited_funds','pledges_receivable','stock_clearing'
  qbo_account_id text not null,
  qbo_account_name text,
  approved_by   uuid references auth.users(id),
  approved_at   timestamptz,
  unique (center_id, purpose)
);

-- Every money event is queued exactly once with an idempotency key.
create table app.ledger_postings (
  id             uuid primary key default gen_random_uuid(),
  center_id      uuid not null references app.centers(id) on delete cascade,
  idempotency_key text not null,
  source_table   text not null,                            -- payments, payment_allocations, store_orders, pledges, refunds, payouts
  source_id      uuid not null,
  txn_type       text not null check (txn_type in (
                   'donation_card','recurring_charge','boli_payment','store_sale','refund','processor_fee',
                   'payout_deposit','offline_receipt','stock_gift','pledge_receivable','membership_fee','adjustment')),
  amount_cents   bigint not null,
  qbo_entity     text,                                     -- SalesReceipt | RefundReceipt | Deposit | JournalEntry
  qbo_ref        text,                                     -- QuickBooks id once posted
  fund_id        uuid references app.funds(id),
  event_id       uuid references app.events(id),
  period_month   date not null,                            -- first of month; closed months post as adjustments
  status         text not null default 'queued' check (status in ('queued','posting','posted','failed','skipped','superseded')),
  attempts       integer not null default 0,
  last_error     text,
  triggered_by   uuid references auth.users(id),
  posted_at      timestamptz,
  created_at     timestamptz not null default now(),
  unique (center_id, idempotency_key)
);
create index on app.ledger_postings (center_id, status, created_at);
create index on app.ledger_postings (center_id, period_month);

create table app.accounting_periods (
  center_id   uuid not null references app.centers(id) on delete cascade,
  period_month date not null,
  status      text not null default 'open' check (status in ('open','closing','closed')),
  closed_by   uuid references auth.users(id),
  closed_at   timestamptz,
  checklist   jsonb not null default '{}'::jsonb,           -- exceptions_cleared, payouts_matched, refunds_reviewed, statements_generated
  primary key (center_id, period_month)
);

-- Payment-provider payouts matched to bank deposits line for line.
create table app.payouts (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  provider      text not null,
  provider_ref  text not null,
  gross_cents   bigint not null,
  fee_cents     bigint not null,
  net_cents     bigint not null,
  arrives_on    date,
  matched       boolean not null default false,
  variance_cents bigint not null default 0,
  ledger_posting_id uuid references app.ledger_postings(id),
  created_at    timestamptz not null default now(),
  unique (center_id, provider, provider_ref)
);

create table app.sync_log (
  id           bigint generated always as identity primary key,
  center_id    uuid references app.centers(id) on delete cascade,
  provider     text not null,
  direction    text not null check (direction in ('inbound','outbound')),
  operation    text not null,
  record_table text,
  record_id    uuid,
  external_ref text,
  status       text not null check (status in ('ok','failed','retry')),
  detail       jsonb,
  occurred_at  timestamptz not null default now()               -- retention 2 years
);
create index on app.sync_log (center_id, provider, occurred_at desc);

-- Migration / import runs (Neon export, spreadsheets)
create table app.import_runs (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  source       text not null,                                  -- 'neon_crm','csv','bloomerang'
  entity       text not null,                                  -- households, people, memberships, pledges, payments
  file_path    text,
  mapping      jsonb not null default '{}'::jsonb,
  rows_total   integer,
  rows_ok      integer,
  rows_failed  integer,
  errors       jsonb not null default '[]'::jsonb,
  status       text not null default 'pending' check (status in ('pending','running','completed','failed','rolled_back')),
  started_by   uuid references auth.users(id),
  started_at   timestamptz,
  finished_at  timestamptz
);

-- Payment provider webhooks (raw, for replay)
create table app.webhook_events (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null,
  event_id     text not null,
  event_type   text not null,
  center_id    uuid references app.centers(id),
  payload      jsonb not null,
  processed_at timestamptz,
  error        text,
  received_at  timestamptz not null default now(),
  unique (provider, event_id)
);

-- Queue a posting for a settled payment (called by the payments webhook / offline entry).
create or replace function app.enqueue_payment_posting(p_payment uuid) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare v uuid; p record; v_type text;
begin
  select * into p from app.payments where id = p_payment;
  v_type := case
    when p.method in ('check','cash','ach','zelle','daf','matching_gift') and p.provider = 'offline' then 'offline_receipt'
    when p.method = 'stock' then 'stock_gift'
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
end $$;
