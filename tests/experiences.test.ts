import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { KindPicker } from "@/components/kind-picker";
import {
  EMPTY_SELECTION,
  FAITH_TOP,
  NO_FAMILY,
  buildKindPicker,
  chooseFamily,
  chooseKind,
  chooseTop,
  chosenKind,
  experienceLabel,
  familyChoices,
  kindChoices,
  legacyOrgType,
  selectionFor,
  selectionForRequest,
  toExperiences,
  topChoices,
} from "@/lib/experiences";

// What app.list_experiences() answers: the catalog is data, so a new kind is a new row here and nowhere else.
const rows = [
  { key: "jain_temple", label: "Jain Temple", description: "Jain temples, sanghs and societies", family_key: "jain", family_label: "Jain", faith_based: true, active: true, sort: 10 },
  { key: "swaminarayan_temple", label: "Swaminarayan Temple", description: "", family_key: "hindu", family_label: "Hindu", faith_based: true, active: false, sort: 20 },
  { key: "hindu_temple", label: "Hindu Temple", description: "", family_key: "hindu", family_label: "Hindu", faith_based: true, active: false, sort: 21 },
  { key: "church_protestant", label: "Protestant church", description: "", family_key: "christian", family_label: "Christian", faith_based: true, active: false, sort: 30 },
  { key: "church_catholic", label: "Catholic church", description: "", family_key: "christian", family_label: "Christian", faith_based: true, active: false, sort: 31 },
  { key: "chamber_of_commerce", label: "Chamber of commerce", description: "Chambers and business associations", family_key: null, family_label: null, faith_based: false, active: false, sort: 100 },
  { key: "club", label: "Club", description: "", family_key: null, family_label: null, faith_based: false, active: false, sort: 110 },
  { key: "nonprofit_secular", label: "Non-profit", description: "", family_key: null, family_label: null, faith_based: false, active: false, sort: 120 },
  { key: "neutral", label: "Neutral", description: "No faith, no sector", family_key: null, family_label: null, faith_based: false, active: true, sort: 130 },
];
const catalog = toExperiences(rows);

describe("toExperiences", () => {
  it("reads the contract's columns and sorts by the catalog's order", () => {
    expect(catalog.map((e) => e.key)).toEqual(rows.map((r) => r.key));
    expect(catalog[0]).toMatchObject({ key: "jain_temple", familyKey: "jain", familyLabel: "Jain", faithBased: true, active: true, usesTradition: null });
  });
  it("leaves out rows that cannot be used and repeated keys", () => {
    const out = toExperiences([{ key: "ok_kind", label: "OK" }, { key: "Bad Key", label: "x" }, { key: "no_label", label: " " }, { key: "ok_kind", label: "again" }, null, 7]);
    expect(out.map((e) => e.key)).toEqual(["ok_kind"]);
    expect(out[0]).toMatchObject({ faithBased: false, active: false, familyKey: null });
  });
  it("reads usesTradition only when the database says", () => {
    expect(toExperiences([{ key: "aa", label: "A", uses_tradition: true }])[0].usesTradition).toBe(true);
    expect(toExperiences([{ key: "aa", label: "A", uses_tradition: false }])[0].usesTradition).toBe(false);
    expect(toExperiences([{ key: "aa", label: "A" }])[0].usesTradition).toBeNull();
  });
});

