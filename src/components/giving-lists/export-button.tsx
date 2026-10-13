"use client";

// Export on Giving's Pledges and Payments lists (docs/GIVING_REDESIGN.md slice 9): Export → a sheet that says what the file holds
// and that the export is recorded → a new code from the authenticator app → the file. Every export asks for its own code (owner
// decision 2026-10-13); the database refuses a code an earlier export used, so the route answers 403 with x-step-up if one is
// reused. Errors are said next to the button, in plain words, with the button still there to try again.

import { useState, useSyncExternalStore } from "react";

import { GivingSheet } from "@/components/giving-actions/sheet";
import type { CardLabels } from "@/components/household-card";
import { STEP_UP_HEADER } from "@/components/step-up-download";
import { useStepUp } from "@/components/step-up";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import { rowsWord } from "@/lib/giving-export/csv";
import type { ExportOffer } from "@/lib/giving-lists/model";

const noSubscribe = () => () => {};

function fileName(res: Response, fallback: string): string {
  const m = /filename="?([^";]+)"?/i.exec(res.headers.get("content-disposition") ?? "");
  return m?.[1] ?? fallback;
}

export function ExportButton({ offer, labels }: { offer: ExportOffer; labels: CardLabels }) {
  const stepUp = useStepUp();
  const toast = useToast();
  // ?export=1 (the box's "export payments 2026") opens the sheet once the page is drawn; the sheet itself is only drawn on the client.
  const [open, setOpen] = useState(offer.state === "ready" && offer.open === true);
  const onClient = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (offer.state === "no_permission") {
    return <p className="m-0 max-w-[260px] text-[13px] leading-[1.4] text-muted">Exporting needs the data-export permission. Ask your administrator.</p>;
  }
  const what = rowsWord(offer.list, offer.count);
  const label = `Export ${what}`;

  async function go() {
    if (offer.state !== "ready") return;
    setPending(true);
    setError(null);
    try {
      // A new code for every file: ask first (outside the portal shell, as in the dev preview, there is no step-up box).
      if (stepUp && !(await stepUp.request(label))) return;
      const res = await fetch(offer.href, { credentials: "same-origin" });
      if (!res.ok) {
        const text = (await res.text()).trim();
        setError(
          res.headers.get(STEP_UP_HEADER) === "required"
            ? "Could not export the list — the code was not accepted for this file. Each export needs a new code; try again."
            : text || `Could not export the list — the server answered ${res.status}. Nothing was exported; try again.`,
        );
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName(res, `${offer.list}.csv`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setOpen(false);
      toast?.show(`Exported ${what} · recorded in the audit log`, "ok");
    } catch (err) {
      console.error("[giving export] the download failed:", err);
      setError("Could not export the list — the server did not respond. Nothing was exported; try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => (setError(null), setOpen(true))} className={`${buttonClass("ghost", "sm")} min-h-[44px]`}>
        Export
      </button>
      {onClient && open ? (
        <GivingSheet
          title={label}
          labels={labels}
          what={
            <>
              The file lists them exactly as this list shows them: <strong>{offer.filterText}</strong>.
            </>
          }
          error={error}
          confirmLabel={label}
          pendingLabel="Preparing the file…"
          pending={pending}
          confirmDisabled={offer.count === 0}
          onConfirm={() => void go()}
          onClose={() => setOpen(false)}
        >
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[14px] leading-[1.45] text-ink-2">
            <li>Your name, the time and this filter are printed at the top of the file.</li>
            <li>The audit log records the export: how many rows and which filter, never what is in the file.</li>
            <li>Each export needs a new code from your authenticator app.</li>
            <li>Families are named by their number and household name. Amounts are plain numbers, with the currency in a column of its own.</li>
          </ul>
          {offer.count === 0 ? <p className="m-0 text-[13px] text-muted">This list is empty, so there is nothing to export.</p> : null}
        </GivingSheet>
      ) : null}
    </>
  );
}
