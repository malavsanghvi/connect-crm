import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  LEGACY_KIND,
  kindFallbackProblem,
  kindFromProfileResult,
  kindLacks,
  kindModuleLabel,
  kindOrganization,
  kindOrganizations,
  kindTerm,
  moduleAvailabilityIn,
  moduleNotOffered,
  notOfferedExplanation,
  notPartOfKindSentence,
  parseKindProfile,
  withArticle,
} from "@/lib/kind";
import { buildModuleRowsFromStates, moduleOffMessage } from "@/lib/modules";

// What app.category_profile(center) answers for a chamber of commerce (0594 seed).
const chamber = {
  category: {
    key: "chamber_of_commerce",
    label: "Chamber of commerce",
    faith_based: false,
    uses_tradition: false,
    path_label: null,
    terms: { greeting: "Welcome", practice_tab: null, give_tab: "Pay", family_tab: "My business", store: "Store", school: null, learning: null, place: "office", assistant_context: "a chamber of commerce" },
  },
  modules: {
    people: { availability: "default_on", label: null },
    giving: { availability: "default_on", label: "Dues & payments" },
    bolis: { availability: "not_available", label: null },
    store: { availability: "default_off", label: "Store" },
  },
  paths: [],
  default_path: null,
};

describe("the organization's kind", () => {
  it("reads the profile the database answers", () => {
    const k = parseKindProfile(chamber);
    expect(k).toMatchObject({ key: "chamber_of_commerce", label: "Chamber of commerce", faithBased: false, usesTradition: false });
    expect(kindTerm(k!, "greeting")).toBe("Welcome");
    expect(kindTerm(k!, "place", "x")).toBe("office");
    expect(moduleAvailabilityIn(k!, "bolis")).toBe("not_available");
    expect(moduleAvailabilityIn(k!, "store")).toBe("default_off");
  });
  it("a term the kind says it has no such thing for is lacking, and a missing one falls back", () => {
    const k = parseKindProfile(chamber)!;
    expect(kindLacks(k, "school")).toBe(true);
    expect(kindTerm(k, "school", "none")).toBe("none");
    expect(kindLacks(k, "greeting")).toBe(false);
    expect(kindLacks(k, "never_heard_of_it")).toBe(false);
    expect(kindTerm(k, "never_heard_of_it", "dflt")).toBe("dflt");
  });
  it("keeps terms a newer kind adds, without a code change", () => {
    const k = parseKindProfile({ ...chamber, category: { ...chamber.category, terms: { ...chamber.category.terms, sample_fund: "Building fund" } } })!;
    expect(kindTerm(k, "sample_fund")).toBe("Building fund");
  });
  it("a module the kind has no row for is on (the 'no row means on' contract)", () => {
    const k = parseKindProfile(chamber)!;
    expect(moduleAvailabilityIn(k, "events")).toBe("default_on");
    expect(moduleNotOffered(k, "events")).toBe(false);
    expect(moduleNotOffered(k, "bolis")).toBe(true);
  });
  it("refuses an answer that is not the contract's shape", () => {
    expect(parseKindProfile(null)).toBeNull();
    expect(parseKindProfile({})).toBeNull();
    expect(parseKindProfile({ category: { key: "", label: "" } })).toBeNull();
    expect(parseKindProfile("text")).toBeNull();
  });
  it("the kind's own name for a module wins over the catalog's", () => {
    const k = parseKindProfile(chamber)!;
    expect(kindModuleLabel(k, "giving", "Pledges & donations")).toBe("Dues & payments");
    expect(kindModuleLabel(k, "events", "Events & RSVP")).toBe("Events & RSVP");
  });
});

describe("what the portal showed before kinds existed", () => {
  it("is the Jain Center row of migration 0594, word for word", () => {
    const sql = readFileSync(new URL("../supabase/migrations/0594_organization_categories.sql", import.meta.url), "utf8");
    const m = sql.match(/\('jain_center', 'Jain Center', '[^']*', true, true, '[^']*',\s*'(\{[^']*\})'::jsonb/);
    expect(m).not.toBeNull();
    expect(LEGACY_KIND.terms).toEqual(JSON.parse(m![1]));
    expect(LEGACY_KIND.label).toBe("Jain Center");
  });
  it("is used when the database cannot answer, and says why", () => {
    expect(kindFromProfileResult({ data: null, error: { code: "PGRST202", message: "Could not find the function" } })).toEqual({ kind: LEGACY_KIND, status: "missing" });
    expect(kindFromProfileResult({ data: null, error: { code: "42883", message: "function app.category_profile does not exist" } }).status).toBe("missing");
    expect(kindFromProfileResult({ data: null, error: { code: "XX000", message: "boom" } })).toEqual({ kind: LEGACY_KIND, status: "error" });
    expect(kindFromProfileResult({ data: { nothing: true }, error: null })).toEqual({ kind: LEGACY_KIND, status: "error" });
  });
  it("reports every fallback so none is silent: missing, failing, and an answer it cannot read", () => {
    const missing = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    const failing = { data: null, error: { code: "XX000", message: "boom" } };
    const unreadable = { data: { nothing: true }, error: null };
    expect(kindFallbackProblem(kindFromProfileResult(missing), missing)?.context).toMatch(/not available from the database yet/);
    expect(kindFallbackProblem(kindFromProfileResult(failing), failing)).toEqual({
      context: "Could not read the organization's kind (showing the default wording)",
      error: failing.error,
    });
    // The database returns no error for an answer the portal cannot read: one is made, so the log never says "null".
    const parse = kindFallbackProblem(kindFromProfileResult(unreadable), unreadable);
    expect(parse?.error).toBeInstanceOf(Error);
    expect((parse?.error as Error).message).toMatch(/could not read/);
    const ok = { data: chamber, error: null };
    expect(kindFallbackProblem(kindFromProfileResult(ok), ok)).toBeNull();
  });
  it("is replaced by the real kind when the database answers", () => {
    const r = kindFromProfileResult({ data: chamber, error: null });
    expect(r.status).toBe("ok");
    expect(r.kind.key).toBe("chamber_of_commerce");
  });
});

