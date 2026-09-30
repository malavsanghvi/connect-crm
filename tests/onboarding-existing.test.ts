import { describe, expect, it } from "vitest";

import {
  buildHouseholdFile,
  buildPaymentFile,
  householdLegacyId,
  idPrefixOf,
  toPayerInputs,
  validateDonations,
  autoMapColumns,
  type ParsedDonation,
} from "@/lib/onboarding/donations";
import { assembleExisting, describeExisting, existingToInputs, parseAliases, EXISTING_ROW_BASE, type ExistingHousehold } from "@/lib/onboarding/existing";
import { applyDecisions, matchPayers, mergeWouldJoinExisting, resolveMerges, type PayerInput } from "@/lib/onboarding/match";
import { parseName } from "@/lib/onboarding/normalize";
import { buildPeopleFile, type ParsedPerson } from "@/lib/onboarding/people";
import { answersForQuestions } from "@/lib/onboarding/progress";

const row = (rowNo: number, name: string, extra: Partial<PayerInput> = {}): PayerInput => ({ rowNo, name, ...extra });

const household = (id: string, name: string, extra: Partial<ExistingHousehold> = {}): ExistingHousehold => ({
  id,
  number: `OFS-H-${id}`,
  name,
  address1: null,
  address2: null,
  city: null,
  zip: null,
  people: [],
  aliases: [],
  ...extra,
});

const sanghvi = household("2001", "Malav & Palak Sanghvi", {
  address1: "12 Lotus Lane",
  zip: "77478",
  people: [
    { name: "Malav Sanghvi", email: "malav@example.com", phone: "+12815550142" },
    { name: "Palak Sanghvi", email: null, phone: null },
  ],
  aliases: ["M K Sanghvi"],
});
const shah = household("2002", "Shah family", { address1: "9 Orchard Rd", zip: "77479", people: [{ name: "Raj Shah", email: "raj@example.com", phone: "+17135550110" }] });

const run = (uploaded: PayerInput[], existing: ExistingHousehold[]) => matchPayers([...uploaded, ...existingToInputs(existing)]);

describe("household names", () => {
  it("'family' and 'household' are not part of a name", () => {
    expect(parseName("Shah family")).toEqual({ surname: "shah", givens: [] });
    expect(parseName("Rahul & Mira Shah Household")).toEqual({ surname: "shah", givens: ["rahul", "mira"] });
  });
});

