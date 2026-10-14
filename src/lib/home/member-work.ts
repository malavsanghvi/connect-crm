// Home card "Your work is in the member app" (docs/DEMO_ROLE_WORK.md): for a person who holds no staff queue and no module
// screen (the family roles: community member, membership reference, primary adult, adult member, child), Home says where their
// work is and counts what waits for them there, with the same reads the member app makes (connect-mobile: i_am_adult,
// my_membership_application, my_reference_requests, the household's open pledges, its RSVPs, the notices).
// Every count is a plain sentence; none names a household or a person. A read that failed is a line that says so, never a zero.
// Pure: the reads are in src/lib/data/home-cards.ts.

import { formatCents } from "@/lib/money";
import { isModuleEnabled, type ModuleContext } from "@/lib/modules";
import { visibleNav, type ScopedContext } from "@/lib/permissions";
import { plural, visibleTaskSources } from "@/lib/tasks";

import { problemSentence, type Read } from "./read";

/** A person who holds no staff queue and no module screen: the portal gives them Home and nothing else. */
export function holdsNoStaffWork(ctx: ScopedContext): boolean {
  return visibleTaskSources(ctx).length === 0 && visibleNav(ctx).every((m) => m.key === "home");
}

/**
 * The member app's address as the portal knows it (NEXT_PUBLIC_MEMBER_APP_URL, docs/DEPLOY.md "Member addresses"), or null when
 * it is not set or is not an http(s) address: a card never shows a link that goes nowhere.
 */
