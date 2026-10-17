import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { CARE_COMMANDS } from "@/lib/commands/catalog/care";
import { commandAvailability } from "@/lib/commands/enabled";
import { CommandRegistry } from "@/lib/commands/registry";
import { confirmProposal, runCommand } from "@/lib/commands/run";
import { describe as describeText } from "@/lib/commands/text";
import type { CommandRunResult, CommandVia } from "@/lib/commands/types";

import { CHILDREN, fakeDb, fakeSession, testContext, type FakeDbOptions } from "./helpers";

// DonorDelight's Niva commands (slice 8): care.my_week, care.household_brief, care.draft_note, care.log_touch, care.draft_care_plan. They need iWeaver AND
// DonorDelight AND the organization's own tick; they run with the asking person's own rights; they hand a model no amount, no free-text note, no reason a
// household is not to be asked, nobody under 18 and at most ten households; they only draft (a person sends); they are Niva's chat only.

const H1 = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c9001";
const H2 = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c9002";
const RUN = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c9101";
const STEP = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c9102";

const head = (id: string, name: string) => ({
  id, name, number: `GC-${id.slice(-4)}`, org_household_id: "2041", city: "Naperville", zone: "North", primary_member: "Priya Shah",
  adults: [{ person_id: "p1", name: "Priya Shah", is_primary: true }, { person_id: "p2", name: "Rahul Shah", is_primary: false }], merged: false,
});

type Answers = { enabled: boolean; ai: boolean; weekTasks: number; profile: Record<string, unknown> | null };
function world(a: Partial<Answers> = {}): FakeDbOptions {
  const x: Answers = { enabled: true, ai: true, weekTasks: 3, profile: { thanks: "call", recognition: "public", channel: "phone", language: "gu", contact_name: "Priya Shah", do_not_ask: false }, ...a };
  const tasks = Array.from({ length: x.weekTasks }, (_, i) => ({
    kind: "step", run_id: RUN, step_id: `${STEP.slice(0, -1)}${i}`, household: head(H1, "Shah family"), contact: "Priya", due_on: i === 0 ? "2026-10-10" : "2026-10-12", overdue: i === 0, title: `Welcome task ${i + 1}`, why: "First contact.",
    touch_kind: "welcome", channel: "phone", draft: "Hello {{name}}, it is {{me}} from {{org}}.", personal: false,
  }));
  return {
    tables: { org_profiles: [{ center_id: "center-1", mission: "To welcome every neighbour. A gift of $5000 from Zoya Shah's family built the hall." }] },
    rpc: {
      care_niva_get: { enabled: x.enabled, ai: x.ai, can_manage: true, label: "Member care" },
      care_week: { state: "ok", today: "2026-10-12", total: x.weekTasks, overdue: 1, tasks, needs_owner: 2, me: "Ravi", org: "Grace Church", label: "Member care", playbooks: 10 },
      care_household_card: (args: Record<string, unknown>) => ({
        household: head(String(args.p_household), "Shah family"), label: "Member care", access: { level: "view", manage: false, amounts: true, people: true },
        owners: { owner: { user_id: "u1", name: "Sam K", holds: true }, backup: null, needs_owner: false },
        profile: x.profile && { recognition: null, channel: null, language: null, contact_person_id: null, rest_until: null, resting: false, ...x.profile },
        languages: ["en", "gu"], today: "2026-10-12",
        people: [{ person_id: "p1", name: "Priya Shah", is_primary: true, best_call_time: "after 6pm", interests: ["gardening"], expertise: ["tax law"], anniversary: "2010-05-05", agreed: {} }],
        special_days: [{ kind: "birthday", label: "Priya's birthday", date: "2026-11-03", person_name: "Priya" }],
        notes: [{ id: "n1", body: "Zoya had surgery in March; do not mention it.", person_name: null, by: "Sam", mine: false, created_at: "2026-03-01T00:00:00Z" }],
        notes_total: 1, last_touch: null, touches_12m: 2, asks_12m: 0,
      }),
      care_household_touches: {
        rows: [
          { source: "manual", id: "t1", key: "manual:t1", at: "2026-09-20T15:00:00Z", kind: "check_in", channel: "phone", outcome: "done", is_ask: false, note: "Zoya Shah's school play went well", by: "Sam", amount_cents: null },
          { source: "receipt", id: "t2", key: "receipt:t2", at: "2026-09-01T15:00:00Z", kind: null, channel: "email", outcome: null, is_ask: false, note: null, by: null, amount_cents: 250000, label: "Receipt" },
        ],
        more: false, amounts: true,
      },
      care_health_facts: { today: "2026-10-12", history_months: 30, giving: true, rows: [{ household_id: H1, gifts_12: 1, gifts_prev_12: 3, last_gift_on: "2026-08-01", part_12: 0, touches_12: 2, asks_12: 0, no_ask_12: 2, last_touch_at: "2026-09-20T15:00:00Z", unthanked: 0 }] },
      care_household_thanks: { state: "ok", amounts: true, window_days: 2, open: [{ id: "s1", gift_on: "2026-10-10", due_on: "2026-10-12", overdue: false, needs_personal: false, amount_cents: 250000 }] },
      care_approach_household: (args: Record<string, unknown>) =>
        String(args.p_household) === H2
          ? { state: "excluded", holds: [{ code: "wealth" }], score: 0, signals: [] }
          : { state: "held", holds: [{ code: "balance", have: 1, need: 3 }], score: 40, signals: [], range: { low: 13500, high: 20000, n: 4 } },
      care_gestures_list: { gestures: [{ id: "g1", key: "thank_you_call", name: "A thank-you call", description: "A call.", cost: "free", effort: "quick", who: "anyone", suits_thanks: [], suits_recognition: [], needs: [], suggest: true, kind: "thank_you", channel: "phone", draft: "Hello {{name}}, thank you from {{org}}. {{me}}", enabled: true }] },
      care_playbooks_list: { playbooks: [{ id: "p1", key: "first_gift", name: "Thank a first gift", trigger_key: "first_gift", window_days: 60, cooldown_days: 365, enabled: true, steps: [{ id: "s1", position: 1, after_days: 0, title: "Thank them", why: "x", kind: "thank_you", channel: "phone", draft: "Dear {{name}}, thank you. {{me}}" }] }] },
      care_plan_context: { year: 2027, audience: "faith", mission: "To welcome every neighbour.", fiscal_year_start_month: 7, groups: { steady: 12, cooling: 4 }, calendar: [{ title: "Harvest supper", on: "2027-10-10" }], quiet_periods: [{ name: "A season of rest", starts_on: "2027-12-20", ends_on: "2028-01-05", yearly: true }], playbooks: ["Thank a first gift"], gestures: 13, label: "Member care" },
      care_plan_get: { year: 2027, exists: false, status: "none", summary: null, items: [], years: [], can_manage: true, label: "Member care", today: "2026-10-12" },
      log_care_touch: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c9201",
    },
  };
}

