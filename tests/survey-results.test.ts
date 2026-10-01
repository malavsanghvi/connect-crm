import { describe, expect, it } from "vitest";

import { aggregateFeedback, commentQuestionId, feedbackCsv, responseRate } from "@/lib/survey/feedback";
import { parseQuestions, type SurveyQuestion } from "@/lib/survey/questions";
import { countWithShare, parseSurveyStats, responsesByDay, shortDay, summarizeQuestions } from "@/lib/survey/results";

const TZ = "America/Chicago";

const questions: SurveyQuestion[] = parseQuestions([
  { id: "overall", type: "rating", label: "Overall?", required: true },
  { id: "nps", type: "nps", label: "Recommend?" },
  { id: "food", type: "single", label: "Food", options: ["Great", "Okay", "Poor"] },
  { id: "saw", type: "multi", label: "What did you attend?", options: ["Pravachan", "Bhojanshala"] },
  { id: "comment", type: "text", label: "Comments" },
  { id: "idea", type: "text", label: "Ideas" },
]);

const responses = [
  { person_id: null, submitted_at: "2026-09-28T15:00:00Z", answers: { overall: 5, nps: 10, food: "Great", saw: ["Pravachan", "Bhojanshala"], comment: "Lovely program", idea: "More seating" } },
  { person_id: "p1", submitted_at: "2026-09-28T16:00:00Z", answers: { overall: 4, nps: 9, food: "Okay", saw: ["Pravachan"], comment: "Someone fell in the parking lot" } },
  { person_id: "p2", submitted_at: "2026-09-30T17:00:00Z", answers: { overall: 2, nps: 5, food: "Vegan", saw: "Bhojanshala" } },
  { person_id: null, submitted_at: "2026-09-30T18:00:00Z", answers: { overall: "4", nps: 12, comment: "  " } },
];

describe("per-question results", () => {
  const byId = (alwaysAnonymous = false) =>
    Object.fromEntries(summarizeQuestions(questions, responses, { alwaysAnonymous, nameFor: (id) => (id === "p1" ? "Ravi Shah" : null) }).map((r) => [r.id, r]));

  it("averages ratings and counts the spread, ignoring values out of range", () => {
    const r = byId().overall;
    expect(r.type === "rating" && r.answers).toBe(4);
    expect(r.type === "rating" && r.average).toBe(3.75);
    expect(r.type === "rating" && r.distribution.map((d) => d.count)).toEqual([0, 1, 0, 2, 1]);
  });
  it("scores NPS and skips answers outside 0-10", () => {
    const r = byId().nps;
    // 10 and 9 are promoters, 5 a detractor; 12 is ignored.
    expect(r.type === "nps" && [r.answers, r.promoters, r.passives, r.detractors, r.nps]).toEqual([3, 2, 0, 1, 33]);
    expect(r.type === "nps" && r.distribution).toHaveLength(11);
  });
  it("counts single and multiple choice, keeping option order and adding answers that are not options", () => {
    const food = byId().food;
    expect(food.type === "single" && food.answers).toBe(3);
    expect(food.type === "single" && food.options.map((o) => [o.label, o.count])).toEqual([
      ["Great", 1],
      ["Okay", 1],
      ["Poor", 0],
      ["Vegan", 1],
    ]);
    const saw = byId().saw;
    expect(saw.type === "multi" && saw.answers).toBe(3);
    expect(saw.type === "multi" && saw.options.map((o) => [o.label, o.count])).toEqual([
      ["Pravachan", 2],
      ["Bhojanshala", 2],
    ]);
    expect(saw.type === "multi" && saw.options[0].ratio).toBeCloseTo(2 / 3);
    expect(countWithShare(2, 2 / 3)).toBe("2 (67%)");
  });
  it("lists written answers newest first, without a name for an anonymous answer, and flags safety concerns", () => {
    const c = byId().comment;
    expect(c.type === "text" && c.answers).toBe(2);
    expect(c.type === "text" && c.comments.map((x) => [x.from, x.anonymous, x.flagged])).toEqual([
      ["Ravi Shah", false, true],
      ["Anonymous", true, false],
    ]);
  });
  it("never shows a name on an always-anonymous survey, even if one was stored", () => {
    const c = byId(true).comment;
    expect(c.type === "text" && c.comments.every((x) => x.from === "Anonymous" && x.anonymous)).toBe(true);
    expect(JSON.stringify(byId(true))).not.toContain("Ravi");
  });
  it("copes with no answers at all", () => {
    const empty = summarizeQuestions(questions, []);
    expect(empty.every((r) => r.answers === 0)).toBe(true);
    const rating = empty[0];
    expect(rating.type === "rating" && rating.average).toBeNull();
  });
});

