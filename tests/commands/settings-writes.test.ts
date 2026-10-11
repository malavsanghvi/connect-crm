// The three Settings changes (give a role, take a role away, switch a module): confirm-level, off for Niva until the owner ticks them.
// Nothing changes until the person confirms; the rules are the Roles and Modules screens' own.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));
vi.mock("@/lib/session", () => ({ dbWithReason: vi.fn() }));

import { revalidatePath } from "next/cache";

import { confirmProposal, runCommand } from "@/lib/commands/run";
import type { CommandNeedsConfirmation, CommandRunResult } from "@/lib/commands/types";
import { dbWithReason } from "@/lib/session";

import { addSettingsWorld, asWriter, EVENT, G, MODULE_STATES, U } from "./settings-world";

function proposed(r: CommandRunResult): CommandNeedsConfirmation {
  if (!r.ok || !r.needsConfirmation) throw new Error(`expected a proposal, got ${JSON.stringify(r)}`);
  return r;
}
const failed = (r: CommandRunResult): string => {
  if (r.ok) throw new Error(`expected a failure, got ${JSON.stringify(r)}`);
  return r.error;
};
const messageOf = (r: CommandRunResult): string | undefined => (r.ok && !r.needsConfirmation ? r.message : undefined);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(dbWithReason).mockReset();
});

function withReasonDb(db: unknown) {
  vi.mocked(dbWithReason).mockResolvedValue(db as never);
}

