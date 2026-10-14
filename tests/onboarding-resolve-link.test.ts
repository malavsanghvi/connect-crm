import { describe, expect, it } from "vitest";

import { blockingKeys, compareAddresses, compareDob, compareNames, editDistanceAtMost1 } from "@/lib/onboarding/resolve/link";
import { makeConfig } from "@/lib/onboarding/resolve/config";
import { normalizeAddress, normalizeName, parseDate, normalizeRecord } from "@/lib/onboarding/resolve/normalize";

import { gift, labels, pairOf, rec, run, TODAY } from "./fixtures/onboarding-resolve/helpers";

const cfg = makeConfig(TODAY, { country: "US" });
const names = (a: string, b: string) => compareNames(normalizeName({ full: a }), normalizeName({ full: b }), cfg);

describe("comparing names", () => {
  it("matches spelling variants, honorifics, initials and 'Last, First'", () => {
    expect(names("Mira Patel", "Miraben Patil").level).toBe("match");
    expect(names("Rahul Shah", "Shah, Rahulbhai").level).toBe("match");
    expect(names("Rahul Shah", "R. Saha").level).toBe("match");
    expect(names("Jignesh Sanghvi", "Jignesh Sanghavi").level).toBe("match");
    expect(names("Mike Doshi", "Michael Dosi").level).toBe("match");
  });
  it("tells family from person and explains a maiden name", () => {
    expect(names("Rahul Shah", "Mira Shah").level).toBe("surname_only");
    expect(names("Mira Shah", "Mira Patel").level).toBe("given_only");
    expect(names("Mira Patel nee Shah", "Mira Shah").level).toBe("maiden");
    expect(names("Mira Shah-Patel", "Mira Shah").level).toBe("maiden");
    expect(names("Mira Shah-Patel", "Mira Patel").level).toBe("match"); // the name she uses now
    expect(names("Rahul Shah", "Kiran Mehta").level).toBe("different");
  });
  it("matches any person of a household-style name", () => {
    expect(names("Rahul & Mira Shah", "Mira Shah").level).toBe("match");
  });
  it("sees Jr and Sr and a different middle name", () => {
    expect(names("Mahesh Patel Sr.", "Mahesh Patel Jr.").generation).toBe("differs");
    expect(names("Mahesh Patel Sr.", "Mahesh Patel").generation).toBe("one_sided");
    expect(names("Rahul Mukesh Shah", "Rahul Dinesh Shah").middle).toBe("differ");
    expect(names("Rahul Mukesh Shah", "Rahul Shah").middle).toBe("unknown");
  });
  it("edit distance helper", () => {
    expect(editDistanceAtMost1("sangvi", "sangavi")).toBe(true);
    expect(editDistanceAtMost1("abc", "axc")).toBe(true);
    expect(editDistanceAtMost1("abc", "xyz")).toBe(false);
    expect(editDistanceAtMost1("abcd", "ab")).toBe(false);
  });
});

describe("comparing addresses and birth dates", () => {
  const addr = (line1: string, zip = "77478", line2?: string) => normalizeAddress({ line1, line2, zip });
  it("same street, other unit, other street", () => {
    expect(compareAddresses(addr("12 Lotus Ln"), addr("12 N. Lotus Lane"))).toBe("same");
    expect(compareAddresses(addr("12 Lotus Ln Apt 4"), addr("12 Lotus Lane #4"))).toBe("same");
    expect(compareAddresses(addr("12 Lotus Ln Apt 4"), addr("12 Lotus Ln Apt 5"))).toBe("other_unit");
    expect(compareAddresses(addr("12 Lotus Ln Apt 4"), addr("12 Lotus Ln"))).toBe("same_partial_unit");
    expect(compareAddresses(addr("12 Lotus Ln"), addr("14 Lotus Ln"))).toBe("different");
    expect(compareAddresses(addr("12 Lotus Ln", "77478"), addr("12 Lotus Ln", "77479"))).toBe("different");
    expect(compareAddresses(addr("12 Lotus Ln"), addr("12 Lotus Ct"))).toBe("different");
    expect(compareAddresses(addr("12 Lotus Ln"), null)).toBe("unknown");
  });
  it("tolerates a one-letter typo in a long street name", () => {
    expect(compareAddresses(addr("12 Marigold Ave"), addr("12 Marigld Ave"))).toBe("same");
  });
  it("birth dates: equal, compatible when ambiguous, same year, different year", () => {
    const d = (s: string) => parseDate(s, { order: "unknown", today: TODAY, context: "birth" });
    expect(compareDob(d("1987-04-13"), d("04/13/1987"))).toBe("equal");
    expect(compareDob(d("1987-04-03"), d("03/04/1987"))).toBe("compatible");
    expect(compareDob(d("1987-04-13"), d("1987-05-13"))).toBe("same_year");
    expect(compareDob(d("1987-04-13"), d("1989-04-13"))).toBe("different_year");
    expect(compareDob(d("1987-04-13"), null)).toBe("unknown");
  });
});

