-- 0830: the Community Market, slice 1 (docs/STORE_MARKETPLACE.md section 14, docs/STORE_SECTIONS.md).
--   A. The product: the module `market` (depends on the Store), off for EVERY kind of organization (P5) and for every community that
--      exists, with no grant row and no change to any other module; its Marketplace card.
--   B. The role: market_lead holds market.view, market.manage and market.moderate; a demo community needs no demo person for it while
--      it does not have the market, and does need one once it does.
--   C. While the market is off (the real state of every community): its rows are invisible to everyone but a platform admin and cannot
--      be written by anyone (the store lead and the market lead included); Food is untouched (guests and the store lead as before).
--   D. Once Weaver grants it: guests and members read the active market rows as any active store row; the store lead and the market
--      lead write them; the market lead writes ONLY market rows (no Food row, no moving a market row to Food); a viewer reads the ones
--      not on sale and writes nothing; another community's market lead has nothing here.
--   E. A pause by the community, and the Store being off, hide the market again; a platform admin still sees it.
--   F. Removing a market category keeps its listings (uncategorised, still in the market).
--   G. The policies, by name and kind, and that the policies the store already had are all still there.
-- Everything runs in one transaction that is not committed.
\set ON_ERROR_STOP 1
begin;
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
  if position(lower(expect) in lower(sqlerrm)) = 0 then raise exception 'FAIL: % (got "%")', label, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.sign_in(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
-- A guest: no signed-in person (the claims of an earlier sign_in last to the end of the transaction, so they are cleared), role anon.
create or replace function pg_temp.guest() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'anon', true);
end $$;
-- How many market rows of the test community a signed-in person (or a guest) can read.
create or replace function pg_temp.seen(p_table text, p_center uuid, p_where text default 'true') returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from app.%I where center_id = $1 and section = ''market'' and (%s)', p_table, p_where) into n using p_center;
  return n;
end $$;

\set jsh '''00000000-0000-4000-8000-000000000001'''
\set c '''83000000-0000-4000-8000-0000000000c1'''
\set c2 '''83000000-0000-4000-8000-0000000000c2'''
\set u_store '''83000000-0000-4000-8000-0000000000a1'''
\set u_market '''83000000-0000-4000-8000-0000000000a2'''
\set u_viewer '''83000000-0000-4000-8000-0000000000a3'''
\set u_member '''83000000-0000-4000-8000-0000000000a4'''
\set u_other '''83000000-0000-4000-8000-0000000000a5'''
\set u_admin '''83000000-0000-4000-8000-0000000000a6'''
\set cat_f '''83000000-0000-4000-8000-0000000000b1'''
\set cat_m '''83000000-0000-4000-8000-0000000000b2'''
\set cat_m2 '''83000000-0000-4000-8000-0000000000b3'''
\set it_f '''83000000-0000-4000-8000-0000000000d1'''
\set it_fp '''83000000-0000-4000-8000-0000000000d2'''
\set it_m '''83000000-0000-4000-8000-0000000000d3'''
\set it_mp '''83000000-0000-4000-8000-0000000000d4'''
\set it_mfree '''83000000-0000-4000-8000-0000000000d5'''
\set it_m2 '''83000000-0000-4000-8000-0000000000d6'''
\set cat_new '''83000000-0000-4000-8000-0000000000b4'''
\set cat_m3 '''83000000-0000-4000-8000-0000000000b5'''
\set it_new '''83000000-0000-4000-8000-0000000000d7'''

-- ── Fixtures (superuser) ─────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  (:u_store, 'store830@example.com'), (:u_market, 'market830@example.com'), (:u_viewer, 'viewer830@example.com'),
  (:u_member, 'member830@example.com'), (:u_other, 'other830@example.com'), (:u_admin, 'admin830@example.com');
insert into app.accounts (user_id, is_platform_admin) values (:u_admin, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:c, 'mk830', 'Market Center', 'MKC', 'TX', 'active', 'America/Chicago'),
  (:c2, 'mk830b', 'Other Market Center', 'OMC', 'TX', 'active', 'America/Chicago');
-- A role that only looks at the market (the catalog has none: this is a role a community could make).
insert into app.roles (key, tier, name, default_scope, description, permissions) values
  ('t830_viewer', 'center', 'Market viewer 830', 'center', 'test 830', '["market.view"]');
