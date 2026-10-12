"use client";

// DEV ONLY. The guided event creator with stand-in actions: nothing reaches a database. Saving answers "Preview only", a new
// draft gets a made-up id, and added shifts or checklist items appear in this page's memory so the cards can be looked at.

import { useMemo, useState } from "react";

import type { CreatorApi } from "@/components/event-creator/api";
import { EventCreator } from "@/components/event-creator/event-creator";
import { FlyerServicesProvider } from "@/components/event-creator/flyer/flyer-panel";
import type { CardId, CreatorCtx, CreatorExisting, EventDraft } from "@/lib/event-creator/types";
import { fromDateTimeLocal } from "@/lib/events/format";

import { brandForKind, previewKindProfile, setupForEvent } from "../event-flyer-panel/fixtures";
import { makePreviewServices } from "../event-flyer-panel/preview-services";

/** The sample brand kit and drawn art for the creator's communities (the flyer panel's dev fixtures). */
const RENDER_KIND: Record<string, string> = { hindu_temple: "temple", church: "church", chamber_of_commerce: "chamber", club: "club" };

export function PreviewCreator({ ctx, draft, existing, step, pane }: { ctx: CreatorCtx; draft: EventDraft; existing: CreatorExisting; step?: CardId; pane?: "questions" | "preview" }) {
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
  // The real flyer panel sits in the slot, with stand-in services: the flyer is really drawn by the dev render route.
  const flyer = useMemo(() => {
    const kind = RENDER_KIND[ctx.community.kindKey] ?? "church";
    return makePreviewServices(
      (id) =>
        setupForEvent(
          {
            org: ctx.community.name,
            tz: ctx.tz,
            brand: brandForKind(kind),
            tradition: kind === "temple",
            kind: previewKindProfile(kind),
            art: { readiness: { state: "ready", model: "gemini-3.1-flash-image", cents: 4 }, entries: [], problem: null },
            event: {
              id,
              name: draft.name,
              description: draft.description,
              venue: draft.venue,
              starts_at: fromDateTimeLocal(draft.starts_at, ctx.tz) ?? new Date().toISOString(),
              ends_at: fromDateTimeLocal(draft.ends_at, ctx.tz) ?? fromDateTimeLocal(draft.starts_at, ctx.tz) ?? new Date().toISOString(),
              audience: draft.audience,
            },
          },
          "draft",
        ),
      { kind, org: ctx.community.name },
    );
  }, [ctx, draft]);
  return (
    <FlyerServicesProvider services={flyer}>
      <EventCreator ctx={ctx} initialDraft={draft} existing={state} api={api} initialStep={step} demo initialPane={pane} />
    </FlyerServicesProvider>
  );
}
