import { describe, expect, it } from "vitest";

import {
  EMPTY_CAMPAIGN,
  canPublishInto,
  checkQuickCampaign,
  checkQuickOpportunity,
  defaultCampaignId,
  quickCampaignForm,
  quickCreateHref,
  quickGoalCents,
  quickOpportunityInput,
  quickOpportunityTypes,
  readCreateCommand,
  readQuickParams,
  rowsNeeded,
  type QuickOpportunity,
} from "@/lib/giving-campaigns/quick";
import { LEGACY_KIND, NEUTRAL_KIND } from "@/lib/kind";
import { word } from "@/lib/wording";

const PUBLISHED = "11111111-1111-4111-8111-111111111111";
const DRAFT = "22222222-2222-4222-8222-222222222222";
const FUND = "33333333-3333-4333-8333-333333333333";
const campaigns = [
  { id: DRAFT, name: "Spring gala", status: "draft" },
  { id: PUBLISHED, name: "Community hall roof", status: "published" },
];

describe("New campaign: name, goal, dates, fund", () => {
  it("a name is enough; the rest is optional", () => {
    expect(checkQuickCampaign({ ...EMPTY_CAMPAIGN, name: "Building fund" })).toBeNull();
    expect(checkQuickCampaign({ ...EMPTY_CAMPAIGN, name: "  " })).toBe("Could not create the campaign — give it a name.");
    expect(checkQuickCampaign({ ...EMPTY_CAMPAIGN, name: "x".repeat(161) })).toBe("Could not create the campaign — the name is longer than 160 characters.");
  });

  it("the goal is an amount in integer cents, in any currency's symbol, or nothing", () => {
    expect(quickGoalCents({ goal: "25,000.50" })).toBe(2_500_050);
    expect(quickGoalCents({ goal: "₹1,25,000" })).toBe(12_500_000);
    expect(quickGoalCents({ goal: "" })).toBeNull();
    expect(checkQuickCampaign({ ...EMPTY_CAMPAIGN, name: "Roof", goal: "lots" })).toBe("Could not create the campaign — the goal must be an amount like 25000.00.");
    expect(checkQuickCampaign({ ...EMPTY_CAMPAIGN, name: "Roof", goal: "0" })).toBe("Could not create the campaign — the goal must be an amount like 25000.00.");
  });

  it("dates are optional and must be in order", () => {
    expect(checkQuickCampaign({ ...EMPTY_CAMPAIGN, name: "Roof", startsOn: "2026-11-01", endsOn: "2026-10-01" })).toBe("Could not create the campaign — it ends before it starts.");
    expect(checkQuickCampaign({ ...EMPTY_CAMPAIGN, name: "Roof", startsOn: "1/11/2026" })).toBe("Could not create the campaign — a date is not valid.");
    expect(checkQuickCampaign({ ...EMPTY_CAMPAIGN, name: "Roof", startsOn: "2026-10-01" })).toBeNull();
  });

  it("builds what the existing createCampaignAction reads: a general draft, the fund only when it is an id", () => {
    const f = quickCampaignForm({ name: " Roof ", goal: "50000", startsOn: "2026-09-01", endsOn: "", fundId: FUND });
    expect(Object.fromEntries(f.entries())).toEqual({ name: "Roof", kind: "general", fund_id: FUND, goal: "50000", starts_on: "2026-09-01", ends_on: "" });
    expect(quickCampaignForm({ ...EMPTY_CAMPAIGN, name: "Roof", fundId: "x" }).get("fund_id")).toBe("");
  });
});

