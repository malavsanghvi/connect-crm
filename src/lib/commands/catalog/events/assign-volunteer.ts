import { ageOn, todayInTz } from "@/lib/dates";
import { eventAreas } from "@/lib/events/access";
import { formatDateTime, humanize } from "@/lib/events/format";

import { isAdultMember } from "../../child-filter";
import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandError, type CommandContext, type CommandPreview, type HouseholdCard } from "../../types";

import { must } from "../db";
import { adultHouseholdCards } from "../household";

import { UUID_RE, refuse, requireArea } from "./kit";

const DOING = "assign the volunteer";
export const ASSIGN_DENIED = "only this event's lead or the volunteer coordinator can assign volunteers.";
const MOST_PEOPLE = 50;

const input = object({
  event_id: f.uuid("The event (its id, from events.upcoming)."),
  shift_id: f.uuid("The shift to put them on (its id, from events.summary or the Volunteers tab)."),
  person_ids: f.string(`The person to assign (their id, from people.search): one id, or up to ${MOST_PEOPLE} separated by commas. Adults only.`, { min: 1, max: 2000 }),
});
export type AssignInput = Infer<typeof input>;
export type AssignData = { shift_id: string; assigned: number };

/** "id1, id2" as a list of ids; the problem as a sentence when one is not an id. */
export function parsePersonIds(text: string): { ok: true; ids: string[] } | { ok: false; error: string } {
  const ids = [...new Set(text.split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
  if (ids.length === 0) return { ok: false, error: "choose who to assign." };
  if (ids.length > MOST_PEOPLE) return { ok: false, error: `assign at most ${MOST_PEOPLE} people at a time.` };
  if (ids.some((id) => !UUID_RE.test(id))) return { ok: false, error: "one of the people is not a valid id. Find them with a search first." };
  return { ok: true, ids };
}

type PersonRow = { id: string; first_name: string; last_name: string; preferred_name: string | null; date_of_birth: string | null };
type ShiftRow = { id: string; event_id: string; station: string; starts_at: string | null; ends_at: string | null; capacity: number | null };

async function loadShift(ctx: CommandContext, event_id: string, shift_id: string): Promise<ShiftRow> {
  const { db, center } = ctx.session;
  const shift: ShiftRow | null = must(
    await db.from("volunteer_shifts").select("id, event_id, station, starts_at, ends_at, capacity").eq("id", shift_id).eq("event_id", event_id).eq("center_id", center.id).maybeSingle(),
    "read the shift",
  );
  if (!shift) throw new CommandError("That shift was not found on this event, or you can't see it.");
  return shift;
}

/**
 * The people, with a card for each household. Niva (D2) works with adults only: someone under 18 is refused before anything is shown,
 * and one whose age cannot be told is treated as under 18. A screen or the palette is the person's own hands and is not limited.
 */
async function loadPeople(ctx: CommandContext, ids: string[]): Promise<{ people: PersonRow[]; cards: HouseholdCard[] }> {
  const { db, center } = ctx.session;
  const today = todayInTz(center.time_zone, ctx.now?.());
  const people = (must(await db.from("people").select("id, first_name, last_name, preferred_name, date_of_birth").in("id", ids).eq("center_id", center.id), "read the people") ?? []) as PersonRow[];
  if (people.length !== ids.length) throw new CommandError("One of those people was not found, or you can't see them.");
  const members = (must(await db.from("household_members").select("household_id, person_id, role").in("person_id", ids).is("left_at", null), "read the people's households") ?? []) as { household_id: string; person_id: string; role: string }[];
  if (ctx.via === "assistant") {
    for (const p of people) {
      const role = members.find((m) => m.person_id === p.id)?.role ?? null;
      const known = ageOn(p.date_of_birth, today) !== null || role !== null;
      if (!known || !isAdultMember({ date_of_birth: p.date_of_birth, role }, today)) {
        throw new CommandError("Niva does not work with anyone under 18. Assign young volunteers on the Volunteers screen.");
      }
    }
  }
  const { cards } = await adultHouseholdCards(db, [...new Set(members.map((m) => m.household_id))], { today, currency: center.currency });
  return { people, cards };
}

const nameOf = (p: PersonRow) => `${(p.preferred_name ?? "").trim() || p.first_name} ${p.last_name}`.trim();

/** Put one or more adults on a volunteer shift. One insert: either everyone is assigned or nobody is. */
export const assignVolunteerCommand = defineCommand<AssignInput, AssignData>({
  key: "events.assign_volunteer",
  title: "Assign a volunteer to a shift",
  description:
    "Put a person on one of an event's volunteer shifts. Find the person with people.search (use their person id) and the shift from events.summary or the Volunteers tab. " +
    "This asks the person to confirm first, showing the shift, how many spots are filled and the volunteer's household card. Adults only: Niva does not assign anyone under 18. Nothing is sent to the volunteer.",
  level: "confirm",
  permission: "eventsManage",
  module: "events",
  // Off until the owner switches it on in the community's settings (assistant.tools.events.assign_volunteer).
  enabledByDefault: false,
  input,
  async preview(ctx, { event_id, shift_id, person_ids }): Promise<CommandPreview> {
    const parsed = parsePersonIds(person_ids);
    if (!parsed.ok) refuse(DOING, parsed.error);
    const { db, center } = ctx.session;
    const tz = center.time_zone;
    const shift = await loadShift(ctx, event_id, shift_id);
    const event: { name: string } | null = must(await db.from("events").select("name").eq("id", event_id).eq("center_id", center.id).maybeSingle(), "read the event");
    const { people, cards } = await loadPeople(ctx, parsed.ids);
    const active = must(await db.from("volunteer_assignments").select("person_id, status").eq("shift_id", shift_id).in("status", ["assigned", "confirmed", "completed"]), "count who is on the shift") ?? [];
    const taken = new Set((active as { person_id: string }[]).map((a) => a.person_id));
    const already = people.filter((p) => taken.has(p.id));
    const station = humanize(shift.station);
    const spots = (n: number) => (shift.capacity === null ? `${n} assigned` : `${n} of ${shift.capacity}`);
    const warnings: string[] = [];
    for (const p of already) warnings.push(`${nameOf(p)} is already on this shift.`);
    if (shift.capacity !== null && active.length + people.length - already.length > shift.capacity) warnings.push("This shift already has all the volunteers it needs.");
    return {
      summary: `Assign ${people.map(nameOf).join(" and ")} to the ${station.toLowerCase()} shift at ${event?.name ?? "the event"}.`,
      lines: [
        { label: "Shift", value: `${station}${shift.starts_at ? `, ${formatDateTime(shift.starts_at, tz)}` : ""}` },
        { label: "Spots filled", before: spots(active.length), after: spots(active.length + people.length - already.length) },
      ],
      households: cards,
      warnings,
    };
  },
  confirmText: (_input, preview) => `Yes, ${preview.summary.charAt(0).toLowerCase()}${preview.summary.slice(1).replace(/\.$/, "")}`,
  async execute(ctx, { event_id, shift_id, person_ids }) {
    await requireArea(ctx, (a) => eventAreas.volunteers(a, event_id), DOING, ASSIGN_DENIED);
    const parsed = parsePersonIds(person_ids);
    if (!parsed.ok) refuse(DOING, parsed.error);
    const { db, center } = ctx.session;
    await loadShift(ctx, event_id, shift_id);
    // Who they are is only looked up when it matters: Niva checks they are adults. A screen passes ids it has just searched for.
    if (ctx.via === "assistant") await loadPeople(ctx, parsed.ids);
    must(await db.from("volunteer_assignments").insert(parsed.ids.map((person_id) => ({ center_id: center.id, shift_id, person_id }))), DOING);
    revalidateAfterCommand(["/events", "/ops"]);
    return { ok: true, data: { shift_id, assigned: parsed.ids.length }, message: parsed.ids.length === 1 ? "Volunteer assigned." : `${parsed.ids.length} volunteers assigned.` };
  },
});
