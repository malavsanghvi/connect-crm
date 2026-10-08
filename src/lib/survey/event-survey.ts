// The survey attached to an event (migrations 0544 and 0547): which stage it is in, what can still be done to
// it, and the plain-English sentences the event's Survey tab shows. Pure functions, unit-tested.
//
// The database decides what is allowed (app.update_event_survey, app.remove_event_survey,
// app.launch_event_survey_now); this only mirrors those rules so the page shows the right buttons.

import type { Tone } from "@/components/ui";

import { parseQuestions } from "./questions";

export type EventSurveyRow = {
  status: string;
  opens_at: string | null;
  closes_at: string | null;
  completion_started_at: string | null;
  auto_on_complete: boolean;
  reward_points: number;
  anonymous: boolean;
};

export type EventSurveyStage =
  /** Draft, sends by itself when the event is marked completed. */
  | "waiting"
  /** Draft, not set to send by itself. */
  | "unscheduled"
  /** Draft, the event is completed and the survey has not gone out yet. */
  | "ready"
  /** Draft on an event that was cancelled. */
  | "cancelled"
  /** Opened from Event feedback with a future start (the older "Request feedback" path). */
  | "scheduled"
  | "open"
  | "closed";

export type EventSurveyState = {
  stage: EventSurveyStage;
  /** One word for the status line. */
  label: string;
  tone: Tone;
  /** What happens next, in plain English. */
  detail: string;
  /** The survey has been sent (the launch ran): notifications were queued and the window was set. */
  launched: boolean;
  /** Questions, points, anonymity and automatic sending can still be changed on the event's Survey tab. */
  canEdit: boolean;
  canRemove: boolean;
  /** "Launch now" is offered: a completed event whose draft survey has not been sent. */
  canLaunch: boolean;
};

export function describeEventSurvey(s: EventSurveyRow, eventStatus: string, now: Date = new Date()): EventSurveyState {
  const launched = s.completion_started_at !== null;
  const t = now.getTime();
  const base = { launched, canEdit: false, canRemove: false, canLaunch: false };

  if (s.status === "closed" || (s.status === "open" && s.closes_at && Date.parse(s.closes_at) <= t)) {
    return { ...base, stage: "closed", label: "Closed", tone: "neutral", detail: "It no longer takes answers. The results stay available." };
  }
  if (s.status === "open") {
    if (s.opens_at && Date.parse(s.opens_at) > t) {
      return { ...base, stage: "scheduled", label: "Scheduled", tone: "purple", detail: "It opens in the member app at the time shown below." };
    }
    return {
      ...base,
      stage: "open",
      label: "Open",
      tone: "success",
      detail: launched
        ? "Invited adults can answer in the member app until it closes. Those with the app on a phone get a push and a reminder on day 1 and day 2 until they answer."
        : "It was opened from Event feedback, so it is already visible in the member app.",
    };
  }
  // Draft.
  if (launched) {
    return { ...base, stage: "closed", label: "Draft", tone: "neutral", detail: "It was sent and then put back to draft from Event feedback." };
  }
  const editable = { ...base, canEdit: true, canRemove: true };
  if (eventStatus === "completed") {
    return {
      ...editable,
      canLaunch: true,
      stage: "ready",
      label: "Ready to send",
      tone: "warning",
      detail: "The event is completed but the survey has not gone out yet. Send it now to open it: adults with the app on a phone get a push, and everyone invited sees it on Home.",
    };
  }
  if (eventStatus === "cancelled") {
    return { ...editable, stage: "cancelled", label: "Draft", tone: "neutral", detail: "The event was cancelled, so this survey will not be sent unless the event is restored and completed." };
  }
  if (s.auto_on_complete) {
    return {
      ...editable,
      stage: "waiting",
      label: "Draft",
      tone: "purple",
      detail:
        "Waiting for the event. When you mark it completed, the survey opens by itself: adults with the app on a phone get a push and a reminder on day 1 and day 2 until they answer, and everyone invited sees it on Home.",
    };
  }
  return {
    ...editable,
    stage: "unscheduled",
    label: "Draft",
    tone: "neutral",
    detail: "It will not be sent by itself. Turn on automatic sending, or send it yourself once the event is completed.",
  };
}

// ---------------------------------------------------------------------------
// The survey's pushes (0596): app.event_survey_stats "notices", and what app.launch_event_survey_now returns.
// ---------------------------------------------------------------------------

/** The counts taken when the pushes start (set-based, mutually exclusive), from app._survey_notice_counts. */
export type SurveyNoticeCounts = {
  invited: number;
  answered: number;
  /** No login in this community: they do not use the member app. */
  noLogin: number;
  /** A login, but no phone that takes notifications: they see the survey on Home. */
  noPhone: number;
  /** Switched event pushes off in the app: they see the survey on Home. */
  pushesOff: number;
  /** A sandbox pushes only to verified test recipients. */
  notTestRecipient: number;
  willPush: number;
  /** The community switched event feedback off in Settings › Notifications: these would have been pushed. */
  switchedOff: number;
};

export type SurveyNotices = {
  sendAt: string | null;
  /** Null until the pushes start (a request scheduled ahead is counted when it goes). */
  planned: SurveyNoticeCounts | null;
  /** People whose push was queued so far. */
  pushed: number;
  /** People whose push was refused, by reason (quiet_hours, sandbox, template, suppressed, error). */
  refused: Record<string, number>;
  problemCode: "template" | "closed" | "backlog" | null;
  problem: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  jobStatus: string | null;
};

