// Which payment ways (plugins) a community has switched on. Read from the same answer the Payments settings screen reads
// (app.payment_plugin_settings), so Niva's examples and the routines never name a way the community does not have.

import { failure } from "@/lib/errors";
import { isModuleEnabled } from "@/lib/modules";
import { can } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

import { parsePluginSettings } from "./view";

const WHY = "Could not read which payment ways are switched on (examples and routine steps will not name one)";

/**
 * The keys of the payment ways the community has switched on, or null when they are not known: the person may not see the payment
 * settings (or the community has no Giving), or they could not be read (that reason is logged).
 */
export async function enabledPaymentPlugins(
  session: Pick<CrmSession, "db" | "center" | "modulesOff" | "permissions" | "isPlatformAdmin" | "isOwner">,
): Promise<string[] | null> {
  // The database function answers only to people who may see the payment settings, and only where Giving is on: asking anyone else is a refusal, not news.
  if (!isModuleEnabled(session, "giving") || !can(session, ["giving.view", "integrations.view"])) return null;
  try {
    const res = await session.db.rpc("payment_plugin_settings", { p_center: session.center.id });
    if (res.error) {
      failure(WHY, res.error);
      return null;
    }
    const parsed = parsePluginSettings(res.data);
    if (!parsed.ok) {
      failure(WHY, new Error(parsed.error));
      return null;
    }
    return parsed.value.plugins.filter((p) => p.enabled).map((p) => p.key);
  } catch (error) {
    failure(WHY, error);
    return null;
  }
}
