import { beforeEach, describe, expect, it, vi } from "vitest";

// Custom fields on the Family page call four Server Actions. Saving a value goes through the SAME action as the classic "More details"
// card (setCustomValueAction); adding and archiving a field go through the Settings screen's own actions. The session and the database
// are stand-ins.
const stub = vi.hoisted(() => ({
  session: null as unknown,
  refusal: null as string | null,
  asked: [] as { key: string; doing: string }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/session", () => ({
  authorizeAction: vi.fn(async (key: string, doing: string) => {
    stub.asked.push({ key, doing });
    return stub.refusal ? { ok: false, error: stub.refusal } : { ok: true, session: stub.session };
  }),
  authorizeActionWhere: vi.fn(),
  loadSession: vi.fn(async () => ({ status: "ok", session: stub.session })),
}));

import { addCustomFieldAction, saveCustomValueAction, setCustomFieldStatusAction } from "@/app/(app)/households/[id]/custom-actions";
import { revalidatePath } from "next/cache";
import { isConflictMessage } from "@/lib/people-v2/inline-edit";

import { fakeDb, fakeSession } from "./commands/helpers";

const C = "center-1";
const PERSON = "b0000000-0000-4000-8000-000000000001";
const HOUSEHOLD = "a0000000-0000-4000-8000-000000000001";

type Row = Record<string, unknown>;
const def = (over: Row): Row => ({
  id: `d0000000-0000-4000-8000-${String(Math.abs(hash(String(over.key)))).padStart(12, "0").slice(0, 12)}`,
  center_id: C,
  entity: "people",
  type: "text",
  choices: [],
  sensitivity: "staff",
  searchable: false,
  source: "manual",
  source_import_run: null,
  status: "active",
  sort: 0,
  ...over,
});
function hash(s: string) {
  let h = 7;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}

type Setup = { defs?: Row[]; values?: Record<string, Row>; permissions?: string[]; rpcError?: { code?: string; message: string }; audit?: Row[] };

function setup(o: Setup = {}) {
  const values: Record<string, Row> = { [PERSON]: {}, [HOUSEHOLD]: {}, ...(o.values ?? {}) };
  const defs = o.defs ?? [
    def({ key: "shirt_size", label: "Shirt size", type: "choice", choices: ["S", "M", "L"] }),
    def({ key: "anniversary", label: "Anniversary", type: "date" }),
    def({ key: "dues", label: "Dues", type: "money" }),
    def({ key: "skills", label: "Volunteer skills" }),
    def({ key: "old", label: "Old field", status: "archived" }),
    def({ key: "size_ja", label: "サイズ", type: "choice", choices: ["小", "中", "大"] }),
    def({ key: "contact_time", label: "Preferred contact time", entity: "households", type: "choice", choices: ["Morning", "Evening"] }),
  ];
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const db = fakeDb({
    tables: {
      custom_field_definitions: defs,
      audit_log: o.audit ?? [],
      center_users: [{ center_id: C, user_id: "user-ravi", person_id: "p-ravi" }],
      people: [{ id: "p-ravi", first_name: "Ravi", last_name: "Menon", preferred_name: null }],
    },
    rpc: {
      custom_values: (a: Record<string, unknown>) => (a.p_ids as string[]).map((id) => ({ record_key: id, custom: values[id] ?? {} })),
      set_custom_value: (a: Record<string, unknown>) => {
        rpcCalls.push({ fn: "set_custom_value", args: a });
        values[String(a.p_record)] = { ...(values[String(a.p_record)] ?? {}), [String(a.p_key)]: a.p_value };
        return values[String(a.p_record)];
      },
      define_custom_field: (a: Record<string, unknown>) => {
        rpcCalls.push({ fn: "define_custom_field", args: a });
        defs.push(def({ key: String(a.p_label).toLowerCase().replace(/\W+/g, "_"), label: a.p_label, entity: a.p_entity, type: a.p_type, sort: defs.length }));
        return null;
      },
      update_custom_field: (a: Record<string, unknown>) => {
        rpcCalls.push({ fn: "update_custom_field", args: a });
        return null;
      },
    },
    failRpc: o.rpcError ? { set_custom_value: o.rpcError } : undefined,
  });
  stub.session = fakeSession({ db, permissions: o.permissions ?? ["people.manage"] });
  stub.refusal = null;
  stub.asked = [];
  return { db, values, defs, rpcCalls };
}

