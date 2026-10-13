import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));

import { CATALOG } from "@/lib/commands/catalog";
import { PEOPLE_COMMANDS } from "@/lib/commands/catalog/people";
import { peopleSearch } from "@/lib/commands/catalog/people-search";
import { runCommand } from "@/lib/commands/run";
import type { CommandRunResult } from "@/lib/commands/types";

import { fakeSession } from "./helpers";
import { ID, MINORS, peopleContext, peopleDb, switchedOn } from "./people-fixture";

const CHILD_WORDS = /Zoya|Aarav|2018-05-05|\bDev\b/;

function dataOf<T>(r: CommandRunResult): T {
  if (!r.ok || r.needsConfirmation) throw new Error(`expected data, got ${JSON.stringify(r)}`);
  return r.data as T;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the People commands in the catalog", () => {
  it("are all in the shared catalog, with a model-ready description and a Server Action each (or a lookup)", () => {
    for (const c of PEOPLE_COMMANDS) {
      expect(CATALOG).toContain(c);
      expect(c.key).toMatch(/^people\./);
      expect(c.description.length).toBeGreaterThan(80);
      expect(c.description).not.toMatch(/\bbid\b/i);
    }
  });

  it("are lookups and drafts that are on by default, and changes that are confirm level and OFF by default", () => {
    const by = Object.fromEntries(PEOPLE_COMMANDS.map((c) => [c.key, c]));
    for (const key of ["people.find_household", "people.household_summary", "people.pending_reviews"]) expect(by[key].level).toBe("read");
    expect(by["people.suggest_duplicates"].level).toBe("draft");
    const changes = PEOPLE_COMMANDS.filter((c) => c.level === "confirm");
    expect(changes.map((c) => c.key).sort()).toEqual(
      [
        "people.add_identifier",
        "people.add_household",
        "people.add_person",
        "people.decide_application",
        "people.decide_household_request",
        "people.dismiss_duplicate",
        "people.mark_deceased",
        "people.merge_households",
        "people.merge_people",
        "people.move_person",
        "people.retire_identifier",
        "people.set_primary",
        "people.update_household",
        "people.update_person",
      ].sort(),
    );
    for (const c of changes) {
      expect(c.enabledByDefault).toBe(false);
      expect(c.preview).toBeTypeOf("function");
      expect(c.covers?.length).toBe(1);
    }
  });

  it("take no child's record as input and never ask for a name where an id or card will do", () => {
    for (const c of PEOPLE_COMMANDS) {
      const props = Object.keys((c.input.json() as { properties: Record<string, unknown> }).properties);
      expect(props.join(" ")).not.toMatch(/child|minor|learner|student|photo_url/);
    }
  });
});

describe("people.find_household", () => {
  const hits = [
    { kind: "crm", system: "neon", value: "N-77", person_id: ID.nikhil, household_id: ID.hhPatel, display_name: "Nikhil Patel", household_name: "Patel family", household_number: "H-1002", org_household_id: "2042", members: "Nikhil, Aarav" },
    // The same value on the child's record: the child is never mentioned.
    { kind: "crm", system: "neon", value: "N-99", person_id: ID.aarav, household_id: ID.hhPatel, display_name: "Aarav Patel", household_name: "Patel family", household_number: "H-1002", org_household_id: "2042", members: "Nikhil, Aarav" },
  ];

  it("answers an exact identifier with the household card, adults only, and says which identifier matched", async () => {
    const { db } = peopleDb({ rpc: { resolve_identifier: hits } });
    const ctx = peopleContext({ via: "assistant", db });
    const r = await runCommand(ctx, "people.find_household", { identifier: "N-77" });
    const data = dataOf<{ count: number; ambiguous: boolean; results: { household: { household_id: string; adults: string[]; household_number: string }; matched_on: string[] }[] }>(r);
    expect(data.count).toBe(1);
    expect(data.ambiguous).toBe(false);
    expect(data.results[0].household.household_id).toBe(ID.hhPatel);
    expect(data.results[0].household.household_number).toBe("H-1002");
    expect(data.results[0].household.adults).toEqual(["Nikhil Patel"]);
    expect(data.results[0].matched_on).toHaveLength(1);
    expect(data.results[0].matched_on[0]).toContain("N-77");
    expect(JSON.stringify(r)).not.toMatch(CHILD_WORDS);
    expect(JSON.stringify(r)).not.toContain("N-99");
  });

  it("says so when more than one household holds the value, and returns every card", async () => {
    const shared = [
      { kind: "bank_payer", system: "chase", value: "P SHAH", person_id: null, household_id: ID.hhShah, display_name: null, household_name: null, household_number: null, org_household_id: null, members: null },
      { kind: "bank_payer", system: "chase", value: "P SHAH", person_id: null, household_id: ID.hhShah2, display_name: null, household_name: null, household_number: null, org_household_id: null, members: null },
    ];
    const ctx = peopleContext({ via: "assistant", db: peopleDb({ rpc: { resolve_identifier: shared } }).db });
    const r = await runCommand(ctx, "people.find_household", { identifier: "P SHAH" });
    const data = dataOf<{ ambiguous: boolean; results: unknown[] }>(r);
    expect(data.ambiguous).toBe(true);
    expect(data.results).toHaveLength(2);
    expect(JSON.stringify(r)).toMatch(/let the person choose/);
    expect(JSON.stringify(r)).not.toMatch(CHILD_WORDS);
  });

  it("says plainly when nothing matches, and needs a permission to search", async () => {
    const ctx = peopleContext({ via: "assistant" });
    const none = await runCommand(ctx, "people.find_household", { identifier: "ZZ-1" });
    expect(dataOf<{ count: number }>(none).count).toBe(0);
    const denied = await runCommand(peopleContext({ via: "assistant", permissions: [] }), "people.find_household", { identifier: "N-77" });
    expect(denied).toMatchObject({ ok: false, code: "no_access" });
  });
});

