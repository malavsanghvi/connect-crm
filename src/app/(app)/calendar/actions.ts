"use server";

import { revalidatePath } from "next/cache";

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
