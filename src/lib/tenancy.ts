// More than one organization in the portal (docs/ONBOARDING_PLAN.md §7):
// which organization a request is for, the addresses of the others, and the
// plain-English labels of the sandbox limits (entitlements, 0160).
//
// Pure functions only; the server-side resolver is src/lib/center-resolve.ts.

import type { Json } from "@/lib/database.types";

export const SANDBOX_WATERMARK = "Sandbox · test data";

/** A center slug as the database accepts it (and as a DNS label allows). */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Lower-case host name without port or trailing dot; null for an empty header. */
export function hostName(raw: string | null | undefined): string | null {
  let h = (raw ?? "").trim().toLowerCase();
  if (!h) return null;
  if (h.startsWith("[")) {
    // IPv6 literal: "[::1]:3000"
    const end = h.indexOf("]");
    return end > 0 ? h.slice(0, end + 1) : null;
  }
  h = h.replace(/:\d+$/, "").replace(/\.$/, "");
  return h || null;
}

function isIpOrLocal(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost") || host.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/** Normalize PORTAL_BASE_DOMAIN ("https://CommunityConnect.app/" → "communityconnect.app"); null when unset or invalid. */
export function normalizeBaseDomain(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "").replace(/^\.+|\.+$/g, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v) ? v : null;
}

export type HostResolution =
  /** <slug>.<base domain> */
  | { kind: "subdomain"; slug: string }
  /** Some other name: maybe an organization's own domain (app.center_domains), or the deployment's own site. */
  | { kind: "custom"; host: string }
  /** Bare IP, localhost or the base domain itself: use the switcher cookie or NEXT_PUBLIC_CENTER_SLUG. */
  | { kind: "none" };

export function resolveHost(rawHost: string | null | undefined, baseDomain: string | null): HostResolution {
  const host = hostName(rawHost);
  if (!host || isIpOrLocal(host)) return { kind: "none" };
  if (baseDomain) {
    if (host === baseDomain || host === `www.${baseDomain}`) return { kind: "none" };
    if (host.endsWith(`.${baseDomain}`)) {
      const label = host.slice(0, -(baseDomain.length + 1));
      return !label.includes(".") && SLUG_RE.test(label) ? { kind: "subdomain", slug: label } : { kind: "none" };
    }
  }
  return host.includes(".") ? { kind: "custom", host } : { kind: "none" };
}

/**
 * The cookie domain that lets one sign-in cover every <slug>.<base> portal,
 * so the organization switcher does not ask for a new code. Undefined
 * (host-only cookies, as before) anywhere else.
 */
export function sharedCookieDomain(rawHost: string | null | undefined, baseDomain: string | null): string | undefined {
  const host = hostName(rawHost);
  if (!host || !baseDomain) return undefined;
  return host === baseDomain || host.endsWith(`.${baseDomain}`) ? baseDomain : undefined;
}

export type SwitchTarget = { slug: string; portal_domain: string | null };

/**
 * Where the switcher sends the user for another organization: its own domain,
 * its <slug>.<base> address when this portal is served from the base domain,
 * or null when the portal has one address for everyone (a bare IP, localhost,
 * a single-site deployment): then the choice is kept in a cookie instead.
 */
export function switchUrl(target: SwitchTarget, current: { protocol: string; host: string | null }, baseDomain: string | null): string | null {
  const host = hostName(current.host);
  const proto = current.protocol === "http" || current.protocol === "http:" ? "http:" : "https:";
  if (target.portal_domain) return `${proto}//${target.portal_domain}/`;
  if (!host || !baseDomain || !(host === baseDomain || host.endsWith(`.${baseDomain}`))) return null;
  const port = (current.host ?? "").trim().match(/:(\d+)$/)?.[1];
  return `${proto}//${target.slug}.${baseDomain}${port ? `:${port}` : ""}/`;
}

// ── Entitlements ─────────────────────────────────────────────────────────────

type EntitlementKind = "count" | "bytes" | "flag" | "mode";

export const ENTITLEMENT_INFO: Record<string, { label: string; kind: EntitlementKind; modes?: Record<string, string> }> = {
  max_people: { label: "People saved", kind: "count" },
  max_households: { label: "Households saved", kind: "count" },
  "messaging.recipients": {
    label: "Email, text and WhatsApp recipients",
    kind: "mode",
    modes: { all: "Everyone who opted in", test_only: "Verified test recipients only" },
  },
  "payments.mode": { label: "Payments", kind: "mode", modes: { live: "Live", test: "Provider test mode only" } },
  "qbo.mode": {
    label: "QuickBooks",
    kind: "mode",
    modes: { live: "Live posting", sandbox_or_read_only: "Intuit sandbox, or the real company read-only" },
  },
  public_dashboard: { label: "Public community dashboard", kind: "flag" },
  "niva.monthly_questions": { label: "Niva questions per month", kind: "count" },
  "storage.bytes": { label: "File storage", kind: "bytes" },
  expiry_days_inactive: { label: "Expires after days without activity", kind: "count" },
  // f-sandbox (0500): a sandbox that holds the organization's own records (JSH) goes live in place.
  "promotion.in_place": { label: "Going live keeps this organization and its records", kind: "flag" },
};