insert into app.role_grants (center_id, user_id, role_key, scope_kind) values
  (:c, :u_store, 'store_lead', 'center'), (:c, :u_market, 'market_lead', 'center'), (:c, :u_viewer, 't830_viewer', 'center'),
  (:c2, :u_other, 'market_lead', 'center');
insert into app.store_categories (id, center_id, name, section) values
  (:cat_f, :c, 'Food category 830', 'food'), (:cat_m, :c, 'Gifts 830', 'market'), (:cat_m2, :c2, 'Gifts 830 other', 'market');
insert into app.store_items (id, center_id, category_id, name, price_cents, status) values
  (:it_f, :c, :cat_f, 'Food item 830', 500, 'active'),
  (:it_fp, :c, :cat_f, 'Paused food item 830', 500, 'paused'),
  (:it_m, :c, :cat_m, 'Market item 830', 1500, 'active'),
  (:it_mp, :c, :cat_m, 'Paused market item 830', 1500, 'paused');
insert into app.store_items (id, center_id, name, price_cents, status, section) values
  (:it_mfree, :c, 'Uncategorised market item 830', 900, 'active', 'market'),
  (:it_m2, :c2, 'Other community market item 830', 900, 'active', 'market');

-- ── A. The product ───────────────────────────────────────────────────────────────────
select pg_temp.assert((select label = 'Community Market' and not core and depends_on = '{store}' and sort = 24 from app.modules where key = 'market'),
  'A1 the module market exists: Community Market, not core, needs the Store');
select pg_temp.assert((select count(*) from app.category_modules where module_key = 'market') = (select count(*) from app.organization_categories)
                      and not exists (select 1 from app.category_modules where module_key = 'market' and availability <> 'default_off'),
  'A2 every kind of organization has the market, default_off (P5): a Jain Center too');
select pg_temp.assert(not app.module_enabled(:jsh, 'market') and not app.module_enabled(:c, 'market') and not app.module_enabled(:c2, 'market'),
  'A3 no community has it: the existing community, and two new ones');
select pg_temp.assert(:jsh::uuid = any (app.module_off_centers('market')) and :c::uuid = any (app.module_off_centers('market')),
  'A4 the policies see it as off for them (module_off_centers)');
select pg_temp.assert(not exists (select 1 from app.center_module_grants where module_key = 'market')
                      and not exists (select 1 from app.center_modules where module_key = 'market'),
  'A5 no grant and no pause row was written for any community');
select pg_temp.assert((select count(*) from app.modules where key in ('ai', 'website', 'channels', 'care', 'matching')) = 5
                      and (select bool_and(app.module_availability(:jsh, key) = 'default_off') from app.modules where key in ('ai', 'website', 'channels', 'care', 'matching', 'market')),
  'A6 the five earlier products are still off for every kind, with the market beside them');
select pg_temp.assert((select name = 'Community Market' and module_key = 'market' and status = 'available' and not included and price_text = 'Price not set yet'
                         and needs = '[{"module":"store"}]'::jsonb from app.marketplace_products where key = 'market'),
  'A7 its Marketplace card: Community Market, available, not included, no price set');

-- ── B. The role ──────────────────────────────────────────────────────────────────────
select pg_temp.assert((select tier = 'center' and name = 'Community Market lead' and permissions = '["market.view","market.manage","market.moderate"]'::jsonb
                         from app.roles where key = 'market_lead'),
  'B1 market_lead holds market.view, market.manage and market.moderate');
select pg_temp.assert(not ('market_lead' = any (app.demo_missing_roles(:c))) and ('treasurer' = any (app.demo_missing_roles(:c))),
  'B2 a community without the market needs no demo person for market_lead (and still needs one for the roles it does have)');

-- ── C. While the market is off ───────────────────────────────────────────────────────
select pg_temp.guest();
select pg_temp.assert(pg_temp.seen('store_items', :c) = 0 and pg_temp.seen('store_categories', :c) = 0
                      and (select count(*) from app.store_items where center_id = :c and section = 'food' and status = 'active') = 1
                      and (select count(*) from app.store_categories where center_id = :c and section = 'food') = 1,
  'C1 a guest sees no market row of a community without the market, and the Food rows as before');
