// Adding a category or an item puts it in the section the page was on (0821). A form that names no section (a page left open from before
// sections) writes to Food. The Community Market (0830) takes new rows only while the community has it on, from the store's manager or
// market.manage; a section that does not exist is refused in plain words; editing an item never posts or changes a section. The market's
// starter categories, and renaming and removing a market category, are here too.
import { beforeEach, describe, expect, it, vi } from "vitest";

const stub = vi.hoisted(() => ({ session: null as unknown, refusal: null as string | null, asked: [] as { key: string; doing: string }[] }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/session", () => ({
  authorizeAction: vi.fn(async (key: string, doing: string) => {
    stub.asked.push({ key, doing });
    return stub.refusal ? { ok: false, error: stub.refusal } : { ok: true, session: stub.session };
  }),
  authorizeActionWhere: vi.fn(),
  loadSession: vi.fn(async () => ({ status: "ok", session: stub.session })),
  dbWithReason: vi.fn(),
}));

import { removeMarketCategoryAction, saveCategoryAction, saveItemAction, saveMarketCategoryAction, startMarketAction } from "@/app/(app)/store/actions";

import { ALL_STAFF, contentStoreDb, csSession, W } from "./commands/content-store-world";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

/** `market`: the Community Market is on for the community (Weaver granted it). Off is the real default for every kind. */
function setup(opts: { market?: boolean; failTables?: Record<string, { message: string }>; tables?: Record<string, Record<string, unknown>[]> } = {}) {
  const world = contentStoreDb({ failTables: opts.failTables });
  if (opts.tables) Object.assign(world.tables, opts.tables);
  stub.session = csSession(world.db, { permissions: ALL_STAFF, modulesOff: opts.market ? [] : ["market"], modulesStatus: "ok" });
  stub.refusal = null;
  stub.asked = [];
  return world;
}

const item = { name: "Samosa pack", price: "8.99", status: "active" };
const NOT_ON = "the Community Market is not on for your community. An administrator can ask for it in Settings › Marketplace.";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("saveCategoryAction: the section", () => {
  it("adds the category to the section the form carries (Food), asking for the store manager", async () => {
    const { inserts } = setup();
    expect(await saveCategoryAction(null, form({ name: "Mithai", sort_order: "1", section: "food" }))).toStrictEqual({ ok: true, message: 'Category "Mithai" added.' });
    expect(inserts).toStrictEqual([{ table: "store_categories", rows: { center_id: "center-1", name: "Mithai", sort_order: 1, section: "food" } }]);
    expect(stub.asked[0]).toStrictEqual({ key: "storeManage", doing: "add the category" });
  });

  it("adds it to Food when the form names no section (a page left open from before sections)", async () => {
    const { inserts } = setup();
    expect(await saveCategoryAction(null, form({ name: "Namkeen", sort_order: "2" }))).toStrictEqual({ ok: true, message: 'Category "Namkeen" added.' });
    expect(inserts[0].rows.section).toBe("food");
  });

  it("adds a Community Market category while the market is on, asking for the store manager or market.manage", async () => {
    const { inserts } = setup({ market: true });
    expect(await saveCategoryAction(null, form({ name: "Gifts", sort_order: "1", section: "market" }))).toStrictEqual({ ok: true, message: 'Category "Gifts" added.' });
    expect(inserts).toStrictEqual([{ table: "store_categories", rows: { center_id: "center-1", name: "Gifts", sort_order: 1, section: "market" } }]);
    expect(stub.asked[0]).toStrictEqual({ key: "marketManage", doing: "add the category" });
  });

  it("refuses the Community Market while it is not on, and a section that does not exist, and writes nothing", async () => {
    const { inserts } = setup();
    expect(await saveCategoryAction(null, form({ name: "Gifts", section: "market" }))).toStrictEqual({ ok: false, error: `Could not add the category — ${NOT_ON}` });
    expect(await saveCategoryAction(null, form({ name: "Gifts", section: "marketplace" }))).toStrictEqual({
      ok: false,
      error: "Could not add the category — that store section does not exist.",
    });
    expect(inserts).toStrictEqual([]);
  });

  it("refuses the Community Market when the module list could not be read (the market fails closed)", async () => {
    const world = contentStoreDb();
    stub.session = csSession(world.db, { permissions: ALL_STAFF, modulesOff: [], modulesStatus: "error" });
    stub.refusal = null;
    expect(await saveCategoryAction(null, form({ name: "Gifts", section: "market" }))).toStrictEqual({ ok: false, error: `Could not add the category — ${NOT_ON}` });
    expect(world.inserts).toStrictEqual([]);
  });

  it("still asks for a name first, and the permission before anything", async () => {
    setup();
    expect(await saveCategoryAction(null, form({ name: "", section: "food" }))).toStrictEqual({ ok: false, error: "Could not add the category — give it a name." });
    stub.refusal = "Could not add the category — you don't have permission (needs store.manage).";
    expect(await saveCategoryAction(null, form({ name: "Mithai", section: "food" }))).toStrictEqual({ ok: false, error: stub.refusal });
  });

  it("explains a database failure", async () => {
    setup({ failTables: { store_categories: { message: "boom" } } });
    expect(await saveCategoryAction(null, form({ name: "Mithai", section: "food" }))).toStrictEqual({ ok: false, error: "Could not add the category — boom." });
  });
});

