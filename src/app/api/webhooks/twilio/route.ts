import { NextResponse } from "next/server";

import { verifyTwilio } from "@/lib/messaging/signatures";
import { ingest, notConfigured, publicUrl } from "@/lib/messaging/webhook-route";

// Twilio status callbacks (delivered / failed) and inbound texts (STOP, START,
// HELP), signed with X-Twilio-Signature (TWILIO_AUTH_TOKEN). The answer is an
// empty TwiML response; the STOP / HELP replies are sent by the background
// service (messaging.webhook.twilio) so they are recorded like any message.
export const dynamic = "force-dynamic";

const TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

export async function POST(request: Request) {
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!token) return notConfigured("Twilio webhooks", ["TWILIO_AUTH_TOKEN"]);
  const raw = await request.text();
  const params = Object.fromEntries(new URLSearchParams(raw));
  const v = verifyTwilio(token, publicUrl(request, "/api/webhooks/twilio"), params, request.headers.get("x-twilio-signature"));
  if (!v.ok) {
    console.error(`[webhook] refused a Twilio callback: ${v.reason}`);
    return new NextResponse("Signature check failed.", { status: 401 });
  }
  const sid = params.MessageSid ?? params.SmsSid ?? "";
  if (!sid) return new NextResponse("No MessageSid.", { status: 400 });
  const type = params.MessageStatus ? `status.${params.MessageStatus}` : "inbound";
  const failed = await ingest("twilio", `${sid}:${params.MessageStatus ?? "inbound"}`, type, params);
  return failed ?? new NextResponse(TWIML, { status: 200, headers: { "content-type": "text/xml" } });
}
