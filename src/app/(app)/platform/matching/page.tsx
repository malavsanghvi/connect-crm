import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { DecisionForms, type DuplicateChoice } from "@/components/matching/decision-forms";
import { ProgramFacts } from "@/components/matching/program-facts";
import { ProgramFields } from "@/components/matching/program-fields";
import { Alert, Card, ChipLinks, EmptyState, Field, PageHeader, Pagination, StatusText, TableWrap, buttonClass } from "@/components/ui";
import { formatDate, todayInTz } from "@/lib/dates";
import { SEARCH_PAGE, loadCommunityPublishing, loadPlatformSubmissions, loadRecentPublishes, searchDirectory } from "@/lib/matching/data";
import { factsAsRow, forwardReasonText, portalLabel, ratioInput, submissionStatusText, verifiedText } from "@/lib/matching/directory";
import { hrefWith, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import { getSession, type CrmSession } from "@/lib/session";

import { PlatformNoAccess } from "../platform-no-access";
import { decidePlatformSubmissionAction, saveProgramAction, setPublishingAction } from "./actions";

export const metadata: Metadata = { title: "Gift matching directory · Platform" };

const TABS = [
  { key: "directory", label: "Directory" },
  { key: "submissions", label: "Submissions" },
  { key: "recent", label: "Recent community publishes" },
  { key: "communities", label: "Communities" },
] as const;
const SUB_VIEWS = [
  { key: "open", label: "To decide" },
  { key: "forwarded", label: "Forwarded by a community" },
  { key: "decided", label: "Decided" },
  { key: "all", label: "All" },
] as const;
const STATUSES = [
  { key: "active", label: "Active" },
  { key: "retired", label: "Ended" },
  { key: "all", label: "All" },
] as const;

/** How many open submissions get their look-alikes searched (for "It is a duplicate"). */
const DUPLICATE_LOOKUPS = 20;

/**
 * Platform › Gift matching directory: Weaver's team keeps the employer-program directory every community with CatchTheMatch
 * shares (public facts from the employers' own pages, with the source and the date) and decides the communities'
 * submissions. A submission shows the community's name, never who sent it.
 */
export default async function PlatformMatchingPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = (
    <PageHeader
      title="Platform"
      description="Gift matching directory · employers' matching programs shared by every community that uses CatchTheMatch, and what communities sent"
    />
  );
  if (!session.isPlatformAdmin) {
    return (
      <>
        {header}
        <PlatformNoAccess />
      </>
    );
  }
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === param(sp, "tab"))?.key ?? "directory";
  const tz = session.center.time_zone;
  return (
    <>
      {header}
      <ChipLinks label="Gift matching directory views" active={tab} items={TABS.map((t) => ({ key: t.key, label: t.label, href: t.key === "directory" ? "/platform/matching" : `/platform/matching?tab=${t.key}` }))} />
      {tab === "directory" ? (
        <DirectoryTab session={session} sp={sp} today={todayInTz(tz)} />
      ) : tab === "submissions" ? (
        <SubmissionsTab session={session} sp={sp} tz={tz} />
      ) : tab === "recent" ? (
        <RecentTab session={session} tz={tz} />
      ) : (
        <CommunitiesTab session={session} />
      )}
    </>
  );
}

