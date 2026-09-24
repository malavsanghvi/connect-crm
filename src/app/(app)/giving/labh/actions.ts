"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { parseAmountToCents } from "@/lib/money";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

function refresh() {
  revalidatePath("/giving/labh");
}

/** Mark a special-day labh as scheduled (0060 labh_fulfillments; audited). */
export async function markLabhScheduledAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("labhManage", "mark the labh scheduled");
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const pledgeId = String(formData.get("pledge_id") ?? "");
  const status = String(formData.get("status") ?? "scheduled");
  if (!isUuid(pledgeId) || !["scheduled", "done", "to_schedule"].includes(status)) {
    return { ok: false, error: "Could not update the labh — it was not found." };
  }
  const { data, error } = await db
    .from("labh_fulfillments")
    .upsert({ pledge_id: pledgeId, center_id: center.id, status }, { onConflict: "pledge_id" })
    .select("pledge_id");
  if (error) return failure("Could not update the labh", error);
  if (!data || data.length === 0) return { ok: false, error: "Could not update the labh — no change was saved (you may lack permission)." };
  refresh();
  const word = status === "scheduled" ? "Scheduled" : status === "done" ? "Marked done" : "Back to schedule";
  return { ok: true, message: `${word} · audit logged. Tell the ${status === "scheduled" ? "pujari or Pathshala teacher" : "team"} if they are not on the schedule yet.` };
}

/** Edit a labh on the menu: who fulfils it and whether members are offered it. */
export async function saveLabhOptionAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("labhManage", "save the labh");
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const id = String(formData.get("id") ?? "");
  const fulfilledBy = String(formData.get("fulfilled_by") ?? "").trim().slice(0, 120);
  const active = formData.get("active") === "on";
  const amountText = String(formData.get("amount") ?? "").trim();
  const cents = amountText ? parseAmountToCents(amountText) : null;
  if (!isUuid(id)) return { ok: false, error: "Could not save the labh — it was not found." };
  if (amountText && (cents === null || cents <= 0)) return { ok: false, error: "Could not save the labh — the amount must be like 51.00." };
  const patch: { fulfilled_by: string | null; active: boolean; amount_cents?: number } = { fulfilled_by: fulfilledBy || null, active };
  if (cents !== null) patch.amount_cents = cents;
  const { data, error } = await db.from("labh_options").update(patch).eq("id", id).eq("center_id", center.id).select("name");
  if (error) return failure("Could not save the labh", error);
  if (!data || data.length === 0) return { ok: false, error: "Could not save the labh — no change was saved (you may lack permission)." };
  refresh();
  return { ok: true, message: `Saved "${data[0].name}".` };
}

export async function addLabhOptionAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("labhManage", "add the labh");
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const cents = parseAmountToCents(String(formData.get("amount") ?? ""));
  const fulfilledBy = String(formData.get("fulfilled_by") ?? "").trim().slice(0, 120);
  if (!name) return { ok: false, error: "Could not add the labh — give it a name." };
  if (cents === null || cents <= 0) return { ok: false, error: "Could not add the labh — enter an amount like 51.00." };
  const last = await db.from("labh_options").select("sort_order").eq("center_id", center.id).order("sort_order", { ascending: false }).limit(1);
  if (last.error) return failure("Could not add the labh", last.error);
  const { error } = await db.from("labh_options").insert({
    center_id: center.id,
    name,
    amount_cents: cents,
    fulfilled_by: fulfilledBy || null,
    sort_order: (last.data?.[0]?.sort_order ?? 0) + 1,
  });
  if (error) return failure("Could not add the labh", error);
  refresh();
  return { ok: true, message: `Added "${name}" to the labh menu.` };
}
