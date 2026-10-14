"use client";

import { useId, type CSSProperties, type Ref } from "react";

import { buttonClass } from "@/components/ui";
import { SPOTLIGHT_TEXT as T } from "@/lib/spotlight/copy";
import type { Phase } from "@/lib/spotlight/machine";
import type { TourStep } from "@/lib/spotlight/types";

export type SpotlightCardProps = {
  step: Pick<TourStep, "title" | "body">;
  /** 0-based. */
  index: number;
  total: number;
  phase: Phase;
  /** What to say when the step's target is not on the screen (the step's own words, or the generic ones). */
  missingNote: string;
  sheet: boolean;
  /** With `sheet`: the sheet is at the top of the screen (the lit element is in the bottom bar). */
  sheetTop?: boolean;
  onNext: () => void;
  onBack: () => void;
  /** Skip tour, the X and the plain Close button: one action, never asks "are you sure". */
  onSkip: () => void;
  onFinish: () => void;
  onRetry: () => void;
  cardRef?: Ref<HTMLDivElement>;
  style?: CSSProperties;
};

const SIZE = "min-h-[44px] min-w-[44px]";

/**
 * The small card beside the lit element (a bottom sheet on a narrow screen): the step count, a title, one or two plain sentences, and
 * Skip tour / Back / Next in the same place on every step. A dialog that is not modal: the page behind stays reachable by keyboard,
 * and focus moves here when a step opens. The polite live region that announces each step is the provider's, so it outlives the card.
 */
export function SpotlightCard({ step, index, total, phase, missingNote, sheet, sheetTop = false, onNext, onBack, onSkip, onFinish, onRetry, cardRef, style }: SpotlightCardProps) {
  const titleId = useId();
  const bodyId = useId();
  const last = index >= total - 1;
  const missing = phase === "missing";
  const waiting = phase === "waiting";
  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      aria-busy={waiting || undefined}
      tabIndex={-1}
      data-testid="spotlight-card"
      data-sheet={sheet ? "true" : undefined}
      style={style}
      className={`sp-card ${sheet ? (sheetTop ? "sp-card-sheet sp-card-sheet-top" : "sp-card-sheet") : ""}`.trim()}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="m-0 text-[12px] font-bold uppercase tracking-[0.04em] text-muted" data-testid="spotlight-count">
          {T.stepOf(index + 1, total)}
        </p>
        <button
          type="button"
          onClick={onSkip}
          aria-label={T.closeTour}
          title={T.closeTour}
          className={`${SIZE} -mr-2 -mt-2 inline-flex items-center justify-center rounded-full text-[22px] leading-none text-muted hover:bg-canvas`}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <h2 id={titleId} className="m-0 mt-0.5 font-display text-[20px] font-semibold leading-snug text-navy">
        {step.title}
      </h2>
      <p id={bodyId} className="m-0 mt-1.5 text-[14.5px] leading-relaxed text-ink-2">
        {step.body}
      </p>
      {missing ? (
        <p role="note" data-testid="spotlight-missing" className="m-0 mt-3 rounded-[10px] bg-saffron-50 px-3 py-2 text-[13.5px] leading-snug text-brown-900">
          {missingNote}
        </p>
      ) : null}
      {waiting ? (
        <p data-testid="spotlight-waiting" className="m-0 mt-3 text-[13px] text-muted">
          {T.waiting}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onSkip} data-testid="spotlight-skip" className={`${buttonClass("plain")} ${SIZE} mr-auto text-[14px] font-bold underline underline-offset-2`}>
          {T.skip}
        </button>
        {index > 0 ? (
          <button type="button" onClick={onBack} data-testid="spotlight-back" className={`${buttonClass("ghost")} ${SIZE}`}>
            {T.back}
          </button>
        ) : null}
        {missing ? (
          <button type="button" onClick={onRetry} data-testid="spotlight-retry" className={`${buttonClass("ghost")} ${SIZE}`}>
            {T.tryAgain}
          </button>
        ) : null}
        {last ? (
          <>
            <button type="button" onClick={onSkip} data-testid="spotlight-close" className={`${buttonClass("ghost")} ${SIZE}`}>
              {T.close}
            </button>
            <button type="button" onClick={onFinish} data-testid="spotlight-finish" className={`${buttonClass("primary")} ${SIZE}`}>
              {T.finish}
            </button>
          </>
        ) : (
          <button type="button" onClick={onNext} data-testid="spotlight-next" className={`${buttonClass("primary")} ${SIZE}`}>
            {T.next}
          </button>
        )}
      </div>
    </div>
  );
}
