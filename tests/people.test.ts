import { describe, expect, it } from "vitest";

import {
  bestTier,
  changedKeys,
  dobBounds,
  formatPhone,
  genderLabel,
  genderValue,
  householdSubline,
  isAgeBand,
  listPhrase,
  normalizePhone,
  parseDateInput,
  parseHouseholdForm,
  parsePersonForm,
  relationshipLabel,
  saveLabel,
  tierLabel,
  tierTone,
  toUsDate,
  yearsBefore,
} from "@/lib/people";

describe("labels", () => {
  it("names relationships the way the prototype does", () => {
    expect(relationshipLabel("primary")).toBe("Primary");
    expect(relationshipLabel("child", "F")).toBe("Daughter");
    expect(relationshipLabel("child", "male")).toBe("Son");
    expect(relationshipLabel("child", null)).toBe("Child");
    expect(relationshipLabel(undefined)).toBe("—");
  });

  it("normalises gender and tiers", () => {
    expect(genderValue("Female")).toBe("female");
    expect(genderValue("m")).toBe("male");
    expect(genderValue("x")).toBe("");
    expect(genderLabel("prefer_not_to_say")).toBe("Prefer not to say");
    expect(tierLabel("life")).toBe("Life");
    expect(tierTone("life")).toBe("success");
    expect(tierTone("yearly")).toBe("navy");
    expect(tierTone("community")).toBe("neutral");
    expect(bestTier([{ tier: "community" }, { tier: "life" }, { tier: "yearly" }])?.tier).toBe("life");
  });

  it("builds the household sub-line", () => {
    expect(householdSubline({ tier: "life", since: "2012-04-01", zone: "West", phone: "+17135550142" })).toBe(
      "Life members since 2012 · West zone · (713) 555-0142",
    );
    expect(householdSubline({ tier: null, zone: null })).toBe("No active membership");
  });

  it("labels the dirty-state save button", () => {
    expect(saveLabel(0)).toBe("No changes");
    expect(saveLabel(1)).toBe("Save 1 change");
    expect(saveLabel(3)).toBe("Save 3 changes");
    expect(listPhrase(["name", "zone", "ZIP code"])).toBe("name, zone and ZIP code");
    expect(listPhrase(["name"])).toBe("name");
  });
});

describe("age bands", () => {
  it("computes date-of-birth cut-offs", () => {
    expect(yearsBefore("2026-09-24", 18)).toBe("2008-09-24");
    expect(yearsBefore("2024-02-29", 1)).toBe("2023-02-28");
    expect(dobBounds("adults", "2026-09-24")).toEqual({ onOrBefore: "2008-09-24", includeUnknown: true });
    expect(dobBounds("minors", "2026-09-24")).toEqual({ after: "2008-09-24", includeUnknown: false });
    expect(dobBounds("seniors", "2026-09-24")).toEqual({ onOrBefore: "1961-09-24", includeUnknown: false });
    expect(isAgeBand("roles")).toBe(true);
    expect(isAgeBand("kids")).toBe(false);
  });
});

describe("validation", () => {
  it("normalises phone numbers to E.164", () => {
    expect(normalizePhone("(713) 555-0142")).toEqual({ ok: true, value: "+17135550142" });
    expect(normalizePhone("1-713-555-0142")).toEqual({ ok: true, value: "+17135550142" });
    expect(normalizePhone("+91 98200 12345")).toEqual({ ok: true, value: "+919820012345" });
    expect(normalizePhone("")).toEqual({ ok: true, value: null });
    expect(normalizePhone("555-0142").ok).toBe(false);
    expect(formatPhone("+17135550142")).toBe("(713) 555-0142");
  });

  it("reads US and ISO dates, refusing impossible ones", () => {
    expect(parseDateInput("03/14/1985")).toEqual({ ok: true, value: "1985-03-14" });
    expect(parseDateInput("1985-3-4")).toEqual({ ok: true, value: "1985-03-04" });
    expect(parseDateInput("02/30/2020").ok).toBe(false);
    expect(parseDateInput("yesterday").ok).toBe(false);
    expect(toUsDate("1985-03-14")).toBe("03/14/1985");
  });

  it("parses the person form, leaving out fields the form did not send", () => {
    const r = parsePersonForm(
      { first_name: " Priya ", last_name: "Shah", date_of_birth: "03/14/1985", gender: "female", email: "Priya@Example.com", phone_e164: "713 555 0142", language: "gu", photo_opt_in: "on", new_member_contact_opt_in: "off" },
      "2026-09-24",
    );
    expect(r).toEqual({
      ok: true,
      value: {
        first_name: "Priya",
        last_name: "Shah",
        date_of_birth: "1985-03-14",
        gender: "female",
        email: "priya@example.com",
        phone_e164: "+17135550142",
        language: "gu",
        photo_opt_in: true,
        new_member_contact_opt_in: false,
      },
    });
    expect(parsePersonForm({ first_name: "" }, "2026-09-24")).toEqual({ ok: false, error: "First name is required" });
    expect(parsePersonForm({ date_of_birth: "01/01/2030" }, "2026-09-24")).toEqual({ ok: false, error: "The date of birth is in the future" });
    expect(parsePersonForm({ email: "nope" }, "2026-09-24").ok).toBe(false);
    expect(parsePersonForm({ language: "fr" }, "2026-09-24").ok).toBe(false);
  });

  it("parses the household form and checks the zone belongs to the center", () => {
    const zone = "11111111-1111-4111-8111-111111111111";
    expect(parseHouseholdForm({ display_name: "Shah, Priya & Rahul", zone_id: zone, directory_opt_in: "on", postal_code: "77494" }, [zone])).toEqual({
      ok: true,
      value: { display_name: "Shah, Priya & Rahul", zone_id: zone, directory_opt_in: true, postal_code: "77494" },
    });
    expect(parseHouseholdForm({ zone_id: "22222222-2222-4222-8222-222222222222" }, [zone]).ok).toBe(false);
    expect(parseHouseholdForm({ display_name: "  " }, [zone]).ok).toBe(false);
    expect(parseHouseholdForm({ zone_id: "" }, [zone])).toEqual({ ok: true, value: { zone_id: null } });
  });

  it("counts real changes only", () => {
    expect(changedKeys<Record<string, unknown>>({ a: "x", b: null, c: true }, { a: "x", b: "", c: false })).toEqual(["c"]);
  });
});
