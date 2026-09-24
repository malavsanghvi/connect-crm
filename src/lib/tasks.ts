// Home "My tasks": the work queue across modules (prototype AdminPortal
// tasks(), P:491–509). This file is pure — which sources exist, who sees
// each one, and how a source's numbers become a task row. The queries live
// in src/lib/data/home-tasks.ts (server-only).
//
// Gates are the app's permission strings, mapped from the prototype's
// entitlements (giving.refund_approve → giving.approve, acct.sync →
// accounting.manage, store.inventory → store.manage, settings.privacy →
// privacy.manage, …). A task only shows when the user can act on it.

import type { TagColor } from "@/components/ui";
import { can, type PermissionContext } from "@/lib/permissions";

export type TaskSourceKey =
  | "refund"
  | "writeoff"
  | "override"
  | "deposits"
  | "membership"
  | "newsletter"
  | "inbox"
  | "whatsapp"
  | "content"
  | "quickbooks"
  | "inventory"
  | "waivers"
  | "feedback"
  | "bolis"
  | "pathshala"
  | "privacy";

export type TaskSource = {
  key: TaskSourceKey;
  /** Tag text on the row. */
  tag: string;
  color: TagColor;
  /** The user needs ANY of these to see the task (the ones who can act on it). */
  anyOf: readonly string[];
  /** Also needed to READ the data behind the task (RLS); when missing, the task is skipped. */
  alsoNeeds?: readonly string[];
  /** Where the task's module lives. */
  href: string;
};

/** In the prototype's order (P:494–507); write-offs and voting overrides are app extras kept as tasks. */
export const TASK_SOURCES: readonly TaskSource[] = [
  { key: "refund", tag: "Refund", color: "danger", anyOf: ["giving.approve", "giving.manage"], href: "/giving/payments" },
  { key: "writeoff", tag: "Write-off", color: "brown", anyOf: ["giving.approve", "giving.manage"], href: "/giving/pledges" },
  { key: "deposits", tag: "Deposits", color: "brown", anyOf: ["giving.record_offline", "giving.manage"], href: "/giving/bank" },
  { key: "membership", tag: "Membership", color: "navy", anyOf: ["people.approve"], href: "/memberships/applications" },
  { key: "override", tag: "Voting", color: "navy", anyOf: ["people.approve"], href: "/people/voting" },
  { key: "newsletter", tag: "Newsletter", color: "purple", anyOf: ["comms.approve"], alsoNeeds: ["comms.view", "comms.send"], href: "/comms" },
  { key: "inbox", tag: "Inbox", color: "store", anyOf: ["comms.inbox"], href: "/comms" },
  { key: "whatsapp", tag: "WhatsApp", color: "store", anyOf: ["comms.send"], href: "/comms" },
  { key: "content", tag: "Content", color: "purple", anyOf: ["content.approve"], alsoNeeds: ["content.manage", "content.draft"], href: "/content" },
  { key: "quickbooks", tag: "QuickBooks", color: "danger", anyOf: ["accounting.manage"], href: "/accounting/qbo?status=failed" },
  { key: "inventory", tag: "Inventory", color: "brown", anyOf: ["store.manage"], href: "/store" },
  { key: "waivers", tag: "Event", color: "maroon", anyOf: ["events.manage"], alsoNeeds: ["volunteers.view", "volunteers.manage"], href: "/events" },
  { key: "feedback", tag: "Feedback", color: "purple", anyOf: ["events.manage"], alsoNeeds: ["comms.view", "comms.send"], href: "/events" },
  { key: "bolis", tag: "Bolis", color: "brown", anyOf: ["bolis.manage"], href: "/bolis" },
  { key: "pathshala", tag: "Pathshala", color: "purple", anyOf: ["pathshala.manage"], href: "/pathshala/signoffs" },
  { key: "privacy", tag: "Privacy", color: "muted", anyOf: ["privacy.manage"], href: "/privacy/requests" },
];

