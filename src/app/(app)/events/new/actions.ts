"use server";

import type { DraftReminderData } from "@/lib/commands/catalog/messages-draft-reminder";
import { runScreenCommand } from "@/lib/commands/screen";
import type { ActionResult } from "@/lib/errors";

// The guided event creator's one extra call, a thin wrapper over a command (one code path with the ⌘K palette and Niva).
// It only prepares text: nothing is saved, scheduled or sent.

/** The reminder for this draft in every language the community uses (messages.draft_reminder). Sends nothing. */
export async function draftEventReminderAction(eventId: string): Promise<ActionResult<DraftReminderData>> {
  return runScreenCommand<DraftReminderData>("messages.draft_reminder", { event_id: eventId, kind: "event_reminder", language: "all" }, "draft the reminder");
}
