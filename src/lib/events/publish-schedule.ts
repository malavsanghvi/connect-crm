// The event creator's flyer and publish panel (2026-10-11): approving the flyer, publishing now or at a chosen time, and
// what each channel shows afterwards. Pure: the panel (client), its Server Actions and the tests share it.
//
// Channels. Weaver publishes to three places today and all three come from ONE change, the event's status moving from
// draft to published (setEventStatus / events.set_status): the member app (the event card with RSVP), the community
// calendar in the app, and the guest web page /e/<id> (the "website": shown only when guests may see the event). A
// scheduled publish is the same change made by the background service at the chosen time (job events.publish_due,
// migration 0700), which checks the event again first. Facebook and Instagram are shown as "Coming next": Weaver has no
// social posting yet (no tokens are stored and Meta is never called).
//
// Approval. A person approves the flyer before anything is published. The approval is kept where the design is kept,
// inside events.flyer_design under "approval" ({ v, at, by, name, key }), written in the same update that saves the
// flyer, so any later save of the flyer (the full flyer maker's "Use this flyer") drops it. It is stale when the event's
// name, date or venue changed after it (the flyer shows the old words), and "changed" when the panel's design is no
// longer the one approved.

import { flyerOutOfDate, outOfDateWhat, parseFlyerDesign, type FlyerDesign } from "./flyer";
import type { FlyerOccasion } from "./flyer-art";
import { formatDateTime, fromDateTimeLocal, toDateTimeLocal } from "./format";
import { eventReadiness, type ReadinessEvent } from "./readiness";

// ── Approval ─────────────────────────────────────────────────────────────────

export type FlyerApproval = { v: 1; at: string; by: string; name: string; key: string };

