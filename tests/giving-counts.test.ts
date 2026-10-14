import { describe, expect, it } from "vitest";

// Giving › the counts (docs/GIVING_REDESIGN.md slice 5, B93; owner decisions 2026-10-13): pure rules, no database.
import { denominationLabel, denominationsFor, denominationTotal, readDenominations, reconcileTotal } from "@/lib/giving-counts/denominations";
import { SAMPLE_COUNTERS, SAMPLE_COUNTS, SAMPLE_LINES, sampleCountCan, sampleCountsModel } from "@/lib/giving-counts/fixtures";
import {
  counterCheck,
  countRow,
  countStatus,
  countViewFromParam,
  depositChoices,
  isDeposited,
  lastCounters,
  linkedCountLabel,
  matchButton,
  noDepositText,
  preselectDeposit,
  type CountIn,
  type CountRowContext,
} from "@/lib/giving-counts/model";
import { ROWING_CLUB } from "@/lib/giving-lists/fixtures";
import { sampleTodayModel } from "@/lib/giving-today/fixtures";
import { buildQueue, type TodayCan } from "@/lib/giving-today/queue";
import { LEGACY_KIND, NEUTRAL_KIND } from "@/lib/kind";
import { formatCents } from "@/lib/money";
import { countsWord } from "@/lib/wording";

const usd = (c: number) => formatCents(c, "USD", "en-US");
const CTX = (over: Partial<CountRowContext> = {}): CountRowContext => ({
  currency: "USD",
  locale: "en-US",
  timeZone: "America/Chicago",
  today: "2026-10-12",
  can: { record: true, match: true, unmatch: true },
  bankOn: true,
  ...over,
});
const count = (over: Partial<CountIn> = {}): CountIn => ({ ...SAMPLE_COUNTS[0], ...over });

describe("notes and coins, in integer minor units", () => {
  it("offers the currency's own notes and coins, and none for a currency it does not list", () => {
    expect(denominationsFor("USD")).toContain(2_000);
    expect(denominationsFor("inr")).toContain(50_000);
    expect(denominationsFor("XOF")).toBeNull();
    expect(denominationLabel(2_000, "USD", "en-US")).toBe("$20");
    expect(denominationLabel(25, "USD", "en-US")).toBe("$0.25");
    expect(denominationLabel(50, "EUR", "en-IE")).toBe("€0.50");
    expect(denominationLabel(50_000, "INR", "en-IN")).toBe("₹500");
  });

  it("adds up the pieces exactly, empty and zero left out", () => {
    const r = readDenominations({ "2000": "3", "25": "12", "100": "", "500": "0" }, "USD");
    expect(r).toEqual({ ok: true, counts: { "2000": 3, "25": 12 }, totalCents: 6_300 });
    // Another currency: rupees in paise, as integers (two ₹500 notes and seven ₹10 coins).
    const inr = readDenominations(JSON.stringify({ "50000": 2, "1000": 7 }), "INR");
    expect(inr).toEqual({ ok: true, counts: { "50000": 2, "1000": 7 }, totalCents: 107_000 });
    expect(formatCents(107_000, "INR", "en-IN")).toBe("₹1,070.00");
    expect(denominationTotal({ "1": 99_999, "10000": 1 })).toBe(109_999);
    expect(readDenominations("", "USD")).toEqual({ ok: true, counts: {}, totalCents: null });
  });

  it("refuses a piece the currency does not have, a fraction and a typo-sized number", () => {
    expect(readDenominations({ "300": "1" }, "USD")).toMatchObject({ ok: false, error: "a note or coin is not one of this currency's" });
    expect(readDenominations({ "2000": "1" }, "XOF")).toMatchObject({ ok: false });
    expect(readDenominations({ "2000": "1.5" }, "USD")).toMatchObject({ ok: false, error: "each note and coin needs a whole number, like 12" });
    expect(readDenominations({ "2000": "1000000" }, "USD")).toMatchObject({ ok: false });
    expect(readDenominations("{nope", "USD")).toMatchObject({ ok: false });
  });

  it("the total is the one typed or the pieces; both must agree", () => {
    expect(reconcileTotal(41_250, null, usd)).toEqual({ ok: true, cents: 41_250 });
    expect(reconcileTotal(null, 6_300, usd)).toEqual({ ok: true, cents: 6_300 });
    expect(reconcileTotal(6_300, 6_300, usd)).toEqual({ ok: true, cents: 6_300 });
    expect(reconcileTotal(null, null, usd)).toEqual({ ok: true, cents: 0 });
    expect(reconcileTotal(6_000, 6_300, usd)).toEqual({ ok: false, error: "the notes and coins add up to $63.00 but the total says $60.00" });
  });
});