describe("matching uploaded rows against households already in the records", () => {
  it("links an uploaded donor to the existing household by phone and surname, without asking", () => {
    const r = run([row(2, "Sanghvi, Malav", { phone: "281-555-0142" })], [sanghvi, shah]);
    expect(r.questions).toHaveLength(0);
    const g = r.groups.find((x) => x.rows.includes(2))!;
    expect(g.existing).toEqual({ householdId: "2001", number: "OFS-H-2001", label: "Malav & Palak Sanghvi" });
    expect(g.displayName).toBe("Malav & Palak Sanghvi");
    // Only uploaded rows are listed in a group; the records' own rows are not.
    expect(g.rows).toEqual([2]);
    expect(g.rows.every((n) => n < EXISTING_ROW_BASE)).toBe(true);
  });

  it("links by a name the household has paid under (its payer-name aliases), with the address", () => {
    const r = run([row(2, "M K Sanghvi", { address1: "12 Lotus Ln", zip: "77478" })], [sanghvi]);
    expect(r.groups.find((x) => x.rows.includes(2))!.existing?.householdId).toBe("2001");
    expect(r.questions).toHaveLength(0);
  });

  it("leaves out the households of the records that nothing in the files points at", () => {
    const r = run([row(2, "Amit Patel", { phone: "713-555-0000" })], [sanghvi, shah]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]!.existing).toBeNull();
  });

  it("a name alone never links: a same-name row with nothing else to compare is asked, and stays new until answered", () => {
    const r = run([row(2, "Malav Sanghvi")], [sanghvi]);
    expect(r.questions).toHaveLength(1);
    const q = r.questions[0]!;
    const a = r.groups[q.a]!;
    const b = r.groups[q.b]!;
    expect([a, b].filter((g) => g.existing)).toHaveLength(1);
    expect(q.note).toMatch(/same name/);
    // Unanswered (or "keep separate"): the row is a new household.
    const separate = applyDecisions(r, new Set());
    expect(separate).toHaveLength(1);
    expect(separate[0]!.existing).toBeNull();
    // "Same household": it belongs to the existing one, and only the uploaded row is listed.
    const merged = applyDecisions(r, new Set([q.id]));
    expect(merged).toHaveLength(1);
    expect(merged[0]!.existing?.householdId).toBe("2001");
    expect(merged[0]!.rows).toEqual([2]);
  });

  it("a same-name row whose phone, email and address all differ is a different person: no question", () => {
    const r = run([row(2, "Malav Sanghvi", { phone: "713-555-9999", address1: "500 Elm St", zip: "77000" })], [sanghvi]);
    expect(r.questions).toHaveLength(0);
    expect(r.groups.find((g) => g.rows.includes(2))!.existing).toBeNull();
  });

  it("two households that both end in 'family' and share an address are not one household because of the word", () => {
    const a = household("3001", "Shah family", { address1: "1 Main St", zip: "77001" });
    const r = run([row(2, "Mehta family", { address1: "1 Main St", zip: "77001" })], [a]);
    // Same address, different family names: worth asking, never linked on its own.
    expect(r.questions).toHaveLength(1);
    expect(r.questions[0]!.note).toMatch(/different family name/);
    expect(applyDecisions(r, new Set())[0]!.existing).toBeNull();
  });

  it("never puts two existing households in one group, however the evidence reads", () => {
    const a = household("4001", "Shah family", { address1: "1 Main St", zip: "77001", people: [{ name: "Raj Shah", email: null, phone: "+17135550111" }] });
    const b = household("4002", "Shah family", { address1: "1 Main St", zip: "77001", people: [{ name: "Rani Shah", email: null, phone: "+17135550111" }] });
    const r = run([row(2, "Raj Shah", { phone: "713-555-0111", address1: "1 Main St", zip: "77001" })], [a, b]);
    const joined = r.groups.find((g) => g.rows.includes(2))!;
    expect(joined.existing).not.toBeNull();
    // The other one is said, not acted on.
    expect(joined.alsoMatches).toHaveLength(1);
    expect(joined.alsoMatches[0]!.householdId).not.toBe(joined.existing!.householdId);
    // And no question is ever asked between the two existing households.
    const ids = new Set(r.groups.filter((g) => g.existing).map((g) => g.existing!.householdId));
    for (const q of r.questions) {
      const both = [r.groups[q.a]!, r.groups[q.b]!].filter((g) => g.existing).map((g) => g.existing!.householdId);
      expect(new Set(both).size).toBeLessThanOrEqual(1);
      expect(both.every((h) => ids.has(h))).toBe(true);
    }
  });

  it("the stronger evidence decides which existing household a row joins (the choice never depends on file order)", () => {
    const weak = household("5001", "Shah family", { people: [{ name: "Rani Shah", email: null, phone: "+17135550111" }] });
    const strong = household("5002", "Shah family", { address1: "1 Main St", zip: "77001", people: [{ name: "Raj Shah", email: null, phone: "+17135550111" }] });
    const up = row(2, "Raj Shah", { phone: "713-555-0111", address1: "1 Main St", zip: "77001" });
    const one = run([up], [weak, strong]);
    const two = run([up], [strong, weak]);
    expect(one.groups.find((g) => g.rows.includes(2))!.existing?.householdId).toBe("5002");
    expect(two.groups.find((g) => g.rows.includes(2))!.existing?.householdId).toBe("5002");
  });

  it("an answer that would join two households already in the records is refused, and the screen can tell beforehand", () => {
    // One uploaded row shares a phone with household A and an email with household B (other family names): two questions.
    const a = household("6001", "Patel family", { people: [{ name: "Anil Patel", email: null, phone: "+17135550201" }] });
    const b = household("6002", "Desai family", { people: [{ name: "Bina Desai", email: "bina@example.com", phone: null }] });
    const r = run([row(2, "Chirag Shah", { phone: "713-555-0201", email: "bina@example.com" })], [a, b]);
    expect(r.questions).toHaveLength(2);
    const [q1, q2] = r.questions as [(typeof r.questions)[number], (typeof r.questions)[number]];
    expect(mergeWouldJoinExisting(r, new Set(), q1.id)).toBe(false);
    expect(mergeWouldJoinExisting(r, new Set([q1.id]), q2.id)).toBe(true);
    const both = resolveMerges(r, new Set([q1.id, q2.id]));
    expect(both.blocked.size).toBe(1);
    expect(both.groups).toHaveLength(1);
    expect(both.groups[0]!.existing).not.toBeNull();
    // Only the first answer was applied; the row belongs to exactly one household of the records.
    expect(both.groups[0]!.rows).toEqual([2]);
  });

  it("pairs inside one existing household are not counted as links the owner has to trust", () => {
    const r = run([], [sanghvi]);
    expect(r.autoLinks).toBe(0);
    expect(r.groups).toHaveLength(0);
  });

  it("with no existing households the result is what it always was", () => {
    const r = matchPayers([row(1, "Malav Sanghvi", { phone: "281-555-0142" }), row(2, "Palak Sheth", { phone: "2815550142" })]);
    expect(r.groups.map((g) => g.existing)).toEqual([null, null]);
    expect(r.groups.map((g) => g.alsoMatches)).toEqual([[], []]);
    expect(r.questions).toHaveLength(1);
  });
});

