// AI flyer art guardrail (owner decision 2026-10-01): every AI request is for
// BACKGROUND ART only. The flyer maker adds the words itself, so the image
// must carry no text or letters, and the community's rule is no people and
// no deities, idols or murtis — abstract or decorative only.
//
// This file and the portal's src/lib/events/flyer.ts hold IDENTICAL copies of
// FLYER_ART_BLOCKED_TERMS and FLYER_ART_GUARDRAIL; tests/events-flyer.test.ts
// fails if they ever differ. Dependency-free on purpose (the worker bundles it).
//
// The check is a pre-filter, not a guarantee: Pollinations' free model may
// still draw a figure or letters, so the organizer always looks at the
// preview before using the art.

/** Whole words, matched case-insensitively. */
export const FLYER_ART_BLOCKED_TERMS: readonly string[] = [
  // People
  "people", "person", "persons", "man", "men", "woman", "women", "child", "children", "kid", "kids",
  "boy", "boys", "girl", "girls", "baby", "family", "families", "face", "faces", "portrait", "crowd",
  "human", "humans", "monk", "monks", "nun", "sadhu", "sadhvi", "maharaj", "maharajsaheb",
  // Deities and idols
  "god", "gods", "goddess", "deity", "deities", "idol", "idols", "murti", "murtis", "statue", "statues",
  "bhagwan", "bhagavan", "prabhu", "tirthankar", "tirthankara", "jina", "mahavir", "mahavira",
  "parshvanath", "parasnath", "adinath", "rishabhdev", "neminath", "shantinath", "buddha", "krishna",
  "shiva", "ganesh", "ganesha", "lakshmi", "saraswati", "jesus",
  // Lettering
  "text", "letter", "letters", "lettering", "word", "words", "typography", "caption", "logo", "writing",
  "calligraphy", "font", "quote",
];

/** Always appended to the prompt, exactly once. */
export const FLYER_ART_GUARDRAIL =
  "Abstract decorative background art only. No text, no letters, no numbers, no words, no writing, no logos, no watermarks. " +
  "No people, no human figures, no faces, no hands. No deities, no gods, no idols, no murtis, no religious figures or statues. " +
  "Soft, elegant, festive ornamental patterns and light, with calm open space for text to be added later.";

const BLOCKED = new RegExp(`\\b(?:${FLYER_ART_BLOCKED_TERMS.join("|")})\\b`, "i");

/** The prompt without any copy of the guardrail (the guardrail itself names the blocked words). */
export function stripArtGuardrail(text: string): string {
  return text.split(FLYER_ART_GUARDRAIL).join(" ").replace(/\s{2,}/g, " ").trim();
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
