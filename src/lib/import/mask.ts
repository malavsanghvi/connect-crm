// Masked samples for the AI mapping suggestion (ONBOARDING_PLAN Step 3–5 "Map
// columns"): only the headers and a few MASKED values ever leave the portal.
//   1987-04-12        → 1987-••-••
//   mira@example.com  → m•••@•••.com
//   (713) 555-0142    → (•••) •••-••42
//   Mira Shah         → M••• S•••
//   $1,250.00         → $•,•••.••
// A column whose values are a short list repeated across rows (Yes/No,
// "Life Member", "Check") is a category, not personal data: its values are sent
// as they are, because they are what the model needs to read.

import { cleanText } from "@/lib/import/transforms";

const DOT = "•";

export function maskValue(input: string): string {
  const s = cleanText(input);
  if (!s) return "";
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})([-/.])\d{1,2}\2\d{1,2}/.exec(s))) return `${m[1]}${m[2]}${DOT}${DOT}${m[2]}${DOT}${DOT}`;
  if ((m = /^\d{1,2}([-/.])\d{1,2}\1(\d{2}|\d{4})$/.exec(s))) return `${DOT}${DOT}${m[1]}${DOT}${DOT}${m[1]}${m[2]}`;
  if ((m = /^([^@\s])[^@\s]*@[^@\s]+(\.[A-Za-z]{2,})$/.exec(s))) return `${m[1]}${DOT.repeat(3)}@${DOT.repeat(3)}${m[2]}`;
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 7 && /^[\d\s()+\-.x]+$/i.test(s)) {
    // Phones and long numbers: keep the shape and the last two digits.
    let seen = 0;
    return s.replace(/\d/g, (d) => {
      seen += 1;
      return seen > digits.length - 2 ? d : DOT;
    });
  }
  if (/^[$€£₹]?[\d,.\s]+$/.test(s)) return s.replace(/\d/g, DOT);
  // Words: first letter of each word, then dots.
  return s
    .split(" ")
    .map((w) => (w.length <= 1 ? w : `${w[0]}${DOT.repeat(Math.min(3, w.length - 1))}`))
    .join(" ");
}

/** True when a column looks like a category (few distinct short values, each repeated). */
export function isCategorical(values: readonly string[]): boolean {
  const vals = values.map((v) => cleanText(v)).filter(Boolean);
  if (vals.length < 4) return false;
  const distinct = new Set(vals.map((v) => v.toLowerCase()));
  return distinct.size <= 6 && distinct.size * 2 <= vals.length && [...distinct].every((v) => v.length <= 30 && !/\d{3,}/.test(v) && !v.includes("@"));
}

export type MaskedColumn = { header: string; samples: string[]; categorical: boolean };

/** Headers plus at most `perColumn` masked samples each (categories unmasked). */
export function maskedSamples(headers: readonly string[], rows: readonly (readonly string[])[], perColumn = 3): MaskedColumn[] {
  return headers.map((header, i) => {
    const values = rows.map((r) => cleanText(r[i] ?? "")).filter(Boolean);
    const categorical = isCategorical(values);
    const unique = [...new Set(values)].slice(0, perColumn);
    return { header, categorical, samples: categorical ? unique : unique.map(maskValue) };
  });
}
