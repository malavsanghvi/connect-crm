-- Wave 3 (stream w-events) · Satvik Store: an order that reaches the kitchen
-- is priced by the database, takes a pickup seat, and takes its items out of
-- stock; a cancelled order gives both back.
--
-- Before this, a member's order was priced in the app (unit price, subtotal,
-- gift packing and total were whatever the client sent), pickup_windows.
-- orders_count never moved (so a full window stayed on sale), and placing an
-- order never touched inventory (so low-stock alerts could not fire from sales).
--
-- 1. store_order_lines: unit_price_cents comes from store_items.price_cents and
--    line_total_cents = quantity × unit price, for everyone but store managers
--    (who may price by hand, e.g. a discounted counter sale). A gift-packed line
--    needs an item that offers gift packing, and the item must be on sale.
-- 2. store_orders, cart → placed (or any kitchen status): the totals are
--    recomputed from the lines (gift packing at centers.rules.store.gift_pack_cents
--    per gift unit; sales tax is added at pickup, so a member order carries 0),
--    the window must be open, before its cutoff and not full, and the order must
--    have lines. Then: one 'sold' inventory movement per tracked item (the
--    existing inventory_apply trigger moves stock_on_hand) and orders_count + 1.
-- 3. placed/preparing/ready → cancelled/refunded: one 'returned' movement per
--    item for what this order took out (net of earlier returns) and
--    orders_count − 1.
--
-- No table, policy or permission changes. The functions are trigger functions
-- (their tables are already module-gated), so they do not call
-- assert_module_enabled. Movements and window counts are written as the
-- definer because members cannot write them; the audit trigger still records
-- the member as the actor (auth.uid()) with the request's app and screen.

create or replace function app.store_price_order_line()
returns trigger language plpgsql security definer set search_path = app, public, extensions as $$
declare i app.store_items;
begin
  select * into i from app.store_items where id = new.item_id;
  if i.id is null then raise exception 'That item is no longer in the store.'; end if;
  if auth.uid() is not null and not app.has_permission(new.center_id, 'store.manage') then
    if i.status <> 'active' then
      raise exception '% is not on sale right now.', i.name using hint = 'Remove it from your order and try again.';
    end if;
    if new.is_gift and not i.gift_pack then
      raise exception '% cannot be gift packed.', i.name;
    end if;
    new.unit_price_cents := i.price_cents;
  end if;
  if new.quantity is null or new.quantity < 1 then raise exception 'Each item needs a quantity of at least 1.'; end if;
  new.line_total_cents := new.quantity * new.unit_price_cents;
  return new;
end $$;

drop trigger if exists price_store_order_lines on app.store_order_lines;
create trigger price_store_order_lines before insert or update of item_id, quantity, unit_price_cents, is_gift
  on app.store_order_lines for each row execute function app.store_price_order_line();

create or replace function app.store_order_transition()
returns trigger language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_kitchen constant text[] := array['placed', 'preparing', 'ready', 'picked_up'];
  v_gift int; v_subtotal int; v_gift_units int; v_lines int; w app.pickup_windows;
  v_staff boolean := auth.uid() is null or app.has_permission(new.center_id, 'store.manage');
