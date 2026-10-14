// A page that was open while the portal was updated still holds the old build's Server Action ids. Next answers such a
// call with "Server Action <id> was not found on the server" and nothing runs. Without this, the person sees a raw
// error page ("This page could not be shown") for a click that did nothing wrong. Here it becomes a plain sentence
// next to what they did, with a Reload button (nothing was saved, so reloading and repeating the click is safe).
// Safe to import from client code.

import { unstable_isUnrecognizedActionError } from "next/navigation";

import type { ActionResult } from "@/lib/errors";

export const STALE_PAGE_MESSAGE =
  "The portal was updated while this page was open, so that did not go through and nothing was saved. Reload the page, then do it again.";

/** True for the error Next raises when the page's Server Action no longer exists on the server (an old page after a deploy). */
export function isStalePageError(error: unknown): boolean {
  if (unstable_isUnrecognizedActionError(error)) return true;
  const message = error && typeof error === "object" && "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  return /Server Action ".*" was not found on the server/.test(message);
}

/** A Server Action wrapped so that a stale page gets the plain-English `{ ok: false, stale: true }` instead of throwing. Other errors still throw. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function guardStalePage<Args extends unknown[]>(action: (...args: Args) => Promise<ActionResult<any>>): (...args: Args) => Promise<ActionResult<any>> {
  return async (...args: Args) => {
    try {
      return await action(...args);
    } catch (e) {
      if (isStalePageError(e)) return { ok: false, error: STALE_PAGE_MESSAGE, stale: true };
      throw e;
    }
  };
}
