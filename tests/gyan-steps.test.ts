import { describe, expect, it } from "vitest";

import {
  gyanLevelAudio,
  gyanLevelHasLessonContent,
  gyanNeedsReview,
  gyanStepDetail,
  gyanStepKindLabel,
  gyanStepPointsText,
  quizFromFields,
  quizQuestionCount,
  quizTypeCounts,
  QUIZ_OPTIONS_TEXT_MAX,
} from "@/lib/content";

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

describe("Gyan Path level readiness (Text and Audio columns)", () => {
  const cards = { kind: "read", activity: { cards: [{ title: "a", body_md: "b" }] } };
  const spotsLearn = { kind: "hotspot", activity: { mode: "learn", image: "asset:mahavir-murti", spots: [{ key: "toes" }] } };
  const spotsPractice = { kind: "hotspot", activity: { mode: "practice", image: "asset:mahavir-murti", spots: [{ key: "toes" }] } };
  const verses = { kind: "voice", activity: { lang: "hi-IN", verses: [{ text: "णमो अरिहंताणं" }] } };
  const quiz = { kind: "quiz", quiz: { questions: [{ question: "Q", options: ["a", "b"], answer: 0 }] } };

  it("counts cards, tap-the-spots pictures and voice verses as text in the lesson", () => {
    expect(gyanLevelHasLessonContent([cards])).toBe(true);
    expect(gyanLevelHasLessonContent([spotsLearn, spotsPractice])).toBe(true);
    expect(gyanLevelHasLessonContent([verses])).toBe(true);
    expect(gyanLevelHasLessonContent([{ kind: "read", activity: {} }, quiz])).toBe(false);
    expect(gyanLevelHasLessonContent([{ kind: "voice", activity: { verses: [] } }])).toBe(false);
    expect(gyanLevelHasLessonContent([])).toBe(false);
  });

  it("asks for a recording only where a listen or recite step plays one", () => {
    expect(gyanLevelAudio([{ kind: "listen" }, quiz], false)).toBe("to_record");
    expect(gyanLevelAudio([{ kind: "recite" }], true)).toBe("recorded");
    expect(gyanLevelAudio([verses, quiz], false)).toBe("in_lesson");
    expect(gyanLevelAudio([spotsLearn, spotsPractice], false)).toBe("not_needed");
    expect(gyanLevelAudio([cards, quiz], false)).toBe("not_needed");
    expect(gyanLevelAudio([{ kind: "listen" }, verses], false)).toBe("to_record");
  });
});

describe("quizFromFields length limits (the database's, 0570)", () => {
  it("says the limit instead of failing in the database", () => {
    expect(quizFromFields("x".repeat(500), "a\nb", "1").ok).toBe(true);
    expect(quizFromFields("x".repeat(501), "a\nb", "1")).toEqual({ ok: false, error: "shorten the question to at most 500 characters (it has 501)" });
    expect(quizFromFields("Q?", `a\n${"b".repeat(201)}`, "1")).toEqual({ ok: false, error: "shorten answer 2 to at most 200 characters (it has 201)" });
    expect(quizFromFields("Q?", `${"a".repeat(200)}\nb`, "1").ok).toBe(true);
    // Characters are counted as the database counts them: an emoji is one.
    expect(quizFromFields("🪔".repeat(500), "a\nb", "1").ok).toBe(true);
  });

  it("fits six answers at the limit in the answers box", () => {
    const six = Array.from({ length: 6 }, (_, i) => String(i).repeat(200)).join("\n");
    expect(six.length).toBeLessThanOrEqual(QUIZ_OPTIONS_TEXT_MAX);
    expect(quizFromFields("Q?", six, "1").ok).toBe(true);
  });
});
