"use server";

import { revalidatePath } from "next/cache";

import { LAYER_KINDS, layerKey, parseFeedUrl } from "@/lib/calendar";
import { failure, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/** Layer defaults and owner (center layers only; shared layers belong to the platform). */
export async function saveLayerAction(layerId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("calendarManage", "save the layer");
  if (!auth.ok) return auth;
  if (!isUuid(layerId)) return { ok: false, error: "Could not save the layer — unknown layer." };
  const owner = text(fd, "owner_label");
  if (owner.length > 80) return { ok: false, error: "Could not save the layer — keep the owner under 80 characters." };
  const { data, error } = await auth.session.db
    .from("calendar_layers")
    .update({ default_on: Boolean(fd.get("default_on")), owner_label: owner || null })
    .eq("id", layerId)
    .eq("center_id", auth.session.center.id)
    .select("name");
  if (error) return failure("Could not save the layer", error);
  if (!data?.length) return { ok: false, error: "Could not save the layer — it is a shared layer or it no longer exists." };
  revalidatePath("/calendar");
  return { ok: true, message: `${data[0].name} saved.` };
}

export async function saveCalendarEntryAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("calendarManage", "add the calendar entry");
  if (!auth.ok) return auth;
  const layerId = text(fd, "layer_id");
  const title = text(fd, "title");
  const starts = text(fd, "starts_on");
  const ends = text(fd, "ends_on");
  if (!isUuid(layerId)) return { ok: false, error: "Could not add the calendar entry — choose the layer." };
  if (!title) return { ok: false, error: "Could not add the calendar entry — give it a title." };
  if (title.length > 160) return { ok: false, error: "Could not add the calendar entry — keep the title under 160 characters." };
  if (!DATE.test(starts)) return { ok: false, error: "Could not add the calendar entry — choose the date." };
  if (ends && !DATE.test(ends)) return { ok: false, error: "Could not add the calendar entry — the end date is not valid." };
  if (ends && ends < starts) return { ok: false, error: "Could not add the calendar entry — the end date must be on or after the start." };
  const { error } = await auth.session.db.from("calendar_entries").insert({
    center_id: auth.session.center.id,
    layer_id: layerId,
    title,
    starts_on: starts,
    ends_on: ends || null,
    all_day: true,
  });
  if (error) return failure("Could not add the calendar entry", error);
  revalidatePath("/calendar");
  return { ok: true, message: `Added "${title}" to the calendar.` };
}

export async function deleteCalendarEntryAction(entryId: string, _prev: ActionResult | null, _fd: FormData): Promise<ActionResult> {
  void _fd;
  const auth = await authorizeAction("calendarManage", "remove the calendar entry");
  if (!auth.ok) return auth;
  if (!isUuid(entryId)) return { ok: false, error: "Could not remove the calendar entry — unknown entry." };
  const { data, error } = await auth.session.db
    .from("calendar_entries")
    .delete()
    .eq("id", entryId)
    .eq("center_id", auth.session.center.id)
    .is("event_id", null)
    .select("title");
  if (error) return failure("Could not remove the calendar entry", error);
  if (!data?.length) return { ok: false, error: "Could not remove the calendar entry — it comes from an event (change the event instead) or it no longer exists." };
  revalidatePath("/calendar");
  return { ok: true, message: `Removed "${data[0].title}".` };
}

// ---------------------------------------------------------------------------
// Calendar subscriptions (0510): a layer follows a calendar link (ICS).
// ---------------------------------------------------------------------------

