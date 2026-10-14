import { describe, expect, it } from "vitest";

import {
  ADD_RELATIONSHIPS,
  EMPTY_ADD,
  NO_ACCESS_TEXT,
  accountLines,
  addIdKinds,
  addedSentence,
  allNoAccess,
  checkAddPerson,
  closeHref,
  detailSubline,
  drawnSections,
  familyHrefFor,
  groupIds,
  homeChoice,
  householdLine,
  isChildDraft,
  part,
  personMenu,
  profileDetailLines,
  retiredIds,
  rolesLines,
  sectionPlan,
  shapeIdRows,
  slideOverHref,
  slideOverRequest,
  suggestedLastName,
  type AccountFacts,
  type DetailHousehold,
  type IdRow,
  type RolesFacts,
} from "@/lib/people-v2/slideover";

const TODAY = "2026-10-12";
const CHECK = { today: TODAY, majority: 18 };
const hrefs = { details: "/h?person=p", move: "/h?person=p&mode=move", merge: "/people/merge?person=p" };

describe("the section plan", () => {
  const plan = (o: Partial<Parameters<typeof sectionPlan>[0]> = {}) =>
    sectionPlan({ isChild: false, givingByPerson: true, givingOn: true, hasHistory: true, ...o });

  it("opens Profile and Account and sign-in, and keeps the rest closed, in the order the plan gives", () => {
    const drawn = drawnSections(plan());
    expect(drawn.map((s) => s.key)).toEqual(["profile", "account", "roles", "privacy", "ids", "memberships", "giving", "history"]);
    expect(drawn.filter((s) => s.open).map((s) => s.key)).toEqual(["profile", "account"]);
  });

  it("keeps a marked place for Custom fields right under Profile and for Notes before History, drawing nothing for them", () => {
    const all = plan();
    expect(all.map((s) => s.key)).toEqual(["profile", "custom_fields", "account", "roles", "privacy", "ids", "memberships", "giving", "notes", "history"]);
    expect(all.filter((s) => s.reserved).map((s) => [s.key, s.reserved])).toEqual([
      ["custom_fields", "custom-fields"],
      ["notes", "notes"],
    ]);
    expect(drawnSections(all).some((s) => s.reserved)).toBe(false);
  });

  it("has Giving at a glance only when the community reads giving by person, the module is on and the person is an adult", () => {
    expect(plan().some((s) => s.key === "giving")).toBe(true);
    expect(plan({ givingByPerson: false }).some((s) => s.key === "giving")).toBe(false);
    expect(plan({ givingOn: false }).some((s) => s.key === "giving")).toBe(false);
    expect(plan({ isChild: true }).some((s) => s.key === "giving")).toBe(false);
  });
});

