import "server-only";

// Giving › Campaigns & opportunities (New look): the campaigns with what was pledged and received against each one's own goal,
// and the opportunities with what is taken. The same reads the classic Campaigns and Opportunities pages make; each part loads on
// its own and says so when it fails. Nothing here writes: the sheets call the existing server actions.

import { communityFormat } from "@/lib/community-format";
import { fetchAll } from "@/lib/data/fetch-all";
import { todayInTz } from "@/lib/dates";
import type { DbErrorLike } from "@/lib/errors";
import type { CampaignsModel, CampaignItem, OpportunityItem } from "@/lib/giving-campaigns/model";
import { orderCampaigns, totalsByCampaign } from "@/lib/giving-campaigns/model";
import { readQuickParams } from "@/lib/giving-campaigns/quick";
import { campaignViews, pickView } from "@/lib/giving-campaigns/views";
import { givingTabs } from "@/lib/giving-today/tabs";
import { canAccess } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";
import { word } from "@/lib/wording";
import { workspaceLabel } from "@/lib/workspaces";

export async function loadCampaignsModel(
  session: CrmSession,
  params: { view?: string | null; newSheet?: string | null; name?: string | null },
): Promise<CampaignsModel> {
  const { db, center } = session;
  const fmt = communityFormat(center);
  const views = campaignViews(session);
  const active = pickView(views, params.view);
  const canManage = canAccess(session, "campaignsManage");
  const seesCampaigns = canAccess(session, "campaigns");
  const listsOpportunities = active?.key === "opportunities" && active.state === "on";
  const listsCampaigns = active?.key === "campaigns" && active.state === "on";

  const [campaigns, funds, pledges] = await Promise.all([
    seesCampaigns
      ? db
          .from("campaigns")
          .select("id, name, status, fund_id, goal_cents, starts_on, ends_on, active, visible_from, visible_until, created_at")
          .eq("center_id", center.id)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    seesCampaigns ? db.from("funds").select("id, name, restricted").eq("center_id", center.id).order("name") : Promise.resolve({ data: [], error: null }),
    listsCampaigns
      ? fetchAll((f, t) =>
          db
            .from("pledges")
            .select("id, campaign_id, amount_cents, paid_cents")
            .eq("center_id", center.id)
            .not("campaign_id", "is", null)
            .not("status", "in", "(cancelled,written_off)")
            .order("id")
            .range(f, t),
        )
      : Promise.resolve({ data: [], error: null as DbErrorLike | null, truncated: false }),
  ]);
  if (funds.error) console.error("[giving-campaigns] funds failed:", funds.error);
  const fundBy = new Map((funds.data ?? []).map((f) => [f.id, f]));
  const totals = pledges.error ? null : totalsByCampaign(pledges.data);
  const all = campaigns.data ?? [];
  const items: CampaignItem[] = orderCampaigns(
    all
      .filter((c) => c.status !== "archived")
      .map((c) => {
        const fund = c.fund_id ? fundBy.get(c.fund_id) : undefined;
        return {
          id: c.id,
          name: c.name,
          status: c.status,
          active: c.active,
          fund: fund?.name ?? null,
          restricted: fund?.restricted ?? false,
          goalCents: c.goal_cents,
          startsOn: c.starts_on,
          endsOn: c.ends_on,
          visibleFrom: c.visible_from,
          visibleUntil: c.visible_until,
          totals: totals ? (totals.get(c.id) ?? { pledgedCents: 0, receivedCents: 0, pledges: 0 }) : null,
        };
      }),
  );

  let opportunities: OpportunityItem[] | null = null;
  let opportunitiesError: DbErrorLike | null = null;
  if (listsOpportunities) {
    const opps = await db
      .from("opportunities")
      .select("id, name, subtitle, kind, campaign_id, status, active, allow_recurring, visible_from, visible_until, created_at")
      .eq("center_id", center.id)
      .order("created_at", { ascending: false })
      .limit(60);
    opportunitiesError = opps.error;
    const names = new Map(all.map((c) => [c.id, c.name]));
    opportunities = await Promise.all(
      (opps.data ?? []).map(async (o): Promise<OpportunityItem> => {
        const r = await db.rpc("opportunity_availability", { p_opportunity: o.id });
        if (r.error) console.error("[giving-campaigns] availability failed:", r.error);
        const first = r.error ? undefined : r.data?.[0];
        return {
          id: o.id,
          name: o.name,
          subtitle: o.subtitle,
          kind: o.kind,
          campaignName: names.get(o.campaign_id) ?? null,
          status: o.status,
          active: o.active,
          allowRecurring: o.allow_recurring,
          visibleFrom: o.visible_from,
          visibleUntil: o.visible_until,
          taken: first ? { slotsTaken: first.slots_taken ?? null, slotsTotal: first.slots_total ?? null, goalPercent: first.goal_percent ?? null } : null,
        };
      }),
    );
  }

  return {
    title: workspaceLabel("giving", session.kind),
    communityName: center.short_name || center.name,
    kindLabel: session.kind.label,
    today: todayInTz(center.time_zone),
    timeZone: center.time_zone,
    currency: center.currency,
    locale: fmt.locale,
    tabs: givingTabs(session),
    views,
    active: active?.key ?? null,
    canManage,
    canOpenSettings: canAccess(session, "centerSettings"),
    campaigns: items,
    archivedCount: all.length - items.length,
    campaignsError: campaigns.error,
    totalsError: pledges.error,
    funds: (funds.data ?? []).map((f) => ({ id: f.id, name: f.name, restricted: f.restricted })),
    opportunities,
    opportunitiesError,
    listType: word(session.kind, "pledge_list_type"),
    start: canManage ? readQuickParams(params.newSheet, params.name) : { sheet: null, name: "" },
  };
}
