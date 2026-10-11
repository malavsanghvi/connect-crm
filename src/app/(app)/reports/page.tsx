import type { Metadata } from "next";

import Link from "next/link";

import { BarList } from "@/components/bar-list";
import { AskNiva } from "@/components/niva/ask-niva";
import { BlockGrid, Card, EmptyState, KpiGrid, NoAccess, PageHeader, QueryError, Stat, TableWrap, buttonClass } from "@/components/ui";
import { todayInTz } from "@/lib/dates";
import { barPercent } from "@/lib/giving";
import { APPLICATION_STATUS_LABEL, PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { canAccess } from "@/lib/permissions";
import { reportReads, type Section } from "@/lib/reports/load";
import { pageFigures } from "@/lib/reports/figures";
import { chosenYear, pctText, yearWindow } from "@/lib/reports/periods";
import { param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Reports" };

const TIERS = ["life", "yearly", "community"] as const;
const MSTATUSES = ["active", "pending", "lapsed", "suspended", "ended"] as const;

/** Log a failed read on the server; the card it feeds says "could not load" with a retry. */
function logged<T>(what: string, section: Section<T> | null): void {
  if (section && !section.ok) console.error(`[reports] ${what} failed; its card shows "could not load":`, section.error);
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = (
    <PageHeader
      title="Reports"
      description="Sums are done by the database and filtered by your permissions"
      actions={<AskNiva prompt="How are we doing this year compared with last year?" />}
    />
  );
  if (!canAccess(session, "reports")) {
    return (
      <>
        {header}
        <NoAccess area="Reports" access="reports" />
      </>
    );
  }
  const sp = await searchParams;
  const { db, center } = session;
  const today = todayInTz(center.time_zone);
  const currentYear = Number(today.slice(0, 4));
  const year = chosenYear(Number(param(sp, "year")), currentYear);
  const w = yearWindow(year, currentYear, today);
  const seesMembership = canAccess(session, "memberships");
  const seesGiving = canAccess(session, "paymentsAll");
  const seesEvents = canAccess(session, "events");

  // Seven reads, all at once. Each one is a single sum done in the database (migration 0672): the page no longer downloads the rows.
  const [people, matrix, payments, prevPayments, pledges, visits, prevVisits] = await Promise.all([
    seesMembership ? reportReads.peopleOverview(db, center.id, year, today) : null,
    seesMembership ? reportReads.membershipMatrix(db, center.id) : null,
    seesGiving ? reportReads.payments(db, center.id, w.from, w.yearEnd, "method") : null,
    seesGiving ? reportReads.payments(db, center.id, w.prevFrom, w.prevEnd, "none") : null,
    seesGiving ? reportReads.pledges(db, center.id, w.from, w.yearEnd) : null,
    seesEvents ? reportReads.attendance(db, center.id, w.from, w.periodEnd, 1) : null,
    seesEvents ? reportReads.attendance(db, center.id, w.prevFrom, w.prevEnd, 1) : null,
  ]);
  logged("household figures", people);
  logged("membership figures", matrix);
  logged("money received", payments);
  logged("money received last year", prevPayments);
  logged("pledges", pledges);
  logged("event check-ins", visits);
  logged("event check-ins last year", prevVisits);

  const peopleOk = people?.ok ? people.value : null;
  const matrixOk = matrix?.ok ? matrix.value : null;
  const paymentsOk = payments?.ok ? payments.value : null;
  const prevOk = prevPayments?.ok ? prevPayments.value : null;
  const pledgesOk = pledges?.ok ? pledges.value : null;
  const visitsOk = visits?.ok ? visits.value : null;
  const prevVisitsOk = prevVisits?.ok ? prevVisits.value : null;

  const fig = pageFigures({ people: peopleOk, matrix: matrixOk, payments: paymentsOk, prevPayments: prevOk, pledges: pledgesOk });
  const { onAppPct, givenYtd, givenPrev } = fig;
  const zoneRows = fig.zones;
  const zoneMax = zoneRows[0]?.households ?? 0;
  const campaignRows = fig.campaigns;
  const campaignBars = campaignRows.slice(0, 6);
  const campaignMax = campaignBars[0]?.pledgedCents ?? 0;
  const campaignLabel = (c: { campaign: string | null }) => c.campaign ?? "Campaign";
  const compact = (cents: number) => {
    const d = cents / 100;
    return d >= 1e6 ? `$${(d / 1e6).toFixed(2)}M` : d >= 1e4 ? `$${Math.round(d / 1e3)}K` : formatCents(cents, center.currency).replace(/\.00$/, "");
  };
  const appCounts = fig.applicationCounts;
  const givenHint = !seesGiving
    ? "needs giving.view"
    : !paymentsOk
      ? "could not load"
      : !prevOk
        ? "last year could not load"
        : pctText(givenYtd, givenPrev)
          ? `${pctText(givenYtd, givenPrev)} vs ${year - 1}`
          : "no prior-year figure";

  return (
    <>
      {header}
      <form method="get" action="/reports" className="mb-5 flex items-end gap-3">
        <div>
          <label htmlFor="year" className="crm-label">
            Giving year
          </label>
          <select id="year" name="year" defaultValue={String(year)} className="crm-input min-w-32">
            {Array.from({ length: 8 }, (_, i) => currentYear - i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={buttonClass("secondary")}>
          Show
        </button>
      </form>

      <div className="mb-4">
        <KpiGrid cols={3}>
          <Stat
            label="Households"
            value={seesMembership && fig.households !== null ? fig.households.toLocaleString() : "—"}
            hint={seesMembership ? (peopleOk ? `+${peopleOk.newInYear.toLocaleString()} in ${year}` : "could not load") : "needs people.view"}
            tone="navy"
          />
          <Stat
            label="On the app"
            value={onAppPct === null ? "—" : `${onAppPct}%`}
            hint={seesMembership ? (peopleOk ? "households with a signed-in member" : "could not load") : "needs people.view"}
            tone="success"
          />
          <Stat label={w.isCurrentYear ? "Given YTD" : `Given in ${year}`} value={seesGiving && paymentsOk ? compact(givenYtd) : "—"} hint={givenHint} tone="brown" />
          <Stat
            label="Open pledges"
            value={seesGiving && fig.openPledgesCents !== null ? compact(fig.openPledgesCents) : "—"}
            hint={seesGiving ? <Link href="/giving/pledges?status=open" className="crm-link">aging report</Link> : "needs giving.view"}
            tone="brown"
          />
          <Stat
            label="Event visits"
            value={visitsOk ? visitsOk.checkIns.toLocaleString() : "—"}
            hint={!seesEvents ? "needs events.view" : visitsOk ? (pctText(visitsOk.checkIns, prevVisitsOk?.checkIns ?? 0) ?? `check-ins in ${year}`) : "could not load"}
            tone="maroon"
          />
          <Stat
            label="Renewals due"
            value={seesMembership && peopleOk ? peopleOk.renewalsDue.toLocaleString() : "—"}
            hint={seesMembership ? "next 60 days" : "needs people.view"}
            tone="purple"
          />
        </KpiGrid>
      </div>
      <BlockGrid className="mb-5">
        <Card span={6} title={`Giving by campaign, ${year}`}>
          {!seesGiving ? (
            <p className="text-sm text-muted">Needs giving.view.</p>
          ) : pledges && !pledges.ok ? (
            <QueryError what="pledges" error={pledges.error} retryHref="/reports" />
          ) : (
            <BarList
              empty={`No pledges in ${year}`}
              items={campaignBars.map((c) => ({
                label: c.campaignId === null ? "No campaign" : campaignLabel(c),
                percent: barPercent(c.pledgedCents, campaignMax),
                value: compact(c.pledgedCents),
                color: "saffron",
              }))}
            />
          )}
        </Card>
        <Card span={6} title="Households by zone">
          {!seesMembership ? (
            <p className="text-sm text-muted">Needs people.view.</p>
          ) : people && !people.ok ? (
            <QueryError what="households by zone" error={people.error} retryHref="/reports" />
          ) : (
            <BarList
              empty="No households yet"
              items={zoneRows.map((z) => ({ label: z.zone, percent: barPercent(z.households, zoneMax), value: z.households.toLocaleString(), color: "navy" }))}
            />
          )}
        </Card>
      </BlockGrid>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Membership" description="Memberships by tier and status; households counted once per tier." padded={false}>
          {!seesMembership ? (
            <p className="p-5 text-sm text-muted">Needs people.view.</p>
          ) : matrix && !matrix.ok ? (
            <div className="p-4">
              <QueryError what="memberships" error={matrix.error} retryHref="/reports" />
            </div>
          ) : matrixOk ? (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Tier</th>
                    {MSTATUSES.map((s) => (
                      <th key={s} className="num capitalize">
                        {s}
                      </th>
                    ))}
                    <th className="num">Active households</th>
                  </tr>
                </thead>
                <tbody>
                  {TIERS.map((t) => (
                    <tr key={t}>
                      <td className="font-semibold capitalize">{t}</td>
                      {MSTATUSES.map((s) => (
                        <td key={s} className="num">
                          {fig.membershipCell(t, s).toLocaleString()}
                        </td>
                      ))}
                      <td className="num font-semibold">{fig.activeHouseholds(t).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : null}
        </Card>

        <Card title="Membership applications" description="All time, by status." padded={false}>
          {!seesMembership ? (
            <p className="p-5 text-sm text-muted">Needs people.view.</p>
          ) : matrix && !matrix.ok ? (
            <div className="p-4">
              <QueryError what="applications" error={matrix.error} retryHref="/reports" />
            </div>
          ) : Object.keys(appCounts).length === 0 ? (
            <EmptyState title="No applications yet" />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <tbody>
                  {Object.keys(APPLICATION_STATUS_LABEL)
                    .filter((s) => appCounts[s] !== undefined)
                    .map((s) => (
                      <tr key={s}>
                        <td>{APPLICATION_STATUS_LABEL[s]}</td>
                        <td className="num font-semibold">{appCounts[s].toLocaleString()}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        <Card title={`Campaign detail, ${year}`} description="Pledges made in the year (cancelled excluded)." padded={false}>
          {!seesGiving ? (
            <p className="p-5 text-sm text-muted">Needs giving.view.</p>
          ) : pledges && !pledges.ok ? (
            <div className="p-4">
              <QueryError what="pledges" error={pledges.error} retryHref="/reports" />
            </div>
          ) : campaignRows.length === 0 ? (
            <EmptyState title={`No pledges in ${year}`} />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th className="num">Pledges</th>
                    <th className="num">Pledged</th>
                    <th className="num">Paid</th>
                    <th className="num">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {campaignRows.map((c) => (
                    <tr key={c.campaignId ?? "none"}>
                      <td>{c.campaignId === null ? <span className="text-muted">No campaign</span> : campaignLabel(c)}</td>
                      <td className="num">{c.pledges.toLocaleString()}</td>
                      <td className="num">{formatCents(c.pledgedCents, center.currency)}</td>
                      <td className="num">{formatCents(c.paidCents, center.currency)}</td>
                      <td className="num">
                        {formatCents(c.outstandingCents, center.currency)}
                        {c.writtenOffCents > 0 ? <div className="text-xs text-muted">{formatCents(c.writtenOffCents, center.currency)} written off</div> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        <Card title={`Money received by method, ${year}`} description="Net of refunds; failed and voided payments excluded." padded={false}>
          {!seesGiving ? (
            <p className="p-5 text-sm text-muted">Needs giving.view.</p>
          ) : payments && !payments.ok ? (
            <div className="p-4">
              <QueryError what="payments" error={payments.error} retryHref="/reports" />
            </div>
          ) : !paymentsOk || paymentsOk.groups.length === 0 ? (
            <EmptyState title={`No payments in ${year}`} />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Method</th>
                    <th className="num">Payments</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {fig.methods.map((m) => (
                    <tr key={m.method}>
                      <td>{PAYMENT_METHOD_LABEL[m.method] ?? m.method}</td>
                      <td className="num">{m.payments.toLocaleString()}</td>
                      <td className="num">{formatCents(m.netCents, center.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>
    </>
  );
}