describe("the account lines", () => {
  const facts = (o: Partial<AccountFacts> = {}): AccountFacts => ({ linkedAt: "2026-03-03T15:00:00Z", hasEmail: true, hasMobile: true, childLoginAge: 13, ...o });
  const lines = (o: Partial<Parameters<typeof accountLines>[0]> = {}) =>
    accountLines({ isChild: false, age: 41, account: part.ok(facts()), memberNumber: "M-10482", timeZone: "America/Chicago", ...o });
  const get = (l: ReturnType<typeof lines>, label: string) => l.find((x) => x.label === label);

  it("says the app account is active with its date, the sign-in methods and the member card", () => {
    const l = lines();
    expect(get(l, "App account")).toMatchObject({ value: "Active · linked Mar 3, 2026", tone: "ok" });
    expect(get(l, "Sign-in methods")?.value).toBe("Code by email and mobile");
    expect(get(l, "Member card")?.value).toBe("Rotating QR · M-10482");
  });

  it("shows the printed sign-in code as coming next, never as a working thing", () => {
    expect(get(lines(), "Printed sign-in code")).toMatchObject({ soon: true });
  });

  it("says not signed in yet, and has no methods, for someone who never linked", () => {
    const l = lines({ account: part.ok(facts({ linkedAt: null })) });
    expect(get(l, "App account")).toMatchObject({ value: "Not signed in yet", tone: "warn" });
    expect(get(l, "Sign-in methods")?.value).toBe("—");
  });

  it("names the one contact method someone has", () => {
    expect(get(lines({ account: part.ok(facts({ hasMobile: false })) }), "Sign-in methods")?.value).toBe("Code by email");
  });

  it("says a child's account is managed by the parents until the community's login age, with no printed code", () => {
    const l = lines({ isChild: true, age: 11, memberNumber: null });
    expect(get(l, "App account")?.value).toBe("Managed by parents until age 13");
    expect(get(l, "Member card")?.value).toBe("No member number yet");
    expect(get(l, "Printed sign-in code")?.value).toBe("—");
    expect(get(l, "Printed sign-in code")?.soon).toBeUndefined();
  });

  it("treats a child at or above the login age as having their own account lines (no printed code for a child)", () => {
    const l = lines({ isChild: true, age: 15 });
    expect(get(l, "App account")?.value).toMatch(/^Active/);
    expect(get(l, "Printed sign-in code")).toBeUndefined();
  });

  it("says in words when the account could not be read, and when this role may not read it", () => {
    const bad = lines({ account: part.error("Could not load the app account: connection reset") });
    expect(get(bad, "App account")).toMatchObject({ tone: "bad", value: "Could not load the app account" });
    expect(lines({ account: part.noAccess() })).toEqual([{ label: "App account", value: NO_ACCESS_TEXT, tone: "muted" }]);
  });
});

describe("roles, teams and waivers", () => {
  const facts = (o: Partial<RolesFacts> = {}): RolesFacts => ({ roles: part.ok(["Volunteer coordinator", "Treasurer"]), waiver: part.ok("Signed"), background: part.ok("Clear"), ...o });

  it("lists the roles, the waiver and the background check", () => {
    const l = rolesLines({ isChild: false, facts: facts() });
    expect(l.map((x) => [x.label, x.value])).toEqual([
      ["Roles", "Volunteer coordinator, Treasurer"],
      ["Volunteer waiver", "Signed"],
      ["Background check", "Clear"],
    ]);
  });

  it("says None for no roles, and says a child's waiver is signed by a parent and a background check does not apply", () => {
    const l = rolesLines({ isChild: true, facts: facts({ roles: part.ok([]) }) });
    expect(l.map((x) => x.value)).toEqual(["None", "Parent signs", "Not applicable"]);
  });

  it("says 'You don't have access to this area' for a part this role cannot read, and says it once when all three are refused", () => {
    const one = rolesLines({ isChild: false, facts: facts({ waiver: part.noAccess() }) });
    expect(one[1].value).toBe(NO_ACCESS_TEXT);
    expect(allNoAccess(one)).toBe(false);
    const none = rolesLines({ isChild: false, facts: facts({ roles: part.noAccess(), waiver: part.noAccess(), background: part.noAccess() }) });
    expect(allNoAccess(none)).toBe(true);
  });

  it("says a failed read in words rather than showing nothing", () => {
    const l = rolesLines({ isChild: false, facts: facts({ roles: part.error("x") }) });
    expect(l[0]).toMatchObject({ value: "Could not load the roles", tone: "bad" });
  });
});

