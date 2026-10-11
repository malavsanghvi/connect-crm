import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));
vi.mock("@/lib/data/event-survey", () => ({ readSurveyNotices: vi.fn() }));

import { revalidatePath } from "next/cache";

import { CATALOG } from "@/lib/commands/catalog";
import { parsePersonIds, assignVolunteerCommand } from "@/lib/commands/catalog/events/assign-volunteer";
import { createFromClone } from "@/lib/commands/catalog/events/clone";
import { setRsvpStatusCommand } from "@/lib/commands/catalog/events/rsvps";
import { setEventStatusCommand } from "@/lib/commands/catalog/events/set-status";
import { CommandRegistry } from "@/lib/commands/registry";
import { confirmProposal, runCommand } from "@/lib/commands/run";
import type { CommandContext, CommandRunResult, CommandVia } from "@/lib/commands/types";
import { readSurveyNotices } from "@/lib/data/event-survey";

import { addEventsWorld, AUDIENCE_ANSWER, EV, recordInserts, SUMMARY_ANSWER } from "./events-world";
import { CHILDREN, communityWithChildren, fakeDb, fakeSession, testContext, type FakeDbOptions } from "./helpers";

const MANAGER = ["people.view", "events.view", "events.manage", "comms.send"];
const ON = Object.fromEntries(CATALOG.filter((c) => c.level === "confirm").map((c) => [c.key, true]));

function registry() {
  const r = new CommandRegistry();
  for (const c of CATALOG) r.register(c);
  return r;
}

function setup(opts: { via?: CommandVia; permissions?: string[]; rules?: unknown; world?: FakeDbOptions; grants?: Record<string, unknown>[] } = {}) {
  const world = addEventsWorld((opts.world ?? communityWithChildren()) as ReturnType<typeof communityWithChildren>);
  if (opts.grants) world.tables.role_grants = opts.grants;
  const db = fakeDb(world);
  const inserts = recordInserts(db as unknown as { from: (t: string) => unknown });
  const session = fakeSession({ db, permissions: opts.permissions ?? MANAGER, center: { ...fakeSession().center, rules: opts.rules ?? {} } });
  const ctx = testContext({ session, registry: registry(), via: opts.via ?? "screen", minorNames: CHILDREN.full });
  return { ctx, db, world, inserts, session };
}

const run = (ctx: CommandContext, key: string, input: unknown) => runCommand(ctx, key, input);
type Ok = { ok: true; data: Record<string, unknown>; message?: string };
const dataOf = <T = Record<string, unknown>>(r: CommandRunResult): T => {
  if (!r.ok || r.needsConfirmation) throw new Error(`expected data, got ${JSON.stringify(r)}`);
  return r.data as T;
};
type Ticket = { ok: true; needsConfirmation: true; proposalId: string; inputHash: string; preview: { summary: string; lines: unknown[]; warnings?: string[]; households?: { adults: string[] }[] }; confirmText: string };
const ticketOf = (r: CommandRunResult) => {
  if (!r.ok || !r.needsConfirmation) throw new Error(`expected a confirmation, got ${JSON.stringify(r)}`);
  return r as unknown as Ticket;
};
const leaks = (value: unknown) => {
  const text = JSON.stringify(value);
  return [...CHILDREN.full, ...CHILDREN.first, "Dev Joshi", "2012-02-02", "date_of_birth"].filter((w) => text.includes(w));
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(readSurveyNotices).mockReset();
});

// ---------------------------------------------------------------------------
describe("the Events commands", () => {
  it("are these, in this order, and every write is a confirm command that is off for Niva by default", () => {
    expect(CATALOG.filter((c) => c.key.startsWith("events.")).map((c) => `${c.key}:${c.level}`)).toEqual([
      "events.upcoming:read",
      "events.summary:read",
      "events.readiness:read",
      "events.audience_preview:read",
      "events.rsvps:read",
      "events.draft_change:draft",
      "events.clone_draft:draft",
      "events.set_field:confirm",
      "events.set_status:confirm",
      "events.set_rsvp_status:confirm",
      "events.assign_volunteer:confirm",
      "events.create_from_clone:confirm",
    ]);
    for (const c of CATALOG.filter((x) => x.level === "confirm")) expect(c.enabledByDefault, c.key).not.toBe(true);
  });

  it("are switched off for Niva until the owner turns each one on, and still work from a screen", async () => {
    for (const [key, input] of [
      ["events.set_status", { event_id: EV.diwali, status: "rsvp_closed" }],
      ["events.set_rsvp_status", { event_id: EV.diwali, rsvp_id: EV.rsvpShah, status: "cancelled" }],
      ["events.assign_volunteer", { event_id: EV.diwali, shift_id: EV.shiftFood, person_ids: EV.adult }],
      ["events.create_from_clone", { source_event_id: EV.picnic, new_date: "2027-06-01" }],
    ] as const) {
      expect(await run(setup({ via: "assistant" }).ctx, key, input), key).toMatchObject({ ok: false, code: "switched_off" });
      expect(await run(setup({ via: "screen" }).ctx, key, input), key).toMatchObject({ ok: true, needsConfirmation: true });
    }
  });

  it("need the event permission to be used at all", async () => {
    const { ctx } = setup({ permissions: ["people.view"] });
    for (const key of ["events.summary", "events.readiness", "events.audience_preview", "events.rsvps"]) {
      expect(await run(ctx, key, { event_id: EV.diwali }), key).toMatchObject({ ok: false, code: "no_access" });
    }
    const viewer = setup({ permissions: ["events.view"] }).ctx;
    expect(await run(viewer, "events.set_status", { event_id: EV.diwali, status: "live" })).toMatchObject({ ok: false, code: "no_access" });
    expect(await run(viewer, "events.summary", { event_id: EV.diwali })).toMatchObject({ ok: true });
  });
});

