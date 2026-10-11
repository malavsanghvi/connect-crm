"use server";

import { revalidatePath } from "next/cache";

import { withActivity } from "@/lib/activity/with-activity";
import { formInput, runScreenCommand } from "@/lib/commands/screen";
import { failure, type ActionResult } from "@/lib/errors";
import { PERSON_FIELDS, isHouseholdRole } from "@/lib/people";
import { isUuid } from "@/lib/search-params";
import { authorizeAction, dbWithReason } from "@/lib/session";

// Person edits and actions (People › person drawer and page). RLS
// (people.manage) and the audit triggers apply to every write; multi-row
// changes use the 0030 functions. Update, move and merge are commands now
// (src/lib/commands/catalog/people): these actions read the form and call the
// same `execute` that the ⌘K palette and Niva use, so there is one code path.

function refresh(personId?: string, householdIds: string[] = []) {
  revalidatePath("/people");
  revalidatePath("/households");
  revalidatePath("/");
  if (personId) revalidatePath(`/people/${personId}`);
  for (const h of householdIds) revalidatePath(`/households/${h}`);
}

export async function updatePersonAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return withActivity("people.update_person", () => updatePerson(fd), { entityFrom: { kind: "person", id: String(fd.get("id") ?? "") } });
}

async function updatePerson(fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("id") ?? "");
  if (!isUuid(id)) return { ok: false, error: "Could not save the profile — the person was not found." };
  const raw = formInput(fd, ["id", ...PERSON_FIELDS, "household_id", "role"], ["household_id", "role"]);
  // The relationship only applies in the household the drawer was opened from.
  if (raw.household_id && !isUuid(raw.household_id)) delete raw.household_id;
  return runScreenCommand("people.update_person", raw, "save the profile");
}

export async function makePrimaryAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("id") ?? "");
  const first = String(fd.get("first_name") ?? "This person");
  if (!isUuid(id)) return { ok: false, error: "Could not create the household — the person was not found." };
  const auth = await authorizeAction("householdsEdit", "create the household");
  if (!auth.ok) return auth;
  const { db } = auth.session;
  const res = await db.rpc("make_primary_of_own_household", { p_person: id });
  if (res.error) return failure(`Could not make ${first} primary of their own household`, res.error);
  const newId = String(res.data);
  const hh = await db.from("households").select("household_number").eq("id", newId).maybeSingle();
  if (hh.error) console.error("[people] new household number lookup failed; message names no number:", hh.error);
  refresh(id, [newId]);
  return {
    ok: true,
    message: `${first} is now primary of ${hh.data?.household_number ?? "a new household"} and stays in the family household · audit logged`,
  };
}

export async function movePersonAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("id") ?? "");
  const from = String(fd.get("from") ?? "");
  const to = String(fd.get("to") ?? "");
  const role = String(fd.get("role") ?? "other");
  if (!isUuid(id) || !isUuid(from)) return { ok: false, error: "Could not move — the person or their current household was not found." };
  if (!isUuid(to)) return { ok: false, error: "Could not move — choose the household to move to first." };
  if (!isHouseholdRole(role) || role === "primary") return { ok: false, error: "Could not move — choose their relationship in the new household." };
  return runScreenCommand("people.move_person", { person_id: id, from_household_id: from, to_household_id: to, role }, "move the person");
}

export async function mergePeopleAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const keep = String(fd.get("keep") ?? "");
  const drop = String(fd.get("drop") ?? "");
  if (!isUuid(keep) || !isUuid(drop)) return { ok: false, error: "Could not merge — choose both records first." };
  const take = fd.getAll("take").map(String).filter(Boolean);
  return runScreenCommand(
    "people.merge_people",
    { keep_id: keep, drop_id: drop, take: take.join(","), reason: String(fd.get("reason") ?? "") },
    "merge the records",
  );
}

// ---------------------------------------------------------------------------
// Voting-eligibility overrides (two-person rule, 0016). The first person asks;
// a different person with people.approve approves (approveAsSecondAction);
// then either of them applies the value.
// ---------------------------------------------------------------------------
export async function requestOverrideAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("snapshot") ?? "");
  const want = String(fd.get("value") ?? "");
  const reason = String(fd.get("reason") ?? "").trim();
  if (!isUuid(id)) return { ok: false, error: "Could not request the override — the eligibility record was not found." };
  if (want !== "true" && want !== "false") return { ok: false, error: "Could not request the override — choose eligible or not eligible." };
  if (reason.length < 5) return { ok: false, error: "Could not request the override — give a reason the second approver can check." };
  const auth = await authorizeAction("peopleApprove", "request the voting override");
  if (!auth.ok) return auth;
  const { center, userId } = auth.session;
  const res = await (await dbWithReason(auth.session, reason))
    .from("eligibility_snapshots")
    .update({ override_by: userId, override_reason: reason.slice(0, 500), override_requested_value: want === "true", override_second_approver: null })
    .eq("id", id)
    .eq("center_id", center.id)
    .is("override_can_vote", null)
    .select("id");
  if (res.error) return failure("Could not request the voting override", res.error);
  if ((res.data ?? []).length === 0) return { ok: false, error: "Could not request the override — it was already applied, or you can't change it." };
  revalidatePath("/people/voting");
  revalidatePath("/");
  return { ok: true, message: "Override requested · a different person with people.approve must approve it" };
}

export async function applyOverrideAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("snapshot") ?? "");
  if (!isUuid(id)) return { ok: false, error: "Could not apply the override — the eligibility record was not found." };
  const auth = await authorizeAction("peopleApprove", "apply the voting override");
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const row = await db
    .from("eligibility_snapshots")
    .select("override_requested_value, override_second_approver")
    .eq("id", id)
    .eq("center_id", center.id)
    .maybeSingle();
  if (row.error) return failure("Could not apply the voting override", row.error);
  if (!row.data?.override_second_approver) return { ok: false, error: "Could not apply the override — it still needs a second approver." };
  if (row.data.override_requested_value === null) return { ok: false, error: "Could not apply the override — no value was requested." };
  const res = await db
    .from("eligibility_snapshots")
    .update({ override_can_vote: row.data.override_requested_value })
    .eq("id", id)
    .eq("center_id", center.id)
    .select("id");
  if (res.error) return failure("Could not apply the voting override", res.error);
  if ((res.data ?? []).length === 0) return { ok: false, error: "Could not apply the override — nothing was changed (you may not have permission)." };
  revalidatePath("/people/voting");
  revalidatePath("/");
  return { ok: true, message: "Voting override applied · audit logged" };
}
