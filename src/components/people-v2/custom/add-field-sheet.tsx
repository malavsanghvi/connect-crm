"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";

import { useToast } from "@/components/toast";
import { suggestionsFor } from "@/lib/custom-field-suggestions";
import {
  ASK_ADMIN_EXPLANATION,
  ENTITY_WORDS,
  VISIBILITY_OPTIONS,
  TYPE_OPTIONS,
  addFieldTitle,
  addedSentence,
  addedUndoneSentence,
  applySuggestion,
  askAdminRequest,
  checkNewField,
  emptyNewField,
  type AddFieldMode,
  type CustomEntity,
  type NewFieldInput,
  type OkPayload,
} from "@/lib/people-v2/custom-fields";
import type { CustomType } from "@/lib/import/mapping";

import { useFamilyActions } from "../family/actions";
import { INPUT, Problem } from "../family/inline-ui";
import { useUndo } from "../family/undo";

import { VisibilityIcon } from "./custom-row";
import { SheetFrame } from "./sheet-frame";

// "Add a field": a small sheet to name a field, pick its type (and choices), who it applies to, who can see it and whether the one box
// finds it. For people who hold settings.manage it adds the field through the Settings screen's own action; the field appears on every
// card at once and the toast's Undo archives it (nothing is ever deleted). For everyone else it is the same sheet in an "Ask an admin"
// state: they fill in what they want and copy a request for an admin (no write, no new messaging feature).

const LABEL = "block text-[12.5px] font-bold text-muted";
const CHIP =
  "min-h-9 rounded-full border px-3.5 text-[13.5px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--v2-blue)]";

