import { beforeEach, describe, expect, it, vi } from "vitest";

// grantRoleAction, revokeGrantAction and setModuleEnabledAction are thin wrappers over the Settings commands now. What is checked
// here is that each one still answers the screen exactly as it always did (same ActionResult, same sentences), that it asks for the
// same permission with the same wording, and that the work lands in the database as before. The session and database are stand-ins.
const stub = vi.hoisted(() => ({
  session: null as unknown,
  refusal: null as string | null,
  asked: [] as { key: string; doing: string }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/session", () => ({
  authorizeAction: vi.fn(async (key: string, doing: string) => {
    stub.asked.push({ key, doing });
    return stub.refusal ? { ok: false, error: stub.refusal } : { ok: true, session: stub.session };
  }),
  authorizeActionWhere: vi.fn(),
  dbWithReason: vi.fn(async () => (stub.session as { db: unknown }).db),
}));

import { revalidatePath } from "next/cache";

import { setModuleEnabledAction } from "@/app/(app)/settings/modules/actions";
import { grantRoleAction, revokeGrantAction } from "@/app/(app)/settings/roles/actions";
import { dbWithReason } from "@/lib/session";

import { addSettingsWorld, ADMIN_PERMISSIONS, EVENT, G, MODULE_STATES, recordGrantInserts, U } from "./commands/settings-world";
import { fakeDb, fakeSession, type FakeDbOptions } from "./commands/helpers";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

function setup(opts: { world?: FakeDbOptions; insert?: Parameters<typeof recordGrantInserts>[1]; permissions?: string[] } = {}) {
  const world = opts.world ?? addSettingsWorld();
  const db = fakeDb(world);
  const inserts = recordGrantInserts(db, opts.insert);
  stub.session = fakeSession({ db, userId: U.admin, permissions: opts.permissions ?? ADMIN_PERMISSIONS });
  stub.refusal = null;
  stub.asked = [];
  return { world, db, inserts };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(dbWithReason).mockClear();
});

describe("grantRoleAction", () => {
  const treasurer = { user_id: U.priya2, role_key: "treasurer", scope_kind: "center", scope_id: "", ends_on: "", reason: "" };

  it("waits for a second person when the role needs one, and says what it always said", async () => {
    const { inserts } = setup();
    const r = await grantRoleAction(null, form(treasurer));
    expect(r).toStrictEqual({ ok: true, message: 'Treasurer is waiting for a second person: it starts only when a different administrator approves it under "Waiting for approval".' });
    expect(inserts).toEqual([{ center_id: "center-1", user_id: U.priya2, role_key: "treasurer", scope_kind: "center", scope_id: null, ends_at: null, granted_by: U.admin, reason: null }]);
    expect(stub.asked).toEqual([{ key: "roles", doing: "grant the role" }]);
    expect(revalidatePath).toHaveBeenCalledWith("/settings/roles", "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/content/guide", "layout");
  });

  it("grants a role that starts at once, for one event, until a day, with the reason kept in the audit log", async () => {
    const { inserts } = setup();
    const r = await grantRoleAction(null, form({ user_id: U.priya2, role_key: "event_manager", scope_kind: "event", scope_id: EVENT, ends_on: "2027-10-10", reason: "  Runs the dinner  " }));
    expect(r).toStrictEqual({ ok: true, message: "Granted Event manager until 2027-10-10." });
    expect(inserts).toEqual([
      { center_id: "center-1", user_id: U.priya2, role_key: "event_manager", scope_kind: "event", scope_id: EVENT, ends_at: "2027-10-11T05:00:00.000Z", granted_by: U.admin, reason: "Runs the dinner" },
    ]);
    expect(vi.mocked(dbWithReason)).toHaveBeenCalledWith(expect.anything(), "Runs the dinner");
    // A role for the whole community ignores a leftover event id, as it always did.
    const whole = await grantRoleAction(null, form({ ...treasurer, role_key: "event_manager", scope_id: EVENT }));
    expect(whole).toStrictEqual({ ok: true, message: "Granted Event manager." });
    expect(inserts[1]).toMatchObject({ role_key: "event_manager", scope_kind: "center", scope_id: null });
  });

  it("answers every refusal with the sentence it always gave", async () => {
    const { inserts } = setup();
    const say = async (over: Record<string, string>) => grantRoleAction(null, form({ ...treasurer, ...over }));
    const sorry = (error: string) => ({ ok: false, error });
    expect(await say({ user_id: "nope" })).toStrictEqual(sorry("Could not grant the role — choose a person who has signed in to Weaver at least once."));
    expect(await say({ scope_kind: "galaxy" })).toStrictEqual(sorry("Could not grant the role — choose a scope."));
    expect(await say({ role_key: "" })).toStrictEqual(sorry("Could not grant the role — choose a role."));
    expect(await say({ role_key: "no_such_role" })).toStrictEqual(sorry("Could not grant the role — choose a role."));
    expect(await say({ role_key: "platform_admin" })).toStrictEqual(sorry("Could not grant Platform admin — platform roles are granted by the platform team only."));
    expect(await say({ role_key: "primary_adult" })).toStrictEqual(sorry("Could not grant Primary adult — family roles come from household relationships, not grants."));
    expect(await say({ scope_kind: "zone", scope_id: "" })).toStrictEqual(sorry("Could not grant the role — choose which zone it is for."));
    expect(await say({ scope_kind: "zone", scope_id: "9a000000-0000-4000-8000-0000000000aa" })).toStrictEqual(sorry("Could not grant the role — that zone was not found."));
    expect(await say({ ends_on: "10/10/2027" })).toStrictEqual(sorry("Could not grant the role — the end date is not a valid date."));
    expect(await say({ ends_on: "2020-01-01" })).toStrictEqual(sorry("Could not grant the role — the end date is in the past."));
    expect(await say({ user_id: U.priya })).toStrictEqual(sorry("This person already holds Treasurer for that scope."));
    expect(inserts).toEqual([]);
  });

  it("explains a refusal by the database and keeps the security-code request", async () => {
    setup({ insert: { fail: { code: "42501", message: "new row violates row-level security policy" } } });
    expect(await grantRoleAction(null, form(treasurer))).toStrictEqual({ ok: false, error: "Could not grant Treasurer — you don't have permission to make this change." });
    setup({ insert: { fail: { code: "P0001", message: "This change needs a fresh 2FA check" } } });
    expect(await grantRoleAction(null, form(treasurer))).toStrictEqual({ ok: false, error: "Could not grant Treasurer — this needs a fresh 2FA check.", stepUp: true });
  });

  it("answers someone without the permission with the same words", async () => {
    const { inserts } = setup();
    stub.refusal = "Could not grant the role — you don't have permission (needs roles.manage).";
    expect(await grantRoleAction(null, form(treasurer))).toStrictEqual({ ok: false, error: stub.refusal });
    expect(inserts).toEqual([]);
  });
});

