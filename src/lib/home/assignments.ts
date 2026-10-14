// Home card "My assignments" (docs/DEMO_ROLE_WORK.md): the events, classes and zones a person holds a role for, one line each, with
// the pages that role can open. The portal's permission set ignores these grants (computePermissions counts only whole-community
// ones), so without this card an event lead, a check-in volunteer, a boli recorder, a class teacher or a zone lead finds nothing
// of theirs on Home. Every link is one the page behind it will honour (the same checks as the pages: eventAreas, pathshalaAreas,
// the inbox rule), so none is a dead end; a number shown is one the person's own reads returned, and a read that failed is a line
// that says so. Pure: the reads are in src/lib/data/home-cards.ts.

import { eventAreas, type EventAccess } from "@/lib/events/access";
import { formatDateTime } from "@/lib/events/format";
import { eventStatusLabel } from "@/lib/events/status";
import { isModuleEnabled, type ModuleContext } from "@/lib/modules";
import { pathshalaAreas } from "@/lib/pathshala/access";
import { classTimeLabel } from "@/lib/pathshala/format";
import { can, canAccess, hasScopedRole, passesRoleChecks, type ScopedContext } from "@/lib/permissions";
import { plural } from "@/lib/tasks";

import { problemSentence, type Read } from "./read";

export type AssignmentKind = "event" | "class" | "zone";

/** The roles a person holds for one event, class or zone. */
export type Assignment = { kind: AssignmentKind; scopeId: string; roleKeys: string[] };

/** The module that owns each kind of assignment: a community that switched it off has nothing to show for it. */
const KIND_MODULE: Record<AssignmentKind, string> = { event: "events", class: "pathshala", zone: "comms" };

/**
 * One entry per event, class or zone the person holds a role for, with all the roles they hold for it. Whole-community grants are
 * not here (the permission set already covers them), nor are the older "store" and "pathshala" scopes the Roles screen no longer
 * offers. `grants` are the session's active grants.
 */
export function scopedAssignments(grants: readonly { role_key: string; scope_kind: string; scope_id: string | null }[], modules: ModuleContext = {}): Assignment[] {
  const by = new Map<string, Assignment>();
  for (const g of grants) {
    if ((g.scope_kind !== "event" && g.scope_kind !== "class" && g.scope_kind !== "zone") || !g.scope_id) continue;
    const kind = g.scope_kind;
    if (!isModuleEnabled(modules, KIND_MODULE[kind])) continue;
    const key = `${kind}:${g.scope_id}`;
    const have = by.get(key);
    if (!have) by.set(key, { kind, scopeId: g.scope_id, roleKeys: [g.role_key] });
    else if (!have.roleKeys.includes(g.role_key)) have.roleKeys.push(g.role_key);
  }
  return [...by.values()];
}

// ---------------------------------------------------------------------------
// What the loader reads
// ---------------------------------------------------------------------------
export type EventFact = { name: string; status: string; starts_at: string | null; ends_at: string | null; venue: string | null };
export type ClassFact = { name: string; meets_on: string; starts_time: string | null; room: string | null };
export type ZoneFact = { name: string };
/** app.event_live_stats: people on RSVPs (walk-ins excluded), people on confirmed RSVPs, people checked in. */
export type EventNumbers = { rsvpPeople: number; confirmed: number; checkedIn: number };

export type AssignmentFacts = {
  /** null: none of this kind to look up. */
  events: Read<ReadonlyMap<string, EventFact>> | null;
  classes: Read<ReadonlyMap<string, ClassFact>> | null;
  zones: Read<ReadonlyMap<string, ZoneFact>> | null;
  /** Live numbers for the events this person may count (see eventsToCount); an event missing here is not counted. */
  numbers: ReadonlyMap<string, Read<EventNumbers>>;
  /** Open conversations in each zone's inbox; null when none was asked. */
  zoneOpen: Read<ReadonlyMap<string, number>> | null;
};

const EPOCH = "1970-01-01T00:00:00Z";

/** The event checks (src/lib/events/access.ts) over the session. Its grants are already active, so each starts at the epoch. */
export function eventAccessOf(ctx: ScopedContext): EventAccess {
  return {
    permissions: ctx.permissions,
    isPlatformAdmin: ctx.isPlatformAdmin,
    isOwner: ctx.isOwner,
    grants: (ctx.grants ?? []).map((g) => ({ role_key: g.role_key, scope_kind: g.scope_kind, scope_id: g.scope_id, starts_at: EPOCH, ends_at: null })),
  };
}

/** Event statuses whose numbers are worth counting: not a draft, not cancelled, not finished. */
const COUNTED_STATUS = ["published", "rsvp_closed", "live"];

