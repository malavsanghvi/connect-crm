// The guided event creator's pure core (src/lib/event-creator): which cards each kind of community is asked, the suggestions
// from its own history and calendar (each with its reason), the clash check, the readiness list, and the draft <-> form mapping
// that drives the builder's own save (eventValues runs on what the creator sends).
import { describe, expect, it } from "vitest";

import { fieldsOn } from "@/lib/event-creator/fields";
import { FIXTURE_NAMES, fixtureCtx, fixtureDraft } from "@/lib/event-creator/fixtures";
import { fromEvent, likePastEvent, newDraft, toEntries, toFormData, type EventRowLike } from "@/lib/event-creator/mapping";
import { after, askedCards, before, creatorReadiness, nextCard } from "@/lib/event-creator/plan";
import { skippedNotes } from "@/lib/event-creator/questions";
import {
  capacitySuggestion,
  commitmentSuggestion,
  clashesFor,
  dateSuggestions,
  lessonCard,
  lessonsFor,
  mealSuggestion,
  nameSimilarity,
  priceSuggestion,
  reminderSuggestion,
  shiftSuggestions,
  shiftTimes,
  startLike,
  venueSuggestions,
} from "@/lib/event-creator/smart";
import { cardProblem, validateDraft } from "@/lib/event-creator/validate";
import { eventValues } from "@/lib/events/event-values";

const named = (kind: Parameters<typeof fixtureCtx>[0], name = FIXTURE_NAMES[kind]) => ({ ...newDraft(fixtureCtx(kind)), name });

describe("which cards each community is asked", () => {
  it("temple and church (everything on, paid and volunteer history): every card", () => {
    for (const k of ["temple", "church"] as const) expect(askedCards(fixtureCtx(k))).toEqual(["what", "where", "who", "money", "help", "words", "sending", "more", "review"]);
  });

  it("chamber (no Giving, but its mixers charge): money is still asked, without the donation commitment", () => {
    const ctx = fixtureCtx("chamber");
    expect(askedCards(ctx)).toContain("money");
    expect(fieldsOn("money", ctx)).toEqual(expect.arrayContaining(["is_paid", "member_price", "guest_price"]));
  });

  it("club (no tradition, nothing switched on, three free events): money, help and sending move under More settings, and it says why", () => {
    const ctx = fixtureCtx("club");
    expect(askedCards(ctx)).toEqual(["what", "where", "who", "words", "more", "review"]);
    expect(skippedNotes(ctx)).toEqual([
      "Your last 3 events were all free, so tickets and donations are here.",
      "Volunteers are switched off and your past events had no shifts or meals, so meal settings are here.",
      "Messages are switched off and your last 3 events sent no reminder, so the reminder is here.",
    ]);
  });

  it("a brand-new community with no history is asked about money and reminders (history cannot rule them out)", () => {
    const ctx = fixtureCtx("club");
    const fresh = { ...ctx, history: { ...ctx.history, past: [] } };
    expect(askedCards(fresh)).toEqual(["what", "where", "who", "money", "words", "sending", "more", "review"]);
  });

  it("steps forward and back over the asked cards only", () => {
    const ctx = fixtureCtx("club");
    expect(after("who", ctx)).toBe("words");
    expect(before("words", ctx)).toBe("who");
    expect(before("what", ctx)).toBeNull();
    expect(after("review", ctx)).toBe("review");
  });
});

describe("where the creator opens (resume)", () => {
  const ctx = fixtureCtx("temple");
  it("a new event, or a draft without a name and start, opens card 1", () => {
    expect(nextCard(newDraft(ctx), ctx)).toBe("what");
    expect(nextCard({ ...fixtureDraft("temple", { saved: true }), starts_at: "" }, ctx)).toBe("what");
  });
  it("a saved draft opens at the first card this browser has not passed", () => {
    const d = fixtureDraft("temple", { saved: true });
    expect(nextCard(d, ctx, ["what", "where", "who"])).toBe("money");
    expect(nextCard(d, ctx, ["what", "where", "who", "money", "help", "words", "sending", "more"])).toBe("review");
  });
  it("with nothing remembered: the place if missing, else Review", () => {
    const d = fixtureDraft("temple", { saved: true });
    expect(nextCard({ ...d, venue: "" }, ctx)).toBe("where");
    expect(nextCard(d, ctx)).toBe("review");
  });
});

