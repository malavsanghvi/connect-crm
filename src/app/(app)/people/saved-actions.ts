"use server";

import { revalidatePath } from "next/cache";

import { withActivity } from "@/lib/activity/with-activity";
import { failure, type ActionResult } from "@/lib/errors";
import { cleanViewName, limitProblem, nextPosition, sameViewName, viewToSave } from "@/lib/people-v2/saved-views";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

// A person's own saved People views and pinned families (app.people_saved, 0722). Each Server Action checks that the person may open the
// People area, checks the shape of what came from the browser, and writes through the person's own session: the table's row level
// security is what makes a row theirs alone. Every result says in plain words what happened; a write that failed is never "Saved".
// A typed search is not kept in a view (viewToSave drops it): it can be a person's name.

type Saved = { id: string; name: string };

function sameNameProblem(name: string): string {
  return `You already have a saved view called “${name}”. Choose another name, or delete that one first.`;
}

const DB_DUPLICATE = "23505";

// ── Save the list the person is looking at ───────────────────────────────────────────────────────────────────────────────────
export async function saveViewAction(input: { name: string; list: string; params: Record<string, string>; sort?: string | null }): Promise<ActionResult<Saved>> {
  return withActivity("people.save_view", () => saveView(input));
}

async function saveView(input: { name: string; list: string; params: Record<string, string>; sort?: string | null }): Promise<ActionResult<Saved>> {
  const auth = await authorizeAction("households", "save the view");
  if (!auth.ok) return auth;
  const { db, center, userId } = auth.session;
  const checked = viewToSave({ name: input?.name, list: input?.list, params: input?.params, sort: input?.sort });
  if (!checked.ok) return { ok: false, error: checked.error };
  const { view } = checked;

  const mine = await db.from("people_saved").select("id, name, position").eq("center_id", center.id).eq("user_id", userId).eq("kind", "view").limit(100);
  if (mine.error) return failure("Could not save the view", mine.error);
  const rows = mine.data ?? [];
  if (rows.some((r) => r.name && sameViewName(r.name, view.name))) return { ok: false, error: sameNameProblem(view.name) };
  const full = limitProblem("view", rows.length);
  if (full) return { ok: false, error: full };

  const res = await db
    .from("people_saved")
    .insert({ center_id: center.id, user_id: userId, kind: "view", name: view.name, list_view: view.list, params: view.params, sort: view.sort, position: nextPosition(rows) })
    .select("id, name")
    .single();
  if (res.error) return res.error.code === DB_DUPLICATE ? { ok: false, error: sameNameProblem(view.name) } : failure("Could not save the view", res.error);
  revalidatePath("/people");
  return { ok: true, message: `Saved “${res.data.name}”.`, data: { id: res.data.id, name: res.data.name ?? view.name } };
}

// ── Rename ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function renameViewAction(input: { id: string; name: string }): Promise<ActionResult<Saved>> {
  return withActivity("people.rename_view", () => renameView(input));
}

async function renameView(input: { id: string; name: string }): Promise<ActionResult<Saved>> {
  const auth = await authorizeAction("households", "rename the view");
  if (!auth.ok) return auth;
  const { db, center, userId } = auth.session;
  if (!isUuid(input?.id)) return { ok: false, error: "Could not rename the view — it was not found." };
  const name = cleanViewName(input.name);
  if (!name.ok) return { ok: false, error: name.error };

  const mine = await db.from("people_saved").select("id, name").eq("center_id", center.id).eq("user_id", userId).eq("kind", "view").limit(100);
  if (mine.error) return failure("Could not rename the view", mine.error);
  const rows = mine.data ?? [];
  if (!rows.some((r) => r.id === input.id)) return { ok: false, error: "Could not rename the view — it was not found. It may already have been deleted." };
  if (rows.some((r) => r.id !== input.id && r.name && sameViewName(r.name, name.name))) return { ok: false, error: sameNameProblem(name.name) };

  const res = await db.from("people_saved").update({ name: name.name }).eq("id", input.id).eq("center_id", center.id).eq("user_id", userId).eq("kind", "view").select("id, name");
  if (res.error) return res.error.code === DB_DUPLICATE ? { ok: false, error: sameNameProblem(name.name) } : failure("Could not rename the view", res.error);
  const row = res.data?.[0];
  // A write that changed no row did not rename anything: say so rather than "Renamed".
  if (!row) return { ok: false, error: "Could not rename the view — it was not found. It may already have been deleted." };
  revalidatePath("/people");
  return { ok: true, message: `Renamed to “${row.name}”.`, data: { id: row.id, name: row.name ?? name.name } };
}

