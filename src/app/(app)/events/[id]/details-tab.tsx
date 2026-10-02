import Link from "next/link";

import { BlockGrid, Card, DefinitionList, buttonClass } from "@/components/ui";
import type { Tables } from "@/lib/database.types";
import { FLYER_SOURCE_LABEL, readFlyerSource } from "@/lib/events/flyer";
import { formatDateTime, formatShortCents, humanize } from "@/lib/events/format";
import { audienceLabel, commitmentSummary, readCommitment, commitmentEnabled } from "@/lib/events/report";

export function DetailsTab({
  event,
  tz,
  currency,
  ownerName,
  canEdit,
  flyerUrl,
  flyerError,
}: {
  event: Tables<"events">;
  tz: string;
  currency: string;
  ownerName: string | null;
  canEdit: boolean;
  /** Signed URL for the private "content" bucket flyer object, resolved server-side (events/[id]/page.tsx). */
  flyerUrl: string | null;
  flyerError: string | null;
}) {
  const commit = readCommitment(event.commitment_options);
  const flags = Array.isArray(event.attendee_flags) ? event.attendee_flags.filter((f): f is string => typeof f === "string") : [];
  const flyerSource = readFlyerSource(event.flyer_source);
  const flyerMaker = `/events/builder?event=${event.id}#flyer`;
  return (
    <BlockGrid>
      <Card
        span={event.flyer_path ? 8 : 12}
        title="Details"
        actions={
          canEdit ? (
            <>
              {!event.flyer_path ? (
                <Link href={flyerMaker} className={buttonClass("ghost", "sm")}>
                  Make a flyer
                </Link>
              ) : null}
              <Link href={`/events/builder?event=${event.id}`} className={buttonClass("ghost", "sm")}>
                Edit in builder
              </Link>
            </>
          ) : null
        }
      >
        <DefinitionList
          items={[
            { label: "Starts", value: formatDateTime(event.starts_at, tz) },
            { label: "Ends", value: formatDateTime(event.ends_at, tz) },
            { label: "Venue", value: event.venue ?? "—" },
            { label: "Who can RSVP", value: audienceLabel(event.audience) },
            { label: "Capacity", value: event.capacity ?? "No limit" },
            { label: "Waitlist", value: event.waitlist_enabled ? "On · auto-offer freed seats" : "Off" },
            { label: "RSVP window", value: `${formatDateTime(event.rsvp_opens_at, tz)} → ${formatDateTime(event.rsvp_closes_at, tz)}` },
            {
              label: "Confirmation reminder",
              value: event.confirmation_hours_before > 0 ? `${event.confirmation_hours_before} hours before` : "Off",
            },
            { label: "Attendee questions", value: flags.map(humanize).join(", ") || "None" },
            {
              label: "Donation commitment",
              value: commitmentEnabled(commit) ? commitmentSummary(commit, (c) => formatShortCents(c, currency)) : "Off",
            },
            {
              label: "Lunch",
              value: event.lunch_enabled
                ? `${formatDateTime(event.lunch_starts_at, tz)} · ${event.lunch_slot_minutes}-min slots · ${event.lunch_seats_per_slot ?? "unlimited"} seats`
                : "Off",
            },
            {
              label: "Tickets",
              value: event.is_paid
                ? `Member ${formatShortCents(event.member_price_cents, currency)} · guest ${formatShortCents(event.guest_price_cents, currency)}`
                : "Free",
            },
            { label: "Owner (event lead)", value: ownerName ?? "Not set" },
            { label: "Confidential", value: event.confidential ? "Committee only" : "No" },
            { label: "Description", value: event.description ?? "—" },
          ]}
        />
      </Card>
      {event.flyer_path ? (
        <Card
          span={4}
          title="Flyer"
          actions={
            canEdit ? (
              <Link href={flyerMaker} className={buttonClass("ghost", "xs")}>
                Make or change the flyer
              </Link>
            ) : null
          }
        >
          {flyerUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={flyerUrl} alt={`Flyer for ${event.name}`} className="w-full rounded-[10px] border border-line" />
          ) : flyerError ? (
            <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
              {flyerError}
            </p>
          ) : (
            <p className="crm-hint">Loading…</p>
          )}
          {flyerSource ? <p className="crm-hint mt-1">{FLYER_SOURCE_LABEL[flyerSource]}</p> : null}
        </Card>
      ) : null}
    </BlockGrid>
  );
}
