import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { CopyMessage } from "@/components/matching/copy-message";
import { MATCHING_DESCRIPTION, MATCHING_TITLE, MatchingNav } from "@/components/matching/matching-nav";
import { Alert, Card, NoAccess, PageHeader } from "@/components/ui";
import { formatDay } from "@/lib/care/model";
import { loadClaimMessage } from "@/lib/matching/data";
import { reachLine } from "@/lib/matching/send";
import { emailReadiness } from "@/lib/matching/send-ready";
import { matchingCan } from "@/lib/permissions";
import { isUuid, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { sendClaimMessageAction } from "../actions";

export const metadata: Metadata = { title: "Gift matching: send the message" };

// Gift matching › Send to the member (CatchTheMatch Phase 1, migration 0921): the exact message for one member, built in the database from the
// library, and a button that queues it through the messaging queue. The screen shows what will go; it cannot change it. Nothing is sent from
// here when the email provider is not set up (the page says so first). No amount in the message.

export default async function SendClaimMessagePage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = <PageHeader title={MATCHING_TITLE} description={MATCHING_DESCRIPTION} />;
  if (!matchingCan(session, "manage")) {
    return (
      <>
        {header}
        <NoAccess area="Sending the gift matching message" access="matching" />
      </>
    );
  }
  const sp = await searchParams;
  const personId = param(sp, "person") ?? "";
  const programId = param(sp, "program") ?? "";
  if (!isUuid(personId) || !isUuid(programId)) {
    return (
      <>
        {header}
        <MatchingNav active="catch" />
        <Alert tone="danger" title="That member was not found">
          Open the member from <Link href="/giving/matching/catch" className="crm-link">To catch</Link> or{" "}
          <Link href="/giving/matching/claims" className="crm-link">Claims</Link> and choose Send to the member.
        </Alert>
      </>
    );
  }
  const [res, ready] = await Promise.all([loadClaimMessage(session.db, session.center.id, personId, programId), emailReadiness({ memberAppLink: false })]);
  if (!res.ok) {
    return (
      <>
        {header}
        <MatchingNav active="catch" />
        <Alert tone="danger" title="The message could not be prepared">
          {res.error}{" "}
          <Link href={`/giving/matching/send?person=${personId}&program=${programId}`} className="crm-link">
            Try again
          </Link>
        </Alert>
      </>
    );
  }
  const m = res.data;
  const first = m.person.name.split(" ")[0] ?? m.person.name;
  const canSend = m.problem === null && ready.ok && m.body !== null;

  return (
    <>
      {header}
      <MatchingNav active="catch" />
      <p className="crm-hint m-0 mb-3 max-w-3xl">
        <Link href="/giving/matching/catch" className="crm-link">
          ← To catch
        </Link>
      </p>
      <Card>
        <h2 className="m-0 font-display text-[20px] font-semibold text-ink">
          Send to {m.person.name}
        </h2>
        <p className="m-0 mt-1 text-[13.5px] text-muted" dir="auto">
          {m.employer ? `Works at ${m.employer} · ` : ""}
          <Link href={`/giving/matching/${m.program.id}`} className="crm-link">
            {m.program.companyName}
          </Link>
        </p>
        <p className="m-0 mt-2 text-[13.5px] text-ink">
          <span className="font-semibold">{reachLine(m)}.</span>{" "}
          {m.gifts.length > 0 ? (
            <>
              About {m.gifts.length === 1 ? "this gift" : `these ${m.gifts.length} gifts`}:{" "}
              {m.gifts.map((g) => `${formatDay(g.receivedOn)}${g.deadlineOn ? ` (ask by ${formatDay(g.deadlineOn)})` : ""}`).join("; ")}.
            </>
          ) : null}
        </p>
      </Card>
      {!ready.ok ? (
        <div className="mt-3">
          <Alert tone="warning" title="Email is not set up, so nothing can be sent from here yet">
            {ready.error} You can copy the message below and send it another way.
          </Alert>
        </div>
      ) : null}
      {m.sandbox ? (
        <div className="mt-3">
          <Alert tone="info" title="This community is a sandbox">
            A sandbox messages only verified test recipients (Settings › Limits), so this message will be reported as not queued for anyone else.
          </Alert>
        </div>
      ) : null}
      {m.problem ? (
        <div className="mt-3">
          <Alert tone="warning" title="It cannot be sent">
            {m.problem}
          </Alert>
        </div>
      ) : null}
      {m.body ? (
        <Card className="mt-3">
          <p className="m-0 text-[12.5px] font-semibold uppercase tracking-wide text-muted">The message, exactly as it will go</p>
          {m.subject ? (
            <p className="m-0 mt-2 text-[13.5px] text-ink">
              <span className="text-muted">Subject: </span>
              {m.subject}
            </p>
          ) : null}
          <pre className="mt-2 whitespace-pre-wrap rounded-field border border-line-soft bg-surface-2 p-3 font-sans text-[13.5px] text-ink" data-testid="message-body">
            {m.body}
          </pre>
          <p className="m-0 mt-2 text-[12.5px] text-muted">
            It carries no amount. It is built from the library and cannot be edited here; to change the steps, ask Weaver&apos;s team to update How to claim.
          </p>
          <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            {canSend ? (
              <ActionForm action={sendClaimMessageAction} submitLabel={`Send to ${first}`} pendingLabel="Sending" className="flex flex-col gap-1">
                <input type="hidden" name="person_id" value={m.person.id} />
                <input type="hidden" name="program_id" value={m.program.id} />
                <input type="hidden" name="first_name" value={first} />
              </ActionForm>
            ) : null}
            <div className="md:max-w-[420px] md:flex-1">
              <CopyMessage text={m.body} label="Copy the message instead" />
            </div>
          </div>
        </Card>
      ) : null}
    </>
  );
}
