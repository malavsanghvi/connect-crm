import { defineCommand } from "../define";
import { f, object, type Infer } from "../schema";
import { CommandError } from "../types";

import { must } from "./db";
import { REMINDER_KINDS, REMINDER_LANGUAGES, draftReminder, type ReminderDraft, type ReminderLanguage, type SavedTemplate } from "./reminder-text";

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
  language: f.withDefault(f.enum("en (English), gu (Gujarati), hi (Hindi) or all three.", ["all", ...REMINDER_LANGUAGES] as const), "all"),
});

/** The saved template for each language: the community's own over the platform's, the newest version. */
export function pickSaved(rows: readonly TemplateRow[], centerId: string): Map<ReminderLanguage, SavedTemplate> {
  const best = new Map<ReminderLanguage, TemplateRow>();
  for (const r of rows) {
    if (!(REMINDER_LANGUAGES as readonly string[]).includes(r.language)) continue;
    const lang = r.language as ReminderLanguage;
    const have = best.get(lang);
    const mine = r.center_id === centerId;
    const haveMine = have?.center_id === centerId;
    if (!have || (mine && !haveMine) || (mine === haveMine && r.version > have.version)) best.set(lang, r);
  }
  return new Map([...best].map(([lang, r]) => [lang, { subject: r.subject, body: r.body }]));
}

/**
 * A reminder for one event in English, Gujarati and Hindi, filled in by rule from the event (name, date and time in the
 * community's time zone, venue). It sends nothing and schedules nothing: it is wording for a person to read and edit.
 */
export const draftReminderCommand = defineCommand<Infer<typeof input>, DraftReminderData>({
  key: "messages.draft_reminder",
  title: "Draft an event reminder",
  description:
    "Write a reminder for one event in English, Gujarati and Hindi (or just one of them). The wording is filled in from the event's name, date, time and venue; " +
    "if the community has saved its own template for that message, that is used. This only prepares text: nothing is sent, scheduled or changed, " +
    "so say it is a draft and ask the person to read it. Gujarati and Hindi built-in wording should be checked by someone who reads the language.",
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

    const notes: string[] = [];
    let saved = new Map<ReminderLanguage, SavedTemplate>();
    if (kind === "rsvp_confirmation") {
      const res = await db
        .from("message_templates")
        .select("language, subject, body, center_id, version")
        .eq("key", "rsvp_confirmation")
        .eq("channel", "push")
        .or(`center_id.eq.${center.id},center_id.is.null`);
      if (res.error) {
        console.error("[commands] messages.draft_reminder: could not read the saved templates:", res.error);
        notes.push("Could not read the community's saved templates, so this uses the wording built into Weaver.");
      } else {
        saved = pickSaved((res.data ?? []) as TemplateRow[], center.id);
      }
    }
    const languages: readonly ReminderLanguage[] = language === "all" ? REMINDER_LANGUAGES : [language];
    const drafts = languages.map((l) =>
      draftReminder({ kind, language: l, event, tz: center.time_zone, center: { name: center.name, short_name: center.short_name }, saved: saved.get(l) ?? null }),
    );
    if (drafts.some((d) => d.language !== "en" && d.source === "built_in")) {
      notes.push("The Gujarati and Hindi wording is built into Weaver. Ask someone who reads the language to check it before it goes out.");
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
