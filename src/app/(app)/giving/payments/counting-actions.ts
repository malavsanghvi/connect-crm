"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { parseBagNumbers } from "@/lib/giving";
import { parseAmountToCents } from "@/lib/money";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Bhandar counting session (0003 counting_sessions). The database requires at
 * least two counters from different households (0016 trigger); its message is
 * shown as is when the rule is broken.
 */
export async function createCountingSessionAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("countingRecord", "save the counting session");
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const countedOn = String(formData.get("counted_on") ?? "").trim();
  const counters = [...new Set(formData.getAll("counter").map(String).filter(isUuid))];
  const totalText = String(formData.get("total") ?? "").trim();
  const bags = parseBagNumbers(String(formData.get("bags") ?? ""));
  const depositRef = String(formData.get("deposit_ref") ?? "").trim().slice(0, 80);
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 1000);

  if (!DATE.test(countedOn)) return { ok: false, error: "Could not save the counting session — choose the counting date." };
  if (counters.length < 2) return { ok: false, error: "Could not save the counting session — choose two counters from different households." };
  const total = totalText ? parseAmountToCents(totalText) : 0;
  if (total === null || total < 0) return { ok: false, error: "Could not save the counting session — the total must be an amount like 3412.00." };

  const { error } = await db.from("counting_sessions").insert({
    center_id: center.id,
    kind: "bhandar",
    counted_on: countedOn,
    counters,
    total_cents: total,
    bag_numbers: bags,
    deposit_ref: depositRef || null,
    notes: notes || null,
  });
  if (error) return failure("Could not save the counting session", error);
  revalidatePath("/giving/payments");
  return { ok: true, message: `Counting session saved${bags.length ? ` · bags ${bags.join(", ")}` : ""} · audit logged.` };
}

/** Record the total and the bank deposit reference once the bags are counted and deposited. */
export async function recordCountingDepositAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("countingRecord", "record the deposit");
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const id = String(formData.get("id") ?? "");
  const totalText = String(formData.get("total") ?? "").trim();
  const depositRef = String(formData.get("deposit_ref") ?? "").trim().slice(0, 80);
  if (!isUuid(id)) return { ok: false, error: "Could not record the deposit — the counting session was not found." };
  const total = totalText ? parseAmountToCents(totalText) : null;
  if (totalText && (total === null || total < 0)) return { ok: false, error: "Could not record the deposit — the total must be an amount like 3412.00." };
  if (!depositRef && total === null) return { ok: false, error: "Could not record the deposit — enter the counted total or the deposit reference." };
  const patch: { deposit_ref?: string; total_cents?: number } = {};
  if (depositRef) patch.deposit_ref = depositRef;
  if (total !== null) patch.total_cents = total;
  const { data, error } = await db.from("counting_sessions").update(patch).eq("id", id).eq("center_id", center.id).select("id");
  if (error) return failure("Could not record the deposit", error);
  if (!data || data.length === 0) return { ok: false, error: "Could not record the deposit — no change was saved (you may lack permission)." };
  revalidatePath("/giving/payments");
  return { ok: true, message: depositRef ? `Deposit ${depositRef} recorded · audit logged.` : "Total recorded · audit logged." };
}
