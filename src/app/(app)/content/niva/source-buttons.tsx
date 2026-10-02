"use client";

import { ActionForm } from "@/components/action-form";

import { retireNivaSourceAction, submitImportedNivaDraftsAction } from "./actions";

/** content.manage: take one source out of Niva (status 'retired'). */
export function RetireNivaSourceButton({ id, title }: { id: string; title: string }) {
  return (
    <ActionForm
      action={retireNivaSourceAction}
      submitLabel="Retire"
      pendingLabel="Retiring…"
      variant="bad"
      size="xs"
      confirmMessage={`Retire "${title}"? Niva stops answering from it straight away. It stays in the list under Show retired, and editing it sends it back through approval.`}
    >
      <input type="hidden" name="id" value={id} />
    </ActionForm>
  );
}

/** content.draft: one imported page's drafts to the Approval queue (they are still approved there). */
export function SendPageForApprovalButton({ sourceUrl, drafts }: { sourceUrl: string; drafts: number }) {
  return (
    <ActionForm
      action={submitImportedNivaDraftsAction}
      submitLabel={`Send ${drafts} draft${drafts === 1 ? "" : "s"} for approval`}
      pendingLabel="Sending…"
      variant="ghost"
      size="xs"
      confirmMessage={`Send this page's ${drafts} draft${drafts === 1 ? "" : "s"} to the Approval queue? Read them first: Niva repeats whatever is approved, and imported pages can contain dates or figures that are out of date.`}
    >
      <input type="hidden" name="source_url" value={sourceUrl} />
    </ActionForm>
  );
}
