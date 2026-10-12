import { parseFamilyMatches, type FamilyMatchReason, type FamilyMatchView, type FamilyMatchesView } from "@/lib/people-family";
import type { AppSupabase } from "@/lib/supabase/server";

import { communityMajority } from "../../child-filter";
import type { CommandContext, HouseholdCard } from "../../types";
import { rpcJson } from "../db";
import { adultHouseholdCards } from "../household";

import { cardLine, today } from "./shared";

/** A family that may already be the one being added: its household card (adults only, never a name alone) and why. */
export type FamilyMatch = { household: HouseholdCard; reasons: FamilyMatchReason[] };
export type FamilyMatches = { total: number; matches: FamilyMatch[] };

export type FamilyQuery = { first: string; last: string; phone: string | null; email: string | null };

/** The card as the sheet draws it. */
export function matchView(m: FamilyMatch): FamilyMatchView {
  const c = m.household;
  return { householdId: c.household_id, reasons: m.reasons, householdNumber: c.household_number, orgHouseholdId: c.org_household_id, adults: c.adults, city: c.city, zone: c.zone };
}

export function matchesView(found: FamilyMatches): FamilyMatchesView {
  return { total: found.total, matches: found.matches.map(matchView) };
}

/**
 * The families that may already be this one: the database looks (app.household_possible_matches checks people.manage in this
 * community itself) and answers with ids and reasons; the cards come from the same adult-only reader the other People commands use,
 * so a child never appears. A family the role cannot see is left out of the list but still counted in the total.
 */
export async function findFamilyMatches(db: AppSupabase, center: CommandContext["session"]["center"], q: FamilyQuery, now: string): Promise<FamilyMatches> {
  const answer = parseFamilyMatches(
    await rpcJson(db, "household_possible_matches", { p_center: center.id, p_first: q.first, p_last: q.last, p_phone: q.phone, p_email: q.email }, "check for families that may already be this one"),
  );
  if (answer.matches.length === 0) return { total: answer.total, matches: [] };
  const { cards } = await adultHouseholdCards(db, answer.matches.map((m) => m.householdId), { today: now, currency: center.currency, majority: communityMajority(center) });
  const byId = new Map(cards.map((c) => [c.household_id, c]));
  const matches = answer.matches.flatMap((m) => (byId.has(m.householdId) ? [{ household: byId.get(m.householdId)!, reasons: m.reasons }] : []));
  return { total: answer.total, matches };
}

export async function findFamilyMatchesFor(ctx: CommandContext, q: FamilyQuery): Promise<FamilyMatches> {
  return findFamilyMatches(ctx.session.db, ctx.session.center, q, today(ctx));
}

/** One line per family for a sentence Niva reads: adults, number, ID and city, and why. Never a name alone. */
export function matchLine(m: FamilyMatch, labels: Record<FamilyMatchReason, string>): string {
  return `${cardLine(m.household)} (${m.reasons.map((r) => labels[r].toLowerCase()).join(", ") || "possible match"})`;
}
