import { describe, expect, it } from "vitest";

import { ROLE_PERMISSIONS, TODAY_FAMILIES, sampleTodayInput, sampleTodayModel, type TodayRole } from "@/lib/giving-today/fixtures";
import {
  GROUP_ORDER,
  bankTotalsFromTasks,
  buildQueue,
  canActOn,
  familyFrom,
  familyLine,
  familyRef,
  groupTotal,
  queueTiles,
  type Act,
  type TodayCan,
  type TodayContext,
  type TodayInput,
} from "@/lib/giving-today/queue";
import { SAMPLE_CARDS } from "@/lib/giving-workspace/fixtures";
import { LEGACY_KIND, NEUTRAL_KIND, type KindProfile } from "@/lib/kind";
import { visibleTaskSources, type GivingTaskDetail } from "@/lib/tasks";
import { word } from "@/lib/wording";

const LABELS = { orgMemberLabel: "member", orgHouseholdLabel: "Club household ID" };
const NONE: TodayCan = { approve: false, manage: false, bankConfirm: false, allocate: false, countRecord: false, closeManage: false };

function ctx(can: Partial<TodayCan>, visible: Partial<TodayContext["visible"]> = {}): TodayContext {
  return {
    can: { ...NONE, ...can },
    currency: "USD",
    locale: "en-US",
    timeZone: "America/Chicago",
    today: "2026-10-12",
    labels: LABELS,
    countsWord: "Offering counts",
    zelleWord: "Zelle",
    visible: { approvals: true, bank: true, pledges: true, counts: true, books: true, ...visible },
  };
}

const role = (r: TodayRole) => ({ permissions: ROLE_PERMISSIONS[r], isPlatformAdmin: false, modulesOff: ["bolis"] });
const labelsOf = (acts: Act[]) => acts.flatMap((a) => ("label" in a ? [a.label] : []));

describe("families are never shown by name alone, and never with a child's name", () => {
  it("the line carries the number, the organization's id, the primary adult and the city", () => {
    expect(familyLine(TODAY_FAMILIES.adeyemi, LABELS)).toBe("No. 0127 · Club household ID LCC-H-1127 · Primary: Tola Adeyemi · Lakeside");
    expect(familyRef(TODAY_FAMILIES.adeyemi)).toBe("Adeyemi household 0127");
    expect(familyRef(null)).toBe("the household");
  });
  it("a household card's member list (children included) never reaches the row", () => {
    const f = familyFrom(SAMPLE_CARDS[0]);
    expect(JSON.stringify(f)).not.toContain("Tomás");
    expect(familyLine(f, LABELS)).toBe("No. 0212 · Club household ID LCC-H-2041 · Primary: Chidi Okafor · Lakeside");
  });
});

describe("who may act on a Giving task (owner decision 7: the rest are counts)", () => {
  const d = (x: Partial<GivingTaskDetail>): GivingTaskDetail => ({
    kind: "refund", stage: "second", id: "x", householdId: null, amountCents: 100, reference: null, reason: null, askedBy: null, mine: false, since: null, provider: "offline", count: 1, ...x,
  });
  it("a second approval needs giving.approve and a different person", () => {
    expect(canActOn(d({}), { ...NONE, approve: true })).toBe(true);
    expect(canActOn(d({ mine: true }), { ...NONE, approve: true })).toBe(false);
    expect(canActOn(d({}), { ...NONE, manage: true })).toBe(false);
  });
  it("finishing, a card refund's first approval and a credit are the treasurer's", () => {
    expect(canActOn(d({ stage: "complete" }), { ...NONE, manage: true })).toBe(true);
    expect(canActOn(d({ stage: "complete" }), { ...NONE, approve: true })).toBe(false);
    expect(canActOn(d({ kind: "flagged_refund", stage: "first" }), { ...NONE, manage: true })).toBe(true);
    expect(canActOn(d({ kind: "flagged_refund", stage: "first" }), { ...NONE, approve: true })).toBe(false);
    expect(canActOn(d({ kind: "flagged_refund", stage: "second", mine: true }), { ...NONE, approve: true, manage: true })).toBe(false);
    expect(canActOn(d({ kind: "credit", stage: "handle" }), { ...NONE, manage: true })).toBe(true);
  });
});

