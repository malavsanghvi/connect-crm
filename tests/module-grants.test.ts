// 0740: Weaver grants each non-core module; the community pauses and resumes what is granted; dependencies are evaluated.
// The pure rules (rows, status, what blocks or warns), the two screens (Settings › Modules, Platform › Communities › Modules),
// the platform action, and Niva for admins following the `niva` module.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));
vi.mock("@/lib/session", () => ({ loadSession: vi.fn(), dbWithReason: vi.fn(), getSession: vi.fn() }));
vi.mock("@/app/(app)/settings/modules/actions", () => ({ setModuleEnabledAction: vi.fn() }));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { revalidatePath } from "next/cache";

import { setModuleGrantAction } from "@/app/(app)/platform/centers/[id]/actions";
import { ModulesPanel } from "@/app/(app)/platform/centers/[id]/modules-panel";
import { ModulesForm } from "@/app/(app)/settings/modules/modules-form";
import { ASSISTANT_MODULE_OFF, nivaForAdminsOn } from "@/lib/assistant/settings";
import { buildModuleRowsFromStates, moduleStatus, switchBlocker, switchWarning, type ModuleStateLike } from "@/lib/modules";
import { dbWithReason, loadSession } from "@/lib/session";

import { fakeSession } from "./commands/helpers";

const CENTER = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1150";

const s = (key: string, label: string, sort: number, extra: Partial<ModuleStateLike> = {}): ModuleStateLike => ({
  key,
  label,
  description: `About ${label}`,
  core: false,
  depends_on: [],
  sort,
  availability: "default_on",
  enabled: true,
  switchable: true,
  changed_by: null,
  changed_at: null,
  reason: null,
  granted: true,
  granted_by: null,
  granted_at: null,
  grant_reason: null,
  paused: false,
  waiting_for: [],
  ...extra,
});

// A chamber of commerce (not faith-based): Giving ("Dues & payments") paused by the community, Accounting waiting for it, Store
// waiting for Weaver, Niva enabled by Weaver, Bolis not offered.
const STATES: ModuleStateLike[] = [
  s("people", "Members & families", 1, { core: true, switchable: false }),
  s("giving", "Dues & payments", 4, { depends_on: ["people"], enabled: false, paused: true, changed_by: "u1", changed_at: "2026-10-10T15:00:00Z", reason: "Moving systems" }),
  s("bolis", "Bolis", 5, { depends_on: ["giving"], availability: "not_available", enabled: false, switchable: false, granted: false }),
  s("store", "Store", 6, { depends_on: ["people"], availability: "default_off", enabled: false, granted: false }),
  s("content", "Content & library", 10),
  s("accounting", "Accounting & QuickBooks", 15, { depends_on: ["giving"], enabled: false, waiting_for: ["giving"] }),
  s("niva", "Niva assistant", 17, { depends_on: ["content"], availability: "default_off", granted_by: "p1", granted_at: "2026-10-11T12:00:00Z", grant_reason: "Pilot" }),
];
const rows = buildModuleRowsFromStates(STATES);
const row = (key: string) => rows.find((r) => r.key === key)!;

