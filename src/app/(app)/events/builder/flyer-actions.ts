"use server";

// Event flyers: "Generate flyer with AI" alongside manual upload.
//
// The image call needs a provider key (OPENAI_API_KEY) that this app never
// holds — see docs/DEPLOY.md, "Nothing in Connect needs it" — so it goes
// through the background service's job queue (worker/src/handlers/
// events.generate_flyer.ts), the same shape as the import module's mapping
// suggestions (settings/import/actions.ts requestAiMappingAction /
// aiMappingResultAction). This file only asks for a job and polls it; the
// ACTUAL Storage write happens here too, but only once an admin accepts a
// preview, and through the signed-in admin's own session (the same
// db.storage.from(...).upload(...) pattern as setup/actions.ts) — never
// through the worker, which holds no Storage-writing key for this (see
// docs/DEPLOY.md "storage retention" on why that key is never handed out
// casually).

import { revalidatePath } from "next/cache";

import { eventActionContext } from "@/lib/data/events";
import type { TablesUpdate } from "@/lib/database.types";
import type { ActionResult } from "@/lib/errors";
import { eventAreas } from "@/lib/events/access";
import { readFlyerState, type FlyerState } from "@/lib/events/flyer";
import { DbFailure, FormError, runAction } from "@/lib/events/forms";
import { checkUpload, extensionFor, safeFileName } from "@/lib/setup";
import { isUuid } from "@/lib/search-params";

const FLYER_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const FLYER_MAX_BYTES = 8 * 1024 * 1024;

function revalidate(eventId: string) {
  revalidatePath("/events/builder", "page");
  revalidatePath(`/events/${eventId}`, "page");
}

async function flyerEventContext(eventId: string, denied: string) {
  if (!isUuid(eventId)) throw new FormError("that event was not found.");
  return eventActionContext((a) => eventAreas.edit(a, eventId), denied);
}

/** Ask the background service to generate a flyer image from this prompt. Does not touch Storage or flyer_path yet — see applyGeneratedFlyerAction. */
export async function requestEventFlyerAction(eventId: string, prompt: string): Promise<ActionResult<FlyerState>> {
  return runAction("events.flyer.request", "ask for a flyer", async () => {
    const { db } = await flyerEventContext(eventId, "only event managers and this event's lead can generate a flyer for this event.");
    const { data, error } = await db.rpc("events_request_flyer", { p_event: eventId, p_prompt: prompt });
    if (error) throw new DbFailure(error, "ask for a flyer");
    return { ok: true, data: readFlyerState(data) };
  });
}

/** Poll a flyer generation job that is already in progress. */
export async function flyerGenerationResultAction(eventId: string): Promise<ActionResult<FlyerState>> {
  return runAction("events.flyer.result", "check the flyer job", async () => {
    const { db } = await flyerEventContext(eventId, "only event managers and this event's lead can see this event's flyer generation.");
    const { data, error } = await db.rpc("events_flyer_result", { p_event: eventId });
    if (error) throw new DbFailure(error, "check the flyer job");
    return { ok: true, data: readFlyerState(data) };
  });
}

/**
 * Turn an accepted AI preview into the event's flyer: upload the bytes to
 * Storage as the signed-in admin (their own permissions decide whether the
 * write is allowed — see app.can_write_object, "content" bucket, migration
 * 0535) and point flyer_path at it. The caller (the flyer panel) is what
 * asks the admin to confirm before overwriting an existing flyer — this
 * action itself always does what it's told, once.
 */
export async function applyGeneratedFlyerAction(eventId: string, imageB64: string, model: string, prompt: string): Promise<ActionResult> {
  return runAction("events.flyer.apply", "save the generated flyer", async () => {
    if (!imageB64) throw new FormError("there is no image to save.");
    const { db, centerId } = await flyerEventContext(eventId, "only event managers and this event's lead can set this event's flyer.");
    let bytes: Buffer;
    try {
      bytes = Buffer.from(imageB64, "base64");
    } catch (err) {
      console.error("[events/flyer] the generated image could not be decoded:", err);
      throw new FormError("the generated image was not readable.");
    }
    if (bytes.length === 0) throw new FormError("the generated image was empty.");
    const path = `${centerId}/events/${eventId}/flyer-${Date.now()}.png`;
    const up = await db.storage.from("content").upload(path, bytes, { contentType: "image/png", upsert: false });
    if (up.error) {
      console.error(`[events/flyer] upload to content/${path} failed:`, up.error);
      if (/bucket not found/i.test(up.error.message)) {
        throw new FormError("the content storage area is not set up on this server yet. Ask Community Connect to create it.");
      }
      throw new DbFailure(up.error, "save the generated flyer");
    }
    const patch: TablesUpdate<"events"> = { flyer_path: path, flyer_source: "ai", flyer_prompt: prompt.slice(0, 2000) || null, flyer_generated_at: new Date().toISOString() };
    const res = await db.from("events").update(patch).eq("id", eventId).select("id");
    if (res.error) throw new DbFailure(res.error, "the image was saved, but the event could not be updated to use it");
    if (!res.data?.length) throw new FormError("you can't edit this event.");
    revalidate(eventId);
    return { ok: true, message: `Flyer generated${model ? ` (${model})` : ""} · saved.` };
  });
}

