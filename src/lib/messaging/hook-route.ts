import "server-only";

import { NextResponse } from "next/server";

import { verifyStandardWebhook } from "./signatures";

// Shared by the two Supabase Auth hook routes: read the raw body, check the
// standard-webhooks signature with the hook secret, answer in the shape GoTrue
// expects ({} on success, {error: {http_code, message}} otherwise — GoTrue shows
// the message to the person signing in).

export function hookError(status: number, message: string): NextResponse {
  return NextResponse.json({ error: { http_code: status, message } }, { status });
}

export async function verifiedHookBody(request: Request, secretName: "SEND_EMAIL_HOOK_SECRET" | "SEND_SMS_HOOK_SECRET"):
  Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse }> {
  const secret = process.env[secretName]?.trim();
  if (!secret) {
    console.error(`[auth-hook] ${secretName} is not set on the portal server`);
    return { ok: false, response: hookError(503, "Sign-in messages aren't configured on the Community Connect server yet.") };
  }
  const raw = await request.text();
  const verdict = verifyStandardWebhook(secret, {
    id: request.headers.get("webhook-id"),
    timestamp: request.headers.get("webhook-timestamp"),
    signature: request.headers.get("webhook-signature"),
  }, raw);
  if (!verdict.ok) {
    console.error(`[auth-hook] refused a request: ${verdict.reason}`);
    return { ok: false, response: hookError(401, "The request could not be verified.") };
  }
  try {
    const body = JSON.parse(raw) as unknown;
    if (!body || typeof body !== "object") throw new Error("not an object");
    return { ok: true, body: body as Record<string, unknown> };
  } catch (err) {
    console.error("[auth-hook] the body is not JSON:", err instanceof Error ? err.message : err);
    return { ok: false, response: hookError(400, "The request body is not valid.") };
  }
}
