"use server";

import { addIdentifierAction, retireIdentifierAction } from "@/app/(app)/identifiers/actions";
import type { ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/search-params";

// THE SEAM for the person slide-over's IDs section (docs/PEOPLE_REDESIGN.md slice 3 and 6). The section adds and retires an ID only
// through these two functions, and only these two know how: today they call the existing identifier actions (the ones the classic
// IDs panel uses), so permission per kind, the duplicate warning and the audit trail are unchanged.
//
// Slice 6 (the More menu as commands, migration 0720) made both identifier actions run people.add_identifier and
// people.retire_identifier. Retiring now needs a reason, so `RetireIdInput` carries one and the slide-over asks for it. The two
// bodies can call the commands directly later without touching the components.

export type AddIdInput = {
  personId: string;
  /** The family page the person is shown on; null on the person's own page. Used only to refresh the right page. */
  householdId: string | null;
  kind: string;
  system: string;
  value: string;
  label?: string;
};

export type RetireIdInput = {
  id: string;
  personId: string;
  householdId: string | null;
  /** Why it is retired. Required: it goes in the audit log (the command refuses without it). */
  reason: string;
};

function returnPath(personId: string, householdId: string | null): string {
  return householdId && isUuid(householdId) ? `/households/${householdId}` : `/people/${personId}`;
}

export async function addPersonId(input: AddIdInput): Promise<ActionResult> {
  if (!input || !isUuid(input.personId)) return { ok: false, error: "Could not add the identifier — the person was not found." };
  const fd = new FormData();
  fd.set("kind", String(input.kind ?? ""));
  fd.set("target", `person:${input.personId}`);
  fd.set("value", String(input.value ?? ""));
  fd.set("system", String(input.system ?? ""));
  fd.set("label", String(input.label ?? ""));
  fd.set("returnPath", returnPath(input.personId, input.householdId));
  return addIdentifierAction(null, fd);
}

export async function retirePersonId(input: RetireIdInput): Promise<ActionResult> {
  if (!input || !isUuid(input.id) || !isUuid(input.personId)) return { ok: false, error: "Could not retire the identifier — it was not found." };
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 1000) : "";
  if (!reason) return { ok: false, error: "Could not retire the identifier — give a reason. It goes in the audit log." };
  const fd = new FormData();
  fd.set("id", input.id);
  fd.set("reason", reason);
  fd.set("returnPath", returnPath(input.personId, input.householdId));
  return retireIdentifierAction(null, fd);
}