describe("question keys survive a reload", () => {
  it("the same question gets the same key when other households appear, so a saved answer still applies", () => {
    const up = [row(2, "Malav Sanghvi"), row(3, "Amit Patel", { phone: "713-555-0000" }), row(4, "Amit Shah", { phone: "713-555-0000" })];
    const before = run(up, [sanghvi]);
    const after = run(up, [shah, sanghvi, household("9999", "Desai family", { people: [{ name: "Bina Desai", email: null, phone: "+17135550202" }] })]);
    expect(before.questions.length).toBeGreaterThan(1);
    expect(new Set(before.questions.map((q) => q.key)).size).toBe(before.questions.length);
    expect(after.questions.map((q) => q.key).sort()).toEqual(before.questions.map((q) => q.key).sort());
    const saved = Object.fromEntries(before.questions.map((q, i) => [q.key, i % 2 === 0 ? "merge" : "separate"] as const));
    const restored = answersForQuestions(after.questions, saved);
    for (const q of after.questions) expect(restored[q.id]).toBe(saved[q.key]);
  });

  it("a saved answer about a question that no longer exists is ignored", () => {
    const r = run([row(2, "Malav Sanghvi")], [sanghvi]);
    expect(answersForQuestions(r.questions, { "r99~r100": "merge" })).toEqual({});
  });
});

describe("existing household rows for the matcher", () => {
  it("one row for the household, each person and each payer name, all tagged and at the household's address", () => {
    const rows = existingToInputs([sanghvi]);
    expect(rows.map((r) => r.name)).toEqual(["Malav & Palak Sanghvi", "Malav Sanghvi", "Palak Sanghvi", "M K Sanghvi"]);
    expect(rows.every((r) => r.existing?.householdId === "2001" && r.address1 === "12 Lotus Lane")).toBe(true);
    expect(new Set(rows.map((r) => r.rowNo)).size).toBe(rows.length);
    expect(Math.min(...rows.map((r) => r.rowNo))).toBeGreaterThanOrEqual(EXISTING_ROW_BASE);
  });

  it("payer names come from 'Also paid as': semicolons or lines, trimmed, without repeats", () => {
    expect(parseAliases("Sanghvi, Malav;  M K Sanghvi ;\nmalav sanghvi; m k  sanghvi")).toEqual(["Sanghvi, Malav", "M K Sanghvi", "malav sanghvi"]);
    expect(parseAliases(null)).toEqual([]);
    expect(parseAliases(42)).toEqual([]);
  });

  it("says which household it is with more than its name: Connect number, address and members", () => {
    expect(describeExisting({ number: "OFS-H-2001", city: "Sugar Land", address1: "12 Lotus Lane", people: sanghvi.people })).toBe("OFS-H-2001 · 12 Lotus Lane · members: Malav Sanghvi, Palak Sanghvi");
    expect(describeExisting({ number: "OFS-H-2009", city: null, address1: null, people: [] })).toBe("OFS-H-2009 · no members yet");
  });
});

