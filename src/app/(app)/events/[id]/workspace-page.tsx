import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionButton } from "@/components/events/action-button";
import { EventOverview, EventWorkspaceFrame, type FrameProps } from "@/components/events-v2/event-workspace";
import { LoadProblem } from "@/components/events/load-problem";
import { MoreDetails } from "@/components/more-details";
import { HistoryButton } from "@/components/record-history";
import { NoAccess, PageHeader, buttonClass } from "@/components/ui";
import { communityFormat } from "@/lib/community-format";
import { load, loadEventAccess, resolvePeopleNames, row } from "@/lib/data/events";
import { dateInTz } from "@/lib/dates";
import { eventAreas } from "@/lib/events/access";
import { eventStatusLabel } from "@/lib/events/status";
import { EVENT_CANCEL_BUTTON, EVENT_STATUS_BUTTONS, allowedNextStatuses, isEventStatus } from "@/lib/events/status-machine";
import { eventWhenLine, sameDayNextYear, workspaceHref, workspaceTabs, workspaceView, type WorkspaceView } from "@/lib/events/workspace";
import { communityToday, loadEventWorkspace } from "@/lib/events/workspace-load";
import { isUuid, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { setEventStatus } from "../actions";
import { flyerPreviewUrlAction } from "../builder/flyer-actions";
import { ChecklistTab } from "./checklist-tab";
import { DetailsTab } from "./details-tab";
import { LunchTab } from "./lunch-tab";
import { ReportTab } from "./report-tab";
import { RsvpsTab } from "./rsvps-tab";
import { SurveyTab } from "./survey-tab";
import { VolunteersTab } from "./volunteers-tab";

const MORE: { label: string; view: WorkspaceView }[] = [
  { label: "Details", view: "details" },
  { label: "Checklist", view: "checklist" },
  { label: "Report", view: "report" },
];

/**
 * The event page in the new look: the Events workspace of the admin-v2 board. The overview shows the event's numbers, checklist and
 * what blocks it going live, with Niva's column for this event beside it; the other sections show the classic tabs inside the
 * workspace's header. Same access checks, same data, same Server Actions as the classic page.
 */
export async function EventWorkspacePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<RawSearchParams> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const view = workspaceView(param(sp, "tab"));
  const session = await getSession();
  const access = await loadEventAccess(session);
  if (!eventAreas.event(access, id)) {
    return (
      <>
        <PageHeader title="Event" tabs={false} />
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
        <PageHeader title="Event" tabs={false} />
        <LoadProblem message={res.error} retryHref={`/events/${id}`} />
      </>
    );
  }
  if (!res.data) notFound();
  const { event, ownerName } = res.data;
  const canEdit = eventAreas.edit(access, id);
  const { locale } = communityFormat(session.center);
  const facts = [
    eventWhenLine(event.starts_at, tz, locale),
    event.venue,
    event.capacity !== null ? `capacity ${event.capacity.toLocaleString("en-US")}` : null,
    ownerName ? `Lead: ${ownerName}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const more = [
    ...MORE.map((m) => ({ label: m.label, href: workspaceHref(id, m.view), current: view === m.view })),
    ...(eventAreas.checkIn(access, id) ? [{ label: "Check-in screen", href: `/ops/${id}/checkin`, current: false }] : []),
    ...(eventAreas.kitchen(access, id) ? [{ label: "Kitchen display", href: `/ops/${id}/kitchen`, current: false }] : []),
  ];
  const actions = (
    <>
      {canEdit
        ? (isEventStatus(event.status) ? EVENT_STATUS_BUTTONS[event.status] : []).map((n) => (
            <ActionButton key={n.to} action={setEventStatus.bind(null, event.id)} fields={{ status: n.to }} label={n.label} variant={n.variant} size="sm" confirm={n.confirm} />
          ))
        : null}
      {canEdit && allowedNextStatuses(event.status).includes(EVENT_CANCEL_BUTTON.to) ? (
        <ActionButton
          action={setEventStatus.bind(null, event.id)}
          fields={{ status: EVENT_CANCEL_BUTTON.to }}
          label={EVENT_CANCEL_BUTTON.label}
          variant={EVENT_CANCEL_BUTTON.variant}
          size="sm"
          confirm={EVENT_CANCEL_BUTTON.confirm}
        />
      ) : null}
      <HistoryButton table="events" recordId={id} title={event.name} variant="ghost" size="sm" />
      {canEdit ? (
        <Link href={`/events/builder?event=${id}`} className={buttonClass("primary", "sm")}>
          Edit in builder
        </Link>
      ) : null}
    </>
  );
  const header: Omit<FrameProps, "children"> = { name: event.name, status: eventStatusLabel(event.status), facts, tabs: workspaceTabs(id, view), more, actions };

  if (view === "overview") {
    const data = await loadEventWorkspace(session, event);
    const today = communityToday(session);
    return (
      <EventOverview
        {...header}
        event={{ id: event.id, name: event.name }}
        community={{ name: session.center.name }}
        {...data}
        today={today}
        cloneDate={sameDayNextYear(event.starts_at ? dateInTz(event.starts_at, tz) : null, today)}
        links={{
          rsvps: workspaceHref(id, "rsvps"),
          checklist: workspaceHref(id, "checklist"),
          builder: canEdit ? `/events/builder?event=${id}` : null,
          newEvent: "/events/builder",
          newsletters: "/comms/newsletters",
        }}
      />
    );
  }

  const flyer =
    view === "details" && event.flyer_path
      ? await (async () => {
          const r = await flyerPreviewUrlAction(id);
          return r.ok ? { url: r.data!.url, error: null } : { url: null, error: r.error };
        })()
      : { url: null, error: null };

  return (
    <EventWorkspaceFrame {...header}>
      {view === "details" ? (
        <>
          <DetailsTab event={event} tz={tz} currency={session.center.currency} ownerName={ownerName} canEdit={canEdit} flyerUrl={flyer.url} flyerError={flyer.error} />
          <MoreDetails session={session} entity="events" recordId={event.id} editable={canEdit} variant="card" className="mt-4" />
        </>
      ) : null}
      {view === "checklist" ? <ChecklistTab event={event} session={session} access={access} /> : null}
      {view === "rsvps" ? <RsvpsTab event={event} session={session} access={access} status={param(sp, "rsvp") ?? null} /> : null}
      {view === "volunteers" ? <VolunteersTab event={event} session={session} access={access} /> : null}
      {view === "lunch" ? <LunchTab event={event} session={session} access={access} /> : null}
      {view === "survey" ? <SurveyTab event={event} session={session} access={access} /> : null}
      {view === "report" ? <ReportTab event={event} session={session} /> : null}
    </EventWorkspaceFrame>
  );
}
