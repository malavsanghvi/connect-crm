import { beforeEach, describe, expect, it, vi } from "vitest";

// The Server Actions of Pathshala › Levels and Terms › Fees and rules, with the session replaced by a stand-in viewer
// and the database by a stand-in client: what is checked is what each action sends to the 0590 functions (and what it
// refuses to send), and what it answers the screen.
const CENTER = "00000000-0000-4000-8000-000000000001";
const TERM = "t1111111-1111-4111-8111-111111111111";

type Row = Record<string, unknown>;

const stub = vi.hoisted(() => ({
  viewer: null as unknown,
  tables: {} as Record<string, Record<string, unknown>[]>,
  answers: {} as Record<string, { data?: unknown; error?: unknown }>,
  rpc: [] as { name: string; args: Record<string, unknown> }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/pathshala/server", () => ({
  actionContext: async (check?: (v: unknown) => boolean, denied = "You don't have permission to do that.") => {
    const { FormError } = await import("@/lib/forms");
    if (check && !check(stub.viewer)) throw new FormError(denied);
    const db = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        stub.rpc.push({ name, args });
        const a = stub.answers[name] ?? {};
        return { data: a.data ?? null, error: a.error ?? null };
      },
      from: (table: string) => ({
        select: () => {
          const filters: ((r: Row) => boolean)[] = [];
          const result = () => ({ data: (stub.tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null });
          const q = {
            eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
            in: (c: string, vs: readonly unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
            order: () => q,
            maybeSingle: async () => ({ data: result().data[0] ?? null, error: null }),
            then: (ok: (r: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad),
          };
          return q;
        },
      }),
    };
    return { viewer: stub.viewer, supabase: db, centerId: CENTER, tz: "America/Chicago" };
  },
}));

import { openRegistrationAction, saveFeesAction, saveRulesAction, tryFamilyAction } from "@/app/(app)/pathshala/terms/[id]/fees/actions";
import { saveLevelAction, setLevelActiveAction } from "@/app/(app)/pathshala/levels/actions";
import { FUND_CLEARED_SENTENCE } from "@/lib/pathshala-registration/contract";

const viewer = (permissions: string[]) => ({ permissions, isPlatformAdmin: false, grants: [], center: { id: CENTER, currency: "USD", time_zone: "America/Chicago" } });
const PRINCIPAL = viewer(["pathshala.view", "pathshala.manage"]);
const TREASURER = viewer(["giving.view", "giving.manage"]);

const form = (fields: [string, string][]) => {
  const fd = new FormData();
  for (const [k, v] of fields) fd.append(k, v);
  return fd;
};

/** A term with its 0590 rules; `locked` sets fees_locked_at. */
function term(over: { status?: string; locked?: boolean; fund_id?: string | null } = {}) {
  const base = { id: TERM, name: "2026-27", status: over.status ?? "draft", starts_on: "2026-09-06", ends_on: "2027-05-30", registration_closes_at: "2026-09-02T04:59:00Z" };
  return {
    ...base,
    center_id: CENTER,
    payment_mode: "pledge",
    hold_hours: 48,
    office_payment_allowed: false,
    office_hold_days: 7,
    seat_rule: "automatic",
    campaign_id: null,
    fund_id: over.fund_id ?? null,
    late_registration_closes_at: null,
    late_fee_cents: 0,
    withdrawal_credit_until: null,
    age_cutoff_on: null,
    fees_locked_at: over.locked ? "2026-08-01T15:00:00Z" : null,
    fees_locked_by: null,
  };
}

const LEVELS = [
  { id: "toddler", center_id: CENTER, track_id: "tj", key: "toddler", name: "Toddler", sort_order: 0, min_age: null, max_age: 4, active: true },
  { id: "j1", center_id: CENTER, track_id: "tj", key: "1", name: "Jainism 1", sort_order: 1, min_age: null, max_age: null, active: true },
  { id: "j2", center_id: CENTER, track_id: "tj", key: "2", name: "Jainism 2", sort_order: 2, min_age: null, max_age: null, active: true },
];

function setUp(t: ReturnType<typeof term>, who = PRINCIPAL, fees: Row[] = [{ center_id: CENTER, term_id: TERM, level_id: "toddler", fee_cents: 4500, set_by: null, set_at: null }]) {
  stub.viewer = who;
  stub.tables = { pathshala_terms: [t], pathshala_levels: LEVELS, pathshala_level_fees: fees };
  stub.answers = {};
}

beforeEach(() => {
  stub.rpc = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("saveFeesAction", () => {
  it("sends only the fees that changed and names every level it saved", async () => {
    setUp(term());
    const out = await saveFeesAction(TERM, null, form([["fee:toddler", "45"], ["fee:j1", "130"], ["fee:j2", "Free"]]));
    expect(stub.rpc).toEqual([
      { name: "set_pathshala_level_fees", args: { p_term: TERM, p_fees: [{ level_id: "j1", fee_cents: 13000 }, { level_id: "j2", fee_cents: 0 }], p_reason: null } },
    ]);
    expect(out).toEqual({ ok: true, message: "Fees saved for 2026-27: Jainism 1 $130.00 and Jainism 2 Free.", data: undefined });
  });

  it("saves nothing that was not typed: blank boxes (where a suggestion is only shown) send no fee", async () => {
    setUp(term());
    const out = await saveFeesAction(TERM, null, form([["fee:toddler", ""], ["fee:j1", ""], ["fee:j2", ""]]));
    expect(stub.rpc).toEqual([]);
    expect(out).toMatchObject({ ok: true, message: "Nothing to save: every fee is as it was." });
  });

  it("after the lock: the treasurer needs a reason, only when something changed; the principal may not change fees", async () => {
    setUp(term({ status: "registration", locked: true }), TREASURER);
    expect(await saveFeesAction(TERM, null, form([["fee:toddler", "45"]]))).toMatchObject({ ok: true, message: "Nothing to save: every fee is as it was." });
    expect(await saveFeesAction(TERM, null, form([["fee:toddler", "50"]]))).toEqual({
      ok: false,
      error: "Registration is open: say why the fees change. The reason is kept in the audit log.",
    });
    expect(stub.rpc).toEqual([]);
    const out = await saveFeesAction(TERM, null, form([["fee:toddler", "50"], ["reason", "The committee raised the Toddler fee"]]));
    expect(stub.rpc[0]).toEqual({ name: "set_pathshala_level_fees", args: { p_term: TERM, p_fees: [{ level_id: "toddler", fee_cents: 5000 }], p_reason: "The committee raised the Toddler fee" } });
    expect(out).toMatchObject({ ok: true, message: "Fee saved for 2026-27: Toddler $50.00. The change applies to new registrations only." });

    setUp(term({ status: "registration", locked: true }), PRINCIPAL);
    stub.rpc = [];
    const refused = await saveFeesAction(TERM, null, form([["fee:toddler", "50"], ["reason", "x"]]));
    expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/^Registration is open, so fees and rules are locked\. Only the treasurer/) });
    expect(stub.rpc).toEqual([]);
  });

  it("shows the database's own sentence next to the form when it refuses", async () => {
    setUp(term());
    stub.answers.set_pathshala_level_fees = { error: { code: "22023", message: "A fee is $0 (Free) or at least $0.50 (Jainism 1 was $0.25)." } };
    expect(await saveFeesAction(TERM, null, form([["fee:j1", "130"]]))).toEqual({
      ok: false,
      error: "Could not save the fees — A fee is $0 (Free) or at least $0.50 (Jainism 1 was $0.25).",
    });
  });
});

