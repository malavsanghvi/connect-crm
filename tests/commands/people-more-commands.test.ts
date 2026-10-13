import { beforeEach, describe, expect, it, vi } from "vitest";

// The People "More" commands (slice 5): mark deceased, set primary, add and retire an identifier. What is checked: the catalog shape,
// that the two screen-only ones are never Niva's, the sentences each refusal gives (they are the screens' old sentences), the
// rows and database calls each makes, and that Niva is given no child's name. A non-faith community and names in Chinese and
// Arabic run through the same paths.

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ dbWithReason: vi.fn() }));

import { revalidatePath } from "next/cache";

import { CATALOG } from "@/lib/commands/catalog";
import { PEOPLE_COMMANDS } from "@/lib/commands/catalog/people";
import { addIdentifier } from "@/lib/commands/catalog/people/add-identifier";
import { markDeceased } from "@/lib/commands/catalog/people/mark-deceased";
import { retireIdentifier } from "@/lib/commands/catalog/people/retire-identifier";
import { setPrimary } from "@/lib/commands/catalog/people/set-primary";
import { commandAvailability } from "@/lib/commands/enabled";
import { confirmProposal, runCommand } from "@/lib/commands/run";
import { type CommandRunResult } from "@/lib/commands/types";
import { dbWithReason } from "@/lib/session";

import { fakeSession } from "./helpers";
import { ID, STAFF, peopleContext, switchedOn } from "./people-fixture";
import { MING, moreDb, neighbourhoodCenter } from "./people-more-fixture";

const KEYS = ["people.mark_deceased", "people.set_primary", "people.add_identifier", "people.retire_identifier"];
const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CHILD_WORDS = /Zoya|Aarav|2018-05-05/;

function world(opts: { via?: "screen" | "assistant"; permissions?: string[]; on?: boolean; community?: "faith" | "neighbourhood"; rpc?: Record<string, unknown>; failRpc?: Record<string, { code?: string; message: string }>; insertError?: { code?: string; message: string } } = {}) {
  const w = moreDb({ rpc: opts.rpc, failRpc: opts.failRpc, insertError: opts.insertError });
  vi.mocked(dbWithReason).mockResolvedValue(w.db as never);
  const base = opts.community === "neighbourhood" ? neighbourhoodCenter() : fakeSession().center;
  const center = { ...base, rules: { ...(base.rules as object), ...(opts.on === false ? {} : switchedOn(KEYS)) } };
  const ctx = peopleContext({ via: opts.via ?? "screen", db: w.db, permissions: opts.permissions, session: { center } });
  return { ...w, ctx };
}

const failed = (r: CommandRunResult): string => {
  if (r.ok) throw new Error(`expected a failure, got ${JSON.stringify(r)}`);
  return r.error;
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(dbWithReason).mockReset();
  vi.mocked(revalidatePath).mockClear();
});

describe("the four commands in the catalog", () => {
  const by = (key: string) => PEOPLE_COMMANDS.find((c) => c.key === key)!;

  it("are in the shared catalog, confirm level, off for Niva by default, each covering one Server Action", () => {
    for (const key of KEYS) {
      const c = by(key);
      expect(CATALOG, key).toContain(c);
      expect(c.level).toBe("confirm");
      expect(c.enabledByDefault).toBe(false);
      expect(c.module).toBe("people");
      expect(c.preview).toBeTypeOf("function");
      expect(c.covers).toHaveLength(1);
      expect(c.description).not.toMatch(/\bbid\b/i);
    }
  });

  it("keep a death and the primary member to the person's own screen; the identifier ones may be switched on for Niva", () => {
    expect(markDeceased.screenOnly).toBe(true);
    expect(setPrimary.screenOnly).toBe(true);
    expect(addIdentifier.screenOnly).toBeUndefined();
    expect(retireIdentifier.screenOnly).toBeUndefined();
    // Gates as the screens had them: people.manage for the first two; the identifiers follow the kind (people.manage or giving.manage).
    expect(markDeceased.permission).toBe("householdsEdit");
    expect(setPrimary.permission).toBe("householdsEdit");
    expect(addIdentifier.permission).toBe("identifiersManage");
    expect(retireIdentifier.permission).toBe("identifiersManage");
  });

  it("a death and a change of primary member are refused to Niva even when a community has ticked everything", () => {
    const session = fakeSession({ permissions: STAFF, center: { ...fakeSession().center, rules: switchedOn(KEYS) } });
    for (const c of [markDeceased, setPrimary]) {
      expect(commandAvailability(c, session, "screen")).toEqual({ ok: true });
      expect(commandAvailability(c, session, "palette")).toMatchObject({ ok: false, code: "screen_only" });
      expect(commandAvailability(c, session, "assistant")).toMatchObject({ ok: false, code: "screen_only" });
    }
    for (const c of [addIdentifier, retireIdentifier]) expect(commandAvailability(c, session, "assistant")).toEqual({ ok: true });
  });

  it("are off for Niva until the community ticks them, and need the permission of the screen", async () => {
    const off = world({ via: "assistant", on: false }).ctx;
    for (const key of ["people.add_identifier", "people.retire_identifier"]) {
      expect(await runCommand(off, key, {})).toMatchObject({ ok: false, code: "switched_off" });
    }
    const viewOnly = world({ via: "assistant", permissions: ["people.view"] }).ctx;
    for (const key of KEYS) expect(await runCommand(viewOnly, key, {})).toMatchObject({ ok: false, code: expect.stringMatching(/no_access|screen_only/) });
  });
});

