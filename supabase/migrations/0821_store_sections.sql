-- 0821: the store has sections above its categories (owner request 2026-10-15; docs/STORE_SECTIONS.md).
--
-- A community's store is categories holding items. The owner wants it organised in sections: a Food section for what the community makes
-- and sells today, and later a second section where members and approved vendors offer their own products and services. This migration is
-- the first half and only that: a `section` column, its default and its check. It shows nothing new to anyone and creates nothing in the
-- second section.
--
--   section   'food'    what the store sells today (every row that exists now is in it)
--             'market'  the Community Market: other people's products and services (not built; the portal does not create rows in it)
--
-- The keys are permanent (a key never changes, the label does: MARKETPLACE_PACKS.md P6). The second key is `market`, not `marketplace`,
-- because "Marketplace" already names Weaver's catalog of paid products an organization turns on (Settings › Marketplace); the section's
-- label is copy in the apps and can change at any time.
--
-- What this does NOT change: no policy, no grant, no function that carries a money rule. The rows are read and written by exactly the
-- policies they had (store_categories_public / store_items_public for guests, the store.view / store.manage staff policies, the
-- module_switch and demo_guest_gate restrictive policies), so who can see and change a store does not move.
--
-- Where the section lives. On the category AND on the item, because an item can have no category (category_id is nullable and goes to
-- null when its category is deleted) and still belongs to a section. To keep the two from ever disagreeing, an item with a category
-- always takes that category's section (trigger below), and when a category changes section its items go with it. An item with no
-- category keeps the section it was given. One reading rule follows for every app: group by section, then category, then item, and
-- an item's section is its category's.

-- The existing rows: adding a column with a constant default gives every row that exists the default, so every current category and
-- every current item is in Food. Nothing is rewritten.
alter table app.store_categories
  add column section text not null default 'food' constraint store_categories_section_valid check (section in ('food', 'market'));
alter table app.store_items
  add column section text not null default 'food' constraint store_items_section_valid check (section in ('food', 'market'));

comment on column app.store_categories.section is
  'The store section this category belongs to: food (what the store sells today) or market (the Community Market: other people''s products and services; not built yet). A key never changes; the label is copy. 0821, docs/STORE_SECTIONS.md.';
comment on column app.store_items.section is
  'The store section this item belongs to. An item with a category always has its category''s section (trigger store_items_follow_section); an item with no category keeps the section it was given. 0821, docs/STORE_SECTIONS.md.';

-- An item follows its category. Fires only when the category or the section is written, never for a stock or price change.
create or replace function app.store_item_follow_section() returns trigger
language plpgsql set search_path = app, public, extensions as $$
declare v_section text;
begin
  if new.category_id is not null then
    select c.section into v_section from app.store_categories c where c.id = new.category_id;
    if found then new.section := v_section; end if;
  end if;
  return new;
end $$;

create trigger store_items_follow_section before insert or update of category_id, section on app.store_items
  for each row execute function app.store_item_follow_section();

-- A category that changes section takes its items with it.
create or replace function app.store_category_section_moves_items() returns trigger
language plpgsql set search_path = app, public, extensions as $$
begin
  update app.store_items set section = new.section where category_id = new.id and section is distinct from new.section;
  return null;
end $$;

create trigger store_categories_section_moves_items after update of section on app.store_categories
  for each row when (old.section is distinct from new.section) execute function app.store_category_section_moves_items();
