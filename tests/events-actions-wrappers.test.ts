// The Events Server Actions that now run a command (setEventStatus, setRsvpStatus, assignVolunteer) answer exactly as they did when
// they did the work themselves: the same ActionResult, the same sentences, the same activity key.
import { beforeEach, describe, expect, it, vi } from "vitest";

const held = vi.hoisted(() => ({ session: null as unknown, grants: [] as unknown[] }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), unstable_rethrow: vi.fn() }));
vi.mock("@/lib/data/event-survey", () => ({ readSurveyNotices: vi.fn() }));
vi.mock("@/lib/activity/with-activity", () => ({
  activityParts: (option: string | { key: string; entityFrom?: unknown; via?: unknown }) =>
    typeof option === "string" ? { key: option, opts: {} } : { key: option.key, opts: { entityFrom: option.entityFrom, via: option.via } },
  withActivity: vi.fn((_key: string, action: () => Promise<unknown>) => action()),
}));
vi.mock("@/lib/data/events", () => ({
  // The real one loads the session and the person's roles, then runs the area check; this does the check on the held session.
  eventActionContext: async (check: (a: unknown) => boolean, denied: string) => {
    const { FormError } = await import("@/lib/events/forms");
    const s = held.session as { permissions: string[]; db: unknown; center: { id: string; time_zone: string }; userId: string };
    const access = { permissions: s.permissions, isPlatformAdmin: false, isOwner: false, grants: held.grants };
    if (!check(access)) throw new FormError(denied);
    return { session: s, access, db: s.db, centerId: s.center.id, tz: s.center.time_zone, userId: s.userId };
  },
}));

import { assignVolunteer, setEventStatus, setRsvpStatus } from "@/app/(app)/events/actions";
import { withActivity } from "@/lib/activity/with-activity";
import { readSurveyNotices } from "@/lib/data/event-survey";

import { addEventsWorld, EV, recordInserts } from "./commands/events-world";
import { communityWithChildren, fakeDb, fakeSession, type FakeDbOptions } from "./commands/helpers";

function fd(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

function as(permissions: string[], opts: { world?: FakeDbOptions; scoped?: { role: string; event: string } } = {}) {
  const world = addEventsWorld((opts.world ?? communityWithChildren()) as ReturnType<typeof communityWithChildren>);
  const grants = opts.scoped
    ? [{ center_id: "center-1", user_id: "user-1", role_key: opts.scoped.role, scope_kind: "event", scope_id: opts.scoped.event, starts_at: "2026-01-01T00:00:00Z", ends_at: null }]
    : [];
  world.tables.role_grants = grants;
  const db = fakeDb(world);
  const inserts = recordInserts(db as unknown as { from: (t: string) => unknown });
  held.session = fakeSession({ db, permissions });
  held.grants = grants;
  return { world, db, inserts };
}

const MANAGER = ["events.view", "events.manage"];

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(withActivity).mockClear();
  vi.mocked(readSurveyNotices).mockReset();
});

