import type { TablesInsert } from "@/lib/database.types";
import { prepareClone, type CloneSource, type PreparedEvent } from "@/lib/events/clone";
import { eventAreas } from "@/lib/events/access";
import { dateInTz } from "@/lib/dates";
import { formatDateTime } from "@/lib/events/format";
import { audienceLabel } from "@/lib/events/report";
import { formatCents } from "@/lib/money";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandError, type CommandContext, type CommandPreview } from "../../types";

import { must } from "../db";

import { refuse, requireArea } from "./kit";

type SourceRow = CloneSource & { id: string; status: string; event_number: string | null };

const SOURCE_COLUMNS =
  "id, status, event_number, name, description, venue, starts_at, ends_at, program_year, capacity, waitlist_enabled, audience, rsvp_opens_at, rsvp_closes_at, confirmation_hours_before, attendee_flags, commitment_options, lunch_enabled, lunch_starts_at, lunch_slot_minutes, lunch_seats_per_slot, lunch_priority_rules, is_paid, member_price_cents, guest_price_cents, owner_person_id, confidential";

export type CloneView = {
  source: { id: string; name: string; when: string };
  /** What the new event would look like, in words. */
  prepared: { name: string; starts: string; ends: string | null; venue: string | null; capacity: string; who_can_rsvp: string; rsvp_opens: string | null; rsvp_closes: string | null; lunch_starts: string | null; prices: string | null; status: "Draft" };
  copied: string[];
  left_out: string[];
  notes: string[];
  /** Other earlier events that matched, if more than one did. */
  alternatives: { id: string; name: string; when: string }[];
};

const draftInput = object({
  event_id: f.optional(f.uuid("The earlier event to copy (its id). Leave out to find it by name with 'find'.")),
  find: f.optional(f.string("Part of the earlier event's name, like 'Annual Gala'. The most recent earlier event that matches is used.", { min: 2, max: 100 })),
  new_date: f.date("The day of the new event, like 2026-11-08. Times of day stay as they were."),
  name: f.optional(f.string("The new event's name. Leave out to keep the old name with the year moved on.", { min: 2, max: 200 })),
});
type DraftInput = Infer<typeof draftInput>;

/** The earlier event to copy: the one named by id, or the most recent earlier match for a name. */
async function loadSource(ctx: CommandContext, { event_id, find, new_date }: Pick<DraftInput, "event_id" | "find" | "new_date">): Promise<{ source: SourceRow; others: SourceRow[] }> {
  const { db, center } = ctx.session;
  const tz = center.time_zone;
  if (event_id) {
    const row = must(await db.from("events").select(SOURCE_COLUMNS).eq("id", event_id).eq("center_id", center.id).maybeSingle(), "read the event") as SourceRow | null;
    if (!row) throw new CommandError("That event was not found, or you can't see it.");
    return { source: row, others: [] };
  }
  if (!find) throw new CommandError("Say which event to copy: give its id, or part of its name.");
  const words = find.replace(/[%_\\,()*]/g, " ").replace(/\s+/g, " ").trim();
  const rows = (must(
    await db.from("events").select(SOURCE_COLUMNS).eq("center_id", center.id).ilike("name", `%${words}%`).neq("status", "cancelled").neq("status", "draft").order("starts_at", { ascending: false }).limit(8),
    "look for the earlier event",
  ) ?? []) as SourceRow[];
  const matches = rows.filter((r) => r.starts_at && r.name.toLowerCase().includes(words.toLowerCase()) && dateInTz(r.starts_at, tz) < new_date);
  if (matches.length === 0) throw new CommandError(`No earlier event with "${words}" in its name was found before ${new_date}. Check the name, or give the event's id.`);
  return { source: matches[0], others: matches.slice(1, 4) };
}

function view(source: SourceRow, others: SourceRow[], prepared: PreparedEvent, plan: { copied: string[]; left_out: string[]; notes: string[] }, ctx: CommandContext): CloneView {
  const tz = ctx.session.center.time_zone;
  const currency = ctx.session.center.currency;
  const when = (iso: string | null) => (iso ? formatDateTime(iso, tz) : null);
  const prices = prepared.is_paid
    ? `Members ${prepared.member_price_cents === null ? "not set" : formatCents(prepared.member_price_cents, currency)}, guests ${prepared.guest_price_cents === null ? "not set" : formatCents(prepared.guest_price_cents, currency)}`
    : null;
  return {
    source: { id: source.id, name: source.name, when: when(source.starts_at) ?? "no date" },
    prepared: {
      name: prepared.name,
      starts: when(prepared.starts_at) ?? "",
      ends: when(prepared.ends_at),
      venue: prepared.venue,
      capacity: prepared.capacity === null ? "No limit" : String(prepared.capacity),
      who_can_rsvp: audienceLabel(prepared.audience),
      rsvp_opens: when(prepared.rsvp_opens_at),
      rsvp_closes: when(prepared.rsvp_closes_at),
      lunch_starts: prepared.lunch_enabled ? when(prepared.lunch_starts_at) : null,
      prices,
      status: "Draft",
    },
    copied: plan.copied,
    left_out: plan.left_out,
    notes: plan.notes,
    alternatives: others.map((o) => ({ id: o.id, name: o.name, when: when(o.starts_at) ?? "no date" })),
  };
}

