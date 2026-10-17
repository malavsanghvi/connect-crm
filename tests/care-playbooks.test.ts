import { describe, expect, it } from "vitest";

import {
  MAX_STEPS,
  STEP_KINDS,
  TRIGGERS,
  TRIGGER_HELP,
  TRIGGER_LABEL,
  afterLine,
  blankPlaybook,
  blankStep,
  checkPlaybook,
  fillDraft,
  parsePlaybooks,
  playbookInput,
  stepWay,
  toPayload,
  type PlaybookInput,
} from "@/lib/care/playbooks";

// DonorDelight slice 5 (0891): the playbooks in words, and what is typed checked the way the database will.

const ANSWER = {
  audience: "faith",
  starters_missing: 3,
  can_manage: true,
  label: "Member care",
  playbooks: [
    {
      id: "p1", key: "first_gift", name: "Thank a first gift", summary: "Start well.", trigger_key: "first_gift", window_days: 60, cooldown_days: 365, enabled: true, starter_key: "first_gift",
      steps: [
        { id: "s1", position: 1, after_days: 0, title: "Thank them personally", why: "Remembered longer than a receipt.", kind: "thank_you", channel: "phone", draft: "Hello {{name}}, it is {{me}} from {{org}}." },
        { id: "s2", position: 2, after_days: 14, title: "Share the result", why: "Trust.", kind: "update", channel: null, draft: null },
      ],
    },
    { id: "p2", key: "x", name: "Odd", trigger_key: "not_a_trigger", enabled: true, steps: [] },
    { key: "no_id", name: "No id", trigger_key: "steady" },
  ],
};

describe("parsePlaybooks", () => {
  const list = parsePlaybooks(ANSWER);
  it("reads the playbooks and their steps; one with an unknown trigger or no id is dropped, never guessed", () => {
    expect(list.playbooks.map((p) => p.id)).toEqual(["p1"]);
    expect(list.playbooks[0].steps.map((s) => [s.afterDays, s.title, s.kind, s.channel])).toEqual([
      [0, "Thank them personally", "thank_you", "phone"],
      [14, "Share the result", "update", null],
    ]);
    expect(list.startersMissing).toBe(3);
    expect(list.audience).toBe("faith");
    expect(list.canManage).toBe(true);
    expect(list.label).toBe("Member care");
  });
  it("an unknown kind or channel is something else or the household's own way, and nonsense is safe", () => {
    const odd = parsePlaybooks({ playbooks: [{ id: "p", trigger_key: "steady", steps: [{ id: "s", kind: "ask", channel: "carrier pigeon", title: "t", why: "w" }] }] });
    expect(odd.playbooks[0].steps[0]).toMatchObject({ kind: "other", channel: null });
    expect(parsePlaybooks(null)).toEqual({ playbooks: [], startersMissing: 0, audience: "civic", canManage: false, label: "DonorDelight" });
  });
  it("there is no way to ask in a step: every kind a step may take is a plain touch, and a care moment is not one", () => {
    expect(STEP_KINDS).not.toContain("care_moment");
    expect(JSON.stringify(parsePlaybooks(ANSWER))).not.toMatch(/is_ask/);
  });
});

describe("words for every trigger", () => {
  it("each trigger says who it is for and when a household enters it", () => {
    for (const t of TRIGGERS) {
      expect(TRIGGER_LABEL[t].length).toBeGreaterThan(5);
      expect(TRIGGER_HELP[t].endsWith(".")).toBe(true);
    }
    expect(TRIGGER_HELP.pledge_due).toContain("never an ask");
  });
  it("afterLine and stepWay", () => {
    expect(afterLine(0)).toBe("The day they enter");
    expect(afterLine(1)).toBe("1 day later");
    expect(afterLine(7)).toBe("A week later");
    expect(afterLine(45)).toBe("45 days later");
    expect(stepWay({ kind: "update", channel: "email" })).toBe("Update on what their gift did · Email");
    expect(stepWay({ kind: "check_in", channel: null })).toBe("Check-in");
  });
});

