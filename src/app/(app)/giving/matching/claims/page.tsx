import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { MATCHING_DESCRIPTION, MATCHING_TITLE, MatchingNav } from "@/components/matching/matching-nav";
import { Alert, Card, ChipLinks, EmptyState, NoAccess, PageHeader, Pagination, TableWrap } from "@/components/ui";
import { formatDay } from "@/lib/care/model";
import { formatCents } from "@/lib/money";
import { CLAIM_MOVE_LABEL, CLAIM_STATE_LABEL, claimMoves, householdLine, type ClaimRow } from "@/lib/matching/catch";
import { CATCH_PAGE, loadCatchList, loadClaimsList } from "@/lib/matching/data";
import { matchingCan } from "@/lib/permissions";
import { hrefWith, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { setClaimStateAction } from "../actions";

export const metadata: Metadata = { title: "Gift matching: claims" };

// Gift matching › Claims (CatchTheMatch Phase 1, 0886-0888): where each member's request stands, from "asked" to "match received", or closed
// without one. A CatchTheMatch manager moves a claim on; a claim that ended can only be opened again (it was a mistake). No match amount is
// recorded in Phase 1: the match payment itself goes into Giving the usual way.

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "ended", label: "Ended" },
] as const;

function Mover({ claim }: { claim: ClaimRow }) {
  const moves = claimMoves(claim.state);
  return (
    <ActionForm action={setClaimStateAction} submitLabel="Update" pendingLabel="Saving" size="xs" className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="claim_id" value={claim.id} />
      <label className="sr-only" htmlFor={`state-${claim.id}`}>
        Where this claim stands
      </label>
      <select id={`state-${claim.id}`} name="state" className="crm-input" defaultValue={moves[0]}>
        {moves.map((m) => (
          <option key={m} value={m}>
            {CLAIM_MOVE_LABEL[m]}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor={`note-${claim.id}`}>
        Note (optional)
      </label>
      <input id={`note-${claim.id}`} name="note" className="crm-input" placeholder="Note (optional)" maxLength={500} />
    </ActionForm>
  );
}

export default async function ClaimsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
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
  const filter = FILTERS.find((f) => f.key === param(sp, "show"))?.key ?? "open";
  const page = pageParam(sp);
  const [res, counts] = await Promise.all([loadClaimsList(session.db, session.center.id, filter, page), loadCatchList(session.db, session.center.id, "catchable", 1)]);
  if (!res.ok) {
    return (
      <>
        {header}
        <MatchingNav active="claims" />
        <Alert tone="danger" title="The claims could not be loaded">
          {res.error}{" "}
          <Link href={hrefWith("/giving/matching/claims", sp, {})} className="crm-link">
            Try again
          </Link>
        </Alert>
      </>
    );
  }
  const data = res.data;
  const money = data.amounts ? (c: number) => formatCents(c, session.center.currency) : null;
  const n = counts.ok ? counts.data.counts : null;
  const chips = FILTERS.map((f) => ({
    key: f.key,
    label: `${f.label}${n ? ` (${f.key === "open" ? n.open : n.ended})` : ""}`,
    href: hrefWith("/giving/matching/claims", sp, { show: f.key === "open" ? null : f.key, page: null }),
  }));

  return (
    <>
      {header}
      <MatchingNav active="claims" />
      <p className="crm-hint m-0 mb-3 max-w-3xl">
        Each claim is one gift and the employer program that may match it. Mark where it stands as the member and the employer move.
        {data.canManage ? (
          <>
            {" "}
            To record a match somebody already got, open a person on{" "}
            <Link href="/giving/matching/employers" className="crm-link">
              Employers on file
            </Link>{" "}
            and choose Record a match.
          </>
        ) : null}
      </p>
      <ChipLinks label="Show" items={chips} active={filter} />
      {counts.ok ? null : (
        <div className="mt-3">
          <Alert tone="warning" title="The counts could not be loaded">
            {counts.error} The list below is complete. Reload the page to try again.
          </Alert>
        </div>
      )}
      <Card padded={false} className="mt-3">
        {data.rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title={filter === "open" ? "No claim is open." : "No claim has ended yet."} />
          </div>
        ) : (
          <>
            <TableWrap>
              <table className="crm-table" aria-label="Gift match claims">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Employer program</th>
                    <th>Gift</th>
                    <th>Where it stands</th>
                    {data.canManage ? <th aria-label="Update" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((c) => (
                    <tr key={c.id} data-claim={c.id}>
                      <td>
                        <Link href={`/people/${c.person.id}`} className="crm-link font-semibold">
                          {c.person.name}
                        </Link>
                        {c.household ? <p className="m-0 text-[12px] text-muted">{c.household.name} · {householdLine(c.household)}</p> : null}
                      </td>
                      <td>
                        <Link href={`/giving/matching/${c.program.id}`} className="crm-link" dir="auto">
                          {c.program.companyName}
                        </Link>
                      </td>
                      <td>
                        {formatDay(c.gift.receivedOn)}
                        {money && c.gift.amountCents !== null ? <span> · {money(c.gift.amountCents)}</span> : null}
                        {c.deadlineOn ? <p className="m-0 text-[12px] text-muted">Ask by {formatDay(c.deadlineOn)}</p> : null}
                      </td>
                      <td>
                        <span className="font-semibold text-ink">{CLAIM_STATE_LABEL[c.state]}</span>
                        <p className="m-0 text-[12px] text-muted">
                          {c.state === "received" && c.receivedOn ? `Received ${formatDay(c.receivedOn)}` : `Since ${formatDay(c.stateAt.slice(0, 10))}`}
                        </p>
                        {c.requestedByMemberAt ? (
                          <p className="m-0 text-[12px] font-semibold text-ink" data-testid="reported-by-member">
                            The member says they asked their employer ({formatDay(c.requestedByMemberAt.slice(0, 10))})
                          </p>
                        ) : null}
                        {c.askedByMessageAt ? <p className="m-0 text-[12px] text-muted">Asked by message on {formatDay(c.askedByMessageAt.slice(0, 10))}</p> : null}
                        {c.note ? <p className="m-0 text-[12px] text-ink">{c.note}</p> : null}
                      </td>
                      {data.canManage ? (
                        <td>
                          <Mover claim={c} />
                          {c.state === "asked" ? (
                            <Link href={`/giving/matching/send?person=${c.person.id}&program=${c.program.id}`} className="crm-link mt-1 inline-block text-[13px]">
                              {c.askedByMessageAt ? "Send a reminder" : "Send to the member"}
                            </Link>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <Pagination page={page} pageSize={CATCH_PAGE} total={data.total} hrefFor={(p) => hrefWith("/giving/matching/claims", sp, { page: p > 1 ? String(p) : null })} />
          </>
        )}
      </Card>
    </>
  );
}
