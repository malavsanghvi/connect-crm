// International phone numbers to E.164, with a small table of country calling codes and number lengths. Pure, no
// dependencies (the crawler worker bundles this file too, so it has no `@/` imports).
//
// The rule: a number with a country code (+44, 0044, 011 44) is read with it. A number WITHOUT one is read with the
// community's own country, passed in by the caller. When the country is not known the number is NOT guessed: it is
// reported as unreadable instead of being read as American.

import { asciiDigits, table } from "./fold";

/** [ISO country, calling code, shortest and longest national number, trunk prefix people dial at home but not abroad]. */
const COUNTRY_ROWS: ReadonlyArray<readonly [string, string, number, number, string]> = [
  ["US", "1", 10, 10, "1"], ["CA", "1", 10, 10, "1"], ["JM", "1", 10, 10, "1"], ["TT", "1", 10, 10, "1"], ["BS", "1", 10, 10, "1"],
  ["BB", "1", 10, 10, "1"], ["DO", "1", 10, 10, "1"], ["PR", "1", 10, 10, "1"],
  ["GB", "44", 9, 10, "0"], ["IE", "353", 7, 9, "0"], ["FR", "33", 9, 9, "0"], ["DE", "49", 6, 13, "0"], ["ES", "34", 9, 9, ""],
  ["IT", "39", 6, 11, ""], ["PT", "351", 9, 9, ""], ["NL", "31", 9, 9, "0"], ["BE", "32", 8, 9, "0"], ["CH", "41", 9, 9, "0"],
  ["AT", "43", 4, 13, "0"], ["SE", "46", 7, 9, "0"], ["NO", "47", 8, 8, ""], ["DK", "45", 8, 8, ""], ["FI", "358", 5, 12, "0"],
  ["PL", "48", 9, 9, ""], ["CZ", "420", 9, 9, ""], ["SK", "421", 9, 9, "0"], ["HU", "36", 8, 9, "06"], ["RO", "40", 9, 9, "0"],
  ["BG", "359", 8, 9, "0"], ["GR", "30", 10, 10, ""], ["HR", "385", 8, 9, "0"], ["RS", "381", 8, 9, "0"], ["UA", "380", 9, 9, "0"],
  ["BY", "375", 9, 9, "8"], ["RU", "7", 10, 10, "8"], ["KZ", "7", 10, 10, "8"], ["TR", "90", 10, 10, "0"], ["IL", "972", 8, 9, "0"],
  ["AE", "971", 8, 9, "0"], ["SA", "966", 8, 9, "0"], ["EG", "20", 9, 10, "0"], ["JO", "962", 8, 9, "0"], ["LB", "961", 7, 8, "0"],
  ["KW", "965", 8, 8, ""], ["QA", "974", 8, 8, ""], ["BH", "973", 8, 8, ""], ["OM", "968", 8, 8, ""], ["IQ", "964", 9, 10, "0"],
  ["IR", "98", 10, 10, "0"], ["AF", "93", 9, 9, "0"], ["PK", "92", 10, 10, "0"], ["IN", "91", 10, 10, "0"], ["BD", "880", 10, 10, "0"],
  ["LK", "94", 9, 9, "0"], ["NP", "977", 9, 10, "0"], ["MM", "95", 8, 10, "0"], ["TH", "66", 8, 9, "0"], ["VN", "84", 9, 10, "0"],
  ["KH", "855", 8, 9, "0"], ["MY", "60", 8, 10, "0"], ["SG", "65", 8, 8, ""], ["ID", "62", 8, 12, "0"], ["PH", "63", 9, 10, "0"],
  ["CN", "86", 9, 11, "0"], ["HK", "852", 8, 8, ""], ["TW", "886", 8, 9, "0"], ["JP", "81", 9, 10, "0"], ["KR", "82", 8, 10, "0"],
  ["AU", "61", 9, 9, "0"], ["NZ", "64", 8, 10, "0"], ["ZA", "27", 9, 9, "0"], ["NG", "234", 8, 10, "0"], ["GH", "233", 9, 9, "0"],
  ["KE", "254", 9, 9, "0"], ["ET", "251", 9, 9, "0"], ["TZ", "255", 9, 9, "0"], ["UG", "256", 9, 9, "0"], ["MA", "212", 9, 9, "0"],
  ["DZ", "213", 8, 9, "0"], ["TN", "216", 8, 8, ""], ["MX", "52", 10, 10, ""], ["BR", "55", 10, 11, "0"], ["AR", "54", 10, 10, "0"],
  ["CO", "57", 10, 10, ""], ["CL", "56", 9, 9, ""], ["PE", "51", 8, 9, ""], ["VE", "58", 10, 10, "0"], ["EC", "593", 8, 9, "0"],
  ["GT", "502", 8, 8, ""], ["CR", "506", 8, 8, ""], ["PA", "507", 7, 8, ""], ["UY", "598", 8, 8, "0"], ["BO", "591", 8, 8, ""],
];

