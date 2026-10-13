import { describe, expect, it } from "vitest";

import { SUGGESTION_KIND_KEYS, allSuggestions, suggestionsFor } from "@/lib/custom-field-suggestions";
import { asDef, type CustomFieldDef } from "@/lib/custom-fields";
import {
  ADD_FIELD_TEXT,
  CHILD_CUSTOM_NOTE,
  addFieldMode,
  addFieldTitle,
  applySuggestion,
  askAdminRequest,
  checkCustomDraft,
  checkNewField,
  customAccess,
  customConflictLine,
  customDisplay,
  customDraft,
  customProblem,
  customUnit,
  defKeyOf,
  emptyNewField,
  fieldKeyOf,
  inputShape,
  manageRows,
  newFieldFormData,
  orderedDefs,
  parseChoices,
  rowsFor,
  sameCustom,
  statusFormData,
  valuesOf,
  type NewFieldInput,
} from "@/lib/people-v2/custom-fields";
import { checkDraft, initialEdit, reduce, type CheckContext, type EditEvent } from "@/lib/people-v2/inline-edit";

const ctx: CheckContext = { today: "2026-10-12" };

let n = 0;
function def(over: Partial<CustomFieldDef> & { label: string; key: string }): CustomFieldDef {
  n += 1;
  return asDef({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    entity: "people",
    type: "text",
    choices: [],
    sensitivity: "staff",
    searchable: false,
    source: "manual",
    status: "active",
    sort: 0,
    ...over,
  });
}

describe("who may do what with custom fields", () => {
  it("lets people.view read, people.manage edit, and only settings.manage add a field", () => {
    expect(customAccess({ permissions: ["people.view"] }, { canEdit: false })).toEqual({ canRead: true, canEdit: false, canDefine: false });
    expect(customAccess({ permissions: ["people.manage"] }, { canEdit: true })).toEqual({ canRead: true, canEdit: true, canDefine: false });
    expect(customAccess({ permissions: ["people.manage", "settings.manage"] }, { canEdit: true })).toEqual({ canRead: true, canEdit: true, canDefine: true });
    expect(customAccess({ permissions: ["settings.manage"] }, { canEdit: false })).toEqual({ canRead: true, canEdit: false, canDefine: true });
  });

  it("refuses everything to a role that cannot read people or settings, whatever the page says", () => {
    expect(customAccess({ permissions: ["giving.view", "events.view"] }, { canEdit: true })).toEqual({ canRead: false, canEdit: false, canDefine: false });
    expect(customAccess({ permissions: [] }, { canEdit: true }).canRead).toBe(false);
  });

  it("gives a platform admin everything", () => {
    expect(customAccess({ permissions: [], isPlatformAdmin: true }, { canEdit: true })).toEqual({ canRead: true, canEdit: true, canDefine: true });
  });

  it("says Add a field to a settings holder and Ask an admin to everyone else who can see the group", () => {
    expect(ADD_FIELD_TEXT[addFieldMode({ canDefine: true })]).toBe("Add a field");
    expect(ADD_FIELD_TEXT[addFieldMode({ canDefine: false })]).toBe("Ask an admin");
  });
});

