// Poster art layers (owner decision 2026-10-02, "approach C"): our layout and
// every word are set by code; only the ARTWORK — a frame around the poster and
// a scene along its bottom — may come from an image model, with no text in it.
// Pure (no server imports): the flyer panel, the server and the worker
// (worker/src/handlers/events.generate_flyer.ts imports the model list) share it.
//
// Every occasion has a code-drawn pack (src/lib/events/flyer-art-packs.ts) that
// costs nothing and always works. With a Gemini key saved in Platform › Setup ›
// AI flyer art, an organizer may also ask Google Gemini for a text-free frame
// or scene. Each one is generated ONCE and kept in the content bucket at
//
//   content/<center>/flyer-art/<occasion>/<frame|scene>-<seed>.<png|jpg>
//
// so every later flyer for that occasion in the same community reuses it for
// free; "Generate another" picks a new seed (and costs again). The organizer
// sees the price before anything is asked for.

// Relative imports: the background service (worker/) imports this file and does not know the "@/" alias.
import {
  FLYER_OCCASIONS,
  occasionsFor,
  preselectOccasion,
  suggestOccasion,
  type FlyerOccasion,
  type OccasionKind,
} from "./flyer-occasions";

// ── Occasions ────────────────────────────────────────────────────────────────
// The occasions are DATA: src/lib/events/flyer-occasions.ts (which kinds and traditions each is for, its season, its
// art pack, its prompt words). These names stay here for the files that always imported them from this one.

export { FLYER_OCCASIONS, FLYER_OCCASION_LABEL, isFlyerOccasion, occasionLabel, type FlyerOccasion } from "./flyer-occasions";

/**
 * The occasions a poster can be drawn for in this community, in the order it sees them (flyer-occasions.ts decides,
 * by kind and tradition): a Jain community has all eight Flyers v2 occasions plus the ones every community has, a
 * church its own, a chamber its own, and everyone "Other occasion". `current`: a poster's occasion stays listed.
 */
export function flyerOccasionsFor(kind: OccasionKind, current?: FlyerOccasion | null, tradition?: string | null): readonly FlyerOccasion[] {
  return occasionsFor(kind, tradition, current);
}

/**
 * The occasion that suits an event, from its name (and description): the organizer can always choose another. With a
 * community, only its own occasions are considered and its kind's default is the fallback; without one, every occasion.
 */
export function occasionFor(name: string, description?: string | null, community?: { kind: OccasionKind; tradition?: string | null } | null): FlyerOccasion {
  if (community) return preselectOccasion(suggestOccasion({ title: name, description, kind: community.kind, tradition: community.tradition }));
  return preselectOccasion(suggestOccasion({ title: name, description, kind: null }));
}

// AI frames and scenes work for every occasion in the catalog: the database checks only an occasion key's SHAPE
// (0703, FLYER_OCCASION_KEY_SHAPE), and the allow-list is the catalog, checked here (isFlyerOccasion) by the portal's
// actions, the cache paths below and the background service.

// ── Layers ───────────────────────────────────────────────────────────────────

export type FlyerLayerKind = "frame" | "scene";
export const FLYER_LAYER_KINDS: readonly FlyerLayerKind[] = ["frame", "scene"];
export const FLYER_LAYER_LABEL: Record<FlyerLayerKind, string> = { frame: "Frame", scene: "Bottom scene" };

/** One layer of a Poster: the pack's code-drawn art, a cached AI picture, or nothing. */
export type FlyerLayer = { source: "code" } | { source: "ai"; path: string } | { source: "none" };

/** The aspect ratio each layer is asked for (Gemini's response_format.aspect_ratio): a portrait frame, a wide strip. */
export const FLYER_LAYER_ASPECT: Record<FlyerLayerKind | "background", string> = { frame: "2:3", scene: "21:9", background: "2:3" };

export const FLYER_ART_SEED_MAX = 2_147_483_647;

/**
 * A number for a new picture: 1 to 2^31 - 1. It names the picture in the art
 * library (its cache key) so "Generate another" never overwrites an earlier one;
 * it is not sent to Gemini (Google's pages for these models list no seed).
 */