/** Every assigned country calling code (prefix-free, so a number's code is found by reading 1 to 3 digits). */
const CALLING_CODES: ReadonlySet<string> = new Set(
  (
    "1 7 20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98 " +
    "211 212 213 216 218 220 221 222 223 224 225 226 227 228 229 230 231 232 233 234 235 236 237 238 239 240 241 242 243 244 245 246 247 248 249 " +
    "250 251 252 253 254 255 256 257 258 260 261 262 263 264 265 266 267 268 269 290 291 297 298 299 350 351 352 353 354 355 356 357 358 359 " +
    "370 371 372 373 374 375 376 377 378 379 380 381 382 383 385 386 387 389 420 421 423 500 501 502 503 504 505 506 507 508 509 " +
    "590 591 592 593 594 595 596 597 598 599 670 672 673 674 675 676 677 678 679 680 681 682 683 685 686 687 688 689 690 691 692 " +
    "850 852 853 855 856 880 886 960 961 962 963 964 965 966 967 968 970 971 972 973 974 975 976 977 992 993 994 995 996 998"
  ).split(" "),
);

type Rule = { iso: string; cc: string; min: number; max: number; trunk: string };
const BY_ISO = new Map<string, Rule>();
const BY_CC = new Map<string, Rule>();
for (const [iso, cc, min, max, trunk] of COUNTRY_ROWS) {
  const rule: Rule = { iso, cc, min, max, trunk };
  BY_ISO.set(iso, rule);
  if (!BY_CC.has(cc)) BY_CC.set(cc, rule);
}

/** The calling code for a country given as "US", "us", "91", "+91" or "0091"; null when it is not known. */
export function callingCodeFor(country: string | null | undefined): string | null {
  if (country === null || country === undefined) return null;
  const t = String(country).trim();
  if (!t) return null;
  const digits = t.replace(/^\+|^00/, "");
  if (/^\d{1,3}$/.test(digits)) return CALLING_CODES.has(digits) ? digits : null;
  return BY_ISO.get(t.toUpperCase())?.cc ?? null;
}

/** The main country for a calling code ("1" is "US", "44" is "GB", "91" is "IN"), or null. */
export function countryForCallingCode(cc: string | null | undefined): string | null {
  return cc ? BY_CC.get(cc)?.iso ?? null : null;
}

/** An upper-case ISO code for "us" / "US"; null for anything that is not a known two-letter country. */
export function isoCountry(country: string | null | undefined): string | null {
  if (!country) return null;
  const t = String(country).trim().toUpperCase();
  return BY_ISO.has(t) ? t : null;
}

const COUNTRY_NAMES: Readonly<Record<string, string>> = table({
  "united states": "US", usa: "US", "u s a": "US", "u s": "US", america: "US", "united states of america": "US", "puerto rico": "PR",
  canada: "CA", "united kingdom": "GB", uk: "GB", "u k": "GB", "great britain": "GB", britain: "GB", england: "GB", scotland: "GB", wales: "GB",
  "northern ireland": "GB", ireland: "IE", india: "IN", pakistan: "PK", bangladesh: "BD", "sri lanka": "LK", nepal: "NP", australia: "AU",
  "new zealand": "NZ", germany: "DE", deutschland: "DE", france: "FR", spain: "ES", espana: "ES", italy: "IT", italia: "IT", portugal: "PT",
  netherlands: "NL", holland: "NL", belgium: "BE", switzerland: "CH", austria: "AT", sweden: "SE", norway: "NO", denmark: "DK",
  finland: "FI", poland: "PL", polska: "PL", "czech republic": "CZ", czechia: "CZ", hungary: "HU", romania: "RO", bulgaria: "BG",
  greece: "GR", turkey: "TR", turkiye: "TR", russia: "RU", ukraine: "UA", israel: "IL", "united arab emirates": "AE", uae: "AE",
  "saudi arabia": "SA", egypt: "EG", jordan: "JO", lebanon: "LB", kuwait: "KW", qatar: "QA", bahrain: "BH", oman: "OM", iraq: "IQ",
  iran: "IR", afghanistan: "AF", thailand: "TH", vietnam: "VN", "viet nam": "VN", cambodia: "KH", malaysia: "MY", singapore: "SG",
  indonesia: "ID", philippines: "PH", china: "CN", "hong kong": "HK", taiwan: "TW", japan: "JP", korea: "KR", "south korea": "KR",
  "south africa": "ZA", nigeria: "NG", ghana: "GH", kenya: "KE", ethiopia: "ET", tanzania: "TZ", uganda: "UG", morocco: "MA", algeria: "DZ",
  tunisia: "TN", mexico: "MX", brazil: "BR", brasil: "BR", argentina: "AR", colombia: "CO", chile: "CL", peru: "PE", venezuela: "VE",
  ecuador: "EC", guatemala: "GT", "costa rica": "CR", panama: "PA", uruguay: "UY", bolivia: "BO", jamaica: "JM", "trinidad and tobago": "TT",
  bahamas: "BS", barbados: "BB", "dominican republic": "DO", kazakhstan: "KZ", belarus: "BY", croatia: "HR", serbia: "RS",
});

