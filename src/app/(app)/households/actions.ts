"use server";

import type { HouseholdFinderResult } from "@/app/(app)/giving/actions";
import { withActivity } from "@/lib/activity/with-activity";
import { formInput, runScreenCommand } from "@/lib/commands/screen";
import { householdCards } from "@/lib/data/lookups";
import { searchHouseholds } from "@/lib/data/search";
import { failure, type ActionResult } from "@/lib/errors";
import { HOUSEHOLD_FIELDS, isHouseholdRole } from "@/lib/people";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

// Household edits (People › household drawer). Every write goes through RLS
// (people.manage) and the audit trigger on households / household_members /
// memberships. Multi-row changes use the 0030 functions so they are all or
// nothing. Update, add person, merge and dismiss are commands now
// (src/lib/commands/catalog/people): these actions read the form and call the
// same `execute` that the ⌘K palette and Niva use, so there is one code path.

const TIERS = ["community", "yearly", "life"];

export async function updateHouseholdAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return withActivity("people.update_household", () => updateHousehold(fd), { entityFrom: { kind: "household", id: String(fd.get("id") ?? "") } });
}

async function updateHousehold(fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("id") ?? "");
  if (!isUuid(id)) return { ok: false, error: "Could not save the household — it was not found." };
  const raw = formInput(fd, ["id", ...HOUSEHOLD_FIELDS, "tier", "tier_reason"]);
  // A tier the form did not name (or one that is not a tier) is not a tier change.
  if (raw.tier !== undefined && !TIERS.includes(raw.tier)) delete raw.tier;
  return runScreenCommand("people.update_household", raw, "save the household");
}

export async function addPersonAction(_prev: ActionResult<{ personId: string }> | null, fd: FormData): Promise<ActionResult<{ personId: string }>> {
  const household = String(fd.get("household_id") ?? "");
  if (!isUuid(household)) return { ok: false, error: "Could not add the person — the household was not found." };
  const raw = formInput(fd, ["household_id", "first_name", "last_name", "role", "date_of_birth", "gender", "email", "phone_e164"]);
  // A relationship that is not one of the five (or is "primary") is the same as none chosen.
  if (raw.role !== undefined && (!isHouseholdRole(raw.role) || raw.role === "primary")) delete raw.role;
  return runScreenCommand<{ personId: string }>("people.add_person", raw, "add the person");
}

export async function mergeHouseholdsAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const keep = String(fd.get("keep") ?? "");
  const drop = String(fd.get("drop") ?? "");
  if (!isUuid(keep) || !isUuid(drop)) return { ok: false, error: "Could not merge — choose both households first." };
  return runScreenCommand("people.merge_households", { keep_id: keep, drop_id: drop, reason: String(fd.get("reason") ?? "") }, "merge the households");
}

export async function dismissDuplicateAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("candidate") ?? "");
  if (!isUuid(id)) return { ok: false, error: "Could not dismiss — the suggested duplicate was not found." };
  return runScreenCommand("people.dismiss_duplicate", { candidate_id: id }, "dismiss the suggested duplicate");
}

/** Household picker search for People screens (move a person, merge households): needs people.manage. */
export async function findHouseholdsForPeopleAction(query: string): Promise<ActionResult<HouseholdFinderResult>> {
  const auth = await authorizeAction("householdsEdit", "search households");
  if (!auth.ok) return auth;
  const q = String(query ?? "").trim();
  if (q.length < 2) return { ok: false, error: "Type at least 2 characters — a name, a member or household ID." };
  if (q.length > 120) return { ok: false, error: "That search is too long." };
  const { db, center } = auth.session;
  const found = await searchHouseholds(db, center.id, q, { limit: 60 });
  if (found.error && found.householdIds.length === 0) return failure("Could not search households", found.error);
  const ids = found.householdIds.slice(0, 12);
  const cards = await householdCards(db, ids);
  if (cards.error && cards.map.size === 0) return failure("Could not load the household details", cards.error);
  return {
    ok: true,
    data: { cards: ids.flatMap((id) => (cards.map.has(id) ? [cards.map.get(id)!] : [])), hits: found.identifierMatches, more: found.householdIds.length > 12 },
  };
}
