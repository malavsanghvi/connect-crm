import { describe, expect, it } from "vitest";

import { makeConfig } from "@/lib/onboarding/resolve/config";
import { questionBudget, SIGNATURES } from "@/lib/onboarding/resolve/exceptions";
import { missingTranslations, STRINGS, text, type StringKey } from "@/lib/onboarding/resolve/strings";

import { gift, rec, run, TODAY } from "./fixtures/onboarding-resolve/helpers";

const scenario = () => [
  // two pairs that share a phone: one pattern, one question
  rec({ id: "p1", name: "Rahul Doshi", mobile: "713-555-0101", address1: "12 Lotus Ln", zip: "77478" }),
  rec({ id: "p2", name: "Nirav Kapadia", source: "b.csv", phone: "713-555-0101", address1: "90 Cedar Dr", zip: "77479" }),
  rec({ id: "p3", name: "Hetal Modi", mobile: "281-555-0202", address1: "5 Maple Ct", zip: "77478" }),
  rec({ id: "p4", name: "Sonal Amin", source: "b.csv", phone: "281-555-0202", address1: "7 Banyan Cir", zip: "77459" }),
  // a spouse under a maiden name, address only
  rec({ id: "m1", name: "Kiran Shah", mobile: "832-555-0303", address1: "33 Jasmine Way", zip: "77406" }),
  rec({ id: "m2", name: "Pooja Desai", source: "b.csv", address1: "33 Jasmine Way", zip: "77406" }),
  // a possible duplicate gift with only a name to go on: money is at stake
  gift({ id: "d1", name: "Mahesh Joshi", source: "bank.csv", amount: "500.00", date: "2026-03-05" }),
  gift({ id: "d2", name: "Joshi, Mahesh", source: "qbo", amount: "500.00", date: "2026-03-05" }),
  // a money conflict
  gift({ id: "c1", name: "Dipak Vora", source: "bank.csv", amount: "100.00", date: "2026-04-05", ref: "7001" }),
  gift({ id: "c2", name: "Vora, Dipak", source: "qbo", amount: "100.07", date: "2026-04-05", ref: "7001" }),
  // children
  rec({ id: "k1", name: "Zoya Trivedi", role: "Daughter", phone: "281-555-0404", address1: "8 Orchid St", zip: "77099" }),
  rec({ id: "k2", name: "Arjun Trivedi", role: "Son", phone: "281-555-0404", address1: "8 Orchid St", zip: "77099" }),
  rec({ id: "k3", name: "Neel Gandhi", dob: "2015-06-20" }),
];

describe("grouping by pattern", () => {
  const res = run(scenario());
  const sig = (s: string) => res.groups.find((g) => g.signature === s)!;

  it("makes one question per pattern, however many rows share it", () => {
    expect(res.groups.map((g) => g.signature).sort()).toEqual(
      ["amount_differs_cents", "duplicate_gift_two_sources", "minor_record", "shared_phone_households", "spouse_maiden_name"].sort(),
    );
    expect(sig("shared_phone_households").subjects).toHaveLength(2);
    expect(sig("shared_phone_households").items).toHaveLength(2);
    expect(sig("minor_record").subjects).toEqual(["k1", "k2", "k3"]);
  });

  it("ranks by value: money first, then members, then contacts", () => {
    const order = res.groups.map((g) => g.signature);
    // the money groups come before the groups without money
    const money = order.filter((s) => SIGNATURES[s].money);
    expect(order.slice(0, money.length).sort()).toEqual(money.sort());
    expect(sig("duplicate_gift_two_sources").value.moneyCents).toBe(50000);
    expect(sig("amount_differs_cents").value.moneyCents).toBe(10007);
    const noMoney = res.groups.filter((g) => g.value.moneyCents === 0);
    const members = noMoney.map((g) => g.value.members);
    expect([...members].sort((a, b) => b - a)).toEqual(members);
  });

  it("words one plain question per group, with the count in it", () => {
    const q = sig("shared_phone_households").question;
    expect(q.title).toBe("2 rows share a phone number with a household that has a different address and family name. Are they the same household?");
    expect(q.detail).toBe("The phone number matches. Nothing else does.");
    expect(q.count).toBe(2);
    expect(sig("spouse_maiden_name").question.title.startsWith("1 row lists someone")).toBe(true);
  });

  it("offers at most three answers and recommends the first", () => {
    for (const g of res.groups) {
      expect(g.question.answers.length).toBeGreaterThan(0);
      expect(g.question.answers.length).toBeLessThanOrEqual(3);
      expect(g.question.answers[0].recommended).toBe(true);
      expect(g.question.recommended).toBe(g.question.answers[0].code);
      expect(g.question.answers.filter((a) => a.recommended)).toHaveLength(1);
    }
    expect(sig("shared_phone_households").question.recommended).toBe("separate");
    expect(sig("spouse_maiden_name").question.recommended).toBe("same_household");
  });

  it("offers 'same answer for the other N' when a person may give one answer for the group", () => {
    const s = sig("shared_phone_households").question.sameForRest;
    expect(s).toEqual({ available: true, others: 1, label: "Use the same answer for the other one" });
    expect(sig("spouse_maiden_name").question.sameForRest.available).toBe(false); // nothing "other" in a group of one
    expect(sig("minor_record").question.sameForRest).toMatchObject({ available: true, others: 2, label: "Use the same answer for the other 2" });
  });

  it("never offers a bulk answer for money, and sends money questions to the treasurer", () => {
    const q = sig("amount_differs_cents").question;
    expect(q.sameForRest.available).toBe(false);
    expect(q.sameForRest.label).toBe("Each of these needs its own answer, because it involves money");
    expect(q.routeTo).toBe("treasurer");
    expect(q.rememberable).toBe(false);
    expect(sig("duplicate_gift_two_sources").question.routeTo).toBe("treasurer");
  });

  it("tier D groups are never rememberable", () => {
    for (const g of res.groups.filter((x) => x.tier === "D")) expect(g.question.rememberable).toBe(false);
    expect(sig("minor_record").tier).toBe("D");
    expect(sig("amount_differs_cents").tier).toBe("D");
  });

  it("shows a household's details in an example, never just a name, and nothing about a child", () => {
    const ex = sig("shared_phone_households").question.examples[0];
    expect(ex.lines.join(" ")).toMatch(/phone ending 0101/);
    expect(ex.lines.join(" ")).toMatch(/lotus|cedar|maple|banyan/);
    expect(ex.evidence).toContain("same phone number");
    const kids = sig("minor_record").question.examples.flatMap((e) => e.lines).join(" ");
    expect(kids).toMatch(/details withheld/);
    expect(kids).not.toMatch(/Zoya|Arjun|Neel|Trivedi|Gandhi/);
  });
});

