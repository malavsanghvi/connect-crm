-- 0821: the store has sections above its categories (docs/STORE_SECTIONS.md).
--   A. Every row that exists is in Food (the seed's store; the migration's own statement backfills rows that exist when it runs), a
--      row written without a section is in Food, and the demo loader (which names only the columns a pack lists) gives Food too.
--   B. The check: only 'food' and 'market' are keys; a null, a capital letter or any other word is refused.
--   C. An item follows its category: into a market category it is a market item whatever section it was given; moving it to another
--      category moves its section; an item with no category keeps the section it was given; a category that changes section takes its
--      items with it; deleting a category leaves its items where they were; the move is audited on each item.
--   D. Who reads and writes is unchanged: no policy mentions the section; a store lead writes both columns like any other; a person with
--      no store role and another community's store lead cannot write; a guest reads exactly what a guest read before (active items and
--      all categories of an open community, paused items not), and the new column comes with the rows.
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
create or replace function pg_temp.sec(p_table text, p_id uuid) returns text language plpgsql as $$
declare v text;
begin
  execute format('select section from app.%I where id = $1', p_table) into v using p_id;
  return v;
end $$;

\set jsh '''00000000-0000-4000-8000-000000000001'''
\set c '''82100000-0000-4000-8000-0000000000c1'''
\set c2 '''82100000-0000-4000-8000-0000000000c2'''
\set u_lead '''82100000-0000-4000-8000-0000000000a1'''
\set u_nobody '''82100000-0000-4000-8000-0000000000a2'''
\set u_other '''82100000-0000-4000-8000-0000000000a3'''
\set cat_f '''82100000-0000-4000-8000-0000000000b1'''
\set cat_m '''82100000-0000-4000-8000-0000000000b2'''
\set it_plain '''82100000-0000-4000-8000-0000000000d1'''
\set it_m1 '''82100000-0000-4000-8000-0000000000d2'''
\set it_m2 '''82100000-0000-4000-8000-0000000000d3'''
\set it_free '''82100000-0000-4000-8000-0000000000d4'''
\set it_paused '''82100000-0000-4000-8000-0000000000d5'''
\set it_lead '''82100000-0000-4000-8000-0000000000d6'''
\set cat_lead '''82100000-0000-4000-8000-0000000000b3'''