describe("blocking keys", () => {
  it("uses phone, e-mail, street, ID, last name + ZIP, and the full name", () => {
    const n = normalizeRecord(
      rec({ name: "Rahul Shah", mobile: "713-555-0142", email: "R@x.com", address1: "12 Lotus Ln", zip: "77478", ids: { neon: "N7" } }),
      0,
      cfg,
    );
    const keys = blockingKeys(n, cfg);
    expect(keys).toEqual(expect.arrayContaining(["ph:+17135550142", "em:r@x.com", "ad:12|lotus|", "id:neon:n7", "ln:sa|77478", "nm:sa|raul"]));
  });
  it("adds the amount + date window and the check number for a gift", () => {
    const n = normalizeRecord(gift({ name: "Rahul Shah", amount: "100.00", date: "2026-03-05", ref: "Check #44" }), 0, cfg);
    const keys = blockingKeys(n, cfg);
    expect(keys).toContain("gr:44");
    expect(keys).toContain("ga:10000|2026-03-05");
    expect(keys).toContain("ga:10000|2026-03-08");
    expect(keys).not.toContain("ga:10000|2026-03-09");
  });
});

describe("a name alone never joins", () => {
  it("two identical names with nothing else are a question, never a link", () => {
    const res = run([rec({ id: "a", name: "Rahul Shah" }), rec({ id: "b", name: "Rahul Shah", source: "b.csv" })]);
    const p = pairOf(res, "a", "b")!;
    expect(p.strength).toBe("weak");
    expect(p.nameOnly).toBe(true);
    expect(p.independent).toBe(0);
    expect(p.tier).toBe("C");
    expect(p.signature).toBe("name_only");
    expect(res.clusters).toHaveLength(0);
  });
  it("a name plus the same ZIP is still only a question", () => {
    const res = run([
      rec({ id: "a", name: "Rahul Shah", address1: "12 Lotus Ln", zip: "77478" }),
      rec({ id: "b", name: "Rahul Shah", source: "b.csv", address1: "Temple Road", zip: "77478" }),
    ]);
    const p = pairOf(res, "a", "b")!;
    expect(labels(p)).toContain("same family name and ZIP code");
    expect(p.tier).toBe("C");
    expect(p.nameOnly).toBe(true);
  });
  it("the same name with every identifier different is two people, and no question", () => {
    const res = run([
      rec({ id: "a", name: "Amit Shah", mobile: "713-555-0101", email: "amit1@example.com", address1: "12 Lotus Ln", zip: "77478" }),
      rec({ id: "b", name: "Amit Shah", source: "b.csv", mobile: "281-555-0102", email: "amit2@example.com", address1: "90 Cedar Dr", zip: "77478" }),
    ]);
    expect(pairOf(res, "a", "b")).toBeUndefined();
    expect(res.metrics.auto).toBe(2);
  });
  it("property: rows that share a name but no identifier are never linked, whatever the names", () => {
    const given = ["Rahul", "Mira", "Kiran", "Hetal", "Jignesh", "Pooja"];
    const sur = ["Patel", "Shah", "Mehta", "Desai"];
    let seed = 7;
    const next = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let round = 0; round < 25; round++) {
      const rows = Array.from({ length: 12 }, (_, i) =>
        rec({
          id: `n${round}-${i}`,
          name: `${given[Math.floor(next() * given.length)]} ${sur[Math.floor(next() * sur.length)]}`,
          source: `s${i % 3}.csv`,
          // every identifier is unique to its row
          mobile: i % 2 === 0 ? `713555${String(1000 + round * 12 + i)}` : undefined,
          email: i % 3 === 0 ? `u${round}-${i}@example.com` : undefined,
          address1: i % 4 === 0 ? `${100 + round * 12 + i} Lotus Ln` : undefined,
          zip: "77478",
        }),
      );
      const res = run(rows);
      expect(res.clusters).toEqual([]);
      for (const p of res.pairs) {
        expect(p.tier === "A" || p.tier === "B", `${p.a} ~ ${p.b}`).toBe(false);
        expect(p.nameOnly).toBe(true);
      }
    }
  });
});