describe("responses over time", () => {
  it("counts per local day and fills the quiet days between", () => {
    const days = responsesByDay(responses, TZ);
    expect(days).toEqual([
      { date: "2026-09-28", count: 2 },
      { date: "2026-09-29", count: 0 },
      { date: "2026-09-30", count: 2 },
    ]);
  });
  it("uses the center's time zone for the day boundary", () => {
    // 02:30 UTC on the 29th is still the evening of the 28th in Chicago.
    expect(responsesByDay([{ submitted_at: "2026-09-29T02:30:00Z" }], TZ)).toEqual([{ date: "2026-09-28", count: 1 }]);
    expect(responsesByDay([{ submitted_at: "2026-09-29T02:30:00Z" }], "UTC")).toEqual([{ date: "2026-09-29", count: 1 }]);
  });
  it("keeps the most recent days and ignores unreadable times", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ submitted_at: `2026-09-0${i + 1}T15:00:00Z` }));
    expect(responsesByDay(many, TZ, 2).map((d) => d.date)).toEqual(["2026-09-04", "2026-09-05"]);
    expect(responsesByDay([{ submitted_at: "not a date" }], TZ)).toEqual([]);
    expect(responsesByDay([], TZ)).toEqual([]);
    expect(shortDay("2026-09-28")).toBe("Sep 28");
  });
});

describe("audience numbers", () => {
  it("reads the database's answer, and rejects anything else", () => {
    expect(parseSurveyStats({ invited: 12, responses: 5, anonymous: 2, completions: 5, answered: 5, points_awarded: 50 })).toEqual({
      invited: 12,
      responses: 5,
      anonymous: 2,
      completions: 5,
      answered: 5,
      pointsAwarded: 50,
    });
    expect(parseSurveyStats(null)).toBeNull();
    expect(parseSurveyStats([])).toBeNull();
    expect(parseSurveyStats({ invited: 12 })).toBeNull();
    expect(parseSurveyStats({ invited: -1, responses: 0, anonymous: 0, completions: 0, answered: 0, points_awarded: 0 })).toBeNull();
    expect(parseSurveyStats({ invited: "12", responses: 0, anonymous: 0, completions: 0, answered: 0, points_awarded: 0 })).toBeNull();
  });
  it("response rate is people answered over people invited, never above 100%", () => {
    expect(responseRate(5, 20)).toBe(0.25);
    expect(responseRate(0, 20)).toBe(0);
    expect(responseRate(3, 0)).toBeNull();
    expect(responseRate(25, 20)).toBe(1);
  });
});

describe("export with the survey analytics", () => {
  const agg = aggregateFeedback(questions, responses, 10, (id) => (id === "p1" ? "Ravi Shah" : null));
  const stats = { invited: 8, responses: 4, anonymous: 2, completions: 4, answered: 4, pointsAwarded: 40 };
  const csv = feedbackCsv("Paryushan, 2026", agg, {
    stats,
    questions: summarizeQuestions(questions, responses, { alwaysAnonymous: true }),
    byDay: responsesByDay(responses, TZ),
    commentQuestion: commentQuestionId(questions),
  });
  it("adds invited, completions, points and the rate from the audience numbers", () => {
    expect(csv).toContain("Invited (adults with an active RSVP or who attended),8");
    expect(csv).toContain("Completions,4");
    expect(csv).toContain("Points awarded in total,40");
    expect(csv).toContain("Response rate,50%");
  });
  it("adds responses by day and every question's results", () => {
    expect(csv).toContain("Responses by day");
    expect(csv).toContain("2026-09-29,0");
    expect(csv).toContain("Results by question");
    expect(csv).toContain("Overall?,Rating 1-5,4,3.75");
    expect(csv).toContain("  Vegan,,1,");
    expect(csv).toContain("Ideas,Written answer,1,");
    expect(csv).toContain("  More seating");
  });
  it("keeps the anonymity rule: no names, and flagged comments stay out", () => {
    expect(csv).not.toContain("Ravi");
    expect(csv).not.toContain("fell in the parking");
    expect(csv).toContain("Lovely program");
    // The comment question is exported once, in the comments table, not repeated per question.
    expect(csv.match(/Lovely program/g)).toHaveLength(1);
  });
  it("is unchanged without the extras", () => {
    const plain = feedbackCsv("x", agg);
    expect(plain).not.toContain("Results by question");
    expect(plain).toContain("Response rate,40%");
  });
  it("writes a negative number as a number, not as text", () => {
    const negative = aggregateFeedback(questions, [{ person_id: null, submitted_at: "2026-09-28T15:00:00Z", answers: { nps: 2 } }], 0);
    expect(feedbackCsv("x", negative)).toContain("Net promoter score,-100");
  });
});