describe("what the member gave in the app", () => {
  const details = {
    anniversary: "2009-06-20",
    dietary: [
      { label: "Vegetarian", retired: false },
      { label: "Halal", retired: true },
    ],
    emergency: { name: "田中 健", relationship: "Brother", phone: "+81312345678" },
    labelsNote: null,
  };

  it("shows the anniversary, dietary needs (a retired choice still reads) and the emergency contact with the number formatted", () => {
    const l = profileDetailLines({ isChild: false, firstName: "Misaki", details: part.ok(details) });
    expect(l.map((x) => x.label)).toEqual(["Anniversary", "Dietary needs", "Emergency contact"]);
    expect(l[0].value).toBe("06/20/2009");
    expect(l[1].value).toBe("Vegetarian, Halal (no longer offered)");
    expect(l[2].value).toContain("田中 健 (brother)");
  });

  it("leaves out the anniversary for a child and says a parent adds the emergency contact", () => {
    const l = profileDetailLines({ isChild: true, firstName: "Layla", details: part.ok({ ...details, emergency: null }) });
    expect(l.map((x) => x.label)).toEqual(["Dietary needs", "Emergency contact for Layla"]);
    expect(l[1].value).toBe("Not given. A parent adds it in the app.");
  });

  it("says Not given where nothing was given", () => {
    const l = profileDetailLines({ isChild: false, firstName: "Inés", details: part.ok({ anniversary: null, dietary: [], emergency: null, labelsNote: null }) });
    expect(l.map((x) => x.value)).toEqual(["Not given", "Not given", "Not given"]);
  });

  it("says no access and a failed read in words", () => {
    expect(profileDetailLines({ isChild: false, firstName: "A", details: part.noAccess() })[0].value).toBe(NO_ACCESS_TEXT);
    expect(profileDetailLines({ isChild: false, firstName: "A", details: part.error("x") })[0].tone).toBe("bad");
  });
});

describe("IDs as chips", () => {
  const rules = { orgMemberSystem: "org_register", orgHouseholdSystem: "org_register", legacySystems: [{ system: "neon", label: "Neon ID" }] };
  const labels: Record<string, string> = {
    connect_member: "Member no.",
    org_member: "Community member ID",
    crm: "Legacy CRM id",
    accounting: "Accounting (QuickBooks) customer",
    bank_payer: "Bank payer name",
    payment_provider: "Payment-provider customer",
    other: "Other identifier",
    org_household: "Community household ID",
  };
  const labelOf = (k: string) => labels[k] ?? k;
  const rows: IdRow[] = [
    { id: "1", kind: "org_member", system: "org_register", value: "0482", valid_to: null },
    { id: "2", kind: "crm", system: "neon", value: "20417", valid_to: null },
    { id: "3", kind: "crm", system: "neon", value: "19110", valid_to: "2025-12-31" },
    { id: "4", kind: "accounting", system: "quickbooks", value: "1187", valid_to: null },
    { id: "5", kind: "bank_payer", system: "bank", value: "S HASSAN", valid_to: null },
    { id: "6", kind: "org_household", system: "org_register", value: "RCC-H-1102", valid_to: null },
    { id: "7", kind: "mystery", system: "x", value: "zzz", valid_to: null },
  ];
  const shape = (o: { finance: boolean; manage?: (k: string) => boolean }) =>
    shapeIdRows({
      rows,
      memberNumber: "M-10482",
      today: TODAY,
      labelOf,
      canView: (k) => o.finance || !["accounting", "bank_payer", "payment_provider"].includes(k),
      canManage: o.manage ?? (() => true),
    });

  it("puts the member number first, groups by kind in the kinds' order and leaves out household-only and unknown kinds", () => {
    const groups = groupIds(shape({ finance: true }));
    expect(groups.map((g) => g.kind)).toEqual(["connect_member", "org_member", "crm", "accounting", "bank_payer"]);
    expect(groups[0].items[0]).toMatchObject({ value: "M-10482", canRetire: false });
    expect(groups.flatMap((g) => g.items.map((i) => i.value))).not.toContain("RCC-H-1102");
    expect(groups.flatMap((g) => g.items.map((i) => i.value))).not.toContain("zzz");
  });

  it("shows finance kinds only to people who may read them", () => {
    const kinds = groupIds(shape({ finance: false })).map((g) => g.kind);
    expect(kinds).toEqual(["connect_member", "org_member", "crm"]);
    expect(kinds).not.toContain("accounting");
    expect(kinds).not.toContain("bank_payer");
  });

  it("keeps a retired ID apart from the live ones, and offers Retire only on a live ID of a kind this role manages", () => {
    const all = shape({ finance: true, manage: (k) => k !== "accounting" });
    expect(retiredIds(all).map((i) => i.value)).toEqual(["19110"]);
    expect(groupIds(all).flatMap((g) => g.items).find((i) => i.value === "20417")?.canRetire).toBe(true);
    expect(groupIds(all).flatMap((g) => g.items).find((i) => i.value === "1187")?.canRetire).toBe(false);
    expect(retiredIds(all)[0].canRetire).toBe(false);
  });

  it("offers to add only person kinds this role manages, with the community's own systems and labels", () => {
    const kinds = addIdKinds({ canManage: (k) => k !== "payment_provider", labelOf, rules, hints: { crm: "An id from a system that was retired." } });
    expect(kinds.map((k) => k.kind)).toEqual(["org_member", "crm", "other", "accounting", "bank_payer"]);
    expect(kinds.find((k) => k.kind === "crm")).toMatchObject({ systems: [{ system: "neon", label: "Neon ID" }], hint: "An id from a system that was retired." });
    expect(kinds.find((k) => k.kind === "org_member")?.systems).toEqual([{ system: "org_register", label: null }]);
    expect(addIdKinds({ canManage: () => false, labelOf, rules })).toEqual([]);
  });
});

