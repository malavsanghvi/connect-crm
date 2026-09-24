import { redirect } from "next/navigation";

import { hrefWith, type RawSearchParams } from "@/lib/search-params";

/** The audit log moved to Settings › Audit log; old links (and their filters) keep working. */
export default async function AuditRedirect({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  redirect(hrefWith("/settings/audit", await searchParams, {}));
}
