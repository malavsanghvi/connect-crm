import "server-only";

// The flyer maker's server-side loading: the chosen background (a pattern, an
// approved album photo, this event's AI art) and the brand logo, as data URIs
// for next/og, and composeFlyer(), which the render route and the "Use this
// flyer" action share.
//
// Everything is read AS THE SIGNED-IN ORGANIZER (their Supabase session), so
// the database's own rules decide what they may use: the photo row under RLS,
// AI art from the content bucket under the 0578 read rule. Photos must be
// approved, must not show children, and must come from an album that is not
// staff-only — a guest-visible flyer shows the photo to anyone.
//
// Remote fetches are narrow on purpose: Google Photos images only from
// lh3–lh6.googleusercontent.com (an imported album photo, 0564), logos only
// over https from a named host (never an IP address or localhost), each hop of
// a redirect checked again, with timeouts and size caps. A residual risk stays:
// a logo host whose name later resolves to a private address (DNS rebinding).

import type { Json } from "@/lib/database.types";
import { photoLocation } from "@/lib/content";
import { explainError } from "@/lib/errors";
import { isGoogleImageBase } from "@/lib/google-photos";
import type { AppSupabase } from "@/lib/supabase/server";

import { isFlyerArtPath, isPartnerLogoPath, memberAppEventLink, type FlyerBackground, type FlyerDesign, type FlyerSize, type FlyerTemplate, type PosterContent } from "./flyer";
import { FLYER_LAYER_LABEL, isCenterArtPath, type FlyerLayerKind } from "./flyer-art";
import {
  LOGO_DARK_NOTE,
  LOGO_DARK_WEBP_NOTE,
  LOGO_NOTE,
  LOGO_WEBP_MARK_NOTE,
  logoTypeNote,
  readFlyerBrand,
  type FlyerBrand,
} from "./flyer-brand";
import { imageSize, sniffImage, type ImageKind } from "./flyer-image";
import { patternSvg } from "./flyer-patterns";
import type { PosterAssets } from "./flyer-poster";
import { backgroundBox, flyerDims, patternColorsFor, renderFlyerPng, type FlyerDims, type FlyerImage } from "./flyer-render";

/** The background can't be used: the route answers 422 and the panel shows the sentence next to the background picker. */
export class FlyerBackgroundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlyerBackgroundError";
  }
}

// ── Bytes ────────────────────────────────────────────────────────────────────
export { imageSize, sniffImage };

function dataUri(bytes: Uint8Array, kind: ImageKind): string {
  return `data:${kind};base64,${Buffer.from(bytes).toString("base64")}`;
}

const UNUSABLE_FORMAT = "This photo is in a format the flyer maker can't use (WebP/HEIC). Choose another photo, or upload a JPEG or PNG.";

/** A background picture the renderer can draw (JPEG, PNG or GIF), or the reason it can't. */
function asBackground(bytes: Uint8Array, what: "photo" | "art"): FlyerImage {
  const kind = sniffImage(bytes);
  if (kind === "image/jpeg" || kind === "image/png" || kind === "image/gif") return { dataUri: dataUri(bytes, kind), ...imageSize(bytes, kind) };
  if (kind === "image/webp" || kind === "image/heic" || kind === "image/avif") {
    throw new FlyerBackgroundError(what === "photo" ? UNUSABLE_FORMAT : "The AI art came back in a format the flyer maker can't use. Generate it again.");
  }
  throw new FlyerBackgroundError(what === "photo" ? "That photo's file is not a picture the flyer maker can read. Choose another photo." : "The AI art file is not a picture the flyer maker can read. Generate it again.");
}

// ── Remote fetches ───────────────────────────────────────────────────────────
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** https, a named host (not an IP address, not localhost or a local-only name), the default port. */
export function isFetchableLogoUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || (u.port && u.port !== "443") || u.username || u.password) return false;
  if (!host || IPV4.test(host) || host.includes(":") || host.startsWith("[")) return false;
  if (host === "localhost" || /\.(?:localhost|local|internal|lan|home|arpa)$/.test(host) || !host.includes(".")) return false;
  return true;
}

function isGooglePhotoHost(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && /^lh[3-6]\.googleusercontent\.com$/.test(u.hostname) && !u.port;
  } catch {
    return false;
  }
}

