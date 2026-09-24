"use client";

import { useState } from "react";

import { useStepUp } from "@/components/step-up";
import { useToast } from "@/components/toast";
import { buttonClass, type ButtonSize, type ButtonVariant } from "@/components/ui";

/** Response header an export route sets when the database asked for a fresh 2FA check (app.record_export). */
export const STEP_UP_HEADER = "x-step-up";

function fileName(res: Response, fallback: string): string {
  const cd = res.headers.get("content-disposition") ?? "";
  const m = /filename="?([^";]+)"?/i.exec(cd);
  return m?.[1] ?? fallback;
}

/**
 * A download button for an export route. Exports need a fresh 2FA check: when
 * the route answers 403 with `x-step-up: required`, the step-up modal opens
 * and the download is tried once more. Errors are shown, never swallowed.
 */
export function StepUpDownload({
  href,
  label,
  fallbackName = "export.csv",
  variant = "ghost",
  size = "sm",
}: {
  href: string;
  label: string;
  fallbackName?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const stepUp = useStepUp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchOnce(): Promise<{ ok: boolean; error?: string; stepUp?: boolean; blob?: Blob; name?: string }> {
    const res = await fetch(href, { credentials: "same-origin" });
    if (res.ok) return { ok: true, blob: await res.blob(), name: fileName(res, fallbackName) };
    const text = (await res.text()).trim();
    return { ok: false, error: text || `The export failed (HTTP ${res.status}).`, stepUp: res.headers.get(STEP_UP_HEADER) === "required" };
  }

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const res = stepUp ? await stepUp.run(fetchOnce, label) : await fetchOnce();
      if (!res.ok || !res.blob) {
        setError(res.error ?? "The export failed.");
        toast?.show(res.error ?? "The export failed.", "bad");
        return;
      }
      const url = URL.createObjectURL(res.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.name ?? fallbackName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast?.show("Export downloaded · recorded in the audit log", "ok");
    } catch (err) {
      console.error("[export] download failed:", err);
      setError("Could not export — the server did not respond. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col">
      <button type="button" disabled={busy} onClick={go} className={buttonClass(variant, size)}>
        {busy ? "Preparing…" : label}
      </button>
      {error ? (
        <span role="alert" className="mt-1 max-w-xs text-[12px] text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
