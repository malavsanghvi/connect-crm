"use server";

import type { HouseholdCardData } from "@/components/household-card";
import { householdCards } from "@/lib/data/lookups";
import { searchHouseholds } from "@/lib/data/search";
import { failure, type ActionResult } from "@/lib/errors";
import type { ResolvedIdentifier } from "@/lib/identifiers";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

export type HouseholdFinderResult = { cards: HouseholdCardData[]; hits: ResolvedIdentifier[]; more: boolean };

const MAX_CARDS = 12;

/**
 * Household picker search: names, member names and ANY identifier. Every hit
 * comes back as a household_card so the user never picks by name alone.
 */
export async function findHouseholdsAction(query: string): Promise<ActionResult<HouseholdFinderResult>> {
  const auth = await authorizeAction("recordPayment", "search households");
  if (!auth.ok) return auth;
  const q = String(query ?? "").trim();
  if (q.length < 2) return { ok: false, error: "Type at least 2 characters — a name, a member or household ID, or a Zelle name." };
  if (q.length > 120) return { ok: false, error: "That search is too long." };
  const { db, center } = auth.session;
  const found = await searchHouseholds(db, center.id, q, { limit: 60 });
  if (found.error && found.householdIds.length === 0) return failure("Could not search households", found.error);
  const ids = found.householdIds.slice(0, MAX_CARDS);
  const cards = await householdCards(db, ids);
  if (cards.error && cards.map.size === 0) return failure("Could not load the household details", cards.error);
  return {
    ok: true,
    data: {
      cards: ids.map((id) => cards.map.get(id)).filter((c): c is HouseholdCardData => !!c),
      hits: found.identifierMatches,
      more: found.householdIds.length > MAX_CARDS,
    },
  };
}

export type OpenPledge = {
  id: string;
  pledge_number: string | null;
  campaign: string | null;
  source: string;
  amount_cents: number;
  paid_cents: number;
  pledged_at: string;
  due_on: string | null;
  status: string;
};

/** Open and partly paid pledges of a household, oldest first (the allocation order). */
export async function openPledgesAction(householdId: string): Promise<ActionResult<OpenPledge[]>> {
  const auth = await authorizeAction("recordPayment", "load the household's open pledges");
  if (!auth.ok) return auth;
  if (!isUuid(householdId)) return { ok: false, error: "Could not load open pledges — choose a household first." };
  const { db, center } = auth.session;
  const [pRes, cRes] = await Promise.all([
    db
      .from("pledges")
      .select("id, pledge_number, campaign_id, source, amount_cents, paid_cents, pledged_at, due_on, status")
      .eq("center_id", center.id)
      .eq("household_id", householdId)
      .in("status", ["open", "partially_paid"])
      .order("pledged_at", { ascending: true })
      .limit(200),
    db.from("campaigns").select("id, name").eq("center_id", center.id),
  ]);
  if (pRes.error) return failure("Could not load the household's open pledges", pRes.error);
  const names = new Map((cRes.data ?? []).map((c) => [c.id, c.name]));
  return {
    ok: true,
    data: (pRes.data ?? []).map((p) => ({
      id: p.id,
      pledge_number: p.pledge_number,
      campaign: p.campaign_id ? (names.get(p.campaign_id) ?? null) : null,
      source: p.source,
      amount_cents: p.amount_cents,
      paid_cents: p.paid_cents,
      pledged_at: p.pledged_at,
      due_on: p.due_on,
      status: p.status,
    })),
  };
}
