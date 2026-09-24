// Survey questions (surveys.questions jsonb): [{id,type,label,options,required}].
// Shared by the Events feedback surveys and, later, Comms surveys.
// The member app (connect-mobile src/lib/api/surveys.ts) renders the same
// types: rating (1–5 stars), nps (0–10), single, multi, text.

export const QUESTION_TYPES = ["rating", "nps", "single", "multi", "text"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export type SurveyQuestion = { id: string; type: QuestionType; label: string; options: string[]; required: boolean };

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  rating: "Rating 1–5",
  nps: "Likelihood to recommend 0–10",
  single: "Pick one",
  multi: "Pick any",
  text: "Written answer",
};

/** Read surveys.questions defensively (unknown types become written answers). */
export function parseQuestions(raw: unknown): SurveyQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: SurveyQuestion[] = [];
  raw.forEach((q, i) => {
    if (!q || typeof q !== "object" || Array.isArray(q)) return;
    const o = q as Record<string, unknown>;
    const label = typeof o.label === "string" ? o.label : null;
    if (!label) return;
    const t = typeof o.type === "string" ? o.type : "text";
    const type = (QUESTION_TYPES as readonly string[]).includes(t) ? (t as QuestionType) : "text";
    out.push({
      id: typeof o.id === "string" && o.id ? o.id : `q${i + 1}`,
      type,
      label,
      options: Array.isArray(o.options) ? o.options.filter((x): x is string => typeof x === "string") : [],
      required: o.required === true,
    });
  });
  return out;
}

/** Validate the builder's JSON; returns the questions or a plain-English problem. */
export function validateQuestionsJson(json: string | null): { ok: true; questions: SurveyQuestion[] } | { ok: false; error: string } {
  if (!json) return { ok: false, error: "Add at least one question." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: "The questions couldn't be read. Reload the page and try again." };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return { ok: false, error: "Add at least one question." };
  const questions = parseQuestions(parsed);
  if (questions.length !== parsed.length) return { ok: false, error: "Every question needs a label." };
  const ids = new Set<string>();
  for (const q of questions) {
    if (!q.label.trim()) return { ok: false, error: "Every question needs a label." };
    if ((q.type === "single" || q.type === "multi") && q.options.length === 0) return { ok: false, error: `Add choices for "${q.label}".` };
    if (ids.has(q.id)) return { ok: false, error: `Two questions share the id "${q.id}". Remove one and add it again.` };
    ids.add(q.id);
  }
  return { ok: true, questions };
}

/** One answer as text for a table cell. */
export function answerText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}
