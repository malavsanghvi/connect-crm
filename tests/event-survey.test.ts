import { describe, expect, it } from "vitest";

import { eventAreas, type EventAccess } from "@/lib/events/access";
import {
  anonymityText,
  defaultSurveyTitle,
  describeEventSurvey,
  formatPoints,
  surveyAttachedAndSentMessage,
  surveySentMessage,
  templateOptions,
  type EventSurveyRow,
} from "@/lib/survey/event-survey";

const now = new Date("2026-09-30T18:00:00Z");

function survey(over: Partial<EventSurveyRow> = {}): EventSurveyRow {
  return {
    status: "draft",
    opens_at: null,
    closes_at: null,
    completion_started_at: null,
    auto_on_complete: true,
    reward_points: 10,
    anonymous: false,
    ...over,
  };
}

describe("event survey stage", () => {
  it("a draft that sends by itself waits for the event, and can be edited and removed", () => {
    const s = describeEventSurvey(survey(), "published", now);
    expect(s).toMatchObject({ stage: "waiting", label: "Draft", canEdit: true, canRemove: true, canLaunch: false, launched: false });
    expect(s.detail).toMatch(/mark it completed/);
  });
  it("a draft that does not send by itself says so", () => {
    const s = describeEventSurvey(survey({ auto_on_complete: false }), "live", now);
    expect(s).toMatchObject({ stage: "unscheduled", canEdit: true, canLaunch: false });
    expect(s.detail).toMatch(/will not be sent by itself/);
  });
  it("offers Launch now once the event is completed and the survey has not gone out", () => {
    for (const auto of [true, false]) {
      const s = describeEventSurvey(survey({ auto_on_complete: auto }), "completed", now);
      expect(s).toMatchObject({ stage: "ready", label: "Ready to send", canLaunch: true, canEdit: true, canRemove: true });
    }
  });
  it("a cancelled event's draft is not sent and cannot be launched", () => {
    expect(describeEventSurvey(survey(), "cancelled", now)).toMatchObject({ stage: "cancelled", canLaunch: false, canEdit: true });
  });
  it("once launched the survey is open and locked", () => {
    const s = describeEventSurvey(
      survey({ status: "open", completion_started_at: "2026-09-30T17:00:00Z", opens_at: "2026-09-30T17:00:00Z", closes_at: "2026-10-14T17:00:00Z" }),
      "completed",
      now,
    );
    expect(s).toMatchObject({ stage: "open", label: "Open", launched: true, canEdit: false, canRemove: false, canLaunch: false });
  });
  it("closes when it is closed, or when its window has passed", () => {
    expect(describeEventSurvey(survey({ status: "closed", completion_started_at: "x" }), "completed", now).stage).toBe("closed");
    expect(describeEventSurvey(survey({ status: "open", closes_at: "2026-09-29T00:00:00Z", completion_started_at: "x" }), "completed", now).stage).toBe("closed");
  });
  it("an older 'Request feedback' survey is scheduled or open, never editable or launchable from the tab", () => {
    const scheduled = describeEventSurvey(survey({ status: "open", opens_at: "2026-10-01T14:00:00Z", auto_on_complete: false }), "completed", now);
    expect(scheduled).toMatchObject({ stage: "scheduled", canEdit: false, canLaunch: false });
    const open = describeEventSurvey(survey({ status: "open", opens_at: "2026-09-29T14:00:00Z", auto_on_complete: false }), "completed", now);
    expect(open).toMatchObject({ stage: "open", launched: false, canEdit: false, canLaunch: false });
    expect(open.detail).toMatch(/Event feedback/);
  });
  it("a launched survey put back to draft cannot be edited or sent again", () => {
    expect(describeEventSurvey(survey({ completion_started_at: "2026-09-30T17:00:00Z" }), "completed", now)).toMatchObject({
      label: "Draft",
      canEdit: false,
      canRemove: false,
      canLaunch: false,
    });
  });
});