describe("the more menu", () => {
  const menu = (o: Partial<Parameters<typeof personMenu>[0]> = {}) =>
    personMenu({ surface: "card", canEdit: true, isChild: false, deceased: false, hasHousehold: true, hrefs, ...o });
  const keys = (o: Partial<Parameters<typeof personMenu>[0]> = {}) => menu(o).map((i) => i.key);

  it("offers open details, move, merge, the printed code and mark as deceased on a card, with the red one last", () => {
    expect(keys()).toEqual(["details", "move", "merge", "code", "deceased"]);
    expect(menu().at(-1)).toMatchObject({ key: "deceased", danger: true, kind: "action" });
  });

  it("leaves out Open details in the slide-over's own menu", () => {
    expect(keys({ surface: "panel" })).toEqual(["move", "merge", "code", "deceased"]);
  });

  it("shows the printed sign-in code switched off and says coming next", () => {
    expect(menu().find((i) => i.key === "code")).toMatchObject({ kind: "disabled", note: "Coming next" });
  });

  it("wires move and merge to the existing screens", () => {
    expect(menu().find((i) => i.key === "move")).toMatchObject({ kind: "link", href: hrefs.move });
    expect(menu().find((i) => i.key === "merge")).toMatchObject({ kind: "link", href: hrefs.merge });
  });

  it("has no printed code for a child, and 'Undo deceased' instead of Mark as deceased for someone recorded as deceased", () => {
    expect(keys({ isChild: true })).not.toContain("code");
    expect(keys({ deceased: true })).toContain("undo_deceased");
    expect(keys({ deceased: true })).not.toContain("deceased");
  });

  it("has no Move for someone in no family", () => {
    expect(keys({ hasHousehold: false })).not.toContain("move");
  });

  it("is only Open details on a card, and nothing in the panel, without people.manage", () => {
    expect(keys({ canEdit: false })).toEqual(["details"]);
    expect(keys({ canEdit: false, surface: "panel" })).toEqual([]);
  });
});

