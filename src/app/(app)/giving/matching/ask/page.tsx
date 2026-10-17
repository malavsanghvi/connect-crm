import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { MATCHING_DESCRIPTION, MATCHING_TITLE, MatchingNav } from "@/components/matching/matching-nav";
import { Alert, Card, EmptyState, NoAccess, PageHeader, Pagination } from "@/components/ui";
import { householdLine } from "@/lib/care/model";
import { ASK_SENTENCE, askedLine } from "@/lib/matching/ask";
import { ASK_PAGE, loadAskList } from "@/lib/matching/data";
import { emailReadiness } from "@/lib/matching/send-ready";
import { matchingCan } from "@/lib/permissions";
import { hrefWith, pageParam, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { askEmployersAction } from "../actions";

export const metadata: Metadata = { title: "Gift matching: ask for employers" };

// Gift matching › Ask for employers (CatchTheMatch Phase 1, migration 0920): the adults of families that gave in the last 24 months and have
// not given an employer. Staff ask them, through the messaging queue, to add it in the member app, with their consent (0759). The message
// only ASKS; it carries no amount and no gift. Someone who withdrew an employer is never asked again; someone asked is not asked again for 90
// days. Only matching.manage sees this screen; every read is logged.

const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

export default async function AskForEmployersPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = <PageHeader title={MATCHING_TITLE} description={MATCHING_DESCRIPTION} />;
  if (!matchingCan(session, "manage")) {
    return (
      <>
        {header}
        <NoAccess area="Asking families for their employer" access="matching" />
      </>
    );
  }
  const sp = await searchParams;
  const page = pageParam(sp);
  const [res, ready] = await Promise.all([loadAskList(session.db, session.center.id, page), emailReadiness({ memberAppLink: true })]);
  if (!res.ok) {
    return (
      <>
        {header}
        <MatchingNav active="ask" />
        <Alert tone="danger" title="The families to ask could not be loaded">
          {res.error}{" "}
          <Link href={hrefWith("/giving/matching/ask", sp, {})} className="crm-link">
            Try again
          </Link>
        </Alert>
      </>
    );
  }
  const data = res.data;
  const c = data.counts;
  const reachable = c.toAsk - c.nobody;

  return (
    <>
      {header}
      <MatchingNav active="ask" />
      <p className="crm-hint m-0 mb-3 max-w-3xl">
        These are the adults in families that gave in the last 24 months and have not given an employer. The message says: &ldquo;{ASK_SENTENCE}&rdquo; It
        links to the member app, where they add their employer (or not) with their consent. It carries no amount and no gift. Someone who withdrew an employer is never
        asked again, and no one is asked twice in 90 days.
      </p>
      {!ready.ok ? (
        <div className="mb-3">
          <Alert tone="warning" title="Email is not set up, so nothing can be asked yet">
            {ready.error}
          </Alert>
        </div>
      ) : null}
      {data.sandbox ? (
        <div className="mb-3">
          <Alert tone="info" title="This community is a sandbox">
            A sandbox messages only verified test recipients (Settings › Limits), so the others will be reported as not queued.
          </Alert>
        </div>
      ) : null}
      <Card className="mb-3">
        <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-2 text-[13.5px] md:grid-cols-4">
          <div>
            <dt className="text-muted">To ask</dt>
            <dd className="m-0 text-[18px] font-semibold text-ink" data-testid="count-to-ask">{c.toAsk}</dd>
          </div>
          <div>
            <dt className="text-muted">By email</dt>
            <dd className="m-0 text-[18px] font-semibold text-ink">{c.email}</dd>
          </div>
          <div>
            <dt className="text-muted">In the member app</dt>
            <dd className="m-0 text-[18px] font-semibold text-ink">{c.app}</dd>
          </div>
          <div>
            <dt className="text-muted">No way to reach</dt>
            <dd className="m-0 text-[18px] font-semibold text-ink">{c.nobody}</dd>
          </div>
        </dl>
        <p className="m-0 mt-3 text-[12.5px] text-muted">
          Left out: {c.onFile} with an employer on file · {c.withdrew} who withdrew it (never asked again) · {c.recent} asked in the last 90 days.
        </p>
        {reachable > 0 ? (
          <ActionForm
            action={askEmployersAction}
            submitLabel={`Ask ${people(Math.min(reachable, 300))}`}
            pendingLabel="Asking"
            className="mt-3 flex flex-col gap-1"
            confirmMessage={`Ask ${people(Math.min(reachable, 300))} to give their employer? The message is queued to go by email and the member app.${reachable > 300 ? " The first 300 are asked now; ask again for the rest." : ""}`}
          />
        ) : null}
      </Card>
      <Card padded={false}>
        {data.rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title={c.people === 0 ? "No family has given in the last 24 months" : "Everyone has been asked, or has an employer on file"}>
              {c.people === 0
                ? "A family shows here once it has a gift that went through (not an opening balance or a history import)."
                : "Someone shows here again 90 days after being asked, if they still have no employer on file and did not withdraw one."}
            </EmptyState>
          </div>
        ) : (
          <>
            <ul className="m-0 list-none p-0">
              {data.rows.map((r) => (
                <li key={r.person.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-4 py-3 last:border-b-0" data-person={r.person.id}>
                  <div className="min-w-0">
                    <Link href={`/people/${r.person.id}`} className="crm-link font-semibold">
                      {r.person.name}
                    </Link>
                    {r.household ? (
                      <span className="text-[12px] text-muted">
                        {" "}
                        ·{" "}
                        <Link href={`/households/${r.household.id}`} className="crm-link">
                          {r.household.name}
                        </Link>{" "}
                        · {householdLine(r.household)}
                      </span>
                    ) : null}
                    <p className="m-0 text-[12.5px] text-muted">
                      {r.email || r.app ? [r.email ? "Email" : null, r.app ? "Member app" : null].filter(Boolean).join(" and ") : "No email address or member app that can be written to"} ·{" "}
                      {askedLine(r.lastAsked, session.center.time_zone)}
                    </p>
                  </div>
                  {r.email || r.app ? (
                    <ActionForm action={askEmployersAction} submitLabel="Ask" pendingLabel="Asking" size="xs" className="flex flex-col gap-1">
                      <input type="hidden" name="person_id" value={r.person.id} />
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={ASK_PAGE} total={data.total} hrefFor={(n) => hrefWith("/giving/matching/ask", sp, { page: n > 1 ? String(n) : null })} />
          </>
        )}
      </Card>
    </>
  );
}
