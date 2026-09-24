"use client";

import { useId, useState, type ReactNode } from "react";

export type ChipOption = { value: string; label: ReactNode };

/**
 * Enum input as a row of chips (the prototype's form chips): navy outline
 * pills, the selected one filled. Submits `name=value` like a radio group.
 * Controlled (value + onChange) or uncontrolled (defaultValue).
 */
export function ChipGroup({
  name,
  options,
  value,
  defaultValue,
  onChange,
  label,
  disabled = false,
}: {
  name?: string;
  options: ChipOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Accessible name of the group (use when there is no visible <label>). */
  label?: string;
  disabled?: boolean;
}) {
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = value ?? inner;
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = o.value === current;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => {
              if (value === undefined) setInner(o.value);
              onChange?.(o.value);
            }}
            className="cc-chip min-h-[34px]"
          >
            {o.label}
          </button>
        );
      })}
      {name ? <input type="hidden" name={name} value={current} /> : null}
    </div>
  );
}

/**
 * On/off switch (44×26, green when on) with a state note beside it, as in the
 * prototype ("Ask at checkout" / "Do not ask"). With `name`, it submits like a
 * checkbox: `name=on` when on, nothing when off.
 */
export function Toggle({
  name,
  checked,
  defaultChecked = false,
  onChange,
  label,
  onNote,
  offNote,
  disabled = false,
  submitValue = "on",
}: {
  name?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  /** Accessible name, e.g. "Directory listing". */
  label: string;
  onNote?: ReactNode;
  offNote?: ReactNode;
  disabled?: boolean;
  submitValue?: string;
}) {
  const [inner, setInner] = useState(defaultChecked);
  const on = checked ?? inner;
  const noteId = useId();
  const note = on ? onNote : offNote;
  return (
    <span className="inline-flex min-h-[34px] items-center gap-2.5">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        aria-describedby={note ? noteId : undefined}
        disabled={disabled}
        onClick={() => {
          if (checked === undefined) setInner(!on);
          onChange?.(!on);
        }}
        className="cc-toggle disabled:cursor-not-allowed disabled:opacity-60"
        data-on={on}
      >
        <span />
      </button>
      {note ? (
        <span id={noteId} className="text-[13px] text-ink-2">
          {note}
        </span>
      ) : null}
      {name && on ? <input type="hidden" name={name} value={submitValue} /> : null}
    </span>
  );
}
