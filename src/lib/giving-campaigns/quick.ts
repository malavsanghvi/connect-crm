// Quick create in Giving › Campaigns & opportunities (docs/GIVING_REDESIGN.md section 2: a campaign in 3, an opportunity in 3
// with four questions and the rest later). The sheets call the EXISTING server actions (createCampaignAction,
// saveOpportunityAction); this file only checks what was typed, in the same words the server uses, and builds what those
// actions take, with the full builder's own defaults for everything the four questions leave out. The server stays the judge.
// Pure and unit-tested.

import type { OpportunityInput } from "@/app/(app)/giving/opportunities/actions";
import { buildOptions, OPPORTUNITY_TYPES, type OpportunityKind, type OptionRow } from "@/lib/giving";
import { parseAmountToCents } from "@/lib/money";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const NAME_MAX = 160;

// ---------------------------------------------------------------------------------------------------------------- Campaign

export type QuickCampaign = { name: string; goal: string; startsOn: string; endsOn: string; fundId: string };

export const EMPTY_CAMPAIGN: QuickCampaign = { name: "", goal: "", startsOn: "", endsOn: "", fundId: "" };

const CAMPAIGN_DOING = "Could not create the campaign";

/** The first problem with the campaign sheet, in the server's words; null when it can be sent. */
export function checkQuickCampaign(q: QuickCampaign): string | null {
  const name = q.name.trim();
  if (!name) return `${CAMPAIGN_DOING} — give it a name.`;
  if (name.length > NAME_MAX) return `${CAMPAIGN_DOING} — the name is longer than ${NAME_MAX} characters.`;
  const goalText = q.goal.trim();
  if (goalText) {
    const goal = parseAmountToCents(goalText);
    if (goal === null || goal <= 0) return `${CAMPAIGN_DOING} — the goal must be an amount like 25000.00.`;
  }
  const s = q.startsOn.trim();
  const e = q.endsOn.trim();
  if ((s && !DATE.test(s)) || (e && !DATE.test(e))) return `${CAMPAIGN_DOING} — a date is not valid.`;
  if (s && e && e < s) return `${CAMPAIGN_DOING} — it ends before it starts.`;
  return null;
}

/** The goal in integer cents, or null when none was given. */
export function quickGoalCents(q: Pick<QuickCampaign, "goal">): number | null {
  const t = q.goal.trim();
  return t ? parseAmountToCents(t) : null;
}

/** What createCampaignAction reads. Kind "general" (the form's own default); the description and visibility window come later. */
export function quickCampaignForm(q: QuickCampaign): FormData {
  const f = new FormData();
  f.set("name", q.name.trim());
  f.set("kind", "general");
  f.set("fund_id", UUID.test(q.fundId) ? q.fundId : "");
  f.set("goal", q.goal.trim());
  f.set("starts_on", q.startsOn.trim());
  f.set("ends_on", q.endsOn.trim());
  return f;
}

// ---------------------------------------------------------------------------------------------------------------- Opportunity

export type QuickOpportunityType = Exclude<OpportunityKind, "fixed">;
export type QuickRow = { label: string; amount: string };
export type QuickOpportunity = { name: string; type: QuickOpportunityType; rows: QuickRow[]; campaignId: string; publish: boolean };
export type CampaignChoice = { id: string; name: string; status: string };

/**
 * The four kinds the builder offers, in the prototype's order. The fixed list is named in the kind's own words
 * (word(kind, "pledge_list_type")): a community without the tradition never reads a tradition's word here.
 */
export function quickOpportunityTypes(listType: string): { type: QuickOpportunityType; label: string; members: string }[] {
  const label = (k: QuickOpportunityType) => OPPORTUNITY_TYPES.find((t) => t.kind === k)?.label ?? k;
  return [
    { type: "open", label: label("open"), members: "an amount box" },
    { type: "amount", label: label("amount"), members: "preset amounts and an open box" },
    { type: "tier", label: label("tier"), members: "tiers to choose from" },
    { type: "multi", label: listType, members: "a fixed list to choose from" },
  ];
}

/** Rows the type asks for: none for an open amount, amounts only for presets, a name and an amount for tiers and lists. */
export function rowsNeeded(type: QuickOpportunityType): "none" | "amounts" | "named" {
  return type === "open" ? "none" : type === "amount" ? "amounts" : "named";
}

