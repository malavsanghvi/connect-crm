import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { CopyMessage } from "@/components/matching/copy-message";
import { MATCHING_DESCRIPTION, MATCHING_TITLE, MatchingNav } from "@/components/matching/matching-nav";
import { Alert, Card, ChipLinks, EmptyState, NoAccess, PageHeader, Pagination, buttonClass } from "@/components/ui";
import { formatDay } from "@/lib/care/model";
import { formatCents } from "@/lib/money";
import {
  WHO_SUBMITS_LABEL,
  buildMessage,
  deadlineLine,
  householdLine,
  provenLine,
  type CatchRow,
  type Process,
} from "@/lib/matching/catch";
import { CATCH_PAGE, loadCatchList, loadProcess } from "@/lib/matching/data";
import { matchingCan } from "@/lib/permissions";
import { hrefWith, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { askClaimsAction } from "../actions";

export const metadata: Metadata = { title: "Gift matching: to catch" };

// Gift matching › To catch (CatchTheMatch Phase 1, 0886-0888): the members who gave, whose employer's program has already paid this community
// a match for somebody else, and who have not asked for theirs. A person is only listed through the employer link a member of staff
// confirmed; nothing is guessed from a company name. The office copies the message (the steps from the library, our registered name, the
// dates) and sends it its own way, then marks the member as asked. Amounts show only to a role that also sees giving.

const FILTERS = [
  { key: "catchable", label: "To catch" },
  { key: "missed", label: "Missed" },
] as const;

function Gifts({ row, money }: { row: CatchRow; money: ((c: number) => string) | null }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-[13.5px]">
      {row.gifts.map((g) => (
        <li key={g.paymentId}>
          <span className="font-semibold text-ink">Gift of {formatDay(g.receivedOn)}</span>
          {money && g.amountCents !== null ? <span className="text-ink"> · {money(g.amountCents)}</span> : null}
          <span className={g.daysLeft !== null && g.daysLeft <= 14 ? " font-semibold text-brown" : " text-muted"}> · {deadlineLine(g)}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function CatchPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
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
  const filter = FILTERS.find((f) => f.key === param(sp, "show"))?.key ?? "catchable";
  const page = pageParam(sp);
  const res = await loadCatchList(session.db, session.center.id, filter, page);
  if (!res.ok) {
    return (
      <>
        {header}
        <MatchingNav active="catch" />
        <Alert tone="danger" title="The members to catch could not be loaded">
          {res.error}{" "}
          <Link href={hrefWith("/giving/matching/catch", sp, {})} className="crm-link">
            Try again
          </Link>
        </Alert>
      </>
    );
  }
  const data = res.data;
  const money = data.amounts ? (c: number) => formatCents(c, session.center.currency) : null;

  // The full steps of each program on this page, for the message (the list carries only whether the library has them).
  const programIds = [...new Set(data.rows.map((r) => r.program.id))];
  const loaded = await Promise.all(programIds.map(async (id) => ({ id, res: await loadProcess(session.db, id, session.center.id) })));
  const processes = new Map<string, Process | null>(loaded.flatMap((l) => (l.res.ok ? [[l.id, l.res.data.process] as const] : [])));
  const failedLoad = loaded.find((l) => !l.res.ok);
  const processError = failedLoad && !failedLoad.res.ok ? failedLoad.res.error : null;

  const chips = FILTERS.map((f) => ({
    key: f.key,
    label: `${f.label} (${f.key === "catchable" ? data.counts.catchable : data.counts.missed})`,
    href: hrefWith("/giving/matching/catch", sp, { show: f.key === "catchable" ? null : f.key, page: null }),
  }));

  return (
    <>
      {header}
      <MatchingNav active="catch" />
      <p className="crm-hint m-0 mb-3 max-w-3xl">
        When an employer&apos;s program has paid {data.org.name} a match, its other members who gave and have not asked show here, with the steps that worked. Send the
        message from here, or copy it, send it your own way and mark the member as asked.
      </p>
      <ChipLinks label="Show" items={chips} active={filter} />
      {processError ? (
        <div className="mt-3">
          <Alert tone="warning" title="Some steps could not be loaded">
            {processError} The messages below say to ask the employer&apos;s matching program, without the steps. Reload the page to try again.
          </Alert>
        </div>
      ) : null}
      <Card padded={false} className="mt-3">
        {data.rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={
                filter === "missed"
                  ? "Nothing was missed."
                  : data.counts.catchable === 0 && data.counts.ended === 0
                    ? "No employer has paid a match here yet."
                    : "Everyone who can still ask has been asked."
              }
            >
              {filter === "catchable" && data.counts.ended === 0 ? (
                <>
                  A member shows here once another member with the same employer&apos;s program had a match paid to {data.org.name}. Record the first match under{" "}
                  <Link href="/giving/matching/claims" className="crm-link">
                    Claims
                  </Link>{" "}
                  (from a person on <Link href="/giving/matching/employers" className="crm-link">Employers on file</Link>) and the rest follow.
                </>
              ) : null}
            </EmptyState>
          </div>
        ) : (
          <>
            <ul className="m-0 list-none p-0">
              {data.rows.map((r) => {
                const first = r.person.name.split(" ")[0] ?? r.person.name;
                const process = processes.get(r.program.id) ?? null;
                const message = buildMessage({
                  firstName: first,
                  employer: r.employer,
                  program: r.program.companyName,
                  org: data.org,
                  portalUrl: r.program.portalUrl,
                  process,
                  gifts: r.gifts,
                });
                return (
                  <li key={`${r.person.id}-${r.program.id}`} className="flex flex-col gap-2 border-b border-line-soft px-4 py-3 last:border-b-0" data-person={r.person.id}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
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
                      </div>
                      <p className="m-0 text-[13px] text-muted" dir="auto">
                        Works at {r.employer}
                      </p>
                    </div>
                    <p className="m-0 text-[13.5px] text-ink">
                      <Link href={`/giving/matching/${r.program.id}`} className="crm-link font-semibold" dir="auto">
                        {r.program.companyName}
                      </Link>{" "}
                      · {provenLine(r.program.companyName, r.provenReceived, r.provenLastOn)}
                    </p>
                    <Gifts row={r} money={money} />
                    <p className="m-0 text-[12.5px] text-muted">
                      {r.process ? (
                        <>
                          Steps in the library: {WHO_SUBMITS_LABEL[r.process.whoSubmits].toLowerCase()}.{" "}
                          <Link href={`/giving/matching/${r.program.id}`} className="crm-link">
                            Read them
                          </Link>
                        </>
                      ) : (
                        "The library has no steps for this employer yet, so the message tells the member to ask the employer's matching program."
                      )}
                    </p>
                    {filter === "catchable" ? (
                      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div className="md:max-w-[520px] md:flex-1">
                          <CopyMessage text={message} />
                        </div>
                        {data.canManage ? (
                          <div className="flex flex-col items-start gap-2">
                            <Link href={`/giving/matching/send?person=${r.person.id}&program=${r.program.id}`} className={buttonClass("primary", "sm")}>
                              Send to the member
                            </Link>
                            <ActionForm action={askClaimsAction} submitLabel="Mark as asked" pendingLabel="Saving" size="sm" variant="secondary" className="flex flex-col gap-1">
                              <input type="hidden" name="person_id" value={r.person.id} />
                              <input type="hidden" name="program_id" value={r.program.id} />
                              <input type="hidden" name="first_name" value={first} />
                            </ActionForm>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <Pagination page={page} pageSize={CATCH_PAGE} total={data.total} hrefFor={(n) => hrefWith("/giving/matching/catch", sp, { page: n > 1 ? String(n) : null })} />
          </>
        )}
      </Card>
    </>
  );
}
