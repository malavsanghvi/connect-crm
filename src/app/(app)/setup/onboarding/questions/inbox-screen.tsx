"use client";

import Link from "next/link";
import { useCallback, useEffect, useReducer, useState } from "react";

import { Alert, Card, KpiGrid, Stat, buttonClass } from "@/components/ui";
import {
  answerRequestFor,
  applyToRestPreview,
  cardView,
  currentGroup,
  evidenceView,
  frontGroup,
  inboxReducer,
  initialState,
  metricTiles,
  noBulkReason,
  progressText,
  rememberNote,
  routeHint,
  sameForRestLabel,
  statusLabel,
  type Busy,
  type CardView,
} from "@/lib/onboarding/resolve/inbox";
import type { InboxView, ItemDetail } from "@/lib/onboarding/resolve/views";

import { answerQuestionAction, deferQuestionAction, loadItemAction, reopenQuestionAction, type QuestionsResult } from "./actions";
import { FindMatchesButton } from "./find-matches";

type Detail = { itemId: string; detail: ItemDetail | null; error: string | null };

/**
 * The questions of one import, one at a time: the plain question, the evidence on cards side by side, the recommended answer
 * already chosen. One button answers it; one answers the others of the same kind the same way; a question can wait (Later), be
 * left as it is (Skip), or be handed on (coming soon). The server is the truth: after every action the screen takes the inbox
 * the server sends back. A failure is shown next to what the person did, with Try again.
 */
