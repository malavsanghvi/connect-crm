import { beforeEach, describe, expect, it, vi } from "vitest";

// The four People Server Actions that became commands in slice 5 (mark deceased, set primary, add and retire an identifier) answer the
// screen exactly as they did before: same ActionResult, same sentences, the permission asked with the same wording. The one change is
// that retiring an identifier now needs a reason. The session and the database are stand-ins.
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
  dbWithReason: vi.fn(async () => (stub.session as { db: unknown }).db),
}));

import { revalidatePath } from "next/cache";

import { addIdentifierAction, retireIdentifierAction } from "@/app/(app)/identifiers/actions";
import { markDeceasedAction, setHouseholdPrimaryAction } from "@/app/(app)/people/deceased-actions";
import { dbWithReason } from "@/lib/session";

import { ID, staffSession } from "./commands/people-fixture";
import { moreDb } from "./commands/people-more-fixture";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

function setup(over: Parameters<typeof moreDb>[0] = {}, permissions?: string[]) {
  const w = moreDb(over);
  stub.session = staffSession(w.db, permissions);
  stub.refusal = null;
  stub.asked = [];
  stub.activity = [];
  return w;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(dbWithReason).mockClear();
  vi.mocked(revalidatePath).mockClear();
});

describe("markDeceasedAction", () => {
  const ok = { id: ID.rahul, name: "Rahul Shah", date_of_birth: "1982-07-19", household_ids: ID.hhShah, deceased_on: "2026-10-01", note: "", reason: "His son called the office", confirm: "on" };

  it("records it and says so, asking for the same permission and keeping the audit reason", async () => {
    const { db } = setup();
    const r = await markDeceasedAction(null, form(ok));
    expect(r).toEqual({ ok: true, message: "Rahul Shah is recorded as deceased · audit logged." });
    expect(db.rpcCalls.find((c) => c.fn === "mark_person_deceased")?.args).toEqual({ p_person: ID.rahul, p_deceased_on: "2026-10-01", p_note: "", p_reason: "His son called the office" });
    expect(dbWithReason).toHaveBeenCalledWith(expect.anything(), "His son called the office");
    expect(stub.asked).toEqual([{ key: "householdsEdit", doing: "mark as deceased" }]);
    expect(stub.activity).toEqual([{ key: "people.mark_deceased", entity: { kind: "person", id: ID.rahul } }]);
  });

  it("answers an unfinished form, and a refusal, with the same sentences", async () => {
    setup();
    expect(await markDeceasedAction(null, form({ ...ok, id: "nope" }))).toEqual({ ok: false, error: "Could not mark as deceased — the person was not found." });
    expect(await markDeceasedAction(null, form({ ...ok, deceased_on: "" }))).toEqual({
      ok: false,
      error: "Could not mark Rahul Shah as deceased — enter the date of death (an approximate date is fine; say so in the note).",
    });
    expect(await markDeceasedAction(null, form({ ...ok, deceased_on: "2999-01-01" }))).toEqual({ ok: false, error: "Could not mark Rahul Shah as deceased — the date of death cannot be in the future." });
    expect(await markDeceasedAction(null, form({ ...ok, deceased_on: "1980-01-01" }))).toEqual({ ok: false, error: "Could not mark Rahul Shah as deceased — the date of death is before their date of birth." });
    expect(await markDeceasedAction(null, form({ ...ok, reason: " " }))).toEqual({
      ok: false,
      error: "Could not mark Rahul Shah as deceased — give a reason (for example, who told the office) — it goes in the audit log.",
    });
    const { confirm: _confirm, ...unticked } = ok;
    void _confirm;
    expect(await markDeceasedAction(null, form(unticked))).toEqual({ ok: false, error: "Could not mark Rahul Shah as deceased — tick the box to confirm." });
    stub.refusal = "Could not mark as deceased — you don't have permission (needs people.manage).";
    expect(await markDeceasedAction(null, form(ok))).toEqual({ ok: false, error: stub.refusal });
  });

  it("explains a database refusal in the old words, and passes on a request for a fresh 2FA check", async () => {
    setup({ failRpc: { mark_person_deceased: { code: "P0001", message: "That person is already recorded as deceased." } } });
    expect(await markDeceasedAction(null, form(ok))).toEqual({ ok: false, error: "Could not mark Rahul Shah as deceased — That person is already recorded as deceased." });
    setup({ failRpc: { mark_person_deceased: { code: "CCSTP", message: "This needs a fresh 2FA check" } } });
    expect(await markDeceasedAction(null, form(ok))).toMatchObject({ ok: false, stepUp: true });
  });
});

