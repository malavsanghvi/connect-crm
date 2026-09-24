import type { Metadata } from "next";
import Link from "next/link";

import { Badge, Card, EmptyState, NoAccess, PageHeader, Pagination, QueryError, TableWrap, Tabs } from "@/components/ui";
import { campaignsForCenter, householdsById } from "@/lib/data/lookups";
import { formatDate } from "@/lib/dates";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { canAccess } from "@/lib/permissions";
import { hrefWith, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Recurring gifts" };

const PAGE_SIZE = 50;
const STATUSES = ["active", "paused", "failed", "cancelled", "all"] as const;
const TONE = { active: "success", paused: "warning", failed: "danger", cancelled: "neutral" } as const;
const PER_YEAR: Record<string, number> = { weekly: 52, monthly: 12, quarterly: 4, yearly: 1, special_day: 1 };

export default async function RecurringPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = (
    <PageHeader
      title="Recurring gifts"
      description="Scheduled gifts families set up in the app. Charges run through the payment provider; a recurring gift never closes pledges unless the family linked it."
    />
  );
  if (!canAccess(session, "recurring")) {
    return (
      <>
        {header}
        <NoAccess area="Recurring gifts" access="recurring" />
      </>
    );
  }
  const sp = await searchParams;
  const statusParam = param(sp, "status");
  const status = STATUSES.find((s) => s === statusParam) ?? "active";
  const page = pageParam(sp);
  const { db, center } = session;
  const tz = center.time_zone;

  let q = db
    .from("recurring_gifts")
    .select("id, household_id, campaign_id, amount_cents, frequency, method, next_charge_on, status, links_to_pledges, created_at", { count: "exact" })
    .eq("center_id", center.id);
  if (status !== "all") q = q.eq("status", status);
  const from = (page - 1) * PAGE_SIZE;
  const res = await q.order("next_charge_on", { ascending: true, nullsFirst: false }).range(from, from + PAGE_SIZE - 1);
  const rows = res.data ?? [];
  const [households, campaigns] = await Promise.all([householdsById(db, rows.map((r) => r.household_id)), campaignsForCenter(db, center.id)]);
  const campaignName = new Map(campaigns.data.map((c) => [c.id, c.name]));
  const annualized = rows.filter((r) => r.status === "active").reduce((s, r) => s + r.amount_cents * (PER_YEAR[r.frequency] ?? 0), 0);

  return (
    <>
      {header}
      <Tabs
        active={status}
        tabs={STATUSES.map((s) => ({ key: s, label: s[0].toUpperCase() + s.slice(1), href: hrefWith("/giving/recurring", {}, { status: s }) }))}
      />
      {res.error ? (
        <QueryError what="recurring gifts" error={res.error} retryHref={hrefWith("/giving/recurring", sp, {})} />
      ) : (
        <Card
          padded={false}
          description={status === "active" && rows.length > 0 ? `About ${formatCents(annualized, center.currency)} a year from the active gifts on this page.` : undefined}
          title={status === "active" ? "Active" : undefined}
        >
          {rows.length === 0 ? (
            <EmptyState title="No recurring gifts here" />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Household</th>
                    <th className="num">Amount</th>
                    <th>Frequency</th>
                    <th>Method</th>
                    <th>For</th>
                    <th>Next charge</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const h = households.map.get(r.household_id);
                    return (
                      <tr key={r.id}>
                        <td>
                          <Link href={`/households/${r.household_id}`} className="crm-link">
                            {h?.display_name ?? "Household"}
                          </Link>
                          <div className="font-mono text-xs text-muted">{h?.household_number ?? ""}</div>
                        </td>
                        <td className="num">{formatCents(r.amount_cents, center.currency)}</td>
                        <td className="capitalize">{r.frequency.replace(/_/g, " ")}</td>
                        <td>{PAYMENT_METHOD_LABEL[r.method] ?? r.method}</td>
                        <td>
                          {r.campaign_id ? (campaignName.get(r.campaign_id) ?? "Campaign") : "General"}
                          {r.links_to_pledges ? <div className="text-xs text-muted">Linked to pledges</div> : null}
                        </td>
                        <td>{formatDate(r.next_charge_on, tz)}</td>
                        <td>
                          <Badge tone={TONE[r.status as keyof typeof TONE] ?? "neutral"}>{r.status}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
          <Pagination page={page} pageSize={PAGE_SIZE} total={res.count ?? null} hrefFor={(n) => hrefWith("/giving/recurring", sp, { page: n })} />
        </Card>
      )}
    </>
  );
}
