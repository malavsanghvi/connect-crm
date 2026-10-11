// Reminder wording for any community's languages, filled in by rule: the same event always gives the same text, no model is
// involved and nothing is sent. Weaver has its own wording for English, Gujarati and Hindi. For every other language a community's
// own saved template (app.message_templates, which has a language column) is used when there is one; otherwise the draft is the
// English text, marked "needs translation", for a person who reads the language to translate. There is no machine translation here.
// The English "rsvp_confirmation" wording is the platform template of migration 0598.

import { languageLabel, matchLanguage, normalizeLanguageCode, primaryLanguage, textDirection, communityLocale } from "@/lib/languages";

/** The languages Weaver has wording for itself. */
export const BUILT_IN_LANGUAGES = ["en", "gu", "hi"] as const;
export type BuiltInLanguage = (typeof BUILT_IN_LANGUAGES)[number];

/** A language code ("en", "es", "pt-BR", "ar"): any language, not only the built-in ones. */
export type ReminderLanguage = string;

export const REMINDER_KINDS = ["event_reminder", "rsvp_confirmation"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

const isBuiltIn = (code: string): code is BuiltInLanguage => (BUILT_IN_LANGUAGES as readonly string[]).includes(code);

/** The built-in wording's language for a code, or null: "gu" and "gu-IN" are Gujarati, "es" is not built in. */
export function builtInFor(language: string): BuiltInLanguage | null {
  const p = primaryLanguage(language);
  return isBuiltIn(p) ? p : null;
}

type Words = { subject: string; body: string; venueLine: string; closing: string };

/** The built-in wording. {{event}}, {{when}} and {{venue}} are filled in; {{venue_line}} and {{closing}} are whole sentences. */
const BUILT_IN: Record<ReminderKind, Record<BuiltInLanguage, Words>> = {
  event_reminder: {
    en: {
      subject: "Reminder: {{event}}",
      body: "This is a reminder that {{event}} is on {{when}}.{{venue_line}} {{closing}}",
      venueLine: " It will be at {{venue}}.",
      closing: "We look forward to seeing you.",
    },
    gu: {
      subject: "યાદ અપાવવા માટે: {{event}}",
      body: "{{event}} {{when}} છે.{{venue_line}} {{closing}}",
      venueLine: " સ્થળ: {{venue}}.",
      closing: "અમે તમને મળવાની રાહ જોઈ રહ્યા છીએ.",
    },
    hi: {
      subject: "अनुस्मारक: {{event}}",
      body: "{{event}} {{when}} है।{{venue_line}} {{closing}}",
      venueLine: " स्थान: {{venue}}।",
      closing: "हमें आपसे मिलने की प्रतीक्षा रहेगी।",
    },
  },
  rsvp_confirmation: {
    en: {
      subject: "Please confirm {{event}}",
      body: "Your family is signed up for {{event}} on {{when}}. Please confirm that you are coming.",
      venueLine: "",
      closing: "",
    },
    gu: {
      subject: "કૃપા કરીને {{event}} ની ખાતરી કરો",
      body: "તમારા પરિવારે {{event}} માટે નોંધણી કરાવી છે ({{when}}). કૃપા કરીને ખાતરી કરો કે તમે આવી રહ્યા છો.",
      venueLine: "",
      closing: "",
    },
    hi: {
      subject: "कृपया {{event}} की पुष्टि करें",
      body: "आपके परिवार ने {{event}} के लिए पंजीकरण किया है ({{when}})। कृपया पुष्टि करें कि आप आ रहे हैं।",
      venueLine: "",
      closing: "",
    },
  },
};

const TO_BE_ANNOUNCED: Record<BuiltInLanguage, string> = { en: "a date to be announced", gu: "તારીખ હજી નક્કી થઈ નથી", hi: "तारीख़ अभी तय नहीं हुई" };

/** The locale a date is written in: the built-in Gujarati and Hindi wording was written for gu-IN and hi-IN; any other language is written in the community's own country. */
function whenLocale(language: string, country: string | null | undefined): string {
  const built = builtInFor(language);
  if (built === "gu") return "gu-IN";
  if (built === "hi") return "hi-IN";
  return communityLocale([normalizeLanguageCode(language) ?? language], country);
}

/**
 * "Monday, October 12 at 6:00 PM" · "સોમવાર, 12 ઑક્ટોબર ના રોજ 6:00 PM વાગ્યે" · "सोमवार, 12 अक्टूबर को 6:00 pm बजे", in the community's
 * time zone. Any other language is written by the platform's own date data for that language ("lunes, 12 de octubre, 18:00");
 * `country` gives English and other languages the community's own date style ("Monday 12 October" in Britain).
 */
export function whenText(startsAt: string | null, tz: string, language: ReminderLanguage, country?: string | null): string {
  const built = builtInFor(language);
  const d = startsAt ? new Date(startsAt) : null;
  if (!d || Number.isNaN(d.getTime())) return TO_BE_ANNOUNCED[built ?? "en"];
  const locale = whenLocale(language, country);
  if (built) {
    const date = new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", timeZone: tz }).format(d);
    const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: tz }).format(d);
    switch (built) {
      case "en":
        return `${date} at ${time}`;
      case "gu":
        return `${date} ના રોજ ${time} વાગ્યે`;
      case "hi":
        return `${date} को ${time} बजे`;
    }
  }
  return new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz }).format(d);
}

