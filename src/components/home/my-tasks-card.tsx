import Link from "next/link";

import { approveAsSecondAction } from "@/app/(app)/approvals/actions";
import { ActionForm } from "@/components/action-form";
import { AskNiva } from "@/components/niva/ask-niva";
import { Card, EmptyState, Tag, buttonClass, capitalize, type BlockSpan } from "@/components/ui";
import { tasksHint, type HomeTask, type TaskFailure } from "@/lib/tasks";

/**
 * Home "My tasks": the work queue across modules. Shared by the classic Home and by Today (the new look), so the list reads the same in both.
 * A source that could not be read is a row that says so (with a retry), never a silently shorter list.
 */
export function MyTasksCard({
  tasks,
  failures,
  hasSources,
  span = 8,
}: {
  tasks: HomeTask[];
  failures: Pick<TaskFailure, "source" | "tag" | "message">[];
  hasSources: boolean;
  span?: BlockSpan;
}) {
  return (
    <Card span={span} title="My tasks" description={tasksHint(tasks.length)} padded={false}>
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
  );
}

function TaskRow({ task }: { task: HomeTask }) {
  return (
    // data-spotlight: the guided tours light the real row (src/lib/spotlight/tours); it changes nothing about the row.
    <div
      data-spotlight={task.giving?.kind === "bank_lines" ? "home-bank-task" : undefined}
      className="flex flex-wrap items-center gap-3 border-b border-line-soft py-3 last:border-b-0"
    >
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
        {/* Only the kind of task is sent (never its title, which can name a person): Niva then looks at the task list itself. */}
        <AskNiva prompt={`What is the quickest way to clear my ${task.tag.toLowerCase()} tasks?`} label="Ask Niva" />
      </div>
    </div>
  );
}