describe("module rows know the grant, the pause and what they wait for", () => {
  it("reads 0740's columns", () => {
    expect(row("giving")).toMatchObject({ granted: true, paused: true, enabled: false, waitingFor: [] });
    expect(row("accounting")).toMatchObject({ granted: true, paused: false, enabled: false, waitingFor: ["giving"] });
    expect(row("store")).toMatchObject({ granted: false, paused: false, enabled: false, switchable: true });
    expect(row("niva")).toMatchObject({ granted: true, grantedBy: "p1", grantReason: "Pilot", enabled: true });
    expect(row("bolis")).toMatchObject({ granted: false, switchable: false });
    expect(row("people")).toMatchObject({ granted: true, core: true });
  });
  it("before the database update, every offered module counts as granted and off means paused", () => {
    const legacy = buildModuleRowsFromStates([
      { key: "store", label: "My Store", description: null, core: false, depends_on: [], sort: 1, availability: "default_on", enabled: false, switchable: true, changed_by: null, changed_at: null, reason: null },
    ]);
    expect(legacy[0]).toMatchObject({ granted: true, paused: true, waitingFor: [] });
  });
  it("says each state in plain words", () => {
    expect(rows.map((r) => [r.key, moduleStatus(r, rows).text])).toEqual([
      ["people", "Always on"],
      ["giving", "Paused"],
      ["store", "Not enabled by Weaver"],
      ["content", "On"],
      ["accounting", "Off while Dues & payments is off"],
      ["niva", "On"],
      ["bolis", "Not offered"],
    ]);
  });
  it("only a core module and a module Weaver has not enabled block a switch; dependencies warn", () => {
    expect(switchBlocker("store", true, rows)).toBe("Weaver has not enabled Store for this community. Ask Weaver to enable it.");
    expect(switchBlocker("store", false, rows)).toBe("Weaver has not enabled Store for this community. It is off already.");
    expect(switchBlocker("giving", true, rows)).toBeNull();
    expect(switchBlocker("content", false, rows)).toBeNull();
    expect(switchWarning("content", false, rows)).toBe("Niva assistant goes off with it and comes back when Content & library is switched on again.");
    expect(switchBlocker("accounting", false, rows)).toBeNull();
    expect(switchWarning("giving", true, rows)).toBeNull();
  });
});

describe("Settings › Modules", () => {
  const html = renderToStaticMarkup(createElement(ModulesForm, { rows: rows.map((r) => ({ ...r, changedLine: null })), canSwitch: true, kindLabel: "Chamber of commerce" }));
  const block = (key: string) => {
    const start = html.indexOf(`data-module="${key}"`);
    const next = html.indexOf("data-module=", start + 10);
    return html.slice(start, next === -1 ? undefined : next);
  };
  it("greys a module Weaver has not enabled, says so, and gives it no switch (never an empty list)", () => {
    expect(block("store")).toContain('data-state="not_granted"');
    expect(block("store")).toContain("Weaver has not enabled Store for this community. Ask Weaver to enable it.");
    expect(block("store")).toContain("Ask Weaver");
    expect(block("store")).not.toContain('role="switch"');
    expect(block("store")).not.toContain("Starts off");
    expect(html.match(/data-module=/g)?.length).toBe(7);
  });
  it("shows Paused, and Off while the module it needs is off, each with the community's own switch", () => {
    expect(block("giving")).toContain("Paused");
    expect(block("giving")).toContain("Dues &amp; payments module");
    expect(block("accounting")).toContain("Off while Dues &amp; payments is off");
    expect(block("accounting")).toContain("Accounting &amp; QuickBooks module");
    expect(block("niva")).toContain(">On<");
  });
});

describe("Platform › Communities › Modules", () => {
  const html = renderToStaticMarkup(createElement(ModulesPanel, { centerId: CENTER, rows, kindLabel: "Chamber of commerce", tz: "America/Chicago" }));
  it("nests a module under the module it needs, and lists core and not-offered modules without a button", () => {
    const giving = html.indexOf('data-module="giving"');
    const store = html.indexOf('data-module="store"');
    expect(html.indexOf('data-module="accounting"')).toBeGreaterThan(giving);
    expect(html.indexOf('data-module="accounting"')).toBeLessThan(store);
    expect(html.indexOf('data-module="niva"')).toBeGreaterThan(html.indexOf('data-module="content"'));
    expect(html).not.toContain('data-module="people"');
    expect(html).not.toContain('data-module="bolis"');
    expect(html).toContain("Members &amp; families is part of the core platform and always on.");
    expect(html).toContain("Not offered to a Chamber of commerce organization (change the kind of organization to offer them): Bolis.");
  });
  it("offers Enable or Disable with a reason, and says where the state comes from", () => {
    const store = html.slice(html.indexOf('data-module="store"'), html.indexOf('data-module="content"'));
    expect(store).toContain("Waits for Weaver: a Chamber of commerce organization starts it off");
    expect(store).toContain("Enable");
    expect(store).toContain('name="granted" value="true"');
    expect(store).toContain('name="reason"');
    const giving = html.slice(html.indexOf('data-module="giving"'), html.indexOf('data-module="accounting"'));
    expect(giving).toContain("Enabled by default for a Chamber of commerce organization");
    expect(giving).toContain("(paused by the community)");
    expect(giving).toContain("Disable");
    expect(giving).toContain('name="granted" value="false"');
    const niva = html.slice(html.indexOf('data-module="niva"'));
    expect(niva).toContain("Enabled by Weaver");
    expect(niva).toContain("Reason: Pilot");
  });
});

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