describe("addresses", () => {
  it("opens a person on the family page and keeps the rest of the address (the year, a tab), dropping the old drawer parameters", () => {
    expect(slideOverHref("/households/h1", { year: "2025", tab: "giving", hh: "x", app: "y", mode: "edit" }, "p1")).toBe("/households/h1?year=2025&tab=giving&person=p1");
    expect(slideOverHref("/households/h1", {}, "p1", "move")).toBe("/households/h1?person=p1&mode=move");
  });

  it("closes the slide-over and keeps the rest", () => {
    expect(closeHref("/households/h1", { year: "2025", person: "p1", mode: "move" })).toBe("/households/h1?year=2025");
    expect(closeHref("/households/h1", { person: "p1" })).toBe("/households/h1");
  });

  it("sends /people/[id] to the person's family with the slide-over open", () => {
    expect(familyHrefFor("h9", "p9", { year: "all" })).toBe("/households/h9?year=all&person=p9");
  });

  it("opens the slide-over for ?person=<id>, and keeps the classic drawers for the move flow and the household's old links", () => {
    const id = "b0000000-0000-4000-8000-000000000001";
    expect(slideOverRequest({ person: id })).toEqual({ kind: "slideover", personId: id });
    expect(slideOverRequest({ person: id, year: "2025" })).toEqual({ kind: "slideover", personId: id });
    expect(slideOverRequest({ person: id, mode: "move" })).toEqual({ kind: "classic" });
    expect(slideOverRequest({ hh: id })).toEqual({ kind: "classic" });
    expect(slideOverRequest({ person: "not-an-id" })).toEqual({ kind: "classic" });
    expect(slideOverRequest({})).toEqual({ kind: "classic" });
  });

  it("chooses where a person lives: one family, several, or none (a family they left does not count)", () => {
    expect(homeChoice([])).toEqual({ kind: "none" });
    expect(homeChoice([{ household_id: "a" }])).toEqual({ kind: "one", householdId: "a" });
    expect(homeChoice([{ household_id: "a" }, { household_id: "b" }])).toEqual({ kind: "many", householdIds: ["a", "b"] });
    expect(homeChoice([{ household_id: "a" }, { household_id: "b", left_at: "2026-01-01" }])).toEqual({ kind: "one", householdId: "a" });
    expect(homeChoice([{ household_id: "a", left_at: "2026-01-01" }])).toEqual({ kind: "none" });
    expect(homeChoice([{ household_id: "a" }, { household_id: "a" }])).toEqual({ kind: "one", householdId: "a" });
  });
});

