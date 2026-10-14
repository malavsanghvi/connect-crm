// The pure pieces of the Content and Store commands: no database, no clock of their own.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));

import { buildMediaLibrary, buildNivaSources, buildQueueData, CHILD_ALBUM } from "@/lib/commands/catalog/content/pure";
import { buildSales, defaultPeriod, itemsLine, lowStockItems, MAX_PERIOD_DAYS, periodProblem, priceChange } from "@/lib/commands/catalog/store/pure";

import { libraryJson, NOW, queueJson, salesJson, W } from "./content-store-world";

describe("the approval queue as the commands show it", () => {
  const names = new Map([["user-2", "Maya Desai"]]);
  const data = buildQueueData(queueJson(), { now: NOW, me: "user-1", names, canDecide: true });

  it("counts what waits, by kind, with how long the oldest has waited", () => {
    expect(data.total).toBe(6);
    expect(data.by_kind.map((k) => [k.kind, k.waiting])).toEqual([
      ["sutra", 1],
      ["niva_source", 3],
      ["other", 1],
      ["faq", 1],
    ]);
    expect(data.by_kind[0]).toMatchObject({ kind_label: "Religious content", oldest_waiting: "10 days" });
    expect(data.oldest_waiting).toBe("10 days");
    expect(data.not_listed).toBe(0);
  });

  it("makes the sections of an imported web page one entry, and gives every other item the version the approver must hand back", () => {
    const page = data.waiting.filter((e) => e.type === "web_page");
    expect(page).toHaveLength(1);
    expect(page[0]).toMatchObject({ title: "Visiting", page: "example.org/visit", sections: 2 });
    const faq = data.waiting.find((e) => e.type === "item" && e.item_id === W.ciFaq);
    expect(faq).toMatchObject({ type: "item", seen: "2026-10-08T15:00:00.123456+00:00", submitted_by: "You", you_submitted: true, kind_label: "FAQ" });
    const sutra = data.waiting.find((e) => e.type === "item" && e.item_id === W.ciSutra);
    expect(sutra).toMatchObject({ submitted_by: "Maya Desai", you_submitted: false });
  });

  it("only counts member photos and never describes an album that has a child in it", () => {
    expect(data.member_photo_uploads).toMatchObject({ photos_waiting: 3, albums_waiting: 2, photos_with_children: 1 });
    expect(data.member_photo_uploads?.albums).toEqual([
      { album: CHILD_ALBUM, photos_waiting: 2, includes_children: true },
      { album: "Picnic", photos_waiting: 1, includes_children: false },
    ]);
    // Even if a title were handed over for an album with a child, it is not used.
    const leaky = buildQueueData(queueJson({ photos: { photos: 1, albums: 1, with_children: 1, by_album: [{ album_id: "x", title: "Zoya's party", waiting: 1, has_children: true }] } }), { now: NOW, me: "user-1", names, canDecide: false });
    expect(JSON.stringify(leaky)).not.toContain("Zoya");
  });

  it("says so when the role does not see photos, and when nothing waits", () => {
    const none = buildQueueData(queueJson({ total: 0, shown: 0, oldest_at: null, items: [], by_kind: [], photos: null, can_see_photos: false }), { now: NOW, me: "user-1", names, canDecide: false });
    expect(none.member_photo_uploads).toBeNull();
    expect(none.notes.join(" ")).toContain("Nothing is waiting for approval.");
    expect(none.notes.join(" ")).toContain("Member photo uploads are reviewed by content managers");
    expect(none.oldest_waiting).toBeNull();
  });

  it("says how many are not listed", () => {
    const more = buildQueueData(queueJson({ total: 40, shown: 6 }), { now: NOW, me: "user-1", names, canDecide: true });
    expect(more.not_listed).toBe(34);
    expect(more.notes.join(" ")).toContain("34 more items are waiting");
  });
});

