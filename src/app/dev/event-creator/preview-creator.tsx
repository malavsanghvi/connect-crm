"use client";

// DEV ONLY. The guided event creator with stand-in actions: nothing reaches a database. Saving answers "Preview only", a new
// draft gets a made-up id, and added shifts or checklist items appear in this page's memory so the cards can be looked at.

import { useState } from "react";

import type { CreatorApi } from "@/components/event-creator/api";
import { EventCreator } from "@/components/event-creator/event-creator";
import type { CardId, CreatorCtx, CreatorExisting, EventDraft } from "@/lib/event-creator/types";
import { fromDateTimeLocal } from "@/lib/events/format";

export function PreviewCreator({ ctx, draft, existing, step }: { ctx: CreatorCtx; draft: EventDraft; existing: CreatorExisting; step?: CardId }) {
  const [state, setState] = useState(existing);
  const api: CreatorApi = {
    save: async (id) => ({ ok: true, message: "Preview only: nothing was saved", data: { id: id ?? "preview-event" } }),
    fromTemplate: async () => ({ ok: true, message: "Preview only: a real page would open the new draft from the template." }),
    createShift: async (_id, _p, fd) => {
      const s = String(fd.get("starts_at") ?? "");
      const e = String(fd.get("ends_at") ?? "");
      setState((cur) => ({
        ...cur,
        shifts: [
          ...cur.shifts,
          { id: `s-${cur.shifts.length + 1}`, station: String(fd.get("station")), notes: String(fd.get("notes") ?? ""), capacity: Number(fd.get("capacity")) || 1, starts_at: fromDateTimeLocal(s, ctx.tz), ends_at: fromDateTimeLocal(e, ctx.tz) },
        ],
      }));
      return { ok: true, message: "Shift added." };
    },
    generateLunchSlots: async () => {
      setState((cur) => ({ ...cur, lunchSlots: 9 }));
      return { ok: true, message: "9 slots created." };
    },
    addChecklistAction: async (_id, _p, fd) => {
      setState((cur) => ({ ...cur, checklist: [...cur.checklist, { id: `a-${cur.checklist.length + 1}`, name: String(fd.get("name")), phase: String(fd.get("phase")), due_on: (fd.get("due_on") as string) || null, state: "not_started" }] }));
      return { ok: true, message: "Action added." };
    },
    draftReminder: async () => ({ ok: false, error: "Preview only: reminders are drafted from a saved event on the real page." }),
  };
  return <EventCreator ctx={ctx} initialDraft={draft} existing={state} api={api} initialStep={step} demo />;
}
