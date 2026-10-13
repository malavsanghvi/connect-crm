import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { revalidatePath } from "next/cache";

import { addToEvent, loadAddChoices, type AddInput } from "@/lib/people-v2/event-add-server";

import { MANAGER, VIEWER, W, context, leadOf, world, type Hooks } from "./people-event-add-world";

// Adding a family's people to an event: what is read, what is written, and what is said when it cannot be done. The database is a fake that
// keeps its rows, so each test looks at what was really written.

const add = (over: Partial<AddInput> = {}): AddInput => ({ householdId: W.hh, eventId: W.picnic, personIds: [W.samira, W.layla], ...over });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(revalidatePath).mockClear();
});

describe("the events a role may add to", () => {
  it("lists upcoming published, closed and live events, soonest first, and nothing else", async () => {
    const { ctx } = context();
    const r = await loadAddChoices(ctx, { householdId: W.hh });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The camp started two days ago and runs until Wednesday: still upcoming. A draft, a cancelled one and last week's are not offered.
    expect(r.events.map((e) => e.name)).toEqual(["Weekend camp", "Spring Picnic", "Cleanup 春の清掃", "Годовой вечер"]);
  });

  it("says, for each, what the community's own rules say: the limit, the places taken, the waitlist, who it is for, and the note about closed RSVPs", async () => {
    const w = world();
    w.tables.events.find((e) => e.id === W.picnic)!.audience = "members_only";
    w.tables.rsvps.push({ id: "other", center_id: W.center, event_id: W.gala, household_id: W.hhOther, status: "rsvpd", source: "app", created_at: "2026-10-01T00:00:00Z" });
    w.tables.attendees.push(
      { id: "a1", rsvp_id: "other", status: "rsvpd", person_id: null },
      { id: "a2", rsvp_id: "other", status: "rsvpd", person_id: null },
      { id: "a3", rsvp_id: "other", status: "cancelled", person_id: null },
    );
    const { ctx } = context(w);
    const r = await loadAddChoices(ctx, { householdId: W.hh });
    if (!r.ok) throw new Error(r.error);
    const by = (id: string) => r.events.find((e) => e.id === id)!;
    expect(by(W.gala)).toMatchObject({ capacity: 5, waitlist: true, seatsTaken: 2, problem: null });
    expect(by(W.picnic)).toMatchObject({ capacity: null, seatsTaken: null, audience: "For members", note: null });
    expect(by(W.camp).note).toMatch(/closed/);
  });

  it("shows this family's RSVP on an event and who is on it, a released ticket not counted", async () => {
    const w = world();
    w.tables.rsvps.push(
      { id: W.rsvpExisting, center_id: W.center, event_id: W.picnic, household_id: W.hh, status: "confirmed", source: "app", created_at: "2026-10-02T00:00:00Z" },
      { id: "cancelled-one", center_id: W.center, event_id: W.gala, household_id: W.hh, status: "cancelled", source: "app", created_at: "2026-10-02T00:00:00Z" },
    );
    w.tables.attendees.push(
      { id: "a1", rsvp_id: W.rsvpExisting, person_id: W.samira, status: "confirmed" },
      { id: "a2", rsvp_id: W.rsvpExisting, person_id: W.layla, status: "cancelled" },
      { id: "a3", rsvp_id: W.rsvpExisting, person_id: null, status: "confirmed" },
    );
    const { ctx } = context(w);
    const r = await loadAddChoices(ctx, { householdId: W.hh });
    if (!r.ok) throw new Error(r.error);
    expect(r.events.find((e) => e.id === W.picnic)!.existing).toEqual({ rsvpId: W.rsvpExisting, status: "confirmed", personIds: [W.samira] });
    // A cancelled RSVP is not "an RSVP of this family".
    expect(r.events.find((e) => e.id === W.gala)!.existing).toBeNull();
  });

  it("offers an event's lead only that event, and a role without the gate nothing at all (no reads)", async () => {
    const lead = context(world(), {}, leadOf(W.tiny));
    const r = await loadAddChoices(lead.ctx, { householdId: W.hh });
    if (!r.ok) throw new Error(r.error);
    expect(r.events.map((e) => e.id)).toEqual([W.tiny]);

    const viewer = context(world(), {}, VIEWER);
    expect(await loadAddChoices(viewer.ctx, { householdId: W.hh })).toEqual({ ok: false, kind: "access", error: "You don't have access to this area" });
    expect(viewer.db.calls).toEqual([]);
  });

  it("says plainly when the family is not found or was merged into another", async () => {
    const { ctx } = context();
    expect(await loadAddChoices(ctx, { householdId: "9b000000-0000-4000-8000-000000000999" })).toMatchObject({ ok: false, kind: "other", error: expect.stringContaining("family was not found") });
    const merged = await loadAddChoices(ctx, { householdId: W.hhMerged });
    expect(merged).toMatchObject({ ok: false, kind: "other" });
    expect(!merged.ok && merged.error).toMatch(/^Could not load the events — this family was merged into another one/);
    expect(await loadAddChoices(ctx, { householdId: "not-a-uuid" })).toMatchObject({ ok: false, error: "Could not load the events — the family was not found." });
  });

  it("explains a failed read in words, and logs the detail", async () => {
    const w = world();
    const { ctx } = context({ ...w, failTables: { events: { code: "42501", message: "permission denied for table events" } } } as typeof w);
    const r = await loadAddChoices(ctx, { householdId: W.hh });
    expect(r).toEqual({ ok: false, kind: "other", error: "Could not load the events — you don't have permission to make this change." });
    expect(console.error).toHaveBeenCalled();
  });

  it("does not offer an event whose places it cannot count, and says why", async () => {
    const { ctx } = context(world(), { failSummary: true });
    const r = await loadAddChoices(ctx, { householdId: W.hh });
    if (!r.ok) throw new Error(r.error);
    expect(r.events.find((e) => e.id === W.gala)).toMatchObject({ seatsTaken: null, problem: "Could not check how many places are left. Try again in a moment." });
    // An event with no limit needs no count.
    expect(r.events.find((e) => e.id === W.picnic)!.problem).toBeNull();
  });
});

