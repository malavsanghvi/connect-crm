// Reading what someone typed into the find box. BY RULES, on the page: no model, nothing leaves the server. The same function is
// used by the top-bar box, the People home box and, later, the one-box router (docs/UNIFIED_BOX.md, stage a and the filter stage).
//
// Order: a question first (it goes to Niva, or to a list if the rule-based reader understands it), then an e-mail, a phone number,
// an identifier (a number, a code with a digit, or a bank payer name), a sentence the People filters understand, else a name.
// Built for every organization: no word of any one language or tradition is needed to find a name or an ID, and the areas a
// sentence can mention come from the organization's own data (the vocabulary the caller passes in).

import { readAsk, type AskVocab } from "@/lib/people-v2/ask";

import type { Classified } from "./types";

/** Words a question starts with. A question is a question whether or not it ends with "?" (and any text that ends with "?" is one). */
const QUESTION_WORDS = ["who", "what", "which", "how", "when", "why", "show", "list"] as const;
const QUESTION_START = new RegExp(`^(?:${QUESTION_WORDS.join("|")})(?=\\s|$)`, "iu");

/** Words that only say what kind of number follows ("member 1042", "household no. 0212", "QuickBooks 88412"). */
const KIND_WORDS = new Set([
  "member", "members", "household", "households", "family", "families", "number", "num", "no", "no.", "id", "ids", "identifier",
  "customer", "quickbooks", "qb", "crm", "neon", "bank", "payer", "card", "code", "#", "old", "system",
]);

const MAX_LENGTH = 120;

export function squeeze(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_LENGTH);
}

export function isQuestion(text: string): boolean {
  const t = squeeze(text);
  return t.endsWith("?") || QUESTION_START.test(t);
}

/** The digits of a text. */
export function digitsOf(text: string): string {
  return text.replace(/\D/g, "");
}

const PHONE_CHARS = /^\+?[\d\s().-]+$/;

/**
 * A phone number or a part of one: only digits and the usual punctuation, at least 4 digits, and either 7 or more digits or some
 * visible phone formatting ("555-0142", "(415) 555", "+1 415 555 0134"). A bare 4-6 digit number is an identifier (a member
 * number, an old system's ID); the lookup tries both either way, and every row says why it matched.
 */
export function looksLikePhone(text: string): boolean {
  const t = squeeze(text);
  if (!PHONE_CHARS.test(t)) return false;
  const d = digitsOf(t);
  if (d.length < 4 || d.length > 15) return false;
  return d.length >= 7 || /[+().\s-]/.test(t);
}

function isEmailLike(text: string): boolean {
  const t = squeeze(text);
  return t.includes("@") && !/\s/.test(t) && t.replace(/@/g, "").length >= 2;
}

function hasLetter(text: string): boolean {
  return /\p{L}/u.test(text);
}

function isAllCapsWord(word: string): boolean {
  return /\p{L}/u.test(word) && word === word.toUpperCase() && word !== word.toLowerCase();
}

/** A bank payer name: quoted, or two or more words in capitals ("LOPEZ BAKERY LLC"), the way a bank statement writes it. */
function payerName(text: string): string | null {
  const quoted = /^["“'‘](.{3,})["”'’]$/u.exec(text);
  if (quoted) return quoted[1].trim();
  const words = text.split(" ");
  if (words.length >= 2 && words.every((w) => !/\d/.test(w) && isAllCapsWord(w.replace(/[.,&'’-]/g, "") || w)) && text.replace(/[^\p{L}]/gu, "").length >= 6) return text;
  return null;
}

/** The token that is an identifier when the words around it only say what kind of number it is, else null. */
function identifierToken(text: string): { token: string; shape: "code" | "number" } | null {
  const words = text.split(" ").filter(Boolean);
  const withDigit = words.filter((w) => /\d/.test(w));
  if (withDigit.length !== 1) return null;
  const token = withDigit[0];
  const others = words.filter((w) => w !== token).map((w) => w.toLowerCase().replace(/[:,]/g, ""));
  if (!others.every((w) => KIND_WORDS.has(w))) return null;
  if (/^[\d]+$/.test(token) || /^#\d+$/.test(token)) return { token: token.replace(/^#/, ""), shape: "number" };
  // A code: letters, digits and the usual joiners (JSH-H-2041, T-0417, QB88412, M_10482).
  if (/^[\p{L}\p{N}][\p{L}\p{N}._/#-]*$/u.test(token)) return { token, shape: /\p{L}/u.test(token) ? "code" : "number" };
  return null;
}

const STRUCTURED = ["zone", "tier", "overCents", "noRsvpYear", "endingDays"] as const;

/** What the existing rule-based reader (People's ask parser) found in a sentence as structured filters; null when none. */
export function readsAsFilter(text: string, vocab?: AskVocab) {
  const reading = readAsk(text, vocab ?? { zones: [], year: new Date().getUTCFullYear() });
  const found = STRUCTURED.some((k) => reading.filters[k] !== null);
  return found ? reading : null;
}

/**
 * Read a typed text. `vocab` (the organization's areas and its current year) lets a sentence like "life members in North" be read
 * as a filter; without it only the filters that need no vocabulary are found.
 */
export function classifyInput(raw: string, vocab?: AskVocab): Classified {
  const text = squeeze(raw);
  const base = { text, search: text, digits: "", shape: null } satisfies Omit<Classified, "kind">;
  if (!text) return { kind: "name", ...base };

  if (isQuestion(text)) return { kind: "question", ...base };
  if (isEmailLike(text)) return { kind: "email", ...base };
  if (looksLikePhone(text)) return { kind: "phone", ...base, digits: digitsOf(text) };

  const payer = payerName(text);
  if (payer) return { kind: "identifier", ...base, search: payer, shape: "payer" };

  const id = identifierToken(text);
  if (id) return { kind: "identifier", ...base, search: id.token, shape: id.shape, digits: digitsOf(id.token) };

  // Two or more words are needed for a filter: one word that is the name of an area is more likely a name or a city.
  if (text.split(" ").length >= 2 && hasLetter(text) && readsAsFilter(text, vocab)) return { kind: "filter", ...base };

  return { kind: "name", ...base };
}
