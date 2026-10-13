import { beforeEach, describe, expect, it, vi } from "vitest";

// What the person slide-over writes with: the inline "Add person" action (the same people.add_person command as the classic drawer),
// the two ID functions that are the one seam slice 6 replaces, and the click-to-edit action when the person is in no family or a
// privacy choice is changed. The session and the database are stand-ins.
const stub = vi.hoisted(() => ({
  session: null as unknown,
  refusal: null as string | null,
  asked: [] as { key: string; doing: string }[],
  activity: [] as { key: string; entity?: unknown }[],
  idCalls: [] as { fn: string; fd: FormData }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/activity/with-activity", () => ({
  withActivity: async (key: string, fn: () => Promise<unknown>, opts?: { entityFrom?: unknown }) => {
    stub.activity.push({ key, entity: opts?.entityFrom });
    return fn();
  },
}));
vi.mock("@/lib/session", () => ({
  authorizeAction: vi.fn(async (key: string, doing: string) => {
    stub.asked.push({ key, doing });
    return stub.refusal ? { ok: false, error: stub.refusal } : { ok: true, session: stub.session };
  }),
  authorizeActionWhere: vi.fn(),
  loadSession: vi.fn(async () => ({ status: "ok", session: stub.session })),
  dbWithReason: vi.fn(async () => (stub.session as { db: unknown }).db),
}));
vi.mock("@/app/(app)/identifiers/actions", () => ({
  addIdentifierAction: vi.fn(async (_prev: unknown, fd: FormData) => {
    stub.idCalls.push({ fn: "add", fd });
    return { ok: true, message: 'Added Community member ID "0484".' };
  }),
  retireIdentifierAction: vi.fn(async (_prev: unknown, fd: FormData) => {
    stub.idCalls.push({ fn: "retire", fd });
    return { ok: true, message: 'Retired "20417". It stays in the history.' };
  }),
}));

import { addPersonAction } from "@/app/(app)/households/actions";
import { savePersonFieldsAction } from "@/app/(app)/households/[id]/inline-actions";
import { addPersonInlineAction } from "@/app/(app)/households/[id]/slideover-actions";
import { addPersonId, retirePersonId } from "@/app/(app)/identifiers/person-id-seam";
import { CONFLICT_PREFIX } from "@/lib/people-v2/inline-edit";

import { ID, peopleDb, staffSession } from "./commands/people-fixture";

type Tables = Record<string, Record<string, unknown>[]>;