describe("suggestions from the community's own data, each with its reason", () => {
  it("names match across words, accents and years", () => {
    expect(nameSimilarity("Diwali dinner and cultural program", "Diwali dinner and cultural program 2025")).toBe(1);
    expect(nameSimilarity("November member mixer", "October member mixer")).toBeCloseTo(2 / 3);
    expect(nameSimilarity("Fête de Noël", "fete de noel")).toBe(1);
    expect(nameSimilarity("Winter night ride", "Autumn hill climb")).toBe(0);
  });

  it("temple: Diwali from its festival calendar first, then a year after last time; each says what else is on", () => {
    const s = dateSuggestions(named("temple"), fixtureCtx("temple"));
    expect(s.map((x) => [x.value.starts_at, x.source, x.best ?? false])).toEqual([
      ["2026-11-08T18:00", "calendar", true],
      ["2026-11-07T18:00", "history", false],
    ]);
    expect(s[0].label).toBe("Sun, Nov 8 · 6:00 PM");
    expect(s[0].why).toBe("Diwali, on your Festivals calendar. No other events that day.");
    expect(s[0].value.ends_at).toBe("2026-11-08T21:30");
    expect(s[1].why).toBe("About a year after Diwali dinner and cultural program 2025 (Sat, Nov 8, 2025), on the same weekday. Also that day: Youth bake sale (10:00 AM, Community room).");
  });

  it("church: Christmas Eve from the Christian year layer, at last year's time", () => {
    const s = dateSuggestions(named("church"), fixtureCtx("church"));
    expect(s[0]).toMatchObject({ value: { starts_at: "2026-12-24T19:00", ends_at: "2026-12-24T20:30" }, source: "calendar", best: true });
    expect(s[0].why).toContain("Christmas Eve, on your Christian year calendar.");
  });

  it("chamber: the second Thursday, like its last three mixers (a series, no calendar day named Mixer)", () => {
    const s = dateSuggestions(named("chamber"), fixtureCtx("chamber"));
    expect(s[0]).toMatchObject({ value: { starts_at: "2026-11-12T17:30", ends_at: "2026-11-12T19:30" }, source: "history", best: true });
    expect(s[0].why).toBe("The second Thursday of the month, like the last 3 times. No other events that day.");
  });

  it("club: a new kind of ride has no history to suggest from, so no dates are invented", () => {
    expect(dateSuggestions(named("club"), fixtureCtx("club"))).toEqual([]);
    expect(startLike(named("club"), fixtureCtx("club"))).toEqual([]);
  });

  it("venues: the similar event's room first with how many came, then the most used", () => {
    const v = venueSuggestions(named("temple"), fixtureCtx("temple"));
    expect(v[0]).toMatchObject({ label: "Main hall", value: { venue: "Main hall", capacity: 300 }, best: true });
    expect(v[0].why).toBe("Used for Diwali dinner and cultural program 2025 (Nov 2025). 212 came.");
    expect(v[1]).toMatchObject({ label: "Community room" });
    const club = venueSuggestions(named("club"), fixtureCtx("club"));
    expect(club.map((x) => x.label)).toEqual(["Clubhouse", "Ridge Lane car park"]);
    expect(club[0].why).toMatch(/^Used for 2 events, most recently Jul 2026\.$/);
  });

  it("capacity: last turnout plus about 20%", () => {
    expect(capacitySuggestion(named("temple"), fixtureCtx("temple"))).toMatchObject({ value: 260, why: "Last time 212 came to Diwali dinner and cultural program 2025. Planning for 260 gives about 20% room." });
    expect(capacitySuggestion(named("chamber"), fixtureCtx("chamber"))!.value).toBe(120);
  });

  it("prices are offered with their source, never set: the draft stays free until the person accepts", () => {
    const d = named("chamber");
    expect(priceSuggestion(d, fixtureCtx("chamber"))).toMatchObject({ value: { member_cents: 2500, guest_cents: 4000 }, why: "October member mixer was $25 for members and $40 for guests." });
    expect(d.is_paid).toBe(false);
    const like = likePastEvent(d, fixtureCtx("chamber").history.past[0]);
    expect([like.is_paid, like.member_price, like.venue, like.audience]).toEqual([false, "", "Chamber hall", "public"]);
    // GBP for a community in the UK.
    const club = fixtureCtx("club");
    const paid = { ...club, history: { ...club.history, past: [{ ...club.history.past[0], name: "Winter night ride 2025", is_paid: true, member_price_cents: 500, guest_price_cents: 800 }] } };
    expect(priceSuggestion(named("club"), paid)!.why).toBe("Winter night ride 2025 was £5 for members and £8 for guests.");
  });

  it("meals, shifts and the reminder come from the similar event", () => {
    expect(mealSuggestion(named("temple"), fixtureCtx("temple"))!.why).toBe("Diwali dinner and cultural program 2025 served a meal (20-minute slots, 60 seats each).");
    const shifts = shiftSuggestions(named("church"), fixtureCtx("church"));
    expect(shifts.map((s) => [s.label, s.value.station, s.value.capacity])).toEqual([
      ["Greeters", "entry", 6],
      ["Ushers", "entry", 8],
      ["Parking and traffic", "parking", 4],
    ]);
    expect(shifts[0].why).toBe("Same as Christmas Eve candlelight service: 6 people.");
    expect(shiftTimes("2026-12-24T19:00", shifts[0].value)).toEqual({ starts_at: "2026-12-24T18:15", ends_at: "2026-12-24T20:45" });
    expect(reminderSuggestion(named("church"), fixtureCtx("church"), 24)).toMatchObject({ value: 48, source: "history" });
    expect(reminderSuggestion(named("club"), fixtureCtx("club"), 24)).toMatchObject({ value: 24, source: "rule" });
  });

  it("lessons learned show at the card they are about", () => {
    const ctx = fixtureCtx("temple");
    expect(lessonsFor("help", named("temple"), ctx).map((l) => l.text)).toEqual(["The food ran out at 7:30. Plan for 15% more."]);
    expect(lessonsFor("where", named("temple"), ctx).map((l) => l.text)).toEqual(["Parking was full by 6 pm; ask the school next door for its lot."]);
    expect(lessonsFor("review", named("temple"), ctx)).toHaveLength(3);
    expect(lessonCard("Name badges ran out; print 20 extra.")).toBe("help");
    expect(lessonCard("Card payments failed at the door; bring a cash box.")).toBe("money");
    expect(lessonCard("Announce the date a month ahead.")).toBe("sending");
    expect(lessonCard("Thank the sponsors by name.")).toBe("money");
    expect(lessonCard("Start on time.")).toBe("review");
    // "service" is not "serving": the church's overflow lesson belongs to the place.
    expect(lessonsFor("where", named("church"), fixtureCtx("church")).map((l) => l.text)).toEqual(["The 7 pm service filled by 6:40; open the fellowship hall as an overflow room."]);
  });

  it("clashes: same venue is a warning, the calendar is information", () => {
    const ctx = fixtureCtx("temple");
    const d = { ...named("temple"), starts_at: "2026-11-07T18:00", venue: "Community room" };
    expect(clashesFor(d, ctx)).toEqual([{ level: "warn", text: "Youth bake sale is at Community room that day too (10:00 AM)." }]);
    expect(clashesFor({ ...d, starts_at: "2026-11-08T18:00" }, ctx)).toEqual([{ level: "info", text: "Diwali is on your Festivals calendar that day." }]);
    const chamber = fixtureCtx("chamber");
    expect(clashesFor({ ...named("chamber"), starts_at: "2026-11-11T17:30" }, chamber)).toEqual([{ level: "info", text: "Veterans Day is on your US holidays calendar that day." }]);
  });
});

