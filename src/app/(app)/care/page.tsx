import type { Metadata } from "next";
import Link from "next/link";

import { Alert, Card, ChipLinks, EmptyState, Field, FilterBar, PageHeader, Pagination, TableWrap, buttonClass } from "@/components/ui";
import { HealthChip } from "@/components/care/health-chip";
import { LIST_FILTERS, NO_ACCESS, formatDay, householdLine, type CareListFilter } from "@/lib/care/model";
import { CARE_PAGE_SIZE, loadCareList, loadHealth, seesCare } from "@/lib/data/care";
import { kindName } from "@/lib/kind";
import { hrefWith, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Care" };

// The DonorDelight area (slice 2): the households the organization cares for, their relationship owners and their last personal
// touch. A care.own holder sees only the households they own or back up; care.view and care.manage see every household.
// The database decides (app.care_households, 0763: no platform-admin branch) and logs the read. A refusal reads "You don't have
// access to this area", never an empty table.

const FILTER_LABEL: Record<CareListFilter, string> = {
  all: "All households",
  mine: "My households",
  needs_owner: "Needs an owner",
  resting: "Do not ask",
};

function filterOf(v: string | undefined): CareListFilter | null {
  return v && (LIST_FILTERS as readonly string[]).includes(v) ? (v as CareListFilter) : null;
}

function when(iso: string | null, timeZone: string): string {
  if (!iso) return "None yet";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" });
}

export default async function CarePage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const sp = await searchParams;
  const label = kindName(session.kind, "care", "DonorDelight");
  const description = "The households you care for, who owns each relationship, and the last personal touch. Only roles your organization chooses see this; Weaver staff cannot.";

  if (!seesCare(session)) {
    return (
      <>
        <PageHeader title={label} description={description} />
        <div className="cc-card px-6 py-10 text-center">
          <p className="font-display text-[22px] font-semibold text-ink">{NO_ACCESS}</p>
          <p className="mx-auto mt-2 max-w-lg text-[13px] text-muted">
            {label} is open only to the roles your organization gives it (Care lead, Relationship owner). Ask your organization&apos;s owner or care lead.
          </p>
        </div>
      </>
    );
  }

  const requested = filterOf(param(sp, "show"));
  const search = (param(sp, "q") ?? "").trim().slice(0, 100) || null;
  const page = pageParam(sp);
  const list = await loadCareList(session, requested ?? "all", search, page);
  const tz = session.center.time_zone;

  if (list.status === "no_access" || list.status === "off") {
    return (
      <>
        <PageHeader title={label} description={description} />
        <div className="cc-card px-6 py-10 text-center">
          <p className="font-display text-[22px] font-semibold text-ink">{list.status === "off" ? list.message : NO_ACCESS}</p>
        </div>
      </>
    );
  }
  if (list.status === "error") {
    return (
      <>
        <PageHeader title={label} description={description} />
        <Alert
          tone="danger"
          title="Could not load the households"
          action={
            <a href={hrefWith("/care", sp, {})} className={buttonClass("bad", "xs")}>
              Try again
            </a>
          }
        >
          {list.error.charAt(0).toUpperCase() + list.error.slice(1).replace(/\.?$/, ".")}
        </Alert>
      </>
    );
  }

  const data = list.data;
  // The sign of each household on this page (slice 4). A failed read costs the column, never the list: the note above the table says so.
  const health = await loadHealth(session, data.rows.map((r) => r.household.id));
  const signs = health.status === "ok" ? health.data : {};
  const chips = LIST_FILTERS.filter((f) => data.can.all || f === "mine" || f === "resting").map((f) => {
    const count = f === "all" ? data.counts.all : f === "mine" ? data.counts.mine : f === "needs_owner" ? data.counts.needsOwner : data.counts.resting;
    return { key: f, label: `${FILTER_LABEL[f]}${count === null ? "" : ` (${count})`}`, href: hrefWith("/care", sp, { show: f, page: null }) };
  });

  return (
    <>
      <PageHeader title={label} description={description} />
      <ChipLinks label="Show" items={chips} active={data.filter} />
      <FilterBar action="/care">
        <input type="hidden" name="show" value={data.filter} />
        <Field label="Find a household" htmlFor="care-q" className="min-w-[240px] flex-1">
          <input id="care-q" name="q" defaultValue={search ?? ""} className="crm-input" placeholder="Name, household number or ID" maxLength={100} />
        </Field>
      </FilterBar>
      {health.status === "error" ? (
        <p role="alert" className="m-0 mb-2 text-[13px] text-danger">
          Could not load the engagement signs — {health.error.replace(/\.?$/, ".")} Reload the page to try again.
        </p>
      ) : null}
      <Card padded={false}>
        {data.rows.length === 0 ? (
          <EmptyState title={search ? "No household matches that search." : data.filter === "mine" ? "You do not own any household yet." : data.filter === "needs_owner" ? "Every household has an owner." : data.filter === "resting" ? "No household is resting." : "No households yet."}>
            {data.filter === "mine" && !data.can.all ? "Someone who manages care chooses the households you look after." : null}
          </EmptyState>
        ) : (
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th scope="col">Household</th>
                  <th scope="col">Relationship owner</th>
                  <th scope="col">Sign</th>
                  <th scope="col">Last personal touch</th>
                  <th scope="col">Asking</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.household.id}>
                    <td>
                      <Link href={`/households/${r.household.id}`} className="crm-link font-semibold">
                        {r.household.name}
                      </Link>
                      <div className="text-[12px] text-muted">{householdLine(r.household)}</div>
                    </td>
                    <td>
                      {r.needsOwner ? (
                        <span className="font-semibold text-brown">{r.owner ? `Needs an owner (${r.owner} no longer has a care role)` : "Needs an owner"}</span>
                      ) : (
                        <>
                          {r.owner}
                          {r.backup ? <div className="text-[12px] text-muted">Backup: {r.backup}</div> : null}
                        </>
                      )}
                    </td>
                    <td>{signs[r.household.id] ? <HealthChip health={signs[r.household.id]} /> : "—"}</td>
                    <td>{when(r.lastTouchAt, tz)}</td>
                    <td>{r.resting ? (r.restUntil ? `Do not ask until ${formatDay(r.restUntil)}` : "Do not ask") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Pagination page={page} pageSize={CARE_PAGE_SIZE} total={data.total} hrefFor={(p) => hrefWith("/care", sp, { page: p })} />
      </Card>
    </>
  );
}