describe("evidence and tiers for a pair", () => {
  it("phone + address is automatic, as one household", () => {
    const res = run([
      rec({ id: "a", name: "Rahul Shah", mobile: "713-555-0142", address1: "12 Lotus Ln", zip: "77478" }),
      rec({ id: "b", name: "Mira Shah", source: "b.csv", phone: "(713) 555-0142", address1: "12 Lotus Lane", zip: "77478" }),
    ]);
    const p = pairOf(res, "a", "b")!;
    expect(p.tier).toBe("A");
    expect(p.relation).toBe("same_household");
    expect(p.independent).toBeGreaterThanOrEqual(2);
    expect(res.clusters.map((c) => c.recordIds)).toEqual([["a", "b"]]);
    expect(res.metrics.auto).toBe(2);
  });
  it("mobile + e-mail + a spelling variant is automatic, as one person, and says why", () => {
    const res = run([
      rec({ id: "a", name: "Mira Patel", mobile: "713-555-0142", email: "mira.patel@example.com" }),
      rec({ id: "b", name: "Miraben Patil", source: "b.csv", mobile: "(713) 555-0142", email: "MIRA.PATEL@EXAMPLE.COM" }),
    ]);
    const p = pairOf(res, "a", "b")!;
    expect(p.tier).toBe("A");
    expect(p.relation).toBe("same_person");
    expect(labels(p)).toEqual(expect.arrayContaining(["same mobile", "e-mail matches", "similar name (spelling differs)"]));
    expect(res.personClusters).toHaveLength(1);
  });
  it("one identifier plus a matching name is for bulk review, not automatic", () => {
    const res = run([
      rec({ id: "a", name: "Mira Patel", mobile: "713-555-0142" }),
      rec({ id: "b", name: "Mira Patel", source: "b.csv", mobile: "713-555-0142" }),
    ]);
    expect(pairOf(res, "a", "b")!.tier).toBe("B");
    expect(res.metrics.bulk).toBe(1);
    expect(res.clusters).toHaveLength(0);
  });
  it("one identifier and a different family name is a question", () => {
    const res = run([
      rec({ id: "a", name: "Rahul Doshi", mobile: "713-555-0142", address1: "12 Lotus Ln", zip: "77478" }),
      rec({ id: "b", name: "Nirav Kapadia", source: "b.csv", phone: "713-555-0142", address1: "90 Cedar Dr", zip: "77479" }),
    ]);
    const p = pairOf(res, "a", "b")!;
    expect(p.tier).toBe("C");
    expect(p.signature).toBe("shared_phone_households");
  });
  it("same address, different unit: said so, and a question", () => {
    const res = run([
      rec({ id: "a", name: "Hetal Patel", address1: "900 Vihar Ct Apt 4", zip: "77478" }),
      rec({ id: "b", name: "Nirav Patel", source: "b.csv", address1: "900 Vihar Court #5", zip: "77478" }),
    ]);
    const p = pairOf(res, "a", "b")!;
    expect(labels(p)).toContain("same address, different unit");
    expect(p.independent).toBe(0);
    expect(p.tier).toBe("C");
    expect(p.signature).toBe("address_unit_differs");
  });
  it("different surnames in different units are not even a question", () => {
    const res = run([
      rec({ id: "a", name: "Hetal Patel", address1: "900 Vihar Ct Apt 4", zip: "77478" }),
      rec({ id: "b", name: "Nirav Kapadia", source: "b.csv", address1: "900 Vihar Court #5", zip: "77478" }),
    ]);
    expect(pairOf(res, "a", "b")).toBeUndefined();
  });
  it("same e-mail in two households is a question", () => {
    const res = run([
      rec({ id: "a", name: "Rahul Doshi", email: "office@example.com", address1: "12 Lotus Ln", zip: "77478" }),
      rec({ id: "b", name: "Nirav Kapadia", source: "b.csv", email: "OFFICE@example.com", address1: "90 Cedar Dr", zip: "77479" }),
    ]);
    expect(pairOf(res, "a", "b")!.signature).toBe("shared_email_households");
  });
  it("a spouse under a maiden name at the same address, nothing else: a question", () => {
    const res = run([
      rec({ id: "a", name: "Rahul Shah", mobile: "713-555-0142", address1: "12 Lotus Ln", zip: "77478" }),
      rec({ id: "b", name: "Mira Patel", source: "b.csv", address1: "12 Lotus Lane", zip: "77478" }),
    ]);
    const p = pairOf(res, "a", "b")!;
    expect(p.tier).toBe("C");
    expect(p.signature).toBe("spouse_maiden_name");
  });
  it("a maiden name written on the record helps, but one identifier is still only for review", () => {
    const res = run([
      rec({ id: "a", name: "Mira Shah", address1: "12 Lotus Ln", zip: "77478" }),
      rec({ id: "b", name: "Mira Patel nee Shah", source: "b.csv", address1: "12 Lotus Lane", zip: "77478" }),
    ]);
    const p = pairOf(res, "a", "b")!;
    expect(p.nameLevel).toBe("maiden");
    expect(p.tier).toBe("B");
  });
});

