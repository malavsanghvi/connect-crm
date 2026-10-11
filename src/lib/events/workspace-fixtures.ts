// Invented sample data for the dev-only preview of the new-look Events workspace (src/app/dev/admin-events). A neutral community
// club with members of several cultures, an English, Spanish and Hindi language list (so one language has built-in wording and one
// needs translating), and one event. The reminder drafts and the readiness check are made by the real functions; nothing here is
// read from or written to a database. Never imported by a real page.

import type { AudiencePreviewData } from "@/lib/commands/catalog/events/audience";
import type { DraftReminderData } from "@/lib/commands/catalog/messages-draft-reminder";
import { draftReminder } from "@/lib/commands/catalog/reminder-text";
import type { HouseholdCard } from "@/lib/commands/types";
import { eventReadiness, type ReadinessEvent } from "@/lib/events/readiness";
import type { EventSummary } from "@/lib/events/summary";
import { languageList } from "@/lib/languages";
import { NEUTRAL_KIND } from "@/lib/kind";
import type { CrmSession } from "@/lib/session";

import { eventWhenLine, sameDayNextYear, workspaceHref, workspaceTabs, type ChecklistRow } from "./workspace";

export const SAMPLE_EVENT_ID = "00000000-0000-4000-8000-00000000e001";
export const SAMPLE_COMMUNITY = { name: "Lakeside Community Club", short_name: "LCC", time_zone: "America/Chicago", country: "US" };
export const SAMPLE_LANGUAGES = ["en", "es", "hi"];
const NOW = new Date("2026-10-11T15:00:00Z");
const TODAY = "2026-10-11";

const EVENT: ReadinessEvent & { id: string; name: string } = {
  id: SAMPLE_EVENT_ID,
  name: "Harvest Supper 2026",
  status: "published",
  starts_at: "2026-11-08T00:00:00Z",
  ends_at: "2026-11-08T03:00:00Z",
  venue: "Community hall",
  description: "Our autumn supper for every family in the club.",
  capacity: 300,
  rsvp_opens_at: "2026-10-01T14:00:00Z",
  rsvp_closes_at: "2026-11-05T05:00:00Z",
  lunch_enabled: true,
  lunch_starts_at: "2026-11-08T00:30:00Z",
  is_paid: false,
  member_price_cents: null,
  guest_price_cents: null,
  audience: "all",
  owner_person_id: "p-lead",
  flyer_path: "flyers/harvest.png",
};

const SUMMARY: EventSummary = {
  event: { id: SAMPLE_EVENT_ID, name: EVENT.name, status: "published", starts_at: EVENT.starts_at, capacity: 300, waitlist_enabled: true, lunch_enabled: true, is_paid: false },
  households: { rsvpd: 41, confirmed: 63, waitlisted: 4, cancelled: 6 },
  households_total: 114,
  walk_in_households: 0,
  people: { rsvpd: 268, confirmed: 171, waitlisted: 11, walk_ins: 0, not_arrived: 268, checked_in: 0, served: 0, gifts_given: 0, children_under_12: 52, seniors: 23, needs_assistance: 4 },
  lunch: { enabled: true, slots: 3, slots_done: 0, seats: 270, unlimited_slots: 0, assigned: 231, served: 0 },
  volunteers: { visible: true, shifts: 9, spots_needed: 32, assigned: 26, shifts_empty: 1, shifts_open: 4 },
  checklist: { total: 11, done: 6, in_progress: 2, not_started: 3, overdue: 1 },
};

const CHECKLIST: ChecklistRow[] = [
  { id: "a1", name: "Hall booked", state: "completed", due_on: "2026-09-01" },
  { id: "a2", name: "Caterer confirmed", state: "completed", due_on: "2026-09-20" },
  { id: "a3", name: "Flyer published", state: "completed", due_on: "2026-10-01" },
  { id: "a4", name: "RSVPs open", state: "completed", due_on: "2026-10-01" },
  { id: "a5", name: "Order table linens", state: "in_progress", due_on: "2026-10-09" },
  { id: "a6", name: "Meal counts to the kitchen", state: "not_started", due_on: "2026-10-18" },
  { id: "a7", name: "Fill the open volunteer shifts", state: "not_started", due_on: "2026-11-01" },
  { id: "a8", name: "Thank-you notes", state: "not_started", due_on: null },
];

const HOUSEHOLDS: HouseholdCard[] = [
  { household_id: "h1", household_name: "Okafor household", household_number: "0144", org_household_id: "LCC-H-1873", adults: ["Chidi Okafor", "Ada Okafor"], primary_adult: "Chidi Okafor", zone: null, city: "Riverside", last_gift_on: null, open_pledge_cents: null, open_pledge: null },
  { household_id: "h2", household_name: "Nguyen household", household_number: "0562", org_household_id: "LCC-H-2390", adults: ["Linh Nguyen", "Bao Nguyen"], primary_adult: "Linh Nguyen", zone: null, city: "Maple Grove", last_gift_on: null, open_pledge_cents: null, open_pledge: null },
];

