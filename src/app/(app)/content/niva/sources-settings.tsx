"use client";

import { useState } from "react";

import { ActionForm } from "@/components/action-form";
import { nivaAnswerFromLine, type NivaAnswerFrom } from "@/lib/niva";

import { setNivaAnswerFromAction } from "./actions";

/**
 * G6: what Niva also answers from (centers.rules.niva.answer_from, app.niva_set_answer_from, 0573).
 * Approved Niva sources are always on; the Guide's public sections and published FAQ items are
 * optional. content.manage changes it; content.draft sees what it is.
 */
export function NivaAnswerFromForm({ current, canManage }: { current: NivaAnswerFrom; canManage: boolean }) {
  const [guide, setGuide] = useState(current.guide);
  const [faq, setFaq] = useState(current.faq);

  if (!canManage) {
    return (
      <p className="text-[13px]">
        {nivaAnswerFromLine(current)}
        <span className="block text-[12px] text-muted">A content manager (content.manage) can change this.</span>
      </p>
    );
  }

  const changed = guide !== current.guide || faq !== current.faq;
  return (
    <ActionForm action={setNivaAnswerFromAction} submitLabel={changed ? "Save" : "No changes"} pendingLabel="Saving…" size="sm" submitDisabled={!changed}>
      <fieldset className="mb-3 flex flex-col gap-2">
        <legend className="crm-label">Also answer from</legend>
        <label className="flex items-start gap-2 text-[13px]">
          <input type="checkbox" name="guide" value="1" checked={guide} onChange={(e) => setGuide(e.target.checked)} className="mt-0.5" />
          <span>
            Guide sections
            <span className="block text-[12px] text-muted">The Guide&apos;s public sections (Content › Guide), as members read them in the app.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-[13px]">
          <input type="checkbox" name="faq" value="1" checked={faq} onChange={(e) => setFaq(e.target.checked)} className="mt-0.5" />
          <span>
            FAQ
            <span className="block text-[12px] text-muted">Published FAQ items (Content › Library).</span>
          </span>
        </label>
        <p className="text-[12px] text-muted">The sources above that are marked &ldquo;Included&rdquo; are always used.</p>
      </fieldset>
    </ActionForm>
  );
}
