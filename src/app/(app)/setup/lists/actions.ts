"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { loadSession, dbWithReason } from "@/lib/session";
import { isSetupList, keyFromName, parseFund, parseInbox, parseMembershipType, parseTrack, parseZone, type SetupList } from "@/lib/setup-lists";

// Setup › Lists: add or change one row of setup data. The database decides who may
// write each list (RLS: settings.manage for membership types, inboxes and zones;
// giving.manage for funds; pathshala.manage for tracks). Nothing is deleted: a
// membership type or fund is switched off (active = false) instead.

const WHAT: Record<SetupList, string> = {
  membership_types: "membership type",
  funds: "fund",
  inboxes: "inbox",
  zones: "zone",
  pathshala_tracks: "Pathshala track",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveListItemAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const list = fd.get("list");
  if (!isSetupList(list)) return { ok: false, error: "Could not save — reload the page and try again." };
  const what = WHAT[list];
  const id = String(fd.get("id") ?? "");
  const editing = id !== "";
  const doing = `${editing ? "save the" : "add the"} ${what}`;
  if (editing && !UUID.test(id)) return { ok: false, error: `Could not ${doing} — reload the page and try again.` };
  const state = await loadSession();
  if (state.status === "signed_out") return { ok: false, error: `Could not ${doing} — your session has expired. Sign in again.` };
  if (state.status !== "ok") return { ok: false, error: `Could not ${doing} — the app could not load your session. Reload and try again.` };
  const session = state.session;
  const read = (n: string) => {
    const v = fd.get(n);
    return typeof v === "string" ? v : null;
  };
  const parsed =
    list === "membership_types" ? parseMembershipType(read) : list === "funds" ? parseFund(read) : list === "inboxes" ? parseInbox(read) : list === "zones" ? parseZone(read) : parseTrack(read);
  if (!parsed.ok) return { ok: false, error: `Could not ${doing} — ${parsed.error}` };
  const reason = String(fd.get("reason") ?? "").trim();
  if (reason.length > 500) return { ok: false, error: `Could not ${doing} — keep the reason under 500 characters.` };
  const db = reason ? await dbWithReason(session, reason) : session.db;
  const row: Record<string, unknown> = { ...parsed.value };
  const table = db.from(list);
  const res = editing
    ? await table.update(row as never).eq("id", id).eq("center_id", session.center.id).select("id")
    : await table.insert({ ...row, center_id: session.center.id, ...(list === "zones" ? {} : { key: keyFromName(parsed.value.name) }) } as never).select("id");
  if (res.error) {
    if (res.error.code === "23505") return { ok: false, error: `Could not ${doing} — there is already a ${what} with that name. Choose another name.` };
    return failure(`Could not ${doing}`, res.error);
  }
  if (!res.data || res.data.length === 0) {
    return { ok: false, error: `Could not ${doing} — nothing was saved (you may not have permission for ${what}s, or its module is switched off).` };
  }
  revalidatePath("/setup/lists");
  revalidatePath("/setup");
  return { ok: true, message: `${what[0].toUpperCase()}${what.slice(1)} ${editing ? "saved" : "added"} · audit logged` };
}
