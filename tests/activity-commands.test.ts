import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn(() => true) }));

import { recordActivity } from "@/lib/activity/record";
import { commandActivityKey, commandEventToActivity } from "@/lib/commands/activity";
import { CATALOG } from "@/lib/commands/catalog";
import { onCommandEvent } from "@/lib/commands/hooks";
import type { CommandEvent } from "@/lib/commands/types";

import { fakeSession } from "./commands/helpers";

const event = (over: Partial<CommandEvent> = {}): CommandEvent => ({
  key: "people.search",
  level: "read",
  via: "palette",
  outcome: "ok",
  durationMs: 42.4,
  at: "2026-10-10T15:00:00.000Z",
  centerId: "center-1",
  userId: "user-1",
  personId: "person-1",
  roles: ["event_manager"],
  requestId: "req-1",
  inputKeys: ["q"],
  ...over,
});

describe("the activity key of a command", () => {
  it("is 'assistant.' plus the command key with its dot written as an underscore", () => {
    expect(commandActivityKey("people.search")).toBe("assistant.people_search");
    expect(commandActivityKey("accounting.month_close_blockers")).toBe("assistant.accounting_month_close_blockers");
  });
  it("is nothing for the placeholders of a confirmation or a refusal", () => {
    expect(commandActivityKey("(confirm)")).toBeNull();
    expect(commandActivityKey("(reject)")).toBeNull();
    expect(commandActivityKey("")).toBeNull();
    expect(commandActivityKey("nodot")).toBeNull();
  });
  it("fits the shape the database and the portal accept for an action key", () => {
    const db = /^[a-z][a-z0-9_]{1,40}(\.[a-z][a-z0-9_]{1,40}){0,2}$/;
    const portal = /^[a-z][a-z0-9_]{0,31}(\.[a-z][a-z0-9_]{0,47}){1,2}$/;
    for (const c of CATALOG) {
      const key = commandActivityKey(c.key);
      expect(key, c.key).not.toBeNull();
      expect(db.test(key as string), key as string).toBe(true);
      expect(portal.test(key as string), key as string).toBe(true);
    }
  });
});

describe("what a command run becomes in the stream", () => {
  it("records a run that worked, with how it was started and how long it took, and nothing else", () => {
    const input = commandEventToActivity(event());
    expect(input).toEqual({ key: "assistant.people_search", outcome: "ok", via: "palette", duration_ms: 42 });
  });
  it("records the way in: a screen, the palette or the assistant", () => {
    expect(commandEventToActivity(event({ via: "screen" }))?.via).toBe("screen");
    expect(commandEventToActivity(event({ via: "assistant" }))?.via).toBe("assistant");
  });
  it("keeps no value, no field name, no person, no proposal and no sentence", () => {
    const rich = event({ inputKeys: ["q", "notes"], proposalId: "9b2f6c64-1111-4222-8333-444455556666", error: "Could not find Zoya Shah", outcome: "failed", code: "failed" });
    const text = JSON.stringify(commandEventToActivity(rich));
    for (const leak of ["Zoya", "notes", "9b2f6c64", "user-1", "person-1", "event_manager", "req-1", "center-1", "Could not"]) expect(text).not.toContain(leak);
  });
  it("counts a confirmed proposal as the moment the action happened", () => {
    expect(commandEventToActivity(event({ key: "events.set_field", level: "confirm", outcome: "confirmed" }))).toMatchObject({ key: "assistant.events_set_field", outcome: "ok" });
  });
  it("records nothing for a proposal or a turned-down proposal (the confirmation is what counts)", () => {
    expect(commandEventToActivity(event({ key: "events.set_field", outcome: "proposed" }))).toBeNull();
    expect(commandEventToActivity(event({ key: "(reject)", outcome: "rejected" }))).toBeNull();
    expect(commandEventToActivity(event({ key: "(confirm)", outcome: "failed", code: "proposal_failed" }))).toBeNull();
  });
  it("says what went wrong with a word from the closed list", () => {
    expect(commandEventToActivity(event({ outcome: "denied", code: "no_access" }))).toMatchObject({ outcome: "error", error_code: "no_permission" });
    expect(commandEventToActivity(event({ outcome: "denied", code: "module_off" }))).toMatchObject({ error_code: "no_permission" });
    expect(commandEventToActivity(event({ outcome: "invalid", code: "invalid" }))).toMatchObject({ outcome: "error", error_code: "invalid_input" });
    expect(commandEventToActivity(event({ outcome: "needs_step_up", code: "needs_step_up" }))).toMatchObject({ error_code: "step_up_required" });
    expect(commandEventToActivity(event({ outcome: "failed", code: "failed" }))).toMatchObject({ error_code: "failed" });
    expect(commandEventToActivity(event({ outcome: "failed", code: "unsafe_result" }))).toMatchObject({ error_code: "failed" });
    // No code given: the outcome decides.
    expect(commandEventToActivity(event({ outcome: "denied", code: undefined }))).toMatchObject({ error_code: "no_permission" });
    expect(commandEventToActivity(event({ outcome: "failed", code: undefined }))).toMatchObject({ error_code: "failed" });
  });
  it("leaves out a duration that makes no sense", () => {
    expect(commandEventToActivity(event({ durationMs: -5 }))?.duration_ms).toBeUndefined();
    expect(commandEventToActivity(event({ durationMs: Number.NaN }))?.duration_ms).toBeUndefined();
  });
});

