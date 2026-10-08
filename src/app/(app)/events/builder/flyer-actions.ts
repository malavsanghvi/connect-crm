"use server";

// Event flyers: the flyer maker's Server Actions (owner decisions 2026-10-01).
//
// A flyer is designed from the brand kit over a background — a pattern drawn
// in code, an approved album photo, free AI background art, or a plain colour
// — rendered on the server (src/lib/events/flyer-render.tsx) and stored in the
// "content" bucket as content/<center>/events/<event>/flyer-<ms>.png; an
// organizer can still upload their own. Every Storage write and delete runs
// as the signed-in organizer, so app.can_write_object (0578) decides.
//
// AI background art goes through the background service's job queue
// (worker/src/handlers/events.generate_flyer.ts, Google Gemini: about 4¢ a
// picture, with a Gemini key in Platform › Setup; Flyers v2 retired
// Pollinations.ai). The image bytes never reach the browser: when the job is
// done, the server stores them as content/<center>/events/<event>/art-<ms>.<ext>
// and app.events_flyer_art_taken removes them from the job. The Poster
// template's art layers and the partner logo are in flyer-art-actions.ts.
//
// After a save, replace or remove, the event's older flyer and art files are
// removed (app.event_flyer_leftovers); a removal that fails is said in the
// success message, logged, and swept up later (0578's 7-day rule).

import { revalidatePath } from "next/cache";

import { signedPhotoUrls } from "@/lib/data/content-comms";
import { eventActionContext } from "@/lib/data/events";
import type { Json, TablesUpdate } from "@/lib/database.types";
import type { ActionResult } from "@/lib/errors";
import { eventAreas } from "@/lib/events/access";
import {
  FLYER_ART_PROMPT_MAX,
  findBlockedArtTerm,
  flyerMadeFor,
  isFlyerArtPath,
  parseFlyerDesign,
  readArtJob,
  withArtGuardrail,
  type FlyerArtState,
} from "@/lib/events/flyer";
import { englishOnlyNote, firstNonEnglishLetter } from "@/lib/events/flyer-art";
import { flyerArtReadiness } from "@/lib/events/flyer-art-library";
import { FlyerBackgroundError, composeFlyer, sniffImage } from "@/lib/events/flyer-assets";
import { FlyerFontsMissingError } from "@/lib/events/flyer-fonts";
import { FlyerBusyError } from "@/lib/events/flyer-render";
import { DbFailure, FormError, runAction } from "@/lib/events/forms";
import { isModuleEnabled } from "@/lib/modules";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/search-params";
import { checkUpload, extensionFor, safeFileName } from "@/lib/setup";
import type { AppSupabase } from "@/lib/supabase/server";

const FLYER_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const FLYER_MAX_BYTES = 8 * 1024 * 1024;
const NO_STORAGE = "the content storage area is not set up on this server yet. Ask Weaver to create it.";

function revalidate(eventId: string) {
  revalidatePath("/events/builder", "page");
  revalidatePath(`/events/${eventId}`, "page");
}

async function flyerEventContext(eventId: string, denied: string) {
  if (!isUuid(eventId)) throw new FormError("that event was not found.");
  return eventActionContext((a) => eventAreas.edit(a, eventId), denied);
}

