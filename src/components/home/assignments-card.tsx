import Link from "next/link";

import { Card, Tag, buttonClass, capitalize, type BlockSpan, type TagColor } from "@/components/ui";
import type { AssignmentKind, AssignmentLine, AssignmentsCard as AssignmentsModel } from "@/lib/home/assignments";
import { plural } from "@/lib/tasks";

const KIND: Record<AssignmentKind, { tag: string; color: TagColor }> = {
  event: { tag: "Event", color: "navy" },
  class: { tag: "Class", color: "navy" },
  zone: { tag: "Zone", color: "navy" },
};

/**
 * Home "My assignments": the events, classes and zones a person holds a role for, one line each, with the pages that role can open.
 * For anyone who holds such a grant, staff included. A line whose read failed says so, with a retry.
 */
export function AssignmentsCard({ card, span = 12 }: { card: AssignmentsModel; span?: BlockSpan }) {
  return (
    <Card span={span} title="My assignments" description="The events, classes and zones you hold a role for" padded={false}>
      <div className="px-[18px] pb-2">
        {card.lines.map((line) => (
          <AssignmentRow key={line.key} line={line} />
        ))}
        {card.more > 0 ? <p className="py-3 text-[13px] text-muted">And {plural(card.more, "more assignment")} that are not listed here.</p> : null}
      </div>
    </Card>
  );
}

function AssignmentRow({ line }: { line: AssignmentLine }) {
  const kind = KIND[line.kind];
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line-soft py-3 last:border-b-0">
      <Tag color={kind.color}>{kind.tag}</Tag>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold leading-snug text-ink">
          {line.title}
          {line.status ? <span className="ml-2 text-[12px] font-semibold text-muted">{line.status}</span> : null}
        </p>
        <p className="text-[13px] leading-snug text-muted">{[line.roles.join(", "), line.detail].filter(Boolean).join(" · ")}</p>
        {line.numbers ? <p className="text-[13px] leading-snug text-ink">{line.numbers}</p> : null}
        {line.note ? <p className="text-[13px] leading-snug text-muted">{line.note}</p> : null}
        {line.problem ? (
          <p role="alert" className="text-[13px] leading-snug text-danger">
            {capitalize(line.problem)} <Link href="/" className="crm-link">Try again</Link>
          </p>
        ) : null}
      </div>
      {line.links.length > 0 ? (
        <div className="flex flex-wrap items-start gap-2">
          {line.links.map((l, i) => (
            <Link key={l.href} href={l.href} className={buttonClass(i === 0 ? "primary" : "ghost", "sm")}>
              {l.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
