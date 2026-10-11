// Routines: which steps apply to this person today, and which are done. Pure (no database): the facts come in as numbers.
//
// A person gets the routine of every role they hold (two roles are joined, a step shared by both appears once). A step is
// left out when the person may not do it (its portal area needs a permission they lack) or when the organization has switched
// off the module it belongs to. A weekly, month-end, before-event or event-day step appears only when it is due; the rest are
// listed as "coming up" so nobody is surprised on Friday.

import { DEFAULT_LOCALE, regionalWorkWeek, weekdayName, type WorkWeek } from "@/lib/community-format";
import { moduleNotOffered } from "@/lib/kind";
import { isModuleEnabled, moduleForPath } from "@/lib/modules";
import { PAYMENT_PLUGINS } from "@/lib/payments/plugins/catalog";
import { canAccess, hasRole, type ScopedContext } from "@/lib/permissions";

import { dateParts, ordinal } from "./clock";
import {
  COUNTERS,
  ROUTINE_ROLES,
  RECIPES,
  WHEN_LABEL,
  ROUTINE_WHEN,
  routineRoleTitle,
  routineWords,
  startingRoleNames,
  textOf,
  type CounterKey,
  type RoutineRole,
  type RoutineStep,
  type RoutineWhen,
  type RoutineWords,
} from "./recipes";

/** A kind that says nothing about itself: used when the viewer carries none, so a routine never speaks as a particular tradition. */
const NO_KIND = { terms: {}, modules: {}, usesTradition: false } as const;

/** An upcoming event the person can see: how many days away it is (0 = today). */
export type FactEvent = { id: string; name: string; days: number };

/** Everything a routine needs to know, as plain numbers. Built by src/lib/data/today.ts; tests pass fakes. */
export type RoutineFacts = {
  /** Today in the organization's time zone, YYYY-MM-DD. */
  today: string;
  /** Items waiting per counter. A counter that is missing was not read: not allowed for this person, or it failed. */
  counts: Partial<Record<CounterKey, number>>;
  /** Counters that could not be read, with the reason in plain English. */
  failed: Partial<Record<CounterKey, string>>;
  /** Events starting in the next 7 days that this person can see, nearest first. */
  events: readonly FactEvent[];
  /** How the community writes numbers and days ("en-US", "en-IN"); the generic English convention when missing. */
  locale?: string;
  /** The community's working week (its own setting, else its country's convention); the country's when missing. */
  workWeek?: WorkWeek;
  /** The payment ways the community has switched on; null or missing when they are not known (steps then do not name one). */
  paymentPlugins?: readonly string[] | null;
};

export type StepState =
  /** A counter says it is done. */
  | "done"
  /** A counter says there is work left. */
  | "open"
  /** It has a counter, but the counter could not be read: the person checks by hand. */
  | "unknown"
  /** No counter: the person ticks it. */
  | "by_hand";

export type ResolvedStep = {
  key: string;
  title: string;
  why: string;
  href: string;
  when: RoutineWhen;
  /** The roles whose routine contains the step (shown only when the person holds more than one). */
  roleTitles: string[];
  state: StepState;
  tag: "Auto-checked" | "You do this";
  /** One short line about where the step stands ("3 applications waiting", "You tick this one yourself"). */
  detail: string;
  /** For a step that is due because of an event: "Diwali Dinner, in 2 days". */
  eventNote?: string;
  ask?: string;
};

export type ResolvedGroup = { when: RoutineWhen; label: string; steps: ResolvedStep[] };

/** A step that exists in the person's routine but is not due today. */
export type LaterStep = { key: string; title: string; when: RoutineWhen; dueText: string; roleTitles: string[] };

export type ResolvedRoutine = {
  roles: { key: RoutineRole; title: string }[];
  /** The roles Weaver has a starting routine for in this community, as plural phrases ("treasurers"), for the empty state. */
  startingRoles?: string[];
  /** Steps due today, grouped by when, groups in a fixed order, empty groups left out. */
  groups: ResolvedGroup[];
  later: LaterStep[];
  /** Counted as the page loads (nothing ticked by hand yet); see routineProgress for the live numbers. */
  total: number;
  done: number;
  left: number;
};

