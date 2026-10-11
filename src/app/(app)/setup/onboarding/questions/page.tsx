import type { Metadata } from "next";
import Link from "next/link";

import { Alert, Card, EmptyState, NoAccess, PageHeader, buttonClass } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { loadInbox, loadRuns, resolveDbOf } from "@/lib/onboarding/resolve/store";
import type { RunRow } from "@/lib/onboarding/resolve/views";
import { canAccess } from "@/lib/permissions";
import { isUuid, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { FindMatchesButton } from "./find-matches";
import { InboxScreen } from "./inbox-screen";

export const metadata: Metadata = { title: "Questions · Guided onboarding · Setup" };

/** An import whose rows can still be checked: it has not started adding anything. */
const WORKABLE = new Set(["pending", "staged", "previewed"]);

const runLabel = (r: RunRow) => `Import #${r.runNumber}${r.fileName ? ` · ${r.fileName}` : ` · ${r.entityLabel}`}`;

/**
 * Questions about your files. Weaver compares an uploaded file with itself and with the families you already have, decides
 * what it can, and asks only about the rest: one question for each kind of doubt, the most valuable first, with the same
 * answer available for all the others of its kind. Every answer is remembered, so the next file does not ask it again.
 */
export default async function QuestionsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = (
    <PageHeader
      title="Questions about your files"
      description="Weaver decides what it can and asks only about the rest"
      actions={
        <Link href="/setup/onboarding" className={buttonClass("ghost", "sm")}>
          Back to guided onboarding
        </Link>
      }
    />
  );
  if (!canAccess(session, "dataImport")) {
    return (
      <>
        {header}
        <NoAccess area="Questions about your files" access="dataImport" />
      </>
    );
  }

  const db = resolveDbOf(session.db);
  const runs = await loadRuns(db, session.center.id);
  if (!runs.ok) {
    return (
      <>
        {header}
        {runs.denied ? (
          <Card title="You don't have access to this area">
            <p className="text-[13px]">Looking for matches in a file needs the permission to import people or donations. Ask your center admin to grant you a role that includes it (Settings → Roles &amp; entitlements).</p>
          </Card>
        ) : (
          <Alert tone="danger" title="Could not list your imports" action={<a className={buttonClass("bad", "xs")} href="/setup/onboarding/questions">Try again</a>}>
            {runs.error}
          </Alert>
        )}
      </>
    );
  }

  const sp = await searchParams;
  const wanted = param(sp, "run");
  const run = wanted && isUuid(wanted) ? runs.data.find((r) => r.id === wanted) : undefined;

  if (!run) {
    const open = runs.data.filter((r) => WORKABLE.has(r.status));
    const past = runs.data.filter((r) => !WORKABLE.has(r.status));
    return (
      <>
        {header}
        {wanted ? (
          <div className="mb-3">
            <Alert tone="warning">That import was not found, or you cannot use it. Choose one from the list.</Alert>
          </div>
        ) : null}
        <Card title="Which file?" description="Upload a file in Data import first (people, households or donations). Then Weaver looks for matches in it here.">
          {open.length === 0 ? (
            <EmptyState title="No file is waiting to be checked">
              <Link className={buttonClass("primary", "sm")} href="/settings/import/new">
                Start an import
              </Link>
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {open.map((r) => (
                <RunLine key={r.id} run={r} timeZone={session.center.time_zone} />
              ))}
            </ul>
          )}
        </Card>
        {past.length > 0 ? (
          <div className="mt-4">
            <Card title="Already imported" description="These have started adding records, so their questions can no longer be answered here.">
              <ul className="divide-y divide-line">
                {past.slice(0, 10).map((r) => (
                  <li key={r.id} className="py-2 text-[13px]">
                    {runLabel(r)} <span className="text-muted">· {r.status}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        ) : null}
      </>
    );
  }

  const title = runLabel(run);
  const back = (
    <p className="mb-3 text-[13px]">
      <Link className="crm-link" href="/setup/onboarding/questions">
        ← All files
      </Link>{" "}
      · {title} · {run.rowsTotal.toLocaleString("en-US")} rows
    </p>
  );
  if (!WORKABLE.has(run.status)) {
    return (
      <>
        {header}
        {back}
        <Alert tone="info" title="This import has already started">
          Its questions can no longer be answered here, because records have been added. Start a new import to check another file.
        </Alert>
      </>
    );
  }

  const inbox = await loadInbox(db, run.id);
  if (!inbox.ok) {
    return (
      <>
        {header}
        {back}
        {inbox.denied ? (
          <Card title="You don't have access to this area">
            <p className="text-[13px]">Answering these questions needs the permission to import {run.entityLabel.toLowerCase()}.</p>
          </Card>
        ) : (
          <Alert tone="danger" title="Could not open the questions" action={<a className={buttonClass("bad", "xs")} href={`/setup/onboarding/questions?run=${run.id}`}>Try again</a>}>
            {inbox.error}
          </Alert>
        )}
      </>
    );
  }

  const view = inbox.data;
  if (view.status === "none" || view.status === "staged") {
    return (
      <>
        {header}
        {back}
        <Card title="Look for matches in this file" description="Weaver reads every row, compares it with the others and with the families you already have, and decides what it can.">
          <FindMatchesButton runId={run.id} />
        </Card>
      </>
    );
  }
  if (view.status === "storing") {
    return (
      <>
        {header}
        {back}
        <Alert
          tone={view.stalled ? "warning" : "info"}
          title={view.stalled ? "The last check did not finish" : "Weaver is still working this out"}
          action={
            view.stalled ? (
              <FindMatchesButton runId={run.id} label="Check again" />
            ) : (
              <a className={buttonClass("ghost", "xs")} href={`/setup/onboarding/questions?run=${run.id}`}>
                Look again
              </a>
            )
          }
        >
          {view.stalled ? "It stopped part of the way. Check again; nothing you answered before is lost." : "A large file can take a minute or two. Reload in a moment."}
        </Alert>
      </>
    );
  }

  return (
    <>
      {header}
      {back}
      <InboxScreen key={`${run.id}:${view.storedAt ?? ""}`} runId={run.id} runLabel={title} initial={view} />
    </>
  );
}

function RunLine({ run, timeZone }: { run: RunRow; timeZone: string }) {
  const state =
    run.result === "ready"
      ? run.groupsTotal === 0
        ? "Checked: nothing to ask"
        : run.questionsLeft === 0
          ? `Checked: all ${run.groupsTotal} ${run.groupsTotal === 1 ? "question" : "questions"} answered`
          : `Checked: ${run.questionsLeft} ${run.questionsLeft === 1 ? "question" : "questions"} left`
      : run.result === "storing"
        ? "Being checked"
        : "Not checked yet";
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="text-[14px] font-semibold">{runLabel(run)}</p>
        <p className="text-[12px] text-muted">
          {run.rowsTotal.toLocaleString("en-US")} rows · {run.createdAt ? formatDateTime(run.createdAt, timeZone) : ""} · {state}
        </p>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        {run.result === "ready" ? (
          <Link className={buttonClass("primary", "sm")} href={`/setup/onboarding/questions?run=${run.id}`}>
            {run.questionsLeft === 0 ? "Open" : "Open the questions"}
          </Link>
        ) : (
          <FindMatchesButton runId={run.id} />
        )}
      </div>
    </li>
  );
}