// ---------------------------------------------------------------------------
describe("events.summary", () => {
  it("gives the numbers and short sentences, counts only", async () => {
    const { ctx, db } = setup({ via: "assistant" });
    const r = await run(ctx, "events.summary", { event_id: EV.diwali });
    const d = dataOf<{ event: { name: string; status: string }; in_words: string[]; places_left: number; numbers: { people: { children_under_12: number } } }>(r);
    expect(d.event).toMatchObject({ name: "Diwali Dinner", status: "RSVP open" });
    expect(d.places_left).toBe(294);
    expect(d.numbers.people.children_under_12).toBe(2);
    expect(d.in_words.join(" ")).toContain("6 people have RSVP'd (2 confirmed); 300 places, 294 left.");
    expect(db.rpcCalls).toEqual([{ fn: "event_summary", args: { p_event: EV.diwali } }]);
    expect(leaks(r)).toEqual([]);
  });

  it("says when the event is not there or cannot be seen, and when the numbers could not be read", async () => {
    const { ctx } = setup();
    expect(await run(ctx, "events.summary", { event_id: EV.missing })).toMatchObject({ ok: false, error: "That event was not found, or you can't see it." });
    const broken = communityWithChildren();
    broken.failRpc = { event_summary: { code: "XX000", message: "boom" } };
    const r = await run(setup({ world: broken }).ctx, "events.summary", { event_id: EV.diwali });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/^Could not read the event's numbers — /);
  });

  it("says when the role cannot see who is assigned to shifts, rather than a zero", async () => {
    const { ctx, world } = setup();
    world.rpc.event_summary = () => ({ ...SUMMARY_ANSWER, volunteers: { visible: false, shifts: 2, spots_needed: 4, assigned: null, shifts_empty: null, shifts_open: null } });
    const d = dataOf<{ in_words: string[]; numbers: { volunteers: { assigned: number | null } } }>(await run(ctx, "events.summary", { event_id: EV.diwali }));
    expect(d.numbers.volunteers.assigned).toBeNull();
    expect(d.in_words.join(" ")).toContain("Your role can't see who is assigned.");
  });
});

// ---------------------------------------------------------------------------
describe("events.readiness", () => {
  it("lists what is worth a look on a complete event, and nothing blocking", async () => {
    const { ctx } = setup();
    const d = dataOf<{ ready: boolean; blockers: unknown[]; checks: { code: string }[]; summary: string; event: { name: string } }>(await run(ctx, "events.readiness", { event_id: EV.diwali }));
    expect(d.ready).toBe(true);
    expect(d.blockers).toEqual([]);
    expect(d.checks.map((c) => c.code)).toEqual(["already_published", "no_lead", "no_flyer", "empty_shifts", "overdue"]);
    expect(d.summary).toContain("Nothing is blocking Diwali Dinner from being published.");
  });

  it("blocks on a missing start, and on lunch with no time, and says how to fix each", async () => {
    const { ctx, world } = setup();
    Object.assign(world.tables.events.find((e) => e.id === EV.garba)!, { status: "draft", starts_at: null, lunch_enabled: true });
    const d = dataOf<{ ready: boolean; blockers: { code: string; fix: string }[] }>(await run(ctx, "events.readiness", { event_id: EV.garba }));
    expect(d.ready).toBe(false);
    expect(d.blockers.map((b) => b.code)).toEqual(["no_start", "lunch_time"]);
    expect(d.blockers[0].fix).toBe("Set when it starts in the event builder.");
  });

  it("checks the day itself when asked", async () => {
    const { ctx } = setup();
    const d = dataOf<{ goal: string; ready: boolean }>(await run(ctx, "events.readiness", { event_id: EV.diwali, goal: "event_day" }));
    expect(d).toMatchObject({ goal: "event_day", ready: true });
  });

  it("says the event is missing, and refuses a goal it does not know", async () => {
    const { ctx } = setup();
    expect(await run(ctx, "events.readiness", { event_id: EV.missing })).toMatchObject({ ok: false, error: "That event was not found, or you can't see it." });
    expect(await run(ctx, "events.readiness", { event_id: EV.diwali, goal: "someday" })).toMatchObject({ ok: false, code: "invalid" });
  });
});