describe("the treasurer's queue", () => {
  const model = sampleTodayModel("treasurer");
  const rows = model.queue.rows;

  it("comes in the plan's order: approvals, bank, pledges, counts, books", () => {
    const order = rows.map((r) => GROUP_ORDER.indexOf(r.group));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(rows.map((r) => r.group))).toEqual(new Set(GROUP_ORDER));
  });

  it("acts on what is theirs and counts what waits for someone else", () => {
    const approvals = rows.filter((r) => r.group === "approvals");
    expect(approvals.filter((r) => !r.info).map((r) => r.title)).toEqual([
      "Refund of $25.00 made in Stripe on receipt R-2026-0377",
      "Ready to complete: write off $120.00",
      "Credit of $30.00 to handle",
    ]);
    const waiting = approvals.find((r) => r.id === "approvals:second");
    expect(waiting?.title).toBe("2 waiting for the second approver");
    expect(waiting?.lines).toEqual([
      "Refund of $40.00 (R-2026-0398) · Write-off of $150.00 (PL-0388)",
      "You asked for 1 of them, so a different person with approval rights approves it.",
    ]);
    expect(waiting?.acts).toEqual([]);
  });

  it("names the amount and the family on every button that moves money", () => {
    const labels = rows.flatMap((r) => labelsOf(r.acts));
    expect(labels).toContain("Approve $25.00 card refund for Kim household 0398 (first approval)");
    expect(labels).toContain("Write off $120.00 for Nguyen household 0441");
    expect(labels).toContain("Mark $30.00 credit for Lindqvist household 0305 handled");
    expect(labels).toContain("Apply $50.00 to the open pledges of Lindqvist household 0305");
    const gift = rows.find((r) => r.id.startsWith("bank:gift:"))?.acts[0];
    expect(gift?.kind === "gift" && gift.best?.label).toBe("Confirm $120.00 for Adeyemi household 0127");
  });

  it("lists the oldest bank lines and counts the rest, so the Bank number is Home's number", () => {
    const more = rows.find((r) => r.id === "bank:more");
    expect(more?.title).toBe("4 more bank lines to match");
    // An ambiguous suggestion is never confirmed in one click: the person chooses the family.
    const ambiguous = rows.find((r) => r.title === "Bank gift $250.00: choose the family");
    expect(ambiguous?.acts[0]).toMatchObject({ kind: "gift", best: null });
    expect(rows.find((r) => r.id === "bank:zelle-exact")?.title).toBe("2 Zelle reports match a bank line exactly");
  });

  it("lists the close checks with the ones the treasurer marks", () => {
    const close = rows.find((r) => r.id === "books:close");
    expect(close?.title).toBe("October 2026 close: 1 of 3 checks");
    expect(close?.acts[0]).toMatchObject({ kind: "close", canMark: true, month: "2026-10-01" });
  });

  it("tiles count what the person can act on, and a row marked done stops counting", () => {
    const tiles = model.queue.tiles;
    expect(tiles.map((t) => t.label)).toEqual(["Everything", "Approvals", "Bank", "Pledges", "Offering counts", "Books"]);
    const approvals = tiles.find((t) => t.key === "approvals")!.count;
    expect(approvals).toBe(3);
    const after = queueTiles(rows, { countsWord: "Offering counts", visible: { approvals: true, bank: true, pledges: true, counts: true, books: true } }, new Set([rows[0].id]));
    expect(after.find((t) => t.key === "approvals")!.count).toBe(2);
    expect(after[0].count).toBe(tiles[0].count - 1);
  });
});

describe("Home and Today read the same task list, so they never disagree", () => {
  for (const r of ["treasurer", "approver", "volunteer"] as const) {
    it(`for a ${r}`, () => {
      const input = sampleTodayInput(role(r), r);
      const queue = sampleTodayModel(r).queue;
      const homeApprovals = input.tasks.filter((t) => ["refund", "payee", "writeoff", "credit"].includes(t.source)).length;
      expect(groupTotal(queue.rows, "approvals")).toBe(homeApprovals);
      const totals = bankTotalsFromTasks(input.tasks);
      if (input.bank?.state === "ok") {
        expect(groupTotal(queue.rows, "bank")).toBe(input.bank.data.totals.lines + input.bank.data.totals.zelleUnseen);
        if (totals) expect(totals).toEqual({ lines: 9, deposits: 1, zelleUnseen: 1 });
      }
      // Home's own rule decides which approval tasks a role has at all.
      const sources = new Set(visibleTaskSources(role(r)).map((s) => s.key));
      for (const t of input.tasks) expect(sources.has(t.source)).toBe(true);
    });
  }
});