const RULES: [string, string][] = [
  ["payment_mode", "pledge"],
  ["hold_hours", "48"],
  ["office_hold_days", "7"],
  ["seat_rule", "automatic"],
  ["sibling_discount_pct", "10"],
  ["fee_per_family_cap", "275"],
  ["late_fee", "0"],
];

describe("saveRulesAction", () => {
  it("leaves the fund out unless the treasurer changes it", async () => {
    setUp(term({ fund_id: "f1" }), TREASURER);
    await saveRulesAction(TERM, null, form([...RULES, ["fund_id", "f1"]]));
    expect(stub.rpc[0].name).toBe("set_pathshala_term_rules");
    expect(stub.rpc[0].args.p_rules).not.toHaveProperty("fund_id");
    expect(stub.rpc[0].args.p_rules).toMatchObject({ sibling_discount_pct: 10, fee_per_family_cap_cents: 27500, late_fee_cents: 0 });
    stub.rpc = [];
    await saveRulesAction(TERM, null, form([...RULES, ["fund_id", "f2"]]));
    expect(stub.rpc[0].args.p_rules).toMatchObject({ fund_id: "f2" });
  });

  it("never sends a fund for the principal (0590: the fund needs giving.manage)", async () => {
    setUp(term(), PRINCIPAL);
    const out = await saveRulesAction(TERM, null, form([...RULES, ["fund_id", "f2"]]));
    expect(out).toEqual({ ok: false, error: "Choosing the fund for Pathshala fees needs giving.manage (the treasurer)." });
    expect(stub.rpc).toEqual([]);
    await saveRulesAction(TERM, null, form(RULES));
    expect(stub.rpc[0].args.p_rules).not.toHaveProperty("fund_id");
  });

  it("refuses to clear the fund once registration has opened, in 0590's words", async () => {
    setUp(term({ status: "registration", locked: true, fund_id: "f1" }), TREASURER);
    const out = await saveRulesAction(TERM, null, form([...RULES, ["fund_id", ""], ["reason", "tidy up"]]));
    expect(out).toEqual({ ok: false, error: FUND_CLEARED_SENTENCE });
    expect(stub.rpc).toEqual([]);
  });

  it("never turns a cleared sibling-discount box into 0% by itself", async () => {
    setUp(term(), PRINCIPAL);
    const out = await saveRulesAction(TERM, null, form(RULES.map(([k, v]) => [k, k === "sibling_discount_pct" ? "" : v])));
    expect(out).toEqual({ ok: false, error: "Give the sibling discount as a whole percent from 0 to 100 (0 for none)." });
    expect(stub.rpc).toEqual([]);
  });

  it("after the lock a change needs a reason", async () => {
    setUp(term({ status: "registration", locked: true, fund_id: "f1" }), TREASURER);
    expect(await saveRulesAction(TERM, null, form(RULES))).toEqual({
      ok: false,
      error: "Registration is open: say why the fee rules change. The reason is kept in the audit log.",
    });
    const out = await saveRulesAction(TERM, null, form([...RULES, ["reason", "One more week of late registration"]]));
    expect(stub.rpc[0].args.p_reason).toBe("One more week of late registration");
    expect(out).toMatchObject({ ok: true, message: "Rules saved for 2026-27. The change applies to new registrations only." });
  });
});

