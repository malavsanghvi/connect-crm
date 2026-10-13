"use client";

// The Giving sheet (docs/GIVING_REDESIGN.md section 4, "In place"): centred on a computer, a bottom sheet on a phone. Every sheet
// has the same anatomy: the household card at the top, what will happen, the fields, an error next to the button, Cancel and a
// button that names the amount and the family. There is no <form>: Enter inside a sheet never submits (section 5.1). Esc and
// Cancel close it, focus stays inside while it is open and goes back to the button that opened it.

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { CardLabels } from "@/components/household-card";
import { buttonClass } from "@/components/ui";
import { familyLine, type Family } from "@/lib/giving-today/queue";

export function FamilyCard({ family, labels, children }: { family: Family; labels: CardLabels; children?: ReactNode }) {
  return (
    <div className="rounded-[14px] border border-line bg-white px-3.5 py-2.5">
      <p className="m-0 text-[15px] font-bold text-ink">{family.name}</p>
      <p className="m-0 text-[13px] leading-[1.4] text-muted">{familyLine(family, labels)}</p>
      {children}
    </div>
  );
}

export const NO_UNDO = "This cannot be undone here. A mistake is fixed with a refund that a second person approves.";

export function GivingSheet({
  title,
  family,
  labels,
  what,
  children,
  error,
  confirmLabel,
  pendingLabel = "Saving…",
  pending,
  confirmDisabled = false,
  tone = "primary",
  onConfirm,
  onClose,
}: {
  title: string;
  family?: Family | null;
  labels: CardLabels;
  /** What happens, said before the click. */
  what?: ReactNode;
  children?: ReactNode;
  error?: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  pending: boolean;
  confirmDisabled?: boolean;
  tone?: "primary" | "danger";
  onConfirm: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    const first = panel.current?.querySelector<HTMLElement>("textarea, input, select, button[data-confirm]");
    const t = window.setTimeout(() => (first ?? panel.current)?.focus(), 0);
    return () => {
      window.clearTimeout(t);
      const back = opener.current;
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && !pending) {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), textarea, input, select")];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // Drawn on the document body, so it sits above the top bar and the phone bars whatever the page's own layers are.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(18,32,58,0.45)] sm:items-center sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && !pending && onClose()}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid="giving-sheet"
        className="flex max-h-[94vh] w-full flex-col gap-3 overflow-y-auto rounded-t-[22px] bg-white px-5 pb-5 pt-5 shadow-[0_24px_60px_rgba(18,32,58,0.28)] sm:max-w-[540px] sm:rounded-[22px] sm:px-6"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="m-0 font-display text-[22px] font-semibold leading-tight text-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Close"
            title="Close"
            className="-mr-2 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[22px] leading-none text-muted hover:bg-canvas"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        {family ? <FamilyCard family={family} labels={labels} /> : null}
        {what ? <div className="m-0 rounded-[12px] bg-ground px-3 py-2 text-[14px] leading-[1.5] text-ink-2">{what}</div> : null}
        {children}
        {error ? (
          <p role="alert" className="m-0 rounded-[12px] border border-[#f0b9b4] bg-danger-50 px-3 py-2 text-[13px] leading-[1.45] text-[#7a1a14]">
            {error}
          </p>
        ) : null}
        <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={pending} className={`${buttonClass("ghost")} min-h-[44px] whitespace-normal py-2 text-center`}>
            Cancel
          </button>
          <button
            type="button"
            data-confirm
            onClick={onConfirm}
            disabled={pending || confirmDisabled}
            className={`${buttonClass(tone === "danger" ? "bad-solid" : "primary")} min-h-[44px] whitespace-normal py-2 text-center`}
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
