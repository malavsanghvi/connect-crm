// Giving › Insights: the numbers as a person reads them. Pure: no React, no database. Words come from the organization's kind
// (its own word for a household, a school, a store), money is written in the community's currency, and nothing names a
// household or a person (docs/GIVING_INSIGHTS.md section 5).

import { barPercent } from "@/lib/giving";
import { formatCents } from "@/lib/money";

import {
  changeText,
  concentrationBp,
  elapsedBp,
  pace,
  peakMonth,
  percentText,
  perEach,
  retentionBp,
  shareBp,
  MIN_FOR_CONCENTRATION,
  type Pace,
} from "./maths";
import { type AgeBucket, type CategoryRow, type InsightsData } from "./parse";

export type InsightsWords = {
  /** The kind's word for a household, singular and plural ("household", "member business"). */
  household: string;
  households: string;
  /** The kind's word for its school, or null when the kind has none (a chamber). */
  school: string | null;
  store: string;
};

export type InsightsContext = {
  currency: string;
  locale: string;
  /** "2026" or "2025-26". */
  yearLabel: string;
  isCurrentYear: boolean;
  words: InsightsWords;
  /** Add-on modules: their parts are left out when they are off. */
  opportunitiesOn: boolean;
  recurringOn: boolean;
};

export type Figure = { label: string; value: string; hint: string | null };
export type CategoryLine = { label: string; now: string; before: string; change: string | null; bar: number };
export type CategoryBlock = { key: "fund" | "campaign" | "opportunity"; title: string; lines: CategoryLine[]; empty: string };
export type GoalLine = { label: string; line: string; raisedPercent: number; elapsedPercent: number | null; pace: Pace | null; paceText: string | null };

export type InsightsView = {
  title: string;
  period: string;
  figures: Figure[];
  categories: CategoryBlock[];
  /** Donations not applied to any pledge (they have no fund, campaign or opportunity). */
  noCategory: CategoryLine;
  retention: { kept: number; lost: number; new: number; regained: number; rate: string | null; lostWord: string; note: string };
  concentration: string;
  pledges: { fulfilment: string | null; lines: string[]; ageing: { label: string; pledges: number; open: string }[] };
  recurring: string | null;
  months: { label: string; now: string; before: string; bar: number; barBefore: number }[];
  peak: string | null;
  pipeline: { overdue: string; months: { label: string; pledges: number; open: string }[]; later: string | null };
  goals: GoalLine[];
  fees: string | null;
};

const AGE_LABEL: Record<AgeBucket, string> = {
  not_due: "Not due yet",
  "1_30": "1 to 30 days late",
  "31_60": "31 to 60 days late",
  "61_90": "61 to 90 days late",
  over_90: "Over 90 days late",
};

