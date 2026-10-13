// Routines: the starting recipe for each role (B80, docs/ADMIN_REDESIGN.md "Routines (recipes by role)").
// A routine is an ordered checklist that meets a person at sign-in with what is due today.
//
// Pure data and no database: Weaver supplies these starting recipes; decision D5 (who edits a routine) comes later and
// will move them to a table administrators can change. Until then they live here, in code.
//
// A step ticks itself only when the system already knows the answer: it names a `signal`, a counter that
// src/lib/data/today.ts (or the Home task list) already reads. A step without a signal is "by hand": the person ticks it, and the
// tick is not remembered (remembering it needs a small table, a later step).
//
// Built for every organization: a step's words come from the community (its kind's name for its school, the payment ways it has
// switched on, the way it writes numbers), and a step's day comes from the community's working week, not from a fixed Monday or
// Friday. A step for a module or a payment way the community does not have is left out.
//
// D2 (nothing about a child goes to an AI provider): the counters here are counts only, never names, and no step that is
// about the school's learners carries a question for Niva.

import { DEFAULT_LOCALE } from "@/lib/community-format";
import { checkWord, learningWord, principalTitle, sample, schoolOrGeneric } from "@/lib/kind-samples";
import type { KindProfile } from "@/lib/kind";
import { PAYMENT_PLUGINS, type PluginFamily } from "@/lib/payments/plugins/catalog";
import type { AccessKey } from "@/lib/permissions";
import type { ModuleKey } from "@/lib/modules";

import { countOf } from "./clock";

// ---------------------------------------------------------------------------
// The words a recipe is written in, worked out for one community
// ---------------------------------------------------------------------------
export type RoutineWords = {
  /** What the kind calls its school ("Pathshala", "Religious school"), or the plain word "school". */
  school: string;
  /** What the kind calls its learning path, or "learning path". */
  learning: string;
  /** What owed money is called in a sentence ("pledges", "dues and pledges"). */
  pledges: string;
  /** How the community writes numbers. */
  locale: string;
  /** The payment ways switched on (plugin keys); null when they are not known. */
  plugins: readonly string[] | null;
};

/** A text a recipe writes: plain, or worked out from the community's words. */
export type Text = string | ((w: RoutineWords) => string);

export function textOf(t: Text, w: RoutineWords): string {
  return typeof t === "function" ? t(w) : t;
}

type RoutineKind = Pick<KindProfile, "terms" | "modules" | "usesTradition">;

/** The words for a community: from its kind, its payment ways and its number convention. Nothing here names a tradition. */
export function routineWords(kind: RoutineKind, extra: { locale?: string; plugins?: readonly string[] | null } = {}): RoutineWords {
  return {
    school: schoolOrGeneric(kind),
    learning: learningWord(kind) ?? "learning path",
    pledges: sample(kind, "pledges"),
    locale: extra.locale ?? DEFAULT_LOCALE,
    plugins: extra.plugins ?? null,
  };
}

/** The names of the payment ways members report themselves and the bank confirms (Zelle, for one), among those switched on. */
function reportedWays(w: RoutineWords): string[] {
  const on = w.plugins;
  return on ? PAYMENT_PLUGINS.filter((p) => p.family === "reported_transfer" && on.includes(p.key)).map((p) => p.label) : [];
}

