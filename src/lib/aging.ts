import { daysBetween } from "@/lib/dates";

// Pledge aging for outstanding (open / partially paid) pledges. Age runs from
// the due date when there is one, otherwise from the day the pledge was made.

export const AGING_BUCKETS = [
  { key: "not_due", label: "Not yet due" },
  { key: "d0_30", label: "0–30 days" },
  { key: "d31_60", label: "31–60 days" },
  { key: "d61_90", label: "61–90 days" },
  { key: "d90_plus", label: "Over 90 days" },
] as const;

export type AgingBucketKey = (typeof AGING_BUCKETS)[number]["key"];

/**
 * @param dueOn    pledge due date (YYYY-MM-DD) or null
 * @param pledgedOn calendar date the pledge was made, in the center's zone (YYYY-MM-DD)
 * @param today    today in the center's zone (YYYY-MM-DD)
 */
export function agingBucket(dueOn: string | null, pledgedOn: string, today: string): AgingBucketKey {
  const ref = dueOn ?? pledgedOn;
  const age = daysBetween(ref, today);
  if (age < 0) return "not_due";
  if (age <= 30) return "d0_30";
  if (age <= 60) return "d31_60";
  if (age <= 90) return "d61_90";
  return "d90_plus";
}

export type AgingSummary = Record<AgingBucketKey, { count: number; open_cents: number }>;

export function emptyAging(): AgingSummary {
  return {
    not_due: { count: 0, open_cents: 0 },
    d0_30: { count: 0, open_cents: 0 },
    d31_60: { count: 0, open_cents: 0 },
    d61_90: { count: 0, open_cents: 0 },
    d90_plus: { count: 0, open_cents: 0 },
  };
}
