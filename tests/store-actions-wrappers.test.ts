// The Store Server Actions that now run a command (move an order along, adjust stock by the quick buttons, record a stock change) answer
// exactly as they did when they did the work themselves: the same ActionResult, the same sentences, the same permission asked with the same
// wording, and (PR #128) a stock change that is saved is never reported as a failure because the new count could not be read back. The
// expectations below were first run against the actions BEFORE they became wrappers; they are `toStrictEqual`.
import { beforeEach, describe, expect, it, vi } from "vitest";

const stub = vi.hoisted(() => ({
  session: null as unknown,
  refusal: null as string | null,
  state: null as unknown,
  asked: [] as { key: string; doing: string }[],
}));

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
  loadSession: vi.fn(async () => stub.state ?? { status: "ok", session: stub.session }),
  dbWithReason: vi.fn(),
}));

import { revalidatePath } from "next/cache";

import { moveOrderAction, quickAdjustAction, recordMovementAction } from "@/app/(app)/store/actions";

import { ALL_STAFF, contentStoreDb, csSession, W } from "./commands/content-store-world";

type Dict = Record<string, unknown>;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

function setup(opts: { permissions?: string[]; failTables?: Record<string, { message: string }>; failUpdates?: Record<string, { message: string }>; failStockReadBack?: boolean } = {}) {
  const world = contentStoreDb({ failTables: opts.failTables, failUpdates: opts.failUpdates, failStockReadBack: opts.failStockReadBack });
  stub.session = csSession(world.db, { permissions: opts.permissions ?? ALL_STAFF });
  stub.refusal = null;
  stub.state = null;
  stub.asked = [];
  return world;
}
const order = (tables: Record<string, Dict[]>, id: string) => tables.store_orders.find((r) => r.id === id) as Dict;
const item = (tables: Record<string, Dict[]>, id: string) => tables.store_items.find((r) => r.id === id) as Dict;
const SHOP = ["/store", "/store/menu", "/store/orders"];

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(revalidatePath).mockClear();
});

describe("moveOrderAction", () => {
  const move = (id: string, to: string) => moveOrderAction(id, null, form({ to }));

  it("moves an order one step and says where it is now", async () => {
    const { tables } = setup();
    expect(await move(W.orPreparing, "ready")).toStrictEqual({ ok: true, message: "Order #T-102 ready." });
    expect(order(tables, W.orPreparing)).toMatchObject({ status: "ready" });
    expect(order(tables, W.orPreparing).ready_at).toBeTruthy();
    expect(stub.asked[0]).toStrictEqual({ key: "storePickup", doing: "update the order" });
    expect(vi.mocked(revalidatePath).mock.calls.map((c) => c[0])).toStrictEqual(SHOP);
    expect(await move(W.orReady, "picked_up")).toStrictEqual({ ok: true, message: "Order #T-103 picked up." });
    expect(order(tables, W.orReady)).toMatchObject({ status: "picked_up", picked_up_by: "user-1" });
    expect(order(tables, W.orReady).picked_up_at).toBeTruthy();
    expect(await move(W.orPlaced, "preparing")).toStrictEqual({ ok: true, message: "Order #T-101 preparing." });
  });

  it("cancels an order from the screen, as it always could", async () => {
    const { tables } = setup();
    expect(await move(W.orPlaced, "cancelled")).toStrictEqual({ ok: true, message: "Order #T-101 cancelled." });
    expect(order(tables, W.orPlaced).cancelled_at).toBeTruthy();
  });

  it("refuses with the sentences it always had", async () => {
    setup();
    const cases: [string, string, string][] = [
      [W.orPlaced, "ready", "Could not update order #T-101 — it is placed and can't move to ready. Refresh to see the latest."],
      [W.orReady, "preparing", "Could not update order #T-103 — it is ready and can't move to preparing. Refresh to see the latest."],
      [W.orPicked, "ready", "Could not update order #T-105 — it is picked up and can't move to ready. Refresh to see the latest."],
      [W.orMissing, "ready", "Could not update the order — it no longer exists, or you can't see it."],
      [W.orPlaced, "refunded", "Could not update the order — unknown change."],
      [W.orPlaced, "", "Could not update the order — unknown change."],
      ["not-an-id", "ready", "Could not update the order — unknown change."],
    ];
    for (const [id, to, error] of cases) expect(await move(id, to), error).toStrictEqual({ ok: false, error });
  });

  it("refuses a person who may not move orders in the same words, and explains a database failure", async () => {
    setup();
    stub.refusal = "Could not update the order — you don't have permission (needs store.manage or store.pickup).";
    expect(await move(W.orPreparing, "ready")).toStrictEqual({ ok: false, error: stub.refusal });
    const down = setup({ failUpdates: { store_orders: { message: "nope" } } });
    expect(await move(W.orPreparing, "ready")).toStrictEqual({ ok: false, error: "Could not update the order — nope." });
    expect(order(down.tables, W.orPreparing).status).toBe("preparing");
    setup({ failTables: { store_orders: { message: "boom" } } });
    expect(await move(W.orPreparing, "ready")).toStrictEqual({ ok: false, error: "Could not update the order — boom." });
  });
});