const save = (over: Partial<Parameters<typeof saveCustomValueAction>[0]> = {}) =>
  saveCustomValueAction({ entity: "people", recordId: PERSON, key: "skills", value: "Catering", expect: "", label: "Samira's Volunteer skills", ...over });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(revalidatePath).mockClear();
});

describe("saveCustomValueAction", () => {
  it("saves a value the person saw through the More details card's own action, and refreshes the page", async () => {
    const { rpcCalls, values } = setup({ values: { [PERSON]: { skills: "First aid" } } });
    const r = await save({ expect: "First aid", value: "Catering, first aid", path: `/households/${HOUSEHOLD}` });
    expect(r).toEqual({ ok: true, message: "Volunteer skills saved.", changed: true });
    expect(rpcCalls).toEqual([{ fn: "set_custom_value", args: { p_entity: "people", p_record: PERSON, p_key: "skills", p_value: "Catering, first aid" } }]);
    expect(values[PERSON].skills).toBe("Catering, first aid");
    expect(revalidatePath).toHaveBeenCalledWith(`/households/${HOUSEHOLD}`);
  });

  it("writes the typed value of the field's type: a date as ISO, money in cents, a choice by its own spelling", async () => {
    const { rpcCalls } = setup();
    await save({ key: "anniversary", value: "6/2/2019", label: "Samira's Anniversary" });
    await save({ key: "dues", value: "25.50", label: "Samira's Dues" });
    await save({ key: "shirt_size", value: "m", label: "Samira's Shirt size" });
    expect(rpcCalls.map((c) => c.args.p_value)).toEqual(["2019-06-02", 2550, "M"]);
  });

  it("clears a value with an empty one", async () => {
    const { rpcCalls } = setup({ values: { [PERSON]: { skills: "First aid" } } });
    const r = await save({ expect: "First aid", value: "" });
    expect(r).toMatchObject({ ok: true, changed: true, message: "Volunteer skills cleared." });
    expect(rpcCalls[0].args.p_value).toBeNull();
  });

  it("writes nothing when someone else changed the value first, and gives the new value for the conflict panel", async () => {
    const { rpcCalls } = setup({
      values: { [PERSON]: { skills: "Driving" } },
      permissions: ["people.manage", "audit.view"],
      audit: [{ center_id: C, record_table: "custom_staff_values", record_id: "x", occurred_at: "2026-10-12T09:58:00Z", actor_user_id: "user-ravi", before: { custom: { skills: "First aid" } }, after: { record_key: PERSON, custom: { skills: "Driving" } } }],
    });
    const r = await save({ expect: "First aid", value: "Catering" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("conflict");
    expect(isConflictMessage(r.error)).toBe(true);
    expect(r.error).toContain("Volunteer skills");
    expect(r.conflict).toEqual({ theirs: { "cf:skills": "Driving" }, who: "Ravi", at: "2026-10-12T09:58:00Z" });
    expect(rpcCalls).toEqual([]);
  });

  it("says someone when the audit log cannot be read, and still writes nothing", async () => {
    const { rpcCalls } = setup({ values: { [PERSON]: { skills: "Driving" } } });
    const r = await save({ expect: "First aid", value: "Catering" });
    expect(r).toMatchObject({ ok: false, kind: "conflict", conflict: { theirs: { "cf:skills": "Driving" }, who: null, at: null } });
    expect(rpcCalls).toEqual([]);
  });

  it("is not a conflict when the other change left the same value, and does not write again", async () => {
    const { rpcCalls } = setup({ values: { [PERSON]: { skills: "Catering" } } });
    expect(await save({ expect: "First aid", value: "Catering" })).toEqual({ ok: true, message: "No changes to save.", changed: false });
    expect(rpcCalls).toEqual([]);
  });

  it("reads a date the same however it was spelled when comparing", async () => {
    const { rpcCalls } = setup({ values: { [PERSON]: { anniversary: "2019-06-02" } } });
    const r = await save({ key: "anniversary", expect: "2019-06-02", value: "06/03/2019", label: "Samira's Anniversary" });
    expect(r.ok).toBe(true);
    expect(rpcCalls[0].args.p_value).toBe("2019-06-03");
  });

  it("refuses what the type cannot take, in words, before anything is written", async () => {
    const { rpcCalls } = setup();
    const r = await save({ key: "anniversary", value: "someday", label: "Samira's Anniversary" });
    expect(r).toMatchObject({ ok: false, kind: "other" });
    expect(r.ok === false && r.error).toMatch(/^Could not save Samira's Anniversary — /);
    expect(rpcCalls).toEqual([]);
  });

  it("refuses an archived field and a field that is not there", async () => {
    const { rpcCalls } = setup();
    expect(await save({ key: "old", value: "x" })).toMatchObject({ ok: false, error: expect.stringContaining("the field is archived") });
    expect(await save({ key: "nothing_like_it", value: "x" })).toMatchObject({ ok: false, error: expect.stringContaining("no longer exists") });
    expect(rpcCalls).toEqual([]);
  });

  it("says 'You don't have access to this area' when the database refuses the change", async () => {
    setup({ rpcError: { code: "42501", message: "That record was not found, or you don't have permission to change it." } });
    const r = await save();
    expect(r).toMatchObject({ ok: false, kind: "access", error: "You don't have access to this area. Samira's Volunteer skills was not changed." });
  });

  it("checks the shape of what the browser sent", async () => {
    setup();
    expect(await save({ entity: "payments" as never })).toMatchObject({ ok: false });
    expect(await save({ key: "Bad Key" })).toMatchObject({ ok: false });
    expect(await save({ recordId: "not-an-id" })).toMatchObject({ ok: false, error: expect.stringContaining("not found") });
    expect(await save({ value: "x".repeat(2001) })).toMatchObject({ ok: false, error: expect.stringContaining("too long") });
  });

  it("saves a household field, and a choice written in another script lands on the choice that was picked", async () => {
    const { rpcCalls } = setup();
    await saveCustomValueAction({ entity: "households", recordId: HOUSEHOLD, key: "contact_time", value: "evening", expect: "", label: "Hassan household's Preferred contact time" });
    await saveCustomValueAction({ entity: "people", recordId: PERSON, key: "size_ja", value: "大", expect: "", label: "太郎's サイズ" });
    expect(rpcCalls.map((c) => [c.args.p_entity, c.args.p_value])).toEqual([
      ["households", "Evening"],
      ["people", "大"],
    ]);
  });
});

describe("addCustomFieldAction", () => {
  const add = (over: Partial<Parameters<typeof addCustomFieldAction>[0]> = {}) =>
    addCustomFieldAction({ entity: "people", label: "Pronouns", type: "text", choices: [], sensitivity: "staff", searchable: false, ...over });

  it("adds a field through the Settings action (settings.manage) and gives back its id so Undo can archive it", async () => {
    const { rpcCalls } = setup({ permissions: ["settings.manage"] });
    const r = await add({ type: "choice", choices: ["Morning", "Evening"], sensitivity: "member_self", searchable: true, label: "Best time" });
    expect(r).toMatchObject({ ok: true, message: "Best time added." });
    expect(r.ok && r.id).toMatch(/^d0000000-/);
    expect(stub.asked).toEqual([{ key: "centerSettings", doing: "add the custom field" }]);
    expect(rpcCalls[0]).toEqual({
      fn: "define_custom_field",
      args: { p_center: C, p_entity: "people", p_label: "Best time", p_type: "choice", p_choices: ["Morning", "Evening"], p_sensitivity: "member_self", p_searchable: true },
    });
  });

  it("passes on the Settings action's refusal in its own words", async () => {
    setup();
    stub.refusal = "Could not add the custom field — you don't have permission (needs settings.manage).";
    expect(await add()).toEqual({ ok: false, error: "Could not add the custom field — you don't have permission (needs settings.manage)." });
  });

  it("checks the name again: a name already in use (even an archived field's), no name, a list with no choices", async () => {
    setup({ permissions: ["settings.manage"] });
    expect(await add({ label: "shirt size" })).toMatchObject({ ok: false, error: expect.stringContaining("there is already a field called “Shirt size”") });
    expect(await add({ label: "OLD FIELD" })).toMatchObject({ ok: false, error: expect.stringContaining("there is an archived field called “Old field”") });
    expect(await add({ label: "  " })).toMatchObject({ ok: false, error: expect.stringContaining("give the field a name") });
    expect(await add({ type: "choice", choices: [] })).toMatchObject({ ok: false, error: expect.stringContaining("at least one choice") });
    expect(await add({ entity: "payments" as never })).toMatchObject({ ok: false });
  });

  it("adds a field named in another script", async () => {
    const { rpcCalls } = setup({ permissions: ["settings.manage"] });
    const r = await add({ label: "ボランティアの技能" });
    expect(r.ok).toBe(true);
    expect(rpcCalls[0].args.p_label).toBe("ボランティアの技能");
  });
});

describe("setCustomFieldStatusAction", () => {
  it("archives a field through the Settings save action, keeping its name, visibility and searchable flag, and sending no choices", async () => {
    const { rpcCalls, defs } = setup({ permissions: ["settings.manage"] });
    const shirt = defs.find((d) => d.key === "shirt_size")!;
    shirt.sensitivity = "member_self";
    shirt.searchable = true;
    const r = await setCustomFieldStatusAction({ id: String(shirt.id), status: "archived" });
    expect(r).toMatchObject({ ok: true });
    expect(stub.asked).toEqual([{ key: "centerSettings", doing: "save the custom field" }]);
    expect(rpcCalls[0].fn).toBe("update_custom_field");
    expect(rpcCalls[0].args).toEqual({ p_id: shirt.id, p_label: "Shirt size", p_choices: undefined, p_sensitivity: "member_self", p_searchable: true, p_status: "archived" });
  });

  it("restores one, and refuses a bad id or status or a field that is not there", async () => {
    const { rpcCalls, defs } = setup({ permissions: ["settings.manage"] });
    const old = defs.find((d) => d.key === "old")!;
    expect(await setCustomFieldStatusAction({ id: String(old.id), status: "active" })).toMatchObject({ ok: true });
    expect(rpcCalls[0].args.p_status).toBe("active");
    expect(await setCustomFieldStatusAction({ id: "nope", status: "active" })).toMatchObject({ ok: false });
    expect(await setCustomFieldStatusAction({ id: String(old.id), status: "deleted" as never })).toMatchObject({ ok: false });
    expect(await setCustomFieldStatusAction({ id: "d0000000-0000-4000-8000-ffffffffffff", status: "active" })).toMatchObject({ ok: false, error: expect.stringContaining("not found") });
  });

  it("passes on the Settings action's refusal", async () => {
    const { defs } = setup();
    stub.refusal = "Could not save the custom field — you don't have permission (needs settings.manage).";
    expect(await setCustomFieldStatusAction({ id: String(defs[0].id), status: "archived" })).toMatchObject({ ok: false, error: expect.stringContaining("settings.manage") });
  });
});
