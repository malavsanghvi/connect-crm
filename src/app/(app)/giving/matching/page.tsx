import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { MATCHING_DESCRIPTION, MATCHING_TITLE, MatchingNav } from "@/components/matching/matching-nav";
import { Alert, Card, ChipLinks, EmptyState, NoAccess, PageHeader, Pagination, TableWrap, buttonClass } from "@/components/ui";
import { SEARCH_PAGE, loadCandidates, searchDirectory } from "@/lib/matching/data";
import { RELIGIOUS_LABEL, howText, moneyText, portalLabel, ratioInput, verifiedText, type ReligiousRule } from "@/lib/matching/directory";
import { matchingCan } from "@/lib/permissions";
import { hrefWith, isUuid, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { linkProgramAction } from "./actions";

export const metadata: Metadata = { title: "Gift matching" };

const STATUSES = [
  { key: "active", label: "Active" },
  { key: "retired", label: "Ended" },
  { key: "all", label: "All" },
] as const;

function religiousShort(rule: string | null): string {
  return rule === "eligible" || rule === "non_worship_only" || rule === "excluded" ? RELIGIOUS_LABEL[rule as ReligiousRule] : "Not known yet";
}

/**
 * Gift matching › Directory: the employers' matching programs every community that uses CatchTheMatch shares. Search by any
 * name the company goes by, in any script. With ?person= (from Employers on file) a CatchTheMatch manager links that
 * person's employer to the entry they choose.
 */
export default async function GiftMatchingPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
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
  const statusParam = param(sp, "status");
  const status = STATUSES.find((s) => s.key === statusParam)?.key ?? "active";
  const page = pageParam(sp);
  const personParam = param(sp, "person");
  const person = isUuid(personParam) && matchingCan(session, "manage") ? personParam : null;
  // Choosing the entry for one person's employer: the search starts from the employer on file, read here (never put in the
  // address: it is the person's own CatchTheMatch data).
  const pick = person ? await loadCandidates(session.db, session.center.id, person) : null;
  const typed = param(sp, "q");
  const q = (typed ?? (pick && pick.ok ? (pick.data.employer ?? "") : "")).trim().slice(0, 160);
  const res = await searchDirectory(session.db, q, status, page);
  const base = { q: typed ? q : undefined, status: status === "active" ? undefined : status, person: person ?? undefined };

  return (
    <>
      {header}
      <MatchingNav active="directory" />
      {pick && !pick.ok ? (
        <div className="mb-3">
          <Alert tone="danger" title="The employer to link could not be loaded">
            {pick.error} Go back to Employers on file and try again.
          </Alert>
        </div>
      ) : null}
      {pick && pick.ok && pick.data.employer ? (
        <div className="mb-3">
          <Alert tone="info" title={`Choosing the entry for "${pick.data.employer}"`}>
            {typed ? "" : "These are the entries with a similar name. "}Search for another name if it is not here, then choose Link on its row. The
            employer on file does not change.{" "}
            <Link href="/giving/matching/employers" className="crm-link">
              Back to Employers on file
            </Link>
          </Alert>
        </div>
      ) : null}
      <form method="get" action="/giving/matching" className="mb-3 flex flex-wrap items-end gap-3" role="search">
        <div>
          <label htmlFor="matching-q" className="crm-label">
            Company
          </label>
          <input id="matching-q" name="q" className="crm-input w-72" defaultValue={typed ?? ""} placeholder="Any name it goes by" dir="auto" />
        </div>
        {status !== "active" ? <input type="hidden" name="status" value={status} /> : null}
        {person ? <input type="hidden" name="person" value={person} /> : null}
        <button type="submit" className={buttonClass("ghost")}>
          Search
        </button>
      </form>
      <ChipLinks label="Entry status" active={status} items={STATUSES.map((s) => ({ key: s.key, label: s.label, href: hrefWith("/giving/matching", { ...base }, { status: s.key === "active" ? undefined : s.key }) }))} />
      <Card padded={false}>
        {!res.ok ? (
          <div className="p-4">
            <Alert tone="danger" title="The directory could not be loaded">
              {res.error}{" "}
              <Link href={hrefWith("/giving/matching", base, {})} className="crm-link">
                Try again
              </Link>
            </Alert>
          </div>
        ) : res.data.rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title={q ? `Nothing in the directory is called "${q}"` : "The directory is empty so far"}>
              Weaver&apos;s team adds employers&apos; programs from their own pages. If a member told you about their employer&apos;s program,{" "}
              <Link href="/giving/matching/submissions#send" className="crm-link">
                send what they said
              </Link>{" "}
              and a CatchTheMatch manager checks it.
            </EmptyState>
          </div>
        ) : (
          <>
            <TableWrap>
              <table className="crm-table" aria-label="Employers' matching programs">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Country</th>
                    <th>Ratio</th>
                    <th className="num">Most per year</th>
                    <th>Where to ask</th>
                    <th>Religious organizations</th>
                    <th>Checked</th>
                    {person ? <th aria-label="Link" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {res.data.rows.map((r) => (
                    <tr key={r.id} data-program={r.id}>
                      <td className="font-bold">
                        <Link href={`/giving/matching/${r.id}`} className="crm-link" dir="auto">
                          {r.company_name}
                        </Link>
                        {r.matched_name && r.matched_name !== r.company_name ? (
                          <p className="m-0 text-[12px] font-normal text-muted" dir="auto">
                            Found as {r.matched_name}
                          </p>
                        ) : null}
                        {r.status === "retired" ? <p className="m-0 text-[12px] font-normal text-muted">Ended</p> : null}
                      </td>
                      <td>{r.country ?? "Any"}</td>
                      <td>{r.gift_match ? (r.match_ratio_bp ? `${ratioInput(r.match_ratio_bp)}:1` : "Not known") : "Volunteer grants only"}</td>
                      <td className="num">{r.gift_match ? moneyText(r.max_year_cents, r.currency) : "—"}</td>
                      <td>{portalLabel(r.portal)}</td>
                      <td>{religiousShort(r.religious_orgs)}</td>
                      <td className="text-[13px]">{verifiedText({ kind: r.verified_by_kind, on: r.last_verified_on })}</td>
                      {person ? (
                        <td>
                          {r.status === "active" ? (
                            <ActionForm action={linkProgramAction} submitLabel="Link" pendingLabel="Linking" size="xs" variant="ghost">
                              <input type="hidden" name="person_id" value={person} />
                              <input type="hidden" name="program_id" value={r.id} />
                              {r.how ? <span className="sr-only">{howText(r.how)}</span> : null}
                            </ActionForm>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <Pagination page={page} pageSize={SEARCH_PAGE} total={res.data.total} hrefFor={(n) => hrefWith("/giving/matching", base, { page: n > 1 ? String(n) : undefined })} />
          </>
        )}
      </Card>
    </>
  );
}
