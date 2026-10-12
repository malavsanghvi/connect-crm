import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LoadProblem } from "@/components/events/load-problem";
import { EventCreator } from "@/components/event-creator/event-creator";
import { Alert, NoAccess, PageHeader, buttonClass } from "@/components/ui";
import { loadCreator } from "@/lib/event-creator/load";
import { randomToken } from "@/lib/events/tokens";
import { LOOK_COOKIE, parseLook } from "@/lib/look";
import { isUuid, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { addChecklistAction, createEventFromTemplateInPlace, createShift, generateLunchSlots, saveEventDraftInPlace } from "../actions";
import { draftEventReminderAction } from "./actions";

export const metadata: Metadata = { title: "Create an event" };

/**
 * The guided event creator (New look only). The classic look keeps the event builder, so this address sends it there.
 * `?event=<id>` reopens a draft at its next unanswered card; a new creator gets a short `s` so a reload after card 1 (which adds
 * `event`) stays the same creator.
 */
export default async function NewEventPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  const eventId = param(sp, "event");
  const s = param(sp, "s");
  const jar = await cookies();
  if (parseLook(jar.get(LOOK_COOKIE)?.value) !== "v2") redirect(eventId && isUuid(eventId) ? `/events/builder?event=${eventId}` : "/events/builder");
  if (eventId && !isUuid(eventId)) return <Missing />;
  if (!eventId && !s) redirect(`/events/new?s=${randomToken(8)}`);

  const session = await getSession();
  const res = await loadCreator(session, eventId ?? null);
  switch (res.state) {
    case "no_access":
      return (
        <>
          <PageHeader title="Create an event" />
          <NoAccess area="Events" access="eventsManage" />
        </>
      );
    case "missing":
      return <Missing />;
    case "error":
      return (
        <>
          <PageHeader title="Create an event" />
          <LoadProblem message={res.message} retryHref={`/events/new${eventId ? `?event=${eventId}` : ""}`} />
        </>
      );
    case "ok":
      return (
        <EventCreator
          key={s ?? eventId ?? "new"}
          ctx={res.ctx}
          initialDraft={res.draft}
          existing={res.existing}
          sessionParam={s ?? null}
          api={{
            save: saveEventDraftInPlace,
            fromTemplate: createEventFromTemplateInPlace,
            createShift,
            generateLunchSlots,
            addChecklistAction,
            draftReminder: draftEventReminderAction,
          }}
        />
      );
  }
}

function Missing() {
  return (
    <>
      <PageHeader title="Create an event" />
      <Alert
        tone="warning"
        title="That draft was not found"
        action={
          <Link href="/events/new" className={buttonClass("ghost", "xs")}>
            Start a new event
          </Link>
        }
      >
        It may have been deleted, or your role can&apos;t see it.
      </Alert>
    </>
  );
}
