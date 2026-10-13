import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { MATCHING_DESCRIPTION, MATCHING_TITLE, MatchingNav } from "@/components/matching/matching-nav";
import { Alert, Card, ChipLinks, EmptyState, NoAccess, PageHeader, Pagination, TableWrap } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { QUEUE_PAGE, loadEmployersQueue } from "@/lib/matching/data";
import { howText } from "@/lib/matching/directory";
import { matchingCan } from "@/lib/permissions";
import { hrefWith, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { linkProgramAction, unlinkProgramAction } from "../actions";

export const metadata: Metadata = { title: "Employers on file" };

const FILTERS = [
  { key: "unlinked", label: "Not linked yet" },
  { key: "linked", label: "Linked" },
  { key: "all", label: "All" },
] as const;

/**
 * Gift matching › Employers on file: the adults who put an employer on file for gift matching (with their consent, 0759), and
 * the directory entry each is. Matching is by name only (any of the company's names, in any script) and a CatchTheMatch
 * manager confirms every link. Each read is logged in the organization's own audit.
 */
export default async function EmployersOnFilePage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
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
  const filterParam = param(sp, "filter");
  const filter = FILTERS.find((f) => f.key === filterParam)?.key ?? "unlinked";
  const page = pageParam(sp);
  const canLink = matchingCan(session, "manage");
  const tz = session.center.time_zone;
  const res = await loadEmployersQueue(session.db, session.center.id, filter, page);
  const base = { filter: filter === "unlinked" ? undefined : filter };

  return (
    <>
      {header}
      <MatchingNav active="employers" />
      <ChipLinks label="Link status" active={filter} items={FILTERS.map((f) => ({ key: f.key, label: f.label, href: hrefWith("/giving/matching/employers", {}, { filter: f.key === "unlinked" ? undefined : f.key }) }))} />
      <Card padded={false}>
        {!res.ok ? (
          <div className="p-4">
            <Alert tone="danger" title="The employers on file could not be loaded">
              {res.error}{" "}
              <Link href={hrefWith("/giving/matching/employers", base, {})} className="crm-link">
                Try again
              </Link>
            </Alert>
          </div>
        ) : res.data.rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title={filter === "unlinked" ? "Every employer on file is linked" : "No employers on file here"}>
              Members add their employer for gift matching in the member app; the office records one from a signed paper form in the person&apos;s
              Gift matching section.
            </EmptyState>
          </div>
        ) : (
          <>
            <TableWrap>
              <table className="crm-table" aria-label="Employers on file for gift matching">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Employer on file</th>
                    <th>Directory entry</th>
                    {canLink ? <th aria-label="Actions" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {res.data.rows.map((r) => {
                    const first = r.preferred_name || r.first_name;
                    const entry = r.link?.program ?? null;
                    return (
                      <tr key={r.person_id} data-person={r.person_id}>
                        <td>
                          <Link href={`/people/${r.person_id}`} className="crm-link font-semibold">
                            {first} {r.last_name}
                          </Link>
                          {r.member_number ? <p className="m-0 font-mono text-[12px] text-muted">{r.member_number}</p> : null}
                        </td>
                        <td dir="auto">{r.employer}</td>
                        <td>
                          {entry ? (
                            <>
                              <Link href={`/giving/matching/${entry.id}`} className="crm-link" dir="auto">
                                {entry.company_name}
                              </Link>
                              {entry.status === "retired" ? <span className="text-[12px] text-muted"> (ended)</span> : null}
                              <p className="m-0 text-[12px] text-muted">
                                {howText(r.link?.how)} · confirmed by {r.link?.confirmed_by} on {formatDate(r.link?.confirmed_at, tz)}
                              </p>
                            </>
                          ) : r.best ? (
                            <>
                              <span className="text-muted">Maybe </span>
                              <Link href={`/giving/matching/${r.best.id}`} className="crm-link" dir="auto">
                                {r.best.company_name}
                              </Link>
                              <p className="m-0 text-[12px] text-muted">
                                {howText(r.best.how)}
                                {r.candidates > 1 ? ` · ${r.candidates - 1} more ${r.candidates - 1 === 1 ? "entry" : "entries"} with a similar name` : ""}
                              </p>
                            </>
                          ) : (
                            <span className="text-muted">Nothing in the directory has this name yet</span>
                          )}
                        </td>
                        {canLink ? (
                          <td>
                            <div className="flex flex-wrap items-center gap-2">
                              {!entry && r.best ? (
                                <ActionForm action={linkProgramAction} submitLabel={`Link to ${r.best.company_name}`} pendingLabel="Linking" size="xs">
                                  <input type="hidden" name="person_id" value={r.person_id} />
                                  <input type="hidden" name="program_id" value={r.best.id} />
                                  <input type="hidden" name="first_name" value={first} />
                                </ActionForm>
                              ) : null}
                              <Link href={hrefWith("/giving/matching", {}, { person: r.person_id })} className="crm-link text-[13px]">
                                {entry ? "Choose another" : r.best ? "Choose another" : "Search the directory"}
                              </Link>
                              {entry ? (
                                <ActionForm
                                  action={unlinkProgramAction}
                                  submitLabel="Remove link"
                                  pendingLabel="Removing"
                                  size="xs"
                                  variant="ghost"
                                  confirmMessage={`Remove the link between ${first}'s employer and ${entry.company_name}? The employer on file stays.`}
                                >
                                  <input type="hidden" name="person_id" value={r.person_id} />
                                </ActionForm>
                              ) : null}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
            <Pagination page={page} pageSize={QUEUE_PAGE} total={res.data.total} hrefFor={(n) => hrefWith("/giving/matching/employers", base, { page: n > 1 ? String(n) : undefined })} />
          </>
        )}
      </Card>
    </>
  );
}