/** An ISO code ("gb"), a calling code is NOT accepted here; or a country name ("United Kingdom", "India", "USA"). Null when unknown. */
export function countryFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = String(text).trim();
  if (!t) return null;
  const iso = isoCountry(t);
  if (iso) return iso;
  const folded = t.toLowerCase().normalize("NFKD").replace(/\p{M}+/gu, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  return COUNTRY_NAMES[folded] ?? null;
}

export type PhoneParse =
  | { ok: true; e164: string; callingCode: string; national: string }
  | { ok: false; reason: "blank" | "unreadable" | "country_unknown" | "length" };

const NANP_SHAPE = /^(?:1[\s.-]?)?(?:\([2-9]\d{2}\)\s?|[2-9]\d{2}[\s.-])[2-9]\d{2}[\s.-]\d{4}$/;
const EXTENSION =/\s*(?:x|ext\.?|extension|ramal|int\.)\s*\d+\s*$/i;

function validNanp(national: string): boolean {
  if (national.length !== 10) return false;
  const area = national.slice(0, 3);
  const exchange = national.slice(3, 6);
  return /^[2-9]/.test(area) && /^[2-9]/.test(exchange) && area !== "000";
}

function finish(cc: string, nationalIn: string): PhoneParse {
  const rule = BY_CC.get(cc);
  let national = nationalIn;
  if (rule && cc !== "1" && rule.trunk && national.startsWith(rule.trunk) && (rule.trunk === "0" || national.length > rule.max)) {
    // The home prefix, dialled after a country code ("+44 (0)20 ...") or at home ("020 ..."): not part of the number.
    national = national.slice(rule.trunk.length);
  }
  if (cc === "52" && national.length === 11 && national.startsWith("1")) national = national.slice(1);
  if (cc === "54" && national.length === 11 && national.startsWith("9")) national = national.slice(1);
  if (!/^\d{4,14}$/.test(national) || /^(\d)\1+$/.test(national)) return { ok: false, reason: "unreadable" };
  if (cc === "1") {
    if (!validNanp(national)) return { ok: false, reason: "length" };
  } else if (rule) {
    if (national.length < rule.min || national.length > rule.max) return { ok: false, reason: "length" };
  } else if (national.length < 5 || national.length > 12) {
    return { ok: false, reason: "length" };
  }
  const e164 = `+${cc}${national}`;
  if (e164.length > 16) return { ok: false, reason: "length" };
  return { ok: true, e164, callingCode: cc, national };
}

/**
 * Reads one phone number. With a country code it is read as written; without one it takes `defaultCountry` (an ISO code
 * or a calling code). When that is not known either, the number is not guessed.
 */
export function parsePhone(input: unknown, defaultCountry?: string | null): PhoneParse {
  if (input === null || input === undefined) return { ok: false, reason: "blank" };
  const raw = asciiDigits(String(input)).replace(/\s+/g, " ").trim();
  if (!raw) return { ok: false, reason: "blank" };
  const main = raw.replace(EXTENSION, "").replace(/\(\s*0\s*\)/g, "").trim();
  let digits = main.replace(/\D/g, "");
  if (!digits) return { ok: false, reason: "unreadable" };
  const home = callingCodeFor(defaultCountry);

  const plus = /^\(?\s*\+/.test(main);
  const dialled00 = !plus && /^00/.test(digits);
  const dialled011 = !plus && !dialled00 && home === "1" && /^011\d{6,}/.test(digits);
  if (plus || dialled00 || dialled011) {
    if (dialled00) digits = digits.slice(2);
    else if (dialled011) digits = digits.slice(3);
    for (let n = 1; n <= 3; n++) {
      const cc = digits.slice(0, n);
      if (CALLING_CODES.has(cc)) return finish(cc, digits.slice(n));
    }
    return { ok: false, reason: "unreadable" };
  }

  if (!home) {
    // The community's country is not known, so a bare number is not guessed. The one exception is a number whose written shape is
    // unmistakably North American, "(713) 555-0142" or "713-555-0142": its area code and exchange are the NANP's own.
    if (NANP_SHAPE.test(main)) return finish("1", digits.length === 11 ? digits.slice(1) : digits);
    return { ok: false, reason: "country_unknown" };
  }
  if (home === "1") return finish("1", digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits);
  const rule = BY_CC.get(home);
  // Pasted with its country code but without the plus: "919825012345", "442079460958".
  if (rule && digits.startsWith(home)) {
    const rest = digits.slice(home.length);
    const lead = rule.trunk && rest.startsWith(rule.trunk) ? rule.trunk.length : 0;
    if (digits.length > rule.max + lead && rest.length - lead >= rule.min) return finish(home, rest);
  }
  return finish(home, digits);
}
