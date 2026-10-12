import { beforeEach, describe, expect, it, vi } from "vitest";

// people.add_household (slice 6): the sentences for each mistake, what is sent to the database function, the possible-match flow
// (nothing is added until the person says "none of these"), adults only in every card, Niva's route through the preview, and a
// community that is not a faith community with names in Chinese and Arabic. The database function itself is tested in 142.

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { revalidatePath } from "next/cache";

import { CATALOG } from "@/lib/commands/catalog";
import { addHousehold } from "@/lib/commands/catalog/people/add-household";
import { commandAvailability } from "@/lib/commands/enabled";
import { confirmProposal, runCommand } from "@/lib/commands/run";
import type { CommandRunResult } from "@/lib/commands/types";

import { fakeSession } from "./helpers";
import { ID, STAFF, peopleContext, peopleDb, switchedOn } from "./people-fixture";
import { familyDb, neighbourhoodCenter } from "./people-family-fixture";

const NEW_HH = "a0000000-0000-4000-8000-0000000000f1";
const NEW_PERSON = "b0000000-0000-4000-8000-0000000000f1";
const NONE = { total: 0, matches: [] };
const CREATED = { created: true, household_id: NEW_HH, person_id: NEW_PERSON, household_number: "H-1201" };
const SOME = {
  total: 2,
  matches: [
    { household_id: ID.hhShah, reasons: ["mobile", "name"], strength: 8 },
    { household_id: ID.hhPatel, reasons: ["last_name"], strength: 1 },
  ],
};
const CHILD_WORDS = /Zoya|Aarav|2018-05-05/;

function world(opts: { via?: "screen" | "assistant"; permissions?: string[]; matches?: unknown; add?: unknown; failRpc?: Record<string, { code?: string; message: string }>; community?: "neighbourhood" | "faith"; on?: boolean } = {}) {
  const { db, tables } = opts.community === "neighbourhood" ? familyDb({ rpc: rpcFor(opts), failRpc: opts.failRpc }) : peopleDb({ rpc: rpcFor(opts), failRpc: opts.failRpc });
  const base = opts.community === "neighbourhood" ? neighbourhoodCenter() : fakeSession().center;
  const center = { ...base, rules: { ...(base.rules as object), ...(opts.on === false ? {} : switchedOn(["people.add_household"])) } };
  const ctx = peopleContext({ via: opts.via ?? "screen", db, permissions: opts.permissions, session: { center } });
  return { db, tables, ctx };
}
function rpcFor(opts: { matches?: unknown; add?: unknown }) {
  return {
    household_possible_matches: opts.matches ?? NONE,
    add_household: opts.add ?? ((a: Record<string, unknown>) => (a.p_none_of_these || !opts.matches ? CREATED : { created: false, total: SOME.total, matches: SOME.matches })),
  };
}

const failed = (r: CommandRunResult): string => {
  if (r.ok) throw new Error(`expected a failure, got ${JSON.stringify(r)}`);
  return r.error;
};

const input = { first_name: "Nia", last_name: "Okafor", mobile: "(512) 555-0188", email: " Nia@Example.org ", street: " 12 River Road " };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(revalidatePath).mockClear();
});

describe("people.add_household in the catalog", () => {
  it("is a confirm command, off for Niva until a community ticks it, for people.manage, covering the sheet's action", () => {
    expect(CATALOG).toContain(addHousehold);
    expect(addHousehold).toMatchObject({ key: "people.add_household", level: "confirm", enabledByDefault: false, permission: "householdsEdit", module: "people" });
    expect(addHousehold.screenOnly).toBeUndefined();
    expect(addHousehold.covers).toEqual(["src/app/(app)/people/add-family-actions.ts#addFamilyAction"]);
    expect(addHousehold.description).not.toMatch(/\bbid\b/i);
  });

  it("takes no child: there is no relationship, birth date or child field to fill", () => {
    const props = Object.keys((addHousehold.input.json() as { properties: Record<string, unknown> }).properties);
    expect(props).toEqual(["first_name", "last_name", "mobile", "email", "street", "none_of_these"]);
  });

  it("is off for Niva until ticked, and needs people.manage", async () => {
    expect(await runCommand(world({ via: "assistant", on: false }).ctx, "people.add_household", input)).toMatchObject({ ok: false, code: "switched_off" });
    expect(await runCommand(world({ via: "assistant", permissions: ["people.view"] }).ctx, "people.add_household", input)).toMatchObject({ ok: false, code: "no_access" });
    const session = fakeSession({ permissions: STAFF, center: { ...fakeSession().center, rules: {} } });
    expect(commandAvailability(addHousehold, session, "screen")).toEqual({ ok: true });
    expect(commandAvailability(addHousehold, session, "assistant")).toMatchObject({ ok: false, code: "switched_off" });
  });
});

