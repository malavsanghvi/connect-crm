import { describe, expect, it } from "vitest";

import { classifyInput } from "@/lib/find/classify";
import { familyOfAdult, scoreFamily, scorePerson } from "@/lib/find/match";
import { FIND_LIMIT, rankMatches } from "@/lib/find/rank";
import type { FamilyCandidate, PersonCandidate, Scored } from "@/lib/find/types";

import { FAMILIES, PEOPLE, RULES, family, person } from "./fixtures";

function run(typed: string, people: PersonCandidate[], families: FamilyCandidate[]) {
  const q = classifyInput(typed);
  const byId = new Map(families.map((f) => [f.id, f]));
  const sp = people.flatMap((p) => scorePerson(q, p, RULES) ?? []);
  const sf: Scored<FamilyCandidate>[] = families.flatMap((f) => scoreFamily(q, f, RULES) ?? []);
  for (const p of sp) {
    const f = p.item.householdId ? byId.get(p.item.householdId) : undefined;
    const derived = f ? familyOfAdult(p, f) : null;
    if (derived) sf.push(derived);
  }
  return rankMatches(sp, sf);
}

const label = (i: ReturnType<typeof rankMatches>["items"][number]) => (i.kind === "family" ? `F:${i.scored.item.id}` : `P:${i.scored.item.id}`);

describe("rankMatches", () => {
  it("puts the best match first, then the families, then the people", () => {
    const { items } = run("sam", [PEOPLE.sam, PEOPLE.samira, PEOPLE.layla], [FAMILIES.nakamura, FAMILIES.hassan]);
    // Sam Nakamura is an exact word (the best); his family follows through him; Samira by the start of her name.
    expect(items[0]).toMatchObject({ kind: "person" });
    expect(label(items[0])).toBe("P:p-sam");
    const kinds = items.slice(1).map((i) => i.kind);
    expect(kinds).toEqual([...kinds].sort((a, b) => (a === b ? 0 : a === "family" ? -1 : 1)));
  });

  it("an exact identifier beats every name", () => {
    const lopez = family({ id: "h-lopez", displayName: "Lopez household", hits: [{ kind: "crm", system: "neon", value: "20417" }] });
    const { items } = run("20417", [PEOPLE.ana], [lopez]);
    expect(label(items[0])).toBe("F:h-lopez");
  });

  it("shows a family found twice once, with its best reason", () => {
    const { items } = run("hassan", [PEOPLE.samira], [FAMILIES.hassan]);
    const families = items.filter((i) => i.kind === "family");
    expect(families).toHaveLength(1);
    expect(families[0].scored.why.code).toBe("name");
  });

  it("on a tie a family comes before a person and an adult before a child", () => {
    const { items } = run("hassan", [PEOPLE.layla, PEOPLE.samira], [FAMILIES.hassan]);
    expect(label(items[0])).toBe("F:h-hassan");
    const people = items.filter((i) => i.kind === "person").map(label);
    expect(people).toEqual(["P:p-samira", "P:p-layla"]);
  });

  it("keeps ten rows and says how many more matched", () => {
    const many = Array.from({ length: 14 }, (_, n) => person({ id: `p${n}`, firstName: "Sam", lastName: `Family${String(n).padStart(2, "0")}`, householdId: null }));
    const { items, more } = run("sam", many, []);
    expect(items).toHaveLength(FIND_LIMIT);
    expect(more).toBe(4);
  });

  it("is stable: the same input gives the same order", () => {
    const again = () => run("sam", [PEOPLE.sam, PEOPLE.samira], [FAMILIES.nakamura, FAMILIES.hassan]).items.map(label);
    expect(again()).toEqual(again());
  });

  it("returns nothing for nothing", () => {
    expect(run("zzz", [PEOPLE.samira], [FAMILIES.hassan])).toEqual({ items: [], more: 0 });
  });
});
