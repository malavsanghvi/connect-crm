import { describe, expect, it } from "vitest";

import {
  aggregateFeedback,
  feedbackCsv,
  feedbackSendAt,
  feedbackStatus,
  formatNps,
  shortWhen,
  shouldFlagComment,
  standardFeedbackQuestions,
} from "@/lib/survey/feedback";
import { parseQuestions, validateQuestionsJson } from "@/lib/survey/questions";
import { buildAudience, presetOf } from "@/lib/survey/audience";

const TZ = "America/Chicago";

describe("feedback schedule", () => {
  const now = new Date("2026-09-27T20:00:00Z");
  it("sends at 9 AM the next morning in the center's zone", () => {
    const at = feedbackSendAt("next_morning", "2026-09-27T22:00:00Z", TZ, now);
    expect(at).toBe("2026-09-28T14:00:00.000Z");
    expect(shortWhen(at, TZ)).toBe("Mon 9 AM");
  });
  it("sends two days later, or right after (never in the past)", () => {
    expect(feedbackSendAt("two_days", "2026-09-27T22:00:00Z", TZ, now)).toBe("2026-09-29T14:00:00.000Z");
    expect(feedbackSendAt("right_after", "2026-09-27T22:00:00Z", TZ, now)).toBe("2026-09-27T22:00:00.000Z");
    expect(feedbackSendAt("right_after", "2026-09-01T22:00:00Z", TZ, now)).toBe(now.toISOString());
    // An old event gets its request tomorrow morning.
    expect(feedbackSendAt("next_morning", "2026-09-01T22:00:00Z", TZ, now)).toBe("2026-09-28T14:00:00.000Z");
  });
  it("reads status from the survey's state and window", () => {
    expect(feedbackStatus(null)).toBe("Not sent");
    expect(feedbackStatus({ status: "open", opens_at: "2026-09-28T14:00:00Z", closes_at: null }, now)).toBe("Scheduled");
    expect(feedbackStatus({ status: "open", opens_at: "2026-09-20T14:00:00Z", closes_at: "2026-09-26T00:00:00Z" }, now)).toBe("Closed");
    expect(feedbackStatus({ status: "open", opens_at: null, closes_at: null }, now)).toBe("Open");
    expect(feedbackStatus({ status: "closed", opens_at: null, closes_at: null }, now)).toBe("Closed");
  });
});

describe("feedback results", () => {
  const qs = standardFeedbackQuestions(["Pravachan", "Bhojanshala"]);
  const responses = [
    { person_id: null, submitted_at: "2026-09-28T15:00:00Z", answers: { overall: 5, area_program: 5, area_venue: 3, nps: 10, attended: ["Pravachan", "Bhojanshala"], comment: "Lovely program", comment_area: "Program" } },
    { person_id: "p1", submitted_at: "2026-09-28T16:00:00Z", answers: { overall: 4, area_program: 4, area_venue: 3, nps: 9, attended: ["Pravachan"], comment: "Someone fell in the parking lot", comment_area: "Venue" } },
    { person_id: "p2", submitted_at: "2026-09-28T17:00:00Z", answers: { overall: 3, nps: 5 } },
    { person_id: null, submitted_at: "2026-09-28T18:00:00Z", answers: { overall: "4", nps: 7, comment: "  " } },
  ];
  const r = aggregateFeedback(qs, responses, 10, (id) => (id === "p1" ? "Ravi Shah" : null));
  it("computes rate, anonymity, average and NPS", () => {
    expect(r.responses).toBe(4);
    expect(r.rate).toBe(0.4);
    expect(r.anonymous).toBe(2);
    expect(r.overall).toBe(4);
    // 2 promoters, 1 detractor, 1 passive of 4 → +25.
    expect(r.nps).toBe(25);
    expect(formatNps(r.nps)).toBe("+25");
    expect(formatNps(-12)).toBe("−12");
  });
  it("averages areas and counts what people attended", () => {
    expect(r.areas.find((a) => a.id === "area_program")?.average).toBe(4.5);
    expect(r.areas.find((a) => a.id === "area_food")?.average).toBeNull();
    expect(r.attended).toEqual([
      { label: "Pravachan", count: 2 },
      { label: "Bhojanshala", count: 1 },
    ]);
  });
  it("lists comments newest first, anonymous without a name, and flags safety concerns", () => {
    expect(r.comments).toHaveLength(2);
    expect(r.comments[0]).toMatchObject({ from: "Ravi Shah", area: "Venue", rating: 4, flagged: true });
    expect(r.comments[1]).toMatchObject({ from: "Anonymous", anonymous: true, flagged: false });
    expect(r.flagged).toBe(1);
    expect(shouldFlagComment("Thanks to Nilesh uncle for the help")).toBe(true);
    expect(shouldFlagComment("Great food")).toBe(false);
  });
  it("exports totals and anonymized comments, leaving flagged ones out", () => {
    const csv = feedbackCsv("Paryushan, 2026", r);
    expect(csv).toContain('"Paryushan, 2026"');
    expect(csv).toContain("Lovely program");
    expect(csv).not.toContain("fell in the parking");
    expect(csv).not.toContain("Ravi");
    expect(feedbackCsv("x", { ...r, comments: [{ ...r.comments[1], text: "=cmd()" }] })).toContain("'=cmd()");
  });
  it("falls back to question types for a non-standard survey", () => {
    const custom = parseQuestions([
      { id: "a", type: "rating", label: "How was it?" },
      { id: "b", type: "text", label: "Why?" },
    ]);
    const res = aggregateFeedback(custom, [{ person_id: null, submitted_at: "x", answers: { a: 2, b: "ok" } }], 0);
    expect(res.overall).toBe(2);
    expect(res.rate).toBeNull();
    expect(res.comments[0].area).toBe("General");
  });
});

describe("questions and audiences", () => {
  it("validates builder JSON", () => {
    expect(validateQuestionsJson(null).ok).toBe(false);
    expect(validateQuestionsJson("[").ok).toBe(false);
    expect(validateQuestionsJson(JSON.stringify([{ id: "a", type: "single", label: "Pick", options: [] }]))).toEqual({ ok: false, error: 'Add choices for "Pick".' });
    const ok = validateQuestionsJson(JSON.stringify(standardFeedbackQuestions()));
    expect(ok.ok && ok.questions.map((q) => q.type)).toContain("nps");
  });
  it("builds and recognises event audiences", () => {
    const a = buildAudience("event_rsvps", { eventId: "e1", rsvpStatuses: ["attended"] });
    expect(a).toEqual({ ok: true, audience: { event_id: "e1", rsvp_statuses: ["attended"] } });
    expect(presetOf({ event_id: "e1" })).toBe("event_rsvps");
  });
});
