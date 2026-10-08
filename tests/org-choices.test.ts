import { describe, expect, it } from "vitest";

import {
  FALLBACK_ORG_GROUPS,
  NEEDS,
  groupExperiences,
  modulesForNeeds,
  parseExperiences,
  requestKindText,
  resolveOrgSelection,
  type ExperienceRow,
} from "@/lib/org-choices";
import { centerSlugPinned } from "@/lib/env";
import { orgTypeLabel } from "@/lib/platform-onboarding";

const row = (over: Partial<ExperienceRow> & { key: string; label: string; family_key: string | null; family_label: string | null; faith_based: boolean }): ExperienceRow => ({
  description: null,
  active: true,
  sort: 0,
  ...over,
});

// A catalog like the one migrations 0600-0605 hold: faith experiences under families, and experiences that are not faith-based and have
// no family (each is its own choice). A business family with one experience and a club family with two exercise the family path too.
const CATALOG: ExperienceRow[] = [
  row({ key: "jain_temple", label: "Jain temple", family_key: "dharmic", family_label: "Dharmic traditions", faith_based: true, sort: 10 }),
  row({ key: "swaminarayan_temple", label: "Swaminarayan temple", family_key: "dharmic", family_label: "Dharmic traditions", faith_based: true, sort: 20 }),
  row({ key: "church_baptist", label: "Baptist church", family_key: "christian", family_label: "Christian churches", faith_based: true, sort: 30 }),
  row({ key: "church_filipino", label: "Filipino church", family_key: "christian", family_label: "Christian churches", faith_based: true, sort: 40 }),
  row({ key: "chamber", label: "Chamber of commerce", family_key: "business", family_label: "Business association", faith_based: false, sort: 50 }),
  row({ key: "rotary", label: "Service club", family_key: "clubs", family_label: "Club or association", faith_based: false, sort: 60 }),
  row({ key: "hoa", label: "Neighborhood association", family_key: "clubs", family_label: "Club or association", faith_based: false, sort: 70 }),
  row({ key: "old_thing", label: "Retired kind", family_key: "clubs", family_label: "Club or association", faith_based: false, active: false }),
];

