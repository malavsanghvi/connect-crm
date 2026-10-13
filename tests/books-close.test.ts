import { describe, expect, it } from "vitest";

import { closeItems, readyToLock, type CloseProofs } from "@/lib/books/close";
import { groupSuggestions, type MatchRow } from "@/lib/books/donors";
import { BOOKS_PROOFS, sampleBooks } from "@/lib/books/fixtures";
import { booksViewOrder } from "@/lib/books/views";
import { TODAY_FAMILIES } from "@/lib/giving-today/fixtures";
import { buildQueue, type TodayCan, type TodayContext, type TodayInput } from "@/lib/giving-today/queue";
import { activeGivingTab, givingTabs, type TabContext } from "@/lib/giving-today/tabs";
import { LEGACY_KIND, NEUTRAL_KIND } from "@/lib/kind";

const FORMAT = { monthLabel: "October 2026", currency: "USD", locale: "en-US" };
const byKey = (p: CloseProofs, checklist: Record<string, boolean> = {}, f = FORMAT) => Object.fromEntries(closeItems(checklist, p, f).map((i) => [i.key, i]));

describe("month-end close: the checks the data proves tick themselves", () => {
  it("a cash-and-check month: exceptions, payouts and refunds are proven; the statements stay a person's", () => {
    const items = byKey(BOOKS_PROOFS.clear);
    expect(items.exceptions_cleared).toMatchObject({ done: true, proven: true, manual: false, sub: "Checked by Weaver: no QuickBooks posting failed" });
    expect(items.payouts_matched).toMatchObject({ done: true, proven: true, manual: false, sub: "Checked by Weaver: no card payouts arrived in October 2026" });
    expect(items.refunds_reviewed).toMatchObject({ done: true, proven: true, manual: false, sub: "Checked by Weaver: no refund is waiting" });
    expect(items.statements_generated).toMatchObject({ done: false, proven: false, manual: true, sub: "Mark done" });
    expect(readyToLock(closeItems({}, BOOKS_PROOFS.clear, FORMAT))).toBe(false);
    expect(readyToLock(closeItems({ statements_generated: true }, BOOKS_PROOFS.clear, FORMAT))).toBe(true);
  });

  it("card payouts that arrived stay a person's check, with both sides and the difference in the community's currency", () => {
    const p: CloseProofs = { ...BOOKS_PROOFS.waiting, bankPayouts: { ok: true, value: { lines: 2, cents: 400_000 } } };
    const items = byKey(p, {}, { monthLabel: "October 2026", currency: "CAD", locale: "en-CA" });
    expect(items.payouts_matched).toMatchObject({ done: false, proven: false, manual: true });
    expect(items.payouts_matched.sub).toBe(
      "3 card payouts arrived in October 2026, $4,125.50 net; the bank shows 2 card payout lines, $4,000.00: a difference of $125.50. Mark this done once each payout is matched.",
    );
    // Marked by a person: done, and the evidence stays on the line.
    expect(byKey(p, { payouts_matched: true }).payouts_matched).toMatchObject({ done: true, proven: false, manual: true });
    expect(byKey(p, { payouts_matched: true }).payouts_matched.sub).toMatch(/^Marked done · 3 card payouts arrived/);
    // Bank reconciliation off: the provider side only.
    expect(byKey({ ...p, bankPayouts: null }).payouts_matched.sub).toBe("3 card payouts arrived in October 2026, $4,125.50 net. Compare them with the bank's card payout lines, then mark this done.");
    // Every payout marked matched: proven.
    expect(byKey({ ...p, payouts: { ok: true, value: { arrived: 3, matched: 3, netCents: 1 } } }).payouts_matched).toMatchObject({ done: true, proven: true });
  });

  it("a refund waiting keeps the refunds check open and says which", () => {
    const items = byKey(BOOKS_PROOFS.waiting);
    expect(items.refunds_reviewed).toMatchObject({ done: false, proven: false, manual: true });
    expect(items.refunds_reviewed.sub).toBe(
      "1 refund request waits for approval or recording; 1 refund made in Stripe or PayPal waits for two approvals (Giving › Payments)",
    );
    // A count that could not be read is never "nothing waits".
    expect(byKey({ ...BOOKS_PROOFS.clear, flaggedRefunds: null }).refunds_reviewed).toMatchObject({ done: false, proven: false });
    expect(byKey({ ...BOOKS_PROOFS.clear, refundRequests: { ok: false, why: "error" } }).refunds_reviewed.sub).toBe("Could not count the refund requests");
  });

  it("never ticks what the reader cannot see (RLS hides it): the check stays open, the exceptions included", () => {
    const items = byKey(BOOKS_PROOFS.no_access);
    expect(Object.values(items).some((i) => i.proven)).toBe(false);
    expect(items.exceptions_cleared).toMatchObject({ done: false, manual: false, sub: "Weaver could not check this with your access: someone who can see QuickBooks postings checks it" });
    expect(items.payouts_matched.sub).toBe("Weaver could not check this with your access");
    expect(byKey({ ...BOOKS_PROOFS.clear, exceptions: { ok: true, value: 2 } }).exceptions_cleared).toMatchObject({ done: false, sub: "2 left · fix on the sync tab" });
    expect(byKey({ ...BOOKS_PROOFS.clear, exceptions: { ok: false, why: "error" } }).exceptions_cleared.sub).toBe("Could not count the exceptions");
  });

  it("the preview data draws without a session", () => {
    expect(sampleBooks("clear").state.items.filter((i) => i.proven)).toHaveLength(3);
    expect(sampleBooks("no_access").canClose).toBe(false);
  });
});

