import { describe, expect, it } from "vitest";

import {
  addressLines,
  adultsLine,
  avatarTone,
  familyChips,
  familyTabs,
  householdValues,
  initialsOf,
  onAppSummary,
  personSubline,
  personValues,
  pickFamilyTab,
} from "@/lib/people-v2/family-model";

import { familyFixture } from "@/app/dev/people-family/fixtures";

describe("initials", () => {
  it("takes the first letter of the first and last name, in any script, without splitting a character", () => {
    expect(initialsOf("Samira Hassan")).toBe("SH");
    expect(initialsOf("田中 美咲")).toBe("田美");
    expect(initialsOf("Фёдор Иванов")).toBe("ФИ");
    expect(initialsOf("𠮷田 太郎")).toBe("𠮷太");
    expect(initialsOf("Madonna")).toBe("M");
    expect(initialsOf("   ")).toBe("?");
  });
  it("gives the same person the same colour", () => {
    expect(avatarTone("p-samira")).toBe(avatarTone("p-samira"));
  });
});

describe("the household card line", () => {
  it("joins adults who share a last name and never needs a child", () => {
    expect(adultsLine(["Samira Hassan", "Karim Hassan"])).toBe("Samira & Karim Hassan");
    expect(adultsLine(["Tunde Adeyemi", "Folake Adeyemi", "Chinedu Adeyemi"])).toBe("Tunde, Folake & Chinedu Adeyemi");
    expect(adultsLine(["田中 美咲", "Omar Haddad"])).toBe("田中 美咲 & Omar Haddad");
    expect(adultsLine(["Inés Valdés"])).toBe("Inés Valdés");
    expect(adultsLine([])).toBe("");
  });
  it("counts who is on the app, in words", () => {
    expect(onAppSummary([{ onApp: true }, { onApp: false }]).text).toBe("On the app: 1 of 2 adults");
    expect(onAppSummary([{ onApp: false }]).text).toBe("On the app: 0 of 1 adult");
  });
  it("lists the address as it reads, leaving out what is empty", () => {
    expect(addressLines({ address_line1: "14 Maple Court", address_line2: "", city: "Riverside", state_region: "TX", postal_code: "77030" })).toEqual(["14 Maple Court", "Riverside, TX 77030"]);
    expect(addressLines({ address_line1: "", address_line2: "", city: "", state_region: "", postal_code: "" })).toEqual([]);
    expect(addressLines({ address_line1: "1 Rue de la Paix", address_line2: "", city: "Paris", state_region: "", postal_code: "75002" })).toEqual(["1 Rue de la Paix", "Paris, 75002"]);
  });
});

describe("stored values", () => {
  it("makes a person's editable values: nothing is \"\", a legacy gender is read, an email is lower case", () => {
    const v = personValues(
      { first_name: "Priya", last_name: "Shah", date_of_birth: null, gender: "F", profession: null, employer: null, phone_e164: "+15125550101", email: "Priya@Example.org", language: null },
      "spouse",
    );
    expect(v).toEqual({
      first_name: "Priya",
      last_name: "Shah",
      preferred_name: "",
      date_of_birth: "",
      gender: "female",
      profession: "",
      employer: "",
      phone_e164: "+15125550101",
      email: "priya@example.org",
      language: "",
      role: "spouse",
    });
  });
  it("makes a household's: a household that never answered still gets the mail", () => {
    const v = householdValues({ display_name: "Shah", address_line1: null, address_line2: null, city: "Austin", state_region: null, postal_code: null, zone_id: null, directory_opt_in: null, physical_mail_opt_in: null, notes: null });
    expect(v).toMatchObject({ display_name: "Shah", city: "Austin", address_line1: "", directory_opt_in: "off", physical_mail_opt_in: "on", notes: "" });
    expect(householdValues({ display_name: "x", address_line1: null, address_line2: null, city: null, state_region: null, postal_code: null, zone_id: null, directory_opt_in: true, physical_mail_opt_in: false, notes: "n" })).toMatchObject({
      directory_opt_in: "on",
      physical_mail_opt_in: "off",
      notes: "n",
    });
  });
  it("says what a person is under their name: primary, or the relationship, and the age", () => {
    const hassan = familyFixture("hassan");
    expect(personSubline(hassan.adults[0])).toBe("Primary · age 41");
    expect(personSubline(hassan.adults[1])).toBe("Spouse · age 43");
    expect(personSubline(hassan.children[0])).toBe("Daughter · age 11");
  });
});

describe("the chips under the name", () => {
  it("shows the membership with its end, the open pledges and who is on the app", () => {
    const chips = familyChips(familyFixture("hassan"), "America/Chicago");
    expect(chips.map((c) => c.label)).toEqual(["Yearly membership · Mar 31, 2027", "Open pledges $300.00", "On the app: 2 of 2 adults"]);
  });
  it("leaves out what the viewer may not see or what is not there", () => {
    expect(familyChips(familyFixture("empty"), "America/Chicago").map((c) => c.label)).toEqual(["On the app: 0 of 1 adult"]);
    expect(familyChips(familyFixture("adeyemi"), "America/Chicago")[0].label).toBe("Life membership");
  });
});

describe("the tab row", () => {
  it("offers Giving only with giving, Events only with the Events module, and History", () => {
    expect(familyTabs({ giving: true, events: false, history: true }).map((t) => t.label)).toEqual(["Giving", "Memberships", "History"]);
    expect(familyTabs({ giving: false, events: false, history: true }).map((t) => t.label)).toEqual(["Memberships", "History"]);
    expect(familyTabs({ giving: true, events: true, history: true }).map((t) => t.label)).toEqual(["Giving", "Memberships", "Events", "History"]);
  });
  it("opens the tab asked for, the old pledges, payments and audit tabs open Giving and History, and anything else the first", () => {
    const tabs = familyTabs({ giving: true, events: false, history: true });
    expect(pickFamilyTab("memberships", tabs)).toBe("memberships");
    expect(pickFamilyTab("pledges", tabs)).toBe("giving");
    expect(pickFamilyTab("payments", tabs)).toBe("giving");
    expect(pickFamilyTab("audit", tabs)).toBe("history");
    expect(pickFamilyTab("events", tabs)).toBe("giving");
    expect(pickFamilyTab(undefined, tabs)).toBe("giving");
    expect(pickFamilyTab("pledges", familyTabs({ giving: false, events: false, history: true }))).toBe("memberships");
  });
});