describe("household members: the same address and the same family name", () => {
  const home = { address1: "7630 Marigold Ave", zip: "77478" };
  const pair = (extraA: object = {}, extraB: object = {}) => [
    rec({ id: "a", name: "Rahul Kapadia", mobile: "713-555-0101", ...home, ...extraA }),
    rec({ id: "b", name: "Jhanviben Kapadia", source: "b.csv", mobile: "832-555-0102", ...home, ...extraB }),
  ];
  it("two people with one family name at one street address are one household, automatically", () => {
    const res = run(pair());
    const p = pairOf(res, "a", "b")!;
    expect(p.relation).toBe("same_household");
    expect(labels(p)).toEqual(expect.arrayContaining(["same address", "same family name at the same address"]));
    expect(p.tier).toBe("A");
  });
  it("can be switched off, and then it is for bulk review", () => {
    expect(pairOf(run(pair(), { tier: { familyNameAtAddress: false } }), "a", "b")!.tier).toBe("B");
  });
  it("does not count at an address shared by several apartments or families", () => {
    const res = run([
      ...pair(),
      rec({ id: "c", name: "Pooja Desai", source: "c.csv", address1: "7630 Marigold Ave Apt 2", zip: "77478" }),
      rec({ id: "d", name: "Anand Shah", source: "d.csv", address1: "7630 Marigold Ave Apt 3", zip: "77478" }),
    ]);
    expect(pairOf(res, "a", "b")!.tier).toBe("B");
  });
  it("does not count when only one of the two addresses names the apartment", () => {
    const res = run(pair({ address1: "7630 Marigold Ave Apt 4" }));
    const p = pairOf(res, "a", "b")!;
    expect(p.conflicts.map((c) => c.kind)).toContain("unit_missing");
    expect(p.tier).not.toBe("A");
  });
  it("never makes two people into one person", () => {
    const p = pairOf(run(pair()), "a", "b")!;
    expect(p.relation).not.toBe("same_person");
    expect(run(pair()).personClusters).toHaveLength(0);
  });
  it("a family name at an address is not enough for the same person with only an initial", () => {
    const res = run([
      rec({ id: "a", name: "P. Kapadia", ...home, ids: { family: "F-9" } }),
      rec({ id: "b", name: "Pinal Kapadia", source: "b.csv", ...home, ids: { family: "F-9" } }),
    ]);
    const p = pairOf(res, "a", "b")!;
    expect(p.relation).toBe("same_household");
  });
});

