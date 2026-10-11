// The check the proxy makes on every request of a demo session (B88 part 2). A session with a demo address is let through only when
// the database says "ok": a demo person whose session is on record, has not ended, has not run out of its two hours and whose switch
// is still on. Everything else (expired, switched off, unknown, or a check that could not be made) ends the session. Fail closed.
//
// This is the portal's side; the database enforces the same: it deletes the Auth session of an ended demo session, so it cannot be
// refreshed either (app.demo_session_state, app.demo_end).

import { isDemoClaims, type DemoEndReason } from "./rules";

/** The cookie of the organization chosen with the switcher (src/lib/center-resolve.ts CENTER_COOKIE; a test keeps them equal). The proxy cannot import that server-only file. */
export const CENTER_COOKIE_NAME = "cc_center";

export type GuardOutcome = { kind: "not_demo" } | { kind: "ok" } | { kind: "ended"; reason: DemoEndReason };

/** `check` asks app.demo_session_state() as the signed-in person and returns its answer (it may throw). */
export async function guardDemoSession(
  claims: { email?: unknown; app_metadata?: unknown } | null | undefined,
  check: () => Promise<unknown>,
): Promise<GuardOutcome> {
  if (!isDemoClaims(claims)) return { kind: "not_demo" };
  let answer: unknown;
  try {
    answer = await check();
  } catch (error) {
    console.error("[demo] could not check the demo session (it is ended):", error);
    return { kind: "ended", reason: "error" };
  }
  const state = answer && typeof answer === "object" ? (answer as { state?: unknown }).state : undefined;
  if (state === "ok") return { kind: "ok" };
  if (state === "expired") return { kind: "ended", reason: "expired" };
  if (state === "off") return { kind: "ended", reason: "off" };
  // "unknown" (not on record, or already ended) and "not_demo" (a demo address that is not a registered demo person).
  return { kind: "ended", reason: "unknown" };
}

/** Where an ended session is sent: the demo page, with the reason. The demo page itself is never redirected (it is where one starts again). */
export function endedRedirect(pathname: string, reason: DemoEndReason): { kind: "stay" } | { kind: "api" } | { kind: "redirect"; location: string } {
  if (pathname === "/demo" || pathname.startsWith("/demo/")) return { kind: "stay" };
  if (pathname === "/api" || pathname.startsWith("/api/")) return { kind: "api" };
  return { kind: "redirect", location: `/demo?ended=${reason}` };
}

/** The names of Supabase Auth's session cookies in a request (sb-<project>-auth-token, possibly in chunks), to clear when a session ends. */
export function authCookieNames(names: readonly string[]): string[] {
  return names.filter((n) => /^sb-.+-auth-token(\.\d+)?$/.test(n) || /^sb-.+-auth-token-code-verifier$/.test(n));
}
