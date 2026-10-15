// What the store pages draw once the store has sections (0821). The repo has no browser test environment, so each route is rendered once on
// the server with a fake signed-in session and a fake database.
//   - A store that has only ever had food (every store today): one section, "Food", as a heading with the items and categories in it, the
//     ordering and pickup cards, and forms that add to Food. No Marketplace tab, teaser or "coming soon" anywhere.
//   - A store that already holds a second section's rows: two tabs, one section at a time; the other section's rows are not mixed in.
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

function signIn(tables: Record<string, Row[]>, permissions: string[] = [...STORE_STAFF, "settings.manage"]) {
  const world = contentStoreDb({ tables: { ...tables, pickup_windows: [], events: [], inventory_movements: [], custom_field_definitions: [] } });
  stub.session = csSession(world.db, { permissions, kind: LEGACY_KIND });
}

const menu = async (section?: string) => renderToStaticMarkup(await StoreMenuPage({ searchParams: Promise.resolve(section ? { section } : {}) }));
const inventory = async (section?: string) => renderToStaticMarkup(await StoreInventoryPage({ searchParams: Promise.resolve(section ? { section } : {}) }));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Menu & pickup of a store that has only food (every store today)", () => {
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
    expect(html).toContain('type="hidden" name="section" value="food"');
    expect(html.match(/name="section" value="food"/g)).toHaveLength(2); // the item form and the category form
  });

  it("says nothing about a Marketplace or a Community Market to anyone: no tab, no teaser, no coming soon", async () => {
    signIn(FOOD_ONLY);
    for (const html of [await menu(), await inventory(), await menu("market"), await inventory("market")]) {
      expect(html).not.toMatch(/market/i);
      expect(html).not.toMatch(/coming soon/i);
      expect(html).toContain(">Food<");
    }
  });

  it("asking for the market of such a store draws Food, not an empty market", async () => {
    signIn(FOOD_ONLY);
    expect(await menu("market")).toContain("In the Food section");
  });

  it("shows a person who may only look the section and the items, and no form", async () => {
    signIn(FOOD_ONLY, ["store.view"]);
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

describe("Inventory of a store that has only food", () => {
  it("shows Food as the section above the stock", async () => {
    signIn(FOOD_ONLY);
    const html = await inventory();
    expect(html).toContain("Store section");
    expect(html).toContain(">Food<");
    expect(html).toContain("In the Food section");
    expect(html).toContain("Mohanthal");
  });
});

describe("A store that already holds a second section's rows", () => {
  it("shows two tabs and one section at a time; the other section's rows are not mixed in", async () => {
    signIn(WITH_MARKET);
    const food = await menu();
    expect(food).toContain(">Food<");
    expect(food).toContain(">Community Market<");
    expect(food).toContain('href="/store/menu?section=market"');
    expect(food).toContain("Mohanthal");
    expect(food).not.toContain("Memory book printing");

    const market = await menu("market");
    expect(market).toContain("In the Community Market section");
    expect(market).toContain("1 item in 1 category");
    expect(market).toContain("Memory book printing");
    expect(market).not.toContain("Mohanthal");
  });

  it("does not offer to add to a section that is not open, and leaves the kitchen's ordering cards in Food", async () => {
    signIn(WITH_MARKET);
    const market = await menu("market");
    expect(market).toContain("is not available yet");
    expect(market).not.toContain('name="section"');
    expect(market).not.toContain("Order and pickup settings");
    expect(market).not.toContain("Pickup slots");
    const food = await menu();
    expect(food).toContain("Order and pickup settings");
    expect(food).toContain("Pickup slots");
  });

  it("filters the stock the same way", async () => {
    signIn(WITH_MARKET);
    const food = await inventory();
    expect(food).toContain("Mohanthal");
    expect(food).not.toContain("Memory book printing");
    const market = await inventory("market");
    expect(market).toContain("Memory book printing");
    expect(market).not.toContain("Mohanthal");
  });
});

