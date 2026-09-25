// Pure helpers for 2FA, step-up, phone verification, invitations and
// organization agreements (stream o-security). The database is the
// enforcement (supabase/migrations/0150–0156); these only decide what the
// portal shows and where it sends a session.

import type { Json } from "@/lib/database.types";

/** Minutes a 2FA check counts as "fresh" (app.has_recent_step_up's default). */
export const STEP_UP_MINUTES = 5;

function obj(v: Json | undefined): { [k: string]: Json | undefined } | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v : null;
}

/** centers.rules.security.require_2fa_for_staff — true unless the community set it to false (same default as the database). */
export function requires2faForStaff(rules: Json): boolean {
  const v = obj(obj(rules)?.security)?.require_2fa_for_staff;
  return typeof v === "boolean" ? v : true;
}

/** When the JWT's amr says the last authenticator-app check happened (unix seconds), or null. */
export function lastTotpAt(amr: unknown): number | null {
  if (!Array.isArray(amr)) return null;
  let best: number | null = null;
  for (const e of amr) {
    if (!e || typeof e !== "object") continue;
    const { method, timestamp } = e as { method?: unknown; timestamp?: unknown };
    if (method !== "totp") continue;
    const t = typeof timestamp === "number" ? timestamp : typeof timestamp === "string" && /^\d+$/.test(timestamp) ? Number(timestamp) : NaN;
    if (Number.isFinite(t) && (best === null || t > best)) best = t;
  }
  return best;
}

/** Mirrors app.has_recent_step_up: aal2 and a totp check within `minutes` (a little clock skew allowed). */
export function stepUpFresh(aal: unknown, amr: unknown, nowSeconds: number, minutes = STEP_UP_MINUTES): boolean {
  if (aal !== "aal2") return false;
  const t = lastTotpAt(amr);
  return t !== null && t >= nowSeconds - minutes * 60 && t <= nowSeconds + 120;
}

/** stepUpFresh against the current time (for server components). */
export function stepUpFreshNow(aal: unknown, amr: unknown, minutes = STEP_UP_MINUTES): boolean {
  return stepUpFresh(aal, amr, Math.floor(Date.now() / 1000), minutes);
}

/** Pages a staff session without 2FA can still open: its own security page, and nothing else inside the portal. */
export const SECURITY_PAGE = "/account/security";

/**
 * Where to send a portal session, or null to let it through. A staff member of
 * a community that requires 2FA, whose session has not passed 2FA (aal1), goes
 * to Account › Security to set up or enter their authenticator code.
 */
export function securityRedirect(opts: { requires: boolean; isStaff: boolean; aal: string | null; pathname: string | null }): string | null {
  if (!opts.requires || !opts.isStaff || opts.aal === "aal2") return null;
  const path = opts.pathname ?? "/";
  if (path === SECURITY_PAGE || path.startsWith(`${SECURITY_PAGE}/`) || path.startsWith("/account/")) return null;
  const next = path.startsWith("/") && !path.startsWith("//") ? path : "/";
  return `${SECURITY_PAGE}?required=1${next !== "/" ? `&next=${encodeURIComponent(next)}` : ""}`;
}

/** A safe in-portal path from ?next= (never another site). */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}

