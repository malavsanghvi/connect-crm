import type { Metadata } from "next";

import { HouseholdDrawerProvider, HouseholdRow } from "@/app/(app)/giving/_components/household-drawer";
import { Alert, Card, ChipLinks, EmptyState, KpiGrid, NoAccess, PageHeader, Pagination, QueryError, Stat, StatusText, TableWrap, buttonClass } from "@/components/ui";
import { identifierRules } from "@/lib/center-rules";
import { fetchAll } from "@/lib/data/fetch-all";
import { campaignsForCenter, householdsById } from "@/lib/data/lookups";
import { todayInTz } from "@/lib/dates";
import { firstOfMonth, frequencyText, monthDay, recurringKpis, recurringStatusText } from "@/lib/giving";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { canAccess } from "@/lib/permissions";
import { hrefWith, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Recurring gifts" };

const PAGE_SIZE = 50;
const VIEWS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "failed", label: "Failed" },
  { key: "paused", label: "Paused" },
  { key: "pending_payment_method", label: "Waiting for a payment method" },
  { key: "cancelled", label: "Cancelled" },
] as const;

export default async function RecurringPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = (
    <PageHeader
      title="Giving"
      description="Recurring gifts set up in the member app · never auto-close pledges unless the donor links them"
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
  const viewParam = param(sp, "status");
  const view = VIEWS.find((v) => v.key === viewParam)?.key ?? "all";
  const page = pageParam(sp);
  const { db, center } = session;
  const tz = center.time_zone;
  const monthStart = firstOfMonth(todayInTz(tz));
  const rules = identifierRules(center.rules);
  const canRetry = canAccess(session, "recordPayment");

  let q = db
    .from("recurring_gifts")
    .select("id, household_id, campaign_id, amount_cents, frequency, method, next_charge_on, status, links_to_pledges, special_day_id", { count: "exact" })
    .eq("center_id", center.id);
  if (view !== "all") q = q.eq("status", view);
  const from = (page - 1) * PAGE_SIZE;
  const [res, all] = await Promise.all([
    q.order("next_charge_on", { ascending: true, nullsFirst: false }).range(from, from + PAGE_SIZE - 1),
    fetchAll((f, t) =>
      db.from("recurring_gifts").select("id, status, amount_cents, frequency, updated_at").eq("center_id", center.id).order("id").range(f, t),
    ),
  ]);
  const rows = res.data ?? [];
  const [households, campaigns] = await Promise.all([householdsById(db, rows.map((r) => r.household_id)), campaignsForCenter(db, center.id)]);
  const campaignName = new Map(campaigns.data.map((c) => [c.id, c.name]));
  const k = recurringKpis(all.data, monthStart, tz);
  const hasFailed = rows.some((r) => r.status === "failed");

  return (
    <HouseholdDrawerProvider labels={{ orgMemberLabel: rules.orgMemberLabel, orgHouseholdLabel: rules.orgHouseholdLabel }} timeZone={tz} currency={center.currency}>
      {header}
      <div className="mb-4">
        {all.error ? (
          <QueryError what="the recurring totals" error={all.error} retryHref="/giving/recurring" />
        ) : (
          <KpiGrid cols={4}>
            <Stat
              label="Active recurring gifts"
              value={k.active.toLocaleString()}
              hint={`${k.paused} paused${k.pending ? ` · ${k.pending} waiting for a payment method` : ""}`}
              tone="success"
            />
            <Stat label="Monthly run rate" value={formatCents(k.monthlyRunRateCents, center.currency)} hint="all causes · active gifts only" tone="navy" />
            <Stat label="Failed this month" value={k.failedThisMonth.toLocaleString()} hint="retries run through the payment provider" tone="danger" />
            <Stat label="Expiring cards" value="—" hint="needs the payment provider connection" tone="brown" />
          </KpiGrid>
        )}
      </div>
      {res.error ? (
        <QueryError what="recurring gifts" error={res.error} retryHref={hrefWith("/giving/recurring", sp, {})} />
      ) : (
        <Card title="Recurring gifts" padded={false}>
          <div className="px-2.5">
            <ChipLinks
              label="Recurring gift status"
              active={view}
              items={VIEWS.map((v) => ({ key: v.key, label: v.label, href: hrefWith("/giving/recurring", {}, { status: v.key === "all" ? undefined : v.key }) }))}
            />
          </div>
          {hasFailed && canRetry ? (
            <div className="px-2.5 pb-2">
              <Alert tone="info">
                &ldquo;Retry now&rdquo; is not available yet: charges run through the payment provider, which is not connected. Failed gifts are not
                retried from here and donors are not notified automatically.
              </Alert>
            </div>
          ) : null}
          {rows.length === 0 ? (
            <EmptyState title="No recurring gifts here" />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Household</th>
                    <th>Cause</th>
                    <th className="num">Amount</th>
                    <th>Frequency</th>
                    <th>Method</th>
                    <th>Next</th>
                    <th>Status</th>
                    {canRetry ? <th /> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const h = households.map.get(r.household_id);
                    const st = recurringStatusText(r);
                    return (
                      <HouseholdRow key={r.id} householdId={r.household_id} label={`Open ${h?.display_name ?? "the household"}`}>
                        <td className="font-semibold">
                          {h?.display_name ?? "Household"}
                          <div className="font-mono text-xs font-normal text-muted">{h?.household_number ?? ""}</div>
                        </td>
                        <td>
                          {r.campaign_id ? (campaignName.get(r.campaign_id) ?? "Campaign") : r.special_day_id ? "Special-day labh" : "General fund"}
                          {r.links_to_pledges ? <div className="text-xs text-muted">Linked to pledges</div> : null}
                        </td>
                        <td className="num">{formatCents(r.amount_cents, center.currency)}</td>
                        <td>{frequencyText(r.frequency)}</td>
                        <td>{PAYMENT_METHOD_LABEL[r.method] ?? r.method}</td>
                        <td className="whitespace-nowrap">{monthDay(r.next_charge_on)}</td>
                        <td>
                          {st.tone === "muted" ? <span className="font-semibold text-muted">{st.label}</span> : <StatusText tone={st.tone}>{st.label}</StatusText>}
                        </td>
                        {canRetry ? (
                          <td>
                            {r.status === "failed" ? (
                              <button
                                type="button"
                                disabled
                                aria-disabled="true"
                                title="Needs the payment provider, which is not connected yet"
                                className={buttonClass("off", "xs")}
                              >
                                Retry now
                              </button>
                            ) : null}
                          </td>
                        ) : null}
                      </HouseholdRow>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
          <Pagination page={page} pageSize={PAGE_SIZE} total={res.count ?? null} hrefFor={(n) => hrefWith("/giving/recurring", sp, { page: n })} />
        </Card>
      )}
    </HouseholdDrawerProvider>
  );
}
