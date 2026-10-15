// What the store pages draw once the store has sections (0821) and the Community Market exists (0830). The repo has no browser test
// environment, so each route is rendered once on the server with a fake signed-in session and a fake database.
//   - A community that does not have the Community Market (every community until Weaver grants it): one section, "Food", as a heading
//     with its items and categories, the ordering and pickup cards and forms that add to Food. No Community Market tab, teaser, start
//     card or "coming soon" anywhere, however the page is asked.
//   - A community that has it on but has put nothing in it: still only Food on Menu & pickup (a second tab only once it holds something).
//     The market's own page opens, so the first category can be added: it offers the starter categories.
//   - A community whose market holds listings: two tabs, one section at a time; the other section's rows are not mixed in.
//   - A person who runs only the market (market.manage, no store permission) sees the market's page and nothing of Food.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stub = vi.hoisted(() => ({ session: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("next/navigation", async (actual) => ({
  ...(await actual<typeof import("next/navigation")>()),
  usePathname: () => "/store/menu",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => stub.session),
  authorizeAction: vi.fn(),
  authorizeActionWhere: vi.fn(),
  loadSession: vi.fn(async () => ({ status: "ok", session: stub.session })),
  dbWithReason: vi.fn(),
}));

import StoreInventoryPage from "@/app/(app)/store/page";
import CommunityMarketPage from "@/app/(app)/store/market/page";
import StoreMenuPage from "@/app/(app)/store/menu/page";

import { LEGACY_KIND } from "@/lib/kind";

import { contentStoreDb, csSession, STORE_STAFF } from "./commands/content-store-world";

type Row = Record<string, unknown>;
const center_id = "center-1";
const FOOD_CAT = "ca000000-0000-4000-8000-0000000000f1";
const MARKET_CAT = "ca000000-0000-4000-8000-0000000000f2";

function item(id: string, name: string, section: string, over: Row = {}): Row {
  return { id, center_id, category_id: null, sku: null, name, description: null, price_cents: 800, pack_size: null, status: "active", taxable: true, gift_pack: true, track_inventory: false, stock_on_hand: 0, low_stock_threshold: null, section, custom: {}, ...over };
}

const FOOD_ONLY = {
  store_categories: [{ id: FOOD_CAT, center_id, name: "Mithai", sort_order: 1, section: "food" }],
  store_items: [item("i-1", "Mohanthal", "food", { category_id: FOOD_CAT }), item("i-2", "Chakri", "food")],
};
const WITH_MARKET = {
  store_categories: [
    { id: FOOD_CAT, center_id, name: "Mithai", sort_order: 1, section: "food" },
    { id: MARKET_CAT, center_id, name: "Gift articles", sort_order: 1, section: "market" },
  ],
  store_items: [item("i-1", "Mohanthal", "food", { category_id: FOOD_CAT }), item("i-2", "Chakri", "food"), item("i-3", "Memory book printing", "market", { category_id: MARKET_CAT })],
};

/** `market`: Weaver has granted the Community Market to this community (it is off for every kind until then). */
function signIn(tables: Record<string, Row[]>, opts: { permissions?: string[]; market?: boolean } = {}) {
  const world = contentStoreDb({ tables: { ...tables, pickup_windows: [], events: [], inventory_movements: [], custom_field_definitions: [] } });
  stub.session = csSession(world.db, {
    permissions: opts.permissions ?? [...STORE_STAFF, "settings.manage"],
    kind: LEGACY_KIND,
    modulesOff: opts.market ? [] : ["market"],
    modulesStatus: "ok",
  });
}

const menu = async (section?: string) => renderToStaticMarkup(await StoreMenuPage({ searchParams: Promise.resolve(section ? { section } : {}) }));
const inventory = async (section?: string) => renderToStaticMarkup(await StoreInventoryPage({ searchParams: Promise.resolve(section ? { section } : {}) }));
const marketPage = async () => renderToStaticMarkup(await CommunityMarketPage());

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Menu & pickup of a community without the Community Market (every community today)", () => {
  it("shows Food as the section, with its items and categories, the ordering cards and forms that add to Food", async () => {
    signIn(FOOD_ONLY);
    const html = await menu();
    expect(html).toContain("Store section");
    expect(html).toContain(">Food<");
    expect(html).toContain("In the Food section");
    expect(html).toContain("2 items in 1 category");
    expect(html).toContain("Mohanthal");
    expect(html).toContain("Chakri");
    expect(html).toContain("Order and pickup settings");
    expect(html).toContain("Pickup slots");
    expect(html).toContain("Goes in the Food section");
    expect(html.match(/name="section" value="food"/g)).toHaveLength(2); // the item form and the category form
  });

  it("says nothing about a Community Market to anyone: no tab, no teaser, no start card, no coming soon", async () => {
    signIn(FOOD_ONLY);
    for (const html of [await menu(), await inventory(), await menu("market"), await inventory("market")]) {
      expect(html).not.toMatch(/market/i);
      expect(html).not.toMatch(/coming soon/i);
      expect(html).not.toMatch(/starter categories/i);
      expect(html).toContain(">Food<");
    }
  });

  it("does not show market rows even if some were there (the database hides them from a community without the module)", async () => {
    signIn(WITH_MARKET);
    for (const html of [await menu(), await menu("market"), await inventory("market")]) {
      expect(html).not.toContain("Memory book printing");
      expect(html).not.toContain("Gift articles");
      expect(html).not.toContain("Community Market");
    }
  });

  it("refuses the market's own page in plain words", async () => {
    signIn(FOOD_ONLY);
    const html = await marketPage();
    expect(html).toContain("You don&#x27;t have access to this area");
    expect(html).not.toContain("Start the Community Market");
    expect(html).not.toContain("Add a listing");
  });

  it("shows a person who may only look the section and the items, and no form", async () => {
    signIn(FOOD_ONLY, { permissions: ["store.view"] });
    const html = await menu();
    expect(html).toContain(">Food<");
    expect(html).toContain("Mohanthal");
    expect(html).not.toContain("Goes in the Food section");
    expect(html).not.toContain('name="section"');
  });

  it("still opens with the empty store: Food, and no items yet", async () => {
    signIn({ store_categories: [], store_items: [] });
    const html = await menu();
    expect(html).toContain(">Food<");
    expect(html).toContain("0 items in 0 categories");
    expect(html).toContain("No items on the menu yet");
  });
});

