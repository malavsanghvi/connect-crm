# Store sections: Food now, the Community Market later

Status: built 2026-10-15 (migration 0821, test 821, the portal's Menu & pickup and Inventory pages). Owner request, 2026-10-15:
"in the store - reorg a bit.. Have Food section and put all current food items in there. then say Marketplace style people can
offer their services there - for example memories book printing, laser engraving pieces, gift articles, many community related
products organized."

This is the first half and only that: the store gets **sections above its categories**, every existing category and item is in
the **Food** section, and the portal shows Food as the section. Nothing is built for the second section. Its plan is
[`STORE_MARKETPLACE.md`](STORE_MARKETPLACE.md).

## 1. The words (a naming warning)

"Marketplace" already names Weaver's catalog of paid products an organization turns on (Settings › Marketplace,
[`MARKETPLACE_PLAN.md`](MARKETPLACE_PLAN.md), [`MARKETPLACE_PACKS.md`](MARKETPLACE_PACKS.md)). The owner's word here is a different
thing: a place **inside a community's store** where members and approved vendors offer their own products and services. So:

| What | Choice | Why |
|---|---|---|
| Data key of the second section | `market` | Neutral, short, and never the word Weaver's catalog already uses. A key never changes ([`MARKETPLACE_PACKS.md`](MARKETPLACE_PACKS.md) P6), so this is chosen carefully. |
| Label of the second section | **Community Market** (proposed) | The owner's idea, with a word that cannot be mistaken for Settings › Marketplace. The label is copy in one place (`STORE_SECTION_LABELS`, `src/lib/store-sections.ts`) and can be changed at any time; "Community Marketplace" is the owner's word with a qualifier and works too. **The owner decides** (decision 1 in [`STORE_MARKETPLACE.md`](STORE_MARKETPLACE.md)). |
| Label of the first section | **Food** | The owner's word. |

## 2. What changed in the database (0821)

| Piece | What it does |
|---|---|
| `app.store_categories.section`, `app.store_items.section` | `text not null default 'food'`, checked to be `food` or `market` (constraints `store_categories_section_valid`, `store_items_section_valid`). |
| The existing rows | Adding the column with its default puts every category and every item that exists when the migration runs in **Food**. Nothing is rewritten. Test 821 proves it with the migration's own statement on a table that already has rows, and checks the seed's store. |
| A row written without a section | Is in Food. The portal before this change, the importers, the demo-pack loader and any installed app write that way; none of them needed a change. |
| Trigger `store_items_follow_section` | An item **with a category always has its category's section** (before insert, and before an update of `category_id` or `section`). An item with no category keeps the section it was given. So the two columns cannot disagree, and the rule for every app is: an item's section is its category's. It never fires for a stock or price change. |
| Trigger `store_categories_section_moves_items` | When a category changes section its items go with it. |
| Deleting a category | Its items become uncategorised and stay in the section they were in. |

Why the column is on **both** tables: an item can have no category (`category_id` is optional and goes to null when its category is
deleted) and still belongs to a section; and an app that wants "the market's items" asks one table. A reference table of sections
was considered and rejected: it would be a new table with its own RLS and `module_tables` row for two fixed values, the opposite of
a small slice, and the keys are fixed in the apps anyway. A new section later is a new migration that widens the check.

**Unchanged on purpose:** no policy, grant, function or trigger that carries a money rule. Who reads and writes a store's rows is
exactly what it was (the table below). Test 821 asserts that no policy on either table mentions `section`. The unique name of a
category stays per community (`unique (center_id, name)`), so a market category cannot reuse the name of a food category; a name
in the other section is a different word in practice (Mithai against Gifts) and the import engine matches categories by that name.

## 3. What the portal does

Store › **Menu & pickup** and Store › **Inventory** show the store one section at a time.

- **Food is always there**, as a "Store section" heading with one tab, **Food**, and the card says "In the Food section · 9 items in
  3 categories". Everything that exists today is in it, so a community sees what it saw, under a heading.
