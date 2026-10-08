import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The pages call server actions and read the session; here nothing is called, only rendered.
vi.mock("@/app/(app)/settings/modules/actions", () => ({ setModuleEnabledAction: vi.fn() }));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));
vi.mock("@/app/(app)/platform/centers/[id]/actions", () => ({ previewKindChangeAction: vi.fn(), changeKindAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const loadSession = vi.fn();
vi.mock("@/lib/session", () => ({ loadSession: () => loadSession() }));

import { ModulesForm } from "@/app/(app)/settings/modules/modules-form";
import { KindPanel } from "@/app/(app)/platform/centers/[id]/kind-panel";
import { KindGate, ModuleGate } from "@/components/module-gate";
import { toExperiences } from "@/lib/experiences";
import { LEGACY_KIND, parseKindProfile } from "@/lib/kind";
import { buildModuleRowsFromStates } from "@/lib/modules";

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

const state = (key: string, label: string, sort: number, availability: string, extra: Record<string, unknown> = {}) => ({
  key,
  label,
  description: `About ${label}`,
  core: false,
  depends_on: [] as string[],
  sort,
  availability,
  enabled: availability === "default_on",
  switchable: availability !== "not_available",
  changed_by: null,
  changed_at: null,
  reason: null,
  ...extra,
});

describe("Settings › Modules for a kind that does not offer every module", () => {
  const rows = buildModuleRowsFromStates([
    state("people", "Members & families", 1, "default_on", { core: true, switchable: false }),
    state("events", "Events & RSVP", 2, "default_on"),
    state("store", "Store", 3, "default_off"),
    state("bolis", "Bolis", 4, "not_available"),
  ]).map((r) => ({ ...r, changedLine: null }));
  const html = render(createElement(ModulesForm, { rows, canSwitch: true, kindLabel: "Chamber of commerce" }));

  it("shows a module the kind never offers as unavailable, with no switch", () => {
    const bolis = html.slice(html.indexOf('data-module="bolis"'));
    expect(bolis).toContain("Bolis is not part of a Chamber of commerce organization.");
    expect(bolis).toContain("Weaver can change the organization");
    expect(bolis).toContain("No switch");
    expect(bolis).not.toContain('role="switch"');
    expect(bolis).not.toContain("Bolis module");
  });
  it("lists it last", () => {
    expect(html.indexOf('data-module="bolis"')).toBeGreaterThan(html.indexOf('data-module="store"'));
  });
  it("a module that starts off keeps its switch, and says it starts off", () => {
    const store = html.slice(html.indexOf('data-module="store"'), html.indexOf('data-module="bolis"'));
    expect(store).toContain("Starts off for Chamber of commerce organizations");
    expect(store).toContain("Store module");
  });
});

describe("Settings › Modules for a Jain Center reads as before", () => {
  it("every module has its switch and none is marked", () => {
    const rows = buildModuleRowsFromStates([state("people", "Members & families", 1, "default_on", { core: true, switchable: false }), state("bolis", "Bolis", 2, "default_on")]).map((r) => ({
      ...r,
      changedLine: null,
    }));
    const html = render(createElement(ModulesForm, { rows, canSwitch: true, kindLabel: "Jain Center" }));
    expect(html).toContain("Bolis module");
    expect(html).not.toContain("is not part of");
    expect(html).not.toContain("Starts off");
    expect(html).not.toContain("No switch");
  });
});

describe("the module gate", () => {
  const chamber = parseKindProfile({
    category: { key: "chamber_of_commerce", label: "Chamber of commerce", faith_based: false, uses_tradition: false, terms: { greeting: "Welcome" } },
    modules: { bolis: { availability: "not_available", label: null }, giving: { availability: "default_on", label: "Dues & payments" } },
  })!;
  const session = (kind: typeof LEGACY_KIND, modulesOff: string[]) => ({
    status: "ok",
    session: { kind, modulesOff, permissions: [], isPlatformAdmin: false, isOwner: false, center: { name: "Houston Chamber", short_name: null } },
  });
  beforeEach(() => loadSession.mockReset());

  it("says a module the kind never offers is not part of it, with no link to a switch", async () => {
    loadSession.mockResolvedValue(session(chamber, ["bolis"]));
    const html = render(await ModuleGate({ module: "bolis", children: createElement("p", null, "the page") }));
    expect(html).toContain("Bolis is not part of a Chamber of commerce organization.");
    expect(html).toContain("Houston Chamber is set up as a Chamber of commerce organization");
    expect(html).not.toContain("the page");
    expect(html).not.toContain("Settings › Modules");
  });
  it("says a module the organization switched off is switched off, as before", async () => {
    loadSession.mockResolvedValue({ status: "ok", session: { ...session(chamber, ["giving"]).session, permissions: ["settings.manage"] } });
    const html = render(await ModuleGate({ module: "giving", children: createElement("p", null, "the page") }));
    expect(html).toContain("Dues &amp; payments is switched off");
    expect(html).toContain("An administrator can switch it on in Settings › Modules.");
  });
  it("a Jain Center's gate reads exactly as it always did", async () => {
    loadSession.mockResolvedValue(session(LEGACY_KIND, ["bolis"]));
    const html = render(await ModuleGate({ module: "bolis", children: createElement("p", null, "the page") }));
    expect(html).toContain("Bolis is switched off");
    expect(html).toContain("The Bolis module is switched off for Houston Chamber. An administrator can switch it on in Settings › Modules.");
    expect(html).not.toContain("not part of");
  });
  it("shows the page when the module is on", async () => {
    loadSession.mockResolvedValue(session(chamber, []));
    const html = render(await ModuleGate({ module: "bolis", children: createElement("p", null, "the page") }));
    expect(html).toContain("the page");
  });
});

describe("the gate for a part only some kinds have (Labh)", () => {
  const chamberKind = parseKindProfile({
    category: { key: "chamber_of_commerce", label: "Chamber of commerce", faith_based: false, uses_tradition: false, terms: {} },
    modules: { bolis: { availability: "not_available", label: null } },
  })!;
  const session = (kind: typeof LEGACY_KIND) => ({ status: "ok", session: { kind, center: { name: "Houston Chamber", short_name: null } } });
  beforeEach(() => loadSession.mockReset());
  it("says Labh is not part of a chamber of commerce", async () => {
    loadSession.mockResolvedValue(session(chamberKind));
    const html = render(await KindGate({ feature: "labh", label: "Labh fulfillment", children: createElement("p", null, "the page") }));
    expect(html).toContain("Labh fulfillment is not part of a Chamber of commerce organization.");
    expect(html).toContain("does not have Labh fulfillment");
    expect(html).not.toContain("the page");
  });
  it("shows the page for a Jain Center", async () => {
    loadSession.mockResolvedValue(session(LEGACY_KIND));
    const html = render(await KindGate({ feature: "labh", label: "Labh fulfillment", children: createElement("p", null, "the page") }));
    expect(html).toContain("the page");
    expect(html).not.toContain("not part of");
  });
});

describe("Platform › the organization › Kind of organization", () => {
  const kinds = toExperiences([
    { key: "jain_temple", label: "Jain Temple", description: "Jain temples and societies", family_key: "jain", family_label: "Jain", faith_based: true, active: true, sort: 1 },
    { key: "chamber_of_commerce", label: "Chamber of commerce", faith_based: false, active: false, sort: 2 },
  ]);
  it("shows the current kind and offers Change…", () => {
    const html = render(createElement(KindPanel, { centerId: "c1", centerName: "Houston Chamber", currentKey: "chamber_of_commerce", experiences: kinds, sandbox: true }));
    expect(html).toContain("Chamber of commerce");
    expect(html).toContain("Preview only");
    expect(html).toContain("Change…");
    expect(html).toContain("fresh 2FA check");
    expect(html).toContain("Nothing is deleted");
  });
});
