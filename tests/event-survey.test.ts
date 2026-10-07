import { describe, expect, it } from "vitest";

import { eventAreas, type EventAccess } from "@/lib/events/access";
import {
  anonymityText,
  defaultSurveyTitle,
  describeEventSurvey,
  feedbackRequestMessage,
  formatPoints,
  homeOnly,
  parseSurveyNotices,
  refusalLines,
  surveySentMessage,
  templateOptions,
  type EventSurveyRow,
  type SurveyNotices,
} from "@/lib/survey/event-survey";

/** A launch summary as app.launch_event_survey_now / app.event_survey_stats "notices" return it. */
function notices(planned: Record<string, number> | null, over: Record<string, unknown> = {}): SurveyNotices {
  const n = parseSurveyNotices({ send_at: "2026-10-07T15:00:00Z", planned, pushed: 0, refused: {}, problem_code: null, problem: null, ...over });
  if (!n) throw new Error("the fixture did not parse");
  return n;
}
const base = { invited: 0, answered: 0, no_login: 0, no_phone: 0, pushes_off: 0, not_test_recipient: 0, will_push: 0 };

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
  it("Send survey says who will get a push, who sees it on Home (logins only), who has no login and who answered (0596)", () => {
    const n = notices({ ...base, invited: 9, answered: 1, no_login: 2, no_phone: 1, pushes_off: 1, will_push: 4 });
    expect(surveySentMessage(n)).toBe(
      "Survey sent: 4 people will get a push now (or when quiet hours end), with reminders on day 1 and day 2 until they answer. 2 others with a login will see it on Home in the member app. 2 people invited have no login in the app. 1 person already answered.",
    );
    expect(homeOnly(n.planned!)).toBe(2);
    expect(surveySentMessage(notices({ ...base, invited: 1, will_push: 1 }))).toBe(
      "Survey sent: 1 person will get a push now (or when quiet hours end), with reminders on day 1 and day 2 until they answer.",
    );
    expect(surveySentMessage(notices({ ...base, invited: 1, no_login: 1 }))).toMatch(/nobody invited has the member app on a phone that takes notifications\. 1 person invited has no login/);
  });
  it("says why no push went: switched off, a sandbox, nobody with the app, nobody invited, or what stopped everyone", () => {
    expect(surveySentMessage(notices({ ...base, invited: 3, switched_off: 3 }))).toMatch(
      /^Survey sent: No push goes out: event feedback is switched off in Settings › Notifications\. 3 others with a login will see it on Home/,
    );
    expect(surveySentMessage(notices({ ...base, invited: 2, not_test_recipient: 2 }))).toMatch(/a sandbox pushes only to verified test recipients/);
    expect(surveySentMessage(notices({ ...base }))).toBe("Survey sent, but nobody has an RSVP to notify.");
    const stopped = notices({ ...base, invited: 4, will_push: 4 }, { problem_code: "template", problem: 'The community\'s own "event_survey" push asks for {{first_name}}.' });
    expect(surveySentMessage(stopped)).toBe('Survey sent, but no push went out: The community\'s own "event_survey" push asks for {{first_name}}.');
  });
  it("never guesses: numbers that could not be loaded are said to be missing", () => {
    expect(surveySentMessage(null)).toMatch(/Its numbers could not be loaded, so who gets a push is not shown here/);
    expect(surveySentMessage(null, "The survey opened")).toMatch(/^The survey opened\. Its numbers could not be loaded/);
    expect(surveySentMessage(notices(null))).toMatch(/could not be loaded/);
  });
  it("reads the launch summary defensively and lists refusals in plain words", () => {
    expect(parseSurveyNotices(null)).toBeNull();
    expect(parseSurveyNotices([])).toBeNull();
    const n = parseSurveyNotices({ planned: { will_push: "3", invited: -2 }, pushed: 5, refused: { sandbox: 2, quiet_hours: 1, error: 0, x: "y" }, problem_code: "odd" });
    expect(n).toMatchObject({ pushed: 5, problemCode: null, refused: { sandbox: 2, quiet_hours: 1 } });
    expect(n?.planned).toMatchObject({ willPush: 0, invited: 0 });
    expect(refusalLines({ sandbox: 2, quiet_hours: 1 })).toEqual([
      "1 refused: quiet hours lasted until after the survey closes",
      "2 refused: a sandbox pushes only to verified test recipients",
    ]);
    // The same words as app.member_notice_reason_text in the database.
    expect(refusalLines({ no_login: 1, no_phone: 2, switched_off: 3 })).toEqual([
      "1 refused: the person has no login in this community",
      "2 refused: the person has no phone with the app",
      "3 refused: the community switched this notice off in Settings › Notifications",
    ]);
  });
  it("a feedback request says what happens at its time, or what happened now", () => {
    expect(feedbackRequestMessage("Thu 9 AM", null, false)).toBe(
      "Feedback request scheduled for Thu 9 AM: the survey opens in the member app then, adults with the app on a phone get a push (or when quiet hours end) and a reminder on day 1 and day 2 until they answer.",
    );
    expect(feedbackRequestMessage("Thu 9 AM", notices({ ...base, invited: 2, will_push: 2 }), true)).toMatch(/^Feedback request sent: 2 people will get a push now/);
    expect(feedbackRequestMessage("Thu 9 AM", null, true)).toMatch(/^Feedback request sent\. Its numbers could not be loaded/);
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
