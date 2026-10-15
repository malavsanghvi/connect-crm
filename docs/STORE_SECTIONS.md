# Store sections: Food, and the Community Market

Status: sections built 2026-10-15 (migration 0821, test 821); **the Community Market's first slice built 2026-10-15** (migration 0830,
test 830, section 7). Owner request, 2026-10-15: "in the store - reorg a bit.. Have Food section and put all current food items in
there. then say Marketplace style people can offer their services there - for example memories book printing, laser engraving
pieces, gift articles, many community related products organized." The owner accepted the plan's recommendations (CM1 to CM24 in
[`STORE_MARKETPLACE.md`](STORE_MARKETPLACE.md)) the same day.

The store has **sections above its categories**. Every category and item that existed is in the **Food** section. The second
section, the **Community Market**, is a Marketplace product that is **off for every community until Weaver grants it**; in this first
slice it holds the community's own non-food products and services (no sellers other than the community, no new tables, no money).

## 1. The words (a naming warning)

"Marketplace" already names Weaver's catalog of paid products an organization turns on (Settings › Marketplace,
[`MARKETPLACE_PLAN.md`](MARKETPLACE_PLAN.md), [`MARKETPLACE_PACKS.md`](MARKETPLACE_PACKS.md)). The owner's word here is a different
thing: a place **inside a community's store**. So:

