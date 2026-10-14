"use server";

import { adultHouseholdCards } from "@/lib/commands/catalog/household";
import { communityMajority } from "@/lib/commands/child-filter";
import { todayInTz } from "@/lib/dates";
import { failure, type ActionResult } from "@/lib/errors";
import { givingHousehold } from "@/lib/find/giving";
import { composeFamilyGiving, LAST_GIFTS, type FamilyFocus, type FamilyGiving, type GivingHousehold, type PaymentRowIn, type PledgeRowIn } from "@/lib/giving-actions/family-giving";
import { isUuid } from "@/lib/search-params";
import { authorizeAction, type CrmSession } from "@/lib/session";

// READ ONLY. What the Giving sheets read when they open: a family's household card (adults only, never a name alone) for the Record
// payment sheet, and a family's giving (what it owes, its open pledges, its last gifts) for the slide-over. Every row is read with the
// person's own access (row level security). Nothing here records, applies or changes anything.

async function cardOf(session: CrmSession, householdId: string): Promise<GivingHousehold | null> {
  const { db, center } = session;
  const res = await adultHouseholdCards(db, [householdId], { today: todayInTz(center.time_zone), currency: center.currency, majority: communityMajority(center) });
  const card = res.cards[0];
  return card ? givingHousehold(card) : null;
}

/** The household card the Record payment sheet shows at the top when it was opened with a household id (a Family page button). */
export async function sheetHouseholdAction(householdId: string): Promise<ActionResult<GivingHousehold>> {
  const auth = await authorizeAction("recordPayment", "open the family for a payment");
  if (!auth.ok) return auth;
  if (!isUuid(householdId)) return { ok: false, error: "Could not open the family — it was not found." };
  try {
    const card = await cardOf(auth.session, householdId);
    if (!card) return { ok: false, error: "Could not open the family — it was not found, or your role can't see it." };
    return { ok: true, data: card };
  } catch (error) {
    return failure("Could not open the family", error);
  }
}

const PLEDGE_COLUMNS = "id, pledge_number, campaign_id, amount_cents, paid_cents, pledged_at, due_on, status";
const PAYMENT_COLUMNS = "id, receipt_number, amount_cents, refunded_cents, method, status, received_on";

type PledgeDb = { id: string; pledge_number: string | null; campaign_id: string | null; amount_cents: number; paid_cents: number; pledged_at: string; due_on: string | null; status: string };

/** One family's giving for the slide-over in Giving. `focus` is the payment or pledge the box found: it is shown first. */
export async function familyGivingAction(householdId: string, focus: FamilyFocus | null = null): Promise<ActionResult<FamilyGiving>> {
  const auth = await authorizeAction("payments", "open the family's giving");
  if (!auth.ok) return auth;
  if (!isUuid(householdId)) return { ok: false, error: "Could not open the family's giving — the family was not found." };
  const wanted = focus && (focus.kind === "payment" || focus.kind === "pledge") && isUuid(focus.id) ? focus : null;
  const { db, center } = auth.session;
  try {
    const household = await cardOf(auth.session, householdId);
    if (!household) return { ok: false, error: "Could not open the family's giving — the family was not found, or your role can't see it." };
    const [pledges, payments, focusPledge, focusPayment] = await Promise.all([
      db.from("pledges").select(PLEDGE_COLUMNS).eq("center_id", center.id).eq("household_id", householdId).in("status", ["open", "partially_paid"]).order("pledged_at", { ascending: true }).limit(100),
      db.from("payments").select(PAYMENT_COLUMNS).eq("center_id", center.id).eq("household_id", householdId).order("received_on", { ascending: false }).limit(LAST_GIFTS),
      wanted?.kind === "pledge" ? db.from("pledges").select(PLEDGE_COLUMNS).eq("center_id", center.id).eq("household_id", householdId).eq("id", wanted.id).maybeSingle() : null,
      wanted?.kind === "payment" ? db.from("payments").select(PAYMENT_COLUMNS).eq("center_id", center.id).eq("household_id", householdId).eq("id", wanted.id).maybeSingle() : null,
    ]);
    const problems: string[] = [];
    if (pledges.error) {
      console.error("[giving] family giving: pledges failed:", pledges.error);
      problems.push("The open pledges could not be read just now.");
    }
    if (payments.error) {
      console.error("[giving] family giving: payments failed:", payments.error);
      problems.push("The last gifts could not be read just now.");
    }
    const pledgeRows = (pledges.data ?? []) as PledgeDb[];
    const extraPledge = focusPledge && !focusPledge.error ? (focusPledge.data as PledgeDb | null) : null;
    const campaignIds = [...new Set([...pledgeRows, ...(extraPledge ? [extraPledge] : [])].map((p) => p.campaign_id).filter((x): x is string => !!x))];
    const names = new Map<string, string>();
    if (campaignIds.length > 0) {
      const res = await db.from("campaigns").select("id, name").in("id", campaignIds);
      if (res.error) console.error("[giving] family giving: campaign names failed:", res.error);
      for (const c of res.data ?? []) names.set(c.id, c.name);
    }
    const asPledge = (p: PledgeDb): PledgeRowIn => ({ ...p, campaign: p.campaign_id ? (names.get(p.campaign_id) ?? null) : null });
    return {
      ok: true,
      data: composeFamilyGiving({
        household,
        pledges: pledgeRows.map(asPledge),
        payments: (payments.data ?? []) as PaymentRowIn[],
        focus: wanted,
        focusPledge: extraPledge ? asPledge(extraPledge) : null,
        focusPayment: focusPayment && !focusPayment.error ? (focusPayment.data as PaymentRowIn | null) : null,
        problems,
      }),
    };
  } catch (error) {
    return failure("Could not open the family's giving", error);
  }
}