/** The storage key a flyer_path names, when it is a file in this event's own folder (not an https URL). */
function ownFlyerKey(path: string | null | undefined, centerId: string, eventId: string): string | null {
  if (!path || /^https?:\/\//i.test(path)) return null;
  const key = path.replace(/^content\//, "");
  return key.startsWith(`${centerId}/events/${eventId}/flyer-`) ? key : null;
}

type Cleanup = { failed: number; unknown: boolean };

/**
 * Remove this event's leftover flyer and art files (app.event_flyer_leftovers)
 * plus `extra` (the flyer that was just replaced), through the Storage API as
 * the organizer. Never throws: a failure is logged and reported back so the
 * success message can say so.
 */
async function cleanup(db: AppSupabase, eventId: string, extra: (string | null)[] = []): Promise<Cleanup> {
  const names = new Set(extra.filter((n): n is string => Boolean(n)));
  let unknown = false;
  const left = await db.rpc("event_flyer_leftovers", { p_event: eventId });
  if (left.error) {
    console.error(`[events/flyer] could not list event ${eventId}'s older flyer files:`, left.error);
    unknown = true;
  } else {
    for (const r of (left.data ?? []) as { name: string }[]) if (r.name) names.add(r.name);
  }
  if (!names.size) return { failed: 0, unknown };
  const list = [...names];
  const res = await db.storage.from("content").remove(list);
  if (res.error) {
    console.error(`[events/flyer] could not remove event ${eventId}'s older flyer files:`, res.error, list);
    return { failed: list.length, unknown };
  }
  const gone = new Set((res.data ?? []).map((o) => o.name));
  const kept = list.filter((n) => !gone.has(n));
  if (kept.length) console.error(`[events/flyer] storage kept ${kept.length} of event ${eventId}'s older flyer files:`, kept);
  return { failed: kept.length, unknown };
}

function withCleanupNote(message: string, c: Cleanup): string {
  if (c.failed > 0) {
    return `${message} ${c.failed} older flyer file${c.failed === 1 ? "" : "s"} couldn't be removed — they'll be tidied up next time.`;
  }
  if (c.unknown) return `${message} Older flyer files couldn't be checked — they'll be tidied up next time.`;
  return message;
}

function storageFailure(error: { message?: string }, doing: string): never {
  if (/bucket not found/i.test(error.message ?? "")) throw new FormError(NO_STORAGE);
  throw new DbFailure(error, doing);
}

// ── AI background art ────────────────────────────────────────────────────────

/** Ask the background service for AI background art (abstract or decorative only). Nothing is saved to the event yet. */
export async function requestEventFlyerAction(eventId: string, prompt: string): Promise<ActionResult<FlyerArtState>> {
  return runAction<FlyerArtState>("events.flyer.request", "ask for AI art", async () => {
    const text = (prompt ?? "").replace(/\s+/g, " ").trim();
    if (!text) throw new FormError("describe the background art you want, in a sentence or two.");
    if (text.length > FLYER_ART_PROMPT_MAX) throw new FormError(`keep the description under ${FLYER_ART_PROMPT_MAX.toLocaleString("en-US")} characters.`);
    const foreign = firstNonEnglishLetter(text);
    if (foreign) return { ok: false, error: englishOnlyNote(foreign) };
    const blocked = findBlockedArtTerm(text);
    if (blocked) {
      return {
        ok: false,
        error: `AI backgrounds are abstract or decorative only. Please take out "${blocked}" — no people, deities or murtis, and no lettering (the flyer adds the words itself).`,
      };
    }
    const { db, centerId } = await flyerEventContext(eventId, "only event managers and this event's lead can make this event's flyer.");
    // AI art costs money and needs a Gemini key: say so now, plainly, rather than queueing a job that cannot run.
    const ready = await flyerArtReadiness(db, centerId);
    if (ready.state !== "ready") return { ok: true, data: { status: "unavailable", reason: ready.message } };
    const { data, error } = await db.rpc("events_request_flyer", { p_event: eventId, p_prompt: withArtGuardrail(text) });
    if (error) throw new DbFailure(error, "ask for AI art");
    const job = readArtJob(data);
    if (job.status === "queued" || job.status === "running") return { ok: true, data: { status: job.status } };
    if (job.status === "unavailable" || job.status === "failed") return { ok: true, data: job };
    return { ok: true, data: { status: "queued" } };
  });
}

/**
 * Poll the AI art job. When it is done, the SERVER stores the image as this
 * event's art file (as the organizer), clears the bytes from the job, and
 * answers with a short-lived URL — the browser never receives the bytes.
 */
export async function flyerGenerationResultAction(eventId: string): Promise<ActionResult<FlyerArtState>> {
  return runAction<FlyerArtState>("events.flyer.result", "check the AI art", async () => {
    const { db, centerId } = await flyerEventContext(eventId, "only event managers and this event's lead can make this event's flyer.");
    const { data, error } = await db.rpc("events_flyer_result", { p_event: eventId });
    if (error) throw new DbFailure(error, "check the AI art");
    const job = readArtJob(data);
    if (job.status !== "image" && job.status !== "stored") return { ok: true, data: job };
    // A finished Poster layer is kept by the art library (flyer-art-actions.ts), never as this event's background.
    if (job.layer) return { ok: true, data: { status: "none" } };

    let artPath: string;
    if (job.status === "stored") {
      if (!isFlyerArtPath(job.storedPath, centerId, eventId)) return { ok: true, data: { status: "failed", reason: "The stored art belongs to another event. Generate it again." } };
      artPath = job.storedPath;
    } else {
      const bytes = Buffer.from(job.imageB64, "base64");
      const kind = sniffImage(bytes);
      if (kind !== "image/jpeg" && kind !== "image/png") {
        console.error(`[events/flyer] the AI art for event ${eventId} is ${kind ?? "not an image"} (${bytes.length} bytes)`);
        return { ok: true, data: { status: "failed", reason: "The AI service sent back a picture the flyer maker can't use. Generate it again." } };
      }
      artPath = `${centerId}/events/${eventId}/art-${Date.now()}.${kind === "image/png" ? "png" : "jpg"}`;
      const up = await db.storage.from("content").upload(artPath, bytes, { contentType: kind, upsert: false });
      if (up.error) {
        console.error(`[events/flyer] upload to content/${artPath} failed:`, up.error);
        storageFailure(up.error, "store the AI art");
      }
      const taken = await db.rpc("events_flyer_art_taken", { p_event: eventId, p_path: artPath });
      if (taken.error) throw new DbFailure(taken.error, "the art was stored, but the background job could not be updated");
    }
    const signed = await db.storage.from("content").createSignedUrl(artPath, 600);
    if (signed.error || !signed.data?.signedUrl) {
      console.error(`[events/flyer] could not sign content/${artPath}:`, signed.error);
      throw new FormError(`the art was made, but it could not be shown (${signed.error?.message || "storage refused the request"}).`);
    }
    return { ok: true, data: { status: "ready", artPath, artUrl: signed.data.signedUrl } };
  });
}

// ── Album photos ─────────────────────────────────────────────────────────────

export type FlyerPhotoAlbum = { id: string; title: string; visibility: string; isEventAlbum: boolean };
export type FlyerPhotoChoice = { id: string; caption: string | null; thumbUrl: string | null; problem: string | null };
export type FlyerPhotoList = { albums: FlyerPhotoAlbum[]; albumId: string | null; photos: FlyerPhotoChoice[] };

/** Albums members can see, and one album's usable photos (approved, no children, a format the renderer can draw). */
export async function listFlyerPhotosAction(eventId: string, albumId: string | null): Promise<ActionResult<FlyerPhotoList>> {
  return runAction<FlyerPhotoList>("events.flyer.photos", "load the photo albums", async () => {
    const { db, centerId, session, access } = await flyerEventContext(eventId, "only event managers and this event's lead can make this event's flyer.");
    if (!isModuleEnabled(session, "content")) {
      return { ok: false, error: "Photo albums are switched off (Settings › Modules) — choose a pattern or AI art instead." };
    }
    // Members read albums that are not staff-only; content managers read all of them (RLS). Anyone else sees none.
    if (!session.person && !can(access, "content.manage")) return { ok: false, error: "You don't have access to the photo albums." };
    const albums = await db
      .from("photo_albums")
      .select("id, title, visibility, event_id, created_at")
      .eq("center_id", centerId)
      .neq("visibility", "private")
      .order("created_at", { ascending: false })
      .limit(100);
    if (albums.error) throw new DbFailure(albums.error, "load the photo albums");
    const list: FlyerPhotoAlbum[] = (albums.data ?? []).map((a) => ({ id: a.id, title: a.title, visibility: a.visibility, isEventAlbum: a.event_id === eventId }));
    if (!list.length) return { ok: true, data: { albums: [], albumId: null, photos: [] } };
    const chosen = (albumId && list.find((a) => a.id === albumId)) || list.find((a) => a.isEventAlbum) || list[0];
    const photos = await db
      .from("photos")
      .select("id, storage_path, caption, created_at")
      .eq("album_id", chosen.id)
      .eq("status", "approved")
      .eq("contains_children", false)
      .not("storage_path", "ilike", "%.heic")
      .not("storage_path", "ilike", "%.heif")
      .not("storage_path", "ilike", "%.webp")
      .not("storage_path", "ilike", "%.mp4")
      .not("storage_path", "ilike", "%.mov")
      .order("created_at", { ascending: false })
      .limit(60);
    if (photos.error) throw new DbFailure(photos.error, "load the album's photos");
    const rows = photos.data ?? [];
    const urls = await signedPhotoUrls(db, rows);
    return {
      ok: true,
      data: {
        albums: list,
        albumId: chosen.id,
        photos: rows.map((p) => ({ id: p.id, caption: p.caption?.trim() || null, thumbUrl: urls.get(p.id)?.url ?? null, problem: urls.get(p.id)?.problem ?? null })),
      },
    };
  });
}

// ── Saving ───────────────────────────────────────────────────────────────────

/** "Use this flyer": render the design at full size, store it, make it the event's flyer, tidy older files. */
export async function saveDesignedFlyerAction(eventId: string, rawDesign: unknown): Promise<ActionResult> {
  return runAction("events.flyer.save_design", "save the flyer", async () => {
    const parsed = parseFlyerDesign(rawDesign);
    if (!parsed.ok) throw new FormError(parsed.error);
    const design = parsed.design;
    if (design.size === "print") throw new FormError("Print size is for downloading — switch to Post, Tall or Story to use it as the event's flyer.");
    const { db, centerId, session } = await flyerEventContext(eventId, "only event managers and this event's lead can set this event's flyer.");
    const ev = await db.from("events").select("id, center_id, flyer_path, starts_at, ends_at, venue").eq("id", eventId).maybeSingle();
    if (ev.error) throw new DbFailure(ev.error, "load the event");
    if (!ev.data || ev.data.center_id !== centerId) throw new FormError("that event was not found.");

    let png: Uint8Array;
    try {
      png = (
        await composeFlyer({
          db,
          centerId,
          centerName: session.center.name,
          branding: session.center.branding,
          eventId,
          design,
          scale: "full",
          contentModuleOn: isModuleEnabled(session, "content"),
        })
      ).png;
    } catch (err) {
      if (err instanceof FlyerBackgroundError || err instanceof FlyerBusyError || err instanceof FlyerFontsMissingError) throw new FormError(err.message);
      throw err;
    }

    const path = `${centerId}/events/${eventId}/flyer-${Date.now()}.png`;
    const up = await db.storage.from("content").upload(path, Buffer.from(png), { contentType: "image/png", upsert: false });
    if (up.error) {
      console.error(`[events/flyer] upload to content/${path} failed:`, up.error);
      storageFailure(up.error, "save the flyer");
    }
    const patch: TablesUpdate<"events"> = {
      flyer_path: path,
      flyer_source: "designed",
      // made_for: the event's start, end and venue now, so a later change to the event is flagged (flyerOutOfDate).
      flyer_design: { ...design, made_for: flyerMadeFor(ev.data) } as unknown as Json,
      flyer_prompt: design.background.source === "ai" ? withArtGuardrail(design.background.prompt) : null,
      flyer_generated_at: new Date().toISOString(),
    };
    const res = await db.from("events").update(patch).eq("id", eventId).select("id");
    if (res.error) throw new DbFailure(res.error, "the flyer was made, but the event could not be updated to use it");
    if (!res.data?.length) throw new FormError("you can't edit this event.");
    const previous = ownFlyerKey(ev.data.flyer_path, centerId, eventId);
    const tidy = await cleanup(db, eventId, [previous !== path ? previous : null]);
    revalidate(eventId);
    return { ok: true, message: withCleanupNote("Flyer saved.", tidy) };
  });
}

/** Manual upload, in place of a designed flyer. */
export async function uploadEventFlyerAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const eventId = String(fd.get("event_id") ?? "");
  return runAction("events.flyer.upload", "upload the flyer", async () => {
    const { db, centerId } = await flyerEventContext(eventId, "only event managers and this event's lead can upload this event's flyer.");
    const f = fd.get("file");
    const file = f && typeof f === "object" && "arrayBuffer" in f ? (f as File) : null;
    const check = checkUpload(file, FLYER_TYPES, FLYER_MAX_BYTES, "flyer");
    if (!check.ok) throw new FormError(check.error);
    const before = await db.from("events").select("flyer_path").eq("id", eventId).maybeSingle();
    if (before.error) throw new DbFailure(before.error, "load the event");
    const path = `${centerId}/events/${eventId}/flyer-${Date.now()}-${safeFileName(file!.name || `flyer.${extensionFor(file!.type)}`)}`;
    const up = await db.storage.from("content").upload(path, file!, { contentType: file!.type, upsert: false });
    if (up.error) {
      console.error(`[events/flyer] upload to content/${path} failed:`, up.error);
      storageFailure(up.error, "upload the flyer");
    }
    const patch: TablesUpdate<"events"> = { flyer_path: path, flyer_source: "manual", flyer_prompt: null, flyer_design: null, flyer_generated_at: null };
    const res = await db.from("events").update(patch).eq("id", eventId).select("id");
    if (res.error) throw new DbFailure(res.error, "the flyer was uploaded, but the event could not be updated to use it");
    if (!res.data?.length) throw new FormError("you can't edit this event.");
    const tidy = await cleanup(db, eventId, [ownFlyerKey(before.data?.flyer_path, centerId, eventId)]);
    revalidate(eventId);
    return { ok: true, message: withCleanupNote("Flyer uploaded.", tidy) };
  });
}

/** Remove the current flyer: the event stops using it and its file is deleted, so members and guests stop seeing it. */
export async function removeEventFlyerAction(eventId: string, _prev: ActionResult | null, _fd: FormData): Promise<ActionResult> {
  void _fd;
  return runAction("events.flyer.remove", "remove the flyer", async () => {
    const { db, centerId } = await flyerEventContext(eventId, "only event managers and this event's lead can remove this event's flyer.");
    const before = await db.from("events").select("flyer_path").eq("id", eventId).maybeSingle();
    if (before.error) throw new DbFailure(before.error, "load the event");
    const patch: TablesUpdate<"events"> = { flyer_path: null, flyer_source: null, flyer_prompt: null, flyer_design: null, flyer_generated_at: null };
    const res = await db.from("events").update(patch).eq("id", eventId).select("id");
    if (res.error) throw new DbFailure(res.error, "remove the flyer");
    if (!res.data?.length) throw new FormError("you can't edit this event.");
    const tidy = await cleanup(db, eventId, [ownFlyerKey(before.data?.flyer_path, centerId, eventId)]);
    revalidate(eventId);
    return { ok: true, message: withCleanupNote("Flyer removed.", tidy) };
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
    const signed = await db.storage.from("content").createSignedUrl(path.replace(/^content\//, ""), 600);
    if (signed.error) {
      console.error(`[events/flyer] could not sign content/${path}:`, signed.error);
      throw new FormError(`${signed.error.message || "storage refused the request"}.`);
    }
    return { ok: true, data: { url: signed.data.signedUrl } };
  });
}
