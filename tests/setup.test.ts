import { describe, expect, it } from "vitest";

import {
  checklistProgress,
  checkUpload,
  contrastRatio,
  contrastVerdict,
  formatEin,
  mergeReadiness,
  osmEmbedUrl,
  parseBrandColors,
  parseLeader,
  parseLegalIdentity,
  parseProfile,
  publicObjectUrl,
  READINESS_CHECKS,
  routeAvailable,
  safeFileName,
  textOn,
  toE164,
  verificationBlockers,
} from "@/lib/setup";

const form = (v: Record<string, string>) => (n: string) => (n in v ? v[n] : null);

describe("Setup checklist", () => {
  it("counts progress without skipped steps", () => {
    expect(checklistProgress([{ status: "done", required: true }, { status: "skipped", required: true }, { status: "in_progress", required: false }])).toEqual({ done: 1, total: 2, pct: 50 });
    expect(checklistProgress([])).toEqual({ done: 0, total: 0, pct: 100 });
  });

  it("links only to screens that exist, and says Coming soon otherwise", () => {
    expect(routeAvailable("/settings/modules")).toBe(true);
    expect(routeAvailable("/setup/profile#brand")).toBe(true);
    expect(routeAvailable("/giving/bank")).toBe(true);
    expect(routeAvailable("/settings/agreements")).toBe(false);
    expect(routeAvailable("/settings/payments")).toBe(false);
    expect(routeAvailable(null)).toBe(false);
  });
});

describe("readiness", () => {
  it("lists the plan's 13 checks in order", () => {
    expect(READINESS_CHECKS.map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(new Set(READINESS_CHECKS.map((c) => c.key)).size).toBe(13);
  });
  it("shows unregistered checks as not built yet and keeps extra registered ones", () => {
    const rows = mergeReadiness([
      { key: "nonprofit_verified", title: "Non-profit status verified", ok: true, detail: "Verified." },
      { key: "setup_data_complete", title: "Setup data", ok: false, detail: "Still missing: funds." },
      { key: "custom_check", title: "Custom", ok: true, detail: "ok" },
    ]);
    expect(rows).toHaveLength(14);
    expect(rows[0]).toMatchObject({ key: "nonprofit_verified", state: "pass" });
    expect(rows[8]).toMatchObject({ key: "setup_data_complete", state: "fail", detail: "Still missing: funds." });
    expect(rows[1]).toMatchObject({ key: "agreements_accepted", state: "not_built" });
    expect(rows[13]).toMatchObject({ key: "custom_check", n: 14, state: "pass" });
  });
});

describe("legal identity", () => {
  it("formats EINs", () => {
    expect(formatEin("123456789")).toBe("12-3456789");
    expect(formatEin("12 3456789")).toBe("12-3456789");
    expect(formatEin("1234")).toBeNull();
  });
  it("parses the form and names every problem", () => {
    const ok = parseLegalIdentity(form({ legal_name: "Jain Society of Houston Inc", ein: "760000001", entity_type: "public_charity", incorporation_state: "tx", address_line1: "3905 Artesian Ln", address_city: "Houston", address_state: "tx", address_postal_code: "77000", authorized_signer_name: "A B", authorized_signer_title: "President" }));
    expect(ok.ok && ok.value).toMatchObject({ ein: "76-0000001", incorporation_state: "TX", registered_address: { city: "Houston", state: "TX", line2: null } });
    const bad = parseLegalIdentity(form({ legal_name: "", ein: "12", entity_type: "church", address_city: "Houston", authorized_signer_name: "A B" }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error).toContain("legal name");
      expect(bad.error).toContain("nine digits");
      expect(bad.error).toContain("entity type");
      expect(bad.error).toContain("registered address");
      expect(bad.error).toContain("signer");
    }
  });
  it("says what blocks submitting, with the house-of-worship alternative", () => {
    const p = { legal_name: "X Y", ein: "12-3456789", entity_type: "public_charity" };
    expect(verificationBlockers(p, ["w9", "determination_letter"])).toEqual([]);
    expect(verificationBlockers(p, ["w9", "board_letter"])).toEqual(["an IRS determination letter or proof of a group exemption"]);
    expect(verificationBlockers({ ...p, entity_type: "house_of_worship" }, ["w9", "board_letter"])).toEqual([]);
    expect(verificationBlockers(null, [])).toHaveLength(5);
  });
  it("checks uploads before sending them", () => {
    expect(checkUpload({ name: "w9.pdf", type: "application/pdf", size: 1000 }, ["application/pdf"], 10, "document")).toEqual({ ok: false, error: "The document is larger than 0 MB." });
    expect(checkUpload({ name: "x.exe", type: "application/x-msdownload", size: 10 }, ["application/pdf", "image/png"], 1e6, "document")).toEqual({ ok: false, error: "The document must be a PDF, PNG file." });
    expect(checkUpload(null, ["application/pdf"], 1e6, "W-9")).toEqual({ ok: false, error: "Choose the W-9 to upload." });
    expect(checkUpload({ name: "a.pdf", type: "application/pdf", size: 10 }, ["application/pdf"], 1e6, "W-9")).toEqual({ ok: true });
    expect(safeFileName("../My W-9 (signed).PDF")).toBe("my-w-9-signed-.pdf");
  });
});

describe("profile", () => {
  const tz = ["America/Chicago"];
  it("parses the profile with phone, pin and languages", () => {
    const r = parseProfile(
      form({ name: "Jain Society of Houston", short_name: "JSH", time_zone: "America/Chicago", currency: "usd", website: "https://jsh.org", public_email: "Office@JSH.org", public_phone: "(713) 555-0100", latitude: "29.7604", longitude: "-95.3698", social_facebook: "https://facebook.com/jsh" }),
      () => ["en", "gu", "xx"],
      tz,
    );
    expect(r.ok && r.value).toMatchObject({ currency: "USD", public_email: "office@jsh.org", public_phone: "+17135550100", latitude: 29.7604, longitude: -95.3698, languages: ["en", "gu"], social: { facebook: "https://facebook.com/jsh" } });
  });
  it("refuses a half pin, a bad phone and no language", () => {
    const r = parseProfile(form({ name: "Jain Society of Houston", time_zone: "America/Chicago", public_phone: "12", latitude: "29.7" }), () => [], tz);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("map pin");
      expect(r.error).toContain("public phone");
      expect(r.error).toContain("language");
    }
  });
  it("normalizes phones to E.164", () => {
    expect(toE164("713-555-0100")).toBe("+17135550100");
    expect(toE164("+44 20 7946 0958")).toBe("+442079460958");
    expect(toE164("555")).toBeNull();
  });
  it("builds map and file URLs", () => {
    expect(osmEmbedUrl(29.76, -95.37)).toContain("marker=29.760000%2C-95.370000");
    expect(publicObjectUrl("http://localhost:55721/", "branding", "c1/brand/logo.png")).toBe("http://localhost:55721/storage/v1/object/public/branding/c1/brand/logo.png");
  });
});

