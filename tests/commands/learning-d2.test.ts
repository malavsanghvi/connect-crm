// Decision D2 for Learning: NOTHING about a learner or anyone under 18 reaches the model. This sweeps EVERY Learning command, and the
// preview of every one that changes something, in a Pathshala full of children (names, birth dates, notes, fees, a teenager who taught
// last year), and proves five things:
//   1. no command READS a learner table, or calls anything but the few set-up functions (the learner data never leaves the database);
//   2. what a command returns is clean on its own, before the command layer's filter looks at it (the filter is the last line, not the first);
//   3. what the model is finally given (runCommand, via Niva) has no child's name, birth date, note or learner key anywhere in it;
//   4. no command takes a child's record as input, and a child's person id is refused without saying who they are;
//   5. the tools the model is shown carry no learner either.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));

import { CATALOG } from "@/lib/commands/catalog";
import { LEARNING_COMMANDS } from "@/lib/commands/catalog/learning";
import { confirmProposal, runCommand } from "@/lib/commands/run";
import type { AnyCommand } from "@/lib/commands/types";

import { CHILD_FACTS, ID, LEARNER_TABLES, NIVA_MAY_CHANGE_LEARNING, asPrincipal, catalogRegistry, learningWorld, traceDb } from "./learning-world";

/** Every call a principal could make, including the ones that should be refused. */
const CALLS: [string, Record<string, unknown>][] = [
  ["learning.term_setup", {}],
  ["learning.term_setup", { term_id: ID.t1 }],
  ["learning.term_setup", { term_id: ID.t2 }],
  ["learning.term_setup", { term_id: ID.t0 }],
  ["learning.registration_checklist", {}],
  ["learning.registration_checklist", { term_id: ID.t1 }],
  ["learning.registration_checklist", { term_id: ID.t2 }],
  ["learning.classes_needing_teachers", {}],
  ["learning.classes_needing_teachers", { term_id: ID.t1 }],
  ["learning.classes_needing_teachers", { term_id: ID.t2 }],
  ["learning.waiting_counts", {}],
  ["learning.fee_report", {}],
  ["learning.fee_report", { term_id: ID.t0 }],
  ["learning.draft_term_change", { term_id: ID.t1, level_id: ID.lJ2, fee: "150" }],
  ["learning.draft_term_change", { term_id: ID.t1, sibling_discount_percent: 15, family_cap: "none", late_fee: "30" }],
  ["learning.draft_term_change", { term_id: ID.t2, starts_on: "2027-09-12", how_families_pay: "pay_now" }],
  ["learning.draft_teacher_assignment", { class_id: ID.c2, person_id: ID.dev }],
  ["learning.draft_teacher_assignment", { class_id: ID.c2, person_id: ID.bina }],
  ["learning.draft_teacher_assignment", { class_id: ID.c1, person_id: ID.asha }],
  ["learning.assign_teacher", { class_id: ID.c2, person_id: ID.dev }],
  ["learning.assign_teacher", { class_id: ID.c2, person_id: ID.bina, role: "assistant" }],
  ["learning.save_class", { term_id: ID.t1, level_id: ID.lG1, name: "Gujarati 2 · Room D", capacity: 10 }],
  ["learning.save_class", { class_id: ID.c2, room: "D", capacity: 20 }],
  ["learning.set_level_fees", { term_id: ID.t1, level_id: ID.lJ2, fee: "150", reason: "The books cost more" }],
  // Asked to look at, or to use, a child: refused, and the refusal says nothing about who.
  ...[ID.zoya, ID.tia, ID.aarav, ID.kanta].flatMap((child): [string, Record<string, unknown>][] => [
    ["learning.draft_teacher_assignment", { class_id: ID.c2, person_id: child }],
    ["learning.assign_teacher", { class_id: ID.c2, person_id: child }],
  ]),
];

/**
 * A child's name typed into free text by a person or a model. A command echoes what it was given (in a card to confirm), and cannot know
 * the words are a child's name: the command layer's filter does, with the community's list of children. So these are swept at that layer only.
 */
