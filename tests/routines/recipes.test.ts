import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { MODULE_KEYS } from "@/lib/modules";
import { ACCESS } from "@/lib/permissions";
import {
  COUNTERS,
  COUNTER_KEYS,
  RECIPES,
  ROUTINE_ROLES,
  ROUTINE_ROLE_TITLES,
  ROUTINE_WHEN,
  WHEN_LABEL,
  allSteps,
  type RoutineStep,
} from "@/lib/routines/recipes";

const root = process.cwd();

describe("the starting recipes", () => {
  it("cover each role with at least one step, and a name for it", () => {
    expect([...ROUTINE_ROLES]).toEqual(["center_admin", "treasurer", "membership_coordinator", "event_lead", "pathshala_principal"]);
    for (const role of ROUTINE_ROLES) {
      expect(RECIPES[role].length, role).toBeGreaterThan(0);
      expect(ROUTINE_ROLE_TITLES[role], role).toMatch(/\w/);
    }
  });

  it("use real role keys (they are all in the seeded role catalog)", () => {
    const seed = readFileSync(join(root, "supabase/seed.sql"), "utf8");
    for (const role of ROUTINE_ROLES) expect(seed, role).toContain(`('${role}'`);
  });

  it("have unique step keys inside each role", () => {
    for (const role of ROUTINE_ROLES) {
      const keys = RECIPES[role].map((s) => s.key);
      expect(new Set(keys).size, role).toBe(keys.length);
    }
  });

  it("only share a key between roles when the step is exactly the same", () => {
    const first = new Map<string, RoutineStep>();
    for (const role of ROUTINE_ROLES) {
      for (const s of RECIPES[role]) {
        const seen = first.get(s.key);
        if (seen) expect(s, s.key).toEqual(seen);
        else first.set(s.key, s);
      }
    }
    expect(allSteps().length).toBe(first.size);
  });

  it("give every step a title, a one-sentence reason, a place to go and a valid timing", () => {
    for (const s of allSteps()) {
      expect(s.title.trim(), s.key).not.toBe("");
      expect(s.why.trim(), s.key).toMatch(/\.$/);
      expect(s.why.slice(0, -1), `${s.key} why is one sentence`).not.toMatch(/[.!?] /);
      expect(s.href, s.key).toMatch(/^\//);
      expect(ROUTINE_WHEN, s.key).toContain(s.when);
      expect(WHEN_LABEL[s.when], s.key).toBeTruthy();
      if (s.when === "weekly") {
        expect(Number.isInteger(s.weekday), `${s.key} needs a weekday`).toBe(true);
        expect(s.weekday!).toBeGreaterThanOrEqual(0);
        expect(s.weekday!).toBeLessThanOrEqual(6);
      }
      if (s.fromDay !== undefined) expect(s.when, s.key).toBe("month_end");
      if (s.daysBefore !== undefined) expect(s.when, s.key).toBe("before_event");
      // A link can only name an event when the step is due because of one.
      if (s.href.includes("{event}")) expect(["before_event", "event_day"], s.key).toContain(s.when);
    }
  });

  it("gate every step on a real area of the portal and a real module", () => {
    for (const s of allSteps()) {
      expect(Object.keys(ACCESS), s.key).toContain(s.access);
      if (s.module) expect([...MODULE_KEYS], s.key).toContain(s.module);
    }
  });

  it("tick only from counters that exist, and every counter is spelled out in plain words", () => {
    for (const s of allSteps()) {
      if (s.signal) expect([...COUNTER_KEYS], s.key).toContain(s.signal);
      if (s.onlyIf) expect([...COUNTER_KEYS], s.key).toContain(s.onlyIf);
    }
    for (const key of COUNTER_KEYS) {
      expect(COUNTERS[key].done, key).toMatch(/\w/);
      expect(COUNTERS[key].waiting(3), key).toMatch(/\w/);
    }
  });

  it("leave some steps by hand and tick others from a counter (so the card shows both honestly)", () => {
    const steps = allSteps();
    expect(steps.some((s) => s.signal)).toBe(true);
    expect(steps.some((s) => !s.signal)).toBe(true);
  });

  it("say pledge, never bid, and keep to plain English", () => {
    const text = allSteps().flatMap((s) => [s.title, s.why, s.ask ?? ""]).join(" ");
    expect(text).not.toMatch(/\bbids?\b/i);
    expect(text).not.toMatch(/\b(RLS|RPC|SQL|JSON|API)\b/);
  });

  it("send nothing about learners to Niva (D2): no Pathshala step carries a question, and no question names anyone", () => {
    for (const s of allSteps()) {
      const aboutLearners = s.module === "pathshala" || s.module === "gyan_path" || s.href.startsWith("/pathshala");
      if (aboutLearners) expect(s.ask, s.key).toBeUndefined();
      if (s.ask) expect(s.ask, s.key).not.toMatch(/\b(child|children|kid|student|learner)s?\b/i);
    }
  });
});

describe("where a step opens", () => {
  /** Does a page exist for this path? Dynamic folders ([id]) match any one segment. */
  function pageExists(path: string): boolean {
    let dir = join(root, "src/app/(app)");
    for (const seg of path.split("/").filter(Boolean)) {
      const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
      const exact = entries.find((e) => e.name === seg);
      const dynamic = entries.find((e) => /^\[[^\]]+\]$/.test(e.name));
      const next = exact ?? dynamic;
      if (!next) return false;
      dir = join(dir, next.name);
    }
    return existsSync(join(dir, "page.tsx"));
  }

  it("is a page that exists in the portal", () => {
    for (const s of allSteps()) {
      const path = s.href.split("?")[0].replace("{event}", "an-event-id");
      expect(pageExists(path), `${s.key} opens ${s.href}`).toBe(true);
    }
  });
});
