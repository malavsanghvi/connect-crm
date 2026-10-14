"use client";

// The creator's flyer slot: the flyer draft and its publish panel (src/components/event-creator/flyer/flyer-panel.tsx), drawn
// the moment card 1 is answered. Keep these props stable: the creator page passes them.

import { FlyerPanel } from "./flyer/flyer-panel";

/**
 * eventId: the draft's id once card 1 is saved (null before). startsAt: the start as the community's wall-clock time
 * ("2026-11-08T18:00", what a flyer prints), or null. kindKey: the organization's kind (session.kind.key); the panel fits the
 * art to the organization's kind on the server. onFlyerChange (optional): called with the event's flyer file once the panel
 * has loaded it and whenever it changes (approving saves the flyer), so the creator's readiness list follows at once.
 */
export type FlyerSlotProps = {
  eventId: string | null;
  name: string;
  startsAt: string | null;
  venue: string | null;
  kindKey: string;
  onFlyerChange?: (flyerPath: string | null) => void;
};

export function FlyerSlot(props: FlyerSlotProps) {
  return (
    <div id="flyer-panel" className="scroll-mt-24" data-flyer-slot={props.eventId ?? "new"}>
      <FlyerPanel {...props} />
    </div>
  );
}
