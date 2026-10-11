import { loadCommunityLocale } from "@/lib/community-locale";
import { languageFromText, languageList, languageName, normalizeLanguageCode } from "@/lib/languages";

import { defineCommand } from "../define";
import { f, object, type Infer } from "../schema";
import { CommandError } from "../types";

import { must } from "./db";
import { REMINDER_KINDS, builtInFor, draftReminder, savedFor, type ReminderDraft, type SavedTemplate } from "./reminder-text";

export type DraftReminderData = {
  event: { id: string; name: string };
  drafts: ReminderDraft[];
  sent: false;
  notes: string[];
};

type TemplateRow = { language: string; subject: string | null; body: string; center_id: string | null; version: number };

const input = object({
  event_id: f.uuid("The event the reminder is about (its id, from events.upcoming)."),
  kind: f.withDefault(
    f.enum("event_reminder is a general reminder before the event; rsvp_confirmation asks the families who signed up to confirm they are coming.", REMINDER_KINDS),
    "event_reminder",
  ),
  language: f.withDefault(
    f.string("A language code such as en, es, gu or pt-BR for one language, or all for every language this community uses (the default).", { min: 1, max: 35 }),
    "all",
  ),
});

/** The saved template for each language: the community's own over the platform's, the newest version. Keyed by language code. */
export function pickSaved(rows: readonly TemplateRow[], centerId: string): Map<string, SavedTemplate> {
  const best = new Map<string, TemplateRow>();
  for (const r of rows) {
    const lang = normalizeLanguageCode(r.language);
    if (!lang) continue;
    const have = best.get(lang);
    const mine = r.center_id === centerId;
    const haveMine = have?.center_id === centerId;
    if (!have || (mine && !haveMine) || (mine === haveMine && r.version > have.version)) best.set(lang, r);
  }
  return new Map([...best].map(([lang, r]) => [lang, { subject: r.subject, body: r.body }]));
}

/**
 * A reminder for one event in each language the community uses, filled in by rule from the event (name, date and time in the
 * community's time zone and country, venue). It sends nothing and schedules nothing: it is wording for a person to read and edit.
 * English, Gujarati and Hindi have wording built into Weaver; a language with a saved template uses it; any other language gets the
 * English text marked "needs translation" (there is no machine translation here).
 */
export const draftReminderCommand = defineCommand<Infer<typeof input>, DraftReminderData>({
  key: "messages.draft_reminder",
  title: "Draft an event reminder",
  description:
    "Write a reminder for one event in every language this community uses (or just one of them). The wording is filled in from the event's name, date, time and venue; " +
    "if the community has saved its own template for that message and language, that is used. English, Gujarati and Hindi have wording built in; for any other language " +
    "the draft is the English text marked needs_translation, for someone who reads the language to translate. This only prepares text: nothing is sent, scheduled or changed, " +
    "so say it is a draft and ask the person to read it. Built-in Gujarati and Hindi wording should be checked by someone who reads the language.",
  level: "draft",
  permission: "commsDraft",
  module: "comms",
  input,
  async execute(ctx, { event_id, kind, language }) {
    const { db, center } = ctx.session;
    const event: { id: string; name: string; starts_at: string | null; venue: string | null; status: string } | null = must(
      await db.from("events").select("id, name, starts_at, venue, status").eq("id", event_id).eq("center_id", center.id).maybeSingle(),
      "read the event",
    );
    if (!event) throw new CommandError("That event was not found, or you can't see it.");
    if (event.status === "cancelled") throw new CommandError(`${event.name} is cancelled, so there is nothing to remind families about.`);

    const wanted = language.trim().toLowerCase() === "all" ? null : languageFromText(language);
    if (language.trim().toLowerCase() !== "all" && !wanted) {
      throw new CommandError(`"${language.trim()}" is not a language this can draft. Use a language code such as en, es or pt-BR, or all.`);
    }

    const notes: string[] = [];
    const community = await loadCommunityLocale(db, center);
    if (community.note) notes.push(community.note);
    const languages = wanted ? [wanted] : community.languages;
    if (wanted && community.known && !community.languages.some((l) => normalizeLanguageCode(l) === wanted)) {
      notes.push(`${languageName(wanted)} is not one of this community's languages (${languageList(community.languages)}), so it is drafted only because you asked. Add it in Setup > Profile to have it drafted every time.`);
    }

    let saved = new Map<string, SavedTemplate>();
    const res = await db
      .from("message_templates")
      .select("language, subject, body, center_id, version")
      .eq("key", kind)
      .eq("channel", "push")
      .or(`center_id.eq.${center.id},center_id.is.null`);
    if (res.error) {
      console.error("[commands] messages.draft_reminder: could not read the saved templates:", res.error);
      notes.push("Could not read the community's saved templates, so this uses the wording built into Weaver.");
    } else {
      saved = pickSaved((res.data ?? []) as TemplateRow[], center.id);
    }

    const savedEnglish = savedFor(saved, "en");
    const drafts = languages.map((l) =>
      draftReminder({
        kind,
        language: l,
        event,
        tz: center.time_zone,
        country: center.country ?? community.country,
        center: { name: center.name, short_name: center.short_name },
        saved: savedFor(saved, l),
        savedEnglish,
      }),
    );

    const builtIn = drafts.filter((d) => d.source === "built_in" && builtInFor(d.language) !== "en").map((d) => d.language);
    if (builtIn.length > 0) {
      notes.push(`The ${languageList(builtIn)} wording is built into Weaver. Ask someone who reads the language to check it before it goes out.`);
    }
    for (const d of drafts.filter((x) => x.needs_translation)) {
      notes.push(`Weaver has no ${languageName(d.language)} wording for this yet, so the ${d.language_name} draft is the English text, marked "needs translation". Ask someone who reads ${languageName(d.language)} to translate it before it goes out.`);
    }
    for (const d of drafts) {
      if (d.unfilled.length > 0) notes.push(`The saved ${d.language_name} template uses ${d.unfilled.map((u) => `{{${u}}}`).join(", ")}, which Weaver fills in when it sends.`);
    }
    return {
      ok: true,
      data: { event: { id: event.id, name: event.name }, drafts, sent: false, notes },
      message: "This is a draft. Nothing has been sent or scheduled.",
    };
  },
});
