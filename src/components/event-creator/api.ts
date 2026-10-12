// What the guided event creator calls. On the real page these are the Events Server Actions themselves (the builder's own
// write paths: saveEventDraftInPlace, createEventFromTemplateInPlace, createShift, generateLunchSlots, addChecklistAction) and
// one draft-only command wrapper; the dev preview passes stand-ins that save nothing.

import type { DraftReminderData } from "@/lib/commands/catalog/messages-draft-reminder";
import type { ActionResult } from "@/lib/errors";

export type CreatorApi = {
  save: (eventId: string | null, fd: FormData) => Promise<ActionResult<{ id: string }>>;
  fromTemplate: (fd: FormData) => Promise<ActionResult<{ id: string }>>;
  createShift: (eventId: string, prev: null, fd: FormData) => Promise<ActionResult<unknown>>;
  generateLunchSlots: (eventId: string, prev: null, fd: FormData) => Promise<ActionResult<unknown>>;
  addChecklistAction: (eventId: string, prev: null, fd: FormData) => Promise<ActionResult<unknown>>;
  draftReminder: (eventId: string) => Promise<ActionResult<DraftReminderData>>;
};
