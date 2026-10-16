// Settings: the organization's rules for payment proofs (migration 0865 proof_policy, 0866 set_proof_policy). Pure: it reads the
// policy the database returns, turns the two settings forms into the patch set_proof_policy takes, and says what a change means.
// Money is integer cents; the retention clock is in whole years (3 to 25) as the database enforces.

import { parseAmountToCents } from "@/lib/money";
import { OFFLINE_METHODS, MAX_PROOF_CENTS, type OfflineMethod } from "@/lib/payment-proofs/decide";

export const RETENTION_MIN_YEARS = 3;
export const RETENTION_MAX_YEARS = 25;
export const DEFAULT_RETENTION_YEARS = 7;
export const REPLY_WAIT_MIN = 1;
export const REPLY_WAIT_MAX = 60;
export const WINDOW_MIN = 1;
export const WINDOW_MAX = 180;

/** The usual days a payment takes to reach the bank when the organization has not said (the same defaults as app.bank_window_days, 0868). */
export const DEFAULT_WINDOW_DAYS: Record<OfflineMethod, number> = { cash: 14, check: 30, ach: 7, zelle: 5, stock: 30, daf: 60, matching_gift: 60, other: 45 };

export type MethodRow = { key: OfflineMethod; label: string; note: string };

/** The ways a family can say it paid, in the order the settings table lists them. */
export const METHOD_ROWS: readonly MethodRow[] = [
  { key: "cash", label: "Cash", note: "Reference: a receipt or envelope number. Banked inside a deposit or an offering count." },
  { key: "check", label: "Check", note: "The check number is asked for." },
  { key: "ach", label: "Bank transfer (ACH)", note: "A trace number is optional." },
  { key: "zelle", label: "Zelle", note: "Soft credit only until the bank line is matched." },
  { key: "stock", label: "Stock", note: "Shares and symbol; the treasurer sets the credited value." },
  { key: "daf", label: "Donor-advised fund", note: "Arrives from the fund, not the family." },
  { key: "matching_gift", label: "Matching gift", note: "Arrives from the employer or its giving platform." },
  { key: "other", label: "Other", note: "Anything else the organization accepts." },
];

export type ProofPolicy = {
  requiredMethods: OfflineMethod[];
  retentionYears: number;
  legalHold: boolean;
  /** A proof above this many cents needs a second person with approval rights. 0 means off. */
  secondApproverOverCents: number;
  replyWaitDays: number;
  honourEventEntry: boolean;
  releaseStoreOrders: boolean;
  /** Days to reach the bank, only for methods the organization changed. */
  windows: Partial<Record<OfflineMethod, number>>;
};

export const DEFAULT_POLICY: ProofPolicy = {
  requiredMethods: ["check", "ach", "stock", "daf", "matching_gift", "other"],
  retentionYears: DEFAULT_RETENTION_YEARS,
  legalHold: false,
  secondApproverOverCents: 0,
  replyWaitDays: 14,
  honourEventEntry: true,
  releaseStoreOrders: false,
  windows: {},
};

const isMethod = (v: unknown): v is OfflineMethod => typeof v === "string" && (OFFLINE_METHODS as readonly string[]).includes(v);
const whole = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
};

/** The policy as proof_policy(center) returns it (defaults already merged in by the database). Anything unreadable keeps the default. */
export function parseProofPolicy(data: unknown): ProofPolicy {
  const o = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  const required = Array.isArray(o.required_methods) ? [...new Set(o.required_methods.filter(isMethod))] : DEFAULT_POLICY.requiredMethods;
  const windows: Partial<Record<OfflineMethod, number>> = {};
  if (typeof o.windows === "object" && o.windows !== null) {
    for (const [k, v] of Object.entries(o.windows as Record<string, unknown>)) {
      const n = whole(v, 0);
      if (isMethod(k) && n >= WINDOW_MIN && n <= WINDOW_MAX) windows[k] = n;
    }
  }
  return {
    requiredMethods: required,
    retentionYears: Math.min(RETENTION_MAX_YEARS, Math.max(RETENTION_MIN_YEARS, whole(o.retention_years, DEFAULT_POLICY.retentionYears))),
    legalHold: o.legal_hold === true,
    secondApproverOverCents: Math.max(0, whole(o.second_approver_over_cents, 0)),
    replyWaitDays: Math.min(REPLY_WAIT_MAX, Math.max(REPLY_WAIT_MIN, whole(o.reply_wait_days, DEFAULT_POLICY.replyWaitDays))),
    honourEventEntry: o.honour_event_entry === undefined ? DEFAULT_POLICY.honourEventEntry : o.honour_event_entry === true,
    releaseStoreOrders: o.release_store_orders === true,
    windows,
  };
}

/** Days to reach the bank for a method: the organization's choice, else the usual default. */
export function windowDays(p: ProofPolicy, method: OfflineMethod): number {
  return p.windows[method] ?? DEFAULT_WINDOW_DAYS[method];
}

// ---------------------------------------------------------------------------------------------------- Settings > Payments

export type RulesPatch = {
  required_methods: OfflineMethod[];
  windows: Record<string, number>;
  second_approver_over_cents: number;
  reply_wait_days: number;
  honour_event_entry: boolean;
  release_store_orders: boolean;
};

const checked = (fd: FormData, name: string): boolean => fd.get(name) === "on" || fd.get(name) === "true";

/**
 * Reads the Settings > Payments "Payment proofs" form. Every number is checked here with a sentence; the database checks again.
 * `windows` sends every method the person gave a number for; a blank box means "the usual default" and is left out.
 */