describe("adding people to an event", () => {
  it("makes the family's RSVP and one ticket per person, with no pledge and no money", async () => {
    const { ctx, writes, world: w } = context();
    const r = await addToEvent(ctx, add());
    expect(r).toMatchObject({ ok: true, outcome: "created", status: "rsvpd", waitlisted: false, message: "Samira and Layla are on Spring Picnic.", toast: "Added Samira and Layla to Spring Picnic.", added: [W.samira, W.layla], already: [] });

    expect(w.tables.rsvps).toHaveLength(1);
    expect(w.tables.rsvps[0]).toMatchObject({ center_id: W.center, event_id: W.picnic, household_id: W.hh, status: "rsvpd", confirmed_at: null, commitment_mode: "none", source: "admin" });
    // Nothing about money, or about who submitted it, is written.
    expect(Object.keys(w.tables.rsvps[0])).not.toEqual(expect.arrayContaining(["commitment_pledge_id"]));
    expect(writes.map((x) => x.table)).toEqual(["rsvps", "attendees"]);
    expect(w.tables.attendees.map((a) => [a.person_id, a.display_name, a.rsvp_id, a.status])).toEqual([
      [W.samira, "Samira Hassan", w.tables.rsvps[0].id, "rsvpd"],
      [W.layla, "Layla Hassan", w.tables.rsvps[0].id, "rsvpd"],
    ]);
    expect(revalidatePath).toHaveBeenCalledWith(`/households/${W.hh}`);
  });

  it("works out the two flags from the birth date and the day of the event, and never guesses", async () => {
    const { ctx, world: w } = context();
    const r = await addToEvent(ctx, add({ personIds: [W.layla, W.omar, W.grandpa, W.samira] }));
    expect(r.ok).toBe(true);
    const flags = Object.fromEntries(w.tables.attendees.map((a) => [a.person_id, [a.is_child_under_12, a.is_senior]]));
    // Layla turns nine on the 19th; the picnic is the 18th. Omar has no birth date: neither flag. Yusuf turns 65 on the day.
    expect(flags).toEqual({ [W.layla]: [true, false], [W.omar]: [false, false], [W.grandpa]: [false, true], [W.samira]: [false, false] });
  });

  it("reckons the day of the event in the community's time zone (an evening event is that day, not the next in UTC)", async () => {
    const w = world();
    // 7pm on the 18th in Chicago is the 19th in UTC: Layla turns nine on the 19th, so on the 18th she is eight; both are under 12 either way,
    // so use the senior boundary: Yusuf turns 65 on the 18th.
    w.tables.events.find((e) => e.id === W.picnic)!.starts_at = "2026-10-19T00:30:00Z";
    const { ctx, world: db } = context(w);
    await addToEvent(ctx, add({ personIds: [W.grandpa] }));
    expect(db.tables.attendees[0]).toMatchObject({ is_senior: true });
  });

  it("makes the RSVP confirmed, and its tickets confirmed, when staff say the family already said yes", async () => {
    const { ctx, world: w } = context();
    const r = await addToEvent(ctx, add({ confirmed: true }));
    expect(r).toMatchObject({ ok: true, status: "confirmed", message: "Samira and Layla are on Spring Picnic, confirmed." });
    expect(w.tables.rsvps[0]).toMatchObject({ status: "confirmed", confirmed_at: "2026-10-12T15:00:00.000Z" });
    expect(w.tables.attendees.every((a) => a.status === "confirmed")).toBe(true);
  });

  it("uses the family's live RSVP for the event: no second RSVP, the new people are added to it and keep its status", async () => {
    const w = world();
    w.tables.rsvps.push({ id: W.rsvpExisting, center_id: W.center, event_id: W.picnic, household_id: W.hh, status: "confirmed", source: "app", created_at: "2026-10-02T00:00:00Z" });
    w.tables.attendees.push({ id: "a1", rsvp_id: W.rsvpExisting, person_id: W.samira, status: "confirmed", checked_in_at: null });
    const { ctx, writes } = context(w);
    const r = await addToEvent(ctx, add({ confirmed: false }));
    expect(r).toMatchObject({ ok: true, outcome: "extended", status: "confirmed", added: [W.layla], already: [W.samira], message: "Added Layla to Spring Picnic, on the family's RSVP. Samira is already on it." });
    expect(writes.filter((x) => x.table === "rsvps")).toEqual([]);
    expect(w.tables.rsvps).toHaveLength(1);
    expect(w.tables.attendees).toHaveLength(2);
    expect(w.tables.attendees[1]).toMatchObject({ rsvp_id: W.rsvpExisting, person_id: W.layla, status: "confirmed" });
  });

  it("ignores a cancelled RSVP and makes a new one", async () => {
    const w = world();
    w.tables.rsvps.push({ id: W.rsvpExisting, center_id: W.center, event_id: W.picnic, household_id: W.hh, status: "cancelled", source: "app", created_at: "2026-10-02T00:00:00Z" });
    const { ctx } = context(w);
    const r = await addToEvent(ctx, add());
    expect(r).toMatchObject({ ok: true, outcome: "created" });
    expect(w.tables.rsvps).toHaveLength(2);
    expect(w.tables.attendees.every((a) => a.rsvp_id !== W.rsvpExisting)).toBe(true);
  });

  it("with two live RSVPs (the database allows it) uses the earliest, always the same one", async () => {
    const w = world();
    w.tables.rsvps.push(
      { id: "second", center_id: W.center, event_id: W.picnic, household_id: W.hh, status: "rsvpd", source: "app", created_at: "2026-10-03T00:00:00Z" },
      { id: "first", center_id: W.center, event_id: W.picnic, household_id: W.hh, status: "rsvpd", source: "app", created_at: "2026-10-02T00:00:00Z" },
    );
    const { ctx } = context(w);
    const r = await addToEvent(ctx, add());
    expect(r).toMatchObject({ ok: true, outcome: "extended" });
    expect(w.tables.attendees.every((a) => a.rsvp_id === "first")).toBe(true);
  });

  it("says plainly that they were already on it, and writes nothing", async () => {
    const w = world();
    w.tables.rsvps.push({ id: W.rsvpExisting, center_id: W.center, event_id: W.picnic, household_id: W.hh, status: "rsvpd", source: "app", created_at: "2026-10-02T00:00:00Z" });
    w.tables.attendees.push(
      { id: "a1", rsvp_id: W.rsvpExisting, person_id: W.samira, status: "rsvpd", checked_in_at: null },
      { id: "a2", rsvp_id: W.rsvpExisting, person_id: W.layla, status: "rsvpd", checked_in_at: null },
    );
    const { ctx, writes } = context(w);
    const r = await addToEvent(ctx, add());
    expect(r).toMatchObject({ ok: true, outcome: "unchanged", message: "Samira and Layla are already on Spring Picnic. Nothing was changed.", added: [], already: [W.samira, W.layla] });
    expect(writes).toEqual([]);
  });

  it("gives a released ticket back instead of adding a second row for the same person", async () => {
    const w = world();
    w.tables.rsvps.push({ id: W.rsvpExisting, center_id: W.center, event_id: W.picnic, household_id: W.hh, status: "confirmed", source: "app", created_at: "2026-10-02T00:00:00Z" });
    w.tables.attendees.push(
      { id: "a1", center_id: W.center, rsvp_id: W.rsvpExisting, person_id: W.samira, status: "confirmed", checked_in_at: null },
      { id: "a2", center_id: W.center, rsvp_id: W.rsvpExisting, person_id: W.layla, status: "cancelled", ticket_revoked: true, checked_in_at: null },
    );
    const { ctx } = context(w);
    const r = await addToEvent(ctx, add());
    expect(r).toMatchObject({ ok: true, outcome: "extended", added: [W.layla] });
    expect(w.tables.attendees).toHaveLength(2);
    expect(w.tables.attendees[1]).toMatchObject({ id: "a2", status: "confirmed", ticket_revoked: false, is_child_under_12: true });
  });

  it("goes on the waitlist when the event is full and has one: the RSVP and the people wait together", async () => {
    const w = world();
    w.tables.rsvps.push({ id: "taken", center_id: W.center, event_id: W.gala, household_id: W.hhOther, status: "confirmed", source: "app", created_at: "2026-10-01T00:00:00Z" });
    w.tables.attendees.push(...Array.from({ length: 4 }, (_, i) => ({ id: `t${i}`, rsvp_id: "taken", status: "confirmed", person_id: null })));
    const { ctx } = context(w);
    const r = await addToEvent(ctx, add({ eventId: W.gala, confirmed: true }));
    expect(r).toMatchObject({ ok: true, outcome: "created", status: "waitlisted", waitlisted: true, message: "Samira and Layla are on the waitlist for Годовой вечер." });
    expect(w.tables.rsvps[1]).toMatchObject({ status: "waitlisted", confirmed_at: null });
    expect(w.tables.attendees.slice(4).every((a) => a.status === "waitlisted")).toBe(true);
  });

  it("refuses, with nothing written, when the event is full and cannot wait", async () => {
    const w = world();
    w.tables.rsvps.push({ id: "taken", center_id: W.center, event_id: W.tiny, household_id: W.hhOther, status: "rsvpd", source: "app", created_at: "2026-10-01T00:00:00Z" });
    w.tables.attendees.push(...Array.from({ length: 2 }, (_, i) => ({ id: `t${i}`, rsvp_id: "taken", status: "rsvpd", person_id: null })));
    const { ctx, writes } = context(w);
    const r = await addToEvent(ctx, add({ eventId: W.tiny }));
    expect(r).toEqual({
      ok: false,
      kind: "full",
      error: "Cleanup 春の清掃 has room for 1 more person, and 2 were chosen. Choose fewer people, or ask an event manager to raise the limit or turn on the waitlist.",
    });
    expect(writes).toEqual([]);
    // One person fits.
    expect(await addToEvent(ctx, add({ eventId: W.tiny, personIds: [W.samira] }))).toMatchObject({ ok: true });
  });

  it("refuses to add too many to a live RSVP even when the event has a waitlist", async () => {
    const w = world();
    w.tables.rsvps.push({ id: W.rsvpExisting, center_id: W.center, event_id: W.gala, household_id: W.hh, status: "rsvpd", source: "app", created_at: "2026-10-02T00:00:00Z" });
    w.tables.attendees.push({ id: "a1", rsvp_id: W.rsvpExisting, person_id: W.samira, status: "rsvpd", checked_in_at: null }, ...Array.from({ length: 3 }, (_, i) => ({ id: `t${i}`, rsvp_id: W.rsvpExisting, status: "rsvpd", person_id: null })));
    const { ctx } = context(w);
    const r = await addToEvent(ctx, add({ eventId: W.gala, personIds: [W.layla, W.omar] }));
    expect(r).toMatchObject({ ok: false, kind: "full" });
    expect(w.tables.attendees).toHaveLength(4);
  });

  it("turns a role without the gate away, and an event's lead from any other event, before reading or writing anything", async () => {
    const viewer = context(world(), {}, VIEWER);
    expect(await addToEvent(viewer.ctx, add())).toEqual({ ok: false, kind: "access", error: "You don't have access to this area" });
    expect(viewer.db.calls).toEqual([]);
    expect(viewer.writes).toEqual([]);

    const lead = context(world(), {}, leadOf(W.tiny));
    expect(await addToEvent(lead.ctx, add({ eventId: W.picnic }))).toMatchObject({ ok: false, kind: "access" });
    expect(await addToEvent(lead.ctx, add({ eventId: W.tiny, personIds: [W.samira] }))).toMatchObject({ ok: true });
  });

  it("takes only the people who are in this family now, alive and not merged", async () => {
    const w = world();
    const { ctx, writes } = context(w);
    const notHere = await addToEvent(ctx, add({ personIds: [W.samira, W.stranger] }));
    expect(notHere).toMatchObject({ ok: false, kind: "other", error: expect.stringContaining("not in this family any more") });
    const dead = await addToEvent(ctx, add({ personIds: [W.karim] }));
    expect(dead).toEqual({ ok: false, kind: "other", error: "Could not add them to the event — Karim Hassan is recorded as deceased." });
    w.tables.people.find((p) => p.id === W.omar)!.merged_into_id = W.layla;
    expect(await addToEvent(ctx, add({ personIds: [W.omar] }))).toMatchObject({ ok: false, error: "Could not add them to the event — Omar Hassan was merged into another record." });
    expect(writes).toEqual([]);
  });

  it("will not add to an event that is a draft, cancelled, finished or over, in words that say which", async () => {
    const { ctx, writes } = context();
    expect(await addToEvent(ctx, add({ eventId: W.draft }))).toMatchObject({ ok: false, error: expect.stringMatching(/Not announced is draft\. People can be added to an event that is published, closed for RSVPs or under way\.$/) });
    expect(await addToEvent(ctx, add({ eventId: W.cancelled }))).toMatchObject({ ok: false, error: expect.stringContaining("Called off is cancelled") });
    expect(await addToEvent(ctx, add({ eventId: W.past }))).toEqual({ ok: false, kind: "other", error: "Could not add them to the event — Last week is over." });
    expect(await addToEvent(ctx, add({ eventId: "9b000000-0000-4000-8000-000000000998" }))).toMatchObject({ ok: false, error: expect.stringContaining("event was not found") });
    expect(writes).toEqual([]);
  });

  it("will not add to a merged family", async () => {
    const { ctx, writes } = context();
    const r = await addToEvent(ctx, add({ householdId: W.hhMerged }));
    expect(r).toMatchObject({ ok: false, kind: "other" });
    expect(!r.ok && r.error).toMatch(/merged into another one/);
    expect(writes).toEqual([]);
  });

  it("refuses what it cannot read: no people, too many, a bad id", async () => {
    const { ctx, writes } = context();
    expect(await addToEvent(ctx, add({ personIds: [] }))).toEqual({ ok: false, kind: "other", error: "Could not add them to the event — choose at least one person." });
    expect(await addToEvent(ctx, add({ personIds: ["nope"] }))).toMatchObject({ ok: false, error: "Could not add them to the event — the people chosen were not understood." });
    expect(await addToEvent(ctx, add({ eventId: "nope" }))).toMatchObject({ ok: false, error: "Could not add them to the event — the family or the event was not found." });
    expect(await addToEvent(ctx, add({ personIds: Array.from({ length: 41 }, (_, i) => `9b000000-0000-4000-8000-${String(5000 + i).padStart(12, "0")}`) }))).toMatchObject({ ok: false });
    expect(writes).toEqual([]);
  });

  it("keeps a name in any script as it is, and says the first name", async () => {
    const { ctx, world: w } = context();
    const r = await addToEvent(ctx, add({ personIds: [W.tanaka] }));
    expect(r).toMatchObject({ ok: true, message: "美咲 is on Spring Picnic." });
    expect(w.tables.attendees[0]).toMatchObject({ display_name: "美咲 田中", person_id: W.tanaka });
  });

  it("does not trust the browser: it counts the places and finds the RSVP itself", async () => {
    // Nothing in the input says how many places are left or whether an RSVP exists; a full event refuses whatever the browser believed.
    const w = world();
    w.tables.rsvps.push({ id: "taken", center_id: W.center, event_id: W.tiny, household_id: W.hhOther, status: "rsvpd", source: "app", created_at: "2026-10-01T00:00:00Z" });
    w.tables.attendees.push(...Array.from({ length: 3 }, (_, i) => ({ id: `t${i}`, rsvp_id: "taken", status: "rsvpd", person_id: null })));
    const { ctx } = context(w);
    expect(await addToEvent(ctx, add({ eventId: W.tiny, personIds: [W.samira] }))).toMatchObject({ ok: false, kind: "full" });
  });
});

