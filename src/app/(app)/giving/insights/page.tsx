import type { Metadata } from "next";

import { InsightsScreen } from "@/components/giving-insights/insights-page";
import { loadGivingInsights } from "@/lib/data/giving-insights";
import { param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Giving insights" };

/** Giving › Insights (B98 slice 1): the community's own giving numbers for one financial year. Read only. */
export default async function GivingInsightsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const raw = Number(param(await searchParams, "year"));
  const page = await loadGivingInsights(session, Number.isInteger(raw) && raw > 0 ? raw : null);
  return <InsightsScreen page={page} />;
}