describe("setModuleGrantAction", () => {
  const rpc = vi.fn();
  beforeEach(() => {
    rpc.mockReset();
    vi.mocked(revalidatePath).mockReset();
    vi.mocked(loadSession).mockResolvedValue({ status: "ok", session: fakeSession({ isPlatformAdmin: true }) } as never);
    vi.mocked(dbWithReason).mockResolvedValue({ rpc } as never);
  });
  const enable = { center: CENTER, module: "store", label: "Store", granted: "true", reason: "The chamber asked for a store" };

  it("is for the Weaver team only", async () => {
    vi.mocked(loadSession).mockResolvedValue({ status: "ok", session: fakeSession({ isPlatformAdmin: false }) } as never);
    expect(await setModuleGrantAction(null, form(enable))).toEqual({ ok: false, error: "Could not enable Store — only the Weaver team (platform admins) can do this." });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses an out-of-date form and a missing reason, in plain words", async () => {
    expect(await setModuleGrantAction(null, form({ ...enable, granted: "maybe" }))).toMatchObject({ ok: false, error: expect.stringMatching(/the form is out of date/) });
    expect(await setModuleGrantAction(null, form({ ...enable, center: "x" }))).toMatchObject({ ok: false });
    expect(await setModuleGrantAction(null, form({ ...enable, reason: "  " }))).toEqual({ ok: false, error: "Could not enable Store — say why. The reason is kept in the audit log." });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("enables with the reason in the audit log, and says what happened", async () => {
    rpc.mockResolvedValue({ data: { module: "store", granted: true, paused: false, enabled: true }, error: null });
    expect(await setModuleGrantAction(null, form(enable))).toEqual({ ok: true, message: "Store enabled and on · audit logged" });
    expect(rpc).toHaveBeenCalledWith("set_module_grant", { p_center: CENTER, p_module: "store", p_granted: true, p_reason: "The chamber asked for a store" });
    expect(vi.mocked(dbWithReason)).toHaveBeenCalledWith(expect.anything(), "The chamber asked for a store");
    expect(revalidatePath).toHaveBeenCalledWith(`/platform/centers/${CENTER}`);
    rpc.mockResolvedValue({ data: { granted: true, paused: true, enabled: false }, error: null });
    expect(await setModuleGrantAction(null, form(enable))).toMatchObject({ message: "Store enabled · the community has it paused, so it stays off until they switch it on · audit logged" });
    rpc.mockResolvedValue({ data: { granted: false, paused: false, enabled: false }, error: null });
    expect(await setModuleGrantAction(null, form({ ...enable, granted: "false", reason: "Trial over" }))).toMatchObject({
      message: "Store disabled · its records are kept and hidden until it is enabled again · audit logged",
    });
  });
  it("passes the database's refusal on, and asks for the 2FA code when the database wants it", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "Store is already enabled for this community. There is nothing to change." } });
    const r = await setModuleGrantAction(null, form(enable));
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/^Could not enable Store — .*already enabled/) });
    rpc.mockResolvedValue({ data: null, error: { code: "CCSTP", message: "This needs a fresh 2FA check.", details: "platform.module_grant" } });
    expect(await setModuleGrantAction(null, form(enable))).toMatchObject({ ok: false, stepUp: true });
    spy.mockRestore();
  });
});

describe("Niva for admins follows the niva module", () => {
  const on = { assistant: { enabled: true } };
  it("is on only when the community's switch is on and the module is on", () => {
    expect(nivaForAdminsOn(on, { modulesOff: [] })).toBe(true);
    expect(nivaForAdminsOn(on, {})).toBe(true);
    expect(nivaForAdminsOn(on, { modulesOff: ["niva"] })).toBe(false);
    expect(nivaForAdminsOn({ assistant: { enabled: false } }, { modulesOff: [] })).toBe(false);
    expect(ASSISTANT_MODULE_OFF).toMatch(/Niva assistant module is not on/);
  });
});
