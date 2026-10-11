import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));
vi.mock("@/lib/session", () => ({ loadSession: vi.fn(), dbWithReason: vi.fn() }));

import { revalidatePath } from "next/cache";

import { saveAssistantAction } from "@/app/(app)/platform/centers/[id]/actions";
import { assistantEnabled } from "@/lib/assistant/settings";
import { confirmToolChoices } from "@/lib/assistant/choices";
import { dbWithReason, loadSession } from "@/lib/session";

import { fakeSession } from "../commands/helpers";

const CENTER = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1001";

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of Array.isArray(v) ? v : [v]) fd.append(k, one);
  return fd;
}

type Rules = Record<string, unknown>;

/** Just enough of the centers table for a versioned rules save: read the rules, and update them when the version still matches. */
function centersDb(start: Rules) {
  const state = { rules: start, updates: 0 };
  function from() {
    const q = { op: "select", patch: undefined as { rules: Rules } | undefined, filters: [] as [string, string, unknown][], single: false };
    const run = () => {
      const idMatches = q.filters.filter((f) => f[0] === "id").every((f) => f[2] === CENTER);
      if (q.op === "select") return { data: idMatches ? (q.single ? { rules: state.rules } : [{ rules: state.rules }]) : null, error: null };
      const current = state.rules.version === undefined ? null : String(state.rules.version);
      const wanted = q.filters.find((f) => f[0] === "rules->>version");
      const matches = idMatches && (!wanted || (wanted[1] === "is" ? current === null : String(wanted[2]) === current));
      if (!matches) return { data: [], error: null };
      state.rules = q.patch!.rules;
      state.updates += 1;
      return { data: [{ id: CENTER }], error: null };
    };
    const b = {
      select: () => b,
      update: (patch: { rules: Rules }) => ((q.op = "update"), (q.patch = patch), b),
      eq: (c: string, v: unknown) => (q.filters.push([c, "eq", v]), b),
      is: (c: string, v: unknown) => (q.filters.push([c, "is", v]), b),
      maybeSingle: () => ((q.single = true), b),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    };
    return b;
  }
  return { from, state };
}

function world(rules: Rules, platformAdmin = true) {
  const db = centersDb(rules);
  vi.mocked(loadSession).mockResolvedValue({ status: "ok", session: fakeSession({ db, isPlatformAdmin: platformAdmin }) });
  vi.mocked(dbWithReason).mockResolvedValue(db as never);
  return { state: db.state };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(dbWithReason).mockReset();
  vi.mocked(loadSession).mockReset();
});

