// Checklist due-date labels (from connect-admin lib/logic/eams.ts): the label
// always says it — never colour alone.

import { daysBetween } from "@/lib/dates";

export const PHASE_LABEL: Record<string, string> = { pre: "Before", during: "During", after: "After" };

export type DueTone = "bad" | "warn" | "ok" | "muted";

export function dueBadge(action: { state: string; due_on: string | null }, today: string): { label: string; tone: DueTone } {
  if (action.state === "completed") return { label: "Done", tone: "ok" };
  if (action.state === "removed") return { label: "Removed", tone: "muted" };
  if (!action.due_on) return { label: "No date", tone: "muted" };
  const d = daysBetween(today, action.due_on.slice(0, 10));
  if (d < 0) return { label: `Overdue ${-d}d`, tone: "bad" };
  if (d === 0) return { label: "Due today", tone: "bad" };
  if (d <= 3) return { label: `Due in ${d}d`, tone: "bad" };
  if (d <= 7) return { label: `Due in ${d}d`, tone: "warn" };
  return { label: `Due in ${d}d`, tone: "muted" };
}