describe("the draft drives the builder's own save", () => {
  it("toFormData sends what the builder's form sends, and eventValues reads it", () => {
    const ctx = fixtureCtx("temple");
    const d = { ...fixtureDraft("temple", { saved: true }), owner: { id: "p-1", name: "Asha Rao", detail: "Household 1042" } };
    const values = eventValues(toFormData(d), ctx.tz, ctx.rules, false);
    expect(values).toMatchObject({
      name: "Diwali dinner and cultural program",
      starts_at: "2026-11-09T00:00:00.000Z",
      ends_at: "2026-11-09T03:30:00.000Z",
      venue: "Main hall",
      capacity: 260,
      waitlist_enabled: true,
      audience: "members_and_guests",
      confirmation_hours_before: 24,
      attendee_flags: ["child_under_12", "senior", "assistance"],
      commitment_options: { per_person: [300, 500, 700], lump_sum: [1000, 2500, 5000], open: true },
      lunch_enabled: true,
      lunch_slot_minutes: 20,
      lunch_seats_per_slot: 60,
      is_paid: true,
      member_price_cents: 1200,
      guest_price_cents: 1800,
      owner_person_id: "p-1",
      confidential: false,
    });
    expect(toEntries(d).filter(([k]) => k === "intent")).toEqual([["intent", "draft"]]);
  });

  it("switches that are off send nothing, and the inputs the builder disables are left out", () => {
    const d = { ...newDraft(fixtureCtx("club")), name: "Ride", reminder_enabled: false, is_paid: false, commitments_enabled: false };
    const keys = toEntries(d).map(([k]) => k);
    for (const k of ["reminder_enabled", "confirmation_hours_before", "is_paid", "member_price", "commitments_enabled", "commit_per_person", "lunch_enabled", "confidential", "owner_person_id"]) expect(keys).not.toContain(k);
    expect(eventValues(toFormData(d), "Europe/London", {}, false)).toMatchObject({ confirmation_hours_before: 0, is_paid: false, member_price_cents: null, commitment_options: { per_person: [], lump_sum: [], open: false } });
  });

  it("a saved row comes back as the same draft", () => {
    const ctx = fixtureCtx("temple");
    const d = fixtureDraft("temple", { saved: true });
    const v = eventValues(toFormData(d), ctx.tz, ctx.rules, false);
    const row: EventRowLike = { ...v, id: "preview-temple", status: "draft", flyer_path: null, commitment_options: v.commitment_options, attendee_flags: v.attendee_flags };
    const back = fromEvent(row, ctx.tz);
    expect(toEntries(back)).toEqual(toEntries(d));
  });

  it("new drafts start with meals and the commitment OFF for every kind (offered by their cards), with the community's rules", () => {
    expect(newDraft(fixtureCtx("temple"))).toMatchObject({ lunch_enabled: false, commitments_enabled: false, lunch_slot_minutes: "20", confirmation_hours_before: "24", audience: "members_and_guests", waitlist_enabled: true });
    expect(newDraft(fixtureCtx("club"))).toMatchObject({ lunch_enabled: false, commitments_enabled: false, lunch_slot_minutes: "15", confirmation_hours_before: "24" });
    expect(commitmentSuggestion(named("temple"), fixtureCtx("temple"))!.why).toBe("Diwali dinner and cultural program 2025 asked for a donation commitment at RSVP.");
    expect(commitmentSuggestion(named("chamber"), fixtureCtx("chamber"))).toBeNull();
  });
});