describe("setEventStatus", () => {
  it("says what it always said after a move the screen offers", async () => {
    const { world } = as(MANAGER);
    const expectations: [string, string, string][] = [
      [EV.diwali, "rsvp_closed", "RSVPs closed."],
      [EV.diwali, "published", "Published · RSVPs open in the member app"],
      [EV.diwali, "live", "Event is live — check-in is open."],
      [EV.diwali, "completed", "Marked completed."],
      [EV.diwali, "live", "Event is live — check-in is open."],
      [EV.diwali, "cancelled", "Event cancelled."],
      [EV.diwali, "draft", "Back to draft."],
    ];
    for (const [id, status, message] of expectations) {
      // `toStrictEqual`: no extra keys, so a screen reading the result sees exactly what it did before.
      expect(await setEventStatus(id, null, fd({ status })), status).toStrictEqual({ ok: true, message });
    }
    expect(world.tables.events.find((e) => e.id === EV.diwali)!.status).toBe("draft");
  });

  it("keeps the same activity key and entity", async () => {
    as(MANAGER);
    await setEventStatus(EV.diwali, null, fd({ status: "rsvp_closed" }));
    const [key, , opts] = vi.mocked(withActivity).mock.calls[0] as unknown as [string, unknown, { entityFrom: unknown }];
    expect(key).toBe("events.set_status");
    expect(opts.entityFrom).toEqual({ kind: "event", id: EV.diwali });
  });

  it("refuses a person who may not, in the sentence it always used", async () => {
    as(["events.view"]);
    expect(await setEventStatus(EV.diwali, null, fd({ status: "live" }))).toStrictEqual({
      ok: false,
      error: "Could not change the event status — only event managers and this event's lead can change its status.",
    });
  });

  it("lets an event's own lead change that event's status", async () => {
    as(["events.view"], { scoped: { role: "event_lead", event: EV.diwali } });
    expect(await setEventStatus(EV.diwali, null, fd({ status: "rsvp_closed" }))).toStrictEqual({ ok: true, message: "RSVPs closed." });
    expect(await setEventStatus(EV.garba, null, fd({ status: "rsvp_closed" }))).toMatchObject({ ok: false, error: expect.stringContaining("only event managers and this event's lead") });
  });

  it("refuses a word that is not a status, and an event it cannot change", async () => {
    as(MANAGER);
    expect(await setEventStatus(EV.diwali, null, fd({ status: "archived" }))).toStrictEqual({ ok: false, error: "Could not change the event status — choose a valid status." });
    expect(await setEventStatus(EV.missing, null, fd({ status: "live" }))).toStrictEqual({ ok: false, error: "Could not change the event status — you can't change this event." });
  });

  it("explains a database refusal and never says it changed", async () => {
    const world = communityWithChildren();
    world.failUpdates = { events: { code: "42501", message: "new row violates row-level security policy" } };
    as(MANAGER, { world });
    expect(await setEventStatus(EV.diwali, null, fd({ status: "live" }))).toStrictEqual({ ok: false, error: "Could not change the event status — you don't have permission to make this change." });
  });

  it("now refuses a move the screen never offers (the new rule), with a sentence that says what is possible", async () => {
    const { world } = as(MANAGER);
    world.tables.events.find((e) => e.id === EV.garba)!.status = "draft";
    expect(await setEventStatus(EV.garba, null, fd({ status: "live" }))).toStrictEqual({
      ok: false,
      error: "Could not change the event status — the event is a draft, so it cannot go straight to live. From here it can go to published or cancelled.",
    });
    expect(world.tables.events.find((e) => e.id === EV.garba)!.status).toBe("draft");
  });

  it("still tells whether the survey of a completed event opened", async () => {
    const { world } = as(MANAGER);
    world.tables.events.find((e) => e.id === EV.garba)!.status = "live";
    world.tables.surveys = [{ id: "sv-1", event_id: EV.garba, kind: "event_feedback" }];
    vi.mocked(readSurveyNotices).mockResolvedValue({ ok: false });
    expect(await setEventStatus(EV.garba, null, fd({ status: "completed" }))).toStrictEqual({
      ok: true,
      message: "Marked completed. Its survey's numbers could not be loaded; open the event's Survey tab to see who gets a push.",
    });
  });
});

