import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { ageOfMajority } from "@/lib/age-of-majority";
import { databaseMinorNames, filterChildren } from "@/lib/commands/child-filter";
import { defineCommand } from "@/lib/commands/define";
import { CHILD_NAME_REPLACEMENT as M, compileMinorNames } from "@/lib/commands/minor-names";
import { CommandRegistry } from "@/lib/commands/registry";
import { runCommand } from "@/lib/commands/run";
import { f, object } from "@/lib/commands/schema";
import { CommandError, type CommandContext, type CommandErrorCode } from "@/lib/commands/types";
import { COUNTRIES, countryCodeOf } from "@/lib/countries";
import { parseProfile } from "@/lib/setup";

import { LEAK_CASES, seen } from "../fixtures/child-leaks";
import { fakeDb, fakeSession, testContext, type FakeDbOptions } from "./helpers";

// Decision D2, the second review: the failures a model is given, the list of children read from the database (contacts, every
// household role, children who have left, learners), the country that sets the age, and every leak the review found, end to end.

const TODAY = "2026-10-10";
const CENTER = "center-1";
// Not a faith community: nothing here depends on one.
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
// 9. Every failure a model can be given is cleaned
// ---------------------------------------------------------------------------
// If a code is added to CommandErrorCode, this list must grow (the type refuses to compile otherwise).
const ALL_CODES: Record<CommandErrorCode, true> = {
  unknown_command: true,
  no_access: true,
  module_off: true,
  switched_off: true,
  screen_only: true,
  invalid: true,
  only_you: true,
  unsafe_result: true,
  proposal_failed: true,
  wrong_community: true,
  needs_step_up: true,
  failed: true,
};
const CODES = Object.keys(ALL_CODES) as CommandErrorCode[];

describe("9. every failure a model is given is cleaned, whatever its code", () => {
  const read = defineCommand<{ code: string }, unknown>({
    key: "events.look",
    title: "Look at events",
    description: "Look at events.",
    level: "read",
    permission: "events",
    module: "events",
    input: object({ code: f.string("The code to fail with.", { max: 40 }) }),
    async execute(_ctx, input) {
      throw new CommandError("Zoya Shah is already booked", input.code as CommandErrorCode);
    },
  });
  const confirm = defineCommand<{ code: string }, unknown>({
    key: "events.change",
    title: "Change an event",
    description: "Change an event.",
    level: "confirm",
    permission: "eventsManage",
    module: "events",
    input: object({ code: f.string("The code to fail with.", { max: 40 }) }),
    async preview(_ctx, input) {
      throw new CommandError("ZoyaShah_2015 is already booked", input.code as CommandErrorCode);
    },
    async execute() {
      return { ok: true, data: {} };
    },
  });
  const pointing = defineCommand({
    key: "settings.token",
    title: "Enter a token",
    description: "Enter a token.",
    level: "only_you",
    permission: "centerSettings",
    input: object({}),
    pointTo: { label: "Ask Zoya Shah to open Settings", href: "/settings/texting" },
  });
  const registry = () => {
    const r = new CommandRegistry();
    for (const c of [read, confirm, pointing]) r.register(c);
    return r;
  };
  const context = (minors?: CommandContext["minors"]) => {
    const ctx = testContext({ session: clubSession({ permissions: ["events.view", "events.manage", "settings.manage"], center: { rules: { assistant: { tools: { "events.change": true } } } } }), registry: registry(), via: "assistant", minorNames: ["Zoya Shah"] });
    if (minors) ctx.minors = minors;
    return ctx;
  };

  for (const code of CODES) {
    it(`${code}: a read, a preview and a command nobody may run say no child's name`, async () => {
      const ctx = context();
      for (const [key, input] of [["events.look", { code }], ["events.change", { code }]] as const) {
        const r = await runCommand(ctx, key, input);
        expect(r.ok, `${key} ${code}`).toBe(false);
        const text = JSON.stringify(r);
        expect(text, `${key} ${code}`).not.toMatch(/zoya/i);
        expect(text).toContain('"code"');
      }
    });
  }

  it("scrubs the sentence of a command that is not there, one only the person can do, and every field of them", async () => {
    const ctx = context();
    const unknown = await runCommand(ctx, "people.zoya_shah_2015", {});
    expect(unknown).toMatchObject({ ok: false, code: "unknown_command" });
    expect(JSON.stringify(unknown)).not.toMatch(/zoya/i);
    const only = await runCommand(ctx, "settings.token", {});
    expect(only).toMatchObject({ ok: false, code: "only_you" });
    expect(JSON.stringify(only)).not.toMatch(/zoya/i);
  });

  it("gives only the fixed sentence and the code when the children cannot be read", async () => {
    const ctx = context({ namesOfMinors: async () => Promise.reject(new Error("db down")) });
    for (const code of ["invalid", "failed", "no_access"] as const) {
      const r = await runCommand(ctx, "events.change", { code });
      expect(r).toEqual({ ok: false, error: expect.stringContaining("could not check this answer"), code });
    }
  });

  it("leaves a screen's own error as it is", async () => {
    const ctx = testContext({ session: clubSession({ permissions: ["events.view"] }), registry: registry(), via: "screen" });
    const r = await runCommand(ctx, "events.look", { code: "invalid" });
    expect(r).toMatchObject({ ok: false, error: "Zoya Shah is already booked" });
  });
});

