// Pure helpers for Communications (newsletters, inbox, WhatsApp queue).
// Audience JSON is comms_campaigns.audience / surveys.audience / alerts.audience.
// app.segment_recipient_count (0025) reads the same keys and OR-s them.

export type AudienceSelection = {
  allMembers: boolean;
  lifeMembers: boolean;
  pathshalaClassIds: string[];
  zoneIds: string[];
  eventId: string | null;
  rsvpStatuses: string[];
};

export const EMPTY_SELECTION: AudienceSelection = {
  allMembers: false,
  lifeMembers: false,
  pathshalaClassIds: [],
  zoneIds: [],
  eventId: null,
  rsvpStatuses: [],
};

export const DEFAULT_RSVP_STATUSES = ["rsvpd", "confirmed", "attended"] as const;

type Obj = Record<string, unknown>;

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
}

/**
 * Selected segments → audience JSON. Segments combine: a household in ANY
 * selected segment receives it (the database's recipient count works the same way).
 */
export function buildAudience(sel: AudienceSelection): { ok: true; audience: Obj } | { ok: false; error: string } {
  const a: Obj = {};
  if (sel.allMembers) a.all_members = true;
  if (sel.lifeMembers) a.membership_tiers = ["life"];
  if (sel.pathshalaClassIds.length) {
    a.pathshala_class_ids = [...new Set(sel.pathshalaClassIds)];
    a.include = "parents";
  }
  if (sel.zoneIds.length) a.zone_ids = [...new Set(sel.zoneIds)];
  if (sel.eventId) {
    a.event_id = sel.eventId;
    a.rsvp_statuses = sel.rsvpStatuses.length ? [...new Set(sel.rsvpStatuses)] : [...DEFAULT_RSVP_STATUSES];
  }
  if (Object.keys(a).length === 0) return { ok: false, error: "Choose at least one audience segment." };
  return { ok: true, audience: a };
}

/** Audience JSON → the segments it selects (unknown keys are ignored). */
export function parseAudience(audience: unknown): AudienceSelection {
  if (!audience || typeof audience !== "object" || Array.isArray(audience)) return { ...EMPTY_SELECTION };
  const a = audience as Obj;
  return {
    allMembers: a.all_members === true,
    lifeMembers: strings(a.membership_tiers).includes("life"),
    pathshalaClassIds: strings(a.pathshala_class_ids),
    zoneIds: strings(a.zone_ids),
    eventId: typeof a.event_id === "string" && a.event_id ? a.event_id : null,
    rsvpStatuses: strings(a.rsvp_statuses),
  };
}

/** True when the audience JSON uses keys this screen does not build (older custom segments). */
export function hasUnknownAudienceKeys(audience: unknown): boolean {
  if (!audience || typeof audience !== "object" || Array.isArray(audience)) return false;
  const known = new Set(["all_members", "membership_tiers", "pathshala_class_ids", "include", "zone_ids", "event_id", "rsvp_statuses"]);
  return Object.keys(audience as Obj).some((k) => !known.has(k));
}

/**
 * Current rule (unchanged from connect-admin, enforced by the two_person_comms
 * trigger in 0016): sends to all members need two different approvers.
 */
export function requiresSecondApprover(audience: unknown): boolean {
  return Boolean(audience && typeof audience === "object" && (audience as Obj).all_members === true);
}

export type AudienceNames = {
  zones?: Map<string, string>;
  classes?: Map<string, string>;
  events?: Map<string, string>;
  /** Total number of Pathshala classes, so "every class" reads as "Pathshala parents". */
  classCount?: number;
};

