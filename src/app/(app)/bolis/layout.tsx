import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { GivingTabsProvider } from "@/components/giving-today/giving-tabs";
import { ModuleGate } from "@/components/module-gate";
import { givingTabs } from "@/lib/giving-today/tabs";
import { LOOK_COOKIE, parseLook } from "@/lib/look";
import { loadSession } from "@/lib/session";

/**
 * bolis module: a direct URL shows "switched off" when the center has turned it off. In the New look Bolis is a view of
 * Giving › Campaigns & opportunities (slice 6), so its pages draw Giving's one tab row instead of the module pills.
 */
export default async function BolisLayout({ children }: { children: ReactNode }) {
  const gated = <ModuleGate module="bolis">{children}</ModuleGate>;
  const look = parseLook((await cookies()).get(LOOK_COOKIE)?.value);
  if (look !== "v2") return gated;
  const state = await loadSession();
  if (state.status !== "ok") return gated;
  return <GivingTabsProvider tabs={givingTabs(state.session)}>{gated}</GivingTabsProvider>;
}
