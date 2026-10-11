import { reportReads } from "@/lib/reports/load";
import { onAppPercent } from "@/lib/reports/parse";
import { chosenYear, pctChange, yearWindow } from "@/lib/reports/periods";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";

import { changeWords, got, mayAccess, moneyOf, notShown, plural, todayOf } from "./shared";

export type OverviewData = {
  year: number;
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
  year: f.optional(f.integer("The year to report on, like 2026. Leave out for this year.", { min: 1991, max: 2100 })),
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
    const today = todayOf(ctx);
    const currentYear = Number(today.slice(0, 4));
    const w = yearWindow(chosenYear(asked ?? currentYear, currentYear), currentYear, today);
    const money = moneyOf(ctx);
    const seesPeople = mayAccess(ctx, "memberships");
    const seesGiving = mayAccess(ctx, "paymentsAll");
    const seesEvents = mayAccess(ctx, "events");
    const [people, given, prior, pledges, visits, priorVisits] = await Promise.all([
      seesPeople ? reportReads.peopleOverview(db, center.id, w.year, today) : null,
      seesGiving ? reportReads.payments(db, center.id, w.from, w.yearEnd, "none") : null,
      seesGiving ? reportReads.payments(db, center.id, w.prevFrom, w.prevEnd, "none") : null,
      seesGiving ? reportReads.pledges(db, center.id, w.from, w.yearEnd) : null,
      seesEvents ? reportReads.attendance(db, center.id, w.from, w.periodEnd, 1) : null,
      seesEvents ? reportReads.attendance(db, center.id, w.prevFrom, w.prevEnd, 1) : null,
    ]);
    const p = people ? got(people, "read the household figures") : null;
    const g = given ? got(given, "read the giving figures") : null;
    const gp = prior ? got(prior, "read last year's giving figures") : null;
    const pl = pledges ? got(pledges, "read the open pledges") : null;
    const v = visits ? got(visits, "read the event check-ins") : null;
    const vp = priorVisits ? got(priorVisits, "read last year's event check-ins") : null;
    const notShownList = [!seesPeople ? notShown("Households and renewals") : null, !seesGiving ? notShown("Giving") : null, !seesEvents ? notShown("Event check-ins") : null].flatMap((x) => (x ? [x] : []));
    const data: OverviewData = {
      year: w.year,
      as_of: today,
      households: p ? { total: p.households, new_in_year: p.newInYear, on_the_app_percent: onAppPercent(p), by_zone: p.zones } : null,
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
      data.households ? `${plural(data.households.total, "household")} (${data.households.new_in_year.toLocaleString("en-US")} new in ${w.year})` : null,
      data.giving ? `${data.giving.given} given${changeWords(data.giving.change_percent) ? `, ${changeWords(data.giving.change_percent)} on last year` : ""}` : null,
      data.event_check_ins ? `${plural(data.event_check_ins.this_year, "check-in")}` : null,
    ].flatMap((x) => (x ? [x] : []));
    return { ok: true, data, message: parts.length > 0 ? `${w.year}: ${parts.join("; ")}.` : undefined };
  },
});