const whole = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** The "notices" of app.event_survey_stats (or the launch's answer); null when there is none or it is malformed. */
export function parseSurveyNotices(raw: unknown): SurveyNotices | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const p = o.planned && typeof o.planned === "object" && !Array.isArray(o.planned) ? (o.planned as Record<string, unknown>) : null;
  const refused: Record<string, number> = {};
  if (o.refused && typeof o.refused === "object" && !Array.isArray(o.refused)) {
    for (const [k, v] of Object.entries(o.refused as Record<string, unknown>)) if (whole(v) > 0) refused[k] = whole(v);
  }
  const code = o.problem_code;
  return {
    sendAt: text(o.send_at),
    planned: p
      ? {
          invited: whole(p.invited),
          answered: whole(p.answered),
          noLogin: whole(p.no_login),
          noPhone: whole(p.no_phone),
          pushesOff: whole(p.pushes_off),
          notTestRecipient: whole(p.not_test_recipient),
          willPush: whole(p.will_push),
          switchedOff: whole(p.switched_off),
        }
      : null,
    pushed: whole(o.pushed),
    refused,
    problemCode: code === "template" || code === "closed" || code === "backlog" ? code : null,
    problem: text(o.problem),
    startedAt: text(o.started_at),
    finishedAt: text(o.finished_at),
    jobStatus: text(o.job_status),
  };
}

/** Invited adults with a login who get no push: they see the survey on Home in the member app. */
export function homeOnly(c: SurveyNoticeCounts): number {
  return c.noPhone + c.pushesOff + c.notTestRecipient + c.switchedOff;
}

const REFUSAL_TEXT: Record<string, string> = {
  quiet_hours: "quiet hours lasted until after the survey closes",
  sandbox: "a sandbox pushes only to verified test recipients",
  template: "the push could not be written from its template",
  suppressed: "they may not be messaged (for example recorded as deceased)",
  expired: "it was already too late",
  switched_off: "the community switched this notice off in Settings › Notifications",
  no_login: "the person has no login in this community",
  no_phone: "the person has no phone with the app",
  error: "it could not be queued",
};

/** "2 refused: a sandbox pushes only to verified test recipients" for each reason, in a stable order. */
export function refusalLines(refused: Record<string, number>): string[] {
  return Object.keys(refused)
    .sort()
    .map((k) => `${refused[k]} refused: ${REFUSAL_TEXT[k] ?? "it could not be queued"}`);
}

const people = (n: number) => (n === 1 ? "1 person" : `${n} people`);

/**
 * What staff are told when a survey's pushes start (Send survey, Mark completed, attaching to a completed event):
 * who will get a push, who will see it on Home (people with a login only), who has no login, who already answered,
 * or what stopped every push. `n` null: the numbers could not be loaded, and the sentence says so.
 */
export function surveySentMessage(n: SurveyNotices | null, opening = "Survey sent"): string {
  if (!n || !n.planned) {
    if (n?.problem) return `${opening}, but no push went out: ${n.problem}`;
    return `${opening}. Its numbers could not be loaded, so who gets a push is not shown here; reload the page to see them.`;
  }
  const c = n.planned;
  if (n.problem) return `${opening}, but no push went out: ${n.problem}`;
  if (c.invited === 0) return `${opening}, but nobody has an RSVP to notify.`;
  const home = homeOnly(c);
  const parts: string[] = [];
  if (c.willPush > 0) {
    parts.push(`${people(c.willPush)} will get a push now (or when quiet hours end), with reminders on day 1 and day 2 until they answer.`);
  } else if (c.switchedOff > 0) {
    parts.push("No push goes out: event feedback is switched off in Settings › Notifications.");
  } else if (c.notTestRecipient > 0) {
    parts.push("No push goes out: a sandbox pushes only to verified test recipients.");
  } else {
    parts.push("No push goes out: nobody invited has the member app on a phone that takes notifications.");
  }
  if (home > 0) parts.push(`${home === 1 ? "1 other person" : `${home} others`} with a login will see it on Home in the member app.`);
  if (c.noLogin > 0) parts.push(`${people(c.noLogin)} invited ${c.noLogin === 1 ? "has" : "have"} no login in the app.`);
  if (c.answered > 0) parts.push(`${people(c.answered)} already answered.`);
  return `${opening}: ${parts.join(" ")}`;
}

/** Feedback requested from Events › Feedback: what will happen at the send time (or now). */
export function feedbackRequestMessage(when: string, n: SurveyNotices | null, sendsNow: boolean): string {
  if (sendsNow) return surveySentMessage(n, "Feedback request sent");
  return `Feedback request scheduled for ${when}: the survey opens in the member app then, adults with the app on a phone get a push (or when quiet hours end) and a reminder on day 1 and day 2 until they answer.`;
}

export function formatPoints(points: number): string {
  if (!Number.isFinite(points) || points <= 0) return "No points";
  return points === 1 ? "1 point" : `${points} points`;
}

export function anonymityText(anonymous: boolean): string {
  return anonymous ? "Always anonymous: no names are stored" : "Members choose: their name or anonymous";
}

export function defaultSurveyTitle(eventName: string): string {
  return `${eventName} · feedback`;
}

export type TemplateOption = { id: string; title: string; questionCount: number; anonymous: boolean };

/** Saved survey templates (kind event_feedback, no event) as choices for the Attach form. */
export function templateOptions(rows: { id: string; title: string; questions: unknown; anonymous: boolean }[]): TemplateOption[] {
  return rows
    .map((r) => ({ id: r.id, title: r.title.trim() || "Untitled survey", questionCount: parseQuestions(r.questions).length, anonymous: r.anonymous }))
    .filter((r) => r.questionCount > 0);
}