describe("New opportunity: four questions", () => {
  const q = (patch: Partial<QuickOpportunity> = {}): QuickOpportunity => ({
    name: "Roof tiles",
    type: "amount",
    rows: [
      { label: "", amount: "50" },
      { label: "", amount: "100" },
    ],
    campaignId: PUBLISHED,
    publish: true,
    ...patch,
  });

  it("starts on a published campaign so it can be published at once", () => {
    expect(defaultCampaignId(campaigns)).toBe(PUBLISHED);
    expect(defaultCampaignId([campaigns[0]])).toBe(DRAFT);
    expect(defaultCampaignId([])).toBe("");
    expect(canPublishInto(campaigns, PUBLISHED)).toBe(true);
    expect(canPublishInto(campaigns, DRAFT)).toBe(false);
  });

  it("checks in the server's words", () => {
    expect(checkQuickOpportunity(q(), campaigns)).toBeNull();
    expect(checkQuickOpportunity(q({ name: "" }), campaigns)).toBe("Could not publish the opportunity — give it a name.");
    expect(checkQuickOpportunity(q({ campaignId: "" }), campaigns)).toBe("Could not publish the opportunity — choose the campaign it belongs to.");
    expect(checkQuickOpportunity(q({ campaignId: DRAFT }), campaigns)).toBe(
      "Could not publish the opportunity — its campaign is draft; publish the campaign first, or save this as a draft.",
    );
    expect(checkQuickOpportunity(q({ campaignId: DRAFT, publish: false }), campaigns)).toBeNull();
    expect(checkQuickOpportunity(q({ rows: [{ label: "", amount: "" }] }), campaigns)).toBe("Could not publish the opportunity — add at least one preset amount.");
    expect(checkQuickOpportunity(q({ rows: [{ label: "", amount: "abc" }] }), campaigns)).toContain("is not an amount");
    expect(checkQuickOpportunity(q({ type: "tier", rows: [{ label: "Gold", amount: "" }] }), campaigns)).toBe('Could not publish the opportunity — enter an amount for "Gold", like 251.');
    expect(checkQuickOpportunity(q({ type: "open", rows: [] }), campaigns)).toBeNull();
  });

  it("everything else is the full builder's default (alert drafted for review, no recurring, active)", () => {
    const input = quickOpportunityInput(q({ type: "tier", rows: [{ label: "Gold", amount: "5000" }] }));
    expect(input).toEqual({
      id: null,
      name: "Roof tiles",
      subtitle: "",
      kind: "tier",
      campaignId: PUBLISHED,
      allowAnonymous: true,
      rows: [{ label: "Gold", amount: "5000" }],
      audience: ["all_members"],
      publish: true,
      allowRecurring: false,
      recurringFrequencies: [],
      notificationTemplateKey: "",
      active: true,
      visibleFrom: "",
      visibleUntil: "",
    });
    // Preset amounts carry no names; an open amount carries no rows.
    expect(quickOpportunityInput(q({ rows: [{ label: "left over", amount: "50" }] })).rows).toEqual([{ label: "", amount: "50" }]);
    expect(quickOpportunityInput(q({ type: "open" })).rows).toEqual([]);
    expect(rowsNeeded("multi")).toBe("named");
  });

  it("the fixed list is named in the kind's own words: no tradition word for a community without one", () => {
    const neutral = quickOpportunityTypes(word(NEUTRAL_KIND, "pledge_list_type")).map((t) => t.label);
    expect(neutral).toEqual(["Open amount", "Preset amounts + open", "Sponsorship tiers", "Fixed item list (multi-select)"]);
    expect(neutral.join(" ")).not.toMatch(/pujan|boli|labh/i);
    expect(quickOpportunityTypes(word(LEGACY_KIND, "pledge_list_type"))[3].label).toBe("Fixed pujan list (multi-select)");
  });
});

describe("the box: 'new campaign …' opens the sheet already named", () => {
  it("reads a create command and nothing else", () => {
    expect(readCreateCommand("new campaign Building fund")).toEqual({ what: "campaign", name: "Building fund" });
    expect(readCreateCommand("Create an opportunity: Gala tables")).toEqual({ what: "opportunity", name: "Gala tables" });
    expect(readCreateCommand("set up campaign")).toEqual({ what: "campaign", name: "" });
    expect(readCreateCommand("campaign progress")).toBeNull();
    expect(readCreateCommand("200 check patel")).toBeNull();
    expect(readCreateCommand("new campaigner")).toBeNull();
  });

  it("the address round-trips through the page's parameters", () => {
    const href = quickCreateHref({ what: "opportunity", name: "Gala & tables" });
    expect(href).toBe("/giving/campaigns?view=opportunities&new=opportunity&name=Gala+%26+tables");
    const sp = new URL(href, "https://x.test").searchParams;
    expect(readQuickParams(sp.get("new"), sp.get("name"))).toEqual({ sheet: "opportunity", name: "Gala & tables" });
    expect(quickCreateHref({ what: "campaign", name: "" })).toBe("/giving/campaigns?new=campaign");
    expect(readQuickParams("something", "x")).toEqual({ sheet: null, name: "" });
  });
});
