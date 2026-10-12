import type { Metadata } from "next";
import Link from "next/link";

import { HouseholdDrawerProvider, HouseholdRow } from "@/app/(app)/giving/_components/household-drawer";
import { HistoryButton } from "@/components/record-history";
import { WriteOffControls } from "@/components/two-person-controls";
import { Card, EmptyState, KpiGrid, NoAccess, PageHeader, Pagination, QueryError, Stat, StatusText, TableWrap, buttonClass } from "@/components/ui";
import { AGING_BUCKETS, agingBucket, emptyAging } from "@/lib/aging";
import { identifierRules } from "@/lib/center-rules";
import { fetchAll } from "@/lib/data/fetch-all";
import { campaignsForCenter, householdsById, userNames } from "@/lib/data/lookups";
import { dateInTz, startOfDayInTz, todayInTz } from "@/lib/dates";
import { explainError } from "@/lib/errors";
import { PLEDGE_VIEWS, monthYear, pledgeStatusText, pledgeViewFromParam, writeOffPostingText, type WriteOffPosting } from "@/lib/giving";
import { formatCents } from "@/lib/money";
import { canAccess } from "@/lib/permissions";
import { hrefWith, isUuid, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Pledges" };

const PAGE_SIZE = 50;

export default async function PledgesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = (
    <PageHeader
      title="Giving"
      description="Cash basis · every commitment is a pledge; payments close the earliest open pledge unless tied to a specific one"
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
  const view = pledgeViewFromParam(param(sp, "status"));
  const statuses = PLEDGE_VIEWS[view].statuses;
  const campaign = param(sp, "campaign");
  const yearParam = Number(param(sp, "year"));
  const year = Number.isInteger(yearParam) && yearParam > 1990 && yearParam < 2200 ? yearParam : null;
  const page = pageParam(sp);
  const retry = hrefWith("/giving/pledges", sp, {});
  const canManage = canAccess(session, "givingManage");
  const canApprove = canAccess(session, "givingApprove");
  const rules = identifierRules(center.rules);

  const campaigns = await campaignsForCenter(db, center.id);
  const campaignName = new Map(campaigns.data.map((c) => [c.id, c.name]));
  const currentYear = Number(today.slice(0, 4));

  const yearFrom = year ? startOfDayInTz(`${year}-01-01`, tz) : null;
  const yearTo = year ? startOfDayInTz(`${year + 1}-01-01`, tz) : null;

  let tableQuery = db
    .from("pledges")
    .select(
      "id, pledge_number, household_id, campaign_id, source, amount_cents, paid_cents, status, pledged_at, due_on, written_off_by, written_off_second_approver, write_off_reason, written_off_by_name, closed_at",
      { count: "exact" },
    )
    .eq("center_id", center.id);
  if (statuses.length > 0) tableQuery = tableQuery.in("status", statuses);
  if (campaign === "none") tableQuery = tableQuery.is("campaign_id", null);
  else if (isUuid(campaign)) tableQuery = tableQuery.eq("campaign_id", campaign);
  if (yearFrom && yearTo) tableQuery = tableQuery.gte("pledged_at", yearFrom).lt("pledged_at", yearTo);
  const from = (page - 1) * PAGE_SIZE;
  // Newest first, as in the prototype.
  const res = await tableQuery.order("pledged_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);
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
  const showWriteOff = canManage || canApprove;
  // What each written-off pledge became in QuickBooks (0412), shown on its row.
  const writtenOffIds = rows.filter((r) => r.status === "written_off").map((r) => r.id);
  const woPostings = writtenOffIds.length ? await db.rpc("pledge_writeoff_postings", { p_pledges: writtenOffIds }) : null;
  if (woPostings?.error) console.error("[pledges] pledge_writeoff_postings failed:", woPostings.error);
  const woByPledge = (woPostings?.data ?? {}) as Record<string, WriteOffPosting>;
  const filtered = Boolean(campaign || year);

  const chips = (
    <nav aria-label="Pledge status" className="flex flex-wrap gap-1.5">
      {(Object.keys(PLEDGE_VIEWS) as (keyof typeof PLEDGE_VIEWS)[]).map((k) => (
        <Link
          key={k}
          href={hrefWith("/giving/pledges", sp, { status: k === "all" ? undefined : k, page: undefined })}
          aria-current={k === view ? "page" : undefined}
          className="cc-chip"
        >
          {PLEDGE_VIEWS[k].label}
        </Link>
      ))}
    </nav>
  );

  return (
    <HouseholdDrawerProvider labels={{ orgMemberLabel: rules.orgMemberLabel, orgHouseholdLabel: rules.orgHouseholdLabel }} timeZone={tz} currency={center.currency}>
      {header}
      {res.error ? (
        <QueryError what="pledges" error={res.error} retryHref={retry} />
      ) : (
        <Card title="Pledges" actions={chips} padded={false} className="mb-4">
          <form method="get" action="/giving/pledges" className="flex flex-wrap items-end gap-2.5 px-2.5 pb-2">
            {view !== "all" ? <input type="hidden" name="status" value={view} /> : null}
            <div>
              <label htmlFor="campaign" className="crm-label">
                Campaign
              </label>
              <select id="campaign" name="campaign" defaultValue={campaign ?? ""} className="crm-input min-w-52">
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
            <button type="submit" className={buttonClass("ghost", "sm")}>
              Apply
            </button>
            {filtered ? (
              <Link href={hrefWith("/giving/pledges", {}, { status: view === "all" ? undefined : view })} className={buttonClass("plain", "sm")}>
                Clear
              </Link>
            ) : null}
          </form>
          {campaigns.error || households.error ? (
            <div className="p-2.5">
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
                    <th>Date</th>
                    <th className="num">Amount</th>
                    <th className="num">Paid</th>
                    <th>Status</th>
                    {showWriteOff ? <th>Write-off</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const h = households.map.get(p.household_id);
                    const outstanding = p.status === "open" || p.status === "partially_paid";
                    const st = pledgeStatusText(p.status, p.amount_cents, p.paid_cents);
                    const bucket = outstanding ? agingBucket(p.due_on, dateInTz(p.pledged_at, tz), today) : null;
                    return (
                      <HouseholdRow key={p.id} householdId={p.household_id} label={`Open ${h?.display_name ?? "the household"}`}>
                        <td className="font-mono text-[0.8125rem]">
                          {p.pledge_number ?? "—"}
                          <div className="font-sans">
                            <HistoryButton table="pledges" recordId={p.id} title={`Pledge ${p.pledge_number ?? ""}`.trim()} size="xs" />
                          </div>
                        </td>
                        <td className="font-semibold">
                          {h?.display_name ?? "Household"}
                          <div className="font-mono text-xs font-normal text-muted">{h?.household_number ?? ""}</div>
                        </td>
                        <td>{p.campaign_id ? (campaignName.get(p.campaign_id) ?? "—") : <span className="text-muted">None</span>}</td>
                        <td className="whitespace-nowrap">{monthYear(p.pledged_at, tz)}</td>
                        <td className="num">{formatCents(p.amount_cents, center.currency)}</td>
                        <td className="num">{formatCents(p.paid_cents, center.currency)}</td>
                        <td>
                          {st.tone === "muted" ? (
                            <span className="font-semibold text-muted">{st.label}</span>
                          ) : (
                            <StatusText tone={st.tone}>{st.label}</StatusText>
                          )}
                          {p.status === "written_off" ? (
                            <div className="text-xs text-muted">
                              {p.write_off_reason ? `“${p.write_off_reason}”` : null}
                              {p.written_off_by_name ? ` · written off by ${p.written_off_by_name} (imported)` : null}
                              {woPostings?.error ? (
                                <div className="text-danger">Could not load the QuickBooks status — {explainError(woPostings.error)}.</div>
                              ) : (() => {
                                const q = writeOffPostingText(woByPledge[p.id]);
                                return q ? (
                                  <div data-testid="writeoff-qbo">
                                    <StatusText tone={q.tone === "muted" ? "warn" : q.tone}>{q.label}</StatusText>
                                  </div>
                                ) : null;
                              })()}
                            </div>
                          ) : null}
                          {bucket && bucket !== "not_due" ? (
                            <div className={`text-xs ${bucket === "d90_plus" ? "font-semibold text-danger" : "text-muted"}`}>
                              {AGING_BUCKETS.find((b) => b.key === bucket)?.label}
                            </div>
                          ) : null}
                        </td>
                        {showWriteOff ? (
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
                      </HouseholdRow>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
          <Pagination page={page} pageSize={PAGE_SIZE} total={res.count ?? null} hrefFor={(n) => hrefWith("/giving/pledges", sp, { page: n })} />
        </Card>
      )}

      <Card
        title="Aging of outstanding pledges"
        description={`${formatCents(totalOpen, center.currency)} open across ${aging.data.length.toLocaleString()} pledges${filtered ? " (filtered)" : ""}${aging.truncated ? " — first 50,000 only" : ""} · aging runs from the due date, or the pledge date when there is none`}
      >
        {aging.error ? (
          <QueryError what="the aging summary" error={aging.error} retryHref={retry} />
        ) : (
          <KpiGrid cols={5}>
            {AGING_BUCKETS.map((b) => (
              <Stat
                key={b.key}
                label={b.label}
                value={formatCents(buckets[b.key].open_cents, center.currency)}
                hint={`${buckets[b.key].count.toLocaleString()} pledges`}
                tone={b.key === "d90_plus" && buckets[b.key].count > 0 ? "danger" : "brown"}
              />
            ))}
          </KpiGrid>
        )}
      </Card>
    </HouseholdDrawerProvider>
  );
}