begin
  -- Leaving the cart: this is when the order reaches the kitchen.
  if new.status = any (v_kitchen) and (tg_op = 'INSERT' or old.status = 'cart') then
    select count(*), coalesce(sum(line_total_cents), 0), coalesce(sum(quantity) filter (where is_gift), 0)
      into v_lines, v_subtotal, v_gift_units
      from app.store_order_lines where order_id = new.id;
    -- A member order always starts as a cart (lines can only be added to a cart).
    if v_lines = 0 and (tg_op = 'UPDATE' or not v_staff) then
      raise exception 'Your order is empty.' using hint = 'Add an item, then place the order.';
    end if;
    if v_lines > 0 then
      select coalesce((rules #>> '{store,gift_pack_cents}')::int, 0) into v_gift from app.centers where id = new.center_id;
      new.subtotal_cents := v_subtotal;
      new.gift_packing_cents := v_gift_units * v_gift;
      if not v_staff then new.tax_cents := 0; end if;
      new.total_cents := new.subtotal_cents + new.gift_packing_cents + new.tax_cents;
    end if;
    if new.pickup_window_id is not null then
      select * into w from app.pickup_windows where id = new.pickup_window_id for update;
      if not v_staff then
        if w.id is null or w.status <> 'open' then
          raise exception 'That pickup time is no longer open.' using hint = 'Choose another pickup time.';
        end if;
        if w.order_cutoff_at is not null and w.order_cutoff_at <= now() then
          raise exception 'Orders for that pickup time closed at the cutoff.' using hint = 'Choose a later pickup time.';
        end if;
        if w.capacity is not null and w.orders_count >= w.capacity then
          raise exception 'That pickup time is full.' using hint = 'Choose another pickup time.';
        end if;
      end if;
      update app.pickup_windows set orders_count = orders_count + 1 where id = new.pickup_window_id;
    end if;
    if new.placed_at is null then new.placed_at := now(); end if;
  end if;
  if tg_op = 'UPDATE' and new.status = 'cancelled' and old.status <> 'cancelled' and new.cancelled_at is null then
    new.cancelled_at := now();
  end if;
  return new;
end $$;

drop trigger if exists store_order_transition on app.store_orders;
create trigger store_order_transition before insert or update of status on app.store_orders
  for each row execute function app.store_order_transition();

-- Stock moves AFTER the row is written (inventory_movements.order_id references it).
create or replace function app.store_order_inventory()
returns trigger language plpgsql security definer set search_path = app, public, extensions as $$
declare v_kitchen constant text[] := array['placed', 'preparing', 'ready', 'picked_up'];
begin
  if new.status = any (v_kitchen) and (tg_op = 'INSERT' or old.status = 'cart') then
    insert into app.inventory_movements (center_id, item_id, delta, reason, order_id, recorded_by)
    select new.center_id, l.item_id, -sum(l.quantity)::int, 'sold', new.id, auth.uid()
      from app.store_order_lines l
      join app.store_items i on i.id = l.item_id and i.track_inventory
     where l.order_id = new.id
     group by l.item_id;
  elsif tg_op = 'UPDATE' and new.status in ('cancelled', 'refunded') and old.status in ('placed', 'preparing', 'ready') then
    insert into app.inventory_movements (center_id, item_id, delta, reason, order_id, recorded_by)
    select new.center_id, m.item_id, -sum(m.delta)::int, 'returned', new.id, auth.uid()
      from app.inventory_movements m
     where m.order_id = new.id
     group by m.item_id
    having sum(m.delta) < 0;
    if new.pickup_window_id is not null then
      update app.pickup_windows set orders_count = greatest(orders_count - 1, 0) where id = new.pickup_window_id;
    end if;
  end if;
  return null;
end $$;

drop trigger if exists store_order_inventory on app.store_orders;
create trigger store_order_inventory after insert or update of status on app.store_orders
  for each row execute function app.store_order_inventory();

-- A line added to an order that is already with the kitchen (a store manager
-- adding to a placed order) takes its stock too.
create or replace function app.store_line_inventory()
returns trigger language plpgsql security definer set search_path = app, public, extensions as $$
declare o app.store_orders;
begin
  select * into o from app.store_orders where id = new.order_id;
  if o.status in ('placed', 'preparing', 'ready', 'picked_up')
     and exists (select 1 from app.store_items i where i.id = new.item_id and i.track_inventory) then
    insert into app.inventory_movements (center_id, item_id, delta, reason, order_id, recorded_by)
    values (o.center_id, new.item_id, -new.quantity, 'sold', o.id, auth.uid());
  end if;
  return null;
end $$;

drop trigger if exists store_line_inventory on app.store_order_lines;
create trigger store_line_inventory after insert on app.store_order_lines
  for each row execute function app.store_line_inventory();

-- Bring existing windows' counts in line with the orders already placed.
update app.pickup_windows w
   set orders_count = (select count(*) from app.store_orders o
                        where o.pickup_window_id = w.id and o.status in ('placed', 'preparing', 'ready', 'picked_up'));

-- 4. A member cancels their own order ("cancel up to N hours before pickup",
--    centers.rules.store.cancel_hours_before_pickup, default 24). Members cannot
--    update a placed order through RLS, so this is the only way; the cutoff is
--    checked here, not in the app. Nothing was charged (pay at pickup), so no
--    money moves; a paid order must be refunded by the store (money rules).
create or replace function app.cancel_my_store_order(p_order uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
declare o app.store_orders; w app.pickup_windows; v_hours int;
begin
  select * into o from app.store_orders where id = p_order for update;
  if o.id is null then raise exception 'That order was not found.'; end if;
  perform app.assert_module_enabled(o.center_id, 'store');
  if o.household_id is null or not app.adult_of_household(o.center_id, o.household_id) then
    raise exception 'Only an adult of the family that placed this order can cancel it.';
  end if;
  if o.status not in ('placed', 'preparing') then
    raise exception 'This order can no longer be cancelled (it is %).', replace(o.status, '_', ' ')
      using hint = 'Please call the store.';
  end if;
  if o.payment_id is not null then
    raise exception 'This order was paid online, so the store has to refund it.' using hint = 'Please call the store.';
  end if;
  select coalesce((rules #>> '{store,cancel_hours_before_pickup}')::int, 24) into v_hours from app.centers where id = o.center_id;
  select * into w from app.pickup_windows where id = o.pickup_window_id;
  if w.starts_at is not null and now() > w.starts_at - make_interval(hours => v_hours) then
    raise exception 'Orders can be cancelled up to % hours before pickup.', v_hours using hint = 'Please call the store.';
  end if;
  perform app.set_audit_context(coalesce(nullif(trim(p_reason), ''), 'Member cancelled the order in the app'));
  update app.store_orders set status = 'cancelled' where id = p_order;
end $$;
revoke all on function app.cancel_my_store_order(uuid, text) from public, anon;
grant execute on function app.cancel_my_store_order(uuid, text) to authenticated;
