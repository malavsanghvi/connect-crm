// Postal codes in the formats of many countries, as a comparison key. Pure, no dependencies (the crawler worker bundles it).
//
// A key is lower-case letters and digits with no spaces or hyphens: "SW1A 1AA" is "sw1a1aa", "K1A 0B1" is "k1a0b1", a US
// ZIP is its five digits (and a ZIP+4 keeps the four apart). A code the reader does not know a format for is kept as the
// letters and digits it was written with, so two records at "10115" still agree.

import { asciiDigits, foldText } from "./fold";
import { isoCountry } from "./phone";

export type Postal = {
  /** The key two records are compared on. */
  code: string;
  /** The four digits after a US ZIP, or null. */
  plus4: string | null;
};

const FIVE_DIGIT = new Set(["US", "DE", "FR", "ES", "IT", "MX", "KR", "TH", "FI", "HR", "RS", "PE", "CR", "GT", "TR", "PK", "EG", "MY", "UA", "PR"]);
const SIX_DIGIT = new Set(["IN", "CN", "SG", "RU", "KZ", "BY", "RO", "VN", "KG"]);
const FOUR_DIGIT = new Set(["AU", "NZ", "BE", "AT", "CH", "DK", "NO", "LU", "HU", "BG", "ZA", "BD", "PH", "SI", "LV", "GE", "CY", "AR"]);

const CA = /(?<![A-Z0-9])([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z])[\s-]?(\d[ABCEGHJ-NPRSTV-Z]\d)(?![A-Z0-9])/i;
const GB = /(?<![A-Z0-9])([A-Z]{1,2}\d[A-Z\d]?)\s?(\d[A-Z]{2})(?![A-Z0-9])/i;
const NL = /(?<![A-Z0-9])(\d{4})\s?([A-Z]{2})(?![A-Z0-9])/i;
const IE = /(?<![A-Z0-9])([AC-FHKNPRTV-Y]\d{2}|D6W)\s?([0-9AC-FHKNPRTV-Y]{4})(?![A-Z0-9])/i;
const BR = /(?<!\d)(\d{5})-?(\d{3})(?!\d)/;
const PT = /(?<!\d)(\d{4})-(\d{3})(?!\d)/;
const PL = /(?<!\d)(\d{2})-(\d{3})(?!\d)/;
const JP = /(?<!\d)(\d{3})-?(\d{4})(?!\d)/;
const SE = /(?<!\d)(\d{3})\s?(\d{2})(?!\d)/;
const US = /(?<!\d)(\d{5})(?:[-\s]?(\d{4}))?(?!\d)/;

function digitsRun(text: string, n: number): string | null {
  const m = new RegExp(`(?<!\\d)(\\d{${n}})(?!\\d)`).exec(text);
  return m ? (m[1] ?? null) : null;
}

/**
 * Reads a postal code. `country` (an ISO code such as "GB") picks the format; without it the shape decides: a ZIP, a
 * Canadian or British code, or just the letters and digits as written. A spreadsheet that ate a US ZIP's leading zero
 * ("2134") is repaired only when the country is known to be the US.
 */
export function parsePostal(raw: unknown, country?: string | null): Postal | null {
  if (raw === null || raw === undefined) return null;
  const text = foldText(asciiDigits(String(raw))).replace(/\s+/g, " ").trim();
  if (!text || /^(?:n\/?a|none|nil|null|-+|\.+)$/i.test(text)) return null;
  const iso = isoCountry(country);

  const us = (): Postal | null => {
    const m = US.exec(text.replace(/\s+(?=\d{4}$)/, "-"));
    if (m) return { code: m[1] ?? "", plus4: m[2] ?? null };
    if (iso === "US" && /^\d{4}$/.test(text)) return { code: `0${text}`, plus4: null };
    return null;
  };
  const pair = (re: RegExp): Postal | null => {
    const m = re.exec(text);
    return m ? { code: `${m[1] ?? ""}${m[2] ?? ""}`.toLowerCase(), plus4: null } : null;
  };

  if (iso === "US" || iso === "PR") return us() ?? generic(text);
  if (iso === "CA") return pair(CA) ?? generic(text);
  if (iso === "GB") return pair(GB) ?? generic(text);
  if (iso === "NL") return pair(NL) ?? generic(text);
  if (iso === "IE") return pair(IE) ?? generic(text);
  if (iso === "BR") return pair(BR) ?? generic(text);
  if (iso === "PT") return pair(PT) ?? generic(text);
  if (iso === "PL") return pair(PL) ?? generic(text);
  if (iso === "JP") return pair(JP) ?? generic(text);
  if (iso === "SE") return pair(SE) ?? generic(text);
  if (iso && FIVE_DIGIT.has(iso)) {
    const d = digitsRun(text, 5);
    return d ? { code: d, plus4: null } : generic(text);
  }
  if (iso && SIX_DIGIT.has(iso)) {
    const m = /(?<!\d)(\d{3})\s?(\d{3})(?!\d)/.exec(text);
    return m ? { code: `${m[1] ?? ""}${m[2] ?? ""}`, plus4: null } : generic(text);
  }
  if (iso && FOUR_DIGIT.has(iso)) {
    const d = digitsRun(text, 4);
    return d ? { code: d, plus4: null } : generic(text);
  }
  if (iso) return generic(text);

  // The country is not known: the shape decides, most specific first.
  return pair(CA) ?? pair(GB) ?? us() ?? generic(text);
}

/** A code with no known format: its letters and digits, 3 to 10 of them. */
function generic(text: string): Postal | null {
  const compact = text.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
  if (compact.length < 3 || compact.length > 10) return null;
  if (!/\d/.test(compact)) return null;
  return { code: compact, plus4: null };
}
