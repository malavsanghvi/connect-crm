-- 0830 · The Community Market, slice 1: the product, its permissions and role, and the policies that tie its rows to the module
-- (docs/STORE_MARKETPLACE.md section 14, docs/STORE_SECTIONS.md; owner decisions CM1 to CM24 accepted 2026-10-15, "go with the
-- recommendations"; builds on 0821, which put every store category and item in the Food section).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   The Community Market is a Marketplace product (rules P1 to P6, docs/MARKETPLACE_PACKS.md): a second section of the store.
--   Slice 1 is the community's own non-food products and services in that section: no seller applications, no new tables, no
--   money. It adds:
--
--   1. The module `market` ("Community Market", depends on the Store). OFF for every kind of organization (P5): the 0594 trigger
--      gives a new module default_on to a Jain Center, so this file sets default_off for every kind right after. A platform admin
--      turns it on for one community with app.set_module_grant (a reason and a fresh 2FA check, audited, 0740); the community may
--      pause and resume it. Nothing changes for any community until then: no existing grant, pause or row is touched.
--   2. Its Marketplace card (app.marketplace_products, 0752): the words the card shows, claiming only what works today.
--   3. Three permissions and one role (CM15):
--        market.view      see the Community Market in the portal (paused and retired listings too)
--        market.manage    create, edit, pause and remove the market's categories and listings, and start the market
--        market.moderate  reserved for the review queue of slice 2; today it reads the market like market.view
--      and the role `market_lead` ("Community Market lead", all three). The store lead keeps the Food section and, through
--      store.manage, can also run the market's listings (the plan: "slice 1 reuses the store permissions").
--   4. The policies (the part the owner approves; rollback at the end of this comment):
--        RESTRICTIVE market_section_switch on store_categories and store_items, for all commands and all roles: a row whose
--          section is 'market' can be read or written only while the community has the `market` module on (granted, not paused,
--          and its Store on), or by a platform admin. Rows in Food are untouched by it. A restrictive policy only takes access
--          away; it adds none.
--        PERMISSIVE store_categories_market_write and store_items_market_write, for authenticated people: the holder of
--          market.manage in that community may select, insert, update and delete rows whose section is 'market' (and only those:
--          the same condition is the check, so they cannot create a Food row or move a row into Food).
--        PERMISSIVE store_items_market_read: the holder of market.view or market.moderate may select market items that are not
--          active (paused, retired); active items are already public (store_items_public, unchanged).
--      Every existing policy (store_categories_public, store_items_public, the store.view / store.manage staff policies, the
--      generated module_switch for the Store, demo_guest_gate) is left exactly as it is. No grant, function that carries a money
--      rule, or trigger on an order or a payment is touched.
--   5. The portal's new screen, /store/market, is listed in the activity catalog (0620) like every screen of the navigation.
--   6. app.demo_missing_roles (0757): a demo community needs no demo person for a role that opens only a product the community
--      does not have; the Community Market lead joins WeCare and CatchTheMatch in that list (the demo packs have no Community
--      Market). Without it, creating or resetting any demo community would stop at "no demo person for market_lead".
--
-- ROLLBACK (paste to undo this file; nothing else depends on it until a community is granted the module, and after that the
-- market's rows are plain store rows in section 'market'):
--   drop policy if exists market_section_switch on app.store_categories;
--   drop policy if exists market_section_switch on app.store_items;
--   drop policy if exists store_categories_market_write on app.store_categories;
--   drop policy if exists store_items_market_write on app.store_items;
--   drop policy if exists store_items_market_read on app.store_items;
--   delete from app.activity_catalog where key = 'screen:/store/market';
--   delete from app.marketplace_requests where product_key = 'market';
--   delete from app.marketplace_interest where product_key = 'market';
--   delete from app.marketplace_products where key = 'market';
--   delete from app.role_grants where role_key = 'market_lead';
--   delete from app.roles where key = 'market_lead';
--   delete from app.center_module_grants where module_key = 'market';
--   delete from app.center_modules where module_key = 'market';
--   delete from app.category_modules where module_key = 'market';
--   delete from app.modules where key = 'market';
--   -- and put app.demo_missing_roles back to 0757's body (drop the one `and not (... market ...)` condition).
-- Rows that were filed in section 'market' while the module was on stay where they are; to put them back in Food:
--   update app.store_categories set section = 'food' where section = 'market';   -- the items follow their category (0821)
--   update app.store_items set section = 'food' where section = 'market';
set client_min_messages = warning;

-- ── 1. The module ────────────────────────────────────────────────────────────
-- Sorts after the five Marketplace products of 0750 (sort 19 to 23).
insert into app.modules (key, label, description, core, depends_on, sort) values
  ('market', 'Community Market',
   'A second section of the store for the community''s own non-food products and services, organized in categories. Sellers other than the community are not built yet.',
   false, '{store}', 24)
on conflict (key) do update set label = excluded.label, description = excluded.description, core = excluded.core,
  depends_on = excluded.depends_on, sort = excluded.sort;

-- P5: off for every kind of organization.
update app.category_modules set availability = 'default_off' where module_key = 'market' and availability <> 'default_off';

-- ── 2. The Marketplace card ──────────────────────────────────────────────────
insert into app.marketplace_products
  (key, module_key, name, mark, line, gets, needs, members_line, data_line, price_text, price_short, included, status,
   target_quarter, on_note, off_note, sort)
values
  ('market', 'market', 'Community Market', 'CM',
   'A second section of your store for your own products and services, such as gifts, printing and community items, organized in categories.',
   array['A Community Market section beside Food in your store', 'Your own categories, with a starter set to begin with',
         'Listings you add, edit, pause and remove'],
   '[{"module":"store"}]',
   'Members see the Community Market beside Food in the store, in a member app that reads store sections (an app update), once there is something in it.',
   null, 'Price not set yet', null, false, 'available', null,
   'Turning it on adds nothing members can see until the community lists something. Members and approved vendors listing their own products and services are not built yet.',
   'The Community Market and its listings are hidden at once, in the portal and in the app; nothing is deleted, and the Food section is not affected.',
   65)
on conflict (key) do update set
  module_key = excluded.module_key, name = excluded.name, mark = excluded.mark, line = excluded.line, gets = excluded.gets,
  needs = excluded.needs, members_line = excluded.members_line, data_line = excluded.data_line, price_text = excluded.price_text,
  price_short = excluded.price_short, included = excluded.included, status = excluded.status,
  target_quarter = excluded.target_quarter, on_note = excluded.on_note, off_note = excluded.off_note, sort = excluded.sort;

-- ── 3. The role (the permissions are strings on roles; the portal's catalog, src/lib/entitlements.ts, names them) ──
insert into app.roles (key, tier, name, default_scope, description, permissions) values
  ('market_lead', 'center', 'Community Market lead', 'center',
   'The Community Market: its categories, its listings and its start. The store lead keeps the Food section.',
   '["market.view","market.manage","market.moderate"]')
on conflict (key) do nothing;

-- ── 4. The policies ──────────────────────────────────────────────────────────
-- A market row exists only while the community has the Community Market on (and its Store). Written like every module_switch.
drop policy if exists market_section_switch on app.store_categories;
create policy market_section_switch on app.store_categories as restrictive for all to public
  using (section <> 'market' or (select app.is_platform_admin()) or not (center_id = any ((select app.module_off_centers('market'))::uuid[])))
  with check (section <> 'market' or (select app.is_platform_admin()) or not (center_id = any ((select app.module_off_centers('market'))::uuid[])));
drop policy if exists market_section_switch on app.store_items;
create policy market_section_switch on app.store_items as restrictive for all to public
  using (section <> 'market' or (select app.is_platform_admin()) or not (center_id = any ((select app.module_off_centers('market'))::uuid[])))
  with check (section <> 'market' or (select app.is_platform_admin()) or not (center_id = any ((select app.module_off_centers('market'))::uuid[])));

-- Who may run the market's rows: market.manage, for market rows only.
drop policy if exists store_categories_market_write on app.store_categories;
create policy store_categories_market_write on app.store_categories for all to authenticated
  using (section = 'market' and app.has_permission(center_id, 'market.manage'))
  with check (section = 'market' and app.has_permission(center_id, 'market.manage'));
drop policy if exists store_items_market_write on app.store_items;
create policy store_items_market_write on app.store_items for all to authenticated
  using (section = 'market' and app.has_permission(center_id, 'market.manage'))
  with check (section = 'market' and app.has_permission(center_id, 'market.manage'));

-- Who may read the market's items that are not on sale: the market's viewers and moderators (the active ones are public).
drop policy if exists store_items_market_read on app.store_items;
create policy store_items_market_read on app.store_items for select to authenticated
  using (section = 'market' and (app.has_permission(center_id, 'market.view') or app.has_permission(center_id, 'market.moderate')));

-- ── 5. The activity stream records the screen like every other (0620's catalog) ──────────────────────────────────
select app.activity_register('screen:/store/market', 'screen', 'portal', 'Community Market', null);

-- ── 6. Demo communities ──────────────────────────────────────────────────────
-- 0757's rule (every role the community's kind shows has a demo person, except a role that opens only products the demo
-- community does not have), with one more exception: a role whose every permission belongs to the Community Market, while the
-- community does not have it. (create or replace keeps 0629's grants.)
create or replace function app.demo_missing_roles(p_center uuid) returns text[]
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(array_agg(r.key order by r.key), '{}'::text[])
    from app.roles r
   where r.tier <> 'platform' and app.catalog_shows(r.category_keys, app.center_category(p_center))
     and not exists (select 1 from app.demo_personas d where d.center_id = p_center and d.role_key = r.key)
     and (cardinality(app.role_private_products(r.key)) = 0
          or exists (select 1 from unnest(app.role_private_products(r.key)) p where app._org_private_module_on(p_center, p)))
     and not (jsonb_array_length(r.permissions) > 0
              and not exists (select 1 from jsonb_array_elements_text(r.permissions) k where k not like 'market.%')
              and not app.module_enabled(p_center, 'market'))
$$;