describe("the rows of a group", () => {
  const defs = [
    def({ label: "Volunteer skills", key: "volunteer_skills", sort: 2 }),
    def({ label: "Shirt size", key: "shirt_size", type: "choice", choices: ["S", "M", "L"], sort: 1 }),
    def({ label: "Old field", key: "old", status: "archived", sort: 0 }),
    def({ label: "Anniversary", key: "anniversary", type: "date", sort: 1 }),
  ];

  it("orders active fields by their order, then by name, and hides archived ones", () => {
    expect(orderedDefs(defs).map((d) => d.label)).toEqual(["Anniversary", "Shirt size", "Volunteer skills"]);
    expect(rowsFor(defs, {}).map((r) => r.key)).not.toContain("old");
  });

  it("holds each value as the text the database reads: dates ISO, money in decimals, yes/no as words", () => {
    const rows = rowsFor(
      [
        def({ label: "Anniversary", key: "anniversary", type: "date" }),
        def({ label: "Dues paid", key: "dues", type: "money" }),
        def({ label: "Newsletter", key: "news", type: "boolean" }),
        def({ label: "Children", key: "kids", type: "number" }),
        def({ label: "Skills", key: "skills" }),
      ],
      { anniversary: "2019-06-02", dues: 2550, news: true, kids: 3, skills: "Catering" },
    );
    expect(Object.fromEntries(rows.map((r) => [r.key, r.stored]))).toEqual({ anniversary: "2019-06-02", dues: "25.50", news: "Yes", kids: "3", skills: "Catering" });
    expect(valuesOf(rows)).toEqual({ "cf:anniversary": "2019-06-02", "cf:dues": "25.50", "cf:news": "Yes", "cf:kids": "3", "cf:skills": "Catering" });
  });

  it("marks only the fields the definition itself says members can see", () => {
    const rows = rowsFor(
      [def({ label: "A", key: "a" }), def({ label: "B", key: "b", sensitivity: "member_self" }), def({ label: "C", key: "c", sensitivity: "directory" })],
      {},
    );
    expect(rows.map((r) => r.membersSee)).toEqual([false, true, true]);
  });

  it("keeps a field named like a column (email, language) apart from that column", () => {
    expect(fieldKeyOf("email")).toBe("cf:email");
    expect(defKeyOf("cf:email")).toBe("email");
    const unit = customUnit(def({ label: "Email at work", key: "email", type: "email" }));
    expect(unit.fields).toEqual(["cf:email"]);
  });

  it("works in any script", () => {
    const rows = rowsFor([def({ label: "ボランティアの技能", key: "skills_ja", sort: 0 }), def({ label: "مقاس القميص", key: "shirt_ar", sort: 1 })], {
      skills_ja: "料理, 応急手当",
      shirt_ar: "كبير",
    });
    expect(rows.map((r) => [r.label, r.stored])).toEqual([
      ["ボランティアの技能", "料理, 応急手当"],
      ["مقاس القميص", "كبير"],
    ]);
  });
});

describe("showing a value the way its type reads", () => {
  const d = (type: CustomFieldDef["type"], choices: string[] = []) => def({ label: "X", key: "x", type, choices });
  it("formats dates, yes/no and money in the community's currency", () => {
    expect(customDisplay(d("date"), "2019-06-02", "USD")).toBe("06/02/2019");
    expect(customDisplay(d("boolean"), "Yes", "USD")).toBe("Yes");
    expect(customDisplay(d("boolean"), "No", "USD")).toBe("No");
    expect(customDisplay(d("money"), "25.50", "USD")).toBe("$25.50");
    expect(customDisplay(d("money"), "25.50", "EUR")).toMatch(/25[.,]50/);
    expect(customDisplay(d("money"), "25.50", "EUR")).not.toContain("$");
    expect(customDisplay(d("text"), "", "USD")).toBe("");
  });

  it("reads a date in the input as MM/DD/YYYY and leaves other types as they are", () => {
    expect(customDraft(d("date"), "2019-06-02")).toBe("06/02/2019");
    expect(customDraft(d("text"), "2019-06-02")).toBe("2019-06-02");
    expect(customDraft(d("money"), "25.50")).toBe("25.50");
  });

  it("picks a list for choice and yes/no and the right keyboard for the rest", () => {
    expect(inputShape(d("choice", ["S", "M"]), "USD")).toMatchObject({ control: "select", options: [{ value: "S" }, { value: "M" }] });
    expect(inputShape(d("boolean"), "USD").options.map((o) => o.value)).toEqual(["Yes", "No"]);
    expect(inputShape(d("date"), "USD")).toMatchObject({ control: "input", placeholder: "MM/DD/YYYY" });
    expect(inputShape(d("money"), "JPY")).toMatchObject({ inputMode: "decimal", placeholder: "Amount in JPY" });
    expect(inputShape(d("email"), "USD").inputMode).toBe("email");
  });
});

