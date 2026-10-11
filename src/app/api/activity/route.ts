import { NextResponse, type NextRequest } from "next/server";

import { MAX_BEACON_BYTES, parseBeacon } from "@/lib/activity/ingest";
import { runAfterResponse } from "@/lib/activity/schedule";
import { sendEvents } from "@/lib/activity/send";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// The screen beacon (src/components/shell/activity-beacon.tsx) posts here, because navigator.sendBeacon can
// reach a route handler as the page closes and cannot call a Server Action.
//   POST /api/activity   { centerId, sessionId?, events: [{ key: "screen:/events/[id]", duration_ms, seq?, at? }] }
// Signed-in staff only (the proxy sends everyone else to /login; the sign-in is checked again here). The body is
// read as screens and nothing else (src/lib/activity/ingest.ts): a screen pattern is re-checked so no id or query
// string can pass, and the person and the community come from the sign-in inside app.record_activity, which does
// nothing while the community's recording switch is off. The answer is empty: nothing reads it.
export const dynamic = "force-dynamic";

const reply = (status: number) => new NextResponse(null, { status, headers: { "cache-control": "private, no-store" } });

export async function POST(req: NextRequest) {
  // A page on another site cannot make a staff browser report screens.
  if (req.headers.get("sec-fetch-site") === "cross-site") return reply(403);
  if (!(req.headers.get("content-type") ?? "").includes("json")) return reply(415);
  const length = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_BEACON_BYTES) return reply(413);

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BEACON_BYTES) return reply(413);
    body = JSON.parse(text);
  } catch {
    return reply(400);
  }
  const accepted = parseBeacon(body);
  if (!accepted) return reply(400);

  try {
    const db = await createSupabaseServerClient();
    const { data } = await db.auth.getClaims();
    if (!data?.claims?.sub) return reply(401);
    runAfterResponse(async () => {
      await sendEvents(db, accepted.centerId, accepted.events);
    });
    return reply(204);
  } catch (error) {
    console.error("[activity] the screen beacon could not be handled:", error instanceof Error ? error.message : String(error));
    return reply(503);
  }
}