describe("when the database says no", () => {
  const failing = (hooks: Hooks, w = world()) => context(w, hooks);

  it("does not say it added anyone when the RSVP could not be made", async () => {
    const { ctx, world: w } = failing({ failInsert: { rsvps: { code: "42501", message: "new row violates row-level security policy for table rsvps" } } });
    const r = await addToEvent(ctx, add());
    expect(r).toEqual({ ok: false, kind: "other", error: "Could not add them to the event — you don't have permission to make this change." });
    expect(w.tables.attendees).toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });

  it("releases the RSVP it made when the people could not be added, and says nothing was added", async () => {
    const { ctx, world: w } = failing({ failInsert: { attendees: { message: "connection reset" } } });
    const r = await addToEvent(ctx, add());
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/^Could not add Samira and Layla to Spring Picnic — .* Nothing was added\.$/);
    expect(w.tables.rsvps).toHaveLength(1);
    expect(w.tables.rsvps[0]).toMatchObject({ status: "cancelled", cancelled_at: "2026-10-12T15:00:00.000Z" });
  });

  it("says an empty RSVP may remain when even that could not be undone", async () => {
    const { ctx } = failing({ failInsert: { attendees: { message: "connection reset" } }, failUpdate: { rsvps: { message: "still down" } } });
    const r = await addToEvent(ctx, add());
    expect(!r.ok && r.error).toMatch(/an empty RSVP may remain/);
  });

  it("does not touch the family's own RSVP when adding to it fails", async () => {
    const w = world();
    w.tables.rsvps.push({ id: W.rsvpExisting, center_id: W.center, event_id: W.picnic, household_id: W.hh, status: "confirmed", source: "app", created_at: "2026-10-02T00:00:00Z" });
    const { ctx, world: db } = failing({ failInsert: { attendees: { message: "boom" } } }, w);
    const r = await addToEvent(ctx, add());
    expect(r.ok).toBe(false);
    expect(db.tables.rsvps[0].status).toBe("confirmed");
  });

  it("refuses to add blind when the places taken cannot be counted", async () => {
    const { ctx, writes } = failing({ failSummary: true });
    const r = await addToEvent(ctx, add({ eventId: W.gala }));
    expect(r).toEqual({ ok: false, kind: "other", error: "Could not check how many places are left on Годовой вечер, so nobody was added. Try again." });
    expect(writes).toEqual([]);
  });

  it("explains a failed read of the event in words", async () => {
    const w = world();
    const { ctx } = context({ ...w, failTables: { events: { message: "fetch failed" } } } as typeof w);
    expect(await addToEvent(ctx, add())).toEqual({ ok: false, kind: "other", error: "Could not add them to the event — the database could not be reached — check the connection and try again." });
  });
});

