// QuickBooks donor matches waiting for a person, read for Giving › Today and the Books tab. Read with the person's own access
// (qbo_customer_matches: accounting.manage or giving.manage, 0240); approving stays the existing approveMatchAction.

import { groupSuggestions, type DonorSuggestion, type MatchRow } from "@/lib/books/donors";
import { householdCards } from "@/lib/data/lookups";
import { failure } from "@/lib/errors";
import { familyFrom, type Family } from "@/lib/giving-today/queue";
import type { Part } from "@/lib/giving-workspace/view";
import { isModuleEnabled } from "@/lib/modules";
import { canAccess } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

export type DonorMatchesIn = {
  /** The person may approve (accounting.manage); otherwise the rows are a plain count. */
  canApprove: boolean;
  customers: number;
  several: number;
  /** Single-suggestion customers shown with their household, the surest first (at most the limit asked for). */
  shown: (DonorSuggestion & { family: Family })[];
  /** Single-suggestion customers beyond the ones shown. */
  more: number;
};

/** The donor-matching page reads the same many suggestions; a community with more waits in Donor matching. */
const READ_LIMIT = 3000;

export function seesDonorMatches(session: CrmSession): boolean {
  return canAccess(session, "qboMatch") && isModuleEnabled(session, "accounting");
}

export async function loadDonorMatches(session: CrmSession, limit: number): Promise<Part<DonorMatchesIn>> {
  if (!isModuleEnabled(session, "accounting")) return { state: "off" };
  if (!canAccess(session, "qboMatch")) return { state: "no_access" };
  const { db, center } = session;
  const res = await db
    .from("qbo_customer_matches")
    .select("id, qbo_customer_id, household_id, confidence, method, evidence")
    .eq("center_id", center.id)
    .eq("status", "suggested")
    .order("confidence", { ascending: false })
    .limit(READ_LIMIT);
  if (res.error) return { state: "error", error: failure("Could not read the QuickBooks donor matches", res.error).error };
  const groups = groupSuggestions((res.data ?? []) as MatchRow[]);
  const pick = groups.single.slice(0, limit);
  const cards = await householdCards(db, pick.map((s) => s.householdId));
  if (cards.error) console.error("[books-donors] some household cards could not be read; those matches stay in Donor matching:", cards.error);
  // A match is approved in a row only next to its household card: one whose card cannot be read waits in Donor matching.
  const shown = pick.flatMap((s) => {
    const card = cards.map.get(s.householdId);
    return card ? [{ ...s, family: familyFrom(card) }] : [];
  });
  return {
    state: "ok",
    data: { canApprove: canAccess(session, "qboMatchManage"), customers: groups.customers, several: groups.several, shown, more: groups.single.length - shown.length },
  };
}
