import "server-only";

import { loadEventAccess } from "@/lib/data/events";
import { isModuleEnabled } from "@/lib/modules";
import { canAccess } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

import { mayAddToAnyEvent, type AddSetup } from "./event-add";
import { addToEventProps } from "./event-add-props";
import type { FamilyModel } from "./family-model";

/**
 * Whether a page offers "Add to an event", and with what. Only with the Events module on and a role that can read events; then the
 * control when the role may add to at least one event (the gate that edits an event: event managers and an event's lead), otherwise a
 * note that this role may only look. A person in no family cannot be added from here. Convenience only: the Server Action and row level
 * security decide.
 */
export async function eventAddSetup(session: CrmSession, model: FamilyModel | null, openedFrom: string | null): Promise<AddSetup> {
  if (!isModuleEnabled(session, "events") || !canAccess(session, "events")) return { kind: "none" };
  if (!model) return { kind: "no-family" };
  if (model.mergedIntoId) return { kind: "none" };
  const access = await loadEventAccess(session);
  if (!mayAddToAnyEvent(access)) return { kind: "view-only" };
  return { kind: "add", props: addToEventProps(model, openedFrom, session.center.time_zone) };
}
