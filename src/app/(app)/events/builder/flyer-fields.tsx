"use client";

// Small form pieces the flyer maker's panels share.

import { useId, type ReactNode } from "react";

import { buttonClass } from "@/components/ui";
import { flyerTextLength } from "@/lib/events/flyer";

/** A plain-English problem next to what the organizer did, with a Try again when there is one. */
export function InlineError({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
      <span className="min-w-0 flex-1">{children}</span>
      {onRetry ? (
        <button type="button" className={buttonClass("ghost", "xs")} onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

/**
 * A text field with its character counter. The counter is read with the field
 * (aria-describedby), not after every keystroke; going over the limit is
 * announced once.
 */
export function TextField({
  id,
  label,
  value,
  max,
  onChange,
  multiline = false,
  rows = 2,
  disabled,
  hint,
  placeholder,
  required = false,
  compact = false,
}: {
  id: string;
  label: string;
  value: string;
  max: number;
  onChange: (v: string) => void;
  multiline?: boolean;
  rows?: number;
  disabled: boolean;
  hint?: ReactNode;
  placeholder?: string;
  required?: boolean;
  /** Show the counter only when the text is near its limit (rows of a list). */
  compact?: boolean;
}) {
  const used = flyerTextLength(value);
  const over = used > max;
  const showCounter = !compact || used >= max * 0.8;
  const counterId = `${id}-count`;
  const describedBy = hint ? `${counterId} ${id}-hint` : counterId;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="crm-label">
          {label}
        </label>
        <span id={counterId} className={`text-[11px] font-bold ${over ? "text-danger" : "text-muted"}`}>
          <span className="sr-only">{`${used} of ${max} characters used`}</span>
          {showCounter ? (
            <span aria-hidden="true">
              {used}/{max}
            </span>
          ) : null}
        </span>
      </div>
      {multiline ? (
        <textarea
          id={id}
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="crm-input"
          disabled={disabled}
          aria-invalid={over}
          aria-describedby={describedBy}
          placeholder={placeholder}
          required={required}
        />
      ) : (
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="crm-input"
          disabled={disabled}
          aria-invalid={over}
          aria-describedby={describedBy}
          placeholder={placeholder}
          required={required}
        />
      )}
      {hint ? (
        <p id={`${id}-hint`} className="crm-hint">
          {hint}
        </p>
      ) : null}
      <span role="status" className="sr-only">
        {over ? `The ${label.toLowerCase()} is longer than ${max} characters.` : ""}
      </span>
    </div>
  );
}

/**
 * A group of related fields (one poster section) with a heading, an optional
 * on/off switch beside it, and the fields below only while it is on.
 */
export function SectionBox({ title, note, control, children }: { title: string; note?: ReactNode; control?: ReactNode; children?: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="rounded-[12px] border border-line-soft bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={id} className="text-[13px] font-bold">
          {title}
        </h4>
        {control}
      </div>
      {note ? <p className="crm-hint">{note}</p> : null}
      {children ? <div className="mt-2 flex flex-col gap-3">{children}</div> : null}
    </section>
  );
}