/** 32-bit FNV-1a, as 8 hex digits: a short, stable fingerprint (not a security measure). */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** A fingerprint of a design as the flyer maker would save it (parseFlyerDesign's tidy form), or "" for a design it refuses. */
export function flyerDesignKey(design: unknown): string {
  const parsed = parseFlyerDesign(design);
  return parsed.ok ? fnv1a(JSON.stringify(parsed.design)) : "";
}

/** The approval inside a saved flyer_design, read defensively; null when there is none. */
export function readFlyerApproval(rawDesign: unknown): FlyerApproval | null {
  const o = rawDesign && typeof rawDesign === "object" && !Array.isArray(rawDesign) ? (rawDesign as Record<string, unknown>).approval : null;
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const a = o as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  if (!str(a.at) || Number.isNaN(Date.parse(str(a.at)))) return null;
  return { v: 1, at: str(a.at), by: str(a.by), name: str(a.name), key: str(a.key) };
}

/** The approval the portal writes beside a design it saves. */
export function makeFlyerApproval(design: FlyerDesign, eventName: string, userId: string, now: Date = new Date()): FlyerApproval {
  return { v: 1, at: now.toISOString(), by: userId, name: eventName, key: flyerDesignKey(design) };
}

export type ApprovalEvent = { name: string; starts_at: string | null; ends_at: string | null; venue: string | null };

export type ApprovalState =
  | { state: "none" }
  | { state: "approved"; approval: FlyerApproval }
  /** The design on screen is not the one that was approved (the person switched template, size or art since). */
  | { state: "changed"; approval: FlyerApproval }
  /** The event's name, date or venue changed after the approval: the flyer shows the old words. */
  | { state: "stale"; approval: FlyerApproval; what: string };

/**
 * Where the flyer's approval stands. Approved only when the event's current flyer is a designed one with an approval, the
 * event still has the name, date and venue the flyer was made for, and (when `current` is given) the design on screen is
 * the one approved.
 */
export function approvalState(
  saved: { flyer_design: unknown; flyer_source: string | null; flyer_path: string | null },
  event: ApprovalEvent,
  current?: FlyerDesign | null,
): ApprovalState {
  const approval = readFlyerApproval(saved.flyer_design);
  if (!approval || saved.flyer_source !== "designed" || !saved.flyer_path) return { state: "none" };
  const parts: string[] = [];
  if (approval.name !== event.name) parts.push("name");
  const moved = outOfDateWhat(flyerOutOfDate(saved.flyer_design, event));
  if (moved) parts.push(moved);
  if (parts.length) return { state: "stale", approval, what: parts.join(" and ") };
  if (current && approval.key && flyerDesignKey(current) !== approval.key) return { state: "changed", approval };
  return { state: "approved", approval };
}

/** The sentence a refusal gives when the flyer is not (or no longer) approved; null when it is. */
export function approvalProblem(a: ApprovalState): string | null {
  switch (a.state) {
    case "approved":
      return null;
    case "none":
      return "Approve the flyer first. A person approves everything that goes out.";
    case "changed":
      return "You changed the flyer after approving it. Approve it again.";
    case "stale":
      return `The event's ${a.what} changed after the flyer was approved, so the flyer shows the old ${a.what}. Approve it again.`;
  }
}

// ── When to publish ──────────────────────────────────────────────────────────

/** The suggestion: this many days before the event, at this hour, in the community's time zone. */
export const SCHEDULE_DAYS_BEFORE = 10;
export const SCHEDULE_HOUR = 9;

function shiftDay(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

const at = (ymd: string, hour: number) => `${ymd}T${String(hour).padStart(2, "0")}:00`;

/**
 * The suggested publish time, as a datetime-local value in the community's zone: 10 days before the event at 9:00 am. When
 * that has passed, tomorrow at 9:00 am if that is still before the event; otherwise "" (publish now instead).
 */
export function suggestedPublishTime(startsAt: string | null, tz: string, now: Date = new Date()): string {
  const local = toDateTimeLocal(startsAt, tz);
  if (!local || !startsAt) return "";
  const start = Date.parse(startsAt);
  const first = at(shiftDay(local.slice(0, 10), -SCHEDULE_DAYS_BEFORE), SCHEDULE_HOUR);
  const firstIso = fromDateTimeLocal(first, tz);
  if (firstIso && Date.parse(firstIso) > now.getTime() && Date.parse(firstIso) < start) return first;
  const today = toDateTimeLocal(now.toISOString(), tz).slice(0, 10);
  const tomorrow = at(shiftDay(today, 1), SCHEDULE_HOUR);
  const tomorrowIso = fromDateTimeLocal(tomorrow, tz);
  if (tomorrowIso && Date.parse(tomorrowIso) > now.getTime() && Date.parse(tomorrowIso) < start) return tomorrow;
  return "";
}

/** A publish time the person typed (datetime-local, community zone): in the future and before the event starts. */
export function checkPublishTime(local: string, tz: string, startsAt: string | null, now: Date = new Date()): { ok: true; iso: string } | { ok: false; error: string } {
  const iso = fromDateTimeLocal((local ?? "").trim(), tz);
  if (!iso) return { ok: false, error: "Pick a date and time to publish." };
  if (!startsAt || Number.isNaN(Date.parse(startsAt))) return { ok: false, error: "The event has no start date and time yet. Set when it starts first." };
  if (Date.parse(iso) <= now.getTime()) return { ok: false, error: "Pick a time in the future." };
  if (Date.parse(iso) >= Date.parse(startsAt)) return { ok: false, error: `Pick a time before the event starts (${formatDateTime(startsAt, tz)}).` };
  return { ok: true, iso };
}

// ── What stops a publish ─────────────────────────────────────────────────────

const NO_COUNTS = { lunch_slots: 0, shifts: 0, shifts_empty: null, checklist_overdue: 0, checklist_open: 0 } as const;

/**
 * Everything that stops the event being published at `when` (now, or the scheduled time), in plain sentences: the flyer
 * approval first, then the same publish blockers as the readiness list (no start, start passed, ends before it starts,
 * the RSVP window, lunch without a time, a paid event without a price). The background service checks the same again.
 */
export function publishProblems(event: ReadinessEvent, approval: ApprovalState, when: Date, tz: string): string[] {
  const out: string[] = [];
  const a = approvalProblem(approval);
  if (a) out.push(a);
  if (event.status !== "draft") {
    out.push(event.status === "cancelled" ? "The event is cancelled. Restore it as a draft first." : "The event is already published.");
    return out;
  }
  const ready = eventReadiness(event, NO_COUNTS, "publish", when, tz);
  for (const b of ready.blockers) out.push(`${b.text} ${b.fix}`);
  return out;
}

// ── Channels ─────────────────────────────────────────────────────────────────

export type ChannelKey = "website" | "app" | "calendar" | "facebook" | "instagram";
export type ChannelState = "ready" | "scheduled" | "live" | "failed" | "not_shown" | "ended" | "off" | "coming_next";

export type ChannelRow = {
  key: ChannelKey;
  label: string;
  /** What the channel is, or why it is not used, in a sentence. */
  detail: string;
  state: ChannelState;
  /** The short status word(s) shown on the row. */
  status: string;
  /** Built today (published with the event) or shown as Coming next. */
  built: boolean;
};

export type PublishSnapshot = {
  status: string;
  publish_at: string | null;
  publish_failure: string | null;
  /** Guests can see the event (public or members and guests, not confidential): the guest web page is used. */
  guestVisible: boolean;
};

const LIVE_STATUSES = new Set(["published", "rsvp_closed", "live"]);

/** Who may see the event, for the website row (same rule as the builder's isGuestVisible). */
export function isGuestVisible(e: { audience: string; confidential: boolean }): boolean {
  return (e.audience === "public" || e.audience === "members_and_guests") && !e.confidential;
}

/** The overall state of the built channels: one status change publishes all three. */
export function publishState(s: PublishSnapshot): "draft" | "scheduled" | "failed" | "live" | "ended" | "cancelled" {
  if (LIVE_STATUSES.has(s.status)) return "live";
  if (s.status === "completed") return "ended";
  if (s.status === "cancelled") return "cancelled";
  if (s.publish_at) return "scheduled";
  if (s.publish_failure) return "failed";
  return "draft";
}

export function channelRows(s: PublishSnapshot, tz: string): ChannelRow[] {
  const state = publishState(s);
  const when = s.publish_at ? formatDateTime(s.publish_at, tz) : "";
  const builtStatus = (): Pick<ChannelRow, "state" | "status"> => {
    switch (state) {
      case "live":
        return { state: "live", status: "Live" };
      case "ended":
        return { state: "ended", status: "Event ended" };
      case "cancelled":
        return { state: "off", status: "Event cancelled" };
      case "scheduled":
        return { state: "scheduled", status: `Scheduled · ${when}` };
      case "failed":
        return { state: "failed", status: "Not published" };
      default:
        return { state: "ready", status: "When you publish" };
    }
  };
  const built = builtStatus();
  const coming = { state: "coming_next" as const, status: "Coming next", built: false };
  return [
    {
      key: "website",
      label: "Website",
      built: true,
      ...(s.guestVisible
        ? { detail: "The event's public page: anyone with the link can see it and RSVP as a guest.", ...built }
        : { detail: "Not shown: this event is for members only or confidential (change Who can RSVP to show it to guests).", state: "not_shown" as const, status: "Members only" }),
    },
    { key: "app", label: "Member app", built: true, detail: "The event card members see, with RSVP.", ...built },
    { key: "calendar", label: "Calendar", built: true, detail: "The community calendar in the member app.", ...built },
    { key: "facebook", label: "Facebook", detail: "Post the flyer to your Facebook Page. An administrator of the Page connects it once; Weaver never sees the password.", ...coming },
    { key: "instagram", label: "Instagram", detail: "Post the flyer to your Instagram professional account, which must be linked to your Facebook Page.", ...coming },
  ];
}

// ── Drawn takes ──────────────────────────────────────────────────────────────

export type DrawnTake = { occasion: FlyerOccasion; frame: boolean; scene: boolean };

/**
 * "Another drawn take": the code-drawn variations the poster can cycle through, free and instant. Each art pack the kind
 * may use (flyerOccasionsFor) with its frame and scene, then the first pack with only its frame or only its scene.
 */
export function drawnTakes(occasions: readonly DrawnTake["occasion"][]): DrawnTake[] {
  const takes: DrawnTake[] = occasions.map((occasion) => ({ occasion, frame: true, scene: true }));
  const first = occasions[0];
  if (first) takes.push({ occasion: first, frame: true, scene: false }, { occasion: first, frame: false, scene: true });
  return takes;
}

/** The take after the one the poster shows now (by occasion and which layers are drawn). */
export function nextDrawnTake(takes: DrawnTake[], current: { occasion: string; frame: boolean; scene: boolean }): DrawnTake | null {
  if (!takes.length) return null;
  const i = takes.findIndex((t) => t.occasion === current.occasion && t.frame === current.frame && t.scene === current.scene);
  return takes[(i + 1) % takes.length] ?? null;
}
