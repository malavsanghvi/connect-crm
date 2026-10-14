"use client";

import { useId, useRef, type KeyboardEvent } from "react";

import type { EditUnit } from "@/lib/people-v2/inline-edit";
import { interestKey, interestLabel, removeLegacyDraft, splitInterests, toggleInterestDraft } from "@/lib/person-interests";
import { decodeList, draftParts, listKey, removeChip, typeIntoDraft } from "@/lib/person-lists";
import { INTEREST_CATALOG } from "@/lib/profile-details";

import { ConflictPanel, EditActions, Pencil, Problem, SaveError, editorKeys, leftEditor, useFocusBack } from "./inline-ui";
import type { InlineEdit } from "./use-inline-edit";

// A row whose value is a list of short items (interests, expertise areas), drawn as chips and edited in place: click, type, a comma or
// Enter makes a chip, Enter on an empty line (or leaving the field, or Done on a phone) saves, Esc cancels. The rules (limits, what
// counts as the same item, how a list is stored) are in src/lib/person-lists.ts; the save, Undo and conflict are the same as for any
// other field (useInlineEdit). The draft is text with one item per line, so what was typed stays in the field after a failed save.

const CHIP =
  "inline-flex min-h-7 max-w-full items-center gap-1 rounded-full bg-[var(--v2-ground)] px-2.5 text-[13.5px] text-ink ring-1 ring-inset ring-[var(--v2-line-input)]";

export function Chips({ items }: { items: readonly string[] }) {
  return (
    <span className="flex flex-wrap gap-1.5" data-testid="chips">
      {items.map((c) => (
        <span key={c} dir="auto" className={`${CHIP} break-words`}>
          {c}
        </span>
      ))}
    </span>
  );
}

