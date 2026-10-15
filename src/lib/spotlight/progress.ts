// What this browser remembers about tours, per signed-in person (prototype: localStorage, no database; docs/SPOTLIGHT.md says how the
// next version stores it per person). Pure: it only turns strings into progress and progress into strings. The storage itself
// (which can throw, or be empty, in a private window) is in store.ts.

import type { TourDef, TourStatus } from "./types";

export type TourRecord = { status: TourStatus; at: string };

export type Progress = {
  /** "Don't show tours again": no invitation is shown anywhere. The person can still turn tours back on from the Tour menu. */
  off: boolean;
  tours: Record<string, TourRecord>;
};

const STATUSES: readonly TourStatus[] = ["not_started", "seen", "completed", "dismissed"];

/** One entry per browser and signed-in person. */
export function progressKey(userId: string): string {
  return `weaver.spotlight.v1:${userId}`;
}

export function emptyProgress(): Progress {
  return { off: false, tours: {} };
}

/** Reads what storage held. Anything unreadable is "nothing remembered", never an error that stops a page. */
export function parseProgress(raw: string | null | undefined): Progress {
  if (!raw) return emptyProgress();
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return emptyProgress();
    const o = v as { off?: unknown; tours?: unknown };
    const tours: Record<string, TourRecord> = {};
    if (o.tours && typeof o.tours === "object" && !Array.isArray(o.tours)) {
      for (const [id, rec] of Object.entries(o.tours as Record<string, unknown>)) {
        const r = rec as { status?: unknown; at?: unknown } | null;
        const status = STATUSES.find((s) => s === r?.status);
        if (status) tours[id] = { status, at: typeof r?.at === "string" ? r.at : "" };
      }
    }
    return { off: o.off === true, tours };
  } catch {
    return emptyProgress();
  }
}

export function serializeProgress(p: Progress): string {
  return JSON.stringify(p);
}

export function statusOf(p: Progress, tourId: string): TourStatus {
  return p.tours[tourId]?.status ?? "not_started";
}

/** Starting a tour marks it seen, unless the person already finished or dismissed it once (a replay keeps that). */
export function markSeen(p: Progress, tourId: string, now: Date): Progress {
  if (statusOf(p, tourId) !== "not_started") return p;
  return { ...p, tours: { ...p.tours, [tourId]: { status: "seen", at: now.toISOString() } } };
}

/** What is remembered when a running tour ends: finishing is completed; Skip tour, the X, Esc and Close (at any step) are dismissed. */
export function endedStatus(how: "completed" | "skipped"): "completed" | "dismissed" {
  return how === "skipped" ? "dismissed" : "completed";
}

/** The end of a tour, or "Not now" on its invitation: completed or dismissed. Either way the tour is never offered on its own again. */
export function markEnded(p: Progress, tourId: string, how: "completed" | "dismissed", now: Date): Progress {
  return { ...p, tours: { ...p.tours, [tourId]: { status: how, at: now.toISOString() } } };
}

export function withToursOff(p: Progress, off: boolean): Progress {
  return p.off === off ? p : { ...p, off };
}

/** The tours to invite this person to right now: none when they turned tours off, and only tours they have never started. */
export function invitedTours<T extends Pick<TourDef, "id">>(tours: readonly T[], p: Progress): T[] {
  if (p.off) return [];
  return tours.filter((t) => statusOf(p, t.id) === "not_started");
}

/** Whether the invitations that are not tied to a tour of their own (the demo banner's link) may show. */
export function invitationsOn(p: Progress): boolean {
  return !p.off;
}
