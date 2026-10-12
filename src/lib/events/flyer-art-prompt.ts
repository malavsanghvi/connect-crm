// The AI art prompts (B96, 2026-10-11), built from DATA: the occasion's own words in the catalog (flyer-occasions.ts),
// what the community is (its tradition or kind, in a few fixed words), the season, its brand colours, the style of its
// past flyers and, for "Other occasion", the organizer's own short description. A small fixed rubric closes every
// prompt: a calm middle for the words, respectful treatment of sacred symbols, flat print-ready artwork. The guardrail
// (no lettering, no deities, no people up close) is appended by whoever sends the prompt (withLayerGuardrail /
// withArtGuardrail), exactly once.
//
// Never in a prompt: the event's name or description (a title can name a person, or a child), any member's name, the
// community's name. The title only chooses the occasion (suggestOccasion).
//
// Pure, relative imports only: the background service (worker/src/handlers/events.generate_flyer.ts) builds the
// layer prompt itself from the facts the portal sends (readArtFacts), so a request made straight to the database
// cannot put its own words into a picture shared with the whole community, beyond the checked description.

import type { FlyerLayerKind } from "./flyer-art";
import {
  flyerTraditionFor,
  seasonOf,
  FLYER_KIND_CONTEXT,
  FLYER_OCCASIONS,
  FLYER_TRADITION_CONTEXT,
  isFlyerOccasion,
  isFlyerTradition,
  occasionSpec,
  type FlyerOccasion,
  type FlyerTradition,
  type OccasionKind,
  type OccasionPrompt,
  type SeasonWord,
} from "./flyer-occasions";

// ── Colour names ─────────────────────────────────────────────────────────────

const NAMED_COLORS: readonly { name: string; rgb: [number, number, number] }[] = [
  { name: "deep navy", rgb: [0x1b, 0x2c, 0x5c] },
  { name: "royal blue", rgb: [0x2f, 0x5b, 0xd3] },
  { name: "sky blue", rgb: [0x7f, 0xb8, 0xe6] },
  { name: "teal", rgb: [0x1f, 0x7a, 0x7a] },
  { name: "emerald green", rgb: [0x1f, 0x7a, 0x4d] },
  { name: "sage green", rgb: [0x9c, 0xb8, 0x9a] },
  { name: "saffron", rgb: [0xe0, 0x82, 0x1c] },
  { name: "marigold gold", rgb: [0xe6, 0xb4, 0x2c] },
  { name: "maroon", rgb: [0x7a, 0x2e, 0x1f] },
  { name: "crimson red", rgb: [0xc0, 0x26, 0x2d] },
  { name: "rose pink", rgb: [0xe5, 0x8f, 0xa8] },
  { name: "plum purple", rgb: [0x5b, 0x4b, 0x8a] },
  { name: "ivory cream", rgb: [0xfb, 0xf7, 0xf0] },
  { name: "charcoal grey", rgb: [0x3a, 0x3a, 0x3a] },
];

