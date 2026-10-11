// The confirmation card's behaviour, apart from how it looks: a small state machine plus the function that presses the button.
// Rules it keeps: one press at a time (a second click while the first is in flight does nothing); the security code is asked for
// only through the existing security window (requestCode), never typed anywhere in the chat; "Done" only after the server said ok.

import type { ConfirmRequest, ConfirmResponse, ProposalCard } from "./protocol";

export type ProposalPhase =
  | "ready"
  | "confirming"
  | "waiting_for_code"
  | "done"
  | "failed"
  | "cancelling"
  | "cancelled"
  | "expired";

export type ProposalFlow = {
  proposal: ProposalCard;
  phase: ProposalPhase;
  /** After "done": what the server said happened. */
  message?: string;
  data?: unknown;
  /** After "failed" (or a cancel that did not go through): plain English, shown next to the buttons. */
  error?: string;
  /** A calm note that is not an error ("The security code was not entered. Nothing was changed."). */
  notice?: string;
};

export type ProposalAction =
  | { type: "confirm_started" }
  | { type: "code_needed" }
  | { type: "code_verified" }
  | { type: "code_cancelled" }
  | { type: "proposal_replaced"; proposal: ProposalCard }
  | { type: "confirmed"; message: string; data?: unknown }
  | { type: "confirm_failed"; error: string; proposal?: ProposalCard }
  | { type: "cancel_started" }
  | { type: "cancelled" }
  | { type: "cancel_failed"; error: string }
  | { type: "expired" };

export function initialProposalFlow(proposal: ProposalCard): ProposalFlow {
  return { proposal, phase: "ready" };
}

/** Phases in which the person can still press the main button. */
export function canPress(phase: ProposalPhase): boolean {
  return phase === "ready" || phase === "failed";
}

export function isFinished(phase: ProposalPhase): boolean {
  return phase === "done" || phase === "cancelled" || phase === "expired";
}

export const NOT_ENTERED_NOTICE = "The security code was not entered, so nothing was changed. Press the button again when you are ready.";
export const LOST_CONTACT_ERROR =
  "Could not confirm — the server did not respond. It may or may not have gone through, so check the record before you try again.";
export const CODE_STILL_NEEDED_ERROR = "The security code was accepted, but this still needs a fresh check. Try again.";
export const CANCEL_FAILED_ERROR =
  "Could not cancel this on the server, so it is still waiting. Nothing changes unless you press the button, and it runs out of time on its own.";

export function proposalReducer(flow: ProposalFlow, action: ProposalAction): ProposalFlow {
  switch (action.type) {
    case "confirm_started":
      // Double-click safe: only a card that is waiting (or failed and may be tried again) can start.
      return canPress(flow.phase) ? { proposal: flow.proposal, phase: "confirming" } : flow;
    case "code_needed":
      return flow.phase === "confirming" ? { ...flow, phase: "waiting_for_code" } : flow;
    case "code_verified":
      return flow.phase === "waiting_for_code" ? { ...flow, phase: "confirming" } : flow;
    case "code_cancelled":
      return flow.phase === "waiting_for_code" ? { proposal: flow.proposal, phase: "ready", notice: NOT_ENTERED_NOTICE } : flow;
    case "proposal_replaced":
      return isFinished(flow.phase) ? flow : { ...flow, proposal: action.proposal };
    case "confirmed":
      return flow.phase === "confirming" ? { proposal: flow.proposal, phase: "done", message: action.message, data: action.data } : flow;
    case "confirm_failed":
      return flow.phase === "confirming" || flow.phase === "waiting_for_code"
        ? { proposal: action.proposal ?? flow.proposal, phase: "failed", error: action.error }
        : flow;
    case "cancel_started":
      return canPress(flow.phase) ? { proposal: flow.proposal, phase: "cancelling" } : flow;
    case "cancelled":
      return flow.phase === "cancelling" ? { proposal: flow.proposal, phase: "cancelled" } : flow;
    case "cancel_failed":
      return flow.phase === "cancelling" ? { proposal: flow.proposal, phase: "ready", error: action.error } : flow;
    case "expired":
      return canPress(flow.phase) ? { proposal: flow.proposal, phase: "expired" } : flow;
  }
}

