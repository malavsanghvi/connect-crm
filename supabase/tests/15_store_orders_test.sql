-- 0120 (stream w-events): store orders are priced by the database, take stock
-- and a pickup seat when they reach the kitchen, and give both back on cancel.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.assert_raises(stmt text, expect text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if position(lower(expect) in lower(sqlerrm)) = 0 then
    raise exception 'FAIL: % (got "%")', label, sqlerrm;
  end if;
  raise notice 'PASS: %', label;
end $$;
\set jsh '''00000000-0000-4000-8000-000000000001'''

-- Fixtures (superuser): a tracked item with stock, a pickup window with room for one order.
update app.store_items set track_inventory = true, stock_on_hand = 10, low_stock_threshold = 8, gift_pack = true where name = 'Kaju katli' and center_id = :jsh;
update app.centers set rules = jsonb_set(coalesce(rules, '{}'), '{store}', '{"gift_pack_cents": 299, "cancel_hours_before_pickup": 24}') where id = :jsh;
insert into app.pickup_windows (id, center_id, starts_at, ends_at, order_cutoff_at, capacity, status)
  values ('71000000-0000-4000-8000-000000000001', :jsh, now() + interval '3 days', now() + interval '3 days 2 hours', now() + interval '2 days', 1, 'open'),
         ('71000000-0000-4000-8000-000000000002', :jsh, now() + interval '10 hours', now() + interval '12 hours', now() + interval '5 hours', null, 'open');

-- Priya (adult of the Shah family) starts a cart with a tampered price.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
insert into app.store_orders (id, center_id, order_number, household_id, pickup_window_id, status, subtotal_cents, total_cents)
  values ('72000000-0000-4000-8000-000000000001', :jsh, null, '20000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'cart', 1, 1);
insert into app.store_order_lines (center_id, order_id, item_id, quantity, unit_price_cents, is_gift, line_total_cents)
  select :jsh, '72000000-0000-4000-8000-000000000001', id, 3, 1, true, 3 from app.store_items where name = 'Kaju katli' and center_id = :jsh;
select pg_temp.assert((select unit_price_cents = 999 and line_total_cents = 2997 from app.store_order_lines where order_id = '72000000-0000-4000-8000-000000000001'),
  'a member''s line is priced from the store item, not from the app');
update app.store_orders set status = 'placed' where id = '72000000-0000-4000-8000-000000000001';
select pg_temp.assert((select subtotal_cents = 2997 and gift_packing_cents = 897 and tax_cents = 0 and total_cents = 3894 and placed_at is not null
                         from app.store_orders where id = '72000000-0000-4000-8000-000000000001'),
  'placing the order recomputes subtotal, gift packing and total');
commit;
select pg_temp.assert((select stock_on_hand from app.store_items where name = 'Kaju katli' and center_id = :jsh) = 7,
  'placing the order takes 3 out of stock');
select pg_temp.assert((select reason = 'sold' and delta = -3 from app.inventory_movements where order_id = '72000000-0000-4000-8000-000000000001'),
  'a sold movement is linked to the order');
select pg_temp.assert((select orders_count from app.pickup_windows where id = '71000000-0000-4000-8000-000000000001') = 1,
  'the pickup window counts the order');
select pg_temp.assert((select module = 'store' and actor_user_id = '10000000-0000-4000-8000-000000000001'
                         from app.audit_log where record_table = 'inventory_movements' order by id desc limit 1),
  'the stock movement is audited with the member as the actor');

-- A full window, an empty cart and a cutoff that has passed are refused.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
insert into app.store_orders (id, center_id, order_number, household_id, pickup_window_id, status)
  values ('72000000-0000-4000-8000-000000000002', :jsh, null, '20000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'cart');
select pg_temp.assert_raises($$update app.store_orders set status = 'placed' where id = '72000000-0000-4000-8000-000000000002'$$,
  'order is empty', 'an empty cart cannot be placed');
insert into app.store_order_lines (center_id, order_id, item_id, quantity, unit_price_cents, line_total_cents)
  select :jsh, '72000000-0000-4000-8000-000000000002', id, 1, 0, 0 from app.store_items where name = 'Chakri' and center_id = :jsh;
select pg_temp.assert_raises($$update app.store_orders set status = 'placed' where id = '72000000-0000-4000-8000-000000000002'$$,
  'pickup time is full', 'a full pickup window refuses more orders');
commit;

-- Cancelling: the member's own order, inside the window; stock and the seat come back.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000007';
select pg_temp.assert_raises($$select app.cancel_my_store_order('72000000-0000-4000-8000-000000000001')$$,
  'Only an adult of the family', 'someone outside the family cannot cancel the order');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select app.cancel_my_store_order('72000000-0000-4000-8000-000000000001', 'Plans changed');
commit;
select pg_temp.assert((select status = 'cancelled' and cancelled_at is not null from app.store_orders where id = '72000000-0000-4000-8000-000000000001'),
  'the member cancelled her order');
select pg_temp.assert((select stock_on_hand from app.store_items where name = 'Kaju katli' and center_id = :jsh) = 10,
  'cancelling puts the stock back');
select pg_temp.assert((select orders_count from app.pickup_windows where id = '71000000-0000-4000-8000-000000000001') = 0,
  'cancelling frees the pickup seat');
select pg_temp.assert((select reason from app.audit_log where record_table = 'store_orders' and record_id = '72000000-0000-4000-8000-000000000001'
                        order by id desc limit 1) = 'Plans changed',
  'the cancellation reason is on the audit entry');

-- Too close to pickup (the 10-hour window, 24-hour rule): refused.
update app.store_orders set pickup_window_id = '71000000-0000-4000-8000-000000000002', status = 'placed'
 where id = '72000000-0000-4000-8000-000000000002';
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select pg_temp.assert_raises($$select app.cancel_my_store_order('72000000-0000-4000-8000-000000000002')$$,
  'up to 24 hours before pickup', 'an order inside the cancellation window cannot be cancelled in the app');
commit;

-- Store switched off: the RPC refuses.
insert into app.center_modules (center_id, module_key, enabled, reason) values (:jsh, 'store', false, 'test');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select pg_temp.assert_raises($$select app.cancel_my_store_order('72000000-0000-4000-8000-000000000002')$$,
  'switched off', 'cancel_my_store_order refuses while the Store is off');
commit;
delete from app.center_modules where center_id = :jsh and module_key = 'store';