describe("quickAdjustAction", () => {
  it("adds ten or takes five with the movement, and shows the count the database made of it", async () => {
    const { tables, inserts } = setup();
    expect(await quickAdjustAction(W.itSamosa, 10)).toStrictEqual({ ok: true, message: "Adjusted stock Samosa pack by +10 (now 13)" });
    expect(await quickAdjustAction(W.itSamosa, -5)).toStrictEqual({ ok: true, message: "Adjusted stock Samosa pack by -5 (now 8)" });
    expect(inserts).toStrictEqual([
      { table: "inventory_movements", rows: { center_id: "center-1", item_id: W.itSamosa, delta: 10, reason: "adjustment", recorded_by: "user-1" } },
      { table: "inventory_movements", rows: { center_id: "center-1", item_id: W.itSamosa, delta: -5, reason: "adjustment", recorded_by: "user-1" } },
    ]);
    expect(item(tables, W.itSamosa).stock_on_hand).toBe(8);
    expect(stub.asked[0]).toStrictEqual({ key: "storeManage", doing: "adjust the stock" });
    expect(vi.mocked(revalidatePath).mock.calls.map((c) => c[0])).toStrictEqual([...SHOP, ...SHOP]);
  });

  it("refuses with the sentences it always had, and asks nobody for a change it does not know", async () => {
    setup();
    expect(await quickAdjustAction(W.itSamosa, 3)).toStrictEqual({ ok: false, error: "Could not adjust stock — unknown adjustment." });
    expect(stub.asked).toStrictEqual([]);
    expect(await quickAdjustAction("not-an-id", 10)).toStrictEqual({ ok: false, error: "Could not adjust the stock — choose the item." });
    expect(await quickAdjustAction(W.itMissing, 10)).toStrictEqual({ ok: false, error: "Could not adjust the stock — that item no longer exists." });
    expect(await quickAdjustAction(W.itUntracked, 10)).toStrictEqual({
      ok: false,
      error: 'Could not adjust the stock — "Chai" does not track stock. Turn on "Track stock" on Menu & pickup first.',
    });
    stub.refusal = "Could not adjust the stock — you don't have permission (needs store.manage).";
    expect(await quickAdjustAction(W.itSamosa, 10)).toStrictEqual({ ok: false, error: stub.refusal });
  });

  it("explains a database failure", async () => {
    const down = setup({ failTables: { inventory_movements: { message: "boom" } } });
    expect(await quickAdjustAction(W.itSamosa, 10)).toStrictEqual({ ok: false, error: "Could not adjust the stock — boom." });
    expect(item(down.tables, W.itSamosa).stock_on_hand).toBe(3);
    setup({ failTables: { store_items: { message: "gone" } } });
    expect(await quickAdjustAction(W.itSamosa, 10)).toStrictEqual({ ok: false, error: "Could not adjust the stock — gone." });
  });

  it("is a success when the change is saved but the new count cannot be read back (PR #128)", async () => {
    const { inserts, tables } = setup({ failStockReadBack: true });
    expect(await quickAdjustAction(W.itSamosa, 10)).toStrictEqual({ ok: true, message: "Adjusted stock Samosa pack by +10. Refresh to see the new count." });
    expect(inserts).toHaveLength(1);
    expect(item(tables, W.itSamosa).stock_on_hand).toBe(13);
    expect(console.error).toHaveBeenCalledWith("[store] stock adjusted, but the new count could not be read back:", { message: "read failed" });
  });
});

