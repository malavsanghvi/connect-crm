"use server";

import type { AudiencePreviewData } from "@/lib/commands/catalog/events/audience";
import type { EventChange } from "@/lib/commands/catalog/events/change";
import type { CloneView } from "@/lib/commands/catalog/events/clone";
import { runScreenCommand } from "@/lib/commands/screen";
import type { ActionResult } from "@/lib/errors";

// The new-look event page's three Niva cards, as thin wrappers over the Events commands (one code path with the ⌘K palette and
// Niva). All three only prepare or count: nothing is changed, saved or sent from here. Changing the event or saving the copy is a
// confirm-level command that only ever becomes a card the person confirms in Niva's panel, and only when the community switched it on.

/** "Change one thing": the before and after of one detail (events.draft_change). Changes nothing. */
export async function draftEventChangeAction(eventId: string, field: string, value: string): Promise<ActionResult<EventChange>> {
  return runScreenCommand<EventChange>("events.draft_change", { event_id: eventId, field, value }, "show the change");
}

/** "Copy this event to a new date": what the copy would look like (events.clone_draft). Saves nothing. */
export async function draftCloneAction(eventId: string, newDate: string, name: string): Promise<ActionResult<CloneView>> {
  const named = name.trim();
  return runScreenCommand<CloneView>("events.clone_draft", { event_id: eventId, new_date: newDate, ...(named ? { name: named } : {}) }, "prepare the copy");
}

/** The reminder's audience for another send time, with what quiet hours would do (events.audience_preview). Counts only; sends nothing. */
export async function audienceAtAction(eventId: string, sendAt: string): Promise<ActionResult<AudiencePreviewData>> {
  const at = sendAt.trim();
  return runScreenCommand<AudiencePreviewData>("events.audience_preview", { event_id: eventId, who: "reminder", ...(at ? { send_at: at } : {}) }, "count who the reminder would reach");
}
