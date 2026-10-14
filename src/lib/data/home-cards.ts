import "server-only";

import { cache } from "react";

import { communityFormat } from "@/lib/community-format";
import { explainError } from "@/lib/errors";
import { buildAssignments, eventsToCount, scopedAssignments, type AssignmentFacts, type AssignmentsCard, type ClassFact, type EventFact, type EventNumbers, type ZoneFact } from "@/lib/home/assignments";
import type { HomeCards } from "@/lib/home/cards";
import {
  buildMemberWork,
  holdsNoStaffWork,
  memberReads,
  summarizeEvents,
  summarizePledges,
  type EventsSummary,
  type MemberWorkData,
  type OpenPledges,
} from "@/lib/home/member-work";
import { readFailed, readOk, type Read } from "@/lib/home/read";
import type { CrmSession } from "@/lib/session";

// The two cards Home shows a person whose work is not in a staff queue (docs/DEMO_ROLE_WORK.md):
//   "Your work is in the member app": counts read the way the member app reads them (connect-mobile: i_am_adult,
//     my_membership_application, my_reference_requests, the household's open pledges and RSVPs, the notices);
//   "My assignments": the events, classes and zones the person holds a role for through a scoped grant.
// Every read runs as the signed-in person, so row level security decides what comes back. A read that fails becomes a line on the
// card that says so (with a retry), never a zero. The rules that turn the reads into sentences and links are in src/lib/home/.

/** Run one read: its value, or why it failed (the technical detail is logged here, the plain reason goes on the card). */
async function attempt<T>(context: string, run: () => Promise<T>): Promise<Read<T>> {
  try {
    return readOk(await run());
  } catch (error) {
    console.error(`[home-cards] could not ${context}:`, error);
    return readFailed(explainError(error));
  }
}

/** A PostgREST answer's rows, or the error thrown for `attempt` to report. */
function rowsOf<T>(res: { data: T[] | null; error: unknown }): T[] {
  if (res.error) throw res.error;
  return res.data ?? [];
}

// ---------------------------------------------------------------------------
// Your work is in the member app
// ---------------------------------------------------------------------------

/** Upcoming events the community shows its members: published, RSVPs closed or live, not yet over (the member app's own window). */
const UPCOMING_STATUSES = ["published", "rsvp_closed", "live"];

export const loadMemberWork = cache(async (session: CrmSession): Promise<MemberWorkData> => {
  const { db, center, person } = session;
  if (!person) return { linked: false, adult: readOk(false), application: null, vouch: null, pledges: null, events: null, notices: null };

  // Money, RSVPs and a membership application are for adults; ask the database's own rule (app.i_am_adult, the one RLS uses).
  const adult = await attempt("check whether the signed-in person is an adult", async () => {
    const res = await db.rpc("i_am_adult", { p_center: center.id });
    if (res.error) throw res.error;
    if (typeof res.data !== "boolean") throw new Error("the database gave no answer");
    return res.data;
  });
  const reads = memberReads(adult.ok ? adult.value : null, session);

  // The household the member app works with: the one the person is primary in, else the first.
  const household =
    reads.pledges || reads.rsvps
      ? await attempt("find the signed-in person's household", async () => {
          const members = rowsOf(await db.from("household_members").select("household_id, is_primary").eq("person_id", person.id).eq("center_id", center.id).is("left_at", null));
          return [...members].sort((a, b) => Number(b.is_primary) - Number(a.is_primary))[0]?.household_id ?? null;
        })
      : null;

  const pledges: Promise<Read<OpenPledges>> | null = reads.pledges
    ? household && !household.ok
      ? Promise.resolve(readFailed(household.error))
      : attempt("read the household's open pledges", async () => {
          const householdId = household?.ok ? household.value : null;
          if (!householdId) return summarizePledges([]);
          return summarizePledges(rowsOf(await db.from("pledges").select("amount_cents, paid_cents").eq("household_id", householdId).in("status", ["open", "partially_paid"])));
        })
    : null;

  const events: Promise<Read<EventsSummary>> | null = reads.events
    ? reads.rsvps && household && !household.ok
      ? Promise.resolve(readFailed(household.error))
      : attempt("read the upcoming events and the household's RSVPs", async () => {
          const now = new Date();
          const since = new Date(now.getTime() - 12 * 3_600_000).toISOString();
          const upcoming = rowsOf(
            await db
              .from("events")
              .select("id, status")
              .eq("center_id", center.id)
              .in("status", UPCOMING_STATUSES)
              .or(`starts_at.gte."${since}",ends_at.gte."${now.toISOString()}"`)
              .order("starts_at", { ascending: true })
              .limit(60),
          );
          const householdId = reads.rsvps && household?.ok ? household.value : null;
          const rsvps = householdId && upcoming.length > 0 ? rowsOf(await db.from("rsvps").select("event_id, status").eq("household_id", householdId).in("event_id", upcoming.map((e) => e.id))) : [];
          // RSVPs are for adults: a child (or a person whose age could not be checked) is told how many events there are, nothing about RSVPs.
          return reads.rsvps ? summarizeEvents(upcoming, rsvps) : { upcoming: upcoming.length, going: 0, open: 0 };
        })
    : null;

  const notices: Promise<Read<number>> | null = reads.notices
    ? attempt("count the community's notices", async () => {
        const now = new Date().toISOString();
        const res = await db
          .from("alerts")
          .select("id", { count: "exact", head: true })
          .eq("center_id", center.id)
          .lte("starts_at", now)
          .or(`ends_at.is.null,ends_at.gt."${now}"`);
        if (res.error) throw res.error;
        return res.count ?? 0;
      })
    : null;

  const application: Promise<Read<{ status: string } | null>> | null = reads.application
    ? attempt("read the household's membership application", async () => {
        const res = await db.rpc("my_membership_application", { p_center: center.id });
        const row = rowsOf(res)[0];
        return row ? { status: String(row.status) } : null;
      })
    : null;

  const vouch: Promise<Read<number>> | null = reads.vouch
    ? attempt("read the requests to vouch for an applicant", async () => rowsOf(await db.rpc("my_reference_requests")).length)
    : null;

  return {
    linked: true,
    adult,
    application: application ? await application : null,
    vouch: vouch ? await vouch : null,
    pledges: pledges ? await pledges : null,
    events: events ? await events : null,
    notices: notices ? await notices : null,
  };
});

