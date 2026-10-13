// Campaign progress for Giving › Campaigns & opportunities (docs/GIVING_REDESIGN.md section 4): what was pledged and received
// against the campaign's OWN goal, and how much of its OWN time has passed. Nothing is invented: no goal means no bar and no
// per cent, no dates mean no time line, and nothing says "on track" against a target the community never set. Pure, integer
// cents in the community's currency, dates as YYYY-MM-DD in the community's time zone. Unit-tested.

import { daysBetween } from "@/lib/dates";
import { formatCents } from "@/lib/money";

export type CampaignTotals = { pledgedCents: number; receivedCents: number; pledges: number };

export type CampaignProgressInput = {
  goalCents: number | null;
  pledgedCents: number;
  receivedCents: number;
  startsOn: string | null;
  endsOn: string | null;
  /** The community's today (YYYY-MM-DD). */
  today: string;
};

export type TimeProgress =
  | { state: "not_started"; days: number }
  | { state: "running"; elapsedDays: number; totalDays: number; percent: number }
  | { state: "open_ended"; elapsedDays: number }
  | { state: "days_left"; days: number }
  | { state: "ended" };

export type CampaignProgress = {
  goalCents: number | null;
  /** Whole per cent of the goal pledged, rounded down (it passes 100 when the goal is beaten); null without a goal. */
  pledgedPercent: number | null;
  receivedPercent: number | null;
  /** Bar widths, 0 to 100: a bar is never wider than the goal, and a gift too small to round to 1 % still shows a sliver. */
  pledgedBar: number;
  receivedBar: number;
  /** Null when the campaign has no dates. */
  time: TimeProgress | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Whole per cent of `whole`, rounded down; exact with integer cents up to any amount a community will hold. */
export function percentOf(part: number, whole: number): number {
  if (!(whole > 0) || !(part > 0)) return 0;
  const scaled = part * 100;
  return Number.isSafeInteger(scaled) ? Math.floor(scaled / whole) : Math.floor((part / whole) * 100);
}

function bar(part: number, whole: number | null): number {
  if (whole === null || !(whole > 0) || !(part > 0)) return 0;
  return Math.max(1, Math.min(100, percentOf(part, whole)));
}

function timeProgress(startsOn: string | null, endsOn: string | null, today: string): TimeProgress | null {
  const start = startsOn && DATE.test(startsOn) ? startsOn : null;
  const end = endsOn && DATE.test(endsOn) ? endsOn : null;
  if (!start && !end) return null;
  if (start && daysBetween(today, start) > 0) return { state: "not_started", days: daysBetween(today, start) };
  if (end && daysBetween(end, today) > 0) return { state: "ended" };
  if (start && end) {
    // Both days count: a campaign from the 1st to the 30th runs 30 days, and its first day is day 1.
    const totalDays = daysBetween(start, end) + 1;
    const elapsedDays = daysBetween(start, today) + 1;
    return { state: "running", elapsedDays, totalDays, percent: Math.min(100, percentOf(elapsedDays, totalDays)) };
  }
  if (start) return { state: "open_ended", elapsedDays: daysBetween(start, today) + 1 };
  return { state: "days_left", days: daysBetween(today, end as string) };
}

export function campaignProgress(input: CampaignProgressInput): CampaignProgress {
  const goal = input.goalCents !== null && input.goalCents > 0 ? input.goalCents : null;
  const pledged = Math.max(0, input.pledgedCents);
  const received = Math.max(0, input.receivedCents);
  return {
    goalCents: goal,
    pledgedPercent: goal === null ? null : percentOf(pledged, goal),
    receivedPercent: goal === null ? null : percentOf(received, goal),
    pledgedBar: bar(pledged, goal),
    receivedBar: bar(received, goal),
    time: timeProgress(input.startsOn, input.endsOn, input.today),
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The words under a campaign's bars ("Pledged $12,400 of $50,000 (24%)", "12 of 30 days passed"). */
export function progressWords(
  p: CampaignProgress,
  totals: Pick<CampaignTotals, "pledgedCents" | "receivedCents">,
  currency: string,
  locale = "en-US",
): {
  pledged: string;
  received: string;
  time: string | null;
} {
  const money = (c: number) => formatCents(c, currency, locale);
  const pledged =
    p.goalCents === null
      ? `No goal set · ${money(totals.pledgedCents)} pledged`
      : `Pledged ${money(totals.pledgedCents)} of ${money(p.goalCents)} (${p.pledgedPercent}%)`;
  const received = `Received ${money(totals.receivedCents)}${p.goalCents === null ? "" : ` (${p.receivedPercent}%)`}`;
  const t = p.time;
  const time =
    t === null
      ? null
      : t.state === "not_started"
        ? `Starts in ${plural(t.days, "day")}`
        : t.state === "ended"
          ? "Ended"
          : t.state === "running"
            ? `${t.elapsedDays} of ${plural(t.totalDays, "day")} passed`
            : t.state === "open_ended"
              ? `Running for ${plural(t.elapsedDays, "day")}, no end date`
              : t.days === 0
                ? "Ends today"
                : `${plural(t.days, "day")} left`;
  return { pledged, received, time };
}
