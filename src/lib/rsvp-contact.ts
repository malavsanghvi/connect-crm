// RSVP without signing in, as the portal shows and sets it (docs/RSVP_WITHOUT_LOGIN.md). Pure: the Settings form, the event's RSVPs tab, the
// Family page and their tests share it.
//
// Two switches, both off until someone turns them on:
//   the community's rule   centers.rules.rsvp.contact_lookup   the most open way any event may let a visitor RSVP (settings.manage)
//   the event's choice     events.contact_rsvp                 never above the community's; free, public, non-confidential events only
// The database keeps both honest (a trigger on events, supabase/migrations/0822); this file only says it in words and mirrors the
// same rules so a screen can explain a choice before it is refused.

import type { Json } from "@/lib/database.types";

// (Not imported from center-rules: that file checks the rule bag with this file, so the import would go round.)
function isPlainObject(v: unknown): v is { [key: string]: Json | undefined } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export type ContactMode = "off" | "code" | "open";
export const CONTACT_MODES: readonly ContactMode[] = ["off", "code", "open"];

export function isContactMode(v: unknown): v is ContactMode {
  return v === "off" || v === "code" || v === "open";
}

const RANK: Record<ContactMode, number> = { off: 0, code: 1, open: 2 };

/** The community's rule (rules.rsvp.contact_lookup); anything that is not "code" or "open" reads as off, as the database reads it. */
export function readContactLookup(rules: Json | undefined): ContactMode {
  if (!isPlainObject(rules)) return "off";
  const rsvp = rules.rsvp;
  if (!isPlainObject(rsvp)) return "off";
  const v = rsvp.contact_lookup;
  return v === "code" || v === "open" ? v : "off";
}

/** The event's own switch as stored; a value the database does not know reads as off. */
export function readEventMode(v: unknown): ContactMode {
  return isContactMode(v) ? v : "off";
}

/** What an event really has: its own choice, but never more than the community allows. */
export function effectiveContactMode(eventMode: ContactMode, community: ContactMode): ContactMode {
  return RANK[eventMode] <= RANK[community] ? eventMode : community;
}

export const CONTACT_MODE_LABEL: Record<ContactMode, string> = {
  off: "Off",
  code: "With a code",
  open: "Without a code",
};

/** The community's choice, said in words (Settings › Rules). */
export const COMMUNITY_MODE_NOTE: Record<ContactMode, string> = {
  off: "Visitors who are not signed in cannot RSVP. No event can turn it on.",
  code: "An event can let a visitor RSVP for their family with just a phone number or email. We send a 6-digit code to it first, and only then show the family, with names partly hidden.",
  open: "An event can let a visitor RSVP for their family with just a phone number or email. We show the family right away, with names partly hidden. Anyone who knows a member's phone number or email can then see how many people are in that family and the first and last letters of their names. Choose this only if that is acceptable.",
};

/** The event's choice, said in words (the event's RSVPs tab). */
export const EVENT_MODE_NOTE: Record<ContactMode, string> = {
  off: "A visitor who is not signed in must sign in to RSVP.",
  code: "A visitor types a phone number or email, gets a 6-digit code at it, and then picks who in the family is coming. Names are partly hidden.",
  open: "A visitor types a phone number or email and sees the family right away, with names partly hidden, and picks who is coming. Anyone who knows a member's phone number or email can see the shape of that family.",
};

/**
 * Why an event cannot use RSVP without signing in, in the database's own words (the trigger refuses it with the same rules); null when it can.
 * It is for free events open to the public, or to members and guests, that are not confidential.
 */
export function eventIneligibleReason(event: { is_paid: boolean; confidential: boolean; audience: string }): string | null {
  if (event.is_paid) return "This is a paid event. RSVP without signing in is for free events only.";
  if (event.confidential) return "This is a confidential event, so it is not shown to visitors who are not signed in.";
  if (event.audience !== "public" && event.audience !== "members_and_guests") {
    return "This event is not open to the public or to members and guests, so a visitor who is not signed in cannot see it.";
  }
  return null;
}

export type ModeOption = { value: ContactMode; label: string; disabled: boolean };

/** The choices for an event: each mode, those above the community's rule greyed out. */
export function eventModeOptions(community: ContactMode): ModeOption[] {
  return CONTACT_MODES.map((m) => ({ value: m, label: CONTACT_MODE_LABEL[m], disabled: RANK[m] > RANK[community] }));
}

/** The plain sentence over the choice: where the event stands and why. */
export function eventModeStatus(eventMode: ContactMode, community: ContactMode, event: { is_paid: boolean; confidential: boolean; audience: string }): string {
  const no = eventIneligibleReason(event);
  if (no) return `Not available for this event. ${no}`;
  if (community === "off") return "Not allowed for this community. An administrator can allow it in Settings › Rules.";
  const effective = effectiveContactMode(eventMode, community);
  if (effective === "off") return "Off for this event.";
  if (effective !== eventMode) return `${CONTACT_MODE_LABEL[effective]} (this community allows nothing more open than that).`;
  return `On: ${CONTACT_MODE_LABEL[effective].toLowerCase()}.`;
}

/**
 * How many places RSVPs made without signing in may hold before the family has been checked: 25% of the places (at least one), or 40 when
 * the event has no limit. The same number the database uses; the database is the one that enforces it.
 */
export function unverifiedPlaces(capacity: number | null): number {
  return capacity === null ? 40 : Math.max(Math.ceil((capacity * 25) / 100), 1);
}

/** The explanation of the unverified share, for the event's RSVPs tab. */
export function unverifiedShareText(capacity: number | null): string {
  const places = unverifiedPlaces(capacity);
  const of = capacity === null ? "no limit is set, so the cap is 40 places" : `${capacity} places`;
  return (
    `RSVPs made without signing in are marked Unverified until the family opens the link in its confirmation email, or you mark them verified here. ` +
    `A visitor who typed a code is verified at once. Until then they can hold at most ${places} of the event's places (${of}), so a stranger cannot fill the event. ` +
    `Marking one verified frees its place from that cap.`
  );
}

/** The value of rsvps.source for an RSVP made without signing in. */
export const CONTACT_SOURCE = "guest_contact";

/** What the Family page and the RSVPs tab call that way of RSVPing. */
export const CONTACT_SOURCE_LABEL = "Without signing in";

/** Made without signing in, and nobody has proved the phone or email yet. */
export function isUnverifiedContactRsvp(r: { source: string | null; contact_verified_at?: string | null }): boolean {
  return r.source === CONTACT_SOURCE && !r.contact_verified_at;
}

/** Problems with the stored rule, in plain words (for the rules checker); none when it is unset. */
export function rsvpContactRuleProblems(rsvp: unknown): string[] {
  if (rsvp === undefined || rsvp === null) return [];
  if (!isPlainObject(rsvp)) return [`"rsvp" must be an object.`];
  const v = rsvp.contact_lookup;
  if (v === undefined || v === null || isContactMode(v)) return [];
  return [`"rsvp.contact_lookup" must be "off", "code" or "open".`];
}
