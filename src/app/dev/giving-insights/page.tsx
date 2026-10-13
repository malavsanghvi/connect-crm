import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PreviewShell } from "@/app/dev/admin-giving/preview-shell";
import { InsightsScreen } from "@/components/giving-insights/insights-page";
import { devPreviewAllowed } from "@/lib/dev-preview";
import { INSIGHTS_SAMPLES, sampleInsights, type InsightsSample } from "@/lib/giving-insights/fixtures";
import { buildInsightsView } from "@/lib/giving-insights/view";

export const metadata: Metadata = { title: "Giving Insights · Dev preview" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const NAMES: Record<InsightsSample, string> = { church: "Riverside Church", chamber: "Lakeside Chamber", temple: "Hillside Temple", small: "Northside Club" };

/**
 * DEV ONLY. Giving › Insights with invented numbers, drawn without a database or a session. `?as=church` (default, dollars),
 * `?as=chamber` (not a faith community, Canadian dollars, a year from April, recurring gifts off), `?as=temple` (rupees),
 * `?as=small` (fewer than 10 giving households: no top-tenth share). Returns notFound() in production.
 */
export default async function GivingInsightsPreview({ searchParams }: { searchParams?: Search }) {
  if (!devPreviewAllowed()) notFound();
  const sp = (await searchParams) ?? {};
  const sample = INSIGHTS_SAMPLES.find((s) => s === sp.as) ?? "church";
  const { data, ctx } = sampleInsights(sample);
  const years = [0, 1, 2].map((n) => ({ year: 2026 - n, label: String(2026 - n), href: `?as=${sample}` }));
  return (
    <PreviewShell community={NAMES[sample]} workspaces={[]}>
      <InsightsScreen page={{ state: "ok", view: buildInsightsView(data, ctx), year: 2026, years, notice: null }} />
    </PreviewShell>
  );
}