function joinWords(parts: readonly string[]): string {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** "bank lines and Zelle payments", "bank lines", or (when the payment ways are not known) "bank lines and reported payments". */
function bankAndReported(w: RoutineWords, noun: string): string {
  if (w.plugins === null) return `bank lines and reported ${noun}`;
  const ways = reportedWays(w);
  return ways.length > 0 ? `bank lines and ${joinWords(ways)} ${noun}` : "bank lines";
}

/** "checks and cash": the paper ways the community accepts, or a plain phrase when they are not known. */
function offlineWays(w: RoutineWords): string {
  if (w.plugins === null) return "payments received by hand";
  const ways = [w.plugins.includes("check") ? `${checkWord(w.locale)}s` : "", w.plugins.includes("cash") ? "cash" : ""].filter(Boolean);
  return ways.length > 0 ? joinWords(ways) : "payments received by hand";
}

// ---------------------------------------------------------------------------
// Roles that have a routine (the real role keys of docs/ROLES.md)
// ---------------------------------------------------------------------------
export const ROUTINE_ROLES = ["center_admin", "treasurer", "membership_coordinator", "event_lead", "pathshala_principal"] as const;
export type RoutineRole = (typeof ROUTINE_ROLES)[number];

export const ROUTINE_ROLE_TITLES: Record<RoutineRole, string> = {
  center_admin: "Administrator",
  treasurer: "Treasurer",
  membership_coordinator: "Membership coordinator",
  event_lead: "Event lead",
  pathshala_principal: "School principal",
};

/** A routine's title for a community: the principal of the school carries the kind's own name for it ("Pathshala principal"). */
export function routineRoleTitle(role: RoutineRole, kind?: RoutineKind): string {
  return role === "pathshala_principal" && kind ? principalTitle(kind) : ROUTINE_ROLE_TITLES[role];
}

/** The routines Weaver starts with, as plural phrases for a sentence ("administrators … and Pathshala principals"). */
export function startingRoleNames(kind?: RoutineKind, schoolOffered = true): string[] {
  const names = ["administrators", "treasurers", "membership coordinators", "event leads"];
  return schoolOffered ? [...names, `${routineRoleTitle("pathshala_principal", kind)}s`] : names;
}

// ---------------------------------------------------------------------------
// When a step is due
// ---------------------------------------------------------------------------
export const ROUTINE_WHEN = ["every_sign_in", "weekly", "month_end", "before_event", "event_day"] as const;
export type RoutineWhen = (typeof ROUTINE_WHEN)[number];

/** Group headings, in the order they are shown. */
export const WHEN_LABEL: Record<RoutineWhen, string> = {
  every_sign_in: "Every sign-in",
  weekly: "This week",
  month_end: "Month-end",
  before_event: "Before an event",
  event_day: "Event day",
};

// ---------------------------------------------------------------------------
// Counters that tick steps
// ---------------------------------------------------------------------------
export const COUNTER_KEYS = [
  // Read from the Home task list (src/lib/data/home-tasks.ts): no extra queries.
  "giving_approvals",
  "voting_overrides",
  "credits",
  "deposits",
  "quickbooks_problems",
  "role_requests",
  "privacy_requests",
  "volunteer_waivers",
  // Counted by src/lib/data/today.ts.
  "applications",
  "bank_lines",
  "pledges_overdue",
  "pledges_due_week",
  "events_week",
  "classes_today",
  "attendance_missing",
  "pathshala_to_place",
  "pathshala_assistance",
  "gyan_signoffs",
] as const;
export type CounterKey = (typeof COUNTER_KEYS)[number];

export type CounterDef = {
  /** What the step says when the counter is at zero ("No approvals are waiting"). */
  done: Text;
  /** What it says otherwise. Counters that are task rows rather than exact counts ignore `n`. */
  waiting: (n: number, w: RoutineWords) => string;
};

/** "3 approvals": a count in the community's number convention. */
const count = (n: number, w: RoutineWords, one: string, many?: string) => countOf(n, one, many, w.locale);

function depositsDone(w: RoutineWords): string {
  if (w.plugins === null) return "Every bank line and reported payment is matched";
  const ways = reportedWays(w);
  return ways.length > 0 ? `Every bank line and ${joinWords(ways)} report is matched` : "Every bank line is matched";
}

function depositsWaiting(w: RoutineWords): string {
  if (w.plugins === null) return "Bank lines or reported payments are waiting to be matched";
  const ways = reportedWays(w);
  return ways.length > 0 ? `Bank lines or ${joinWords(ways)} reports are waiting to be matched` : "Bank lines are waiting to be matched";
}

export const COUNTERS: Record<CounterKey, CounterDef> = {
  giving_approvals: { done: "No approvals are waiting", waiting: (n, w) => `${count(n, w, "approval")} waiting` },
  voting_overrides: { done: "No eligibility overrides are waiting", waiting: (n, w) => `${count(n, w, "override")} waiting` },
  credits: { done: "No credits are waiting", waiting: (n, w) => `${count(n, w, "credit")} to handle` },
  deposits: { done: depositsDone, waiting: (_n, w) => depositsWaiting(w) },
  quickbooks_problems: { done: "QuickBooks has nothing waiting", waiting: () => "QuickBooks refused some entries" },
  role_requests: { done: "No role changes are waiting", waiting: () => "A role change is waiting for a second person" },
  privacy_requests: { done: "No data requests are open", waiting: () => "Data requests are open" },
  volunteer_waivers: { done: "Every volunteer has signed their waiver", waiting: () => "Some volunteers have not signed their waiver" },
  applications: { done: "No applications are waiting", waiting: (n, w) => `${count(n, w, "application")} waiting` },
  bank_lines: { done: "Every bank line is matched", waiting: (n, w) => `${count(n, w, "bank line")} to match` },
  pledges_overdue: { done: "No pledges are past their due date", waiting: (n, w) => `${count(n, w, "pledge")} past their due date` },
  pledges_due_week: { done: "No pledges fall due this week", waiting: (n, w) => `${count(n, w, "pledge")} fall${n === 1 ? "s" : ""} due this week` },
  events_week: { done: "No events in the next 7 days", waiting: (n, w) => `${count(n, w, "event")} in the next 7 days` },
  classes_today: { done: "No classes meet today", waiting: (n, w) => `${count(n, w, "class", "classes")} meet today` },
  attendance_missing: {
    done: "Attendance is recorded for every class today",
    waiting: (n, w) => `${count(n, w, "class", "classes")} without attendance so far`,
  },
  pathshala_to_place: { done: "No registrations are waiting to be placed", waiting: (n, w) => `${count(n, w, "registration")} waiting to be placed` },
  pathshala_assistance: { done: "No fee assistance requests are waiting", waiting: (n, w) => `${count(n, w, "request")} to decide` },
  gyan_signoffs: { done: "No sign-offs are waiting on teachers", waiting: (n, w) => `${count(n, w, "sign-off")} waiting on teachers` },
};

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------
export type RoutineStep = {
  /** Stable key, also used as the "by hand" tick. Prefixed by the area it belongs to. */
  key: string;
  /** Plain English, an instruction ("Match bank lines to gifts"). */
  title: Text;
  /** One sentence: why this step matters. */
  why: Text;
  /** Where the step opens. "/events/{event}" is filled with the event that makes the step due. */
  href: string;
  when: RoutineWhen;
  /**
   * weekly: the day it is due. "start" and "end" are the first and last working day of the community's week (its own setting, else
   * its country's convention); a number (0 = Sunday … 6 = Saturday) pins a day. Default "start".
   */
  weekday?: number | "start" | "end";
  /** month_end: due from this day of the month (default 25). */
  fromDay?: number;
  /** before_event: due when an event starts within this many days (default 2). */
  daysBefore?: number;
  /** What the person needs (an area of the portal, src/lib/permissions.ts ACCESS). */
  access: AccessKey;
  /** Also open to holders of these roles in any scope (an event lead is scoped to one event). */
  orRoles?: readonly string[];
  /** The module the step belongs to, when its link does not say (a switched-off module hides the step). */
  module?: ModuleKey;
  /** The step makes sense only while the community has a payment way of this family switched on (left out when it has none). */
  needsPaymentFamily?: PluginFamily;
  /** The counter that ticks the step. Without one the step is "by hand". */
  signal?: CounterKey;
  /** The step is shown only while this counter is above zero (attendance, on class days). */
  onlyIf?: CounterKey;
  /** A question Niva can start from. Never for a step about learners (D2), and never with a name in it. */
  ask?: Text;
};

const WEEK_END = "end";
const WEEK_START = "start";

/** Shared by two roles: the same step, so a person with both sees it once. */
const DATA_QUALITY: RoutineStep = {
  key: "people.data-quality",
  title: "Tidy duplicate and incomplete records",
  why: "Possible duplicate households and missing contact details are easier to fix a few at a time.",
  href: "/settings/data-quality",
  when: "weekly",
  weekday: WEEK_START,
  access: "dataQuality",
};

export const RECIPES: Record<RoutineRole, readonly RoutineStep[]> = {
  center_admin: [
    {
      key: "admin.role-requests",
      title: "Confirm role changes waiting for a second person",
      why: "Finance and admin roles only take effect when a second, different person confirms them.",
      href: "/settings/roles?show=pending",
      when: "every_sign_in",
      access: "roles",
      signal: "role_requests",
    },
    {
      key: "admin.data-requests",
      title: "Answer open data requests",
      why: "A member asked to see or remove their data, and the clock is running.",
      href: "/privacy/requests",
      when: "every_sign_in",
      access: "privacy",
      signal: "privacy_requests",
    },
    {
      key: "admin.setup",
      title: "See what Setup still needs",
      why: "Unfinished setup is the usual reason something quietly does not work.",
      href: "/setup",
      when: "weekly",
      weekday: WEEK_START,
      access: "setup",
    },
    {
      key: "admin.sensitive-changes",
      title: "Read last week's sensitive changes",
      why: "Role grants, exports and payment-detail changes are all listed in the audit log.",
      href: "/settings/audit",
      when: "weekly",
      weekday: WEEK_START,
      access: "audit",
      ask: "What sensitive changes were made last week?",
    },
    {
      key: "admin.connections",
      title: "Check that connections still work",
      why: "QuickBooks, email and texting stop working quietly when a sign-in expires.",
      href: "/settings/integrations",
      when: "weekly",
      weekday: WEEK_START,
      access: "integrations",
    },
    DATA_QUALITY,
    {
      key: "admin.role-review",
      title: "Review who holds which role",
      why: "Old grants should end, and finance access should be held on purpose.",
      href: "/settings/roles",
      when: "month_end",
      access: "roles",
    },
  ],

  treasurer: [
    {
      key: "treasurer.deposits",
      title: (w) => `Match ${bankAndReported(w, "payments")} to gifts`,
      why: "Money that arrives without a matched gift cannot be receipted.",
      href: "/giving/bank",
      when: "every_sign_in",
      access: "bank",
      signal: "deposits",
    },
    {
      key: "treasurer.approvals",
      title: "Give second approvals on refunds, write-offs and payee changes",
      why: "You cannot approve a request you made yourself, so another person has to.",
      href: "/giving/payments",
      when: "every_sign_in",
      access: "givingApprove",
      signal: "giving_approvals",
    },
    {
      key: "treasurer.credits",
      title: "Decide on credits families asked to keep",
      why: "A family cancelled a paid RSVP pledge and asked to hold the money.",
      href: "/giving/payments",
      when: "every_sign_in",
      access: "givingManage",
      signal: "credits",
    },
    {
      key: "treasurer.quickbooks",
      title: "Fix anything QuickBooks refused",
      why: "Month-end close is blocked until the entries QuickBooks refused are cleared.",
      href: "/accounting/qbo?status=failed",
      when: "every_sign_in",
      access: "qboManage",
      signal: "quickbooks_problems",
    },
    {
      key: "treasurer.offline",
      title: (w) => `Record the week's ${offlineWays(w)}`,
      why: "Each one is a payment for a household, picked from its card.",
      href: "/giving/payments",
      when: "weekly",
      weekday: WEEK_START,
      access: "recordPayment",
    },
    {
      key: "treasurer.pledge-aging",
      title: (w) => `Look at ${w.pledges} that are behind`,
      why: "Households past their due date are easiest to reach while the pledge is still recent.",
      href: "/giving/pledges",
      when: "weekly",
      weekday: WEEK_END,
      access: "pledges",
      signal: "pledges_overdue",
      ask: (w) => `Which ${w.pledges} are behind, oldest first?`,
    },
    {
      key: "treasurer.recurring-failed",
      title: "Look at recurring gifts that failed",
      why: "Those households need a message before the next cycle.",
      href: "/giving/recurring",
      when: "weekly",
      weekday: WEEK_END,
      access: "recurring",
      needsPaymentFamily: "provider_checkout",
    },
    {
      key: "treasurer.month-bank",
      title: "Match every bank line before you close",
      why: "A month cannot be locked with money still unmatched.",
      href: "/giving/bank",
      when: "month_end",
      access: "bank",
      signal: "bank_lines",
    },
    {
      key: "treasurer.close-month",
      title: "Close the month",
      why: "Banks matched, the QuickBooks queue empty and refunds settled; then lock the month.",
      href: "/accounting/close",
      when: "month_end",
      access: "closeManage",
    },
  ],

  membership_coordinator: [
    {
      key: "members.applications",
      title: "Review membership applications",
      why: "Applicants are waiting for an answer.",
      href: "/memberships/applications",
      when: "every_sign_in",
      access: "applicationsDecide",
      signal: "applications",
    },
    {
      key: "members.voting-overrides",
      title: "Answer voting eligibility overrides",
      why: "An override only counts once someone other than the person who asked approves it.",
      href: "/people/voting",
      when: "every_sign_in",
      access: "peopleApprove",
      signal: "voting_overrides",
    },
    {
      key: "members.family-requests",
      title: "Look at family change requests",
      why: "Changes to who is in a household are checked on the screen, and children's details stay out of Niva.",
      href: "/people/requests",
      when: "every_sign_in",
      access: "householdRequestsDecide",
    },
    DATA_QUALITY,
  ],

  event_lead: [
    {
      key: "events.rsvps",
      title: "Check RSVPs against capacity",
      why: "A week ahead there is still time to open the waitlist or add seats.",
      href: "/events/{event}",
      when: "before_event",
      daysBefore: 7,
      access: "events",
      orRoles: ["event_lead"],
    },
    {
      key: "events.waivers",
      title: "Chase volunteers who have not signed their waiver",
      why: "A waiver has to be signed in the member app before check-in duty.",
      href: "/events/{event}",
      when: "before_event",
      daysBefore: 7,
      access: "eventsManage",
      orRoles: ["event_lead"],
      signal: "volunteer_waivers",
    },
    {
      key: "events.meal-counts",
      title: "Send the meal counts to the kitchen",
      why: "The kitchen needs the final headcount by meal choice two days before.",
      href: "/events/{event}",
      when: "before_event",
      daysBefore: 2,
      access: "events",
      orRoles: ["event_lead"],
    },
    {
      key: "events.check-in",
      title: "Open check-in",
      why: "Scan tickets, add walk-ins and set up the stations.",
      href: "/events/{event}",
      when: "event_day",
      access: "events",
      orRoles: ["event_lead"],
    },
  ],

  pathshala_principal: [
    {
      key: "pathshala.placements",
      title: "Place registrations waiting for a class",
      why: "A registration stays on hold until a class is chosen for it.",
      href: "/pathshala/enrollments",
      when: "every_sign_in",
      access: "pathshalaManage",
      module: "pathshala",
      signal: "pathshala_to_place",
    },
    {
      key: "pathshala.assistance",
      title: "Decide fee assistance requests",
      why: "A family cannot be placed or billed until the request is answered.",
      href: "/pathshala/terms",
      when: "every_sign_in",
      access: "pathshalaManage",
      module: "pathshala",
      signal: "pathshala_assistance",
    },
    {
      key: "pathshala.attendance",
      title: "Check attendance was taken for today's classes",
      why: "Teachers take attendance on the class sheet; this only counts the classes that have none yet.",
      href: "/pathshala",
      when: "every_sign_in",
      access: "pathshala",
      module: "pathshala",
      signal: "attendance_missing",
      onlyIf: "classes_today",
    },
    {
      key: "pathshala.signoffs",
      title: (w) => `Follow up ${w.learning} sign-offs waiting on teachers`,
      why: "Students are waiting for a teacher to approve a step they finished.",
      href: "/pathshala/signoffs",
      when: "every_sign_in",
      access: "pathshalaSignoffs",
      module: "pathshala",
      signal: "gyan_signoffs",
    },
    {
      key: "pathshala.announcement",
      title: "Post the class announcement",
      why: "It goes to families, never to children.",
      href: "/pathshala/announcements",
      when: "weekly",
      weekday: WEEK_END,
      access: "pathshalaManage",
      module: "pathshala",
    },
  ],
};

/** Every step of every role, once (a step shared by two roles is listed once). */
export function allSteps(): RoutineStep[] {
  const seen = new Map<string, RoutineStep>();
  for (const role of ROUTINE_ROLES) for (const s of RECIPES[role]) if (!seen.has(s.key)) seen.set(s.key, s);
  return [...seen.values()];
}