function setup(a: Partial<Answers> = {}, over: { permissions?: string[]; modulesOff?: string[]; via?: CommandVia; isPlatformAdmin?: boolean; rules?: unknown } = {}) {
  const db = fakeDb(world(a));
  const session = fakeSession({
    db, permissions: over.permissions ?? ["care.view", "care.manage"], modulesOff: over.modulesOff ?? [], isPlatformAdmin: over.isPlatformAdmin ?? false,
    person: { id: "person-1", name: "Ravi Rao", memberNumber: "1" },
    center: { ...fakeSession().center, name: "Grace Church", short_name: "Grace Church", rules: over.rules ?? {} },
  });
  const registry = new CommandRegistry();
  for (const c of CARE_COMMANDS) registry.register(c);
  const ctx = testContext({ session, registry, via: over.via ?? "assistant", minorNames: CHILDREN.full });
  return { ctx, db, session, registry };
}
const dataOf = <T,>(r: CommandRunResult): T => {
  if (!r.ok || r.needsConfirmation) throw new Error(`expected data, got ${JSON.stringify(r)}`);
  return r.data as T;
};
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("what they are", () => {
  it("five commands: two reads, two drafts and one confirm, all for Niva's chat only, all needing care and iWeaver", () => {
    expect(CARE_COMMANDS.map((c) => `${c.key}:${c.level}`)).toEqual(["care.my_week:read", "care.household_brief:read", "care.draft_note:draft", "care.log_touch:confirm", "care.draft_care_plan:draft"]);
    for (const c of CARE_COMMANDS) {
      expect(c.assistantOnly, c.key).toBe(true);
      expect(c.module, c.key).toBe("care");
      expect(c.alsoModules, c.key).toEqual(["ai"]);
      expect(c.screenOnly, c.key).toBeUndefined();
      expect(c.requiresOwnerSwitch, c.key).toBeUndefined();
      expect(describeText(c.description).length, c.key).toBeGreaterThan(200);
      expect(describeText(c.description), c.key).not.toMatch(/\bbid\b/i);
      expect(c.title.length, c.key).toBeGreaterThan(8);
    }
    expect(CARE_COMMANDS.find((c) => c.key === "care.draft_care_plan")?.permission).toBe("careManage");
    expect(CARE_COMMANDS.filter((c) => c.level === "confirm").map((c) => c.key)).toEqual(["care.log_touch"]);
  });
  it("each says it never asks for money, and the model is told the household is found by its id", () => {
    for (const c of CARE_COMMANDS) {
      const text = describeText(c.description);
      if (c.key !== "care.my_week") expect(text, c.key).toMatch(/\bid\b|plan/i);
      expect(text, c.key).toMatch(/nothing|no amount|never|draft|read only|confirm/i);
    }
    const note = describeText(CARE_COMMANDS[2].description);
    expect(note).toContain("NEVER asks for money");
    expect(note).toContain("a person sends it");
  });
});

