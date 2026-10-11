// "Record a payment by asking" on the Giving page (docs/handoff/prototypes/admin-v2/Giving.dc.html): read a plain sentence such as
// "Record a 250 check from household 1042 for the building pledge, check number 1043, received Sunday" into the fields the
// Record payment form takes. No model is involved, so it works for every community whether Niva's chat is on or not.
//
// It only READS words. It never chooses a household: `who` is what to search for, and the person picks the household from
// its card. Anything it cannot find is left empty and asked for. Pure: no database, no React.

import { OFFLINE_METHODS } from "@/lib/labels";
import { parseAmountToCents } from "@/lib/money";

export type OfflineMethodKey = (typeof OFFLINE_METHODS)[number];

export type PaymentAsk = {
  /** The amount as plain digits ("250", "1250.50"); integer cents are worked out by the Record payment checks, never here. */
  amount: string | null;
  method: OfflineMethodKey | null;
  /** A check number or other reference. */
  reference: string | null;
  /** YYYY-MM-DD */
  receivedOn: string | null;
  /** What to search households for: a name, a household or member number, an ID. Never used to pick one. */
  who: string | null;
  /** What the person said it was for ("the building pledge"). Only used to warn when the household has no open pledge. */
  about: string | null;
};

export const EMPTY_ASK: PaymentAsk = { amount: null, method: null, reference: null, receivedOn: null, who: null, about: null };

const METHOD_WORDS: readonly [RegExp, OfflineMethodKey][] = [
  [/\b(?:cheques?|checks?)\b/i, "check"],
  [/\bzelle\b/i, "zelle"],
  [/\b(?:ach|bank transfer|direct deposit|wire|transfer)\b/i, "ach"],
  [/\b(?:stock|shares?)\b/i, "stock"],
  [/\bcash\b/i, "cash"],
];

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"] as const;
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

/** Words that end the "from …" part of a sentence. */
const STOP = "for|on|received|receipt|dated|paid|by|via|with|using|in|check|cheque|ref|reference|today|yesterday|last|this";

