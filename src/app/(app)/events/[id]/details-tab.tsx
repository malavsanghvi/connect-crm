import Link from "next/link";

import { BlockGrid, Card, DefinitionList, buttonClass } from "@/components/ui";
import type { Tables } from "@/lib/database.types";
import { formatDateTime, formatShortCents, humanize } from "@/lib/events/format";
import { audienceLabel, commitmentSummary, readCommitment, commitmentEnabled } from "@/lib/events/report";

export function DetailsTab({
  event,
  tz,
  currency,
  ownerName,
  canEdit,
}: {
  event: Tables<"events">;
  tz: string;
  currency: string;
  ownerName: string | null;
  canEdit: boolean;
}) {
  const commit = readCommitment(event.commitment_options);
  const flyerUrl = event.flyer_path && /^https?:\/\//.test(event.flyer_path) ? event.flyer_path : null;
  const flags = Array.isArray(event.attendee_flags) ? event.attendee_flags.filter((f): f is string => typeof f === "string") : [];
  return (
    <BlockGrid>
      <Card
        span={flyerUrl ? 8 : 12}
        title="Details"
        actions={
          canEdit ? (
            <Link href={`/events/builder?event=${event.id}`} className={buttonClass("ghost", "sm")}>
              Edit in builder
            </Link>
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
      {flyerUrl ? (
        <Card span={4} title="Flyer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={flyerUrl} alt={`Flyer for ${event.name}`} className="w-full rounded-[10px] border border-line" />
        </Card>
      ) : null}
    </BlockGrid>
  );
}
