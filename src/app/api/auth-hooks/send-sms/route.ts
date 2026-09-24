import { NextResponse } from "next/server";

import { hookError, verifiedHookBody } from "@/lib/messaging/hook-route";
import { sendSignInSms, type HookUser } from "@/lib/messaging/sign-in";

// Supabase Auth "send SMS" hook (ONBOARDING_PLAN §4 Step 1.4): phone sign-in and
// phone-verification codes, branded for the person's community, through Twilio.
// Configure it in Supabase › Auth › Hooks; the secret is SEND_SMS_HOOK_SECRET.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const v = await verifiedHookBody(request, "SEND_SMS_HOOK_SECRET");
  if (!v.ok) return v.response;
  const user = (v.body.user ?? {}) as HookUser;
  const otp = String(((v.body.sms ?? {}) as { otp?: unknown }).otp ?? "");
  const r = await sendSignInSms(user, otp);
  return r.ok ? NextResponse.json({}) : hookError(r.status, r.message);
}