// ---------------------------------------------------------------------------
// Who gets which routine, and which steps they may do
// ---------------------------------------------------------------------------

/** The routines this person holds: a role granted to them (any scope), plus the administrator routine for the organization's owner. */
export function routineRolesFor(viewer: Pick<ScopedContext, "grants" | "isOwner">): RoutineRole[] {
  const held = new Set<string>((viewer.grants ?? []).map((g) => g.role_key));
  if (viewer.isOwner) held.add("center_admin");
  return ROUTINE_ROLES.filter((r) => held.has(r));
}

/** The module a step belongs to by where it opens (a step may also name one itself). */
function modulesOf(step: RoutineStep): string[] {
  const path = step.href.split("?")[0].replace("{event}", "x");
  const fromPath = moduleForPath(path);
  return [step.module, fromPath].filter((m): m is NonNullable<typeof m> => Boolean(m));
}

/**
 * True when the person may do the step, every module it needs is switched on and offered by the community's kind, and (when the
 * community's payment ways are known) it has the kind of payment way the step is about.
 */
export function stepApplies(viewer: ScopedContext, step: RoutineStep, paymentPlugins?: readonly string[] | null): boolean {
  if (!modulesOf(step).every((m) => isModuleEnabled(viewer, m) && !(viewer.kind && moduleNotOffered(viewer.kind, m)))) return false;
  const family = step.needsPaymentFamily;
  if (family && paymentPlugins && !PAYMENT_PLUGINS.some((p) => p.family === family && paymentPlugins.includes(p.key))) return false;
  if (canAccess(viewer, step.access)) return true;
  return Boolean(step.orRoles && step.orRoles.length > 0 && hasRole(viewer, ...step.orRoles));
}

// ---------------------------------------------------------------------------
// Is a step due today?
// ---------------------------------------------------------------------------
type Due = { due: boolean; dueText: string; event?: FactEvent };

function dueFor(step: RoutineStep, facts: RoutineFacts): Due {
  const { weekday, dayOfMonth } = dateParts(facts.today);
  const locale = facts.locale ?? DEFAULT_LOCALE;
  switch (step.when) {
    case "every_sign_in":
      return { due: true, dueText: "Every sign-in" };
    case "weekly": {
      const week = facts.workWeek ?? regionalWorkWeek(locale);
      const pinned = step.weekday;
      const day = typeof pinned === "number" ? pinned : pinned === "end" ? week.end : week.start;
      return { due: weekday === day, dueText: `${weekdayName(day, locale)}s` };
    }
    case "month_end": {
      const from = step.fromDay ?? 25;
      return { due: dayOfMonth >= from, dueText: `From the ${ordinal(from)}` };
    }
    case "before_event": {
      const within = step.daysBefore ?? 2;
      const event = facts.events.find((e) => e.days >= 1 && e.days <= within);
      return { due: Boolean(event), dueText: `When an event is ${within === 1 ? "a day" : `${within} days`} away`, event };
    }
    case "event_day": {
      const event = facts.events.find((e) => e.days === 0);
      return { due: Boolean(event), dueText: "On the day of an event", event };
    }
  }
}

function eventNote(step: RoutineStep, event: FactEvent | undefined): string | undefined {
  if (!event) return undefined;
  if (step.when === "event_day") return `${event.name}, today`;
  return `${event.name}, ${event.days === 1 ? "tomorrow" : `in ${event.days} days`}`;
}

// ---------------------------------------------------------------------------
// Where a step stands
// ---------------------------------------------------------------------------
function stateFor(step: RoutineStep, facts: RoutineFacts, words: RoutineWords): { state: StepState; detail: string } {
  if (!step.signal) return { state: "by_hand", detail: "You tick this one yourself" };
  const def = COUNTERS[step.signal];
  const n = facts.counts[step.signal];
  if (n === undefined) {
    const why = facts.failed[step.signal];
    return why
      ? { state: "unknown", detail: `Could not check this automatically (${why.replace(/[.\s]+$/, "")}). Look at it yourself` }
      : { state: "by_hand", detail: "You tick this one yourself" };
  }
  return n === 0 ? { state: "done", detail: textOf(def.done, words) } : { state: "open", detail: def.waiting(n, words) };
}