// ---------------------------------------------------------------------------
describe("events.audience_preview", () => {
  it("counts who a reminder would reach by channel, and says what quiet hours do to a late send", async () => {
    // Quiet hours 9 PM - 7 AM (the default). 10:30 PM on Oct 10 in Chicago.
    const { ctx, db } = setup({ via: "assistant" });
    const r = await run(ctx, "events.audience_preview", { event_id: EV.diwali, send_at: "2026-10-10T22:30" });
    const d = dataOf<{
      households: number;
      adults: number;
      channels: { email: number; sms: number; whatsapp: number; push: null };
      adults_with_no_channel: number;
      guest_rsvps: number;
      quiet_hours: { window: string; held: boolean; goes_out_at: string; note: string };
      notes: string[];
    }>(r);
    expect(d).toMatchObject({ households: 2, adults: 3, guest_rsvps: 1, adults_with_no_channel: 1, channels: { email: 2, sms: 1, whatsapp: 0, push: null } });
    expect(d.quiet_hours).toMatchObject({ window: "9 PM – 7 AM", held: true, goes_out_at: "Sun, Oct 11, 7:00 AM" });
    expect(d.quiet_hours.note).toContain("hold push, text and WhatsApp until Sun, Oct 11, 7:00 AM");
    expect(d.notes.join(" ")).toContain("guest RSVP without a household are not messaged");
    expect(db.rpcCalls).toEqual([{ fn: "event_reminder_audience", args: { p_event: EV.diwali, p_statuses: ["rsvpd", "confirmed"] } }]);
    expect(leaks(r)).toEqual([]);
  });

  it("goes at once in the daytime, and uses now when no time is given", async () => {
    const { ctx } = setup(); // the test clock is 10 AM in Chicago
    const d = dataOf<{ quiet_hours: { held: boolean; note: string } }>(await run(ctx, "events.audience_preview", { event_id: EV.diwali }));
    expect(d.quiet_hours.held).toBe(false);
    expect(d.quiet_hours.note).toBe("That time is outside quiet hours, so everything goes at once.");
  });

  it("lets an event-day reminder through quiet hours only when the community allows it", async () => {
    const eventDay = { event_id: EV.diwali, send_at: "2026-10-24T06:00" };
    expect(dataOf<{ quiet_hours: { held: boolean } }>(await run(setup().ctx, "events.audience_preview", eventDay)).quiet_hours.held).toBe(false);
    const strict = setup({ rules: { notifications: { event_day_during_quiet_hours: false } } });
    expect(dataOf<{ quiet_hours: { held: boolean } }>(await run(strict.ctx, "events.audience_preview", eventDay)).quiet_hours.held).toBe(true);
  });

  it("asks only the families who have not confirmed for a confirmation", async () => {
    const { ctx, db } = setup();
    await run(ctx, "events.audience_preview", { event_id: EV.diwali, who: "confirmation" });
    expect(db.rpcCalls[0].args).toEqual({ p_event: EV.diwali, p_statuses: ["rsvpd"] });
  });

  it("does not guess when the role cannot see people or contact choices", async () => {
    const { ctx, world } = setup();
    world.rpc.event_reminder_audience = () => ({ ...AUDIENCE_ANSWER, people_visible: false, channels_visible: false, adults: null, email: null, sms: null, whatsapp: null, no_channel: null });
    const d = dataOf<{ adults: number | null; channels: { email: number | null }; notes: string[]; households: number }>(await run(ctx, "events.audience_preview", { event_id: EV.diwali }));
    expect(d.households).toBe(2);
    expect(d.adults).toBeNull();
    expect(d.channels.email).toBeNull();
    expect(d.notes[0]).toContain("Your role can't see people");
  });

  it("refuses a send time it cannot read, and an event that is not there", async () => {
    const { ctx } = setup();
    expect(await run(ctx, "events.audience_preview", { event_id: EV.diwali, send_at: "tomorrow morning" })).toMatchObject({ ok: false, error: "The send time must be a date and time like 2026-11-08T11:30." });
    expect(await run(ctx, "events.audience_preview", { event_id: EV.missing })).toMatchObject({ ok: false, error: "That event was not found, or you can't see it." });
  });
});

