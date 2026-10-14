import { describe, expect, it } from "vitest";

import {
  addMonths,
  assignDraftOf,
  assignSentence,
  assignedMessage,
  canChangeMemberships,
  checkAssign,
  checkEdit,
  checkTierChange,
  defaultEndsOn,
  editChanges,
  editDraftOf,
  feeOffered,
  feeSentence,
  householdPhrase,
  isLive,
  isRealDate,
  liveOf,
  overlaps,
  periodText,
  statusView,
  tierChoices,
  tierSentence,
  type AssignContext,
  type MembershipRow,
  type MembershipTypeOption,
} from "@/lib/people-v2/memberships";

// The Memberships section's pure core: who may change a membership, what is live, the dates, the checks that mirror the database's, and
// the one sentence that says exactly what an assignment does (always: active at once, no Executive Committee step).
const TODAY = "2026-10-14";
const TZ = "America/Chicago";
const HOUSEHOLD = ["Hassan household", "No. 0301", "RCC-H-1102", "Samira & Karim Hassan", "Riverside"];

const row = (o: Partial<MembershipRow> = {}): MembershipRow => ({
  id: "m1",
  householdId: "h1",
  tier: "yearly",
  typeName: "Annual member",
  status: "active",
  startsOn: "2026-01-01",
  endsOn: "2026-12-31",
  notes: "Imported from the old list",
  holder: { id: "p1", name: "Samira Hassan" },
  household: HOUSEHOLD,
  hasFeePledge: false,
  fixedTerm: true,
  ...o,
});

const year: MembershipTypeOption = { id: "t-year", name: "Annual member", tier: "yearly", feeCents: 5000, feeLabel: "$50.00", periodMonths: 12 };
const life: MembershipTypeOption = { id: "t-life", name: "Lifetime member", tier: "life", feeCents: 50000, feeLabel: "$500.00", periodMonths: null };
const friend: MembershipTypeOption = { id: "t-friend", name: "Friend", tier: "community", feeCents: 0, feeLabel: null, periodMonths: null };

const ctx = (o: Partial<AssignContext> = {}): AssignContext => ({
  householdId: "h1",
  household: HOUSEHOLD,
  types: [friend, year, life],
  holders: [
    { id: "p1", name: "Samira Hassan" },
    { id: "p2", name: "كريم الحسن" },
  ],
  defaultHolderId: "p1",
  givingOn: true,
  live: null,
  ...o,
});

describe("who may change a membership", () => {
  it("needs both people.approve and people.manage, the same gate as the tier change", () => {
    const has = (...keys: string[]) => (k: string) => keys.includes(k);
    expect(canChangeMemberships(has("people.approve", "people.manage"))).toBe(true);
    expect(canChangeMemberships(has("people.manage"))).toBe(false);
    expect(canChangeMemberships(has("people.approve"))).toBe(false);
    expect(canChangeMemberships(has("people.view"))).toBe(false);
    expect(canChangeMemberships(has())).toBe(false);
  });
});

describe("what is live", () => {
  it("is active and not past its end date, as the rest of the system reads it", () => {
    expect(isLive(row(), TODAY)).toBe(true);
    expect(isLive(row({ endsOn: null }), TODAY)).toBe(true);
    expect(isLive(row({ endsOn: TODAY }), TODAY)).toBe(true);
    expect(isLive(row({ endsOn: "2026-10-13" }), TODAY)).toBe(false);
    for (const status of ["pending", "lapsed", "suspended", "ended"]) expect(isLive(row({ status }), TODAY)).toBe(false);
  });

  it("names the status in words: an active one past its end date is Expired", () => {
    expect(statusView(row(), TODAY)).toEqual({ label: "Active", tone: "green" });
    expect(statusView(row({ endsOn: "2026-06-30" }), TODAY)).toEqual({ label: "Expired", tone: "grey" });
    expect(statusView(row({ status: "ended" }), TODAY).label).toBe("Ended");
    expect(statusView(row({ status: "lapsed" }), TODAY).label).toBe("Lapsed");
    expect(statusView(row({ status: "pending" }), TODAY).label).toBe("Pending");
    expect(statusView(row({ status: "suspended" }), TODAY).label).toBe("Suspended");
  });

  it("picks the family's live membership: its own rows only, the highest tier, then the newest", () => {
    const rows = [
      row({ id: "a", tier: "community", startsOn: "2020-01-01", endsOn: null }),
      row({ id: "b", tier: "yearly", startsOn: "2026-01-01" }),
      row({ id: "c", tier: "yearly", startsOn: "2026-03-01" }),
      row({ id: "d", tier: "life", householdId: "h2", startsOn: "2026-01-01", endsOn: null }),
      row({ id: "e", status: "ended" }),
    ];
    expect(liveOf(rows, "h1", TODAY)?.id).toBe("c");
    expect(liveOf(rows, "h2", TODAY)?.id).toBe("d");
    expect(liveOf(rows, "h3", TODAY)).toBeNull();
  });

  it("writes the period, with an open end in words", () => {
    expect(periodText(row(), TZ)).toBe("Jan 1, 2026 – Dec 31, 2026");
    expect(periodText(row({ endsOn: null }), TZ)).toBe("Jan 1, 2026 – no end date");
  });

  it("writes the family as its card line, never its name alone", () => {
    expect(householdPhrase(HOUSEHOLD)).toBe("Hassan household (No. 0301 · RCC-H-1102 · Samira & Karim Hassan · Riverside)");
    expect(householdPhrase(["李 household"])).toBe("李 household");
    expect(householdPhrase([])).toBe("this family");
  });
});