/** Subscribe a layer to a calendar link (or change the link); the first refresh is queued at once. */
export async function subscribeLayerFeedAction(layerId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("calendarManage", "subscribe the layer to the calendar");
  if (!auth.ok) return auth;
  if (!isUuid(layerId)) return { ok: false, error: "Could not subscribe the layer — unknown layer." };
  const parsed = parseFeedUrl(text(fd, "source_url"));
  if (!parsed.ok) return { ok: false, error: `Could not subscribe the layer — ${parsed.error}` };
  const { error } = await auth.session.db.rpc("subscribe_calendar_layer", {
    p_layer: layerId,
    p_url: parsed.url,
    p_create_events: Boolean(fd.get("create_events")),
  });
  if (error) return failure("Could not subscribe the layer", error);
  revalidatePath("/calendar");
  return { ok: true, message: "Subscribed. The background service is fetching the calendar now, and will refresh it every day." };
}

export async function refreshLayerFeedAction(layerId: string, _prev: ActionResult | null, _fd: FormData): Promise<ActionResult> {
  void _fd;
  const auth = await authorizeAction("calendarManage", "refresh the calendar");
  if (!auth.ok) return auth;
  if (!isUuid(layerId)) return { ok: false, error: "Could not refresh the calendar — unknown layer." };
  const { error } = await auth.session.db.rpc("refresh_calendar_layer", { p_layer: layerId });
  if (error) return failure("Could not refresh the calendar", error);
  revalidatePath("/calendar");
  return { ok: true, message: "Refresh queued. Reload this page in a minute to see the result." };
}

export async function unsubscribeLayerFeedAction(layerId: string, _prev: ActionResult | null, _fd: FormData): Promise<ActionResult> {
  void _fd;
  const auth = await authorizeAction("calendarManage", "stop following the calendar");
  if (!auth.ok) return auth;
  if (!isUuid(layerId)) return { ok: false, error: "Could not stop following the calendar — unknown layer." };
  const { error } = await auth.session.db.rpc("unsubscribe_calendar_layer", { p_layer: layerId });
  if (error) return failure("Could not stop following the calendar", error);
  revalidatePath("/calendar");
  return { ok: true, message: "Stopped following the calendar. Its dates stay on the layer; remove any you no longer want." };
}

/** A new layer of this organization, optionally following a calendar link from the start. */
export async function createLayerAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("calendarManage", "add the layer");
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const name = text(fd, "name");
  const kind = text(fd, "kind") || "custom";
  const color = text(fd, "color");
  const link = text(fd, "source_url");
  if (!name) return { ok: false, error: "Could not add the layer — give it a name." };
  if (name.length > 80) return { ok: false, error: "Could not add the layer — keep the name under 80 characters." };
  if (!LAYER_KINDS.some((k) => k.kind === kind)) return { ok: false, error: "Could not add the layer — choose what kind of dates it holds." };
  if (color && !/^#[0-9A-Fa-f]{6}$/.test(color)) return { ok: false, error: "Could not add the layer — the colour must look like #1B5E9C." };
  const parsed = link ? parseFeedUrl(link) : null;
  if (parsed && !parsed.ok) return { ok: false, error: `Could not add the layer — ${parsed.error}` };
  const existing = await db.from("calendar_layers").select("key").eq("center_id", center.id);
  if (existing.error) return failure("Could not add the layer", existing.error);
  const key = layerKey(name, new Set((existing.data ?? []).map((l) => l.key)));
  const ins = await db
    .from("calendar_layers")
    .insert({ center_id: center.id, key, name, kind, color: color || null, default_on: Boolean(fd.get("default_on")) })
    .select("id")
    .single();
  if (ins.error) return failure("Could not add the layer", ins.error);
  if (parsed?.ok) {
    const sub = await db.rpc("subscribe_calendar_layer", { p_layer: ins.data.id, p_url: parsed.url, p_create_events: Boolean(fd.get("create_events")) });
    revalidatePath("/calendar");
    if (sub.error) return failure(`The layer "${name}" was added, but could not be subscribed to the calendar`, sub.error);
    return { ok: true, message: `Added "${name}". The background service is fetching the calendar now.` };
  }
  revalidatePath("/calendar");
  return { ok: true, message: `Added the layer "${name}".` };
}
