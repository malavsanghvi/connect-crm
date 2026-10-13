import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { GivingTabsProvider } from "@/components/giving-today/giving-tabs";
import { ModuleGate } from "@/components/module-gate";
import { givingTabs } from "@/lib/giving-today/tabs";
import { LOOK_COOKIE, parseLook } from "@/lib/look";
import { loadSession } from "@/lib/session";

/**
 * giving module: a direct URL shows "switched off" when the center has turned it off. In the New look every Giving page's
 * header draws Giving's one tab row (src/lib/giving-today/tabs.ts) instead of the module pills and the old tab strip.
 */
export default async function GivingLayout({ children }: { children: ReactNode }) {
  const gated = <ModuleGate module="giving">{children}</ModuleGate>;
  const look = parseLook((await cookies()).get(LOOK_COOKIE)?.value);
  if (look !== "v2") return gated;
  const state = await loadSession();
  if (state.status !== "ok") return gated;
  return <GivingTabsProvider tabs={givingTabs(state.session)}>{gated}</GivingTabsProvider>;
}
