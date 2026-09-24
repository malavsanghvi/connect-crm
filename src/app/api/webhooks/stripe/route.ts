import { NextResponse, type NextRequest } from "next/server";

import { secretsFrom, verifyStripeSignature } from "@/lib/payments/signature";
import { ingestWebhook, serviceClient } from "@/lib/payments/server";

// Stripe → Community Connect. The signature is checked with STRIPE_WEBHOOK_SECRET
// (comma-separated when the platform and Connect endpoints have different
// secrets) before anything is stored; then app.ingest_webhook stores the event
// once (idempotent on its id) and queues payments.webhook.stripe for the
// background service. A 2xx only after the event is safely stored, so Stripe
// retries anything that did not land.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secrets = secretsFrom(process.env.STRIPE_WEBHOOK_SECRET);
  if (secrets.length === 0) {
    console.error("[webhooks/stripe] STRIPE_WEBHOOK_SECRET is not set; the event was refused");
    return new NextResponse("Stripe isn't configured on the Community Connect server yet (STRIPE_WEBHOOK_SECRET is not set).", { status: 503 });
  }
  const raw = await req.text();
  const check = verifyStripeSignature(raw, req.headers.get("stripe-signature"), secrets);
  if (!check.ok) {
    console.warn(`[webhooks/stripe] refused an event: ${check.reason}`);
    return new NextResponse(`Signature check failed: ${check.reason}.`, { status: 400 });
  }
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    console.error("[webhooks/stripe] a signed body was not JSON:", err);
    return new NextResponse("The body is not JSON.", { status: 400 });
  }
  if (typeof event.id !== "string" || typeof event.type !== "string") return new NextResponse("Not a Stripe event.", { status: 400 });
  const db = serviceClient("/api/webhooks/stripe");
  if (!db) {
    console.error("[webhooks/stripe] SUPABASE_SERVICE_ROLE_KEY (or the Supabase URL) is not set; the event was not stored");
    return new NextResponse("Webhooks aren't configured on the Community Connect server yet (SUPABASE_SERVICE_ROLE_KEY is not set).", { status: 503 });
  }
  const { data, error } = await ingestWebhook(db, "stripe", event.id, event.type, event);
  if (error) {
    console.error(`[webhooks/stripe] could not store ${event.id}:`, error);
    return new NextResponse("The event could not be stored; Stripe will send it again.", { status: 500 });
  }
  return NextResponse.json({ received: true, id: data });
}
