// The People workspace's "ask your data" box (new look). A sentence is read BY RULES ON THE PAGE (no model, nothing is sent to an
// AI provider): the parts it recognises become the structured filters the household list already supports, shown as chips the
// person can see and remove; the words it does not recognise become a search by name or by ANY identifier (member and household
// numbers, the organization's own IDs, old system and accounting IDs, bank payer names). Nothing is ever picked by name alone: the
// list shows each household's numbers and adults.
//
// Built for every organization: the areas come from the organization's own zones, money is written in its currency, and no word
// of any one tradition is used. Pure, so the page, the dev preview and the tests read a sentence the same way.

import { moneyIn, type CommunityFormat } from "@/lib/community-format";
import { normalizeSearchQuery } from "@/lib/global-search";
import { parseAmountToCents } from "@/lib/money";
import { isAgeBand, type AgeBand } from "@/lib/people";

export const TIERS = ["life", "yearly", "community"] as const;
export type TierKey = (typeof TIERS)[number];

export type HouseholdFilters = {
  /** A name, a number or any identifier, searched the way the top bar searches. */
  q: string | null;
  /** A zone id (the organization's own areas). */
  zone: string | null;
  tier: TierKey | null;
  /** Open balance strictly over this many cents (0 = any open balance). */
  overCents: number | null;
  /** No RSVP to any event that starts in this year. */
  noRsvpYear: number | null;
  /** An active membership that ends within this many days. */
  endingDays: number | null;
  /** Contact gaps (a work list of people to reach another way). Each is true or not asked; they look at ADULTS only. */
  noEmail: true | null;
  noMobile: true | null;
  /** The family's record has no street address. */
  noAddress: true | null;
  /** No signed-in app account. */
  notOnApp: true | null;
  /** An age band for the people list (never "all": that is not asked). A sentence only ever reads adults or seniors; a child list is not offered by words. */
  band: Exclude<AgeBand, "all"> | null;
};

export type FilterKey = keyof HouseholdFilters;

export const NO_FILTERS: HouseholdFilters = {
  q: null,
  zone: null,
  tier: null,
  overCents: null,
  noRsvpYear: null,
  endingDays: null,
  noEmail: null,
  noMobile: null,
  noAddress: null,
  notOnApp: null,
  band: null,
};

/** The contact gaps, in the order they are listed and worded. */
export const GAP_KEYS = ["noEmail", "noMobile", "noAddress", "notOnApp"] as const satisfies readonly FilterKey[];
export type GapKey = (typeof GAP_KEYS)[number];

export type Zone = { id: string; name: string };

export type AskVocab = { zones: readonly Zone[]; /** The organization's current year (its own time zone). */ year: number };

export type AskReading = {
  filters: HouseholdFilters;
  /** At least one part of the sentence became a filter or a search. False: nothing usable was found. */
  understood: boolean;
};

/** `fixed`: the chip says a rule that always holds (contact-gap lists are adults only), so it has no way to remove it. */
export type AskChip = { key: FilterKey; label: string; fixed?: boolean };

/** The URL names of the filters (the page's GET form and links use these). */
export const FILTER_PARAM: Record<FilterKey, string> = {
  q: "q",
  zone: "zone",
  tier: "tier",
  overCents: "over",
  noRsvpYear: "norsvp",
  endingDays: "ending",
  noEmail: "noemail",
  noMobile: "nomobile",
  noAddress: "noaddress",
  notOnApp: "noapp",
  band: "band",
};

const DEFAULT_ENDING_DAYS = 60;
const MAX_CENTS = 100_000_000_000; // a billion in major units: anything larger is not a balance someone typed