describe("validation uses the builder's own sentences, on the card that holds the field", () => {
  const ctx = fixtureCtx("temple");
  const d = fixtureDraft("temple", { saved: true });
  it.each([
    [{ ends_at: "2026-11-08T17:00" }, "The event must end after it starts.", "what"],
    [{ capacity: "lots" }, "Capacity must be a whole number.", "where"],
    [{ member_price: "twelve" }, "Member price must be an amount like 25 or 25.50.", "money"],
    [{ lunch_seats_per_slot: "0" }, "Seats per slot must be at least 1.", "help"],
    [{ confirmation_hours_before: "400" }, "Confirmation reminder must be at most 336.", "sending"],
    [{ rsvp_opens_at: "2026-11-01T09:00", rsvp_closes_at: "2026-10-30T09:00" }, "RSVPs must close after they open.", "more"],
    [{ commit_per_person: "", commit_lump_sum: "", commit_open: false }, "Donation commitment is on but has no amounts. Enter per-person or lump-sum amounts (for example 3, 5, 7), allow an open amount, or turn it off.", "money"],
  ] as const)("%o → %s", (patch, error, card) => {
    expect(validateDraft({ ...d, ...patch }, ctx)).toMatchObject({ error, card });
  });

  it("a card only stops for its own fields (card 1 checks everything, since it creates the row)", () => {
    const bad = { ...d, member_price: "twelve" };
    expect(cardProblem("where", bad, ctx)).toBeNull();
    expect(cardProblem("money", bad, ctx)).toBe("Member price must be an amount like 25 or 25.50.");
    expect(cardProblem("what", bad, ctx)).toBe("Member price must be an amount like 25 or 25.50.");
    expect(cardProblem("what", { ...d, starts_at: "" }, ctx)).toBe("Choose when it starts, so the draft has a date.");
    expect(cardProblem("what", { ...d, name: " " }, ctx)).toBe("Event name is required.");
  });

  it("in the club, money fields are checked on More settings", () => {
    const club = fixtureCtx("club");
    expect(validateDraft({ ...fixtureDraft("club", { saved: true }), is_paid: true, member_price: "x" }, club)).toMatchObject({ card: "more" });
  });
});