/**
 * A mobile number in E.164 (+17135550142). Ten digits are taken as a US
 * number; anything else must carry its country code. Null when it can't be one.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const plus = s.startsWith("+");
  const digits = s.replace(/[^\d]/g, "");
  if (!plus && digits.length === 10) return `+1${digits}`;
  if (!plus && digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (plus && /^[1-9]\d{7,14}$/.test(digits)) return `+${digits}`;
  return null;
}

/** "+1 (713) 555-0142" for US numbers, "+44 7700 900123" style spacing otherwise. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const d = e164.replace(/[^\d]/g, "");
  if (d.length === 11 && d.startsWith("1")) return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return `+${d}`;
}

/** The link an invitee opens. */
export function invitationLink(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/invite/${encodeURIComponent(token)}`;
}

/** Plain-English messages for the sign-in service's MFA and phone errors. */
export function explainAuthError(error: { message?: string; code?: string; status?: number } | null | undefined, doing: string): string {
  const msg = error?.message ?? "";
  const code = error?.code ?? "";
  let why: string;
  if (/invalid.*(totp|code)|mfa_verification_failed|otp_expired|expired or is invalid|invalid otp/i.test(`${code} ${msg}`)) {
    why = "that code is wrong or has expired. Codes change every 30 seconds — enter the one showing now";
  } else if (/insufficient_aal|aal2/i.test(`${code} ${msg}`)) {
    why = "this needs a fresh 2FA check first";
  } else if (/sms|provider|twilio|phone_provider_disabled|sms_send_failed|unsupported phone provider/i.test(`${code} ${msg}`)) {
    why = "texting sign-in codes is not set up for this service yet (Community Connect has to connect an SMS provider)";
  } else if (/rate limit|too many|over_sms_send_rate_limit|over_request_rate_limit/i.test(`${code} ${msg}`) || error?.status === 429) {
    why = "too many codes were requested. Wait a minute, then try again";
  } else if (/already.*(registered|exists|in use)|phone_exists|email_exists/i.test(`${code} ${msg}`)) {
    why = "that number is already used by another login";
  } else if (/friendly name/i.test(msg)) {
    why = "an authenticator with that name already exists. Remove the unfinished one and try again";
  } else if (/mfa_totp_enroll_not_enabled|mfa.*disabled/i.test(`${code} ${msg}`)) {
    why = "authenticator apps are not switched on for this sign-in service (Supabase Auth › Multi-Factor)";
  } else if (/fetch|network|ECONNREFUSED/i.test(msg)) {
    why = "the sign-in service could not be reached. Check the connection and try again";
  } else {
    why = msg || "the sign-in service gave no reason";
  }
  return `Could not ${doing} — ${why}.`;
}

// ── Organization agreements ────────────────────────────────────────────────
export const AGREEMENT_KINDS = ["terms", "dpa", "children_addendum", "sandbox_terms", "order_form"] as const;
export type AgreementKind = (typeof AGREEMENT_KINDS)[number];

export const AGREEMENT_LABEL: Record<AgreementKind, string> = {
  terms: "Terms of service",
  dpa: "Data processing agreement",
  children_addendum: "Children's data addendum",
  sandbox_terms: "Sandbox terms",
  order_form: "Order form",
};

export type AgreementRow = {
  kind: string;
  required: boolean;
  published: boolean;
  accepted: boolean;
  accepted_version: string | null;
  version: string | null;
};

export type AgreementState = "accepted" | "needs_acceptance" | "new_version" | "not_published" | "not_required";

/** What an agreement row needs from the owner. */
export function agreementState(r: AgreementRow): AgreementState {
  if (r.accepted) return "accepted";
  if (!r.published) return r.required ? "not_published" : "not_required";
  if (!r.required) return "not_required";
  return r.accepted_version && r.accepted_version !== r.version ? "new_version" : "needs_acceptance";
}

/** Role keys offered on the invitation form: community staff roles, never platform or family roles. */
export function invitableRoles<R extends { key: string; tier: string }>(roles: R[]): R[] {
  return roles.filter((r) => r.tier === "center" || r.tier === "operational");
}

/** The roles that start "pending" and need a second approver (app.enforce_role_grant). */
export const TWO_PERSON_ROLES = ["center_admin", "treasurer", "finance_volunteer", "executive_committee", "privacy_officer"] as const;

export function needsSecondApprover(roleKey: string): boolean {
  return (TWO_PERSON_ROLES as readonly string[]).includes(roleKey);
}

/** The audit reason of Community Connect's approval of an organization's first second administrator (0400, owner decision 1). */
export const CC_FIRST_ADMIN_REASON = "Community Connect approval (two-person rule, first second admin)";

/**
 * Mirrors app.is_first_second_admin_grant: a pending center_admin grant, in an organization with no
 * other active administrator besides the grantee and the owner. When Community Connect approves it,
 * the audit names the platform admin with CC_FIRST_ADMIN_REASON.
 */
export function isFirstSecondAdminGrant(
  grant: { role_key: string; user_id: string },
  grants: readonly { role_key: string; user_id: string; status: string; starts_at: string; ends_at: string | null }[],
  ownerUserId: string | null,
  now: Date = new Date(),
): boolean {
  if (grant.role_key !== "center_admin") return false;
  const t = now.getTime();
  return !grants.some(
    (o) =>
      o.role_key === "center_admin" &&
      o.status === "active" &&
      new Date(o.starts_at).getTime() <= t &&
      (o.ends_at === null || new Date(o.ends_at).getTime() > t) &&
      o.user_id !== grant.user_id &&
      o.user_id !== ownerUserId,
  );
}

export type InvitationRow = { expires_at: string; accepted_at: string | null; revoked_at: string | null };
export type InvitationStatus = "accepted" | "revoked" | "expired" | "pending";

export function invitationStatus(i: InvitationRow, now: Date = new Date()): InvitationStatus {
  if (i.accepted_at) return "accepted";
  if (i.revoked_at) return "revoked";
  return new Date(i.expires_at).getTime() <= now.getTime() ? "expired" : "pending";
}
