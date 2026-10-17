import type { Metadata } from "next";
import Link from "next/link";

import { MATCHING_DESCRIPTION, MATCHING_TITLE, MatchingNav } from "@/components/matching/matching-nav";
import { Alert, Card, EmptyState, Field, FilterBar, NoAccess, PageHeader, Pagination, TableWrap } from "@/components/ui";
import { formatDay } from "@/lib/care/model";
import { WHO_SUBMITS_LABEL } from "@/lib/matching/catch";
import { LIBRARY_PAGE, loadProcessList } from "@/lib/matching/data";
import { matchingCan } from "@/lib/permissions";
import { hrefWith, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Gift matching: how to claim" };

// Gift matching › How to claim (CatchTheMatch Phase 1, 0887): the library Weaver's team keeps of the steps that got a match paid, one entry per
// employer program, shared by every community that uses CatchTheMatch. Public facts only: no person, no community, no amount.

export default async function LibraryPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = <PageHeader title={MATCHING_TITLE} description={MATCHING_DESCRIPTION} />;
  if (!matchingCan(session, "view")) {
    return (
      <>
        {header}
        <NoAccess area="Gift matching" access="matching" />
      </>
    );
  }
  const sp = await searchParams;
  const q = (param(sp, "q") ?? "").trim().slice(0, 100);
  const page = pageParam(sp);
  const res = await loadProcessList(session.db, q, page);
  return (
    <>
      {header}
      <MatchingNav active="library" />
      <p className="crm-hint m-0 mb-3 max-w-3xl">
        The steps that got a match paid, written by Weaver&apos;s team, one employer at a time. A step you find out of date goes to the directory under Something changed.
      </p>
      <FilterBar action="/giving/matching/library">
        <Field label="Find an employer" htmlFor="library-q" className="min-w-[240px] flex-1">
          <input id="library-q" name="q" defaultValue={q} className="crm-input" placeholder="Company name, in any spelling" maxLength={100} />
        </Field>
      </FilterBar>
      <Card padded={false} className="mt-3">
        {!res.ok ? (
          <div className="p-4">
            <Alert tone="danger" title="The library could not be loaded">
              {res.error}{" "}
              <Link href={hrefWith("/giving/matching/library", sp, {})} className="crm-link">
                Try again
              </Link>
            </Alert>
          </div>
        ) : res.data.rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title={q ? "No employer with steps matches that name." : "Weaver's team has not written any steps yet."} />
          </div>
        ) : (
          <>
            <TableWrap>
              <table className="crm-table" aria-label="How to claim, by employer">
                <thead>
                  <tr>
                    <th>Employer</th>
                    <th>How it works</th>
                    <th>Seen to work</th>
                  </tr>
                </thead>
                <tbody>
                  {res.data.rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/giving/matching/${r.id}`} className="crm-link font-semibold" dir="auto">
                          {r.companyName}
                        </Link>
                        {r.country ? <span className="text-[12px] text-muted"> ({r.country})</span> : null}
                      </td>
                      <td>
                        {r.summary}
                        <p className="m-0 text-[12px] text-muted">{WHO_SUBMITS_LABEL[r.whoSubmits]}</p>
                      </td>
                      <td className="text-[13px]">
                        {r.workedOn ? `Seen by Weaver's team ${formatDay(r.workedOn)}` : "Not yet seen"}
                        <p className="m-0 text-[12px] text-muted">
                          {r.workedCommunities === 0 ? "No community paid through it yet" : `${r.workedCommunities} ${r.workedCommunities === 1 ? "community" : "communities"} paid through it`}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <Pagination page={page} pageSize={LIBRARY_PAGE} total={res.data.total} hrefFor={(n) => hrefWith("/giving/matching/library", sp, { page: n > 1 ? String(n) : null })} />
          </>
        )}
      </Card>
    </>
  );
}
