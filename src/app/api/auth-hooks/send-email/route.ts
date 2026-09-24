import { NextResponse } from "next/server";

import { hookError, verifiedHookBody } from "@/lib/messaging/hook-route";
import { sendSignInEmail, type HookUser } from "@/lib/messaging/sign-in";

// Supabase Auth "send email" hook (ONBOARDING_PLAN §4 Step 1.3): every sign-in,
// recovery and email-change code goes out here, branded for the person's
// community, through Resend or Postmark. Configure it in Supabase › Auth › Hooks
// (docs/DEPLOY.md › Messaging); the secret is SEND_EMAIL_HOOK_SECRET.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const v = await verifiedHookBody(request, "SEND_EMAIL_HOOK_SECRET");
  if (!v.ok) return v.response;
  const user = (v.body.user ?? {}) as HookUser;
  const data = (v.body.email_data ?? {}) as { token?: string; token_new?: string; email_action_type?: string };
  const r = await sendSignInEmail(user, data);
  return r.ok ? NextResponse.json({}) : hookError(r.status, r.message);
}