describe("A community with the Community Market on but nothing in it yet", () => {
  it("shows only Food on Menu & pickup and Inventory: a second tab only once the market holds something", async () => {
    signIn(FOOD_ONLY, { market: true });
    for (const html of [await menu(), await inventory(), await menu("market")]) {
      expect(html).toContain(">Food<");
      expect(html).not.toMatch(/market/i);
      expect(html).not.toMatch(/starter categories/i);
    }
  });

  it("opens the market's own page to start it: the starter categories, and the forms for a first category and listing", async () => {
    signIn(FOOD_ONLY, { market: true });
    const html = await marketPage();
    expect(html).toContain("Start the Community Market");
    expect(html).toContain("Add the starter categories");
    expect(html).toContain("Gifts, Printing &amp; books, Personalised, Services, Community products");
    expect(html).toContain("In the Community Market section");
    expect(html).toContain("0 items in 0 categories");
    expect(html).toContain("No listings yet");
    expect(html).toContain("Add a listing");
    expect(html).toContain("Goes in the Community Market section");
    expect(html.match(/name="section" value="market"/g)).toHaveLength(2);
    // Food is not drawn on the market's page: its ordering cards and pickup slots stay on Menu & pickup.
    expect(html).not.toContain("Order and pickup settings");
    expect(html).not.toContain("Pickup slots");
    expect(html).not.toContain("Mohanthal");
    expect(html).toContain('href="/store/menu"');
  });

  it("offers the start only to a person who may change the market", async () => {
    signIn(FOOD_ONLY, { market: true, permissions: ["store.view"] });
    const html = await marketPage();
    expect(html).toContain("No listings yet");
    expect(html).not.toContain("Start the Community Market");
    expect(html).not.toContain("Add a listing");
    expect(html).not.toContain('name="section"');
  });
});

describe("A community whose Community Market holds listings", () => {
  it("shows two tabs on Menu & pickup and one section at a time; the other section's rows are not mixed in", async () => {
    signIn(WITH_MARKET, { market: true });
    const food = await menu();
    expect(food).toContain(">Food<");
    expect(food).toContain(">Community Market<");
    expect(food).toContain('href="/store/menu?section=market"');
    expect(food).toContain("Mohanthal");
    expect(food).not.toContain("Memory book printing");
    expect(food).not.toContain("Start the Community Market");

    const market = await menu("market");
    expect(market).toContain("In the Community Market section");
    expect(market).toContain("1 item in 1 category");
    expect(market).toContain("Memory book printing");
    expect(market).not.toContain("Mohanthal");
  });

  it("draws the market with its listings, its categories (with a count each) and forms to add to it; Food's ordering cards stay in Food", async () => {
    signIn(WITH_MARKET, { market: true });
    const market = await marketPage();
    expect(market).toContain("Listings");
    expect(market).toContain("Memory book printing");
    expect(market).toContain("Categories");
    expect(market).toContain("Gift articles");
    expect(market).toContain("1 listing");
    expect(market).toContain("Rename, re-order or remove");
    expect(market).toContain("Add a listing");
    expect(market).toContain("Add a category");
    expect(market).not.toContain("Start the Community Market");
    expect(market).not.toContain("Order and pickup settings");
    expect(market).not.toContain("Pickup slots");
    expect(market).not.toContain("Mohanthal");
    const food = await menu();
    expect(food).toContain("Order and pickup settings");
    expect(food).toContain("Pickup slots");
  });

  it("filters the stock the same way", async () => {
    signIn(WITH_MARKET, { market: true });
    const food = await inventory();
    expect(food).toContain("Mohanthal");
    expect(food).not.toContain("Memory book printing");
    const market = await inventory("market");
    expect(market).toContain("Memory book printing");
    expect(market).not.toContain("Mohanthal");
  });

  it("shows a person who may only look the listings and the categories, with no form and no way to rename or remove", async () => {
    signIn(WITH_MARKET, { market: true, permissions: ["market.view"] });
    const html = await marketPage();
    expect(html).toContain("Memory book printing");
    expect(html).toContain("Gift articles");
    expect(html).not.toContain("Rename, re-order or remove");
    expect(html).not.toContain("Add a listing");
    expect(html).not.toContain('name="section"');
  });
});

describe("A person who runs only the Community Market (market.manage, no store permission)", () => {
  it("reaches the market's page and the forms, and nothing of Food", async () => {
    signIn(WITH_MARKET, { market: true, permissions: ["market.manage"] });
    const html = await marketPage();
    expect(html).toContain("Memory book printing");
    expect(html).toContain("Add a listing");
    expect(html).toContain("Rename, re-order or remove");
    expect(html).not.toContain("Mohanthal");
    // Only the market's tab: there is no Food tab for someone who may not use Food.
    expect(html).not.toContain(">Food<");
    expect(html).not.toContain('href="/store/menu"');
  });

  it("is refused Menu & pickup, which is Food's", async () => {
    signIn(WITH_MARKET, { market: true, permissions: ["market.manage"] });
    const html = await menu();
    expect(html).toContain("You don&#x27;t have access to this area");
    expect(html).not.toContain("Mohanthal");
  });
});