describe("checking what was typed, by the field's type", () => {
  const check = (type: CustomFieldDef["type"], typed: string, choices: string[] = [], label = "Anniversary") =>
    checkCustomDraft(def({ label, key: "k", type, choices }), typed);

  it("turns a typed date into the stored one and says how a date is written when it is not one", () => {
    expect(check("date", "03/14/2026")).toEqual({ ok: true, stored: "2026-03-14" });
    expect(check("date", "3/4/2026")).toEqual({ ok: true, stored: "2026-03-04" });
    expect(check("date", "someday")).toEqual({ ok: false, error: "“Anniversary” takes a date as MM/DD/YYYY, like 03/14/2026" });
  });

  it("checks numbers, money, yes/no, email, link and phone with their own sentences", () => {
    expect(check("number", "3.5")).toEqual({ ok: true, stored: "3.5" });
    expect(check("number", "many", [], "Children")).toEqual({ ok: false, error: "“Children” takes a number, like 12 or 3.5" });
    expect(check("money", "25")).toEqual({ ok: true, stored: "25.00" });
    expect(check("money", "lots", [], "Dues")).toEqual({ ok: false, error: "“Dues” takes an amount, like 25 or 25.50" });
    expect(check("boolean", "yes")).toEqual({ ok: true, stored: "Yes" });
    expect(check("boolean", "maybe", [], "Newsletter")).toEqual({ ok: false, error: "“Newsletter” takes Yes or No" });
    expect(check("email", "Ana@Example.org")).toEqual({ ok: true, stored: "ana@example.org" });
    expect(check("email", "ana", [], "Work email").ok).toBe(false);
    expect(check("url", "https://example.org/x")).toEqual({ ok: true, stored: "https://example.org/x" });
    expect(check("url", "example", [], "Website")).toEqual({ ok: false, error: "“Website” takes a web address that starts with http:// or https://" });
    expect(check("phone", "(713) 555-0142")).toEqual({ ok: true, stored: "+17135550142" });
    expect(check("phone", "12", [], "Work phone").ok).toBe(false);
  });

  it("accepts a choice by its own spelling, in any script, and lists the choices when it is not one", () => {
    expect(check("choice", "m", ["S", "M", "L"], "Shirt size")).toEqual({ ok: true, stored: "M" });
    expect(check("choice", "XL", ["S", "M", "L"], "Shirt size")).toEqual({ ok: false, error: "“Shirt size” takes one of: S, M, L" });
    expect(check("choice", "大", ["小", "中", "大"], "サイズ")).toEqual({ ok: true, stored: "大" });
    expect(check("choice", "x", [], "Empty list")).toEqual({ ok: false, error: "“Empty list” has no choices yet" });
  });

  it("clears a value when the box is emptied, and refuses text that is too long", () => {
    expect(check("text", "   ")).toEqual({ ok: true, stored: "" });
    const long = check("text", "x".repeat(2001), [], "Notes");
    expect(long.ok).toBe(false);
    expect(customProblem(def({ label: "Notes", key: "n" }), "Notes is longer than 2,000 characters.")).toBe("Notes is longer than 2,000 characters");
  });
});

