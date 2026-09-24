// Committee (EAMS) dashboard rules carried over from the old Pathshala app:
//   overdue            due date before today, not completed/removed
//   due soon           due within 3 days (today counts)
//   upcoming           due within the 14-day horizon
//   unassigned         any open action in the horizon (or overdue) with no owner
//   events soon        events starting from yesterday through 14 days out
// Dates are compared as calendar days (yyyy-mm-dd) in the center's zone.

export const DUE_SOON_DAYS = 3;
export const HORIZON_DAYS = 14;

export type DueClass = "done" | "removed" | "overdue" | "due_soon" | "upcoming" | "later" | "no_date";

export type ActionLike = {
  id: string;
  state: string;
  due_on: string | null;
  owner_person_id: string | null;
};

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** Days from today until the due date (negative = overdue). */
export function daysUntil(dueOn: string | null, todayIso: string): number | null {
  if (!dueOn) return null;
  return daysBetween(todayIso, dueOn.slice(0, 10));
}

export function classifyAction(action: Pick<ActionLike, "state" | "due_on">, todayIso: string): DueClass {
  if (action.state === "completed") return "done";
  if (action.state === "removed") return "removed";
  const d = daysUntil(action.due_on, todayIso);
  if (d === null) return "no_date";
  if (d < 0) return "overdue";
  if (d <= DUE_SOON_DAYS) return "due_soon";
  if (d <= HORIZON_DAYS) return "upcoming";
  return "later";
}

export type RiskTone = "danger" | "warning" | "caution" | "ok" | "muted" | "success";

/** Short label + tone for a due date (never colour alone: the label says it). */
export function dueBadge(action: Pick<ActionLike, "state" | "due_on">, todayIso: string): { label: string; tone: RiskTone } {
  if (action.state === "completed") return { label: "Done", tone: "success" };
  if (action.state === "removed") return { label: "Removed", tone: "muted" };
  const d = daysUntil(action.due_on, todayIso);
  if (d === null) return { label: "No date", tone: "muted" };
  if (d < 0) return { label: `Overdue ${-d}d`, tone: "danger" };
  if (d === 0) return { label: "Due today", tone: "danger" };
  if (d <= DUE_SOON_DAYS) return { label: `Due in ${d}d`, tone: "danger" };
  if (d <= 7) return { label: `Due in ${d}d`, tone: "warning" };
  if (d <= HORIZON_DAYS) return { label: `Due in ${d}d`, tone: "caution" };
  return { label: `Due in ${d}d`, tone: "ok" };
}

export type EventLike = { id: string; starts_on: string | null };

export function committeeDashboard<A extends ActionLike, E extends EventLike>(actions: A[], events: E[], todayIso: string) {
  const overdue: A[] = [];
  const dueSoon: A[] = [];
  const upcoming: A[] = [];
  for (const a of actions) {
    const c = classifyAction(a, todayIso);
    if (c === "overdue") overdue.push(a);
    else if (c === "due_soon") dueSoon.push(a);
    else if (c === "upcoming") upcoming.push(a);
  }
  const byDue = (x: A, y: A) => (x.due_on ?? "").localeCompare(y.due_on ?? "");
  const unassigned = [...overdue, ...dueSoon, ...upcoming].filter((a) => !a.owner_person_id).sort(byDue);
  const eventsSoon = events
    .filter((e) => {
      const d = daysUntil(e.starts_on, todayIso);
      return d !== null && d >= -1 && d <= HORIZON_DAYS;
    })
    .sort((x, y) => (x.starts_on ?? "").localeCompare(y.starts_on ?? ""));
  return {
    overdue: overdue.sort(byDue),
    dueSoon: dueSoon.sort(byDue),
    upcoming: upcoming.sort(byDue),
    unassigned,
    eventsSoon,
    allClear: overdue.length + dueSoon.length + upcoming.length + eventsSoon.length === 0,
  };
}

/** Pathshala year label for a date: the year starts in July ("2026-2027"). */
export function pathshalaYearFor(todayIso: string): string {
  const y = +todayIso.slice(0, 4);
  const m = +todayIso.slice(5, 7);
  const start = m >= 7 ? y : y - 1;
  return `${start}-${start + 1}`;
}

/** Due date for a template item offset relative to an event date. */
export function dueFromOffset(eventDateIso: string | null, offsetDays: number | null): string | null {
  if (!eventDateIso || offsetDays === null || offsetDays === undefined) return null;
  const d = new Date(eventDateIso.slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export type StatusUpdate = { date: string; text: string; author: string };

export function appendStatusUpdate(existing: unknown, update: StatusUpdate): StatusUpdate[] {
  const list = Array.isArray(existing) ? (existing as StatusUpdate[]) : [];
  return [...list, update];
}

export type Lesson = { id: string; text: string; author: string; created_at: string };

/** Merge lessons into a template's list: same id overwrites in place, new ids append. */
export function mergeLessons(templateLessons: unknown, eventLessons: unknown): Lesson[] {
  const base = Array.isArray(templateLessons) ? [...(templateLessons as Lesson[])] : [];
  const incoming = Array.isArray(eventLessons) ? (eventLessons as Lesson[]) : [];
  const index = new Map(base.map((l, i) => [l.id, i]));
  for (const l of incoming) {
    const i = l.id ? index.get(l.id) : undefined;
    if (i !== undefined) base[i] = { ...l };
    else {
      index.set(l.id, base.length);
      base.push({ ...l });
    }
  }
  return base;
}
