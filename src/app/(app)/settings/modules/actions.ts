"use server";

import { runScreenCommand } from "@/lib/commands/screen";
import type { ActionResult } from "@/lib/errors";
import { isModuleKey, moduleDef } from "@/lib/modules";

/**
 * Switch a module on or off for this center. The work is the `settings.set_module` command
 * (src/lib/commands/catalog/settings/set-module.ts): app.set_module_enabled (settings.manage; the database refuses core modules and
 * broken dependencies with a plain sentence, shown as is). The reason travels as x-audit-reason too, so the audit rows of the switch
 * carry it. The screen, the ⌘K palette and Niva (once the owner has ticked it) run the same code.
 */
export async function setModuleEnabledAction(key: string, enabled: boolean, reasonInput: string): Promise<ActionResult> {
  const verb = enabled ? "switch on" : "switch off";
  if (!isModuleKey(key)) return { ok: false, error: `Could not ${verb} the module — it is not one this app knows. Reload and try again.` };
  return runScreenCommand("settings.set_module", { module: key, enabled, reason: String(reasonInput ?? "") }, `${verb} ${moduleDef(key).label}`);
}