describe("a custom value runs through the same edit machine as every other value", () => {
  const unit = (over: Partial<CustomFieldDef> & { label: string; key: string }) => customUnit(def(over));

  function run(u: ReturnType<typeof unit>, start: Record<string, string>, events: EditEvent[]) {
    return events.reduce((s, e) => reduce(s, e, u, ctx), initialEdit(u, start));
  }

  it("starts with a date as MM/DD/YYYY, and Enter sends the stored date with the value it saw", () => {
    const u = unit({ label: "Anniversary", key: "anniversary", type: "date" });
    const started = run(u, { "cf:anniversary": "2019-06-02" }, [{ type: "start" }]);
    expect(started.draft["cf:anniversary"]).toBe("06/02/2019");
    const saving = run(u, { "cf:anniversary": "2019-06-02" }, [{ type: "start" }, { type: "change", key: "cf:anniversary", value: "7/9/2020" }, { type: "submit" }]);
    expect(saving.phase).toBe("saving");
    expect(saving.pending).toEqual({ fields: { "cf:anniversary": "2020-07-09" }, expect: { "cf:anniversary": "2019-06-02" }, reason: null });
  });

  it("shows the type's sentence under the field and sends nothing", () => {
    const u = unit({ label: "Anniversary", key: "anniversary", type: "date" });
    const s = run(u, {}, [{ type: "start" }, { type: "change", key: "cf:anniversary", value: "soon" }, { type: "submit" }]);
    expect(s.phase).toBe("editing");
    expect(s.problem).toBe("“Anniversary” takes a date as MM/DD/YYYY, like 03/14/2026");
    expect(s.pending).toBeNull();
  });

  it("does nothing when the value did not change (spelling aside)", () => {
    const u = unit({ label: "Shirt size", key: "shirt", type: "choice", choices: ["S", "M"] });
    const s = run(u, { "cf:shirt": "M" }, [{ type: "start" }, { type: "change", key: "cf:shirt", value: "m" }, { type: "submit" }]);
    expect(s.phase).toBe("idle");
  });

  it("clears a value with an empty box, and a failed save keeps what was typed and says why", () => {
    const u = unit({ label: "Skills", key: "skills" });
    const saving = run(u, { "cf:skills": "Catering" }, [{ type: "start" }, { type: "change", key: "cf:skills", value: "" }, { type: "submit" }]);
    expect(saving.pending?.fields).toEqual({ "cf:skills": "" });
    const failed = reduce(saving, { type: "failed", message: "Could not save Skills — the server did not respond. Try again." }, u, ctx);
    expect(failed.phase).toBe("error");
    expect(failed.draft["cf:skills"]).toBe("");
    expect(failed.message).toContain("Try again");
  });

  it("holds a conflict, and Keep mine sends the newer value as the one it saw", () => {
    const u = unit({ label: "Skills", key: "skills" });
    const saving = run(u, { "cf:skills": "Catering" }, [{ type: "start" }, { type: "change", key: "cf:skills", value: "First aid" }, { type: "submit" }]);
    const conflict = reduce(saving, { type: "conflicted", theirs: { "cf:skills": "Driving" }, who: "Ravi", at: null }, u, ctx);
    expect(conflict.phase).toBe("conflict");
    const mine = reduce(conflict, { type: "keep_mine" }, u, ctx);
    expect(mine.phase).toBe("saving");
    expect(mine.pending?.expect).toEqual({ "cf:skills": "Driving" });
    expect(reduce(conflict, { type: "use_theirs" }, u, ctx).committed["cf:skills"]).toBe("Driving");
  });

  it("does not send a custom unit through the person or household column rules", () => {
    const u = unit({ label: "Gender note", key: "gender", type: "text" });
    expect(checkDraft(u, { "cf:gender": "anything at all" }, ctx)).toEqual({ ok: true, stored: { "cf:gender": "anything at all" } });
  });

  it("works with a field and a value in another script", () => {
    const u = unit({ label: "ボランティアの技能", key: "skills_ja" });
    const s = run(u, { "cf:skills_ja": "" }, [{ type: "start" }, { type: "change", key: "cf:skills_ja", value: "料理, 応急手当" }, { type: "submit" }]);
    expect(s.pending?.fields).toEqual({ "cf:skills_ja": "料理, 応急手当" });
  });
});

describe("comparing two stored values (the conflict check)", () => {
  it("treats the same typed value as the same, however it was spelled", () => {
    const date = def({ label: "D", key: "d", type: "date" });
    expect(sameCustom(date, "2026-03-04", "03/04/2026")).toBe(true);
    expect(sameCustom(date, "2026-03-04", "2026-03-05")).toBe(false);
    const choice = def({ label: "C", key: "c", type: "choice", choices: ["Evening"] });
    expect(sameCustom(choice, "evening", "Evening")).toBe(true);
    const text = def({ label: "T", key: "t" });
    expect(sameCustom(text, "a", "b")).toBe(false);
    expect(sameCustom(text, "", "")).toBe(true);
  });

  it("says who changed it, when, and to what", () => {
    const now = new Date("2026-10-12T10:00:00Z");
    expect(customConflictLine({ who: "Ravi", at: "2026-10-12T09:58:50Z", theirs: "Evening" }, now)).toBe("Ravi changed this a minute ago to Evening. Your change was not saved.");
    expect(customConflictLine({ who: null, at: null, theirs: "" }, now)).toBe("Someone changed this a moment ago to empty. Your change was not saved.");
  });
});