describe("readiness: the builder's publish rules plus what the creator sets up", () => {
  it("a fresh draft lists what blocks publishing", () => {
    const ctx = fixtureCtx("temple");
    const r = creatorReadiness(newDraft(ctx), ctx);
    expect(r.items.find((i) => i.key === "when")).toMatchObject({ ok: false, blocks: true, hint: "It has no start date and time." });
    expect(r.items.find((i) => i.key === "saved")).toMatchObject({ ok: false, blocks: false });
    expect(r.blocking).toBe(1);
  });

  it("a paid event without a member price is blocked on the Money card (More settings in the club)", () => {
    const ctx = fixtureCtx("temple");
    const r = creatorReadiness({ ...fixtureDraft("temple", { saved: true }), member_price: "" }, ctx);
    expect(r.items.find((i) => i.key === "price")).toMatchObject({ ok: false, blocks: true, card: "money", hint: "It is a paid event with no member price." });
    const club = fixtureCtx("club");
    expect(creatorReadiness({ ...fixtureDraft("club", { saved: true }), is_paid: true }, club).items.find((i) => i.key === "price")!.card).toBe("more");
  });

  it("meals need their time and their slots; shifts and the flyer count when there", () => {
    const ctx = fixtureCtx("temple");
    const d = fixtureDraft("temple", { saved: true });
    const before = creatorReadiness(d, ctx);
    expect(before.items.find((i) => i.key === "meal_slots")).toMatchObject({ ok: false, card: "help" });
    const after = creatorReadiness({ ...d, flyer_path: "c/f.png" }, ctx, { lunch_slots: 9, shifts: 4, shifts_empty: 4, checklist_open: 0, checklist_overdue: 0 });
    expect(after.items.find((i) => i.key === "meal_slots")!.ok).toBe(true);
    expect(after.items.find((i) => i.key === "shifts")).toMatchObject({ ok: true, label: "4 volunteer shifts" });
    expect(after.percent).toBeGreaterThan(before.percent);
    expect(after.blocking).toBe(0);
  });

  it("a start in the past blocks, with the builder's sentence", () => {
    const ctx = fixtureCtx("chamber");
    const r = creatorReadiness({ ...fixtureDraft("chamber", { saved: true }), starts_at: "2026-10-01T17:30", ends_at: "" }, ctx);
    expect(r.items.find((i) => i.key === "when")!.hint).toMatch(/^The start time \(.+\) has already passed\.$/);
  });
});
