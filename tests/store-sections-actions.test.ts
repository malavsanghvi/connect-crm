// Adding a category or an item puts it in the section the page was on (0821). A form that names no section (a page left open from before
// sections) writes to Food; a section that is not open for new rows (the Community Market, until it is built) and a section that does not
// exist are refused in plain words and write nothing; editing an item never posts or changes a section.
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

import { saveCategoryAction, saveItemAction } from "@/app/(app)/store/actions";

import { ALL_STAFF, contentStoreDb, csSession, W } from "./commands/content-store-world";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

function setup(opts: { failTables?: Record<string, { message: string }> } = {}) {
  const world = contentStoreDb({ failTables: opts.failTables });
  stub.session = csSession(world.db, { permissions: ALL_STAFF });
  stub.refusal = null;
  stub.asked = [];
  return world;
}

const item = { name: "Samosa pack", price: "8.99", status: "active" };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("saveCategoryAction: the section", () => {
  it("adds the category to the section the form carries (Food)", async () => {
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

  it("refuses the Community Market while it is not open, and a section that does not exist, and writes nothing", async () => {
    const { inserts } = setup();
    expect(await saveCategoryAction(null, form({ name: "Gifts", section: "market" }))).toStrictEqual({
      ok: false,
      error: "Could not add the category — the Community Market section is not open for new entries yet.",
    });
    expect(await saveCategoryAction(null, form({ name: "Gifts", section: "marketplace" }))).toStrictEqual({
      ok: false,
      error: "Could not add the category — that store section does not exist.",
    });
    expect(inserts).toStrictEqual([]);
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
  });

  it("adds it to Food when the form names no section", async () => {
    const { inserts } = setup();
    expect(await saveItemAction(null, null, form(item))).toStrictEqual({ ok: true, message: '"Samosa pack" added to the menu.' });
    expect(inserts[0].rows.section).toBe("food");
  });

  it("refuses the Community Market while it is not open, and a section that does not exist, and writes nothing", async () => {
    const { inserts } = setup();
    expect(await saveItemAction(null, null, form({ ...item, section: "market" }))).toStrictEqual({
      ok: false,
      error: "Could not add the item — the Community Market section is not open for new entries yet.",
    });
    expect(await saveItemAction(null, null, form({ ...item, section: "bakery" }))).toStrictEqual({
      ok: false,
      error: "Could not add the item — that store section does not exist.",
    });
    expect(inserts).toStrictEqual([]);
  });

  it("saving an existing item never writes a section, even if the form carries one", async () => {
    const { db, tables } = setup();
    expect(await saveItemAction(W.itSamosa, null, form({ ...item, section: "market" }))).toStrictEqual({ ok: true, message: '"Samosa pack" saved.' });
    const calls = (db as unknown as { calls: { table: string; op: string; patch?: Record<string, unknown> }[] }).calls.filter((c) => c.op === "update");
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("store_items");
    expect(calls[0].patch).not.toHaveProperty("section");
    expect(tables.store_items.find((r) => r.id === W.itSamosa)?.price_cents).toBe(899);
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
