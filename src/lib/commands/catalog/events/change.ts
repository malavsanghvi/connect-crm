import type { TablesUpdate } from "@/lib/database.types";
import { EVENT_FIELDS, EVENT_FIELD_INFO, planEventFieldChange, type EventField, type EventFieldRow } from "@/lib/events/field-patch";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandError, type CommandContext, type CommandPreview } from "../../types";

import { must } from "../db";

export type EventChange = {
  event: { id: string; name: string };
  field: EventField;
  label: string;
  before: string;
  after: string;
  changed: boolean;
  /** Things to know that do not stop the change. */
  warnings: string[];
};

/** What each field takes, for the model: "venue (the new venue; empty clears it); starts_at (date and time like …)". */
const FIELD_HELP = EVENT_FIELDS.map((k) => `${k}: ${EVENT_FIELD_INFO[k].hint}`).join("; ");

const input = object({
  event_id: f.uuid("The event to change (its id, from events.upcoming)."),
  field: f.enum("Which detail of the event to change.", EVENT_FIELDS),
  value: f.string(`The new value, as text. ${FIELD_HELP}.`, { min: 0, max: 4000 }),
});
type ChangeInput = Infer<typeof input>;

type EventRow = EventFieldRow & { id: string; status: string };

/** Read the event and work out what the change would be, applying every rule the builder applies. Throws CommandError for a problem to show. */
async function planChange(ctx: CommandContext, { event_id, field, value }: ChangeInput) {
  const { db, center } = ctx.session;
  const tz = center.time_zone;
  const row: EventRow | null = must(
    await db
      .from("events")
      .select("id, name, status, starts_at, ends_at, venue, description, capacity, audience, rsvp_opens_at, rsvp_closes_at, confirmation_hours_before, waitlist_enabled, lunch_starts_at")
      .eq("id", event_id)
      .eq("center_id", center.id)
      .maybeSingle(),
    "read the event",
  );
  if (!row) throw new CommandError("That event was not found, or you can't see it.");
  if (row.status === "completed" || row.status === "cancelled") {
    throw new CommandError(`${row.name} is ${row.status}, so Niva will not change it. If it really needs fixing, do it on the Events screen.`);
  }
  const plan = planEventFieldChange(field, value, row, tz, ctx.now?.());
  if (!plan.ok) throw new CommandError(plan.error);
  return { event: { id: row.id, name: row.name }, field, plan };
}

type Planned = Awaited<ReturnType<typeof planChange>>;

function view({ event, field, plan }: Planned): EventChange {
  return { event, field, label: plan.label, before: plan.before, after: plan.after, changed: plan.changed, warnings: plan.warnings };
}

/** What members would notice, said before anything changes. */
function memberNotice(field: EventField): string | null {
  switch (field) {
    case "starts_at":
    case "ends_at":
    case "date":
    case "start_time":
    case "end_time":
    case "venue":
    case "name":
      return "Families who already RSVP'd will see the new detail in the app. Nothing is sent to them automatically.";
    case "capacity":
      return "Lowering the capacity does not remove anyone who has already RSVP'd.";
    case "audience":
      return "This changes who can see the event and RSVP in the app. Families who already RSVP'd keep their RSVP. Nothing is sent to anyone automatically.";
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
    `Details you can change: ${EVENT_FIELDS.join(", ")}. Use date to move the event to another day (its times of day stay), start_time or end_time for a time on the same day, ` +
    "and audience for who can RSVP. Prices, status and who owns the event are not changed this way. " +
    "A completed or cancelled event cannot be changed here.",
  level: "draft",
  permission: "eventsManage",
  module: "events",
  input,
  async execute(ctx, inp) {
    const planned = await planChange(ctx, inp);
    const data = view(planned);
    return {
      ok: true,
      data,
      message: data.changed ? "Nothing has been changed yet." : `${data.event.name} already has that ${data.label.toLowerCase()}.`,
    };
  },
});

export const setEventField = defineCommand<ChangeInput, EventChange>({
  key: "events.set_field",
  title: "Change a detail of an event",
  description:
    "Change one detail of an event. This asks the person to confirm first, showing the before and after, and nothing changes until they do. " +
    `Details you can change: ${EVENT_FIELDS.join(", ")}. Use date to move the event to another day (its times of day stay), start_time or end_time for a time on the same day, ` +
    "and audience for who can RSVP. Prices, status and who owns the event are not changed this way. " +
    "A completed or cancelled event cannot be changed here. Use events.draft_change first if you want to talk it through.",
  level: "confirm",
  permission: "eventsManage",
  module: "events",
  // Off until the owner switches it on in the community's settings (assistant.tools.events.set_field).
  enabledByDefault: false,
  input,
  async preview(ctx, inp): Promise<CommandPreview> {
    const planned = await planChange(ctx, inp);
    const data = view(planned);
    const notice = memberNotice(data.field);
    return {
      summary: `Change the ${data.label.toLowerCase()} of ${data.event.name}.`,
      lines: [{ label: data.label, before: data.before, after: data.after }],
      warnings: [...(data.changed ? [] : ["It already has this value, so nothing would change."]), ...data.warnings, ...(notice ? [notice] : [])],
    };
  },
  confirmText: (_input, preview) => `Yes, ${preview.summary.charAt(0).toLowerCase()}${preview.summary.slice(1).replace(/\.$/, "")}`,
  async execute(ctx, inp) {
    // Everything is read and checked again now: the event may have changed since it was proposed.
    const planned = await planChange(ctx, inp);
    const data = view(planned);
    if (!data.changed) return { ok: true, data, message: `${data.event.name} already had that ${data.label.toLowerCase()}, so nothing changed.` };
    const { db, center } = ctx.session;
    // The patch holds the one or more columns this detail writes ("date" moves the start, the end and the lunch start together).
    const patch = planned.plan.patch as TablesUpdate<"events">;
    const res = must(await db.from("events").update(patch).eq("id", data.event.id).eq("center_id", center.id).select("id"), "change the event");
    if (!res?.length) throw new CommandError("You can't change this event, or it no longer exists.");
    revalidateAfterCommand(["/events", "/ops"]);
    return { ok: true, data, message: `Changed the ${data.label.toLowerCase()} of ${data.event.name} from ${data.before} to ${data.after}.` };
  },
});