describe("who may use them, and through which door", () => {
  it("with care, iWeaver and a care key, Niva is offered all five (the write only once ticked in Platform, like every confirm command)", () => {
    const { registry, session } = setup();
    expect(registry.modelTools(session).map((t) => t.name)).toEqual(["care_my_week", "care_household_brief", "care_draft_note", "care_draft_care_plan"]);
    const on = setup({}, { rules: { assistant: { tools: { "care.log_touch": true } } } });
    expect(on.registry.modelTools(on.session).map((t) => t.name)).toContain("care_log_touch");
  });
  it("never through a screen or the palette", () => {
    const { registry, session } = setup();
    expect(registry.list(session, "screen")).toEqual([]);
    expect(registry.list(session, "palette")).toEqual([]);
    const a = commandAvailability(CARE_COMMANDS[0], session, "palette");
    expect(a.ok).toBe(false);
    expect(!a.ok && a.error).toContain("part of Niva");
  });
  it("not without iWeaver, whatever the person's keys", () => {
    const { registry, session } = setup({}, { modulesOff: ["ai"] });
    expect(registry.modelTools(session)).toEqual([]);
    const a = commandAvailability(CARE_COMMANDS[0], session, "assistant");
    expect(a).toMatchObject({ ok: false, code: "module_off" });
    expect(!a.ok && a.error).toBe("AI features are part of iWeaver, which is not on for your community.");
  });
  it("not without DonorDelight", () => {
    const { registry, session } = setup({}, { modulesOff: ["care"] });
    expect(registry.modelTools(session)).toEqual([]);
  });
  it("not for a platform admin without a care key, nor for someone with only people.view", () => {
    for (const over of [{ permissions: [], isPlatformAdmin: true }, { permissions: ["people.view"] }, { permissions: ["giving.view", "giving.manage"] }]) {
      const { registry, session } = setup({}, over);
      expect(registry.modelTools(session), JSON.stringify(over)).toEqual([]);
    }
  });
  it("a relationship owner (care.own) can use the reads and the drafts about their own households, but not draft the plan", () => {
    const { registry, session } = setup({}, { permissions: ["care.own"] });
    expect(registry.modelTools(session).map((t) => t.name)).toEqual(["care_my_week", "care_household_brief", "care_draft_note"]);
  });
});

describe("the organization's own tick", () => {
  it("until the organization ticks it, every command says so in words and reads nothing", async () => {
    for (const [key, input] of [["care.my_week", {}], ["care.household_brief", { household_id: H1 }], ["care.draft_note", { household_id: H1, purpose: "thank_you" }], ["care.draft_care_plan", {}]] as const) {
      const { ctx, db } = setup({ enabled: false });
      const r = await runCommand(ctx, key, input);
      expect(r.ok, key).toBe(false);
      expect(!r.ok && r.error, key).toContain("Niva is not set up to help with relationship care for Grace Church yet");
      expect(db.rpcCalls.map((c) => c.fn), key).toEqual(["care_niva_get"]);
    }
  });
  it("the database's own answer that iWeaver is off is said in the one sentence", async () => {
    const { ctx } = setup({ ai: false });
    const r = await runCommand(ctx, "care.my_week", {});
    expect(!r.ok && r.error).toBe("AI features are part of iWeaver, which is not on for your community.");
  });
});