| What | Choice | Why |
|---|---|---|
| Data key of the second section, and key of the module | `market` | Neutral, short, and never the word Weaver's catalog already uses. A key never changes ([`MARKETPLACE_PACKS.md`](MARKETPLACE_PACKS.md) P6). |
| Label of the second section | **Community Market** (owner's choice, CM1) | The label is copy in one place (`STORE_SECTION_LABELS`, `src/lib/store-sections.ts`) and the Marketplace card; it can change at any time, the key cannot. |
| Label of the first section | **Food** | The owner's word. |

## 2. What changed in the database (0821, then 0830)

| Piece | What it does |
|---|---|
| `app.store_categories.section`, `app.store_items.section` (0821) | `text not null default 'food'`, checked to be `food` or `market` (constraints `store_categories_section_valid`, `store_items_section_valid`). |
| The existing rows (0821) | Adding the column with its default puts every category and every item that exists in **Food**. Nothing is rewritten. |
| A row written without a section | Is in Food. The portal before sections, the importers, the demo-pack loader and any installed app write that way. |
| Trigger `store_items_follow_section` (0821) | An item **with a category always has its category's section**. An item with no category keeps the section it was given. So the rule for every app is: an item's section is its category's. It never fires for a stock or price change. |
| Trigger `store_categories_section_moves_items` (0821) | When a category changes section its items go with it. |
| Deleting a category | Its items become uncategorised and stay in the section they were in. |
| The module `market` (0830) | "Community Market", depends on the Store, **off for every kind of organization** (`default_off`, rule P5). Weaver turns it on for one community (`app.set_module_grant`, a reason and a fresh 2FA check); the community may pause and resume it. Nothing changes for a community until then. |
| Permissions and role (0830) | `market.view`, `market.manage`, `market.moderate`; the role `market_lead` holds all three. The store lead keeps the Food section and, through `store.manage`, can also run the market's listings. |
| Policies (0830, rollback in the migration's header) | **Restrictive `market_section_switch`** on both tables: a market row can be read or written only while the community has the market on (and its Store), or by a platform admin. **Permissive `store_categories_market_write`, `store_items_market_write`**: `market.manage` writes market rows, and only market rows. **Permissive `store_items_market_read`**: `market.view` and `market.moderate` read market items that are not on sale. Every earlier policy is untouched. |

Why the column is on **both** tables: an item can have no category and still belongs to a section; and an app that wants "the market's
items" asks one table. A reference table of sections was rejected (a new table with RLS for two fixed values). A new section later is a
new migration that widens the check.

**Unchanged on purpose:** no policy, grant, function or trigger that carries a money rule: orders, order lines, payments, refunds,
pickup slots, ledger postings. The unique name of a category stays per community (`unique (center_id, name)`), so a market category
cannot reuse the name of a Food category.

## 3. What the portal does

- **Store › Menu & pickup and Inventory** show the store one section at a time. **Food is always there**, as a "Store section" heading
  with one tab, **Food**, and the card says "In the Food section · 9 items in 3 categories". Adding an item or a category puts it in the
  section the page is on. Editing an item never changes its section; it moves only by changing its category.
- **The Community Market tab appears beside Food only while the community has the market on AND the section holds a category or a
  listing** (`visibleSections()` in `src/lib/store-sections.ts`, the one switch). A community without the market sees no tab, no
  teaser, no count and no "coming soon", and the database hides any market row from it.
- **Store › Community Market** (`/store/market`, a tab of the Store only while the market is on, for a person with `store.view`,
  `store.manage`, `market.view`, `market.manage` or `market.moderate`) always opens, so the market can be started. Empty, it offers the
  starter categories (Gifts, Printing & books, Personalised, Services, Community products: the owner's examples; any can be renamed or
  removed, and a name already used by a Food category is left out and said so). Then: **Listings** (the table with an edit drawer: a
  listing is a store item filed in the market; status Active, Paused or Retired is how it is hidden), **Categories** (rename, re-order,
  remove with a confirmation: removing a category keeps its listings, without a category), **Add a listing**, **Add a category**.
  Who may change it: the store's manager or `market.manage`; `market.view` and `market.moderate` read only.
- A person who has only `market.manage` (the Community Market lead) has the Store's Community Market tab and nothing of Food.
- **Ordering and pickup** (Order and pickup settings, Pickup slots, Orders by pickup) are how Food sells and stay Food's. The kitchen's
  prep list (Orders by pickup, and the event-day kitchen display) shows Food's lines only: a T-shirt in an order is not on the prep list.
- **Not in this slice:** a featured shelf (it needs a column and the app's agreement), sellers other than the community, seller
  applications, inquiries, reviews, any payment other than what the store already does.

## 4. The contract the member app reads

For the connect-mobile builder. The app has nothing new to call; the new things are one column and the rules below.

### 4.1 What it reads today, and what stays true

`loadStore(centerId)` in `src/lib/api/store.ts` reads `store_categories` (`select('*')`, ordered by `sort_order`) and active
`store_items` (`select('*')`, ordered by `name`). Both carry `section` (`'food' | 'market'`, typed `string` in `database.types.ts`).
Nothing else about those two reads changes: the same tables, the same filters.

### 4.2 How to group: sections → categories → items

1. Read both tables as today.
2. **Group by `section`.** The known sections are `food` and `market`. A row whose `section` is any other value (a newer portal wrote a
   section this build does not know) is **not shown**; do not guess a place for it.
3. **A section is shown only if it has at least one active item.** A category with no items does not make a section appear.
4. **One section with items: no switch.** Draw the store exactly as it is today.
5. **Two sections with items: a switch** (a segmented control or two chips) above the category chips, in the order Food, then the
   Community Market, with the section's label from the app's own strings (`store.section.food`, `store.section.market`; the market's
   English label is "Community Market", the owner's choice). Remember the choice for the visit; start on Food.
6. **Inside a section** the existing screen: "All" and one chip per category **of that section** (`sort_order`), then the items. An item
   with no category shows under "All" only, as today.
7. **An item's section is its category's section** (the trigger guarantees it), so `item.section` can be trusted on its own.

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

In this slice a market listing is an **ordinary store item** (the community's own product): it goes in the same cart, the same pickup
window and the same order as any item (`store_orders`, `store_order_lines`, the 0120 pricing and stock rules). **Do not special-case
it.** The portal's kitchen prep list leaves it out; the app has nothing to do for that. Listings by sellers other than the community
(a later slice, [`STORE_MARKETPLACE.md`](STORE_MARKETPLACE.md)) will **not** be store items and will not use this flow; the app is told
before that slice ships.

### 4.4 Who can read what

| Reader | Categories | Items |
|---|---|---|
| A guest (anon) of an open community | all (`store_categories_public`) | `status = 'active'` (`store_items_public`) |
| A signed-in member | all | active |
| Staff (`store.view` / `store.manage`, `market.view`, `market.manage`, `market.moderate` for the market) | all | all statuses |
| Anyone, when the Store module is off | none (restrictive `module_switch`, 0740) | none |
| **Anyone, for market rows, when the Community Market is not on for the community** (never granted, paused, or its Store off) | **none (restrictive `market_section_switch`, 0830)** | **none** |
| A guest, for a demo community while the demo is off | none (restrictive `demo_guest_gate`, 0816) | none |

**What the app can rely on:** for a community without the market, no market row is ever returned, so a food-only store is unchanged;
for a community with it, market rows are returned like any active store row and the app decides what to show. The module appears in
`app.my_modules` / `member_experience.modules` as `market` (on or off) if the app wants to know; it does not need to, since the
rows say it. `section` is readable wherever its row is. The Store's own setting "Store visible to: Members only" is applied by the app
as before. Guests are not given anything the store did not already give them.

### 4.5 Order of work

1. 0821 (done): the column, Food, this contract.
2. 0830 (done, this change): the module, the permissions and role, the policies, the portal's Community Market, the kitchen filter.
   **A community can now have market rows**, but only one that Weaver has deliberately granted the market to.
3. connect-mobile (in parallel): read `section` as in 4.2 and ship it. **An app older than this ignores `section` and would list the
   market's items among the food for a community that has the market on**; Weaver checks the app situation before granting the market
   to a community, and the market is off by default, so the exposure is that community only. Do not wait for the market to build the
   switch: with only Food rows it changes nothing on screen.

## 5. Other readers in this repository, for when market rows exist

Each should be looked at by the slice that grows the market. Nothing below is wrong for a community without the market.

| Reader | Today | With the market |
|---|---|---|
| `app.site_draft_data` (0751, the website draft: first 8 active store item names) | all active items | Lists market items too when the market is on. Read Food only, or say the section, when the website is built. |
| Niva commands `store.products`, `store.draft_product` (`src/lib/commands/catalog/store`) | all items, with the category name | List market items too. Add the section to the answer; price and stock commands apply to any store item. |
| Orders by pickup (the prep list) and the event-day kitchen display (`/ops/[eventId]/kitchen`) | order lines | **Done (0830): Food's lines only.** The pickup list and slot counts still count every order, so a T-shirt order is handed over. connect-admin has its own kitchen display (`src/app/ops/[eventId]/kitchen`) and store page, which read order lines and need the same one-line filter on `store_items.section`; that is a change in that repository. |
| `store_sales_summary` (0670), the `reports_*` store reads (0672) | order lines | Count market items sold through the cart as sales, which they are. Split by section is a later report. |
| Import engine: "Store categories", "Store items and opening stock" | create rows naming no section | Food. The market has its own import when it needs one. |
| Sandbox promotion (0203 `promotion_copy_table`) | copies `store_categories` column by column | Copies `section` with the rest. Items are not copied. |
| Demo packs (0312, 0628, 0786, 0797, 0798, 0820; `app.demo_put`) | name only the columns they list | Every demo store row is Food. The demo communities do not have the market, so the neutral demo's "Club shop" (T-shirt, tote bag, mug, cookbook, lemon bars, which is not food) is still under the Food heading. Moving it needs the demo to hold the market, and with it a demo person for the Community Market lead; left for the demo-data owner (see the pull request). |
| Low-stock tasks and home tiles (`src/lib/data/home-tasks.ts`, `home-kpis.ts`) | count items | Count market items too (stock is the store's); decide with the market's growth. |

## 6. Tests

- Database: `supabase/tests/821_store_sections_test.sql` (sections: Food by default, the check, an item follows its category, the policies
  mention no section) and `supabase/tests/830_community_market_test.sql` (the module off for every kind and every community; the role;
  while off the market's rows are invisible and unwritable to everyone but a platform admin; once granted who reads and writes what,
  including that the market lead writes only market rows and cannot move one into Food; a pause and the Store off hide it again;
  removing a category keeps its listings; the policies by name, and that every earlier policy is still there).
- Unit: `tests/store-sections.test.ts` (keys, the module gate that fails closed, the switch, the section a page is on, the tabs),
  `tests/store-sections-actions.test.ts` (what the actions write and refuse, the starter categories, rename and remove),
  `tests/store-sections-pages.test.ts` (what the pages draw without the market, with it empty, with listings, and for a person who runs
  only the market).

## 7. The Community Market, slice 1 (0830): what was decided and built

The owner accepted every recommendation of [`STORE_MARKETPLACE.md`](STORE_MARKETPLACE.md) section 16 on 2026-10-15. Slice 1 is
**community-run listings only**: no seller applications, no money, no new tables. Built: the module row and its Marketplace card
(Settings › Marketplace shows "Community Market", **Request**, no price); the permissions and role; the policies; `STORE_SECTION_OPEN`
replaced by the module (`sectionOpen()`); the portal's Community Market page and its start; the kitchen filter. Not built (later slices):
the featured shelf, sellers, inquiries, orders as a record, reviews, paying through the community. Moving the neutral demo's Club shop
into the market is not done (section 5).
