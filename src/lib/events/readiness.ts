// What is stopping this event from going live? Pure: the command events.readiness (the palette and Niva) reads the event and a few
// counts, and this says what is missing, in plain sentences. Two goals:
//   "publish"    open the event for RSVPs in the member app (draft -> published). Blockers are what the builder refuses or what would make
//                the event wrong the moment members see it.
//   "event_day"  turn on check-in (published or RSVPs closed -> live). Blockers are what would stop the day from running.
// A "blocker" should be fixed first. A "check" is worth a look and does not stop anything.

import { formatDateTime } from "@/lib/events/format";

export type ReadinessGoal = "publish" | "event_day";

export type ReadinessEvent = {
  name: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  venue: string | null;
  description: string | null;
  capacity: number | null;
  rsvp_opens_at: string | null;
  rsvp_closes_at: string | null;
  lunch_enabled: boolean;
  lunch_starts_at: string | null;
  is_paid: boolean;
  member_price_cents: number | null;
  guest_price_cents: number | null;
  audience: string;
  owner_person_id: string | null;
  flyer_path: string | null;
};

export type ReadinessCounts = {
  lunch_slots: number;
  shifts: number;
  /** Shifts nobody is assigned to; null when the person's role cannot see assignments. */
  shifts_empty: number | null;
  checklist_overdue: number;
  checklist_open: number;
};

export type ReadinessIssue = { code: string; text: string; fix: string };

export type Readiness = {
  goal: ReadinessGoal;
  ready: boolean;
  blockers: ReadinessIssue[];
  checks: ReadinessIssue[];
  /** One sentence for the top of the answer. */
  summary: string;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function eventReadiness(event: ReadinessEvent, counts: ReadinessCounts, goal: ReadinessGoal, now: Date, tz: string): Readiness {
  const blockers: ReadinessIssue[] = [];
  const checks: ReadinessIssue[] = [];
  const block = (code: string, text: string, fix: string) => blockers.push({ code, text, fix });
  const check = (code: string, text: string, fix: string) => checks.push({ code, text, fix });
  const starts = event.starts_at ? Date.parse(event.starts_at) : null;
  const t = now.getTime();

  // Where the event is in its life decides whether this goal can apply at all.
  if (event.status === "cancelled") block("cancelled", `${event.name} is cancelled.`, "Restore it as a draft first, then it can be published again.");
  else if (event.status === "completed") block("completed", `${event.name} is already completed.`, "Nothing more is needed. A completed event can be reopened as live if it has to be.");
  else if (goal === "publish" && event.status !== "draft") {
    check("already_published", `${event.name} is already ${event.status === "live" ? "live" : "published"}.`, "Nothing to do; this list is what a published event still needs.");
  } else if (goal === "event_day" && event.status === "draft") {
    block("not_published", `${event.name} is still a draft.`, "Publish it first, then go live on the day.");
  } else if (goal === "event_day" && event.status === "live") {
    check("already_live", `${event.name} is already live.`, "Check-in is open.");
  }

  // The same rules the builder applies when it publishes.
  if (starts === null) block("no_start", "It has no start date and time.", "Set when it starts in the event builder.");
  else {
    if (goal === "publish" && event.status === "draft" && starts < t) block("start_passed", `The start time (${formatDateTime(event.starts_at, tz)}) has already passed.`, "Move the date to when it will really happen.");
    if (goal === "event_day" && starts - t > 3 * 24 * 3_600_000) check("not_soon", `It starts ${formatDateTime(event.starts_at, tz)}, which is more than three days away.`, "Going live is for the day itself: check-in opens right away.");
  }
  if (starts !== null && event.ends_at && Date.parse(event.ends_at) <= starts) block("ends_before_start", "It is set to end before it starts.", "Change the end time.");
  if (event.rsvp_opens_at && event.rsvp_closes_at && Date.parse(event.rsvp_closes_at) <= Date.parse(event.rsvp_opens_at)) {
    block("rsvp_window", "RSVPs are set to close before they open.", "Fix the RSVP dates in the event builder.");
  }
  if (goal === "publish" && event.status === "draft" && event.rsvp_closes_at && Date.parse(event.rsvp_closes_at) < t) {
    block("rsvp_closed_already", `RSVPs are set to close on ${formatDateTime(event.rsvp_closes_at, tz)}, which has passed.`, "Change when RSVPs close, or clear it.");
  }
  if (event.lunch_enabled && !event.lunch_starts_at) block("lunch_time", "Lunch is switched on but has no start time.", "Set when lunch starts, or turn lunch off.");
  if (event.is_paid && event.member_price_cents === null) block("price", "It is a paid event with no member price.", "Enter the price, or make the event free.");

  if (goal === "event_day") {
    if (event.lunch_enabled && counts.lunch_slots === 0) block("no_slots", "Lunch is on but no lunch slots have been created.", "Create the slots on the event's Lunch tab.");
  } else if (event.lunch_enabled && counts.lunch_slots === 0 && event.lunch_starts_at) {
    check("no_slots", "Lunch is on but no lunch slots exist yet.", "Create them on the event's Lunch tab once the times are final.");
  }

  // Worth a look, never a stop.
  if (!event.venue) check("no_venue", "No venue is set.", "Add where it is, so families know where to go.");
  if (!event.description) check("no_description", "There is no description.", "Add a line or two about the event.");
  if (event.capacity === null) check("no_capacity", "There is no capacity limit.", "Set one if the room is limited, or leave it open.");
  if (!event.owner_person_id) check("no_lead", "Nobody is named as the lead.", "Choose who is in charge.");
  if (!event.flyer_path && goal === "publish") check("no_flyer", "There is no flyer yet.", "Add one on the builder's flyer panel.");
  if (event.is_paid && event.guest_price_cents === null && event.audience !== "members_only" && event.audience !== "life_members_only") {
    check("guest_price", "Guests can RSVP but there is no guest price.", "Enter a guest price, or limit it to members.");
  }
  if (counts.shifts_empty !== null && counts.shifts_empty > 0) check("empty_shifts", `${plural(counts.shifts_empty, "volunteer shift")} ${counts.shifts_empty === 1 ? "has" : "have"} nobody assigned.`, "Assign volunteers on the Volunteers tab.");
  if (counts.checklist_overdue > 0) check("overdue", `${plural(counts.checklist_overdue, "checklist action")} ${counts.checklist_overdue === 1 ? "is" : "are"} overdue.`, "Open the Checklist tab.");
  else if (goal === "event_day" && counts.checklist_open > 0) check("open_actions", `${plural(counts.checklist_open, "checklist action")} still open.`, "Open the Checklist tab.");

  const ready = blockers.length === 0;
  const what = goal === "publish" ? "published" : "taken live";
  const summary = ready
    ? checks.length > 0
      ? `Nothing is blocking ${event.name} from being ${what}. ${plural(checks.length, "thing")} worth a look.`
      : `Nothing is blocking ${event.name} from being ${what}.`
    : `${plural(blockers.length, "thing")} to fix before ${event.name} can be ${what}.`;
  return { goal, ready, blockers, checks, summary };
}