describe("openRegistrationAction", () => {
  it("shows the database's refusal, naming the levels without a fee", async () => {
    setUp(term());
    stub.answers.open_pathshala_registration = { error: { code: "22023", message: "Set the fee for Jainism 1 and Jainism 2 before opening registration." } };
    expect(await openRegistrationAction(TERM, null, form([]))).toEqual({
      ok: false,
      error: "Could not open registration — Set the fee for Jainism 1 and Jainism 2 before opening registration.",
    });
    expect(stub.rpc).toEqual([{ name: "open_pathshala_registration", args: { p_term: TERM, p_reason: null } }]);
  });

  it("says what opening did, with the database's warnings; an open term says it was already open", async () => {
    setUp(term());
    stub.answers.open_pathshala_registration = {
      data: { term_id: TERM, status: "registration", already_open: false, warnings: [{ level_id: "j1", level: "Jainism 1", sentence: "Jainism 1 has no age band, so the app cannot suggest it by age." }] },
    };
    expect(await openRegistrationAction(TERM, null, form([]))).toMatchObject({
      ok: true,
      message: "Registration is open for 2026-27. Its fees and rules are locked: from now on only the treasurer can change them, with a reason. Note: Jainism 1 has no age band, so the app cannot suggest it by age.",
    });
    stub.answers.open_pathshala_registration = { data: { term_id: TERM, status: "registration", already_open: true, warnings: [] } };
    expect(await openRegistrationAction(TERM, null, form([]))).toMatchObject({ ok: true, message: "Registration was already open for 2026-27; its fees and rules are locked." });
  });

  it("is the principal's: the treasurer cannot open registration", async () => {
    setUp(term({ status: "registration" }), TREASURER);
    expect(await openRegistrationAction(TERM, null, form([]))).toEqual({ ok: false, error: "Only the Pathshala principal (pathshala.manage) can open registration." });
    expect(stub.rpc).toEqual([]);
  });
});