/** Rows in the order of ENTITLEMENT_INFO (people, households, messaging, …); unknown keys last. */
export function sortEntitlements<T extends { key: string }>(rows: T[]): T[] {
  const order = Object.keys(ENTITLEMENT_INFO);
  const rank = (k: string) => (order.indexOf(k) < 0 ? order.length : order.indexOf(k));
  return [...rows].sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
}

export function entitlementLabel(key: string): string {
  return ENTITLEMENT_INFO[key]?.label ?? key;
}

function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${+(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${+(n / 1024 ** 2).toFixed(1)} MB`;
  return `${n.toLocaleString("en-US")} bytes`;
}

/** "2,000", "2 GB", "On", "Verified test recipients only", "No limit". */
export function formatEntitlement(key: string, value: Json | undefined): string {
  if (value === undefined) return "—";
  if (value === null) return key === "expiry_days_inactive" ? "Never expires" : "No limit";
  const info = ENTITLEMENT_INFO[key];
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "number") return info?.kind === "bytes" ? formatBytes(value) : value.toLocaleString("en-US");
  if (typeof value === "string") return info?.modes?.[value] ?? value;
  return JSON.stringify(value);
}

/**
 * Parse what a platform admin typed for an override. Blank means "remove the
 * override" (value null); "none"/"unlimited" means no limit (JSON null).
 * Storage accepts "2 GB", "500 MB" or a byte count.
 */
export function parseEntitlementInput(
  key: string,
  raw: string,
): { ok: true; remove: true } | { ok: true; remove: false; value: Json } | { ok: false; error: string } {
  const info = ENTITLEMENT_INFO[key];
  if (!info) return { ok: false, error: `there is no limit called "${key}"` };
  const v = raw.trim();
  if (!v) return { ok: true, remove: true };
  if (/^(none|no limit|unlimited)$/i.test(v)) {
    return info.kind === "count" || info.kind === "bytes"
      ? { ok: true, remove: false, value: null }
      : { ok: false, error: `${info.label} is not a number limit, so it cannot be unlimited` };
  }
  if (info.kind === "flag") {
    if (/^(on|yes|true)$/i.test(v)) return { ok: true, remove: false, value: true };
    if (/^(off|no|false)$/i.test(v)) return { ok: true, remove: false, value: false };
    return { ok: false, error: "choose On or Off" };
  }
  if (info.kind === "mode") {
    const modes = info.modes ?? {};
    const match = Object.keys(modes).find((m) => m === v || modes[m].toLowerCase() === v.toLowerCase());
    return match ? { ok: true, remove: false, value: match } : { ok: false, error: `choose one of: ${Object.values(modes).join(", ")}` };
  }
  if (info.kind === "bytes") {
    const m = v.replace(/,/g, "").match(/^(\d+(?:\.\d+)?)\s*(gb|mb|bytes?)?$/i);
    if (!m) return { ok: false, error: 'enter a size such as "2 GB" or "500 MB"' };
    const unit = (m[2] ?? "bytes").toLowerCase();
    const n = Number(m[1]) * (unit === "gb" ? 1024 ** 3 : unit === "mb" ? 1024 ** 2 : 1);
    return Number.isFinite(n) ? { ok: true, remove: false, value: Math.round(n) } : { ok: false, error: "that size is too large" };
  }
  const n = Number(v.replace(/,/g, ""));
  if (!Number.isInteger(n) || n < 0) return { ok: false, error: "enter a whole number (0 or more), or \"No limit\"" };
  return { ok: true, remove: false, value: n };
}

/** The join code as printed: "7K4M-Q2PD". */
export function formatJoinCode(code: string): string {
  const c = code.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

/** The member-app link a join QR code carries. */
export function joinAppLink(code: string): string {
  return `communityconnect://join/${code.replace(/[^A-Z0-9]/gi, "").toUpperCase()}`;
}

/** The web link for the same code, when the member web app's address is known (NEXT_PUBLIC_MEMBER_APP_URL). */
export function joinWebLink(code: string, memberAppUrl: string | null | undefined): string | null {
  const base = (memberAppUrl ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^/\s]+/i.test(base)) return null;
  return `${base}/join/${code.replace(/[^A-Z0-9]/gi, "").toUpperCase()}`;
}
