// Pure voting-eligibility rules for the People › Voting eligibility tab.
// The nightly snapshot is the source of truth for a person; these helpers
// only explain it (tenure, household roll-up) and read the center's rules.

import { addDays } from "@/lib/dates";

export type VoterState = "eligible" | "not_eligible" | "not_computed";

/** rules.voting: life_member_wait_days (default 180) and an optional ballot_cutoff date (YYYY-MM-DD). */
export function votingRules(rules: unknown): { waitDays: number; ballotCutoff: string | null } {
  const voting = rules && typeof rules === "object" ? (rules as Record<string, unknown>).voting : undefined;
  const v = voting && typeof voting === "object" ? (voting as Record<string, unknown>) : {};
  const wait = typeof v.life_member_wait_days === "number" && v.life_member_wait_days >= 0 ? Math.round(v.life_member_wait_days) : 180;
  const cutoff = typeof v.ballot_cutoff === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.ballot_cutoff) ? v.ballot_cutoff : null;
  return { waitDays: wait, ballotCutoff: cutoff };
}

/** Life membership held at least `waitDays` days by `today`. */
export function tenureMet(since: string, waitDays: number, today: string): boolean {
  return addDays(since, waitDays) <= today;
}

/** A household is eligible when every adult with a snapshot can vote; not eligible when any cannot. */
export function householdVotingStatus(adults: boolean[]): VoterState {
  if (adults.length === 0) return "not_computed";
  return adults.every(Boolean) ? "eligible" : "not_eligible";
}

export type OverrideStep = "none" | "awaiting_second" | "ready_to_apply" | "applied";

export function overrideStep(o: { requestedBy: string | null; secondApprover: string | null; applied: boolean | null }): OverrideStep {
  if (o.applied !== null) return "applied";
  if (!o.requestedBy) return "none";
  return o.secondApprover ? "ready_to_apply" : "awaiting_second";
}
