import { describe, expect, it } from "vitest";

import { receiptPreviewLines } from "@/lib/giving";
import { LEGACY_KIND, kindHas, kindName, parseKindProfile, type KindProfile } from "@/lib/kind";
import { visibleNav } from "@/lib/permissions";

// Kinds as app.category_profile answers for them (the terms of migration 0594).
const profile = (key: string, label: string, faith: boolean, tradition: boolean, terms: Record<string, string | null>, modules: Record<string, { availability: string; label: string | null }>): KindProfile =>
  parseKindProfile({ category: { key, label, faith_based: faith, uses_tradition: tradition, terms }, modules })!;

const chamber = profile(
  "chamber_of_commerce",
  "Chamber of commerce",
  false,
  false,
  { greeting: "Welcome", practice_tab: null, give_tab: "Pay", family_tab: "My business", store: "Store", school: null, learning: null, place: "office", assistant_context: "a chamber of commerce" },
  {
    giving: { availability: "default_on", label: "Dues & payments" },
    bolis: { availability: "not_available", label: null },
    store: { availability: "default_off", label: "Store" },
    pathshala: { availability: "not_available", label: null },
  },
);
const church = profile(
  "faith_other",
  "Faith-based non-profit (other faiths)",
  true,
  false,
  { greeting: "Welcome", practice_tab: "Learn", give_tab: "Give", family_tab: "Family", store: "Store", school: "Religious school", learning: "Learning path", place: "place of worship", assistant_context: "a faith community" },
  { pathshala: { availability: "default_off", label: "Religious school" }, bolis: { availability: "not_available", label: null } },
);

const admin = { permissions: [] as string[], isPlatformAdmin: true };
const labels = (nav: ReturnType<typeof visibleNav>) => nav.map((m) => `${m.key}:${m.label}:${m.tabs.map((t) => t.label).join("|")}`);

describe("the nav for a Jain Center is what it always was", () => {
  it("is identical with the legacy kind, with a Jain Center profile from the database, and with no kind at all", () => {
    const before = labels(visibleNav(admin));
    expect(labels(visibleNav({ ...admin, kind: LEGACY_KIND }))).toEqual(before);
    const fromDb = profile("jain_center", "Jain Center", true, true, LEGACY_KIND.terms, { giving: { availability: "default_on", label: null }, store: { availability: "default_on", label: null } });
    expect(labels(visibleNav({ ...admin, kind: fromDb }))).toEqual(before);
    const giving = visibleNav({ ...admin, kind: fromDb }).find((m) => m.key === "giving")!;
    expect(giving.label).toBe("Giving");
    expect(giving.tabs.map((t) => t.href)).toContain("/giving/labh");
    expect(visibleNav({ ...admin, kind: fromDb }).find((m) => m.key === "store")!.label).toBe("Satvik Store");
    expect(visibleNav({ ...admin, kind: fromDb }).find((m) => m.key === "pathshala")!.label).toBe("Pathshala");
  });
});

