"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

import { verifyStepUpAction } from "@/app/security-actions";
import { Modal } from "@/components/modal";
import { isStepUpError } from "@/lib/errors";

// The step-up modal (stream o-security). When the database refuses a
// sensitive change with SQLSTATE CCSTP ("This needs a fresh 2FA check."), the
// portal asks for the code from the user's authenticator app, verifies it on
// the server (which upgrades the session), then retries the change.

type StepUpApi = {
  /** Ask for a code; resolves true once it was verified, false if the user cancelled. */
  request: (what?: string) => Promise<boolean>;
  /** Run an action; if it comes back asking for a step-up, ask for a code and run it once more. */
  run: <R extends { ok: boolean; error?: string; stepUp?: boolean }>(fn: () => Promise<R>, what?: string) => Promise<R>;
};

const StepUpContext = createContext<StepUpApi | null>(null);

/** True when an action result is the database asking for a fresh 2FA check. */
export function needsStepUp(r: { ok: boolean; error?: string; stepUp?: boolean } | null | undefined): boolean {
  return Boolean(r && !r.ok && (r.stepUp || isStepUpError(r.error ?? "")));
}

export function StepUpProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [what, setWhat] = useState<string | null>(null);
  const [error, setError] = useState<ReactNode>(null);
  const [pending, setPending] = useState(false);
  const waiters = useRef<((ok: boolean) => void)[]>([]);

  const settle = useCallback((ok: boolean) => {
    const list = waiters.current;
    waiters.current = [];
    for (const w of list) w(ok);
  }, []);

  const request = useCallback((label?: string) => {
    setWhat(label ?? null);
    setError(null);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      waiters.current.push(resolve);
    });
  }, []);

  const run = useCallback<StepUpApi["run"]>(
    async (fn, label) => {
      const first = await fn();
      if (!needsStepUp(first)) return first;
      const ok = await request(label);
      return ok ? fn() : first;
    },
    [request],
  );

  async function confirm(code: string | null) {
    if (!code) return;
    setPending(true);
    setError(null);
    try {
      const res = await verifyStepUpAction(code);
      if (!res.ok) {
        setError(
          /not set up an authenticator/i.test(res.error) ? (
            <>
              {res.error}{" "}
              <Link href="/account/security" className="font-bold underline" onClick={() => (setOpen(false), settle(false))}>
                Open Account › Security
              </Link>
            </>
          ) : (
            res.error
          ),
        );
        return;
      }
      setOpen(false);
      settle(true);
    } catch (err) {
      console.error("[step-up] verify failed:", err);
      setError("Could not check the code — the server did not respond. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <StepUpContext.Provider value={{ request, run }}>
      {children}
      <Modal
        open={open}
        kicker="Step-up verification"
        title="Confirm it's you"
        confirmLabel="Verify and continue"
        codeLabel="Code from your authenticator app"
        pending={pending}
        error={error}
        onCancel={() => {
          setOpen(false);
          settle(false);
        }}
        onConfirm={confirm}
      >
        {what ? `“${what}” needs a fresh 2FA check. ` : "This needs a fresh 2FA check. "}
        Enter the 6-digit code from your authenticator app. It covers sensitive changes for the next 5 minutes.
      </Modal>
    </StepUpContext.Provider>
  );
}

/** The step-up API, or null outside the portal shell (callers then just show the error). */
export function useStepUp(): StepUpApi | null {
  return useContext(StepUpContext);
}
