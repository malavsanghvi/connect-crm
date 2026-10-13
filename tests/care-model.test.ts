import { describe, expect, it } from "vitest";

import {
  NO_ACCESS,
  TOUCH_PRESETS,
  accessLine,
  formatDay,
  formatMonthDay,
  householdLine,
  isNoAccess,
  offSentence,
  ownerLine,
  parseCard,
  parseHolders,
  parseList,
  parseTouchPage,
  restLine,
  touchLine,
} from "@/lib/care/model";
import type { KindProfile } from "@/lib/kind";
import { careCan, canOpenTab, visibleNav, type ScopedContext } from "@/lib/permissions";
import { workspaceCoverageProblems } from "@/lib/workspaces";

// WeCare slice 2 (connect-crm 0760-0763): the words and shapes the Care card and the WeCare area draw from, for four kinds of
// organization (a church, a chamber, a temple and a food bank: nothing here is written for one community), and the navigation
// rules (convenience only: the database decides, with no platform-admin branch).

const kind = (key: string, label: string, faithBased: boolean, careLabel: string): KindProfile => ({
  key,
  label,
  faithBased,
  usesTradition: false,
  terms: {},
  modules: { care: { availability: "default_off", label: careLabel } },
});
const KINDS = {
  church: kind("church", "Church", true, "Member care"),
  chamber: kind("chamber_of_commerce", "Chamber of commerce", false, "Donor care"),
  temple: kind("swaminarayan_temple", "Swaminarayan Temple", true, "Member care"),
  foodBank: kind("nonprofit_secular", "Community organization", false, "Donor care"),
};

const household = {
  id: "h1",
  name: "Mensah, Ama",
  number: "GC-H-0041",
  org_household_id: "F-12",
  city: "Austin",
  zone: null,
  primary_member: "Ama Mensah",
  adults: [
    { person_id: "pa", name: "Ama Mensah", is_primary: true },
    { person_id: "pb", name: "Kofi Mensah", is_primary: false },
  ],
  merged: false,
};

const cardJson = (label: string, extra: Record<string, unknown> = {}) => ({
  household,
  label,
  access: { level: "own", manage: false, amounts: false, people: false },
  owners: { owner: { user_id: "u1", name: "Sam K", holds: true }, backup: { user_id: "u2", name: "Lee P", holds: true }, needs_owner: false, assigned_at: "2026-10-01T00:00:00Z", assigned_by: "Pat" },
  profile: { thanks: "call", recognition: "anonymous", channel: "phone", language: "es", contact_person_id: "pb", contact_name: "Kofi Mensah", do_not_ask: true, rest_until: "2026-11-12", resting: true, updated_at: null, updated_by: null },
  languages: ["en", "es"],
  today: "2026-10-13",
  people: null,
  special_days: null,
  notes: [{ id: "n1", body: "Prefers mornings.", person_id: "pa", person_name: "Ama Mensah", by: "Sam K", mine: true, created_at: "2026-10-02T15:00:00Z", edited_at: null }],
  notes_total: 1,
  last_touch: { at: "2026-10-10T15:00:00Z", kind: "thank_you", channel: "post", outcome: "done", is_ask: false, by: "Sam K" },
  touches_12m: 4,
  asks_12m: 1,
  ...extra,
});