describe("execute: no similar family", () => {
  it("asks the database function with what was typed, tidied, and says what was added", async () => {
    const { ctx, db } = world();
    const r = await addHousehold.execute!(ctx, input);
    expect(r).toEqual({ ok: true, data: { created: true, householdId: NEW_HH, personId: NEW_PERSON, householdNumber: "H-1201" }, message: "Family added: Nia Okafor · household H-1201 · audit logged" });
    expect(db.rpcCalls.find((c) => c.fn === "add_household")?.args).toEqual({
      p_center: "center-1",
      p_first: "Nia",
      p_last: "Okafor",
      p_phone: "+15125550188",
      p_email: "nia@example.org",
      p_street: "12 River Road",
      p_none_of_these: false,
    });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(`/households/${NEW_HH}`, "layout");
  });

  it("leaves out what was not given", async () => {
    const { ctx, db } = world();
    await addHousehold.execute!(ctx, { first_name: "Nia", last_name: "Okafor" });
    expect(db.rpcCalls.find((c) => c.fn === "add_household")?.args).toEqual({ p_center: "center-1", p_first: "Nia", p_last: "Okafor", p_phone: null, p_email: null, p_street: null, p_none_of_these: false });
  });

  it("works for a name in Chinese in a community that is not a faith community", async () => {
    const { ctx, db } = world({ community: "neighbourhood" });
    const r = await addHousehold.execute!(ctx, { first_name: "明", last_name: "李", email: "ming@example.org" });
    expect(r).toMatchObject({ ok: true, message: "Family added: 明 李 · household H-1201 · audit logged" });
    expect(db.rpcCalls.find((c) => c.fn === "add_household")?.args).toMatchObject({ p_first: "明", p_last: "李", p_email: "ming@example.org" });
  });
});

describe("execute: families that may already be this one", () => {
  it("adds nothing and gives their cards back, adults only, with why", async () => {
    const { ctx } = world({ matches: SOME });
    const r = await addHousehold.execute!(ctx, input);
    expect(r).toMatchObject({ ok: true, data: { created: false, total: 2 }, message: "Nothing was added. 2 families may already be this one. Open the right one, or say that none of them is the same family." });
    if (!r.ok || r.data.created) throw new Error("expected matches");
    expect(r.data.matches).toHaveLength(2);
    expect(r.data.matches[0].household).toMatchObject({ household_number: "H-1001", adults: ["Priya Shah", "Rahul Shah"] });
    expect(r.data.matches[0].reasons).toEqual(["mobile", "name"]);
    expect(JSON.stringify(r)).not.toMatch(CHILD_WORDS);
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });

  it("adds the family once the person has said none of these", async () => {
    const { ctx, db } = world({ matches: SOME });
    const r = await addHousehold.execute!(ctx, { ...input, none_of_these: true });
    expect(r).toMatchObject({ ok: true, data: { created: true, householdId: NEW_HH } });
    expect(db.rpcCalls.find((c) => c.fn === "add_household")?.args).toMatchObject({ p_none_of_these: true });
  });

  it("keeps a family the role cannot see out of the cards but in the count", async () => {
    const { ctx } = world({ matches: { total: 3, matches: [{ household_id: "a0000000-0000-4000-8000-0000000000ee", reasons: ["mobile"], strength: 4 }] }, add: { created: false, total: 3, matches: [{ household_id: "a0000000-0000-4000-8000-0000000000ee", reasons: ["mobile"], strength: 4 }] } });
    const r = await addHousehold.execute!(ctx, input);
    expect(r).toMatchObject({ ok: true, data: { created: false, total: 3, matches: [] } });
  });
});