async function fetchCapped(url: string, o: { maxBytes: number; timeoutMs: number; accept: string; allow: (url: string) => boolean }): Promise<Uint8Array> {
  const signal = AbortSignal.timeout(o.timeoutMs);
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!o.allow(current)) throw new Error(`refused to fetch ${new URL(current).host}`);
    const res = await fetch(current, { redirect: "manual", signal, headers: { Accept: o.accept } });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error(`a ${res.status} redirect without a location`);
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`answered ${res.status}`);
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > o.maxBytes) throw new Error(`the file is larger than ${Math.round(o.maxBytes / 1024 / 1024)} MB`);
    if (!res.body) return new Uint8Array(await res.arrayBuffer());
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > o.maxBytes) {
        await reader.cancel();
        throw new Error(`the file is larger than ${Math.round(o.maxBytes / 1024 / 1024)} MB`);
      }
      parts.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.byteLength;
    }
    return out;
  }
  throw new Error("too many redirects");
}

/** Small in-memory cache for remote images (previews ask again every few seconds while the organizer types). */
const remoteCache = new Map<string, { at: number; bytes: Uint8Array }>();
const CACHE_MS = 5 * 60 * 1000;
const CACHE_ENTRIES = 16;

async function cachedFetch(url: string, o: Parameters<typeof fetchCapped>[1]): Promise<Uint8Array> {
  const hit = remoteCache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.bytes;
  const bytes = await fetchCapped(url, o);
  remoteCache.set(url, { at: Date.now(), bytes });
  while (remoteCache.size > CACHE_ENTRIES) remoteCache.delete(remoteCache.keys().next().value as string);
  return bytes;
}

// ── Background ───────────────────────────────────────────────────────────────
export type LoadedBackground = { image: FlyerImage | null; notes: string[] };

export async function loadBackground(
  db: AppSupabase,
  centerId: string,
  eventId: string,
  bg: FlyerBackground,
  o: { box: FlyerDims; template: FlyerTemplate; size: FlyerSize; brand: FlyerBrand; contentModuleOn: boolean },
): Promise<LoadedBackground> {
  if (bg.source === "plain") return { image: null, notes: [] };

  if (bg.source === "pattern") {
    const svg = patternSvg(bg.pattern, { w: o.box.w, h: o.box.h, ...patternColorsFor(o.template, o.brand) });
    return { image: { dataUri: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, w: o.box.w, h: o.box.h }, notes: [] };
  }

  if (bg.source === "ai") {
    if (!isFlyerArtPath(bg.path, centerId, eventId)) throw new FlyerBackgroundError("That AI art belongs to another event. Generate the art again for this event.");
    const { data, error } = await db.storage.from("content").download(bg.path);
    if (error || !data) {
      console.error(`[events/flyer] could not download the AI art content/${bg.path}:`, error);
      throw new FlyerBackgroundError("The AI art could not be loaded — it may have been tidied away. Generate it again, or choose another background.");
    }
    return { image: asBackground(new Uint8Array(await data.arrayBuffer()), "art"), notes: [] };
  }

  // An album photo.
  if (!o.contentModuleOn) throw new FlyerBackgroundError("Photo albums are switched off (Settings › Modules) — choose a pattern or AI art instead.");
  const photo = await db.from("photos").select("id, center_id, album_id, storage_path, status, contains_children").eq("id", bg.photo_id).maybeSingle();
  if (photo.error) {
    console.error("[events/flyer] could not read the photo row:", photo.error);
    throw new FlyerBackgroundError(`The photo could not be loaded — ${explainError(photo.error)}.`);
  }
  const p = photo.data;
  if (!p || p.center_id !== centerId) throw new FlyerBackgroundError("That photo is no longer available, or you can't see it. Choose another photo.");
  if (p.status !== "approved") throw new FlyerBackgroundError("That photo is not approved for sharing. Choose another photo.");
  if (p.contains_children) throw new FlyerBackgroundError("Photos showing children can't be used on a flyer. Choose another photo.");
  const album = await db.from("photo_albums").select("id, visibility").eq("id", p.album_id).maybeSingle();
  if (album.error) {
    console.error("[events/flyer] could not read the photo's album:", album.error);
    throw new FlyerBackgroundError(`The photo's album could not be loaded — ${explainError(album.error)}.`);
  }
  if (!album.data || album.data.visibility === "private") {
    throw new FlyerBackgroundError("Photos from staff-only albums can't be used on a flyer. Choose a photo from an album members can see.");
  }
  const loc = photoLocation(p.storage_path);
  if (!loc) throw new FlyerBackgroundError("That photo has no file attached. Choose another photo.");
  if (loc.kind === "storage") {
    const { data, error } = await db.storage.from(loc.bucket).download(loc.key);
    if (error || !data) {
      console.error(`[events/flyer] could not download ${loc.bucket}/${loc.key}:`, error);
      throw new FlyerBackgroundError("The photo could not be loaded from storage. Choose another photo.");
    }
    return { image: asBackground(new Uint8Array(await data.arrayBuffer()), "photo"), notes: [] };
  }
  if (!isGoogleImageBase(loc.url)) throw new FlyerBackgroundError("This photo's address can't be used on a flyer. Choose another photo.");
  const url = `${loc.url.trim()}${o.size === "print" ? "=w2400" : "=w1600"}`;
  let bytes: Uint8Array;
  try {
    bytes = await cachedFetch(url, { maxBytes: 15 * 1024 * 1024, timeoutMs: 15_000, accept: "image/jpeg,image/png", allow: isGooglePhotoHost });
  } catch (err) {
    console.error("[events/flyer] could not fetch the Google Photos image:", err);
    throw new FlyerBackgroundError("The photo could not be fetched from Google Photos. Try again, or choose another photo.");
  }
  return { image: asBackground(bytes, "photo"), notes: [] };
}

