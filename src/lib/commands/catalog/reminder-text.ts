// Reminder wording in English, Gujarati and Hindi, filled in by rule: the same event always gives the same text, no model is
// involved and nothing is sent. The English "rsvp_confirmation" wording is the platform template of migration 0598; a community's
// own saved template (app.message_templates) is used instead when one exists for that language.

export const REMINDER_LANGUAGES = ["en", "gu", "hi"] as const;
export type ReminderLanguage = (typeof REMINDER_LANGUAGES)[number];

export const REMINDER_KINDS = ["event_reminder", "rsvp_confirmation"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export const LANGUAGE_NAME: Record<ReminderLanguage, string> = { en: "English", gu: "Gujarati (ગુજરાતી)", hi: "Hindi (हिन्दी)" };

const LOCALE: Record<ReminderLanguage, string> = { en: "en-US", gu: "gu-IN", hi: "hi-IN" };

type Words = { subject: string; body: string; venueLine: string; closing: string };

/** The built-in wording. {{event}}, {{when}} and {{venue}} are filled in; {{venue_line}} and {{closing}} are whole sentences. */
const BUILT_IN: Record<ReminderKind, Record<ReminderLanguage, Words>> = {
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

/** "Monday, October 12 at 6:00 PM" · "સોમવાર, 12 ઑક્ટોબર ના રોજ 6:00 PM વાગ્યે" · "सोमवार, 12 अक्टूबर को 6:00 pm बजे", in the community's time zone. */
export function whenText(startsAt: string | null, tz: string, language: ReminderLanguage): string {
  if (!startsAt) return { en: "a date to be announced", gu: "તારીખ હજી નક્કી થઈ નથી", hi: "तारीख़ अभी तय नहीं हुई" }[language];
  const d = new Date(startsAt);
  if (Number.isNaN(d.getTime())) return { en: "a date to be announced", gu: "તારીખ હજી નક્કી થઈ નથી", hi: "तारीख़ अभी तय नहीं हुई" }[language];
  const locale = LOCALE[language];
  const date = new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", timeZone: tz }).format(d);
  const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: tz }).format(d);
  switch (language) {
    case "en":
      return `${date} at ${time}`;
    case "gu":
      return `${date} ના રોજ ${time} વાગ્યે`;
    case "hi":
      return `${date} को ${time} बजे`;
  }
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
  language: ReminderLanguage;
  language_name: string;
  subject: string;
  body: string;
  /** Where the wording came from: the community's saved template, or the wording built into Weaver. */
  source: "community_template" | "built_in";
  /** Placeholders a saved template uses that this draft could not fill (Weaver fills them when it sends). */
  unfilled: string[];
};

export type ReminderEvent = { name: string; starts_at: string | null; venue: string | null };

/** One reminder, in one language: a saved template when there is one, else the built-in wording. Deterministic. */
export function draftReminder(opts: {
  kind: ReminderKind;
  language: ReminderLanguage;
  event: ReminderEvent;
  tz: string;
  center: { name: string; short_name: string | null };
  saved?: SavedTemplate | null;
}): ReminderDraft {
  const { kind, language, event, tz, center, saved } = opts;
  const words = BUILT_IN[kind][language];
  const venue = (event.venue ?? "").trim();
  const base: Record<string, string> = {
    event: event.name,
    when: whenText(event.starts_at, tz, language),
    venue,
    center_name: center.name,
    center_short_name: center.short_name?.trim() || center.name,
  };
  if (saved && saved.body.trim()) {
    const subject = fillTemplate(saved.subject ?? "", base);
    const body = fillTemplate(saved.body, base);
    return {
      language,
      language_name: LANGUAGE_NAME[language],
      subject: subject.text,
      body: body.text,
      source: "community_template",
      unfilled: [...new Set([...subject.unfilled, ...body.unfilled])],
    };
  }
  const vars = { ...base, venue_line: venue ? fillTemplate(words.venueLine, base).text : "", closing: words.closing };
  const subject = fillTemplate(words.subject, vars);
  const body = fillTemplate(words.body, vars);
  return {
    language,
    language_name: LANGUAGE_NAME[language],
    subject: subject.text,
    body: body.text.replace(/\s{2,}/g, " ").trim(),
    source: "built_in",
    unfilled: [],
  };
}
