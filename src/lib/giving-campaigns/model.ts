// The shape Giving › Campaigns & opportunities is drawn from (New look), shared by the loader, the dev preview and the tests,
// and the small pure steps the loader takes. No server imports: the page component is a client component.

import type { DbErrorLike } from "@/lib/errors";
import type { GivingTab } from "@/lib/giving-today/tabs";

import type { CampaignTotals } from "./progress";
import type { CreateCommand } from "./quick";
import type { CampaignView, CampaignViewKey } from "./views";

export type CampaignItem = {
  id: string;
  name: string;
  status: string;
  active: boolean;
  fund: string | null;
  restricted: boolean;
  goalCents: number | null;
  startsOn: string | null;
  endsOn: string | null;
  visibleFrom: string | null;
  visibleUntil: string | null;
  /** Null when the pledge totals could not be read (the page says so instead of showing zeros). */
  totals: CampaignTotals | null;
};

export type OpportunityItem = {
  id: string;
  name: string;
  subtitle: string | null;
  kind: string;
  campaignName: string | null;
  status: string;
  active: boolean;
  allowRecurring: boolean;
  visibleFrom: string | null;
  visibleUntil: string | null;
  taken: { slotsTaken: number | null; slotsTotal: number | null; goalPercent: number | null } | null;
};

export type CampaignsModel = {
  title: string;
  communityName: string;
  kindLabel: string;
  today: string;
  timeZone: string;
  currency: string;
  locale: string;
  tabs: GivingTab[];
  views: CampaignView[];
  /** The view on screen; null when the person can open none. */
  active: CampaignViewKey | null;
  canManage: boolean;
  canOpenSettings: boolean;
  /** Every campaign that is not archived (the opportunity sheet chooses from them too). */
  campaigns: CampaignItem[];
  archivedCount: number;
  campaignsError: DbErrorLike | null;
  totalsError: DbErrorLike | null;
  funds: { id: string; name: string; restricted: boolean }[];
  /** Null unless the Opportunities view is on screen. */
  opportunities: OpportunityItem[] | null;
  opportunitiesError: DbErrorLike | null;
  /** The kind's words for a fixed list ("Fixed item list (multi-select)"). */
  listType: string;
  /** A sheet to open at once (?new=campaign&name=…, from the box). */
  start: { sheet: CreateCommand["what"] | null; name: string };
};

/** Pledged and received per campaign, in integer cents (cancelled and written-off pledges are left out by the query). */
export function totalsByCampaign(pledges: readonly { campaign_id: string | null; amount_cents: number; paid_cents: number }[]): Map<string, CampaignTotals> {
  const out = new Map<string, CampaignTotals>();
  for (const p of pledges) {
    if (!p.campaign_id) continue;
    const t = out.get(p.campaign_id) ?? { pledgedCents: 0, receivedCents: 0, pledges: 0 };
    t.pledgedCents += p.amount_cents;
    t.receivedCents += p.paid_cents;
    t.pledges += 1;
    out.set(p.campaign_id, t);
  }
  return out;
}

const STATUS_ORDER: Record<string, number> = { published: 0, draft: 1, closed: 2 };

/** Running campaigns first, then drafts, then closed ones; the newest first inside each (the input's order is kept). */
export function orderCampaigns<T extends { status: string }>(rows: readonly T[]): T[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (STATUS_ORDER[a.r.status] ?? 3) - (STATUS_ORDER[b.r.status] ?? 3) || a.i - b.i)
    .map(({ r }) => r);
}