describe("the recorder hook", () => {
  beforeEach(() => vi.mocked(recordActivity).mockClear());

  it("hands the recorder the session's database, the community and the event", () => {
    const session = fakeSession();
    onCommandEvent(event(), session);
    expect(recordActivity).toHaveBeenCalledTimes(1);
    expect(recordActivity).toHaveBeenCalledWith({ db: session.db, center: session.center }, { key: "assistant.people_search", outcome: "ok", via: "palette", duration_ms: 42 });
  });
  it("hands over nothing for a call that records nothing", () => {
    onCommandEvent(event({ outcome: "proposed" }), fakeSession());
    onCommandEvent(event({ key: "(reject)", outcome: "rejected" }), fakeSession());
    expect(recordActivity).not.toHaveBeenCalled();
  });
});

describe("the command keys the database lists (migration 0625)", () => {
  const migrations = join(process.cwd(), "supabase", "migrations");
  const file = readdirSync(migrations).find((f) => /^0625_.*\.sql$/.test(f));
  // 0625 lists the first commands; a command added later is listed by the migration that adds it (an applied migration is never
  // edited), so the keys are read from 0625 and every migration after it.
  const sql = readdirSync(migrations)
    .filter((f) => f.endsWith(".sql") && f >= "0625")
    .sort()
    .map((f) => readFileSync(join(migrations, f), "utf8"))
    .join("\n");
  // ('assistant.people_search', 'Search people and households', 'people.search')
  const registered = [...sql.matchAll(/\(\s*'(assistant\.[a-z0-9_]+)'\s*,\s*'([^']+)'\s*,\s*'([a-z0-9_.]+)'\s*\)/g)].map((m) => ({ key: m[1], label: m[2], command: m[3] }));

  it("is found", () => {
    expect(file).toBeDefined();
    expect(registered.length).toBeGreaterThanOrEqual(8);
  });
  it("lists every command of the command layer, with commandable_key set to the command", () => {
    for (const c of CATALOG) {
      const row = registered.find((r) => r.command === c.key);
      expect(row, `${c.key} is not registered in 0625 or a later migration`).toBeDefined();
      expect(row?.key).toBe(commandActivityKey(c.key));
    }
  });
  it("lists no command that no longer exists (a removed command's events would be dropped for nothing)", () => {
    const known = new Set(CATALOG.map((c) => c.key));
    expect(registered.filter((r) => !known.has(r.command)).map((r) => r.command)).toEqual([]);
  });
  it("gives every key a plain label that finishes 'After you ...'", () => {
    for (const r of registered) {
      expect(r.label.length).toBeGreaterThan(5);
      expect(r.label.length).toBeLessThanOrEqual(120);
      expect(r.label).not.toMatch(/[._]/);
    }
  });
});
