// One recorded event: its shape and the checks every event passes before it leaves the portal.
// Pure, no server imports (the browser beacon uses it too).
//
// What an event holds: a catalog key, what kind it is, an optional entity (a kind word and an id, never a
// name), how it ended, a short code from a closed list when it failed, how long it took and where it came
// from. It never holds free text, form values, amounts, names or addresses. The database drops keys it does
// not know and takes the person and the community from the sign-in; these checks keep the portal honest too.

import { isCanonicalScreenKey } from "@/lib/activity/route-pattern";

export const ACTIVITY_KINDS = ["action", "screen"] as const;
export const ACTIVITY_OUTCOMES = ["ok", "error", "cancelled"] as const;
export const ACTIVITY_VIAS = ["screen", "palette", "assistant", "app"] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export type ActivityOutcome = (typeof ACTIVITY_OUTCOMES)[number];
export type ActivityVia = (typeof ACTIVITY_VIAS)[number];

export type ActivityEvent = {
  /** `area.verb` for an action ("giving.record_payment"), `screen:<pattern>` for a screen ("screen:/events/[id]"). */
  key: string;
  kind: ActivityKind;
  /** What the action was about, as a kind word ("payment", "event") and its id. Both or neither. */
  entity_kind?: string;
  entity_id?: string;
  outcome: ActivityOutcome;
  /** A word from the closed list in ERROR_CODES, only when the outcome is "error". */
  error_code?: string;
  duration_ms?: number;
  via: ActivityVia;
  /** Order within one browser tab's visit, when known. */
  seq?: number;
  /** A random id for one browser tab's visit, so a run of events can be told apart. Not tied to a person. */
  session_id?: string;
  app_version?: string;
  platform?: string;
  /** When it happened (ISO 8601). The server fills it in when absent. */
  at?: string;
};

export const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
export const MAX_SEQ = 1_000_000;

/** Action keys are `area.verb` (a third part is allowed for a sub-area): lowercase words and underscores only. */
export const ACTION_KEY = /^[a-z][a-z0-9_]{0,31}(\.[a-z][a-z0-9_]{0,47}){1,2}$/;
const WORD = /^[a-z][a-z0-9_]{0,39}$/;
const ENTITY_KIND = /^[a-z][a-z_]{0,31}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_ID = /^[A-Za-z0-9-]{8,64}$/;
const VERSION = /^[0-9A-Za-z.+_-]{1,32}$/;
const PLATFORM = /^[a-z]{2,16}$/;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 5 * 60 * 1000;

export function isActivityUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Why an action did not work, as one word from a closed list (never the sentence shown to the person). */
export const ERROR_CODES = [
  "no_permission",
  "step_up_required",
  "session_expired",
  "not_found",
  "duplicate",
  "unreachable",
  "invalid_input",
  "failed",
  "exception",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * The code for an action result that said `ok: false`. The portal's results carry a sentence, so the code
 * is read from it; the sentence itself is never kept.
 */
export function errorCodeOf(result: { error?: unknown; stepUp?: unknown } | null | undefined): ErrorCode {
  if (!result) return "failed";
  if (result.stepUp === true) return "step_up_required";
  const text = typeof result.error === "string" ? result.error : "";
  if (/fresh 2FA check/i.test(text)) return "step_up_required";
  if (/session has expired|sign in again|sign in to/i.test(text)) return "session_expired";
  if (/don't have permission|do not have permission|not allowed|— only [^.]* can /i.test(text)) return "no_permission";
  if (/not found|no longer exists|can't see it/i.test(text)) return "not_found";
  if (/already (exists|there)|same key/i.test(text)) return "duplicate";
  if (/could not be reached|network|timed out/i.test(text)) return "unreachable";
  if (/^could not [^—]*— (enter|choose|give|pick|write|tick|select|fill|add|use) /i.test(text)) return "invalid_input";
  return "failed";
}

/** The shape of an action result (ActionResult and its relatives): only `ok` decides the outcome. */
export function outcomeOfResult(result: unknown): { outcome: ActivityOutcome; error_code?: ErrorCode } {
  if (typeof result === "object" && result !== null && (result as { ok?: unknown }).ok === false) {
    return { outcome: "error", error_code: errorCodeOf(result as { error?: unknown; stepUp?: unknown }) };
  }
  return { outcome: "ok" };
}

function oneOf<T extends string>(list: readonly T[], value: unknown): T | undefined {
  return typeof value === "string" && (list as readonly string[]).includes(value) ? (value as T) : undefined;
}

/**
 * A raw event (from our own code, or from a browser) as a clean event, or null when it cannot be kept.
 * Unknown fields are dropped, out-of-range values are dropped (not clamped into something misleading),
 * and nothing that could carry free text gets through.
 */
export function normalizeEvent(raw: unknown, nowMs: number = Date.now()): ActivityEvent | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const key = r.key;
  if (typeof key !== "string" || key.length > 120) return null;
  const isScreen = key.startsWith("screen:");
  if (isScreen ? !isCanonicalScreenKey(key) : !ACTION_KEY.test(key)) return null;
  const kind: ActivityKind = isScreen ? "screen" : "action";
  if (r.kind !== undefined && r.kind !== kind) return null;

  const outcome = oneOf(ACTIVITY_OUTCOMES, r.outcome);
  const via = oneOf(ACTIVITY_VIAS, r.via);
  if (!outcome || !via) return null;

  const event: ActivityEvent = { key, kind, outcome, via };

  if (isActivityUuid(r.entity_id) && typeof r.entity_kind === "string" && ENTITY_KIND.test(r.entity_kind) && !isScreen) {
    event.entity_kind = r.entity_kind;
    event.entity_id = r.entity_id.toLowerCase();
  }
  if (outcome === "error" && typeof r.error_code === "string" && WORD.test(r.error_code)) event.error_code = r.error_code;

  if (typeof r.duration_ms === "number" && Number.isFinite(r.duration_ms) && r.duration_ms >= 0) {
    event.duration_ms = Math.min(Math.round(r.duration_ms), MAX_DURATION_MS);
  }
  if (typeof r.seq === "number" && Number.isInteger(r.seq) && r.seq >= 0 && r.seq <= MAX_SEQ) event.seq = r.seq;
  if (typeof r.session_id === "string" && SESSION_ID.test(r.session_id)) event.session_id = r.session_id;
  if (typeof r.app_version === "string" && VERSION.test(r.app_version)) event.app_version = r.app_version;
  if (typeof r.platform === "string" && PLATFORM.test(r.platform)) event.platform = r.platform;
  if (typeof r.at === "string") {
    const t = Date.parse(r.at);
    if (Number.isFinite(t) && t >= nowMs - MAX_AGE_MS && t <= nowMs + MAX_FUTURE_MS) event.at = new Date(t).toISOString();
  }
  return event;
}
