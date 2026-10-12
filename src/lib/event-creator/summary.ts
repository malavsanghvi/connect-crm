// One line per answered card ("Main hall · room for 260 · waitlist on"), and the event's date line, in the community's own
// locale and currency. Pure.

import { formatShortCents, parseDollarsToCents } from "@/lib/events/format";
import { audienceLabel } from "@/lib/events/report";

import { formatClockText, formatDay } from "./smart";
import type { CardId, CreatorCtx, CreatorExisting, EventDraft } from "./types";

const LOCAL = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;

/** "Sun, Nov 8 · 6:00 PM–9:30 PM" from the draft's datetime-local values. */
export function whenText(d: EventDraft, ctx: Pick<CreatorCtx, "locale">): string {
  const s = LOCAL.exec(d.starts_at);
  if (!s) return "No date yet";
  const e = LOCAL.exec(d.ends_at);
  const start = `${formatDay(s[1], ctx.locale)} · ${formatClockText(s[2], ctx.locale)}`;
  if (!e) return start;
  if (e[1] === s[1]) return `${start}–${formatClockText(e[2], ctx.locale)}`;
  return `${start} – ${formatDay(e[1], ctx.locale)} ${formatClockText(e[2], ctx.locale)}`;
}

/** "$12 members · $18 guests", "Free" — the price line of the event page. */
export function priceText(d: EventDraft, ctx: Pick<CreatorCtx, "currency">): string {
  if (!d.is_paid) return "Free";
  const m = parseDollarsToCents(d.member_price);
  const g = parseDollarsToCents(d.guest_price);
  if (m === null) return "Tickets · price to be set";
  return `${formatShortCents(m, ctx.currency)} members${g !== null ? ` · ${formatShortCents(g, ctx.currency)} guests` : ""}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function summaryOf(card: CardId, d: EventDraft, ctx: CreatorCtx, existing: CreatorExisting): string {
  switch (card) {
    case "what":
      return `${d.name.trim() || "Untitled event"} · ${whenText(d, ctx)}`;
    case "where":
      return d.venue.trim() ? `${d.venue.trim()} · ${d.capacity.trim() ? `room for ${d.capacity.trim()}` : "no limit"}${d.waitlist_enabled ? " · waitlist on" : ""}` : "No place yet";
    case "who":
      return `${audienceLabel(d.audience)}${d.attendee_flags.length ? ` · asks about ${plural(d.attendee_flags.length, "thing")}` : ""}`;
    case "money":
      return `${priceText(d, ctx)}${d.commitments_enabled ? " · donation commitment at RSVP" : ""}`;
    case "help":
      return [plural(existing.shifts.length, "shift"), d.lunch_enabled ? "meal times on" : "no meal times", plural(existing.checklist.length, "checklist item")].join(" · ");
    case "words":
      return d.description.trim() ? (d.description.trim().length > 70 ? `${d.description.trim().slice(0, 70)}…` : d.description.trim()) : "No description yet";
    case "sending":
      return d.reminder_enabled ? `Confirm ${d.confirmation_hours_before || "24"} hours before` : "No confirmation reminder";
    case "more":
      return [d.owner ? `Led by ${d.owner.name}` : "No lead yet", d.confidential ? "committee only" : null, d.rsvp_opens_at || d.rsvp_closes_at ? "RSVP window set" : null, d.program_year ? d.program_year : null].filter(Boolean).join(" · ");
    case "review":
      return "";
  }
}
