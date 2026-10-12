"use server";

import { withActivity } from "@/lib/activity/with-activity";
import type { AddFamilyResult } from "@/lib/commands/catalog/people/add-household";
import { findFamilyMatches, matchesView } from "@/lib/commands/catalog/people/family-matches";
import { formInput, runScreenCommand } from "@/lib/commands/screen";
import { todayInTz } from "@/lib/dates";
import { failure, type ActionResult } from "@/lib/errors";
import { isModuleEnabled, moduleDef, moduleOffMessage } from "@/lib/modules";
import { canCheckForMatches, parseContact, type FamilyDraft, type FamilyMatchesView } from "@/lib/people-family";
import { authorizeAction } from "@/lib/session";

// Add a family (People redesign slice 6). Two actions for the AddFamilySheet (src/components/people-v2/add-family-sheet.tsx):
//   addFamilyAction          adds the family through the command people.add_household (the database function is 0721), or, when
//                            families that may already be this one exist, adds nothing and answers with their cards
//   findFamilyMatchesAction  the live "Already here?" check while a person types: read only, adults only, never a name alone

/** What addFamilyAction answers when it did not add the family: the cards of the families that may already be this one. */
export type AddFamilyAnswer =
  | { created: true; householdId: string; personId: string; householdNumber: string | null }
  | ({ created: false } & FamilyMatchesView);

/**
 * Form fields: first_name, last_name, contact (one box: an email when it has an @, otherwise a mobile number; or mobile and email
 * separately), street, and none_of_these = "yes" once the person has looked at the matches and said none of them is the family.
 */
export async function addFamilyAction(_prev: ActionResult<AddFamilyAnswer> | null, fd: FormData): Promise<ActionResult<AddFamilyAnswer>> {
  const raw = formInput(fd, ["first_name", "last_name", "mobile", "email", "street"]);
  const contact = typeof fd.get("contact") === "string" ? String(fd.get("contact")) : "";
  if (contact.trim() && raw.mobile === undefined && raw.email === undefined) {
    // The one "mobile or email" box: what has an @ is an email, the rest is a mobile number (an incomplete one is said in words).
    if (contact.includes("@")) raw.email = contact;
    else raw.mobile = contact;
  }
  const input = { ...raw, none_of_these: fd.get("none_of_these") === "yes" };
  const result = await withActivity("people.add_household", () => runScreenCommand<AddFamilyResult>("people.add_household", input, "add the family"), {
    entityFrom: (r) => (r && r.ok && r.data?.created ? { kind: "household", id: r.data.householdId } : null),
  });
  if (!result.ok) return result;
  const data = result.data;
  if (!data) return failure("Could not add the family", new Error("the command answered without data"));
  if (data.created) return { ok: true, message: result.message, data };
  return { ok: true, message: result.message, data: { created: false, total: data.total, matches: matchesView({ total: data.total, matches: data.matches }).matches } };
}

/** The families that may already be this one, for the sheet's "Already here?" panel. An empty list is a real answer: nothing alike. */
export async function findFamilyMatchesAction(draft: FamilyDraft): Promise<ActionResult<FamilyMatchesView>> {
  const auth = await authorizeAction("householdsEdit", "check for families that may already be here");
  if (!auth.ok) return auth;
  const { session } = auth;
  if (!isModuleEnabled(session, "people")) return { ok: false, error: moduleOffMessage("people", session.center.name, moduleDef("people").label) };
  const d: FamilyDraft = {
    firstName: String(draft?.firstName ?? "").slice(0, 400),
    lastName: String(draft?.lastName ?? "").slice(0, 400),
    contact: String(draft?.contact ?? "").slice(0, 400),
    street: "",
  };
  // Not enough typed yet, or what is typed is not a whole mobile or email: nothing to look for, and not a mistake.
  if (!canCheckForMatches(d)) return { ok: true, data: { total: 0, matches: [] } };
  const c = parseContact(d.contact);
  try {
    const found = await findFamilyMatches(
      session.db,
      session.center,
      { first: d.firstName.trim(), last: d.lastName.trim(), phone: c.mobile, email: c.email },
      todayInTz(session.center.time_zone),
    );
    return { ok: true, data: matchesView(found) };
  } catch (error) {
    const db = (error as { dbError?: unknown }).dbError;
    return failure("Could not check for families that may already be here", db ?? error);
  }
}
