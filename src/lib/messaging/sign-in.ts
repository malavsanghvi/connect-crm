import "server-only";

import { brandingUrl, fromHeader, renderEmail } from "./email";
import { emailKey, sendEmail, sendTwilio, type EmailProvider, type Req } from "./providers";
import { workerQuery } from "./server-db";
import { platformEnv } from "@/lib/platform-setup/server-config";

// Branded sign-in codes for the Supabase Auth "send email" and "send SMS" hooks.
// Sign-in must be synchronous, so the code goes straight to the provider here —
// never through the job queue. The center is the one the login belongs to
// (app.worker_sign_in_context); otherwise Community Connect's own branding.
// The code itself is never stored or logged.

export type HookUser = { id?: string | null; email?: string | null; new_email?: string | null; phone?: string | null };
export type HookResult = { ok: true } | { ok: false; status: number; message: string };

type Brand = { id: string; name: string; short_name: string; environment: string; logo_path: string | null; primary_color: string | null; public_email: string | null };
type Context = {
  brand: Brand | null;
  email: { provider: EmailProvider; sender: { from_name: string; from_address: string; reply_to: string | null } | null; footer: { postal_address: string | null; note: string | null }; suppressed: boolean };
  sms: { connected: boolean; from_number: string | null; messaging_service_sid: string | null; suppressed: boolean };
};

const fetchReq: Req = async (url, init) => {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(4000) });
  return { status: r.status, text: await r.text() };
};