describe("people.mark_deceased", () => {
  const input = { person_id: ID.rahul, deceased_on: "2026-10-01", reason: "  His son called the office  ", confirmed: true };

  it("shows who and when, with the household card, and nothing that is an id", async () => {
    const { ctx } = world();
    const pv = await markDeceased.preview!(ctx, input);
    expect(pv.summary).toBe("Record that Rahul Shah passed away on 2026-10-01.");
    expect(pv.households?.[0]).toMatchObject({ household_number: "H-1001", adults: ["Priya Shah", "Rahul Shah"] });
    expect(JSON.stringify(pv)).not.toMatch(CHILD_WORDS);
    expect(pv.summary).not.toMatch(UUID_ANYWHERE);
  });

  it("records it with the reason on the audit row, and says so as the screen always did", async () => {
    const { ctx, db } = world();
    const r = await markDeceased.execute!(ctx, input);
    expect(r).toEqual({ ok: true, data: undefined, message: "Rahul Shah is recorded as deceased · audit logged." });
    expect(db.rpcCalls.find((c) => c.fn === "mark_person_deceased")?.args).toEqual({ p_person: ID.rahul, p_deceased_on: "2026-10-01", p_note: "", p_reason: "His son called the office" });
    expect(dbWithReason).toHaveBeenCalledWith(expect.anything(), "His son called the office");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(`/households/${ID.hhShah}`, "layout");
  });

  it("tells the memberships, messages and new-primary prompts the database reports", async () => {
    const { ctx } = world({ rpc: { mark_person_deceased: { ended_memberships: 1, suppressed_messages: 2, needs_new_primary: [{ household_id: ID.hhShah, name: "the Shah family", living_members: 2 }] } } });
    const r = await markDeceased.execute!(ctx, { ...input, note: "Date approximate" });
    expect(r).toMatchObject({ ok: true, message: "Rahul Shah is recorded as deceased · 1 membership ended · 2 queued messages stopped · audit logged. Choose a new primary member for the Shah family." });
  });

  it("works for a name in Chinese in a community that is not a faith community", async () => {
    const { ctx, db } = world({ community: "neighbourhood" });
    const r = await markDeceased.execute!(ctx, { person_id: MING.person, deceased_on: "2026-09-30", reason: "Family told the office", confirmed: true });
    expect(r).toEqual({ ok: true, data: undefined, message: "明 李 is recorded as deceased · audit logged." });
    expect(db.rpcCalls.find((c) => c.fn === "mark_person_deceased")?.args).toMatchObject({ p_person: MING.person });
  });

  it("gives the form's sentences for each mistake, using the birth date on the record", async () => {
    const { ctx, db } = world();
    const says = (over: Record<string, unknown>) => expect(markDeceased.execute!(ctx, { ...input, ...over } as never));
    await says({ deceased_on: "" }).rejects.toThrow("Could not mark Rahul Shah as deceased — enter the date of death (an approximate date is fine; say so in the note).");
    await says({ deceased_on: "2026-13-40" }).rejects.toThrow("Could not mark Rahul Shah as deceased — the date of death is not a valid date.");
    await says({ deceased_on: "2026-10-11" }).rejects.toThrow("Could not mark Rahul Shah as deceased — the date of death cannot be in the future.");
    await says({ deceased_on: "1980-01-01" }).rejects.toThrow("Could not mark Rahul Shah as deceased — the date of death is before their date of birth.");
    await says({ reason: "  " }).rejects.toThrow("Could not mark Rahul Shah as deceased — give a reason (for example, who told the office) — it goes in the audit log.");
    await says({ confirmed: undefined }).rejects.toThrow("Could not mark Rahul Shah as deceased — tick the box to confirm.");
    await says({ confirmed: false }).rejects.toThrow("Could not mark Rahul Shah as deceased — tick the box to confirm.");
    await says({ note: "x".repeat(2001) }).rejects.toThrow("Could not mark Rahul Shah as deceased — the reason or note is too long.");
    await says({ person_id: "b0000000-0000-4000-8000-0000000000ff" }).rejects.toThrow("Could not mark as deceased — the person was not found.");
    expect(db.rpcCalls.some((c) => c.fn === "mark_person_deceased")).toBe(false);
  });

  it("hands a database refusal to the runner as a step named in plain words", async () => {
    const { ctx } = world({ failRpc: { mark_person_deceased: { code: "42501", message: "Marking a person as deceased needs the people.manage permission." } } });
    await expect(markDeceased.execute!(ctx, input)).rejects.toMatchObject({ doing: "mark Rahul Shah as deceased", dbError: { code: "42501" } });
  });
});

