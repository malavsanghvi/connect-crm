import { beforeEach, describe, expect, it, vi } from "vitest";

// Store › Inventory: the stock adjustment actions, with the session replaced by a stand-in staff member and the
// database by a stand-in client that behaves like the real one where it matters here: inserting an
// inventory_movements row moves store_items.stock_on_hand by its delta (trigger inventory_apply, migration 0017;
// supabase/tests/06_admin_gaps_test.sql and 15_store_orders_test.sql run the real trigger). What is checked is that
// the action writes the movement and nothing else, so the count moves exactly once, and that it reports success with
// the count the database holds.
const CENTER = "00000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000009";
const ITEM = "50000000-0000-4000-8000-000000000001";

type Item = { id: string; center_id: string; name: string; stock_on_hand: number; track_inventory: boolean };
type Movement = { center_id: string; item_id: string; delta: number; reason: string; recorded_by: string };

const stub = vi.hoisted(() => ({
  denied: null as string | null,
  items: [] as Item[],
  movements: [] as Movement[],
  /** Every store_items update the app attempted: the database trigger is the only writer of the count. */
  itemUpdates: [] as Record<string, unknown>[],
  insertError: null as { message: string; code?: string } | null,
  /** Another person's movement landing in the same moment as ours. */
  alsoMoves: 0,
  /** Which store_items read (1-based, per test) fails. */
  failRead: 0,
  reads: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  authorizeAction: async (_key: string, doing: string) => {
    if (stub.denied) return { ok: false, error: `Could not ${doing} — ${stub.denied}` };
    const db = {
      from: (table: string) => ({
        select: () => {
          const filters: [string, unknown][] = [];
          const q = {
            eq: (column: string, value: unknown) => (filters.push([column, value]), q),
            maybeSingle: async () => {
              if (table !== "store_items") throw new Error(`unexpected read of ${table}`);
              stub.reads += 1;
              if (stub.failRead === stub.reads) return { data: null, error: { message: "connection reset", code: "08006" } };
              const row = stub.items.find((i) => filters.every(([c, v]) => (i as Record<string, unknown>)[c] === v));
              return { data: row ? { ...row } : null, error: null };
            },
          };
          return q;
        },
        insert: async (row: Movement) => {
          if (table !== "inventory_movements") throw new Error(`unexpected insert into ${table}`);
          if (stub.insertError) return { error: stub.insertError };
          stub.movements.push(row);
          // trigger inventory_apply: after insert, stock_on_hand = stock_on_hand + new.delta
          const item = stub.items.find((i) => i.id === row.item_id);
          if (item) item.stock_on_hand += row.delta + stub.alsoMoves;
          return { error: null };
        },
        update: (patch: Record<string, unknown>) => {
          stub.itemUpdates.push({ table, ...patch });
          const q = { eq: () => q, select: async () => ({ data: [], error: null }) };
          return q;
        },
      }),
    };
    return { ok: true, session: { db, center: { id: CENTER }, userId: USER } };
  },
}));

import { quickAdjustAction, recordMovementAction } from "@/app/(app)/store/actions";

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const stock = () => stub.items.find((i) => i.id === ITEM)?.stock_on_hand;

