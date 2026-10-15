import { FOREIGN_ORIGIN, UNREADABLE_REQUEST, jsonReply, originAllowed, preflightReply, sessionReply } from "@/lib/demo-signin/app-api";
import { loadDemoChoices, startDemoForApp } from "@/lib/demo-signin/server";
import { clientIpFrom } from "@/lib/platform-onboarding";

// POST /api/demo/session { "persona": "<id from /api/demo/choices>" }: the member app's "Try the demo" (docs/MEMBER_APP_DEMO.md).
// The same start as the portal's /demo page (src/lib/demo-signin/start.ts: the switch, the person, the two-hour session, the limits per
// visitor address and for the platform, the audit entries, the Auth session tied to the demo session), but the session is returned in
// the answer instead of being set as a cookie. The caller's own cookies are never read, set or cleared.
export const dynamic = "force-dynamic";

/** A request body is a few dozen bytes; anything much bigger is not for this endpoint. */
const MAX_BODY_CHARS = 4096;

export function OPTIONS(req: Request) {
  return preflightReply(req.headers.get("origin"));
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  // A page on another site cannot read the answer (no CORS headers), and it does not get to start a demo either. The app has no Origin.
  if (!originAllowed(origin)) return jsonReply(origin, { status: 403, body: { ok: false, error: FOREIGN_ORIGIN, code: "failed" } });

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_CHARS) throw new Error("the body is too big");
    body = JSON.parse(text);
  } catch {
    return jsonReply(origin, { status: 400, body: { ok: false, error: UNREADABLE_REQUEST, code: "failed" } });
  }

  let reply: Awaited<ReturnType<typeof sessionReply>>;
  try {
    reply = await sessionReply(body, clientIpFrom(req.headers.get("x-forwarded-for"), req.headers.get("x-real-ip")), {
      loadChoices: loadDemoChoices,
      start: startDemoForApp,
    });
  } catch (error) {
    console.error("[demo] POST /api/demo/session failed unexpectedly:", error);
    reply = { status: 500, body: { ok: false, error: "Could not start the demo — something went wrong on our side. Please try again in a minute.", code: "failed" } };
  }
  return jsonReply(origin, reply);
}
