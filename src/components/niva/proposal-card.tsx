"use client";

import { useMemo, useReducer, useState, type ReactNode } from "react";

import { Icon } from "@/components/brand/icons";
import { useStepUp } from "@/components/step-up";
import { browserFetch, confirmProposal, rejectProposal } from "@/lib/assistant/client";
import {
  CANCEL_FAILED_ERROR,
  canPress,
  createPressGuard,
  describeExpiry,
  initialProposalFlow,
  proposalReducer,
  runConfirm,
  type ConfirmDeps,
  type ProposalFlow,
  type ProposalPhase,
} from "@/lib/assistant/proposal";
import type { ProposalCard as ProposalCardData } from "@/lib/assistant/protocol";
import { asHouseholdCard, describeResult, isEmptyView, type HouseholdCardView } from "@/lib/assistant/result-view";
import { buttonClass } from "@/components/ui";

import { NivaHouseholdCard } from "./niva-household-card";
import { ResultCardsView } from "./result-cards";
import { useNow } from "./use-now";

function Shield() {
  return (
    <Icon name="shield" className="h-4 w-4 shrink-0" />
  );
}

/**
 * What the person sees before anything changes: in plain sentences what will happen, the households it touches (never a name
 * alone), a clear button, a Cancel, and how long it stays valid. Pure: the state comes in, the two buttons call back.
 */
export function ProposalCardView({
  flow,
  nowMs,
  onConfirm,
  onCancel,
  children,
}: {
  flow: ProposalFlow;
  nowMs: number;
  onConfirm: () => void;
  onCancel: () => void;
  /** Shown under the "Done" message (the result of what was done). */
  children?: ReactNode;
}) {
  const { proposal } = flow;
  const expiry = describeExpiry(proposal.expiresAt, nowMs);
  // A card nobody pressed is expired the moment its time is up, even if no timer has fired yet.
  const phase: ProposalPhase = expiry.expired && canPress(flow.phase) ? "expired" : flow.phase;
  const working = phase === "confirming" || phase === "waiting_for_code" || phase === "cancelling";
  const households = (proposal.cards ?? []).map(asHouseholdCard).filter((c): c is HouseholdCardView => c !== null);
  const finished = phase === "done" || phase === "cancelled" || phase === "expired";

  return (
    <section
      aria-label={`Needs your OK: ${proposal.title}`}
      aria-busy={working}
      className={`overflow-hidden rounded-xl border bg-white text-[13px] text-ink ${phase === "done" ? "border-success-200" : "border-saffron-200"}`}
    >
      <div className="flex items-center gap-1.5 bg-saffron-50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-brown">
        <Shield />
        {phase === "done" ? "Done" : phase === "cancelled" ? "Cancelled" : phase === "expired" ? "Ran out of time" : "Needs your OK"}
      </div>
      <div className="flex flex-col gap-2.5 px-3 py-3">
        <h4 className="text-[15px] font-bold leading-snug">{proposal.title}</h4>

        {phase !== "done" ? (
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-[0.04em] text-muted">What will happen</p>
            {proposal.lines.length > 0 ? (
              <ul className="m-0 list-disc space-y-0.5 pl-5">
                {proposal.lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">Nothing else to show.</p>
            )}
          </div>
        ) : null}

        {households.length > 0 && phase !== "done" ? (
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-[0.04em] text-muted">{households.length === 1 ? "Household" : "Households"}</p>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {households.map((h) => (
                <li key={h.household_id}>
                  <NivaHouseholdCard card={h} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {phase === "done" ? (
          <div role="status" className="rounded-lg border border-success-200 bg-success-50 px-3 py-2 text-success-900">
            <p>{flow.message}</p>
          </div>
        ) : null}
        {phase === "done" ? children : null}

        {phase === "waiting_for_code" ? (
          <p role="status" className="rounded-lg bg-canvas px-3 py-2 text-muted">
            Waiting for your security code. Enter it in the window that opened — it is never typed into this chat.
          </p>
        ) : null}
        {flow.notice && phase === "ready" ? (
          <p role="status" className="rounded-lg bg-canvas px-3 py-2 text-muted">
            {flow.notice}
          </p>
        ) : null}
        {flow.error && (phase === "failed" || phase === "ready") ? (
          <p role="alert" className="rounded-lg border border-danger/30 bg-danger-50 px-3 py-2 text-danger">
            {flow.error}
          </p>
        ) : null}
        {phase === "cancelled" ? <p role="status" className="text-muted">Cancelled. Nothing was changed.</p> : null}
        {phase === "expired" ? (
          <p role="status" className="text-muted">This ran out of time, so nothing was changed. Ask again to get a new one.</p>
        ) : null}

        {!finished ? (
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <button type="button" onClick={onConfirm} disabled={!canPress(phase)} className={`${buttonClass("primary", "sm")} disabled:cursor-not-allowed disabled:opacity-60`}>
              {phase === "confirming" || phase === "waiting_for_code" ? "Working…" : phase === "failed" ? "Try again" : proposal.confirmText}
            </button>
            <button type="button" onClick={onCancel} disabled={!canPress(phase)} className={`${buttonClass("ghost", "sm")} disabled:cursor-not-allowed disabled:opacity-60`}>
              {phase === "cancelling" ? "Cancelling…" : "Cancel"}
            </button>
            {expiry.text ? <span className="text-xs text-muted">{expiry.text}</span> : null}
          </div>
        ) : null}
        {!finished ? <p className="text-xs text-muted">Nothing changes until you press the button.</p> : null}
      </div>
    </section>
  );
}

/** The confirmation card, wired to the server and to the existing security-code window. */
export function ProposalCard({ proposal }: { proposal: ProposalCardData }) {
  const [flow, dispatch] = useReducer(proposalReducer, proposal, initialProposalFlow);
  const stepUp = useStepUp();
  const nowMs = useNow(15_000);
  const [guard] = useState(createPressGuard);

  const deps = useMemo<ConfirmDeps>(
    () => ({
      confirm: (req) => confirmProposal(browserFetch, req),
      // The code is entered ONLY in the security window (step-up.tsx); without it the answer is "not entered".
      requestCode: async (what) => (stepUp ? stepUp.request(what) : false),
      now: () => Date.now(),
    }),
    [stepUp],
  );

  // One press at a time: a second click on the button, or on Cancel, while one is in flight does nothing.
  const confirm = () => guard.run(() => runConfirm(deps, flow.proposal, dispatch));
  const cancel = () =>
    guard.run(async () => {
      dispatch({ type: "cancel_started" });
      const ok = await rejectProposal(browserFetch, { proposalId: flow.proposal.id, inputHash: flow.proposal.inputHash });
      dispatch(ok ? { type: "cancelled" } : { type: "cancel_failed", error: CANCEL_FAILED_ERROR });
    });

  const resultView = flow.phase === "done" && flow.data !== undefined && flow.data !== null ? describeResult(flow.data) : null;

  return (
    <ProposalCardView flow={flow} nowMs={nowMs} onConfirm={() => void confirm()} onCancel={() => void cancel()}>
      {resultView && !isEmptyView(resultView) ? <ResultCardsView title="What was done" view={resultView} /> : null}
    </ProposalCardView>
  );
}
