import { NextResponse } from "next/server";

import { verifyStandardWebhook } from "@/lib/messaging/signatures";
import { ingest, notConfigured } from "@/lib/messaging/webhook-route";

// Resend delivery events (Svix-signed): delivered, opened, bounced, complained.
// Bounces and complaints suppress the address (messaging.webhook.email).
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) return notConfigured("Resend webhooks", ["RESEND_WEBHOOK_SECRET"]);
  const raw = await request.text();
  const id = request.headers.get("svix-id");
  const v = verifyStandardWebhook(secret, { id, timestamp: request.headers.get("svix-timestamp"), signature: request.headers.get("svix-signature") }, raw);
  if (!v.ok) {
    console.error(`[webhook] refused a Resend event: ${v.reason}`);
    return new NextResponse("Signature check failed.", { status: 401 });
  }
  let body: { type?: string };
  try {
    body = JSON.parse(raw) as { type?: string };
  } catch (err) {
    console.error("[webhook] a Resend event is not JSON:", err instanceof Error ? err.message : err);
    return new NextResponse("Not JSON.", { status: 400 });
  }
  const failed = await ingest("resend", id!, String(body.type ?? "unknown"), body);
  return failed ?? NextResponse.json({ ok: true });
}
