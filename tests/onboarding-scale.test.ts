import { describe, expect, it } from "vitest";

import { existingToInputs, type ExistingHousehold } from "@/lib/onboarding/existing";
import { matchPayers, type PayerInput } from "@/lib/onboarding/match";

// A community of a few thousand households with common family names (the case that makes a name block huge), and a
// donation file of tens of thousands of rows. Matching them together must stay quick and stay correct.
const SURNAMES = ["Shah", "Patel", "Mehta", "Desai", "Jain", "Sanghvi", "Doshi", "Kapadia"];
const GIVEN = ["Amit", "Rahul", "Mira", "Palak", "Raj", "Anil", "Bina", "Kiran", "Nita", "Sunil", "Dipak", "Hema"];

function household(i: number): ExistingHousehold {
  const last = SURNAMES[i % SURNAMES.length]!;
  const a = GIVEN[i % GIVEN.length]!;
  const b = GIVEN[(i * 7 + 3) % GIVEN.length]!;
  return {
    id: `h${i}`,
    number: `OFS-H-${2000 + i}`,
    name: `${a} & ${b} ${last}`,
    address1: `${100 + i} Lotus Lane`,
    address2: null,
    city: null,
    zip: String(77000 + (i % 40)),
    people: [
      { name: `${a} ${last}`, email: `${a}.${last}.${i}@example.com`.toLowerCase(), phone: `+1281555${String(1000 + (i % 9000)).padStart(4, "0")}` },
      { name: `${b} ${last}`, email: null, phone: null },
    ],
    aliases: [],
  };
}

describe("matching at the size of a real community", () => {
  it("3,000 existing households and 12,000 uploaded rows match in seconds, and every donor of a known household finds it", () => {
    const existing = Array.from({ length: 3000 }, (_, i) => household(i));
    const uploaded: PayerInput[] = [];
    for (let k = 0; k < 12000; k++) {
      const i = (k * 13) % 4000; // 3,000 of these are households we have; the rest are new
      const h = household(i);
      uploaded.push({ rowNo: k + 2, name: `${h.people[0]!.name}`, phone: h.people[0]!.phone, email: null, address1: h.address1, zip: h.zip });
    }
    const t0 = Date.now();
    const r = matchPayers([...uploaded, ...existingToInputs(existing)]);
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(20_000);
    const inRecords = r.groups.filter((g) => g.existing);
    // Every donor whose household is in the records was linked to it (by phone and family name), not asked about.
    for (const g of inRecords.slice(0, 50)) expect(g.existing!.number).toMatch(/^OFS-H-\d+$/);
    const knownRows = uploaded.filter((_, k) => (k * 13) % 4000 < 3000).length;
    expect(inRecords.reduce((sum, g) => sum + g.rows.length, 0)).toBe(knownRows);
    // No group ever holds two households of the records.
    expect(new Set(inRecords.map((g) => g.existing!.householdId)).size).toBe(inRecords.length);
  });
});