export function AddFieldSheet({ mode, entity: first, payload, onClose }: { mode: AddFieldMode; entity: CustomEntity; payload: OkPayload; onClose: () => void }) {
  const actions = useFamilyActions();
  const undo = useUndo();
  const toast = useToast();
  const router = useRouter();
  const uid = useId();
  const [form, setForm] = useState<NewFieldInput>(emptyNewField(first));
  const [problem, setProblem] = useState<{ on: "label" | "choices" | "type"; text: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copy, setCopy] = useState<{ state: "idle" | "copied" | "failed"; text: string }>({ state: "idle", text: "" });
  const nameBox = useRef<HTMLInputElement>(null);
  const asking = mode === "ask";

  const group = payload[form.entity];
  const existing = [...group.active, ...group.archived].map((d) => ({ label: d.label, archived: d.status === "archived" }));
  const suggestions = suggestionsFor(payload.kind, form.entity, existing.map((e) => e.label));

  const set = (patch: Partial<NewFieldInput>) => {
    setForm((f) => ({ ...f, ...patch }));
    setProblem(null);
    setFailed(null);
    setCopy({ state: "idle", text: "" });
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const checked = checkNewField(form, existing);
    if (!checked.ok) {
      setProblem({ on: checked.on, text: checked.error });
      setCopy({ state: "idle", text: "" });
      return;
    }
    if (asking) {
      const text = askAdminRequest(form, { community: payload.community, label: checked.label });
      try {
        await navigator.clipboard.writeText(text);
        setCopy({ state: "copied", text });
      } catch (error) {
        console.error("[custom fields] the request could not be copied:", error);
        setCopy({ state: "failed", text });
      }
      return;
    }
    setSaving(true);
    setFailed(null);
    try {
      const res = await actions.custom.add({ entity: form.entity, label: checked.label, type: form.type, choices: checked.choices, sensitivity: form.sensitivity, searchable: form.searchable });
      if (res.ok) {
        router.refresh();
        onClose();
        const id = res.id;
        if (id && undo) {
          undo.offer({
            message: addedSentence(checked.label),
            doneMessage: addedUndoneSentence(checked.label),
            run: async () => {
              const r = await actions.custom.setStatus({ id, status: "archived" });
              router.refresh();
              return r.ok ? { ok: true, message: addedUndoneSentence(checked.label), changed: true } : { ok: false, error: r.error, kind: "other" };
            },
          });
        } else toast?.show(res.message, "ok");
        return;
      }
      setFailed(res.error);
    } catch (error) {
      console.error("[custom fields] adding a field did not complete:", error);
      setFailed("Could not add the field — the server did not respond. Nothing was changed. Try again.");
    }
    setSaving(false);
  }

  const labelProblem = problem?.on === "label" ? problem.text : null;
  const choicesProblem = problem?.on === "choices" ? problem.text : null;

  return (
    <SheetFrame title={addFieldTitle(form.entity)} onClose={onClose} testId="add-field-sheet">
      <p className="m-0 mt-1.5 text-[13.5px] leading-snug text-muted">
        {asking
          ? "Say what you would like. Nothing is added until an admin does it."
          : `It appears on every ${ENTITY_WORDS[form.entity].one} card straight away, ordered after the others. Nothing is ever deleted: a field you no longer need is archived and keeps its values.`}
      </p>
      {asking ? (
        <p role="note" className="m-0 mt-3 rounded-xl border border-[var(--v2-sun-from)]/60 bg-[var(--v2-sun-tint)] px-3 py-2.5 text-[13.5px] leading-snug text-[var(--v2-sun-ink)]">
          <strong>Ask an admin to add a field.</strong> {ASK_ADMIN_EXPLANATION}
        </p>
      ) : null}

      <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-3.5">
        <div>
          <span className={LABEL} id={`${uid}-applies`}>
            Applies to
          </span>
          <div role="group" aria-labelledby={`${uid}-applies`} className="mt-1.5 flex flex-wrap gap-2">
            {(["people", "households"] as const).map((e) => (
              <button
                key={e}
                type="button"
                aria-pressed={form.entity === e}
                onClick={() => set({ entity: e })}
                className={`${CHIP} ${form.entity === e ? "border-[var(--v2-blue)] bg-[var(--v2-blue-tint)] font-bold text-[var(--v2-blue)]" : "border-[var(--v2-line-input)] bg-white text-ink-2 hover:border-[var(--v2-blue)]"}`}
              >
                A {ENTITY_WORDS[e].one}
              </button>
            ))}
          </div>
        </div>

        {suggestions.length > 0 ? (
          <div>
            <span className={LABEL}>Suggested for {payload.kind.label}</span>
            <div className="mt-1.5 flex flex-wrap gap-2" data-testid="field-suggestions">
              {suggestions.slice(0, 6).map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => {
                    setForm((f) => applySuggestion(f, s));
                    setProblem(null);
                    setFailed(null);
                    setCopy({ state: "idle", text: "" });
                    nameBox.current?.focus();
                  }}
                  className={`${CHIP} border-[var(--v2-line-input)] bg-white text-ink hover:border-[var(--v2-blue)]`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
          <div className="min-w-0">
            <label htmlFor={`${uid}-name`} className={LABEL}>
              Name of the field
            </label>
            <input
              id={`${uid}-name`}
              ref={nameBox}
              dir="auto"
              autoComplete="off"
              value={form.label}
              maxLength={200}
              onChange={(e) => set({ label: e.target.value })}
              placeholder="For example: Pronouns"
              aria-invalid={labelProblem ? true : undefined}
              aria-describedby={labelProblem ? `${uid}-name-problem` : undefined}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor={`${uid}-type`} className={LABEL}>
              Type
            </label>
            <select id={`${uid}-type`} value={form.type} onChange={(e) => set({ type: e.target.value as CustomType })} className={`${INPUT} !w-auto`}>
              {TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          {labelProblem ? (
            <div className="col-span-2">
              <Problem id={`${uid}-name-problem`}>{labelProblem}</Problem>
            </div>
          ) : null}
        </div>

        {form.type === "choice" ? (
          <div>
            <label htmlFor={`${uid}-choices`} className={LABEL}>
              Choices, separated by commas
            </label>
            <input
              id={`${uid}-choices`}
              dir="auto"
              autoComplete="off"
              value={form.choicesText}
              onChange={(e) => set({ choicesText: e.target.value })}
              placeholder="Morning, Afternoon, Evening"
              aria-invalid={choicesProblem ? true : undefined}
              aria-describedby={choicesProblem ? `${uid}-choices-problem` : undefined}
              className={INPUT}
            />
            {choicesProblem ? <Problem id={`${uid}-choices-problem`}>{choicesProblem}</Problem> : null}
          </div>
        ) : null}

        <fieldset className="m-0 border-0 p-0">
          <legend className={`${LABEL} mb-1.5 p-0`}>Who can see it</legend>
          <div className="flex flex-col gap-2">
            {VISIBILITY_OPTIONS.map((o) => (
              <label
                key={o.value}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--v2-line-input)] bg-white px-3.5 py-2.5 has-[:checked]:border-[var(--v2-blue)] has-[:checked]:bg-[var(--v2-blue-tint)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--v2-blue)]"
              >
                <input type="radio" name={`${uid}-who`} value={o.value} checked={form.sensitivity === o.value} onChange={() => set({ sensitivity: o.value })} className="sr-only" />
                <span className="mt-0.5 text-ink-2">
                  <VisibilityIcon visibility={o.value} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[14.5px] font-bold text-ink">{o.title}</span>
                  <span className="block text-[13px] leading-snug text-muted">{o.detail}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex min-h-10 items-center gap-2.5 text-[13.5px] text-ink">
          <input type="checkbox" checked={form.searchable} onChange={(e) => set({ searchable: e.target.checked })} className="size-5" />
          Found by the one box and usable as a list filter
        </label>

        {failed ? (
          <p role="alert" className="m-0 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
            {failed}
          </p>
        ) : null}

        {copy.state !== "idle" ? (
          <div data-testid="ask-admin-request">
            <p role="status" className={`m-0 mb-1.5 text-[13px] font-semibold ${copy.state === "copied" ? "text-[var(--v2-green-ink)]" : "text-danger"}`}>
              {copy.state === "copied" ? "Copied. Send it to an admin." : "Could not copy it automatically. Select the text below and copy it yourself."}
            </p>
            <textarea readOnly value={copy.text} rows={6} dir="auto" onFocus={(e) => e.currentTarget.select()} className={`${INPUT} py-2 text-[13px]`} aria-label="Your request for an admin" />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 items-center rounded-full border border-[var(--v2-line-input)] bg-white px-5 text-[14px] font-bold text-ink hover:border-[var(--v2-blue)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex min-h-11 items-center rounded-full bg-navy px-5 text-[14px] font-bold text-white hover:bg-navy-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--v2-blue)] disabled:opacity-60"
          >
            {asking ? "Copy request for an admin" : saving ? "Adding…" : "Add field"}
          </button>
        </div>
      </form>
    </SheetFrame>
  );
}
