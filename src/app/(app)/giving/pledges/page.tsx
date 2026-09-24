import type { Metadata } from "next";
import Link from "next/link";

import { WriteOffControls } from "@/components/two-person-controls";
import { Badge, Card, EmptyState, NoAccess, PageHeader, Pagination, QueryError, TableWrap, buttonClass } from "@/components/ui";
import { AGING_BUCKETS, agingBucket, emptyAging } from "@/lib/aging";
import type { Enums } from "@/lib/database.types";
import { fetchAll } from "@/lib/data/fetch-all";
import { campaignsForCenter, householdsById, userNames } from "@/lib/data/lookups";
import { dateInTz, formatDate, startOfDayInTz, todayInTz } from "@/lib/dates";
import { PLEDGE_STATUS_LABEL, PLEDGE_STATUS_TONE } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { canAccess } from "@/lib/permissions";
import { hrefWith, isUuid, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Pledges" };

const PAGE_SIZE = 50;
type PledgeStatus = Enums<"pledge_status">;
const STATUS_FILTERS: Record<string, { label: string; statuses: PledgeStatus[] }> = {
  outstanding: { label: "Outstanding (open + partly paid)", statuses: ["open", "partially_paid"] },
  open: { label: "Open", statuses: ["open"] },
  partially_paid: { label: "Partly paid", statuses: ["partially_paid"] },
  paid: { label: "Paid", statuses: ["paid"] },
  written_off: { label: "Written off", statuses: ["written_off"] },
  cancelled: { label: "Cancelled", statuses: ["cancelled"] },
  all: { label: "All statuses", statuses: [] },
};

export default async function PledgesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = (
    <PageHeader
      title="Pledges"
      description="Every commitment a household has made — RSVP commitments, bolis, sponsorships, pujans, labh, construction and more. Aging runs from the due date, or the pledge date when there is none."
    />
  );
  if (!canAccess(session, "pledges")) {
    return (
      <>
        {header}
        <NoAccess area="Pledges" access="pledges" />
      </>
    );
  }
  const sp = await searchParams;
  const { db, center } = session;
  const tz = center.time_zone;
  const today = todayInTz(tz);
  const statusKey = param(sp, "status") ?? "outstanding";
  const statusFilter = STATUS_FILTERS[statusKey] ?? STATUS_FILTERS.outstanding;
  const campaign = param(sp, "campaign");
  const yearParam = Number(param(sp, "year"));
  const year = Number.isInteger(yearParam) && yearParam > 1990 && yearParam < 2200 ? yearParam : null;
  const page = pageParam(sp);
  const retry = hrefWith("/giving/pledges", sp, {});
  const canManage = canAccess(session, "givingManage");
  const canApprove = canAccess(session, "givingApprove");

  const campaigns = await campaignsForCenter(db, center.id);
  const campaignName = new Map(campaigns.data.map((c) => [c.id, c.name]));
  const currentYear = Number(today.slice(0, 4));

  // Shared filters for the table and the aging summary.
  const yearFrom = year ? startOfDayInTz(`${year}-01-01`, tz) : null;
  const yearTo = year ? startOfDayInTz(`${year + 1}-01-01`, tz) : null;

  let tableQuery = db
    .from("pledges")
    .select(
      "id, pledge_number, household_id, campaign_id, source, amount_cents, paid_cents, status, pledged_at, due_on, dedication, written_off_by, written_off_second_approver, write_off_reason",
      { count: "exact" },
    )
    .eq("center_id", center.id);
  if (statusFilter.statuses.length > 0) tableQuery = tableQuery.in("status", statusFilter.statuses);
  if (campaign === "none") tableQuery = tableQuery.is("campaign_id", null);
  else if (isUuid(campaign)) tableQuery = tableQuery.eq("campaign_id", campaign);
  if (yearFrom && yearTo) tableQuery = tableQuery.gte("pledged_at", yearFrom).lt("pledged_at", yearTo);
  const from = (page - 1) * PAGE_SIZE;
  const res = await tableQuery.order("pledged_at", { ascending: true }).range(from, from + PAGE_SIZE - 1);
  const rows = res.data ?? [];

  const aging = await fetchAll((f, t) => {
    let q = db
      .from("pledges")
      .select("id, amount_cents, paid_cents, pledged_at, due_on")
      .eq("center_id", center.id)
      .in("status", ["open", "partially_paid"]);
    if (campaign === "none") q = q.is("campaign_id", null);
    else if (isUuid(campaign)) q = q.eq("campaign_id", campaign);
    if (yearFrom && yearTo) q = q.gte("pledged_at", yearFrom).lt("pledged_at", yearTo);
    return q.order("id").range(f, t);
  });
  const buckets = emptyAging();
  for (const p of aging.data) {
    const b = agingBucket(p.due_on, dateInTz(p.pledged_at, tz), today);
    buckets[b].count += 1;
    buckets[b].open_cents += p.amount_cents - p.paid_cents;
  }
  const totalOpen = Object.values(buckets).reduce((s, b) => s + b.open_cents, 0);

  const [households, requesters] = await Promise.all([
    householdsById(db, rows.map((r) => r.household_id)),
    userNames(db, center.id, rows.map((r) => r.written_off_by)),
  ]);

  return (
    <>
      {header}
      <form method="get" action="/giving/pledges" className="mb-5 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="status" className="crm-label">
            Status
          </label>
          <select id="status" name="status" defaultValue={statusKey} className="crm-input min-w-56">
            {Object.entries(STATUS_FILTERS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="campaign" className="crm-label">
            Campaign
          </label>
          <select id="campaign" name="campaign" defaultValue={campaign ?? ""} className="crm-input min-w-56">
            <option value="">All campaigns</option>
            <option value="none">No campaign</option>
            {campaigns.data.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="year" className="crm-label">
            Pledged in
          </label>
          <select id="year" name="year" defaultValue={year ? String(year) : ""} className="crm-input min-w-32">
            <option value="">Any year</option>
            {Array.from({ length: 8 }, (_, i) => currentYear - i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={buttonClass("primary")}>
          Apply
        </button>
        {param(sp, "status") || campaign || year ? (
          <Link href="/giving/pledges" className={buttonClass("ghost")}>
            Clear
          </Link>
        ) : null}
      </form>

      <section aria-label="Aging of outstanding pledges" className="mb-6">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-lg font-semibold text-ink">Aging of outstanding pledges</h2>
          <p className="text-sm text-muted">
            {formatCents(totalOpen, center.currency)} open across {aging.data.length.toLocaleString()} pledges
            {campaign || year ? " (filtered)" : ""}
            {aging.truncated ? " — first 50,000 only" : ""}
          </p>
        </div>
        {aging.error ? (
          <QueryError what="the aging summary" error={aging.error} retryHref={retry} />
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {AGING_BUCKETS.map((b) => (
              <div
                key={b.key}
                className={`rounded-lg border bg-card px-4 py-3 ${b.key === "d90_plus" && buckets[b.key].count > 0 ? "border-danger/40" : "border-line"}`}
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">{b.label}</p>
                <p className="mt-1 font-display text-xl font-semibold tabular-nums">{formatCents(buckets[b.key].open_cents, center.currency)}</p>
                <p className="text-xs text-muted">{buckets[b.key].count.toLocaleString()} pledges</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {res.error ? (
        <QueryError what="pledges" error={res.error} retryHref={retry} />
      ) : (
        <Card padded={false}>
          {campaigns.error || households.error ? (
            <div className="p-4">
              <QueryError what="campaign or household names" error={campaigns.error ?? households.error} retryHref={retry} />
            </div>
          ) : null}
          {rows.length === 0 ? (
            <EmptyState title="No pledges match these filters" />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Pledge</th>
                    <th>Household</th>
                    <th>Campaign</th>
                    <th>Status</th>
                    <th className="num">Amount</th>
                    <th className="num">Paid</th>
                    <th className="num">Open</th>
                    <th>Pledged</th>
                    <th>Due</th>
                    <th>Age</th>
                    {canManage || canApprove ? <th>Write-off</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const h = households.map.get(p.household_id);
                    const outstanding = p.status === "open" || p.status === "partially_paid";
                    const bucket = outstanding ? agingBucket(p.due_on, dateInTz(p.pledged_at, tz), today) : null;
                    return (
                      <tr key={p.id}>
                        <td className="font-mono text-[0.8125rem]">
                          {p.pledge_number ?? "—"}
                          <div className="font-sans text-xs capitalize text-muted">{p.source.replace(/_/g, " ")}</div>
                        </td>
                        <td>
                          <Link href={`/households/${p.household_id}?tab=pledges`} className="crm-link">
                            {h?.display_name ?? "Household"}
                          </Link>
                          <div className="font-mono text-xs text-muted">{h?.household_number ?? ""}</div>
                        </td>
                        <td>{p.campaign_id ? (campaignName.get(p.campaign_id) ?? "—") : <span className="text-muted">None</span>}</td>
                        <td>
                          <Badge tone={PLEDGE_STATUS_TONE[p.status]}>{PLEDGE_STATUS_LABEL[p.status]}</Badge>
                        </td>
                        <td className="num">{formatCents(p.amount_cents, center.currency)}</td>
                        <td className="num">{formatCents(p.paid_cents, center.currency)}</td>
                        <td className="num font-semibold">{formatCents(Math.max(0, p.amount_cents - p.paid_cents), center.currency)}</td>
                        <td className="whitespace-nowrap">{formatDate(p.pledged_at, tz)}</td>
                        <td className="whitespace-nowrap">{formatDate(p.due_on, tz)}</td>
                        <td className="whitespace-nowrap">
                          {bucket ? (
                            <span className={bucket === "d90_plus" ? "font-semibold text-danger" : ""}>
                              {AGING_BUCKETS.find((b) => b.key === bucket)?.label}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        {canManage || canApprove ? (
                          <td>
                            {outstanding ? (
                              <WriteOffControls
                                pledgeId={p.id}
                                requestedBy={p.written_off_by}
                                secondApprover={p.written_off_second_approver}
                                requesterName={p.written_off_by ? (requesters.get(p.written_off_by)?.name ?? null) : null}
                                reason={p.write_off_reason}
                                me={session.userId}
                                canManage={canManage}
                                canApprove={canApprove}
                              />
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
          <Pagination page={page} pageSize={PAGE_SIZE} total={res.count ?? null} hrefFor={(p) => hrefWith("/giving/pledges", sp, { page: p })} />
        </Card>
      )}
    </>
  );
}
