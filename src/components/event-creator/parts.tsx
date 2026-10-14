"use client";

// Small shared parts of the guided event creator's cards: a suggestion with its reason, a labelled field, a switch row, a
// lesson from last time, a plain-English error with Try again, and the honest "Coming next" pill.

import { useId, type ReactNode } from "react";

import { Toggle } from "@/components/controls";
import { Pill } from "@/components/onboarding-front/parts";
import type { SuggestionSource } from "@/lib/event-creator/types";

import type { CreatorApi } from "./api";

export { ComingNext, Pill } from "@/components/onboarding-front/parts";

export const SOURCE_LABEL: Record<SuggestionSource, string> = {
  history: "From your history",
  calendar: "From your calendar",
  rule: "From your settings",
};

export const sectionLabel = "m-0 text-[12px] font-bold uppercase tracking-[0.06em] text-muted";
export const linkClass = "font-semibold text-navy underline underline-offset-2 hover:text-navy-hover";
export const softButton =
  "inline-flex min-h-[40px] items-center justify-center rounded-[20px] border border-line-input bg-white px-4 text-[14px] font-semibold text-navy hover:bg-navy-50 disabled:cursor-not-allowed disabled:opacity-60";
export const primaryButton =
  "inline-flex min-h-[44px] items-center justify-center rounded-[22px] border border-navy bg-navy px-5 text-[15px] font-semibold text-white hover:border-navy-hover hover:bg-navy-hover disabled:cursor-not-allowed disabled:opacity-60";

/** A suggestion the person can pick: what it is, why it is offered, where it came from. */
export function SuggestionButton({
  label,
  why,
  source,
  best,
  meta,
  pressed,
  onPick,
}: {
  label: string;
  why: string;
  source: SuggestionSource;
  best?: boolean;
  meta?: string;
  pressed: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onPick}
      className={`flex w-full items-start gap-3 rounded-[12px] border px-3.5 py-2.5 text-left ${pressed ? "border-navy bg-navy-50" : "border-line bg-white hover:border-navy-300"}`}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-1.5 text-[15px] font-semibold text-ink">
          {label}
          {best ? <Pill tone="sun">Best fit</Pill> : null}
        </span>
        <span className="text-[13px] leading-snug text-ink-2">{why}</span>
        <span className="text-[12px] font-semibold text-muted">{SOURCE_LABEL[source]}</span>
      </span>
      {meta ? <span className="whitespace-nowrap text-[12px] font-semibold text-muted">{meta}</span> : null}
    </button>
  );
}

/** A suggested value with its reason and a button to use it (prices, capacity, the reminder): never applied on its own. */
export function UseSuggestion({ why, source, action, onUse, used }: { why: string; source: SuggestionSource; action: string; onUse: () => void; used: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[10px] bg-saffron-50 px-3 py-2 text-[13px] text-ink">
      <span className="min-w-0 flex-1">
        <span className="font-bold text-brown">{SOURCE_LABEL[source]}:</span> {why}
      </span>
      {used ? (
        <span className="text-[13px] font-semibold text-success-900">Used</span>
      ) : (
        <button type="button" onClick={onUse} className="min-h-[36px] rounded-[18px] border border-saffron bg-white px-3 text-[13px] font-semibold text-brown hover:bg-saffron-50">
          {action}
        </button>
      )}
    </div>
  );
}

export function Field({ label, hint, children, id }: { label: string; hint?: ReactNode; children: (id: string) => ReactNode; id?: string }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={fid} className="crm-label">
        {label}
      </label>
      {children(fid)}
      {hint ? <p className="crm-hint m-0">{hint}</p> : null}
    </div>
  );
}

export function SwitchRow({ label, sub, checked, onChange, onNote, offNote }: { label: string; sub?: ReactNode; checked: boolean; onChange: (v: boolean) => void; onNote?: ReactNode; offNote?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[15px] font-semibold text-ink">{label}</p>
        {sub ? <p className="m-0 text-[13px] text-muted">{sub}</p> : null}
      </div>
      <Toggle label={label} checked={checked} onChange={onChange} onNote={onNote} offNote={offNote} />
    </div>
  );
}

export function LessonNotes({ lessons }: { lessons: { text: string; from: string }[] }) {
  if (!lessons.length) return null;
  return (
    <div className="rounded-[10px] bg-saffron-50 px-3 py-2 text-[13px] leading-snug text-brown-900">
      <p className="m-0 font-bold">Lessons from last time</p>
      <ul className="m-0 mt-1 list-disc pl-5">
        {lessons.map((l) => (
          <li key={`${l.from}-${l.text}`}>
            {l.text} <span className="text-[12px]">({l.from})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ErrorNote({ children, onRetry, retryLabel = "Try again" }: { children: ReactNode; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[10px] border border-danger bg-danger-50 px-3 py-2 text-[14px] text-danger">
      <span className="min-w-0 flex-1">{children}</span>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="min-h-[36px] rounded-[18px] border border-danger bg-white px-3 text-[13px] font-semibold text-danger">
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

export function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "ok" | "warn" }) {
  const cls = tone === "ok" ? "bg-success-50 text-success-900" : tone === "warn" ? "bg-saffron-50 text-brown-900" : "bg-navy-50 text-ink-2";
  return <div className={`rounded-[10px] px-3 py-2 text-[13px] leading-snug ${cls}`}>{children}</div>;
}

/** What every card is given. */
export type CardProps = {
  draft: import("@/lib/event-creator/types").EventDraft;
  set: (patch: Partial<import("@/lib/event-creator/types").EventDraft>) => void;
  ctx: import("@/lib/event-creator/types").CreatorCtx;
  existing: import("@/lib/event-creator/types").CreatorExisting;
  api: CreatorApi;
  /** Save the draft now (the card needs it saved before an action, e.g. meal slots). Resolves to false when it failed. */
  saveNow: () => Promise<boolean>;
  /** Read the shifts, checklist and slots again after an action. */
  refresh: () => void;
  demo: boolean;
  goTo: (card: import("@/lib/event-creator/types").CardId) => void;
};