// Words that carry no filter and no search on their own ("households in … with an … that have …"), and the names of identifier
// kinds, so "member number 1042" searches for 1042 and "bank payer ANA LOPEZ" for the payer name.
const STOP = new Set(
  [
    "a", "an", "the", "and", "or", "of", "in", "on", "at", "to", "for", "from", "with", "without", "by", "near", "around", "into",
    "that", "who", "whose", "which", "what", "where", "when", "is", "are", "was", "were", "be", "been", "has", "have", "had", "do", "does", "did",
    "all", "any", "every", "everyone", "each", "some", "me", "my", "our", "us", "we", "i", "you", "your", "them", "their", "they", "it", "its",
    "show", "list", "find", "get", "give", "see", "look", "up", "search", "please", "can", "could", "would", "let", "lets", "only", "just",
    "household", "households", "family", "families", "people", "person", "persons", "member", "members", "membership", "memberships",
    "record", "records", "this", "these", "those", "there", "here", "year", "yet", "still", "also", "but", "not", "no", "yes", "than", "then",
    "number", "numbers", "no.", "num", "id", "ids", "identifier", "code", "customer", "bank", "payer", "name", "names", "called", "named",
    "zone", "area", "areas", "zones", "live", "lives", "living", "anyone", "somebody", "someone",
    // The words of the contact-gap filters ("adults with no email on the app"): a leftover one is not a name.
    "adults", "seniors", "email", "emails", "e-mail", "mobile", "cell", "phone", "phones", "telephone", "address", "addresses", "app", "file", "mailing",
  ].map((w) => w.toLowerCase()),
);