async function DirectoryTab({ session, sp, today }: { session: CrmSession; sp: RawSearchParams; today: string }) {
  const q = (param(sp, "q") ?? "").slice(0, 160);
  const status = STATUSES.find((s) => s.key === param(sp, "status"))?.key ?? "active";
  const page = pageParam(sp);
  const res = await searchDirectory(session.db, q, status, page);
  const base = { q: q || undefined, status: status === "active" ? undefined : status };
  return (
    <>
      <Card title="Add an entry" description="From the employer's own page or document. Facts about the program only, never who works there.">
        <details>
          <summary className="cursor-pointer text-[13.5px] font-bold text-[var(--v2-blue)]">Add an employer&apos;s program</summary>
          <ActionForm action={saveProgramAction} submitLabel="Add to the directory" pendingLabel="Adding" size="sm" className="mt-3 flex flex-col gap-3">
            <ProgramFields idPrefix="platform-new" context="weaver" today={today} />
            <Field label="Why (for the directory's history)" htmlFor="platform-new-reason" hint="For example: from the employer's 2026 giving page.">
              <input id="platform-new-reason" name="reason" className="crm-input w-full" maxLength={500} required />
            </Field>
          </ActionForm>
        </details>
      </Card>
      <form method="get" action="/platform/matching" className="mb-3 mt-4 flex flex-wrap items-end gap-3" role="search">
        <div>
          <label htmlFor="platform-matching-q" className="crm-label">
            Company
          </label>
          <input id="platform-matching-q" name="q" className="crm-input w-72" defaultValue={q} placeholder="Any name it goes by" dir="auto" />
        </div>
        {status !== "active" ? <input type="hidden" name="status" value={status} /> : null}
        <button type="submit" className={buttonClass("ghost")}>
          Search
        </button>
      </form>
      <ChipLinks label="Entry status" active={status} items={STATUSES.map((s) => ({ key: s.key, label: s.label, href: hrefWith("/platform/matching", base, { status: s.key === "active" ? undefined : s.key }) }))} />
      <Card padded={false}>
        {!res.ok ? (
          <div className="p-4">
            <Alert tone="danger" title="The directory could not be loaded">
              {res.error}{" "}
              <Link href={hrefWith("/platform/matching", base, {})} className="crm-link">
                Try again
              </Link>
            </Alert>
          </div>
        ) : res.data.rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title={q ? `Nothing in the directory is called "${q}"` : "The directory is empty so far"}>Add the first entry above.</EmptyState>
          </div>
        ) : (
          <>
            <TableWrap>
              <table className="crm-table" aria-label="Directory entries">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Country</th>
                    <th>Ratio</th>
                    <th>Where to ask</th>
                    <th>Checked</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {res.data.rows.map((r) => (
                    <tr key={r.id} data-program={r.id}>
                      <td className="font-bold">
                        <Link href={`/platform/matching/${r.id}`} className="crm-link" dir="auto">
                          {r.company_name}
                        </Link>
                      </td>
                      <td>{r.country ?? "Any"}</td>
                      <td>{r.gift_match ? (r.match_ratio_bp ? `${ratioInput(r.match_ratio_bp)}:1` : "Not known") : "Volunteer grants only"}</td>
                      <td>{portalLabel(r.portal)}</td>
                      <td className="text-[13px]">{verifiedText({ kind: r.verified_by_kind, on: r.last_verified_on })}</td>
                      <td>{r.status === "active" ? <StatusText tone="ok">Active</StatusText> : <StatusText tone="warn">Ended</StatusText>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <Pagination page={page} pageSize={SEARCH_PAGE} total={res.data.total} hrefFor={(n) => hrefWith("/platform/matching", base, { page: n > 1 ? String(n) : undefined })} />
          </>
        )}
      </Card>
    </>
  );
}

async function SubmissionsTab({ session, sp, tz }: { session: CrmSession; sp: RawSearchParams; tz: string }) {
  const view = SUB_VIEWS.find((v) => v.key === param(sp, "view"))?.key ?? "open";
  const res = await loadPlatformSubmissions(session.db, view);
  const rows = res.ok ? res.data : [];
  const open = rows.filter((r) => r.status === "pending" || r.status === "forwarded");
  const lookups = await Promise.all(
    open.slice(0, DUPLICATE_LOOKUPS).map(async (r) => {
      const name = factsAsRow(r.reviewed ?? r.proposal).company_name;
      const found = name ? await searchDirectory(session.db, name, "active", 1) : null;
      return [r.id, found && found.ok ? found.data.rows.slice(0, 10) : []] as const;
    }),
  );
  const lookalikes = new Map(lookups);
  return (
    <>
      <ChipLinks label="Submission status" active={view} items={SUB_VIEWS.map((v) => ({ key: v.key, label: v.label, href: hrefWith("/platform/matching", { tab: "submissions" }, { view: v.key === "open" ? undefined : v.key }) }))} />
      {!res.ok ? (
        <Alert tone="danger" title="The submissions could not be loaded">
          {res.error}{" "}
          <Link href={hrefWith("/platform/matching", { tab: "submissions" }, { view: view === "open" ? undefined : view })} className="crm-link">
            Try again
          </Link>
        </Alert>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState title={view === "open" ? "Nothing is waiting for a decision" : "No submissions here"}>
            Communities send what their members know; a community&apos;s CatchTheMatch manager decides most of them. Changes to entries Weaver&apos;s
            team checked come here.
          </EmptyState>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r) => {
            const shown = factsAsRow(r.reviewed ?? r.proposal);
            const found = lookalikes.get(r.id) ?? [];
            const duplicates: DuplicateChoice[] = [
              ...found.filter((e) => e.id !== r.program_id).map((e) => ({ value: `entry:${e.id}`, label: `Directory: ${e.company_name}${e.country ? ` (${e.country})` : ""}` })),
              ...open
                .filter((w) => w.id !== r.id)
                .map((w) => ({ value: `submission:${w.id}`, label: `Submission: ${factsAsRow(w.reviewed ?? w.proposal).company_name} from ${w.community}` })),
            ];
            const hint = r.program_id
              ? "Approving changes the entry for every community, checked by Weaver's team today."
              : "Approving adds it to the directory for every community, checked by Weaver's team today.";
            return (
              <Card key={r.id}>
                <div data-submission={r.id} data-status={r.status}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="m-0 text-[16px] font-bold text-ink" dir="auto">
                      {shown.company_name || "A company"}
                    </h3>
                    <StatusText tone={r.status === "approved" ? "ok" : r.status === "rejected" ? "bad" : "warn"}>{submissionStatusText(r.status)}</StatusText>
                  </div>
                  <p className="m-0 mt-0.5 text-[13px] text-muted">
                    From {r.community} on {formatDate(r.submitted_at, tz)} ·{" "}
                    {r.program_id ? (
                      <>
                        a change to{" "}
                        <Link href={`/platform/matching/${r.program_id}`} className="crm-link">
                          {r.program_name ?? "an entry"}
                        </Link>
                      </>
                    ) : (
                      "a company not in the directory yet"
                    )}
                  </p>
                  {r.note ? <p className="m-0 mt-2 whitespace-pre-line text-[13.5px] text-ink">&ldquo;{r.note}&rdquo;</p> : null}
                  {r.status === "forwarded" ? (
                    <p className="m-0 mt-2 text-[13px] text-ink">
                      Forwarded by the community{r.forwarded_at ? ` on ${formatDate(r.forwarded_at, tz)}` : ""} because {forwardReasonText(r.forwarded_because)}.
                      {r.forward_note ? ` Their note: ${r.forward_note}` : ""}
                    </p>
                  ) : null}
                  {r.decided_at ? (
                    <p className="m-0 mt-2 text-[13px] text-muted">
                      {submissionStatusText(r.status)} by {r.decided_kind === "weaver" ? "Weaver's team" : "the community"} on {formatDate(r.decided_at, tz)}
                      {r.decision_reason ? `: ${r.decision_reason}` : "."}
                    </p>
                  ) : null}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[13px] font-semibold text-muted">The facts as {r.reviewed ? "checked by the community" : "sent"}</summary>
                    <div className="mt-2">
                      <ProgramFacts facts={shown} names={shown.names} />
                    </div>
                  </details>
                  {r.status === "pending" || r.status === "forwarded" ? (
                    <DecisionForms action={decidePlatformSubmissionAction} submissionId={r.id} facts={shown} source={shown.source} approveHint={hint} duplicates={duplicates} />
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

/** What communities published lately, newest first: each is a version Weaver's team can open, compare and revert. */
async function RecentTab({ session, tz }: { session: CrmSession; tz: string }) {
  const res = await loadRecentPublishes(session.db, 14);
  if (!res.ok) {
    return (
      <Alert tone="danger" title="What communities published could not be loaded">
        {res.error}{" "}
        <Link href="/platform/matching?tab=recent" className="crm-link">
          Try again
        </Link>
      </Alert>
    );
  }
  return (
    <Card padded={false} title="Published by communities in the last 14 days" description="Open an entry to compare its versions and revert one in a step.">
      {res.data.length === 0 ? (
        <div className="p-4">
          <EmptyState title="No community published to the directory in the last 14 days" />
        </div>
      ) : (
        <TableWrap>
          <table className="crm-table" aria-label="Recent community publishes">
            <thead>
              <tr>
                <th>Entry</th>
                <th>Community</th>
                <th>When</th>
                <th>Version</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {res.data.map((r) => (
                <tr key={`${r.program_id}-${r.version}`}>
                  <td className="font-bold">
                    <Link href={`/platform/matching/${r.program_id}`} className="crm-link" dir="auto">
                      {r.company_name}
                    </Link>
                    {r.status !== "active" ? <span className="text-[12px] font-normal text-muted"> ({r.status === "merged" ? "merged" : "ended"})</span> : null}
                  </td>
                  <td>{r.community ?? "A community no longer here"}</td>
                  <td className="whitespace-nowrap text-[13px]">{formatDate(r.written_at, tz)}</td>
                  <td>
                    {r.version}
                    {r.current_version !== r.version ? <span className="text-[12px] text-muted"> (now {r.current_version})</span> : null}
                  </td>
                  <td className="text-[13px]">{r.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

/** Each community where CatchTheMatch is on: what it publishes, and Weaver's switch (pause with a reason, the daily cap). */
async function CommunitiesTab({ session }: { session: CrmSession }) {
  const res = await loadCommunityPublishing(session.db);
  if (!res.ok) {
    return (
      <Alert tone="danger" title="The communities could not be loaded">
        {res.error}{" "}
        <Link href="/platform/matching?tab=communities" className="crm-link">
          Try again
        </Link>
      </Alert>
    );
  }
  if (res.data.length === 0) {
    return (
      <Card>
        <EmptyState title="No community has CatchTheMatch on yet" />
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {res.data.map((c) => (
        <Card key={c.center_id} title={c.community} description={`Published ${c.published_today} today (cap ${c.daily_cap}) · ${c.published_week} in 7 days · ${c.waiting} waiting`}>
          <div data-community={c.center_id}>
            {c.paused ? (
              <p className="m-0 mb-2 text-[13.5px] text-ink">
                <StatusText tone="warn">Publishing paused</StatusText> {c.pause_reason ?? ""}
              </p>
            ) : null}
            <ActionForm
              action={setPublishingAction}
              submitLabel={c.paused ? "Resume publishing" : "Pause publishing"}
              pendingLabel="Saving"
              size="sm"
              variant={c.paused ? "primary" : "danger"}
              className="flex flex-col gap-2"
            >
              <input type="hidden" name="center_id" value={c.center_id} />
              <input type="hidden" name="paused" value={c.paused ? "false" : "true"} />
              <Field label="Why" htmlFor={`pause-${c.center_id}`} hint="The community's CatchTheMatch managers see it.">
                <input id={`pause-${c.center_id}`} name="reason" className="crm-input w-full" maxLength={500} required />
              </Field>
            </ActionForm>
            <details className="mt-2">
              <summary className="cursor-pointer text-[13.5px] font-bold text-[var(--v2-blue)]">Change the daily cap</summary>
              <ActionForm action={setPublishingAction} submitLabel="Save the cap" pendingLabel="Saving" size="sm" className="mt-2 flex flex-col gap-2">
                <input type="hidden" name="center_id" value={c.center_id} />
                <Field label="Approvals that publish per day" htmlFor={`cap-${c.center_id}`}>
                  <input id={`cap-${c.center_id}`} name="daily_cap" className="crm-input w-24" inputMode="numeric" defaultValue={c.daily_cap} required />
                </Field>
                <Field label="Why" htmlFor={`cap-${c.center_id}-reason`}>
                  <input id={`cap-${c.center_id}-reason`} name="reason" className="crm-input w-full" maxLength={500} required />
                </Field>
              </ActionForm>
            </details>
          </div>
        </Card>
      ))}
    </div>
  );
}