describe("event survey wording", () => {
  it("says points plainly", () => {
    expect(formatPoints(0)).toBe("No points");
    expect(formatPoints(-3)).toBe("No points");
    expect(formatPoints(1)).toBe("1 point");
    expect(formatPoints(25)).toBe("25 points");
  });
  it("describes anonymity and the default title", () => {
    expect(anonymityText(true)).toMatch(/Always anonymous/);
    expect(anonymityText(false)).toMatch(/Members choose/);
    expect(defaultSurveyTitle("Diwali Mela")).toBe("Diwali Mela · feedback");
  });
  it("Send survey reports who got a push and how many others will see it on Home (0596)", () => {
    expect(surveySentMessage({ pushed: 2, invited: 5 })).toBe(
      "Survey sent: 2 people notified by push, now or when quiet hours end, with reminders on day 1 and day 2 until they answer; 3 others will see it on Home in the member app.",
    );
    expect(surveySentMessage({ pushed: 1, invited: 2 })).toMatch(/^Survey sent: 1 person notified by push, .*; 1 other will see it on Home/);
    expect(surveySentMessage({ pushed: 3, invited: 3 })).toMatch(/until they answer\.$/);
    expect(surveySentMessage({ pushed: 2, invited: null })).toMatch(/until they answer\. How many others were invited could not be loaded; reload the page/);
    expect(surveySentMessage({ pushed: 0, invited: 0 })).toBe("Survey opened, but nobody has an RSVP to notify.");
    expect(surveySentMessage({ pushed: 0, invited: 4 })).toBe(
      "Survey opened. Nobody was notified by push: no one invited has the member app on a phone. The 4 people invited will see it on Home in the member app.",
    );
    expect(surveySentMessage({ pushed: 0, invited: 4, pushesOff: true })).toMatch(/event feedback is switched off in Settings › Notifications\. The 4 people/);
    expect(surveySentMessage({ pushed: 0, invited: 1, sandbox: true })).toMatch(/only to verified test recipients\. The 1 person invited/);
    expect(surveySentMessage({ pushed: 0, invited: null })).toMatch(/Everyone invited will see it on Home/);
  });
  it("attaching a survey to a completed event says who is told, without promising a push to everyone", () => {
    expect(surveyAttachedAndSentMessage({})).toMatch(/^Survey attached and sent: everyone invited will see it on Home in the member app, and adults with the app on a phone get a push/);
    expect(surveyAttachedAndSentMessage({ pushesOff: true })).toMatch(/No push goes out, because event feedback is switched off/);
    expect(surveyAttachedAndSentMessage({ sandbox: true })).toMatch(/only verified test recipients get a push/);
  });
  it("lists saved surveys as choices, skipping ones with no questions", () => {
    const opts = templateOptions([
      { id: "t1", title: "  ", questions: [{ id: "a", type: "rating", label: "Overall?" }], anonymous: false },
      { id: "t2", title: "Kids program", questions: [], anonymous: true },
      { id: "t3", title: "Standard", questions: [{ id: "a", type: "rating", label: "x" }, { id: "b", type: "text", label: "y" }], anonymous: true },
    ]);
    expect(opts).toEqual([
      { id: "t1", title: "Untitled survey", questionCount: 1, anonymous: false },
      { id: "t3", title: "Standard", questionCount: 2, anonymous: true },
    ]);
  });
});

describe("who sees the Survey tab", () => {
  const none: EventAccess = { permissions: [], isPlatformAdmin: false, grants: [] };
  const lead: EventAccess = {
    ...none,
    grants: [{ role_key: "event_lead", scope_kind: "event", scope_id: "e1", starts_at: "2020-01-01T00:00:00Z", ends_at: null }],
  };
  it("is for event managers, this event's lead and communications staff", () => {
    expect(eventAreas.survey({ ...none, permissions: ["events.manage"] }, "e1")).toBe(true);
    expect(eventAreas.survey({ ...none, permissions: ["comms.view"] }, "e1")).toBe(true);
    expect(eventAreas.survey({ ...none, permissions: ["comms.send"] }, "e1")).toBe(true);
    expect(eventAreas.survey(lead, "e1")).toBe(true);
  });
  it("is not for the lead of a different event, or read-only event staff", () => {
    expect(eventAreas.survey(lead, "e2")).toBe(false);
    expect(eventAreas.survey({ ...none, permissions: ["events.view"] }, "e1")).toBe(false);
    expect(eventAreas.survey(none, "e1")).toBe(false);
  });
  it("changing it stays with event managers and this event's lead", () => {
    expect(eventAreas.edit(lead, "e1")).toBe(true);
    expect(eventAreas.edit(lead, "e2")).toBe(false);
    expect(eventAreas.edit({ ...none, permissions: ["comms.send"] }, "e1")).toBe(false);
  });
});
