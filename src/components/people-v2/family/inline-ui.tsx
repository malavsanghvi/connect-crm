"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

import { Icon } from "@/components/brand/icons";
import { REASON_CHIPS, checkDraft, conflictLine, displayValue, type CheckContext, type EditUnit, type Values } from "@/lib/people-v2/inline-edit";

import type { InlineEdit } from "./use-inline-edit";

// The parts every click-to-edit thing is drawn from: the value you click, the input, the sentence under it for a mistake, the
// failed-save line with its retry, the conflict panel, the reason chips, and the Done / Cancel pair for a phone. Nothing here
// decides anything: the rules are in src/lib/people-v2/inline-edit.ts and the state in use-inline-edit.ts.

export const INPUT =
  "min-h-11 w-full rounded-field border border-[var(--v2-line-input)] bg-white px-3 text-[14.5px] text-ink placeholder:text-faint focus:border-[var(--v2-blue)] focus:outline-none focus:ring-2 focus:ring-[var(--v2-blue-border)] md:min-h-10";

const BTN_SMALL =
  "inline-flex min-h-10 items-center justify-center rounded-full border px-4 text-[13.5px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--v2-blue)]";

export function Pencil({ className = "" }: { className?: string }) {
  return (
    <Icon name="pencil" size={14} className={className} />
  );
}

/** The value as plain text (or the button that edits it). An empty value invites adding one. Without permission it is only text. */
export function ValueButton({
  text,
  placeholder,
  editable,
  label,
  onStart,
  busy = false,
  buttonRef,
  className = "",
}: {
  text: string;
  placeholder: string;
  editable: boolean;
  /** What is being edited, for the button's name: "Mobile". */
  label: string;
  onStart: () => void;
  busy?: boolean;
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
  className?: string;
}) {
  const body = text ? (
    <span dir="auto" className="min-w-0 break-words">
      {text}
    </span>
  ) : (
    <span className={editable ? "text-[var(--v2-blue)]" : "text-faint"}>{editable ? placeholder : "—"}</span>
  );
  if (!editable) return <span className={`inline-flex min-h-10 items-center text-[14.5px] text-ink md:min-h-8 ${className}`}>{body}</span>;
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onStart}
      aria-label={`Edit ${label.charAt(0).toLowerCase()}${label.slice(1)}: ${text || "nothing yet"}`}
      aria-busy={busy || undefined}
      className={`group -mx-1.5 inline-flex min-h-10 max-w-full md:min-h-8 items-center gap-1.5 rounded-lg px-1.5 text-left text-[14.5px] text-ink hover:bg-[var(--v2-blue-tint)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--v2-blue)] ${className}`}
    >
      {body}
      {busy ? (
        <span aria-hidden="true" className="size-2 shrink-0 animate-pulse rounded-full bg-gold" />
      ) : (
        <Pencil className="hidden shrink-0 text-faint opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 md:block" />
      )}
      {busy ? <span className="sr-only">Saving…</span> : null}
    </button>
  );
}

export function Problem({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="m-0 mt-1 text-[12.5px] font-semibold text-danger">
      {children}
    </p>
  );
}

/** A failed save, in words, next to what was edited, with the retry. What was typed stays in the input. */
export function SaveError({ edit }: { edit: InlineEdit }) {
  if (edit.state.phase !== "error" || !edit.state.message) return null;
  return (
    <div role="alert" className="mt-1.5 rounded-field border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
      <p className="m-0">{edit.state.message}</p>
      <button type="button" onClick={edit.submit} className={`${BTN_SMALL} mt-2 border-danger/40 bg-white text-danger hover:bg-danger-50`}>
        Try again
      </button>
    </div>
  );
}

/** Someone else changed it first: say who and when, show their value, and let the person choose. */
export function ConflictPanel({ edit, unit }: { edit: InlineEdit; unit: EditUnit }) {
  const c = edit.state.conflict;
  if (edit.state.phase !== "conflict" || !c) return null;
  const mine = edit.state.pending
    ? unit.fields
        .filter((k) => k in (edit.state.pending?.fields ?? {}))
        .map((k) => displayValue(k, edit.state.pending?.fields[k] ?? "") || "empty")
        .join(" ")
    : "";
  return (
    <div
      role="alert"
      data-testid="conflict"
      className="rounded-field border border-warning-200 bg-warning-50 px-3 py-2.5 text-[13.5px] text-warning-ink"
    >
      <p className="m-0">{conflictLine({ who: c.who, at: c.at, keys: unit.fields.filter((k) => k in c.theirs), theirs: c.theirs }, new Date())}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={edit.useTheirs} className={`${BTN_SMALL} border-[var(--v2-line-input)] bg-white text-ink hover:border-[var(--v2-blue)]`}>
          Use theirs
        </button>
        <button type="button" onClick={edit.keepMine} className={`${BTN_SMALL} border-transparent bg-navy text-white hover:bg-navy-hover`}>
          Keep mine{mine ? ` · ${mine}` : ""}
        </button>
      </div>
    </div>
  );
}