describe("Add person", () => {
  const draft = (o: Partial<typeof EMPTY_ADD> = {}) => ({ ...EMPTY_ADD, first: "Zara", last: "Hassan", ...o });
  const check = (d: ReturnType<typeof draft>) => checkAddPerson(d, "hh-1", CHECK);

  it("starts as a child, the most common addition, with every relationship but primary offered", () => {
    expect(EMPTY_ADD.role).toBe("child");
    expect(ADD_RELATIONSHIPS.map((o) => o.value)).toEqual(["spouse", "child", "parent", "sibling", "other"]);
  });

  it("is enough with a first name, a last name and a relationship", () => {
    expect(check(draft())).toEqual({ ok: true, isChild: true, input: { household_id: "hh-1", first_name: "Zara", last_name: "Hassan", role: "child" } });
  });

  it("asks for the missing name or relationship in words, naming the field", () => {
    expect(check(draft({ first: "  " }))).toEqual({ ok: false, error: "Enter a first name", field: "first" });
    expect(check(draft({ last: "" }))).toEqual({ ok: false, error: "Enter a last name", field: "last" });
    expect(check(draft({ role: "primary" }))).toMatchObject({ ok: false, field: "role" });
    expect(check(draft({ role: "" }))).toMatchObject({ ok: false, field: "role" });
  });

  it("takes a name in any script as it is", () => {
    const r = check(draft({ first: "美咲", last: "田中", role: "spouse" }));
    expect(r).toMatchObject({ ok: true, input: { first_name: "美咲", last_name: "田中" } });
  });

  it("checks the birth date, mobile and email with the sentences the forms use, and stores them as the database does", () => {
    expect(check(draft({ role: "spouse", dob: "13/45/1990" }))).toMatchObject({ ok: false, field: "dob" });
    expect(check(draft({ role: "spouse", dob: "01/01/2030" }))).toEqual({ ok: false, error: "The date of birth is in the future", field: "dob" });
    expect(check(draft({ role: "spouse", phone: "12" }))).toMatchObject({ ok: false, field: "phone" });
    expect(check(draft({ role: "spouse", email: "nope" }))).toEqual({ ok: false, error: "That email address does not look right", field: "email" });
    const good = check(draft({ role: "spouse", dob: "03/14/1990", phone: "(713) 555-0142", email: "Zara.Hassan@Example.org" }));
    expect(good).toMatchObject({
      ok: true,
      isChild: false,
      input: { date_of_birth: "1990-03-14", phone_e164: "+17135550142", email: "zara.hassan@example.org" },
    });
  });

  it("sends no mobile or email for a child, even if some was typed before the relationship changed: contact is via parents", () => {
    const r = check(draft({ role: "child", dob: "07/21/2015", phone: "(713) 555-0142", email: "kid@example.org" }));
    expect(r).toMatchObject({ ok: true, isChild: true });
    if (r.ok) expect(Object.keys(r.input)).toEqual(["household_id", "first_name", "last_name", "role", "date_of_birth"]);
  });

  it("treats a grown-up 'child' (the family's adult son) as an adult with contact details, and a young 'sibling' as a child", () => {
    expect(isChildDraft({ role: "child", dob: "03/14/1995" }, CHECK)).toBe(false);
    expect(isChildDraft({ role: "child", dob: "" }, CHECK)).toBe(true);
    expect(isChildDraft({ role: "sibling", dob: "05/05/2015" }, CHECK)).toBe(true);
    expect(isChildDraft({ role: "spouse", dob: "" }, CHECK)).toBe(false);
    const r = check(draft({ role: "child", dob: "03/14/1995", phone: "(713) 555-0142" }));
    expect(r).toMatchObject({ ok: true, isChild: false, input: { phone_e164: "+17135550142" } });
  });

  it("uses a community's own age of majority above 18", () => {
    expect(isChildDraft({ role: "child", dob: "03/14/2007" }, { today: TODAY, majority: 21 })).toBe(true);
    expect(isChildDraft({ role: "child", dob: "03/14/2007" }, { today: TODAY, majority: 18 })).toBe(false);
  });

  it("starts the last name from the primary member's stored last name, not the last word of a display name", () => {
    const adults = [
      { isPrimary: false, values: { last_name: "Haddad" } },
      { isPrimary: true, values: { last_name: "田中" } },
    ];
    expect(suggestedLastName(adults)).toBe("田中");
    expect(suggestedLastName([{ isPrimary: false, values: { last_name: "Valdés" } }])).toBe("Valdés");
    expect(suggestedLastName([])).toBe("");
  });

  it("says who was added and in what part", () => {
    expect(addedSentence("Zara Hassan", "child")).toBe("Zara Hassan was added to the family (child)");
    expect(addedSentence("Omar Haddad", "spouse")).toBe("Omar Haddad was added to the family (spouse)");
  });
});

describe("the household line and the subline", () => {
  const h: DetailHousehold = { id: "h", name: "Hassan household", number: "0301", orgLabel: "Community household ID", orgIds: ["RCC-H-1102"], adults: ["Samira Hassan", "Karim Hassan"], place: "Riverside, North Riverside" };

  it("is the household card as plain facts: the name, the number, the organization's id, the adults and the place", () => {
    expect(householdLine(h)).toEqual(["Hassan household", "No. 0301", "RCC-H-1102", "Samira & Karim Hassan", "Riverside, North Riverside"]);
  });

  it("says when a household has no number yet instead of leaving a name alone", () => {
    expect(householdLine({ ...h, number: null, orgIds: [], adults: [], place: null })).toEqual(["Hassan household", "No household number yet"]);
  });

  it("writes the relationship and the age, or only the age for someone in no household", () => {
    const p = { role: "spouse" as const, isPrimary: false, age: 43, values: { gender: "male" } };
    expect(detailSubline(p, true)).toBe("Spouse · age 43");
    expect(detailSubline({ ...p, isPrimary: true }, true)).toBe("Primary · age 43");
    expect(detailSubline({ ...p, role: "child", age: 11, values: { gender: "female" } }, true)).toBe("Daughter · age 11");
    expect(detailSubline(p, false)).toBe("age 43");
    expect(detailSubline({ ...p, age: null }, false)).toBe("");
  });
});