reset role;
select pg_temp.sign_in(:u_store);
select pg_temp.assert(pg_temp.seen('store_items', :c) = 0 and pg_temp.seen('store_categories', :c) = 0
                      and (select count(*) from app.store_items where center_id = :c and section = 'food') = 2,
  'C2 the store lead sees no market row, and every Food row (the paused one too)');
select pg_temp.assert_raises($$insert into app.store_categories (center_id, name, section) values ('83000000-0000-4000-8000-0000000000c1', 'Nope 830', 'market')$$,
  'row-level security', 'C3 the store lead cannot add a market category while the market is off');
select pg_temp.assert_raises($$insert into app.store_items (center_id, name, price_cents, section) values ('83000000-0000-4000-8000-0000000000c1', 'Nope 830', 100, 'market')$$,
  'row-level security', 'C4 or a market listing');
insert into app.store_categories (id, center_id, name) values (:cat_new, :c, 'Food category 830 new');
select pg_temp.assert((select section from app.store_categories where id = :cat_new) = 'food', 'C5 Food is written as before');
reset role;
select pg_temp.sign_in(:u_market);
select pg_temp.assert(pg_temp.seen('store_items', :c) = 0 and pg_temp.seen('store_categories', :c) = 0, 'C6 the market lead sees no market row while it is off');
select pg_temp.assert_raises($$insert into app.store_items (center_id, name, price_cents, section) values ('83000000-0000-4000-8000-0000000000c1', 'Nope 830', 100, 'market')$$,
  'row-level security', 'C7 and cannot add a listing');
reset role;
select pg_temp.sign_in(:u_admin);
select pg_temp.assert(pg_temp.seen('store_items', :c) = 3 and pg_temp.seen('store_categories', :c) = 1,
  'C8 a platform admin still sees the market rows (as for every module)');
reset role;

-- ── D. Once Weaver grants it ─────────────────────────────────────────────────────────
insert into app.center_module_grants (center_id, module_key, granted, reason, granted_by) values (:c, 'market', true, 'test 830', null);
select pg_temp.assert(app.module_enabled(:c, 'market') and not app.module_enabled(:c2, 'market') and not app.module_enabled(:jsh, 'market'),
  'D1 it is on for the community that was granted it, and for no other');
select pg_temp.assert('market_lead' = any (app.demo_missing_roles(:c)), 'D2 a community that has the market needs a demo person for market_lead');
select pg_temp.guest();
select pg_temp.assert(pg_temp.seen('store_items', :c, 'status = ''active''') = 2 and pg_temp.seen('store_items', :c, 'status <> ''active''') = 0
                      and pg_temp.seen('store_categories', :c) = 1 and pg_temp.seen('store_items', :c2) = 0,
  'D3 a guest reads the active market rows and the market categories, as any store row (not the paused one, not another community''s)');
reset role;
select pg_temp.sign_in(:u_member);
select pg_temp.assert(pg_temp.seen('store_items', :c, 'status = ''active''') = 2 and pg_temp.seen('store_items', :c, 'status <> ''active''') = 0,
  'D4 a member reads the same');
reset role;

select pg_temp.sign_in(:u_store);
select pg_temp.assert(pg_temp.seen('store_items', :c) = 3, 'D5 the store lead reads every market row, the paused one too');
update app.store_items set price_cents = 1600 where id = :it_m;
insert into app.store_items (id, center_id, category_id, name, price_cents) values (:it_new, :c, :cat_m, 'Store lead market item 830', 700);
select pg_temp.assert((select price_cents = 1600 from app.store_items where id = :it_m) and (select section = 'market' from app.store_items where id = :it_new),
  'D6 and writes them (a listing added to a market category is in the market)');
reset role;

select pg_temp.sign_in(:u_market);
select pg_temp.assert(pg_temp.seen('store_items', :c) = 4, 'D7 the market lead reads every market row of the community');
insert into app.store_categories (id, center_id, name, section) values (:cat_m3, :c, 'Printing 830', 'market');
update app.store_categories set sort_order = 7 where id = :cat_m3;
update app.store_items set price_cents = 1700, status = 'paused' where id = :it_m;
select pg_temp.assert((select section = 'market' and sort_order = 7 from app.store_categories where id = :cat_m3)
                      and (select price_cents = 1700 and status = 'paused' from app.store_items where id = :it_m),
  'D8 the market lead adds and edits market categories and listings');