describe("fillDraft", () => {
  it("fills the three placeholders", () => {
    expect(fillDraft("Hello {{name}}, it is {{me}} from {{org}}.", { name: "Ama", me: "Ravi", org: "Grace Church" })).toBe("Hello Ama, it is Ravi from Grace Church.");
    expect(fillDraft("{{ name }} / {{ME}}", { name: "Ama", me: "Ravi" })).toBe("Ama / {{ME}}");
  });
  it("a missing name reads 'there'; a missing sender is a visible gap; unknown placeholders are left alone", () => {
    expect(fillDraft("Hello {{name}}, {{me}} at {{org}} {{other}}", {})).toBe("Hello there, [your name] at our organization {{other}}");
    expect(fillDraft(null, { name: "x" })).toBe("");
    expect(fillDraft("", {})).toBe("");
  });
});

describe("checkPlaybook: the same rules as the database, in the same words", () => {
  const good = (): PlaybookInput => ({ ...blankPlaybook(), name: "Visit", steps: [{ ...blankStep(0), title: "Visit", why: "They like company." }] });
  it("a good playbook passes", () => expect(checkPlaybook(good())).toEqual({ ok: true }));
  it("needs a name, a known trigger and sane numbers", () => {
    expect(checkPlaybook({ ...good(), name: "  " })).toEqual({ ok: false, error: "Give the playbook a name of up to 80 characters." });
    expect(checkPlaybook({ ...good(), summary: "x".repeat(301) })).toEqual({ ok: false, error: "The summary is at most 300 characters." });
    expect(checkPlaybook({ ...good(), windowDays: 0 })).toEqual({ ok: false, error: "The window is 1 to 365 days." });
    expect(checkPlaybook({ ...good(), cooldownDays: 10 })).toEqual({ ok: false, error: "Wait 30 to 1,095 days before a household enters the same playbook again." });
  });
  it("needs 1 to 12 steps, each with its day, title and why", () => {
    expect(checkPlaybook({ ...good(), steps: [] }).ok).toBe(false);
    expect(checkPlaybook({ ...good(), steps: Array.from({ length: MAX_STEPS + 1 }, () => ({ ...blankStep(), title: "a", why: "b" })) })).toEqual({ ok: false, error: "A playbook has 1 to 12 steps." });
    expect(checkPlaybook({ ...good(), steps: [{ ...blankStep(400), title: "a", why: "b" }] })).toEqual({ ok: false, error: "Step 1: say how many days after the household enters it (0 to 365)." });
    expect(checkPlaybook({ ...good(), steps: [{ ...blankStep(0), title: "", why: "b" }] })).toEqual({ ok: false, error: "Step 1: give it a title of up to 120 characters." });
    expect(checkPlaybook({ ...good(), steps: [{ ...blankStep(0), title: "a", why: "" }] })).toEqual({ ok: false, error: "Step 1: say why, in up to 300 characters." });
    expect(checkPlaybook({ ...good(), steps: [{ ...blankStep(0), title: "a", why: "b", draft: "x".repeat(1501) }] })).toEqual({ ok: false, error: "Step 1: the draft is at most 1,500 characters." });
  });
});

describe("toPayload: what app.save_care_playbook takes", () => {
  it("trims, nulls empty text and carries ids only when there are some; a step has no ask", () => {
    const input = playbookInput(parsePlaybooks(ANSWER).playbooks[0]);
    expect(input.steps[1].draft).toBe("");
    const payload = toPayload({ ...input, name: "  Thank a first gift  ", summary: "" });
    expect(payload).toMatchObject({ id: "p1", name: "Thank a first gift", summary: null, trigger_key: "first_gift", window_days: 60, cooldown_days: 365, enabled: true });
    const steps = payload.steps as Record<string, unknown>[];
    expect(steps[0]).toMatchObject({ id: "s1", after_days: 0, kind: "thank_you", channel: "phone" });
    expect(steps[1]).toMatchObject({ id: "s2", channel: null, draft: null });
    expect(JSON.stringify(payload)).not.toContain("is_ask");
    const fresh = toPayload({ ...blankPlaybook(), name: "N", steps: [{ ...blankStep(3), title: "t", why: "w" }] });
    expect("id" in fresh).toBe(false);
    expect("id" in (fresh.steps as Record<string, unknown>[])[0]).toBe(false);
  });
});
