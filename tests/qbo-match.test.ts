import { describe, expect, it } from "vitest";

import { addressLine, bulkPick, confidencePct, confidenceTone, isMatchTab, landingText, methodLabel, parseThreshold, readEvidence } from "@/lib/qbo-match";

describe("readEvidence", () => {
  it("reads both sides and orders the strongest signal first", () => {
    const e = readEvidence({
      signals: [
        { kind: "household_name", label: "Same family name", qb: "Shah Family", cc: "Shah family" },
        { kind: "crm_id", label: "QuickBooks customer ID already on file", qb: "1187", cc: "1187" },
      ],
      qb: { display_name: "Shah Family", emails: ["priya.shah@example.com", 3], phones: [], address: { city: "Katy", zip: "77494", junk: 1 }, family_like: true },
      cc: { household: "Shah family", members: ["Priya Shah", "Rahul Shah"], primary: "Priya Shah" },
    });
    expect(e.signals.map((s) => s.kind)).toEqual(["crm_id", "household_name"]);
    expect(e.qb.emails).toEqual(["priya.shah@example.com"]);
    expect(e.qb.address).toEqual({ city: "Katy", zip: "77494" });
    expect(e.qb.family_like).toBe(true);
    expect(e.cc.primary).toBe("Priya Shah");
    expect(e.cc.person).toBeNull();
  });
  it("survives garbage", () => {
    const e = readEvidence(null);
    expect(e.signals).toEqual([]);
    expect(e.qb.display_name).toBeNull();
    expect(readEvidence({ signals: "x", qb: [] }).signals).toEqual([]);
  });
});

describe("bulkPick", () => {
  const rows = [
    { id: "a1", qbo_customer_id: "A", confidence: 0.99 },
    { id: "a2", qbo_customer_id: "A", confidence: 0.65 },
    { id: "b1", qbo_customer_id: "B", confidence: "0.920" },
    { id: "c1", qbo_customer_id: "C", confidence: 0.97 },
    { id: "c2", qbo_customer_id: "C", confidence: 0.9 },
    { id: "d1", qbo_customer_id: "D", confidence: 0.75 },
  ];
  it("takes each customer's best suggestion over the threshold", () => {
    expect(bulkPick(rows, 0.9).sort()).toEqual(["a1", "b1"]);
  });
  it("never takes a customer whose top two are within 0.1", () => {
    expect(bulkPick(rows, 0.5)).not.toContain("c1");
    expect(bulkPick(rows, 0.5)).toContain("d1");
  });
});

describe("labels and parsing", () => {
  it("thresholds are percents from 50 to 100, default 95", () => {
    expect(parseThreshold("")).toBe(0.95);
    expect(parseThreshold("90%")).toBe(0.9);
    expect(parseThreshold("40")).toBeNull();
    expect(parseThreshold("abc")).toBeNull();
  });
  it("confidence reads as a percent with a tone", () => {
    expect(confidencePct(0.973)).toBe("97%");
    expect(confidencePct(null)).toBe("—");
    expect(confidenceTone(0.95)).toBe("ok");
    expect(confidenceTone("0.7")).toBe("warn");
    expect(confidenceTone(0.3)).toBe("bad");
  });
  it("says where the history lands", () => {
    expect(landingText("Kiran Mehta", "Kiran Mehta")).toMatch(/Person-level/);
    expect(landingText(null, "Priya Shah")).toBe("Family-level: recorded on the primary member, Priya Shah");
    expect(landingText(null, null)).toMatch(/no primary member/);
  });
  it("misc", () => {
    expect(methodLabel("ai")).toBe("AI suggestion");
    expect(methodLabel("zzz")).toBe("zzz");
    expect(isMatchTab("not_mapped")).toBe(true);
    expect(isMatchTab("x")).toBe(false);
    expect(addressLine({ line1: "12 Lotus Ln", city: "Katy", state: "TX", zip: "77494" })).toBe("12 Lotus Ln, Katy TX, 77494");
  });
});