select pg_temp.assert_raises($$insert into app.store_categories (center_id, name, section) values ('83000000-0000-4000-8000-0000000000c1', 'Food by market lead 830', 'food')$$,
  'row-level security', 'D9 the market lead cannot add a Food category');
select pg_temp.assert_raises($$insert into app.store_items (center_id, name, price_cents) values ('83000000-0000-4000-8000-0000000000c1', 'Food by market lead 830', 100)$$,
  'row-level security', 'D10 or a Food item (a row written with no section is Food)');
update app.store_items set price_cents = 1 where id = :it_f;
select pg_temp.assert((select price_cents = 500 from app.store_items where id = :it_f) and (select count(*) from app.store_items where center_id = :c and section = 'food' and status = 'active') = 1,
  'D11 nor change a Food item (the update finds nothing it may change), and the market lead reads only active Food rows, like anyone');
select pg_temp.assert_raises($$update app.store_items set section = 'food' where id = '83000000-0000-4000-8000-0000000000d5'$$,
  'row-level security', 'D12 nor move a market listing into Food');
select pg_temp.assert_raises($$update app.store_categories set section = 'food' where id = '83000000-0000-4000-8000-0000000000b5'$$,
  'row-level security', 'D13 nor a market category');
reset role;

select pg_temp.sign_in(:u_viewer);
select pg_temp.assert(pg_temp.seen('store_items', :c) = 4 and (select count(*) from app.store_items where center_id = :c and section = 'food' and status <> 'active') = 0,
  'D14 a viewer (market.view) reads every market row, the paused ones too, and not Food''s paused item');
select pg_temp.assert_raises($$insert into app.store_items (center_id, name, price_cents, section) values ('83000000-0000-4000-8000-0000000000c1', 'Viewer 830', 100, 'market')$$,
  'row-level security', 'D15 and writes nothing');
update app.store_items set price_cents = 2 where id = :it_mfree;
select pg_temp.assert((select price_cents = 900 from app.store_items where id = :it_mfree), 'D16 an update by the viewer changes nothing');
reset role;

select pg_temp.sign_in(:u_other);
select pg_temp.assert(pg_temp.seen('store_items', :c, 'status <> ''active''') = 0 and pg_temp.seen('store_items', :c2) = 0,
  'D17 another community''s market lead reads nothing of the paused rows here (and the market is off for their own community)');
select pg_temp.assert_raises($$insert into app.store_items (center_id, name, price_cents, section) values ('83000000-0000-4000-8000-0000000000c1', 'Other 830', 100, 'market')$$,
  'row-level security', 'D18 and cannot add to this community''s market');
select pg_temp.assert_raises($$insert into app.store_items (center_id, name, price_cents, section) values ('83000000-0000-4000-8000-0000000000c2', 'Other 830', 100, 'market')$$,
  'row-level security', 'D19 nor to their own while it is off for them');
reset role;

-- ── E. A pause, and the Store being off ───────────────────────────────────────────────
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c, 'market', false, 'test 830 pause');
select pg_temp.assert(not app.module_enabled(:c, 'market'), 'E1 the community can pause the market');
select pg_temp.guest();
select pg_temp.assert(pg_temp.seen('store_items', :c) = 0 and pg_temp.seen('store_categories', :c) = 0
                      and (select count(*) from app.store_items where center_id = :c and section = 'food' and status = 'active') = 1,
  'E2 paused: a guest sees no market row, and the Food row as before');
reset role;
select pg_temp.sign_in(:u_market);
select pg_temp.assert(pg_temp.seen('store_items', :c) = 0, 'E3 paused: the market lead sees none either');
reset role;
select pg_temp.sign_in(:u_admin);
select pg_temp.assert(pg_temp.seen('store_items', :c) = 4, 'E4 paused: a platform admin still does');
reset role;
delete from app.center_modules where center_id = :c and module_key = 'market';
select pg_temp.assert(app.module_enabled(:c, 'market'), 'E5 resumed, it is back');
select pg_temp.guest();
select pg_temp.assert(pg_temp.seen('store_items', :c, 'status = ''active''') = 2, 'E6 and its active rows are readable again');
reset role;
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c, 'store', false, 'test 830 store off');
select pg_temp.assert(not app.module_enabled(:c, 'market') and not app.module_enabled(:c, 'store'), 'E7 with the Store off the market is off (it lives in the store)');
select pg_temp.guest();
select pg_temp.assert(pg_temp.seen('store_items', :c) = 0, 'E8 and its rows are hidden');
reset role;
delete from app.center_modules where center_id = :c and module_key = 'store';