export function ListRow({
  label,
  fieldKey,
  unit,
  edit,
  editable,
  placeholder,
  wide = false,
}: {
  label: string;
  fieldKey: string;
  unit: EditUnit;
  edit: InlineEdit;
  editable: boolean;
  /** The invitation when the list is empty: "Add interests". */
  placeholder: string;
  wide?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const open = edit.editing || edit.busy;
  const { button, restore } = useFocusBack(open);
  const onKeys = editorKeys(edit, restore);
  const items = decodeList(edit.shown[fieldKey] ?? "");
  const draft = edit.state.draft[fieldKey] ?? "";
  const { chips, typing } = draftParts(draft);
  const problem = edit.state.problem;

  // Enter with something typed makes it a chip; Enter on an empty line is left to the editor's keys, which save.
  function onInputKey(e: KeyboardEvent<HTMLInputElement>) {
    const next = listKey({ key: e.key, isComposing: e.nativeEvent.isComposing }, draft);
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    edit.change(fieldKey, next);
  }

  let body;
  if (edit.state.phase === "conflict") {
    body = <ConflictPanel edit={edit} unit={unit} />;
  } else if (edit.editing) {
    body = (
      <div onBlur={(e) => leftEditor(e) && edit.leave()} onKeyDown={onKeys}>
        {/* The box is the input's frame: a click anywhere in it types. */}
        <div
          onClick={() => input.current?.focus()}
          className="flex min-h-11 w-full flex-wrap items-center gap-1.5 rounded-field border border-[var(--v2-line-input)] bg-white px-2 py-1.5 focus-within:border-[var(--v2-blue)] focus-within:ring-2 focus-within:ring-[var(--v2-blue-border)] md:min-h-10"
        >
          {chips.map((c, i) => (
            <span key={`${c}-${i}`} dir="auto" className={CHIP}>
              <span className="break-words">{c}</span>
              <button
                type="button"
                aria-label={`Remove ${c}`}
                // Keep the focus in the input: taking it away would look like leaving the field.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => edit.change(fieldKey, removeChip(draft, i))}
                className="-mr-1 grid size-6 place-items-center rounded-full text-[16px] leading-none text-muted hover:bg-white hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--v2-blue)]"
              >
                <span aria-hidden="true">×</span>
              </button>
            </span>
          ))}
          <input
            ref={input}
            id={id}
            autoFocus
            dir="auto"
            autoComplete="off"
            spellCheck={false}
            value={typing}
            onChange={(e) => edit.change(fieldKey, typeIntoDraft(draft, e.target.value))}
            onKeyDown={onInputKey}
            aria-label={label}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${id}-problem` : `${id}-hint`}
            placeholder={chips.length === 0 ? placeholder : undefined}
            className="min-h-8 min-w-[9ch] flex-1 bg-transparent px-1 text-[14.5px] text-ink outline-none! placeholder:text-faint"
          />
        </div>
        {problem ? <Problem id={`${id}-problem`}>{problem}</Problem> : null}
        <p id={`${id}-hint`} className="m-0 mt-1 text-[12px] text-muted">
          <span className="md:hidden">A comma adds one · Done saves</span>
          <span className="hidden md:inline">A comma or Enter adds one · Enter on an empty line saves · Esc cancels</span>
        </p>
        <SaveError edit={edit} />
        <EditActions edit={edit} />
      </div>
    );
  } else if (!editable) {
    body = (
      <span className="inline-flex min-h-10 items-center text-[14.5px] text-ink md:min-h-8">
        {items.length ? <Chips items={items} /> : <span className="text-faint">—</span>}
      </span>
    );
  } else {
    body = (
      <button
        ref={button}
        type="button"
        onClick={edit.start}
        aria-label={`Edit ${label.charAt(0).toLowerCase()}${label.slice(1)}: ${items.join(", ") || "nothing yet"}`}
        aria-busy={edit.busy || undefined}
        className="group -mx-1.5 inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-[14.5px] text-ink hover:bg-[var(--v2-blue-tint)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--v2-blue)] md:min-h-8"
      >
        {items.length ? <Chips items={items} /> : <span className="text-[var(--v2-blue)]">{placeholder}</span>}
        {edit.busy ? (
          <>
            <span aria-hidden="true" className="size-2 shrink-0 animate-pulse rounded-full bg-gold" />
            <span className="sr-only">Saving…</span>
          </>
        ) : (
          <Pencil className="hidden shrink-0 text-faint opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 md:block" />
        )}
      </button>
    );
  }
  return (
    <div
      className={`grid items-start gap-x-3 py-0.5 ${wide ? "grid-cols-[6.75rem_minmax(0,1fr)] sm:grid-cols-[7.5rem_minmax(0,1fr)]" : "grid-cols-[4.75rem_minmax(0,1fr)] sm:grid-cols-[5.25rem_minmax(0,1fr)]"}`}
    >
      <label htmlFor={edit.editing ? id : undefined} className="pt-[11px] text-[13px] text-muted md:pt-[7px]">
        {label}
      </label>
      <div className="min-w-0">{body}</div>
    </div>
  );
}

const TOGGLE =
  "inline-flex min-h-9 items-center rounded-full border px-3.5 text-[13.5px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--v2-blue)]";

/**
 * Interests: a fixed choice, not free text. The member app keeps only its own keys (INTEREST_CATALOG), so staff toggle those; a value
 * on file that is not one of them (imported or older) is shown as a chip they can remove and cannot add back. Done saves (so does
 * leaving the field); Esc cancels. The rules are in src/lib/person-interests.ts.
 */
export function InterestsRow({
  label,
  fieldKey,
  unit,
  edit,
  editable,
  placeholder,
  wide = false,
}: {
  label: string;
  fieldKey: string;
  unit: EditUnit;
  edit: InlineEdit;
  editable: boolean;
  placeholder: string;
  wide?: boolean;
}) {
  const id = useId();
  const open = edit.editing || edit.busy;
  const { button, restore } = useFocusBack(open);
  const onKeys = editorKeys(edit, restore);
  const shown = splitInterests(edit.shown[fieldKey] ?? "");
  const names = [...shown.chosen.map(interestLabel), ...shown.legacy];
  const draft = edit.state.draft[fieldKey] ?? "";
  const chips = draftParts(draft).chips;
  const legacy = chips.filter((c) => interestKey(c) === null);
  const problem = edit.state.problem;

  let body;
  if (edit.state.phase === "conflict") {
    body = <ConflictPanel edit={edit} unit={unit} />;
  } else if (edit.editing) {
    body = (
      <div onBlur={(e) => leftEditor(e) && edit.leave()} onKeyDown={onKeys} role="group" aria-label={label} aria-describedby={`${id}-hint`}>
        <div className="flex flex-wrap gap-1.5">
          {INTEREST_CATALOG.map((i, n) => {
            const on = chips.some((c) => interestKey(c) === i.key);
            return (
              <button
                key={i.key}
                type="button"
                autoFocus={n === 0}
                aria-pressed={on}
                data-interest={i.key}
                onClick={() => edit.change(fieldKey, toggleInterestDraft(draft, i.key))}
                className={`${TOGGLE} ${on ? "border-[var(--v2-blue)] bg-[var(--v2-blue-tint)] font-bold text-[var(--v2-blue)]" : "border-[var(--v2-line-input)] bg-white text-ink-2 hover:border-[var(--v2-blue)]"}`}
              >
                {on ? (
                  <span aria-hidden="true" className="mr-1">
                    ✓
                  </span>
                ) : null}
                {i.label}
              </button>
            );
          })}
        </div>
        {legacy.length > 0 ? (
          <div className="mt-2" data-testid="legacy-interests">
            <p className="m-0 mb-1 text-[12px] text-muted">On file from before, not one of the app&apos;s interests. You can remove it, but not add it back.</p>
            <div className="flex flex-wrap gap-1.5">
              {legacy.map((c) => (
                <span key={c} dir="auto" className={CHIP}>
                  <span className="break-words">{c}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${c}`}
                    // Keep the focus inside the editor: taking it away would look like leaving the field.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => edit.change(fieldKey, removeLegacyDraft(draft, c))}
                    className="-mr-1 grid size-6 place-items-center rounded-full text-[16px] leading-none text-muted hover:bg-white hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--v2-blue)]"
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {problem ? <Problem id={`${id}-problem`}>{problem}</Problem> : null}
        <p id={`${id}-hint`} className="m-0 mt-2 text-[12px] text-muted">
          Choose from the list · Done saves · Esc cancels
        </p>
        <SaveError edit={edit} />
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            data-testid="interests-done"
            onClick={edit.submit}
            className="inline-flex min-h-10 items-center justify-center rounded-full border border-transparent bg-navy px-4 text-[13.5px] font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--v2-blue)]"
          >
            Done
          </button>
          <button
            type="button"
            onClick={edit.cancel}
            className="inline-flex min-h-10 items-center justify-center rounded-full border border-[var(--v2-line-input)] bg-white px-4 text-[13.5px] font-bold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--v2-blue)]"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  } else if (!editable) {
    body = (
      <span className="inline-flex min-h-10 items-center text-[14.5px] text-ink md:min-h-8">
        {names.length ? <Chips items={names} /> : <span className="text-faint">—</span>}
      </span>
    );
  } else {
    body = (
      <button
        ref={button}
        type="button"
        onClick={edit.start}
        aria-label={`Edit ${label.charAt(0).toLowerCase()}${label.slice(1)}: ${names.join(", ") || "nothing yet"}`}
        aria-busy={edit.busy || undefined}
        className="group -mx-1.5 inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-[14.5px] text-ink hover:bg-[var(--v2-blue-tint)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--v2-blue)] md:min-h-8"
      >
        {names.length ? <Chips items={names} /> : <span className="text-[var(--v2-blue)]">{placeholder}</span>}
        {edit.busy ? (
          <>
            <span aria-hidden="true" className="size-2 shrink-0 animate-pulse rounded-full bg-gold" />
            <span className="sr-only">Saving…</span>
          </>
        ) : (
          <Pencil className="hidden shrink-0 text-faint opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 md:block" />
        )}
      </button>
    );
  }
  return (
    <div
      className={`grid items-start gap-x-3 py-0.5 ${wide ? "grid-cols-[6.75rem_minmax(0,1fr)] sm:grid-cols-[7.5rem_minmax(0,1fr)]" : "grid-cols-[4.75rem_minmax(0,1fr)] sm:grid-cols-[5.25rem_minmax(0,1fr)]"}`}
    >
      <span className="pt-[11px] text-[13px] text-muted md:pt-[7px]">{label}</span>
      <div className="min-w-0">{body}</div>
    </div>
  );
}