describe("the kinds of organization the Request access form offers", () => {
  it("builds step 1 from the catalog: Faith-based first, then each other family, Other last", () => {
    const groups = groupExperiences(CATALOG)!;
    expect(groups.map((g) => g.label)).toEqual(["Faith-based", "Business association", "Club or association", "Other"]);
    expect(groups.map((g) => g.key)).toEqual(["faith_based", "business", "clubs", "other"]);
  });

  it("builds step 2 for Faith-based from the catalog's faith experiences, under their families, ending with a way out", () => {
    const faith = groupExperiences(CATALOG)![0];
    expect(faith.faithBased).toBe(true);
    expect(faith.choices.map((c) => c.label)).toEqual(["Jain temple", "Swaminarayan temple", "Baptist church", "Filipino church", "Another tradition or community"]);
    expect(faith.choices.map((c) => c.family)).toEqual(["Dharmic traditions", "Dharmic traditions", "Christian churches", "Christian churches", null]);
    expect(faith.detailLabel).toBe("Tell us more, for example your temple, church, mosque or tradition");
    expect(faith.detailRequired).toBe(false);
  });

  it("asks nothing more of a family that holds one experience, and stores that experience; a family with several asks which", () => {
    const [, business, clubs] = groupExperiences(CATALOG)!;
    expect(business.choices).toEqual([]);
    expect(business.implied?.key).toBe("chamber");
    expect(clubs.choices.map((c) => c.label)).toEqual(["Service club", "Neighborhood association", "Another kind"]);
    expect(clubs.implied).toBeNull();
  });

  it("leaves out inactive experiences, and an empty catalog gives null so the caller falls back (and logs it)", () => {
    const labels = groupExperiences(CATALOG)!.flatMap((g) => g.choices.map((c) => c.label));
    expect(labels).not.toContain("Retired kind");
    expect(groupExperiences([])).toBeNull();
    expect(groupExperiences(CATALOG.map((r) => ({ ...r, active: false })))).toBeNull();
  });

  it("makes each experience that is not faith-based and has no family a choice of step 1 on its own, stored as it stands", () => {
    const groups = groupExperiences([
      row({ key: "jain_center", label: "Jain Center", family_key: "jain", family_label: "Jain", faith_based: true, sort: 1 }),
      row({ key: "chamber_of_commerce", label: "Chamber of commerce", family_key: null, family_label: null, faith_based: false, sort: 2 }),
      row({ key: "nonprofit_secular", label: "Community organization", family_key: null, family_label: null, faith_based: false, sort: 3 }),
    ])!;
    expect(groups.map((g) => [g.key, g.label])).toEqual([
      ["faith_based", "Faith-based"],
      ["chamber_of_commerce", "Chamber of commerce"],
      ["nonprofit_secular", "Community organization"],
      ["other", "Other"],
    ]);
    expect(groups[1].choices).toEqual([]);
    expect(groups[1].implied).toMatchObject({ key: "chamber_of_commerce", catalog: true });
    expect(resolveOrgSelection(groups, { group: "chamber_of_commerce", choice: "", detail: "" })).toMatchObject({
      ok: true,
      value: { orgType: "chamber_of_commerce", experienceKey: "chamber_of_commerce", requestedCategory: "chamber_of_commerce" },
    });
  });

  it("shows the faith experiences without family headings when they all share one", () => {
    const faith = groupExperiences(CATALOG.filter((r) => r.key === "jain_temple" || r.key === "swaminarayan_temple"))![0];
    expect(faith.choices.every((c) => c.family === null)).toBe(true);
  });

  it("keeps a family called other or faith_based from colliding with the two fixed groups", () => {
    const groups = groupExperiences([
      row({ key: "a", label: "A", family_key: "other", family_label: "Misc", faith_based: false }),
      row({ key: "b", label: "B", family_key: "faith_based", family_label: "Odd", faith_based: false }),
    ])!;
    expect(new Set(groups.map((g) => g.key)).size).toBe(groups.length);
  });

  it("reads a row without a family (an experience that is not faith-based) and keeps it", () => {
    const parsed = parseExperiences([{ key: "chamber_of_commerce", label: "Chamber of commerce", family_key: null, family_label: null, faith_based: false, active: true, sort: 9 }]);
    expect(parsed).toEqual([
      { key: "chamber_of_commerce", label: "Chamber of commerce", description: null, family_key: null, family_label: null, faith_based: false, active: true, sort: 9 },
    ]);
  });

  it("reads what the database returns and drops anything that is not an experience", () => {
    const parsed = parseExperiences([
      { key: "jain_temple", label: " Jain  temple ", family_key: "dharmic", family_label: "Dharmic", faith_based: true, active: true, sort: 3, description: "" },
      { key: "Bad Key", label: "x", family_key: "fam", family_label: "F", faith_based: false },
      { key: "no_label", label: "", family_key: "fam", family_label: "F", faith_based: false },
      null,
      "text",
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ key: "jain_temple", label: "Jain temple", faith_based: true, description: null, sort: 3 });
    expect(parseExperiences(null)).toEqual([]);
  });

  it("has a built-in list that names no tradition, used only when the catalog cannot be read", () => {
    expect(FALLBACK_ORG_GROUPS.map((g) => g.label)).toEqual([
      "Faith-based",
      "Chamber of commerce or business association",
      "Club or association",
      "Non-profit",
      "Other",
    ]);
    const text = JSON.stringify(FALLBACK_ORG_GROUPS);
    expect(text).not.toMatch(/jain|jsh|hindu|vadtal|swaminarayan|pathshala|diwali/i);
  });
});