export function InboxScreen({ runId, runLabel, initial }: { runId: string; runLabel: string; initial: InboxView }) {
  const [state, dispatch] = useReducer(inboxReducer, initial, initialState);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [attempt, setAttempt] = useState(0);
  // What the person last did, so a failure can offer to do it again.
  const [retry, setRetry] = useState<(() => Promise<void>) | null>(null);

  const front = frontGroup(state);
  const itemId = front?.nextItemId ?? null;

  // The cards of the item in front.
  useEffect(() => {
    if (!itemId) return;
    let alive = true;
    void loadItemAction(itemId).then((res) => {
      if (!alive) return;
      setDetail(res.ok ? { itemId, detail: res.data, error: null } : { itemId, detail: null, error: res.error });
    });
    return () => {
      alive = false;
    };
  }, [itemId, attempt]);

  const act = useCallback(async (busy: Exclude<Busy, null>, call: () => Promise<QuestionsResult<{ view: InboxView }>>) => {
    const run = async () => {
      dispatch({ type: "busy", busy });
      const res = await call();
      if (!res.ok) {
        dispatch({ type: "error", error: res.error });
        return;
      }
      dispatch({ type: "view", view: res.data.view });
    };
    setRetry(() => run);
    await run();
  }, []);

  const busy = state.busy !== null;
  const progress = progressText(state.view.progress);
  const tiles = metricTiles(state.view);

  const answer = (scope: "one" | "rest") => {
    if (!front) return;
    const req = answerRequestFor(front, state.pick, scope);
    if (!req.ok) {
      dispatch({ type: "error", error: req.error });
      return;
    }
    const r = req.request;
    void act(scope === "rest" ? "rest" : "answer", () =>
        answerQuestionAction({ runId, groupId: r.groupId, itemId: r.itemId, answer: r.answer, scope, ...(r.expectedOthers !== null ? { expectedOthers: r.expectedOthers } : {}) }),
    );
  };

  const defer = (status: "postponed" | "skipped") => {
    if (!front) return;
    void act(status === "postponed" ? "later" : "skip", () => deferQuestionAction({ runId, groupId: front.id, status }));
  };

  const reopen = (groupId: string) => void act("reopen", () => reopenQuestionAction({ runId, groupId }));

  return (
    <div className="space-y-4">
      {tiles.length > 0 ? (
        <KpiGrid cols={4}>
          {tiles.map((t) => (
            <Stat key={t.label} label={t.label} value={t.value} hint={t.hint} tone={t.tone} />
          ))}
        </KpiGrid>
      ) : null}

      <Card title={progress.headline} description={progress.minutes ? `${progress.minutes} of your time` : undefined}>
        <div
          className="h-3 w-full overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-label="Questions answered"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.total - progress.left}
        >
          <div className="h-full rounded-full bg-success transition-all" style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
        </div>
        <p className="mt-2 text-[12px] text-muted">
          {progress.total - progress.left} of {progress.total} {progress.total === 1 ? "question" : "questions"} done
          {state.view.progress && state.view.progress.answeredByRules > 0
            ? ` · ${state.view.progress.answeredByRules.toLocaleString("en-US")} answered from what you said before`
            : ""}
        </p>
      </Card>

      {state.error ? (
        <Alert
          tone="danger"
          title="That did not work"
          action={
            retry ? (
              <button type="button" className={buttonClass("bad", "xs")} disabled={busy} onClick={() => void retry()}>
                Try again
              </button>
            ) : null
          }
        >
          {state.error}
        </Alert>
      ) : null}

      {front ? (
        <Card title={front.question.title} description={front.question.detail}>
          {front.tier === "D" ? <p className="mb-2 text-[12px] font-bold text-brown">A person decides this each time. Nothing is remembered.</p> : null}
          <p className="text-[12px] text-muted">
            {front.openItems} to answer
            {front.status === "postponed" ? " · you put this one off" : ""}
          </p>

          <ItemCards
            detail={detail}
            itemId={itemId}
            onRetry={() => {
              setDetail(null);
              setAttempt((n) => n + 1);
            }}
          />

          <fieldset className="mt-4" disabled={busy}>
            <legend className="text-[13px] font-bold">Your answer</legend>
            <div className="mt-1 space-y-1.5">
              {front.question.answers.map((a) => (
                <label key={a.code} className="flex cursor-pointer items-start gap-2 text-[14px]">
                  <input type="radio" name={`answer-${front.id}`} className="mt-1" checked={state.pick === a.code} onChange={() => dispatch({ type: "pick", code: a.code })} />
                  <span>
                    {a.label}
                    {a.code === front.recommended ? <span className="ml-2 text-[12px] font-bold text-success">Recommended</span> : null}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className={buttonClass(busy ? "off" : "primary")} disabled={busy || !state.pick} aria-busy={state.busy === "answer"} onClick={() => answer("one")}>
              {state.busy === "answer" ? "Saving…" : "Use this answer"}
            </button>
            {sameForRestLabel(front) ? (
              <button type="button" className={buttonClass(busy ? "off" : "ok")} disabled={busy || !state.pick} aria-busy={state.busy === "rest"} onClick={() => answer("rest")}>
                {state.busy === "rest" ? "Saving…" : sameForRestLabel(front)}
              </button>
            ) : null}
            <button type="button" className={buttonClass("ghost")} disabled={busy} aria-busy={state.busy === "later"} onClick={() => defer("postponed")} title="Keep it in your list and come back to it">
              {state.busy === "later" ? "Putting off…" : "Later"}
            </button>
            <button type="button" className={buttonClass("ghost")} disabled={busy} aria-busy={state.busy === "skip"} onClick={() => defer("skipped")} title="Leave these as they are: nothing is joined">
              {state.busy === "skip" ? "Skipping…" : "Skip"}
            </button>
            <button type="button" className={buttonClass("off")} disabled aria-describedby="ask-someone-else" title="Coming soon">
              Ask someone else
            </button>
          </div>
          <p id="ask-someone-else" className="mt-1 text-[12px] text-muted">
            Ask someone else is coming soon: you will be able to send a question to the person best placed to answer it, with a link.{" "}
            {routeHint(front) ?? ""}
          </p>
          {state.pick && sameForRestLabel(front) ? <p className="mt-1 text-[12px] text-muted">{applyToRestPreview(front, state.pick)}</p> : null}
          {noBulkReason(front) ? <p className="mt-1 text-[12px] text-muted">{noBulkReason(front)}</p> : null}
          <p className="mt-1 text-[12px] text-muted">{rememberNote(front)}</p>
        </Card>
      ) : (
        <Card title="No questions left to answer">
          <p className="text-[14px]">
            {state.view.progress && state.view.progress.groupsTotal === 0
              ? "Weaver found nothing it needs to ask about in this file."
              : "Everything is answered, skipped or passed on."}{" "}
            Your answers are saved with this import. The import will use them in a later update.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link className={buttonClass("primary")} href="/setup/onboarding">
              Back to guided onboarding
            </Link>
            <Link className={buttonClass("ghost")} href="/settings/import">
              Open Data import
            </Link>
          </div>
        </Card>
      )}

      <Card title="All the questions" description={`${runLabel}. Most valuable first: money, then members.`}>
        {state.view.groups.length === 0 ? (
          <p className="text-[13px] text-muted">There are no questions for this import.</p>
        ) : (
          <ul className="divide-y divide-line">
            {[...state.view.groups]
              .sort((a, b) => a.rank - b.rank)
              .map((g) => (
                <li key={g.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px]">{g.question.title}</p>
                    <p className="text-[12px] text-muted">
                      {statusLabel(g.status)}
                      {g.openItems > 0 && g.status !== "answered" ? ` · ${g.openItems} to answer` : ""}
                      {g.tier === "D" ? " · held for a person" : ""}
                      {g.status === "sent" && g.routedTo ? ` · for the ${g.routedTo === "treasurer" ? "treasurer" : "membership coordinator"}` : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {g.status === "answered" ? (
                      <button type="button" className={buttonClass("ghost", "xs")} disabled={busy} onClick={() => reopen(g.id)} title="Clear the answers and the remembered answer made from them">
                        Take the answers back
                      </button>
                    ) : currentGroup(state.view, g.id)?.id === g.id && g.id !== front?.id ? (
                      <button type="button" className={buttonClass("ghost", "xs")} disabled={busy} onClick={() => dispatch({ type: "select", groupId: g.id })}>
                        Open
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
          </ul>
        )}
      </Card>

      <div className="space-y-1 text-[12px] text-muted">
        <p>Changed the file, or want Weaver to use what it has learned from other imports? Look again. Your own answers are kept.</p>
        <FindMatchesButton runId={runId} label="Look for matches again" variant="ghost" openAfter={false} />
      </div>
    </div>
  );
}

function ItemCards({ detail, itemId, onRetry }: { detail: Detail | null; itemId: string | null; onRetry: () => void }) {
  if (!itemId) return null;
  if (!detail || detail.itemId !== itemId) {
    return (
      <p className="mt-3 text-[13px] text-muted" role="status" aria-live="polite">
        Opening the details…
      </p>
    );
  }
  if (detail.error || !detail.detail) {
    return (
      <div className="mt-3">
        <Alert
          tone="danger"
          action={
            <button type="button" className={buttonClass("bad", "xs")} onClick={onRetry}>
              Try again
            </button>
          }
        >
          {detail.error ?? "Could not open this question — the details were empty."}
        </Alert>
      </div>
    );
  }
  const d = detail.detail;
  const evidence = evidenceView(d);
  return (
    <div className="mt-3">
      <div className={`grid gap-3 ${d.records.length > 1 ? "sm:grid-cols-2" : ""}`}>
        {d.records.map((r) => (
          <RecordCard key={r.id} card={cardView(r)} />
        ))}
      </div>
      {evidence.summary ? <p className="mt-2 text-[13px]">{evidence.summary}</p> : null}
      {d.limited ? <p className="mt-1 text-[12px] text-muted">This row is held, so phone numbers, e-mail addresses and street addresses are not shown here.</p> : null}
      {d.answer ? <p className="mt-1 text-[12px] text-muted">Already answered.</p> : null}
    </div>
  );
}

function RecordCard({ card }: { card: CardView }) {
  return (
    <div className={`rounded-lg border p-3 text-[13px] ${card.held ? "border-saffron/60" : "border-line"}`}>
      <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted">
        {card.kind}
        {card.inRecords ? " · already in your records" : ""}
      </p>
      <p className="font-semibold">{card.heading}</p>
      {card.lines.map((l) => (
        <p key={l} className="text-muted">
          {l}
        </p>
      ))}
      {card.ids.length > 0 ? (
        <ul className="mt-1">
          {card.ids.map((i) => (
            <li key={i} className="text-muted">
              {i}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-1 text-[11px] text-muted">{card.origin}</p>
    </div>
  );
}
