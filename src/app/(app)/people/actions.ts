"use server";

import { revalidatePath } from "next/cache";

import { todayInTz } from "@/lib/dates";
import { failure, type ActionResult } from "@/lib/errors";
import {
  FIELD_LABELS,
  PERSON_FIELDS,
  changedKeys,
  genderValue,
  isHouseholdRole,
  listPhrase,
  parsePersonForm,
  type PersonProfile,
} from "@/lib/people";
import { isUuid } from "@/lib/search-params";
import { authorizeAction, dbWithReason } from "@/lib/session";

// Person edits and actions (People › person drawer and page). RLS
// (people.manage) and the audit triggers apply to every write; multi-row
// changes use the 0030 functions.

function refresh(personId?: string, householdIds: string[] = []) {
  revalidatePath("/people");
  revalidatePath("/households");
  revalidatePath("/");
  if (personId) revalidatePath(`/people/${personId}`);
  for (const h of householdIds) revalidatePath(`/households/${h}`);
}

export async function updatePersonAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("id") ?? "");
  if (!isUuid(id)) return { ok: false, error: "Could not save the profile — the person was not found." };
  const auth = await authorizeAction("householdsEdit", "save the profile");
  if (!auth.ok) return auth;
  const { db, center } = auth.session;

  const current = await db
    .from("people")
    .select(
      "first_name, last_name, date_of_birth, gender, profession, employer, phone_e164, email, language, photo_opt_in, new_member_contact_opt_in, expertise_opt_in, expertise_headline, merged_into_id",
    )
    .eq("id", id)
    .eq("center_id", center.id)
    .maybeSingle();
  if (current.error) return failure("Could not save the profile", current.error);
  if (!current.data) return { ok: false, error: "Could not save the profile — the person was not found, or you can't see them." };
  if (current.data.merged_into_id) return { ok: false, error: "Could not save the profile — this record was merged into another one. Edit that one instead." };

  const raw: Record<string, string | undefined> = {};
  for (const k of PERSON_FIELDS) {
    const v = fd.get(k);
    if (typeof v === "string") raw[k] = v;
  }
  const parsed = parsePersonForm(raw, todayInTz(center.time_zone));
  if (!parsed.ok) return { ok: false, error: `Could not save the profile — ${parsed.error}.` };
  const original = { ...(current.data as unknown as PersonProfile) };
  // Legacy values the form shows normalised ("F" → Female, mixed-case email) are not changes.
  original.gender = genderValue(original.gender) || original.gender;
  if (parsed.value.gender === null && !genderValue(original.gender)) delete parsed.value.gender;
  if (parsed.value.email && original.email && parsed.value.email === original.email.toLowerCase()) delete parsed.value.email;
  const keys = changedKeys(original, parsed.value);

  // Relationship in the household the drawer was opened from.
  const household = String(fd.get("household_id") ?? "");
  const role = String(fd.get("role") ?? "");
  let roleChanged = false;
  if (isUuid(household) && role) {
    if (!isHouseholdRole(role) || role === "primary") return { ok: false, error: "Could not save the profile — choose a relationship from the list." };
    const link = await db.from("household_members").select("role, is_primary").eq("household_id", household).eq("person_id", id).is("left_at", null).maybeSingle();
    if (link.error) return failure("Could not save the relationship", link.error);
    roleChanged = Boolean(link.data && !link.data.is_primary && link.data.role !== role);
  }

  if (keys.length === 0 && !roleChanged) return { ok: true, message: "No changes to save." };
  const first = parsed.value.first_name ?? original.first_name;

  if (keys.length > 0) {
    const changes: Partial<PersonProfile> = {};
    for (const k of keys) (changes as Record<string, unknown>)[k] = parsed.value[k];
    const upd = await db.from("people").update(changes).eq("id", id).eq("center_id", center.id).select("id");
    if (upd.error) return failure(`Could not save ${first}'s profile`, upd.error);
    if ((upd.data ?? []).length === 0) return { ok: false, error: `Could not save ${first}'s profile — nothing was changed (you may not have permission to edit it).` };
  }
  if (roleChanged && isHouseholdRole(role)) {
    const r = await db.from("household_members").update({ role }).eq("household_id", household).eq("person_id", id).select("person_id");
    if (r.error || (r.data ?? []).length === 0) {
      const why = r.error ? failure("Could not save the relationship", r.error).error : "Could not save the relationship — nothing was changed.";
      return { ok: false, error: keys.length ? `${why} The other profile changes were saved.` : why };
    }
  }
  refresh(id, isUuid(household) ? [household] : []);
  const what = [...keys.map((k) => FIELD_LABELS[k] ?? k), ...(roleChanged ? ["relationship"] : [])];
  return { ok: true, message: `Saved ${first}'s profile (${listPhrase([...new Set(what)])}) · audit logged` };
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
  const first = String(fd.get("first_name") ?? "The person");
  if (!isUuid(id) || !isUuid(from)) return { ok: false, error: "Could not move — the person or their current household was not found." };
  if (!isUuid(to)) return { ok: false, error: "Could not move — choose the household to move to first." };
  if (!isHouseholdRole(role) || role === "primary") return { ok: false, error: "Could not move — choose their relationship in the new household." };
  const auth = await authorizeAction("householdsEdit", "move the person");
  if (!auth.ok) return auth;
  const res = await auth.session.db.rpc("move_person_household", { p_person: id, p_from: from, p_to: to, p_role: role });
  if (res.error) return failure(`Could not move ${first}`, res.error);
  refresh(id, [from, to]);
  return { ok: true, message: `${first} moved · pledges and payments stay with the original household · audit logged` };
}

export async function mergePeopleAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const keep = String(fd.get("keep") ?? "");
  const drop = String(fd.get("drop") ?? "");
  if (!isUuid(keep) || !isUuid(drop)) return { ok: false, error: "Could not merge — choose both records first." };
  const take = fd.getAll("take").map(String).filter(Boolean);
  const auth = await authorizeAction("householdsEdit", "merge the records");
  if (!auth.ok) return auth;
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 500);
  // Without a reason the RPC records its own ("Merged duplicate person …").
  const writer = reason ? await dbWithReason(auth.session, reason) : auth.session.db;
  const res = await writer.rpc("merge_people", { p_keep: keep, p_drop: drop, p_take: take });
  if (res.error) return failure("Could not merge the two records", res.error);
  refresh(keep);
  revalidatePath(`/people/${drop}`);
  revalidatePath("/people/merge");
  return { ok: true, message: `Records merged${take.length ? ` (${take.length} field${take.length === 1 ? "" : "s"} taken from the duplicate)` : ""} · audit logged` };
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
