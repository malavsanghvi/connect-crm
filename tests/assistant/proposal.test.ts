import { describe, expect, it, vi } from "vitest";

import type { ConfirmRequest, ConfirmResponse, ProposalCard } from "@/lib/assistant/protocol";
import {
  CODE_STILL_NEEDED_ERROR,
  LOST_CONTACT_ERROR,
  NOT_ENTERED_NOTICE,
  createPressGuard,
  describeExpiry,
  initialProposalFlow,
  proposalReducer,
  runConfirm,
  type ConfirmDeps,
  type ProposalAction,
  type ProposalFlow,
} from "@/lib/assistant/proposal";

import { sampleProposal } from "./fake-server";

const NOW = Date.parse("2026-10-10T12:00:00.000Z");
const IN_14_MIN = "2026-10-10T12:14:30.000Z";

/** Plays the actions a press produces, and keeps the flow the card would show. */
function harness(proposal: ProposalCard, deps: Partial<ConfirmDeps> & Pick<ConfirmDeps, "confirm">) {
  let flow: ProposalFlow = initialProposalFlow(proposal);
  const seen: ProposalAction[] = [];
  const dispatch = (a: ProposalAction) => {
    seen.push(a);
    flow = proposalReducer(flow, a);
  };
  const full: ConfirmDeps = { requestCode: async () => true, now: () => NOW, ...deps };
  return { press: () => runConfirm(full, flow.proposal, dispatch), dispatch, get flow() { return flow; }, seen };
}

describe("time left", () => {
  it("says how long a proposal is valid for", () => {
    expect(describeExpiry(IN_14_MIN, NOW)).toEqual({ expired: false, text: "valid for 14 minutes" });
    expect(describeExpiry("2026-10-10T12:01:10.000Z", NOW).text).toBe("valid for 1 minute");
    expect(describeExpiry("2026-10-10T12:00:40.000Z", NOW).text).toBe("valid for less than a minute");
    expect(describeExpiry("2026-10-10T15:30:00.000Z", NOW).text).toBe("valid for 3 hours");
  });
  it("is expired at the moment of expiry, and a date nobody can read says nothing", () => {
    expect(describeExpiry("2026-10-10T12:00:00.000Z", NOW).expired).toBe(true);
    expect(describeExpiry("2026-10-09T12:00:00.000Z", NOW).expired).toBe(true);
    expect(describeExpiry("soon", NOW)).toEqual({ expired: false, text: "" });
  });
});

describe("proposal state machine", () => {
  const ready = initialProposalFlow(sampleProposal());

  it("starts ready", () => {
    expect(ready.phase).toBe("ready");
  });

  it("a second press while the first is in flight does nothing", () => {
    const once = proposalReducer(ready, { type: "confirm_started" });
    expect(once.phase).toBe("confirming");
    expect(proposalReducer(once, { type: "confirm_started" })).toBe(once);
    expect(proposalReducer(once, { type: "cancel_started" })).toBe(once);
  });

  it("done only comes after a confirmed answer, and a done card cannot be pressed again", () => {
    expect(proposalReducer(ready, { type: "confirmed", message: "x" })).toBe(ready);
    const done = proposalReducer(proposalReducer(ready, { type: "confirm_started" }), { type: "confirmed", message: "The venue is now Main Hall." });
    expect(done).toMatchObject({ phase: "done", message: "The venue is now Main Hall." });
    expect(proposalReducer(done, { type: "confirm_started" })).toBe(done);
    expect(proposalReducer(done, { type: "expired" })).toBe(done);
  });

  it("a failed card can be tried again, and keeps the plain-English error until then", () => {
    const failed = [{ type: "confirm_started" }, { type: "confirm_failed", error: "The books for October are locked." }].reduce(
      (f, a) => proposalReducer(f, a as ProposalAction),
      ready,
    );
    expect(failed).toMatchObject({ phase: "failed", error: "The books for October are locked." });
    const again = proposalReducer(failed, { type: "confirm_started" });
    expect(again.phase).toBe("confirming");
    expect(again.error).toBeUndefined();
  });

  it("a card is swapped for a fresh proposal when the server hands one back", () => {
    const fresh = sampleProposal({ id: "p2", inputHash: "hash-2" });
    const failed = [{ type: "confirm_started" }, { type: "confirm_failed", error: "Try again.", proposal: fresh }].reduce((f, a) => proposalReducer(f, a as ProposalAction), ready);
    expect(failed.proposal.id).toBe("p2");
  });

  it("cancel goes cancelling then cancelled; a cancel that fails leaves the card waiting with a sentence", () => {
    const cancelling = proposalReducer(ready, { type: "cancel_started" });
    expect(proposalReducer(cancelling, { type: "cancelled" }).phase).toBe("cancelled");
    const back = proposalReducer(cancelling, { type: "cancel_failed", error: "Could not cancel." });
    expect(back).toMatchObject({ phase: "ready", error: "Could not cancel." });
  });

  it("expired cannot be pressed", () => {
    const expired = proposalReducer(ready, { type: "expired" });
    expect(expired.phase).toBe("expired");
    expect(proposalReducer(expired, { type: "confirm_started" })).toBe(expired);
  });

  it("closing the security window returns to ready with a calm note, nothing changed", () => {
    let f = proposalReducer(ready, { type: "confirm_started" });
    f = proposalReducer(f, { type: "code_needed" });
    expect(f.phase).toBe("waiting_for_code");
    f = proposalReducer(f, { type: "code_cancelled" });
    expect(f).toMatchObject({ phase: "ready", notice: NOT_ENTERED_NOTICE });
    expect(f.error).toBeUndefined();
  });
});

