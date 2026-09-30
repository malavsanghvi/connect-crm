"use client";

import { Alert, Card, buttonClass } from "@/components/ui";
import { describeExisting, type ExistingHousehold } from "@/lib/onboarding/existing";
import { mergeWouldJoinExisting, type Group, type MatchResult, type Question } from "@/lib/onboarding/match";
import type { Decision } from "@/lib/onboarding/progress";

import { ROW_OFFSET } from "./dataset-step";

export type RowLine = { label: string; detail: string };

const n = (x: number) => x.toLocaleString("en-US");
const SHOWN_EXISTING = 40;

/**
 * The households review: what was linked without asking, which uploaded rows belong to households that are
 * already in the records (and so create nothing new), and one question at a time where the evidence is thin.
 */
export function ReviewStep({
  match,
  finalGroups,
  answers,
  qi,
  donations,
  people,
  existingById,
  compared,
  existingNote,
  rowLines,
  blockedAnswers,
  onAnswer,
  onQuestion,
  onBack,
  onContinue,
}: {
  match: MatchResult;
  finalGroups: Group[];
  answers: Record<number, Decision>;
  qi: number;
  donations: number;
  people: number;
  existingById: ReadonlyMap<string, ExistingHousehold>;
  /** True when the households already in the records were read and compared. */
  compared: boolean;
  existingNote: string | null;
  rowLines: ReadonlyMap<number, RowLine>;
  /** Saved "merge" answers that could not be applied because they would join two households already in the records. */
  blockedAnswers: number;
  onAnswer: (q: Question, d: Decision) => void;
  onQuestion: (index: number) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const questions = match.questions;
  const answered = questions.filter((q) => answers[q.id]).length;
  const current = questions[qi] ?? null;
  const groupOf = (id: number) => match.groups.find((g) => g.id === id);
  const merged = new Set(Object.entries(answers).filter(([, v]) => v === "merge").map(([k]) => Number(k)));
  const linked = finalGroups.filter((g) => g.existing);
  const fresh = finalGroups.length - linked.length;
  const countIn = (g: Group) => ({ donations: g.rows.filter((r) => r < ROW_OFFSET.members).length, people: g.rows.filter((r) => r >= ROW_OFFSET.members).length });
  const blockedHere = current ? mergeWouldJoinExisting(match, merged, current.id) && answers[current.id] !== "merge" : false;

  const card = (g: Group, gid: number) => {
    const ex = g.existing ? existingById.get(g.existing.householdId) : undefined;
    return (
      <div key={gid} className="rounded-lg border border-line p-3 text-[13px]">
        {g.existing ? (
          <>
            <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-navy">Already in your records</p>
            <p className="font-semibold">{g.existing.label}</p>
            <p className="text-muted">{ex ? describeExisting(ex) : g.existing.number}</p>
          </>
        ) : (
          <>
            <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted">New from your files</p>
            <p className="font-semibold">{g.displayName}</p>
            {g.names.length > 1 ? <p className="text-muted">Also written as: {g.names.filter((x) => x !== g.displayName).join("; ")}</p> : null}
          </>
        )}
        {g.rows.length > 0 ? (
          <ul className="mt-1.5 space-y-0.5 text-muted">
            {g.rows.slice(0, 3).map((r) => (
              <li key={r}>
                {rowLines.get(r)?.label} · {rowLines.get(r)?.detail}
              </li>
            ))}
            {g.rows.length > 3 ? <li>and {g.rows.length - 3} more</li> : null}
          </ul>
        ) : null}
      </div>
    );
  };

  const involvesExisting = current ? Boolean(groupOf(current.a)?.existing || groupOf(current.b)?.existing) : false;

  return (
    <Card
      title="Households"
      description={`${n(donations)} donations and ${n(people)} people are in ${n(finalGroups.length)} households so far. ${n(match.autoLinks)} links were made automatically from phone, email, address and family IDs.`}
    >
      {!compared ? (
        <div className="mb-3">
          <Alert tone="warning">
            {existingNote ?? "The households you already have were not compared."} Households in your files that you already have may be created a second time; Merge review can combine them afterwards.
          </Alert>
        </div>
      ) : existingNote ? (
        <div className="mb-3">
          <Alert tone="warning">{existingNote}</Alert>
        </div>
      ) : null}
      {compared ? (
        <p className="mb-2 text-[13px]">
          {linked.length > 0 ? (
            <>
              <strong>{n(linked.length)}</strong> of these {linked.length === 1 ? "is a household" : "are households"} you already have: nothing new is created for {linked.length === 1 ? "it" : "them"}, and the people and donations are added to{" "}
              {linked.length === 1 ? "it" : "them"}. <strong>{n(fresh)}</strong> {fresh === 1 ? "is" : "are"} new.
            </>
          ) : (
            <>None of them is a household you already have: all {n(fresh)} are new.</>
          )}
        </p>
      ) : null}
      {linked.length > 0 ? (
        <details className="mb-3 rounded-lg border border-line p-3 text-[13px]">
          <summary className="cursor-pointer font-semibold">See the {n(linked.length)} households you already have</summary>
          <ul className="mt-2 space-y-1.5">
            {linked.slice(0, SHOWN_EXISTING).map((g) => {
              const c = countIn(g);
              const ex = g.existing ? existingById.get(g.existing.householdId) : undefined;
              return (
                <li key={g.id}>
                  <strong>Already in your records: {g.existing!.label}</strong>
                  <span className="block text-muted">
                    {ex ? describeExisting(ex) : g.existing!.number}
                    {" — "}
                    {c.donations > 0 ? `${n(c.donations)} donation${c.donations === 1 ? "" : "s"}` : ""}
                    {c.donations > 0 && c.people > 0 ? " and " : ""}
                    {c.people > 0 ? `${n(c.people)} ${c.people === 1 ? "person" : "people"}` : ""} will be added
                  </span>
                  {g.alsoMatches.length > 0 ? (
                    <span className="block text-brown">
                      Also looks like {g.alsoMatches.map((e) => `${e.label} (${e.number})`).join(", ")}, a separate household in your records. If they are the same family, combine them in Merge review.
                    </span>
                  ) : null}
                </li>
              );
            })}
            {linked.length > SHOWN_EXISTING ? <li className="text-muted">and {n(linked.length - SHOWN_EXISTING)} more</li> : null}
          </ul>
        </details>
      ) : null}
      {blockedAnswers > 0 ? (
        <div className="mb-3">
          <Alert tone="warning">
            {n(blockedAnswers)} of your saved answers {blockedAnswers === 1 ? "was" : "were"} not applied: {blockedAnswers === 1 ? "it" : "they"} would have joined two households you already have, and that is for Merge review.
          </Alert>
        </div>
      ) : null}

      {current ? (
        <div>
          <p className="text-[13px] text-muted">
            Question {qi + 1} of {questions.length} · {answered} answered
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {[current.a, current.b].map((gid) => {
              const g = groupOf(gid);
              return g ? card(g, gid) : null;
            })}
          </div>
          <p className="mt-3 text-[14px]">
            <strong>Same household?</strong> Why we ask: {current.note}.
          </p>
          {blockedHere ? (
            <div className="mt-2">
              <Alert tone="warning">
                You already linked one of these to a different household from your records. Joining two households you already have is done in Merge review, so this can only be kept separate here.
              </Alert>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass(blockedHere ? "off" : answers[current.id] === "merge" ? "ok" : "primary")}
              disabled={blockedHere}
              aria-pressed={answers[current.id] === "merge"}
              onClick={() => onAnswer(current, "merge")}
            >
              {involvesExisting ? "Yes, it is that household" : "Yes, merge them"}
            </button>
            <button type="button" className={buttonClass(answers[current.id] === "separate" ? "warn" : "ghost")} aria-pressed={answers[current.id] === "separate"} onClick={() => onAnswer(current, "separate")}>
              No, keep separate
            </button>
            {qi > 0 ? (
              <button type="button" className={buttonClass("ghost")} onClick={() => onQuestion(qi - 1)}>
                Previous question
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-[14px]">{questions.length === 0 ? "No questions: every household was clear from your files." : "All questions answered."}</p>
      )}
      <div className="mt-5 flex gap-2 border-t border-line pt-3">
        <button type="button" className={buttonClass("ghost")} onClick={onBack}>
          Back
        </button>
        {questions.length > 0 && !current ? (
          <button type="button" className={buttonClass("ghost")} onClick={() => onQuestion(questions.length - 1)}>
            Review my answers
          </button>
        ) : null}
        <button type="button" className={buttonClass(answered < questions.length ? "off" : "primary")} disabled={answered < questions.length} onClick={onContinue}>
          Continue
        </button>
      </div>
    </Card>
  );
}
