import { communityFormat, numberIn } from "@/lib/community-format";
import { reportReads } from "@/lib/reports/load";
import { onAppPercent } from "@/lib/reports/parse";
import { pctChange } from "@/lib/reports/periods";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";

import { changeWords, fiscalYear, got, mayAccess, moneyOf, notShown, plural } from "./shared";

export type OverviewData = {
  year: number;
  /** "2026", or "2025-26" for a financial year that starts in another month. */
  year_label: string;
  as_of: string;
  /** Households (merged ones left out), how many are new this year, and the share with a signed-in member. */
  households: { total: number; new_in_year: number; on_the_app_percent: number | null; by_zone: { zone: string; households: number }[] } | null;
  renewals_due_in_60_days: number | null;
  giving: {
    given_cents: number;
    given: string;
    last_year_same_period_cents: number;
    last_year_same_period: string;
    change_percent: number | null;
    open_pledges: number;
    open_pledges_cents: number;
    open_pledges_amount: string;
  } | null;
  event_check_ins: { this_year: number; last_year_same_period: number; change_percent: number | null } | null;
  /** Areas left out because the person's role cannot see them. */
  not_shown: { area: string; reason: string }[];
};

const input = object({
  year: f.optional(f.integer("The year to report on, like 2026. Leave out for this year. A community whose financial year starts in another month gets that financial year, named by the year it starts in.", { min: 1991, max: 2100 })),
});

/** The six headline figures of the Reports page, in one call: households, the app, giving against last year, open pledges, check-ins, renewals. */
export const reportsOverview = defineCommand<Infer<typeof input>, OverviewData>({
  key: "reports.overview",
  title: "Show how the community is doing this year",
  description:
    "The headline figures of the Reports page for one year: how many households (and how many are new this year, and what share has someone signed in to the app), " +
    "the households by zone, memberships due for renewal in the next 60 days, the money given this year against the same days last year, the pledges still open, and event check-ins against last year. " +
    "Use it for 'how are we doing?' and 'how does this year compare with last year?'. Money is exact and comes from the database's own sums. " +
    "Areas the person's role cannot see are left out and listed in not_shown. Counts and sums only: no household or person is named. Read only.",
  level: "read",
  permission: "reports",
  module: "reports",
  input,
  async execute(ctx, { year: asked }) {
    const { db, center } = ctx.session;
    const { today, w, note } = await fiscalYear(ctx, asked);
    const locale = communityFormat(center).locale;
    // The people figures count new households in a CALENDAR year; a community whose financial year starts in another month gets the count for its own year.
    const ownYear = !w.from.endsWith("-01-01");
    const money = moneyOf(ctx);
    const seesPeople = mayAccess(ctx, "memberships");
    const seesGiving = mayAccess(ctx, "paymentsAll");
    const seesEvents = mayAccess(ctx, "events");
    const [people, given, prior, pledges, visits, priorVisits, figures] = await Promise.all([
      seesPeople ? reportReads.peopleOverview(db, center.id, w.year, today) : null,
      seesGiving ? reportReads.payments(db, center.id, w.from, w.yearEnd, "none") : null,
      seesGiving ? reportReads.payments(db, center.id, w.prevFrom, w.prevEnd, "none") : null,
      seesGiving ? reportReads.pledges(db, center.id, w.from, w.yearEnd) : null,
      seesEvents ? reportReads.attendance(db, center.id, w.from, w.periodEnd, 1) : null,
      seesEvents ? reportReads.attendance(db, center.id, w.prevFrom, w.prevEnd, 1) : null,
      seesPeople && ownYear ? reportReads.periodFigures(db, center.id, w.from, w.periodEnd) : null,
    ]);
    const p = people ? got(people, "read the household figures") : null;
    const newInYear = figures ? got(figures, "count the new households").newHouseholds : (p?.newInYear ?? 0);
    const g = given ? got(given, "read the giving figures") : null;
    const gp = prior ? got(prior, "read last year's giving figures") : null;
    const pl = pledges ? got(pledges, "read the open pledges") : null;
    const v = visits ? got(visits, "read the event check-ins") : null;
    const vp = priorVisits ? got(priorVisits, "read last year's event check-ins") : null;
    const notShownList = [!seesPeople ? notShown("Households and renewals") : null, !seesGiving ? notShown("Giving") : null, !seesEvents ? notShown("Event check-ins") : null].flatMap((x) => (x ? [x] : []));
    const data: OverviewData = {
      year: w.year,
      year_label: w.label,
      as_of: today,
      households: p ? { total: p.households, new_in_year: newInYear, on_the_app_percent: onAppPercent(p), by_zone: p.zones } : null,
      renewals_due_in_60_days: p ? p.renewalsDue : null,
      giving:
        g && gp && pl
          ? {
              given_cents: g.totals.netCents,
              given: money(g.totals.netCents),
              last_year_same_period_cents: gp.totals.netCents,
              last_year_same_period: money(gp.totals.netCents),
              change_percent: pctChange(g.totals.netCents, gp.totals.netCents),
              open_pledges: pl.openNow.pledges,
              open_pledges_cents: pl.openNow.openCents,
              open_pledges_amount: money(pl.openNow.openCents),
            }
          : null,
      event_check_ins: v && vp ? { this_year: v.checkIns, last_year_same_period: vp.checkIns, change_percent: pctChange(v.checkIns, vp.checkIns) } : null,
      not_shown: notShownList,
    };
    const parts = [
      data.households ? `${plural(data.households.total, "household")} (${numberIn(data.households.new_in_year, locale)} new in ${w.label})` : null,
      data.giving ? `${data.giving.given} given${changeWords(data.giving.change_percent) ? `, ${changeWords(data.giving.change_percent)} on last year` : ""}` : null,
      data.event_check_ins ? `${plural(data.event_check_ins.this_year, "check-in")}` : null,
    ].flatMap((x) => (x ? [x] : []));
    const said = parts.length > 0 ? `${w.label}: ${parts.join("; ")}.` : undefined;
    return { ok: true, data, message: note ? `${said ? `${said} ` : ""}${note}.` : said };
  },
});
