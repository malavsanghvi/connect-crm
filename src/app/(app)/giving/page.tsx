import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { GivingPage } from "@/components/giving-workspace/giving-page";
import { NoAccess } from "@/components/ui";
import { loadGivingWorkspace } from "@/lib/data/giving-workspace";
import { LOOK_COOKIE, parseLook } from "@/lib/look";
import { canAccess, visibleNav } from "@/lib/permissions";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Giving" };

/**
 * The Giving workspace's own page, in the New look only (docs/handoff/prototypes/admin-v2/Giving.dc.html). The classic look never
 * had a page here: it is sent to the first Giving page the person can open, exactly where its sidebar would take them.
 */
export default async function GivingWorkspaceRoute() {
  const session = await getSession();
  const jar = await cookies();
  if (parseLook(jar.get(LOOK_COOKIE)?.value) !== "v2") {
    const giving = visibleNav(session).find((m) => m.key === "giving");
    if (giving) redirect(giving.href);
    notFound();
  }
  if (!canAccess(session, "payments")) {
    return <NoAccess area="Giving" access="payments" />;
  }
  return <GivingPage model={await loadGivingWorkspace(session)} />;
}
