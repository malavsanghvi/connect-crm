import type { Metadata } from "next";
import Link from "next/link";

import { LoadProblem } from "@/components/events/load-problem";
import { Alert, NoAccess, PageHeader, buttonClass } from "@/components/ui";
import { load, loadEventAccess, resolvePeopleNames, row } from "@/lib/data/events";
import { eventAreas } from "@/lib/events/access";
import { centsToDollarsInput, formatEventDate, toDateTimeLocal } from "@/lib/events/format";
import { commitmentEnabled, readCommitment } from "@/lib/events/report";
import { defaultConfirmationHours, defaultSlotMinutes, lunchRulesFromCenter } from "@/lib/events/rules";
import { eventStatusLabel } from "@/lib/events/status";
import { canAccess } from "@/lib/permissions";
import { isUuid, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { saveEvent } from "../actions";
import { EventBuilder, type BuilderEvent } from "./event-builder";

export const metadata: Metadata = { title: "Event builder" };

export default async function EventBuilderPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const sp = await searchParams;
  const eventId = param(sp, "event");
  const access = await loadEventAccess(session);
  const tz = session.center.time_zone;
  const rules = session.center.rules;

  if (!canAccess(session, "events") && !(eventId && isUuid(eventId) && eventAreas.event(access, eventId))) {
    return (
      <>
        <PageHeader title="Event builder" />
        <NoAccess area="Events" access="events" />
      </>
    );
  }

  const res = await load(async () => {
    if (!eventId) return null;
    if (!isUuid(eventId)) return "missing" as const;
    const e = row(await session.db.from("events").select("*").eq("id", eventId).maybeSingle(), "the event");
    if (!e) return "missing" as const;
    const names = await resolvePeopleNames(session.db, [e.owner_person_id]);
    return { e, ownerName: e.owner_person_id ? (names.get(e.owner_person_id) ?? "Event lead") : null };
  });

  if (!res.ok) {
    return (
      <>
        <PageHeader title="Event builder" />
        <LoadProblem message={res.error} retryHref={`/events/builder${eventId ? `?event=${eventId}` : ""}`} />
      </>
    );
  }
  if (res.data === "missing") {
    return (
      <>
        <PageHeader title="Event builder" />
        <Alert tone="warning" title="That event was not found" action={<Link href="/events/builder" className={buttonClass("ghost", "xs")}>Start a new event</Link>}>
          It may have been deleted, or your role can&apos;t see it.
        </Alert>
      </>
    );
  }

  const lunchRules = lunchRulesFromCenter(rules);
  let event: BuilderEvent;
  let subtitle: string;
  const found = res.data;
  if (found) {
    const e = found.e;
    const commitment = readCommitment(e.commitment_options);
    const flags = Array.isArray(e.attendee_flags) ? e.attendee_flags.filter((f): f is string => typeof f === "string") : [];
    event = {
      id: e.id,
      status: e.status,
      name: e.name,
      description: e.description ?? "",
      flyer_path: e.flyer_path ?? "",
      venue: e.venue ?? "",
      starts_at: toDateTimeLocal(e.starts_at, tz),
      ends_at: toDateTimeLocal(e.ends_at, tz),
      program_year: e.program_year ?? "",
      capacity: e.capacity === null ? "" : String(e.capacity),
      waitlist_enabled: e.waitlist_enabled,
      audience: e.audience,
      rsvp_opens_at: toDateTimeLocal(e.rsvp_opens_at, tz),
      rsvp_closes_at: toDateTimeLocal(e.rsvp_closes_at, tz),
      confirmation_hours_before: e.confirmation_hours_before,
      attendee_flags: flags,
      commitment,
      commitments_enabled: commitmentEnabled(commitment),
      lunch_enabled: e.lunch_enabled,
      lunch_starts_at: toDateTimeLocal(e.lunch_starts_at, tz),
      lunch_slot_minutes: e.lunch_slot_minutes,
      lunch_seats_per_slot: e.lunch_seats_per_slot === null ? "" : String(e.lunch_seats_per_slot),
      is_paid: e.is_paid,
      member_price: centsToDollarsInput(e.member_price_cents),
      guest_price: centsToDollarsInput(e.guest_price_cents),
      confidential: e.confidential,
      owner: e.owner_person_id ? { id: e.owner_person_id, name: found.ownerName ?? "Event lead", detail: null } : null,
    };
    subtitle = [e.name, e.starts_at ? formatEventDate(e.starts_at, tz) : "No date yet", eventStatusLabel(e.status).label.toLowerCase()].join(" · ");
  } else {
    // A new event starts with the prototype's defaults: everyone, waitlist on, commitments on.
    event = {
      id: null,
      status: "draft",
      name: "",
      description: "",
      flyer_path: "",
      venue: "",
      starts_at: "",
      ends_at: "",
      program_year: "",
      capacity: "",
      waitlist_enabled: true,
      audience: "members_and_guests",
      rsvp_opens_at: "",
      rsvp_closes_at: "",
      confirmation_hours_before: defaultConfirmationHours(rules),
      attendee_flags: ["child_under_12", "senior", "assistance"],
      commitment: { per_person: [300, 500, 700], lump_sum: [1000, 2500, 5000], open: true },
      commitments_enabled: true,
      lunch_enabled: true,
      lunch_starts_at: "",
      lunch_slot_minutes: defaultSlotMinutes(rules),
      lunch_seats_per_slot: "",
      is_paid: false,
      member_price: "",
      guest_price: "",
      confidential: false,
      owner: null,
    };
    subtitle = "New event · draft";
  }

  const editable = event.id ? eventAreas.edit(access, event.id) : eventAreas.manage(access);
  const canPublish = eventAreas.manage(access) || (event.id !== null && eventAreas.edit(access, event.id));
  const saved = param(sp, "saved");

  return (
    <>
      <PageHeader
        title="Event builder"
        description={subtitle}
        actions={
          event.id ? (
            <>
              <Link href={`/events/${event.id}`} className={buttonClass("ghost")}>
                Open event page
              </Link>
              {editable ? (
                <Link href="/events/builder" className={buttonClass("ghost")}>
                  New event
                </Link>
              ) : null}
            </>
          ) : null
        }
      />
      {saved === "draft" || saved === "published" ? (
        <div className="mb-4">
          <Alert tone="success" title={saved === "published" ? "Published · RSVPs open in the member app" : "Draft saved"}>
            {saved === "published"
              ? "Reminders are scheduled and the check-in list is ready in volunteer mode."
              : "Only staff can see a draft. Publish it when it is ready for members."}
          </Alert>
        </div>
      ) : null}
      <EventBuilder
        key={event.id ?? "new"}
        action={saveEvent.bind(null, event.id)}
        event={event}
        lunchRules={lunchRules}
        editable={editable}
        canPublish={editable && canPublish}
      />
    </>
  );
}