// ---------------------------------------------------------------------------
describe("events.rsvps", () => {
  it("lists RSVPs with the household as a card of adults, people counted and never named", async () => {
    for (const via of ["screen", "assistant"] as const) {
      const { ctx } = setup({ via });
      const r = await run(ctx, "events.rsvps", { event_id: EV.diwali });
      const d = dataOf<{ total: number; rsvps: { rsvp_id: string; people: number; status: string; guest: string | null; household: { household_id: string; adults: string[] } | null }[] }>(r);
      expect(d.total).toBe(3);
      const shah = d.rsvps.find((x) => x.rsvp_id === EV.rsvpShah)!;
      expect(shah).toMatchObject({ people: 2, status: "rsvpd" });
      expect(shah.household).toMatchObject({ household_id: "hh-shah", adults: ["Priya Shah", "Rahul Shah"] });
      const guest = d.rsvps.find((x) => x.rsvp_id === EV.rsvpGuest)!;
      // The cancelled person is not counted; the guest is a booking name, with no household.
      expect(guest).toMatchObject({ people: 1, guest: "Guest Booker", household: null });
      expect(leaks(r), `via ${via}`).toEqual([]);
    }
  });

  it("filters by status and respects the limit", async () => {
    const { ctx } = setup();
    const d = dataOf<{ shown: number; rsvps: { status: string }[] }>(await run(ctx, "events.rsvps", { event_id: EV.diwali, status: "confirmed" }));
    expect(d.rsvps.every((x) => x.status === "confirmed")).toBe(true);
    expect(d.shown).toBe(1);
    expect(await run(ctx, "events.rsvps", { event_id: EV.diwali, limit: 99 })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("says when nothing matches, and when the event is not there", async () => {
    const { ctx } = setup();
    expect(await run(ctx, "events.rsvps", { event_id: EV.garba })).toMatchObject({ ok: true, message: "No RSVPs match." });
    expect(await run(ctx, "events.rsvps", { event_id: EV.missing })).toMatchObject({ ok: false, error: "That event was not found, or you can't see it." });
  });
});

// ---------------------------------------------------------------------------
describe("events.set_status", () => {
  it("asks first, with the change in words and what members would notice", async () => {
    const { ctx, db } = setup({ via: "assistant", rules: { assistant: { tools: ON } } });
    const t = ticketOf(await run(ctx, "events.set_status", { event_id: EV.diwali, status: "rsvp_closed" }));
    expect(t.preview.summary).toBe("Change Diwali Dinner from published to closed for RSVPs.");
    expect(t.preview.lines).toEqual([{ label: "Status", before: "published", after: "closed for RSVPs" }]);
    expect(t.preview.warnings).toEqual(["Families can no longer RSVP in the app. Existing RSVPs stay."]);
    expect(t.confirmText).toBe("Yes, change Diwali Dinner from published to closed for RSVPs");
    expect(db.calls.some((c) => c.op === "update")).toBe(false);
  });

  it("refuses a move the Events screen does not offer, in a sentence, at the first step", async () => {
    const { ctx, world, db } = setup({ rules: { assistant: { tools: ON } } });
    world.tables.events.find((e) => e.id === EV.garba)!.status = "draft";
    const r = await run(ctx, "events.set_status", { event_id: EV.garba, status: "live" });
    expect(r).toMatchObject({ ok: false, error: "Could not change the event status — the event is a draft, so it cannot go straight to live. From here it can go to published or cancelled." });
    expect(await run(ctx, "events.set_status", { event_id: EV.picnic, status: "draft" })).toMatchObject({ ok: false, error: expect.stringContaining("is completed, so it cannot go straight to a draft") });
    expect(db.calls.some((c) => c.op === "update")).toBe(false);
  });

  it("checks again when confirmed, so a status that changed in between is not overwritten", async () => {
    const { ctx, world } = setup({ rules: { assistant: { tools: ON } } });
    const t = ticketOf(await run(ctx, "events.set_status", { event_id: EV.diwali, status: "rsvp_closed" }));
    world.tables.events.find((e) => e.id === EV.diwali)!.status = "cancelled";
    const r = await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(r).toMatchObject({ ok: false, error: "Could not change the event status — the event is cancelled, so it cannot go straight to closed for RSVPs. From here it can go to a draft." });
    expect(world.tables.events.find((e) => e.id === EV.diwali)!.status).toBe("cancelled");
  });

  it("changes the status once confirmed, says it in the screen's words, and refreshes the screens", async () => {
    const { ctx, db } = setup({ rules: { assistant: { tools: ON } } });
    const t = ticketOf(await run(ctx, "events.set_status", { event_id: EV.diwali, status: "live" }));
    const r = await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(r).toMatchObject({ ok: true, message: "Event is live — check-in is open.", data: { from: "published", to: "live", changed: true } });
    expect(db.calls.filter((c) => c.op === "update")).toEqual([{ table: "events", op: "update", patch: { status: "live" }, ids: [EV.diwali] }]);
    expect(revalidatePath).toHaveBeenCalledWith("/events", "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/ops", "layout");
  });

  it("warns that publishing opens the event to members, and what is missing first", async () => {
    const { ctx, world } = setup({ rules: { assistant: { tools: ON } } });
    Object.assign(world.tables.events.find((e) => e.id === EV.garba)!, { status: "draft", starts_at: null });
    const t = ticketOf(await run(ctx, "events.set_status", { event_id: EV.garba, status: "published" }));
    expect(t.preview.warnings![0]).toBe("Members will be able to RSVP in the app. Nothing is sent to them automatically.");
    expect(t.preview.warnings).toContain("Before this: It has no start date and time. Set when it starts in the event builder.");
  });

  it("says when it is already that status", async () => {
    const { ctx } = setup();
    const t = ticketOf(await run(ctx, "events.set_status", { event_id: EV.diwali, status: "published" }));
    expect(t.preview.warnings).toEqual(["It is already published, so nothing would change."]);
  });

  it("reports whether the survey of a completed event opened", async () => {
    const { ctx, world } = setup();
    Object.assign(world.tables.events.find((e) => e.id === EV.garba)!, { status: "live" });
    // No survey attached.
    let t = ticketOf(await run(ctx, "events.set_status", { event_id: EV.garba, status: "completed" }));
    expect(await confirmProposal(ctx, t.proposalId, t.inputHash)).toMatchObject({ ok: true, message: "Marked completed." });
    // A survey whose numbers cannot be read.
    world.tables.surveys = [{ id: "sv-1", event_id: EV.garba, kind: "event_feedback" }];
    Object.assign(world.tables.events.find((e) => e.id === EV.garba)!, { status: "live" });
    vi.mocked(readSurveyNotices).mockResolvedValue({ ok: false });
    t = ticketOf(await run(ctx, "events.set_status", { event_id: EV.garba, status: "completed" }));
    expect(await confirmProposal(ctx, t.proposalId, t.inputHash)).toMatchObject({
      ok: true,
      message: "Marked completed. Its survey's numbers could not be loaded; open the event's Survey tab to see who gets a push.",
    });
  });

  it("is allowed for an event's own lead, and only for that event", async () => {
    const grant = (scope_id: string) => [{ center_id: "center-1", user_id: "user-1", role_key: "event_lead", scope_kind: "event", scope_id, starts_at: "2026-01-01T00:00:00Z", ends_at: null }];
    const lead = setup({ permissions: ["events.view"], grants: grant(EV.diwali) });
    const other = setup({ permissions: ["events.view"], grants: grant(EV.garba) });
    // The command's own check, the one a Server Action relies on.
    expect(await setEventStatusCommand.execute!(lead.ctx, { event_id: EV.diwali, status: "rsvp_closed" })).toMatchObject({ ok: true, message: "RSVPs closed." });
    await expect(setEventStatusCommand.execute!(other.ctx, { event_id: EV.diwali, status: "rsvp_closed" })).rejects.toMatchObject({
      message: "Could not change the event status — only event managers and this event's lead can change its status.",
    });
  });

  it("says when the event cannot be changed, and never says it changed when the database refused", async () => {
    const { ctx } = setup();
    await expect(setEventStatusCommand.execute!(ctx, { event_id: EV.missing, status: "live" })).rejects.toMatchObject({ message: "Could not change the event status — you can't change this event." });
    const world = communityWithChildren();
    world.failUpdates = { events: { code: "42501", message: "new row violates row-level security policy" } };
    const refused = setup({ world, rules: { assistant: { tools: ON } } });
    const t = ticketOf(await run(refused.ctx, "events.set_status", { event_id: EV.diwali, status: "live" }));
    const r = await confirmProposal(refused.ctx, t.proposalId, t.inputHash);
    expect(r).toMatchObject({ ok: false, error: "Could not change the event status — you don't have permission to make this change." });
  });
});

// ---------------------------------------------------------------------------
describe("events.set_rsvp_status", () => {
  it("asks first, with the family as a household card of adults and the people counted", async () => {
    const { ctx, db } = setup({ via: "assistant", rules: { assistant: { tools: ON } } });
    const r = await run(ctx, "events.set_rsvp_status", { event_id: EV.diwali, rsvp_id: EV.rsvpShah, status: "cancelled" });
    const t = ticketOf(r);
    expect(t.preview.summary).toBe("Mark the Priya Shah household's RSVP for Diwali Dinner as cancelled.");
    expect(t.preview.lines).toEqual([
      { label: "RSVP", before: "RSVP'd", after: "cancelled" },
      { label: "People on it", value: "2" },
    ]);
    expect(t.preview.households![0].adults).toEqual(["Priya Shah", "Rahul Shah"]);
    expect(t.preview.warnings).toEqual(["The family is not told automatically."]);
    expect(db.rpcCalls.some((c) => c.fn === "event_set_rsvp_status")).toBe(false);
    expect(leaks(r)).toEqual([]);
  });

  it("warns about people who have already arrived", async () => {
    const { ctx } = setup({ rules: { assistant: { tools: ON } } });
    const t = ticketOf(await run(ctx, "events.set_rsvp_status", { event_id: EV.diwali, rsvp_id: EV.rsvpPatel, status: "no_show" }));
    expect(t.preview.warnings).toEqual(["1 person on this RSVP has already been checked in and will keep their status."]);
  });

  it("changes the RSVP and the people on it in one database step, and says it in the screen's words", async () => {
    const { ctx, db } = setup({ rules: { assistant: { tools: ON } } });
    const t = ticketOf(await run(ctx, "events.set_rsvp_status", { event_id: EV.diwali, rsvp_id: EV.rsvpShah, status: "confirmed" }));
    expect(await confirmProposal(ctx, t.proposalId, t.inputHash)).toMatchObject({ ok: true, message: "RSVP confirmed.", data: { rsvp_id: EV.rsvpShah, status: "confirmed" } });
    expect(db.rpcCalls.filter((c) => c.fn === "event_set_rsvp_status")).toEqual([{ fn: "event_set_rsvp_status", args: { p_event: EV.diwali, p_rsvp: EV.rsvpShah, p_status: "confirmed" } }]);
    // The two old writes are gone: nothing is updated through the table.
    expect(db.calls.some((c) => c.op === "update")).toBe(false);
    for (const [status, message] of [["rsvpd", "RSVP reopened."], ["no_show", "RSVP marked no-show."], ["waitlisted", "RSVP waitlisted."], ["cancelled", "RSVP cancelled."]] as const) {
      expect(await setRsvpStatusCommand.execute!(ctx, { event_id: EV.diwali, rsvp_id: EV.rsvpShah, status })).toMatchObject({ ok: true, message });
    }
  });

  it("says when the RSVP is not on this event, and when the database would not change it", async () => {
    const { ctx } = setup();
    expect(await run(ctx, "events.set_rsvp_status", { event_id: EV.garba, rsvp_id: EV.rsvpShah, status: "cancelled" })).toMatchObject({ ok: false, error: "That RSVP was not found on this event, or you can't see it." });
    // The function answers false when the caller may not change that RSVP.
    await expect(setRsvpStatusCommand.execute!(ctx, { event_id: EV.garba, rsvp_id: EV.rsvpShah, status: "cancelled" })).rejects.toMatchObject({ message: "Could not update the RSVP — you can't change this RSVP." });
  });

  it("is allowed for event staff of that event only", async () => {
    const grant = (scope_id: string) => [{ center_id: "center-1", user_id: "user-1", role_key: "checkin_volunteer", scope_kind: "event", scope_id, starts_at: "2026-01-01T00:00:00Z", ends_at: null }];
    const ok = setup({ permissions: ["events.view"], grants: grant(EV.diwali) });
    expect(await setRsvpStatusCommand.execute!(ok.ctx, { event_id: EV.diwali, rsvp_id: EV.rsvpShah, status: "confirmed" })).toMatchObject({ ok: true });
    const no = setup({ permissions: ["events.view"] });
    await expect(setRsvpStatusCommand.execute!(no.ctx, { event_id: EV.diwali, rsvp_id: EV.rsvpShah, status: "confirmed" })).rejects.toMatchObject({ message: "Could not update the RSVP — only event staff can change RSVPs." });
  });
});

// ---------------------------------------------------------------------------
describe("events.assign_volunteer", () => {
  it("reads one id or several, and says what is wrong", () => {
    const a = "8e300000-0000-4000-8000-000000000001";
    expect(parsePersonIds(a)).toEqual({ ok: true, ids: [a] });
    expect(parsePersonIds(`${a}, ${a.toUpperCase()}\n8e300000-0000-4000-8000-000000000009`)).toEqual({ ok: true, ids: [a, "8e300000-0000-4000-8000-000000000009"] });
    expect(parsePersonIds("  ")).toEqual({ ok: false, error: "choose who to assign." });
    expect(parsePersonIds("Priya")).toEqual({ ok: false, error: "one of the people is not a valid id. Find them with a search first." });
    expect(parsePersonIds(Array.from({ length: 51 }, (_, i) => `8e300000-0000-4000-8000-${String(i).padStart(12, "0")}`).join(","))).toMatchObject({ ok: false });
  });

  it("asks first, with the shift, the spots and the volunteer's household card", async () => {
    const { ctx, inserts } = setup({ via: "assistant", rules: { assistant: { tools: ON } } });
    const r = await run(ctx, "events.assign_volunteer", { event_id: EV.diwali, shift_id: EV.shiftFood, person_ids: EV.adult });
    const t = ticketOf(r);
    expect(t.preview.summary).toBe("Assign Meera Joshi to the food shift at Diwali Dinner.");
    expect(t.preview.lines).toEqual([
      { label: "Shift", value: "Food, Sat, Oct 24, 5:00 PM" },
      { label: "Spots filled", before: "0 of 2", after: "1 of 2" },
    ]);
    expect(t.preview.households).toHaveLength(1);
    expect(t.preview.households![0].adults).toEqual(["Meera Joshi"]);
    expect(inserts).toEqual([]);
    expect(leaks(r)).toEqual([]);
  });

  it("warns when someone is already on the shift or the shift is full", async () => {
    const { ctx, world } = setup({ rules: { assistant: { tools: ON } } });
    world.tables.volunteer_assignments = [
      { id: "va-1", shift_id: EV.shiftFood, person_id: EV.adult, status: "assigned" },
      { id: "va-2", shift_id: EV.shiftFood, person_id: "someone", status: "confirmed" },
    ];
    const t = ticketOf(await run(ctx, "events.assign_volunteer", { event_id: EV.diwali, shift_id: EV.shiftFood, person_ids: EV.adult }));
    expect(t.preview.warnings).toEqual(["Meera Joshi is already on this shift."]);
  });

  it("will not take anyone under 18, or anyone whose age it cannot tell, from Niva, and does not name them", async () => {
    const { ctx } = setup({ via: "assistant", rules: { assistant: { tools: ON } } });
    for (const person_ids of [EV.minor, EV.noDob, `${EV.adult},${EV.minor}`]) {
      const r = await run(ctx, "events.assign_volunteer", { event_id: EV.diwali, shift_id: EV.shiftFood, person_ids });
      expect(r, person_ids).toMatchObject({ ok: false, error: "Niva does not work with anyone under 18. Assign young volunteers on the Volunteers screen." });
      expect(leaks(r)).toEqual([]);
    }
    // A screen is the person's own hands: the same person can be assigned there.
    const screen = setup({ via: "screen" });
    expect(await run(screen.ctx, "events.assign_volunteer", { event_id: EV.diwali, shift_id: EV.shiftFood, person_ids: EV.minor })).toMatchObject({ ok: true, needsConfirmation: true });
  });

  it("refuses a shift that belongs to another event, and a person who is not there", async () => {
    const { ctx } = setup({ rules: { assistant: { tools: ON } } });
    expect(await run(ctx, "events.assign_volunteer", { event_id: EV.diwali, shift_id: EV.shiftOther, person_ids: EV.adult })).toMatchObject({ ok: false, error: "That shift was not found on this event, or you can't see it." });
    expect(await run(ctx, "events.assign_volunteer", { event_id: EV.diwali, shift_id: EV.shiftFood, person_ids: "8e300000-0000-4000-8000-0000000000ff" })).toMatchObject({ ok: false, error: "One of those people was not found, or you can't see them." });
  });

  it("assigns once confirmed, in one insert, and says so in the screen's words", async () => {
    const { ctx, inserts } = setup({ rules: { assistant: { tools: ON } } });
    const t = ticketOf(await run(ctx, "events.assign_volunteer", { event_id: EV.diwali, shift_id: EV.shiftFood, person_ids: EV.adult }));
    expect(await confirmProposal(ctx, t.proposalId, t.inputHash)).toMatchObject({ ok: true, message: "Volunteer assigned." });
    expect(inserts).toEqual([{ table: "volunteer_assignments", rows: [{ center_id: "center-1", shift_id: EV.shiftFood, person_id: EV.adult }] }]);
    const many = await assignVolunteerCommand.execute!(ctx, { event_id: EV.diwali, shift_id: EV.shiftFood, person_ids: `${EV.adult},${EV.minor}` });
    expect(many).toMatchObject({ ok: true, message: "2 volunteers assigned." });
    expect(inserts[1].rows).toHaveLength(2);
  });

  it("explains a database refusal and does not say it assigned", async () => {
    const { ctx, db } = setup({ rules: { assistant: { tools: ON } } });
    recordInserts(db as unknown as { from: (t: string) => unknown }, { fail: { code: "23505", message: "duplicate key value violates unique constraint" } });
    const t = ticketOf(await run(ctx, "events.assign_volunteer", { event_id: EV.diwali, shift_id: EV.shiftFood, person_ids: EV.adult }));
    const r = await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/^Could not assign the volunteer — /);
    expect(JSON.stringify(r)).not.toMatch(/Volunteer assigned/);
  });

  it("is allowed for the event's lead and the volunteer staff, and nobody else", async () => {
    const input = { event_id: EV.diwali, shift_id: EV.shiftFood, person_ids: EV.adult };
    const grant = [{ center_id: "center-1", user_id: "user-1", role_key: "event_lead", scope_kind: "event", scope_id: EV.diwali, starts_at: "2026-01-01T00:00:00Z", ends_at: null }];
    expect(await assignVolunteerCommand.execute!(setup({ permissions: ["events.view"], grants: grant }).ctx, input)).toMatchObject({ ok: true });
    expect(await assignVolunteerCommand.execute!(setup({ permissions: ["volunteers.manage"] }).ctx, input)).toMatchObject({ ok: true });
    await expect(assignVolunteerCommand.execute!(setup({ permissions: ["events.view"] }).ctx, input)).rejects.toMatchObject({
      message: "Could not assign the volunteer — only this event's lead or the volunteer coordinator can assign volunteers.",
    });
  });
});

// ---------------------------------------------------------------------------
describe("events.clone_draft and events.create_from_clone", () => {
  it("prepares last year's event on a new day and writes nothing", async () => {
    const { ctx, db, inserts } = setup({ via: "assistant" });
    const r = await run(ctx, "events.clone_draft", { find: "Old Picnic", new_date: "2027-06-01" });
    const d = dataOf<{ source: { id: string; name: string }; prepared: { name: string; starts: string; venue: string; capacity: string; status: string }; left_out: string[]; notes: string[]; alternatives: unknown[] }>(r);
    expect(d.source).toMatchObject({ id: EV.picnic, name: "Old Picnic" });
    expect(d.prepared).toMatchObject({ name: "Old Picnic", starts: "Tue, Jun 1, 12:00 PM", venue: "Park", capacity: "50", status: "Draft" });
    expect(d.left_out).toContain("RSVPs and attendees");
    expect(d.notes.join(" ")).toContain("same name");
    expect((r as Ok).message).toBe("This is only prepared. Nothing has been saved.");
    expect(inserts).toEqual([]);
    expect(db.calls.some((c) => c.op === "update")).toBe(false);
  });

  it("finds the most recent earlier event with that name, and names the others it passed over", async () => {
    const { ctx, world } = setup();
    world.tables.events.push({ ...world.tables.events.find((e) => e.id === EV.picnic)!, id: "older-picnic", name: "Old Picnic 2024", starts_at: "2024-06-01T17:00:00Z" });
    const d = dataOf<{ source: { name: string }; alternatives: { id: string; name: string }[] }>(await run(ctx, "events.clone_draft", { find: "picnic", new_date: "2027-06-01" }));
    expect(d.source.name).toBe("Old Picnic");
    expect(d.alternatives.map((a) => a.id)).toEqual(["older-picnic"]);
  });

  it("copies an event by id, and says when nothing matches or no event is named", async () => {
    const { ctx } = setup();
    expect(dataOf<{ prepared: { name: string } }>(await run(ctx, "events.clone_draft", { event_id: EV.diwali, new_date: "2027-11-01", name: "Diwali Mahotsav" })).prepared.name).toBe("Diwali Mahotsav");
    expect(await run(ctx, "events.clone_draft", { find: "Holi", new_date: "2027-03-01" })).toMatchObject({ ok: false, error: 'No earlier event with "Holi" in its name was found before 2027-03-01. Check the name, or give the event\'s id.' });
    expect(await run(ctx, "events.clone_draft", { new_date: "2027-03-01" })).toMatchObject({ ok: false, error: "Say which event to copy: give its id, or part of its name." });
    expect(await run(ctx, "events.clone_draft", { event_id: EV.missing, new_date: "2027-03-01" })).toMatchObject({ ok: false, error: "That event was not found, or you can't see it." });
    expect(await run(ctx, "events.clone_draft", { event_id: EV.diwali, new_date: "2027-13-01" })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("saves it as a draft once the person confirms, through the builder's own insert", async () => {
    const { ctx, inserts } = setup({ rules: { assistant: { tools: ON } } });
    const t = ticketOf(await run(ctx, "events.create_from_clone", { source_event_id: EV.diwali, new_date: "2027-11-01" }));
    expect(t.preview.summary).toContain("Create a draft called Diwali Dinner on");
    expect(t.preview.warnings![0]).toBe("It is saved as a draft: members cannot see it and nothing is sent. You publish it in the event builder.");
    expect(inserts).toEqual([]);
    const r = await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(r).toMatchObject({ ok: true, data: { id: EV.newEvent, builder_path: `/events/builder?event=${EV.newEvent}` } });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("events");
    expect(inserts[0].rows).toMatchObject({ center_id: "center-1", created_by: "user-1", status: "draft", name: "Diwali Dinner", venue: "Main Hall", capacity: 300, audience: "members_and_guests" });
    expect(revalidatePath).toHaveBeenCalledWith("/events", "layout");
  });

  it("is for event managers, and does not say it created anything when the database refused", async () => {
    const lead = setup({ permissions: ["events.view"] });
    await expect(createFromClone.execute!(lead.ctx, { source_event_id: EV.diwali, new_date: "2027-11-01" })).rejects.toMatchObject({
      message: "Could not create the draft event — only event managers can create events.",
    });
    const { ctx, db } = setup({ rules: { assistant: { tools: ON } } });
    recordInserts(db as unknown as { from: (t: string) => unknown }, { fail: { code: "42501", message: "new row violates row-level security policy" } });
    const t = ticketOf(await run(ctx, "events.create_from_clone", { source_event_id: EV.diwali, new_date: "2027-11-01" }));
    const r = await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(r).toMatchObject({ ok: false, error: "Could not create the draft event — you don't have permission to make this change." });
  });
});

// ---------------------------------------------------------------------------
describe("events.draft_change and events.set_field with the new details", () => {
  it("moves the event to another day and keeps its times of day", async () => {
    const { ctx, db } = setup({ rules: { assistant: { tools: ON } } });
    const d = dataOf<{ before: string; after: string; label: string }>(await run(ctx, "events.draft_change", { event_id: EV.diwali, field: "date", value: "2026-11-08" }));
    expect(d).toMatchObject({ label: "Date", before: "Sat, Oct 24, 6:30 PM", after: "Sun, Nov 8, 6:30 PM" });
    const t = ticketOf(await run(ctx, "events.set_field", { event_id: EV.diwali, field: "date", value: "2026-11-08" }));
    await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(db.calls.find((c) => c.op === "update")!.patch).toEqual({ starts_at: "2026-11-09T00:30:00.000Z", ends_at: "2026-11-09T03:00:00.000Z" });
  });

  it("changes a time, and who can RSVP, with a word for what members would notice", async () => {
    const { ctx, db } = setup({ rules: { assistant: { tools: ON } } });
    expect(dataOf<{ after: string }>(await run(ctx, "events.draft_change", { event_id: EV.diwali, field: "start_time", value: "5:30 pm" })).after).toBe("Sat, Oct 24, 5:30 PM");
    const t = ticketOf(await run(ctx, "events.set_field", { event_id: EV.diwali, field: "audience", value: "members" }));
    expect(t.preview.lines).toEqual([{ label: "Who can RSVP", before: "Everyone (members and their guests)", after: "Members only" }]);
    expect(t.preview.warnings![0]).toContain("This changes who can see the event and RSVP in the app.");
    await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(db.calls.find((c) => c.op === "update")!.patch).toEqual({ audience: "members_only" });
  });

  it("refuses a finished event and a time that breaks the order, in a sentence", async () => {
    const { ctx } = setup();
    expect(await run(ctx, "events.draft_change", { event_id: EV.picnic, field: "date", value: "2026-11-08" })).toMatchObject({ ok: false, error: expect.stringContaining("is completed, so Niva will not change it") });
    expect(await run(ctx, "events.draft_change", { event_id: EV.diwali, field: "end_time", value: "5 pm" })).toMatchObject({ ok: false, error: "The event must end after it starts. Change the end time as well, or choose a later one." });
  });
});
