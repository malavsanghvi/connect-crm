"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";

import { useToast } from "@/components/toast";
import { Alert, buttonClass, InfoBox, StatusText } from "@/components/ui";
import {
  nivaAnswerMadeBy,
  NIVA_TEST_MAX_WAIT_MS,
  NIVA_TEST_POLL_MS,
  nivaTestOutcome,
  nivaTestPhase,
  nivaTestSourceStatus,
  nivaTestWaitingLine,
  type NivaTestPhase,
  type NivaTestResult,
  type NivaTestsToday,
} from "@/lib/niva";

import { askNivaTestAction, getNivaTestResultAction } from "./actions";

const DOING = "send the test question to Niva";

/** One test in the box: asked, then checked every few seconds until Niva has an outcome. */
type Run = {
  id: string;
  question: string;
  includeInReview: boolean;
  /** When this round of checking started (Check again starts a new round). */
  startedAt: number;
  elapsed: number;
  result: NivaTestResult | null;
  phase: NivaTestPhase | "error";
  error: string | null;
};

/**
 * G17: Content › Niva "Test Niva" (app.niva_test_ask, 0575). Content staff ask a question as a
 * member would, optionally including sources waiting for approval, and see the answer, the
 * sources it cites with their status, and why there is no answer when there is none. The result
 * is checked every 2.5 seconds for up to 90 seconds; after that, or when a check fails, Check again
 * starts another round. Every test is also listed under Staff tests.
 */
