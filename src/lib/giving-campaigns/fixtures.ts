// Invented data for Giving › Campaigns & opportunities (New look): a neutral community club that keeps its books in Canadian
// dollars, so the dev preview and the tests show that nothing assumes one currency, faith or tradition. A kind with the
// tradition (LEGACY_KIND) can be passed to see Bolis and Labh as views.

import { givingTabs } from "@/lib/giving-today/tabs";
import { NEUTRAL_KIND, type KindProfile } from "@/lib/kind";
import { canAccess } from "@/lib/permissions";
import { word } from "@/lib/wording";

import type { CampaignItem, CampaignsModel, OpportunityItem } from "./model";
import { readQuickParams } from "./quick";
import { campaignViews, pickView } from "./views";

export const CAMPAIGNS_COMMUNITY = "Lakeside Community Club";
export const CAMPAIGNS_TODAY = "2026-10-13";

export type CampaignsRole = "treasurer" | "viewer" | "volunteer";

export const CAMPAIGN_ROLE_PERMISSIONS: Record<CampaignsRole, string[]> = {
  treasurer: ["giving.view", "giving.manage", "giving.record_offline", "bolis.view", "bolis.manage"],
  viewer: ["giving.view"],
  volunteer: ["giving.record_offline"],
};

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const SAMPLE_CAMPAIGNS: CampaignItem[] = [
  {
    id: id(1),
    name: "Community hall roof",
    status: "published",
    active: true,
    fund: "Building fund",
    restricted: true,
    goalCents: 5_000_000,
    startsOn: "2026-09-01",
    endsOn: "2026-12-31",
    visibleFrom: null,
    visibleUntil: null,
    totals: { pledgedCents: 1_240_000, receivedCents: 800_000, pledges: 37 },
  },
  {
    id: id(2),
    name: "Winter coat drive",
    status: "published",
    active: true,
    fund: null,
    restricted: false,
    goalCents: null,
    startsOn: "2026-10-01",
    endsOn: null,
    visibleFrom: null,
    visibleUntil: null,
    totals: { pledgedCents: 320_000, receivedCents: 150_000, pledges: 12 },
  },
  {
    id: id(3),
    name: "Spring gala",
    status: "draft",
    active: true,
    fund: "General fund",
    restricted: false,
    goalCents: 2_500_000,
    startsOn: "2027-03-01",
    endsOn: "2027-04-30",
    visibleFrom: null,
    visibleUntil: null,
    totals: { pledgedCents: 0, receivedCents: 0, pledges: 0 },
  },
  {
    id: id(4),
    name: "Summer camp scholarships",
    status: "closed",
    active: true,
    fund: "Scholarship fund",
    restricted: true,
    goalCents: 1_000_000,
    startsOn: "2026-05-01",
    endsOn: "2026-08-31",
    visibleFrom: null,
    visibleUntil: null,
    totals: { pledgedCents: 1_200_000, receivedCents: 1_150_000, pledges: 41 },
  },
];

export const SAMPLE_OPPORTUNITIES: OpportunityItem[] = [
  {
    id: id(11),
    name: "Roof tiles",
    subtitle: "Every tile keeps the hall dry for another winter",
    kind: "amount",
    campaignName: "Community hall roof",
    status: "open",
    active: true,
    allowRecurring: false,
    visibleFrom: null,
    visibleUntil: null,
    taken: { slotsTaken: 37, slotsTotal: null, goalPercent: 24 },
  },
  {
    id: id(12),
    name: "Gala table sponsors",
    subtitle: null,
    kind: "tier",
    campaignName: "Spring gala",
    status: "draft",
    active: true,
    allowRecurring: false,
    visibleFrom: null,
    visibleUntil: null,
    taken: { slotsTaken: 0, slotsTotal: 12, goalPercent: null },
  },
  {
    id: id(13),
    name: "A coat for a neighbour",
    subtitle: null,
    kind: "open",
    campaignName: "Winter coat drive",
    status: "open",
    active: false,
    allowRecurring: true,
    visibleFrom: null,
    visibleUntil: null,
    taken: null,
  },
];

export function sampleCampaignsModel(
  opts: {
    role?: CampaignsRole;
    kind?: KindProfile;
    modulesOff?: string[];
    view?: string | null;
    newSheet?: string | null;
    name?: string | null;
    campaigns?: CampaignItem[];
  } = {},
): CampaignsModel {
  const role = opts.role ?? "treasurer";
  const kind = opts.kind ?? NEUTRAL_KIND;
  const ctx = { permissions: CAMPAIGN_ROLE_PERMISSIONS[role], isPlatformAdmin: false, modulesOff: opts.modulesOff ?? [], kind };
  const views = campaignViews(ctx);
  const active = pickView(views, opts.view);
  const canManage = canAccess(ctx, "campaignsManage");
  const sees = canAccess(ctx, "campaigns");
  return {
    title: "Giving",
    communityName: CAMPAIGNS_COMMUNITY,
    kindLabel: kind.label,
    today: CAMPAIGNS_TODAY,
    timeZone: "America/Toronto",
    currency: "CAD",
    locale: "en-CA",
    tabs: givingTabs(ctx),
    views,
    active: active?.key ?? null,
    canManage,
    canOpenSettings: false,
    campaigns: sees ? (opts.campaigns ?? SAMPLE_CAMPAIGNS) : [],
    archivedCount: sees ? 2 : 0,
    campaignsError: null,
    totalsError: null,
    funds: sees
      ? [
          { id: id(21), name: "Building fund", restricted: true },
          { id: id(22), name: "General fund", restricted: false },
        ]
      : [],
    opportunities: active?.key === "opportunities" && active.state === "on" ? SAMPLE_OPPORTUNITIES : null,
    opportunitiesError: null,
    listType: word(kind, "pledge_list_type"),
    start: canManage ? readQuickParams(opts.newSheet, opts.name) : { sheet: null, name: "" },
  };
}