/** The one-line why for a name or a birth date. Enter saves with the one chosen. */
export function ReasonPicker({ edit }: { edit: InlineEdit }) {
  const group = useId();
  return (
    <div className="mt-2" role="group" aria-labelledby={group}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span id={group} className="text-[12.5px] font-bold text-muted">
          Why?
        </span>
        {REASON_CHIPS.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={edit.state.reason === r}
            onClick={() => edit.setReason(r)}
            className={`min-h-8 rounded-full border px-3 text-[12.5px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--v2-blue)] ${
              edit.state.reason === r
                ? "border-[var(--v2-blue)] bg-[var(--v2-blue-tint)] font-bold text-[var(--v2-blue)]"
                : "border-[var(--v2-line-input)] bg-white text-ink-2 hover:border-[var(--v2-blue)]"
            }`}
          >
            {r}
          </button>
        ))}
      </div>
      <p className="m-0 mt-1.5 text-[12px] text-muted">Enter saves with the reason above · Esc cancels</p>
    </div>
  );
}

/** Done and Cancel beside an input: on a phone there is no Enter or Esc. Hidden from md up, where the keys do it. */
export function EditActions({ edit, doneLabel = "Done" }: { edit: InlineEdit; doneLabel?: string }) {
  return (
    <div className="mt-2 flex gap-2 md:hidden">
      <button type="button" onClick={edit.submit} className={`${BTN_SMALL} min-h-11 border-transparent bg-navy text-white`}>
        {doneLabel}
      </button>
      <button type="button" onClick={edit.cancel} className={`${BTN_SMALL} min-h-11 border-[var(--v2-line-input)] bg-white text-ink`}>
        Cancel
      </button>
    </div>
  );
}

/**
 * The keys of an editor: Enter saves (not while an input method is composing, so a name typed in Japanese or Korean is not cut
 * short), Esc cancels. `restore` is told when the person used the keyboard, so focus goes back to the value afterwards.
 */
export function editorKeys(edit: InlineEdit, restore: () => void, opts: { multiline?: boolean } = {}) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      restore();
      edit.cancel();
      return;
    }
    if (e.key !== "Enter") return;
    // In a note, Enter makes a new line; Ctrl or Cmd with Enter saves.
    if (opts.multiline && !(e.ctrlKey || e.metaKey)) return;
    if (e.target instanceof HTMLButtonElement) return;
    e.preventDefault();
    restore();
    edit.submit();
  };
}

/** Puts focus back on the value button after a keyboard save or cancel (not after leaving by click: that would pull focus off the next thing). */
export function useFocusBack(open: boolean) {
  const button = useRef<HTMLButtonElement | null>(null);
  const wanted = useRef(false);
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !open && wanted.current) button.current?.focus();
    if (!open) wanted.current = false;
    was.current = open;
  }, [open]);
  return { button, restore: () => void (wanted.current = true) };
}

/** Closing the editor by leaving it: the focus moved to something outside this editor. */
export function leftEditor(e: React.FocusEvent<HTMLElement>): boolean {
  return !e.currentTarget.contains(e.relatedTarget as Node | null);
}

// ---------------------------------------------------------------------------
// A labelled row with one value: Mobile, Email, Language, Gender, Birth date, Profession, Relationship (select)
// ---------------------------------------------------------------------------
export type RowKind = "text" | "tel" | "email" | "select" | "date";

