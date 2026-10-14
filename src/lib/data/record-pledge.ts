import "server-only";

import { must, rpcJson } from "@/lib/commands/catalog/db";
import { loadAdults } from "@/lib/commands/catalog/household";
import { communityMajority } from "@/lib/commands/child-filter";
import { CommandError } from "@/lib/commands/types";
import { todayInTz } from "@/lib/dates";
import { defaultDueOn, pledgeDueDays } from "@/lib/giving-due";
import {
  OWN_FLOW_CAMPAIGN_KINDS,
  type CheckedPledge,
  type PledgeAdult,
  type PledgeDesignation,
  type PledgeSheetOptions,
  type RecordedPledge,
} from "@/lib/giving-actions/record-pledge";
import { GIVING_ADDONS } from "@/lib/giving-today/tabs";
import { isModuleEnabled } from "@/lib/modules";
import type { CrmSession } from "@/lib/session";

// Recording a pledge by hand (docs/GIVING_REDESIGN.md slice 7), on the server. ONE way in: the Record pledge sheet's action and the
// giving.record_pledge command both end in recordManualPledge, which calls app.record_manual_pledge (0745): giving.manage, Giving on,
// the household in this community, a reason written to the audit entry, source "manual", one confirmation records once.
// Everything is read with the person's own access (row level security).

type Designations = Pick<PledgeSheetOptions, "funds" | "campaigns" | "opportunities">;

/** The funds in use, the campaigns a pledge can be recorded to, and (when Opportunities is on) the open opportunities without options. */
export async function loadPledgeDesignations(session: CrmSession): Promise<Designations> {
  const { db, center } = session;
  const opportunitiesOn = isModuleEnabled(session, GIVING_ADDONS.opportunities);
  const [funds, campaigns, opportunities] = await Promise.all([
    db.from("funds").select("id, name").eq("center_id", center.id).eq("active", true).order("name"),
    db.from("campaigns").select("id, name, kind, status, fund_id").eq("center_id", center.id).neq("status", "archived").order("name"),
    opportunitiesOn
      ? db
          .from("opportunities")
          .select("id, name, campaign_id, amount_cents, status, active, quantity_available, quantity_taken, options")
          .eq("center_id", center.id)
          .eq("status", "open")
          .order("sort_order")
      : Promise.resolve({ data: [], error: null }),
  ]);
  const fundRows = must(funds, "read the funds") ?? [];
  const fundName = new Map(fundRows.map((f) => [f.id, f.name]));
  const own = new Set<string>(OWN_FLOW_CAMPAIGN_KINDS);
  const campaignRows = (must(campaigns, "read the campaigns") ?? []).filter((c) => !own.has(c.kind));
  const campaignName = new Map(campaignRows.map((c) => [c.id, c.name]));
  const oppRows = (must(opportunities, "read the opportunities") ?? []) as {
    id: string;
    name: string;
    campaign_id: string;
    amount_cents: number | null;
    active: boolean | null;
    quantity_available: number | null;
    quantity_taken: number | null;
    options: unknown;
  }[];
  return {
    funds: fundRows.map((f) => ({ id: f.id, name: f.name })),
    campaigns: campaignRows.map((c) => ({ id: c.id, name: c.name, fundName: c.fund_id ? (fundName.get(c.fund_id) ?? null) : null })),
    // An opportunity with tiers or items is chosen on its own screen (the option is part of the pledge); a full one is left out.
    opportunities: oppRows
      .filter((o) => o.active !== false && campaignName.has(o.campaign_id))
      .filter((o) => !Array.isArray(o.options) || o.options.length === 0)
      .filter((o) => o.quantity_available === null || (o.quantity_taken ?? 0) < o.quantity_available)
      .map((o) => ({ id: o.id, name: o.name, campaignName: campaignName.get(o.campaign_id) ?? "", amountCents: o.amount_cents })),
  };
}

/** The same choices as names the box can match ("pledge 500 patel building fund"). */
export function designationNames(d: Designations): PledgeDesignation[] {
  return [
    ...d.funds.map((f) => ({ kind: "fund" as const, id: f.id, name: f.name })),
    ...d.campaigns.map((c) => ({ kind: "campaign" as const, id: c.id, name: c.name })),
    ...d.opportunities.map((o) => ({ kind: "opportunity" as const, id: o.id, name: o.name })),
  ];
}

/** The household's adults by the community's own age of majority (never a child), primary first, without anyone who has died. */
export async function householdAdults(session: CrmSession, householdId: string): Promise<PledgeAdult[]> {
  const { db, center } = session;
  const dir = await loadAdults(db, [householdId], todayInTz(center.time_zone), communityMajority(center));
  const adults = dir.byHousehold.get(householdId) ?? [];
  if (adults.length === 0) return [];
  const gone = must(await db.from("people").select("id").in("id", adults.map((a) => a.id)).eq("is_deceased", true), "read the household's adults") ?? [];
  const out = new Set(gone.map((p) => p.id));
  return adults.filter((a) => !out.has(a.id)).map((a) => ({ id: a.id, name: a.name, isPrimary: a.isPrimary }));
}

export async function loadPledgeSheetOptions(session: CrmSession, householdId: string | null): Promise<PledgeSheetOptions> {
  const [designations, adults] = await Promise.all([loadPledgeDesignations(session), householdId ? householdAdults(session, householdId) : Promise.resolve([])]);
  // Every pledge has a due date (0775): the sheet shows the community's default for a pledge made today, and the person may change it.
  const dueDays = pledgeDueDays(session.center.rules);
  return { ...designations, adults, dueDays, defaultDueOn: defaultDueOn(todayInTz(session.center.time_zone), dueDays) };
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * Record the checked pledge once. `key` is the confirmation: the sheet's request id, or the command's confirmed proposal. The person
 * who pledged must be an adult of the household by the community's own age of majority (the database holds the floor of 18 too).
 */
export async function recordManualPledge(session: CrmSession, p: CheckedPledge, key: string): Promise<RecordedPledge> {
  const { db, center } = session;
  if (p.pledgedBy) {
    const adults = await householdAdults(session, p.householdId);
    if (!adults.some((a) => a.id === p.pledgedBy)) {
      throw new CommandError("The person who pledged must be an adult of this household. Choose an adult, or record the pledge for the household.");
    }
  }
  const j = (await rpcJson(
    db,
    "record_manual_pledge",
    {
      p_idempotency_key: key,
      p_center: center.id,
      p_household: p.householdId,
      p_amount_cents: p.amountCents,
      p_reason: p.reason,
      p_fund: p.fundId,
      p_campaign: p.campaignId,
      p_opportunity: p.opportunityId,
      p_opportunity_option: null,
      p_due_on: p.dueOn,
      p_pledged_by_person: p.pledgedBy,
      p_dedication: p.dedication,
    },
    "record the pledge",
  )) as Record<string, unknown> | null;
  const pledgeId = str(j?.pledge_id);
  if (!j || !pledgeId) throw new CommandError("The pledge may not have been recorded: the database did not say. Open the family's Pledges to check before trying again.");
  return {
    pledgeId,
    pledgeNumber: str(j.pledge_number),
    householdId: str(j.household_id) ?? p.householdId,
    amountCents: typeof j.amount_cents === "number" ? j.amount_cents : Number(j.amount_cents ?? p.amountCents),
    replayed: j.replayed === true,
  };
}