describe("Create attaches to a household already in the records", () => {
  const headers = ["Donor", "Amount", "Date", "Phone"];
  const cells = [
    ["Sanghvi, Malav", "$1,001.00", "2024-09-02", "281-555-0142"],
    ["Amit Patel", "$51.00", "2024-10-03", "713-555-0000"],
  ];
  const v = validateDonations(headers, cells, autoMapColumns(headers, cells));
  const r = run([...toPayerInputs(v.rows)], [sanghvi]);
  const groups = applyDecisions(r, new Set());
  const prefix = idPrefixOf("7f3a2c00-1111-4222-8333-444455556666");

  it("creates only the new household, and names the existing one by its Connect number", () => {
    expect(prefix).toBe("ONB-7F3A2C");
    const h = buildHouseholdFile(groups, v.rows, v.rows, prefix);
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]![1]).toBe("Amit Patel");
    expect(h.rows[0]![0]).toBe("ONB-7F3A2C-H-00002");
    const p = buildPaymentFile(groups, v.rows, prefix);
    expect(p.rows).toHaveLength(2);
    expect(p.rows.map((x) => x[1]).sort()).toEqual(["OFS-H-2001", "ONB-7F3A2C-H-00002"]);
    expect(p.rows.find((x) => x[1] === "OFS-H-2001")![2]).toBe("1001.00");
    // The payment's own ID belongs to this onboarding, so a second onboarding cannot collide with it.
    expect(p.rows.every((x) => x[0].startsWith("ONB-7F3A2C-P-"))).toBe(true);
    expect(householdLegacyId(groups.find((g) => g.existing)!, prefix)).toBe("OFS-H-2001");
  });

  it("a household made of only existing ones and nothing new creates no households at all", () => {
    const only = applyDecisions(run([toPayerInputs(v.rows)[0]!], [sanghvi]), new Set());
    expect(buildHouseholdFile(only, v.rows, v.rows, prefix).rows).toHaveLength(0);
  });

  it("people of an existing household are not marked primary, and only a clear relationship is sent", () => {
    const person = (rowNo: number, first: string, last: string, relationship: ParsedPerson["relationship"], extra: Partial<ParsedPerson> = {}): ParsedPerson => ({
      rowNo,
      firstName: first,
      lastName: last,
      relationship,
      familyId: null,
      memberId: null,
      email: null,
      phone: null,
      dob: null,
      gender: null,
      language: null,
      address1: null,
      address2: null,
      city: null,
      state: null,
      zip: null,
      membership: null,
      extras: {},
      ...extra,
    });
    const people = [person(1000002, "Malav", "Sanghvi", "primary", { phone: "+12815550142" }), person(1000003, "Arav", "Sanghvi", "child", { phone: "+12815550142" }), person(1000004, "Kaka", "Sanghvi", "other", { phone: "+12815550142" })];
    const g = applyDecisions(matchPayers([...people.map((p) => ({ rowNo: p.rowNo, name: `${p.firstName} ${p.lastName}`, phone: p.phone })), ...existingToInputs([sanghvi])]), new Set());
    expect(g).toHaveLength(1);
    expect(g[0]!.existing?.number).toBe("OFS-H-2001");
    const f = buildPeopleFile(g, people, (x) => householdLegacyId(x, prefix), prefix);
    expect(f.rows.map((x) => x[1])).toEqual(["OFS-H-2001", "OFS-H-2001", "OFS-H-2001"]);
    expect(f.rows.map((x) => x[2])).toEqual(["", "child", ""]);
    expect(f.rows.map((x) => x[3])).toEqual(["", "", ""]);
    expect(f.rows.map((x) => x[0])).toEqual(["ONB-7F3A2C-M-000001", "ONB-7F3A2C-M-000002", "ONB-7F3A2C-M-000003"]);
  });

  it("people of a new household keep one primary contact, as before", () => {
    const p: ParsedPerson = {
      rowNo: 1000002,
      firstName: "Dev",
      lastName: "Jain",
      relationship: null,
      familyId: null,
      memberId: "0417",
      email: null,
      phone: null,
      dob: null,
      gender: null,
      language: null,
      address1: null,
      address2: null,
      city: null,
      state: null,
      zip: null,
      membership: null,
      extras: {},
    };
    const g = applyDecisions(matchPayers([{ rowNo: p.rowNo, name: "Dev Jain" }]), new Set());
    const f = buildPeopleFile(g, [p], (x) => householdLegacyId(x, prefix), prefix);
    expect(f.rows[0]![2]).toBe("primary");
    expect(f.rows[0]![3]).toBe("Yes");
    // A member ID the file supplies stays as issued (and stays the same in a file sent again).
    expect(f.rows[0]![0]).toBe("ONB-M-0417");
  });
});

