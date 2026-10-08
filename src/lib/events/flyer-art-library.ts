// The community's AI art library, server side (Flyers v2, owner decision
// 2026-10-02, approach C). Not marked `server-only` so its tests can import it;
// it takes the signed-in organizer's Supabase client, so every read and write
// runs as them and the database's rules decide (0585: app.can_read_object,
// app.can_write_object, app.flyer_art_writer, app.events_request_flyer_art).
//
// An AI layer is generated ONCE and kept at
//
//   content/<center>/flyer-art/<occasion>/<frame|scene>-<seed>.<png|jpg>
//
// so every later flyer for that occasion in the same community reuses it for
// free. The worker returns the picture's bytes inside the job's result (it
// holds no Storage key); collectFlyerArt() stores them at that key as the
// organizer and then has the database drop the bytes from the job
// (app.events_flyer_art_taken). A paid picture is never lost: asking for
// another first stores any finished one that was not collected yet.

import { explainError } from "@/lib/errors";
import type { AppSupabase } from "@/lib/supabase/server";

import { DbFailure, FormError } from "./forms";
import { findBlockedArtTerm, readArtJob, withLayerGuardrail } from "./flyer";
import {
  FLYER_LAYER_PROMPTS,
  flyerArtFolder,
  flyerArtPath,
  isCenterArtPath,
  newArtSeed,
  parseFlyerArtPath,
  readFlyerArtStatus,
  type FlyerArtEntry,
  type FlyerArtProgress,
  type FlyerArtReadiness,
  type FlyerLayerKind,
  type FlyerOccasion,
} from "./flyer-art";
import { MAX_PICTURE_PIXELS, MAX_PICTURE_SIDE, oversizePicture, sniffImage } from "./flyer-image";

const BUCKET = "content";
/** How long a picture's signed URL works (an hour: the panel is open while the organizer chooses). */
const URL_SECONDS = 3600;
/** The most pictures listed for one occasion (the library is small: an organizer asks for a handful). */
const LIST_LIMIT = 100;
const NO_STORAGE = "the content storage area is not set up on this server yet. Ask Weaver to create it.";

type StorageLike = { message?: string; statusCode?: string | number; status?: number; error?: string };

function storageProblem(error: StorageLike, doing: string): never {
  if (/bucket not found/i.test(error.message ?? "")) throw new FormError(NO_STORAGE);
  throw new DbFailure(error, doing);
}

/** The storage API says "already exists" (409, "Duplicate") when a file is already at that key. */
function alreadyThere(error: StorageLike): boolean {
  return String(error.statusCode ?? error.status ?? "") === "409" || /already exists|duplicate/i.test(`${error.message ?? ""} ${error.error ?? ""}`);
}

// ── Is AI art available? ─────────────────────────────────────────────────────

/** app.flyer_art_status, read for the panel: ready (with the price), or why not, in plain English. Never throws. */
export async function flyerArtReadiness(db: AppSupabase, centerId: string): Promise<FlyerArtReadiness> {
  try {
    const res = await db.rpc("flyer_art_status", { p_center: centerId });
    if (res.error) {
      console.error("[events/flyer] could not read the AI art status:", res.error);
      return { state: "unknown", message: `Could not check whether AI art is available — ${explainError(res.error)}. The drawn art always works.` };
    }
    return readFlyerArtStatus(res.data);
  } catch (err) {
    console.error("[events/flyer] could not read the AI art status:", err);
    return { state: "unknown", message: "Could not check whether AI art is available. The drawn art always works." };
  }
}

// ── The library ──────────────────────────────────────────────────────────────

/** Signed URLs for library pictures; a picture that can't be signed is listed without one (the panel says so). */
async function signEntries(db: AppSupabase, files: { path: string; layer: FlyerLayerKind; occasion: FlyerOccasion; seed: number }[]): Promise<FlyerArtEntry[]> {
  if (!files.length) return [];
  const signed = await db.storage.from(BUCKET).createSignedUrls(
    files.map((f) => f.path),
    URL_SECONDS,
  );
  if (signed.error) console.error("[events/flyer] could not sign the AI art library:", signed.error);
  const urls = new Map<string, string>();
  for (const s of signed.data ?? []) if (s.path && s.signedUrl && !s.error) urls.set(s.path, s.signedUrl);
  return files.map((f) => ({ ...f, url: urls.get(f.path) ?? null }));
}

