"use server";

import { revalidatePath } from "next/cache";

import { eventActionContext } from "@/lib/data/events";
import type { ActionResult } from "@/lib/errors";
import { eventAreas } from "@/lib/events/access";
import { FormError, must, oneOf, runAction } from "@/lib/events/forms";
import { CONTACT_MODE_LABEL, CONTACT_MODES, eventIneligibleReason, readEventMode } from "@/lib/rsvp-contact";

// RSVP without signing in, on the event (docs/RSVP_WITHOUT_LOGIN.md): the event's own switch, and "Mark verified" for one RSVP.
// Both are done as the signed-in person, so row level security and the database's own checks decide; a refusal comes back in the
// database's own plain sentence ("RSVP without signing in is for free events only..."), next to the control.

type Result = ActionResult<unknown>;

const DENIED = "only event managers and this event's lead can change it.";

function revalidateEvents() {
  revalidatePath("/events", "layout");
}

/** The event's switch: off, with a code, or without one. The database keeps it inside what the community allows and inside free, public events. */
export async function setContactRsvp(eventId: string, _prev: Result | null, fd: FormData): Promise<Result> {
  return runAction("events.setContactRsvp", "change RSVP without signing in", async () => {
    const { db } = await eventActionContext((a) => eventAreas.edit(a, eventId), DENIED);
    const mode = oneOf(fd, "mode", CONTACT_MODES, "choice");
    const res = must(
      await db.from("events").update({ contact_rsvp: mode }).eq("id", eventId).select("id, contact_rsvp, is_paid, confidential, audience"),
      "change RSVP without signing in",
    );
    if (!res?.length) throw new FormError("you can't change this event, or it no longer exists.");
    const saved = readEventMode(res[0].contact_rsvp);
    if (saved !== mode) {
      // The database turns the switch back off for an event that no longer qualifies; say why instead of pretending it was saved.
      throw new FormError(eventIneligibleReason(res[0]) ?? "the event cannot use it right now.");
    }
    revalidateEvents();
    return {
      ok: true,
      message: mode === "off" ? "RSVP without signing in is off for this event" : `RSVP without signing in is on for this event: ${CONTACT_MODE_LABEL[mode].toLowerCase()}`,
    };
  });
}

/**
 * "Mark verified": the family has been checked with (a call, a message), so the RSVP no longer counts against the places held for RSVPs made
 * without signing in. app.rsvp_contact_verify_staff checks the role again (events.manage or the event's lead), keeps the reason in the audit log.
 */
export async function verifyContactRsvp(eventId: string, rsvpId: string, _prev: Result | null, fd: FormData): Promise<Result> {
  void fd;
  return runAction("events.verifyContactRsvp", "mark the RSVP verified", async () => {
    const { db } = await eventActionContext((a) => eventAreas.edit(a, eventId), "only event managers and this event's lead can mark an RSVP verified.");
    const found = must(await db.from("rsvps").select("id").eq("id", rsvpId).eq("event_id", eventId).maybeSingle(), "find the RSVP");
    if (!found) throw new FormError("that RSVP is not on this event, or you can't see it.");
    must(await db.rpc("rsvp_contact_verify_staff", { p_rsvp: rsvpId, p_reason: "Checked with the family, marked verified on the event's RSVPs tab" }), "mark the RSVP verified");
    revalidateEvents();
    return { ok: true, message: "Marked verified · it no longer counts against the places held for RSVPs made without signing in" };
  });
}