describe("setRsvpStatus", () => {
  it("answers with the words the screen has always shown, and changes the RSVP in one database step", async () => {
    const { db } = as(MANAGER);
    for (const [status, message] of [["confirmed", "RSVP confirmed."], ["rsvpd", "RSVP reopened."], ["no_show", "RSVP marked no-show."], ["cancelled", "RSVP cancelled."], ["waitlisted", "RSVP waitlisted."]] as const) {
      expect(await setRsvpStatus(EV.diwali, EV.rsvpShah, null, fd({ status })), status).toStrictEqual({ ok: true, message });
    }
    expect(db.rpcCalls.map((c) => c.fn)).toEqual(Array(5).fill("event_set_rsvp_status"));
    expect(db.rpcCalls[0].args).toEqual({ p_event: EV.diwali, p_rsvp: EV.rsvpShah, p_status: "confirmed" });
    const [key, , opts] = vi.mocked(withActivity).mock.calls[0] as unknown as [string, unknown, { entityFrom: unknown }];
    expect([key, opts.entityFrom]).toEqual(["events.set_rsvp_status", { kind: "rsvp", id: EV.rsvpShah }]);
  });

  it("refuses the same ways", async () => {
    as(["events.view"]);
    expect(await setRsvpStatus(EV.diwali, EV.rsvpShah, null, fd({ status: "confirmed" }))).toStrictEqual({ ok: false, error: "Could not update the RSVP — only event staff can change RSVPs." });
    as(MANAGER);
    expect(await setRsvpStatus(EV.diwali, EV.rsvpShah, null, fd({ status: "gone" }))).toStrictEqual({ ok: false, error: "Could not update the RSVP — choose a valid status." });
    // The database function says false when that RSVP is not the caller's to change.
    expect(await setRsvpStatus(EV.garba, EV.rsvpShah, null, fd({ status: "confirmed" }))).toStrictEqual({ ok: false, error: "Could not update the RSVP — you can't change this RSVP." });
  });

  it("explains a database failure", async () => {
    const world = communityWithChildren();
    world.failRpc = { event_set_rsvp_status: { code: "42501", message: "permission denied for function event_set_rsvp_status" } };
    as(MANAGER, { world });
    const r = await setRsvpStatus(EV.diwali, EV.rsvpShah, null, fd({ status: "confirmed" }));
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/^Could not update the RSVP — /);
  });
});

describe("assignVolunteer", () => {
  it("assigns one person or several, in one insert, with the same sentences", async () => {
    const { inserts } = as(MANAGER);
    expect(await assignVolunteer(EV.diwali, EV.shiftFood, null, fd({ person_id: EV.adult }))).toStrictEqual({ ok: true, message: "Volunteer assigned." });
    expect(await assignVolunteer(EV.diwali, EV.shiftFood, null, fd({ person_id: [EV.adult, EV.minor] }))).toStrictEqual({ ok: true, message: "2 volunteers assigned." });
    expect(inserts.map((i) => (i.rows as unknown[]).length)).toEqual([1, 2]);
    expect(inserts[0].rows).toEqual([{ center_id: "center-1", shift_id: EV.shiftFood, person_id: EV.adult }]);
    // It never had an activity key, and still has none.
    expect(withActivity).not.toHaveBeenCalled();
  });

  it("asks who to assign, and refuses a person who may not", async () => {
    as(MANAGER);
    expect(await assignVolunteer(EV.diwali, EV.shiftFood, null, fd({}))).toStrictEqual({ ok: false, error: "Could not assign the volunteer — choose who to assign." });
    as(["events.view"]);
    expect(await assignVolunteer(EV.diwali, EV.shiftFood, null, fd({ person_id: EV.adult }))).toStrictEqual({
      ok: false,
      error: "Could not assign the volunteer — only this event's lead or the volunteer coordinator can assign volunteers.",
    });
  });

  it("lets the volunteer coordinator and the event's lead assign", async () => {
    as(["volunteers.manage"]);
    expect(await assignVolunteer(EV.diwali, EV.shiftFood, null, fd({ person_id: EV.adult }))).toMatchObject({ ok: true });
    as(["events.view"], { scoped: { role: "event_lead", event: EV.diwali } });
    expect(await assignVolunteer(EV.diwali, EV.shiftFood, null, fd({ person_id: EV.adult }))).toMatchObject({ ok: true });
  });

  it("explains a database refusal and does not say it assigned", async () => {
    const { db } = as(MANAGER);
    recordInserts(db as unknown as { from: (t: string) => unknown }, { fail: { code: "23505", message: "duplicate key value violates unique constraint" } });
    const r = await assignVolunteer(EV.diwali, EV.shiftFood, null, fd({ person_id: EV.adult }));
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/^Could not assign the volunteer — /);
  });
});
