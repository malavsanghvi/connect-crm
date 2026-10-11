import { todayInTz } from "@/lib/dates";
import { eventAreas } from "@/lib/events/access";
import { humanize } from "@/lib/events/format";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandDbError, CommandError, type CommandContext, type CommandPreview, type HouseholdCard } from "../../types";

import { must } from "../db";
import { adultHouseholdCards } from "../household";

import { NOT_FOUND, refuse, requireArea } from "./kit";

export const RSVP_STATUSES = ["rsvpd", "confirmed", "cancelled", "waitlisted", "no_show"] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];

const WORDS: Record<RsvpStatus, string> = { rsvpd: "RSVP'd", confirmed: "confirmed", cancelled: "cancelled", waitlisted: "on the waitlist", no_show: "a no-show" };

type RsvpRow = { id: string; household_id: string | null; guest_name: string | null; status: string; source: string };

// ---------------------------------------------------------------------------
// events.rsvps (read): find one family's RSVP
// ---------------------------------------------------------------------------
const listInput = object({
  event_id: f.uuid("The event (its id, from events.upcoming)."),
  status: f.optional(f.enum("Only RSVPs with this status.", RSVP_STATUSES)),
  limit: f.withDefault(f.integer("The most RSVPs to return.", { min: 1, max: 25 }), 15),
});

export type RsvpListItem = {
  rsvp_id: string;
  status: string;
  /** People on the RSVP, counted (no names). */
  people: number;
  /** The household, as a card with its adults. Null for a guest RSVP. */
  household: HouseholdCard | null;
  /** A guest RSVP's booking name. */
  guest: string | null;
  source: string;
};
export type RsvpListData = { event: { id: string; name: string }; total: number; shown: number; rsvps: RsvpListItem[] };

/** The event's RSVPs, one household each, so an RSVP can be found and then changed. People on an RSVP are counted, never named. */
export const eventRsvps = defineCommand<Infer<typeof listInput>, RsvpListData>({
  key: "events.rsvps",
  title: "List an event's RSVPs",
  description:
    "List the RSVPs of one event, newest first: for each, its id, status, how many people are on it and the household as a card (adults, member number, city) so the family is never picked by name alone. " +
    "Guest RSVPs show the booking name. People on an RSVP are only counted. Filter by status; at most 25 are returned and 'total' says how many match. " +
    "Use the rsvp_id with events.set_rsvp_status.",
  level: "read",
  permission: "events",
  module: "events",
  input: listInput,
  async execute(ctx, { event_id, status, limit }) {
    const { db, center } = ctx.session;
    const event: { id: string; name: string } | null = must(await db.from("events").select("id, name").eq("id", event_id).eq("center_id", center.id).maybeSingle(), "read the event");
    if (!event) throw new CommandError(NOT_FOUND);
    let q = db.from("rsvps").select("id, household_id, guest_name, status, source", { count: "exact" }).eq("event_id", event_id).eq("center_id", center.id);
    if (status) q = q.eq("status", status);
    const res = await q.order("created_at", { ascending: false }).limit(limit);
    if (res.error) throw new CommandDbError(res.error, "read the RSVPs");
    const rows = (res.data ?? []) as RsvpRow[];
    const counts = new Map<string, number>();
    if (rows.length > 0) {
      const people = must(await db.from("attendees").select("rsvp_id, status").eq("event_id", event_id).in("rsvp_id", rows.map((r) => r.id)), "count the people on the RSVPs") ?? [];
      for (const p of people as { rsvp_id: string; status: string }[]) if (p.status !== "cancelled") counts.set(p.rsvp_id, (counts.get(p.rsvp_id) ?? 0) + 1);
    }
    const today = todayInTz(center.time_zone, ctx.now?.());
    const { cards } = await adultHouseholdCards(db, rows.map((r) => r.household_id).filter((x): x is string => Boolean(x)), { today, currency: center.currency });
    const byId = new Map(cards.map((c) => [c.household_id, c]));
    const rsvps = rows.map((r) => ({
      rsvp_id: r.id,
      status: r.status,
      people: counts.get(r.id) ?? 0,
      household: r.household_id ? (byId.get(r.household_id) ?? null) : null,
      guest: r.household_id ? null : r.guest_name,
      source: humanize(r.source),
    }));
    return {
      ok: true,
      data: { event, total: res.count ?? rows.length, shown: rsvps.length, rsvps },
      message: rsvps.length === 0 ? "No RSVPs match." : undefined,
    };
  },
});

// ---------------------------------------------------------------------------
// events.set_rsvp_status (confirm)
// ---------------------------------------------------------------------------
const DOING = "update the RSVP";
export const SET_RSVP_DENIED = "only event staff can change RSVPs.";