beforeEach(() => {
  stub.denied = null;
  stub.items = [
    { id: ITEM, center_id: CENTER, name: "Kaju katli", stock_on_hand: 7, track_inventory: true },
    { id: "50000000-0000-4000-8000-000000000002", center_id: CENTER, name: "Books", stock_on_hand: 0, track_inventory: false },
  ];
  stub.movements = [];
  stub.itemUpdates = [];
  stub.insertError = null;
  stub.alsoMoves = 0;
  stub.failRead = 0;
  stub.reads = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("quickAdjustAction", () => {
  it("+10 logs one movement, the stock changes once, and the action reports success with the new count", async () => {
    const out = await quickAdjustAction(ITEM, 10);
    expect(out).toEqual({ ok: true, message: "Adjusted stock Kaju katli by +10 (now 17)" });
    expect(stock()).toBe(17);
    expect(stub.movements).toEqual([{ center_id: CENTER, item_id: ITEM, delta: 10, reason: "adjustment", recorded_by: USER }]);
    expect(stub.itemUpdates).toEqual([]);
  });

  it("−5 takes five off, once", async () => {
    const out = await quickAdjustAction(ITEM, -5);
    expect(out).toEqual({ ok: true, message: "Adjusted stock Kaju katli by -5 (now 2)" });
    expect(stock()).toBe(2);
    expect(stub.movements).toHaveLength(1);
    expect(stub.itemUpdates).toEqual([]);
  });

  it("every press is one movement and one change of the count (a second press is a second adjustment, never a repeat of the first)", async () => {
    await quickAdjustAction(ITEM, 10);
    const out = await quickAdjustAction(ITEM, 10);
    expect(out).toEqual({ ok: true, message: "Adjusted stock Kaju katli by +10 (now 27)" });
    expect(stock()).toBe(27);
    expect(stub.movements).toHaveLength(2);
  });

  it("reports the count the database holds when someone else's movement lands at the same moment (the old guarded update refused here)", async () => {
    stub.alsoMoves = 3;
    const out = await quickAdjustAction(ITEM, 10);
    expect(out).toEqual({ ok: true, message: "Adjusted stock Kaju katli by +10 (now 20)" });
    expect(stub.itemUpdates).toEqual([]);
  });

  it("is still a success when only the read-back fails, so nobody retries into a second adjustment", async () => {
    stub.failRead = 2;
    const out = await quickAdjustAction(ITEM, 10);
    expect(out).toEqual({ ok: true, message: "Adjusted stock Kaju katli by +10. Refresh to see the new count." });
    expect(stock()).toBe(17);
    expect(stub.movements).toHaveLength(1);
  });

  it("refuses an adjustment that is not one of the two buttons", async () => {
    const out = await quickAdjustAction(ITEM, 3);
    expect(out).toEqual({ ok: false, error: "Could not adjust stock — unknown adjustment." });
    expect(stub.movements).toEqual([]);
  });
});

describe("recordMovementAction", () => {
  it("received adds the quantity once", async () => {
    const out = await recordMovementAction(null, form({ item_id: ITEM, reason: "received", quantity: "24" }));
    expect(out).toEqual({ ok: true, message: "Adjusted stock Kaju katli by +24 (now 31)" });
    expect(stock()).toBe(31);
    expect(stub.movements).toEqual([{ center_id: CENTER, item_id: ITEM, delta: 24, reason: "received", recorded_by: USER }]);
    expect(stub.itemUpdates).toEqual([]);
  });

  it("waste takes the quantity off once, whatever sign was typed", async () => {
    const out = await recordMovementAction(null, form({ item_id: ITEM, reason: "waste", quantity: "4" }));
    expect(out).toEqual({ ok: true, message: "Adjusted stock Kaju katli by -4 (now 3)" });
    expect(stock()).toBe(3);
    expect(stub.movements.map((m) => m.delta)).toEqual([-4]);
  });

  it("keeps the plain-English refusals, each naming what the person did, and writes nothing", async () => {
    const cases: [Record<string, string>, string][] = [
      [{ item_id: ITEM, reason: "stolen", quantity: "1" }, "Could not record the stock change — choose a reason."],
      [{ item_id: ITEM, reason: "received", quantity: "0" }, "Could not record the stock change — enter a whole quantity other than zero."],
      [{ item_id: ITEM, reason: "received", quantity: "2.5" }, "Could not record the stock change — enter a whole quantity other than zero."],
      [{ item_id: "not-an-id", reason: "received", quantity: "1" }, "Could not record the stock change — choose the item."],
      [{ item_id: "50000000-0000-4000-8000-0000000000ff", reason: "received", quantity: "1" }, "Could not record the stock change — that item no longer exists."],
      [
        { item_id: "50000000-0000-4000-8000-000000000002", reason: "received", quantity: "1" },
        'Could not record the stock change — "Books" does not track stock. Turn on "Track stock" on Menu & pickup first.',
      ],
    ];
    for (const [fields, error] of cases) expect(await recordMovementAction(null, form(fields))).toEqual({ ok: false, error });
    expect(stub.movements).toEqual([]);
    expect(stub.itemUpdates).toEqual([]);
    expect(stock()).toBe(7);
  });

  it("says so when the movement cannot be logged, and the count does not move", async () => {
    stub.insertError = { message: "connection reset", code: "08006" };
    const out = await recordMovementAction(null, form({ item_id: ITEM, reason: "received", quantity: "5" }));
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/^Could not record the stock change — /);
    expect(stock()).toBe(7);
    expect(stub.movements).toEqual([]);
  });

  it("stops at the permission check", async () => {
    stub.denied = "you don't have permission (needs store.manage).";
    const out = await recordMovementAction(null, form({ item_id: ITEM, reason: "received", quantity: "5" }));
    expect(out).toEqual({ ok: false, error: "Could not record the stock change — you don't have permission (needs store.manage)." });
    expect(stub.reads).toBe(0);
    expect(stub.movements).toEqual([]);
  });
});