describe("people.search keeps children out with this community", () => {
  it("never leaks a child's name, however the household is named", async () => {
    const ctx = peopleContext({ via: "assistant" });
    ctx.registry.register(peopleSearch);
    const r = await runCommand(ctx, "people.search", { query: "Shah" });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(CHILD_WORDS);
    for (const name of MINORS) expect(JSON.stringify(r)).not.toContain(name);
  });
});

describe("people.household_summary", () => {
  it("shows the card, the adults, identifiers (not a child's), the membership and what is waiting", async () => {
    const { db } = peopleDb();
    const ctx = peopleContext({ via: "assistant", db });
    const r = await runCommand(ctx, "people.household_summary", { household_id: ID.hhPatel });
    const data = dataOf<{ household: { household_number: string }; adults: { name: string; identifiers: string[] }[]; household_identifiers: string[]; waiting: { applications: number; family_requests: number } }>(r);
    expect(data.household.household_number).toBe("H-1002");
    expect(data.adults.map((a) => a.name)).toEqual(["Nikhil Patel"]);
    expect(data.adults[0].identifiers.join(" ")).toContain("N-77");
    expect(data.household_identifiers.join(" ")).toContain("QB-7");
    expect(data.waiting).toEqual({ applications: 1, family_requests: 1 });
    expect(JSON.stringify(r)).not.toMatch(CHILD_WORDS);
    expect(JSON.stringify(r)).not.toContain("N-99");
  });

  it("shows the active membership of a household", async () => {
    const ctx = peopleContext({ via: "assistant" });
    const data = dataOf<{ membership: { tier: string } | null; adults: { name: string }[] }>(await runCommand(ctx, "people.household_summary", { household_id: ID.hhShah }));
    expect(data.membership?.tier).toBe("Yearly");
    expect(data.adults.map((a) => a.name)).toEqual(["Priya Shah", "Rahul Shah"]);
  });

  it("says a household the role cannot see was not found", async () => {
    const ctx = peopleContext({ via: "assistant" });
    const r = await runCommand(ctx, "people.household_summary", { household_id: "a0000000-0000-4000-8000-0000000000ff" });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/not found, or you can't see it/);
  });
});

