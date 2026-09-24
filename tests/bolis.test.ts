import { describe, expect, it } from "vitest";

import {
  boliRef,
  boliRuleDefaults,
  checkUploadRows,
  closesInFuture,
  householdKey,
  leadingEntry,
  nextMinimum,
  otherInterestedHouseholds,
  parseBoliUploadCsv,
  parseCalledAt,
  rankEntries,
  uploadTemplateCsv,
  type HouseholdMatch,
  type UploadBoli,
} from "@/lib/bolis";

const e = (id: string, household_id: string, amount_cents: number, entered_at: string) => ({ id, household_id, amount_cents, entered_at });

describe("winner order (highest, then first recorded)", () => {
  const entries = [e("a", "h1", 50100, "2026-09-21T20:14:00Z"), e("b", "h2", 75100, "2026-09-21T20:20:00Z"), e("c", "h3", 75100, "2026-09-21T20:15:00Z")];
  it("ranks by amount, earliest wins a tie", () => {
    expect(rankEntries(entries).map((x) => x.id)).toEqual(["c", "b", "a"]);
    expect(leadingEntry(entries)?.id).toBe("c");
  });
  it("prefers the recorded winner once closed", () => {
    expect(leadingEntry(entries, "b")?.id).toBe("b");
  });
  it("lists the other interested households once each", () => {
    const more = [...entries, e("d", "h2", 80000, "2026-09-21T19:00:00Z")];
    expect(otherInterestedHouseholds(more)).toEqual(["h3", "h1"]);
    expect(otherInterestedHouseholds([])).toEqual([]);
  });
  it("computes the next minimum like app.boli_minimum", () => {
    expect(nextMinimum([], 10100, 2100)).toBe(10100);
    expect(nextMinimum(entries, 10100, 2100)).toBe(77200);
  });
  it("knows when closing would be early", () => {
    const now = new Date("2026-09-22T00:00:00Z");
    expect(closesInFuture("2026-09-23T00:00:00Z", now)).toBe(true);
    expect(closesInFuture("2026-09-21T00:00:00Z", now)).toBe(false);
    expect(closesInFuture(null, now)).toBe(false);
  });
  it("makes a short reference and reads rule defaults", () => {
    expect(boliRef("3f9a2c11-0000-4000-8000-000000000000")).toBe("BL-3F9A2C");
    expect(boliRuleDefaults({ boli: { step_cents: 5100, soft_close_minutes: 3 } })).toEqual({ stepCents: 5100, softCloseMinutes: 3 });
    expect(boliRuleDefaults(null)).toEqual({ stepCents: 2100, softCloseMinutes: 5 });
  });
});

describe("in-person upload CSV", () => {
  it("round-trips the template header", () => {
    const parsed = parseBoliUploadCsv(uploadTemplateCsv({ boli: "Mangal divo", event: "Diwali" }));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({ row: 2, boli: "Mangal divo", event: "Diwali", household: "H-1024", amountText: "151", calledAt: "7:45 PM" });
  });
  it("needs the key columns", () => {
    expect(parseBoliUploadCsv("Boli,Event\nA,B\n").errors[0]).toMatch(/Household ID or name/);
    expect(parseBoliUploadCsv("").errors[0]).toMatch(/empty/);
  });
  it("skips blank lines", () => {
    expect(parseBoliUploadCsv("Boli name,Household,Amount\n,,\nX,H-1,5\n").rows).toHaveLength(1);
  });
  it("reads called-at times", () => {
    expect(parseCalledAt("7:45 PM", "2026-10-20")).toBe("2026-10-20T19:45");
    expect(parseCalledAt("12:05 am", "2026-10-20")).toBe("2026-10-20T00:05");
    expect(parseCalledAt("2026-10-21 09:30", "2026-10-20")).toBe("2026-10-21T09:30");
    expect(parseCalledAt("25:00", "2026-10-20")).toBeNull();
    expect(parseCalledAt("", "2026-10-20")).toBeNull();
  });
});

describe("upload row checks", () => {
  const bolis: UploadBoli[] = [
    { id: "b1", name: "Snatra puja kalash 1", kind: "in_person", status: "open", event_id: "e1", event_name: "Tapasvi Bahuman", floor_cents: 10100, top_cents: null },
    { id: "b2", name: "Snatra puja kalash 2", kind: "in_person", status: "closed", event_id: "e1", event_name: "Tapasvi Bahuman", floor_cents: 10100, top_cents: null },
    { id: "b3", name: "Mangal divo", kind: "digital", status: "open", event_id: "e1", event_name: "Tapasvi Bahuman", floor_cents: 10100, top_cents: null },
    { id: "b4", name: "Aarti", kind: "in_person", status: "open", event_id: null, event_name: null, floor_cents: 5100, top_cents: 20100 },
  ];
  const hh = new Map<string, HouseholdMatch>([
    [householdKey("H-1001"), { status: "found", household_id: "h1", label: "Shah · H-1001", byName: false }],
    [householdKey("Kothari family"), { status: "found", household_id: "h2", label: "Kothari family · H-1002", byName: true }],
    [householdKey("Shah"), { status: "ambiguous", count: 3 }],
  ]);
  const row = (n: number, boli: string, household: string, amountText: string, event = "Tapasvi Bahuman") => ({
    row: n,
    boli,
    event,
    household,
    amountText,
    calledAt: "",
  });
  const out = checkUploadRows(
    [
      row(2, "Snatra puja kalash 1", "H-1001", "151"),
      row(3, "snatra  puja kalash 1", "Kothari family", "251"),
      row(4, "Snatra puja kalash 2", "H-1001", "151"),
      row(5, "Mangal divo", "H-1001", "151"),
      row(6, "Unknown", "H-1001", "151"),
      row(7, "Aarti", "H-99999", "151", ""),
      row(8, "Aarti", "Shah", "151", ""),
      row(9, "Aarti", "Kothari family", "50", ""),
      row(10, "Aarti", "Kothari family", "abc", ""),
      row(11, "Snatra puja kalash 1", "H-1001", "151", "Other event"),
    ],
    bolis,
    hh,
  );
  const check = (n: number) => out.find((r) => r.row === n)!;
  it("accepts a good row and resolves the household", () => {
    expect(check(2)).toMatchObject({ ok: true, check: "OK", boli_id: "b1", household_id: "h1", amount_cents: 15100 });
  });
  it("flags each problem in plain words", () => {
    expect(check(3).check).toMatch(/Listed twice/);
    expect(check(4).check).toBe("Boli is already closed");
    expect(check(5).check).toMatch(/digital boli/);
    expect(check(6).check).toBe("Boli not found");
    expect(check(7).check).toBe("Household not found");
    expect(check(8).check).toMatch(/3 households match/);
    expect(check(9).check).toBe("Below floor ($51.00)");
    expect(check(10).check).toMatch(/not an amount/);
    expect(check(11).check).toMatch(/Event does not match/);
  });
  it("rejects an amount that would not win over a recorded pledge", () => {
    const r = checkUploadRows([row(2, "Aarti", "Kothari family", "151", "")], bolis, hh)[0];
    expect(r.check).toMatch(/already recorded/);
  });
  it("marks a name-only household match for a second look", () => {
    const r = checkUploadRows([row(2, "Aarti", "Kothari family", "251", "")], bolis, hh)[0];
    expect(r).toMatchObject({ ok: true, check: "OK · matched by name, check the family" });
  });
});
