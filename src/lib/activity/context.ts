import type { ActivityContext } from "./record";

/**
 * The signed-in session as a recording context, or null when there is none (signed out, not configured, an
 * error). The session module is loaded on first use, not at import, so the shared form helpers can import
 * withActivity without pulling in server-only code. loadSession is cached per request, so asking for it
 * costs nothing when the action has already loaded it (they all do, to check the permission).
 */
export async function currentActivityContext(): Promise<ActivityContext | null> {
  try {
    const { loadSession } = await import("@/lib/session");
    const state = await loadSession();
    return state.status === "ok" ? state.session : null;
  } catch {
    return null;
  }
}