-- ── F. Removing a category keeps its listings ─────────────────────────────────────────
select pg_temp.sign_in(:u_market);
delete from app.store_categories where id = :cat_m;
select pg_temp.assert(not exists (select 1 from app.store_categories where id = :cat_m)
                      and (select category_id is null and section = 'market' from app.store_items where id = :it_m)
                      and (select category_id is null and section = 'market' from app.store_items where id = :it_new),
  'F1 the market lead removes a market category; its listings stay, uncategorised, in the market');
delete from app.store_items where id = :it_f;
select pg_temp.assert(exists (select 1 from app.store_items where id = :it_f), 'F2 a Food item is not the market lead''s to delete (the delete finds nothing)');
reset role;

-- ── G. The policies ─────────────────────────────────────────────────────────────────
select pg_temp.assert((select count(*) = 1 from pg_policies where schemaname = 'app' and tablename = 'store_items' and policyname = 'market_section_switch'
                         and permissive = 'RESTRICTIVE' and cmd = 'ALL')
                      and (select count(*) = 1 from pg_policies where schemaname = 'app' and tablename = 'store_categories' and policyname = 'market_section_switch'
                         and permissive = 'RESTRICTIVE' and cmd = 'ALL'),
  'G1 a restrictive market_section_switch on both tables, for every command');
select pg_temp.assert((select count(*) = 1 from pg_policies where schemaname = 'app' and tablename = 'store_items' and policyname = 'store_items_market_write'
                         and permissive = 'PERMISSIVE' and cmd = 'ALL' and roles = '{authenticated}')
                      and (select count(*) = 1 from pg_policies where schemaname = 'app' and tablename = 'store_categories' and policyname = 'store_categories_market_write'
                         and permissive = 'PERMISSIVE' and cmd = 'ALL' and roles = '{authenticated}')
                      and (select count(*) = 1 from pg_policies where schemaname = 'app' and tablename = 'store_items' and policyname = 'store_items_market_read'
                         and permissive = 'PERMISSIVE' and cmd = 'SELECT' and roles = '{authenticated}'),
  'G2 the three permissive ones: market.manage writes market rows, market.view and market.moderate read the items not on sale');
select pg_temp.assert((select string_agg(policyname, ',' order by policyname) from pg_policies where schemaname = 'app' and tablename = 'store_items'
                          and policyname not in ('market_section_switch', 'store_items_market_write', 'store_items_market_read'))
                      = (select string_agg(p, ',' order by p) from unnest(array['demo_guest_gate', 'module_switch', 'store_items_public', 'store_items_staff_read', 'store_items_staff_write']) p)
                      and (select string_agg(policyname, ',' order by policyname) from pg_policies where schemaname = 'app' and tablename = 'store_categories'
                          and policyname not in ('market_section_switch', 'store_categories_market_write'))
                      = (select string_agg(p, ',' order by p) from unnest(array['demo_guest_gate', 'module_switch', 'store_categories_public', 'store_categories_staff_read', 'store_categories_staff_write']) p),
  'G3 every policy the store tables already had is still there, and nothing else was added');
select pg_temp.assert((select qual = '(status = ''active''::text)' from pg_policies where schemaname = 'app' and tablename = 'store_items' and policyname = 'store_items_public'),
  'G4 the guest rule of active items is unchanged');
select pg_temp.assert(not exists (select 1 from pg_policies where schemaname = 'app' and tablename in ('store_orders', 'store_order_lines', 'pickup_windows', 'inventory_movements', 'payments')
                                    and (policyname like 'market%' or policyname like '%market%')),
  'G5 no policy of an order, a payment or a pickup slot mentions the market: no money rule changed');

rollback;
\echo 'PASS: Community Market slice 1 tests'
