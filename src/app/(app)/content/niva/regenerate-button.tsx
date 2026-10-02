"use client";

import { ActionForm } from "@/components/action-form";

import { regenerateNivaAnswerAction } from "./actions";

/**
 * content.manage: re-run Niva's answering job for one past question (app.niva_regenerate).
 * "Regenerate" when the question has an answer, "Try again" when it has none.
 */
export function RegenerateNivaAnswerButton({ conversationId, answered }: { conversationId: string; answered: boolean }) {
  return (
    <ActionForm
      action={regenerateNivaAnswerAction}
      submitLabel={answered ? "Regenerate" : "Try again"}
      pendingLabel={answered ? "Regenerating…" : "Queuing…"}
      variant="ghost"
      size="xs"
    >
      <input type="hidden" name="conversation_id" value={conversationId} />
      <input type="hidden" name="answered" value={answered ? "1" : "0"} />
    </ActionForm>
  );
}
