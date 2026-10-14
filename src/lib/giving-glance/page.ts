// "Giving at a glance" on a page: the year the address asks for, as the community's own year. Server side (it reads the
// community's profile), but nothing here writes.

import { todayInTz } from "@/lib/dates";
import { loadFiscalStart } from "@/lib/reports/fiscal";
import { param, type RawSearchParams } from "@/lib/search-params";
import type { CrmSession } from "@/lib/session";

import { glanceWindow, glanceYearOf, parseGlanceYear, type GlanceWindow } from "./period";

export type GlancePrep = {
  today: string;
  startMonth: number;
  /** Plain English when the start of the year could not be read and the calendar year was used. */
  fiscalNote: string | null;
  window: GlanceWindow;
  /** True when the address names a year (so links keep it); false when it is the default. */
  explicitYear: boolean;
  yearParam: string | undefined;
};

export async function prepareGlance(session: CrmSession, sp: RawSearchParams, now?: Date): Promise<GlancePrep> {
  const { center, db } = session;
  const today = todayInTz(center.time_zone, now);
  const fiscal = await loadFiscalStart(db, center.id);
  const yearParam = param(sp, "year");
  const selection = parseGlanceYear(yearParam, glanceYearOf(today, fiscal.month));
  return {
    today,
    startMonth: fiscal.month,
    fiscalNote: fiscal.problem,
    window: glanceWindow(selection, today, fiscal.month),
    explicitYear: yearParam !== undefined,
    yearParam,
  };
}

/** The period a tab (Pledges, Payments) is filtered to, so it follows the panel above it. */
export type TabPeriod = { from: string | null; to: string | null; label: string; showAllHref: string };

export function tabPeriod(prep: GlancePrep, showAllHref: string): TabPeriod | undefined {
  const w = prep.window;
  return w.from === null ? undefined : { from: w.from, to: w.to, label: w.label, showAllHref };
}