describe("two clicks, or two people at once", () => {
  it("makes one RSVP when the same add arrives twice at once: the second is turned away", async () => {
    const { ctx, world: w } = context();
    const [a, b] = await Promise.all([addToEvent(ctx, add()), addToEvent(ctx, add())]);
    const results = [a, b];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const busy = results.find((r) => !r.ok);
    expect(busy).toMatchObject({ ok: false, kind: "busy" });
    expect(w.tables.rsvps).toHaveLength(1);
    expect(w.tables.attendees).toHaveLength(2);
  });

  it("lets the next add through once the first is done, and finds everyone already there", async () => {
    const { ctx, world: w, writes } = context();
    await addToEvent(ctx, add());
    const before = writes.length;
    const again = await addToEvent(ctx, add());
    expect(again).toMatchObject({ ok: true, outcome: "unchanged" });
    expect(writes.length).toBe(before);
    expect(w.tables.rsvps).toHaveLength(1);
  });

  it("lets a different family or a different event go at the same time", async () => {
    const w = world();
    w.tables.household_members.push({ center_id: W.center, household_id: W.hhOther, person_id: W.stranger, left_at: null });
    const { ctx } = context(w);
    const [a, b] = await Promise.all([addToEvent(ctx, add()), addToEvent(ctx, add({ eventId: W.tiny, personIds: [W.samira] }))]);
    expect([a.ok, b.ok]).toEqual([true, true]);
  });

  it("keeps the earliest RSVP when another one for the family landed first, and cancels its own", async () => {
    const w = world();
    let planted = false;
    const { ctx } = context(w, {
      afterInsert: (table) => {
        // As if a second member of staff saved at the same moment: an earlier RSVP of the same family is there once ours is.
        if (table === "rsvps" && !planted) {
          planted = true;
          w.tables.rsvps.push({ id: "earlier", center_id: W.center, event_id: W.picnic, household_id: W.hh, status: "confirmed", source: "admin", created_at: "2026-10-12T14:59:59.000Z" });
          w.tables.attendees.push({ id: "e1", rsvp_id: "earlier", person_id: W.samira, status: "confirmed", checked_in_at: null });
        }
      },
    });
    const r = await addToEvent(ctx, add());
    expect(r).toMatchObject({ ok: true, outcome: "extended", status: "confirmed", added: [W.layla] });
    const mine = w.tables.rsvps.find((x) => x.id !== "earlier")!;
    expect(mine).toMatchObject({ status: "cancelled" });
    expect(w.tables.attendees.filter((a) => a.rsvp_id === mine.id)).toEqual([]);
    expect(w.tables.attendees.filter((a) => a.rsvp_id === "earlier").map((a) => a.person_id)).toEqual([W.samira, W.layla]);
  });
});