export function memberAppLink(base: string | null | undefined): string | null {
  const b = (base ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^\s/?#]+(?:\/[^\s?#]*)?$/i.test(b) ? b : null;
}

// ---------------------------------------------------------------------------
// What the loader reads, shaped
// ---------------------------------------------------------------------------

/** The household's open pledges (status open or partially paid), as the member app's Give tab counts them. */
export type OpenPledges = { count: number; leftCents: number; /** For a single pledge: how much of it has been paid. */ paidCents: number };

/** Upcoming events the person can see; for an adult, how many the household RSVPd to and how many are open to RSVP to. */
export type EventsSummary = { upcoming: number; going: number; open: number };

export type MemberWorkData = {
  /** The login is linked to a person of this community. */
  linked: boolean;
  /** app.i_am_adult, the rule row level security uses for money and RSVPs. */
  adult: Read<boolean>;
  /** null: not asked (a child, an unknown age, or the module is off). */
  application: Read<{ status: string } | null> | null;
  vouch: Read<number> | null;
  pledges: Read<OpenPledges> | null;
  events: Read<EventsSummary> | null;
  notices: Read<number> | null;
};

export function summarizePledges(rows: readonly { amount_cents: number; paid_cents: number }[]): OpenPledges {
  const left = rows.map((r) => Math.max(0, r.amount_cents - r.paid_cents));
  return { count: rows.length, leftCents: left.reduce((a, b) => a + b, 0), paidCents: rows.length === 1 ? Math.max(0, rows[0].paid_cents) : 0 };
}

/** RSVPs that mean "the household is coming" and RSVPs that mean the household already answered (including a waiting list or an invitation). */
const GOING = ["rsvpd", "confirmed"];
const ANSWERED = [...GOING, "waitlisted", "invited", "attended"];

export function summarizeEvents(events: readonly { id: string; status: string }[], rsvps: readonly { event_id: string; status: string }[]): EventsSummary {
  const going = new Set<string>();
  const answered = new Set<string>();
  for (const r of rsvps) {
    if (GOING.includes(r.status)) going.add(r.event_id);
    if (ANSWERED.includes(r.status)) answered.add(r.event_id);
  }
  const ids = new Set(events.map((e) => e.id));
  return {
    upcoming: events.length,
    going: [...going].filter((id) => ids.has(id)).length,
    open: events.filter((e) => e.status === "published" && !answered.has(e.id)).length,
  };
}

// ---------------------------------------------------------------------------
// Which reads to make for whom
// ---------------------------------------------------------------------------

export type MemberReads = { application: boolean; vouch: boolean; pledges: boolean; events: boolean; rsvps: boolean; notices: boolean };

/**
 * What to read for this person, from the answer to "am I an adult?" and the modules the community has on. Money, RSVPs and a
 * membership application are for adults (docs/ROLES.md "What families can do"); a child, or a person whose age could not be
 * checked, gets the events and the notices only.
 */
export function memberReads(adult: boolean | null, ctx: ModuleContext): MemberReads {
  const on = (m: string) => isModuleEnabled(ctx, m);
  const isAdult = adult === true;
  return {
    application: isAdult && on("membership"),
    vouch: isAdult && on("membership"),
    pledges: isAdult && on("giving"),
    events: on("events"),
    rsvps: isAdult && on("events"),
    notices: on("comms"),
  };
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export type MemberLine = { key: string; text: string };
export type MemberProblem = { key: string; text: string };

export type MemberWork = {
  /** unlinked: the login is not linked to a person here yet; work: at least one line; clear: nothing waits. */
  state: "unlinked" | "work" | "clear";
  /** false for a child; null when the age could not be checked. */
  adult: boolean | null;
  lines: MemberLine[];
  problems: MemberProblem[];
  link: string | null;
};

const APPLICATION_SENTENCE: Record<string, string> = {
  draft: "Your family's membership application is saved as a draft and has not been sent yet.",
  awaiting_reference: "Your family's membership application is waiting for your reference to answer.",
  reference_declined: "Your reference declined your family's membership application.",
  awaiting_center: "Your family's membership application is waiting for the membership team.",
  awaiting_ec: "Your family's membership application is waiting for its final approval.",
};

export function buildMemberWork(data: MemberWorkData, opts: { currency: string; memberAppUrl: string | null | undefined; locale?: string }): MemberWork {
  const link = memberAppLink(opts.memberAppUrl);
  const adult = data.adult.ok ? data.adult.value : null;
  if (!data.linked) return { state: "unlinked", adult: null, lines: [], problems: [], link };

  const lines: MemberLine[] = [];
  const problems: MemberProblem[] = [];
  const money = (cents: number) => formatCents(cents, opts.currency, opts.locale);
  const add = (key: string, text: string) => lines.push({ key, text });
  const fail = (key: string, what: string, r: Extract<Read<unknown>, { ok: false }>) => problems.push({ key, text: problemSentence(what, r.error) });

  if (!data.adult.ok) fail("adult", "check which parts of your family's work you can see", data.adult);

  // Money, RSVPs and a membership application are for adults (docs/ROLES.md): even if a caller hands over such data for a child, none of it is shown.
  if (data.application && adult === true) {
    if (!data.application.ok) fail("application", "load your family's membership application", data.application);
    else {
      const sentence = data.application.value ? APPLICATION_SENTENCE[data.application.value.status] : undefined;
      if (sentence) add("application", sentence);
    }
  }

  if (data.vouch && adult === true) {
    if (!data.vouch.ok) fail("vouch", "load the requests to vouch for an applicant", data.vouch);
    else if (data.vouch.value > 0) {
      const n = data.vouch.value;
      add("vouch", n === 1 ? "1 person has asked you to vouch for their membership application." : `${plural(n, "person", "people")} have asked you to vouch for their membership applications.`);
    }
  }

  if (data.pledges && adult === true) {
    if (!data.pledges.ok) fail("pledges", "load your family's open pledges", data.pledges);
    else {
      const p = data.pledges.value;
      if (p.count === 1) add("pledges", p.paidCents > 0 ? `A pledge with ${money(p.leftCents)} left to pay is open.` : `A pledge of ${money(p.leftCents)} is open.`);
      else if (p.count > 1) add("pledges", `${p.count.toLocaleString("en-US")} pledges are open, with ${money(p.leftCents)} left to pay in all.`);
    }
  }

  if (data.events) {
    if (!data.events.ok) fail("events", adult === true ? "load your family's RSVPs and the upcoming events" : "load the upcoming events", data.events);
    else {
      const e = data.events.value;
      if (adult === true) {
        if (e.going > 0) add("going", `Your family has RSVPd to ${plural(e.going, "upcoming event")}.`);
        if (e.open > 0) add("open", `${plural(e.open, "upcoming event")} ${e.open === 1 ? "is" : "are"} open for your family to RSVP to.`);
      } else if (e.upcoming > 0) {
        add("events", `${plural(e.upcoming, "upcoming event")} to see.`);
      }
    }
  }

  if (data.notices) {
    if (!data.notices.ok) fail("notices", "load the notices", data.notices);
    else if (data.notices.value > 0) add("notices", `Your community has posted ${plural(data.notices.value, "notice")}.`);
  }

  return { state: lines.length > 0 || problems.length > 0 ? "work" : "clear", adult, lines, problems, link };
}

/** What the card says under its title: the child's is about events and notices only. */
export function memberWorkIntro(adult: boolean | null): string {
  return adult === false
    ? "Events and notices are in the member app. This is what is waiting for you there."
    : "Your family's pledges, RSVPs, membership and notices are in the member app. This is what is waiting for you there.";
}

/** Said when there is no link: the portal does not know the member app's address. */
export const NO_MEMBER_APP_LINK = "There is no link here yet because the member app's address has not been set up for this community. Ask your community's office for it.";
