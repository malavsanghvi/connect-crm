import type { Metadata } from "next";
import Link from "next/link";
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
 * Giving page until Today (the work queue) took /giving. Slice 2 replaced it (docs/GIVING_REDESIGN.md): the box on Today reads the
 * same sentence and opens the Record payment sheet filled in. It stays here, unlinked and unchanged, for one release, then goes.
 * The classic look never had it: it goes where its sidebar would.
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
  return (
    <>
      <p role="status" className="mb-4 rounded-[12px] border border-line bg-ground px-4 py-2.5 text-[14px] text-ink-2">
        This page is retiring. Type what you received in the box on{" "}
        <Link href="/giving" className="font-bold text-navy underline">
          Giving&apos;s Today
        </Link>{" "}
        (or press Ctrl K anywhere): it opens the Record payment sheet filled in.
      </p>
      <GivingPage model={await loadGivingWorkspace(session)} />
    </>
  );
}
