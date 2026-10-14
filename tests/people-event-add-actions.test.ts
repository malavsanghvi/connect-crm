import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const held = vi.hoisted(() => ({ session: null as unknown, access: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("@/lib/activity/with-activity", () => ({ withActivity: vi.fn((_k: string, action: () => Promise<unknown>) => action()) }));
vi.mock("@/lib/data/events", () => ({
  // The real one loads the session and the person's event roles and runs the check; this runs the check on the held access.
  eventActionContext: async (check: (a: unknown) => boolean, denied: string) => {
    const { FormError } = await import("@/lib/events/form-fields");
    const state = held.session as { expired?: boolean } | null;
    if (!state || state.expired) throw new FormError("Your session has expired. Sign in again, then retry.");
    if (!check(held.access)) throw new FormError(denied);
    return { session: held.session, access: held.access, db: (held.session as { db: unknown }).db, centerId: "center-1", tz: "America/Chicago", userId: "user-1" };
  },
}));

import { withActivity } from "@/lib/activity/with-activity";
import { addToEventAction, loadAddToEventAction } from "@/app/(app)/households/[id]/event-add-actions";
import type { EventAccess } from "@/lib/events/access";

import { MANAGER, NOW, VIEWER, W, database, leadOf, world } from "./people-event-add-world";
import { fakeSession } from "./commands/helpers";

// The two Server Actions behind the panel: the gate is the one that edits an event, an unexpected failure is said in words, and
// nothing is claimed that did not happen. (What they read and write is tested in people-event-add-server.test.ts.)

function as(access: EventAccess, opts: { modulesOff?: string[]; expired?: boolean; failTables?: Record<string, { message: string }> } = {}) {
  const w = world();
  const { db, world: data } = database({ ...w, failTables: opts.failTables } as typeof w);
  held.session = { ...fakeSession({ db, permissions: access.permissions, modulesOff: opts.modulesOff ?? [] }), expired: opts.expired };
  held.access = access;
  return data;
}

const call = { householdId: W.hh, eventId: W.picnic, personIds: [W.samira, W.layla] };

beforeEach(() => {
  // The events the actions list are those not over yet "now" (the fixtures are dated around NOW): without a fixed clock this test
  // starts failing the moment real time passes the fixtures' dates (it did on 2026-10-14, when "Weekend camp" ended).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(withActivity).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("loadAddToEventAction", () => {
  it("lists the events for someone who can add", async () => {
    as(MANAGER);
    const r = await loadAddToEventAction({ householdId: W.hh });
    expect(r.ok && r.events.map((e) => e.name)).toEqual(["Weekend camp", "Spring Picnic", "Cleanup 春の清掃", "Годовой вечер"]);
  });
  it("tells a role that can only look 'You don't have access to this area'", async () => {
    as(VIEWER);
    expect(await loadAddToEventAction({ householdId: W.hh })).toEqual({ ok: false, kind: "access", error: "You don't have access to this area" });
  });
  it("lets an event's lead in, for that event only", async () => {
    as(leadOf(W.tiny));
    const r = await loadAddToEventAction({ householdId: W.hh });
    expect(r.ok && r.events.map((e) => e.id)).toEqual([W.tiny]);
  });
  it("says so when the Events module is switched off", async () => {
    as(MANAGER, { modulesOff: ["events"] });
    expect(await loadAddToEventAction({ householdId: W.hh })).toEqual({ ok: false, kind: "other", error: "Could not load the events — events are switched off for this community." });
  });
  it("says in words when the session ended", async () => {
    as(MANAGER, { expired: true });
    expect(await loadAddToEventAction({ householdId: W.hh })).toEqual({ ok: false, kind: "other", error: "Could not load the events — your session has expired. Sign in again, then retry." });
  });
});

describe("addToEventAction", () => {
  it("adds, and answers with the sentences the panel shows", async () => {
    const w = as(MANAGER);
    const r = await addToEventAction(call);
    expect(r).toMatchObject({ ok: true, outcome: "created", message: "Samira and Layla are on Spring Picnic.", toast: "Added Samira and Layla to Spring Picnic." });
    expect(w.tables.rsvps).toHaveLength(1);
  });
  it("passes 'already confirmed' on only when it is exactly true", async () => {
    const w = as(MANAGER);
    await addToEventAction({ ...call, confirmed: "yes" as unknown as boolean });
    expect(w.tables.rsvps[0]).toMatchObject({ status: "rsvpd" });
    const w2 = as(MANAGER);
    await addToEventAction({ ...call, confirmed: true });
    expect(w2.tables.rsvps[0]).toMatchObject({ status: "confirmed" });
  });
  it("turns a role without the gate away, with nothing written", async () => {
    const w = as(VIEWER);
    expect(await addToEventAction(call)).toEqual({ ok: false, kind: "access", error: "You don't have access to this area" });
    expect(w.tables.rsvps).toEqual([]);
  });
  it("lets an event's lead add to that event and refuses any other", async () => {
    const w = as(leadOf(W.picnic));
    expect(await addToEventAction(call)).toMatchObject({ ok: true });
    expect(await addToEventAction({ ...call, eventId: W.tiny })).toEqual({ ok: false, kind: "access", error: "You don't have access to this area" });
    expect(w.tables.rsvps).toHaveLength(1);
  });
  it("says so when the Events module is switched off, and writes nothing", async () => {
    const w = as(MANAGER, { modulesOff: ["events"] });
    expect(await addToEventAction(call)).toEqual({ ok: false, kind: "other", error: "Could not add them to the event — events are switched off for this community." });
    expect(w.tables.rsvps).toEqual([]);
  });
  it("reads a call that is not what it expects as 'choose at least one person', not a crash", async () => {
    as(MANAGER);
    expect(await addToEventAction({ householdId: W.hh, eventId: W.picnic, personIds: "x" as unknown as string[] })).toEqual({ ok: false, kind: "other", error: "Could not add them to the event — choose at least one person." });
    expect(await addToEventAction(undefined as unknown as typeof call)).toEqual({ ok: false, kind: "other", error: "Could not add them to the event — the family or the event was not found." });
  });
  it("says what failed in words, never 'Added'", async () => {
    as(MANAGER, { failTables: { households: { message: "fetch failed" } } });
    const r = await addToEventAction(call);
    expect(r).toEqual({ ok: false, kind: "other", error: "Could not add them to the event — the database could not be reached — check the connection and try again." });
  });
  it("has no activity key (that needs a row in the activity catalog, which is a migration)", async () => {
    as(MANAGER);
    await loadAddToEventAction({ householdId: W.hh });
    await addToEventAction(call);
    expect(withActivity).not.toHaveBeenCalled();
  });
});
