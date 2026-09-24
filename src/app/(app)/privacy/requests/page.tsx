import { redirect } from "next/navigation";

import { hrefWith, type RawSearchParams } from "@/lib/search-params";

/** Privacy requests moved to Settings › Privacy; old links (and their filters) keep working. */
export default async function PrivacyRequestsRedirect({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  redirect(hrefWith("/settings/privacy", await searchParams, {}));
}