const TYPED: [string, Record<string, unknown>][] = [
  ["learning.save_class", { term_id: ID.t1, level_id: ID.lG1, name: "Zoya Shah and Aarav Patel's class" }],
  ["learning.save_class", { class_id: ID.c2, name: "Tia Mehta's room", room: "Zoya Shah" }],
  ["learning.set_level_fees", { term_id: ID.t1, level_id: ID.lJ1, fee: "Free", reason: "Zoya Shah's family asked" }],
];

const LEARNER_KEYS = [
  "date_of_birth", "dob", "birth_date", "birthday", "learner", "learners", "student", "students", "enrollment", "enrollments", "registration",
  "registrations", "attendance", "homework", "progress", "progress_notes", "roster", "children", "child", "kids", "minors", "photo", "photos",
  "voice_note", "dietary", "dietary_notes", "allergies", "health_notes", "learner_names",
];

const ALLOWED_TABLES = new Set([
  "pathshala_terms", "pathshala_levels", "pathshala_level_fees", "pathshala_tracks", "pathshala_classes", "pathshala_teachers", "teacher_positions",
  "teacher_applications", "people", "household_members", "households", "background_checks", "funds",
]);
const ALLOWED_RPC = new Set(["pathshala_task_counts", "pathshala_fee_totals", "pathshala_pay_now_ready", "household_card", "set_pathshala_level_fees"]);

function keysIn(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysIn(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k.toLowerCase());
      keysIn(v, out);
    }
  }
  return out;
}

