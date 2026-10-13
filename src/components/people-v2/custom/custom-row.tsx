"use client";

import { useId } from "react";

import { customConflictLine, customDisplay, customUnit, inputShape, type CustomRowModel } from "@/lib/people-v2/custom-fields";
import type { CheckContext } from "@/lib/people-v2/inline-edit";

import { EditActions, INPUT, Problem, SaveError, ValueButton, editorKeys, leftEditor, useFocusBack } from "../family/inline-ui";
import { useInlineEdit, type InlineEdit } from "../family/use-inline-edit";
import { LockIcon } from "../slideover/section";

// One custom value, click-to-edit like every other value on the Family page: the same state machine (Enter saves, leaving the box saves,
// Esc cancels, a failed save keeps what was typed and says why with a retry, a conflict offers Use theirs or Keep mine, an Undo for 30
// seconds), checked by the field's type before anything is sent. The save is the "More details" card's own action (see
// src/app/(app)/households/[id]/custom-actions.ts). Without people.manage the value is plain text.

/** A custom value's checks come from the field's type, not from the person's or household's columns; this context is only the shape the machine wants. */
const NO_COLUMN_CHECKS: CheckContext = { today: "" };

const BTN =
  "inline-flex min-h-10 items-center justify-center rounded-full border px-4 text-[13.5px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--v2-blue)]";

function Eye() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function List() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

/** The icon of who sees a field: a lock (staff only), an eye (the member sees their own) or a list (the member directory). */
export function VisibilityIcon({ visibility }: { visibility: CustomRowModel["visibility"] }) {
  return visibility === "staff" ? <LockIcon /> : visibility === "member_self" ? <Eye /> : <List />;
}

/** Who sees the field, as the definition says. */
export function VisibilityMark({ visibility }: { visibility: CustomRowModel["visibility"] }) {
  const text = visibility === "staff" ? "Staff only" : visibility === "member_self" ? "Members can see this" : "Members can see this (in the directory)";
  return (
    <span role="img" aria-label={text} title={text} data-visibility={visibility} className="ml-1 inline-flex translate-y-[2px] items-center text-faint">
      <VisibilityIcon visibility={visibility} />
    </span>
  );
}

function Conflict({ edit, row, currency }: { edit: InlineEdit; row: CustomRowModel; currency: string }) {
  const c = edit.state.conflict;
  if (edit.state.phase !== "conflict" || !c) return null;
  const theirs = customDisplay(row, c.theirs[row.fieldKey] ?? "", currency);
  const mine = edit.state.pending ? customDisplay(row, edit.state.pending.fields[row.fieldKey] ?? "", currency) : "";
  return (
    <div role="alert" data-testid="conflict" className="rounded-[10px] border border-[var(--v2-sun-from)]/60 bg-[var(--v2-sun-tint)] px-3 py-2.5 text-[13.5px] text-[var(--v2-sun-ink)]">
      <p className="m-0">{customConflictLine({ who: c.who, at: c.at, theirs }, new Date())}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={edit.useTheirs} className={`${BTN} border-[var(--v2-line-input)] bg-white text-ink hover:border-[var(--v2-blue)]`}>
          Use theirs
        </button>
        <button type="button" onClick={edit.keepMine} className={`${BTN} border-transparent bg-navy text-white hover:bg-navy-hover`}>
          Keep mine · {mine || "empty"}
        </button>
      </div>
    </div>
  );
}

export type CustomRowProps = {
  row: CustomRowModel;
  entity: "people" | "households";
  recordId: string;
  /** Whose value it is, for sentences: "Samira" (Saved Samira's Shirt size). */
  owner: string;
  canEdit: boolean;
  currency: string;
  /** The page to refresh after a save. */
  path: string;
  /** The slide-over's and the household card's labels are longer. */
  wide?: boolean;
};

export function CustomValueRow({ row, entity, recordId, owner, canEdit, currency, path, wide = false }: CustomRowProps) {
  const id = useId();
  const unit = customUnit(row);
  const edit = useInlineEdit({
    unit,
    values: { [row.fieldKey]: row.stored },
    check: NO_COLUMN_CHECKS,
    owner,
    target: { kind: "custom", entity, recordId, path },
  });
  const open = edit.editing || edit.busy;
  const { button, restore } = useFocusBack(open);
  const onKeys = editorKeys(edit, restore);
  const shape = inputShape(row, currency);
  const draft = edit.state.draft[row.fieldKey] ?? "";
  const problem = edit.state.problem;

  let body;
  if (edit.state.phase === "conflict") {
    body = <Conflict edit={edit} row={row} currency={currency} />;
  } else if (edit.editing) {
    const known = shape.options.some((o) => o.value === draft);
    body = (
      <div onBlur={(e) => leftEditor(e) && edit.leave()} onKeyDown={onKeys}>
        {shape.control === "select" ? (
          <select id={id} autoFocus value={draft} onChange={(e) => edit.commit({ [row.fieldKey]: e.target.value })} aria-label={row.label} className={INPUT}>
            <option value="">Nothing recorded</option>
            {draft && !known ? <option value={draft}>{draft}</option> : null}
            {shape.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={id}
            autoFocus
            type="text"
            inputMode={shape.inputMode}
            dir="auto"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(e) => edit.change(row.fieldKey, e.target.value)}
            placeholder={shape.placeholder || undefined}
            aria-label={row.label}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${id}-problem` : undefined}
            className={INPUT}
          />
        )}
        {problem ? <Problem id={`${id}-problem`}>{problem}</Problem> : null}
        <SaveError edit={edit} />
        <EditActions edit={edit} />
      </div>
    );
  } else {
    body = (
      <ValueButton
        text={customDisplay(row, edit.shown[row.fieldKey] ?? "", currency)}
        placeholder="Add"
        editable={canEdit}
        label={row.label}
        onStart={edit.start}
        busy={edit.busy}
        buttonRef={button}
      />
    );
  }

  return (
    <div
      data-testid="custom-row"
      data-field={row.key}
      className={`grid items-start gap-x-3 py-0.5 ${wide ? "grid-cols-[6.75rem_minmax(0,1fr)] sm:grid-cols-[7.5rem_minmax(0,1fr)]" : "grid-cols-[5.5rem_minmax(0,1fr)] sm:grid-cols-[6.25rem_minmax(0,1fr)]"}`}
    >
      <label htmlFor={edit.editing && shape.control === "input" ? id : undefined} className="pt-[11px] text-[13px] leading-snug text-muted md:pt-[7px]">
        <span dir="auto">{row.label}</span>
        <VisibilityMark visibility={row.visibility} />
      </label>
      <div className="min-w-0">{body}</div>
    </div>
  );
}
