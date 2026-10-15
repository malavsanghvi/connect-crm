import { ActionForm } from "@/components/action-form";
import { ChipGroup } from "@/components/controls";
import { Card, InfoBox } from "@/components/ui";
import type { Tables } from "@/lib/database.types";
import {
  EVENT_MODE_NOTE,
  eventIneligibleReason,
  eventModeOptions,
  eventModeStatus,
  readEventMode,
  unverifiedShareText,
  type ContactMode,
} from "@/lib/rsvp-contact";

import { setContactRsvp } from "../contact-rsvp-actions";

/**
 * The event's own switch for RSVP without signing in (docs/RSVP_WITHOUT_LOGIN.md): off, with a code, or without one. The community's rule
 * (Settings › Rules) is the most open any event may be; a paid, confidential or members-only event cannot use it. Said in words here before
 * the database would refuse it. Only people who can edit the event (event managers and its lead) get the control.
 */
export function ContactRsvpCard({ event, community, canEdit }: { event: Tables<"events">; community: ContactMode; canEdit: boolean }) {
  const mode = readEventMode(event.contact_rsvp);
  const ineligible = eventIneligibleReason(event);
  const status = eventModeStatus(mode, community, event);
  const canChange = canEdit && !ineligible && community !== "off";
  const on = mode !== "off" && !ineligible && community !== "off";

  return (
    <Card title="RSVP without signing in" description={status}>
      <div className="flex flex-col gap-3">
        {ineligible ? (
          <InfoBox>{ineligible}</InfoBox>
        ) : community === "off" ? (
          <InfoBox>
            This community has not allowed it. {canEdit ? "An administrator can allow it in Settings › Rules (Lunch and RSVP)." : "Ask an administrator."}
          </InfoBox>
        ) : null}
        {canChange ? (
          <ActionForm action={setContactRsvp.bind(null, event.id)} submitLabel="Save">
            <div className="mb-3 flex flex-col gap-2">
              <ChipGroup name="mode" label="RSVP without signing in" defaultValue={mode} options={eventModeOptions(community)} />
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px] leading-relaxed text-ink-2">
                {eventModeOptions(community)
                  .filter((o) => !o.disabled)
                  .map((o) => (
                    <li key={o.value}>
                      <strong>{o.label}.</strong> {EVENT_MODE_NOTE[o.value]}
                    </li>
                  ))}
              </ul>
            </div>
          </ActionForm>
        ) : (
          <p className="text-[13px] leading-relaxed text-ink-2">{EVENT_MODE_NOTE[on ? mode : "off"]}</p>
        )}
        {on ? <p className="text-[13px] leading-relaxed text-ink-2">{unverifiedShareText(event.capacity)}</p> : null}
        {on ? (
          <p className="text-xs text-muted">
            The family gets a confirmation email at the address we have on file, never at one the visitor typed, and no RSVP is saved if it cannot be sent. Only
            adults&apos; phone numbers and emails open a family. No donation, no extra guests and no waitlist this way.
          </p>
        ) : null}
      </div>
    </Card>
  );
}
