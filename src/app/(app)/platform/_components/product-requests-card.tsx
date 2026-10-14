import Link from "next/link";

import { Card, EmptyState, QueryError } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import type { AppSupabase } from "@/lib/supabase/server";

/**
 * Every community's open Marketplace requests, oldest first (app.marketplace_open_requests, 0753: platform admins only). Each
 * links to the community's Products page, where Weaver reviews it and turns the product on (a reason and a fresh code).
 */
export async function ProductRequestsCard({ db, timeZone }: { db: AppSupabase; timeZone: string }) {
  const res = await db.rpc("marketplace_open_requests");
  if (res.error) {
    console.error("[platform] could not read the product requests:", res.error);
    return (
      <div className="mb-4">
        <QueryError what="the product requests" error={res.error} retryHref="/platform" />
      </div>
    );
  }
  const rows = res.data ?? [];
  return (
    <div className="mb-4">
      <Card
        title="Product requests"
        description={
          rows.length === 0
            ? "No community is waiting for a product."
            : `${rows.length} open ${rows.length === 1 ? "request" : "requests"} from the Marketplace, oldest first`
        }
      >
        {rows.length === 0 ? (
          <EmptyState title="No open requests." />
        ) : (
          <ul className="divide-y divide-line-soft">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5 text-[13px]" data-request={r.product_key}>
                <div className="min-w-[14rem] flex-1">
                  <p>
                    <strong className="text-ink">{r.product_name}</strong> <span className="text-muted">for</span>{" "}
                    <strong className="text-ink">{r.center_name}</strong>
                  </p>
                  <p className="text-[12px] text-muted">
                    Requested{r.requested_by_name ? ` by ${r.requested_by_name}` : ""} on {formatDate(r.requested_at, timeZone)}
                  </p>
                  <p className="text-[12px] italic text-ink-2">“{r.note}”</p>
                </div>
                <Link href={`/platform/centers/${r.center_id}/products`} className="crm-link text-[13px] font-semibold">
                  Review
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
