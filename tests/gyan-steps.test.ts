import { describe, expect, it } from "vitest";

import { gyanNeedsReview, gyanStepDetail, gyanStepKindLabel, gyanStepPointsText, quizQuestionCount, quizTypeCounts } from "@/lib/content";

describe("Gyan Path step summaries (0570 kinds, activities and quiz types)", () => {
  it("labels every kind, the new ones included", () => {
    expect(gyanStepKindLabel("read")).toBe("Learn");
    expect(gyanStepKindLabel("quiz")).toBe("Quiz");
    expect(gyanStepKindLabel("hotspot", { mode: "learn" })).toBe("Tap the spots · learn");
    expect(gyanStepKindLabel("hotspot", { mode: "practice" })).toBe("Tap the spots · practice");
    expect(gyanStepKindLabel("hotspot", {})).toBe("Tap the spots");
    expect(gyanStepKindLabel("voice", { mode: "listen_repeat_say" })).toBe("Say it aloud");
    expect(gyanStepKindLabel("some_new_kind")).toBe("some new kind");
  });

  it("counts quiz questions by type, reading the older bare list too", () => {
    const quiz = {
      questions: [
        { type: "choice", question: "Who?", options: ["A", "B"], answer: 0 },
        { question: "Untyped is choice", options: ["A", "B"], answer: 1 },
        { type: "order", prompt: "Order", items: ["a", "b"] },
        { type: "truefalse", statement: "S", answer: true },
        { type: "match", prompt: "M", pairs: [["a", "b"], ["c", "d"]] },
        { type: "fill", sentence: "Namo ___", answer: "Arihantanam", options: ["Arihantanam", "Siddhanam"] },
      ],
    };
    expect(quizTypeCounts(quiz)).toEqual([
      { type: "choice", label: "multiple choice", count: 2 },
      { type: "order", label: "put in order", count: 1 },
      { type: "truefalse", label: "true or false", count: 1 },
      { type: "match", label: "match the pairs", count: 1 },
      { type: "fill", label: "fill the gap", count: 1 },
    ]);
    expect(quizTypeCounts([{ q: "Old", options: ["a", "b"], answer: 1 }])).toEqual([{ type: "choice", label: "multiple choice", count: 1 }]);
    expect(quizTypeCounts(null)).toEqual([]);
    expect(quizTypeCounts({ questions: [{ type: "essay" }] })).toEqual([{ type: "essay", label: "essay", count: 1 }]);
    expect(gyanStepDetail({ kind: "quiz", quiz })).toBe("6 questions: 2 multiple choice, 1 put in order, 1 true or false, 1 match the pairs, 1 fill the gap");
    expect(gyanStepDetail({ kind: "quiz", quiz: { questions: [{ question: "Q", options: ["a", "b"], answer: 0 }] } })).toBe("1 question: 1 multiple choice");
    expect(quizQuestionCount([{ kind: "quiz", quiz }, { kind: "read", quiz: null }, { kind: "quiz", quiz: [{ q: "x" }] }])).toBe(7);
  });

  it("summarises cards, spots and verses, and never breaks on odd payloads", () => {
    expect(gyanStepDetail({ kind: "read", activity: { cards: [{ title: "a", body_md: "b" }, { title: "c", body_md: "d" }] } })).toBe("2 cards");
    expect(gyanStepDetail({ kind: "hotspot", activity: { mode: "practice", spots: new Array(9).fill({}) } })).toBe("9 spots");
    expect(gyanStepDetail({ kind: "voice", activity: { lang: "hi-IN", verses: [{ text: "णमो अरिहंताणं" }] } })).toBe("1 verse · hi-IN");
    expect(gyanStepDetail({ kind: "voice", activity: { verses: [{}, {}] } })).toBe("2 verses");
    expect(gyanStepDetail({ kind: "read", activity: {} })).toBeNull();
    expect(gyanStepDetail({ kind: "listen" })).toBeNull();
    expect(gyanStepDetail({ kind: "hotspot", activity: "not an object" })).toBeNull();
    expect(gyanStepDetail({ kind: "quiz", quiz: "nonsense" })).toBeNull();
  });

  it("shows points, repeat points and the review mark", () => {
    expect(gyanStepPointsText(10, 3)).toBe("10 points + 3 a try");
    expect(gyanStepPointsText(1, 0)).toBe("1 point");
    expect(gyanStepPointsText(0, 3)).toBe("3 a try");
    expect(gyanStepPointsText(0, 0)).toBe("");
    expect(gyanStepPointsText(null, undefined)).toBe("");
    expect(gyanNeedsReview({ review: "needs_pathshala_review" })).toBe(true);
    expect(gyanNeedsReview({ review: "reviewed" })).toBe(false);
    expect(gyanNeedsReview(null)).toBe(false);
  });
});
