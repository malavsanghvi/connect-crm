// "Giving at a glance": reading the rows. Server side, as the signed-in person: the same tables the Pledges and Payments tabs read,
// so row-level security decides what comes back (a finance volunteer gets only the payments they recorded). Nothing is written.

import { chunk, fetchAll } from "@/lib/data/fetch-all";
import { dateInTz } from "@/lib/dates";
import type { DbErrorLike } from "@/lib/errors";
import type { AppSupabase } from "@/lib/supabase/server";

import type { GlancePayment, GlancePledge, GlanceRecurring, GlanceRows } from "./summary";

/** Whose rows to read: every row of some households, or every row tied to one person (wherever the household). */
export type GlanceSource = { households: string[] } | { person: string };

export type GlanceLoad = { ok: true; rows: GlanceRows; truncated: boolean } | { ok: false; error: unknown };

const MAX_ROWS = 20_000;

export async function loadGlanceRows(db: AppSupabase, centerId: string, timeZone: string, source: GlanceSource): Promise<GlanceLoad> {
  try {
    const byHousehold = "households" in source;
    if (byHousehold && source.households.length === 0) return { ok: true, rows: { pledges: [], payments: [], recurring: [] }, truncated: false };

    const [pledgeRes, paymentRes, recurringRes, campaignRes, fundRes] = await Promise.all([
      fetchAll(
        (from, to) => {
          const q = db.from("pledges").select("id, household_id, pledged_by_person_id, campaign_id, fund_id, amount_cents, paid_cents, status, pledged_at, due_on");
          return (byHousehold ? q.in("household_id", source.households) : q.eq("pledged_by_person_id", source.person)).order("pledged_at", { ascending: false }).order("id").range(from, to);
        },
        { max: MAX_ROWS },
      ),
      fetchAll(
        (from, to) => {
          const q = db.from("payments").select("id, household_id, payer_person_id, amount_cents, refunded_cents, status, received_on, is_opening_balance");
          return (byHousehold ? q.in("household_id", source.households) : q.eq("payer_person_id", source.person)).order("received_on", { ascending: false }).order("id").range(from, to);
        },
        { max: MAX_ROWS },
      ),
      fetchAll(
        (from, to) => {
          const q = db.from("recurring_gifts").select("id, household_id, person_id, amount_cents, frequency, status").eq("status", "active");
          return (byHousehold ? q.in("household_id", source.households) : q.eq("person_id", source.person)).order("id").range(from, to);
        },
        { max: MAX_ROWS },
      ),
      db.from("campaigns").select("id, name").eq("center_id", centerId),
      db.from("funds").select("id, name").eq("center_id", centerId),
    ]);
    const failed: DbErrorLike | null = pledgeRes.error ?? paymentRes.error ?? recurringRes.error ?? campaignRes.error ?? fundRes.error;
    if (failed) throw failed;

    const campaigns = new Map((campaignRes.data ?? []).map((c) => [c.id, c.name]));
    const funds = new Map((fundRes.data ?? []).map((f) => [f.id, f.name]));
    // A pledge goes to a campaign, else to a fund, else to general giving.
    const causeOf = (p: { campaign_id: string | null; fund_id: string | null }): string | null =>
      (p.campaign_id ? campaigns.get(p.campaign_id) : undefined) ?? (p.fund_id ? funds.get(p.fund_id) : undefined) ?? null;

    const causeByPledge = new Map(pledgeRes.data.map((p) => [p.id, causeOf(p)]));
    const allocRows: { payment_id: string; pledge_id: string; amount_cents: number }[] = [];
    for (const ids of chunk(paymentRes.data.map((p) => p.id))) {
      const r = await fetchAll(
        (from, to) => db.from("payment_allocations").select("payment_id, pledge_id, amount_cents").in("payment_id", ids).order("payment_id").order("pledge_id").range(from, to),
        { max: MAX_ROWS },
      );
      if (r.error) throw r.error;
      allocRows.push(...r.data);
    }
    // A payment can go to a pledge that is not in this list (the person view reads only what a person gave): look those up by id.
    const missing = [...new Set(allocRows.map((a) => a.pledge_id).filter((id) => !causeByPledge.has(id)))];
    for (const ids of chunk(missing)) {
      const r = await db.from("pledges").select("id, campaign_id, fund_id").in("id", ids);
      if (r.error) throw r.error;
      for (const p of r.data ?? []) causeByPledge.set(p.id, causeOf(p));
    }
    const allocByPayment = new Map<string, { cause: string | null; cents: number }[]>();
    for (const a of allocRows) {
      const list = allocByPayment.get(a.payment_id) ?? [];
      list.push({ cause: causeByPledge.get(a.pledge_id) ?? null, cents: a.amount_cents });
      allocByPayment.set(a.payment_id, list);
    }

    const pledges: GlancePledge[] = pledgeRes.data.map((p) => ({
      id: p.id,
      household_id: p.household_id,
      person_id: p.pledged_by_person_id,
      amount_cents: p.amount_cents,
      paid_cents: p.paid_cents,
      status: p.status,
      pledged_on: dateInTz(p.pledged_at, timeZone),
      due_on: p.due_on,
    }));
    const payments: GlancePayment[] = paymentRes.data.map((p) => ({
      id: p.id,
      household_id: p.household_id,
      person_id: p.payer_person_id,
      amount_cents: p.amount_cents,
      refunded_cents: p.refunded_cents,
      status: p.status,
      received_on: p.received_on,
      is_opening_balance: p.is_opening_balance,
      allocations: allocByPayment.get(p.id) ?? [],
    }));
    const recurring: GlanceRecurring[] = recurringRes.data.map((r) => ({
      id: r.id,
      household_id: r.household_id,
      person_id: r.person_id,
      amount_cents: r.amount_cents,
      frequency: r.frequency,
      status: r.status,
    }));
    return { ok: true, rows: { pledges, payments, recurring }, truncated: pledgeRes.truncated || paymentRes.truncated || recurringRes.truncated };
  } catch (error) {
    console.error("[giving-glance] could not read the giving rows:", error);
    return { ok: false, error };
  }
}
