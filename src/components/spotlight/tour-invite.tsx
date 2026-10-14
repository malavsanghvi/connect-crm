"use client";

import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import { SPOTLIGHT_TEXT as T } from "@/lib/spotlight/copy";
import type { TourDef } from "@/lib/spotlight/types";

import { useSpotlight } from "./spotlight-provider";

const SIZE = "min-h-[44px]";

export type InviteTour = Pick<TourDef, "id" | "title" | "summary" | "minutes">;

/**
 * The invitation on Home: an offer, never a forced overlay. Three plain ways to answer: take the tour, "Not now" (never offered on
 * its own again) or "Don't show tours again" (no invitation anywhere until the person turns tours back on from the Tour menu).
 */
export function TourInviteView({
  tours,
  onStart,
  onNotNow,
  onNever,
}: {
  tours: readonly InviteTour[];
  onStart: (tourId: string) => void;
  onNotNow: (tourId: string) => void;
  onNever: () => void;
}) {
  const tour = tours[0];
  if (!tour) return null;
  return (
    <section
      aria-labelledby="tour-invite-title"
      data-testid="tour-invite"
      className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[14px] border border-saffron-200 bg-saffron-50 px-4 py-3.5"
    >
      <div className="min-w-0 flex-1 basis-72">
        <p className="m-0 text-[12px] font-bold uppercase tracking-[0.04em] text-brown">
          {T.inviteKicker} · {T.inviteMinutes(tour.minutes)}
        </p>
        <h2 id="tour-invite-title" className="m-0 mt-0.5 font-display text-[19px] font-semibold leading-snug text-navy">
          {T.inviteTitle}: {tour.title}
        </h2>
        <p className="m-0 mt-1 text-[14px] leading-snug text-ink-2">
          {tour.summary} {T.inviteReadOnly}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => onStart(tour.id)} data-testid="tour-invite-start" className={`${buttonClass("primary")} ${SIZE}`}>
          {T.inviteStart}
        </button>
        <button type="button" onClick={() => onNotNow(tour.id)} data-testid="tour-invite-not-now" className={`${buttonClass("ghost")} ${SIZE}`}>
          {T.inviteNotNow}
        </button>
        <button type="button" onClick={onNever} data-testid="tour-invite-never" className={`${buttonClass("plain")} ${SIZE} text-[14px] font-bold underline underline-offset-2`}>
          {T.inviteNever}
        </button>
      </div>
    </section>
  );
}

/** The invitation, connected: shows only for a person who has a tour they never started, while tours are on. Everyone else gets nothing. */
export function TourInvite() {
  const spotlight = useSpotlight();
  const toast = useToast();
  if (!spotlight.loaded || spotlight.active || spotlight.invitations.length === 0) return null;
  // A choice the browser would not keep still holds for this page; say plainly that it may come back, never nothing.
  const warn = (ok: boolean) => {
    if (!ok) toast?.show(T.notRemembered, "bad");
  };
  return (
    <TourInviteView
      tours={spotlight.invitations}
      onStart={spotlight.start}
      onNotNow={(id) => warn(spotlight.decline(id).ok)}
      onNever={() => warn(spotlight.setToursOff(true).ok)}
    />
  );
}
