import type { Metadata } from "next";
import Link from "next/link";

import { Alert, Badge, Card, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { PlaybookEditor } from "@/components/care/playbook-editor";
import { InstallStarters, PauseResume, WeekReminderForm } from "@/components/care/playbook-controls";
import { NivaTick } from "@/components/care/plan-controls";
import { NO_ACCESS } from "@/lib/care/model";
import { TRIGGER_HELP, TRIGGER_LABEL, afterLine, blankPlaybook, playbookInput, stepWay, type Playbook } from "@/lib/care/playbooks";
import { loadNivaSetting, loadPlaybooks, loadWeekSettings, seesCare } from "@/lib/data/care";
import { kindName } from "@/lib/kind";
import { param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Playbooks" };

// Playbooks (DonorDelight slice 5): timed steps for a kind of household, in the organization's own words. Everyone with a care key reads
// them; whoever manages DonorDelight (care.manage) adds the starters for their kind of organization, edits, pauses and resumes them, and
// switches on the weekly reminder. A step is a touch to record, never an ask. The database decides (app.care_playbooks_list, 0891: no
// platform-admin branch).

function PlaybookCard({ p, canManage }: { p: Playbook; canManage: boolean }) {
  return (
    <Card
      title={
        <>
          {p.name} {p.enabled ? null : <Badge tone="warning">Paused</Badge>}
        </>
      }
      description={p.summary ?? undefined}
      actions={
        canManage ? (
          <>
            <Link href={`/care/playbooks?edit=${p.id}`} className={buttonClass("ghost", "xs")}>
              Edit
            </Link>
            <PauseResume id={p.id} enabled={p.enabled} />
          </>
        ) : undefined
      }
    >
      <p className="m-0 text-[13px] text-muted">
        <span className="font-semibold text-ink-2">{TRIGGER_LABEL[p.trigger]}.</span> {TRIGGER_HELP[p.trigger]}
      </p>
      <ol className="m-0 mt-2.5 flex list-none flex-col gap-2 p-0">
        {p.steps.map((s) => (
          <li key={s.id} className="rounded-field border border-line-soft px-3 py-2">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="text-[14px] font-semibold text-ink">{s.title}</span>
              <span className="text-[12.5px] text-muted">
                {afterLine(s.afterDays)} · {stepWay(s)}
              </span>
            </div>
            <div className="text-[13px] text-ink-2">{s.why}</div>
            {s.draft ? <div className="mt-1 whitespace-pre-wrap text-[12.5px] text-muted">{s.draft}</div> : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}

export default async function PlaybooksPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const sp = await searchParams;
  const label = kindName(session.kind, "care", "DonorDelight");
  const header = <PageHeader title={`${label}: playbooks`} description="Timed steps for each kind of household, in your own words. Each step becomes a task for the household's relationship owner. A step is a touch to record; it never asks for money." />;
  const card = (title: string, body?: string) => (
    <>
      {header}
      <div className="cc-card px-6 py-10 text-center">
        <p className="font-display text-[22px] font-semibold text-ink">{title}</p>
        {body ? <p className="mx-auto mt-2 max-w-lg text-[13px] text-muted">{body}</p> : null}
      </div>
    </>
  );

  if (!seesCare(session)) return card(NO_ACCESS, `${label} is open only to the roles your organization gives it. Ask your organization's owner or care lead.`);

  const [read, settings, niva] = await Promise.all([loadPlaybooks(session), loadWeekSettings(session), loadNivaSetting(session)]);
  if (read.status === "no_access") return card(NO_ACCESS);
  if (read.status === "off") return card(read.message);
  if (read.status === "error") {
    return (
      <>
        {header}
        <Alert
          tone="danger"
          title="Could not load the playbooks"
          action={
            <a href="/care/playbooks" className={buttonClass("bad", "xs")}>
              Try again
            </a>
          }
        >
          {read.error.charAt(0).toUpperCase() + read.error.slice(1).replace(/\.?$/, ".")}
        </Alert>
      </>
    );
  }

  const data = read.data;
  const edit = param(sp, "edit");
  const editing = data.canManage && edit ? (edit === "new" ? blankPlaybook() : (() => { const p = data.playbooks.find((x) => x.id === edit); return p ? playbookInput(p) : null; })()) : null;

  if (editing) {
    return (
      <>
        {header}
        <Card title={editing.id ? "Change the playbook" : "A new playbook"}>
          <PlaybookEditor key={editing.id ?? "new"} initial={editing} />
        </Card>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="flex flex-col gap-4">
        {data.canManage ? (
          <div className="flex flex-wrap items-center gap-3">
            {data.startersMissing > 0 ? <InstallStarters count={data.startersMissing} label={data.label} /> : null}
            <Link href="/care/playbooks?edit=new" className={buttonClass("ghost", "sm")}>
              New playbook
            </Link>
          </div>
        ) : null}
        {data.playbooks.length === 0 ? (
          <Card padded={false}>
            <EmptyState title="No playbooks yet.">
              {data.canManage ? "Add the starter playbooks written for your kind of organization, then change any word." : "Someone who manages this area adds the playbooks."}
            </EmptyState>
          </Card>
        ) : (
          data.playbooks.map((p) => <PlaybookCard key={p.id} p={p} canManage={data.canManage} />)
        )}
        {settings.status === "ok" ? (
          <Card title="Weekly reminder" description="Tell each relationship owner how many tasks wait for them.">
            <WeekReminderForm initial={settings.data} />
          </Card>
        ) : settings.status === "error" ? (
          <Alert tone="danger" title="Could not load the weekly reminder">
            {settings.error.charAt(0).toUpperCase() + settings.error.slice(1).replace(/\.?$/, ".")}
          </Alert>
        ) : null}
        {niva.status === "ok" ? (
          <Card title="Niva" description="Let Niva help with relationship care. It needs iWeaver and this tick.">
            <NivaTick enabled={niva.data.enabled} ai={niva.data.ai} canManage={niva.data.canManage} />
          </Card>
        ) : niva.status === "error" ? (
          <Alert tone="danger" title="Could not load whether Niva may help">
            {niva.error.charAt(0).toUpperCase() + niva.error.slice(1).replace(/\.?$/, ".")}
          </Alert>
        ) : null}
      </div>
    </>
  );
}
