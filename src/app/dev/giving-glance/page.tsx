import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { GivingGlanceView, type GlanceView } from "@/components/giving-glance/giving-glance";
import { PeriodNote } from "@/components/giving-glance/period-note";
import { devPreviewAllowed } from "@/lib/dev-preview";
import { composeHousehold, composePerson, type GlanceCommon, type GlanceModel } from "@/lib/giving-glance/compose";
import { glanceHref } from "@/lib/giving-glance/period";

import { ADULTS, AMARA, CARD_LINE, EMPTY_ROWS, FIXTURE_ROWS, HOUSEHOLD, PREVIEW_COMMUNITY, PREVIEW_CURRENCY, PREVIEW_TODAY, PREVIEW_TZ } from "./fixtures";

export const metadata: Metadata = { title: "Giving at a glance · Dev preview" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const VIEWS = ["household", "person", "person-page", "household-card", "noaccess", "error", "limited", "empty-rows"] as const;
type PreviewView = (typeof VIEWS)[number];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * DEV ONLY. "Giving at a glance" with invented giving for a neutral church (adults from several cultures, and a child whose
 * giving is recorded but never shown), drawn without a database or a session so its look can be checked and screenshotted.
 *   ?view=household       the household page, community shows giving by household (default)
 *   ?view=person          the household page, community shows giving by person (the chooser and "Not tied to a person")
 *   ?view=person-page     a person's page, giving by person (their own giving and the rest of the household)
 *   ?view=household-card  a person's page, giving by household ("Household giving" with its card)
 *   ?view=noaccess | error | limited | empty-rows
 *   ?year=2026|2025|all|2021   ?giving_for=<person id>|none   ?fy=7 (the community's year starts in July)   ?look=v2
 * Returns notFound() in production (and the proxy lets /dev through without a session only outside production).
 */
export default async function GivingGlancePreview({ searchParams }: { searchParams?: Search }) {
  if (!devPreviewAllowed()) notFound();
  const sp = (await searchParams) ?? {};
  const view: PreviewView = (VIEWS as readonly string[]).includes(one(sp.view) ?? "") ? (one(sp.view) as PreviewView) : "household";
  const startMonth = Math.min(12, Math.max(1, Number(one(sp.fy)) || 1));
  const keep = { view: view === "household" ? null : view, fy: startMonth === 1 ? null : String(startMonth), look: one(sp.look) ?? null };
  const common: GlanceCommon = {
    today: PREVIEW_TODAY,
    startMonth,
    yearParam: one(sp.year),
    path: "/dev/giving-glance",
    keep,
    limitedView: view === "limited",
    fiscalNote: null,
    truncated: false,
  };
  const rows = view === "empty-rows" ? EMPTY_ROWS : FIXTURE_ROWS;
  const ready = (model: GlanceModel): GlanceView => ({ state: "ready", model, currency: PREVIEW_CURRENCY, timeZone: PREVIEW_TZ });

  let panel: GlanceView;
  if (view === "noaccess") panel = { state: "no-access" };
  else if (view === "error") panel = { state: "error", what: "the giving figures", error: new Error("connection reset"), retryHref: glanceHref("/dev/giving-glance", { view: "error" }) };
  else if (view === "person-page") {
    panel = ready(composePerson({ ...common, keep: { ...keep }, personRows: personRows(), householdRows: rows, person: { id: AMARA, name: "Amara Okafor", firstName: "Amara" }, householdHref: `/households/${HOUSEHOLD}` }));
  } else {
    panel = ready(
      composeHousehold({
        ...common,
        rows,
        adults: ADULTS,
        showBy: view === "person" ? "person" : "household",
        scopeParam: one(sp.giving_for),
        heading: view === "household-card" ? "Household giving" : undefined,
        cardLine: view === "household-card" ? CARD_LINE : null,
      }),
    );
  }

  return (
    <div data-look={one(sp.look) === "v2" ? "v2" : undefined} className={one(sp.look) === "v2" ? "v2-shell min-h-screen" : "min-h-screen"}>
      <div className="mx-auto max-w-[1100px] px-4 py-5 sm:px-6">
        <p className="mb-3 inline-block rounded-field bg-danger px-2.5 py-0.5 text-[10px] font-bold tracking-[0.08em] text-white">DEV PREVIEW · SAMPLE DATA</p>
        <h1 className="font-display text-[26px] font-semibold text-ink">{view === "person-page" || view === "household-card" ? "Amara Okafor" : "Okafor-Silva household"}</h1>
        <p className="mb-4 text-[13px] text-muted">{PREVIEW_COMMUNITY} · invented sample data · the panel sits above the tabs</p>
        <GivingGlanceView view={panel} />
        {view === "household" || view === "person" ? (
          <section className="cc-card">
            <PeriodNote period={{ from: "2026-01-01", to: "2026-12-31", label: "2026", showAllHref: "/dev/giving-glance?year=all" }} what="pledges" />
            <p className="px-[18px] pb-4 text-[13px] text-muted">(The Pledges and Payments tabs sit here and show the same year.)</p>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/** Everything recorded under Amara, wherever the household. */
function personRows() {
  return {
    pledges: FIXTURE_ROWS.pledges.filter((p) => p.person_id === AMARA),
    payments: FIXTURE_ROWS.payments.filter((p) => p.person_id === AMARA),
    recurring: FIXTURE_ROWS.recurring.filter((r) => r.person_id === AMARA),
  };
}