- **Adding** an item or a category puts it in the section the page is on (the form carries `section`; a stale form with none
  writes to Food). The categories offered for an item are that section's. Editing an item never changes its section; it moves only
  by changing its category.
- **Ordering and pickup** (Order and pickup settings, Pickup slots, Orders by pickup, the kitchen display) are how Food sells and
  stay Food's.
- **The second section appears only when there is something to put in it.** `visibleSections()` in `src/lib/store-sections.ts` is the
  one switch: Food always, and a second section only when it holds a category or an item. No tab, teaser, count or "coming soon" is
  drawn for a section that is empty.
- **And nothing can put anything in it yet.** `STORE_SECTION_OPEN` says the market is not open for new rows, so the two Server
  Actions refuse a market entry in plain words ("… the Community Market section is not open for new entries yet.") and write
  nothing. The reason is the member app: an installed build reads every active item and every category with no notion of sections,
  so a market row would show up among the food. The market's build opens this flag **after** the app that groups by section is
  released (section 5, "Order of work").

## 4. The contract the member app reads

For the connect-mobile builder. The app has nothing to call that it did not have; the only new thing is one column.

### 4.1 What it reads today, and what stays true

`loadStore(centerId)` in `src/lib/api/store.ts` reads `store_categories` (`select('*')`, ordered by `sort_order`) and active
`store_items` (`select('*')`, ordered by `name`). Both now carry `section` (`'food' | 'market'`, typed `string` in
`database.types.ts`, which this change regenerates; the owner's routine copies it to connect-mobile and connect-admin). Nothing
else about those two reads changes: the same tables, the same filters, the same rows.

### 4.2 How to group: sections → categories → items

1. Read both tables as today.
2. **Group by `section`.** The known sections are `food` and `market`. A row whose `section` is any other value (a newer portal
   wrote a section this build does not know) is **not shown**; do not guess a place for it.
3. **A section is shown only if it has at least one active item.** A category with no items does not make a section appear.
4. **One section with items: no switch.** Draw the store exactly as it is today. This is every store today (all Food), so the
   screen does not change for anyone until a second section has items.
5. **Two sections with items: a switch** (a segmented control or two chips) above the category chips, in the order Food, then the
   Community Market, with the section's label from the app's own strings (key it by section: `store.section.food`,
   `store.section.market`; the market's name is the owner's to choose, so ship no market string before it is decided).
   Remember the choice for the visit; start on Food.
6. **Inside a section** the existing screen: "All" and one chip per category **of that section** (`sort_order`), then the items.
   An item with no category (`category_id` null) shows under "All" only, as today.
7. **An item's section is its category's section** (the trigger guarantees it), so `item.section` can be trusted on its own:
   group items by `item.section`, categories by `category.section`.

```ts
const SECTIONS = ['food', 'market'] as const;
type Section = (typeof SECTIONS)[number];
function sectionsWithItems(items: StoreItem[]): Section[] {
  return SECTIONS.filter((s) => items.some((i) => i.section === s)); // known keys only, in order
}
// switch visible when sectionsWithItems(items).length > 1
// categories of the chosen section: categories.filter((c) => c.section === chosen)
// items of the chosen section:      items.filter((i) => i.section === chosen && (!category || i.category_id === category))
```

### 4.3 Selling

Only a **`food`** item goes in the cart, a pickup window and an order (`store_orders`, `store_order_lines`, the 0120 pricing and
stock rules, cancel and pickup). The Community Market will not use that flow; its listings, inquiries and orders are a separate
design ([`STORE_MARKETPLACE.md`](STORE_MARKETPLACE.md)), and the app must not add a `market` item to the cart. Until the market is
built there are no market rows, so there is nothing to guard against yet; write the check anyway, it is one line.

### 4.4 Who can read what: unchanged

| Reader | Categories | Items |
|---|---|---|
| A guest (anon) of an open community | all (`store_categories_public`) | `status = 'active'` (`store_items_public`) |
| A signed-in member | all | active |
| Staff (`store.view` / `store.manage`) | all | all statuses |
| Anyone, when the Store module is off | none (restrictive `module_switch`, 0740) | none |
| A guest, for a demo community while the demo is off | none (restrictive `demo_guest_gate`, 0816) | none |

`section` is readable wherever its row is, exactly like `name`. The database does **not** hide market rows from anyone who can read
food rows; **the apps decide what to show**. (If the market later needs a stricter read, for example a listing visible only once a
seller is approved, that is a policy change made in the market's own migration, with the owner's approval.) The Store's own setting
"Store visible to: Members only" is applied by the app as before.

### 4.5 Order of work (this is the reason for the closed door)

1. This change: the column, the portal, this contract. **No market row can be created.**
2. connect-mobile: read `section` as above and ship it (an OTA is enough when no native change is needed). With only Food rows
   the screen is unchanged.
3. The market's build: sellers, listings, categories ([`STORE_MARKETPLACE.md`](STORE_MARKETPLACE.md), slice 1), which opens
   `STORE_SECTION_OPEN.market` and adds the market's own module switch and the app's flag for it.

An installed app older than step 2 ignores `section` and would list market items among the food; the market's build must therefore
wait for step 2 to be the minimum app version in use, or hold the market behind its own `member_experience` flag that only the new
app reads (the plan's recommendation).

## 5. Other readers in this repository, for when a market row exists

Nothing below is wrong today (every row is Food). Each should be looked at by the slice that creates the first market row.

| Reader | Today | When the market exists |
|---|---|---|
| `app.site_draft_data` (0751, the website draft: first 8 active store item names) | all active items | Read Food only, or say the section. |
| Niva commands `store.products`, `store.draft_product` (`src/lib/commands/catalog/store`) | all items, with the category name | Add the section to the answer; price-change and stock commands stay Food. |
| Orders by pickup, kitchen display (`/ops/[eventId]/kitchen`), pickup windows, `store_sales_summary` (0670), the `reports_*` store reads (0672) | read order lines | Food by nature: only Food items can be ordered. No change. |
| Import engine: "Store categories", "Store items and opening stock" (0192 and its redefinitions) | create rows naming no section | Food. The market has its own import, or a `section` column, when it needs one. |
| Sandbox promotion (0203 `promotion_copy_table`) | copies `store_categories` column by column | Copies `section` with the rest. Items are not copied (as before). |
| Demo packs (0312, 0628, 0786, 0797, 0798; the loader `app.demo_put`) | name only the columns they list | Every demo store row is Food. **The neutral demo's "Club shop" (T-shirt, tote bag, mug, cookbook, lemon bars) is not food**, and is under the Food heading until the demo pack puts the shop in the Community Market or gives the first section another label for that kind. Left for the demo-data owner and the owner's call. |
| Low-stock tasks and home tiles (`src/lib/data/home-tasks.ts`, `home-kpis.ts`) | count items | Count Food only (stock is a Food concern) or all; decide with the market. |

## 6. Tests

- Database: `supabase/tests/821_store_sections_test.sql`. A: every row that exists is in Food (the seed's store, and the migration's
  statement on a table that already has rows); a row with no section is Food; the demo loader's rows are Food. B: only `food` and
  `market` are keys. C: an item follows its category, in every direction, and the move is audited. D: no policy mentions the
  section; a store lead writes both columns; a person with no store role and another community's store lead cannot; a guest reads
  active items and all categories, with the section.
- Unit: `tests/store-sections.test.ts` (keys, the switch, the section a page is on, the tabs), `tests/store-sections-actions.test.ts`
  (what the two actions write and refuse), `tests/store-sections-pages.test.ts` (what the pages draw for a food-only store, which
  must never mention a market, and for a store that holds a second section's rows).
- Not covered: a real Postgres on a developer machine (none here); the database tests run in CI.
