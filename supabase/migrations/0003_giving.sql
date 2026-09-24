-- 0003_giving.sql
-- Campaigns, opportunities, pledges, payments, allocation, recurring gifts,
-- receipts, bolis. The platform is the donor record; QuickBooks is the
-- accounting record (see 0009_integrations.sql and docs/ACCOUNTING_QBO.md).

create type app.pledge_source as enum (
  'rsvp_commitment','boli','sponsorship','pujan','labh','construction',
  'membership_fee','pathshala_fee','general','recurring','store','other'
);
create type app.pledge_status as enum ('open','partially_paid','paid','written_off','cancelled');
create type app.payment_method as enum (
  'card','ach','apple_pay','google_pay','check','cash','stock','daf','matching_gift','zelle','other'
);
create type app.payment_status as enum (
  'authorized','captured','pending_clearing','settled','refunded','partially_refunded','failed','voided'
);

create table app.funds (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  key         text not null,                  -- 'general','construction','pathshala','jeevdaya'
  name        text not null,
  restricted  boolean not null default false,
  qbo_class_id text,
  active      boolean not null default true,
  unique (center_id, key)
);

create table app.campaigns (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  fund_id      uuid references app.funds(id),
  name         text not null,
  kind         text not null check (kind in ('general','boli','sponsorship','construction','pathshala','event','membership','store','other')),
  description  text,
  goal_cents   bigint,
  starts_on    date,
  ends_on      date,
  status       text not null default 'draft' check (status in ('draft','published','closed','archived')),
  qbo_income_account_id text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on app.campaigns (center_id, status);
create trigger touch_campaigns before update on app.campaigns for each row execute function app.touch_updated_at();

-- A giving opportunity: sponsorship tier, fixed pujan, construction amount, open amount
create table app.opportunities (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  campaign_id   uuid not null references app.campaigns(id) on delete cascade,
  event_id      uuid,                          -- fk added in 0005
  name          text not null,
  description   text,
  amount_cents  bigint,                        -- null = open amount
  min_amount_cents bigint,
  quantity_available integer,                  -- null = unlimited (e.g. 50 families for a pujan)
  quantity_taken integer not null default 0,
  allow_anonymous boolean not null default true,
  recognition   text,                          -- plaque text rules etc.
  sort_order    integer not null default 0,
  status        text not null default 'open' check (status in ('draft','open','taken','closed')),
  created_at    timestamptz not null default now()
);
create index on app.opportunities (center_id, campaign_id);

create table app.pledges (
  id              uuid primary key default gen_random_uuid(),
  center_id       uuid not null references app.centers(id) on delete cascade,
  household_id    uuid not null references app.households(id),
  pledged_by_person_id uuid references app.people(id),
  campaign_id     uuid references app.campaigns(id),
  opportunity_id  uuid references app.opportunities(id),
  fund_id         uuid references app.funds(id),
  source          app.pledge_source not null default 'general',
  source_ref_id   uuid,                        -- rsvp id, boli id, special day id, membership id ...
  amount_cents    bigint not null check (amount_cents > 0),
  paid_cents      bigint not null default 0,
  status          app.pledge_status not null default 'open',
  dedication      text,
  anonymous       boolean not null default false,
  recognition_name text,
  due_on          date,
  installments    integer,
  pledged_at      timestamptz not null default now(),
  closed_at       timestamptz,
  written_off_by  uuid references auth.users(id),
  written_off_second_approver uuid references auth.users(id),
  write_off_reason text,
  crm_external_id text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on app.pledges (center_id, household_id, status);
create index on app.pledges (center_id, campaign_id);
create index on app.pledges (center_id, status, pledged_at);
create trigger touch_pledges before update on app.pledges for each row execute function app.touch_updated_at();

alter table app.memberships
  add constraint memberships_fee_pledge_fk foreign key (fee_pledge_id) references app.pledges(id);

create table app.payments (
  id              uuid primary key default gen_random_uuid(),
  center_id       uuid not null references app.centers(id) on delete cascade,
  household_id    uuid not null references app.households(id),
  payer_person_id uuid references app.people(id),
  amount_cents    bigint not null check (amount_cents > 0),
  fee_cents       bigint not null default 0,          -- processor fee
  donor_covered_fee_cents bigint not null default 0,
  method          app.payment_method not null,
  status          app.payment_status not null default 'captured',
  provider        text,                               -- 'stripe' | 'offline'
  provider_ref    text,                               -- payment intent / charge id
  provider_payout_ref text,
  check_number    text,
  envelope_number text,                               -- event-day cash/check envelopes
  received_on     date not null default current_date,
  recorded_by     uuid references auth.users(id),
  counted_by      uuid[] not null default '{}',       -- two-volunteer sign-off for cash
  receipt_number  text,
  receipt_name    text,                               -- payer by default, joint on request
  joint_receipt   boolean not null default false,
  receipt_sent_at timestamptz,
  memo            text,
  refunded_cents  bigint not null default 0,
  refund_approved_by uuid references auth.users(id),
  refund_second_approver uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (center_id, provider, provider_ref)
);
create index on app.payments (center_id, household_id, received_on desc);
create index on app.payments (center_id, status);
create trigger touch_payments before update on app.payments for each row execute function app.touch_updated_at();

-- A payment settles one or more pledges (earliest open first unless the
-- donor chose; overpayment rolls to the next earliest open pledge).
create table app.payment_allocations (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  payment_id  uuid not null references app.payments(id) on delete cascade,
  pledge_id   uuid not null references app.pledges(id),
  amount_cents bigint not null check (amount_cents > 0),
  chosen_by_donor boolean not null default false,
  created_at  timestamptz not null default now()
);
create index on app.payment_allocations (payment_id);
create index on app.payment_allocations (pledge_id);

create table app.recurring_gifts (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  household_id  uuid not null references app.households(id),
  person_id     uuid references app.people(id),
  campaign_id   uuid references app.campaigns(id),
  fund_id       uuid references app.funds(id),
  amount_cents  bigint not null check (amount_cents > 0),
  frequency     text not null check (frequency in ('weekly','monthly','quarterly','yearly','special_day')),
  special_day_id uuid,                                -- yearly gift on a family special day (fk in 0007)
  method        app.payment_method not null default 'card',
  provider_ref  text,                                 -- subscription id
  next_charge_on date,
  status        text not null default 'active' check (status in ('active','paused','cancelled','failed')),
  links_to_pledges boolean not null default false,   -- never auto-closes pledges unless donor links
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on app.recurring_gifts (center_id, household_id);
create trigger touch_recurring before update on app.recurring_gifts for each row execute function app.touch_updated_at();

-- Year-end / pledge / donation statements
create table app.statements (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  household_id uuid not null references app.households(id),
  kind         text not null check (kind in ('tax_year','pledge','donation','event')),
  tax_year     integer,
  storage_path text,
  generated_at timestamptz not null default now(),
  generated_by uuid references auth.users(id)
);
create index on app.statements (center_id, household_id, tax_year);

-- ---------------------------------------------------------------------------
-- Bolis (digital and in-person)
-- ---------------------------------------------------------------------------
create table app.bolis (
  id             uuid primary key default gen_random_uuid(),
  center_id      uuid not null references app.centers(id) on delete cascade,
  event_id       uuid,                                -- fk in 0005
  campaign_id    uuid references app.campaigns(id),
  name           text not null,
  description    text,
  kind           text not null check (kind in ('digital','in_person')),
  floor_cents    bigint not null default 0,
  step_cents     bigint not null default 10100,
  opens_at       timestamptz,
  closes_at      timestamptz,
  soft_close_minutes integer not null default 0,       -- anti-sniping extension
  extended_until timestamptz,
  status         text not null default 'draft' check (status in ('draft','open','paused','closed','settled')),
  explainer_md   text,
  explainer_video_url text,
  winner_entry_id uuid,
  winner_pledge_id uuid references app.pledges(id),
  keep_all_entries boolean not null default true,     -- center accommodates all interested families
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on app.bolis (center_id, status, closes_at);
create trigger touch_bolis before update on app.bolis for each row execute function app.touch_updated_at();

create table app.boli_entries (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  boli_id      uuid not null references app.bolis(id) on delete cascade,
  household_id uuid not null references app.households(id),
  person_id    uuid references app.people(id),
  amount_cents bigint not null check (amount_cents > 0),
  entered_by   uuid references auth.users(id),         -- volunteer for in-person
  is_in_person boolean not null default false,
  display_name text,
  anonymous    boolean not null default false,
  entered_at   timestamptz not null default now(),
  pledge_id    uuid references app.pledges(id)         -- every entry kept; each may become a pledge
);
create index on app.boli_entries (boli_id, amount_cents desc, entered_at);
alter table app.bolis add constraint bolis_winner_entry_fk foreign key (winner_entry_id) references app.boli_entries(id);

-- Bhandar / offering counting sessions and valuables register
create table app.counting_sessions (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  kind         text not null check (kind in ('bhandar','event_envelopes','other')),
  event_id     uuid,
  counted_on   date not null default current_date,
  counters     uuid[] not null,                        -- >= 2 people from different households
  totals_by_denomination jsonb not null default '{}'::jsonb,
  total_cents  bigint not null default 0,
  bag_numbers  text[] not null default '{}',
  deposit_ref  text,
  payment_id   uuid references app.payments(id),       -- posted as anonymous general donation
  notes        text,
  created_at   timestamptz not null default now()
);

create table app.valuables_register (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  counting_session_id uuid references app.counting_sessions(id),
  description  text not null,
  kind         text not null check (kind in ('gold','silver','jewelry','other')),
  weight_grams numeric,
  photo_paths  text[] not null default '{}',
  custody_log  jsonb not null default '[]'::jsonb,     -- [{who, when, action}]
  disposition  text,
  created_at   timestamptz not null default now()
);

-- Pledge status maintenance
create or replace function app.recompute_pledge_status(p_pledge uuid) returns void
language plpgsql security definer set search_path = app, public as $$
declare v_paid bigint; v_amount bigint; v_status app.pledge_status;
begin
  select coalesce(sum(amount_cents),0) into v_paid from app.payment_allocations where pledge_id = p_pledge;
  select amount_cents, status into v_amount, v_status from app.pledges where id = p_pledge;
  if v_status in ('written_off','cancelled') then return; end if;
  update app.pledges set paid_cents = v_paid,
    status = (case when v_paid >= v_amount then 'paid' when v_paid > 0 then 'partially_paid' else 'open' end)::app.pledge_status,
    closed_at = case when v_paid >= v_amount then coalesce(closed_at, now()) else null end
  where id = p_pledge;
end $$;

create or replace function app.on_allocation_change() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  perform app.recompute_pledge_status(coalesce(new.pledge_id, old.pledge_id));
  return coalesce(new, old);
end $$;
create trigger allocation_recompute after insert or update or delete on app.payment_allocations
  for each row execute function app.on_allocation_change();

-- Allocation preview/apply: earliest open pledge first, overpayment rolls on,
-- partial keeps the pledge open. Returns the rows it would (or did) create.
create or replace function app.allocate_payment(p_payment uuid, p_pledge_ids uuid[] default null, p_apply boolean default false)
returns table (pledge_id uuid, amount_cents bigint)
language plpgsql security definer set search_path = app, public as $$
#variable_conflict use_column
declare v_center uuid; v_household uuid; v_remaining bigint; r record; v_take bigint;
begin
  select center_id, household_id, amount_cents - coalesce((select sum(a.amount_cents) from app.payment_allocations a where a.payment_id = p_payment),0)
    into v_center, v_household, v_remaining from app.payments where id = p_payment;
  if v_remaining is null or v_remaining <= 0 then return; end if;
  for r in
    select p.id, p.amount_cents - p.paid_cents as open_cents
    from app.pledges p
    where p.center_id = v_center and p.household_id = v_household
      and p.status in ('open','partially_paid')
      and (p_pledge_ids is null or p.id = any(p_pledge_ids))
    order by case when p_pledge_ids is not null then array_position(p_pledge_ids, p.id) end, p.pledged_at
  loop
    exit when v_remaining <= 0;
    v_take := least(r.open_cents, v_remaining);
    if v_take > 0 then
      pledge_id := r.id; amount_cents := v_take;
      if p_apply then
        insert into app.payment_allocations (center_id, payment_id, pledge_id, amount_cents, chosen_by_donor)
        values (v_center, p_payment, r.id, v_take, p_pledge_ids is not null);
      end if;
      return next;
      v_remaining := v_remaining - v_take;
    end if;
  end loop;
end $$;
