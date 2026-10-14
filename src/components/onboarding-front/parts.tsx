// Small shared parts of the front door (board 1 of docs/handoff/prototypes/onboarding-data/Main.dc.html): Niva's row,
// the person's bubble, pills and the board's round buttons. The colors are the theme's tokens, which the page container
// points at the logo palette (data-v2-tokens, src/app/globals.css), so they match the board in either shell.

import type { ReactNode } from "react";

import { Sparkle } from "@/components/niva/sparkle";

/** The board's pill buttons: 44px tall, fully rounded. */
export const btn = {
  primary:
    "inline-flex min-h-[44px] items-center justify-center rounded-[22px] text-center border border-navy bg-navy px-5 text-[15px] font-semibold text-white no-underline hover:bg-navy-hover hover:border-navy-hover",
  outline:
    "inline-flex min-h-[44px] items-center justify-center rounded-[22px] text-center border border-navy bg-white px-[18px] text-[14px] font-semibold text-navy no-underline hover:bg-navy-50",
  outlineLarge:
    "inline-flex min-h-[44px] items-center justify-center rounded-[22px] text-center border border-navy bg-white px-5 text-[15px] font-semibold text-navy no-underline hover:bg-navy-50",
  /** Not built yet: readable (6:1 on its ground), plainly not pressable. */
  off: "inline-flex min-h-[44px] cursor-not-allowed items-center justify-center rounded-[22px] text-center border border-line-input bg-ground px-[18px] text-[14px] font-semibold text-muted",
  offLarge:
    "inline-flex min-h-[44px] cursor-not-allowed items-center justify-center rounded-[22px] text-center border border-line-input bg-ground px-5 text-[15px] font-semibold text-muted",
} as const;

export const card = "rounded-[16px] border border-line bg-white p-5";

/** The board's headings in sections: Fraunces 600. */
export const h2 = "m-0 font-display text-[20px] font-semibold leading-[1.25] text-ink";

/** Niva's mark: the sun gradient (kept for Niva alone) with the sparkle. */
export function NivaMark() {
  return (
    <span
      aria-hidden="true"
      className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full text-ink"
      style={{ background: "var(--v2-sun)" }}
    >
      <Sparkle className="h-[18px] w-[18px]" />
    </span>
  );
}

/** One of Niva's turns: the mark, then what Niva says and whatever goes with it. */
export function NivaRow({ says, children }: { says: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <NivaMark />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <NivaBubble>{says}</NivaBubble>
        {children}
      </div>
    </div>
  );
}

export function NivaBubble({ children, live = false }: { children: ReactNode; live?: boolean }) {
  return (
    <div
      role={live ? "status" : undefined}
      className="max-w-[760px] rounded-[4px_18px_18px_18px] border border-line bg-white px-[18px] py-[14px] text-[15px] leading-[1.6] text-ink"
    >
      <span className="sr-only">Niva: </span>
      {children}
    </div>
  );
}

/** What the person says (right-aligned, blue). */
export function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-[520px] self-end rounded-[18px_18px_4px_18px] bg-navy px-4 py-3 text-[15px] leading-[1.5] text-white">
      <span className="sr-only">You: </span>
      {children}
    </div>
  );
}

const TONE = {
  blue: "bg-navy-50 text-navy-hover",
  green: "bg-success-50 text-success-900",
  sun: "bg-saffron-50 text-saffron",
  grey: "bg-[#eaf0f7] text-ink-2",
  danger: "bg-danger-50 text-danger",
} as const;

export type PillTone = keyof typeof TONE;

export function Pill({ tone = "grey", children }: { tone?: PillTone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-[12px] px-[10px] py-[2px] text-[12px] font-bold ${TONE[tone]}`}>{children}</span>;
}

/** The honest label on everything that is shown but not built yet. */
export function ComingNext() {
  return <Pill tone="grey">Coming next</Pill>;
}