describe("Platform › Centers › Niva for admins", () => {
  it("offers the write actions Niva could be allowed to prepare, all off to begin with", () => {
    // Every command that changes something is listed, and every one starts off (events, People, roles and modules in Settings, Messages, Content and Store).
    const choices = confirmToolChoices(undefined);
    expect(choices).toContainEqual(expect.objectContaining({ key: "events.set_field", title: "Change a detail of an event", on: false }));
    expect(choices.map((c) => c.key)).toEqual(
      expect.arrayContaining(["events.set_status", "events.set_rsvp_status", "events.assign_volunteer", "events.create_from_clone", "people.merge_people", "people.move_person", "people.decide_application", "settings.grant_role", "settings.revoke_role", "settings.set_module", "messages.schedule_campaign", "messages.approve_campaign", "messages.set_campaign_status", "messages.reply_to_thread", "messages.set_thread", "messages.handle_whatsapp_request", "content.decide_item", "content.archive_item", "store.set_order_status", "store.adjust_stock", "store.change_price"]),
    );
    expect(choices.every((c) => c.on === false)).toBe(true);
    const ticked = confirmToolChoices({ assistant: { tools: { "events.set_field": true } } });
    expect(ticked.find((c) => c.key === "events.set_field")?.on).toBe(true);
    expect(ticked.filter((c) => c.on).map((c) => c.key)).toEqual(["events.set_field"]);
    // The three Giving commands that move money are listed with a plain note, and stay off unless each one is ticked.
    for (const key of ["giving.record_payment", "giving.confirm_exact_zelle_matches", "giving.match_deposit"]) {
      expect(choices.find((c) => c.key === key), key).toMatchObject({ on: false, moneyNote: expect.stringContaining("Moves money") });
    }
    expect(choices.find((c) => c.key === "events.set_field")?.moneyNote).toBeNull();
  });

  it("switches Niva on for the community, keeps the other rules, and records the reason", async () => {
    const { state } = world({ version: 4, store: { gift_pack_cents: 299 } });
    const result = await saveAssistantAction(null, form({ center: CENTER, version: "4", enabled: "on", reason: "Pilot with the treasurer" }));
    expect(result).toMatchObject({ ok: true, message: expect.stringMatching(/Niva for admins is now on for this community · 0 write actions allowed · rules version 5 · audit logged/) });
    expect(dbWithReason).toHaveBeenCalledWith(expect.anything(), "Pilot with the treasurer");
    expect(state.rules).toMatchObject({ version: 5, store: { gift_pack_cents: 299 }, assistant: { enabled: true, tools: { "events.set_field": false } } });
    expect(assistantEnabled(state.rules as never)).toBe(true);
    expect(state.updates).toBe(1);
    expect(revalidatePath).toHaveBeenCalledWith(`/platform/centers/${CENTER}`);
  });

  it("allows a write action only when it is ticked, and switches Niva off again", async () => {
    const { state } = world({ version: 5, assistant: { enabled: true, tools: { "events.set_field": false } } });
    const on = await saveAssistantAction(null, form({ center: CENTER, version: "5", enabled: "on", tool: "events.set_field", reason: "Owner approved changing events" }));
    expect(on).toMatchObject({ ok: true, message: expect.stringMatching(/1 write action allowed/) });
    expect(state.rules).toMatchObject({ assistant: { enabled: true, tools: { "events.set_field": true } } });

    const off = await saveAssistantAction(null, form({ center: CENTER, version: "6", reason: "Pause while we train staff" }));
    expect(off).toMatchObject({ ok: true, message: expect.stringMatching(/now off for this community · rules version 7/) });
    expect(state.rules).toMatchObject({ assistant: { enabled: false, tools: { "events.set_field": false } } });
  });

  it("ignores a tool that is not one of the write actions", async () => {
    const { state } = world({});
    await saveAssistantAction(null, form({ center: CENTER, version: "", enabled: "on", tool: ["events.set_field", "people.search", "../../etc"], reason: "Trying" }));
    const tools = state.rules.assistant as { tools: Record<string, boolean> };
    // Every write action is recorded, only the one that was ticked is on, and nothing else gets in.
    expect(Object.keys(tools.tools)).toEqual(expect.arrayContaining(["events.set_field", "events.set_status", "events.create_from_clone", "people.merge_people", "people.decide_application"]));
    expect(Object.keys(tools.tools)).not.toContain("people.search");
    expect(Object.keys(tools.tools).every((k) => /^[a-z_]+\.[a-z_]+$/.test(k))).toBe(true);
    expect(Object.entries(tools.tools).filter(([, on]) => on).map(([key]) => key)).toEqual(["events.set_field"]);
    // The three that move money are among them, each off unless ticked.
    expect(tools.tools).toMatchObject({ "giving.record_payment": false, "giving.confirm_exact_zelle_matches": false, "giving.match_deposit": false });
  });

  it("needs a reason, a platform admin and a page that is not out of date", async () => {
    world({ version: 2 });
    expect(await saveAssistantAction(null, form({ center: CENTER, version: "2", enabled: "on", reason: "  " }))).toMatchObject({ ok: false, error: expect.stringMatching(/say why/) });
    expect(await saveAssistantAction(null, form({ center: CENTER, version: "2", enabled: "on", reason: "x".repeat(501) }))).toMatchObject({ ok: false, error: expect.stringMatching(/under 500/) });
    expect(await saveAssistantAction(null, form({ center: "not-an-id", version: "2", reason: "r" }))).toMatchObject({ ok: false, error: expect.stringMatching(/out of date/) });
    expect(await saveAssistantAction(null, form({ center: CENTER, version: "two", reason: "r" }))).toMatchObject({ ok: false, error: expect.stringMatching(/page is out of date/) });
    world({ version: 2 }, false);
    expect(await saveAssistantAction(null, form({ center: CENTER, version: "2", enabled: "on", reason: "r" }))).toMatchObject({ ok: false, error: expect.stringMatching(/only the Weaver team/) });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses to overwrite rules someone else saved meanwhile", async () => {
    const { state } = world({ version: 9 });
    const result = await saveAssistantAction(null, form({ center: CENTER, version: "8", enabled: "on", reason: "r" }));
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/someone else saved the rules/) });
    expect(state.rules).toEqual({ version: 9 });
  });
});