describe("Add a field", () => {
  const base = (over: Partial<NewFieldInput> = {}): NewFieldInput => ({ ...emptyNewField("people"), label: "Shirt size", ...over });

  it("reads choices the way the Settings screen does", () => {
    expect(parseChoices("S, M; L\nXL, M,,")).toEqual(["S", "M", "L", "XL"]);
    expect(parseChoices("小, 中、大")).toEqual(["小", "中、大"]);
    expect(parseChoices("x".repeat(3) + "," + Array.from({ length: 150 }, (_, i) => `c${i}`).join(",")).length).toBe(100);
  });

  it("asks for a name, a type and, for a list, at least one choice", () => {
    expect(checkNewField(base({ label: "  " }), [])).toMatchObject({ ok: false, on: "label", error: "Give the field a name." });
    expect(checkNewField(base({ label: "x".repeat(121) }), [])).toMatchObject({ ok: false, on: "label" });
    expect(checkNewField(base({ type: "choice", choicesText: " , " }), [])).toMatchObject({ ok: false, on: "choices" });
    expect(checkNewField(base({ type: "choice", choicesText: "S, M" }), [])).toEqual({ ok: true, label: "Shirt size", choices: ["S", "M"] });
    expect(checkNewField(base({ type: "text", choicesText: "ignored" }), [])).toEqual({ ok: true, label: "Shirt size", choices: [] });
  });

  it("refuses a name that is already a field, whatever its case or accents", () => {
    const r = checkNewField(base({ label: "SHIRT SIZE" }), [{ label: "Shirt size" }]);
    expect(r).toMatchObject({ ok: false, on: "label" });
    expect(!r.ok && r.error).toContain("Shirt size");
    expect(checkNewField(base({ label: "Café" }), [{ label: "Cafe" }]).ok).toBe(false);
    expect(checkNewField(base({ label: "Cafe 2" }), [{ label: "Cafe" }]).ok).toBe(true);
    const old = checkNewField(base({ label: "Shirt size" }), [{ label: "Shirt size", archived: true }]);
    expect(!old.ok && old.error).toBe("There is an archived field called “Shirt size”. Restore it from Manage, or give this one another name.");
    expect(checkNewField(base({ label: "ボランティア" }), [{ label: "ボランティア" }]).ok).toBe(false);
  });

  it("sends the Settings action's own form fields", () => {
    const fd = newFieldFormData(base({ type: "choice", choicesText: "S, M", sensitivity: "member_self", searchable: true, entity: "households" }), "Shirt size", ["S", "M"]);
    expect(Object.fromEntries(fd.entries())).toEqual({ entity: "households", label: "Shirt size", type: "choice", sensitivity: "member_self", choices: "S, M", searchable: "on" });
    const plain = newFieldFormData(base(), "Shirt size", []);
    expect(Object.fromEntries(plain.entries())).toEqual({ entity: "people", label: "Shirt size", type: "text", sensitivity: "staff" });
  });

  it("fills the sheet from a suggestion", () => {
    const f = applySuggestion(base({ label: "", sensitivity: "directory" }), { label: "Industry", type: "choice", choices: ["Retail", "Services"], searchable: true });
    expect(f).toMatchObject({ label: "Industry", type: "choice", choicesText: "Retail, Services", sensitivity: "staff", searchable: true });
  });

  it("titles the sheet for the kind of record", () => {
    expect(addFieldTitle("people")).toBe("Add a field for every person");
    expect(addFieldTitle("households")).toBe("Add a field for every household");
  });
});

describe("Ask an admin", () => {
  it("writes the request in plain words, with the community, what it applies to, the type and who sees it", () => {
    const text = askAdminRequest({ ...emptyNewField("households"), label: "Preferred contact time", type: "choice", choicesText: "Morning, Evening", searchable: true }, { community: "Riverside Community" });
    expect(text.split("\n")).toEqual([
      "Please add a custom field in Settings › Custom fields for Riverside Community.",
      "Applies to: every household",
      "Name: Preferred contact time",
      "Type: Choice list (Morning, Evening)",
      "Who can see it: Staff only",
      "Found by the one box and usable as a list filter: Yes",
    ]);
  });

  it("copes with no name yet and with a name in another script", () => {
    expect(askAdminRequest(emptyNewField("people"), { community: "X" })).toContain("Name: (the name is still to be decided)");
    expect(askAdminRequest({ ...emptyNewField("people"), label: "مقاس القميص" }, { community: "مجتمع الرياض" })).toContain("Name: مقاس القميص");
  });
});

