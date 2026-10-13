import type { Metadata } from "next";

import { Alert, NoAccess, PageHeader, QueryError } from "@/components/ui";
import { isMarketTab, parseProducts, type MarketTab } from "@/lib/marketplace";
import { canAccess } from "@/lib/permissions";
import { param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { MarketplaceClient } from "./marketplace-client";

export const metadata: Metadata = { title: "Marketplace · Settings" };

/**
 * Settings › Marketplace (the accepted prototype of 2026-10-13): every product the community's kind offers, with its state.
 * The community requests a product with a note (or cancels the request), pauses and resumes one that is on, and asks to be told
 * when one that is not built yet is ready. Only Weaver turns a product on or off (Platform › Communities › Products).
 */
export default async function MarketplacePage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = (
    <PageHeader
      title="Marketplace"
      eyebrow="Settings › Marketplace"
      description="Choose what your community uses. Weaver checks each request and turns the product on. Your admins can pause and resume it at any time."
    />
  );
  if (!canAccess(session, "centerSettings")) {
    return (
      <>
        {header}
        <NoAccess area="The Marketplace" access="centerSettings" />
      </>
    );
  }
  const sp = await searchParams;
  const tabParam = param(sp, "tab");
  const tab: MarketTab = isMarketTab(tabParam) ? tabParam : "all";
  const selected = param(sp, "product") ?? null;

  const res = await session.db.rpc("marketplace_states", { p_center: session.center.id });
  if (res.error) {
    return (
      <>
        {header}
        <QueryError what="the Marketplace" error={res.error} retryHref="/settings/marketplace" />
      </>
    );
  }
  const products = parseProducts(res.data as unknown[] | null);
  if (!products) {
    console.error("[settings/marketplace] marketplace_states returned an unexpected shape:", res.data);
    return (
      <>
        {header}
        <Alert tone="danger" title="Could not load the Marketplace">
          The database answered in a shape this screen does not understand (has the latest migration been applied?). Reload to try again.
        </Alert>
      </>
    );
  }
  return (
    <>
      {header}
      <MarketplaceClient
        products={products}
        initialTab={tab}
        initialSelected={selected}
        timeZone={session.center.time_zone}
      />
    </>
  );
}