describe("Niva's sources and the media library", () => {
  it("counts the sources by state and lists the stale pages", () => {
    const d = buildNivaSources(libraryJson(), { now: NOW });
    expect(d).toMatchObject({ total: 8, approved_and_in_use: 4, waiting_for_approval: 2, drafts: 1, retired: 1, imported_pages: 3, stale_pages_total: 2 });
    expect(d.stale_pages[0]).toEqual({ page: "example.org/lib", title: "Library", sections: 3, changed: 2, no_longer_on_page: 0, last_edited: "200 days" });
    expect(d.not_edited).toEqual({ days: 180, published_sources: 1 });
  });
  it("counts the media by kind", () => {
    const d = buildMediaLibrary(libraryJson());
    expect(d.total).toBe(6);
    expect(d.kinds.map((k) => [k.kind, k.total])).toEqual([
      ["stavan", 1],
      ["video", 2],
      ["podcast", 2],
      ["recipe", 1],
    ]);
    expect(d.kinds.find((k) => k.kind === "video")).toMatchObject({ published: 1, drafts: 1, waiting_for_approval: 0 });
    expect(buildMediaLibrary({}).notes[0]).toBe("The media library is empty.");
  });
});

describe("sales in dollars with the cents underneath", () => {
  it("formats every sum from integer cents", () => {
    const d = buildSales(salesJson(), "USD");
    expect(d).toMatchObject({ orders: 4, units: 6, days: 30, subtotal_cents: 5200, subtotal: "$52.00", gift_packing: "$2.50", tax: "$1.20", total_cents: 5570, total: "$55.70", refunded_cents: 2400, refunded: "$24.00" });
    expect(d.top_items[0]).toEqual({ item: "Samosa pack", units: 5, sold_cents: 4000, sold: "$40.00" });
    expect(d.by_status.map((s) => [s.status, s.orders])).toEqual([
      ["placed", 2],
      ["ready", 1],
      ["picked_up", 1],
      ["cancelled", 1],
      ["refunded", 1],
    ]);
    expect(d.notes.join(" ")).toContain("Niva can't refund an order");
  });
  it("never turns a missing sum into a made-up one", () => {
    const d = buildSales({}, "USD");
    expect(d).toMatchObject({ orders: 0, total_cents: 0, total: "$0.00", by_status: [], top_items: [] });
    expect(d.notes.join(" ")).toContain("No orders were placed");
  });
  it("defaults to this month so far, and refuses a backwards or a very long period", () => {
    expect(defaultPeriod("2026-10-10")).toEqual({ from: "2026-10-01", to: "2026-10-10" });
    expect(periodProblem("2026-10-10", "2026-10-01")).toMatch(/before its start/);
    expect(periodProblem("2025-01-01", "2026-10-01")).toContain(`${MAX_PERIOD_DAYS} days`);
    expect(periodProblem("2026-01-01", "2026-12-31")).toBeNull();
  });
});

describe("low stock, order lines and prices", () => {
  const row = (name: string, stock: number, at: number | null, over: Record<string, unknown> = {}) => ({ id: name, name, sku: null, stock_on_hand: stock, low_stock_threshold: at, track_inventory: true, status: "active", ...over });
  it("is below the reorder level, not at it, the furthest short first; untracked and retired items are left out", () => {
    const list = lowStockItems([
      row("B", 3, 10),
      row("A", 8, 10),
      row("At level", 10, 10),
      row("Out", 0, 5),
      row("No level", 0, null),
      row("Retired", 0, 5, { status: "retired" }),
      row("Untracked", 0, 5, { track_inventory: false }),
    ]);
    expect(list.map((i) => [i.name, i.short_by, i.out_of_stock])).toEqual([
      ["B", 7, false],
      ["Out", 5, true],
      ["A", 2, false],
    ]);
  });
  it("words an order's items", () => {
    expect(itemsLine([])).toBe("no items");
    expect(itemsLine([{ name: "Samosa pack", quantity: 2 }, { name: "Gift jar", quantity: 1 }])).toBe("2 × Samosa pack, 1 × Gift jar");
    expect(itemsLine(Array.from({ length: 6 }, (_, i) => ({ name: `I${i}`, quantity: 1 })))).toBe("1 × I0, 1 × I1, 1 × I2, 1 × I3 and 2 more");
  });
  it("shows a price change in dollars with the difference", () => {
    expect(priceChange(800, 850, "USD")).toMatchObject({ before: "$8.00", after: "$8.50", difference: "+$0.50", difference_cents: 50, percent: 6.3 });
    expect(priceChange(800, 600, "USD")).toMatchObject({ difference: "-$2.00", percent: -25 });
    expect(priceChange(0, 500, "USD").percent).toBeNull();
  });
});
