// Which financial year Giving › Insights shows, and the chips for the years around it. Pure: the community's year start
// (org_profiles.fiscal_year_start_month) and today in, the window app.giving_insights is asked for out.

import { chosenYear, currentFiscalYear, fiscalYearLabel, yearWindow } from "@/lib/reports/periods";

export type InsightsYear = { year: number; label: string; href: string };

export type InsightsWindow = {
  year: number;
  label: string;
  isCurrentYear: boolean;
  /** The first day of the year and where its figures stop (today in the current year). */
  from: string;
  to: string;
  /** Next year typed in the address: it has not started, there is nothing to add up. */
  notStarted: boolean;
  years: InsightsYear[];
};

export function insightsWindow(today: string, startMonth: number, asked: number | null): InsightsWindow {
  const current = currentFiscalYear(today, startMonth);
  const year = chosenYear(asked ?? current, current);
  const w = yearWindow(year, current, today, startMonth);
  return {
    year,
    label: w.label,
    isCurrentYear: w.isCurrentYear,
    from: w.from,
    to: w.from > today ? w.from : w.periodEnd,
    notStarted: w.from > today,
    years: [current, current - 1, current - 2].map((y) => ({ year: y, label: fiscalYearLabel(y, startMonth), href: y === current ? "/giving/insights" : `/giving/insights?year=${y}` })),
  };
}
