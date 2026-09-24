import type { Metadata } from "next";
import Link from "next/link";

import { Card, ChipLinks, EmptyState, NoAccess, PageHeader, Pagination, QueryError, TableWrap, buttonClass } from "@/components/ui";
import { CustomColumnPicker } from "@/components/custom-column-picker";
import { identifierRules } from "@/lib/center-rules";
import { formatCustomValue } from "@/lib/custom-fields";
import { loadCustomColumn, loadCustomFieldDefs } from "@/lib/data/custom-fields";
import { listPeople, peopleTotals } from "@/lib/data/people-list";
import { canAccess } from "@/lib/permissions";
import { AGE_BANDS, isAgeBand, relationshipLabel, type AgeBand } from "@/lib/people";
import { hrefWith, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { ClickableRow, LiveSearch } from "./_components/client";
import { PeopleDrawers, drawerHref } from "./_components/drawers";

export const metadata: Metadata = { title: "People" };

const PAGE_SIZE = 50;

export default async function PeopleListPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  if (!canAccess(session, "households")) {
    return (
      <>
        <PageHeader title="People" />
        <NoAccess area="People" access="households" />
      </>
    );
  }
  const sp = await searchParams;
  const base = "/people";
  const q = param(sp, "q");
  const bandParam = param(sp, "band");
  const band: AgeBand = isAgeBand(bandParam) ? bandParam : "all";
  const page = pageParam(sp);
  const rules = identifierRules(session.center.rules);
  const [list, totals] = await Promise.all([listPeople(session, { search: q, band, page, pageSize: PAGE_SIZE }), peopleTotals(session)]);
  if (totals.error) console.error("[people] totals for the sub-line failed; showing none:", totals.error);
  const defs = await loadCustomFieldDefs(session.db, session.center.id, "people");
  const cfKey = param(sp, "cf") ?? null;
  const cfDef = defs.defs.find((d) => d.key === cfKey) ?? null;
  const cfValues = cfDef ? await loadCustomColumn(session.db, "people", list.rows.map((r) => r.id)) : null;
  const openId = param(sp, "person");
  const retry = hrefWith(base, sp, {});

  return (
    <>
      <PageHeader
        title="People"
        description={
          totals.people !== null && totals.households !== null
            ? `${totals.people.toLocaleString("en-US")} people across ${totals.households.toLocaleString("en-US")} households · open anyone to view or edit`
            : "Open anyone to view or edit"
        }
      />
      <Card className="mb-4">
        <form method="get" action={base}>
          {band !== "all" ? <input type="hidden" name="band" value={band} /> : null}
          <LiveSearch
            id="people-q"
            label="Search by name, phone, email or member ID"
            placeholder={`e.g. Shah, 555-0142, a member number or ${rules.orgMemberLabel}`}
            defaultValue={q ?? ""}
          />
        </form>
      </Card>
      <Card padded={false}>
        <div className="px-2.5 pt-1">
          <ChipLinks
            label="Age and role"
            active={band}
            items={AGE_BANDS.map((b) => ({ key: b.key, label: b.label, href: hrefWith(base, sp, { band: b.key === "all" ? undefined : b.key, page: undefined, person: undefined, hh: undefined, mode: undefined }) }))}
          />
          {list.note ? <p className="mb-2 text-xs text-muted">{list.note}</p> : null}
          <div className="mb-2">
            <CustomColumnPicker action={base} sp={sp} defs={defs.defs} current={cfDef?.key ?? null} />
          </div>
          {cfValues?.error ? <p className="mb-2 text-xs text-danger">Could not load the “{cfDef?.label}” column. Reload to try again.</p> : null}
        </div>
        {list.error ? (
          <div className="p-2.5">
            <QueryError what={list.rows.length ? "some details for these people" : "people"} error={list.error} retryHref={retry} />
          </div>
        ) : null}
        {list.rows.length === 0 && !list.error ? (
          <EmptyState title={q || band !== "all" ? "No one matches that search" : "Nothing here right now"} />
        ) : list.rows.length > 0 ? (
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Relationship</th>
                  <th>Household</th>
                  <th className="num">Age</th>
                  <th>On app</th>
                  <th>Contact</th>
                  {cfDef ? <th>{cfDef.label}</th> : null}
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {list.rows.map((p) => {
                  const minor = p.age !== null && p.age < 18;
                  const open = drawerHref(base, sp, { person: p.id });
                  return (
                    <ClickableRow key={p.id} href={open} selected={openId === p.id}>
                      <td className="font-mono text-[12px]">
                        {p.memberNumber ?? "—"}
                        {p.orgIds.length ? <div className="text-[11px] text-muted">{p.orgIds.join(", ")}</div> : null}
                      </td>
                      <td className="font-bold">{p.name}</td>
                      <td>{p.role ? relationshipLabel(p.isPrimary ? "primary" : p.role, p.gender) : "—"}</td>
                      <td>
                        {p.household ? (
                          <>
                            {p.household.name}
                            {p.household.number ? <span className="ml-1 font-mono text-[11px] text-muted">{p.household.number}</span> : null}
                          </>
                        ) : (
                          <span className="text-faint">No household</span>
                        )}
                      </td>
                      <td className="num">{p.age ?? "—"}</td>
                      <td>{minor ? "—" : p.onApp ? "Yes" : "No"}</td>
                      <td className="max-w-[16rem] truncate">{minor ? "Via parents" : p.email || p.phone || <span className="text-faint">—</span>}</td>
                      {cfDef ? <td>{formatCustomValue(cfDef, cfValues?.map.get(p.id)?.[cfDef.key], session.center.currency) || "—"}</td> : null}
                      <td className="row-actions">
                        <Link href={open} scroll={false} className={buttonClass("ghost", "xs")}>
                          Open
                        </Link>
                      </td>
                    </ClickableRow>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        ) : null}
        <Pagination page={page} pageSize={PAGE_SIZE} total={list.total} hrefFor={(n) => hrefWith(base, sp, { page: n })} />
      </Card>
      <PeopleDrawers session={session} sp={sp} base={base} />
    </>
  );
}
