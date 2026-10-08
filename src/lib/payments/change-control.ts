// Change control and readiness for the ways to pay (docs/PAYMENTS_PLAN.md §2.5 and §2.6, migration 0597): the answers of
// app.payee_change_queue (Settings › Payments), app.payment_readiness (Settings › Payments) and app.payment_plugin_pauses
// (Platform › Payments), read defensively, and the small rules the screens check before asking the database. The RPCs answer
// jsonb (typed as Json), so every field is checked here; a shape this code does not understand is a plain error, never a
// guess. Pure; tested in tests/payee-change-control.test.ts.

import { instructionsProblem, type PluginTone } from "./plugins/config";
import { UNEXPECTED_SHAPE, type Parsed } from "./plugins/view";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const oneOf = <T extends string>(v: unknown, list: readonly T[]): v is T => isStr(v) && (list as readonly string[]).includes(v);

/** A request to change where gifts go lapses after this many days (app.request_payee_change). */
export const PAYEE_REQUEST_DAYS = 14;
/** Members see the dated notice for this many days after a confirmed change (app.payee_notice). */
export const PAYEE_NOTICE_DAYS = 30;

// ── app.payee_change_queue(center) ───────────────────────────────────────────
export const PAYEE_STATUSES = ["pending", "applied", "rejected", "cancelled", "superseded", "expired"] as const;
export type PayeeStatus = (typeof PAYEE_STATUSES)[number];

export type PayeeFieldChange = { field: string; label: string; from: string | null; to: string | null };
export type PayeeRequest = {
  id: string;
  plugin_key: "zelle" | "paypal";
  status: PayeeStatus;
  requested_by: string;
  requested_by_name: string;
  requested_at: string;
  request_reason: string;
  expires_at: string;
  /** Still "pending" in the table, but past its 14 days: it can no longer be confirmed. */
  expired: boolean;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  applied_at: string | null;
  /** The signed-in person asked for it (so they cannot also be the second person). */
  mine: boolean;
  fields: PayeeFieldChange[];
};
export type PayeeQueue = { can_request: boolean; can_approve: boolean; requests: PayeeRequest[] };

function parseFieldChange(v: unknown): PayeeFieldChange | null {
  if (!isObj(v) || !isStr(v.field) || !isStr(v.label) || !strOrNull(v.from) || !strOrNull(v.to)) return null;
  return { field: v.field, label: v.label, from: v.from, to: v.to };
}

function parseRequest(v: unknown): PayeeRequest | null {
  if (!isObj(v)) return null;
  const fields = Array.isArray(v.fields) ? v.fields.map(parseFieldChange) : null;
  if (
    !isStr(v.id) || !oneOf(v.plugin_key, ["zelle", "paypal"] as const) || !oneOf(v.status, PAYEE_STATUSES) || !isStr(v.requested_by)
    || !isStr(v.requested_by_name) || !isStr(v.requested_at) || !isStr(v.request_reason) || !isStr(v.expires_at) || !isBool(v.expired)
    || !strOrNull(v.decided_by_name) || !strOrNull(v.decided_at) || !strOrNull(v.decision_reason) || !strOrNull(v.applied_at)
    || !isBool(v.mine) || !fields || fields.some((f) => f === null)
  ) {
    return null;
  }
  return {
    id: v.id, plugin_key: v.plugin_key, status: v.status, requested_by: v.requested_by, requested_by_name: v.requested_by_name,
    requested_at: v.requested_at, request_reason: v.request_reason, expires_at: v.expires_at, expired: v.expired,
    decided_by_name: v.decided_by_name, decided_at: v.decided_at, decision_reason: v.decision_reason, applied_at: v.applied_at,
    mine: v.mine, fields: fields as PayeeFieldChange[],
  };
}

export function parsePayeeQueue(json: unknown): Parsed<PayeeQueue> {
  if (!isObj(json) || !isBool(json.can_request) || !isBool(json.can_approve) || !Array.isArray(json.requests)) return { ok: false, error: UNEXPECTED_SHAPE };
  const requests: PayeeRequest[] = [];
  for (const r of json.requests) {
    const parsed = parseRequest(r);
    if (!parsed) return { ok: false, error: UNEXPECTED_SHAPE };
    requests.push(parsed);
  }
  return { ok: true, value: { can_request: json.can_request, can_approve: json.can_approve, requests } };
}

