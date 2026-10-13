"use server";

import { unstable_rethrow } from "next/navigation";

import { eventActionContext } from "@/lib/data/events";
import { failure } from "@/lib/errors";
import { FormError } from "@/lib/events/forms";
import { isModuleEnabled } from "@/lib/modules";
import { mayAddToAnyEvent, mayAddToEvent, type AddLoad, type AddResult } from "@/lib/people-v2/event-add";
import { addToEvent, loadAddChoices } from "@/lib/people-v2/event-add-server";
import { NO_ACCESS_TEXT } from "@/lib/people-v2/slideover";

// "Add to an event" on the Family page's Events tab and in the person slide-over's Events section. Two thin Server Actions: they start
// where every Events action starts (eventActionContext: the session, the person's event roles, the gate), then hand over to the plain
// module that reads and writes (src/lib/people-v2/event-add-server.ts). The gate is the one that already guards editing an event: event
// managers, and the event's lead for that event; a role without it is told "You don't have access to this area".
//
// There is no activity key for these: a key needs a row in the activity catalog, which is a migration. The writes themselves are audited
// as the signed-in person like every other change to an RSVP and its people.

export type AddToEventLoadCall = { householdId: string };
export type AddToEventCall = { householdId: string; eventId: string; personIds: string[]; confirmed?: boolean };

const OFF = "Events are switched off for this community.";

function refusal(error: unknown, doing: string): { kind: "access" | "other"; error: string } {
  unstable_rethrow(error);
  if (error instanceof FormError) {
    if (error.message === NO_ACCESS_TEXT) return { kind: "access", error: NO_ACCESS_TEXT };
    const m = error.message;
    return { kind: "other", error: `${doing} — ${m.charAt(0).toLowerCase()}${m.slice(1)}` };
  }
  return { kind: "other", error: failure(doing, error).error };
}

export async function loadAddToEventAction(input: AddToEventLoadCall): Promise<AddLoad> {
  const doing = "Could not load the events";
  try {
    const ctx = await eventActionContext(mayAddToAnyEvent, NO_ACCESS_TEXT);
    if (!isModuleEnabled(ctx.session, "events")) return { ok: false, kind: "other", error: `${doing} — ${OFF.charAt(0).toLowerCase()}${OFF.slice(1)}` };
    return await loadAddChoices({ session: ctx.session, access: ctx.access }, { householdId: input?.householdId });
  } catch (error) {
    return { ok: false, ...refusal(error, doing) };
  }
}

export async function addToEventAction(input: AddToEventCall): Promise<AddResult> {
  const doing = "Could not add them to the event";
  try {
    const eventId = typeof input?.eventId === "string" ? input.eventId : "";
    const ctx = await eventActionContext((a) => mayAddToEvent(a, eventId), NO_ACCESS_TEXT);
    if (!isModuleEnabled(ctx.session, "events")) return { ok: false, kind: "other", error: `${doing} — ${OFF.charAt(0).toLowerCase()}${OFF.slice(1)}` };
    return await addToEvent(
      { session: ctx.session, access: ctx.access },
      { householdId: input?.householdId, eventId, personIds: Array.isArray(input?.personIds) ? input.personIds : [], confirmed: input?.confirmed === true },
    );
  } catch (error) {
    return { ok: false, ...refusal(error, doing) };
  }
}