// ---------------------------------------------------------------------------
// 10. The list of children, read from the database
// ---------------------------------------------------------------------------
type Person = {
  first: string;
  last: string;
  dob: string | null;
  role: "primary" | "spouse" | "parent" | "child" | "sibling" | "other";
  email?: string;
  phone?: string;
  member?: string;
  /** The person has left the household. */
  left?: boolean;
};
type Family = { id: string; people: Person[] };

function worldOf(families: Family[], extra: Record<string, Record<string, unknown>[]> = {}): FakeDbOptions {
  const people: Record<string, unknown>[] = [];
  const members: Record<string, unknown>[] = [];
  families.forEach((fam) =>
    fam.people.forEach((p, i) => {
      const id = `${fam.id}-${i}`;
      people.push({
        id,
        center_id: CENTER,
        first_name: p.first,
        last_name: p.last,
        preferred_name: null,
        date_of_birth: p.dob,
        email: p.email ?? null,
        phone_e164: p.phone ?? null,
        member_number: p.member ?? null,
        merged_into_id: null,
      });
      members.push({ household_id: fam.id, person_id: id, center_id: CENTER, role: p.role, is_primary: i === 0, left_at: p.left ? "2026-01-01" : null });
    }),
  );
  return { tables: { people, household_members: members, ...extra } };
}

const adult = (first: string, last: string): Person => ({ first, last, dob: "1980-01-01", role: "primary" });
const child = (first: string, last: string, over: Partial<Person> = {}): Person => ({ first, last, dob: "2016-03-03", role: "child", ...over });
const sessionFor = (world: FakeDbOptions, center: Record<string, unknown> = {}) => clubSession({ db: fakeDb(world), center });
const labels = async (world: FakeDbOptions, center: Record<string, unknown> = {}) =>
  (await databaseMinorNames.namesOfMinors(sessionFor(world, center))).map((e) => (typeof e === "string" ? e : (e.full?.[0] ?? e.words?.[0] ?? ""))).sort();