/** Requests that can still be confirmed, newest first as the database lists them. */
export function waitingRequests(queue: PayeeQueue, plugin?: string): PayeeRequest[] {
  return queue.requests.filter((r) => r.status === "pending" && !r.expired && (!plugin || r.plugin_key === plugin));
}

export function payeeStatusView(r: Pick<PayeeRequest, "status" | "expired">): { label: string; tone: PluginTone } {
  if (r.status === "pending" && r.expired) return { label: "Lapsed", tone: "neutral" };
  switch (r.status) {
    case "pending":
      return { label: "Waiting for a second person", tone: "warning" };
    case "applied":
      return { label: "Confirmed", tone: "success" };
    case "rejected":
      return { label: "Turned down", tone: "danger" };
    case "cancelled":
      return { label: "Withdrawn", tone: "neutral" };
    case "superseded":
      return { label: "Replaced by a newer request", tone: "neutral" };
    default:
      return { label: "Lapsed", tone: "neutral" };
  }
}

/** The sentence that says who must act next on a waiting request. */
export function waitingNote(r: PayeeRequest, canApprove: boolean): string {
  if (r.expired) return `This request lapsed on ${r.expires_at.slice(0, 10)}. Ask for the change again.`;
  if (r.mine) return "You asked for this change, so a different person with giving.approve has to confirm it.";
  return canApprove
    ? `${r.requested_by_name} asked for this change. You can confirm it (a fresh 2FA check and a reason) or turn it down.`
    : `${r.requested_by_name} asked for this change. A person with giving.approve confirms it.`;
}

// ── What the person types before asking ──────────────────────────────────────
export type ZelleCurrent = { recipient: string; name: string };

/**
 * The fields of a Zelle change worth asking for: only those that differ from what is saved (compared without
 * regard to capital letters, as the database does). Mirrors app.request_payee_change so the form can say it before asking;
 * the database is still the rule.
 */
export function zelleChange(current: ZelleCurrent, input: { recipient: string; name: string }):
  { ok: true; changes: Record<string, string> } | { ok: false; error: string } {
  const changes: Record<string, string> = {};
  const fields: { key: "recipient" | "name"; what: string }[] = [
    { key: "recipient", what: "Zelle email or phone" },
    { key: "name", what: "name shown in Zelle" },
  ];
  for (const f of fields) {
    const next = (input[f.key] ?? "").trim();
    const now = (current[f.key] ?? "").trim();
    // Nothing is saved yet: it is saved in the form above, and a second person is needed only to change one that is already saved.
    if (!now && !next) continue;
    if (!now) return { ok: false, error: `The ${f.what} is not saved yet. Save it in the form above; a second person is needed only to change one that is already saved.` };
    if (!next) return { ok: false, error: `Enter the new ${f.what}, or put the current one back.` };
    if (now && next.toLowerCase() === now.toLowerCase()) continue;
    const problem = instructionsProblem("zelle", { [f.key]: next }, []);
    if (problem) return { ok: false, error: problem };
    changes[f.key] = next;
  }
  if (Object.keys(changes).length === 0) return { ok: false, error: "Change the address or the name first. Both are the same as what is saved." };
  return { ok: true, changes };
}

/** The reason every one of these actions asks for (kept in the audit log). */
export function reasonProblem(reason: string, doing: string): string | null {
  const r = String(reason ?? "").trim();
  if (!r) return `Could not ${doing} — say why. The reason is kept in the audit log.`;
  if (r.length > 500) return `Could not ${doing} — keep the reason under 500 characters.`;
  return null;
}

// ── app.payment_readiness(center) ────────────────────────────────────────────
export type PluginReadiness = { key: string; label: string; family: string; ready: boolean; detail: string };
export type ZelleApproval = { state: "none" | "current" | "changed"; approved_by_name: string | null; approved_at: string | null; note: string | null };
export type PaymentReadiness = {
  /** Every enabled way to pay is ready. */
  ok: boolean;
  offline_only: boolean;
  environment: "sandbox" | "production";
  plugins: PluginReadiness[];
  zelle_approval: ZelleApproval;
  is_treasurer: boolean;
  can_configure: boolean;
};

