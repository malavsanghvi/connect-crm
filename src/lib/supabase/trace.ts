// Traceability headers (WAVE2 contract). Every Supabase client the portal
// creates sends these; app.audit_row() copies them into app.audit_log so each
// change records which app and screen it came from, the request it belonged
// to and — when the form asked for one — why it was made. Pure and shared by
// the server, browser and proxy code.

export const CLIENT_APP = "portal";
/** Request header the proxy sets to the page's pathname (read by server clients). */
export const PATHNAME_HEADER = "x-pathname";

export const REASON_MAX = 500;
export const SCREEN_MAX = 200;

/**
 * A fresh uuid (Web Crypto — available in Node 20+, the edge and browsers).
 * Browsers only offer randomUUID() on secure origins (https, localhost); on a
 * plain-http address (a bare droplet IP, a new <slug>.<domain> before its
 * certificate) it is built from getRandomValues(), which works everywhere.
 */
export function newRequestId(): string {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The reason as the database expects it: trimmed, at most 500 characters, then URL-encoded (header-safe). */
export function encodeAuditReason(reason: string): string {
  const trimmed = Array.from(reason.trim()).slice(0, REASON_MAX).join("");
  return encodeURIComponent(trimmed);
}

/** A route pathname made header-safe: printable ASCII only, at most 200 characters. */
export function clientScreen(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const clean = pathname.replace(/[^\x20-\x7e]/g, "").slice(0, SCREEN_MAX);
  return clean || null;
}

/** The headers for one client: x-client-app, x-request-id, x-client-screen and (optionally) x-audit-reason. */
export function traceHeaders(opts: { requestId: string; screen?: string | null; reason?: string | null }): Record<string, string> {
  const h: Record<string, string> = { "x-client-app": CLIENT_APP, "x-request-id": opts.requestId };
  const screen = clientScreen(opts.screen);
  if (screen) h["x-client-screen"] = screen;
  if (opts.reason && opts.reason.trim()) h["x-audit-reason"] = encodeAuditReason(opts.reason);
  return h;
}

/**
 * A fetch that stamps a NEW x-request-id and the current screen on every
 * request (browser clients live across many user actions, so a fixed id
 * would tie unrelated changes together).
 */
export function tracingFetch(screen: () => string | null, base: typeof fetch = (input, init) => fetch(input, init)): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    for (const [k, v] of Object.entries(traceHeaders({ requestId: newRequestId(), screen: screen() }))) headers.set(k, v);
    return base(input, { ...init, headers });
  };
}