describe("dates", () => {
  it("knows a real calendar day", () => {
    expect(isRealDate("2026-02-28")).toBe(true);
    expect(isRealDate("2028-02-29")).toBe(true);
    expect(isRealDate("2026-02-29")).toBe(false);
    expect(isRealDate("2026-13-01")).toBe(false);
    expect(isRealDate("14/10/2026")).toBe(false);
    expect(isRealDate("")).toBe(false);
  });

  it("adds months the way the database does: the same day, or the last day of a shorter month", () => {
    expect(addMonths("2026-10-14", 12)).toBe("2027-10-14");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-10-14", 0)).toBe("2026-10-14");
  });

  it("ends a membership after the type's period, and never when the type has none", () => {
    expect(defaultEndsOn("2026-10-14", 12)).toBe("2027-10-14");
    expect(defaultEndsOn("2026-10-14", null)).toBeNull();
    expect(defaultEndsOn("not a date", 12)).toBeNull();
  });

  it("sees two periods overlap, but not when they only share a boundary day", () => {
    expect(overlaps({ startsOn: "2026-01-01", endsOn: "2026-12-31" }, { startsOn: "2026-06-01", endsOn: null })).toBe(true);
    expect(overlaps({ startsOn: "2026-01-01", endsOn: "2026-06-01" }, { startsOn: "2026-06-01", endsOn: null })).toBe(false);
    expect(overlaps({ startsOn: "2026-01-01", endsOn: null }, { startsOn: "2020-01-01", endsOn: null })).toBe(true);
  });
});

