"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { leaveDemoFromRequest, startDemoFromRequest } from "@/lib/demo-signin/server";
import type { ActionResult } from "@/lib/errors";
import { LOOK_COOKIE } from "@/lib/look";

// "Try the demo" (B88 part 2). Both actions are public Server Actions (a visitor has no account yet): Next.js refuses a request
// that comes from another site, and everything that matters is decided by the database (the platform switch, the person, the limits).

/**
 * A demo shows the newest look of the portal (docs/DEMO_SIGNIN.md "The demo shows the newest look"): a visitor who has not chosen a look
 * in this browser gets the New look for the length of the browser session. A look they chose themselves is left alone, and the cookie is
 * not kept (no maxAge), so it does not follow them to a real community afterwards.
 */
async function showTheNewLookInTheDemo(): Promise<void> {
  try {
    const jar = await cookies();
    if (jar.get(LOOK_COOKIE)) return;
    // Loaded here, not at the top, so that importing this file never needs the server-only request helpers.
    const { currentOrigin } = await import("@/lib/center-resolve");
    const origin = await currentOrigin();
    jar.set(LOOK_COOKIE, "v2", { path: "/", sameSite: "lax", secure: origin.protocol.startsWith("https") });
  } catch (error) {
    // The demo still starts, in the classic look; nothing the visitor did is lost.
    console.error("[demo] could not set the New look for the demo:", error);
  }
}

/** Start a demo session for the chosen demo person. On success the browser goes to Home ("Today" in the new look). */
export async function startDemoAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const res = await startDemoFromRequest(String(fd.get("persona") ?? ""));
  if (!res.ok) return { ok: false, error: res.error };
  await showTheNewLookInTheDemo();
  redirect("/");
}

/** End this demo session and go back to the choice of people. */
export async function leaveDemoAction(): Promise<ActionResult> {
  const res = await leaveDemoFromRequest();
  if (!res.ok) return { ok: false, error: res.error };
  redirect("/demo?ended=left");
}
