"use server";

import { revalidatePath } from "next/cache";

import { checkGesture, toPayload, COSTS, EFFORTS, WHOS, type GestureInput } from "@/lib/care/gestures";
import { TOUCH_CHANNELS, TOUCH_KINDS } from "@/lib/care/model";
import { authorizeCare, careDbFailure, notUnderstood } from "@/lib/care/server";
import type { Json } from "@/lib/database.types";
import { isUuid } from "@/lib/search-params";

// The gesture library (DonorDelight slice 6, connect-crm 0894). Only someone who manages DonorDelight changes it (care.manage); the database is the
// real gate (app.care_can: no platform-admin branch). The SHAPE and the words are checked here with the same rules as the database (checkGesture:
// a gesture is never paired with an ask), then the database function runs AS THE SIGNED-IN PERSON. Every one answers { ok, error } in plain words and
// never says it worked when it did not. Not recorded in the activity stream (W2).

export type GestureSave = { ok: true; message: string } | { ok: false; error: string };

function refresh(): void {
  revalidatePath("/care/gestures");
  revalidatePath("/households/[id]", "page");
}

/** Copy the starter gestures for this kind of organization that the community does not have yet. */
export async function installGesturesAction(): Promise<GestureSave> {
  const doing = "add the starter gestures";
  const auth = await authorizeCare(doing, "manage");
  if (!auth.ok) return auth;
  const res = await auth.session.db.rpc("install_care_gestures", { p_center: auth.session.center.id });
  if (res.error) return careDbFailure(doing, res.error, "care gestures");
  refresh();
  const n = Number(res.data) || 0;
  return { ok: true, message: n === 0 ? "You already have every starter gesture." : `Added ${n} starter ${n === 1 ? "gesture" : "gestures"}.` };
}

const allIn = (list: readonly string[], v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string" && list.includes(x));

function looksLikeInput(g: unknown): g is GestureInput {
  if (!g || typeof g !== "object") return false;
  const x = g as Partial<GestureInput>;
  return (
    typeof x.name === "string" &&
    typeof x.description === "string" &&
    typeof x.draft === "string" &&
    (COSTS as readonly string[]).includes(x.cost as string) &&
    (EFFORTS as readonly string[]).includes(x.effort as string) &&
    (WHOS as readonly string[]).includes(x.who as string) &&
    (TOUCH_KINDS as readonly string[]).includes(x.kind as string) &&
    (x.channel === null || (TOUCH_CHANNELS as readonly string[]).includes(x.channel as string)) &&
    allIn(["in_person", "call", "card", "message"], x.suitsThanks) &&
    allIn(["public", "private_only", "anonymous"], x.suitsRecognition) &&
    allIn(["special_day", "anniversary", "expertise", "interests"], x.needs) &&
    typeof x.suggest === "boolean" &&
    typeof x.enabled === "boolean"
  );
}

/** Create or change one gesture. */
export async function saveGestureAction(input: GestureInput): Promise<GestureSave> {
  const doing = "save the gesture";
  if (!looksLikeInput(input) || (input.id !== undefined && input.id !== null && !isUuid(input.id))) return notUnderstood(doing);
  const checked = checkGesture(input);
  if (!checked.ok) return { ok: false, error: `Could not ${doing} — ${checked.error} Nothing was changed.` };
  const auth = await authorizeCare(doing, "manage");
  if (!auth.ok) return auth;
  const res = await auth.session.db.rpc("save_care_gesture", { p_center: auth.session.center.id, p_gesture: toPayload(input) as Json });
  if (res.error) return careDbFailure(doing, res.error, "care gestures");
  refresh();
  return { ok: true, message: "Saved." };
}

/** Pause or resume one gesture. Nothing is deleted. */
export async function setGestureEnabledAction(call: { id: string; enabled: boolean }): Promise<GestureSave> {
  const doing = call?.enabled ? "resume the gesture" : "pause the gesture";
  if (!call || !isUuid(call.id) || typeof call.enabled !== "boolean") return notUnderstood(doing);
  const auth = await authorizeCare(doing, "manage");
  if (!auth.ok) return auth;
  const res = await auth.session.db.rpc("set_care_gesture_enabled", { p_gesture: call.id, p_enabled: call.enabled });
  if (res.error) return careDbFailure(doing, res.error, "care gestures");
  refresh();
  return { ok: true, message: call.enabled ? "Resumed." : "Paused." };
}
