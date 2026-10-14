"use client";

import { useReducer, useRef, useState } from "react";

import { useStepUp } from "@/components/step-up";
import {
  initialEdit,
  possessive,
  reduce,
  savedSentence,
  undoReason,
  undoneSentence,
  type CheckContext,
  type EditEvent,
  type EditState,
  type EditUnit,
  type SavePayload,
  type Values,
} from "@/lib/people-v2/inline-edit";

import { useFamilyActions, type EditTarget } from "./actions";
import { useUndo } from "./undo";

/**
 * One click-to-edit thing (a field, a name, an address block, a switch): its state machine, the save, the Undo offer and the
 * conflict. The rules live in src/lib/people-v2/inline-edit.ts (pure, tested); this only connects them to the page.
 *
 *   - `values` are the stored values the page last showed; new ones from the page (after a save, an undo, a refresh) are adopted
 *     only while nothing is being edited, so typing is never overwritten;
 *   - a failed save keeps what was typed and says why in words; "Saved" never appears for a write that failed;
 *   - a name or birth date needs Enter (with its reason); other fields also save when the person leaves them.
 */
export function useInlineEdit(opts: { unit: EditUnit; values: Values; check: CheckContext; owner: string; target: EditTarget }) {
  const { unit, check, owner, target } = opts;
  const actions = useFamilyActions();
  const undo = useUndo();
  const stepUp = useStepUp();
  const [state, dispatch] = useReducer((s: EditState, e: EditEvent) => reduce(s, e, unit, check), initialEdit(unit, opts.values));

  // New values from the page: adopted when nothing is being edited.
  const seen = unit.fields.map((k) => opts.values[k] ?? "").join("\u0001");
  const [lastSeen, setLastSeen] = useState(seen);
  if (seen !== lastSeen) {
    setLastSeen(seen);
    dispatch({ type: "sync", values: opts.values });
  }

  // The editor is leaving (saved, cancelled): the field losing focus then must not save a second time.
  const leaving = useRef(false);
  const label = `${possessive(owner)} ${unit.label}`;

  async function perform(pending: SavePayload, before: Values) {
    const call = (p: { fields: Values; expect: Values; reason: string | null }) => actions.save(target, { ...p, label });
    let result;
    try {
      result = stepUp ? await stepUp.run(() => call(pending), unit.label) : await call(pending);
    } catch (error) {
      console.error("[family] a save did not complete:", error);
      leaving.current = false;
      dispatch({ type: "failed", message: `Could not save ${label} — the server did not respond. Try again.` });
      return;
    }
    if (result.ok) {
      dispatch({ type: "saved" });
      if (result.changed && (unit.canUndo?.(before[unit.fields[0]] ?? "", pending.fields[unit.fields[0]] ?? "") ?? true)) {
        const earlier: Values = Object.fromEntries(Object.keys(pending.fields).map((k) => [k, before[k] ?? ""]));
        undo?.offer({
          message: savedSentence(owner, unit.label),
          doneMessage: undoneSentence(owner, unit.label),
          run: () => actions.save(target, { fields: earlier, expect: pending.fields, reason: undoReason(unit.label, pending.reason), label }),
        });
      }
      return;
    }
    leaving.current = false;
    if (result.kind === "conflict" && result.conflict) {
      dispatch({ type: "conflicted", theirs: result.conflict.theirs, who: result.conflict.who, at: result.conflict.at });
      return;
    }
    dispatch({ type: "failed", message: result.error });
  }

  function submit() {
    const next = reduce(state, { type: "submit" }, unit, check);
    leaving.current = next.phase === "saving" || next.phase === "idle";
    dispatch({ type: "submit" });
    if (next.phase === "saving" && next.pending) void perform(next.pending, state.committed);
  }

  /** A choice that saves at once (a list, a switch): start if needed, set the value and save in one go. */
  function commit(values: Values) {
    const events: EditEvent[] = [
      ...(state.phase === "idle" ? ([{ type: "start" }] as EditEvent[]) : []),
      ...Object.entries(values).map(([key, value]) => ({ type: "change", key, value }) as EditEvent),
      { type: "submit" },
    ];
    const next = events.reduce((s, e) => reduce(s, e, unit, check), state);
    leaving.current = next.phase === "saving" || next.phase === "idle";
    for (const e of events) dispatch(e);
    if (next.phase === "saving" && next.pending) void perform(next.pending, state.committed);
  }

  function keepMine() {
    const next = reduce(state, { type: "keep_mine" }, unit, check);
    dispatch({ type: "keep_mine" });
    if (next.phase === "saving" && next.pending) void perform(next.pending, next.committed);
  }

  return {
    state,
    /** What to show: the draft while a save is in flight (so the value does not jump back), else the confirmed values. */
    shown: state.phase === "idle" ? state.committed : state.draft,
    editing: state.phase === "editing" || state.phase === "error",
    busy: state.phase === "saving",
    start() {
      leaving.current = false;
      dispatch({ type: "start" });
    },
    change(key: string, value: string) {
      dispatch({ type: "change", key, value });
    },
    setReason(value: string) {
      dispatch({ type: "reason", value });
    },
    cancel() {
      leaving.current = true;
      dispatch({ type: "cancel" });
    },
    /** Enter, or the Done button. */
    submit,
    commit,
    /** The person left the field: saves a plain field that was changed (never a name or birth date, never after an error). */
    leave() {
      if (leaving.current || unit.needsReason || state.phase !== "editing") return;
      submit();
    },
    useTheirs() {
      leaving.current = true;
      dispatch({ type: "use_theirs" });
    },
    keepMine,
  };
}

export type InlineEdit = ReturnType<typeof useInlineEdit>;