describe("setHouseholdPrimaryAction", () => {
  const ok = { household_id: ID.hhShah, person_id: ID.rahul, reason: "  Priya passed away  " };

  it("changes the primary member and says so", async () => {
    const { db } = setup();
    const r = await setHouseholdPrimaryAction(null, form(ok));
    expect(r).toEqual({ ok: true, message: "The primary member is changed · audit logged. Pledges, payments and statements stay with the household." });
    expect(db.rpcCalls.find((c) => c.fn === "set_household_primary")?.args).toEqual({ p_household: ID.hhShah, p_person: ID.rahul, p_reason: "Priya passed away" });
    expect(dbWithReason).toHaveBeenCalledWith(expect.anything(), "Priya passed away");
    expect(stub.asked).toEqual([{ key: "householdsEdit", doing: "change the primary member" }]);
    expect(stub.activity).toEqual([{ key: "people.set_primary", entity: { kind: "household", id: ID.hhShah } }]);
  });

  it("answers an unfinished form, and a database refusal, with the same sentences", async () => {
    setup({ failRpc: { set_household_primary: { code: "22023", message: "That person is not a current member of this household." } } });
    expect(await setHouseholdPrimaryAction(null, form({ ...ok, household_id: "" }))).toEqual({ ok: false, error: "Could not change the primary member — the household was not found." });
    expect(await setHouseholdPrimaryAction(null, form({ ...ok, person_id: "" }))).toEqual({ ok: false, error: "Could not change the primary member — choose who becomes the primary member." });
    expect(await setHouseholdPrimaryAction(null, form({ ...ok, reason: "  " }))).toEqual({ ok: false, error: "Could not change the primary member — give a reason. It goes in the audit log." });
    expect(await setHouseholdPrimaryAction(null, form(ok))).toEqual({ ok: false, error: "Could not change the primary member — That person is not a current member of this household." });
    expect(stub.asked.every((a) => a.key === "householdsEdit")).toBe(true);
  });
});