describe("tryFamilyAction", () => {
  const row = (key: string, name: string, age: string, level: string): [string, string][] => [
    ["row_key", key],
    ["name", name],
    ["age", age],
    ["level_id", level],
  ];
  const line = (index: number, over: Row = {}) => ({
    index,
    learner_kind: "child",
    family_rank: index,
    age_on_cutoff: 12,
    base_fee_cents: 13000,
    sibling_discount_cents: 0,
    cap_reduction_cents: 0,
    late_fee_cents: 0,
    assistance_cents: 0,
    total_cents: 13000,
    priced: true,
    refusal: null,
    ...over,
  });

  it("sends {lines, late}: one learner per name (learner = the typed name), and the tick decides the late window", async () => {
    setUp(term());
    stub.answers.pathshala_fee_example = { data: { lines: [line(1), line(2), line(3)], children_total_cents: 39000, adults_total_cents: 0, total_cents: 39000, late: false } };
    await tryFamilyAction(TERM, null, form([...row("1", "Riya", "12", "j1"), ...row("2", " riya ", "12", "j2"), ...row("3", "", "9", "j1"), ...row("4", "", "", "")]));
    expect(stub.rpc[0]).toEqual({
      name: "pathshala_fee_example",
      args: {
        p_term: TERM,
        p_lines: {
          lines: [
            { name: "Riya", learner: "Riya", age: 12, level_id: "j1" },
            { name: "riya", learner: "riya", age: 12, level_id: "j2" },
            { name: "Learner 3", age: 9, level_id: "j1" },
          ],
          late: false,
        },
      },
    });
    stub.rpc = [];
    await tryFamilyAction(TERM, null, form([...row("1", "Dev", "9", "j1"), ["late", "on"]]));
    expect(stub.rpc[0].args.p_lines).toEqual({ lines: [{ name: "Dev", learner: "Dev", age: 9, level_id: "j1" }], late: true });
  });

  it("refuses one learner with two ages, before asking the database", async () => {
    setUp(term());
    const out = await tryFamilyAction(TERM, null, form([...row("1", "Riya", "12", "j1"), ...row("2", "Riya", "13", "j2")]));
    expect(out).toEqual({ ok: false, error: "Riya is on two rows with different ages (12 and 13). Give one age, or two different names for two learners." });
    expect(stub.rpc).toEqual([]);
  });

  it("hands each line back with its name and its row, and a refused line keeps the database's sentence", async () => {
    setUp(term());
    stub.answers.pathshala_fee_example = {
      data: {
        lines: [
          line(1),
          line(2, { learner_kind: "adult", family_rank: null, base_fee_cents: 0, total_cents: 0, priced: false, refusal: "Jainism 2 is a children's class, and Mira is an adult." }),
        ],
        children_total_cents: 13000,
        adults_total_cents: 0,
        total_cents: 13000,
        late: false,
      },
    };
    const out = await tryFamilyAction(TERM, null, form([...row("7", "Riya", "12", "j1"), ...row("9", "Mira", "44", "j2")]));
    expect(out.ok).toBe(true);
    if (!out.ok || !out.data) return;
    expect(out.data.lines.map((l) => [l.first_name, l.row_key, l.refusal])).toEqual([
      ["Riya", "7", null],
      ["Mira", "9", "Jainism 2 is a children's class, and Mira is an adult."],
    ]);
    expect(out.data.total_cents).toBe(13000);
  });

  it("says plainly when the database answers with something it cannot read (no totals are added up here)", async () => {
    setUp(term());
    stub.answers.pathshala_fee_example = { data: { lines: [line(1)] } };
    const out = await tryFamilyAction(TERM, null, form(row("1", "Riya", "12", "j1")));
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/^Could not work out the fees for this family — the database answered with something this screen cannot read \(the quote has no totals/) });
  });
});

describe("saveLevelAction and setLevelActiveAction", () => {
  const fields: [string, string][] = [
    ["track_id", "tj"],
    ["track_name", "Jainism"],
    ["name", "Jainism 2"],
    ["key", "2"],
    ["sort_order", "2"],
    ["min_age", "7"],
    ["max_age", "9"],
  ];

  it("an edit never sends `active`, so a stale page cannot offer a retired level again", async () => {
    setUp(term());
    stub.answers.save_pathshala_level = { data: { ...LEVELS[2], min_age: 7, max_age: 9 } };
    await saveLevelAction("j2", null, form([...fields, ["active", "true"]]));
    expect(stub.rpc[0]).toEqual({
      name: "save_pathshala_level",
      args: { p_center: CENTER, p_level: { id: "j2", track_id: "tj", key: "2", name: "Jainism 2", sort_order: 2, min_age: 7, max_age: 9 }, p_reason: null },
    });
    stub.rpc = [];
    await saveLevelAction(null, null, form(fields.map(([k, v]) => [k, k === "key" ? "" : k === "name" ? "Jainism 8" : v])));
    expect(stub.rpc[0].args.p_level).toEqual({ track_id: "tj", key: "8", name: "Jainism 8", sort_order: 2, min_age: 7, max_age: 9 });
  });

  it("retiring sends only the id and the flag; the principal only", async () => {
    setUp(term());
    stub.answers.save_pathshala_level = { data: { ...LEVELS[1], active: false } };
    expect(await setLevelActiveAction("j1", null, form([["active", "false"]]))).toMatchObject({ ok: true, message: expect.stringMatching(/^Jainism 1 is retired/) });
    expect(stub.rpc).toEqual([{ name: "save_pathshala_level", args: { p_center: CENTER, p_level: { id: "j1", active: false }, p_reason: null } }]);
    setUp(term(), TREASURER);
    stub.rpc = [];
    expect(await setLevelActiveAction("j1", null, form([["active", "false"]]))).toEqual({ ok: false, error: "Only the Pathshala principal can retire levels." });
    expect(stub.rpc).toEqual([]);
  });
});
