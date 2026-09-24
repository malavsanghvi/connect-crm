import { NextResponse, type NextRequest } from "next/server";

import { NotConfigured, ingestWebhook, serviceClient, verifyPaypalWebhook } from "@/lib/payments/server";
import { paypalVerifyBody } from "@/lib/payments/signature";

// PayPal → Community Connect. PayPal checks its own signature
// (verify-webhook-signature with PAYPAL_WEBHOOK_ID / PAYPAL_SANDBOX_WEBHOOK_ID);
// only a confirmed event is stored (app.ingest_webhook) and handed to
// payments.webhook.paypal.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    console.error("[webhooks/paypal] the body was not JSON:", err);
    return new NextResponse("The body is not JSON.", { status: 400 });
  }
  if (typeof event.id !== "string" || typeof event.event_type !== "string") return new NextResponse("Not a PayPal event.", { status: 400 });
  let verified: { ok: boolean; reason: string };
  try {
    verified = await verifyPaypalWebhook((id) => paypalVerifyBody(req.headers, id, event));
  } catch (err) {
    if (err instanceof NotConfigured) {
      console.error(`[webhooks/paypal] ${err.message}`);
      return new NextResponse(err.message, { status: 503 });
    }
    console.error("[webhooks/paypal] could not check the signature:", err);
    return new NextResponse("The signature could not be checked; PayPal will send it again.", { status: 502 });
  }
  if (!verified.ok) {
    console.warn(`[webhooks/paypal] refused ${event.id}: ${verified.reason}`);
    return new NextResponse(`Signature check failed: ${verified.reason}.`, { status: 400 });
  }
  const db = serviceClient("/api/webhooks/paypal");
  if (!db) {
    console.error("[webhooks/paypal] SUPABASE_SERVICE_ROLE_KEY (or the Supabase URL) is not set; the event was not stored");
    return new NextResponse("Webhooks aren't configured on the Community Connect server yet (SUPABASE_SERVICE_ROLE_KEY is not set).", { status: 503 });
  }
  const { data, error } = await ingestWebhook(db, "paypal", event.id, event.event_type, event);
  if (error) {
    console.error(`[webhooks/paypal] could not store ${event.id}:`, error);
    return new NextResponse("The event could not be stored; PayPal will send it again.", { status: 500 });
  }
  return NextResponse.json({ received: true, id: data });
}
