// What Niva's prompts say about the organization she works for. The words are the organization's kind's own
// (portal and database: app.organization_categories.terms.assistant_context, .school; faith_based; uses_tradition),
// so a new kind of organization needs a catalog row and no code change here.
//
// The conversation the database hands the worker (app.niva_worker_get_conversation) may carry them as `kind`:
//   { assistant_context: "a chamber of commerce", school: null, faith_based: false, uses_tradition: false }
// When it does not (a database that is not extended yet) the prompts are EXACTLY what they were before kinds
// existed, a Jain community's: a test compares them with a copy of the earlier text. That keeps JSH unchanged.

export type PromptWords = {
  /** How the prompt names the organization: "a Jain community", "a chamber of commerce" (terms.assistant_context). */
  community: string;
  /** A faith community: a question about doctrine or practice goes to a teacher or a leader. */
  faith: boolean;
  /** What the kind calls its religious school ("Pathshala"), or null when it has none. */
  school: string | null;
  /** The kind keeps a tradition (the Jain library applies): its own community words are the examples the prompts give. */
  tradition: boolean;
};

/** Today's wording: a Jain community. Used when the database says nothing about the kind. */
export const LEGACY_WORDS: PromptWords = { community: "a Jain community", faith: true, school: "Pathshala", tradition: true };

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Reads `conversation.kind`; anything missing or not the right shape means the legacy wording. */
export function promptWords(kind: unknown): PromptWords {
  if (typeof kind !== "object" || kind === null || Array.isArray(kind)) return LEGACY_WORDS;
  const k = kind as Record<string, unknown>;
  const community = text(k.assistant_context);
  if (!community) return LEGACY_WORDS;
  return {
    community,
    faith: k.faith_based === true,
    school: text(k.school),
    tradition: k.uses_tradition === true,
  };
}

/** "a Jain community" -> "Jain": the adjective a tradition's own practice is named by, or null when the term is not of that shape. */
export function traditionName(w: PromptWords): string | null {
  const m = /^an? (.+) community$/i.exec(w.community);
  return m?.[1] ?? null;
}

/** Rule 1: what Niva must not draw on from outside the sources. */
export function outsideKnowledgeOf(w: PromptWords): string {
  const name = w.tradition ? traditionName(w) : null;
  return name ? `${name} practice, this community, or anything else` : "this community or anything else";
}

/** Rule 3: a question about doctrine or practice (faith) or a decision (otherwise) and who to send the member to. */
export function judgmentRule(w: PromptWords): string {
  if (w.faith) {
    const who = w.school ? `a ${w.school} teacher` : "a leader of the community";
    return `Doctrinal or practice questions (what to do, what is permitted, the meaning or reasoning behind a practice): answer briefly from the sources, then say the member should speak with ${who} for anything beyond what the sources cover.`;
  }
  return "Questions that need a decision or a judgment (what is allowed, what to do): answer briefly from the sources, then say the member should ask the office for anything beyond what the sources cover.";
}

/** Rule 9: the languages and the community words Niva keeps. */
export function languageRule(w: PromptWords): string {
  return w.tradition
    ? "Reply in the language the member wrote in (English, Gujarati, Hindi or any other), keeping community words such as Derasar, Pathshala or Paryushan as they are."
    : "Reply in the language the member wrote in (English or any other), keeping the community's own words, such as the names of places and programs, as they are.";
}

/** The rewrite prompt's three pieces that name a community or its language. */
export function rewriteWords(w: PromptWords): { translate: string; keep: string; synonyms: string } {
  const name = w.tradition ? traditionName(w) : null;
  return w.tradition
    ? {
        translate: "Translate it when the member wrote in Gujarati, Hindi or any other language",
        keep: "Keep community words such as Derasar, Upashray, Pathshala, Paryushan, Ayambil or Navkarsi in their usual English spelling.",
        synonyms: `synonyms, other common spellings of ${name ?? "the community's"} terms, and the English for Gujarati or Hindi words`,
      }
    : {
        translate: "Translate it when the member wrote in another language",
        keep: "Keep the community's own words in their usual English spelling.",
        synonyms: "synonyms, other common spellings, and the English for words in other languages",
      };
}
