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
        ? "Attendees can answer in the member app until it closes. Anyone who has not answered gets two reminders."
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
      detail: "The event is completed but the survey has not gone out yet. Send it now to open it and notify everyone with an RSVP.",
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
        "Waiting for the event. When you mark it completed, the survey opens by itself, everyone with an RSVP (or who attended) is notified, and they get two reminders.",
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

/**
 * What "Send survey" says once the survey went out (0596). `pushed`: people who got a push (adults with the member app
 * on a phone; now, or when quiet hours end, then a reminder on day 1 and day 2 until they answer), from
 * app.launch_event_survey_now. `invited`: every invited adult (app.event_survey_stats), or null when that number could
 * not be loaded. `pushesOff`: the community switched event feedback off in Settings › Notifications. `sandbox`: a
 * sandbox pushes only to verified test recipients. Everyone invited sees the survey on Home in the member app.
 */
export function surveySentMessage(r: { pushed: number; invited: number | null; pushesOff?: boolean; sandbox?: boolean }): string {
  const pushed = Math.max(0, Math.trunc(r.pushed));
  const invited = r.invited === null ? null : Math.max(0, Math.trunc(r.invited));
  const people = (n: number) => (n === 1 ? "1 person" : `${n} people`);
  if (pushed > 0) {
    const sent = `Survey sent: ${people(pushed)} notified by push, now or when quiet hours end, with reminders on day 1 and day 2 until they answer`;
    if (invited === null) return `${sent}. How many others were invited could not be loaded; reload the page to see the numbers.`;
    const others = Math.max(invited - pushed, 0);
    return others > 0 ? `${sent}; ${others} ${others === 1 ? "other" : "others"} will see it on Home in the member app.` : `${sent}.`;
  }
  if (invited === 0) return "Survey opened, but nobody has an RSVP to notify.";
  const home = invited === null ? "Everyone invited will see it on Home in the member app." : `The ${people(invited)} invited will see it on Home in the member app.`;
  if (r.pushesOff) return `Survey opened. Nobody was notified by push: event feedback is switched off in Settings › Notifications. ${home}`;
  if (r.sandbox) return `Survey opened. Nobody was notified by push: a sandbox pushes only to verified test recipients. ${home}`;
  return `Survey opened. Nobody was notified by push: no one invited has the member app on a phone. ${home}`;
}

/** What attaching a survey to an already completed event says when it is sent at once (no counts come back then). */
export function surveyAttachedAndSentMessage(r: { pushesOff?: boolean; sandbox?: boolean }): string {
  const home = "everyone invited will see it on Home in the member app";
  if (r.pushesOff) return `Survey attached and sent: ${home}. No push goes out, because event feedback is switched off in Settings › Notifications.`;
  if (r.sandbox) return `Survey attached and sent: ${home}. In a sandbox only verified test recipients get a push.`;
  return `Survey attached and sent: ${home}, and adults with the app on a phone get a push, with reminders on day 1 and day 2 until they answer.`;
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