describe("generated IDs of one onboarding never collide with another's", () => {
  it("the prefix comes from the draft's own id", () => {
    expect(idPrefixOf("7f3a2c00-1111-4222-8333-444455556666")).toBe("ONB-7F3A2C");
    expect(idPrefixOf("00000000-0000-4000-8000-000000000000")).toBe("ONB-000000");
    expect(idPrefixOf("not a uuid")).toBe("ONB-000000");
    expect(idPrefixOf("a1b2c3d4-0000-4000-8000-000000000000")).not.toBe(idPrefixOf("b1b2c3d4-0000-4000-8000-000000000000"));
  });
});

// Keeps the payments' file honest about the receipt case.
describe("payment IDs", () => {
  it("a receipt number makes a payment's ID the same in a file sent again", () => {
    const d: ParsedDonation = {
      rowNo: 2,
      name: "Malav Sanghvi",
      email: null,
      phone: null,
      address1: null,
      address2: null,
      city: null,
      state: null,
      zip: null,
      amountCents: 100,
      receivedOn: "2024-01-01",
      method: "check",
      receipt: "10331",
      memo: null,
      extras: {},
    };
    const g = applyDecisions(matchPayers(toPayerInputs([d])), new Set());
    expect(buildPaymentFile(g, [d], "ONB-AAAAAA").rows[0]![0]).toBe("ONB-R-10331");
    expect(buildPaymentFile(g, [d], "ONB-BBBBBB").rows[0]![0]).toBe("ONB-R-10331");
  });
});