function parsePluginReadiness(v: unknown): PluginReadiness | null {
  if (!isObj(v) || !isStr(v.key) || !isStr(v.label) || !isStr(v.family) || !isBool(v.ready) || !isStr(v.detail)) return null;
  return { key: v.key, label: v.label, family: v.family, ready: v.ready, detail: v.detail };
}

export function parsePaymentReadiness(json: unknown): Parsed<PaymentReadiness> {
  if (
    !isObj(json) || !isBool(json.ok) || !isBool(json.offline_only) || !oneOf(json.environment, ["sandbox", "production"] as const)
    || !Array.isArray(json.plugins) || !isObj(json.zelle_approval) || !oneOf(json.zelle_approval.state, ["none", "current", "changed"] as const)
    || !isBool(json.is_treasurer) || !isBool(json.can_configure)
  ) {
    return { ok: false, error: UNEXPECTED_SHAPE };
  }
  const plugins: PluginReadiness[] = [];
  for (const p of json.plugins) {
    const parsed = parsePluginReadiness(p);
    if (!parsed) return { ok: false, error: UNEXPECTED_SHAPE };
    plugins.push(parsed);
  }
  const a = json.zelle_approval;
  return {
    ok: true,
    value: {
      ok: json.ok, offline_only: json.offline_only, environment: json.environment, plugins,
      zelle_approval: {
        state: a.state as ZelleApproval["state"],
        approved_by_name: isStr(a.approved_by_name) ? a.approved_by_name : null,
        approved_at: isStr(a.approved_at) ? a.approved_at : null,
        note: isStr(a.note) ? a.note : null,
      },
      is_treasurer: json.is_treasurer, can_configure: json.can_configure,
    },
  };
}

/** One line for the top of the readiness card. */
export function readinessSummary(r: PaymentReadiness): string {
  if (r.plugins.length === 0) return "No way to pay is switched on yet, so there is nothing to check.";
  const bad = r.plugins.filter((p) => !p.ready);
  if (bad.length === 0) return `Every way to pay that is switched on is ready (${r.plugins.map((p) => p.label).join(", ")}).`;
  return `${bad.length} of ${r.plugins.length} ways to pay ${bad.length === 1 ? "is" : "are"} not ready: ${bad.map((p) => p.label).join(", ")}.`;
}

/** Apple Pay or Google Pay whose readiness is waiting only for the statement that it is turned on in Stripe. */
export function walletConfirmable(entry: PluginReadiness): boolean {
  return !entry.ready && !entry.detail.startsWith("Card is not ready") && !entry.detail.startsWith("Community Connect has paused");
}

export function zelleApprovalView(a: ZelleApproval): { label: string; tone: PluginTone } {
  switch (a.state) {
    case "current":
      return { label: "Approved by the treasurer", tone: "success" };
    case "changed":
      return { label: "Changed since it was approved", tone: "warning" };
    default:
      return { label: "Not approved yet", tone: "warning" };
  }
}

// ── app.payment_plugin_pauses() (Platform › Payments) ────────────────────────
export type PauseNote = { id: string; reason: string; at: string; by: string | null };
export type CenterPause = PauseNote & { center_id: string; center_name: string; slug: string };
export type PausePlugin = {
  key: string;
  label: string;
  family: string;
  status: "available" | "beta" | "suspended";
  platform_pause: PauseNote | null;
  centers: CenterPause[];
};
export type PauseHistoryRow = {
  id: string;
  plugin_key: string;
  platform_wide: boolean;
  center_name: string | null;
  reason: string;
  suspended_at: string;
  suspended_by: string | null;
  lifted_at: string | null;
  lift_reason: string | null;
  lifted_by: string | null;
};
export type PauseCenter = { id: string; name: string; slug: string; environment: string };
export type PausesView = { plugins: PausePlugin[]; history: PauseHistoryRow[]; centers: PauseCenter[] };

function parsePauseNote(v: unknown): PauseNote | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.reason) || !isStr(v.at) || !strOrNull(v.by ?? null)) return null;
  return { id: v.id, reason: v.reason, at: v.at, by: isStr(v.by) ? v.by : null };
}