describe("people.set_primary", () => {
  const input = { household_id: ID.hhShah, person_id: ID.rahul, reason: "  Priya asked  " };

  it("shows the household card and who becomes primary", async () => {
    const { ctx } = world();
    const pv = await setPrimary.preview!(ctx, input);
    expect(pv.summary).toBe("Make Rahul Shah the primary member of the household.");
    expect(pv.lines.find((l) => l.label === "Household")?.value).toContain("H-1001");
    expect(JSON.stringify(pv)).not.toMatch(CHILD_WORDS);
  });

  it("moves the flag with the reason on the audit row", async () => {
    const { ctx, db } = world();
    const r = await setPrimary.execute!(ctx, input);
    expect(r).toEqual({ ok: true, data: undefined, message: "The primary member is changed · audit logged. Pledges, payments and statements stay with the household." });
    expect(db.rpcCalls.find((c) => c.fn === "set_household_primary")?.args).toEqual({ p_household: ID.hhShah, p_person: ID.rahul, p_reason: "Priya asked" });
    expect(dbWithReason).toHaveBeenCalledWith(expect.anything(), "Priya asked");
  });

  it("asks for a reason, in the old words, before it calls the database", async () => {
    const { ctx, db } = world();
    await expect(setPrimary.execute!(ctx, { ...input, reason: "   " })).rejects.toThrow("Could not change the primary member — give a reason. It goes in the audit log.");
    expect(db.rpcCalls.some((c) => c.fn === "set_household_primary")).toBe(false);
  });
});