describe("care.my_week", () => {
  it("hands over the person's own tasks with why, when and a draft with the names filled; no amount, never more than ten households", async () => {
    const { ctx } = setup({ weekTasks: 12 });
    const d = dataOf<{ summary: string; total: number; tasks: { what: string; draft: string | null; household: { household_id: string; adults: string[] }; first_name_to_use: string | null; due: string }[]; reminders: string[] }>(await runCommand(ctx, "care.my_week", {}));
    expect(d.summary).toBe("12 tasks this week, 1 overdue");
    expect(d.total).toBe(12);
    expect(d.tasks.length).toBeLessThanOrEqual(10);
    expect(d.tasks[0]).toMatchObject({ what: "Welcome task 1", first_name_to_use: "Priya", draft: "Hello Priya, it is Ravi from Grace Church." });
    expect(d.tasks[0].household.adults).toEqual(["Priya Shah", "Rahul Shah"]);
    expect(d.tasks[0].due).toBe("Overdue by 2 days");
    expect(d.tasks[1].due).toBe("Due today");
    expect(JSON.stringify(d).replace(/"open_pledge_cents":null,"open_pledge":null/g, "")).not.toMatch(/amount|cents|\$[0-9]/i);
    expect(d.reminders.join(" ")).toContain("A person sends every message");
  });
  it("a quiet week says so", async () => {
    const { ctx } = setup({ weekTasks: 0 });
    const r = await runCommand(ctx, "care.my_week", {});
    expect(r).toMatchObject({ ok: true, message: "Nothing waits for them this week." });
  });
  it("a refusal from the database reaches the person as the database's words, not as an empty week", async () => {
    const { ctx, db } = setup();
    const failing = fakeDb({ ...world(), failRpc: { care_week: { code: "42501", message: "You don't have access to this area." } } });
    ctx.session = { ...ctx.session, db: failing } as typeof ctx.session;
    void db;
    const r = await runCommand(ctx, "care.my_week", {});
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/Could not|access/i);
  });
});

