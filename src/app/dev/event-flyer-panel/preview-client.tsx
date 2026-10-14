"use client";

// DEV ONLY. The flyer panel with stand-in services: the flyer is really drawn (by the dev render route, no database), and
// approving, publishing and scheduling change only this page's copy of the sample event.

import { useMemo } from "react";

import type { FlyerPanelSetup } from "@/app/(app)/events/flyer-publish-actions";
import { FlyerPanel } from "@/components/event-creator/flyer/flyer-panel";

import { makePreviewServices } from "./preview-services";

export function PreviewFlyerPanel({ initial, kind }: { initial: FlyerPanelSetup; kind: string }) {
  const services = useMemo(() => makePreviewServices(() => initial, { kind }), [initial, kind]);
  const e = initial.event;
  return <FlyerPanel eventId={e.id} name={e.name} startsAt={e.starts_at} venue={e.venue} kindKey="sample" services={services} />;
}
