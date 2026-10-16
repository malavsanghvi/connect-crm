"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";

import { useStepUp } from "@/components/step-up";
import { useToast } from "@/components/toast";
import { Card, buttonClass } from "@/components/ui";
import {
  RETENTION_MAX_YEARS,
  RETENTION_MIN_YEARS,
  previewSentence,
  retentionNote,
  retentionYearsProblem,
  type ProofPolicy,
  type RetentionPreview,
} from "@/lib/payment-proofs/policy";

import { previewProofRetentionAction, saveProofRetentionAction } from "./proof-actions";

// Settings › Storage › Payment proofs: the years proofs are kept, and the legal hold. Raising the years or switching the hold changes
// nothing that exists; shortening asks for a reason and the sign-in code, as other admin-level changes do.

export function ProofRetention({
  policy,
  canEdit,
  held,
  moduleOn,
  expiring,
  expiringError,
}: {
  policy: ProofPolicy;
  canEdit: boolean;
  /** Files held now, when this person can count them; null when they cannot. */
  held: number | null;
  moduleOn: boolean;
  /** "N files become due for removal by <date>. ..." when some do; null when none do (or the function is not there yet). */
  expiring: string | null;
  /** Why the count of files about to be removed could not be read, in plain words; null when it could. */
  expiringError: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const stepUp = useStepUp();
  const reasonId = useId();
  const [years, setYears] = useState(policy.retentionYears);
  const [hold, setHold] = useState(policy.legalHold);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, start] = useTransition();
  const [preview, setPreview] = useState<RetentionPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const asked = useRef(0);

  const shortening = years < policy.retentionYears;
  const changed = years !== policy.retentionYears || hold !== policy.legalHold;

  /** Moves the years and, when they are being shortened, asks the database what that would make due (a missing function = no preview). */
  async function changeYears(next: number) {
    setYears(next);
    setPreview(null);
    setPreviewError(null);
    const ticket = ++asked.current;
    if (next >= policy.retentionYears) {
      setPreviewing(false);
      return;
    }
    setPreviewing(true);
    try {
      const res = await previewProofRetentionAction(next);
      if (ticket !== asked.current) return;
      if (!res.ok) setPreviewError(res.error);
      else setPreview(res.preview);
    } catch (err) {
      if (ticket !== asked.current) return;
      console.error("[settings/storage] the retention preview could not be read:", err);
      setPreviewError("Could not work out what shortening would remove — the server could not be reached. You can still shorten it; the preview is only a warning.");
    } finally {
      if (ticket === asked.current) setPreviewing(false);
    }
  }

  function save() {
    setError(null);
    const bad = retentionYearsProblem(String(years));
    if (bad) {
      setError(`Could not save how long payment proofs are kept — ${bad}`);
      return;
    }
    if (shortening && reason.trim().length < 5) {
      setError("Could not save how long payment proofs are kept — say why you are shortening the years, in a few words. The reason is kept in the audit log.");
      return;
    }
    const fd = new FormData();
    fd.set("years", String(years));
    if (hold) fd.set("legal_hold", "on");
    fd.set("reason", reason);
    start(async () => {
      try {
        const call = () => saveProofRetentionAction(null, fd);
        // Shortening needs a fresh 2FA check (CCSTP): the step-up modal, then one retry.
        const res = stepUp ? await stepUp.run(call, "Changing how long payment proofs are kept") : await call();
        if (!res.ok) {
          setError(res.error);
          toast?.show(res.error, "bad");
          return;
        }
        setReason("");
        toast?.show(res.message ?? "Saved", "ok");
        router.refresh();
      } catch (err) {
        console.error("[settings/storage] saving the proof retention failed:", err);
        const msg = "Could not save how long payment proofs are kept — the server could not be reached. Nothing was changed; try again.";
        setError(msg);
        toast?.show(msg, "bad");
      }
    });
  }

  return (
    <Card
      title="Payment proofs"
      description="Photos and files families send when they paid another way. One setting for every payment method."
    >
      {!moduleOn ? (
        <p className="m-0 text-[13px] text-muted">Payment proofs are switched off for this community. Switch them on in Settings › Modules to set how long they are kept.</p>
      ) : (
        <div className="flex flex-col gap-4" data-proof-retention>
          <dl className="m-0 grid gap-x-6 gap-y-3 text-[13.5px] sm:grid-cols-3">
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted">Held now</dt>
              <dd className="m-0 mt-0.5">{held === null ? "Not shown to you" : `${held.toLocaleString("en-US")} ${held === 1 ? "file" : "files"}`}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted">Counted from</dt>
              <dd className="m-0 mt-0.5">End of the accounting year of the payment, and only once its pledges are final.</dd>
            </div>
          </dl>

          {expiring ? (
            <p role="status" data-proof-expiring className="m-0 rounded-field border border-warning-200 bg-warning-50 px-3 py-2 text-[13.5px] text-warning-ink">
              {expiring}
            </p>
          ) : null}
          {expiringError ? (
            <p role="alert" className="m-0 rounded-field border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
              {expiringError}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[13.5px] font-bold">Kept for</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="One year less"
                disabled={!canEdit || working || years <= RETENTION_MIN_YEARS}
                onClick={() => void changeYears(Math.max(RETENTION_MIN_YEARS, years - 1))}
                className="h-11 w-11 rounded-full border border-navy bg-white text-[20px] font-bold text-navy disabled:cursor-not-allowed disabled:opacity-40"
              >
                −
              </button>
              <strong className="min-w-[72px] text-center text-[18px] tabular-nums" aria-live="polite">
                {years} {years === 1 ? "year" : "years"}
              </strong>
              <button
                type="button"
                aria-label="One year more"
                disabled={!canEdit || working || years >= RETENTION_MAX_YEARS}
                onClick={() => void changeYears(Math.min(RETENTION_MAX_YEARS, years + 1))}
                className="h-11 w-11 rounded-full border border-navy bg-white text-[20px] font-bold text-navy disabled:cursor-not-allowed disabled:opacity-40"
              >
                +
              </button>
            </div>
            <span className="text-[12.5px] text-muted">
              From {RETENTION_MIN_YEARS} to {RETENTION_MAX_YEARS} years. Default 7.
            </span>
          </div>

          <p className="m-0 text-[13.5px] text-ink-2" role="status">
            {retentionNote(policy, years)}
          </p>

          {shortening ? (
            <p role="status" className={`m-0 rounded-field border px-3 py-2 text-[13.5px] ${preview && preview.files > 0 ? "border-danger/30 bg-danger-50 text-danger" : "border-line bg-canvas text-ink-2"}`}>
              {previewing
                ? "Working out what this would make due…"
                : preview
                  ? previewSentence(preview)
                  : previewError ?? "How many files this would make due is not shown on this server."}
            </p>
          ) : null}

          <label className="flex items-start gap-2.5 text-[13.5px] text-ink">
            <input type="checkbox" checked={hold} disabled={!canEdit || working} onChange={(e) => setHold(e.target.checked)} className="mt-1 h-4 w-4" />
            <span>
              <strong>Legal hold</strong>
              <span className="block text-ink-2">While on, no proof is removed and families keep access, whatever the years say. Use it during an audit or a dispute.</span>
            </span>
          </label>

          <p className="m-0 text-[12.5px] text-muted">
            What is removed, and what stays: when a file&apos;s time is up, the photo or file is deleted and a small record stays (its fingerprint, size, type, who sent it, and when and why it was removed), so the audit trail still shows it existed. Rejected or withdrawn proofs follow a shorter clock of 13 months.
          </p>

          {shortening ? (
            <div className="flex flex-col gap-1.5 rounded-field border border-danger/30 bg-danger-50 px-3.5 py-3">
              <label htmlFor={reasonId} className="text-[13px] font-bold text-ink">
                Why are you shortening it? (required, kept in the audit log)
              </label>
              <input id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoComplete="off" className="crm-input min-h-[44px] bg-white" />
              <span className="text-[12.5px] text-muted">You will also be asked for your sign-in code, as for other admin-level changes.</span>
            </div>
          ) : null}

          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={save} disabled={!changed || working} className={buttonClass(shortening ? "bad-solid" : "primary", "md")}>
                {working ? "Saving…" : shortening ? "Shorten the years" : "Save"}
              </button>
              {!changed ? <span className="text-[12.5px] text-muted">No changes to save.</span> : null}
            </div>
          ) : (
            <p className="m-0 text-[12.5px] text-muted">Changing this needs the permission to manage settings.</p>
          )}
          {error ? (
            <p role="alert" className="m-0 rounded-field border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Card>
  );
}
