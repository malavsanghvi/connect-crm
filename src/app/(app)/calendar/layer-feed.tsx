"use client";

import { useState } from "react";

import { ActionForm } from "@/components/action-form";
import { Drawer } from "@/components/drawer";
import { buttonClass, DrawerSection, Field } from "@/components/ui";

import { refreshLayerFeedAction, subscribeLayerFeedAction, unsubscribeLayerFeedAction } from "./actions";

/**
 * "Subscribe to a calendar (ICS link)" for one layer: the link, whether its
 * dates also become events, where the last refresh stands, Refresh now and
 * Stop following.
 */
export function LayerFeed({
  layerId,
  name,
  sourceUrl,
  subscribed,
  createsEvents,
  canCreateEvents,
  status,
}: {
  layerId: string;
  name: string;
  sourceUrl: string | null;
  subscribed: boolean;
  createsEvents: boolean;
  canCreateEvents: boolean;
  status: { tone: "ok" | "warn" | "bad"; text: string } | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("ghost", "xs")} aria-label={`Calendar link for ${name}`}>
        {subscribed ? "Calendar link" : "Subscribe to a calendar"}
      </button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        kicker="Calendar layer"
        title={name}
        subtitle="Follow a published calendar (Google Calendar, Outlook, a school district…) by its ICS link."
      >
        {subscribed ? (
          <DrawerSection title="Now following">
            <p className="mb-1 break-all text-[13px]">{sourceUrl}</p>
            {status ? <p className={`cc-status-${status.tone} text-[13px]`}>{status.text}</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <ActionForm action={refreshLayerFeedAction.bind(null, layerId)} submitLabel="Refresh now" pendingLabel="Queuing…" variant="ghost" size="sm" />
              <ActionForm
                action={unsubscribeLayerFeedAction.bind(null, layerId)}
                submitLabel="Stop following"
                variant="bad"
                size="sm"
                confirmMessage={`Stop following this calendar?\nThe dates already on ${name} stay; new ones will no longer arrive.`}
              />
            </div>
          </DrawerSection>
        ) : null}
        <DrawerSection title={subscribed ? "Change the link" : "Subscribe to a calendar (ICS link)"}>
          <ActionForm action={subscribeLayerFeedAction.bind(null, layerId)} submitLabel={subscribed ? "Save and refresh" : "Subscribe"} pendingLabel="Saving…">
            <div className="mb-3 flex flex-col gap-3">
              <Field label="Calendar link (ICS)" htmlFor={`feed-${layerId}`} hint="The calendar's public address, ending in .ics — in Google Calendar: Settings › the calendar › Public address in iCal format. webcal:// links work too.">
                <input
                  id={`feed-${layerId}`}
                  name="source_url"
                  type="url"
                  required
                  defaultValue={sourceUrl ?? ""}
                  placeholder="https://calendar.google.com/calendar/ical/…/public/basic.ics"
                  className="crm-input"
                />
              </Field>
              {canCreateEvents ? (
                <label className="flex items-start gap-2 text-[13px]">
                  <input type="checkbox" name="create_events" defaultChecked={createsEvents} className="mt-0.5" />
                  <span>
                    Also create an event for each date (shown in Events and the member app; past ones are marked completed). Imported events ask for no
                    money; add RSVP details or sponsorships in Events.
                  </span>
                </label>
              ) : null}
              <p className="text-xs text-muted">
                The background service fetches the calendar now and then once a day. Repeating events are filled in from six months back to a year ahead;
                changes and removals in the calendar follow on the next refresh.
              </p>
            </div>
          </ActionForm>
        </DrawerSection>
      </Drawer>
    </>
  );
}
