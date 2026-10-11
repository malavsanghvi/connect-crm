"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, buttonClass } from "@/components/ui";

import { findMatchesAction, type FindMatchesData } from "./actions";

/**
 * Starts the check of one import: Weaver reads its rows, decides what it can, and keeps the rest as questions. Takes a while for
 * a large file, so it says so while it works; a failure is shown next to the button with a way to try again.
 */
export function FindMatchesButton({ runId, label = "Look for matches", variant = "primary", openAfter = true }: { runId: string; label?: string; variant?: "primary" | "ghost"; openAfter?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<FindMatchesData | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    const res = await findMatchesAction(runId);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDone(res.data);
    if (openAfter) router.push(`/setup/onboarding/questions?run=${runId}`);
    router.refresh();
  };

  return (
    <div className="space-y-2">
      <button type="button" className={buttonClass(busy ? "off" : variant)} disabled={busy} aria-busy={busy} onClick={() => void start()}>
        {busy ? "Looking for matches…" : label}
      </button>
      {busy ? (
        <p className="text-[13px] text-muted" role="status" aria-live="polite">
          Reading the rows and comparing them. This can take a minute for a large file; please keep this page open.
        </p>
      ) : null}
      {error ? (
        <Alert
          tone="danger"
          action={
            <button type="button" className={buttonClass("bad", "xs")} onClick={() => void start()}>
              Try again
            </button>
          }
        >
          {error}
        </Alert>
      ) : null}
      {done && !openAfter ? (
        <Alert tone="success">
          {done.summary.summary} {done.note ? done.note : ""}
        </Alert>
      ) : null}
    </div>
  );
}
