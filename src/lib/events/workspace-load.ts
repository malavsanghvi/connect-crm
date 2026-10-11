import "server-only";

import { ensureCatalog } from "@/lib/commands/catalog";
import type { DraftReminderData } from "@/lib/commands/catalog/messages-draft-reminder";
import type { AudiencePreviewData } from "@/lib/commands/catalog/events/audience";
import type { RsvpListData } from "@/lib/commands/catalog/events/rsvps";
import { createCommandContext } from "@/lib/commands/context";
import { commandAvailability, isCommandEnabled } from "@/lib/commands/enabled";
import { getCommand } from "@/lib/commands/registry";
import { CommandDbError, CommandError } from "@/lib/commands/types";
import type { Tables } from "@/lib/database.types";
import { todayInTz } from "@/lib/dates";
import { failure } from "@/lib/errors";
import { eventReadiness, type Readiness } from "@/lib/events/readiness";
import { parseEventSummary, type EventSummary } from "@/lib/events/summary";
import { readinessGoalFor, type ChecklistRow, type Piece, type WorkspaceHouseholds } from "@/lib/events/workspace";

export type { Piece, WorkspaceHouseholds };
import type { CrmSession } from "@/lib/session";


export type WorkspaceData = {
  summary: Piece<EventSummary>;
  readiness: Piece<Readiness>;
  audience: Piece<AudiencePreviewData>;
  drafts: Piece<DraftReminderData>;
  /** Two households in the reminder's audience, as cards (adults only), and how many there are. */
  households: Piece<WorkspaceHouseholds>;
  checklist: Piece<ChecklistRow[]>;
  /** Why "change one thing" and "copy to a new date" cannot be prepared by this person (null when they can). */
  cannot: { change: string | null; clone: string | null };
  /** The confirm-level commands behind them, as this community has them switched (off unless it ticked them). */
  switches: { setField: boolean; createFromClone: boolean };
};

/** The RSVP statuses a reminder goes to (events.audience_preview's "reminder"). */
const IN_AUDIENCE = new Set(["rsvpd", "confirmed"]);

function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

/**
 * Run one read or draft command for a page, as the signed-in person: the same `execute` the palette, Niva and the screens use, with
 * the same permission and module checks. A problem comes back as the command's own sentence; a database failure is logged and
 * explained by failure(). Confirm-level commands are never run from here (they only ever become a card to confirm).
 */
export async function runForPage<O>(session: CrmSession, key: string, input: unknown): Promise<Piece<O>> {
  ensureCatalog();
  const cmd = getCommand(key);
  if (!cmd?.execute || cmd.level === "confirm" || cmd.level === "only_you") return { ok: false, error: `Weaver does not have a page action called "${key}".` };
  const available = commandAvailability(cmd, session, "screen");
  if (!available.ok) return { ok: false, error: available.error };
  const parsed = cmd.input.parse(input);
  if (!parsed.ok) return { ok: false, error: `Could not ${lowerFirst(cmd.title)} — ${lowerFirst(parsed.error)}` };
  try {
    const ctx = await createCommandContext(session, "screen");
    const res = await cmd.execute(ctx, parsed.value);
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, data: res.data as O };
  } catch (error) {
    if (error instanceof CommandError) return { ok: false, error: error.message };
    if (error instanceof CommandDbError) return failure(`Could not ${error.doing}`, error.dbError);
    return failure(`Could not ${lowerFirst(cmd.title)}`, error);
  }
}

function cannot(session: CrmSession, key: string): string | null {
  const cmd = getCommand(key);
  if (!cmd) return `Weaver does not have an action called "${key}".`;
  const available = commandAvailability(cmd, session, "screen");
  return available.ok ? null : available.error;
}

function switchedOn(session: CrmSession, key: string): boolean {
  const cmd = getCommand(key);
  return cmd ? isCommandEnabled(cmd, session.center.rules) : false;
}

async function loadSummary(session: CrmSession, eventId: string): Promise<Piece<EventSummary>> {
  try {
    const res = await session.db.rpc("event_summary", { p_event: eventId });
    if (res.error) return failure("Could not read the event's numbers", res.error);
    const s = parseEventSummary(res.data);
    return s ? { ok: true, data: s } : { ok: false, error: "Could not read the event's numbers — the answer was not understood. Reload to try again." };
  } catch (error) {
    return failure("Could not read the event's numbers", error);
  }
}

async function loadChecklist(session: CrmSession, eventId: string): Promise<Piece<ChecklistRow[]>> {
  try {
    const res = await session.db.from("actions").select("id, name, state, due_on").eq("event_id", eventId).neq("state", "removed").order("due_on", { nullsFirst: false }).limit(40);
    if (res.error) return failure("Could not read the checklist", res.error);
    return { ok: true, data: (res.data ?? []) as ChecklistRow[] };
  } catch (error) {
    return failure("Could not read the checklist", error);
  }
}

/**
 * Everything the overview needs, in parallel, each part on its own: one failing part says so on its card and the rest still show.
 * The readiness check is the one events.readiness runs (the same pure function on the same numbers), so the summary is read once.
 */
export async function loadEventWorkspace(session: CrmSession, event: Tables<"events">, now: Date = new Date()): Promise<WorkspaceData> {
  ensureCatalog();
  const tz = session.center.time_zone;
  const [summary, audience, drafts, rsvps, checklist] = await Promise.all([
    loadSummary(session, event.id),
    runForPage<AudiencePreviewData>(session, "events.audience_preview", { event_id: event.id, who: "reminder" }),
    runForPage<DraftReminderData>(session, "messages.draft_reminder", { event_id: event.id, kind: "event_reminder", language: "all" }),
    runForPage<RsvpListData>(session, "events.rsvps", { event_id: event.id, limit: 8 }),
    loadChecklist(session, event.id),
  ]);

  let readiness: Piece<Readiness>;
  if (summary.ok) {
    const s = summary.data;
    const counts = {
      lunch_slots: s.lunch.slots,
      shifts: s.volunteers.shifts,
      shifts_empty: s.volunteers.shifts_empty,
      checklist_overdue: s.checklist.overdue,
      checklist_open: s.checklist.in_progress + s.checklist.not_started,
    };
    readiness = { ok: true, data: eventReadiness(event, counts, readinessGoalFor(event.status), now, tz) };
  } else {
    readiness = { ok: false, error: "Could not check what is blocking this event, because its numbers could not be read. Reload to try again." };
  }

  const households: Piece<WorkspaceHouseholds> = rsvps.ok
    ? { ok: true, data: { total: summary.ok ? (summary.data.households.rsvpd ?? 0) + (summary.data.households.confirmed ?? 0) : rsvps.data.total, cards: rsvps.data.rsvps.flatMap((r) => (r.household && IN_AUDIENCE.has(r.status) ? [r.household] : [])).slice(0, 2) } }
    : rsvps;

  return {
    summary,
    readiness,
    audience,
    drafts,
    households,
    checklist,
    cannot: { change: cannot(session, "events.draft_change"), clone: cannot(session, "events.clone_draft") },
    switches: { setField: switchedOn(session, "events.set_field"), createFromClone: switchedOn(session, "events.create_from_clone") },
  };
}

/** Today in the community, for due dates on the checklist. */
export function communityToday(session: CrmSession, now: Date = new Date()): string {
  return todayInTz(session.center.time_zone, now);
}