async function context(user: HookUser): Promise<Context | null> {
  try {
    const rows = await workerQuery<{ c: Context }>("select app.worker_sign_in_context($1, $2, $3) as c", [user.id ?? null, user.email ?? null, user.phone ?? null]);
    return rows?.[0]?.c ?? null;
  } catch (err) {
    // Sign-in still works with Community Connect's branding; the failure is logged.
    console.error("[auth-hook] could not read the sign-in context, using Community Connect's default:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function record(center: string | null, channel: "email" | "sms", to: string, subject: string | null, status: string, provider: string, ref: string | null, error: string | null, sandbox: boolean) {
  try {
    await workerQuery("select app.worker_record_hook_message($1, $2, $3, $4, $5, $6, $7, $8, $9)", [center, channel, to, subject, status, provider, ref, error, sandbox]);
  } catch (err) {
    console.error("[auth-hook] could not record the sign-in message:", err instanceof Error ? err.message : err);
  }
}

const ACTION: Record<string, string> = {
  signup: "sign-in", magiclink: "sign-in", invite: "sign-in", recovery: "account recovery",
  email_change: "email change", email: "sign-in", reauthentication: "confirmation",
};

export function signInEmailText(shortName: string, what: string, code: string): { subject: string; body: string } {
  return {
    subject: `Your ${shortName} ${what} code`,
    body: `Your ${shortName} ${what} code is ${code}.\n\nIt can be used once and expires shortly. If you did not ask for it, ignore this email.`,
  };
}

export async function sendSignInEmail(user: HookUser, data: { token?: string; token_new?: string; email_action_type?: string }): Promise<HookResult> {
  const env = await platformEnv();
  const ctx = await context(user);
  const brand = ctx?.brand ?? null;
  const what = ACTION[data.email_action_type ?? ""] ?? "sign-in";
  const sends: { to: string; code: string }[] = [];
  if (data.email_action_type === "email_change" && data.token_new && user.new_email) sends.push({ to: user.new_email, code: data.token_new });
  if (data.token && user.email) sends.push({ to: user.email, code: data.token });
  if (sends.length === 0) return { ok: false, status: 400, message: "The sign-in request had no address or code to send." };
  if (ctx?.email.suppressed) {
    await record(brand?.id ?? null, "email", sends[0]!.to, null, "suppressed", ctx.email.provider, null, "The address bounced or complained earlier", brand?.environment === "sandbox");
    return { ok: false, status: 400, message: "Email to this address bounced earlier, so the code was not sent. Ask your community's office to check it." };
  }
  const provider: EmailProvider = ctx?.email.provider ?? (env.MESSAGING_EMAIL_PROVIDER === "postmark" ? "postmark" : "resend");
  const sender = ctx?.email.sender ?? null;
  if (!sender && !env.MESSAGING_FROM_ADDRESS?.trim()) {
    console.error("[auth-hook] MESSAGING_FROM_ADDRESS is not set and the community has no verified sender");
    return { ok: false, status: 503, message: "Sign-in email isn't configured on the Community Connect server yet." };
  }
  let key: string;
  try {
    key = emailKey(env, provider, null);
  } catch (err) {
    console.error("[auth-hook]", err instanceof Error ? err.message : err);
    return { ok: false, status: 503, message: "Sign-in email isn't configured on the Community Connect server yet." };
  }
  const shortName = brand?.short_name ?? "Community Connect";
  const b = brand ? { name: brand.name, short_name: brand.short_name, primary_color: brand.primary_color, logo_url: brandingUrl(env.NEXT_PUBLIC_SUPABASE_URL, brand.logo_path) } : null;
  for (const s of sends) {
    const text = signInEmailText(shortName, what, s.code);
    const email = renderEmail({ subject: text.subject, body: text.body, brand: b, footer: ctx?.email.footer ?? null, sandbox: brand?.environment === "sandbox" });
    try {
      const res = await sendEmail(fetchReq, env, provider, key, {
        from: fromHeader(sender, b, { address: env.MESSAGING_FROM_ADDRESS?.trim() ?? "", name: env.MESSAGING_FROM_NAME?.trim() || "Community Connect" }),
        to: s.to, subject: email.subject, html: email.html, text: email.text, replyTo: sender?.reply_to ?? brand?.public_email ?? null,
      });
      await record(brand?.id ?? null, "email", s.to, email.subject, "sent", provider, res.id, null, brand?.environment === "sandbox");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[auth-hook] sending the sign-in email failed:", msg);
      await record(brand?.id ?? null, "email", s.to, email.subject, "failed", provider, null, msg, brand?.environment === "sandbox");
      return { ok: false, status: 502, message: "The sign-in email could not be sent. Try again in a minute." };
    }
  }
  return { ok: true };
}

export async function sendSignInSms(user: HookUser, otp: string): Promise<HookResult> {
  const env = await platformEnv();
  const phone = user.phone ? (user.phone.startsWith("+") ? user.phone : `+${user.phone}`) : null;
  if (!phone || !otp) return { ok: false, status: 400, message: "The sign-in request had no phone number or code to send." };
  const ctx = await context(user);
  const brand = ctx?.brand ?? null;
  if (ctx?.sms.suppressed) {
    await record(brand?.id ?? null, "sms", phone, null, "suppressed", "twilio", null, "The number replied STOP", brand?.environment === "sandbox");
    return { ok: false, status: 400, message: "This number replied STOP, so texts to it are blocked. Text START to the community's number, then try again." };
  }
  const own = ctx?.sms.connected ? ctx.sms : null;
  const from = own?.from_number ?? env.TWILIO_FROM_NUMBER?.trim() ?? null;
  const service = own?.messaging_service_sid ?? (own ? null : env.TWILIO_MESSAGING_SERVICE_SID?.trim() || null);
  const prefix = brand?.environment === "sandbox" ? "Sandbox · test data: " : "";
  const body = `${prefix}${brand?.short_name ?? "Community Connect"}: your sign-in code is ${otp}. Do not share it.`;
  if (!from && !service) {
    console.error("[auth-hook] no number to text sign-in codes from (TWILIO_FROM_NUMBER / TWILIO_MESSAGING_SERVICE_SID not set, community texting not approved)");
    return { ok: false, status: 503, message: "Sign-in by text isn't configured on the Community Connect server yet." };
  }
  try {
    const res = await sendTwilio(fetchReq, env, { to: phone, body, from, messagingServiceSid: service });
    await record(brand?.id ?? null, "sms", phone, null, "sent", "twilio", res.sid, null, brand?.environment === "sandbox");
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[auth-hook] sending the sign-in text failed:", msg);
    await record(brand?.id ?? null, "sms", phone, null, "failed", "twilio", null, msg, brand?.environment === "sandbox");
    return { ok: false, status: /isn't configured/.test(msg) ? 503 : 502, message: /isn't configured/.test(msg) ? "Sign-in by text isn't configured on the Community Connect server yet." : "The sign-in text could not be sent. Try again in a minute." };
  }
}
