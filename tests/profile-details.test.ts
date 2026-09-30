import { describe, expect, it } from "vitest";

import {
  dietaryChoices,
  dietaryKeyFromLabel,
  emergencyContactLine,
  humanizeKey,
  interestLabels,
  parseDietaryOption,
  telHref,
  type DietaryOptionRow,
} from "@/lib/profile-details";

const OPTIONS: DietaryOptionRow[] = [
  { key: "vegetarian", label: "Vegetarian", active: true },
  { key: "jain", label: "Jain (no root vegetables)", active: true },
  { key: "nut_allergy", label: "Nut allergy", active: true },
  { key: "other", label: "Other", active: true },
  { key: "halal", label: "Halal", active: false },
];

describe("humanizeKey", () => {
  it("turns a stored key into a readable name", () => {
    expect(humanizeKey("nut_allergy")).toBe("Nut allergy");
    expect(humanizeKey("gluten-free")).toBe("Gluten free");
    expect(humanizeKey("  ")).toBe("");
  });
});

describe("interestLabels", () => {
  it("names the six interest tags and keeps the order stored", () => {
    expect(interestLabels(["youth", "events"])).toEqual(["Youth", "Events"]);
  });
  it("keeps an unknown key (humanized) instead of dropping it, and each once", () => {
    expect(interestLabels(["music_night", "events", "events"])).toEqual(["Music night", "Events"]);
  });
  it("copes with nothing", () => {
    expect(interestLabels(null)).toEqual([]);
    expect(interestLabels([])).toEqual([]);
  });
});

describe("dietaryChoices", () => {
  it("uses the community's own label", () => {
    expect(dietaryChoices(["jain", "nut_allergy"], OPTIONS)).toEqual([
      { key: "jain", label: "Jain (no root vegetables)", retired: false },
      { key: "nut_allergy", label: "Nut allergy", retired: false },
    ]);
  });
  it("shows the member's own words for Other", () => {
    expect(dietaryChoices(["other"], OPTIONS, "  no mushrooms ")[0].label).toBe("Other: no mushrooms");
    expect(dietaryChoices(["other"], OPTIONS, null)[0].label).toBe("Other");
  });
  it("still names a choice the community switched off, and flags it", () => {
    expect(dietaryChoices(["halal"], OPTIONS)).toEqual([{ key: "halal", label: "Halal", retired: true }]);
  });
  it("never drops a key the list no longer holds", () => {
    expect(dietaryChoices(["dairy_free"], OPTIONS)).toEqual([{ key: "dairy_free", label: "Dairy free", retired: false }]);
    expect(dietaryChoices(["vegetarian"], [])).toEqual([{ key: "vegetarian", label: "Vegetarian", retired: false }]);
  });
  it("copes with nothing", () => {
    expect(dietaryChoices(null, OPTIONS)).toEqual([]);
  });
});

describe("telHref", () => {
  it("links an international number", () => {
    expect(telHref("+17135550142")).toBe("tel:+17135550142");
    expect(telHref(" +447700900123 ")).toBe("tel:+447700900123");
  });
  it("does not link anything else", () => {
    expect(telHref("713-555-0142")).toBeNull();
    expect(telHref("tel:+17135550142")).toBeNull();
    expect(telHref("+17135550142; drop")).toBeNull();
    expect(telHref(null)).toBeNull();
    expect(telHref("")).toBeNull();
  });
});

describe("emergencyContactLine", () => {
  it("names the contact and how they are related", () => {
    expect(emergencyContactLine("Kiran Shah", "Sister")).toBe("Kiran Shah (sister)");
    expect(emergencyContactLine("Kiran Shah", null)).toBe("Kiran Shah");
    expect(emergencyContactLine(null, "Sister")).toBe("");
  });
});

describe("dietaryKeyFromLabel", () => {
  it("makes a key the column accepts", () => {
    expect(dietaryKeyFromLabel("Dairy-free")).toBe("dairy_free");
    expect(dietaryKeyFromLabel("No onion / garlic")).toBe("no_onion_garlic");
    expect(dietaryKeyFromLabel("Crème brûlée only")).toBe("creme_brulee_only");
  });
  it("starts with a letter and stays within 40 characters", () => {
    expect(dietaryKeyFromLabel("5 small meals")).toBe("d_5_small_meals");
    expect(dietaryKeyFromLabel("x".repeat(80))).toHaveLength(40);
    expect(dietaryKeyFromLabel("9".repeat(80))).toMatch(/^d_9+$/);
    expect(dietaryKeyFromLabel("9".repeat(80))).toHaveLength(40);
  });
  it("falls back when nothing usable is left", () => {
    expect(dietaryKeyFromLabel("!!!")).toBe("option");
    for (const label of ["Dairy-free", "5 small meals", "!!!", "ગુજરાતી"]) expect(dietaryKeyFromLabel(label)).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
  });
});

describe("parseDietaryOption", () => {
  const form = (o: Record<string, string>) => (n: string) => (n in o ? o[n] : null);
  it("accepts a name and defaults to offered", () => {
    expect(parseDietaryOption(form({ label: "  Dairy   free " }))).toEqual({ ok: true, value: { label: "Dairy free", active: true } });
  });
  it("reads the switch", () => {
    expect(parseDietaryOption(form({ label: "Halal", active: "on" }))).toEqual({ ok: true, value: { label: "Halal", active: true } });
    expect(parseDietaryOption(form({ label: "Halal", active: "false" }))).toEqual({ ok: true, value: { label: "Halal", active: false } });
  });
  it("asks for a name in plain English", () => {
    const r = parseDietaryOption(form({ label: "   " }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Enter the dietary option's name/);
    expect(parseDietaryOption(form({ label: "x".repeat(61) })).ok).toBe(false);
  });
});