export function newArtSeed(random: () => number = Math.random): number {
  return 1 + Math.floor(random() * (FLYER_ART_SEED_MAX - 1));
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const LAYER_PATH = new RegExp(`^(${UUID})/flyer-art/(${FLYER_OCCASIONS.join("|")})/(frame|scene)-([1-9][0-9]{0,9})\\.(png|jpg)$`, "i");

/** The cache key of one AI layer: content/<center>/flyer-art/<occasion>/<layer>-<seed>.<ext>. */
export function flyerArtPath(centerId: string, occasion: FlyerOccasion, layer: FlyerLayerKind, seed: number, ext: "png" | "jpg"): string {
  if (!new RegExp(`^${UUID}$`, "i").test(centerId)) throw new Error("flyerArtPath: not a community id");
  if (!Number.isInteger(seed) || seed < 1 || seed > FLYER_ART_SEED_MAX) throw new Error("flyerArtPath: the seed is out of range");
  return `${centerId.toLowerCase()}/flyer-art/${occasion}/${layer}-${seed}.${ext}`;
}

export type ParsedArtPath = { centerId: string; occasion: FlyerOccasion; layer: FlyerLayerKind; seed: number; ext: "png" | "jpg" };

/** The parts of a layer's cache key, or null when the path is not one. */
export function parseFlyerArtPath(path: string): ParsedArtPath | null {
  const m = LAYER_PATH.exec(path.trim());
  if (!m) return null;
  const [, centerId = "", occasion = "", layer = "", seedText = "", ext = ""] = m;
  const seed = Number(seedText);
  if (!Number.isSafeInteger(seed) || seed > FLYER_ART_SEED_MAX) return null;
  return { centerId: centerId.toLowerCase(), occasion: occasion.toLowerCase() as FlyerOccasion, layer: layer.toLowerCase() as FlyerLayerKind, seed, ext: ext.toLowerCase() as "png" | "jpg" };
}

/** Is this a cached layer of THIS community (and, when given, of this occasion and kind)? */
export function isCenterArtPath(path: string, centerId: string, occasion?: FlyerOccasion, layer?: FlyerLayerKind): boolean {
  const p = parseFlyerArtPath(path);
  return Boolean(p && p.centerId === centerId.toLowerCase() && (!occasion || p.occasion === occasion) && (!layer || p.layer === layer));
}

/** The folder that holds one occasion's cached layers (for listing). */
export function flyerArtFolder(centerId: string, occasion: FlyerOccasion): string {
  return `${centerId.toLowerCase()}/flyer-art/${occasion}`;
}

// ── Models and what a picture costs ──────────────────────────────────────────
// Gemini API prices for one 1K image, from ai.google.dev/gemini-api/docs/pricing
// (read 2026-10-02): Flash Lite Image $0.0336, Flash Image $0.067, Pro Image
// $0.134. Rounded UP to whole cents for the organizer (money is integer cents
// everywhere in Weaver). Pictures are asked for at the model's
// default size (1K, the only size Flash Lite makes), so the price is the 1K
// price. None of these has a free tier: the owner's Google Cloud project needs
// billing. gemini-2.5-flash-image is not offered: Google shuts it down on
// 2026-10-02 (a platform setting that still names it falls back to the default).

export const FLYER_ART_MODELS = {
  "gemini-3.1-flash-lite-image": { label: "Gemini 3.1 Flash Lite Image", cents: 4 },
  "gemini-3.1-flash-image": { label: "Gemini 3.1 Flash Image", cents: 7 },
  "gemini-3-pro-image": { label: "Gemini 3 Pro Image", cents: 14 },
} as const satisfies Record<string, { label: string; cents: number }>;
export type FlyerArtModel = keyof typeof FLYER_ART_MODELS;
export const FLYER_ART_MODEL_IDS = Object.keys(FLYER_ART_MODELS) as FlyerArtModel[];

/** The default when Platform › Setup names no model: the current generation's cost-efficient model (stable). */
export const DEFAULT_FLYER_ART_MODEL: FlyerArtModel = "gemini-3.1-flash-lite-image";

export function isFlyerArtModel(v: unknown): v is FlyerArtModel {
  return typeof v === "string" && v in FLYER_ART_MODELS;
}

/** The model to use: GEMINI_IMAGE_MODEL when it is one we know the price of, else the default. */
export function flyerArtModel(setting: string | null | undefined): FlyerArtModel {
  const v = (setting ?? "").trim();
  return isFlyerArtModel(v) ? v : DEFAULT_FLYER_ART_MODEL;
}

/** "about 4¢", "about $1.20" — what one picture costs, in plain words. */
export function formatArtCost(cents: number): string {
  const c = Math.max(0, Math.ceil(cents));
  return c < 100 ? `about ${c}¢` : `about $${(c / 100).toFixed(2)}`;
}

/**
 * At most this many AI pictures a day per community, layers and backgrounds together (app.flyer_art_daily_limit, 0585:
 * a runaway page cannot run up the bill; tests/events-flyer-art.test.ts keeps the two numbers equal).
 */
export const FLYER_ART_DAILY_LIMIT = 30;

/** What a picture costs and who pays, before anything is generated: the owner's Google account pays, never the community. */
export function artPriceSentence(model: FlyerArtModel): string {
  const m = FLYER_ART_MODELS[model];
  return `Each new picture costs ${formatArtCost(m.cents)} (${m.label}). Weaver pays for it; nothing is charged to your community. A community can make ${FLYER_ART_DAILY_LIMIT} pictures a day.`;
}

/** The sentence shown before a layer is generated: the price, and that pictures already made are free to reuse. */
export function artCostSentence(model: FlyerArtModel): string {
  return `${artPriceSentence(model)} Pictures already made for this occasion are free to reuse.`;
}

/**
 * The first letter of a free-text art description that is not Latin (a Gujarati or Devanagari letter, say), or null. The
 * blocked-word check (FLYER_ART_BLOCKED_TERMS) reads English words only, so a description in another script would get past
 * it: backgrounds are described in English (the flyer's own words can be in any language).
 */
export function firstNonEnglishLetter(text: string): string | null {
  const m = /(?!\p{Script=Latin})\p{L}/u.exec(text);
  return m ? m[0] : null;
}

/** The sentence for an organizer whose description has a letter `foreign` that the safety check cannot read. */
export function englishOnlyNote(foreign: string): string {
  return `Please describe the background art in English: the check that keeps people, deities and lettering out of AI art reads English words only, and the description has "${foreign}". The flyer's own words can be in any language.`;
}

// ── Is AI art available? (app.flyer_art_status, 0585) ────────────────────────

export const NO_GEMINI_KEY = "AI art needs a Gemini key — ask your Weaver admin (Platform › Setup).";
export const ART_SERVICE_DOWN = "The background service is not running, so AI art can't be made right now. The drawn art always works.";
export const ART_SERVICE_OLD = "The background service needs updating before it can make AI art (ask your Weaver admin to redeploy). The drawn art always works.";

export type FlyerArtReadiness =
  | { state: "ready"; model: FlyerArtModel; cents: number }
  /** `unknown`: the status could not be read (the portal says why); the drawn art still works. */
  | { state: "no_key" | "no_service" | "update_needed" | "unknown"; message: string };

/** What app.flyer_art_status answered, read defensively. */
export function readFlyerArtStatus(raw: unknown): FlyerArtReadiness {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (o.state === "ready") {
    const model = flyerArtModel(typeof o.model === "string" ? o.model : null);
    return { state: "ready", model, cents: FLYER_ART_MODELS[model].cents };
  }
  if (o.state === "no_key") return { state: "no_key", message: NO_GEMINI_KEY };
  if (o.state === "update_needed") return { state: "update_needed", message: ART_SERVICE_OLD };
  return { state: "no_service", message: ART_SERVICE_DOWN };
}

/** One picture in the community's art library: content/<center>/flyer-art/<occasion>/<layer>-<seed>.<ext>. */
export type FlyerArtEntry = {
  path: string;
  layer: FlyerLayerKind;
  occasion: FlyerOccasion;
  seed: number;
  /** A short-lived signed URL, or null when it could not be made. */
  url: string | null;
};

/**
 * Opening the flyer panel again finds the last picture asked for, every time (the job keeps its stored file). It is worth
 * saying "a picture you asked for earlier is ready" only when it is news: made for the occasion on screen, not already
 * among the pictures listed and not already on the poster.
 */
export function isNewPicture(entry: FlyerArtEntry, on: { occasion: FlyerOccasion; listed: readonly { path: string }[]; poster: Record<FlyerLayerKind, FlyerLayer> }): boolean {
  if (entry.occasion !== on.occasion) return false;
  if (on.listed.some((e) => e.path === entry.path)) return false;
  const chosen = on.poster[entry.layer];
  return !(chosen.source === "ai" && chosen.path === entry.path);
}

/** What the flyer panel knows about AI art when it opens (and after each change). */
export type FlyerArtSetup = {
  readiness: FlyerArtReadiness;
  entries: FlyerArtEntry[];
  /** A plain sentence when the library could not be listed. */
  problem: string | null;
};

/** Asking Gemini for a layer, and checking on it: never the picture's bytes, only a stored file's entry. */
export type FlyerArtProgress =
  | { status: "none" | "queued" | "running" }
  | { status: "failed" | "unavailable"; reason: string }
  | { status: "ready"; entry: FlyerArtEntry };

// ── The prompts (code-set; the organizer never types them) ───────────────────
// Built from the occasion catalog in src/lib/events/flyer-art-prompt.ts. None may contain a blocked word
// (tests/events-flyer-art.test.ts checks every one); the worker appends FLYER_LAYER_GUARDRAIL as the last sentence and
// checks again.

export { FLYER_LAYER_PROMPTS } from "./flyer-art-prompt";
