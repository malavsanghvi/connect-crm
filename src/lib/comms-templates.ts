// Copy a communication as a new draft, and a community's saved templates (docs/COMMS_HUB_TEMPLATES.md). Pure: no server imports, so
// the list menu, the Start-from picker, the Server Actions and the tests share one set of rules and one set of words.
//
// What the database does (migration 0800) is the rule; this file is what the screens say and show around it:
//   * a copy carries the subject, the message with its merge fields, the translations, the channels and the audience, and is named
//     "Copy of <name>"; it carries no schedule, sent time, counts, approvals or recipients;
//   * a template carries the words only (never an audience or a number);
//   * a WhatsApp template saved here is a starting point for the words, never a template approved by WhatsApp.

import type { Database } from "@/lib/database.types";

export type CommsChannel = Database["app"]["Enums"]["channel"];

/** The order channels are listed in. */
export const CHANNEL_ORDER: readonly CommsChannel[] = ["email", "sms", "whatsapp", "push", "in_app"];

const CHANNEL_LABEL: Record<CommsChannel, string> = {
  email: "Email",
  sms: "Text (SMS)",
  whatsapp: "WhatsApp",
  push: "Push teaser",
  in_app: "In-app archive",
};

export function channelLabel(channel: string): string {
  return CHANNEL_LABEL[channel as CommsChannel] ?? channel;
}

export function isChannel(value: string): value is CommsChannel {
  return (CHANNEL_ORDER as readonly string[]).includes(value);
}

/** Channels in the list's order, labelled: "Email, Push teaser". */
export function channelsLine(channels: readonly string[]): string {
  const known = CHANNEL_ORDER.filter((c) => channels.includes(c));
  const other = channels.filter((c) => !isChannel(c));
  return [...known, ...other].map(channelLabel).join(", ");
}

// ---------------------------------------------------------------------------
// Which channels a community has
// ---------------------------------------------------------------------------

/** What the page reads about the community's channels (Settings › Texting and › WhatsApp). */
export type ChannelFacts = {
  /** Carriers approved the community's texting registration (texting_registrations.status = approved). */
  textingApproved: boolean;
  /** Meta approved the community's WhatsApp Business account (whatsapp_accounts.status = approved). */
  whatsappAccountApproved: boolean;
  /** The WhatsApp product (module "channels") is on for the community. */
  whatsappProductOn: boolean;
};

/**
 * The channels the community has set up and switched on. Email, the push teaser and the in-app archive belong to Communications
 * itself; texts need an approved registration; WhatsApp needs its product on and an approved account. A channel that is not here
 * gets no copy, save or start-from action.
 */
export function availableChannels(facts: ChannelFacts): CommsChannel[] {
  const out: CommsChannel[] = ["email"];
  if (facts.textingApproved) out.push("sms");
  if (facts.whatsappProductOn && facts.whatsappAccountApproved) out.push("whatsapp");
  out.push("push", "in_app");
  return out;
}

/** True when at least one of a communication's channels is one the community has. */
export function usesAvailableChannel(channels: readonly string[], available: readonly string[]): boolean {
  return channels.some((c) => available.includes(c));
}

/** The channels of a communication that the community does not have (for the sentence below). */
export function missingChannels(channels: readonly string[], available: readonly string[]): string[] {
  return channels.filter((c) => !available.includes(c));
}

/** "Text (SMS) is not set up for this community." or null when the communication uses a channel the community has. */
export function channelNotSetUpSentence(channels: readonly string[], available: readonly string[]): string | null {
  if (usesAvailableChannel(channels, available)) return null;
  const names = channels.map(channelLabel);
  if (names.length === 0) return "it has no channel";
  return `${names.join(" and ")} ${names.length === 1 ? "is" : "are"} not set up or switched on for this community`;
}

// ---------------------------------------------------------------------------
// The list menu (the row's ⋯ menu and the buttons on an open communication)
// ---------------------------------------------------------------------------
export type MenuKey = "copy" | "template";
export type MenuItem = { key: MenuKey; label: string; hint: string };