describe("addIdentifierAction", () => {
  const ok = { kind: "crm", target: `household:${ID.hhShah}`, value: " N-1001 ", system: "neon", label: "", notes: "", returnPath: `/households/${ID.hhShah}?tab=ids` };

  it("adds it, says so, and refreshes the page the form was on", async () => {
    const { inserted } = setup();
    const r = await addIdentifierAction(null, form(ok));
    expect(r).toEqual({ ok: true, message: 'Added Legacy CRM id "N-1001".' });
    expect(inserted).toEqual([
      { center_id: "center-1", household_id: ID.hhShah, person_id: null, kind: "crm", system: "neon", value: "N-1001", label: null, notes: null, source: "manual", valid_from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), created_by: "user-1" },
    ]);
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(`/households/${ID.hhShah}`);
    expect(stub.activity).toEqual([{ key: "people.add_identifier", entity: { kind: "household", id: ID.hhShah } }]);
    expect(stub.asked).toEqual([{ key: "identifiersManage", doing: "add the identifier" }]);
  });

  it("adds a person's number from the household page and refreshes the household page", async () => {
    const { inserted } = setup();
    const r = await addIdentifierAction(null, form({ ...ok, kind: "org_member", target: `person:${ID.priya}`, value: "417", system: "org_register" }));
    expect(r).toEqual({ ok: true, message: 'Added Organization member ID "417".' });
    expect(inserted[0]).toMatchObject({ person_id: ID.priya, household_id: null });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(`/households/${ID.hhShah}`);
    expect(stub.activity).toEqual([{ key: "people.add_identifier", entity: { kind: "person", id: ID.priya } }]);
  });

  it("answers each mistake with the same sentence", async () => {
    const { inserted } = setup();
    const sentence = async (over: Record<string, string>) => ((await addIdentifierAction(null, form({ ...ok, ...over }))) as { error: string }).error;
    expect(await sentence({ kind: "nope" })).toBe("Could not add the identifier — choose what kind of identifier it is.");
    expect(await sentence({ value: "" })).toBe("Could not add the Legacy CRM id — enter the value exactly as the other system shows it.");
    expect(await sentence({ system: "" })).toBe("Could not add the identifier — say which system it comes from (for example neon or quickbooks).");
    expect(await sentence({ target: "" })).toBe("Could not add the identifier — choose who it belongs to.");
    expect(await sentence({ target: `person:${ID.priya}`, kind: "org_household" })).toBe(
      'Could not add the Organization household ID — it belongs to the household, not a person. Choose the household under "Belongs to".',
    );
    expect(inserted).toEqual([]);
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
    stub.refusal = "Could not add the identifier — you don't have permission (needs people.manage or giving.manage).";
    expect(await sentence({})).toBe(stub.refusal);
  });

  it("names who already holds the number", async () => {
    setup({ insertError: { code: "23505", message: "duplicate key" }, rpc: { resolve_identifier: [{ kind: "crm", display_name: "Nikhil Patel" }] } });
    expect(await addIdentifierAction(null, form(ok))).toEqual({
      ok: false,
      error: 'Could not add the Legacy CRM id — "N-1001" (neon) is already assigned to Nikhil Patel. Retire it there first if it moved.',
    });
  });

  it("follows the kind: accounting ids need giving.manage", async () => {
    setup({}, ["people.view", "people.manage"]);
    expect(await addIdentifierAction(null, form({ ...ok, kind: "accounting", system: "quickbooks" }))).toEqual({
      ok: false,
      error: "Could not add the Accounting (QuickBooks) customer — you don't have permission (needs giving.manage).",
    });
  });
});

describe("retireIdentifierAction", () => {
  const ok = { id: ID.extNikhil, reason: "Moved to a new system", returnPath: `/people/${ID.nikhil}` };

  it("retires it with the reason on the audit row, says so, and refreshes the page", async () => {
    const { db } = setup();
    const r = await retireIdentifierAction(null, form(ok));
    expect(r).toEqual({ ok: true, message: 'Retired "N-77". It stays in the history.' });
    expect(db.calls.filter((c) => c.op === "update")).toEqual([{ table: "external_ids", op: "update", patch: { valid_to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }, ids: [ID.extNikhil] }]);
    expect(dbWithReason).toHaveBeenCalledWith(expect.anything(), "Moved to a new system");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(`/people/${ID.nikhil}`);
    expect(stub.asked).toEqual([{ key: "identifiersManage", doing: "retire the identifier" }]);
    expect(stub.activity).toEqual([{ key: "people.retire_identifier", entity: { kind: "identifier", id: ID.extNikhil } }]);
  });

  it("now needs a reason (the one change), and answers the old mistakes with the old sentences", async () => {
    const { db } = setup();
    expect(await retireIdentifierAction(null, form({ ...ok, reason: "  " }))).toEqual({ ok: false, error: "Could not retire the identifier — give a reason. It goes in the audit log." });
    expect(await retireIdentifierAction(null, form({ ...ok, id: "nope" }))).toEqual({ ok: false, error: "Could not retire the identifier — it was not found." });
    expect(await retireIdentifierAction(null, form({ ...ok, id: "ee000000-0000-4000-8000-0000000000ff" }))).toEqual({
      ok: false,
      error: "Could not retire the identifier — it was not found, or you can't see it.",
    });
    expect(db.calls.some((c) => c.op === "update")).toBe(false);
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });

  it("refuses the finance kinds to someone without giving.manage", async () => {
    setup();
    expect(await retireIdentifierAction(null, form({ ...ok, id: ID.extQb }))).toEqual({ ok: false, error: "Could not retire the Accounting (QuickBooks) customer — you don't have permission." });
  });
});