async function planClone(ctx: CommandContext, inp: DraftInput) {
  const { source, others } = await loadSource(ctx, inp);
  const result = prepareClone(source, { newDay: inp.new_date, name: inp.name ?? null, tz: ctx.session.center.time_zone });
  if (!result.ok) throw new CommandError(result.error);
  return { source, others, result };
}

/** Prepare a copy of an earlier event as a draft: shown, never saved. */
export const draftCloneEvent = defineCommand<DraftInput, CloneView>({
  key: "events.clone_draft",
  title: "Prepare a copy of an earlier event",
  description:
    "Prepare a new event by copying an earlier one (last year's annual gala, say) onto a new day: the name with the year moved on, the description, venue, capacity, " +
    "who can RSVP, RSVP dates, reminder timing, lunch settings and prices, with the times of day kept. Give new_date, and either event_id or find (part of the name). " +
    "It shows what the new event would look like and what is not copied (RSVPs, volunteers, checklist, flyer, survey). It saves NOTHING: say it is a preparation. " +
    "To save it as a draft, use events.create_from_clone with the same source and date.",
  level: "draft",
  permission: "eventsManage",
  module: "events",
  input: draftInput,
  async execute(ctx, inp) {
    const { source, others, result } = await planClone(ctx, inp);
    return { ok: true, data: view(source, others, result.prepared, result, ctx), message: "This is only prepared. Nothing has been saved." };
  },
});

const createInput = object({
  source_event_id: f.uuid("The earlier event to copy (its id, from events.clone_draft)."),
  new_date: f.date("The day of the new event, like 2026-11-08."),
  name: f.optional(f.string("The new event's name. Leave out to keep the old name with the year moved on.", { min: 2, max: 200 })),
});
type CreateInput = Infer<typeof createInput>;

export type CreatedEvent = { id: string; name: string; builder_path: string; starts: string };

const toDraft = (i: CreateInput): DraftInput => ({ event_id: i.source_event_id, new_date: i.new_date, name: i.name });

/** Save the prepared copy as a draft event. Nothing is published, nobody is told. */
export const createFromClone = defineCommand<CreateInput, CreatedEvent>({
  key: "events.create_from_clone",
  title: "Create a draft event from an earlier one",
  description:
    "Save a copy of an earlier event as a new DRAFT on a new day, as prepared by events.clone_draft. It asks the person to confirm first. " +
    "A draft is not visible to members and nothing is sent; the person finishes and publishes it in the event builder. " +
    "RSVPs, volunteers, the checklist, the flyer and the survey are not copied.",
  level: "confirm",
  permission: "eventsManage",
  module: "events",
  enabledByDefault: false,
  input: createInput,
  async preview(ctx, inp): Promise<CommandPreview> {
    const { source, others, result } = await planClone(ctx, toDraft(inp));
    const v = view(source, others, result.prepared, result, ctx);
    return {
      summary: `Create a draft called ${v.prepared.name} on ${v.prepared.starts}, copied from ${source.name}.`,
      lines: [
        { label: "Starts", value: v.prepared.starts },
        ...(v.prepared.ends ? [{ label: "Ends", value: v.prepared.ends }] : []),
        { label: "Venue", value: v.prepared.venue ?? "Not set" },
        { label: "Capacity", value: v.prepared.capacity },
        { label: "Who can RSVP", value: v.prepared.who_can_rsvp },
        ...(v.prepared.prices ? [{ label: "Prices", value: v.prepared.prices }] : []),
        { label: "Not copied", value: v.left_out.join(", ") },
      ],
      warnings: ["It is saved as a draft: members cannot see it and nothing is sent. You publish it in the event builder.", ...v.notes],
    };
  },
  confirmText: "Yes, create the draft",
  async execute(ctx, inp) {
    const doing = "create the draft event";
    await requireArea(ctx, (a) => eventAreas.manage(a), doing, "only event managers can create events.");
    const { result } = await planClone(ctx, toDraft(inp));
    const { db, center, userId } = ctx.session;
    const row = { ...result.prepared, center_id: center.id, created_by: userId } as unknown as TablesInsert<"events">;
    const created: { id: string } | null = must(await db.from("events").insert(row).select("id").single(), doing);
    if (!created) refuse(doing, "the database did not give the new event back.");
    revalidateAfterCommand(["/events", "/ops"]);
    const path = `/events/builder?event=${created.id}`;
    return {
      ok: true,
      data: { id: created.id, name: result.prepared.name, builder_path: path, starts: formatDateTime(result.prepared.starts_at, center.time_zone) },
      message: `Created the draft ${result.prepared.name}. Open ${path} to finish it and publish it.`,
    };
  },
});