describe("editing the dates and the note", () => {
  const d = (o: Partial<ReturnType<typeof editDraftOf>> = {}) => ({ ...editDraftOf(row()), reason: "Corrected from the paper form", ...o });

  it("starts from what is on file, with no reason yet", () => {
    expect(editDraftOf(row())).toEqual({ startsOn: "2026-01-01", endsOn: "2026-12-31", notes: "Imported from the old list", reason: "" });
    expect(editDraftOf(row({ endsOn: null, notes: null }))).toMatchObject({ endsOn: "", notes: "" });
  });

  it("accepts a change with a reason, trimming the note and sending an empty end date as none", () => {
    const r = checkEdit(row(), d({ startsOn: "2025-12-15", notes: "  Paid by cheque  " }), TODAY);
    expect(r).toEqual({ ok: true, input: { membershipId: "m1", startsOn: "2025-12-15", endsOn: "2026-12-31", notes: "Paid by cheque", reason: "Corrected from the paper form" } });
    const lifetime = checkEdit(row({ tier: "life", fixedTerm: false, endsOn: "2030-01-01" }), d({ endsOn: "" }), TODAY);
    expect(lifetime).toMatchObject({ ok: true, input: { endsOn: null } });
  });

  it("clears the note when it is blank", () => {
    expect(checkEdit(row(), d({ notes: "   " }), TODAY)).toMatchObject({ ok: true, input: { notes: null } });
  });

  it("refuses, in words and with the field, what the database would refuse", () => {
    const err = (draft: ReturnType<typeof d>, over: Partial<MembershipRow> = {}) => {
      const r = checkEdit(row(over), draft, TODAY);
      if (r.ok) throw new Error("expected a refusal");
      return r;
    };
    expect(err(d({ startsOn: "" }))).toMatchObject({ field: "startsOn", error: "Choose the date the membership starts" });
    expect(err(d({ startsOn: "2026-02-30" }))).toMatchObject({ field: "startsOn", error: "That start date is not a real date" });
    expect(err(d({ endsOn: "soon" }))).toMatchObject({ field: "endsOn", error: "That end date is not a real date" });
    expect(err(d({ endsOn: "2300-01-01" }))).toMatchObject({ field: "endsOn", error: expect.stringContaining("between the years 1900 and 2200") });
    expect(err(d({ startsOn: "2026-03-01", endsOn: "2026-02-01" }))).toMatchObject({ field: "endsOn", error: "The end date cannot be before the start date" });
    expect(err(d({ notes: "n".repeat(1001) }))).toMatchObject({ field: "notes", error: "The note is too long (1,000 characters at most)" });
    expect(err(d())).toMatchObject({ error: "Change a date or the note first" });
    expect(err(d({ startsOn: "2026-10-15" }))).toMatchObject({ field: "startsOn", error: expect.stringContaining("cannot start in the future") });
    expect(err(d({ endsOn: "2026-10-13" }))).toMatchObject({ field: "endsOn", error: expect.stringContaining("cannot be given an end date in the past") });
    expect(err(d({ endsOn: "" }))).toMatchObject({ field: "endsOn", error: expect.stringContaining("needs an end date") });
    expect(err(d({ startsOn: "2026-01-02", reason: "  " }))).toMatchObject({ field: "reason", error: "Say why the membership is being changed: the reason goes in the audit log" });
    expect(err(d({ startsOn: "2026-01-02", reason: "r".repeat(501) }))).toMatchObject({ field: "reason", error: expect.stringContaining("too long") });
  });

  it("lets an end date of today stand (it counts until the end of today), and an ended one keep an end date in the past", () => {
    expect(checkEdit(row(), d({ endsOn: TODAY }), TODAY).ok).toBe(true);
    const ended = row({ status: "ended", endsOn: "2026-05-01" });
    expect(checkEdit(ended, d({ endsOn: "2026-04-01" }), TODAY).ok).toBe(true);
    expect(checkEdit(ended, d({ endsOn: "2026-12-01" }), TODAY)).toMatchObject({ ok: false, error: "An ended membership cannot end in the future" });
    expect(checkEdit(ended, d({ endsOn: "" }), TODAY)).toMatchObject({ ok: false, error: "This membership has ended, so it keeps an end date" });
  });

  it("checks only what is being changed against today: a note on an expired membership can be corrected", () => {
    const expired = row({ startsOn: "2024-01-01", endsOn: "2024-12-31" });
    expect(checkEdit(expired, { ...editDraftOf(expired), notes: "Lapsed in the spring", reason: "Adding context" }, TODAY).ok).toBe(true);
  });

  it("refuses to overlap another active membership of the family, but may share a boundary day", () => {
    const older = row({ id: "old", startsOn: "2025-01-01", endsOn: "2025-12-31" });
    const current = row({ id: "cur", startsOn: "2026-01-01", endsOn: "2026-12-31" });
    const other = row({ id: "x", householdId: "h9", startsOn: "2025-06-01", endsOn: null });
    const clash = checkEdit(current, { ...editDraftOf(current), startsOn: "2025-06-01", reason: "Backdating" }, TODAY, [older, current, other]);
    expect(clash).toMatchObject({ ok: false, field: "startsOn", error: expect.stringContaining("overlaps those dates") });
    expect(checkEdit(current, { ...editDraftOf(current), startsOn: "2025-12-31", reason: "Starts the day the old one ended" }, TODAY, [older, current, other]).ok).toBe(true);
  });

  it("lists what changes in plain lines", () => {
    expect(editChanges(row(), d({ startsOn: "2025-12-15", endsOn: "", notes: "" }), TZ)).toEqual([
      "Start date: Jan 1, 2026 → Dec 15, 2025",
      "End date: Dec 31, 2026 → none",
      "The note is cleared",
    ]);
    expect(editChanges(row(), d(), TZ)).toEqual([]);
  });
});

