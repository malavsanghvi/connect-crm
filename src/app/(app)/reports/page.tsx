import type { Metadata } from "next";

import Link from "next/link";

import { BarList } from "@/components/bar-list";
import { BlockGrid, Card, EmptyState, KpiGrid, NoAccess, PageHeader, QueryError, Stat, TableWrap, buttonClass } from "@/components/ui";
import { fetchAll } from "@/lib/data/fetch-all";
import { campaignsForCenter } from "@/lib/data/lookups";
import { addDays, startOfDayInTz, todayInTz } from "@/lib/dates";
import { barPercent } from "@/lib/giving";
import { APPLICATION_STATUS_LABEL, PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { canAccess } from "@/lib/permissions";
import { param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Reports" };

const TIERS = ["life", "yearly", "community"] as const;
const MSTATUSES = ["active", "pending", "lapsed", "suspended", "ended"] as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = <PageHeader title="Reports" description="Built on the warehouse and filtered by your permissions" />;
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
  const tz = center.time_zone;
  const currentYear = Number(todayInTz(tz).slice(0, 4));
  const yearParam = Number(param(sp, "year"));
  const year = Number.isInteger(yearParam) && yearParam > 1990 && yearParam <= currentYear + 1 ? yearParam : currentYear;
  const yearFrom = startOfDayInTz(`${year}-01-01`, tz);
  const yearTo = startOfDayInTz(`${year + 1}-01-01`, tz);
  const seesMembership = canAccess(session, "memberships");
  const seesGiving = canAccess(session, "paymentsAll");

  const [memberships, applications, pledges, payments, campaigns] = await Promise.all([
    seesMembership
      ? fetchAll((f, t) => db.from("memberships").select("id, tier, status, household_id").eq("center_id", center.id).order("id").range(f, t))
      : null,
    seesMembership
      ? fetchAll((f, t) => db.from("membership_applications").select("id, status, tier").eq("center_id", center.id).order("id").range(f, t))
      : null,
    seesGiving
      ? fetchAll((f, t) =>
          db
            .from("pledges")
            .select("id, campaign_id, amount_cents, paid_cents, status")
            .eq("center_id", center.id)
            .gte("pledged_at", yearFrom)
            .lt("pledged_at", yearTo)
            .not("status", "in", "(cancelled)")
            .order("id")
            .range(f, t),
        )
      : null,
    seesGiving
      ? fetchAll((f, t) =>
          db
            .from("payments")
            .select("id, method, amount_cents, refunded_cents, status")
            .eq("center_id", center.id)
            .gte("received_on", `${year}-01-01`)
            .lte("received_on", `${year}-12-31`)
            .not("status", "in", "(failed,voided,authorized)")
            .order("id")
            .range(f, t),
        )
      : null,
    seesGiving ? campaignsForCenter(db, center.id) : null,
  ]);

  // Membership matrix: tier × status (count of memberships) and distinct active households per tier.
  const matrix = new Map<string, number>();
  const activeHouseholds = new Map<string, Set<string>>();
  for (const m of memberships?.data ?? []) {
    matrix.set(`${m.tier}|${m.status}`, (matrix.get(`${m.tier}|${m.status}`) ?? 0) + 1);
    if (m.status === "active") {
      const set = activeHouseholds.get(m.tier) ?? new Set<string>();
      set.add(m.household_id);
      activeHouseholds.set(m.tier, set);
    }
  }
  const appCounts = new Map<string, number>();
  for (const a of applications?.data ?? []) appCounts.set(a.status, (appCounts.get(a.status) ?? 0) + 1);

  const campaignName = new Map((campaigns?.data ?? []).map((c) => [c.id, c.name]));
  const byCampaign = new Map<string, { pledged: number; paid: number; writtenOff: number; count: number }>();
  for (const p of pledges?.data ?? []) {
    const key = p.campaign_id ?? "none";
    const t = byCampaign.get(key) ?? { pledged: 0, paid: 0, writtenOff: 0, count: 0 };
    t.pledged += p.amount_cents;
    t.paid += p.paid_cents;
    if (p.status === "written_off") t.writtenOff += p.amount_cents - p.paid_cents;
    t.count += 1;
    byCampaign.set(key, t);
  }
  const campaignRows = [...byCampaign.entries()].sort((a, b) => b[1].pledged - a[1].pledged);
  const byMethod = new Map<string, { amount: number; count: number }>();
  for (const p of payments?.data ?? []) {
    const t = byMethod.get(p.method) ?? { amount: 0, count: 0 };
    t.amount += p.amount_cents - p.refunded_cents;
    t.count += 1;
    byMethod.set(p.method, t);
  }

  // Center health (prototype L664): six KPIs, giving by campaign, households by zone.
  const today = todayInTz(tz);
  const isCurrentYear = year === currentYear;
  const periodEnd = isCurrentYear ? today : `${year}-12-31`;
  const prevEnd = `${year - 1}${periodEnd.slice(4)}`;
  const [hh, zones, links, members, prevPayments, openPledges, visits, prevVisits, renewals] = await Promise.all([
    seesMembership
      ? fetchAll((f, t) => db.from("households").select("id, zone_id, created_at").eq("center_id", center.id).is("merged_into_id", null).order("id").range(f, t))
      : null,
    seesMembership ? db.from("zones").select("id, name").eq("center_id", center.id) : null,
    seesMembership
      ? fetchAll((f, t) => db.from("center_users").select("person_id").eq("center_id", center.id).not("person_id", "is", null).order("user_id").range(f, t))
      : null,
    seesMembership
      ? fetchAll((f, t) => db.from("household_members").select("person_id, household_id").eq("center_id", center.id).is("left_at", null).order("household_id").order("person_id").range(f, t))
      : null,
    seesGiving
      ? fetchAll((f, t) =>
          db
            .from("payments")
            .select("id, amount_cents, refunded_cents")
            .eq("center_id", center.id)
            .gte("received_on", `${year - 1}-01-01`)
            .lte("received_on", prevEnd)
            .not("status", "in", "(failed,voided,authorized)")
            .order("id")
            .range(f, t),
        )
      : null,
    seesGiving
      ? fetchAll((f, t) =>
          db.from("pledges").select("id, amount_cents, paid_cents").eq("center_id", center.id).in("status", ["open", "partially_paid"]).order("id").range(f, t),
        )
      : null,
    db
      .from("attendees")
      .select("id", { count: "exact", head: true })
      .eq("center_id", center.id)
      .gte("checked_in_at", yearFrom)
      .lt("checked_in_at", startOfDayInTz(addDays(periodEnd, 1), tz)),
    db
      .from("attendees")
      .select("id", { count: "exact", head: true })
      .eq("center_id", center.id)
      .gte("checked_in_at", startOfDayInTz(`${year - 1}-01-01`, tz))
      .lt("checked_in_at", startOfDayInTz(addDays(prevEnd, 1), tz)),
    seesMembership
      ? db
          .from("memberships")
          .select("id", { count: "exact", head: true })
          .eq("center_id", center.id)
          .eq("status", "active")
          .gte("ends_on", today)
          .lte("ends_on", addDays(today, 60))
      : null,
  ]);
  if (visits.error) console.error("[reports] event visits count failed:", visits.error);
  for (const [what, r] of [["households", hh], ["zones", zones], ["app links", links], ["household members", members], ["prior-year payments", prevPayments], ["open pledges", openPledges], ["prior-year visits", prevVisits], ["renewals", renewals]] as const) {
    if (r?.error) console.error(`[reports] ${what} failed; the tile shows "could not load" or —:`, r.error);
  }
  const hhRows = hh?.data ?? [];
  const newThisYear = hhRows.filter((h) => h.created_at >= yearFrom && h.created_at < yearTo).length;
  const linked = new Set((links?.data ?? []).map((l) => l.person_id));
  const onApp = new Set((members?.data ?? []).filter((m) => linked.has(m.person_id)).map((m) => m.household_id));
  const hhIds = new Set(hhRows.map((h) => h.id));
  const onAppPct = !links?.error && !members?.error && hhRows.length ? Math.round((100 * [...onApp].filter((id) => hhIds.has(id)).length) / hhRows.length) : null;
  const givenYtd = (payments?.data ?? []).reduce((sum, p) => sum + p.amount_cents - p.refunded_cents, 0);
  const givenPrev = (prevPayments?.data ?? []).reduce((sum, p) => sum + p.amount_cents - p.refunded_cents, 0);
  const pct = (a: number, b: number) => (b > 0 ? `${a >= b ? "+" : ""}${Math.round(((a - b) * 100) / b)}%` : null);
  const openCents = (openPledges?.data ?? []).reduce((sum, p) => sum + p.amount_cents - p.paid_cents, 0);
  const zoneName = new Map((zones?.data ?? []).map((z) => [z.id, z.name]));
  const byZone = new Map<string, number>();
  for (const h of hhRows) {
    const k = h.zone_id ? (zoneName.get(h.zone_id) ?? "Other") : "No zone";
    byZone.set(k, (byZone.get(k) ?? 0) + 1);
  }
  const zoneRows = [...byZone.entries()].sort((a, b) => b[1] - a[1]);
  const zoneMax = zoneRows[0]?.[1] ?? 0;
  const campaignBars = campaignRows.slice(0, 6);
  const campaignMax = campaignBars[0]?.[1].pledged ?? 0;
  const compact = (cents: number) => {
    const d = cents / 100;
    return d >= 1e6 ? `$${(d / 1e6).toFixed(2)}M` : d >= 1e4 ? `$${Math.round(d / 1e3)}K` : formatCents(cents, center.currency).replace(/\.00$/, "");
  };

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
            value={seesMembership && !hh?.error ? hhRows.length.toLocaleString() : "—"}
            hint={seesMembership ? (hh?.error ? "could not load" : `+${newThisYear.toLocaleString()} in ${year}`) : "needs people.view"}
            tone="navy"
          />
          <Stat
            label="On the app"
            value={onAppPct === null ? "—" : `${onAppPct}%`}
            hint={seesMembership ? (links?.error || members?.error ? "could not load" : "households with a signed-in member") : "needs people.view"}
            tone="success"
          />
          <Stat
            label={isCurrentYear ? "Given YTD" : `Given in ${year}`}
            value={seesGiving && !payments?.error ? compact(givenYtd) : "—"}
            hint={seesGiving ? (pct(givenYtd, givenPrev) ? `${pct(givenYtd, givenPrev)} vs ${year - 1}` : "no prior-year figure") : "needs giving.view"}
            tone="brown"
          />
          <Stat
            label="Open pledges"
            value={seesGiving && !openPledges?.error ? compact(openCents) : "—"}
            hint={seesGiving ? <Link href="/giving/pledges?status=open" className="crm-link">aging report</Link> : "needs giving.view"}
            tone="brown"
          />
          <Stat
            label="Event visits"
            value={visits.error ? "—" : (visits.count ?? 0).toLocaleString()}
            hint={visits.error ? "needs events.view" : (pct(visits.count ?? 0, prevVisits.count ?? 0) ?? `check-ins in ${year}`)}
            tone="maroon"
          />
          <Stat
            label="Renewals due"
            value={seesMembership && !renewals?.error ? (renewals?.count ?? 0).toLocaleString() : "—"}
            hint={seesMembership ? "next 60 days" : "needs people.view"}
            tone="purple"
          />
        </KpiGrid>
      </div>
      <BlockGrid className="mb-5">
        <Card span={6} title={`Giving by campaign, ${year}`}>
          {!seesGiving ? (
            <p className="text-sm text-muted">Needs giving.view.</p>
          ) : pledges?.error ? (
            <QueryError what="pledges" error={pledges.error} retryHref="/reports" />
          ) : (
            <BarList
              empty={`No pledges in ${year}`}
              items={campaignBars.map(([key, t]) => ({
                label: key === "none" ? "No campaign" : (campaignName.get(key) ?? "Campaign"),
                percent: barPercent(t.pledged, campaignMax),
                value: compact(t.pledged),
                color: "saffron",
              }))}
            />
          )}
        </Card>
        <Card span={6} title="Households by zone">
          {!seesMembership ? (
            <p className="text-sm text-muted">Needs people.view.</p>
          ) : hh?.error || zones?.error ? (
            <QueryError what="households by zone" error={hh?.error ?? zones?.error} retryHref="/reports" />
          ) : (
            <BarList
              empty="No households yet"
              items={zoneRows.map(([name, n]) => ({ label: name, percent: barPercent(n, zoneMax), value: n.toLocaleString(), color: "navy" }))}
            />
          )}
        </Card>
      </BlockGrid>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Membership" description="Memberships by tier and status; households counted once per tier." padded={false}>
          {!seesMembership ? (
            <p className="p-5 text-sm text-muted">Needs people.view.</p>
          ) : memberships?.error ? (
            <div className="p-4">
              <QueryError what="memberships" error={memberships.error} retryHref="/reports" />
            </div>
          ) : (
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
                          {(matrix.get(`${t}|${s}`) ?? 0).toLocaleString()}
                        </td>
                      ))}
                      <td className="num font-semibold">{(activeHouseholds.get(t)?.size ?? 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        <Card title="Membership applications" description="All time, by status." padded={false}>
          {!seesMembership ? (
            <p className="p-5 text-sm text-muted">Needs people.view.</p>
          ) : applications?.error ? (
            <div className="p-4">
              <QueryError what="applications" error={applications.error} retryHref="/reports" />
            </div>
          ) : appCounts.size === 0 ? (
            <EmptyState title="No applications yet" />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <tbody>
                  {Object.keys(APPLICATION_STATUS_LABEL)
                    .filter((s) => appCounts.has(s))
                    .map((s) => (
                      <tr key={s}>
                        <td>{APPLICATION_STATUS_LABEL[s]}</td>
                        <td className="num font-semibold">{appCounts.get(s)?.toLocaleString()}</td>
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
          ) : pledges?.error ? (
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
                  {campaignRows.map(([key, t]) => (
                    <tr key={key}>
                      <td>{key === "none" ? <span className="text-muted">No campaign</span> : (campaignName.get(key) ?? "Campaign")}</td>
                      <td className="num">{t.count.toLocaleString()}</td>
                      <td className="num">{formatCents(t.pledged, center.currency)}</td>
                      <td className="num">{formatCents(t.paid, center.currency)}</td>
                      <td className="num">
                        {formatCents(t.pledged - t.paid - t.writtenOff, center.currency)}
                        {t.writtenOff > 0 ? <div className="text-xs text-muted">{formatCents(t.writtenOff, center.currency)} written off</div> : null}
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
          ) : payments?.error ? (
            <div className="p-4">
              <QueryError what="payments" error={payments.error} retryHref="/reports" />
            </div>
          ) : byMethod.size === 0 ? (
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
                  {[...byMethod.entries()]
                    .sort((a, b) => b[1].amount - a[1].amount)
                    .map(([m, t]) => (
                      <tr key={m}>
                        <td>{PAYMENT_METHOD_LABEL[m] ?? m}</td>
                        <td className="num">{t.count.toLocaleString()}</td>
                        <td className="num">{formatCents(t.amount, center.currency)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>
      {memberships?.truncated || pledges?.truncated || payments?.truncated ? (
        <p className="mt-4 text-sm text-brown">Some totals include only the first 50,000 rows.</p>
      ) : null}
    </>
  );
}