describe("the question budget", () => {
  const cfg = makeConfig(TODAY, { country: "US" });
  const res = run(scenario());
  it("counts questions per 1,000 rows against the target of 10", () => {
    const b = questionBudget(res.groups, 1000, cfg);
    expect(b.questions).toBe(5);
    expect(b.perThousand).toBe(5);
    expect(b.withinTarget).toBe(true);
    expect(b.allowed).toBe(10);
    expect(b.deferrable).toEqual([]);
    expect(b.summary).toBe("5 questions for 1000 rows (5 per 1,000). That is within the target of 10.");
  });
  it("says so when a small file costs more than the target, and which groups can wait", () => {
    const b = questionBudget(res.groups, 300, cfg);
    expect(b.perThousand).toBe(16.7);
    expect(b.withinTarget).toBe(false);
    expect(b.allowed).toBe(3);
    expect(b.deferrable).toHaveLength(2);
    // the groups that can wait are the lowest in value
    const kept = res.groups.slice(0, 3).map((g) => g.id);
    for (const id of b.deferrable) expect(kept).not.toContain(id);
    expect(b.summary).toContain("The target is 10");
  });
  it("is zero for no rows and never divides by zero", () => {
    const b = questionBudget([], 0, cfg);
    expect(b.perThousand).toBe(0);
    expect(b.withinTarget).toBe(true);
  });
});

describe("words", () => {
  it("has an English string for every key, and Gujarati and Hindi slots that fall back to English", () => {
    for (const key of Object.keys(STRINGS) as StringKey[]) {
      expect(STRINGS[key].en.length, key).toBeGreaterThan(3);
      expect(text(key, "gu", { n: 3 }), key).toBe(text(key, "en", { n: 3 }));
      expect(text(key, "hi", { n: 3 }), key).toBe(text(key, "en", { n: 3 }));
    }
    expect(missingTranslations("gu")).toHaveLength(Object.keys(STRINGS).length);
    expect(missingTranslations("hi")).toHaveLength(Object.keys(STRINGS).length);
  });
  it("uses the singular for one and the plural for many", () => {
    expect(text("q.name_only.title", "en", { n: 1 })).toMatch(/^1 row has the same name/);
    expect(text("q.name_only.title", "en", { n: 4 })).toMatch(/^4 rows have the same name/);
  });
  it("is plain English: no jargon, and 'pledge' rules stay out of gift wording", () => {
    const all = Object.values(STRINGS)
      .map((e) => e.en)
      .join(" ")
      .toLowerCase();
    for (const banned of [" bid", "tier ", "blocking", "heuristic", "fingerprint", "confidence score", "rls", "null"]) expect(all.includes(banned), banned).toBe(false);
  });
  it("every signature has a title, a detail and answers with words", () => {
    for (const [sig, spec] of Object.entries(SIGNATURES)) {
      expect(`q.${sig}.title` in STRINGS, sig).toBe(true);
      expect(`q.${sig}.title.one` in STRINGS, sig).toBe(true);
      expect(`q.${sig}.detail` in STRINGS, sig).toBe(true);
      expect(spec.answers.length).toBeLessThanOrEqual(3);
      for (const a of spec.answers) expect(`a.${a}` in STRINGS, `${sig}/${a}`).toBe(true);
    }
  });
});
