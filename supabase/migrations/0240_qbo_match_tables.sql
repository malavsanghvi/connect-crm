-- Onboarding · o-qbo-match · 1 of 4: QuickBooks customers, their history and
-- the donor matches (ONBOARDING_WAVE_B "Intelligent donor matching").
--
-- The owner (2026-09-24): map every donation, receipt, open invoice and pledge
-- in QuickBooks to the families and people in Community Connect; the treasury
-- approves each QuickBooks customer ↔ household/person match; once approved the
-- history shows on the household; a family-level QuickBooks account posts to the
-- family's PRIMARY member; every QuickBooks customer not mapped yet stays visible.
--
--   app.qbo_customers          read-only copy of QuickBooks customers (worker-written)
--   app.qbo_transactions       read-only copy of their history (worker-written), plus
--                              where each transaction landed in Community Connect
--   app.qbo_customer_matches   suggested / approved / rejected matches, with evidence
--
-- Module `accounting`. Read: accounting.manage or giving.manage. Nobody writes
-- these tables directly: the worker writes the copies through functions granted
-- only to connect_worker (0243), people decide matches through RPCs (0242).
-- No existing policy, permission or money rule changes.

-- ── Copies ──────────────────────────────────────────────────────────────────
create table if not exists app.qbo_customers (
  center_id          uuid not null references app.centers(id) on delete cascade,
  qbo_id             text not null check (char_length(qbo_id) between 1 and 64),
  display_name       text not null,
  given_name         text,
  family_name        text,
  company_name       text,
  emails             text[] not null default '{}',     -- lower-case
  phones             text[] not null default '{}',     -- E.164
  address            jsonb not null default '{}'::jsonb, -- {line1, line2, city, state, zip, country}
  parent_qbo_id      text,
  is_sub_customer    boolean not null default false,
  active             boolean not null default true,
  open_balance_cents bigint not null default 0,
  raw                jsonb not null default '{}'::jsonb,
  synced_at          timestamptz not null default now(),
  primary key (center_id, qbo_id)
);
create index if not exists qbo_customers_parent_idx on app.qbo_customers (center_id, parent_qbo_id) where parent_qbo_id is not null;

create table if not exists app.qbo_transactions (
  center_id          uuid not null references app.centers(id) on delete cascade,
  qbo_type           text not null check (qbo_type in ('SalesReceipt','Payment','Invoice','CreditMemo','RefundReceipt','JournalEntry','Deposit')),
  qbo_id             text not null check (char_length(qbo_id) between 1 and 64),
  customer_qbo_id    text,
  txn_date           date not null,
  doc_number         text,
  total_cents        bigint not null default 0,
  open_balance_cents bigint not null default 0,
  memo               text,
  lines              jsonb not null default '[]'::jsonb,   -- [{amount_cents, description, item, account, class_id, class_name}]
  linked             jsonb not null default '[]'::jsonb,   -- [{type, id, amount_cents}] (Payment → Invoice)
  payment_method     text,                                 -- QuickBooks payment method name, as shown there
  reference_number   text,                                 -- check number / reference
  raw                jsonb not null default '{}'::jsonb,
  synced_at          timestamptz not null default now(),
  cc_status          text not null default 'pending' check (cc_status in ('pending','brought_in','needs_review','skipped')),
  cc_detail          text,
  cc_payment_id      uuid references app.payments(id) on delete set null,
  cc_pledge_id       uuid references app.pledges(id) on delete set null,
  cc_fund_id         uuid references app.funds(id) on delete set null,
  cc_at              timestamptz,
  primary key (center_id, qbo_type, qbo_id)
);
create index if not exists qbo_transactions_customer_idx on app.qbo_transactions (center_id, customer_qbo_id);
create index if not exists qbo_transactions_status_idx on app.qbo_transactions (center_id, cc_status);

-- ── Matches ─────────────────────────────────────────────────────────────────
create table if not exists app.qbo_customer_matches (
  id               uuid primary key default gen_random_uuid(),
  center_id        uuid not null references app.centers(id) on delete cascade,
  qbo_customer_id  text not null,
  household_id     uuid not null references app.households(id),
  person_id        uuid references app.people(id),
  status           text not null default 'suggested' check (status in ('suggested','approved','rejected')),
  confidence       numeric(4,3) not null default 0 check (confidence between 0 and 1),
  method           text not null check (method in ('email','phone','name_address','household_name','crm_id','sub_customer','ai','manual')),
  evidence         jsonb not null default '{}'::jsonb,
  suggested_at     timestamptz not null default now(),
  decided_by       uuid references auth.users(id),
  decided_at       timestamptz,
  reason           text,
  foreign key (center_id, qbo_customer_id) references app.qbo_customers (center_id, qbo_id) on delete cascade
);
-- At most one approved match per QuickBooks customer; several customers may map to one household.
create unique index if not exists qbo_customer_matches_one_approved on app.qbo_customer_matches (center_id, qbo_customer_id)
  where status = 'approved';
create unique index if not exists qbo_customer_matches_one_suggestion on app.qbo_customer_matches (center_id, qbo_customer_id, household_id)
  where status = 'suggested';
create index if not exists qbo_customer_matches_household_idx on app.qbo_customer_matches (household_id) where status = 'approved';
create index if not exists qbo_customer_matches_status_idx on app.qbo_customer_matches (center_id, status, confidence desc);

-- ── Module, audit, RLS ──────────────────────────────────────────────────────
insert into app.module_tables (table_name, module_key) values
  ('qbo_customers', 'accounting'), ('qbo_transactions', 'accounting'), ('qbo_customer_matches', 'accounting')
on conflict (table_name) do update set module_key = excluded.module_key;

drop trigger if exists audit_qbo_customers on app.qbo_customers;
create trigger audit_qbo_customers after insert or update or delete on app.qbo_customers
  for each row execute function app.audit_row('qbo_id');
drop trigger if exists audit_qbo_transactions on app.qbo_transactions;
create trigger audit_qbo_transactions after insert or update or delete on app.qbo_transactions
  for each row execute function app.audit_row('qbo_type', 'qbo_id');
drop trigger if exists audit_qbo_customer_matches on app.qbo_customer_matches;
create trigger audit_qbo_customer_matches after insert or update or delete on app.qbo_customer_matches
  for each row execute function app.audit_row();

do $$
declare t text; v_qual text := '(select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers(''accounting''))::uuid[]))';
begin
  foreach t in array array['qbo_customers','qbo_transactions','qbo_customer_matches'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format('drop policy if exists %1$s_read on app.%1$I', t);
    execute format('create policy %1$s_read on app.%1$I for select to authenticated
                      using (app.has_permission(center_id, ''accounting.manage'') or app.has_permission(center_id, ''giving.manage''))', t);
    execute format('drop policy if exists module_switch on app.%I', t);
    execute format('create policy module_switch on app.%I as restrictive for all to public using (%s) with check (%s)', t, v_qual, v_qual);
  end loop;
end $$;

revoke all on app.qbo_customers, app.qbo_transactions, app.qbo_customer_matches from public, anon, authenticated;
grant select on app.qbo_customers, app.qbo_transactions, app.qbo_customer_matches to authenticated;
grant all on app.qbo_customers, app.qbo_transactions, app.qbo_customer_matches to service_role;