/** Kinds that are not communications to families: an alert or a survey is not copied or saved here. */
const NOT_HERE = ["alert", "survey"];

export function isCopyableKind(kind: string): boolean {
  return !NOT_HERE.includes(kind);
}

/**
 * The actions offered on a communication, or none: only with the permission that writes a communication, only for a kind that can be
 * copied, and only when the community has one of its channels. (The database checks all of this again.)
 */
export function campaignMenu(input: { canWrite: boolean; kind: string; channels: readonly string[]; available: readonly string[] }): MenuItem[] {
  if (!input.canWrite) return [];
  if (!isCopyableKind(input.kind)) return [];
  if (!usesAvailableChannel(input.channels, input.available)) return [];
  return [
    { key: "copy", label: "Copy as new draft", hint: "A new draft with the same words and audience. Nothing is sent." },
    { key: "template", label: "Save as template", hint: "Keep the words to start from again. Not the audience or the results." },
  ];
}

// ---------------------------------------------------------------------------
// Names and the words around them
// ---------------------------------------------------------------------------
const COPY_PREFIX = "Copy of ";
const MAX_CAMPAIGN_NAME = 200;
export const MAX_TEMPLATE_NAME = 120;

/** "Copy of <name>" (or of the subject when there is no name), no longer than the database keeps. */
export function copyName(name: string | null | undefined, subject: string | null | undefined): string {
  const base = (name ?? "").trim() || (subject ?? "").trim() || "communication";
  return `${COPY_PREFIX}${base}`.slice(0, MAX_CAMPAIGN_NAME);
}

/** The name offered when saving a template: the communication's name, else its subject. */
export function templateDefaultName(name: string | null | undefined, subject: string | null | undefined): string {
  return ((name ?? "").trim() || (subject ?? "").trim()).slice(0, MAX_TEMPLATE_NAME);
}

/** Why a template name cannot be used, in a few words that finish "Could not save the template —", or null when it can. */
export function templateNameProblem(name: string): string | null {
  const n = name.trim();
  if (!n) return "give the template a name";
  if (n.length > MAX_TEMPLATE_NAME) return `the name is too long (${MAX_TEMPLATE_NAME} characters at most)`;
  return null;
}

/** What a copy keeps and what it leaves behind: shown where the copy is offered, so nobody wonders. */
export const COPY_NOTE =
  "A copy keeps the subject, the message with its merge fields, the languages, the channels and the audience. It starts with no results, no schedule and no approvals, and nothing is sent until someone sends it for approval.";

export const TEMPLATE_NOTE = "A template keeps the words only: the subject, the message with its merge fields, the languages and the channels. It does not keep the audience or any results.";

/** The caveat for a WhatsApp template. It never says approved: only WhatsApp (Meta) approves a WhatsApp template. */
export const WHATSAPP_TEMPLATE_NOTE =
  "A WhatsApp template saved here is only a starting point for the words. It is not a message template approved by WhatsApp: those are submitted for approval in Settings › WhatsApp.";

/** The WhatsApp caveat when the channels include WhatsApp, else null. */
export function templateChannelNote(channels: readonly string[]): string | null {
  return channels.includes("whatsapp") ? WHATSAPP_TEMPLATE_NOTE : null;
}

export function copiedMessage(name: string): string {
  return `"${name}" is ready as a draft. Nothing has been sent.`;
}

export function savedTemplateMessage(name: string): string {
  return `Saved as the template "${name}". Find it under Start from › A saved template.`;
}

export function fromTemplateMessage(name: string): string {
  return `"${name}" is ready as a draft. Choose who it goes to, then send it for approval. Nothing has been sent.`;
}

/** The merge fields written in some text, once each, in the order they first appear: "Dear {{recipient_first_name}}" gives recipient_first_name. */
export function mergeTokens(...texts: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const m of text.matchAll(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g)) seen.add(m[1]!);
  }
  return [...seen];
}

