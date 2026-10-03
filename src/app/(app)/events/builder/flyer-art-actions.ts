"use server";

// Flyers v2 (owner decision 2026-10-02, approach C): the Poster's art.
//
// Every occasion has art drawn in code (free, always there). With a Gemini key
// saved in Platform › Setup, an organizer may also ask Google Gemini for a
// text-free frame or bottom scene. Each picture is made once, costs about 4¢
// (shown before anything is asked), and is kept in the community's art library
// (content/<center>/flyer-art/…) for every later flyer to reuse. The logic is
// in src/lib/events/flyer-art-library.ts (tested there); these actions only
// check who is asking and answer in plain English. Every Storage write and
// delete runs as the signed-in organizer, so app.can_write_object (0585) decides.
//
// A partner's logo is uploaded here too: it is kept in the event's own folder
// (partner-<ms>.png|jpg) and the design records its path.

import { eventActionContext } from "@/lib/data/events";
import type { ActionResult } from "@/lib/errors";
import { eventAreas } from "@/lib/events/access";
import { isFlyerOccasion, type FlyerArtProgress, type FlyerArtSetup, type FlyerLayerKind, type FlyerOccasion } from "@/lib/events/flyer-art";
import { collectFlyerArt, discardFlyerArt, flyerArtReadiness, listFlyerArt, requestFlyerArt, storePartnerLogo } from "@/lib/events/flyer-art-library";
import { FormError, runAction } from "@/lib/events/forms";
import { isUuid } from "@/lib/search-params";

const DENIED = "only event managers and this event's lead can make this event's flyer.";

async function artContext(eventId: string) {
  if (!isUuid(eventId)) throw new FormError("that event was not found.");
  return eventActionContext((a) => eventAreas.edit(a, eventId), DENIED);
}

function occasionOf(v: unknown): FlyerOccasion {
  if (!isFlyerOccasion(v)) throw new FormError("choose an occasion for the poster's art.");
  return v;
}

/** AI art as the panel needs it: is it available (and at what price), and the pictures kept for this occasion. */
export async function loadFlyerArtAction(eventId: string, occasion: string): Promise<ActionResult<FlyerArtSetup>> {
  return runAction<FlyerArtSetup>("events.flyer_art.load", "load the AI art", async () => {
    const o = occasionOf(occasion);
    const { db, centerId } = await artContext(eventId);
    const [readiness, library] = await Promise.all([flyerArtReadiness(db, centerId), listFlyerArt(db, centerId, o)]);
    return { ok: true, data: { readiness, entries: library.entries, problem: library.problem } };
  });
}

/**
 * Ask Gemini for one layer of this occasion's art. Never needed for the drawn
 * art. Answers that it was queued, or why not (no key, the service is down or
 * out of date, the day's limit) — the panel shows the sentence as it is.
 */
export async function requestFlyerArtAction(eventId: string, occasion: string, layer: string): Promise<ActionResult<FlyerArtProgress>> {
  return runAction<FlyerArtProgress>("events.flyer_art.request", "ask for AI art", async () => {
    const o = occasionOf(occasion);
    if (layer !== "frame" && layer !== "scene") throw new FormError("ask for a frame or a bottom scene.");
    const { db, centerId } = await artContext(eventId);
    return { ok: true, data: await requestFlyerArt(db, { eventId, centerId, occasion: o, layer: layer as FlyerLayerKind }) };
  });
}

/**
 * Check on the picture being made. When it is done, the SERVER keeps it in the
 * art library (as the organizer) and answers with its entry; the browser never
 * receives the bytes.
 */
export async function collectFlyerArtAction(eventId: string): Promise<ActionResult<FlyerArtProgress>> {
  return runAction<FlyerArtProgress>("events.flyer_art.collect", "check the AI art", async () => {
    const { db, centerId } = await artContext(eventId);
    return { ok: true, data: await collectFlyerArt(db, { eventId, centerId }) };
  });
}

/** Take a picture out of the community's art library for good (flyers already saved with it keep looking the same). */
export async function discardFlyerArtAction(eventId: string, path: string): Promise<ActionResult> {
  return runAction("events.flyer_art.discard", "discard the picture", async () => {
    const { db, centerId } = await artContext(eventId);
    await discardFlyerArt(db, centerId, typeof path === "string" ? path : "");
    return { ok: true, message: "Picture discarded." };
  });
}

/** Upload a partner's logo (PNG or JPEG) for this event's poster; answers the stored path and a short-lived preview URL. */
export async function uploadPartnerLogoAction(eventId: string, fd: FormData): Promise<ActionResult<{ path: string; url: string | null }>> {
  return runAction<{ path: string; url: string | null }>("events.flyer_art.partner_logo", "upload the partner logo", async () => {
    const { db, centerId } = await artContext(eventId);
    const f = fd.get("file");
    const file = f && typeof f === "object" && "arrayBuffer" in f ? (f as File) : null;
    if (!file || file.size === 0) throw new FormError("choose a PNG or JPEG file first.");
    const stored = await storePartnerLogo(db, { centerId, eventId, bytes: new Uint8Array(await file.arrayBuffer()) });
    return { ok: true, message: "Partner logo uploaded.", data: stored };
  });
}
