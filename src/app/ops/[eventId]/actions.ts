"use server";

import { revalidatePath } from "next/cache";

import { eventActionContext } from "@/lib/data/events";
import { personName } from "@/lib/data/lookups";
import type { ActionResult } from "@/lib/errors";
import { eventAreas } from "@/lib/events/access";
import { FormError, must, runAction } from "@/lib/events/forms";
import { toE164 } from "@/lib/events/format";
import { can } from "@/lib/permissions";

export type WalkInPerson = { personId: string | null; name: string; child: boolean; senior: boolean; assistance: boolean };
export type WalkInLookup = {
  phone: string;
  existing: { rsvpId: string; label: string; status: string; token: string | null; people: string[] }[];
  households: { householdId: string; name: string; hasRsvp: boolean; members: WalkInPerson[] }[];
  /** False when the signed-in volunteer cannot search the member directory (no people.view). */
  canSearchMembers: boolean;
};

function ageOn(dob: string | null, today: string): number | null {
  if (!dob) return null;
  const [y, m, d] = dob.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age -= 1;
  return age;
}

/** Walk-in lookup by mobile number: existing RSVPs for this event, then member households. */
export async function findWalkIn(input: { eventId: string; phone: string }): Promise<ActionResult<WalkInLookup>> {
  return runAction<WalkInLookup>("ops.findWalkIn", "look up that number", async () => {
    const { db, access, centerId } = await eventActionContext((a) => eventAreas.checkIn(a, input.eventId), "you're not a check-in volunteer for this event.");
    const phone = toE164(input.phone);
    if (!phone) throw new FormError("enter a mobile number with area code, e.g. (713) 555-0198.");

    const rsvps =
      must(await db.from("rsvps").select("id, household_id, guest_name, status").eq("event_id", input.eventId).eq("guest_phone_e164", phone), "look up RSVPs for that number") ??
      [];

    const canSearchMembers = can(access, "people.view");
    const households: WalkInLookup["households"] = [];
    const householdRsvps = new Map<string, string>();
    if (canSearchMembers) {
      const people =
        must(await db.from("people").select("id").eq("center_id", centerId).eq("phone_e164", phone).is("merged_into_id", null), "look up members with that number") ?? [];
      if (people.length) {
        const links =
          must(await db.from("household_members").select("household_id").in("person_id", people.map((p) => p.id)).is("left_at", null), "find their households") ?? [];
        const hhIds = [...new Set(links.map((l) => l.household_id))];
        if (hhIds.length) {
          const [hhs, members, hhRsvps] = await Promise.all([
            db.from("households").select("id, display_name").in("id", hhIds),
            db.from("household_members").select("household_id, person_id, is_primary").in("household_id", hhIds).is("left_at", null),
            db.from("rsvps").select("id, household_id, status").eq("event_id", input.eventId).in("household_id", hhIds).neq("status", "cancelled"),
          ]);
          const m = must(members, "load household members") ?? [];
          for (const r of must(hhRsvps, "check household RSVPs") ?? []) if (r.household_id) householdRsvps.set(r.household_id, r.id);
          const peopleRows = m.length
            ? (must(
                await db.from("people").select("id, first_name, last_name, preferred_name, date_of_birth, is_deceased").in("id", m.map((x) => x.person_id)),
                "load family names",
              ) ?? [])
            : [];
          const today = new Date().toISOString().slice(0, 10);
          for (const h of must(hhs, "load households") ?? []) {
            households.push({
              householdId: h.id,
              name: h.display_name,
              hasRsvp: householdRsvps.has(h.id),
              members: m
                .filter((x) => x.household_id === h.id)
                .map((x) => peopleRows.find((p) => p.id === x.person_id))
                .filter((p): p is NonNullable<typeof p> => Boolean(p) && !p!.is_deceased)
                .map((p) => {
                  const age = ageOn(p.date_of_birth, today);
                  return { personId: p.id, name: personName(p), child: age !== null && age < 12, senior: age !== null && age >= 65, assistance: false };
                }),
            });
          }
        }
      }
    }

    // Existing RSVPs (guest phone match, or a matched household's RSVP) with a ticket to check in by.
    const rsvpIds = [...new Set([...rsvps.map((r) => r.id), ...householdRsvps.values()])];
    const attendees = rsvpIds.length
      ? (must(await db.from("attendees").select("rsvp_id, display_name, ticket_token, ticket_revoked").in("rsvp_id", rsvpIds), "load the party") ?? [])
      : [];
    const allRsvps = rsvpIds.length ? (must(await db.from("rsvps").select("id, household_id, guest_name, status").in("id", rsvpIds), "load RSVPs") ?? []) : [];
    const existing = allRsvps.map((r) => {
      const people = attendees.filter((a) => a.rsvp_id === r.id);
      const hh = households.find((h) => h.householdId === r.household_id);
      return {
        rsvpId: r.id,
        label: hh?.name ?? r.guest_name ?? (people[0] ? `${people[0].display_name}'s party` : "RSVP"),
        status: r.status,
        token: people.find((p) => p.ticket_token && !p.ticket_revoked)?.ticket_token ?? null,
        people: people.map((p) => p.display_name),
      };
    });

    return { ok: true, data: { phone, existing, households, canSearchMembers } };
  });
}

/** Create a walk-in RSVP (household or guest) with its people; returns a ticket token to check them in with. */
export async function registerWalkIn(input: {
  eventId: string;
  householdId: string | null;
  partyName: string;
  phone: string | null;
  people: WalkInPerson[];
}): Promise<ActionResult<{ token: string; attendeeIds: string[] }>> {
  return runAction<{ token: string; attendeeIds: string[] }>("ops.registerWalkIn", "register the walk-in", async () => {
    const { db, centerId } = await eventActionContext((a) => eventAreas.checkIn(a, input.eventId), "you're not a check-in volunteer for this event.");
    const people = input.people.map((p) => ({ ...p, name: p.name.trim() })).filter((p) => p.name);
    if (!people.length) throw new FormError("add at least one person.");
    const phone = input.phone ? toE164(input.phone) : null;
    if (input.phone && !phone) throw new FormError("that mobile number doesn't look right — include the area code.");
    const rsvp = must(
      await db
        .from("rsvps")
        .insert({
          center_id: centerId,
          event_id: input.eventId,
          household_id: input.householdId,
          guest_name: input.householdId ? null : input.partyName.trim() || people[0].name,
          guest_phone_e164: phone,
          status: "rsvpd",
          source: "walk_in",
        })
        .select("id")
        .single(),
      "register the walk-in",
    );
    const created =
      must(
        await db
          .from("attendees")
          .insert(
            people.map((p) => ({
              center_id: centerId,
              event_id: input.eventId,
              rsvp_id: rsvp!.id,
              person_id: p.personId,
              display_name: p.name,
              is_child_under_12: p.child,
              is_senior: p.senior,
              needs_assistance: p.assistance,
            })),
          )
          .select("id, ticket_token"),
        "add the people",
      ) ?? [];
    const token = created.find((a) => a.ticket_token)?.ticket_token;
    if (!token) throw new FormError("the walk-in was saved but no ticket was issued. Find them by phone again, or ask the event lead to check the RSVPs tab.");
    revalidatePath("/events", "layout");
    return { ok: true, message: "Walk-in registered.", data: { token, attendeeIds: created.map((a) => a.id) } };
  });
}