/** The campaign the sheet starts on: the first published one (an opportunity can be published into it), else the first. */
export function defaultCampaignId(campaigns: readonly CampaignChoice[]): string {
  return (campaigns.find((c) => c.status === "published") ?? campaigns[0])?.id ?? "";
}

export function canPublishInto(campaigns: readonly CampaignChoice[], id: string): boolean {
  return campaigns.some((c) => c.id === id && c.status === "published");
}

function doingFor(publish: boolean): string {
  return publish ? "Could not publish the opportunity" : "Could not save the opportunity";
}

/** The first problem with the opportunity sheet, in the server's words; null when it can be sent. */
export function checkQuickOpportunity(q: QuickOpportunity, campaigns: readonly CampaignChoice[]): string | null {
  const doing = doingFor(q.publish);
  const name = q.name.trim();
  if (!name) return `${doing} — give it a name.`;
  if (name.length > NAME_MAX) return `${doing} — the name is longer than ${NAME_MAX} characters.`;
  const campaign = campaigns.find((c) => c.id === q.campaignId);
  if (!UUID.test(q.campaignId) || !campaign) return `${doing} — choose the campaign it belongs to.`;
  if (q.publish && campaign.status !== "published") {
    return `${doing} — its campaign is ${campaign.status}; publish the campaign first, or save this as a draft.`;
  }
  const built = buildOptions(q.type, toOptionRows(q), parseAmountToCents);
  if (!built.ok) return `${doing} — ${built.error[0].toLowerCase()}${built.error.slice(1)}`;
  return null;
}

function toOptionRows(q: Pick<QuickOpportunity, "type" | "rows">): OptionRow[] {
  const need = rowsNeeded(q.type);
  if (need === "none") return [];
  return q.rows.slice(0, 60).map((r) => ({ label: need === "amounts" ? "" : r.label, amount: r.amount }));
}

/**
 * What saveOpportunityAction takes. Everything the four questions leave out is the full builder's default: no subtitle,
 * anonymous allowed, the member alert for all members drafted in Communications on publish (a draft for review, never sent),
 * no recurring giving, active, no visibility window.
 */
export function quickOpportunityInput(q: QuickOpportunity): OpportunityInput {
  return {
    id: null,
    name: q.name.trim(),
    subtitle: "",
    kind: q.type,
    campaignId: q.campaignId,
    allowAnonymous: true,
    rows: toOptionRows(q),
    audience: ["all_members"],
    publish: q.publish,
    allowRecurring: false,
    recurringFrequencies: [],
    notificationTemplateKey: "",
    active: true,
    visibleFrom: "",
    visibleUntil: "",
  };
}

// ---------------------------------------------------------------------------------------------------------------- The box

export type CreateCommand = { what: "campaign" | "opportunity"; name: string };

const CREATE = /^(?:new|create|add|start|set\s*up)\s+(?:an?\s+)?(campaign|opportunity)\b[\s:,-]*(.*)$/iu;

/**
 * "new campaign Building fund", "create an opportunity: Gala tables". For the box's Giving lane (B94 and slice 2): Enter
 * opens the sheet already named. Null for anything else.
 */
export function readCreateCommand(text: string): CreateCommand | null {
  const m = CREATE.exec(text.replace(/\s+/g, " ").trim());
  if (!m) return null;
  return { what: m[1].toLowerCase() as CreateCommand["what"], name: m[2].trim().slice(0, NAME_MAX) };
}

/** The address that opens the sheet, named: the campaign sheet on Campaigns, the opportunity sheet on Opportunities. */
export function quickCreateHref(cmd: CreateCommand): string {
  const q = new URLSearchParams();
  if (cmd.what === "opportunity") q.set("view", "opportunities");
  q.set("new", cmd.what);
  if (cmd.name) q.set("name", cmd.name);
  return `/giving/campaigns?${q.toString()}`;
}

/** Reads ?new= and ?name= back (the sheet to open and the name to start with). */
export function readQuickParams(newParam: string | null | undefined, nameParam: string | null | undefined): { sheet: CreateCommand["what"] | null; name: string } {
  const sheet = newParam === "campaign" || newParam === "opportunity" ? newParam : null;
  return { sheet, name: sheet ? (nameParam ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX) : "" };
}
