import type { TablesUpdate } from "@/lib/database.types";
import { EVENT_FIELDS, EVENT_FIELD_INFO, describeEventField, eventFieldConflict, parseEventField, type EventField, type FieldValue } from "@/lib/events/field-patch";

import { defineCommand } from "../define";
import { revalidateAfterCommand } from "../revalidate";
import { f, object, type Infer } from "../schema";
import { CommandError, type CommandContext, type CommandPreview } from "../types";

import { must } from "./db";

export type EventChange = {
  event: { id: string; name: string };
  field: EventField;
  label: string;
  before: string;
  after: string;
  changed: boolean;
};

/** What each field takes, for the model: "venue (the new venue; empty clears it); starts_at (date and time like …)". */
const FIELD_HELP = EVENT_FIELDS.map((k) => `${k}: ${EVENT_FIELD_INFO[k].hint}`).join("; ");

const input = object({
  event_id: f.uuid("The event to change (its id, from events.upcoming)."),
  field: f.enum("Which detail of the event to change.", EVENT_FIELDS),
  value: f.string(`The new value, as text. ${FIELD_HELP}.`, { min: 0, max: 4000 }),
});
type ChangeInput = Infer<typeof input>;

type EventRow = {
  id: string;
  name: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  venue: string | null;
  description: string | null;
  capacity: number | null;
  rsvp_opens_at: string | null;
  rsvp_closes_at: string | null;
  confirmation_hours_before: number;
  waitlist_enabled: boolean;
};

/** Read the event and work out what the change would be, applying every rule the builder applies. Throws CommandError for a problem to show. */
async function planChange(ctx: CommandContext, { event_id, field, value }: ChangeInput): Promise<EventChange & { column: EventField; next: FieldValue }> {
  const { db, center } = ctx.session;
  const tz = center.time_zone;
  const row: EventRow | null = must(
    await db
      .from("events")
      .select("id, name, status, starts_at, ends_at, venue, description, capacity, rsvp_opens_at, rsvp_closes_at, confirmation_hours_before, waitlist_enabled")
      .eq("id", event_id)
      .eq("center_id", center.id)
      .maybeSingle(),
    "read the event",
  );
  if (!row) throw new CommandError("That event was not found, or you can't see it.");
  if (row.status === "completed" || row.status === "cancelled") {
    throw new CommandError(`${row.name} is ${row.status}, so Niva will not change it. If it really needs fixing, do it on the Events screen.`);
  }
  const parsed = parseEventField(field, value, tz);
  if (!parsed.ok) throw new CommandError(parsed.error);
  const conflict = eventFieldConflict(field, parsed.value, row);
  if (conflict) throw new CommandError(conflict);
  const current = row[field] as FieldValue;
  const sameMoment = EVENT_FIELD_INFO[field].kind === "datetime" && current !== null && parsed.value !== null && Date.parse(String(current)) === Date.parse(String(parsed.value));
  const changed = !(sameMoment || current === parsed.value);
  return {
    event: { id: row.id, name: row.name },
    field,
    column: field,
    label: EVENT_FIELD_INFO[field].label,
    before: describeEventField(field, current, tz),
    after: describeEventField(field, parsed.value, tz),
    changed,
    next: parsed.value,
  };
}

function view({ event, field, label, before, after, changed }: EventChange): EventChange {
  return { event, field, label, before, after, changed };
}

/** What members would notice, said before anything changes. */
function memberNotice(field: EventField): string | null {
  switch (field) {
    case "starts_at":
    case "ends_at":
    case "venue":
    case "name":
      return "Families who already RSVP'd will see the new detail in the app. Nothing is sent to them automatically.";
    case "capacity":
      return "Lowering the capacity does not remove anyone who has already RSVP'd.";
    default:
      return null;
  }
}

export const draftEventChange = defineCommand<ChangeInput, EventChange>({
  key: "events.draft_change",
  title: "Draft a change to an event",
  description:
    "Show what changing one detail of an event would look like, before and after, without changing anything. " +
    "Use it to check a change with the person, then use events.set_field to ask them to confirm it. " +
    `Details you can change: ${EVENT_FIELDS.join(", ")}. Prices, status, who can RSVP and who owns the event are not changed this way. ` +
    "A completed or cancelled event cannot be changed here.",
  level: "draft",
  permission: "eventsManage",
  module: "events",
  input,
  async execute(ctx, inp) {
    const plan = await planChange(ctx, inp);
    return {
      ok: true,
      data: view(plan),
      message: plan.changed ? "Nothing has been changed yet." : `${plan.event.name} already has that ${plan.label.toLowerCase()}.`,
    };
  },
});

export const setEventField = defineCommand<ChangeInput, EventChange>({
  key: "events.set_field",
  title: "Change a detail of an event",
  description:
    "Change one detail of an event. This asks the person to confirm first, showing the before and after, and nothing changes until they do. " +
    `Details you can change: ${EVENT_FIELDS.join(", ")}. Prices, status, who can RSVP and who owns the event are not changed this way. ` +
    "A completed or cancelled event cannot be changed here. Use events.draft_change first if you want to talk it through.",
  level: "confirm",
  permission: "eventsManage",
  module: "events",
  // Off until the owner switches it on in the community's settings (assistant.tools.events.set_field).
  enabledByDefault: false,
  input,
  async preview(ctx, inp): Promise<CommandPreview> {
    const plan = await planChange(ctx, inp);
    const notice = memberNotice(plan.field);
    return {
      summary: `Change the ${plan.label.toLowerCase()} of ${plan.event.name}.`,
      lines: [{ label: plan.label, before: plan.before, after: plan.after }],
      warnings: [...(plan.changed ? [] : ["It already has this value, so nothing would change."]), ...(notice ? [notice] : [])],
    };
  },
  confirmText: (_input, preview) => `Yes, ${preview.summary.charAt(0).toLowerCase()}${preview.summary.slice(1).replace(/\.$/, "")}`,
  async execute(ctx, inp) {
    // Everything is read and checked again now: the event may have changed since it was proposed.
    const plan = await planChange(ctx, inp);
    if (!plan.changed) return { ok: true, data: view(plan), message: `${plan.event.name} already had that ${plan.label.toLowerCase()}, so nothing changed.` };
    const { db, center } = ctx.session;
    const patch = { [plan.column]: plan.next } as TablesUpdate<"events">;
    const res = must(await db.from("events").update(patch).eq("id", plan.event.id).eq("center_id", center.id).select("id"), "change the event");
    if (!res?.length) throw new CommandError("You can't change this event, or it no longer exists.");
    revalidateAfterCommand(["/events", "/ops"]);
    return { ok: true, data: view(plan), message: `Changed the ${plan.label.toLowerCase()} of ${plan.event.name} from ${plan.before} to ${plan.after}.` };
  },
});