// ---------------------------------------------------------------------------
describe("settings.grant_role", () => {
  const treasurer = { user_id: U.priya2, role_key: "treasurer" };

  it("is off for Niva until the owner ticks it, and needs the roles permission", async () => {
    const off = asWriter({ rules: { assistant: { enabled: true } } });
    expect(await runCommand(off.ctx, "settings.grant_role", treasurer)).toMatchObject({ ok: false, code: "switched_off" });
    const noRoles = asWriter({ permissions: ["settings.manage"] });
    expect(await runCommand(noRoles.ctx, "settings.grant_role", treasurer)).toMatchObject({ ok: false, code: "no_access" });
    expect(off.inserts).toEqual([]);
  });

  it("asks first, with the person's household card, and gives nothing until they confirm", async () => {
    const { ctx, inserts } = asWriter();
    const p = proposed(await runCommand(ctx, "settings.grant_role", treasurer));
    expect(p.preview.summary).toBe("Give Treasurer to Priya Shah.");
    expect(p.preview.lines).toEqual([
      { label: "Person", value: "Priya Shah · member 2077" },
      { label: "Role", value: "Treasurer" },
      { label: "It allows", value: expect.stringContaining("pledges and payments") },
      { label: "For", value: "The whole community" },
      { label: "Lasts", value: "until someone takes it away" },
    ]);
    expect(p.preview.households).toEqual([expect.objectContaining({ household_number: "H-1004", city: "Plainfield", adults: ["Priya Shah"] })]);
    expect(p.preview.warnings).toEqual(['Treasurer needs a second person: it will wait as pending, and starts only when a different administrator approves it under "Waiting for approval".']);
    expect(p.confirmText).toBe("Yes, give Treasurer to Priya Shah");
    expect(inserts).toEqual([]);
  });

  it("lands as pending when the role needs a second person, and says so", async () => {
    const { ctx, inserts } = asWriter();
    const p = proposed(await runCommand(ctx, "settings.grant_role", treasurer));
    const done = await confirmProposal(ctx, p.proposalId, p.inputHash);
    expect(done).toMatchObject({ ok: true });
    expect(messageOf(done)).toBe('Treasurer is waiting for a second person: it starts only when a different administrator approves it under "Waiting for approval".');
    expect(inserts).toEqual([{ center_id: "center-1", user_id: U.priya2, role_key: "treasurer", scope_kind: "center", scope_id: null, ends_at: null, granted_by: U.admin, reason: null }]);
    expect(revalidatePath).toHaveBeenCalledWith("/settings/roles", "layout");
  });

  it("starts a role that needs no second person at once, for one event, until the end of a day, with the reason in the audit log", async () => {
    const { ctx, inserts, db } = asWriter();
    withReasonDb(db);
    const input = { user_id: U.priya2, role_key: "event_manager", scope_kind: "event", scope_id: EVENT, ends_on: "2027-10-10", reason: "Runs the dinner" };
    const p = proposed(await runCommand(ctx, "settings.grant_role", input));
    expect(p.preview.lines).toEqual(expect.arrayContaining([{ label: "For", value: "Event: Diwali Dinner" }, { label: "Lasts", value: "until October 10, 2027" }, { label: "Why", value: "Runs the dinner" }]));
    expect(p.preview.warnings).toEqual(["Event manager starts at once."]);
    const done = await confirmProposal(ctx, p.proposalId, p.inputHash);
    expect(messageOf(done)).toBe("Granted Event manager until 2027-10-10.");
    expect(inserts).toEqual([
      { center_id: "center-1", user_id: U.priya2, role_key: "event_manager", scope_kind: "event", scope_id: EVENT, ends_at: "2027-10-11T05:00:00.000Z", granted_by: U.admin, reason: "Runs the dinner" },
    ]);
    expect(vi.mocked(dbWithReason)).toHaveBeenCalledWith(expect.anything(), "Runs the dinner");
  });

  it("gives exactly what the draft prepared when its card is passed on", async () => {
    const { ctx, inserts } = asWriter();
    const draft = await runCommand(ctx, "settings.draft_role_grant", { user_id: U.priya2, role: "the treasurer role", for_months: 12, reason: "Takes over the books" });
    const card = (draft as { data: { stage: string; grant: { apply_with: { command: string; input: Record<string, string> } } } }).data;
    expect(card.stage).toBe("ready");
    expect(card.grant.apply_with.command).toBe("settings.grant_role");
    expect(card.grant.apply_with.input).toEqual({ user_id: U.priya2, role_key: "treasurer", scope_kind: "center", ends_on: "2027-10-09", reason: "Takes over the books" });
    // The draft gave nothing.
    expect(inserts).toEqual([]);
    withReasonDb(ctx.session.db);
    const p = proposed(await runCommand(ctx, card.grant.apply_with.command, card.grant.apply_with.input));
    expect(inserts).toEqual([]);
    await confirmProposal(ctx, p.proposalId, p.inputHash);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ user_id: U.priya2, role_key: "treasurer", ends_at: "2027-10-10T05:00:00.000Z", reason: "Takes over the books" });
  });

  it("refuses, in the Roles screen's own words, what the screen refuses", async () => {
    const { ctx, inserts } = asWriter();
    const say = async (input: Record<string, unknown>) => failed(await runCommand(ctx, "settings.grant_role", { ...treasurer, ...input }));
    expect(await say({ role_key: "platform_admin" })).toBe("Could not grant Platform admin — platform roles are granted by the platform team only.");
    expect(await say({ role_key: "primary_adult" })).toBe("Could not grant Primary adult — family roles come from household relationships, not grants.");
    expect(await say({ role_key: "no_such_role" })).toBe("Could not grant the role — choose a role.");
    expect(await say({ scope_kind: "zone" })).toBe("Could not grant the role — choose which zone it is for.");
    expect(await say({ scope_kind: "zone", scope_id: "9a000000-0000-4000-8000-0000000000aa" })).toBe("Could not grant the role — that zone was not found.");
    expect(await say({ ends_on: "2020-01-01" })).toBe("Could not grant the role — the end date is in the past.");
    expect(await say({ user_id: U.priya })).toBe("This person already holds Treasurer for that scope.");
    expect(await say({ user_id: U.admin })).toBe("Nobody can give themselves a role. A different administrator has to do this.");
    expect(await say({ user_id: U.nobody })).toBe("That person has not signed in to Weaver yet, so a role cannot be given. Invite them first in Settings › Team.");
    expect(await say({ user_id: U.aarav })).toBe("Roles are only given to adults. Please do this on the Roles screen if it is right.");
    expect(inserts).toEqual([]);
  });

  it("does not say it gave the role when the database refused, and asks for the security code when it needs one", async () => {
    const refused = asWriter({ insert: { fail: { code: "42501", message: "new row violates row-level security policy" } } });
    const p = proposed(await runCommand(refused.ctx, "settings.grant_role", treasurer));
    const r = await confirmProposal(refused.ctx, p.proposalId, p.inputHash);
    expect(failed(r)).toBe("Could not grant Treasurer — you don't have permission to make this change.");
    expect(JSON.stringify(r)).not.toMatch(/Granted|waiting for a second person/);

    const stepUp = asWriter({ insert: { fail: { code: "P0001", message: "This change needs a fresh 2FA check" } } });
    const p2 = proposed(await runCommand(stepUp.ctx, "settings.grant_role", treasurer));
    const r2 = await confirmProposal(stepUp.ctx, p2.proposalId, p2.inputHash);
    expect(r2).toMatchObject({ ok: false, needsStepUp: true, stepUp: true, retry: { proposalId: expect.any(String) } });
  });

  it("never shows a child to Niva, in the card or the answer", async () => {
    const { ctx } = asWriter();
    const p = proposed(await runCommand(ctx, "settings.grant_role", treasurer));
    expect(JSON.stringify(p)).not.toMatch(/Zoya|Aarav|Tia Mehta|date_of_birth/);
  });
});

