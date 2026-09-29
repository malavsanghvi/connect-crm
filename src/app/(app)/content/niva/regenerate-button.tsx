"use client";

import { ActionForm } from "@/components/action-form";

import { regenerateNivaAnswerAction } from "./actions";

/** content.manage: re-run Niva's answering job for one past question (app.niva_regenerate). */
export function RegenerateNivaAnswerButton({ conversationId }: { conversationId: string }) {
  return (
    <ActionForm action={regenerateNivaAnswerAction} submitLabel="Regenerate" pendingLabel="Regenerating…" variant="ghost" size="xs">
      <input type="hidden" name="conversation_id" value={conversationId} />
    </ActionForm>
  );
}