describe("IDs and conflicts", () => {
  it("an ID that both systems assigned counts twice", () => {
    const existing = rec({ id: "x", name: "Mira Shah", sourceKind: "existing", existing: { householdId: "h1" }, ids: { neon: "N-17" } });
    const pulled = rec({ id: "y", name: "Mira Shah", source: "neon", sourceKind: "connector", ids: { neon: "n17" } });
    const res = run([existing, pulled]);
    const p = pairOf(res, "x", "y")!;
    expect(labels(p)).toContain("ID matches");
    expect(p.tier).toBe("A");
    expect(res.clusters[0].existing).toEqual(["h1"]);
  });
  it("the same ID typed in two spreadsheets is only for review", () => {
    const res = run([
      rec({ id: "a", name: "Mira Shah", ids: { neon: "N17" } }),
      rec({ id: "b", name: "Mira Shah", source: "b.csv", ids: { neon: "n-17" } }),
    ]);
    expect(pairOf(res, "a", "b")!.tier).toBe("B");
  });
  it("different IDs in one system block an automatic link, even when everything else agrees", () => {
    const common = { name: "Mira Shah", mobile: "713-555-0142", email: "mira@example.com", address1: "12 Lotus Ln", zip: "77478" };
    const res = run([rec({ id: "a", ...common, ids: { neon: "N1" } }), rec({ id: "b", ...common, source: "b.csv", ids: { neon: "N2" } })]);
    const p = pairOf(res, "a", "b")!;
    expect(p.conflicts.map((c) => c.kind)).toContain("id");
    expect(p.tier).toBe("C");
    expect(p.signature).toBe("ids_differ");
    expect(res.clusters).toHaveLength(0);
  });
  it("spouses with different person IDs are not in conflict", () => {
    const res = run([
      rec({ id: "a", name: "Rahul Shah", mobile: "713-555-0142", address1: "12 Lotus Ln", zip: "77478", ids: { jsh_person: "11" } }),
      rec({ id: "b", name: "Mira Shah", source: "b.csv", phone: "713-555-0142", address1: "12 Lotus Ln", zip: "77478", ids: { jsh_person: "12" } }),
    ]);
    expect(pairOf(res, "a", "b")!.tier).toBe("A");
  });
  it("different household IDs do conflict", () => {
    const res = run([
      rec({ id: "a", name: "Rahul Shah", mobile: "713-555-0142", address1: "12 Lotus Ln", zip: "77478", ids: { family: "F-1" } }),
      rec({ id: "b", name: "Mira Shah", source: "b.csv", phone: "713-555-0142", address1: "12 Lotus Ln", zip: "77478", ids: { family: "F-2" } }),
    ]);
    expect(pairOf(res, "a", "b")!.tier).toBe("C");
  });
  it("different birth years block an automatic link (a father and son with one name)", () => {
    const common = { name: "Rahul Shah", mobile: "713-555-0142", email: "r@example.com", address1: "12 Lotus Ln", zip: "77478" };
    const res = run([rec({ id: "a", ...common, dob: "1950-01-02" }), rec({ id: "b", ...common, source: "b.csv", dob: "1980-01-02" })]);
    const p = pairOf(res, "a", "b")!;
    expect(p.conflicts.map((c) => c.kind)).toContain("birth_year");
    expect(p.tier).toBe("C");
    expect(p.signature).toBe("birth_year_differs");
  });
  it("Jr and Sr block an automatic link", () => {
    const common = { mobile: "713-555-0142", address1: "12 Lotus Ln", zip: "77478" };
    const res = run([rec({ id: "a", ...common, name: "Mahesh Patel Sr." }), rec({ id: "b", ...common, source: "b.csv", name: "Mahesh Patel Jr." })]);
    expect(pairOf(res, "a", "b")!.tier).toBe("C");
  });
  it("a name that appears twice at one address in one file never makes a link automatic", () => {
    const home = { address1: "12 Lotus Ln", zip: "77478" };
    const res = run([
      rec({ id: "dir1", name: "Mahesh Patel", mobile: "713-555-0142", ...home }),
      rec({ id: "dir2", name: "Mahesh Patel", mobile: "713-555-0199", ...home }),
      rec({ id: "neon", name: "Patel, Mahesh", source: "neon.csv", sourceKind: "connector", mobile: "713-555-0142", ...home }),
    ]);
    const p = pairOf(res, "dir1", "neon")!;
    expect(p.conflicts.map((c) => c.kind)).toContain("ambiguous_name");
    expect(p.tier).toBe("B");
    expect(res.clusters.flatMap((c) => c.recordIds)).not.toContain("neon");
  });
  it("a phone shared by too many rows is not evidence (an office line)", () => {
    const rows = Array.from({ length: 14 }, (_, i) => rec({ id: `o${i}`, name: `Person${String.fromCharCode(97 + i)} Example${i}`, phone: "713-555-0100", address1: `${10 + i} Elm St`, zip: "77478", source: `s${i}.csv` }));
    const res = run(rows);
    expect(res.hubs.map((h) => h.key)).toEqual(["ph:+17135550100"]);
    expect(res.pairs).toHaveLength(0);
  });
  it("two households already in the records are never paired or merged", () => {
    const e = (id: string, h: string) => rec({ id, name: "Mira Shah", mobile: "713-555-0142", sourceKind: "existing", existing: { householdId: h } });
    const res = run([e("x1", "h1"), e("x2", "h2")]);
    expect(res.pairs).toHaveLength(0);
  });
  it("a new row that matches two different existing households joins neither automatically", () => {
    const x1 = rec({ id: "x1", name: "Mira Shah", mobile: "713-555-0142", address1: "12 Lotus Ln", zip: "77478", sourceKind: "existing", existing: { householdId: "h1" } });
    const x2 = rec({ id: "x2", name: "Mira Shah", mobile: "281-555-0188", email: "mira@example.com", address1: "90 Cedar Dr", zip: "77478", sourceKind: "existing", existing: { householdId: "h2" } });
    const n = rec({ id: "n", name: "Mira Shah", source: "new.csv", mobile: "713-555-0142", phone: "281-555-0188", email: "mira@example.com", address1: "12 Lotus Ln", zip: "77478" });
    const res = run([x1, x2, n]);
    const joined = res.clusters.filter((c) => c.recordIds.includes("n"));
    expect(joined.every((c) => c.existing.length <= 1)).toBe(true);
    const refused = res.pairs.filter((p) => p.signature === "linked_through_another_record");
    expect(refused).toHaveLength(1);
  });
  it("a chain of links is refused when its ends contradict each other", () => {
    const a = rec({ id: "a", name: "Rahul Shah", source: "s1.csv", dob: "1950-03-04", mobile: "713-555-0142", address1: "12 Lotus Ln", zip: "77478" });
    const b = rec({ id: "b", name: "Rahul Shah", source: "s2.csv", mobile: "713-555-0142", email: "r@example.com", address1: "12 Lotus Ln", zip: "77478" });
    const c = rec({ id: "c", name: "Rahul Shah", source: "s3.csv", dob: "1980-03-04", email: "r@example.com", address1: "12 Lotus Ln", zip: "77478" });
    const res = run([a, b, c]);
    const joined = res.clusters.map((x) => x.recordIds);
    expect(joined).toHaveLength(1);
    expect(joined[0]).toHaveLength(2);
    expect(res.pairs.filter((p) => p.signature === "linked_through_another_record")).toHaveLength(1);
  });
});

