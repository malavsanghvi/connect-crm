"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

const MOVES: Record<string, { from: string[]; label: string }> = {
  in_progress: { from: ["open"], label: "start" },
  completed: { from: ["open", "in_progress"], label: "complete" },
  rejected: { from: ["open", "in_progress"], label: "reject" },
  open: { from: ["in_progress"], label: "reopen" },
};

export async function updateDataRequestAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const next = String(formData.get("status") ?? "");
  const move = MOVES[next];
  const auth = await authorizeAction("privacy", move ? `${move.label} the request` : "update the request");
  if (!auth.ok) return auth;
  const id = String(formData.get("id") ?? "");
  const exportPath = String(formData.get("export_path") ?? "").trim();
  if (!move || !isUuid(id)) return { ok: false, error: "Could not update the request — unknown change." };
  const update: { status: string; handled_by: string; completed_at?: string | null; export_path?: string } = {
    status: next,
    handled_by: auth.session.userId,
  };
  if (next === "completed" || next === "rejected") update.completed_at = new Date().toISOString();
  if (next === "open") update.completed_at = null;
  if (exportPath) update.export_path = exportPath.slice(0, 300);
  const { data, error } = await auth.session.db
    .from("data_requests")
    .update(update)
    .eq("id", id)
    .eq("center_id", auth.session.center.id)
    .in("status", move.from)
    .select("id");
  if (error) return failure(`Could not ${move.label} the request`, error);
  if (!data || data.length === 0) return { ok: false, error: `Could not ${move.label} the request — its status changed meanwhile. Reload and try again.` };
  revalidatePath("/settings/privacy");
  return { ok: true, message: `Request ${next.replace("_", " ")}.` };
}
