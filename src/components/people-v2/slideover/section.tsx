"use client";

import { useId, useState, type ReactNode } from "react";

import { NO_ACCESS_TEXT, type DetailLine, type Part } from "@/lib/people-v2/slideover";

// The slide-over's parts: a section you can open and close, the read-only rows, and the one sentence a section says when this role may
// not read it or when it could not be read (never an empty table). Sections keep their content in the page while closed, so a
// half-typed edit survives closing and opening a section.

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function Section({
  id,
  title,
  open: initial,
  aside,
  children,
}: {
  /** The section's key: "profile", "ids" … (also the test id). */
  id: string;
  title: string;
  open: boolean;
  /** Something small beside the title (a count, a link). */
  aside?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initial);
  const uid = useId();
  const panel = `${uid}-panel`;
  return (
    <section data-section={id} aria-label={title} className="border-b border-line last:border-b-0">
      <div className="flex items-center gap-2">
        <h3 className="m-0 min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panel}
            onClick={() => setOpen((v) => !v)}
            className="flex min-h-12 w-full items-center justify-between gap-2 rounded-lg py-3 text-left text-[16px] font-bold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--v2-blue)]"
          >
            <span>{title}</span>
            <Chevron open={open} />
          </button>
        </h3>
        {aside}
      </div>
      <div id={panel} hidden={!open} className="pb-4">
        {children}
      </div>
    </section>
  );
}

const ROW = "grid grid-cols-[6.75rem_minmax(0,1fr)] items-start gap-x-3 py-1.5 sm:grid-cols-[7.5rem_minmax(0,1fr)]";

export function ComingNext() {
  return (
    <span className="mr-1.5 inline-flex min-h-6 shrink-0 items-center whitespace-nowrap rounded-full bg-[var(--v2-sun-tint)] px-2.5 text-[11px] font-extrabold tracking-[0.02em] text-[var(--v2-sun-ink)]">
      Coming next
    </span>
  );
}

/** Read-only rows: a label and what it says. A refusal or a failed read is said in the row, in words. */
export function Lines({ lines }: { lines: readonly DetailLine[] }) {
  return (
    <dl className="m-0">
      {lines.map((l) => (
        <div key={l.label} className={ROW}>
          <dt className="pt-0.5 text-[13px] text-muted">{l.label}</dt>
          <dd dir="auto" className={`m-0 min-w-0 break-words text-[14.5px] ${l.tone === "bad" ? "font-semibold text-danger" : l.tone === "muted" ? "text-muted" : "text-ink"}`}>
            {l.tone === "ok" ? (
              <span className="inline-flex min-h-6 items-center rounded-full bg-[var(--v2-green-tint)] px-2.5 text-[12.5px] font-bold text-[var(--v2-green-ink)]">{l.value}</span>
            ) : (
              <>
                {l.soon ? <ComingNext /> : null}
                {l.value}
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The one sentence for a section this role may not read, or that could not be read (with how to try again). */
export function PartNote({ part, what }: { part: Exclude<Part<unknown>, { state: "ok" }>; what: string }) {
  if (part.state === "no-access") return <p className="m-0 py-1 text-[14px] text-muted">{NO_ACCESS_TEXT}</p>;
  return (
    <p role="alert" className="m-0 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
      {part.message || `Could not load ${what}.`} Reload the page to try again.
    </p>
  );
}

export function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </svg>
  );
}