describe("people.pending_reviews", () => {
  it("lists applications and requests with household cards, and only counts what concerns a child", async () => {
    const ctx = peopleContext({ via: "assistant" });
    const r = await runCommand(ctx, "people.pending_reviews", {});
    const data = dataOf<{
      applications: { id: string; applicant: string; fee: string | null; step: string; household: { household_number: string } | null }[];
      family_requests: { id: string; summary: string; household: { household_number: string } | null }[];
      family_requests_for_the_screen: number;
      family_requests_total: number;
    }>(r);
    expect(data.applications).toHaveLength(1);
    expect(data.applications[0]).toMatchObject({ id: ID.app, applicant: "Nikhil Patel", fee: "$50.00", step: "waiting for the center review" });
    expect(data.applications[0].household?.household_number).toBe("H-1002");
    expect(data.family_requests.map((x) => x.id)).toEqual([ID.reqAdult]);
    expect(data.family_requests[0].summary).toMatch(/Meera Shah/);
    expect(data.family_requests[0].household?.household_number).toBe("H-1001");
    expect(data.family_requests_for_the_screen).toBe(1);
    expect(data.family_requests_total).toBe(2);
    expect(JSON.stringify(r)).not.toMatch(CHILD_WORDS);
  });

  type Reviewed = {
    applications: { since: string; next: string | null; blocked: string | null }[];
    family_requests: { since: string; who: string; asked: string | null; asked_role: string | null }[];
  };

  it("says since when each row has waited, what approving would do for this person, and what a request asked for", async () => {
    const data = dataOf<Reviewed>(await runCommand(peopleContext(), "people.pending_reviews", {}));
    expect(data.applications[0]).toMatchObject({ since: "2026-10-04", next: "approved", blocked: null });
    expect(data.family_requests[0]).toMatchObject({ since: "2026-10-05", who: "Meera Shah", asked: "parent", asked_role: "parent" });
  });

  it("offers the center review (not the final approval) for a life membership, and says who a final step waits for", async () => {
    const { db, tables } = peopleDb();
    const app = tables.membership_applications[0];
    const first = async (over: Parameters<typeof peopleContext>[0] = {}) => dataOf<Reviewed>(await runCommand(peopleContext({ db, ...over }), "people.pending_reviews", {})).applications[0];

    app.tier = "life";
    expect(await first()).toMatchObject({ next: "awaiting_ec", blocked: null });

    app.status = "awaiting_ec";
    const notEc = await first();
    expect(notEc.next).toBeNull();
    expect(notEc.blocked).toMatch(/Executive Committee step/);

    const ec = [{ key: "executive_committee", name: "Executive Committee", scopeKind: "center" }];
    app.center_decided_by = "user-1";
    const same = await first({ session: { roles: ec } });
    expect(same.next).toBeNull();
    expect(same.blocked).toMatch(/different Executive Committee member/);

    app.center_decided_by = "someone-else";
    expect(await first({ session: { roles: ec } })).toMatchObject({ next: "approved", blocked: null });
  });

  it("leaves applications out, and says so, for a role that cannot see them", async () => {
    const ctx = peopleContext({ via: "assistant", permissions: ["people.manage"] });
    const data = dataOf<{ applications: unknown[]; applications_total: number | null; note?: string }>(await runCommand(ctx, "people.pending_reviews", {}));
    expect(data.applications).toEqual([]);
    expect(data.applications_total).toBeNull();
    expect(data.note).toMatch(/cannot see membership applications/);
  });
});