describe("saveItemAction: the section", () => {
  it("adds a new item to the section the form carries (Food), with its price in cents", async () => {
    const { inserts } = setup();
    expect(await saveItemAction(null, null, form({ ...item, section: "food" }))).toStrictEqual({ ok: true, message: '"Samosa pack" added to the menu.' });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("store_items");
    expect(inserts[0].rows).toMatchObject({ center_id: "center-1", name: "Samosa pack", price_cents: 899, section: "food", category_id: null });
    expect(stub.asked[0]).toStrictEqual({ key: "storeManage", doing: "add the item" });
  });

  it("adds it to Food when the form names no section", async () => {
    const { inserts } = setup();
    expect(await saveItemAction(null, null, form(item))).toStrictEqual({ ok: true, message: '"Samosa pack" added to the menu.' });
    expect(inserts[0].rows.section).toBe("food");
  });

  it("adds a listing to the Community Market while it is on, asking for the store manager or market.manage", async () => {
    const { inserts } = setup({ market: true });
    expect(await saveItemAction(null, null, form({ name: "Memory book", price: "45", status: "active", section: "market" }))).toStrictEqual({
      ok: true,
      message: '"Memory book" added to the Community Market.',
    });
    expect(inserts[0].rows).toMatchObject({ name: "Memory book", price_cents: 4500, section: "market" });
    expect(stub.asked[0]).toStrictEqual({ key: "marketManage", doing: "add the item" });
  });

  it("refuses the Community Market while it is not on, and a section that does not exist, and writes nothing", async () => {
    const { inserts } = setup();
    expect(await saveItemAction(null, null, form({ ...item, section: "market" }))).toStrictEqual({ ok: false, error: `Could not add the item — ${NOT_ON}` });
    expect(await saveItemAction(null, null, form({ ...item, section: "bakery" }))).toStrictEqual({
      ok: false,
      error: "Could not add the item — that store section does not exist.",
    });
    expect(inserts).toStrictEqual([]);
  });

  it("saving an existing item never writes a section, even if the form carries one", async () => {
    const { db, tables } = setup({ market: true });
    expect(await saveItemAction(W.itSamosa, null, form({ ...item, section: "market" }))).toStrictEqual({ ok: true, message: '"Samosa pack" saved.' });
    const calls = (db as unknown as { calls: { table: string; op: string; patch?: Record<string, unknown> }[] }).calls.filter((c) => c.op === "update");
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("store_items");
    expect(calls[0].patch).not.toHaveProperty("section");
    expect(tables.store_items.find((r) => r.id === W.itSamosa)?.price_cents).toBe(899);
    // Either manager may save an existing item; the database lets market.manage change only a market item.
    expect(stub.asked[0]).toStrictEqual({ key: "marketManage", doing: "save the item" });
  });

  it("keeps the sentences it always had for a bad name, price, status and a missing item", async () => {
    setup();
    expect(await saveItemAction(null, null, form({ ...item, name: "" }))).toStrictEqual({ ok: false, error: "Could not add the item — give it a name." });
    expect(await saveItemAction(null, null, form({ ...item, price: "free" }))).toStrictEqual({
      ok: false,
      error: "Could not add the item — the price must be an amount like 8.99.",
    });
    expect(await saveItemAction(null, null, form({ ...item, status: "gone" }))).toStrictEqual({ ok: false, error: "Could not add the item — choose a status." });
    expect(await saveItemAction("not-an-id", null, form(item))).toStrictEqual({ ok: false, error: "Could not save the item — unknown item." });
    expect(await saveItemAction(W.itMissing, null, form(item))).toStrictEqual({ ok: false, error: "Could not save the item — it was not found." });
  });

  it("explains a database failure", async () => {
    setup({ failTables: { store_items: { message: "boom" } } });
    expect(await saveItemAction(null, null, form({ ...item, section: "food" }))).toStrictEqual({ ok: false, error: "Could not add the item — boom." });
  });
});

