// Giving › Insights (B98 slice 1): what app.giving_insights (0749) returns, read defensively. Pure. Every amount is integer cents
// in the community's currency; nothing here names a household or a person (the function returns aggregates only).

export type AgeBucket = "not_due" | "1_30" | "31_60" | "61_90" | "over_90";
export const AGE_BUCKETS: readonly AgeBucket[] = ["not_due", "1_30", "31_60", "61_90", "over_90"];

export type CategoryRow = { key: string; label: string; thisCents: number; lastCents: number };
export type MonthRow = { month: string; thisCents: number; lastCents: number };
export type GoalRow = { key: string; label: string; goalCents: number; startsOn: string | null; endsOn: string | null; pledgedCents: number; paidCents: number };

export type InsightsData = {
  from: string;
  to: string;
  today: string;
  prevFrom: string;
  prevTo: string;
  prevEnd: string;
  donations: {
    thisCents: number;
    samePointLastCents: number;
    lastYearCents: number;
    gifts: number;
    averageGiftCents: number | null;
    medianGiftCents: number | null;
    households: number;
    householdsSamePointLast: number;
    medianHouseholdCents: number | null;
    memberHouseholds: number;
  };
  fees: { thisCents: number; membershipCents: number; schoolCents: number; storeCents: number };
  retention: { kept: number; lost: number; new: number; regained: number };
  concentration: { households: number; topHouseholds: number | null; topCents: number | null };
  categories: { fund: CategoryRow[]; campaign: CategoryRow[]; opportunity: CategoryRow[]; appliedThisCents: number; appliedLastCents: number };
  recurring: { thisCents: number; activeGifts: number };
  pledges: { made: number; pledgedCents: number; paidCents: number; writtenOffCents: number; ageing: { bucket: AgeBucket; pledges: number; openCents: number }[] };
  pipeline: { overdueCents: number; overduePledges: number; months: { month: string; pledges: number; openCents: number }[]; laterCents: number };
  months: MonthRow[];
  goals: GoalRow[];
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : 0;
};
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : num(v));
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

function categories(v: unknown): CategoryRow[] {
  return arr(v).flatMap((x) => {
    const o = obj(x);
    const key = str(o.key);
    return key ? [{ key, label: str(o.label) || "Unnamed", thisCents: num(o.this_cents), lastCents: num(o.last_cents) }] : [];
  });
}

/** The function's answer, or null when it is not the shape 0749 returns (the screen then says it could not read the numbers). */
export function parseInsights(raw: unknown): InsightsData | null {
  const o = obj(raw);
  const dates = [o.from, o.to, o.today, o.prev_from, o.prev_to, o.prev_end].map(str);
  if (!dates.every((d) => DAY.test(d))) return null;
  const d = obj(o.donations);
  const f = obj(o.fees);
  const r = obj(o.retention);
  const c = obj(o.concentration);
  const cat = obj(o.categories);
  const rec = obj(o.recurring);
  const p = obj(o.pledges);
  const pipe = obj(o.pipeline);
  const ageing = new Map(arr(p.ageing).map((x) => [str(obj(x).bucket), obj(x)] as const));
  return {
    from: dates[0],
    to: dates[1],
    today: dates[2],
    prevFrom: dates[3],
    prevTo: dates[4],
    prevEnd: dates[5],
    donations: {
      thisCents: num(d.this_cents),
      samePointLastCents: num(d.same_point_last_cents),
      lastYearCents: num(d.last_year_cents),
      gifts: num(d.gifts),
      averageGiftCents: numOrNull(d.average_gift_cents),
      medianGiftCents: numOrNull(d.median_gift_cents),
      households: num(d.households),
      householdsSamePointLast: num(d.households_same_point_last),
      medianHouseholdCents: numOrNull(d.median_household_cents),
      memberHouseholds: num(d.member_households),
    },
    fees: { thisCents: num(f.this_cents), membershipCents: num(f.membership_cents), schoolCents: num(f.school_cents), storeCents: num(f.store_cents) },
    retention: { kept: num(r.kept), lost: num(r.lost), new: num(r.new), regained: num(r.regained) },
    concentration: { households: num(c.households), topHouseholds: numOrNull(c.top_households), topCents: numOrNull(c.top_cents) },
    categories: {
      fund: categories(cat.fund),
      campaign: categories(cat.campaign),
      opportunity: categories(cat.opportunity),
      appliedThisCents: num(cat.applied_this_cents),
      appliedLastCents: num(cat.applied_last_cents),
    },
    recurring: { thisCents: num(rec.this_cents), activeGifts: num(rec.active_gifts) },
    pledges: {
      made: num(p.made),
      pledgedCents: num(p.pledged_cents),
      paidCents: num(p.paid_cents),
      writtenOffCents: num(p.written_off_cents),
      ageing: AGE_BUCKETS.map((bucket) => ({ bucket, pledges: num(ageing.get(bucket)?.pledges), openCents: num(ageing.get(bucket)?.open_cents) })),
    },
    pipeline: {
      overdueCents: num(pipe.overdue_cents),
      overduePledges: num(pipe.overdue_pledges),
      months: arr(pipe.months).flatMap((x) => {
        const m = obj(x);
        return MONTH.test(str(m.month)) ? [{ month: str(m.month), pledges: num(m.pledges), openCents: num(m.open_cents) }] : [];
      }),
      laterCents: num(pipe.later_cents),
    },
    months: arr(o.months).flatMap((x) => {
      const m = obj(x);
      return MONTH.test(str(m.month)) ? [{ month: str(m.month), thisCents: num(m.this_cents), lastCents: num(m.last_cents) }] : [];
    }),
    goals: arr(o.goals).flatMap((x) => {
      const g = obj(x);
      const key = str(g.key);
      return key && num(g.goal_cents) > 0
        ? [{ key, label: str(g.label) || "Unnamed", goalCents: num(g.goal_cents), startsOn: strOrNull(g.starts_on), endsOn: strOrNull(g.ends_on), pledgedCents: num(g.pledged_cents), paidCents: num(g.paid_cents) }]
        : [];
    }),
  };
}