describe("reading the records into households for the matcher", () => {
  const hh = (id: string, name: string, number: string | null, extra: Record<string, unknown> = {}) => ({
    id,
    display_name: name,
    household_number: number,
    address_line1: "12 Lotus Lane",
    address_line2: null,
    city: "Sugar Land",
    postal_code: "77478",
    ...extra,
  });
  const person = (id: string, first: string, last: string, extra: Record<string, unknown> = {}) => ({ id, first_name: first, last_name: last, preferred_name: null, email: null, phone_e164: null, ...extra });

  it("puts each current member, with email and mobile, in their household", () => {
    const r = assembleExisting({
      households: [hh("h1", "Sanghvi family", "OFS-H-2001"), hh("h2", "Shah family", "OFS-H-2002")],
      members: [
        { household_id: "h1", person_id: "p1" },
        { household_id: "h1", person_id: "p2" },
        { household_id: "h2", person_id: "p3" },
        { household_id: "h2", person_id: "gone" }, // a member whose record is not readable is left out, not guessed
      ],
      people: [person("p1", "Malav", "Sanghvi", { email: "malav@example.com", phone_e164: "+12815550142" }), person("p2", "Palak", "Sanghvi"), person("p3", "Raj", "Shah", { email: "" })],
      payerNames: [],
      staffValues: [],
      aliasKey: null,
    });
    expect(r.withoutNumber).toBe(0);
    expect(r.households[0]!.people).toEqual([
      { name: "Malav Sanghvi", email: "malav@example.com", phone: "+12815550142" },
      { name: "Palak Sanghvi", email: null, phone: null },
    ]);
    expect(r.households[1]!.people).toEqual([{ name: "Raj Shah", email: null, phone: null }]);
    expect(r.households[0]).toMatchObject({ id: "h1", number: "OFS-H-2001", name: "Sanghvi family", address1: "12 Lotus Lane", city: "Sugar Land", zip: "77478" });
  });

  it("what a person likes to be called is another name they may pay under", () => {
    const r = assembleExisting({
      households: [hh("h1", "Shah family", "OFS-H-2002")],
      members: [{ household_id: "h1", person_id: "p1" }, { household_id: "h1", person_id: "p2" }],
      people: [person("p1", "Michael", "Shah", { preferred_name: "Mike" }), person("p2", "Rani", "Shah", { preferred_name: "rani" })],
      payerNames: [],
      staffValues: [],
      aliasKey: null,
    });
    expect(r.households[0]!.people.map((p) => p.name)).toEqual(["Michael Shah", "Mike Shah", "Rani Shah"]);
  });

  it("payer names come from the bank payer names learned for the household and from 'Also paid as', wherever it is kept", () => {
    const r = assembleExisting({
      households: [hh("h1", "Sanghvi family", "OFS-H-2001", { custom: { also_paid_as: "K M Sanghvi; Malav S" } }), hh("h2", "Shah family", "OFS-H-2002"), hh("h3", "Desai family", "OFS-H-2003")],
      members: [],
      people: [],
      payerNames: [
        { household_id: "h1", value: "SANGHVI MALAV" },
        { household_id: "h1", value: "k m sanghvi" }, // the same name as the custom value, in another case: once
        { household_id: null, value: "NOBODY" },
      ],
      staffValues: [
        { record_key: "h2", custom: { also_paid_as: "R Shah\nRaj Shah", other_field: "x" } },
        { record_key: "h3", custom: { other_field: "x" } },
      ],
      aliasKey: "also_paid_as",
    });
    expect(r.households[0]!.aliases).toEqual(["SANGHVI MALAV", "k m sanghvi", "Malav S"]);
    expect(r.households[1]!.aliases).toEqual(["R Shah", "Raj Shah"]);
    expect(r.households[2]!.aliases).toEqual([]);
  });

  it("without an 'Also paid as' field, nothing is read from custom values", () => {
    const r = assembleExisting({
      households: [hh("h1", "Sanghvi family", "OFS-H-2001", { custom: { also_paid_as: "K M Sanghvi" } })],
      members: [],
      people: [],
      payerNames: [],
      staffValues: [{ record_key: "h1", custom: { also_paid_as: "X" } }],
      aliasKey: null,
    });
    expect(r.households[0]!.aliases).toEqual([]);
  });

  it("a household with no Connect number cannot be named to the import tool: counted and left out", () => {
    const r = assembleExisting({ households: [hh("h1", "A", null), hh("h2", "B", "OFS-H-2002"), hh("h3", "C", "")], members: [], people: [], payerNames: [], staffValues: [], aliasKey: null });
    expect(r.households.map((h) => h.id)).toEqual(["h2"]);
    expect(r.withoutNumber).toBe(2);
  });

  it("what it builds is what the matcher takes: a payer-name alias links a donor with the address", () => {
    const { households } = assembleExisting({
      households: [hh("h1", "Malav & Palak Sanghvi", "OFS-H-2001", { custom: { also_paid_as: "M K Sanghvi" } })],
      members: [],
      people: [],
      payerNames: [],
      staffValues: [],
      aliasKey: "also_paid_as",
    });
    const r = matchPayers([{ rowNo: 2, name: "M K Sanghvi", address1: "12 Lotus Ln", zip: "77478" }, ...existingToInputs(households)]);
    expect(r.groups[0]!.existing?.number).toBe("OFS-H-2001");
  });
});