export function NivaTestBox({ initialTests }: { initialTests: NivaTestsToday | null }) {
  const router = useRouter();
  const toast = useToast();
  const [question, setQuestion] = useState("");
  const [includeInReview, setIncludeInReview] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [asking, startAsk] = useTransition();
  const [run, setRun] = useState<Run | null>(null);
  const [tests, setTests] = useState<NivaTestsToday | null>(initialTests);
  // Each ask or Check again is a new round; a check that comes back for an older round is dropped.
  const round = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      round.current += 1;
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function stopChecking() {
    round.current += 1;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    return round.current;
  }

  async function check(id: string, startedAt: number, mine: number) {
    const res = await getNivaTestResultAction(id);
    if (round.current !== mine) return;
    const elapsed = Date.now() - startedAt;
    if (!res.ok) {
      setRun((r) => (r && r.id === id ? { ...r, elapsed, phase: "error", error: res.error } : r));
      return;
    }
    const result = res.data ?? null;
    const phase = nivaTestPhase(result, elapsed);
    setRun((r) => (r && r.id === id ? { ...r, elapsed, result: result ?? r.result, phase, error: null } : r));
    if (phase === "waiting") {
      timer.current = setTimeout(() => void check(id, startedAt, mine), NIVA_TEST_POLL_MS);
    } else {
      // The Staff tests list further down shows the test with its outcome.
      router.refresh();
    }
  }

  /** `delayMs` 0 reads the result at once (0579: Niva usually answers from the community's own content as the test is asked). */
  function startChecking(id: string, delayMs: number = NIVA_TEST_POLL_MS) {
    const mine = stopChecking();
    const startedAt = Date.now();
    setRun((r) => (r && r.id === id ? { ...r, startedAt, elapsed: 0, phase: "waiting", error: null } : r));
    timer.current = setTimeout(() => void check(id, startedAt, mine), delayMs);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = question.trim();
    if (!q) {
      setAskError(`Could not ${DOING} — type a question first.`);
      return;
    }
    setAskError(null);
    const fd = new FormData();
    fd.set("question", q);
    if (includeInReview) fd.set("include_in_review", "1");
    startAsk(async () => {
      const res = await askNivaTestAction(null, fd);
      if (!res.ok || !res.data) {
        const error = res.ok ? `Could not ${DOING} — no test came back. Try again.` : res.error;
        setAskError(error);
        toast?.show(error, "bad");
        return;
      }
      const asked = res.data;
      setTests(asked.testsToday);
      setRun({
        id: asked.id,
        question: asked.question || q,
        includeInReview: asked.includeInReview,
        startedAt: Date.now(),
        elapsed: 0,
        result: null,
        phase: "waiting",
        error: null,
      });
      startChecking(asked.id, asked.answerStatus === "pending" ? NIVA_TEST_POLL_MS : 0);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={onSubmit} className="flex flex-col gap-2" aria-busy={asking}>
        <label htmlFor="niva-test-question" className="crm-label">
          Question
        </label>
        <textarea
          id="niva-test-question"
          name="question"
          rows={2}
          maxLength={1000}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="When is the derasar open on Sunday?"
          className="crm-input"
        />
        <label className="flex items-start gap-2 text-[13px]">
          <input
            type="checkbox"
            name="include_in_review"
            value="1"
            checked={includeInReview}
            onChange={(e) => setIncludeInReview(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Include sources waiting for approval
            <span className="block text-[12px] text-muted">
              See how Niva would answer once they are approved. Members only ever get answers from approved sources.
            </span>
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={asking} className={buttonClass("primary", "sm")}>
            {asking ? "Sending…" : "Ask Niva"}
          </button>
          {tests ? <span className={`text-[12px] ${tests.full ? "font-semibold text-danger" : "text-muted"}`}>{tests.label}</span> : null}
        </div>
        {askError ? (
          <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
            {askError}
          </p>
        ) : null}
      </form>
      {run ? <TestRun run={run} onCheckAgain={() => startChecking(run.id)} /> : null}
    </div>
  );
}

function TestRun({ run, onCheckAgain }: { run: Run; onCheckAgain: () => void }) {
  const r = run.result;
  const checkAgain = (
    <button type="button" onClick={onCheckAgain} className={buttonClass(run.phase === "error" ? "bad" : "ghost", "xs")}>
      Check again
    </button>
  );
  return (
    <div className="rounded-[10px] border border-line-soft px-3 py-3" aria-live="polite">
      <p className="text-[12px] text-muted">You asked{run.includeInReview ? ", including sources waiting for approval" : ""}:</p>
      <p className="font-bold">{run.question}</p>
      {run.phase === "waiting" ? <p className="mt-2 text-[13px] text-muted">{nivaTestWaitingLine(r, run.elapsed)}</p> : null}
      {run.phase === "error" ? (
        <div className="mt-2">
          <Alert tone="danger" title="Could not check for Niva's answer" action={checkAgain}>
            {run.error} The test is saved; it is also listed under Staff tests below.
          </Alert>
        </div>
      ) : null}
      {run.phase === "timed_out" ? (
        <div className="mt-2">
          <Alert tone="warning" title={`Niva hasn't answered within ${Math.round(NIVA_TEST_MAX_WAIT_MS / 1000)} seconds`} action={checkAgain}>
            {nivaTestWaitingLine(r, run.elapsed).replace(/… \(\d+ s\)$/, ".")} The test is saved and listed under Staff tests below; check again in a
            minute. If Niva&apos;s status at the top of this page shows a problem, that is the likely cause.
          </Alert>
        </div>
      ) : null}
      {run.phase === "done" && r ? <TestOutcome r={r} /> : null}
    </div>
  );
}

function TestOutcome({ r }: { r: NivaTestResult }) {
  const v = nivaTestOutcome(r);
  return (
    <div className="mt-2 flex flex-col gap-2">
      <p>
        <StatusText tone={v.status.tone}>{v.status.label}</StatusText>
        {v.why ? <span className="block text-[12px] text-muted">{v.why}</span> : null}
      </p>
      {r.answer ? <InfoBox className="whitespace-pre-line">{r.answer}</InfoBox> : null}
      {v.note ? <Alert tone="warning">{v.note}</Alert> : null}
      {r.sources.length > 0 ? (
        <div>
          <p className="crm-label">Sources Niva cited</p>
          <ul className="flex flex-col gap-1">
            {r.sources.map((s) => {
              const st = nivaTestSourceStatus(s);
              return (
                <li key={s.id} className="text-[13px]">
                  <span className="font-semibold">{s.title}</span> · <StatusText tone={st.tone}>{st.label}</StatusText>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="block break-all text-[12px] text-navy underline">
                      {s.url}
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {r.answer && r.model ? (
        <p className="text-[12px] text-muted">
          {nivaAnswerMadeBy(r.model, r.sources)}
          {r.model.startsWith("own:") ? " · no AI" : ` (${r.model})`}
        </p>
      ) : null}
    </div>
  );
}
