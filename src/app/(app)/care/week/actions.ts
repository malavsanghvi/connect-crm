"use server";

import { revalidatePath } from "next/cache";

import { TOUCH_CHANNELS } from "@/lib/care/model";
import { authorizeCare, careDbFailure, notUnderstood } from "@/lib/care/server";
import { isUuid } from "@/lib/search-params";

// "Your 5 this week" (DonorDelight slice 5, connect-crm 0892): one tap records the step's touch (never an ask) and marks the task done; setting
// aside needs a reason, which is kept. Thin Server Actions: the SHAPE is checked here, the database function runs AS THE SIGNED-IN PERSON, so
// app.care_household_can (no platform-admin branch) is the real gate. Every one answers { ok, error } in plain words and never says it worked
// when it did not. Deliberately not recorded in the activity stream: DonorDelight's actions stay inside the organization (W2).

export type WeekSave = { ok: true; message: string } | { ok: false; error: string };

function refresh(): void {
  revalidatePath("/care/week");
  revalidatePath("/care");
  revalidatePath("/giving");
  revalidatePath("/households/[id]", "page");
}

/** Done: records the touch (kind from the step; the way you used, or the step's own) and marks the task. */
export async function completeTaskAction(call: { runId: string; stepId: string; channel?: string | null; note?: string | null }): Promise<WeekSave> {
  const doing = "mark this task done";
  if (!call || !isUuid(call.runId) || !isUuid(call.stepId)) return notUnderstood(doing);
  const channel = call.channel ? String(call.channel) : null;
  if (channel !== null && !(TOUCH_CHANNELS as readonly string[]).includes(channel)) return notUnderstood(doing);
  const note = typeof call.note === "string" ? call.note.trim() : "";
  if (note.length > 1000) return { ok: false, error: `Could not ${doing} — a note is at most 1,000 characters. Nothing was changed.` };
  const auth = await authorizeCare(doing, "own");
  if (!auth.ok) return auth;
  const res = await auth.session.db.rpc("complete_care_task", { p_run: call.runId, p_step: call.stepId, p_channel: channel ?? undefined, p_note: note === "" ? undefined : note });
  if (res.error) return careDbFailure(doing, res.error, "care week");
  refresh();
  return { ok: true, message: "Done." };
}

/** Set aside, with the reason (kept). */
export async function skipTaskAction(call: { runId: string; stepId: string; reason: string }): Promise<WeekSave> {
  const doing = "set this task aside";
  if (!call || !isUuid(call.runId) || !isUuid(call.stepId) || typeof call.reason !== "string") return notUnderstood(doing);
  const reason = call.reason.trim();
  if (!reason) return { ok: false, error: `Could not ${doing} — say why. The reason is kept. Nothing was changed.` };
  if (reason.length > 500) return { ok: false, error: `Could not ${doing} — the reason is at most 500 characters. Nothing was changed.` };
  const auth = await authorizeCare(doing, "own");
  if (!auth.ok) return auth;
  const res = await auth.session.db.rpc("skip_care_task", { p_run: call.runId, p_step: call.stepId, p_reason: reason });
  if (res.error) return careDbFailure(doing, res.error, "care week");
  refresh();
  return { ok: true, message: "Set aside." };
}
