// Pieces the Content commands share: the sentences that explain a refusal, the permission check for the reads (the database answers
// null when the role may not read the queue or the library, and that is said, never shown as zeros), and the age words.

import { formatDateTime } from "@/lib/dates";
import { can } from "@/lib/permissions";

import { CommandError, type CommandContext } from "../../types";
import { ageHours, waitedWords } from "../messages/pure";
import type { ChildGuard } from "../messages/shared";

/** The reason a publish needs content.manage as well as content.approve (the database only lets managers change an item's status). */
export const NOT_A_MANAGER = "publishing also needs content.manage (the database only lets content managers change an item's status).";

/** Who may read the queue and the library: the people the database lets read waiting and draft items (row-level security). */
export function canReadContentQueue(ctx: CommandContext): boolean {
  return can(ctx.session, ["content.draft", "content.manage"]);
}

export function noContentAccess(what: string): CommandError {
  return new CommandError(`You don't have access to this area. ${what} needs the Content permission to draft or manage content.`);
}

export const NOTHING_PUBLISHED_BY_NIVA = "Niva only prepares this. Nothing is published until an approver approves it.";

/** "5 days", "3 hours": how long ago, in words. */
export function sinceWords(iso: string | null | undefined, now: Date): string {
  return iso ? waitedWords(ageHours(iso, now)) : "";
}

export function when(iso: string | null | undefined, tz: string): string | null {
  return iso ? formatDateTime(iso, tz) : null;
}

// ---------------------------------------------------------------------------
// D2 for the words in Content: titles, page names and album names are typed by people, so one may carry a child's given name.
// For Niva, every text that does is replaced by a plain line; a screen or the palette (the person's own hands) sees it unchanged.
// ---------------------------------------------------------------------------
export const WITHHELD_TEXT_FOR_CHILD = "This text names a child, so it is not shown here. Please read it on the screen.";

export function guardContent<T>(value: T, guard: ChildGuard): T {
  if (!guard.active) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return guard.mentions(v) ? WITHHELD_TEXT_FOR_CHILD : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}