describe("changing the tier", () => {
  const choices = tierChoices([friend, year, life], "yearly");

  it("offers the other tiers the community has, in the order of the tiers", () => {
    expect(choices).toEqual(["community", "life"]);
    expect(tierChoices([year], "yearly")).toEqual([]);
    expect(tierChoices([year, life], "life")).toEqual(["yearly"]);
  });

  it("needs another tier and a reason", () => {
    const o = { householdId: "h1", currentTier: "yearly", choices };
    expect(checkTierChange(o, { tier: "life", reason: " Paid the life fee at the office " })).toEqual({ ok: true, input: { householdId: "h1", tier: "life", reason: "Paid the life fee at the office" } });
    expect(checkTierChange(o, { tier: "", reason: "x" })).toMatchObject({ ok: false, field: "tier" });
    expect(checkTierChange(o, { tier: "yearly", reason: "x" })).toMatchObject({ ok: false, error: "The family already holds a Yearly membership. Choose a different tier" });
    expect(checkTierChange(o, { tier: "senior", reason: "x" })).toMatchObject({ ok: false, error: "That tier is not offered by this community" });
    expect(checkTierChange(o, { tier: "life", reason: "" })).toMatchObject({ ok: false, field: "reason", error: "Say why the tier is changing: the reason goes in the audit log" });
  });

  it("says what it does, including that it skips the Executive Committee", () => {
    expect(tierSentence({ household: HOUSEHOLD, from: "yearly", to: "life" })).toBe(
      "Change Hassan household (No. 0301 · RCC-H-1102 · Samira & Karim Hassan · Riverside) from Yearly to Life. The Yearly membership ends today and a Life membership starts today. It is active at once and does not wait for the Executive Committee. No fee is recorded.",
    );
  });
});

describe("assigning a membership", () => {
  const draft = (c: AssignContext, o: Partial<ReturnType<typeof assignDraftOf>> = {}) => ({ ...assignDraftOf(c, TODAY), typeId: "t-life", reason: "Paid the life fee at the desk", ...o });
  const ok = (c: AssignContext, d: ReturnType<typeof draft>) => {
    const r = checkAssign(c, d, TODAY);
    if (!r.ok) throw new Error(`expected it to pass: ${r.error}`);
    return r.input;
  };

  it("starts today, with the holder the section was opened from, no type chosen and no fee recorded until asked", () => {
    expect(assignDraftOf(ctx(), TODAY)).toEqual({ typeId: "", startsOn: TODAY, endsOn: "", holderId: "p1", reason: "", recordFee: false });
    expect(assignDraftOf(ctx({ defaultHolderId: null }), TODAY).holderId).toBe("");
  });

  it("offers the fee box only for a type with a fee and only when Pledges & donations is on", () => {
    expect(feeOffered(ctx(), year)).toBe(true);
    expect(feeOffered(ctx(), friend)).toBe(false);
    expect(feeOffered(ctx({ givingOn: false }), year)).toBe(false);
    expect(feeOffered(ctx(), undefined)).toBe(false);
  });

  it("builds the request: the type's period gives the end date, and a Life membership has none", () => {
    const yearly = ok(ctx(), draft(ctx(), { typeId: "t-year", recordFee: true }));
    expect(yearly.request).toEqual({
      householdId: "h1",
      holderId: "p1",
      typeId: "t-year",
      startsOn: TODAY,
      endsOn: "2027-10-14",
      reason: "Paid the life fee at the desk",
      recordFee: true,
    });
    const lifetime = ok(ctx(), draft(ctx()));
    expect(lifetime.request).toMatchObject({ typeId: "t-life", endsOn: null, recordFee: false });
  });

  it("keeps a chosen end date and a back-dated start", () => {
    const r = ok(ctx(), draft(ctx(), { typeId: "t-year", startsOn: "2026-09-01", endsOn: "2026-12-31" }));
    expect(r.request).toMatchObject({ startsOn: "2026-09-01", endsOn: "2026-12-31" });
  });

  it("never records a fee that the type does not have or that giving cannot take, whatever the box says", () => {
    expect(ok(ctx(), draft(ctx(), { typeId: "t-friend", recordFee: true })).request.recordFee).toBe(false);
    expect(ok(ctx({ givingOn: false }), draft(ctx(), { typeId: "t-year", recordFee: true })).request.recordFee).toBe(false);
  });

  it("allows no holder", () => {
    const r = ok(ctx(), draft(ctx(), { holderId: "" }));
    expect(r.holder).toBeNull();
    expect(r.request.holderId).toBeNull();
  });

  it("refuses, in words and with the field, what the database would refuse", () => {
    const err = (c: AssignContext, d: ReturnType<typeof draft>) => {
      const r = checkAssign(c, d, TODAY);
      if (r.ok) throw new Error("expected a refusal");
      return r;
    };
    expect(err(ctx({ live: { id: "m", tier: "yearly", typeName: "Annual member", endsOn: "2026-12-31" } }), draft(ctx()))).toMatchObject({
      field: "typeId",
      error: "This family already has an active Yearly membership. To move it to a different tier, use Change tier",
    });
    expect(err(ctx(), draft(ctx(), { typeId: "" }))).toMatchObject({ field: "typeId", error: "Choose a membership type" });
    expect(err(ctx(), draft(ctx(), { typeId: "nope" }))).toMatchObject({ field: "typeId" });
    expect(err(ctx(), draft(ctx(), { startsOn: "" }))).toMatchObject({ field: "startsOn", error: "Choose the date the membership starts" });
    expect(err(ctx(), draft(ctx(), { startsOn: "2026-10-15" }))).toMatchObject({ field: "startsOn", error: expect.stringContaining("active at once, so it cannot start in the future") });
    expect(err(ctx(), draft(ctx(), { typeId: "t-year", endsOn: "2026-10-01", startsOn: "2026-09-01" }))).toMatchObject({ field: "endsOn", error: expect.stringContaining("already passed") });
    expect(err(ctx(), draft(ctx(), { typeId: "t-year", endsOn: "2026-08-01", startsOn: "2026-09-01" }))).toMatchObject({ field: "endsOn", error: "The end date cannot be before the start date" });
    expect(err(ctx(), draft(ctx(), { holderId: "a-child" }))).toMatchObject({ field: "holderId", error: "The holder must be an adult of this family" });
    expect(err(ctx(), draft(ctx(), { reason: "" }))).toMatchObject({ field: "reason", error: "Say why the membership is being assigned: the reason goes in the audit log" });
  });
});

