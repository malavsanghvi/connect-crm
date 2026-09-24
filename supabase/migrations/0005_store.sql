-- 0005_store.sql
-- Satvik Store: sales, not giving. Separate ledger, sales tax, kitchen workflow.

create table app.store_categories (
  id         uuid primary key default gen_random_uuid(),
  center_id  uuid not null references app.centers(id) on delete cascade,
  name       text not null,
  sort_order integer not null default 0,
  unique (center_id, name)
);

create table app.store_items (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  category_id   uuid references app.store_categories(id) on delete set null,
  sku           text,
  name          text not null,
  description   text,
  photo_path    text,
  price_cents   integer not null check (price_cents >= 0),
  pack_size     text,
  taxable       boolean not null default true,
  track_inventory boolean not null default false,
  stock_on_hand integer not null default 0,
  low_stock_threshold integer,
  status        text not null default 'active' check (status in ('active','paused','retired')),
  qbo_item_id   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (center_id, sku)
);
create index on app.store_items (center_id, status);
create trigger touch_store_items before update on app.store_items for each row execute function app.touch_updated_at();

create table app.pickup_windows (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  event_id     uuid references app.events(id) on delete set null,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  order_cutoff_at timestamptz not null,
  capacity     integer,
  orders_count integer not null default 0,
  location     text,
  status       text not null default 'open' check (status in ('open','closed','fulfilled'))
);
create index on app.pickup_windows (center_id, starts_at);

create table app.store_orders (
  id             uuid primary key default gen_random_uuid(),
  center_id      uuid not null references app.centers(id) on delete cascade,
  order_number   text not null,
  household_id   uuid references app.households(id),
  person_id      uuid references app.people(id),
  guest_name     text,
  guest_phone_e164 text,
  pickup_window_id uuid references app.pickup_windows(id),
  subtotal_cents integer not null default 0,
  gift_packing_cents integer not null default 0,
  tax_cents      integer not null default 0,
  total_cents    integer not null default 0,
  payment_id     uuid references app.payments(id),
  status         text not null default 'placed' check (status in ('cart','placed','preparing','ready','picked_up','cancelled','refunded')),
  gift_message   text,
  notes          text,
  placed_at      timestamptz,
  ready_at       timestamptz,
  picked_up_at   timestamptz,
  picked_up_by   uuid references auth.users(id),
  cancelled_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (center_id, order_number)
);
create index on app.store_orders (center_id, pickup_window_id, status);
create index on app.store_orders (center_id, household_id);
create trigger touch_store_orders before update on app.store_orders for each row execute function app.touch_updated_at();

create table app.store_order_lines (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  order_id    uuid not null references app.store_orders(id) on delete cascade,
  item_id     uuid not null references app.store_items(id),
  quantity    integer not null check (quantity > 0),
  unit_price_cents integer not null,
  is_gift     boolean not null default false,
  line_total_cents integer not null
);
create index on app.store_order_lines (order_id);

create table app.inventory_movements (
  id          bigint generated always as identity primary key,
  center_id   uuid not null references app.centers(id) on delete cascade,
  item_id     uuid not null references app.store_items(id),
  delta       integer not null,
  reason      text not null check (reason in ('received','sold','waste','adjustment','returned')),
  order_id    uuid references app.store_orders(id),
  recorded_by uuid references auth.users(id),
  recorded_at timestamptz not null default now()
);
create index on app.inventory_movements (center_id, item_id, recorded_at desc);
