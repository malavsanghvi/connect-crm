import type { Metadata } from "next";
import Link from "next/link";

import { approveAsSecondAction } from "@/app/(app)/approvals/actions";
import { ActionForm } from "@/components/action-form";
import { BlockGrid, Card, EmptyState, KpiGrid, PageHeader, Stat, Tag, buttonClass, capitalize } from "@/components/ui";
import { loadHomeKpis } from "@/lib/data/home-kpis";
import { loadHomeTasks } from "@/lib/data/home-tasks";
import { getSession } from "@/lib/session";
import { greetingFor, hourInTz, tasksHint, visibleTaskSources, type HomeTask } from "@/lib/tasks";

export const metadata: Metadata = { title: "Home" };

export default async function HomePage() {
  const session = await getSession();
  const { center } = session;
  const [{ tasks, failures }, kpis] = await Promise.all([loadHomeTasks(session), loadHomeKpis(session)]);
  const hasSources = visibleTaskSources(session).length > 0;
  const first = session.person?.name.split(" ")[0];
  const greeting = greetingFor(hourInTz(center.time_zone));

  return (
    <>
      <PageHeader title={first ? `${greeting}, ${first}` : greeting} description="My tasks across every module you can act on" />
      <BlockGrid>
        <Card span={8} title="My tasks" description={tasksHint(tasks.length)} padded={false}>
          <div className="px-[18px] pb-2">
            {failures.map((f) => (
              <div key={`fail-${f.source}`} role="alert" className="flex flex-wrap items-center gap-3 border-b border-line-soft py-3 last:border-b-0">
                <Tag color="danger">{f.tag}</Tag>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold text-danger">Could not load the {f.tag.toLowerCase()} tasks</p>
                  <p className="text-[13px] text-muted">{capitalize(f.message)}.</p>
                </div>
                <Link href="/" className={buttonClass("ghost", "sm")}>
                  Try again
                </Link>
              </div>
            ))}
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
            {tasks.length === 0 && failures.length === 0 ? (
              <EmptyState title={hasSources ? "All clear. Nothing needs you right now." : "Nothing here for your role."}>
                {hasSources ? null : "Tasks appear here when your role can act on approvals, applications, deposits or other queues."}
              </EmptyState>
            ) : null}
          </div>
        </Card>
        <Card span={4} title="At a glance">
          <KpiGrid cols={1}>
            {kpis.length === 0 ? (
              <Stat label="Reports" value={<span className="text-faint">—</span>} hint="Not in your role" tone="ink" />
            ) : (
              kpis.map((k) =>
                k.state === "ok" ? (
                  <Stat key={k.label} label={k.label} value={k.value} hint={k.sub} tone={k.tone} href={k.href} />
                ) : (
                  <Stat
                    key={k.label}
                    label={k.label}
                    tone="danger"
                    value={<span className="text-lg">Could not load</span>}
                    hint={<span className="text-danger">{capitalize(k.message)}. Reload to try again.</span>}
                  />
                ),
              )
            )}
          </KpiGrid>
        </Card>
      </BlockGrid>
    </>
  );
}

function TaskRow({ task }: { task: HomeTask }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line-soft py-3 last:border-b-0">
      <Tag color={task.color}>{task.tag}</Tag>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold leading-snug text-ink">{task.title}</p>
        <p className="text-[13px] leading-snug text-muted">{task.meta}</p>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        {task.approve ? (
          <ActionForm
            action={approveAsSecondAction}
            submitLabel={task.approve.label}
            pendingLabel="Approving…"
            variant="ok"
            size="sm"
            confirmKicker="Two-person approval"
            confirmMessage={`${task.approve.confirmTitle} ${task.approve.confirmBody}`}
          >
            <input type="hidden" name="table" value={task.approve.table} />
            <input type="hidden" name="id" value={task.approve.id} />
          </ActionForm>
        ) : null}
        {task.links.map((l) => (
          <Link key={l.href + l.label} href={l.href} className={buttonClass(l.primary ? "primary" : "ghost", "sm")}>
            {l.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