describe("10. who the assistant must never see a word about", () => {
  it("holds the child's e-mail address, phone number and member number, written however the text writes them", async () => {
    const world = worldOf([
      { id: "a", people: [adult("Priya", "Shah"), child("Zoya", "Shah", { email: "Zoya.Shah2015@Example.org", phone: "+16305550142", member: "M-10442" })] },
    ]);
    const entries = await databaseMinorNames.namesOfMinors(sessionFor(world));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ ids: ["Zoya.Shah2015@Example.org", "M-10442"], phones: ["+16305550142"] });
    for (const text of [
      "Write to zoya.shah2015@example.org today",
      "Write to ZOYA.SHAH2015@EXAMPLE.ORG",
      "Call (630) 555-0142 please",
      "Call 630-555-0142",
      "Call 630.555.0142",
      "Call +1 630 555 0142",
      "Call 6305550142.",
      "Her number is 1-630-555-0142",
      "Member M-10442 paid",
      "member m-10442 paid",
    ]) {
      const out = filterChildren(text, { minorNames: entries, today: TODAY }).value;
      expect(out, text).toContain(M);
      expect(out, text).not.toMatch(/555|10442|example/i);
    }
    // Another number, or another member number, is left alone.
    expect(filterChildren("Call 630-555-0199; member M-10443; room 10442", { minorNames: entries, today: TODAY }).value).toBe("Call 630-555-0199; member M-10443; room 10442".replace("room 10442", "room 10442"));
  });

  it("counts a person with no birth date and a sibling or 'other' role as a child, the way isAdultMember does", async () => {
    const world = worldOf([
      {
        id: "a",
        people: [
          adult("Priya", "Shah"),
          { first: "Nikita", last: "Shah", dob: null, role: "sibling" },
          { first: "Dev", last: "Shah", dob: null, role: "other" },
          { first: "Hari", last: "Shah", dob: null, role: "parent" },
          { first: "Mira", last: "Shah", dob: null, role: "spouse" },
          { first: "Old", last: "Shah", dob: "1950-01-01", role: "other" },
        ],
      },
    ]);
    expect(await labels(world)).toEqual(["Dev Shah", "Nikita Shah"]);
  });

  it("still counts a child who has left the household, and an adult who left is not one", async () => {
    const world = worldOf([
      { id: "a", people: [adult("Priya", "Shah"), child("Zoya", "Shah", { dob: null, left: true }), { first: "Rahul", last: "Shah", dob: null, role: "spouse", left: true }] },
    ]);
    expect(await labels(world)).toEqual(["Zoya Shah"]);
  });

  it("counts every learner of the religious school, of any age", async () => {
    const world = worldOf(
      [{ id: "a", people: [adult("Priya", "Shah"), { first: "Meera", last: "Joshi", dob: "1985-05-05", role: "spouse" }] }],
      { pathshala_enrollments: [{ center_id: CENTER, student_person_id: "a-1", status: "active" }, { center_id: "other", student_person_id: "a-0", status: "active" }] },
    );
    expect(await labels(world)).toEqual(["Meera Joshi"]);
  });

  it("copes with a role that may not read the enrolments, and fails on any other trouble", async () => {
    const world = worldOf([{ id: "a", people: [adult("Priya", "Shah"), child("Zoya", "Shah")] }]);
    expect(await labels({ ...world, failTables: { pathshala_enrollments: { code: "42501", message: "permission denied" } } })).toEqual(["Zoya Shah"]);
    await expect(databaseMinorNames.namesOfMinors(sessionFor({ ...world, failTables: { pathshala_enrollments: { code: "XX000", message: "boom" } } }))).rejects.toThrow(/could not read the learners/);
    await expect(databaseMinorNames.namesOfMinors(sessionFor({ ...world, failTables: { household_members: { message: "boom" } } }))).rejects.toThrow(/could not read/);
  });

  describe("a family name that two or more adults of the community carry", () => {
    const west = (n: number): Family[] =>
      Array.from({ length: n }, (_, i) => ({ id: `w${i}`, people: [adult("Adult", `Name${i}`), child(`Kid${i}`, `Name${i}`)] }));

    it("does not identify a child on its own when the child's household has no adult with it, in a community that writes the family name last", async () => {
      const world = worldOf([
        ...west(6),
        { id: "x", people: [adult("Mira", "Mehta"), child("Zoya", "Desai")] },
        { id: "y1", people: [adult("Hari", "Desai")] },
        { id: "y2", people: [adult("Sunil", "Desai")] },
      ]);
      const entries = await databaseMinorNames.namesOfMinors(sessionFor(world));
      const zoya = entries.find((e) => typeof e !== "string" && e.full?.[0] === "Zoya Desai");
      expect(zoya).toEqual({ full: ["Zoya Desai"], words: ["Zoya"] });
      expect(filterChildren("Hari Desai and Sunil Desai; Zoya Desai", { minorNames: entries, today: TODAY }).value).toBe(`Hari Desai and Sunil Desai; ${M}`);
    });

    it("still identifies the child when only one other adult carries it", async () => {
      const world = worldOf([...west(6), { id: "x", people: [adult("Mira", "Mehta"), child("Zoya", "Desai")] }, { id: "y1", people: [adult("Hari", "Desai")] }]);
      const entries = await databaseMinorNames.namesOfMinors(sessionFor(world));
      expect(entries.find((e) => typeof e !== "string" && e.full?.[0] === "Zoya Desai")).toEqual({ full: ["Zoya Desai"], words: ["Zoya", "desai"] });
    });

    it("does not apply in a community that writes the family name first (the last-name column holds given names there)", async () => {
      // Here the children do not share their last name with the adults of their households: that column is the given name.
      const fam = Array.from({ length: 6 }, (_, i): Family => ({ id: `f${i}`, people: [adult(`Wang${i}`, `Jun${i}`), child(`Wang${i}`, "Wei")] }));
      const more: Family[] = [{ id: "g1", people: [adult("Zhang", "Wei")] }, { id: "g2", people: [adult("Li", "Wei")] }];
      const entries = await databaseMinorNames.namesOfMinors(sessionFor(worldOf([...fam, ...more])));
      for (const e of entries) expect(e).toMatchObject({ words: expect.arrayContaining(["wei"]) });
      expect(filterChildren("Wei is sick", { minorNames: entries, today: TODAY }).value).toBe(`${M} is sick`);
    });
  });
});

