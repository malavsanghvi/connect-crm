"use client";

// Print a pledge (⋯ › Print…, and the Print button on a family's Pledges tab): the server draws the pledge as an invoice-style PDF with
// the community's branding, the browser's print dialog opens on it. While it is made a short note says so; when it cannot be made (no
// access, the server did not answer, the browser blocked the window) a dialog says why in plain English next to the pledge, with a
// Try again button. The permission is giving.view or giving.manage and the server checks it again.

import { useCallback, useRef, useState, type ReactNode } from "react";

import type { CardLabels } from "@/components/household-card";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import type { Family } from "@/lib/giving-today/queue";
import { browserPrintEnv, fetchPledgePdf, printPledgePdf, type PrintEnv } from "@/lib/pledge-pdf/print";

import { GivingSheet } from "./sheet";

const NO_LABELS: CardLabels = { orgMemberLabel: "", orgHouseholdLabel: "" };

type Attempt = { pledgeId: string; reference: string; family: Family | null };

/** Runs Print for one pledge at a time; `dialog` is the failure dialog (draw it where the button is). */
export function usePrintPledge(labels: CardLabels = NO_LABELS, env: () => PrintEnv = browserPrintEnv) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{ attempt: Attempt; error: string } | null>(null);
  const running = useRef(false);

  const run = useCallback(
    async (attempt: Attempt) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      setFailed(null);
      toast?.show(`Getting ${attempt.reference} ready to print…`);
      try {
        const pdf = await fetchPledgePdf(attempt.pledgeId);
        if (!pdf.ok) {
          setFailed({ attempt, error: pdf.error });
          return;
        }
        const printed = await printPledgePdf(pdf.blob, env());
        if (!printed.ok) setFailed({ attempt, error: printed.error });
      } catch (err) {
        console.error("[pledge print] failed:", err);
        setFailed({ attempt, error: "Could not print the pledge — something went wrong in the browser. Try again." });
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [toast, env],
  );

  const dialog: ReactNode = failed ? (
    <GivingSheet
      title="Could not print the pledge"
      family={failed.attempt.family}
      labels={labels}
      what={<p className="m-0 font-bold text-ink">{failed.attempt.reference}</p>}
      error={failed.error}
      confirmLabel="Try again"
      pending={busy}
      pendingLabel="Getting it ready…"
      cancelLabel="Close"
      onConfirm={() => void run(failed.attempt)}
      onClose={() => setFailed(null)}
    />
  ) : null;

  return { print: (attempt: Attempt) => void run(attempt), busy, dialog };
}

const MENU_ITEM = "flex min-h-[44px] w-full items-center rounded-[10px] px-3 py-2 text-left text-[14px] font-semibold text-ink hover:bg-canvas";

/** The Print… item of a pledge's row menu, or a small button where a row has no menu (a family's Pledges tab). */
export function PrintPledgeButton({
  pledgeId,
  reference,
  family = null,
  labels = NO_LABELS,
  label = "Print…",
  variant = "menu",
  className,
}: {
  pledgeId: string;
  reference: string;
  family?: Family | null;
  labels?: CardLabels;
  label?: string;
  variant?: "menu" | "button";
  className?: string;
}) {
  const { print, busy, dialog } = usePrintPledge(labels);
  return (
    <>
      <button
        type="button"
        disabled={busy}
        aria-label={`Print pledge ${reference}`}
        className={className ?? (variant === "menu" ? MENU_ITEM : `${buttonClass("ghost", "xs")} min-h-[36px]`)}
        onClick={() => print({ pledgeId, reference, family })}
      >
        {busy ? "Preparing…" : label}
      </button>
      {dialog}
    </>
  );
}