describe("brand kit", () => {
  it("computes WCAG contrast", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBe(21);
    expect(contrastRatio("#1B2C5C", "#FFFFFF")).toBeGreaterThan(12);
    expect(contrastRatio("red", "#FFFFFF")).toBeNull();
    expect(contrastVerdict("#FFFFFF", "#1B2C5C", "White on navy")).toMatchObject({ ok: true, level: "AAA" });
    expect(contrastVerdict("#FFFFFF", "#F2B632", "White on gold")).toMatchObject({ ok: false, level: "fail" });
    expect(contrastVerdict("#FFFFFF", "#C9731C", "White on saffron")?.level).toBe("AA large");
    expect(textOn("#F2B632")).toBe("#1D1A16");
    expect(textOn("#1B2C5C")).toBe("#FFFFFF");
  });
  it("parses and normalizes brand colors", () => {
    expect(parseBrandColors(form({ primary: "1b2c5c", accent: "#c9731c" }))).toEqual({ ok: true, value: { primary: "#1B2C5C", accent: "#C9731C" } });
    expect(parseBrandColors(form({ primary: "navy", accent: "" })).ok).toBe(false);
  });
});

describe("leaders", () => {
  it("parses a leader and checks the term", () => {
    expect(parseLeader(form({ full_name: "Ona Owner", title: "President", body: "executive_committee", term_start: "2026-01-01", show_publicly: "on" }))).toEqual({
      ok: true,
      value: { full_name: "Ona Owner", title: "President", body: "executive_committee", person_id: null, term_start: "2026-01-01", term_end: null, show_publicly: true, sort: 0 },
    });
    const bad = parseLeader(form({ full_name: "O", title: "", term_start: "2026-02-01", term_end: "2026-01-01" }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("ends before it starts");
  });
});