/** Replace {{name}} with its value. Names with no value are left as they are, and returned so the caller can say so. */
export function fillTemplate(template: string, vars: Record<string, string>): { text: string; unfilled: string[] } {
  const unfilled = new Set<string>();
  const text = template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, name: string) => {
    if (name in vars) return vars[name];
    unfilled.add(name);
    return whole;
  });
  return { text, unfilled: [...unfilled] };
}


export type SavedTemplate = { subject: string | null; body: string };

export type ReminderDraft = {
  /** The language code the draft is for ("es", "pt-BR", "gu"). */
  language: ReminderLanguage;
  /** "Spanish (español)": for a person to recognise the language by either name. */
  language_name: string;
  /** Which way this language is written. A box a person edits the draft in should use it (Arabic and Hebrew run right to left). */
  direction: "ltr" | "rtl";
  /** Which way the drafted text itself runs: an English stand-in for an Arabic reminder is still left to right. */
  text_direction: "ltr" | "rtl";
  subject: string;
  body: string;
  /**
   * Where the wording came from: the community's saved template, the wording built into Weaver (English, Gujarati, Hindi), or
   * the English text standing in for a language with neither, which a person who reads that language must translate.
   */
  source: "community_template" | "built_in" | "needs_translation";
  /** True when `source` is "needs_translation": the text is English and is not ready to send to a reader of this language. */
  needs_translation: boolean;
  /** Placeholders a saved template uses that this draft could not fill (Weaver fills them when it sends). */
  unfilled: string[];
};

export type ReminderEvent = { name: string; starts_at: string | null; venue: string | null };

/** Words from another script set inside a right-to-left sentence stay whole and in place when wrapped in Unicode isolates (FSI ... PDI). */
function isolated(value: string, rtl: boolean): string {
  return rtl && /[A-Za-z]/.test(value) ? `⁨${value}⁩` : value;
}

/**
 * One reminder, in one language: the community's saved template when there is one, else the wording built into Weaver (English,
 * Gujarati, Hindi), else the English text marked "needs translation". Deterministic: no model is called.
 */
export function draftReminder(opts: {
  kind: ReminderKind;
  language: ReminderLanguage;
  event: ReminderEvent;
  tz: string;
  center: { name: string; short_name: string | null };
  /** The community's country (ISO 3166), for the style of dates and times. */
  country?: string | null;
  /** The community's saved template in this language, if it has one. */
  saved?: SavedTemplate | null;
  /** The community's saved English template, which the stand-in for a language without wording is made from. */
  savedEnglish?: SavedTemplate | null;
}): ReminderDraft {
  const { kind, event, tz, center, country, saved } = opts;
  const language = normalizeLanguageCode(opts.language) ?? opts.language;
  const direction = textDirection(language);
  const name = languageLabel(language);
  const built = builtInFor(language);
  const venue = (event.venue ?? "").trim();
  const wrap = direction === "rtl";
  const base: Record<string, string> = {
    event: isolated(event.name, wrap),
    when: whenText(event.starts_at, tz, language, country),
    venue: isolated(venue, wrap),
    center_name: isolated(center.name, wrap),
    center_short_name: isolated(center.short_name?.trim() || center.name, wrap),
  };
  if (saved && saved.body.trim()) {
    const subject = fillTemplate(saved.subject ?? "", base);
    const body = fillTemplate(saved.body, base);
    return {
      language,
      language_name: name,
      direction,
      text_direction: direction,
      subject: subject.text,
      body: body.text,
      source: "community_template",
      needs_translation: false,
      unfilled: [...new Set([...subject.unfilled, ...body.unfilled])],
    };
  }
  if (built) {
    const words = BUILT_IN[kind][built];
    const vars = { ...base, venue_line: venue ? fillTemplate(words.venueLine, base).text : "", closing: words.closing };
    const subject = fillTemplate(words.subject, vars);
    const body = fillTemplate(words.body, vars);
    return {
      language,
      language_name: name,
      direction,
      text_direction: direction,
      subject: subject.text,
      body: body.text.replace(/\s{2,}/g, " ").trim(),
      source: "built_in",
      needs_translation: false,
      unfilled: [],
    };
  }
  // No wording in this language: the English text (the community's own English template when it has one), for a person to translate.
  const english = draftReminder({ kind, language: "en", event, tz, center, country, saved: opts.savedEnglish ?? null });
  return { ...english, language, language_name: name, direction, text_direction: "ltr", source: "needs_translation", needs_translation: true };
}

/** The saved template that serves a language: the same code, else the same language ("es" for "es-MX"). */
export function savedFor(saved: ReadonlyMap<string, SavedTemplate>, language: string): SavedTemplate | null {
  const key = matchLanguage(language, saved.keys());
  return key ? (saved.get(key) ?? null) : null;
}