function clean(sentence: string): string {
  return sentence.replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function amountCents(symbol: string | undefined, digits: string): number | null {
  const cents = parseAmountToCents(`${symbol ?? ""}${digits}`);
  return cents !== null && cents >= 0 && cents <= MAX_CENTS ? cents : null;
}

function yearFrom(m: RegExpExecArray, vocab: AskVocab, ...groups: number[]): number {
  for (const g of groups) {
    const y = m[g] ? Number(m[g]) : NaN;
    if (Number.isInteger(y) && y >= 1900 && y <= 2200) return y;
  }
  return /last\s+year/i.test(m[0]) ? vocab.year - 1 : vocab.year;
}

/**
 * Read a sentence into filters. Recognised: an open balance ("open balance over 100", "owe more than 250", "with an open balance"),
 * no RSVP ("have not RSVP'd this year", "no RSVP in 2025"), memberships ending ("membership ending soon", "expiring within 30 days"),
 * a membership tier ("life members"), one of the organization's areas by its name. Everything else that is not a filler word is a
 * search by name or identifier.
 */
export function readAsk(sentence: string, vocab: AskVocab): AskReading {
  let text = ` ${clean(sentence)} `;
  const out: HouseholdFilters = { ...NO_FILTERS };

  /** Run a pattern once; when the handler accepts the match, the matched words are removed from what is left to read. */
  const take = (re: RegExp, handle: (m: RegExpExecArray) => boolean) => {
    const m = re.exec(text);
    if (m && handle(m)) text = `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`;
  };

  // --- open balance -----------------------------------------------------------------------------------------------------------
  const BAL = String.raw`(?:open\s+balances?|balances?|outstanding|unpaid|owing|owes?|owed|due)`;
  const CMP = String.raw`((?<!\p{L})(?:over|above|more\s+than|greater\s+than|exceeding|at\s+least)(?!\p{L})|>=?)`;
  const AMT = String.raw`(\p{Sc})?\s*(\d[\d,]*(?:\.\d{1,2})?)`;
  const atLeast = (cmp: string) => /least|>=/.test(cmp);
  const setOver = (cmp: string, sym: string | undefined, digits: string) => {
    const cents = amountCents(sym, digits);
    if (cents === null) return false;
    out.overCents = atLeast(cmp) ? Math.max(0, cents - 1) : cents;
    return true;
  };
  take(new RegExp(String.raw`(?:\ban?\s+)?\b${BAL}\b[^\d\p{Sc}]{0,30}?${CMP}\s*${AMT}`, "iu"), (m) => setOver(m[1], m[2], m[3]));
  if (out.overCents === null) {
    take(new RegExp(String.raw`${CMP}\s*${AMT}\s*(?:in\s+|of\s+)?(?:an?\s+)?(?:open|outstanding|unpaid|owing|owed|due|balance)\b`, "iu"), (m) => setOver(m[1], m[2], m[3]));
  }
  if (out.overCents === null) {
    take(/(?:\bwith\s+)?(?:\ban?\s+)?\b(?:open|outstanding|unpaid)\s+balances?\b|\b(?:owes?|owing)\s+(?:money|anything)\b|\bbehind\s+on\s+(?:their\s+)?pledges?\b/iu, () => {
      out.overCents = 0;
      return true;
    });
  }

  // --- no RSVP --------------------------------------------------------------------------------------------------------------------
  const WHEN = String.raw`(?:\s+(?:this\s+year|last\s+year|in\s+(\d{4})|for\s+(\d{4})|since\s+(\d{4})))?`;
  take(
    new RegExp(
      String.raw`\b(?:that\s+|who\s+)?(?:have\s+not|haven't|has\s+not|hasn't|did\s+not|didn't|never|not\s+yet|not)\s+(?:yet\s+)?(?:rsvp(?:'?d|ed|'ed)?|responded|replied|signed\s+up|registered)\b(?:\s+(?:to|for)\s+(?:anything|any\s+events?|an\s+event))?${WHEN}`,
      "iu",
    ),
    (m) => {
      out.noRsvpYear = yearFrom(m, vocab, 1, 2, 3);
      return true;
    },
  );
  if (out.noRsvpYear === null) {
    take(new RegExp(String.raw`\b(?:no|without\s+an?|without)\s+rsvps?\b${WHEN}`, "iu"), (m) => {
      out.noRsvpYear = yearFrom(m, vocab, 1, 2, 3);
      return true;
    });
  }

  // --- memberships ending ---------------------------------------------------------------------------------------------------------
  const SOON = String.raw`(?:\s+(soon|this\s+month|next\s+month|in\s+the\s+next\s+(\d{1,3})\s+days|within\s+(\d{1,3})\s+days|in\s+(\d{1,3})\s+days))?`;
  const days = (m: RegExpExecArray, from: number): number => {
    const n = Number(m[from + 1] ?? m[from + 2] ?? m[from + 3]);
    if (Number.isInteger(n) && n >= 1 && n <= 366) return n;
    const word = (m[from] ?? "").toLowerCase();
    return word.startsWith("this month") ? 31 : DEFAULT_ENDING_DAYS;
  };
  take(
    new RegExp(String.raw`\b(?:whose\s+|with\s+(?:an?\s+)?)?memberships?\s+(?:is\s+|are\s+)?(?:ending|expiring|ends|expires|running\s+out|due\s+for\s+renewal|up\s+for\s+renewal)\b${SOON}`, "iu"),
    (m) => {
      out.endingDays = days(m, 1);
      return true;
    },
  );
  if (out.endingDays === null) {
    take(new RegExp(String.raw`\b(?:ending|expiring)\s+(soon|within\s+(\d{1,3})\s+days|in\s+the\s+next\s+(\d{1,3})\s+days|in\s+(\d{1,3})\s+days)|\b(?:up|due)\s+for\s+renewal\b`, "iu"), (m) => {
      out.endingDays = m[1] ? days(m, 1) : DEFAULT_ENDING_DAYS;
      return true;
    });
  }

  // --- membership tier ------------------------------------------------------------------------------------------------------------
  const tierOf = (w: string): TierKey => (/^life/i.test(w) ? "life" : /^(yearly|annual)/i.test(w) ? "yearly" : "community");
  take(/\b(?:on|with|have|has|holding)\s+(?:an?\s+)?(life|lifetime|yearly|annual|community)[\s-]+memberships?\b/iu, (m) => {
    out.tier = tierOf(m[1]);
    return true;
  });
  if (out.tier === null) {
    take(/\b(life|lifetime|yearly|annual)(?:[\s-]+tier)?\s+(?:members?|memberships?|households?|families)\b/iu, (m) => {
      out.tier = tierOf(m[1]);
      return true;
    });
  }
  if (out.tier === null) {
    take(/\bcommunity[\s-]+(?:tier|memberships?)\b(?:\s+(?:members?|households?))?/iu, () => {
      out.tier = "community";
      return true;
    });
  }

  // --- contact gaps: adults with no email, no mobile, no address, not on the app -------------------------------------------------
  // They look at adults only (a child has no email or mobile field), whatever the sentence says about children.
  const LACK = String.raw`(?:(?:with\s+)?no|without|missing|lacking|(?:(?:who|that|and)\s+)?(?:have|has)\s+no|(?:(?:who|that|and)\s+)?(?:don't|do\s+not|doesn't|does\s+not)\s+have)`;
  const gap = (key: "noEmail" | "noMobile" | "noAddress", what: string) =>
    take(new RegExp(String.raw`\b${LACK}\s+(?:an?\s+|any\s+|their\s+)?${what}(?![\p{L}\p{N}])`, "iu"), () => {
      out[key] = true;
      return true;
    });
  gap("noEmail", String.raw`e-?mails?(?:\s+address(?:es)?)?(?:\s+on\s+file)?`);
  gap("noMobile", String.raw`(?:mobile|cell|phone|telephone)(?:\s+(?:phone|number|numbers))?(?:\s+on\s+file)?`);
  gap("noAddress", String.raw`(?:(?:mailing|street|postal|home)\s+)?address(?:es)?(?:\s+on\s+file)?`);
  take(
    /\b(?:(?:who|that|and)\s+)?(?:are\s+|is\s+|were\s+)?not\s+(?:yet\s+)?(?:on|using|registered\s+on|signed\s+up\s+(?:on|for))\s+the\s+app\b|\b(?:(?:with|and)\s+)?(?:no|without)\s+(?:an?\s+)?app\s+(?:account|login|log-in|sign-?in)\b|\b(?:(?:who|that|and)\s+)?(?:have\s+not|haven't|has\s+not|hasn't|never)\s+(?:yet\s+)?(?:signed|logged)\s+in(?:\s+to\s+the\s+app)?\b/iu,
    () => {
      out.notOnApp = true;
      return true;
    },
  );

  // --- an age band: adults or seniors (a list of children is never offered by words) ----------------------------------------------
  take(/(?<![\p{L}\p{N}])(adults|seniors|senior\s+citizens)(?![\p{L}\p{N}])(?:\s+only)?/iu, (m) => {
    out.band = /^adult/i.test(m[1]) ? "adults" : "seniors";
    return true;
  });

  // --- area (the organization's own zones, longest name first) ----------------------------------------------------------------------
  const zones = [...vocab.zones].filter((z) => z.name.trim()).sort((a, b) => b.name.length - a.name.length);
  for (const z of zones) {
    if (out.zone) break;
    const name = escapeRegex(z.name.trim()).replace(/\s+/g, String.raw`\s+`);
    take(new RegExp(String.raw`(?:\b(?:in|from|at|around|near|inside)\s+(?:the\s+)?)?(?<![\p{L}\p{N}])${name}(?![\p{L}\p{N}])(?:\s+(?:zone|area))?`, "iu"), () => {
      out.zone = z.id;
      return true;
    });
  }

  // --- what is left: a search by name or any identifier -----------------------------------------------------------------------------
  const words = text
    .split(" ")
    .map((w) => w.replace(/^["'(\[]+|["')\],.;:!?]+$/g, ""))
    .filter((w) => w && !STOP.has(w.toLowerCase()) && !/^'s$/i.test(w));
  out.q = words.length ? normalizeSearchQuery(words.join(" ")) : null;

  const understood = out.q !== null || (Object.keys(FILTER_PARAM) as FilterKey[]).some((k) => out[k] !== null);
  return { filters: out, understood };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// URL <-> filters
// ---------------------------------------------------------------------------------------------------------------------------------

type Params = Record<string, string | string[] | undefined>;

function one(sp: Params, key: string): string | undefined {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s === undefined || s.trim() === "" ? undefined : s.trim();
}

function int(v: string | undefined, min: number, max: number): number | null {
  if (v === undefined || !/^\d{1,15}$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The filters in a URL, each checked; anything malformed is ignored (never guessed). */
export function filtersFromParams(sp: Params): HouseholdFilters {
  const tier = one(sp, FILTER_PARAM.tier);
  const zone = one(sp, FILTER_PARAM.zone);
  const q = one(sp, FILTER_PARAM.q);
  const band = one(sp, FILTER_PARAM.band);
  const flag = (key: GapKey) => (one(sp, FILTER_PARAM[key]) === "1" ? true : null);
  return {
    q: q ? normalizeSearchQuery(q) : null,
    zone: zone && UUID.test(zone) ? zone : null,
    tier: (TIERS as readonly string[]).includes(tier ?? "") ? (tier as TierKey) : null,
    overCents: int(one(sp, FILTER_PARAM.overCents), 0, MAX_CENTS),
    noRsvpYear: int(one(sp, FILTER_PARAM.noRsvpYear), 1900, 2200),
    endingDays: int(one(sp, FILTER_PARAM.endingDays), 1, 366),
    noEmail: flag("noEmail"),
    noMobile: flag("noMobile"),
    noAddress: flag("noAddress"),
    notOnApp: flag("notOnApp"),
    band: isAgeBand(band) && band !== "all" ? band : null,
  };
}

/** The filters as URL values (only the ones set). */
export function paramsFromFilters(f: HouseholdFilters): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(FILTER_PARAM) as FilterKey[]) {
    const v = f[key];
    if (v === true) out[FILTER_PARAM[key]] = "1";
    else if (v !== null && v !== undefined && v !== "") out[FILTER_PARAM[key]] = String(v);
  }
  return out;
}

export function hasFilters(f: HouseholdFilters): boolean {
  return (Object.keys(FILTER_PARAM) as FilterKey[]).some((k) => f[k] !== null);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Contact gaps and age bands: a list of PEOPLE rather than families
// ---------------------------------------------------------------------------------------------------------------------------------

/** Is any contact gap asked for? */
export function hasGap(f: HouseholdFilters): boolean {
  return GAP_KEYS.some((k) => f[k] === true);
}

/**
 * The age band a list really uses. A contact-gap list is for adults: a child has no email or mobile field, and a child's record is
 * never part of a work list (D2), so asking for under 18 (or nothing) with a gap gives adults. Seniors and "on a team or role" are
 * adults already and stay as asked.
 */
export function effectiveBand(f: Pick<HouseholdFilters, "band" | GapKey>): AgeBand {
  if (GAP_KEYS.some((k) => f[k] === true)) return f.band === "seniors" || f.band === "roles" ? f.band : "adults";
  return f.band ?? "all";
}

/** Filters that only a family can answer (a balance, an RSVP, a membership): they make a list of families, not of people. */
function hasFamilyOnlyFilter(f: HouseholdFilters): boolean {
  return f.overCents !== null || f.noRsvpYear !== null || f.endingDays !== null || f.tier !== null;
}

/** Which list these filters are about: people when a contact gap or an age band is asked and nothing asks about the family itself. */
export function listFor(f: HouseholdFilters): "people" | "households" {
  return (hasGap(f) || f.band !== null) && !hasFamilyOnlyFilter(f) ? "people" : "households";
}

const GAP_WORDS: Record<GapKey, string> = { noEmail: "no email", noMobile: "no mobile", noAddress: "no address", notOnApp: "not on the app" };

const BAND_LABEL: Record<Exclude<AgeBand, "all">, string> = { adults: "Adults only", minors: "Under 18", seniors: "Seniors 65+", roles: "On a team or role" };

/** "no email, no mobile and no address", then " who are not on the app": the gaps as one phrase after "adults with …"; "" when none. */
function gapPhrase(f: HouseholdFilters): string {
  const lacks = (["noEmail", "noMobile", "noAddress"] as const).filter((k) => f[k] === true).map((k) => GAP_WORDS[k]);
  const head = lacks.length === 0 ? "" : lacks.length === 1 ? `with ${lacks[0]}` : `with ${lacks.slice(0, -1).join(", ")} and ${lacks[lacks.length - 1]}`;
  const app = f.notOnApp === true ? (head ? "who are not on the app" : "not on the app") : "";
  return [head, app].filter(Boolean).join(" ");
}

/** The people a gap list is about: "adults", "seniors", or "people on a team or role"; always adults when a gap is asked. */
function subject(f: HouseholdFilters, n: number | null): string {
  const one = n === 1;
  const band = effectiveBand(f);
  if (band === "seniors") return one ? "senior" : "seniors";
  if (band === "roles") return one ? "person on a team or role" : "people on a team or role";
  if (band === "minors") return one ? "person under 18" : "people under 18";
  return band === "adults" ? (one ? "adult" : "adults") : one ? "person" : "people";
}

/** "Adults with no email" (the heading of a gap list, and the name a saved view starts with); null when no gap or band is asked. */
export function listHeading(f: HouseholdFilters): string | null {
  if (!hasGap(f) && f.band === null) return null;
  const words = [subject(f, null), gapPhrase(f)].filter(Boolean).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "42 adults" / "1 senior": how many people a list of people holds, said with who they are. */
export function countText(f: HouseholdFilters, count: number, locale = "en-US"): string {
  return `${count.toLocaleString(locale)} ${subject(f, count)}`;
}

/** "Show 42 adults with no email": the find box's row for a sentence that reads as a list of people; null when it is not one. */
export function showText(f: HouseholdFilters, count: number | null): string | null {
  if (listFor(f) !== "people" || (!hasGap(f) && f.band === null)) return null;
  const n = count === null ? "" : `${count.toLocaleString("en-US")} `;
  return `Show ${n}${[subject(f, count), gapPhrase(f)].filter(Boolean).join(" ")}`;
}

/** Each filter in words, for the chips the person can see and remove. */
export function chipsFor(f: HouseholdFilters, ctx: { zones: readonly Zone[]; fmt: CommunityFormat; tierLabel: (t: string) => string }): AskChip[] {
  const chips: AskChip[] = [];
  const gap = hasGap(f);
  // A gap list is always adults (or seniors): that chip says so and cannot be removed.
  if (gap || f.band !== null) {
    const band = effectiveBand(f);
    chips.push({ key: "band", label: band === "all" ? "Everyone" : BAND_LABEL[band as Exclude<AgeBand, "all">], ...(gap && band !== f.band ? { fixed: true } : {}) });
  }
  for (const k of GAP_KEYS) if (f[k] === true) chips.push({ key: k, label: k === "notOnApp" ? "Not on the app" : `${GAP_WORDS[k].charAt(0).toUpperCase()}${GAP_WORDS[k].slice(1)} on file` });
  if (f.zone) chips.push({ key: "zone", label: `Area is ${ctx.zones.find((z) => z.id === f.zone)?.name ?? "an area you can't see"}` });
  if (f.overCents !== null) {
    chips.push({
      key: "overCents",
      label: f.overCents === 0 ? "Has an open balance" : (f.overCents + 1) % 100 === 0 ? `Open balance of at least ${moneyIn(f.overCents + 1, ctx.fmt)}` : `Open balance over ${moneyIn(f.overCents, ctx.fmt)}`,
    });
  }
  if (f.noRsvpYear !== null) chips.push({ key: "noRsvpYear", label: `No RSVP in ${f.noRsvpYear}` });
  if (f.endingDays !== null) chips.push({ key: "endingDays", label: `Membership ends within ${f.endingDays} days` });
  if (f.tier) chips.push({ key: "tier", label: `${ctx.tierLabel(f.tier)} membership` });
  if (f.q) chips.push({ key: "q", label: `Name or ID: “${f.q}”` });
  return chips;
}

/**
 * The filters in a sentence for Niva, WITHOUT the typed search words: a search can be a person's name, and a name can be a child's
 * (D2). "with an open balance over 100.00 in North Riverside" / "matching a search typed on the screen".
 */
export function filtersForNiva(f: HouseholdFilters, ctx: { zones: readonly Zone[]; fmt: CommunityFormat; tierLabel: (t: string) => string }): string {
  const parts = chipsFor({ ...f, q: null }, ctx).map((c) => c.label.charAt(0).toLowerCase() + c.label.slice(1));
  if (f.q) parts.push("matching a search typed on the screen");
  return parts.join(", ");
}