/** Everything wrong with a piece of model-facing output; empty means clean. */
function leaks(value: unknown): string[] {
  const text = JSON.stringify(value) ?? "";
  const found: string[] = [];
  for (const n of CHILD_FACTS.names) if (text.includes(n)) found.push(`the name ${n}`);
  for (const n of CHILD_FACTS.firstNames) if (new RegExp(`\\b${n}\\b`).test(text)) found.push(`the first name ${n}`);
  for (const d of CHILD_FACTS.birthDates) if (text.includes(d)) found.push(`the birth date ${d}`);
  for (const n of CHILD_FACTS.notes) if (text.toLowerCase().includes(n.toLowerCase())) found.push(`the note "${n}"`);
  for (const id of [ID.zoya, ID.tia, ID.aarav]) if (text.includes(id)) found.push(`the id of a child ${id}`);
  const keys = keysIn(value);
  for (const k of LEARNER_KEYS) if (keys.has(k)) found.push(`the key ${k}`);
  return found;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("D2: the Learning commands never read a learner", () => {
  it("ask the database only for set-up data, never for a learner table, and call only the set-up functions", async () => {
    const world = learningWorld();
    const { ctx, db } = asPrincipal({ world, rules: NIVA_MAY_CHANGE_LEARNING });
    const seen = traceDb(db);
    for (const [key, input] of CALLS) {
      const r = await runCommand(ctx, key, input);
      if (r.ok && r.needsConfirmation) await confirmProposal(ctx, r.proposalId, r.inputHash);
    }
    expect(seen.tables.length).toBeGreaterThan(10);
    for (const t of new Set(seen.tables)) {
      expect(LEARNER_TABLES, `${t} is a learner table`).not.toContain(t);
      expect(ALLOWED_TABLES, `${t} is not on the list of set-up tables`).toContain(t);
    }
    for (const c of db.rpcCalls) expect(ALLOWED_RPC, `${c.fn} is not on the list of set-up functions`).toContain(c.fn);
    // The only things written: a teacher on a class, a class, and the fees: all set-up data.
    expect(new Set(seen.writes.map((w) => w.table))).toEqual(new Set(["pathshala_teachers", "pathshala_classes"]));
    expect(db.rpcCalls.filter((c) => c.fn.startsWith("set_")).map((c) => c.fn)).toEqual(["set_pathshala_level_fees"]);
  });
});

describe("D2: what each command returns is clean by itself, before any filter", () => {
  // The command layer's filter is the last line of defence. Here it is bypassed: `execute` and `preview` are called directly,
  // and the community's list of children is empty, so a name could only be absent because the command never had it.
  it("holds for every read, draft and preview", async () => {
    for (const cmd of LEARNING_COMMANDS as readonly AnyCommand[]) {
      for (const [key, input] of CALLS.filter(([k]) => k === cmd.key)) {
        const { ctx } = asPrincipal({ rules: NIVA_MAY_CHANGE_LEARNING, minors: [] });
        const parsed = cmd.input.parse(input);
        if (!parsed.ok) continue;
        let out: unknown;
        try {
          out = cmd.level === "confirm" ? await cmd.preview!(ctx, parsed.value) : await cmd.execute!(ctx, parsed.value);
        } catch (error) {
          // A refusal is a sentence; it must not carry anything either.
          out = { error: error instanceof Error ? error.message : String(error) };
        }
        expect(leaks(out), `${key} ${JSON.stringify(input)}`).toEqual([]);
      }
    }
  });

  it("holds for what a confirmed change says it did", async () => {
    const { ctx } = asPrincipal({ rules: NIVA_MAY_CHANGE_LEARNING, minors: [] });
    for (const [key, input] of CALLS.filter(([k]) => ["learning.assign_teacher", "learning.save_class", "learning.set_level_fees"].includes(k))) {
      const cmd = LEARNING_COMMANDS.find((c) => c.key === key)!;
      const parsed = cmd.input.parse(input);
      if (!parsed.ok) continue;
      traceDb(ctx.session.db);
      const r = await cmd.execute!(ctx, parsed.value).catch((e: Error) => ({ ok: false as const, error: e.message }));
      expect(leaks(r), `${key}`).toEqual([]);
    }
  });
});

describe("D2: what the model is finally given has no child in it", () => {
  it("holds for every call, through the door Niva uses, and for what comes back when the person confirms", async () => {
    for (const [key, input] of [...CALLS, ...TYPED]) {
      const { ctx, db } = asPrincipal({ rules: NIVA_MAY_CHANGE_LEARNING });
      traceDb(db);
      const r = await runCommand(ctx, key, input);
      expect(leaks(r), `${key} ${JSON.stringify(input)}`).toEqual([]);
      if (r.ok && r.needsConfirmation) {
        const done = await confirmProposal(ctx, r.proposalId, r.inputHash);
        expect(leaks(done), `${key} confirmed`).toEqual([]);
      }
    }
  });

  it("holds when the world has more children and the community's list of minors is long", async () => {
    const world = learningWorld();
    const extra = Array.from({ length: 30 }, (_, i) => ({ id: `f2000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`, center_id: "center-1", first_name: `Kid${i}`, last_name: "Learner", preferred_name: null, date_of_birth: "2017-03-03", member_number: null, merged_into_id: null, is_deceased: false }));
    world.tables.people.push(...extra);
    world.tables.pathshala_teachers.push({ id: "pt-x", center_id: "center-1", class_id: ID.c0, person_id: extra[0].id, role: "assistant" });
    const { ctx } = asPrincipal({ world, minors: [...CHILD_FACTS.names, ...extra.map((p) => `${p.first_name} ${p.last_name}`)] });
    const r = await runCommand(ctx, "learning.classes_needing_teachers", {});
    expect(JSON.stringify(r)).not.toMatch(/Kid\d|Learner/);
    expect(leaks(r)).toEqual([]);
  });

  it("withholds a whole answer, rather than send it, if a child's name is still in it", async () => {
    // A class named after a child by a person: the name is replaced; the command layer then checks again.
    const world = learningWorld();
    world.tables.pathshala_classes.find((c) => c.id === ID.c2)!.name = "Zoya Shah's Jainism class";
    const { ctx } = asPrincipal({ world });
    const r = await runCommand(ctx, "learning.classes_needing_teachers", { term_id: ID.t1 });
    expect(JSON.stringify(r)).not.toContain("Zoya Shah");
    expect(JSON.stringify(r)).toContain("[a child: not shown]");
  });

  it("is withheld, not sent, when the community's children cannot be checked", async () => {
    const { ctx } = asPrincipal();
    ctx.minors = { namesOfMinors: async () => { throw new Error("people table unavailable"); } };
    const r = await runCommand(ctx, "learning.classes_needing_teachers", {});
    expect(r).toMatchObject({ ok: false, code: "unsafe_result" });
  });
});

describe("D2: no command takes a child's record as input, and a child's id is refused without a name", () => {
  it("has no field for a learner, a student, an enrollment, a birth date, a child or a registration", () => {
    for (const c of LEARNING_COMMANDS) {
      for (const field of Object.keys(c.input.shape)) {
        expect(field, `${c.key}.${field}`).not.toMatch(/learner|student|pupil|child|kid|minor|enroll|regist|birth|dob|attend|homework|progress|photo|voice|diet|allerg|health/i);
      }
      expect(c.input.json().properties, c.key).toBeDefined();
    }
  });

  it("takes people only as teachers (adults), and says so", () => {
    const personFields = LEARNING_COMMANDS.flatMap((c) => Object.keys(c.input.shape).filter((f) => /person/.test(f)).map((f) => `${c.key}.${f}`));
    expect(personFields.sort()).toEqual(["learning.assign_teacher.person_id", "learning.draft_teacher_assignment.person_id"]);
    for (const key of ["learning.assign_teacher", "learning.draft_teacher_assignment"]) {
      const c = LEARNING_COMMANDS.find((x) => x.key === key)!;
      expect(c.description).toMatch(/adult/i);
    }
  });

  it("refuses a child's person id the same way whoever the child is, and does not echo it back", async () => {
    const answers = new Set<string>();
    for (const child of [ID.zoya, ID.tia, ID.aarav, ID.kanta]) {
      for (const key of ["learning.draft_teacher_assignment", "learning.assign_teacher"]) {
        const { ctx } = asPrincipal({ rules: NIVA_MAY_CHANGE_LEARNING });
        const r = await runCommand(ctx, key, { class_id: ID.c2, person_id: child });
        expect(r.ok).toBe(false);
        if (!r.ok) answers.add(r.error);
        expect(JSON.stringify(r)).not.toContain(child);
      }
    }
    // The same sentence for every one of them: it does not even tell a child from an adult with no age on file.
    expect(answers.size).toBe(1);
  });
});

describe("D2: the sweep itself is not blind", () => {
  it("would notice a learner table being read, a child's name, a birth date, a note and a learner key", async () => {
    const { db } = asPrincipal();
    const seen = traceDb(db);
    await db.from("pathshala_enrollments").select("*");
    expect(seen.tables.some((t) => LEARNER_TABLES.includes(t))).toBe(true);
    expect(leaks("Zoya Shah was there")).toEqual(expect.arrayContaining(["the name Zoya Shah", "the first name Zoya"]));
    expect(leaks({ born: "2018-05-05" })).toEqual(["the birth date 2018-05-05"]);
    expect(leaks({ note: "Peanut allergy" })).toEqual(['the note "peanut allergy"']);
    expect(leaks({ rows: [{ students: [] }] })).toEqual(["the key students"]);
    expect(leaks({ person: ID.zoya })).toEqual([`the id of a child ${ID.zoya}`]);
    expect(leaks({ fine: "Asha Mehta teaches Jainism 1" })).toEqual([]);
  });
});

describe("D2: the tools the model is shown", () => {
  it("never include a command meant for the screen only, and carry no learner", () => {
    const { session } = asPrincipal({ rules: NIVA_MAY_CHANGE_LEARNING });
    const tools = catalogRegistry().modelTools(session);
    const names = new Set(tools.map((t) => t.name));
    for (const c of CATALOG.filter((x) => x.screenOnly)) expect(names.has(c.key.replace(".", "_")), c.key).toBe(false);
    for (const c of LEARNING_COMMANDS) expect(names.has(c.key.replace(".", "_")), c.key).toBe(true);
    const learning = tools.filter((t) => t.name.startsWith("learning_"));
    expect(learning).toHaveLength(10);
    for (const t of learning) {
      expect(leaks(t), t.name).toEqual([]);
      expect(Object.keys(t.input_schema.properties).join(" "), t.name).not.toMatch(/learner|student|child|birth|enroll|attend/i);
    }
  });
});
