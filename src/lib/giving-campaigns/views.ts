// The views of Giving › Campaigns & opportunities in the New look (docs/GIVING_REDESIGN.md section 4, owner decision 1 of section
// 10): Campaigns (core), Opportunities (add-on giving_opportunities), Bolis (module bolis) and the kind's own word for Labh (add-on
// labh). Each view says whether this person, in this community, can open it, and if not, why: the module is switched off, the
// kind of organization never has it, or the person's roles do not reach it. Pure: the route, the tab row, the dev preview and the
// tests read the same answer. Convenience only; the database refuses the data anyway.

import { kindHas, kindName, moduleNotOffered, type KindProfile } from "@/lib/kind";
import { isModuleEnabled, moduleDef, type ModuleKey } from "@/lib/modules";
import { canAccess, type AccessKey, type ScopedContext } from "@/lib/permissions";

export type CampaignViewKey = "campaigns" | "opportunities" | "bolis" | "labh";

/** on: shown; off: the community switched the module off; not_offered: the kind never has it; no_access: the roles do not reach it. */
export type ViewState = "on" | "off" | "not_offered" | "no_access";

export type CampaignView = {
  key: CampaignViewKey;
  label: string;
  module: ModuleKey;
  /** The permission the view needs (for the "You don't have access" card). */
  access: AccessKey;
  state: ViewState;
  href: string;
};

export type ViewContext = ScopedContext & { kind: KindProfile };

export const CAMPAIGNS_PATH = "/giving/campaigns";

export function viewHref(key: CampaignViewKey): string {
  return key === "campaigns" ? CAMPAIGNS_PATH : `${CAMPAIGNS_PATH}?view=${key}`;
}

/** The kind's own name for Labh: its catalog label, else what a tradition calls it, else the module's neutral name. */
export function labhLabel(kind: KindProfile): string {
  return kindName(kind, "labh", kindHas(kind, "tradition") ? "Labh" : moduleDef("labh").label);
}

export function campaignViews(ctx: ViewContext): CampaignView[] {
  const { kind } = ctx;
  const state = (module: ModuleKey, access: AccessKey, offered: boolean): ViewState =>
    !offered ? "not_offered" : !isModuleEnabled(ctx, module) ? "off" : !canAccess(ctx, access) ? "no_access" : "on";
  const view = (key: CampaignViewKey, label: string, module: ModuleKey, access: AccessKey, offered = true): CampaignView => ({
    key,
    label,
    module,
    access,
    state: state(module, access, offered),
    href: viewHref(key),
  });
  return [
    view("campaigns", "Campaigns", "giving", "campaigns"),
    view("opportunities", kindName(kind, "giving_opportunities", moduleDef("giving_opportunities").label), "giving_opportunities", "campaigns"),
    view("bolis", kindName(kind, "bolis", moduleDef("bolis").label), "bolis", "bolis", !moduleNotOffered(kind, "bolis")),
    // Labh follows the kind the way its NAV tab does (kindHas: a kind without its own Labh row follows Bolis).
    view("labh", labhLabel(kind), "labh", "labh", kindHas(kind, "labh")),
  ];
}

/** The views offered as chips: only the ones this person can open. */
export function shownViews(views: readonly CampaignView[]): CampaignView[] {
  return views.filter((v) => v.state === "on");
}

/**
 * The view an address asks for. A known key is honoured even when it cannot open (the page then says why, never an empty
 * page); no key, or an unknown one, opens the first view the person can open.
 */
export function pickView(views: readonly CampaignView[], requested: string | null | undefined): CampaignView | null {
  const asked = views.find((v) => v.key === requested);
  if (asked) return asked;
  return shownViews(views)[0] ?? null;
}

/** The Giving tab's label: "Campaigns & opportunities" while Opportunities is on for the person, else "Campaigns". */
export function campaignsTabLabel(views: readonly CampaignView[]): string {
  const opp = views.find((v) => v.key === "opportunities");
  return opp?.state === "on" ? "Campaigns & opportunities" : "Campaigns";
}