describe("the confirmation sentence", () => {
  const sentence = (c: AssignContext, over: { typeId: string; recordFee?: boolean; holderId?: string; endsOn?: string }) => {
    const r = checkAssign(c, { ...assignDraftOf(c, TODAY), reason: "Paid at the desk", ...over }, TODAY);
    if (!r.ok) throw new Error(r.error);
    return assignSentence(c, r.input, TZ);
  };

  it("says exactly what will happen for a Life membership with its fee", () => {
    expect(sentence(ctx(), { typeId: "t-life", recordFee: true })).toBe(
      "Assign a Life membership (Lifetime member) to Hassan household (No. 0301 · RCC-H-1102 · Samira & Karim Hassan · Riverside), held by Samira Hassan, from Oct 14, 2026, for life. " +
        "It is active at once and does not wait for the Executive Committee. The $500.00 fee is recorded as an open pledge, due in 30 days.",
    );
  });

  it("says it for a Yearly membership without the fee, with the end date the type gives", () => {
    expect(sentence(ctx(), { typeId: "t-year" })).toBe(
      "Assign a Yearly membership (Annual member) to Hassan household (No. 0301 · RCC-H-1102 · Samira & Karim Hassan · Riverside), held by Samira Hassan, from Oct 14, 2026, until Oct 14, 2027. " +
        "It is active at once and does not wait for the Executive Committee. No fee is recorded.",
    );
  });

  it("names a holder in another script, and says when there is none", () => {
    expect(sentence(ctx(), { typeId: "t-year", holderId: "p2" })).toContain("held by كريم الحسن");
    expect(sentence(ctx(), { typeId: "t-year", holderId: "" })).toContain("with no holder named");
  });

  it("does not repeat the tier when the type is named after it", () => {
    const c = ctx({ types: [{ ...life, name: "Life membership" }] });
    expect(sentence(c, { typeId: "t-life" })).toMatch(/^Assign a Life membership to Hassan household/);
  });

  it("says what happens to the fee in every case", () => {
    expect(feeSentence(ctx(), friend, false)).toBe("This membership has no fee.");
    expect(feeSentence(ctx(), year, false)).toBe("No fee is recorded.");
    expect(feeSentence(ctx(), year, true)).toBe("The $50.00 fee is recorded as an open pledge, due in 30 days.");
    expect(feeSentence(ctx({ givingOn: false }), year, false)).toBe("The $50.00 fee is not recorded, because Pledges & donations is switched off.");
  });

  it("states the Executive Committee rule for every tier", () => {
    for (const typeId of ["t-friend", "t-year", "t-life"]) expect(sentence(ctx(), { typeId })).toContain("It is active at once and does not wait for the Executive Committee.");
  });

  it("says what was done afterwards, including when no fee pledge came of it", () => {
    expect(assignedMessage({ typeName: "Lifetime member", tier: "life", feeRecorded: true, wantedFee: true })).toBe(
      "Life membership assigned (Lifetime member). It is active now · audit logged. The fee is recorded as an open pledge.",
    );
    expect(assignedMessage({ typeName: "Annual member", tier: "yearly", feeRecorded: false, wantedFee: true })).toContain("No fee pledge was recorded.");
    expect(assignedMessage({ typeName: "Annual member", tier: "yearly", feeRecorded: null, wantedFee: true })).toContain("Check the Giving tab");
    expect(assignedMessage({ typeName: "Annual member", tier: "yearly", feeRecorded: false, wantedFee: false })).toBe("Yearly membership assigned (Annual member). It is active now · audit logged.");
  });
});
