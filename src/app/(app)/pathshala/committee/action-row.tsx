import Link from "next/link";
import type { ReactNode } from "react";

import { dueBadge } from "@/lib/logic/eams";
import { formatDate, humanize } from "@/lib/pathshala/format";

import { PBadge } from "../ui";

export type ActionListItem = {
  id: string;
  name: string;
  state: string;
  due_on: string | null;
  owner_person_id: string | null;
  phase: string | null;
  priority: string;
  event_id: string | null;
  action_type: string;
};

export const PHASE_LABEL: Record<string, string> = { pre: "Before", during: "During", after: "After" };

export function ActionRow({
  a,
  today,
  ownerName,
  eventName,
  extra,
}: {
  a: ActionListItem;
  today: string;
  ownerName: string | null;
  eventName: string | null;
  extra?: ReactNode;
}) {
  const badge = dueBadge(a, today);
  return (
    <li className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <Link href={`/pathshala/committee/actions/${a.id}`} className="crm-link font-semibold">
          {a.name}
        </Link>
        <p className="text-xs text-muted">
          {eventName ? `${eventName}${a.phase ? ` · ${PHASE_LABEL[a.phase] ?? a.phase}` : ""} · ` : "Standalone · "}
          {ownerName ? `Owner: ${ownerName}` : "No owner"}
          {a.due_on ? ` · due ${formatDate(a.due_on)}` : ""}
          {a.action_type !== "task" ? ` · ${humanize(a.action_type)}` : ""}
        </p>
        {extra && <div className="mt-2">{extra}</div>}
      </div>
      <div className="flex shrink-0 flex-wrap gap-1">
        {!a.owner_person_id && <PBadge tone="danger">Unassigned</PBadge>}
        {(a.priority === "high" || a.priority === "critical") && <PBadge tone="maroon">{humanize(a.priority)}</PBadge>}
        <PBadge tone={badge.tone}>{badge.label}</PBadge>
        <PBadge tone={a.state === "in_progress" ? "navy" : "muted"}>{humanize(a.state)}</PBadge>
      </div>
    </li>
  );
}