describe("people.add_identifier", () => {
  const input = { kind: "crm", target_kind: "household", target_id: ID.hhShah, value: " N-1001 ", system: "NEON", label: "Neon account id" };

  it("adds the row exactly as the panel did, and says so", async () => {
    const { ctx, inserted } = world();
    const r = await addIdentifier.execute!(ctx, input);
    expect(r).toEqual({ ok: true, data: undefined, message: 'Added Legacy CRM id "N-1001".' });
    expect(inserted).toEqual([
      { center_id: "center-1", household_id: ID.hhShah, person_id: null, kind: "crm", system: "neon", value: "N-1001", label: "Neon account id", notes: null, source: "manual", valid_from: "2026-10-10", created_by: "user-1" },
    ]);
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(`/households/${ID.hhShah}`, "layout");
  });

  it("keeps a number at the digits the organization uses, with the organization's own word for it (a community that is not a faith community)", async () => {
    const { ctx, inserted } = world({ community: "neighbourhood" });
    const r = await addIdentifier.execute!(ctx, { kind: "org_member", target_kind: "person", target_id: MING.second, value: "417", system: "riverside_register" });
    expect(r).toEqual({ ok: true, data: undefined, message: 'Added Member number "00417".' });
    expect(inserted[0]).toMatchObject({ person_id: MING.second, household_id: null, value: "00417", system: "riverside_register" });
  });

  it("gives the panel's sentences, in its order, for each mistake", async () => {
    const { ctx, inserted } = world();
    const says = (over: Record<string, unknown>) => expect(addIdentifier.execute!(ctx, { ...input, ...over } as never));
    await says({ kind: "nope" }).rejects.toThrow("Could not add the identifier — choose what kind of identifier it is.");
    await says({ value: "  " }).rejects.toThrow("Could not add the Legacy CRM id — enter the value exactly as the other system shows it.");
    await says({ value: "x".repeat(201) }).rejects.toThrow("Could not add the identifier — the value is longer than 200 characters.");
    await says({ system: "" }).rejects.toThrow("Could not add the identifier — say which system it comes from (for example neon or quickbooks).");
    await says({ system: "not allowed!" }).rejects.toThrow("Could not add the identifier — the system name may only use letters, numbers, dot, dash and underscore.");
    await says({ target_id: "nope" }).rejects.toThrow("Could not add the identifier — choose who it belongs to.");
    await says({ target_kind: "pledge" }).rejects.toThrow("Could not add the identifier — choose who it belongs to.");
    await says({ kind: "org_member" }).rejects.toThrow('Could not add the Organization member ID — it belongs to a person, not the household. Choose a member under "Belongs to".');
    await says({ kind: "org_household", target_kind: "person", target_id: ID.rahul }).rejects.toThrow(
      'Could not add the Organization household ID — it belongs to the household, not a person. Choose the household under "Belongs to".',
    );
    expect(inserted).toEqual([]);
  });

  it("follows the kind: the finance kinds need giving.manage, the people kinds people.manage", async () => {
    const people = world({ permissions: ["people.view", "people.manage"] }).ctx;
    await expect(addIdentifier.execute!(people, { ...input, kind: "accounting", system: "quickbooks" })).rejects.toThrow(
      "Could not add the Accounting (QuickBooks) customer — you don't have permission (needs giving.manage).",
    );
    const finance = world({ permissions: ["giving.view", "giving.manage"] });
    await expect(addIdentifier.execute!(finance.ctx, input)).rejects.toThrow("Could not add the Legacy CRM id — you don't have permission (needs people.manage).");
    const r = await addIdentifier.execute!(finance.ctx, { ...input, kind: "accounting", system: "quickbooks", value: "QB-8" });
    expect(r).toMatchObject({ ok: true, message: 'Added Accounting (QuickBooks) customer "QB-8".' });
    expect(finance.inserted).toHaveLength(1);
    // The command is offered to the people who can add at least one kind.
    const session = (permissions: string[]) => fakeSession({ permissions });
    expect(commandAvailability(addIdentifier, session(["people.manage"]), "screen")).toEqual({ ok: true });
    expect(commandAvailability(addIdentifier, session(["giving.manage"]), "screen")).toEqual({ ok: true });
    expect(commandAvailability(addIdentifier, session(["people.view"]), "screen")).toMatchObject({ ok: false, code: "no_access" });
  });

  it("names who already holds a number to the person, never to Niva (the holder may be a child)", async () => {
    const holder = { rpc: { resolve_identifier: [{ kind: "crm", display_name: "Aarav Patel" }] }, insertError: { code: "23505", message: "duplicate key" } };
    const screen = world({ ...holder });
    await expect(addIdentifier.execute!(screen.ctx, input)).rejects.toThrow('Could not add the Legacy CRM id — "N-1001" (neon) is already assigned to Aarav Patel. Retire it there first if it moved.');
    const niva = world({ ...holder, via: "assistant" });
    const err = await addIdentifier.execute!(niva.ctx, input).catch((e: Error) => e);
    expect((err as Error).message).toBe('Could not add the Legacy CRM id — "N-1001" (neon) is already assigned to another record. Retire it there first if it moved.');
  });

  it("explains any other database failure in plain words", async () => {
    const { ctx } = world({ insertError: { code: "42501", message: "new row violates row-level security policy" } });
    await expect(addIdentifier.execute!(ctx, input)).rejects.toMatchObject({ doing: "add the Legacy CRM id" });
  });

  it("asks Niva's person to confirm first, with the household card, and adds nothing until then", async () => {
    const { ctx, inserted } = world({ via: "assistant" });
    const r = await runCommand(ctx, "people.add_identifier", input);
    expect(r).toMatchObject({ ok: true, needsConfirmation: true });
    if (!r.ok || !r.needsConfirmation) throw new Error("expected a proposal");
    expect(r.preview.summary).toBe('Add the Legacy CRM id "N-1001" (neon).');
    expect(r.preview.households?.[0]).toMatchObject({ household_number: "H-1001" });
    expect(JSON.stringify(r)).not.toMatch(CHILD_WORDS);
    expect(inserted).toEqual([]);
    const done = await confirmProposal(ctx, r.proposalId, r.inputHash);
    expect(done).toMatchObject({ ok: true });
    expect(inserted).toHaveLength(1);
  });
});

