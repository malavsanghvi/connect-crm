-- 0670: app.store_sales_summary, the store's sales for a period, added up in the database (BACKLOG B90 phase 4, Store).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   "How much did the store sell last week?" is a sum. The sum belongs in the database (docs/ADMIN_REDESIGN.md, Reports: "sums done in
--   the database"), not in page code that reads thousands of orders and adds them up. This function answers it in one call: the
--   number of orders, the units, the subtotal, gift packing, tax and total in integer cents, the orders by status, and the five items
--   that sold most. It never formats dollars; the command does that from the cents.
--
--   An order counts as a sale when it was placed in the period (the day it was placed, in the community's own time zone, from
--   p_from to p_to inclusive) and is placed, preparing, ready or picked up: the same four states the Orders by pickup screen counts as
--   active. A cancelled or refunded order is NOT a sale; they are reported next to the sales (how many, and how much) so nobody
--   mistakes a quiet week for a refunded one. A cart that was never placed has no placed_at and is never counted.
--
-- WHAT IT DOES NOT DO
--   * It changes nothing: no table, column, policy or permission. STABLE, SECURITY INVOKER (the default): row-level security applies, so
--     it only adds up orders the caller may read. It answers null unless the caller holds store.view or store.manage (a pickup
--     volunteer, who holds only store.pickup, gets null and is told so by the command, never a total of zero).
--   * It never returns a name, a phone number, a household or a person: totals and item names only.
--   * Refunds are not made here or anywhere in the command layer. A refunded order is only counted.
-- Hosted Supabase: search_path = app, public, extensions.
set client_min_messages = warning;

create or replace function app.store_sales_summary(p_center uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security invoker set search_path = app, public, extensions as $$
declare
  v_tz text;
  v_out jsonb;
begin
  if p_center is null or p_from is null or p_to is null or p_to < p_from then return null; end if;
  if not (app.has_permission(p_center, 'store.view') or app.has_permission(p_center, 'store.manage')) then return null; end if;

  select coalesce(nullif(c.time_zone, ''), 'UTC') into v_tz from app.centers c where c.id = p_center;
  v_tz := coalesce(v_tz, 'UTC');

  with o as (
    select so.id, so.status, so.subtotal_cents, so.gift_packing_cents, so.tax_cents, so.total_cents
      from app.store_orders so
     where so.center_id = p_center
       and so.placed_at is not null
       and (so.placed_at at time zone v_tz)::date between p_from and p_to
  ), sold as (
    select * from o where status in ('placed', 'preparing', 'ready', 'picked_up')
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'orders', (select count(*) from sold),
    'units', (select coalesce(sum(l.quantity), 0) from app.store_order_lines l join sold s on s.id = l.order_id),
    'subtotal_cents', (select coalesce(sum(subtotal_cents), 0) from sold),
    'gift_packing_cents', (select coalesce(sum(gift_packing_cents), 0) from sold),
    'tax_cents', (select coalesce(sum(tax_cents), 0) from sold),
    'total_cents', (select coalesce(sum(total_cents), 0) from sold),
    'by_status', (select coalesce(jsonb_object_agg(t.status, t.n), '{}'::jsonb)
                    from (select status, count(*) as n from o group by status) t),
    'cancelled_orders', (select count(*) from o where status = 'cancelled'),
    'refunded_orders', (select count(*) from o where status = 'refunded'),
    'refunded_cents', (select coalesce(sum(total_cents), 0) from o where status = 'refunded'),
    'top_items', (select coalesce(jsonb_agg(jsonb_build_object('item_id', t.item_id, 'name', t.name, 'units', t.units, 'cents', t.cents)
                                           order by t.units desc, t.cents desc, t.name), '[]'::jsonb)
                    from (select l.item_id, i.name, sum(l.quantity) as units, sum(l.line_total_cents) as cents
                            from app.store_order_lines l
                            join sold s on s.id = l.order_id
                            join app.store_items i on i.id = l.item_id
                           group by l.item_id, i.name
                           order by sum(l.quantity) desc, sum(l.line_total_cents) desc, i.name
                           limit 5) t)
  ) into v_out;

  return v_out;
end $$;

revoke execute on function app.store_sales_summary(uuid, date, date) from public, anon;
grant execute on function app.store_sales_summary(uuid, date, date) to authenticated, service_role;

comment on function app.store_sales_summary(uuid, date, date) is
  'The store''s sales between two days (the community''s own time zone): orders, units, subtotal, gift packing, tax and total in integer cents, orders by status, cancelled and refunded counted apart, and the five top items. Security invoker; null without store.view or store.manage (0670).';