describe("startMarketAction: the starter categories", () => {
  it("adds the five starter categories to the market, in order, while it is on", async () => {
    const { inserts } = setup({ market: true });
    expect(await startMarketAction()).toStrictEqual({ ok: true, message: "Added 5 starter categories to the Community Market." });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("store_categories");
    expect(inserts[0].rows).toStrictEqual([
      { center_id: "center-1", name: "Gifts", sort_order: 1, section: "market" },
      { center_id: "center-1", name: "Printing & books", sort_order: 2, section: "market" },
      { center_id: "center-1", name: "Personalised", sort_order: 3, section: "market" },
      { center_id: "center-1", name: "Services", sort_order: 4, section: "market" },
      { center_id: "center-1", name: "Community products", sort_order: 5, section: "market" },
    ]);
    expect(stub.asked[0]).toStrictEqual({ key: "marketManage", doing: "start the Community Market" });
  });

  it("leaves out a name the community already uses, in any section, and says so", async () => {
    const { inserts } = setup({
      market: true,
      tables: { store_categories: [{ id: "c-food", center_id: "center-1", name: "Services", sort_order: 1, section: "food" }] },
    });
    expect(await startMarketAction()).toStrictEqual({
      ok: true,
      message: "Added 4 starter categories to the Community Market. Left out because the name is already used: Services.",
    });
    expect((inserts[0].rows as unknown as { name: string }[]).map((r) => r.name)).toStrictEqual(["Gifts", "Printing & books", "Personalised", "Community products"]);
  });

  it("adds nothing when they are all there already", async () => {
    const names = ["Gifts", "Printing & books", "Personalised", "Services", "Community products"];
    const { inserts } = setup({
      market: true,
      tables: { store_categories: names.map((name, i) => ({ id: `c-${i}`, center_id: "center-1", name, sort_order: i, section: "market" })) },
    });
    expect(await startMarketAction()).toStrictEqual({ ok: true, message: "The starter categories are already there." });
    expect(inserts).toStrictEqual([]);
  });

  it("is refused while the market is not on, without permission, and on a database failure", async () => {
    const off = setup();
    expect(await startMarketAction()).toStrictEqual({ ok: false, error: `Could not start the Community Market — ${NOT_ON}` });
    expect(off.inserts).toStrictEqual([]);
    setup({ market: true });
    stub.refusal = "Could not start the Community Market — you don't have permission (needs store.manage or market.manage).";
    expect(await startMarketAction()).toStrictEqual({ ok: false, error: stub.refusal });
    setup({ market: true, failTables: { store_categories: { message: "boom" } } });
    expect(await startMarketAction()).toStrictEqual({ ok: false, error: "Could not start the Community Market — boom." });
  });
});

