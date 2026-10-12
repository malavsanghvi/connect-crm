"use client";

// DEV ONLY. The flyer panel with stand-in services: the flyer is really drawn (by the dev render route, no database), and
// approving, publishing and scheduling change only this page's copy of the sample event.

import { useMemo, useRef } from "react";

import { readFlyerAnswer } from "@/app/(app)/events/builder/flyer-panel";
import type { FlyerPanelSetup } from "@/app/(app)/events/flyer-publish-actions";
import { FlyerPanel, type FlyerPanelServices } from "@/components/event-creator/flyer/flyer-panel";
import { flyerMadeFor } from "@/lib/events/flyer";
import { fromDateTimeLocal } from "@/lib/events/format";
import { makeFlyerApproval } from "@/lib/events/publish-schedule";

export function PreviewFlyerPanel({ initial, kind }: { initial: FlyerPanelSetup; kind: string }) {
  const ref = useRef(initial);
  const services = useMemo<FlyerPanelServices>(() => {
    const update = (patch: Partial<FlyerPanelSetup["event"]>) => {
      ref.current = { ...ref.current, event: { ...ref.current.event, ...patch } };
    };
    return {
      load: async () => ({ ok: true, data: ref.current }),
      render: async (_id, design, signal) =>
        readFlyerAnswer(await fetch("/dev/event-flyer-panel/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ design, kind }), signal })),
      approve: async (_id, design) => {
        const e = ref.current.event;
        update({ flyer_source: "designed", flyer_path: "dev/flyer.png", flyer_design: JSON.parse(JSON.stringify({ ...design, made_for: flyerMadeFor(e), approval: makeFlyerApproval(design, e.name, "dev-user") })) });
        return { ok: true, message: "Flyer approved." };
      },
      withdraw: async () => {
        const d = { ...((ref.current.event.flyer_design as Record<string, unknown>) ?? {}) };
        delete d.approval;
        update({ flyer_design: JSON.parse(JSON.stringify(d)), publish_at: null });
        return { ok: true, message: "Approval withdrawn." };
      },
      publishNow: async () => {
        update({ status: "published", publish_at: null, publish_failure: null });
        return { ok: true, message: "Published · RSVPs open in the member app" };
      },
      schedule: async (_id, local) => {
        const iso = fromDateTimeLocal(local, ref.current.tz);
        if (!iso) return { ok: false, error: "Could not schedule the publish — pick a date and time to publish." };
        update({ publish_at: iso, publish_failure: null });
        return { ok: true, message: "Scheduled. It will be published at that time, after the same checks.", data: { publishAt: iso } };
      },
      cancelSchedule: async () => {
        update({ publish_at: null });
        return { ok: true, message: "Schedule cancelled. The event stays a draft." };
      },
    };
  }, [kind]);
  const e = initial.event;
  return <FlyerPanel eventId={e.id} name={e.name} startsAt={e.starts_at} venue={e.venue} kindKey="sample" services={services} />;
}
