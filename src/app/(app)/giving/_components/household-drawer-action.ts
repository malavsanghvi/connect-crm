"use server";

import type { HouseholdCardData } from "@/components/household-card";
import { householdCards } from "@/lib/data/lookups";
import { failure, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

export type HouseholdQuickView = {
  card: HouseholdCardData;
  pledges: { pledge_number: string | null; campaign: string | null; amount_cents: number; paid_cents: number; status: string; pledged_at: string }[];
  pledgesError: string | null;
};

/** The household drawer opened from a Giving table row: household_card + the household's recent pledges. */
export async function householdQuickViewAction(householdId: string): Promise<ActionResult<HouseholdQuickView>> {
  const auth = await authorizeAction("pledges", "open the household");
  if (!auth.ok) return auth;
  if (!isUuid(householdId)) return { ok: false, error: "Could not open the household — it was not found." };
  const { db, center } = auth.session;
  const cards = await householdCards(db, [householdId]);
  if (cards.error) return failure("Could not open the household", cards.error);
  const card = cards.map.get(householdId);
  if (!card) return { ok: false, error: "Could not open the household — it was not found, or your role can't see it." };
  const [p, c] = await Promise.all([
    db
      .from("pledges")
      .select("pledge_number, campaign_id, amount_cents, paid_cents, status, pledged_at")
      .eq("center_id", center.id)
      .eq("household_id", householdId)
      .order("pledged_at", { ascending: false })
      .limit(6),
    db.from("campaigns").select("id, name").eq("center_id", center.id),
  ]);
  if (p.error) console.error("[giving] household drawer pledges failed:", p.error);
  if (c.error) console.error("[giving] household drawer campaign names failed:", c.error);
  const names = new Map((c.data ?? []).map((x) => [x.id, x.name]));
  return {
    ok: true,
    data: {
      card,
      pledges: (p.data ?? []).map((x) => ({
        pledge_number: x.pledge_number,
        campaign: x.campaign_id ? (names.get(x.campaign_id) ?? null) : null,
        amount_cents: x.amount_cents,
        paid_cents: x.paid_cents,
        status: x.status,
        pledged_at: x.pledged_at,
      })),
      pledgesError: p.error ? "Could not load this household's pledges." : null,
    },
  };
}
