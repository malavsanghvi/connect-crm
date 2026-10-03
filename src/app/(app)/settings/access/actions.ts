"use server";

import { revalidatePath } from "next/cache";

import { accessFeatureDef, buildLevelsPayload, levelsProblem, parseChangesField, parseLevelsField } from "@/lib/access";
import { accessRpc } from "@/lib/access-db";
import { failure, type ActionResult } from "@/lib/errors";
import { isMissingObject, warnMissingOnce } from "@/lib/modules-db";
import { authorizeAction, dbWithReason } from "@/lib/session";

const NOT_IN_DATABASE = "access levels are not in the database yet (the latest database update has not been applied). Every area keeps the rules it had before.";

/** The reason every change needs, as Settings › Modules asks for it: said, and short enough for the audit log. */
function reasonFrom(formData: FormData, doing: string): { ok: true; reason: string } | { ok: false; error: string } {
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { ok: false, error: `Could not ${doing} — say why. The reason is kept in the audit log.` };
  if (reason.length > 500) return { ok: false, error: `Could not ${doing} — keep the reason under 500 characters.` };
  return { ok: true, reason };
}

/**
 * Settings › Access levels › "Who can use each area": the lowest level that may use each area, through
 * app.set_feature_access (settings.manage, a reason, a fresh 2FA check; the database refuses a level below the
 * area's floor and one nobody can reach, with a plain sentence shown as is). Each change is its own call, so if
 * one is refused the ones before it stay saved and the message says which.
 */
export async function saveFeatureAccessAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const doing = "save who can use each area";
  const auth = await authorizeAction("centerSettings", doing);
  if (!auth.ok) return auth;
  const changes = parseChangesField(formData.get("changes"));
  if (!changes.ok) return { ok: false, error: `Could not ${doing} — ${changes.error}` };
  if (changes.value.length === 0) return { ok: false, error: `Could not ${doing} — nothing was changed.` };
  const why = reasonFrom(formData, doing);
  if (!why.ok) return why;

  const db = accessRpc(await dbWithReason(auth.session, why.reason));
  const saved: string[] = [];
  for (const change of changes.value) {
    const label = accessFeatureDef(change.feature).label;
    const { error } = await db.rpc("set_feature_access", {
      p_center: auth.session.center.id,
      p_feature: change.feature,
      p_level_key: change.level,
      p_reason: why.reason,
    });
    if (error) {
      if (isMissingObject(error)) {
        warnMissingOnce("app.set_feature_access", error);
        console.error("[settings/access] app.set_feature_access is missing:", error);
        return { ok: false, error: `Could not ${doing} — ${NOT_IN_DATABASE}` };
      }
      const result = failure(`Could not change who can use ${label}`, error);
      if (saved.length > 0) {
        result.error = `${result.error} ${saved.join(", ")} ${saved.length === 1 ? "was" : "were"} saved before this; reload to see where things stand.`;
      }
      return result;
    }
    saved.push(label);
  }
  revalidatePath("/settings/access");
  return { ok: true, message: `Saved who can use ${saved.length === 1 ? saved[0] : `${saved.length} areas`} · audit logged` };
}

/**
 * Settings › Access levels › "Levels for …": the community's ladder, through app.save_access_levels: the two
 * base names and the membership levels in the order shown (numbered 20, 30, 40 …). The page checks the same
 * rules first (src/lib/access.ts); the database has the last word and refuses, for example, removing a level an
 * area still uses, naming the areas.
 */
export async function saveAccessLevelsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const doing = "save the access levels";
  const auth = await authorizeAction("centerSettings", doing);
  if (!auth.ok) return auth;
  const levels = parseLevelsField(formData.get("levels"));
  if (!levels.ok) return { ok: false, error: `Could not ${doing} — ${levels.error}` };
  const base = { public: String(formData.get("base_public") ?? "").trim(), community: String(formData.get("base_community") ?? "").trim() };
  const problem = levelsProblem(levels.value, base);
  if (problem) return { ok: false, error: `Could not ${doing} — ${problem}` };
  const why = reasonFrom(formData, doing);
  if (!why.ok) return why;

  const payload = buildLevelsPayload(levels.value);
  const db = accessRpc(await dbWithReason(auth.session, why.reason));
  const { error } = await db.rpc("save_access_levels", {
    p_center: auth.session.center.id,
    p_levels: payload,
    p_base_labels: base,
    p_reason: why.reason,
  });
  if (error) {
    if (isMissingObject(error)) {
      warnMissingOnce("app.save_access_levels", error);
      console.error("[settings/access] app.save_access_levels is missing:", error);
      return { ok: false, error: `Could not ${doing} — ${NOT_IN_DATABASE}` };
    }
    return failure(`Could not ${doing}`, error);
  }
  revalidatePath("/settings/access");
  const n = payload.length;
  return { ok: true, message: `Access levels saved · ${n === 0 ? "no membership levels" : `${n} membership level${n === 1 ? "" : "s"}`} · audit logged` };
}