describe("the same gift in two sources", () => {
  const donor = { name: "Rahul Shah", email: "rahul@example.com" };
  it("same donor e-mail, amount and date: one gift, load it once", () => {
    const res = run([
      gift({ id: "g1", ...donor, amount: "$100.00", date: "2026-03-05" }),
      gift({ id: "g2", name: "Shah, Rahul", email: "RAHUL@example.com", source: "g2.csv", amount: "100", date: "2026-03-05" }),
    ]);
    const p = pairOf(res, "g1", "g2")!;
    expect(p.relation).toBe("same_gift");
    expect(p.tier).toBe("A");
    expect(res.giftDuplicates).toEqual([{ keep: "g1", skip: "g2" }]);
    expect(res.dispositions.find((d) => d.id === "g2")!.how).toBe("duplicate_gift");
  });
  it("a check number plus the amount and date is enough, even when the bank shows only a name", () => {
    const res = run([
      gift({ id: "b", name: "RAHUL SHAH", source: "bank.csv", amount: "250.00", date: "03/05/2026", ref: "Check #4512" }),
      gift({ id: "q", name: "Shah, Rahul", source: "qbo", sourceKind: "connector", email: "rahul@example.com", amount: "250", date: "2026-03-07", ref: "004512" }),
    ], { dateOrderBySource: { "bank.csv": "mdy" } });
    const p = pairOf(res, "b", "q")!;
    expect(labels(p)).toContain("same check or transaction number");
    expect(p.tier).toBe("A");
  });
  it("a different check number is a different gift", () => {
    const res = run([
      gift({ id: "b", name: "RAHUL SHAH", source: "bank.csv", amount: "250.00", date: "2026-03-05", ref: "4512" }),
      gift({ id: "q", name: "Shah, Rahul", source: "qbo", amount: "250", date: "2026-03-05", ref: "4513" }),
    ]);
    expect(pairOf(res, "b", "q")).toBeUndefined();
  });
  it("amounts that differ by cents are a money conflict: held, never decided by code", () => {
    const res = run([
      gift({ id: "b", name: "RAHUL SHAH", source: "bank.csv", amount: "100.00", date: "2026-03-05", ref: "4512" }),
      gift({ id: "q", name: "Shah, Rahul", source: "qbo", amount: "100.05", date: "2026-03-05", ref: "4512" }),
    ]);
    const p = pairOf(res, "b", "q")!;
    expect(p.tier).toBe("D");
    expect(p.hold).toBe("money_conflict");
    expect(p.signature).toBe("amount_differs_cents");
    expect(p.money).toEqual({ kind: "amount_differs_cents", aCents: 10000, bCents: 10005 });
    expect(p.affected.sort()).toEqual(["b", "q"]);
    expect(res.giftDuplicates).toEqual([]);
    expect(res.metrics.held).toBe(2);
  });
  it("the same check with a very different amount is also held", () => {
    const res = run([
      gift({ id: "b", name: "RAHUL SHAH", source: "bank.csv", amount: "100.00", date: "2026-03-05", ref: "4512" }),
      gift({ id: "q", name: "Shah, Rahul", source: "qbo", amount: "150.00", date: "2026-03-05", ref: "4512" }),
    ]);
    expect(pairOf(res, "b", "q")!.signature).toBe("amount_differs");
  });
  it("two days apart with one donor identifier and the same name is still the same gift", () => {
    const res = run([
      gift({ id: "g1", ...donor, amount: "100.00", date: "2026-03-05" }),
      gift({ id: "g2", name: "Shah, Rahul", email: "rahul@example.com", source: "g2.csv", amount: "100.00", date: "2026-03-07" }),
    ]);
    expect(pairOf(res, "g1", "g2")!.tier).toBe("A");
  });
  it("one donor identifier but a different first name (a spouse paying) is for review", () => {
    const res = run([
      gift({ id: "g1", ...donor, amount: "100.00", date: "2026-03-05" }),
      gift({ id: "g2", name: "Shah, Mira", email: "rahul@example.com", source: "g2.csv", amount: "100.00", date: "2026-03-05" }),
    ]);
    expect(pairOf(res, "g1", "g2")!.tier).toBe("B");
  });
  it("two gifts a week apart are two gifts", () => {
    const res = run([
      gift({ id: "g1", ...donor, amount: "100.00", date: "2026-03-05" }),
      gift({ id: "g2", name: "Shah, Rahul", email: "rahul@example.com", source: "g2.csv", amount: "100.00", date: "2026-03-12" }),
    ]);
    expect(pairOf(res, "g1", "g2")).toBeUndefined();
  });
  it("the same amount and date with only a name is a question", () => {
    const res = run([
      gift({ id: "b", name: "RAHUL SHAH", source: "bank.csv", amount: "100.00", date: "2026-03-05" }),
      gift({ id: "q", name: "Shah, Rahul", source: "qbo", amount: "100.00", date: "2026-03-05" }),
    ]);
    const p = pairOf(res, "b", "q")!;
    expect(p.tier).toBe("C");
    expect(p.signature).toBe("duplicate_gift_two_sources");
  });
  it("a date that could be read two ways is never trusted to match", () => {
    const res = run([
      gift({ id: "g1", ...donor, amount: "100.00", date: "03/04/2026" }),
      gift({ id: "g2", name: "Shah, Rahul", email: "rahul@example.com", source: "g2.csv", amount: "100.00", date: "2026-03-04" }),
    ]);
    expect(pairOf(res, "g1", "g2")!.tier).toBe("C");
  });
  it("gifts in the same source are never compared with each other", () => {
    const res = run([
      gift({ id: "g1", ...donor, amount: "100.00", date: "2026-03-05" }),
      gift({ id: "g2", ...donor, amount: "100.00", date: "2026-03-05" }),
    ]);
    expect(pairOf(res, "g1", "g2")).toBeUndefined();
  });
  it("a gift is linked to its donor through the donor's identifiers", () => {
    const res = run([
      rec({ id: "p", name: "Rahul Shah", mobile: "713-555-0142", email: "rahul@example.com", address1: "12 Lotus Ln", zip: "77478" }),
      gift({ id: "g", name: "Shah, Rahul", source: "qbo", mobile: "713-555-0142", email: "rahul@example.com", amount: "100.00", date: "2026-03-05" }),
    ]);
    expect(pairOf(res, "p", "g")!.tier).toBe("A");
  });
});

