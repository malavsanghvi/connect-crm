import { describe, expect, it } from "vitest";

import {
  EVENT_CANCEL_BUTTON,
  EVENT_STATUSES,
  EVENT_STATUS_BUTTONS,
  EVENT_STATUS_MESSAGES,
  EVENT_STATUS_TRANSITIONS,
  allowedNextStatuses,
  canMoveEventStatus,
  checkEventTransition,
} from "@/lib/events/status-machine";

describe("the event status rule", () => {
  it("knows the six statuses the database accepts", () => {
    expect([...EVENT_STATUSES]).toEqual(["draft", "published", "rsvp_closed", "live", "completed", "cancelled"]);
  });

  it("allows every move the event page offers today (its buttons are built from the same table)", () => {
    for (const from of EVENT_STATUSES) {
      for (const button of EVENT_STATUS_BUTTONS[from]) {
        expect(canMoveEventStatus(from, button.to), `${from} -> ${button.to}`).toBe(true);
      }
    }
    // The cancel button is shown from draft, published, rsvp_closed and live, never from completed or cancelled.
    expect(EVENT_STATUSES.filter((s) => allowedNextStatuses(s).includes(EVENT_CANCEL_BUTTON.to))).toEqual(["draft", "published", "rsvp_closed", "live"]);
  });

  it("is exactly the moves found in the screens, no more", () => {
    const moves = EVENT_STATUSES.flatMap((from) => EVENT_STATUS_TRANSITIONS[from].map((to) => `${from}>${to}`));
    expect(moves).toEqual([
      "draft>published",
      "draft>cancelled",
      "published>rsvp_closed",
      "published>live",
      "published>cancelled",
      "rsvp_closed>published",
      "rsvp_closed>live",
      "rsvp_closed>cancelled",
      "live>completed",
      "live>cancelled",
      "completed>live",
      "cancelled>draft",
    ]);
  });

  it("refuses the rest with a sentence that says what is possible", () => {
    const draftToLive = checkEventTransition("draft", "live");
    expect(draftToLive).toEqual({ ok: false, error: "the event is a draft, so it cannot go straight to live. From here it can go to published or cancelled." });
    expect(checkEventTransition("completed", "draft")).toEqual({ ok: false, error: "the event is completed, so it cannot go straight to a draft. From here it can go to live." });
    expect(checkEventTransition("cancelled", "published")).toMatchObject({ ok: false });
    expect(checkEventTransition("published", "completed")).toMatchObject({ ok: false });
    expect(checkEventTransition("live", "published")).toMatchObject({ ok: false });
    expect(checkEventTransition("rsvp_closed", "draft")).toMatchObject({ ok: false });
    const closed = checkEventTransition("rsvp_closed", "completed");
    expect(closed).toEqual({ ok: false, error: "the event is closed for RSVPs, so it cannot go straight to completed. From here it can go to published, live or cancelled." });
  });

  it("lets an event stay where it is (nothing changes), as the action always did", () => {
    for (const s of EVENT_STATUSES) expect(checkEventTransition(s, s)).toEqual({ ok: true, same: true });
  });

  it("refuses a word that is not a status, and does not judge a status it has never heard of", () => {
    expect(checkEventTransition("draft", "archived")).toEqual({ ok: false, error: "that is not a status an event can have." });
    expect(checkEventTransition("archived", "published")).toEqual({ ok: true, same: false });
    expect(allowedNextStatuses("archived")).toEqual([]);
  });

  it("says the same words after a change as the event page always has", () => {
    expect(EVENT_STATUS_MESSAGES).toEqual({
      draft: "Back to draft.",
      published: "Published · RSVPs open in the member app",
      rsvp_closed: "RSVPs closed.",
      live: "Event is live — check-in is open.",
      completed: "Marked completed.",
      cancelled: "Event cancelled.",
    });
  });
});