/** The merge fields a template uses: its subject, its message and every translation of them. */
export function templateTokens(t: { title: string; body_md: string; translations: unknown }): string[] {
  const texts: string[] = [t.title, t.body_md];
  const tr = t.translations;
  if (tr && typeof tr === "object" && !Array.isArray(tr)) {
    for (const v of Object.values(tr as Record<string, unknown>)) {
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if (typeof o.title === "string") texts.push(o.title);
        if (typeof o.body_md === "string") texts.push(o.body_md);
      }
    }
  }
  return mergeTokens(...texts);
}

// ---------------------------------------------------------------------------
// Start from: Blank / A saved template / A recent communication
// ---------------------------------------------------------------------------
export type StartKey = "blank" | "template" | "recent";
export type StartOption = { key: StartKey; label: string; hint: string };

export function startFromOptions(counts: { templates: number; recent: number }): StartOption[] {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return [
    { key: "blank", label: "Blank", hint: "Write a new communication from scratch." },
    {
      key: "template",
      label: "A saved template",
      hint: counts.templates === 0 ? "None saved yet." : plural(counts.templates, "saved template", "saved templates"),
    },
    {
      key: "recent",
      label: "A recent communication",
      hint: counts.recent === 0 ? "Nothing sent, scheduled or drafted yet." : "Copy one you sent, scheduled or drafted.",
    },
  ];
}

/** The communications the picker lists: sent, scheduled and drafts. A cancelled one never went out and is left out. */
export const RECENT_STATUSES: readonly string[] = ["sent", "sending", "scheduled", "pending_approval", "draft", "working_draft"];

export type RecentRow = {
  id: string;
  /** Its name, else its subject. */
  name: string;
  subject: string;
  channels: string[];
  /** The audience in words ("Pathshala parents + West zone"). */
  audience: string;
  statusLabel: string;
  /** "Sent Sep 21", "Sends Oct 3" or "Saved Oct 10". */
  when: string;
  by: string;
};

export type TemplateRow = {
  id: string;
  name: string;
  subject: string;
  channels: string[];
  /** Merge fields in the subject, message and translations. */
  tokens: string[];
  by: string;
  /** "Saved Oct 10". */
  when: string;
};

/** "Sent Sep 21", "Sends Oct 3" or "Saved Oct 10": when a communication in the picker went out, goes out, or was last changed. */
export function recentWhen(c: { status: string; sent_at: string | null; scheduled_at: string | null; updated_at: string }, format: (iso: string) => string): string {
  if (c.sent_at) return `Sent ${format(c.sent_at)}`;
  if (c.status === "scheduled" || c.status === "sending") return c.scheduled_at ? `Sends ${format(c.scheduled_at)}` : "Scheduled";
  return `Saved ${format(c.updated_at)}`;
}

/** Every word of the search must appear in the text (any case). An empty search matches everything. */
export function matchesQuery(parts: readonly (string | null | undefined)[], query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = parts.filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** The picker's channel filter: a communication matches when one of its channels is the chosen one ("all" lists everything). */
export type ChannelFilter = CommsChannel | "all";

export function recentForPicker(rows: readonly RecentRow[], filter: { channel: ChannelFilter; query: string; limit?: number }): RecentRow[] {
  return rows
    .filter((r) => (filter.channel === "all" || r.channels.includes(filter.channel)) && matchesQuery([r.name, r.subject, r.audience, r.by], filter.query))
    .slice(0, filter.limit ?? 25);
}

export function templatesForPicker(rows: readonly TemplateRow[], filter: { channel: ChannelFilter; query: string }): TemplateRow[] {
  return rows.filter((t) => (filter.channel === "all" || t.channels.includes(filter.channel)) && matchesQuery([t.name, t.subject, t.by], filter.query));
}

/** The channel the picker opens on: email when the community has it, else the first one it has. */
export function defaultPickerChannel(available: readonly string[]): ChannelFilter {
  if (available.includes("email")) return "email";
  const first = CHANNEL_ORDER.find((c) => available.includes(c));
  return first ?? "all";
}