describe("the two-step picker", () => {
  const all = buildKindPicker(catalog, { includeInactive: true });
  it("offers Faith-based first, then each other kind", () => {
    expect(topChoices(all)).toEqual([
      { value: FAITH_TOP, label: "Faith-based" },
      { value: "chamber_of_commerce", label: "Chamber of commerce" },
      { value: "club", label: "Club" },
      { value: "nonprofit_secular", label: "Non-profit" },
      { value: "neutral", label: "Neutral" },
    ]);
  });
  it("groups the faith-based kinds by tradition family, in the catalog's order", () => {
    expect(familyChoices(all)).toEqual([
      { value: "jain", label: "Jain" },
      { value: "hindu", label: "Hindu" },
      { value: "christian", label: "Christian" },
    ]);
    expect(kindChoices(all, "hindu").map((e) => e.key)).toEqual(["swaminarayan_temple", "hindu_temple"]);
    expect(kindChoices(all, "nope")).toEqual([]);
  });
  it("a live organization is offered only the kinds that are switched on", () => {
    const live = buildKindPicker(catalog, { includeInactive: false });
    expect(topChoices(live)).toEqual([
      { value: FAITH_TOP, label: "Faith-based" },
      { value: "neutral", label: "Neutral" },
    ]);
    expect(familyChoices(live)).toEqual([{ value: "jain", label: "Jain" }]);
  });
  it("shows no Faith-based choice when the catalog has no faith-based kind", () => {
    const none = buildKindPicker(catalog.filter((e) => !e.faithBased), { includeInactive: true });
    expect(topChoices(none).some((o) => o.value === FAITH_TOP)).toBe(false);
  });
  it("a non-faith kind is one click; a faith kind is type, tradition, kind", () => {
    expect(chooseTop(all, "club")).toEqual({ top: "club", family: null, key: "club" });
    expect(chooseTop(all, FAITH_TOP)).toEqual({ top: FAITH_TOP, family: null, key: null });
    expect(chooseFamily(all, "hindu")).toEqual({ top: FAITH_TOP, family: "hindu", key: null });
    const pick = chooseKind(all, "swaminarayan_temple");
    expect(pick).toEqual({ top: FAITH_TOP, family: "hindu", key: "swaminarayan_temple" });
    expect(chosenKind(all, pick)?.label).toBe("Swaminarayan Temple");
  });
  it("a family with one kind chooses it, and a catalog with one family skips that step", () => {
    expect(chooseFamily(all, "jain")).toEqual({ top: FAITH_TOP, family: "jain", key: "jain_temple" });
    const live = buildKindPicker(catalog, { includeInactive: false });
    expect(chooseTop(live, FAITH_TOP)).toEqual({ top: FAITH_TOP, family: "jain", key: "jain_temple" });
  });
  it("finds where a kind sits, and says nothing for one the picker does not offer", () => {
    expect(selectionFor(all, "church_catholic")).toEqual({ top: FAITH_TOP, family: "christian", key: "church_catholic" });
    expect(selectionFor(all, "neutral")).toEqual({ top: "neutral", family: null, key: "neutral" });
    expect(selectionFor(buildKindPicker(catalog, { includeInactive: false }), "church_catholic")).toBeNull();
    expect(selectionFor(all, null)).toBeNull();
    expect(chooseTop(all, "unknown")).toEqual(EMPTY_SELECTION);
  });
  it("a faith-based kind with no family still has a place", () => {
    const m = buildKindPicker(toExperiences([{ key: "faith_other", label: "Other faith", faith_based: true, active: true, sort: 1 }]), { includeInactive: false });
    expect(m.families[0].key).toBe(NO_FAMILY);
    expect(chooseTop(m, FAITH_TOP).key).toBe("faith_other");
  });
});

describe("the applicant's own words are a hint", () => {
  const all = buildKindPicker(catalog, { includeInactive: true });
  it("keeps the kind Weaver already chose", () => {
    expect(selectionForRequest(all, "club", "temple")).toEqual({ top: "club", family: null, key: "club" });
  });
  it("a temple starts at Faith-based and leaves the tradition to Weaver", () => {
    expect(selectionForRequest(all, null, "temple")).toEqual({ top: FAITH_TOP, family: null, key: null });
  });
  it("other answers pre-select a matching non-faith kind when there is one", () => {
    expect(selectionForRequest(all, null, "other_nonprofit").key).toBe("nonprofit_secular");
    expect(selectionForRequest(all, null, "community_center").key).toBe("club");
    expect(selectionForRequest(all, null, "something else")).toEqual(EMPTY_SELECTION);
  });
});

describe("the older org type the sandbox function still wants", () => {
  it("is a temple for a faith-based kind and an other non-profit for any other", () => {
    expect(legacyOrgType(catalog.find((e) => e.key === "jain_temple"))).toBe("temple");
    expect(legacyOrgType(catalog.find((e) => e.key === "neutral"))).toBe("other_nonprofit");
    expect(legacyOrgType(null)).toBe("other_nonprofit");
  });
  it("names a kind, or shows its key", () => {
    expect(experienceLabel(catalog, "club")).toBe("Club");
    expect(experienceLabel(catalog, "gone_kind")).toBe("gone_kind");
    expect(experienceLabel(catalog, null)).toBe("—");
  });
});

describe("KindPicker markup", () => {
  const render = (props: Partial<Parameters<typeof KindPicker>[0]> = {}) =>
    renderToStaticMarkup(createElement(KindPicker, { experiences: catalog, includeInactive: true, name: "experience", ...props }));
  it("starts empty and submits no kind until one is chosen", () => {
    const html = render();
    expect(html).toContain('name="experience"');
    expect(html).toContain('value=""');
    expect(html).toContain("Faith-based");
    expect(html).toContain("Chamber of commerce");
    expect(html).toContain("Choose the kind of organization.");
  });
  it("starts on the current kind, with its tradition and its description", () => {
    const html = render({ defaultKey: "swaminarayan_temple" });
    expect(html).toContain('value="swaminarayan_temple"');
    expect(html).toContain("Hindu");
    expect(html).toContain("Preview only");
  });
  it("tells the platform admin when the catalog has no kinds", () => {
    expect(render({ experiences: [] })).toContain("No kinds of organization are available");
  });
});