describe("the counters: two adults from different households", () => {
  const [ama, grace, lee, linh, sam] = SAMPLE_COUNTERS;
  it("says yes or no to different households before the database refuses", () => {
    expect(counterCheck([linh, sam])).toEqual({ problem: null, differentHouseholds: true });
    expect(counterCheck([grace, lee])).toEqual({ problem: "The counters must come from different households.", differentHouseholds: false });
    expect(counterCheck([grace, lee, ama])).toEqual({ problem: null, differentHouseholds: true });
    expect(counterCheck([linh])).toEqual({ problem: "Choose at least two counters.", differentHouseholds: null });
  });

  it("fills in the last count's counters who can still count, at most three", () => {
    expect(lastCounters(["u-0000-sam", "u-0000-linh"], SAMPLE_COUNTERS)).toEqual(["u-0000-sam", "u-0000-linh"]);
    // Someone who is not offered (no longer staff, or under 18) is not filled in.
    expect(lastCounters(["u-0000-sam", "u-gone", "u-0000-linh"], SAMPLE_COUNTERS)).toEqual(["u-0000-sam", "u-0000-linh"]);
    expect(lastCounters(["u-0000-ama", "u-0000-grace", "u-0000-linh", "u-0000-sam"], SAMPLE_COUNTERS)).toHaveLength(3);
    expect(lastCounters(null, SAMPLE_COUNTERS)).toEqual([]);
  });
});

describe("a count as a row", () => {
  it("waiting, with Bank reconciliation on: Match its deposit on the row, Mark deposited in the menu", () => {
    const r = countRow(count(), CTX());
    expect(r.primary.map((a) => a.kind)).toEqual(["count_match"]);
    expect(r.menu.map((a) => a.kind)).toEqual(["count_deposit"]);
    expect(r.primary[0]).toMatchObject({ totalCents: 41_250, countedOn: "2026-10-11", label: "Match the Oct 11, 2026 count to its deposit" });
    expect(r).toMatchObject({ reference: "Bags 118, 119", amount: "$412.50", family: null, status: { label: "Counted · waiting for the deposit", tone: "warn" } });
    expect(r.lines).toEqual(["Counted by Sam Carter and Linh Nguyen", "At Harvest supper"]);
  });

  it("with Bank reconciliation off: Mark deposited with the slip reference, as before", () => {
    const r = countRow(count(), CTX({ bankOn: false, can: { record: true, match: false, unmatch: false } }));
    expect(r.primary).toMatchObject([{ kind: "count_deposit", button: "Mark deposited" }]);
    expect(r.menu).toEqual([]);
  });

  it("matched: says which deposit; only a treasurer may undo it", () => {
    const matched = SAMPLE_COUNTS[1];
    const r = countRow(matched, CTX());
    expect(r.status).toEqual({ label: "Matched to the bank", tone: "ok" });
    expect(r.lines).toContain("Bank deposit of Oct 6, 2026 · $380.00 · Operating ••4410");
    expect(r.primary).toEqual([]);
    expect(r.menu.map((a) => a.kind)).toEqual(["count_unmatch"]);
    expect(countRow(matched, CTX({ can: sampleCountCan("volunteer") })).menu).toEqual([]);
    expect(countRow({ ...matched, line: null }, CTX()).lines).toContain("Matched to a bank deposit");
  });

  it("a viewer acts on nothing; a count without its total cannot be matched yet", () => {
    expect(countRow(count(), CTX({ can: sampleCountCan("approver") }))).toMatchObject({ primary: [], menu: [] });
    const planned = countRow(count({ totalCents: 0, countedOn: "2026-10-20" }), CTX());
    expect(planned.primary.map((a) => a.kind)).toEqual(["count_deposit"]);
    expect(planned.status).toEqual({ label: "Planned", tone: "info" });
    expect(countStatus(count({ depositRef: "SLIP-1" }), "2026-10-12")).toEqual({ label: "Deposited", tone: "ok" });
  });

  it("is deposited when matched, marked with a slip or posted as a payment", () => {
    expect(isDeposited(count())).toBe(false);
    expect(isDeposited(count({ matched: true }))).toBe(true);
    expect(isDeposited(count({ depositRef: "SLIP" }))).toBe(true);
    expect(isDeposited(count({ paymentId: "p" }))).toBe(true);
    expect(countViewFromParam("waiting")).toBe("waiting");
    expect(countViewFromParam("x")).toBe("all");
  });

  it("speaks euros in a non-faith club", () => {
    const r = countRow(count(), CTX({ currency: "EUR", locale: "en-IE", timeZone: "Europe/Dublin" }));
    expect(r.amount).toBe("€412.50");
  });
});

