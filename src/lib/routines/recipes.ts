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
// D2 (nothing about a child goes to an AI provider): the counters here are counts only, never names, and no step that is
// about Pathshala learners carries a question for Niva.

import type { AccessKey } from "@/lib/permissions";
import type { ModuleKey } from "@/lib/modules";

import { countOf } from "./clock";

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
  pathshala_principal: "Pathshala principal",
};

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
  done: string;
  /** What it says otherwise. Counters that are task rows rather than exact counts ignore `n`. */
  waiting: (n: number) => string;
};

export const COUNTERS: Record<CounterKey, CounterDef> = {
  giving_approvals: { done: "No approvals are waiting", waiting: (n) => `${countOf(n, "approval")} waiting` },
  voting_overrides: { done: "No eligibility overrides are waiting", waiting: (n) => `${countOf(n, "override")} waiting` },
  credits: { done: "No credits are waiting", waiting: (n) => `${countOf(n, "credit")} to handle` },
  deposits: { done: "Every bank line and Zelle report is matched", waiting: () => "Bank lines or Zelle reports are waiting to be matched" },
  quickbooks_problems: { done: "QuickBooks has nothing waiting", waiting: () => "QuickBooks refused some entries" },
  role_requests: { done: "No role changes are waiting", waiting: () => "A role change is waiting for a second person" },
  privacy_requests: { done: "No data requests are open", waiting: () => "Data requests are open" },
  volunteer_waivers: { done: "Every volunteer has signed their waiver", waiting: () => "Some volunteers have not signed their waiver" },
  applications: { done: "No applications are waiting", waiting: (n) => `${countOf(n, "application")} waiting` },
  bank_lines: { done: "Every bank line is matched", waiting: (n) => `${countOf(n, "bank line")} to match` },
  pledges_overdue: { done: "No pledges are past their due date", waiting: (n) => `${countOf(n, "pledge")} past their due date` },
  pledges_due_week: { done: "No pledges fall due this week", waiting: (n) => `${countOf(n, "pledge")} fall${n === 1 ? "s" : ""} due this week` },
  events_week: { done: "No events in the next 7 days", waiting: (n) => `${countOf(n, "event")} in the next 7 days` },
  classes_today: { done: "No classes meet today", waiting: (n) => `${countOf(n, "class", "classes")} meet today` },
  attendance_missing: {
    done: "Attendance is recorded for every class today",
    waiting: (n) => `${countOf(n, "class", "classes")} without attendance so far`,
  },
  pathshala_to_place: { done: "No registrations are waiting to be placed", waiting: (n) => `${countOf(n, "registration")} waiting to be placed` },
  pathshala_assistance: { done: "No fee assistance requests are waiting", waiting: (n) => `${countOf(n, "request")} to decide` },
  gyan_signoffs: { done: "No sign-offs are waiting on teachers", waiting: (n) => `${countOf(n, "sign-off")} waiting on teachers` },
};

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------
export type RoutineStep = {
  /** Stable key, also used as the "by hand" tick. Prefixed by the area it belongs to. */
  key: string;
  /** Plain English, an instruction ("Match bank lines to gifts"). */
  title: string;
  /** One sentence: why this step matters. */
  why: string;
  /** Where the step opens. "/events/{event}" is filled with the event that makes the step due. */
  href: string;
  when: RoutineWhen;
  /** weekly: the day of the week it is due (0 = Sunday … 6 = Saturday). */
  weekday?: number;
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
  /** The counter that ticks the step. Without one the step is "by hand". */
  signal?: CounterKey;
  /** The step is shown only while this counter is above zero (attendance, on class days). */
  onlyIf?: CounterKey;
  /** A question Niva can start from. Never for a step about learners (D2), and never with a name in it. */
  ask?: string;
};

const FRIDAY = 5;
const MONDAY = 1;

/** Shared by two roles: the same step, so a person with both sees it once. */
const DATA_QUALITY: RoutineStep = {
  key: "people.data-quality",
  title: "Tidy duplicate and incomplete records",
  why: "Possible duplicate households and missing contact details are easier to fix a few at a time.",
  href: "/settings/data-quality",
  when: "weekly",
  weekday: MONDAY,
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
      weekday: MONDAY,
      access: "setup",
    },
    {
      key: "admin.sensitive-changes",
      title: "Read last week's sensitive changes",
      why: "Role grants, exports and payment-detail changes are all listed in the audit log.",
      href: "/settings/audit",
      when: "weekly",
      weekday: MONDAY,
      access: "audit",
      ask: "What sensitive changes were made last week?",
    },
    {
      key: "admin.connections",
      title: "Check that connections still work",
      why: "QuickBooks, email and texting stop working quietly when a sign-in expires.",
      href: "/settings/integrations",
      when: "weekly",
      weekday: MONDAY,
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
      title: "Match bank lines and Zelle payments to gifts",
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
      title: "Record the weekend's checks and cash",
      why: "Each one is a payment for a household, picked from its card.",
      href: "/giving/payments",
      when: "weekly",
      weekday: MONDAY,
      access: "recordPayment",
    },
    {
      key: "treasurer.pledge-aging",
      title: "Look at pledges that are behind",
      why: "Households past their due date are easiest to reach while the pledge is still recent.",
      href: "/giving/pledges",
      when: "weekly",
      weekday: FRIDAY,
      access: "pledges",
      signal: "pledges_overdue",
      ask: "Which pledges are behind, oldest first?",
    },
    {
      key: "treasurer.recurring-failed",
      title: "Look at recurring gifts that failed",
      why: "Those households need a message before the next cycle.",
      href: "/giving/recurring",
      when: "weekly",
      weekday: FRIDAY,
      access: "recurring",
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
      why: "Banks matched, the QuickBooks queue empty and refunds settled; then lock the month with a fresh security code.",
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
      title: "Follow up Gyan Path sign-offs waiting on teachers",
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
      weekday: FRIDAY,
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
