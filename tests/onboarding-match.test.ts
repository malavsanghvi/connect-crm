import { describe, expect, it } from "vitest";

import { applyDecisions, matchPayers, type PayerInput } from "@/lib/onboarding/match";
import { addressKey, emailKey, parseName, phoneKey } from "@/lib/onboarding/normalize";

const row = (rowNo: number, name: string, extra: Partial<PayerInput> = {}): PayerInput => ({ rowNo, name, ...extra });

describe("normalizers", () => {
  it("phone: 10 digits however written", () => {
    expect(phoneKey("(281) 555-0142")).toBe("2815550142");
    expect(phoneKey("+1 281.555.0142 ext 12")).toBe("2815550142");
    expect(phoneKey("555-0142")).toBeNull();
    expect(phoneKey("0000000000")).toBeNull();
  });
  it("email: gmail dots and plus tags fold; others only lower-case", () => {
    expect(emailKey("Malav.Sanghvi+jsh@Gmail.com")).toBe("malavsanghvi@gmail.com");
    expect(emailKey("A.B@corp.com")).toBe("a.b@corp.com");
    expect(emailKey("nope")).toBeNull();
  });
  it("address: street words fold, unit kept apart, ZIP first five", () => {
    expect(addressKey("12 Lotus Lane", "Apt 4", "77478-1234")).toEqual({ key: "77478|12|lotus ln", unit: "4", zip: "77478" });
    expect(addressKey("12 Lotus Ln.", null, "77478")?.key).toBe("77478|12|lotus ln");
    expect(addressKey("PO Box", null, "77478")).toBeNull();
  });
  it("names: comma form, pairs, titles", () => {
    expect(parseName("Sanghvi, Malav & Palak")).toEqual({ surname: "sanghvi", givens: ["malav", "palak"] });
    expect(parseName("Malav and Palak Sanghvi")).toEqual({ surname: "sanghvi", givens: ["malav", "palak"] });
    expect(parseName("Dr. Mike Shah Jr.")).toEqual({ surname: "shah", givens: ["michael"] });
  });
});

describe("matchPayers", () => {
  it("links the same family written three ways by phone + surname, with no question", () => {
    const r = matchPayers([
      row(1, "Malav Sanghvi", { phone: "281-555-0142" }),
      row(2, "Sanghvi, Malav & Palak", { phone: "(281) 555 0142" }),
      row(3, "Palak Sanghvi", { phone: "2815550142" }),
    ]);
    expect(r.groups).toHaveLength(1);
    expect(r.questions).toHaveLength(0);
    expect(r.groups[0]!.rows).toEqual([1, 2, 3]);
    expect(r.groups[0]!.displayName).toBe("Sanghvi, Malav & Palak");
  });

  it("a spouse with another surname: phone + address together link them without asking", () => {
    const r = matchPayers([
      row(1, "Malav Sanghvi", { phone: "2815550142", address1: "12 Lotus Lane", zip: "77478" }),
      row(2, "Palak Sheth", { phone: "281-555-0142", address1: "12 Lotus Ln", zip: "77478" }),
    ]);
    expect(r.groups).toHaveLength(1);
    expect(r.questions).toHaveLength(0);
  });

  it("a shared phone with a different surname asks once", () => {
    const r = matchPayers([row(1, "Malav Sanghvi", { phone: "2815550142" }), row(2, "Palak Sheth", { phone: "2815550142" })]);
    expect(r.groups).toHaveLength(2);
    expect(r.questions).toHaveLength(1);
    expect(r.questions[0]!.evidence).toContain("phone");
    expect(applyDecisions(r, new Set([r.questions[0]!.id]))).toHaveLength(1);
    expect(applyDecisions(r, new Set())).toHaveLength(2);
  });

  it("the same address and surname link; two apartments in one building do not", () => {
    const same = matchPayers([row(1, "Raj Shah", { address1: "9 Oak St", zip: "77479" }), row(2, "Mina Shah", { address1: "9 Oak Street", zip: "77479" })]);
    expect(same.groups).toHaveLength(1);
    const apts = matchPayers([row(1, "Raj Shah", { address1: "9 Oak St", address2: "Apt 1", zip: "77479" }), row(2, "Mina Shah", { address1: "9 Oak St", address2: "Apt 2", zip: "77479" })]);
    expect(apts.groups).toHaveLength(2);
  });

  it("the same name with different phone, email and address stays separate without a question", () => {
    const r = matchPayers([
      row(1, "Amit Patel", { phone: "2815550001", email: "a@x.com", address1: "1 Elm St", zip: "77001" }),
      row(2, "Amit Patel", { phone: "7135550002", email: "b@y.com", address1: "500 Main St", zip: "77002" }),
    ]);
    expect(r.groups).toHaveLength(2);
    expect(r.questions).toHaveLength(0);
  });

  it("the same name with nothing else to compare asks", () => {
    const r = matchPayers([row(1, "Amit Patel"), row(2, "Amit Patel")]);
    expect(r.questions).toHaveLength(1);
    expect(r.questions[0]!.note).toContain("same name");
  });

  it("a close spelling of the surname still links with a phone", () => {
    const r = matchPayers([row(1, "Malav Sanghvi", { phone: "2815550142" }), row(2, "Malav Sanghavi", { phone: "2815550142" })]);
    expect(r.groups).toHaveLength(1);
  });

  it("keeps every name a household was recorded under", () => {
    const r = matchPayers([row(1, "M Sanghvi", { email: "m@x.com" }), row(2, "Malav Sanghvi", { email: "m@x.com" })]);
    expect(r.groups[0]!.names.sort()).toEqual(["M Sanghvi", "Malav Sanghvi"]);
  });

  it("is deterministic and handles a few thousand rows quickly", () => {
    const rows: PayerInput[] = [];
    for (let i = 0; i < 3000; i++) rows.push(row(i + 1, `Person${i} Family${i % 500}`, { phone: String(2000000000 + (i % 1500)) }));
    const t = Date.now();
    const a = matchPayers(rows);
    expect(Date.now() - t).toBeLessThan(5000);
    expect(matchPayers(rows).groups.length).toBe(a.groups.length);
  });
});