describe("Manage", () => {
  it("lists active fields in order, then archived ones, with what each is", () => {
    const rows = manageRows({
      active: [def({ label: "B", key: "b", sort: 2, searchable: true }), def({ label: "A", key: "a", sort: 1, type: "date" })],
      archived: [def({ label: "Old", key: "old", status: "archived", source: "import" })],
    });
    expect(rows.map((r) => [r.label, r.archived, r.detail])).toEqual([
      ["A", false, "Date"],
      ["B", false, "Text · searchable"],
      ["Old", true, "Text · from an import"],
    ]);
  });

  it("archives or restores through the Settings action without changing anything else about the field", () => {
    const d = def({ label: "Shirt size", key: "shirt", type: "choice", choices: ["S, small", "M"], sensitivity: "member_self", searchable: true });
    const fd = statusFormData(d, "archived");
    expect(Object.fromEntries(fd.entries())).toEqual({ id: d.id, label: "Shirt size", sensitivity: "member_self", status: "archived", searchable: "on" });
    expect(fd.has("choices")).toBe(false);
    expect(statusFormData(def({ label: "Plain", key: "p" }), "active").has("searchable")).toBe(false);
  });
});

describe("suggested fields by kind of organization", () => {
  const labels = (kind: { key: string; faithBased?: boolean }, entity: "people" | "households", have: string[] = []) => suggestionsFor(kind, entity, have).map((s) => s.label);

  it("gives a chamber its own business fields and a non-profit its volunteer ones, each before the shared ones", () => {
    expect(labels({ key: "chamber_of_commerce" }, "households").slice(0, 4)).toEqual(["Industry", "Number of employees", "Business website", "Year founded"]);
    expect(labels({ key: "chamber_of_commerce" }, "people")).toContain("Job title");
    expect(labels({ key: "nonprofit_secular" }, "people").slice(0, 2)).toEqual(["Volunteer availability", "Skills offered"]);
    expect(labels({ key: "nonprofit_secular" }, "people")).toContain("Pronouns");
  });

  it("gives a faith-based kind with no row of its own the faith-community ones, and any other unknown kind only the shared ones", () => {
    expect(labels({ key: "brand_new_kind", faithBased: true }, "people")).toContain("Small group or study circle");
    expect(labels({ key: "brand_new_kind", faithBased: false }, "people")).toEqual(["Pronouns", "Preferred language of mail", "Accessibility needs", "Food allergies"]);
    expect(labels({ key: "", faithBased: undefined }, "households")).toContain("Languages spoken at home");
  });

  it("leaves out a field the community already has, without regard to case or accents", () => {
    expect(labels({ key: "nonprofit_secular" }, "people", ["PRONOUNS", "skills offered"])).not.toContain("Pronouns");
    expect(labels({ key: "nonprofit_secular" }, "people", ["PRONOUNS", "skills offered"])).not.toContain("Skills offered");
    expect(labels({ key: "nonprofit_secular" }, "people", ["PRONOUNS"])).toContain("Skills offered");
  });

  it("never repeats a label (a kind's own row wins over the shared one)", () => {
    for (const key of [...SUGGESTION_KIND_KEYS, "other"])
      for (const entity of ["people", "households"] as const) {
        const l = labels({ key }, entity).map((x) => x.toLowerCase());
        expect(new Set(l).size).toBe(l.length);
      }
  });

  it("names no tradition and no community, and every choice list has choices", () => {
    const words = /jain|jsh|hindu|church|temple|mosque|gurdwara|synagogue|baptis|gotra|pathshala|derasar|sangh|puja|bible|quran|torah/i;
    for (const s of allSuggestions()) {
      expect(s.label).not.toMatch(words);
      expect((s.choices ?? []).join(" ")).not.toMatch(words);
      if (s.type === "choice") expect((s.choices ?? []).length).toBeGreaterThan(0);
    }
  });

  it("only keys kinds that exist in the catalog", () => {
    expect([...SUGGESTION_KIND_KEYS].sort()).toEqual(["chamber_of_commerce", "faith_other", "nonprofit_secular"]);
  });
});

describe("children (D2)", () => {
  it("says a child's custom values are staff only and never sent to Niva", () => {
    expect(CHILD_CUSTOM_NOTE).toBe("Staff only · never sent to Niva");
  });
});
