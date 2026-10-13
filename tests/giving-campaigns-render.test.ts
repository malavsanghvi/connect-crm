import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// Giving › Campaigns & opportunities rendered once on the server (the repo has no browser test environment). The rows and
// sheets call Server Actions; here nothing is called, only drawn.
vi.mock("server-only", () => ({}));
vi.mock("@/app/(app)/giving/opportunities/actions", () => ({
  saveOpportunityAction: vi.fn(),
  previewAudienceAction: vi.fn(),
  setOpportunityStatusAction: vi.fn(),
  setOpportunityActiveAction: vi.fn(),
}));
vi.mock("@/app/(app)/giving/opportunities/campaigns/actions", () => ({
  createCampaignAction: vi.fn(),
  setCampaignStatusAction: vi.fn(),
  setCampaignActiveAction: vi.fn(),
}));
// The Bolis and Labh views are the existing screens (async, they read the database): stand-ins here.
vi.mock("@/app/(app)/giving/campaigns/bolis-view", () => ({ BolisView: ({ label }: { label: string }) => `BOLIS SCREEN (${label})` }));
vi.mock("@/app/(app)/giving/labh/fulfilment", () => ({ LabhFulfilment: ({ retryHref }: { retryHref: string }) => `LABH SCREEN ${retryHref}` }));
let pathname = "/giving/campaigns";
vi.mock("next/navigation", async (actual) => ({
  ...(await actual<typeof import("next/navigation")>()),
  usePathname: () => pathname,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const look = { value: "v2" as string | undefined };
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (look.value ? { value: look.value } : undefined) }) }));
const session = {
  permissions: [] as string[],
  isPlatformAdmin: false,
  modulesOff: [] as string[],
  kind: undefined as unknown,
  center: { id: "c", name: "Lakeside Community Club", short_name: null },
};
vi.mock("@/lib/session", () => ({ getSession: async () => session, loadSession: async () => ({ status: "ok", session }) }));
const loaded: unknown[] = [];
vi.mock("@/lib/data/giving-campaigns", async () => {
  const f = await import("@/lib/giving-campaigns/fixtures");
  return {
    loadCampaignsModel: async (s: typeof session, p: { view?: string | null; newSheet?: string | null; name?: string | null }) => {
      loaded.push(p);
      const role = s.permissions.includes("giving.manage") ? "treasurer" : s.permissions.includes("giving.view") ? "viewer" : "volunteer";
      return { ...f.sampleCampaignsModel({ role, kind: s.kind as never, modulesOff: s.modulesOff, view: p.view, newSheet: p.newSheet, name: p.name }), canOpenSettings: true };
    },
  };
});

import BolisLayout from "@/app/(app)/bolis/layout";
import CampaignsRoute from "@/app/(app)/giving/campaigns/page";
import LabhPage from "@/app/(app)/giving/labh/page";
import GivingCampaignsPreview from "@/app/dev/giving-campaigns/page";
import { CampaignsTab } from "@/components/giving-campaigns/campaigns-tab";
import { GivingTabsProvider } from "@/components/giving-today/giving-tabs";
import { LookProvider } from "@/components/shell/look-context";
import { ModulesProvider, ModuleTabs } from "@/components/shell/module-tabs";
import { CAMPAIGN_ROLE_PERMISSIONS, sampleCampaignsModel } from "@/lib/giving-campaigns/fixtures";
import { givingTabs } from "@/lib/giving-today/tabs";
import { LEGACY_KIND, NEUTRAL_KIND, type KindProfile } from "@/lib/kind";
import { visibleNav } from "@/lib/permissions";

const h = createElement as unknown as (type: unknown, props: unknown, ...children: unknown[]) => ReactElement;
const html = (el: ReactElement) => renderToStaticMarkup(el);
const tab = (opts: Parameters<typeof sampleCampaignsModel>[0] = {}, children?: string) => html(h(CampaignsTab, { model: sampleCampaignsModel(opts) }, children));
const route = async (sp: Record<string, string> = {}) => html((await CampaignsRoute({ searchParams: Promise.resolve(sp) })) as ReactElement);

const CHAMBER: KindProfile = {
  ...NEUTRAL_KIND,
  key: "chamber_of_commerce",
  label: "Chamber of commerce",
  modules: { ...NEUTRAL_KIND.modules, giving_opportunities: { availability: "default_on", label: "Sponsorships" } },
};

afterEach(() => {
  vi.unstubAllEnvs();
  look.value = "v2";
  pathname = "/giving/campaigns";
  session.permissions = [];
  session.modulesOff = [];
  session.kind = NEUTRAL_KIND;
});
session.kind = NEUTRAL_KIND;