export function FieldRow({
  label,
  fieldKey,
  unit,
  edit,
  editable,
  kind = "text",
  placeholder,
  options,
  ageNote,
  wide = false,
}: {
  label: string;
  fieldKey: string;
  unit: EditUnit;
  edit: InlineEdit;
  editable: boolean;
  kind?: RowKind;
  /** The invitation when the value is empty: "Add a mobile number". */
  placeholder: string;
  options?: { value: string; label: string }[];
  /** Under a birth date as it is typed: "This makes Aarav 12, a child". */
  ageNote?: (draft: string) => string | null;
  /** A wider label column (the slide-over's labels are longer: "Emergency contact"). */
  wide?: boolean;
}) {
  const id = useId();
  const open = edit.editing || edit.busy;
  const { button, restore } = useFocusBack(open);
  const shown = edit.shown[fieldKey] ?? "";
  const onKeys = editorKeys(edit, restore);
  const draft = edit.state.draft[fieldKey] ?? "";
  const note = kind === "date" && ageNote && edit.editing ? ageNote(draft) : null;
  const problem = edit.state.problem;

  let body: ReactNode;
  if (edit.state.phase === "conflict") {
    body = <ConflictPanel edit={edit} unit={unit} />;
  } else if (edit.editing) {
    body = (
      <div onBlur={(e) => leftEditor(e) && edit.leave()} onKeyDown={onKeys}>
        {kind === "select" ? (
          <select id={id} autoFocus value={draft} onChange={(e) => edit.commit({ [fieldKey]: e.target.value })} aria-label={label} className={INPUT}>
            {!options?.some((o) => o.value === draft) ? <option value={draft}>{displayValue(fieldKey, draft) || "Choose…"}</option> : null}
            {options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={id}
            autoFocus
            type={kind === "tel" ? "tel" : kind === "email" ? "email" : "text"}
            inputMode={kind === "tel" ? "tel" : kind === "email" ? "email" : kind === "date" ? "numeric" : undefined}
            dir="auto"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(e) => edit.change(fieldKey, e.target.value)}
            placeholder={kind === "date" ? "MM/DD/YYYY" : undefined}
            aria-label={label}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${id}-problem` : undefined}
            className={INPUT}
          />
        )}
        {problem ? <Problem id={`${id}-problem`}>{problem}</Problem> : null}
        {note ? <p className="m-0 mt-1 text-[12.5px] font-semibold text-[var(--v2-sun-ink)]">{note}</p> : null}
        {unit.needsReason ? <ReasonPicker edit={edit} /> : null}
        <SaveError edit={edit} />
        <EditActions edit={edit} />
      </div>
    );
  } else {
    body = (
      <ValueButton
        text={displayValue(fieldKey, shown)}
        placeholder={placeholder}
        editable={editable}
        label={label}
        onStart={edit.start}
        busy={edit.busy}
        buttonRef={button}
      />
    );
  }
  return (
    <div
      className={`grid items-start gap-x-3 py-0.5 ${wide ? "grid-cols-[6.75rem_minmax(0,1fr)] sm:grid-cols-[7.5rem_minmax(0,1fr)]" : "grid-cols-[4.75rem_minmax(0,1fr)] sm:grid-cols-[5.25rem_minmax(0,1fr)]"}`}
    >
      <label htmlFor={edit.editing && kind !== "select" ? id : undefined} className="pt-[11px] text-[13px] text-muted md:pt-[7px]">
        {label}
      </label>
      <div className="min-w-0">{body}</div>
    </div>
  );
}

/** Two inputs for a person's name, with the reason. Enter saves; leaving does not (so a half-typed name is never saved). */
export function NameEditor({
  edit,
  restore,
  firstLabel = "First name",
  lastLabel = "Last name",
  className = "",
}: {
  edit: InlineEdit;
  /** Called when the keyboard closes the editor, so focus can go back to the name. */
  restore: () => void;
  firstLabel?: string;
  lastLabel?: string;
  className?: string;
}) {
  const id = useId();
  const onKeys = editorKeys(edit, restore);
  const problem = edit.state.problem;
  return (
    <div className={className} onKeyDown={onKeys}>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={`${id}-first`} className="block text-[12px] font-bold text-muted">
            {firstLabel}
          </label>
          <input
            id={`${id}-first`}
            autoFocus
            dir="auto"
            autoComplete="off"
            value={edit.state.draft.first_name ?? ""}
            onChange={(e) => edit.change("first_name", e.target.value)}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${id}-problem` : undefined}
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor={`${id}-last`} className="block text-[12px] font-bold text-muted">
            {lastLabel}
          </label>
          <input
            id={`${id}-last`}
            dir="auto"
            autoComplete="off"
            value={edit.state.draft.last_name ?? ""}
            onChange={(e) => edit.change("last_name", e.target.value)}
            aria-invalid={problem ? true : undefined}
            className={INPUT}
          />
        </div>
      </div>
      {problem ? <Problem id={`${id}-problem`}>{problem}</Problem> : null}
      <ReasonPicker edit={edit} />
      <SaveError edit={edit} />
      <EditActions edit={edit} />
    </div>
  );
}

/** What a draft of this unit would be stored as, for a screen that wants to show it before saving (the age note uses it). */
export function storedOf(unit: EditUnit, draft: Values, check: CheckContext): Values | null {
  const r = checkDraft(unit, draft, check);
  return r.ok ? r.stored : null;
}