/** "Pathshala parents + West zone", "All members", "RSVPs for Diwali". */
export function describeAudience(audience: unknown, names: AudienceNames = {}): string {
  if (!audience || typeof audience !== "object" || Array.isArray(audience)) return "No audience";
  const sel = parseAudience(audience);
  const parts: string[] = [];
  if (sel.allMembers) parts.push("All members");
  if (sel.lifeMembers) parts.push("Life members");
  if (sel.pathshalaClassIds.length) {
    if (names.classCount && sel.pathshalaClassIds.length >= names.classCount) parts.push("Pathshala parents");
    else {
      const list = sel.pathshalaClassIds.map((id) => names.classes?.get(id) ?? "a class");
      parts.push(`Pathshala parents (${list.join(", ")})`);
    }
  }
  for (const id of sel.zoneIds) {
    const n = names.zones?.get(id);
    parts.push(n ? `${n} zone` : "A zone");
  }
  if (sel.eventId) {
    const n = names.events?.get(sel.eventId);
    const attended = sel.rsvpStatuses.length === 1 && sel.rsvpStatuses[0] === "attended";
    parts.push(`${attended ? "Attendees of" : "RSVPs for"} ${n ?? "an event"}`);
  }
  if (parts.length === 0) return hasUnknownAudienceKeys(audience) ? "Custom segment" : "No audience";
  return parts.join(" + ");
}

// ---------------------------------------------------------------------------
// Campaign status and list columns
// ---------------------------------------------------------------------------
export type CampaignStatus = "draft" | "pending_approval" | "scheduled" | "sending" | "sent" | "cancelled";

/** Prototype copy: "Awaiting approval" / "Scheduled" / "Sent". */
export function campaignStatusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Awaiting approval";
    case "pending_approval":
      return "Awaiting second approver";
    case "scheduled":
      // Nothing sends campaigns yet (no email/SMS/WhatsApp/push sender is connected).
      return "Scheduled · queued until a sender is connected";
    case "sending":
      return "Sending";
    case "sent":
      return "Sent";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

export function campaignStatusTone(status: string): "ok" | "warn" | "bad" {
  if (status === "draft" || status === "pending_approval") return "warn";
  if (status === "cancelled") return "bad";
  return "ok";
}

/** "62% opened" when both counts are known, else null. */
export function openRate(recipients: number | null | undefined, opened: number | null | undefined): string | null {
  if (!recipients || recipients <= 0 || opened === null || opened === undefined) return null;
  return `${Math.round((Math.min(opened, recipients) / recipients) * 100)}% opened`;
}

/**
 * What the one-click button on the compose form does, under the CURRENT rules:
 * every send needs a comms.approve holder (the drafter may be that approver),
 * and all-member sends need a second, different approver.
 */
export function composeAction(audience: unknown, canApprove: boolean): "schedule" | "submit" {
  return canApprove && !requiresSecondApprover(audience) ? "schedule" : "submit";
}

// ---------------------------------------------------------------------------
// Translations (comms_campaigns.translations: {gu: {title, body_md}, hi: {...}})
// ---------------------------------------------------------------------------
export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "gu", label: "ગુજરાતી" },
  { code: "hi", label: "हिन्दी" },
] as const;
export type LanguageCode = (typeof LANGUAGES)[number]["code"];

export function buildTranslations(input: Partial<Record<LanguageCode, { title?: string; body_md?: string }>>): Obj {
  const out: Obj = {};
  for (const { code } of LANGUAGES) {
    if (code === "en") continue;
    const t = input[code];
    const title = t?.title?.trim() ?? "";
    const body = t?.body_md?.trim() ?? "";
    if (title || body) out[code] = { title, body_md: body };
  }
  return out;
}

export function translationLanguages(translations: unknown): LanguageCode[] {
  if (!translations || typeof translations !== "object" || Array.isArray(translations)) return [];
  return LANGUAGES.map((l) => l.code).filter((c) => c !== "en" && Boolean((translations as Obj)[c]));
}

// ---------------------------------------------------------------------------
// Small formatting helpers shared by the inbox and WhatsApp queue
// ---------------------------------------------------------------------------

/** Short reference shown in ID columns, derived from the end of the row's uuid ("NL-3F2A1"). */
export function refCode(prefix: string, id: string | null | undefined): string {
  if (!id) return "—";
  const hex = id.replace(/-/g, "");
  return `${prefix}-${hex.slice(-5).toUpperCase()}`;
}

/** "+18325552291" → "(832) 555-2291"; other numbers are shown as stored. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "—";
  const compact = e164.replace(/[\s().-]/g, "");
  const m = /^(?:\+1|1)?(\d{10})$/.exec(compact);
  if (!m) return e164;
  const us = m[1];
  return `(${us.slice(0, 3)}) ${us.slice(3, 6)}-${us.slice(6)}`;
}

/** "5 min", "2 h", "3 d" since `from`. */
export function ageLabel(from: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}
