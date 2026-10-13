import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { GivingTabsProvider } from "@/components/giving-today/giving-tabs";
import { givingTabs } from "@/lib/giving-today/tabs";
import { LOOK_COOKIE, parseLook } from "@/lib/look";
import { loadSession } from "@/lib/session";

/**
 * For the pages that sit inside Giving without living under /giving (Books = /accounting, Bolis = /bolis): in the New look their
 * header draws Giving's one tab row (src/lib/giving-today/tabs.ts) instead of the Giving · Bolis · Accounting pills. The classic
 * look is left exactly as it is.
 */
export async function GivingTabsScope({ children }: { children: ReactNode }) {
  const look = parseLook((await cookies()).get(LOOK_COOKIE)?.value);
  if (look !== "v2") return <>{children}</>;
  const state = await loadSession();
  if (state.status !== "ok") return <>{children}</>;
  return <GivingTabsProvider tabs={givingTabs(state.session)}>{children}</GivingTabsProvider>;
}