const AUDIENCE: AudiencePreviewData = {
  event: { id: SAMPLE_EVENT_ID, name: EVENT.name },
  who: "Families who RSVP'd (RSVP'd or confirmed)",
  households: 104,
  guest_rsvps: 3,
  adults: 189,
  channels: { email: 171, sms: 96, whatsapp: 58, push: null },
  adults_with_no_channel: 7,
  quiet_hours: {
    window: "9 pm to 8 am",
    asked_for: "Sunday, October 11, 2026, 10:00 AM",
    goes_out_at: "Sunday, October 11, 2026, 10:00 AM",
    held: false,
    applies_to: "Push, text and WhatsApp wait for quiet hours to end. Email is not held.",
    note: "That time is outside quiet hours, so everything goes at once.",
  },
  notes: ["3 guest RSVPs without a household are not messaged: no consent is recorded for a guest.", "Push notifications are not counted here. Everyone with the Weaver app and the Events topic on gets the push."],
};

function drafts(): DraftReminderData {
  const list = SAMPLE_LANGUAGES.map((language) =>
    draftReminder({ kind: "event_reminder", language, event: EVENT, tz: SAMPLE_COMMUNITY.time_zone, country: SAMPLE_COMMUNITY.country, center: SAMPLE_COMMUNITY }),
  );
  return { event: { id: SAMPLE_EVENT_ID, name: EVENT.name }, drafts: list, sent: false, notes: [`The ${languageList(["hi"])} wording is built into Weaver. Ask someone who reads the language to check it before it goes out.`] };
}

/** Everything the overview takes, for the sample event. */
export function sampleOverview() {
  const counts = { lunch_slots: 3, shifts: 9, shifts_empty: 1, checklist_overdue: 1, checklist_open: 5 };
  return {
    name: EVENT.name,
    status: { label: "RSVP open", tone: "ok" as const },
    facts: [eventWhenLine(EVENT.starts_at, SAMPLE_COMMUNITY.time_zone, "en-US"), EVENT.venue, "capacity 300", "Lead: Mariana Souza"].join(" · "),
    tabs: workspaceTabs(SAMPLE_EVENT_ID, "overview"),
    more: [
      { label: "Details", href: workspaceHref(SAMPLE_EVENT_ID, "details"), current: false },
      { label: "Checklist", href: workspaceHref(SAMPLE_EVENT_ID, "checklist"), current: false },
      { label: "Report", href: workspaceHref(SAMPLE_EVENT_ID, "report"), current: false },
    ],
    event: { id: SAMPLE_EVENT_ID, name: EVENT.name },
    community: { name: SAMPLE_COMMUNITY.name },
    summary: { ok: true as const, data: SUMMARY },
    readiness: { ok: true as const, data: eventReadiness(EVENT, counts, "event_day", NOW, SAMPLE_COMMUNITY.time_zone) },
    checklist: { ok: true as const, data: CHECKLIST },
    audience: { ok: true as const, data: AUDIENCE },
    drafts: { ok: true as const, data: drafts() },
    households: { ok: true as const, data: { total: 104, cards: HOUSEHOLDS } },
    cannot: { change: null, clone: null },
    switches: { setField: false, createFromClone: false },
    today: TODAY,
    cloneDate: sameDayNextYear("2026-11-07", TODAY),
    links: { rsvps: workspaceHref(SAMPLE_EVENT_ID, "rsvps"), checklist: workspaceHref(SAMPLE_EVENT_ID, "checklist"), builder: "/events/builder", newEvent: "/events/builder", newsletters: "/comms/newsletters" },
  };
}

/** A signed-in owner of the sample club, so the shell's rail shows every workspace. No database behind it. */
export function sampleSession(): CrmSession {
  return {
    db: null as unknown as CrmSession["db"],
    userId: "sample-user",
    email: "mariana@example.org",
    center: {
      id: "sample-center",
      slug: "lakeside",
      name: SAMPLE_COMMUNITY.name,
      short_name: SAMPLE_COMMUNITY.short_name,
      time_zone: SAMPLE_COMMUNITY.time_zone,
      country: SAMPLE_COMMUNITY.country,
      currency: "USD",
      branding: {},
      feature_flags: {},
      rules: {},
      status: "active",
      environment: "production",
    },
    person: { id: "p-lead", name: "Mariana Souza", memberNumber: "0007" },
    permissions: ["people.view", "people.manage", "giving.view", "events.view", "events.manage", "comms.view", "comms.send", "reports.view", "settings.manage"],
    isPlatformAdmin: false,
    isOwner: true,
    roles: [{ key: "owner", name: "Owner", scopeKind: "center" }],
    grants: [],
    requestId: "sample",
    modulesOff: [],
    modulesStatus: "ok",
    kind: NEUTRAL_KIND,
    kindStatus: "ok",
    aal: "aal2",
    amr: null,
    centerSource: "default",
    switchable: [],
  };
}