describe("a second approver who holds only giving.approve", () => {
  const model = sampleTodayModel("approver");
  it("sees the approvals they can give, with the evidence in the row", () => {
    const rows = model.queue.rows;
    expect(new Set(rows.map((r) => r.group))).toEqual(new Set(["approvals"]));
    const refund = rows.find((r) => r.title === "Refund of $40.00 waiting for a second approver");
    expect(refund?.family?.name).toBe("Adeyemi household");
    expect(refund?.lines).toEqual(["Receipt R-2026-0398 · asked by Sam Carter", "Reason: “Paid twice at the autumn fair”"]);
    expect(refund?.since).toBe("Waiting since Oct 9, 2026");
    expect(labelsOf(refund!.acts)).toContain("Approve $40.00 refund for Adeyemi household 0127");
    expect(labelsOf(rows.flatMap((r) => r.acts))).toContain("Approve $150.00 write-off for Okafor family 0388");
  });
  it("sees what waits for the treasurer as counts, and no other tile", () => {
    expect(model.queue.rows.find((r) => r.id === "approvals:first")?.title).toBe("1 card refund waiting for a treasurer's first approval");
    expect(model.queue.rows.find((r) => r.id === "approvals:finish")?.title).toBe("1 approved, waiting for the treasurer to finish");
    expect(model.queue.tiles.map((t) => t.key)).toEqual(["all", "approvals"]);
  });
});

describe("a finance volunteer (giving.record_offline)", () => {
  const model = sampleTodayModel("volunteer");
  const rows = model.queue.rows;
  it("matches bank lines and records counts, and sees pledges as a count (what is applied is not theirs to read)", () => {
    expect(rows.some((r) => r.group === "approvals")).toBe(false);
    expect(rows.find((r) => r.id === "bank:zelle-exact")?.info).toBeUndefined();
    expect(rows.find((r) => r.id === "pledges:behind")).toMatchObject({ info: true, title: "3 households are behind on pledges" });
    expect(rows.some((r) => r.id.startsWith("pledges:apply"))).toBe(false);
    expect(rows.find((r) => r.group === "counts")?.acts[0]).toMatchObject({ kind: "count_deposit" });
    expect(model.queue.tiles.map((t) => t.key)).toEqual(["all", "bank", "pledges", "counts"]);
  });
});

describe("what could not be read is said next to its group", () => {
  it("a task source and a part that failed become problems; the rest still shows", () => {
    const input: TodayInput = {
      ...sampleTodayInput(role("treasurer")),
      taskFailures: [{ source: "refund", tag: "Refund", message: "timeout" }],
      behind: { state: "error", error: "Could not read who is behind on pledges — timeout." },
    };
    const q = buildQueue(input, ctx({ manage: true, bankConfirm: true, allocate: true, countRecord: true, closeManage: true }));
    expect(q.problems).toEqual([
      { group: "approvals", message: "Could not load the refund tasks: timeout." },
      { group: "pledges", message: "Could not read who is behind on pledges — timeout." },
    ]);
    expect(q.rows.some((r) => r.group === "bank")).toBe(true);
  });
  it("a viewer without the right to match sees the bank as a count", () => {
    const input = sampleTodayInput(role("treasurer"));
    const q = buildQueue(input, ctx({}));
    const bank = q.rows.filter((r) => r.group === "bank");
    expect(bank).toHaveLength(1);
    expect(bank[0]).toMatchObject({ info: true, title: "9 bank lines to match", count: 10 });
  });
});

describe("the counts tile speaks the organization's own word", () => {
  const church: KindProfile = { ...NEUTRAL_KIND, key: "church", label: "Church", faithBased: true, terms: { ...NEUTRAL_KIND.terms, offering_counts: "Collection counts" } };
  it("neutral, a church with its own term, a kind that keeps a tradition", () => {
    expect(word(NEUTRAL_KIND, "offering_counts")).toBe("Offering counts");
    expect(word(church, "offering_counts")).toBe("Collection counts");
    expect(word(LEGACY_KIND, "offering_counts")).toBe("Bhandar counts");
    expect(sampleTodayModel("treasurer", { kind: church }).queue.tiles.map((t) => t.label)).toContain("Collection counts");
  });
});
