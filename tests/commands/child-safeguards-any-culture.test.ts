import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { ageOfMajority, birthCutoff } from "@/lib/age-of-majority";
import { peopleSearch } from "@/lib/commands/catalog/people-search";
import { childGuard, guardText } from "@/lib/commands/catalog/messages/shared";
import { WITHHELD_FOR_CHILD } from "@/lib/commands/catalog/messages/pure";
import {
  CHILD_NAME_REPLACEMENT as M,
  communityMajority,
  databaseMinorNames,
  filterChildren,
  isAdultMember,
  leakedMinorNames,
  type MinorNameEntry,
} from "@/lib/commands/child-filter";
import { defineCommand } from "@/lib/commands/define";
import { CommandRegistry } from "@/lib/commands/registry";
import { runCommand } from "@/lib/commands/run";
import { f, object } from "@/lib/commands/schema";
import type { CommandContext } from "@/lib/commands/types";

import { INTERNATIONAL, communityWithChildren, fakeDb, fakeSession, testContext, withInternationalChildren, type FakeDbOptions } from "./helpers";

// Decision D2 in any culture: nothing about anyone under 18 reaches an AI provider, whatever the child's name looks like, whatever
// script it is written in, and whatever age the community's country sets for being an adult (18 at the least).

const TODAY = "2026-10-10";
const CENTER = "center-1";
// Not a faith community: nothing here depends on one (the default test center is a Jain society).
const CLUB = { slug: "lakeside-club", name: "Lakeside Neighbors Club", short_name: "Lakeside" };
const clubSession = (over: Record<string, unknown> = {}) => fakeSession({ ...over, center: { ...fakeSession().center, ...CLUB, ...((over.center as object) ?? {}) } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T15:00:00Z`));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// The age of majority
// ---------------------------------------------------------------------------
describe("the age of majority", () => {
  it("is 18 unless the community's place says more, and never less than 18", () => {
    expect(ageOfMajority()).toBe(18);
    expect(ageOfMajority(null)).toBe(18);
    expect(ageOfMajority({ country: "US" })).toBe(18);
    expect(ageOfMajority({ country: "IN" })).toBe(18);
    expect(ageOfMajority({ country: "ZZ" })).toBe(18);
    expect(ageOfMajority({ country: "" })).toBe(18);
    expect(ageOfMajority({ country: "SG" })).toBe(21);
    expect(ageOfMajority({ country: "singapore" })).toBe(21);
    expect(ageOfMajority({ country: "South Korea" })).toBe(19);
    expect(ageOfMajority({ country: "US", state_region: "AL" })).toBe(19);
    expect(ageOfMajority({ country: "US", state_region: "Mississippi" })).toBe(21);
    expect(ageOfMajority({ country: "CA", state_region: "BC" })).toBe(19);
    expect(ageOfMajority({ country: "CA", state_region: "ON" })).toBe(18);
    expect(ageOfMajority({ country: "US", state_region: "IL" })).toBe(18);
  });
  it("honours an age the community records itself, between 18 and 25", () => {
    expect(ageOfMajority({ country: "US", rules: { age_of_majority: 21 } })).toBe(21);
    expect(ageOfMajority({ country: "SG", rules: { age_of_majority: 19 } })).toBe(21); // the larger of the two
    for (const bad of [16, 17, 0, -3, 40, 18.5, "21", null]) expect(ageOfMajority({ country: "US", rules: { age_of_majority: bad } }), String(bad)).toBe(18);
    expect(ageOfMajority({ rules: [] })).toBe(18);
  });
  it("turns an age into the latest birth date of an adult, a day never early", () => {
    expect(birthCutoff("2026-10-10", 18)).toBe("2008-10-10");
    expect(birthCutoff("2026-10-10", 21)).toBe("2005-10-10");
    expect(birthCutoff("2026-10-10", 16)).toBe("2008-10-10"); // never lower than 18
    expect(birthCutoff("2028-02-29", 18)).toBe("2010-02-28"); // someone born 1 March 2010 is still 17
    expect(birthCutoff("2026-03-01", 18)).toBe("2008-03-01");
  });
  it("decides adults and minors by it, with 18 as the floor", () => {
    expect(isAdultMember({ date_of_birth: "2007-05-05" }, TODAY)).toBe(true); // 19
    expect(isAdultMember({ date_of_birth: "2007-05-05" }, TODAY, 21)).toBe(false);
    expect(isAdultMember({ date_of_birth: "2007-05-05" }, TODAY, 12)).toBe(true); // 12 is raised to 18
    expect(isAdultMember({ date_of_birth: "2010-05-05" }, TODAY, 12)).toBe(false);
    expect(isAdultMember({ date_of_birth: null, role: "parent" }, TODAY, 21)).toBe(true);
    expect(communityMajority({ country: "SG" })).toBe(21);
  });
  it("removes a record by age or birth date at the community's age, not 18", () => {
    const people = [{ name: "Li Hua", age: 19 }, { name: "Mei Wong", date_of_birth: "2007-05-05" }, { name: "Dev Rao", age: 40 }];
    expect((filterChildren({ people }, { today: TODAY }).value.people as { name: string }[]).map((p) => p.name)).toEqual(["Li Hua", "Mei Wong", "Dev Rao"]);
    expect((filterChildren({ people }, { today: TODAY, majority: 21 }).value.people as { name: string }[]).map((p) => p.name)).toEqual(["Dev Rao"]);
    expect((filterChildren({ people }, { today: TODAY, majority: 5 }).value.people as { name: string }[]).map((p) => p.name)).toEqual(["Li Hua", "Mei Wong", "Dev Rao"]);
  });
});

// ---------------------------------------------------------------------------
// The community's minors, from the database
// ---------------------------------------------------------------------------
type Person = { first: string; last: string; dob: string | null; role: "primary" | "spouse" | "parent" | "child" };
type Family = { id: string; people: Person[] };

function worldOf(families: Family[]): FakeDbOptions {
  const people: Record<string, unknown>[] = [];
  const members: Record<string, unknown>[] = [];
  families.forEach((fam) =>
    fam.people.forEach((p, i) => {
      const id = `${fam.id}-${i}`;
      people.push({ id, center_id: CENTER, first_name: p.first, last_name: p.last, preferred_name: null, date_of_birth: p.dob, merged_into_id: null });
      members.push({ household_id: fam.id, person_id: id, center_id: CENTER, role: p.role, is_primary: i === 0, left_at: null });
    }),
  );
  return { tables: { people, household_members: members } };
}

const sessionFor = (world: FakeDbOptions, center: Record<string, unknown> = {}) => clubSession({ db: fakeDb(world), center });

describe("the community's minors, from the database", () => {
  const family = (id: string, ...people: Person[]): Family => ({ id, people });
  const adult = (first: string, last: string): Person => ({ first, last, dob: "1980-01-01", role: "primary" });
  const child = (first: string, last: string, dob: string | null = "2016-03-03"): Person => ({ first, last, dob, role: "child" });

  it("gives each child in parts, and a family name the household's adults share names the family, not the child", async () => {
    const world = worldOf([
      family("w", adult("Jun", "Wang"), adult("Li", "Wang"), child("Wei", "Wang")),
      family("ff", adult("Wang", "Jun"), child("Wang", "Wei")),
      family("cjk", adult("建国", "王"), child("伟", "王", "2017-04-04")),
      family("g", adult("Ana", "García López"), child("María José", "García López", "2014-02-02")),
      family("b", adult("Hassan", "bin Ali"), child("Ahmad", "bin Ali", "2013-05-05")),
      family("s", adult("Megawati", ""), child("Sukarno", "", "2015-06-06")),
      family("n", adult("Minh", "Nguyễn"), child("Văn An", "Nguyễn", null)),
    ]);
    const entries = await databaseMinorNames.namesOfMinors(sessionFor(world));
    expect(entries).toEqual(
      expect.arrayContaining([
        { full: ["Wei Wang"], words: ["Wei"] },
        { full: ["Wang Wei"], words: ["Wang", "wei"] }, // nothing in this household shares "Wei": it counts on its own
        { full: ["伟 王"], words: ["伟"] },
        { full: ["María José García López"], words: ["María José"] },
        { full: ["Ahmad bin Ali"], words: ["Ahmad"] },
        { full: ["Sukarno"], words: ["Sukarno"] },
        { full: ["Văn An Nguyễn"], words: ["Văn An"] },
      ]),
    );
    expect(entries).toHaveLength(7);
    // No adult is in it.
    expect(JSON.stringify(entries)).not.toMatch(/Jun Wang|Li Wang|Hassan|Megawati|Minh|Ana García|建国/);
  });

  it("removes the child from a sentence and leaves the adults of the same family whole", async () => {
    const world = worldOf([family("w", adult("Jun", "Wang"), adult("Li", "Wang"), child("Wei", "Wang"))]);
    const entries = await databaseMinorNames.namesOfMinors(sessionFor(world));
    expect(filterChildren("Jun Wang, Li Wang and Wei Wang came; Wang Wei too", { minorNames: entries, today: TODAY }).value).toBe(`Jun Wang, Li Wang and ${M} came; ${M} too`);
  });

  it("counts the 19-year-old of a community that sets 21 as a minor, and in a place that sets 18 as an adult", async () => {
    const world = worldOf([family("t", adult("Mei", "Lim"), child("Hua", "Lim", "2007-05-05"), child("Jia", "Lim", "2016-01-01"))]);
    const us = await databaseMinorNames.namesOfMinors(sessionFor(world, { country: "US", state_region: "IL" }));
    expect(us.map((e) => (e as { full: string[] }).full[0])).toEqual(["Jia Lim"]);
    const sg = await databaseMinorNames.namesOfMinors(sessionFor(world, { country: "SG" }));
    expect(sg.map((e) => (e as { full: string[] }).full[0]).sort()).toEqual(["Hua Lim", "Jia Lim"]);
    const own = await databaseMinorNames.namesOfMinors(sessionFor(world, { country: "US", rules: { age_of_majority: 21 } }));
    expect(own).toHaveLength(2);
  });

  it("counts a person with no birth date who is listed as a child, and an adult son or daughter is not one", async () => {
    const world = worldOf([family("h", adult("Priya", "Shah"), child("Zoya", "Shah", null), { first: "Nina", last: "Shah", dob: "1990-02-02", role: "child" })]);
    const entries = await databaseMinorNames.namesOfMinors(sessionFor(world));
    expect(entries).toEqual([{ full: ["Zoya Shah"], words: ["Zoya"] }]);
  });

  it("keeps a nickname and gives a family word nobody shares on its own", async () => {
    const world = worldOf([family("h", adult("Priya", "Shah"), child("Zoya", "Mehta"))]);
    world.tables!.people.find((p) => p.first_name === "Zoya")!.preferred_name = "Zo";
    const [entry] = await databaseMinorNames.namesOfMinors(sessionFor(world));
    expect(entry).toEqual({ full: ["Zoya Mehta", "Zo Mehta"], words: ["Zoya", "Zo", "mehta"] });
  });

  it("fails rather than guess when it cannot read the people or their households", async () => {
    const base = worldOf([family("h", adult("Priya", "Shah"), child("Zoya", "Shah"))]);
    for (const table of ["people", "household_members"]) {
      await expect(databaseMinorNames.namesOfMinors(sessionFor({ ...base, failTables: { [table]: { message: "boom" } } })), table).rejects.toThrow(/could not read/);
    }
  });
});

// ---------------------------------------------------------------------------
// What Niva is given: every written form of every kind of name
// ---------------------------------------------------------------------------
type Scenario = {
  name: string;
  family: Family;
  /** Texts that name the child: each must come out with the name replaced. */
  hide: string[];
  /** Words that must be gone from every one of those. */
  gone: string[];
  /** Texts about the adults: each must come out exactly as it went in. */
  keep: string[];
};

const adult = (first: string, last: string): Person => ({ first, last, dob: "1980-01-01", role: "primary" });
const kid = (first: string, last: string, dob: string | null = "2016-03-03"): Person => ({ first, last, dob, role: "child" });

const SCENARIOS: Scenario[] = [
  {
    name: "Wei Wang (family name last, shared with the parents)",
    family: { id: "a", people: [adult("Jun", "Wang"), adult("Li", "Wang"), kid("Wei", "Wang")] },
    gone: ["wei"],
    hide: ["Wei Wang", "Wang Wei", "WEI WANG", "wei", "Wei's class", "Wei, Wang", "Pickup for Wang-Wei at 5"],
    keep: ["Jun Wang", "Li Wang", "the Wang family"],
  },
  {
    name: "Wang Wei (family name first, nothing shared)",
    family: { id: "b", people: [adult("Zhang", "Jun"), kid("Wang", "Wei")] },
    gone: ["wei", "wang"],
    hide: ["Wang Wei", "Wei Wang", "wei", "Wang", "WANG WEI's class"],
    keep: ["Zhang Jun", "Jun"],
  },
  {
    name: "王伟 (no spaces)",
    family: { id: "c", people: [adult("建国", "王"), kid("伟", "王", "2017-04-04")] },
    gone: ["伟"],
    hide: ["王伟", "王伟的作业", "老师说王伟迟到了", "伟王", "王 伟", "王·伟"],
    keep: ["王建国", "王老师", "伟大"],
  },
  {
    name: "김민준 (Korean, with a particle stuck on)",
    family: { id: "k", people: [adult("지훈", "김"), kid("민준", "김", "2015-02-02")] },
    gone: ["민준"],
    hide: ["김민준은 학교에 갔다", "민준김", "김 민준"],
    keep: ["김지훈은 학교에 갔다"],
  },
  {
    name: "María José García López (two given names, two family names)",
    family: { id: "d", people: [adult("Ana", "García López"), kid("María José", "García López", "2014-02-02")] },
    gone: ["maría", "maria", "josé", "jose"],
    hide: ["María José García López", "Maria Jose Garcia Lopez", "LÓPEZ GARCÍA, MARÍA JOSÉ", "José", "maría", "García López, María José"],
    keep: ["Ana García López", "García López"],
  },
  {
    name: "Ahmad bin Ali (a particle)",
    family: { id: "e", people: [adult("Hassan", "bin Ali"), kid("Ahmad", "bin Ali", "2013-05-05")] },
    gone: ["ahmad"],
    hide: ["Ahmad bin Ali", "Ahmad Ali", "Ali bin Ahmad", "ahmad", "Ahmad's turn"],
    keep: ["Hassan bin Ali", "Ali", "put it in the bin"],
  },
  {
    name: "Nguyễn Văn An (marks, a middle name, no birth date on file)",
    family: { id: "f", people: [adult("Minh", "Nguyễn"), kid("Văn An", "Nguyễn", null)] },
    gone: ["nguyen", "nguyễn", "văn"],
    hide: ["Nguyễn Văn An", "Nguyen Van An", "NGUYỄN VĂN AN", "An Nguyen", "Văn An"],
    keep: ["Minh Nguyễn"],
  },
  {
    name: "Aarav (a single name, in Latin and Gujarati)",
    family: { id: "g", people: [adult("Nikhil", "Shah"), kid("Aarav", ""), kid("આરવ", "")] },
    gone: ["aarav", "આરવ"],
    hide: ["Aarav", "AARAV's pledge", "ask aarav, please", "આરવની ટીમ", "આરવ"],
    keep: ["Nikhil Shah", "Aaravind"],
  },
  {
    name: "Sukarno (a mononym)",
    family: { id: "h", people: [adult("Megawati", ""), kid("Sukarno", "", "2015-06-06")] },
    gone: ["sukarno"],
    hide: ["Sukarno", "sukarno's"],
    keep: ["Megawati"],
  },
  {
    name: "Зоя Иванова (Cyrillic, in another case)",
    family: { id: "r", people: [adult("Ольга", "Иванова"), kid("Зоя", "Иванова", "2015-02-02")] },
    gone: ["зо"],
    hide: ["Зоя Иванова", "Зою видели в классе", "Иванова Зоя"],
    keep: ["Ольга Иванова"],
  },
  {
    name: "Rahul Patel (the same name as his father)",
    family: { id: "j", people: [adult("Rahul", "Patel"), adult("Priya", "Patel"), kid("Rahul", "Patel", "2016-01-01")] },
    // The documented trade-off: a word a child and an adult share is removed for the adult too; the rest of the family stays.
    gone: ["rahul"],
    hide: ["Rahul Patel", "Rahul", "rahul patel's"],
    keep: ["Priya Patel", "the Patel family"],
  },
];

/** A read command that hands back whatever it is given (as JSON), the way a command that lists people does. */
function echoRegistry(): CommandRegistry {
  const echo = defineCommand<{ payload: string }, unknown>({
    key: "events.look",
    title: "Look at events",
    description: "Look at events.",
    level: "read",
    permission: "events",
    module: "events",
    input: object({ payload: f.string("What to hand back, as JSON.", { max: 20000 }) }),
    async execute(_ctx, input) {
      return { ok: true, data: JSON.parse(input.payload) };
    },
  });
  const r = new CommandRegistry();
  r.register(echo);
  return r;
}

function assistantContext(world: FakeDbOptions, center: Record<string, unknown> = {}): CommandContext {
  const ctx = testContext({ session: clubSession({ db: fakeDb(world), permissions: ["events.view"], center }), registry: echoRegistry(), via: "assistant" });
  ctx.minors = databaseMinorNames; // the real source, reading the same community
  return ctx;
}

async function modelSees(world: FakeDbOptions, texts: string[], center: Record<string, unknown> = {}) {
  return runCommand(assistantContext(world, center), "events.look", { payload: JSON.stringify({ texts }) });
}

describe("a result that names people reaches the model without any child, whatever the name looks like", () => {
  for (const s of SCENARIOS) {
    it(s.name, async () => {
      const texts = [...s.hide, ...s.keep].map((t) => `Note: ${t}.`);
      const r = await modelSees(worldOf([s.family]), texts);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      const out = (r as { data: { texts: string[] } }).data.texts;
      s.hide.forEach((t, i) => {
        expect(out[i], `${t} -> ${out[i]}`).toContain(M);
        for (const word of s.gone) expect(out[i].toLowerCase(), `${t} -> ${out[i]}`).not.toContain(word);
      });
      s.keep.forEach((t, i) => expect(out[s.hide.length + i], `${t} was changed`).toBe(`Note: ${t}.`));
    });
  }

  it("also withholds a result that carries a child's name as a key, in any script", async () => {
    for (const s of [SCENARIOS[2], SCENARIOS[4], SCENARIOS[7]]) {
      const key = s.hide[0];
      const r = await runCommand(assistantContext(worldOf([s.family])), "events.look", { payload: JSON.stringify({ [key]: 1 }) });
      expect(r, key).toMatchObject({ ok: false });
      expect(JSON.stringify(r)).not.toContain(key);
    }
  });

  it("holds for the 19-year-old of a community whose country sets 21", async () => {
    const world = worldOf([{ id: "t", people: [adult("Mei", "Lim"), { first: "Hua", last: "Lim", dob: "2007-05-05", role: "child" }] }]);
    const sg = await modelSees(world, ["Hua Lim came", "Mei Lim came"], { country: "SG" });
    expect((sg as { data: { texts: string[] } }).data.texts).toEqual([`${M} came`, "Mei Lim came"]);
    const us = await modelSees(world, ["Hua Lim came", "Mei Lim came"], { country: "US" });
    expect((us as { data: { texts: string[] } }).data.texts).toEqual(["Hua Lim came", "Mei Lim came"]);
  });
});

describe("the second look at a finished result", () => {
  it("names the children still readable, in any order and any script", () => {
    const entries: MinorNameEntry[] = INTERNATIONAL.entries();
    expect(leakedMinorNames({ a: "all clear" }, entries)).toEqual([]);
    expect(leakedMinorNames({ a: ["Wei Wang"] }, entries)).toEqual(["Wang Wei"]);
    expect(leakedMinorNames({ a: "王伟" }, entries)).toEqual(["伟 王"]);
    expect(leakedMinorNames({ "Sukarno": 1 }, entries)).toEqual(["Sukarno"]);
  });
});

// ---------------------------------------------------------------------------
// The people commands, with children of every culture in the community
// ---------------------------------------------------------------------------
describe("people.search in a community with children of every culture", () => {
  const registry = () => {
    const r = new CommandRegistry();
    r.register(peopleSearch);
    return r;
  };
  const run = async (via: "screen" | "assistant", query: string) => {
    const world = withInternationalChildren(communityWithChildren());
    const ctx = testContext({
      session: clubSession({ db: fakeDb(world), permissions: ["people.view", "people.manage", "giving.view", "giving.manage", "events.view"] }),
      registry: registry(),
      via,
      now: () => new Date(`${TODAY}T15:00:00Z`),
    });
    ctx.minors = databaseMinorNames;
    return runCommand(ctx, "people.search", { query });
  };

  it("shows the screen the household as it is, so the check below means something", async () => {
    const text = JSON.stringify(await run("screen", "Shah"));
    expect(text).toContain("王伟");
  });
  for (const query of ["Shah", "Patel", "Mehta"]) {
    it(`gives Niva the adults of the ${query} household and none of the children`, async () => {
      const r = await run("assistant", query);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      const text = JSON.stringify(r);
      for (const word of INTERNATIONAL.forbidden) expect(text, `${word} reached Niva`).not.toContain(word);
      for (const word of ["Zoya", "Aarav", "Tia"]) expect(text).not.toContain(word);
      expect(text).toMatch(/Priya Shah|Nikhil Patel|Anita Mehta/);
    });
  }
});

// ---------------------------------------------------------------------------
// A message that names a child
// ---------------------------------------------------------------------------
describe("the guard for message text, in any culture", () => {
  const guardFor = async (family: Family) => {
    const ctx = testContext({ session: clubSession({ db: fakeDb(worldOf([family])) }), via: "assistant" });
    ctx.minors = databaseMinorNames;
    return childGuard(ctx);
  };

  it("withholds a message that uses a child's name in the way the community writes it, and not one about the family", async () => {
    const wang = await guardFor(SCENARIOS[0].family);
    for (const text of ["Wei needs a gluten free meal", "wang wei's class", "Wei Wang is coming"]) expect(wang.mentions(text), text).toBe(true);
    for (const text of ["Jun Wang will bring dessert", "The Wang family would like a table"]) expect(wang.mentions(text), text).toBe(false);

    const cjk = await guardFor(SCENARIOS[2].family);
    expect(cjk.mentions("王伟今天发烧了")).toBe(true);
    expect(cjk.mentions("王老师明天来")).toBe(false);

    const gujarati = await guardFor(SCENARIOS[7].family);
    expect(gujarati.mentions("આરવની કક્ષા ક્યારે છે")).toBe(true);
    expect(gujarati.mentions("કાર્યક્રમ ક્યારે છે")).toBe(false);

    const ahmad = await guardFor(SCENARIOS[5].family);
    expect(ahmad.mentions("Ahmad is allergic to nuts")).toBe(true);
    expect(ahmad.mentions("Hassan bin Ali would like a table")).toBe(false);
  });

  it("replaces every text that names a child with the plain line, anywhere in the value", async () => {
    const guard = await guardFor(SCENARIOS[6].family);
    const value = { subject: "Re: Nguyen Van An", rows: [{ text: "Minh Nguyễn pledged $250" }, { text: "Văn An's class" }] };
    expect(guardText(value, guard)).toEqual({ subject: WITHHELD_FOR_CHILD, rows: [{ text: "Minh Nguyễn pledged $250" }, { text: WITHHELD_FOR_CHILD }] });
  });
});
