import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));

import { LEARNING_COMMANDS } from "@/lib/commands/catalog/learning";
import { confirmProposal, runCommand } from "@/lib/commands/run";
import type { CommandRunResult } from "@/lib/commands/types";

import { ID, NIVA_MAY_CHANGE_LEARNING, asPrincipal, learningWorld, traceDb } from "./learning-world";

const dataOf = <T,>(r: CommandRunResult): T => {
  if (!r.ok || r.needsConfirmation) throw new Error(`expected data, got ${JSON.stringify(r)}`);
  return r.data as T;
};
const messageOf = (r: CommandRunResult): string => (r.ok && !r.needsConfirmation ? (r.message ?? "") : "");
const errorOf = (r: CommandRunResult): string => (!r.ok ? r.error : "");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
describe("the Learning commands", () => {
  it("are listed in the order a principal would meet them: look, prepare, then change", () => {
    expect(LEARNING_COMMANDS.map((c) => `${c.key}:${c.level}`)).toEqual([
      "learning.term_setup:read",
      "learning.registration_checklist:read",
      "learning.classes_needing_teachers:read",
      "learning.waiting_counts:read",
      "learning.fee_report:read",
      "learning.draft_term_change:draft",
      "learning.draft_teacher_assignment:draft",
      "learning.assign_teacher:confirm",
      "learning.save_class:confirm",
      "learning.set_level_fees:confirm",
    ]);
  });

  it("belong to Pathshala, ask for the permission of the screen they stand for, and every change starts off for Niva", () => {
    expect(Object.fromEntries(LEARNING_COMMANDS.map((c) => [c.key, c.permission]))).toEqual({
      "learning.term_setup": "pathshalaFees",
      "learning.registration_checklist": "pathshalaFees",
      "learning.classes_needing_teachers": "pathshala",
      "learning.waiting_counts": "pathshala",
      "learning.fee_report": "pathshalaFees",
      "learning.draft_term_change": "pathshalaFees",
      "learning.draft_teacher_assignment": "pathshala",
      "learning.assign_teacher": "pathshalaManage",
      "learning.save_class": "pathshalaManage",
      "learning.set_level_fees": "pathshalaFees",
    });
    for (const c of LEARNING_COMMANDS) {
      expect(c.module, c.key).toBe("pathshala");
      if (c.level === "confirm") expect(c.enabledByDefault, c.key).toBe(false);
      expect(c.screenOnly, c.key).toBeUndefined();
    }
  });

  it("have a plain title and a description written for a model, and never the word bid", () => {
    for (const c of LEARNING_COMMANDS) {
      expect(c.title.length, c.key).toBeGreaterThan(8);
      expect(c.description.length, c.key).toBeGreaterThan(120);
      expect(`${c.title} ${c.description}`, c.key).not.toMatch(/\bbid\b/i);
    }
  });

  it("say in their own description that they never touch a learner", () => {
    for (const c of LEARNING_COMMANDS) {
      if (c.level === "read" || c.level === "draft") expect(c.description, c.key).toMatch(/never|only|nothing/i);
    }
  });
});

// ---------------------------------------------------------------------------
describe("learning.term_setup", () => {
  it("describes every term that is not closed: dates, rules, and each level with its fee in dollars", async () => {
    const { ctx } = asPrincipal();
    const r = await runCommand(ctx, "learning.term_setup", {});
    const data = dataOf<{ terms: Record<string, unknown>[] }>(r);
    expect(data.terms.map((t) => t.name).sort()).toEqual(["2026-27", "2027-28"]);
    const t1 = data.terms.find((t) => t.name === "2026-27") as Record<string, unknown>;
    expect(t1).toMatchObject({
      term_id: ID.t1,
      status: "Registration open",
      registration_is_open: true,
      dates: "Sun, Sep 6, 2026 to Sun, May 30, 2027",
      fees_and_rules_locked: true,
      rules: {
        how_families_pay: "Register now, pay later (pledge)",
        seats: "A seat at registration",
        seat_hold_hours: null,
        pay_at_the_office: null,
        sibling_discount: "10% off the younger children",
        family_cap: "$300.00",
        late_fee: "$25.00",
        late_registration_until: "no late window",
        withdrawal_credit_until: "set when registration opens",
        age_cut_off_date: "the first day of the term",
        fund: "Pathshala",
        membership_required: false,
      },
      levels_offered_without_a_fee: ["Gujarati 1", "Adult class"],
    });
    expect(String(t1.who_may_change_fees)).toContain("As treasurer");
    expect(t1.registration_dates).toContain("from ");
    const levels = t1.levels as Record<string, unknown>[];
    expect(levels.map((l) => `${l.level}:${l.fee}`)).toEqual(["Jainism 1:$130.00", "Jainism 2:$145.00", "Adult class:Not set", "Gujarati 1:Not set"]);
    expect(levels[0]).toMatchObject({ track: "Jainism", level_id: ID.lJ1, age_band: "Children's level · Ages 5–7", classes_this_term: 1, offered_to_families: true, retired: false, suggested_fee: null });
    expect(levels[2]).toMatchObject({ age_band: "Adult class · 18 and over" });
    expect(messageOf(r)).toBe("2 terms: 2026-27 (registration open), 2027-28 (draft (hidden from families)). Registration is open for 1.");
  });

  it("suggests, never sets, a fee from an earlier term for a level that has none", async () => {
    const { ctx } = asPrincipal();
    const draft = dataOf<{ terms: Record<string, unknown>[] }>(await runCommand(ctx, "learning.term_setup", { term_id: ID.t2 })).terms[0];
    expect(draft).toMatchObject({ name: "2027-28", status: "Draft (hidden from families)", registration_is_open: false, fees_and_rules_locked: false });
    expect(String(draft.who_may_change_fees)).toContain("Until registration opens");
    expect((draft.levels as Record<string, unknown>[])[0]).toMatchObject({ level: "Jainism 1", fee: "Not set", suggested_fee: "$130.00 from 2026-27" });
  });

  it("says plainly when the term is not there, and turns away a role without the Pathshala fees area", async () => {
    expect(errorOf(await runCommand(asPrincipal().ctx, "learning.term_setup", { term_id: ID.nobody }))).toBe("That term was not found, or you can't see it.");
    const none = await runCommand(asPrincipal({ permissions: ["people.view"] }).ctx, "learning.term_setup", {});
    expect(none).toMatchObject({ ok: false, code: "no_access" });
  });

  it("shows closed terms only when asked for by id", async () => {
    const { ctx } = asPrincipal();
    const closed = dataOf<{ terms: Record<string, unknown>[] }>(await runCommand(ctx, "learning.term_setup", { term_id: ID.t0 }));
    expect(closed.terms).toHaveLength(1);
    expect(closed.terms[0]).toMatchObject({ name: "2025-26", status: "Closed" });
    expect(String(closed.terms[0].who_may_change_fees)).toBe("The term is closed, so its fees and rules cannot change.");
  });

  it("reads nothing but set-up data and writes nothing", async () => {
    const world = learningWorld();
    const { ctx, db } = asPrincipal({ world });
    const seen = traceDb(db);
    await runCommand(ctx, "learning.term_setup", {});
    expect(seen.writes).toEqual([]);
    expect(new Set(seen.tables)).toEqual(new Set(["pathshala_terms", "pathshala_levels", "pathshala_level_fees", "pathshala_tracks", "pathshala_classes", "funds"]));
  });
});

