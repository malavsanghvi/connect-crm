-- 0670: app.store_sales_summary, the store's sales for a period added up in the database (B90 phase 4, Store); and
-- 0671: the fourteen Content and Store commands in the activity allowlist.
--   A. A month's sales: orders, units, subtotal, gift packing, tax and total in integer cents; the day is the community's own day
--      (an order placed at 11:30 pm local on the last day counts, one at 00:30 the next day does not); a cancelled order and a
--      refunded order are not sales and are counted apart; a cart that was never placed and another community's order are not counted.
--   B. The five top items by units; the orders by status; an empty period is zeros and an empty list, not null.
--   C. Who may read: a store lead and a read-only viewer read it; a pickup volunteer (store.pickup only), someone with no store
--      permission, a person of another community, a missing community and a backwards period get null.
--   D. No name, phone or household in the answer. Security invoker; signed-in people only.
--   E. 0671: every Content and Store command is a portal action under assistant.<area>_<verb> with its command and a plain label; the
--      commands of earlier migrations are untouched; running the migration again changes nothing.
-- Everything runs as the signed-in person (row-level security) and in one transaction that is not committed.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.sign_in(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.keep(p_name text, p_j jsonb) returns void language plpgsql as $$
begin perform set_config('t127.' || p_name, coalesce(p_j::text, 'null'), true); end $$;
create or replace function pg_temp.got(p_name text) returns jsonb language sql stable as $$ select current_setting('t127.' || p_name)::jsonb $$;

\set c '''27000000-0000-4000-8000-0000000000c1'''
\set c2 '''27000000-0000-4000-8000-0000000000c2'''
\set u_lead '''27000000-0000-4000-8000-0000000000a1'''
\set u_viewer '''27000000-0000-4000-8000-0000000000a2'''
\set u_pickup '''27000000-0000-4000-8000-0000000000a3'''
\set u_nobody '''27000000-0000-4000-8000-0000000000a4'''
\set u_other '''27000000-0000-4000-8000-0000000000a5'''
\set i_samosa '''27000000-0000-4000-8000-0000000000b1'''
\set i_jar '''27000000-0000-4000-8000-0000000000b2'''
\set i_other '''27000000-0000-4000-8000-0000000000b3'''
\set o1 '''27000000-0000-4000-8000-0000000000d1'''
\set o2 '''27000000-0000-4000-8000-0000000000d2'''
\set o3 '''27000000-0000-4000-8000-0000000000d3'''
\set o4 '''27000000-0000-4000-8000-0000000000d4'''
\set o5 '''27000000-0000-4000-8000-0000000000d5'''
\set o6 '''27000000-0000-4000-8000-0000000000d6'''
\set o7 '''27000000-0000-4000-8000-0000000000d7'''
\set o8 '''27000000-0000-4000-8000-0000000000d8'''
\set o9 '''27000000-0000-4000-8000-0000000000d9'''
\set h1 '''27000000-0000-4000-8000-0000000000e1'''

-- ── Fixtures ─────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  (:u_lead, 'lead127@example.com'), (:u_viewer, 'viewer127@example.com'), (:u_pickup, 'pickup127@example.com'),
  (:u_nobody, 'nobody127@example.com'), (:u_other, 'other127@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:c, 'st127', 'Store Center', 'STC', 'TX', 'active', 'America/Chicago'),
  (:c2, 'st127b', 'Other Store Center', 'OSC', 'TX', 'active', 'America/Chicago');
insert into app.role_grants (center_id, user_id, role_key, scope_kind) values
  (:c, :u_lead, 'store_lead', 'center'), (:c, :u_viewer, 'executive_viewer', 'center'),
  (:c, :u_pickup, 'store_pickup', 'center'), (:c2, :u_other, 'center_admin', 'center');
insert into app.households (id, center_id, display_name) values (:h1, :c, 'Orderer household 127');

insert into app.store_items (id, center_id, name, price_cents, track_inventory, status) values
  (:i_samosa, :c, 'Samosa pack', 800, false, 'active'),
  (:i_jar, :c, 'Gift jar', 1200, false, 'active'),
  (:i_other, :c2, 'Other item', 500, false, 'active');

-- Local times are America/Chicago (UTC-5 in September). Sold: o1, o2, o3, o6. Not sold: o4 (cancelled), o5 (refunded), o8 (a cart),
-- o7 (placed after midnight of 30 September local time, so in October), o9 (another community).
insert into app.store_orders (id, center_id, order_number, household_id, guest_name, guest_phone_e164, status, subtotal_cents, gift_packing_cents, tax_cents, total_cents, placed_at) values
  (:o1, :c, 'T127-01', :h1, 'Guest Name 127', '+15125550127', 'picked_up', 1600, 0, 120, 1720, '2026-09-10 17:00:00+00'),
  (:o2, :c, 'T127-02', null, null, null, 'ready', 1200, 250, 0, 1450, '2026-09-15 17:00:00+00'),
  (:o3, :c, 'T127-03', null, null, null, 'placed', 1600, 0, 0, 1600, '2026-09-20 17:00:00+00'),
  (:o4, :c, 'T127-04', null, null, null, 'cancelled', 800, 0, 0, 800, '2026-09-12 17:00:00+00'),
  (:o5, :c, 'T127-05', null, null, null, 'refunded', 2400, 0, 0, 2400, '2026-09-13 17:00:00+00'),
  (:o6, :c, 'T127-06', null, null, null, 'placed', 800, 0, 0, 800, '2026-10-01 04:30:00+00'),
  (:o7, :c, 'T127-07', null, null, null, 'placed', 500, 0, 0, 500, '2026-10-01 05:30:00+00'),
  (:o8, :c, 'T127-08', null, null, null, 'cart', 900, 0, 0, 900, null),
  (:o9, :c2, 'T127-09', null, null, null, 'placed', 700, 0, 0, 700, '2026-09-14 17:00:00+00');
insert into app.store_order_lines (center_id, order_id, item_id, quantity, unit_price_cents) values
  (:c, :o1, :i_samosa, 2, 800),
  (:c, :o2, :i_jar, 1, 1200),
  (:c, :o3, :i_samosa, 2, 800),
  (:c, :o4, :i_samosa, 1, 800),
  (:c, :o5, :i_jar, 2, 1200),
  (:c, :o6, :i_samosa, 1, 800),
  (:c, :o7, :i_samosa, 1, 500),
  (:c2, :o9, :i_other, 1, 700);

-- ── A. A month's sales ────────────────────────────────────────────────────────────────
select pg_temp.sign_in(:u_lead);
select pg_temp.keep('s', app.store_sales_summary(:c, date '2026-09-01', date '2026-09-30'));
select pg_temp.assert((pg_temp.got('s')->>'orders')::int = 4, 'A1 four orders were sold in September (cancelled, refunded, cart, October and other-community orders are not)');
select pg_temp.assert((pg_temp.got('s')->>'subtotal_cents')::int = 5200 and (pg_temp.got('s')->>'gift_packing_cents')::int = 250
  and (pg_temp.got('s')->>'tax_cents')::int = 120 and (pg_temp.got('s')->>'total_cents')::int = 5570,
  'A2 subtotal 5200, gift packing 250, tax 120 and total 5570, all in integer cents');
select pg_temp.assert((pg_temp.got('s')->>'units')::int = 6, 'A3 six units sold');
select pg_temp.assert(pg_temp.got('s')->>'from' = '2026-09-01' and pg_temp.got('s')->>'to' = '2026-09-30', 'A4 the answer says which days it covers');
select pg_temp.assert((pg_temp.got('s')->>'cancelled_orders')::int = 1 and (pg_temp.got('s')->>'refunded_orders')::int = 1 and (pg_temp.got('s')->>'refunded_cents')::int = 2400,
  'A5 one cancelled and one refunded order are counted apart, the refunds at 2400 cents');
select pg_temp.assert((pg_temp.got('s')->'by_status'->>'placed')::int = 2 and (pg_temp.got('s')->'by_status'->>'ready')::int = 1
  and (pg_temp.got('s')->'by_status'->>'picked_up')::int = 1 and (pg_temp.got('s')->'by_status'->>'cancelled')::int = 1
  and (pg_temp.got('s')->'by_status'->>'refunded')::int = 1 and not (pg_temp.got('s')->'by_status' ? 'cart'),
  'A6 the orders by status (a cart that was never placed is not an order of the period)');
select pg_temp.keep('oct', app.store_sales_summary(:c, date '2026-10-01', date '2026-10-31'));
select pg_temp.assert((pg_temp.got('oct')->>'orders')::int = 1 and (pg_temp.got('oct')->>'total_cents')::int = 500,
  'A7 the order placed at 00:30 local on 1 October belongs to October, the one at 23:30 on 30 September to September');

-- ── B. Top items, empty periods ───────────────────────────────────────────────────────
select pg_temp.assert(jsonb_array_length(pg_temp.got('s')->'top_items') = 2
  and pg_temp.got('s')->'top_items'->0->>'name' = 'Samosa pack' and (pg_temp.got('s')->'top_items'->0->>'units')::int = 5 and (pg_temp.got('s')->'top_items'->0->>'cents')::int = 4000
  and pg_temp.got('s')->'top_items'->1->>'name' = 'Gift jar' and (pg_temp.got('s')->'top_items'->1->>'units')::int = 1 and (pg_temp.got('s')->'top_items'->1->>'cents')::int = 1200,
  'B1 top items by units: Samosa pack 5 for 4000 cents, Gift jar 1 for 1200 (the cancelled and refunded lines are left out)');
select pg_temp.keep('none', app.store_sales_summary(:c, date '2025-01-01', date '2025-01-31'));
select pg_temp.assert((pg_temp.got('none')->>'orders')::int = 0 and (pg_temp.got('none')->>'total_cents')::int = 0
  and pg_temp.got('none')->'top_items' = '[]'::jsonb and pg_temp.got('none')->'by_status' = '{}'::jsonb,
  'B2 an empty period is zeros and empty lists, not null');
select pg_temp.assert((app.store_sales_summary(:c, date '2026-09-10', date '2026-09-10')->>'orders')::int = 1,
  'B3 one day is a period (from and to are both included)');

-- ── C. Who may read ───────────────────────────────────────────────────────────────────
select pg_temp.sign_in(:u_viewer);
select pg_temp.assert((app.store_sales_summary(:c, date '2026-09-01', date '2026-09-30')->>'total_cents')::int = 5570, 'C1 a read-only viewer (store.view) reads the sales');
select pg_temp.sign_in(:u_pickup);
select pg_temp.assert(app.store_sales_summary(:c, date '2026-09-01', date '2026-09-30') is null, 'C2 a pickup volunteer (store.pickup only) gets null, not a total of zero');
select pg_temp.sign_in(:u_nobody);
select pg_temp.assert(app.store_sales_summary(:c, date '2026-09-01', date '2026-09-30') is null, 'C3 someone with no store permission gets null');
select pg_temp.sign_in(:u_other);
select pg_temp.assert(app.store_sales_summary(:c, date '2026-09-01', date '2026-09-30') is null, 'C4 a person of another community gets null for this one');
select pg_temp.sign_in(:u_lead);
select pg_temp.assert(app.store_sales_summary(null, date '2026-09-01', date '2026-09-30') is null
  and app.store_sales_summary(:c, null, date '2026-09-30') is null and app.store_sales_summary(:c, date '2026-09-01', null) is null
  and app.store_sales_summary(:c, date '2026-09-30', date '2026-09-01') is null,
  'C5 a missing community, a missing day or a backwards period gets null');

-- ── D. Nothing personal; security invoker ───────────────────────────────────────────────
select pg_temp.assert(pg_temp.got('s')::text !~ 'Guest Name 127|15125550127|Orderer household|guest_name|guest_phone|household', 'D1 no name, phone or household in the answer');
reset role;
select pg_temp.assert((select not p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'store_sales_summary'),
  'D2 the function is security invoker');
select pg_temp.assert(not has_function_privilege('anon', 'app.store_sales_summary(uuid, date, date)', 'execute')
  and has_function_privilege('authenticated', 'app.store_sales_summary(uuid, date, date)', 'execute'),
  'D3 signed-in people may call it; guests may not');

-- ── E. The allowlist (0671) ───────────────────────────────────────────────────────────
select pg_temp.assert((select count(*) = 14 from app.activity_catalog c
                        where c.surface = 'portal' and c.kind = 'action'
                          and c.commandable_key in ('content.approval_queue', 'content.niva_sources', 'content.media_library', 'content.draft_item',
                                                    'content.decide_item', 'content.archive_item', 'store.orders_waiting', 'store.low_stock',
                                                    'store.sales_summary', 'store.products', 'store.draft_product', 'store.set_order_status',
                                                    'store.adjust_stock', 'store.change_price')
                          and c.key = 'assistant.' || replace(c.commandable_key, '.', '_')),
  'E1 every Content and Store command is a portal action under assistant.<area>_<verb>, with its command');
select pg_temp.assert((select bool_and(char_length(c.label) between 6 and 120 and c.label !~ '[._]') from app.activity_catalog c
                        where c.surface = 'portal' and (c.key like 'assistant.content\_%' or c.key like 'assistant.store\_%')),
  'E2 the labels are plain verb phrases');
select pg_temp.assert((select count(*) = 1 from app.activity_catalog c where c.key = 'assistant.people_search' and c.surface = 'portal' and c.commandable_key = 'people.search')
                      and (select count(*) = 1 from app.activity_catalog c where c.key = 'assistant.events_set_field' and c.surface = 'portal' and c.commandable_key = 'events.set_field')
                      and (select count(*) = 1 from app.activity_catalog c where c.key = 'assistant.messages_approve_campaign' and c.surface = 'portal' and c.commandable_key = 'messages.approve_campaign'),
  'E3 the commands of 0625, 0655 and 0661 are untouched');

select count(*) as n_before,
       md5(string_agg(c.key || '|' || c.surface || '|' || c.kind || '|' || c.label || '|' || coalesce(c.entity_kind, '-') || '|' || coalesce(c.commandable_key, '-'), ',' order by c.key, c.surface)) as h_before
  from app.activity_catalog c \gset
\i migrations/0671_activity_content_store_commands.sql
select pg_temp.assert((select count(*) = :n_before
                              and md5(string_agg(c.key || '|' || c.surface || '|' || c.kind || '|' || c.label || '|' || coalesce(c.entity_kind, '-') || '|' || coalesce(c.commandable_key, '-'), ',' order by c.key, c.surface)) = :'h_before'
                         from app.activity_catalog c),
  'E4 running 0671 again leaves the allowlist exactly as it was');

rollback;
\echo 'PASS: store sales and activity tests'