describe("care.household_brief", () => {
  it("is what to know before a call: the card, the owner, the preferences, the sign with its reasons, the touches; never an amount or the words of a note", async () => {
    const { ctx } = setup();
    const r = await runCommand(ctx, "care.household_brief", { household_id: H1 });
    const d = dataOf<{
      household: { adults: string[] };
      relationship_owner: string | null;
      how_they_like_to_be_treated: Record<string, unknown>;
      what_we_know: { interests: string[]; expertise: string[]; special_days: string[] };
      how_the_relationship_is_going: { sign: string; reasons: string[] } | null;
      thank_yous_waiting: number | null;
      asking: { status: string; reasons: string[] } | null;
      recent_touches: { kind: string; way: string; was_an_ask: boolean }[];
      notes_on_file: number;
      reminders: string[];
    }>(r);
    expect(d.relationship_owner).toBe("Sam K");
    expect(d.how_they_like_to_be_treated).toMatchObject({ thanked_by: "A call", recognition: "Public", preferred_way_to_reach: "Phone", language: "gu", adult_to_reach_first: "Priya Shah", best_call_time: "after 6pm", do_not_ask: false });
    expect(d.what_we_know.interests).toEqual(["gardening"]);
    expect(d.what_we_know.special_days).toEqual(["Priya's birthday: 3 November"]);
    expect(d.how_the_relationship_is_going?.sign).toBe("Cooling");
    expect(d.how_the_relationship_is_going?.reasons[0]).toContain("Gave fewer times (1) than the year before (3)");
    expect(d.thank_yous_waiting).toBe(1);
    expect(d.asking).toEqual({ status: "Not yet", reasons: ["Not yet: 1 of 3 touches with no ask since the last ask. 2 more first"] });
    expect(d.recent_touches.map((t) => t.kind)).toEqual(["Check-in", "Receipt"]);
    expect(d.notes_on_file).toBe(1);
    expect(d.reminders).toContain("Address them as Priya.");
    const text = JSON.stringify(d);
    expect(text).not.toMatch(/surgery|school play|do not mention it/i);
    const clean = text.replace(/"open_pledge_cents":null,"open_pledge":null/g, "");
    expect(clean.match(/amount|cents|\$[0-9]|250000|13500|20000|If you do ask/i)?.[0] ?? null).toBeNull();
    for (const name of [...CHILDREN.full, ...CHILDREN.first]) expect(text, name).not.toContain(name);
  });
  it("a household that asked not to be asked says only that, never why", async () => {
    const { ctx } = setup({ profile: { thanks: "call", do_not_ask: true } });
    const d = dataOf<{ asking: { status: string; reasons: string[] } | null; reminders: string[] }>(await runCommand(ctx, "care.household_brief", { household_id: H2 }));
    expect(d.asking).toEqual({ status: "Do not ask", reasons: [] });
    expect(d.reminders).toContain("They asked not to be asked: nothing that asks.");
    expect(JSON.stringify(d)).not.toContain("wealth");
  });
  it("is found by its id, not by a name", async () => {
    const { ctx } = setup();
    expect(await runCommand(ctx, "care.household_brief", { household_id: "Shah" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await runCommand(ctx, "care.household_brief", {})).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("care.draft_note", () => {
  it("gives the material for one note: who to write to, the way and language, the mission in a line, starting drafts from the library; nothing is sent", async () => {
    const { ctx, db } = setup();
    const d = dataOf<{
      write_to: string | null; sign_off_name: string | null; organization: string; mission: string | null; way_to_send: string; language: string | null;
      starting_drafts: { from: string; text: string }[]; rules_for_this_note: string[]; purpose: string;
    }>(await runCommand(ctx, "care.draft_note", { household_id: H1, purpose: "thank_you" }));
    expect(d).toMatchObject({ write_to: "Priya", sign_off_name: "Ravi", organization: "Grace Church", way_to_send: "Phone", language: "gu", purpose: "Thank-you" });
    expect(d.starting_drafts).toEqual([
      { from: "Gesture: A thank-you call", text: "Hello Priya, thank you from Grace Church. Ravi" },
      { from: "Playbook: Thank a first gift", text: "Dear Priya, thank you. Ravi" },
    ]);
    expect(d.rules_for_this_note.join(" ")).toContain("A person sends this");
    expect(d.rules_for_this_note.join(" ")).toContain("Do not ask for money");
    expect(db.rpcCalls.map((c) => c.fn)).not.toContain("log_care_touch");
    expect(JSON.stringify(d.mission)).not.toContain("Zoya");
  });
  it("the mission is cut to a line, and a mission that holds a child's name or an amount does not reach a model", async () => {
    const { ctx } = setup();
    const r = await runCommand(ctx, "care.draft_note", { household_id: H1, purpose: "greeting" });
    const text = JSON.stringify(r);
    for (const name of [...CHILDREN.full]) expect(text, name).not.toContain(name);
  });
  it("follows what the household asked: no thanks, private, do not ask, a language", async () => {
    const { ctx } = setup({ profile: { thanks: "none", recognition: "anonymous", language: "ta", do_not_ask: true } });
    const d = dataOf<{ rules_for_this_note: string[] }>(await runCommand(ctx, "care.draft_note", { household_id: H1, purpose: "thank_you" }));
    const rules = d.rules_for_this_note.join(" | ");
    expect(rules).toContain("They asked for no thanks");
    expect(rules).toContain("They asked not to be asked");
    expect(rules).toContain("They give in private");
    expect(rules).toContain("(ta)");
  });
  it("a purpose is one of the known kinds of note", async () => {
    const { ctx } = setup();
    expect(await runCommand(ctx, "care.draft_note", { household_id: H1, purpose: "solicit" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await runCommand(ctx, "care.draft_note", { household_id: H1, purpose: "care_moment" })).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("care.log_touch", () => {
  const input = { household_id: H1, kind: "check_in", channel: "phone", note: "Left a message about the supper." };
  it("is a confirm command: it records a proposal with a card, and nothing is saved until the person confirms", async () => {
    const { ctx, db } = setup({}, { rules: { assistant: { tools: { "care.log_touch": true } } } });
    const r = await runCommand(ctx, "care.log_touch", input);
    expect(r).toMatchObject({ ok: true, needsConfirmation: true, confirmText: "Record this touch" });
    if (!r.ok || !r.needsConfirmation) throw new Error("expected a proposal");
    expect(r.preview.summary).toBe("Record check-in by phone on the log of Shah family.");
    expect(r.preview.lines.map((l) => `${l.label}: ${l.value}`)).toEqual(["What: Check-in", "How: Phone", "How it went: Done", "Ask: No ask", "Note: Left a message about the supper."]);
    expect(r.preview.households?.[0]).toMatchObject({ household_number: expect.stringContaining("GC-"), adults: ["Priya Shah", "Rahul Shah"] });
    expect(db.rpcCalls.map((c) => c.fn)).not.toContain("log_care_touch");
    const done = await confirmProposal(ctx, r.proposalId, r.inputHash);
    expect(done).toMatchObject({ ok: true, message: "Recorded on the household's log." });
    const call = db.rpcCalls.find((c) => c.fn === "log_care_touch");
    expect(call?.args).toEqual({ p_household: H1, p_touch: { kind: "check_in", channel: "phone", outcome: "done", is_ask: false, note: "Left a message about the supper." } });
  });
  it("is off for Niva until the platform ticks it, like every confirm command", async () => {
    const { ctx } = setup();
    expect(await runCommand(ctx, "care.log_touch", input)).toMatchObject({ ok: false, code: "switched_off" });
  });
  it("an ask is recorded as an ask only when the person says so, with a warning; a care moment can never be one", async () => {
    const { ctx } = setup({}, { rules: { assistant: { tools: { "care.log_touch": true } } } });
    const ask = await runCommand(ctx, "care.log_touch", { ...input, kind: "other", is_ask: true });
    if (!ask.ok || !ask.needsConfirmation) throw new Error("expected a proposal");
    expect(ask.preview.warnings?.[0]).toContain("This records an ask");
    expect(ask.preview.lines.find((l) => l.label === "Ask")?.value).toBe("Yes, this asked for a gift");
    const bad = await runCommand(ctx, "care.log_touch", { ...input, kind: "care_moment", is_ask: true });
    expect(bad).toMatchObject({ ok: false });
    expect(!bad.ok && bad.error).toContain("A care moment is never an ask");
  });
  it("a refusal because the person may not see the household is the database's, not a success", async () => {
    const { ctx } = setup({}, { rules: { assistant: { tools: { "care.log_touch": true } } } });
    const failing = fakeDb({ ...world(), failRpc: { care_household_card: { code: "42501", message: "You don't have access to this area." } } });
    ctx.session = { ...ctx.session, db: failing } as typeof ctx.session;
    const r = await runCommand(ctx, "care.log_touch", input);
    expect(r.ok).toBe(false);
  });
});

describe("care.draft_care_plan", () => {
  it("gives the mission, the fiscal year, the calendar, the quiet periods, the groups as counts and a first draft; nothing is saved", async () => {
    const { ctx, db } = setup();
    const d = dataOf<{
      year: number; organization_mission: string | null; fiscal_year_starts_in: string; households_in_each_group: { group: string; households: number }[];
      first_draft: { summary: string; moments: { on: string; title: string; for_whom: string; note: string | null }[] }; the_plan_today: { status: string }; how_to_save_it: string;
    }>(await runCommand(ctx, "care.draft_care_plan", { year: 2027 }));
    expect(d.year).toBe(2027);
    expect(d.organization_mission).toBe("To welcome every neighbour.");
    expect(d.fiscal_year_starts_in).toBe("July");
    expect(d.households_in_each_group).toEqual([{ group: "A steady giver", households: 12 }, { group: "A household that is cooling", households: 4 }]);
    expect(d.the_plan_today.status).toBe("No plan yet");
    expect(d.first_draft.summary).toContain("Our mission: To welcome every neighbour.");
    expect(d.first_draft.moments.length).toBeGreaterThan(8);
    expect(d.first_draft.moments.some((m) => m.title.startsWith("Greet households around Harvest supper"))).toBe(true);
    expect(d.how_to_save_it).toContain("approves it");
    expect(db.rpcCalls.map((c) => c.fn)).toEqual(["care_niva_get", "care_plan_context", "care_plan_get"]);
    expect(JSON.stringify(d)).not.toMatch(/amount|cents/i);
  });
  it("needs care.manage, not a relationship owner's key", async () => {
    const { registry, session } = setup({}, { permissions: ["care.view"] });
    expect(registry.modelTools(session).map((t) => t.name)).not.toContain("care_draft_care_plan");
  });
  it("the year defaults to the coming year late in the year", async () => {
    const { ctx } = setup();
    const d = dataOf<{ year: number }>(await runCommand(ctx, "care.draft_care_plan", {}));
    expect(d.year).toBe(2026);
  });
});

describe("the activity stream", () => {
  it("never holds a DonorDelight command run", async () => {
    const { commandEventToActivity } = await import("@/lib/commands/activity");
    for (const c of CARE_COMMANDS) {
      expect(commandEventToActivity({ key: c.key, level: c.level, via: "assistant", outcome: "ok", durationMs: 5, at: "2026-10-12T00:00:00Z", centerId: "c", userId: "u", personId: null, roles: [], requestId: "r", inputKeys: [] }), c.key).toBeNull();
    }
  });
});
