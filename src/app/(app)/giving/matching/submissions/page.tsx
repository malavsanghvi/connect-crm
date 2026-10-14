import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { DecisionForms, type DuplicateChoice } from "@/components/matching/decision-forms";
import { MATCHING_DESCRIPTION, MATCHING_TITLE, MatchingNav } from "@/components/matching/matching-nav";
import { ProgramFacts } from "@/components/matching/program-facts";
import { ProgramFields } from "@/components/matching/program-fields";
import { Alert, Card, ChipLinks, EmptyState, Field, NoAccess, PageHeader, StatusText } from "@/components/ui";
import { userNames } from "@/lib/data/lookups";
import { formatDate } from "@/lib/dates";
import {
  SUBMISSION_VIEWS,
  loadPublishingState,
  loadSubmissions,
  ownSubmissionIds,
  programNames,
  searchDirectory,
  type ProgramBrief,
  type SubmissionRow,
  type SubmissionView,
} from "@/lib/matching/data";
import { factsAsRow, forwardReasonText, submissionStatusText } from "@/lib/matching/directory";
import { matchingCan } from "@/lib/permissions";
import { param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { decideSubmissionAction, submitProgramAction } from "../actions";

export const metadata: Metadata = { title: "Gift matching submissions" };

/** What approving does, said before the manager approves (the database decides: app.decide_match_submission, 0766). */
function approveHint(target: ProgramBrief | null | undefined, ownCheck: boolean, paused: boolean): string {
  if (paused) return "Weaver's team has paused publishing from your community for now, so approving sends it to them, with your edits.";
  if (!target) {
    return "Approving adds it to the directory for every community at once, marked verified by your community today. If it has a link, or its name is close to an entry Weaver's team checked, it goes to them instead.";
  }
  if (target.status !== "active") return "This entry has ended in the directory, so approving sends the change to Weaver's team.";
  if (target.verified_by_kind === "weaver") return "Weaver's team checked this entry, so approving sends the change to them, with your edits.";
  if (!ownCheck) return "Another community verified this entry, so approving sends the change to Weaver's team, with your edits.";
  return "Your community verified this entry, so approving changes it for every community at once. A new or changed link, or a new name close to an entry Weaver's team checked, goes to them instead.";
}

/** How many waiting submissions get their look-alikes searched (for "It is a duplicate"). */
const DUPLICATE_LOOKUPS = 20;

function statusTone(status: string): "ok" | "warn" | "bad" {
  if (status === "approved") return "ok";
  if (status === "rejected") return "bad";
  return "warn";
}

/**
 * Gift matching › Submissions: what members told this community about their employers' programs. Anyone with a
 * CatchTheMatch role sends one; a CatchTheMatch manager checks it: approving publishes it to the shared directory at once,
 * marked verified by this community, except a change to an entry Weaver's team checked, which goes to them.
 */
export default async function GiftMatchingSubmissionsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
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
  const viewParam = param(sp, "view");
  const view: SubmissionView = SUBMISSION_VIEWS.find((v) => v.key === viewParam)?.key ?? "open";
  const canDecide = matchingCan(session, "manage");
  const tz = session.center.time_zone;

  const res = await loadSubmissions(session.db, session.center.id, view);
  const rows: SubmissionRow[] = res.ok ? res.data : [];
  const [people, entries, publishing] = await Promise.all([
    userNames(session.db, session.center.id, rows.flatMap((r) => [r.submitted_by, r.decided_kind === "community" ? r.decided_by : null])),
    programNames(session.db, rows.flatMap((r) => [r.program_id, r.result_program_id])),
    loadPublishingState(session.db, session.center.id),
  ]);
  const entryMap = entries.ok ? entries.data : new Map<string, ProgramBrief>();
  const ownChecks = await ownSubmissionIds(session.db, session.center.id, [...entryMap.values()].map((e) => e.verified_submission_id));
  const paused = publishing.ok && publishing.data.paused;

  // Look-alikes for "It is a duplicate": directory entries found by the submission's name, and the other waiting submissions.
  const waiting = rows.filter((r) => r.status === "pending");
  const lookups = canDecide
    ? await Promise.all(
        waiting.slice(0, DUPLICATE_LOOKUPS).map(async (r) => {
          const name = factsAsRow(r.proposal).company_name;
          const found = name ? await searchDirectory(session.db, name, "active", 1) : null;
          return [r.id, found && found.ok ? found.data.rows.slice(0, 10) : []] as const;
        }),
      )
    : [];
  const lookalikes = new Map(lookups);

  return (
    <>
      {header}
      <MatchingNav active="submissions" />
      <Card id="send" title="Send what a member told you" description="About an employer that is not in the directory yet. For one that is, open its entry and choose Tell the directory what a member told you.">
        <details>
          <summary className="cursor-pointer text-[13.5px] font-bold text-[var(--v2-blue)]">Add an employer&apos;s program</summary>
          <ActionForm action={submitProgramAction} submitLabel="Send" pendingLabel="Sending" size="sm" className="mt-3 flex flex-col gap-3" resetOnSuccess>
            <ProgramFields idPrefix="send-new" context="community" />
            <Field label="Anything else they said (optional)" htmlFor="send-new-note" hint="Facts about the program only, no names.">
              <textarea id="send-new-note" name="note" className="crm-input w-full" rows={2} maxLength={1000} />
            </Field>
          </ActionForm>
        </details>
      </Card>

      {!publishing.ok ? (
        <div className="mt-4">
          <Alert tone="warning" title="Whether your community can publish could not be loaded">
            {publishing.error} Approving still works; the database applies the limits. Reload the page to try again.
          </Alert>
        </div>
      ) : publishing.data.paused ? (
        <div className="mt-4">
          <Alert tone="warning" title="Weaver's team has paused publishing from your community">
            {publishing.data.pause_reason ?? "Weaver's team is checking recent changes."} Approvals go to Weaver&apos;s team until they resume it.
          </Alert>
        </div>
      ) : canDecide ? (
        <p className="crm-hint mt-4">
          Your community can publish {publishing.data.daily_cap} approvals a day to the shared directory; {publishing.data.published_today} today so far.
        </p>
      ) : null}
      <div className="mt-4">
        <ChipLinks label="Submission status" active={view} items={SUBMISSION_VIEWS.map((v) => ({ key: v.key, label: v.label, href: v.key === "open" ? "/giving/matching/submissions" : `/giving/matching/submissions?view=${v.key}` }))} />
      </div>
      {!res.ok ? (
        <Alert tone="danger" title="The submissions could not be loaded">
          {res.error}{" "}
          <Link href={`/giving/matching/submissions${view === "open" ? "" : `?view=${view}`}`} className="crm-link">
            Try again
          </Link>
        </Alert>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState title={view === "open" ? "Nothing is waiting for a decision" : "No submissions here"} />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {!entries.ok ? (
            <Alert tone="warning" title="The directory entries these submissions name could not be loaded">
              {entries.error} The submissions are shown without them; reload the page to try again.
            </Alert>
          ) : null}
          {rows.map((r) => {
            const shown = factsAsRow(r.reviewed ?? r.proposal);
            const target = r.program_id ? entryMap.get(r.program_id) : null;
            const result = r.result_program_id ? entryMap.get(r.result_program_id) : null;
            const by = people.get(r.submitted_by)?.name ?? "Someone in your community";
            const decidedBy = r.decided_kind === "weaver" ? "Weaver's team" : r.decided_by ? (people.get(r.decided_by)?.name ?? "A CatchTheMatch manager") : null;
            const found = lookalikes.get(r.id) ?? [];
            const duplicates: DuplicateChoice[] = [
              ...found.filter((e) => e.id !== r.program_id).map((e) => ({ value: `entry:${e.id}`, label: `Directory: ${e.company_name}${e.country ? ` (${e.country})` : ""}` })),
              ...waiting.filter((w) => w.id !== r.id).map((w) => ({ value: `submission:${w.id}`, label: `Submission: ${factsAsRow(w.proposal).company_name}, sent ${formatDate(w.submitted_at, tz)}` })),
            ];
            const hint = approveHint(target, Boolean(target?.verified_submission_id && ownChecks.has(target.verified_submission_id)), paused);
            return (
              <Card key={r.id}>
                <div data-submission={r.id} data-status={r.status}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="m-0 text-[16px] font-bold text-ink" dir="auto">
                      {shown.company_name || "A company"}
                    </h3>
                    <StatusText tone={statusTone(r.status)}>{submissionStatusText(r.status)}</StatusText>
                  </div>
                  <p className="m-0 mt-0.5 text-[13px] text-muted">
                    {target ? (
                      <>
                        A change to{" "}
                        <Link href={`/giving/matching/${r.program_id}`} className="crm-link">
                          {target.company_name}
                        </Link>
                      </>
                    ) : (
                      "A company not in the directory yet"
                    )}{" "}
                    · sent by {by} on {formatDate(r.submitted_at, tz)}
                    {r.channel === "member_app" ? " from the member app" : ""}
                  </p>
                  {r.note ? <p className="m-0 mt-2 whitespace-pre-line text-[13.5px] text-ink">&ldquo;{r.note}&rdquo;</p> : null}
                  {r.status === "forwarded" ? (
                    <p className="m-0 mt-2 text-[13px] text-muted">
                      With Weaver&apos;s team because {forwardReasonText(r.forwarded_because)}.
                      {r.forward_note ? ` Your manager's note to them: ${r.forward_note}` : ""}
                    </p>
                  ) : null}
                  {decidedBy && r.decided_at ? (
                    <p className="m-0 mt-2 text-[13px] text-muted">
                      {submissionStatusText(r.status)} by {decidedBy} on {formatDate(r.decided_at, tz)}
                      {r.decision_reason ? `: ${r.decision_reason}` : "."}{" "}
                      {result ? (
                        <Link href={`/giving/matching/${r.result_program_id}`} className="crm-link">
                          Open {result.company_name}
                        </Link>
                      ) : null}
                    </p>
                  ) : null}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[13px] font-semibold text-muted">The facts as {r.reviewed ? "checked" : "sent"}</summary>
                    <div className="mt-2">
                      <ProgramFacts facts={shown} names={shown.names} />
                    </div>
                  </details>
                  {canDecide && r.status === "pending" ? (
                    <DecisionForms action={decideSubmissionAction} submissionId={r.id} facts={shown} source={shown.source} approveHint={hint} duplicates={duplicates} />
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
