import { NextResponse } from "next/server";

import { verifyBasicToken } from "@/lib/messaging/signatures";
import { ingest, notConfigured } from "@/lib/messaging/webhook-route";
import { loadPlatformConfig, platformValue } from "@/lib/platform-setup/server-config";

// Postmark delivery / bounce / spam-complaint webhooks. Postmark signs nothing;
// its dashboard sends HTTP Basic credentials whose password is POSTMARK_WEBHOOK_TOKEN.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  await loadPlatformConfig();
  const token = platformValue("POSTMARK_WEBHOOK_TOKEN");
  if (!token) return notConfigured("Postmark webhooks", ["POSTMARK_WEBHOOK_TOKEN"]);
  const v = verifyBasicToken(token, request.headers.get("authorization"));
  if (!v.ok) {
    console.error(`[webhook] refused a Postmark event: ${v.reason}`);
    return new NextResponse("Credentials check failed.", { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch (err) {
    console.error("[webhook] a Postmark event is not JSON:", err instanceof Error ? err.message : err);
    return new NextResponse("Not JSON.", { status: 400 });
  }
  const type = String(body.RecordType ?? "unknown");
  const eventId = `${type}:${String(body.ID ?? body.MessageID ?? "")}:${String(body.BouncedAt ?? body.DeliveredAt ?? body.ReceivedAt ?? body.FirstOpen ?? "")}`;
  const failed = await ingest("postmark", eventId, type, body);
  return failed ?? NextResponse.json({ ok: true });
}
