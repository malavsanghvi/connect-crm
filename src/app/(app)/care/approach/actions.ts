"use server";

import { revalidatePath } from "next/cache";

import { WEIGHT_KEYS, checkQuiet, checkSettings, type QuietInput, type SettingsInput, type WeightKey } from "@/lib/care/approach";
import { authorizeCare, careDbFailure, notUnderstood } from "@/lib/care/server";
import { isUuid } from "@/lib/search-params";

// Who to approach (DonorDelight slice 7, connect-crm 0895): turning the list on, the touch balance, the rest days, the weights, and the quiet periods.
// Only someone who manages DonorDelight changes them (care.manage); the database is the real gate (app.care_can: no platform-admin branch). The SHAPE and
// the numbers are checked here with the same rules and words as the database, then the database function runs AS THE SIGNED-IN PERSON. Every one answers
// { ok, error } in plain words and never says it worked when it did not. Not recorded in the activity stream (W2).

export type ApproachSave = { ok: true; message: string } | { ok: false; error: string };

function refresh(): void {
  revalidatePath("/care/approach");
  revalidatePath("/households/[id]", "page");
}

/** Turn the list on or off. It is off until a care manager has read what it uses and does not use. */
export async function setApproachEnabledAction(call: { enabled: boolean }): Promise<ApproachSave> {
  const doing = call?.enabled ? "turn on who to approach" : "turn off who to approach";
  if (!call || typeof call.enabled !== "boolean") return notUnderstood(doing);
  const auth = await authorizeCare(doing, "manage");
  if (!auth.ok) return auth;
  const res = await auth.session.db.rpc("save_care_approach_settings", { p_center: auth.session.center.id, p_settings: { enabled: call.enabled } });
  if (res.error) return careDbFailure(doing, res.error, "care approach");
  refresh();
  return { ok: true, message: call.enabled ? "Who to approach is on." : "Who to approach is off." };
}

/** The touch balance, the rest after an ask, and the weights of the score. */
export async function saveApproachSettingsAction(call: SettingsInput): Promise<ApproachSave> {
  const doing = "save the settings";
  if (!call || !Number.isInteger(call.touchBalance) || !Number.isInteger(call.restDays) || !call.weights || typeof call.weights !== "object") return notUnderstood(doing);
  const weights = call.weights as Record<string, unknown>;
  if (!WEIGHT_KEYS.every((k) => Number.isInteger(weights[k]))) return notUnderstood(doing);
  const checked = checkSettings(call);
  if (!checked.ok) return { ok: false, error: `Could not ${doing} — ${checked.error} Nothing was changed.` };
  const auth = await authorizeCare(doing, "manage");
  if (!auth.ok) return auth;
  const w: Record<WeightKey, number> = { ...call.weights };
  const res = await auth.session.db.rpc("save_care_approach_settings", {
    p_center: auth.session.center.id,
    p_settings: { touch_balance: call.touchBalance, rest_days: call.restDays, weights: w },
  });
  if (res.error) return careDbFailure(doing, res.error, "care approach");
  refresh();
  return { ok: true, message: "Saved." };
}

/** Add or change a quiet period, or archive one (it is kept, never deleted). */
export async function saveQuietPeriodAction(call: QuietInput & { archived?: boolean }): Promise<ApproachSave> {
  const doing = call?.archived ? "remove the quiet period" : "save the quiet period";
  if (!call || typeof call.name !== "string" || typeof call.startsOn !== "string" || typeof call.endsOn !== "string" || typeof call.yearly !== "boolean") return notUnderstood(doing);
  if (call.id !== undefined && call.id !== null && !isUuid(call.id)) return notUnderstood(doing);
  if (!call.archived) {
    const checked = checkQuiet(call);
    if (!checked.ok) return { ok: false, error: `Could not ${doing} — ${checked.error} Nothing was changed.` };
  }
  const auth = await authorizeCare(doing, "manage");
  if (!auth.ok) return auth;
  const res = await auth.session.db.rpc("save_care_quiet_period", {
    p_center: auth.session.center.id,
    p_period: { ...(call.id ? { id: call.id } : {}), name: call.name.trim(), starts_on: call.startsOn, ends_on: call.endsOn, yearly: call.yearly, archived: call.archived === true },
  });
  if (res.error) return careDbFailure(doing, res.error, "care approach");
  refresh();
  return { ok: true, message: call.archived ? "Removed." : "Saved." };
}
