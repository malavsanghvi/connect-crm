"use client";

import { useState } from "react";

import { ActionForm } from "@/components/action-form";
import { NIVA_AI_CHOICES, nivaAiLine, type NivaAiMode } from "@/lib/niva";

import { setNivaAiAction } from "./actions";

/**
 * Owner decision 2026-10-02 (0579): Niva answers from the community's own approved content, at no AI cost, and only
 * asks an AI model (Claude Haiku) when a community turns AI answers on. Stored in centers.rules.niva.ai through the
 * shared rules writer (versioned, so it never saves over someone else's change); changing it needs settings.manage,
 * like every other rule. Everyone else on Content › Niva sees what it is.
 */
export function NivaAiForm({ current, version, canChange }: { current: NivaAiMode; version: number | null; canChange: boolean }) {
  const [choice, setChoice] = useState<NivaAiMode>(current);

  if (!canChange) {
    return (
      <p className="text-[13px]">
        {nivaAiLine(current)}
        <span className="block text-[12px] text-muted">An administrator (settings.manage) can change this.</span>
      </p>
    );
  }

  const changed = choice !== current;
  return (
    <ActionForm
      action={setNivaAiAction}
      submitLabel={changed ? "Save" : "No changes"}
      pendingLabel="Saving…"
      size="sm"
      submitDisabled={!changed}
      confirmMessage={
        changed && choice === "haiku"
          ? "With AI answers on, each question your approved content cannot answer is sent to Claude Haiku, which costs a little per question. Turn AI answers on?"
          : undefined
      }
    >
      <input type="hidden" name="version" value={version === null ? "" : String(version)} />
      <fieldset className="mb-3 flex flex-col gap-2">
        <legend className="crm-label">AI answers</legend>
        {NIVA_AI_CHOICES.map((c) => (
          <label key={c.value} className="flex items-start gap-2 text-[13px]">
            <input type="radio" name="ai" value={c.value} checked={choice === c.value} onChange={() => setChoice(c.value)} className="mt-0.5" />
            <span>
              {c.label}
              <span className="block text-[12px] text-muted">{c.detail}</span>
            </span>
          </label>
        ))}
        <p className="text-[12px] text-muted">
          Either way Niva first answers from your approved content: an earlier answer to the same question, a matching FAQ, or the
          sentences of the source that answers it. Those answers are instant and free.
        </p>
      </fieldset>
    </ActionForm>
  );
}