describe("the run itself", () => {
  const rows = () => [
    rec({ id: "a", name: "Mira Patel", mobile: "713-555-0142", email: "mira@example.com", address1: "12 Lotus Ln", zip: "77478" }),
    rec({ id: "b", name: "Miraben Patil", source: "b.csv", mobile: "713-555-0142", email: "MIRA@example.com" }),
    rec({ id: "c", name: "Nirav Doshi", source: "b.csv", mobile: "281-555-0188" }),
    rec({ id: "d", name: "Kiran Doshi", source: "c.csv", phone: "281-555-0188", address1: "90 Cedar Dr", zip: "77479" }),
  ];
  it("gives the same answer whatever order the rows arrive in", () => {
    const tiers = (rs: ReturnType<typeof rows>) =>
      Object.fromEntries(run(rs).pairs.map((p) => [`${[p.a, p.b].sort().join("~")}`, `${p.tier}:${p.relation}`]));
    const forward = tiers(rows());
    expect(tiers(rows().reverse())).toEqual(forward);
    expect(Object.keys(forward).length).toBeGreaterThan(0);
  });
  it("is plain JSON all the way down (it can be stored as it is)", () => {
    const res = run(rows());
    expect(JSON.parse(JSON.stringify(res))).toEqual(res);
  });
});
