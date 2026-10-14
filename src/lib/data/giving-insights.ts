// Giving › Insights (B98 slice 1): one call to app.giving_insights (0749) for the community's chosen financial year. The database
// adds everything up and returns aggregates only, so no payment row reaches the portal or the browser. Read only.

import { communityFormat } from "@/lib/community-format";
import { todayInTz } from "@/lib/dates";
import { failure } from "@/lib/errors";
import { buildInsightsView, type InsightsView, type InsightsWords } from "@/lib/giving-insights/view";
import { parseInsights } from "@/lib/giving-insights/parse";
import { insightsWindow, type InsightsYear } from "@/lib/giving-insights/window";
import { GIVING_ADDONS } from "@/lib/giving-today/tabs";
import { kindName, kindSchool, kindTerm, type KindProfile } from "@/lib/kind";
import { isModuleEnabled } from "@/lib/modules";
import { canAccess } from "@/lib/permissions";
import { loadFiscalStart } from "@/lib/reports/fiscal";
import type { CrmSession } from "@/lib/session";

export type { InsightsYear };

export type InsightsPage =
  | { state: "ok"; view: InsightsView; year: number; years: InsightsYear[]; notice: string | null }
  | { state: "no_access" }
  | { state: "off" }
  | { state: "error"; error: string; years: InsightsYear[]; year: number };

export function insightsWords(kind: Pick<KindProfile, "modules" | "terms">): InsightsWords {
  const household = kindTerm(kind, "household", "household");
  return {
    household,
    households: kindTerm(kind, "households", `${household}s`),
    school: kindSchool(kind),
    store: kindName(kind, "store", "Store"),
  };
}

/** Who may see the community's numbers: the giving staff (giving.view or giving.manage), with the Insights module on. */
export function canSeeInsights(session: Pick<CrmSession, "permissions" | "isPlatformAdmin" | "modulesOff">): boolean {
  return canAccess(session, "paymentsAll") && isModuleEnabled(session, GIVING_ADDONS.insights);
}

export async function loadGivingInsights(session: CrmSession, askedYear: number | null): Promise<InsightsPage> {
  if (!isModuleEnabled(session, GIVING_ADDONS.insights)) return { state: "off" };
  if (!canAccess(session, "paymentsAll")) return { state: "no_access" };
  const { db, center } = session;
  const today = todayInTz(center.time_zone);
  const fiscal = await loadFiscalStart(db, center.id);
  const w = insightsWindow(today, fiscal.month, askedYear);
  const { year, years } = w;
  if (w.notStarted) return { state: "error", error: `${w.label} has not started yet.`, years, year };

  const res = await db.rpc("giving_insights", { p_center: center.id, p_from: w.from, p_to: w.to, p_today: today });
  if (res.error) {
    // A refusal from the database is said as it is (no access, the module switched off), never as an empty page.
    return { state: "error", error: failure("Could not add up the giving numbers", res.error).error, years, year };
  }
  const data = parseInsights(res.data);
  if (!data) return { state: "error", error: "Could not read the giving numbers: the answer was not in the expected shape.", years, year };
  const fmt = communityFormat(center);
  const view = buildInsightsView(data, {
    currency: fmt.currency,
    locale: fmt.locale,
    yearLabel: w.label,
    isCurrentYear: w.isCurrentYear,
    words: insightsWords(session.kind),
    opportunitiesOn: isModuleEnabled(session, GIVING_ADDONS.opportunities),
    recurringOn: isModuleEnabled(session, GIVING_ADDONS.recurring),
  });
  return { state: "ok", view, year, years, notice: fiscal.problem };
}