const PACE_TEXT: Record<Pace, string> = { ahead: "ahead of the calendar", on_pace: "on pace with the calendar", behind: "behind the calendar" };

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function buildInsightsView(data: InsightsData, ctx: InsightsContext): InsightsView {
  const money = (c: number | null) => (c === null ? "—" : formatCents(c, ctx.currency, ctx.locale));
  const w = ctx.words;
  const d = data.donations;
  const before = ctx.isCurrentYear ? `to ${dayLabel(data.prevTo)}` : "last year";
  const lastYear = ctx.isCurrentYear ? "the same day last year" : "last year";

  const figures: Figure[] = [
    {
      label: ctx.isCurrentYear ? "Given so far" : "Given in the year",
      value: money(d.thisCents),
      hint: d.samePointLastCents > 0 ? `${money(d.samePointLastCents)} ${before} (${changeText(d.thisCents, d.samePointLastCents)})` : "Nothing to compare with last year",
    },
    {
      label: `Giving ${w.households}`,
      value: d.households.toLocaleString("en-US"),
      hint: `${percentText(shareBp(d.households, d.memberHouseholds)) ?? "—"} of ${plural(d.memberHouseholds, w.household, w.households)} (participation)`,
    },
    { label: "Average gift", value: money(d.averageGiftCents), hint: `${plural(d.gifts, "gift", "gifts")}` },
    { label: "Median gift", value: money(d.medianGiftCents), hint: "Half the gifts were smaller, half larger" },
    { label: `Typical year per giving ${w.household}`, value: money(d.medianHouseholdCents), hint: `The middle ${w.household}; average ${money(perEach(d.thisCents, d.households))}` },
    { label: `Per ${w.household}, giving or not`, value: money(perEach(d.thisCents, d.memberHouseholds)), hint: `Everything given, shared over all ${plural(d.memberHouseholds, w.household, w.households)}` },
  ];

  const block = (key: CategoryBlock["key"], title: string, rows: CategoryRow[]): CategoryBlock => {
    const max = Math.max(0, ...rows.map((r) => Math.max(r.thisCents, r.lastCents)));
    return {
      key,
      title,
      lines: rows.map((r) => ({ label: r.label, now: money(r.thisCents), before: money(r.lastCents), change: changeText(r.thisCents, r.lastCents), bar: barPercent(r.thisCents, max) })),
      empty: `No giving was applied to a ${title.toLowerCase().replace(/^by /, "")} in this period.`,
    };
  };
  const categories = [block("fund", "By fund", data.categories.fund), block("campaign", "By campaign", data.categories.campaign)];
  if (ctx.opportunitiesOn) categories.push(block("opportunity", "By opportunity", data.categories.opportunity));
  const looseNow = Math.max(d.thisCents - data.categories.appliedThisCents, 0);
  const looseBefore = Math.max(d.samePointLastCents - data.categories.appliedLastCents, 0);

  const conc = concentrationBp(data.concentration, d.thisCents);
  const concentration =
    conc === null
      ? `Fewer than ${MIN_FOR_CONCENTRATION} ${w.households} gave in this period, so the share given by the top tenth is not shown.`
      : `The top ${plural(data.concentration.topHouseholds ?? 0, w.household, w.households)} (a tenth of those who gave) gave ${percentText(conc)} of the total.`;

  const p = data.pledges;
  const fulfilment = percentText(shareBp(p.paidCents, p.pledgedCents));
  const pledgeLines = [
    p.made > 0
      ? `${plural(p.made, "pledge", "pledges")} made in ${ctx.yearLabel}: ${money(p.pledgedCents)} pledged, ${money(p.paidCents)} paid${p.writtenOffCents > 0 ? `, ${money(p.writtenOffCents)} written off` : ""}.`
      : `No pledges were made in ${ctx.yearLabel}.`,
  ];

  const peak = peakMonth(data.months);
  const maxMonth = Math.max(0, ...data.months.map((m) => Math.max(m.thisCents, m.lastCents)));

  const fees = [
    data.fees.membershipCents > 0 ? `membership fees ${money(data.fees.membershipCents)}` : null,
    data.fees.schoolCents > 0 && w.school ? `${w.school.toLowerCase()} fees ${money(data.fees.schoolCents)}` : null,
    data.fees.storeCents > 0 ? `${w.store.toLowerCase()} sales ${money(data.fees.storeCents)}` : null,
  ].filter((x): x is string => x !== null);

  return {
    title: `Giving insights, ${ctx.yearLabel}`,
    period: `${dayLabel(data.from)} to ${dayLabel(data.to)}${ctx.isCurrentYear ? " (so far)" : ""}, against ${lastYear}. Donations only: fees are on their own line, and imported opening balances are left out.`,
    figures,
    categories,
    noCategory: { label: "Not applied to a pledge", now: money(looseNow), before: money(looseBefore), change: changeText(looseNow, looseBefore), bar: 0 },
    retention: {
      ...data.retention,
      rate: percentText(retentionBp(data.retention)),
      lostWord: ctx.isCurrentYear ? "Not yet this year" : "Lost",
      note: `Giving ${w.households}, this year against last year`,
    },
    concentration,
    pledges: {
      fulfilment,
      lines: pledgeLines,
      ageing: p.ageing.map((a) => ({ label: AGE_LABEL[a.bucket], pledges: a.pledges, open: money(a.openCents) })),
    },
    recurring: ctx.recurringOn
      ? `${money(data.recurring.thisCents)} came through recurring gifts (${percentText(shareBp(data.recurring.thisCents, d.thisCents)) ?? "0%"} of the total); ${plural(data.recurring.activeGifts, "recurring gift is", "recurring gifts are")} active.`
      : null,
    months: data.months.map((m) => ({ label: monthLabel(m.month), now: money(m.thisCents), before: money(m.lastCents), bar: barPercent(m.thisCents, maxMonth), barBefore: barPercent(m.lastCents, maxMonth) })),
    peak: peak ? `${monthLabel(peak.month)} holds ${percentText(peak.shareBp)} of the year's giving so far.` : null,
    pipeline: {
      overdue: data.pipeline.overduePledges > 0 ? `${money(data.pipeline.overdueCents)} is past due on ${plural(data.pipeline.overduePledges, "pledge", "pledges")}.` : "Nothing is past due.",
      months: data.pipeline.months.filter((m) => m.pledges > 0).map((m) => ({ label: monthLabel(m.month), pledges: m.pledges, open: money(m.openCents) })),
      later: data.pipeline.laterCents > 0 ? `${money(data.pipeline.laterCents)} is due after that.` : null,
    },
    goals: data.goals.map((g) => {
      const raised = shareBp(g.paidCents, g.goalCents) ?? 0;
      const elapsed = elapsedBp(g.startsOn, g.endsOn, data.today);
      const pc = pace(raised, elapsed);
      return {
        label: g.label,
        line: `${money(g.paidCents)} raised of ${money(g.goalCents)} (${percentText(raised)}); ${money(g.pledgedCents)} pledged.`,
        raisedPercent: Math.min(100, Math.round(raised / 100)),
        elapsedPercent: elapsed === null ? null : Math.round(elapsed / 100),
        pace: pc,
        paceText: pc === null ? null : `${percentText(elapsed)} of its time has passed: ${PACE_TEXT[pc]}.`,
      };
    }),
    fees: fees.length > 0 ? `Not counted above: ${fees.join(", ")}.` : null,
  };
}