describe("revokeGrantAction", () => {
  it("ends the role at once and says so", async () => {
    const { db } = setup();
    const r = await revokeGrantAction(null, form({ id: G.priya }));
    expect(r).toStrictEqual({ ok: true, message: "Role revoked. It stopped working immediately." });
    expect(db.calls.find((c) => c.op === "update")).toMatchObject({ table: "role_grants", ids: [G.priya] });
    expect(stub.asked).toEqual([{ key: "roles", doing: "revoke the role" }]);
    expect(revalidatePath).toHaveBeenCalledWith("/settings/roles", "layout");
  });

  it("answers an unknown, ended or refused request with the same sentences", async () => {
    setup();
    const sorry = (error: string) => ({ ok: false, error });
    expect(await revokeGrantAction(null, form({ id: "nope" }))).toStrictEqual(sorry("Could not revoke the role — the grant was not found."));
    expect(await revokeGrantAction(null, form({ id: G.nobody }))).toStrictEqual(sorry("Could not revoke the role — the grant was not found."));
    expect(await revokeGrantAction(null, form({ id: G.ended }))).toStrictEqual(sorry("Could not revoke the role — it has already ended."));
    const world = addSettingsWorld();
    world.failUpdates = { role_grants: { code: "42501", message: "new row violates row-level security policy" } };
    setup({ world });
    expect(await revokeGrantAction(null, form({ id: G.priya }))).toStrictEqual(sorry("Could not revoke the role — you don't have permission to make this change."));
    stub.refusal = "Could not revoke the role — you don't have permission (needs roles.manage).";
    expect(await revokeGrantAction(null, form({ id: G.priya }))).toStrictEqual(sorry(stub.refusal));
  });
});

describe("setModuleEnabledAction", () => {
  it("switches a module off and on and says what it always said", async () => {
    const { db } = setup();
    expect(await setModuleEnabledAction("store", false, "  We do not run a store ")).toStrictEqual({ ok: true, message: "My Store switched off · audit logged" });
    expect(db.rpcCalls.find((c) => c.fn === "set_module_enabled")?.args).toEqual({ p_center: "center-1", p_module: "store", p_enabled: false, p_reason: "We do not run a store" });
    expect(await setModuleEnabledAction("bolis", true, "Autumn auction")).toStrictEqual({ ok: true, message: "Bolis switched on · audit logged" });
    expect(stub.asked).toEqual([
      { key: "centerSettings", doing: "switch off My Store" },
      { key: "centerSettings", doing: "switch on Bolis" },
    ]);
    expect(vi.mocked(dbWithReason)).toHaveBeenCalledWith(expect.anything(), "We do not run a store");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("answers every refusal with the sentence it always gave", async () => {
    setup();
    const sorry = (error: string) => ({ ok: false, error });
    expect(await setModuleEnabledAction("nonsense", false, "x")).toStrictEqual(sorry("Could not switch off the module — it is not one this app knows. Reload and try again."));
    expect(await setModuleEnabledAction("nonsense", true, "x")).toStrictEqual(sorry("Could not switch on the module — it is not one this app knows. Reload and try again."));
    expect(await setModuleEnabledAction("store", false, "   ")).toStrictEqual(sorry("Could not switch off My Store — say why. The reason is kept in the audit log."));
    expect(await setModuleEnabledAction("store", false, "x".repeat(501))).toStrictEqual(sorry("Could not switch off My Store — keep the reason under 500 characters."));
    stub.refusal = "Could not switch on Bolis — you don't have permission (needs settings.manage).";
    expect(await setModuleEnabledAction("bolis", true, "x")).toStrictEqual(sorry(stub.refusal));
  });

  it("explains a database that has no switches yet, and a refusal by the database", async () => {
    setup({ world: addSettingsWorld({ failRpc: { set_module_enabled: { code: "42883", message: "function app.set_module_enabled does not exist" } } }) });
    expect(await setModuleEnabledAction("store", false, "x")).toStrictEqual({
      ok: false,
      error: "Could not switch off My Store — module switches are not in the database yet (the latest database update has not been applied). Every module stays on until then.",
    });
    setup({ world: addSettingsWorld({ rpc: { module_states: MODULE_STATES }, failRpc: { set_module_enabled: { code: "42501", message: "new row violates row-level security policy" } } }) });
    expect(await setModuleEnabledAction("store", false, "x")).toStrictEqual({ ok: false, error: "Could not switch off My Store — you don't have permission to make this change." });
  });
});