describe("the sentence for a module a kind never offers", () => {
  it("uses the right article", () => {
    expect(withArticle("Chamber of commerce")).toBe("a Chamber of commerce");
    expect(withArticle("Independent church")).toBe("an Independent church");
  });
  it("matches the database's own sentence", () => {
    expect(notPartOfKindSentence("Bolis", "Chamber of commerce")).toBe("Bolis is not part of a Chamber of commerce organization.");
    expect(notOfferedExplanation("Houston Chamber", "Chamber of commerce")).toBe(
      "Houston Chamber is set up as a Chamber of commerce organization, which does not have this module. Weaver can change an organization's kind if that is wrong.",
    );
  });
  it("does not say organization twice when the kind's name already ends in it (the neutral kind)", () => {
    expect(kindOrganization("Community organization")).toBe("Community organization");
    expect(kindOrganization("Chamber of commerce")).toBe("Chamber of commerce organization");
    expect(kindOrganizations("Community organization")).toBe("Community organizations");
    expect(kindOrganizations("Chamber of commerce")).toBe("Chamber of commerce organizations");
    expect(notPartOfKindSentence("Bolis", "Community organization")).toBe("Bolis is not part of a Community organization.");
    expect(notOfferedExplanation("Houston Club", "Community organization")).toBe(
      "Houston Club is set up as a Community organization, which does not have this module. Weaver can change an organization's kind if that is wrong.",
    );
  });
  it("the switched-off sentence is unchanged and takes the kind's name for the module", () => {
    expect(moduleOffMessage("giving", "JSH")).toBe("The Pledges & donations module is switched off for JSH. An administrator can switch it on in Settings › Modules.");
    expect(moduleOffMessage("giving", "Houston Chamber", "Dues & payments")).toBe(
      "The Dues & payments module is switched off for Houston Chamber. An administrator can switch it on in Settings › Modules.",
    );
  });
});

describe("Settings › Modules rows from app.module_states", () => {
  const state = (key: string, sort: number, availability: string, extra: Record<string, unknown> = {}) => ({
    key,
    label: key,
    description: null,
    core: false,
    depends_on: [] as string[],
    sort,
    availability,
    enabled: availability === "default_on",
    switchable: availability !== "not_available",
    changed_by: null,
    changed_at: null,
    reason: null,
    ...extra,
  });
  const rows = buildModuleRowsFromStates([
    state("people", 1, "default_on", { core: true, switchable: false }),
    state("bolis", 2, "not_available"),
    state("events", 3, "default_on"),
    state("store", 4, "default_off"),
    state("niva", 5, "default_on", { enabled: false, reason: "too early" }),
  ]);
  it("lists the modules the kind never offers last, locked", () => {
    expect(rows.map((r) => r.key)).toEqual(["people", "events", "store", "niva", "bolis"]);
    const bolis = rows.find((r) => r.key === "bolis")!;
    expect(bolis).toMatchObject({ availability: "not_available", switchable: false, enabled: false });
  });
  it("a module that starts off can be switched on; a core one never has a switch", () => {
    expect(rows.find((r) => r.key === "store")).toMatchObject({ availability: "default_off", switchable: true, enabled: false });
    expect(rows.find((r) => r.key === "people")).toMatchObject({ core: true, switchable: false, enabled: true });
  });
  it("keeps the organization's own switch and its reason", () => {
    expect(rows.find((r) => r.key === "niva")).toMatchObject({ enabled: false, reason: "too early", switchable: true });
  });
  it("a Jain Center (every module default_on) lists in the catalog's order with every switch", () => {
    const jain = buildModuleRowsFromStates([state("a", 2, "default_on"), state("b", 1, "default_on")]);
    expect(jain.map((r) => r.key)).toEqual(["b", "a"]);
    expect(jain.every((r) => r.switchable && r.availability === "default_on")).toBe(true);
  });
});
