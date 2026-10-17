import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { LibraryFiles } from "@/components/matching/library-files";
import { ProcessCard } from "@/components/matching/process-card";
import { ProcessFields } from "@/components/matching/process-fields";
import { ProgramFacts } from "@/components/matching/program-facts";
import { ProgramFields } from "@/components/matching/program-fields";
import { HistoryButton } from "@/components/record-history";
import { Alert, Card, EmptyState, Field, PageHeader, StatusText } from "@/components/ui";
import { formatDate, todayInTz } from "@/lib/dates";
import { loadPlatformSubmissions, loadProcess, loadProgram, loadProgramVersions, programNames, searchDirectory } from "@/lib/matching/data";
import { factsAsRow, statusText, submissionStatusText, verifiedText } from "@/lib/matching/directory";
import { isUuid } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { PlatformNoAccess } from "../../platform-no-access";
import { mergeProgramsAction, removeProcessAction, retireProgramAction, revertProgramAction, saveProcessAction, saveProgramAction } from "../actions";

export const metadata: Metadata = { title: "Directory entry · Platform" };

/** One directory entry for Weaver's team: its facts, a change with a reason, ending it, merging a duplicate, its history. */
export default async function PlatformMatchingEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const header = <PageHeader title="Platform" description="Gift matching directory · one employer's program" />;
  if (!session.isPlatformAdmin) {
    return (
      <>
        {header}
        <PlatformNoAccess />
      </>
    );
  }
  const { id } = await params;
  const back = (
    <Link href="/platform/matching" className="crm-link">
      Back to the directory
    </Link>
  );
  if (!isUuid(id)) {
    return (
      <>
        {header}
        <Card>
          <EmptyState title="That directory entry was not found">{back}</EmptyState>
        </Card>
      </>
    );
  }
  const res = await loadProgram(session.db, id);
  if (!res.ok || !res.data) {
    return (
      <>
        {header}
        {res.ok ? (
          <Card>
            <EmptyState title="That directory entry was not found">{back}</EmptyState>
          </Card>
        ) : (
          <Alert tone="danger" title="The directory entry could not be loaded">
            {res.error}{" "}
            <Link href={`/platform/matching/${id}`} className="crm-link">
              Try again
            </Link>
          </Alert>
        )}
      </>
    );
  }
  const { program: g, names } = res.data;
  const others = names.filter((n) => !n.is_primary).map((n) => n.name);
  const tz = session.center.time_zone;
  const [subs, lookalikes, merged, versions, process] = await Promise.all([
    loadPlatformSubmissions(session.db, "all", g.id),
    g.status === "active" ? searchDirectory(session.db, g.company_name, "all", 1) : Promise.resolve(null),
    g.merged_into ? programNames(session.db, [g.merged_into]) : Promise.resolve(null),
    loadProgramVersions(session.db, g.id),
    g.status === "merged" ? Promise.resolve(null) : loadProcess(session.db, g.id, null),
  ]);
  const duplicates = lookalikes && lookalikes.ok ? lookalikes.data.rows.filter((r) => r.id !== g.id) : [];
  const mergedName = merged && merged.ok && g.merged_into ? merged.data.get(g.merged_into)?.company_name : null;
  const verifiedBy = g.verified_by_kind === "community" && subs.ok ? subs.data.find((s) => s.id === g.verified_submission_id)?.community : null;

  return (
    <>
      {header}
      <p className="mb-3 text-[13px]">{back}</p>
      <Card actions={<HistoryButton table="match_programs" recordId={g.id} title={g.company_name} />}>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="m-0 font-display text-[22px] font-semibold text-ink" dir="auto">
            {g.company_name}
          </h2>
          <StatusText tone={g.status === "active" ? "ok" : "warn"}>{statusText(g.status)}</StatusText>
        </div>
        {g.status === "merged" && g.merged_into ? (
          <div className="mb-3">
            <Alert tone="info" title="This entry was merged into another">
              <Link href={`/platform/matching/${g.merged_into}`} className="crm-link">
                Open {mergedName ?? "the entry it joined"}
              </Link>
            </Alert>
          </div>
        ) : null}
        <p className="m-0 mb-3 text-[13px] text-muted">
          {verifiedText({ kind: g.verified_by_kind, on: g.last_verified_on })}
          {verifiedBy ? ` (${verifiedBy})` : ""}
          {g.status_reason && g.status !== "active" ? ` · ${g.status_reason}` : ""}
        </p>
        <ProgramFacts facts={g} names={others} />
      </Card>

      {g.status === "active" ? (
        <Card title="Change the facts" className="mt-4" description="Every community that uses gift matching sees the change at once. It is marked as checked by Weaver's team on the date you give.">
          <details>
            <summary className="cursor-pointer text-[13.5px] font-bold text-[var(--v2-blue)]">Edit this entry</summary>
            <ActionForm action={saveProgramAction} submitLabel="Save" pendingLabel="Saving" size="sm" className="mt-3 flex flex-col gap-3">
              <input type="hidden" name="program_id" value={g.id} />
              <ProgramFields idPrefix={`platform-${g.id}`} initial={{ ...g, names: others }} context="weaver" today={todayInTz(tz)} />
              <Field label="What changed and why" htmlFor={`platform-${g.id}-reason`} hint="It goes in the directory's history.">
                <input id={`platform-${g.id}-reason`} name="reason" className="crm-input w-full" maxLength={500} required />
              </Field>
            </ActionForm>
          </details>
        </Card>
      ) : null}

      {process ? (
        <Card
          title="How to claim"
          className="mt-4"
          description="The steps that got a match paid. Every community that uses gift matching reads them. Public facts only: no person, no community, no amount."
        >
          {process.ok ? (
            <>
              <ProcessCard answer={process.data} />
              <details className="mt-3">
                <summary className="cursor-pointer text-[13.5px] font-bold text-[var(--v2-blue)]">{process.data.process ? "Edit the steps" : "Write the steps"}</summary>
                <ActionForm action={saveProcessAction} submitLabel="Save the steps" pendingLabel="Saving" size="sm" className="mt-3 flex flex-col gap-3">
                  <input type="hidden" name="program_id" value={g.id} />
                  <ProcessFields idPrefix={`process-${g.id}`} initial={process.data.process} today={todayInTz(tz)} />
                  <Field label="What changed and why" htmlFor={`process-${g.id}-reason`} hint="It goes in the library's history.">
                    <input id={`process-${g.id}-reason`} name="reason" className="crm-input w-full" maxLength={500} required />
                  </Field>
                </ActionForm>
                {process.data.process ? (
                  <ActionForm
                    action={removeProcessAction}
                    submitLabel="Remove the steps"
                    pendingLabel="Removing"
                    size="sm"
                    variant="danger"
                    className="mt-3 flex flex-col gap-2"
                    confirmMessage={`Remove the steps for ${g.company_name}? Every community stops seeing them.`}
                  >
                    <input type="hidden" name="program_id" value={g.id} />
                    <Field label="Why" htmlFor={`process-remove-${g.id}`}>
                      <input id={`process-remove-${g.id}`} name="reason" className="crm-input w-full" maxLength={500} required />
                    </Field>
                  </ActionForm>
                ) : null}
              </details>
            </>
          ) : (
            <Alert tone="danger" title="The steps could not be loaded">
              {process.error} Reload the page to try again.
            </Alert>
          )}
        </Card>
      ) : null}

      {process && process.ok ? (
        <Card
          title="Forms and screens"
          className="mt-4"
          description="A form or a screenshot that shows the way. Up to six per entry; every community that uses gift matching can open them. Public facts only: nothing that names a person or a community."
        >
          <LibraryFiles programId={g.id} files={process.data.files} filesNotice={process.data.filesNotice} />
        </Card>
      ) : null}

      {g.status !== "merged" ? (
        <Card title={g.status === "active" ? "The program ended?" : "Running again?"} className="mt-4">
          <ActionForm
            action={retireProgramAction}
            submitLabel={g.status === "active" ? "Mark as ended" : "Bring it back"}
            pendingLabel="Saving"
            size="sm"
            variant={g.status === "active" ? "danger" : "primary"}
            className="flex flex-col gap-2"
            confirmMessage={g.status === "active" ? `Mark ${g.company_name}'s program as ended? It stays readable, but no employer on file can be linked to it.` : undefined}
          >
            <input type="hidden" name="program_id" value={g.id} />
            <input type="hidden" name="retire" value={g.status === "active" ? "true" : "false"} />
            <Field label="Why" htmlFor={`retire-${g.id}`}>
              <input id={`retire-${g.id}`} name="reason" className="crm-input w-full" maxLength={500} required />
            </Field>
          </ActionForm>
        </Card>
      ) : null}

      {g.status === "active" ? (
        <Card title="Merge a duplicate into this entry" className="mt-4" description="Its names become this entry's; links and submissions that name it follow to this one.">
          {lookalikes && !lookalikes.ok ? (
            <Alert tone="danger" title="Entries with a similar name could not be loaded">
              {lookalikes.error} Reload the page to try again.
            </Alert>
          ) : duplicates.length === 0 ? (
            <p className="crm-hint m-0">No other entry has a similar name.</p>
          ) : (
            <ActionForm
              action={mergeProgramsAction}
              submitLabel="Merge into this entry"
              pendingLabel="Merging"
              size="sm"
              variant="ghost"
              className="flex flex-col gap-2"
              confirmMessage={`Merge the chosen entry into ${g.company_name}? This cannot be undone from here.`}
            >
              <input type="hidden" name="program_id" value={g.id} />
              <Field label="The duplicate" htmlFor={`merge-${g.id}`}>
                <select id={`merge-${g.id}`} name="duplicate_id" className="crm-input w-full" required defaultValue="">
                  <option value="" disabled>
                    Choose
                  </option>
                  {duplicates.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.company_name}
                      {d.country ? ` (${d.country})` : ""}
                      {d.status === "retired" ? ", ended" : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Why" htmlFor={`merge-${g.id}-reason`}>
                <input id={`merge-${g.id}-reason`} name="reason" className="crm-input w-full" maxLength={500} required />
              </Field>
            </ActionForm>
          )}
        </Card>
      ) : null}

      <Card title="Versions" className="mt-4" description="Every change of the facts and names, newest first. Reverting brings one back in a step, as Weaver's team's check of today.">
        {!versions.ok ? (
          <Alert tone="danger" title="The versions could not be loaded">
            {versions.error} Reload the page to try again.
          </Alert>
        ) : versions.data.length === 0 ? (
          <p className="crm-hint m-0">No versions yet.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {versions.data.map((v) => (
              <li key={v.version} className="text-[13.5px] text-ink" data-version={v.version}>
                <span className="font-semibold">Version {v.version}</span> · {formatDate(v.written_at, tz)} ·{" "}
                {v.written_kind === "weaver" ? "Weaver's team" : `Verified by a community (${v.community ?? "no longer here"})`}
                {v.note ? <span className="text-muted"> · {v.note}</span> : null}
                {v.version === g.version ? <span className="text-muted"> (as it is now)</span> : null}
                {v.version !== g.version && g.status === "active" ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[13px] font-bold text-[var(--v2-blue)]">Revert to version {v.version}</summary>
                    <ActionForm
                      action={revertProgramAction}
                      submitLabel={`Revert to version ${v.version}`}
                      pendingLabel="Reverting"
                      size="sm"
                      variant="danger"
                      className="mt-2 flex flex-col gap-2"
                      confirmMessage={`Bring back version ${v.version} of ${g.company_name}? Every community sees it at once.`}
                    >
                      <input type="hidden" name="program_id" value={g.id} />
                      <input type="hidden" name="version" value={v.version} />
                      <Field label="Why" htmlFor={`revert-${g.id}-${v.version}`}>
                        <input id={`revert-${g.id}-${v.version}`} name="reason" className="crm-input w-full" maxLength={500} required />
                      </Field>
                    </ActionForm>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="What communities sent about it" className="mt-4" description="The community's name only, never who sent it.">
        {!subs.ok ? (
          <Alert tone="danger" title="The submissions could not be loaded">
            {subs.error} Reload the page to try again.
          </Alert>
        ) : subs.data.length === 0 ? (
          <p className="crm-hint m-0">Nothing yet.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {subs.data.map((s) => (
              <li key={s.id} className="text-[13.5px] text-ink">
                <span className="font-semibold">{s.community}</span> · {formatDate(s.submitted_at, tz)} · {submissionStatusText(s.status)}
                {s.decision_reason ? `: ${s.decision_reason}` : ""}
                <span className="text-muted"> ({factsAsRow(s.reviewed ?? s.proposal).company_name})</span>
                {s.status === "pending" || s.status === "forwarded" ? (
                  <>
                    {" "}
                    <Link href="/platform/matching?tab=submissions" className="crm-link">
                      Decide
                    </Link>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