/** May this person see an event's live numbers? The database's own rule (app.can_see_event_ops): the event's lead, check-in or kitchen role, or events staff. */
export function canSeeEventNumbers(ctx: ScopedContext, eventId: string): boolean {
  return hasScopedRole(ctx, eventId, "event_lead", "checkin_volunteer", "kitchen_lead") || can(ctx, ["events.view", "events.manage"]);
}

/** The events to ask for live numbers: ones this person may count, still ahead of or in progress, at most `limit`. */
export function eventsToCount(ctx: ScopedContext, assignments: readonly Assignment[], events: ReadonlyMap<string, EventFact>, limit = 8): string[] {
  return assignments
    .filter((a) => a.kind === "event" && canSeeEventNumbers(ctx, a.scopeId) && COUNTED_STATUS.includes(events.get(a.scopeId)?.status ?? ""))
    .map((a) => a.scopeId)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------
export type AssignmentLink = { label: string; href: string };

export type AssignmentLine = {
  key: string;
  kind: AssignmentKind;
  scopeId: string;
  title: string;
  /** The roles held for it, in the community's words ("Event lead"). */
  roles: string[];
  /** When it is, where it is. */
  detail: string | null;
  /** An event's state when it is not simply open for RSVPs: "Draft", "Live", "Completed", "Cancelled". */
  status: string | null;
  /** The numbers a read returned, as a sentence. */
  numbers: string | null;
  links: AssignmentLink[];
  /** Said when nothing here opens for this role. */
  note: string | null;
  /** A read for this line failed: the sentence that says so. */
  problem: string | null;
};

export type AssignmentsCard = { lines: AssignmentLine[]; /** Assignments past the limit, not listed. */ more: number };

export const MAX_ASSIGNMENT_LINES = 20;

function humanize(key: string): string {
  const s = key.replace(/[_-]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : key;
}

function eventLinks(ctx: ScopedContext, id: string): AssignmentLink[] {
  const a = eventAccessOf(ctx);
  const out: AssignmentLink[] = [];
  if (eventAreas.event(a, id)) out.push({ label: "Open the event", href: `/events/${id}` });
  if (eventAreas.checkIn(a, id)) out.push({ label: "Check-in screen", href: `/ops/${id}/checkin` });
  if (eventAreas.kitchen(a, id)) out.push({ label: "Kitchen display", href: `/ops/${id}/kitchen` });
  // The live dashboard is for the events staff (events.view or events.manage), not for one event's lead.
  if (canAccess(ctx, "events")) out.push({ label: "Live check-in", href: `/events/live?event=${id}` });
  return out;
}

function eventLine(a: Assignment, ctx: ScopedContext, facts: AssignmentFacts, tz: string, roles: string[]): AssignmentLine {
  const base: AssignmentLine = { key: `event:${a.scopeId}`, kind: "event", scopeId: a.scopeId, title: "An event", roles, detail: null, status: null, numbers: null, links: [], note: null, problem: null };
  const read = facts.events;
  if (read && !read.ok) return { ...base, links: eventLinks(ctx, a.scopeId), problem: problemSentence("load this event", read.error) };
  const fact = read?.ok ? read.value.get(a.scopeId) : undefined;
  if (!fact) return { ...base, note: "This event could not be found. It may have been removed, or your role may not let you see it." };
  const label = eventStatusLabel(fact.status).label;
  const links = eventLinks(ctx, a.scopeId);
  const line: AssignmentLine = {
    ...base,
    title: fact.name,
    detail: [fact.starts_at ? formatDateTime(fact.starts_at, tz) : "No date yet", fact.venue].filter(Boolean).join(" · "),
    status: fact.status === "published" ? null : label,
    links,
    note: links.length === 0 ? "Your part of this event is done in the event-day app, not in this portal." : null,
  };
  const n = facts.numbers.get(a.scopeId);
  if (n?.ok) {
    line.numbers = `${plural(n.value.rsvpPeople, "person", "people")} on RSVPs · ${n.value.confirmed.toLocaleString("en-US")} confirmed · ${n.value.checkedIn.toLocaleString("en-US")} checked in`;
  } else if (n) {
    line.problem = problemSentence("count the people for this event", n.error);
  }
  return line;
}

function classLine(a: Assignment, ctx: ScopedContext, facts: AssignmentFacts, roles: string[]): AssignmentLine {
  const base: AssignmentLine = { key: `class:${a.scopeId}`, kind: "class", scopeId: a.scopeId, title: "A class", roles, detail: null, status: null, numbers: null, links: [], note: null, problem: null };
  const links: AssignmentLink[] = [];
  if (pathshalaAreas.classView(ctx, a.scopeId)) links.push({ label: "Open the class", href: `/pathshala/classes/${a.scopeId}` });
  if (pathshalaAreas.takeAttendance(ctx, a.scopeId)) links.push({ label: "Take attendance", href: `/pathshala/classes/${a.scopeId}/attendance` });
  const read = facts.classes;
  if (read && !read.ok) return { ...base, links, problem: problemSentence("load this class", read.error) };
  const fact = read?.ok ? read.value.get(a.scopeId) : undefined;
  if (!fact) return { ...base, note: "This class could not be found. It may have been removed, or your role may not let you see it." };
  return {
    ...base,
    title: fact.name,
    detail: [classTimeLabel(fact.meets_on, fact.starts_time), fact.room].filter((x) => x && x !== "—").join(" · ") || null,
    links,
    note: links.length === 0 ? "Nothing to open in the portal for this role." : null,
  };
}

function zoneLine(a: Assignment, ctx: ScopedContext, facts: AssignmentFacts, roles: string[]): AssignmentLine {
  const base: AssignmentLine = { key: `zone:${a.scopeId}`, kind: "zone", scopeId: a.scopeId, title: "A zone", roles, detail: null, status: null, numbers: null, links: [], note: null, problem: null };
  // The inbox lets in a zone lead (any scope) and whoever holds comms.inbox, as its page does.
  const opens = a.roleKeys.includes("zone_lead") || can(ctx, "comms.inbox") || passesRoleChecks(ctx);
  const links = opens ? [{ label: "Open the zone inbox", href: "/comms/inbox" }] : [];
  const read = facts.zones;
  if (read && !read.ok) return { ...base, links, problem: problemSentence("load this zone", read.error) };
  const fact = read?.ok ? read.value.get(a.scopeId) : undefined;
  if (!fact) return { ...base, note: "This zone could not be found. It may have been removed, or your role may not let you see it." };
  const line: AssignmentLine = {
    ...base,
    title: /\bzone$/i.test(fact.name.trim()) ? fact.name.trim() : `${fact.name.trim()} zone`,
    links,
    note: links.length === 0 ? "Nothing to open in the portal for this role." : null,
  };
  const open = facts.zoneOpen;
  if (open && !open.ok) line.problem = problemSentence("count the open conversations in this zone's inbox", open.error);
  else if (open?.ok) {
    const n = open.value.get(a.scopeId);
    if (n !== undefined) line.numbers = `${plural(n, "open conversation")} in the zone's inbox`;
  }
  return line;
}

/** Sort key for an event: ahead of or in progress first (soonest first), then undated, then past (latest first). */
function eventOrder(fact: EventFact | undefined, now: Date): [number, number] {
  if (!fact?.starts_at) return [1, 0];
  const start = Date.parse(fact.starts_at);
  const end = fact.ends_at ? Date.parse(fact.ends_at) : start;
  if (fact.status === "live" || end >= now.getTime()) return [0, start];
  return [2, -start];
}

/**
 * The lines of the card, events first (soonest first), then classes, then zones. `roleNames` are the community's names for the
 * roles (the session's roles). Past the limit the rest are counted, not dropped silently.
 */
export function buildAssignments(
  ctx: ScopedContext,
  assignments: readonly Assignment[],
  facts: AssignmentFacts,
  opts: { timeZone: string; roleNames: ReadonlyMap<string, string>; now?: Date; limit?: number },
): AssignmentsCard {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? MAX_ASSIGNMENT_LINES;
  const names = (a: Assignment) => a.roleKeys.map((k) => opts.roleNames.get(k) ?? humanize(k));
  const events = facts.events?.ok ? facts.events.value : undefined;

  const ordered = [...assignments].sort((x, y) => {
    const rank = (a: Assignment) => (a.kind === "event" ? 0 : a.kind === "class" ? 1 : 2);
    if (rank(x) !== rank(y)) return rank(x) - rank(y);
    if (x.kind === "event") {
      const [gx, tx] = eventOrder(events?.get(x.scopeId), now);
      const [gy, ty] = eventOrder(events?.get(y.scopeId), now);
      return gx - gy || tx - ty;
    }
    return 0;
  });

  const lines = ordered.map((a) =>
    a.kind === "event" ? eventLine(a, ctx, facts, opts.timeZone, names(a)) : a.kind === "class" ? classLine(a, ctx, facts, names(a)) : zoneLine(a, ctx, facts, names(a)),
  );
  return { lines: lines.slice(0, limit), more: Math.max(0, lines.length - limit) };
}
