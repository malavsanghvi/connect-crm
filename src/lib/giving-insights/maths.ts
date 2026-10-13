// Giving › Insights: the arithmetic on top of the database's sums. Pure, integer cents in, whole basis points or cents out.

/** part of whole in basis points (1% = 100), rounded; null when there is nothing to divide by. */
export function shareBp(part: number, whole: number): number | null {
  if (!(whole > 0)) return null;
  return Math.round((part / whole) * 10_000);
}

/** "40%", "4.5%" under 10 percent, "under 1%" for a share that rounds to zero but is not zero. */
export function percentText(bp: number | null): string | null {
  if (bp === null) return null;
  if (bp === 0) return "0%";
  if (bp < 50) return "under 1%";
  if (bp < 1000) return `${(Math.round(bp / 10) / 10).toLocaleString("en-US")}%`;
  return `${Math.round(bp / 100).toLocaleString("en-US")}%`;
}

/** "+12%" or "-5%" against last year; null when last year had nothing (no comparison is invented). */
export function changeText(now: number, before: number): string | null {
  if (!(before > 0)) return null;
  const pct = Math.round(((now - before) / before) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

/** An amount shared out over a count, in whole cents; null when the count is zero. */
export function perEach(cents: number, count: number): number | null {
  return count > 0 ? Math.round(cents / count) : null;
}

/** The under-10 rule (0011): with fewer than 10 giving households the top tenth's share is never shown. */
export const MIN_FOR_CONCENTRATION = 10;

export function concentrationBp(c: { households: number; topCents: number | null }, totalCents: number): number | null {
  if (c.households < MIN_FOR_CONCENTRATION || c.topCents === null) return null;
  return shareBp(c.topCents, totalCents);
}

/** Of the households that gave last year, the share that gave again this year. */
export function retentionBp(r: { kept: number; lost: number }): number | null {
  return shareBp(r.kept, r.kept + r.lost);
}

/** The month that holds the largest part of the year, when the year has any giving. */
export function peakMonth<T extends { month: string; thisCents: number }>(months: readonly T[]): { month: string; shareBp: number } | null {
  const total = months.reduce((a, m) => a + m.thisCents, 0);
  if (total <= 0) return null;
  const top = months.reduce((a, m) => (m.thisCents > a.thisCents ? m : a));
  return { month: top.month, shareBp: shareBp(top.thisCents, total) ?? 0 };
}

const dayNumber = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

/** How far through its dates a campaign is, in basis points; null without both dates. */
export function elapsedBp(startsOn: string | null, endsOn: string | null, today: string): number | null {
  if (!startsOn || !endsOn) return null;
  const span = dayNumber(endsOn) - dayNumber(startsOn);
  if (!(span > 0)) return null;
  const done = Math.min(Math.max(dayNumber(today) - dayNumber(startsOn), 0), span);
  return Math.round((done / span) * 10_000);
}

export type Pace = "ahead" | "on_pace" | "behind";

/** Raised against time elapsed: within 5 points is on pace. Null when the campaign has no dates (nothing is invented). */
export function pace(raisedBp: number, elapsed: number | null): Pace | null {
  if (elapsed === null) return null;
  const gap = raisedBp - elapsed;
  return gap > 500 ? "ahead" : gap < -500 ? "behind" : "on_pace";
}
