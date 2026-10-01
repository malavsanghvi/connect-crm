"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { dietaryKeyFromLabel, parseDietaryOption } from "@/lib/profile-details";
import { dbWithReason, loadSession } from "@/lib/session";

// Setup › Lists › Dietary options: the choices members see under "Dietary needs" in the app.
// The database decides who may write (RLS: settings.manage). Nothing is deleted: a choice
// members already picked is switched off (active = false), so it still has a name to show.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveDietaryOptionAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("id") ?? "");
  const editing = id !== "";
  const doing = editing ? "save the dietary option" : "add the dietary option";
  if (editing && !UUID.test(id)) return { ok: false, error: `Could not ${doing} — reload the page and try again.` };
  const state = await loadSession();
  if (state.status === "signed_out") return { ok: false, error: `Could not ${doing} — your session has expired. Sign in again.` };
  if (state.status !== "ok") return { ok: false, error: `Could not ${doing} — the app could not load your session. Reload and try again.` };
  const session = state.session;
  const read = (n: string) => {
    const v = fd.get(n);
    return typeof v === "string" ? v : null;
  };
  const parsed = parseDietaryOption(read);
  if (!parsed.ok) return { ok: false, error: `Could not ${doing} — ${parsed.error}` };
  const reason = String(fd.get("reason") ?? "").trim();
  if (reason.length > 500) return { ok: false, error: `Could not ${doing} — keep the reason under 500 characters.` };
  const db = reason ? await dbWithReason(session, reason) : session.db;
  const { label, active } = parsed.value;
  // The key is fixed when the option is created (members' rows store it); editing changes the name and the switch only.
  const res = editing
    ? await db.from("dietary_options").update({ label, active }).eq("id", id).eq("center_id", session.center.id).select("id")
    : await db.from("dietary_options").insert({ center_id: session.center.id, key: dietaryKeyFromLabel(label), label, active, sort: 50, created_by: session.userId }).select("id");
  if (res.error) {
    if (res.error.code === "23505") return { ok: false, error: `Could not ${doing} — there is already a dietary option with that name. Choose another name.` };
    return failure(`Could not ${doing}`, res.error);
  }
  if (!res.data || res.data.length === 0) {
    return { ok: false, error: `Could not ${doing} — nothing was saved (you may not have permission to change dietary options).` };
  }
  revalidatePath("/setup/lists");
  return { ok: true, message: `Dietary option ${editing ? "saved" : "added"} · audit logged` };
}
