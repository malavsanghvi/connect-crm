"use server";

import { revalidatePath } from "next/cache";

import { expectedVersion, writeCenterRules } from "@/lib/data/center-rules-write";
import { addDays, startOfDayInTz, todayInTz } from "@/lib/dates";
import { failure, type ActionResult } from "@/lib/errors";
import { describeShortcuts, parseHomeShortcuts } from "@/lib/home-shortcuts";
import { authorizeAction, dbWithReason } from "@/lib/session";
import { formatJoinCode } from "@/lib/tenancy";

/**
 * Replace this community's member-app join code (app.rotate_member_join_code,
 * settings.manage). The old code — and every QR poster printed with it —
 * stops working at once, so a reason is asked for and audited.
 */
export async function rotateJoinCodeAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("centerSettings", "make a new join code");
  if (!auth.ok) return auth;
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { ok: false, error: "Could not make a new join code — say why (for example \"poster reprinted\"). The reason is kept in the audit log." };
  if (reason.length > 500) return { ok: false, error: "Could not make a new join code — keep the reason under 500 characters." };
  const expiresRaw = String(formData.get("expires_on") ?? "").trim();
  let expires: string | null = null;
  if (expiresRaw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresRaw)) return { ok: false, error: "Could not make a new join code — the expiry date is not a date." };
    const tz = auth.session.center.time_zone;
    if (expiresRaw < todayInTz(tz)) return { ok: false, error: "Could not make a new join code — choose an expiry date from today on, or none." };
    // Works through the end of that day in the community's time zone.
    expires = startOfDayInTz(addDays(expiresRaw, 1), tz);
  }
  const db = await dbWithReason(auth.session, reason);
  const { data, error } = await db.rpc("rotate_member_join_code", { p_center: auth.session.center.id, p_expires_at: expires as never, p_reason: reason });
  if (error) return failure("Could not make a new join code", error);
  revalidatePath("/settings/member-app");
  return { ok: true, message: `New join code ${formatJoinCode(String(data))} · the old one no longer works` };
}

/**
 * Settings › Member app › Home shortcuts: the member app's Home strip, in order
 * (centers.rules.home.shortcuts — src/lib/home-shortcuts.ts). Only the shortcuts switched on are
 * stored; an empty list means no strip. Versioned like every rules save.
 */
export async function saveHomeShortcutsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const what = "Home shortcuts";
  const auth = await authorizeAction("centerSettings", `save the ${what}`);
  if (!auth.ok) return auth;
  const expected = expectedVersion(formData.get("version"));
  if (expected === "invalid") return { ok: false, error: `Could not save the ${what} — the page is out of date. Reload and try again.` };
  const parsed = parseHomeShortcuts(formData.getAll("shortcut").map((v) => String(v)));
  if (!parsed.ok) return { ok: false, error: `Could not save the ${what} — ${parsed.error}` };
  return writeCenterRules(auth.session, { mode: "patch", rules: { home: { shortcuts: parsed.shortcuts } } }, expected, what, (v) =>
    parsed.shortcuts.length
      ? `Home shortcuts saved · ${describeShortcuts(parsed.shortcuts)} · rules version ${v} · audit logged`
      : `Home shortcuts saved · none shown, so Home has no strip · rules version ${v} · audit logged`,
  );
}
