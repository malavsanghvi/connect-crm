import Link from "next/link";

import { Badge } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { NO_FAMILY_NOTE, VIEW_ONLY_NOTE, type AddSetup } from "@/lib/people-v2/event-add";
import { cameText, personEventsSummary, type PersonEvents } from "@/lib/people-v2/person-events";
import type { Part } from "@/lib/people-v2/slideover";

import { PartNote } from "../slideover/section";

import { AddToEvent } from "./add-to-event";

// The Events section of the person slide-over: this person's own tickets (the event, its date, the answer and whether they were checked
// in), read only, and under them the control that puts them (and, if staff choose, the rest of their family) on an event. It has no
// hooks of its own, so it draws on the server; the panel is the one client part.

/** The control, or the sentence for why there is none. Shared with the Family page's Events tab. */
export function AddToEventControl({ setup }: { setup: AddSetup }) {
  if (setup.kind === "add") return <AddToEvent {...setup.props} />;
  if (setup.kind === "view-only")
    return (
      <p data-testid="add-to-event-view-only" className="m-0 text-[13px] text-muted">
        {VIEW_ONLY_NOTE}
      </p>
    );
  if (setup.kind === "no-family")
    return (
      <p data-testid="add-to-event-no-family" className="m-0 text-[13px] text-muted">
        {NO_FAMILY_NOTE}
      </p>
    );
  return null;
}

export function PersonEventsBody({ firstName, list, timeZone, add }: { firstName: string; list: Part<PersonEvents>; timeZone: string; add: AddSetup }) {
  return (
    <div data-testid="person-events">
      {list.state !== "ok" ? (
        <PartNote part={list} what="the events" />
      ) : list.data.lines.length === 0 ? (
        <p data-testid="person-events-empty" className="m-0 py-1 text-[14px] text-muted">
          {firstName} is not on the list for any event yet.
        </p>
      ) : (
        <>
          <p className="m-0 mb-1 text-[13px] text-muted">{personEventsSummary(list.data.lines)}</p>
          <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
            {list.data.lines.map((l) => (
              <li key={l.rsvpId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2">
                <span className="min-w-0 flex-1 basis-40">
                  {l.eventVisible ? (
                    <Link href={`/events/${l.eventId}`} dir="auto" className="crm-link text-[14.5px] font-semibold">
                      {l.eventName}
                    </Link>
                  ) : (
                    <span className="text-[14.5px] text-muted">{l.eventName}</span>
                  )}
                  <span className="block text-[13px] text-muted">{l.startsAt ? formatDate(l.startsAt, timeZone) : "No date"}</span>
                </span>
                <span className="flex shrink-0 items-baseline gap-3 text-[13.5px]">
                  <Badge tone={l.tone}>{l.answer}</Badge>
                  <span className="text-muted">
                    Checked in <span className={l.checkedIn > 0 ? "font-semibold text-ink" : ""}>{cameText(l)}</span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {list.data.olderLeftOut ? <p className="m-0 pt-1 text-[13px] text-muted">Showing the latest only; older ones are on each event.</p> : null}
        </>
      )}
      <div className="mt-3">
        <AddToEventControl setup={add} />
      </div>
    </div>
  );
}