export function rulesPatchFromForm(fd: FormData): { ok: true; patch: RulesPatch } | { ok: false; error: string } {
  const required = OFFLINE_METHODS.filter((m) => checked(fd, `need_${m}`));
  const windows: Record<string, number> = {};
  for (const m of OFFLINE_METHODS) {
    const raw = String(fd.get(`days_${m}`) ?? "").trim();
    if (raw === "") continue;
    if (!/^\d{1,3}$/.test(raw) || Number(raw) < WINDOW_MIN || Number(raw) > WINDOW_MAX) {
      const label = METHOD_ROWS.find((r) => r.key === m)?.label ?? m;
      return { ok: false, error: `${label}: the usual days to reach the bank must be a whole number from ${WINDOW_MIN} to ${WINDOW_MAX}, or left blank for the usual ${DEFAULT_WINDOW_DAYS[m]}.` };
    }
    windows[m] = Number(raw);
  }
  const limitRaw = String(fd.get("second_approver") ?? "").trim();
  let limit = 0;
  if (limitRaw !== "") {
    const cents = parseAmountToCents(limitRaw);
    if (cents === null || cents < 0 || cents > MAX_PROOF_CENTS) return { ok: false, error: "The amount for a second approval must be an amount from 0 to 1,000,000, or 0 to turn it off." };
    limit = cents;
  }
  const waitRaw = String(fd.get("reply_wait_days") ?? "").trim();
  if (!/^\d{1,2}$/.test(waitRaw) || Number(waitRaw) < REPLY_WAIT_MIN || Number(waitRaw) > REPLY_WAIT_MAX) {
    return { ok: false, error: `Days to wait for a reply must be a whole number from ${REPLY_WAIT_MIN} to ${REPLY_WAIT_MAX}.` };
  }
  return {
    ok: true,
    patch: {
      required_methods: required,
      windows,
      second_approver_over_cents: limit,
      reply_wait_days: Number(waitRaw),
      honour_event_entry: checked(fd, "honour_event_entry"),
      release_store_orders: checked(fd, "release_store_orders"),
    },
  };
}

// ---------------------------------------------------------------------------------------------------- Settings > Storage

export type RetentionPatch = { retention_years: number; legal_hold: boolean };

export function retentionYearsProblem(raw: string): string | null {
  if (!/^\d{1,2}$/.test(raw.trim())) return `Keep proofs for a whole number of years, from ${RETENTION_MIN_YEARS} to ${RETENTION_MAX_YEARS}.`;
  const n = Number(raw);
  return n < RETENTION_MIN_YEARS || n > RETENTION_MAX_YEARS ? `Keep proofs for ${RETENTION_MIN_YEARS} to ${RETENTION_MAX_YEARS} years.` : null;
}

/** Reads the Settings > Storage "Payment proofs" row: years kept and the legal hold. */
export function retentionPatchFromForm(fd: FormData): { ok: true; patch: RetentionPatch } | { ok: false; error: string } {
  const raw = String(fd.get("years") ?? "").trim();
  const bad = retentionYearsProblem(raw);
  if (bad) return { ok: false, error: bad };
  return { ok: true, patch: { retention_years: Number(raw), legal_hold: checked(fd, "legal_hold") } };
}

/** Shortening the years needs a reason and a fresh 2FA code (the database asks for both: SQLSTATE CCSTP). */
export function isShortening(current: ProofPolicy, patch: RetentionPatch): boolean {
  return patch.retention_years < current.retentionYears;
}

/** The sentence under the years box: what the change means, in plain words. */
export function retentionNote(current: ProofPolicy, years: number): string {
  if (years < current.retentionYears) {
    return `Shortening to ${years} years needs a reason and your sign-in code. Families lose access to a file at the same moment staff do.`;
  }
  if (years > current.retentionYears) return "Raising the years never removes anything.";
  return current.legalHold ? "A legal hold is on: no proof is removed whatever the years say." : "Kept from the end of the accounting year of the payment, and only once its pledges are final.";
}

// ---------------------------------------------------------------------------------------------------- the shortening preview

/** What proof_retention_preview(center, years) returns: what shortening to `years` would make due. */
export type RetentionPreview = { files: number; familyFiles: number; currentYears: number; newYears: number; legalHold: boolean };

const count = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/** The preview as the database sends it; null when it is not in the expected shape (the screen then shows no number rather than a made-up one). */
export function parseRetentionPreview(data: unknown): RetentionPreview | null {
  if (typeof data !== "object" || data === null) return null;
  const o = data as Record<string, unknown>;
  if (o.files === undefined || o.files === null) return null;
  return {
    files: count(o.files),
    familyFiles: count(o.family_files),
    currentYears: count(o.current_years),
    newYears: count(o.new_years),
    legalHold: o.legal_hold === true,
  };
}

/** "12 files would become due, and families would lose access to 9 of them." Plain words, never a guess. */
export function previewSentence(p: RetentionPreview): string {
  const files = `${p.files.toLocaleString("en-US")} ${p.files === 1 ? "file" : "files"}`;
  if (p.files === 0) return "No file would become due at this length.";
  const family = p.familyFiles === 0 ? "no family would lose access to a file" : `families would lose access to ${p.familyFiles.toLocaleString("en-US")} of them`;
  const hold = p.legalHold ? " The legal hold is on, so none is removed while it stays on." : "";
  return `${files} would become due, and ${family}.${hold}`;
}
