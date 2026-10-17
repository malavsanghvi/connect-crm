"use server";

import { revalidatePath } from "next/cache";

import { NO_ACCESS, isNoAccess, offSentence } from "@/lib/care/model";
import { failure } from "@/lib/errors";
import { careCan } from "@/lib/permissions";
import { isUuid } from "@/lib/search-params";
import { authorizeActionWhere, type CrmSession } from "@/lib/session";

// The thank-you tracker's writes (DonorDelight slice 3, connect-crm 0881-0883). Thin Server Actions: each checks the SHAPE of what came
// from the browser, then calls the database function AS THE SIGNED-IN PERSON, so app.care_household_can / app.care_settings_can (no
// platform-admin branch) is the real gate; the check here is a convenience. Every one answers { ok, error } in plain words next to what
// the person did, logs the technical detail on the server (failure()), and never says it worked when it did not. Recording a thank-you
// itself is the Care card's logCareTouchAction (kind thank_you): closing a step is read from that touch, never stored.
//
// Deliberately not recorded in the activity stream (withActivity): DonorDelight's actions stay inside the organization (W2).

export type ThanksSave = { ok: true; message: string } | { ok: false; error: string };

type Authorized = { ok: true; session: CrmSession };
type Refused = { ok: false; error: string };

async function authorize(doing: string, own: boolean): Promise<Authorized | Refused> {
  // The settings are also for Weaver support while the owner's support grant names the care.settings area: the database decides.
  const auth = await authorizeActionWhere((s) => (own ? careCan(s, "own") : true), doing, "care.own, care.view or care.manage");
  if (!auth.ok) return /don't have permission/.test(auth.error) ? { ok: false, error: `${NO_ACCESS}. Nothing was changed.` } : auth;
  return auth;
}

function dbFailure(doing: string, error: unknown): Refused {
  const off = offSentence(error);
  if (off) {
    console.error(`[care thanks] could not ${doing}:`, error);
    return { ok: false, error: `Could not ${doing} — ${off} Nothing was changed.` };
  }
  if (isNoAccess(error)) {
    const msg = (error as { message?: string | null }).message ?? "";
    const precise = msg && !/You don't have access to this area/i.test(msg) ? msg : `${NO_ACCESS}.`;
    console.error(`[care thanks] could not ${doing}:`, error);
    return { ok: false, error: `Could not ${doing} — ${precise.replace(/\.?$/, ".")} Nothing was changed.` };
  }
  return failure(`Could not ${doing}`, error);
}

function refresh(): void {
  revalidatePath("/care/thanks");
  revalidatePath("/care");
  revalidatePath("/households/[id]", "page");
}

/** "No thanks needed", with the reason (kept). */
export async function setAsideThankAction(call: { thankId: string; reason: string }): Promise<ThanksSave> {
  const doing = "set this thank-you aside";
  if (!call || !isUuid(call.thankId) || typeof call.reason !== "string") {
    return { ok: false, error: `Could not ${doing} — the request was not understood. Nothing was changed.` };
  }
  const reason = call.reason.trim();
  if (!reason) return { ok: false, error: `Could not ${doing} — say why no thank-you is needed. It is kept. Nothing was changed.` };
  if (reason.length > 500) return { ok: false, error: `Could not ${doing} — the reason is at most 500 characters. Nothing was changed.` };
  const auth = await authorize(doing, true);
  if (!auth.ok) return auth;
  const res = await auth.session.db.rpc("set_aside_care_thank", { p_thank: call.thankId, p_reason: reason });
  if (res.error) return dbFailure(doing, res.error);
  refresh();
  return { ok: true, message: "Set aside." };
}

export async function reopenThankAction(call: { thankId: string }): Promise<ThanksSave> {
  const doing = "reopen this thank-you";
  if (!call || !isUuid(call.thankId)) return { ok: false, error: `Could not ${doing} — the request was not understood. Nothing was changed.` };
  const auth = await authorize(doing, true);
  if (!auth.ok) return auth;
  const res = await auth.session.db.rpc("reopen_care_thank", { p_thank: call.thankId });
  if (res.error) return dbFailure(doing, res.error);
  refresh();
  return { ok: true, message: "Reopened." };
}

export type SettingsCall = {
  thankWindowDays: number;
  firstGiftPersonal: boolean;
  /** Whole cents, or null: no amount needs a personal thank-you. */
  personalFromCents: number | null;
  countFees: boolean;
  /** The first save only: start thanking from 30 days ago instead of today. */
  includeLast30: boolean;
};

export async function saveThanksSettingsAction(call: SettingsCall): Promise<ThanksSave> {
  const doing = "save the thank-you rules";
  const bad = (): ThanksSave => ({ ok: false, error: `Could not ${doing} — the request was not understood. Nothing was changed.` });
  if (!call || !Number.isInteger(call.thankWindowDays) || typeof call.firstGiftPersonal !== "boolean" || typeof call.countFees !== "boolean" || typeof call.includeLast30 !== "boolean") return bad();
  if (call.personalFromCents !== null && !(Number.isInteger(call.personalFromCents) && call.personalFromCents > 0)) {
    return { ok: false, error: `Could not ${doing} — the amount from which a gift needs a personal thank-you must be more than zero. Nothing was changed.` };
  }
  if (call.thankWindowDays < 1 || call.thankWindowDays > 30) {
    return { ok: false, error: `Could not ${doing} — thank a gift within 1 to 30 days. Nothing was changed.` };
  }
  const auth = await authorize(doing, false);
  if (!auth.ok) return auth;
  const res = await auth.session.db.rpc("save_care_settings", {
    p_center: auth.session.center.id,
    p_settings: {
      thank_window_days: call.thankWindowDays,
      first_gift_personal: call.firstGiftPersonal,
      personal_from_cents: call.personalFromCents,
      count_fees: call.countFees,
    },
    p_last_30: call.includeLast30,
  });
  if (res.error) return dbFailure(doing, res.error);
  refresh();
  revalidatePath("/care/settings");
  return { ok: true, message: "Saved." };
}
