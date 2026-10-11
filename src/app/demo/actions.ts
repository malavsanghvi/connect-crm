"use server";

import { redirect } from "next/navigation";

import { leaveDemoFromRequest, startDemoFromRequest } from "@/lib/demo-signin/server";
import type { ActionResult } from "@/lib/errors";

// "Try the demo" (B88 part 2). Both actions are public Server Actions (a visitor has no account yet): Next.js refuses a request
// that comes from another site, and everything that matters is decided by the database (the platform switch, the person, the limits).

/** Start a demo session for the chosen demo person. On success the browser goes to Home ("Today" in the new look). */
export async function startDemoAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const res = await startDemoFromRequest(String(fd.get("persona") ?? ""));
  if (!res.ok) return { ok: false, error: res.error };
  redirect("/");
}

/** End this demo session and go back to the choice of people. */
export async function leaveDemoAction(): Promise<ActionResult> {
  const res = await leaveDemoFromRequest();
  if (!res.ok) return { ok: false, error: res.error };
  redirect("/demo?ended=left");
}
