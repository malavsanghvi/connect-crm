"use client";

import { useState, type FormEvent } from "react";

import { needsStepUp, useStepUp } from "@/components/step-up";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";

import { startQboConnectAction } from "./actions";

/**
 * "Connect QuickBooks": asks which company (in a sandbox), a reason, then the
 * database's fresh 2FA check (the step-up modal), then sends the person to
 * Intuit to sign in and choose the company. Intuit brings them back to
 * /api/oauth/intuit/callback.
 */
export function ConnectQboForm({ sandbox, reconnect }: { sandbox: boolean; reconnect: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stepUp = useStepUp();
  const toast = useToast();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      const call = () => startQboConnectAction(null, fd);
      let res: ActionResult<{ url: string }> = await call();
      if (needsStepUp(res) && stepUp && (await stepUp.request(reconnect ? "Reconnect QuickBooks" : "Connect QuickBooks"))) res = await call();
      if (!res.ok) {
        setError(res.error);
        toast?.show(res.error, "bad");
        return;
      }
      if (!res.data?.url) {
        setError("Could not connect QuickBooks — the sign-in address was not prepared. Try again.");
        return;
      }
      window.location.assign(res.data.url);
    } catch (err) {
      console.error("[qbo] connect failed:", err);
      setError("Could not connect QuickBooks — the server did not respond. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {sandbox ? (
        <fieldset>
          <legend className="crm-label">Which QuickBooks company?</legend>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="company" value="sandbox" defaultChecked className="mt-1" />
            <span>
              <b>An Intuit sandbox company</b> — test entries are really posted there, so the whole flow can be tried.
            </span>
          </label>
          <label className="mt-1 flex items-start gap-2 text-sm">
            <input type="radio" name="company" value="real" className="mt-1" />
            <span>
              <b>Your real company, read-only</b> — map your real chart of accounts; nothing is ever posted. The approved mapping carries over when you go live.
            </span>
          </label>
        </fieldset>
      ) : (
        <input type="hidden" name="company" value="real" />
      )}
      <div>
        <label htmlFor="qbo-connect-reason" className="crm-label">
          Reason (kept in the audit log)
        </label>
        <input id="qbo-connect-reason" name="reason" required maxLength={500} className="crm-input" placeholder="e.g. Treasurer connecting our books" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={buttonClass("primary")}>
          {pending ? "Opening Intuit…" : reconnect ? "Reconnect QuickBooks" : "Connect QuickBooks"}
        </button>
        <span className="text-xs text-muted">You sign in on Intuit&apos;s site and choose the company; we never see your Intuit password.</span>
      </div>
      {error ? (
        <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}