const setInput = object({
  event_id: f.uuid("The event (its id, from events.upcoming)."),
  rsvp_id: f.uuid("The RSVP to change (its id, from events.rsvps)."),
  status: f.enum("The new status: rsvpd (reopen), confirmed, cancelled, waitlisted or no_show.", RSVP_STATUSES),
});
export type SetRsvpInput = Infer<typeof setInput>;
export type SetRsvpData = { rsvp_id: string; status: RsvpStatus };

/** The sentence after a change, the words the Events screen has always used. */
export function rsvpChangedMessage(status: RsvpStatus): string {
  return `RSVP ${status === "rsvpd" ? "reopened" : status === "no_show" ? "marked no-show" : status}.`;
}

async function loadRsvp(ctx: CommandContext, event_id: string, rsvp_id: string) {
  const { db, center } = ctx.session;
  const rsvp: RsvpRow | null = must(
    await db.from("rsvps").select("id, household_id, guest_name, status, source").eq("id", rsvp_id).eq("event_id", event_id).eq("center_id", center.id).maybeSingle(),
    "read the RSVP",
  );
  if (!rsvp) throw new CommandError("That RSVP was not found on this event, or you can't see it.");
  return rsvp;
}

/** Change a family's RSVP by hand. Two steps in the database (the RSVP, then the people on it who have not arrived), done in one. */
export const setRsvpStatusCommand = defineCommand<SetRsvpInput, SetRsvpData>({
  key: "events.set_rsvp_status",
  title: "Change a family's RSVP",
  description:
    "Change the status of one RSVP: reopen it (rsvpd), confirm it, cancel it, put it on the waitlist or mark it a no-show. Find the rsvp_id with events.rsvps. " +
    "This asks the person to confirm first, showing the family as a household card. People who have already been checked in keep their status. Nothing is sent to the family.",
  level: "confirm",
  permission: "eventsManage",
  module: "events",
  // Off until the owner switches it on in the community's settings (assistant.tools.events.set_rsvp_status).
  enabledByDefault: false,
  covers: ["src/app/(app)/events/actions.ts#setRsvpStatus"],
  input: setInput,
  async preview(ctx, { event_id, rsvp_id, status }): Promise<CommandPreview> {
    const { db, center } = ctx.session;
    const rsvp = await loadRsvp(ctx, event_id, rsvp_id);
    const event: { name: string } | null = must(await db.from("events").select("name").eq("id", event_id).eq("center_id", center.id).maybeSingle(), "read the event");
    const people = (must(await db.from("attendees").select("id, checked_in_at").eq("rsvp_id", rsvp_id), "count the people on the RSVP") ?? []) as { id: string; checked_in_at: string | null }[];
    const arrived = people.filter((p) => p.checked_in_at).length;
    const today = todayInTz(center.time_zone, ctx.now?.());
    const { cards } = rsvp.household_id ? await adultHouseholdCards(db, [rsvp.household_id], { today, currency: center.currency }) : { cards: [] as HouseholdCard[] };
    const card = cards[0];
    const who = card ? `the ${card.primary_adult ?? "household"} household` : `the guest RSVP from ${rsvp.guest_name ?? "a guest"}`;
    const warnings: string[] = [];
    if (rsvp.status === status) warnings.push(`It is already ${WORDS[status]}, so nothing would change.`);
    if (status === "cancelled") warnings.push("The family is not told automatically.");
    if (arrived > 0) warnings.push(`${arrived === 1 ? "1 person on this RSVP has" : `${arrived} people on this RSVP have`} already been checked in and will keep their status.`);
    return {
      summary: `Mark ${who}'s RSVP for ${event?.name ?? "the event"} as ${WORDS[status]}.`,
      lines: [
        { label: "RSVP", before: WORDS[rsvp.status as RsvpStatus] ?? rsvp.status, after: WORDS[status] },
        { label: "People on it", value: String(people.length) },
      ],
      ...(card ? { households: [card] } : {}),
      warnings,
    };
  },
  confirmText: (_input, preview) => `Yes, ${preview.summary.charAt(0).toLowerCase()}${preview.summary.slice(1).replace(/\.$/, "")}`,
  async execute(ctx, { event_id, rsvp_id, status }) {
    await requireArea(ctx, (a) => eventAreas.rsvps(a, event_id), DOING, SET_RSVP_DENIED);
    const { db } = ctx.session;
    const changed = must(await db.rpc("event_set_rsvp_status", { p_event: event_id, p_rsvp: rsvp_id, p_status: status }), DOING);
    if (changed !== true) refuse(DOING, "you can't change this RSVP.");
    revalidateAfterCommand(["/events", "/ops"]);
    return { ok: true, data: { rsvp_id, status }, message: rsvpChangedMessage(status) };
  },
});