// ---------------------------------------------------------------------------
describe("settings.revoke_role", () => {
  it("is off for Niva until the owner ticks it", async () => {
    const { ctx } = asWriter({ rules: { assistant: { enabled: true } } });
    expect(await runCommand(ctx, "settings.revoke_role", { grant_id: G.priya })).toMatchObject({ ok: false, code: "switched_off" });
  });

  it("shows whose role it is, ends it only when confirmed, and says it stopped at once", async () => {
    const { ctx, db } = asWriter();
    const p = proposed(await runCommand(ctx, "settings.revoke_role", { grant_id: G.priya }));
    expect(p.preview.summary).toBe("Take Treasurer away from Priya Shah.");
    expect(p.preview.lines).toEqual([
      { label: "Person", value: "Priya Shah · member 1042" },
      { label: "Role", value: "Treasurer" },
      { label: "Stops", value: "At once" },
    ]);
    expect(p.preview.households).toEqual([expect.objectContaining({ household_number: "H-1001" })]);
    expect(p.preview.warnings).toEqual(["They lose what the role lets them do, immediately."]);
    expect(p.confirmText).toBe("Yes, take Treasurer away from Priya Shah");
    expect(db.calls.some((c) => c.op === "update")).toBe(false);
    const done = await confirmProposal(ctx, p.proposalId, p.inputHash);
    expect(messageOf(done)).toBe("Role revoked. It stopped working immediately.");
    const update = db.calls.find((c) => c.op === "update");
    expect(update).toMatchObject({ table: "role_grants", patch: { ends_at: "2026-10-10T15:00:00.000Z" }, ids: [G.priya] });
    expect(revalidatePath).toHaveBeenCalledWith("/settings/roles", "layout");
  });

  it("warns when it is the person's own role", async () => {
    const { ctx } = asWriter();
    const p = proposed(await runCommand(ctx, "settings.revoke_role", { grant_id: G.admin }));
    expect(p.preview.warnings).toEqual(["This is your own role. You will lose what it lets you do."]);
  });

  it("answers a grant that is gone, already over, or someone's who cannot be shown, in the screen's words", async () => {
    const { ctx } = asWriter();
    expect(failed(await runCommand(ctx, "settings.revoke_role", { grant_id: G.nobody }))).toBe("Could not revoke the role — the grant was not found.");
    expect(failed(await runCommand(ctx, "settings.revoke_role", { grant_id: G.ended }))).toBe("Could not revoke the role — it has already ended.");
    expect(failed(await runCommand(ctx, "settings.revoke_role", { grant_id: G.aarav }))).toBe("Niva cannot show whose role this is. Please take it away on the Roles screen.");
  });

  it("does not say it ended the role when the database refused", async () => {
    const world = addSettingsWorld();
    const { ctx } = asWriter({ world });
    const p = proposed(await runCommand(ctx, "settings.revoke_role", { grant_id: G.priya }));
    world.failUpdates = { role_grants: { code: "42501", message: "new row violates row-level security policy" } };
    const r = await confirmProposal(ctx, p.proposalId, p.inputHash);
    expect(failed(r)).toBe("Could not revoke the role — you don't have permission to make this change.");
    expect(JSON.stringify(r)).not.toMatch(/Role revoked/);
  });
});

