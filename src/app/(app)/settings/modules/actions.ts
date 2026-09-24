"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { isModuleKey, moduleDef } from "@/lib/modules";
import { isMissingObject, modulesDb, warnMissingOnce } from "@/lib/modules-db";
import { authorizeAction, dbWithReason } from "@/lib/session";

/**
 * Switch a module on or off for this center through app.set_module_enabled
 * (settings.manage; the database refuses core modules and broken
 * dependencies with a plain sentence, shown as is). The reason travels as
 * x-audit-reason too, so the audit rows of the switch carry it.
 */
export async function setModuleEnabledAction(key: string, enabled: boolean, reasonInput: string): Promise<ActionResult> {
  const verb = enabled ? "switch on" : "switch off";
  if (!isModuleKey(key)) return { ok: false, error: `Could not ${verb} the module — it is not one this app knows. Reload and try again.` };
  const label = moduleDef(key).label;
  const doing = `${verb} ${label}`;
  const auth = await authorizeAction("centerSettings", doing);
  if (!auth.ok) return auth;
  const reason = String(reasonInput ?? "").trim();
  if (!reason) return { ok: false, error: `Could not ${doing} — say why. The reason is kept in the audit log.` };
  if (reason.length > 500) return { ok: false, error: `Could not ${doing} — keep the reason under 500 characters.` };
  const db = modulesDb(await dbWithReason(auth.session, reason));
  const { error } = await db.rpc("set_module_enabled", {
    p_center: auth.session.center.id,
    p_module: key,
    p_enabled: enabled,
    p_reason: reason,
  });
  if (error) {
    if (isMissingObject(error)) {
      warnMissingOnce("app.set_module_enabled", error);
      console.error(`[settings/modules] ${doing}: app.set_module_enabled is missing:`, error);
      return {
        ok: false,
        error: `Could not ${doing} — module switches are not in the database yet (the latest database update has not been applied). Every module stays on until then.`,
      };
    }
    return failure(`Could not ${doing}`, error);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: `${label} switched ${enabled ? "on" : "off"} · audit logged` };
}