describe("the care card's data, for every kind", () => {
  it.each(Object.entries(KINDS))("reads the card of a %s in its own words", (_, k) => {
    const label = k.modules.care.label!;
    const card = parseCard(cardJson(label));
    expect(card.label).toBe(label);
    expect(card.household.adults.map((a) => a.name)).toEqual(["Ama Mensah", "Kofi Mensah"]);
    expect(card.profile).toMatchObject({ thanks: "call", recognition: "anonymous", channel: "phone", language: "es", resting: true });
    expect(card.people).toBeNull();
    expect(accessLine(label, card.access)).toBe(
      `Only people your organization gives ${label} access can see this. Weaver staff cannot. Amounts stay hidden: your role does not include giving.`,
    );
  });

  it("names Member care for faith kinds and Donor care for the others (data, not code)", () => {
    expect([KINDS.church, KINDS.temple].map((k) => k.modules.care.label)).toEqual(["Member care", "Member care"]);
    expect([KINDS.chamber, KINDS.foodBank].map((k) => k.modules.care.label)).toEqual(["Donor care", "Donor care"]);
  });

  it("is safe with whatever comes back: unknown choices are dropped, missing parts are empty", () => {
    const card = parseCard({ household: { id: "h" }, profile: { thanks: "gift", recognition: 5 }, notes: "x", languages: [] });
    expect(card.profile).toMatchObject({ thanks: null, recognition: null, doNotAsk: false });
    expect(card.notes).toEqual([]);
    expect(card.languages).toEqual(["en"]);
    expect(card.access.level).toBe("own");
    expect(card.owners.needsOwner).toBe(true);
    expect(parseCard(null).household.name).toBe("Household");
  });

  it("keeps the People fields only when the database sent them", () => {
    const card = parseCard(
      cardJson("Donor care", {
        access: { level: "view", manage: false, amounts: false, people: true },
        people: [{ person_id: "pa", name: "Ama Mensah", is_primary: true, best_call_time: "evening", interests: ["gardening"], expertise: ["law"], language: "es", anniversary: "2005-06-01", dietary: ["Vegan"], dietary_other: null, agreed: { email: true, sms: null, whatsapp: false, post: true } }],
        special_days: [{ kind: "anniversary", label: "Wedding", date: "2005-06-01", tithi: null, person_name: null }],
      }),
    );
    expect(card.people?.[0]).toMatchObject({ bestCallTime: "evening", interests: ["gardening"], dietary: ["Vegan"], agreed: { email: true, sms: null, whatsapp: false, post: true } });
    expect(card.specialDays?.[0]).toMatchObject({ kind: "anniversary", label: "Wedding" });
  });
});

describe("sentences", () => {
  it("says who owns the household, or that it needs an owner", () => {
    const owners = parseCard(cardJson("Member care")).owners;
    expect(ownerLine(owners)).toBe("Owner: Sam K · Backup: Lee P");
    expect(ownerLine({ ...owners, backup: null })).toBe("Owner: Sam K");
    expect(ownerLine({ ...owners, owner: null, needsOwner: true })).toBe("Needs an owner");
    expect(ownerLine({ ...owners, owner: { userId: "u1", name: "Sam K", holds: false }, needsOwner: true })).toBe("Needs an owner (Sam K no longer has a care role)");
  });

  it("says when not to ask", () => {
    expect(restLine({ doNotAsk: true, restUntil: "2026-11-12", resting: true })).toBe("Do not ask until 12 November 2026");
    expect(restLine({ doNotAsk: true, restUntil: null, resting: true })).toBe("Do not ask");
    expect(restLine({ doNotAsk: true, restUntil: "2026-01-01", resting: false })).toBeNull();
    expect(restLine(null)).toBeNull();
  });

  it("writes dates as days, and recurring days without a year", () => {
    expect(formatDay("2026-11-12")).toBe("12 November 2026");
    expect(formatMonthDay("2005-06-01")).toBe("1 June");
    expect(formatDay(null)).toBe("");
  });

  it("describes each touch in one line, never with a message's subject", () => {
    expect(touchLine({ source: "manual", kind: "check_in", channel: "phone", outcome: "no_answer", isAsk: false, label: null, opened: null })).toBe("Check-in · phone · No answer · No ask");
    expect(touchLine({ source: "manual", kind: "other", channel: "in_person", outcome: "done", isAsk: true, label: null, opened: null })).toBe("Something else · in person · Ask");
    expect(touchLine({ source: "message", kind: null, channel: "email", outcome: "sent", isAsk: false, label: "Newsletter", opened: true })).toBe("Email: Newsletter · Opened");
    expect(touchLine({ source: "check_in", kind: null, channel: "in_person", outcome: "done", isAsk: false, label: "Harvest supper", opened: null })).toBe("Event check-in: Harvest supper");
    expect(touchLine({ source: "receipt", kind: null, channel: null, outcome: "done", isAsk: false, label: "Receipt R-1", opened: null })).toBe("Receipt R-1");
  });

  it("never identifies a household by its name alone", () => {
    expect(householdLine(parseCard(cardJson("Donor care")).household)).toBe("GC-H-0041 · F-12 · Austin · Ama Mensah");
  });

  it("knows a refusal from a failure", () => {
    expect(isNoAccess({ code: "42501", message: "You don't have access to this area." })).toBe(true);
    expect(isNoAccess({ code: "P0001", message: "boom" })).toBe(false);
    expect(offSentence({ message: "Donor care is not on for this community." })).toBe("Donor care is not on for this community.");
    expect(offSentence({ message: "boom" })).toBeNull();
    expect(NO_ACCESS).toBe("You don't have access to this area");
  });
});