function parsePausePlugin(v: unknown): PausePlugin | null {
  if (!isObj(v) || !isStr(v.key) || !isStr(v.label) || !isStr(v.family) || !oneOf(v.status, ["available", "beta", "suspended"] as const) || !Array.isArray(v.centers)) return null;
  let platform: PauseNote | null = null;
  if (v.platform_pause !== null && v.platform_pause !== undefined) {
    platform = parsePauseNote(v.platform_pause);
    if (!platform) return null;
  }
  const centers: CenterPause[] = [];
  for (const c of v.centers) {
    const note = parsePauseNote(c);
    if (!note || !isObj(c) || !isStr(c.center_id) || !isStr(c.center_name) || !isStr(c.slug)) return null;
    centers.push({ ...note, center_id: c.center_id, center_name: c.center_name, slug: c.slug });
  }
  return { key: v.key, label: v.label, family: v.family, status: v.status, platform_pause: platform, centers };
}

function parseHistory(v: unknown): PauseHistoryRow | null {
  if (
    !isObj(v) || !isStr(v.id) || !isStr(v.plugin_key) || !isBool(v.platform_wide) || !strOrNull(v.center_name ?? null) || !isStr(v.reason)
    || !isStr(v.suspended_at) || !strOrNull(v.suspended_by ?? null) || !strOrNull(v.lifted_at ?? null) || !strOrNull(v.lift_reason ?? null) || !strOrNull(v.lifted_by ?? null)
  ) {
    return null;
  }
  return {
    id: v.id, plugin_key: v.plugin_key, platform_wide: v.platform_wide, center_name: isStr(v.center_name) ? v.center_name : null, reason: v.reason,
    suspended_at: v.suspended_at, suspended_by: isStr(v.suspended_by) ? v.suspended_by : null, lifted_at: isStr(v.lifted_at) ? v.lifted_at : null,
    lift_reason: isStr(v.lift_reason) ? v.lift_reason : null, lifted_by: isStr(v.lifted_by) ? v.lifted_by : null,
  };
}

export function parsePauses(json: unknown): Parsed<PausesView> {
  if (!isObj(json) || !Array.isArray(json.plugins) || !Array.isArray(json.history) || !Array.isArray(json.centers)) return { ok: false, error: UNEXPECTED_SHAPE };
  const plugins: PausePlugin[] = [];
  for (const p of json.plugins) {
    const parsed = parsePausePlugin(p);
    if (!parsed) return { ok: false, error: UNEXPECTED_SHAPE };
    plugins.push(parsed);
  }
  const history: PauseHistoryRow[] = [];
  for (const h of json.history) {
    const parsed = parseHistory(h);
    if (!parsed) return { ok: false, error: UNEXPECTED_SHAPE };
    history.push(parsed);
  }
  const centers: PauseCenter[] = [];
  for (const c of json.centers) {
    if (!isObj(c) || !isStr(c.id) || !isStr(c.name) || !isStr(c.slug) || !isStr(c.environment)) return { ok: false, error: UNEXPECTED_SHAPE };
    centers.push({ id: c.id, name: c.name, slug: c.slug, environment: c.environment });
  }
  return { ok: true, value: { plugins, history, centers } };
}

/**
 * Apple Pay, Google Pay and Bank debit ride on a Card checkout and are chosen on Stripe's own payment page, which a pause
 * cannot change. Pausing one of them hides it from members in Community Connect; it does not stop Stripe from showing it.
 */
export const RIDER_PLUGIN_KEYS: readonly string[] = ["apple_pay", "google_pay", "bank_debit"];
export function riderPauseNote(key: string, label: string): string | null {
  return RIDER_PLUGIN_KEYS.includes(key)
    ? `${label} is chosen on Stripe's own payment page, which a pause cannot change. Pausing it hides it from members in Community Connect, but a card payment may still offer it. To stop payments through Stripe, pause Card.`
    : null;
}

/** Is the way to pay paused for everyone, or for any community? */
export function pauseSummary(p: PausePlugin): string {
  if (p.platform_pause) return "Paused for every community";
  if (p.centers.length === 1) return `Paused for ${p.centers[0].center_name}`;
  if (p.centers.length > 1) return `Paused for ${p.centers.length} communities`;
  return "Running";
}
