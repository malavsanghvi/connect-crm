import "server-only";

import { NextResponse } from "next/server";

import { workerQuery } from "./server-db";

// Provider webhooks: after the route checked the signature, the event is stored
// (idempotent on provider + event id) and a messaging.webhook.<email|twilio> job
// queued; the background service does the rest. Missing configuration → 503
// with a plain message, logged; nothing is faked.

export function notConfigured(what: string, names: string[]): NextResponse {
  console.error(`[webhook] ${what}: ${names.join(", ")} not set on the portal server`);
  return new NextResponse(`${what} isn't configured on the Community Connect server yet.`, { status: 503 });
}

export async function ingest(provider: "resend" | "postmark" | "twilio", eventId: string, type: string, payload: unknown): Promise<NextResponse | null> {
  try {
    const rows = await workerQuery<{ r: { duplicate: boolean } }>("select app.ingest_messaging_webhook($1, $2, $3, $4, $5) as r", [
      provider, eventId, type, null, JSON.stringify(payload ?? {}),
    ]);
    if (rows === null) return notConfigured("Messaging webhooks", ["PORTAL_DATABASE_URL"]);
    return null;
  } catch (err) {
    console.error(`[webhook] could not store the ${provider} event ${eventId}:`, err instanceof Error ? err.message : err);
    // 500: the provider retries later, so nothing is lost.
    return new NextResponse("The event could not be stored; it will be retried.", { status: 500 });
  }
}

/** The public URL a provider called (behind the proxy, request.url is the internal one). */
export function publicUrl(request: Request, path: string): string {
  const base = process.env.PORTAL_PUBLIC_URL?.trim();
  if (base) return `${base.replace(/\/+$/, "")}${path}`;
  const u = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? u.host;
  return `${proto}://${host}${path}`;
}