// ---------------------------------------------------------------------------
// My assignments
// ---------------------------------------------------------------------------

export const loadAssignments = cache(async (session: CrmSession): Promise<AssignmentsCard | null> => {
  const { db, center } = session;
  const assignments = scopedAssignments(session.grants, session);
  if (assignments.length === 0) return null;
  const idsOf = (kind: "event" | "class" | "zone") => assignments.filter((a) => a.kind === kind).map((a) => a.scopeId);
  const eventIds = idsOf("event");
  const classIds = idsOf("class");
  const zoneIds = idsOf("zone");

  const [events, classes, zones] = await Promise.all([
    eventIds.length
      ? attempt("read the events the person holds a role for", async () => {
          const rows = rowsOf(await db.from("events").select("id, name, status, starts_at, ends_at, venue").in("id", eventIds));
          return new Map<string, EventFact>(rows.map((r) => [r.id, { name: r.name, status: r.status, starts_at: r.starts_at, ends_at: r.ends_at, venue: r.venue }]));
        })
      : null,
    classIds.length
      ? attempt("read the classes the person holds a role for", async () => {
          const rows = rowsOf(await db.from("pathshala_classes").select("id, name, meets_on, starts_time, room").in("id", classIds));
          return new Map<string, ClassFact>(rows.map((r) => [r.id, { name: r.name, meets_on: r.meets_on, starts_time: r.starts_time, room: r.room }]));
        })
      : null,
    zoneIds.length
      ? attempt("read the zones the person holds a role for", async () => {
          const rows = rowsOf(await db.from("zones").select("id, name").in("id", zoneIds));
          return new Map<string, ZoneFact>(rows.map((r) => [r.id, { name: r.name }]));
        })
      : null,
  ]);

  // Live numbers, only for the events this person may count (the database refuses the rest) and only while they matter.
  const numbers = new Map<string, Read<EventNumbers>>();
  const toCount = events?.ok ? eventsToCount(session, assignments, events.value) : [];
  await Promise.all(
    toCount.map(async (id) => {
      numbers.set(
        id,
        await attempt("count the people at an event", async () => {
          const row = rowsOf(await db.rpc("event_live_stats", { p_event: id }))[0];
          if (!row) throw new Error("the database gave no numbers for this event");
          return { rsvpPeople: row.rsvp_people, confirmed: row.confirmed, checkedIn: row.checked_in };
        }),
      );
    }),
  );

  // Open conversations in each zone's inbox: the same read the inbox page makes, so only what this person may handle is counted.
  const zoneOpen: Read<ReadonlyMap<string, number>> | null = zoneIds.length
    ? await attempt("count the open conversations in the zone inboxes", async () => {
        const inboxes = rowsOf(await db.from("inboxes").select("id, zone_id").eq("center_id", center.id).in("zone_id", zoneIds));
        const zoneOf = new Map(inboxes.flatMap((i) => (i.zone_id ? [[i.id, i.zone_id] as const] : [])));
        const out = new Map<string, number>();
        for (const z of new Set(zoneOf.values())) out.set(z, 0);
        if (zoneOf.size === 0) return out;
        const threads = rowsOf(await db.from("threads").select("inbox_id").eq("center_id", center.id).in("inbox_id", [...zoneOf.keys()]).neq("status", "closed").limit(1000));
        for (const t of threads) {
          const z = zoneOf.get(t.inbox_id);
          if (z) out.set(z, (out.get(z) ?? 0) + 1);
        }
        return out;
      })
    : null;

  const facts: AssignmentFacts = { events, classes, zones, numbers, zoneOpen };
  return buildAssignments(session, assignments, facts, {
    timeZone: center.time_zone,
    roleNames: new Map(session.roles.map((r) => [r.key, r.name])),
  });
});

// ---------------------------------------------------------------------------
// Both, for Home and Today
// ---------------------------------------------------------------------------

/**
 * What Home shows besides My tasks. The member-app card is for a person who holds no staff queue and no module screen; My
 * assignments is for anyone who holds a role for one event, class or zone, staff included. Cached per request.
 */
export const loadHomeCards = cache(async (session: CrmSession): Promise<HomeCards> => {
  const fmt = communityFormat(session.center);
  const [memberWork, assignments] = await Promise.all([
    holdsNoStaffWork(session)
      ? loadMemberWork(session).then((data) => buildMemberWork(data, { currency: fmt.currency, locale: fmt.locale, memberAppUrl: process.env.NEXT_PUBLIC_MEMBER_APP_URL }))
      : Promise.resolve(null),
    loadAssignments(session),
  ]);
  return { memberWork, assignments };
});
