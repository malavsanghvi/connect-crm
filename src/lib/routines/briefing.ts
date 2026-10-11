// The morning briefing: a few facts, each a number and a link. No model writes it and no sentence is invented: every line is a
// counter the portal already keeps, in the same words each day. Pure; the numbers come in as RoutineFacts.

import { DEFAULT_LOCALE, numberIn } from "@/lib/community-format";
import { isModuleEnabled, type ModuleKey } from "@/lib/modules";
import { canAccess, hasRole, type AccessKey, type ScopedContext } from "@/lib/permissions";

import type { CounterKey } from "./recipes";
import type { RoutineFacts } from "./resolve";

export type BriefingTone = "quiet" | "attention" | "alert";

export type BriefingItem = {
  key: CounterKey;
  /** The number, or null when it could not be read (then `error` says why). */
  value: number | null;
  /** What the number counts, in plain words ("bank lines to match"). */
  label: string;
  href: string;
  tone: BriefingTone;
  error?: string;
  /** How the community writes numbers, so the sentence reads the same way as the rest of the portal. */
  locale?: string;
};

type Spec = {
  key: CounterKey;
  access: AccessKey;
  module: ModuleKey;
  href: string;
  label: (n: number) => string;
  /** Zero is calm; above zero it deserves a look, or (alert) it is something already late. */
  alert?: boolean;
};

/** In the order shown. */
const SPECS: readonly Spec[] = [
  {
    key: "applications",
    access: "applications",
    module: "membership",
    href: "/memberships/applications",
    label: (n) => `membership ${n === 1 ? "application" : "applications"} waiting`,
  },
  { key: "bank_lines", access: "bank", module: "giving", href: "/giving/bank", label: (n) => (n === 1 ? "bank line to match" : "bank lines to match") },
  {
    key: "events_week",
    access: "events",
    module: "events",
    href: "/events",
    label: (n) => (n === 1 ? "event in the next 7 days" : "events in the next 7 days"),
  },
  {
    key: "pledges_overdue",
    access: "pledges",
    module: "giving",
    href: "/giving/pledges",
    label: (n) => (n === 1 ? "pledge past its due date" : "pledges past their due date"),
    alert: true,
  },
  {
    key: "pledges_due_week",
    access: "pledges",
    module: "giving",
    href: "/giving/pledges",
    label: (n) => (n === 1 ? "pledge falls due in the next 7 days" : "pledges fall due in the next 7 days"),
  },
];

/** The counters the briefing shows, so the loader reads them even when no routine step needs them. */
export const BRIEFING_COUNTERS: readonly CounterKey[] = SPECS.map((s) => s.key);

/**
 * The facts this person may see, as items. A counter that is not available to the person (permission, module off, never read)
 * is left out; a counter that failed is shown as a line that says so, never as a zero.
 */
export function buildBriefing(viewer: ScopedContext, facts: RoutineFacts): BriefingItem[] {
  const items: BriefingItem[] = [];
  for (const spec of SPECS) {
    if (!isModuleEnabled(viewer, spec.module)) continue;
    const mayOpen = canAccess(viewer, spec.access) || (spec.key === "events_week" && hasRole(viewer, "event_lead"));
    if (!mayOpen) continue;

    // A person who reaches events only through one event's role cannot open the list: send them to the nearest event.
    let href = spec.href;
    if (spec.key === "events_week" && !canAccess(viewer, spec.access) && facts.events[0]) href = `/events/${facts.events[0].id}`;

    const n = facts.counts[spec.key];
    if (n !== undefined) {
      items.push({ key: spec.key, value: n, label: spec.label(n), href, tone: n === 0 ? "quiet" : spec.alert ? "alert" : "attention", locale: facts.locale });
      continue;
    }
    const why = facts.failed[spec.key];
    if (why) items.push({ key: spec.key, value: null, label: spec.label(2), href, tone: "alert", error: why });
  }
  return items;
}

/** A line for the page: "3 membership applications waiting" (screen readers and the plain-text fallback). */
export function briefingSentence(item: BriefingItem): string {
  return item.value === null ? `Could not count: ${item.label}` : `${numberIn(item.value, item.locale ?? DEFAULT_LOCALE)} ${item.label}`;
}
