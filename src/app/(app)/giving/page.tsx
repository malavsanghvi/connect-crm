import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { TodayPage } from "@/components/giving-today/today-page";
import { NoAccess } from "@/components/ui";
import { loadGivingToday } from "@/lib/data/giving-today";
import { canOpenToday } from "@/lib/giving-today/tabs";
import { LOOK_COOKIE, parseLook } from "@/lib/look";
import { visibleNav } from "@/lib/permissions";
import { param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Giving · Today" };

/**
 * Giving › Today in the New look (docs/GIVING_REDESIGN.md section 4, slice 1): the work queue, acting in its rows through the
 * existing server actions. Anyone who works with payments opens it, and so does a second approver who holds only giving.approve
 * (they see their approval rows; owner, 2026-10-12). The classic look never had a page here: it is sent to the first Giving page
 * the person can open, exactly where its sidebar would take them.
 */
export default async function GivingTodayRoute({ searchParams }: { searchParams?: Promise<RawSearchParams> }) {
  const session = await getSession();
  const jar = await cookies();
  if (parseLook(jar.get(LOOK_COOKIE)?.value) !== "v2") {
    const giving = visibleNav(session).find((m) => m.key === "giving");
    if (giving) redirect(giving.href);
    notFound();
  }
  if (!canOpenToday(session)) {
    return <NoAccess area="Giving" access="payments" />;
  }
  const sp = (await searchParams) ?? {};
  return <TodayPage model={await loadGivingToday(session, { show: param(sp, "show") ?? null })} />;
}
