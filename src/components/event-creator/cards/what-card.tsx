"use client";

import { useState } from "react";

import { likePastEvent } from "@/lib/event-creator/mapping";
import { clashesFor, dateSuggestions, startLike } from "@/lib/event-creator/smart";

import { ErrorNote, Field, Note, SuggestionButton, sectionLabel, softButton, type CardProps } from "../parts";

/** Card 1, "What and when": the name, the start and end (in the community's time zone), and where to start from. */
export function WhatCard({ draft, set, ctx, api, demo, onTemplateCreated }: CardProps & { onTemplateCreated: (id: string) => void }) {
  const dates = dateSuggestions(draft, ctx);
  const likes = draft.id ? [] : startLike(draft, ctx);
  const clashes = clashesFor(draft, ctx);
  const [likedId, setLikedId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [tplState, setTplState] = useState<{ busy: boolean; error: string | null; note: string | null }>({ busy: false, error: null, note: null });

  async function useTemplate() {
    if (!templateId) return setTplState({ busy: false, error: "Choose a template first.", note: null });
    setTplState({ busy: true, error: null, note: null });
    const fd = new FormData();
    fd.set("template_id", templateId);
    fd.set("name", draft.name);
    fd.set("starts_at", draft.starts_at);
    const res = await api.fromTemplate(fd);
    if (!res.ok) return setTplState({ busy: false, error: res.error, note: null });
    if (demo || !res.data?.id) return setTplState({ busy: false, error: null, note: res.message ?? "Draft created from the template." });
    onTemplateCreated(res.data.id);
  }

  return (
    <div className="flex flex-col gap-4">
      <Note tone="ok">The flyer draft and the event page build beside this as you answer. Nothing is published or sent from here.</Note>
      <Field label="Event name">
        {(id) => <input id={id} className="crm-input" maxLength={200} value={draft.name} onChange={(e) => set({ name: e.target.value })} autoComplete="off" />}
      </Field>

      {likes.length ? (
        <div className="flex flex-col gap-2">
          <p className={sectionLabel}>Start like a past event</p>
          {likes.map((s) => (
            <SuggestionButton
              key={s.value.id}
              label={s.label}
              why={s.why}
              source={s.source}
              best={s.best}
              pressed={likedId === s.value.id}
              onPick={() => {
                setLikedId(s.value.id);
                set(likePastEvent(draft, s.value));
              }}
            />
          ))}
        </div>
      ) : null}

      {dates.length ? (
        <div className="flex flex-col gap-2">
          <p className={sectionLabel}>When</p>
          {dates.map((s) => (
            <SuggestionButton
              key={s.value.starts_at}
              label={s.label}
              why={s.why}
              source={s.source}
              best={s.best}
              pressed={draft.starts_at === s.value.starts_at}
              onPick={() => set({ starts_at: s.value.starts_at, ...(s.value.ends_at ? { ends_at: s.value.ends_at } : {}) })}
            />
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Starts">{(id) => <input id={id} type="datetime-local" className="crm-input" value={draft.starts_at} onChange={(e) => set({ starts_at: e.target.value })} />}</Field>
        <Field label="Ends">{(id) => <input id={id} type="datetime-local" className="crm-input" value={draft.ends_at} onChange={(e) => set({ ends_at: e.target.value })} />}</Field>
      </div>
      <p className="crm-hint m-0">Times are in your community&apos;s time zone ({ctx.tz}).</p>
      {clashes.map((c) => (
        <Note key={c.text} tone={c.level === "warn" ? "warn" : "info"}>
          {c.text}
        </Note>
      ))}

      {!draft.id && ctx.templates.length ? (
        <details className="rounded-[12px] border border-line bg-ground px-3.5 py-2.5">
          <summary className="cursor-pointer text-[14px] font-semibold text-ink">Start from a template instead</summary>
          <div className="mt-3 flex flex-col gap-2">
            <p className="crm-hint m-0">Copies the template&apos;s description, event lead and checklist into a new draft with the name and start above.</p>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Template">
                {(id) => (
                  <select id={id} className="crm-input min-w-[220px]" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                    <option value="">Choose a template</option>
                    {ctx.templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <button type="button" className={softButton} disabled={tplState.busy || !draft.name.trim()} onClick={useTemplate}>
                {tplState.busy ? "Creating…" : "Create the draft from it"}
              </button>
            </div>
            {!draft.name.trim() ? <p className="crm-hint m-0">Type the event name first.</p> : null}
            {tplState.error ? <ErrorNote onRetry={useTemplate}>{tplState.error}</ErrorNote> : null}
            {tplState.note ? <Note tone="ok">{tplState.note}</Note> : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}