function setup(over: { permissions?: string[]; tables?: Tables } = {}) {
  const { db, tables } = peopleDb();
  for (const [t, rows] of Object.entries(over.tables ?? {})) tables[t] = rows;
  stub.session = staffSession(db, over.permissions);
  stub.refusal = null;
  stub.asked = [];
  stub.activity = [];
  stub.idCalls = [];
  return { db, tables };
}
const person = (tables: Tables, id: string) => tables.people.find((p) => p.id === id)!;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("addPersonInlineAction", () => {
  const ok = { household_id: ID.hhShah, first_name: "Meera", last_name: "Shah", role: "parent", date_of_birth: "02/02/1955" };

  it("adds the person through the same command as the classic drawer, and answers the same", async () => {
    const { db } = setup();
    const inline = await addPersonInlineAction(ok);
    expect(inline).toEqual({ ok: true, message: "Meera Shah added to the household · audit logged", personId: "b0000000-0000-4000-8000-0000000000aa" });
    expect(db.rpcCalls.find((c) => c.fn === "staff_add_person")?.args).toMatchObject({ p_household: ID.hhShah, p_first: "Meera", p_last: "Shah", p_role: "parent", p_dob: "1955-02-02" });
    expect(stub.asked).toEqual([{ key: "householdsEdit", doing: "add the person" }]);

    setup();
    const classic = await addPersonAction(null, form({ ...ok, gender: "", email: "", phone_e164: "" }));
    expect(classic).toMatchObject({ ok: true, message: inline.ok ? inline.message : "", data: { personId: "b0000000-0000-4000-8000-0000000000aa" } });
  });

  it("adds a child without any contact detail, and an adult with them", async () => {
    const { db } = setup();
    await addPersonInlineAction({ household_id: ID.hhShah, first_name: "Zara", last_name: "Shah", role: "child", date_of_birth: "07/21/2015" });
    expect(db.rpcCalls.find((c) => c.fn === "staff_add_person")?.args).toMatchObject({ p_role: "child", p_dob: "2015-07-21" });
    expect(db.rpcCalls.find((c) => c.fn === "staff_add_person")?.args.p_phone).toBeUndefined();
    const adult = setup();
    await addPersonInlineAction({ ...ok, phone_e164: "(713) 555-0142", email: "Meera@Example.org" });
    expect(adult.db.rpcCalls.find((c) => c.fn === "staff_add_person")?.args).toMatchObject({ p_phone: "+17135550142", p_email: "meera@example.org" });
  });

  it("takes a name in any script", async () => {
    const { db } = setup();
    expect(await addPersonInlineAction({ ...ok, first_name: "美咲", last_name: "田中" })).toMatchObject({ ok: true });
    expect(db.rpcCalls.find((c) => c.fn === "staff_add_person")?.args).toMatchObject({ p_first: "美咲", p_last: "田中" });
  });

  it("answers an unfinished request with the same sentences as the classic action", async () => {
    setup();
    expect(await addPersonInlineAction({ ...ok, household_id: "" })).toEqual({ ok: false, error: "Could not add the person — the family was not found." });
    expect(await addPersonInlineAction({ ...ok, role: "primary" })).toEqual({ ok: false, error: "Could not add the person — choose their relationship to the family." });
    expect(await addPersonInlineAction({ ...ok, last_name: "" })).toEqual({ ok: false, error: "Could not add the person — first and last name are required." });
    expect(await addPersonInlineAction({ ...ok, email: "nope" })).toEqual({ ok: false, error: "Could not add the person — that email address does not look right." });
    expect(await addPersonInlineAction({ ...ok, first_name: "x".repeat(300) })).toEqual({ ok: false, error: "Could not add the person — a detail was not understood." });
  });

  it("says plainly when the role may not add people, and never writes", async () => {
    const { db } = setup();
    stub.refusal = "Could not add the person — you don't have permission (needs people.manage).";
    expect(await addPersonInlineAction(ok)).toEqual({ ok: false, error: stub.refusal });
    expect(db.rpcCalls.some((c) => c.fn === "staff_add_person")).toBe(false);
  });

  it("explains a database refusal in words, and logs the technical detail", async () => {
    setup();
    const failing = peopleDb({ failRpc: { staff_add_person: { code: "P0001", message: "That household was merged into another one" } } });
    stub.session = staffSession(failing.db);
    const r = await addPersonInlineAction(ok);
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toContain("Could not add the person");
    expect((r as { error: string }).error).toContain("That household was merged into another one");
  });
});