describe("QuickBooks donor matches", () => {
  const row = (id: string, customer: string, household: string, confidence: number, name = `Customer ${customer}`): MatchRow => ({
    id,
    qbo_customer_id: customer,
    household_id: household,
    confidence,
    method: "email",
    evidence: { qb: { display_name: name } },
  });

  it("only a customer with one suggested household is approved in a row; the surest first", () => {
    const g = groupSuggestions([row("a", "1", "h1", 0.8), row("b", "2", "h2", 0.97, "T. Adeyemi"), row("c", "3", "h3", 0.9), row("d", "3", "h4", 0.85)]);
    expect(g).toMatchObject({ customers: 3, several: 1 });
    expect(g.single.map((s) => [s.matchId, s.qboName, s.how])).toEqual([
      ["b", "T. Adeyemi", "Email · 97%"],
      ["a", "Customer 1", "Email · 80%"],
    ]);
  });

  const NONE: TodayCan = { approve: false, manage: false, bankConfirm: false, allocate: false, countRecord: false, closeManage: false };
  const ctx: TodayContext = {
    can: NONE,
    currency: "USD",
    locale: "en-US",
    timeZone: "America/Chicago",
    today: "2026-10-12",
    labels: { orgMemberLabel: "member", orgHouseholdLabel: "Club household ID" },
    countsWord: "Cash counts",
    zelleWord: "Zelle",
    visible: { approvals: false, bank: false, pledges: false, counts: false, books: true },
  };
  const input = (donors: TodayInput["donors"]): TodayInput => ({ tasks: [], taskFailures: [], families: {}, bank: null, behind: null, apply: null, counts: null, close: null, donors });
  const shown = [{ matchId: "m1", qboName: "T. Adeyemi", how: "Email · 97%", family: TODAY_FAMILIES.adeyemi }];

  it("Today: Approve in the row names the customer and the household (2 clicks: Giving, Approve); the rest point at Donor matching", () => {
    const q = buildQueue(input({ state: "ok", data: { canApprove: true, customers: 5, several: 1, shown, more: 3 } }), ctx);
    const [first, more] = q.rows;
    expect(first).toMatchObject({ group: "books", family: TODAY_FAMILIES.adeyemi, title: "QuickBooks customer “T. Adeyemi” looks like the Adeyemi household 0127", count: 1 });
    expect(first.acts[0]).toEqual({ kind: "qbo_match", matchId: "m1", qboName: "T. Adeyemi", label: "Approve: “T. Adeyemi” is the Adeyemi household 0127" });
    expect(more).toMatchObject({ title: "4 more QuickBooks customers with a suggested household", count: 4 });
    expect(more.lines[0]).toBe("Each is approved next to its household card in Donor matching. 1 customer has more than one possible household.");
    expect(q.tiles.find((t) => t.key === "books")?.count).toBe(5);
  });

  it("Today: someone who cannot approve sees a count, never a button; nothing waiting shows nothing", () => {
    const q = buildQueue(input({ state: "ok", data: { canApprove: false, customers: 2, several: 0, shown, more: 1 } }), ctx);
    expect(q.rows).toHaveLength(1);
    expect(q.rows[0]).toMatchObject({ info: true, title: "2 QuickBooks customers have a suggested household" });
    expect(q.rows[0].acts.every((a) => a.kind === "link")).toBe(true);
    expect(buildQueue(input({ state: "ok", data: { canApprove: true, customers: 0, several: 0, shown: [], more: 0 } }), ctx).rows).toEqual([]);
    expect(buildQueue(input({ state: "error", error: "Could not read the QuickBooks donor matches — offline." }), ctx).problems).toEqual([
      { group: "books", message: "Could not read the QuickBooks donor matches — offline." },
    ]);
  });
});

describe("Books and Bolis inside Giving's tab row (New look)", () => {
  const treasurer = ["giving.view", "giving.manage", "giving.record_offline", "accounting.close", "accounting.manage", "bolis.manage"];
  const tabCtx = (modulesOff: string[] = [], kind = NEUTRAL_KIND): TabContext => ({ permissions: treasurer, isPlatformAdmin: false, modulesOff, kind });

  it("every Books address lights Books, every Bolis address lights Bolis", () => {
    const tabs = givingTabs(tabCtx([], LEGACY_KIND));
    expect(activeGivingTab(tabs, "/accounting/close")).toBe("books");
    expect(activeGivingTab(tabs, "/accounting/qbo/matching")).toBe("books");
    expect(activeGivingTab(tabs, "/bolis/upload")).toBe("bolis");
    expect(activeGivingTab(tabs, "/giving")).toBe("today");
  });

  it("Books' views: close first, then QuickBooks sync, donor matching, setup; any other tab after them", () => {
    const tabs = ["/accounting/qbo", "/accounting/qbo/setup", "/accounting/qbo/mapping", "/accounting/qbo/matching", "/accounting/close"].map((href) => ({ href }));
    expect(booksViewOrder(tabs).map((t) => t.href)).toEqual(["/accounting/close", "/accounting/qbo", "/accounting/qbo/matching", "/accounting/qbo/setup", "/accounting/qbo/mapping"]);
  });

  it("Books leaves the row when the accounting module is off", () => {
    expect(givingTabs(tabCtx(["accounting"])).map((t) => t.key)).not.toContain("books");
  });
});
