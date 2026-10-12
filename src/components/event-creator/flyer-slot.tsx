"use client";

// PLACEHOLDER owned by the event creator so its page layout is final. Builder EV-B replaces what this renders with the flyer
// draft panel (drawn the moment card 1 is answered); keep these props stable.

import { Sparkle } from "@/components/niva/sparkle";
import { formatClockText, formatDay } from "@/lib/event-creator/smart";

/**
 * eventId: the draft's id once card 1 is saved (null before). startsAt: the start as the community's wall-clock time
 * ("2026-11-08T18:00", what a flyer prints), or null. kindKey: the organization's kind (session.kind.key), for fitting art.
 */
export type FlyerSlotProps = { eventId: string | null; name: string; startsAt: string | null; venue: string | null; kindKey: string };

function wallClock(local: string | null): string | null {
  const m = local ? /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(local) : null;
  return m ? `${formatDay(m[1], "en")} · ${formatClockText(m[2], "en")}` : null;
}

export function FlyerSlot({ eventId, name, startsAt, venue }: FlyerSlotProps) {
  return (
    <section aria-label="Your flyer draft" className="rounded-[16px] border border-dashed border-line-input bg-white p-4" data-flyer-slot={eventId ?? "new"}>
      <p className="m-0 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">Your flyer draft appears here</p>
      <div className="mx-auto mt-3 flex aspect-[4/5] w-full max-w-[240px] flex-col justify-between rounded-[8px] bg-[linear-gradient(160deg,#16306b,#3a58a6)] p-4 text-white">
        <Sparkle className="h-5 w-5 opacity-80" />
        <div>
          <p className="m-0 font-display text-[22px] font-semibold leading-[1.1]">{name.trim() || "Your event"}</p>
          <p className="m-0 mt-2 text-[13px] opacity-90">{wallClock(startsAt) ?? "Date to come"}</p>
          {venue ? <p className="m-0 text-[13px] opacity-90">{venue}</p> : null}
        </div>
      </div>
      <p className="crm-hint m-0 mt-3 text-center">The flyer maker joins this page next. Until then it is in the Advanced form.</p>
    </section>
  );
}