describe("the sentences for each mistake, and for a database refusal", () => {
  it("are the sheet's, in plain words", async () => {
    const { ctx, db } = world();
    const says = (over: Record<string, unknown>) => expect(addHousehold.execute!(ctx, { ...input, ...over } as never));
    await says({ first_name: "  " }).rejects.toThrow("Could not add the family — enter the first adult's first and last name.");
    await says({ last_name: "" }).rejects.toThrow("Could not add the family — enter the first adult's first and last name.");
    await says({ first_name: "x".repeat(201) }).rejects.toThrow("Could not add the family — the name is too long.");
    await says({ mobile: "512 55" }).rejects.toThrow(/^Could not add the family — Enter the mobile number with its area code/);
    await says({ email: "nia@" }).rejects.toThrow("Could not add the family — that email address does not look right.");
    await says({ street: "x".repeat(301) }).rejects.toThrow("Could not add the family — the street address is too long.");
    expect(db.rpcCalls.some((c) => c.fn === "add_household")).toBe(false);
  });

  it("hands a database refusal to the runner as a step named in plain words", async () => {
    const { ctx } = world({ failRpc: { add_household: { code: "42501", message: "Adding a family needs the people.manage permission" } } });
    await expect(addHousehold.execute!(ctx, input)).rejects.toMatchObject({ doing: "add the family", dbError: { code: "42501" } });
  });
});

describe("Niva's way in: the preview", () => {
  it("shows the matches first and refuses to prepare the card until the person has said none of them is the family", async () => {
    const { ctx } = world({ via: "assistant", matches: SOME });
    const err = failed(await runCommand(ctx, "people.add_household", input));
    expect(err).toMatch(/^2 families may already be this one\. /);
    expect(err).toContain("H-1001");
    expect(err).toContain("Priya Shah & Rahul Shah");
    expect(err).toContain("same mobile, same name");
    expect(err).toMatch(/ask again with none_of_these set to true/);
    expect(err).not.toMatch(CHILD_WORDS);
  });

  it("then prepares a card that adds nothing until it is confirmed, and adds once", async () => {
    const { ctx, db } = world({ via: "assistant", matches: SOME });
    const r = await runCommand(ctx, "people.add_household", { ...input, none_of_these: true });
    if (!r.ok || !r.needsConfirmation) throw new Error(`expected a proposal, got ${JSON.stringify(r)}`);
    expect(r.preview.summary).toBe("Add a new family with Nia Okafor as its first adult.");
    expect(r.preview.lines).toEqual([
      { label: "First adult", value: "Nia Okafor" },
      { label: "Mobile", value: "+15125550188" },
      { label: "Email", value: "nia@example.org" },
      { label: "Street", value: "12 River Road" },
    ]);
    expect(r.preview.warnings).toEqual(["The person has said that none of the similar families is the same one."]);
    expect(r.confirmText).toBe("Yes, add this family");
    expect(db.rpcCalls.some((c) => c.fn === "add_household")).toBe(false);
    const done = await confirmProposal(ctx, r.proposalId, r.inputHash);
    expect(done).toMatchObject({ ok: true, data: { created: true, householdId: NEW_HH } });
    expect(db.rpcCalls.filter((c) => c.fn === "add_household")).toHaveLength(1);
  });

  it("goes straight to the card when no family is alike", async () => {
    const { ctx } = world({ via: "assistant" });
    const r = await runCommand(ctx, "people.add_household", input);
    if (!r.ok || !r.needsConfirmation) throw new Error(`expected a proposal, got ${JSON.stringify(r)}`);
    expect(r.preview.warnings).toEqual(["No family with this mobile, email or name was found."]);
  });
});