describe("picking the deposit line (exact amount only, owner 2026-10-13)", () => {
  const c = { countedOn: "2026-10-11", totalCents: 41_250 };
  it("offers only lines of exactly the counted amount, not matched to anything, nearest first", () => {
    const choices = depositChoices(c, SAMPLE_LINES, CTX());
    expect(choices.map((x) => x.id)).toEqual([SAMPLE_LINES[0].id]);
    expect(choices[0]).toMatchObject({ days: 2, label: "Oct 13, 2026 · $412.50 · Operating ••4410" });
    expect(preselectDeposit(choices)).toBe(SAMPLE_LINES[0].id);
    expect(matchButton(choices[0], CTX())).toBe("Match $412.50 to the Oct 13, 2026 deposit");
    expect(matchButton(null, CTX())).toBe("Pick the deposit first");
  });

  it("chooses nothing for the person when two lines fit", () => {
    const two = [...SAMPLE_LINES, { ...SAMPLE_LINES[0], id: "second", postedOn: "2026-10-10" }];
    const choices = depositChoices(c, two, CTX());
    expect(choices.map((x) => x.id)).toEqual(["second", SAMPLE_LINES[0].id]);
    expect(preselectDeposit(choices)).toBeNull();
  });

  it("says what to do when no line fits, and offers nothing for a count without its total", () => {
    expect(depositChoices({ ...c, totalCents: 41_300 }, SAMPLE_LINES, CTX())).toEqual([]);
    expect(depositChoices({ ...c, totalCents: 0 }, SAMPLE_LINES, CTX())).toEqual([]);
    expect(noDepositText(c, CTX())).toContain("No bank line of exactly $412.50 near Oct 11, 2026");
    expect(noDepositText(c, CTX())).toContain("Mark deposited");
  });

  it("names the count next to its line on the Bank tab", () => {
    expect(linkedCountLabel({ countedOn: "2026-10-04", totalCents: 38_000, bags: ["116", "117"] }, CTX())).toBe("Count of Oct 4, 2026 · $380.00 · bags 116, 117");
  });
});