describe("the IDs seam", () => {
  const input = { personId: ID.priya, householdId: ID.hhShah, kind: "org_member", system: "org_register", value: "417", label: "Member card" };

  it("adds an ID through the existing identifier action, for this person, refreshing the family page", async () => {
    setup();
    expect(await addPersonId(input)).toEqual({ ok: true, message: 'Added Community member ID "0484".' });
    const fd = stub.idCalls[0].fd;
    expect(Object.fromEntries(fd.entries())).toEqual({
      kind: "org_member",
      target: `person:${ID.priya}`,
      value: "417",
      system: "org_register",
      label: "Member card",
      returnPath: `/households/${ID.hhShah}`,
    });
  });

  it("refreshes the person's own page when they are in no family", async () => {
    setup();
    await addPersonId({ ...input, householdId: null });
    expect(stub.idCalls[0].fd.get("returnPath")).toBe(`/people/${ID.priya}`);
  });

  it("retires an ID through the existing action, carrying the reason it now needs", async () => {
    setup();
    const id = "e0000000-0000-4000-8000-0000000000e1";
    expect(await retirePersonId({ id, personId: ID.priya, householdId: ID.hhShah, reason: "  Moved to a new system  " })).toEqual({ ok: true, message: 'Retired "20417". It stays in the history.' });
    expect(Object.fromEntries(stub.idCalls[0].fd.entries())).toEqual({ id, reason: "Moved to a new system", returnPath: `/households/${ID.hhShah}` });
  });

  it("will not retire an ID without a reason, and says so before calling anything", async () => {
    setup();
    const id = "e0000000-0000-4000-8000-0000000000e1";
    const refused = { ok: false, error: "Could not retire the identifier — give a reason. It goes in the audit log." };
    expect(await retirePersonId({ id, personId: ID.priya, householdId: ID.hhShah, reason: "   " })).toEqual(refused);
    expect(await retirePersonId({ id, personId: ID.priya, householdId: ID.hhShah } as never)).toEqual(refused);
    expect(stub.idCalls).toEqual([]);
  });

  it("refuses something that is not a person or an ID before calling anything", async () => {
    setup();
    expect(await addPersonId({ ...input, personId: "nope" })).toEqual({ ok: false, error: "Could not add the identifier — the person was not found." });
    expect(await retirePersonId({ id: "nope", personId: ID.priya, householdId: null, reason: "x" })).toEqual({ ok: false, error: "Could not retire the identifier — it was not found." });
    expect(stub.idCalls).toEqual([]);
  });
});

describe("click-to-edit for the slide-over", () => {
  it("saves a detail for a person in no family (there is no household to name)", async () => {
    const { tables } = setup();
    const r = await savePersonFieldsAction({ personId: ID.priya, householdId: null, fields: { profession: "Doctor" }, expect: { profession: "Engineer" }, label: "Priya's profession" });
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(person(tables, ID.priya).profession).toBe("Doctor");
  });

  it("says a relationship belongs to a family when the person is in none, and writes nothing", async () => {
    const { tables } = setup();
    const r = await savePersonFieldsAction({ personId: ID.rahul, householdId: null, fields: { role: "parent" }, expect: { role: "spouse" }, label: "Rahul's relationship" });
    expect(r).toEqual({ ok: false, kind: "other", error: "Could not save Rahul's relationship — a relationship belongs to a family, and this person is in none." });
    expect(tables.household_members.find((m) => m.person_id === ID.rahul)?.role).toBe("spouse");
  });

  it("flips a privacy choice at once, with the value the person saw", async () => {
    const { tables } = setup();
    person(tables, ID.priya).photo_opt_in = false;
    const r = await savePersonFieldsAction({ personId: ID.priya, householdId: ID.hhShah, fields: { photo_opt_in: "on" }, expect: { photo_opt_in: "off" }, label: "Priya's photo consent" });
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(person(tables, ID.priya).photo_opt_in).toBe(true);
    expect(stub.activity).toEqual([{ key: "people.update_person", entity: { kind: "person", id: ID.priya } }]);
  });

  it("shows the new value of a privacy choice (on or off, not empty) when someone else changed it first", async () => {
    const { tables } = setup();
    person(tables, ID.priya).expertise_opt_in = true;
    const r = await savePersonFieldsAction({ personId: ID.priya, householdId: ID.hhShah, fields: { expertise_opt_in: "off" }, expect: { expertise_opt_in: "off" }, label: "Priya's expertise listing" });
    expect(r).toMatchObject({ ok: false, kind: "conflict", conflict: { theirs: { expertise_opt_in: "on" } } });
    expect((r as { error: string }).error.startsWith(CONFLICT_PREFIX)).toBe(true);
    expect(person(tables, ID.priya).expertise_opt_in).toBe(true);
  });

  it("saves the expertise headline as text", async () => {
    const { tables } = setup();
    const r = await savePersonFieldsAction({ personId: ID.priya, householdId: ID.hhShah, fields: { expertise_headline: "薬剤師" }, expect: { expertise_headline: "" }, label: "Priya's expertise" });
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(person(tables, ID.priya).expertise_headline).toBe("薬剤師");
  });
});