// ---------------------------------------------------------------------------
// 12. The country that sets the age
// ---------------------------------------------------------------------------
describe("12. the community's country sets the age, written however it is written", () => {
  it("understands alpha-2 and alpha-3 codes, names and dotted forms", () => {
    for (const country of ["SG", "sg", "SGP", "Singapore", "singapore", "Republic of Singapore", "the Republic of Singapore", " Singapore "]) expect(ageOfMajority({ country }), country).toBe(21);
    for (const country of ["AE", "ARE", "UAE", "U.A.E.", "u.a.e", "United Arab Emirates", "Emirates"]) expect(ageOfMajority({ country }), country).toBe(21);
    for (const country of ["KR", "KOR", "South Korea", "Republic of Korea", "Korea, Republic of", "Korea"]) expect(ageOfMajority({ country }), country).toBe(19);
    for (const country of ["TH", "THA", "Thailand", "Kingdom of Thailand"]) expect(ageOfMajority({ country }), country).toBe(20);
    for (const country of ["EG", "EGY", "Egypt", "KW", "Kuwait", "OM", "OMN", "Oman"]) expect(ageOfMajority({ country }), country).toBe(21);
  });
  it("gives 18 for everywhere else, nothing and nonsense, and never less", () => {
    for (const country of ["US", "USA", "United States of America", "IN", "IND", "India", "GB", "UK", "Atlantis", "", "  ", null, undefined, "12"]) expect(ageOfMajority({ country }), String(country)).toBe(18);
    expect(ageOfMajority({ country: "SG", rules: { age_of_majority: 16 } })).toBe(21);
    expect(ageOfMajority({ country: "IN", rules: { age_of_majority: 16 } })).toBe(18);
  });
  it("knows every country in the Profile list by its code, its three-letter code and its name", () => {
    for (const [a2, a3, name] of COUNTRIES) {
      expect(countryCodeOf(a2), a2).toBe(a2);
      expect(countryCodeOf(a3), a3).toBe(a2);
      expect(countryCodeOf(name), name).toBe(a2);
    }
  });
  it("is set from Setup > Profile", () => {
    const form = (over: Record<string, string>) => (name: string): string | null => {
      const base: Record<string, string> = { name: "Lakeside Neighbors Club", time_zone: "America/Chicago", currency: "usd", main_language: "en", ...over };
      return name in base ? base[name] : null;
    };
    const parse = (over: Record<string, string>) => parseProfile(form(over), () => [], ["America/Chicago"]);
    expect(parse({ country: "SGP", state_region: "" })).toMatchObject({ ok: true, value: { country: "SG", state_region: null } });
    expect(parse({ country: "Republic of Singapore" })).toMatchObject({ ok: true, value: { country: "SG", state_region: undefined } });
    expect(parse({ country: "US", state_region: " AL " })).toMatchObject({ ok: true, value: { country: "US", state_region: "AL" } });
    expect(parse({})).toMatchObject({ ok: true, value: { country: null } });
    expect(parse({ country: "Atlantis" })).toMatchObject({ ok: false, error: expect.stringContaining("Choose the country") });
  });
});

// ---------------------------------------------------------------------------
// Every leak of the review, through the door a model's answer goes through
// ---------------------------------------------------------------------------
describe("every leak the review found, end to end through runCommand", () => {
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
  const registry = () => {
    const r = new CommandRegistry();
    r.register(echo);
    return r;
  };

  for (const c of LEAK_CASES) {
    it(`${c.group}: ${JSON.stringify(c.text)} as a value, in a list, in a key and in a sentence`, async () => {
      const ctx = testContext({ session: clubSession({ permissions: ["events.view"] }), registry: registry(), via: "assistant" });
      ctx.minors = { namesOfMinors: async () => c.children };
      const payload = { note: c.text, list: [c.text, "x"], [c.text]: 1, nested: { sentence: `Please tell ${c.text} that class starts at nine.` } };
      const r = await runCommand(ctx, "events.look", { payload: JSON.stringify(payload) });
      if (!r.ok) {
        // Withheld: safe too, and the model is told nothing but the fixed sentence.
        expect(JSON.stringify(r)).not.toContain(c.text);
        return;
      }
      const clean = seen(JSON.stringify(r));
      for (const piece of c.gone) expect(clean, JSON.stringify(r)).not.toContain(piece.toLowerCase());
      expect(compileMinorNames(c.children).find(JSON.stringify(r))).toEqual([]);
    });
  }
});
