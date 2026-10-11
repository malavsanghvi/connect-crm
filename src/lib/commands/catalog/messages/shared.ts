// Pieces the Messages commands share: who may use the inbox, the audience and message values of a campaign, how a thread is loaded,
// and the guard that keeps a child out of what Niva reads (D2). Nothing here writes.

import { buildAudience, buildTranslations, parseAudience } from "@/lib/comms";
import type { Database, Json } from "@/lib/database.types";
import { localDateTimeToIso, todayInTz } from "@/lib/dates";
import { can, passesRoleChecks } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

import { communityMajority, isAdultMember } from "../../child-filter";
import { CommandError, type CommandContext, type HouseholdCard } from "../../types";
import { must } from "../db";
import { cardsFor } from "../people/shared";

import { childGivenNames, mentionsChild, WITHHELD_FOR_CHILD, type ThreadRow } from "./pure";

export type Channel = Database["app"]["Enums"]["channel"];
export const CHANNELS: readonly Channel[] = ["email", "push", "in_app", "sms", "whatsapp"];

/** What every campaign says it is waiting for: nothing sends newsletters yet (B60), so a scheduled message stays "Scheduled". */
export const NOT_SENDING = " It stays queued: email, SMS, WhatsApp and push sending are not connected to this app yet.";

export const NOTHING_SENT_BY_NIVA = "Niva only prepares this. Nothing is sent until you press the button.";

const UNSAFE = "Niva could not check this message for children's names, so it was not used. Try again, or do this on the screen.";

// ---------------------------------------------------------------------------
// The inbox: who may handle it (comms.inbox for every inbox; a zone lead for their zone's, which row-level security checks)
// ---------------------------------------------------------------------------
export function inboxAllowed(s: Pick<CrmSession, "permissions" | "isPlatformAdmin" | "isOwner" | "roles">): boolean {
  return can(s as CrmSession, "comms.inbox") || passesRoleChecks(s) || s.roles.some((r) => r.key === "zone_lead");
}

export function inboxRefusal(doing: string): string {
  return `Could not ${doing} — you don't handle any inbox (needs comms.inbox or a zone lead role).`;
}

/** Throw the inbox refusal when the person handles no inbox (the commands re-check this themselves: the palette and Niva do not go through the screen's gate). */
export function requireInbox(ctx: CommandContext, doing: string): void {
  if (!inboxAllowed(ctx.session)) throw new CommandError(inboxRefusal(doing));
}

// ---------------------------------------------------------------------------
// A campaign's values (the compose form, the palette and Niva send the same fields)
// ---------------------------------------------------------------------------
export type CampaignFields = {
  name: string;
  title: string;
  body: string;
  channels: string;
  send_at?: string;
  title_gu?: string;
  body_gu?: string;
  title_hi?: string;
  body_hi?: string;
};

