import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionButton } from "@/components/events/action-button";
import { LoadProblem } from "@/components/events/load-problem";
import { HistoryButton } from "@/components/record-history";
import { NoAccess, PageHeader, Tabs, buttonClass, type ButtonVariant } from "@/components/ui";
import { load, loadEventAccess, resolvePeopleNames, row } from "@/lib/data/events";
import { eventAreas } from "@/lib/events/access";
import { formatDateTime } from "@/lib/events/format";
import { STATUS_TEXT_CLASS, eventRef, eventStatusLabel } from "@/lib/events/status";
import { isUuid, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { setEventStatus } from "../actions";
import { ChecklistTab } from "./checklist-tab";
import { DetailsTab } from "./details-tab";
import { LunchTab } from "./lunch-tab";
import { ReportTab } from "./report-tab";
import { RsvpsTab } from "./rsvps-tab";
import { VolunteersTab } from "./volunteers-tab";

export const metadata: Metadata = { title: "Event" };

const TABS = [
  { key: "details", label: "Details" },
  { key: "checklist", label: "Checklist" },
  { key: "rsvps", label: "RSVPs" },
  { key: "volunteers", label: "Volunteers" },
  { key: "lunch", label: "Lunch" },
  { key: "report", label: "Report" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const NEXT_STATUS: Record<string, { to: string; label: string; variant: ButtonVariant; confirm?: string }[]> = {
  draft: [{ to: "published", label: "Publish (open RSVPs)", variant: "primary", confirm: "Publish this event? Members will be able to RSVP in the app." }],
  published: [
    { to: "rsvp_closed", label: "Close RSVPs", variant: "ghost" },
    { to: "live", label: "Go live (event day)", variant: "ok", confirm: "Go live? Check-in opens in volunteer mode." },
  ],
  rsvp_closed: [
    { to: "published", label: "Reopen RSVPs", variant: "ghost" },
    { to: "live", label: "Go live (event day)", variant: "ok", confirm: "Go live? Check-in opens in volunteer mode." },
  ],
  live: [{ to: "completed", label: "Mark completed", variant: "ghost" }],
  completed: [{ to: "live", label: "Reopen as live", variant: "ghost" }],
  cancelled: [{ to: "draft", label: "Restore as draft", variant: "ghost" }],
};

export default async function EventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<RawSearchParams> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const tab: TabKey = TABS.find((t) => t.key === param(sp, "tab"))?.key ?? "details";
  const session = await getSession();
  const access = await loadEventAccess(session);
  if (!eventAreas.event(access, id)) {
    return (
      <>
        <PageHeader title="Event" />
        <NoAccess area="This event" access="events" />
      </>
    );
  }
  const tz = session.center.time_zone;
  const res = await load(async () => {
    const event = row(await session.db.from("events").select("*").eq("id", id).maybeSingle(), "the event");
    if (!event) return null;
    const names = await resolvePeopleNames(session.db, [event.owner_person_id]);
    return { event, ownerName: event.owner_person_id ? (names.get(event.owner_person_id) ?? "assigned") : null };
  });
  if (!res.ok) {
    return (
      <>
        <PageHeader title="Event" />
        <LoadProblem message={res.error} retryHref={`/events/${id}`} />
      </>
    );
  }
  if (!res.data) notFound();
  const { event, ownerName } = res.data;
  const canEdit = eventAreas.edit(access, id);
  const st = eventStatusLabel(event.status);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/events" className="crm-link">
            ← All events
          </Link>
        }
        title={event.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2">
            <span className="font-mono text-xs">{eventRef(event.id)}</span>
            <span className={STATUS_TEXT_CLASS[st.tone]}>{st.label}</span>
            <span>· {event.starts_at ? formatDateTime(event.starts_at, tz) : "No date yet"}</span>
            {event.venue ? <span>· {event.venue}</span> : null}
            {event.program_year ? <span>· Pathshala {event.program_year}</span> : null}
            {ownerName ? <span>· Lead: {ownerName}</span> : null}
          </span>
        }
        actions={
          <>
            {eventAreas.checkIn(access, id) ? (
              <Link href={`/ops/${id}/checkin`} className={buttonClass("ghost")}>
                Check-in screen
              </Link>
            ) : null}
            {eventAreas.kitchen(access, id) ? (
              <Link href={`/ops/${id}/kitchen`} className={buttonClass("ghost")}>
                Kitchen display
              </Link>
            ) : null}
            <Link href={`/events/live?event=${id}`} className={buttonClass("ghost")}>
              Live check-in
            </Link>
            <HistoryButton table="events" recordId={id} title={event.name} variant="ghost" size="md" />
            {canEdit ? (
              <Link href={`/events/builder?event=${id}`} className={buttonClass("primary")}>
                Edit in builder
              </Link>
            ) : null}
          </>
        }
      />
      {canEdit ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {(NEXT_STATUS[event.status] ?? []).map((n) => (
            <ActionButton
              key={n.to}
              action={setEventStatus.bind(null, event.id)}
              fields={{ status: n.to }}
              label={n.label}
              variant={n.variant}
              size="sm"
              confirm={n.confirm}
            />
          ))}
          {event.status !== "cancelled" && event.status !== "completed" ? (
            <ActionButton
              action={setEventStatus.bind(null, event.id)}
              fields={{ status: "cancelled" }}
              label="Cancel event"
              variant="bad"
              size="sm"
              confirm="Cancel this event? RSVPs stay on record."
            />
          ) : null}
        </div>
      ) : null}
      <Tabs active={tab} tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: `/events/${event.id}${t.key === "details" ? "" : `?tab=${t.key}`}` }))} />
      {tab === "details" ? <DetailsTab event={event} tz={tz} currency={session.center.currency} ownerName={ownerName} canEdit={canEdit} /> : null}
      {tab === "checklist" ? <ChecklistTab event={event} session={session} access={access} /> : null}
      {tab === "rsvps" ? <RsvpsTab event={event} session={session} access={access} status={param(sp, "rsvp") ?? null} /> : null}
      {tab === "volunteers" ? <VolunteersTab event={event} session={session} access={access} /> : null}
      {tab === "lunch" ? <LunchTab event={event} session={session} access={access} /> : null}
      {tab === "report" ? <ReportTab event={event} session={session} /> : null}
    </>
  );
}