describe("resolving what the applicant submitted", () => {
  const groups = groupExperiences(CATALOG)!;

  it("takes the labels from the catalog, never from the form, and keeps the catalog row to ask the database to check", () => {
    const r = resolveOrgSelection(groups, { group: "faith_based", choice: "jain_temple", detail: "  Our temple in Dallas  " });
    expect(r).toEqual({
      ok: true,
      value: {
        orgType: "faith_based",
        orgTypeLabel: "Faith-based",
        experienceKey: "jain_temple",
        experienceLabel: "Jain temple",
        requestedCategory: "jain_temple",
        detail: "Our temple in Dallas",
      },
    });
  });

  it("asks the database to check a catalog row only: not the built-in list, not Other", () => {
    expect(resolveOrgSelection(groups, { group: "faith_based", choice: "church", detail: "" })).toMatchObject({ ok: true, value: { requestedCategory: null } });
    expect(resolveOrgSelection(groups, { group: "faith_based", choice: "other", detail: "A Filipino church" })).toMatchObject({ ok: true, value: { requestedCategory: null } });
    expect(resolveOrgSelection(groups, { group: "other", choice: "", detail: "An alumni network" })).toMatchObject({ ok: true, value: { requestedCategory: null } });
    expect(resolveOrgSelection(FALLBACK_ORG_GROUPS, { group: "faith_based", choice: "temple", detail: "" })).toMatchObject({ ok: true, value: { requestedCategory: null } });
  });

  it("requires the second step where the group has one", () => {
    const r = resolveOrgSelection(groups, { group: "faith_based", choice: "", detail: "" });
    expect(r).toEqual({ ok: false, error: "Choose which best describes your faith community, or Other." });
    const clubs = resolveOrgSelection(groups, { group: "clubs", choice: "", detail: "" });
    expect(clubs).toEqual({ ok: false, error: "Choose which best describes your organization, or Other." });
  });

  it("stores the one experience of a group that has only one, without asking", () => {
    const r = resolveOrgSelection(groups, { group: "business", choice: "", detail: "" });
    expect(r).toMatchObject({ ok: true, value: { orgType: "business", experienceKey: "chamber", experienceLabel: "Chamber of commerce", detail: null } });
  });

  it("needs some words for Other, at either step", () => {
    expect(resolveOrgSelection(groups, { group: "other", choice: "", detail: "" })).toEqual({
      ok: false,
      error: "Tell us a little about your organization so we can set it up.",
    });
    expect(resolveOrgSelection(groups, { group: "faith_based", choice: "other", detail: "ab" }).ok).toBe(false);
    const ok = resolveOrgSelection(groups, { group: "faith_based", choice: "other", detail: "A Filipino church in Dallas" });
    expect(ok).toMatchObject({ ok: true, value: { experienceKey: "other", experienceLabel: "Another tradition or community" } });
    expect(resolveOrgSelection(groups, { group: "other", choice: "", detail: "An alumni network" })).toMatchObject({ ok: true, value: { orgType: "other", orgTypeLabel: "Other" } });
  });

  it("refuses a kind nobody offered", () => {
    expect(resolveOrgSelection(groups, { group: "made_up", choice: "", detail: "" })).toEqual({ ok: false, error: "Choose what kind of organization you are." });
    expect(resolveOrgSelection(groups, { group: "", choice: "", detail: "" }).ok).toBe(false);
    expect(resolveOrgSelection(groups, { group: "faith_based", choice: "made_up", detail: "x" }).ok).toBe(false);
  });

  it("still accepts the built-in list when the form was drawn while the catalog was unreachable", () => {
    const r = resolveOrgSelection(groups, { group: "faith_based", choice: "church", detail: "" });
    expect(r).toMatchObject({ ok: true, value: { experienceKey: "church", experienceLabel: "Church" } });
    const club = resolveOrgSelection(FALLBACK_ORG_GROUPS, { group: "club_association", choice: "", detail: "" });
    expect(club).toMatchObject({ ok: true, value: { orgType: "club_association", orgTypeLabel: "Club or association", experienceKey: null } });
  });
});

describe("what Weaver is wanted for", () => {
  it("maps neutral needs to the existing module keys, without repeats", () => {
    expect(modulesForNeeds(["members", "donations", "events"])).toEqual(["events", "giving", "membership", "people"]);
    expect(modulesForNeeds(["learning"])).toEqual(["gyan_path", "pathshala"]);
    expect(modulesForNeeds(["nothing_real"])).toEqual([]);
    expect(modulesForNeeds([])).toEqual([]);
  });

  it("says nothing faith-specific in the words people see", () => {
    expect(NEEDS.map((n) => n.label).join(" ")).not.toMatch(/jain|pathshala|gyan|bolis?|satvik|labh/i);
  });
});

describe("showing a stored request back to the Weaver team", () => {
  it("puts the group and the specific choice together, using the words the applicant saw", () => {
    expect(requestKindText({ org_type: "faith_based", org_type_label: "Faith-based", experience_key: "jain_temple", experience_label: "Jain temple" })).toBe("Faith-based · Jain temple");
    expect(requestKindText({ org_type: "business", org_type_label: "Business association", experience_key: "chamber", experience_label: "Chamber of commerce" })).toBe(
      "Business association · Chamber of commerce",
    );
  });
  it("reads a request from before 0612", () => {
    expect(requestKindText({ org_type: "temple" })).toBe("Temple");
    expect(requestKindText({ org_type: "community_center" })).toBe("Community center");
    expect(requestKindText({ org_type: "other_nonprofit" })).toBe("Other non-profit");
  });
  it("has one label for every kind a request can hold (the old three, the form's groups, a catalog key)", () => {
    expect(orgTypeLabel("temple")).toBe("Temple");
    expect(orgTypeLabel("faith_based")).toBe("Faith-based");
    expect(orgTypeLabel("other")).toBe("Other");
    expect(orgTypeLabel("chamber_of_commerce")).toBe("Chamber of commerce");
    expect(orgTypeLabel(null)).toBe("Other");
    expect(orgTypeLabel("")).toBe("Other");
  });
  it("falls back to the key in plain words when no label was kept", () => {
    expect(requestKindText({ org_type: "club_association", experience_key: "other" })).toBe("Club association · Other");
    expect(requestKindText({ org_type: "faith_based", org_type_label: "Faith-based", experience_label: "Faith-based" })).toBe("Faith-based");
  });
});

describe("whether a deployment names its organization on purpose", () => {
  it("is true only when NEXT_PUBLIC_CENTER_SLUG is set", () => {
    expect(centerSlugPinned("jsh")).toBe(true);
    expect(centerSlugPinned(" jcnj ")).toBe(true);
    expect(centerSlugPinned("")).toBe(false);
    expect(centerSlugPinned("  ")).toBe(false);
    expect(centerSlugPinned(undefined)).toBe(false);
  });
});