/** The pictures kept for one occasion, newest first. Never throws: a library that can't be listed says why. */
export async function listFlyerArt(db: AppSupabase, centerId: string, occasion: FlyerOccasion): Promise<{ entries: FlyerArtEntry[]; problem: string | null }> {
  const folder = flyerArtFolder(centerId, occasion);
  try {
    const res = await db.storage.from(BUCKET).list(folder, { limit: LIST_LIMIT, sortBy: { column: "created_at", order: "desc" } });
    if (res.error) {
      console.error(`[events/flyer] could not list content/${folder}:`, res.error);
      return { entries: [], problem: `The AI pictures kept for this occasion could not be listed — ${explainError(res.error)}.` };
    }
    const files: { path: string; layer: FlyerLayerKind; occasion: FlyerOccasion; seed: number }[] = [];
    for (const f of res.data ?? []) {
      const path = `${folder}/${f.name}`;
      const p = parseFlyerArtPath(path);
      if (p && p.occasion === occasion && p.centerId === centerId.toLowerCase()) files.push({ path, layer: p.layer, occasion, seed: p.seed });
    }
    return { entries: await signEntries(db, files), problem: null };
  } catch (err) {
    console.error(`[events/flyer] could not list content/${folder}:`, err);
    return { entries: [], problem: "The AI pictures kept for this occasion could not be listed — the server did not respond. Try again." };
  }
}

/** One picture's entry (signed), from its key. */
async function entryFor(db: AppSupabase, centerId: string, path: string): Promise<FlyerArtEntry> {
  const p = parseFlyerArtPath(path);
  if (!p || p.centerId !== centerId.toLowerCase()) throw new FormError("that picture is not in your community's art library.");
  const [entry] = await signEntries(db, [{ path, layer: p.layer, occasion: p.occasion, seed: p.seed }]);
  if (!entry) throw new FormError("the picture could not be shown.");
  return entry;
}

// ── Asking for a picture, and collecting it ──────────────────────────────────

/**
 * Check on this event's AI art job. A finished layer picture is stored in the
 * library (once; asking again finds it) and answered as `ready`. A job that is
 * not a layer request (an older background request) is `none` here: the
 * background picker collects those.
 */
export async function collectFlyerArt(db: AppSupabase, a: { eventId: string; centerId: string }): Promise<FlyerArtProgress> {
  const { data, error } = await db.rpc("events_flyer_result", { p_event: a.eventId });
  if (error) throw new DbFailure(error, "check the AI art");
  const job = readArtJob(data);
  if (job.status !== "image" && job.status !== "stored") {
    if (job.status === "failed" || job.status === "unavailable") return { status: job.status, reason: job.reason };
    return { status: job.status };
  }
  if (!job.layer) return { status: "none" };

  let path: string;
  if (job.status === "stored") {
    if (!isCenterArtPath(job.storedPath, a.centerId, job.layer.occasion, job.layer.layer)) {
      return { status: "failed", reason: "The stored picture belongs to another community. Ask for it again." };
    }
    path = job.storedPath;
  } else {
    const bytes = Buffer.from(job.imageB64, "base64");
    const kind = sniffImage(bytes);
    if (kind !== "image/jpeg" && kind !== "image/png") {
      console.error(`[events/flyer] the AI art for event ${a.eventId} is ${kind ?? "not an image"} (${bytes.length} bytes)`);
      return { status: "failed", reason: "The AI service sent back a picture the flyer maker can't use. Ask for it again." };
    }
    path = flyerArtPath(a.centerId, job.layer.occasion, job.layer.layer, job.layer.seed, kind === "image/png" ? "png" : "jpg");
    const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: kind, upsert: false });
    // A picture already kept at this very key is the same picture: nothing is lost.
    if (up.error && !alreadyThere(up.error)) {
      console.error(`[events/flyer] upload to content/${path} failed:`, up.error);
      storageProblem(up.error, "keep the AI picture");
    }
    const taken = await db.rpc("events_flyer_art_taken", { p_event: a.eventId, p_path: path });
    if (taken.error) throw new DbFailure(taken.error, "the picture was kept, but the background job could not be updated");
  }
  const entry = await entryFor(db, a.centerId, path);
  // A job keeps its stored_path after its picture is discarded. A file that is gone is nothing to collect: answering `ready` for it
  // would put a picture with no preview back among the community's pictures every time the panel opens.
  if (job.status === "stored" && entry.url === null && (await isGone(db, path))) return { status: "none" };
  return { status: "ready", entry };
}

/** True only when storage says the file is not there (a missing file, or one this person may not see); any other trouble says false. */
async function isGone(db: AppSupabase, path: string): Promise<boolean> {
  try {
    const res = await db.storage.from(BUCKET).exists(path);
    return res.data === false;
  } catch (err) {
    console.error(`[events/flyer] could not check whether content/${path} still exists:`, err);
    return false;
  }
}