export function taskSource(key: TaskSourceKey): TaskSource {
  const s = TASK_SOURCES.find((x) => x.key === key);
  if (!s) throw new Error(`unknown task source ${key}`);
  return s;
}

/** The sources this user can act on AND read. */
export function visibleTaskSources(ctx: PermissionContext): TaskSource[] {
  return TASK_SOURCES.filter((s) => can(ctx, s.anyOf) && (!s.alsoNeeds || can(ctx, s.alsoNeeds)));
}

export function canSeeTask(ctx: PermissionContext, key: TaskSourceKey): boolean {
  return visibleTaskSources(ctx).some((s) => s.key === key);
}

// ---------------------------------------------------------------------------
// Task rows
// ---------------------------------------------------------------------------
export type TaskLink = { label: string; href: string; primary?: boolean };

/** A two-person approval the viewer can give right on Home. */
export type TaskApproval = {
  table: "payments" | "pledges" | "eligibility_snapshots";
  id: string;
  label: string;
  confirmTitle: string;
  confirmBody: string;
};

export type HomeTask = {
  id: string;
  source: TaskSourceKey;
  tag: string;
  color: TagColor;
  title: string;
  meta: string;
  links: TaskLink[];
  approve?: TaskApproval;
};

/** A source that could not be read: shown as a row that says so, never dropped silently. */
export type TaskFailure = { source: TaskSourceKey; tag: string; message: string };

export type HomeTasks = { tasks: HomeTask[]; failures: TaskFailure[] };

export function makeTask(key: TaskSourceKey, id: string, title: string, meta: string, links: TaskLink[], approve?: TaskApproval): HomeTask {
  const s = taskSource(key);
  return { id: `${key}:${id}`, source: key, tag: s.tag, color: s.color, title, meta, links, approve };
}

/** "{n} thing" / "{n} things". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** Keep the prototype order: by source, then as built. */
export function orderTasks(tasks: HomeTask[]): HomeTask[] {
  const rank = new Map(TASK_SOURCES.map((s, i) => [s.key, i]));
  return tasks
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (rank.get(a.t.source) ?? 99) - (rank.get(b.t.source) ?? 99) || a.i - b.i)
    .map((x) => x.t);
}

/** Header hint: "17 waiting · filtered by your entitlements". */
export function tasksHint(n: number): string {
  return `${n.toLocaleString("en-US")} waiting · filtered by your permissions`;
}

/** Sidebar Home badge: count, "99+", or nothing at 0. */
export function badgeText(n: number): string | null {
  if (n <= 0) return null;
  return n > 99 ? "99+" : String(n);
}

/** "Good morning" before noon, "Good afternoon" to 5 PM, then "Good evening" (center time). */
export function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** The hour (0–23) now in a time zone. */
export function hourInTz(timeZone: string, now: Date = new Date()): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now);
  return Number(h) % 24;
}

/** Items at or below reorder level: stock tracked and at/below the threshold. */
export function lowStock<T extends { track_inventory: boolean; stock_on_hand: number; low_stock_threshold: number | null }>(items: T[]): T[] {
  return items.filter((i) => i.track_inventory && i.low_stock_threshold !== null && i.stock_on_hand <= i.low_stock_threshold);
}

/** Whole-dollar KPI money: $1.84M, $612K, $950 (cents in). */
export function compactMoney(cents: number, currency = "USD"): string {
  const dollars = cents / 100;
  const symbol = currency === "USD" ? "$" : `${currency} `;
  const abs = Math.abs(dollars);
  const sign = dollars < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${symbol}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, "")}M`;
  if (abs >= 10_000) return `${sign}${symbol}${Math.round(abs / 1000)}K`;
  return `${sign}${symbol}${Math.round(abs).toLocaleString("en-US")}`;
}

/** Share as a whole percent, or null when there is nothing to divide by. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}