describe("Campaigns view for a treasurer in a neutral club that counts in Canadian dollars", () => {
  const out = tab();

  it("one tab row with Campaigns & opportunities lit, its views as chips, and the quick-create buttons", () => {
    expect(out).toContain('aria-label="Giving sections"');
    expect(out).toMatch(/aria-current="page"[^>]*>Campaigns &amp; opportunities</);
    expect(out).toContain('aria-label="Campaigns &amp; opportunities views"');
    expect(out).toMatch(/aria-current="page"[^>]*>Campaigns<\/a>/);
    expect(out).toContain('href="/giving/campaigns?view=opportunities"');
    expect(out).toContain(">New campaign</button>");
    expect(out).toContain(">New opportunity</button>");
    // No Bolis or Labh for a kind without them, and no tradition's word anywhere.
    expect(out).not.toMatch(/boli|labh|pujan|bhandar/i);
  });

  it("goal progress against each campaign's own goal and dates; no goal means no bar and no invented target", () => {
    expect(out).toContain("Pledged $12,400.00 of $50,000.00 (24%)");
    expect(out).toContain("Received $8,000.00 (16%)");
    expect(out).toContain("37 pledges");
    expect(out).toContain("43 of 122 days passed");
    expect(out).toContain("No goal set · $3,200.00 pledged");
    expect(out).toContain("Running for 13 days, no end date");
    expect(out).toContain("Starts in 139 days");
    expect(out).toContain("Pledged $12,000.00 of $10,000.00 (120%)");
    expect(out).toContain("Ended");
    expect(out).toContain("Building fund (restricted)");
    // Four campaigns, three of them with a goal bar.
    expect(out.match(/data-testid="campaign-row"/g)).toHaveLength(4);
    expect(out.match(/role="img" aria-label="Pledged/g)).toHaveLength(3);
    expect(out).toContain("2 archived campaigns are not shown.");
  });

  it("running campaigns first, and each row acts with the existing actions", () => {
    expect(out.indexOf("Community hall roof")).toBeLessThan(out.indexOf("Spring gala"));
    expect(out.indexOf("Spring gala")).toBeLessThan(out.indexOf("Summer camp scholarships"));
    for (const label of ["Publish", "Close", "Reopen", "Archive", "Hide"]) expect(out).toContain(`>${label}<`);
  });

  it("someone who may only look sees the progress, with no buttons", () => {
    const viewer = tab({ role: "viewer" });
    expect(viewer).toContain("Pledged $12,400.00 of $50,000.00 (24%)");
    expect(viewer).not.toContain("New campaign");
    expect(viewer).not.toContain(">Publish<");
    expect(viewer).not.toContain(">Hide<");
  });
});

describe("Opportunities view", () => {
  const out = tab({ view: "opportunities" });

  it("lists what members choose, with the full builder one click away", () => {
    expect(out).toMatch(/aria-current="page"[^>]*>Opportunities<\/a>/);
    expect(out.match(/data-testid="opportunity-row"/g)).toHaveLength(3);
    expect(out).toContain("Community hall roof · Preset amounts + open · 37 pledges · 24% of goal");
    expect(out).toContain("Spring gala · Sponsorship tiers · 0 of 12 taken");
    expect(out).toContain("Hidden from members");
    expect(out).toContain('href="/giving/opportunities?edit=00000000-0000-4000-8000-000000000011"');
    expect(out).toContain(">Open the full builder</a>");
    expect(out).not.toMatch(/pujan/i);
  });

  it("a chamber reads its own word for the add-on", () => {
    const chamber = tab({ kind: CHAMBER, view: "opportunities" });
    expect(chamber).toMatch(/aria-current="page"[^>]*>Sponsorships<\/a>/);
    expect(chamber).toContain(">Sponsorships</h2>");
  });
});

describe("views that cannot open say why, never an empty page", () => {
  it("Opportunities switched off: the tab is Campaigns, no chips, no New opportunity", () => {
    const out = tab({ modulesOff: ["giving_opportunities"] });
    expect(out).toMatch(/aria-current="page"[^>]*>Campaigns</);
    expect(out).not.toContain("Campaigns &amp; opportunities");
    expect(out).not.toContain("views");
    expect(out).toContain(">New campaign</button>");
    expect(out).not.toContain("New opportunity");
  });

  it("the route draws the switched-off card, the not-offered card and the no-access card", async () => {
    session.permissions = CAMPAIGN_ROLE_PERMISSIONS.treasurer;
    session.modulesOff = ["giving_opportunities"];
    const off = await route({ view: "opportunities" });
    expect(off).toContain("Opportunities is switched off");
    expect(off).toContain("The Opportunities module is switched off for Lakeside Community Club.");
    expect(off).toContain('href="/settings/modules"');

    session.modulesOff = [];
    session.kind = CHAMBER;
    const notOffered = await route({ view: "labh" });
    expect(notOffered).toContain("Special-day offerings is not part of a Chamber of commerce organization.");
    expect(notOffered).not.toContain("LABH SCREEN");

    session.kind = LEGACY_KIND;
    session.permissions = ["giving.view"];
    expect(await route({ view: "bolis" })).toContain("You don&#x27;t have access to this area");

    session.permissions = ["giving.record_offline"];
    expect(await route()).toContain("You don&#x27;t have access to this area");
  });
});

describe("Bolis and Labh as views (a kind that has them)", () => {
  it("chips for every view, the existing screens inside", async () => {
    session.kind = LEGACY_KIND;
    session.permissions = CAMPAIGN_ROLE_PERMISSIONS.treasurer;
    const bolis = await route({ view: "bolis" });
    expect(bolis).toMatch(/aria-current="page"[^>]*>Bolis<\/a>/);
    expect(bolis).toContain('href="/giving/campaigns?view=labh"');
    expect(bolis).toContain("BOLIS SCREEN (Bolis)");
    expect(bolis).not.toContain('data-testid="campaign-row"');
    const labh = await route({ view: "labh" });
    expect(labh).toMatch(/aria-current="page"[^>]*>Labh<\/a>/);
    expect(labh).toContain("LABH SCREEN /giving/campaigns?view=labh");
  });

  it("the classic Labh page still draws its own header around the same screen", async () => {
    session.kind = LEGACY_KIND;
    session.permissions = CAMPAIGN_ROLE_PERMISSIONS.treasurer;
    const page = (await LabhPage()) as ReactElement<{ retryHref: string }>;
    expect(page.props.retryHref).toBe("/giving/labh");
    session.permissions = [];
    expect(html((await LabhPage()) as ReactElement)).toContain("You don&#x27;t have access to this area");
  });
});

describe("the route and the shell", () => {
  it("the classic look keeps its address (Campaigns under Opportunities)", async () => {
    look.value = undefined;
    await expect(CampaignsRoute({ searchParams: Promise.resolve({ view: "bolis" }) })).rejects.toMatchObject({
      digest: expect.stringContaining("/giving/opportunities/campaigns?view=bolis"),
    });
  });

  it("passes the view and the box's sheet on to the loader", async () => {
    session.permissions = CAMPAIGN_ROLE_PERMISSIONS.treasurer;
    await route({ view: "opportunities", new: "opportunity", name: "Gala tables" });
    expect(loaded.at(-1)).toEqual({ view: "opportunities", newSheet: "opportunity", name: "Gala tables" });
    // A sheet is drawn on the document body: the server never draws it, the browser opens it.
    expect(await route({ new: "campaign", name: "Roof" })).not.toContain("giving-sheet");
  });

  it("the Bolis screens draw Giving's tab row in the New look instead of the module pills; classic untouched", async () => {
    session.permissions = CAMPAIGN_ROLE_PERMISSIONS.treasurer;
    session.kind = LEGACY_KIND;
    const v2 = (await BolisLayout({ children: "page" })) as ReactElement<{ tabs: { key: string }[] }>;
    expect(v2.type).toBe(GivingTabsProvider);
    look.value = undefined;
    expect(((await BolisLayout({ children: "page" })) as ReactElement).type).not.toBe(GivingTabsProvider);

    pathname = "/bolis";
    const ctx = { permissions: CAMPAIGN_ROLE_PERMISSIONS.treasurer, isPlatformAdmin: false, modulesOff: [], kind: LEGACY_KIND };
    const draw = (lk: "classic" | "v2") =>
      html(h(LookProvider, { look: lk }, h(ModulesProvider, { modules: visibleNav(ctx) }, h(GivingTabsProvider, { tabs: givingTabs(ctx) }, h(ModuleTabs, null)))));
    const row = draw("v2");
    expect(row).toMatch(/aria-current="page"[^>]*>Campaigns &amp; opportunities</);
    expect(row).not.toContain("Giving areas");
    expect(draw("classic")).toContain(">Digital bolis<");
  });
});

describe("the dev preview", () => {
  const call = (sp: Record<string, string> = {}) => GivingCampaignsPreview({ searchParams: Promise.resolve(sp) });
  it("returns notFound() in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(call()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });
  it("draws the tab with invented data, its views and its switched-off cards", async () => {
    const out = html(await call());
    expect(out).toContain("DEV PREVIEW · SAMPLE DATA");
    expect(out).toContain("Community hall roof");
    expect(html(await call({ kind: "tradition", view: "bolis" }))).toContain("existing Bolis screen");
    expect(html(await call({ view: "opportunities", off: "giving_opportunities" }))).toContain("Opportunities is switched off");
    expect(html(await call({ role: "volunteer" }))).toContain("You don&#x27;t have access to this area");
  });
});
