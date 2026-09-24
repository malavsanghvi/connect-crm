"use server";

import { revalidatePath } from "next/cache";

import type { Json } from "@/lib/database.types";
import { failure, type ActionResult } from "@/lib/errors";
import { CLOSE_ITEMS, closeChecklist, isCloseItem, longMonth } from "@/lib/giving";
import { authorizeAction } from "@/lib/session";
import type { AppSupabase } from "@/lib/supabase/server";

const MONTH = /^\d{4}-\d{2}-01$/;

function refresh() {
  revalidatePath("/accounting/close");
  revalidatePath("/");
}

async function exceptionsLeft(db: AppSupabase, centerId: string, month: string) {
  return db.from("ledger_postings").select("id", { count: "exact", head: true }).eq("center_id", centerId).eq("status", "failed").lte("period_month", month);
}

/** Tick (or untick) a manual close-checklist item (accounting_periods.checklist; audited). */
export async function setCloseItemAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("closeManage", "update the close checklist");
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const month = String(formData.get("month") ?? "");
  const key = String(formData.get("key") ?? "");
  const done = formData.get("done") === "true";
  if (!MONTH.test(month) || !isCloseItem(key)) return { ok: false, error: "Could not update the checklist — unknown item." };
  const cur = await db.from("accounting_periods").select("status, checklist").eq("center_id", center.id).eq("period_month", month).maybeSingle();
  if (cur.error) return failure("Could not update the checklist", cur.error);
  if (cur.data?.status === "closed") return { ok: false, error: `Could not update the checklist — ${longMonth(month)} is already locked.` };
  const base = cur.data && typeof cur.data.checklist === "object" && cur.data.checklist && !Array.isArray(cur.data.checklist) ? cur.data.checklist : {};
  const checklist = { ...(base as Record<string, Json>), [key]: done };
  const { error } = await db
    .from("accounting_periods")
    .upsert({ center_id: center.id, period_month: month, status: "closing", checklist }, { onConflict: "center_id,period_month" });
  if (error) return failure("Could not update the checklist", error);
  refresh();
  const label = CLOSE_ITEMS.find((i) => i.key === key)?.label ?? "Item";
  return { ok: true, message: `${label} · ${done ? "done" : "not done"} · audit logged` };
}

/**
 * Lock the month. The checklist must be complete (checked again here). The
 * prototype asks for a step-up code; step-up codes are not implemented on the
 * server, so none is collected — the lock is recorded under the user's name
 * in the audit log.
 */
export async function lockMonthAction(month: string): Promise<ActionResult> {
  const auth = await authorizeAction("closeManage", "lock the month");
  if (!auth.ok) return auth;
  const { db, center, userId } = auth.session;
  if (!MONTH.test(month)) return { ok: false, error: "Could not lock the month — unknown month." };
  const [cur, ex] = await Promise.all([
    db.from("accounting_periods").select("status, checklist").eq("center_id", center.id).eq("period_month", month).maybeSingle(),
    exceptionsLeft(db, center.id, month),
  ]);
  if (cur.error) return failure("Could not lock the month", cur.error);
  if (ex.error) return failure("Could not lock the month", ex.error);
  if (cur.data?.status === "closed") return { ok: false, error: `${longMonth(month)} is already locked.` };
  const items = closeChecklist(cur.data?.checklist ?? {}, ex.count ?? 0);
  const open = items.filter((i) => !i.done);
  if (open.length > 0) return { ok: false, error: `Finish the checklist first — ${open.map((i) => i.label.toLowerCase()).join("; ")}.` };
  const { data, error } = await db
    .from("accounting_periods")
    .update({ status: "closed", closed_by: userId, closed_at: new Date().toISOString() })
    .eq("center_id", center.id)
    .eq("period_month", month)
    .neq("status", "closed")
    .select("period_month");
  if (error) return failure("Could not lock the month", error);
  if (!data || data.length === 0) return { ok: false, error: "Could not lock the month — no change was saved (you may lack permission)." };
  refresh();
  return { ok: true, message: `${longMonth(month)} locked · later corrections post as adjustments` };
}