// ── Delete ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function deleteViewAction(input: { id: string }): Promise<ActionResult> {
  return withActivity("people.delete_view", () => deleteView(input));
}

async function deleteView(input: { id: string }): Promise<ActionResult> {
  const auth = await authorizeAction("households", "delete the view");
  if (!auth.ok) return auth;
  const { db, center, userId } = auth.session;
  if (!isUuid(input?.id)) return { ok: false, error: "Could not delete the view — it was not found." };
  const res = await db.from("people_saved").delete().eq("id", input.id).eq("center_id", center.id).eq("user_id", userId).eq("kind", "view").select("id");
  if (res.error) return failure("Could not delete the view", res.error);
  if ((res.data ?? []).length === 0) return { ok: false, error: "Could not delete the view — it was not found. It may already have been deleted." };
  revalidatePath("/people");
  return { ok: true, message: "Deleted. Only your saved view is gone: no family or person was changed." };
}

// ── Pin or unpin a family ───────────────────────────────────────────────────────────────────────────────────────────────────
export async function setPinAction(input: { householdId: string; pinned: boolean }): Promise<ActionResult<{ pinned: boolean }>> {
  return withActivity(input?.pinned ? "people.pin_family" : "people.unpin_family", () => setPin(input), { entityFrom: { kind: "household", id: String(input?.householdId ?? "") } });
}

async function setPin(input: { householdId: string; pinned: boolean }): Promise<ActionResult<{ pinned: boolean }>> {
  const want = input?.pinned === true;
  const doing = want ? "pin the family" : "unpin the family";
  const auth = await authorizeAction("households", doing);
  if (!auth.ok) return auth;
  const { db, center, userId } = auth.session;
  if (!isUuid(input?.householdId)) return { ok: false, error: `Could not ${doing} — the family was not found.` };
  const householdId = input.householdId;

  if (!want) {
    const res = await db.from("people_saved").delete().eq("center_id", center.id).eq("user_id", userId).eq("kind", "pin").eq("household_id", householdId).select("id");
    if (res.error) return failure(`Could not ${doing}`, res.error);
    revalidatePath("/people");
    revalidatePath(`/households/${householdId}`);
    return { ok: true, message: "Unpinned.", data: { pinned: false } };
  }

  // The family must be one this person can see in this community (the row's own policy checks it again).
  const seen = await db.from("households").select("id").eq("id", householdId).eq("center_id", center.id).is("merged_into_id", null).maybeSingle();
  if (seen.error) return failure(`Could not ${doing}`, seen.error);
  if (!seen.data) return { ok: false, error: `Could not ${doing} — it was not found, or you can't see it.` };
  const mine = await db.from("people_saved").select("id, household_id, position").eq("center_id", center.id).eq("user_id", userId).eq("kind", "pin").limit(100);
  if (mine.error) return failure(`Could not ${doing}`, mine.error);
  const rows = mine.data ?? [];
  if (rows.some((r) => r.household_id === householdId)) return { ok: true, message: "Already pinned.", data: { pinned: true } };
  const full = limitProblem("pin", rows.length);
  if (full) return { ok: false, error: full };

  const res = await db.from("people_saved").insert({ center_id: center.id, user_id: userId, kind: "pin", household_id: householdId, position: nextPosition(rows) }).select("id").single();
  if (res.error) return res.error.code === DB_DUPLICATE ? { ok: true, message: "Already pinned.", data: { pinned: true } } : failure(`Could not ${doing}`, res.error);
  revalidatePath("/people");
  revalidatePath(`/households/${householdId}`);
  return { ok: true, message: "Pinned. It is at the top of the People home.", data: { pinned: true } };
}
