"use client";

// The step-up check for the vault actions (ONBOARDING_CONTRACT.md: the portal
// catches CCSTP, opens a TOTP challenge, then retries the action). The code is
// verified by Supabase Auth (mfa.challengeAndVerify), which refreshes the
// session with a fresh "totp" entry in its amr claim; the database then lets
// the retried action through. Nothing here claims a check it did not make.
// Enrolling an authenticator app belongs to Settings › Security (o-security).

import { useCallback, useRef, useState, type ReactNode } from "react";

import { Modal } from "@/components/modal";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type Env = { supabaseUrl: string; supabaseAnonKey: string };
type Factor = { id: string; friendly_name?: string | null };

export function useStepUp(env: Env): { request: (action: string) => Promise<boolean>; modal: ReactNode } {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState("");
  const [factor, setFactor] = useState<Factor | null>(null);
  const [noFactor, setNoFactor] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const finish = useCallback((ok: boolean) => {
    setOpen(false);
    setPending(false);
    resolver.current?.(ok);
    resolver.current = null;
  }, []);

  const request = useCallback(
    async (what: string) => {
      setAction(what);
      setError(null);
      setFactor(null);
      setNoFactor(false);
      setOpen(true);
      const result = new Promise<boolean>((resolve) => {
        resolver.current = resolve;
      });
      try {
        const { data, error: listError } = await getSupabaseBrowserClient(env).auth.mfa.listFactors();
        if (listError) throw listError;
        const totp = (data?.totp ?? []).filter((f) => f.status === "verified");
        if (totp.length === 0) setNoFactor(true);
        else setFactor({ id: totp[0].id, friendly_name: totp[0].friendly_name });
      } catch (err) {
        console.error("[integrations] could not list 2FA factors:", err);
        setError(`Could not start the 2FA check — ${err instanceof Error ? err.message : "the sign-in service did not answer"}. Try again.`);
      }
      return result;
    },
    [env],
  );

  async function confirm(code: string | null) {
    if (noFactor) {
      finish(false);
      return;
    }
    if (!factor || !code) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setPending(true);
    setError(null);
    const { error: verifyError } = await getSupabaseBrowserClient(env).auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    if (verifyError) {
      console.error("[integrations] 2FA verification failed:", verifyError);
      setPending(false);
      setError(
        /invalid|expired|code/i.test(verifyError.message)
          ? "That code did not work. Use the newest code from your authenticator app (check the phone's clock if it keeps failing)."
          : `Could not check the code — ${verifyError.message}.`,
      );
      return;
    }
    finish(true);
  }

  const modal = (
    <Modal
      open={open}
      kicker="Fresh 2FA check"
      title={noFactor ? "Two-factor authentication is not set up" : "Confirm it's you"}
      confirmLabel={noFactor ? "Close" : "Verify and continue"}
      codeLabel={noFactor ? undefined : "Code from your authenticator app"}
      pending={pending}
      error={error}
      onConfirm={confirm}
      onCancel={() => finish(false)}
    >
      {noFactor ? (
        <p>
          To {action}, your account needs an authenticator app, and none is set up yet. Add one under Settings › Security, then try again.
          Nothing was changed.
        </p>
      ) : (
        <p>
          To {action}, enter the 6-digit code from your authenticator app{factor?.friendly_name ? ` (${factor.friendly_name})` : ""}. The check is
          good for 5 minutes.
        </p>
      )}
    </Modal>
  );
  return { request, modal };
}