describe("the nav for another kind uses that kind's words and parts", () => {
  const nav = visibleNav({ ...admin, kind: chamber, modulesOff: ["bolis", "pathshala", "gyan_path", "jain_way", "niva", "store"] });
  it("has no Labh tab, and names Giving and the Store in the kind's own words", () => {
    const giving = nav.find((m) => m.key === "giving")!;
    expect(giving.label).toBe("Dues & payments");
    expect(giving.tabs.map((t) => t.href)).not.toContain("/giving/labh");
    expect(giving.tabs.map((t) => t.href)).toContain("/giving/pledges");
  });
  it("shows no Jain word in a label of the modules the kind has", () => {
    const text = labels(nav).join(" ");
    expect(text).not.toMatch(/labh|bolis|satvik|pathshala|jain way|gyan path/i);
  });
  it("another faith's religious school carries its own name", () => {
    const n = visibleNav({ ...admin, kind: church, modulesOff: [] });
    expect(n.find((m) => m.key === "pathshala")!.label).toBe("Religious school");
    expect(n.find((m) => m.key === "store")!.label).toBe("Store");
    expect(n.find((m) => m.key === "giving")!.tabs.map((t) => t.href)).not.toContain("/giving/labh");
  });
  it("Labh follows its own module when the database has one, else Bolis", () => {
    expect(kindHas(chamber, "labh")).toBe(false);
    expect(kindHas(LEGACY_KIND, "labh")).toBe(true);
    const withLabh = profile("x_kind", "X", false, false, {}, { bolis: { availability: "default_on", label: null }, labh: { availability: "not_available", label: null } });
    expect(kindHas(withLabh, "labh")).toBe(false);
    const labhOn = profile("y_kind", "Y", false, false, {}, { bolis: { availability: "not_available", label: null }, labh: { availability: "default_on", label: null } });
    expect(kindHas(labhOn, "labh")).toBe(true);
  });
  it("the live stream is a Jain Center's only (0600 closes the area for every other kind)", () => {
    expect(kindHas(LEGACY_KIND, "live_stream")).toBe(true);
    expect(kindHas(chamber, "live_stream")).toBe(false);
    expect(kindHas(church, "live_stream")).toBe(false);
  });
  it("the organization switching its own Labh module off hides the tab too", () => {
    const g = visibleNav({ ...admin, kind: LEGACY_KIND, modulesOff: ["labh"] }).find((m) => m.key === "giving")!;
    expect(g.tabs.map((t) => t.href)).not.toContain("/giving/labh");
  });
});

describe("a kind's names for modules", () => {
  it("prefers the kind's own module name, then its term, then the name the screens always had", () => {
    expect(kindName(chamber, "giving", "Giving")).toBe("Dues & payments");
    expect(kindName(church, "pathshala", "Pathshala")).toBe("Religious school");
    expect(kindName(church, "gyan_path", "Gyan Path")).toBe("Learning path");
    expect(kindName(LEGACY_KIND, "store", "Satvik Store")).toBe("Satvik Store");
    expect(kindName(LEGACY_KIND, "events", "Events")).toBe("Events");
  });
});

describe("the receipt and statement sample (decision C17: money wording, owner to confirm)", () => {
  const base = { kind: "donation_receipt" as const, centerName: "Test Center", centerAddress: "1 Main St", signedBy: "Treasurer", note: "Thank you.", year: 2026, currency: "USD" };
  const jainSample = [
    { text: "Test Center · 1 Main St", tone: "navy", strong: true },
    { text: "Donation receipt · No. R-2026-00000 (sample)", tone: "ink", strong: true },
    { text: "Sample donor · $400.00 by check on a sample date", tone: "ink" },
    { text: "Applied to: Temple construction (sample)", tone: "ink" },
    { text: "No goods or services were provided other than intangible religious benefits.", tone: "muted" },
    { text: "Thank you. — Treasurer", tone: "muted" },
  ];
  it("a Jain Center's sample is word for word what it was, with or without the kind", () => {
    expect(receiptPreviewLines(base)).toEqual(jainSample);
    expect(receiptPreviewLines({ ...base, orgKind: LEGACY_KIND })).toEqual(jainSample);
  });
  it("a chamber of commerce's sample has no religious-benefit line and no temple fund", () => {
    const lines = receiptPreviewLines({ ...base, orgKind: chamber });
    const text = lines.map((l) => l.text).join("\n");
    expect(text).not.toMatch(/religious|temple/i);
    expect(text).toContain("Applied to: General fund (sample)");
    expect(lines).toHaveLength(jainSample.length - 1);
  });
  it("another faith's sample keeps the house-of-worship line but not a Jain temple fund", () => {
    const text = receiptPreviewLines({ ...base, kind: "pledge_confirmation", orgKind: church }).map((l) => l.text).join("\n");
    expect(text).toContain("intangible religious benefits");
    expect(text).toContain("pledged $400.00 to Building fund");
    expect(text).not.toMatch(/temple/i);
  });
  it("a kind can name its own sample fund", () => {
    const k = profile("z_kind", "Z", false, false, { sample_fund: "Scholarship fund" }, {});
    expect(receiptPreviewLines({ ...base, orgKind: k }).map((l) => l.text).join("\n")).toContain("Applied to: Scholarship fund (sample)");
  });
});