describe("people.retire_identifier", () => {
  const input = { identifier_id: ID.extNikhil, reason: "  Moved to a new system  " };

  it("retires it from yesterday, with the reason on the audit row, and says so as the panel did", async () => {
    const { ctx, db } = world();
    const r = await retireIdentifier.execute!(ctx, input);
    expect(r).toEqual({ ok: true, data: undefined, message: 'Retired "N-77". It stays in the history.' });
    expect(db.calls.filter((c) => c.table === "external_ids" && c.op === "update")).toEqual([{ table: "external_ids", op: "update", patch: { valid_to: "2026-10-09" }, ids: [ID.extNikhil] }]);
    expect(dbWithReason).toHaveBeenCalledWith(expect.anything(), "Moved to a new system");
  });

  it("requires a reason (the one change from the old Retire button), before it reads or writes anything", async () => {
    const { ctx, db } = world();
    await expect(retireIdentifier.execute!(ctx, { ...input, reason: "  " })).rejects.toThrow("Could not retire the identifier — give a reason. It goes in the audit log.");
    expect(db.calls).toEqual([]);
    expect(dbWithReason).not.toHaveBeenCalled();
  });

  it("gives the panel's sentence for an identifier that is gone", async () => {
    const { ctx } = world();
    await expect(retireIdentifier.execute!(ctx, { ...input, identifier_id: "ee000000-0000-4000-8000-0000000000ff" })).rejects.toThrow("Could not retire the identifier — it was not found, or you can't see it.");
  });

  it("refuses the kind a person may not change, and an identifier that is already retired", async () => {
    const noFinance = world({ permissions: ["people.view", "people.manage"] });
    await expect(retireIdentifier.execute!(noFinance.ctx, { ...input, identifier_id: ID.extQb })).rejects.toThrow("Could not retire the Accounting (QuickBooks) customer — you don't have permission.");
    const retired = world();
    retired.tables.external_ids.find((x) => x.id === ID.extNikhil)!.valid_to = "2026-01-01";
    await expect(retireIdentifier.execute!(retired.ctx, { ...input, identifier_id: ID.extNikhil })).rejects.toThrow('The Legacy CRM id "N-77" is already retired.');
  });

  it("explains a refusal by the database when nothing was changed", async () => {
    const { ctx, db } = world({ permissions: ["people.view", "people.manage", "giving.manage"] });
    const real = db.from.bind(db) as unknown as (t: string) => unknown;
    vi.mocked(dbWithReason).mockResolvedValue({ ...db, from: (t: string) => (t === "external_ids" ? { update: () => ({ eq: () => ({ is: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) }) }) } : real(t)) } as never);
    await expect(retireIdentifier.execute!(ctx, { ...input, identifier_id: ID.extQb })).rejects.toThrow("Could not retire the Accounting (QuickBooks) customer — no change was saved (you may not have permission).");
  });

  it("works for the number of a person with a Chinese name", async () => {
    const { ctx } = world({ community: "neighbourhood" });
    const r = await retireIdentifier.execute!(ctx, { identifier_id: MING.identifier, reason: "Left the association" });
    expect(r).toEqual({ ok: true, data: undefined, message: 'Retired "00021". It stays in the history.' });
  });

  it("shows Niva's person what is retired and whose it is, without a child's name", async () => {
    const { ctx } = world({ via: "assistant" });
    const r = await runCommand(ctx, "people.retire_identifier", { identifier_id: ID.extNikhil, reason: "Moved" });
    if (!r.ok || !r.needsConfirmation) throw new Error(`expected a proposal, got ${JSON.stringify(r)}`);
    expect(r.preview.summary).toBe('Retire the Legacy CRM id "N-77".');
    expect(r.preview.households?.[0]).toMatchObject({ household_number: "H-1002" });
    expect(JSON.stringify(r)).not.toMatch(CHILD_WORDS);
    expect(failed(await runCommand(ctx, "people.retire_identifier", { identifier_id: ID.extAarav, reason: "Moved" }))).toBe("Niva does not work with children's records. Please do this on the People screen.");
  });
});
