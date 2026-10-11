// Languages, for every community (pure: no database, no network). A community says which languages it speaks in Setup > Profile;
// everything that writes words for people (reminders, newsletters, the website draft, the onboarding questions) and everything that
// stores a person's language uses these helpers, so no screen assumes English, Gujarati and Hindi. Codes are BCP-47 language tags
// ("en", "es", "pt-BR", "zh-Hant"); names and text direction come from the platform's own Intl data, so no new dependency.

/** The longest language tag the database accepts (people.language, 0684). */
export const LANGUAGE_TAG_MAX = 35;

/** The same shape the database checks: a 2-3 letter language, then up to four dash-separated parts of 2-8 letters or digits. */
const TAG_SHAPE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,4}$/;

/**
 * A language code in its standard written form ("PT_br" becomes "pt-BR"), or null when it is not a language code at all
 * ("english", "e", "", "x y"). Underscores are accepted because spreadsheets and phones write them that way.
 */
export function normalizeLanguageCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().replace(/_/g, "-");
  if (t.length < 2 || t.length > LANGUAGE_TAG_MAX || !TAG_SHAPE.test(t)) return null;
  try {
    const [canonical] = Intl.getCanonicalLocales(t);
    return canonical && canonical.toLowerCase() !== "und" ? canonical : null;
  } catch {
    return null;
  }
}

export const isValidLanguageCode = (raw: unknown): boolean => normalizeLanguageCode(raw) !== null;

/** A language code the platform has a name for ("fil" is Filipino; "xx" is shaped like a code but is no language). */
export function isKnownLanguage(raw: unknown): boolean {
  const c = normalizeLanguageCode(raw);
  return c !== null && languageName(c) !== c;
}

/** "es-MX" and "ES" are both "es". */
export function primaryLanguage(code: string): string {
  return (normalizeLanguageCode(code) ?? code).split("-")[0]!.toLowerCase();
}

/** The language's name in English ("Gujarati"), or the code itself when the platform does not know it. */
export function languageName(code: string): string {
  const c = normalizeLanguageCode(code) ?? code;
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(c);
    if (name && name !== c) return name;
  } catch {
    // an unknown code is shown as it is
  }
  return c;
}

/** The language's name in its own writing ("ગુજરાતી"), or null when the platform has none different from the code. */
export function nativeLanguageName(code: string): string | null {
  const c = normalizeLanguageCode(code);
  if (!c) return null;
  try {
    const name = new Intl.DisplayNames([c], { type: "language" }).of(c);
    return name && name !== c ? name : null;
  } catch {
    return null;
  }
}

/** "English", "Gujarati (ગુજરાતી)", "Spanish (español)": for a person to recognise their language by either name. */
export function languageLabel(code: string): string {
  const name = languageName(code);
  const native = nativeLanguageName(code);
  return native && native.toLowerCase() !== name.toLowerCase() ? `${name} (${native})` : name;
}

/** The writing systems that run right to left. */
const RTL_SCRIPTS = new Set(["Arab", "Hebr", "Thaa", "Syrc", "Nkoo", "Adlm", "Rohg", "Mand", "Samr"]);

/** "rtl" for Arabic, Hebrew, Persian, Urdu and the other right-to-left languages, else "ltr". */
export function textDirection(code: string): "ltr" | "rtl" {
  const c = normalizeLanguageCode(code);
  if (!c) return "ltr";
  try {
    const locale = new Intl.Locale(c);
    const script = locale.script ?? locale.maximize().script;
    return script && RTL_SCRIPTS.has(script) ? "rtl" : "ltr";
  } catch {
    return "ltr";
  }
}

export const isRtl = (code: string): boolean => textDirection(code) === "rtl";

export type LanguageSource = { languages?: unknown } | readonly unknown[] | null | undefined;

/**
 * A community's languages (what Setup > Profile saved in org_profiles.languages), as language codes in the order the community
 * prefers them: the first is its main language. Codes that are not language codes are left out and repeats are dropped; with
 * nothing left, English.
 */
