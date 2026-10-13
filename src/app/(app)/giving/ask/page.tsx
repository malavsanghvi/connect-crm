import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { GivingPage } from "@/components/giving-workspace/giving-page";
import { NoAccess } from "@/components/ui";
import { loadGivingWorkspace } from "@/lib/data/giving-workspace";
import { LOOK_COOKIE, parseLook } from "@/lib/look";
import { canAccess, visibleNav } from "@/lib/permissions";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Giving · Ask" };

/**
 * The conversation that prepares a payment (docs/handoff/prototypes/admin-v2/Giving.dc.html), in the New look only. It was the
 * Giving page until Today (the work queue) took /giving; it stays here, unchanged, until the Record payment sheet and the Giving
 * lane of the box replace it (docs/GIVING_REDESIGN.md slice 2). The classic look never had it: it goes where its sidebar would.
 */
export default async function GivingAskRoute() {
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
