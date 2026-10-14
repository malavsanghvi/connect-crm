import { describe, expect, it } from "vitest";

import { holdForRecord, isLowConfidence } from "@/lib/onboarding/resolve/tier";
import { makeConfig } from "@/lib/onboarding/resolve/config";
import { normalizeRecord } from "@/lib/onboarding/resolve/normalize";

import { gift, pairOf, rec, run, TODAY } from "./fixtures/onboarding-resolve/helpers";

const strong = { mobile: "713-555-0142", address1: "12 Lotus Ln", zip: "77478" };

describe("tier D: held, never decided by code", () => {
  it("anyone under 18 is held even when two identifiers agree", () => {
    const res = run([
      rec({ id: "dad", name: "Rahul Shah", ...strong }),
      rec({ id: "kid", name: "Zoya Shah", source: "b.csv", phone: "713-555-0142", address1: "12 Lotus Ln", zip: "77478", role: "Daughter" }),
    ]);
    const p = pairOf(res, "dad", "kid")!;
    expect(p.independent).toBeGreaterThanOrEqual(2);
    expect(p.tier).toBe("D");
    expect(p.hold).toBe("minor");
    expect(p.signature).toBe("minor_record");
    expect(p.affected).toEqual(["kid"]);
    expect(res.clusters).toHaveLength(0);
    expect(res.dispositions.find((d) => d.id === "kid")!.status).toBe("held");
    expect(res.dispositions.find((d) => d.id === "dad")!.status).toBe("auto");
  });
  it("a child with no pair at all is still held", () => {
    const res = run([rec({ id: "kid", name: "Zoya Shah", dob: "2014-05-03" })]);
    expect(res.dispositions[0].status).toBe("held");
    expect(res.groups.map((g) => g.signature)).toEqual(["minor_record"]);
  });
  it("every sign of a child holds the record: flag, age, birth date, role, grade, school, title", () => {
    for (const extra of [{ isChild: true }, { age: 9 }, { dob: "2016-01-30" }, { role: "Son" }, { grade: "KG" }, { school: "Cedar Elementary" }, { name: "Master Arjun Shah" }]) {
      const res = run([rec({ id: "k", name: "Arjun Shah", ...extra })]);
      expect(res.dispositions[0].status, JSON.stringify(extra)).toBe("held");
    }
  });
  it("a birth date that could be read as a minor holds the record", () => {
    const res = run([rec({ id: "k", name: "Arjun Shah", dob: "11/10/2008" })]);
    expect(res.dispositions[0].status).toBe("held");
  });
  it("a record of uncertain kind is held", () => {
    const res = run([
      rec({ id: "a", name: "Rahul Shah", ...strong }),
      rec({ id: "u", name: "Rahul Shah", source: "b.csv", kind: "unknown", phone: "713-555-0142", address1: "12 Lotus Ln", zip: "77478" }),
    ]);
    const p = pairOf(res, "a", "u")!;
    expect(p.tier).toBe("D");
    expect(p.hold).toBe("uncertain_type");
    expect(res.groups.map((g) => g.signature)).toEqual(["uncertain_type"]);
  });
  it("a gift whose amount is blank, zero, negative or unreadable is held", () => {
    for (const amount of ["", "0", "(25.00)", "lots"]) {
      const res = run([gift({ id: "g", name: "Rahul Shah", amount, date: "2026-03-05" })]);
      expect(res.dispositions[0].status, amount).toBe("held");
      expect(res.groups[0].signature).toBe("unreadable_money");
    }
  });
  it("D beats a strong money match: a minor on a gift row stays held", () => {
    const res = run([
      gift({ id: "g1", name: "Zoya Shah", isChild: true, email: "z@example.com", amount: "10.00", date: "2026-03-05" }),
      gift({ id: "g2", name: "Zoya Shah", source: "g2.csv", email: "z@example.com", amount: "10.00", date: "2026-03-05" }),
    ]);
    expect(res.pairs.every((p) => p.tier !== "A")).toBe(true);
  });
});

describe("low-confidence reads (a photo or a scanned page)", () => {
  const c = makeConfig(TODAY, { country: "US" });
  it("a read under the threshold is never better than a question", () => {
    const sure = run([
      rec({ id: "a", name: "Rahul Shah", ...strong }),
      rec({ id: "p", name: "Rahul Shah", source: "scan.pdf", sourceKind: "paper", readConfidence: 0.97, mobile: "713-555-0142", address1: "12 Lotus Ln", zip: "77478" }),
    ]);
    expect(pairOf(sure, "a", "p")!.tier).toBe("A");
    const unsure = run([
      rec({ id: "a", name: "Rahul Shah", ...strong }),
      rec({ id: "p", name: "Rahul Shah", source: "scan.pdf", sourceKind: "paper", readConfidence: 0.8, mobile: "713-555-0142", address1: "12 Lotus Ln", zip: "77478" }),
    ]);
    const p = pairOf(unsure, "a", "p")!;
    expect(p.tier).toBe("C");
    expect(p.signature).toBe("low_confidence_read");
    expect(unsure.dispositions.find((d) => d.id === "p")!.status).toBe("asked");
    expect(unsure.groups.map((g) => g.signature)).toEqual(["low_confidence_read"]);
  });
  it("is judged on the config's threshold", () => {
    const r = normalizeRecord(rec({ name: "x y", readConfidence: 0.85 }), 0, c);
    expect(isLowConfidence(r, c)).toBe(true);
    expect(isLowConfidence(r, makeConfig(TODAY, { minReadConfidence: 0.8 }))).toBe(false);
    expect(holdForRecord(r)).toBeNull();
  });
});

describe("thresholds live in one config object", () => {
  const rows = () => [rec({ id: "a", name: "Rahul Shah", ...strong }), rec({ id: "b", name: "Mira Shah", source: "b.csv", phone: "713-555-0142", address1: "12 Lotus Ln", zip: "77478" })];
  it("raising the number of identifiers needed for tier A sends the pair to review", () => {
    expect(pairOf(run(rows()), "a", "b")!.tier).toBe("A");
    expect(pairOf(run(rows(), { tier: { autoMinIdentifiers: 3, familyNameAtAddress: false } }), "a", "b")!.tier).toBe("B");
  });
  it("raising the minimum score does the same", () => {
    expect(pairOf(run(rows(), { tier: { autoMinScore: 95, familyNameAtAddress: false } }), "a", "b")!.tier).toBe("B");
  });
  it("the defaults are what the brief says", () => {
    const c = makeConfig(TODAY, { country: "US" });
    expect(c.tier.autoMinIdentifiers).toBe(2);
    expect(c.minorAge).toBe(18);
    expect(c.budget.questionsPer1000).toBe(10);
    expect(() => makeConfig("11/10/2026")).toThrow();
  });
});