// ---------------------------------------------------------------------------
describe("settings.set_module", () => {
  const off = { module: "store", enabled: false, reason: "We do not run a store" };

  it("is off for Niva until the owner ticks it, and needs the settings permission", async () => {
    const { ctx } = asWriter({ rules: { assistant: { enabled: true } } });
    expect(await runCommand(ctx, "settings.set_module", off)).toMatchObject({ ok: false, code: "switched_off" });
    const noSettings = asWriter({ permissions: ["roles.manage"] });
    expect(await runCommand(noSettings.ctx, "settings.set_module", off)).toMatchObject({ ok: false, code: "no_access" });
  });

  it("shows before and after and what members lose, then switches only when confirmed, with the reason in the audit log", async () => {
    const { ctx, db } = asWriter();
    withReasonDb(db);
    const p = proposed(await runCommand(ctx, "settings.set_module", off));
    expect(p.preview.summary).toBe("Switch off My Store.");
    expect(p.preview.lines).toEqual([
      { label: "Module", value: "My Store" },
      { label: "State", before: "On", after: "Off" },
      { label: "Why", value: "We do not run a store" },
    ]);
    expect(p.preview.warnings).toEqual(["My Store disappears from the portal and the member app, and the database refuses its data until it is switched on again."]);
    expect(p.confirmText).toBe("Yes, switch off My Store");
    expect(db.rpcCalls.some((c) => c.fn === "set_module_enabled")).toBe(false);
    const done = await confirmProposal(ctx, p.proposalId, p.inputHash);
    expect(messageOf(done)).toBe("My Store switched off · audit logged");
    expect(db.rpcCalls.find((c) => c.fn === "set_module_enabled")?.args).toEqual({ p_center: "center-1", p_module: "store", p_enabled: false, p_reason: "We do not run a store" });
    expect(vi.mocked(dbWithReason)).toHaveBeenCalledWith(expect.anything(), "We do not run a store");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("explains a switch that cannot be made before asking, and one the database refuses after", async () => {
    const { ctx } = asWriter();
    expect(failed(await runCommand(ctx, "settings.set_module", { module: "people", enabled: false, reason: "x" }))).toBe("Members & families is a core module and is always on.");
    const dependents = asWriter({ world: addSettingsWorld({ rpc: { module_states: MODULE_STATES.map((m) => (m.key === "bolis" ? { ...m, enabled: true } : m)) } }) });
    expect(failed(await runCommand(dependents.ctx, "settings.set_module", { module: "giving", enabled: false, reason: "x" }))).toBe("Bolis depends on Pledges & donations — switch it off first.");
    const notOffered = asWriter({ world: addSettingsWorld({ rpc: { module_states: MODULE_STATES.map((m) => (m.key === "store" ? { ...m, availability: "not_available", enabled: false } : m)) } }) });
    expect(failed(await runCommand(notOffered.ctx, "settings.set_module", { module: "store", enabled: true, reason: "x" }))).toBe("My Store is not offered to this kind of organization, so it cannot be switched.");
    const refused = asWriter({ world: addSettingsWorld({ failRpc: { set_module_enabled: { code: "P0001", message: "Pledges & donations is needed by Bolis" } } }) });
    withReasonDb(refused.db);
    const p = proposed(await runCommand(refused.ctx, "settings.set_module", off));
    const r = await confirmProposal(refused.ctx, p.proposalId, p.inputHash);
    expect(failed(r)).toMatch(/^Could not switch off My Store — /);
    expect(JSON.stringify(r)).not.toMatch(/switched off ·/);
  });

  it("needs a reason, kept under 500 characters, in the screen's words", async () => {
    const { ctx } = asWriter();
    expect(failed(await runCommand(ctx, "settings.set_module", { ...off, reason: "  " }))).toBe("Could not switch off My Store — say why. The reason is kept in the audit log.");
    expect(failed(await runCommand(ctx, "settings.set_module", { ...off, reason: "x".repeat(501) }))).toBe("Could not switch off My Store — keep the reason under 500 characters.");
  });

  it("says so when the database has no module switches yet", async () => {
    const { ctx, db } = asWriter({ world: addSettingsWorld({ failRpc: { set_module_enabled: { code: "42883", message: "function app.set_module_enabled does not exist" } } }) });
    withReasonDb(db);
    const p = proposed(await runCommand(ctx, "settings.set_module", off));
    expect(failed(await confirmProposal(ctx, p.proposalId, p.inputHash))).toBe(
      "Could not switch off My Store — module switches are not in the database yet (the latest database update has not been applied). Every module stays on until then.",
    );
  });
});
