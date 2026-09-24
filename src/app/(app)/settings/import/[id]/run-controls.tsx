"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { Alert, buttonClass } from "@/components/ui";

import { cancelImportAction, commitBatchAction, decideAction, previewAction, reconcileAction, signOffAction, undoAction, type CommitProgress } from "../actions";

function useRun() {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, fallback: string) => {
    setError(null);
    start(async () => {
      try {
        const res = await fn();
        if (!res.ok) {
          setError(res.error ?? fallback);
          toast?.show(res.error ?? fallback, "bad");
          return;
        }
        if (res.message) toast?.show(res.message, "ok");
        router.refresh();
      } catch (err) {
        console.error("[import run]", fallback, err);
        setError(`${fallback} — the server did not respond. Try again.`);
      }
    });
  };
  return { error, pending, run, router, toast, setError };
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <div className="mt-2">
      <Alert tone="danger">{error}</Alert>
    </div>
  ) : null;
}

/** Import: batches until nothing remains, with progress. Safe to press again after a failure. */
export function CommitButton({ runId, total, label }: { runId: string; total: number; label: string }) {
  const { router, toast } = useRun();
  const [progress, setProgress] = useState<CommitProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      for (let i = 0; i < 10000; i++) {
        const res = await commitBatchAction(runId);
        if (!res.ok) {
          setError(`${res.error} Rows already imported stay imported; press the button again to continue.`);
          return;
        }
        setProgress(res.data!);
        if (res.data!.remaining === 0) break;
      }
      toast?.show("Import finished. Reconcile it next.", "ok");
      router.refresh();
    } catch (err) {
      console.error("[import run] commit failed:", err);
      setError("Could not import the rows — the server did not respond. Rows already imported stay imported; press the button again to continue.");
    } finally {
      setBusy(false);
    }
  }

  const done = progress ? progress.counts.total - progress.remaining : 0;
  return (
    <div>
      <button type="button" className={buttonClass(busy ? "off" : "primary")} disabled={busy} onClick={go}>
        {busy ? "Importing…" : label}
      </button>
      {progress ? (
        <div className="mt-2" role="status">
          <progress className="w-full" max={Math.max(1, progress.counts.total || total)} value={done} />
          <p className="text-[12px] text-muted">
            {done.toLocaleString()} of {(progress.counts.total || total).toLocaleString()} rows · {progress.counts.created} added · {progress.counts.updated} updated ·{" "}
            {progress.counts.failed} failed
          </p>
        </div>
      ) : null}
      <ErrorLine error={error} />
    </div>
  );
}

export function RebuildPreviewButton({ runId }: { runId: string }) {
  const { error, pending, run } = useRun();
  return (
    <>
      <button type="button" className={buttonClass("ghost", "sm")} disabled={pending} onClick={() => run(() => previewAction(runId), "Could not preview the import")}>
        {pending ? "Checking…" : "Refresh the preview"}
      </button>
      <ErrorLine error={error} />
    </>
  );
}

export function DecisionButtons({ runId, rowNo, decision }: { runId: string; rowNo: number; decision: string | null }) {
  const { error, pending, run } = useRun();
  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex gap-1">
        <button
          type="button"
          aria-pressed={decision === "create"}
          className={buttonClass(decision === "create" ? "ok" : "ghost", "xs")}
          disabled={pending}
          onClick={() => run(() => decideAction(runId, rowNo, "create"), "Could not record the decision")}
        >
          Add it
        </button>
        <button
          type="button"
          aria-pressed={decision === "skip"}
          className={buttonClass(decision === "skip" ? "warn" : "ghost", "xs")}
          disabled={pending}
          onClick={() => run(() => decideAction(runId, rowNo, "skip"), "Could not record the decision")}
        >
          Skip it
        </button>
      </span>
      {error ? <span className="text-[12px] text-danger">{error}</span> : null}
    </span>
  );
}

export function ReconcileButton({ runId, again }: { runId: string; again: boolean }) {
  const { error, pending, run } = useRun();
  return (
    <>
      <button type="button" className={buttonClass(again ? "ghost" : "primary", again ? "sm" : "md")} disabled={pending} onClick={() => run(() => reconcileAction(runId), "Could not reconcile the import")}>
        {pending ? "Comparing…" : again ? "Compare again" : "Compare with the file"}
      </button>
      <ErrorLine error={error} />
    </>
  );
}

export function SignOffForm({ runId, needsNote }: { runId: string; needsNote: boolean }) {
  const { error, pending, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <div className="space-y-2">
      <label htmlFor="signoff-note" className="crm-label">
        {needsNote ? "Why the totals differ (required to sign off)" : "Note (optional)"}
      </label>
      <textarea id="signoff-note" className="crm-input min-h-[70px]" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      <button
        type="button"
        className={buttonClass(needsNote && !note.trim() ? "off" : "ok")}
        disabled={pending || (needsNote && !note.trim())}
        onClick={() => run(() => signOffAction(runId, note), "Could not sign the import off")}
      >
        {pending ? "Signing off…" : "Sign off: the data matches the old system"}
      </button>
      <ErrorLine error={error} />
    </div>
  );
}

export function UndoButton({ runId, runNumber, until }: { runId: string; runNumber: number; until: string }) {
  const { router, toast } = useRun();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" className={buttonClass("bad", "sm")} onClick={() => setOpen(true)}>
        Undo import #{runNumber}
      </button>
      <span className="ml-2 text-[12px] text-muted">Possible until {until}</span>
      <Modal
        open={open}
        kicker="Undo an import"
        title={`Undo import #${runNumber}?`}
        tone="bad"
        confirmLabel="Undo the import"
        pending={pending}
        error={error}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          if (!reason.trim()) {
            setError("Say why. The reason is kept in the audit log.");
            return;
          }
          setError(null);
          start(async () => {
            try {
              const res = await undoAction(runId, reason);
              if (!res.ok) {
                setError(res.error);
                return;
              }
              setOpen(false);
              toast?.show(res.message ?? "Undone.", "ok");
              router.refresh();
            } catch (err) {
              console.error("[import run] undo failed:", err);
              setError("Could not undo the import — the server did not respond. Nothing was changed; try again.");
            }
          });
        }}
      >
        <p>Rows it added are removed. Rows it changed are put back from the audit log&apos;s before-values; a value someone changed since the import is left as it is.</p>
        <label htmlFor="undo-reason" className="crm-label mt-3">
          Reason (kept in the audit log)
        </label>
        <textarea id="undo-reason" className="crm-input min-h-[70px]" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </>
  );
}

export function CancelButton({ runId }: { runId: string }) {
  const { error, pending, run } = useRun();
  return (
    <>
      <button type="button" className={buttonClass("ghost", "sm")} disabled={pending} onClick={() => run(() => cancelImportAction(runId), "Could not cancel the import")}>
        Cancel this import
      </button>
      <ErrorLine error={error} />
    </>
  );
}
