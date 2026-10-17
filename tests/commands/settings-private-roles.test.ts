// Giving a DonorDelight or CatchTheMatch role (migration 0757): only the organization's owner or that product's manager may, for the whole
// community only; roles.manage alone is not enough. The command says so in the screen's words before the database refuses it too.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));
vi.mock("@/lib/session", () => ({ dbWithReason: vi.fn() }));

import { runCommand } from "@/lib/commands/run";
import type { CommandRunResult } from "@/lib/commands/types";

import { addSettingsWorld, asWriter, U, ZONE } from "./settings-world";

const failed = (r: CommandRunResult): string => {
  if (r.ok) throw new Error(`expected a failure, got ${JSON.stringify(r)}`);
  return r.error;
};

function worldWithCareRoles() {
  const world = addSettingsWorld();
  (world.tables!.roles as Record<string, unknown>[]).push(
    { key: "care_lead", name: "Care lead", tier: "center", description: "DonorDelight", permissions: ["care.view", "care.manage"] },
    { key: "matching_lead", name: "Matching lead", tier: "center", description: "CatchTheMatch", permissions: ["matching.view", "matching.manage"] },
  );
  return world;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("settings.grant_role for the organization's own data", () => {
  it("refuses an administrator who holds roles.manage but does not manage the product", async () => {
    const { ctx, inserts } = asWriter({ world: worldWithCareRoles() });
    expect(failed(await runCommand(ctx, "settings.grant_role", { user_id: U.priya2, role_key: "care_lead" }))).toBe(
      "Could not grant Care lead — only the organization's owner or someone who manages DonorDelight can give it.",
    );
    expect(inserts).toEqual([]);
  });

  it("refuses a platform admin as such", async () => {
    const { ctx } = asWriter({ world: worldWithCareRoles(), session: { isPlatformAdmin: true } });
    expect(failed(await runCommand(ctx, "settings.grant_role", { user_id: U.priya2, role_key: "matching_lead" }))).toBe(
      "Could not grant Matching lead — only the organization's owner or someone who manages CatchTheMatch can give it.",
    );
  });

  it("lets the owner prepare it for the whole community, never for one zone", async () => {
    const { ctx } = asWriter({ world: worldWithCareRoles(), session: { isOwner: true } });
    expect(failed(await runCommand(ctx, "settings.grant_role", { user_id: U.priya2, role_key: "care_lead", scope_kind: "zone", scope_id: ZONE }))).toBe(
      "Could not grant Care lead — it works for the whole organization only. Give it without an event, class or zone.",
    );
    const r = await runCommand(ctx, "settings.grant_role", { user_id: U.priya2, role_key: "care_lead" });
    expect(r).toMatchObject({ ok: true, needsConfirmation: true });
  });

  it("lets the product's manager prepare it", async () => {
    const { ctx } = asWriter({ world: worldWithCareRoles(), permissions: ["roles.manage", "care.view", "care.manage"] });
    expect(await runCommand(ctx, "settings.grant_role", { user_id: U.priya2, role_key: "care_lead" })).toMatchObject({ ok: true, needsConfirmation: true });
  });
});