export function campaignValues(
  input: CampaignFields,
  tz: string,
): { ok: true; values: { name: string; title: string; body_md: string; channels: Channel[]; translations: Json; scheduled_at: string | null } } | { ok: false; error: string } {
  const name = (input.name ?? "").trim();
  const title = (input.title ?? "").trim();
  const body = (input.body ?? "").trim();
  const channels = (input.channels ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter((c): c is Channel => (CHANNELS as readonly string[]).includes(c));
  const sendAt = (input.send_at ?? "").trim();
  const scheduledAt = sendAt ? localDateTimeToIso(sendAt, tz) : null;
  const translations = buildTranslations({
    gu: { title: (input.title_gu ?? "").trim(), body_md: (input.body_gu ?? "").trim() },
    hi: { title: (input.title_hi ?? "").trim(), body_md: (input.body_hi ?? "").trim() },
  });
  if (!name) return { ok: false, error: "give the newsletter a name" };
  if (!title) return { ok: false, error: "add a subject" };
  if (!body) return { ok: false, error: "write the message" };
  if (channels.length === 0) return { ok: false, error: "choose at least one channel" };
  if (sendAt && !scheduledAt) return { ok: false, error: "the send time is not a valid date and time" };
  return { ok: true, values: { name, title, body_md: body, channels: [...new Set(channels)], translations: translations as Json, scheduled_at: scheduledAt } };
}

export type AudienceFields = {
  to_all_members?: boolean;
  to_life_members?: boolean;
  zone_ids?: string;
  pathshala_class_ids?: string;
  event_id?: string;
  rsvp_statuses?: string;
  /** The audience exactly as the compose form's chips build it. Leave out when using the fields above. */
  audience_json?: string;
};

function ids(list: string | undefined): string[] {
  return (list ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The audience JSON a campaign stores, from the chips' own JSON or from the plain fields. Same checks as the compose form. */
export function audienceFromInput(input: AudienceFields): { ok: true; audience: Record<string, unknown> } | { ok: false; error: string } {
  if (input.audience_json !== undefined) {
    let raw: unknown;
    try {
      raw = JSON.parse(input.audience_json.trim() || "{}");
    } catch {
      return { ok: false, error: "the audience could not be read — reload the page and choose it again" };
    }
    const built = buildAudience(parseAudience(raw));
    return built.ok ? built : { ok: false, error: built.error.replace(/\.$/, "").toLowerCase() };
  }
  const zones = ids(input.zone_ids);
  const classes = ids(input.pathshala_class_ids);
  const bad = [...zones, ...classes, ...(input.event_id ? [input.event_id] : [])].find((x) => !UUID.test(x));
  if (bad) return { ok: false, error: "an audience id is not valid — choose the audience again" };
  const built = buildAudience({
    allMembers: input.to_all_members === true,
    lifeMembers: input.to_life_members === true,
    pathshalaClassIds: classes,
    zoneIds: zones,
    eventId: input.event_id ?? null,
    rsvpStatuses: ids(input.rsvp_statuses),
  });
  return built.ok ? built : { ok: false, error: built.error.replace(/\.$/, "").toLowerCase() };
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------
export type ThreadFull = ThreadRow & { center_id: string; from_guest_contact: string | null; closed_at: string | null };

const THREAD_COLUMNS = "id, center_id, inbox_id, status, assignee_user, first_response_at, closed_at, created_at, subject, from_person_id, from_guest_contact";

/** The conversation, or null when it does not exist or the person's inbox rights do not reach it (row-level security decides). */
export async function loadThread(ctx: CommandContext, id: string): Promise<ThreadFull | null> {
  const { db, center } = ctx.session;
  return must(await db.from("threads").select(THREAD_COLUMNS).eq("id", id).eq("center_id", center.id).maybeSingle(), "read the conversation") as ThreadFull | null;
}

export const THREAD_GONE = "That conversation was not found, or it is not in an inbox you handle.";

// ---------------------------------------------------------------------------
// D2 for message text
// ---------------------------------------------------------------------------
export type ChildGuard = {
  /** True when the caller is Niva: the guard is then in force. */
  active: boolean;
  /** True when this text names a child. Always false for a screen or the palette (the person's own hands). */
  mentions(text: string | null | undefined): boolean;
};

const OFF: ChildGuard = { active: false, mentions: () => false };

/** The guard for this call. For Niva it needs the community's minors; if they cannot be read the command stops rather than guess. */
export async function childGuard(ctx: CommandContext): Promise<ChildGuard> {
  if (ctx.via !== "assistant") return OFF;
  if (!ctx.minors) throw new CommandError(UNSAFE);
  try {
    const names = childGivenNames(await ctx.minors.namesOfMinors(ctx.session));
    return { active: true, mentions: (text) => mentionsChild(text, names) };
  } catch (error) {
    console.error("[messages] could not read the names of the community's children to check a message:", error);
    throw new CommandError(UNSAFE);
  }
}

/**
 * For Niva: every sentence in `value` that uses a child's name is replaced by a plain line. A screen or the palette gets the value
 * unchanged. Used on answers that carry free text a member wrote or a staff member typed (subjects, reasons, names of messages).
 */
export function guardText<T>(value: T, guard: ChildGuard): T {
  if (!guard.active) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return guard.mentions(v) ? WITHHELD_FOR_CHILD : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/**
 * Which of these people are adults (so that a message from them may be read by Niva). A person with a birth date is judged by it;
 * with none, only a head, spouse or parent of every household they are in counts as an adult. Anyone else is treated as a child.
 */
export async function adultsAmong(ctx: CommandContext, personIds: readonly (string | null)[]): Promise<Map<string, boolean>> {
  const wanted = [...new Set(personIds.filter((x): x is string => !!x))];
  const out = new Map<string, boolean>();
  if (wanted.length === 0) return out;
  const { db } = ctx.session;
  const today = todayInTz(ctx.session.center.time_zone, ctx.now?.());
  const majority = communityMajority(ctx.session.center);
  const people = (must(await db.from("people").select("id, date_of_birth").in("id", wanted), "read the senders") ?? []) as { id: string; date_of_birth: string | null }[];
  const links = (must(await db.from("household_members").select("person_id, role").in("person_id", wanted).is("left_at", null), "read the senders' households") ?? []) as { person_id: string; role: string }[];
  const byPerson = new Map<string, string[]>();
  for (const l of links) byPerson.set(l.person_id, [...(byPerson.get(l.person_id) ?? []), l.role]);
  for (const id of wanted) {
    const p = people.find((x) => x.id === id);
    if (!p) {
      out.set(id, false);
      continue;
    }
    const roles = byPerson.get(id) ?? [];
    out.set(id, p.date_of_birth ? isAdultMember({ date_of_birth: p.date_of_birth }, today, majority) : roles.length > 0 && roles.every((r) => isAdultMember({ date_of_birth: null, role: r }, today, majority)));
  }
  return out;
}

/** The household card (adults only) of the household a person belongs to, when there is one. */
export async function cardOfPerson(ctx: CommandContext, personId: string | null): Promise<HouseholdCard | null> {
  if (!personId) return null;
  const links = (must(await ctx.session.db.from("household_members").select("household_id, is_primary").eq("person_id", personId).is("left_at", null), "read the sender's household") ?? []) as {
    household_id: string;
    is_primary: boolean;
  }[];
  if (links.length === 0) return null;
  const pick = links.find((l) => l.is_primary) ?? links[0];
  return (await cardsFor(ctx, [pick.household_id]))[0] ?? null;
}
