import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { MATCHING_DESCRIPTION, MATCHING_TITLE, MatchingNav } from "@/components/matching/matching-nav";
import { ProgramFacts } from "@/components/matching/program-facts";
import { ProgramFields } from "@/components/matching/program-fields";
import { Alert, Card, EmptyState, Field, NoAccess, PageHeader, StatusText } from "@/components/ui";
import { loadProgram, ownsVerification, programNames } from "@/lib/matching/data";
import { statusText, verifiedText } from "@/lib/matching/directory";
import { matchingCan } from "@/lib/permissions";
import { isUuid } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { submitProgramAction } from "../actions";

export const metadata: Metadata = { title: "Gift matching entry" };

/** One employer's matching program, as members and staff read it, and the form to tell the directory what changed. */
export default async function GiftMatchingEntryPage({ params }: { params: Promise<{ id: string }> }) {
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
  const { id } = await params;
  if (!isUuid(id)) {
    return (
      <>
        {header}
        <MatchingNav active="directory" />
        <Card>
          <EmptyState title="That directory entry was not found">
            <Link href="/giving/matching" className="crm-link">
              Back to the directory
            </Link>
          </EmptyState>
        </Card>
      </>
    );
  }
  const res = await loadProgram(session.db, id);
  if (!res.ok || !res.data) {
    return (
      <>
        {header}
        <MatchingNav active="directory" />
        {res.ok ? (
          <Card>
            <EmptyState title="That directory entry was not found">
              <Link href="/giving/matching" className="crm-link">
                Back to the directory
              </Link>
            </EmptyState>
          </Card>
        ) : (
          <Alert tone="danger" title="The directory entry could not be loaded">
            {res.error}{" "}
            <Link href={`/giving/matching/${id}`} className="crm-link">
              Try again
            </Link>
          </Alert>
        )}
      </>
    );
  }
  const { program: g, names } = res.data;
  const others = names.filter((n) => !n.is_primary).map((n) => n.name);
  const [own, merged] = await Promise.all([
    g.verified_by_kind === "community" ? ownsVerification(session.db, g.verified_submission_id) : Promise.resolve(false),
    g.merged_into ? programNames(session.db, [g.merged_into]) : Promise.resolve(null),
  ]);
  const mergedName = merged && merged.ok && g.merged_into ? merged.data.get(g.merged_into)?.company_name : null;
  const checked = verifiedText({ kind: g.verified_by_kind, on: g.last_verified_on, ownCommunity: own });

  return (
    <>
      {header}
      <MatchingNav active="directory" />
      <Card>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="m-0 font-display text-[22px] font-semibold text-ink" dir="auto">
            {g.company_name}
          </h2>
          <StatusText tone={g.status === "active" ? "ok" : "warn"}>{statusText(g.status)}</StatusText>
        </div>
        {g.status === "merged" && g.merged_into ? (
          <div className="mb-3">
            <Alert tone="info" title="This entry was merged into another">
              <Link href={`/giving/matching/${g.merged_into}`} className="crm-link">
                Open {mergedName ?? "the entry it joined"}
              </Link>
            </Alert>
          </div>
        ) : null}
        {g.status === "retired" ? (
          <div className="mb-3">
            <Alert tone="warning" title="This program has ended">
              {g.status_reason ?? "Weaver's team marked it as ended."} It cannot be chosen for an employer on file.
            </Alert>
          </div>
        ) : null}
        <p className="m-0 mb-3 text-[13px] text-muted" data-testid="checked">
          {checked}
        </p>
        <ProgramFacts facts={g} names={others} />
      </Card>
      {g.status !== "merged" ? (
        <Card title="Something changed?" className="mt-4">
          <details>
            <summary className="cursor-pointer text-[13.5px] font-bold text-[var(--v2-blue)]">Tell the directory what a member told you</summary>
            <ActionForm action={submitProgramAction} submitLabel="Send" pendingLabel="Sending" size="sm" className="mt-3 flex flex-col gap-3">
              <input type="hidden" name="program_id" value={g.id} />
              <input type="hidden" name="source" value={g.source} />
              <p className="crm-hint m-0">
                The form starts with what the directory says now. Change what is different. A CatchTheMatch manager checks it before it reaches the
                directory{g.verified_by_kind === "weaver" ? ", and because Weaver's team checked this entry, they decide on the change" : ""}.
              </p>
              <ProgramFields idPrefix={`suggest-${g.id}`} initial={{ ...g, names: others }} context="community" />
              <Field label="Anything else they said (optional)" htmlFor={`suggest-${g.id}-note`} hint="Facts about the program only, no names.">
                <textarea id={`suggest-${g.id}-note`} name="note" className="crm-input w-full" rows={2} maxLength={1000} />
              </Field>
            </ActionForm>
          </details>
        </Card>
      ) : null}
    </>
  );
}