describe("the touch log, the list and the picker", () => {
  it("reads the touch log: amounts only when the database sent them", () => {
    const page = parseTouchPage({
      rows: [
        { source: "receipt", id: "p1", at: "2026-10-10T00:00:00Z", label: "Receipt R-1", amount_cents: null, can_remove: false },
        { source: "manual", id: "t1", at: "2026-10-09T00:00:00Z", kind: "thank_you", channel: "post", outcome: "done", is_ask: false, can_remove: true },
      ],
      more: true,
      amounts: false,
    });
    expect(page.rows[0].amountCents).toBeNull();
    expect(page.rows[1]).toMatchObject({ source: "manual", canRemove: true, key: "manual:t1" });
    expect(page.more).toBe(true);
  });

  it("reads the list with its counts (a care.own holder gets no 'all' or 'needs an owner' count)", () => {
    const list = parseList({ filter: "mine", total: 1, limit: 50, offset: 0, rows: [{ household, owner: "Sam K", owner_holds: true, mine: true, needs_owner: false, resting: false }], counts: { mine: 1, resting: 0, all: null, needs_owner: null }, label: "Member care", can: { all: false, manage: false } });
    expect(list.counts).toEqual({ all: null, mine: 1, needsOwner: null, resting: 0 });
    expect(list.rows[0].household.number).toBe("GC-H-0041");
    expect(parseList({ filter: "everything" }).filter).toBe("mine");
  });

  it("reads the people who can own a household", () => {
    expect(parseHolders([{ user_id: "u1", name: "Sam K", level: "own" }, { user_id: "u2", level: "boss" }, "x"])).toEqual([{ userId: "u1", name: "Sam K", level: "own" }]);
  });

  it("has the one-tap touches the plan names, none of them an ask", () => {
    expect(TOUCH_PRESETS.map((p) => p.label)).toEqual(expect.arrayContaining(["Called, no answer", "Card sent", "Visited"]));
    expect(TOUCH_PRESETS.every((p) => !p.touch.is_ask)).toBe(true);
  });
});

describe("who sees WeCare in the navigation (convenience: the database decides)", () => {
  const lead: ScopedContext = { permissions: ["care.view", "care.manage"], isPlatformAdmin: false, modulesOff: [] };
  const owner: ScopedContext = { permissions: ["care.own"], isPlatformAdmin: false, modulesOff: [] };
  const platform: ScopedContext = { permissions: ["people.view"], isPlatformAdmin: true, modulesOff: [] };
  const careTab = { access: "care", module: "care" } as const;

  it("shows the WeCare area to a care role while the product is on", () => {
    expect(canOpenTab(lead, careTab)).toBe(true);
    expect(canOpenTab(owner, careTab)).toBe(true);
    expect(careCan(owner, "own")).toBe(true);
    expect(careCan(owner, "view")).toBe(false);
    expect(visibleNav({ ...lead, kind: KINDS.church }).find((m) => m.key === "care")?.label).toBe("Member care");
    expect(visibleNav({ ...lead, kind: KINDS.chamber }).find((m) => m.key === "care")?.label).toBe("Donor care");
  });

  it("never to a platform admin, and to nobody while the product is off", () => {
    expect(canOpenTab(platform, careTab)).toBe(false);
    expect(careCan(platform, "own")).toBe(false);
    expect(visibleNav(platform).some((m) => m.key === "care")).toBe(false);
    expect(canOpenTab({ ...lead, modulesOff: ["care"] }, careTab)).toBe(false);
    expect(careCan({ ...lead, modulesOff: ["care"] }, "view")).toBe(false);
  });

  it("puts WeCare in the People workspace", () => {
    expect(workspaceCoverageProblems()).toEqual([]);
  });
});
