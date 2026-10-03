// AI flyer art guardrail (owner decisions 2026-10-01 and 2026-10-02): every AI
// request is for ART ONLY. The flyer maker sets every word itself, so the
// image must carry no text or letters, and the community's rule is no
// deities, idols or murtis and no people up close.
//
//   FLYER_ART_GUARDRAIL    a background behind a Classic / Festival / Minimal /
//                          Photo flyer: abstract or decorative only.
//   FLYER_LAYER_GUARDRAIL  a Poster art layer (frame or bottom scene, approach C,
//                          2026-10-02): every prompt ENDS with it.
//
// This file and the portal's src/lib/events/flyer.ts hold IDENTICAL copies of
// FLYER_ART_BLOCKED_TERMS and both guardrails; tests/events-flyer.test.ts
// fails if they ever differ. Dependency-free on purpose (the worker bundles it).
//
// The check is a pre-filter, not a guarantee: an image model may still draw a
// figure or letters, so the organizer always looks at the preview before
// using the art, and can discard it.

/** Whole words, matched case-insensitively, each also with a plural ending (-s or -es). */
export const FLYER_ART_BLOCKED_TERMS: readonly string[] = [
  // People
  "people", "person", "persons", "man", "men", "woman", "women", "child", "children", "kid", "kids",
  "boy", "boys", "girl", "girls", "baby", "babies", "family", "families", "face", "faces", "portrait", "crowd",
  "human", "humans", "monk", "monks", "nun", "sadhu", "sadhvi", "maharaj", "maharajsaheb", "muni", "acharya",
  "guru", "saint", "devotee", "dancer", "lady", "ladies", "figurine",
  // Deities and idols
  "god", "gods", "goddess", "deity", "deities", "idol", "idols", "murti", "murtis", "statue", "statues",
  "bhagwan", "bhagavan", "prabhu", "tirthankar", "tirthankara", "jina", "mahavir", "mahavira",
  "parshvanath", "parasnath", "adinath", "rishabhdev", "neminath", "shantinath", "padmavati", "buddha", "krishna",
  "shiva", "ganesh", "ganesha", "lakshmi", "saraswati", "durga", "amba", "ambe", "ambaji", "mataji", "devi",
  "hanuman", "vishnu", "jesus",
  // Lettering
  "text", "letter", "letters", "lettering", "word", "words", "typography", "caption", "logo", "writing",
  "calligraphy", "font", "quote",
];

/** Always appended to the prompt, exactly once. */
export const FLYER_ART_GUARDRAIL =
  "Abstract decorative background art only. No text, no letters, no numbers, no words, no writing, no logos, no watermarks. " +
  "No people, no human figures, no faces, no hands. No deities, no gods, no idols, no murtis, no religious figures or statues. " +
  "Soft, elegant, festive ornamental patterns and light, with calm open space for text to be added later.";

const BLOCKED = new RegExp(`\\b(?:${FLYER_ART_BLOCKED_TERMS.join("|")})(?:e?s)?\\b`, "i");

/** Always the LAST sentence of a Poster art layer's prompt, exactly once. */
export const FLYER_LAYER_GUARDRAIL =
  "No text of any kind: no letters, no numbers, no words, no writing, no signs, no labels, no logos, no watermarks. " +
  "No deities, no gods, no idols, no murtis, no religious figures or statues. " +
  "No close-up faces, no portraits, no hands, and no people in the foreground.";

/** The prompt without any copy of either guardrail (the guardrails themselves name the blocked words). */
export function stripArtGuardrail(text: string): string {
  return text.split(FLYER_ART_GUARDRAIL).join(" ").split(FLYER_LAYER_GUARDRAIL).join(" ").replace(/\s{2,}/g, " ").trim();
}

/** The first blocked word in the organizer's own text (as they typed it), or null. */
export function findBlockedArtTerm(text: string): string | null {
  const m = BLOCKED.exec(stripArtGuardrail(text));
  return m ? m[0] : null;
}

/** The organizer's text with the guardrail appended once; idempotent. Never longer than `max`: the guardrail is never cut. */
export function withArtGuardrail(text: string, max = 2000): string {
  const room = Math.max(0, max - FLYER_ART_GUARDRAIL.length - 1);
  const base = stripArtGuardrail(text).slice(0, room).trim();
  return base ? `${base} ${FLYER_ART_GUARDRAIL}` : FLYER_ART_GUARDRAIL;
}

/** A Poster layer's prompt ending with FLYER_LAYER_GUARDRAIL exactly once; idempotent. Never longer than `max`: the guardrail is never cut. */
export function withLayerGuardrail(text: string, max = 2000): string {
  const room = Math.max(0, max - FLYER_LAYER_GUARDRAIL.length - 1);
  const base = stripArtGuardrail(text).slice(0, room).trim();
  return base ? `${base} ${FLYER_LAYER_GUARDRAIL}` : FLYER_LAYER_GUARDRAIL;
}