describe("people.suggest_duplicates", () => {
  it("prepares pairs for a person to compare, never changes anything, and keeps children out", async () => {
    const { db } = peopleDb();
    const ctx = peopleContext({ via: "assistant", db });
    const r = await runCommand(ctx, "people.suggest_duplicates", {});
    const data = dataOf<{
      count: number;
      for_the_screen: number;
      suggestions: { candidate_id: string; kind: string; suggested_keep_id?: string; first?: { signs_in: boolean; member_number: string }; households: { household_number: string }[]; next_step: string }[];
    }>(r);
    expect(data.count).toBe(2);
    expect(data.for_the_screen).toBe(1);
    const person = data.suggestions.find((s) => s.kind === "person")!;
    expect(person.candidate_id).toBe(ID.candPerson);
    // The record that signs in is the one to keep.
    expect(person.suggested_keep_id).toBe(ID.priya);
    expect(person.households.map((h) => h.household_number).sort()).toEqual(["H-1001", "H-1003"]);
    const household = data.suggestions.find((s) => s.kind === "household")!;
    expect(household.households).toHaveLength(2);
    expect(JSON.stringify(r)).not.toMatch(CHILD_WORDS);
    expect(db.calls.some((c) => c.op === "update")).toBe(false);
    expect(db.rpcCalls.every((c) => c.fn === "household_card")).toBe(true);
  });

  it("is a draft: a person compares and then confirms a merge", () => {
    const c = PEOPLE_COMMANDS.find((x) => x.key === "people.suggest_duplicates")!;
    expect(c.level).toBe("draft");
    expect(c.description).toMatch(/only prepares/);
  });

  it("can be limited to households", async () => {
    const ctx = peopleContext({ via: "assistant" });
    const data = dataOf<{ suggestions: { kind: string }[] }>(await runCommand(ctx, "people.suggest_duplicates", { kind: "household" }));
    expect(data.suggestions.every((s) => s.kind === "household")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Decision D2 for the whole People area: a household with children in it never shows a child to a model, whichever command
// is called, and no command takes a child's record as input.
// ---------------------------------------------------------------------------
describe("nothing about a child reaches Niva from any People command", () => {
  const SAMPLE: Record<string, unknown> = {
    "people.find_household": { identifier: "N-77" },
    "people.household_summary": { household_id: ID.hhShah },
    "people.pending_reviews": {},
    "people.suggest_duplicates": {},
    "people.add_person": { household_id: ID.hhShah, first_name: "Meera", last_name: "Shah", role: "parent", date_of_birth: "02/02/1955" },
    "people.update_person": { id: ID.priya, profession: "Doctor" },
    "people.move_person": { person_id: ID.rahul, from_household_id: ID.hhShah, to_household_id: ID.hhPatel, role: "parent" },
    "people.update_household": { id: ID.hhShah, city: "Round Rock" },
    "people.merge_people": { keep_id: ID.priya, drop_id: ID.priya2, take: "email" },
    "people.merge_households": { keep_id: ID.hhShah, drop_id: ID.hhShah2 },
    "people.dismiss_duplicate": { candidate_id: ID.candPerson },
    "people.decide_application": { id: ID.app, decision: "approve" },
    "people.decide_household_request": { id: ID.reqAdult, decision: "approve", role: "parent" },
    "people.mark_deceased": { person_id: ID.rahul, deceased_on: "2026-10-01", reason: "His son called the office", confirmed: true },
    "people.set_primary": { household_id: ID.hhShah, person_id: ID.rahul, reason: "Priya asked" },
    "people.add_identifier": { kind: "crm", target_kind: "household", target_id: ID.hhShah, value: "N-1001", system: "neon" },
    "people.retire_identifier": { identifier_id: ID.extNikhil, reason: "Moved to a new system" },
    "people.add_household": { first_name: "Nia", last_name: "Okafor", mobile: "(512) 555-0188", email: "nia@example.org", street: "12 River Road" },
  };

  function assistant() {
    const { db } = peopleDb();
    const center = { ...fakeSession().center, rules: switchedOn(PEOPLE_COMMANDS.map((c) => c.key)) };
    return peopleContext({ via: "assistant", db, session: { center } });
  }

  it("has a sample for every People command", () => {
    for (const c of PEOPLE_COMMANDS) expect(Object.keys(SAMPLE)).toContain(c.key);
  });

  for (const command of PEOPLE_COMMANDS) {
    it(`${command.key}: no child's name, birth date or record in what Niva is given`, async () => {
      const r = await runCommand(assistant(), command.key, SAMPLE[command.key]);
      // A screen-only command is never given to Niva at all: it answers in words, with nothing from the record in it.
      if (command.screenOnly) {
        expect(r, command.key).toMatchObject({ ok: false, code: "screen_only" });
      } else {
        expect(r.ok, JSON.stringify(r)).toBe(true);
      }
      const text = JSON.stringify(r);
      for (const name of [...MINORS, "Zoya", "Aarav"]) expect(text, `${name} reached a result of ${command.key}`).not.toContain(name);
      expect(text).not.toContain("2018-05-05");
      expect(text).not.toMatch(/"date_of_birth"/);
    });
  }

  it("refuses a child's record as input, in words, and shows nothing", async () => {
    const ctx = assistant();
    const tries: [string, Record<string, unknown>][] = [
      ["people.update_person", { id: ID.zoya, profession: "x" }],
      ["people.move_person", { person_id: ID.aarav, from_household_id: ID.hhPatel, to_household_id: ID.hhShah, role: "other" }],
      ["people.add_person", { household_id: ID.hhShah, first_name: "Kid", last_name: "Shah", role: "child" }],
      ["people.merge_people", { keep_id: ID.zoya, drop_id: ID.aarav }],
      ["people.dismiss_duplicate", { candidate_id: ID.candChildren }],
      ["people.decide_household_request", { id: ID.reqChild, decision: "reject", reason: "no" }],
      ["people.add_identifier", { kind: "crm", target_kind: "person", target_id: ID.aarav, value: "N-5", system: "neon" }],
      ["people.retire_identifier", { identifier_id: ID.extAarav, reason: "Moved" }],
    ];
    for (const [key, input] of tries) {
      const r = await runCommand(ctx, key, input);
      expect(r.ok, key).toBe(false);
      if (!r.ok) expect(r.error, key).toBe("Niva does not work with children's records. Please do this on the People screen.");
      expect(JSON.stringify(r)).not.toMatch(/Zoya|Aarav|Dev/);
    }
  });
});