/** The nearest of a dozen named colours, for a prompt ("saffron", "deep navy"); "warm" when the value is not a hex colour. */
export function colorWord(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "warm";
  const n = parseInt(m[1]!, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  let best = NAMED_COLORS[0]!;
  let bestD = Infinity;
  for (const c of NAMED_COLORS) {
    // Weighted RGB distance ("redmean"), close enough to how people see colour for naming.
    const rm = (r + c.rgb[0]) / 2;
    const dr = r - c.rgb[0];
    const dg = g - c.rgb[1];
    const db = b - c.rgb[2];
    const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best.name;
}

// ── The facts a prompt is built from ─────────────────────────────────────────

/** The look of the community's past flyers, from the templates it chose (festival, classic, minimal). */
export type FlyerStyle = "festive" | "classic" | "minimal";
export const FLYER_STYLES: readonly FlyerStyle[] = ["festive", "classic", "minimal"];
const STYLE_WORDS: Record<FlyerStyle, string> = {
  festive: "rich, festive and ornate, like this community's past flyers",
  classic: "classic and formal, balanced and symmetrical, like this community's past flyers",
  minimal: "clean and minimal with generous plain space, like this community's past flyers",
};

const SEASON_WORDS: Record<SeasonWord, string> = {
  winter: "crisp winter light with evergreen and frost accents",
  spring: "fresh spring light with blossoms and new leaves",
  summer: "bright summer light with full green leaves",
  autumn: "warm autumn light with amber and russet leaves",
};

/** The style of past flyers: the template chosen most often among them (at least twice), else none. */
export function styleFromTemplates(templates: readonly string[]): FlyerStyle | null {
  const counts: Record<FlyerStyle, number> = { festive: 0, classic: 0, minimal: 0 };
  for (const t of templates) {
    if (t === "festival") counts.festive++;
    else if (t === "classic") counts.classic++;
    else if (t === "minimal") counts.minimal++;
  }
  const ranked = FLYER_STYLES.map((s) => [s, counts[s]] as const).sort((a, b) => b[1] - a[1]);
  const [first, second] = ranked;
  if (!first || first[1] < 2 || (second && second[1] === first[1])) return null;
  return first[0];
}

export const ART_NOTE_MAX = 160;

/** What a prompt is built from. Everything but the occasion and the layer is optional; nothing in it names a person. */
export type FlyerArtFacts = {
  occasion: FlyerOccasion;
  layer: FlyerLayerKind | "background";
  /** The organization kind's key ("church", "chamber_of_commerce"): only its fixed context words reach the prompt. */
  kind?: string | null;
  faith?: boolean | null;
  tradition?: FlyerTradition | null;
  season?: SeasonWord | null;
  /** The brand kit's colours (hex). */
  colours?: { primary: string; secondary: string; paper: string } | null;
  style?: FlyerStyle | null;
  /** "Other occasion": the organizer's own short description (English, checked for blocked words before it is sent). */
  note?: string | null;
};

const HEX = /^#[0-9A-F]{6}$/i;
const KIND_KEY = /^[a-z][a-z0-9_]{0,48}$/;
const SEASONS: readonly SeasonWord[] = ["winter", "spring", "summer", "autumn"];

/** A note as it may be sent: one line, trimmed, at most ART_NOTE_MAX characters. */
export function cleanArtNote(v: unknown): string {
  if (typeof v !== "string") return "";
  return Array.from(v.replace(/\s+/g, " ").trim()).slice(0, ART_NOTE_MAX).join("").trim();
}

/**
 * The facts for one picture, from what the portal knows: the occasion, the community's kind (and tradition), the date
 * and country (for the season), the brand kit and the style of past flyers, and the organizer's description for "Other
 * occasion" (kept only for that occasion). The event's name and description are never among them.
 */
export function artFactsFor(a: {
  occasion: FlyerOccasion;
  layer: FlyerLayerKind | "background";
  kind?: OccasionKind | null;
  tradition?: string | null;
  startsAt?: string | null;
  country?: string | null;
  tz?: string | null;
  brand?: { primary: string; accent: string; background: string } | null;
  style?: FlyerStyle | null;
  note?: string | null;
}): FlyerArtFacts {
  const hex = (v: string | undefined) => (v && HEX.test(v) ? v.toUpperCase() : null);
  const p = hex(a.brand?.primary);
  const s = hex(a.brand?.accent);
  const bg = hex(a.brand?.background);
  return {
    occasion: a.occasion,
    layer: a.layer,
    kind: a.kind && KIND_KEY.test(a.kind.key) ? a.kind.key : null,
    faith: a.kind ? Boolean(a.kind.faithBased) : null,
    tradition: a.kind ? flyerTraditionFor(a.kind, a.tradition) : null,
    season: seasonOf(a.startsAt, a.country, a.tz),
    colours: p && s && bg ? { primary: p, secondary: s, paper: bg } : null,
    style: a.style ?? null,
    note: a.occasion === "other" ? cleanArtNote(a.note) || null : null,
  };
}

/** The facts as the portal sends them to the database (app.events_request_flyer_art's p_prompt). */
export function encodeArtFacts(f: FlyerArtFacts): string {
  return JSON.stringify({ flyer_art_facts: 1, ...f, note: f.note ? cleanArtNote(f.note) : null });
}

/**
 * The facts in a request, every field checked (anything malformed is dropped, never passed on), or null when the
 * request is not a facts request (an older portal sent the finished prompt text: the occasion's base prompt is used).
 */
export function readArtFacts(raw: unknown): FlyerArtFacts | null {
  if (typeof raw !== "string" || !raw.trim().startsWith("{")) return null;
  let o: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    o = v as Record<string, unknown>;
  } catch {
    return null;
  }
  if (o.flyer_art_facts !== 1 || !isFlyerOccasion(o.occasion)) return null;
  if (o.layer !== "frame" && o.layer !== "scene" && o.layer !== "background") return null;
  const c = o.colours && typeof o.colours === "object" && !Array.isArray(o.colours) ? (o.colours as Record<string, unknown>) : null;
  const colours =
    c && typeof c.primary === "string" && typeof c.secondary === "string" && typeof c.paper === "string" && HEX.test(c.primary) && HEX.test(c.secondary) && HEX.test(c.paper)
      ? { primary: c.primary, secondary: c.secondary, paper: c.paper }
      : null;
  const note = cleanArtNote(o.note);
  return {
    occasion: o.occasion,
    layer: o.layer,
    kind: typeof o.kind === "string" && KIND_KEY.test(o.kind) ? o.kind : null,
    faith: typeof o.faith === "boolean" ? o.faith : null,
    tradition: isFlyerTradition(o.tradition) ? o.tradition : null,
    season: typeof o.season === "string" && (SEASONS as readonly string[]).includes(o.season) ? (o.season as SeasonWord) : null,
    colours,
    style: typeof o.style === "string" && (FLYER_STYLES as readonly string[]).includes(o.style) ? (o.style as FlyerStyle) : null,
    note: note || null,
  };
}

// ── The prompts ──────────────────────────────────────────────────────────────

const FRAME_BRIEF =
  "A decorative border frame for a tall, upright poster, ornaments only along the four edges and in the corners, " +
  "the whole centre left as a large, plain, empty, evenly lit area in the background colour, flat and calm, for type to be set on later. " +
  "High detail, crisp edges, elegant print design.";
const SCENE_BRIEF =
  "A wide panoramic illustration for the bottom strip of a poster, everything sitting low along the bottom edge, " +
  "the top third fading to a plain soft sky that blends into the background colour. Flat illustrated style, rich colour, crisp shapes.";

/** The fixed rubric, after the occasion's own words (the guardrail comes after it). */
export const ART_RUBRIC =
  "Keep the middle calm and uncluttered so the poster's own type reads clearly over it. " +
  "Any sacred symbol is shown small, simple and in its conventional form, with respect: never cropped, distorted, upside down or on the ground.";

/** The occasion's words for this community's tradition (its own variant when the catalog has one). */
function occasionWords(occasion: FlyerOccasion, tradition: FlyerTradition | null | undefined): OccasionPrompt {
  const spec = occasionSpec(occasion);
  const own = tradition ? spec.promptByTradition?.[tradition] : undefined;
  return { ...spec.prompt, ...(own ?? {}) };
}

/** The few words for whom the art is made: the tradition's, else the kind's, else faith-based or not. */
export function communityContext(f: Pick<FlyerArtFacts, "kind" | "faith" | "tradition">): string {
  if (f.tradition) return FLYER_TRADITION_CONTEXT[f.tradition];
  if (f.kind && FLYER_KIND_CONTEXT[f.kind]) return FLYER_KIND_CONTEXT[f.kind]!;
  return f.faith ? "a faith community" : "a community organization";
}

function colourSentence(f: FlyerArtFacts): string | null {
  if (!f.colours) return null;
  const primary = colorWord(f.colours.primary);
  const secondary = colorWord(f.colours.secondary);
  const paper = colorWord(f.colours.paper);
  const pair = primary === secondary ? primary : `${primary} and ${secondary}`;
  if (occasionSpec(f.occasion).colours === "fixed") return `Keep the traditional colours described, with small touches of ${pair}.`;
  return `Colour palette from the community's brand: ${pair} on ${paper}, with natural colours wherever nature needs them (flames, sky, leaves).`;
}

function sentences(f: FlyerArtFacts, words: OccasionPrompt): string[] {
  const spec = occasionSpec(f.occasion);
  const out: string[] = [];
  if (f.note) out.push(`The occasion, as the organizer describes it: ${f.note.replace(/[.\s]+$/, "")}.`);
  if (f.kind || f.tradition || typeof f.faith === "boolean") out.push(`Made for ${communityContext(f)}.`);
  const colours = colourSentence(f);
  if (colours) out.push(colours);
  if (f.season && !spec.season) out.push(`Season: ${SEASON_WORDS[f.season]}.`);
  if (f.style) out.push(`Style: ${STYLE_WORDS[f.style]}.`);
  out.push(ART_RUBRIC);
  if (words.avoid) out.push(`Avoid ${words.avoid.replace(/[.\s]+$/, "")}.`);
  return out;
}

/** A Poster layer's prompt (frame or bottom scene), before the guardrail. */
export function buildLayerPrompt(f: FlyerArtFacts & { layer: FlyerLayerKind }): string {
  const words = occasionWords(f.occasion, f.tradition);
  const brief = f.layer === "frame" ? FRAME_BRIEF : SCENE_BRIEF;
  return [brief, f.layer === "frame" ? words.frame : words.scene, ...sentences(f, words)].join(" ");
}

/**
 * The starting description for AI BACKGROUND art (Classic, Festival, Minimal templates): the occasion's motif in the
 * brand's named colours. The organizer may edit it; the guardrail is added when it is sent (withArtGuardrail).
 */
export function buildBackgroundPrompt(f: Omit<FlyerArtFacts, "layer">): string {
  const words = occasionWords(f.occasion, f.tradition);
  const primary = f.colours ? colorWord(f.colours.primary) : "warm";
  const secondary = f.colours ? colorWord(f.colours.secondary) : "warm";
  const tones = primary === secondary ? `${primary} tones` : `${primary} and ${secondary} tones`;
  const note = f.note ? ` suited to ${f.note.replace(/[.\s]+$/, "")},` : "";
  const season = f.season && !occasionSpec(f.occasion).season ? ` ${SEASON_WORDS[f.season]},` : "";
  return `An elegant, festive background of ${words.background},${note}${season} in ${tones}, softly lit, with a smooth gradient and generous calm space in the middle.`;
}

/** Each occasion's base prompts, for a request that carries no community facts (and for the tests). */
export const FLYER_LAYER_PROMPTS: Readonly<Record<FlyerOccasion, Record<FlyerLayerKind, string>>> = Object.fromEntries(
  FLYER_OCCASIONS.map((o) => [o, { frame: buildLayerPrompt({ occasion: o, layer: "frame" }), scene: buildLayerPrompt({ occasion: o, layer: "scene" }) }]),
) as Record<FlyerOccasion, Record<FlyerLayerKind, string>>;