// ── The Poster's pictures ────────────────────────────────────────────────────

/** One file from the content bucket as a picture the renderer can draw (PNG or JPEG), or the reason it can't be used. */
async function contentPicture(db: AppSupabase, path: string): Promise<{ image: FlyerImage } | { problem: string }> {
  const { data, error } = await db.storage.from("content").download(path);
  if (error || !data) {
    console.error(`[events/flyer] could not download content/${path}:`, error);
    return { problem: "it could not be loaded (it may have been discarded)" };
  }
  const bytes = new Uint8Array(await data.arrayBuffer());
  const kind = sniffImage(bytes);
  if (kind !== "image/png" && kind !== "image/jpeg") {
    console.error(`[events/flyer] content/${path} is ${kind ?? "not a picture"}`);
    return { problem: "it is not a PNG or JPEG picture" };
  }
  return { image: { dataUri: dataUri(bytes, kind), ...imageSize(bytes, kind) } };
}

/**
 * The AI layers and the partner's logo a poster uses. Never throws: a layer
 * that can't be used falls back to the drawn art, and the logo to the badge,
 * each with a note for the organizer (the poster is still made).
 */
export async function loadPosterAssets(db: AppSupabase, centerId: string, eventId: string, poster: PosterContent): Promise<{ assets: PosterAssets; notes: string[] }> {
  const notes: string[] = [];
  const layer = async (kind: FlyerLayerKind): Promise<FlyerImage | null> => {
    const l = poster[kind];
    if (l.source !== "ai") return null;
    const what = FLYER_LAYER_LABEL[kind].toLowerCase();
    if (!isCenterArtPath(l.path, centerId, poster.occasion, kind)) {
      notes.push(`The AI ${what} belongs to another community or occasion, so the drawn ${what} was used.`);
      return null;
    }
    const got = await contentPicture(db, l.path);
    if ("problem" in got) {
      notes.push(`The AI ${what} couldn't be used — ${got.problem} — so the drawn ${what} was used. Choose another, or generate a new one.`);
      return null;
    }
    return got.image;
  };
  const partner = async (): Promise<FlyerImage | null> => {
    const path = poster.partner.on ? poster.partner.logo_path : null;
    if (!path) return null;
    if (!isPartnerLogoPath(path, centerId, eventId)) {
      notes.push("The partner logo was uploaded for another event, so the partner badge was drawn instead. Upload it again here.");
      return null;
    }
    const got = await contentPicture(db, path);
    if ("problem" in got) {
      notes.push(`The partner logo couldn't be used — ${got.problem} — so the partner badge was drawn instead. Upload it again.`);
      return null;
    }
    return got.image;
  };
  const [frame, scene, partnerLogo] = await Promise.all([layer("frame"), layer("scene"), partner()]);
  return { assets: { frame, scene, partnerLogo }, notes };
}

// ── Logo ─────────────────────────────────────────────────────────────────────
type LoadedLogo = { image: FlyerImage | null; note: string | null; webp: boolean };