describe("saveMarketCategoryAction and removeMarketCategoryAction", () => {
  const MARKET_CAT = "ca000000-0000-4000-8000-0000000000e1";
  const FOOD_CAT = "ca000000-0000-4000-8000-000000000001";
  const tables = () => ({
    store_categories: [
      { id: FOOD_CAT, center_id: "center-1", name: "Snacks", sort_order: 1, section: "food" },
      { id: MARKET_CAT, center_id: "center-1", name: "Gifts", sort_order: 1, section: "market" },
    ],
  });

  it("renames and re-orders a market category", async () => {
    const world = setup({ market: true, tables: tables() });
    expect(await saveMarketCategoryAction(MARKET_CAT, null, form({ name: "Gift articles", sort_order: "3" }))).toStrictEqual({ ok: true, message: 'Category "Gift articles" saved.' });
    expect(world.tables.store_categories.find((c) => c.id === MARKET_CAT)).toMatchObject({ name: "Gift articles", sort_order: 3, section: "market" });
    expect(stub.asked[0]).toStrictEqual({ key: "marketManage", doing: "save the category" });
  });

  it("does not touch a Food category: only the market's categories are edited here", async () => {
    const world = setup({ market: true, tables: tables() });
    expect(await saveMarketCategoryAction(FOOD_CAT, null, form({ name: "Renamed", sort_order: "1" }))).toStrictEqual({
      ok: false,
      error: "Could not save the category — it was not found in the Community Market.",
    });
    expect(world.tables.store_categories.find((c) => c.id === FOOD_CAT)?.name).toBe("Snacks");
  });

  it("asks for a name and a whole-number order, and a real category", async () => {
    setup({ market: true, tables: tables() });
    expect(await saveMarketCategoryAction(MARKET_CAT, null, form({ name: "", sort_order: "1" }))).toStrictEqual({ ok: false, error: "Could not save the category — give it a name." });
    expect(await saveMarketCategoryAction(MARKET_CAT, null, form({ name: "X", sort_order: "1.5" }))).toStrictEqual({
      ok: false,
      error: "Could not save the category — the order must be a whole number.",
    });
    expect(await saveMarketCategoryAction("not-an-id", null, form({ name: "X" }))).toStrictEqual({ ok: false, error: "Could not save the category — unknown category." });
  });

  it("is refused without permission and on a database failure", async () => {
    setup({ market: true, tables: tables() });
    stub.refusal = "Could not save the category — you don't have permission (needs store.manage or market.manage).";
    expect(await saveMarketCategoryAction(MARKET_CAT, null, form({ name: "X", sort_order: "1" }))).toStrictEqual({ ok: false, error: stub.refusal });
    setup({ market: true, failTables: { store_categories: { message: "boom" } } });
    expect(await saveMarketCategoryAction(MARKET_CAT, null, form({ name: "X", sort_order: "1" }))).toStrictEqual({ ok: false, error: "Could not save the category — boom." });
  });

  it("removes a market category, keeps its listings and says so", async () => {
    const world = setup({ market: true, tables: tables() });
    expect(await removeMarketCategoryAction(MARKET_CAT)).toStrictEqual({
      ok: true,
      message: 'Category "Gifts" removed. Its listings are kept, without a category.',
    });
    expect(world.tables.store_categories.map((c) => c.id)).toStrictEqual([FOOD_CAT]);
    expect(stub.asked[0]).toStrictEqual({ key: "marketManage", doing: "remove the category" });
    // The listings are items, not rows of the category: nothing here touches them (the database sets their category to none, test 830).
    expect(world.tables.store_items.length).toBeGreaterThan(0);
  });

  it("does not remove a Food category, an unknown one, or one it cannot see", async () => {
    const world = setup({ market: true, tables: tables() });
    expect(await removeMarketCategoryAction(FOOD_CAT)).toStrictEqual({
      ok: false,
      error: "Could not remove the category — it was not found in the Community Market.",
    });
    expect(await removeMarketCategoryAction("not-an-id")).toStrictEqual({ ok: false, error: "Could not remove the category — unknown category." });
    expect(world.tables.store_categories).toHaveLength(2);
  });

  it("is refused without permission and on a database failure", async () => {
    setup({ market: true, tables: tables() });
    stub.refusal = "Could not remove the category — you don't have permission (needs store.manage or market.manage).";
    expect(await removeMarketCategoryAction(MARKET_CAT)).toStrictEqual({ ok: false, error: stub.refusal });
    setup({ market: true, failTables: { store_categories: { message: "boom" } } });
    expect(await removeMarketCategoryAction(MARKET_CAT)).toStrictEqual({ ok: false, error: "Could not remove the category — boom." });
  });
});
