import { redirect } from "next/navigation";

import { hrefWith, type RawSearchParams } from "@/lib/search-params";

// Campaigns moved under Giving › Opportunities (prototype tab model).
export default async function OldCampaignsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  redirect(hrefWith("/giving/opportunities/campaigns", await searchParams, {}));
}
