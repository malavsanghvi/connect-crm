// The one rule for how an event's status may change. Pure: the Server Action setEventStatus, the command events.set_status
// (so the ⌘K palette and Niva too) and the event page's buttons all read this table, so there is no second copy to drift.
//
// The moves below are exactly the ones the event page offers today (its buttons are built from EVENT_STATUS_BUTTONS):
//   draft -> published (open RSVPs)            published -> rsvp_closed, live          rsvp_closed -> published (reopen), live
//   live -> completed                          completed -> live (reopen)               cancelled -> draft (restore)
//   and a cancel from draft, published, rsvp_closed or live.
// Anything else (draft straight to live, a completed event back to draft, ...) is refused with a sentence that says what is possible.
// The database still accepts any status (connect-admin writes the column directly); see docs/DECISIONS.md if that is ever tightened.

export const EVENT_STATUSES = ["draft", "published", "rsvp_closed", "live", "completed", "cancelled"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export function isEventStatus(v: unknown): v is EventStatus {
  return typeof v === "string" && (EVENT_STATUSES as readonly string[]).includes(v);
}

/** Where each status may go next (not counting staying where it is). */
export const EVENT_STATUS_TRANSITIONS: Record<EventStatus, readonly EventStatus[]> = {
  draft: ["published", "cancelled"],
  published: ["rsvp_closed", "live", "cancelled"],
  rsvp_closed: ["published", "live", "cancelled"],
  live: ["completed", "cancelled"],
  completed: ["live"],
  cancelled: ["draft"],
};

/** A status as a person says it. */
export const EVENT_STATUS_WORDS: Record<EventStatus, string> = {
  draft: "a draft",
  published: "published",
  rsvp_closed: "closed for RSVPs",
  live: "live",
  completed: "completed",
  cancelled: "cancelled",
};

/** The sentence shown after a status change (the same words the event page has always shown). */
export const EVENT_STATUS_MESSAGES: Record<EventStatus, string> = {
  draft: "Back to draft.",
  published: "Published · RSVPs open in the member app",
  rsvp_closed: "RSVPs closed.",
  live: "Event is live — check-in is open.",
  completed: "Marked completed.",
  cancelled: "Event cancelled.",
};

export function allowedNextStatuses(from: string): readonly EventStatus[] {
  return isEventStatus(from) ? EVENT_STATUS_TRANSITIONS[from] : [];
}

export function canMoveEventStatus(from: string, to: string): boolean {
  return from === to || (isEventStatus(from) && isEventStatus(to) && EVENT_STATUS_TRANSITIONS[from].includes(to));
}

export type StatusCheck = { ok: true; same: boolean } | { ok: false; error: string };

/**
 * May an event go from `from` to `to`? Staying where it is is allowed (nothing changes). A refusal says what the event can do instead,
 * in a sentence written for the person, without the "Could not …" start (the caller adds it).
 */
export function checkEventTransition(from: string, to: string): StatusCheck {
  if (!isEventStatus(to)) return { ok: false, error: "that is not a status an event can have." };
  if (!isEventStatus(from)) return { ok: true, same: false };
  if (from === to) return { ok: true, same: true };
  if (EVENT_STATUS_TRANSITIONS[from].includes(to)) return { ok: true, same: false };
  const options = EVENT_STATUS_TRANSITIONS[from].map((s) => EVENT_STATUS_WORDS[s]);
  const where = options.length === 1 ? options[0] : `${options.slice(0, -1).join(", ")} or ${options[options.length - 1]}`;
  return { ok: false, error: `the event is ${EVENT_STATUS_WORDS[from]}, so it cannot go straight to ${EVENT_STATUS_WORDS[to]}. From here it can go to ${where}.` };
}

// ---------------------------------------------------------------------------
// The event page's buttons
// ---------------------------------------------------------------------------
export type StatusButtonVariant = "primary" | "ghost" | "ok" | "bad";
export type StatusButton = { to: EventStatus; label: string; variant: StatusButtonVariant; confirm?: string };

/** The buttons shown above an event's tabs, by its current status. "Cancel event" is separate (see EVENT_CANCEL_BUTTON). */
export const EVENT_STATUS_BUTTONS: Record<EventStatus, readonly StatusButton[]> = {
  draft: [{ to: "published", label: "Publish (open RSVPs)", variant: "primary", confirm: "Publish this event? Members will be able to RSVP in the app." }],
  published: [
    { to: "rsvp_closed", label: "Close RSVPs", variant: "ghost" },
    { to: "live", label: "Go live (event day)", variant: "ok", confirm: "Go live? Check-in opens in volunteer mode." },
  ],
  rsvp_closed: [
    { to: "published", label: "Reopen RSVPs", variant: "ghost" },
    { to: "live", label: "Go live (event day)", variant: "ok", confirm: "Go live? Check-in opens in volunteer mode." },
  ],
  live: [{ to: "completed", label: "Mark completed", variant: "ghost" }],
  completed: [{ to: "live", label: "Reopen as live", variant: "ghost" }],
  cancelled: [{ to: "draft", label: "Restore as draft", variant: "ghost" }],
};

export const EVENT_CANCEL_BUTTON: StatusButton = { to: "cancelled", label: "Cancel event", variant: "bad", confirm: "Cancel this event? RSVPs stay on record." };