/**
 * Ask Gemini for one layer of an occasion's art. Only when AI art is ready (a key,
 * a running and current service); a finished picture that was not collected yet is
 * kept first, and only one request runs at a time. The prompt is code-set (never typed).
 */
export async function requestFlyerArt(
  db: AppSupabase,
  a: { eventId: string; centerId: string; occasion: FlyerOccasion; layer: FlyerLayerKind; seed?: number },
): Promise<FlyerArtProgress> {
  const ready = await flyerArtReadiness(db, a.centerId);
  if (ready.state !== "ready") return { status: "unavailable", reason: ready.message };

  const pending = await collectFlyerArt(db, a);
  if (pending.status === "queued" || pending.status === "running") return pending;

  const prompt = withLayerGuardrail(FLYER_LAYER_PROMPTS[a.occasion][a.layer]);
  const blocked = findBlockedArtTerm(prompt);
  if (blocked) {
    console.error(`[events/flyer] the built-in ${a.occasion} ${a.layer} prompt mentions "${blocked}"`);
    return { status: "failed", reason: "This picture can't be asked for: its built-in description names something AI art never shows. Tell Weaver." };
  }
  const res = await db.rpc("events_request_flyer_art", {
    p_event: a.eventId,
    p_occasion: a.occasion,
    p_layer: a.layer,
    p_seed: a.seed ?? newArtSeed(),
    p_prompt: prompt,
  });
  if (res.error) throw new DbFailure(res.error, "ask for AI art");
  const job = readArtJob(res.data);
  if (job.status === "queued" || job.status === "running") return { status: job.status };
  if (job.status === "unavailable" || job.status === "failed") return { status: job.status, reason: job.reason };
  return { status: "queued" };
}

/** Remove a picture from the community's library (the flyers already saved with it keep looking the same: they are images). */
export async function discardFlyerArt(db: AppSupabase, centerId: string, path: string): Promise<void> {
  if (!isCenterArtPath(path, centerId)) throw new FormError("that picture is not in your community's art library.");
  const res = await db.storage.from(BUCKET).remove([path]);
  if (res.error) {
    console.error(`[events/flyer] could not remove content/${path}:`, res.error);
    storageProblem(res.error, "discard the picture");
  }
  if (!(res.data ?? []).some((o) => o.name === path)) {
    throw new FormError("the picture was not discarded: it may already be gone, or you may not be allowed to remove it.");
  }
}

// ── The partner's logo ───────────────────────────────────────────────────────

export const PARTNER_LOGO_MAX_BYTES = 3 * 1024 * 1024;

/**
 * Keep an uploaded partner logo (PNG or JPEG) in this event's folder as
 * partner-<ms>.<ext>; the design records the path. An older logo is tidied away
 * with the event's other leftovers (0585 keeps the one the saved design uses).
 */
export async function storePartnerLogo(db: AppSupabase, a: { centerId: string; eventId: string; bytes: Uint8Array; now?: number }): Promise<{ path: string; url: string | null }> {
  if (a.bytes.length === 0) throw new FormError("that file is empty.");
  if (a.bytes.length > PARTNER_LOGO_MAX_BYTES) throw new FormError(`the partner logo is larger than ${PARTNER_LOGO_MAX_BYTES / 1024 / 1024} MB.`);
  const kind = sniffImage(a.bytes);
  if (kind !== "image/png" && kind !== "image/jpeg") throw new FormError("the partner logo must be a PNG or JPEG picture (WebP and HEIC can't be drawn on a flyer).");
  const big = oversizePicture(a.bytes, kind);
  if (big) {
    throw new FormError(
      `that picture measures ${big.w} × ${big.h} pixels, more than the flyer maker draws (up to ${MAX_PICTURE_SIDE} pixels on a side and ${MAX_PICTURE_PIXELS / 1_000_000} megapixels). Make it smaller and upload it again.`,
    );
  }
  const path = `${a.centerId.toLowerCase()}/events/${a.eventId.toLowerCase()}/partner-${a.now ?? Date.now()}.${kind === "image/png" ? "png" : "jpg"}`;
  const up = await db.storage.from(BUCKET).upload(path, a.bytes, { contentType: kind, upsert: false });
  if (up.error) {
    console.error(`[events/flyer] upload to content/${path} failed:`, up.error);
    storageProblem(up.error, "keep the partner logo");
  }
  const signed = await db.storage.from(BUCKET).createSignedUrl(path, URL_SECONDS);
  if (signed.error) console.error(`[events/flyer] could not sign content/${path}:`, signed.error);
  return { path, url: signed.data?.signedUrl ?? null };
}
