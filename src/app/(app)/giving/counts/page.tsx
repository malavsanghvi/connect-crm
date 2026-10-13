import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { CountsView } from "@/components/giving-counts/counts-view";
import { loadCountsTab } from "@/lib/data/giving-counts";
import { LOOK_COOKIE, parseLook } from "@/lib/look";
import type { RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Counts" };

/**
 * Giving › the counts, their own tab in the New look (docs/GIVING_REDESIGN.md slice 5, B93). The classic look keeps its counting
 * section on Payments, untouched, so this address sends it there.
 */
export default async function CountsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  if (parseLook((await cookies()).get(LOOK_COOKIE)?.value) !== "v2") redirect("/giving/payments#counting");
  const session = await getSession();
  return <CountsView model={await loadCountsTab(session, await searchParams)} />;
}