describe("pressing the button", () => {
  it("confirms and shows the server's message", async () => {
    const confirm = vi.fn(async (): Promise<ConfirmResponse> => ({ ok: true, message: "The venue is now Main Hall." }));
    const h = harness(sampleProposal({ expiresAt: IN_14_MIN }), { confirm });
    await h.press();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith({ proposalId: "p1", inputHash: "hash-1" });
    expect(h.flow).toMatchObject({ phase: "done", message: "The venue is now Main Hall." });
  });

  it("when a security code is needed it opens the code window, then confirms again with the fresh proposal", async () => {
    const fresh = sampleProposal({ id: "p2", inputHash: "hash-2", expiresAt: IN_14_MIN });
    const answers: ConfirmResponse[] = [
      { ok: false, error: "This needs a fresh 2FA check.", needsStepUp: true, retryProposal: fresh },
      { ok: true, message: "Done." },
    ];
    const sent: ConfirmRequest[] = [];
    const confirm = async (req: ConfirmRequest) => {
      sent.push(req);
      return answers.shift() as ConfirmResponse;
    };
    const requestCode = vi.fn(async () => true);
    const h = harness(sampleProposal({ expiresAt: IN_14_MIN }), { confirm, requestCode });
    await h.press();
    expect(requestCode).toHaveBeenCalledTimes(1);
    expect(requestCode).toHaveBeenCalledWith("Change the event's venue");
    expect(sent).toEqual([
      { proposalId: "p1", inputHash: "hash-1" },
      { proposalId: "p2", inputHash: "hash-2" },
    ]);
    expect(h.seen.map((a) => a.type)).toEqual(["confirm_started", "proposal_replaced", "code_needed", "code_verified", "confirmed"]);
    expect(h.flow.phase).toBe("done");
  });

  it("closing the code window changes nothing and leaves the (fresh) proposal ready to press again", async () => {
    const fresh = sampleProposal({ id: "p2", inputHash: "hash-2", expiresAt: IN_14_MIN });
    const confirm = vi.fn(async (): Promise<ConfirmResponse> => ({ ok: false, error: "x", needsStepUp: true, retryProposal: fresh }));
    const h = harness(sampleProposal({ expiresAt: IN_14_MIN }), { confirm, requestCode: async () => false });
    await h.press();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(h.flow).toMatchObject({ phase: "ready", notice: NOT_ENTERED_NOTICE });
    expect(h.flow.proposal.id).toBe("p2");
  });

  it("asks for the code only once: a second request for a code is shown as an error", async () => {
    const confirm = vi.fn(async (): Promise<ConfirmResponse> => ({ ok: false, error: "This needs a fresh 2FA check.", needsStepUp: true }));
    const requestCode = vi.fn(async () => true);
    const h = harness(sampleProposal({ expiresAt: IN_14_MIN }), { confirm, requestCode });
    await h.press();
    expect(requestCode).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(h.flow).toMatchObject({ phase: "failed", error: CODE_STILL_NEEDED_ERROR });
  });

  it("an expired proposal never reaches the server", async () => {
    const confirm = vi.fn();
    const h = harness(sampleProposal({ expiresAt: "2026-10-10T11:59:00.000Z" }), { confirm });
    await h.press();
    expect(confirm).not.toHaveBeenCalled();
    expect(h.flow.phase).toBe("expired");
  });

  it("shows the server's plain-English error and allows Try again, which runs once more", async () => {
    const answers: ConfirmResponse[] = [
      { ok: false, error: "Could not record the payment — the October books are locked." },
      { ok: true, message: "Recorded." },
    ];
    const confirm = vi.fn(async () => answers.shift() as ConfirmResponse);
    const h = harness(sampleProposal({ expiresAt: IN_14_MIN }), { confirm });
    await h.press();
    expect(h.flow).toMatchObject({ phase: "failed", error: "Could not record the payment — the October books are locked." });
    await h.press();
    expect(h.flow.phase).toBe("done");
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("never says done when the server did not say ok, even if the answer carries a message", async () => {
    const confirm = async (): Promise<ConfirmResponse> => ({ ok: false, error: "Not saved." });
    const h = harness(sampleProposal({ expiresAt: IN_14_MIN }), { confirm });
    await h.press();
    expect(h.flow.phase).toBe("failed");
    expect(h.flow.message).toBeUndefined();
  });

  it("if the connection drops it says it cannot tell whether it went through", async () => {
    const h = harness(sampleProposal({ expiresAt: IN_14_MIN }), {
      confirm: async () => {
        throw new Error("network");
      },
    });
    await h.press();
    expect(h.flow).toMatchObject({ phase: "failed", error: LOST_CONTACT_ERROR });
  });

  it("two quick presses (a double click) send one request, and Cancel is ignored while it runs", async () => {
    let release: (r: ConfirmResponse) => void = () => {};
    const confirm = vi.fn(() => new Promise<ConfirmResponse>((resolve) => (release = resolve)));
    const h = harness(sampleProposal({ expiresAt: IN_14_MIN }), { confirm });
    const guard = createPressGuard();
    const cancel = vi.fn(async () => {});
    const first = guard.run(() => h.press());
    expect(guard.running).toBe(true);
    expect(h.flow.phase).toBe("confirming");
    const second = guard.run(() => h.press());
    const cancelled = guard.run(cancel);
    release({ ok: true, message: "Done." });
    await Promise.all([first, second, cancelled]);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    expect(guard.running).toBe(false);
    expect(h.flow.phase).toBe("done");
    // A finished card cannot be started again even if a stray click got through.
    expect(proposalReducer(h.flow, { type: "confirm_started" })).toBe(h.flow);
  });

  it("the guard lets the next press through once the first has finished, even after it threw", async () => {
    const guard = createPressGuard();
    await expect(guard.run(async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(await guard.run(async () => 7)).toBe(7);
  });
});
