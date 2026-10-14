// DEV ONLY. Stand-in services for the flyer panel in the dev previews (/dev/event-flyer-panel and /dev/event-creator): the
// flyer is really drawn by the dev render route (no database), and approving, publishing and scheduling change only this
// page's copy of the sample event.

import { readFlyerAnswer } from "@/app/(app)/events/builder/flyer-panel";
import type { FlyerPanelSetup } from "@/app/(app)/events/flyer-publish-actions";
import type { FlyerPanelServices } from "@/components/event-creator/flyer/flyer-panel";
import { flyerMadeFor } from "@/lib/events/flyer";
import { fromDateTimeLocal } from "@/lib/events/format";
import { makeFlyerApproval } from "@/lib/events/publish-schedule";

/** `setupFor` gives the sample event's setup the first time an event id is loaded; later loads answer this page's copy. */
export function makePreviewServices(setupFor: (eventId: string) => FlyerPanelSetup, art: { kind: string; org?: string }): FlyerPanelServices {
  const copies = new Map<string, FlyerPanelSetup>();
  const get = (id: string) => {
    if (!copies.has(id)) copies.set(id, setupFor(id));
    return copies.get(id)!;
  };
  const update = (id: string, patch: Partial<FlyerPanelSetup["event"]>) => {
    const cur = get(id);
    copies.set(id, { ...cur, event: { ...cur.event, ...patch } });
  };
  return {
    load: async (id) => ({ ok: true, data: get(id) }),
    render: async (_id, design, signal) =>
      readFlyerAnswer(
        await fetch("/dev/event-flyer-panel/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ design, kind: art.kind, org: art.org }), signal }),
      ),
    approve: async (id, design) => {
      const e = get(id).event;
      update(id, { flyer_source: "designed", flyer_path: "dev/flyer.png", flyer_design: JSON.parse(JSON.stringify({ ...design, made_for: flyerMadeFor(e), approval: makeFlyerApproval(design, e.name, "dev-user") })) });
      return { ok: true, message: "Flyer approved." };
    },
    withdraw: async (id) => {
      const d = { ...((get(id).event.flyer_design as Record<string, unknown>) ?? {}) };
      delete d.approval;
      update(id, { flyer_design: JSON.parse(JSON.stringify(d)), publish_at: null });
      return { ok: true, message: "Approval withdrawn." };
    },
    publishNow: async (id) => {
      update(id, { status: "published", publish_at: null, publish_failure: null });
      return { ok: true, message: "Published · RSVPs open in the member app" };
    },
    schedule: async (id, local) => {
      const iso = fromDateTimeLocal(local, get(id).tz);
      if (!iso) return { ok: false, error: "Could not schedule the publish — pick a date and time to publish." };
      update(id, { publish_at: iso, publish_failure: null });
      return { ok: true, message: "Scheduled. It will be published at that time, after the same checks.", data: { publishAt: iso } };
    },
    cancelSchedule: async (id) => {
      update(id, { publish_at: null });
      return { ok: true, message: "Schedule cancelled. The event stays a draft." };
    },
  };
}