describe("recordMovementAction", () => {
  const record = (fields: Record<string, string>) => recordMovementAction(null, form(fields));

  it("records stock received, waste, returns and corrections with the sign each reason forces", async () => {
    const { inserts, tables } = setup();
    expect(await record({ item_id: W.itSamosa, reason: "received", quantity: "24" })).toStrictEqual({ ok: true, message: "Adjusted stock Samosa pack by +24 (now 27)" });
    expect(await record({ item_id: W.itSamosa, reason: "waste", quantity: "5" })).toStrictEqual({ ok: true, message: "Adjusted stock Samosa pack by -5 (now 22)" });
    expect(await record({ item_id: W.itSamosa, reason: "waste", quantity: "-2" })).toStrictEqual({ ok: true, message: "Adjusted stock Samosa pack by -2 (now 20)" });
    expect(await record({ item_id: W.itSamosa, reason: "returned", quantity: "-3" })).toStrictEqual({ ok: true, message: "Adjusted stock Samosa pack by +3 (now 23)" });
    expect(await record({ item_id: W.itSamosa, reason: "adjustment", quantity: "-4" })).toStrictEqual({ ok: true, message: "Adjusted stock Samosa pack by -4 (now 19)" });
    expect(inserts.map((i) => [i.rows.reason, i.rows.delta])).toStrictEqual([
      ["received", 24],
      ["waste", -5],
      ["waste", -2],
      ["returned", 3],
      ["adjustment", -4],
    ]);
    expect(item(tables, W.itSamosa).stock_on_hand).toBe(19);
    expect(stub.asked[0]).toStrictEqual({ key: "storeManage", doing: "record the stock change" });
  });

  it("refuses with the sentences it always had", async () => {
    setup();
    const cases: [Record<string, string>, string][] = [
      [{ item_id: W.itSamosa, reason: "sold", quantity: "1" }, "Could not record the stock change — choose a reason."],
      [{ item_id: W.itSamosa, reason: "", quantity: "1" }, "Could not record the stock change — choose a reason."],
      [{ item_id: W.itSamosa, reason: "received", quantity: "0" }, "Could not record the stock change — enter a whole quantity other than zero."],
      [{ item_id: W.itSamosa, reason: "received", quantity: "1.5" }, "Could not record the stock change — enter a whole quantity other than zero."],
      [{ item_id: W.itSamosa, reason: "received", quantity: "" }, "Could not record the stock change — enter a whole quantity other than zero."],
      [{ item_id: "not-an-id", reason: "received", quantity: "3" }, "Could not record the stock change — choose the item."],
      [{ item_id: W.itMissing, reason: "received", quantity: "3" }, "Could not record the stock change — that item no longer exists."],
      [{ item_id: W.itUntracked, reason: "received", quantity: "3" }, 'Could not record the stock change — "Chai" does not track stock. Turn on "Track stock" on Menu & pickup first.'],
    ];
    for (const [fields, error] of cases) expect(await record(fields), error).toStrictEqual({ ok: false, error });
    stub.refusal = "Could not record the stock change — you don't have permission (needs store.manage).";
    expect(await record({ item_id: W.itSamosa, reason: "received", quantity: "3" })).toStrictEqual({ ok: false, error: stub.refusal });
  });

  it("explains a database failure, and does not call a saved change a failure", async () => {
    setup({ failTables: { inventory_movements: { message: "boom" } } });
    expect(await record({ item_id: W.itSamosa, reason: "received", quantity: "3" })).toStrictEqual({ ok: false, error: "Could not record the stock change — boom." });
    setup({ failStockReadBack: true });
    expect(await record({ item_id: W.itSamosa, reason: "received", quantity: "3" })).toStrictEqual({ ok: true, message: "Adjusted stock Samosa pack by +3. Refresh to see the new count." });
  });
});
