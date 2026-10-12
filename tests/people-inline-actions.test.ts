import { beforeEach, describe, expect, it, vi } from "vitest";

// The Family page's click-to-edit calls two Server Actions. They are thin: check the shape, run the SAME commands the screens and Niva
// share (through runScreenCommand), and answer in the words the field shows. The session and the database are stand-ins.
const stub = vi.hoisted(() => ({
  session: null as unknown,
  refusal: null as string | null,
  asked: [] as { key: string; doing: string }[],
  activity: [] as { key: string; entity?: unknown }[],
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

import { saveHouseholdFieldsAction, savePersonFieldsAction } from "@/app/(app)/households/[id]/inline-actions";
import { CONFLICT_PREFIX } from "@/lib/people-v2/inline-edit";
import { dbWithReason } from "@/lib/session";

import { ID, peopleDb, staffSession } from "./commands/people-fixture";

type Tables = Record<string, Record<string, unknown>[]>;

function setup(over: { permissions?: string[]; tables?: Tables } = {}) {
  const { db, tables } = peopleDb();
  for (const [t, rows] of Object.entries(over.tables ?? {})) tables[t] = rows;
  stub.session = staffSession(db, over.permissions);
  stub.refusal = null;
  stub.asked = [];
  stub.activity = [];
  return { db, tables };
}

const person = (tables: Tables, id: string) => tables.people.find((p) => p.id === id)!;
const household = (tables: Tables, id: string) => tables.households.find((h) => h.id === id)!;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(dbWithReason).mockClear();
});

describe("savePersonFieldsAction", () => {
  it("saves a mobile the person saw, keeps the activity key and asks for the permission the screen asks for", async () => {
    const { tables } = setup();
    const r = await savePersonFieldsAction({
      personId: ID.priya,
      householdId: ID.hhShah,
      fields: { phone_e164: "+15125550188" },
      expect: { phone_e164: "+15125550101" },
      label: "Priya's mobile",
    });
    expect(r).toEqual({ ok: true, message: "Saved Priya's profile (mobile) · audit logged", changed: true });
    expect(person(tables, ID.priya).phone_e164).toBe("+15125550188");
    expect(stub.activity).toEqual([{ key: "people.update_person", entity: { kind: "person", id: ID.priya } }]);
    expect(stub.asked).toEqual([{ key: "householdsEdit", doing: "save Priya's mobile" }]);
  });

  it("says nothing was written when the value was already what the person asked for", async () => {
    setup();
    const r = await savePersonFieldsAction({ personId: ID.priya, householdId: ID.hhShah, fields: { profession: "Engineer" }, expect: { profession: "Engineer" }, label: "Priya's profession" });
    expect(r).toEqual({ ok: true, message: "No changes to save.", changed: false });
  });

  it("writes a name in another script with its reason carried to the audit log", async () => {
    const { tables } = setup();
    const r = await savePersonFieldsAction({
      personId: ID.priya,
      householdId: ID.hhShah,
      fields: { first_name: "Айгуль", last_name: "Сатпаева" },
      expect: { first_name: "Priya", last_name: "Shah" },
      reason: "Legal name change",
      label: "Priya's name",
    });
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(person(tables, ID.priya)).toMatchObject({ first_name: "Айгуль", last_name: "Сатпаева" });
    expect(vi.mocked(dbWithReason).mock.calls[0][1]).toBe("Legal name change");
  });

  it("changes a relationship in the household the page is about", async () => {
    const { tables } = setup();
    const r = await savePersonFieldsAction({ personId: ID.rahul, householdId: ID.hhShah, fields: { role: "parent" }, expect: { role: "spouse" }, label: "Rahul's relationship" });
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(tables.household_members.find((m) => m.person_id === ID.rahul)?.role).toBe("parent");
  });

  it("shows the new value, and who changed it when the person may read the audit log, when someone else got there first", async () => {
    const { tables } = setup({
      permissions: ["people.view", "people.manage", "audit.view"],
      tables: {
        audit_log: [
          {
            id: 1,
            center_id: "center-1",
            record_table: "people",
            record_id: ID.priya,
            occurred_at: "2026-10-12T10:00:00Z",
            actor_user_id: "user-priya",
            before: { phone_e164: "+15125550101" },
            after: { phone_e164: "+18325550199" },
          },
        ],
      },
    });
    person(tables, ID.priya).phone_e164 = "+18325550199";
    const r = await savePersonFieldsAction({ personId: ID.priya, householdId: ID.hhShah, fields: { phone_e164: "+15125550188" }, expect: { phone_e164: "+15125550101" }, label: "Priya's mobile" });
    expect(r).toMatchObject({ ok: false, kind: "conflict", conflict: { theirs: { phone_e164: "+18325550199" }, who: "Priya", at: "2026-10-12T10:00:00Z" } });
    expect((r as { error: string }).error.startsWith(CONFLICT_PREFIX)).toBe(true);
    expect(person(tables, ID.priya).phone_e164).toBe("+18325550199");
  });

  it("still shows the new value, without a name, for someone who cannot read the audit log", async () => {
    const { tables } = setup();
    person(tables, ID.priya).phone_e164 = "+18325550199";
    const r = await savePersonFieldsAction({ personId: ID.priya, householdId: ID.hhShah, fields: { phone_e164: "+15125550188" }, expect: { phone_e164: "+15125550101" }, label: "Priya's mobile" });
    expect(r).toMatchObject({ ok: false, kind: "conflict", conflict: { theirs: { phone_e164: "+18325550199" }, who: null, at: null } });
  });

  it("says plainly that a role without permission cannot change it, and never writes", async () => {
    const { tables } = setup();
    stub.refusal = "Could not save Priya's mobile — you don't have permission (needs people.manage).";
    const r = await savePersonFieldsAction({ personId: ID.priya, householdId: ID.hhShah, fields: { phone_e164: "+15125550188" }, expect: { phone_e164: "+15125550101" }, label: "Priya's mobile" });
    expect(r).toEqual({ ok: false, kind: "access", error: "You don't have access to this area. Priya's mobile was not changed." });
    expect(person(tables, ID.priya).phone_e164).toBe("+15125550101");
  });

  it("gives the command's own sentence when a value is wrong, and refuses a request that is not shaped right", async () => {
    setup();
    const bad = await savePersonFieldsAction({ personId: ID.priya, householdId: ID.hhShah, fields: { email: "priya@" }, expect: {}, label: "Priya's email" });
    expect(bad).toEqual({ ok: false, kind: "other", error: "Could not save the profile — That email address does not look right." });
    expect(await savePersonFieldsAction({ personId: "nope", householdId: ID.hhShah, fields: { email: "a@b.org" }, expect: {}, label: "Priya's email" })).toMatchObject({ ok: false, kind: "other" });
    // a detail the screen is not meant to send here
    expect(await savePersonFieldsAction({ personId: ID.priya, householdId: ID.hhShah, fields: { merged_into_id: ID.priya2 }, expect: {}, label: "Priya's record" })).toMatchObject({ ok: false, kind: "other" });
    expect(await savePersonFieldsAction({ personId: ID.priya, householdId: ID.hhShah, fields: {}, expect: {}, label: "x" })).toMatchObject({ ok: false });
  });

  it("works for a child's record on screen (a person's own hands)", async () => {
    const { tables } = setup();
    const r = await savePersonFieldsAction({ personId: ID.zoya, householdId: ID.hhShah, fields: { date_of_birth: "2018-06-06" }, expect: { date_of_birth: "2018-05-05" }, reason: "Verified from ID", label: "Zoya's birth date" });
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(person(tables, ID.zoya).date_of_birth).toBe("2018-06-06");
  });
});

describe("saveHouseholdFieldsAction", () => {
  it("saves the address block, with the values seen for each line", async () => {
    const { tables } = setup();
    const r = await saveHouseholdFieldsAction({ householdId: ID.hhShah, fields: { city: "Round Rock", postal_code: "78664" }, expect: { city: "Austin", postal_code: "73301" }, label: "the Shah household's address" });
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(household(tables, ID.hhShah)).toMatchObject({ city: "Round Rock", postal_code: "78664" });
    expect(stub.activity).toEqual([{ key: "people.update_household", entity: { kind: "household", id: ID.hhShah } }]);
  });

  it("flips a preference at once and checks it against what was seen", async () => {
    const { tables } = setup();
    household(tables, ID.hhShah).physical_mail_opt_in = true;
    const off = await saveHouseholdFieldsAction({ householdId: ID.hhShah, fields: { physical_mail_opt_in: "off" }, expect: { physical_mail_opt_in: "on" }, label: "the household's physical mail" });
    expect(off).toMatchObject({ ok: true, changed: true });
    expect(household(tables, ID.hhShah).physical_mail_opt_in).toBe(false);
    const stale = await saveHouseholdFieldsAction({ householdId: ID.hhShah, fields: { physical_mail_opt_in: "on" }, expect: { physical_mail_opt_in: "on" }, label: "the household's physical mail" });
    expect(stale).toMatchObject({ ok: false, kind: "conflict", conflict: { theirs: { physical_mail_opt_in: "off" } } });
  });

  it("saves the household's note and the household's name", async () => {
    const { tables } = setup();
    expect(await saveHouseholdFieldsAction({ householdId: ID.hhShah, fields: { notes: "Prefers evening calls." }, expect: { notes: "" }, label: "the household's notes" })).toMatchObject({ ok: true, changed: true });
    expect(household(tables, ID.hhShah).notes).toBe("Prefers evening calls.");
    expect(
      await saveHouseholdFieldsAction({ householdId: ID.hhShah, fields: { display_name: "田中・Haddad の家" }, expect: { display_name: "Shah, Priya, Rahul & Zoya" }, reason: "Correction", label: "the household's name" }),
    ).toMatchObject({ ok: true });
    expect(household(tables, ID.hhShah).display_name).toBe("田中・Haddad の家");
  });

  it("refuses an empty name in the words the classic form uses, and a field it does not edit", async () => {
    setup();
    expect(await saveHouseholdFieldsAction({ householdId: ID.hhShah, fields: { display_name: "  " }, expect: {}, label: "the household's name" })).toEqual({
      ok: false,
      kind: "other",
      error: "Could not save the household — Household name is required.",
    });
    expect(await saveHouseholdFieldsAction({ householdId: ID.hhShah, fields: { tier: "life" }, expect: {}, label: "x" })).toMatchObject({ ok: false, kind: "other" });
  });
});