-- ── Fixtures (superuser) ─────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  (:u_lead, 'lead821@example.com'), (:u_nobody, 'nobody821@example.com'), (:u_other, 'other821@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:c, 'st821', 'Sections Center', 'SEC', 'TX', 'active', 'America/Chicago'),
  (:c2, 'st821b', 'Other Sections Center', 'OSC', 'TX', 'active', 'America/Chicago');
insert into app.role_grants (center_id, user_id, role_key, scope_kind) values
  (:c, :u_lead, 'store_lead', 'center'), (:c2, :u_other, 'store_lead', 'center');

-- ── A. Every row is in Food, and a row written without a section is in Food ───────────────
select pg_temp.assert((select count(*) from app.store_categories where center_id = :jsh) >= 3
                      and not exists (select 1 from app.store_categories where center_id = :jsh and section <> 'food'),
  'A1 every category the store already had (the seed''s three) is in Food');
select pg_temp.assert((select count(*) from app.store_items where center_id = :jsh) >= 8
                      and not exists (select 1 from app.store_items where center_id = :jsh and section <> 'food'),
  'A2 every item the store already had (the seed''s eight) is in Food');
-- The migration adds the column with a constant default; Postgres gives every row that exists the default. The same statement,
-- run against a table that already has rows:
create temp table t821_old (id int, name text);
insert into t821_old values (1, 'Mohanthal'), (2, 'Chakri');
alter table t821_old add column section text not null default 'food' constraint t821_old_valid check (section in ('food', 'market'));
select pg_temp.assert((select count(*) = 2 and bool_and(section = 'food') from t821_old),
  'A3 the migration''s ADD COLUMN puts the rows that exist when it runs in Food');
select pg_temp.assert((select count(*) = 2 from information_schema.columns
                        where table_schema = 'app' and table_name in ('store_categories', 'store_items') and column_name = 'section'
                          and data_type = 'text' and is_nullable = 'NO' and column_default like '''food''%'),
  'A4 both tables have section, text, not null, default food');

insert into app.store_categories (id, center_id, name) values (:cat_f, :c, 'Food category 821');
insert into app.store_items (id, center_id, name, price_cents) values (:it_plain, :c, 'Plain item 821', 500);
select pg_temp.assert(pg_temp.sec('store_categories', :cat_f) = 'food' and pg_temp.sec('store_items', :it_plain) = 'food',
  'A5 a category and an item written without a section (as the portal did before, the importers and old apps do) are in Food');
-- The demo packs name only the columns they list (app.demo_put), so they get the default too.
select app.demo_put('store_categories', jsonb_build_object('name', 'Demo category 821', 'sort_order', 9), :c, gen_random_uuid(), null);
select app.demo_put('store_items', jsonb_build_object('sku', 'D821', 'name', 'Demo item 821', 'price_cents', 700), :c, gen_random_uuid(), null);
select pg_temp.assert((select section = 'food' from app.store_categories where center_id = :c and name = 'Demo category 821')
                      and (select section = 'food' from app.store_items where center_id = :c and sku = 'D821'),
  'A6 a demo pack''s category and item (the loader lists only the columns the pack names) are in Food');

-- ── B. The check ─────────────────────────────────────────────────────────────────────
select pg_temp.assert_raises($$insert into app.store_categories (center_id, name, section) values ('82100000-0000-4000-8000-0000000000c1', 'Bad 821', 'bakery')$$,
  'store_categories_section_valid', 'B1 a category cannot be in a section that is not a key');
select pg_temp.assert_raises($$insert into app.store_items (center_id, name, price_cents, section) values ('82100000-0000-4000-8000-0000000000c1', 'Bad 821', 100, 'marketplace')$$,
  'store_items_section_valid', 'B2 an item cannot be in a section that is not a key (the key is market, not marketplace)');
select pg_temp.assert_raises($$insert into app.store_items (center_id, name, price_cents, section) values ('82100000-0000-4000-8000-0000000000c1', 'Bad 821', 100, 'Food')$$,
  'store_items_section_valid', 'B3 a key is lower case');
select pg_temp.assert_raises($$insert into app.store_categories (center_id, name, section) values ('82100000-0000-4000-8000-0000000000c1', 'Bad 821', null)$$,
  'not-null', 'B4 a category always has a section');
select pg_temp.assert_raises($$update app.store_items set section = null where id = '82100000-0000-4000-8000-0000000000d1'$$,
  'not-null', 'B5 an item always has a section');

-- ── C. An item follows its category ──────────────────────────────────────────────────────
insert into app.store_categories (id, center_id, name, section) values (:cat_m, :c, 'Market category 821', 'market');
insert into app.store_items (id, center_id, category_id, name, price_cents) values (:it_m1, :c, :cat_m, 'Market item 1', 1000);
insert into app.store_items (id, center_id, category_id, name, price_cents, section) values (:it_m2, :c, :cat_m, 'Market item 2', 1200, 'food');
select pg_temp.assert(pg_temp.sec('store_items', :it_m1) = 'market', 'C1 an item put in a market category with no section is a market item');
select pg_temp.assert(pg_temp.sec('store_items', :it_m2) = 'market', 'C2 an item put in a market category is a market item even if it was given food');

update app.store_items set category_id = :cat_m where id = :it_plain;
select pg_temp.assert(pg_temp.sec('store_items', :it_plain) = 'market', 'C3 moving an item to a market category moves its section');
update app.store_items set category_id = :cat_f where id = :it_plain;
select pg_temp.assert(pg_temp.sec('store_items', :it_plain) = 'food', 'C4 moving it back to a food category brings it back to Food');
update app.store_items set category_id = null where id = :it_plain;
select pg_temp.assert(pg_temp.sec('store_items', :it_plain) = 'food', 'C5 taking a category away leaves the item in the section it was in');

insert into app.store_items (id, center_id, name, price_cents, section) values (:it_free, :c, 'Free item 821', 800, 'market');
select pg_temp.assert(pg_temp.sec('store_items', :it_free) = 'market', 'C6 an item with no category keeps the section it was given');
update app.store_items set section = 'food' where id = :it_free;
select pg_temp.assert(pg_temp.sec('store_items', :it_free) = 'food', 'C7 and it can be moved by writing the section');
update app.store_items set section = 'food' where id = :it_m1;
select pg_temp.assert(pg_temp.sec('store_items', :it_m1) = 'market', 'C8 an item with a category cannot be moved out of its category''s section by writing the section');

update app.store_categories set section = 'food' where id = :cat_m;
select pg_temp.assert(pg_temp.sec('store_items', :it_m1) = 'food' and pg_temp.sec('store_items', :it_m2) = 'food',
  'C9 a category that changes section takes its items with it');
select pg_temp.assert(exists (select 1 from app.audit_log where record_table = 'store_items' and record_id = :it_m1::text and after ->> 'section' = 'food'
                                 and before ->> 'section' = 'market'),
  'C10 the move is audited on the item (before market, after food)');
update app.store_categories set section = 'market' where id = :cat_m;
select pg_temp.assert(pg_temp.sec('store_items', :it_m1) = 'market' and pg_temp.sec('store_items', :it_m2) = 'market',
  'C11 and back again');
update app.store_items set price_cents = 1100, stock_on_hand = 3 where id = :it_m1;
select pg_temp.assert(pg_temp.sec('store_items', :it_m1) = 'market', 'C12 a price or stock change does not touch the section');

delete from app.store_categories where id = :cat_m;
select pg_temp.assert(pg_temp.sec('store_items', :it_m1) = 'market' and (select category_id is null from app.store_items where id = :it_m1),
  'C13 deleting a category leaves its items uncategorised and in the section they were in');

-- ── D. Who reads and writes is unchanged ─────────────────────────────────────────────
select pg_temp.assert(not exists (select 1 from pg_policies where schemaname = 'app' and tablename in ('store_categories', 'store_items')
                                    and (coalesce(qual, '') ilike '%section%' or coalesce(with_check, '') ilike '%section%')),
  'D1 no policy on the two tables mentions the section');

select pg_temp.sign_in(:u_lead);
insert into app.store_categories (id, center_id, name, section) values (:cat_lead, :c, 'Lead category 821', 'food');
insert into app.store_items (id, center_id, category_id, name, price_cents) values (:it_lead, :c, :cat_lead, 'Lead item 821', 900);
update app.store_categories set sort_order = 5 where id = :cat_lead;
select pg_temp.assert(pg_temp.sec('store_categories', :cat_lead) = 'food' and pg_temp.sec('store_items', :it_lead) = 'food',
  'D2 a store lead adds a category and an item and the section is there, as any other column');

reset role;
select pg_temp.sign_in(:u_nobody);
select pg_temp.assert_raises($$insert into app.store_categories (center_id, name, section) values ('82100000-0000-4000-8000-0000000000c1', 'Nobody 821', 'food')$$,
  'row-level security', 'D3 a person with no store role cannot add a category');
select pg_temp.assert_raises($$insert into app.store_items (center_id, name, price_cents) values ('82100000-0000-4000-8000-0000000000c1', 'Nobody 821', 100)$$,
  'row-level security', 'D4 or an item');

reset role;
select pg_temp.sign_in(:u_other);
update app.store_categories set section = 'market' where id = :cat_lead;
update app.store_items set section = 'market' where id = :it_lead;
reset role;
select pg_temp.assert(pg_temp.sec('store_categories', :cat_lead) = 'food' and pg_temp.sec('store_items', :it_lead) = 'food',
  'D5 another community''s store lead cannot move this community''s rows to another section');

-- A guest: an open community's active items and all its categories, as before; the section comes with the row.
insert into app.store_items (id, center_id, name, price_cents, status) values (:it_paused, :c, 'Paused item 821', 400, 'paused');
select set_config('request.jwt.claims', '', true);
set role anon;
select pg_temp.assert((select count(*) from app.store_items where center_id = :c and status = 'active') >= 4
                      and not exists (select 1 from app.store_items where center_id = :c and status <> 'active'),
  'D6 a guest reads the active items of an open community and not the paused ones');
select pg_temp.assert((select count(*) from app.store_categories where center_id = :c) >= 2
                      and (select bool_and(section in ('food', 'market')) from app.store_categories where center_id = :c),
  'D7 a guest reads the categories, each with its section');
select pg_temp.assert((select count(*) from app.store_items where center_id = :c and section = 'market' and status = 'active') = 2,
  'D8 a guest can read a market item at the database level, exactly as any other active item (the apps decide what to show)');
reset role;

rollback;
\echo 'PASS: store sections tests'