describe("the counts tab", () => {
  it("speaks the kind's own word: Cash counts for an organization that is not a faith", () => {
    expect(sampleCountsModel("treasurer").countsWord).toBe("Cash counts");
    expect(countsWord(NEUTRAL_KIND)).toBe("Cash counts");
    expect(sampleCountsModel("treasurer", {}, { ...ROWING_CLUB, kind: LEGACY_KIND }).countsWord).toBe("Bhandar counts");
  });

  it("chips and a summary of what waits", () => {
    const m = sampleCountsModel("treasurer");
    expect(m.chips.map((c) => [c.key, c.count])).toEqual([
      ["all", 4],
      ["waiting", 2],
      ["deposited", 2],
    ]);
    expect(m.summary).toBe("2 counts waiting for the deposit · $412.50");
    expect(sampleCountsModel("treasurer", { view: "deposited" }).body).toMatchObject({ state: "ok" });
    const dep = sampleCountsModel("treasurer", { view: "deposited" });
    expect(dep.body.state === "ok" ? dep.body.rows.map((r) => r.id) : []).toEqual([SAMPLE_COUNTS[1].id, SAMPLE_COUNTS[2].id]);
  });

  it("a module that is off says so, never an empty page", () => {
    const m = sampleCountsModel("treasurer", {}, undefined, { modulesOff: ["giving_counts"] });
    expect(m.body).toMatchObject({ state: "off" });
    expect(m.body.state === "off" ? m.body.title : "").toContain("switched off");
    expect(m.can).toEqual({ record: false, match: false, unmatch: false });
    // Giving off switches the counts off with it.
    expect(sampleCountsModel("treasurer", {}, undefined, { modulesOff: ["giving"] }).body).toMatchObject({ state: "off" });
  });

  it("Bank reconciliation off leaves Mark deposited only", () => {
    const m = sampleCountsModel("treasurer", {}, undefined, { modulesOff: ["giving_bank"] });
    expect(m.bankOn).toBe(false);
    const rows = m.body.state === "ok" ? m.body.rows : [];
    expect(rows.flatMap((r) => [...r.primary, ...r.menu]).map((a) => a.kind)).not.toContain("count_match");
    expect(rows.flatMap((r) => [...r.primary, ...r.menu]).map((a) => a.kind)).not.toContain("count_unmatch");
  });

  it("a finance volunteer counts and matches; a viewer only reads", () => {
    expect(sampleCountCan("volunteer")).toEqual({ record: true, match: true, unmatch: false });
    expect(sampleCountCan("treasurer")).toEqual({ record: true, match: true, unmatch: true });
    const viewer = sampleCountsModel("approver");
    expect(viewer.can).toEqual({ record: false, match: false, unmatch: false });
    expect(viewer.note).toContain("You can see the counts");
  });
});

describe("Today's counts row acts in place (slice 5)", () => {
  const NONE: TodayCan = { approve: false, manage: false, bankConfirm: false, allocate: false, countRecord: true, closeManage: false };
  const input = sampleTodayModel("treasurer");
  it("matches the deposit when the person may; Mark deposited otherwise; no link away to count", () => {
    const q = (countMatch: boolean) =>
      buildQueue(
        {
          tasks: [],
          taskFailures: [],
          families: {},
          bank: null,
          behind: null,
          apply: null,
          close: null,
          counts: { state: "ok", data: [{ id: "c1", countedOn: "2026-10-11", totalCents: 41_250, bags: [], counters: ["Sam Carter", "Linh Nguyen"] }] },
        },
        {
          can: { ...NONE, countMatch },
          currency: "USD",
          locale: "en-US",
          timeZone: "America/Chicago",
          today: "2026-10-12",
          labels: input.labels,
          countsWord: "Cash counts",
          zelleWord: "Zelle",
          visible: { approvals: false, bank: false, pledges: false, counts: true, books: false },
        },
      ).rows[0].acts;
    expect(q(true).map((a) => a.kind)).toEqual(["count_match", "count_deposit"]);
    expect(q(false).map((a) => a.kind)).toEqual(["count_deposit"]);
    expect(q(true).some((a) => a.kind === "link")).toBe(false);
  });

  it("a treasurer starts a count from Today's header", () => {
    expect(sampleTodayModel("treasurer").can.countStart).toBe(true);
    expect(sampleTodayModel("approver").can.countStart).toBe(false);
  });
});

describe("the Bank tab names the count a deposit was matched to (read-only)", () => {
  it("says which count, who matched it and when", async () => {
    const { historyRowView } = await import("@/lib/giving-bank/views");
    const row = historyRowView(
      {
        id: "l1",
        postedOn: "2026-10-06",
        amountCents: 38_000,
        description: "DEPOSIT BRANCH 0212 SLIP 4476",
        status: "matched",
        family: null,
        receipt: null,
        by: "Ama Mensah",
        at: "2026-10-07",
        notes: null,
        isDeposit: false,
        count: linkedCountLabel({ countedOn: "2026-10-04", totalCents: 38_000, bags: ["116", "117"] }, CTX()),
      },
      "matched",
      CTX(),
      false,
    );
    expect(row.what).toBe("Matched to the count of Oct 4, 2026 · $380.00 · bags 116, 117 by Ama Mensah on Oct 7, 2026");
    expect(row.family).toBeNull();
  });
});
