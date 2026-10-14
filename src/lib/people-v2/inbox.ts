// The Inbox on the People home: what waits for a decision, as rows. Pure: it takes what `people.pending_reviews` answered and decides
// what each row says and offers. The decisions themselves run through the same two commands the classic screens use
// (people.decide_application, people.decide_household_request), so permissions, the audit trail and Niva stay shared.

import type { PendingReviewsData } from "@/lib/commands/catalog/people/pending-reviews";
import { formatDate } from "@/lib/dates";
import { householdCardLine } from "@/lib/find/labels";
import { RELATIONSHIP_OPTIONS } from "@/lib/people";

/** The words the command uses for an applicant a role may not see (a child, or one outside the role's reach). */
export const HIDDEN_APPLICANT = "someone you can't see";

export type InboxApproval =
  | {
      kind: "approve";
      /** The button: "Approve", or "Record center review" when an Executive Committee step follows. */
      label: string;
      /** The question asked inline before anything is written. */
      confirm: string;
      /** The button that confirms: "Yes, approve". */
      yes: string;
    }
  | { kind: "blocked"; sentence: string };

export type InboxApplicationRow = {
  type: "application";
  id: string;
  who: string;
  /** "Yearly membership · fee $50.00". */
  what: string;
  /** "Waiting for the center review" / "Waiting for the Executive Committee". */
  step: string;
  /** "waiting 9 days", "sent today". */
  waited: string;
  /** "Since Oct 3". */
  since: string;
  /** The household card line, or null when the role cannot see that household. */
  cardLine: string | null;
  familyHref: string | null;
  approval: InboxApproval;
};

export type InboxRequestRow = {
  type: "request";
  id: string;
  who: string;
  what: string;
  /** What the member typed as the relationship ("brother"), if anything. */
  asked: string | null;
  /** That, when it is one of the relationships a person can be given. Preselected on the chips. */
  askedRole: string | null;
  waited: string;
  since: string;
  cardLine: string | null;
  familyHref: string | null;
};

export type InboxModel = {
  applications: InboxApplicationRow[];
  /** All that wait (the list holds the oldest few); null when the role cannot see applications. */
  applicationsTotal: number | null;
  requests: InboxRequestRow[];
  requestsTotal: number;
  /** Requests that mention a child: counted only, decided on the family requests screen. */
  forScreen: number;
  note: string | null;
  /** The relationships an approver can give (never "primary"). */
  roles: { value: string; label: string }[];
  duplicates: { count: number | null; href: string } | null;
  applicationsHref: string;
  requestsHref: string;
};

/** "sent today", "waiting 1 day", "waiting 9 days": whole days between two instants (never negative). */
export function waitedText(sinceIso: string, nowIso: string): string {
  const days = Math.max(0, Math.floor((Date.parse(nowIso) - Date.parse(sinceIso)) / 86_400_000));
  if (!Number.isFinite(days) || days === 0) return "sent today";
  return days === 1 ? "waiting 1 day" : `waiting ${days} days`;
}

/** A refusal from the decision rule, said the way a person would: who the row is waiting for. */
export function blockedSentence(reason: string): string {
  if (/different executive committee member/i.test(reason)) return "Waiting for a different Executive Committee member: you made the center review.";
  if (/executive committee/i.test(reason)) return "Waiting for an Executive Committee member.";
  const sentence = reason.trim().replace(/^./, (c) => c.toUpperCase());
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function approvalFor(app: PendingReviewsData["applications"][number]): InboxApproval {
  const them = app.applicant === HIDDEN_APPLICANT ? "this applicant" : app.applicant;
  if (app.next === "approved") {
    return {
      kind: "approve",
      label: "Approve",
      confirm: `Approve ${them}'s ${app.tier} membership? It becomes active now${app.fee ? ` and the ${app.fee} fee is recorded as an open pledge` : ""}.`,
      yes: "Yes, approve",
    };
  }
  if (app.next === "awaiting_ec") {
    return {
      kind: "approve",
      label: "Record center review",
      confirm: `Record the center review for ${them}'s ${app.tier} application? It then waits for the Executive Committee.`,
      yes: "Yes, record it",
    };
  }
  return { kind: "blocked", sentence: blockedSentence(app.blocked ?? "it cannot be approved by you right now") };
}

export function buildInbox(
  data: PendingReviewsData,
  opts: { now: string; timeZone: string; duplicates: InboxModel["duplicates"]; applicationsHref: string; requestsHref: string },
): InboxModel {
  const card = (c: PendingReviewsData["applications"][number]["household"]) => ({ cardLine: c ? householdCardLine(c) : null, familyHref: c ? `/households/${c.household_id}` : null });
  return {
    applications: data.applications.map<InboxApplicationRow>((a) => ({
      type: "application",
      id: a.id,
      who: a.applicant,
      what: `${a.tier} membership${a.fee ? ` · fee ${a.fee}` : ""}`,
      step: `${a.step.charAt(0).toUpperCase()}${a.step.slice(1)}`,
      waited: waitedText(a.since, opts.now),
      since: `Since ${formatDate(a.since, opts.timeZone)}`,
      ...card(a.household),
      approval: approvalFor(a),
    })),
    applicationsTotal: data.applications_total,
    requests: data.family_requests.map<InboxRequestRow>((r) => ({
      type: "request",
      id: r.id,
      who: r.who,
      what: `Add ${r.who} to the family`,
      asked: r.asked,
      askedRole: r.asked_role,
      waited: waitedText(r.since, opts.now),
      since: `Since ${formatDate(r.since, opts.timeZone)}`,
      ...card(r.household),
    })),
    requestsTotal: data.family_requests_total,
    forScreen: data.family_requests_for_the_screen,
    note: data.note ?? null,
    roles: RELATIONSHIP_OPTIONS.filter((o) => o.value !== "primary").map((o) => ({ value: o.value, label: o.label })),
    duplicates: opts.duplicates,
    applicationsHref: opts.applicationsHref,
    requestsHref: opts.requestsHref,
  };
}

/** What is waiting in all: "5 waiting", or null when nothing could be counted. */
export function waitingCount(m: Pick<InboxModel, "applicationsTotal" | "requestsTotal" | "duplicates">): number {
  return (m.applicationsTotal ?? 0) + m.requestsTotal + (m.duplicates?.count ?? 0);
}