/** The brand logo as a data URI (SVG, PNG or JPEG), or null with a note (a WebP file says so). No logo configured is not a problem. */
export async function loadLogo(url: string | null): Promise<LoadedLogo> {
  if (!url) return { image: null, note: null, webp: false };
  if (!isFetchableLogoUrl(url)) {
    console.error(`[events/flyer] the logo address is not one the flyer maker fetches: ${url}`);
    return { image: null, note: LOGO_NOTE, webp: false };
  }
  try {
    const bytes = await cachedFetch(url, { maxBytes: 5 * 1024 * 1024, timeoutMs: 5000, accept: "image/svg+xml,image/png,image/jpeg", allow: isFetchableLogoUrl });
    const kind = sniffImage(bytes);
    if (kind !== "image/svg+xml" && kind !== "image/png" && kind !== "image/jpeg") {
      console.error(`[events/flyer] the logo ${url} is ${kind ?? "not a picture"}, which the flyer maker can't draw`);
      return { image: null, note: logoTypeNote(kind) ?? LOGO_NOTE, webp: kind === "image/webp" };
    }
    return { image: { dataUri: dataUri(bytes, kind), ...imageSize(bytes, kind) }, note: null, webp: false };
  } catch (err) {
    console.error(`[events/flyer] could not load the logo ${url}:`, err);
    return { image: null, note: LOGO_NOTE, webp: false };
  }
}

/** The logo for light backgrounds; a WebP logo falls back to the square mark when that is a file the renderer can draw. */
async function loadMainLogo(brand: FlyerBrand): Promise<LoadedLogo> {
  const logo = await loadLogo(brand.logoUrl);
  if (!logo.webp || !brand.markUrl || brand.markUrl === brand.logoUrl) return logo;
  const mark = await loadLogo(brand.markUrl);
  return mark.image ? { image: mark.image, note: LOGO_WEBP_MARK_NOTE, webp: false } : logo;
}

// ── The whole flyer ──────────────────────────────────────────────────────────
export type ComposeArgs = {
  db: AppSupabase;
  centerId: string;
  centerName: string;
  branding: Json;
  eventId: string;
  design: FlyerDesign;
  scale: "preview" | "full";
  contentModuleOn: boolean;
};

/** Load the background and logo, then render. Throws FlyerBackgroundError (422), FlyerBusyError (503) or FlyerFontsMissingError. */
export async function composeFlyer(a: ComposeArgs): Promise<{ png: Uint8Array; notes: string[]; dims: FlyerDims }> {
  const brand = readFlyerBrand(a.branding, process.env.NEXT_PUBLIC_SUPABASE_URL);
  const dims = flyerDims(a.design.size, a.scale);
  const box = backgroundBox(a.design.template, dims);
  const wantsDarkLogo = a.design.template === "festival" && Boolean(brand.logoDarkUrl);
  const isPoster = a.design.template === "poster" && Boolean(a.design.poster);
  const [bg, logo, logoDark, poster] = await Promise.all([
    // The Poster draws its own art pack; the background chosen for the other templates is kept but not loaded.
    isPoster
      ? Promise.resolve<LoadedBackground>({ image: null, notes: [] })
      : loadBackground(a.db, a.centerId, a.eventId, a.design.background, { box, template: a.design.template, size: a.design.size, brand, contentModuleOn: a.contentModuleOn }),
    loadMainLogo(brand),
    wantsDarkLogo ? loadLogo(brand.logoDarkUrl) : Promise.resolve<LoadedLogo>({ image: null, note: null, webp: false }),
    isPoster ? loadPosterAssets(a.db, a.centerId, a.eventId, a.design.poster!) : Promise.resolve(null),
  ]);
  const notes = [...bg.notes, ...(poster?.notes ?? [])];
  if (logo.note) notes.push(logo.note);
  if (wantsDarkLogo && logoDark.note) notes.push(logoDark.webp ? LOGO_DARK_WEBP_NOTE : LOGO_DARK_NOTE);
  const r = await renderFlyerPng(
    {
      design: a.design,
      brand,
      centerName: a.centerName,
      background: bg.image,
      logo: logo.image,
      logoDark: logoDark.image,
      qrLink: memberAppEventLink(process.env.NEXT_PUBLIC_MEMBER_APP_URL, a.eventId),
      posterAssets: poster?.assets,
    },
    a.scale,
  );
  return { png: r.png, notes: [...new Set([...notes, ...r.notes])], dims: r.dims };
}
