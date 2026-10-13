// Invented numbers for the Insights dev preview and tests: a church, a chamber of commerce (not a faith community, Canadian
// dollars, a year from April) and a temple (Indian rupees), plus a small club with fewer than 10 giving households. No real
// community, no names. Pure.

import type { InsightsContext } from "./view";
import type { InsightsData } from "./parse";

export type InsightsSample = "church" | "chamber" | "temple" | "small";
export const INSIGHTS_SAMPLES: readonly InsightsSample[] = ["church", "chamber", "temple", "small"];

const months = (start: string, now: number[], before: number[]) => {
  const [y, m] = start.split("-").map(Number);
  return now.map((c, i) => {
    const idx = y * 12 + (m - 1) + i;
    return { month: `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`, thisCents: c, lastCents: before[i] ?? 0 };
  });
};

function base(from: string, to: string, prevTo: string, scale: number): InsightsData {
  const s = (c: number) => Math.round(c * scale);
  const [fy] = from.split("-").map(Number);
  return {
    from,
    to,
    today: to,
    prevFrom: `${fy - 1}${from.slice(4)}`,
    prevTo,
    prevEnd: "",
    donations: {
      thisCents: s(18_450_000),
      samePointLastCents: s(16_920_000),
      lastYearCents: s(21_300_000),
      gifts: 1_204,
      averageGiftCents: s(15_324),
      medianGiftCents: s(5_000),
      households: 212,
      householdsSamePointLast: 198,
      medianHouseholdCents: s(42_000),
      memberHouseholds: 340,
    },
    fees: { thisCents: s(2_310_000), membershipCents: s(1_980_000), schoolCents: s(250_000), storeCents: s(80_000) },
    retention: { kept: 171, lost: 38, new: 29, regained: 12 },
    concentration: { households: 212, topHouseholds: 22, topCents: s(7_380_000) },
    categories: {
      fund: [
        { key: "f1", label: "Building fund", thisCents: s(7_400_000), lastCents: s(5_800_000) },
        { key: "f2", label: "General fund", thisCents: s(6_100_000), lastCents: s(5_200_000) },
        { key: "f3", label: "Youth programs", thisCents: s(1_200_000), lastCents: s(1_500_000) },
      ],
      campaign: [{ key: "c1", label: "Annual appeal", thisCents: s(3_800_000), lastCents: s(3_000_000) }],
      opportunity: [{ key: "o1", label: "Event sponsors", thisCents: s(950_000), lastCents: 0 }],
      appliedThisCents: s(15_650_000),
      appliedLastCents: s(13_100_000),
    },
    recurring: { thisCents: s(2_640_000), activeGifts: 58 },
    pledges: {
      made: 96,
      pledgedCents: s(9_800_000),
      paidCents: s(6_420_000),
      writtenOffCents: s(120_000),
      ageing: [
        { bucket: "not_due", pledges: 41, openCents: s(2_100_000) },
        { bucket: "1_30", pledges: 9, openCents: s(310_000) },
        { bucket: "31_60", pledges: 5, openCents: s(180_000) },
        { bucket: "61_90", pledges: 3, openCents: s(90_000) },
        { bucket: "over_90", pledges: 7, openCents: s(260_000) },
      ],
    },
    pipeline: {
      overdueCents: s(840_000),
      overduePledges: 24,
      months: months(to.slice(0, 7) + "-01", [s(420_000), s(380_000), s(910_000), 0, s(150_000)], []).map((m, i) => ({
        month: m.month,
        pledges: [6, 5, 12, 0, 2][i],
        openCents: m.thisCents,
      })),
      laterCents: s(120_000),
    },
    // Nothing is given after the last day counted.
    months: months(from, [1.2, 1.1, 1.0, 0.9, 1.3, 1.4, 1.2, 1.5, 2.2, 1.6, 1.8, 3.1].map((x) => s(x * 1_000_000)), [1.0, 1.1, 0.9, 1.0, 1.1, 1.2, 1.0, 1.3, 1.9, 2.4, 2.9, 5.5].map((x) => s(x * 1_000_000))).map(
      (m) => (m.month > to.slice(0, 7) ? { ...m, thisCents: 0 } : m),
    ),
    goals: [
      { key: "c1", label: "Annual appeal", goalCents: s(6_000_000), startsOn: `${fy}${from.slice(4)}`, endsOn: to.slice(0, 4) + "-12-31", pledgedCents: s(4_400_000), paidCents: s(3_800_000) },
    ],
  };
}

export function sampleInsights(sample: InsightsSample): { data: InsightsData; ctx: InsightsContext } {
  const words = { household: "household", households: "households", school: "School" as string | null, store: "Store" };
  switch (sample) {
    case "chamber":
      return {
        data: { ...base("2026-04-01", "2026-10-13", "2025-10-13", 1), prevEnd: "2026-03-31", fees: { thisCents: 4_200_000, membershipCents: 4_200_000, schoolCents: 0, storeCents: 0 } },
        ctx: {
          currency: "CAD",
          locale: "en-CA",
          yearLabel: "2026-27",
          isCurrentYear: true,
          words: { household: "member business", households: "member businesses", school: null, store: "Store" },
          opportunitiesOn: true,
          recurringOn: false,
        },
      };
    case "temple":
      return {
        data: { ...base("2026-01-01", "2026-10-13", "2025-10-13", 80), prevEnd: "2025-12-31" },
        ctx: { currency: "INR", locale: "en-IN", yearLabel: "2026", isCurrentYear: true, words: { ...words, household: "family", households: "families", school: "Pathshala" }, opportunitiesOn: true, recurringOn: true },
      };
    case "small": {
      const d = base("2025-01-01", "2025-12-31", "2024-12-31", 0.05);
      return {
        data: {
          ...d,
          prevEnd: "2024-12-31",
          donations: { ...d.donations, gifts: 31, averageGiftCents: 29_758, medianGiftCents: 10_000, households: 7, medianHouseholdCents: 120_000, memberHouseholds: 18, householdsSamePointLast: 8 },
          retention: { kept: 5, lost: 3, new: 1, regained: 1 },
          concentration: { households: 7, topHouseholds: null, topCents: null },
          goals: [],
        },
        ctx: { currency: "USD", locale: "en-US", yearLabel: "2025", isCurrentYear: false, words, opportunitiesOn: false, recurringOn: false },
      };
    }
    default:
      return {
        data: { ...base("2026-01-01", "2026-10-13", "2025-10-13", 1), prevEnd: "2025-12-31" },
        ctx: { currency: "USD", locale: "en-US", yearLabel: "2026", isCurrentYear: true, words, opportunitiesOn: true, recurringOn: true },
      };
  }
}
