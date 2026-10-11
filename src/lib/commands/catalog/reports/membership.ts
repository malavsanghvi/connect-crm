import { reportReads } from "@/lib/reports/load";
import { cellCount } from "@/lib/reports/parse";

import { defineCommand } from "../../define";
import { object, type Infer } from "../../schema";

import { dateFields, got, resolveRange, thirtyDaysAgo } from "./shared";

const TIERS = ["life", "yearly", "community"] as const;
const STATUSES = ["active", "pending", "lapsed", "suspended", "ended"] as const;

export type MembershipCountsData = {
  /** Memberships by tier and status, right now. Households are counted once per tier in active_households_by_tier. */
  now: {
    active: number;
    by_tier_and_status: { tier: string; status: string; memberships: number }[];
    active_households_by_tier: { tier: string; households: number }[];
    renewals_due_in_60_days: number;
  };
  /** Applications by status, all time. */
  applications_all_time: { status: string; applications: number }[];
  /** What changed between the two days. */
  changes: {
    from: string;
    to: string;
    started: number;
    started_by_tier: { tier: string; memberships: number }[];
    lapsed_or_ended: number;
    lapsed_or_ended_by_status: { status: string; memberships: number }[];
    applications_received: number;
    applications_received_by_status: { status: string; applications: number }[];
  };
};

const input = object({ ...dateFields });

/** Membership counts now, and what changed in a range of days (who started, who lapsed or ended, applications). */
export const membershipCounts = defineCommand<Infer<typeof input>, MembershipCountsData>({
  key: "reports.membership_counts",
  title: "Count memberships and what changed",
  description:
    "Count memberships by tier (life, yearly, community) and status (active, pending, lapsed, suspended, ended), the households with an active membership in each tier, and the renewals due in the next 60 days; " +
    "also what changed between two days: memberships that started, memberships that lapsed or ended, and applications received. Leave the dates out for the last 30 days. " +
    "Use it for 'how many active members do we have?' and 'how many joined this month?'. The sums are done by the database and are exact. Counts only: no person or household is named. Read only.",
  level: "read",
  permission: "memberships",
  module: "reports",
  input,
  async execute(ctx, { from, to }) {
    const { db, center } = ctx.session;
    const range = resolveRange(ctx, { from, to }, thirtyDaysAgo);
    const [matrixRead, changesRead] = await Promise.all([
      reportReads.membershipMatrix(db, center.id),
      reportReads.membershipChanges(db, center.id, range.from, range.to, range.today),
    ]);
    const m = got(matrixRead, "count the memberships");
    const c = got(changesRead, "count the membership changes");
    const data: MembershipCountsData = {
      now: {
        active: c.activeNow,
        by_tier_and_status: TIERS.flatMap((tier) => STATUSES.map((status) => ({ tier, status, memberships: cellCount(m, tier, status) }))),
        active_households_by_tier: TIERS.map((tier) => ({ tier, households: m.activeHouseholds[tier] ?? 0 })),
        renewals_due_in_60_days: c.renewalsDue60Days,
      },
      applications_all_time: Object.entries(m.applications).map(([status, applications]) => ({ status, applications })),
      changes: {
        from: range.from,
        to: range.to,
        started: c.startedTotal,
        started_by_tier: c.started,
        lapsed_or_ended: c.endedTotal,
        lapsed_or_ended_by_status: c.ended,
        applications_received: c.applicationsTotal,
        applications_received_by_status: c.applications,
      },
    };
    return {
      ok: true,
      data,
      message: `${c.activeNow.toLocaleString("en-US")} active memberships. ${range.words}: ${c.startedTotal} started, ${c.endedTotal} lapsed or ended, ${c.applicationsTotal} applications received.`,
    };
  },
});