// ---------------------------------------------------------------------------
// Time left
// ---------------------------------------------------------------------------
export type Expiry = { expired: boolean; text: string };

/** "valid for 14 minutes" / "valid for less than a minute" / expired. A date that cannot be read says nothing. */
export function describeExpiry(expiresAt: string, nowMs: number): Expiry {
  const end = Date.parse(expiresAt);
  if (!Number.isFinite(end)) return { expired: false, text: "" };
  const left = end - nowMs;
  if (left <= 0) return { expired: true, text: "This has run out of time." };
  const minutes = Math.floor(left / 60_000);
  if (minutes < 1) return { expired: false, text: "valid for less than a minute" };
  if (minutes < 120) return { expired: false, text: `valid for ${minutes} ${minutes === 1 ? "minute" : "minutes"}` };
  const hours = Math.floor(minutes / 60);
  return { expired: false, text: `valid for ${hours} hours` };
}

export function isExpired(proposal: ProposalCard, nowMs: number): boolean {
  return describeExpiry(proposal.expiresAt, nowMs).expired;
}

// ---------------------------------------------------------------------------
// Pressing the button
// ---------------------------------------------------------------------------
export type ConfirmDeps = {
  confirm: (req: ConfirmRequest) => Promise<ConfirmResponse>;
  /** Opens the security-code window; true once the code was verified, false if the person closed it or it cannot be opened. */
  requestCode: (what: string) => Promise<boolean>;
  now: () => number;
};

/**
 * Press the confirm button: ask the server to run the proposal; if it wants a fresh security code, open the security window,
 * then confirm once more with the fresh proposal the server handed back. Every step is reported through `dispatch`.
 * Callers keep their own "already running" guard so a double click never gets here twice.
 */
export async function runConfirm(deps: ConfirmDeps, proposal: ProposalCard, dispatch: (a: ProposalAction) => void): Promise<void> {
  if (isExpired(proposal, deps.now())) {
    dispatch({ type: "expired" });
    return;
  }
  dispatch({ type: "confirm_started" });
  let current = proposal;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let res: ConfirmResponse;
    try {
      res = await deps.confirm({ proposalId: current.id, inputHash: current.inputHash });
    } catch {
      dispatch({ type: "confirm_failed", error: LOST_CONTACT_ERROR });
      return;
    }
    if (res.ok) {
      dispatch({ type: "confirmed", message: res.message, data: res.data });
      return;
    }
    if (res.needsStepUp && attempt === 0) {
      // The first proposal is used up by the step-up; the server hands back a fresh one for the same action.
      if (res.retryProposal) {
        current = res.retryProposal;
        dispatch({ type: "proposal_replaced", proposal: current });
      }
      dispatch({ type: "code_needed" });
      const verified = await deps.requestCode(current.title);
      if (!verified) {
        dispatch({ type: "code_cancelled" });
        return;
      }
      dispatch({ type: "code_verified" });
      continue;
    }
    dispatch({
      type: "confirm_failed",
      error: res.needsStepUp ? CODE_STILL_NEEDED_ERROR : res.error,
      proposal: res.retryProposal,
    });
    return;
  }
}

// ---------------------------------------------------------------------------
// One press at a time
// ---------------------------------------------------------------------------
export type PressGuard = {
  readonly running: boolean;
  /** Runs `fn` unless another press is still running; then it does nothing and returns undefined. */
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
};

/** The card's double-click guard: a second click (or a click on Cancel) while a press is in flight is ignored. */
export function createPressGuard(): PressGuard {
  let running = false;
  return {
    get running() {
      return running;
    },
    async run(fn) {
      if (running) return undefined;
      running = true;
      try {
        return await fn();
      } finally {
        running = false;
      }
    },
  };
}