// ---------------------------------------------------------------------------
// The whole routine
// ---------------------------------------------------------------------------
export function resolveRoutine(viewer: ScopedContext, facts: RoutineFacts): ResolvedRoutine {
  const roles = routineRolesFor(viewer);
  const due = new Map<string, ResolvedStep>();
  const later = new Map<string, LaterStep>();
  const kind = viewer.kind ?? NO_KIND;
  const words = routineWords(kind, { locale: facts.locale, plugins: facts.paymentPlugins });

  for (const role of roles) {
    const roleTitle = routineRoleTitle(role, kind);
    for (const step of RECIPES[role]) {
      if (!stepApplies(viewer, step, facts.paymentPlugins)) continue;
      // Only on the days it applies: attendance matters on a day a class meets.
      if (step.onlyIf && facts.counts[step.onlyIf] === 0) continue;

      const seen = due.get(step.key) ?? later.get(step.key);
      if (seen) {
        if (!seen.roleTitles.includes(roleTitle)) seen.roleTitles.push(roleTitle);
        continue;
      }

      const d = dueFor(step, facts);
      if (!d.due) {
        later.set(step.key, { key: step.key, title: textOf(step.title, words), when: step.when, dueText: d.dueText, roleTitles: [roleTitle] });
        continue;
      }
      const { state, detail } = stateFor(step, facts, words);
      due.set(step.key, {
        key: step.key,
        title: textOf(step.title, words),
        why: textOf(step.why, words),
        href: step.href.replace("{event}", d.event?.id ?? ""),
        when: step.when,
        roleTitles: [roleTitle],
        state,
        tag: state === "done" || state === "open" ? "Auto-checked" : "You do this",
        detail,
        eventNote: eventNote(step, d.event),
        ask: step.ask === undefined ? undefined : textOf(step.ask, words),
      });
    }
  }

  const groups = ROUTINE_WHEN.map((when) => ({ when, label: WHEN_LABEL[when], steps: [...due.values()].filter((s) => s.when === when) })).filter(
    (g) => g.steps.length > 0,
  );
  const schoolOffered = !(viewer.kind && moduleNotOffered(viewer.kind, "pathshala")) && isModuleEnabled(viewer, "pathshala");
  const base = {
    roles: roles.map((key) => ({ key, title: routineRoleTitle(key, kind) })),
    startingRoles: startingRoleNames(kind, schoolOffered),
    groups,
    later: [...later.values()],
  };
  return { ...base, ...routineProgress({ groups }) };
}

// ---------------------------------------------------------------------------
// Progress, with what the person has ticked by hand on this page
// ---------------------------------------------------------------------------

/** Only a step nobody can count (by hand, or whose counter failed) is ticked by the person; the data decides the rest. */
export function isHandTickable(step: Pick<ResolvedStep, "state">): boolean {
  return step.state === "by_hand" || step.state === "unknown";
}

export function stepIsDone(step: Pick<ResolvedStep, "key" | "state">, ticked: ReadonlySet<string>): boolean {
  return step.state === "done" || (isHandTickable(step) && ticked.has(step.key));
}

export function routineProgress(routine: Pick<ResolvedRoutine, "groups">, ticked: Iterable<string> = []): { total: number; done: number; left: number } {
  const set = new Set(ticked);
  const steps = routine.groups.flatMap((g) => g.steps);
  const done = steps.filter((s) => stepIsDone(s, set)).length;
  return { total: steps.length, done, left: steps.length - done };
}

/** The first step still to do, in the order shown: the one to highlight. */
export function nextStep(routine: Pick<ResolvedRoutine, "groups">, ticked: Iterable<string> = []): ResolvedStep | null {
  const set = new Set(ticked);
  for (const g of routine.groups) for (const s of g.steps) if (!stepIsDone(s, set)) return s;
  return null;
}
