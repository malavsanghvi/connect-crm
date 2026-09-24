"use client";

import { useState } from "react";

import { buttonClass } from "@/components/ui";

export type SurveyQuestion = { id: string; type: "text" | "single" | "multi" | "rating"; label: string; options: string[]; required: boolean };

let counter = 0;
const newId = () => `q${Date.now().toString(36)}${(counter++).toString(36)}`;

/**
 * Survey question editor (moved from connect-admin comms/questions-builder).
 * Submits the list as JSON in a hidden `questions` field.
 */
export function QuestionsBuilder({ initial }: { initial: SurveyQuestion[] }) {
  const [qs, setQs] = useState<SurveyQuestion[]>(initial.length ? initial : [{ id: "q1", type: "rating", label: "Overall, how was it?", options: [], required: true }]);
  const update = (i: number, patch: Partial<SurveyQuestion>) => setQs((cur) => cur.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const move = (i: number, d: -1 | 1) =>
    setQs((cur) => {
      const next = [...cur];
      const j = i + d;
      if (j < 0 || j >= next.length) return cur;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="questions" value={JSON.stringify(qs)} />
      {qs.map((q, i) => (
        <div key={q.id} className="rounded-[12px] border border-line p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
            <div>
              <label htmlFor={`${q.id}-label`} className="crm-label">
                Question {i + 1}
              </label>
              <input id={`${q.id}-label`} value={q.label} onChange={(e) => update(i, { label: e.target.value })} className="crm-input" required />
            </div>
            <div>
              <label htmlFor={`${q.id}-type`} className="crm-label">
                Answer type
              </label>
              <select id={`${q.id}-type`} value={q.type} onChange={(e) => update(i, { type: e.target.value as SurveyQuestion["type"] })} className="crm-input">
                <option value="rating">Rating 1–5</option>
                <option value="single">Pick one</option>
                <option value="multi">Pick any</option>
                <option value="text">Written answer</option>
              </select>
            </div>
          </div>
          {q.type === "single" || q.type === "multi" ? (
            <div className="mt-2">
              <label htmlFor={`${q.id}-opts`} className="crm-label">
                Choices (comma-separated)
              </label>
              <input
                id={`${q.id}-opts`}
                value={q.options.join(", ")}
                onChange={(e) => update(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                className="crm-input"
              />
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="flex min-h-9 items-center gap-2 text-[13px]">
              <input type="checkbox" checked={q.required} onChange={(e) => update(i, { required: e.target.checked })} className="h-4 w-4 accent-navy" />
              Required
            </label>
            <button type="button" className={buttonClass("ghost", "xs")} onClick={() => move(i, -1)} disabled={i === 0}>
              Up
            </button>
            <button type="button" className={buttonClass("ghost", "xs")} onClick={() => move(i, 1)} disabled={i === qs.length - 1}>
              Down
            </button>
            <button type="button" className={buttonClass("bad", "xs")} onClick={() => setQs((cur) => cur.filter((_, j) => j !== i))} disabled={qs.length === 1}>
              Remove
            </button>
          </div>
        </div>
      ))}
      <button type="button" className={`${buttonClass("ghost", "sm")} self-start`} onClick={() => setQs((cur) => [...cur, { id: newId(), type: "text", label: "", options: [], required: false }])}>
        Add a question
      </button>
    </div>
  );
}
