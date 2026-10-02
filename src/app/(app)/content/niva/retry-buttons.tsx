"use client";

import { ActionForm } from "@/components/action-form";

import { retryAllUnansweredNivaAction, retryNivaQuestionsAction } from "./actions";

/** content.manage: "Try again (N)" for every member who asked the same unanswered question (niva_regenerate each). */
export function RetryQuestionGroupButton({ ids }: { ids: string[] }) {
  return (
    <ActionForm action={retryNivaQuestionsAction} submitLabel={`Try again (${ids.length})`} pendingLabel="Queuing…" variant="ghost" size="xs">
      <input type="hidden" name="ids" value={ids.join(",")} />
    </ActionForm>
  );
}

/** content.manage: app.niva_retry_unanswered: every unanswered question of the last 30 days, 2 seconds apart. */
export function RetryAllUnansweredButton({ size = "sm" }: { size?: "xs" | "sm" }) {
  return (
    <ActionForm
      action={retryAllUnansweredNivaAction}
      submitLabel="Try all unanswered questions again"
      pendingLabel="Queuing…"
      variant="ghost"
      size={size}
      confirmMessage="Try every unanswered question from the last 30 days again? Each one goes to the AI service again, a couple of seconds apart (at most 150 at a time). Questions already on their way are left to finish, and none of this counts toward the monthly question limit."
    />
  );
}
