import { redirect } from "next/navigation";

import { hrefWith, type RawSearchParams } from "@/lib/search-params";

// Bank reconciliation moved under Giving › Payments & deposits (prototype tab model).
export default async function OldBankPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  redirect(hrefWith("/giving/payments/bank", await searchParams, {}));
}