/** Manual upload, in place of (or reverting to) an AI flyer. */
export async function uploadEventFlyerAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const eventId = String(fd.get("event_id") ?? "");
  return runAction("events.flyer.upload", "upload the flyer", async () => {
    const { db, centerId } = await flyerEventContext(eventId, "only event managers and this event's lead can upload this event's flyer.");
    const f = fd.get("file");
    const file = f && typeof f === "object" && "arrayBuffer" in f ? (f as File) : null;
    const check = checkUpload(file, FLYER_TYPES, FLYER_MAX_BYTES, "flyer");
    if (!check.ok) throw new FormError(check.error);
    const path = `${centerId}/events/${eventId}/flyer-${Date.now()}-${safeFileName(file!.name || `flyer.${extensionFor(file!.type)}`)}`;
    const up = await db.storage.from("content").upload(path, file!, { contentType: file!.type, upsert: false });
    if (up.error) {
      console.error(`[events/flyer] upload to content/${path} failed:`, up.error);
      if (/bucket not found/i.test(up.error.message)) {
        throw new FormError("the content storage area is not set up on this server yet. Ask Community Connect to create it.");
      }
      throw new DbFailure(up.error, "upload the flyer");
    }
    const patch: TablesUpdate<"events"> = { flyer_path: path, flyer_source: "manual", flyer_prompt: null, flyer_generated_at: null };
    const res = await db.from("events").update(patch).eq("id", eventId).select("id");
    if (res.error) throw new DbFailure(res.error, "the flyer was uploaded, but the event could not be updated to use it");
    if (!res.data?.length) throw new FormError("you can't edit this event.");
    revalidate(eventId);
    return { ok: true, message: "Flyer uploaded." };
  });
}

/** Clear the current flyer (manual or AI) without setting a new one. */
export async function removeEventFlyerAction(eventId: string, _prev: ActionResult | null, _fd: FormData): Promise<ActionResult> {
  void _fd;
  return runAction("events.flyer.remove", "remove the flyer", async () => {
    const { db } = await flyerEventContext(eventId, "only event managers and this event's lead can remove this event's flyer.");
    // The file stays in storage (nothing is deleted), matching removeBrandFileAction: the flyer just stops being used.
    const patch: TablesUpdate<"events"> = { flyer_path: null, flyer_source: null, flyer_prompt: null, flyer_generated_at: null };
    const res = await db.from("events").update(patch).eq("id", eventId).select("id");
    if (res.error) throw new DbFailure(res.error, "remove the flyer");
    if (!res.data?.length) throw new FormError("you can't edit this event.");
    revalidate(eventId);
    return { ok: true, message: "Flyer removed." };
  });
}

/** A signed, short-lived URL for the event's current flyer (private bucket), or the plain-English reason it can't be shown. */
export async function flyerPreviewUrlAction(eventId: string): Promise<ActionResult<{ url: string | null }>> {
  return runAction<{ url: string | null }>("events.flyer.preview_url", "load the flyer", async () => {
    if (!isUuid(eventId)) throw new FormError("that event was not found.");
    const { db } = await eventActionContext((a) => eventAreas.event(a, eventId), "you can't see this event.");
    const row = await db.from("events").select("flyer_path").eq("id", eventId).maybeSingle();
    if (row.error) throw new DbFailure(row.error, "load the flyer");
    if (!row.data?.flyer_path) return { ok: true, data: { url: null } };
    const path = row.data.flyer_path;
    if (/^https?:\/\//.test(path)) return { ok: true, data: { url: path } };
    const signed = await db.storage.from("content").createSignedUrl(path, 600);
    if (signed.error) {
      console.error(`[events/flyer] could not sign content/${path}:`, signed.error);
      throw new FormError(`${signed.error.message || "storage refused the request"}.`);
    }
    return { ok: true, data: { url: signed.data.signedUrl } };
  });
}