export function communityLanguages(source: LanguageSource): string[] {
  const raw: unknown = Array.isArray(source) ? source : source && typeof source === "object" ? (source as { languages?: unknown }).languages : null;
  const out: string[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const code = normalizeLanguageCode(item);
      if (code && !out.includes(code)) out.push(code);
    }
  }
  return out.length > 0 ? out : ["en"];
}

/** Which of the available codes serves this language: the same code, else the same language ("es" for "es-MX"), else null. */
export function matchLanguage(code: string, available: Iterable<string>): string | null {
  const want = normalizeLanguageCode(code);
  if (!want) return null;
  const list = [...available].map((a) => normalizeLanguageCode(a)).filter((a): a is string => a !== null);
  return list.find((a) => a === want) ?? list.find((a) => primaryLanguage(a) === primaryLanguage(want)) ?? null;
}

/** An ISO 3166 country code ("us" becomes "US"), or null. */
export function countryCode(raw: unknown): string | null {
  const t = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(t) ? t : null;
}

/**
 * The locale a community's dates, times and numbers are written in: its main language in its own country ("es" + MX is
 * "es-MX", "en" + GB is "en-GB"). A language that already names a country keeps it. With no country, English is "en-US"
 * (what Weaver has always written) and any other language stands alone.
 */
export function communityLocale(languages: readonly string[], country: string | null | undefined): string {
  const main = normalizeLanguageCode(languages[0] ?? "en") ?? "en";
  try {
    if (new Intl.Locale(main).region) return main;
    const cc = countryCode(country);
    if (cc) {
      const withRegion = new Intl.Locale(main, { region: cc }).toString();
      if (Intl.DateTimeFormat.supportedLocalesOf([withRegion]).length > 0) return withRegion;
    }
  } catch {
    // fall through to the plain language
  }
  return main === "en" ? "en-US" : main;
}

/** Languages worth offering in a picker, by code. A community can still use any other code (see "Other languages" in Setup). */
export const COMMON_LANGUAGES = [
  "en", "es", "fr", "de", "pt", "it", "nl", "sv", "pl", "ru", "uk", "el", "tr",
  "ar", "he", "fa", "ur", "hi", "gu", "mr", "bn", "pa", "ta", "te", "kn", "ml", "ne", "si",
  "zh", "ja", "ko", "vi", "th", "id", "ms", "tl", "sw", "am", "so", "yo", "ig", "ha", "zu", "af",
] as const;

export type LanguageChoice = { value: string; label: string };

/** The common languages as choices, with any others the community already uses added at the end, so none is ever hidden. */
export function languageChoices(extra: readonly string[] = []): LanguageChoice[] {
  const codes: string[] = [...COMMON_LANGUAGES];
  for (const e of extra) {
    const c = normalizeLanguageCode(e);
    if (c && !codes.includes(c)) codes.push(c);
  }
  return codes.map((value) => ({ value, label: languageLabel(value) }));
}

/** Plain-letters key for comparing names: lower case, no accents. */
const plain = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/**
 * A language written as a code ("es", "pt_BR") or as its name ("Spanish", "español", "ગુજરાતી"), as a code; null when it is
 * neither. For imports, where a spreadsheet may say either.
 */
export function languageFromText(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const code = normalizeLanguageCode(raw);
  if (code) return code;
  // "English (US)", "Spanish, English": the first word group is the language.
  for (const part of [raw, raw.split(/[(,/;]/)[0] ?? ""]) {
    const want = plain(part);
    if (!want) continue;
    for (const c of COMMON_LANGUAGES) {
      if (plain(languageName(c)) === want) return c;
      const native = nativeLanguageName(c);
      if (native && plain(native) === want) return c;
    }
  }
  return null;
}

/** "English", "English and Spanish", "English, Spanish and French". */
export function languageList(codes: readonly string[]): string {
  const names = codes.map(languageName);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