// ---------------------------------------------------------------------------
describe("learning.registration_checklist", () => {
  it("lists what a draft term still needs, in plain words, and says it is not ready", async () => {
    const { ctx } = asPrincipal();
    const r = await runCommand(ctx, "learning.registration_checklist", {});
    const data = dataOf<{ terms: { term_id: string; name: string; already_open: boolean; ready_to_open: boolean; items: { status: string; text: string }[]; where: { href: string } }[] }>(r);
    // Only the term whose fees are not locked yet.
    expect(data.terms.map((t) => t.name)).toEqual(["2027-28"]);
    const t = data.terms[0];
    expect(t).toMatchObject({ term_id: ID.t2, already_open: false, ready_to_open: false, where: { href: `/pathshala/terms/${ID.t2}/fees` } });
    expect(t.items[0]).toEqual({ status: "missing", text: "Set the fee for Jainism 1 before opening registration." });
    expect(t.items.some((i) => i.status === "check" && i.text.includes("No registration dates are set"))).toBe(true);
    expect(messageOf(r)).toBe("0 terms are ready to open; 2027-28 still has something missing.");
  });

  it("says a term is ready once every level that has a class has its fee", async () => {
    const world = learningWorld();
    world.tables.pathshala_level_fees.push({ center_id: "center-1", term_id: ID.t2, level_id: ID.lJ1, fee_cents: 13500, set_by: null, set_at: null });
    const { ctx } = asPrincipal({ world });
    const t = dataOf<{ terms: { ready_to_open: boolean; items: { status: string; text: string }[] }[] }>(await runCommand(ctx, "learning.registration_checklist", { term_id: ID.t2 })).terms[0];
    expect(t.ready_to_open).toBe(true);
    expect(t.items[0]).toEqual({ status: "ready", text: "Every offered level has its fee (1 level)." });
  });

  it("says a term whose registration has opened has nothing left to open, and that the principal opens it, not Niva", async () => {
    const { ctx } = asPrincipal();
    const t = dataOf<{ terms: { already_open: boolean; ready_to_open: boolean; items: { text: string }[]; who_opens_it: string }[] }>(await runCommand(ctx, "learning.registration_checklist", { term_id: ID.t1 })).terms[0];
    expect(t).toMatchObject({ already_open: true, ready_to_open: false });
    expect(t.items[0].text).toContain("Registration has already opened");
    expect(t.who_opens_it).toContain("Niva does not");
  });

  it("warns that pay-when-registering cannot be used yet, with the database's reason", async () => {
    const world = learningWorld();
    world.tables.pathshala_terms.find((x) => x.id === ID.t2)!.payment_mode = "pay_now";
    world.rpc.pathshala_pay_now_ready = () => "No card or PayPal payments are taking money yet.";
    const { ctx } = asPrincipal({ world });
    const t = dataOf<{ terms: { ready_to_open: boolean; items: { status: string; text: string }[] }[] }>(await runCommand(ctx, "learning.registration_checklist", { term_id: ID.t2 })).terms[0];
    expect(t.items.find((i) => i.text.includes("Pay when registering"))).toMatchObject({ status: "missing", text: expect.stringContaining("No card or PayPal payments are taking money yet.") });
    expect(t.ready_to_open).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("learning.classes_needing_teachers", () => {
  type Result = {
    terms: { term: string; classes: number; with_a_teacher: number; without_a_teacher: { class_id: string; class: string; level: string; when: string; room: string | null; capacity: number | null; has_an_assistant_or_substitute: boolean; suggestions: Record<string, unknown>[] }[] }[];
    people_left_out_because_their_age_is_not_on_file_as_an_adult: number;
    notes: string[];
  };

  it("lists the classes with no teacher and adults who could teach them: selected, free and taught before first", async () => {
    const { ctx } = asPrincipal();
    const r = await runCommand(ctx, "learning.classes_needing_teachers", {});
    const data = dataOf<Result>(r);
    const t1 = data.terms.find((t) => t.term === "2026-27")!;
    expect(t1).toMatchObject({ classes: 4, with_a_teacher: 2 });
    expect(t1.without_a_teacher.map((c) => c.class)).toEqual(["Jainism 2 · Room B", "Gujarati 1 · Room C"]);
    const c2 = t1.without_a_teacher[0];
    expect(c2).toMatchObject({ class_id: ID.c2, level: "Jainism 2", when: "Sunday 10 AM to 11:30 AM", room: "B", capacity: 15, has_an_assistant_or_substitute: false });
    expect(c2.suggestions.map((s) => s.name)).toEqual(["Dev Kapoor", "Bina Shah"]);
    expect(c2.suggestions[0]).toMatchObject({
      person_id: ID.dev,
      member_number: "1103",
      why: ['Selected for the teacher position "Jainism 2 teacher"'],
      free_at_that_time: true,
      clash: null,
      background_check: "none on file",
    });
    expect(c2.suggestions[1]).toMatchObject({
      why: ["Taught Jainism 2 in 2025-26"],
      free_at_that_time: false,
      clash: "Already teaches Adult class, Sunday 10 AM to 11:30 AM",
      background_check: expect.stringMatching(/^clear until .*2027$/),
    });
    // Nobody has taught Gujarati 1 or applied for it: no guess.
    expect(t1.without_a_teacher[1].suggestions).toEqual([]);
    expect(messageOf(r)).toBe("3 classes have no teacher yet: 2 in 2026-27, 1 in 2027-28.");
  });

  it("suggests someone from an earlier term for next term's class, and says when a background check has expired", async () => {
    const { ctx } = asPrincipal();
    const data = dataOf<Result>(await runCommand(ctx, "learning.classes_needing_teachers", { term_id: ID.t2 }));
    const c4 = data.terms[0].without_a_teacher[0];
    expect(c4.class_id).toBe(ID.c4);
    expect(c4.suggestions).toHaveLength(1);
    expect(c4.suggestions[0]).toMatchObject({ name: "Asha Mehta", why: ["Taught Jainism 1 in 2026-27"], free_at_that_time: true, background_check: expect.stringMatching(/^expired .*2026$/) });
  });

  it("leaves out anyone who is not on file as an adult, counts them, and never names them", async () => {
    const { ctx } = asPrincipal();
    const r = await runCommand(ctx, "learning.classes_needing_teachers", {});
    const data = dataOf<Result>(r);
    // A 16-year-old who assisted last year, a child selected by mistake, and an adult with no age or household on file.
    expect(data.people_left_out_because_their_age_is_not_on_file_as_an_adult).toBe(3);
    const text = JSON.stringify(data);
    for (const gone of ["Tia", "Zoya", "Kanta", ID.tia, ID.zoya, ID.kanta]) expect(text).not.toContain(gone);
  });

  it("says a class with only an assistant still has no teacher", async () => {
    const world = learningWorld();
    world.tables.pathshala_teachers.push({ id: "pt-9", center_id: "center-1", class_id: ID.c3, person_id: ID.asha, role: "assistant" });
    const { ctx } = asPrincipal({ world });
    const c3 = dataOf<Result>(await runCommand(ctx, "learning.classes_needing_teachers", { term_id: ID.t1 })).terms[0].without_a_teacher.find((c) => c.class_id === ID.c3)!;
    expect(c3.has_an_assistant_or_substitute).toBe(true);
  });

  it("says so, in a visible note, when the role may not see background checks (an empty answer is not 'none on file')", async () => {
    const { ctx } = asPrincipal({ permissions: ["pathshala.view", "pathshala.manage"] });
    const data = dataOf<Result>(await runCommand(ctx, "learning.classes_needing_teachers", { term_id: ID.t1 }));
    expect(data.notes).toEqual(["Background checks are not visible to your role, so they are not shown."]);
    for (const s of data.terms[0].without_a_teacher[0].suggestions) expect(s.background_check).toBeNull();
    const draft = dataOf<{ checks: { status: string; text: string }[] }>(await runCommand(ctx, "learning.draft_teacher_assignment", { class_id: ID.c2, person_id: ID.dev }));
    expect(draft.checks.at(-1)).toEqual({ status: "note", text: "Background checks are not visible to your role, so they are not shown." });
    expect(JSON.stringify(draft)).not.toContain("none on file");
  });

  it("says so, in a visible note, when the background checks cannot be read", async () => {
    const world = learningWorld();
    world.failTables = { background_checks: { code: "42501", message: "permission denied for table background_checks" } };
    const { ctx } = asPrincipal({ world });
    const data = dataOf<Result>(await runCommand(ctx, "learning.classes_needing_teachers", { term_id: ID.t1 }));
    expect(data.notes).toEqual(["Background checks could not be read just now, so they are not shown."]);
    expect(data.terms[0].without_a_teacher[0].suggestions[0].background_check).toBeNull();
  });

  it("says every class has a teacher when they do", async () => {
    const world = learningWorld();
    world.tables.pathshala_teachers.push(
      { id: "pt-8", center_id: "center-1", class_id: ID.c2, person_id: ID.dev, role: "teacher" },
      { id: "pt-9", center_id: "center-1", class_id: ID.c3, person_id: ID.asha, role: "teacher" },
    );
    const { ctx } = asPrincipal({ world });
    expect(messageOf(await runCommand(ctx, "learning.classes_needing_teachers", { term_id: ID.t1 }))).toBe("Every class has a teacher.");
  });
});

// ---------------------------------------------------------------------------
describe("learning.waiting_counts", () => {
  it("gives counts only, in plain words, and ignores any key it does not know", async () => {
    const { ctx, db } = asPrincipal();
    const r = await runCommand(ctx, "learning.waiting_counts", {});
    const data = dataOf<{ waiting: { what: string; count: number; where_a_person_does_it: string }[]; total: number; nothing_waiting: boolean }>(r);
    expect(data.waiting.map((w) => `${w.count} ${w.what}`)).toEqual([
      "3 Registrations waiting for the office to place",
      "2 Seats held while a family pays",
      "1 Registrations held until the household's membership is active",
      "4 Places on a waitlist",
      "1 Registrations waiting for a family to add their details",
      "2 Fee assistance requests to decide",
      "1 Levels with a class but no fee, so families cannot choose them yet",
    ]);
    expect(data).toMatchObject({ total: 14, nothing_waiting: false });
    expect(JSON.stringify(data)).not.toContain("Zoya");
    expect(JSON.stringify(data)).not.toContain("learner_names");
    expect(db.rpcCalls).toEqual([{ fn: "pathshala_task_counts", args: { p_center: "center-1" } }]);
    expect(messageOf(r)).toMatch(/^3 · registrations waiting for the office to place; 2 · seats held while a family pays/);
  });

  it("says nothing is waiting when nothing is", async () => {
    const world = learningWorld();
    world.rpc.pathshala_task_counts = { to_place: 0, waitlisted: 0 };
    const { ctx } = asPrincipal({ world });
    const r = await runCommand(ctx, "learning.waiting_counts", {});
    expect(dataOf(r)).toEqual({ waiting: [], total: 0, nothing_waiting: true });
    expect(messageOf(r)).toBe("Nothing is waiting in Pathshala.");
  });

  it("says \"You don't have access to this area\" instead of showing zeros when the database refuses", async () => {
    const world = learningWorld();
    world.failRpc = { pathshala_task_counts: { code: "42501", message: "You don't have access to this area (the Pathshala tasks need pathshala.view)." } };
    const { ctx } = asPrincipal({ world });
    expect(await runCommand(ctx, "learning.waiting_counts", {})).toMatchObject({ ok: false, error: "You don't have access to this area." });
  });

  it("explains a database failure in plain words and logs the detail", async () => {
    const world = learningWorld();
    world.failRpc = { pathshala_task_counts: { code: "XX000", message: "connection reset" } };
    const { ctx } = asPrincipal({ world });
    const r = await runCommand(ctx, "learning.waiting_counts", {});
    expect(errorOf(r)).toMatch(/^Could not count the Pathshala tasks — /);
    expect(console.error).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("learning.fee_report", () => {
  type Report = Record<string, unknown> & { by_level: Record<string, unknown>[]; other_levels: Record<string, unknown> | null };

  it("gives the totals in dollars, in all and level by level, for the term that is open", async () => {
    const { ctx, db } = asPrincipal();
    const r = await runCommand(ctx, "learning.fee_report", {});
    const data = dataOf<Report>(r);
    expect(data).toMatchObject({
      term_id: ID.t1,
      term: "2026-27",
      fee_lines: 7,
      fees_before_discounts: "$950.00",
      sibling_discounts: "$40.00",
      family_cap_reductions: "$0.00",
      late_fees: "$25.00",
      fee_assistance: "$50.00",
      total_fees: "$885.00",
      collected: "$400.00",
      billed_not_paid_yet: "$305.00",
      not_billed_yet: "$180.00",
      percent_collected: 45,
      lines_the_office_still_has_to_price: 1,
    });
    expect(db.rpcCalls).toEqual([{ fn: "pathshala_fee_totals", args: { p_term: ID.t1 } }]);
    expect(messageOf(r)).toBe("2026-27: $885.00 in fees, $400.00 collected (45%), $305.00 billed and not paid yet, $180.00 not billed yet.");
  });

  it("adds the levels with fewer than three fee lines into 'other levels', so a total never stands for one or two learners", async () => {
    const { ctx } = asPrincipal();
    const data = dataOf<Report>(await runCommand(ctx, "learning.fee_report", { term_id: ID.t1 }));
    expect(data.by_level).toEqual([{ track: "Jainism", level: "Jainism 1", fee_lines: 4, total: "$480.00", collected: "$260.00" }]);
    expect(data.other_levels).toEqual({ levels: 2, fee_lines: 3, total: "$405.00", collected: "$140.00" });
    expect(JSON.stringify(data)).not.toMatch(/Gujarati 1|Jainism 2/);
  });

  it("looks at another term when asked, and says plainly when there is none", async () => {
    const { ctx, db } = asPrincipal();
    await runCommand(ctx, "learning.fee_report", { term_id: ID.t0 });
    expect(db.rpcCalls[0].args).toEqual({ p_term: ID.t0 });
    expect(errorOf(await runCommand(ctx, "learning.fee_report", { term_id: ID.nobody }))).toBe("That term was not found, or you can't see it.");
    const world = learningWorld();
    world.tables.pathshala_terms.find((t) => t.id === ID.t1)!.status = "draft";
    expect(errorOf(await runCommand(asPrincipal({ world }).ctx, "learning.fee_report", {}))).toMatch(/^No Pathshala term is running or open for registration/);
  });

  it("says \"You don't have access to this area\" when the database says the fee totals are not for this role", async () => {
    const world = learningWorld();
    world.failRpc = { pathshala_fee_totals: { code: "42501", message: "You don't have access to this area (the Pathshala fee totals need pathshala.manage or giving.view)." } };
    const { ctx } = asPrincipal({ world });
    expect(await runCommand(ctx, "learning.fee_report", {})).toMatchObject({ ok: false, error: "You don't have access to this area." });
  });

  it("refuses an answer it cannot read rather than showing a wrong total", async () => {
    const world = learningWorld();
    world.rpc.pathshala_fee_totals = { total_cents: 100 };
    const { ctx } = asPrincipal({ world });
    expect(errorOf(await runCommand(ctx, "learning.fee_report", {}))).toMatch(/shape this screen cannot read/);
  });

  it("reads only the terms and the database's own totals, never a family's fee line", async () => {
    const { ctx, db } = asPrincipal();
    const seen = traceDb(db);
    await runCommand(ctx, "learning.fee_report", {});
    expect(seen.tables).toEqual(["pathshala_terms"]);
  });
});

// ---------------------------------------------------------------------------
describe("learning.draft_term_change", () => {
  type Draft = { term: string; summary: string; changes: { what: string; from: string; to: string }[]; problems: string[]; warnings: string[]; who_may_apply_it: string; how_to_apply: string[]; nothing_has_been_saved: boolean };
  const draft = async (input: Record<string, unknown>, opts: Parameters<typeof asPrincipal>[0] = {}) => {
    const { ctx, db } = asPrincipal(opts);
    const seen = traceDb(db);
    const r = await runCommand(ctx, "learning.draft_term_change", input);
    return { r, data: r.ok && !r.needsConfirmation ? (r.data as Draft) : null, seen, db };
  };

  it("shows a fee change from-and-to in dollars, says who may make it, and saves nothing", async () => {
    const { r, data, seen, db } = await draft({ term_id: ID.t1, level_id: ID.lJ2, fee: "150" });
    expect(data).toMatchObject({
      term: "2026-27",
      summary: "Change fee of Jainism 2 from $145.00 to $150.00 in 2026-27.",
      changes: [{ what: "Fee of Jainism 2", from: "$145.00", to: "$150.00" }],
      problems: [],
      nothing_has_been_saved: true,
    });
    expect(data!.warnings).toEqual(["Registration is open, so a change needs a reason and applies to new registrations only: fees already quoted or billed do not change."]);
    expect(data!.who_may_apply_it).toContain("As treasurer");
    expect(data!.how_to_apply[0]).toContain("learning.set_level_fees");
    expect(messageOf(r)).toBe("Change fee of Jainism 2 from $145.00 to $150.00 in 2026-27. Nothing has been saved.");
    expect(seen.writes).toEqual([]);
    expect(db.rpcCalls.map((c) => c.fn)).not.toContain("set_pathshala_level_fees");
  });

  it("shows 'Free' and a first fee for a level that had none", async () => {
    const free = await draft({ term_id: ID.t1, level_id: ID.lJ1, fee: "Free" });
    expect(free.data!.changes).toEqual([{ what: "Fee of Jainism 1", from: "$130.00", to: "Free" }]);
    const first = await draft({ term_id: ID.t1, level_id: ID.lG1, fee: "$90" });
    expect(first.data!.changes).toEqual([{ what: "Fee of Gujarati 1", from: "Not set", to: "$90.00" }]);
  });

  it("changes the rules in dollars and percent, and says they are made on the Fees and rules page", async () => {
    const { data } = await draft({ term_id: ID.t1, sibling_discount_percent: 15, family_cap: "none", late_fee: "30" });
    expect(data!.changes).toEqual([
      { what: "Sibling discount", from: "10%", to: "15%" },
      { what: "Family cap", from: "$300.00", to: "none" },
      { what: "Late fee", from: "$25.00", to: "$30.00" },
    ]);
    expect(data!.how_to_apply).toEqual(["The rules: save them on the term's Fees and rules page. Niva does not change a term's rules."]);
    expect(data!.problems).toEqual([]);
  });

  it("says nothing would change when the term is already set up that way", async () => {
    const { data } = await draft({ term_id: ID.t1, level_id: ID.lJ1, fee: "130.00", sibling_discount_percent: 10 });
    expect(data!.summary).toBe("Nothing would change in 2026-27: it is already set up that way.");
  });

  it("checks the change against the database's rules and says what is wrong in plain words", async () => {
    expect((await draft({ term_id: ID.t1, level_id: ID.lJ2, fee: "abc" })).data!.problems).toEqual(["The fee for Jainism 2 must be Free or an amount like 130 or 130.50."]);
    expect((await draft({ term_id: ID.t1, level_id: ID.lJ2, fee: "0.10" })).data!.problems).toEqual(["A fee is $0 (Free) or at least $0.50 (Jainism 2 was $0.10)."]);
    expect((await draft({ term_id: ID.t1, level_id: ID.lJ2 })).data!.problems).toEqual(["To change a fee, give both the level (level_id) and the new fee."]);
    expect((await draft({ term_id: ID.t1, level_id: ID.nobody, fee: "10" })).data!.problems).toEqual(["That level was not found. Take its id from learning.term_setup."]);
    expect((await draft({ term_id: ID.t1, late_fee: "0.20" })).data!.problems).toEqual(["A late fee is $0 or at least $0.50."]);
    expect((await draft({ term_id: ID.t1, ends_on: "2026-08-01" })).data!.problems).toEqual(["The term must end after it starts."]);
    const bad = await draft({ term_id: ID.t1, family_cap: "lots" });
    expect(bad.data!.problems).toEqual(["The family cap must be an amount like 25 or 25.50."]);
    expect(bad.data!.summary).toBe("This change cannot be made yet: The family cap must be an amount like 25 or 25.50.");
  });

  it("turns away a sibling discount that is not a percent from 0 to 100 before it gets that far", async () => {
    const { r } = await draft({ term_id: ID.t1, sibling_discount_percent: 150 });
    expect(r).toMatchObject({ ok: false, code: "invalid" });
  });

  it("says the dates are changed on the Terms screen", async () => {
    const { data } = await draft({ term_id: ID.t2, starts_on: "2027-09-12" });
    expect(data!.changes).toEqual([{ what: "First day of the term", from: "Sun, Sep 5, 2027", to: "Sun, Sep 12, 2027" }]);
    expect(data!.how_to_apply).toEqual(["The dates: change them on Pathshala › Terms. Niva does not change a term's dates."]);
  });

  it("says pay-when-registering cannot be used yet when the database says so", async () => {
    const world = learningWorld();
    world.rpc.pathshala_pay_now_ready = () => "Pay at registration waits for fee receipts (P13).";
    const { data } = await draft({ term_id: ID.t2, how_families_pay: "pay_now" }, { world });
    expect(data!.changes).toEqual([{ what: "How families pay", from: "Register now, pay later (pledge)", to: "Pay when registering (pay now)" }]);
    expect(data!.problems).toEqual(['"Pay when registering" cannot be used yet: Pay at registration waits for fee receipts (P13).']);
  });

  it("says a closed term cannot change, and that a person without the right cannot make the change", async () => {
    expect((await draft({ term_id: ID.t0, level_id: ID.lJ1, fee: "10" })).data!.problems).toEqual(["The term is closed, so its fees and rules cannot change."]);
    const viewOnly = await draft({ term_id: ID.t2, level_id: ID.lJ1, fee: "140" }, { permissions: ["pathshala.view"] });
    expect(viewOnly.data!.warnings).toContain("Until registration opens the Pathshala principal (pathshala.manage) sets this term's fees and rules.");
    expect(viewOnly.data!.changes).toHaveLength(1);
  });

  it("is turned away for a term that is not there and for a role with no access to the fees", async () => {
    expect(errorOf((await draft({ term_id: ID.nobody, level_id: ID.lJ1, fee: "1" })).r)).toBe("That term was not found, or you can't see it.");
    expect((await draft({ term_id: ID.t1 }, { permissions: ["people.view"] })).r).toMatchObject({ ok: false, code: "no_access" });
  });
});

// ---------------------------------------------------------------------------
describe("learning.draft_teacher_assignment", () => {
  type Proposal = { class: Record<string, unknown>; teacher: Record<string, unknown>; role: string; can_be_assigned: boolean; checks: { status: string; text: string }[]; next_step: string };
  const propose = async (input: Record<string, unknown>, opts: Parameters<typeof asPrincipal>[0] = {}) => {
    const { ctx, db } = asPrincipal(opts);
    const seen = traceDb(db);
    const r = await runCommand(ctx, "learning.draft_teacher_assignment", input);
    return { r, seen, data: r.ok && !r.needsConfirmation ? (r.data as Proposal) : null };
  };

  it("checks a teacher who is free, was selected for the position and has no background check on file", async () => {
    const { r, data, seen } = await propose({ class_id: ID.c2, person_id: ID.dev });
    expect(data).toMatchObject({
      class: { class_id: ID.c2, name: "Jainism 2 · Room B", term: "2026-27", level: "Jainism 2", when: "Sunday 10 AM to 11:30 AM", room: "B" },
      teacher: { person_id: ID.dev, name: "Dev Kapoor", member_number: "1103" },
      role: "teacher",
      can_be_assigned: true,
    });
    expect(data!.checks).toEqual([
      { status: "ok", text: "Free at that time: no other class they teach meets on Sunday 10 AM to 11:30 AM." },
      { status: "ok", text: 'Selected for the teacher position "Jainism 2 teacher".' },
      { status: "check", text: "Background check: none on file. Sort that out before they start teaching." },
    ]);
    expect(data!.next_step).toContain("learning.assign_teacher");
    expect(messageOf(r)).toBe("Dev Kapoor as teacher of Jainism 2 · Room B: free at that time. Nothing has been saved.");
    expect(seen.writes).toEqual([]);
  });

  it("warns of a clash with another class they teach at the same time", async () => {
    const { data } = await propose({ class_id: ID.c2, person_id: ID.bina });
    expect(data!.checks[0]).toEqual({ status: "check", text: "Already teaches Adult class, Sunday 10 AM to 11:30 AM, which is at the same time as Jainism 2 · Room B. They could not be in both." });
    expect(data!.checks[1]).toEqual({ status: "ok", text: "Taught Jainism 2 in 2025-26." });
    expect(data!.can_be_assigned).toBe(true);
  });

  it("says nothing needs doing when they are already on the class, and notes who else teaches it", async () => {
    const { data } = await propose({ class_id: ID.c1, person_id: ID.asha });
    expect(data).toMatchObject({ can_be_assigned: false, next_step: "They are already on this class, so there is nothing to assign." });
    expect(data!.checks[0]).toEqual({ status: "check", text: "Asha Mehta is already on this class as teacher." });
    const second = await propose({ class_id: ID.c1, person_id: ID.dev });
    expect(second.data!.checks.at(-1)).toEqual({ status: "note", text: "This class already has Asha Mehta on it. Adding a teacher puts one more on it." });
  });

  it("will not plan with anyone who is not an adult, and says nothing about who they are", async () => {
    for (const child of [ID.zoya, ID.tia, ID.aarav]) {
      const { r, seen } = await propose({ class_id: ID.c2, person_id: child });
      expect(r).toMatchObject({ ok: false, error: "Niva only plans with adults as teachers, and this person is not on file as an adult. Add them on the class page instead." });
      expect(JSON.stringify(r)).not.toMatch(/Zoya|Tia|Aarav/);
      expect(seen.writes).toEqual([]);
    }
  });

  it("says plainly when the class or the person is not there", async () => {
    expect(errorOf((await propose({ class_id: ID.nobody, person_id: ID.dev })).r)).toBe("That class was not found, or you can't see it.");
    expect(errorOf((await propose({ class_id: ID.c2, person_id: ID.nobody })).r)).toBe("That person was not found, or you can't see them.");
  });

  it("can prepare an assistant or a substitute", async () => {
    const { data } = await propose({ class_id: ID.c2, person_id: ID.dev, role: "assistant" });
    expect(data!.role).toBe("assistant");
    expect(data!.checks.some((c) => c.text.includes("already has"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("the three changes (confirm commands, off for Niva until the community says so)", () => {
  const KEYS = ["learning.assign_teacher", "learning.save_class", "learning.set_level_fees"];
  const INPUT: Record<string, Record<string, unknown>> = {
    "learning.assign_teacher": { class_id: ID.c2, person_id: ID.dev },
    "learning.save_class": { class_id: ID.c2, room: "D" },
    "learning.set_level_fees": { term_id: ID.t1, level_id: ID.lJ2, fee: "150", reason: "The books cost more" },
  };

  it("are switched off for Niva until the community switches each one on", async () => {
    for (const key of KEYS) {
      const { ctx, db } = asPrincipal();
      const seen = traceDb(db);
      expect(await runCommand(ctx, key, INPUT[key]), key).toMatchObject({ ok: false, code: "switched_off" });
      expect(seen.writes, key).toEqual([]);
    }
  });

  it("never run from the call itself: they ask the person to confirm first and write nothing until then", async () => {
    for (const key of KEYS) {
      const { ctx, db } = asPrincipal({ rules: NIVA_MAY_CHANGE_LEARNING });
      const seen = traceDb(db);
      const r = await runCommand(ctx, key, INPUT[key]);
      expect(r, key).toMatchObject({ ok: true, needsConfirmation: true });
      expect(seen.writes, key).toEqual([]);
      expect(db.rpcCalls.map((c) => c.fn), key).not.toContain("set_pathshala_level_fees");
    }
  });

  it("are refused to a role without Pathshala management", async () => {
    for (const key of ["learning.assign_teacher", "learning.save_class"]) {
      const { ctx } = asPrincipal({ rules: NIVA_MAY_CHANGE_LEARNING, permissions: ["pathshala.view"] });
      expect(await runCommand(ctx, key, INPUT[key]), key).toMatchObject({ ok: false, code: "no_access" });
    }
  });

  // ----- learning.assign_teacher -------------------------------------------
  describe("learning.assign_teacher", () => {
    it("shows who, which class, the teacher's household card and the checks, then adds them once the person confirms", async () => {
      const { ctx, db } = asPrincipal({ rules: NIVA_MAY_CHANGE_LEARNING });
      const seen = traceDb(db);
      const r = await runCommand(ctx, "learning.assign_teacher", { class_id: ID.c2, person_id: ID.dev });
      if (!r.ok || !r.needsConfirmation) throw new Error(JSON.stringify(r));
      expect(r.preview.summary).toBe("Add Dev Kapoor (member 1103) as teacher of Jainism 2 · Room B.");
      expect(r.preview.lines).toEqual([
        { label: "Class", value: "Jainism 2 · Room B · 2026-27 · Jainism 2" },
        { label: "Meets", value: "Sunday 10 AM to 11:30 AM" },
        { label: "Role", value: "teacher" },
        { label: "Why them", value: 'Selected for the teacher position "Jainism 2 teacher"' },
        { label: "Free at that time", value: "Yes" },
        { label: "Background check", value: "none on file" },
      ]);
      expect(r.preview.households).toEqual([expect.objectContaining({ household_id: "hh-kapoor", household_number: "H-2003", adults: ["Dev Kapoor"], primary_adult: "Dev Kapoor" })]);
      expect(r.preview.warnings).toEqual(["Background check: none on file.", expect.stringContaining("Niva does not change anyone's access.")]);
      expect(r.confirmText).toBe("Yes, add Dev Kapoor (member 1103) as teacher of Jainism 2 · Room B");
      expect(seen.writes).toEqual([]);

      const done = await confirmProposal(ctx, r.proposalId, r.inputHash);
      expect(done).toMatchObject({ ok: true });
      expect(messageOf(done)).toContain("Teacher added. Niva does not change anyone's access.");
      expect(seen.writes).toEqual([{ op: "insert", table: "pathshala_teachers", payload: { center_id: "center-1", class_id: ID.c2, person_id: ID.dev, role: "teacher" }, filters: [] }]);
      // Never a role or a permission through Niva.
      expect(seen.tables).not.toContain("role_grants");
      expect(seen.tables).not.toContain("center_users");
    });

    it("warns when the teacher clashes, and refuses someone already on the class", async () => {
      const { ctx } = asPrincipal({ rules: NIVA_MAY_CHANGE_LEARNING });
      const clash = await runCommand(ctx, "learning.assign_teacher", { class_id: ID.c2, person_id: ID.bina, role: "assistant" });
      if (!clash.ok || !clash.needsConfirmation) throw new Error(JSON.stringify(clash));
      expect(clash.preview.warnings?.[0]).toBe("Already teaches Adult class, Sunday 10 AM to 11:30 AM, at the same time as this class.");
      expect(errorOf(await runCommand(ctx, "learning.assign_teacher", { class_id: ID.c1, person_id: ID.asha }))).toBe("Asha Mehta is already on Jainism 1 · Room A as teacher.");
    });

    it("will not add anyone who is not an adult, and never says who", async () => {
      for (const child of [ID.zoya, ID.tia, ID.aarav, ID.kanta]) {
        const { ctx, db } = asPrincipal({ rules: NIVA_MAY_CHANGE_LEARNING });
        const seen = traceDb(db);
        const r = await runCommand(ctx, "learning.assign_teacher", { class_id: ID.c2, person_id: child });
        expect(r).toMatchObject({ ok: false, error: "Niva only plans with adults as teachers, and this person is not on file as an adult. Add them on the class page instead." });
        expect(JSON.stringify(r)).not.toMatch(/Zoya|Tia|Aarav|Kanta/);
        expect(seen.writes).toEqual([]);
      }
    });

    it("checks again when confirmed: a class that went away between the card and the button gets no teacher", async () => {
      const world = learningWorld();
      const { ctx, db } = asPrincipal({ rules: NIVA_MAY_CHANGE_LEARNING, world });
      const seen = traceDb(db);
      const r = await runCommand(ctx, "learning.assign_teacher", { class_id: ID.c2, person_id: ID.dev });
      if (!r.ok || !r.needsConfirmation) throw new Error(JSON.stringify(r));
      world.tables.pathshala_classes = world.tables.pathshala_classes.filter((c) => c.id !== ID.c2);
      const done = await confirmProposal(ctx, r.proposalId, r.inputHash);
      expect(done).toMatchObject({ ok: false, error: "That class was not found, or you can't see it." });
      expect(seen.writes).toEqual([]);
    });
  });

  // ----- learning.save_class -------------------------------------------------
  describe("learning.save_class", () => {
    it("adds a class: shows what it will look like, then creates it once the person confirms", async () => {
      const { ctx, db } = asPrincipal({ rules: NIVA_MAY_CHANGE_LEARNING });
      const seen = traceDb(db);
      const r = await runCommand(ctx, "learning.save_class", { term_id: ID.t1, level_id: ID.lG1, name: "Gujarati 2 · Room D", starts_time: "11:00", ends_time: "12:00", capacity: 10 });
      if (!r.ok || !r.needsConfirmation) throw new Error(JSON.stringify(r));
      expect(r.preview.summary).toBe("Add the class Gujarati 2 · Room D to 2026-27.");
      expect(r.preview.lines).toEqual([
        { label: "Class", value: "Gujarati 2 · Room D" },
        { label: "Term", value: "2026-27" },
        { label: "Level", value: "Gujarati 1" },
        { label: "Meets", value: "Sun 11 AM" },
        { label: "Room", value: "not set" },
        { label: "Takes", value: "10" },
        { label: "Waitlist when full", value: "no" },
      ]);
      expect(seen.writes).toEqual([]);
      const done = await confirmProposal(ctx, r.proposalId, r.inputHash);
      expect(messageOf(done)).toBe("Class created.");
      expect(seen.writes).toEqual([
        {
          op: "insert",
          table: "pathshala_classes",
          payload: { term_id: ID.t1, level_id: ID.lG1, name: "Gujarati 2 · Room D", capacity: 10, meets_on: "sunday", starts_time: "11:00", ends_time: "12:00", room: null, class_email: null, waitlist_enabled: false, center_id: "center-1" },
          filters: [],
        },
      ]);
    });

    it("changes only what is given, shown from-and-to", async () => {
      const { ctx, db } = asPrincipal({ rules: NIVA_MAY_CHANGE_LEARNING });
      const seen = traceDb(db);
      const r = await runCommand(ctx, "learning.save_class", { class_id: ID.c2, room: "D", capacity: 20 });
      if (!r.ok || !r.needsConfirmation) throw new Error(JSON.stringify(r));
      expect(r.preview.summary).toBe("Change the class Jainism 2 · Room B.");
      expect(r.preview.lines).toEqual([
        { label: "Room", before: "B", after: "D" },
        { label: "Takes", before: "15", after: "20" },
      ]);
      const done = await confirmProposal(ctx, r.proposalId, r.inputHash);
      expect(messageOf(done)).toBe("Class saved.");
      expect(seen.writes).toEqual([{ op: "update", table: "pathshala_classes", payload: { room: "D", capacity: 20 }, filters: [["id", ID.c2]] }]);
    });

    it("says nothing would change when everything given is already so", async () => {
      const { ctx } = asPrincipal({ rules: NIVA_MAY_CHANGE_LEARNING });
      const r = await runCommand(ctx, "learning.save_class", { class_id: ID.c2, room: "B", capacity: 15 });
      if (!r.ok || !r.needsConfirmation) throw new Error(JSON.stringify(r));
      expect(r.preview).toMatchObject({ summary: "No changes for the class Jainism 2 · Room B.", lines: [] });
      expect(r.preview.warnings).toEqual(["Everything you gave is already how the class is set up, so nothing would change."]);
    });

    it("asks for what a new class needs, and checks the times, the term and the level, in plain words", async () => {
      const { ctx } = asPrincipal({ rules: NIVA_MAY_CHANGE_LEARNING });
      expect(errorOf(await runCommand(ctx, "learning.save_class", { level_id: ID.lG1, name: "X" }))).toBe("Term is required.");
      expect(errorOf(await runCommand(ctx, "learning.save_class", { term_id: ID.t1, name: "X" }))).toBe("Level is required.");
      expect(errorOf(await runCommand(ctx, "learning.save_class", { term_id: ID.t1, level_id: ID.lG1 }))).toBe("Class name is required.");
      expect(errorOf(await runCommand(ctx, "learning.save_class", { term_id: ID.t1, level_id: ID.lG1, name: "X", starts_time: "12:00", ends_time: "11:00" }))).toBe("The class must end after it starts.");
      expect(errorOf(await runCommand(ctx, "learning.save_class", { term_id: ID.t1, level_id: ID.lG1, name: "X", starts_time: "noon" }))).toBe("Start time must be a time.");
      expect(errorOf(await runCommand(ctx, "learning.save_class", { term_id: ID.nobody, level_id: ID.lG1, name: "X" }))).toBe("That term was not found, or you can't see it.");
      expect(errorOf(await runCommand(ctx, "learning.save_class", { term_id: ID.t1, level_id: ID.nobody, name: "X" }))).toBe("That level was not found, or you can't see it.");
      expect(errorOf(await runCommand(ctx, "learning.save_class", { class_id: ID.nobody, room: "Z" }))).toBe("That class was not found, or you can't see it.");
      // An end time that is before the start time already on the class.
      expect(errorOf(await runCommand(ctx, "learning.save_class", { class_id: ID.c2, ends_time: "09:00" }))).toBe("The class must end after it starts.");
    });

    it("says so, and never 'saved', when the change touched nothing", async () => {
      const { ctx, db } = asPrincipal({ rules: NIVA_MAY_CHANGE_LEARNING });
      traceDb(db, { updatesTouchNothing: true });
      const r = await runCommand(ctx, "learning.save_class", { class_id: ID.c2, room: "D" });
      if (!r.ok || !r.needsConfirmation) throw new Error(JSON.stringify(r));
      const done = await confirmProposal(ctx, r.proposalId, r.inputHash);
      expect(done).toMatchObject({ ok: false, error: "Could not save the class — it was not found, or you don't have permission to change it." });
    });

    it("explains a database refusal in plain words", async () => {
      const { ctx, db } = asPrincipal({ rules: NIVA_MAY_CHANGE_LEARNING });
      traceDb(db, { failWrites: { pathshala_classes: { code: "23505", message: "duplicate key value violates unique constraint" } } });
      const r = await runCommand(ctx, "learning.save_class", { term_id: ID.t1, level_id: ID.lG1, name: "Gujarati 2" });
      if (!r.ok || !r.needsConfirmation) throw new Error(JSON.stringify(r));
      const done = await confirmProposal(ctx, r.proposalId, r.inputHash);
      expect(errorOf(done)).toMatch(/^Could not create the class — /);
    });
  });

  // ----- learning.set_level_fees ---------------------------------------------
  describe("learning.set_level_fees (a money rule)", () => {
    it("shows each fee from-and-to in dollars and changes it only after the person confirms, with the reason", async () => {
      const { ctx, db } = asPrincipal({ rules: NIVA_MAY_CHANGE_LEARNING });
      const seen = traceDb(db);
      const r = await runCommand(ctx, "learning.set_level_fees", { term_id: ID.t1, level_id: ID.lJ2, fee: "150", reason: "The books cost more" });
      if (!r.ok || !r.needsConfirmation) throw new Error(JSON.stringify(r));
      expect(r.preview.summary).toBe("Change a fee for 2026-27.");
      expect(r.preview.lines).toEqual([{ label: "Jainism 2 fee", before: "$145.00", after: "$150.00" }]);
      expect(r.preview.warnings).toEqual(["Registration is open, so this needs a reason and applies to new registrations only: fees already quoted or billed do not change."]);
      expect(db.rpcCalls.map((c) => c.fn)).not.toContain("set_pathshala_level_fees");

      const done = await confirmProposal(ctx, r.proposalId, r.inputHash);
      expect(messageOf(done)).toBe("Fee saved for 2026-27: Jainism 2 $150.00. The change applies to new registrations only.");
      expect(db.rpcCalls.find((c) => c.fn === "set_pathshala_level_fees")).toEqual({
        fn: "set_pathshala_level_fees",
        args: { p_term: ID.t1, p_fees: [{ level_id: ID.lJ2, fee_cents: 15000 }], p_reason: "The books cost more" },
      });
      expect(seen.writes).toEqual([]);
    });

    it("asks for a reason before offering the card, once registration is open", async () => {
      const { ctx } = asPrincipal({ rules: NIVA_MAY_CHANGE_LEARNING });
      expect(errorOf(await runCommand(ctx, "learning.set_level_fees", { term_id: ID.t1, level_id: ID.lJ2, fee: "150" }))).toBe(
        "Registration is open: say why the fees change. The reason is kept in the audit log.",
      );
    });

    it("changes several levels at once from a list, and ignores a fee that is the same", async () => {
      const { ctx, db } = asPrincipal({ rules: NIVA_MAY_CHANGE_LEARNING });
      const fees = JSON.stringify([
        { level_id: ID.lJ1, fee: "130" },
        { level_id: ID.lJ2, fee: "Free" },
        { level_id: ID.lG1, fee: "" },
      ]);
      const r = await runCommand(ctx, "learning.set_level_fees", { term_id: ID.t1, fees, reason: "Sponsored" });
      if (!r.ok || !r.needsConfirmation) throw new Error(JSON.stringify(r));
      expect(r.preview.lines).toEqual([{ label: "Jainism 2 fee", before: "$145.00", after: "Free" }]);
      await confirmProposal(ctx, r.proposalId, r.inputHash);
      expect(db.rpcCalls.find((c) => c.fn === "set_pathshala_level_fees")!.args).toEqual({ p_term: ID.t1, p_fees: [{ level_id: ID.lJ2, fee_cents: 0 }], p_reason: "Sponsored" });
    });

    it("says nothing changes when every fee is as it was", async () => {
      const { ctx, db } = asPrincipal({ rules: NIVA_MAY_CHANGE_LEARNING });
      const r = await runCommand(ctx, "learning.set_level_fees", { term_id: ID.t1, level_id: ID.lJ1, fee: "130.00" });
      if (!r.ok || !r.needsConfirmation) throw new Error(JSON.stringify(r));
      expect(r.preview.summary).toBe("No fee changes for 2026-27: every fee is as it was.");
      const done = await confirmProposal(ctx, r.proposalId, r.inputHash);
      expect(messageOf(done)).toBe("Nothing to save: every fee is as it was.");
      expect(db.rpcCalls.map((c) => c.fn)).not.toContain("set_pathshala_level_fees");
    });

    it("checks the fee and the level in plain words", async () => {
      const { ctx } = asPrincipal({ rules: NIVA_MAY_CHANGE_LEARNING });
      const run = (input: Record<string, unknown>) => runCommand(ctx, "learning.set_level_fees", { term_id: ID.t1, reason: "x", ...input });
      expect(errorOf(await run({ level_id: ID.lJ2, fee: "lots" }))).toBe("The fee for Jainism 2 must be Free or an amount like 130 or 130.50.");
      expect(errorOf(await run({ level_id: ID.lJ2, fee: "0.20" }))).toBe("A fee is $0 (Free) or at least $0.50 (Jainism 2 was $0.20).");
      expect(errorOf(await run({ level_id: ID.nobody, fee: "10" }))).toBe("One of those levels was not found. Take the level ids from learning.term_setup.");
      expect(errorOf(await run({}))).toBe("Say which level and its new fee (level_id and fee).");
      expect(errorOf(await run({ level_id: ID.lJ2, fee: "10", fees: "[]" }))).toBe("Give either level_id and fee for one level, or fees for several, not both.");
      expect(errorOf(await run({ fees: "not json" }))).toBe('The fees could not be read. Give them as a list like [{"level_id":"…","fee":"45.00"}].');
      expect(errorOf(await run({ fees: '{"a":1}' }))).toBe('The fees could not be read. Give them as a list like [{"level_id":"…","fee":"45.00"}].');
      expect(errorOf(await run({ fees: '[{"fee":"1"}]' }))).toBe("Each fee needs a level_id.");
      expect(errorOf(await runCommand(ctx, "learning.set_level_fees", { term_id: ID.nobody, level_id: ID.lJ2, fee: "10" }))).toBe("That term was not found, or you can't see it.");
    });

    it("says who may change the fees when the person may not: the closed term, a draft for a role without management, a locked term for a non-treasurer", async () => {
      const closed = await runCommand(asPrincipal({ rules: NIVA_MAY_CHANGE_LEARNING }).ctx, "learning.set_level_fees", { term_id: ID.t0, level_id: ID.lJ1, fee: "10" });
      expect(errorOf(closed)).toBe("The term is closed, so its fees and rules cannot change.");
      const viewer = await runCommand(asPrincipal({ rules: NIVA_MAY_CHANGE_LEARNING, permissions: ["pathshala.view"] }).ctx, "learning.set_level_fees", { term_id: ID.t2, level_id: ID.lJ1, fee: "10" });
      expect(errorOf(viewer)).toBe("Until registration opens the Pathshala principal (pathshala.manage) sets this term's fees and rules.");
      const principalOnly = await runCommand(asPrincipal({ rules: NIVA_MAY_CHANGE_LEARNING, permissions: ["pathshala.view", "pathshala.manage"] }).ctx, "learning.set_level_fees", { term_id: ID.t1, level_id: ID.lJ1, fee: "10", reason: "x" });
      expect(errorOf(principalOnly)).toBe("Registration is open, so fees and rules are locked. Only the treasurer (giving.manage) can change them now, with a reason, for new registrations only.");
    });

    it("shows the database's own refusal next to what was done, and never says it saved", async () => {
      const world = learningWorld();
      world.failRpc = { set_pathshala_level_fees: { code: "22023", message: "Set the fee for Gujarati 1 before opening registration." } };
      const { ctx } = asPrincipal({ rules: NIVA_MAY_CHANGE_LEARNING, world });
      const r = await runCommand(ctx, "learning.set_level_fees", { term_id: ID.t1, level_id: ID.lJ2, fee: "150", reason: "x" });
      if (!r.ok || !r.needsConfirmation) throw new Error(JSON.stringify(r));
      const done = await confirmProposal(ctx, r.proposalId, r.inputHash);
      expect(done.ok).toBe(false);
      expect(errorOf(done)).toMatch(/^Could not save the fees — /);
    });
  });
});
