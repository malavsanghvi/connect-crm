// Automation ideas in plain English (Settings › Automation ideas). Pure functions, no server imports.
//
// The database (0622) finds repeated sequences of actions and keeps, per community and role, the keys of the steps, how
// often, by how many people and how long it takes. This file turns one such row into the sentence an administrator reads:
//
//   After you record a payment you usually confirm a bank match.
//   Done about 18 times a month by 3 people, about 40 minutes a month.
//
// Nothing here ever reads or prints an id, a person's name or a value: the words come from the catalog's plain labels
// (app.activity_catalog) and the numbers are counts.

export const IDEA_STATUSES = ["new", "accepted", "dismissed", "built"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

export const IDEA_KINDS = ["routine", "niva_command", "playbook", "scheduled_job", "default"] as const;
export type IdeaKind = (typeof IDEA_KINDS)[number];

/** The columns of app.automation_candidates the screen needs (never an actor, never a decision's author). */
export type IdeaRow = {
  id: string;
  role_key: string;
  pattern: readonly string[];
  support: number;
  distinct_actors: number;
  median_seconds: number;
  minutes_per_month: number;
  score: number;
  suggested_kind: string;
  status: string;
  last_seen: string;
};

/** A key's plain label, by key (an action key has one label for the portal and none for the member app, or the reverse). */
export type LabelMap = Readonly<Record<string, string>>;
/** A role's name, by role key (public.roles). */
export type RoleNames = Readonly<Record<string, string>>;

export type IdeaCard = {
  id: string;
  status: IdeaStatus;
  /** "After you record a payment you usually confirm a bank match." */
  title: string;
  /** "Done about 18 times a month by 3 people, about 40 minutes a month." */
  facts: string;
  /** Who does it, in words: "Treasurer", "Members in the app". */
  who: string;
  kind: IdeaKind;
  /** The suggestion in a few words: "Something Niva could do for you". */
  kindLabel: string;
  /** One sentence on what that would mean. */
  kindHint: string;
  /** True when the numbers have gone (the pattern is no longer seen); the decision is kept. */
  quiet: boolean;
  score: number;
};

// ── Words ────────────────────────────────────────────────────────────────────

const KIND_WORDS: Record<IdeaKind, { label: string; hint: string }> = {
  routine: {
    label: "A step in a daily routine",
    hint: "Weaver could put this on the daily list of the people who do it.",
  },
  niva_command: {
    label: "Something Niva could do for you",
    hint: "Niva could do these steps when you ask, and show you the result before anything changes.",
  },
  playbook: {
    label: "A shared checklist",
    hint: "Several people do this, so a written checklist (a playbook) could keep everyone doing it the same way.",
  },
  scheduled_job: {
    label: "A reminder",
    hint: "It happens so regularly that Weaver could remind you, or do it by itself, on a schedule.",
  },
  default: {
    label: "A default value",
    hint: "The first form could start with the usual details already filled in.",
  },
};

export function ideaKind(value: string): IdeaKind {
  return (IDEA_KINDS as readonly string[]).includes(value) ? (value as IdeaKind) : "routine";
}

export function ideaStatus(value: string): IdeaStatus {
  return (IDEA_STATUSES as readonly string[]).includes(value) ? (value as IdeaStatus) : "new";
}

/** A role key in words when the role has no name on file: "event_lead" -> "Event lead". */
function humanize(text: string): string {
  const words = text.replace(/[_.]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

export function roleLabel(roleKey: string, names: RoleNames = {}): string {
  const named = names[roleKey];
  if (named) return named;
  if (roleKey === "member") return "Members in the app";
  if (roleKey === "staff") return "Staff";
  if (roleKey === "owner") return "The owner";
  return humanize(roleKey);
}

/**
 * The label of a step as a phrase that follows "you": "Record a payment" -> "record a payment". A first word that has a
 * capital inside it (RSVP, QuickBooks, WhatsApp) keeps its capitals. A key with no label becomes its last part in words
 * ("giving.record_payment" -> "record payment").
 */
export function stepPhrase(key: string, labels: LabelMap): string {
  const label = (labels[key] ?? "").trim();
  const text = label || (key.split(".").pop() ?? key).replace(/_/g, " ");
  const first = text.split(" ")[0] ?? "";
  if (!first || /[A-Z]/.test(first.slice(1))) return text;
  return first[0].toLowerCase() + text.slice(1);
}

/** The sentence for the steps of one idea, in the words of the people who do it. */
export function ideaTitle(pattern: readonly string[], role: string, labels: LabelMap): string {
  const steps = pattern.map((key) => stepPhrase(key, labels));
  if (steps.length === 0) return "A repeated task";
  if (steps.length === 1) return `You often ${steps[0]}.`;
  if (role === "member") {
    return `Members often go through these steps in a row: ${steps.join(", then ")}.`;
  }
  const [first, ...rest] = steps;
  return `After you ${first} you usually ${rest.join(", then ")}.`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "less than a minute", "about 40 minutes", "about 2.5 hours" (a whole number of minutes up to two hours, then hours). */
export function minutesPhrase(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 1) return "less than a minute";
  if (minutes < 120) return `about ${plural(Math.round(minutes), "minute", "minutes")}`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `about ${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours`;
}

/** How many times a month the idea happens: the minutes it adds up to, divided by the minutes one run takes. */
export function timesPerMonth(minutesPerMonth: number, medianSeconds: number): number | null {
  if (!(medianSeconds > 0) || !(minutesPerMonth > 0)) return null;
  const times = (minutesPerMonth * 60) / medianSeconds;
  return Number.isFinite(times) ? times : null;
}

/** The numbers of an idea as one sentence. A decided idea whose pattern is no longer seen has no numbers. */
export function ideaFacts(row: Pick<IdeaRow, "support" | "distinct_actors" | "median_seconds" | "minutes_per_month">): string {
  if (row.support <= 0 || row.distinct_actors <= 0) {
    return "Weaver has not seen this lately, so there are no numbers to show. Your answer is kept.";
  }
  const people = plural(row.distinct_actors, "person", "people");
  const times = timesPerMonth(row.minutes_per_month, row.median_seconds);
  const often =
    times === null ? `Seen ${plural(row.support, "time", "times")}` : times < 1 ? "Done less than once a month" : `Done about ${plural(Math.round(times), "time", "times")} a month`;
  return `${often} by ${people}, ${minutesPhrase(row.minutes_per_month)} a month.`;
}

export function buildIdeaCard(row: IdeaRow, labels: LabelMap, roles: RoleNames = {}): IdeaCard {
  const kind = ideaKind(row.suggested_kind);
  return {
    id: row.id,
    status: ideaStatus(row.status),
    title: ideaTitle(row.pattern, row.role_key, labels),
    facts: ideaFacts(row),
    who: roleLabel(row.role_key, roles),
    kind,
    kindLabel: KIND_WORDS[kind].label,
    kindHint: KIND_WORDS[kind].hint,
    quiet: row.support <= 0 || row.distinct_actors <= 0,
    score: row.score,
  };
}

export type IdeaGroups = { fresh: IdeaCard[]; accepted: IdeaCard[]; dismissed: IdeaCard[] };

/** New ideas (best first), the ones accepted or already built, and the ones marked not useful. */
export function groupIdeas(rows: readonly IdeaRow[], labels: LabelMap, roles: RoleNames = {}): IdeaGroups {
  const cards = rows.map((row) => buildIdeaCard(row, labels, roles));
  const best = (a: IdeaCard, b: IdeaCard) => b.score - a.score;
  return {
    fresh: cards.filter((c) => c.status === "new").sort(best),
    accepted: cards.filter((c) => c.status === "accepted" || c.status === "built").sort(best),
    dismissed: cards.filter((c) => c.status === "dismissed").sort(best),
  };
}

// ── Answering an idea ────────────────────────────────────────────────────────

/** What a person can do with an idea. */
export type IdeaDecision = "accept" | "dismiss" | "restore";

const TARGET: Record<IdeaDecision, IdeaStatus> = { accept: "accepted", dismiss: "dismissed", restore: "new" };

/**
 * Where each status may go. "built" is Weaver's to set when it has built the thing, so a person cannot move an idea to it
 * or away from it here; an idea can be accepted from "new" only, so a dismissed idea is brought back first.
 */
const NEXT: Record<IdeaStatus, readonly IdeaStatus[]> = {
  new: ["accepted", "dismissed"],
  accepted: ["dismissed", "new"],
  dismissed: ["new"],
  built: [],
};

export function isIdeaDecision(value: unknown): value is IdeaDecision {
  return value === "accept" || value === "dismiss" || value === "restore";
}

export function decisionTarget(decision: IdeaDecision): IdeaStatus {
  return TARGET[decision];
}

export function canMoveIdea(from: IdeaStatus, to: IdeaStatus): boolean {
  return NEXT[from].includes(to);
}

/** The buttons an idea in this status shows. */
export function allowedDecisions(from: IdeaStatus): IdeaDecision[] {
  return (Object.keys(TARGET) as IdeaDecision[]).filter((d) => canMoveIdea(from, TARGET[d]));
}

export const MAX_REASON_LENGTH = 500;

/** The optional reason: trimmed, empty means none. A reason longer than the limit is refused, not cut. */
export function parseIdeaReason(value: unknown): { ok: true; reason: string | null } | { ok: false } {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return { ok: true, reason: null };
  return text.length <= MAX_REASON_LENGTH ? { ok: true, reason: text } : { ok: false };
}

// ── "How the community uses Weaver" (app.activity_usage: counts only) ────────

/** One row of app.activity_usage. */
export type UsageRow = {
  item_key: string;
  item_kind: string;
  surface: string;
  events: number;
  errors: number;
};

export type UsageLine = { label: string; where: "portal" | "app"; times: number; failed: number };
export type UsageSummary = {
  /** Everything counted, and where it happened. */
  total: number;
  inPortal: number;
  inApp: number;
  screens: UsageLine[];
  actions: UsageLine[];
};

function topLines(rows: readonly UsageRow[], kind: "screen" | "action", labels: LabelMap, limit: number): UsageLine[] {
  const byKey = new Map<string, UsageLine>();
  for (const r of rows) {
    if (r.item_kind !== kind) continue;
    const where = r.surface === "member" ? "app" : "portal";
    const label =
      labels[`${r.surface}|${r.item_key}`] ||
      labels[r.item_key] ||
      (kind === "screen" ? humanize(r.item_key.replace(/^screen:\/?/, "").replace(/\[[a-z_]+\]/g, "").replace(/\/+/g, " ")) || "Home" : humanize((r.item_key.split(".").pop() ?? r.item_key).replace(/_/g, " ")));
    const id = `${where}|${r.item_key}`;
    const line = byKey.get(id) ?? { label, where, times: 0, failed: 0 };
    line.times += Number(r.events) || 0;
    line.failed += Number(r.errors) || 0;
    byKey.set(id, line);
  }
  return [...byKey.values()].sort((a, b) => b.times - a.times || a.label.localeCompare(b.label)).slice(0, limit);
}

/** A catalog row, as the screens read it (key, plain label, surface). */
export type CatalogLabelRow = { key: string; label: string; surface: string };

/** The labels by key (the portal's wins when both surfaces list the key) and by "surface|key". */
export function buildLabelMap(rows: readonly CatalogLabelRow[]): Record<string, string> {
  const map: Record<string, string> = {};
  const ordered = [...rows].sort((a, b) => (a.surface === b.surface ? 0 : a.surface === "portal" ? -1 : 1));
  for (const r of ordered) {
    map[`${r.surface}|${r.key}`] = r.label;
    if (!(r.key in map)) map[r.key] = r.label;
  }
  return map;
}

/**
 * The usage rows as a short summary: totals by where it happened and the busiest screens and actions. Rows from fewer than
 * three people never reach this (the database leaves them out), and the people are not counted here: a person who used
 * three screens is in three rows, so adding them would overstate the group.
 */
export function summariseUsage(rows: readonly UsageRow[], labels: LabelMap, limit = 6): UsageSummary {
  let inPortal = 0;
  let inApp = 0;
  for (const r of rows) {
    const n = Number(r.events) || 0;
    if (r.surface === "member") inApp += n;
    else inPortal += n;
  }
  return {
    total: inPortal + inApp,
    inPortal,
    inApp,
    screens: topLines(rows, "screen", labels, limit),
    actions: topLines(rows, "action", labels, limit),
  };
}
