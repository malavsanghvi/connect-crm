import { describe, expect, it } from "vitest";

import { campaignViews, campaignsTabLabel, labhLabel, pickView, shownViews, type ViewContext } from "@/lib/giving-campaigns/views";
import { activeGivingTab, givingTabs } from "@/lib/giving-today/tabs";
import { LEGACY_KIND, NEUTRAL_KIND, type KindProfile } from "@/lib/kind";

const TREASURER = ["giving.view", "giving.manage", "giving.record_offline", "bolis.view", "bolis.manage"];
const ctx = (permissions: string[] = TREASURER, modulesOff: string[] = [], kind: KindProfile = NEUTRAL_KIND): ViewContext => ({ permissions, isPlatformAdmin: false, modulesOff, kind });
const states = (c: ViewContext) => Object.fromEntries(campaignViews(c).map((v) => [v.key, v.state]));

// A chamber of commerce: no Bolis, no Labh, and its own name for the Opportunities add-on.
const CHAMBER: KindProfile = {
  ...NEUTRAL_KIND,
  key: "chamber_of_commerce",
  label: "Chamber of commerce",
  modules: { ...NEUTRAL_KIND.modules, giving_opportunities: { availability: "default_on", label: "Sponsorships" } },
};

describe("the views of Campaigns & opportunities", () => {
  it("a neutral community: Campaigns and Opportunities; Bolis and Labh are not part of its kind", () => {
    expect(states(ctx())).toEqual({ campaigns: "on", opportunities: "on", bolis: "not_offered", labh: "not_offered" });
    expect(shownViews(campaignViews(ctx())).map((v) => v.label)).toEqual(["Campaigns", "Opportunities"]);
    expect(labhLabel(NEUTRAL_KIND)).toBe("Special-day offerings");
  });

  it("a kind with the tradition sees Bolis and Labh, in its own words", () => {
    const views = campaignViews(ctx(TREASURER, [], LEGACY_KIND));
    expect(views.map((v) => [v.key, v.label, v.state])).toEqual([
      ["campaigns", "Campaigns", "on"],
      ["opportunities", "Opportunities", "on"],
      ["bolis", "Bolis", "on"],
      ["labh", "Labh", "on"],
    ]);
    expect(views.map((v) => v.href)).toEqual(["/giving/campaigns", "/giving/campaigns?view=opportunities", "/giving/campaigns?view=bolis", "/giving/campaigns?view=labh"]);
  });

  it("a module the community switched off says so (Giving off takes every add-on with it)", () => {
    expect(states(ctx(TREASURER, ["giving_opportunities", "bolis", "labh"], LEGACY_KIND))).toEqual({ campaigns: "on", opportunities: "off", bolis: "off", labh: "off" });
    expect(states(ctx(TREASURER, ["giving"], LEGACY_KIND))).toMatchObject({ opportunities: "off", bolis: "off", labh: "off" });
  });

  it("roles that do not reach a view say so instead of an empty list", () => {
    expect(states(ctx(["bolis.view"], [], LEGACY_KIND))).toEqual({ campaigns: "no_access", opportunities: "no_access", bolis: "on", labh: "no_access" });
    expect(states(ctx(["giving.record_offline"]))).toMatchObject({ campaigns: "no_access", opportunities: "no_access" });
  });

  it("a chamber reads its own name for opportunities and never meets Bolis or Labh", () => {
    const views = campaignViews(ctx(TREASURER, [], CHAMBER));
    expect(shownViews(views).map((v) => v.label)).toEqual(["Campaigns", "Sponsorships"]);
    expect(views.find((v) => v.key === "bolis")?.state).toBe("not_offered");
    expect(views.find((v) => v.key === "labh")?.state).toBe("not_offered");
  });

  it("picks the asked view (even one that cannot open, to say why), else the first that can", () => {
    const views = campaignViews(ctx(TREASURER, ["giving_opportunities"]));
    expect(pickView(views, "opportunities")?.state).toBe("off");
    expect(pickView(views, undefined)?.key).toBe("campaigns");
    expect(pickView(views, "nonsense")?.key).toBe("campaigns");
    expect(pickView(campaignViews(ctx(["bolis.view"], [], LEGACY_KIND)), null)?.key).toBe("bolis");
    expect(pickView(campaignViews(ctx(["giving.record_offline"])), null)).toBeNull();
  });

  it("the tab is called Campaigns while Opportunities is off", () => {
    expect(campaignsTabLabel(campaignViews(ctx()))).toBe("Campaigns & opportunities");
    expect(campaignsTabLabel(campaignViews(ctx(TREASURER, ["giving_opportunities"])))).toBe("Campaigns");
  });
});

describe("Giving's tab row folds Bolis and Labh into Campaigns & opportunities", () => {
  const tabs = givingTabs({ ...ctx(TREASURER, [], LEGACY_KIND), permissions: [...TREASURER, "accounting.close"] });

  it("no Bolis or Labh tab of their own; the Campaigns tab opens the New-look tab", () => {
    expect(tabs.map((t) => t.key)).not.toContain("bolis");
    expect(tabs.map((t) => t.key)).not.toContain("labh");
    expect(tabs.find((t) => t.key === "campaigns")).toMatchObject({ label: "Campaigns & opportunities", href: "/giving/campaigns" });
  });

  it("the Bolis screens, Labh and the full builders light the Campaigns tab", () => {
    for (const path of ["/giving/campaigns", "/giving/opportunities", "/giving/opportunities/campaigns", "/giving/labh", "/bolis", "/bolis/upload"]) {
      expect(activeGivingTab(tabs, path)).toBe("campaigns");
    }
  });
});