function iso(y: number, m: number, d: number): string | null {
  const t = Date.UTC(y, m - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

function shift(today: string, days: number): string {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function monthIndex(word: string): number {
  const w = word.toLowerCase().slice(0, 3);
  return MONTHS.findIndex((m) => m.startsWith(w)) + 1;
}

/** A day the person named, never later than today: "today", "yesterday", a weekday (the latest one), "4 October", "2026-10-04". */
export function readDate(text: string, today: string): { date: string; match: string } | null {
  const isoHit = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (isoHit) {
    const date = iso(Number(isoHit[1]), Number(isoHit[2]), Number(isoHit[3]));
    if (date) return { date, match: isoHit[0] };
  }
  const t = text.toLowerCase();
  const rel = /\b(today|yesterday)\b/.exec(t);
  if (rel) return { date: rel[1] === "today" ? today : shift(today, -1), match: rel[0] };
  const day = new RegExp(`\\b(?:last\\s+|this\\s+|on\\s+)?(${WEEKDAYS.join("|")})\\b`).exec(t);
  if (day) {
    const [y, m, d] = today.split("-").map(Number);
    const now = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const want = WEEKDAYS.indexOf(day[1] as (typeof WEEKDAYS)[number]);
    let back = (now - want + 7) % 7;
    if (back === 0 && /^last\s/.test(day[0])) back = 7;
    return { date: shift(today, -back), match: day[0] };
  }
  const year = Number(today.slice(0, 4));
  const pick = (mo: number, d: number, y: number | null, match: string) => {
    let date = iso(y ?? year, mo, d);
    // Without a year, a day later than today was last year's.
    if (date && y === null && date > today) date = iso(year - 1, mo, d);
    return date ? { date, match } : null;
  };
  const dm = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\.?(?:,?\\s+(\\d{4}))?\\b`, "i").exec(text);
  if (dm) return pick(monthIndex(dm[2]), Number(dm[1]), dm[3] ? Number(dm[3]) : null, dm[0]);
  const md = new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "i").exec(text);
  if (md) return pick(monthIndex(md[1]), Number(md[2]), md[3] ? Number(md[3]) : null, md[0]);
  return null;
}

function readReference(text: string): { reference: string; match: string } | null {
  const named = /\b(?:cheque|check|ref(?:erence)?|confirmation)\s*(?:number|no\.?|num\.?|#)\s*:?\s*([A-Za-z0-9][A-Za-z0-9-]{0,39})/i.exec(text);
  if (named) return { reference: named[1], match: named[0] };
  const hash = /#\s*([A-Za-z0-9][A-Za-z0-9-]{0,39})/.exec(text);
  if (hash) return { reference: hash[1], match: hash[0] };
  // "check 1043" (not "$250 check", which has no number after it)
  const bare = /\b(?:cheque|check)\s+(\d{2,12})\b/i.exec(text);
  if (bare) return { reference: bare[1], match: bare[0] };
  return null;
}

function cleanAmount(raw: string): string | null {
  const plain = raw.replace(/[\s\p{Sc}]/gu, "").replace(/,/g, "");
  const cents = parseAmountToCents(plain);
  return cents !== null && cents > 0 ? plain : null;
}

/** The amount: a number with a currency sign or word first, otherwise the first number left over (not a date, a check number or an id). */
function readAmount(text: string): string | null {
  const signed = /\p{Sc}\s?(\d[\d,]*(?:\.\d{1,2})?)/u.exec(text) ?? /(\d[\d,]*(?:\.\d{1,2})?)\s?\p{Sc}/u.exec(text);
  if (signed) return cleanAmount(signed[1]);
  const coded = /\b(?:[A-Z]{3})\s?(\d[\d,]*(?:\.\d{1,2})?)\b/.exec(text) ?? /\b(\d[\d,]*(?:\.\d{1,2})?)\s?(?:[A-Z]{3}|dollars?|rupees?|pounds?|euros?|rand|shillings?|naira|pesos?|francs?)\b/i.exec(text);
  if (coded) return cleanAmount(coded[1]);
  // A bare number; numbers that follow "household", "member", "number", "no." or "id" are not amounts.
  const re = /(^|[^\w#.-])(\d[\d,]*(?:\.\d{1,2})?)(?![\w-])/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const before = text.slice(0, m.index + m[1].length).toLowerCase();
    if (/(?:household|member|number|no\.?|id|family|person)\s*$/.test(before)) continue;
    const amount = cleanAmount(m[2]);
    if (amount) return amount;
  }
  return null;
}

function readWho(text: string): string | null {
  const id = /\b(?:household|member|family|person)\s*(?:number|no\.?|id|#)?\s*:?\s*#?\s*([A-Za-z0-9-]{0,20}\d[A-Za-z0-9-]{0,20})/i.exec(text);
  if (id) return id[1];
  const from = new RegExp(`\\bfrom\\s+(.+?)(?=\\s+(?:${STOP})\\b|[.,;:!?()]|$)`, "iu").exec(text);
  if (!from) return null;
  let who = from[1].trim();
  who = who.replace(/^(?:the|a|an|mr\.?|mrs\.?|ms\.?|dr\.?)\s+/i, "").replace(/\s+(?:household|family|home|residence)$/i, "").replace(/['’]s$/u, "");
  who = who.replace(/\s+/g, " ").trim();
  return who.length >= 2 && who.length <= 80 ? who : null;
}

function readAbout(text: string): string | null {
  const m = new RegExp(`\\bfor\\s+(?:the\\s+|our\\s+|their\\s+|his\\s+|her\\s+)?(.+?)(?=\\s+(?:check|cheque|received|on|from|dated|ref|today|yesterday)\\b|[.,;:!?]|$)`, "iu").exec(text);
  if (!m) return null;
  const about = m[1].trim();
  // "for household 1042" names the household, not what the money is for.
  if (/^(?:household|member|family|person)\b/i.test(about)) return null;
  return about.length >= 2 && about.length <= 80 ? about : null;
}

/**
 * Read one sentence. `today` is today in the community's time zone (YYYY-MM-DD). Only what is clearly there is read: the
 * method, the reference, the date, then the amount from what is left (so "check 1043" is never read as an amount).
 */
export function parsePaymentAsk(input: string, today: string): PaymentAsk {
  let text = String(input ?? "").slice(0, 500).replace(/\s+/g, " ").trim();
  if (!text) return { ...EMPTY_ASK };
  const ref = readReference(text);
  if (ref) text = text.replace(ref.match, " ");
  const date = readDate(text, today);
  if (date) text = text.replace(date.match, " ");
  const method = METHOD_WORDS.find(([re]) => re.test(input))?.[1] ?? null;
  const who = readWho(text);
  const about = readAbout(text);
  // The amount is read without the household or member id the person named.
  const withoutWho = who ? text.replace(who, " ") : text;
  return {
    amount: readAmount(withoutWho),
    method: method ?? (ref && /\b(?:cheque|check)\b/i.test(ref.match) ? "check" : null),
    reference: ref?.reference ?? null,
    receivedOn: date?.date ?? null,
    who,
    about,
  };
}

/** A later sentence ("make it 300", "it was cash", "received yesterday") on top of what was asked: only what it says changes. */
export function mergeAsk(base: PaymentAsk, change: PaymentAsk): PaymentAsk {
  return {
    amount: change.amount ?? base.amount,
    method: change.method ?? base.method,
    reference: change.reference ?? base.reference,
    receivedOn: change.receivedOn ?? base.receivedOn,
    who: change.who ?? base.who,
    about: change.about ?? base.about,
  };
}

/** Which of the fields a change sentence touched, in words ("the amount and the method"); empty when it said nothing usable. */
export function changedFields(change: PaymentAsk): string[] {
  const out: string[] = [];
  if (change.amount) out.push("the amount");
  if (change.method) out.push("how it was paid");
  if (change.reference) out.push("the reference");
  if (change.receivedOn) out.push("the date");
  if (change.who) out.push("the household");
  return out;
}

/** "a, b and c" */
export function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** What is still missing before a household can be looked for and a payment prepared, as Niva's question; null when nothing is. */
export function missingQuestion(ask: PaymentAsk): string | null {
  if (!ask.who && !ask.amount) return "Who gave it, and how much was it? You can name the household, its number or a member ID.";
  if (!ask.who) return "Which household gave it? You can name it, or give its household number or a member ID.";
  if (!ask.amount) return "How much was it?";
  return null;
}
